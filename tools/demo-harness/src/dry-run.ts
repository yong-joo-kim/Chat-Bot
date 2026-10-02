// `--dry-run`(설계 §4.2 · §20.3) — 프로세스·브라우저 0으로 계획만 출력한다: 단계표 · 예산 · 생략 순서 · 포트 · 환경변수 공개표.
// 비밀 값은 가린다. 종료 코드 0(정의 검사 오류가 있으면 2).
import { join } from 'node:path';
import type { CliOptions } from './cli/args';
import { PORT_LABELS, portsFor, type RepoPaths } from './config';
import { buildAugmentEnv } from './env/ml-augment-env';
import { buildSpeechEnv } from './env/ml-speech-env';
import { initialPlan } from './orchestrator/full-prepare';
import { gpuUse, GPU_USE_TEXT, resolvePreset } from './scenario/plan';
import { buildApiEnv, buildMlEnv, type OverrideRow } from './env/api-env';
import { checkPresetDefinition, checkSkipIds } from './scenario/definition-check';
import type { PresetDef } from './scenario/types';
import type { Terminal } from './log/terminal';
import { CONSOLE_TEXT } from './selectors/console';
import { WIDGET_TEXT } from './selectors/widget';
import { padEndWidth } from './util/display-width';
import { formatMmSs } from './util/time';

function valueFor(row: OverrideRow): string {
  if (row.secret) return '[가림]';
  return row.value === '' ? '(빈 문자열)' : row.value;
}

/** 선택자 문구 목록(접근성 이름·보이는 문구 기반 — `src/selectors`가 단일 출처) — 화면 변경 리뷰용. */
function printSelectors(term: Terminal): void {
  const lines: string[] = [];
  const walk = (v: unknown, path: string): void => {
    if (typeof v === 'string') lines.push(`${path} = ${v}`);
    else if (typeof v === 'function') lines.push(`${path} = ${(v as (...a: unknown[]) => unknown)(1, 2) as string}`);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
  };
  walk(CONSOLE_TEXT, '콘솔');
  walk(WIDGET_TEXT, '위젯');
  term.text(`선택자 문구 ${lines.length}개(src/selectors — 접근성 이름·보이는 문구 기반)`);
  for (const l of lines) term.text(l, '    ');
}

export function runDryRun(term: Terminal, opts: CliOptions, preset: PresetDef, paths: RepoPaths, runsDir: string, parentEnv: NodeJS.ProcessEnv = process.env): number {
  const isFull = (preset.flags?.length ?? 0) > 0;
  const ports = portsFor(opts.portOffset, { augment: isFull && opts.withLocalLlm, speech: isFull && opts.withVoiceInput });
  const plan = isFull ? initialPlan(preset.id, opts) : null;
  const resolved = plan ? resolvePreset(preset, plan) : null;
  const segs = resolved ? resolved.segments : preset.segments;
  const totalSec = resolved ? resolved.totalBudgetSec : preset.totalBudgetSec;
  const issues = checkPresetDefinition(preset);
  const skipErrors = checkSkipIds(preset, opts.skip, plan ?? undefined);

  term.banner(`원클릭 시연 하네스 (${isFull ? 'DT-2' : 'DT-1'}) - 계획만 출력(--dry-run) - 프리셋 ${preset.id}${isFull ? ' (풀 투어)' : ''}`);
  term.text(`모드 ${opts.mode === 'visible' ? '보이는 시연' : '무인 점검'} / 브라우저 ${opts.browser} / 화면 ${opts.viewport.width}x${opts.viewport.height}`);
  term.text(`실행 폴더 루트 ${runsDir}`);
  term.blank();

  if (plan && resolved) {
    // [DT-2] 계획 문맥 블록(ui-spec §16.3.4) — 장치 결정은 사전 점검을 하지 않으므로 auto(실행 시 결정)로 표시한다
    const use = gpuUse({ ...plan, voiceInput: plan.voiceInput, sttDevice: plan.voiceInput === 'real' && opts.sttDevice !== 'cpu' ? 'cuda' : plan.voiceInput === 'real' ? 'cpu' : null });
    term.text(`옵션   음성 입력=${plan.voiceInput === 'real' ? `켬(장치 ${opts.sttDevice}${opts.sttDevice === 'auto' ? ', 실행 시 결정' : ''})` : plan.voiceInput === 'mock' ? '모의 점검' : '끔'}  사내 생성=${plan.localLlm ? '켬' : '끔'}  실시간 분석=${plan.liveClustering ? '켬' : '끔'}`);
    term.text(`예상   ${formatMmSs(resolved.totalBudgetSec)} (제안값 - 미실측)    자식 프로세스 ${2 + (plan.voiceInput === 'real' ? 1 : 0) + (plan.localLlm ? 1 : 0)}개 + 정적 서버 3개    장면 ${resolved.sceneCount}개`);
    term.text(`GPU 사용(장치가 GPU로 정해질 때): ${GPU_USE_TEXT[use]}`);
    term.blank();
  }
  // 구간·단계표
  term.text(`구간 ${segs.length}개 / 총 예산 ${formatMmSs(totalSec)} (${totalSec}초)`);
  term.text(`${padEndWidth('구간', 14)}${padEndWidth('칩', isFull ? 12 : 10)}${padEndWidth('제목', 25)}${padEndWidth('예산', 7)}단계`);
  for (const seg of segs) {
    const selected = opts.only === null || opts.only.includes(seg.key);
    const label = `${seg.key}${selected ? '' : ' (제외)'}`;
    const tail = `${seg.steps.length}단계`;
    term.text(`${padEndWidth(label, 14)}${padEndWidth(seg.chip, isFull ? 12 : 10)}${padEndWidth(seg.title, 25)}${padEndWidth(`${seg.budgetSec}초`, 7)}${tail}`);
    if (seg.skipOrder.length > 0) term.text(`생략 순서: ${seg.skipOrder.join(' -> ')}`, '          ');
    for (const st of seg.steps) {
      term.text(`${st.id} ${st.title} (${st.budgetSec}초, ${st.core ? '핵심' : '생략 가능'}, ${st.driver})`, '        ');
    }
  }
  if (resolved) {
    for (const x of resolved.inactiveRows) term.text(`비활성 ${x.stepId} ${x.title} - ${x.reason.internal}`, '        ');
    for (const x of resolved.inactiveSegments) term.text(`비활성 구간 ${x.key} ${x.title} - ${x.reason.internal}`, '        ');
  }
  const scenes = segs.filter((s) => s.key !== 'opening' && s.key !== 'closing');
  term.text(`시나리오 장면 ${scenes.length}개: ${scenes.map((s) => s.title).join(' / ')}`);
  term.blank();

  // 포트·프로세스
  term.text('포트(--port-offset 반영)');
  for (const k of Object.keys(ports) as Array<keyof typeof ports>) term.text(`${padEndWidth(String(ports[k]), 7)}${PORT_LABELS[k]}`, '  ');
  term.text(`자식 프로세스: API(node dist/main.js) / 문장 분석 서버(venv python)${plan?.voiceInput === 'real' ? ' / 음성 인식 서버(ML_WORKER_ROLE=speech)' : ''}${plan?.localLlm ? ' / 사내 생성 서버(ML_WORKER_ROLE=augment · Ollama)' : ''} - 정적 서버 3개는 하네스 안에서 실행`);
  term.blank();

  // 환경변수 공개표 — 값은 비밀 제외, 실행 폴더는 자리표시자
  const runDirPlaceholder = join(runsDir, '<실행 ID>');
  const api = buildApiEnv({
    parentEnv,
    runDir: runDirPlaceholder,
    dbPath: join(runDirPlaceholder, 'demo.db'),
    ports,
    embeddingTimeoutMs: opts.embeddingTimeoutMs ?? 300,
    encryptionKeys: opts.fieldEncryption ? '<실행별 무작위 키>' : undefined,
    apiPackageJson: paths.apiPackageJson,
    plan: plan ? { voiceInput: plan.voiceInput, localLlm: plan.localLlm } : undefined,
  });
  const ml = buildMlEnv({ parentEnv, ports });
  const printRows = (title: string, rows: OverrideRow[]) => {
    term.text(`${title}(공개표 항목 ${rows.filter((r) => r.disclosed).length}개 / 전체 ${rows.length}개)`);
    for (const r of rows) {
      const changed = valueFor(r) !== r.defaultValue && !(r.defaultValue.startsWith('미설정') && r.value === '');
      term.text(`${r.disclosed ? '*' : ' '} ${padEndWidth(r.key, 41)} ${valueFor(r)}${changed ? `  (기본 ${r.defaultValue})` : ''}`, '    ');
    }
  };
  printRows('API 환경변수 - 부모 환경은 상속하지 않음', api.overrides);
  term.blank();
  printRows('ml-worker 환경변수', ml.overrides);
  if (plan?.voiceInput === 'real') {
    term.blank();
    const sp = buildSpeechEnv({ parentEnv, ports, modelRoot: join(paths.mlWorkerDir, '.cache', 'stt-models'), model: opts.sttDevice === 'cpu' ? 'small' : 'large-v3-turbo', device: opts.sttDevice === 'cpu' ? 'cpu' : 'cuda', sitePackages: join(paths.mlWorkerDir, '.venv', 'Lib', 'site-packages') });
    printRows(`음성 인식 서버 환경변수(장치 ${opts.sttDevice === 'cpu' ? 'cpu' : 'cuda 가정 — auto는 실행 시 결정'})`, sp.overrides);
  }
  if (plan?.localLlm) {
    term.blank();
    printRows('사내 생성 서버 환경변수', buildAugmentEnv({ parentEnv, ports }).overrides);
  }
  term.text('(* = 시연 설정 공개표·외부 송신 점검표에 실리는 항목)');
  term.blank();
  printSelectors(term);

  if (issues.length > 0 || skipErrors.length > 0) {
    term.blank();
    for (const i of issues) term.line('error', `프리셋 정의 오류 (${i.where}): ${i.message}`, { how: '프리셋 정의를 수정하세요' });
    for (const e of skipErrors) term.line('error', e, { how: '핵심 단계가 아닌 단계 ID만 지정하세요' });
    return 2;
  }
  term.blank();
  term.line('info', '계획만 출력했습니다. 프로세스·브라우저는 실행하지 않았습니다');
  return 0;
}
