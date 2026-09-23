import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Chatbot as PrismaChatbot } from '@prisma/client';
import {
  Chatbot,
  ChatbotListItem,
  ChatbotListQuery,
  ChatbotStatus,
  CopyChatbotDto,
  CreateChatbotDto,
  DEFAULT_CHATBOT_SKIN,
  MoveChatbotGroupDto,
  Paginated,
  PermanentDeleteChatbotDto,
  RESERVED_SLUGS,
  SlugAvailability,
  SlugAvailabilityQuery,
  UpdateChatbotSettingsDto,
  UpdateChatbotSkinDto,
  UpdateChatbotStatusDto,
} from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/api.exception';
import { toPaginated } from '../common/pagination';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { toChatbotDto, toChatbotListItemDto } from './chatbot.mapper';
import { deriveCopyName } from './lib/copy-name.util';
import { deriveCopySlug, SlugDerivationExhaustedError } from './lib/slug.util';
import { evaluateStatusTransition } from './lib/status-transition';
import { mergeSkin, parseSkin, serializeSkin } from './lib/skin.util';

/** 영구 삭제 사전 검사 대상(ADR-0002 §7.8) — 사용자에게 보여줄 한글 라벨. */
const CHILD_COUNT_LABELS: Record<string, string> = {
  intents: '의도',
  keywords: '키워드',
  homonyms: '동음이의어',
  dialogNodes: '대화노드',
  contextVariables: '컨텍스트 변수',
  faqs: 'FAQ',
  channels: '채널',
  conversationLogs: '대화로그',
  unansweredQuestions: '미응답 질문',
};

const NOT_FOUND_MESSAGE = '요청하신 대상을 찾을 수 없습니다.';

@Injectable()
export class ChatbotsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  /** StatsModule 등 타 모듈의 존재 검증에 사용된다(설계서 §6 chatbots.module.ts 주석). */
  async existsById(id: string): Promise<boolean> {
    const row = await this.prisma.chatbot.findUnique({ where: { id }, select: { id: true } });
    return row !== null;
  }

  async findRowOrThrow(id: string): Promise<PrismaChatbot> {
    const row = await this.prisma.chatbot.findUnique({ where: { id } });
    if (!row) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);
    return row;
  }

  async create(dto: CreateChatbotDto): Promise<Chatbot> {
    const group = await this.prisma.chatbotGroup.findUnique({ where: { id: dto.groupId } });
    if (!group) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);

    await this.assertSlugFree(dto.slug);

    const row = await this.prisma.chatbot.create({
      data: {
        groupId: dto.groupId,
        name: dto.name,
        avatarUrl: dto.avatarUrl,
        description: dto.description,
        slug: dto.slug,
        status: 'DRAFT',
        skin: JSON.stringify(DEFAULT_CHATBOT_SKIN),
      },
    });
    await this.auditLogService.record({ action: 'CREATE', targetType: 'Chatbot', targetId: row.id, targetName: row.name, chatbotId: row.id, after: row });
    return toChatbotDto(row);
  }

  async list(query: ChatbotListQuery): Promise<Paginated<ChatbotListItem>> {
    const where: Prisma.ChatbotWhereInput = {};
    if (query.groupId) where.groupId = query.groupId;

    if (query.status && query.status.length > 0) {
      where.status = { in: query.status };
    } else if (!query.includeArchived) {
      where.status = { not: 'ARCHIVED' };
    }

    if (query.q) {
      where.OR = [{ name: { contains: query.q } }, { slug: { contains: query.q } }];
    }

    const orderBy = { [query.sort]: query.order } as Prisma.ChatbotOrderByWithRelationInput;

    const [rows, total] = await Promise.all([
      this.prisma.chatbot.findMany({
        where,
        include: { group: { select: { name: true } } },
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.chatbot.count({ where }),
    ]);

    return toPaginated(rows.map(toChatbotListItemDto), total, query.page, query.pageSize);
  }

  async findOne(id: string): Promise<Chatbot> {
    return toChatbotDto(await this.findRowOrThrow(id));
  }

  async updateSettings(id: string, dto: UpdateChatbotSettingsDto): Promise<Chatbot> {
    const current = await this.findRowOrThrow(id);
    this.assertNotArchived(current);

    if (dto.slug !== undefined && dto.slug !== current.slug) {
      await this.assertSlugFree(dto.slug);
    }

    const row = await this.prisma.chatbot.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.avatarUrl !== undefined ? { avatarUrl: dto.avatarUrl } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.slug !== undefined ? { slug: dto.slug } : {}),
      },
    });
    await this.auditLogService.record({
      action: 'UPDATE',
      targetType: 'Chatbot',
      targetId: row.id,
      targetName: row.name,
      chatbotId: row.id,
      before: current,
      after: row,
    });
    return toChatbotDto(row);
  }

  async updateSkin(id: string, dto: UpdateChatbotSkinDto): Promise<Chatbot> {
    const current = await this.findRowOrThrow(id);
    this.assertNotArchived(current);

    const { skin: currentSkin } = parseSkin(current.skin);
    const nextSkin = mergeSkin(currentSkin, dto);

    const row = await this.prisma.chatbot.update({
      where: { id },
      data: { skin: serializeSkin(nextSkin) },
    });
    await this.auditLogService.record({
      action: 'UPDATE',
      targetType: 'Chatbot',
      targetId: row.id,
      targetName: row.name,
      chatbotId: row.id,
      before: current,
      after: row,
      summary: '스킨 변경',
    });
    return toChatbotDto(row);
  }

  async updateStatus(id: string, dto: UpdateChatbotStatusDto): Promise<Chatbot> {
    const current = await this.findRowOrThrow(id);
    const currentStatus = this.parseStatusOrDraft(current.status);

    const evaluation = evaluateStatusTransition(currentStatus, dto.status);
    if (evaluation.kind === 'denied') {
      throw new ApiException(
        'INVALID_STATUS_TRANSITION',
        400,
        `${currentStatus} 상태에서 ${dto.status} 상태로 바꿀 수 없습니다.`,
      );
    }
    if (evaluation.kind === 'noop') {
      return toChatbotDto(current);
    }

    const row = await this.prisma.chatbot.update({ where: { id }, data: { status: dto.status } });
    await this.auditLogService.record({
      action: 'STATUS_CHANGE',
      targetType: 'Chatbot',
      targetId: row.id,
      targetName: row.name,
      chatbotId: row.id,
      before: current,
      after: row,
      summary: `상태 변경: ${currentStatus} → ${dto.status}`,
    });
    return toChatbotDto(row);
  }

  async moveGroup(id: string, dto: MoveChatbotGroupDto): Promise<Chatbot> {
    const current = await this.findRowOrThrow(id);
    const group = await this.prisma.chatbotGroup.findUnique({ where: { id: dto.groupId } });
    if (!group) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);

    const row = await this.prisma.chatbot.update({ where: { id }, data: { groupId: dto.groupId } });
    await this.auditLogService.record({
      action: 'UPDATE',
      targetType: 'Chatbot',
      targetId: row.id,
      targetName: row.name,
      chatbotId: row.id,
      before: current,
      after: row,
      summary: '소속 그룹 이동',
    });
    return toChatbotDto(row);
  }

  async copy(id: string, dto: CopyChatbotDto): Promise<Chatbot> {
    const original = await this.findRowOrThrow(id);

    let targetGroupId = original.groupId;
    if (dto.targetGroupId) {
      const group = await this.prisma.chatbotGroup.findUnique({ where: { id: dto.targetGroupId } });
      if (!group) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);
      targetGroupId = dto.targetGroupId;
    }

    const name = dto.name ?? deriveCopyName(original.name);

    let slug: string;
    if (dto.slug) {
      await this.assertSlugFree(dto.slug);
      slug = dto.slug;
    } else {
      try {
        slug = await deriveCopySlug(original.slug, (candidate) => this.slugExists(candidate));
      } catch (e) {
        if (e instanceof SlugDerivationExhaustedError) {
          throw new ApiException('DUPLICATE_SLUG', 409, '이미 사용 중인 고유 URL입니다. 다른 값을 입력해 주세요.');
        }
        throw e;
      }
    }

    const row = await this.prisma.chatbot.create({
      data: {
        groupId: targetGroupId,
        name,
        slug,
        avatarUrl: original.avatarUrl,
        description: original.description,
        status: 'DRAFT',
        skin: original.skin,
      },
    });
    await this.auditLogService.record({ action: 'COPY', targetType: 'Chatbot', targetId: row.id, targetName: row.name, chatbotId: row.id, after: row });
    return toChatbotDto(row);
  }

  /** 보관 처리(FR-1-15(a)). 이미 ARCHIVED면 204 no-op(§7.2). */
  async archive(id: string): Promise<void> {
    const current = await this.findRowOrThrow(id);
    if (current.status === 'ARCHIVED') return;
    const row = await this.prisma.chatbot.update({ where: { id }, data: { status: 'ARCHIVED' } });
    await this.auditLogService.record({
      action: 'DELETE',
      targetType: 'Chatbot',
      targetId: row.id,
      targetName: row.name,
      chatbotId: row.id,
      before: current,
      after: row,
    });
  }

  /** 영구 삭제(FR-1-15(b), FR-1-16, ADR-0002 §7.8). */
  async permanentDelete(id: string, dto: PermanentDeleteChatbotDto): Promise<void> {
    const current = await this.findRowOrThrow(id);
    if (current.status !== 'ARCHIVED') {
      throw new ApiException('CHATBOT_NOT_ARCHIVED', 409, '보관 처리한 챗봇만 영구 삭제할 수 있습니다.');
    }
    if (dto.confirmName !== current.name) {
      throw new ApiException('CONFIRM_NAME_MISMATCH', 400, '챗봇 이름이 일치하지 않습니다.');
    }

    const [
      intents,
      keywords,
      homonyms,
      dialogNodes,
      contextVariables,
      faqs,
      channels,
      conversationLogs,
      unansweredQuestions,
    ] = await Promise.all([
      this.prisma.intent.count({ where: { chatbotId: id } }),
      this.prisma.keyword.count({ where: { chatbotId: id } }),
      this.prisma.homonymDictionary.count({ where: { chatbotId: id } }),
      this.prisma.dialogNode.count({ where: { chatbotId: id } }),
      this.prisma.contextVariable.count({ where: { chatbotId: id } }),
      this.prisma.faqEntry.count({ where: { chatbotId: id } }),
      this.prisma.channel.count({ where: { chatbotId: id } }),
      this.prisma.conversationLog.count({ where: { chatbotId: id } }),
      this.prisma.unansweredQuestion.count({ where: { chatbotId: id } }),
    ]);

    const counts: Record<string, number> = {
      intents,
      keywords,
      homonyms,
      dialogNodes,
      contextVariables,
      faqs,
      channels,
      conversationLogs,
      unansweredQuestions,
    };
    const nonZero = Object.entries(counts).filter(([, count]) => count > 0);
    if (nonZero.length > 0) {
      const detail = nonZero.map(([key, count]) => `${CHILD_COUNT_LABELS[key] ?? key} ${count}건`).join(', ');
      throw new ApiException('CHATBOT_HAS_CHILDREN', 409, `연결된 데이터(${detail})가 있어 삭제할 수 없습니다.`);
    }

    // FAQ/의도 매칭 고도화 그룹 추가(nlu-rag-answering-설계.md §6.6) — 이 3종은 사전검사(409) 대상이
    // 아니라 파생 데이터라 **삭제 대상**이다(ADR-0002의 "하위 데이터 제거" 분류). `embeddingVector`·
    // `chatbotAnswerSetting`은 FK가 `onDelete: Restrict`라 챗봇 삭제 전에 먼저 지워야 한다.
    // `ragCallLog`는 FK가 없어 막지는 않지만 로그 규약상 함께 정리한다.
    //
    // 학습 고도화 그룹(learning-augmentation-설계.md) 추가 — `augmentationSuggestion`·
    // `intentClassifierModel`·`trainingJob`도 `Chatbot`에 `onDelete: Restrict` FK가 걸려 있어
    // 챗봇 삭제 이전에 먼저 지워야 한다(같은 이유로 위 3종과 나란히 처리한다).
    //
    // 아래 6개 테이블 삭제 + 챗봇 로우 삭제는 원자적으로 처리해야 한다 — 중간 단계 실패 시 앞선
    // deleteMany가 이미 커밋된 채 챗봇만 ARCHIVED로 남는 부분 실행 상태를 막기 위해 트랜잭션으로
    // 묶는다(이 코드베이스의 다른 다중쓰기 로직과 동일한 컨벤션, 예: intents.service.ts).
    await this.prisma.$transaction(async (tx) => {
      await tx.embeddingVector.deleteMany({ where: { chatbotId: id } });
      await tx.chatbotAnswerSetting.deleteMany({ where: { chatbotId: id } });
      await tx.ragCallLog.deleteMany({ where: { chatbotId: id } });
      await tx.augmentationSuggestion.deleteMany({ where: { chatbotId: id } });
      await tx.intentClassifierModel.deleteMany({ where: { chatbotId: id } });
      await tx.trainingJob.deleteMany({ where: { chatbotId: id } });
      // 검증/품질 고도화 그룹(validation-regression-설계.md §4.3) 추가 — 4테이블도 대화 자산이 아닌
      // 챗봇 종속 파생 자산이라 사전검사(409) 대상이 아니라 동반 삭제 대상이다. FK 방향상
      // TestRunResult(runId) → TestRun(setId/chatbotId) → TestCase(setId) → TestCaseSet 순서로 지운다.
      await tx.testRunResult.deleteMany({ where: { run: { chatbotId: id } } });
      await tx.testRun.deleteMany({ where: { chatbotId: id } });
      await tx.testCase.deleteMany({ where: { chatbotId: id } });
      await tx.testCaseSet.deleteMany({ where: { chatbotId: id } });
      // 챗봇 복원/버전 이력관리(No.25) 그룹 추가(version-history-설계.md §13, FR-H1-21, AC-H4-7) — 사전
      // 검사(409) 대상이 아니라 동반 삭제 대상이다(ADR-0002 "하위 데이터 제거" 분류). payload →
      // version → sequence 순서로 지운다(FK 방향).
      await tx.chatbotVersionPayload.deleteMany({ where: { version: { chatbotId: id } } });
      await tx.chatbotVersion.deleteMany({ where: { chatbotId: id } });
      await tx.chatbotVersionSequence.deleteMany({ where: { chatbotId: id } });
      await tx.chatbot.delete({ where: { id } });
    });
    await this.auditLogService.record({
      action: 'PURGE',
      targetType: 'Chatbot',
      targetId: current.id,
      targetName: current.name,
      chatbotId: current.id,
      before: current,
    });
  }

  /** slug 실시간 중복 확인(FR-3-7). 형식 위반도 400이 아니라 `available:false, reason:'FORMAT'`으로 응답한다. */
  async checkSlugAvailability(query: SlugAvailabilityQuery): Promise<SlugAvailability> {
    const { slug, excludeChatbotId } = query;

    const formatValid = /^[a-z0-9-]+$/.test(slug) && slug.length >= 3 && slug.length <= 50;
    if (!formatValid) {
      return {
        slug,
        available: false,
        reason: 'FORMAT',
        message: '3~50자의 소문자/숫자/하이픈만 사용할 수 있습니다.',
      };
    }

    if ((RESERVED_SLUGS as readonly string[]).includes(slug)) {
      return { slug, available: false, reason: 'RESERVED', message: '사용할 수 없는 예약어입니다.' };
    }

    const taken = await this.slugExists(slug, excludeChatbotId);
    if (taken) {
      return {
        slug,
        available: false,
        reason: 'TAKEN',
        message: '이미 사용 중인 고유 URL입니다. 다른 값을 입력해 주세요.',
      };
    }

    return { slug, available: true, message: '사용할 수 있는 고유 URL입니다.' };
  }

  private async slugExists(slug: string, excludeChatbotId?: string): Promise<boolean> {
    const row = await this.prisma.chatbot.findUnique({ where: { slug }, select: { id: true } });
    if (!row) return false;
    return row.id !== excludeChatbotId;
  }

  private async assertSlugFree(slug: string): Promise<void> {
    if (await this.slugExists(slug)) {
      throw new ApiException('DUPLICATE_SLUG', 409, '이미 사용 중인 고유 URL입니다. 다른 값을 입력해 주세요.');
    }
  }

  private assertNotArchived(current: PrismaChatbot): void {
    if (current.status === 'ARCHIVED') {
      throw new ApiException(
        'CHATBOT_ARCHIVED',
        409,
        '보관된 챗봇은 수정할 수 없습니다. 초안으로 되돌린 뒤 수정해 주세요.',
      );
    }
  }

  private parseStatusOrDraft(rawStatus: string): ChatbotStatus {
    const result = ChatbotStatus.safeParse(rawStatus);
    return result.success ? result.data : 'DRAFT';
  }
}
