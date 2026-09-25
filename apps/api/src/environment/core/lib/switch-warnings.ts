import type { ChatbotSnapshotProfile, ProdSwitchWarning } from '@chat-bot/shared-types';

/**
 * [신규 No.40] §9.4 — 경고 산출 순수 함수. `GATE_WARN`은 게이트 판정 결과에서 직접 조립한다
 * (`prod-switch.service.ts`). 외부 참조(SURVEY_*·API_CONNECTION_*)·토픽 노출(TOPIC_*)은 DB 조회가
 * 필요해 서비스가 미리 계산한 건수를 받는다 — 이 함수 자체는 DB·Nest 무의존이다.
 */
export function computeSwitchWarnings(input: {
  targetLegacyTiebreak: boolean;
  semanticMissing: number;
  targetCreatedAt: Date;
  draftLatestCapturedAt: Date;
  currentProfile: ChatbotSnapshotProfile;
  targetProfile: ChatbotSnapshotProfile;
  contextFlowsAffected: number;
  topicExposure: { exposed: number; hidden: number };
  topicMissingCount: number;
  surveyMissingCount: number;
  surveyNotOpenCount: number;
  apiConnectionMissingCount: number;
  apiConnectionDisabledCount: number;
}): ProdSwitchWarning[] {
  const warnings: ProdSwitchWarning[] = [];

  if (input.targetLegacyTiebreak) warnings.push({ code: 'LEGACY_TIEBREAK' });
  if (input.semanticMissing > 0) warnings.push({ code: 'SEMANTIC_INDEX_PENDING', count: input.semanticMissing });
  if (input.contextFlowsAffected > 0) warnings.push({ code: 'CONTEXT_FLOWS_AFFECTED', count: input.contextFlowsAffected });
  if (input.topicExposure.exposed > 0 || input.topicExposure.hidden > 0) {
    warnings.push({ code: 'TOPIC_EXPOSURE_CHANGE', exposed: input.topicExposure.exposed, hidden: input.topicExposure.hidden });
  }
  if (input.topicMissingCount > 0) warnings.push({ code: 'TOPIC_MISSING', count: input.topicMissingCount });
  if (input.surveyMissingCount > 0) warnings.push({ code: 'SURVEY_MISSING', count: input.surveyMissingCount });
  if (input.surveyNotOpenCount > 0) warnings.push({ code: 'SURVEY_NOT_OPEN', count: input.surveyNotOpenCount });
  if (input.apiConnectionMissingCount > 0) warnings.push({ code: 'API_CONNECTION_MISSING', count: input.apiConnectionMissingCount });
  if (input.apiConnectionDisabledCount > 0) warnings.push({ code: 'API_CONNECTION_DISABLED', count: input.apiConnectionDisabledCount });
  if (input.targetCreatedAt.getTime() < input.draftLatestCapturedAt.getTime()) warnings.push({ code: 'OLDER_THAN_DRAFT' });

  const fields: string[] = [];
  if (input.currentProfile.name !== input.targetProfile.name) fields.push('name');
  if (input.currentProfile.avatarUrl !== input.targetProfile.avatarUrl) fields.push('avatarUrl');
  if (JSON.stringify(input.currentProfile.skin) !== JSON.stringify(input.targetProfile.skin)) fields.push('skin');
  if (fields.length > 0) warnings.push({ code: 'PROFILE_WILL_CHANGE', fields });

  return warnings;
}
