import { Injectable } from '@nestjs/common';
import type { ChatbotInboxIdentityUpdateDto, ChatbotInboxSettingsResponse, ChatbotInboxSettingsUpdateDto } from '@chat-bot/shared-types';
import { ApiException } from '../../common/api.exception';
import { AuditLogService } from '../../audit-logs/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InboxParticipationCache } from '../core/inbox-participation.cache';
import { InboxIdentitySecretResolver } from '../identity/inbox-identity-secret.resolver';
import { IdentityFailureCounter } from '../identity/identity-failure-counter';

const NOT_FOUND = '요청하신 챗봇을 찾을 수 없습니다.';

/**
 * ★ [신규 No.42] `chatbotInboxSetting` 쓰기 유일(영구삭제 동반 삭제 제외) — 저장 즉시 참여 캐시
 * 무효화(§6.3·§16). 환경 밖.
 */
@Injectable()
export class ChatbotInboxSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly participation: InboxParticipationCache,
    private readonly secretResolver: InboxIdentitySecretResolver,
    private readonly failureCounter: IdentityFailureCounter,
    private readonly auditLog: AuditLogService,
  ) {}

  private async assertChatbot(chatbotId: string): Promise<{ id: string; status: string; name: string }> {
    const row = await this.prisma.chatbot.findUnique({ where: { id: chatbotId }, select: { id: true, status: true, name: true } });
    if (!row) throw new ApiException('NOT_FOUND', 404, NOT_FOUND);
    return row;
  }

  async get(chatbotId: string): Promise<ChatbotInboxSettingsResponse> {
    await this.assertChatbot(chatbotId);
    const row = await this.prisma.chatbotInboxSetting.findUnique({ where: { chatbotId } });
    const ref = row?.identitySecretRef ?? null;
    const stats = this.failureCounter.stats24h(chatbotId);
    // keyFingerprintChanged — 고객 키 비밀 교체 탐지는 2차(K-3): 지금은 항상 false.
    return {
      chatbotId,
      enabled: row?.enabled ?? false,
      openOnWarning: row?.openOnWarning ?? false,
      identity: {
        secretRef: ref,
        secretStatus: this.secretResolver.secretStatus(ref),
        customerKeyStatus: this.secretResolver.customerKeyStatus(),
        keyFingerprintChanged: false,
        stats24h: { verified: stats.verified, failures: stats.failures, scope: 'INSTANCE' },
      },
      environmentNotice: 'OUTSIDE_ENVIRONMENT',
      updatedAt: row?.updatedAt ?? null,
    };
  }

  async update(chatbotId: string, dto: ChatbotInboxSettingsUpdateDto): Promise<ChatbotInboxSettingsResponse> {
    const chatbot = await this.assertChatbot(chatbotId);
    if (chatbot.status === 'ARCHIVED') throw new ApiException('CHATBOT_ARCHIVED', 409, '보관된 챗봇은 수정할 수 없습니다.');
    await this.prisma.chatbotInboxSetting.upsert({
      where: { chatbotId },
      create: { chatbotId, enabled: dto.enabled, openOnWarning: dto.openOnWarning },
      update: { enabled: dto.enabled, openOnWarning: dto.openOnWarning },
    });
    this.participation.invalidate();
    await this.auditLog.record({ action: 'UPDATE', targetType: 'Chatbot', targetId: chatbotId, targetName: chatbot.name, summary: '통합 인박스 설정 변경' });
    return this.get(chatbotId);
  }

  async updateIdentity(chatbotId: string, dto: ChatbotInboxIdentityUpdateDto): Promise<ChatbotInboxSettingsResponse> {
    const chatbot = await this.assertChatbot(chatbotId);
    if (chatbot.status === 'ARCHIVED') throw new ApiException('CHATBOT_ARCHIVED', 409, '보관된 챗봇은 수정할 수 없습니다.');
    const before = await this.prisma.chatbotInboxSetting.findUnique({ where: { chatbotId } });
    await this.prisma.chatbotInboxSetting.upsert({
      where: { chatbotId },
      create: { chatbotId, identitySecretRef: dto.identitySecretRef },
      update: { identitySecretRef: dto.identitySecretRef },
    });
    this.participation.invalidate();
    await this.auditLog.record({
      action: 'UPDATE',
      targetType: 'Chatbot',
      targetId: chatbotId,
      targetName: chatbot.name,
      summary: `식별 비밀 참조: ${before?.identitySecretRef ?? '(없음)'} → ${dto.identitySecretRef ?? '(없음)'}`,
    });
    return this.get(chatbotId);
  }
}
