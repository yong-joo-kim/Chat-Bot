// 사전 점검 항목 판정(설계 §5.1 PC-1~PC-15) — 판정 로직은 순수 함수로 두어 고정 입력으로 시험한다(H-T8 계열).
// 상태: pass 통과 · warn 경고(진행 가능) · block 차단(종료 코드 2) · info 정보(보고서용).
import type { PortCheck } from '../proc/ports';
import type { PortOwner } from '../proc/system';
import { PORT_LABELS } from '../config';

export type PcStatus = 'pass' | 'warn' | 'block' | 'info';

export interface PcItem {
  id: string;
  title: string;
  status: PcStatus;
  message: string;
  /** 3요소(UIUX §7) — warn/block일 때 채운다. */
  why?: string;
  how?: string;
  data?: Record<string, unknown>;
}

const item = (
  id: string,
  title: string,
  status: PcStatus,
  message: string,
  extra: Partial<Pick<PcItem, 'why' | 'how' | 'data'>> = {},
): PcItem => ({ id, title, status, message, ...extra });

// ── PC-1 Node · pnpm ────────────────────────────────────────────────────────────
export function evalNode(version: string): PcItem {
  const major = Number(/^v?(\d+)/.exec(version)?.[1] ?? 0);
  return major >= 20
    ? item('PC-1a', 'Node', 'pass', `Node ${version}`)
    : item('PC-1a', 'Node', 'block', `Node ${version} (20 이상 필요)`, {
        why: '하네스와 제품 API가 Node 20 이상을 요구합니다',
        how: 'Node 20 이상을 설치한 뒤 다시 실행하세요',
      });
}

export function evalPnpm(execPath: string | undefined): PcItem {
  return execPath
    ? item('PC-1b', 'pnpm', 'pass', 'pnpm 진입 경로 확인')
    : item('PC-1b', 'pnpm', 'warn', 'pnpm 실행 경로를 알 수 없습니다(npm_execpath 없음)', {
        why: 'pnpm이 아니라 node로 직접 실행한 경우입니다. 빌드 명령은 셸을 거쳐 실행합니다',
        how: 'pnpm demo 로 실행하면 이 경고가 사라집니다',
      });
}

// ── PC-2 의존성 ────────────────────────────────────────────────────────────────
export function evalDependencies(missing: string[]): PcItem {
  return missing.length === 0
    ? item('PC-2', '의존성 설치', 'pass', '하네스·API 의존성 확인')
    : item('PC-2', '의존성 설치', 'block', `설치되지 않은 항목: ${missing.join(', ')}`, {
        why: 'node_modules가 없어 하네스나 제품을 실행할 수 없습니다',
        how: '저장소 루트에서  pnpm install  을 실행하세요',
      });
}

// ── PC-3 venv ──────────────────────────────────────────────────────────────────
export function evalVenv(exists: boolean, pythonPath: string): PcItem {
  return exists
    ? item('PC-3', '문장 분석 서버 가상환경(.venv)', 'pass', 'ml-worker venv 확인')
    : item('PC-3', '문장 분석 서버 가상환경(.venv)', 'block', `venv 파이썬이 없습니다: ${pythonPath}`, {
        why: '문장 분석 서버(ml-worker)를 실행할 파이썬 환경이 만들어지지 않았습니다',
        how: 'pnpm --filter ml-worker run setup  을 실행하세요',
      });
}

// ── PC-4 KURE-v1 캐시 ───────────────────────────────────────────────────────────
export function evalModelCache(snapshotCount: number, hasRefsMain: boolean, hubDir: string): PcItem {
  if (snapshotCount >= 1 && hasRefsMain) {
    return item('PC-4', '모델 캐시(KURE-v1)', 'pass', `snapshots ${snapshotCount}개 · refs/main 있음`, { data: { hubDir } });
  }
  return item('PC-4', '모델 캐시(KURE-v1)', 'block', `모델 캐시가 불완전합니다(snapshots ${snapshotCount}개 · refs/main ${hasRefsMain ? '있음' : '없음'})`, {
    why: '폐쇄망 시연은 모델을 내려받지 않으므로 캐시가 미리 있어야 합니다(하네스는 자동으로 내려받지 않습니다)',
    how: 'docs/05-ops/자동배포.md §5.8-6 의 모델 반입 절차로 nlpai-lab/KURE-v1 캐시를 준비하세요',
  });
}

// ── PC-5 브라우저(실제 기동은 browser/launch.ts) ──────────────────────────────────
export function evalBrowserProbe(ok: boolean, kind: string, detail: string, version?: string): PcItem {
  return ok
    ? item('PC-5', '브라우저', 'pass', `${kind}${version ? ' ' + version : ''} 시험 실행 성공`)
    : item('PC-5', '브라우저', 'block', `${kind} 시험 실행 실패: ${detail}`, {
        why: '지정한 브라우저를 Playwright로 띄우지 못했습니다',
        how: '--browser chrome  또는  --browser <실행 파일 경로>  로 바꾸세요(사다리: msedge, chrome, 지정 파일, chromium 반입, 무인 점검은 none)',
      });
}

// ── PC-6 Playwright 전용 ffmpeg ──────────────────────────────────────────────────
export function evalFfmpeg(exists: boolean, expectedDir: string, needed: boolean): PcItem {
  if (exists) return item('PC-6', '영상 인코더(ffmpeg)', 'pass', 'Playwright 전용 ffmpeg 확인', { data: { dir: expectedDir } });
  if (!needed) return item('PC-6', '영상 인코더(ffmpeg)', 'info', '영상을 쓰지 않아 확인하지 않았습니다');
  return item('PC-6', '영상 인코더(ffmpeg)', 'warn', `영상 인코더가 없어 영상은 만들지 않습니다(${expectedDir})`, {
    why: 'Playwright 영상 녹화는 전용 ffmpeg가 있어야 하며, 없으면 브라우저 기동이 실패합니다',
    how: '인터넷 PC에서 playwright-core install ffmpeg 로 받은 ffmpeg-<버전> 폴더를 같은 위치에 복사하세요(약 3.5MB)',
  });
}

// ── PC-7 디스크 ────────────────────────────────────────────────────────────────
const GB = 1024 ** 3;
export function evalDisk(freeBytes: number | null, dir: string): PcItem {
  if (freeBytes === null) return item('PC-7', '디스크 여유', 'info', '여유 공간을 확인하지 못했습니다');
  const gb = (freeBytes / GB).toFixed(1);
  if (freeBytes < 1 * GB) {
    return item('PC-7', '디스크 여유', 'block', `실행 폴더 드라이브 여유 ${gb}GB (1GB 미만)`, {
      why: '격리 DB·로그·영상·캡처를 저장할 공간이 부족합니다',
      how: `${dir} 가 있는 드라이브에서 공간을 확보하거나  --runs-dir  로 다른 드라이브를 지정하세요`,
    });
  }
  if (freeBytes < 2 * GB) {
    return item('PC-7', '디스크 여유', 'warn', `실행 폴더 드라이브 여유 ${gb}GB (권장 2GB)`, {
      why: '영상 녹화가 길어지면 공간이 모자랄 수 있습니다',
      how: '공간을 확보하거나  --no-video  로 영상을 끄세요',
    });
  }
  return item('PC-7', '디스크 여유', 'pass', `여유 ${gb}GB`);
}

// ── PC-8 포트 ──────────────────────────────────────────────────────────────────
export function evalPorts(checks: PortCheck[], owners: PortOwner[]): PcItem {
  const busy = checks.filter((c) => !c.free);
  if (busy.length === 0) {
    return item('PC-8', '포트', 'pass', `포트 ${checks.map((c) => c.port).join(' ')} 비어 있음`);
  }
  const first = busy[0];
  const own = owners.find((o) => o.port === first.port);
  const who = own ? ` (PID ${own.pid}${own.imageName ? ' ' + own.imageName : ''})` : '';
  return item(
    'PC-8',
    '포트',
    'block',
    `포트 ${first.port}(${PORT_LABELS[first.name]})을 다른 프로그램이 사용 중입니다${who}` +
      (busy.length > 1 ? ` 외 ${busy.length - 1}개: ${busy.slice(1).map((c) => c.port).join(' ')}` : ''),
    {
      why: '이전 개발 서버나 다른 앱이 같은 포트를 쓰고 있습니다',
      how: '해당 프로그램을 끄거나  pnpm demo -- --port-offset 100  으로 포트를 옮기세요',
      data: { busy: busy.map((c) => c.port) },
    },
  );
}

// ── PC-9 외부망 ────────────────────────────────────────────────────────────────
export function evalNetwork(dnsOk: boolean, tcpOk: boolean, requireOffline: boolean): PcItem {
  const open = dnsOk || tcpOk;
  if (!open) return item('PC-9', '외부망', 'pass', '외부망 차단됨(이름 해석·연결 모두 실패)', { data: { offline: true } });
  if (requireOffline) {
    return item('PC-9', '외부망', 'block', '외부 인터넷이 열려 있습니다(--require-offline)', {
      why: `이름 해석 ${dnsOk ? '성공' : '실패'} · 외부 연결 ${tcpOk ? '성공' : '실패'}`,
      how: '시연 PC의 네트워크를 차단하고 다시 실행하세요',
      data: { offline: false },
    });
  }
  return item('PC-9', '외부망', 'warn', '외부 인터넷이 열려 있습니다(--require-offline이면 중단)', {
    why: `이름 해석 ${dnsOk ? '성공' : '실패'} · 외부 연결 ${tcpOk ? '성공' : '실패'}`,
    how: '시연 PC의 네트워크를 차단하고 다시 실행하면 가장 확실합니다',
    data: { offline: false },
  });
}

// ── PC-10 Ollama ───────────────────────────────────────────────────────────────
export function evalOllama(processRunning: boolean, portListening: boolean): PcItem {
  if (!processRunning && !portListening) return item('PC-10', 'Ollama', 'pass', 'Ollama가 꺼져 있습니다');
  return item('PC-10', 'Ollama', 'warn', `Ollama가 실행 중입니다(프로세스 ${processRunning ? '있음' : '없음'} · 11434 ${portListening ? '수신' : '미수신'})`, {
    why: '구축형 시연의 "GPU 없이 CPU로" 메시지와 자원 경쟁(RAM·CPU)이 생길 수 있습니다. 하네스는 남의 프로세스를 끄지 않습니다',
    how: '시연 전에 Ollama를 종료하세요(작업 표시줄 트레이에서 종료)',
  });
}

// ── PC-11 메모리 ───────────────────────────────────────────────────────────────
/** 16GB(십진 표기)급 PC는 운영체제 보고값이 15.8GiB 안팎이라 16e9 바이트를 기준으로 삼는다. */
export const MIN_RAM_BYTES = 16e9;
export const LOW_FREE_RAM_BYTES = 2 * GB;
export function evalMemory(totalBytes: number, freeBytes: number): PcItem[] {
  const out: PcItem[] = [];
  const totalGb = (totalBytes / 1e9).toFixed(1);
  const freeGb = (freeBytes / 1e9).toFixed(1);
  if (totalBytes < MIN_RAM_BYTES) {
    out.push(item('PC-11a', '메모리', 'warn', `총 RAM ${totalGb}GB (권장 16GB)`, {
      why: 'KURE-v1 CPU 추론에 약 3GB가 상주하고 브라우저·API가 함께 돕니다',
      how: '다른 프로그램을 닫거나 RAM이 더 큰 PC를 쓰세요',
    }));
  } else out.push(item('PC-11a', '메모리', 'pass', `총 RAM ${totalGb}GB`));
  if (freeBytes < LOW_FREE_RAM_BYTES) {
    out.push(item('PC-11b', '가용 메모리', 'warn', `가용 RAM ${freeGb}GB (2GiB 미만)`, {
      why: '모델 적재 직후 단건 지연이 평소의 3~10배로 늘 수 있습니다(2026-10-01 실측)',
      how: '브라우저 탭·IDE 등 메모리를 많이 쓰는 프로그램을 닫고 다시 실행하세요',
    }));
  } else out.push(item('PC-11b', '가용 메모리', 'info', `가용 RAM ${freeGb}GB`));
  return out;
}

// ── PC-12~15 정보 ──────────────────────────────────────────────────────────────
export function evalGpuInfo(lines: string[] | null): PcItem {
  return lines && lines.length > 0
    ? item('PC-12', 'GPU 정보', 'info', `GPU 있음: ${lines[0]} (시연은 CUDA_VISIBLE_DEVICES=-1로 비노출)`, { data: { gpu: lines } })
    : item('PC-12', 'GPU 정보', 'info', 'GPU 없음(또는 nvidia-smi 없음)', { data: { gpu: [] } });
}

export function evalGit(sha: string | null, dirty: boolean | null): PcItem {
  if (sha === null) return item('PC-13', '작업 트리', 'info', 'git 정보를 읽지 못했습니다');
  return item('PC-13', '작업 트리', 'info', `커밋 ${sha.slice(0, 8)} · ${dirty ? '변경 있음(dirty)' : '깨끗함'}`, { data: { sha, dirty } });
}

export interface FileFingerprint {
  exists: boolean;
  size?: number;
  mtimeMs?: number;
}

export function evalDevDb(fp: FileFingerprint): PcItem {
  return fp.exists
    ? item('PC-14', 'dev.db 지문', 'info', `dev.db 크기 ${fp.size}바이트(읽기만 — 정리 단계에서 변화 0 확인)`, { data: { ...fp } })
    : item('PC-14', 'dev.db 지문', 'info', 'dev.db 없음', { data: { ...fp } });
}

/** `.env` 줄에서 키 이름만 뽑는다 — 값은 읽지 않는다(`=` 앞까지만 해석). */
export function parseEnvKeyNames(text: string): string[] {
  const keys: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).replace(/^export\s+/, '').trim();
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) keys.push(key);
  }
  return keys;
}

export function evalEnvKeys(api: string[] | null, ml: string[] | null): PcItem {
  const fmt = (k: string[] | null) => (k === null ? '파일 없음' : k.length === 0 ? '키 없음' : `${k.length}개`);
  return item('PC-15', '개발자 .env 키 이름', 'info', `apps/api ${fmt(api)} · apps/ml-worker ${fmt(ml)} (모두 차단 대상 — 값은 읽지 않음)`, {
    data: { api: api ?? [], mlWorker: ml ?? [] },
  });
}

export function evalDistOutputs(missing: string[], buildSkipped: boolean): PcItem {
  if (missing.length === 0) return item('PC-DIST', '빌드 산출물', 'pass', 'api · 콘솔 · 위젯 dist 확인');
  const msg = `없는 산출물: ${missing.join(', ')}`;
  return buildSkipped
    ? item('PC-DIST', '빌드 산출물', 'block', msg, {
        why: '--no-build라 빌드를 건너뛰는데 산출물이 없습니다',
        how: '--no-build 없이 실행하거나  pnpm build  를 먼저 실행하세요',
      })
    : item('PC-DIST', '빌드 산출물', 'info', `${msg} (빌드 단계에서 만들어집니다)`);
}
