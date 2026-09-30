import { planApply } from './apply-plan';
import type { PlanUtterance } from './apply-plan';

function u(id: string, seq: number, text: string, extra: Partial<PlanUtterance> = {}): PlanUtterance {
  return { id, seq, text, textNormalized: text.replace(/\s+/g, '').toLowerCase(), hasBannedWord: false, hasMaskToken: false, applied: false, ...extra };
}

function plan(utterances: PlanUtterance[], opts: Partial<Parameters<typeof planApply>[0]> = {}, requested?: string[]) {
  return planApply({
    requestedIds: requested ?? utterances.map((x) => x.id),
    found: new Map(utterances.map((x) => [x.id, x])),
    targetExamplesNormalized: new Set(),
    targetExampleCount: 0,
    otherIntentExamples: new Map(),
    maxChars: 200,
    maxExamples: 500,
    ...opts,
  });
}

describe('apply-plan — 선택 발화 → 의도 예문 반영 계획(설계서 §15.1)', () => {
  it('제외 사유 7종이 정해진 순서로 판정된다', () => {
    const r = plan(
      [
        u('applied', 1, '이미 반영됨', { applied: true }),
        u('banned', 2, '나쁜말 *** 문장', { hasBannedWord: true }),
        u('long', 3, '가'.repeat(201)),
        u('dupTarget', 4, '대상 의도에 있음'),
        u('dupOther', 5, '다른 의도에 있음'),
        u('ok', 6, '정상 문장입니다'),
      ],
      {
        targetExamplesNormalized: new Set(['대상의도에있음']),
        targetExampleCount: 1,
        otherIntentExamples: new Map([['다른의도에있음', '배송 의도']]),
      },
      ['missing', 'applied', 'banned', 'long', 'dupTarget', 'dupOther', 'ok'],
    );
    const byId = Object.fromEntries(r.excluded.map((e) => [e.utteranceId, e]));
    expect(byId.missing.reason).toBe('NOT_FOUND');
    expect(byId.applied.reason).toBe('ALREADY_APPLIED');
    expect(byId.banned.reason).toBe('BANNED_WORD');
    expect(byId.long.reason).toBe('TOO_LONG');
    expect(byId.dupTarget.reason).toBe('DUPLICATE_IN_TARGET');
    expect(byId.dupOther.reason).toBe('DUPLICATE_IN_OTHER_INTENT');
    expect(byId.dupOther.conflictIntentName).toBe('배송 의도');
    expect(r.included.map((i) => i.utteranceId)).toEqual(['ok']);
    expect(r.resultingExampleCount).toBe(2); // 대상 1 + 포함 1
  });

  it('사유 우선순위 — 금지어이면서 다른 의도에 있어도 BANNED_WORD가 먼저다', () => {
    const r = plan([u('x', 1, '중복 금지어', { hasBannedWord: true })], { otherIntentExamples: new Map([['중복금지어', '다른']]) });
    expect(r.excluded[0].reason).toBe('BANNED_WORD');
  });

  it('마스킹 표식 포함 발화는 포함하되 MASK_TOKEN 경고를 단다', () => {
    const r = plan([u('m', 1, '전화는 [전화번호] 입니다', { hasMaskToken: true }), u('n', 2, '평범한 문장')]);
    expect(r.included.find((i) => i.utteranceId === 'm')?.warnings).toEqual(['MASK_TOKEN']);
    expect(r.included.find((i) => i.utteranceId === 'n')?.warnings).toEqual([]);
  });

  it('상한 초과분은 정렬 순서(seq) 뒤쪽부터 TARGET_LIMIT로 제외된다', () => {
    const r = plan([u('c', 3, '셋째'), u('a', 1, '첫째'), u('b', 2, '둘째')], { targetExampleCount: 498, maxExamples: 500 });
    expect(r.included.map((i) => i.utteranceId)).toEqual(['a', 'b']);
    expect(r.excluded).toEqual([{ utteranceId: 'c', reason: 'TARGET_LIMIT' }]);
    expect(r.resultingExampleCount).toBe(500);
  });

  it('이미 상한이면 전부 TARGET_LIMIT', () => {
    const r = plan([u('a', 1, '첫째')], { targetExampleCount: 500 });
    expect(r.included).toHaveLength(0);
    expect(r.excluded[0].reason).toBe('TARGET_LIMIT');
  });

  it('요청 id 중복은 한 번만 다룬다', () => {
    const r = plan([u('a', 1, '첫째')], {}, ['a', 'a', 'a']);
    expect(r.included).toHaveLength(1);
    expect(r.excluded).toHaveLength(0);
  });

  it('반영 순서는 seq 오름차순이다(요청 순서와 무관)', () => {
    const r = plan([u('b', 2, '둘째'), u('a', 1, '첫째')], {}, ['b', 'a']);
    expect(r.included.map((i) => i.utteranceId)).toEqual(['a', 'b']);
  });

  it('길이 200자는 허용, 201자는 제외한다(경계)', () => {
    const r = plan([u('ok', 1, '가'.repeat(200)), u('no', 2, '나'.repeat(201))]);
    expect(r.included.map((i) => i.utteranceId)).toEqual(['ok']);
    expect(r.excluded[0].reason).toBe('TOO_LONG');
  });
});
