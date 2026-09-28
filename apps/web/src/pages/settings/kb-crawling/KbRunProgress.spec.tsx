import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { KbRunView } from '@chat-bot/shared-types';
import { KbRunProgress } from './KbRunProgress';

function makeRun(overrides: Partial<KbRunView> = {}): KbRunView {
  return {
    id: 'run-1',
    sourceId: 's1',
    sourceName: '인사규정 게시판',
    kind: 'SYNC',
    trigger: 'SCHEDULED',
    status: 'INGESTING',
    crawl: { discovered: 312, visited: 312, unchanged: 0, added: 312, changed: 0, missing: 0, gone: 0, needsCleanup: 0, piiMasked: 0, excluded: {}, outOfScopeLinks: 0 },
    ingest: { total: 312, pending: 192, inFlight: 0, succeeded: 120, failed: 0, unknown: 0, timeout: 0, cancelled: 0, skipped: 0 },
    progress: { done: 120, total: 312 },
    etaSeconds: null,
    waitingReason: null,
    maxPagesReached: false,
    demotedReason: null,
    failureCode: null,
    resumedCount: 0,
    startedAt: new Date('2026-09-27T00:00:00.000Z'),
    crawlFinishedAt: new Date('2026-09-27T00:08:00.000Z'),
    finishedAt: null,
    createdAt: new Date('2026-09-27T00:00:00.000Z'),
    ...overrides,
  };
}

/**
 * [3차 보완] `KbRunProgress` 예상 소요 표시 — 서버 `etaSeconds`(실측)를 우선 쓰고, 1시간 미만이면
 * 분 단위로 더 정확히 보여준다(kb-crawling-ui-spec.md §3.4 "약 3시간 남음" 문구의 실측 버전).
 */
describe('KbRunProgress — 예상 소요(etaSeconds)', () => {
  it('etaSeconds가 1시간 미만이면 분 단위로 보여준다', () => {
    render(<KbRunProgress run={makeRun({ etaSeconds: 300 })} />);
    expect(screen.getByText(/약 5분 남음/)).toBeInTheDocument();
  });

  it('etaSeconds가 1시간 이상이면 시간 단위로 보여준다', () => {
    render(<KbRunProgress run={makeRun({ etaSeconds: 10800 })} />);
    expect(screen.getByText(/약 3시간 남음/)).toBeInTheDocument();
  });

  it('etaSeconds가 null이면 예상 소요 문구 자체를 생략한다', () => {
    render(<KbRunProgress run={makeRun({ etaSeconds: null })} />);
    expect(screen.queryByText(/남음/)).not.toBeInTheDocument();
  });

  it('etaSeconds가 0이면(대기 없음) 예상 소요 문구를 생략한다', () => {
    render(<KbRunProgress run={makeRun({ etaSeconds: 0 })} />);
    expect(screen.queryByText(/남음/)).not.toBeInTheDocument();
  });
});
