import type { FingerprintDiffBadge } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../../constants/messages';

/** 임베딩 모델/저하모드/임계값 불일치 강한 경고(ui-spec §4.5). */
export function EnvFingerprintDiffBanner({ diffs }: { diffs: FingerprintDiffBadge[] }): JSX.Element | null {
  if (diffs.length === 0) return null;
  const hasEmbeddingModelDiff = diffs.some((d) => d.key === 'embeddingModelId');
  return (
    <div className={`form-banner ${hasEmbeddingModelDiff ? 'form-banner--error' : 'form-banner--info'}`} role="alert">
      <span aria-hidden="true">⚠</span> {MESSAGES.validation.compare.fingerprintDiffBanner}
      <ul>
        {diffs.map((d) => (
          <li key={d.key}>{d.label}</li>
        ))}
      </ul>
      {hasEmbeddingModelDiff && <p>{MESSAGES.validation.compare.strongWarningEmbeddingModel}</p>}
    </div>
  );
}
