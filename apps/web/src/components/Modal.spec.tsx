import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe, toHaveNoViolations } from 'jest-axe';
import { ConfirmDialog, Modal } from './Modal';

expect.extend(toHaveNoViolations);

/**
 * ui-spec §2.2 / UIUX §3 / AC-5-5 검증:
 * - 열릴 때 포커스가 모달 내부로 이동한다(DOM 순서상 첫 상호작용 요소 = 헤더의 닫기 버튼).
 * - Tab이 모달 밖으로 빠져나가지 않는다(포커스 트랩).
 * - Esc로 닫히고, 닫히면 포커스가 트리거 버튼으로 복귀한다.
 * code-reviewer가 "실제 렌더링/클릭/키보드 포커스이동을 검증하지 못했다"고 지목한 항목의 핵심 커버리지.
 */

function TriggerAndModal({ closeOnEsc = true }: { closeOnEsc?: boolean }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        트리거 버튼
      </button>
      <Modal isOpen={open} title="테스트 모달" onClose={() => setOpen(false)} closeOnEsc={closeOnEsc}>
        <button type="button">첫 번째 버튼</button>
        <button type="button">두 번째 버튼</button>
      </Modal>
    </div>
  );
}

describe('Modal', () => {
  it('열리면 role=dialog와 aria-modal=true를 갖고 내부 첫 상호작용 요소(닫기 버튼)로 포커스가 이동한다', async () => {
    const user = userEvent.setup();
    render(<TriggerAndModal />);

    await user.click(screen.getByRole('button', { name: '트리거 버튼' }));

    const dialog = screen.getByRole('dialog', { name: '테스트 모달' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    // Modal 헤더의 닫기(✕) 버튼이 DOM상 첫 포커스 가능 요소다(초기 포커스는 initialFocusSelector 미지정 시 이 요소로 이동).
    expect(screen.getByRole('button', { name: '닫기' })).toHaveFocus();
  });

  it('Tab이 모달 밖으로 빠져나가지 않는다(포커스 트랩) — 마지막 요소에서 Tab하면 첫 요소로 돌아온다', async () => {
    const user = userEvent.setup();
    render(<TriggerAndModal />);
    await user.click(screen.getByRole('button', { name: '트리거 버튼' }));

    expect(screen.getByRole('button', { name: '닫기' })).toHaveFocus();
    await user.tab(); // 닫기 -> 첫 번째 버튼
    expect(screen.getByRole('button', { name: '첫 번째 버튼' })).toHaveFocus();
    await user.tab(); // 첫 번째 버튼 -> 두 번째 버튼(마지막)
    expect(screen.getByRole('button', { name: '두 번째 버튼' })).toHaveFocus();

    await user.tab(); // 마지막 요소에서 Tab -> 첫 요소(닫기)로 순환
    expect(screen.getByRole('button', { name: '닫기' })).toHaveFocus();
  });

  it('Shift+Tab으로 역순 이동도 모달 밖으로 나가지 않는다 — 첫 요소에서 Shift+Tab하면 마지막 요소로 순환한다', async () => {
    const user = userEvent.setup();
    render(<TriggerAndModal />);
    await user.click(screen.getByRole('button', { name: '트리거 버튼' }));

    expect(screen.getByRole('button', { name: '닫기' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: '두 번째 버튼' })).toHaveFocus();
    expect(document.activeElement?.closest('.modal-dialog')).not.toBeNull();
  });

  it('Esc 키를 누르면 닫히고, 닫힌 뒤 포커스가 트리거 버튼으로 복귀한다(AC-5-5)', async () => {
    const user = userEvent.setup();
    render(<TriggerAndModal />);

    const trigger = screen.getByRole('button', { name: '트리거 버튼' });
    await user.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('closeOnEsc=false이면 Esc로 닫히지 않는다(파괴적 액션 진행 중 등)', async () => {
    const user = userEvent.setup();
    render(<TriggerAndModal closeOnEsc={false} />);

    await user.click(screen.getByRole('button', { name: '트리거 버튼' }));
    await user.keyboard('{Escape}');

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

function TriggerAndConfirmDialog(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        삭제 트리거
      </button>
      <p>확인됨: {String(confirmed)}</p>
      <ConfirmDialog
        isOpen={open}
        title="삭제 확인"
        description="정말 삭제하시겠습니까?"
        confirmLabel="삭제"
        danger
        onConfirm={() => {
          setConfirmed(true);
          setOpen(false);
        }}
        onCancel={() => setOpen(false)}
      />
    </div>
  );
}

describe('ConfirmDialog', () => {
  it('기본 포커스는 취소 버튼에 있다(오조작 방지, ui-spec §2.2)', async () => {
    const user = userEvent.setup();
    render(<TriggerAndConfirmDialog />);
    await user.click(screen.getByRole('button', { name: '삭제 트리거' }));

    expect(screen.getByRole('button', { name: '취소' })).toHaveFocus();
  });

  it('Esc로 취소하면 확인 콜백이 실행되지 않고(아무 변경 없음) 포커스가 트리거로 복귀한다(AC-5-5)', async () => {
    const user = userEvent.setup();
    render(<TriggerAndConfirmDialog />);
    const trigger = screen.getByRole('button', { name: '삭제 트리거' });
    await user.click(trigger);

    await user.keyboard('{Escape}');

    expect(screen.getByText('확인됨: false')).toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('확인 버튼 클릭 시 onConfirm이 호출된다', async () => {
    const user = userEvent.setup();
    render(<TriggerAndConfirmDialog />);
    await user.click(screen.getByRole('button', { name: '삭제 트리거' }));
    await user.click(screen.getByRole('button', { name: '삭제' }));

    expect(screen.getByText('확인됨: true')).toBeInTheDocument();
  });

  it('description이 aria-describedby로 다이얼로그에 연결된다', async () => {
    const user = userEvent.setup();
    render(<TriggerAndConfirmDialog />);
    await user.click(screen.getByRole('button', { name: '삭제 트리거' }));

    const dialog = screen.getByRole('dialog', { name: '삭제 확인' });
    const describedById = dialog.getAttribute('aria-describedby');
    expect(describedById).toBeTruthy();
    const descriptionEl = document.getElementById(describedById as string);
    expect(descriptionEl).toHaveTextContent('정말 삭제하시겠습니까?');
  });

  it('description이 연결된 ConfirmDialog는 axe 접근성 위반이 없다', async () => {
    const user = userEvent.setup();
    render(<TriggerAndConfirmDialog />);
    await user.click(screen.getByRole('button', { name: '삭제 트리거' }));

    const dialog = screen.getByRole('dialog', { name: '삭제 확인' });
    const results = await axe(dialog, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
