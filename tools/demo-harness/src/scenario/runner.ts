// 시나리오 실행기(설계 §9~§11 · ui-spec §3·§4) — 단계 정의를 순서대로 실행한다: 무대 상태(구간 칩·레이아웃·계정·창 주소) 맞춤 -> 자막 -> run -> verify -> 배지 -> 캡처 -> 화면 유지(dwell).
// 시간 관리: 보이는 시연은 예산이 상한이자 목표(남으면 유지, 늦으면 생략 가능 단계를 구간 생략 순서대로 건너뜀), 무인 점검은 전 단계 실행.
// 3단계: 진행자 제어(일시정지·건너뛰기·다음 구간) · 자막 기록(VTT) · GIF 수집 · 배지 증거 · 정직성 표기.
import { errors as pwErrors } from 'playwright-core';
import { join } from 'node:path';
import { accountDef } from '../data/dataset';
import type { DatasetIds } from '../data/types';
import { BrowserSession, StageController } from '../browser/session';
import { GifClip } from '../capture/gif';
import type { CaptionEvent } from '../capture/vtt';
import type { PresenterControl } from '../control/presenter';
import { raceWithTimeout, sleepMs, WaitAbortedError, WaitTimeoutError, waitFor } from '../util/wait-for';
import { composeChips } from './badges';
import type { FullStepEnv } from './full-env';
import type { PlanContext } from './plan';
import { dwellMs, delayLabel, selectSkips } from './schedule';
import { makePacing, MIN_SHOW_MS } from './pacing';
import type { AccountKey, ApiSessions, FailureKind, RunFacts, RunState, SegmentDef, StepContext, StepDef } from './types';
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
  /** 화면에 나간 자막(보고서·나레이션 로그). */
  narration?: { lines: string[]; notice?: string };
  /** 증거 조건을 충족해 표시한 배지(글자). */
  badges?: string[];
  /** 실패·대체와 별개로 verify가 돌려준 기대/실제(통과여도 기록). */
  verified?: { expected?: string; actual?: string };
}

export interface SegmentResult {
  key: string;
  title: string;
  chip?: string;
  budgetSec: number;
  actualSec: number;
  steps: StepResult[];
}

export interface GifClipResult {
  stepId: string;
  frames: Buffer[];
}

export interface ScenarioResult {
  segments: SegmentResult[];
  steps: StepResult[];
  showSec: number;
  pausedSec: number;
  gifClips: GifClipResult[];
  /** 진행자 터미널에 보인 경고 문구(보고서 "지연 요약"). */
  warnings: string[];
}

export interface RunnerHooks {
  onSegmentStart?(e: { atMs: number; key: string; chip: string; title: string }): void;
  onCaption?(e: CaptionEvent): void;
  onCaptionBadges?(stepId: string, badges: string[], facts?: string[]): void;
  onPause?(atMs: number, paused: boolean): void;
  /** 단계가 시작될 때(터미널 진행 표시 등). */
  onStepStart?(step: StepDef, seg: SegmentDef): void;
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
  facts: RunFacts;
  fixtureCsv: string;
  /** 총 예산(초) — 선택한 구간 예산 합. */
  totalBudgetSec: number;
  /** [DT-2] 계획 문맥(10분판은 모든 플래그가 꺼진 고정 값). */
  plan: PlanContext;
  /** [DT-2] 풀 투어 실행 환경(10분판은 없음). */
  full?: FullStepEnv;
  /** [DT-2] 풀 투어 진행 막대 구간(해석된 활성 구간 전체 — `--only` 여도 전체). 없으면 DT-1 9칸 규칙. */
  barSegments?: Array<{ key: string; budgetSec: number }>;
  /** 보이는 시연에서 진행자 제어(없으면 제어 없음). */
  control?: PresenterControl;
  /** GIF 프레임 수집(보이는 시연 · --no-gif가 아닐 때). */
  collectGif?: boolean;
  hooks?: RunnerHooks;
  /** 시험 전용 지연 주입(AC-DH4-2): `S2-03:20` 같은 단계 ID -> 추가 지연 초. 운영 경로 영향 0. */
  injectDelaySec?: Record<string, number>;
  /** 단계별 진행 알림(터미널). */
  onStep?: (r: StepResult, segTitle: string) => void;
  /** 진행자 경고(터미널 `[주의]` — 같은 경고는 한 번만 낸다). */
  onWarn?: (msg: string) => void;
  log: (msg: string) => void;
}

/** 시간 부족 판정의 허용 오차(초) — 설계 §11.2의 "lag > 0"을 실측 잡음에 흔들리지 않게 한 값. */
export const LAG_TOLERANCE_SEC = 4;

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
  const ctl = visible ? input.control : undefined;
  const results: StepResult[] = [];
  const segResults: SegmentResult[] = [];
  const gifClips: GifClipResult[] = [];
  const warnings: string[] = [];
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
    facts: input.facts,
    paths: { fixtureCsv: input.fixtureCsv },
    plan: input.plan,
    full: input.full,
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

  // ── 시간 계산(일시정지 시간은 예산 계산에서 제외 — 설계 §11.2) ──
  const t0 = Date.now();
  let pausedMs = 0;
  const elapsedMs = (): number => Date.now() - t0 - pausedMs;
  let executedBudget = 0;
  let skippedBudget = 0;
  const skipped = new Set<string>(input.skipIds);
  const totalBudget = input.totalBudgetSec;
  const warnedOnce = new Set<string>();
  const warnOnce = (key: string, msg: string): void => {
    if (warnedOnce.has(key)) return;
    warnedOnce.add(key);
    warnings.push(msg);
    input.onWarn?.(msg);
  };

  let lastCaption: { lines: string[]; notice?: string; badges: string[]; facts?: string[] } | null = null;

  /** 일시정지 중이면 풀릴 때까지 기다린다(무대에 "잠시 멈춤" · 타이머 정지 · 흐른 시간은 예산 계산에서 뺀다). */
  const gate = async (): Promise<void> => {
    if (!ctl?.paused) return;
    const start = Date.now();
    input.hooks?.onPause?.(start, true);
    await stage.pauseCaption(true).catch(() => undefined);
    await stage.setStateChip('paused').catch(() => undefined);
    await stage.setTimer({ elapsedMs: elapsedMs(), paused: true, totalSec: totalBudget }).catch(() => undefined);
    while (ctl.paused && !input.signal.aborted) {
      await sleepMs(200, input.signal);
      if (Date.now() - start > 5 * 60_000) warnOnce('pause5', '일시정지가 5분을 넘었습니다. 계속 멈춰 있습니다');
    }
    pausedMs += Date.now() - start;
    input.hooks?.onPause?.(Date.now(), false);
    await stage.setStateChip('none').catch(() => undefined);
    if (lastCaption) await stage.showCaption(lastCaption).catch(() => undefined);
    else await stage.clearCaption().catch(() => undefined);
    await stage.setTimer({ elapsedMs: elapsedMs(), paused: false, totalSec: totalBudget }).catch(() => undefined);
  };

  const showCaptionNow = async (stepId: string, c: { lines: string[]; notice?: string; badges?: string[]; facts?: string[] }, kind: 'normal' | 'fallback'): Promise<void> => {
    const badges = c.badges ?? [];
    const facts = c.facts ?? [];
    lastCaption = { lines: c.lines, notice: c.notice, badges, ...(facts.length > 0 ? { facts } : {}) };
    await stage.showCaption({ lines: c.lines, notice: c.notice, badges, ...(facts.length > 0 ? { facts } : {}) });
    input.hooks?.onCaption?.({ atMs: Date.now(), stepId, lines: c.lines, notice: c.notice, badges, facts, kind });
  };

  const progress = async (): Promise<void> => {
    if (!visible) return;
    const elapsed = elapsedMs() / 1000;
    let fr: number[];
    if (input.barSegments) {
      // 풀 투어: 해석된 활성 구간 기준(입력 구간 순서) — 선택 실행(`--only`)이어도 전체 막대 위에서 위치를 보인다
      fr = input.barSegments.map(() => 0);
      let acc = 0;
      for (const seg of input.segments) {
        const idx = input.barSegments.findIndex((b) => b.key === seg.key);
        if (idx < 0) continue;
        const start = acc;
        acc += seg.budgetSec;
        fr[idx] = Math.min(1, Math.max(0, (elapsed - start) / seg.budgetSec));
      }
    } else {
      fr = SEGMENT_KEYS.map(() => 0);
      let acc = 0;
      for (const seg of input.segments) {
        const idx = SEGMENT_KEYS.indexOf(seg.key);
        const start = acc;
        acc += seg.budgetSec;
        fr[idx] = Math.min(1, Math.max(0, (elapsed - start) / seg.budgetSec));
      }
    }
    await stage.setProgress(fr).catch(() => undefined);
    await stage.setTimer({ elapsedMs: elapsedMs(), paused: false, totalSec: totalBudget }).catch(() => undefined);
  };

  /** 지금 이 단계를 생략할 수 있는가 — 핵심이 아니고, 승격 조건(앞 단계 생략)에도 걸리지 않을 때. */
  const isSkippableNow = (step: StepDef): boolean => step.skippable && !(step.promoteIfSkipped && skipped.has(step.promoteIfSkipped));

  const warnLateness = (): void => {
    if (!visible) return;
    const lag = elapsedMs() / 1000 - executedBudget;
    if (lag >= 20) warnOnce('lag20', `누적 지연이 ${Math.round(lag)}초입니다. 생략 가능 단계를 자동으로 건너뜁니다`);
    const remain = totalBudget - elapsedMs() / 1000;
    if (remain <= 60 && remain > 30) warnOnce('remain60', '남은 시간이 약 1분입니다');
    if (remain <= 30) warnOnce('remain30', '남은 시간이 약 30초입니다');
  };

  for (const seg of input.segments) {
    const segStart = Date.now();
    const segSteps: StepResult[] = [];
    let segFailed = false;
    await stage.setSegment(seg.chip, seg.title).catch(() => undefined);
    input.hooks?.onSegmentStart?.({ atMs: Date.now(), key: seg.key, chip: seg.chip, title: seg.title });
    let segmentSkipped = false;
    for (const step of seg.steps) {
      if (input.signal.aborted) throw new WaitAbortedError('시나리오');
      session.currentStepId = step.id;
      await gate();
      if (ctl?.consumeSkipSegment()) segmentSkipped = true;
      ctl?.setCurrent({ stepId: step.id, skippable: isSkippableNow(step) });
      if (ctl?.consumeSkipStep() && isSkippableNow(step)) {
        // 단계 사이에 눌린 건너뛰기는 다음 단계에 적용한다
        skipped.add(step.id);
      }

      const base: StepResult = { id: step.id, segment: seg.key, title: step.title, core: step.core, status: 'PASS', budgetSec: step.budgetSec, actualSec: 0, captures: [] };
      let skipReason: SkipReason | undefined;
      if (skipped.has(step.id) && input.skipIds.includes(step.id)) skipReason = 'OPTION';
      else if (skipped.has(step.id)) skipReason = 'PRESENTER';
      else if (segmentSkipped) skipReason = 'PRESENTER';
      else if (segFailed && !visible) skipReason = 'DEPENDENCY';
      else if (visible && isSkippableNow(step)) {
        // 지연 보정: 이 구간의 생략 순서대로, 아직 안 한 생략 가능 단계를 만회량이 lag 이상이 될 때까지 건너뜀(핵심은 절대 생략하지 않음)
        // 단계마다 생기는 작은 오차(화면 이동·계정 전환 수백 ms)로 한 단계 전체를 건너뛰지 않도록 허용 오차를 둔다
        const lag = elapsedMs() / 1000 - executedBudget - LAG_TOLERANCE_SEC;
        const remaining = seg.skipOrder.filter((id) => !skipped.has(id) && seg.steps.some((s) => s.id === id && isSkippableNow(s) && !results.some((r) => r.id === id) && !segSteps.some((r) => r.id === id)));
        const cands = remaining.map((id) => ({ id, budgetSec: seg.steps.find((s) => s.id === id)!.budgetSec }));
        const picks = selectSkips(lag, skippedBudget, cands);
        if (picks.includes(step.id)) {
          skipReason = 'TIME';
          skippedBudget += step.budgetSec;
        }
      }
      if (skipReason) {
        skipped.add(step.id);
        const r: StepResult = { ...base, status: 'SKIPPED', skipReason };
        segSteps.push(r);
        results.push(r);
        input.onStep?.(r, seg.title);
        continue;
      }

      input.hooks?.onStepStart?.(step, seg);
      warnLateness();
      const stepStart = Date.now();
      let failure: StepResult['failure'] | undefined;
      let verified: StepResult['verified'];
      let usedFallback = false;
      let fallbackText: { caption: string; notice: string } | null = null;
      let presenterSkipped = false;
      let disclosure: string | undefined;
      let narrationLines: string[] = step.narration;
      let shownBadges: string[] = [];
      let shownFacts: string[] = [];
      let clip: GifClip | null = null;
      try {
        // 무대 상태 맞춤
        if (step.layout !== currentLayout) {
          await stage.setLayout(step.layout);
          currentLayout = step.layout;
        }
        if (step.account) await switchAccount(step.account);
        else if (currentAccount === null && step.layout !== 'card') await switchAccount('admin1');
        if (step.site) {
          const slug = step.site === 'A' ? input.ids.A.slug : step.site === 'D' ? (input.ids.D?.slug ?? input.ids.A.slug) : input.ids.B.slug;
          await ctx.openSite(slug);
          await stage.setPaneLabel('site', step.site === 'B' ? '고객 화면 · 운영 통제 데모 챗봇' : '고객 화면 · 가온마켓 홈페이지(시연용 가상)');
        }
        if (step.console) await ctx.openConsole(step.console(input.ids));
        disclosure = (await step.dynamicDisclosure?.(ctx)) ?? step.disclosure;
        narrationLines = (await step.dynamicNarration?.(ctx)) ?? step.narration;
        // API 단계는 직전 자막을 그대로 유지한다(화면 변화 없음 — 설계 §10)
        if (visible && step.driver !== 'API') {
          const pre = composeChips(step, input.facts, false, input.plan.full);
          await showCaptionNow(step.id, { lines: narrationLines, notice: disclosure, badges: pre.badges, facts: pre.facts }, 'normal');
          await progress();
        }
        const injected = input.injectDelaySec?.[step.id];
        if (injected) await sleepMs(injected * 1000, input.signal);
        if (input.collectGif && visible && step.capture === 'gif-clip') clip = new GifClip(step.id, () => session.page.screenshot({ type: 'png' }), input.signal);

        const timeoutMs = Math.max(60_000, step.budgetSec * 4000, step.waitMaxMs ?? 0);
        const work = (async () => {
          if (mode === 'headless-check' && typeof step.headless === 'function') await step.headless(ctx);
          else await step.run(ctx);
          if (step.verify) {
            const v = await step.verify(ctx);
            verified = { expected: v.expected, actual: v.actual };
            if (!v.ok) throw Object.assign(new Error(`결과 불일치: 기대 ${v.expected ?? '?'} / 실제 ${v.actual ?? '?'}`), { verify: v });
          }
        })();
        // 진행자 건너뛰기: 생략 가능한 단계는 진행 중에도 끊고(남은 동작은 3초 안에 정리), 'next segment'는 핵심 단계도 끊는다
        let cancelInterrupt: (() => void) | undefined;
        const interrupt = ctl
          ? new Promise<'skip'>((resolve) => {
              const onSkip = (): void => {
                if (isSkippableNow(step) && ctl.consumeSkipStep()) resolve('skip');
              };
              const onSeg = (): void => {
                if (ctl.consumeSkipSegment()) {
                  segmentSkipped = true;
                  resolve('skip');
                }
              };
              ctl.on('skip', onSkip);
              ctl.on('segment', onSeg);
              cancelInterrupt = () => {
                ctl.off('skip', onSkip);
                ctl.off('segment', onSeg);
              };
            })
          : null;
        try {
          const done = raceWithTimeout(work, timeoutMs, `단계 ${step.id} 전체`, input.signal);
          // 시간 초과·중단 뒤에도 백그라운드로 남는 작업의 늦은 거부가 처리되지 않은 거부가 되지 않게 한다(L-8)
          work.catch(() => undefined);
          done.catch(() => undefined);
          if (interrupt) {
            const first = await Promise.race([done.then(() => 'done' as const), interrupt]);
            if (first === 'skip') {
              presenterSkipped = true;
              await Promise.race([done.catch(() => undefined), sleepMs(3000, input.signal)]);
              work.catch(() => undefined);
            }
          } else await done;
        } finally {
          cancelInterrupt?.();
        }
        if (!presenterSkipped) {
          const post = composeChips(step, input.facts, true, input.plan.full);
          shownBadges = post.badges;
          shownFacts = post.facts;
          if (input.full && post.hidden.length > 0) input.full.record.badgeNotes.push({ stepId: step.id, shown: [...post.facts, ...post.badges], hidden: post.hidden });
          if (visible && step.driver !== 'API' && (shownBadges.length > 0 || shownFacts.length > 0)) {
            // 검증을 통과한 뒤에만 장면이 증명하는 배지를 보인다(증거 조건 — ui-spec §4.4). 사실 칩은 사실이 성립하는 동안 함께 보인다.
            await stage.showCaption({ lines: narrationLines, notice: disclosure, badges: shownBadges, ...(shownFacts.length > 0 ? { facts: shownFacts } : {}) });
            lastCaption = { lines: narrationLines, notice: disclosure, badges: shownBadges, ...(shownFacts.length > 0 ? { facts: shownFacts } : {}) };
            input.hooks?.onCaptionBadges?.(step.id, shownBadges, shownFacts);
          }
        }
      } catch (e) {
        if (e instanceof WaitAbortedError || input.signal.aborted) {
          await clip?.stop().catch(() => undefined);
          throw e;
        }
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
            const fb = step.fallback.captionFor?.(ctx) ?? { caption: step.fallback.caption, notice: step.fallback.notice };
            fallbackText = { caption: fb.caption, notice: fb.notice ?? '준비된 결과로 대신 보여 드립니다' };
            if (visible) {
              await stage.setStateChip('fallback');
              await showCaptionNow(step.id, { lines: [fb.caption], notice: fallbackText.notice, badges: [] }, 'fallback');
            }
            usedFallback = true;
          } catch {
            usedFallback = false;
          }
        }
      }
      if (clip) {
        await clip.stop().catch(() => undefined);
        if (clip.frames.length > 0 && !presenterSkipped) gifClips.push({ stepId: step.id, frames: clip.frames });
      }
      if (presenterSkipped) {
        ctl?.setCurrent(null);
        skipped.add(step.id);
        const r: StepResult = { ...base, actualSec: (Date.now() - stepStart) / 1000, status: 'SKIPPED', skipReason: 'PRESENTER' };
        segSteps.push(r);
        results.push(r);
        input.onStep?.(r, seg.title);
        continue;
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
        // 화면 유지(dwell): 남은 예산만큼(자막 읽기 시간 R · 최소 표시 보장) — 일시정지·건너뛰기는 200ms 단위로 반영한다
        let remainingMs = failure && !usedFallback ? 0 : Math.max(dwellMs(step.budgetSec, actualMs), Math.min(MIN_SHOW_MS, dwellMs(step.budgetSec, actualMs) > 0 ? dwellMs(step.budgetSec, actualMs) : 0));
        while (remainingMs > 0 && !input.signal.aborted) {
          if (ctl?.paused) {
            await gate();
            continue;
          }
          if (ctl?.consumeSkipSegment()) {
            segmentSkipped = true;
            break;
          }
          if (ctl?.consumeSkipStep()) break;
          const slice = Math.min(250, remainingMs);
          await sleepMs(slice, input.signal);
          remainingMs -= slice;
        }
        if (usedFallback) await stage.setStateChip('none').catch(() => undefined);
      }
      ctl?.setCurrent(null);
      executedBudget += step.budgetSec;
      const actualSec = (Date.now() - stepStart) / 1000;
      const honesty: string[] = [];
      if (usedFallback) honesty.push(`${step.id}: ${[fallbackText?.caption ?? step.fallback?.caption, fallbackText?.notice ?? step.fallback?.notice ?? '준비된 결과로 대신 보여 드립니다'].filter(Boolean).join(' - ')}`);
      else if (disclosure) honesty.push(`${step.id}: ${disclosure}`);
      const r: StepResult = {
        ...base,
        actualSec,
        status: failure ? (usedFallback ? 'FALLBACK' : 'FAIL') : 'PASS',
        failure,
        delay: !failure && visible ? delayLabel(step.budgetSec, actualSec) : null,
        honesty: honesty.length > 0 ? honesty : undefined,
        narration: visible && step.driver !== 'API' ? { lines: usedFallback ? [fallbackText?.caption ?? step.fallback?.caption ?? ''] : narrationLines, notice: usedFallback ? (fallbackText?.notice ?? step.fallback?.notice ?? '준비된 결과로 대신 보여 드립니다') : disclosure } : undefined,
        badges: !failure && shownBadges.length + shownFacts.length > 0 ? [...shownFacts, ...shownBadges] : undefined,
        verified,
      };
      // 핵심 단계의 실패만 뒤 단계를 막는다(생략 가능 단계의 실패는 독립적인 뒤 단계에 영향이 없다)
      if (failure && !usedFallback && step.core) segFailed = true;
      segSteps.push(r);
      results.push(r);
      input.onStep?.(r, seg.title);
      if (failure && !usedFallback && input.failFast) {
        segResults.push({ key: seg.key, title: seg.title, chip: seg.chip, budgetSec: seg.budgetSec, actualSec: (Date.now() - segStart) / 1000, steps: segSteps });
        return { segments: segResults, steps: results, showSec: elapsedMs() / 1000, pausedSec: pausedMs / 1000, gifClips, warnings };
      }
    }
    segResults.push({ key: seg.key, title: seg.title, chip: seg.chip, budgetSec: seg.budgetSec, actualSec: (Date.now() - segStart) / 1000, steps: segSteps });
  }
  session.currentStepId = null;
  ctl?.setCurrent(null);
  return { segments: segResults, steps: results, showSec: elapsedMs() / 1000, pausedSec: pausedMs / 1000, gifClips, warnings };
}

export type { StepDef };
