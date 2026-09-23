import type { DeploySchedulePreviewResponse } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../constants/messages';
import { formatScheduleDateTime } from '../../../lib/scheduleTime';

type RestoreBase = NonNullable<DeploySchedulePreviewResponse['restore']>['base'];

/**
 * "기준: 10/1 00:00(KST, UTC+9) 예약(v31) 반영 후 상태" 안내(FR-D7-4). `timezone`은 호출부
 * (`ScheduleDeployDialog`)가 이미 가진 값을 그대로 내려받는다(No.28 리뷰 2라운드 M-1 — 하드코딩
 * Asia/Seoul `formatDateTime` 대신 meta 기반 시간대를 쓰고 라벨을 병기한다).
 */
export function ChainBasisNotice({ base, timezone }: { base: RestoreBase; timezone: string }): JSX.Element {
  const msg = MESSAGES.deploySchedules.dialog;
  if (base.kind === 'CURRENT') {
    return <p className="chain-basis-notice">{msg.chainBasisNoticeCurrent}</p>;
  }
  return <p className="chain-basis-notice">{msg.chainBasisNoticeChain(formatScheduleDateTime(base.scheduledAt, timezone), base.versionNo)}</p>;
}
