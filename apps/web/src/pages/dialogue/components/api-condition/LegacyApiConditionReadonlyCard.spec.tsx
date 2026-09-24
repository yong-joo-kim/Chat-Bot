import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ApiConditionOutputPayloadV1 } from '@chat-bot/shared-types';
import { LegacyApiConditionReadonlyCard } from './LegacyApiConditionReadonlyCard';

function payload(): ApiConditionOutputPayloadV1 {
  return {
    method: 'GET',
    url: 'https://erp.corp.local/',
    conditions: [{ path: 'data.status', operator: 'EQ', value: 'A', nextNodeId: '11111111-1111-1111-1111-111111111111' }],
  };
}

/**
 * [No.26 1차 코드리뷰 반영] `API_OUTPUT_LEGACY_FORMAT` 저장 거부 시 스크롤·포커스 강조(ui-spec §3.3-5).
 * `highlightToken`이 `undefined → 숫자`로 바뀔 때만 효과가 발동해야 한다(최초 마운트 시에는 발동하지 않음).
 */
describe('LegacyApiConditionReadonlyCard — 저장 거부 시 강조', () => {
  it('highlightToken이 undefined에서 값으로 바뀌면 카드가 스크롤되고 "연결로 전환" 버튼에 포커스가 간다', () => {
    // ⚠ jsdom은 `HTMLElement.prototype.scrollIntoView`를 own-property로 이미 정의해 두므로(no-op),
    // `Element.prototype`에 스파이를 달면 프로토타입 체인에서 가려져 호출되지 않는다.
    const scrollIntoViewSpy = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoViewSpy;

    const { rerender } = render(<LegacyApiConditionReadonlyCard value={payload()} onConvert={vi.fn()} highlightToken={undefined} />);
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '연결로 전환' })).not.toHaveFocus();

    rerender(<LegacyApiConditionReadonlyCard value={payload()} onConvert={vi.fn()} highlightToken={12345} />);

    expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '연결로 전환' })).toHaveFocus();
  });

  it('highlightToken이 없으면(undefined 유지) 강조 클래스가 붙지 않는다', () => {
    render(<LegacyApiConditionReadonlyCard value={payload()} onConvert={vi.fn()} />);
    expect(document.querySelector('.legacy-api-condition-card--highlight')).not.toBeInTheDocument();
  });
});
