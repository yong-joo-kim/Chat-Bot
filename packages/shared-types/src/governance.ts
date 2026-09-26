import { z } from 'zod';

/**
 * No.45 데이터 거버넌스 — `docs/02-spec/data-governance-설계.md` §4.1, ADR-0040.
 * `common.ts`에만 의존하는 단방향 의존 파일이다(개발명세서 §6-9 배치 규칙).
 *
 * [커밋 ① 범위] 출구 게이트·필드 암호화(`common/{egress,crypto}`)가 컴파일 시점에 필요로 하는
 * 식별자 3종만 우선 정의한다 — 거버넌스 본체(정책·데이터 지도·API 계약)는 커밋 ③에서 이어 붙인다.
 */

export const EgressExitId = z.enum(['EMBEDDING', 'RAG', 'AUGMENT_GEMINI', 'AUGMENT_LOCAL', 'LEGACY_API']);
export type EgressExitId = z.infer<typeof EgressExitId>;

/** 송신 데이터 종류 — 화면 문구는 web 라벨. */
export const EgressDataKind = z.enum(['QUERY_RAW', 'QUESTION_MASKED', 'SEED_MASKED', 'SEED_UNMASKED', 'FORM_SLOT']);
export type EgressDataKind = z.infer<typeof EgressDataKind>;

export const EncryptedFieldId = z.enum(['HANDOFF_RAW_TEXT', 'HANDOFF_TEXT', 'SURVEY_TEXT_VALUE']);
export type EncryptedFieldId = z.infer<typeof EncryptedFieldId>;
