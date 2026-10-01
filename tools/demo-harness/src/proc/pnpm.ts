// pnpm 하위 명령 실행(설계 §6.5 · H-S4) — `.cmd` 셸 래퍼를 피하려고 pnpm 진입 JS를 node로 직접 실행한다.
// pnpm이 하네스를 실행할 때 넘겨 주는 `npm_execpath`를 쓰고, 없으면(사용자가 `node dist/src/cli.js`로 직접 실행)
// shell:true + 인자 개별 따옴표로 폴백하고 경고한다. 이 파일이 하네스에서 shell:true를 쓰는 유일한 곳이다.
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname, extname } from 'node:path';

export interface PnpmInvocation {
  command: string;
  args: string[];
  shell: boolean;
  /** 폴백(셸 경유)이면 true — 호출자가 경고를 출력한다. */
  fallback: boolean;
}

/** 순수 함수: 환경에 따라 pnpm 호출 방식을 정한다(H-S4 시험 대상). */
export function planPnpmInvocation(pnpmArgs: string[], execPath: string | undefined, nodePath: string = process.execPath): PnpmInvocation {
  if (execPath) {
    const ext = extname(execPath).toLowerCase();
    if (ext === '.js' || ext === '.cjs' || ext === '.mjs') {
      return { command: nodePath, args: [execPath, ...pnpmArgs], shell: false, fallback: false };
    }
    if (ext === '.exe') return { command: execPath, args: pnpmArgs, shell: false, fallback: false };
  }
  const quoted = pnpmArgs.map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a));
  return { command: 'pnpm', args: quoted, shell: true, fallback: true };
}

export interface PnpmRunResult {
  code: number | null;
  tail: string[];
  fallback: boolean;
}

/** pnpm 하위 명령을 실행하고 출력을 로그 파일에 남긴다. 마지막 `tailLines`줄을 돌려준다. */
export function runPnpm(
  pnpmArgs: string[],
  opts: { cwd: string; logFile: string; env?: NodeJS.ProcessEnv; tailLines?: number },
): Promise<PnpmRunResult> {
  const plan = planPnpmInvocation(pnpmArgs, process.env.npm_execpath);
  mkdirSync(dirname(opts.logFile), { recursive: true });
  const log = createWriteStream(opts.logFile, { flags: 'a', encoding: 'utf8' });
  const ring: string[] = [];
  let partial = '';
  const push = (chunk: string) => {
    log.write(chunk);
    partial += chunk;
    let i: number;
    while ((i = partial.indexOf('\n')) >= 0) {
      ring.push(partial.slice(0, i).replace(/\r$/, ''));
      partial = partial.slice(i + 1);
    }
    const max = opts.tailLines ?? 60;
    if (ring.length > max) ring.splice(0, ring.length - max);
  };
  return new Promise((resolve) => {
    const child = spawn(plan.command, plan.args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      shell: plan.shell,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.setEncoding('utf8').on('data', push);
    child.stderr?.setEncoding('utf8').on('data', push);
    const finish = (code: number | null) => {
      if (partial) ring.push(partial);
      log.end();
      resolve({ code, tail: ring.slice(-(opts.tailLines ?? 60)), fallback: plan.fallback });
    };
    child.on('error', (e) => {
      push(`실행 실패: ${e.message}\n`);
      finish(null);
    });
    child.on('close', (code) => finish(code));
  });
}
