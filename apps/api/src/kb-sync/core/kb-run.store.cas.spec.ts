import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaService } from '../../prisma/prisma.service';
import { KbRunStore } from './kb-run.store';

/**
 * [R1 리뷰 H-1] `claimAnySlot()`의 CAS(compare-and-swap) 화이트박스 시험 — `findUnique`(읽기)와
 * `updateMany`(쓰기) **사이**에 다른 클레이머가 끼어드는 상황을 `jest.spyOn`으로 주입해, where 절이
 * 그 끼어듦을 실제로 감지하는지(count 0 → `null` 반환) 검증한다. `Promise.all`로 두 호출을 "동시에"
 * 돌리는 방식은 Node 이벤트 루프·SQLite 드라이버의 실제 인터리빙에 좌우돼 이 특정 경합을 안정적으로
 * 재현하지 못해(관찰됨) 결정론적 주입 방식을 쓴다.
 *
 * 진단 참고 — 이 파일 작성 과정에서 Prisma 쿼리 로그를 직접 찍어 확인해 보니, 수정 전 코드
 * (`OR: [{ claimToken: null }, { claimToken: row?.claimToken ?? undefined }]`)도 claimToken이
 * null인 빈 슬롯 경우에는 실제로 `WHERE claimToken IS NULL`로만 컴파일돼(Prisma가 완전히 undefined인
 * 갈래를 OR 배열에서 통째로 가지치기하는 것으로 보인다) 이 구체적인 화이트박스 시나리오에서는 수정
 * 전후 동일하게 통과했다 — 즉 이 시험은 "예전 코드가 반드시 실패한다"를 보이지는 못했다. 그래도
 * 수정한 표현(`claimToken: row?.claimToken ?? null` 단순 동등 비교)이 Prisma의 내부 가지치기 동작에
 * 기대지 않는 더 명확하고 안전한 코드라는 점은 그대로 유효하고, 이 시험은 **수정된 코드의 CAS 불변식
 * 자체**(끼어들면 반드시 실패한다)를 회귀 방지용으로 고정한다.
 */
const API_ROOT = join(__dirname, '..', '..', '..');

async function safeCleanupTmpDir(dir: string): Promise<void> {
  await new Promise((r) => setTimeout(r, 200));
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // Windows 파일 핸들 지연 해제 — 판정에 영향 없음.
  }
}

describe('KbRunStore.claimAnySlot — CAS 화이트박스(H-1)', () => {
  let tmpDir: string;
  let prisma: PrismaService;
  let store: KbRunStore;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'chatbot-kb-run-store-cas-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;
    process.env.DATABASE_URL = testDatabaseUrl;

    try {
      execSync('pnpm exec prisma migrate deploy', { cwd: API_ROOT, env: { ...process.env, DATABASE_URL: testDatabaseUrl }, stdio: 'pipe' });
    } catch (e) {
      const err = e as { stdout?: Buffer; stderr?: Buffer };
      throw new Error(`prisma migrate deploy 실패:\n${err.stdout?.toString()}\n${err.stderr?.toString()}`);
    }

    prisma = new PrismaService();
    await prisma.$connect();
    store = new KbRunStore(prisma);
  }, 30_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await safeCleanupTmpDir(tmpDir);
  }, 15_000);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('빈 슬롯을 정상적으로 1회 획득한다(회귀 방지 — 고친 where가 정상 경로를 깨지 않는지)', async () => {
    await store.ensureLeaseRow('SLOT_NORMAL');
    const slotKey = await store.claimAnySlot(['SLOT_NORMAL'], 600_000, new Date(), 'holder-1');
    expect(slotKey).toMatch(/^SLOT_NORMAL:/);
    await store.releaseSlot(slotKey!);
  });

  it('★ read(findUnique)와 write(updateMany) 사이에 다른 인스턴스가 먼저 빈 슬롯을 가져가면, CAS가 이를 감지해 null을 반환한다', async () => {
    await store.ensureLeaseRow('SLOT_RACE');

    const originalFindUnique = prisma.kbJobLease.findUnique.bind(prisma.kbJobLease);
    const spy = jest.spyOn(prisma.kbJobLease, 'findUnique').mockImplementationOnce((async (args: Parameters<typeof originalFindUnique>[0]) => {
      const result = await originalFindUnique(args);
      // 인터리빙 주입 — "이 읽기 직후, 내가 쓰기 전에" 다른 인스턴스가 먼저 이 빈 슬롯을 가져간다.
      await prisma.kbJobLease.updateMany({
        where: { name: 'SLOT_RACE' },
        data: { claimToken: 'interloper-token', claimedAt: new Date(), holderJobId: 'interloper' },
      });
      return result;
    }) as unknown as typeof originalFindUnique);

    const slotKey = await store.claimAnySlot(['SLOT_RACE'], 600_000, new Date(), 'me');

    expect(slotKey).toBeNull(); // 끼어든 뒤 값이 달라졌으니 CAS는 반드시 실패해야 한다.
    expect(spy).toHaveBeenCalledTimes(1);

    // 끼어든 쪽(interloper)이 여전히 슬롯을 쥐고 있는지 — 내 시도가 그 상태를 덮어쓰지 않았는지 확인.
    const row = await prisma.kbJobLease.findUnique({ where: { name: 'SLOT_RACE' } });
    expect(row?.claimToken).toBe('interloper-token');
    expect(row?.holderJobId).toBe('interloper');
  });

  it('빈 슬롯 2개 중 하나가 끼어들기를 당해도 남은 슬롯은 정상 획득한다(다중 슬롯 순회 확인)', async () => {
    await store.ensureLeaseRow('SLOT_A');
    await store.ensureLeaseRow('SLOT_B');

    const originalFindUnique = prisma.kbJobLease.findUnique.bind(prisma.kbJobLease);
    jest.spyOn(prisma.kbJobLease, 'findUnique').mockImplementationOnce((async (args: Parameters<typeof originalFindUnique>[0]) => {
      const result = await originalFindUnique(args);
      await prisma.kbJobLease.updateMany({ where: { name: 'SLOT_A' }, data: { claimToken: 'interloper-2', claimedAt: new Date(), holderJobId: 'interloper' } });
      return result;
    }) as unknown as typeof originalFindUnique);

    const slotKey = await store.claimAnySlot(['SLOT_A', 'SLOT_B'], 600_000, new Date(), 'me');
    expect(slotKey).toMatch(/^SLOT_B:/); // SLOT_A는 끼어들기로 실패하고, 순회가 이어져 SLOT_B를 잡는다.
  });

  /**
   * [pass 4] Prisma의 `undefined` 처리를 추측하지 않고 **실제로 확인해 고정**한다(2026-09-28 실측 — 이 프로젝트의 Prisma 버전).
   * 결론: where의 `undefined` 필드는 조건이 통째로 **빠진다**(= "아무 값이나"). 그래서 `claimToken: token`의 token이 `undefined`로
   * 새면 CAS가 아니라 무조건 갱신이 된다 — `releaseSlot()`이 형식이 잘못된 슬롯 키를 거르는 이유. 반면 `null`은 `IS NULL`이고,
   * `OR` 안의 `undefined` 갈래는 "참"이 아니라 가지치기된다(그래서 예전 `OR: [{ claimToken: null }, { claimToken: row?.claimToken ?? undefined }]`
   * 코드도 우연히 안전했다). 이 시험은 Prisma를 올릴 때 그 전제가 깨지면 알려 준다.
   */
  describe('Prisma where의 undefined·null 의미(실측 고정)', () => {
    async function seed(name: string, claimToken: string | null): Promise<void> {
      await prisma.kbJobLease.create({ data: { name, claimToken, claimedAt: claimToken ? new Date() : null } });
    }

    it('where의 undefined 필드는 조건이 빠진다 — 점유된 행에도 맞는다(count 1)', async () => {
      await seed('PROBE_UNDEF_HELD', 'held');
      const { count } = await prisma.kbJobLease.updateMany({ where: { name: 'PROBE_UNDEF_HELD', claimToken: undefined }, data: { holderJobId: 'x' } });
      expect(count).toBe(1);
    });

    it('where의 null은 IS NULL이다 — 점유된 행에는 맞지 않고(0) 빈 행에는 맞는다(1)', async () => {
      await seed('PROBE_NULL_HELD', 'held');
      await seed('PROBE_NULL_EMPTY', null);
      expect((await prisma.kbJobLease.updateMany({ where: { name: 'PROBE_NULL_HELD', claimToken: null }, data: { holderJobId: 'x' } })).count).toBe(0);
      expect((await prisma.kbJobLease.updateMany({ where: { name: 'PROBE_NULL_EMPTY', claimToken: null }, data: { holderJobId: 'x' } })).count).toBe(1);
    });

    it('OR 안의 undefined 갈래는 "참"이 아니라 가지치기된다 — [null, undefined]는 점유된 행에 맞지 않는다(0)', async () => {
      await seed('PROBE_OR_HELD', 'held');
      await seed('PROBE_OR_EMPTY', null);
      const or = [{ claimToken: null }, { claimToken: undefined }];
      expect((await prisma.kbJobLease.updateMany({ where: { name: 'PROBE_OR_HELD', OR: or }, data: { holderJobId: 'x' } })).count).toBe(0);
      expect((await prisma.kbJobLease.updateMany({ where: { name: 'PROBE_OR_EMPTY', OR: or }, data: { holderJobId: 'x' } })).count).toBe(1);
    });
  });

  describe('releaseSlot·renewSlot — 형식이 잘못된 슬롯 키는 아무것도 바꾸지 않는다(토큰이 undefined로 새면 남의 슬롯까지 놓는다)', () => {
    it('토큰이 없는 키("NAME" · "NAME:" · ":tok")로는 점유 중인 슬롯을 놓거나 연장하지 못한다', async () => {
      await store.ensureLeaseRow('SLOT_GUARD');
      const slotKey = await store.claimAnySlot(['SLOT_GUARD'], 600_000, new Date(), 'guard');
      expect(slotKey).toMatch(/^SLOT_GUARD:/);

      for (const bad of ['SLOT_GUARD', 'SLOT_GUARD:', ':tok', '']) {
        await store.releaseSlot(bad);
        expect(await store.renewSlot(bad, new Date())).toBe(false);
        const row = await prisma.kbJobLease.findUnique({ where: { name: 'SLOT_GUARD' } });
        expect(row?.claimToken).not.toBeNull(); // 여전히 점유 중이다.
      }
      // 다른 토큰으로도 놓을 수 없다(CAS).
      await store.releaseSlot('SLOT_GUARD:not-my-token');
      expect((await prisma.kbJobLease.findUnique({ where: { name: 'SLOT_GUARD' } }))?.claimToken).not.toBeNull();
      // 제 토큰으로는 놓인다.
      await store.releaseSlot(slotKey!);
      expect((await prisma.kbJobLease.findUnique({ where: { name: 'SLOT_GUARD' } }))?.claimToken).toBeNull();
    });
  });
});
