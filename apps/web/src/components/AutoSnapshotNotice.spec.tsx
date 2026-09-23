import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AutoSnapshotOutcome } from '@chat-bot/shared-types';
import { AutoSnapshotNotice } from './AutoSnapshotNotice';

function renderNotice(outcome: AutoSnapshotOutcome | undefined): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <AutoSnapshotNotice
        outcome={outcome}
        chatbotId="bot-1"
        createdText={(versionNo) => `v${versionNo}로 자동 저장됨`}
        viewLinkText="버전 이력에서 보기"
        failedText="직전 버전이 저장되지 않았습니다(작업은 완료됨)"
      />
    </MemoryRouter>,
  );
}

/**
 * 자동 스냅샷 결과 안내(`version-history-ui-spec.md` §4.5, FR-H4-6). No.16/23 증강 승인·
 * 대량 업로드 확정 등 기존 화면 E1~E4가 공유하는 컴포넌트인데, 이전에는 전용 시험이 없었다
 * (2026-09-23 신규 — No.25 커버리지 공백 보강). `outcome` 필드 부재(구버전 서버·TC 임포트
 * 등 autoSnapshot을 안 주는 응답) 시 무렌더, `FAILED` 시 경고 배지를 검증한다.
 */
describe('AutoSnapshotNotice', () => {
  it('outcome이 undefined면(필드 부재 — 구버전 서버) 아무것도 렌더하지 않는다', () => {
    const { container } = renderNotice(undefined);
    expect(container).toBeEmptyDOMElement();
  });

  it('status:CREATED면 버전 번호와 이력 링크를 보여준다', () => {
    renderNotice({ status: 'CREATED', versionNo: 27, versionId: 'ver-27' });

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('v27로 자동 저장됨');
    const link = screen.getByRole('link', { name: '버전 이력에서 보기' });
    expect(link).toHaveAttribute('href', '/chatbots/bot-1/versions');
  });

  it('status:FAILED면 경고 배지를 보여준다(EX-H-1)', () => {
    renderNotice({ status: 'FAILED' });

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('직전 버전이 저장되지 않았습니다(작업은 완료됨)');
  });

  it('status:UNCHANGED면 아무것도 렌더하지 않는다(직전과 동일 — 그 버전이 곧 롤백 지점)', () => {
    const { container } = renderNotice({ status: 'UNCHANGED', versionNo: 12 });
    expect(container).toBeEmptyDOMElement();
  });

  it('status:DISABLED면 아무것도 렌더하지 않는다(VERSION_AUTO_SNAPSHOT_ENABLED=false)', () => {
    const { container } = renderNotice({ status: 'DISABLED' });
    expect(container).toBeEmptyDOMElement();
  });

  it('status:CREATED인데 versionNo가 없으면(방어적 케이스) 렌더하지 않는다', () => {
    const { container } = renderNotice({ status: 'CREATED' } as unknown as AutoSnapshotOutcome);
    expect(container).toBeEmptyDOMElement();
  });
});
