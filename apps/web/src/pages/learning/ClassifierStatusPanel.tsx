import { useCallback, useEffect, useRef, useState } from 'react';
import type { IntentClassifierStatus } from '@chat-bot/shared-types';
import { classifierApi } from '../../api/classifier';
import { trainingJobsApi } from '../../api/trainingJobs';
import { ApiError } from '../../api/client';
import { MESSAGES } from '../../constants/messages';
import { AsyncJobProgress } from '../../components/AsyncJobProgress';
import { SkeletonRow } from '../../components/Skeleton';
import { useTrainingJobPolling } from '../../lib/useTrainingJobPolling';
import { CLASSIFIER_STATE_LABEL, ClassifierStatusBadge, deriveClassifierDisplayState } from './ClassifierBadges';

const msg = MESSAGES.classifier;

function sessionKey(chatbotId: string): string {
  return `classifierJob:${chatbotId}`;
}

function formatDateTime(d: Date): string {
  return new Date(d).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function reasonAndResolution(status: IntentClassifierStatus, state: ReturnType<typeof deriveClassifierDisplayState>): { reason?: string; resolution?: string } {
  if (state === 'NONE') return { reason: msg.reasonNone, resolution: msg.resolutionNone };
  if (state === 'UNAVAILABLE') {
    if (status.staleReasons.includes('MODEL_CHANGED')) {
      return { reason: msg.reasonModelChanged, resolution: msg.resolutionModelChanged };
    }
    return { reason: msg.reasonFailed, resolution: msg.resolutionFailed };
  }
  if (state === 'STALE') {
    const reasons: string[] = [];
    if (status.staleReasons.includes('INTENTS_DRIFTED')) reasons.push(msg.reasonIntentsDrifted);
    if (status.staleReasons.includes('EXAMPLES_DRIFTED')) reasons.push(msg.reasonExamplesDrifted);
    return { reason: reasons.join(' '), resolution: msg.resolutionStale };
  }
  return {};
}

export interface ClassifierStatusPanelProps {
  chatbotId: string;
  canWrite: boolean;
}

/** B1 — 분류기 상태 패널(학습현황 L1 상단, ui-spec §5.2~5.3). "반영"·"적용" 단어를 쓰지 않는다(K-6). */
export function ClassifierStatusPanel({ chatbotId, canWrite }: ClassifierStatusPanelProps): JSX.Element | null {
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<IntentClassifierStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [insufficientData, setInsufficientData] = useState(false);
  const restoredRef = useRef(false);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await classifierApi.status(chatbotId);
      setStatus(res);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [chatbotId]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const saved = window.sessionStorage.getItem(sessionKey(chatbotId));
    if (saved) setJobId(saved);
  }, [chatbotId]);

  const jobState = useTrainingJobPolling(jobId, (id) => trainingJobsApi.get(chatbotId, id), {
    initialDelayMs: 500,
    intervalMs: 1500,
    maxWaitMs: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (jobState.phase === 'done') {
      window.sessionStorage.removeItem(sessionKey(chatbotId));
      setJobId(null);
      void loadStatus();
    } else if (jobState.phase === 'timeout') {
      window.sessionStorage.removeItem(sessionKey(chatbotId));
      setJobId(null);
    }
  }, [jobState.phase, chatbotId, loadStatus]);

  async function handleTrain(): Promise<void> {
    setInsufficientData(false);
    try {
      const res = await classifierApi.train(chatbotId);
      window.sessionStorage.setItem(sessionKey(chatbotId), res.jobId);
      setJobId(res.jobId);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CLASSIFIER_INSUFFICIENT_DATA') {
        setInsufficientData(true);
      }
      // 409(진행 중)는 조용히 무시한다 — 이미 폴링 중인 잡이 있다면 그대로 두고, 없다면 다음 상태 조회에서 TRAINING으로 갱신된다.
    }
  }

  if (loading && !status) {
    return <SkeletonRow />;
  }
  if (error && !status) {
    return null; // L1 화면 자체를 막지 않는다 — 패널만 조용히 숨긴다(보조 도구).
  }
  if (!status) return null;

  const isTraining = jobState.phase === 'polling' || status.state === 'TRAINING';
  const displayState = isTraining ? 'TRAINING' : deriveClassifierDisplayState(status);
  const { reason, resolution } = reasonAndResolution(status, displayState);

  const summaryText =
    !isTraining && displayState === 'READY' && status.accuracy !== undefined
      ? `${msg.stateReadyLabel}(정확도 ${Math.round(status.accuracy * 100)}%${status.trainedAt ? `, ${formatDateTime(status.trainedAt)} 학습` : ''})`
      : CLASSIFIER_STATE_LABEL[isTraining ? 'TRAINING' : displayState];

  return (
    <div className="classifier-status-panel">
      <div className="classifier-status-panel-header">
        <button
          type="button"
          className="collapsible-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          <span aria-hidden="true">{expanded ? '▾' : '▸'}</span> {msg.panelTitleCollapsed(summaryText)}
        </button>
        {canWrite && (
          <button type="button" className="btn btn-secondary" onClick={() => void handleTrain()} disabled={isTraining}>
            {msg.trainButton}
          </button>
        )}
      </div>

      {isTraining && <AsyncJobProgress label={msg.training} />}
      {jobState.phase === 'timeout' && (
        <p className="field-hint" role="status">
          {msg.trainTimeout}
        </p>
      )}
      {insufficientData && (
        <p className="form-banner form-banner--info" role="status">
          {msg.insufficientData}
        </p>
      )}

      {expanded && !isTraining && (
        <div className="classifier-status-detail">
          <p>
            <ClassifierStatusBadge state={displayState} />{' '}
            {status.trainedAt && (
              <span className="field-hint">
                {msg.trainedAtLabel}: {formatDateTime(status.trainedAt)}
              </span>
            )}
          </p>
          {displayState === 'READY' && (
            <p className="field-hint">
              {msg.trainingDataLabel(status.classCount, status.sampleCount)} ·{' '}
              {status.accuracy !== undefined ? msg.accuracyLabel(Math.round(status.accuracy * 100), status.sampleCount) : msg.accuracyUnmeasured}
            </p>
          )}
          {reason && <p className="field-hint">원인: {reason}</p>}
          {resolution && <p className="field-hint">해결: {resolution}</p>}
          {(displayState === 'STALE' || displayState === 'UNAVAILABLE') && <p className="field-hint">{msg.fallbackLexicalNotice}</p>}
          <p className="field-hint">{msg.disclaimerNoDialogue}</p>
        </div>
      )}
    </div>
  );
}
