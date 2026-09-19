import { resolveResponse } from './resolver';
import { buildDialogueIndex } from './dialogue-index';
import {
  makeBundle,
  makeContext,
  makeFaq,
  makeIntent,
  makeKeyword,
  makeNode,
  moveOutput,
  contextFormOutput,
  textOutput,
  randomId,
} from './test-fixtures';

const NOW = new Date('2026-01-01T00:00:00Z');

describe('resolveResponse — FR-E-3 해석 우선순위', () => {
  it('AC-E-1: 의도 조건 노드가 매칭되면 노드의 outputs를 반환한다(의도 단독 문구가 아니다)', () => {
    const intent = makeIntent({ name: '배송조회', examples: ['배송 조회'] });
    const node = makeNode({ intentIds: [intent.id], outputs: [textOutput('운송장을 확인해 드릴게요')] });
    const bundle = makeBundle({ intents: [intent], dialogNodes: [node] });

    const result = resolveResponse('배송 조회', null, bundle, NOW);

    expect(result.matchedNodeId).toBe(node.id);
    expect(result.outputs).toEqual([textOutput('운송장을 확인해 드릴게요')]);
  });

  it('AC-E-2: 동일 입력에 노드와 FAQ가 모두 매칭되면 노드가 우선한다', () => {
    const intent = makeIntent({ name: '영업시간', examples: ['영업시간 알려줘'] });
    const node = makeNode({ intentIds: [intent.id], outputs: [textOutput('노드 응답')] });
    const faq = makeFaq({ question: '영업시간 알려줘', answer: 'FAQ 응답' });
    const bundle = makeBundle({ intents: [intent], dialogNodes: [node], faqs: [faq] });

    const result = resolveResponse('영업시간 알려줘', null, bundle, NOW);

    expect(result.matchedNodeId).toBe(node.id);
    expect(result.matchedFaqId).toBeUndefined();
  });

  it('AC-E-3: priority가 높은 노드가 선택된다', () => {
    const intent = makeIntent({ name: '문의', examples: ['문의합니다'] });
    const low = makeNode({ intentIds: [intent.id], priority: 100, outputs: [textOutput('낮은 우선순위')] });
    const high = makeNode({ intentIds: [intent.id], priority: 200, outputs: [textOutput('높은 우선순위')] });
    const bundle = makeBundle({ intents: [intent], dialogNodes: [low, high] });

    const result = resolveResponse('문의합니다', null, bundle, NOW);

    expect(result.matchedNodeId).toBe(high.id);
  });

  it('AC-E-4: enabled=false 노드는 선택되지 않는다', () => {
    const intent = makeIntent({ name: '문의', examples: ['문의합니다'] });
    const disabled = makeNode({ intentIds: [intent.id], enabled: false, outputs: [textOutput('비활성')] });
    const bundle = makeBundle({ intents: [intent], dialogNodes: [disabled] });

    const result = resolveResponse('문의합니다', null, bundle, NOW);

    expect(result.matchedNodeId).toBeUndefined();
  });

  it('AC-E-5: matchMode=ALL이면 지정한 조건을 모두 충족해야 매칭된다', () => {
    const intent = makeIntent({ name: '주문', examples: ['주문하고 싶어요'] });
    const keyword = makeKeyword({ name: '커피', synonyms: [] });
    const node = makeNode({
      matchMode: 'ALL',
      intentIds: [intent.id],
      keywordIds: [keyword.id],
      outputs: [textOutput('ALL 매칭')],
    });
    const bundle = makeBundle({ intents: [intent], keywords: [keyword], dialogNodes: [node] });

    const result = resolveResponse('주문하고 싶어요', null, bundle, NOW);

    expect(result.matchedNodeId).toBeUndefined();
  });

  it('AC-E-6: CONTEXT_FORM 아웃풋은 첫 슬롯 질문을 출력하고 세션을 시작한다', () => {
    const context = makeContext({
      name: '커피주문',
      slots: [{ name: '메뉴', label: '메뉴', prompt: '메뉴를 선택해 주세요.', type: 'TEXT', required: true, maxRetry: 2 }],
    });
    const intent = makeIntent({ name: '주문', examples: ['커피 주문할게요'] });
    const node = makeNode({ intentIds: [intent.id], outputs: [contextFormOutput(context.id)] });
    const bundle = makeBundle({ intents: [intent], contexts: [context], dialogNodes: [node] });

    const result = resolveResponse('커피 주문할게요', null, bundle, NOW);

    expect(result.nextSession?.status).toBe('IN_PROGRESS');
    expect(result.outputs[0]).toEqual(textOutput('메뉴를 선택해 주세요.'));
  });

  it('AC-E-7: 진행 중 세션이 있으면 노드 조건보다 세션 진행이 우선한다', () => {
    const context = makeContext({
      // 슬롯 2개 — 첫 입력만으로는 COMPLETED되지 않아야 "세션 진행 우선"을 검증할 수 있다(DD-13).
      slots: [
        { name: 'menu', label: '메뉴', prompt: '메뉴?', type: 'TEXT', required: true, maxRetry: 2 },
        { name: 'size', label: '사이즈', prompt: '사이즈?', type: 'TEXT', required: true, maxRetry: 2 },
      ],
    });
    const intent = makeIntent({ name: '아메리카노', examples: ['아메리카노'] });
    const node = makeNode({ intentIds: [intent.id], outputs: [textOutput('노드가 응답했다면 실패')] });
    const bundle = makeBundle({ intents: [intent], contexts: [context], dialogNodes: [node] });

    const session = {
      contextVariableId: context.id,
      currentSlotIndex: 0,
      filledValues: {},
      retryCount: 0,
      startedAt: NOW,
      lastInteractedAt: NOW,
      status: 'IN_PROGRESS' as const,
    };

    const result = resolveResponse('아메리카노', session, bundle, NOW);

    expect(result.matchedNodeId).toBeUndefined();
    expect(result.nextSession?.filledValues.menu).toBe('아메리카노');
  });

  it('AC-E-8: DIALOG_MOVE 순환은 10회 이동 후 중단하고 HOP_LIMIT_EXCEEDED를 남긴다', () => {
    const nodeAId = randomId();
    const nodeBId = randomId();
    const intent = makeIntent({ name: '루프', examples: ['루프 테스트'] });
    const nodeA = makeNode({ id: nodeAId, intentIds: [intent.id], outputs: [moveOutput(nodeBId)] });
    const nodeB = makeNode({ id: nodeBId, outputs: [moveOutput(nodeAId)] });
    const bundle = makeBundle({ intents: [intent], dialogNodes: [nodeA, nodeB] });

    const result = resolveResponse('루프 테스트', null, bundle, NOW);

    expect(result.trace.some((t) => t.code === 'HOP_LIMIT_EXCEEDED')).toBe(true);
    expect(result.outputs.length).toBeGreaterThan(0);
  });

  it('AC-E-9: 삭제된 의도를 참조하는 손상된 노드가 섞여 있어도 예외 없이 건너뛴다', () => {
    const brokenNode = makeNode({ intentIds: ['missing-intent-id'], outputs: [textOutput('죽은 노드')] });
    const bundle = makeBundle({ dialogNodes: [brokenNode] });

    expect(() => resolveResponse('아무말', null, bundle, NOW)).not.toThrow();
    const result = resolveResponse('아무말', null, bundle, NOW);
    expect(result.matchedNodeId).toBeUndefined();
    expect(result.trace.some((t) => t.code === 'BROKEN_REFERENCE')).toBe(true);
  });

  it('AC-E-10: 아무것도 매칭되지 않으면 FALLBACK → ERROR_RESPONSE FAQ → 기본 문구 순으로 폴백한다', () => {
    const bundle1 = makeBundle();
    const r1 = resolveResponse('전혀 모르는 말', null, bundle1, NOW);
    expect(r1.outputs.length).toBeGreaterThan(0);

    const errorFaq = makeFaq({ category: 'ERROR_RESPONSE', question: '오류응답', answer: '죄송해요 폴백 답변' });
    const bundle2 = makeBundle({ faqs: [errorFaq] });
    const r2 = resolveResponse('전혀 모르는 말', null, bundle2, NOW);
    expect(r2.matchedFaqId).toBe(errorFaq.id);

    const fallbackNode = makeNode({ nodeType: 'FALLBACK', outputs: [textOutput('폴백 노드 응답')] });
    const bundle3 = makeBundle({ dialogNodes: [fallbackNode], faqs: [errorFaq] });
    const r3 = resolveResponse('전혀 모르는 말', null, bundle3, NOW);
    expect(r3.matchedNodeId).toBe(fallbackNode.id);
  });

  it('EX-D-7: 공백뿐인 입력은 매칭을 시도하지 않고 재입력 안내를 반환한다', () => {
    const result = resolveResponse('   ', null, makeBundle(), NOW);
    expect(result.trace[0].code).toBe('EMPTY_INPUT');
  });

  it('AC-E-12: 대량 번들에서도 인덱스를 재사용하면 100회 해석이 빠르게 끝난다', () => {
    const intents = Array.from({ length: 200 }, (_, i) =>
      makeIntent({ name: `intent-${i}`, examples: Array.from({ length: 20 }, (_, j) => `예문 ${i}-${j}`) }),
    );
    const faqs = Array.from({ length: 300 }, (_, i) => makeFaq({ question: `faq 질문 ${i}` }));
    const bundle = makeBundle({ intents, faqs });
    const index = buildDialogueIndex(bundle);

    const start = Date.now();
    for (let i = 0; i < 100; i += 1) {
      resolveResponse('예문 10-5', null, bundle, NOW, { index });
    }
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(2000);
  });
});
