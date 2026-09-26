import { installGovernanceRuntime, resetGovernanceRuntimeForTest } from '../governance/governance-runtime';
import { AllowlistFormatError, EgressBlockedError, assertEgressAllowed, checkEgress, matchHost, parseAllowlist, parseAllowlistEntry, parseEgressTarget } from './egress-guard';

describe('egress-guard(No.45) — 순수 파싱·판정 + 런타임 연동', () => {
  afterEach(() => {
    resetGovernanceRuntimeForTest();
  });

  describe('parseAllowlistEntry — 순수', () => {
    it('정확 일치 항목을 파싱한다', () => {
      const entry = parseAllowlistEntry('ml-worker.internal');
      expect(entry).toEqual({ raw: 'ml-worker.internal', wildcard: false, hostPattern: 'ml-worker.internal', port: undefined });
    });

    it('포트 포함 항목을 파싱한다', () => {
      const entry = parseAllowlistEntry('127.0.0.1:8000');
      expect(entry.hostPattern).toBe('127.0.0.1');
      expect(entry.port).toBe(8000);
    });

    it('와일드카드(*.suffix) 항목을 파싱한다', () => {
      const entry = parseAllowlistEntry('*.example.com');
      expect(entry.wildcard).toBe(true);
      expect(entry.hostPattern).toBe('example.com');
    });

    it('IPv6 대괄호 표기를 파싱한다', () => {
      const entry = parseAllowlistEntry('[::1]:8000');
      expect(entry.hostPattern).toBe('::1');
      expect(entry.port).toBe(8000);
    });

    it('스킴·경로·공백이 섞인 항목은 예외를 던진다(조용한 무시 금지)', () => {
      expect(() => parseAllowlistEntry('https://example.com')).toThrow(AllowlistFormatError);
      expect(() => parseAllowlistEntry('example.com/path')).toThrow(AllowlistFormatError);
      expect(() => parseAllowlistEntry('exa mple.com')).toThrow(AllowlistFormatError);
      expect(() => parseAllowlistEntry('')).toThrow(AllowlistFormatError);
    });
  });

  describe('matchHost — 순수(접미 일치 · 포트)', () => {
    it('정확 일치만 허용한다(루트 도메인 자체는 *.suffix로 매치되지 않는다)', () => {
      const entries = [parseAllowlistEntry('*.example.com')];
      expect(matchHost({ host: 'a.example.com', port: 443 }, entries)).toBe(true);
      expect(matchHost({ host: 'example.com', port: 443 }, entries)).toBe(false);
    });

    it('항목에 포트가 있으면 포트도 일치해야 한다', () => {
      const entries = [parseAllowlistEntry('ml-worker.internal:8000')];
      expect(matchHost({ host: 'ml-worker.internal', port: 8000 }, entries)).toBe(true);
      expect(matchHost({ host: 'ml-worker.internal', port: 9000 }, entries)).toBe(false);
    });

    it('루프백은 자동 허용되지 않는다 — 명시 등록해야 한다', () => {
      const entries = [parseAllowlistEntry('example.com')];
      expect(matchHost({ host: '127.0.0.1', port: 80 }, entries)).toBe(false);
      expect(matchHost({ host: 'localhost', port: 80 }, entries)).toBe(false);
    });
  });

  describe('parseEgressTarget', () => {
    it('스킴 기본 포트를 채운다', () => {
      expect(parseEgressTarget('https://ml-worker.internal/health')).toEqual({ host: 'ml-worker.internal', port: 443 });
      expect(parseEgressTarget('http://ml-worker.internal/health')).toEqual({ host: 'ml-worker.internal', port: 80 });
      expect(parseEgressTarget('http://ml-worker.internal:9000/health')).toEqual({ host: 'ml-worker.internal', port: 9000 });
    });
  });

  describe('checkEgress/assertEgressAllowed — 런타임 연동', () => {
    it('런타임 미설치(모드 OFF 기본값)에서는 항상 ALLOWED — 파싱조차 하지 않는다', () => {
      expect(checkEgress('EMBEDDING', 'not a url at all')).toBe('ALLOWED');
    });

    it('모드 ON · 허용 목록에 없으면 BLOCKED, 있으면 ALLOWED', () => {
      installGovernanceRuntime({ mode: 'ON', egress: { allowlist: ['ml-worker.internal'], enforce: true }, encryptionEnabled: false });
      expect(checkEgress('EMBEDDING', 'http://ml-worker.internal:8000/health')).toBe('ALLOWED');
      expect(checkEgress('EMBEDDING', 'http://evil.example.com/health')).toBe('BLOCKED');
    });

    it('BLOCKED면 assertEgressAllowed가 EgressBlockedError를 던지고 메시지에 호스트만 담는다(URL·쿼리 없음)', () => {
      installGovernanceRuntime({ mode: 'ON', egress: { allowlist: [], enforce: true }, encryptionEnabled: false });
      expect(() => assertEgressAllowed('RAG', 'http://blocked.example.com/query?secret=abc')).toThrow(EgressBlockedError);
      try {
        assertEgressAllowed('RAG', 'http://blocked.example.com/query?secret=abc');
        fail('예외가 발생해야 합니다');
      } catch (e) {
        expect(e).toBeInstanceOf(EgressBlockedError);
        expect((e as Error).message).not.toContain('secret=abc');
        expect((e as Error).message).toContain('blocked.example.com');
      }
    });

    it('parseAllowlist는 빈 문자열이면 빈 배열을 반환한다', () => {
      expect(parseAllowlist('')).toEqual([]);
      expect(parseAllowlist('  ')).toEqual([]);
    });
  });
});
