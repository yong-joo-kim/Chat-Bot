import type { KbRunView } from '@chat-bot/shared-types';
import { AsyncJobProgress } from '../../../components/AsyncJobProgress';
import { MESSAGES } from '../../../constants/messages';
import { useAnnouncedTransition } from './useAnnouncedTransition';
import { formatEtaSeconds } from './formatEtaSeconds';

/**
 * `KbRunProgress` — `AsyncJobProgress`를 시각 표시(스피너·진행바)로만 감싼 래퍼(§12-① 판단).
 * 화면낭독 알림은 별도 `aria-live` sr-only 텍스트로 분리해 상태 단어가 바뀔 때만 낭독한다
 * (진행률 숫자가 바뀌는 매 폴링마다 재낭독하지 않는다).
 */
export function KbRunProgress({ run }: { run: KbRunView }): JSX.Element {
  const msg = MESSAGES.kbRuns;
  const statusLabel: string = msg.statusLabel[run.status];
  let visibleLabel: string = statusLabel;
  let progress: number | undefined;

  if (run.status === 'INGESTING' && run.progress && run.progress.total > 0) {
    progress = Math.round((run.progress.done / run.progress.total) * 100);
    visibleLabel = `${statusLabel} · ${msg.progressText(run.progress.done, run.progress.total)}`;
    if (run.etaSeconds !== null && run.etaSeconds > 0) {
      visibleLabel += ` · ${formatEtaSeconds(run.etaSeconds)}`;
    }
  } else if (run.status === 'CRAWLING') {
    visibleLabel = `${statusLabel} · 방문 ${run.crawl?.visited ?? 0}건`;
  }
  if (run.waitingReason) visibleLabel += ` · ${msg.waitingReasonLabel[run.waitingReason]}`;

  const announced = useAnnouncedTransition(statusLabel);

  return (
    <div className="kb-run-progress">
      <AsyncJobProgress label={visibleLabel} progress={progress} live={false} />
      <div className="sr-only" aria-live="polite">
        {announced}
      </div>
    </div>
  );
}
