import type { UtteranceAnalysisStage, UtteranceAnalysisStatus } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../constants/messages';
import { SeverityBadge } from '../../../components/SeverityBadge';

/** 실패 사유 코드 → 화면 문구. 매핑에 없으면 서버 메시지가 아니라 일반 문구를 쓴다(DC-15 안전장치). */
export function failureReasonText(code: string | null | undefined): string {
  const map = MESSAGES.utteranceAnalysis.failureReason as Record<string, string>;
  return (code && map[code]) || MESSAGES.utteranceAnalysis.failureReasonFallback;
}

/** 사유 문구의 첫 구절(목록 행용). */
export function failureReasonShort(code: string | null | undefined): string {
  return failureReasonText(code).split('. ')[0].replace(/\.$/, '');
}

/** 진행 상태 글자만(색·아이콘 없이) — 목록·머리·상태 낭독에서 재사용. */
export function analysisStatusLabel(status: UtteranceAnalysisStatus, stage: UtteranceAnalysisStage | null, progress: number): string {
  const msg = MESSAGES.utteranceAnalysis;
  if (status === 'RUNNING') {
    const fn = stage ? msg.runningStage[stage] : undefined;
    return fn ? fn(progress) : msg.runningFallback(progress);
  }
  return msg.status[status];
}

const DONE_STYLE = { backgroundColor: '#DCFCE7', color: '#166534' };
const NEUTRAL_STYLE = { backgroundColor: '#F3F4F6', color: '#374151' };

/**
 * 상태 배지(`deep-clustering-ui-spec.md` §3.3) — 색 + 아이콘(`aria-hidden`) + 글자를 함께 쓴다.
 * 진행=정보, 오류=오류, 완료=성공, 취소=중립. 오류는 사유 첫 구절을 붙인다(`failureReason`이 있을 때).
 */
export function AnalysisStatusText({
  status,
  stage,
  progress,
  failureReason,
}: {
  status: UtteranceAnalysisStatus;
  stage: UtteranceAnalysisStage | null;
  progress: number;
  failureReason?: string | null;
}): JSX.Element {
  const label = analysisStatusLabel(status, stage, progress);
  if (status === 'RUNNING' || status === 'QUEUED') return <SeverityBadge severity="INFO" label={label} />;
  if (status === 'FAILED') {
    return <SeverityBadge severity="ERROR" label={failureReason ? `${label} · ${failureReasonShort(failureReason)}` : label} />;
  }
  const style = status === 'SUCCEEDED' ? DONE_STYLE : NEUTRAL_STYLE;
  return (
    <span className="severity-badge" style={style}>
      <span aria-hidden="true">{status === 'SUCCEEDED' ? '✔' : '⊘'}</span> {label}
    </span>
  );
}
