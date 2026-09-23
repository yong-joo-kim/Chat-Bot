import { useState } from 'react';
import type { TestCaseSet } from '@chat-bot/shared-types';
import { Modal } from '../../../components/Modal';
import { Link } from 'react-router-dom';
import { MESSAGES } from '../../../constants/messages';

export interface AugmentationImpactSetPickerDialogProps {
  chatbotId: string;
  isOpen: boolean;
  sets: TestCaseSet[];
  suggestionCount: number;
  submitting: boolean;
  errorMessage?: string;
  onStart: (setId: string, useRag: boolean) => void;
  onClose: () => void;
}

/**
 * A1x — 영향도 검사 대상 TC 세트 선택 다이얼로그(ui-spec §4.6, FR-V3-3). 세트가 0개면
 * 대화검증으로 이동하는 대안 CTA를 보여준다(현재 탭 이동 — 증강 작업은 사라지지 않는다).
 */
export function AugmentationImpactSetPickerDialog({
  chatbotId,
  isOpen,
  sets,
  suggestionCount,
  submitting,
  errorMessage,
  onStart,
  onClose,
}: AugmentationImpactSetPickerDialogProps): JSX.Element {
  const msg = MESSAGES.validation.augmentationImpact;
  const [setId, setSetId] = useState(sets[0]?.id ?? '');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [useRag, setUseRag] = useState(false);

  return (
    <Modal isOpen={isOpen} title={msg.dialogTitle} onClose={onClose} closeOnEsc={!submitting}>
      {sets.length === 0 ? (
        <>
          <p className="field-error" role="alert">
            {msg.noSetsTitle}
          </p>
          <Link to={`/chatbots/${chatbotId}/validation/sets`} className="btn btn-primary">
            {msg.goToValidation}
          </Link>
        </>
      ) : (
        <>
          <p>{msg.dialogDesc(suggestionCount)}</p>
          <div className="form-field">
            <label htmlFor="impact-set-select">{msg.setSelectLabel}</label>
            <select id="impact-set-select" value={setId} onChange={(e) => setSetId(e.target.value)}>
              {sets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <button type="button" className="collapsible-toggle" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen((v) => !v)}>
            <span aria-hidden="true">{advancedOpen ? '▾' : '▸'}</span> {msg.advancedToggle}
          </button>
          {advancedOpen && (
            <label className="form-field--inline">
              <input type="checkbox" checked={useRag} onChange={(e) => setUseRag(e.target.checked)} />
              {msg.ragCheckboxLabel}
            </label>
          )}
          {errorMessage && (
            <p className="field-error" role="alert">
              {errorMessage}
            </p>
          )}
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
              {msg.cancelButton}
            </button>
            <button type="button" className="btn btn-primary" onClick={() => onStart(setId, useRag)} disabled={submitting || !setId}>
              {msg.startButton}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
