import { resolveResponse } from './resolver';
import { buildDialogueIndex } from './dialogue-index';
import { makeBundle, makeFaq, makeIntent, makeKeyword, makeNode, textOutput } from './test-fixtures';
import type { DialogueBundle, Intent, Keyword, DialogNode, FaqEntry } from '@chat-bot/shared-types';

const NOW = new Date('2026-01-01T00:00:00Z');

/**
 * M4(code-reviewer 리뷰) 성능 테스트 공백 보강.
 *
 * `resolver.spec.ts`의 기존 'AC-E-12' 케이스는 의도 200건/예문 20건(4,000예문)·FAQ 300건·노드 0건
 * 규모로 "100회 총합 2초 이내"만 검증해, `docs/requirements/dialogue-design.md` FR-E-10/NFR-P3와
 * ADR-0008이 명시한 실제 설계 규모(의도 1,000×예문 20,000 / 노드 500 / FAQ 2,000)를 커버하지 못했다.
 * 이 파일은 그 규모를 그대로 재현해 **개별 호출의 P95**를 측정한다(기존 파일은 그대로 두고 보강분만 추가).
 */

const SCALE = {
  intentCount: 1000,
  examplesPerIntent: 20, // 1000 × 20 = 20,000예문
  nodeCount: 500,
  faqCount: 2000,
  keywordCount: 50,
};

function buildLargeScaleBundle(): DialogueBundle {
  const intents: Intent[] = Array.from({ length: SCALE.intentCount }, (_, i) =>
    makeIntent({
      name: `설계규모의도-${i}`,
      examples: Array.from({ length: SCALE.examplesPerIntent }, (_, j) => `설계규모 예문 ${i}-${j}`),
    }),
  );

  const keywords: Keyword[] = Array.from({ length: SCALE.keywordCount }, (_, i) =>
    makeKeyword({ name: `설계규모키워드-${i}`, synonyms: [`동의어${i}-1`, `동의어${i}-2`] }),
  );

  const faqs: FaqEntry[] = Array.from({ length: SCALE.faqCount }, (_, i) =>
    makeFaq({ question: `설계규모 FAQ 질문 ${i}`, answer: `설계규모 FAQ 답변 ${i}` }),
  );

  // 노드는 의도 전 구간에 고르게 분산 참조한다(FR-5-8 우선순위 타이브레이크까지 실제 평가 비용에 반영).
  const nodes: DialogNode[] = Array.from({ length: SCALE.nodeCount }, (_, i) => {
    const intentIdx = i % SCALE.intentCount;
    const keywordIdx = i % SCALE.keywordCount;
    return makeNode({
      name: `설계규모노드-${i}`,
      priority: 100 + (i % 10),
      intentIds: [intents[intentIdx].id],
      keywordIds: i % 5 === 0 ? [keywords[keywordIdx].id] : [],
      outputs: [textOutput(`설계규모 응답 ${i}`)],
    });
  });

  const fallbackNode = makeNode({
    name: '설계규모폴백',
    nodeType: 'FALLBACK',
    intentIds: [],
    keywordIds: [],
    outputs: [textOutput('죄송해요, 이해하지 못했어요.')],
  });

  return makeBundle({ intents, keywords, faqs, dialogNodes: [...nodes, fallbackNode] });
}

function percentile(samplesMs: number[], p: number): number {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

describe('resolveResponse 성능(NFR-P3, FR-E-10, AC-E-12 — 설계 규모)', () => {
  const bundle = buildLargeScaleBundle();
  const index = buildDialogueIndex(bundle);

  // 파이프라인의 서로 다른 단계(S1 노드 매칭 즉시 히트 / S4 FAQ 매칭 / S6 완전 폴백)를 모두 섞어
  // "가장 유리한 경로"만 측정하는 착시를 피한다.
  function sampleInputs(): string[] {
    const nodeHitInputs = Array.from({ length: 40 }, (_, i) => `설계규모 예문 ${i * 20}-3`); // 노드 매칭 히트
    const faqHitInputs = Array.from({ length: 30 }, (_, i) => `설계규모 FAQ 질문 ${i * 30}`); // FAQ 매칭 히트
    const fallbackInputs = Array.from({ length: 30 }, (_, i) => `완전히 매칭되지 않는 입력 ${i}`); // 전체 폴백(최악 경로)
    return [...nodeHitInputs, ...faqHitInputs, ...fallbackInputs];
  }

  it('AC-E-12: 의도 1,000×예문 20,000 / 노드 500 / FAQ 2,000 규모에서 개별 호출 P95가 200ms 이내다(인덱스 재사용)', () => {
    const inputs = sampleInputs();
    const samples: number[] = [];

    for (const input of inputs) {
      const start = Date.now();
      resolveResponse(input, null, bundle, NOW, { index });
      const end = Date.now();
      samples.push(end - start);
    }

    const p95 = percentile(samples, 95);
    // 콘솔 출력은 하지 않는다(엔진 패키지는 @types/node 무의존, NFR-M1) — 실패 시 아래 메시지로 수치를 노출한다.
    expect(p95).toBeLessThan(200);
  });

  it('참고: 인덱스 없이(원본 배열 선형 스캔) 호출해도 개별 요청이 과도하게 느려지지 않는지 확인한다(회귀 감시용, 엄격한 기준 아님)', () => {
    const inputs = sampleInputs().slice(0, 20);
    const samples: number[] = [];
    for (const input of inputs) {
      const start = Date.now();
      resolveResponse(input, null, bundle, NOW); // index 미지정
      const end = Date.now();
      samples.push(end - start);
    }
    const p95 = percentile(samples, 95);
    // 인덱스 미사용 시에도 1건 응답이 2초를 넘기면 실사용(동시 다건 요청)에서 명백한 병목이므로 느슨한 상한만 둔다.
    expect(p95).toBeLessThan(2000);
  });
});
