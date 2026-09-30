import { Injectable } from '@nestjs/common';
import type { GuardrailRule as GuardrailRuleRow } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiException } from '../../common/api.exception';
import { parseExpressions } from '../runtime/guardrail-profile.loader';

export interface RuleWriteData {
  name: string;
  nameNormalized: string;
  category: string;
  /** 원문 표현 JSON 배열 문자열. */
  expressions: string;
  expressionCount: number;
  matchType: string;
  appliesTo: string;
  action: string;
  replacementText: string | null;
  enabled: boolean;
}

export interface RuleActor {
  id: string | null;
  email: string | null;
}

export interface RuleLimits {
  maxRules: number;
  maxExpressions: number;
}

const ORDER = [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }, { id: 'asc' as const }];

function limitExceeded(): ApiException {
  return new ApiException('LIMIT_EXCEEDED', 409, '규칙 수 또는 표현 수가 한도를 넘었습니다. 쓰지 않는 규칙이나 표현을 정리한 뒤 다시 저장해 주세요.');
}

/**
 * ★ `GuardrailRule` 쓰기 유일 파일(AG-4) — 생성·수정·삭제·켜기/끄기·순서 이동. 챗봇 영구삭제 동반 삭제
 * (`chatbots.service.ts`)만 예외다. 상한 검사(규칙 수·표현 총합)는 쓰기와 같은 트랜잭션 안에서 다시 센다.
 */
@Injectable()
export class GuardrailRuleStore {
  constructor(private readonly prisma: PrismaService) {}

  list(chatbotId: string): Promise<GuardrailRuleRow[]> {
    return this.prisma.guardrailRule.findMany({ where: { chatbotId }, orderBy: ORDER });
  }

  async find(chatbotId: string, ruleId: string): Promise<GuardrailRuleRow | null> {
    const row = await this.prisma.guardrailRule.findUnique({ where: { id: ruleId } });
    return row && row.chatbotId === chatbotId ? row : null;
  }

  /** 표현 총합 — 꺼진 규칙도 센다. */
  async usage(chatbotId: string): Promise<{ usedRules: number; usedExpressions: number }> {
    const rows = await this.prisma.guardrailRule.findMany({ where: { chatbotId }, select: { expressions: true } });
    return { usedRules: rows.length, usedExpressions: rows.reduce((n, r) => n + parseExpressions(r.expressions).length, 0) };
  }

  /** 생성(맨 뒤) — 규칙 수·표현 총합 상한을 트랜잭션 안에서 다시 센다. */
  create(chatbotId: string, data: RuleWriteData, actor: RuleActor, limits: RuleLimits): Promise<GuardrailRuleRow> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.guardrailRule.findMany({ where: { chatbotId }, select: { expressions: true, sortOrder: true } });
      const usedExpressions = rows.reduce((n, r) => n + parseExpressions(r.expressions).length, 0);
      if (rows.length + 1 > limits.maxRules || usedExpressions + data.expressionCount > limits.maxExpressions) throw limitExceeded();
      const sortOrder = rows.reduce((max, r) => Math.max(max, r.sortOrder), 0) + 1;
      const { expressionCount: _ignored, ...columns } = data;
      void _ignored;
      return tx.guardrailRule.create({
        data: { chatbotId, ...columns, sortOrder, createdById: actor.id, createdByEmail: actor.email, updatedById: actor.id, updatedByEmail: actor.email },
      });
    });
  }

  /** 전체 교체 — 다른 규칙의 표현 합 + 이 규칙의 새 표현 수로 상한을 다시 센다. */
  update(chatbotId: string, ruleId: string, data: RuleWriteData, actor: RuleActor, limits: RuleLimits): Promise<GuardrailRuleRow> {
    return this.prisma.$transaction(async (tx) => {
      const others = await tx.guardrailRule.findMany({ where: { chatbotId, id: { not: ruleId } }, select: { expressions: true } });
      const usedByOthers = others.reduce((n, r) => n + parseExpressions(r.expressions).length, 0);
      if (usedByOthers + data.expressionCount > limits.maxExpressions) throw limitExceeded();
      const { expressionCount: _ignored, ...columns } = data;
      void _ignored;
      return tx.guardrailRule.update({ where: { id: ruleId }, data: { ...columns, updatedById: actor.id, updatedByEmail: actor.email } });
    });
  }

  async remove(ruleId: string): Promise<void> {
    await this.prisma.guardrailRule.delete({ where: { id: ruleId } });
  }

  setEnabled(ruleId: string, enabled: boolean, actor: RuleActor): Promise<GuardrailRuleRow> {
    return this.prisma.guardrailRule.update({ where: { id: ruleId }, data: { enabled, updatedById: actor.id, updatedByEmail: actor.email } });
  }

  /** 두 규칙의 `sortOrder`를 맞바꾼다(한 트랜잭션). */
  async swapSortOrder(a: { id: string; sortOrder: number }, b: { id: string; sortOrder: number }): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.guardrailRule.update({ where: { id: a.id }, data: { sortOrder: b.sortOrder } }),
      this.prisma.guardrailRule.update({ where: { id: b.id }, data: { sortOrder: a.sortOrder } }),
    ]);
  }
}
