import type { ConversationState, PendingClarify } from '@chat-bot/shared-types';
import { resolveByNodeId } from './resolver';
import { resolveTurn } from './turn';
import { buildDialogueIndex } from './dialogue-index';
import { makeBundle, makeContext, makeIntent, makeNode, textOutput } from './test-fixtures';

const NOW = new Date('2026-01-01T00:00:00Z');

describe('resolveByNodeId — FR-E2-1', () => {
  it('AC-E2-1: 노드가 존재하고 활성 상태면 outputs를 실행하고 matchedNodeId를 반환한다', () => {
    const node = makeNode({ outputs: [textOutput('노드 직접 실행')] });
    const bundle = makeBundle({ dialogNodes: [node] });

    const result = resolveByNodeId(node.id, null, bundle, NOW);

    expect(result.matchedNodeId).toBe(node.id);
    expect(result.outputs).toEqual([textOutput('노드 직접 실행')]);
    expect(result.trace.some((t) => t.code === 'NODE_BY_ID')).toBe(true);
  });

  it('AC-E2-2: 존재하지 않는 노드 id는 예외 없이 폴백 경로로 처리된다', () => {
    const fallback = makeNode({ nodeType: 'FALLBACK', outputs: [textOutput('폴백 응답')] });
    const bundle = makeBundle({ dialogNodes: [fallback] });

    const result = resolveByNodeId('00000000-0000-4000-8000-000000000000', null, bundle, NOW);

    expect(result.trace.some((t) => t.code === 'NODE_BY_ID_NOT_FOUND')).toBe(true);
    expect(result.trace.some((t) => t.code === 'FALLBACK_NODE')).toBe(true);
    expect(result.outputs).toEqual([textOutput('폴백 응답')]);
  });

  it('enabled=false 노드는 폴백 경로를 탄다', () => {
    const node = makeNode({ enabled: false, outputs: [textOutput('비활성')] });
    const bundle = makeBundle({ dialogNodes: [node] });

    const result = resolveByNodeId(node.id, null, bundle, NOW);

    expect(result.matchedNodeId).toBeUndefined();
    expect(result.trace.some((t) => t.code === 'NODE_BY_ID_NOT_FOUND')).toBe(true);
  });

  it('진행 중인 세션이 있어도 NODE 버튼이 우선하며 세션을 CANCELLED로 종료한다', () => {
    const context = makeContext();
    const node = makeNode({ outputs: [textOutput('버튼 노드 응답')] });
    const bundle = makeBundle({ dialogNodes: [node], contexts: [context] });
    const session = {
      contextVariableId: context.id,
      currentSlotIndex: 0,
      filledValues: {},
      retryCount: 0,
      startedAt: NOW,
      lastInteractedAt: NOW,
      status: 'IN_PROGRESS' as const,
    };

    const result = resolveByNodeId(node.id, session, bundle, NOW);

    expect(result.trace.some((t) => t.code === 'SESSION_CANCELLED')).toBe(true);
    expect(result.matchedNodeId).toBe(node.id);
    expect(result.nextSession?.status).toBe('CANCELLED');
  });

  it('인덱스(nodesById)를 넘기면 이를 사용해 조회한다', () => {
    const node = makeNode({ outputs: [textOutput('인덱스 경유')] });
    const bundle = makeBundle({ dialogNodes: [node] });
    const index = buildDialogueIndex(bundle);

    const result = resolveByNodeId(node.id, null, bundle, NOW, { index });

    expect(result.matchedNodeId).toBe(node.id);
  });
});

describe('resolveTurn — DD-26 오케스트레이터', () => {
  it('텍스트 입력은 resolveResponse로 라우팅된다', () => {
    const intent = makeIntent({ name: '인사', examples: ['안녕하세요'] });
    const node = makeNode({ intentIds: [intent.id], outputs: [textOutput('안녕하세요!')] });
    const bundle = makeBundle({ intents: [intent], dialogNodes: [node] });

    const result = resolveTurn({ message: '안녕하세요' }, null, bundle, NOW);

    expect(result.matchedNodeId).toBe(node.id);
    expect(result.nextState.version).toBe(1);
    expect(result.stateDiscarded).toEqual([]);
  });

  it('buttonAction MESSAGE는 텍스트로 처리된다', () => {
    const intent = makeIntent({ name: '인사', examples: ['안녕'] });
    const node = makeNode({ intentIds: [intent.id], outputs: [textOutput('안녕!')] });
    const bundle = makeBundle({ intents: [intent], dialogNodes: [node] });

    const result = resolveTurn({ buttonAction: { kind: 'MESSAGE', text: '안녕' } }, null, bundle, NOW);

    expect(result.matchedNodeId).toBe(node.id);
  });

  it('buttonAction NODE는 resolveByNodeId로 라우팅된다', () => {
    const node = makeNode({ outputs: [textOutput('노드 진입')] });
    const bundle = makeBundle({ dialogNodes: [node] });

    const result = resolveTurn({ buttonAction: { kind: 'NODE', nodeId: node.id, label: '바로가기' } }, null, bundle, NOW);

    expect(result.matchedNodeId).toBe(node.id);
    expect(result.input).toBe('바로가기');
  });

  it('AC-10-9류: 잘못된 스키마의 state는 폐기되고 새 대화로 처리된다(예외 없음)', () => {
    const bundle = makeBundle();

    const result = resolveTurn({ message: '안녕' }, { garbage: true }, bundle, NOW);

    expect(result.stateDiscarded).toContain('INVALID_SCHEMA');
    expect(result.trace.some((t) => t.code === 'STATE_DISCARDED')).toBe(true);
  });

  it('타 챗봇 컨텍스트 id는 UNKNOWN_CONTEXT로 폐기된다(교차 챗봇 방어)', () => {
    const bundle = makeBundle();
    const state: ConversationState = {
      version: 1,
      contextSession: {
        contextVariableId: '11111111-1111-4111-8111-111111111111',
        currentSlotIndex: 0,
        filledValues: {},
        retryCount: 0,
        startedAt: NOW,
        lastInteractedAt: NOW,
        status: 'IN_PROGRESS',
      },
    };

    const result = resolveTurn({ message: '안녕' }, state, bundle, NOW);

    expect(result.stateDiscarded).toContain('UNKNOWN_CONTEXT');
  });
});

describe('되묻기 종결 — FR-E2-2, DD-27 (S1.5)', () => {
  function buildFixture() {
    const fruitIntent = makeIntent({ name: '과일문의', examples: ['과일 신선해요?'] });
    const shipIntent = makeIntent({ name: '선박문의', examples: ['선박 출항 시간 알려줘'] });
    const homonym = {
      id: '22222222-2222-4222-8222-222222222222',
      chatbotId: 'bot-1',
      word: '배',
      meanings: [
        { label: '과일', contextHints: ['사과', '포도'], intentId: fruitIntent.id },
        { label: '선박', contextHints: ['항구', '운항'], intentId: shipIntent.id },
      ],
      policy: 'ASK' as const,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const shipNode = makeNode({ intentIds: [shipIntent.id], outputs: [textOutput('선박 출항 정보를 안내해 드릴게요.')] });
    const bundle = makeBundle({ intents: [fruitIntent, shipIntent], homonyms: [homonym], dialogNodes: [shipNode] });
    return { bundle, homonym, fruitIntent, shipIntent, shipNode };
  }

  it('S2에서 ASK 되묻기를 반환할 때 pendingClarify가 함께 부여된다', () => {
    const { bundle, homonym } = buildFixture();

    const result = resolveTurn({ message: '배 언제 와요?' }, null, bundle, NOW);

    expect(result.outputs[0].type).toBe('BUTTON');
    expect(result.nextState.pendingClarify?.homonymId).toBe(homonym.id);
    expect(result.trace.some((t) => t.code === 'HOMONYM_AMBIGUOUS')).toBe(true);
  });

  it('버튼 클릭 경로(label 정규화 정확 일치)로 다음 턴에 의미가 확정되고 노드가 매칭된다', () => {
    const { bundle, shipIntent, shipNode } = buildFixture();

    const first = resolveTurn({ message: '배 언제 와요?' }, null, bundle, NOW);
    const second = resolveTurn({ message: '선박' }, first.nextState, bundle, NOW);

    expect(second.trace.some((t) => t.code === 'CLARIFY_RESOLVED')).toBe(true);
    expect(second.matchedIntentId).toBe(shipIntent.id);
    expect(second.matchedNodeId).toBe(shipNode.id);
    expect(second.nextState.pendingClarify).toBeNull();
  });

  it('예문 매칭이 실패해도(부스트만으로 안 되는 경우) 확정 의도가 강제로 채택된다(단순 부스트가 아니다)', () => {
    const { bundle, shipIntent } = buildFixture();
    // "선박"만으로는 shipIntent의 예문("선박 출항 시간 알려줘")에 부분일치하지 않는 극단 케이스를 만들기 위해
    // 예문을 전혀 다른 문구로 바꾼 번들을 구성한다.
    const isolatedShipIntent = { ...shipIntent, examples: ['완전히 다른 예문 텍스트'] };
    const bundle2 = { ...bundle, intents: bundle.intents.map((i) => (i.id === shipIntent.id ? isolatedShipIntent : i)) };

    const first = resolveTurn({ message: '배 언제 와요?' }, null, bundle2, NOW);
    const second = resolveTurn({ message: '선박' }, first.nextState, bundle2, NOW);

    expect(second.matchedIntentId).toBe(shipIntent.id);
  });

  it('문맥 힌트 단어 포함으로도 해소된다("항구요")', () => {
    const { bundle, shipIntent } = buildFixture();

    const first = resolveTurn({ message: '배 언제 와요?' }, null, bundle, NOW);
    const second = resolveTurn({ message: '항구요' }, first.nextState, bundle, NOW);

    expect(second.trace.some((t) => t.code === 'CLARIFY_RESOLVED')).toBe(true);
    expect(second.matchedIntentId).toBe(shipIntent.id);
  });

  it('불일치 입력은 CLARIFY_DISCARDED 후 일반 해석으로 진행된다(AC-E2-5)', () => {
    const { bundle } = buildFixture();

    const first = resolveTurn({ message: '배 언제 와요?' }, null, bundle, NOW);
    const second = resolveTurn({ message: '전혀 상관없는 문의입니다' }, first.nextState, bundle, NOW);

    expect(second.trace.some((t) => t.code === 'CLARIFY_DISCARDED')).toBe(true);
    expect(second.trace.some((t) => t.code === 'CLARIFY_RESOLVED')).toBe(false);
  });

  it('TTL(10분) 초과 시 CLARIFY_EXPIRED로 폐기되고 pendingClarify가 제거된다', () => {
    const { bundle } = buildFixture();
    const first = resolveTurn({ message: '배 언제 와요?' }, null, bundle, NOW);
    const later = new Date(NOW.getTime() + 11 * 60 * 1000);

    const second = resolveTurn({ message: '선박' }, first.nextState, bundle, later);

    expect(second.stateDiscarded).toContain('CLARIFY_EXPIRED');
    expect(second.trace.some((t) => t.code === 'CLARIFY_RESOLVED')).toBe(false);
  });

  it('세션이 진행 중이면 되묻기 대기는 포기된다(세션 우선)', () => {
    const context = makeContext();
    const { bundle, homonym } = buildFixture();
    const bundleWithContext = { ...bundle, contexts: [context] };
    const pending: PendingClarify = { homonymId: homonym.id, word: '배', askedAt: NOW };
    const state: ConversationState = {
      version: 1,
      contextSession: {
        contextVariableId: context.id,
        currentSlotIndex: 0,
        filledValues: {},
        retryCount: 0,
        startedAt: NOW,
        lastInteractedAt: NOW,
        status: 'IN_PROGRESS',
      },
      pendingClarify: pending,
    };

    const result = resolveTurn({ message: '아무 값' }, state, bundleWithContext, NOW);

    expect(result.trace.some((t) => t.code === 'CLARIFY_DISCARDED' && t.message === '세션 우선')).toBe(true);
  });

  it('NODE 버튼 클릭은 대기 중인 되묻기를 소비하지 않고 그대로 무시한다', () => {
    const { bundle, homonym } = buildFixture();
    const node = makeNode({ outputs: [textOutput('버튼 노드')] });
    const bundle2 = { ...bundle, dialogNodes: [...bundle.dialogNodes, node] };
    const state: ConversationState = {
      version: 1,
      contextSession: null,
      pendingClarify: { homonymId: homonym.id, word: '배', askedAt: NOW },
    };

    const result = resolveTurn({ buttonAction: { kind: 'NODE', nodeId: node.id } }, state, bundle2, NOW);

    expect(result.matchedNodeId).toBe(node.id);
    expect(result.nextState.pendingClarify).toBeNull();
  });
});
