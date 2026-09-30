import { maskPii } from '@chat-bot/pii-mask';
import { BannedWordEntry, maskText } from '../../banned-words/lib/banned-word-filter';
import { hasMaskResidue, stripMaskTokens } from './mask-tokens';

/**
 * 마스킹 결합 시험 — 실제 `maskPii()`·`maskText()` 출력을 그대로 넣어 표식이 전부 제거되는지 단언한다.
 * pii-mask / 금지어 마스킹 규칙이 바뀌면 이 시험이 먼저 깨진다(설계서 §6.1 ①).
 * 가짜 개인정보는 형식만 맞춘 무효 값이다.
 */
const SAMPLES = [
  '010-1234-5678 로 연락 주세요 해지 문의',
  '주민번호 000101-3123456 으로 조회해 주세요',
  '카드 1234-5678-9012-3456 분실했어요',
  '계좌 123-456-7890 으로 환불',
  '이메일은 abcdef@example.com 입니다 변경해 주세요',
  '02-123-4567 또는 010-0000-0011 또는 test.user@corp.co.kr',
];

const BANNED: BannedWordEntry = { word: '욕설', wordNormalized: '욕설', matchType: 'CONTAINS', policy: 'WARN' };

describe('mask-tokens 결합 (실제 마스킹 출력)', () => {
  for (const mode of ['PARTIAL', 'FULL'] as const) {
    it(`maskPii(${mode}) 출력에서 표식이 모두 제거된다`, () => {
      for (const s of SAMPLES) {
        const masked = maskPii(s, { mode }).maskedText;
        const stripped = stripMaskTokens(masked);
        expect(stripped).not.toMatch(/[*\[\]]/);
        expect(stripped).not.toMatch(/\d{3}-\d{4}/); // 부분 마스킹 전화의 자리 잔여
        expect(hasMaskResidue(stripped)).toBe(false);
      }
    });
  }

  it('본문 단어는 남는다 — "해지 문의"', () => {
    const masked = maskPii('010-1234-5678 로 연락 주세요 해지 문의', { mode: 'FULL' }).maskedText;
    expect(masked).toContain('[전화번호]');
    expect(stripMaskTokens(masked)).toBe('로 연락 주세요 해지 문의');
  });

  it('부분 마스킹 이메일(a***@domain)과 전화(010-****-5678)를 제거한다', () => {
    const partial = maskPii('abcdef@example.com / 010-1234-5678 문의', { mode: 'PARTIAL' }).maskedText;
    expect(partial).toContain('a***@example.com');
    expect(partial).toContain('010-****-5678');
    expect(stripMaskTokens(partial)).toBe('/ 문의');
  });

  it('금지어 마스킹(**)을 제거한다', () => {
    const masked = maskText('이 욕설 정말 싫어요', [BANNED]);
    expect(masked).toContain('**');
    expect(stripMaskTokens(masked)).toBe('이 정말 싫어요');
  });

  it('금지어 + PII가 함께 있어도 모두 제거된다(저장 순서: 금지어 → PII)', () => {
    const mixed = maskPii(maskText('욕설 010-9999-0000 욕설 test@a.com', [BANNED]), { mode: 'PARTIAL' }).maskedText;
    expect(stripMaskTokens(mixed)).toBe('');
  });

  it('표식이 없는 문장은 공백만 정리하고 그대로 둔다', () => {
    expect(stripMaskTokens('  카드   분실 신고  ')).toBe('카드 분실 신고');
  });

  it('hasMaskResidue: * 또는 대괄호 표식이 남은 토큰을 식별한다', () => {
    expect(hasMaskResidue('a*b')).toBe(true);
    expect(hasMaskResidue('[전화번호]')).toBe(true);
    expect(hasMaskResidue('전화번호')).toBe(false);
  });
});
