import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KbStringListField } from './KbStringListField';
import { KbSourceEditModal } from './KbSourceEditModal';
import { MESSAGES } from '../../../constants/messages';

vi.mock('../../../api/kbSources', () => ({
  kbSourcesApi: { create: vi.fn(), update: vi.fn() },
}));

const msg = MESSAGES.kbSources;

function renderField(props: Partial<React.ComponentProps<typeof KbStringListField>> = {}) {
  return render(
    <KbStringListField
      legend="경로 접두"
      values={['/docs', '/hr']}
      onChange={vi.fn()}
      maxItems={10}
      addLabel="+ 추가"
      itemLabel={(i) => `${i + 1}번째 경로 접두`}
      {...props}
    />,
  );
}

function describedByIds(el: HTMLElement): string[] {
  return (el.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean);
}

/** [No.43 pass 6] 경로 접두 도움말(kb-crawling-ui-spec.md §3.2 KB6)을 입력 필드에 `aria-describedby`로 연결한다. */
describe('KbStringListField — 도움말·오류 aria-describedby', () => {
  it('hint가 있으면 보이는 텍스트로 렌더되고 모든 입력의 aria-describedby가 그 요소를 가리킨다', () => {
    renderField({ hint: '경로 단위로 비교합니다.' });

    const hint = screen.getByText('경로 단위로 비교합니다.');
    expect(hint.id).not.toBe('');
    for (const input of screen.getAllByRole('textbox')) {
      expect(describedByIds(input)).toEqual([hint.id]);
    }
  });

  it('hint가 없으면 aria-describedby 속성을 달지 않는다', () => {
    renderField();
    for (const input of screen.getAllByRole('textbox')) {
      expect(input).not.toHaveAttribute('aria-describedby');
    }
  });

  it('오류가 있는 항목은 도움말 id와 오류 id가 함께 연결되고, 오류 없는 항목은 도움말만 연결된다', () => {
    renderField({ hint: '경로 단위로 비교합니다.', errors: [undefined, '/로 시작해야 합니다.'] });

    const hint = screen.getByText('경로 단위로 비교합니다.');
    const error = screen.getByRole('alert');
    const [first, second] = screen.getAllByRole('textbox');

    expect(describedByIds(first)).toEqual([hint.id]);
    expect(describedByIds(second)).toEqual([hint.id, error.id]);
    expect(second).toHaveAttribute('aria-invalid', 'true');
    expect(document.getElementById(error.id)).toBe(error);
  });

  it('hint 없이 오류만 있으면 오류 id만 연결된다', () => {
    renderField({ errors: ['오류입니다.'] });

    const error = screen.getByRole('alert');
    expect(describedByIds(screen.getAllByRole('textbox')[0])).toEqual([error.id]);
  });

  it('같은 화면에 필드가 여러 개여도 id가 겹치지 않고 각 레이블이 자기 입력에 연결된다', () => {
    render(
      <>
        <KbStringListField legend="A" values={['a']} onChange={vi.fn()} maxItems={5} addLabel="+ A" itemLabel={() => 'A 항목'} hint="A 도움말" />
        <KbStringListField legend="B" values={['b']} onChange={vi.fn()} maxItems={5} addLabel="+ B" itemLabel={() => 'B 항목'} hint="B 도움말" />
      </>,
    );

    const a = screen.getByLabelText('A 항목');
    const b = screen.getByLabelText('B 항목');
    expect(a).toHaveValue('a');
    expect(b).toHaveValue('b');
    expect(describedByIds(a)).toEqual([screen.getByText('A 도움말').id]);
    expect(describedByIds(b)).toEqual([screen.getByText('B 도움말').id]);
  });
});

describe('KbSourceEditModal — 경로 접두 도움말', () => {
  it('경로 접두 입력의 aria-describedby가 세그먼트 단위 비교 도움말을 가리킨다', async () => {
    const user = userEvent.setup();
    render(<KbSourceEditModal isOpen source={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    // 경로 접두는 기본 0행이므로 한 행 추가 후 확인한다.
    await user.click(screen.getByRole('button', { name: msg.formAddPathPrefix }));
    const input = screen.getByLabelText('1번째 경로 접두');
    const hint = screen.getByText(msg.formPathPrefixHint);

    expect(msg.formPathPrefixHint).toContain('/docs-guide');
    expect(msg.formPathPrefixHint).toContain('/docsecret');
    expect(describedByIds(input)).toContain(hint.id);
  });
});
