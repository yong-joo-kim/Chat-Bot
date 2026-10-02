// [5/6] 데모 데이터 + [6/6] 보정·예열(설계 §5 P4·P5) — 제품 API로 데이터셋을 만들고, 공연 전에 "될 장면인지" 확인한다.
import { join } from 'node:path';
import type { Ports, RepoPaths } from '../config';
import { runCalibrationGates, type CalibrationResult } from '../data/calibration';
import { DbDirect } from '../data/db-direct';
import { generateDataset, scheduleWithApproval, type GeneratedData } from '../data/generator';
import { withProactiveAttr } from '../data/generator-full';
import type { DatasetIds } from '../data/types';
import { ApiSession } from '../data/api-client';
import type { Terminal } from '../log/terminal';
import type { StageBotInfo } from '../servers/stage-server';
import type { RunPaths } from '../run/run-dir';
import type { Redactor } from '../util/redact';
import { waitFor } from '../util/wait-for';

export interface DataPhaseInput {
  paths: RepoPaths;
  run: RunPaths;
  ports: Ports;
  dbPath: string;
  redactor: Redactor;
  term: Terminal;
  signal: AbortSignal;
  skipHistorySchedule: boolean;
  /** 이력 예약 실행 완료를 기다릴지(기본 true — `--prepare-only`처럼 빨리 확인하고 싶을 때만 끈다). */
  waitHistorySchedule?: boolean;
}

export interface DataPhaseResult {
  data: GeneratedData;
  calibration: CalibrationResult;
  db: DbDirect;
  apiBase: string;
  siteOrigin: string;
  secs: { generate: number; calibrate: number; historyWait: number };
}

export async function runDataPhase(i: DataPhaseInput): Promise<DataPhaseResult> {
  const apiBase = `http://127.0.0.1:${i.ports.api}/api/v1`;
  const siteOrigin = `http://localhost:${i.ports.stage}`;
  const db = new DbDirect({ dbPath: i.dbPath, runDir: i.run.dir, devDbPath: i.paths.devDb, apiDir: i.paths.apiDir });
  const t0 = Date.now();
  const data = await generateDataset({
    apiBase,
    siteOrigin,
    db,
    redactor: i.redactor,
    log: (m) => i.term.detail(m),
    signal: i.signal,
    skipHistorySchedule: i.skipHistorySchedule,
    fixtureCsvPath: join(i.paths.harness, 'fixtures', 'utterances-demo.csv'),
  });
  const generateSec = (Date.now() - t0) / 1000;
  return { data, calibration: { ok: true, gates: [] }, db, apiBase, siteOrigin, secs: { generate: generateSec, calibrate: 0, historyWait: 0 } };
}

export async function runCalibration(i: DataPhaseInput, r: DataPhaseResult): Promise<void> {
  const t0 = Date.now();
  r.calibration = await runCalibrationGates({ data: r.data, apiBase: r.apiBase, siteOrigin: r.siteOrigin, log: (m) => i.term.detail(m) });
  r.data.ids.calibrated = true;
  r.secs.calibrate = (Date.now() - t0) / 1000;
}

/** 이력용 예약 C-1이 실행될 때까지 기다린 뒤, 라이브 예약용 v3를 스테이징에 올린다(설계 §5 "대기" 행). */
export async function waitHistorySchedule(i: DataPhaseInput, r: DataPhaseResult): Promise<boolean> {
  const sched = r.data.ids.C.historySchedule;
  if (!sched) return false;
  const admin1 = r.data.sessions.admin1;
  const at = new Date(sched.scheduledAt).getTime();
  const limitMs = Math.max(60_000, at - Date.now() + 5_000 + 60_000);
  const t0 = Date.now();
  i.term.text(`이력 예약 실행을 기다립니다(예약 ${sched.scheduledAt}, 상한 약 ${Math.ceil(limitMs / 60_000)}분)...`);
  let lastBeat = 0;
  try {
    await waitFor(
      async () => {
        // 긴 대기는 15초마다 남은 시간(추정)을 알린다 — 무한 대기처럼 보이지 않게(ui-spec §9.2)
        if (Date.now() - lastBeat >= 15_000) {
          lastBeat = Date.now();
          const left = Math.max(0, at - Date.now());
          i.term.line('progress', `이력 예약 실행 대기: 남은 시간 약 ${Math.floor(left / 60_000)}분 ${Math.floor((left % 60_000) / 1000)}초 (추정 - 상한 ${Math.ceil(limitMs / 60_000)}분)`);
        }
        const s = (await admin1.get(`/chatbots/${r.data.ids.C.id}/deploy-schedules/${sched.scheduleId}`)).body as { status?: string };
        if (s.status && !['PENDING', 'RUNNING', 'HELD'].includes(s.status)) return s.status;
        return false;
      },
      { timeoutMs: limitMs, intervalMs: 3000, label: '이력 예약 실행', signal: i.signal },
    );
  } catch (e) {
    r.secs.historyWait = (Date.now() - t0) / 1000;
    throw e;
  }
  r.secs.historyWait = (Date.now() - t0) / 1000;
  const st = (await admin1.get(`/chatbots/${r.data.ids.C.id}/deploy-schedules/${sched.scheduleId}`)).body as { status?: string };
  i.term.line(st.status === 'SUCCEEDED' || st.status === 'EXECUTED' || st.status === 'DONE' ? 'pass' : 'warn', `이력 예약 상태: ${st.status}`);
  await promoteLiveTarget(admin1, r.data.ids);
  return true;
}

/** 라이브 예약 C-2의 대상 v3: 운영이 v2로 바뀐 뒤 초안을 "12월 행사"로 고쳐 스테이징에 올린다. */
export async function promoteLiveTarget(admin1: ApiSession, ids: DatasetIds): Promise<void> {
  const base = `/chatbots/${ids.C.id}`;
  await admin1.patch(`${base}/dialog-nodes/${ids.C.nodeId}`, { outputs: [{ type: 'TEXT', payload: { text: '12월 행사 안내입니다.' } }] });
  const cur = (await admin1.get(`${base}/environment`)).body as { staging?: { versionId: string } | null };
  const promoted = (await admin1.post(`${base}/environment/staging/promote`, { expectedStagingVersionId: cur.staging?.versionId ?? null, label: 'v3 준비' })).body as { staging: { versionId: string; versionNo: number } };
  ids.C.v3 = { versionId: promoted.staging.versionId, versionNo: promoted.staging.versionNo };
}

export { scheduleWithApproval };

/** 챗봇별 임베드 스니펫(`GET /chatbots/:id/embed-code`)을 무대 서버의 모형 페이지가 쓰도록 등록한다(화면 표시와 실제 삽입에 같은 값 — ui-spec §5.2). */
export async function registerStageBots(r: DataPhaseResult, registry: Record<string, StageBotInfo>): Promise<void> {
  const admin1 = r.data.sessions.admin1;
  for (const b of [r.data.ids.A, r.data.ids.B, r.data.ids.C]) {
    const code = (await admin1.get(`/chatbots/${b.id}/embed-code`)).body as { pc: string };
    registry[b.slug] = { name: b.name, snippet: code.pc };
  }
  // [DT-2] 챗봇 D(⑨ 선제 안내 전용): 선제 코드는 삽입 코드에 data-proactive="on"이 있을 때만 초기화된다 — 콘솔이 예시로 보여 주는 것과 같은 변환을 D의 모형 페이지에만 넣는다
  const D = r.data.ids.D;
  if (D) {
    const code = (await admin1.get(`/chatbots/${D.id}/embed-code`)).body as { pc: string };
    registry[D.slug] = { name: D.name, snippet: withProactiveAttr(code.pc) };
  }
}
