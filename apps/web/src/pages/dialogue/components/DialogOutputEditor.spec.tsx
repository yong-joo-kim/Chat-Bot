import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import type { DialogOutput } from '@chat-bot/shared-types';
import { DialogOutputEditor } from './DialogOutputEditor';

// [No.26] `ApiConnectionPickerField`(v2 API 조건분기 폼)가 `useAuth()`를 사용한다.
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

/**
 * 노드 편집 폼의 아웃풋 타입 전환 회귀 시험(FR-5-14, ui-spec §4.2.1). 타입을 바꾸면
 * ① 이전 타입의 서브폼이 사라지고 새 타입의 서브폼이 나타나며 ② 기본 payload로 초기화되고
 * ③ 새 서브폼의 첫 입력 필드로 포커스가 이동한다. ResourcePickerField 연동이 필요한
 * CONTEXT_FORM/DIALOG_MOVE/API_CONDITION는 네트워크 목이 필요해 이 파일 범위 밖이다(별도 시험 후보).
 */
describe('DialogOutputEditor — 아웃풋 타입 전환', () => {
  it('TEXT → CARD로 전환하면 텍스트 필드가 사라지고 카드 필드(제목/설명/이미지)가 나타난다', async () => {
    const user = userEvent.setup();
    const onChangeSpy = vi.fn();
    render(<Harness initial={{ type: 'TEXT', payload: { text: '안녕하세요' } }} onChangeSpy={onChangeSpy} />);

    expect(screen.getByLabelText(/텍스트/)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('유형'), '카드');

    expect(onChangeSpy).toHaveBeenCalledWith({ type: 'CARD', payload: { title: '' } });
    expect(screen.queryByLabelText(/^텍스트/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/제목/)).toBeInTheDocument();
    expect(screen.getByLabelText('설명')).toBeInTheDocument();
    expect(screen.getByLabelText('이미지 URL')).toBeInTheDocument();
  });

  it('CARD → IMAGE로 전환하면 대체 텍스트 필수 필드가 나타나고, 이미지 URL 필드로 포커스가 이동한다', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ type: 'CARD', payload: { title: '제목값' } }} onChangeSpy={vi.fn()} />);

    await user.selectOptions(screen.getByLabelText('유형'), '이미지');

    const imageUrlInput = screen.getByLabelText(/이미지 URL/);
    expect(imageUrlInput).toBeInTheDocument();
    expect(screen.getByLabelText(/대체 텍스트/)).toBeInTheDocument();
    expect(imageUrlInput).toHaveFocus();
  });

  it('IMAGE → BUTTON으로 전환하면 버튼 목록 편집기(+ 버튼 추가)가 나타난다', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ type: 'IMAGE', payload: { imageUrl: 'https://a.com/x.png', altText: '설명' } }} onChangeSpy={vi.fn()} />);

    await user.selectOptions(screen.getByLabelText('유형'), '버튼');

    expect(screen.getByRole('button', { name: '+ 버튼 추가' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/대체 텍스트/)).not.toBeInTheDocument();
  });

  it('BUTTON → PAUSE로 전환하면 지연 시간(ms) 숫자 입력이 나타나고 기본값 1000이다', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ type: 'BUTTON', payload: { buttons: [] } }} onChangeSpy={vi.fn()} />);

    await user.selectOptions(screen.getByLabelText('유형'), '지연');

    const durationInput = screen.getByLabelText('지연 시간(ms)') as HTMLInputElement;
    expect(durationInput.value).toBe('1000');
    expect(durationInput).toHaveFocus();
  });

  it('SCENARIO/SURVEY/API_CONDITION으로 전환하면 "이번 버전에서는 실행되지 않습니다" 배지가 표시된다(FR-5-15)', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ type: 'TEXT', payload: { text: '' } }} onChangeSpy={vi.fn()} />);

    expect(screen.queryByText(/이번 버전에서는 실행되지 않습니다/)).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('유형'), '설문 연동');

    expect(screen.getByText(/이번 버전에서는 실행되지 않습니다/)).toBeInTheDocument();
    expect(screen.getByLabelText(/설문 ID/)).toBeInTheDocument();
  });

  it('TEXT 글자수 카운터가 입력에 따라 실시간으로 갱신된다(UIUX §5)', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ type: 'TEXT', payload: { text: '' } }} onChangeSpy={vi.fn()} />);

    expect(screen.getByText('0/1000자')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/텍스트/), '안녕');
    expect(screen.getByText('2/1000자')).toBeInTheDocument();
  });

  // [No.26] API 조건분기 v1/v2 분기 — `isUnsupportedOutput()`/`isApiConditionV2()` 공용 판정 회귀.
  it('TEXT → API 조건분기로 전환하면 v2(연결 레지스트리) 폼이 나타나고, 미지원 배지는 뜨지 않는다', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ type: 'TEXT', payload: { text: '' } }} onChangeSpy={vi.fn()} />);

    await user.selectOptions(screen.getByLabelText('유형'), 'API 조건분기');

    expect(screen.queryByText(/이번 버전에서는 실행되지 않습니다/)).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '연결' })).toBeInTheDocument();
  });

  it('이전 형식(v1) API_CONDITION 데이터는 읽기 전용 카드로 표시되고 "연결로 전환" 버튼을 제공한다(FR-L1-1)', () => {
    render(
      <Harness
        initial={{
          type: 'API_CONDITION',
          payload: {
            method: 'GET',
            url: 'https://erp.corp.local/',
            conditions: [{ path: 'data.status', operator: 'EQ', value: 'A', nextNodeId: '11111111-1111-1111-1111-111111111111' }],
          },
        }}
        onChangeSpy={vi.fn()}
      />,
    );

    expect(screen.getByText(/이전 형식 — 실행되지 않습니다/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '연결로 전환' })).toBeInTheDocument();
  });

  it('"연결로 전환" 확인 시 메서드·조건만 옮겨진 v2 초안으로 교체된다(ui-spec §3.3)', async () => {
    const user = userEvent.setup();
    const onChangeSpy = vi.fn();
    render(
      <Harness
        initial={{
          type: 'API_CONDITION',
          payload: {
            method: 'GET',
            url: 'https://erp.corp.local/',
            conditions: [{ path: 'data.status', operator: 'EQ', value: 'A', nextNodeId: '11111111-1111-1111-1111-111111111111' }],
          },
        }}
        onChangeSpy={onChangeSpy}
      />,
    );

    await user.click(screen.getByRole('button', { name: '연결로 전환' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: '연결로 전환' }));

    expect(onChangeSpy).toHaveBeenCalledWith({
      type: 'API_CONDITION',
      payload: {
        version: 2,
        connectionId: '',
        method: 'GET',
        path: '/',
        pathParams: [],
        query: [],
        body: [],
        responseMappings: [],
        conditions: [{ path: 'data.status', operator: 'EQ', value: 'A', nextNodeId: '11111111-1111-1111-1111-111111111111' }],
      },
    });
    expect(screen.queryByText(/이전 형식 — 실행되지 않습니다/)).not.toBeInTheDocument();
  });
});
