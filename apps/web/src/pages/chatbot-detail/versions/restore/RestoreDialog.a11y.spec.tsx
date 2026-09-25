import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { MemoryRouter } from 'react-router-dom';
import type { RestorePreviewResponse } from '@chat-bot/shared-types';
import { ToastProvider } from '../../../../components/Toast';
import { RestoreDialog } from './RestoreDialog';

expect.extend(toHaveNoViolations);

const mockRestorePreview = vi.fn();
vi.mock('../../../../api/versions', () => ({
  versionsApi: { restorePreview: (...args: unknown[]) => mockRestorePreview(...args), restore: vi.fn() },
}));

function preview(overrides: Partial<RestorePreviewResponse> = {}): RestorePreviewResponse {
  return {
    targetVersion: { id: 'ver-27', versionNo: 27, trigger: 'MANUAL', createdAt: new Date('2026-09-01T00:00:00.000Z'), schemaVersion: 1 },
    currentContentHash: 'a'.repeat(64),
    targetContentHash: 'b'.repeat(64),
    diffSummary: { rows: [], totalChanged: 0, identical: false },
    changesUndone: 3,
    laterVersionCount: 1,
    blockers: [],
    warnings: [{ code: 'TOPIC_EXPOSURE_CHANGE', exposed: 18, hidden: 3 }],
    restorable: true,
    ...overrides,
  };
}

/** `TOPIC_EXPOSURE_CHANGE` 확인 체크박스 상태의 axe 접근성 스캔(topic-system-ui-spec.md §6.4). */
describe('RestoreDialog(TOPIC_EXPOSURE_CHANGE) — axe 접근성 스캔', () => {
  it('구조적 접근성 위반이 없다', async () => {
    mockRestorePreview.mockResolvedValue(preview());
    const { container } = render(
      <MemoryRouter>
        <ToastProvider>
          <RestoreDialog chatbotId="bot-1" targetVersionId="ver-27" targetVersionNo={27} isOpen onClose={vi.fn()} onRestored={vi.fn()} />
        </ToastProvider>
      </MemoryRouter>,
    );
    await screen.findByRole('checkbox', { name: /준비 중이던 자산 18건/ });

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
