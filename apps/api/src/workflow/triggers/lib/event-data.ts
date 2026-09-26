import type { WorkflowEventData } from '@chat-bot/shared-types';

/** [신규 No.41] 이벤트별 봉투 `data` 조립(§6.5) — 순수. 텍스트 본문 0 · 수치·열거값·id만. */

export function handoffStartedData(input: { handoffId: string; alertLevelAtStart: string; consecutiveUnansweredAtStart: number }): WorkflowEventData {
  return input as WorkflowEventData;
}

export function handoffEndedData(input: {
  handoffId: string;
  endReason: string;
  userMessageCount: number;
  agentMessageCount: number;
  firstResponseSeconds: number | null;
  durationSeconds: number;
}): WorkflowEventData {
  return input as WorkflowEventData;
}

export function surveyCompletedData(input: {
  surveyId: string;
  surveyName: string;
  responseId: string;
  isDuplicate: boolean;
  missingRequiredCount: number;
  answers?: Array<{ questionKey: string; choiceKeys?: string[]; score?: number }>;
}): WorkflowEventData {
  return input as WorkflowEventData;
}

export function feedbackNegativeData(input: {
  feedbackId: string;
  messageId: string;
  targetKind: string;
  targetId: string | null;
  answeredByRag: boolean;
}): WorkflowEventData {
  return input as WorkflowEventData;
}

export function unansweredStreakData(input: {
  streakCount: number;
  threshold: number;
  lastMessageId: string | null;
  lastReason: 'FALLBACK' | 'API_NOTICE';
}): WorkflowEventData {
  return input as WorkflowEventData;
}
