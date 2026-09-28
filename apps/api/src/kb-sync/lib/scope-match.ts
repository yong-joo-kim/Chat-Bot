import { isAllowedOrigin } from './allowed-origins';
import { canonicalizePathForMatch, globMatchPath, pathMatchesPrefix } from './path-canon';

/**
 * [신규 No.43] 범위 판정(순수 — §6.7) — 허용 호스트(정확 일치 · 하위 도메인 자동 포함 없음) ∧
 * (경로 접두 목록이 비었거나 하나와 일치) ∧ 제외 글롭 불일치 ∧ 깊이 ≤ maxDepth.
 * [pass 12 · RG-26] 호스트 이름에 더해 **출처(host:port)**도 허용 집합(`allowedOrigins` — 시작 주소·사이트맵에서 실행 시점에 계산, `lib/allowed-origins.ts`)에 있어야 한다.
 */
export interface ScopeConfig {
  allowedHosts: readonly string[];
  /** [pass 12 · RG-26] 허용 출처(host:port, 기본 포트 정규화) — 같은 호스트의 다른 포트는 여기 없으면 범위 밖이다. */
  allowedOrigins: readonly string[];
  pathPrefixes: readonly string[];
  excludePatterns: readonly string[];
  maxDepth: number;
}

export function isInScope(normalizedUrl: string, depth: number, cfg: ScopeConfig): boolean {
  if (depth > cfg.maxDepth) return false;
  let url: URL;
  try {
    url = new URL(normalizedUrl);
  } catch {
    return false;
  }
  if (!cfg.allowedHosts.includes(url.hostname)) return false;
  if (!isAllowedOrigin(cfg.allowedOrigins, normalizedUrl)) return false;
  // 경로는 URL 파서 결과(퍼센트 인코딩)와 관리자가 적은 원문(한글 가능)을 같은 형태로 맞춰 비교한다(M-4) · 접두는 경계 검사(Low-5).
  const pathname = canonicalizePathForMatch(url.pathname);
  if (cfg.pathPrefixes.length > 0 && !cfg.pathPrefixes.some((p) => pathMatchesPrefix(pathname, canonicalizePathForMatch(p)))) return false;
  // 제외 글롭은 "문자 1개" 단위로 비교한다(N-13 — `?`가 한글 1자에 매칭).
  if (cfg.excludePatterns.some((p) => globMatchPath(p, pathname))) return false;
  return true;
}
