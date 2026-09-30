import { Injectable } from '@nestjs/common';
import { normalizeText } from '@chat-bot/shared-types';
import type { GuardrailTestRequest, GuardrailTestResponse } from '@chat-bot/shared-types';
import { ChatbotScopeService } from '../chatbots/chatbot-scope.service';
import { BannedWordFilterService } from '../banned-words/banned-word-filter.service';
import { ApiException } from '../common/api.exception';
import { GuardrailRuleStore } from './core/guardrail-rule.store';
import { GuardrailSettingStore } from './core/guardrail-setting.store';
import { GuardrailRuntimeService } from './runtime/guardrail-runtime.service';
import { defaultExitSetting, parseExpressions, parseKinds } from './runtime/guardrail-profile.loader';
import { compileProfile } from './lib/compile-profile';
import { evaluateRules } from './lib/evaluate-rules';
import { judgeOutbound } from './lib/judge-outbound';
import { validateRuleBody } from './lib/rule-validate';
import type { GuardrailRuleRow } from './lib/types';

const DRAFT_RULE_ID = '00000000-0000-0000-0000-000000000000';

/**
 * 문장으로 시험하기(설계서 §4·§13.1) — **저장 0 · 감사 0 · 이벤트 0**. 저장된 켜진 규칙에 편집 중인 규칙·
 * 출구 설정을 저장 전에 반영해 같은 순수 판정(`evaluateRules`·`judgeOutbound`)을 돌린다.
 */
@Injectable()
export class GuardrailTestService {
  constructor(
    private readonly scope: ChatbotScopeService,
    private readonly bannedWords: BannedWordFilterService,
    private readonly rules: GuardrailRuleStore,
    private readonly settings: GuardrailSettingStore,
    private readonly runtime: GuardrailRuntimeService,
  ) {}

  async test(chatbotId: string, dto: GuardrailTestRequest): Promise<GuardrailTestResponse> {
    await this.scope.assertReadable(chatbotId);

    const rows = await this.rules.list(chatbotId);
    let candidates: GuardrailRuleRow[] = rows
      .filter((r) => r.enabled)
      .map((r) => ({
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

    if (dto.draftRule) {
      const validation = validateRuleBody(dto.draftRule);
      if (!validation.ok) throw new ApiException('VALIDATION_FAILED', 400, '입력값을 확인해 주세요.', validation.details);

      const existing = dto.draftRuleId ? rows.find((r) => r.id === dto.draftRuleId) : undefined;
      if (dto.draftRuleId && !existing) throw new ApiException('NOT_FOUND', 404, '요청하신 규칙을 찾을 수 없습니다.');
      const draft: GuardrailRuleRow = {
        id: existing?.id ?? DRAFT_RULE_ID,
        name: dto.draftRule.name.trim() || normalizeText(dto.draftRule.name),
        category: dto.draftRule.category,
        expressions: validation.value.expressions,
        matchType: dto.draftRule.matchType,
        appliesTo: dto.draftRule.appliesTo,
        action: dto.draftRule.action,
        replacementText: validation.value.replacementText,
        sortOrder: existing?.sortOrder ?? rows.reduce((max, r) => Math.max(max, r.sortOrder), 0) + 1,
        createdAt: existing?.createdAt ?? new Date(),
      };
      candidates = candidates.filter((r) => r.id !== draft.id);
      if (dto.draftRule.enabled) candidates.push(draft);
    }

    const profile = compileProfile(candidates);

    if (dto.stage === 'INBOUND') {
      const result = evaluateRules(dto.text, profile.inbound);
      const replaced = result.action === 'REPLACE' && !!result.replacementText;
      return {
        stage: 'INBOUND',
        result: result.action === 'REPLACE' && !replaced ? 'MONITOR' : result.action,
        hits: result.hits.map((h) => ({
          ruleId: h.ruleId === DRAFT_RULE_ID ? null : h.ruleId,
          ruleName: h.ruleName,
          category: h.category,
          action: h.action,
          decisive: h.ruleId === result.decisiveRuleId,
          matchedExpressions: h.matched,
        })),
        resultText: replaced ? await this.bannedWords.maskPlainText(result.replacementText as string) : dto.text,
        piiCounts: {},
      };
    }

    const savedSetting = await this.settings.find(chatbotId);
    const base = savedSetting ? { kinds: parseKinds(savedSetting.piiExitKinds), preserveDates: savedSetting.piiPreserveDates } : defaultExitSetting();
    const setting = dto.draftPiiExit ?? base;
    const verdict = judgeOutbound(dto.text, profile, setting, this.runtime.isGovernanceOn());

    let resultText = dto.text;
    if (verdict.kind === 'REPLACE') resultText = verdict.replacementText ?? '';
    else if (verdict.kind === 'MASKED') resultText = verdict.text;
    else if (verdict.kind === 'FALLBACK') resultText = '';
    // 출구 금지어 적용 후 표시(운영과 같은 순서 — 가림 뒤 금지어 마스킹).
    resultText = resultText ? await this.bannedWords.maskPlainText(resultText) : resultText;

    return {
      stage: 'OUTBOUND',
      result: verdict.kind,
      hits: verdict.hits.map((h) => ({
        ruleId: h.ruleId === DRAFT_RULE_ID ? null : h.ruleId,
        ruleName: h.ruleName,
        category: h.category,
        action: h.action,
        decisive: h.ruleId === verdict.decisiveRuleId,
        matchedExpressions: h.matched,
      })),
      resultText,
      piiCounts: verdict.piiCounts,
    };
  }
}
