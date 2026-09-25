import type { EnvironmentGateSettings, GateEvaluation } from '@chat-bot/shared-types';

export interface GateLatestRun {
  runId: string;
  setId: string;
  setName: string;
  summaryA: { pass: number; fail: number; notJudged: number; unresolved: number };
  finishedAt: Date;
  embeddingModelId: string | null;
}

/** [신규 No.40] §10 — `readiness-warnings.service.ts`와 같은 식(순수 함수 공유). */
export function computePassRate(summary: { pass: number; fail: number; notJudged: number; unresolved: number }): number {
  const denom = summary.pass + summary.fail + summary.notJudged + summary.unresolved;
  if (denom === 0) return 0;
  return summary.pass / denom;
}

/**
 * §10 — 미리보기·즉시 전환·예약 실행이 공유하는 게이트 판정 순수 함수. `kind = ROLLBACK`이면
 * `BLOCK`을 `WARN`으로 낮춘다(긴급 복귀 우선).
 */
export function evaluateProdSwitchGate(input: {
  settings: EnvironmentGateSettings;
  latestRun: GateLatestRun | null;
  setExists: boolean;
  currentEmbeddingModelId: string | null;
  now: Date;
  kind: 'SWITCH' | 'ROLLBACK';
}): GateEvaluation {
  const { settings, latestRun, setExists, currentEmbeddingModelId, now, kind } = input;

  const downgrade = (verdict: 'WARN' | 'BLOCK'): 'WARN' | 'BLOCK' => (kind === 'ROLLBACK' ? 'WARN' : verdict);

  if (!settings.testSetId) {
    if (settings.mode === 'BLOCK') {
      // 설정 단계에서 막히는 것이 정상이나 방어적으로 처리한다.
      return { verdict: downgrade('BLOCK'), reason: 'NOT_CONFIGURED', run: null };
    }
    if (!latestRun) return { verdict: 'WARN', reason: 'NO_RUN', run: null };
    return { verdict: 'PASS', reason: 'PASSED', run: toRunView(latestRun) };
  }

  if (settings.testSetId && !setExists) {
    return { verdict: downgrade(settings.mode === 'BLOCK' ? 'BLOCK' : 'WARN'), reason: 'SET_MISSING', run: null };
  }

  if (!latestRun) return { verdict: downgrade(settings.mode), reason: 'NO_RUN', run: null };

  const expiredAt = latestRun.finishedAt.getTime() + settings.validHours * 3600_000;
  if (expiredAt < now.getTime()) return { verdict: downgrade(settings.mode), reason: 'EXPIRED', run: toRunView(latestRun) };

  if (latestRun.embeddingModelId !== null && latestRun.embeddingModelId !== currentEmbeddingModelId) {
    return { verdict: downgrade(settings.mode), reason: 'MODEL_CHANGED', run: toRunView(latestRun) };
  }

  const passRate = computePassRate(latestRun.summaryA);
  if (passRate * 100 < settings.minPassRate) {
    return { verdict: downgrade(settings.mode), reason: 'BELOW_THRESHOLD', run: toRunView(latestRun) };
  }

  return { verdict: 'PASS', reason: 'PASSED', run: toRunView(latestRun) };
}

function toRunView(run: GateLatestRun): NonNullable<GateEvaluation['run']> {
  return { runId: run.runId, setId: run.setId, setName: run.setName, passRate: computePassRate(run.summaryA), finishedAt: run.finishedAt };
}
