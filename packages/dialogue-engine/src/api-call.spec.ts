import { resolveTurn } from './turn';
import { resumeAfterApiCall } from './api-call';
import type { ApiCallSuspension } from './api-call';
import { getOutgoingNodeRefs } from './design-validator';
import { apiConditionOutputV2, makeBundle, makeNode, randomId, textOutput } from './test-fixtures';

describe('No.26 레거시 API 연동 — executeOutputs 정지/재진입', () => {
  it('v2 API_CONDITION을 만나면 정지하고, resolveTurn은 실패(NOT_EXECUTED) 가정의 폴백 결과를 동봉한다', () => {
    const successNode = makeNode({ id: randomId(), name: '성공', outputs: [textOutput('성공 응답')] });
    const bundle = makeBundle({
      dialogNodes: [
        makeNode({
          id: randomId(),
          name: '조회',
          intentIds: [],
          keywordIds: [],
          nodeType: 'START',
          outputs: [apiConditionOutputV2({ conditions: [{ path: 'status', operator: 'EQ', value: 'OK', nextNodeId: successNode.id }] })],
        }),
        successNode,
      ],
    });

    const result = resolveTurn({ buttonAction: { kind: 'NODE', nodeId: bundle.dialogNodes[0].id } }, null, bundle, new Date());

    expect(result.apiCall).toBeDefined();
    expect(result.apiCall?.payload.connectionId).toBeDefined();
    // 폴백 동봉본 — 실패 분기(대상 미지정)로 고정 문구를 낸다.
    expect(result.outputs.some((o) => o.type === 'TEXT')).toBe(true);
    expect(result.nextState.version).toBe(1);
  });

  it('resumeAfterApiCall SUCCESS + 조건 일치 → 분기 노드 실행', () => {
    const targetNode = makeNode({ id: randomId(), name: '배송중 안내', outputs: [textOutput('배송 중입니다: {api.status}')] });
    const bundle = makeBundle({ dialogNodes: [targetNode] });

    const startOutputs = [
      apiConditionOutputV2({
        conditions: [{ path: 'data.status', operator: 'EQ', value: 'SHIPPED', nextNodeId: targetNode.id }],
        responseMappings: [{ name: 'status', path: 'data.status', required: true, maxLength: 50 }],
      }),
    ];

    // 정지 직접 유도 — executeOutputs 재사용
    const { executeOutputs } = jest.requireActual('./outputs');
    const execResult = executeOutputs(startOutputs, bundle, new Date(), { sourceNodeId: 'node-x' });
    expect(execResult.suspended).toBeDefined();

    const suspension: ApiCallSuspension = {
      ...execResult.suspended,
      resumeState: {
        input: '주문 조회',
        normalizedInput: '주문 조회',
        matchedNodeId: 'node-x',
        trace: [],
        carry: [],
        unsupported: [],
        hops: 0,
        hopLimit: 10,
        sessionFallback: null,
        existingSession: null,
      },
    };

    const stub = {
      input: '주문 조회',
      normalizedInput: '주문 조회',
      outputs: [],
      nextSession: null,
      unsupportedOutputs: [],
      trace: [],
      nextState: { version: 1 as const, contextSession: null, pendingClarify: null },
      stateDiscarded: [],
      apiCall: suspension,
    };

    const resumed = resumeAfterApiCall(stub, { kind: 'SUCCESS', httpStatus: 200, json: { data: { status: 'SHIPPED' } } }, bundle, new Date());

    expect(resumed.apiCall).toBeUndefined();
    expect(resumed.apiStep?.outcome).toBe('SUCCESS');
    expect(resumed.apiStep?.branch).toBe('CONDITION');
    expect(resumed.outputs.some((o) => o.type === 'TEXT' && o.payload.text.includes('배송 중입니다: SHIPPED'))).toBe(true);
  });

  it('resumeAfterApiCall FAILURE + 실패 분기 미지정 → 고정 문구', () => {
    const bundle = makeBundle({ dialogNodes: [] });
    const { executeOutputs } = jest.requireActual('./outputs');
    const startOutputs = [apiConditionOutputV2({ conditions: [{ path: 'x', operator: 'EXISTS', nextNodeId: randomId() }] })];
    const execResult = executeOutputs(startOutputs, bundle, new Date(), { sourceNodeId: 'node-y' });
    expect(execResult.suspended).toBeDefined();

    const suspension: ApiCallSuspension = {
      ...execResult.suspended,
      resumeState: {
        input: 'q',
        normalizedInput: 'q',
        trace: [],
        carry: [],
        unsupported: [],
        hops: 0,
        hopLimit: 10,
        sessionFallback: null,
        existingSession: null,
      },
    };
    const stub = {
      input: 'q',
      normalizedInput: 'q',
      outputs: [],
      nextSession: null,
      unsupportedOutputs: [],
      trace: [],
      nextState: { version: 1 as const, contextSession: null, pendingClarify: null },
      stateDiscarded: [],
      apiCall: suspension,
    };

    const resumed = resumeAfterApiCall(stub, { kind: 'FAILURE', outcome: 'TIMEOUT' }, bundle, new Date());
    expect(resumed.apiStep?.outcome).toBe('TIMEOUT');
    expect(resumed.apiStep?.branch).toBe('NOTICE');
    expect(resumed.outputs.some((o) => o.type === 'TEXT' && o.payload.text.includes('확인할 수 없어요'))).toBe(true);
  });
});

describe('No.26 참조 무결성 편입(J-17)', () => {
  it('getOutgoingNodeRefs가 v2 conditions[].nextNodeId · defaultNodeId · failureNodeId를 apiTargets로 반환한다', () => {
    const a = randomId();
    const b = randomId();
    const c = randomId();
    const node = makeNode({
      outputs: [
        apiConditionOutputV2({
          conditions: [{ path: 'x', operator: 'EXISTS', nextNodeId: a }],
          defaultNodeId: b,
          failureNodeId: c,
        }),
      ],
    });
    const { apiTargets } = getOutgoingNodeRefs(node);
    expect(new Set(apiTargets)).toEqual(new Set([a, b, c]));
  });
});
