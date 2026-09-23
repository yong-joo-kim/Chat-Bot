import type { DialogueBundle, MatchingThresholds, SemanticMatchInput, SemanticRankedCandidate } from '@chat-bot/shared-types';
import { cosineSimilarity } from './cosine';

export interface AssembleVectorEntry {
  ownerType: string;
  ownerId: string;
  slotIndex: number;
  vector: Float32Array;
}

interface BestCandidate {
  score: number;
  ownerType: string;
  slotIndex: number;
}

/**
 * 1단계 점수 맵 조립 순수 함수(§7.1, ADR-0030) — 원래 `SemanticMatchService.score()` 안에 있던
 * "질의 벡터 vs 저장 벡터 → 코사인 → 랭킹 조립" 블록을 추출했다(동작 변경 0, 기존 테스트 무수정
 * 통과). 검증/품질 고도화(No.19/20)의 대량 실행기가 **같은 함수**를 실행 로컬 벡터로 호출한다 —
 * 랭킹·타이브레이크 규칙이 두 벌이 되면 "시뮬레이터와 TC의 판정이 다르다"가 발생하기 때문이다(NFR-VM2).
 * DB·Nest 무의존 순수 함수다.
 */
export function assembleSemanticInput(
  queryVector: Float32Array,
  vectors: readonly AssembleVectorEntry[],
  bundle: Pick<DialogueBundle, 'faqs' | 'intents'>,
  thresholds: MatchingThresholds,
  modelId: string,
): SemanticMatchInput | undefined {
  const faqBest = new Map<string, BestCandidate>();
  const intentBest = new Map<string, BestCandidate>();
  for (const entry of vectors) {
    if (entry.vector.length !== queryVector.length) continue; // 차원 불일치 벡터는 조용히 건너뜀(staleModel)
    const score = cosineSimilarity(queryVector, entry.vector);
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

  return { modelId, faqScores, intentScores, ranked, thresholds };
}
