import { useRef, useState } from 'react';
import { InlineFieldError } from './InlineFieldError';
import { MESSAGES } from '../constants/messages';

export interface FileUploadFieldProps {
  id: string;
  label: string;
  accept: string;
  maxSizeBytes: number;
  file: File | null;
  onFileSelected: (file: File | null) => void;
  uploading?: boolean;
  progressLabel?: string;
  errorMessage?: string;
  helpText?: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * 파일 업로드 + 진행/오류 표시(ui-spec §2.2-1). 드래그앤드롭은 보조 수단으로만 허용하고,
 * `<label htmlFor>` + 숨김 `<input type="file">`로 키보드/스크린리더 접근을 보장한다(UIUX §3, §5).
 */
export function FileUploadField({
  id,
  label,
  accept,
  maxSizeBytes,
  file,
  onFileSelected,
  uploading = false,
  progressLabel,
  errorMessage,
  helpText,
}: FileUploadFieldProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState<string | undefined>(undefined);
  const errorId = `${id}-error`;
  const displayError = errorMessage ?? localError;

  /** 확장자/용량 사전검증(NFR-S1과 별개의 즉시 피드백) — 실패하면 파일을 반영하지 않는다. */
  function validateAndSelect(selected: File | null): void {
    if (!selected) {
      setLocalError(undefined);
      onFileSelected(null);
      return;
    }
    const allowed = accept.split(',').map((s) => s.trim().toLowerCase());
    const lowerName = selected.name.toLowerCase();
    const extOk = allowed.some((ext) => lowerName.endsWith(ext));
    if (!extOk) {
      setLocalError(`${accept} 형식의 파일만 업로드할 수 있습니다.`);
      onFileSelected(null);
      return;
    }
    if (selected.size > maxSizeBytes) {
      setLocalError(`파일은 최대 ${formatSize(maxSizeBytes)}까지 올릴 수 있습니다.`);
      onFileSelected(null);
      return;
    }
    setLocalError(undefined);
    onFileSelected(selected);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>): void {
    validateAndSelect(e.target.files?.[0] ?? null);
  }

  function handleRemove(): void {
    setLocalError(undefined);
    onFileSelected(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <div className="form-field file-upload-field">
      <label htmlFor={id} className="file-upload-label-trigger btn btn-secondary" aria-disabled={uploading}>
        {MESSAGES.dialogue.bulkImport.selectFile}
      </label>
      <span className="sr-only">{label}</span>
      <input
        id={id}
        ref={inputRef}
        type="file"
        accept={accept}
        disabled={uploading}
        onChange={handleChange}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const dropped = e.dataTransfer.files?.[0];
          if (dropped) validateAndSelect(dropped);
        }}
        className="file-upload-input"
        aria-describedby={[helpText ? `${id}-help` : '', displayError ? errorId : ''].filter(Boolean).join(' ') || undefined}
        aria-invalid={Boolean(displayError)}
      />
      <div className="file-upload-status">
        {file ? (
          <>
            <span className="file-upload-filename">
              {file.name} ({formatSize(file.size)})
            </span>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleRemove}
              disabled={uploading}
              aria-label={MESSAGES.dialogue.bulkImport.removeFile}
            >
              {MESSAGES.dialogue.bulkImport.removeFile}
            </button>
          </>
        ) : (
          <span className="file-upload-empty">{MESSAGES.dialogue.bulkImport.noFileSelected}</span>
        )}
      </div>
      {uploading && (
        <p role="status" aria-live="polite" className="file-upload-progress">
          <span aria-hidden="true" className="spinner" /> {progressLabel}
        </p>
      )}
      {helpText && (
        <p id={`${id}-help`} className="field-hint">
          {helpText}
        </p>
      )}
      <InlineFieldError id={errorId} message={displayError} />
    </div>
  );
}
