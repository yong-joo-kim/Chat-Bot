import { isWatchWindowMissed } from './watch-window';

const NOW = new Date('2026-01-01T00:10:00Z');
const WINDOW_MS = 180_000; // 3분

describe('isWatchWindowMissed — EX-CS-3', () => {
  it('마지막 턴이 응답됨이면 관찰 창이 열린 적이 없어 true다', () => {
    expect(isWatchWindowMissed({ lastTurnAt: NOW, lastTurnUnanswered: false, now: NOW, watchWindowMs: WINDOW_MS })).toBe(true);
  });

  it('로그가 없으면(lastTurnAt=null) true다', () => {
    expect(isWatchWindowMissed({ lastTurnAt: null, lastTurnUnanswered: true, now: NOW, watchWindowMs: WINDOW_MS })).toBe(true);
  });

  it('미응답 턴 직후(창 안)면 false다', () => {
    const lastTurnAt = new Date(NOW.getTime() - 60_000); // 1분 전
    expect(isWatchWindowMissed({ lastTurnAt, lastTurnUnanswered: true, now: NOW, watchWindowMs: WINDOW_MS })).toBe(false);
  });

  it('미응답 턴이 창을 벗어났으면(3분 경과) true다', () => {
    const lastTurnAt = new Date(NOW.getTime() - 180_000);
    expect(isWatchWindowMissed({ lastTurnAt, lastTurnUnanswered: true, now: NOW, watchWindowMs: WINDOW_MS })).toBe(true);
  });

  it('경계값 — 2:59는 아직 창 안이다', () => {
    const lastTurnAt = new Date(NOW.getTime() - 179_000);
    expect(isWatchWindowMissed({ lastTurnAt, lastTurnUnanswered: true, now: NOW, watchWindowMs: WINDOW_MS })).toBe(false);
  });
});
