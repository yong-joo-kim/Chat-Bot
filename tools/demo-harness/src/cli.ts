#!/usr/bin/env node
// 원클릭 시연 하네스(DT-1) 진입점 — 인자 해석 · 명령 분기 · 종료 코드(0/1/2/130). 설계 §4.
import { HELP_TEXT, parseArgs } from './cli/args';
import { repoPaths } from './config';
import { runDryRun } from './dry-run';
import { Terminal } from './log/terminal';
import { executeRun, stopRun, EXIT } from './orchestrator';
import { getPreset, listPresetIds } from './presets';

async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  const noColor = argv.includes('--no-color');
  if (!parsed.ok) {
    const term = Terminal.forProcess({ noColor, verbose: false });
    for (const e of parsed.errors) term.line('error', e.what, { why: e.why, how: e.how });
    return EXIT.PREPARE_FAILED;
  }
  const opts = parsed.options;
  const term = Terminal.forProcess({ noColor: opts.noColor, verbose: opts.verbose });

  if (opts.help) {
    process.stdout.write(HELP_TEXT);
    return EXIT.OK;
  }

  const paths = repoPaths();
  const runsDir = opts.runsDir ?? paths.defaultRunsDir;

  if (opts.stop !== null) return stopRun({ runsDir, target: opts.stop, term });

  const preset = getPreset(opts.preset);
  if (!preset) {
    term.line('error', `알 수 없는 프리셋입니다: ${opts.preset}`, { why: `등록된 프리셋: ${listPresetIds().join(', ')}`, how: '--preset 값을 등록된 프리셋 중에서 고르세요' });
    return EXIT.PREPARE_FAILED;
  }
  if (!preset.modesAllowed.includes(opts.mode)) {
    term.line('error', `프리셋 ${preset.id}은(는) ${opts.mode} 모드를 지원하지 않습니다`, { why: `지원 모드: ${preset.modesAllowed.join(', ')}`, how: '--mode 값을 바꾸세요' });
    return EXIT.PREPARE_FAILED;
  }

  if (opts.dryRun) return runDryRun(term, opts, preset, paths, runsDir);

  // Ctrl+C·창 닫힘·종료 신호 -> 정리 후 130(설계 §6.6)
  const ctrl = new AbortController();
  const onSignal = () => {
    if (!ctrl.signal.aborted) ctrl.abort();
  };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const) process.on(sig, onSignal);

  return executeRun({
    opts,
    preset,
    paths,
    runsDir,
    signal: ctrl.signal,
    makeTerminal: (logFile, redact) =>
      logFile
        ? Terminal.forProcess({ noColor: opts.noColor, verbose: opts.verbose, logFile, redact })
        : Terminal.forProcess({ noColor: opts.noColor, verbose: opts.verbose }),
  });
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
    // 정리가 끝났으므로 남은 핸들(소켓 등)을 기다리지 않고 종료한다.
    setImmediate(() => process.exit(code));
  },
  (e) => {
    process.stderr.write(`[오류] 하네스가 예기치 않게 종료했습니다: ${(e as Error).stack ?? String(e)}\n`);
    process.exit(EXIT.PREPARE_FAILED);
  },
);

