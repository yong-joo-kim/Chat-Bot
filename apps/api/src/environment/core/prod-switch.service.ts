import { Injectable, Logger } from '@nestjs/common';
import type {
  EnvironmentVersionRef,
  GateEvaluation,
  ProdSwitchPreviewResponse,
  ProdSwitchResponse,
  ProdSwitchWarning,
} from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiException } from '../../common/api.exception';
import { isBusyError } from '../../common/prisma/busy-error';
import { AuditLogService } from '../../audit-logs/audit-log.service';
import { VersionPayloadReader } from '../../versions/read/version-payload.reader';
import { hydrateForServing } from '../../versions/lib/snapshot-serving';
import { diffSnapshots } from '../../versions/lib/version-diff';
import { normalizeSnapshotTopics } from '../../versions/lib/snapshot-topic-normalize';
import { computeTopicExposureChange } from '../../versions/lib/topic-exposure';
import { collectExternalRefs } from '../../versions/lib/external-refs';
import { computeContextFlowsAffected } from '../../versions/lib/context-flows';
import { deriveSemanticSlots } from '../../embedding/lib/semantic-slots';
import { EmbeddingProviderFactory } from '../../embedding/embedding-provider.factory';
import { EmbeddingTextVectorService } from '../../embedding/text-vector/embedding-text-vector.service';
import { VersionVectorResolver } from '../../embedding/version-vectors/version-vector.resolver';
import { EnvironmentCacheEvents } from '../../common/events/environment-cache.events';
import { EnvironmentPointerWriter } from './environment-pointer.writer';
import { EnvironmentReadService } from './environment-read.service';
import { isSwitchTargetAllowed, pickRollbackTarget, classifySwitch } from './lib/switch-rules';
import { evaluateProdSwitchGate } from './lib/gate';
import type { GateLatestRun } from './lib/gate';
import { computeSwitchWarnings } from './lib/switch-warnings';

export interface SwitchInvocation {
  actor: { id: string | null; email: string; role?: string | null };
  auditSummaryPrefix?: string;
  deployScheduleId?: string;
  /** 생략 시 `new Date()`(이 파일은 `deploy-schedules/**` D-12 스캔 대상 밖이다). */
  now?: Date;
}

interface VersionMeta {
  id: string;
  versionNo: number;
  contentHash: string;
  createdAt: Date;
}

const NOT_FOUND_MESSAGE = '요청하신 버전을 찾을 수 없습니다.';

/**
 * [신규 No.40] 운영 전환·롤백 미리보기/확정(즉시·예약 공용, §9.3). `EnvironmentCoreModule`이
 * export하는 2개 중 하나 — 유일한 포인터 쓰기 경로(`EnvironmentPointerWriter`)로만 쓴다.
 */
@Injectable()
export class ProdSwitchService {
  private readonly logger = new Logger('ProdSwitchService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly payloadReader: VersionPayloadReader,
    private readonly embeddingProviderFactory: EmbeddingProviderFactory,
    private readonly versionVectorResolver: VersionVectorResolver,
    private readonly textVectorService: EmbeddingTextVectorService,
    private readonly auditLogService: AuditLogService,
    private readonly writer: EnvironmentPointerWriter,
    private readonly environmentRead: EnvironmentReadService,
    // [신규 No.40 R1 — M-1] 커밋 후 L1/L2 캐시 무효화 — `environment/core`는 `environment/serving`을
    // import할 수 없으므로(§2.2) 이벤트로만 알린다(`VersionBundleService`가 구독).
    private readonly cacheEvents: EnvironmentCacheEvents,
  ) {}

  private async loadVersionRow(chatbotId: string, versionId: string): Promise<VersionMeta | null> {
    const row = await this.prisma.chatbotVersion.findUnique({
      where: { id: versionId },
      select: { id: true, chatbotId: true, versionNo: true, contentHash: true, createdAt: true },
    });
    if (!row || row.chatbotId !== chatbotId) return null;
    return row;
  }

  /** 대상이 있는 토픽 집합으로 정규화한 뒤 서빙 형태로 되살린다(토픽 노출 비교의 입력 규격 통일, §9.4). */
  private async loadServingMeta(versionId: string, chatbotId: string, existingTopicIds: ReadonlySet<string>) {
    const loaded = await this.payloadReader.loadStrict(versionId);
    const normalized = normalizeSnapshotTopics(loaded.envelope, existingTopicIds);
    const served = hydrateForServing(normalized.envelope, chatbotId);
    const slots = deriveSemanticSlots(served.bundle);
    return { envelope: normalized.envelope, missingTopicCount: normalized.missingCount, legacyTiebreak: served.legacyTiebreak, slots, profile: served.profile };
  }

  private toRef(meta: VersionMeta, label: string | null = null): EnvironmentVersionRef {
    return { versionId: meta.id, versionNo: meta.versionNo, capturedAt: meta.createdAt, label };
  }

  private async evaluateGate(chatbotId: string, targetVersionId: string, kind: 'SWITCH' | 'ROLLBACK'): Promise<GateEvaluation> {
    const pointer = await this.environmentRead.getPointerStatus(chatbotId);
    const gate = pointer.gate;
    const provider = await this.embeddingProviderFactory.getProvider();

    let setExists = true;
    if (gate.testSetId) {
      const set = await this.prisma.testCaseSet.findFirst({ where: { id: gate.testSetId, chatbotId }, select: { id: true } });
      setExists = !!set;
    }

    const run = await this.prisma.testRun.findFirst({
      where: {
        chatbotId,
        targetVersionId,
        status: 'SUCCEEDED',
        mode: 'SINGLE',
        ...(gate.testSetId ? { setId: gate.testSetId } : {}),
      },
      orderBy: { finishedAt: 'desc' },
      select: { id: true, setId: true, set: { select: { name: true } }, summary: true, finishedAt: true },
    });

    let latestRun: GateLatestRun | null = null;
    if (run && run.finishedAt) {
      let summaryA: GateLatestRun['summaryA'] = { pass: 0, fail: 0, notJudged: 0, unresolved: 0 };
      try {
        const parsed = run.summary ? (JSON.parse(run.summary) as { a?: typeof summaryA }) : undefined;
        if (parsed?.a) summaryA = parsed.a;
      } catch {
        // 파싱 실패 — 0건 판정(BELOW_THRESHOLD로 안전 측 처리).
      }
      latestRun = { runId: run.id, setId: run.setId, setName: run.set?.name ?? '', summaryA, finishedAt: run.finishedAt, embeddingModelId: null };
    }

    return evaluateProdSwitchGate({
      settings: gate,
      latestRun,
      setExists,
      currentEmbeddingModelId: provider?.modelId ?? null,
      now: new Date(),
      kind,
    });
  }

  /**
   * [신규 No.40 R1 — H-1] `preview()`·`switch()`(확정 시점 재계산) 공용 — §9.4의 경고 산출 입력
   * 조립을 한 곳에서만 한다(복제 금지). 실패하면 그대로 throw한다(호출자가 의미에 맞게 처리).
   */
  private async assembleSwitchWarnings(
    chatbotId: string,
    currentMeta: VersionMeta,
    targetMeta: VersionMeta,
    gate: GateEvaluation,
  ): Promise<{ warnings: ProdSwitchWarning[]; diffSummary: ProdSwitchPreviewResponse['diffSummary'] }> {
    const warnings: ProdSwitchWarning[] = [];
    if (gate.verdict === 'BLOCK' || gate.verdict === 'WARN') warnings.push({ code: 'GATE_WARN', gate });

    const topicRows = await this.prisma.topic.findMany({ where: { chatbotId }, select: { id: true, enabled: true } });
    const existingTopicIds = new Set(topicRows.map((t) => t.id));
    const [currentServing, targetServing] = await Promise.all([
      this.loadServingMeta(currentMeta.id, chatbotId, existingTopicIds),
      this.loadServingMeta(targetMeta.id, chatbotId, existingTopicIds),
    ]);
    const diffSummary = diffSnapshots(currentServing.envelope, targetServing.envelope, 0, 0).summary;

    const provider = await this.embeddingProviderFactory.getProvider();
    let semanticMissing = 0;
    if (provider) {
      const resolution = await this.versionVectorResolver.resolve(chatbotId, provider.modelId, targetServing.slots);
      semanticMissing = resolution.missing;
    }

    // [신규 No.40 — §9.4] 토픽 노출·맥락 흐름·외부 참조(설문·API 연결) 경고 입력을 조립한다.
    const topicExposure = computeTopicExposureChange(topicRows, currentServing.envelope, targetServing.envelope);
    const contextFlowsAffected = computeContextFlowsAffected(currentServing.envelope, targetServing.envelope);
    const targetRefs = collectExternalRefs(targetServing.envelope);

    let surveyMissingCount = 0;
    let surveyNotOpenCount = 0;
    if (targetRefs.surveyIds.size > 0) {
      const rows = await this.prisma.survey.findMany({ where: { id: { in: [...targetRefs.surveyIds] } }, select: { id: true, status: true } });
      const foundMap = new Map(rows.map((r) => [r.id, r.status]));
      for (const id of targetRefs.surveyIds) {
        const status = foundMap.get(id);
        if (status === undefined) surveyMissingCount += 1;
        else if (status !== 'OPEN') surveyNotOpenCount += 1;
      }
    }

    let apiConnectionMissingCount = 0;
    let apiConnectionDisabledCount = 0;
    if (targetRefs.apiConnectionIds.size > 0) {
      const rows = await this.prisma.apiConnection.findMany({ where: { id: { in: [...targetRefs.apiConnectionIds] } }, select: { id: true, enabled: true } });
      const foundMap = new Map(rows.map((r) => [r.id, r.enabled]));
      for (const id of targetRefs.apiConnectionIds) {
        const enabled = foundMap.get(id);
        if (enabled === undefined) apiConnectionMissingCount += 1;
        else if (!enabled) apiConnectionDisabledCount += 1;
      }
    }

    // [신규 No.41] 업무 자동화 발송 대상 — 전역·스냅샷 밖(ADR-0041 §8).
    let workflowTargetMissingCount = 0;
    let workflowTargetDisabledCount = 0;
    if (targetRefs.workflowTargetIds.size > 0) {
      const rows = await this.prisma.workflowTarget.findMany({ where: { id: { in: [...targetRefs.workflowTargetIds] } }, select: { id: true, enabled: true } });
      const foundMap = new Map(rows.map((r) => [r.id, r.enabled]));
      for (const id of targetRefs.workflowTargetIds) {
        const enabled = foundMap.get(id);
        if (enabled === undefined) workflowTargetMissingCount += 1;
        else if (!enabled) workflowTargetDisabledCount += 1;
      }
    }

    const latestVersion = await this.prisma.chatbotVersion.findFirst({ where: { chatbotId }, orderBy: { versionNo: 'desc' }, select: { createdAt: true } });

    return {
      diffSummary,
      warnings: [
        ...warnings,
        ...computeSwitchWarnings({
          targetLegacyTiebreak: targetServing.legacyTiebreak,
          semanticMissing,
          targetCreatedAt: targetMeta.createdAt,
          draftLatestCapturedAt: latestVersion?.createdAt ?? targetMeta.createdAt,
          currentProfile: currentServing.profile,
          targetProfile: targetServing.profile,
          contextFlowsAffected,
          topicExposure,
          topicMissingCount: targetServing.missingTopicCount,
          surveyMissingCount,
          surveyNotOpenCount,
          apiConnectionMissingCount,
          apiConnectionDisabledCount,
          workflowTargetMissingCount,
          workflowTargetDisabledCount,
        }),
      ],
    };
  }

  async preview(chatbotId: string, input: { kind: 'SWITCH' | 'ROLLBACK'; targetVersionId?: string }): Promise<ProdSwitchPreviewResponse> {
    const pointer = await this.environmentRead.getPointerStatus(chatbotId);
    const blockers: ProdSwitchPreviewResponse['blockers'] = [];

    const chatbotRow = await this.prisma.chatbot.findUnique({ where: { id: chatbotId }, select: { status: true } });
    if (chatbotRow?.status === 'ARCHIVED') blockers.push('CHATBOT_ARCHIVED');
    if (!pointer.prodVersionId) blockers.push('ENV_MODE_DISABLED');

    const currentMeta = pointer.prodVersionId ? await this.loadVersionRow(chatbotId, pointer.prodVersionId) : null;

    let targetId = input.targetVersionId;
    if (input.kind === 'ROLLBACK' && !targetId && pointer.prodVersionId) {
      const historyDesc = await this.environmentRead.getProdHistoryDesc(chatbotId);
      const existing = await this.prisma.chatbotVersion.findMany({ where: { chatbotId }, select: { id: true } });
      targetId = pickRollbackTarget(historyDesc, pointer.prodVersionId, new Set(existing.map((v) => v.id))) ?? undefined;
      if (!targetId) blockers.push('TARGET_NOT_ALLOWED');
    }

    const targetMeta = targetId ? await this.loadVersionRow(chatbotId, targetId) : null;
    if (targetId && !targetMeta) blockers.push('TARGET_UNREADABLE');

    if (targetId && targetMeta && pointer.prodVersionId) {
      const historyDesc = await this.environmentRead.getProdHistoryDesc(chatbotId);
      const allowed = isSwitchTargetAllowed({
        target: targetId,
        staging: pointer.stagingVersionId,
        prodHistoryIds: new Set(historyDesc.map((h) => h.toVersionId).filter((v): v is string => !!v)),
        kind: input.kind,
      });
      if (!allowed) blockers.push('TARGET_NOT_ALLOWED');
    }

    let gate: GateEvaluation = { verdict: 'PASS', reason: 'NOT_CONFIGURED', run: null };
    let warnings: ProdSwitchWarning[] = [];
    let diffSummary: ProdSwitchPreviewResponse['diffSummary'] = { rows: [], totalChanged: 0, identical: true };

    if (targetMeta && currentMeta) {
      try {
        gate = await this.evaluateGate(chatbotId, targetMeta.id, input.kind);
      } catch {
        blockers.push('GATE_CONFIG_ERROR');
      }

      try {
        const assembled = await this.assembleSwitchWarnings(chatbotId, currentMeta, targetMeta, gate);
        warnings = assembled.warnings;
        diffSummary = assembled.diffSummary;
      } catch {
        blockers.push('TARGET_UNREADABLE');
      }
    }

    if (gate.verdict === 'BLOCK' && input.kind === 'SWITCH') blockers.push('GATE_BLOCKED');

    const outcome = currentMeta && targetMeta ? classifySwitch(targetMeta.id, currentMeta.id) : 'NOOP';

    return {
      kind: input.kind,
      current: currentMeta ? this.toRef(currentMeta) : { versionId: '', versionNo: 0, capturedAt: new Date(0), label: null },
      target: targetMeta ? this.toRef(targetMeta) : { versionId: '', versionNo: 0, capturedAt: new Date(0), label: null },
      expectedProdVersionId: pointer.prodVersionId ?? '',
      outcome,
      diffSummary,
      gate,
      blockers: Array.from(new Set(blockers)),
      warnings,
    };
  }

  /** 즉시·예약·롤백 공용 확정(§9.3). */
  async switch(
    chatbotId: string,
    dto: { targetVersionId: string; expectedProdVersionId: string; acknowledgeWarnings?: boolean; reason?: string },
    kind: 'SWITCH' | 'ROLLBACK',
    invocation?: SwitchInvocation,
  ): Promise<ProdSwitchResponse> {
    const now = invocation?.now ?? new Date();

    const chatbot = await this.prisma.chatbot.findUnique({ where: { id: chatbotId }, select: { status: true, prodVersionId: true } });
    if (!chatbot) throw new ApiException('NOT_FOUND', 404, '요청하신 챗봇을 찾을 수 없습니다.');
    if (chatbot.status === 'ARCHIVED') throw new ApiException('CHATBOT_ARCHIVED', 409, '보관된 챗봇은 수정할 수 없습니다.');
    if (!chatbot.prodVersionId) throw new ApiException('ENV_MODE_DISABLED', 409, '환경 분리 모드가 꺼져 있습니다.');

    const targetMeta = await this.loadVersionRow(chatbotId, dto.targetVersionId);
    if (!targetMeta) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);

    if (dto.targetVersionId === chatbot.prodVersionId) {
      const currentMeta = await this.loadVersionRow(chatbotId, chatbot.prodVersionId);
      return {
        outcome: 'NOOP',
        prod: this.toRef(currentMeta ?? targetMeta),
        fromVersionNo: currentMeta?.versionNo ?? targetMeta.versionNo,
        semanticPending: 0,
      };
    }

    const pointer = await this.environmentRead.getPointerStatus(chatbotId);
    const historyDesc = await this.environmentRead.getProdHistoryDesc(chatbotId);
    const allowed = isSwitchTargetAllowed({
      target: dto.targetVersionId,
      staging: pointer.stagingVersionId,
      prodHistoryIds: new Set(historyDesc.map((h) => h.toVersionId).filter((v): v is string => !!v)),
      kind,
    });
    if (!allowed) throw new ApiException('ENV_TARGET_NOT_STAGING', 409, '전환 대상은 현재 스테이징 또는 운영 이력 버전만 가능합니다.');

    const gate = await this.evaluateGate(chatbotId, dto.targetVersionId, kind);
    if (gate.verdict === 'BLOCK' && kind === 'SWITCH') {
      throw new ApiException('ENV_GATE_NOT_PASSED', 409, '차단 게이트 기준을 충족하지 못해 전환할 수 없습니다.');
    }

    const currentMeta = await this.loadVersionRow(chatbotId, chatbot.prodVersionId);
    if (!currentMeta) throw new ApiException('ENV_POINTER_STALE', 409, '미리보기 이후 운영 버전이 바뀌었습니다. 다시 확인해 주세요.');

    // [신규 No.40 R1 — H-1] 확정 시점에도 `preview()`와 같은 함수로 경고 전체(게이트뿐 아니라
    // LEGACY_TIEBREAK·PROFILE_WILL_CHANGE·SURVEY_MISSING 등, §9.4)를 재계산한다 — 게이트 판정만
    // 보던 기존 검사는 다른 경고를 우회할 수 있었다(FR-EN4-4).
    let switchWarnings: ProdSwitchWarning[];
    try {
      switchWarnings = (await this.assembleSwitchWarnings(chatbotId, currentMeta, targetMeta, gate)).warnings;
    } catch {
      throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);
    }
    if (switchWarnings.length > 0 && dto.acknowledgeWarnings !== true) {
      throw new ApiException('VALIDATION_FAILED', 400, '경고 사항을 확인했는지 체크해 주세요.', [{ field: 'acknowledgeWarnings', message: '확인이 필요합니다.' }]);
    }

    let count: number;
    try {
      count = await this.prisma.$transaction(async (tx) => {
        return this.writer.switchProd(tx, {
          chatbotId,
          expectedProdVersionId: dto.expectedProdVersionId,
          versionId: targetMeta.id,
          versionNo: targetMeta.versionNo,
          versionCreatedAt: targetMeta.createdAt,
          method: invocation?.deployScheduleId ? 'SCHEDULED' : kind === 'ROLLBACK' ? 'ROLLBACK' : 'IMMEDIATE',
          deployScheduleId: invocation?.deployScheduleId,
          now,
          actor: invocation?.actor ?? this.auditLogService.currentActorSnapshot(),
          reason: dto.reason,
        });
      });
    } catch (e) {
      if (isBusyError(e)) throw new ApiException('ENV_SWITCH_BUSY', 409, '다른 변경과 동시에 처리되었습니다. 잠시 후 다시 시도해 주세요.');
      throw e;
    }
    if (count === 0) throw new ApiException('ENV_POINTER_STALE', 409, '미리보기 이후 운영 버전이 바뀌었습니다. 다시 확인해 주세요.');

    // [신규 No.40 R1 — M-1] L1/L2 캐시 무효화(이벤트 — §2.2 경계, `VersionBundleService` 구독).
    // 컨트롤러의 `warm()`보다 먼저 실행돼 이전 버전 캐시를 지운 뒤 새 버전으로 다시 채운다.
    this.cacheEvents.emitChatbotPointerChanged(chatbotId);

    // 커밋 후: pin(best-effort) · 감사.
    let semanticPending = 0;
    try {
      const topicRows = await this.prisma.topic.findMany({ where: { chatbotId }, select: { id: true } });
      const targetServing = await this.loadServingMeta(targetMeta.id, chatbotId, new Set(topicRows.map((t) => t.id)));
      const provider = await this.embeddingProviderFactory.getProvider();
      if (provider) {
        await this.textVectorService.pin(chatbotId, provider.modelId, targetServing.slots);
        const resolution = await this.versionVectorResolver.resolve(chatbotId, provider.modelId, targetServing.slots);
        semanticPending = resolution.missing;
      } else {
        semanticPending = targetServing.slots.length;
      }
    } catch (e) {
      this.logger.warn(`전환 후 벡터 보존 실패(흡수): chatbotId=${chatbotId} versionId=${targetMeta.id}`);
    }

    const prefix = invocation?.auditSummaryPrefix ? `${invocation.auditSummaryPrefix} ` : '';
    await this.auditLogService.record({
      action: 'UPDATE',
      targetType: 'ChatbotEnvironment',
      targetId: chatbotId,
      chatbotId,
      before: { prodVersionNo: currentMeta?.versionNo ?? null },
      after: { prodVersionNo: targetMeta.versionNo },
      summary: `${prefix}${kind === 'ROLLBACK' ? '운영 되돌리기' : '운영 전환'} v${currentMeta?.versionNo ?? '?'} → v${targetMeta.versionNo}${dto.reason ? ' · 사유 메모 있음' : ''}`,
      actorOverride: invocation?.actor ? { id: invocation.actor.id, email: invocation.actor.email, role: invocation.actor.role ?? null } : undefined,
    });

    return {
      outcome: 'APPLIED',
      prod: this.toRef(targetMeta),
      fromVersionNo: currentMeta?.versionNo ?? targetMeta.versionNo,
      semanticPending,
    };
  }
}
