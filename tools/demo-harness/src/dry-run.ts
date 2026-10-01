// `--dry-run`(설계 §4.2 · §20.3) — 프로세스·브라우저 0으로 계획만 출력한다: 단계표 · 예산 · 생략 순서 · 포트 · 환경변수 공개표.
// 비밀 값은 가린다. 종료 코드 0(정의 검사 오류가 있으면 2).
import { join } from 'node:path';
import type { CliOptions } from './cli/args';
import { PORT_LABELS, portsFor, type RepoPaths } from './config';
import { buildApiEnv, buildMlEnv, type OverrideRow } from './env/api-env';
import { checkPresetDefinition, checkSkipIds } from './scenario/definition-check';
import type { PresetDef } from './scenario/types';
import type { Terminal } from './log/terminal';
import { padEndWidth } from './util/display-width';
import { formatMmSs } from './util/time';

function valueFor(row: OverrideRow): string {
  if (row.secret) return '[가림]';
  return row.value === '' ? '(빈 문자열)' : row.value;
}

export function runDryRun(term: Terminal, opts: CliOptions, preset: PresetDef, paths: RepoPaths, runsDir: string, parentEnv: NodeJS.ProcessEnv = process.env): number {
  const ports = portsFor(opts.portOffset);
  const issues = checkPresetDefinition(preset);
  const skipErrors = checkSkipIds(preset, opts.skip);

  term.banner(`원클릭 시연 하네스 (DT-1) - 계획만 출력(--dry-run) - 프리셋 ${preset.id}`);
  term.text(`모드 ${opts.mode === 'visible' ? '보이는 시연' : '무인 점검'} / 브라우저 ${opts.browser} / 화면 ${opts.viewport.width}x${opts.viewport.height}`);
  term.text(`실행 폴더 루트 ${runsDir}`);
  term.blank();

  // 구간·단계표
  term.text(`구간 ${preset.segments.length}개 / 총 예산 ${formatMmSs(preset.totalBudgetSec)} (${preset.totalBudgetSec}초)`);
  term.text(`${padEndWidth('구간', 14)}${padEndWidth('칩', 10)}${padEndWidth('제목', 25)}${padEndWidth('예산', 7)}단계`);
  for (const seg of preset.segments) {
    const selected = opts.only === null || opts.only.includes(seg.key);
    const label = `${seg.key}${selected ? '' : ' (제외)'}`;
    const tail = seg.steps.length === 0 ? '빈 슬롯' : `${seg.steps.length}단계`;
    term.text(`${padEndWidth(label, 14)}${padEndWidth(seg.chip, 10)}${padEndWidth(seg.title, 25)}${padEndWidth(`${seg.budgetSec}초`, 7)}${tail}`);
    if (seg.skipOrder.length > 0) term.text(`생략 순서: ${seg.skipOrder.join(' -> ')}`, '          ');
    for (const st of seg.steps) {
      term.text(`${st.id} ${st.title} (${st.budgetSec}초, ${st.core ? '핵심' : '생략 가능'}, ${st.driver})`, '        ');
    }
  }
  const scenes = preset.segments.filter((s) => /^s\d$/.test(s.key));
  term.text(`시나리오 슬롯 ${scenes.length}개: ${scenes.map((s) => s.title).join(' / ')}`);
  term.blank();

  // 포트·프로세스
  term.text('포트(--port-offset 반영)');
  for (const k of Object.keys(ports) as Array<keyof typeof ports>) term.text(`${padEndWidth(String(ports[k]), 7)}${PORT_LABELS[k]}`, '  ');
  term.text('자식 프로세스: API(node dist/main.js) / 문장 분석 서버(venv python) - 정적 서버 3개는 하네스 안에서 실행');
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
  term.text('(* = 시연 설정 공개표·외부 송신 점검표에 실리는 항목)');
  term.blank();
  term.text('선택자 목록: 다음 단계(시나리오 구현)에서 채워집니다');

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
