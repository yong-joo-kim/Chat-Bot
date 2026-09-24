import { evaluateSurveyAvailability, type Survey, type SurveyStatus } from '@chat-bot/shared-types';
import { MESSAGES } from '../constants/messages';
import { addDaysToDateInputValue, formatDate, toKstDateInputValue } from './date';

export type SurveyDisplayStatus = 'DRAFT' | 'ACTIVE' | 'OUT_OF_PERIOD' | 'CLOSED';

/** `evaluateSurveyAvailability`의 기간 판정을 그대로 타게 하는 안전한 더미 문항(§M4). */
const PROBE_QUESTION: Survey['questions'][number] = {
  key: 'probe-question',
  type: 'TEXT',
  prompt: 'probe',
  required: false,
  maxLength: 300,
};

/**
 * 설문 상태 + 기간을 조합한 "표시 상태"(`survey-management-설계.md` §13.1 "표시 상태(IDLE 판정)").
 * DRAFT/CLOSED는 관리자 화면에서만 필요한 구분이라 `evaluateSurveyAvailability`에는 없는 분기이므로
 * 여기서 먼저 걸러내고, **OPEN 상태의 기간(activeFrom~activeTo) 판정은 `evaluateSurveyAvailability`를
 * 그대로 호출해 재사용**한다 — 날짜 비교(`now < activeFrom` / `now >= activeTo`)를 이 파일에서
 * 다시 구현하지 않는다(M4). 문항 수·완료 이력은 이 배지의 관심사가 아니므로 항상 안전한 더미 값
 * (문항 1개·완료 이력 없음)을 채워 `EMPTY`/`ALREADY_RESPONDED` 분기가 걸리지 않게 한다.
 */
export function computeSurveyDisplayStatus(
  survey: { status: SurveyStatus; activeFrom?: Date | string | null; activeTo?: Date | string | null },
  now: Date = new Date(),
): SurveyDisplayStatus {
  if (survey.status === 'DRAFT') return 'DRAFT';
  if (survey.status === 'CLOSED') return 'CLOSED';
  const probe: Survey = {
    id: 'probe',
    chatbotId: 'probe',
    name: 'probe',
    status: 'OPEN',
    completionMessage: 'probe',
    cancelKeywords: [],
    sessionTimeoutMinutes: 30,
    activeFrom: survey.activeFrom ? new Date(survey.activeFrom) : undefined,
    activeTo: survey.activeTo ? new Date(survey.activeTo) : undefined,
    questions: [PROBE_QUESTION],
    structureVersion: 1,
    createdAt: now,
    updatedAt: now,
  };
  const result = evaluateSurveyAvailability(probe, now, [], false);
  // `status`를 강제로 'OPEN'·문항 1개·완료 이력 없음으로 고정했으므로 ok:false의 유일한 사유는
  // OUT_OF_PERIOD다(NOT_FOUND/EMPTY/ALREADY_RESPONDED/NOT_OPEN은 구조적으로 발생하지 않는다).
  return result.ok ? 'ACTIVE' : 'OUT_OF_PERIOD';
}

export function surveyDisplayStatusLabel(status: SurveyDisplayStatus): string {
  return MESSAGES.surveys.statusLabel[status];
}

/* ------------------------------------------------------------------------------------------------
 * H1 — 종료일(activeTo) 경계 변환. 서버·엔진 판정은 `now < activeTo`(배타적 경계)를 쓰므로,
 * 화면에서 사용자가 고른 "종료일 당일"이 온전히 포함되도록 저장 시 +1일을 보내고, 표시 시 -1일을
 * 되돌린다. activeFrom은 포함(inclusive) 경계라 변환이 필요 없다.
 * ---------------------------------------------------------------------------------------------- */

/** 날짜 입력값(YYYY-MM-DD, 사용자가 고른 종료일 당일)을 저장용 배타적 경계 ISO로 변환한다. */
export function displayDateInputToActiveToIso(dateInputValue: string): string {
  const nextDay = addDaysToDateInputValue(dateInputValue, 1);
  return `${nextDay}T00:00:00+09:00`;
}

/** 날짜 입력값(YYYY-MM-DD, 시작일)을 저장용 ISO로 변환한다(포함 경계라 그대로 자정을 쓴다). */
export function displayDateInputToActiveFromIso(dateInputValue: string): string {
  return `${dateInputValue}T00:00:00+09:00`;
}

/** 저장된 배타적 경계(activeTo)를 화면 입력값(사용자가 고른 종료일 당일, YYYY-MM-DD)으로 되돌린다. */
export function activeToIsoToDisplayDateInput(activeTo: Date | string): string {
  return addDaysToDateInputValue(toKstDateInputValue(activeTo), -1);
}

/** 시작일(activeFrom)은 포함 경계라 그대로 날짜만 뽑으면 된다. */
export function activeFromIsoToDisplayDateInput(activeFrom: Date | string): string {
  return toKstDateInputValue(activeFrom);
}

/**
 * 목록·결과 화면 공용 기간 표시 문구(M3). `activeTo`는 항상 -1일 보정한 "사용자가 고른 종료일"을
 * 보여준다. 한쪽만 있으면 "~10/31"/"9/25~" 형태로, 둘 다 없으면 `MESSAGES.surveys.periodNone`.
 */
export function formatSurveyPeriod(activeFrom?: Date | string | null, activeTo?: Date | string | null): string {
  const fromText = activeFrom ? formatDate(activeFrom) : '';
  const toText = activeTo ? formatDate(activeToIsoToDisplayDateInput(activeTo)) : '';
  if (!fromText && !toText) return MESSAGES.surveys.periodNone;
  if (fromText && toText) return `${fromText} ~ ${toText}`;
  if (fromText) return `${fromText} ~`;
  return `~ ${toText}`;
}
