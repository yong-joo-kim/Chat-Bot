import { useState } from 'react';
import type { TestRunComparisonRow } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../../constants/messages';

/** M1 전용 — 한쪽에만 있는 TC 별도 섹션(ui-spec §4.5). 통과 수 변화 델타에 포함하지 않는다. */
export function OnlyInOneSection({ items }: { items: TestRunComparisonRow[] }): JSX.Element | null {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  const msg = MESSAGES.validation.compare;
  return (
    <div className="only-in-one-section">
      <button type="button" className="collapsible-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span aria-hidden="true">{open ? '▾' : '▸'}</span> {msg.onlyInOneSectionTitle(items.length)}
      </button>
      {open && (
        <>
          <p className="field-hint">{msg.onlyInOneNotice}</p>
          <ul>
            {items.map((item) => (
              <li key={item.caseId}>{item.questionText ?? item.caseId}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
