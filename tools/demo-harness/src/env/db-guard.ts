// 격리 DB 경로 가드(설계 §18 S-1 · AC-DH1-6 · AC-DH2-4) — 하네스는 실행 폴더 안 SQLite 파일만 허용한다.
// `apps/api/prisma/dev.db`·상대 경로·원격 DB 스킴·실행 폴더 밖 경로는 기동 전에 거부한다.
import { isAbsolute, relative, resolve } from 'node:path';

export class DbGuardError extends Error {
  constructor(
    message: string,
    public readonly why: string,
    public readonly how: string,
  ) {
    super(message);
    this.name = 'DbGuardError';
  }
}

function norm(p: string): string {
  const r = resolve(p);
  return process.platform === 'win32' ? r.toLowerCase() : r;
}

/** `file:` URL에서 파일 경로만 뽑는다(쿼리 제거 · `file:///C:/x` 형태 지원). 해석 불가면 null. */
export function sqlitePathFromUrl(url: string): string | null {
  if (!url.startsWith('file:')) return null;
  let p = url.slice('file:'.length);
  const q = p.indexOf('?');
  if (q >= 0) p = p.slice(0, q);
  if (/^\/\/\/[A-Za-z]:/.test(p)) p = p.slice(3); // file:///D:/x -> D:/x
  else if (p.startsWith('//')) return null; // UNC·호스트가 붙은 형태
  return p;
}

/** 통과하면 정규화된 절대 파일 경로를 돌려준다. */
export function assertIsolatedDbUrl(url: string, runDir: string, devDbPath: string): string {
  if (!url.startsWith('file:')) {
    throw new DbGuardError(
      `DB 주소가 SQLite 파일(file:)이 아닙니다: ${url.split('@').pop()?.slice(0, 40) ?? ''}`,
      '하네스는 실행 폴더 안의 SQLite 파일만 사용할 수 있습니다(원격 DB 접근 금지)',
      '실행 폴더 아래의 file:<절대 경로> 주소를 쓰세요',
    );
  }
  const raw = sqlitePathFromUrl(url);
  if (raw === null || raw === '') {
    throw new DbGuardError(`DB 파일 경로를 해석할 수 없습니다: ${url}`, 'file: 뒤에 경로가 없거나 지원하지 않는 형태입니다', 'file:D:/경로/demo.db 형태로 지정하세요');
  }
  if (!isAbsolute(raw)) {
    throw new DbGuardError(
      `DB 파일 경로가 상대 경로입니다: ${raw}`,
      '상대 경로는 어느 폴더 기준인지 달라질 수 있어 개발 DB를 건드릴 위험이 있습니다',
      '실행 폴더 아래의 절대 경로를 지정하세요',
    );
  }
  const target = norm(raw);
  if (target === norm(devDbPath)) {
    throw new DbGuardError('개발 DB(apps/api/prisma/dev.db)는 사용할 수 없습니다', '시연 하네스는 개발 데이터를 오염하지 않는 것이 원칙입니다', '실행 폴더 아래의 새 DB 파일을 쓰세요');
  }
  const rel = relative(norm(runDir), target);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new DbGuardError(
      `DB 파일이 실행 폴더 밖에 있습니다: ${raw}`,
      `허용 위치는 ${runDir} 아래뿐입니다`,
      '실행 폴더 아래의 경로로 바꾸세요',
    );
  }
  return resolve(raw);
}

/** Prisma·거버넌스 검사가 모두 받는 형태의 URL(슬래시 경로, 공백 그대로). */
export function toSqliteUrl(absPath: string): string {
  return `file:${absPath.replace(/\\/g, '/')}`;
}
