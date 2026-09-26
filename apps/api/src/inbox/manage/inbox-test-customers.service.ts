import { Injectable } from '@nestjs/common';
import type { CreateTestCustomerDto, CreateTestCustomerResponse, SimulateInboxDto, SimulateInboxResponse } from '@chat-bot/shared-types';
import type { SessionUser } from '../../common/auth/session-context';
import { ApiException } from '../../common/api.exception';
import { AuditLogService } from '../../audit-logs/audit-log.service';
import { BannedWordFilterService } from '../../banned-words/banned-word-filter.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SimulationService } from '../../simulation/simulation.service';
import { buildBotResponseText } from '../../conversation/lib/conversation-log';
import { InboxStore } from '../core/inbox.store';
import { maskForInbox } from '../core/lib/masked-text';
import { prepareDisplayName } from '../core/lib/display-name';
import { InboxParticipationCache } from '../core/inbox-participation.cache';

const NOT_FOUND = '요청하신 시험 고객을 찾을 수 없습니다.';

/** [신규 No.42] 시험 고객 생성·삭제·시뮬레이션(§10.2 — 기존 시뮬레이터 엔진 경로 재사용). */
@Injectable()
export class InboxTestCustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: InboxStore,
    private readonly participation: InboxParticipationCache,
    private readonly simulation: SimulationService,
    private readonly auditLog: AuditLogService,
    private readonly bannedWordFilter: BannedWordFilterService,
  ) {}

  async create(dto: CreateTestCustomerDto, actor: SessionUser): Promise<CreateTestCustomerResponse> {
    // [코드리뷰 R1 반영 M-2] sanitizeDisplayName() → 금지어 마스킹 → maskForInbox() — 식별 서비스와 같은 순서.
    // 정리 후 빈 문자열이 되는 극단값(제어 문자만 입력)은 원래 값을 그대로 마스킹해 라벨 없음을 피한다.
    const label = (await prepareDisplayName(dto.label, this.bannedWordFilter)) ?? maskForInbox(dto.label);
    const result = await this.store.createTestCustomer({ label, createdById: actor.id, createdByName: actor.name, now: new Date() });
    await this.auditLog.record({ action: 'CREATE', targetType: 'Customer', targetId: result.customerId, summary: `시험 고객 생성 #${result.customerId.slice(0, 6)}` });
    return result;
  }

  async remove(customerId: string, actor: SessionUser): Promise<void> {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer || customer.kind !== 'TEST') throw new ApiException('NOT_FOUND', 404, NOT_FOUND);
    await this.store.deleteTestCustomer(customerId);
    await this.auditLog.record({ action: 'DELETE', targetType: 'Customer', targetId: customerId, summary: `시험 고객 삭제 #${customer.ref.slice(0, 6)}` });
  }

  async simulate(customerId: string, dto: SimulateInboxDto, actor: SessionUser): Promise<SimulateInboxResponse> {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer || customer.kind !== 'TEST') throw new ApiException('NOT_FOUND', 404, NOT_FOUND);
    const participating = await this.participation.isParticipating(dto.chatbotId);
    if (!participating) throw new ApiException('VALIDATION_FAILED', 400, '참여 중인 챗봇이 아닙니다.');

    const thread = await this.prisma.inboxThread.findUnique({ where: { customerId } });
    if (!thread) throw new ApiException('NOT_FOUND', 404, '시험 고객의 스레드를 찾을 수 없습니다.');

    const result = await this.simulation.simulate(
      dto.chatbotId,
      {
        message: dto.message,
        buttonAction: dto.buttonAction,
        state: dto.state,
        target: dto.target,
        useRag: false,
        apiMode: 'MOCK',
        surveyPreview: false,
        includeInactiveTopics: false,
      } as never,
      actor,
    );

    const userText = dto.message ?? (dto.buttonAction?.kind === 'MESSAGE' ? dto.buttonAction.text : '(버튼 선택)');
    const botText = buildBotResponseText(result.outputs);
    const now = new Date();
    const { userEntryId, botEntryId } = await this.store.createSimulationEntries(thread.id, dto.chatbotId, dto.simulatedChannel, maskForInbox(userText), maskForInbox(botText), now);

    return {
      outputs: result.outputs,
      state: result.state,
      stateReset: result.stateDiscarded.length > 0,
      entries: [
        { kind: 'SIM_USER', at: now, entryId: userEntryId, text: userText },
        { kind: 'SIM_BOT', at: now, entryId: botEntryId, text: botText },
      ] as never,
      degradePreview: 'NOT_DEFINED',
    };
  }
}
