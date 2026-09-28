import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { KbRunView } from '@chat-bot/shared-types';
import { KbRunTable } from './KbRunTable';

function makeRun(overrides: Partial<KbRunView> = {}): KbRunView {
  return {
    id: 'run-1',
    sourceId: 's1',
    sourceName: '인사규정 게시판',
    kind: 'SYNC',
    trigger: 'SCHEDULED',
    status: 'SUCCEEDED',
    crawl: { discovered: 312, visited: 312, unchanged: 312, added: 0, changed: 0, missing: 0, gone: 0, needsCleanup: 0, piiMasked: 0, excluded: {}, outOfScopeLinks: 0 },
    ingest: null,
    progress: null,
    etaSeconds: null,
    waitingReason: null,
    maxPagesReached: false,
    demotedReason: null,
    failureCode: null,
    resumedCount: 0,
    startedAt: new Date('2026-09-27T00:00:00.000Z'),
    crawlFinishedAt: new Date('2026-09-27T00:04:00.000Z'),
    finishedAt: new Date('2026-09-27T00:04:00.000Z'),
    createdAt: new Date('2026-09-27T00:00:00.000Z'),
    ...overrides,
  };
}

/**
 * [No.43 R1 H2] 펼침 트리거는 실제 `<button>`이라 Tab으로 포커스되고 Enter·Space로 조작할 수
 * 있어야 하며, `aria-expanded`가 상태를 반영해야 한다(`<tr onClick>`만으로는 키보드 접근 불가).
 */
describe('KbRunTable — 펼침 버튼 키보드 접근성(No.43 R1 H2)', () => {
  it('버튼의 aria-expanded는 접힘 상태에서 false다', () => {
    render(<KbRunTable items={[makeRun()]} expandedId={null} onToggleExpand={vi.fn()} canCancel={false} />);
    const toggles = screen.getAllByRole('button', { name: '펼치기' });
    expect(toggles.length).toBeGreaterThan(0);
    toggles.forEach((btn) => expect(btn).toHaveAttribute('aria-expanded', 'false'));
  });

  /** [No.43 R2 Low] 접힌 상태에서도 `aria-controls`가 가리키는 id가 실제로 DOM에 존재해야 한다
   * (조건부 렌더로 없앴다가 존재하지 않는 id를 참조하는 잘못된 ARIA 관계를 만들지 않는다).
   * 상세 영역은 `hidden` 속성으로만 감춘다. */
  it('접힌 상태에서도 aria-controls가 가리키는 상세 영역이 DOM에 존재하고 hidden 속성으로 감춰져 있다', () => {
    const { container } = render(<KbRunTable items={[makeRun()]} expandedId={null} onToggleExpand={vi.fn()} canCancel={false} />);
    const toggles = screen.getAllByRole('button', { name: '펼치기' });
    toggles.forEach((btn) => {
      const controls = btn.getAttribute('aria-controls');
      expect(controls).toBeTruthy();
      const target = container.querySelector(`#${CSS.escape(controls as string)}`);
      expect(target).not.toBeNull();
      expect(target).toHaveAttribute('hidden');
    });
  });

  it('펼쳐진 상태(expandedId 일치)면 버튼 라벨이 "접기"로 바뀌고 aria-expanded=true, aria-controls가 상세 영역 id를 가리킨다', () => {
    render(<KbRunTable items={[makeRun()]} expandedId="run-1" onToggleExpand={vi.fn()} canCancel={false} />);
    const toggles = screen.getAllByRole('button', { name: '접기' });
    expect(toggles.length).toBeGreaterThan(0);
    toggles.forEach((btn) => {
      expect(btn).toHaveAttribute('aria-expanded', 'true');
      const controls = btn.getAttribute('aria-controls');
      expect(controls).toBeTruthy();
      expect(document.getElementById(controls as string)).toBeInTheDocument();
    });
  });

  it('Tab으로 포커스한 뒤 Enter를 누르면 펼침 콜백이 호출된다(키보드 조작)', async () => {
    const user = userEvent.setup();
    const onToggleExpand = vi.fn();
    render(<KbRunTable items={[makeRun()]} expandedId={null} onToggleExpand={onToggleExpand} canCancel={false} />);

    const toggle = screen.getAllByRole('button', { name: '펼치기' })[0];
    toggle.focus();
    expect(toggle).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(onToggleExpand).toHaveBeenCalledWith('run-1');
  });

  it('Space 키로도 펼침 콜백이 호출된다', async () => {
    const user = userEvent.setup();
    const onToggleExpand = vi.fn();
    render(<KbRunTable items={[makeRun()]} expandedId={null} onToggleExpand={onToggleExpand} canCancel={false} />);

    const toggle = screen.getAllByRole('button', { name: '펼치기' })[0];
    toggle.focus();
    await user.keyboard(' ');

    expect(onToggleExpand).toHaveBeenCalledWith('run-1');
  });

  it('펼쳐진 상태에서는 데스크톱 표·모바일 카드 양쪽에 상세 내용이 보인다', () => {
    render(<KbRunTable items={[makeRun()]} expandedId="run-1" onToggleExpand={vi.fn()} canCancel={false} />);
    expect(screen.getAllByText(/방문 312/).length).toBeGreaterThan(0);
  });
});

/**
 * [No.43 pass 10 후속] PREVIEW의 AUTH_WALL은 소스 승인이 유지되는 "미리보기 경고"이고, 그 밖의 demotedReason은
 * 승인 해제를 동반하는 강등이다 — 표시 문구를 구분한다.
 */
describe('KbRunTable — 강등 사유 vs 미리보기 경고 구분', () => {
  function renderRun(run: KbRunView) {
    render(<KbRunTable items={[run]} expandedId={run.id} onToggleExpand={vi.fn()} canCancel={false} />);
  }

  it('PREVIEW + AUTH_WALL은 미리보기 경고(승인 유지) 문구로 표시한다', () => {
    renderRun(makeRun({ kind: 'PREVIEW', demotedReason: 'AUTH_WALL' }));

    expect(screen.getAllByText('미리보기 경고 — 로그인 필요로 보임(승인은 유지됩니다)').length).toBeGreaterThan(0);
    expect(screen.queryByText('로그인 필요로 보임')).not.toBeInTheDocument();
  });

  it('SYNC + AUTH_WALL은 기존 강등 문구다', () => {
    renderRun(makeRun({ kind: 'SYNC', demotedReason: 'AUTH_WALL' }));

    expect(screen.getAllByText('로그인 필요로 보임').length).toBeGreaterThan(0);
    expect(screen.queryByText(/미리보기 경고/)).not.toBeInTheDocument();
  });

  it('FULL_RESEND + AUTH_WALL도 기존 강등 문구다', () => {
    renderRun(makeRun({ kind: 'FULL_RESEND', demotedReason: 'AUTH_WALL' }));

    expect(screen.getAllByText('로그인 필요로 보임').length).toBeGreaterThan(0);
    expect(screen.queryByText(/미리보기 경고/)).not.toBeInTheDocument();
  });

  it('PREVIEW + NEW_RATIO는 기존 강등 문구다(미리보기 경고 아님)', () => {
    renderRun(makeRun({ kind: 'PREVIEW', demotedReason: 'NEW_RATIO' }));

    expect(screen.getAllByText('새 페이지 비율 급증').length).toBeGreaterThan(0);
    expect(screen.queryByText(/미리보기 경고/)).not.toBeInTheDocument();
  });

  it('demotedReason이 없으면 강등·경고 문구가 없다', () => {
    renderRun(makeRun({ kind: 'PREVIEW', demotedReason: null }));

    expect(screen.queryByText(/미리보기 경고/)).not.toBeInTheDocument();
    expect(screen.queryByText('로그인 필요로 보임')).not.toBeInTheDocument();
  });
});
