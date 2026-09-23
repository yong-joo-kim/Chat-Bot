import type { DialogueBundle, MatchingThresholds, TestRunEnvFingerprint, TestRunOverlaySource } from '@chat-bot/shared-types';

export interface BuildEnvFingerprintInput {
  bundle: Pick<DialogueBundle, 'intents' | 'keywords' | 'homonyms' | 'contexts' | 'dialogNodes' | 'faqs'>;
  embeddingModelId: string | null;
  semanticEnabled: boolean;
  thresholds: MatchingThresholds;
  degradedMode: boolean;
  useRag: boolean;
  overlaySource: TestRunOverlaySource;
}

/**
 * 환경 지문 조립 순수 함수(§6.3, ADR-0029 §2) — "무엇이 달랐나"의 1차 설명. DB·Nest 무의존.
 */
export function buildEnvFingerprint(input: BuildEnvFingerprintInput): TestRunEnvFingerprint {
  return {
    assetCounts: {
      intents: input.bundle.intents.length,
      keywords: input.bundle.keywords.length,
      homonyms: input.bundle.homonyms.length,
      contexts: input.bundle.contexts.length,
      nodes: input.bundle.dialogNodes.length,
      faqs: input.bundle.faqs.length,
    },
    embeddingModelId: input.embeddingModelId,
    semanticEnabled: input.semanticEnabled,
    thresholds: { accept: input.thresholds.accept, low: input.thresholds.low, margin: input.thresholds.margin },
    degradedMode: input.degradedMode,
    useRag: input.useRag,
    overlaySource: input.overlaySource,
  };
}

export interface FingerprintDiffBadge {
  key: string;
  label: string;
  severity: 'WARNING' | 'INFO';
}

/**
 * 두 실행의 환경 지문 차이를 배지로 낸다(FR-V2-19). `embeddingModelId`/`degradedMode` 불일치는
 * **강한 경고**다 — 입력 공간이 다르면 차이의 대부분이 회귀가 아니다. 경고는 비교를 막지 않는다.
 */
export function diffFingerprint(base: TestRunEnvFingerprint | null, target: TestRunEnvFingerprint | null): FingerprintDiffBadge[] {
  if (!base || !target) return [];
  const badges: FingerprintDiffBadge[] = [];

  if (base.embeddingModelId !== target.embeddingModelId) {
    badges.push({ key: 'embeddingModelId', label: '임베딩 모델 변경', severity: 'WARNING' });
  }
  if (base.degradedMode !== target.degradedMode) {
    badges.push({ key: 'degradedMode', label: '저하 모드 차이', severity: 'WARNING' });
  }
  if (
    base.thresholds.accept !== target.thresholds.accept ||
    base.thresholds.low !== target.thresholds.low ||
    base.thresholds.margin !== target.thresholds.margin
  ) {
    badges.push({ key: 'thresholds', label: '임계값 변경', severity: 'INFO' });
  }
  if (base.overlaySource !== target.overlaySource) {
    badges.push({ key: 'overlaySource', label: '오버레이 소스 차이', severity: 'INFO' });
  }
  const assetKeys = Object.keys(base.assetCounts) as (keyof typeof base.assetCounts)[];
  if (assetKeys.some((k) => base.assetCounts[k] !== target.assetCounts[k])) {
    badges.push({ key: 'assetCounts', label: '자산 건수 변경', severity: 'INFO' });
  }

  return badges;
}
