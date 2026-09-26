import type { EgressExitId } from '@chat-bot/shared-types';
import { governanceRuntime } from '../governance/governance-runtime';
import { egressExitLabel } from './egress-registry';

/**
 * ★ 출구 게이트(No.45, `data-governance-설계.md` §6.2·§6.3) — 코드 상수 레지스트리(1곳) + 이 파일
 * (`parseAllowlist`·`matchHost`·`checkEgress`·`assertEgressAllowed`)가 5클래스 6파일에서 공용으로 쓰인다.
 * 모드 OFF(`enforce=false`)에서는 `checkEgress()`가 **URL 파싱조차 하지 않고** `'ALLOWED'`를 돌려준다
 * (FR-DG3-6·AC-DG2-5 — 기존 동작 불변).
 */

export interface ParsedAllowlistEntry {
  readonly raw: string;
  readonly wildcard: boolean;
  /** 정확 일치면 전체 호스트, 와일드카드면 접미(`*.` 뒤) 부분. 소문자·punycode 정규화됨. */
  readonly hostPattern: string;
  readonly port?: number;
}

export class AllowlistFormatError extends Error {
  constructor(readonly invalidEntry: string) {
    super(`출구 허용 목록 형식이 올바르지 않습니다: "${invalidEntry}"`);
  }
}

const PORT_RE = /^\d{1,5}$/;
const HOST_RE = /^[a-z0-9.-]+$/;
const IPV6_RE = /^[0-9a-f:]+$/;

/**
 * 항목 1개를 파싱한다. 스킴·경로·공백·빈 문자열 등은 `null`을 반환하지 않고 **예외**를 던진다
 * (조용한 무시 금지 — 기동 실패로 드러나야 한다).
 */
export function parseAllowlistEntry(rawInput: string): ParsedAllowlistEntry {
  const raw = rawInput.trim();
  if (raw.length === 0) throw new AllowlistFormatError(rawInput);
  if (/[/?#\s]/.test(raw) || raw.includes('://')) throw new AllowlistFormatError(rawInput);

  const lower = raw.toLowerCase();
  const wildcard = lower.startsWith('*.');
  const body = wildcard ? lower.slice(2) : lower;
  if (wildcard && (body.length === 0 || body.includes('*'))) throw new AllowlistFormatError(rawInput);

  // IPv6 대괄호 표기: [::1] 또는 [::1]:8000
  if (body.startsWith('[')) {
    const closeIdx = body.indexOf(']');
    if (closeIdx < 0) throw new AllowlistFormatError(rawInput);
    const host = body.slice(1, closeIdx);
    if (!IPV6_RE.test(host) || host.length === 0) throw new AllowlistFormatError(rawInput);
    const rest = body.slice(closeIdx + 1);
    let port: number | undefined;
    if (rest.length > 0) {
      if (!rest.startsWith(':') || !PORT_RE.test(rest.slice(1))) throw new AllowlistFormatError(rawInput);
      port = Number(rest.slice(1));
      if (port < 1 || port > 65535) throw new AllowlistFormatError(rawInput);
    }
    return { raw, wildcard, hostPattern: host, port };
  }

  // 일반 호스트 또는 host:port — 마지막 ':' 뒤가 전부 숫자이면 포트로 판정한다.
  const colonIdx = body.lastIndexOf(':');
  let hostPart = body;
  let port: number | undefined;
  if (colonIdx >= 0) {
    const maybePort = body.slice(colonIdx + 1);
    if (PORT_RE.test(maybePort)) {
      hostPart = body.slice(0, colonIdx);
      port = Number(maybePort);
      if (port < 1 || port > 65535) throw new AllowlistFormatError(rawInput);
    } else {
      throw new AllowlistFormatError(rawInput);
    }
  }
  if (hostPart.length === 0 || !HOST_RE.test(hostPart)) throw new AllowlistFormatError(rawInput);

  return { raw, wildcard, hostPattern: hostPart, port };
}

/** 쉼표 목록 문자열 → 파싱된 항목 배열. 빈 문자열은 빈 배열. */
export function parseAllowlist(csv: string): ParsedAllowlistEntry[] {
  const trimmed = csv.trim();
  if (trimmed.length === 0) return [];
  return trimmed
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => parseAllowlistEntry(s));
}

export interface EgressTarget {
  readonly host: string;
  readonly port: number;
}

/** URL 문자열 → { host, port }. IDN은 `URL`이 punycode로 정규화한다. */
export function parseEgressTarget(url: string): EgressTarget {
  const u = new URL(url);
  const host = u.hostname.toLowerCase();
  const port = u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80;
  return { host, port };
}

/**
 * 정확 일치 또는 `*.suffix`의 **접미 일치**(`a.b.suffix` ✅ · `suffix` 자체는 ❌). 항목에 포트가
 * 있으면 포트도 일치해야 한다. 루프백·사설 주소를 자동으로 허용하지 않는다(명시 등록 필요).
 */
export function matchHost(target: EgressTarget, entries: readonly ParsedAllowlistEntry[]): boolean {
  return entries.some((entry) => {
    if (entry.port !== undefined && entry.port !== target.port) return false;
    if (entry.wildcard) {
      return target.host.length > entry.hostPattern.length && target.host.endsWith(`.${entry.hostPattern}`);
    }
    return target.host === entry.hostPattern;
  });
}

export class EgressBlockedError extends Error {
  constructor(
    readonly exitId: EgressExitId,
    readonly host: string,
  ) {
    // 메시지에는 호스트만 — URL·쿼리·키는 담지 않는다(NFR-DGS1, G-14).
    super(`EGRESS_BLOCKED exit=${exitId} host=${host}`);
  }
}

/**
 * 출구 판정(순수 계산 + 런타임 읽기). 모드 OFF(`enforce=false`)이면 URL 파싱 없이 즉시 `'ALLOWED'`.
 * URL이 파싱되지 않으면(형식 오류) 안전 측으로 `'BLOCKED'`.
 */
export function checkEgress(exitId: EgressExitId, url: string): 'ALLOWED' | 'BLOCKED' {
  const runtime = governanceRuntime();
  if (!runtime.egress.enforce) return 'ALLOWED';

  let target: EgressTarget;
  try {
    target = parseEgressTarget(url);
  } catch {
    return 'BLOCKED';
  }

  let entries: ParsedAllowlistEntry[];
  try {
    entries = parseAllowlist(runtime.egress.allowlist.join(','));
  } catch {
    return 'BLOCKED';
  }

  return matchHost(target, entries) ? 'ALLOWED' : 'BLOCKED';
}

/** `checkEgress()`가 `'BLOCKED'`면 `EgressBlockedError`를 던진다. `exitId`의 라벨은 로그·오류 문맥용. */
export function assertEgressAllowed(exitId: EgressExitId, url: string): void {
  if (checkEgress(exitId, url) === 'BLOCKED') {
    let host = 'unknown';
    try {
      host = parseEgressTarget(url).host;
    } catch {
      // host 파싱 실패 — 'unknown' 유지(URL 원문을 메시지에 넣지 않는다)
    }
    throw new EgressBlockedError(exitId, host);
  }
}

/**
 * ★ M-1 픽스(코드 리뷰 R1) — 리다이렉트로 출구 게이트를 우회하는 것을 막는다. 사전 판정
 * (`assertEgressAllowed`)은 요청 URL의 호스트만 보므로, 허용된 호스트가 비허용 호스트로 3xx
 * 응답을 돌려주면 `fetch()`의 기본 동작(`follow`)이 그 호스트로 그대로 넘어가 게이트를 우회한다.
 *
 * 모드 ON(`enforce=true`)에서만 `redirect:'manual'`을 적용한다. 모드 OFF는 기존 `follow` 동작을
 * 그대로 유지해 §2.6 "①" 바이트 동일 원칙(모드 미설치 = 현행 동작)을 지킨다 — 레거시 트랜스포트의
 * `REDIRECT_NOT_ALLOWED` 정책과 같은 "리다이렉트를 따라가지 않는다" 통일 규약을
 * enforce 상태에 한해 적용한다(`data-governance-설계.md` §27 I-11).
 */
export function egressRedirectMode(): NonNullable<RequestInit['redirect']> {
  return governanceRuntime().egress.enforce ? 'manual' : 'follow';
}

/**
 * `redirect:'manual'`로 받은 응답이 3xx면 차단한다(호출부의 기존 실패 경로로 흡수되도록
 * `EgressBlockedError`를 던진다). Node의 `fetch`(undici)는 manual 모드에서도 실제 status를 그대로
 * 노출하므로(브라우저의 opaque-redirect 필터링과 다름) status만으로 판정한다. 모드 OFF에서는
 * `egressRedirectMode()`가 `'follow'`를 돌려주므로 이 함수가 3xx를 볼 일이 없다(방어적으로도
 * `enforce=false`면 아무 일도 하지 않는다 — `checkEgress()`와 같은 규약).
 */
export function assertNoRedirectResponse(exitId: EgressExitId, url: string, status: number): void {
  if (!governanceRuntime().egress.enforce) return;
  if (status < 300 || status >= 400) return;
  let host = 'unknown';
  try {
    host = parseEgressTarget(url).host;
  } catch {
    // host 파싱 실패 — 'unknown' 유지(URL 원문을 메시지에 넣지 않는다)
  }
  throw new EgressBlockedError(exitId, host);
}

// 라벨 재export(호출부 편의) — 순환 의존을 만들지 않는다(egress-registry는 shared-types만 의존).
export { egressExitLabel };
