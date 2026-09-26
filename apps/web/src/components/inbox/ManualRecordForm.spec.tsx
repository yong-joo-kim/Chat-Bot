import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ManualRecordForm } from './ManualRecordForm';

function renderForm(overrides: Partial<Parameters<typeof ManualRecordForm>[0]> = {}) {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  const onPreview = vi.fn().mockResolvedValue('미리보기');
  render(<ManualRecordForm saving={false} onSave={onSave} onCancel={onCancel} onPreview={onPreview} {...overrides} />);
  return { onSave, onCancel, onPreview };
}

/** 코드 리뷰 R1 Low — 기록 채널·방향을 모두 선택하기 전에는 저장 버튼을 비활성화한다(UIUX §6). */
describe('ManualRecordForm — 저장 버튼 게이팅', () => {
  it('기록 채널·방향을 아무것도 선택하지 않으면 저장 버튼이 비활성화된다', () => {
    renderForm();
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled();
  });

  it('기록 채널만 선택하면 여전히 비활성화된다', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole('radio', { name: '전화' }));
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled();
  });

  it('방향만 선택하면 여전히 비활성화된다', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole('radio', { name: '고객이 연락' }));
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled();
  });

  it('기록 채널·방향을 모두 선택하면 활성화된다', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole('radio', { name: '전화' }));
    await user.click(screen.getByRole('radio', { name: '고객이 연락' }));
    expect(screen.getByRole('button', { name: '저장' })).not.toBeDisabled();
  });

  it('저장 중(saving=true)이면 선택 여부와 무관하게 비활성화된다', async () => {
    const user = userEvent.setup();
    renderForm({ saving: true });
    await user.click(screen.getByRole('radio', { name: '전화' }));
    await user.click(screen.getByRole('radio', { name: '고객이 연락' }));
    expect(screen.getByRole('button', { name: '저장 중…' })).toBeDisabled();
  });
});
