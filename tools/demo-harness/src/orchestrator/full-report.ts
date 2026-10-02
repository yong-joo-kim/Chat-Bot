// [DT-2] 풀 투어 결과 조립 — 비활성(옵션 생략) 단계 끼워 넣기 · 보고서 입력 · 음성 원본 저장 0 확인(매직 바이트 휴리스틱).
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { FullReportInput } from '../report/build';
import type { HonestyKind } from '../report/schema';
import { isoWithOffset } from '../util/time';
import type { ScenarioResult, SegmentResult, StepResult } from '../scenario/runner';
import { ALL_SEGMENT_KEYS, type PresetDef, type SegmentDef, type SegmentKey } from '../scenario/types';
import type { ResolvedPreset } from '../scenario/plan';
import { gpuUse, GPU_USE_TEXT, omitCustomerLine } from '../scenario/plan';
import { buildStagePlan, type FullRuntime } from './full-prepare';

/**
 * 비활성(옵션 생략) 단계를 결과에 원래 순서대로 끼워 넣는다(`SKIPPED` · `skipReason: OPTION` + 내부 사유). 구간 전체가 비활성이면 그 구간 결과를 새로 만든다.
 * `--only`로 고른 구간에 속한 행만 넣는다. 결과 객체를 제자리에서 바꾸고, 새 구간의 정의(단계 없음)를 돌려준다.
 */
export function mergeInactiveRows(scenario: ScenarioResult, preset: PresetDef, resolved: ResolvedPreset, only: SegmentKey[] | null): { extraSegments: SegmentDef[] } {
  const order = new Map<string, number>();
  let n = 0;
  for (const seg of preset.segments) for (const st of seg.steps) if (!order.has(st.id)) order.set(st.id, n++);
  const selected = (key: string): boolean => only === null || (only as readonly string[]).includes(key);
  const mk = (id: string, segment: string, title: string, internal: string): StepResult => ({
    id,
    segment,
    title,
    core: false,
    status: 'SKIPPED',
    budgetSec: 0,
    actualSec: 0,
    skipReason: 'OPTION',
    captures: [],
    honesty: [`${id}: ${internal}`],
  });
  const extraSegments: SegmentDef[] = [];
  const bySeg = new Map<string, SegmentResult>(scenario.segments.map((s) => [s.key, s]));
  for (const row of resolved.inactiveRows) {
    if (!selected(row.segment)) continue;
    const sr = bySeg.get(row.segment);
    const r = mk(row.stepId, row.segment, row.title, row.reason.internal);
    if (sr) {
      sr.steps.push(r);
      sr.steps.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    } else {
      const seg = preset.segments.find((s) => s.key === row.segment);
      const created: SegmentResult = { key: row.segment, title: seg?.title ?? row.segment, chip: '', budgetSec: 0, actualSec: 0, steps: [r] };
      bySeg.set(row.segment, created);
      scenario.segments.push(created);
      extraSegments.push({ key: row.segment as SegmentKey, chip: '', title: seg?.title ?? row.segment, budgetSec: 0, skipOrder: [], steps: [] });
    }
  }
  scenario.segments.sort((a, b) => ALL_SEGMENT_KEYS.indexOf(a.key as SegmentKey) - ALL_SEGMENT_KEYS.indexOf(b.key as SegmentKey));
  scenario.steps = scenario.segments.flatMap((s) => s.steps);
  return { extraSegments };
}

/** 보고서가 읽는 시각(에포크 ms) 정보. */
export interface FullTimes {
  segmentStarts: Array<{ key: string; atMs: number }>;
  showEndedAtMs: number | null;
}

function kindOf(k: string): HonestyKind {
  const ok: HonestyKind[] = ['MOCK', 'PREPARED_RESULT', 'DEMO_SETTING', 'FALLBACK', 'SKIPPED', 'HISTORICAL_DATA', 'SYNTHETIC_INPUT', 'GPU_USED', 'QUALITY_UNVERIFIED', 'NO_AUDIO', 'DEVICE_FALLBACK'];
  return (ok as string[]).includes(k) ? (k as HonestyKind) : 'DEMO_SETTING';
}

export function buildFullReportInput(rt: FullRuntime, scenario: ScenarioResult | null, times: FullTimes | null, audioStoreCheck?: FullReportInput['audioStoreCheck']): FullReportInput {
  const p = rt.plan;
  const r = rt.resolved;
  const sp = buildStagePlan(rt);
  const use = gpuUse(p);
  const gpuUsed = (p.voiceInput === 'real' && p.sttDevice === 'cuda') || rt.record.loadMs !== null || rt.record.prepared !== null;
  const ran = (id: string): boolean => (scenario?.steps ?? []).some((s) => s.id === id && s.status !== 'SKIPPED');
  const honesty: FullReportInput['honesty'] = [];
  if (p.deviceNote?.kind === 'FALLBACK') honesty.push({ stepId: 'S0-01', kind: 'DEVICE_FALLBACK', text: `음성 인식을 GPU로 시작하지 못해 CPU(small)로 다시 시작했습니다 — 사유: ${p.deviceNote.reason}` });
  if (use !== 'none') honesty.push({ stepId: 'S0-01', kind: 'GPU_USED', text: `이 PC의 GPU 사용 구간: ${p.voiceInput === 'real' && p.sttDevice === 'cuda' ? `음성 인식(${p.sttModel})` : ''}${p.voiceInput === 'real' && p.sttDevice === 'cuda' && p.localLlm ? ' · ' : ''}${p.localLlm ? '사내 소형 생성 모델(장면 10)' : ''} — ${GPU_USE_TEXT[use]}` });
  if (p.voiceInput === 'real' && ran('SV-03')) honesty.push({ stepId: 'SV-03', kind: 'SYNTHETIC_INPUT', text: '사람 목소리가 아니라 Windows 합성 음성 파일을 가상 마이크로 넣었습니다(실제 마이크 아님)' });
  if (p.voiceInput === 'mock' && ran('SV-03')) honesty.push({ stepId: 'SV-03', kind: 'MOCK', text: '모의 인식 결과입니다. 음성 인식 모델은 점검하지 않았습니다(위젯 -> API 구간만 점검)' });
  if ((p.voiceInput === 'real' || p.localLlm) && (rt.record.speech || rt.record.live || rt.prepared)) honesty.push({ stepId: null, kind: 'QUALITY_UNVERIFIED', text: '이 노트북(RTX 3050 4GB)의 결과는 동작 확인 수준이며 정확도·품질·지연의 합격 판정이 아닙니다' });
  const sound = ['SV-03', 'SV-05', 'SV-06'].filter(ran);
  if (sound.length > 0) honesty.push({ stepId: null, kind: 'NO_AUDIO', text: `영상에는 소리가 없습니다 — 현장 스피커로만 들립니다 (${sound.join(' · ')})` });
  if (ran('SP-01')) honesty.push({ stepId: 'SP-01', kind: 'DEMO_SETTING', text: '시연을 위해 선제 안내의 머문 시간을 5초(허용 최소값)로 줄였습니다' });
  for (const h of rt.record.honesty) honesty.push({ stepId: h.stepId, kind: kindOf(h.kind), text: h.text });

  // VRAM 관찰표(이벤트) · 구간 최대
  const vram = (rt.observer?.events() ?? []).map((s) => ({ at: isoWithOffset(new Date(s.at)), event: s.event ?? '', usedMiB: s.usedMiB, totalMiB: s.totalMiB }));
  const vramMax: NonNullable<FullReportInput['vramMax']> = [];
  if (rt.observer && times) {
    const startOf = (k: string): number | null => times.segmentStarts.find((s) => s.key === k)?.atMs ?? null;
    const idx = (k: string) => times.segmentStarts.findIndex((s) => s.key === k);
    const endOf = (k: string): number | null => {
      const i = idx(k);
      return i >= 0 && i + 1 < times.segmentStarts.length ? times.segmentStarts[i + 1].atMs : times.showEndedAtMs;
    };
    for (const [key, label] of [['voice', '장면 8 최대'], ['edge', '장면 10 최대']] as const) {
      const a = startOf(key);
      const b = endOf(key);
      if (a !== null && b !== null) vramMax.push({ label, usedMiB: rt.observer.maxBetween(a, b) });
    }
  }
  return {
    plan: {
      voiceInput: p.voiceInput,
      sttDevice: p.sttDevice,
      sttModel: p.sttModel,
      sttRequested: p.sttRequested,
      localLlm: p.localLlm,
      liveClustering: p.liveClustering,
      voiceOmittedReason: p.voiceOmittedReason ?? null,
      llmOmittedReason: p.llmOmittedReason ?? null,
      deviceNote: p.deviceNote ?? null,
      gpuUse: use,
      gpuUseText: GPU_USE_TEXT[use],
      sceneCount: r.sceneCount,
      totalBudgetSec: r.totalBudgetSec,
      inactive: [
        ...r.inactiveRows.map((x) => ({ id: x.stepId, reason: x.reason.internal, customer: x.reason.hidden ? null : omitCustomerLine(x.reason) })),
      ],
      omittedLines: sp.omittedLines,
      sceneTitles: sp.sceneTitles,
      demonstratedNos: sp.demonstratedNos,
    },
    models: rt.models,
    vram,
    vramMax,
    speech: rt.record.speech,
    prepared: rt.record.prepared,
    live: rt.record.live,
    loadMs: rt.record.loadMs,
    unloaded: rt.record.unloaded,
    downloads: rt.record.downloads,
    proactive: rt.record.proactive,
    honesty,
    badgeNotes: rt.record.badgeNotes,
    gpuUsed,
    childOverrides: rt.childOverrides,
    audioStoreCheck,
  };
}

// ═══ 음성 원본 저장 0 확인(설계 S-DX-1 · AC-DX2-2) — 휴리스틱 ═══
// `ml-speech`(STT 자식의 cwd — 임시 파일이 남을 가장 큰 곳)는 검사 대상이다(M-2). 나머지는 음성이 오가지 않거나 별도 규칙으로 다룬다.
export const SKIP_DIRS = new Set(['audio', 'browser-profile', 'video', 'downloads', 'report', 'shots', 'gif', 'ml-augment', 'ml-worker']);
/** 파일 앞에서 읽는 바이트 상한(M-2) — 큰 파일을 통째로 메모리에 올리지 않는다. */
export const SCAN_HEAD_BYTES = 64 * 1024;
const AUDIO_EXT = /\.(wav|wave|ogg|oga|opus|webm|mka|mp3|m4a|flac)$/i;
const MAGIC: Array<{ name: string; test: (b: Buffer) => boolean }> = [
  // RIFF....WAVE 12바이트는 충분히 길어 앞부분 어디에 있어도 본다
  { name: 'RIFF/WAVE', test: (b) => b.indexOf('RIFF') >= 0 && containsRiffWave(b) },
  // OggS·EBML 4바이트는 SQLite·압축 바이너리에서 우연히 나올 수 있어 파일 맨 앞(offset 0)에서만 인정한다
  { name: 'OggS', test: (b) => b.length >= 6 && b.toString('ascii', 0, 4) === 'OggS' && b[4] === 0 && b[5] <= 7 },
  { name: 'EBML(webm)', test: (b) => b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 },
];

function containsRiffWave(b: Buffer): boolean {
  let from = 0;
  for (;;) {
    const i = b.indexOf('RIFF', from);
    if (i < 0) return false;
    if (b.toString('ascii', i + 8, i + 12) === 'WAVE') return true;
    from = i + 4;
  }
}

/** 파일 앞 `SCAN_HEAD_BYTES`만 읽는다(실패는 null). */
function readHead(p: string, size: number): Buffer | null {
  let fd: number | null = null;
  try {
    fd = openSync(p, 'r');
    const len = Math.min(size, SCAN_HEAD_BYTES);
    const buf = Buffer.alloc(len);
    const n = readSync(fd, buf, 0, len, 0);
    return buf.subarray(0, n);
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // 무시
      }
    }
  }
}

/**
 * 정리 직전 검사: 실행 폴더(제외: audio·browser-profile·video·downloads·보고서·캡처)와 `demo.db`에 음성 파일 시그니처 0 · 서버 로그(api.log · ml-speech.log)에 기대 문장·전사 글자 0.
 * 시그니처 검사는 휴리스틱이다(알려진 한계 — 파일 앞 64KB와 확장자만 보므로 뒤쪽에 숨은 바이트·압축·암호화된 음성은 못 보고, OggS·EBML은 파일 맨 앞일 때만 인정한다).
 */
export function scanAudioTraces(runDir: string, phrases: string[]): { scannedFiles: number; hits: string[]; logHits: string[] } {
  const hits: string[] = [];
  let scanned = 0;
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(name)) walk(p);
        continue;
      }
      scanned++;
      const rel = relative(runDir, p).split(sep).join('/');
      if (AUDIO_EXT.test(name)) hits.push(`${rel}: 음성 확장자`);
      const buf = readHead(p, st.size);
      if (!buf) continue;
      for (const m of MAGIC) if (m.test(buf)) hits.push(`${rel}: ${m.name}`);
    }
  };
  walk(runDir);
  const logHits: string[] = [];
  for (const f of ['api.log', 'ml-speech.log']) {
    const p = join(runDir, 'logs', f);
    if (!existsSync(p)) continue;
    const text = readFileSync(p, 'utf8');
    for (const ph of phrases) if (ph && ph.length >= 4 && text.includes(ph)) logHits.push(`${f}: "${ph.slice(0, 20)}"`);
  }
  return { scannedFiles: scanned, hits, logHits };
}
