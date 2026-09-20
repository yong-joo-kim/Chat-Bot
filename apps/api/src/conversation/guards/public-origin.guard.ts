import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { WebChannelConfigSchema } from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiException } from '../../common/api.exception';
import { isOriginAllowed } from '../lib/origin-match';

/**
 * Origin 서버 가드(NFR-S3, DD-30, ADR-0011). CORS 헤더가 아니라 서버 인가로 판정한다 —
 * CORS는 브라우저 정책일 뿐 `curl`/서버 간 호출은 통과하므로 그것만으로는 보호가 성립하지 않는다.
 * `allowedOrigins`는 매 요청 직접 조회한다(캐시 없음 — 즉시 반영, §8.1/§8.7).
 * `Origin` 헤더가 없으면 통과한다(서버 간 호출·동일 출처는 CORS로 보호되는 대상이 아니다).
 */
@Injectable()
export class PublicOriginGuard implements CanActivate {
  private readonly logger = new Logger('PublicOriginGuard');

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const slug = req.params?.slug;
    const origin = req.headers.origin;

    if (!slug) return true;

    const chatbot = await this.prisma.chatbot.findUnique({ where: { slug }, select: { id: true } });
    if (!chatbot) return true; // 404는 PublicAccessService가 낸다(§8.3 ④).

    const channel = await this.prisma.channel.findUnique({
      where: { chatbotId_type: { chatbotId: chatbot.id, type: 'WEB' } },
      select: { config: true },
    });
    if (!channel) return true; // CHANNEL_DISABLED는 PublicAccessService가 낸다.

    const allowedOrigins = parseAllowedOrigins(channel.config);
    if (isOriginAllowed(origin, allowedOrigins)) return true;

    this.logger.warn(`허용되지 않은 Origin 요청 차단: chatbotId=${chatbot.id} origin=${origin ?? '(none)'}`);
    throw new ApiException('ORIGIN_NOT_ALLOWED', 403, '허용되지 않은 도메인에서의 요청입니다.');
  }
}

function parseAllowedOrigins(configJson: string): string[] {
  try {
    const parsed = WebChannelConfigSchema.safeParse(JSON.parse(configJson));
    return parsed.success ? parsed.data.allowedOrigins : [];
  } catch {
    return [];
  }
}
