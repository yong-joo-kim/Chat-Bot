import type { GuardrailPiiKind } from '@chat-bot/shared-types';
import type { CompiledProfile } from './compile-profile';
import { evaluateRules } from './evaluate-rules';
import { applyGovernanceFloor, isTokensOnly, maskExit, totalCount } from './exit-pii';
import type { OutboundVerdict } from './types';

export interface ExitSettingInput {
  kinds: readonly GuardrailPiiKind[];
  preserveDates: boolean;
}

/**
 * 출구 판정 합성(설계서 §6.2) — 규칙 대조 → (대체가 아니면) 개인정보 형식 가림. 순수 함수 — 캐시·예외 수렴은
 * 런타임 서비스가, 이 함수는 판정 자체만 한다(시험하기·시뮬레이터·런타임이 같은 함수를 쓴다).
 */
export function judgeOutbound(text: string, profile: CompiledProfile, setting: ExitSettingInput, governanceOn: boolean): OutboundVerdict {
  const evaluation = evaluateRules(text, profile.outbound);
  const common = { hits: evaluation.hits, decisiveRuleId: evaluation.decisiveRuleId };

  if (evaluation.action === 'REPLACE') {
    if (!evaluation.replacementText) {
      // 저장 검증이 막는 상태(REPLACE ∧ 문구 없음) — 데이터 이상은 원답을 내보내지 않고 폴백한다.
      return { kind: 'FALLBACK', text, fallbackReason: 'ERROR', errorCode: 'REPLACEMENT_MISSING', piiCounts: {}, ...common };
    }
    return { kind: 'REPLACE', text, replacementText: evaluation.replacementText, piiCounts: {}, ...common };
  }

  const kinds = applyGovernanceFloor(setting.kinds, governanceOn);
  const masked = maskExit(text, kinds, setting.preserveDates);
  const total = totalCount(masked.counts);

  if (total > 0) {
    if (isTokensOnly(masked.maskedText)) {
      return { kind: 'FALLBACK', text: masked.maskedText, fallbackReason: 'PII_ONLY', piiCounts: masked.counts, ...common };
    }
    return { kind: 'MASKED', text: masked.maskedText, piiCounts: masked.counts, ...common };
  }

  return { kind: evaluation.hits.length > 0 ? 'MONITOR' : 'PASS', text, piiCounts: {}, ...common };
}
