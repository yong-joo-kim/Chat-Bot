import { useMemo, useState, type FormEvent } from 'react';
import type { KbAuth, KbFileType, KbSchedule, KbSourceCreateDto, KbSourceResponse } from '@chat-bot/shared-types';
import { KB_SYNC_LIMITS } from '@chat-bot/shared-types';
import { Modal } from '../../../components/Modal';
import { InlineFieldError } from '../../../components/InlineFieldError';
import { RagScopeFields } from '../../chatbot-detail/answer-settings/RagScopeFields';
import { kbSourcesApi } from '../../../api/kbSources';
import { ApiError } from '../../../api/client';
import { MESSAGES } from '../../../constants/messages';
import { KbStringListField } from './KbStringListField';
import { KbScheduleField } from './KbScheduleField';
import { KbAuthField } from './KbAuthField';

export interface KbSourceEditModalProps {
  isOpen: boolean;
  source: KbSourceResponse | null;
  onClose: () => void;
  onSaved: () => void;
}

const FILE_TYPES: KbFileType[] = ['PDF', 'DOCX', 'XLSX', 'PPTX'];

function authFromSource(source: KbSourceResponse | null): KbAuth {
  if (source?.authKind === 'STATIC_HEADER') return { kind: 'STATIC_HEADER', headerName: source.authHeaderName ?? '', secretRef: source.authSecretRef ?? '' };
  return { kind: 'NONE' };
}

/** 순서 상관없이 같은 항목 집합인지(체크박스·목록 편집 중 순서만 바뀌는 경우를 "변경"으로 오판하지 않는다). */
function sameItems(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((v, i) => v === sortedB[i]);
}

/**
 * KB6 — 소스 등록·수정 모달(`kb-crawling-ui-spec.md` §3.2). `ApiConnectionEditModal`(No.26)과
 * 동형 — 저장 실패 시 `err.details`를 필드 오류로 매핑하고, `KB_SOURCE_BUSY`(실행 중 수정 시도)는
 * 배너로 안내하며 값은 그대로 보존한다(모달 유지).
 */
export function KbSourceEditModal({ isOpen, source, onClose, onSaved }: KbSourceEditModalProps): JSX.Element {
  const msg = MESSAGES.kbSources;
  const editing = source;

  const [name, setName] = useState(editing?.name ?? '');
  const [seedUrls, setSeedUrls] = useState<string[]>(editing?.seedUrls && editing.seedUrls.length > 0 ? editing.seedUrls : ['']);
  const [sitemapUrls, setSitemapUrls] = useState<string[]>(editing?.sitemapUrls ?? []);
  const [pathPrefixes, setPathPrefixes] = useState<string[]>(editing?.pathPrefixes ?? []);
  const [excludePatterns, setExcludePatterns] = useState<string[]>(editing?.excludePatterns ?? []);
  const [noisePatterns, setNoisePatterns] = useState<string[]>(editing?.noisePatterns ?? []);
  const [maxDepth, setMaxDepth] = useState(editing?.maxDepth ?? KB_SYNC_LIMITS.defaultDepth);
  const [maxPages, setMaxPages] = useState(editing?.maxPages ?? KB_SYNC_LIMITS.defaultMaxPages);
  const [fileTypes, setFileTypes] = useState<KbFileType[]>(editing?.fileTypes ?? []);
  const [maxFileMb, setMaxFileMb] = useState(Math.round((editing?.maxFileBytes ?? KB_SYNC_LIMITS.defaultMaxFileBytes) / (1024 * 1024)));
  const [company, setCompany] = useState(editing?.scope.company ?? '');
  const [category, setCategory] = useState(editing?.scope.category ?? '');
  const [subcategory, setSubcategory] = useState(editing?.scope.subcategory ?? '');
  const [schedule, setSchedule] = useState<KbSchedule>(editing?.schedule ?? { kind: 'MANUAL' });
  const [auth, setAuth] = useState<KbAuth>(authFromSource(editing));
  const [piiMask, setPiiMask] = useState(editing?.piiMask ?? true);
  const [allowRawFileIngest, setAllowRawFileIngest] = useState(editing?.allowRawFileIngest ?? false);
  // 화면 명세(§3.2)에 컨트롤이 없는 고급 옵션 — UI 없이 소스의 실제 값을 그대로 유지해 다시 보낸다
  // (API로 `true`를 저장한 소스를 콘솔에서 저장해도 값이 `false`로 덮이거나 `configVersion`이 오르지 않게).
  const [allowQueryUrls] = useState(editing?.allowQueryUrls ?? false);
  const [rightsConfirmed, setRightsConfirmed] = useState(Boolean(editing));

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  // [3차 보완] 저장 응답 `warnings[]`(스코프 경고) — 저장 자체는 성공했으므로 폼을 되돌리지 않고,
  // 경고를 확인시킨 뒤에만 `onSaved()`를 호출해 모달을 닫는다(§3.2 "저장은 성공 + 배너").
  const [savedWithWarnings, setSavedWithWarnings] = useState<KbSourceResponse | null>(null);

  function toggleFileType(t: KbFileType): void {
    setFileTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }

  // [No.43 R1 Low] "저장하면 다시 미리보기가 필요합니다" 안내는 범위 필드(`CONFIG_AFFECTING_FIELDS`,
  // `kb-sources.service.ts`와 같은 목록)가 실제로 바뀌었을 때만 보여준다 — 수정 모달을 열기만 해도
  // 항상 뜨는 것은 오도한다.
  const rangeFieldsChanged = useMemo(() => {
    if (!editing) return false;
    const cleanSeed = seedUrls.map((u) => u.trim()).filter((u) => u.length > 0);
    const cleanSitemap = sitemapUrls.map((u) => u.trim()).filter((u) => u.length > 0);
    const cleanPath = pathPrefixes.map((p) => p.trim()).filter((p) => p.length > 0);
    const cleanExclude = excludePatterns.map((p) => p.trim()).filter((p) => p.length > 0);
    const cleanNoise = noisePatterns.map((p) => p.trim()).filter((p) => p.length > 0);
    return (
      !sameItems(cleanSeed, editing.seedUrls) ||
      !sameItems(cleanSitemap, editing.sitemapUrls) ||
      !sameItems(cleanPath, editing.pathPrefixes) ||
      !sameItems(cleanExclude, editing.excludePatterns) ||
      !sameItems(cleanNoise, editing.noisePatterns) ||
      allowQueryUrls !== editing.allowQueryUrls ||
      maxDepth !== editing.maxDepth ||
      maxPages !== editing.maxPages ||
      !sameItems(fileTypes, editing.fileTypes) ||
      maxFileMb * 1024 * 1024 !== editing.maxFileBytes ||
      company.trim() !== editing.scope.company ||
      category.trim() !== editing.scope.category ||
      subcategory.trim() !== editing.scope.subcategory ||
      piiMask !== editing.piiMask ||
      allowRawFileIngest !== editing.allowRawFileIngest
    );
  }, [
    editing,
    seedUrls,
    sitemapUrls,
    pathPrefixes,
    excludePatterns,
    noisePatterns,
    allowQueryUrls,
    maxDepth,
    maxPages,
    fileTypes,
    maxFileMb,
    company,
    category,
    subcategory,
    piiMask,
    allowRawFileIngest,
  ]);

  function hostErrorFromDetail(message?: string): string | undefined {
    switch (message) {
      case 'DNS_FAILED':
        return msg.errorHostDnsFailed;
      case 'ABSOLUTE_BLOCKED':
        return msg.errorHostAbsoluteBlocked;
      case 'PRIVATE_NOT_ALLOWLISTED':
        return msg.errorHostPrivateNotAllowlisted;
      // [No.43 R1 M2] `KB_HOST_NOT_ALLOWED`의 네 번째 사유(개발명세서 §11) — 형식이 유효하지 않은 URL.
      case 'INVALID_URL':
        return msg.errorSeedUrlInvalidScheme;
      default:
        return undefined;
    }
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBanner(undefined);
    const nextFieldErrors: Record<string, string> = {};

    const trimmedName = name.trim();
    if (!trimmedName) nextFieldErrors.name = msg.errorNameRequired;
    else if (trimmedName.length > KB_SYNC_LIMITS.nameMax) nextFieldErrors.name = msg.errorNameTooLong;

    const cleanSeedUrls = seedUrls.map((u) => u.trim()).filter((u) => u.length > 0);
    if (cleanSeedUrls.length === 0) nextFieldErrors.seedUrls = msg.errorSeedUrlRequired;
    // [No.43 R1 M2] 서버 왕복 없이 http(s) 스킴을 클라이언트에서 먼저 검증한다.
    else if (cleanSeedUrls.some((u) => !/^https?:\/\//i.test(u))) nextFieldErrors.seedUrls = msg.errorSeedUrlInvalidScheme;

    // `KbSourceScopeSchema`는 3단 모두 필수다(RAG 답변 설정 스코프와 달리 category도 필수) — 실제 계약 기준.
    if (!company.trim()) nextFieldErrors.scopeCompany = msg.errorScopeCompanyRequired;
    if (!category.trim()) nextFieldErrors.scopeCategory = msg.errorScopeCategoryRequired;
    if (!subcategory.trim()) nextFieldErrors.scopeSubcategory = msg.errorScopeSubcategoryRequired;

    if (!editing && !rightsConfirmed) nextFieldErrors.rightsConfirmed = msg.formRightsConfirmError;

    if (Object.keys(nextFieldErrors).length > 0) {
      setFieldErrors(nextFieldErrors);
      return;
    }

    setSubmitting(true);
    setFieldErrors({});
    try {
      const base = {
        name: trimmedName,
        seedUrls: cleanSeedUrls,
        sitemapUrls: sitemapUrls.map((u) => u.trim()).filter((u) => u.length > 0),
        pathPrefixes: pathPrefixes.map((p) => p.trim()).filter((p) => p.length > 0),
        excludePatterns: excludePatterns.map((p) => p.trim()).filter((p) => p.length > 0),
        noisePatterns: noisePatterns.map((p) => p.trim()).filter((p) => p.length > 0),
        // 화면 명세(KB6 목업)에 없어 UI를 두지 않은 고급 옵션 — 수정 시 소스의 현재 값, 등록 시 서버 기본값(false).
        allowQueryUrls,
        minIntervalMs: KB_SYNC_LIMITS.defaultIntervalMs,
        maxDepth,
        maxPages,
        fileTypes,
        maxFileBytes: maxFileMb * 1024 * 1024,
        scope: { company: company.trim(), category: category.trim(), subcategory: subcategory.trim() },
        schedule,
        auth,
        piiMask,
        allowRawFileIngest,
      };
      const saved = editing
        ? await kbSourcesApi.update(editing.id, base)
        : await kbSourcesApi.create({ ...base, rightsConfirmed: true } satisfies KbSourceCreateDto);
      if (saved.warnings && saved.warnings.length > 0) {
        setSavedWithWarnings(saved);
      } else {
        onSaved();
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'DUPLICATE_NAME') {
        setFieldErrors({ name: msg.errorNameDuplicate });
      } else if (err instanceof ApiError && err.code === 'KB_SOURCE_BUSY') {
        setBanner(msg.sourceBusyError);
      } else if (err instanceof ApiError && err.code === 'LIMIT_EXCEEDED') {
        setBanner(msg.errorLimitExceeded(KB_SYNC_LIMITS.maxSources));
      } else if (err instanceof ApiError && err.code === 'EGRESS_HOST_NOT_ALLOWED') {
        setFieldErrors({ seedUrls: msg.errorHostEgressBlocked });
      } else if (err instanceof ApiError && err.code === 'KB_HOST_NOT_ALLOWED' && err.details && err.details.length > 0) {
        const mapped = hostErrorFromDetail(err.details[0].message);
        setFieldErrors({ seedUrls: mapped ?? err.message });
      } else if (err instanceof ApiError && err.code === 'VALIDATION_FAILED' && err.details?.some((d) => d.field === 'auth.headerName')) {
        setFieldErrors({ authHeaderName: msg.errorHeaderNameForbidden });
      } else if (err instanceof ApiError && err.code === 'VALIDATION_FAILED' && err.details?.some((d) => d.field === 'piiMask')) {
        // [No.43 R2 M5] 거버넌스 모드 ON에서 마스킹을 끄려는 시도 — `details[].field`로 판별한다
        // (서버가 `{ field: 'piiMask', message: 'GOVERNANCE_MASK_REQUIRED' }`를 함께 준다).
        setFieldErrors({ piiMask: msg.errorMaskOffGovernance });
      } else if (err instanceof ApiError && err.code === 'VALIDATION_FAILED' && err.details?.some((d) => d.field === 'allowRawFileIngest')) {
        setFieldErrors({ allowRawFileIngest: msg.errorRawFileOffServer });
      } else if (err instanceof ApiError) {
        setBanner(err.message);
      } else {
        setBanner(MESSAGES.errors.generic);
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (savedWithWarnings) {
    return (
      <Modal isOpen={isOpen} title={editing ? msg.modalEditTitle(editing.name) : msg.modalCreateTitle} onClose={onSaved}>
        <p className="form-banner form-banner--info" role="status">
          {msg.saveWarningsBannerTitle}
        </p>
        <ul>
          {savedWithWarnings.warnings?.map((w) => (
            <li key={w.code}>{msg.scopeWarningLabel[w.code]}</li>
          ))}
        </ul>
        <div className="modal-actions">
          <button type="button" className="btn btn-primary" onClick={onSaved}>
            {MESSAGES.common.confirm}
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal isOpen={isOpen} title={editing ? msg.modalEditTitle(editing.name) : msg.modalCreateTitle} onClose={onClose}>
      <form onSubmit={handleSubmit} noValidate>
        {banner && (
          <p className="form-banner form-banner--error" role="alert">
            {banner}
          </p>
        )}
        <div className="form-field">
          <label htmlFor="kb-source-name">
            {msg.formNameLabel} <span className="required-mark" aria-hidden="true">*</span>
          </label>
          <input id="kb-source-name" type="text" required maxLength={KB_SYNC_LIMITS.nameMax} autoFocus value={name} onChange={(e) => setName(e.target.value)} aria-invalid={Boolean(fieldErrors.name)} />
          <InlineFieldError id="kb-source-name-error" message={fieldErrors.name} />
        </div>

        <h3>{msg.formSectionSeed}</h3>
        <KbStringListField
          legend={msg.formSeedUrlsLabel}
          values={seedUrls}
          onChange={setSeedUrls}
          maxItems={KB_SYNC_LIMITS.seedUrlsMax}
          addLabel={msg.formAddSeedUrl}
          addLimitLabel={msg.formSeedUrlsLimitHint}
          itemLabel={msg.formSeedUrlItemLabel}
          inputType="url"
          disabled={submitting}
        />
        <InlineFieldError id="kb-source-seed-urls-error" message={fieldErrors.seedUrls} />
        <KbStringListField
          legend={msg.formSitemapLabel}
          values={sitemapUrls}
          onChange={setSitemapUrls}
          maxItems={KB_SYNC_LIMITS.sitemapUrlsMax}
          addLabel={msg.formAddSitemapUrl}
          itemLabel={(i) => `${i + 1}번째 사이트맵 주소`}
          inputType="url"
          disabled={submitting}
          hint={msg.formSitemapHelp}
        />

        <h3>{msg.formSectionScopeRange}</h3>
        <KbStringListField
          legend={msg.formPathPrefixLabel}
          values={pathPrefixes}
          onChange={setPathPrefixes}
          maxItems={KB_SYNC_LIMITS.pathPrefixesMax}
          addLabel={msg.formAddPathPrefix}
          itemLabel={(i) => `${i + 1}번째 경로 접두`}
          disabled={submitting}
          hint={msg.formPathPrefixHint}
        />
        <KbStringListField
          legend={msg.formExcludeLabel}
          values={excludePatterns}
          onChange={setExcludePatterns}
          maxItems={KB_SYNC_LIMITS.excludePatternsMax}
          addLabel={msg.formAddExcludePattern}
          itemLabel={(i) => `${i + 1}번째 제외 패턴`}
          disabled={submitting}
        />
        <KbStringListField
          legend={msg.formNoisePatternLabel}
          values={noisePatterns}
          onChange={setNoisePatterns}
          maxItems={KB_SYNC_LIMITS.noisePatternsMax}
          addLabel={msg.formAddNoisePattern}
          itemLabel={(i) => `${i + 1}번째 잡음 줄 패턴`}
          disabled={submitting}
        />

        <div className="key-value-row">
          <div className="form-field">
            <label htmlFor="kb-source-max-depth">{msg.formMaxDepthLabel}</label>
            <input
              id="kb-source-max-depth"
              type="number"
              min={0}
              max={KB_SYNC_LIMITS.maxDepthMax}
              value={maxDepth}
              disabled={submitting}
              onChange={(e) => setMaxDepth(Number(e.target.value))}
            />
          </div>
          <div className="form-field">
            <label htmlFor="kb-source-max-pages">{msg.formMaxPagesLabel}</label>
            <input id="kb-source-max-pages" type="number" min={1} value={maxPages} disabled={submitting} onChange={(e) => setMaxPages(Number(e.target.value))} />
          </div>
          <div className="form-field">
            <label htmlFor="kb-source-max-file-mb">{msg.formMaxFileBytesLabel}</label>
            <input
              id="kb-source-max-file-mb"
              type="number"
              min={1}
              value={maxFileMb}
              disabled={submitting}
              onChange={(e) => setMaxFileMb(Number(e.target.value))}
            />
          </div>
        </div>

        <fieldset className="form-field">
          <legend>{msg.formFileTypesLabel}</legend>
          {FILE_TYPES.map((t) => (
            <label key={t} className="form-field--inline">
              <input type="checkbox" checked={fileTypes.includes(t)} disabled={submitting} onChange={() => toggleFileType(t)} />
              {t}
            </label>
          ))}
        </fieldset>
        <p className="field-hint">{msg.formRobotsAlwaysOnLabel}</p>

        <h3>{msg.formSectionScopeIngest}</h3>
        <RagScopeFields
          ragEnabled
          company={company}
          category={category}
          subcategory={subcategory}
          onChangeCompany={setCompany}
          onChangeCategory={setCategory}
          onChangeSubcategory={setSubcategory}
          disabled={submitting}
          companyError={fieldErrors.scopeCompany}
          subcategoryError={fieldErrors.scopeSubcategory}
        />
        <InlineFieldError id="kb-source-scope-category-error" message={fieldErrors.scopeCategory} />
        <p className="field-hint">{msg.formScopeHelp}</p>

        <h3>{msg.formSectionScheduleAuth}</h3>
        <KbScheduleField value={schedule} onChange={setSchedule} disabled={submitting} />
        <KbAuthField value={auth} onChange={setAuth} disabled={submitting} headerNameError={fieldErrors.authHeaderName} secretRefError={fieldErrors.authSecretRef} />

        <h3>{msg.formSectionPii}</h3>
        <div className="form-field form-field--inline">
          <input id="kb-source-pii-mask" type="checkbox" checked={piiMask} disabled={submitting} onChange={(e) => setPiiMask(e.target.checked)} />
          <label htmlFor="kb-source-pii-mask">{msg.formPiiMaskLabel}</label>
        </div>
        <InlineFieldError id="kb-source-pii-mask-error" message={fieldErrors.piiMask} />
        <div className="form-field form-field--inline">
          <input id="kb-source-raw-file" type="checkbox" checked={allowRawFileIngest} disabled={submitting} onChange={(e) => setAllowRawFileIngest(e.target.checked)} />
          <label htmlFor="kb-source-raw-file">{msg.formRawFileLabel}</label>
        </div>
        <InlineFieldError id="kb-source-raw-file-error" message={fieldErrors.allowRawFileIngest} />

        {!editing && (
          <div className="form-field form-field--inline">
            <input
              id="kb-source-rights-confirmed"
              type="checkbox"
              checked={rightsConfirmed}
              onChange={(e) => setRightsConfirmed(e.target.checked)}
              aria-invalid={Boolean(fieldErrors.rightsConfirmed)}
            />
            <label htmlFor="kb-source-rights-confirmed">
              {msg.formRightsConfirmLabel} <span className="required-mark" aria-hidden="true">*</span>
            </label>
          </div>
        )}
        {!editing && <p className="field-hint">{msg.formRightsConfirmHint}</p>}
        <InlineFieldError id="kb-source-rights-confirmed-error" message={fieldErrors.rightsConfirmed} />

        {editing && rangeFieldsChanged && <p className="field-hint">{msg.formRangeChangedNotice}</p>}

        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {MESSAGES.common.cancel}
          </button>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? MESSAGES.common.saving : MESSAGES.common.save}
          </button>
        </div>
      </form>
    </Modal>
  );
}
