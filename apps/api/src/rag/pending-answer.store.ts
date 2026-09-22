import { Injectable, Logger } from '@nestjs/common';
import type { DialogOutput, PendingAnswerSource } from '@chat-bot/shared-types';

export interface PendingAnswerResult {
  status: 'READY' | 'FAILED';
  outputs?: DialogOutput[];
  sources?: PendingAnswerSource[];
}

export interface PendingAnswerSnapshot {
  status: 'PENDING' | 'READY' | 'FAILED';
  outputs?: DialogOutput[];
  sources?: PendingAnswerSource[];
}

/**
 * 보류 답변 저장소 인터페이스(FR-N2-37, ADR-0023) — TTL 기반 서버 상태. 단일 인스턴스 전제이며
 * 다중 인스턴스 전환 시 교체 지점은 이 인터페이스의 구현체 1곳이다.
 */
export interface PendingAnswerStore {
  create(id: string, meta: { chatbotId: string; slug: string; expiresAt: Date }): void;
  complete(id: string, result: PendingAnswerResult): void;
  /** 슬러그 불일치는 `null`(=404, AC-N2-18). TTL 만료도 `null`(=404, AC-N2-19)이며 항목을 제거한다. */
  get(id: string, slug: string): PendingAnswerSnapshot | null;
}

interface StoredEntry {
  chatbotId: string;
  slug: string;
  status: 'PENDING' | 'READY' | 'FAILED';
  outputs?: DialogOutput[];
  sources?: PendingAnswerSource[];
  expiresAt: number;
  /** `READY`/`FAILED` 최초 조회 시각 — 그 뒤 30초 유예 후 제거한다(재시도는 허용, 무한 재조회는 차단). */
  firstReadAt?: number;
}

const READY_READ_GRACE_MS = 30_000;

/** 1차 구현 — `Map` + TTL 스위퍼(§9.8). 서버 재시작으로 소실돼도 폴링은 `404`로 정리된다(EX-N2-12). */
@Injectable()
export class InMemoryPendingAnswerStore implements PendingAnswerStore {
  private readonly logger = new Logger('InMemoryPendingAnswerStore');
  private readonly store = new Map<string, StoredEntry>();
  private readonly sweeper: ReturnType<typeof setInterval>;

  constructor() {
    this.sweeper = setInterval(() => this.sweep(), 60_000);
    this.sweeper.unref?.();
  }

  create(id: string, meta: { chatbotId: string; slug: string; expiresAt: Date }): void {
    this.store.set(id, { chatbotId: meta.chatbotId, slug: meta.slug, status: 'PENDING', expiresAt: meta.expiresAt.getTime() });
  }

  complete(id: string, result: PendingAnswerResult): void {
    const entry = this.store.get(id);
    if (!entry) {
      this.logger.warn(`완료 처리 대상 보류 답변을 찾을 수 없습니다(만료/재시작 가능성): id=${id}`);
      return;
    }
    entry.status = result.status;
    entry.outputs = result.outputs;
    entry.sources = result.sources;
  }

  get(id: string, slug: string): PendingAnswerSnapshot | null {
    const entry = this.store.get(id);
    if (!entry) return null;
    if (entry.slug !== slug) return null;

    if (Date.now() > entry.expiresAt) {
      this.store.delete(id);
      return null;
    }

    if (entry.status !== 'PENDING') {
      if (entry.firstReadAt === undefined) {
        entry.firstReadAt = Date.now();
      } else if (Date.now() - entry.firstReadAt > READY_READ_GRACE_MS) {
        this.store.delete(id);
        return null;
      }
    }

    return { status: entry.status, outputs: entry.outputs, sources: entry.sources };
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, entry] of this.store) {
      const graceExpired = entry.firstReadAt !== undefined && now - entry.firstReadAt > READY_READ_GRACE_MS;
      if (now > entry.expiresAt || graceExpired) this.store.delete(id);
    }
  }
}
