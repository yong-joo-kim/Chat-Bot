import type { KbDemotionReason } from '@chat-bot/shared-types';

/**
 * [신규 No.43] 크롤 종결 자동 강등 가드(순수 — §8.4 · EX-KB-5 · EX-KB-7). 사유만 판정한다 — 어느 실행 종류에 무엇을 적용할지(강등 vs 기록만)는 호출부가 정한다.
 */
export interface RunGuardInput {
  /** 실행 전 ACTIVE·적재됨 문서 수. */
  priorActiveIngestedCount: number;
  /** 이번 실행에서 NEW로 판정된 수. */
  addedCount: number;
  /**
   * [pass 9 · H-1] 이번 실행에서 **방문한 HTML 행 전체**(304 · 오류 · 제외 · 빈 본문 · 리다이렉트 원래 행 포함) — 분모. 예전에는 지문이 있는 행만 세어, 증분 크롤에서 변경 없는(304) 정상 문서가 분모에서
   * 빠지고 빈 본문 페이지가 분포를 지배했다. 304로 확인된 문서는 지문이 없어도 "다른 내용일 수 있는 정상 페이지"로 분포를 희석한다.
   */
  observedHtmlCount: number;
  /** [pass 9 · H-1] 그중 판정에 쓸 수 있는 지문(본문 해시 · 로그인 신호가 있는 수렴 `RL:`·`X:`)을 남긴 행 수 — 하한(≥ 10)에 쓴다. 빈 본문·정상 통합 리다이렉트 행은 세지 않는다. */
  hashedHtmlCount: number;
  /** 그중 가장 많이 겹치는 지문의 개수(최빈값). */
  sameHashHtmlMaxCount: number;
  /**
   * [pass 10 · RG-23] 사람이 미리보기를 보고 **승인해서 시작된** 실행(`trigger = APPROVAL`인 SYNC)이면 `true` — 새로 비율 판정만 면제한다(방금 사람이 확인했다). 인증 벽 판정은
   * 면제하지 않는다(승인 뒤 사이트가 로그인 벽으로 바뀌었을 수 있고, 새 문서가 많은 것과 달리 사람이 미리 본 적 없는 상태다). 생략 = `false`.
   */
  approvedByUser?: boolean;
}

export function evaluateRunGuards(input: RunGuardInput): KbDemotionReason | null {
  if (!input.approvedByUser && input.priorActiveIngestedCount >= 20 && input.addedCount / input.priorActiveIngestedCount > 0.5) return 'NEW_RATIO';
  if (input.hashedHtmlCount >= 10 && input.observedHtmlCount > 0 && input.sameHashHtmlMaxCount / input.observedHtmlCount >= 0.8) return 'AUTH_WALL';
  return null;
}
