import { resolveTurn } from './turn';
import { mergeOverlay } from './overlay';
import { getOutgoingNodeRefs } from './design-validator';
import { makeBundle, makeIntent, makeNode, makeSurvey, randomId, textOutput } from './test-fixtures';
import type { ConversationState, DialogOutput } from '@chat-bot/shared-types';

const NOW = new Date('2026-09-24T09:00:00Z');

function surveyOutput(surveyId: string, onCompleteNodeId?: string): DialogOutput {
  return { type: 'SURVEY', payload: { version: 2, surveyId, ...(onCompleteNodeId ? { onCompleteNodeId } : {}) } };
}

describe('설문(No.27) — 엔진 통합(resolveTurn)', () => {
  it('설문 없는 번들·봉투는 기존과 바이트 동일하다(AC-SV1-4)', () => {
    const intent = makeIntent({ examples: ['안녕'] });
    const node = makeNode({ intentIds: [intent.id], outputs: [textOutput('환영')] });
    const bundle = makeBundle({ intents: [intent], dialogNodes: [node] });

    const result = resolveTurn({ message: '안녕' }, undefined, bundle, NOW);

    expect(result.nextState).toEqual({ version: 1, contextSession: null, pendingClarify: null });
    expect(result.surveyEvents).toBeUndefined();
    expect(result.surveyTurn).toBeUndefined();
  });

  it('v1 SURVEY(자유 문자열)는 미지원으로 건너뛰고 바이트 동일 처리된다(AC-SV1-1)', () => {
    const intent = makeIntent({ examples: ['설문줘'] });
    const node = makeNode({ intentIds: [intent.id], outputs: [{ type: 'SURVEY', payload: { surveyId: 'legacy-key' } }] });
    const bundle = makeBundle({ intents: [intent], dialogNodes: [node] });

    const result = resolveTurn({ message: '설문줘' }, undefined, bundle, NOW);

    expect(result.unsupportedOutputs).toEqual(['SURVEY']);
    expect(result.surveyEvents).toBeUndefined();
  });

  it('v2 SURVEY 노드가 매칭되면 설문이 시작되고 봉투에 surveySession이 실린다(AC-SV2-1)', () => {
    const survey = makeSurvey();
    const intent = makeIntent({ examples: ['설문 시작'] });
    const node = makeNode({ intentIds: [intent.id], outputs: [surveyOutput(survey.id)] });
    const bundle = makeBundle({ intents: [intent], dialogNodes: [node], surveys: [survey] });

    const result = resolveTurn({ message: '설문 시작' }, undefined, bundle, NOW);

    expect(result.nextState.surveySession).toBeDefined();
    expect(result.nextState.surveySession?.surveyId).toBe(survey.id);
    expect(result.surveyEvents?.[0]).toMatchObject({ kind: 'EXPOSED' });
    // 시작 턴은 입력을 "소비"한 것이 아니다(노드 매칭이 소비) — 이벤트는 있으므로 surveyTurn 키는
    // 실리되(§5.4 키 생략 규칙은 이벤트·소비 둘 다 없을 때만 생략) 값은 false다.
    expect(result.surveyTurn).toBe(false);
  });

  it('완주하면 완료 턴에 surveyTurn=true·이벤트 COMPLETED가 실리고 봉투에서 surveySession이 빠진다(AC-SV2-2)', () => {
    const survey = makeSurvey();
    const intent = makeIntent({ examples: ['설문 시작'] });
    const node = makeNode({ intentIds: [intent.id], outputs: [surveyOutput(survey.id)] });
    const bundle = makeBundle({ intents: [intent], dialogNodes: [node], surveys: [survey] });

    const started = resolveTurn({ message: '설문 시작' }, undefined, bundle, NOW);
    const answered = resolveTurn({ message: '5점' }, started.nextState, bundle, NOW);

    expect(answered.surveyTurn).toBe(true);
    expect(answered.surveyEvents?.map((e) => e.kind)).toEqual(['ANSWERED', 'COMPLETED']);
    expect(answered.nextState.surveySession).toBeUndefined();
    expect(answered.nextState.completedSurveyIds).toEqual([survey.id]);
  });

  it('완료 후 이동 노드(onCompleteNodeId)가 있으면 그 노드가 이어서 실행된다(§5.3.1)', () => {
    const survey = makeSurvey();
    const targetNode = makeNode({ outputs: [textOutput('완료 후 안내')] });
    const intent = makeIntent({ examples: ['설문 시작'] });
    const node = makeNode({ intentIds: [intent.id], outputs: [surveyOutput(survey.id, targetNode.id)] });
    const bundle = makeBundle({ intents: [intent], dialogNodes: [node, targetNode], surveys: [survey] });

    const started = resolveTurn({ message: '설문 시작' }, undefined, bundle, NOW);
    const answered = resolveTurn({ message: '5점' }, started.nextState, bundle, NOW);

    expect(answered.matchedNodeId).toBe(targetNode.id);
    expect(answered.outputs.some((o) => o.type === 'TEXT' && o.payload.text === '완료 후 안내')).toBe(true);
  });

  it('진행 중 설문에 취소어를 전체 일치로 입력하면 ABANDONED(CANCELLED)로 끝난다(AC-SV2-6)', () => {
    const survey = makeSurvey();
    const intent = makeIntent({ examples: ['설문 시작'] });
    const node = makeNode({ intentIds: [intent.id], outputs: [surveyOutput(survey.id)] });
    const bundle = makeBundle({ intents: [intent], dialogNodes: [node], surveys: [survey] });

    const started = resolveTurn({ message: '설문 시작' }, undefined, bundle, NOW);
    const cancelled = resolveTurn({ message: '그만' }, started.nextState, bundle, NOW);

    expect(cancelled.surveyEvents).toEqual([expect.objectContaining({ kind: 'ABANDONED', reason: 'CANCELLED' })]);
    expect(cancelled.nextState.surveySession).toBeUndefined();
  });

  it('타임아웃 후 입력은 일반 대화로 처리되고(RELEASED) 안내 문구가 먼저 나온다(AC-SV2-7)', () => {
    const survey = makeSurvey({ sessionTimeoutMinutes: 30 });
    const intent = makeIntent({ examples: ['설문 시작'] });
    const fallbackIntent = makeIntent({ examples: ['환불 방법 알려줘'] });
    const node = makeNode({ intentIds: [intent.id], outputs: [surveyOutput(survey.id)] });
    const refundNode = makeNode({ intentIds: [fallbackIntent.id], outputs: [textOutput('환불 안내')] });
    const bundle = makeBundle({ intents: [intent, fallbackIntent], dialogNodes: [node, refundNode], surveys: [survey] });

    const started = resolveTurn({ message: '설문 시작' }, undefined, bundle, NOW);
    const later = new Date(NOW.getTime() + 31 * 60_000);
    const afterTimeout = resolveTurn({ message: '환불 방법 알려줘' }, started.nextState, bundle, later);

    expect(afterTimeout.surveyEvents?.[0]).toMatchObject({ kind: 'ABANDONED', reason: 'TIMEOUT' });
    expect(afterTimeout.surveyTurn).toBe(false);
    expect(afterTimeout.matchedNodeId).toBe(refundNode.id);
    expect(afterTimeout.outputs[0]).toEqual(textOutput('설문 참여 시간이 지나 설문을 마쳤어요.'));
  });

  it('빈 입력 턴은 설문 상태를 그대로 이월한다', () => {
    const survey = makeSurvey();
    const intent = makeIntent({ examples: ['설문 시작'] });
    const node = makeNode({ intentIds: [intent.id], outputs: [surveyOutput(survey.id)] });
    const bundle = makeBundle({ intents: [intent], dialogNodes: [node], surveys: [survey] });

    const started = resolveTurn({ message: '설문 시작' }, undefined, bundle, NOW);
    const empty = resolveTurn({ message: '' }, started.nextState, bundle, NOW);

    expect(empty.nextState.surveySession).toEqual(started.nextState.surveySession);
  });

  it('mergeOverlay는 번들의 surveys를 이월한다(§5.7 숨은 결함 ⑤)', () => {
    const survey = makeSurvey();
    const bundle = makeBundle({ surveys: [survey] });
    const merged = mergeOverlay(bundle, {});
    expect(merged.surveys).toEqual([survey]);
  });

  it('mergeOverlay는 surveys가 없는 번들에서 결과 객체에 surveys 키를 만들지 않는다(키 생략 규칙)', () => {
    const bundle = makeBundle();
    const merged = mergeOverlay(bundle, {});
    expect(merged.surveys).toBeUndefined();
  });

  it('getOutgoingNodeRefs는 v2 SURVEY의 onCompleteNodeId를 surveyTargets로 반환한다(J-20)', () => {
    const targetId = randomId();
    const node = makeNode({ outputs: [surveyOutput(randomId(), targetId)] });
    const refs = getOutgoingNodeRefs(node);
    expect(refs.surveyTargets).toEqual([targetId]);
  });
});

describe('§6.3 sanitize — 설문 필드 분리 파싱', () => {
  it('설문 필드가 손상돼도 컨텍스트 세션은 살아남는다(AC-SV2-14 취지)', () => {
    const survey = makeSurvey();
    const bundle = makeBundle({ surveys: [survey] });
    const badState = {
      version: 1,
      contextSession: null,
      surveySession: { surveyId: 'not-a-uuid', structureVersion: 1, nodeId: null, outputIndex: 0, questionIndex: 0, retryCount: 0, startedAt: NOW, lastInteractedAt: NOW },
    } as unknown as ConversationState;

    const result = resolveTurn({ message: '안녕' }, badState, bundle, NOW);

    expect(result.stateDiscarded).toContain('SURVEY_STATE_INVALID');
    expect(result.nextState.surveySession).toBeUndefined();
  });
});
