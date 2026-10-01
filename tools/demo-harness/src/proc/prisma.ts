// Prisma `migrate deploy`(설계 §5 P1 · §6.5) — `db push` 금지(CLAUDE.md: push는 마이그레이션 전용 부분 유니크 인덱스를 만들지 않는다).
// `.cmd` 래퍼를 피하려고 CLI JS를 node로 직접 실행하고, 환경은 백지 + DATABASE_URL + 폐쇄망 설정만 넘긴다.
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pickSystemEnv } from '../env/api-env';

export function prismaCliPath(apiDir: string): string {
  return join(apiDir, 'node_modules', 'prisma', 'build', 'index.js');
}

export interface MigrateOutcome {
  ok: boolean;
  code: number | null;
  tail: string[];
}

export function migrateDeploy(opts: {
  apiDir: string;
  databaseUrl: string;
  logFile: string;
  parentEnv?: NodeJS.ProcessEnv;
}): Promise<MigrateOutcome> {
  const cli = prismaCliPath(opts.apiDir);
  if (!existsSync(cli)) {
    return Promise.resolve({ ok: false, code: null, tail: [`Prisma CLI를 찾을 수 없습니다: ${cli}`] });
  }
  mkdirSync(dirname(opts.logFile), { recursive: true });
  const log = createWriteStream(opts.logFile, { flags: 'a', encoding: 'utf8' });
  const env: Record<string, string> = {
    ...pickSystemEnv(opts.parentEnv ?? process.env),
    DATABASE_URL: opts.databaseUrl,
    CHECKPOINT_DISABLE: '1',
    PRISMA_HIDE_UPDATE_MESSAGE: '1',
  };
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
    if (ring.length > 40) ring.splice(0, ring.length - 40);
  };
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, 'migrate', 'deploy'], {
      cwd: opts.apiDir,
      env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.setEncoding('utf8').on('data', push);
    child.stderr?.setEncoding('utf8').on('data', push);
    const finish = (code: number | null) => {
      if (partial) ring.push(partial);
      log.end();
      resolve({ ok: code === 0, code, tail: ring.slice(-40) });
    };
    child.on('error', (e) => {
      push(`실행 실패: ${e.message}\n`);
      finish(null);
    });
    child.on('close', (c) => finish(c));
  });
}
