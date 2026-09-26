import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { RetentionPreviewResponse } from '@chat-bot/shared-types';
import { RetentionPreviewTable } from './RetentionPreviewTable';

function makePreview(overrides: Partial<RetentionPreviewResponse> = {}): RetentionPreviewResponse {
  return {
    items: [],
    requiresConfirm: false,
    ...overrides,
  };
}

/**
 * [코드 리뷰 R1 L-3] 단축이 아닌 경우를 "진짜 변경 없음"과 "연장"으로 나눈다(§3.2.1).
 */
describe('RetentionPreviewTable', () => {
  it('currentDays === newDays(둘 다 같은 유한값)면 "변경 없음"을 보여준다', () => {
    render(
      <RetentionPreviewTable
        preview={makePreview({
          items: [{ kind: 'CONVERSATION_TEXT', currentDays: 180, newDays: 180, shortening: false, affectedCount: null, firstPurgeAt: null }],
        })}
      />,
    );
    expect(screen.getByText('대화 로그 본문: 변경 없음')).toBeInTheDocument();
  });

  it('currentDays === newDays === null(무기한 → 무기한)이어도 "변경 없음"을 보여준다', () => {
    render(
      <RetentionPreviewTable
        preview={makePreview({
          items: [{ kind: 'SURVEY_FREE_TEXT', currentDays: null, newDays: null, shortening: false, affectedCount: null, firstPurgeAt: null }],
        })}
      />,
    );
    expect(screen.getByText('설문 자유 텍스트: 변경 없음')).toBeInTheDocument();
  });

  it('유한값 → 더 큰 유한값(연장)이면 "{현재} → {새 값}(연장)"으로 보여준다', () => {
    render(
      <RetentionPreviewTable
        preview={makePreview({
          items: [{ kind: 'HANDOFF_TEXT', currentDays: 90, newDays: 180, shortening: false, affectedCount: null, firstPurgeAt: null }],
        })}
      />,
    );
    expect(screen.getByText('상담 메시지: 90일 → 180일(연장)')).toBeInTheDocument();
  });

  it('유한값 → 무기한(연장)이면 "{현재} → 무기한(연장)"으로 보여준다', () => {
    render(
      <RetentionPreviewTable
        preview={makePreview({
          items: [{ kind: 'CALL_LOGS', currentDays: 90, newDays: null, shortening: false, affectedCount: null, firstPurgeAt: null }],
        })}
      />,
    );
    expect(screen.getByText('외부 연동 호출 로그: 90일 → 무기한(연장)')).toBeInTheDocument();
  });

  it('단축(shortening=true)이면 기존처럼 영향 행 수·파기 예정일을 보여준다', () => {
    render(
      <RetentionPreviewTable
        preview={makePreview({
          items: [
            {
              kind: 'CONVERSATION_TEXT',
              currentDays: 180,
              newDays: 90,
              shortening: true,
              affectedCount: 1204331,
              firstPurgeAt: new Date('2026-10-03T00:00:00.000Z'),
            },
          ],
        })}
      />,
    );
    expect(screen.getByText(/대화 로그 본문: 90일로 단축 → 1,204,331행/)).toBeInTheDocument();
  });
});
