import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import type { VersionAssetKind, VersionContentPage as VersionContentPageType } from '@chat-bot/shared-types';
import { VersionAssetKind as VersionAssetKindSchema } from '@chat-bot/shared-types';
import { useChatbotDetailContext } from '../../../ChatbotDetailLayout';
import { ApiError } from '../../../../api/client';
import { versionsApi } from '../../../../api/versions';
import { MESSAGES } from '../../../../constants/messages';
import { SkeletonRow } from '../../../../components/Skeleton';
import { ErrorState } from '../../../../components/ErrorState';
import { EmptyState } from '../../../../components/EmptyState';
import { Pagination } from '../../../../components/Pagination';
import { CopyButton } from '../../../../components/CopyButton';

type Rec = Record<string, unknown>;

function str(v: unknown): string {
  if (v === null || v === undefined) return '—';
  return String(v);
}

function listPreview(values: unknown, msg: (typeof MESSAGES)['versions']['content']): JSX.Element {
  const arr = Array.isArray(values) ? (values as unknown[]) : [];
  if (arr.length === 0) return <>—</>;
  const shown = arr.slice(0, 5).map((v) => String(v));
  const remainder = arr.length - shown.length;
  return (
    <>
      {shown.join(', ')}
      {remainder > 0 && ` ${msg.moreItems(remainder)}`}
    </>
  );
}

/** 종류별 표시 컬럼(§4.3) — 항목 스키마는 응답에서 `unknown`이라 안전하게 필드를 뽑아 렌더한다. */
function ContentRow({ kind, item }: { kind: VersionAssetKind; item: unknown }): JSX.Element {
  const msg = MESSAGES.versions.content;
  const r = item as Rec;
  switch (kind) {
    case 'INTENT':
      return (
        <tr>
          <td>{str(r.name)}</td>
          <td>{str(r.description)}</td>
          <td>
            {listPreview(r.examples, msg)} <CopyButton text={Array.isArray(r.examples) ? (r.examples as string[]).join('\n') : ''} />
          </td>
        </tr>
      );
    case 'KEYWORD':
      return (
        <tr>
          <td>{str(r.name)}</td>
          <td>{str(r.description)}</td>
          <td>
            {listPreview(r.synonyms, msg)} <CopyButton text={Array.isArray(r.synonyms) ? (r.synonyms as string[]).join('\n') : ''} />
          </td>
        </tr>
      );
    case 'HOMONYM':
      return (
        <tr>
          <td>{str(r.word)}</td>
          <td>{str(r.description)}</td>
          <td>{Array.isArray(r.meanings) ? (r.meanings as unknown[]).length : 0}</td>
        </tr>
      );
    case 'CONTEXT':
      return (
        <tr>
          <td>{str(r.name)}</td>
          <td>{str(r.description)}</td>
          <td>{Array.isArray(r.slots) ? (r.slots as unknown[]).length : 0}</td>
        </tr>
      );
    case 'NODE':
      return (
        <tr>
          <td>{str(r.name)}</td>
          <td>{str(r.nodeType)}</td>
          <td>{r.enabled ? '사용' : '미사용'}</td>
        </tr>
      );
    case 'FAQ':
      return (
        <tr>
          <td>
            {str(r.question)} <CopyButton text={str(r.question)} />
          </td>
          <td>
            {str(r.answer)} <CopyButton text={str(r.answer)} />
          </td>
          <td>{listPreview(r.altQuestions, msg)}</td>
        </tr>
      );
    default:
      return (
        <tr>
          <td colSpan={3}>
            <pre>{JSON.stringify(item, null, 2)}</pre>
          </td>
        </tr>
      );
  }
}

const COLUMNS: Record<VersionAssetKind, [string, string, string]> = {
  INTENT: ['이름', '설명', '예문'],
  KEYWORD: ['이름', '설명', '동의어'],
  HOMONYM: ['단어', '설명', '의미 수'],
  CONTEXT: ['이름', '설명', '슬롯 수'],
  NODE: ['이름', '유형', '사용 여부'],
  FAQ: ['질문', '답변', '대체 질문'],
  ANSWER_SETTING: ['필드', '값', ''],
  PROFILE: ['필드', '값', ''],
};

/** L3 — 내용 보기(읽기 전용, `version-history-ui-spec.md` §4.3). */
export function VersionContentPage(): JSX.Element {
  const { chatbot } = useChatbotDetailContext();
  const { versionId } = useParams<{ versionId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const msg = MESSAGES.versions.content;

  const kind = (searchParams.get('kind') as VersionAssetKind | null) ?? 'INTENT';
  const q = searchParams.get('q') ?? '';
  const page = Number(searchParams.get('page') ?? '1');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [data, setData] = useState<VersionContentPageType | null>(null);
  const [versionNo, setVersionNo] = useState<number | null>(null);

  useEffect(() => {
    if (!versionId) return;
    versionsApi
      .detail(chatbot.id, versionId)
      .then((d) => setVersionNo(d.versionNo))
      .catch(() => undefined);
  }, [chatbot.id, versionId]);

  const load = useCallback(async () => {
    if (!versionId) return;
    setLoading(true);
    setError(false);
    try {
      const res = await versionsApi.content(chatbot.id, versionId, { kind, q: q || undefined, page, pageSize: 50 });
      setData(res);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) setError(true);
    } finally {
      setLoading(false);
    }
  }, [chatbot.id, versionId, kind, q, page]);

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

  if (!versionId) return <ErrorState title={MESSAGES.versions.diff.notFound} />;

  const columns = COLUMNS[kind];

  return (
    <div className="version-content-page">
      <h1>{msg.title(versionNo ?? 0)}</h1>

      <div className="version-content-kind-tabs" role="tablist" aria-label="자산 종류">
        {VersionAssetKindSchema.options.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={kind === k}
            className={`sub-tab-button${kind === k ? ' sub-tab-button--active' : ''}`}
            onClick={() => updateQuery({ kind: k, page: undefined })}
          >
            {MESSAGES.versions.content.kindTabs[k]}
          </button>
        ))}
      </div>

      <div className="form-field">
        <label htmlFor="version-content-search">{msg.searchLabel}</label>
        <input
          id="version-content-search"
          type="text"
          value={q}
          onChange={(e) => updateQuery({ q: e.target.value || undefined, page: undefined })}
        />
      </div>

      {loading && (
        <>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </>
      )}
      {!loading && error && <ErrorState title={msg.loadFailed} onRetry={load} />}

      {!loading && !error && data && !data.schemaSupported && <p className="form-banner form-banner--info">{msg.schemaUnsupportedBanner}</p>}

      {!loading && !error && data && kind === 'ANSWER_SETTING' && data.items.length === 0 && <p className="field-hint">{msg.answerSettingEmpty}</p>}

      {!loading && !error && data && data.items.length === 0 && kind !== 'ANSWER_SETTING' && (
        <EmptyState title={msg.emptyForKind(MESSAGES.versions.content.kindTabs[kind])} />
      )}

      {!loading && !error && data && data.items.length > 0 && (
        <>
          <table className="version-content-table">
            <thead>
              <tr>
                <th scope="col">{columns[0]}</th>
                <th scope="col">{columns[1]}</th>
                <th scope="col">{columns[2]}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item, i) => (
                <ContentRow key={i} kind={kind} item={item} />
              ))}
            </tbody>
          </table>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={(p) => updateQuery({ page: String(p) })} />
        </>
      )}
    </div>
  );
}
