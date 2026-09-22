import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AnswerSettingsPreviewPanel } from './AnswerSettingsPreviewPanel';

/**
 * `formDiffersFromSaved`(→ `AnswerSettingsPage`의 `dirty`) 배지 노출 회귀 시험(code-reviewer
 * 지적, Medium) — 미리보기가 "저장된 설정" 기준으로 판정된다는 사실을 조용한 캡션만으로는
 * 사용자가 놓칠 수 있어 `SeverityBadge(WARNING)`로 상시 고지한다(UIUX_준수기준.md §1 색상 단독
 * 전달 금지 — 아이콘+텍스트 병기).
 */
describe('AnswerSettingsPreviewPanel — 미저장 변경 경고 배지', () => {
  it('dirty=true(폼이 저장된 설정과 다름)면 WARNING 배지가 노출된다', () => {
    render(<AnswerSettingsPreviewPanel onPreview={vi.fn()} formDiffersFromSaved={true} />);
    const badge = screen.getByText(/저장되지 않은|미저장|다릅니다|다름/);
    expect(badge).toBeInTheDocument();
  });

  it('dirty=false(기본값, 폼이 저장된 설정과 동일)면 WARNING 배지가 노출되지 않는다', () => {
    render(<AnswerSettingsPreviewPanel onPreview={vi.fn()} />);
    expect(screen.queryByText(/저장되지 않은|미저장|다릅니다|다름/)).not.toBeInTheDocument();
  });
});
