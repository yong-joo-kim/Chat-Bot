import { SimulationService } from './simulation.service';
import type { WorkflowEmission } from '@chat-bot/dialogue-engine';

/**
 * [신규 No.41 — 필드 단위 마스킹 계약 보강, §27 I-12] `buildWorkflowSteps()`의 `fields[].masked`
 * 채움 로직만 검증한다(다른 생성자 의존성은 이 경로에서 쓰이지 않아 더미로 대체).
 */
describe('SimulationService.buildWorkflowSteps — fields[].masked', () => {
  function makeService(target: { allowRawPersonalData: boolean } | undefined) {
    const workflowCatalog = {
      findForEnqueue: jest.fn().mockResolvedValue(
        target
          ? new Map([
              [
                'target-1',
                {
                  id: 'target-1',
                  name: '테스트 대상',
                  enabled: true,
                  paused: false,
                  allowRawPersonalData: target.allowRawPersonalData,
                  secretsOk: true,
                },
              ],
            ])
          : new Map(),
      ),
    };
    // 다른 생성자 인자는 이 메서드 경로에서 참조되지 않는다.
    const service = new SimulationService(
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      workflowCatalog as never,
      undefined as never,
    );
    return service;
  }

  const emission: WorkflowEmission = {
    nodeId: '11111111-1111-1111-1111-111111111111',
    outputIndex: 0,
    targetId: 'target-1',
    actionKey: 'action',
    fields: [
      { name: 'note', value: '안녕하세요', source: 'CONST' },
      { name: 'nonSensitiveSlot', value: '일반텍스트', source: 'SLOT' },
      { name: 'phone', value: '010-1234-5678', source: 'SLOT' },
    ],
  };

  it('비민감 CONST/SLOT 필드는 masked 키가 없다', async () => {
    const service = makeService({ allowRawPersonalData: false });
    const steps = await (service as unknown as { buildWorkflowSteps: (e: readonly WorkflowEmission[]) => Promise<Array<{ fields: Array<Record<string, unknown>> }>> }).buildWorkflowSteps([emission]);
    const fields = steps[0].fields;
    expect(fields[0]).not.toHaveProperty('masked');
    expect(fields[1]).not.toHaveProperty('masked');
  });

  it('maskPii가 값을 바꾼 SLOT 필드에만 masked: true가 있다', async () => {
    const service = makeService({ allowRawPersonalData: false });
    const steps = await (service as unknown as { buildWorkflowSteps: (e: readonly WorkflowEmission[]) => Promise<Array<{ fields: Array<Record<string, unknown>> }>> }).buildWorkflowSteps([emission]);
    const fields = steps[0].fields;
    expect(fields[2].name).toBe('phone');
    expect(fields[2].masked).toBe(true);
  });

  it('allowRawPersonalData가 true면 SLOT도 마스킹하지 않아 masked 키가 없다', async () => {
    const service = makeService({ allowRawPersonalData: true });
    const steps = await (service as unknown as { buildWorkflowSteps: (e: readonly WorkflowEmission[]) => Promise<Array<{ fields: Array<Record<string, unknown>> }>> }).buildWorkflowSteps([emission]);
    const fields = steps[0].fields;
    expect(fields[2]).not.toHaveProperty('masked');
  });
});
