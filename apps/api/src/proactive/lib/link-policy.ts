/**
 * [신규 No.35] `LINK` 버튼 허용 도메인 판정 보조 — `chatbotRichUrlPolicy`(No.46) 테이블을 **읽기만**
 * 한다(쓰기 아님 · §9.2). `rich-messages/**`를 import하지 않는다(모듈 의존 방향 단방향 유지 —
 * `proactive`는 `chatbots`·`audit-logs`·`banned-words`·`dialogue-common`·`environment/serving`·
 * `prisma`·`config`만 참조). 순수 — DB·Nest 무의존.
 */

export interface ProactiveLinkPolicyHost {
  host: string;
  includeSubdomains: boolean;
}

export function parseProactiveLinkPolicyHosts(json: string): ProactiveLinkPolicyHost[] {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (h): h is ProactiveLinkPolicyHost => typeof h === 'object' && h !== null && typeof h.host === 'string' && typeof h.includeSubdomains === 'boolean',
    );
  } catch {
    return [];
  }
}

export function safeHostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}
