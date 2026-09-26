import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { normalizeText } from '@chat-bot/shared-types';
import type { RestoreWarning } from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { BannedWordFilterService } from '../../banned-words/banned-word-filter.service';
import { ReindexQueueService } from '../../embedding/index/reindex-queue.service';
import type { SnapshotEnvelope } from '../lib/snapshot-envelope';
import { stableStringify } from '../lib/snapshot-canonical';
import { computeTopicExposureChange } from '../lib/topic-exposure';
import { collectExternalRefs } from '../lib/external-refs';

/**
 * 복원 경고(§8.1) — **읽기 전용**(제안·TC·금지어·RAG 설정). 대화 자산을 쓰지 않는다.
 * `BannedWordFilterService`는 경고 산출 읽기만(§2.2) — `QueryEmbeddingService`는 주입하지 않는다.
 */
@Injectable()
export class RestoreWarningsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bannedWordFilter: BannedWordFilterService,
    private readonly reindexQueue: ReindexQueueService,
    private readonly config: ConfigService,
  ) {}

  private collectTexts(envelope: SnapshotEnvelope): string[] {
    const texts: string[] = [];
    for (const faq of envelope.assets.faqs) texts.push(faq.answer);
    for (const context of envelope.assets.contexts) {
      if (context.completionMessage) texts.push(context.completionMessage);
      for (const slot of context.slots) if (slot.prompt) texts.push(slot.prompt);
    }
    for (const node of envelope.assets.dialogNodes) {
      for (const output of node.outputs) {
        const payload = output.payload as Record<string, unknown>;
        if (typeof payload.text === 'string') texts.push(payload.text);
        if (typeof payload.description === 'string') texts.push(payload.description);
      }
    }
    return texts;
  }

  /** [신규 No.22 — §11.3] 대상이 없는 토픽을 가리켜 공통으로 적재되는 건수 + 노출 변화(공통 판정
   * 기준 = 현재 DB의 토픽 활성 상태). `target`은 **정규화된** 스냅샷을 넘겨야 한다. */
  private computeTopicWarnings(
    topics: Array<{ id: string; enabled: boolean }>,
    current: SnapshotEnvelope,
    normalizedTarget: SnapshotEnvelope,
    missingCount: number,
  ): RestoreWarning[] {
    const warnings: RestoreWarning[] = [];
    if (missingCount > 0) warnings.push({ code: 'TOPIC_MISSING', count: missingCount });

    const { exposed, hidden } = computeTopicExposureChange(topics, current, normalizedTarget);
    if (exposed > 0 || hidden > 0) warnings.push({ code: 'TOPIC_EXPOSURE_CHANGE', exposed, hidden });
    return warnings;
  }

  async computeWarnings(
    chatbotId: string,
    chatbotStatus: string,
    current: SnapshotEnvelope,
    target: SnapshotEnvelope,
    targetIntegrityWarningCount: number,
    upcastedFrom: number | undefined,
    currentSchemaVersion: number,
    topicContext?: { topics: Array<{ id: string; enabled: boolean }>; missingCount: number },
  ): Promise<RestoreWarning[]> {
    const warnings: RestoreWarning[] = [];
    if (topicContext) warnings.push(...this.computeTopicWarnings(topicContext.topics, current, target, topicContext.missingCount));

    if (chatbotStatus === 'ACTIVE') warnings.push({ code: 'ACTIVE_CHATBOT' });

    if (targetIntegrityWarningCount > 0) {
      warnings.push({ code: 'TARGET_INTEGRITY_WARNINGS', count: targetIntegrityWarningCount });
    }

    // BANNED_WORD_MATCHES — 대상에서 되살아나거나 바뀌는 문구 중 현재 금지어 사전과 일치하는 항목 수.
    const currentTextSet = new Set(this.collectTexts(current));
    const changedTargetTexts = this.collectTexts(target).filter((t) => !currentTextSet.has(t));
    let bannedMatchCount = 0;
    for (const text of changedTargetTexts) {
      const result = await this.bannedWordFilter.test(text);
      if (result.matches.length > 0) bannedMatchCount += 1;
    }
    if (bannedMatchCount > 0) warnings.push({ code: 'BANNED_WORD_MATCHES', count: bannedMatchCount });

    const targetIntentIds = new Set(target.assets.intents.map((i) => i.id));
    const pendingOrphaned = await this.prisma.augmentationSuggestion.count({
      where: { chatbotId, status: 'PENDING', intentId: { notIn: [...targetIntentIds] } },
    });
    if (pendingOrphaned > 0) warnings.push({ code: 'PENDING_SUGGESTIONS_ORPHANED', count: pendingOrphaned });

    // ACCEPTED_SUGGESTIONS_NOT_RESUGGESTED — (intentId, textNormalized)가 현재 예문에 있고 대상 예문에 없는 건.
    const currentExamplesByIntent = new Map<string, Set<string>>();
    for (const intent of current.assets.intents) currentExamplesByIntent.set(intent.id, new Set(intent.examples.map((e) => normalizeText(e))));
    const targetExamplesByIntent = new Map<string, Set<string>>();
    for (const intent of target.assets.intents) targetExamplesByIntent.set(intent.id, new Set(intent.examples.map((e) => normalizeText(e))));

    const acceptedSuggestions = await this.prisma.augmentationSuggestion.findMany({
      where: { chatbotId, status: 'ACCEPTED' },
      select: { intentId: true, textNormalized: true },
    });
    let notResuggestedCount = 0;
    for (const s of acceptedSuggestions) {
      const inCurrent = currentExamplesByIntent.get(s.intentId)?.has(s.textNormalized) ?? false;
      const inTarget = targetExamplesByIntent.get(s.intentId)?.has(s.textNormalized) ?? false;
      if (inCurrent && !inTarget) notResuggestedCount += 1;
    }
    if (notResuggestedCount > 0) warnings.push({ code: 'ACCEPTED_SUGGESTIONS_NOT_RESUGGESTED', count: notResuggestedCount });

    // TEST_CASES_UNRESOLVED — enabled TC 중 expectedTargetId가 대상에 없는 건(kind별로 대상 집합 판단).
    const targetFaqIds = new Set(target.assets.faqs.map((f) => f.id));
    const targetNodeIds = new Set(target.assets.dialogNodes.map((n) => n.id));
    const enabledCases = await this.prisma.testCase.findMany({
      where: { chatbotId, enabled: true, expectedKind: { in: ['INTENT', 'FAQ', 'NODE'] }, expectedTargetId: { not: null } },
      select: { expectedKind: true, expectedTargetId: true },
    });
    let unresolvedCount = 0;
    for (const c of enabledCases) {
      if (!c.expectedTargetId) continue;
      const exists =
        c.expectedKind === 'INTENT'
          ? targetIntentIds.has(c.expectedTargetId)
          : c.expectedKind === 'FAQ'
            ? targetFaqIds.has(c.expectedTargetId)
            : targetNodeIds.has(c.expectedTargetId);
      if (!exists) unresolvedCount += 1;
    }
    if (unresolvedCount > 0) warnings.push({ code: 'TEST_CASES_UNRESOLVED', count: unresolvedCount });

    const classifierRow = await this.prisma.intentClassifierModel.findUnique({ where: { chatbotId }, select: { chatbotId: true } });
    if (classifierRow) warnings.push({ code: 'CLASSIFIER_WILL_BE_DELETED' });

    const profileFields: string[] = [];
    if (current.profile.name !== target.profile.name) profileFields.push('name');
    if (current.profile.avatarUrl !== target.profile.avatarUrl) profileFields.push('avatarUrl');
    if (current.profile.description !== target.profile.description) profileFields.push('description');
    if (stableStringify(current.profile.skin) !== stableStringify(target.profile.skin)) profileFields.push('skin');
    if (profileFields.length > 0) warnings.push({ code: 'PROFILE_WILL_CHANGE', fields: profileFields });

    if (target.answerSetting?.ragEnabled === true && !this.config.get<string>('RAG_BASE_URL')) {
      warnings.push({ code: 'RAG_NOT_CONFIGURED' });
    }

    if (this.reindexQueue.isRunning(chatbotId)) warnings.push({ code: 'REINDEX_IN_PROGRESS' });

    if (upcastedFrom !== undefined) warnings.push({ code: 'SCHEMA_UPCASTED', fromVersion: upcastedFrom, toVersion: currentSchemaVersion });

    // [No.26/No.27, 신규 No.40 — §6.1 발견 제약 ⑤] 외부 참조(API 연결·설문) 수집은 이제
    // `collectExternalRefs()` 공용 함수를 쓴다(동작 불변 — 복원 경고와 전환 미리보기 경고가 같은 로직 공유).
    const targetRefs = collectExternalRefs(target);
    if (targetRefs.apiConnectionIds.size > 0) {
      const rows = await this.prisma.apiConnection.findMany({ where: { id: { in: [...targetRefs.apiConnectionIds] } }, select: { id: true, enabled: true } });
      const foundMap = new Map(rows.map((r) => [r.id, r.enabled]));
      let missing = 0;
      let disabled = 0;
      for (const id of targetRefs.apiConnectionIds) {
        const enabled = foundMap.get(id);
        if (enabled === undefined) missing += 1;
        else if (!enabled) disabled += 1;
      }
      if (missing > 0) warnings.push({ code: 'API_CONNECTION_MISSING', count: missing });
      if (disabled > 0) warnings.push({ code: 'API_CONNECTION_DISABLED', count: disabled });
    }
    if (targetRefs.apiLegacyFormatCount > 0) warnings.push({ code: 'API_LEGACY_FORMAT', count: targetRefs.apiLegacyFormatCount });

    if (targetRefs.surveyIds.size > 0) {
      const rows = await this.prisma.survey.findMany({ where: { id: { in: [...targetRefs.surveyIds] } }, select: { id: true, status: true } });
      const foundMap = new Map(rows.map((r) => [r.id, r.status]));
      let missing = 0;
      let notOpen = 0;
      for (const id of targetRefs.surveyIds) {
        const status = foundMap.get(id);
        if (status === undefined) missing += 1;
        else if (status !== 'OPEN') notOpen += 1;
      }
      if (missing > 0) warnings.push({ code: 'SURVEY_MISSING', count: missing });
      if (notOpen > 0) warnings.push({ code: 'SURVEY_NOT_OPEN', count: notOpen });
    }
    if (targetRefs.surveyLegacyFormatCount > 0) warnings.push({ code: 'SURVEY_LEGACY_FORMAT', count: targetRefs.surveyLegacyFormatCount });

    // [신규 No.41] 업무 자동화 발송 대상 — 전역·스냅샷 밖(참조만 스냅샷, ADR-0041 §8).
    if (targetRefs.workflowTargetIds.size > 0) {
      const rows = await this.prisma.workflowTarget.findMany({ where: { id: { in: [...targetRefs.workflowTargetIds] } }, select: { id: true, enabled: true } });
      const foundMap = new Map(rows.map((r) => [r.id, r.enabled]));
      let missing = 0;
      let disabled = 0;
      for (const id of targetRefs.workflowTargetIds) {
        const enabled = foundMap.get(id);
        if (enabled === undefined) missing += 1;
        else if (!enabled) disabled += 1;
      }
      if (missing > 0) warnings.push({ code: 'WORKFLOW_TARGET_MISSING', count: missing });
      if (disabled > 0) warnings.push({ code: 'WORKFLOW_TARGET_DISABLED', count: disabled });
    }

    return warnings;
  }
}
