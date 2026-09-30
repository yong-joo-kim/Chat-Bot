import { measureGuardrailLatency, syntheticInbound, syntheticOutbound, syntheticRules } from '../eval/measure-guardrail-latency';

/**
 * 성능 예산 CI 상한(설계서 §16 · AC-AG3-6) — 목표는 입구 P95 ≤ 1ms · 출구 P95 ≤ 5ms(개발 PC 측정 — `eval/measure-guardrail-latency.ts`)이고,
 * 이 시험은 CI 장비 편차를 감안한 **느슨한 상한**(입구 5ms · 출구 25ms)만 지킨다. 규칙 50 · 표현 2,000 · 입력 500자 · 답 2,000자, 캐시 적중 기준.
 */
describe('가드레일 판정 지연 — CI 느슨한 상한', () => {
  it('합성 입력의 규모가 설계 기준과 같다', () => {
    const rules = syntheticRules();
    expect(rules).toHaveLength(50);
    expect(rules.reduce((n, r) => n + r.expressions.length, 0)).toBe(2000);
    expect(syntheticInbound()).toHaveLength(500);
    expect(syntheticOutbound()).toHaveLength(2000);
  });

  it('입구 P95 ≤ 5ms · 출구 P95 ≤ 25ms(1,000회)', () => {
    const { inbound, outbound } = measureGuardrailLatency(1000);
    expect(inbound.p95Ms).toBeLessThanOrEqual(5);
    expect(outbound.p95Ms).toBeLessThanOrEqual(25);
  });
});
