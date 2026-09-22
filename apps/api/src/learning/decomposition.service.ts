import { Injectable } from '@nestjs/common';
import type { DecompositionResponse } from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/api.exception';
import { ChatbotScopeService } from '../chatbots/chatbot-scope.service';
import { MorphAnalyzerFactory } from './morph/morph-analyzer.factory';
import { decompose } from './lib/decompose';
import type { GazetteerEntry } from './lib/decompose';
import { DEFAULT_STOPWORDS } from './lib/stopwords';
import { JOSA_ENDINGS } from './lib/josa-endings';

const NOT_FOUND_MESSAGE = '요청하신 미응답 질문을 찾을 수 없습니다.';

/**
 * No.23 (A) 요소분해 조회(FR-L2-6, DD-105) — **조회 시점에 계산하고 저장하지 않는다.** 사전(gazetteer)이
 * 바뀌면 다음 조회에서 즉시 다른 결과가 나온다. 입력은 `UnansweredQuestion.questionText`(이미 마스킹된
 * 값)이며 원문에 다시 접근하지 않는다(FR-L2-1).
 */
@Injectable()
export class DecompositionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ChatbotScopeService,
    private readonly morphFactory: MorphAnalyzerFactory,
  ) {}

  private parseJsonArray(json: string): string[] {
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
    } catch {
      return [];
    }
  }

  /** `Keyword.name`+`synonyms` + `HomonymDictionary.word`를 조립한다(ADR-0028 §3 입력). 읽기 전용. */
  async buildGazetteer(chatbotId: string): Promise<GazetteerEntry[]> {
    const [keywords, homonyms] = await Promise.all([
      this.prisma.keyword.findMany({ where: { chatbotId }, select: { id: true, name: true, synonyms: true } }),
      this.prisma.homonymDictionary.findMany({ where: { chatbotId }, select: { word: true } }),
    ]);

    const entries: GazetteerEntry[] = [];
    for (const k of keywords) {
      entries.push({ keywordId: k.id, name: k.name, surface: k.name, viaSynonym: false });
      for (const syn of this.parseJsonArray(k.synonyms)) {
        entries.push({ keywordId: k.id, name: k.name, surface: syn, viaSynonym: true });
      }
    }
    for (const h of homonyms) {
      // 동음이의어 표제어는 Keyword가 아니다 — 스팬 경계 힌트로만 쓰고 matchedKeyword는 비운다.
      entries.push({ name: h.word, surface: h.word, viaSynonym: false });
    }
    return entries;
  }

  async decompose(chatbotId: string, id: string): Promise<DecompositionResponse> {
    await this.scope.assertReadable(chatbotId);
    const question = await this.prisma.unansweredQuestion.findFirst({ where: { id, chatbotId }, select: { questionText: true } });
    if (!question) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);

    const gazetteer = await this.buildGazetteer(chatbotId);
    const analyzer = this.morphFactory.getAnalyzer();
    const morphTokens = analyzer.ready ? analyzer.analyze(question.questionText) : [];

    const spans = decompose(question.questionText, {
      morphTokens,
      gazetteer,
      stopwords: DEFAULT_STOPWORDS,
      josaEndings: JOSA_ENDINGS,
    });

    return { spans, analyzerId: analyzer.analyzerId, version: 1 };
  }
}
