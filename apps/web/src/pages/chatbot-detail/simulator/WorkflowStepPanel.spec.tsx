import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { WorkflowStepView } from '@chat-bot/shared-types';
import { WorkflowStepPanel } from './WorkflowStepPanel';

function makeStep(overrides: Partial<WorkflowStepView> = {}): WorkflowStepView {
  return {
    nodeId: '33333333-3333-4333-8333-333333333333',
    targetId: '11111111-1111-4111-8111-111111111111',
    targetName: '그룹웨어 결재 흐름',
    targetState: 'READY',
    actionKey: 'leave.request',
    fields: [
      { name: 'start', value: '2026-10-10', source: 'CONST' },
      { name: 'reason', value: '연차', source: 'SLOT' },
    ],
    bindingMissing: false,
    rawPersonalData: false,
    personalDataMasked: true,
    mock: true,
    ...overrides,
  };
}

/** SIM1-ext — "업무 요청(모의)" 단계 패널(workflow-automation-ui-spec.md §3.6). */
describe('WorkflowStepPanel', () => {
  it('접혀 있다가 클릭하면 대상·필드·"실제로 보내지 않았습니다" 안내를 보여준다', () => {
    render(<WorkflowStepPanel step={makeStep()} />);
    expect(screen.queryByText(/실제로 보내지 않았습니다/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /업무 요청\(모의\)/ }));

    expect(screen.getByText(/그룹웨어 결재 흐름/)).toBeInTheDocument();
    expect(screen.getByText(/leave\.request/)).toBeInTheDocument();
    expect(screen.getByText(/실제로 보내지 않았습니다/)).toBeInTheDocument();
  });

  it('필드 값은 서버가 내려준 값을 그대로 보여주고(일괄 마스킹 없음), masked:true인 필드에만 접미사를 붙인다(코드리뷰 R1 M-3)', () => {
    render(
      <WorkflowStepPanel
        step={makeStep({
          fields: [
            { name: 'start', value: '2026-10-10', source: 'CONST' },
            { name: 'reason', value: '010-****-5678', source: 'SLOT', masked: true },
          ],
        })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /업무 요청\(모의\)/ }));

    expect(screen.getByText(/start=2026-10-10/)).toBeInTheDocument();
    expect(screen.getByText(/reason=010-\*\*\*\*-5678\(마스킹\)/)).toBeInTheDocument();
    expect(screen.queryByText(/●●●/)).not.toBeInTheDocument();
  });

  it('rawPersonalData가 켜진 대상이면 필드 값과 별개로 "원문 전송됨" 배지를 덧붙인다', () => {
    render(
      <WorkflowStepPanel
        step={makeStep({
          rawPersonalData: true,
          personalDataMasked: false,
          fields: [{ name: 'reason', value: '연차', source: 'SLOT' }],
        })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /업무 요청\(모의\)/ }));

    expect(screen.getByText(/reason=연차/)).toBeInTheDocument();
    expect(screen.getByText(/원문 전송됨/)).toBeInTheDocument();
  });

  it('bindingMissing이면 필드 값 대신 폼 미완료 안내를 보여준다', () => {
    render(<WorkflowStepPanel step={makeStep({ bindingMissing: true, fields: [] })} />);
    fireEvent.click(screen.getByRole('button', { name: /업무 요청\(모의\)/ }));
    expect(screen.getByText('필드 값을 채울 폼이 완료되지 않아 보내지 않습니다.')).toBeInTheDocument();
  });

  it('대상이 사용 중지 상태면 안내를 보여준다', () => {
    render(<WorkflowStepPanel step={makeStep({ targetState: 'DISABLED' })} />);
    fireEvent.click(screen.getByRole('button', { name: /업무 요청\(모의\)/ }));
    expect(screen.getByText('이 대상은 사용 중지 상태입니다(실제로는 보내지지 않습니다).')).toBeInTheDocument();
  });
});
