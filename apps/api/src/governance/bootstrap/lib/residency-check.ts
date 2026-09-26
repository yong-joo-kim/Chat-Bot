import * as path from 'node:path';

/**
 * ★ 저장 위치 기동 검증(No.45 §5.2) — 순수(주입된 `fsImpl`만 사용). SQLite는 **절대 경로**를
 * 요구하고 심볼릭 링크를 해석한 뒤 허용 디렉터리 하위인지 검사한다. 원격 DB는 호스트 정확 일치.
 */
export interface ResidencyFsPort {
  existsSync(p: string): boolean;
  realpathSync(p: string): string;
}

export interface ResidencyCheckResult {
  ok: boolean;
  reason?: string;
}

function normalize(p: string): string {
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

export function checkResidency(databaseUrl: string, allowedDirs: readonly string[], allowedDbHosts: readonly string[], fsImpl: ResidencyFsPort): ResidencyCheckResult {
  if (databaseUrl.startsWith('file:')) {
    if (allowedDirs.length === 0) return { ok: true };
    const rawPath = databaseUrl.slice('file:'.length);
    if (!path.isAbsolute(rawPath)) {
      return { ok: false, reason: `거버넌스 모드에서는 SQLite 파일 경로가 절대 경로여야 합니다: ${rawPath}` };
    }
    let target: string;
    try {
      target = fsImpl.existsSync(rawPath) ? fsImpl.realpathSync(rawPath) : path.join(fsImpl.realpathSync(path.dirname(rawPath)), path.basename(rawPath));
    } catch {
      return { ok: false, reason: `저장 경로를 확인할 수 없습니다: ${rawPath}` };
    }
    const normalizedTarget = normalize(target);
    const allowed = allowedDirs.some((dir) => {
      let realDir: string;
      try {
        realDir = fsImpl.realpathSync(dir);
      } catch {
        return false;
      }
      const rel = path.relative(normalize(realDir), normalizedTarget);
      return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
    });
    return allowed ? { ok: true } : { ok: false, reason: `허용된 저장 경로(DATA_RESIDENCY_ALLOWED_DIRS) 밖입니다: ${rawPath}` };
  }

  // 원격 DB(Postgres 등)
  if (allowedDbHosts.length === 0) return { ok: true };
  try {
    const u = new URL(databaseUrl);
    const host = u.hostname.toLowerCase();
    const allowed = allowedDbHosts.some((h) => h.toLowerCase() === host);
    return allowed ? { ok: true } : { ok: false, reason: `허용된 DB 호스트(DATA_RESIDENCY_ALLOWED_DB_HOSTS)가 아닙니다: ${host}` };
  } catch {
    return { ok: false, reason: 'DATABASE_URL 형식을 해석할 수 없습니다.' };
  }
}
