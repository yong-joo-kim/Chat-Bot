import { useState } from 'react';
import type { ImportCommitResult, ImportErrorPolicy, ImportMergePolicy, ImportResourceType, ImportValidateResult, Topic } from '@chat-bot/shared-types';
import { escapeCsvCell, IMPORT_LIMITS } from '@chat-bot/shared-types';
import { Modal } from '../../../components/Modal';
import { FileUploadField } from '../../../components/FileUploadField';
import { ImportValidationReportTable } from '../../../components/ImportValidationReportTable';
import { AutoSnapshotPreNotice } from '../../../components/AutoSnapshotPreNotice';
import { AutoSnapshotNotice } from '../../../components/AutoSnapshotNotice';
import { ScheduleConflictBanner } from '../../../components/ScheduleConflictBanner';
import { TopicSelectField } from '../../../components/TopicSelectField';
import { useToast } from '../../../components/Toast';
import { MESSAGES } from '../../../constants/messages';
import { intentsApi, keywordsApi, faqsApi } from '../../../api/dialogue';
import { ApiError } from '../../../api/client';

type ImportApi = {
  importValidate: (chatbotId: string, formData: FormData) => Promise<ImportValidateResult>;
  importCommit: (
    chatbotId: string,
    dto: { importToken: string; mergePolicy: ImportMergePolicy; errorPolicy: ImportErrorPolicy; newItemTopicId?: string | null },
  ) => Promise<ImportCommitResult>;
  templateUrl: (chatbotId: string, format: 'csv' | 'xlsx') => string;
};

export interface BulkImportModalProps {
  resourceType: ImportResourceType;
  chatbotId: string;
  isOpen: boolean;
  onClose: () => void;
  onCommitted: () => void;
  /**
   * `TEST_CASE`(검증/품질 고도화, No.19)처럼 `chatbotId` 외에 추가 스코프(세트 ID)가 필요한
   * 소비자를 위한 API 오버라이드(ui-spec §4.2.2 — TC 업로드는 `test-sets/:setId/cases/import/*`).
   */
  apiOverride?: ImportApi;
  /** TC 업로드는 "기존 항목과 이름이 겹칠 때" 개념이 없다(§4.2.2) — true면 정책 라디오를 숨기고 'MERGE'로 고정 전송한다. */
  hideMergePolicy?: boolean;
  /** [신규 No.22] `INTENT`/`KEYWORD`/`FAQ`일 때만 "신규 항목의 토픽" 선택을 렌더한다(§3.6). `TEST_CASE`는 대상이 아니다. */
  topics?: Topic[];
}

const API_BY_TYPE = {
  INTENT: intentsApi,
  KEYWORD: keywordsApi,
  FAQ: faqsApi,
} as const;

const TITLE_BY_TYPE: Record<ImportResourceType, string> = {
  INTENT: MESSAGES.dialogue.bulkImport.titleIntent,
  KEYWORD: MESSAGES.dialogue.bulkImport.titleKeyword,
  FAQ: MESSAGES.dialogue.bulkImport.titleFaq,
  TEST_CASE: MESSAGES.dialogue.bulkImport.titleTestCase,
};

function buildErrorCsv(errors: ImportValidateResult['errors']): string {
  const header = ['row', 'column', 'value', 'code', 'message'].join(',');
  const rows = errors.map((e) => [e.row, e.column, escapeCsvCell(e.value), e.code, escapeCsvCell(e.message)].join(','));
  return [header, ...rows].join('\r\n');
}

function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([`﻿${content}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** D2c/D5b — 의도·키워드·FAQ 공용 대량 업로드 3단계 모달(ui-spec §4.4). */
export function BulkImportModal({
  resourceType,
  chatbotId,
  isOpen,
  onClose,
  onCommitted,
  apiOverride,
  hideMergePolicy = false,
  topics,
}: BulkImportModalProps): JSX.Element {
  const msg = MESSAGES.dialogue.bulkImport;
  const { showToast } = useToast();
  const api: ImportApi = apiOverride ?? API_BY_TYPE[resourceType as 'INTENT' | 'KEYWORD' | 'FAQ'];
  // [신규 No.22] 노드·컨텍스트·동음이의어는 이 절 대상이 아니다(§3.6) — `topics` prop을 준 소비자만 렌더한다.
  const showTopicField = topics !== undefined && resourceType !== 'TEST_CASE';

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [file, setFile] = useState<File | null>(null);
  const [validating, setValidating] = useState(false);
  const [fileError, setFileError] = useState<string | undefined>(undefined);
  const [result, setResult] = useState<ImportValidateResult | null>(null);
  const [mergePolicy, setMergePolicy] = useState<ImportMergePolicy>('MERGE');
  const [errorPolicy, setErrorPolicy] = useState<ImportErrorPolicy>('SKIP_INVALID');
  const [newItemTopicId, setNewItemTopicId] = useState<string | null>(null);
  const [tokenExpiredBanner, setTokenExpiredBanner] = useState(false);
  const [abortedBanner, setAbortedBanner] = useState<number | null>(null);
  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState<ImportCommitResult | null>(null);

  function resetAndClose(): void {
    setStep(1);
    setFile(null);
    setResult(null);
    setCommitResult(null);
    setFileError(undefined);
    setTokenExpiredBanner(false);
    setAbortedBanner(null);
    setMergePolicy('MERGE');
    setErrorPolicy('SKIP_INVALID');
    setNewItemTopicId(null);
    onClose();
  }

  async function handleValidate(): Promise<void> {
    if (!file) return;
    setValidating(true);
    setFileError(undefined);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await api.importValidate(chatbotId, formData);
      setResult(res);
      setStep(2);
      setTokenExpiredBanner(false);
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'IMPORT_TOO_LARGE' || e.code === 'IMPORT_FILE_INVALID')) {
        setFileError(e.message);
      } else {
        showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
      }
    } finally {
      setValidating(false);
    }
  }

  async function handleCommit(): Promise<void> {
    if (!result) return;
    setCommitting(true);
    setAbortedBanner(null);
    try {
      const res = await api.importCommit(chatbotId, {
        importToken: result.importToken,
        mergePolicy: hideMergePolicy ? 'MERGE' : mergePolicy,
        errorPolicy,
        newItemTopicId: showTopicField ? newItemTopicId : undefined,
      });
      setCommitResult(res);
      setStep(3);
      onCommitted();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'IMPORT_TOKEN_EXPIRED') {
        setTokenExpiredBanner(true);
      } else if (e instanceof ApiError && e.code === 'IMPORT_ABORTED') {
        setAbortedBanner(result.errors.length);
      } else {
        showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
      }
    } finally {
      setCommitting(false);
    }
  }

  function handleRevalidate(): void {
    setTokenExpiredBanner(false);
    setStep(1);
  }

  return (
    <Modal isOpen={isOpen} title={TITLE_BY_TYPE[resourceType]} onClose={resetAndClose} closeOnEsc={!validating && !committing}>
      <p className="import-wizard-steps" role="status">
        <span className={step === 1 ? 'import-wizard-step--current' : undefined}>{msg.step(1, msg.step1Label)}</span>
        {' · '}
        <span className={step === 2 ? 'import-wizard-step--current' : undefined}>{msg.step(2, msg.step2Label)}</span>
        {' · '}
        <span className={step === 3 ? 'import-wizard-step--current' : undefined}>{msg.step(3, msg.step3Label)}</span>
      </p>

      {step === 1 && (
        <div>
          {resourceType !== 'TEST_CASE' && (
            <>
              <AutoSnapshotPreNotice text={msg.autoSnapshotPreNotice} />
              <ScheduleConflictBanner chatbotId={chatbotId} />
            </>
          )}
          <p>{msg.templateIntro}</p>
          <div className="dialogue-toolbar-actions" style={{ marginBottom: 16 }}>
            <a className="btn btn-secondary" href={api.templateUrl(chatbotId, 'csv')}>
              {msg.templateDownloadCsv}
            </a>
            <a className="btn btn-secondary" href={api.templateUrl(chatbotId, 'xlsx')}>
              {msg.templateDownloadXlsx}
            </a>
          </div>
          <p>{msg.uploadIntro}</p>
          <FileUploadField
            id="bulk-import-file"
            label={msg.fileLabel}
            accept=".csv,.xlsx"
            maxSizeBytes={IMPORT_LIMITS.maxFileBytes}
            file={file}
            onFileSelected={setFile}
            uploading={validating}
            progressLabel={msg.validating}
            errorMessage={fileError}
            helpText={msg.fileHelp}
          />
          <div className="import-wizard-actions">
            <button type="button" className="btn btn-secondary" onClick={resetAndClose} disabled={validating}>
              {MESSAGES.common.cancel}
            </button>
            <button type="button" className="btn btn-primary" onClick={handleValidate} disabled={!file || validating}>
              {validating ? msg.validating : msg.validateButton}
            </button>
          </div>
        </div>
      )}

      {step === 2 && result && (
        <div>
          {tokenExpiredBanner && (
            <div className="form-banner form-banner--error" role="alert">
              {msg.tokenExpiredBanner}{' '}
              <button type="button" className="link-button" onClick={handleRevalidate}>
                {msg.revalidate}
              </button>
            </div>
          )}
          {abortedBanner !== null && (
            <div className="form-banner form-banner--error" role="alert">
              {msg.abortedBanner(abortedBanner)}
            </div>
          )}
          <ImportValidationReportTable
            summary={{
              totalRows: result.totalRows,
              newItems: result.newItems,
              updatedItems: result.updatedItems,
              newValues: result.newValues,
              duplicatedRows: result.duplicatedRows,
            }}
            errors={result.errors}
            conflicts={result.conflicts}
          />

          {!hideMergePolicy && (
            <fieldset className="form-field" style={{ border: 'none', padding: 0, marginTop: 16 }}>
              <legend className="field-label-static">{msg.mergePolicyLabel}</legend>
              <label className="form-field--inline">
                <input type="radio" name="mergePolicy" checked={mergePolicy === 'MERGE'} onChange={() => setMergePolicy('MERGE')} />
                {msg.mergePolicyMerge} — {msg.mergePolicyMergeDesc}
              </label>
              <label className="form-field--inline">
                <input type="radio" name="mergePolicy" checked={mergePolicy === 'REPLACE'} onChange={() => setMergePolicy('REPLACE')} />
                {msg.mergePolicyReplace} — {msg.mergePolicyReplaceDesc}
              </label>
              <label className="form-field--inline">
                <input type="radio" name="mergePolicy" checked={mergePolicy === 'SKIP'} onChange={() => setMergePolicy('SKIP')} />
                {msg.mergePolicySkip} — {msg.mergePolicySkipDesc}
              </label>
            </fieldset>
          )}

          <fieldset className="form-field" style={{ border: 'none', padding: 0 }}>
            <legend className="field-label-static">{msg.errorPolicyLabel}</legend>
            <label className="form-field--inline">
              <input
                type="radio"
                name="errorPolicy"
                checked={errorPolicy === 'SKIP_INVALID'}
                onChange={() => setErrorPolicy('SKIP_INVALID')}
              />
              {msg.errorPolicySkip} — {msg.errorPolicySkipDesc}
            </label>
            <label className="form-field--inline">
              <input
                type="radio"
                name="errorPolicy"
                checked={errorPolicy === 'ABORT_ON_ERROR'}
                onChange={() => setErrorPolicy('ABORT_ON_ERROR')}
              />
              {msg.errorPolicyAbort} — {msg.errorPolicyAbortDesc}
            </label>
          </fieldset>

          {showTopicField && (
            <>
              <TopicSelectField
                id="bulk-import-new-item-topic"
                label={MESSAGES.topics.importNewItemTopicLabel}
                topics={topics ?? []}
                value={newItemTopicId}
                onChange={setNewItemTopicId}
              />
              <p className="field-hint">
                <span aria-hidden="true">ⓘ</span> {MESSAGES.topics.importExistingItemTopicHint}
              </p>
            </>
          )}

          <div className="import-wizard-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setStep(1)} disabled={committing}>
              {msg.previousButton}
            </button>
            <button type="button" className="btn btn-secondary" onClick={resetAndClose} disabled={committing}>
              {MESSAGES.common.cancel}
            </button>
            {result.errors.length > 0 && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => downloadCsv('import-errors.csv', buildErrorCsv(result.errors))}
              >
                {msg.errorCsvDownload}
              </button>
            )}
            <button type="button" className="btn btn-primary" onClick={handleCommit} disabled={committing}>
              {committing ? msg.committing : msg.commitButton}
            </button>
          </div>
        </div>
      )}

      {step === 3 && commitResult && (
        <div>
          <p role="status">
            <span aria-hidden="true">✔</span> {msg.commitSuccessTitle} {msg.commitResultCreated(commitResult.createdItems)} ·{' '}
            {msg.commitResultUpdated(commitResult.updatedItems)} · {msg.commitResultValues(commitResult.createdValues)} ·{' '}
            {msg.commitResultSkipped(commitResult.skippedRows)}
          </p>
          <AutoSnapshotNotice
            outcome={commitResult.autoSnapshot}
            chatbotId={chatbotId}
            createdText={msg.autoSnapshotCreated}
            viewLinkText={msg.autoSnapshotViewLink}
            failedText={msg.autoSnapshotFailed}
          />
          {commitResult.errors.length > 0 && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => downloadCsv('import-errors.csv', buildErrorCsv(commitResult.errors))}
            >
              {msg.errorCsvDownload}
            </button>
          )}
          <div className="import-wizard-actions">
            <button type="button" className="btn btn-primary" onClick={resetAndClose}>
              {MESSAGES.common.close}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
