import { buildSessionCountSql } from './integrated-session.query';

/** No.29 §5.3, R-7 — 순수 빌더 단위 테스트(파라미터 바인딩·식별자 화이트리스트, 문자열 보간 0건). */
describe('buildSessionCountSql', () => {
  it('binds scope/period as parameters, not string interpolation (ALL scope, NONE grouping)', () => {
    const sql = buildSessionCountSql({ scope: { scope: 'ALL' }, groupBy: 'NONE' });
    expect(sql.sql).not.toContain('WHERE');
    expect(sql.sql).toContain('COUNT(DISTINCT');
    expect(sql.values).toEqual([]);
  });

  it('adds a groupId condition + parameter for GROUP scope', () => {
    const sql = buildSessionCountSql({ scope: { scope: 'GROUP', groupId: 'g-1' }, groupBy: 'NONE' });
    expect(sql.sql).toContain('WHERE');
    expect(sql.sql).toContain('"groupId" =');
    expect(sql.values).toContain('g-1');
  });

  it('adds a period condition + two parameters when period is given', () => {
    const sql = buildSessionCountSql({
      scope: { scope: 'ALL' },
      groupBy: 'NONE',
      period: { fromDayBucket: '2026-09-01', toDayBucket: '2026-09-30' },
    });
    expect(sql.values).toEqual(['2026-09-01', '2026-09-30']);
  });

  it('binds every bucket range as CASE WHEN parameters for groupBy=BUCKET', () => {
    const sql = buildSessionCountSql({
      scope: { scope: 'ALL' },
      groupBy: 'BUCKET',
      bucketRanges: [
        { key: '2026-09-01', fromDay: '2026-09-01', toDay: '2026-09-01' },
        { key: '2026-09-02', fromDay: '2026-09-02', toDay: '2026-09-02' },
      ],
    });
    expect(sql.sql).toContain('CASE');
    expect(sql.sql).toContain('GROUP BY');
    expect(sql.values).toEqual(
      expect.arrayContaining(['2026-09-01', '2026-09-01', '2026-09-01', '2026-09-02', '2026-09-02', '2026-09-02']),
    );
  });

  it('throws when groupBy=BUCKET has no bucketRanges (defensive — required by contract)', () => {
    expect(() => buildSessionCountSql({ scope: { scope: 'ALL' }, groupBy: 'BUCKET' })).toThrow();
  });

  it('uses the (chatbotId, sessionId) composite session key so different chatbots never collide (ADR-0001 갱신)', () => {
    const sql = buildSessionCountSql({ scope: { scope: 'ALL' }, groupBy: 'NONE' });
    expect(sql.sql).toContain(`"chatbotId" || '|' || "sessionId"`);
  });

  it('counts null-sessionId rows as one each via the ns column', () => {
    const sql = buildSessionCountSql({ scope: { scope: 'ALL' }, groupBy: 'NONE' });
    expect(sql.sql).toContain('WHEN "sessionId" IS NULL THEN 1 ELSE 0');
  });

  it('selects the raw column identifier (not a bound parameter) for CHANNEL/CHATBOT/GROUP groupBy', () => {
    for (const [groupBy, column] of [
      ['CHANNEL', '"channelType"'],
      ['CHATBOT', '"chatbotId"'],
      ['GROUP', '"groupId"'],
    ] as const) {
      const sql = buildSessionCountSql({ scope: { scope: 'ALL' }, groupBy });
      expect(sql.sql).toContain(`SELECT ${column} AS "k"`);
    }
  });
});
