// 윈도 명령 출력 파서(H-T8) — netstat · tasklist · CIM(JSON). 순수 함수라 고정 샘플로 시험한다.
// 한국어 윈도에서도 netstat 상태 단어(LISTENING·TIME_WAIT 등)는 영문 그대로 나온다(이 PC에서 확인).

export interface NetstatRow {
  proto: 'TCP';
  localHost: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  state: string;
  pid: number;
}

function splitHostPort(s: string): { host: string; port: number } | null {
  const i = s.lastIndexOf(':');
  if (i < 0) return null;
  const port = Number(s.slice(i + 1));
  if (!Number.isInteger(port)) return null;
  let host = s.slice(0, i);
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  return { host, port };
}

/** `netstat -ano -p tcp` 출력 파싱. 헤더·빈 줄·알 수 없는 줄은 건너뛴다. */
export function parseNetstat(text: string): NetstatRow[] {
  const rows: NetstatRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 5 || cols[0].toUpperCase() !== 'TCP') continue;
    const local = splitHostPort(cols[1]);
    const remote = splitHostPort(cols[2]);
    const pid = Number(cols[4]);
    if (!local || !remote || !Number.isInteger(pid)) continue;
    rows.push({
      proto: 'TCP',
      localHost: local.host,
      localPort: local.port,
      remoteHost: remote.host,
      remotePort: remote.port,
      state: cols[3].toUpperCase(),
      pid,
    });
  }
  return rows;
}

/** 지정 포트를 LISTENING 중인 행들(여러 주소 바인드면 여러 행). TIME_WAIT 등은 점유로 보지 않는다. */
export function listeningOnPort(rows: NetstatRow[], port: number): NetstatRow[] {
  return rows.filter((r) => r.state === 'LISTENING' && r.localPort === port);
}

export interface TasklistEntry {
  imageName: string;
  pid: number;
}

/** `tasklist /FO CSV /NH` 출력 파싱. 일치 항목이 없을 때의 안내 문장(현지화됨)은 CSV가 아니므로 무시한다. */
export function parseTasklistCsv(text: string): TasklistEntry[] {
  const out: TasklistEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^"([^"]*)","(\d+)"/.exec(line.trim());
    if (m) out.push({ imageName: m[1], pid: Number(m[2]) });
  }
  return out;
}

export interface CimProcess {
  pid: number;
  ppid: number;
  commandLine: string;
  name?: string;
}

/** PowerShell `ConvertTo-Json -Compress` 결과(객체 1개 · 배열 · 빈 출력)를 파싱한다. */
export function parseCimJson(text: string): CimProcess[] {
  const t = text.trim();
  if (!t) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(t);
  } catch {
    return [];
  }
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  const out: CimProcess[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const pid = Number(o.ProcessId);
    if (!Number.isInteger(pid)) continue;
    out.push({
      pid,
      ppid: Number(o.ParentProcessId ?? 0) || 0,
      commandLine: typeof o.CommandLine === 'string' ? o.CommandLine : '',
      name: typeof o.Name === 'string' ? o.Name : undefined,
    });
  }
  return out;
}

/**
 * 잔존 프로세스 오종료 방지(FR-DH8-3): PID가 재사용됐을 수 있으므로 기록한 표식이
 * 현재 그 PID의 명령줄에 있을 때만 하네스 프로세스로 판정한다.
 */
export function commandLineHasMarker(commandLine: string, marker: string): boolean {
  return marker.length > 0 && commandLine.includes(marker);
}
