import { SURVEY_LIMITS, normalizeText } from '@chat-bot/shared-types';

/**
 * 설문 복제 이름 파생(FR-SV2-6) — "{원본명} (사본)", 충돌 시 "{원본명} (사본 2)"부터 순번을 늘린다.
 * 순수 함수(DB 무의존) — `existingNormalizedNames`는 같은 챗봇의 기존 `nameNormalized` 집합이다.
 */
export function deriveSurveyCopyName(originalName: string, existingNormalizedNames: ReadonlySet<string>): string {
  const suffixBase = ' (사본)';
  const base =
    originalName.length + suffixBase.length > SURVEY_LIMITS.nameMax
      ? originalName.slice(0, SURVEY_LIMITS.nameMax - suffixBase.length).trimEnd()
      : originalName;

  let candidate = `${base}${suffixBase}`;
  if (!existingNormalizedNames.has(normalizeText(candidate))) return candidate;

  for (let n = 2; n < 1000; n += 1) {
    const suffix = ` (사본 ${n})`;
    const trimmedBase =
      originalName.length + suffix.length > SURVEY_LIMITS.nameMax
        ? originalName.slice(0, SURVEY_LIMITS.nameMax - suffix.length).trimEnd()
        : originalName;
    candidate = `${trimmedBase}${suffix}`;
    if (!existingNormalizedNames.has(normalizeText(candidate))) return candidate;
  }
  return candidate;
}
