import type { SurveyStatus } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../../constants/messages';
import { computeSurveyDisplayStatus, type SurveyDisplayStatus } from '../../../../lib/surveyDisplay';

const STATUS_TONE: Record<SurveyDisplayStatus, { bg: string; fg: string; icon: string }> = {
  DRAFT: { bg: '#F3F4F6', fg: '#374151', icon: '○' },
  ACTIVE: { bg: '#DCFCE7', fg: '#166534', icon: '●' },
  OUT_OF_PERIOD: { bg: '#FFEDD5', fg: '#9A3412', icon: '◐' },
  CLOSED: { bg: '#F3F4F6', fg: '#374151', icon: '■' },
};

/** SV1/SV2/D1b 공용 — 상태+기간을 조합한 "표시 상태" 배지(ui-spec §2.1 `SurveyStatusBadge`). */
export function SurveyStatusBadge({
  status,
  activeFrom,
  activeTo,
}: {
  status: SurveyStatus;
  activeFrom?: Date | string | null;
  activeTo?: Date | string | null;
}): JSX.Element {
  const displayStatus = computeSurveyDisplayStatus({ status, activeFrom, activeTo });
  const cfg = STATUS_TONE[displayStatus];
  return (
    <span className="dialogue-badge" style={{ backgroundColor: cfg.bg, color: cfg.fg }}>
      <span aria-hidden="true">{cfg.icon}</span> {MESSAGES.surveys.statusLabel[displayStatus]}
    </span>
  );
}

/** 응답 1건 이상일 때만 상태 배지와 별도로 병기한다(ui-spec §2.1 `SurveyLockedBadge`). */
export function SurveyLockedBadge(): JSX.Element {
  return (
    <span className="dialogue-badge" style={{ backgroundColor: '#FFEDD5', color: '#9A3412' }}>
      <span aria-hidden="true">🔒</span> {MESSAGES.surveys.lockedBadge}
    </span>
  );
}

/** 노드 편집기 v1 카드(§3.4) — WARNING 톤(`UnsupportedOutputBadge`의 INFO 톤과 구분). */
export function LegacySurveyBadge(): JSX.Element {
  return (
    <span className="dialogue-badge" style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}>
      <span aria-hidden="true">⚠</span> {MESSAGES.dialogue.outputFields.legacySurveyBadgeLabel}
    </span>
  );
}

/** 설문 결과(SV3) 문항 카드 — 노출/응답 30건 미만(ui-spec §2.1 `SurveyLowSampleBadge`). */
export function SurveyLowSampleBadge(): JSX.Element {
  return (
    <span className="dialogue-badge dialogue-badge--neutral">
      <span aria-hidden="true">ⓘ</span> {MESSAGES.surveys.lowSampleBadge}
    </span>
  );
}

/** 응답 목록 행 — `isDuplicate=true`(ui-spec §2.1 `SurveyDuplicateBadge`). */
export function SurveyDuplicateBadge(): JSX.Element {
  return (
    <span className="dialogue-badge dialogue-badge--neutral">
      {MESSAGES.surveys.duplicateBadge}
      <span className="field-hint"> ({MESSAGES.surveys.duplicateBadgeCaption})</span>
    </span>
  );
}

/** 시뮬레이터 결과 패널·설문 편집기 미리보기 — 항상 노출(ui-spec §2.1 `SurveyPreviewSavedBadge`). */
export function SurveyPreviewSavedBadge(): JSX.Element {
  return (
    <span className="dialogue-badge" style={{ backgroundColor: '#DBEAFE', color: '#1D4ED8' }}>
      <span aria-hidden="true">ⓘ</span> {MESSAGES.surveys.previewSavedBadge}
    </span>
  );
}

/** TC 실행 결과 행 — `surveyPreviewA`/`surveyPreviewB`(ui-spec §2.1 `SurveyPreviewJudgmentBadge`). */
export function SurveyPreviewJudgmentBadge(): JSX.Element {
  return (
    <span className="dialogue-badge" style={{ backgroundColor: '#DBEAFE', color: '#1D4ED8' }}>
      <span aria-hidden="true">ⓘ</span> {MESSAGES.surveys.previewJudgmentBadge}
    </span>
  );
}
