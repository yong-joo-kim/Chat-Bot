import { Injectable } from '@nestjs/common';
import { GUARDRAIL_PII_DEFAULT_KINDS } from '@chat-bot/shared-types';
import type { GuardrailRuleRow } from '../lib/types';
import { normalizeKinds } from '../lib/exit-pii';
import { PrismaService } from '../../prisma/prisma.service';
import type { ExitSetting } from './guardrail-profile.cache';

/** 규칙 행 → 컴파일 입력(표현 JSON 파싱 — 깨진 JSON은 빈 배열로 수렴, 그 규칙은 아무것도 걸지 않는다). */
export function parseExpressions(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function parseKinds(json: string): ReturnType<typeof normalizeKinds> {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? normalizeKinds(parsed.filter((v): v is string => typeof v === 'string')) : [...GUARDRAIL_PII_DEFAULT_KINDS];
  } catch {
    return [...GUARDRAIL_PII_DEFAULT_KINDS];
  }
}

export function defaultExitSetting(): ExitSetting {
  return { kinds: [...GUARDRAIL_PII_DEFAULT_KINDS], preserveDates: true, isDefault: true };
}

/**
 * 가드레일 캐시 적재용 Prisma **읽기** 3쿼리(설계서 §4.4) — 색인 · 규칙 · 설정. 쓰기 0(AG-4).
 */
@Injectable()
export class GuardrailProfileLoader {
  constructor(private readonly prisma: PrismaService) {}

  /** ① 전역 색인 — 켜진 규칙이 하나라도 있는 챗봇 id 집합. */
  async loadIndex(): Promise<Set<string>> {
    const rows = await this.prisma.guardrailRule.findMany({
      where: { enabled: true },
      select: { chatbotId: true },
      distinct: ['chatbotId'],
    });
    return new Set(rows.map((r) => r.chatbotId));
  }

  /** ② 챗봇의 켜진 규칙(`sortOrder` → `createdAt` → `id`). */
  async loadRules(chatbotId: string): Promise<GuardrailRuleRow[]> {
    const rows = await this.prisma.guardrailRule.findMany({
      where: { chatbotId, enabled: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category as GuardrailRuleRow['category'],
      expressions: parseExpressions(r.expressions),
      matchType: r.matchType as GuardrailRuleRow['matchType'],
      appliesTo: r.appliesTo as GuardrailRuleRow['appliesTo'],
      action: r.action as GuardrailRuleRow['action'],
      replacementText: r.replacementText,
      sortOrder: r.sortOrder,
      createdAt: r.createdAt,
    }));
  }

  /** ③ 출구 설정 — 행이 없으면 기본값(주민번호·카드 + 날짜 보호). */
  async loadSetting(chatbotId: string): Promise<ExitSetting> {
    const row = await this.prisma.chatbotGuardrailSetting.findUnique({ where: { chatbotId } });
    if (!row) return defaultExitSetting();
    return { kinds: parseKinds(row.piiExitKinds), preserveDates: row.piiPreserveDates, isDefault: false };
  }
}
