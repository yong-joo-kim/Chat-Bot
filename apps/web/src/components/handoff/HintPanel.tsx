import { useCallback, useEffect, useRef, useState } from 'react';
import type { CannedResponse, HintAnswerItem, HintCannedItem, HintResponse } from '@chat-bot/shared-types';
import { handoffApi } from '../../api/handoff';
import { cannedResponsesApi } from '../../api/cannedResponses';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { useToast } from '../Toast';
import { MESSAGES } from '../../constants/messages';
import { LexicalFallbackBadge } from './badges';

/**
 * HC2 응답힌트 패널(hybrid-cs-ui-spec.md §2.2·§3.3). ★ 2초 대화 폴링을 따르지 않고, 마지막 사용자
 * 발화의 `source.key`(부모가 넘기는 `lastUserKey`)가 바뀔 때만 `GET .../hints`를 재요청한다(AC-CS5-5).
 */
export function HintPanel({
  chatbotId,
  sessionRef,
  lastUserKey,
  canFillComposer,
  onFill,
}: {
  chatbotId: string;
  sessionRef: string;
  lastUserKey: string | null;
  canFillComposer: boolean;
  onFill: (text: string) => void;
}): JSX.Element {
  const { showToast } = useToast();
  const msg = MESSAGES.handoffConsole;
  const [hint, setHint] = useState<HintResponse | null>(null);
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 300);
  const [searchResults, setSearchResults] = useState<CannedResponse[] | null>(null);
  const fetchedKeyRef = useRef<string | null | undefined>(undefined);

  const loadHints = useCallback(async () => {
    try {
      const res = await handoffApi.hints(chatbotId, sessionRef);
      setHint(res);
    } catch {
      // 힌트 조회 실패는 개입/전송을 막지 않는다 — 조용히 무시하고 다음 발화 변화에서 재시도.
    }
  }, [chatbotId, sessionRef]);

  useEffect(() => {
    // AC-CS5-5: `lastUserKey`가 실제로 바뀐 경우에만 재요청한다(2초 폴링 틱마다 재요청하지 않음).
    if (fetchedKeyRef.current === lastUserKey) return;
    fetchedKeyRef.current = lastUserKey;
    if (lastUserKey === null) return;
    void loadHints();
  }, [lastUserKey, loadHints]);

  useEffect(() => {
    if (!debouncedQuery) {
      setSearchResults(null);
      return;
    }
    let cancelled = false;
    cannedResponsesApi
      .search(chatbotId, { q: debouncedQuery })
      .then((res) => {
        if (!cancelled) setSearchResults(res.items);
      })
      .catch(() => {
        if (!cancelled) setSearchResults([]);
      });
    return () => {
      cancelled = true;
    };
  }, [chatbotId, debouncedQuery]);

  async function handleCopy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      showToast(MESSAGES.common.copied);
    } catch {
      showToast(MESSAGES.common.copyFallback);
    }
  }

  const fillDisabledReason = canFillComposer ? undefined : msg.hintFillDisabledReason;

  return (
    <div className="hint-panel">
      <h3>{msg.hintTitle}</h3>

      <section>
        <h4>{msg.hintAnswersTitle}</h4>
        {hint?.mode === 'LEXICAL' && <LexicalFallbackBadge />}
        {!hint || hint.answers.length === 0 ? (
          <p className="field-hint">{msg.hintEmpty}</p>
        ) : (
          <ul className="hint-answer-list">
            {hint.answers.map((item: HintAnswerItem, i) => (
              <li key={`${item.kind}-${item.refName}-${i}`} className="hint-card">
                <p>{item.text}</p>
                <div className="hint-card-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => void handleCopy(item.text)}>
                    {msg.hintCopyButton}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={!canFillComposer}
                    title={fillDisabledReason}
                    onClick={() => onFill(item.text)}
                  >
                    {msg.hintFillButton}
                  </button>
                  {!canFillComposer && <span className="field-hint">{fillDisabledReason}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h4>{msg.hintCannedTitle}</h4>
        <label className="form-field--inline">
          {msg.hintSearchLabel}
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        {(() => {
          const cannedItems = searchResults ?? hint?.canned ?? [];
          // 코드 리뷰 1회차(axe M2)에서 발견: <ul>의 직계 자식은 <li>만 허용된다(list 규칙 위반).
          // 빈 상태 문구는 목록 밖에 별도로 그린다.
          if (cannedItems.length === 0) return <p className="field-hint">{msg.hintEmpty}</p>;
          return (
            <ul className="hint-canned-list">
              {cannedItems.map((item: HintCannedItem | CannedResponse) => (
                <li key={item.id} className="hint-card">
                  <p>{item.title}</p>
                  <p className="field-hint">{item.body}</p>
                  <div className="hint-card-actions">
                    <button type="button" className="btn btn-secondary" onClick={() => void handleCopy(item.body)}>
                      {msg.hintCopyButton}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={!canFillComposer}
                      title={fillDisabledReason}
                      onClick={() => onFill(item.body)}
                    >
                      {msg.hintFillButton}
                    </button>
                    {/* Low(코드 리뷰 2회차 후속): "가까운 답변" 목록과 같은 원칙 — 비활성 사유를
                        `title` 속성에만 묻어 두지 않고 화면에도 보이는 텍스트로 병기한다(UIUX §7). */}
                    {!canFillComposer && <span className="field-hint">{fillDisabledReason}</span>}
                  </div>
                </li>
              ))}
            </ul>
          );
        })()}
      </section>
    </div>
  );
}
