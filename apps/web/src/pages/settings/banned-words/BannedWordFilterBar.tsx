import { useEffect, useState } from 'react';
import { BannedWordPolicy, type BannedWordPolicy as BannedWordPolicyType } from '@chat-bot/shared-types';
import { useDebouncedValue } from '../../../lib/useDebouncedValue';
import { MESSAGES } from '../../../constants/messages';

export interface BannedWordFilterBarProps {
  q: string;
  policy: BannedWordPolicyType[];
  onQChange: (q: string) => void;
  onPolicyChange: (policy: BannedWordPolicyType[]) => void;
}

/**
 * B1 필터바(security-audit-ui-spec.md §3.8). `BannedWordListQuerySchema`가 `matchType` 필터를
 * 제공하지 않아(서버 계약, `security-audit-설계.md` §4.1) 일치방식 필터는 이번 범위에서 제외한다.
 */
export function BannedWordFilterBar({ q, policy, onQChange, onPolicyChange }: BannedWordFilterBarProps): JSX.Element {
  const [localQ, setLocalQ] = useState(q);
  const debouncedQ = useDebouncedValue(localQ, 300);

  useEffect(() => {
    if (debouncedQ !== q) onQChange(debouncedQ);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ]);

  function togglePolicy(value: BannedWordPolicyType): void {
    if (policy.includes(value)) onPolicyChange(policy.filter((p) => p !== value));
    else onPolicyChange([...policy, value]);
  }

  return (
    <div className="chatbot-filter-bar">
      <div className="form-field form-field--inline">
        <label htmlFor="banned-word-search">{MESSAGES.bannedWords.searchLabel}</label>
        <input
          id="banned-word-search"
          type="search"
          value={localQ}
          placeholder={MESSAGES.bannedWords.searchPlaceholder}
          onChange={(e) => setLocalQ(e.target.value)}
        />
      </div>
      <fieldset className="status-filter">
        <legend>{MESSAGES.bannedWords.policyFilterLabel}</legend>
        {BannedWordPolicy.options.map((p) => (
          <label key={p} className="status-filter-option">
            <input type="checkbox" checked={policy.includes(p)} onChange={() => togglePolicy(p)} />
            {p === 'BLOCK' ? MESSAGES.bannedWords.policyBlock : MESSAGES.bannedWords.policyWarn}
          </label>
        ))}
      </fieldset>
    </div>
  );
}
