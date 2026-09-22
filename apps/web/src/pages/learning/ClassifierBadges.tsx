import type { IntentClassifierStatus, IntentSuggestion } from '@chat-bot/shared-types';
import { MESSAGES } from '../../constants/messages';

const msg = MESSAGES.classifier;

export type ClassifierDisplayState = 'NONE' | 'TRAINING' | 'READY' | 'STALE' | 'UNAVAILABLE';

/** 5상태 파생(§5.3) — `MODEL_CHANGED`/`FAILED`는 "사용 불가"로 합쳐진다. */
export function deriveClassifierDisplayState(status: IntentClassifierStatus): ClassifierDisplayState {
  if (status.staleReasons.includes('MODEL_CHANGED') || status.state === 'FAILED') return 'UNAVAILABLE';
  if (status.state === 'NONE') return 'NONE';
  if (status.state === 'TRAINING') return 'TRAINING';
  if (status.state === 'READY' && status.stale) return 'STALE';
  return 'READY';
}

const STATE_COLOR: Record<ClassifierDisplayState, { bg: string; fg: string; icon: string }> = {
  NONE: { bg: '#f3f4f6', fg: '#374151', icon: '○' },
  TRAINING: { bg: '#dbeafe', fg: '#1d4ed8', icon: '⏳' },
  READY: { bg: '#dcfce7', fg: '#166534', icon: '●' },
  STALE: { bg: '#fef3c7', fg: '#92400e', icon: '▲' },
  UNAVAILABLE: { bg: '#fee2e2', fg: '#991b1b', icon: '✕' },
};

export const CLASSIFIER_STATE_LABEL: Record<ClassifierDisplayState, string> = {
  NONE: msg.stateNoneLabel,
  TRAINING: msg.stateTrainingLabel,
  READY: msg.stateReadyLabel,
  STALE: msg.stateStaleLabel,
  UNAVAILABLE: msg.stateUnavailableLabel,
};

/** 5상태 배지 — 색상+아이콘+텍스트 3중 구분(UIUX §1). */
export function ClassifierStatusBadge({ state }: { state: ClassifierDisplayState }): JSX.Element {
  const c = STATE_COLOR[state];
  return (
    <span className="status-badge" style={{ backgroundColor: c.bg, color: c.fg }}>
      <span aria-hidden="true">{c.icon}</span> {CLASSIFIER_STATE_LABEL[state]}
    </span>
  );
}

/** 추천 의도 출처 배지(B3, §5.6) — `CLASSIFIER`(분류기 추천)/`LEXICAL`(문자 유사도). */
export function SuggestionSourceBadge({ source }: { source: IntentSuggestion['source'] }): JSX.Element | null {
  if (!source) return null;
  if (source === 'CLASSIFIER') {
    return (
      <span className="dialogue-badge suggestion-source-badge suggestion-source-badge--classifier">
        <span aria-hidden="true">✦</span> {msg.sourceClassifier}
      </span>
    );
  }
  return (
    <span className="dialogue-badge dialogue-badge--neutral suggestion-source-badge">
      <span aria-hidden="true">≈</span> {msg.sourceLexical}
    </span>
  );
}
