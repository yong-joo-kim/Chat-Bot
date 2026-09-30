import { Injectable } from '@nestjs/common';
import { UTTERANCE_ANALYSIS_LIMITS, normalizeText } from '@chat-bot/shared-types';
import type {
  ApiErrorCode,
  UtteranceApplyExcludeReason,
  UtteranceApplyPreviewResponse,
  UtteranceApplyRequest,
  UtteranceApplyResponse,
} from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiException } from '../../common/api.exception';
import type { ApiExceptionBody } from '../../common/api.exception';
import { AuditLogService } from '../../audit-logs/audit-log.service';
import { ChatbotScopeService } from '../../chatbots/chatbot-scope.service';
import { IntentsService } from '../../intents/intents.service';
import { LearningApplyService } from '../../learning/learning-apply.service';
import { VersionCaptureService } from '../../versions/capture/version-capture.service';
import { UtteranceAnalysisStore } from '../core/utterance-analysis.store';
import { planApply } from '../lib/apply-plan';
import type { ApplyPlan, PlanUtterance } from '../lib/apply-plan';

const MAX_EXAMPLES_PER_INTENT = 500;
const NOT_FOUND_MESSAGE = '요청하신 분석을 찾을 수 없습니다.';

interface ResolvedTarget {
  readonly resolution: 'EXISTING' | 'NEW' | 'EXISTING_BY_NAME';
  readonly intentId: string | null;
  readonly intentName: string;
  readonly examples: string[];
}

interface BuiltPlan {
  readonly analysisFileName: string;
  readonly target: ResolvedTarget;
  readonly plan: ApplyPlan;
  readonly foundById: ReadonlyMap<string, PlanUtterance>;
  readonly linkedNodeCount: number | null;
  readonly draftOnly: boolean;
}

function parseExamples(json: string): string[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * ★ **자산 쓰기의 유일한 파일**(No.21 — 설계서 §15, DC-4). `IntentsService` 주입 · `.applyLearningExample(` 호출 ·
 * 번들 무효화(`LearningApplyService`) 호출이 이 파일에만 있다(정적 검사 UA-4 · `asset-write-sealing.spec.ts` S-2 4파일).
 *
 * 자동 반영은 없다 — 관리자가 고른 발화(≤50)를 **확인 화면(미리보기)** 을 거쳐 반영한다. 새 키워드·노드·FAQ·토픽을
 * 만드는 코드는 없다(FR-DC7-7 — 새 의도는 공통(토픽 없음)으로 생성된다, R-9). 건별 부분 성공 + "들어간 것/빠진 것/
 * 실패한 것"을 명시하고(R-18), 반영 직전 자동 스냅샷이 되돌리기 안전망이다.
 */
@Injectable()
export class UtteranceApplyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ChatbotScopeService,
    private readonly intentsService: IntentsService,
    private readonly learningApply: LearningApplyService,
    private readonly versionCapture: VersionCaptureService,
    private readonly store: UtteranceAnalysisStore,
    private readonly auditLog: AuditLogService,
  ) {}

  private toFailure(utteranceId: string, e: unknown): { utteranceId: string; code: ApiErrorCode; message: string } {
    if (e instanceof ApiException) {
      const body = e.getResponse() as ApiExceptionBody;
      return { utteranceId, code: body.code, message: body.message };
    }
    // 예외 message는 담지 않는다 — DB 오류 문구에 문장이 섞일 수 있다(DC-9).
    return { utteranceId, code: 'INTERNAL_ERROR', message: '알 수 없는 오류가 발생했습니다.' };
  }

  /** 미리보기·반영 공통 — 검사 + 계획 계산(DB 변경 0). */
  private async buildPlan(chatbotId: string, analysisId: string, dto: UtteranceApplyRequest): Promise<BuiltPlan> {
    const { prodVersionId } = await this.scope.assertWritable(chatbotId);

    const analysis = await this.prisma.utteranceAnalysis.findFirst({ where: { id: analysisId, chatbotId }, select: { id: true, status: true, fileName: true } });
    if (!analysis) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);
    if (analysis.status !== 'SUCCEEDED') {
      throw new ApiException('INVALID_STATUS_TRANSITION', 409, '완료된 분석만 예문으로 넣을 수 있습니다.');
    }

    // 대상 해석
    let target: ResolvedTarget;
    if (dto.target.kind === 'EXISTING') {
      const intent = await this.prisma.intent.findFirst({ where: { id: dto.target.intentId, chatbotId }, select: { id: true, name: true, examples: true } });
      if (!intent) throw new ApiException('NOT_FOUND', 404, '의도가 없습니다. 다른 의도를 골라 주세요.');
      target = { resolution: 'EXISTING', intentId: intent.id, intentName: intent.name, examples: parseExamples(intent.examples) };
    } else {
      const name = dto.target.intentName.trim();
      const byName = await this.prisma.intent.findFirst({ where: { chatbotId, nameNormalized: normalizeText(name) }, select: { id: true, name: true, examples: true } });
      target = byName
        ? { resolution: 'EXISTING_BY_NAME', intentId: byName.id, intentName: byName.name, examples: parseExamples(byName.examples) }
        : { resolution: 'NEW', intentId: null, intentName: name, examples: [] };
    }

    // 다른 의도의 정규화 예문(대상 의도 제외) — 다른 의도에 이미 있는 문장은 이 경로에서 제외한다(R-5).
    const others = await this.prisma.intent.findMany({
      where: { chatbotId, ...(target.intentId ? { id: { not: target.intentId } } : {}) },
      select: { name: true, examples: true },
    });
    const otherIntentExamples = new Map<string, string>();
    for (const o of others) {
      for (const ex of parseExamples(o.examples)) {
        const key = normalizeText(ex);
        if (key && !otherIntentExamples.has(key)) otherIntentExamples.set(key, o.name);
      }
    }

    const rows = await this.prisma.analyzedUtterance.findMany({ where: { id: { in: dto.utteranceIds }, analysisId } });
    const foundById = new Map<string, PlanUtterance>(
      rows.map((r) => [
        r.id,
        { id: r.id, seq: r.seq, text: r.text, textNormalized: r.textNormalized, hasBannedWord: r.hasBannedWord, hasMaskToken: r.hasMaskToken, applied: r.appliedAt !== null },
      ]),
    );

    const plan = planApply({
      requestedIds: dto.utteranceIds,
      found: foundById,
      targetExamplesNormalized: new Set(target.examples.map((e) => normalizeText(e)).filter((e) => e !== '')),
      targetExampleCount: target.examples.length,
      otherIntentExamples,
      maxChars: UTTERANCE_ANALYSIS_LIMITS.exampleMaxChars,
      maxExamples: MAX_EXAMPLES_PER_INTENT,
    });

    const linkedNodeCount = target.intentId ? await this.prisma.dialogNodeIntent.count({ where: { intentId: target.intentId } }) : null;
    return { analysisFileName: analysis.fileName, target, plan, foundById, linkedNodeCount, draftOnly: prodVersionId !== null };
  }

  /** 반영 계획(§15.2) — DB 변경 0 · 감사 0 · 자산 쓰기 0. */
  async preview(chatbotId: string, analysisId: string, dto: UtteranceApplyRequest): Promise<UtteranceApplyPreviewResponse> {
    const built = await this.buildPlan(chatbotId, analysisId, dto);
    return {
      target: { resolution: built.target.resolution, intentId: built.target.intentId, intentName: built.target.intentName },
      included: built.plan.included.map((i) => ({ utteranceId: i.utteranceId, text: i.text, warnings: [...i.warnings] })),
      excluded: built.plan.excluded.map((e) => ({ ...e })),
      resultingExampleCount: built.plan.resultingExampleCount,
      linkedNodeCount: built.linkedNodeCount,
      draftOnly: built.draftOnly,
    };
  }

  /** 반영(§15.3) — 계획을 다시 계산하고(미리보기 이후 바뀐 상태 반영) 건별로 넣는다. 번들 무효화는 요청당 1회. */
  async apply(chatbotId: string, analysisId: string, dto: UtteranceApplyRequest): Promise<UtteranceApplyResponse> {
    const built = await this.buildPlan(chatbotId, analysisId, dto);
    const { plan, target, draftOnly } = built;
    const excluded = [...plan.excluded.map((e) => ({ ...e }))];

    if (plan.included.length === 0) {
      // 넣을 것이 없다 — 자산·감사·스냅샷 0.
      return {
        succeeded: 0,
        intentId: target.intentId,
        intentName: target.intentName,
        created: false,
        excluded,
        failed: [],
        appliedImmediately: true,
        linkedNodeCount: built.linkedNodeCount ?? 0,
        draftOnly,
      };
    }

    // 자동 스냅샷(fail-open) — 되돌리기 안전망. 새 의도면 targetId 없음.
    const autoSnapshot = await this.versionCapture.captureAuto(chatbotId, 'BEFORE_UTTERANCE_APPLY', {
      ...(target.intentId ? { targetId: target.intentId } : {}),
      itemCount: plan.included.length,
    });

    const actor = this.auditLog.currentActorSnapshot();
    const summaryText = `발화 묶음 분석 예문 반영 (${plan.included.length}건)`;
    const failed: UtteranceApplyResponse['failed'] = [];
    const succeededIntentIds = new Set<string>();
    let succeeded = 0;
    let created = false;
    let resolvedIntentId: string | null = target.intentId;
    let resolvedIntentName = target.intentName;
    let linkedNodeCount = built.linkedNodeCount ?? 0;

    for (const item of plan.included) {
      // 첫 호출이 새 의도를 만들면 이후 대상은 { intentId }로 바꾼다.
      const callTarget = resolvedIntentId ? { intentId: resolvedIntentId } : { intentName: target.intentName };
      try {
        const applied = await this.intentsService.applyLearningExample(chatbotId, callTarget, item.text, { auditSummary: summaryText, deferBundleInvalidate: true });
        if (applied.created) created = true;
        resolvedIntentId = applied.intentId;
        resolvedIntentName = applied.intentName;
        linkedNodeCount = applied.linkedNodeCount;
        succeededIntentIds.add(applied.intentId);

        const marked = await this.store.markApplied(item.utteranceId, analysisId, {
          intentId: applied.intentId,
          intentName: applied.intentName,
          byId: actor?.id ?? null,
          byEmail: actor?.email ?? null,
        });
        if (marked) succeeded += 1;
        else excluded.push({ utteranceId: item.utteranceId, reason: 'ALREADY_APPLIED' }); // 동시 반영 — 예문은 정규화 중복 제거로 이미 하나뿐이다
      } catch (e) {
        failed.push(this.toFailure(item.utteranceId, e));
      }
    }

    // ★ 요청당 정확히 1회 — 성공(예문이 들어간) 건이 있을 때만 호출한다(No.15·증강 승인과 같은 규약).
    let appliedImmediately = true;
    if (succeededIntentIds.size > 0) {
      const result = await this.learningApply.applyLearning({
        chatbotId,
        intentIds: [...succeededIntentIds],
        reason: 'UTTERANCE_ANALYSIS_APPLY',
        resolvedCount: succeeded,
      });
      appliedImmediately = result.appliedImmediately;
    }

    await this.store.refreshAppliedCounts(analysisId);

    if (succeeded > 0) {
      const excludedByReason: Partial<Record<UtteranceApplyExcludeReason, number>> = {};
      for (const e of excluded) excludedByReason[e.reason] = (excludedByReason[e.reason] ?? 0) + 1;
      await this.auditLog.record({
        action: 'UPDATE',
        targetType: 'UtteranceAnalysis',
        targetId: analysisId,
        targetName: `분석 ${analysisId.slice(0, 8)}`,
        chatbotId,
        after: { intentId: resolvedIntentId, created, appliedCount: succeeded, excludedByReason },
        summary: `발화 묶음 분석 예문 반영(${succeeded}건)`,
      });
    }

    return {
      succeeded,
      intentId: resolvedIntentId,
      intentName: resolvedIntentName,
      created,
      excluded,
      failed,
      appliedImmediately,
      linkedNodeCount,
      draftOnly,
      autoSnapshot,
    };
  }
}
