import { canonicalizePathForMatch } from './path-canon';

/**
 * [신규 No.43] robots.txt 파서(순수 — §6.5 · FR-KB2-1 · FR-KB9-1). RFC 9309 근사: `User-agent` 그룹
 * 선택(우리 UA 토큰 일치 → 없으면 `*`) · `Allow`/`Disallow` 최장 일치(동률이면 `Allow` 우선) ·
 * `*`·`$` 지원 · `Crawl-delay`(초, 비표준이나 반영).
 */
export interface RobotsRules {
  isAllowed(path: string): boolean;
  crawlDelaySec: number | null;
}

interface RawRule {
  allow: boolean;
  pattern: string;
}

function ruleToRegex(pattern: string): RegExp {
  // 로봇 규칙은 `*`(임의)·`$`(끝)만 특수 취급하고 나머지는 리터럴이다.
  let out = '^';
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '*') out += '.*';
    else if (ch === '$' && i === pattern.length - 1) out += '$';
    else out += ch.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(out);
}

function matchLength(pattern: string): number {
  // `*`·`$`를 뺀 리터럴 길이 — 최장 일치 판정용(느슨한 근사).
  return pattern.replace(/[*$]/g, '').length;
}

export function parseRobots(text: string, userAgentToken: string): RobotsRules {
  const lines = text.split(/\r?\n/).slice(0, 100_000); // 512KB 상한은 호출부가 이미 자른다.
  const groups: Array<{ agents: string[]; rules: RawRule[]; crawlDelaySec: number | null }> = [];
  let current: { agents: string[]; rules: RawRule[]; crawlDelaySec: number | null } | null = null;
  let sawAgentBeforeRule = true;

  for (const rawLine of lines) {
    const line = rawLine.split('#')[0].trim();
    if (!line) continue;
    const colonIdx = line.indexOf(':');
    if (colonIdx < 0) continue;
    const key = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();

    if (key === 'user-agent') {
      if (current && !sawAgentBeforeRule) {
        // 이미 규칙이 나온 뒤 새 User-agent — 새 그룹 시작.
        current = null;
      }
      if (!current) {
        current = { agents: [], rules: [], crawlDelaySec: null };
        groups.push(current);
        sawAgentBeforeRule = true;
      }
      current.agents.push(value.toLowerCase());
    } else if (key === 'allow' || key === 'disallow') {
      if (!current) continue;
      sawAgentBeforeRule = false;
      // 규칙 패턴도 비교용 정준형으로 맞춘다 — 원문(한글)과 퍼센트 인코딩·대소문자 16진 표기를 같게 본다(M-4 · RFC 9309 §2.2.2).
      if (value.length > 0) current.rules.push({ allow: key === 'allow', pattern: canonicalizePathForMatch(value) });
      else if (key === 'disallow') current.rules.push({ allow: true, pattern: '' }); // 빈 Disallow = 전체 허용
    } else if (key === 'crawl-delay') {
      if (!current) continue;
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.crawlDelaySec = n;
    }
  }

  const ua = userAgentToken.toLowerCase();
  let selected = groups.find((g) => g.agents.some((a) => a === ua));
  if (!selected) selected = groups.find((g) => g.agents.includes('*'));

  const rules = selected?.rules ?? [];
  const crawlDelaySec = selected?.crawlDelaySec ?? null;

  return {
    crawlDelaySec,
    /** `path`는 경로 + 쿼리(`/a?x=1`)다 — 쿼리도 매칭 대상이다(`Disallow: /*?sid=`). */
    isAllowed(rawPath: string): boolean {
      const path = canonicalizePathForMatch(rawPath);
      let best: RawRule | null = null;
      let bestLen = -1;
      let bestAllow = false;
      for (const rule of rules) {
        if (rule.pattern === '') {
          if (bestLen < 0) {
            best = rule;
            bestLen = 0;
            bestAllow = true;
          }
          continue;
        }
        if (!ruleToRegex(rule.pattern).test(path)) continue;
        const len = matchLength(rule.pattern);
        if (len > bestLen || (len === bestLen && rule.allow && !bestAllow)) {
          best = rule;
          bestLen = len;
          bestAllow = rule.allow;
        }
      }
      return best ? best.allow : true;
    },
  };
}

/** 4xx = 전부 허용(단 429는 서버 오류 — 허용이 아니다) · 5xx·연결 실패·타임아웃 = 그 실행에서 그 호스트 수집 중단(§6.5). */
export function robotsFetchOutcome(httpStatus: number | null): 'PARSE' | 'ALLOW_ALL' | 'ABORT_HOST' {
  if (httpStatus === null) return 'ABORT_HOST';
  if (httpStatus >= 200 && httpStatus < 300) return 'PARSE';
  if (httpStatus === 429) return 'ABORT_HOST';
  if (httpStatus >= 400 && httpStatus < 500) return 'ALLOW_ALL';
  return 'ABORT_HOST';
}
