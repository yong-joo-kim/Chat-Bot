// DB 직접 쓰기 — 하네스에서 `@prisma/client`와 제품 비밀번호 해시를 만지는 **유일한 파일**(정적 시험 H-S1·S3).
// 직접 쓰는 이유는 2가지뿐이다(설계 DHD-6): ① 첫 ADMIN 1명(사용자 생성 API는 로그인한 ADMIN이 필요) ② 과거 14일 대화 로그(과거 시각을 받는 API 없음).
// 재개(`--resume`)용 비밀번호 재발급도 여기서 한다. 쓰는 모델은 `user`·`conversationLog` 2개뿐이다(감사·세션 테이블 0 — NFR-DHS6).
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { normalizeEmail } from '@chat-bot/shared-types';
import { assertIsolatedDbUrl, toSqliteUrl } from '../env/db-guard';
import { sleepMs } from '../util/wait-for';
import type { HistoryLogRow } from './history';

interface PrismaLike {
  user: {
    upsert(args: unknown): Promise<{ id: string }>;
    update(args: unknown): Promise<unknown>;
  };
  conversationLog: {
    createMany(args: { data: unknown[] }): Promise<{ count: number }>;
    count(args?: unknown): Promise<number>;
  };
  $disconnect(): Promise<void>;
}

export interface DbDirectOptions {
  dbPath: string;
  runDir: string;
  devDbPath: string;
  /** `apps/api` 디렉터리 — `@prisma/client`와 빌드된 비밀번호 해시 모듈을 여기서 해석한다. */
  apiDir: string;
}

export class DbDirect {
  private client: PrismaLike | null = null;
  private hash: ((pw: string) => Promise<string>) | null = null;

  constructor(private readonly opts: DbDirectOptions) {}

  /** 클라이언트 생성 전에 격리 DB 가드를 한 번 더 지난다(설계 §18 S-1). */
  private async open(): Promise<PrismaLike> {
    if (this.client) return this.client;
    const url = toSqliteUrl(this.opts.dbPath);
    assertIsolatedDbUrl(url, this.opts.runDir, this.opts.devDbPath);
    const req = createRequire(join(this.opts.apiDir, 'package.json'));
    // `@prisma/client`는 require 시점에 apps/api/.env를 process.env로 읽어 들인다 — 하네스 프로세스가 오염되지 않게 새 키를 지운다.
    const before = new Set(Object.keys(process.env));
    const mod = req('@prisma/client') as { PrismaClient: new (o: unknown) => PrismaLike };
    for (const k of Object.keys(process.env)) if (!before.has(k)) delete process.env[k];
    this.client = new mod.PrismaClient({ datasources: { db: { url } }, log: [] });
    const hashMod = req(join(this.opts.apiDir, 'dist', 'common', 'auth', 'lib', 'password-hash.js')) as { hashPassword: (pw: string) => Promise<string> };
    this.hash = hashMod.hashPassword;
    for (const k of Object.keys(process.env)) if (!before.has(k)) delete process.env[k];
    return this.client;
  }

  /** 첫 ADMIN(ADMIN1): `mustChangePassword:false · ACTIVE`(설계 §7.2). 이미 있으면 비밀번호만 갱신한다(재실행 멱등). */
  async upsertUser(u: { email: string; name: string; role: 'ADMIN' | 'EDITOR' | 'VIEWER' | 'AGENT'; password: string }): Promise<string> {
    const db = await this.open();
    const email = normalizeEmail(u.email);
    const passwordHash = await this.hash!(u.password);
    const row = await db.user.upsert({
      where: { email },
      update: { passwordHash, mustChangePassword: false, status: 'ACTIVE', failedLoginCount: 0, lockedUntil: null },
      create: { email, name: u.name, role: u.role, passwordHash, mustChangePassword: false, status: 'ACTIVE' },
    });
    return row.id;
  }

  /** `--resume`: 격리 DB의 계정 비밀번호를 새 무작위 값으로 바꾼다(디스크에 비밀 0). 감사 로그에 남지 않는 DB 직접 쓰기다. */
  async resetPassword(email: string, password: string): Promise<void> {
    const db = await this.open();
    const passwordHash = await this.hash!(password);
    await db.user.update({
      where: { email: normalizeEmail(email) },
      data: { passwordHash, mustChangePassword: false, failedLoginCount: 0, lockedUntil: null },
    });
  }

  /** 과거 대화 로그 일괄 삽입(SQLite 잠금 경합 시 200ms 후 3회 재시도 — 설계 §7.7). */
  async insertHistoricalLogs(rows: readonly HistoryLogRow[]): Promise<number> {
    const db = await this.open();
    let inserted = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      for (let attempt = 0; ; attempt++) {
        try {
          const r = await db.conversationLog.createMany({ data: chunk as unknown[] });
          inserted += r.count;
          break;
        } catch (e) {
          if (attempt >= 3) throw e;
          await sleepMs(200);
        }
      }
    }
    return inserted;
  }

  async countLogs(): Promise<number> {
    const db = await this.open();
    return db.conversationLog.count();
  }

  async close(): Promise<void> {
    await this.client?.$disconnect().catch(() => undefined);
    this.client = null;
  }
}
