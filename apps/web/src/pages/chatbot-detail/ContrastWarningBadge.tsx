import { evaluateHeaderContrast } from '../../lib/contrast';
import { MESSAGES } from '../../constants/messages';

/**
 * 명도대비 경고(FR-4-6, AC-4-3). 서버 왕복 없이 클라이언트에서 즉시 계산하며,
 * 기준(4.5:1) 미달이어도 저장을 막지 않는다.
 */
export function ContrastWarningBadge({ primaryColor }: { primaryColor: string }): JSX.Element | null {
  const result = evaluateHeaderContrast(primaryColor);
  if (!result || result.passes) return null;
  return (
    <p className="contrast-warning" role="status">
      <span aria-hidden="true">⚠</span> {MESSAGES.skin.contrastWarningPrefix} {result.ratio.toFixed(1)}:1{' '}
      {MESSAGES.skin.contrastWarningSuffix}
      <br />
      {MESSAGES.skin.contrastSuggestion(result.suggestedTextColor)}
    </p>
  );
}
