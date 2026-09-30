import type {
  ApiStepView,
  ButtonAction,
  DegradePreview,
  DialogOutput,
  GuardrailInboundView,
  MatchTrace,
  ResolvedBundleTarget,
  SimulatedAnsweredTopic,
  SurveyStepView,
  TraceStep,
  WorkflowStepView,
} from '@chat-bot/shared-types';

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
  /** [신규 No.41] 이번 턴에 `WORKFLOW` 방출이 있었을 때만 존재한다. `WorkflowStepPanel`이 렌더한다(모의 — 발송 0). */
  workflowSteps?: WorkflowStepView[];
  /** [No.22] 답한 자산의 topicId가 있을 때만 존재한다(공통 답변·미응답 = undefined). */
  answeredTopic?: SimulatedAnsweredTopic;
  /** [신규 No.40] 비초안 대상일 때만 존재한다(§4.13). `TracePanel`이 렌더한다. */
  target?: ResolvedBundleTarget;
  /** [신규 No.36] 입구 판정이 `PASS`가 아닐 때만 존재한다. `GuardrailInboundNotice`가 렌더한다(말풍선 바로 아래 — 접힘 밖). */
  guardrailInbound?: GuardrailInboundView;
  /** [신규 No.36] 이 턴을 보낼 때 "AI 답변 사용"이 켜져 있었는지(입구 차단 안내 문구용). */
  ragRequested?: boolean;
  /** 오류 말풍선의 "다시 시도"가 재전송할 원본 요청. */
  retryPayload?: { message?: string; buttonAction?: ButtonAction };
  /** [신규 No.46] 통합 인박스 시뮬레이션(No.42)의 채널 격하 미리보기(RM-7) — 그 밖의 소비자는 undefined. */
  degradePreview?: 'NOT_DEFINED' | DegradePreview;
  /** [신규 No.46] RM-6 — 이 말풍선의 바로연결 칩을 사용(클릭 또는 다음 턴 전송)했으면 `true`(D-4). */
  quickReplyUsed?: boolean;
}
