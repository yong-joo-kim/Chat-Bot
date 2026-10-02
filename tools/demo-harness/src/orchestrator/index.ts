// 실행 오케스트레이션(설계 §5) — P0 사전 점검 -> P1 실행 폴더·격리 DB -> P2 빌드 -> P3 기동 -> (P4·P5·공연은 다음 단계) -> 정리.
// 1단계 범위: P0~P3와 정리까지. 데모 데이터·보정·시나리오 실행기·캡처·보고서는 후속 단계에서 이 흐름에 끼워 넣는다.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { cpus, freemem, release as osRelease, totalmem, type as osType } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { CliOptions } from '../cli/args';
import { portsFor, TIMEOUTS, PORT_LABELS, type Ports, type RepoPaths } from '../config';
import { createFullExtras } from '../data/generator-full';
import { defaultPlan, egressNames } from '../scenario/plan';
import { checkPlanPreflight, fullServerHooks, printFullOptionLines } from './full-flow';
import { runModelPrepare } from './full-models';
import { buildStagePlan, createFullRuntime, fullCleanup, type FullRuntime } from './full-prepare';
import { buildFullReportInput, scanAudioTraces } from './full-report';
import { gateDx3 } from './full-prepare';
import { assertIsolatedDbUrl, DbGuardError, toSqliteUrl } from '../env/db-guard';
import { buildApiEnv, buildMlEnv, type OverrideRow } from '../env/api-env';
import { Terminal } from '../log/terminal';
import { checkPresetDefinition, checkSkipIds } from '../scenario/definition-check';
import type { LiveScheduleState, PresetDef, RunFacts } from '../scenario/types';
import { PresenterControl, type PresenterInput } from '../control/presenter';
import { buildResult, type BuildInput } from '../report/build';
import { scanRunDirForSecrets, writeReport } from '../report/write';
import { playwrightVersion } from '../report/version';
import { Redactor } from '../util/redact';
import { formatMmSs, isoWithOffset } from '../util/time';
import { guarded } from '../util/guarded';
import { sleepMs, WaitAbortedError } from '../util/wait-for';
import { runPreflight, readRefsMain, hfHubDir, fileFingerprint, type PreflightReport } from '../preflight';
import type { PcItem } from '../preflight/checks';
import { evalDistOutputs } from '../preflight/checks';
import { cleanupResidual, isHarnessAlive } from '../proc/residual';
import { killTreeSync } from '../proc/tree-kill';
import { Supervisor, type TeardownReport } from '../proc/supervisor';
import { migrateDeploy } from '../proc/prisma';
import { waitHealthy, ProcessDiedError } from '../proc/health';
import { AbortedError, PrepareError } from './errors';
import { startHarnessServers, type HarnessServers, type ServerHooks } from '../servers';
import { defaultFacts, type StageFacts } from '../stage/facts';
import type { StageBotInfo } from '../servers/stage-server';
import { finalizeVideo, runShow, type ShowOutcome } from './show-phase';
import { registerStageBots, runCalibration, runDataPhase, waitHistorySchedule, type DataPhaseInput, type DataPhaseResult } from './data-phase';
import { httpJson } from '../util/json-request';
import { measureEmbedLatency, decideEmbeddingTimeout, type LatencyMeasurement, type TimeoutDecision } from '../measure/latency';
import { computeFingerprint, needsBuild, readBuildStamp, writeBuildStamp, DIST_PATHS } from '../build/fingerprint';
import { buildProducts } from '../build/builder';
import {
  createRunDir,
  listRunIds,
  PidRegistry,
  pruneRunDirs,
  readPidsFile,
  runPathsFor,
  writeStateFile,
  type RunPaths,
  type RunStateFile,
} from '../run/run-dir';

export const EXIT = { OK: 0, FAILED: 1, PREPARE_FAILED: 2, ABORTED: 130 } as const;

export { AbortedError, PrepareError };

export interface RunContext {
  opts: CliOptions;
  preset: PresetDef;
  paths: RepoPaths;
  runsDir: string;
  makeTerminal: (logFile: string | undefined, redact: (s: string) => string) => Terminal;
  signal: AbortSignal;
  /** 진행자 종료(q → y)·원시 모드 Ctrl+C가 같은 정리 경로(종료 코드 130)로 가게 하는 취소 함수. */
  abort?: () => void;
  env?: NodeJS.ProcessEnv;
}

const TOTAL_PHASES = 6;
const STOP_REQUEST = 'stop.request';

function checkAbort(signal: AbortSignal): void {
  if (signal.aborted) throw new AbortedError();
}

function printPreflight(term: Terminal, items: PcItem[]): void {
  for (const it of items) {
    if (it.status === 'pass') term.line('pass', `${it.title}: ${it.message}`);
    else if (it.status === 'warn') term.line('warn', `${it.title}: ${it.message}`, { why: it.why, how: it.how });
    else if (it.status === 'block') term.line('error', `${it.title}: ${it.message}`, { why: it.why, how: it.how });
    else term.detail(`[${it.id}] ${it.title}: ${it.message}`);
  }
}

interface BootResult {
  supervisor: Supervisor;
  servers: HarnessServers;
  latency: LatencyMeasurement | null;
  decision: TimeoutDecision | null;
  embeddingTimeoutMs: number;
  governance: 'ON' | 'OFF';
  governanceFallback: boolean;
  overrides: OverrideRow[];
  governanceLogLine: string | null;
  /** ml-worker /health가 알려 준 장치(설정값 메아리 — CUDA_VISIBLE_DEVICES=-1과 함께 증거로 쓴다). */
  mlDevice: string | null;
  /** [DT-2] 문장 분석 모델 ID(모델 구성표). */
  mlModelId: string | null;
}

/** 준비 단계 한 줄(보고서 "준비 시간" 표). */
interface PrepareRow {
  id: string;
  name: string;
  sec: number;
  status: 'OK' | 'SKIPPED' | 'FAILED';
}

/** 반환: 종료 코드(0 통과 · 1 단계 실패 · 2 준비 실패 · 130 중단). */
export async function executeRun(ctx: RunContext): Promise<number> {
  const { opts, preset, paths, runsDir, signal } = ctx;
  const parentEnv = ctx.env ?? process.env;
  // [DT-2] 풀 투어(모델 장면 플래그를 받는 프리셋)인지 — 10분판은 이 분기를 하나도 타지 않는다(DT-1과 같은 흐름).
  const isFull = (preset.flags?.length ?? 0) > 0;
  const fullRt = isFull ? createFullRuntime(opts, preset) : null;
  const ports = portsFor(opts.portOffset, { augment: isFull && opts.withLocalLlm, speech: isFull && opts.withVoiceInput });
  const redactor = new Redactor();
  const t0 = Date.now();
  const startedAt = new Date();

  // ── 정의 검사 ──
  const defIssues = checkPresetDefinition(preset);
  const skipErrors = checkSkipIds(preset, opts.skip, fullRt?.plan);
  const bootTerm = ctx.makeTerminal(undefined, (s) => s);
  if (defIssues.length > 0 || skipErrors.length > 0) {
    for (const i of defIssues) bootTerm.line('error', `프리셋 정의 오류 (${i.where}): ${i.message}`, { why: '시나리오 정의 검사를 통과하지 못했습니다', how: '프리셋 정의를 수정하세요' });
    for (const e of skipErrors) bootTerm.line('error', e, { why: '핵심 단계는 시간이 부족해도 생략하지 않습니다', how: '생략 가능 단계 ID만 --skip에 지정하세요' });
    return EXIT.PREPARE_FAILED;
  }
  if (opts.resume !== null) {
    bootTerm.line('error', '--resume(구간 단위 재개)은 아직 구현되지 않았습니다', { why: '이번 단계는 시나리오·보고서까지 구현했고 같은 실행 폴더로의 상태 재개는 후속 단계입니다', how: '새 실행으로 pnpm demo 를 다시 실행하세요(실패한 구간만 보려면 --only s3 처럼 구간을 고르세요)' });
    return EXIT.PREPARE_FAILED;
  }
  if (opts.appendixLlm) bootTerm.line('warn', '--appendix-llm(LLM 동작 확인 부록)은 아직 구현되지 않아 이번 실행에서는 부록 없이 진행합니다', { why: '설계 §23 H7의 선택 부록입니다', how: '부록 없이도 종료 코드와 보고서는 같습니다' });

  // ── 실행 폴더(로그 파일이 필요하므로 점검 전에 만든다) ──
  const run = createRunDir(runsDir);
  const term = ctx.makeTerminal(join(run.logs, 'harness.log'), (s) => redactor.redact(s));
  const registry = new PidRegistry(run.pidsFile, run.runId);
  const markers = [`cbdemo_run=${run.runId}`, `cbdemo-api-${run.runId}`];
  const supervisor = new Supervisor(registry, markers);
  const stateBase: RunStateFile = {
    schemaVersion: 1,
    runId: run.runId,
    createdAt: isoWithOffset(new Date()),
    updatedAt: isoWithOffset(new Date()),
    mode: opts.mode,
    preset: preset.id,
    ports,
    phase: 'created',
    completedSegments: [],
    state: {},
    serversKept: false,
  };
  const saveState = (patch: Partial<RunStateFile>) => {
    Object.assign(stateBase, patch);
    writeStateFile(run.stateFile, stateBase, (t) => redactor.redact(t));
  };
  saveState({});

  term.banner(`원클릭 시연 하네스 (${isFull ? 'DT-2' : 'DT-1'}) - 프리셋 ${preset.id}${isFull ? ' (풀 투어)' : ''} - ${opts.mode === 'visible' ? '보이는 시연' : '무인 점검'}`);
  term.text(`실행 ID ${run.runId}   폴더 ${run.dir}`);
  if (fullRt) printFullOptionLines(term, opts);
  term.blank();

  // 비정상 종료 대비 동기 정리(비동기 불가)
  const onExit = () => supervisor.teardownSync();
  process.on('exit', onExit);

  let exitCode: number = EXIT.OK;
  let boot: BootResult | null = null;
  let preflight: PreflightReport | null = null;
  let dataResult: DataPhaseResult | null = null;
  let showOutcome: ShowOutcome | null = null;
  let showCounts: { pass: number; fail: number; skip: number; fallback: number; showSec: number } | null = null;
  const stageBots: Record<string, StageBotInfo> = {};
  const stageFacts: StageFacts = defaultFacts();
  const prepare: PrepareRow[] = [];
  let currentPhase = 'P0 사전 점검';
  let prepareFailure: { phase: string; message: string; why?: string; how?: string } | undefined;
  let control: PresenterControl | null = null;
  let phaseStartMs = Date.now();
  const phaseSec = (): number => (Date.now() - phaseStartMs) / 1000;
  const markPhase = (id: string, name: string, status: PrepareRow['status'] = 'OK'): void => {
    prepare.push({ id, name, sec: phaseSec(), status });
  };
  try {
    // ═══ [1/6] 사전 점검 ═══
    phaseStartMs = Date.now();
    const residual = cleanupResidual(runsDir, { exclude: run.runId });
    for (const r of residual) {
      if (r.liveOwnerPid !== undefined) {
        term.line('warn', `이전 실행 ${r.runId}은(는) 아직 실행 중인 하네스(PID ${r.liveOwnerPid})가 소유하고 있어 건드리지 않았습니다`, { why: '서버 유지 모드(--prepare-only·--no-teardown)이거나 다른 터미널에서 시연 중일 수 있습니다', how: `끝내려면  pnpm demo -- --stop ${r.runId}` });
        continue;
      }
      if (r.killed.length > 0) term.line('info', `이전 실행 ${r.runId}의 남은 프로세스 ${r.killed.length}개를 정리했습니다`);
      if (r.skippedNoMarker.length > 0) term.line('warn', `이전 실행 ${r.runId}의 PID ${r.skippedNoMarker.join(', ')}는 표식이 달라 건드리지 않았습니다`, { why: 'PID가 다른 프로세스로 재사용됐을 수 있습니다', how: '필요하면 작업 관리자에서 직접 확인하세요' });
    }
    checkAbort(signal);
    preflight = await runPreflight({ paths, options: opts, ports, runsDir, env: parentEnv });
    printPreflight(term, preflight.items);
    if (fullRt) {
      // [DT-2] PC-DX-1~12 · 장치 결정 · 불가 판정(보이는 시연 = 경고 + 장면 생략 · 무인 점검 = 차단)
      const outcome = await checkPlanPreflight({ rt: fullRt, term, paths, run, opts, env: parentEnv, signal });
      preflight.items.push(...outcome.items);
      if (outcome.blocked) {
        term.stepLine(1, TOTAL_PHASES, '사전 점검', '실패', formatMmSs(phaseSec()));
        markPhase('P0', '사전 점검', 'FAILED');
        throw new PrepareError(outcome.blocked.what, outcome.blocked.why, outcome.blocked.how);
      }
    }
    term.stepLine(1, TOTAL_PHASES, '사전 점검', preflight.blocked ? '실패' : '완료', formatMmSs(phaseSec()));
    markPhase('P0', '사전 점검', preflight.blocked ? 'FAILED' : 'OK');
    if (preflight.blocked) throw new PrepareError('사전 점검 차단 항목이 있습니다', '위 [오류] 항목을 해결해야 시연을 준비할 수 있습니다', '안내된 조치를 한 뒤 pnpm demo 를 다시 실행하세요');
    saveState({ phase: 'preflight' });
    checkAbort(signal);

    // ═══ [2/6] 실행 폴더 · 격리 DB ═══
    currentPhase = 'P1 실행 폴더 · 격리 DB';
    phaseStartMs = Date.now();
    let dbPath: string;
    try {
      const requested = opts.dbUrlForTest ?? toSqliteUrl(run.dbFile);
      dbPath = assertIsolatedDbUrl(requested, run.dir, paths.devDb);
    } catch (e) {
      if (e instanceof DbGuardError) throw new PrepareError(e.message, e.why, e.how);
      throw e;
    }
    const mig = await migrateDeploy({ apiDir: paths.apiDir, databaseUrl: toSqliteUrl(dbPath), logFile: join(run.logs, 'migrate.log'), parentEnv });
    if (!mig.ok) {
      throw new PrepareError(`격리 DB 마이그레이션(prisma migrate deploy) 실패 - 종료 코드 ${mig.code}`, mig.tail.slice(-3).join(' / ') || '출력 없음', `로그 ${join(run.logs, 'migrate.log')} 를 확인하세요`);
    }
    const pruned = pruneRunDirs(runsDir, opts.keepRuns, run.runId);
    if (pruned.removed.length > 0) term.detail(`오래된 실행 폴더 ${pruned.removed.length}개 삭제: ${pruned.removed.join(', ')}`);
    if (pruned.failed.length > 0) term.line('warn', `실행 폴더 ${pruned.failed.length}개를 지우지 못했습니다`, { why: 'SQLite 파일 핸들이 아직 열려 있을 수 있습니다', how: '다음 실행이 다시 시도합니다' });
    term.stepLine(2, TOTAL_PHASES, '실행 폴더 · 격리 DB', '완료', formatMmSs(phaseSec()));
    markPhase('P1', '실행 폴더 · 격리 DB');
    saveState({ phase: 'prepared' });
    checkAbort(signal);

    // ═══ [3/6] 빌드 ═══
    currentPhase = 'P2 빌드';
    phaseStartMs = Date.now();
    const stampFile = join(runsDir, '.build-stamp.json');
    const fp = computeFingerprint(paths.repo);
    const mustBuild = !opts.noBuild && needsBuild(fp, readBuildStamp(stampFile), opts.rebuild);
    if (mustBuild) {
      term.text('제품 빌드 중입니다(첫 실행은 3~5분 걸릴 수 있습니다)...');
      const outcome = await buildProducts(paths.repo, run.logs, (pkg, i, n) => term.detail(`빌드 ${i}/${n}: ${pkg}`));
      if (!outcome.ok) {
        throw new PrepareError(`빌드 실패: ${outcome.failedPackage}`, (outcome.tail ?? []).slice(-3).join(' / ') || '출력 없음', `로그 ${join(run.logs, 'build-*.log')} 를 확인하세요`);
      }
      writeBuildStamp(stampFile, { fingerprint: computeFingerprint(paths.repo), builtAt: isoWithOffset(new Date()) });
    }
    const missing = DIST_PATHS.filter((p) => !existsSync(join(paths.repo, p)));
    const distItem = evalDistOutputs([...missing], true);
    if (distItem.status === 'block') throw new PrepareError(distItem.message, '빌드 산출물이 없어 서버를 띄울 수 없습니다', '--no-build 없이 실행하거나 pnpm build 를 먼저 실행하세요');
    term.stepLine(3, TOTAL_PHASES, '빌드', mustBuild ? '완료' : '생략', formatMmSs(phaseSec()));
    markPhase('P2', '빌드', mustBuild ? 'OK' : 'SKIPPED');
    checkAbort(signal);

    // ═══ [4/6] 서버 기동 ═══
    currentPhase = 'P3 서버 기동';
    phaseStartMs = Date.now();
    boot = await bootServers({ ctx, run, ports, supervisor, redactor, term, dbPath, parentEnv, plan: fullRt ? { voiceInput: fullRt.plan.voiceInput, localLlm: fullRt.plan.localLlm } : undefined, hooks: { bots: () => stageBots, facts: () => stageFacts, motion: opts.mode === 'headless-check' ? 'off' : 'on', ...(fullRt ? fullServerHooks(fullRt) : {}) } });
    stageFacts.latencyP95 = boot.latency ? Math.round(boot.latency.p95Ms) : null;
    stageFacts.device = boot.mlDevice ?? stageFacts.device;
    stageFacts.governance = boot.governance;
    stageFacts.egressAllowed = boot.governance === 'ON' ? (fullRt ? egressNames(fullRt.plan).length : 1) : 0;
    stageFacts.network = preflight.offline ? 'closed' : 'open';
    stageFacts.gpuPresent = preflight.items.some((i) => i.id === 'PC-12' && Array.isArray(i.data?.gpu) && (i.data?.gpu as unknown[]).length > 0);
    term.stepLine(4, TOTAL_PHASES, '서버 기동', '완료', formatMmSs(phaseSec()));
    markPhase('P3', '서버 기동');
    saveState({ phase: 'booted' });

    // ═══ [5/6] 데모 데이터 ═══
    currentPhase = 'P4 데모 데이터';
    phaseStartMs = Date.now();
    const dataInput: DataPhaseInput = { paths, run, ports, dbPath, redactor, term, signal, skipHistorySchedule: opts.noHistorySchedule };
    dataResult = await runDataPhase(dataInput);
    if (fullRt) {
      // [DT-2] 풀 투어 추가 데이터: 챗봇 A 음성 설정 · "기록만" 규칙 · 챗봇 D(선제 안내) — 10분판 데이터는 건드리지 않는다
      await createFullExtras({ apiBase: dataResult.apiBase, siteOrigin: dataResult.siteOrigin, db: dataResult.db, redactor, log: (m) => term.detail(m), signal, skipHistorySchedule: opts.noHistorySchedule, fixtureCsvPath: '' }, dataResult.data, { voiceInput: fullRt.plan.voiceInput !== 'off' });
    }
    await registerStageBots(dataResult, stageBots);
    const secrets = dataResult.data.credentials;
    for (const k of Object.keys(secrets) as Array<keyof typeof secrets>) redactor.register(secrets[k].password);
    saveState({ phase: 'data', state: { dataset: dataResult.data.ids } });
    if (fullRt) {
      // [DT-2] P4-L(생성 자식 · 사전 생성 · 해제) -> P4-V(음성 자식 · 게이트) — 3050 순차 적재 원칙
      await runModelPrepare({ rt: fullRt, term, paths, run, ports, supervisor, parentEnv, redactor, data: dataResult, signal, opts, embed: { modelId: boot.mlModelId ?? '?', device: boot.mlDevice ?? 'cpu', port: ports.mlWorker } });
      stageFacts.plan = buildStagePlan(fullRt);
      stageFacts.gpu = fullRt.gpuFacts;
      stageFacts.gpuActive = fullRt.gpuActive;
      stageFacts.egressAllowed = boot.governance === 'ON' ? egressNames(fullRt.plan).length : 0;
    }
    term.stepLine(5, TOTAL_PHASES, fullRt ? '데모 데이터 · 모델 준비' : '데모 데이터', '완료', formatMmSs(phaseSec()));
    markPhase('P4', fullRt ? '데모 데이터 · 모델 준비' : '데모 데이터');

    // ═══ [6/6] 보정 · 예열 ═══
    currentPhase = 'P5 보정 · 예열';
    phaseStartMs = Date.now();
    await runCalibration(dataInput, dataResult);
    if (fullRt) {
      // [DT-2] G-DX-3: 챗봇 D 공개 설정에 선제 규칙이 실려 나오는지(기본 투어 장면 — 실패하면 양쪽 모두 종료 2)
      const g3 = await gateDx3({ apiBase: dataResult.apiBase, slug: dataResult.data.ids.D?.slug ?? '', origin: dataResult.siteOrigin });
      dataResult.calibration.gates.push({ id: 'G-DX-3', scene: '장면 9', ok: g3.ok, detail: g3.detail });
      dataResult.calibration.ok = dataResult.calibration.ok && g3.ok;
      fullRt.proactiveRule = g3.rule;
    }
    for (const g of dataResult.calibration.gates) term.line(g.ok ? 'pass' : 'error', `보정 ${g.id}(${g.scene}): ${g.detail}`, g.ok ? {} : { why: '데모 데이터 문구가 공연 기대와 맞지 않습니다', how: 'src/data/dataset.ts의 예문·질문 문구를 조정하세요(데이터 보정 필요)' });
    if (!dataResult.calibration.ok) throw new PrepareError('데이터 보정 게이트가 실패했습니다(데이터 보정 필요)', '의미 매칭 점수가 장면에 필요한 구간(확정/폴백)에 들지 않았습니다', '보정 게이트 실패 줄의 문장과 점수를 보고 예문을 조정하세요');
    term.stepLine(6, TOTAL_PHASES, '보정 · 예열 · 선택자 점검', '완료', formatMmSs(phaseSec()));
    markPhase('P5', '보정 · 예열');
    if (dataResult.data.ids.C.historySchedule) {
      currentPhase = '이력 예약 실행 대기';
      phaseStartMs = Date.now();
      try {
        await waitHistorySchedule(dataInput, dataResult);
        markPhase('PW', '이력 예약 실행 대기');
      } catch (e) {
        markPhase('PW', '이력 예약 실행 대기', 'FAILED');
        if (e instanceof WaitAbortedError || signal.aborted) throw e;
        // 설계 §5 "대기": C-1 실패는 경고 — 장면 5 대체 화면이 "실패 이력"이 되고 보고서에 표기된다
        term.line('warn', `이력 예약 실행을 확인하지 못했습니다: ${(e as Error).message}`, { why: '준비 단계의 이력 예약이 시간 안에 실행되지 않았습니다', how: '장면 5의 예약 단계는 대체 화면으로 진행되며 보고서에 표기됩니다' });
      }
    }
    saveState({ phase: 'data', state: { dataset: dataResult.data.ids } });
    checkAbort(signal);

    // ═══ 공연(시나리오 실행) — 서버 유지 모드(--prepare-only)에서는 건너뛴다 ═══
    if (!opts.prepareOnly) {
      saveState({ phase: 'show' });
      const sessions = dataResult.data.sessions;
      const keyMode: 'keys' | 'lines' = process.stdin.isTTY ? 'keys' : 'lines';
      if (opts.mode === 'visible' && !opts.unattendedVisibleForTest) {
        control = new PresenterControl({
          mode: keyMode,
          input: process.stdin as unknown as PresenterInput,
          say: (kind, text) => term.line(kind === 'warn' ? 'warn' : 'info', kind === 'confirm' ? `[확인] ${text}` : text),
          onQuit: () => ctx.abort?.(),
          onInterrupt: () => ctx.abort?.(),
        });
      }
      const facts: RunFacts = {
        device: stageFacts.device,
        gpuHidden: stageFacts.gpuHidden,
        governance: boot.governance,
        externalAddresses: 0,
        embeddingTimeoutMs: boot.embeddingTimeoutMs,
        embeddingTimeoutDefault: 300,
        governanceFallback: boot.governanceFallback,
        ...(fullRt ? { gpuActive: fullRt.gpuActive } : {}),
      };
      showOutcome = await runShow({
        plan: fullRt?.plan ?? defaultPlan(preset.id, opts.mode),
        resolved: fullRt?.resolved ?? null,
        full: fullRt ? { rt: fullRt, supervisor } : undefined,
        opts,
        preset,
        run,
        ports,
        ids: dataResult.data.ids,
        api: sessions,
        term,
        signal,
        state: stateBase.state,
        facts,
        stageFacts,
        credentials: dataResult.data.credentials,
        fixtureCsv: join(paths.harness, 'fixtures', 'utterances-demo.csv'),
        recordVideo: preflight.videoAvailable && !opts.noVideo,
        control,
        keyMode,
        summary: {
          presetId: preset.id,
          browser: opts.browser,
          browserVersion: preflight.browserInfo.version,
          viewport: opts.viewport,
          device: stageFacts.device,
          latencyP95: stageFacts.latencyP95,
          embeddingTimeoutMs: boot.embeddingTimeoutMs,
          embeddingTimeoutDefault: 300,
          externalAddresses: 0,
          network: stageFacts.network,
          governance: boot.governance,
          prepareSec: prepare.reduce((n, p) => n + p.sec, 0),
        },
      });
      const res = showOutcome.scenario;
      if (res) {
        const c = { pass: 0, fail: 0, skip: 0, fallback: 0 };
        for (const r of res.steps) c[r.status === 'PASS' ? 'pass' : r.status === 'FAIL' ? 'fail' : r.status === 'SKIPPED' ? 'skip' : 'fallback']++;
        showCounts = { ...c, showSec: res.showSec };
        if (c.fail > 0) exitCode = EXIT.FAILED;
        const blocked = showOutcome.session?.blockedSummary() ?? [];
        if (blocked.length > 0) term.line('warn', `브라우저가 외부 주소로 보내려던 요청을 ${blocked.reduce((n, b) => n + b.count, 0)}건 막았습니다: ${blocked.map((b) => `${b.host} x${b.count}`).join(', ')}`, { why: '관리 콘솔이 외부 글꼴 등을 요청합니다(결함 후보 DHX-1)', how: '서버가 외부로 보낸 것은 아니며 보고서 외부 송신 점검표 "브라우저" 칸에 기록됩니다' });
      }
      saveState({ phase: 'show', completedSegments: showOutcome.executedSegments.map((s) => s.key), state: stateBase.state });
    }

    printBootSummary(term, ports, boot, preflight);

    // 서버 유지 모드: 정지 요청이나 Ctrl+C까지 대기
    if (opts.prepareOnly || opts.noTeardown) {
      saveState({ serversKept: true, note: '서버 유지 중' });
      term.line('info', `서버를 유지합니다. 정리: Ctrl+C 또는 다른 터미널에서  pnpm demo -- --stop ${run.runId}`);
      await waitForStop(run, signal);
      saveState({ serversKept: false });
    }
  } catch (e) {
    if (e instanceof AbortedError || e instanceof WaitAbortedError || signal.aborted) {
      exitCode = EXIT.ABORTED;
      term.line('warn', '중단 요청을 받았습니다. 정리를 시작합니다');
    } else if (e instanceof PrepareError) {
      exitCode = EXIT.PREPARE_FAILED;
      prepareFailure = { phase: currentPhase, message: e.message, why: e.why, how: e.how };
      term.line('error', e.message, { why: e.why, how: e.how });
    } else if (e instanceof ProcessDiedError) {
      exitCode = EXIT.PREPARE_FAILED;
      prepareFailure = { phase: currentPhase, message: e.message, why: '자식 프로세스가 기동 중에 종료했습니다', how: `로그 ${run.logs} 의 api.log·ml-worker.log 를 확인하세요` };
      term.line('error', e.message, { why: '자식 프로세스가 기동 중에 종료했습니다', how: `로그 ${run.logs} 의 api.log·ml-worker.log 를 확인하세요` });
    } else {
      exitCode = EXIT.PREPARE_FAILED;
      prepareFailure = { phase: currentPhase, message: `예상하지 못한 오류: ${(e as Error).message}`, why: '처리되지 않은 예외가 났습니다', how: `로그 ${join(run.logs, 'harness.log')} 를 확인하고 다시 실행하세요` };
      term.line('error', `예상하지 못한 오류: ${(e as Error).message}`, { why: '준비 또는 공연 단계에서 처리되지 않은 예외가 났습니다', how: `로그 ${join(run.logs, 'harness.log')} 를 확인하고 다시 실행하세요` });
      term.detail((e as Error).stack ?? '');
    }
  }

  // ═══ 정리 ═══
  // 각 정리 호출은 개별로 감싼다(L-1) — 하나가 던져도 Ollama 해제·자식 정리는 반드시 실행된다
  const guard = <T>(label: string, fn: () => T | Promise<T>, fallback: T): Promise<T> =>
    guarded(fn, fallback, (e) =>
      term.line('warn', `${label} 중 오류: ${e.message}`, { why: '정리 단계의 한 호출이 실패했습니다(나머지 정리는 계속합니다)', how: fullRt?.ollamaLoadedByHarness ? '남은 모델이 있으면 ollama stop <모델 이름> 으로 내리세요' : '로그 harness.log를 확인하세요' }),
    );
  await guard('화면 제어 해제', () => control?.detach(), undefined);
  const blockedSummary = await guard('차단 요약 수집', () => showOutcome?.session?.blockedSummary() ?? [], [] as ReturnType<NonNullable<NonNullable<typeof showOutcome>['session']>['blockedSummary']>);
  await guard('브라우저 닫기', async () => {
    await showOutcome?.session?.close(); // 영상 파일은 컨텍스트를 닫아야 확정된다
  }, undefined);
  const videoPath = await guard('영상 확정', () => (showOutcome?.videoRecorded ? finalizeVideo(run.video) : null), null);
  await guard('데이터베이스 닫기', async () => {
    await dataResult?.db.close();
  }, undefined);
  // [DT-2] 하네스가 적재한 Ollama 모델 해제(실패해도 경고만 — Ollama 서비스는 종료하지 않는다) + VRAM 관찰기 종료
  if (fullRt) await fullCleanup(fullRt, (m) => term.line('warn', m)).catch((e) => term.line('warn', `풀 투어 정리 중 오류: ${(e as Error).message}`));
  const teardown = await supervisor.teardown(ports).catch((e): TeardownReport => {
    term.line('warn', `정리 중 오류: ${(e as Error).message}`);
    return { processesLeft: -1, portsFreed: false, busyPorts: [], killedChildren: [] };
  });
  process.off('exit', onExit);
  // [DT-2] 음성 원본 저장 0 확인(정리 직전 매직 바이트 검사 — 휴리스틱) · 서버 로그에 기대 문장·전사 글자 0
  const audioScan = fullRt && fullRt.plan.voiceInput !== 'off' ? scanAudioTraces(run.dir, [fullRt.record.speech?.expected ?? '', fullRt.record.speech?.transcript ?? '', fullRt.record.speech?.gateTranscript ?? '']) : undefined;
  if (audioScan && (audioScan.hits.length > 0 || audioScan.logHits.length > 0)) term.line('warn', `음성 원본 흔적이 발견됐습니다: ${[...audioScan.hits, ...audioScan.logHits].slice(0, 3).join(' · ')}`, { why: '실행 폴더·서버 로그에 음성 파일 시그니처 또는 인식 글자가 남았습니다(결함 후보)', how: '해당 파일을 확인하고 bug-triage로 등록하세요' });
  const devDbAfter = fileFingerprint(paths.devDb);
  const devDbBefore = preflight?.devDbBefore;
  const devDbUnchanged = !devDbBefore || (devDbBefore.exists === devDbAfter.exists && devDbBefore.size === devDbAfter.size && devDbBefore.mtimeMs === devDbAfter.mtimeMs);
  if (teardown.processesLeft !== 0 || !teardown.portsFreed) {
    term.line('warn', `정리가 끝나지 않았습니다(남은 프로세스 ${teardown.processesLeft}개, 점유 포트 ${teardown.busyPorts.join(' ') || '없음'})`, { why: '프로세스 종료가 지연됐거나 표식이 남았습니다', how: '다음 실행이 표식을 확인해 정리합니다. 급하면 pnpm demo -- --stop latest' });
  }
  if (!devDbUnchanged) exitCode = Math.max(exitCode, EXIT.PREPARE_FAILED);
  saveState({
    phase: exitCode === EXIT.OK ? 'done' : exitCode === EXIT.ABORTED ? 'aborted' : 'failed',
    note: `정리: 남은 프로세스 ${teardown.processesLeft}개 / 포트 해제 ${teardown.portsFreed} / 개발 DB 변경 ${devDbUnchanged ? '없음' : '있음!'}`,
  });

  // ═══ 보고서(result.json · index.html · summary.md · customer.html) — 실패해도 종료 코드에는 반영하지 않는다(설계 §5) ═══
  const reportDir = join(run.dir, 'report');
  let reportOk = false;
  try {
    reportOk = writeRunReport({ ctx, run, redactor, preflight, boot, dataResult, showOutcome, blockedSummary, exitCode, startedAt, prepare, prepareFailure, teardown, devDbUnchanged, videoPath, term, liveSchedule: stateBase.state.liveSchedule, opts, fullRt, audioScan });
  } catch (e) {
    term.line('warn', `보고서를 만들지 못했습니다: ${(e as Error).message}`, { why: '보고서 작성 단계의 오류입니다(공연 결과와 종료 코드에는 영향이 없습니다)', how: `로그 ${join(run.logs, 'harness.log')} 를 확인하세요` });
    term.detail((e as Error).stack ?? '');
  }
  const leaked = scanRunDirForSecrets(run.dir, redactor);
  if (leaked.length > 0) term.line('warn', `실행 폴더의 텍스트 파일 ${leaked.length}개에 비밀 값이 남아 있습니다: ${leaked.slice(0, 3).join(', ')}`, { why: '비밀 제거 경로를 지나지 않은 쓰기가 있습니다', how: '해당 파일을 지우고 이 결함을 보고하세요' });

  term.blank();
  term.rule('=');
  const title = exitCode === EXIT.OK ? (showCounts ? '모두 통과' : '기동·정리 확인 완료') : exitCode === EXIT.ABORTED ? '중단됨' : exitCode === EXIT.FAILED ? '일부 실패' : '준비 실패';
  term.text(`시연 결과  ${title}   총 소요 ${formatMmSs((Date.now() - t0) / 1000)}`);
  if (showCounts) {
    const budget = showOutcome ? showOutcome.executedSegments.reduce((n, s) => n + s.budgetSec, 0) : 0;
    term.text(`통과 ${showCounts.pass}   실패 ${showCounts.fail}   건너뜀 ${showCounts.skip}   대체 ${showCounts.fallback}   ${opts.mode === 'visible' ? `시연 ${formatMmSs(showCounts.showSec)} (예산 ${formatMmSs(budget)})` : `점검 ${formatMmSs(showCounts.showSec)}`}`);
  }
  const steps = showOutcome?.scenario?.steps ?? [];
  const skippedList = steps.filter((s) => s.status === 'SKIPPED');
  if (skippedList.length > 0) term.text(`건너뜀: ${skippedList.map((s) => `${s.id} ${skipText(s.skipReason)}`).join(' - ')}`);
  for (const s of steps.filter((x) => x.status === 'FAIL')) {
    term.line('fail', `${s.id} ${s.title} (${s.core ? '핵심' : '생략 가능'}) - ${s.failure?.kind}`, { why: s.failure?.message, how: `구간만 다시 보려면  pnpm demo -- --only ${s.segment}` });
  }
  for (const s of steps.filter((x) => x.status === 'FALLBACK')) term.line('fallback', `${s.id} ${s.title} - 준비된 결과로 대신 보여 드렸습니다`);
  if (fullRt) {
    term.text(`구성  풀 투어 - 장면 ${fullRt.resolved.sceneCount}개 - 켠 옵션 ${fullRt.plan.voiceInput === 'real' ? `음성 입력(${fullRt.plan.sttDevice === 'cuda' ? 'GPU' : 'CPU'})` : fullRt.plan.voiceInput === 'mock' ? '음성 입력(모의)' : '음성 입력 없음'} / ${fullRt.plan.localLlm ? '사내 생성 켬' : '사내 생성 없음'} / ${fullRt.plan.liveClustering ? '실시간 분석 켬' : '실시간 분석 없음'}`);
    const omitLines = [...fullRt.resolved.inactiveSegments.map((x) => x.reason.internal), ...fullRt.resolved.inactiveRows.filter((x) => !x.reason.hidden && !fullRt.resolved.inactiveSegments.some((sg) => sg.key === x.segment)).map((x) => `${x.stepId} ${x.reason.internal}`)];
    term.text(`생략한 장면  ${[...new Set(omitLines)].join(' / ') || '없음'}`);
  }
  term.text(`정리: 남은 프로세스 ${teardown.processesLeft}개 / 포트 ${teardown.portsFreed ? '해제' : '점유 중'} / 개발 DB ${devDbUnchanged ? '변경 없음' : '변경됨(확인 필요)'}`);
  if (reportOk) term.text(`보고서  "${join(reportDir, 'index.html')}"`);
  term.text(`실행 폴더 "${run.dir}"`);
  term.text(`종료 코드 ${exitCode}`);
  term.rule('=');
  // 보이는 시연: 정리 뒤 보고서 폴더를 탐색기로 연다(요구사항 S-1) — 열기 실패는 주의 한 줄(종료 코드 불변)
  if (reportOk && opts.mode === 'visible' && !opts.unattendedVisibleForTest && term.isInteractive && exitCode !== EXIT.ABORTED) {
    const r = openFolder(reportDir);
    if (!r.ok) term.line('warn', `보고서 폴더를 열지 못했습니다: ${r.message}`, { why: '탐색기를 띄우지 못했습니다', how: '위 경로를 직접 여세요' });
  }
  return exitCode;
}

const SKIP_LABEL: Record<string, string> = { TIME: '시간 부족', PRESENTER: '진행자 선택', OPTION: '옵션', DEPENDENCY: '선행 실패', NO_BROWSER: '브라우저 없음' };
function skipText(r: string | undefined): string {
  return r ? (SKIP_LABEL[r] ?? r) : '';
}

/** 탐색기로 폴더를 연다(실패는 호출자가 안내만 한다). */
function openFolder(dir: string): { ok: boolean; message: string } {
  try {
    const child = spawn(process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open', [dir], { detached: true, stdio: 'ignore', shell: false });
    child.on('error', () => undefined);
    child.unref();
    return { ok: true, message: '' };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

interface ReportArgs {
  ctx: RunContext;
  run: RunPaths;
  redactor: Redactor;
  preflight: PreflightReport | null;
  boot: BootResult | null;
  dataResult: DataPhaseResult | null;
  showOutcome: ShowOutcome | null;
  blockedSummary: Array<{ host: string; count: number; firstStepId: string | null }>;
  exitCode: number;
  startedAt: Date;
  prepare: PrepareRow[];
  prepareFailure?: { phase: string; message: string; why?: string; how?: string };
  teardown: TeardownReport;
  devDbUnchanged: boolean;
  videoPath: string | null;
  term: Terminal;
  liveSchedule?: LiveScheduleState;
  opts: CliOptions;
  /** [DT-2] 풀 투어 실행 상태(10분판은 null). */
  fullRt: FullRuntime | null;
  audioScan?: { scannedFiles: number; hits: string[]; logHits: string[] };
}

/** 보고서 입력을 모아 result.json · HTML · 마크다운 · VTT · GIF를 쓴다. 쓴 파일이 있으면 true. */
function writeRunReport(a: ReportArgs): boolean {
  const { ctx, run, redactor, preflight, boot, dataResult, showOutcome, opts } = a;
  const cpuList = cpus();
  const gpuLines = preflight?.items.find((i) => i.id === 'PC-12')?.data?.gpu as string[] | undefined;
  const commitItem = preflight?.items.find((i) => i.id === 'PC-13')?.data as { sha?: string; dirty?: boolean } | undefined;
  const timeline = showOutcome?.timeline ?? null;
  // VTT(영상이 녹화된 실행만 — 영상 길이 = 공연 시간 ± 10초)
  let vttPath: string | null = null;
  if (a.videoPath && timeline && showOutcome?.showEndedAtMs) {
    writeFileSync(join(run.video, 'show.vtt'), redactor.redact(timeline.build(showOutcome.showEndedAtMs)), 'utf8');
    vttPath = 'video/show.vtt';
  }
  const videoReason =
    opts.mode !== 'visible' ? '무인 점검(영상은 보이는 시연에서만 만듭니다)' : opts.noVideo ? '--no-video 옵션' : !preflight?.videoAvailable ? '영상 인코더 없음(PC-6)' : !showOutcome?.session ? '공연을 시작하지 못함' : a.videoPath ? null : '영상 파일을 찾지 못함';
  const removedKeys = (): string[] => {
    try {
      const m = /isolate[^\n]*|삭제한 키[^\n]*/i.exec(readFileSync(join(run.logs, 'api.log'), 'utf8'));
      return m ? [m[0].slice(0, 200)] : [];
    } catch {
      return [];
    }
  };
  const lat = boot?.latency;
  const input: BuildInput = {
    runId: run.runId,
    presetId: ctx.preset.id,
    mode: opts.mode,
    exitCode: a.exitCode,
    startedAt: isoWithOffset(a.startedAt),
    showStartedAt: showOutcome?.showStartedAt ? isoWithOffset(showOutcome.showStartedAt) : null,
    endedAt: isoWithOffset(new Date()),
    prepareSec: a.prepare.reduce((n, p) => n + p.sec, 0),
    machine: {
      os: `${osType()} ${osRelease()}`,
      cpu: (cpuList[0]?.model ?? '확인 못함').trim(),
      cores: cpuList.length,
      ramGb: Math.round((totalmem() / 2 ** 30) * 10) / 10,
      freeRamGb: Math.round((freemem() / 2 ** 30) * 10) / 10,
      gpu: gpuLines && gpuLines.length > 0 ? gpuLines[0].replace(/\s*\(UUID:[^)]*\)/i, '').replace(/^GPU \d+:\s*/i, '') : '없음',
    },
    commit: { sha: commitItem?.sha ?? null, dirty: commitItem?.dirty ?? null },
    browser: { kind: opts.browser, version: preflight?.browserInfo.version ?? null, playwright: playwrightVersion(), video: Boolean(a.videoPath) },
    viewport: opts.viewport,
    latency:
      lat && boot
        ? { samples: lat.samples, p50Ms: lat.p50Ms, p95Ms: lat.p95Ms, decidedTimeoutMs: boot.embeddingTimeoutMs, source: opts.embeddingTimeoutMs !== null ? 'manual' : 'measured', rounds: lat.rounds.map((r) => ({ p50Ms: r.p50Ms, p95Ms: r.p95Ms })) }
        : null,
    overrides: boot?.overrides ?? [],
    embeddingUrl: `127.0.0.1:${portsFor(opts.portOffset).mlWorker}`,
    blocked: a.blockedSummary,
    network: { offline: preflight ? preflight.offline : null, checkedAt: preflight ? isoWithOffset(a.startedAt) : null },
    scenario: showOutcome?.scenario ?? null,
    segments: showOutcome?.executedSegments ?? [],
    skipOptionIds: opts.skip,
    dataset: dataResult ? dataResult.data.ids.counts : null,
    calibration: [...(dataResult?.calibration.gates ?? []), ...(a.fullRt?.gates ?? [])],
    calibrated: Boolean(dataResult?.data.ids.calibrated),
    teardown: { processesLeft: a.teardown.processesLeft, portsFreed: a.teardown.portsFreed, devDbUnchanged: a.devDbUnchanged },
    prepare: a.prepare.map((p) => ({ id: p.id, name: p.name, sec: Math.round(p.sec * 10) / 10, status: p.status })),
    prepareFailure: a.prepareFailure,
    media: { video: a.videoPath, videoReason, vtt: vttPath, gifs: [] },
    warnings: showOutcome?.scenario?.warnings ?? [],
    liveSchedule: a.liveSchedule,
    governance: boot ? { mode: boot.governance, fallback: boot.governanceFallback, logLine: boot.governanceLogLine } : undefined,
    envKeyNames: preflight ? { blockedApi: preflight.envKeyNames.api, blockedMlWorker: preflight.envKeyNames.mlWorker, removedByPreload: removedKeys() } : undefined,
    customerCopy: opts.customerCopy,
    full: a.fullRt ? buildFullReportInput(a.fullRt, showOutcome?.scenario ?? null, showOutcome ? { segmentStarts: showOutcome.segmentStarts, showEndedAtMs: showOutcome.showEndedAtMs } : null, a.audioScan) : undefined,
  };
  const result = buildResult(input);
  const tails: Record<string, string[]> = {};
  for (const name of ['api', 'ml-worker', 'harness', 'browser-console']) {
    try {
      const lines = readFileSync(join(run.logs, `${name}.log`), 'utf8').split(/\r?\n/).filter(Boolean);
      tails[name] = lines.slice(-200);
    } catch {
      /* 로그 없음 */
    }
  }
  const out = writeReport({ run, result, gifClips: showOutcome?.scenario?.gifClips ?? [], redact: (s) => redactor.redact(s), logTails: tails, customerCopy: opts.customerCopy });
  for (const e of out.errors) a.term.line('warn', e);
  return out.files.length > 0;
}

// ════════════════════════════════════════════════════════════════════════════
// P3 기동
// ════════════════════════════════════════════════════════════════════════════
interface BootArgs {
  ctx: RunContext;
  run: RunPaths;
  ports: Ports;
  supervisor: Supervisor;
  redactor: Redactor;
  term: Terminal;
  dbPath: string;
  parentEnv: NodeJS.ProcessEnv;
  hooks: ServerHooks;
  /** [DT-2] 풀 투어 계획(없으면 10분판 — API 환경이 DT-1과 바이트 동일). */
  plan?: { voiceInput: 'off' | 'real' | 'mock'; localLlm: boolean };
}

async function bootServers(a: BootArgs): Promise<BootResult> {
  const { ctx, run, ports, supervisor, redactor, term, dbPath, parentEnv } = a;
  const { opts, paths, signal } = ctx;
  const redact = (s: string) => redactor.redact(s);
  const encryptionKeys = opts.fieldEncryption ? `demo1:${randomBytes(32).toString('base64')}` : undefined;
  if (encryptionKeys) redactor.register(encryptionKeys);

  // ml-worker
  const startMl = async (revision?: string) => {
    const ml = buildMlEnv({ parentEnv, ports, modelRevision: revision });
    await supervisor.startChild({
      name: 'ml-worker',
      command: paths.venvPython,
      args: ['-X', `cbdemo_run=${run.runId}`, '-m', 'ml_worker.app'],
      cwd: run.mlWorkerCwd,
      env: ml.env,
      logFile: join(run.logs, 'ml-worker.log'),
      marker: `cbdemo_run=${run.runId}`,
      redact,
    });
    return ml.overrides;
  };
  const startApi = async (timeoutMs: number, governance: 'ON' | 'OFF') => {
    const api = buildApiEnv({ parentEnv, runDir: run.dir, dbPath, ports, embeddingTimeoutMs: timeoutMs, encryptionKeys, governanceMode: governance, apiPackageJson: paths.apiPackageJson, nodePath: join(paths.repo, 'node_modules', '.pnpm', 'node_modules'), plan: a.plan });
    await supervisor.startChild({
      name: 'api',
      command: process.execPath,
      args: [`--title=cbdemo-api-${run.runId}`, '-r', paths.isolateScript, paths.apiMain],
      cwd: paths.apiDir,
      env: api.env,
      logFile: join(run.logs, 'api.log'),
      marker: `cbdemo-api-${run.runId}`,
      redact,
    });
    return api.overrides;
  };

  term.text('문장 분석 서버(ml-worker)와 API를 기동합니다...');
  const mlOverrides = await startMl();
  let timeoutMs = opts.embeddingTimeoutMs ?? 300;
  let governance: 'ON' | 'OFF' = 'ON';
  let governanceFallback = false;
  let apiOverrides = await startApi(timeoutMs, governance);

  const servers = await startHarnessServers(paths, ports, a.hooks);
  supervisor.attachServers(servers);

  const apiHealth = async () => {
    const api = supervisor.find('api')!;
    await waitHealthy({ url: `http://127.0.0.1:${ports.api}/api/health`, label: 'API', timeoutMs: TIMEOUTS.apiHealthMs, hasExited: () => api.exited, signal });
  };
  try {
    await apiHealth();
  } catch (e) {
    if (e instanceof WaitAbortedError || signal.aborted) throw e;
    // EX-DH-12: 거버넌스 ON 기동 실패 -> OFF로 1회 재기동(보고서·시작 자막에 표기). 거버넌스와 무관한 기동 실패(모듈 누락 등)는 재시도하지 않는다.
    const apiProc = supervisor.find('api');
    const tailLines = apiProc?.tail(200) ?? [];
    if (!looksLikeGovernanceFailure(tailLines)) {
      throw new PrepareError(`API 기동 실패: ${summarizeFailure(tailLines) || (e as Error).message}`, 'API 자식 프로세스가 헬스 확인 전에 종료했거나 시간 안에 응답하지 않았습니다', `로그 ${join(run.logs, 'api.log')} 를 확인하세요`);
    }
    term.line('warn', '거버넌스 모드 ON으로 API가 기동하지 못했습니다. OFF로 한 번 다시 기동합니다', { why: summarizeFailure(tailLines), how: '이번 시연은 거버넌스 모드를 끈 상태로 진행되며 보고서에 표기됩니다' });
    await supervisor.stopChild('api');
    governance = 'OFF';
    governanceFallback = true;
    apiOverrides = await startApi(timeoutMs, governance);
    await apiHealth();
  }

  // 정적 서버 응답 확인(+ 콘솔 역프록시 경유 API 헬스)
  const staticChecks: Array<[string, string]> = [
    ['콘솔', `http://127.0.0.1:${ports.console}/`],
    ['콘솔 역프록시(/api/health)', `http://127.0.0.1:${ports.console}/api/health`],
    ['위젯(/widget.js)', `http://127.0.0.1:${ports.widget}/widget.js`],
    ['무대(/stage)', `http://127.0.0.1:${ports.stage}/stage`],
  ];
  for (const [label, url] of staticChecks) {
    await waitHealthy({ url, label, timeoutMs: TIMEOUTS.staticHealthMs, signal });
  }

  // ml-worker 예열 대기
  const ml = supervisor.find('ml-worker')!;
  term.text('문장 분석 모델 적재를 기다립니다(오프라인 모드)...');
  try {
    await waitHealthy({
      url: `http://127.0.0.1:${ports.mlWorker}/health`,
      label: 'ml-worker',
      timeoutMs: TIMEOUTS.mlWorkerWarmupMs,
      hasExited: () => ml.exited,
      accept: (r) => r.ok && (r.body as { warmedUp?: boolean } | null)?.warmedUp === true,
      signal,
    });
  } catch (e) {
    if (e instanceof WaitAbortedError || signal.aborted) throw e;
    // 설계 §21.2-1 폴백: refs/main 커밋 해시를 리비전으로 지정해 1회 재시도
    const hash = readRefsMain(hfHubDir(parentEnv));
    if (hash) {
      term.line('warn', '모델 오프라인 로드에 실패했습니다. refs/main 커밋 해시를 리비전으로 지정해 다시 시도합니다', { why: ml.tail(4).join(' / ') || (e as Error).message, how: '공개표에 "오프라인 폴백: 리비전 지정"으로 기록됩니다' });
      await supervisor.stopChild('ml-worker');
      await startMl(hash);
      await waitHealthy({
        url: `http://127.0.0.1:${ports.mlWorker}/health`,
        label: 'ml-worker(리비전 지정)',
        timeoutMs: TIMEOUTS.mlWorkerWarmupMs,
        hasExited: () => supervisor.find('ml-worker')!.exited,
        accept: (r) => r.ok && (r.body as { warmedUp?: boolean } | null)?.warmedUp === true,
        signal,
      });
    } else throw e;
  }
  const mlHealth = await httpJson<{ modelId?: string; device?: string; dimension?: number }>(`http://127.0.0.1:${ports.mlWorker}/health`);
  term.line('pass', `문장 분석 서버 준비 - 모델 ${mlHealth.body?.modelId ?? '?'} / 장치 ${mlHealth.body?.device ?? '?'} / ${mlHealth.body?.dimension ?? '?'}차원`);

  // 단건 지연 실측과 결정(설계 §14)
  term.text('단건 질의 지연을 실측합니다(20건, 앞 3건 제외)...');
  const latency = await measureEmbedLatency({ baseUrl: `http://127.0.0.1:${ports.mlWorker}` });
  const decision = decideEmbeddingTimeout(latency.p95Ms);
  const manual = opts.embeddingTimeoutMs !== null;
  term.line(
    decision.action === 'confirm' ? 'warn' : 'pass',
    `단건 지연 P50 ${latency.p50Ms.toFixed(0)}ms / P95 ${latency.p95Ms.toFixed(0)}ms (측정 ${latency.rounds.length}회)` +
      (manual ? ` - 수동 지정 ${timeoutMs}ms 사용` : ` - 대기 시간 ${decision.timeoutMs}ms ${decision.action === 'keep' ? '유지' : '로 조정'}`),
    decision.action === 'confirm' && !manual ? { why: 'P95가 1000ms를 넘어 의미 매칭 장면이 규칙 매칭으로 조용히 저하될 수 있습니다', how: '다른 프로그램을 닫고 다시 실행하거나 PC 사양을 확인하세요(대기 시간은 2000ms로 늘림)' } : {},
  );
  if (!manual && decision.timeoutMs !== timeoutMs) {
    term.text(`API를 새 대기 시간(${decision.timeoutMs}ms)으로 다시 기동합니다...`);
    await supervisor.stopChild('api');
    timeoutMs = decision.timeoutMs;
    apiOverrides = await startApi(timeoutMs, governance);
    await apiHealth();
  }

  // 거버넌스 기동 로그 줄(외부 송신 점검표 근거)
  let governanceLogLine: string | null = null;
  try {
    const m = /^.*데이터 거버넌스 모드=.*$/m.exec(readFileSync(join(run.logs, 'api.log'), 'utf8'));
    governanceLogLine = m ? m[0].trim() : null;
  } catch {
    /* 로그 없음 */
  }
  if (governanceLogLine) term.detail(governanceLogLine);

  return {
    supervisor,
    servers,
    latency,
    decision: manual ? { timeoutMs, action: 'keep' } : decision,
    embeddingTimeoutMs: timeoutMs,
    governance,
    governanceFallback,
    overrides: [...apiOverrides, ...mlOverrides],
    governanceLogLine,
    mlDevice: mlHealth.body?.device ?? null,
    mlModelId: mlHealth.body?.modelId ?? null,
  };
}

/** 기동 실패 로그가 거버넌스 모드 검사(저장 위치·출구·키) 때문인지 판정(EX-DH-12). */
export function looksLikeGovernanceFailure(lines: readonly string[]): boolean {
  return lines.some((l) => /거버넌스|DATA_(RESIDENCY|EGRESS|GOVERNANCE|ENCRYPTION)|저장 위치|출구/.test(l));
}

/** 로그 꼬리에서 사람이 읽을 한 줄 — 첫 오류 줄(없으면 마지막 비어 있지 않은 줄). */
export function summarizeFailure(lines: readonly string[]): string {
  const err = lines.find((l) => /\b\w*Error\b|오류|실패/.test(l) && l.trim().length > 0);
  const pick = err ?? [...lines].reverse().find((l) => l.trim().length > 0) ?? '';
  return pick.trim().slice(0, 160);
}

function printBootSummary(term: Terminal, ports: Ports, boot: BootResult, pre: PreflightReport): void {
  term.blank();
  term.text('기동 요약');
  for (const p of boot.supervisor.processes) term.text(`${p.spec.name.padEnd(10)} PID ${p.pid} ${p.isAlive() ? '실행 중' : '종료됨'}`, '  ');
  for (const k of Object.keys(ports) as Array<keyof Ports>) term.text(`${String(ports[k]).padEnd(6)} ${PORT_LABELS[k]}`, '  ');
  term.text(`거버넌스 모드 ${boot.governance}${boot.governanceFallback ? '(ON 기동 실패로 OFF 재기동)' : ''} / 증강 규칙 기반 / 외부망 ${pre.offline ? '차단됨' : '열림'}`, '  ');
  if (boot.latency) term.text(`단건 지연 P95 ${boot.latency.p95Ms.toFixed(0)}ms -> 대기 시간 ${boot.embeddingTimeoutMs}ms`, '  ');
}

// ════════════════════════════════════════════════════════════════════════════
// 서버 유지 대기 · --stop
// ════════════════════════════════════════════════════════════════════════════
async function waitForStop(run: RunPaths, signal: AbortSignal): Promise<void> {
  const requestFile = join(run.dir, STOP_REQUEST);
  while (!signal.aborted) {
    if (existsSync(requestFile)) return;
    await sleepMs(1000, signal);
  }
}

/** `--stop <runId|latest>` — 유지 중인 실행을 정리한다. 하네스가 살아 있으면 정지 요청 파일로 스스로 정리하게 하고, 없으면 표식 확인 후 직접 정리한다. */
export async function stopRun(opts: { runsDir: string; target: string; term: Terminal }): Promise<number> {
  const { runsDir, term } = opts;
  const ids = listRunIds(runsDir);
  const runId = opts.target === 'latest' ? ids[ids.length - 1] : ids.find((i) => i === opts.target);
  if (!runId) {
    term.line('error', `정리할 실행을 찾지 못했습니다: ${opts.target}`, { why: `${runsDir} 아래에 해당 실행 폴더가 없습니다`, how: '실행 폴더 이름(실행 ID)을 확인하세요' });
    return EXIT.PREPARE_FAILED;
  }
  const paths = runPathsFor(runsDir, runId);
  const requestFile = join(paths.dir, STOP_REQUEST);
  const pids = readPidsFile(paths.pidsFile);
  if (!pids) {
    term.line('warn', `${runId}에는 pids.json이 없어 정리할 프로세스 기록이 없습니다`);
    return EXIT.OK;
  }
  const ownerAlive = pids.harnessPid !== undefined && isHarnessAlive(pids.harnessPid);
  if (!ownerAlive) {
    if (pids.cleanedUp) {
      term.line('info', `${runId}은(는) 이미 정리됐습니다`);
      return EXIT.OK;
    }
    // 하네스가 이미 없다 — 표식 확인 후 직접 정리
    const reports = cleanupResidual(runsDir, { only: runId });
    const mine = reports.find((r) => r.runId === runId);
    term.line('pass', `${runId} 정리 완료(하네스 없음 - 표식 확인 후 직접 종료: ${mine?.killed.length ?? 0}개)`);
    if (mine && mine.skippedNoMarker.length > 0) term.line('warn', `PID ${mine.skippedNoMarker.join(', ')}는 표식이 달라 건드리지 않았습니다`, { why: 'PID가 다른 프로세스로 재사용됐을 수 있습니다', how: '필요하면 작업 관리자에서 직접 확인하세요' });
    return EXIT.OK;
  }
  // 살아 있는 하네스에게 정지 요청 — 하네스가 스스로 정리하고 끝나면 PID가 사라진다
  writeFileSync(requestFile, isoWithOffset(new Date()), 'utf8');
  term.line('info', `${runId}의 하네스(PID ${pids.harnessPid})에 정지를 요청했습니다(최대 15초 대기)`);
  for (let i = 0; i < 15; i++) {
    await sleepMs(1000);
    if (!isHarnessAlive(pids.harnessPid!)) {
      term.line('pass', `${runId} 정리 완료`);
      return EXIT.OK;
    }
  }
  // 응답 없는 하네스는 종료하고 자식은 표식 확인 후 정리
  term.line('warn', '하네스가 15초 안에 응답하지 않아 강제로 종료합니다', { why: '하네스가 정지 요청 파일을 읽지 못하고 있습니다', how: '다음 실행 전에  pnpm demo -- --stop latest  로 정리 결과를 확인하세요' });
  killTreeSync(pids.harnessPid!);
  const reports = cleanupResidual(runsDir, { only: runId, ignoreLiveOwner: true });
  term.line('pass', `${runId} 정리 완료(강제 종료 - 자식 ${reports[0]?.killed.length ?? 0}개 종료)`);
  return EXIT.OK;
}

