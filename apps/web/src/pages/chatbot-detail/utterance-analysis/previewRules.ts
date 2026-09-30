import { UTTERANCE_ANALYSIS_LIMITS, type UtterancePreviewResponse } from '@chat-bot/shared-types';

/**
 * "발화가 너무 적은가" 클라이언트 재계산(`deep-clustering-ui-spec.md` §4.4 · §12-6). 서버는 미리보기 때 받은 최소 발화 수로만
 * 판정해 응답하므로, 사용자가 값을 바꿀 때마다 파일을 다시 올리지 않고 화면이 다시 계산한다.
 * 곱하기 배수는 서버가 준 `minValidCount`에서 역산하고(규칙을 화면에 복제하지 않는다), 응답에 없으면 2로 본다.
 */
export function minValidFactor(preview: Pick<UtterancePreviewResponse, 'minValidCount'>, sentMinClusterSize: number | undefined): number {
  const sent = sentMinClusterSize ?? UTTERANCE_ANALYSIS_LIMITS.minClusterSize.default;
  if (preview.minValidCount !== undefined && sent > 0) {
    const factor = preview.minValidCount / sent;
    if (Number.isFinite(factor) && factor > 0) return factor;
  }
  return 2;
}

/** 유효 발화가 부족하면 `{ maxMin }`(줄여야 하는 최소 발화 수의 상한)을, 충분하면 null을 돌려준다. */
export function checkTooFew(
  preview: Pick<UtterancePreviewResponse, 'validCount' | 'minValidCount'>,
  sentMinClusterSize: number | undefined,
  currentMinClusterSize: number,
): { validCount: number; maxMin: number } | null {
  const factor = minValidFactor(preview, sentMinClusterSize);
  if (preview.validCount >= currentMinClusterSize * factor) return null;
  return { validCount: preview.validCount, maxMin: Math.floor(preview.validCount / factor) };
}
