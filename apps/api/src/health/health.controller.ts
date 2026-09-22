import { Controller, Get, Version, VERSION_NEUTRAL } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../common/auth/public.decorator';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  // 배포/스모크 체크 호환을 위해 버전 중립(/api/health)으로 유지한다(ADR-0003).
  // 인증을 요구하면 오케스트레이터가 재시작 루프에 빠진다(@Public() 5곳 중 1, DD-45).
  @Public()
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
