import { messagesNormalizedKey, parseTestCaseRows } from './parse-test-case-row';
import type { SheetRow } from '../../dialogue-common/import/sheet-reader';

function row(cells: string[], rowNumber = 1): SheetRow {
  return { rowNumber, cells };
}

describe('parseTestCaseRows — FR-V1-12, 헤더 유무 모두 지원', () => {
  it('헤더 행이 있으면 건너뛰고 데이터만 파싱한다', () => {
    const rows = [row(['질문문장', '기대유형', '기대대상명', '비고']), row(['배송 언제 오나요', '의도', '배송문의', ''])];
    const { parsed, errors } = parseTestCaseRows(rows);
    expect(errors).toEqual([]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ messages: ['배송 언제 오나요'], expectedKind: 'INTENT', expectedTargetName: '배송문의' });
  });

  it('헤더 행이 없어도 그대로 동작한다', () => {
    const rows = [row(['환불 방법 알려주세요', 'FAQ', '환불 안내', ''])];
    const { parsed, errors } = parseTestCaseRows(rows);
    expect(errors).toEqual([]);
    expect(parsed[0].expectedKind).toBe('FAQ');
  });

  it('멀티턴은 |로 구분되고 최대 5턴을 초과하면 TOO_LONG 오류다', () => {
    const ok = parseTestCaseRows([row(['첫턴|둘째턴|셋째턴', '폴백', '', ''])]);
    expect(ok.errors).toEqual([]);
    expect(ok.parsed[0].messages).toEqual(['첫턴', '둘째턴', '셋째턴']);

    const tooMany = parseTestCaseRows([row([Array.from({ length: 6 }, (_, i) => `t${i}`).join('|'), '폴백', '', ''])]);
    expect(tooMany.errors[0].code).toBe('TOO_LONG');
  });

  it('기대유형이 의도/FAQ/노드인데 기대대상명이 비어 있으면 EMPTY_VALUE 오류다', () => {
    const { errors } = parseTestCaseRows([row(['질문', '노드', '', ''])]);
    expect(errors[0].code).toBe('EMPTY_VALUE');
  });

  it('알 수 없는 기대유형은 INVALID_CATEGORY 오류다', () => {
    const { errors } = parseTestCaseRows([row(['질문', '알수없음', '', ''])]);
    expect(errors[0].code).toBe('INVALID_CATEGORY');
  });

  it('폴백/미지정은 기대대상명이 없어도 통과한다', () => {
    const { errors, parsed } = parseTestCaseRows([row(['질문1', '미지정', '', '메모']), row(['질문2', '폴백', '', ''])]);
    expect(errors).toEqual([]);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].expectedAnswerNote).toBe('메모');
  });

  it('messagesNormalizedKey는 턴을 정규화 후 결합한 중복 판정 키다(FR-V1-7)', () => {
    expect(messagesNormalizedKey(['안녕하세요', '반갑습니다'])).toBe(messagesNormalizedKey(['안녕하세요 ', ' 반갑습니다']));
  });
});
