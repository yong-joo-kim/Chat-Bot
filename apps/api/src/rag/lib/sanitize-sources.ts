import type { RagSourceInfoSchema } from './rag-response.schema';
import type { z } from 'zod';

export interface SanitizedSource {
  fileName: string;
  sectionTitle?: string;
  page?: number;
}

type RagSourceInfo = z.infer<typeof RagSourceInfoSchema>;

const MAX_SOURCES = 3;

function isNA(value: unknown): boolean {
  return value === 'N/A' || value === undefined || value === null || value === '';
}

/**
 * 출처 정제 순수 함수(FR-N2-20~23, §9.5). 서버 절대경로 유출을 막고(AC-N2-8) `"N/A"`를
 * 방어하며(AC-N2-9) 최대 3건으로 자른다. `common_metadata.company`가 기대 스코프와 다르면
 * 스코프 오설정 의심(EX-N2-14)이므로 호출부가 이 함수 결과 자체를 버리도록 별도 판단한다
 * (이 함수는 sources[]만 다룬다).
 */
export function sanitizeSources(sourceInfo: RagSourceInfo | null): SanitizedSource[] {
  if (!sourceInfo || sourceInfo.sources.length === 0) return [];

  return sourceInfo.sources.slice(0, MAX_SOURCES).map((s) => {
    const segments = s.file_path.split('/');
    const fileName = segments[segments.length - 1] || s.file_path;

    const out: SanitizedSource = { fileName };
    if (!isNA(s.section_title)) out.sectionTitle = s.section_title as string;
    if (!isNA(s.page) && typeof s.page === 'number') out.page = s.page;
    return out;
  });
}

/**
 * `common_metadata.company`가 우리가 요청한 스코프와 다르면 경고 감지용 신호를 준다(EX-N2-14).
 * "모든 근거의 공통값이라는 보장은 없다"(API_RAG §6-3)는 전제 아래 best-effort 탐지다.
 */
export function scopeMismatchDetected(sourceInfo: RagSourceInfo | null, expectedCompany: string): boolean {
  const actual = sourceInfo?.common_metadata?.company;
  if (isNA(actual)) return false;
  return actual !== expectedCompany;
}
