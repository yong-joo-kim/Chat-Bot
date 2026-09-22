import { useEffect, useState } from 'react';
import { AuditAction, AuditTargetType, AUDIT_ACTION_LABELS, AUDIT_TARGET_LABELS, type User } from '@chat-bot/shared-types';
import { DateRangeField } from '../../../components/DateRangeField';
import { MultiSelectDropdown } from '../../../components/MultiSelectDropdown';
import { ResourcePickerField } from '../../../components/ResourcePickerField';
import { useDebouncedValue } from '../../../lib/useDebouncedValue';
import { MESSAGES } from '../../../constants/messages';

export interface AuditLogFilterBarProps {
  from: string;
  to: string;
  actorId: string;
  action: AuditAction[];
  targetType: AuditTargetType[];
  chatbotId: string;
  q: string;
  actors: User[];
  rangeError?: string;
  onFromToChange: (from: string, to: string) => void;
  onActorChange: (actorId: string) => void;
  onActionChange: (action: AuditAction[]) => void;
  onTargetTypeChange: (targetType: AuditTargetType[]) => void;
  onChatbotIdChange: (chatbotId: string | null) => void;
  onQChange: (q: string) => void;
}

/** A1 필터바(security-audit-ui-spec.md §3.9). */
export function AuditLogFilterBar({
  from,
  to,
  actorId,
  action,
  targetType,
  chatbotId,
  q,
  actors,
  rangeError,
  onFromToChange,
  onActorChange,
  onActionChange,
  onTargetTypeChange,
  onChatbotIdChange,
  onQChange,
}: AuditLogFilterBarProps): JSX.Element {
  const [localQ, setLocalQ] = useState(q);
  const debouncedQ = useDebouncedValue(localQ, 300);

  useEffect(() => {
    if (debouncedQ !== q) onQChange(debouncedQ);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ]);

  const actionOptions = AuditAction.options.map((a) => ({ value: a, label: AUDIT_ACTION_LABELS[a] }));
  const targetTypeOptions = AuditTargetType.options.map((t) => ({ value: t, label: AUDIT_TARGET_LABELS[t] }));

  return (
    <div className="audit-log-filter-bar">
      <DateRangeField from={from} to={to} onChange={onFromToChange} maxRangeDays={90} errorMessage={rangeError} />
      <div className="form-field form-field--inline">
        <label htmlFor="audit-actor-filter">{MESSAGES.auditLogs.actorFilterLabel}</label>
        <select id="audit-actor-filter" value={actorId} onChange={(e) => onActorChange(e.target.value)}>
          <option value="">{MESSAGES.auditLogs.actorFilterAll}</option>
          {actors.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>
      <MultiSelectDropdown label={MESSAGES.auditLogs.actionFilterLabel} options={actionOptions} selected={action} onChange={onActionChange} />
      <MultiSelectDropdown
        label={MESSAGES.auditLogs.targetTypeFilterLabel}
        options={targetTypeOptions}
        selected={targetType}
        onChange={onTargetTypeChange}
      />
      {/* Medium #4(PM 승인): 딥링크 칩 외에 챗봇을 직접 검색/선택하는 수동 선택기(§3.9). */}
      <ResourcePickerField
        id="audit-chatbot-filter"
        label={MESSAGES.auditLogs.chatbotFilterLabel}
        resourceType="chatbot"
        multiple={false}
        value={chatbotId || null}
        onChange={(v) => onChatbotIdChange((v as string | null) || null)}
      />
      <div className="form-field form-field--inline">
        <label htmlFor="audit-q-filter">{MESSAGES.auditLogs.searchLabel}</label>
        <input
          id="audit-q-filter"
          type="search"
          value={localQ}
          placeholder={MESSAGES.auditLogs.searchPlaceholder}
          onChange={(e) => setLocalQ(e.target.value)}
        />
      </div>
    </div>
  );
}
