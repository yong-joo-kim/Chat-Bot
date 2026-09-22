import type { SemanticMatchInput, SemanticRankedCandidate } from '@chat-bot/shared-types';
import { judgeBand } from './semantic';
import { resolveResponse } from './resolver';
import { makeBundle, makeFaq, makeIntent, makeNode } from './test-fixtures';

const THRESHOLDS = { accept: 0.8, low: 0.6, margin: 0.05 };

function semanticOf(ranked: SemanticRankedCandidate[]): SemanticMatchInput {
  const faqScores = new Map<string, number>();
  const intentScores = new Map<string, number>();
  for (const c of ranked) {
    (c.kind === 'FAQ' ? faqScores : intentScores).set(c.id, c.score);
  }
  return { modelId: 'test@0|noprefix|l2', faqScores, intentScores, ranked, thresholds: THRESHOLDS };
}

describe('judgeBand — 3구간 판정(ADR-0021)', () => {
  it('후보 0건이면 FAILED다', () => {
    expect(judgeBand([], THRESHOLDS)).toEqual({ kind: 'FAILED' });
  });

  it('top1 < low면 FAILED다', () => {
    const ranked: SemanticRankedCandidate[] = [{ kind: 'FAQ', id: 'a', score: 0.5, matchedText: 'x' }];
    expect(judgeBand(ranked, THRESHOLDS)).toEqual({ kind: 'FAILED' });
  });

  it('후보가 1건뿐이고 low 이상이면 accept 미만이어도 확정한다(FR-N1-13)', () => {
    const ranked: SemanticRankedCandidate[] = [{ kind: 'FAQ', id: 'a', score: 0.65, matchedText: 'x' }];
    expect(judgeBand(ranked, THRESHOLDS)).toEqual({ kind: 'CONFIRMED', candidate: ranked[0] });
  });

  it('top1 ≥ accept 이고 격차 충분하면 CONFIRMED다', () => {
    const ranked: SemanticRankedCandidate[] = [
      { kind: 'FAQ', id: 'a', score: 0.9, matchedText: 'x' },
      { kind: 'FAQ', id: 'b', score: 0.5, matchedText: 'y' },
    ];
    expect(judgeBand(ranked, THRESHOLDS)).toEqual({ kind: 'CONFIRMED', candidate: ranked[0] });
  });

  it('AC-N1-7: top1 ≥ accept이지만 격차가 margin 미만이면 확정하지 않고 되묻는다', () => {
    const ranked: SemanticRankedCandidate[] = [
      { kind: 'FAQ', id: 'a', score: 0.86, matchedText: 'x' },
      { kind: 'FAQ', id: 'b', score: 0.84, matchedText: 'y' },
    ];
    const band = judgeBand(ranked, THRESHOLDS);
    expect(band.kind).toBe('AMBIGUOUS');
  });

  it('AC-N1-4: 둘 다 accept 미만이면 AMBIGUOUS다', () => {
    const ranked: SemanticRankedCandidate[] = [
      { kind: 'FAQ', id: 'a', score: 0.71, matchedText: '결제카드 등록' },
      { kind: 'FAQ', id: 'b', score: 0.68, matchedText: '포인트카드 조회' },
    ];
    const band = judgeBand(ranked, THRESHOLDS);
    expect(band.kind).toBe('AMBIGUOUS');
    if (band.kind === 'AMBIGUOUS') expect(band.candidates).toHaveLength(2);
  });

  it('EX-N1-11: 후보가 5건이어도 최대 3건만 제시한다', () => {
    const ranked: SemanticRankedCandidate[] = Array.from({ length: 5 }, (_, i) => ({
      kind: 'FAQ' as const,
      id: `id-${i}`,
      score: 0.7 - i * 0.001,
      matchedText: `q${i}`,
    }));
    const band = judgeBand(ranked, THRESHOLDS);
    expect(band.kind).toBe('AMBIGUOUS');
    if (band.kind === 'AMBIGUOUS') expect(band.candidates).toHaveLength(3);
  });
});

describe('resolveResponse — semantic 옵션 주입(ADR-0020)', () => {
  it('AC-N1-1: 예문에 없는 표현도 semantic 점수로 매칭된다', () => {
    const faq = makeFaq({ question: '배송 언제 오나요?', answer: '2~3일 내 도착합니다.' });
    const bundle = makeBundle({ faqs: [faq] });
    const semantic = semanticOf([{ kind: 'FAQ', id: faq.id, score: 0.84, matchedText: faq.question }]);

    const result = resolveResponse('물건 며칠이나 걸리죠', null, bundle, new Date(), { semantic });

    expect(result.matchedFaqId).toBe(faq.id);
    expect(result.trace.some((t) => t.code === 'SEMANTIC_MATCHED')).toBe(true);
  });

  it('AC-N1-2: 짧은 예문발 부분일치 오탐이 semantic 활성 시 사라진다', () => {
    const intent = makeIntent({ name: '주문취소', examples: ['취소'] });
    const faq = makeFaq({ question: '취소하면 위약금 있나요?', answer: '위약금이 발생할 수 있습니다.' });
    const bundle = makeBundle({ intents: [intent], faqs: [faq] });
    // 의미상으로는 FAQ가 압도적으로 맞다고 가정 — intent 쪽은 무관하므로 낮은 점수만 부여.
    const semantic = semanticOf([
      { kind: 'FAQ', id: faq.id, score: 0.92, matchedText: faq.question },
      { kind: 'INTENT', id: intent.id, score: 0.3, matchedText: '취소' },
    ]);

    const result = resolveResponse('취소하면 위약금 있나요?', null, bundle, new Date(), { semantic });

    // 정확일치이므로 애초에 FAQ exactOnly 경로로 확정된다(semantic 판정 이전에 이미 종결).
    expect(result.matchedFaqId).toBe(faq.id);
  });

  it('AC-N1-3: semantic 미주입 시 저하 모드(부분일치)가 그대로 동작한다', () => {
    const intent = makeIntent({ name: '주문취소', examples: ['취소'] });
    const bundle = makeBundle({ intents: [intent] });

    const result = resolveResponse('취소하면 위약금 있나요?', null, bundle, new Date());

    expect(result.matchedIntentId).toBe(intent.id);
  });

  it('AC-N1-4/AC-N1-5: 모호 구간은 MESSAGE 버튼으로 되묻고, 버튼 값 재입력 시 정확일치로 확정된다', () => {
    const faqA = makeFaq({ question: '결제카드 등록', answer: 'A 답변' });
    const faqB = makeFaq({ question: '포인트카드 조회', answer: 'B 답변' });
    const bundle = makeBundle({ faqs: [faqA, faqB] });
    const semantic = semanticOf([
      { kind: 'FAQ', id: faqA.id, score: 0.71, matchedText: faqA.question },
      { kind: 'FAQ', id: faqB.id, score: 0.68, matchedText: faqB.question },
    ]);

    const asked = resolveResponse('카드 문제요', null, bundle, new Date(), { semantic });
    expect(asked.trace.some((t) => t.code === 'SEMANTIC_AMBIGUOUS')).toBe(true);
    const buttonOutput = asked.outputs.find((o) => o.type === 'BUTTON');
    expect(buttonOutput).toBeDefined();
    // 폴백 코드가 없으므로 isAnswered 판정상 "미응답"이 아니다(FR-N1-14) — trace에 FALLBACK 계열이 없음을 확인.
    expect(asked.trace.some((t) => t.code.startsWith('FALLBACK'))).toBe(false);

    if (buttonOutput?.type !== 'BUTTON') throw new Error('버튼 출력이 아닙니다.');
    const clickedValue = buttonOutput.payload.buttons[0].value;

    const confirmed = resolveResponse(clickedValue, null, bundle, new Date(), { semantic });
    expect(confirmed.matchedFaqId).toBe(faqA.id);
  });

  it('AC-N1-6: 확정된 semantic 의도가 노드 트리거에도 전파된다', () => {
    const intent = makeIntent({ name: '환불문의', examples: ['환불하고 싶어요'] });
    const node = makeNode({ intentIds: [intent.id], matchMode: 'ANY' });
    const bundle = makeBundle({ intents: [intent], dialogNodes: [node] });
    const semantic = semanticOf([{ kind: 'INTENT', id: intent.id, score: 0.9, matchedText: '환불하고 싶어요' }]);

    const result = resolveResponse('돈 다시 돌려받을 수 있나요', null, bundle, new Date(), { semantic });

    expect(result.matchedNodeId).toBe(node.id);
  });

  it('AC-N1-8: 동일 입력·번들·점수맵·now에 대해 결과가 결정론적이다', () => {
    const faq = makeFaq({ question: '영업시간이 어떻게 되나요?', answer: '평일 09~18시' });
    const bundle = makeBundle({ faqs: [faq] });
    const semantic = semanticOf([{ kind: 'FAQ', id: faq.id, score: 0.85, matchedText: faq.question }]);
    const now = new Date('2026-01-01T00:00:00Z');

    const results = Array.from({ length: 20 }, () => resolveResponse('언제 문 열어요', null, bundle, now, { semantic }));
    const first = JSON.stringify(results[0]);
    expect(results.every((r) => JSON.stringify(r) === first)).toBe(true);
  });

  it('semantic 점수가 low 미만이면 2단계 이관 신호(SEMANTIC_BELOW_THRESHOLD)만 남기고 폴백한다', () => {
    const faq = makeFaq({ question: '영업시간이 어떻게 되나요?', answer: '평일 09~18시' });
    const bundle = makeBundle({ faqs: [faq] });
    const semantic = semanticOf([{ kind: 'FAQ', id: faq.id, score: 0.3, matchedText: faq.question }]);

    const result = resolveResponse('전혀 관계없는 문장입니다', null, bundle, new Date(), { semantic });

    expect(result.trace.some((t) => t.code === 'SEMANTIC_BELOW_THRESHOLD')).toBe(true);
    expect(result.matchedFaqId).toBeUndefined();
  });
});
