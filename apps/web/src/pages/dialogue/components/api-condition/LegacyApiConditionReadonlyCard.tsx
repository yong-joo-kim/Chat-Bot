import { useEffect, useRef } from 'react';
import type { ApiConditionOutputPayloadV1 } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../../constants/messages';
import { LegacyFormatBadge } from '../../../settings/api-connections/badges';

export interface LegacyApiConditionReadonlyCardProps {
  value: ApiConditionOutputPayloadV1;
  onConvert: () => void;
  /**
   * 값이 바뀔 때마다(매 저장 거부 시도마다) 이 카드로 스크롤·포커스를 옮기고 "연결로 전환" 버튼을
   * 강조한다(`API_OUTPUT_LEGACY_FORMAT`, ui-spec §3.3-5). `undefined`면 강조하지 않는다.
   */
  highlightToken?: number;
}

/**
 * D1a-v1 — 이전 형식 `API_CONDITION` 읽기 전용 표시(`legacy-api-integration-ui-spec.md` §3.3
 * `LegacyApiConditionReadonlyCard`). 모든 필드가 읽기 전용이다(편집 불가) — 서버가 이미 URL을
 * 호스트까지만·헤더 값은 전부 `[비공개]`로 가려 보내므로(`redactLegacyApiOutputs`) "표시/가리기"
 * 토글 자체가 없다(과거 v1 편집기의 토글은 폐기).
 */
export function LegacyApiConditionReadonlyCard({ value, onConvert, highlightToken }: LegacyApiConditionReadonlyCardProps): JSX.Element {
  const msg = MESSAGES.dialogue.outputFields;
  const headerCount = value.headers ? Object.keys(value.headers).length : 0;
  const cardRef = useRef<HTMLDivElement>(null);
  const convertButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (highlightToken === undefined) return;
    cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    convertButtonRef.current?.focus();
  }, [highlightToken]);

  return (
    <div ref={cardRef} className={`legacy-api-condition-card${highlightToken !== undefined ? ' legacy-api-condition-card--highlight' : ''}`}>
      <LegacyFormatBadge />
      <dl className="legacy-api-readonly-fields">
        <dt>{msg.legacyMethodReadonly}</dt>
        <dd>{value.method}</dd>
        <dt>{msg.legacyUrlReadonly}</dt>
        <dd>{value.url}</dd>
        <dt>{MESSAGES.dialogue.outputFields.apiHeaders}</dt>
        <dd>{msg.legacyHeadersCount(headerCount)}</dd>
        <dt>{MESSAGES.dialogue.outputFields.apiBody}</dt>
        <dd>{value.bodyTemplate !== undefined ? msg.legacyBodyHidden : '—'}</dd>
      </dl>
      <p className="field-label-static">{msg.legacyConditionsReadonly}</p>
      <ul>
        {value.conditions.map((c, i) => (
          <li key={i}>
            {c.path} {c.operator} {c.value ?? ''}
          </li>
        ))}
      </ul>
      <button ref={convertButtonRef} type="button" className="btn btn-primary" onClick={onConvert}>
        {msg.convertButton}
      </button>
    </div>
  );
}
