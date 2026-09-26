import { Injectable } from '@nestjs/common';
import type { WorkflowSubscriptionEventType, WorkflowTargetPickerItem } from '@chat-bot/shared-types';
import type { DesignValidationWorkflowTargetInfo } from '@chat-bot/dialogue-engine';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkflowSecretResolver } from '../secrets/workflow-secret.resolver';
import { WorkflowSubscriptionCache } from './lib/subscription-cache';
import type { CachedSubscription } from './lib/subscription-cache';

export interface EnqueueTargetInfo {
  id: string;
  name: string;
  enabled: boolean;
  paused: boolean;
  allowRawPersonalData: boolean;
  secretsOk: boolean;
}

/**
 * [신규 No.41] 읽기 전용 카탈로그(출구 없음) — 노드 편집기 picker · 적재용 대상 조회 · 설계 점검/
 * 시뮬레이터 정보 · 구독 캐시(get/invalidate)만 제공한다. 발송·상태 전이·비밀 값 반환은 하지 않는다.
 */
@Injectable()
export class WorkflowCatalogService {
  private readonly subscriptionCache = new WorkflowSubscriptionCache();

  constructor(
    private readonly prisma: PrismaService,
    private readonly secretResolver: WorkflowSecretResolver,
  ) {}

  private secretsOk(target: {
    authType: string;
    secretRef: string | null;
    signingEnabled: boolean;
    signingSecretRef: string | null;
    urlSecretRef: string | null;
  }): boolean {
    const authOk = target.authType === 'NONE' || (!!target.secretRef && this.secretResolver.get(target.secretRef) !== null);
    const signingOk = !target.signingEnabled || (!!target.signingSecretRef && this.secretResolver.get(target.signingSecretRef) !== null);
    const urlOk = !target.urlSecretRef || this.secretResolver.get(target.urlSecretRef) !== null;
    return authOk && signingOk && urlOk;
  }

  /** 노드 편집기·구독 선택 목록(`dialogue:read`) — 주소·비밀 참조 없음(FR-WF1-1). */
  async picker(): Promise<WorkflowTargetPickerItem[]> {
    const rows = await this.prisma.workflowTarget.findMany({
      select: { id: true, name: true, enabled: true, pausedAt: true, allowRawPersonalData: true },
      orderBy: { name: 'asc' },
      take: 200,
    });
    return rows.map((r) => ({ id: r.id, name: r.name, enabled: r.enabled, paused: !!r.pausedAt, ready: r.enabled && !r.pausedAt, allowRawPersonalData: r.allowRawPersonalData }));
  }

  /** 노드 방출 적재(§6.1 step 2) — 방출된 targetId 집합을 1회 조회한다. */
  async findForEnqueue(targetIds: readonly string[]): Promise<Map<string, EnqueueTargetInfo>> {
    if (targetIds.length === 0) return new Map();
    const rows = await this.prisma.workflowTarget.findMany({
      where: { id: { in: [...new Set(targetIds)] } },
      select: {
        id: true,
        name: true,
        enabled: true,
        pausedAt: true,
        allowRawPersonalData: true,
        authType: true,
        secretRef: true,
        signingEnabled: true,
        signingSecretRef: true,
        urlSecretRef: true,
      },
    });
    return new Map(
      rows.map((r) => [
        r.id,
        { id: r.id, name: r.name, enabled: r.enabled, paused: !!r.pausedAt, allowRawPersonalData: r.allowRawPersonalData, secretsOk: this.secretsOk(r) },
      ]),
    );
  }

  /** 설계 점검 컨텍스트(§5.7) — `DialogNodesService.validate()`가 `WORKFLOW`가 있을 때만 1회 조회한다. */
  async designInfo(targetIds: readonly string[]): Promise<Map<string, DesignValidationWorkflowTargetInfo>> {
    const found = await this.findForEnqueue(targetIds);
    const result = new Map<string, DesignValidationWorkflowTargetInfo>();
    for (const [id, t] of found) {
      result.set(id, { name: t.name, enabled: t.enabled, paused: t.paused, secretsOk: t.secretsOk, allowRawPersonalData: t.allowRawPersonalData });
    }
    return result;
  }

  /** 구독 캐시 — 적중 시 DB 0쿼리(§6.3). */
  async getSubscriptions(chatbotId: string, eventType: WorkflowSubscriptionEventType, now: Date): Promise<CachedSubscription[]> {
    if (this.subscriptionCache.isStale(now)) await this.refreshSubscriptionCache(now);
    return this.subscriptionCache.get(chatbotId, eventType);
  }

  invalidateSubscriptionCache(): void {
    this.subscriptionCache.invalidate();
  }

  private async refreshSubscriptionCache(now: Date): Promise<void> {
    // [코드 리뷰 R1 H-1] 챗봇 이름을 같은 1쿼리에 함께 적재한다(§6.3 — 조회 수 불변).
    const rows = await this.prisma.workflowSubscription.findMany({
      where: { enabled: true },
      select: {
        id: true,
        chatbotId: true,
        eventType: true,
        targetId: true,
        conditions: true,
        pausedAt: true,
        target: { select: { name: true, enabled: true, pausedAt: true } },
        chatbot: { select: { name: true } },
      },
    });
    this.subscriptionCache.setSnapshot(
      rows.map((r) => ({
        id: r.id,
        chatbotId: r.chatbotId,
        chatbotName: r.chatbot.name,
        eventType: r.eventType as WorkflowSubscriptionEventType,
        targetId: r.targetId,
        targetName: r.target.name,
        targetEnabled: r.target.enabled,
        targetPaused: !!r.target.pausedAt || !!r.pausedAt,
        conditions: safeParseConditions(r.conditions),
      })),
      now,
    );
  }
}

function safeParseConditions(json: string): { threshold?: number; includeStructuredAnswers?: boolean } {
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
