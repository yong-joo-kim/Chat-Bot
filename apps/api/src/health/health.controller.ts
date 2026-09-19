import { Controller, Get, Version, VERSION_NEUTRAL } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  // 배포/스모크 체크 호환을 위해 버전 중립(/api/health)으로 유지한다(ADR-0003).
  @Version(VERSION_NEUTRAL)
  @Get()
  async check(): Promise<{ db: 'ok' | 'error' }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { db: 'ok' };
    } catch {
      return { db: 'error' };
    }
  }
}
