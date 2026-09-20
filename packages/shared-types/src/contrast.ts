/**
 * WCAG relative luminance 기반 명도 대비 계산(FR-4-6, NFR-P3, FR-W-22).
 * **zod 무의존**이어야 한다 — `apps/widget`이 gzip 100KB 예산 안에서 이 모듈을 값으로 import한다(ADR-0012).
 * 원래 `apps/web/src/lib/contrast.ts`에 있던 로직을 그대로 옮겼다. `apps/web`은 재export 셔임만 남긴다.
 */
function srgbToLinear(c: number): number {
  const cs = c / 255;
  return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!match) return null;
  const normalized = match[1];
  return {
    r: parseInt(normalized.substring(0, 2), 16),
    g: parseInt(normalized.substring(2, 4), 16),
    b: parseInt(normalized.substring(4, 6), 16),
  };
}

function relativeLuminance(hex: string): number | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  return 0.2126 * srgbToLinear(rgb.r) + 0.7152 * srgbToLinear(rgb.g) + 0.0722 * srgbToLinear(rgb.b);
}

export function contrastRatio(hexA: string, hexB: string): number | null {
  const l1 = relativeLuminance(hexA);
  const l2 = relativeLuminance(hexB);
  if (l1 === null || l2 === null) return null;
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export interface ContrastCheckResult {
  ratio: number;
  passes: boolean;
  suggestedTextColor: 'white' | 'black';
}

/**
 * 헤더 배경(primaryColor) 위 텍스트 색상의 대비를 평가한다(FR-4-6, AC-4-3, AC-W-14).
 * 기본 헤더 텍스트는 흰색으로 가정하고, 기준(4.5:1) 미달 시 검정 텍스트 대비도 함께 계산해 더 나은 쪽을 권장한다.
 */
export function evaluateHeaderContrast(primaryColor: string): ContrastCheckResult | null {
  const whiteRatio = contrastRatio(primaryColor, '#FFFFFF');
  const blackRatio = contrastRatio(primaryColor, '#000000');
  if (whiteRatio === null || blackRatio === null) return null;
  const useWhite = whiteRatio >= blackRatio;
  const ratio = useWhite ? whiteRatio : blackRatio;
  return {
    ratio: Math.round(ratio * 100) / 100,
    passes: whiteRatio >= 4.5,
    suggestedTextColor: useWhite ? 'white' : 'black',
  };
}
