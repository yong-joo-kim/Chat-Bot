// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFeedbackBar } from './feedback-bar';
import type { FeedbackAttemptResult, FeedbackRating } from '../core/feedback';

/** 답변 평가 막대(FB-W, `feedback-loop-ui-spec.md` §3.2) DOM 단위 시험. `core/feedback.ts`의
 * `planFeedbackAttempt` 표는 `core/feedback.spec.ts`에서 이미 검증한다 — 여기서는 그 표대로
 * 실제 버튼 속성·텍스트·`#cb-status` 안내 호출이 이어지는지만 본다. */

function setup(onRate: (rating: FeedbackRating) => Promise<FeedbackAttemptResult>) {
  const announced: string[] = [];
  const bar = createFeedbackBar({
    messageId: 'msg-1',
    onRate,
    onAnnounce: (text) => announced.push(text),
  });
  document.body.appendChild(bar);
  const up = bar.querySelector<HTMLButtonElement>('.cb-feedback-up')!;
  const down = bar.querySelector<HTMLButtonElement>('.cb-feedback-down')!;
  const note = bar.querySelector<HTMLElement>('.cb-feedback-note')!;
  return { bar, up, down, note, announced };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('ui/feedback-bar — 마크업·접근성(§3.2.2)', () => {
  it('role=group aria-label + 버튼 2개(아이콘 aria-hidden, 보이는 텍스트 라벨, aria-pressed=false)를 렌더한다', () => {
    const { bar, up, down, note } = setup(async () => 'OK');
    expect(bar.getAttribute('role')).toBe('group');
    expect(bar.getAttribute('aria-label')).toBe('답변 평가');
    expect(up.tagName).toBe('BUTTON');
    expect(up.type).toBe('button');
    expect(up.getAttribute('aria-pressed')).toBe('false');
    expect(down.getAttribute('aria-pressed')).toBe('false');
    expect(up.querySelector('.cb-feedback-icon')?.getAttribute('aria-hidden')).toBe('true');
    expect(up.querySelector('.cb-feedback-label')?.textContent).toBe('도움이 됐어요');
    expect(down.querySelector('.cb-feedback-label')?.textContent).toBe('도움이 안 됐어요');
    expect(note.getAttribute('aria-hidden')).toBe('true');
    expect(note.textContent).toBe('');
  });

  it('44×44px 이상 터치 영역 CSS 클래스(cb-feedback-btn)를 부여한다', () => {
    const { up, down } = setup(async () => 'OK');
    expect(up.className).toContain('cb-feedback-btn');
    expect(down.className).toContain('cb-feedback-btn');
  });
});

describe('ui/feedback-bar — 선택·변경·재클릭 무동작(FR-FB9-5/6)', () => {
  it('클릭 시 즉시 낙관적 표시(aria-pressed) 후 200이면 확정되고 #cb-status 안내가 1회 온다', async () => {
    let resolveRate!: (v: FeedbackAttemptResult) => void;
    const onRate = vi.fn(() => new Promise<FeedbackAttemptResult>((resolve) => { resolveRate = resolve; }));
    const { up, down, announced } = setup(onRate);

    up.click();
    expect(up.getAttribute('aria-pressed')).toBe('true'); // 낙관적 표시(요청 완료 전)
    expect(down.getAttribute('aria-pressed')).toBe('false');
    expect(up.disabled).toBe(true); // 요청 중 비활성(aria-busy)

    resolveRate('OK');
    await vi.waitFor(() => expect(announced).toEqual(['의견을 보내 주셔서 고마워요']));
    expect(up.disabled).toBe(false);
    expect(up.getAttribute('aria-pressed')).toBe('true');
    expect(onRate).toHaveBeenCalledTimes(1);
    expect(onRate).toHaveBeenCalledWith('UP');
  });

  it('이미 선택된 버튼을 다시 누르면 요청을 보내지 않는다(취소 없음, 무동작)', async () => {
    const onRate = vi.fn(async () => 'OK' as FeedbackAttemptResult);
    const { up } = setup(onRate);
    up.click();
    await vi.waitFor(() => expect(onRate).toHaveBeenCalledTimes(1));
    up.click();
    up.click();
    expect(onRate).toHaveBeenCalledTimes(1);
  });

  it('다른 버튼을 누르면 값을 변경한다', async () => {
    const onRate = vi.fn(async () => 'OK' as FeedbackAttemptResult);
    const { up, down } = setup(onRate);
    up.click();
    await vi.waitFor(() => expect(up.getAttribute('aria-pressed')).toBe('true'));
    down.click();
    await vi.waitFor(() => expect(down.getAttribute('aria-pressed')).toBe('true'));
    expect(up.getAttribute('aria-pressed')).toBe('false');
    expect(onRate).toHaveBeenCalledTimes(2);
    expect(onRate).toHaveBeenLastCalledWith('DOWN');
  });

  it('요청이 진행 중일 때는 다른 버튼 클릭도 막는다(동시 요청 방지)', async () => {
    let resolveRate!: (v: FeedbackAttemptResult) => void;
    const onRate = vi.fn(() => new Promise<FeedbackAttemptResult>((resolve) => { resolveRate = resolve; }));
    const { up, down } = setup(onRate);
    up.click();
    down.click(); // busy 중 — 무시
    expect(onRate).toHaveBeenCalledTimes(1);
    resolveRate('OK');
    await vi.waitFor(() => expect(up.disabled).toBe(false));
    expect(onRate).toHaveBeenCalledTimes(1);
  });
});

describe('ui/feedback-bar — 재시도·오류(§13.5)', () => {
  it(
    '404는 1초 뒤 1회 재시도하고, 재시도도 실패하면 두 버튼 모두 선택 해제+잠김+안내',
    async () => {
      const onRate = vi.fn(async () => 'NOT_FOUND' as FeedbackAttemptResult);
      const { up, down, note, announced } = setup(onRate);

      up.click();
      await vi.waitFor(() => expect(onRate).toHaveBeenCalledTimes(2), { timeout: 3000 });
      expect(up.getAttribute('aria-pressed')).toBe('false');
      expect(down.getAttribute('aria-pressed')).toBe('false');
      expect(up.disabled).toBe(true);
      expect(down.disabled).toBe(true);
      expect(note.textContent).toBe('지금은 의견을 받을 수 없어요');
      expect(announced).toEqual(['지금은 의견을 받을 수 없어요']);
    },
    5000,
  );

  it(
    '네트워크·서버 오류는 1초 뒤 재시도하고, 재시도도 실패하면 저장 실패 안내(잠금 없음, 재시도 가능)',
    async () => {
      const onRate = vi.fn(async () => 'NETWORK' as FeedbackAttemptResult);
      const { up, note, announced } = setup(onRate);

      up.click();
      await vi.waitFor(() => expect(onRate).toHaveBeenCalledTimes(2), { timeout: 3000 });
      expect(up.getAttribute('aria-pressed')).toBe('false'); // 직전 확정값(null)으로 복귀
      expect(up.disabled).toBe(false); // 잠금 없음 — 다시 클릭 가능
      expect(note.textContent).toBe('저장하지 못했어요');
      expect(announced).toEqual(['저장하지 못했어요']);
    },
    5000,
  );

  it('409는 재시도 없이 마지막 확정값을 유지하고 잠근다', async () => {
    const onRate = vi
      .fn<[FeedbackRating], Promise<FeedbackAttemptResult>>()
      .mockResolvedValueOnce('OK')
      .mockResolvedValueOnce('CLOSED');
    const { up, down, note, announced } = setup(onRate);

    up.click();
    await vi.waitFor(() => expect(up.getAttribute('aria-pressed')).toBe('true'));
    down.click(); // 변경 시도 — 한도 초과
    await vi.waitFor(() => expect(onRate).toHaveBeenCalledTimes(2));

    expect(up.getAttribute('aria-pressed')).toBe('true'); // 마지막 확정값(UP) 유지
    expect(down.getAttribute('aria-pressed')).toBe('false');
    expect(up.disabled).toBe(true);
    expect(down.disabled).toBe(true);
    expect(note.textContent).toBe('더 이상 바꿀 수 없어요');
    expect(announced).toEqual(['의견을 보내 주셔서 고마워요', '더 이상 바꿀 수 없어요']);
  });

  it('429는 재시도 없이 조용히 직전 값으로 복귀한다(문구 없음, 잠금 없음)', async () => {
    const onRate = vi
      .fn<[FeedbackRating], Promise<FeedbackAttemptResult>>()
      .mockResolvedValueOnce('OK')
      .mockResolvedValueOnce('RATE_LIMITED');
    const { up, down, note, announced } = setup(onRate);

    up.click();
    await vi.waitFor(() => expect(up.getAttribute('aria-pressed')).toBe('true'));
    down.click();
    await vi.waitFor(() => expect(onRate).toHaveBeenCalledTimes(2));

    expect(up.getAttribute('aria-pressed')).toBe('true');
    expect(down.getAttribute('aria-pressed')).toBe('false');
    expect(up.disabled).toBe(false);
    expect(note.textContent).toBe('');
    expect(announced).toEqual(['의견을 보내 주셔서 고마워요']); // 429는 추가 안내 없음
  });

  it('403(DISABLED)는 재시도 없이 잠기고 이용 불가 안내를 낸다', async () => {
    const onRate = vi.fn(async () => 'DISABLED' as FeedbackAttemptResult);
    const { up, note, announced } = setup(onRate);
    up.click();
    await vi.waitFor(() => expect(onRate).toHaveBeenCalledTimes(1));
    expect(up.disabled).toBe(true);
    expect(note.textContent).toBe('지금은 의견을 받을 수 없어요');
    expect(announced).toEqual(['지금은 의견을 받을 수 없어요']);
  });
});

describe('ui/feedback-bar — sessionStorage/localStorage 미사용(F-16)', () => {
  it('소스 코드에 sessionStorage·localStorage 참조가 없다', () => {
    const target = path.resolve(process.cwd(), 'src/ui/feedback-bar.ts');
    const src = readFileSync(target, 'utf-8');
    expect(src).not.toContain('sessionStorage');
    expect(src).not.toContain('localStorage');
  });
});
