// 윈도 시스템 조회 — netstat · tasklist · CIM(PowerShell). 실행 파일 직접 호출(셸 0), 파서는 parsers.ts.
import { spawnSync } from 'node:child_process';
import { listeningOnPort, parseCimJson, parseNetstat, parseTasklistCsv, type CimProcess, type NetstatRow } from './parsers';

export function netstatRows(): NetstatRow[] {
  const r = spawnSync('netstat', ['-ano', '-p', 'tcp'], { windowsHide: true, encoding: 'utf8' });
  return r.status === 0 ? parseNetstat(r.stdout ?? '') : [];
}

export function imageNameOfPid(pid: number): string | null {
  const r = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { windowsHide: true, encoding: 'utf8' });
  const rows = parseTasklistCsv(r.stdout ?? '');
  return rows.find((x) => x.pid === pid)?.imageName ?? null;
}

export interface PortOwner {
  port: number;
  pid: number;
  imageName: string | null;
}

/** 포트를 LISTENING 중인 프로세스(이름·PID) — 사전 점검 오류 안내용. */
export function findPortOwners(port: number, rows: NetstatRow[] = netstatRows()): PortOwner[] {
  const pids = [...new Set(listeningOnPort(rows, port).map((r) => r.pid))];
  return pids.map((pid) => ({ port, pid, imageName: imageNameOfPid(pid) }));
}

/** PID 목록의 명령줄을 한 번의 PowerShell 호출로 조회한다(UTF-8 출력). */
export function queryProcessCommandLines(pids: number[]): CimProcess[] {
  const ids = [...new Set(pids.filter((p) => Number.isInteger(p) && p > 0))];
  if (ids.length === 0) return [];
  const script =
    '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;' +
    `$ids=@(${ids.join(',')});` +
    'Get-CimInstance Win32_Process | Where-Object { $ids -contains $_.ProcessId } | ' +
    'Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress';
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 20_000,
  });
  return parseCimJson(r.stdout ?? '');
}

/** 명령줄에 표식이 든 모든 프로세스(PID 모름 — 포트 점유 대체 확인 등). */
export function findProcessesByCommandLineMarker(marker: string): CimProcess[] {
  const script =
    '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;' +
    'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress';
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  return parseCimJson(r.stdout ?? '').filter((p) => p.commandLine.includes(marker));
}

/**
 * [DT-2] 프로세스 트리(루트 PID + 모든 후손) — 음성 인식 자식은 venv 런처 + 실제 인터프리터 2개이고 `nvidia-smi`는 인터프리터를 보고한다(DX-6).
 * 종료 **전에** 호출해 GPU 회수 판정의 감시 PID를 얻는다. 조회 실패면 루트만.
 */
export function listProcessTree(rootPid: number): number[] {
  const script =
    '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;' +
    'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress';
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, encoding: 'utf8', timeout: 30_000, maxBuffer: 64 * 1024 * 1024 });
  const all = parseCimJson(r.stdout ?? '');
  const byParent = new Map<number, number[]>();
  for (const p of all) byParent.set(p.ppid, [...(byParent.get(p.ppid) ?? []), p.pid]);
  const out = [rootPid];
  for (let i = 0; i < out.length; i++) for (const c of byParent.get(out[i]) ?? []) if (!out.includes(c)) out.push(c);
  return out;
}
