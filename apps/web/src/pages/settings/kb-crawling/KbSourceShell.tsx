import { useCallback, useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useParams } from 'react-router-dom';
import type { KbMetaResponse, KbSourceResponse } from '@chat-bot/shared-types';
import { kbSourcesApi } from '../../../api/kbSources';
import { ApiError } from '../../../api/client';
import { ErrorState } from '../../../components/ErrorState';
import { SkeletonRow } from '../../../components/Skeleton';
import { MESSAGES } from '../../../constants/messages';
import { KbDemotedBadge, KbNeedsCleanupBadge, KbNeedsPreviewBadge, KbRepeatedFailureBadge, KbSourceEnabledBadge } from './badges';
import { KbFeatureOffState } from './KbFeatureOffState';

export interface KbSourceOutletContext {
  source: KbSourceResponse;
  meta: KbMetaResponse;
  reloadSource: () => Promise<void>;
}

/**
 * `KbSourceShell` — 소스 1건 스코프 3탭 셸(개요/실행 이력/문서 목록, `kb-crawling-ui-spec.md` §2.3·§3
 * "KbSourceShell", `WorkflowAutomationShell`과 동형이나 소스 1건에 스코프된다). 탭 순서는 개요 →
 * 실행 이력 → 문서 목록(§13.1 사용자 결정 1).
 */
export function KbSourceShell(): JSX.Element {
  const { sourceId } = useParams<{ sourceId: string }>();
  const { pathname } = useLocation();
  const msg = MESSAGES.kbRuns;

  const [meta, setMeta] = useState<KbMetaResponse | null>(null);
  const [source, setSource] = useState<KbSourceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [featureOff, setFeatureOff] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    if (!sourceId) return;
    setLoading(true);
    setError(false);
    setNotFound(false);
    setFeatureOff(false);

    // [No.43 R1 M4] `KbSyncEnabledGuard`와 "소스 없음"(`findOneOrThrow`) 둘 다 `code: 'NOT_FOUND'`를
    // 쓰기 때문에(메시지만 다르다) 메시지 문자열 비교로 구분하지 않는다 — 대신 두 호출의 **순서**를
    // 구조적 근거로 쓴다: `meta()`를 먼저 부르고, 그것이 성공한 뒤에만 `findOne()`을 부른다. 따라서
    // `meta()`의 404는 무조건 "기능 꺼짐"이고, `meta()`가 이미 통과한 뒤 `findOne()`이 내는 404는
    // (같은 가드가 두 라우트 모두를 지키므로) 무조건 "이 소스가 없음"만 의미할 수 있다.
    let metaRes: KbMetaResponse;
    try {
      metaRes = await kbSourcesApi.meta();
    } catch (e) {
      setLoading(false);
      if (e instanceof ApiError && e.status === 404) setFeatureOff(true);
      else setError(true);
      return;
    }
    setMeta(metaRes);

    try {
      const sourceRes = await kbSourcesApi.findOne(sourceId);
      setSource(sourceRes);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'NOT_FOUND') setNotFound(true);
      else setError(true);
    } finally {
      setLoading(false);
    }
  }, [sourceId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="settings-page">
        <SkeletonRow />
        <SkeletonRow />
      </div>
    );
  }
  if (featureOff) return <KbFeatureOffState />;
  if (notFound) return <ErrorState title={msg.notFound} />;
  if (error || !source || !meta || !sourceId) return <ErrorState title={msg.loadFailed} onRetry={load} />;

  const tabs = [
    { href: `/settings/kb-crawling/${sourceId}/overview`, label: msg.tabOverview, match: (p: string) => p === `/settings/kb-crawling/${sourceId}` || p.endsWith('/overview') },
    { href: `/settings/kb-crawling/${sourceId}/runs`, label: msg.tabRuns, match: (p: string) => p.endsWith('/runs') },
    { href: `/settings/kb-crawling/${sourceId}/documents`, label: msg.tabDocuments, match: (p: string) => p.endsWith('/documents') },
  ];

  return (
    <div className="kb-source-shell settings-page">
      <p>
        <Link to="/settings/kb-crawling">{MESSAGES.common.backToList}</Link>
      </p>
      <h1>{source.name}</h1>
      <div className="api-connection-badge-row">
        <KbSourceEnabledBadge enabled={source.enabled} />
        {source.needsPreview && <KbNeedsPreviewBadge />}
        {source.needsCleanupCount > 0 && <KbNeedsCleanupBadge count={source.needsCleanupCount} />}
        {source.repeatedFailureCount > 0 && <KbRepeatedFailureBadge />}
        {source.reviewRequiredReason && <KbDemotedBadge reason={source.reviewRequiredReason} />}
      </div>
      <div className="tab-nav" role="tablist" aria-label={source.name}>
        {tabs.map((tab) => {
          const active = tab.match(pathname);
          return (
            <span key={tab.href} role="tab" aria-selected={active} className={`tab-link${active ? ' tab-link--active' : ''}`}>
              <Link to={tab.href}>{tab.label}</Link>
            </span>
          );
        })}
      </div>
      <div className="kb-source-shell-content">
        <Outlet context={{ source, meta, reloadSource: load } satisfies KbSourceOutletContext} />
      </div>
    </div>
  );
}
