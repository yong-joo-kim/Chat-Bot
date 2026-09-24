import { BlockList, isIP, isIPv4, isIPv6 } from 'net';

/**
 * [No.26] SSRF 다층 방어 — IP 주소 분류(§7.4). DB·Nest·네트워크 무의존 순수 함수(NFR-LM1).
 * 신규 의존성 0 — Node 내장 `net.BlockList`(CIDR 판정) + 자체 임베디드 IPv4 추출만 쓴다.
 * `.`/`..`/`%2e%2e` 같은 경로 값 거부는 `build-request.ts`가 담당한다(이 파일은 주소 분류 전용).
 */

export type AddressClass = 'ABSOLUTE_BLOCKED' | 'PRIVATE' | 'PUBLIC';

const ABSOLUTE_BLOCK_V4: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // 링크로컬(메타데이터 169.254.169.254 포함)
  ['192.0.0.0', 24],
  ['224.0.0.0', 4], // 멀티캐스트
  ['240.0.0.0', 4], // 예약(255.255.255.255 포함)
  ['100.100.100.200', 32], // 클라우드 메타데이터
  ['168.63.129.16', 32], // 클라우드 메타데이터
];

const ABSOLUTE_BLOCK_V6: Array<[string, number]> = [
  ['::', 128],
  ['::1', 128],
  ['fe80::', 10],
  ['ff00::', 8],
  ['fd00:ec2::254', 128], // 클라우드 메타데이터
];

const PRIVATE_V4: Array<[string, number]> = [
  ['10.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['100.64.0.0', 10],
  ['198.18.0.0', 15],
];

const PRIVATE_V6: Array<[string, number]> = [
  ['fc00::', 7],
  ['fec0::', 10],
];

function buildBlockList(entries: ReadonlyArray<[string, number]>): BlockList {
  const bl = new BlockList();
  for (const [addr, prefix] of entries) {
    bl.addSubnet(addr, prefix, isIP(addr) === 6 ? 'ipv6' : 'ipv4');
  }
  return bl;
}

const absoluteV4 = buildBlockList(ABSOLUTE_BLOCK_V4);
const absoluteV6 = buildBlockList(ABSOLUTE_BLOCK_V6);
const privateV4Default = buildBlockList(PRIVATE_V4);
const privateV6Default = buildBlockList(PRIVATE_V6);

/* ------------------------------------------------------------------------------------------------
 * 임베디드 IPv4 추출 — `::ffff:0:0/96`(매핑) · `::/96`(호환) · `64:ff9b::/96`(NAT64) · `2002::/16`(6to4)
 * ---------------------------------------------------------------------------------------------- */

function expandIPv6(addr: string): string[] | null {
  const clean = addr.split('%')[0];
  if (!clean.includes(':')) return null;

  let head = clean;
  let tail = '';
  if (clean.includes('::')) {
    const parts = clean.split('::');
    if (parts.length > 2) return null;
    head = parts[0] ?? '';
    tail = parts[1] ?? '';
  }

  function expandGroupList(part: string): string[] {
    if (part.length === 0) return [];
    const groups = part.split(':');
    const last = groups[groups.length - 1];
    if (last.includes('.')) {
      const octets = last.split('.').map(Number);
      if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return groups;
      const hex1 = (((octets[0] << 8) | octets[1]) >>> 0).toString(16);
      const hex2 = (((octets[2] << 8) | octets[3]) >>> 0).toString(16);
      return [...groups.slice(0, -1), hex1, hex2];
    }
    return groups;
  }

  const h = expandGroupList(head);
  const t = expandGroupList(tail);
  const missing = 8 - h.length - t.length;
  if (missing < 0) return null;
  const middle = new Array(missing).fill('0');
  const full = [...h, ...middle, ...t].map((g) => g.padStart(4, '0').toLowerCase());
  return full.length === 8 ? full : null;
}

function allZeroRange(groups: string[], start: number, count: number): boolean {
  for (let i = start; i < start + count; i++) if (groups[i] !== '0000') return false;
  return true;
}

function groupsToIPv4(g1: string, g2: string): string {
  const n1 = parseInt(g1, 16);
  const n2 = parseInt(g2, 16);
  return [(n1 >> 8) & 0xff, n1 & 0xff, (n2 >> 8) & 0xff, n2 & 0xff].join('.');
}

/** IPv6 주소에 내장된 IPv4를 꺼낸다(없으면 `null`). */
export function extractEmbeddedIPv4(addr: string): string | null {
  const groups = expandIPv6(addr);
  if (!groups) return null;

  // IPv4-매핑 ::ffff:a.b.c.d (groups[0..4]=0, groups[5]=ffff)
  if (allZeroRange(groups, 0, 5) && groups[5] === 'ffff') return groupsToIPv4(groups[6], groups[7]);
  // NAT64 64:ff9b::a.b.c.d/96
  if (groups[0] === '0064' && groups[1] === 'ff9b' && allZeroRange(groups, 2, 4)) return groupsToIPv4(groups[6], groups[7]);
  // 6to4 2002:AABB:CCDD::/16
  if (groups[0] === '2002') return groupsToIPv4(groups[1], groups[2]);
  // IPv4-호환(폐기) ::a.b.c.d (groups[0..5]=0) — ::, ::1은 절대 차단 목록에서 별도 처리된다
  if (allZeroRange(groups, 0, 6)) return groupsToIPv4(groups[6], groups[7]);

  return null;
}

/** 절대 차단·사설·공인으로 분류한다. 임베디드 IPv4가 있으면 그 주소로 재판정한다. */
export function classifyAddress(address: string): AddressClass {
  const family = isIP(address);
  if (family === 0) return 'PUBLIC'; // 호출부가 이미 IP 리터럴만 넘긴다 — 방어적 기본값

  if (family === 6) {
    const embedded = extractEmbeddedIPv4(address);
    if (embedded) {
      const embeddedClass = classifyAddress(embedded);
      if (embeddedClass !== 'PUBLIC') return embeddedClass;
    }
    if (absoluteV6.check(address, 'ipv6')) return 'ABSOLUTE_BLOCKED';
    if (privateV6Default.check(address, 'ipv6')) return 'PRIVATE';
    return 'PUBLIC';
  }

  if (absoluteV4.check(address, 'ipv4')) return 'ABSOLUTE_BLOCKED';
  if (privateV4Default.check(address, 'ipv4')) return 'PRIVATE';
  return 'PUBLIC';
}

/* ------------------------------------------------------------------------------------------------
 * 사설 대역 allowlist(§3.5 `LEGACY_API_PRIVATE_ALLOWLIST`) — 절대 차단 대역은 allowlist로도 못 연다.
 * ---------------------------------------------------------------------------------------------- */

export interface ParsedAllowlist {
  cidrs: Array<{ address: string; prefix: number; family: 'ipv4' | 'ipv6' }>;
  hostnames: string[];
  warnings: string[];
}

function isAbsoluteBlockedCidr(address: string, family: 'ipv4' | 'ipv6'): boolean {
  return family === 'ipv6' ? absoluteV6.check(address, 'ipv6') : absoluteV4.check(address, 'ipv4');
}

/** 기동 시 1회 파싱 — 잘못된 항목·절대 차단 대역과 겹치는 항목은 무시 + 경고(기동 실패 아님). */
export function parseAllowlist(raw: string): ParsedAllowlist {
  const cidrs: ParsedAllowlist['cidrs'] = [];
  const hostnames: string[] = [];
  const warnings: string[] = [];

  const items = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const item of items) {
    const slashIdx = item.indexOf('/');
    if (slashIdx > 0) {
      const address = item.slice(0, slashIdx);
      const prefix = Number(item.slice(slashIdx + 1));
      const family = isIP(address);
      if (family === 0 || !Number.isInteger(prefix) || prefix < 0 || prefix > (family === 6 ? 128 : 32)) {
        warnings.push(`LEGACY_API_PRIVATE_ALLOWLIST 항목을 해석할 수 없어 무시합니다: ${item}`);
        continue;
      }
      const familyStr: 'ipv4' | 'ipv6' = family === 6 ? 'ipv6' : 'ipv4';
      if (isAbsoluteBlockedCidr(address, familyStr) || (familyStr === 'ipv4' && (prefix < 8 && address !== '0.0.0.0'))) {
        warnings.push(`LEGACY_API_PRIVATE_ALLOWLIST 항목이 절대 차단 대역과 겹치거나 지나치게 넓어 무시합니다: ${item}`);
        continue;
      }
      cidrs.push({ address, prefix, family: familyStr });
      continue;
    }

    const family = isIP(item);
    if (family !== 0) {
      const familyStr: 'ipv4' | 'ipv6' = family === 6 ? 'ipv6' : 'ipv4';
      if (isAbsoluteBlockedCidr(item, familyStr)) {
        warnings.push(`LEGACY_API_PRIVATE_ALLOWLIST 항목이 절대 차단 주소라 무시합니다: ${item}`);
        continue;
      }
      cidrs.push({ address: item, prefix: familyStr === 'ipv6' ? 128 : 32, family: familyStr });
      continue;
    }

    // 정확한 호스트명(EX 사내 DNS)
    hostnames.push(item.toLowerCase());
  }

  return { cidrs, hostnames, warnings };
}

function buildAllowlistBlockList(parsed: ParsedAllowlist): BlockList {
  const bl = new BlockList();
  for (const c of parsed.cidrs) bl.addSubnet(c.address, c.prefix, c.family);
  return bl;
}

/** 주소(사설 대역일 때만 의미)가 allowlist의 CIDR에 포함되는지 검사한다. */
export function isAddressAllowlisted(address: string, parsed: ParsedAllowlist): boolean {
  if (parsed.cidrs.length === 0) return false;
  const family = isIP(address);
  if (family === 0) return false;
  return buildAllowlistBlockList(parsed).check(address, family === 6 ? 'ipv6' : 'ipv4');
}

/** 연결 호스트명이 allowlist의 호스트명과 **정확히 일치**하는지 검사한다. */
export function isHostnameAllowlisted(hostname: string, parsed: ParsedAllowlist): boolean {
  return parsed.hostnames.includes(hostname.toLowerCase());
}

export { isIPv4, isIPv6 };
