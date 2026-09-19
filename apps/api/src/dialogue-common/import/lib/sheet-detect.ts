import type { SheetRow } from '../sheet-reader';

export interface HeaderSpec {
  canonical: string;
  aliases: string[];
}

/** 헤더 행이 기대 포맷과 일치하는지 판정한다(EX-I-1). 열 순서를 기준으로 한글/영문 별칭을 모두 허용한다. */
export function isHeaderMismatch(headerRow: string[] | undefined, expected: HeaderSpec[]): boolean {
  if (!headerRow) return true;
  return expected.some((spec, i) => {
    const cell = (headerRow[i] ?? '').trim().toLowerCase();
    const accepted = [spec.canonical, ...spec.aliases].map((s) => s.toLowerCase());
    return !accepted.includes(cell);
  });
}

/** UTF-8 디코딩 이상(치환문자 U+FFFD 비율 5% 초과)을 감지한다(EX-I-2). */
export function hasEncodingAnomaly(rows: SheetRow[]): boolean {
  let total = 0;
  let bad = 0;
  for (const row of rows) {
    for (const cell of row.cells) {
      total += cell.length;
      bad += (cell.match(/�/g) ?? []).length;
    }
  }
  if (total === 0) return false;
  return bad / total > 0.05;
}
