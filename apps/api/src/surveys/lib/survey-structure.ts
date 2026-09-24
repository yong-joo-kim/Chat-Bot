import type { SurveyQuestion } from '@chat-bot/shared-types';

/**
 * 구조 판정(FR-SV2-4) — 문항 key 순서 · 유형 · required · 선택지 key 순서 · 척도 종류 ·
 * minSelect/maxSelect · maxLength. 문구 필드(prompt·라벨·양끝 라벨)는 구조가 아니다.
 * 순수 함수(DB 무의존).
 */
export function structureFingerprint(questions: readonly SurveyQuestion[]): string {
  const parts = questions.map((q) => {
    const base = `${q.key}:${q.type}:${q.required ? 1 : 0}`;
    if (q.type === 'SINGLE_CHOICE') return `${base}:${q.choices.map((c) => c.key).join(',')}`;
    if (q.type === 'MULTI_CHOICE') return `${base}:${q.choices.map((c) => c.key).join(',')}:${q.minSelect}-${q.maxSelect}`;
    if (q.type === 'SCALE') return `${base}:${q.scale}`;
    return `${base}:${q.maxLength}`;
  });
  return parts.join('|');
}

export type StructureDiff = 'SAME' | 'TEXT_ONLY' | 'STRUCTURAL';

/** 요청의 기존 key를 빠뜨리면 = 문항/선택지 삭제 + 신규 추가 = 구조 변경으로 판정된다(키 보존은 클라이언트 책임). */
export function diffStructure(before: readonly SurveyQuestion[], after: readonly SurveyQuestion[]): StructureDiff {
  const beforeFp = structureFingerprint(before);
  const afterFp = structureFingerprint(after);
  if (beforeFp !== afterFp) return 'STRUCTURAL';
  return JSON.stringify(before) === JSON.stringify(after) ? 'SAME' : 'TEXT_ONLY';
}
