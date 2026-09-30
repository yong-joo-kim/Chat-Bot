import { Injectable } from '@nestjs/common';
import type { GuardrailPiiKind, GuardrailSettingsResponse, UpdateGuardrailSettingsDto } from '@chat-bot/shared-types';
import { ChatbotScopeService } from '../chatbots/chatbot-scope.service';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { ApiException } from '../common/api.exception';
import type { SessionUser } from '../common/auth/session-context';
import { GuardrailSettingStore } from './core/guardrail-setting.store';
import { GuardrailRuntimeService } from './runtime/guardrail-runtime.service';
import { defaultExitSetting, parseKinds } from './runtime/guardrail-profile.loader';
import { governanceFloorKinds, normalizeKinds } from './lib/exit-pii';

/**
 * 챗봇별 출구 개인정보 가림 설정(설계서 §7.4) — 종류 5종 · 날짜 보호. 행이 없으면 기본값(주민번호·카드 + 날짜 보호).
 * 거버넌스 모드 ON이면 `RRN`·`CARD`는 끌 수 없다(저장 400 `GOVERNANCE_FLOOR` · 런타임도 합집합 강제).
 */
@Injectable()
export class GuardrailSettingsService {
  constructor(
    private readonly scope: ChatbotScopeService,
    private readonly auditLog: AuditLogService,
    private readonly store: GuardrailSettingStore,
    private readonly runtime: GuardrailRuntimeService,
  ) {}

  async get(chatbotId: string): Promise<GuardrailSettingsResponse> {
    await this.scope.assertReadable(chatbotId);
    return this.view(chatbotId);
  }

  async update(chatbotId: string, dto: UpdateGuardrailSettingsDto, user: SessionUser | null): Promise<GuardrailSettingsResponse> {
    const chatbot = await this.scope.assertWritable(chatbotId);
    const kinds = normalizeKinds(dto.piiExit.kinds);
    const floor = governanceFloorKinds(this.runtime.isGovernanceOn());
    const missing = floor.filter((k) => !kinds.includes(k));
    if (missing.length > 0) {
      throw new ApiException('VALIDATION_FAILED', 400, '입력값을 확인해 주세요.', [
        { field: 'piiExit.kinds', message: 'GOVERNANCE_FLOOR: 거버넌스 모드에서는 주민등록번호·카드번호 가림을 끌 수 없습니다.' },
      ]);
    }

    const beforeRow = await this.store.find(chatbotId);
    const before = beforeRow ? { kinds: parseKinds(beforeRow.piiExitKinds), preserveDates: beforeRow.piiPreserveDates } : { kinds: defaultExitSetting().kinds, preserveDates: true };
    await this.store.upsert(chatbotId, kinds, dto.piiExit.preserveDates, { id: user?.id ?? null, email: user?.email ?? null });
    this.runtime.invalidate(chatbotId, 'SETTINGS');

    await this.auditLog.record({
      action: 'UPDATE',
      targetType: 'Chatbot',
      targetId: chatbotId,
      targetName: chatbot.name,
      chatbotId,
      before: { guardrailPiiExit: before },
      after: { guardrailPiiExit: { kinds, preserveDates: dto.piiExit.preserveDates } },
      summary: 'AI 답변 개인정보 가림 설정 변경',
    });
    return this.view(chatbotId);
  }

  private async view(chatbotId: string): Promise<GuardrailSettingsResponse> {
    const row = await this.store.find(chatbotId);
    const setting = row ? { kinds: parseKinds(row.piiExitKinds) as GuardrailPiiKind[], preserveDates: row.piiPreserveDates } : defaultExitSetting();
    return {
      piiExit: { kinds: setting.kinds, preserveDates: setting.preserveDates },
      isDefault: !row,
      governanceFloor: governanceFloorKinds(this.runtime.isGovernanceOn()),
      serverEnabled: this.runtime.isServerEnabled(),
    };
  }
}
