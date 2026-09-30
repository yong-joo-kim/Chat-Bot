import { buildInboundEvents, buildOutboundEvents } from './verdict-events';
import type { GuardrailEventContext, InboundVerdict, OutboundVerdict, RuleHit } from './types';

const ctx: GuardrailEventContext = { chatbotId: 'bot-1', messageId: 'msg-1', now: new Date('2026-09-30T15:30:00.000Z') };

function hit(ruleId: string, action: RuleHit['action']): RuleHit {
  return { ruleId, ruleName: `이름-${ruleId}`, category: 'OTHER', action, sortOrder: 1, matched: ['민감한 표현 원문'] };
}

describe('buildInboundEvents', () => {
  it('PASS는 이벤트 0', () => {
    expect(buildInboundEvents(ctx, { action: 'PASS', hits: [] }, true)).toEqual([]);
  });

  it('적중 규칙마다 1행 · 결정 규칙만 decisive · dayBucket은 KST(UTC 15:30 → 다음 날)', () => {
    const verdict: InboundVerdict = { action: 'REPLACE', replacementText: '대체', decisiveRuleId: 'b', hits: [hit('a', 'MONITOR'), hit('b', 'REPLACE')] };
    const rows = buildInboundEvents(ctx, verdict, true);
    expect(rows.map((r) => [r.ruleId, r.decisive, r.effect, r.appliedAction])).toEqual([
      ['a', false, 'NONE', 'REPLACE'],
      ['b', true, 'CHANGED', 'REPLACE'],
    ]);
    expect(rows[0].dayBucket).toBe('2026-10-01');
    expect(rows.every((r) => r.stage === 'INBOUND' && r.kind === 'RULE')).toBe(true);
  });

  it('NO_RAG의 효과는 RAG를 탈 수 있던 턴이면 CHANGED, 아니면 NONE', () => {
    const verdict: InboundVerdict = { action: 'NO_RAG', decisiveRuleId: 'a', hits: [hit('a', 'NO_RAG')] };
    expect(buildInboundEvents(ctx, verdict, true)[0].effect).toBe('CHANGED');
    expect(buildInboundEvents(ctx, verdict, false)[0].effect).toBe('NONE');
  });

  it('MONITOR는 효과 NONE', () => {
    const rows = buildInboundEvents(ctx, { action: 'MONITOR', decisiveRuleId: 'a', hits: [hit('a', 'MONITOR')] }, true);
    expect(rows[0]).toMatchObject({ appliedAction: 'MONITOR', decisive: true, effect: 'NONE' });
  });

  it('행에 문장·표현·대체 문구가 담기지 않는다(문장 0)', () => {
    const verdict: InboundVerdict = { action: 'REPLACE', replacementText: '대체 문구 본문', decisiveRuleId: 'a', hits: [hit('a', 'REPLACE')] };
    const dumped = JSON.stringify(buildInboundEvents(ctx, verdict, true));
    expect(dumped).not.toContain('민감한 표현 원문');
    expect(dumped).not.toContain('대체 문구 본문');
  });
});

describe('buildOutboundEvents', () => {
  const base: Omit<OutboundVerdict, 'kind'> = { text: '', hits: [], piiCounts: {} };

  it('PASS이고 오류·적중이 없으면 이벤트 0', () => {
    expect(buildOutboundEvents(ctx, { ...base, kind: 'PASS' })).toEqual([]);
  });

  it('MASKED — 종류마다 PII 1행, 첫 행만 decisive(턴 수 집계용)', () => {
    const rows = buildOutboundEvents(ctx, { ...base, kind: 'MASKED', piiCounts: { RRN: 2, CARD: 1 } });
    expect(rows.map((r) => [r.kind, r.piiKind, r.piiCount, r.appliedAction, r.decisive])).toEqual([
      ['PII', 'RRN', 2, 'MASK', true],
      ['PII', 'CARD', 1, 'MASK', false],
    ]);
  });

  it('REPLACE — 결정 규칙 CHANGED', () => {
    const rows = buildOutboundEvents(ctx, { ...base, kind: 'REPLACE', replacementText: '대체', decisiveRuleId: 'a', hits: [hit('a', 'REPLACE')] });
    expect(rows[0]).toMatchObject({ stage: 'OUTBOUND', kind: 'RULE', appliedAction: 'REPLACE', decisive: true, effect: 'CHANGED' });
  });

  it('FALLBACK(PII_ONLY) — 개인정보 행이 FALLBACK', () => {
    const rows = buildOutboundEvents(ctx, { ...base, kind: 'FALLBACK', fallbackReason: 'PII_ONLY', piiCounts: { RRN: 1 } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'PII', appliedAction: 'FALLBACK', effect: 'CHANGED' });
  });

  it('FALLBACK(ERROR) — ERROR 행 + 오류 이름만(문장 0)', () => {
    const rows = buildOutboundEvents(ctx, { ...base, kind: 'FALLBACK', fallbackReason: 'ERROR', errorCode: 'TypeError' });
    expect(rows).toEqual([expect.objectContaining({ kind: 'ERROR', appliedAction: 'FALLBACK', effect: 'CHANGED', errorCode: 'TypeError' })]);
  });

  it('오류지만 원답 통과(PASS + errorCode) — ERROR 행 MONITOR/NONE', () => {
    const rows = buildOutboundEvents(ctx, { ...base, kind: 'PASS', errorCode: 'RangeError' });
    expect(rows).toEqual([expect.objectContaining({ kind: 'ERROR', appliedAction: 'MONITOR', effect: 'NONE', errorCode: 'RangeError' })]);
  });
});

describe('일 버킷 KST 자정 경계(UTC 15:00:00 = KST 다음 날 00:00 — 자정 전후 시간 의존 점검)', () => {
  const verdict: InboundVerdict = { action: 'MONITOR', decisiveRuleId: 'a', hits: [hit('a', 'MONITOR')] };
  const bucketAt = (iso: string) => buildInboundEvents({ ...ctx, now: new Date(iso) }, verdict, true)[0].dayBucket;

  it('KST 23:59:59.999(UTC 14:59:59.999)는 당일, KST 00:00:00.000(UTC 15:00:00.000)은 다음 날', () => {
    expect(bucketAt('2026-09-30T14:59:59.999Z')).toBe('2026-09-30');
    expect(bucketAt('2026-09-30T15:00:00.000Z')).toBe('2026-10-01');
  });

  it('월말·연말 경계도 KST 날짜로 넘어간다', () => {
    expect(bucketAt('2026-12-31T15:00:00.000Z')).toBe('2027-01-01');
    expect(bucketAt('2026-12-31T14:59:59.999Z')).toBe('2026-12-31');
  });
});
