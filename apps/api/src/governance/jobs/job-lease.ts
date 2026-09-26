import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { isLeaseExpired } from '../../common/polling/lease';

/**
 * ★ `GovernanceJobState` 임대 선점·갱신·해제(CAS) — 파기 잡·재암호화 잡 2파일이 공용으로 쓴다
 * (No.45 §9.1·§7.6). 행 보장(create-if-absent)은 부트스트랩이 담당한다.
 */
@Injectable()
export class GovernanceJobLease {
  constructor(private readonly prisma: PrismaService) {}

  async ensureRow(jobName: string): Promise<void> {
    try {
      await this.prisma.governanceJobState.create({ data: { jobName } });
    } catch {
      // P2002 — 이미 존재(다른 인스턴스가 먼저 만들었거나 재기동) — 무시.
    }
  }

  /** 임대 선점 — 성공하면 claimToken, 실패(다른 인스턴스 보유)면 null. */
  async claim(jobName: string, leaseMs: number, now: Date): Promise<string | null> {
    const token = randomUUID();
    const row = await this.prisma.governanceJobState.findUnique({ where: { jobName } });
    if (!row) {
      await this.ensureRow(jobName);
    }
    const current = row ?? (await this.prisma.governanceJobState.findUnique({ where: { jobName } }));
    const free = !current?.claimedAt || !current.claimToken || isLeaseExpired(current.claimedAt, now, leaseMs);
    if (!free) return null;

    const result = await this.prisma.governanceJobState.updateMany({
      where: { jobName, OR: [{ claimToken: null }, { claimToken: current?.claimToken ?? undefined }] },
      data: { claimToken: token, claimedAt: now },
    });
    return result.count === 1 ? token : null;
  }

  async renew(jobName: string, claimToken: string, now: Date): Promise<boolean> {
    const result = await this.prisma.governanceJobState.updateMany({ where: { jobName, claimToken }, data: { claimedAt: now } });
    return result.count === 1;
  }

  async release(jobName: string, claimToken: string): Promise<void> {
    await this.prisma.governanceJobState.updateMany({ where: { jobName, claimToken }, data: { claimToken: null, claimedAt: null } });
  }
}
