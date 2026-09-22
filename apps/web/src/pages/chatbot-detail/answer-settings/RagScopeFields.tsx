import { InlineFieldError } from '../../../components/InlineFieldError';
import { SeverityBadge } from '../../../components/SeverityBadge';
import { MESSAGES } from '../../../constants/messages';

/**
 * `company`/`category`/`subcategory` 입력 그룹(ui-spec §4.1.3). `company`는 `ragEnabled`일 때만
 * 필수 표시(`*`)를 보인다. `subcategory`가 있으면 `category`가 먼저 필요하다(상호 검증).
 */
export function RagScopeFields({
  ragEnabled,
  company,
  category,
  subcategory,
  onChangeCompany,
  onChangeCategory,
  onChangeSubcategory,
  disabled,
  companyError,
  subcategoryError,
  scopeWarning,
}: {
  ragEnabled: boolean;
  company: string;
  category: string;
  subcategory: string;
  onChangeCompany: (v: string) => void;
  onChangeCategory: (v: string) => void;
  onChangeSubcategory: (v: string) => void;
  disabled?: boolean;
  companyError?: string;
  subcategoryError?: string;
  scopeWarning?: string;
}): JSX.Element {
  const msg = MESSAGES.answerSettings.rag;
  return (
    <div className="rag-scope-fields">
      <div className="form-field">
        <label htmlFor="rag-company">
          {msg.companyLabel}{' '}
          {ragEnabled && (
            <span className="required-mark" aria-hidden="true">
              *
            </span>
          )}
        </label>
        <input
          id="rag-company"
          type="text"
          value={company}
          disabled={disabled}
          maxLength={200}
          aria-describedby={companyError ? 'rag-company-error' : undefined}
          aria-invalid={Boolean(companyError)}
          onChange={(e) => onChangeCompany(e.target.value)}
        />
        <InlineFieldError id="rag-company-error" message={companyError} />
      </div>
      <div className="form-field">
        <label htmlFor="rag-category">{msg.categoryLabel}</label>
        <input id="rag-category" type="text" value={category} disabled={disabled} maxLength={200} onChange={(e) => onChangeCategory(e.target.value)} />
      </div>
      <div className="form-field">
        <label htmlFor="rag-subcategory">{msg.subcategoryLabel}</label>
        <input
          id="rag-subcategory"
          type="text"
          value={subcategory}
          disabled={disabled}
          maxLength={200}
          aria-describedby={subcategoryError ? 'rag-subcategory-error' : undefined}
          aria-invalid={Boolean(subcategoryError)}
          onChange={(e) => onChangeSubcategory(e.target.value)}
        />
        <InlineFieldError id="rag-subcategory-error" message={subcategoryError} />
      </div>
      {scopeWarning && (
        <p className="severity-badge-row">
          <SeverityBadge severity="WARNING" label={scopeWarning} />
        </p>
      )}
    </div>
  );
}
