const COPY_SUFFIX = ' (사본)';
const MAX_NAME_LENGTH = 100;

/**
 * 챗봇/그룹 사본 이름 파생 규칙(FR-1-13, AC-1-7).
 * "{원본명} (사본)" 형태이며, 100자를 초과하면 접미사를 붙일 자리를 남기고 앞부분을 자른다.
 * 순수 함수(DB·Nest 무의존) — 단위 테스트 1차 타깃(NFR-M3).
 */
export function deriveCopyName(name: string): string {
  const base =
    name.length + COPY_SUFFIX.length > MAX_NAME_LENGTH
      ? name.slice(0, MAX_NAME_LENGTH - COPY_SUFFIX.length).trimEnd()
      : name;
  return `${base}${COPY_SUFFIX}`;
}
