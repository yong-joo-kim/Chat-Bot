import { AuditLogService } from './audit-log.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RequestContextService } from '../common/request-context/request-context.service';
import { installGovernanceRuntime, resetGovernanceRuntimeForTest } from '../common/governance/governance-runtime';

/**
 * ★ test-automation 보강(2026-09-26) — `AuditLogService.recordView()` 단위 시험(AC-DG7-2/7-3,
 * `data-governance-설계.md` §11.3 · §21.1 "recordView 모드 OFF 쿼리 0·LRU·일 경계"). 지금까지
 * `audit-logs/**`에 이 서비스를 직접 겨냥한 `*.spec.ts`가 하나도 없었다(전부 통합 시험으로만 커버).
 */
function makePrisma(): { findFirst: jest.Mock; create: jest.Mock; prisma: PrismaService } {
  const findFirst = jest.fn().mockResolvedValue(null);
  const create = jest.fn().mockResolvedValue({ id: 'row-1' });
  const prisma = {
    auditLog: { findFirst, create },
    auditChainHead: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ headSeq: 1, headHash: 'g1:genesis' }), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    auditChainAnchor: { findUnique: jest.fn().mockResolvedValue(null), count: jest.fn().mockResolvedValue(0), findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
  } as unknown as PrismaService;
  return { findFirst, create, prisma };
}

function makeRequestContext(actorId: string | undefined): RequestContextService {
  return { get: () => (actorId ? { actor: { id: actorId, email: 'admin@test.local', role: 'ADMIN' } } : undefined) } as unknown as RequestContextService;
}

describe('AuditLogService.recordView (AC-DG7-2/7-3)', () => {
  afterEach(() => {
    resetGovernanceRuntimeForTest();
  });

  it('AC-DG7-3: 모드 OFF(미설치 기본값)에서는 쿼리 0으로 즉시 반환한다', async () => {
    const { findFirst, create, prisma } = makePrisma();
    const service = new AuditLogService(prisma, makeRequestContext('actor-1'));

    await service.recordView({ targetType: 'AuditLog', targetId: '*' });

    expect(findFirst).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('모드 ON이어도 인증 주체가 없는 경로(공개·시스템)는 기록하지 않는다', async () => {
    installGovernanceRuntime({ mode: 'ON', egress: { allowlist: [], enforce: true }, encryptionEnabled: false });
    const { findFirst, create, prisma } = makePrisma();
    const service = new AuditLogService(prisma, makeRequestContext(undefined));

    await service.recordView({ targetType: 'AuditLog', targetId: '*' });

    expect(findFirst).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('AC-DG7-2: 모드 ON · 같은 열람자·리소스 — 첫 호출은 기록하고, 인스턴스 로컬 LRU 덕분에 같은 프로세스의 두 번째 호출은 DB 중복 조회조차 하지 않는다', async () => {
    installGovernanceRuntime({ mode: 'ON', egress: { allowlist: [], enforce: true }, encryptionEnabled: false });
    const { findFirst, create, prisma } = makePrisma();
    const service = new AuditLogService(prisma, makeRequestContext('actor-1'));

    await service.recordView({ targetType: 'AuditLog', targetId: 'log-1' });
    expect(findFirst).toHaveBeenCalledTimes(1); // 첫 호출은 DB 중복 확인
    expect(create).toHaveBeenCalledTimes(1); // 없었으므로 기록

    await service.recordView({ targetType: 'AuditLog', targetId: 'log-1' });
    // LRU 적중 — 두 번째 호출은 findFirst조차 다시 부르지 않는다(§11.3 "인스턴스 로컬 LRU").
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('모드 ON · 다른 targetId는 서로 다른 기록으로 취급한다', async () => {
    installGovernanceRuntime({ mode: 'ON', egress: { allowlist: [], enforce: true }, encryptionEnabled: false });
    const { create, prisma } = makePrisma();
    const service = new AuditLogService(prisma, makeRequestContext('actor-1'));

    await service.recordView({ targetType: 'AuditLog', targetId: 'log-1' });
    await service.recordView({ targetType: 'AuditLog', targetId: 'log-2' });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('모드 ON · DB에 오늘자 기존 VIEW 행이 이미 있으면(다른 인스턴스가 기록) 다시 기록하지 않는다', async () => {
    installGovernanceRuntime({ mode: 'ON', egress: { allowlist: [], enforce: true }, encryptionEnabled: false });
    const { findFirst, create, prisma } = makePrisma();
    findFirst.mockResolvedValueOnce({ id: 'existing-row' });
    const service = new AuditLogService(prisma, makeRequestContext('actor-1'));

    await service.recordView({ targetType: 'AuditLog', targetId: 'log-1' });
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
  });
});
