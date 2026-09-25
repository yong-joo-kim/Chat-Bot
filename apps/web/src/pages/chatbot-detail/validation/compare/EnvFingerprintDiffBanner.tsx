import type { FingerprintDiffBadge, ResolvedBundleTarget } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../../constants/messages';
import { targetLabel } from '../../../../components/TargetBadge';

export interface EnvFingerprintDiffBannerProps {
  diffs: FingerprintDiffBadge[];
  /** [신규 No.40 — §4.14] 없음(undefined) = 초안. 두 실행의 대상이 다르면 경고 1줄을 함께 보여준다. */
  baseTarget?: ResolvedBundleTarget;
  targetTarget?: ResolvedBundleTarget;
}

function sameTarget(a?: ResolvedBundleTarget, b?: ResolvedBundleTarget): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.kind === b.kind && a.versionId === b.versionId;
}

/** 임베딩 모델/저하모드/임계값 불일치 강한 경고(ui-spec §4.5) + 대상 다름 경고(§4.14). */
export function EnvFingerprintDiffBanner({ diffs, baseTarget, targetTarget }: EnvFingerprintDiffBannerProps): JSX.Element | null {
  const targetsDiffer = !sameTarget(baseTarget, targetTarget);
  if (diffs.length === 0 && !targetsDiffer) return null;
  const hasEmbeddingModelDiff = diffs.some((d) => d.key === 'embeddingModelId');
  const msg = MESSAGES.validation.compare;
  return (
    <div className={`form-banner ${hasEmbeddingModelDiff ? 'form-banner--error' : 'form-banner--info'}`} role="alert">
      {diffs.length > 0 && (
        <>
          <span aria-hidden="true">⚠</span> {msg.fingerprintDiffBanner}
          <ul>
            {diffs.map((d) => (
              <li key={d.key}>{d.label}</li>
            ))}
          </ul>
        </>
      )}
      {hasEmbeddingModelDiff && <p>{msg.strongWarningEmbeddingModel}</p>}
      {targetsDiffer && (
        <p>
          <span aria-hidden="true">⚠</span>{' '}
          {msg.targetMismatchWarning(
            baseTarget ? targetLabel(baseTarget) : MESSAGES.environment.targetSelect.draft,
            targetTarget ? targetLabel(targetTarget) : MESSAGES.environment.targetSelect.draft,
          )}
        </p>
      )}
    </div>
  );
}
