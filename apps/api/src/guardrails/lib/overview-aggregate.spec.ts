import { aggregateOverview } from './overview-aggregate';
import type { EventGroupRow } from './overview-aggregate';

function group(overrides: Partial<EventGroupRow>): EventGroupRow {
  return { stage: 'INBOUND', kind: 'RULE', appliedAction: 'MONITOR', effect: 'NONE', decisive: true, count: 1, ...overrides };
}

describe('aggregateOverview — 합계 = 이벤트 합(AC-AG5-2)', () => {
  const eventGroups: EventGroupRow[] = [
    group({ stage: 'INBOUND', appliedAction: 'REPLACE', effect: 'CHANGED', count: 3 }),
    group({ stage: 'INBOUND', appliedAction: 'REPLACE', effect: 'NONE', decisive: false, count: 2 }), // 비결정 행은 턴 수에 안 들어간다
    group({ stage: 'INBOUND', appliedAction: 'NO_RAG', effect: 'CHANGED', count: 4 }),
    group({ stage: 'INBOUND', appliedAction: 'MONITOR', count: 5 }),
    group({ stage: 'OUTBOUND', appliedAction: 'REPLACE', effect: 'CHANGED', count: 2 }),
    group({ stage: 'OUTBOUND', appliedAction: 'MONITOR', count: 1 }),
    group({ stage: 'OUTBOUND', kind: 'PII', appliedAction: 'MASK', effect: 'CHANGED', count: 6 }),
    group({ stage: 'OUTBOUND', kind: 'PII', appliedAction: 'MASK', effect: 'CHANGED', decisive: false, count: 2 }),
    group({ stage: 'OUTBOUND', kind: 'ERROR', appliedAction: 'FALLBACK', effect: 'CHANGED', decisive: false, count: 1 }),
  ];

  const out = aggregateOverview({
    eventGroups,
    ruleGroups: [
      { ruleId: 'r1', ruleName: '옛 이름', category: 'CRISIS_SELF_HARM', stage: 'INBOUND', effect: 'CHANGED', count: 3 },
      { ruleId: 'r1', ruleName: '옛 이름', category: 'CRISIS_SELF_HARM', stage: 'INBOUND', effect: 'NONE', count: 2 },
      { ruleId: 'gone', ruleName: '삭제된 규칙', category: 'OTHER', stage: 'OUTBOUND', effect: 'NONE', count: 1 },
    ],
    piiGroups: [
      { piiKind: 'CARD', answers: 3, count: 3 },
      { piiKind: 'RRN', answers: 8, count: 9 },
    ],
    currentRules: [{ id: 'r1', name: '위기 안내', category: 'CRISIS_SELF_HARM', action: 'REPLACE', enabled: true }],
    answeredByRagCount: 40,
    outboundStagedCount: 5,
  });

  it('입구·출구 적중은 결정 규칙 행만 센다', () => {
    expect(out.totals.inboundHits).toBe(3 + 4 + 5);
    expect(out.totals.outboundHits).toBe(2 + 1);
  });

  it('대체·AI로 안 보냄·기록만 · 가림 답 · 오류 폴백', () => {
    expect(out.totals.replaced).toBe(3 + 2);
    expect(out.totals.noRag).toBe(4);
    expect(out.totals.monitored).toBe(5 + 1);
    expect(out.totals.maskedAnswers).toBe(6);
    expect(out.totals.errorFallbacks).toBe(1);
  });

  it('규칙별 표 — 같은 id를 합치고 현재 이름·동작을 붙이며 삭제된 규칙은 deleted', () => {
    const r1 = out.rules.find((r) => r.ruleId === 'r1')!;
    expect(r1).toMatchObject({ ruleName: '위기 안내', currentAction: 'REPLACE', currentEnabled: true, deleted: false, inboundHits: 5, outboundHits: 0, changedHits: 3 });
    const gone = out.rules.find((r) => r.ruleId === 'gone')!;
    expect(gone).toMatchObject({ ruleName: '삭제된 규칙', currentAction: null, deleted: true, outboundHits: 1 });
  });

  it('개인정보 종류별 표는 고정 순서', () => {
    expect(out.pii).toEqual([
      { kind: 'RRN', answers: 8, count: 9 },
      { kind: 'CARD', answers: 3, count: 3 },
    ]);
  });

  it('RAG 답 — 분모 = 전달 + 대체 + 오류 폴백, 대체 비율', () => {
    // outboundStaged(5) = 대체(2) + 폴백(3)
    expect(out.rag).toEqual({ delivered: 40, replaced: 2, masked: 6, fallbackOnError: 3, replacedRatio: 2 / (40 + 2 + 3) });
  });

  it('분모가 0이면 replacedRatio는 null', () => {
    const empty = aggregateOverview({ eventGroups: [], ruleGroups: [], piiGroups: [], currentRules: [], answeredByRagCount: 0, outboundStagedCount: 0 });
    expect(empty.rag.replacedRatio).toBeNull();
    expect(empty.totals).toEqual({ inboundHits: 0, outboundHits: 0, replaced: 0, noRag: 0, monitored: 0, maskedAnswers: 0, errorFallbacks: 0 });
  });
});
