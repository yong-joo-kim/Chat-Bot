import { useEffect, useState, type MutableRefObject } from 'react';
import { Link } from 'react-router-dom';
import type { SurveyOutputPayloadV2 } from '@chat-bot/shared-types';
import { ResourcePickerField } from '../../../../components/ResourcePickerField';
import { MESSAGES } from '../../../../constants/messages';
import { surveysApi } from '../../../../api/surveys';
import { computeSurveyDisplayStatus, surveyDisplayStatusLabel } from '../../../../lib/surveyDisplay';
import { SurveyPickerField } from './SurveyPickerField';

export interface SurveyOutputEditorV2Props {
  value: SurveyOutputPayloadV2;
  onChange: (value: SurveyOutputPayloadV2) => void;
  chatbotId: string;
  errPrefix: string;
  fieldErrors: Record<string, string>;
  firstFieldRef: MutableRefObject<HTMLElement | null>;
}

/**
 * D1a-v2(SV) — 설문 아웃풋 v2 폼(`survey-management-ui-spec.md` §3.3 `SurveyOutputEditorV2`).
 * 이 챗봇의 설문 하나를 선택해 대화 노드에 연결하고, 완료 후 이어질 노드를 지정한다.
 */
export function SurveyOutputEditorV2({ value, onChange, chatbotId, errPrefix, fieldErrors, firstFieldRef }: SurveyOutputEditorV2Props): JSX.Element {
  const msg = MESSAGES.dialogue.outputFields;
  const [notAvailableLabel, setNotAvailableLabel] = useState<string | null>(null);
  const err = (suffix: string): string | undefined => fieldErrors[`${errPrefix}.${suffix}`];

  useEffect(() => {
    if (!value.surveyId) {
      setNotAvailableLabel(null);
      return;
    }
    let cancelled = false;
    surveysApi
      .findOne(chatbotId, value.surveyId)
      .then((s) => {
        if (cancelled) return;
        const displayStatus = computeSurveyDisplayStatus(s);
        setNotAvailableLabel(displayStatus === 'ACTIVE' ? null : surveyDisplayStatusLabel(displayStatus));
      })
      .catch(() => setNotAvailableLabel(null));
    return () => {
      cancelled = true;
    };
  }, [chatbotId, value.surveyId]);

  return (
    <div className="survey-output-editor-v2">
      <SurveyPickerField
        ref={firstFieldRef as never}
        id="survey-output-survey"
        label={msg.surveyPickerLabel}
        chatbotId={chatbotId}
        value={value.surveyId || null}
        onChange={(v) => onChange({ ...value, surveyId: v ?? '' })}
        required
        errorMessage={err('surveyId')}
      />
      {notAvailableLabel && <p className="field-hint field-hint--warning">{msg.surveyNotAvailableHint(notAvailableLabel)}</p>}

      <ResourcePickerField
        id="survey-output-oncomplete-node"
        label={msg.surveyOnCompleteNodeLabel}
        resourceType="node"
        chatbotId={chatbotId}
        multiple={false}
        value={value.onCompleteNodeId ?? null}
        onChange={(v) => onChange({ ...value, onCompleteNodeId: (v as string) || undefined })}
        helpText={msg.surveyOnCompleteNodeHelp}
        errorMessage={err('onCompleteNodeId')}
      />

      {value.surveyId && (
        <Link to={`/chatbots/${chatbotId}/dialogue/surveys/${value.surveyId}`} className="link-button">
          {msg.surveyEditLink}
        </Link>
      )}

      <p className="field-hint">{msg.surveyOutputTerminalHint}</p>
    </div>
  );
}
