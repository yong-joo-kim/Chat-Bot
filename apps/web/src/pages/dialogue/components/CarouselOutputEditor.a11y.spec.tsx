import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import type { CarouselOutputPayloadV1 } from '@chat-bot/shared-types';
import { CarouselOutputEditor } from './CarouselOutputEditor';

expect.extend(toHaveNoViolations);

function Harness(): JSX.Element {
  const [value, setValue] = useState<CarouselOutputPayloadV1>({
    version: 1,
    cards: [
      { title: '스타터 요금제', description: '월 3만원', buttons: [{ label: '자세히 보기', action: 'MESSAGE', value: '자세히 보기' }] },
      { title: '스탠다드 요금제' },
    ],
  });
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

/** RM-1 — 캐러셀 편집기 axe 접근성 스캔(UIUX §5·§6). */
describe('CarouselOutputEditor — axe 접근성 스캔', () => {
  it('구조적 접근성 위반이 없다', async () => {
    const { container } = render(<Harness />);
    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
