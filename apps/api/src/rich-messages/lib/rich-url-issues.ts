import type { DesignIssue, DialogOutput } from '@chat-bot/shared-types';
import { hostMatchesRules, inspectRichUrl } from '@chat-bot/shared-types';
import { collectRichUrls } from './collect-rich-urls';

export interface RichUrlHostRuleLike {
  host: string;
  includeSubdomains: boolean;
}

interface NodeLike {
  id: string;
  name: string;
  outputs: readonly DialogOutput[];
}

/**
 * [신규 No.46] 설계 점검 API 계층 순수 함수(§10.2 · 토픽 규칙 선례 — 엔진 결과 뒤에 합친다).
 * `RICH_URL_NOT_ALLOWED`(WARNING — 허용 목록이 비어 있지 않은데 목록 밖 호스트) ·
 * `RICH_URL_SUSPICIOUS`(INFO — 퓨니코드·IP·단축 URL). 노드 하나당 코드별 1건으로 합친다
 * (`API_TOKEN_IN_URL_FIELD` 선례와 같은 규약).
 */
export function richUrlDesignIssues(nodes: readonly NodeLike[], rules: readonly RichUrlHostRuleLike[]): DesignIssue[] {
  const issues: DesignIssue[] = [];
  for (const node of nodes) {
    const urls = collectRichUrls(node.outputs);
    if (urls.length === 0) continue;

    let notAllowed = false;
    let suspicious = false;
    for (const { url } of urls) {
      const inspected = inspectRichUrl(url);
      if (!inspected.ok) continue; // 형식 오류는 저장 시점 스키마가 이미 막는다 — 점검은 정책만 본다.
      if (rules.length > 0 && !hostMatchesRules(inspected.host, rules)) notAllowed = true;
      if (inspected.warnings.length > 0) suspicious = true;
    }

    if (notAllowed) {
      issues.push({
        code: 'RICH_URL_NOT_ALLOWED',
        severity: 'WARNING',
        resourceType: 'NODE',
        resourceId: node.id,
        resourceName: node.name,
        message: `노드 "${node.name}"이(가) 허용 도메인 목록 밖의 리치 메시지 주소를 사용합니다.`,
      });
    }
    if (suspicious) {
      issues.push({
        code: 'RICH_URL_SUSPICIOUS',
        severity: 'INFO',
        resourceType: 'NODE',
        resourceId: node.id,
        resourceName: node.name,
        message: `노드 "${node.name}"의 리치 메시지 주소에 퓨니코드·IP·단축 URL 등 주의가 필요한 형식이 있습니다.`,
      });
    }
  }
  return issues;
}

/** 챗봇 설정 화면 "목록 밖 주소를 쓰는 노드 N개"(EX-RM-13). 목록이 비면 항상 0. */
export function countNodesOutsideRichUrlPolicy(nodes: readonly NodeLike[], rules: readonly RichUrlHostRuleLike[]): number {
  if (rules.length === 0) return 0;
  let count = 0;
  for (const node of nodes) {
    const urls = collectRichUrls(node.outputs);
    const outside = urls.some(({ url }) => {
      const inspected = inspectRichUrl(url);
      return inspected.ok && !hostMatchesRules(inspected.host, rules);
    });
    if (outside) count += 1;
  }
  return count;
}

/** 노드 저장 검증(§10.1) — 허용 목록에 없는 호스트가 있으면 첫 위반 위치를 돌려준다(400 상세용). */
export function findDisallowedRichUrl(outputs: readonly DialogOutput[], rules: readonly RichUrlHostRuleLike[]): { field: string; host: string } | null {
  if (rules.length === 0) return null;
  for (const { url, field } of collectRichUrls(outputs)) {
    const inspected = inspectRichUrl(url);
    if (inspected.ok && !hostMatchesRules(inspected.host, rules)) return { field, host: inspected.host };
  }
  return null;
}
