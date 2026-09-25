import { useState, type ComponentProps } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe, toHaveNoViolations } from 'jest-axe';
import type { BundleTarget } from '@chat-bot/shared-types';
import { TargetSelectField } from './TargetSelectField';

expect.extend(toHaveNoViolations);

const mockList = vi.fn();
vi.mock('../api/versions', () => ({
  versionsApi: {
    list: (...args: unknown[]) => mockList(...args),
  },
}));

function Controlled({ initial = { kind: 'DRAFT' } as BundleTarget, ...rest }: Partial<ComponentProps<typeof TargetSelectField>> & { initial?: BundleTarget }) {
  const [value, setValue] = useState(initial);
  return (
    <TargetSelectField
      chatbotId="bot-1"
      value={value}
      onChange={setValue}
      environmentEnabled
      stagingVersionNo={44}
      prodVersionNo={43}
      {...rest}
    />
  );
}

describe('TargetSelectField', () => {
  beforeEach(() => {
    mockList.mockReset().mockResolvedValue({ items: [{ id: 'ver-40', versionNo: 40, label: null }], total: 1, page: 1, pageSize: 50 });
  });

  it('environmentEnabled=false면 렌더하지 않는다(§4.13)', () => {
    const { container } = render(
      <TargetSelectField chatbotId="bot-1" value={{ kind: 'DRAFT' }} onChange={vi.fn()} environmentEnabled={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('초안/스테이징/운영 옵션을 보여주고, 항상 초안이 기본값이다', () => {
    render(<Controlled />);
    const select = screen.getByLabelText('대상') as HTMLSelectElement;
    expect(select.value).toBe('DRAFT');
    expect(screen.getByRole('option', { name: '스테이징(v44)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '운영(v43)' })).toBeInTheDocument();
  });

  it('스테이징을 선택하면 onChange({kind:"STAGING"})가 호출된다', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TargetSelectField chatbotId="bot-1" value={{ kind: 'DRAFT' }} onChange={onChange} environmentEnabled stagingVersionNo={44} prodVersionNo={43} />);
    await user.selectOptions(screen.getByLabelText('대상'), '스테이징(v44)');
    expect(onChange).toHaveBeenCalledWith({ kind: 'STAGING' });
  });

  it('"버전 선택..."을 고르면 팝오버가 열리고 검색 결과를 클릭하면 VERSION 대상을 반환한다', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.selectOptions(screen.getByLabelText('대상'), '버전 선택...');

    await waitFor(() => expect(mockList).toHaveBeenCalledWith('bot-1', { pageSize: 50 }));
    const versionButton = await screen.findByRole('button', { name: 'v40' });
    await user.click(versionButton);

    // 선택 후 select 옵션 라벨이 v40으로 바뀐다.
    expect(screen.getByRole('option', { name: 'v40' })).toBeInTheDocument();
  });

  it('검색 결과가 없으면 안내 문구를 보여준다', async () => {
    mockList.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
    const user = userEvent.setup();
    render(<Controlled />);
    await user.selectOptions(screen.getByLabelText('대상'), '버전 선택...');
    await screen.findByText('검색 결과가 없습니다.');
  });

  it('disabled=true면 select가 aria-disabled이고 이유를 보여준다(오버레이 상호배제, AC-EN6-2)', () => {
    render(<Controlled disabled disabledReason="오버레이는 초안 대상에서만 사용할 수 있습니다." />);
    expect(screen.getByLabelText('대상')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('오버레이는 초안 대상에서만 사용할 수 있습니다.')).toBeInTheDocument();
  });

  it('axe 스캔 위반 0건', async () => {
    const { container } = render(<Controlled />);
    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
