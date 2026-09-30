import { maskPii } from '@chat-bot/pii-mask';
import { cleanCell, containsMaskToken, maskFileName, maskUtterance, prepareUtterances } from './prepare-utterances';
import type { MaskDeps, RawUtteranceRow } from './prepare-utterances';

/** 금지어 사전 = "나쁜말" 1개(마스킹 문자 `*` 치환) — `BannedWordFilterService.maskPlainText`의 모양만 흉내 낸다. */
const deps: MaskDeps = {
  maskBanned: async (t) => t.replace(/나쁜말/g, '***'),
  maskPii: (t) => maskPii(t).maskedText,
};

let n = 1;
function row(utterance: string, count = '', memo = ''): RawUtteranceRow {
  n += 1;
  return { rowNumber: n, utterance, countCell: count, memoCell: memo };
}

describe('prepare-utterances — 발화 행 정리·병합·제외·마스킹(설계서 §7.2)', () => {
  it('1: 앞뒤 공백·줄바꿈·탭·제어문자를 정리하고 NFC로 만든다(빈 문자열 = EMPTY)', async () => {
    expect(cleanCell('  환불\n\t해 주세요\u0007  ')).toBe('환불 해 주세요');
    const r = await prepareUtterances([row('   '), row('\n\t'), row('환불 문의합니다')], deps, { maxChars: 300 });
    expect(r.counts.excluded.EMPTY).toBe(2);
    expect(r.utterances).toHaveLength(1);
  });

  it('2·3: 금지어 → PII 마스킹 순서이며 변화가 있을 때만 플래그가 선다', async () => {
    const r = await prepareUtterances(
      [row('나쁜말 배송이 늦어요'), row('연락처 010-1234-5678 로 전화 주세요'), row('그냥 평범한 문의입니다')],
      deps,
      { maxChars: 300 },
    );
    expect(r.counts.bannedRowCount).toBe(1);
    expect(r.counts.maskedRowCount).toBe(1);
    const banned = r.utterances.find((u) => u.hasBannedWord);
    expect(banned?.text).toContain('***');
    const masked = r.utterances.find((u) => u.text.includes('010-'));
    expect(masked?.text).not.toContain('1234'); // 부분 마스킹(PARTIAL) — 가운데 자리는 가려진다
    expect(masked?.hasMaskToken).toBe(true);
    expect(r.utterances.find((u) => u.text.startsWith('그냥'))?.hasMaskToken).toBe(false);
  });

  it('4: 마스킹 후 길이가 상한을 넘으면 TOO_LONG', async () => {
    const r = await prepareUtterances([row('가'.repeat(301)), row('가'.repeat(300))], deps, { maxChars: 300 });
    expect(r.counts.excluded.TOO_LONG).toBe(1);
    expect(r.utterances).toHaveLength(1);
  });

  it('5: 표식·기호·숫자를 뺀 내용 글자가 0이면 NO_CONTENT(EX-DC-6)', async () => {
    const r = await prepareUtterances([row('12345 !!! ???'), row('[전화번호]'), row('*** ***')], deps, { maxChars: 300 });
    expect(r.counts.excluded.NO_CONTENT).toBe(3);
    expect(r.utterances).toHaveLength(0);
  });

  it('6: 정규화 길이가 2 미만이면 TOO_SHORT', async () => {
    const r = await prepareUtterances([row('네'), row('a'), row('네네')], deps, { maxChars: 300 });
    expect(r.counts.excluded.TOO_SHORT).toBe(2);
    expect(r.utterances).toHaveLength(1);
  });

  it('7: 발생 횟수가 정수 1~1,000,000이 아니면 1로 두고 invalidCountRows를 센다(제외하지 않음 — EX-DC-20)', async () => {
    const r = await prepareUtterances(
      [row('환불 문의 하나', '5'), row('환불 문의 둘', 'abc'), row('환불 문의 셋', '0'), row('환불 문의 넷', '1000001'), row('환불 문의 다섯', ''), row('환불 문의 여섯', '2.5')],
      deps,
      { maxChars: 300 },
    );
    expect(r.utterances.map((u) => u.count)).toEqual([5, 1, 1, 1, 1, 1]);
    expect(r.counts.invalidCountRows).toBe(4); // abc · 0 · 1000001 · 2.5 (빈 셀은 오류가 아니다)
    expect(r.counts.occurrenceTotal).toBe(10);
  });

  it('8: 출처 메모도 같은 마스킹을 거치고 100자로 절단한다', async () => {
    const r = await prepareUtterances([row('환불 문의합니다', '', `담당 010-9999-8888 ${'가'.repeat(200)}`)], deps, { maxChars: 300 });
    expect(r.utterances[0].memo).not.toBeNull();
    expect(r.utterances[0].memo as string).not.toContain('9999');
    expect((r.utterances[0].memo as string).length).toBeLessThanOrEqual(100);
  });

  it('9: 병합 키 = 마스킹본 — 원문이 달라도 마스킹본이 같으면 합쳐진다(FULL/PARTIAL 모드 무관, 발생 횟수 합산)', async () => {
    const fullMask: MaskDeps = { maskBanned: async (t) => t, maskPii: (t) => maskPii(t, { mode: 'FULL' }).maskedText };
    const r = await prepareUtterances(
      [row('010-1234-5678 해지해 주세요', '2', '첫 메모'), row('010-9999-0000 해지해 주세요', '3', '둘째 메모'), row('배송 문의', '1')],
      fullMask,
      { maxChars: 300 },
    );
    expect(r.counts.mergedCount).toBe(1);
    expect(r.utterances).toHaveLength(2);
    const merged = r.utterances[0];
    expect(merged.count).toBe(5);
    expect(merged.memo).toBe('첫 메모'); // 먼저 나온 비어 있지 않은 메모
    expect(r.counts.validCount).toBe(2);
  });

  it('9: 병합 시 대표 표기 = 먼저 나온 행 · hasBannedWord·hasMaskToken은 OR', async () => {
    const r = await prepareUtterances([row('환불 문의  합니다'), row('환불 문의 합니다'), row('나쁜말 환불 문의 합니다')], deps, { maxChars: 300 });
    // 공백 정규화로 앞의 두 줄은 같다. 세 번째는 마스킹본이 달라 별개.
    expect(r.utterances).toHaveLength(2);
    expect(r.utterances[0].count).toBe(2);
  });

  it('전체 건수·병합 건수·발생 합이 일관된다(totalRows = 입력 행, validCount = 고유 발화)', async () => {
    const rows = [row('환불 문의합니다', '2'), row('환불 문의합니다', '3'), row(''), row('12'), row('배송 조회 부탁'), row('가'.repeat(400))];
    const r = await prepareUtterances(rows, deps, { maxChars: 300 });
    expect(r.counts.totalRows).toBe(6);
    expect(r.counts.validCount).toBe(2);
    expect(r.counts.mergedCount).toBe(1);
    expect(r.counts.occurrenceTotal).toBe(2 + 3 + 1);
    expect(r.counts.excluded).toEqual({ EMPTY: 1, TOO_LONG: 1, TOO_SHORT: 0, NO_CONTENT: 1 });
  });

  it('브랜드: maskUtterance()가 돌려준 값만 MaskedUtteranceText다 — 금지어 → PII 순서', async () => {
    const out = await maskUtterance('나쁜말 010-1111-2222', deps);
    expect(out.hasBannedWord).toBe(true);
    expect(out.piiMasked).toBe(true);
    expect(out.text).not.toContain('1111');
  });

  it('yieldEvery 훅은 긴 입력에서 호출된다(이벤트 루프 양보)', async () => {
    const yielded = jest.fn().mockResolvedValue(undefined);
    const rows = Array.from({ length: 1200 }, (_, i) => row(`문의 번호 ${i} 입니다`));
    await prepareUtterances(rows, deps, { maxChars: 300, yieldEvery: yielded });
    expect(yielded).toHaveBeenCalledTimes(2);
  });
});

describe('maskFileName — 파일 이름 마스킹(§7.2 끝, K-2)', () => {
  it('경로를 떼고 PII를 가리며 120자로 절단한다', async () => {
    expect(await maskFileName('C:\\Users\\kim\\010-1234-5678 상담.xlsx', deps)).not.toContain('1234');
    expect(await maskFileName('/tmp/a/b/발화.csv', deps)).toBe('발화.csv');
    expect((await maskFileName(`${'가'.repeat(200)}.csv`, deps)).length).toBe(120);
  });

  it('빈 이름은 기본 이름으로 대체한다', async () => {
    expect(await maskFileName('', deps)).toBe('upload');
  });
});

describe('containsMaskToken', () => {
  it('마스킹 표식만 참으로 판정한다', () => {
    expect(containsMaskToken('연락처는 [전화번호] 입니다')).toBe(true);
    expect(containsMaskToken('010-****-1234 로 주세요')).toBe(true);
    expect(containsMaskToken('a***@example.com')).toBe(true);
    expect(containsMaskToken('*** 금지')).toBe(true);
    expect(containsMaskToken('평범한 문장 * 하나')).toBe(false);
  });
});
