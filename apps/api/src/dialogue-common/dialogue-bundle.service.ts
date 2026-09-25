import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { buildDialogueIndex } from '@chat-bot/dialogue-engine';
import type { DialogueIndex } from '@chat-bot/dialogue-engine';
import type { ContextSlot, DialogOutput, DialogueBundle, HomonymMeaning, Survey, SurveyQuestion } from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import type { DialogueBundleCache } from './dialogue-bundle.cache';
import { ReindexQueueService } from '../embedding/index/reindex-queue.service';
import { VectorCacheService } from '../embedding/vector-cache.service';

/** `build()`의 두 번째 인자로 받을 수 있는 클라이언트 종류 — 기본 프로퍼티(PrismaService) 또는 인터랙티브 트랜잭션 클라이언트. */
type DbClient = PrismaService | Prisma.TransactionClient;

export interface CachedDialogueBundle {
  bundle: DialogueBundle;
  index: DialogueIndex;
}

/**
 * 챗봇 1건의 대화 자산을 엔진 입력 번들(`DialogueBundle`)로 조립한다(FR-E-1).
 * `POST /homonyms/test`, `POST /dialog-nodes/validate`, `GET /dialog-nodes/flow`,
 * 시뮬레이션·공개 대화 API가 사용한다.
 * JSON 파싱 실패는 기본값 폴백 + 경고 로그로 처리한다(NFR-M4) — 엔진 쪽 예외 없음 원칙과 대칭.
 * 번들+인덱스 캐시는 DD-22 — TTL 60초 + LRU. 대화 자산 6개 모듈은 쓰기 성공 직후 `invalidate()`를 호출한다(§8.1).
 */
@Injectable()
export class DialogueBundleService {
  private readonly logger = new Logger('DialogueBundleService');

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject('DialogueBundleCache') private readonly cache?: DialogueBundleCache,
    private readonly reindexQueue?: ReindexQueueService,
    private readonly vectorCache?: VectorCacheService,
  ) {}

  /** 캐시 우선 조회 — 적중 시 DB 접근 없이 번들+인덱스를 반환한다(NFR-P1/P2). */
  async getCached(chatbotId: string): Promise<CachedDialogueBundle> {
    const cached = this.cache?.get(chatbotId);
    if (cached) return { bundle: cached.bundle, index: cached.index };

    const bundle = await this.build(chatbotId);
    const index = buildDialogueIndex(bundle);
    this.cache?.set(chatbotId, { bundle, index, cachedAt: Date.now() });
    return { bundle, index };
  }

  /**
   * 대화 자산 쓰기 성공 직후 호출한다(EX-10-6). 누락 시 최대 피해는 TTL(60초) 지연이다.
   * 같은 지점에서 1단계 색인 재계산을 예약하고(DD-76, FR-N1-18) 벡터 캐시를 무효화한다
   * (DD-71 — 무효화 지점 공유. "FAQ는 최신인데 벡터는 옛것"인 상태가 구조적으로 생기지 않는다).
   */
  invalidate(chatbotId: string): void {
    this.cache?.invalidate(chatbotId);
    this.vectorCache?.invalidate(chatbotId);
    this.reindexQueue?.schedule(chatbotId);
  }

  private safeParseArray<T>(json: string, context: string): T[] {
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      this.logger.warn(`JSON 파싱 실패 — 기본값([])으로 폴백: ${context}`);
      return [];
    }
  }

  /**
   * `db`를 생략하면 기존과 동일하게 `Promise.all` 6회 **병렬** 조회다(기존 호출부 무변경).
   * `db`에 인터랙티브 트랜잭션 클라이언트가 주어지면(No.25 버전 캡처, §6.1) 6회 조회를 **순차 await**
   * 한다 — 단일 커넥션인 tx 클라이언트 위에서 병렬 발행을 금지해 "노드는 새 의도를 참조하는데
   * 의도 목록은 옛것"인 일관성 깨짐을 막는다(FR-H1-6).
   */
  async build(chatbotId: string, db: DbClient = this.prisma): Promise<DialogueBundle> {
    const isTransactionClient = db !== this.prisma;

    let intents: Awaited<ReturnType<typeof this.prisma.intent.findMany>>;
    let keywords: Awaited<ReturnType<typeof this.prisma.keyword.findMany>>;
    let homonyms: Awaited<ReturnType<typeof this.prisma.homonymDictionary.findMany>>;
    let dialogNodes: Awaited<ReturnType<typeof this.prisma.dialogNode.findMany<{ include: { intentLinks: true; keywordLinks: true } }>>>;
    let contexts: Awaited<ReturnType<typeof this.prisma.contextVariable.findMany>>;
    let faqs: Awaited<ReturnType<typeof this.prisma.faqEntry.findMany>>;
    let surveys: Awaited<ReturnType<typeof this.prisma.survey.findMany>>;

    // [K-1] 결정적 정렬. orderBy가 없으면 SQLite가 플래너가 고른 인덱스 순서로 행을
    // 돌려주어 편집·버전 복원에 따라 엔진의 동점 매칭 승자가 흔들린다. `createdAt asc, id asc`는
    // 복원(타임스탬프 보존)에서도 같은 승자를 낸다.
    const orderByCreatedAtId = [{ createdAt: 'asc' as const }, { id: 'asc' as const }];

    if (isTransactionClient) {
      intents = await db.intent.findMany({ where: { chatbotId }, orderBy: orderByCreatedAtId });
      keywords = await db.keyword.findMany({ where: { chatbotId }, orderBy: orderByCreatedAtId });
      homonyms = await db.homonymDictionary.findMany({ where: { chatbotId }, orderBy: orderByCreatedAtId });
      dialogNodes = await db.dialogNode.findMany({
        where: { chatbotId },
        include: { intentLinks: true, keywordLinks: true },
        orderBy: orderByCreatedAtId,
      });
      contexts = await db.contextVariable.findMany({ where: { chatbotId }, orderBy: orderByCreatedAtId });
      faqs = await db.faqEntry.findMany({ where: { chatbotId }, orderBy: orderByCreatedAtId });
      surveys = await db.survey.findMany({ where: { chatbotId }, orderBy: orderByCreatedAtId });
    } else {
      [intents, keywords, homonyms, dialogNodes, contexts, faqs, surveys] = await Promise.all([
        db.intent.findMany({ where: { chatbotId }, orderBy: orderByCreatedAtId }),
        db.keyword.findMany({ where: { chatbotId }, orderBy: orderByCreatedAtId }),
        db.homonymDictionary.findMany({ where: { chatbotId }, orderBy: orderByCreatedAtId }),
        db.dialogNode.findMany({
          where: { chatbotId },
          include: { intentLinks: true, keywordLinks: true },
          orderBy: orderByCreatedAtId,
        }),
        db.contextVariable.findMany({ where: { chatbotId }, orderBy: orderByCreatedAtId }),
        db.faqEntry.findMany({ where: { chatbotId }, orderBy: orderByCreatedAtId }),
        db.survey.findMany({ where: { chatbotId }, orderBy: orderByCreatedAtId }),
      ]);
    }

    return {
      intents: intents.map((row) => ({
        id: row.id,
        chatbotId: row.chatbotId,
        name: row.name,
        description: row.description ?? undefined,
        examples: this.safeParseArray<string>(row.examples, `Intent.examples(${row.id})`),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
      keywords: keywords.map((row) => ({
        id: row.id,
        chatbotId: row.chatbotId,
        name: row.name,
        description: row.description ?? undefined,
        synonyms: this.safeParseArray<string>(row.synonyms, `Keyword.synonyms(${row.id})`),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
      homonyms: homonyms.map((row) => ({
        id: row.id,
        chatbotId: row.chatbotId,
        word: row.word,
        description: row.description ?? undefined,
        meanings: this.safeParseArray<HomonymMeaning>(row.meanings, `Homonym.meanings(${row.id})`),
        policy: (row.policy as 'ASK' | 'DEFAULT_MEANING' | 'IGNORE') ?? 'ASK',
        clarifyPrompt: row.clarifyPrompt ?? undefined,
        defaultMeaningIndex: row.defaultMeaningIndex ?? undefined,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
      dialogNodes: dialogNodes.map((row) => ({
        id: row.id,
        chatbotId: row.chatbotId,
        name: row.name,
        description: row.description ?? undefined,
        nodeType: (row.nodeType as 'NORMAL' | 'START' | 'FALLBACK') ?? 'NORMAL',
        matchMode: (row.matchMode as 'ANY' | 'ALL') ?? 'ANY',
        enabled: row.enabled,
        priority: row.priority,
        intentIds: row.intentLinks.map((l) => l.intentId),
        keywordIds: row.keywordLinks.map((l) => l.keywordId),
        contextVariableId: row.contextVariableId ?? undefined,
        outputs: this.safeParseArray<DialogOutput>(row.outputs, `DialogNode.outputs(${row.id})`),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
      contexts: contexts.map((row) => ({
        id: row.id,
        chatbotId: row.chatbotId,
        name: row.name,
        description: row.description ?? undefined,
        slots: this.safeParseArray<ContextSlot>(row.slots, `Context.slots(${row.id})`),
        completionMessage: row.completionMessage ?? undefined,
        cancelKeywords: this.safeParseArray<string>(row.cancelKeywords, `Context.cancelKeywords(${row.id})`),
        sessionTimeoutMinutes: row.sessionTimeoutMinutes,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
      faqs: faqs.map((row) => ({
        id: row.id,
        chatbotId: row.chatbotId,
        category: row.category as 'FAQ' | 'SMALL_TALK' | 'SELF_SERVICE' | 'ERROR_RESPONSE',
        question: row.question,
        answer: row.answer,
        altQuestions: this.safeParseArray<string>(row.altQuestions, `Faq.altQuestions(${row.id})`),
        enabled: row.enabled,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
      // [No.27] 선택 필드 — 실패 시 `questions: []`로 폴백한다(FR-SV2-9, 엔진은 개별 문항 오류로 전체를 버리지 않는다).
      surveys: surveys.map((row) => ({
        id: row.id,
        chatbotId: row.chatbotId,
        name: row.name,
        description: row.description ?? undefined,
        status: row.status as Survey['status'],
        activeFrom: row.activeFrom ?? undefined,
        activeTo: row.activeTo ?? undefined,
        introMessage: row.introMessage ?? undefined,
        completionMessage: row.completionMessage,
        cancelKeywords: this.safeParseArray<string>(row.cancelKeywords, `Survey.cancelKeywords(${row.id})`),
        sessionTimeoutMinutes: row.sessionTimeoutMinutes,
        questions: this.safeParseArray<SurveyQuestion>(row.questions, `Survey.questions(${row.id})`),
        structureVersion: row.structureVersion,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
    };
  }
}
