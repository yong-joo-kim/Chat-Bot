import type { FallbackPolicy } from '@chat-bot/shared-types';
import type { InputKind } from '../../learning/lib/collect-decision';

export interface ShouldRunRagInput {
  ragEnabled: boolean;
  ragCompany: string | null;
  /** 1단계 결과 — `judgeAnswered(trace)`. false(폴백 도달)일 때만 2단계 후보다. */
  judgeAnswered: boolean;
  inputKind: InputKind;
  blockedByFilter: boolean;
  /** 컨텍스트 세션(슬롯필링) 진행 중인 턴인가(FR-N2-1 ⑥). */
  sessionInProgress: boolean;
  /** 되묻기(홈오님/의미매칭 모두 포함) 해소 턴이었는가(FR-N2-1 ⑦). */
  wasClarifyResolution: boolean;
  normalizedLength: number;
  fallbackPolicy: FallbackPolicy;
  hasFallbackNode: boolean;
}

/**
 * 2단계 실행 조건 9개 중 정적으로 판단 가능한 부분(FR-N2-1) — 순수 함수. 회로차단·동시성·
 * 레이트리밋·`vllm_ready`(조건 ⑨)는 상태를 갖는 `RagGateService.tryAcquire()`가 별도로 담당한다.
 */
export function shouldRunRag(input: ShouldRunRagInput): boolean {
  if (!input.ragEnabled || !input.ragCompany) return false;
  if (input.judgeAnswered) return false; // 1단계가 이미 답했다 — 2단계로 갈 이유가 없다(폴백 도달 아님).
  if (input.blockedByFilter) return false;
  if (input.inputKind === 'BUTTON_NODE') return false; // 봇이 준 선택지는 질문이 아니다.
  if (input.sessionInProgress) return false; // 슬롯 입력을 질문으로 오인하면 폼이 깨진다.
  if (input.wasClarifyResolution) return false;
  if (input.normalizedLength < 2 || input.normalizedLength > 200) return false;
  if (input.fallbackPolicy === 'NODE_FIRST' && input.hasFallbackNode) return false;
  return true;
}
