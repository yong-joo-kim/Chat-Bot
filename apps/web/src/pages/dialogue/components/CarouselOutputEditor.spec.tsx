import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CarouselOutputPayloadV1 } from '@chat-bot/shared-types';
import { CarouselOutputEditor } from './CarouselOutputEditor';

function Harness({ initial }: { initial: CarouselOutputPayloadV1 }): JSX.Element {
  const [value, setValue] = useState(initial);
  const ref = { current: null };
  return (
    <CarouselOutputEditor
      value={value}
      onChange={setValue}
      chatbotId="bot-1"
      idPrefix="output-0"
      errorFieldPrefix="outputs.0.payload"
      fieldErrors={{}}
      firstFieldRef={ref}
    />
  );
}

function payload(cardCount: number): CarouselOutputPayloadV1 {
  return {
    version: 1,
    cards: Array.from({ length: cardCount }, (_, i) => ({ title: `카드${i + 1}` })),
  };
}

describe('CarouselOutputEditor — 카드 목록 경계(RM-1, §3.1)', () => {
  it('카드 2장(하한)에서는 삭제 버튼이 비활성이고 이유가 aria-label에 병기된다', () => {
    render(<Harness initial={payload(2)} />);
    const removeButtons = screen.getAllByRole('button', { name: /삭제 — 2장 미만으로 줄일 수 없습니다/ });
    expect(removeButtons).toHaveLength(2);
    removeButtons.forEach((btn) => expect(btn).toBeDisabled());
  });

  it('카드 10장(상한)에서는 추가 버튼이 비활성이고 안내 문구가 보인다(복제 버튼도 상한에서는 모두 비활성 + 이유 병기)', () => {
    render(<Harness initial={payload(10)} />);
    expect(screen.getByRole('button', { name: '+ 카드 추가' })).toBeDisabled();
    // 추가 버튼 옆 1개 + 카드마다 복제 버튼 비활성 이유 10개 = 11개.
    expect(screen.getAllByText('카드는 최대 10장까지 추가할 수 있습니다.')).toHaveLength(11);
    screen.getAllByRole('button', { name: '복제' }).forEach((btn) => expect(btn).toBeDisabled());
  });

  it('+ 카드 추가를 누르면 카드가 1장 늘어난다', () => {
    render(<Harness initial={payload(2)} />);
    fireEvent.click(screen.getByRole('button', { name: '+ 카드 추가' }));
    expect(screen.getAllByLabelText(/^제목/)).toHaveLength(3);
  });

  it('복제 버튼을 누르면 같은 값의 카드가 바로 뒤에 추가된다', () => {
    render(<Harness initial={payload(2)} />);
    const titleInputs = screen.getAllByLabelText(/^제목/) as HTMLInputElement[];
    expect(titleInputs[0].value).toBe('카드1');
    fireEvent.click(screen.getAllByRole('button', { name: '복제' })[0]);
    const after = screen.getAllByLabelText(/^제목/) as HTMLInputElement[];
    expect(after).toHaveLength(3);
    expect(after[0].value).toBe('카드1');
    expect(after[1].value).toBe('카드1');
  });

  it('카드당 버튼은 최대 3개다 — 4개째 추가는 비활성', () => {
    render(
      <Harness
        initial={{
          version: 1,
          cards: [
            {
              title: '카드1',
              buttons: [
                { label: 'a', action: 'MESSAGE', value: 'a' },
                { label: 'b', action: 'MESSAGE', value: 'b' },
                { label: 'c', action: 'MESSAGE', value: 'c' },
              ],
            },
            { title: '카드2' },
          ],
        }}
      />,
    );
    const addButtonBtns = screen.getAllByRole('button', { name: '+ 버튼 추가' });
    expect(addButtonBtns[0]).toBeDisabled();
  });
});

describe('CarouselOutputEditor — 카드 순서 이동·삭제와 key 짝(코드 리뷰 R1 High, AC-5-8)', () => {
  it('카드를 연속 아래로 이동하면 포커스가 이동한 카드를 따라간다(원래 화면 위치가 아니라)', async () => {
    const user = userEvent.setup();
    // 4장으로 시작 — 2회 연속 이동해도 카드1이 마지막(자기 자신의 "아래로" 버튼이 비활성되는) 자리에
    // 닿지 않게 해, "비활성 버튼에는 포커스가 갈 수 없다"는 무관한 경계와 섞이지 않게 한다.
    render(<Harness initial={payload(4)} />);

    const firstDownBtn = screen.getByRole('button', { name: '1번째 카드(카드1) 아래로' });
    firstDownBtn.focus();
    await user.click(firstDownBtn);

    // 카드1은 이제 2번째 위치 — 포커스는 "카드1"의 아래로 버튼을 따라가야 한다(1번째 자리에 온
    // 카드2의 버튼이 아니라).
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '2번째 카드(카드1) 아래로' }));

    await user.click(document.activeElement as HTMLButtonElement);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '3번째 카드(카드1) 아래로' }));
  });

  it('중간 카드를 삭제해도 남은 카드의 제목이 올바른 순서로 남고, 이어지는 이동도 정확한 카드를 따라간다', async () => {
    const user = userEvent.setup();
    render(<Harness initial={payload(4)} />);

    await user.click(screen.getByRole('button', { name: '2번째 카드(카드2) 삭제' }));

    const titles = screen.getAllByLabelText(/^제목/).map((el) => (el as HTMLInputElement).value);
    expect(titles).toEqual(['카드1', '카드3', '카드4']);

    const upBtn = screen.getByRole('button', { name: '3번째 카드(카드4) 위로' });
    await user.click(upBtn);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '2번째 카드(카드4) 위로' }));
  });
});

describe('CarouselOutputEditor — 이미지 URL 인라인 검증(§3.1)', () => {
  it('http 주소는 거부된다(https 전용)', async () => {
    const user = userEvent.setup();
    render(<Harness initial={payload(2)} />);
    const imageInput = screen.getAllByLabelText('이미지 URL')[0];
    await user.type(imageInput, 'http://example.com/a.png');
    expect(screen.getByText('https 주소만 쓸 수 있습니다.')).toBeInTheDocument();
  });

  it('@ 포함 주소는 거부된다(피싱 형식)', async () => {
    const user = userEvent.setup();
    render(<Harness initial={payload(2)} />);
    const imageInput = screen.getAllByLabelText('이미지 URL')[0];
    await user.type(imageInput, 'https://a.example.com@phish.example.net/x.png');
    expect(screen.getByText(/다른 사이트로 보내는 속임수에 쓰입니다/)).toBeInTheDocument();
  });

  it('정상 https 주소는 오류가 없고, 이미지가 있으면 대체 텍스트 필수 오류가 뜬다', async () => {
    const user = userEvent.setup();
    render(<Harness initial={payload(2)} />);
    const imageInput = screen.getAllByLabelText('이미지 URL')[0];
    await user.type(imageInput, 'https://img.example.com/a.png');
    expect(screen.queryByText('https 주소만 쓸 수 있습니다.')).not.toBeInTheDocument();
    expect(screen.getByText('이미지에는 대체 텍스트가 필요합니다.')).toBeInTheDocument();
  });

  it('퓨니코드 도메인은 경고만(저장 가능, 오류 아님)', async () => {
    const user = userEvent.setup();
    render(<Harness initial={payload(2)} />);
    const imageInput = screen.getAllByLabelText('이미지 URL')[0];
    await user.type(imageInput, 'https://xn--bcdef.example.com/a.png');
    expect(screen.getByText(/국제화 도메인\(퓨니코드\)/)).toBeInTheDocument();
  });
});

describe('CarouselOutputEditor — 카드 버튼 LINK는 https 전용 검사를 받는다(carousel 카드 버튼, §3.1)', () => {
  it('카드 버튼 LINK에 http 주소를 넣으면 인라인 오류가 뜬다', async () => {
    const user = userEvent.setup();
    render(<Harness initial={payload(2)} />);
    fireEvent.click(screen.getAllByRole('button', { name: '+ 버튼 추가' })[0]);
    const actionSelect = screen.getAllByLabelText('동작')[0];
    fireEvent.change(actionSelect, { target: { value: 'LINK' } });
    const urlInput = screen.getAllByLabelText('URL')[0];
    await user.type(urlInput, 'http://example.com');
    expect(screen.getByText('https 주소만 쓸 수 있습니다.')).toBeInTheDocument();
  });
});
