import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { LiveSessionRow } from '@chat-bot/shared-types';
import { LiveSessionTable } from './LiveSessionTable';

function makeRow(overrides: Partial<LiveSessionRow> = {}): LiveSessionRow {
  return {
    sessionRef: 'a'.repeat(16),
    alias: 'a1b2c3',
    channelType: 'WEB',
    firstAt: new Date('2026-09-24T01:00:00.000Z'),
    lastAt: new Date('2026-09-24T01:05:00.000Z'),
    turnCount: 4,
    consecutiveUnanswered: 1,
    windowUnanswered: 2,
    blockedCount: 0,
    alertLevel: 'CAUTION',
    lastUserText: '환불 계좌를 바꾸고 싶어요',
    handoffSupported: true,
    ...overrides,
  };
}

/**
 * [신규 No.45, 코드 리뷰 R1 §9] 진행 중 세션 목록의 "마지막 사용자 발화"도 보존기간 경과로 소거될 수
 * 있다(data-governance-ui-spec.md §3.7). `lastUserTextPurged`는 아직 shared-types에 없어(2026-09-26
 * 시점) 좁은 캐스팅으로 읽는다 — 이 스펙도 같은 방식으로 목 데이터를 만든다.
 */
describe('LiveSessionTable — 마지막 사용자 발화 파기 표시(No.45)', () => {
  it('lastUserTextPurged가 없으면(정상) 발화 원문을 그대로 보여준다', () => {
    render(
      <MemoryRouter>
        <LiveSessionTable items={[makeRow()]} chatbotId="bot-1" />
      </MemoryRouter>,
    );
    expect(screen.getAllByText('환불 계좌를 바꾸고 싶어요').length).toBeGreaterThan(0);
  });

  it('lastUserTextPurged:true이면 원문 대신 "보존기간 경과로 파기됨"을 보여준다', () => {
    const row = { ...makeRow({ lastUserText: '' }), lastUserTextPurged: true } as LiveSessionRow;
    render(
      <MemoryRouter>
        <LiveSessionTable items={[row]} chatbotId="bot-1" />
      </MemoryRouter>,
    );
    expect(screen.getAllByText('보존기간 경과로 파기됨').length).toBeGreaterThan(0);
    expect(screen.queryByText('환불 계좌를 바꾸고 싶어요')).not.toBeInTheDocument();
  });
});
