import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { UTTERANCE_ANALYSIS_LIMITS, type UtteranceCluster } from '@chat-bot/shared-types';
import { ApiError } from '../../../api/client';
import { utteranceAnalysesApi } from '../../../api/utteranceAnalyses';
import { MESSAGES } from '../../../constants/messages';

/** 발화가 많은 순(서버가 부여한 번호 순)으로 두고 미분류는 항상 맨 끝에 둔다. */
export function sortClusters(clusters: UtteranceCluster[]): UtteranceCluster[] {
  return [...clusters].sort((a, b) => {
    if (a.unassigned !== b.unassigned) return a.unassigned ? 1 : -1;
    return a.ordinal - b.ordinal;
  });
}

export function clusterNumberLabel(c: Pick<UtteranceCluster, 'unassigned' | 'ordinal'>): string {
  return c.unassigned ? MESSAGES.utteranceAnalysis.unassignedLabel : String(c.ordinal);
}

export interface ClusterTableProps {
  chatbotId: string;
  analysisId: string;
  clusters: UtteranceCluster[];
  /** 이름 바꾸기·"이 이름 사용"을 그릴지(쓰기 권한 ∧ 보관 아님). */
  canWrite: boolean;
  /** 대조가 끝난 분석만 학습 후보 비율을 보인다. */
  probeDone: boolean;
  /** 이름 제안 기능이 꺼진 분석(`nameSuggest.status=OFF`)은 AI 제안 UI를 전혀 그리지 않는다(AC-DC6-1). */
  showAiSuggestions: boolean;
  onRenamed: (updated: UtteranceCluster) => void;
  onShowUtterances: (clusterId: string) => void;
}

/** 서버 오류 → 이름 입력 아래 문구. */
function renameErrorText(e: unknown): string {
  const msg = MESSAGES.utteranceAnalysis;
  if (e instanceof ApiError) {
    if (e.code === 'BANNED_WORD_BLOCKED') return msg.errors.BANNED_WORD_BLOCKED;
    if (e.code === 'VALIDATION_FAILED') return msg.renameLength;
    if (e.status === 403) return msg.forbiddenWrite;
    if (e.code === 'CHATBOT_ARCHIVED') return msg.errors.CHATBOT_ARCHIVED;
  }
  return msg.genericError;
}

/** 묶음 표(§5.5). 이름 인라인 편집(Enter 저장·Esc 취소·저장 뒤 버튼으로 포커스 복귀), AI 제안 표식, 대표 발화 펼침, 발화 보기. */
export function ClusterTable({ chatbotId, analysisId, clusters, canWrite, probeDone, showAiSuggestions, onRenamed, onShowUtterances }: ClusterTableProps): JSX.Element {
  const msg = MESSAGES.utteranceAnalysis;
  const max = UTTERANCE_ANALYSIS_LIMITS.customNameMax;
  const sorted = useMemo(() => sortClusters(clusters), [clusters]);
  const hasUnassigned = sorted.some((c) => c.unassigned);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [rowError, setRowError] = useState<{ id: string; text: string } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [announce, setAnnounce] = useState('');
  const [focusRenameFor, setFocusRenameFor] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId) inputRef.current?.focus();
  }, [editingId]);

  // 저장/취소 후 "이름 바꾸기" 버튼으로 포커스를 돌려 준다(키보드 사용자가 자리를 잃지 않게).
  useEffect(() => {
    if (focusRenameFor && editingId === null) {
      document.getElementById(`ua-rename-${focusRenameFor}`)?.focus();
      setFocusRenameFor(null);
    }
  }, [focusRenameFor, editingId]);

  function startEdit(c: UtteranceCluster): void {
    setEditingId(c.id);
    setDraft(c.displayName);
    setRowError(null);
  }

  function cancelEdit(id: string): void {
    setEditingId(null);
    setRowError(null);
    setFocusRenameFor(id);
  }

  async function save(c: UtteranceCluster, customName: string | null): Promise<void> {
    if (saving) return;
    if (customName !== null) {
      const trimmed = customName.trim();
      if (trimmed.length < 1 || trimmed.length > max) {
        setRowError({ id: c.id, text: msg.renameLength });
        return;
      }
      customName = trimmed;
    }
    setSaving(true);
    setRowError(null);
    try {
      const updated = await utteranceAnalysesApi.renameCluster(chatbotId, analysisId, c.id, { customName });
      onRenamed(updated);
      setEditingId(null);
      setAnnounce('');
      window.setTimeout(() => setAnnounce(msg.renameDone), 0);
      setFocusRenameFor(c.id);
    } catch (e) {
      setRowError({ id: c.id, text: renameErrorText(e) });
    } finally {
      setSaving(false);
    }
  }

  function toggleExpanded(id: string): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div>
      <p role="status" className="sr-only">
        {announce}
      </p>
      <div className="table-scroll-container" role="region" tabIndex={0} aria-label={msg.clusterScrollLabel}>
        <table className="dialogue-table ua-cluster-table">
          <caption>{msg.clusterCaption}</caption>
          <thead>
            <tr>
              <th scope="col">{msg.clusterColNo}</th>
              <th scope="col">{msg.clusterColName}</th>
              <th scope="col">{msg.clusterColKeywords}</th>
              <th scope="col">
                {msg.clusterColCount} <span className="sr-only">{msg.clusterColCountHelp}</span>
              </th>
              <th scope="col">
                {msg.clusterColRatio}
                {!probeDone && <span className="ua-col-note"> {msg.clusterColRatioNoProbe}</span>}
              </th>
              <th scope="col">{msg.clusterColApplied}</th>
              <th scope="col">{msg.clusterColActions}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((c) => {
              const no = clusterNumberLabel(c);
              const editing = editingId === c.id;
              const isOpen = expanded.has(c.id);
              const repsId = `ua-reps-${c.id}`;
              const showChip = showAiSuggestions && c.suggestedName && c.suggestedName !== c.customName && !c.unassigned;
              const err = rowError?.id === c.id ? rowError.text : null;
              return (
                <Fragment key={c.id}>
                  <tr>
                    <td>{no}</td>
                    <th scope="row" className="ua-cluster-name">
                      {editing ? (
                        <div className="ua-rename">
                          <label htmlFor={`ua-rename-input-${c.id}`} className="sr-only">
                            {msg.renameLabel(no)}
                          </label>
                          <input
                            id={`ua-rename-input-${c.id}`}
                            ref={inputRef}
                            type="text"
                            value={draft}
                            aria-invalid={Boolean(err)}
                            aria-describedby={err ? `ua-rename-error-${c.id}` : undefined}
                            disabled={saving}
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                void save(c, draft);
                              } else if (e.key === 'Escape') {
                                e.stopPropagation();
                                cancelEdit(c.id);
                              }
                            }}
                          />
                          <span className="field-hint" aria-hidden="true">
                            {msg.renameCounter(draft.length, max)}
                          </span>
                          <div className="ua-rename-actions">
                            <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void save(c, draft)}>
                              {saving ? msg.renameSaving : msg.renameSave}
                            </button>
                            {c.customName !== null && (
                              <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => void save(c, null)}>
                                {msg.renameReset}
                              </button>
                            )}
                            <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => cancelEdit(c.id)}>
                              {msg.renameCancel}
                            </button>
                          </div>
                          {err && (
                            <p id={`ua-rename-error-${c.id}`} className="field-error" role="alert">
                              <span aria-hidden="true">⚠</span> {err}
                            </p>
                          )}
                        </div>
                      ) : (
                        <>
                          <span>{c.displayName}</span>
                          {canWrite && !c.unassigned && (
                            <button type="button" id={`ua-rename-${c.id}`} className="btn btn-secondary ua-rename-button" aria-label={msg.renameActionLabel(no)} onClick={() => startEdit(c)}>
                              {msg.renameAction}
                            </button>
                          )}
                          {showChip && (
                            <div className="ua-ai-suggest">
                              <span className="ua-ai-suggest-label">{msg.aiSuggestLabel}</span>: &quot;{c.suggestedName}&quot;
                              {canWrite && (
                                <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => void save(c, c.suggestedName)}>
                                  {msg.aiSuggestUse}
                                </button>
                              )}
                              {err && (
                                <p className="field-error" role="alert">
                                  <span aria-hidden="true">⚠</span> {err}
                                </p>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </th>
                    <td>
                      {c.unassigned ? (
                        msg.unassignedKeywords
                      ) : c.keywords.length === 0 ? (
                        msg.noKeywords
                      ) : (
                        c.keywords.map((k, i) => (
                          <span key={k.term}>
                            <span className="ua-keyword" title={msg.keywordTitle(k.count)}>
                              {k.term}
                            </span>
                            {i < c.keywords.length - 1 ? ', ' : ''}
                          </span>
                        ))
                      )}
                    </td>
                    <td>
                      {c.utteranceCount.toLocaleString('ko-KR')} ({c.occurrenceSum.toLocaleString('ko-KR')})
                    </td>
                    <td>
                      {probeDone && c.candidateRatio !== null
                        ? `${Math.round(c.candidateRatio * 100)}% (${c.candidateCount.toLocaleString('ko-KR')}/${c.utteranceCount.toLocaleString('ko-KR')})`
                        : msg.noneDash}
                    </td>
                    <td>{c.appliedCount.toLocaleString('ko-KR')}</td>
                    <td className="ua-actions">
                      <button type="button" className="btn btn-secondary" aria-label={msg.showUtterancesLabel(no)} onClick={() => onShowUtterances(c.id)}>
                        {msg.showUtterances}
                      </button>
                      {c.representatives.length > 0 && (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          aria-expanded={isOpen}
                          aria-controls={repsId}
                          aria-label={msg.representativesToggleLabel(no)}
                          onClick={() => toggleExpanded(c.id)}
                        >
                          {msg.representativesToggle} <span aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
                        </button>
                      )}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr id={repsId} className="ua-reps-row">
                      <td colSpan={7}>
                        <ul>
                          {c.representatives.map((r) => (
                            <li key={r.utteranceId}>{r.text}</li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {hasUnassigned && <p className="field-hint">{msg.unassignedHelp}</p>}
    </div>
  );
}
