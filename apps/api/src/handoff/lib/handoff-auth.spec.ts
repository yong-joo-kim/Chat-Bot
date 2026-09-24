import { classifyHandoffCase } from './handoff-auth';
import type { HandoffAuthLatest } from './handoff-auth';

const NOW = new Date('2026-01-01T00:00:00Z');
const GRACE = 300_000;

function input(overrides: { latest?: HandoffAuthLatest | null; hasFeatureFlag?: boolean; tokenHeaderPresent?: boolean; tokenMatches?: boolean; now?: Date } = {}) {
  return {
    latest: overrides.latest === undefined ? null : overrides.latest,
    hasFeatureFlag: overrides.hasFeatureFlag ?? true,
    tokenHeaderPresent: overrides.tokenHeaderPresent ?? false,
    tokenMatches: overrides.tokenMatches ?? false,
    now: overrides.now ?? NOW,
    endedGraceMs: GRACE,
  };
}

describe('classifyHandoffCase — §5.3 판정표', () => {
  it('G-0: 상담 행이 없으면 NONE이다', () => {
    expect(classifyHandoffCase(input({ latest: null }))).toBe('NONE');
  });

  it('G-2/G-3: CONNECTING·clientMode=null이면 FIRST_CONTACT이다(모던/레거시 구분은 호출부 책임)', () => {
    const latest: HandoffAuthLatest = { status: 'CONNECTING', tokenHash: null, clientMode: null, endedAt: null };
    expect(classifyHandoffCase(input({ latest }))).toBe('FIRST_CONTACT');
  });

  it('G-4: CONNECTED·MODERN에 토큰이 일치하면 VERIFIED다', () => {
    const latest: HandoffAuthLatest = { status: 'CONNECTED', tokenHash: 'hash', clientMode: 'MODERN', endedAt: null };
    expect(classifyHandoffCase(input({ latest, tokenHeaderPresent: true, tokenMatches: true }))).toBe('VERIFIED');
  });

  it('G-6: CONNECTED·MODERN인데 토큰이 없으면 UNVERIFIED다', () => {
    const latest: HandoffAuthLatest = { status: 'CONNECTED', tokenHash: 'hash', clientMode: 'MODERN', endedAt: null };
    expect(classifyHandoffCase(input({ latest, tokenHeaderPresent: false }))).toBe('UNVERIFIED');
  });

  it('G-6: CONNECTED·MODERN인데 토큰이 불일치하면 UNVERIFIED다', () => {
    const latest: HandoffAuthLatest = { status: 'CONNECTED', tokenHash: 'hash', clientMode: 'MODERN', endedAt: null };
    expect(classifyHandoffCase(input({ latest, tokenHeaderPresent: true, tokenMatches: false }))).toBe('UNVERIFIED');
  });

  it('G-5: CONNECTED·LEGACY에 기능 선언·토큰이 둘 다 없으면 LEGACY_ACTIVE다', () => {
    const latest: HandoffAuthLatest = { status: 'CONNECTED', tokenHash: null, clientMode: 'LEGACY', endedAt: null };
    expect(classifyHandoffCase(input({ latest, hasFeatureFlag: false, tokenHeaderPresent: false }))).toBe('LEGACY_ACTIVE');
  });

  it('G-6: LEGACY 상담에 기능 선언이 온 요청(모드 불일치)은 UNVERIFIED다', () => {
    const latest: HandoffAuthLatest = { status: 'CONNECTED', tokenHash: null, clientMode: 'LEGACY', endedAt: null };
    expect(classifyHandoffCase(input({ latest, hasFeatureFlag: true, tokenHeaderPresent: false }))).toBe('UNVERIFIED');
  });

  it('G-7: ENDED·유예 내·토큰 유효면 ENDED_GRACE다', () => {
    const latest: HandoffAuthLatest = { status: 'ENDED', tokenHash: 'hash', clientMode: 'MODERN', endedAt: new Date('2026-01-01T00:00:00Z') };
    const now = new Date('2026-01-01T00:04:00Z');
    expect(classifyHandoffCase(input({ latest, now, tokenHeaderPresent: true, tokenMatches: true }))).toBe('ENDED_GRACE');
  });

  it('G-8: ENDED·LEGACY·유예 내면 토큰 없이도 ENDED_GRACE다(편승 전달)', () => {
    const latest: HandoffAuthLatest = { status: 'ENDED', tokenHash: null, clientMode: 'LEGACY', endedAt: new Date('2026-01-01T00:00:00Z') };
    const now = new Date('2026-01-01T00:04:00Z');
    expect(classifyHandoffCase(input({ latest, now }))).toBe('ENDED_GRACE');
  });

  it('G-9: ENDED·유예 경과면 ENDED_EXPIRED다', () => {
    const latest: HandoffAuthLatest = { status: 'ENDED', tokenHash: 'hash', clientMode: 'MODERN', endedAt: new Date('2026-01-01T00:00:00Z') };
    const now = new Date('2026-01-01T00:06:00Z');
    expect(classifyHandoffCase(input({ latest, now, tokenHeaderPresent: true, tokenMatches: true }))).toBe('ENDED_EXPIRED');
  });

  it('G-9: ENDED·유예 내인데 MODERN 토큰이 없으면 ENDED_EXPIRED다', () => {
    const latest: HandoffAuthLatest = { status: 'ENDED', tokenHash: 'hash', clientMode: 'MODERN', endedAt: new Date('2026-01-01T00:00:00Z') };
    const now = new Date('2026-01-01T00:01:00Z');
    expect(classifyHandoffCase(input({ latest, now, tokenHeaderPresent: false }))).toBe('ENDED_EXPIRED');
  });
});
