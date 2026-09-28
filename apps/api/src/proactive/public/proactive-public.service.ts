import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PROACTIVE_WIDGET_TRIGGER_KINDS } from '@chat-bot/shared-types';
import type { PublicProactiveEventDto, PublicProactivePayload } from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { BannedWordFilterService } from '../../banned-words/banned-word-filter.service';
import { decodeProactiveRule } from '../lib/rule-codec';
import { computeShowUntil, isWithinPublishPeriod, isWithinScheduleWindow } from '../lib/schedule-window';
import { ProactiveStatWriter } from '../core/proactive-stat.writer';
import { ProactiveEventDeduper } from '../core/proactive-event-deduper';

const DEFAULT_CAPS: PublicProactivePayload['caps'] = { maxPerSession: 1, minIntervalSec: 60, quietAfterUserMessageSec: 300 };
const EMPTY_PAYLOAD = (caps: PublicProactivePayload['caps']): PublicProactivePayload => ({ caps, rules: [] });
const WIDGET_TRIGGER_KIND_SET = new Set<string>(PROACTIVE_WIDGET_TRIGGER_KINDS);

/** `public-conversation.service.ts`의 `loadServing()`이 반환하는 값 중 이 서비스가 실제로 쓰는
 * 부분만 구조적으로 요구한다(§5.2 — `loadServing`을 클로저로 받는 이유 = 소스 선택 지점 1곳 유지). */
export interface ProactiveServingIndex {
  index: { nodesById: Map<string, { enabled: boolean }> };
}

/**
 * [신규 No.35] ★ 공개 페이로드 조립(필터·`showUntil`) · 수집 사건 처리(결합 검증 → 중복 억제 → 증가)
 * — export 유일(`ProactiveModule`). `ChatbotRichUrlPolicy`·식별(`inbox/**`)·상담(`handoff/**`)·
 * 엔진 패키지를 import하지 않는다(PA-9). 번들은 `loadServing` 클로저로만 접근한다(E-9 유지).
 */
@Injectable()
export class ProactivePublicService {
  private readonly logger = new Logger('ProactivePublicService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly bannedWords: BannedWordFilterService,
    private readonly statWriter: ProactiveStatWriter,
    private readonly deduper: ProactiveEventDeduper,
  ) {}

  private serverEnabled(): boolean {
    return this.config.get<boolean>('PROACTIVE_ENABLED') ?? true;
  }

  /** §5.2 서버 판정 순서 — ① 서버 스위치 ② 설정 켜짐 ③ 켜진 규칙 ≤10 ④ 기간·시간대 ⑤ 금지어
   * ⑥ NODE 노드 유효성(서비스 중 번들) ⑦ `showUntil` ⑧ 출력 검증(호출자가 zod parse). */
  async buildPayload(chatbot: { id: string }, now: Date, loadServing: () => Promise<ProactiveServingIndex>): Promise<PublicProactivePayload> {
    if (!this.serverEnabled()) return EMPTY_PAYLOAD(DEFAULT_CAPS);

    const setting = await this.prisma.chatbotProactiveSetting.findUnique({ where: { chatbotId: chatbot.id } });
    if (!setting || !setting.enabled) return EMPTY_PAYLOAD(DEFAULT_CAPS);
    const caps = { maxPerSession: setting.maxPerSession, minIntervalSec: setting.minIntervalSec, quietAfterUserMessageSec: setting.quietAfterUserMessageSec };

    const rows = await this.prisma.proactiveRule.findMany({
      where: { chatbotId: chatbot.id, enabled: true, triggerKind: { in: [...PROACTIVE_WIDGET_TRIGGER_KINDS] } },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      take: 10,
    });
    if (rows.length === 0) return EMPTY_PAYLOAD(caps);

    const candidates = rows
      .map((row) => ({ row, decoded: decodeProactiveRule(row) }))
      .filter((item): item is { row: (typeof rows)[number]; decoded: NonNullable<ReturnType<typeof decodeProactiveRule>> } => {
        if (!item.decoded) return false;
        if (!WIDGET_TRIGGER_KIND_SET.has(item.decoded.trigger.kind)) return false;
        if (!isWithinPublishPeriod(item.row.startsAt, item.row.endsAt, now)) return false;
        return isWithinScheduleWindow(item.decoded.schedule, now);
      });
    if (candidates.length === 0) return EMPTY_PAYLOAD(caps);

    const survivors: typeof candidates = [];
    for (const item of candidates) {
      const texts = [item.row.text, ...item.decoded.buttons.map((b) => b.label), ...item.decoded.buttons.filter((b) => b.action === 'MESSAGE').map((b) => b.value)];
      let bannedHit = false;
      for (const t of texts) {
        const { matches } = await this.bannedWords.evaluateInbound(t);
        if (matches.length > 0) {
          bannedHit = true;
          break;
        }
      }
      if (!bannedHit) survivors.push(item);
    }
    if (survivors.length === 0) return EMPTY_PAYLOAD(caps);

    const needsNodeCheck = survivors.some(({ decoded }) => decoded.buttons.some((b) => b.action === 'NODE'));
    let nodesById: Map<string, { enabled: boolean }> | undefined;
    let servingFailed = false;
    if (needsNodeCheck) {
      try {
        const serving = await loadServing();
        nodesById = serving.index.nodesById;
      } catch (e) {
        servingFailed = true;
        this.logger.warn(`선제 안내 노드 유효성 판정 실패: chatbotId=${chatbot.id} code=SERVING_UNAVAILABLE`);
        void e;
      }
    }

    const publicRules: PublicProactivePayload['rules'] = [];
    for (const { row, decoded } of survivors) {
      const nodeButtons = decoded.buttons.filter((b) => b.action === 'NODE');
      if (nodeButtons.length > 0) {
        if (servingFailed || !nodesById) continue;
        const allNodesOk = nodeButtons.every((b) => nodesById!.get(b.value)?.enabled === true);
        if (!allNodesOk) continue;
      }
      const showUntil = computeShowUntil(row.endsAt, decoded.schedule, now);
      publicRules.push({
        id: row.id,
        trigger: decoded.trigger,
        text: row.text,
        buttons: decoded.buttons,
        devices: decoded.devices,
        ...(showUntil ? { showUntil } : {}),
      });
    }

    return { caps, rules: publicRules };
  }

  /** `access.resolve()` 전에 호출해 존재하지 않는 규칙·중복 스팸에 대한 DB 조회를 건너뛸 수 있게
   * 한다(§5.3 처리 순서 ①). */
  isDuplicateEvent(dto: PublicProactiveEventDto, now: Date): boolean {
    return this.deduper.seenBefore(dto.sessionId, dto.ruleId, dto.kind, now.getTime());
  }

  /** §5.3 ②~⑥ — 결합 검증 불일치·서버 스위치 꺼짐·설정 꺼짐 모두 조용히 무시(카운터 변화 0). */
  async recordEvent(input: { chatbot: { id: string }; dto: PublicProactiveEventDto; now: Date }): Promise<void> {
    if (!this.serverEnabled()) return;

    const setting = await this.prisma.chatbotProactiveSetting.findUnique({ where: { chatbotId: input.chatbot.id } });
    if (!setting || !setting.enabled) return;

    const rule = await this.prisma.proactiveRule.findUnique({ where: { id: input.dto.ruleId } });
    if (!rule || rule.chatbotId !== input.chatbot.id || !rule.enabled || !WIDGET_TRIGGER_KIND_SET.has(rule.triggerKind)) return;

    this.deduper.register(input.dto.sessionId, input.dto.ruleId, input.dto.kind, input.now.getTime());

    try {
      await this.statWriter.increment(input.chatbot.id, rule.id, rule.name, input.now, input.dto.kind);
    } catch {
      this.logger.warn(`선제 안내 수집 처리 실패: chatbotId=${input.chatbot.id} code=WRITE_FAILED`);
    }
  }
}
