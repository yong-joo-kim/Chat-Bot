// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createComposer } from './composer';

describe('composer 글자 수 안내', () => {
  it('1,000자 이하면 "N자 남음", 초과하면 "N자 초과" 글자 안내 + 전송 aria-disabled(L-5)', () => {
    const c = createComposer(vi.fn());
    document.body.append(c.root);
    const remaining = c.root.querySelector('#cb-remaining')!;
    expect(remaining.textContent).toBe('1000자 남음');
    c.insertTranscript('가'.repeat(1005));
    expect(remaining.textContent).toContain('5자 초과');
    expect(c.send.getAttribute('aria-disabled')).toBe('true');
    c.input.value = '가'.repeat(1000);
    c.input.dispatchEvent(new Event('input'));
    expect(remaining.textContent).toBe('0자 남음');
    expect(c.send.getAttribute('aria-disabled')).toBe('false');
  });
});
