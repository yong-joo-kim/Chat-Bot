import type { HandoffClientMode, HandoffStatus } from '@chat-bot/shared-types';

/**
 * 공개 파이프라인 ②.7 분기 판정표(순수 함수, §5.3 G-0~G-9의 요약형). 토큰 해시 비교는 호출부가
 * 미리 계산해 `tokenMatches`로 넘긴다(이 함수는 crypto를 모른다 — DB·Nest 무의존, NFR-CSM1).
 */
export type HandoffCase =
  | 'NONE' // G-0 — 상담 행 없음
  | 'FIRST_CONTACT' // G-2/G-3 — 첫 접촉(모던/레거시는 호출부가 features로 나눈다)
  | 'VERIFIED' // G-4 — 모던 상담, 토큰 검증됨
  | 'LEGACY_ACTIVE' // G-5 — 레거시 상담, 편승 격하
  | 'UNVERIFIED' // G-6 — 토큰 없음/불일치/모드 불일치
  | 'ENDED_GRACE' // G-7/G-8 — 종료 5분 유예 내(토큰 유효 또는 레거시)
  | 'ENDED_EXPIRED'; // G-9 — 그 밖의 종료

export interface HandoffAuthLatest {
  status: HandoffStatus;
  tokenHash: string | null;
  clientMode: HandoffClientMode | null;
  endedAt: Date | null;
}

export interface HandoffAuthInput {
  latest: HandoffAuthLatest | null;
  hasFeatureFlag: boolean;
  tokenHeaderPresent: boolean;
  tokenMatches: boolean;
  now: Date;
  endedGraceMs: number;
}

export function classifyHandoffCase(input: HandoffAuthInput): HandoffCase {
  const { latest } = input;
  if (!latest) return 'NONE';

  if (latest.status === 'ENDED') {
    const withinGrace = latest.endedAt !== null && input.now.getTime() - latest.endedAt.getTime() < input.endedGraceMs;
    if (!withinGrace) return 'ENDED_EXPIRED';
    if (latest.clientMode === 'LEGACY') return 'ENDED_GRACE';
    if (latest.clientMode === 'MODERN' && input.tokenHeaderPresent && input.tokenMatches) return 'ENDED_GRACE';
    return 'ENDED_EXPIRED';
  }

  // 활성(CONNECTING | CONNECTED)
  if (latest.clientMode === null) return 'FIRST_CONTACT';

  if (latest.clientMode === 'MODERN') {
    if (input.tokenHeaderPresent && input.tokenMatches) return 'VERIFIED';
    return 'UNVERIFIED';
  }

  // LEGACY
  if (!input.tokenHeaderPresent && !input.hasFeatureFlag) return 'LEGACY_ACTIVE';
  return 'UNVERIFIED';
}
