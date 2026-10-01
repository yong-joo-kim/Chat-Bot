import { configurePiiMaskMode, resetPiiMaskModeForTest } from '@chat-bot/pii-mask';
import { compileProfile } from './compile-profile';
import { applyGovernanceFloor, governanceFloorKinds, isTokensOnly, maskExit, normalizeKinds } from './exit-pii';
import { judgeOutbound } from './judge-outbound';
import type { GuardrailRuleRow } from './types';

const RRN = '901231-1234567';
const CARD = '1234-5678-9012-3456';
const PHONE = '010-1234-5678';
const ACCOUNT = '110-234-567890';
const DEFAULT_SETTING = { kinds: ['RRN', 'CARD'] as const, preserveDates: true };

function outboundRule(overrides: Partial<GuardrailRuleRow> = {}): GuardrailRuleRow {
  return {
    id: 'r1',
    name: '규칙',
    category: 'MEDICAL_ADVICE',
    expressions: ['복용하세요'],
    matchType: 'CONTAINS',
    appliesTo: 'OUTBOUND',
    action: 'MONITOR',
    replacementText: null,
    sortOrder: 1,
    createdAt: new Date(2026, 0, 1),
    ...overrides,
  };
}

describe('exit-pii — 출구 전용 선택 가림', () => {
  afterEach(() => resetPiiMaskModeForTest());

  it('기본 종류(주민번호·카드)만 가리고 전화·계좌는 그대로 둔다', () => {
    const r = maskExit(`주민 ${RRN} 카드 ${CARD} 전화 ${PHONE} 계좌 ${ACCOUNT}`, ['RRN', 'CARD'], true);
    expect(r.maskedText).toBe(`주민 [주민등록번호] 카드 [카드번호] 전화 ${PHONE} 계좌 ${ACCOUNT}`);
    expect(r.counts).toEqual({ RRN: 1, CARD: 1 });
  });

  it('종류가 비어 있으면 원문 그대로(현행과 동일)', () => {
    const text = `주민 ${RRN}`;
    expect(maskExit(text, [], true)).toEqual({ maskedText: text, counts: {} });
  });

  it('계좌 선택 + 날짜 보호 — 날짜는 남는다 / 날짜 비보호면 계좌로 오인해 가린다(EX-AG-19)', () => {
    expect(maskExit('2026-09-30 안내', ['ACCOUNT'], true).maskedText).toBe('2026-09-30 안내');
    expect(maskExit('2026-09-30 안내', ['ACCOUNT'], false).maskedText).toBe('[계좌번호] 안내');
  });

  it('L-5 U-1 — 생년월일 문맥 날짜는 계좌 켬 + 날짜 보호 켬일 때만 가려진다 / 계좌 끔·날짜 일반은 그대로', () => {
    expect(maskExit('생년월일 1990-05-12', ['ACCOUNT'], true).maskedText).toBe('생년월일 [계좌번호]');
    expect(maskExit('생년월일 1990-05-12', ['RRN', 'CARD'], true).maskedText).toBe('생년월일 1990-05-12');
    expect(maskExit('생년월일 1990-05-12, 배송 2026-09-30', ['ACCOUNT'], true).maskedText).toBe('생년월일 [계좌번호], 배송 2026-09-30');
    // 날짜 보호 끔이면 모든 날짜를 가린다(구 동작 — 변화 없음).
    expect(maskExit('생년월일 1990-05-12', ['ACCOUNT'], false).maskedText).toBe('생년월일 [계좌번호]');
  });

  it('L-5 2차 — 출구도 확장 규칙을 쓴다: 낫표·주석·birth date 문맥 날짜는 계좌 켬일 때 가려진다', () => {
    expect(maskExit('생년월일 「1990-05-12」', ['ACCOUNT'], true).maskedText).toBe('생년월일 「[계좌번호]」');
    expect(maskExit('생년월일 (양력) 1990-05-12', ['ACCOUNT'], true).maskedText).toBe('생년월일 (양력) [계좌번호]');
    expect(maskExit('Birth date: 1990-05-12', ['ACCOUNT'], true).maskedText).toBe('Birth date: [계좌번호]');
    expect(maskExit('생년월일 「1990-05-12」', ['RRN', 'CARD'], true).maskedText).toBe('생년월일 「1990-05-12」');
  });

  it('강도는 서버 PII_MASK_MODE를 따른다(FULL이면 전화 전량 토큰)', () => {
    configurePiiMaskMode('FULL');
    expect(maskExit(`전화 ${PHONE}`, ['PHONE'], true).maskedText).toBe('전화 [전화번호]');
  });

  it('normalizeKinds는 중복 제거 · 닫힌 집합 밖 값 제거 · 고정 순서', () => {
    expect(normalizeKinds(['EMAIL', 'RRN', 'RRN', 'XXX'])).toEqual(['RRN', 'EMAIL']);
  });

  it('거버넌스 하한 — ON이면 주민번호·카드를 합집합으로 강제한다', () => {
    expect(applyGovernanceFloor([], true)).toEqual(['RRN', 'CARD']);
    expect(applyGovernanceFloor(['PHONE'], true)).toEqual(['RRN', 'CARD', 'PHONE']);
    expect(applyGovernanceFloor([], false)).toEqual([]);
    expect(governanceFloorKinds(false)).toEqual([]);
  });

  it('isTokensOnly — 토큰·공백·문장부호만 남으면 true', () => {
    expect(isTokensOnly('[주민등록번호]')).toBe(true);
    expect(isTokensOnly(' [카드번호], [주민등록번호]. ')).toBe(true);
    expect(isTokensOnly('010-****-5678')).toBe(true);
    expect(isTokensOnly('a***@example.com')).toBe(true);
    expect(isTokensOnly('번호는 [카드번호] 입니다')).toBe(false);
  });
});

describe('judgeOutbound — 출구 판정 합성(설계서 §6.2)', () => {
  const noRules = compileProfile([]);

  it('규칙도 개인정보도 없으면 PASS(원문 그대로)', () => {
    const v = judgeOutbound('안녕하세요', noRules, DEFAULT_SETTING, false);
    expect(v).toMatchObject({ kind: 'PASS', text: '안녕하세요', hits: [], piiCounts: {} });
  });

  it('기록만 규칙만 걸리면 MONITOR(텍스트 불변)', () => {
    const v = judgeOutbound('하루 세 번 복용하세요', compileProfile([outboundRule()]), DEFAULT_SETTING, false);
    expect(v.kind).toBe('MONITOR');
    expect(v.text).toBe('하루 세 번 복용하세요');
    expect(v.hits).toHaveLength(1);
  });

  it('개인정보가 가려지면 MASKED + 종류별 건수', () => {
    const v = judgeOutbound(`주민번호는 ${RRN}, 카드는 ${CARD} 입니다.`, noRules, DEFAULT_SETTING, false);
    expect(v.kind).toBe('MASKED');
    expect(v.text).toBe('주민번호는 [주민등록번호], 카드는 [카드번호] 입니다.');
    expect(v.piiCounts).toEqual({ RRN: 1, CARD: 1 });
  });

  it('REPLACE 규칙이 걸리면 대체 문구(개인정보 가림은 건너뛴다)', () => {
    const rule = outboundRule({ action: 'REPLACE', replacementText: '의료 상담은 전문가에게 문의하세요.' });
    const v = judgeOutbound(`복용하세요 ${RRN}`, compileProfile([rule]), DEFAULT_SETTING, false);
    expect(v.kind).toBe('REPLACE');
    expect(v.replacementText).toBe('의료 상담은 전문가에게 문의하세요.');
    expect(v.decisiveRuleId).toBe('r1');
  });

  it('가림 결과가 토큰만 남으면 FALLBACK(PII_ONLY)', () => {
    const v = judgeOutbound(`${RRN}`, noRules, DEFAULT_SETTING, false);
    expect(v).toMatchObject({ kind: 'FALLBACK', fallbackReason: 'PII_ONLY', piiCounts: { RRN: 1 } });
  });

  it('REPLACE인데 대체 문구가 비어 있는 데이터 이상은 원답을 내보내지 않고 FALLBACK(ERROR)', () => {
    const rule = outboundRule({ action: 'REPLACE', replacementText: null });
    const v = judgeOutbound('복용하세요', compileProfile([rule]), DEFAULT_SETTING, false);
    expect(v).toMatchObject({ kind: 'FALLBACK', fallbackReason: 'ERROR' });
  });

  it('가림 종류를 비우면(끔) 개인정보가 있어도 PASS — 현행과 동일(AC-AG4-6)', () => {
    const v = judgeOutbound(`주민 ${RRN}`, noRules, { kinds: [], preserveDates: true }, false);
    expect(v.kind).toBe('PASS');
    expect(v.text).toBe(`주민 ${RRN}`);
  });

  it('거버넌스 ON이면 설정이 비어 있어도 주민번호는 가려진다(런타임 하한)', () => {
    const v = judgeOutbound(`주민번호 ${RRN} 입니다`, noRules, { kinds: [], preserveDates: true }, true);
    expect(v.kind).toBe('MASKED');
  });
});
