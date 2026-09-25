import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ChatbotAnswerSetting, ChatbotSnapshotProfile, DialogueBundle } from '@chat-bot/shared-types';
import type { SemanticSlot } from '../../embedding/lib/semantic-slots';

export interface VersionCore {
  chatbotId: string;
  versionId: string;
  versionNo: number;
  contentHash: string;
  createdAt: Date;
  /** 설문 없는 번들(토픽 필터 전) — `composeServingBundle`이 현재 설문·토픽 필터를 얹는다. */
  bundle: DialogueBundle;
  answerSetting: ChatbotAnswerSetting;
  profile: ChatbotSnapshotProfile;
  legacyTiebreak: boolean;
  slots: SemanticSlot[];
}

/**
 * [신규 No.40] L1 코어 캐시(§7.3) — `versionId → VersionCore`. 본문 불변이므로 TTL 없음, LRU만.
 * 초안 캐시(`DialogueBundleService`)와 인스턴스가 완전히 분리된다.
 */
@Injectable()
export class VersionCoreCache {
  private readonly store = new Map<string, VersionCore>();

  constructor(private readonly config: ConfigService) {}

  private maxSize(): number {
    return this.config.get<number>('ENV_VERSION_BUNDLE_CACHE_MAX') ?? 50;
  }

  get(versionId: string): VersionCore | undefined {
    const hit = this.store.get(versionId);
    if (!hit) return undefined;
    // LRU: 최근 사용을 맨 뒤로.
    this.store.delete(versionId);
    this.store.set(versionId, hit);
    return hit;
  }

  set(versionId: string, core: VersionCore): void {
    this.store.delete(versionId);
    this.store.set(versionId, core);
    const max = this.maxSize();
    while (this.store.size > max) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey === undefined) break;
      this.store.delete(oldestKey);
    }
  }

  /** 버전 삭제·모드 끄기 시 제거. */
  invalidate(versionId: string): void {
    this.store.delete(versionId);
  }

  invalidateChatbot(chatbotId: string): void {
    for (const [key, core] of this.store) {
      if (core.chatbotId === chatbotId) this.store.delete(key);
    }
  }
}
