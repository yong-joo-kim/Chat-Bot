import { Injectable } from '@nestjs/common';
import { hostMatchesRules, normalizeText, PROACTIVE_LIMITS } from '@chat-bot/shared-types';
import type { MoveProactiveRuleDto, ProactiveRuleInput, ProactiveRuleView } from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ChatbotScopeService } from '../chatbots/chatbot-scope.service';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { BannedWordFilterService } from '../banned-words/banned-word-filter.service';
import { ApiException } from '../common/api.exception';
import type { ApiExceptionDetail } from '../common/api.exception';
import { ProactiveOverviewService } from './proactive-overview.service';
import { encodeProactiveRule } from './lib/rule-codec';
import { buildRuleChangeSummary } from './lib/rule-audit-summary';
import { parseProactiveLinkPolicyHosts, safeHostOf } from './lib/link-policy';

const RULE_CHANGE_FIELDS = ['name', 'trigger', 'text', 'buttons', 'devices', 'startsAt', 'endsAt', 'schedule'] as const;

/**
 * [신규 No.35] ★ `ProactiveRule` 쓰기 유일 파일(+ `chatbots.service.ts` 영구삭제 동반 삭제만 예외,
 * PA-2). 저장 검증 순서(§9.2): ① zod(컨트롤러 파이프) ② `NODE` 노드 존재·켜짐(초안) ③ 금지어
 * ④ `LINK` 허용 도메인 ⑤ 이름 유일 ⑥ 생성 시 상한(20) — 전화·이메일 경고(⑦)는 조회 시점
 * (`ProactiveOverviewService`)에서 다시 계산해 응답에 싣는다(차단 아님).
 */
@Injectable()
export class ProactiveRulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ChatbotScopeService,
    private readonly auditLog: AuditLogService,
    private readonly bannedWords: BannedWordFilterService,
    private readonly overview: ProactiveOverviewService,
  ) {}

  async create(chatbotId: string, dto: ProactiveRuleInput, actorId: string | null): Promise<ProactiveRuleView> {
    await this.scope.assertWritable(chatbotId);
    await this.validateReferencesAndContent(chatbotId, dto);

    const nameNormalized = normalizeText(dto.name);
    await this.assertNameFree(chatbotId, nameNormalized);

    const codec = encodeProactiveRule(dto);
    const now = new Date();

    // High #1(코드 리뷰) — 20개 상한 count()와 create()를 같은 트랜잭션 안에서 수행한다(`enable()`의
    // 켜진 규칙 10개 상한 패턴과 동일). 트랜잭션 밖에서 나눠 검사하면 동시 요청이 상한을 넘어설 수
    // 있다(§9.2 표 6번 — 생성 시 상한은 트랜잭션 안 count로 확인).
    const row = await this.prisma.$transaction(async (tx) => {
      const count = await tx.proactiveRule.count({ where: { chatbotId } });
      if (count >= PROACTIVE_LIMITS.rulesMax) {
        throw new ApiException('LIMIT_EXCEEDED', 400, `선제 안내 규칙은 챗봇당 최대 ${PROACTIVE_LIMITS.rulesMax}개까지 만들 수 있습니다.`);
      }

      const max = await tx.proactiveRule.aggregate({ where: { chatbotId }, _max: { position: true } });
      const position = (max._max.position ?? 0) + 1;

      return tx.proactiveRule.create({
        data: {
          chatbotId,
          name: dto.name.trim(),
          nameNormalized,
          enabled: false,
          position,
          ...codec,
          text: dto.text,
          startsAt: dto.startsAt ?? null,
          endsAt: dto.endsAt ?? null,
          purposeConfirmedAt: now,
          purposeConfirmedById: actorId,
          createdById: actorId,
          updatedById: actorId,
        },
      });
    });

    await this.auditLog.record({
      action: 'CREATE',
      targetType: 'ProactiveRule',
      targetId: row.id,
      targetName: row.name,
      chatbotId,
      after: row,
      summary: `선제 안내 '${row.name}' 생성 · 광고·판촉 목적 아님 확인`,
    });

    return this.overview.getRule(chatbotId, row.id);
  }

  async update(chatbotId: string, ruleId: string, dto: ProactiveRuleInput, actorId: string | null): Promise<ProactiveRuleView> {
    await this.scope.assertWritable(chatbotId);
    const before = await this.findRowOrThrow(chatbotId, ruleId);
    await this.validateReferencesAndContent(chatbotId, dto);

    const nameNormalized = normalizeText(dto.name);
    if (nameNormalized !== before.nameNormalized) {
      await this.assertNameFree(chatbotId, nameNormalized, ruleId);
    }

    const codec = encodeProactiveRule(dto);
    const now = new Date();

    const row = await this.prisma.proactiveRule.update({
      where: { id: ruleId },
      data: {
        name: dto.name.trim(),
        nameNormalized,
        ...codec,
        text: dto.text,
        startsAt: dto.startsAt ?? null,
        endsAt: dto.endsAt ?? null,
        purposeConfirmedAt: now,
        purposeConfirmedById: actorId,
        updatedById: actorId,
      },
    });

    const changedFields = buildRuleChangeSummary(before, row, RULE_CHANGE_FIELDS);
    const summary = changedFields.length > 0 ? `바뀐 항목: ${changedFields.join(', ')} · 광고·판촉 목적 아님 확인` : '변경 없음 · 광고·판촉 목적 아님 확인';

    await this.auditLog.record({
      action: 'UPDATE',
      targetType: 'ProactiveRule',
      targetId: row.id,
      targetName: row.name,
      chatbotId,
      before,
      after: row,
      summary,
    });

    return this.overview.getRule(chatbotId, row.id);
  }

  async remove(chatbotId: string, ruleId: string): Promise<void> {
    await this.scope.assertWritable(chatbotId);
    const row = await this.findRowOrThrow(chatbotId, ruleId);
    await this.prisma.proactiveRule.delete({ where: { id: ruleId } });
    await this.auditLog.record({
      action: 'DELETE',
      targetType: 'ProactiveRule',
      targetId: row.id,
      targetName: row.name,
      chatbotId,
      before: row,
    });
  }

  async enable(chatbotId: string, ruleId: string): Promise<ProactiveRuleView> {
    await this.scope.assertWritable(chatbotId);
    const row = await this.findRowOrThrow(chatbotId, ruleId);
    if (row.enabled) return this.overview.getRule(chatbotId, ruleId);

    await this.prisma.$transaction(async (tx) => {
      const enabledCount = await tx.proactiveRule.count({ where: { chatbotId, enabled: true } });
      if (enabledCount >= PROACTIVE_LIMITS.enabledRulesMax) {
        throw new ApiException('LIMIT_EXCEEDED', 400, `켜진 선제 안내 규칙은 최대 ${PROACTIVE_LIMITS.enabledRulesMax}개까지 가능합니다.`);
      }
      await tx.proactiveRule.update({ where: { id: ruleId }, data: { enabled: true } });
    });

    await this.auditLog.record({
      action: 'UPDATE',
      targetType: 'ProactiveRule',
      targetId: ruleId,
      targetName: row.name,
      chatbotId,
      before: { enabled: false },
      after: { enabled: true },
      summary: '사용 여부 변경: false → true',
    });

    return this.overview.getRule(chatbotId, ruleId);
  }

  async disable(chatbotId: string, ruleId: string): Promise<ProactiveRuleView> {
    await this.scope.assertWritable(chatbotId);
    const row = await this.findRowOrThrow(chatbotId, ruleId);
    if (!row.enabled) return this.overview.getRule(chatbotId, ruleId);

    await this.prisma.proactiveRule.update({ where: { id: ruleId }, data: { enabled: false } });
    await this.auditLog.record({
      action: 'UPDATE',
      targetType: 'ProactiveRule',
      targetId: ruleId,
      targetName: row.name,
      chatbotId,
      before: { enabled: true },
      after: { enabled: false },
      summary: '사용 여부 변경: true → false',
    });

    return this.overview.getRule(chatbotId, ruleId);
  }

  async move(chatbotId: string, ruleId: string, dto: MoveProactiveRuleDto): Promise<ProactiveRuleView[]> {
    await this.scope.assertWritable(chatbotId);
    const all = await this.prisma.proactiveRule.findMany({
      where: { chatbotId },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
    const index = all.findIndex((r) => r.id === ruleId);
    if (index === -1) throw new ApiException('NOT_FOUND', 404, '요청하신 규칙을 찾을 수 없습니다.');

    const adjacentIndex = dto.direction === 'UP' ? index - 1 : index + 1;
    if (adjacentIndex < 0 || adjacentIndex >= all.length) {
      return this.overview.listRules(chatbotId);
    }

    const target = all[index];
    const adjacent = all[adjacentIndex];
    await this.prisma.$transaction([
      this.prisma.proactiveRule.update({ where: { id: target.id }, data: { position: adjacent.position } }),
      this.prisma.proactiveRule.update({ where: { id: adjacent.id }, data: { position: target.position } }),
    ]);

    await this.auditLog.record({
      action: 'UPDATE',
      targetType: 'ProactiveRule',
      targetId: target.id,
      targetName: target.name,
      chatbotId,
      summary: `순서 변경: ${dto.direction === 'UP' ? '위로' : '아래로'}`,
    });

    return this.overview.listRules(chatbotId);
  }

  private async findRowOrThrow(chatbotId: string, ruleId: string) {
    const row = await this.prisma.proactiveRule.findUnique({ where: { id: ruleId } });
    if (!row || row.chatbotId !== chatbotId) throw new ApiException('NOT_FOUND', 404, '요청하신 규칙을 찾을 수 없습니다.');
    return row;
  }

  private async assertNameFree(chatbotId: string, nameNormalized: string, excludeId?: string): Promise<void> {
    const existing = await this.prisma.proactiveRule.findFirst({
      where: { chatbotId, nameNormalized, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    if (existing) throw new ApiException('DUPLICATE_NAME', 409, '이미 사용 중인 이름입니다.');
  }

  /** ② `NODE` 버튼 노드 존재·켜짐(초안) ③ 금지어 ④ `LINK` 허용 도메인. */
  private async validateReferencesAndContent(chatbotId: string, dto: ProactiveRuleInput): Promise<void> {
    const nodeButtons = dto.buttons.filter((b) => b.action === 'NODE');
    if (nodeButtons.length > 0) {
      const nodeIds = [...new Set(nodeButtons.map((b) => b.value))];
      const found = await this.prisma.dialogNode.findMany({ where: { id: { in: nodeIds }, chatbotId, enabled: true }, select: { id: true } });
      const foundIds = new Set(found.map((n) => n.id));
      const missingIndex = dto.buttons.findIndex((b) => b.action === 'NODE' && !foundIds.has(b.value));
      if (missingIndex !== -1) {
        const details: ApiExceptionDetail[] = [{ field: `buttons.${missingIndex}.value`, message: '연결할 대화 노드를 찾을 수 없거나 꺼져 있습니다.' }];
        throw new ApiException('INVALID_REFERENCE', 400, '연결할 대화 노드를 찾을 수 없거나 꺼져 있습니다.', details);
      }
    }

    const textsToCheck: { field: string; text: string }[] = [{ field: 'text', text: dto.text }];
    dto.buttons.forEach((b, i) => {
      textsToCheck.push({ field: `buttons.${i}.label`, text: b.label });
      if (b.action === 'MESSAGE') textsToCheck.push({ field: `buttons.${i}.value`, text: b.value });
    });
    for (const { field, text } of textsToCheck) {
      const { matches } = await this.bannedWords.evaluateInbound(text);
      if (matches.length > 0) {
        throw new ApiException('VALIDATION_FAILED', 400, '금지어가 포함되어 있습니다.', [{ field, message: '금지어가 포함되어 있습니다.' }]);
      }
    }

    const linkButtons = dto.buttons.filter((b) => b.action === 'LINK');
    if (linkButtons.length > 0) {
      const policyRow = await this.prisma.chatbotRichUrlPolicy.findUnique({ where: { chatbotId } });
      const hosts = policyRow ? parseProactiveLinkPolicyHosts(policyRow.hosts) : [];
      if (hosts.length > 0) {
        dto.buttons.forEach((b, i) => {
          if (b.action !== 'LINK') return;
          const host = safeHostOf(b.value);
          if (!host || !hostMatchesRules(host, hosts)) {
            throw new ApiException('VALIDATION_FAILED', 400, '허용된 도메인이 아닙니다.', [{ field: `buttons.${i}.value`, message: '허용된 도메인이 아닙니다.' }]);
          }
        });
      }
    }
  }
}
