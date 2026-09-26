import { bindWorkflowOutput, hasWorkflowOutputs } from './workflow-output';
import { makeBundle, makeNode, randomId, workflowOutput } from './test-fixtures';

describe('No.41 업무 자동화 — bindWorkflowOutput/hasWorkflowOutputs', () => {
  it('CONST 필드는 그대로 바인딩된다', () => {
    const targetId = randomId();
    const payload = workflowOutput({ targetId, actionKey: 'leave.request', fields: [{ name: 'reason', value: { kind: 'CONST', value: '휴가' } }] })
      .payload as never;
    const result = bindWorkflowOutput(payload, 'node-1', 0);
    expect(result.bindingMissing).toBeUndefined();
    expect(result.fields).toEqual([{ name: 'reason', value: '휴가', source: 'CONST' }]);
    expect(result.targetId).toBe(targetId);
    expect(result.actionKey).toBe('leave.request');
  });

  it('SLOT 필드는 완료 폼 값으로 채워진다', () => {
    const contextVariableId = randomId();
    const payload = workflowOutput({
      fields: [{ name: 'name', value: { kind: 'SLOT', contextVariableId, slotName: 'userName' } }],
    }).payload as never;
    const result = bindWorkflowOutput(payload, 'node-1', 0, { contextVariableId, values: { userName: '홍길동' } });
    expect(result.fields).toEqual([{ name: 'name', value: '홍길동', source: 'SLOT' }]);
  });

  it('SLOT 하나라도 불충족이면 bindingMissing=true·fields=[](부분 값 미보관)', () => {
    const contextVariableId = randomId();
    const payload = workflowOutput({
      fields: [
        { name: 'a', value: { kind: 'CONST', value: '상수값' } },
        { name: 'b', value: { kind: 'SLOT', contextVariableId, slotName: 'missing' } },
      ],
    }).payload as never;
    const result = bindWorkflowOutput(payload, 'node-1', 0, { contextVariableId, values: {} });
    expect(result.bindingMissing).toBe(true);
    expect(result.fields).toEqual([]);
  });

  it('완료 폼이 없는데 SLOT 필드가 있으면 누락 처리된다', () => {
    const contextVariableId = randomId();
    const payload = workflowOutput({ fields: [{ name: 'a', value: { kind: 'SLOT', contextVariableId, slotName: 'x' } }] }).payload as never;
    const result = bindWorkflowOutput(payload, 'node-1', 0, undefined);
    expect(result.bindingMissing).toBe(true);
  });

  it('공백 SLOT 값은 누락으로 취급된다', () => {
    const contextVariableId = randomId();
    const payload = workflowOutput({ fields: [{ name: 'a', value: { kind: 'SLOT', contextVariableId, slotName: 'x' } }] }).payload as never;
    const result = bindWorkflowOutput(payload, 'node-1', 0, { contextVariableId, values: { x: '   ' } });
    expect(result.bindingMissing).toBe(true);
  });

  it('필드 여러 개(CONST+SLOT 혼합)를 순서대로 바인딩한다', () => {
    const contextVariableId = randomId();
    const payload = workflowOutput({
      fields: [
        { name: 'a', value: { kind: 'CONST', value: '1' } },
        { name: 'b', value: { kind: 'SLOT', contextVariableId, slotName: 's' } },
        { name: 'c', value: { kind: 'CONST', value: '3' } },
      ],
    }).payload as never;
    const result = bindWorkflowOutput(payload, 'node-1', 0, { contextVariableId, values: { s: '2' } });
    expect(result.fields.map((f) => f.value)).toEqual(['1', '2', '3']);
  });

  it('hasWorkflowOutputs — WORKFLOW 아웃풋이 있는 번들만 true', () => {
    const withWf = makeBundle({ dialogNodes: [makeNode({ outputs: [workflowOutput()] })] });
    const without = makeBundle({ dialogNodes: [makeNode()] });
    expect(hasWorkflowOutputs(withWf)).toBe(true);
    expect(hasWorkflowOutputs(without)).toBe(false);
  });
});
