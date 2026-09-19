import { Injectable, Logger } from '@nestjs/common';
import type { ContextSlot, DialogOutput, DialogueBundle, HomonymMeaning } from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 챗봇 1건의 대화 자산을 엔진 입력 번들(`DialogueBundle`)로 조립한다(FR-E-1).
 * `POST /homonyms/test`, `POST /dialog-nodes/validate`, `GET /dialog-nodes/flow`가 사용한다.
 * JSON 파싱 실패는 기본값 폴백 + 경고 로그로 처리한다(NFR-M4) — 엔진 쪽 예외 없음 원칙과 대칭.
 */
@Injectable()
export class DialogueBundleService {
  private readonly logger = new Logger('DialogueBundleService');

  constructor(private readonly prisma: PrismaService) {}

  private safeParseArray<T>(json: string, context: string): T[] {
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      this.logger.warn(`JSON 파싱 실패 — 기본값([])으로 폴백: ${context}`);
      return [];
    }
  }

  async build(chatbotId: string): Promise<DialogueBundle> {
    const [intents, keywords, homonyms, dialogNodes, contexts, faqs] = await Promise.all([
      this.prisma.intent.findMany({ where: { chatbotId } }),
      this.prisma.keyword.findMany({ where: { chatbotId } }),
      this.prisma.homonymDictionary.findMany({ where: { chatbotId } }),
      this.prisma.dialogNode.findMany({ where: { chatbotId }, include: { intentLinks: true, keywordLinks: true } }),
      this.prisma.contextVariable.findMany({ where: { chatbotId } }),
      this.prisma.faqEntry.findMany({ where: { chatbotId } }),
    ]);

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
    };
  }
}
