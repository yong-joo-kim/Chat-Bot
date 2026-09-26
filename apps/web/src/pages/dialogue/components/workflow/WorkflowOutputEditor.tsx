import { useEffect, useState, type MutableRefObject } from 'react';
import type { WorkflowOutputPayloadV1, WorkflowTargetPickerItem } from '@chat-bot/shared-types';
import { InlineFieldError } from '../../../../components/InlineFieldError';
import { WorkflowTargetPickerField } from '../../../../components/WorkflowTargetPickerField';
import { workflowTargetsApi } from '../../../../api/workflowTargets';
import { contextsApi } from '../../../../api/dialogue';
import { MESSAGES } from '../../../../constants/messages';
import type { SlotOption } from '../api-condition/BindingValueEditor';
import { WorkflowFieldListEditor } from './WorkflowFieldListEditor';

export interface WorkflowOutputEditorProps {
  value: WorkflowOutputPayloadV1;
  onChange: (value: WorkflowOutputPayloadV1) => void;
  chatbotId: string;
  nodeContextVariableId: string | null;
  errPrefix: string;
  fieldErrors: Record<string, string>;
  firstFieldRef: MutableRefObject<HTMLElement | null>;
}

/**
 * D1b — "업무 요청 보내기" 아웃풋 폼(`workflow-automation-ui-spec.md` §3.4). 대상 선택 + 동작 키 +
 * 필드(최대 3개, `WORKFLOW_OUTPUT_LIMITS.perNode`) 바인딩. 대상이 원문 개인정보 전송을 허용하면
 * 안내를 덧붙인다(`RawPersonalDataBadge`와 같은 취지 — 텍스트 안내로 대체, ui-spec §3.4).
 */
export function WorkflowOutputEditor({
  value,
  onChange,
  chatbotId,
  nodeContextVariableId,
  errPrefix,
  fieldErrors,
  firstFieldRef,
}: WorkflowOutputEditorProps): JSX.Element {
  const msg = MESSAGES.dialogue.outputFields;
  const [slotOptions, setSlotOptions] = useState<SlotOption[]>([]);
  const [targetInfo, setTargetInfo] = useState<WorkflowTargetPickerItem | null>(null);

  useEffect(() => {
    if (!nodeContextVariableId) {
      setSlotOptions([]);
      return;
    }
    let cancelled = false;
    contextsApi
      .findOne(chatbotId, nodeContextVariableId)
      .then((ctx) => {
        if (cancelled) return;
        setSlotOptions(ctx.slots.map((s) => ({ contextVariableId: ctx.id, slotName: s.name, label: `${ctx.name} › ${s.label}` })));
      })
      .catch(() => setSlotOptions([]));
    return () => {
      cancelled = true;
    };
  }, [chatbotId, nodeContextVariableId]);

  useEffect(() => {
    if (!value.targetId) {
      setTargetInfo(null);
      return;
    }
    let cancelled = false;
    workflowTargetsApi
      .picker()
      .then((res) => {
        if (cancelled) return;
        setTargetInfo(res.items.find((t) => t.id === value.targetId) ?? null);
      })
      .catch(() => setTargetInfo(null));
    return () => {
      cancelled = true;
    };
  }, [value.targetId]);

  const err = (suffix: string): string | undefined => fieldErrors[`${errPrefix}.${suffix}`];

  return (
    <div className="workflow-output-editor">
      <p className="form-banner form-banner--info">
        <span aria-hidden="true">ⓘ</span> {msg.workflowInvisibleHint}
      </p>

      <WorkflowTargetPickerField
        ref={firstFieldRef as never}
        id="workflow-output-target"
        label={msg.workflowTargetLabel}
        value={value.targetId || null}
        onChange={(v) => onChange({ ...value, targetId: v ?? '' })}
        required
        errorMessage={err('targetId')}
      />

      <div className="form-field">
        <label htmlFor="workflow-output-action-key">
          {msg.workflowActionKeyLabel} <span className="required-mark" aria-hidden="true">*</span>
        </label>
        <input
          id="workflow-output-action-key"
          type="text"
          maxLength={60}
          value={value.actionKey}
          onChange={(e) => onChange({ ...value, actionKey: e.target.value })}
          aria-invalid={Boolean(err('actionKey'))}
        />
        <p className="field-hint">{msg.workflowActionKeyHint}</p>
        <InlineFieldError id="workflow-output-action-key-error" message={err('actionKey') ?? undefined} />
      </div>

      <WorkflowFieldListEditor
        items={value.fields}
        onChange={(fields) => onChange({ ...value, fields })}
        slotOptions={slotOptions}
        maxItems={20}
        fieldErrors={fieldErrors}
        errPrefix={`${errPrefix}.fields`}
      />

      {targetInfo?.allowRawPersonalData && (
        <p className="form-banner form-banner--warning">
          <span aria-hidden="true">⚠</span> {msg.workflowRawPersonalDataNotice}
        </p>
      )}
    </div>
  );
}
