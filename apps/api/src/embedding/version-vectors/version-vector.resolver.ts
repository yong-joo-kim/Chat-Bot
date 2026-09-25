import { Injectable } from '@nestjs/common';
import type { AssembleVectorEntry } from '../lib/assemble-semantic-input';
import type { SemanticSlot } from '../lib/semantic-slots';
import { VectorCacheService } from '../vector-cache.service';
import { TextVectorCacheService } from '../text-vector/text-vector.cache';

export interface VersionVectorResolution {
  entries: AssembleVectorEntry[];
  missing: number;
}

/**
 * [신규 No.40] 버전 슬롯 → 조립 벡터(C-2, §8.2) — "보존 저장소 ∪ 같은 textHash의 초안 벡터"로
 * 조립한다. 초안 편집·삭제·재색인과 무관하게 버전 점수가 고정된다(AC-EN3-1). 추가 임베딩 호출 0.
 */
@Injectable()
export class VersionVectorResolver {
  constructor(
    private readonly vectorCache: VectorCacheService,
    private readonly textVectorCache: TextVectorCacheService,
  ) {}

  async resolve(chatbotId: string, modelId: string, slots: readonly SemanticSlot[]): Promise<VersionVectorResolution> {
    const [draft, store] = await Promise.all([this.vectorCache.get(chatbotId, modelId), this.textVectorCache.get(chatbotId, modelId)]);

    const draftByHash = new Map<string, Float32Array>();
    if (draft) {
      for (const entry of draft.entries) {
        if (entry.textHash && !draftByHash.has(entry.textHash)) draftByHash.set(entry.textHash, entry.vector);
      }
    }

    const entries: AssembleVectorEntry[] = [];
    let missing = 0;
    for (const slot of slots) {
      const vector = store.byHash.get(slot.textHash) ?? draftByHash.get(slot.textHash);
      if (vector) {
        entries.push({ ownerType: slot.ownerType, ownerId: slot.ownerId, slotIndex: slot.slotIndex, vector });
      } else {
        missing += 1;
      }
    }
    return { entries, missing };
  }
}
