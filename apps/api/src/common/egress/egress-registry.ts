import type { EgressDataKind, EgressExitId } from '@chat-bot/shared-types';

/**
 * ★ 출구 5클래스 코드 상수 레지스트리(No.45, `data-governance-설계.md` §6.1) — 데이터 지도·정적 검사
 * (`governance-sealing.spec.ts` G-1) 공용. 이 파일 밖에서 이 목록을 다시 만들지 않는다.
 */
export interface EgressExitDef {
  readonly exitId: EgressExitId;
  /** 정적 검사 대조 대상(레지스트리와 실제 출구 파일 집합이 1:1이어야 한다). */
  readonly files: readonly string[];
  readonly dataKind: EgressDataKind;
  readonly masked: 'YES' | 'NO' | 'PER_CONNECTION';
  readonly label: string;
}

export const EGRESS_REGISTRY: readonly EgressExitDef[] = [
  {
    exitId: 'EMBEDDING',
    files: ['embedding/providers/http-embedding.provider.ts'],
    dataKind: 'QUERY_RAW',
    masked: 'NO',
    label: '임베딩(ml-worker)',
  },
  {
    exitId: 'RAG',
    files: ['rag/rag-http.client.ts'],
    dataKind: 'QUESTION_MASKED',
    masked: 'YES',
    label: '외부 RAG',
  },
  {
    exitId: 'AUGMENT_GEMINI',
    files: ['augmentation/providers/gemini-augmentation.provider.ts'],
    dataKind: 'SEED_MASKED',
    masked: 'YES',
    label: '증강 생성기(Gemini)',
  },
  {
    exitId: 'AUGMENT_LOCAL',
    files: ['augmentation/providers/local-augmentation.provider.ts'],
    dataKind: 'SEED_UNMASKED',
    masked: 'NO',
    label: '증강 생성기(로컬)',
  },
  {
    exitId: 'LEGACY_API',
    files: [
      'legacy-api/legacy-api-http.client.ts',
      'legacy-api/transport/node-http.transport.ts',
      'legacy-api/transport/node-dns.resolver.ts',
    ],
    dataKind: 'FORM_SLOT',
    masked: 'PER_CONNECTION',
    label: '레거시 API',
  },
];

/** Gemini 기본 호스트 — 기동 검사(§6.4)와 provider 기본값이 같은 상수를 쓴다. */
export const AUGMENT_GEMINI_DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';

export function egressExitLabel(exitId: EgressExitId): string {
  return EGRESS_REGISTRY.find((e) => e.exitId === exitId)?.label ?? exitId;
}
