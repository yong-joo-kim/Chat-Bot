import { useEffect, useState } from 'react';
import type { ChatbotListItem, WorkflowEventType, WorkflowRunStatus, WorkflowTargetPickerItem, WorkflowTriggerKind } from '@chat-bot/shared-types';
import { DateRangeField } from '../../../components/DateRangeField';
import { workflowTargetsApi } from '../../../api/workflowTargets';
import { chatbotsApi } from '../../../api/chatbots';
import { MESSAGES } from '../../../constants/messages';

export interface WorkflowRunFilterBarProps {
  targetId: string;
  onTargetIdChange: (v: string) => void;
  /** 전역 화면(WF1-b)에서만 렌더한다 — 챗봇 스코프 화면(WF3-b)은 이미 챗봇이 고정이라 생략한다. */
  chatbotId?: string;
  onChatbotIdChange?: (v: string) => void;
  triggerKind: WorkflowTriggerKind[];
  onTriggerKindChange: (v: WorkflowTriggerKind[]) => void;
  eventType: WorkflowEventType[];
  onEventTypeChange: (v: WorkflowEventType[]) => void;
  status: WorkflowRunStatus[];
  onStatusChange: (v: WorkflowRunStatus[]) => void;
  from: string;
  to: string;
  onDateChange: (from: string, to: string) => void;
  retryableOnly: boolean;
  onRetryableOnlyChange: (v: boolean) => void;
  rangeError?: string;
}

const TRIGGER_KINDS: WorkflowTriggerKind[] = ['NODE', 'EVENT', 'TEST'];
const EVENT_TYPES: WorkflowEventType[] = ['NODE_ACTION', 'HANDOFF_STARTED', 'HANDOFF_ENDED', 'SURVEY_COMPLETED', 'FEEDBACK_NEGATIVE', 'UNANSWERED_STREAK', 'TEST'];
const STATUSES: WorkflowRunStatus[] = ['PENDING', 'HELD', 'SENDING', 'SUCCEEDED', 'FAILED', 'SKIPPED', 'CANCELLED', 'EXPIRED'];

/** 실행 이력 공용 필터바(§3.2·§3.2b `WorkflowRunFilterBar`) — 전역/챗봇 스코프가 공유한다(§13-4 확정). */
export function WorkflowRunFilterBar({
  targetId,
  onTargetIdChange,
  chatbotId,
  onChatbotIdChange,
  triggerKind,
  onTriggerKindChange,
  eventType,
  onEventTypeChange,
  status,
  onStatusChange,
  from,
  to,
  onDateChange,
  retryableOnly,
  onRetryableOnlyChange,
  rangeError,
}: WorkflowRunFilterBarProps): JSX.Element {
  const msg = MESSAGES.workflowRuns;
  const [targets, setTargets] = useState<WorkflowTargetPickerItem[]>([]);
  const [chatbots, setChatbots] = useState<ChatbotListItem[]>([]);

  useEffect(() => {
    workflowTargetsApi
      .picker()
      .then((res) => setTargets(res.items))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (onChatbotIdChange === undefined) return;
    chatbotsApi
      .list({ page: 1, pageSize: 100 })
      .then((res) => setChatbots(res.items))
      .catch(() => undefined);
  }, [onChatbotIdChange]);

  function toggle<T>(list: T[], value: T, onChange: (next: T[]) => void): void {
    onChange(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  return (
    <div className="dialogue-filter-bar">
      <div className="form-field">
        <label htmlFor="workflow-run-filter-target">{msg.filterTargetLabel}</label>
        <select id="workflow-run-filter-target" value={targetId} onChange={(e) => onTargetIdChange(e.target.value)}>
          <option value="">{msg.filterTargetAll}</option>
          {targets.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      {onChatbotIdChange && (
        <div className="form-field">
          <label htmlFor="workflow-run-filter-chatbot">{msg.filterChatbotLabel}</label>
          <select id="workflow-run-filter-chatbot" value={chatbotId ?? ''} onChange={(e) => onChatbotIdChange(e.target.value)}>
            <option value="">{msg.filterChatbotAll}</option>
            {chatbots.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <fieldset className="form-field">
        <legend>{msg.filterTriggerLabel}</legend>
        {TRIGGER_KINDS.map((k) => (
          <label key={k} className="form-field--inline">
            <input type="checkbox" checked={triggerKind.length === 0 || triggerKind.includes(k)} onChange={() => toggle(triggerKind, k, onTriggerKindChange)} />
            {k}
          </label>
        ))}
      </fieldset>
      <fieldset className="form-field">
        <legend>{msg.filterEventLabel}</legend>
        {EVENT_TYPES.map((e) => (
          <label key={e} className="form-field--inline">
            <input type="checkbox" checked={eventType.length === 0 || eventType.includes(e)} onChange={() => toggle(eventType, e, onEventTypeChange)} />
            {msg.eventTypeLabel[e]}
          </label>
        ))}
      </fieldset>
      <fieldset className="form-field">
        <legend>{msg.filterStatusLabel}</legend>
        {STATUSES.map((s) => (
          <label key={s} className="form-field--inline">
            <input type="checkbox" checked={status.length === 0 || status.includes(s)} onChange={() => toggle(status, s, onStatusChange)} />
            {msg.statusLabel[s]}
          </label>
        ))}
      </fieldset>
      <DateRangeField from={from} to={to} onChange={onDateChange} maxRangeDays={90} errorMessage={rangeError} />
      <label className="form-field--inline">
        <input type="checkbox" checked={retryableOnly} onChange={(e) => onRetryableOnlyChange(e.target.checked)} />
        {msg.filterRetryableOnly}
      </label>
    </div>
  );
}
