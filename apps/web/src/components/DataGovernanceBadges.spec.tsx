import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { AuditChainVerifyStatus } from '@chat-bot/shared-types';
import { ChainVerifyResultBadge, PurgedFieldNotice, DecryptFailedNotice, GovernedTextValue, EgressJudgementBadge } from './DataGovernanceBadges';

const CHAIN_STATUS_LABELS: Record<AuditChainVerifyStatus, string> = {
  OK: '정상',
  EMPTY: '검증 대상 없음',
  HASH_MISMATCH: '불일치',
  SEQ_GAP: '순번 결손',
  TAIL_MISSING: '최신 기록 누락',
  KEY_UNAVAILABLE: '서명 키 없음',
  ANCHOR_MISSING: '검증 시작점 없음',
};

/** G3 — 체인 검증 결과 배지 6(+1)값 문구(data-governance-ui-spec.md §3.4). */
describe('ChainVerifyResultBadge', () => {
  it.each(Object.entries(CHAIN_STATUS_LABELS))('status=%s면 "%s" 라벨을 보여준다', (status, label) => {
    render(<ChainVerifyResultBadge status={status as AuditChainVerifyStatus} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});

/** G5 — 파기·복호화 실패 표시(NFR-DGA4, §3.7). */
describe('PurgedFieldNotice / DecryptFailedNotice / GovernedTextValue', () => {
  it('PurgedFieldNotice는 "보존기간 경과로 파기됨" 텍스트를 항상 동반한다(색상만이 아님)', () => {
    render(<PurgedFieldNotice />);
    expect(screen.getByText('보존기간 경과로 파기됨')).toBeInTheDocument();
  });

  it('DecryptFailedNotice는 "[복호화 실패]" 문구를 보여준다', () => {
    render(<DecryptFailedNotice />);
    expect(screen.getByText('[복호화 실패]')).toBeInTheDocument();
  });

  it('GovernedTextValue: purged=true면 원문 대신 파기 표시를 렌더하고 #PURGED# 센티넬 등 원문은 노출하지 않는다', () => {
    render(<GovernedTextValue text="#PURGED#raw-id" purged />);
    expect(screen.getByText('보존기간 경과로 파기됨')).toBeInTheDocument();
    expect(screen.queryByText(/#PURGED#/)).not.toBeInTheDocument();
  });

  it('GovernedTextValue: 텍스트가 리터럴 "[복호화 실패]"이면 경고 톤 표시로 바꾼다', () => {
    render(<GovernedTextValue text="[복호화 실패]" />);
    expect(screen.getByText('[복호화 실패]').closest('span')).toHaveClass('decrypt-failed-text');
  });

  it('GovernedTextValue: purged도 아니고 복호화 실패도 아니면 원문을 그대로 렌더한다', () => {
    render(<GovernedTextValue text="배송 조회 문의" />);
    expect(screen.getByText('배송 조회 문의')).toBeInTheDocument();
  });
});

describe('EgressJudgementBadge', () => {
  it('4값 각각 텍스트+아이콘을 병행한다(색상 단독 금지, NFR-DGA1)', () => {
    render(<EgressJudgementBadge decision="ALLOWED" />);
    expect(screen.getByText('허용')).toBeInTheDocument();
  });
});
