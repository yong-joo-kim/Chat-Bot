import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { ChatbotVersionListItem, RestoreResponse, VersionAssetKind, VersionChangeKind, VersionDiffResponse } from '@chat-bot/shared-types';
import { VersionAssetKind as VersionAssetKindSchema } from '@chat-bot/shared-types';
import { useChatbotDetailContext } from '../../../ChatbotDetailLayout';
import { useAuth } from '../../../../context/AuthContext';
import { ApiError } from '../../../../api/client';
import { versionsApi } from '../../../../api/versions';
import { MESSAGES } from '../../../../constants/messages';
import { SkeletonRow } from '../../../../components/Skeleton';
import { ErrorState } from '../../../../components/ErrorState';
import { ChangeKindBadge } from '../../../../components/ChangeKindBadge';
import { RestoreDialog } from '../restore/RestoreDialog';
import { RestoreResultPanel } from '../restore/RestoreResultPanel';
import { DiffItemDrawer } from './DiffItemDrawer';

const KIND_LABELS: Record<string, string> = {
  ...MESSAGES.versions.content.kindTabs,
  INTEGRITY_WARNING: '무결성 경고',
};

/** L2 — 차이 보기(요약→목록→상세, `version-history-ui-spec.md` §4.2). */
export function VersionDiffPage(): JSX.Element {
  const { chatbot, reload } = useChatbotDetailContext();
  const { can } = useAuth();
  const { versionId } = useParams<{ versionId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const msg = MESSAGES.versions.diff;

  const against = searchParams.get('against') ?? 'current';
  const kindParam = searchParams.get('kind') as VersionAssetKind | null;
  const changeParam = searchParams.get('change') as VersionChangeKind | null;

  const canRestore = can('dialogue:write') && can('chatbot:write') && chatbot.status !== 'ARCHIVED';

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(false);
  const [diff, setDiff] = useState<VersionDiffResponse | null>(null);
  const [baseVersionNo, setBaseVersionNo] = useState<number | null>(null);
  const [otherVersions, setOtherVersions] = useState<ChatbotVersionListItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<{ kind: VersionAssetKind; id: string } | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreResult, setRestoreResult] = useState<RestoreResponse | null>(null);

  const loadVersionsList = useCallback(async () => {
    try {
      const res = await versionsApi.list(chatbot.id, { page: 1, pageSize: 100 });
      setBaseVersionNo(res.items.find((v) => v.id === versionId)?.versionNo ?? null);
      setOtherVersions(res.items.filter((v) => v.id !== versionId));
    } catch {
      // 목록 갱신 실패는 비교대상 선택기·헤더 버전 번호만 갱신되지 않을 뿐 — 화면 자체는 유지한다.
    }
  }, [chatbot.id, versionId]);

  useEffect(() => {
    void loadVersionsList();
  }, [loadVersionsList]);

  const load = useCallback(async () => {
    if (!versionId) return;
    setLoading(true);
    setError(false);
    setNotFound(false);
    try {
      const res = await versionsApi.diff(chatbot.id, versionId, {
        against,
        kind: kindParam ?? undefined,
        change: changeParam ? [changeParam] : undefined,
        page: 1,
        pageSize: 50,
      });
      setDiff(res);
      // 종류 필터가 아직 없으면(초기 진입) 변화가 있는 첫 종류를 자동으로 선택해 항목 목록을 채운다
      // — 백엔드가 `kind` 지정 시에만 항목 목록을 포함하기 때문이다(설계서 §7.4).
      if (!kindParam) {
        const firstChanged = res.summary.rows.find(
          (r) => r.kind !== 'INTEGRITY_WARNING' && r.added + r.removed + r.modified > 0,
        );
        if (firstChanged) {
          const next = new URLSearchParams(searchParams);
          next.set('kind', firstChanged.kind);
          setSearchParams(next, { replace: true });
        }
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setNotFound(true);
      else setError(true);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatbot.id, versionId, against, kindParam, changeParam]);

  useEffect(() => {
    void load();
  }, [load]);

  function updateQuery(patch: Record<string, string | undefined>): void {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === '') next.delete(k);
      else next.set(k, v);
    }
    setSearchParams(next);
  }

  if (!versionId) return <ErrorState title={msg.notFound} />;

  return (
    <div className="version-diff-page">
      <div className="version-diff-header">
        <h1>{msg.title(baseVersionNo ?? 0)}</h1>
        {canRestore && against === 'current' && baseVersionNo !== null && (
          <button type="button" className="btn btn-primary" onClick={() => setRestoreOpen(true)}>
            {msg.restoreFromHere}
          </button>
        )}
      </div>

      <div className="version-diff-target-selector">
        <label htmlFor="diff-against-select">{msg.compareTargetLabel}</label>
        <select id="diff-against-select" value={against} onChange={(e) => updateQuery({ against: e.target.value })}>
          <option value="current">{msg.compareCurrent}</option>
          {otherVersions.map((v) => (
            <option key={v.id} value={v.id}>
              v{v.versionNo}
            </option>
          ))}
        </select>
      </div>

      {loading && (
        <>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </>
      )}
      {!loading && notFound && <ErrorState title={msg.notFound} />}
      {!loading && error && <ErrorState title={msg.loadFailed} onRetry={load} />}

      {!loading && !error && !notFound && diff && (
        <>
          {diff.summary.identical ? (
            <p role="status">{msg.identicalNotice}</p>
          ) : (
            <p className="version-diff-summary-bar">
              {diff.summary.rows
                .filter((r) => r.kind !== 'INTEGRITY_WARNING')
                .map((r) => {
                  const label = KIND_LABELS[r.kind] ?? r.kind;
                  const total = r.added + r.removed + r.modified;
                  return (
                    <span key={r.kind} className="version-diff-summary-row">
                      {total === 0 ? msg.noChangeKind(label) : `+${r.added} −${r.removed} ~${r.modified} ${label}`}
                    </span>
                  );
                })}
            </p>
          )}

          <div className="version-diff-filter-bar">
            <label htmlFor="diff-kind-filter">{msg.filterKindLabel}</label>
            <select id="diff-kind-filter" value={kindParam ?? ''} onChange={(e) => updateQuery({ kind: e.target.value || undefined })}>
              <option value="">{msg.filterAllKind}</option>
              {VersionAssetKindSchema.options.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
            <label htmlFor="diff-change-filter">{msg.filterChangeLabel}</label>
            <select id="diff-change-filter" value={changeParam ?? ''} onChange={(e) => updateQuery({ change: e.target.value || undefined })}>
              <option value="">{msg.filterAllChange}</option>
              <option value="ADDED">{MESSAGES.versions.diff.changeLabelAdded}</option>
              <option value="REMOVED">{MESSAGES.versions.diff.changeLabelRemoved}</option>
              <option value="MODIFIED">{MESSAGES.versions.diff.changeLabelModified}</option>
            </select>
          </div>

          {diff.items && (
            <table className="version-diff-item-table">
              <thead>
                <tr>
                  <th scope="col">{msg.columnKind}</th>
                  <th scope="col">{msg.columnName}</th>
                  <th scope="col">{msg.columnChange}</th>
                </tr>
              </thead>
              <tbody>
                {diff.items.items.map((item) => (
                  <tr key={`${item.kind}-${item.id}`}>
                    <td>{KIND_LABELS[item.kind]}</td>
                    <td>
                      <button type="button" className="link-button" onClick={() => setSelectedItemId({ kind: item.kind, id: item.id })}>
                        {item.name || item.id}
                      </button>
                    </td>
                    <td>
                      <ChangeKindBadge change={item.change} />
                      {item.recreated && (
                        <button
                          type="button"
                          className="link-button version-recreated-hint"
                          onClick={() => setSelectedItemId({ kind: item.kind, id: item.recreated!.counterpartId })}
                        >
                          {msg.recreatedHint} · {msg.goToCounterpart}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!diff.items && !diff.summary.identical && kindParam === null && <p className="field-hint">{msg.filterKindLabel}</p>}
        </>
      )}

      {selectedItemId && (
        <DiffItemDrawer
          chatbotId={chatbot.id}
          versionId={versionId}
          against={against}
          kind={selectedItemId.kind}
          itemId={selectedItemId.id}
          onClose={() => setSelectedItemId(null)}
        />
      )}

      {restoreOpen && baseVersionNo !== null && (
        <RestoreDialog
          chatbotId={chatbot.id}
          targetVersionId={versionId}
          targetVersionNo={baseVersionNo}
          isOpen={restoreOpen}
          onClose={() => setRestoreOpen(false)}
          onRestored={(res) => {
            setRestoreOpen(false);
            setRestoreResult(res);
            // M-2: 챗봇 표시 설정(name/avatarUrl/description/skin)이 바뀔 수 있어 헤더·다른 탭도 갱신한다.
            void reload();
            // L-6: 복원 직후 이전 diff가 RestoreResultPanel 위에 그대로 남지 않도록 다시 조회한다.
            void load();
            void loadVersionsList();
          }}
          onRestoreInProgressElsewhere={() => {
            setRestoreOpen(false);
            void load();
            void loadVersionsList();
          }}
        />
      )}
      {restoreResult && (
        <RestoreResultPanel chatbotId={chatbot.id} result={restoreResult} onClose={() => navigate(`/chatbots/${chatbot.id}/versions`)} />
      )}
    </div>
  );
}
