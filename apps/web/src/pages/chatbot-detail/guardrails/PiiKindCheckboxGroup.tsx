import { GUARDRAIL_PII_DEFAULT_KINDS, GUARDRAIL_PII_KIND_LABELS, type GuardrailPiiKind } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../constants/messages';

/** 체크박스 기본 순서는 가나다순이다(UIUX §6) — 계좌번호 → 이메일 → 전화번호 → 주민등록번호 → 카드번호. */
export const PII_KIND_DISPLAY_ORDER: GuardrailPiiKind[] = ['ACCOUNT', 'EMAIL', 'PHONE', 'RRN', 'CARD'];

export interface PiiKindCheckboxGroupProps {
  kinds: GuardrailPiiKind[];
  preserveDates: boolean;
  /** 거버넌스 모드에서 끌 수 없는 종류(체크됨 + `aria-disabled` + 이유 글자). */
  governanceFloor: GuardrailPiiKind[];
  readOnly?: boolean;
  onKindToggle: (kind: GuardrailPiiKind, checked: boolean) => void;
  onPreserveDatesChange: (value: boolean) => void;
}

/** GR-3 가릴 번호 종류 체크박스 5개(`ai-guardrails-ui-spec.md` §6.2). 기본 선택 종류는 정렬이 아니라 "기본" 글자 표식으로 알린다. */
export function PiiKindCheckboxGroup({ kinds, preserveDates, governanceFloor, readOnly = false, onKindToggle, onPreserveDatesChange }: PiiKindCheckboxGroupProps): JSX.Element {
  const msg = MESSAGES.guardrails.pii;

  if (readOnly) {
    return (
      <fieldset className="settings-fieldset guardrail-pii-group">
        <legend>{msg.legend}</legend>
        <ul className="guardrail-pii-readonly">
          {PII_KIND_DISPLAY_ORDER.map((k) => (
            <li key={k}>
              {GUARDRAIL_PII_KIND_LABELS[k]}: {kinds.includes(k) ? msg.readOnlyMasked : msg.readOnlyNotMasked}
            </li>
          ))}
        </ul>
      </fieldset>
    );
  }

  return (
    <fieldset className="settings-fieldset guardrail-pii-group">
      <legend>{msg.legend}</legend>
      {PII_KIND_DISPLAY_ORDER.map((kind) => {
        const checked = kinds.includes(kind);
        const floorLocked = governanceFloor.includes(kind);
        const hint = msg.hints[kind];
        const hintId = `gr-pii-${kind}-hint`;
        const lockId = `gr-pii-${kind}-lock`;
        const describedBy = [hint ? hintId : null, floorLocked ? lockId : null].filter(Boolean).join(' ') || undefined;
        const isDefault = GUARDRAIL_PII_DEFAULT_KINDS.includes(kind);
        return (
          <div key={kind} className="guardrail-pii-item">
            <label className="guardrail-pii-label">
              <input
                type="checkbox"
                id={`gr-pii-${kind}`}
                checked={checked || floorLocked}
                aria-disabled={floorLocked || undefined}
                aria-describedby={describedBy}
                onChange={(e) => {
                  if (floorLocked) return;
                  onKindToggle(kind, e.target.checked);
                }}
              />{' '}
              {floorLocked && <span aria-hidden="true">🔒 </span>}
              {GUARDRAIL_PII_KIND_LABELS[kind]}
              {isDefault && <span className="guardrail-default-badge"> {msg.defaultBadge}</span>}
            </label>
            {hint && (
              <p id={hintId} className="field-hint">
                <span aria-hidden="true">{kind === 'ACCOUNT' ? '⚠ ' : ''}</span>
                {hint}
              </p>
            )}
            {floorLocked && (
              <p id={lockId} className="field-hint">
                {msg.governanceLocked}
              </p>
            )}
            {kind === 'ACCOUNT' && (
              <label className="guardrail-pii-preserve">
                <input
                  type="checkbox"
                  id="gr-pii-preserve"
                  checked={preserveDates}
                  aria-disabled={!checked || undefined}
                  aria-describedby={!checked ? 'gr-pii-preserve-reason' : undefined}
                  onChange={(e) => {
                    // 값은 유지한다 — 계좌번호를 꺼도 날짜 보호 값은 그대로 두고 잠기기만 한다.
                    if (!checked) return;
                    onPreserveDatesChange(e.target.checked);
                  }}
                />{' '}
                {msg.preserveDates}
              </label>
            )}
            {kind === 'ACCOUNT' && !checked && (
              <p id="gr-pii-preserve-reason" className="field-hint">
                {msg.preserveDatesDisabled}
              </p>
            )}
          </div>
        );
      })}
    </fieldset>
  );
}
