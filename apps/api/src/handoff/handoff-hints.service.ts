import { Injectable } from '@nestjs/common';
import { normalizeText } from '@chat-bot/shared-types';
import type { ChatbotAnswerSetting, DialogueBundle, HintAnswerItem, HintCannedItem, HintResponse } from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ChatbotScopeService } from '../chatbots/chatbot-scope.service';
import { DialogueBundleService } from '../dialogue-common/dialogue-bundle.service';
import { SemanticMatchService } from '../embedding/semantic-match.service';
import type { SemanticMatchVectorSource } from '../embedding/semantic-match.service';
import { AnswerSettingsCacheService } from '../answer-settings/answer-settings-cache.service';
import { suggestIntents } from '../learning/lib/intent-suggest';
import { SessionRefResolverService } from './session-ref-resolver.service';
import { pickTopSemanticCandidates } from './lib/hint-rank';
import { VersionBundleService, ServingVersionUnavailableError } from '../environment/serving/version-bundle.service';

interface HintMemoEntry {
  value: HintResponse;
  expiresAt: number;
}

const MEMO_MAX = 500;
const MEMO_TTL_MS = 30 * 60_000;

/**
 * 응답힌트(P-10, §12) — 기존 자산 검색(의미 매칭 → 저하 시 문자 유사도)일 뿐 생성형 호출은 0(FR-CS7-8).
 * 발화당 1회 계산(인스턴스 로컬 메모).
 */
@Injectable()
export class HandoffHintsService {
  private readonly memo = new Map<string, HintMemoEntry>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ChatbotScopeService,
    private readonly resolver: SessionRefResolverService,
    private readonly bundleService: DialogueBundleService,
    private readonly semanticMatch: SemanticMatchService,
    private readonly answerSettingsCache: AnswerSettingsCacheService,
    // [신규 No.40 — §7.1 소비자 #5, 생성자 끝] 상담 힌트는 운영 버전을 쓴다(모드 켜짐만).
    private readonly versionBundles: VersionBundleService,
  ) {}

  async getHints(chatbotId: string, sessionRef: string): Promise<HintResponse> {
    const scopeResult = await this.scope.assertReadable(chatbotId);
    const sessionId = await this.resolver.resolve(chatbotId, sessionRef);

    const source = await this.resolveSource(chatbotId, sessionId);
    if (!source) return { source: null, mode: 'LEXICAL', answers: [], canned: [] };

    const memoKey = `${chatbotId}:${source.key}`;
    const cached = this.memo.get(memoKey);
    if (cached && cached.expiresAt > Date.now()) {
      this.memo.delete(memoKey);
      this.memo.set(memoKey, cached); // LRU touch(재삽입으로 최신화)
      return cached.value;
    }

    const value = await this.compute(chatbotId, source, scopeResult?.prodVersionId ?? null);
    this.memo.set(memoKey, { value, expiresAt: Date.now() + MEMO_TTL_MS });
    while (this.memo.size > MEMO_MAX) {
      const oldest = this.memo.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.memo.delete(oldest);
    }
    return value;
  }

  private async resolveSource(chatbotId: string, sessionId: string): Promise<{ key: string; text: string } | null> {
    const lastLog = await this.prisma.conversationLog.findFirst({
      where: { chatbotId, sessionId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, userMessage: true, createdAt: true },
    });
    const lastHandoffMsg = await this.prisma.handoffMessage.findFirst({
      where: { chatbotId, sender: 'USER', handoffSession: { chatbotId, sessionId } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, text: true, createdAt: true },
    });

    const candidates = [
      lastLog ? { key: lastLog.id, text: lastLog.userMessage, at: lastLog.createdAt } : null,
      lastHandoffMsg ? { key: lastHandoffMsg.id, text: lastHandoffMsg.text, at: lastHandoffMsg.createdAt } : null,
    ].filter((c): c is { key: string; text: string; at: Date } => c !== null);

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.at.getTime() - a.at.getTime());
    return { key: candidates[0].key, text: candidates[0].text };
  }

  /** [신규 No.40 — §7.1] 소스 선택 — 모드 켜짐이면 운영 버전, 아니면 초안(기존 코드 그대로). */
  private async loadHintSource(
    chatbotId: string,
    prodVersionId: string | null,
  ): Promise<{ bundle: DialogueBundle; settings: ChatbotAnswerSetting; semanticSource?: SemanticMatchVectorSource } | null> {
    if (!prodVersionId) {
      const settings = await this.answerSettingsCache.get(chatbotId);
      const { bundle } = await this.bundleService.getCached(chatbotId);
      return { bundle, settings };
    }
    try {
      const s = await this.versionBundles.get(chatbotId, prodVersionId, { topics: 'ACTIVE_ONLY' });
      return { bundle: s.bundle, settings: s.settings, semanticSource: s.semanticSource };
    } catch (e) {
      if (e instanceof ServingVersionUnavailableError) return null; // §7.6 — 초안 대체 금지, 답변 후보만 비운다.
      throw e;
    }
  }

  private async compute(chatbotId: string, source: { key: string; text: string }, prodVersionId: string | null): Promise<HintResponse> {
    const loaded = await this.loadHintSource(chatbotId, prodVersionId);
    const canned = await this.computeCanned(chatbotId, source);
    if (!loaded) return { source, mode: 'LEXICAL', answers: [], canned };

    const { bundle, settings, semanticSource } = loaded;

    let answers: HintAnswerItem[] = [];
    let mode: 'SEMANTIC' | 'LEXICAL' = 'LEXICAL';

    if (settings.semanticEnabled) {
      const semantic = await this.semanticMatch.score(
        chatbotId,
        source.text,
        bundle,
        { accept: settings.acceptThreshold, low: settings.lowThreshold, margin: settings.marginThreshold },
        semanticSource,
      );
      if (semantic) {
        mode = 'SEMANTIC';
        const top = pickTopSemanticCandidates(semantic.ranked, 3);
        answers = top
          .map((c) => this.resolveAnswerText(bundle, c.kind, c.id, c.score))
          .filter((a): a is HintAnswerItem => a !== null);
      }
    }

    if (answers.length === 0) {
      mode = 'LEXICAL';
      const normalized = normalizeText(source.text);
      const faqCandidates = bundle.faqs.filter((f) => f.enabled).map((f) => ({ id: f.id, name: f.question, examples: f.altQuestions }));
      const intentCandidates = bundle.intents.map((i) => ({ id: i.id, name: i.name, examples: i.examples }));
      const faqSuggestions = suggestIntents(normalized, faqCandidates, { minScore: 0.1, max: 3 });
      const intentSuggestions = suggestIntents(normalized, intentCandidates, { minScore: 0.1, max: 3 });
      const merged = [
        ...faqSuggestions.map((s) => ({ kind: 'FAQ' as const, id: s.intentId, score: s.score })),
        ...intentSuggestions.map((s) => ({ kind: 'INTENT' as const, id: s.intentId, score: s.score })),
      ]
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
      answers = merged.map((c) => this.resolveAnswerText(bundle, c.kind, c.id, c.score)).filter((a): a is HintAnswerItem => a !== null);
    }

    return { source, mode, answers, canned };
  }

  /** 자주 쓰는 문장 후보(§7.4 — 환경 밖 자산, 항상 현재 값). 버전 읽기 실패 시에도 계속 진행한다. */
  private async computeCanned(chatbotId: string, source: { key: string; text: string }): Promise<HintCannedItem[]> {
    const cannedRows = await this.prisma.cannedResponse.findMany({ where: { chatbotId, enabled: true }, select: { id: true, title: true, body: true, category: true, shortcut: true } });
    const cannedCandidates = cannedRows.map((c) => ({ id: c.id, name: c.title, examples: c.shortcut ? [c.body, c.shortcut] : [c.body] }));
    const cannedSuggestions = suggestIntents(normalizeText(source.text), cannedCandidates, { minScore: 0.05, max: 3 });
    const cannedById = new Map(cannedRows.map((c) => [c.id, c]));
    const canned: HintCannedItem[] = [];
    for (const s of cannedSuggestions) {
      const row = cannedById.get(s.intentId);
      if (!row) continue;
      canned.push({ id: row.id, title: row.title, body: row.body, category: row.category ?? undefined, score: s.score });
    }
    return canned;
  }

  private resolveAnswerText(
    bundle: Awaited<ReturnType<DialogueBundleService['build']>>,
    kind: 'FAQ' | 'INTENT',
    id: string,
    score: number,
  ): HintAnswerItem | null {
    if (kind === 'FAQ') {
      const faq = bundle.faqs.find((f) => f.id === id);
      if (!faq) return null;
      return { kind: 'FAQ', refName: faq.question, text: faq.answer, score };
    }
    const intent = bundle.intents.find((i) => i.id === id);
    if (!intent) return null;
    const nodes = bundle.dialogNodes.filter((n) => n.enabled && n.intentIds.includes(id)).sort((a, b) => b.priority - a.priority);
    const firstText = nodes.flatMap((n) => n.outputs).find((o) => o.type === 'TEXT');
    if (!firstText || firstText.type !== 'TEXT') return null;
    return { kind: 'INTENT', refName: intent.name, text: firstText.payload.text, score };
  }
}
