import { hostMatchesRules } from '@chat-bot/shared-types';
import { parseProactiveLinkPolicyHosts, safeHostOf } from './link-policy';

describe('parseProactiveLinkPolicyHosts', () => {
  it('정상 JSON 배열을 파싱한다', () => {
    const json = JSON.stringify([{ host: 'example.com', includeSubdomains: true }]);
    expect(parseProactiveLinkPolicyHosts(json)).toEqual([{ host: 'example.com', includeSubdomains: true }]);
  });

  it('불량 JSON은 빈 배열', () => {
    expect(parseProactiveLinkPolicyHosts('{broken')).toEqual([]);
  });

  it('배열이 아니면 빈 배열', () => {
    expect(parseProactiveLinkPolicyHosts('{}')).toEqual([]);
  });

  it('형식이 안 맞는 항목은 걸러낸다', () => {
    const json = JSON.stringify([{ host: 'ok.com', includeSubdomains: false }, { host: 123 }, { includeSubdomains: true }]);
    expect(parseProactiveLinkPolicyHosts(json)).toEqual([{ host: 'ok.com', includeSubdomains: false }]);
  });
});

describe('safeHostOf', () => {
  it('https URL의 호스트를 소문자로 반환한다', () => {
    expect(safeHostOf('https://Example.COM/path')).toBe('example.com');
  });
  it('파싱 불가한 값은 null', () => {
    expect(safeHostOf('not a url')).toBeNull();
  });
});

describe('parseProactiveLinkPolicyHosts + hostMatchesRules 조합(허용 도메인 판정)', () => {
  it('하위 도메인 포함 규칙과 함께 동작한다', () => {
    const hosts = parseProactiveLinkPolicyHosts(JSON.stringify([{ host: 'example.com', includeSubdomains: true }]));
    expect(hostMatchesRules(safeHostOf('https://shop.example.com') ?? '', hosts)).toBe(true);
    expect(hostMatchesRules(safeHostOf('https://other.com') ?? '', hosts)).toBe(false);
  });
});
