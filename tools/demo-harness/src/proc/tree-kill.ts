// 프로세스 트리 종료(설계 §6.6) — 윈도는 `taskkill /PID <pid> /T /F`(실행 파일 직접, 셸 0).
// 실측(2026-10-01): venv의 python.exe는 런처이고 실제 인터프리터는 그 자식이라, /T가 없으면 포트 점유 프로세스가 남는다.
import { spawnSync } from 'node:child_process';

export interface KillResult {
  ok: boolean;
  /** 이미 없는 프로세스(128) — 성공으로 본다. */
  alreadyGone: boolean;
  exitCode: number | null;
}

export function killTreeSync(pid: number): KillResult {
  if (!Number.isInteger(pid) || pid <= 0) return { ok: false, alreadyGone: false, exitCode: null };
  if (process.platform === 'win32') {
    const r = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    // 출력은 현지 코드 페이지(CP949)라 해석하지 않고 종료 코드만 본다: 0 성공 · 128 프로세스 없음.
    const alreadyGone = r.status === 128;
    return { ok: r.status === 0 || alreadyGone, alreadyGone, exitCode: r.status };
  }
  try {
    process.kill(-pid, 'SIGKILL');
    return { ok: true, alreadyGone: false, exitCode: 0 };
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
      return { ok: true, alreadyGone: false, exitCode: 0 };
    } catch (e) {
      const gone = (e as NodeJS.ErrnoException).code === 'ESRCH';
      return { ok: gone, alreadyGone: gone, exitCode: null };
    }
  }
}

/** 프로세스가 살아 있는지(신호 0 — 윈도에서도 존재 확인 용도로 동작). */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}
