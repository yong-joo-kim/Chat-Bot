import type { ApiStepView, ButtonAction, DialogOutput, MatchTrace, SurveyStepView, TraceStep } from '@chat-bot/shared-types';

/** 시뮬레이터 대화 1건(사용자/봇/시스템 안내/오류). SIM1·SIM1-D가 공유한다. */
export interface SimMessage {
  id: string;
  role: 'user' | 'bot' | 'system' | 'error';
  text?: string;
  outputs?: DialogOutput[];
  trace?: TraceStep[];
  matchedNodeName?: string;
  matchedIntentName?: string;
  matchedFaqQuestion?: string;
  overlayApplied?: boolean;
  unsupportedOutputs?: string[];
  /** 1단계 top3 점수·구간 판정 + 2단계 사용 여부(FR-N3-10). `TracePanel`이 렌더한다. */
  matchTrace?: MatchTrace;
  /** [No.26] 외부 API 호출이 있었던 턴에만 존재한다. `ApiStepPanel`이 렌더한다. */
  apiStep?: ApiStepView;
  /** [No.27] 이번 턴에 설문 세션이 관여했을 때만 존재한다. `SurveyStepPanel`이 렌더한다. */
  surveyStep?: SurveyStepView;
  /** 오류 말풍선의 "다시 시도"가 재전송할 원본 요청. */
  retryPayload?: { message?: string; buttonAction?: ButtonAction };
}
