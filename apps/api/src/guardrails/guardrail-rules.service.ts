import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { normalizeText, toKstDayBucket } from '@chat-bot/shared-types';
import type {
  CreateGuardrailRuleDto,
  GuardrailRule,
  GuardrailRuleListResponse,
  GuardrailRuleSaveResponse,
  MoveGuardrailRuleDto,
  UpdateGuardrailRuleDto,
} from '@chat-bot/shared-types';
import type { GuardrailRule as GuardrailRuleRow } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ChatbotScopeService } from '../chatbots/chatbot-scope.service';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { BannedWordFilterService } from '../banned-words/banned-word-filter.service';
import { AnswerSettingsCacheService } from '../answer-settings/answer-settings-cache.service';
import { ApiException } from '../common/api.exception';
import type { SessionUser } from '../common/auth/session-context';
import { GuardrailRuleStore } from './core/guardrail-rule.store';
import type { RuleActor, RuleLimits, RuleWriteData } from './core/guardrail-rule.store';
import { GuardrailRuntimeService } from './runtime/guardrail-runtime.service';
import { validateRuleBody } from './lib/rule-validate';
import { toRuleAuditView, toRuleDto } from './guardrail.mapper';

const NOT_FOUND = '요청하신 규칙을 찾을 수 없습니다.';
const DAY_MS = 86_400_000;

function actorOf(user: SessionUser | null): RuleActor {
  return { id: user?.id ?? null, email: user?.email ?? null };
}

/**
 * 위험 응답 규칙 CRUD·켜기/끄기·이동(설계서 §4.1·§4.2). 저장 검증 순서: zod(컨트롤러) → 표현 정규화·대체 문구
 * 텍스트 검사 → 대체 문구 금지어 검사 → 상한(트랜잭션 안) → 저장 → 감사 → 캐시 무효화. 규칙은 대화 자산이
 * 아니다 — 환경 모드 챗봇에서도 초안/운영 구분 없이 저장 즉시 적용된다.
 */
@Injectable()
export class GuardrailRulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ChatbotScopeService,
    private readonly auditLog: AuditLogService,
    private readonly bannedWords: BannedWordFilterService,
    private readonly answerSettings: AnswerSettingsCacheService,
    private readonly store: GuardrailRuleStore,
    private readonly runtime: GuardrailRuntimeService,
    private readonly config: ConfigService,
  ) {}

  limits(): RuleLimits {
    return {
      maxRules: this.config.get<number>('GUARDRAIL_MAX_RULES_PER_CHATBOT') ?? 50,
      maxExpressions: this.config.get<number>('GUARDRAIL_MAX_EXPRESSIONS_PER_CHATBOT') ?? 2000,
    };
  }

  async list(chatbotId: string): Promise<GuardrailRuleListResponse> {
    await this.scope.assertReadable(chatbotId);
    const [rows, answer] = await Promise.all([this.store.list(chatbotId), this.answerSettings.get(chatbotId)]);
    const items = await this.toDtos(chatbotId, rows);
    const limits = this.limits();
    return {
      items,
      meta: {
        ragActive: answer.ragEnabled && !!answer.ragCompany,
        serverEnabled: this.runtime.isServerEnabled(),
        limits: {
          maxRules: limits.maxRules,
          maxExpressions: limits.maxExpressions,
          usedRules: items.length,
          usedExpressions: items.reduce((n, r) => n + r.expressionCount, 0),
        },
      },
    };
  }

  async get(chatbotId: string, ruleId: string): Promise<GuardrailRule> {
    await this.scope.assertReadable(chatbotId);
    const row = await this.findOrThrow(chatbotId, ruleId);
    return (await this.toDtos(chatbotId, [row]))[0];
  }

  async create(chatbotId: string, dto: CreateGuardrailRuleDto, user: SessionUser | null): Promise<GuardrailRuleSaveResponse> {
    await this.scope.assertWritable(chatbotId);
    const { data, removedDuplicates } = await this.prepare(dto);
    await this.assertNameFree(chatbotId, data.nameNormalized);

    const row = await this.store.create(chatbotId, data, actorOf(user), this.limits());
    this.runtime.invalidate(chatbotId, 'RULES');

    await this.auditLog.record({
      action: 'CREATE',
      targetType: 'GuardrailRule',
      targetId: row.id,
      targetName: row.name,
      chatbotId,
      after: toRuleAuditView(row),
      summary: `위험 응답 규칙 '${row.name}' 생성(동작: ${row.action})`,
    });

    return { ...(await this.toDtos(chatbotId, [row]))[0], removedDuplicateExpressions: removedDuplicates };
  }

  async update(chatbotId: string, ruleId: string, dto: UpdateGuardrailRuleDto, user: SessionUser | null): Promise<GuardrailRuleSaveResponse> {
    await this.scope.assertWritable(chatbotId);
    const before = await this.findOrThrow(chatbotId, ruleId);
    const { data, removedDuplicates } = await this.prepare(dto);
    if (data.nameNormalized !== before.nameNormalized) await this.assertNameFree(chatbotId, data.nameNormalized, ruleId);

    const row = await this.store.update(chatbotId, ruleId, data, actorOf(user), this.limits());
    this.runtime.invalidate(chatbotId, 'RULES');

    await this.auditLog.record({
      action: 'UPDATE',
      targetType: 'GuardrailRule',
      targetId: row.id,
      targetName: row.name,
      chatbotId,
      before: toRuleAuditView(before),
      after: toRuleAuditView(row),
      summary: before.action !== row.action ? `동작 변경: ${before.action} → ${row.action}` : undefined,
    });

    return { ...(await this.toDtos(chatbotId, [row]))[0], removedDuplicateExpressions: removedDuplicates };
  }

  async remove(chatbotId: string, ruleId: string): Promise<void> {
    await this.scope.assertWritable(chatbotId);
    const row = await this.findOrThrow(chatbotId, ruleId);
    await this.store.remove(ruleId);
    this.runtime.invalidate(chatbotId, 'RULES');
    await this.auditLog.record({
      action: 'DELETE',
      targetType: 'GuardrailRule',
      targetId: row.id,
      targetName: row.name,
      chatbotId,
      before: toRuleAuditView(row),
    });
  }

  async setEnabled(chatbotId: string, ruleId: string, enabled: boolean, user: SessionUser | null): Promise<GuardrailRule> {
    await this.scope.assertWritable(chatbotId);
    const before = await this.findOrThrow(chatbotId, ruleId);
    if (before.enabled === enabled) return (await this.toDtos(chatbotId, [before]))[0];

    const row = await this.store.setEnabled(ruleId, enabled, actorOf(user));
    this.runtime.invalidate(chatbotId, 'RULES');
    await this.auditLog.record({
      action: 'UPDATE',
      targetType: 'GuardrailRule',
      targetId: row.id,
      targetName: row.name,
      chatbotId,
      before: toRuleAuditView(before),
      after: toRuleAuditView(row),
      summary: `사용 여부 변경: ${before.enabled} → ${enabled}`,
    });
    return (await this.toDtos(chatbotId, [row]))[0];
  }

  async move(chatbotId: string, ruleId: string, dto: MoveGuardrailRuleDto): Promise<GuardrailRule[]> {
    await this.scope.assertWritable(chatbotId);
    const all = await this.store.list(chatbotId);
    const index = all.findIndex((r) => r.id === ruleId);
    if (index === -1) throw new ApiException('NOT_FOUND', 404, NOT_FOUND);

    const adjacentIndex = dto.direction === 'UP' ? index - 1 : index + 1;
    if (adjacentIndex >= 0 && adjacentIndex < all.length) {
      const target = all[index];
      const adjacent = all[adjacentIndex];
      await this.store.swapSortOrder({ id: target.id, sortOrder: target.sortOrder }, { id: adjacent.id, sortOrder: adjacent.sortOrder });
      this.runtime.invalidate(chatbotId, 'RULES');
      await this.auditLog.record({
        action: 'UPDATE',
        targetType: 'GuardrailRule',
        targetId: target.id,
        targetName: target.name,
        chatbotId,
        summary: `순서 변경: ${dto.direction === 'UP' ? '위로' : '아래로'}`,
      });
    }
    return this.toDtos(chatbotId, await this.store.list(chatbotId));
  }

  /* ── 내부 ── */

  private async findOrThrow(chatbotId: string, ruleId: string): Promise<GuardrailRuleRow> {
    const row = await this.store.find(chatbotId, ruleId);
    if (!row) throw new ApiException('NOT_FOUND', 404, NOT_FOUND);
    return row;
  }

  private async assertNameFree(chatbotId: string, nameNormalized: string, excludeId?: string): Promise<void> {
    const rows = await this.store.list(chatbotId);
    if (rows.some((r) => r.nameNormalized === nameNormalized && r.id !== excludeId)) {
      throw new ApiException('DUPLICATE_NAME', 409, '같은 이름의 규칙이 이미 있습니다. 다른 이름을 적어 주세요.');
    }
  }

  /** 저장 검증 ②③④ — 오류는 `400`(표현 위치별 details) 또는 `400 BANNED_WORD_BLOCKED`. */
  private async prepare(dto: CreateGuardrailRuleDto): Promise<{ data: RuleWriteData; removedDuplicates: number }> {
    const validation = validateRuleBody(dto);
    if (!validation.ok) throw new ApiException('VALIDATION_FAILED', 400, '입력값을 확인해 주세요.', validation.details);
    const { expressions, replacementText, removedDuplicates } = validation.value;

    if (replacementText) {
      const { matches } = await this.bannedWords.test(replacementText);
      if (matches.length > 0) {
        throw new ApiException(
          'BANNED_WORD_BLOCKED',
          400,
          '대체 문구에 금지어가 들어 있어 저장할 수 없습니다.',
          matches.map((m) => ({ field: 'replacementText', message: m.word })),
        );
      }
    }

    return {
      removedDuplicates,
      data: {
        name: dto.name.trim(),
        nameNormalized: normalizeText(dto.name),
        category: dto.category,
        expressions: JSON.stringify(expressions),
        expressionCount: expressions.length,
        matchType: dto.matchType,
        appliesTo: dto.appliesTo,
        action: dto.action,
        replacementText,
        enabled: dto.enabled,
      },
    };
  }

  /** 규칙별 최근 7일 적중(이벤트 groupBy 1쿼리) + 대체 문구 금지어 재검사(저장 뒤 사전이 바뀐 경우 — EX-AG-9). */
  private async toDtos(chatbotId: string, rows: GuardrailRuleRow[]): Promise<GuardrailRule[]> {
    if (rows.length === 0) return [];
    const since = toKstDayBucket(new Date(Date.now() - 6 * DAY_MS));
    const groups = await this.prisma.guardrailEvent.groupBy({
      by: ['ruleId'],
      where: { chatbotId, kind: 'RULE', dayBucket: { gte: since }, ruleId: { in: rows.map((r) => r.id) } },
      _count: { _all: true },
    });
    const hits = new Map(groups.map((g) => [g.ruleId as string, g._count._all]));

    return Promise.all(
      rows.map(async (row) => {
        const replacementBannedHit = row.replacementText ? (await this.bannedWords.test(row.replacementText)).matches.length > 0 : false;
        return toRuleDto(row, { replacementBannedHit, recentHits7d: hits.get(row.id) ?? 0 });
      }),
    );
  }
}
