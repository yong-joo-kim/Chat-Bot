import { useEffect, useState } from 'react';
import type { CustomerSearchItem } from '@chat-bot/shared-types';
import { Modal } from '../Modal';
import { SkeletonRow } from '../Skeleton';
import { EmptyState } from '../EmptyState';
import { InlineFieldError } from '../InlineFieldError';
import { MESSAGES } from '../../constants/messages';
import { inboxApi } from '../../api/inbox';
import { ApiError } from '../../api/client';
import { CustomerKindBadge } from './badges';

export type CustomerSearchMode = 'link' | 'merge';

/**
 * OI-5 고객 검색·연결(`omnichannel-inbox-ui-spec.md` §3.5 `CustomerSearchModal`). `mode==='link'`이면
 * 결과 행에 "연결" 버튼, `mode==='merge'`면 "병합 대상으로 선택" 버튼을 렌더한다.
 */
export function CustomerSearchModal({
  isOpen,
  mode,
  identitySpaces,
  onClose,
  onPick,
}: {
  isOpen: boolean;
  mode: CustomerSearchMode;
  identitySpaces: string[];
  onClose: () => void;
  onPick: (item: CustomerSearchItem) => void;
}): JSX.Element {
  const msg = MESSAGES.inbox;
  const [tab, setTab] = useState<'name' | 'memberId'>('name');
  const [q, setQ] = useState('');
  const [memberId, setMemberId] = useState('');
  const [memberIdVisible, setMemberIdVisible] = useState(false);
  const [space, setSpace] = useState(identitySpaces[0] ?? '');
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [items, setItems] = useState<CustomerSearchItem[]>([]);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!isOpen) {
      setQ('');
      setMemberId('');
      setItems([]);
      setSearched(false);
      setError(undefined);
      setTab('name');
    }
  }, [isOpen]);

  async function handleSearch(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setLoading(true);
    setError(undefined);
    try {
      const dto = tab === 'name' ? { q: q || undefined } : { memberId, identitySpaceRef: space || undefined };
      const res = await inboxApi.searchCustomers(dto);
      setItems(res.items);
      setSearched(true);
    } catch (e2) {
      setError(e2 instanceof ApiError ? e2.message : MESSAGES.errors.generic);
    } finally {
      setLoading(false);
    }
  }

  const memberIdSecretMissing = tab === 'memberId' && identitySpaces.length === 0;

  return (
    <Modal isOpen={isOpen} title={mode === 'merge' ? msg.mergeSearchModalTitle : msg.searchModalTitle} onClose={onClose}>
      <div className="sub-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'name'} className={`sub-tab-button${tab === 'name' ? ' sub-tab-button--active' : ''}`} onClick={() => setTab('name')}>
          {msg.searchTabName}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'memberId'} className={`sub-tab-button${tab === 'memberId' ? ' sub-tab-button--active' : ''}`} onClick={() => setTab('memberId')}>
          {msg.searchTabMemberId}
        </button>
      </div>

      <form onSubmit={(e) => void handleSearch(e)}>
        {tab === 'name' ? (
          <div className="form-field">
            <label htmlFor="customer-search-q">{msg.searchPlaceholder}</label>
            <input id="customer-search-q" type="text" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        ) : memberIdSecretMissing ? (
          <p className="field-hint">{msg.memberIdSecretMissing}</p>
        ) : (
          <>
            <div className="form-field">
              <label htmlFor="customer-search-space">{msg.memberIdSpaceLabel}</label>
              <select id="customer-search-space" value={space} onChange={(e) => setSpace(e.target.value)}>
                {identitySpaces.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="customer-search-member-id">{msg.memberIdInputLabel}</label>
              <input
                id="customer-search-member-id"
                type={memberIdVisible ? 'text' : 'password'}
                value={memberId}
                onChange={(e) => setMemberId(e.target.value)}
              />
              <button type="button" className="btn btn-secondary" onClick={() => setMemberIdVisible((v) => !v)}>
                {msg.memberIdRevealToggle}
              </button>
              <p className="field-hint">{msg.memberIdNotStoredHint}</p>
            </div>
          </>
        )}
        <button type="submit" className="btn btn-primary" disabled={loading || memberIdSecretMissing}>
          {msg.searchButton}
        </button>
      </form>

      <InlineFieldError id="customer-search-error" message={error} />

      {loading && (
        <>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </>
      )}
      {!loading && !searched && <EmptyState title={msg.searchEmptyPrompt} />}
      {!loading && searched && items.length === 0 && <EmptyState title={msg.searchEmptyResult} />}
      {!loading && items.length > 0 && (
        <ul className="settings-card-list">
          {items.map((item) => (
            <li key={item.customerId} className="settings-card">
              <bdi>{item.displayName ?? item.alias}</bdi> <CustomerKindBadge kind={item.kind} /> · {msg.cardConversations(item.linkedConversationCount)}
              <button type="button" className="btn btn-primary" onClick={() => onPick(item)}>
                {mode === 'merge' ? msg.mergeSelectButton : msg.linkButton}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          {msg.cancel}
        </button>
      </div>
    </Modal>
  );
}
