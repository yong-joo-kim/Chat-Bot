// [DT-2] 풀 투어 오케스트레이션 접착 코드 — 사전 점검 확정·진행자 안내·서버 훅. index.ts는 이 함수들을 `isFull`일 때만 부른다.
import { createInterface } from 'node:readline';
import type { CliOptions } from '../cli/args';
import type { RepoPaths } from '../config';
import type { Terminal } from '../log/terminal';
import { runFullPreflight } from '../preflight/full-checks';
import type { PcItem } from '../preflight/checks';
import type { RunPaths } from '../run/run-dir';
import { omitCustomerLine, type InactiveRow } from '../scenario/plan';
import type { ServerHooks } from '../servers';
import { AbortedError } from './errors';
import { planFromPreflight, refreshResolved, type FullRuntime, type PlanBlock } from './full-prepare';

function printItems(term: Terminal, items: PcItem[]): void {
  for (const it of items) {
    if (it.status === 'pass') term.line('pass', `${it.title}: ${it.message}`);
    else if (it.status === 'warn') term.line('warn', `${it.title}: ${it.message}`, { why: it.why, how: it.how });
    else if (it.status === 'block') term.line('error', `${it.title}: ${it.message}`, { why: it.why, how: it.how });
    else term.detail(`[${it.id}] ${it.title}: ${it.message}`);
  }
}

/** 시작 헤더 옵션 안내(ui-spec §16.3.1) — 터미널에는 옵션 이름을 그대로 쓴다. */
export function printFullOptionLines(term: Terminal, opts: CliOptions): void {
  const on: string[] = [];
  if (opts.withVoiceInput) on.push(`음성 입력 켬(${opts.sttDevice})`);
  if (opts.voiceMockCheck) on.push('음성 입력 모의 점검 켬');
  if (opts.withLocalLlm) on.push('사내 생성 모델 켬');
  if (opts.liveClustering) on.push('실시간 분석 켬');
  if (on.length > 0) term.text(`옵션   ${on.join('   ')}`);
  else {
    term.line('info', '풀 투어 기본 구성입니다. 모델이 필요한 장면 3개는 꺼져 있습니다.');
    term.text('       켜려면  --with-voice-input  --with-local-llm  --live-clustering', '  ');
  }
}

/** 진행자 확인 한 번(`[확인] 위 장면을 생략하고 계속할까요? 엔터 = 계속 / q = 중단`) — 대화형 터미널에서만. 비대화형이면 안내하고 계속한다. */
async function confirmContinue(term: Terminal, opts: CliOptions): Promise<void> {
  if (opts.unattendedVisibleForTest || !process.stdin.isTTY) {
    term.line('info', '불가 항목의 장면을 생략하고 계속합니다(비대화형 실행 — 진행자 확인 생략)');
    return;
  }
  term.text('[확인] 위 장면을 생략하고 계속할까요? 엔터 = 계속 / q = 중단');
  const rl = createInterface({ input: process.stdin, output: undefined, terminal: false });
  const answer = await new Promise<string>((resolve) => {
    rl.once('line', (l) => resolve(l));
    rl.once('close', () => resolve('q'));
  });
  rl.close();
  if (answer.trim().toLowerCase() === 'q') throw new AbortedError();
}

export interface PlanPreflightOutcome {
  items: PcItem[];
  blocked: PlanBlock | null;
}

/**
 * P0 풀 투어 추가분: PC-DX 수집 → 장치 결정·불가 판정 → 최종 계획 확정(`rt.plan`) → 공개·진행자 확인.
 * 차단(headless 불가 · 장치 명시 불가)이면 `blocked`를 돌려주고 호출자가 PrepareError로 종료(2)한다.
 */
export async function checkPlanPreflight(a: { rt: FullRuntime; term: Terminal; paths: RepoPaths; run: RunPaths; opts: CliOptions; env: NodeJS.ProcessEnv; signal: AbortSignal }): Promise<PlanPreflightOutcome> {
  const { rt, term, opts } = a;
  const pre = await runFullPreflight({ paths: a.paths, options: opts, run: a.run, env: a.env });
  rt.pre = pre;
  printItems(term, pre.items);
  const r = planFromPreflight(rt.plan, opts, pre.voice, pre.llm);
  for (const b of r.blocks) term.line('error', b.what, { why: b.why, how: b.how });
  if (r.blocks.length > 0) return { items: pre.items, blocked: r.blocks[0] };
  rt.plan = r.plan;
  rt.omitted = r.omitted;
  rt.wavPath = pre.voice.wav?.ok ? pre.voice.wav.path : null;
  rt.koreanVoices = pre.voice.probe ? pre.voice.probe.localKo : null;
  refreshResolved(rt);
  const p = rt.plan;
  // 장치 결정은 항상 한 줄로 공개한다(고객 화면에 나갈 문구와 같은 사실)
  if (p.voiceInput === 'real') {
    if (p.deviceNote?.kind === 'SELECTED') term.line('warn', `음성 인식 장치: GPU 대신 CPU(${p.sttModel})로 시작합니다`, { why: p.deviceNote.reason, how: '다른 GPU 프로그램을 끄고 다시 실행하거나, 이대로 CPU로 진행하세요' });
    else term.line('pass', `음성 인식 장치 결정: ${p.sttDevice === 'cuda' ? 'GPU' : 'CPU'} (${p.sttModel})`);
  }
  if (r.omitted.length > 0) {
    for (const o of r.omitted) term.line('warn', o, { why: '준비 점검에서 불가로 판정됐습니다(보이는 시연은 해당 장면만 생략합니다)', how: '위 항목을 해결한 뒤 다시 실행하면 장면이 포함됩니다' });
    await confirmContinue(term, opts);
  }
  return { items: pre.items, blocked: null };
}

/** 정적 서버 훅(풀 투어) — 계획은 공연 직전까지 바뀔 수 있어 모두 요청 시점에 평가한다. */
export function fullServerHooks(rt: FullRuntime): Pick<ServerHooks, 'audioFile' | 'siteAllow' | 'roadmapFull'> {
  return {
    audioFile: () => (rt.opts.mode === 'visible' && rt.plan.voiceInput === 'real' ? rt.wavPath : null),
    siteAllow: () => rt.plan.voiceInput !== 'off',
    roadmapFull: () => {
      const lines = rt.resolved.inactiveRows.filter((x) => !x.reason.hidden).map((x) => x.reason);
      const segLines = rt.resolved.inactiveSegments.filter((x) => !x.reason.hidden).map((x) => x.reason);
      const seen = new Set<string>();
      const omitted: string[] = [];
      for (const r of [...segLines, ...lines]) {
        const t = omitCustomerLine(r);
        if (seen.has(`${r.sceneName}|${r.kind}`)) continue;
        seen.add(`${r.sceneName}|${r.kind}`);
        omitted.push(t);
      }
      return {
        scenes: rt.resolved.segments.filter((s) => s.key !== 'opening' && s.key !== 'closing').map((s) => s.key),
        omitted,
        excludeNos: rt.resolved.segments.some((s) => s.key === 'voice') ? [32] : [],
      };
    },
  };
}

export type { InactiveRow };
