import type { AugmentationProviderId } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../constants/messages';

const msg = MESSAGES.augmentation;

/** 수치 + 텍스트 라벨 병기(NFR-LA3, 색상 단독 금지, ui-spec §3). */
export function SimilarityBadge({ score }: { score: number }): JSX.Element {
  const label = score >= 0.95 ? msg.similarityVeryClose : score >= 0.85 ? msg.similarityClose : msg.similarityDifferent;
  return (
    <span className="dialogue-badge dialogue-badge--neutral">
      {score.toFixed(2)} {label}
    </span>
  );
}

/** 타 의도 충돌 경고 — 아이콘 + 텍스트(색상 단독 금지). 클릭 이동 링크는 제공하지 않는다(§3). */
export function ConflictBadge({ intentName, score }: { intentName: string; score: number }): JSX.Element {
  return (
    <span className="dialogue-badge dialogue-badge--warning">
      <span aria-hidden="true">⚠</span> {msg.conflictLabel(intentName, score.toFixed(2))}
    </span>
  );
}

const PROVIDER_LABELS: Partial<Record<AugmentationProviderId, string>> = {
  rule: msg.providerRule,
  gemini: msg.providerGemini,
  local: msg.providerLocal,
};

/** `mock`은 테스트 전용 — 프로덕션 화면에는 노출되지 않는다(ui-spec §3). */
export function ProviderBadge({ providerId }: { providerId: AugmentationProviderId }): JSX.Element | null {
  const label = PROVIDER_LABELS[providerId];
  if (!label) return null;
  return <span className="dialogue-badge dialogue-badge--neutral">{label}</span>;
}
