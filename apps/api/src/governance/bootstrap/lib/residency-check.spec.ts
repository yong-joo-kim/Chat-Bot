import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync, realpathSync as realRealpathSync, existsSync as realExistsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkResidency, type ResidencyFsPort } from './residency-check';

/**
 * ★ 저장 위치 기동 검증(AC-DG2-1) — 지금까지 이 순수 함수(`checkResidency`)를 직접 겨냥한
 * 시험 파일이 없었다(통합 시험도 `DATA_RESIDENCY_ALLOWED_DIRS`를 다루지 않는다). test-automation
 * 보강(2026-09-26). 실제 파일시스템(임시 디렉터리)을 써서 심볼릭 링크 우회까지 재현한다
 * (Windows에서 디렉터리 심볼릭 링크 생성 권한이 없으면 해당 케이스만 건너뛴다).
 */
describe('checkResidency(No.45 §5.2) — 저장 위치 기동 검증', () => {
  it('허용 목록이 비어 있으면(레지던시 미설정) 항상 통과한다', () => {
    const fsPort: ResidencyFsPort = { existsSync: () => false, realpathSync: (p) => p };
    expect(checkResidency('file:/anywhere/x.db', [], [], fsPort)).toEqual({ ok: true });
  });

  it('SQLite 상대 경로는 허용 목록이 있으면 거부한다(절대 경로 필수)', () => {
    const fsPort: ResidencyFsPort = { existsSync: () => false, realpathSync: (p) => p };
    const result = checkResidency('file:relative/x.db', ['/a'], [], fsPort);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/절대 경로/);
  });

  it('허용 디렉터리 하위의 절대 경로는 통과한다(가짜 fs — 파일 존재)', () => {
    const fsPort: ResidencyFsPort = {
      existsSync: (p) => p === '/a/x.db',
      realpathSync: (p) => p, // 심볼릭 링크 없음 — 그대로 반환
    };
    expect(checkResidency('file:/a/x.db', ['/a'], [], fsPort)).toEqual({ ok: true });
  });

  it('허용 디렉터리 밖의 절대 경로는 실패한다(가짜 fs)', () => {
    const fsPort: ResidencyFsPort = {
      existsSync: (p) => p === '/b/x.db',
      realpathSync: (p) => p,
    };
    const result = checkResidency('file:/b/x.db', ['/a'], [], fsPort);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/허용된 저장 경로/);
  });

  it('허용 디렉터리 자기 자신(파일이 아니라 디렉터리 경로 자체)은 허용 대상이 아니다(상대 경로 "" 제외)', () => {
    const fsPort: ResidencyFsPort = {
      existsSync: (p) => p === '/a',
      realpathSync: (p) => p,
    };
    const result = checkResidency('file:/a', ['/a'], [], fsPort);
    expect(result.ok).toBe(false);
  });

  it('심볼릭 링크로 허용 디렉터리 밖을 가리키면 실패한다(가짜 fs — realpath가 실제 대상을 반환)', () => {
    // /a/link.db는 심볼릭 링크처럼 보이지만 realpathSync가 /outside/real.db(허용 목록 밖)를 반환한다.
    const fsPort: ResidencyFsPort = {
      existsSync: (p) => p === '/a/link.db',
      realpathSync: (p) => {
        if (p === '/a/link.db') return '/outside/real.db';
        if (p === '/a') return '/a';
        return p;
      },
    };
    const result = checkResidency('file:/a/link.db', ['/a'], [], fsPort);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/허용된 저장 경로/);
  });

  it('원격 DB(Postgres 등) — 허용 호스트 목록에 있으면 통과, 없으면 실패한다', () => {
    const fsPort: ResidencyFsPort = { existsSync: () => false, realpathSync: (p) => p };
    expect(checkResidency('postgres://user:pass@db.internal:5432/app', [], ['db.internal'], fsPort)).toEqual({ ok: true });
    const blocked = checkResidency('postgres://user:pass@outside.example.com:5432/app', [], ['db.internal'], fsPort);
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toMatch(/허용된 DB 호스트/);
  });

  it('원격 DB — URL 형식이 아니면 실패한다', () => {
    const fsPort: ResidencyFsPort = { existsSync: () => false, realpathSync: (p) => p };
    const result = checkResidency('not-a-valid-url', [], ['db.internal'], fsPort);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/해석할 수 없습니다/);
  });

  describe('실제 파일시스템 — 심볼릭 링크 우회(AC-DG2-1)', () => {
    let root: string;
    let allowedDir: string;
    let outsideDir: string;
    let symlinkSupported = true;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), 'residency-check-test-'));
      allowedDir = join(root, 'allowed');
      outsideDir = join(root, 'outside');
      mkdirSync(allowedDir);
      mkdirSync(outsideDir);
      writeFileSync(join(outsideDir, 'real.db'), 'x');
      try {
        symlinkSync(join(outsideDir, 'real.db'), join(allowedDir, 'link.db'));
      } catch {
        symlinkSupported = false; // Windows에서 권한 없으면 이 describe 블록의 시험을 건너뛴다.
      }
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    const realFs: ResidencyFsPort = { existsSync: realExistsSync, realpathSync: realRealpathSync };

    it('허용 디렉터리 안의 실제 파일은 통과한다', () => {
      writeFileSync(join(allowedDir, 'x.db'), 'x');
      expect(checkResidency(`file:${join(allowedDir, 'x.db')}`, [allowedDir], [], realFs)).toEqual({ ok: true });
    });

    it('허용 디렉터리 안의 심볼릭 링크가 허용 디렉터리 밖의 실제 파일을 가리키면 실패한다', () => {
      if (!symlinkSupported) return; // Windows 권한 제약 — CI/로컬 환경에 따라 건너뛴다.
      const result = checkResidency(`file:${join(allowedDir, 'link.db')}`, [allowedDir], [], realFs);
      expect(result.ok).toBe(false);
    });
  });
});
