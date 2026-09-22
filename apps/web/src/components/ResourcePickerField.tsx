import { forwardRef, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { intentsApi, keywordsApi, contextsApi, dialogNodesApi } from '../api/dialogue';
import { chatbotsApi } from '../api/chatbots';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { MESSAGES } from '../constants/messages';
import { InlineFieldError } from './InlineFieldError';

/**
 * `chatbot`은 다른 4종과 달리 어떤 챗봇 "안"의 리소스가 아니라 챗봇 자체를 검색 대상으로 삼는다
 * (security-audit-ui-spec.md §3.9 `AuditLogFilterBar`의 `chatbotId` 필터). 이 타입일 때는
 * `chatbotId` prop(스코프)이 필요 없다 — 전역 `GET /chatbots` 목록에서 바로 검색한다.
 */
export type ResourcePickerType = 'intent' | 'keyword' | 'context' | 'node' | 'chatbot';

interface Option {
  id: string;
  name: string;
}

async function searchResource(chatbotId: string, type: ResourcePickerType, q: string): Promise<Option[]> {
  const query = { q, page: 1, pageSize: 20 };
  switch (type) {
    case 'intent':
      return (await intentsApi.list(chatbotId, query)).items;
    case 'keyword':
      return (await keywordsApi.list(chatbotId, query)).items;
    case 'context':
      return (await contextsApi.list(chatbotId, query)).items;
    case 'node':
      return (await dialogNodesApi.list(chatbotId, query)).items;
    case 'chatbot':
      return (await chatbotsApi.list(query)).items;
    default:
      return [];
  }
}

async function findOneResource(chatbotId: string, type: ResourcePickerType, id: string): Promise<Option | null> {
  try {
    switch (type) {
      case 'intent':
        return await intentsApi.findOne(chatbotId, id);
      case 'keyword':
        return await keywordsApi.findOne(chatbotId, id);
      case 'context':
        return await contextsApi.findOne(chatbotId, id);
      case 'node':
        return await dialogNodesApi.findOne(chatbotId, id);
      case 'chatbot':
        return await chatbotsApi.findOne(id);
      default:
        return null;
    }
  } catch {
    return null;
  }
}

export interface ResourcePickerFieldProps {
  id: string;
  label: string;
  resourceType: ResourcePickerType;
  /** `resourceType==='chatbot'`일 때는 스코프가 필요 없으므로 생략 가능하다. */
  chatbotId?: string;
  multiple: boolean;
  value: string[] | string | null;
  onChange: (value: string[] | string | null) => void;
  excludeIds?: string[];
  createHref?: string;
  required?: boolean;
  disabled?: boolean;
  errorMessage?: string;
  helpText?: string;
}

/**
 * 검색형 리소스 선택기(ui-spec §2.2-4, FR-5-20). ID 직접 입력 UI를 노출하지 않고, 목록 API를
 * `q=`로 호출해 후보를 커스텀 콤보박스(`role="listbox"`)로 펼친다. 방향키/Enter/Esc로 조작한다.
 */
/**
 * `ref`는 입력창 DOM에 연결되어 상위 폼이 값 변경(예: 아웃풋/슬롯 타입 전환) 시
 * 포커스를 이 필드로 이동시킬 수 있게 한다(ui-spec §4.2.1 포커스 이동 규칙).
 */
export const ResourcePickerField = forwardRef<HTMLInputElement, ResourcePickerFieldProps>(function ResourcePickerField(
  {
    id,
    label,
    resourceType,
    chatbotId = '',
    multiple,
    value,
    onChange,
    excludeIds = [],
    createHref,
    required = false,
    disabled = false,
    errorMessage,
    helpText,
  },
  forwardedRef,
) {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<Option[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [nameCache, setNameCache] = useState<Record<string, string>>({});
  const debouncedQuery = useDebouncedValue(query, 300);
  const requestIdRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(forwardedRef, () => inputRef.current as HTMLInputElement);
  const listboxId = useId();
  const errorId = `${id}-error`;

  const selectedIds: string[] = useMemo(() => {
    if (multiple) return (value as string[] | null) ?? [];
    return value ? [value as string] : [];
  }, [multiple, value]);

  // 선택된 id 중 이름을 아직 모르는 항목을 조회해 칩 표시용 캐시에 채운다.
  useEffect(() => {
    const unknown = selectedIds.filter((sid) => !(sid in nameCache));
    if (unknown.length === 0) return;
    let cancelled = false;
    Promise.all(unknown.map((sid) => findOneResource(chatbotId, resourceType, sid))).then((results) => {
      if (cancelled) return;
      setNameCache((prev) => {
        const next = { ...prev };
        results.forEach((res, i) => {
          if (res) next[unknown[i]] = res.name;
        });
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds.join(','), chatbotId, resourceType]);

  useEffect(() => {
    if (!debouncedQuery) {
      setOptions([]);
      return;
    }
    const currentId = ++requestIdRef.current;
    setLoading(true);
    searchResource(chatbotId, resourceType, debouncedQuery)
      .then((results) => {
        if (requestIdRef.current !== currentId) return;
        setOptions(results.filter((r) => !excludeIds.includes(r.id) && !selectedIds.includes(r.id)));
        setActiveIndex(-1);
      })
      .finally(() => {
        if (requestIdRef.current === currentId) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, chatbotId, resourceType]);

  function selectOption(opt: Option): void {
    setNameCache((prev) => ({ ...prev, [opt.id]: opt.name }));
    if (multiple) {
      onChange([...selectedIds, opt.id]);
    } else {
      onChange(opt.id);
    }
    setQuery('');
    setOptions([]);
    setOpen(false);
    setActiveIndex(-1);
    inputRef.current?.focus();
  }

  function removeSelected(sid: string): void {
    if (multiple) {
      onChange(selectedIds.filter((v) => v !== sid));
    } else {
      onChange(null);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      setActiveIndex((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && activeIndex >= 0 && options[activeIndex]) {
        e.preventDefault();
        selectOption(options[activeIndex]);
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setOpen(false);
        setActiveIndex(-1);
      }
    }
  }

  const showSingleSelected = !multiple && selectedIds.length > 0;
  const activeOptionId = activeIndex >= 0 ? `${listboxId}-opt-${activeIndex}` : undefined;

  return (
    <div className="form-field resource-picker-field">
      <label htmlFor={id}>
        {label} {required && <span className="required-mark" aria-hidden="true">*</span>}
      </label>
      {!showSingleSelected && (
        <div className="resource-picker-combobox">
          <input
            id={id}
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-activedescendant={activeOptionId}
            aria-autocomplete="list"
            autoComplete="off"
            disabled={disabled}
            placeholder={MESSAGES.dialogue.picker.searchPlaceholder(label)}
            value={query}
            aria-describedby={errorMessage ? errorId : undefined}
            aria-invalid={Boolean(errorMessage)}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => query && setOpen(true)}
            onKeyDown={handleKeyDown}
          />
          {open && query && (
            <ul className="resource-picker-listbox" role="listbox" id={listboxId}>
              {loading && <li className="resource-picker-status">{MESSAGES.dialogue.picker.loading}</li>}
              {!loading && options.length === 0 && (
                <li className="resource-picker-empty">
                  {MESSAGES.dialogue.picker.noResults(query)}
                  {createHref && (
                    <Link to={createHref} className="resource-picker-create-link">
                      {MESSAGES.dialogue.picker.createNew(label)}
                    </Link>
                  )}
                </li>
              )}
              {options.map((opt, index) => (
                <li
                  key={opt.id}
                  id={`${listboxId}-opt-${index}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  className={`resource-picker-option${index === activeIndex ? ' resource-picker-option--active' : ''}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectOption(opt);
                  }}
                >
                  {opt.name}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="resource-picker-chips">
        {selectedIds.map((sid) => (
          <span key={sid} className="resource-picker-chip">
            {nameCache[sid] ?? sid}
            <button
              type="button"
              className="resource-picker-chip-remove"
              aria-label={MESSAGES.dialogue.picker.removeChip(nameCache[sid] ?? sid)}
              onClick={() => removeSelected(sid)}
              disabled={disabled}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      {helpText && <p className="field-hint">{helpText}</p>}
      <InlineFieldError id={errorId} message={errorMessage} />
    </div>
  );
});
