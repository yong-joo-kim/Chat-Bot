// 공연(시나리오 실행) 단계 — 브라우저 세션을 열고(영상 녹화 포함) 준비 완료 요약·엔터 대기·T0 처리(통계 기준값 · 라이브 예약)를 거쳐 선택한 구간의 단계 정의를 순서대로 실행한다.
// 보이는 시연: 대기 화면 → 엔터 → 공연 → 마무리 화면 유지(q) · 무인 점검: 즉시 실행 · 자막·영상·GIF 없음.
import { existsSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import type { CliOptions } from '../cli/args';
import type { Ports } from '../config';
import { BrowserSession, StageController } from '../browser/session';
import { CaptionTimeline } from '../capture/vtt';
import { keyHelpLine, type PresenterControl } from '../control/presenter';
import type { Credentials } from '../data/generator';
import type { DatasetIds } from '../data/types';
import type { ApiSessions, PresetDef, RunFacts, RunState, SegmentDef } from '../scenario/types';
import type { PlanContext, ResolvedPreset } from '../scenario/plan';
import type { Supervisor } from '../proc/supervisor';
import { join as joinPath } from 'node:path';
import { makeGpuControl, makeStepEnv, type FullRuntime } from './full-prepare';
import { printFullReadySummary } from './full-summary';
import { mergeInactiveRows } from './full-report';
import { runScenario, type ScenarioResult } from '../scenario/runner';
import type { Terminal } from '../log/terminal';
import type { RunPaths } from '../run/run-dir';
import type { StageFacts } from '../stage/facts';
import { formatMmSs } from '../util/time';
import { createLiveSchedule } from './live-schedule';
import { printReadySummary, type ReadySummaryInput } from './ready-summary';

export interface ShowInput {
  opts: CliOptions;
  preset: PresetDef;
  run: RunPaths;
  ports: Ports;
  ids: DatasetIds;
  api: ApiSessions;
  term: Terminal;
  signal: AbortSignal;
  state: RunState;
  facts: RunFacts;
  /** 무대 `/__facts` — 마무리 카드에 공연 결과를 싣는다. */
  stageFacts: StageFacts;
  credentials: Credentials | null;
  fixtureCsv: string;
  /** 영상 인코더가 있고 영상을 쓰는 실행일 때만 true(없으면 recordVideo를 넘기지 않는다 — 설계 정정 #6). */
  recordVideo: boolean;
  /** 진행자 제어(보이는 시연 · 진행자 키가 있는 실행). 없으면 엔터 대기·키 제어 없이 진행한다. */
  control: PresenterControl | null;
  keyMode: 'keys' | 'lines';
  summary: Omit<ReadySummaryInput, 'keyMode' | 'credentials' | 'videoOn'>;
  /** [DT-2] 계획 문맥(10분판은 모든 플래그가 꺼진 고정 값). */
  plan: PlanContext;
  /** [DT-2] 풀 투어 해석 결과(10분판은 null — 프리셋 정의를 그대로 쓴다). */
  resolved: ResolvedPreset | null;
  /** [DT-2] 풀 투어 실행 상태(음성·생성·GPU·결과 기록). */
  full?: { rt: FullRuntime; supervisor: Supervisor };
}

export interface ShowOutcome {
  scenario: ScenarioResult | null;
  session: BrowserSession | null;
  executedSegments: SegmentDef[];
  /** 공연 시작(T0) 시각 — 엔터를 누른 순간. */
  showStartedAt: Date | null;
  /** 자막 타임라인(영상 녹화가 있을 때만 VTT로 쓴다). */
  timeline: CaptionTimeline | null;
  recStartMs: number | null;
  showEndedAtMs: number | null;
  videoRecorded: boolean;
  /** [DT-2] 구간 시작 시각(에포크 ms) — 보고서 VRAM 구간 최대. */
  segmentStarts: Array<{ key: string; atMs: number }>;
}

/** 선택한(--only) 구간 중 단계 정의가 있는 구간만 실행 대상이다. */
export function selectSegments(preset: PresetDef, only: CliOptions['only']): SegmentDef[] {
  return selectSegmentsFrom(preset.segments, only);
}

/** [DT-2] 해석된 구간 목록에서 선택(풀 투어는 활성 구간만 들어온다). */
export function selectSegmentsFrom(all: readonly SegmentDef[], only: CliOptions['only']): SegmentDef[] {
  return all.filter((s) => s.steps.length > 0 && (only === null || only.includes(s.key)));
}

const SKIP_TEXT: Record<string, string> = { TIME: '시간 부족', PRESENTER: '진행자 선택', OPTION: '옵션', DEPENDENCY: '선행 실패', NO_BROWSER: '브라우저 없음' };

/** Playwright가 만든 `page@<해시>.webm`을 `show.webm`으로 바꾼다(컨텍스트를 닫아 파일이 확정된 뒤에만 호출). 없으면 null. */
export function finalizeVideo(videoDir: string): string | null {
  try {
    const found = readdirSync(videoDir).filter((n) => n.endsWith('.webm') && n !== 'show.webm');
    if (found.length === 0) return existsSync(join(videoDir, 'show.webm')) ? 'video/show.webm' : null;
    // 페이지가 1개뿐이므로 파일도 1개 — 여러 개면 가장 큰 것을 영상으로 본다
    renameSync(join(videoDir, found[0]), join(videoDir, 'show.webm'));
    return 'video/show.webm';
  } catch {
    return null;
  }
}

export async function runShow(i: ShowInput): Promise<ShowOutcome> {
  const segments = selectSegmentsFrom(i.resolved ? i.resolved.segments : i.preset.segments, i.opts.only);
  const empty: ShowOutcome = { scenario: null, session: null, executedSegments: [], showStartedAt: null, timeline: null, recStartMs: null, showEndedAtMs: null, videoRecorded: false, segmentStarts: [] };
  if (segments.length === 0) {
    i.term.line('info', '실행할 장면이 없습니다(선택한 구간에 단계 정의가 없음)');
    return empty;
  }
  const visible = i.opts.mode === 'visible';
  const unattended = visible && i.opts.unattendedVisibleForTest;
  const total = segments.reduce((n, s) => n + s.budgetSec, 0);
  i.term.line('info', `공연 시작 준비: 장면 ${segments.map((s) => s.key).join(' · ')} / 예산 ${formatMmSs(total)} / ${visible ? '보이는 시연(사람 속도·자막)' : '무인 점검(즉시 입력·자막 없음)'}`);

  const videoOn = visible && i.recordVideo;
  const session = await BrowserSession.launch({
    browser: i.opts.browser,
    profileDir: i.run.browserProfile,
    viewport: i.opts.viewport,
    // 시험 전용 숨은 인자(unattended)는 보이는 시연 흐름을 창 없이 돌린다
    headless: !visible || unattended,
    stageUrl: `http://localhost:${i.ports.stage}/stage`,
    consoleLogFile: join(i.run.logs, 'browser-console.log'),
    recordVideoDir: videoOn ? i.run.video : undefined,
    // [DT-2] 풀 투어: 다운로드를 받고(엑셀 내보내기) · 음성 입력이면 가짜 마이크(합성 음성 WAV) + 고객사 모형 출처 1곳에만 마이크 권한
    acceptDownloads: i.plan.full ? true : undefined,
    fakeAudioFile: i.plan.full && i.plan.voiceInput !== 'off' ? (i.full?.rt.wavPath ?? undefined) : undefined,
    grantMicrophoneOrigin: i.plan.full && i.plan.voiceInput !== 'off' ? `http://localhost:${i.ports.stage}` : undefined,
  });
  const recStartMs = Date.now();
  const timeline = new CaptionTimeline(recStartMs);
  await session.openStage();
  const stage = new StageController(session.page);
  // 풀 투어 진행 막대는 해석된 활성 구간 전체를 그린다(선택 실행이어도) — 10분판은 DT-1 9칸 기본값 그대로
  const barSegments = i.resolved ? i.resolved.segments.map((s) => ({ key: s.key as string, budgetSec: s.budgetSec })) : undefined;
  if (barSegments) await stage.setSegments(barSegments);
  await stage.setReady(visible);
  await stage.setTimer({ elapsedMs: 0, paused: false, totalSec: total });

  // ── 준비 완료 요약 · 엔터 대기(보이는 시연) ──
  const control = visible && !unattended ? i.control : null;
  if (visible) {
    if (i.full) printFullReadySummary(i.term, { ...i.summary, credentials: i.credentials, keyMode: i.keyMode, videoOn }, i.full.rt, i.resolved!);
    else printReadySummary(i.term, { ...i.summary, credentials: i.credentials, keyMode: i.keyMode, videoOn });
    if (control) {
      control.attach();
      await control.waitForStart(i.signal);
    } else if (unattended) i.term.line('info', '무인 시험 실행이라 엔터 대기를 생략합니다(--unattended-visible-for-test)');
  }
  if (i.signal.aborted) return { ...empty, session, executedSegments: segments, recStartMs };

  // ── T0 처리(시간 예산 밖 · 화면 변화 없음 — 설계 §10.0) ──
  const t0 = new Date();
  const base = (await i.api.admin1.get('/stats/summary', { query: { chatbotId: i.ids.A.id } })).body as { totals: { turnCount: number; unansweredCount: number } };
  i.state.statsBaseline = { turnCount: base.totals.turnCount, unansweredCount: base.totals.unansweredCount };
  if (visible || i.opts.waitLiveSchedule) {
    i.state.liveSchedule = await createLiveSchedule({ admin1: i.api.admin1, admin2: i.api.admin2, ids: i.ids, log: (m) => i.term.detail(m) });
    if (i.state.liveSchedule.status === 'CREATED') i.term.detail(`라이브 예약 C-2: ${i.state.liveSchedule.scheduledAt}`);
    else i.term.line('warn', `라이브 예약 C-2를 만들지 못했습니다: ${i.state.liveSchedule.error ?? ''}`, { why: '장면 5의 예약 단계가 준비 단계의 이력 예약 화면으로 대체됩니다', how: '보고서 정직성 표기에 대체로 기록됩니다' });
  } else {
    i.state.liveSchedule = { status: 'SKIPPED' };
  }
  await stage.setReady(false);
  if (visible && control) i.term.text(`조작 키: ${keyHelpLine(i.keyMode)}`);

  // [DT-2] 풀 투어 실행 환경 — 순차 적재 제어·합성 음성·다운로드 폴더·VTT 소리 노트
  const stepEnv = i.full
    ? makeStepEnv(i.full.rt, {
        gpu: makeGpuControl(i.full.rt, { supervisor: i.full.supervisor, stageFacts: i.stageFacts, signal: i.signal, log: (m) => i.term.detail(m) }),
        stageFacts: i.stageFacts,
        downloadsDir: joinPath(i.run.dir, 'downloads'),
        speakerEnabled: visible && i.plan.voiceInput === 'real',
        proactive: i.full.rt.proactiveRule,
        soundNote: (text) => timeline.addSoundNote(Date.now(), text),
      })
    : undefined;
  const segmentStarts: Array<{ key: string; atMs: number }> = [];
  const scenario = await runScenario({
    plan: i.plan,
    full: stepEnv,
    barSegments,
    segments,
    mode: i.opts.mode,
    skipIds: i.opts.skip,
    failFast: i.opts.failFast,
    session,
    ids: i.ids,
    api: i.api,
    runId: i.run.runId,
    ports: { api: i.ports.api, console: i.ports.console, widget: i.ports.widget, stage: i.ports.stage },
    shotsDir: i.run.shots,
    signal: i.signal,
    state: i.state,
    facts: i.facts,
    fixtureCsv: i.fixtureCsv,
    totalBudgetSec: total,
    control: control ?? undefined,
    collectGif: visible && !i.opts.noGif,
    injectDelaySec: i.opts.injectDelay,
    hooks: {
      onSegmentStart: (e) => {
        segmentStarts.push({ key: e.key, atMs: e.atMs });
        timeline.addSegment(e.atMs, e.chip, e.title);
      },
      onCaption: (e) => timeline.addCaption(e),
      onCaptionBadges: (stepId, badges, facts) => timeline.setBadges(stepId, badges, facts),
      onPause: (atMs, paused) => (paused ? timeline.addPause(atMs) : timeline.addResume(atMs)),
    },
    onWarn: (m) => i.term.line('warn', m),
    log: (m) => i.term.detail(m),
    onStep: (r, segTitle) => {
      const time = visible ? `${r.actualSec.toFixed(1)}초 / 예산 ${r.budgetSec}초${r.delay ? ` / ${r.delay}` : ''}` : `${r.actualSec.toFixed(1)}초`;
      const head = `${r.id} ${r.title}`;
      if (r.status === 'PASS') i.term.line('pass', `${head} (${time})`);
      else if (r.status === 'SKIPPED') i.term.line('skip', `${head} - ${SKIP_TEXT[r.skipReason ?? 'OPTION']}`);
      else if (r.status === 'FALLBACK') i.term.line('fallback', `${head} - 준비된 결과로 대신 보였습니다`, { why: r.failure?.message, how: '로그와 화면 캡처(FAIL)를 확인하세요' });
      else i.term.line('fail', `${head} (${segTitle} · ${r.core ? '핵심' : '생략 가능'}) - ${r.failure?.kind ?? ''}`, { why: r.failure?.message, how: r.failure?.kind === 'SELECTOR' ? '화면 문구가 바뀌었는지 확인하고 선택자(src/selectors)를 갱신하세요' : `shots/${r.id}-FAIL.png 와 logs/browser-console.log 를 확인하세요` });
    },
  });

  // ── 마무리 화면 유지(보이는 시연) — 진행자가 q를 누를 때까지 ──
  // [DT-2] 비활성 단계(옵션 생략)를 결과에 순서대로 끼워 넣는다 — 건너뜀 집계에서는 OPTION을 따로 센다(고객에게 "시간이 모자라 건너뜀"으로 읽히지 않게)
  let executedSegments: SegmentDef[] = segments;
  if (i.resolved) {
    const merged = mergeInactiveRows(scenario, i.preset, i.resolved, i.opts.only);
    executedSegments = [...segments, ...merged.extraSegments];
  }
  const counts: { passed: number; skipped: number; fallback: number; failed: number; optionSkipped?: number } = { passed: 0, skipped: 0, fallback: 0, failed: 0 };
  let optionSkipped = 0;
  for (const r of scenario.steps) {
    if (i.resolved && r.status === 'SKIPPED' && r.skipReason === 'OPTION') {
      optionSkipped++;
      continue;
    }
    counts[r.status === 'PASS' ? 'passed' : r.status === 'SKIPPED' ? 'skipped' : r.status === 'FALLBACK' ? 'fallback' : 'failed']++;
  }
  if (i.resolved) counts.optionSkipped = optionSkipped;
  i.stageFacts.results = counts;
  i.stageFacts.blockedRequests = session.blockedSummary().reduce((n, b) => n + b.count, 0);
  const showEndedAtMs = Date.now();
  if (visible && !i.signal.aborted) {
    await stage.showCard('system-end').catch(() => undefined);
    await stage.clearCaption().catch(() => undefined);
    await stage.setTimer({ elapsedMs: scenario.showSec * 1000, paused: false, ended: true, totalSec: total }).catch(() => undefined);
    if (control) {
      i.term.text('시연이 끝났습니다. q를 누르면 정리하고 보고서 폴더를 엽니다.');
      await control.waitForFinish(i.signal);
    }
    await stage.setFinishing().catch(() => undefined);
  }
  return { scenario, session, executedSegments, showStartedAt: t0, timeline, recStartMs, showEndedAtMs, videoRecorded: videoOn, segmentStarts };
}
