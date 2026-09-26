import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import type { DialogOutput } from '@chat-bot/shared-types';
import { ChannelPreviewSection } from './ChannelPreviewSection';

expect.extend(toHaveNoViolations);

const outputs: DialogOutput[] = [
  { type: 'TEXT', payload: { text: '요금제를 카드로 보여드릴게요' } } as DialogOutput,
  {
    type: 'CAROUSEL',
    payload: { version: 1, cards: [{ title: '스타터' }, { title: '스탠다드' }] },
  } as DialogOutput,
];

/** RM-3 — 채널별 미리보기 axe 접근성 스캔(UIUX §1·§3). */
describe('ChannelPreviewSection — axe 접근성 스캔', () => {
  it('구조적 접근성 위반이 없다', async () => {
    const { container } = render(<ChannelPreviewSection outputs={outputs} />);
    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
