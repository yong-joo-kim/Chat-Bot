import { resolveTurn } from './turn';
import { resumeAfterApiCall } from './api-call';
import type { ApiCallSuspension } from './api-call';
import { getOutgoingNodeRefs } from './design-validator';
import { apiConditionOutputV2, makeBundle, makeNode, makeSurvey, randomId, surveyOutputV2, textOutput } from './test-fixtures';

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

/**
 * [No.27] API 분기 노드와 설문 진행의 상호작용(§5.6 · FR-0-106 ⑤ · AC-SV2-12) — resumeAfterApiCall이
 * 다음 상태를 `{ version, contextSession: nextSession, pendingClarify: null }`로 "새로 조립"하던
 * 기존 구조(api-call.ts:237-238)는 설문 필드를 빠뜨린다(숨은 결함 ②). resolveTurn → resumeAfterApiCall을
 * 실제로 이어 실행해(hand-crafted stub이 아니라) 이월이 실제로 일어나는지 확인한다.
 */
describe('No.27 설문(No.27) — API 분기 노드에서도 설문이 시작되고 이월된다', () => {
  const NOW = new Date('2026-09-24T10:00:00Z');

  it('API 분기의 성공 대상이 SURVEY 노드면, 재진입 후 봉투에 surveySession이 실리고 EXPOSED 이벤트가 나온다(AC-SV2-12)', () => {
    const survey = makeSurvey({ status: 'OPEN' });
    const surveyNode = makeNode({ id: randomId(), name: '설문시작', outputs: [surveyOutputV2(survey.id)] });
    const apiNode = makeNode({
      id: randomId(),
      name: 'API노드',
      nodeType: 'START',
      outputs: [apiConditionOutputV2({ conditions: [{ path: 'data.status', operator: 'EQ', value: 'OK', nextNodeId: surveyNode.id }] })],
    });
    const bundle = makeBundle({ dialogNodes: [apiNode, surveyNode], surveys: [survey] });

    const suspended = resolveTurn({ buttonAction: { kind: 'NODE', nodeId: apiNode.id } }, null, bundle, NOW);
    expect(suspended.apiCall).toBeDefined();

    const resumed = resumeAfterApiCall({ ...suspended, apiCall: suspended.apiCall! }, { kind: 'SUCCESS', httpStatus: 200, json: { data: { status: 'OK' } } }, bundle, NOW);

    expect(resumed.apiCall).toBeUndefined();
    expect(resumed.nextState.surveySession).toBeDefined();
    expect(resumed.nextState.surveySession?.surveyId).toBe(survey.id);
    expect(resumed.nextState.surveySession?.questionIndex).toBe(0);
    expect(resumed.surveyEvents?.some((e) => e.kind === 'EXPOSED')).toBe(true);
    // 설문을 "시작"한 것이지 사용자가 문항에 "답한" 것이 아니므로 이번 턴은 설문이 입력을 소비하지 않았다.
    expect(resumed.surveyTurn).toBeFalsy();
  });

  it('진입 시 봉투의 completedSurveyIds(다른 설문 완료 이력)는 API 분기 턴을 지나도 사라지지 않는다(숨은 결함 ② 회귀 방지)', () => {
    const survey = makeSurvey({ status: 'OPEN' });
    const surveyNode = makeNode({ id: randomId(), name: '설문시작', outputs: [surveyOutputV2(survey.id)] });
    const apiNode = makeNode({
      id: randomId(),
      name: 'API노드',
      nodeType: 'START',
      outputs: [apiConditionOutputV2({ conditions: [{ path: 'data.status', operator: 'EQ', value: 'OK', nextNodeId: surveyNode.id }] })],
    });
    const bundle = makeBundle({ dialogNodes: [apiNode, surveyNode], surveys: [survey] });
    const previouslyCompletedSurveyId = randomId();
    const inboundState = { version: 1 as const, contextSession: null, completedSurveyIds: [previouslyCompletedSurveyId] };

    const suspended = resolveTurn({ buttonAction: { kind: 'NODE', nodeId: apiNode.id } }, inboundState, bundle, NOW);
    expect(suspended.apiCall).toBeDefined();

    const resumed = resumeAfterApiCall({ ...suspended, apiCall: suspended.apiCall! }, { kind: 'SUCCESS', httpStatus: 200, json: { data: { status: 'OK' } } }, bundle, NOW);

    expect(resumed.nextState.completedSurveyIds).toContain(previouslyCompletedSurveyId);
    // 같은 턴에 새로 시작한 설문도 함께 이월된 상태와 공존해야 한다.
    expect(resumed.nextState.surveySession?.surveyId).toBe(survey.id);
  });

  it('설문이 전혀 관여하지 않은 API 턴의 nextState는 기존 3키({version,contextSession,pendingClarify}) 그대로다(AC-L3-13 무회귀)', () => {
    const targetNode = makeNode({ id: randomId(), name: '분기결과', outputs: [textOutput('분기결과')] });
    const apiNode = makeNode({
      id: randomId(),
      name: 'API노드',
      nodeType: 'START',
      outputs: [apiConditionOutputV2({ conditions: [{ path: 'data.status', operator: 'EQ', value: 'OK', nextNodeId: targetNode.id }] })],
    });
    const bundle = makeBundle({ dialogNodes: [apiNode, targetNode] });

    const suspended = resolveTurn({ buttonAction: { kind: 'NODE', nodeId: apiNode.id } }, null, bundle, NOW);
    const resumed = resumeAfterApiCall({ ...suspended, apiCall: suspended.apiCall! }, { kind: 'SUCCESS', httpStatus: 200, json: { data: { status: 'OK' } } }, bundle, NOW);

    expect(Object.keys(resumed.nextState).sort()).toEqual(['contextSession', 'pendingClarify', 'version'].sort());
    expect(resumed.surveyEvents).toBeUndefined();
    expect(resumed.surveyTurn).toBeUndefined();
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
