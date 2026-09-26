import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WORKFLOW_OUTPUT_LIMITS, type WorkflowOutputPayloadV1 } from '@chat-bot/shared-types';
import { WorkflowOutputEditor } from './WorkflowOutputEditor';

vi.mock('../../../../api/workflowTargets', () => ({
  workflowTargetsApi: {
    picker: vi.fn().mockResolvedValue({
      items: [
        { id: '11111111-1111-4111-8111-111111111111', name: '그룹웨어 결재 흐름', enabled: true, paused: false, ready: true, allowRawPersonalData: false },
      ],
    }),
  },
}));
vi.mock('../../../../context/AuthContext', () => ({
  useAuth: () => ({ can: () => true }),
}));
vi.mock('../../../../api/dialogue', () => ({
  contextsApi: {
    findOne: vi.fn().mockResolvedValue({
      id: 'ctx-1',
      name: '휴가신청폼',
      slots: [
        { name: 'start', label: '시작일' },
        { name: 'end', label: '종료일' },
      ],
    }),
  },
}));

function Harness({ value, onChange }: { value: WorkflowOutputPayloadV1; onChange: (v: WorkflowOutputPayloadV1) => void }): JSX.Element {
  const ref = useRef<HTMLElement | null>(null);
  return (
    <WorkflowOutputEditor
      value={value}
      onChange={onChange}
      chatbotId="chatbot-1"
      nodeContextVariableId="ctx-1"
      errPrefix="outputs.0.payload"
      fieldErrors={{}}
      firstFieldRef={ref}
    />
  );
}

/** D1b — "업무 요청 보내기" 아웃풋 폼(workflow-automation-ui-spec.md §3.4). */
describe('WorkflowOutputEditor', () => {
  it('사용자에게 보이지 않는다는 안내를 항상 보여준다(NFR-WFA4)', () => {
    const value: WorkflowOutputPayloadV1 = { version: 1, targetId: '', actionKey: '', fields: [] };
    render(<Harness value={value} onChange={vi.fn()} />);
    expect(screen.getByText('이 아웃풋은 사용자에게 보이지 않습니다. 앞뒤에 안내 문구를 넣으세요.')).toBeInTheDocument();
  });

  it('동작 키를 입력하면 onChange로 반영된다', () => {
    const value: WorkflowOutputPayloadV1 = { version: 1, targetId: '', actionKey: '', fields: [] };
    const onChange = vi.fn();
    render(<Harness value={value} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText(/동작 키/), { target: { value: 'leave.request' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ actionKey: 'leave.request' }));
  });

  it('필드 추가 후 기본값은 상수(CONST)이며, 폼 슬롯으로 전환하면 이 노드의 슬롯 후보만 보인다', async () => {
    const value: WorkflowOutputPayloadV1 = { version: 1, targetId: '', actionKey: '', fields: [{ name: 'start', value: { kind: 'CONST', value: '' } }] };
    const onChange = vi.fn();
    render(<Harness value={value} onChange={onChange} />);

    await waitFor(() => expect(screen.getByRole('radio', { name: '폼 슬롯' })).toBeEnabled());
    fireEvent.click(screen.getByRole('radio', { name: '폼 슬롯' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ fields: [{ name: 'start', value: { kind: 'SLOT', contextVariableId: 'ctx-1', slotName: 'start' } }] }),
    ));
  });

  it('필드는 최대 20개까지만 추가할 수 있다(WORKFLOW_OUTPUT_LIMITS.fieldsMax)', () => {
    const fields = Array.from({ length: WORKFLOW_OUTPUT_LIMITS.fieldsMax }, (_, i) => ({ name: `f${i}`, value: { kind: 'CONST' as const, value: '' } }));
    const value: WorkflowOutputPayloadV1 = { version: 1, targetId: '', actionKey: '', fields };
    render(<Harness value={value} onChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: '+ 필드 추가' })).toBeDisabled();
    expect(screen.getByText(`필드 (${WORKFLOW_OUTPUT_LIMITS.fieldsMax}/${WORKFLOW_OUTPUT_LIMITS.fieldsMax})`)).toBeInTheDocument();
  });

  it('원문 개인정보 전송이 켜진 대상을 선택하면 경고를 보여준다', async () => {
    const { workflowTargetsApi } = await import('../../../../api/workflowTargets');
    (workflowTargetsApi.picker as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [{ id: 't1', name: '품질티켓봇', enabled: true, paused: false, ready: true, allowRawPersonalData: true }],
    });
    const value: WorkflowOutputPayloadV1 = { version: 1, targetId: 't1', actionKey: '', fields: [] };
    render(<Harness value={value} onChange={vi.fn()} />);

    expect(await screen.findByText('이 대상은 원문 개인정보 전송이 켜져 있습니다.')).toBeInTheDocument();
  });
});
