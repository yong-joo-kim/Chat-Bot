import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useState } from 'react';
import { Modal } from './Modal';

/**
 * [신규 No.36] `Modal`은 호출부가 렌더마다 새 `onClose`(인라인 화살표)를 넘겨도 열려 있는 동안 포커스를 다시 옮기지 않는다 —
 * 예전에는 이펙트가 렌더마다 재실행돼 입력창에 한 글자를 칠 때마다 포커스가 "취소"로 돌아갔다.
 * 다만 내용이 비동기로 나중에 그려져 초기 포커스 대상(취소 버튼)이 뒤늦게 생기면 그때 한 번은 옮긴다(기존 대화상자 동작 유지).
 */
function TypingModal(): JSX.Element {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(true);
  return (
    <Modal isOpen={open} title="입력 대화상자" onClose={() => setOpen(false)} initialFocusSelector='[data-autofocus="cancel"]'>
      <label htmlFor="memo">메모</label>
      <input id="memo" type="text" value={text} onChange={(e) => setText(e.target.value)} />
      <button type="button" data-autofocus="cancel" onClick={() => setOpen(false)}>
        취소
      </button>
    </Modal>
  );
}

function LateContentModal(): JSX.Element {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setReady(true), 20);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <Modal isOpen title="늦게 그려지는 내용" onClose={() => undefined} initialFocusSelector='[data-autofocus="cancel"]'>
      {ready ? (
        <button type="button" data-autofocus="cancel">
          취소
        </button>
      ) : (
        <p>불러오는 중…</p>
      )}
    </Modal>
  );
}

describe('Modal 포커스', () => {
  it('타이핑 중에는 입력창의 포커스가 유지되어 여러 글자를 이어서 입력할 수 있다', async () => {
    const user = userEvent.setup();
    render(<TypingModal />);
    const input = screen.getByLabelText('메모');
    await user.click(input);
    await user.keyboard('안녕하세요');
    expect(input).toHaveValue('안녕하세요');
    expect(input).toHaveFocus();
  });

  it('초기 포커스 대상이 뒤늦게 생기면 그때 한 번 그 대상으로 옮긴다', async () => {
    render(<LateContentModal />);
    const cancel = await screen.findByRole('button', { name: '취소' });
    await waitFor(() => expect(cancel).toHaveFocus());
  });
});
