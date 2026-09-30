import { Injectable } from '@nestjs/common';
import type { GuardrailPiiKind } from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import type { RuleActor } from './guardrail-rule.store';

/**
 * ★ `ChatbotGuardrailSetting` 쓰기 유일 파일(AG-4) — 출구 개인정보 가림 설정 upsert.
 * 챗봇 영구삭제 동반 삭제(`chatbots.service.ts`)만 예외다.
 */
@Injectable()
export class GuardrailSettingStore {
  constructor(private readonly prisma: PrismaService) {}

  find(chatbotId: string) {
    return this.prisma.chatbotGuardrailSetting.findUnique({ where: { chatbotId } });
  }

  upsert(chatbotId: string, kinds: readonly GuardrailPiiKind[], preserveDates: boolean, actor: RuleActor) {
    const data = { piiExitKinds: JSON.stringify(kinds), piiPreserveDates: preserveDates, updatedById: actor.id, updatedByEmail: actor.email };
    return this.prisma.chatbotGuardrailSetting.upsert({ where: { chatbotId }, create: { chatbotId, ...data }, update: data });
  }
}
