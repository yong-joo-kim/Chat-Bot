import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DeployScheduleNotice } from '@chat-bot/shared-types';
import { deploySchedulesApi } from '../api/deploySchedules';
import { MESSAGES } from '../constants/messages';
import { formatScheduleDateTime } from '../lib/scheduleTime';
import { useDeployScheduleTimezone } from '../lib/useDeployScheduleMeta';

/**
 * E4 — 대화 자산 편집 화면군의 "예약 충돌 예고" 배너(`scheduled-deploy-ui-spec.md` §4.6.2, FR-D4-3).
 * 화면 최초 마운트 시 1회만 `notice`를 조회한다(저장 후 재조회하지 않음 — 근거는 §4.6.2). 저장을 막지 않는다.
 */
export function ScheduleConflictBanner({ chatbotId }: { chatbotId: string }): JSX.Element | null {
  const [notice, setNotice] = useState<DeployScheduleNotice | null>(null);
  const timezone = useDeployScheduleTimezone();

  useEffect(() => {
    let cancelled = false;
    deploySchedulesApi
      .notice(chatbotId)
      .then((res) => {
        if (!cancelled) setNotice(res);
      })
      .catch(() => {
        // 조회 실패는 배너를 조용히 숨긴다 — 화면 본연의 기능을 막지 않는다.
      });
    return () => {
      cancelled = true;
    };
  }, [chatbotId]);

  const upcoming = notice?.upcomingRestore;
  if (!upcoming) return null;

  const msg = MESSAGES.deploySchedules.notice;
  const extra = upcoming.chainLength > 1 ? msg.conflictExtra(upcoming.chainLength - 1) : '';

  return (
    <p className="form-banner form-banner--warning schedule-conflict-banner" role="status">
      <span aria-hidden="true">⚠</span>{' '}
      {msg.conflictBannerText(formatScheduleDateTime(upcoming.scheduledAt, timezone), upcoming.targetVersionNo ?? 0, extra)}{' '}
      <Link to={`/chatbots/${chatbotId}/deploy-schedules`}>{msg.goToScheduleLink}</Link>
    </p>
  );
}
