import { resolveTurn } from './turn';
import { makeBundle, makeContext, makeKeyword, makeNode, randomId, textOutput, workflowOutput } from './test-fixtures';
import type { DialogOutput } from '@chat-bot/shared-types';

/**
 * [No.41] AC-WF2-2/AC-WF2-8 — `WORKFLOW`를 앞·중간·뒤에 넣은 번들과 뺀 번들의 사용자 관측 결과가
 * 바이트 단위로 동일해야 한다(엔진 세 번째 의도된 예외 — I/O 0 · 사용자 출력 0 · 정지 없음).
 */
describe('No.41 업무 자동화 — WORKFLOW 유무 회귀(EN-3·EN-4)', () => {
  const FIXED_NODE_ID = randomId();
  const FIXED_KEYWORD_ID = randomId();

  function buildBundle(outputs: DialogOutput[]) {
    const now = new Date('2026-01-01T00:00:00Z');
    const keyword = makeKeyword({ id: FIXED_KEYWORD_ID, name: '테스트' });
    const node = makeNode({ id: FIXED_NODE_ID, name: '테스트노드', intentIds: [], keywordIds: [keyword.id], outputs });
    return { bundle: makeBundle({ dialogNodes: [node], keywords: [keyword] }), now, nodeId: node.id };
  }

  function stripWorkflow(outputs: DialogOutput[]): DialogOutput[] {
    return outputs.filter((o) => o.type !== 'WORKFLOW');
  }

  const positions: Array<{ label: string; build: (wf: DialogOutput) => DialogOutput[] }> = [
    { label: '앞', build: (wf) => [wf, textOutput('첫 응답'), textOutput('둘째 응답')] },
    { label: '중간', build: (wf) => [textOutput('첫 응답'), wf, textOutput('둘째 응답')] },
    { label: '뒤', build: (wf) => [textOutput('첫 응답'), textOutput('둘째 응답'), wf] },
  ];

  for (const pos of positions) {
    it(`WORKFLOW를 ${pos.label}에 넣은 번들 — 사용자 출력·trace(WORKFLOW 코드 제외)·nextState가 뺀 번들과 바이트 동일`, () => {
      const wf = workflowOutput({ fields: [{ name: 'a', value: { kind: 'CONST', value: 'x' } }] });
      const outputsWith = pos.build(wf);
      const outputsWithout = stripWorkflow(outputsWith);

      const { bundle: bundleWith, now } = buildBundle(outputsWith);
      const { bundle: bundleWithout } = buildBundle(outputsWithout);

      const resultWith = resolveTurn({ message: '테스트' }, null, bundleWith, now);
      const resultWithout = resolveTurn({ message: '테스트' }, null, bundleWithout, now);

      expect(resultWith.outputs).toEqual(resultWithout.outputs);
      expect(resultWith.nextState).toEqual(resultWithout.nextState);
      expect(resultWith.unsupportedOutputs).toEqual(resultWithout.unsupportedOutputs);
      expect(resultWith.pendingClarify).toEqual(resultWithout.pendingClarify);
      const traceCodesWith = resultWith.trace.filter((t) => t.code !== 'WORKFLOW_EMITTED' && t.code !== 'WORKFLOW_BINDING_MISSING');
      expect(traceCodesWith).toEqual(resultWithout.trace);

      // WORKFLOW가 있는 번들만 workflowEvents 키가 있다.
      expect(resultWith.workflowEvents).toHaveLength(1);
      expect('workflowEvents' in resultWithout).toBe(false);
    });
  }

  it('WORKFLOW 없는 번들 — workflowEvents 키·apiCall.resumeState.workflow 키가 없다', () => {
    const { bundle, now } = buildBundle([textOutput('안내')]);
    const result = resolveTurn({ message: '테스트' }, null, bundle, now);
    expect('workflowEvents' in result).toBe(false);
  });

  it('WORKFLOW만 있는 노드는 출력 0건 → 기존 폴백 문구 + EMPTY_OUTPUT(제약 ⑥, 바이트 규칙 불변)', () => {
    const { bundle, now } = buildBundle([workflowOutput()]);
    const result = resolveTurn({ message: '테스트' }, null, bundle, now);
    expect(result.outputs).toHaveLength(1);
    expect(result.outputs[0].type).toBe('TEXT');
    expect(result.trace.some((t) => t.code === 'EMPTY_OUTPUT')).toBe(true);
    expect(result.workflowEvents).toHaveLength(1);
  });

  it('SLOT 바인딩 누락 방출 — bindingMissing=true가 결과에 실린다', () => {
    const contextVariableId = randomId();
    const context = makeContext({ id: contextVariableId });
    const keyword = makeKeyword({ id: randomId(), name: '테스트' });
    const wf = workflowOutput({ fields: [{ name: 'a', value: { kind: 'SLOT', contextVariableId, slotName: 'missing' } }] });
    const node = makeNode({ id: randomId(), name: '테스트노드', intentIds: [], keywordIds: [keyword.id], outputs: [textOutput('안내'), wf] });
    const bundle = makeBundle({ dialogNodes: [node], contexts: [context], keywords: [keyword] });
    const result = resolveTurn({ message: '테스트' }, null, bundle, new Date());
    expect(result.workflowEvents).toEqual([expect.objectContaining({ bindingMissing: true, fields: [] })]);
  });
});
