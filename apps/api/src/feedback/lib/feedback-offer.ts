import { WIDGET_FEATURE_FEEDBACK_V1 } from '@chat-bot/shared-types';
import type { WebChannelConfig } from '@chat-bot/shared-types';
import { parseChannelConfig } from '../../channels/lib/channel-config';

/**
 * WEB 채널 설정 JSON에서 `feedbackEnabled`를 읽는다(§5.1). 파싱 실패·미설정은 false로 폴백한다.
 * 공개 대화·공개 평가가 같은 함수를 쓴다.
 */
export function readFeedbackEnabled(webChannelConfigJson: string): boolean {
  return (parseChannelConfig('WEB', webChannelConfigJson) as WebChannelConfig).feedbackEnabled === true;
}

/**
 * 평가 가능 판정(FR-FB2-\*, ADR-0038 §1) — 순수 함수, DB·Nest 무의존(NFR-FBM1).
 * `features`를 먼저 보고 거짓이면 설정을 파싱하지 않는다(구버전 위젯의 CPU 경로 불변).
 * `blockedByFilter`·`handoffTurn`은 호출 지점상 항상 false로 들어온다(BLOCK·HANDLED 경로는 이
 * 함수를 부르지 않는다) — 방어적으로 남겨 둔다.
 */
export function isFeedbackOffered(input: {
  features: readonly string[] | undefined;
  webChannelConfigJson: string;
  blockedByFilter: boolean;
  surveyTurn: boolean;
  handoffTurn: boolean;
}): boolean {
  if (!(input.features ?? []).includes(WIDGET_FEATURE_FEEDBACK_V1)) return false;
  if (input.blockedByFilter || input.surveyTurn || input.handoffTurn) return false;
  return readFeedbackEnabled(input.webChannelConfigJson);
}
