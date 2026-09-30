import { useOutletContext } from 'react-router-dom';
import type { GuardrailRule, GuardrailRuleListResponse } from '@chat-bot/shared-types';
import type { ChatbotDetailContext } from '../../ChatbotDetailLayout';

/** `GuardrailShell`이 규칙 목록을 1회 조회해 하위 화면에 내려주는 값(ui-spec §2.1 — `ragActive`·`serverEnabled`는 규칙 목록 응답에만 있다). */
export interface GuardrailShared {
  rules: GuardrailRule[];
  meta: GuardrailRuleListResponse['meta'] | null;
  loading: boolean;
  error: boolean;
  /** 화면을 비우지 않고(스켈레톤 없이) 목록을 다시 받는다. */
  reload: () => Promise<void>;
  /** 이동 응답처럼 서버가 이미 새 순서를 준 경우 즉시 반영한다. */
  setRules: (rules: GuardrailRule[]) => void;
  /** `security:write` 보유 ∧ 보관되지 않음. */
  canWrite: boolean;
}

export type GuardrailContext = ChatbotDetailContext & { guardrail: GuardrailShared };

export function useGuardrailContext(): GuardrailContext {
  return useOutletContext<GuardrailContext>();
}
