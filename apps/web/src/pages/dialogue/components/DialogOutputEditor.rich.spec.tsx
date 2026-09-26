import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DialogOutput } from '@chat-bot/shared-types';
import { DialogOutputEditor } from './DialogOutputEditor';

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ can: () => true }),
}));

function Harness({ initial, onChangeSpy }: { initial: DialogOutput; onChangeSpy: (v: DialogOutput) => void }): JSX.Element {
  const [value, setValue] = useState<DialogOutput>(initial);
  return (
    <DialogOutputEditor
      value={value}
      onChange={(next) => {
        setValue(next);
        onChangeSpy(next);
      }}
      chatbotId="bot-1"
      idPrefix="output-0"
      errorFieldPrefix="outputs.0.payload"
      fieldErrors={{}}
    />
  );
}

describe('DialogOutputEditor — CAROUSEL 선택(RM-1)', () => {
  it('TEXT → 캐러셀로 전환하면 카드 2장 기본값으로 시작한다', async () => {
    const user = userEvent.setup();
    const onChangeSpy = vi.fn();
    render(<Harness initial={{ type: 'TEXT', payload: { text: '' } }} onChangeSpy={onChangeSpy} />);

    await user.selectOptions(screen.getByLabelText('유형'), '캐러셀');

    expect(onChangeSpy).toHaveBeenCalledWith({ type: 'CAROUSEL', payload: { version: 1, cards: [{ title: '' }, { title: '' }] } });
    expect(screen.getAllByLabelText(/^제목/)).toHaveLength(2);
  });
});

describe('DialogOutputEditor — BUTTON 표시 방식(RM-2, 바로연결)', () => {
  it('기본은 "일반 버튼"이 선택돼 있다', () => {
    render(<Harness initial={{ type: 'BUTTON', payload: { buttons: [{ label: 'a', action: 'MESSAGE', value: 'a' }] } }} onChangeSpy={vi.fn()} />);
    expect(screen.getByLabelText('일반 버튼(말풍선 안 버튼)')).toBeChecked();
  });

  it('바로연결을 선택하면 payload.display가 QUICK_REPLY로 바뀌고 LINK 옵션이 비활성된다', async () => {
    const user = userEvent.setup();
    const onChangeSpy = vi.fn();
    render(
      <Harness
        initial={{ type: 'BUTTON', payload: { buttons: [{ label: '반품 문의', action: 'MESSAGE', value: '반품 문의' }] } }}
        onChangeSpy={onChangeSpy}
      />,
    );

    await user.click(screen.getByLabelText(/바로연결\(답 아래 빠른 선택 칩\)/));

    expect(onChangeSpy).toHaveBeenCalledWith({
      type: 'BUTTON',
      payload: { buttons: [{ label: '반품 문의', action: 'MESSAGE', value: '반품 문의' }], display: 'QUICK_REPLY' },
    });
    const linkOption = screen.getByRole('option', { name: '링크 열기' }) as HTMLOptionElement;
    expect(linkOption.disabled).toBe(true);
    expect(screen.getByText(/바로연결은 대화 안 선택지만 가능합니다/)).toBeInTheDocument();
  });

  it('바로연결에서 이미 LINK로 저장된 버튼은 인라인 오류로 표시된다(자동 변경 없음)', () => {
    render(
      <Harness
        initial={{
          type: 'BUTTON',
          payload: { buttons: [{ label: '링크 버튼', action: 'LINK', value: 'https://example.com' }], display: 'QUICK_REPLY' },
        }}
        onChangeSpy={vi.fn()}
      />,
    );
    expect(screen.getByText('이 버튼은 링크입니다 — 바로연결에서는 쓸 수 없습니다.')).toBeInTheDocument();
  });

  it('바로연결 라벨이 20자를 넘으면 경고가 뜬다(저장은 허용)', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={{ type: 'BUTTON', payload: { buttons: [{ label: '', action: 'MESSAGE', value: 'x' }], display: 'QUICK_REPLY' } }}
        onChangeSpy={vi.fn()}
      />,
    );
    const labelInput = screen.getByLabelText('레이블');
    await user.type(labelInput, '이십자를넘는아주아주긴바로연결라벨입니다123');
    expect(screen.getByText(/20자를 넘으면 칩이 길어질 수 있습니다/)).toBeInTheDocument();
  });
});
