import type { WorkflowSubscriptionEventType } from '@chat-bot/shared-types';

/**
 * [신규 No.41] 전 챗봇 구독 스냅샷 TTL 캐시 — 순수(주입 시계, §6.3). `WorkflowCatalogService`가
 * 1쿼리로 채운 스냅샷을 보관한다. 캐시 적중 시 DB 0쿼리(FR-WF3-4 · AC-WF1-1).
 */
export interface CachedSubscription {
  id: string;
  targetId: string;
  targetName: string;
  targetEnabled: boolean;
  targetPaused: boolean;
  /** [코드 리뷰 R1 H-1] 봉투 조립 시점에 원천 이벤트가 챗봇 이름을 갖고 있지 않아 이 스냅샷에서 채운다. */
  chatbotName: string;
  conditions: { threshold?: number; includeStructuredAnswers?: boolean };
}

export interface SubscriptionSnapshotRow {
  id: string;
  chatbotId: string;
  chatbotName: string;
  eventType: WorkflowSubscriptionEventType;
  targetId: string;
  targetName: string;
  targetEnabled: boolean;
  targetPaused: boolean;
  conditions: { threshold?: number; includeStructuredAnswers?: boolean };
}

const DEFAULT_TTL_MS = 30_000;

export class WorkflowSubscriptionCache {
  private snapshot: Map<string, Map<WorkflowSubscriptionEventType, CachedSubscription[]>> = new Map();
  private loadedAt: number | null = null;

  constructor(private readonly ttlMs: number = DEFAULT_TTL_MS) {}

  /** 캐시가 없거나 TTL이 지났으면 true(호출부가 재적재해야 한다). */
  isStale(now: Date): boolean {
    return this.loadedAt === null || now.getTime() - this.loadedAt > this.ttlMs;
  }

  setSnapshot(rows: readonly SubscriptionSnapshotRow[], now: Date): void {
    const map = new Map<string, Map<WorkflowSubscriptionEventType, CachedSubscription[]>>();
    for (const row of rows) {
      let byEvent = map.get(row.chatbotId);
      if (!byEvent) {
        byEvent = new Map();
        map.set(row.chatbotId, byEvent);
      }
      const list = byEvent.get(row.eventType) ?? [];
      list.push({
        id: row.id,
        targetId: row.targetId,
        targetName: row.targetName,
        targetEnabled: row.targetEnabled,
        targetPaused: row.targetPaused,
        chatbotName: row.chatbotName,
        conditions: row.conditions,
      });
      byEvent.set(row.eventType, list);
    }
    this.snapshot = map;
    this.loadedAt = now.getTime();
  }

  get(chatbotId: string, eventType: WorkflowSubscriptionEventType): CachedSubscription[] {
    return this.snapshot.get(chatbotId)?.get(eventType) ?? [];
  }

  hasAny(chatbotId: string, eventType: WorkflowSubscriptionEventType): boolean {
    return this.get(chatbotId, eventType).length > 0;
  }

  /** 저장 시 즉시 무효화(같은 인스턴스는 다음 접근에서 재적재 — §6.3). */
  invalidate(): void {
    this.loadedAt = null;
  }
}
