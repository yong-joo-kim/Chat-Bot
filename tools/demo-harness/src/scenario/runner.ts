// 시나리오 실행기(설계 §9~§11 · ui-spec §3·§4) — 단계 정의를 순서대로 실행한다: 무대 상태(구간 칩·레이아웃·계정·창 주소) 맞춤 -> 자막 -> run -> verify -> 캡처 -> 화면 유지(dwell).
// 시간 관리: 보이는 시연은 예산이 상한이자 목표(남으면 유지, 늦으면 생략 가능 단계를 구간 생략 순서대로 건너뜀), 무인 점검은 전 단계 실행.
import { errors as pwErrors } from 'playwright-core';
import { join } from 'node:path';
import { accountDef } from '../data/dataset';
import type { DatasetIds } from '../data/types';
import { BrowserSession, StageController } from '../browser/session';
import { raceWithTimeout, WaitAbortedError, WaitTimeoutError, waitFor } from '../util/wait-for';
import { dwell, makePacing, MIN_SHOW_MS } from './pacing';
import { delayLabel, dwellMs, selectSkips } from './schedule';
import type { AccountKey, ApiSessions, FailureKind, RunState, SegmentDef, StepContext, StepDef } from './types';
import { SEGMENT_KEYS } from './types';

export type StepStatus = 'PASS' | 'FAIL' | 'SKIPPED' | 'FALLBACK';
export type SkipReason = 'TIME' | 'PRESENTER' | 'OPTION' | 'DEPENDENCY' | 'NO_BROWSER';

export interface StepResult {
  id: string;
  segment: string;
  title: string;
  core: boolean;
  status: StepStatus;
  budgetSec: number;
  actualSec: number;
  skipReason?: SkipReason;
  delay?: string | null;
  captures: string[];
  failure?: { kind: FailureKind; message: string; expected?: string; actual?: string };
  /** 정직성 표기(대체·사전 준비 등) */
  honesty?: string[];
}

export interface SegmentResult {
  key: string;
  title: string;
  budgetSec: number;
  actualSec: number;
  steps: StepResult[];
}

export interface ScenarioResult {
  segments: SegmentResult[];
  steps: StepResult[];
  showSec: number;
}

export interface RunnerInput {
  segments: SegmentDef[];
  mode: 'visible' | 'headless-check';
  /** 사용자가 지정한 생략(--skip) 단계 ID. */
  skipIds: string[];
  failFast: boolean;
  session: BrowserSession;
  ids: DatasetIds;
  api: ApiSessions;
  runId: string;
  ports: { api: number; console: number; widget: number; stage: number };
  shotsDir: string;
  signal: AbortSignal;
  state: RunState;
  /** 총 예산(초) — 선택한 구간 예산 합. */
  totalBudgetSec: number;
  /** 단계별 진행 알림(터미널). */
  onStep?: (r: StepResult, segTitle: string) => void;
  log: (msg: string) => void;
}

function classify(e: unknown): { kind: FailureKind; message: string } {
  if (e instanceof WaitTimeoutError) return { kind: 'TIMEOUT', message: e.message };
  if (e instanceof pwErrors.TimeoutError) return { kind: 'SELECTOR', message: String(e.message).split('\n')[0] };
  if (e instanceof Error) return { kind: 'ACTION', message: e.message.split('\n')[0] };
  return { kind: 'ACTION', message: String(e) };
}

export async function runScenario(input: RunnerInput): Promise<ScenarioResult> {
  const { session, mode } = input;
  const stage = new StageController(session.page);
  const visible = mode === 'visible';
  const results: StepResult[] = [];
  const segResults: SegmentResult[] = [];
  const scratch = new Map<string, unknown>();
  let currentAccount: AccountKey | null = null;
  let currentLayout: string | null = null;
  const consoleBase = `http://localhost:${input.ports.console}`;

  const urls: StepContext['urls'] = {
    stage: `http://localhost:${input.ports.stage}`,
    apiBase: `http://127.0.0.1:${input.ports.api}/api/v1`,
    publicApi: `http://127.0.0.1:${input.ports.api}/api/v1`,
    console: (p) => `${consoleBase}${p}`,
    site: (slug) => `http://localhost:${input.ports.stage}/site?bot=${slug}`,
  };

  const ctx: StepContext = {
    runId: input.runId,
    mode,
    state: input.state,
    signal: input.signal,
    ids: input.ids,
    api: input.api,
    page: session.page,
    stage,
    console: session.consoleFrame,
    site: session.siteFrame,
    pace: makePacing(mode),
    urls,
    account: () => currentAccount ?? 'admin1',
    scratch,
    waitFor: (check, o) => waitFor(check, { ...o, signal: input.signal }),
    log: (m) => input.log(m),
    openConsole: async (path) => {
      const ok = await stage.navigate('console', urls.console(path));
      if (!ok) throw new Error(`관리 콘솔 화면 로딩이 20초 안에 끝나지 않았습니다: ${path}`);
    },
    openSite: async (slug) => {
      const ok = await stage.navigate('site', urls.site(slug));
      if (!ok) throw new Error(`고객사 모형 로딩이 20초 안에 끝나지 않았습니다: ${slug}`);
    },
  };

  const switchAccount = async (key: AccountKey): Promise<void> => {
    if (currentAccount === key) return;
    const value = input.api[key].sessionValue;
    if (!value) throw new Error(`${key} 세션이 없습니다(로그인 필요)`);
    await session.setSessionCookie(value);
    await stage.setPaneLabel('console', `관리자 화면 · ${accountDef(key).badge}`);
    currentAccount = key;
    // 계정이 바뀌면 콘솔 화면을 다시 불러와 사용자 메뉴의 이름이 바뀐 것을 보인다
    await stage.navigate('console', `${consoleBase}/`);
  };

  // 시간 계산 상태
  const t0 = Date.now();
  let executedBudget = 0;
  let skippedBudget = 0;
  const skipped = new Set<string>(input.skipIds);
  const totalBudget = input.totalBudgetSec;
  const cumulative: number[] = [];
  {
    let acc = 0;
    for (const seg of input.segments) {
      acc += seg.budgetSec;
      cumulative.push(acc);
    }
  }

  const progress = async (): Promise<void> => {
    if (!visible) return;
    const elapsed = (Date.now() - t0) / 1000;
    const fr = SEGMENT_KEYS.map(() => 0);
    let acc = 0;
    for (const seg of input.segments) {
      const idx = SEGMENT_KEYS.indexOf(seg.key);
      const start = acc;
      acc += seg.budgetSec;
      fr[idx] = Math.min(1, Math.max(0, (elapsed - start) / seg.budgetSec));
    }
    await stage.setProgress(fr).catch(() => undefined);
    await stage.setTimer({ elapsedMs: Date.now() - t0, paused: false, totalSec: totalBudget }).catch(() => undefined);
  };

  for (const seg of input.segments) {
    const segStart = Date.now();
    const segSteps: StepResult[] = [];
    let segFailed = false;
    await stage.setSegment(seg.chip, seg.title).catch(() => undefined);
    for (const step of seg.steps) {
      input.signal.throwIfAborted?.();
      if (input.signal.aborted) throw new WaitAbortedError('시나리오');
      session.currentStepId = step.id;

      const base: StepResult = { id: step.id, segment: seg.key, title: step.title, core: step.core, status: 'PASS', budgetSec: step.budgetSec, actualSec: 0, captures: [] };
      let skipReason: SkipReason | undefined;
      if (skipped.has(step.id)) skipReason = 'OPTION';
      else if (segFailed && !visible) skipReason = 'DEPENDENCY';
      else if (visible && step.skippable) {
        // 지연 보정: 이 구간의 생략 순서대로, 아직 안 한 생략 가능 단계를 만회량이 lag 이상이 될 때까지 건너뜀(핵심은 절대 생략하지 않음)
        const lag = (Date.now() - t0) / 1000 - executedBudget;
        const remaining = seg.skipOrder.filter((id) => !skipped.has(id) && seg.steps.some((s) => s.id === id && !results.some((r) => r.id === id) && !segSteps.some((r) => r.id === id)));
        const cands = remaining.map((id) => ({ id, budgetSec: seg.steps.find((s) => s.id === id)!.budgetSec }));
        const picks = selectSkips(lag, skippedBudget, cands);
        if (picks.includes(step.id)) {
          skipReason = 'TIME';
          skippedBudget += step.budgetSec;
        }
      }
      if (skipReason) {
        const r: StepResult = { ...base, status: 'SKIPPED', skipReason };
        segSteps.push(r);
        results.push(r);
        input.onStep?.(r, seg.title);
        continue;
      }

      const stepStart = Date.now();
      let failure: StepResult['failure'] | undefined;
      let usedFallback = false;
      try {
        // 무대 상태 맞춤
        if (step.layout !== currentLayout) {
          await stage.setLayout(step.layout);
          currentLayout = step.layout;
        }
        if (step.account) await switchAccount(step.account);
        else if (currentAccount === null && (step.layout !== 'card')) await switchAccount('admin1');
        if (step.site) {
          const slug = step.site === 'A' ? input.ids.A.slug : input.ids.B.slug;
          await ctx.openSite(slug);
          await stage.setPaneLabel('site', step.site === 'B' ? '고객 화면 · 운영 통제 데모 챗봇' : '고객 화면 · 가온마켓 홈페이지(시연용 가상)');
        }
        if (step.console) await ctx.openConsole(step.console(input.ids));
        if (visible) {
          await stage.showCaption({ lines: step.narration, notice: step.disclosure, badges: [] });
          await progress();
        }

        const timeoutMs = Math.max(60_000, step.budgetSec * 4000);
        await raceWithTimeout(
          (async () => {
            if (mode === 'headless-check' && typeof step.headless === 'function') await step.headless(ctx);
            else await step.run(ctx);
            if (step.verify) {
              const v = await step.verify(ctx);
              if (!v.ok) throw Object.assign(new Error(`결과 불일치: 기대 ${v.expected ?? '?'} / 실제 ${v.actual ?? '?'}`), { verify: v });
            }
          })(),
          timeoutMs,
          `단계 ${step.id} 전체`,
          input.signal,
        );
      } catch (e) {
        if (e instanceof WaitAbortedError || input.signal.aborted) throw e;
        const v = (e as { verify?: { expected?: string; actual?: string } }).verify;
        const c = v ? { kind: 'VERIFY' as FailureKind, message: (e as Error).message } : classify(e);
        failure = { kind: c.kind, message: c.message, expected: v?.expected, actual: v?.actual };
        try {
          await session.page.screenshot({ path: join(input.shotsDir, `${step.id}-FAIL.png`) });
          base.captures.push(`shots/${step.id}-FAIL.png`);
        } catch {
          /* 캡처 실패는 무시 */
        }
        // 대체 장면
        if (step.fallback) {
          try {
            if (step.fallback.render) await step.fallback.render(ctx);
            if (visible) {
              await stage.setStateChip('fallback');
              await stage.showCaption({ lines: [step.fallback.caption], notice: '준비된 결과로 대신 보여 드립니다', badges: [] });
            }
            usedFallback = true;
          } catch {
            usedFallback = false;
          }
        }
      }

      // 캡처(핵심 + 지정 단계)
      if (!failure || usedFallback) {
        if (step.capture !== 'none' && (visible || step.core || step.capture === 'screenshot')) {
          try {
            await session.page.screenshot({ path: join(input.shotsDir, `${step.id}.png`) });
            base.captures.push(`shots/${step.id}.png`);
          } catch {
            /* 무시 */
          }
        }
      }

      const actualMs = Date.now() - stepStart;
      if (visible) {
        const d = dwellMs(step.budgetSec, actualMs);
        await dwell(failure && !usedFallback ? 0 : Math.max(d, Math.min(MIN_SHOW_MS, d > 0 ? d : 0)), input.signal);
        if (usedFallback) await stage.setStateChip('none').catch(() => undefined);
      }
      executedBudget += step.budgetSec;
      const actualSec = (Date.now() - stepStart) / 1000;
      const r: StepResult = {
        ...base,
        actualSec,
        status: failure ? (usedFallback ? 'FALLBACK' : 'FAIL') : 'PASS',
        failure,
        delay: !failure && visible ? delayLabel(step.budgetSec, actualSec) : null,
        honesty: usedFallback ? [`${step.id}: ${step.fallback?.caption ?? '대체 화면'}`] : step.disclosure ? [`${step.id}: ${step.disclosure}`] : undefined,
      };
      if (failure && !usedFallback) segFailed = true;
      segSteps.push(r);
      results.push(r);
      input.onStep?.(r, seg.title);
      if (failure && !usedFallback && input.failFast) {
        segResults.push({ key: seg.key, title: seg.title, budgetSec: seg.budgetSec, actualSec: (Date.now() - segStart) / 1000, steps: segSteps });
        return { segments: segResults, steps: results, showSec: (Date.now() - t0) / 1000 };
      }
    }
    segResults.push({ key: seg.key, title: seg.title, budgetSec: seg.budgetSec, actualSec: (Date.now() - segStart) / 1000, steps: segSteps });
  }
  session.currentStepId = null;
  return { segments: segResults, steps: results, showSec: (Date.now() - t0) / 1000 };
}

export type { StepDef };
