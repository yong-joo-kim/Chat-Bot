import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { WorkflowRunItem } from '@chat-bot/shared-types';
import { WorkflowRunTable } from './WorkflowRunTable';

function makeRun(overrides: Partial<WorkflowRunItem> = {}): WorkflowRunItem {
  return {
    id: '7f1c2e3a-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    targetId: '11111111-1111-4111-8111-111111111111',
    targetName: '그룹웨어 결재 흐름',
    chatbotId: '22222222-2222-4222-8222-222222222222',
    triggerKind: 'NODE',
    eventType: 'NODE_ACTION',
    actionKey: 'leave.request',
    nodeId: '33333333-3333-4333-8333-333333333333',
    subscriptionId: null,
    sessionRef: 'a1b2c3d4e5f60718',
    status: 'FAILED',
    statusReason: 'PERMANENT_ERROR',
    holdReason: null,
    attemptCount: 5,
    nextAttemptAt: null,
    lastOutcome: 'HTTP_ERROR',
    lastHttpStatus: 400,
    lastLatencyMs: 210,
    personalDataMasked: true,
    fieldNames: ['start', 'end', 'reason'],
    retryable: true,
    payloadPurged: false,
    manualRetryCount: 0,
    createdAt: new Date('2026-09-26T01:01:58.000Z'),
    completedAt: new Date('2026-09-26T01:01:58.500Z'),
    ...overrides,
  };
}

/** 실행 이력 상세 패널 — `WorkflowStatusReason.DECRYPT_FAILED` 전용 문구(§3.2.1 확정). */
describe('WorkflowRunTable — 상세 패널', () => {
  it('statusReason=DECRYPT_FAILED면 전용 문구를 보여준다(lastOutcome=null 추론 방식 아님)', () => {
    const run = makeRun({ statusReason: 'DECRYPT_FAILED', lastOutcome: null, lastHttpStatus: null });
    render(<WorkflowRunTable items={[run]} expandedId={run.id} onToggleExpand={vi.fn()} />);

    expect(screen.getByText('저장된 요청 내용을 복호화하지 못해 실패로 종료되었습니다. 운영자에게 문의하세요.')).toBeInTheDocument();
  });

  it('payloadPurged=true면 파기 안내 + 재발송 불가 문구를 보여준다', () => {
    const run = makeRun({ payloadPurged: true, retryable: false });
    render(<WorkflowRunTable items={[run]} expandedId={run.id} onToggleExpand={vi.fn()} />);

    expect(screen.getByText(/보존기간 경과로 파기됨/)).toBeInTheDocument();
    expect(screen.getByText(/재발송할 수 없습니다/)).toBeInTheDocument();
  });

  it('필드 값은 절대 표시하지 않고 이름만 보여준다', () => {
    const run = makeRun();
    render(<WorkflowRunTable items={[run]} expandedId={run.id} onToggleExpand={vi.fn()} />);

    expect(screen.getByText(/start, end, reason/)).toBeInTheDocument();
    expect(screen.getByText(/값은 표시되지 않습니다/)).toBeInTheDocument();
  });

  it('행 클릭 시 onToggleExpand가 호출된다', () => {
    const run = makeRun();
    const onToggle = vi.fn();
    render(<WorkflowRunTable items={[run]} expandedId={null} onToggleExpand={onToggle} />);

    fireEvent.click(screen.getByText('그룹웨어 결재 흐름'));
    expect(onToggle).toHaveBeenCalledWith(run.id);
  });

  it('selectable일 때 종단 상태(SUCCEEDED)는 선택 체크박스가 비활성화된다', () => {
    const run = makeRun({ status: 'SUCCEEDED', lastOutcome: 'SUCCESS' });
    render(<WorkflowRunTable items={[run]} expandedId={null} onToggleExpand={vi.fn()} selectable selectedIds={[]} onSelectionChange={vi.fn()} />);

    expect(screen.getByRole('checkbox', { name: `${run.id} 선택` })).toBeDisabled();
  });
});
