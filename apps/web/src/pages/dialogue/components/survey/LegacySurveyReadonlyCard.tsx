import { useEffect, useRef } from 'react';
import type { SurveyOutputPayloadV1 } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../../constants/messages';
import { LegacySurveyBadge } from './badges';

export interface LegacySurveyReadonlyCardProps {
  value: SurveyOutputPayloadV1;
  onConvert: () => void;
  /** `SURVEY_OUTPUT_LEGACY_FORMAT` 저장 거부 시마다 카드로 스크롤·포커스+강조한다(No.26 패턴 재사용). */
  highlightToken?: number;
}

/**
 * D1a-v1(SV) — 이전 형식(v1) `SURVEY` 읽기 전용 표시(`survey-management-ui-spec.md` §3.4
 * `LegacySurveyReadonlyCard`). 자동 연결·자동 변환은 없다(P-15) — 모든 필드가 읽기 전용이다.
 */
export function LegacySurveyReadonlyCard({ value, onConvert, highlightToken }: LegacySurveyReadonlyCardProps): JSX.Element {
  const msg = MESSAGES.dialogue.outputFields;
  const cardRef = useRef<HTMLDivElement>(null);
  const convertButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (highlightToken === undefined) return;
    cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    convertButtonRef.current?.focus();
  }, [highlightToken]);

  return (
    <div ref={cardRef} className={`legacy-api-condition-card${highlightToken !== undefined ? ' legacy-api-condition-card--highlight' : ''}`}>
      <LegacySurveyBadge />
      <dl className="legacy-api-readonly-fields">
        <dt>{msg.legacySurveyIdReadonly}</dt>
        <dd>{value.surveyId}</dd>
      </dl>
      <button ref={convertButtonRef} type="button" className="btn btn-primary" onClick={onConvert}>
        {msg.convertSurveyButton}
      </button>
    </div>
  );
}
