import type { TestRunEnvFingerprint } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../../constants/messages';

/** 저하모드·자산 건수 6종 요약 배지(ui-spec §4.4.1 `EnvFingerprintBadgeGroup`, S-7). */
export function EnvFingerprintBadgeGroup({ fingerprint }: { fingerprint: TestRunEnvFingerprint | null }): JSX.Element | null {
  if (!fingerprint || !fingerprint.degradedMode) return null;
  return (
    <p className="form-banner form-banner--error" role="alert">
      {MESSAGES.validation.result.degradedBadge}
    </p>
  );
}
