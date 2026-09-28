import type { ProactiveRuleIssue } from '@chat-bot/shared-types';
import type { DecodedProactiveRule } from './rule-codec';

/**
 * [신규 No.35] 규칙 문제 판정 1벌(노드·금지어·허용 도메인) — 공개 필터(`proactive-public.service.ts`)와
 * 관리 목록(`proactive-overview.service.ts`) 공용(§9.4). 순수 — DB·Nest 무의존(조회 결과는 호출자가
 * 인자로 넘긴다).
 */
export interface RuleServabilityInput {
  /** `null` = JSON 파싱 실패(INVALID_STORED) — 이 경우 다른 판정은 무의미하다. */
  decoded: DecodedProactiveRule | null;
  /** "지금 서비스 중인 번들"에서 켜진 상태로 확인된 노드 id 목록. */
  servingNodeIds: readonly string[];
  /** 서비스 중 번들을 읽을 수 없었다(버전 읽기 실패) — `NODE` 버튼이 있는 규칙에서만 의미. */
  servingUnverifiable: boolean;
  /** 문구·버튼 라벨·MESSAGE 값 중 하나 이상이 전역 금지어와 일치. */
  bannedWordHit: boolean;
  /** `LINK` 버튼 주소가 현재 허용 도메인 밖(목록이 있을 때만 의미). */
  linkOutsidePolicy: boolean;
}

export function evaluateRuleIssues(input: RuleServabilityInput): ProactiveRuleIssue[] {
  const issues: ProactiveRuleIssue[] = [];
  if (!input.decoded) {
    issues.push('INVALID_STORED');
    return issues;
  }

  const nodeButtons = input.decoded.buttons.filter((b) => b.action === 'NODE');
  if (nodeButtons.length > 0) {
    if (input.servingUnverifiable) {
      issues.push('SERVING_UNVERIFIABLE');
    } else if (nodeButtons.some((b) => !input.servingNodeIds.includes(b.value))) {
      issues.push('TARGET_UNAVAILABLE');
    }
  }
  if (input.bannedWordHit) issues.push('BANNED_WORD');
  if (input.linkOutsidePolicy) issues.push('LINK_OUTSIDE_POLICY');
  return issues;
}

/** 공개 조회에서 규칙 전체를 빼야 하는 issue인지(`LINK_OUTSIDE_POLICY`는 제외 — K-8 · 공개 경로는
 * 허용 도메인 표를 읽지 않는다, ADR-0043 §7). */
export function isPublicBlockingIssue(issue: ProactiveRuleIssue): boolean {
  return issue !== 'LINK_OUTSIDE_POLICY';
}

export function shouldExcludeFromPublic(issues: readonly ProactiveRuleIssue[]): boolean {
  return issues.some(isPublicBlockingIssue);
}
