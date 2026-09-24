import { classifyAddress, isAddressAllowlisted, isHostnameAllowlisted, parseAllowlist } from './ip-policy';

describe('ip-policy — SSRF 주소 분류(§7.4, AC-L4-1)', () => {
  it.each([
    ['127.0.0.1', 'ABSOLUTE_BLOCKED'],
    ['0.0.0.0', 'ABSOLUTE_BLOCKED'],
    ['169.254.169.254', 'ABSOLUTE_BLOCKED'], // 클라우드 메타데이터
    ['255.255.255.255', 'ABSOLUTE_BLOCKED'],
    ['100.100.100.200', 'ABSOLUTE_BLOCKED'],
    ['168.63.129.16', 'ABSOLUTE_BLOCKED'],
    ['::1', 'ABSOLUTE_BLOCKED'],
    ['fe80::1', 'ABSOLUTE_BLOCKED'],
    ['fd00:ec2::254', 'ABSOLUTE_BLOCKED'],
    ['10.0.0.5', 'PRIVATE'],
    ['172.16.0.5', 'PRIVATE'],
    ['192.168.1.1', 'PRIVATE'],
    ['8.8.8.8', 'PUBLIC'],
    ['203.0.113.5', 'PUBLIC'],
  ])('%s → %s', (address, expected) => {
    expect(classifyAddress(address)).toBe(expected);
  });

  it('임베디드 IPv4 — ::ffff:127.0.0.1(매핑)은 절대 차단이다', () => {
    expect(classifyAddress('::ffff:127.0.0.1')).toBe('ABSOLUTE_BLOCKED');
  });

  it('임베디드 IPv4 — 64:ff9b::7f00:1(NAT64)은 절대 차단이다', () => {
    expect(classifyAddress('64:ff9b::7f00:1')).toBe('ABSOLUTE_BLOCKED');
  });

  it('임베디드 IPv4 — 2002:7f00:1::(6to4)은 절대 차단이다', () => {
    expect(classifyAddress('2002:7f00:1::')).toBe('ABSOLUTE_BLOCKED');
  });

  it('allowlist에 절대 차단 대역을 기재해도 무시된다(AC-L4-1)', () => {
    const parsed = parseAllowlist('127.0.0.1,169.254.169.254/32');
    expect(parsed.warnings.length).toBeGreaterThan(0);
    expect(parsed.cidrs).toEqual([]);
    expect(isAddressAllowlisted('127.0.0.1', parsed)).toBe(false);
  });

  it('사설 대역은 allowlist CIDR에 포함될 때만 열린다', () => {
    const parsed = parseAllowlist('10.20.0.0/16');
    expect(parsed.warnings).toEqual([]);
    expect(isAddressAllowlisted('10.20.1.5', parsed)).toBe(true);
    expect(isAddressAllowlisted('10.21.1.5', parsed)).toBe(false);
  });

  it('IPv6 CIDR allowlist도 지원한다(EX-L-25)', () => {
    const parsed = parseAllowlist('fc00::/8');
    expect(isAddressAllowlisted('fc00::1234', parsed)).toBe(true);
  });

  it('정확한 호스트명 allowlist는 CIDR과 별도로 검사한다', () => {
    const parsed = parseAllowlist('internal.example.local');
    expect(isHostnameAllowlisted('internal.example.local', parsed)).toBe(true);
    expect(isHostnameAllowlisted('other.example.local', parsed)).toBe(false);
  });

  it('잘못된 형식의 allowlist 항목은 무시 + 경고를 남긴다', () => {
    const parsed = parseAllowlist('not-an-ip/40, ,');
    expect(parsed.warnings.length).toBeGreaterThan(0);
  });
});
