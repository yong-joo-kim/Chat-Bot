import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { validateDialogueDesign } from '@chat-bot/dialogue-engine';
import type { TopicSplitPreview, TopicSplitRequestDto, TopicSplitResult, TopicSplitSelection } from '@chat-bot/shared-types';
import { TOPIC_SPLIT_LIMITS } from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/api.exception';
import { isBusyError } from '../common/prisma/busy-error';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { DialogueBundleService } from '../dialogue-common/dialogue-bundle.service';
import { ChatbotCopyTargetService } from '../chatbots/chatbot-copy-target.service';
import { toChatbotDto } from '../chatbots/chatbot.mapper';
import { AssetTransferCaptureService } from '../asset-transfer/asset-transfer-capture.service';
import { AssetTransferLoader } from '../asset-transfer/asset-transfer.loader';
import { selectTransferSubset } from '../asset-transfer/lib/transfer-selection';
import type { TransferSource, TransferSubset } from '../asset-transfer/lib/transfer-selection';
import { planTransfer } from '../asset-transfer/lib/transfer-plan';
import { verifyTransferPlan } from '../asset-transfer/lib/transfer-verify';

const NOT_FOUND_MESSAGE = '요청하신 챗봇을 찾을 수 없습니다.';

const LIMIT_KEYS = ['intents', 'intentExamples', 'dialogNodes', 'faqs', 'keywords', 'homonyms', 'contexts', 'surveys'] as const;

function exceededLimits(totals: Record<(typeof LIMIT_KEYS)[number], number>): string[] {
  return LIMIT_KEYS.filter((k) => totals[k] > TOPIC_SPLIT_LIMITS[k]);
}

/**
 * [신규 — 자동시험 결함 수정(§14.5)] 캡처(무거운 `build()`) 전에 **선택 범위**(선택한 토픽 + 공통,
 * 폐포·시스템 노드 제외)의 자산 6종 행 수만 `count()`로 가볍게 먼저 확인한다. 선택 범위 카운트는
 * 실제 분리 대상(선택+폐포+시스템, §9.4)의 **엄격한 하한**이다 — 폐포는 항상 자산을 "추가"할 뿐
 * 제거하지 않으므로, 이 카운트가 이미 상한을 넘으면 최종 총합도 반드시 넘는다(오탐 불가능). 설문은
 * 토픽 비소속이라(§8) 선택으로 직접 잡히지 않고 폐포로만 들어오므로 이 사전 검사 대상이 아니다 —
 * 트랜잭션 안의 `exceededLimits`(폐포 포함 정확 판정)가 최종 방어선으로 남는다(이중 방어).
 * `intentExamples`도 행 수가 아니라 예문 배열 길이 합이라 `count()`로 셀 수 없어 사전 검사 대상이
 * 아니다 — 같은 이유로 트랜잭션 안의 정확 판정에 맡긴다.
 */
/** 6개 모델의 `WhereInput`이 구조적으로 동일한 부분(`chatbotId`·`topicId` 필터)만 쓴다 — 느슨한 타입으로 공유한다. */
function precheckWhere(chatbotId: string, topicIds: readonly string[], includeCommon: boolean): Record<string, unknown> {
  const or: Array<Record<string, unknown>> = [];
  if (topicIds.length > 0) or.push({ topicId: { in: [...topicIds] } });
  if (includeCommon) or.push({ topicId: null });
  // topicIds·includeCommon 둘 다 비어 있을 수 없다(zod refine이 이미 막는다) — 방어적으로 OR 0건이면
  // "매칭 없음"(id: 'never-matches')으로 자연히 처리된다.
  return { chatbotId, ...(or.length > 0 ? { OR: or } : { id: 'never-matches' }) };
}

const NOT_COPIED_KEYS = [
  'CHANNELS',
  'ANSWER_SETTING',
  'HANDOFF_SETTING',
  'CANNED_RESPONSES',
  'TEST_CASE_SETS',
  'UNANSWERED_QUESTIONS',
  'AUGMENTATION_SUGGESTIONS',
  'CLASSIFIER',
  'CONVERSATION_LOGS',
  'VERSIONS',
  'DEPLOY_SCHEDULES',
  'EMBEDDING_VECTORS',
  'SURVEY_RESPONSES',
] as const;

/** 분리 미리보기·실행 오케스트레이션(topic-system-설계.md §9.6). */
@Injectable()
export class TopicSplitService {
  private readonly logger = new Logger('TopicSplitService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
    private readonly bundleService: DialogueBundleService,
    private readonly copyTarget: ChatbotCopyTargetService,
    private readonly capture: AssetTransferCaptureService,
    private readonly loader: AssetTransferLoader,
  ) {}

  private async findChatbotOrThrow(chatbotId: string) {
    const row = await this.prisma.chatbot.findUnique({ where: { id: chatbotId } });
    if (!row) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);
    return row;
  }

  /**
   * [신규 — 자동시험 결함 수정(§14.5)] 캡처(`AssetTransferCaptureService` → `DialogueBundleService.build()`)
   * 전에 선택 범위(선택한 토픽 + 공통, 폐포·시스템 제외)의 자산 6종 행 수를 가벼운 `count()` 6회로
   * 먼저 확인한다. 하나라도 상한을 넘으면 캡처 없이 즉시 `422 TOPIC_SPLIT_TOO_LARGE`를 던진다.
   * **오탐 불가능**(§27 근거 참고) — 폐포는 항상 자산을 추가할 뿐이라 선택만의 카운트는 실제 합계의
   * 하한이다. `preview()`·`split()` 둘 다에서 호출한다(§9.6 "preview: DB 변경 0" 규약 — count는
   * 읽기 전용이라 위반하지 않는다).
   */
  private async precheckSelectionLimits(chatbotId: string, selection: { topicIds: readonly string[]; includeCommon: boolean }): Promise<void> {
    const where = precheckWhere(chatbotId, selection.topicIds, selection.includeCommon);
    const [intents, keywords, homonyms, contexts, faqs, dialogNodes] = await Promise.all([
      this.prisma.intent.count({ where: where as Prisma.IntentWhereInput }),
      this.prisma.keyword.count({ where: where as Prisma.KeywordWhereInput }),
      this.prisma.homonymDictionary.count({ where: where as Prisma.HomonymDictionaryWhereInput }),
      this.prisma.contextVariable.count({ where: where as Prisma.ContextVariableWhereInput }),
      this.prisma.faqEntry.count({ where: where as Prisma.FaqEntryWhereInput }),
      this.prisma.dialogNode.count({ where: where as Prisma.DialogNodeWhereInput }),
    ]);
    const totals = { intents, keywords, homonyms, contexts, faqs, dialogNodes };
    const exceeded = (Object.keys(totals) as Array<keyof typeof totals>).filter((k) => totals[k] > TOPIC_SPLIT_LIMITS[k]);
    if (exceeded.length > 0) {
      throw new ApiException(
        'TOPIC_SPLIT_TOO_LARGE',
        422,
        '선택한 범위가 동기 분리 상한을 초과합니다.',
        exceeded.map((k) => ({ field: k, message: String(totals[k]) })),
      );
    }
  }

  private buildPreview(subset: TransferSubset, source: TransferSource): TopicSplitPreview {
    const exceeded = exceededLimits(subset.totals);
    const nodeIndex = new Map(source.bundle.dialogNodes.map((n) => [n.id, n]));
    const topicMap = new Map(source.topics.map((t) => [t.id, t]));
    const resolveTarget = (nodeId: string): { targetName: string; targetTopicName: string } => {
      const node = nodeIndex.get(nodeId);
      if (!node) return { targetName: nodeId, targetTopicName: '' };
      const targetTopicName = node.topicId ? (topicMap.get(node.topicId)?.name ?? '삭제된 토픽') : '공통';
      return { targetName: node.name, targetTopicName };
    };
    return {
      selected: subset.selectedTotals,
      closureAdded: subset.closureAddedTotals,
      closureItems: { total: subset.closureItems.length, items: subset.closureItems.slice(0, 50) },
      systemNodes: { start: subset.systemNodes.start !== null, fallback: subset.systemNodes.fallback !== null },
      trimmedLinks: {
        total: subset.trimmedLinks.length,
        items: subset.trimmedLinks.slice(0, 50).map((t) => ({
          nodeId: t.nodeId,
          nodeName: t.nodeName,
          edge: t.link.edge,
          ...resolveTarget(t.link.targetNodeId),
          ...(t.link.reason ? { reason: t.link.reason } : {}),
        })),
      },
      followedSystemLinks: {
        total: subset.followedSystemLinks.length,
        // [신규 — M-2 코드리뷰 대응] TRIM_WOULD_EMPTY 보정으로 되돌려진 항목은 reason을 프런트에 넘긴다.
        items: subset.followedSystemLinks.slice(0, 50).map((t) => ({
          nodeId: t.nodeId,
          nodeName: t.nodeName,
          edge: t.link.edge,
          ...resolveTarget(t.link.targetNodeId),
          ...(t.link.reason ? { reason: t.link.reason } : {}),
        })),
      },
      totals: subset.totals,
      limits: {
        intents: TOPIC_SPLIT_LIMITS.intents,
        keywords: TOPIC_SPLIT_LIMITS.keywords,
        homonyms: TOPIC_SPLIT_LIMITS.homonyms,
        contexts: TOPIC_SPLIT_LIMITS.contexts,
        dialogNodes: TOPIC_SPLIT_LIMITS.dialogNodes,
        faqs: TOPIC_SPLIT_LIMITS.faqs,
        surveys: TOPIC_SPLIT_LIMITS.surveys,
        intentExamples: TOPIC_SPLIT_LIMITS.intentExamples,
        nodeIntentLinks: 0,
        nodeKeywordLinks: 0,
      },
      exceeded,
      closureDominates:
        subset.closureAddedTotals.intents +
          subset.closureAddedTotals.keywords +
          subset.closureAddedTotals.homonyms +
          subset.closureAddedTotals.contexts +
          subset.closureAddedTotals.dialogNodes +
          subset.closureAddedTotals.faqs >
        subset.selectedTotals.intents +
          subset.selectedTotals.keywords +
          subset.selectedTotals.homonyms +
          subset.selectedTotals.contexts +
          subset.selectedTotals.dialogNodes +
          subset.selectedTotals.faqs,
      apiConnectionsKept: 0,
      notCopied: [...NOT_COPIED_KEYS],
    };
  }

  /** DB 변경 0 · 트랜잭션 없음(§9.6). [신규] 무거운 `build()` 전에 선택 범위 사전 검사를 먼저 한다. */
  async preview(chatbotId: string, selection: TopicSplitSelection): Promise<TopicSplitPreview> {
    await this.findChatbotOrThrow(chatbotId); // ARCHIVED도 허용(읽기 연산 — FR-TP6-1)
    const topics = await this.prisma.topic.findMany({
      where: { chatbotId },
      select: { id: true, name: true, description: true, sortOrder: true, enabled: true },
    });
    for (const topicId of selection.topicIds) {
      if (!topics.some((t) => t.id === topicId)) throw new ApiException('NOT_FOUND', 404, '선택한 토픽을 찾을 수 없습니다.');
    }
    // [신규 — 자동시험 결함 수정] 선택 범위가 이미 상한을 넘으면 build()를 시도조차 하지 않는다.
    await this.precheckSelectionLimits(chatbotId, selection);

    const bundle = await this.bundleService.build(chatbotId);
    const source: TransferSource = { chatbotId, bundle, topics, capturedAt: new Date() };
    const subset = selectTransferSubset(source, selection);
    return this.buildPreview(subset, source);
  }

  async split(chatbotId: string, dto: TopicSplitRequestDto): Promise<TopicSplitResult> {
    const original = await this.findChatbotOrThrow(chatbotId);
    // [신규 — 자동시험 결함 수정(§14.5)] 캡처(무거운 build())·트랜잭션 진입 전에 선택 범위 사전 검사를
    // 먼저 한다 — 상한을 이미 넘는 요청이 30초 트랜잭션 타임아웃을 유발해 500으로 새는 것을 막는다.
    await this.precheckSelectionLimits(chatbotId, dto);

    const target = await this.copyTarget.resolve(
      { name: original.name, slug: original.slug, groupId: original.groupId },
      { name: dto.name, slug: dto.slug, targetGroupId: dto.targetGroupId },
    );

    let newChatbotId!: string;
    let subsetForAudit!: TransferSubset;

    try {
      await this.prisma.$transaction(
        async (tx) => {
          const source = await this.capture.captureTransferSource(tx, chatbotId);
          for (const topicId of dto.topicIds) {
            if (!source.topics.some((t) => t.id === topicId)) throw new ApiException('NOT_FOUND', 404, '선택한 토픽을 찾을 수 없습니다.');
          }
          const subset = selectTransferSubset(source, dto);
          subsetForAudit = subset;

          const exceeded = exceededLimits(subset.totals);
          if (exceeded.length > 0) {
            throw new ApiException(
              'TOPIC_SPLIT_TOO_LARGE',
              422,
              '선택한 범위가 동기 분리 상한을 초과합니다.',
              exceeded.map((k) => ({ field: k, message: String(subset.totals[k as keyof typeof subset.totals]) })),
            );
          }

          const plan = planTransfer(source, subset, { idFactory: randomUUID, now: new Date() });
          const violations = verifyTransferPlan(plan);
          if (violations.length > 0) {
            this.logger.warn(`분리 계획 검증 실패(적재 취소): chatbotId=${chatbotId} violations=${violations.length}건 rules=${[...new Set(violations.map((v) => v.rule))].join(',')}`);
            throw new ApiException('INTERNAL_ERROR', 500, '분리 처리 중 내부 오류가 발생했습니다. 변경 사항이 저장되지 않았습니다.');
          }

          const chatbot = await tx.chatbot.create({
            data: {
              groupId: target.groupId,
              name: target.name,
              slug: target.slug,
              avatarUrl: original.avatarUrl,
              description: original.description,
              status: 'DRAFT',
              skin: original.skin,
            },
          });
          newChatbotId = chatbot.id;
          await this.loader.load(tx, chatbot.id, plan);
        },
        { timeout: 30_000, maxWait: 30_000 },
      );
    } catch (e) {
      if (e instanceof ApiException) throw e;
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ApiException('DUPLICATE_SLUG', 409, '이미 사용 중인 고유 URL입니다. 다른 값을 입력해 주세요.');
      }
      if (isBusyError(e)) {
        throw new ApiException('TOPIC_SPLIT_BUSY', 409, '다른 변경과 동시에 처리되어 분리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      }
      throw e;
    }

    // 커밋 후 — 원본에는 어떤 쓰기도 없다. 새 챗봇만 무효화(재색인 예약 겸).
    this.bundleService.invalidate(newChatbotId);

    await this.auditLogService.record({
      action: 'COPY',
      targetType: 'Chatbot',
      targetId: newChatbotId,
      chatbotId: newChatbotId,
      summary: `토픽 분리 — 원본 ${chatbotId.slice(0, 8)} · 토픽 ${dto.topicIds.length} · 의도 ${subsetForAudit.totals.intents}·노드 ${subsetForAudit.totals.dialogNodes}·FAQ ${subsetForAudit.totals.faqs} · 동반 ${subsetForAudit.closureItems.length} · 잘라낸 연결 ${subsetForAudit.trimmedLinks.length}`,
    });

    const newChatbotRow = await this.prisma.chatbot.findUniqueOrThrow({ where: { id: newChatbotId } });
    const newBundle = await this.bundleService.build(newChatbotId);
    const report = validateDialogueDesign(newBundle, new Date(), {});

    return {
      chatbot: toChatbotDto(newChatbotRow),
      totals: subsetForAudit.totals,
      closureAdded: subsetForAudit.closureAddedTotals,
      trimmedLinks: subsetForAudit.trimmedLinks.length,
      surveysCopied: subsetForAudit.totals.surveys,
      capturedAt: new Date(),
      designCheck: report.summary,
      reindexScheduled: true,
      notCopied: [...NOT_COPIED_KEYS],
    };
  }
}
