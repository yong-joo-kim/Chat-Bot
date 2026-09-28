import { useCallback, useEffect, useState } from 'react';
import { useSearchParams, useOutletContext } from 'react-router-dom';
import type { KbDocumentState, KbDocumentView, KbExcludeReason } from '@chat-bot/shared-types';
import { kbSourcesApi } from '../../../api/kbSources';
import { ApiError } from '../../../api/client';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../components/Toast';
import { EmptyState } from '../../../components/EmptyState';
import { ErrorState } from '../../../components/ErrorState';
import { SkeletonRow } from '../../../components/Skeleton';
import { Pagination } from '../../../components/Pagination';
import { ConfirmDialog } from '../../../components/Modal';
import { InlineFieldError } from '../../../components/InlineFieldError';
import { CopyButton } from '../../../components/CopyButton';
import { MESSAGES } from '../../../constants/messages';
import { KbDocumentTable } from './KbDocumentTable';
import { KbGovernanceBlockedHint, clientGovernanceViolation } from './governanceBlock';
import type { KbSourceOutletContext } from './KbSourceShell';

const GOVERNANCE_RESEND_HINT_ID = 'kb-resend-governance-hint';
const DOCUMENT_STATES: KbDocumentState[] = ['ACTIVE', 'GONE', 'EXCLUDED'];
const EXCLUDE_REASONS: KbExcludeReason[] = [
  'ROBOTS',
  'TYPE',
  'SIZE',
  'REDIRECT_OUT_OF_SCOPE',
  'NO_BODY',
  'NOINDEX',
  'RAW_FILE_OFF',
  'ENCODING',
  'PII_IN_RAW_FILE',
  'FILE_UNSAFE',
  'FILE_ENCRYPTED',
  'AUTH_WALL',
];

/**
 * KB5 — 소스 상세: 문서 목록·정리 필요(`/settings/kb-crawling/:sourceId/documents`,
 * `kb-crawling-ui-spec.md` §3.5). `?cleanupOnly=true` 딥링크(KB2 배지, §13.1 사용자 결정 2)를
 * 최초 마운트 시점 필터로 읽는다.
 */
export function KbDocumentListPage(): JSX.Element {
  const { source, meta, reloadSource } = useOutletContext<KbSourceOutletContext>();
  const { can } = useAuth();
  const { showToast } = useToast();
  const msg = MESSAGES.kbDocuments;
  const canWrite = can('security:write');
  // 거버넌스 규칙 위반이 확실할 때만(메타 + 소스 값) 미리 막는다 — 모르면 null(활성 유지 · 서버 409 폴백).
  const governanceViolation = canWrite ? clientGovernanceViolation(meta, source) : null;

  const [searchParams] = useSearchParams();
  const [stateFilter, setStateFilter] = useState<KbDocumentState | ''>('');
  const [cleanupOnly, setCleanupOnly] = useState(() => searchParams.get('cleanupOnly') === 'true');
  const [excludeReasonFilter, setExcludeReasonFilter] = useState<KbExcludeReason | ''>('');
  const [page, setPage] = useState(1);

  const [items, setItems] = useState<KbDocumentView[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [resendDialogOpen, setResendDialogOpen] = useState(false);
  const [resendAck, setResendAck] = useState(false);
  const [resendAckError, setResendAckError] = useState<string | undefined>(undefined);
  const [resendSubmitting, setResendSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await kbSourcesApi.listDocuments(source.id, {
        state: stateFilter ? [stateFilter] : undefined,
        cleanupOnly: cleanupOnly || undefined,
        excludeReason: excludeReasonFilter ? [excludeReasonFilter] : undefined,
        page,
        pageSize: 50,
      });
      setItems(res.items);
      setTotal(res.total);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [source.id, stateFilter, cleanupOnly, excludeReasonFilter, page]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleFullResend(): Promise<void> {
    if (!resendAck) {
      setResendAckError(msg.fullResendAckError);
      return;
    }
    setResendSubmitting(true);
    try {
      await kbSourcesApi.createRun(source.id, { kind: 'FULL_RESEND', acknowledgeCleanup: true });
      showToast(msg.fullResendSuccess);
      setResendDialogOpen(false);
      setResendAck(false);
      await reloadSource();
      void load();
    } catch (e) {
      // [3차 보완] `REVIEW_REQUIRED`(자동 강등 후 재확인 필요)는 정식 분기로 안내한다 — 그 밖의
      // 게이트 사유(TRANSPORT_NOT_ACKNOWLEDGED 등)는 서버 메시지를 그대로 보여준다.
      if (e instanceof ApiError && e.code === 'KB_INGEST_NOT_ALLOWED' && e.details?.[0]?.message === 'REVIEW_REQUIRED') {
        showToast(msg.fullResendReviewRequiredError);
      } else {
        showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
      }
    } finally {
      setResendSubmitting(false);
    }
  }

  const scopeText = [source.scope.company, source.scope.category, source.scope.subcategory].filter(Boolean).join(' / ');
  const isEmpty = !loading && !error && items.length === 0;
  // [No.43 R1 M3] 필터로 인해 0건이 된 경우는 "아직 수집된 문서가 없습니다"와 다른 문구를 쓴다.
  const hasActiveFilter = Boolean(stateFilter) || cleanupOnly || Boolean(excludeReasonFilter);

  function resetFilters(): void {
    setStateFilter('');
    setCleanupOnly(false);
    setExcludeReasonFilter('');
    setPage(1);
  }

  return (
    <div className="kb-document-list-page">
      <h1 className="sr-only">{MESSAGES.kbRuns.tabDocuments}</h1>

      {source.needsCleanupCount > 0 && (
        <div className="form-banner form-banner--warning" role="status">
          <p>
            <span aria-hidden="true">⚠</span> {msg.cleanupBannerTitle(source.needsCleanupCount)}
          </p>
          <p>{msg.cleanupBannerBody(scopeText)}</p>
          <CopyButton text={source.scope.subcategory} label={msg.copyScopeButton} />
          {canWrite && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={Boolean(governanceViolation)}
              aria-describedby={governanceViolation ? GOVERNANCE_RESEND_HINT_ID : undefined}
              onClick={() => setResendDialogOpen(true)}
            >
              {msg.fullResendButton}
            </button>
          )}
          {governanceViolation && <KbGovernanceBlockedHint id={GOVERNANCE_RESEND_HINT_ID} violation={governanceViolation} />}
        </div>
      )}

      <div className="dialogue-filter-bar">
        <div className="form-field">
          <label htmlFor="kb-doc-filter-state">{msg.filterState}</label>
          <select id="kb-doc-filter-state" value={stateFilter} onChange={(e) => { setStateFilter(e.target.value as KbDocumentState | ''); setPage(1); }}>
            <option value="">{msg.filterAll}</option>
            {DOCUMENT_STATES.map((s) => (
              <option key={s} value={s}>
                {MESSAGES.kbDocuments.stateLabel[s]}
              </option>
            ))}
          </select>
        </div>
        <label className="form-field--inline">
          <input
            type="checkbox"
            checked={cleanupOnly}
            onChange={(e) => {
              setCleanupOnly(e.target.checked);
              setPage(1);
            }}
          />
          {msg.filterCleanupOnly}
        </label>
        <div className="form-field">
          <label htmlFor="kb-doc-filter-exclude">{msg.filterExcludeReason}</label>
          <select
            id="kb-doc-filter-exclude"
            value={excludeReasonFilter}
            onChange={(e) => {
              setExcludeReasonFilter(e.target.value as KbExcludeReason | '');
              setPage(1);
            }}
          >
            <option value="">{msg.filterAll}</option>
            {EXCLUDE_REASONS.map((r) => (
              <option key={r} value={r}>
                {MESSAGES.kbDocuments.excludeReasonLabel[r]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading && (
        <>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </>
      )}
      {!loading && error && <ErrorState title={msg.loadFailed} onRetry={load} />}
      {isEmpty && hasActiveFilter && (
        <EmptyState
          title={msg.emptyFilterTitle}
          action={
            <button type="button" className="btn btn-secondary" onClick={resetFilters}>
              {MESSAGES.kbSources.resetFilter}
            </button>
          }
        />
      )}
      {isEmpty && !hasActiveFilter && <EmptyState title={msg.emptyTitle} />}
      {!loading && !error && items.length > 0 && (
        <div className="dialogue-table-wrap">
          <KbDocumentTable items={items} />
          <Pagination page={page} pageSize={50} total={total} onPageChange={setPage} />
        </div>
      )}

      <ConfirmDialog
        isOpen={resendDialogOpen}
        title={msg.fullResendDialogTitle}
        description={msg.fullResendDialogBody(source.activeDocumentCount, Math.max(1, Math.round(source.activeDocumentCount / 60)))}
        confirmLabel={msg.fullResendButton}
        onConfirm={() => void handleFullResend()}
        onCancel={() => {
          setResendDialogOpen(false);
          setResendAck(false);
          setResendAckError(undefined);
        }}
        confirmDisabled={resendSubmitting}
      >
        <div className="form-field form-field--inline">
          <input
            id="kb-resend-ack"
            type="checkbox"
            checked={resendAck}
            onChange={(e) => {
              setResendAck(e.target.checked);
              setResendAckError(undefined);
            }}
          />
          <label htmlFor="kb-resend-ack">
            {msg.fullResendAckLabel} <span className="required-mark" aria-hidden="true">*</span>
          </label>
        </div>
        <p className="field-hint">{msg.fullResendAckHint}</p>
        <InlineFieldError id="kb-resend-ack-error" message={resendAckError} />
      </ConfirmDialog>
    </div>
  );
}
