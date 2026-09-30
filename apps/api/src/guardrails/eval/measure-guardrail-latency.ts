import { compileProfile } from '../lib/compile-profile';
import { evaluateRules } from '../lib/evaluate-rules';
import { judgeOutbound } from '../lib/judge-outbound';
import type { GuardrailRuleRow } from '../lib/types';

/**
 * 가드레일 판정 지연 측정 도구(설계서 §16 · §18.3 · AC-AG3-6) — CI 밖 수동 실행용(개발 PC 측정값으로 합격 판정 — P-4: 규칙 기반이라
 * GPU·모델 무관). 실행: `pnpm --filter @chat-bot/api exec ts-node -r tsconfig-paths/register src/guardrails/eval/measure-guardrail-latency.ts`.
 * 합성 입력: 규칙 50 · 표현 2,000(규칙당 40) · 입구 500자 · 출구 답 2,000자(주민번호·카드 포함) · 캐시 적중(컴파일은 1회) × 반복.
 * 순수 판정 함수만 잰다 — DB·네트워크 0이므로 이 값이 캐시 적중 턴의 추가 지연이다.
 */
export interface LatencyStats {
  runs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function summarize(samplesMs: number[]): LatencyStats {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  return { runs: sorted.length, p50Ms: percentile(sorted, 50), p95Ms: percentile(sorted, 95), p99Ms: percentile(sorted, 99), maxMs: sorted[sorted.length - 1] ?? 0 };
}

export function syntheticRules(ruleCount = 50, expressionsPerRule = 40): GuardrailRuleRow[] {
  return Array.from({ length: ruleCount }, (_, r) => ({
    id: `rule-${r}`,
    name: `합성 규칙 ${r}`,
    category: 'OTHER' as const,
    expressions: Array.from({ length: expressionsPerRule }, (_, e) => `합성표현-${r}-${e}-zzq`),
    matchType: 'CONTAINS' as const,
    appliesTo: 'BOTH' as const,
    action: 'MONITOR' as const,
    replacementText: null,
    sortOrder: r + 1,
    createdAt: new Date(2026, 0, 1, 0, r),
  }));
}

/** 500자 안팎의 자연스러운 입력(규칙에 걸리지 않는 최악 경로 — 모든 표현을 끝까지 훑는다). */
export function syntheticInbound(): string {
  return '배송이 언제 오는지 궁금합니다. 주문번호를 확인하고 싶은데 어디서 볼 수 있나요? '.repeat(20).slice(0, 500);
}

export function syntheticOutbound(): string {
  const base = '안내드립니다. 제품 사용 방법과 환불 절차는 문서를 참고해 주세요. ';
  return `${base.repeat(60).slice(0, 1900)} 주민 901231-1234567 카드 1234-5678-9012-3456`.slice(0, 2000).padEnd(2000, ' ');
}

export function measureGuardrailLatency(runs = 10_000): { inbound: LatencyStats; outbound: LatencyStats; ruleCount: number; expressionCount: number } {
  const rules = syntheticRules();
  const profile = compileProfile(rules);
  const inboundText = syntheticInbound();
  const outboundText = syntheticOutbound();
  const setting = { kinds: ['RRN', 'CARD'] as const, preserveDates: true };

  // 예열(JIT).
  for (let i = 0; i < 200; i += 1) {
    evaluateRules(inboundText, profile.inbound);
    judgeOutbound(outboundText, profile, setting, false);
  }

  const inbound: number[] = [];
  const outbound: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const a = process.hrtime.bigint();
    evaluateRules(inboundText, profile.inbound);
    inbound.push(Number(process.hrtime.bigint() - a) / 1e6);
    const b = process.hrtime.bigint();
    judgeOutbound(outboundText, profile, setting, false);
    outbound.push(Number(process.hrtime.bigint() - b) / 1e6);
  }
  return { inbound: summarize(inbound), outbound: summarize(outbound), ruleCount: rules.length, expressionCount: rules.reduce((n, r) => n + r.expressions.length, 0) };
}

if (require.main === module) {
  const result = measureGuardrailLatency();
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ node: process.version, platform: process.platform, at: new Date().toISOString(), ...result }, null, 2));
}
