import { maskPii } from './index';

/** [No.36] 출구 전용 선택 인자(`kinds`·`preserveDates`) — ai-guardrails-설계.md §7.2. */
describe('maskPii 선택 인자', () => {
  const RRN = '901231-1234567';
  const CARD = '1234-5678-9012-3456';
  const PHONE = '010-1234-5678';
  const ACCOUNT = '110-234-567890';
  const EMAIL = 'abcd@example.com';
  const sample = `주민 ${RRN} 카드 ${CARD} 전화 ${PHONE} 계좌 ${ACCOUNT} 메일 ${EMAIL}`;

  it('기본 종류(rrn·card)만 가리면 나머지는 원문 그대로다', () => {
    const r = maskPii(sample, { kinds: ['rrn', 'card'] });
    expect(r.maskedText).toBe(`주민 [주민등록번호] 카드 [카드번호] 전화 ${PHONE} 계좌 ${ACCOUNT} 메일 ${EMAIL}`);
    expect(r.counts).toEqual({ rrn: 1, card: 1, account: 0, phone: 0, email: 0 });
  });

  it.each([
    ['rrn', RRN, '[주민등록번호]'],
    ['card', CARD, '[카드번호]'],
    ['phone', PHONE, '010-****-5678'],
    ['account', ACCOUNT, '[계좌번호]'],
    ['email', EMAIL, 'a***@example.com'],
  ] as const)('%s 단독 선택', (kind, raw, masked) => {
    const r = maskPii(sample, { kinds: [kind] });
    expect(r.maskedText).toContain(masked);
    expect(r.counts[kind]).toBe(1);
    expect(Object.values(r.counts).reduce((a, b) => a + b, 0)).toBe(1);
    for (const other of [RRN, CARD, PHONE, ACCOUNT, EMAIL].filter((x) => x !== raw)) expect(r.maskedText).toContain(other);
  });

  it('빈 배열이면 아무것도 가리지 않는다', () => {
    const r = maskPii(sample, { kinds: [] });
    expect(r.maskedText).toBe(sample);
    expect(Object.values(r.counts).every((c) => c === 0)).toBe(true);
  });

  it('전화 끔 + 계좌 켬에서도 전화번호는 계좌로 가려지지 않는다(앞 종류 우선 분류 보존)', () => {
    const r = maskPii('연락 010-1234-5678 입니다', { kinds: ['account'] });
    expect(r.maskedText).toBe('연락 010-1234-5678 입니다');
    expect(r.counts.account).toBe(0);
  });

  it('카드 끔 + 계좌 켬에서도 카드번호(공백 구분)는 그대로 남는다', () => {
    const r = maskPii('카드 1234 5678 9012 3456', { kinds: ['account'] });
    expect(r.maskedText).toBe('카드 1234 5678 9012 3456');
  });

  it('FULL 모드는 선택된 전화·이메일을 전량 토큰으로 바꾼다', () => {
    const r = maskPii(sample, { mode: 'FULL', kinds: ['phone', 'email'] });
    expect(r.maskedText).toContain('[전화번호]');
    expect(r.maskedText).toContain('[이메일]');
    expect(r.maskedText).toContain(RRN);
  });

  describe('preserveDates', () => {
    it('계좌 선택 + 날짜 보호: 날짜는 남고 계좌는 가려진다', () => {
      const r = maskPii(`2026-09-30 에 ${ACCOUNT} 입금`, { kinds: ['account'], preserveDates: true });
      expect(r.maskedText).toBe('2026-09-30 에 [계좌번호] 입금');
      expect(r.counts.account).toBe(1);
    });

    it('날짜 비보호이면 기존 오인을 재현한다(EX-AG-19)', () => {
      const r = maskPii('일자 2026-09-30 입니다', { kinds: ['account'], preserveDates: false });
      expect(r.maskedText).toBe('일자 [계좌번호] 입니다');
    });

    it('preserveDates만 주어도(kinds 생략) 5종 전부 + 날짜 보호로 동작한다', () => {
      const r = maskPii(`2026-09-30 ${RRN}`, { preserveDates: true });
      expect(r.maskedText).toBe('2026-09-30 [주민등록번호]');
    });

    it('날짜 정규식은 주민번호·카드·전화와 겹치지 않는다', () => {
      const dates = ['2026-09-30', '1999-12-31', '2000-01-01'];
      for (const d of dates) {
        const r = maskPii(d, { kinds: ['rrn', 'card', 'phone', 'email'] });
        expect(r.maskedText).toBe(d);
      }
    });

    it('날짜가 아닌 값(월 13)은 보호하지 않는다', () => {
      const r = maskPii('2026-13-01', { kinds: ['account'], preserveDates: true });
      expect(r.maskedText).toBe('[계좌번호]');
    });
  });

  it('입력에 사설 영역 문자가 있으면 5종 전부 가림으로 떨어진다(fail-closed, K-11)', () => {
    const pua = String.fromCharCode(0xe000);
    const r = maskPii(`${pua} ${PHONE} ${EMAIL}`, { kinds: ['rrn'] });
    expect(r.maskedText).not.toContain(PHONE);
    expect(r.maskedText).not.toContain(EMAIL);
    expect(r.counts.phone).toBe(1);
  });

  it('빈 문자열은 그대로 돌려준다', () => {
    expect(maskPii('', { kinds: ['rrn'] }).maskedText).toBe('');
  });

  it('보호 자리표시가 많아도(300건) 원문이 정확히 복원된다', () => {
    const text = Array.from({ length: 300 }, (_, i) => `010-1234-${String(1000 + i)}`).join(' ');
    const r = maskPii(text, { kinds: ['email'] });
    expect(r.maskedText).toBe(text);
  });
});
