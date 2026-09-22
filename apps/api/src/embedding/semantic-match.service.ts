import { Injectable } from '@nestjs/common';
import type { DialogueBundle, MatchingThresholds, SemanticMatchInput, SemanticRankedCandidate } from '@chat-bot/shared-types';
import { QueryEmbeddingService } from './query-embedding.service';
import { VectorCacheService } from './vector-cache.service';
import { cosineSimilarity } from './lib/cosine';

interface BestCandidate {
  score: number;
  ownerType: string;
  slotIndex: number;
}

/**
 * 1단계 점수 맵 조립(§3 파이프라인 ③④, ADR-0020) — `apps/api`가 턴마다 계산해
 * `ResolveOptions.semantic`으로 주입하는 값을 만든다. 엔진은 이 결과를 읽기만 한다.
 * 질의 임베딩은 턴당 정확히 1회이며(NFR-P7), 그 벡터를 FAQ·의도 두 점수 맵에 공유한다.
 */
@Injectable()
export class SemanticMatchService {
  constructor(
    private readonly queryEmbedding: QueryEmbeddingService,
    private readonly vectorCache: VectorCacheService,
  ) {}

  /**
   * `semanticEnabled=false`이거나 임베딩/색인이 준비되지 않았으면 `undefined`를 반환한다 —
   * 그 경우 엔진은 `semantic` 미주입 상태(저하 모드)로 동작한다(FR-0-44).
   */
  async score(chatbotId: string, text: string, bundle: DialogueBundle, thresholds: MatchingThresholds): Promise<SemanticMatchInput | undefined> {
    const embedded = await this.queryEmbedding.embed(text);
    if (!embedded) return undefined;

    const vectors = await this.vectorCache.get(chatbotId, embedded.modelId);
    if (!vectors || vectors.entries.length === 0) return undefined;
    if (embedded.vector.length !== embedded.dimension) return undefined;

    const faqBest = new Map<string, BestCandidate>();
    const intentBest = new Map<string, BestCandidate>();
    for (const entry of vectors.entries) {
      if (entry.vector.length !== embedded.vector.length) continue; // 차원 불일치 벡터는 조용히 건너뜀(staleModel)
      const score = cosineSimilarity(embedded.vector, entry.vector);
      const isFaq = entry.ownerType === 'FAQ_QUESTION' || entry.ownerType === 'FAQ_ALT';
      const map = isFaq ? faqBest : intentBest;
      const prev = map.get(entry.ownerId);
      if (!prev || score > prev.score) {
        map.set(entry.ownerId, { score, ownerType: entry.ownerType, slotIndex: entry.slotIndex });
      }
    }

    const ranked: SemanticRankedCandidate[] = [];
    const faqScores = new Map<string, number>();
    for (const [faqId, best] of faqBest) {
      const faq = bundle.faqs.find((f) => f.id === faqId && f.enabled !== false);
      if (!faq) continue; // 색인이 가리키는 FAQ가 비활성/삭제됨(AC-N1-16과 대칭)
      faqScores.set(faqId, best.score);
      const matchedText = best.ownerType === 'FAQ_ALT' ? (faq.altQuestions?.[best.slotIndex] ?? faq.question) : faq.question;
      ranked.push({ kind: 'FAQ', id: faqId, score: best.score, matchedText });
    }
    const intentScores = new Map<string, number>();
    for (const [intentId, best] of intentBest) {
      const intent = bundle.intents.find((i) => i.id === intentId);
      if (!intent) continue;
      intentScores.set(intentId, best.score);
      const matchedText = best.ownerType === 'INTENT_EXAMPLE' ? (intent.examples?.[best.slotIndex] ?? intent.name) : intent.name;
      ranked.push({ kind: 'INTENT', id: intentId, score: best.score, matchedText });
    }

    if (ranked.length === 0) return undefined;

    // 결정론적 타이브레이크(FR-N1-10) — 점수 내림차순, 동점 시 FAQ → INTENT, 같은 종류 내 id asc.
    ranked.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.kind !== b.kind) return a.kind === 'FAQ' ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    return { modelId: embedded.modelId, faqScores, intentScores, ranked, thresholds };
  }
}
