import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { IMPORT_LIMITS, UTTERANCE_ANALYSIS_LIMITS, type UtteranceAnalysisConditions, type UtterancePreviewResponse } from '@chat-bot/shared-types';
import { useChatbotDetailContext } from '../../ChatbotDetailLayout';
import { ApiError } from '../../../api/client';
import { utteranceAnalysesApi } from '../../../api/utteranceAnalyses';
import { MESSAGES } from '../../../constants/messages';
import { AsyncJobProgress } from '../../../components/AsyncJobProgress';
import { FileUploadField } from '../../../components/FileUploadField';
import { SeverityBadge } from '../../../components/SeverityBadge';
import { useLatestRequest } from '../../../lib/useLatestRequest';
import { useToast } from '../../../components/Toast';
import { ArchivedBanner } from '../ArchivedBanner';
import {
  AnalysisConditionsForm,
  CONDITION_FIELD_IDS,
  defaultConditionValues,
  type ConditionErrorKey,
  type ConditionErrors,
  type ConditionValues,
} from './AnalysisConditionsForm';
import { ClusterHelp } from './ClusterHelp';
import { TemplateDownloadButtons } from './TemplateDownloadButtons';
import { UploadPreviewTable } from './UploadPreviewTable';
import { UtteranceAnalysisFeatureOffState } from './UtteranceAnalysisFeatureOffState';
import { computeNewAnalysisBlock } from './newAnalysisBlock';
import { checkTooFew } from './previewRules';
import { useUtteranceCapability } from './useUtteranceCapability';

type PreviewState = { status: 'idle' } | { status: 'loading' } | { status: 'ready'; data: UtterancePreviewResponse; sentMin: number | undefined };

interface TopError {
  message: string;
  showListLink: boolean;
}

/** 정수 문자열만 통과(빈 값·소수·문자는 NaN). */
function parseInteger(value: string): number {
  return /^\d+$/.test(value.trim()) ? Number(value.trim()) : Number.NaN;
}

function inRange(n: number, min: number, max: number): boolean {
  return Number.isInteger(n) && n >= min && n <= max;
}

function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)}KB` : `${Math.round(bytes / (1024 * 1024))}MB`;
}

/** UA-2 — 새 분석(`deep-clustering-ui-spec.md` §4). 파일 → 자동 검사 → 조건 → 요청. */
export function NewAnalysisPage(): JSX.Element {
  const { chatbot, setUnsavedGuard } = useChatbotDetailContext();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const msg = MESSAGES.utteranceAnalysis;
  const l = UTTERANCE_ANALYSIS_LIMITS;
  const base = `/chatbots/${chatbot.id}/stats/utterance-analyses`;
  const archived = chatbot.status === 'ARCHIVED';

  const { state: capState } = useUtteranceCapability(chatbot.id);
  const cap = capState.status === 'ready' ? capState.data : null;
  const block = computeNewAnalysisBlock(cap);

  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | undefined>(undefined);
  const [preview, setPreview] = useState<PreviewState>({ status: 'idle' });
  const [values, setValues] = useState<ConditionValues>(defaultConditionValues);
  const [errors, setErrors] = useState<ConditionErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [topError, setTopError] = useState<TopError | null>(null);
  const previewGuard = useLatestRequest();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const bannerRef = useRef<HTMLDivElement>(null);
  const submittedRef = useRef(false);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const dirty = useMemo(() => {
    const d = defaultConditionValues();
    return file !== null || (Object.keys(d) as Array<keyof ConditionValues>).some((k) => values[k] !== d[k]);
  }, [file, values]);

  // 작성 중 이탈 확인(탭·상단 링크 이동은 가드로, 새로고침은 beforeunload로). 제출 성공 뒤에는 풀린다.
  useEffect(() => {
    setUnsavedGuard(dirty && !submittedRef.current ? () => window.confirm(msg.unsavedConfirm) : null);
    return () => setUnsavedGuard(null);
  }, [dirty, setUnsavedGuard, msg.unsavedConfirm]);
  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  useEffect(() => {
    if (topError) bannerRef.current?.focus();
  }, [topError]);

  const maxFileBytes = cap?.limits.maxFileBytes ?? IMPORT_LIMITS.maxFileBytes;
  const maxRows = cap?.limits.maxRows ?? IMPORT_LIMITS.maxRows;
  const maxChars = cap?.limits.maxChars;

  const fileErrorFor = useCallback(
    (e: unknown): string => {
      if (e instanceof ApiError) {
        if (e.code === 'IMPORT_FILE_INVALID' && e.details?.some((d) => d.field === 'encoding')) return msg.errors.IMPORT_FILE_ENCODING;
        if (e.code === 'IMPORT_FILE_INVALID') return e.details?.find((d) => d.field === 'header')?.message ?? msg.errors.IMPORT_FILE_INVALID;
        if (e.code === 'IMPORT_TOO_LARGE') return msg.errors.IMPORT_TOO_LARGE(formatBytes(maxFileBytes), maxRows.toLocaleString('ko-KR'));
        if (e.code === 'CHATBOT_ARCHIVED') return msg.errors.CHATBOT_ARCHIVED;
        if (e.status === 403) return msg.forbiddenWrite;
      }
      return msg.genericError;
    },
    [maxFileBytes, maxRows, msg],
  );

  async function runPreview(f: File): Promise<void> {
    const reqId = previewGuard.next();
    const n = parseInteger(values.minClusterSize);
    const sentMin = inRange(n, l.minClusterSize.min, l.minClusterSize.max) ? n : undefined;
    setPreview({ status: 'loading' });
    try {
      const data = await utteranceAnalysesApi.preview(chatbot.id, f, sentMin);
      if (previewGuard.isStale(reqId)) return;
      setPreview({ status: 'ready', data, sentMin });
    } catch (e) {
      if (previewGuard.isStale(reqId)) return;
      setPreview({ status: 'idle' });
      setFileError(fileErrorFor(e));
    }
  }

  function handleFileSelected(f: File | null): void {
    previewGuard.next(); // 진행 중이던 이전 검사 응답은 버린다.
    setFile(f);
    setFileError(undefined);
    setTopError(null);
    setErrors((prev) => ({ ...prev, minClusterSize: undefined }));
    setPreview({ status: 'idle' });
    if (f) void runPreview(f);
  }

  function patchValues(patch: Partial<ConditionValues>): void {
    setValues((prev) => ({ ...prev, ...patch }));
    const cleared = (Object.keys(patch) as Array<keyof ConditionValues>).filter((k) => k in CONDITION_FIELD_IDS) as ConditionErrorKey[];
    if (cleared.length > 0) setErrors((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => !cleared.includes(k as ConditionErrorKey))));
  }

  /** 발화 부족(재계산) — 미리보기가 있을 때만. 값이 바뀌어도 파일을 다시 올리지 않는다. */
  const minNow = parseInteger(values.minClusterSize);
  const tooFew =
    preview.status === 'ready' && inRange(minNow, l.minClusterSize.min, l.minClusterSize.max) ? checkTooFew(preview.data, preview.sentMin, minNow) : null;

  function validate(): { errors: ConditionErrors; fileError?: string } {
    const errs: ConditionErrors = {};
    let fErr: string | undefined;
    if (!file) fErr = msg.fileRequired;
    if (!inRange(parseInteger(values.targetClusterCount), l.targetClusterCount.min, l.targetClusterCount.max)) {
      errs.targetClusterCount = msg.rangeErrors.targetClusterCount(l.targetClusterCount.min, l.targetClusterCount.max);
    }
    if (!inRange(minNow, l.minClusterSize.min, l.minClusterSize.max)) {
      errs.minClusterSize = msg.rangeErrors.minClusterSize(l.minClusterSize.min, l.minClusterSize.max);
    } else if (tooFew) {
      errs.minClusterSize = msg.tooFewFieldError(tooFew.validCount, tooFew.maxMin);
    }
    if (!inRange(parseInteger(values.keywordCount), l.keywordCount.min, l.keywordCount.max)) {
      errs.keywordCount = msg.rangeErrors.keywordCount(l.keywordCount.min, l.keywordCount.max);
    }
    const th = values.scoreThreshold.trim();
    if (values.probeEnabled && th !== '') {
      const n = Number(th);
      if (!Number.isFinite(n) || n < 0 || n > 100) errs.scoreThreshold = msg.rangeErrors.scoreThreshold;
    }
    return { errors: errs, fileError: fErr };
  }

  function focusFirstError(errs: ConditionErrors, fErr: string | undefined): void {
    if (fErr) {
      document.getElementById('ua-file')?.focus();
      return;
    }
    const order: ConditionErrorKey[] = ['targetClusterCount', 'minClusterSize', 'keywordCount', 'scoreThreshold', 'nameSuggest'];
    const first = order.find((k) => errs[k]);
    if (first) document.getElementById(CONDITION_FIELD_IDS[first])?.focus();
  }

  function buildConditions(): UtteranceAnalysisConditions {
    const th = values.scoreThreshold.trim();
    return {
      targetClusterCount: parseInteger(values.targetClusterCount),
      minClusterSize: minNow,
      keywordCount: parseInteger(values.keywordCount),
      nounsOnly: values.nounsOnly,
      probe: {
        enabled: values.probeEnabled,
        target: cap?.envModeEnabled ? values.probeTarget : 'SERVING',
        scoreThreshold: values.probeEnabled && th !== '' ? Number(th) / 100 : null,
      },
      // 서버에서 이름 제안이 꺼져 있으면 컨트롤을 그리지 않고 false로 보낸다(AC-DC6-1).
      nameSuggest: Boolean(cap?.nameSuggestAvailable) && values.nameSuggest,
    };
  }

  function applyServerError(e: unknown): void {
    if (!(e instanceof ApiError)) {
      setTopError({ message: msg.genericError, showListLink: false });
      return;
    }
    switch (e.code) {
      case 'IMPORT_FILE_INVALID':
      case 'IMPORT_TOO_LARGE':
        setFileError(fileErrorFor(e));
        document.getElementById('ua-file')?.focus();
        return;
      case 'UTTERANCE_ANALYSIS_TOO_FEW':
        setErrors({ minClusterSize: msg.errors.UTTERANCE_ANALYSIS_TOO_FEW });
        document.getElementById(CONDITION_FIELD_IDS.minClusterSize)?.focus();
        return;
      case 'VALIDATION_FAILED': {
        const next: ConditionErrors = {};
        for (const d of e.details ?? []) {
          if (d.field === 'targetClusterCount') next.targetClusterCount = msg.rangeErrors.targetClusterCount(l.targetClusterCount.min, l.targetClusterCount.max);
          else if (d.field === 'minClusterSize') next.minClusterSize = msg.rangeErrors.minClusterSize(l.minClusterSize.min, l.minClusterSize.max);
          else if (d.field === 'keywordCount') next.keywordCount = msg.rangeErrors.keywordCount(l.keywordCount.min, l.keywordCount.max);
          else if (d.field.startsWith('probe')) next.scoreThreshold = msg.rangeErrors.scoreThreshold;
          else if (d.field === 'nameSuggest') next.nameSuggest = msg.nameSuggestUnavailable;
        }
        if (Object.keys(next).length > 0) {
          setErrors(next);
          focusFirstError(next, undefined);
        } else {
          setTopError({ message: msg.genericError, showListLink: false });
        }
        return;
      }
      case 'EGRESS_HOST_NOT_ALLOWED':
        if (e.details?.some((d) => d.field === 'nameSuggest')) {
          setErrors({ nameSuggest: msg.errors.EGRESS_HOST_NOT_ALLOWED_NAMING });
          document.getElementById(CONDITION_FIELD_IDS.nameSuggest)?.focus();
        } else {
          setTopError({ message: msg.errors.EGRESS_HOST_NOT_ALLOWED, showListLink: false });
        }
        return;
      case 'UTTERANCE_ANALYSIS_BUSY':
        setTopError({ message: msg.errors.UTTERANCE_ANALYSIS_BUSY, showListLink: true });
        return;
      case 'UTTERANCE_ANALYSIS_STORE_FULL':
        setTopError({ message: msg.errors.UTTERANCE_ANALYSIS_STORE_FULL, showListLink: true });
        return;
      case 'CHATBOT_ARCHIVED':
        setTopError({ message: msg.errors.CHATBOT_ARCHIVED, showListLink: false });
        return;
      case 'EMBEDDING_UNAVAILABLE':
        setTopError({ message: msg.errors.EMBEDDING_UNAVAILABLE, showListLink: false });
        return;
      default:
        setTopError({ message: e.status === 403 ? msg.forbiddenWrite : msg.genericError, showListLink: false });
    }
  }

  async function handleSubmit(ev: React.FormEvent): Promise<void> {
    ev.preventDefault();
    if (submitting || block) return; // 서버 상태로 막힌 동안은 눌러도 아무 일도 없다(이유는 글자로 이미 보인다).
    setTopError(null);
    const result = validate();
    setErrors(result.errors);
    setFileError(result.fileError ?? fileError);
    if (result.fileError || Object.keys(result.errors).length > 0) {
      focusFirstError(result.errors, result.fileError);
      return;
    }
    if (!file) return;
    setSubmitting(true);
    try {
      const res = await utteranceAnalysesApi.create(chatbot.id, file, buildConditions());
      submittedRef.current = true;
      setUnsavedGuard(null);
      showToast(msg.started);
      navigate(`${base}/${res.analysisId}`);
    } catch (e) {
      applyServerError(e);
      setSubmitting(false);
    }
  }

  function handleCancel(e: React.MouseEvent): void {
    if (dirty && !window.confirm(msg.unsavedConfirm)) e.preventDefault();
  }

  if (capState.status === 'off') {
    return (
      <div className="ua-page">
        <UtteranceAnalysisFeatureOffState chatbotId={chatbot.id} />
      </div>
    );
  }

  if (archived) {
    return (
      <div className="ua-page">
        <ArchivedBanner visible />
        <Link to={base} className="btn btn-secondary">
          {msg.backToList}
        </Link>
      </div>
    );
  }

  return (
    <div className="ua-page">
      <nav aria-label={msg.pageTitle} className="ua-breadcrumb">
        <Link to={base}>{msg.pageTitle}</Link> <span aria-hidden="true">&gt;</span> <span aria-current="page">{msg.breadcrumbNew}</span>
      </nav>
      <div className="ua-page-header">
        <h2 tabIndex={-1} ref={headingRef}>
          {msg.newTitle}
        </h2>
      </div>
      <p>{msg.targetChatbot(chatbot.name)}</p>
      <ClusterHelp />
      {block && (
        <p id="ua-new-block-reason" className="form-banner form-banner--info">
          {block.message}{' '}
          {(block.kind === 'BUSY_CHATBOT' || block.kind === 'BUSY_SERVER' || block.kind === 'FULL') && <Link to={base}>{msg.viewList}</Link>}
        </p>
      )}
      {topError && (
        <div className="form-banner form-banner--error" tabIndex={-1} ref={bannerRef}>
          {topError.message}
          {topError.showListLink && (
            <>
              {' '}
              <Link to={base}>{msg.viewList}</Link>
            </>
          )}
        </div>
      )}

      <form onSubmit={(e) => void handleSubmit(e)} noValidate className="ua-form">
        <section aria-labelledby="ua-section-file" className="settings-card">
          <h3 id="ua-section-file">{msg.sectionFile}</h3>
          <p className="form-banner form-banner--info">{msg.maskNotice}</p>
          <TemplateDownloadButtons chatbotId={chatbot.id} />
          <FileUploadField
            id="ua-file"
            label={msg.fileLabel}
            accept=".xlsx,.csv"
            maxSizeBytes={maxFileBytes}
            file={file}
            onFileSelected={handleFileSelected}
            uploading={false}
            helpText={msg.fileHelp(formatBytes(maxFileBytes), maxRows.toLocaleString('ko-KR'))}
            errorMessage={fileError}
          />
          {preview.status === 'loading' && <AsyncJobProgress label={msg.previewing} />}
          {preview.status === 'ready' && (
            <div className="ua-preview">
              <p role="status" className="sr-only">
                {msg.previewDone(preview.data.validCount)}
              </p>
              <UploadPreviewTable counts={preview.data} maxChars={maxChars} />
              <p className="field-hint">{msg.previewExcludedHint}</p>
              {tooFew && (
                <>
                  <p className="field-hint">{msg.tooFewInfo(tooFew.validCount, tooFew.maxMin)}</p>
                  <p className="form-banner form-banner--warning">
                    <SeverityBadge severity="WARNING" label={msg.tooFewWarning} />
                  </p>
                </>
              )}
            </div>
          )}
        </section>

        <section aria-labelledby="ua-section-conditions" className="settings-card">
          <h3 id="ua-section-conditions">{msg.sectionConditions}</h3>
          <AnalysisConditionsForm values={values} errors={errors} capability={cap} disabled={submitting} onChange={patchValues} />
        </section>

        <p className="field-hint">{msg.beforeSubmitNote}</p>
        <div className="ua-form-actions">
          <Link to={base} className="btn btn-secondary" onClick={handleCancel}>
            {msg.cancelToList}
          </Link>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={submitting}
            aria-disabled={block ? 'true' : undefined}
            aria-describedby={block ? 'ua-new-block-reason' : undefined}
          >
            {submitting ? (
              <>
                <span className="spinner" aria-hidden="true" /> {msg.submitting}
              </>
            ) : (
              msg.submit
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
