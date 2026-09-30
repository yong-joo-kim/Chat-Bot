import { Link } from 'react-router-dom';
import type { UtteranceAnalysisDetail } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../constants/messages';

interface NoticeItem {
  key: string;
  tone: 'info' | 'warning';
  text: string;
  linkTo?: string;
  linkLabel?: string;
}

/** 완료 화면의 알림 목록(§5.4 표) — 해당하는 것만 정보/주의 배너로 글자로 보인다. */
export function buildNoticeItems(detail: UtteranceAnalysisDetail, opts: { canWrite: boolean; newAnalysisPath: string }): NoticeItem[] {
  const n = MESSAGES.utteranceAnalysis.notices;
  const items: NoticeItem[] = [];
  const actualClusters = detail.clusters.filter((c) => !c.unassigned).length;

  for (const notice of detail.notices) {
    if (notice === 'TARGET_REDUCED') items.push({ key: notice, tone: 'info', text: n.TARGET_REDUCED });
    else if (notice === 'FEWER_THAN_TARGET') {
      items.push({ key: notice, tone: 'info', text: n.FEWER_THAN_TARGET(detail.conditions.targetClusterCount, actualClusters) });
    } else if (notice === 'NO_CLUSTER') {
      items.push({
        key: notice,
        tone: 'warning',
        text: n.NO_CLUSTER,
        ...(opts.canWrite ? { linkTo: opts.newAnalysisPath, linkLabel: n.NO_CLUSTER_LINK } : {}),
      });
    } else if (notice === 'HEURISTIC_ANALYZER') items.push({ key: notice, tone: 'warning', text: n.HEURISTIC_ANALYZER });
  }
  if (detail.staleModel) items.push({ key: 'staleModel', tone: 'info', text: n.staleModel });
  if (detail.probe.status === 'OFF') items.push({ key: 'probeOff', tone: 'info', text: n.probeOff });
  if (detail.probe.status === 'FAILED') {
    const reason = detail.probe.failureReason === 'TARGET_VERSION_UNREADABLE' ? n.probeFailedVersion : n.probeFailedOther;
    items.push({ key: 'probeFailed', tone: 'warning', text: n.probeFailed(reason) });
  }
  if (detail.probe.status === 'DONE' && detail.probe.wouldUseRagCount > 0) {
    items.push({ key: 'wouldUseRag', tone: 'info', text: n.wouldUseRag(detail.probe.wouldUseRagCount) });
  }
  if (detail.nameSuggest.status === 'FAILED') items.push({ key: 'nameSuggestFailed', tone: 'warning', text: n.nameSuggestFailed });
  if (detail.nameSuggest.status === 'PARTIAL') items.push({ key: 'nameSuggestPartial', tone: 'warning', text: n.nameSuggestPartial });
  return items;
}

export function AnalysisNoticeList({ detail, canWrite, newAnalysisPath }: { detail: UtteranceAnalysisDetail; canWrite: boolean; newAnalysisPath: string }): JSX.Element | null {
  const items = buildNoticeItems(detail, { canWrite, newAnalysisPath });
  if (items.length === 0) return null;
  return (
    <ul className="ua-notice-list">
      {items.map((it) => (
        <li key={it.key} className={`form-banner form-banner--${it.tone}`}>
          <span aria-hidden="true">{it.tone === 'warning' ? '⚠' : 'ⓘ'}</span> {it.text}
          {it.linkTo && (
            <>
              {' '}
              <Link to={it.linkTo}>{it.linkLabel}</Link>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
