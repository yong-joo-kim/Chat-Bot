import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isApiConditionV2, isSurveyV2, normalizeText } from '@chat-bot/shared-types';
import type { RestoreWarning } from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { BannedWordFilterService } from '../../banned-words/banned-word-filter.service';
import { ReindexQueueService } from '../../embedding/index/reindex-queue.service';
import type { SnapshotEnvelope } from '../lib/snapshot-envelope';
import { stableStringify } from '../lib/snapshot-canonical';

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

  async computeWarnings(
    chatbotId: string,
    chatbotStatus: string,
    current: SnapshotEnvelope,
    target: SnapshotEnvelope,
    targetIntegrityWarningCount: number,
    upcastedFrom: number | undefined,
    currentSchemaVersion: number,
  ): Promise<RestoreWarning[]> {
    const warnings: RestoreWarning[] = [];

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

    // [No.26] API 연결 참조 경고(§15) — 대상 스냅샷의 v2 connectionId 집합으로 1회 조회.
    const targetConnectionIds = new Set<string>();
    let legacyFormatCount = 0;
    for (const node of target.assets.dialogNodes) {
      for (const output of node.outputs) {
        if (output.type !== 'API_CONDITION') continue;
        if (isApiConditionV2(output.payload)) targetConnectionIds.add(output.payload.connectionId);
        else legacyFormatCount += 1;
      }
    }
    if (targetConnectionIds.size > 0) {
      const rows = await this.prisma.apiConnection.findMany({ where: { id: { in: [...targetConnectionIds] } }, select: { id: true, enabled: true } });
      const foundMap = new Map(rows.map((r) => [r.id, r.enabled]));
      let missing = 0;
      let disabled = 0;
      for (const id of targetConnectionIds) {
        const enabled = foundMap.get(id);
        if (enabled === undefined) missing += 1;
        else if (!enabled) disabled += 1;
      }
      if (missing > 0) warnings.push({ code: 'API_CONNECTION_MISSING', count: missing });
      if (disabled > 0) warnings.push({ code: 'API_CONNECTION_DISABLED', count: disabled });
    }
    if (legacyFormatCount > 0) warnings.push({ code: 'API_LEGACY_FORMAT', count: legacyFormatCount });

    // [No.27] 설문 참조 경고 3종(§16) — 대상 스냅샷의 v2 surveyId 집합으로 1회 조회.
    const targetSurveyIds = new Set<string>();
    let legacySurveyFormatCount = 0;
    for (const node of target.assets.dialogNodes) {
      for (const output of node.outputs) {
        if (output.type !== 'SURVEY') continue;
        if (isSurveyV2(output.payload)) targetSurveyIds.add(output.payload.surveyId);
        else legacySurveyFormatCount += 1;
      }
    }
    if (targetSurveyIds.size > 0) {
      const rows = await this.prisma.survey.findMany({ where: { id: { in: [...targetSurveyIds] } }, select: { id: true, status: true } });
      const foundMap = new Map(rows.map((r) => [r.id, r.status]));
      let missing = 0;
      let notOpen = 0;
      for (const id of targetSurveyIds) {
        const status = foundMap.get(id);
        if (status === undefined) missing += 1;
        else if (status !== 'OPEN') notOpen += 1;
      }
      if (missing > 0) warnings.push({ code: 'SURVEY_MISSING', count: missing });
      if (notOpen > 0) warnings.push({ code: 'SURVEY_NOT_OPEN', count: notOpen });
    }
    if (legacySurveyFormatCount > 0) warnings.push({ code: 'SURVEY_LEGACY_FORMAT', count: legacySurveyFormatCount });

    return warnings;
  }
}
