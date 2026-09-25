import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Topic } from '@chat-bot/shared-types';
import { MESSAGES } from '../constants/messages';
import { InlineFieldError } from './InlineFieldError';

export interface TopicSelectFieldProps {
  id: string;
  label?: string;
  /** 챗봇 전체 토픽(이미 한 번 로드된 값을 재사용한다 — `topic-system-ui-spec.md` §9-3, 토픽당 요청 1회). */
  topics: Topic[];
  /** null = 공통. */
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  required?: boolean;
  errorMessage?: string;
  helpText?: string;
}

interface OptionRow {
  id: string | null;
  label: string;
}

/**
 * `TopicSelectField` — 자산 폼·일괄 지정 모달·가져오기 모달이 공유하는 토픽 선택 콤보박스
 * (`topic-system-ui-spec.md` §2.2). `ResourcePickerField`를 재사용하지 않는다: 토픽은 챗봇당
 * 최대 50개로 이미 전량 로드되어 있어 서버 왕복 검색이 필요 없고, "공통"이라는 null 옵션이
 * chip 제거 은유와 맞지 않는다. 클라이언트 필터링 콤보박스(`role="listbox"`, 방향키/Enter/Esc)로
 * 새로 만든다(UIUX §6 "20개 초과 시 셀렉트 대신 다른 UI").
 */
export function TopicSelectField({
  id,
  label,
  topics,
  value,
  onChange,
  disabled = false,
  required = false,
  errorMessage,
  helpText,
}: TopicSelectFieldProps): JSX.Element {
  const msg = MESSAGES.topics;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const errorId = `${id}-error`;

  const options: OptionRow[] = useMemo(() => {
    const all: OptionRow[] = [
      { id: null, label: msg.commonRowLabel },
      ...topics.map((t) => ({ id: t.id, label: t.enabled ? t.name : msg.topicFieldInactiveSuffix(t.name) })),
    ];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((o) => o.label.toLowerCase().includes(q));
  }, [topics, query, msg]);

  const selectedTopic = value === null ? undefined : topics.find((t) => t.id === value);
  const selectedLabel =
    value === null ? msg.commonRowLabel : selectedTopic ? (selectedTopic.enabled ? selectedTopic.name : msg.topicFieldInactiveSuffix(selectedTopic.name)) : msg.topicFieldInvalidReference;

  useEffect(() => {
    if (!open) return undefined;
    function handleClick(e: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  function selectOption(opt: OptionRow): void {
    onChange(opt.id);
    setQuery('');
    setOpen(false);
    setActiveIndex(-1);
    inputRef.current?.focus();
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
        setQuery('');
      }
    }
  }

  const activeOptionId = activeIndex >= 0 ? `${listboxId}-opt-${activeIndex}` : undefined;

  return (
    <div className="form-field topic-select-field" ref={containerRef}>
      {label !== undefined && (
        <label htmlFor={id}>
          {label} {required && <span className="required-mark" aria-hidden="true">*</span>}
        </label>
      )}
      <div className="topic-select-combobox">
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
          value={open ? query : selectedLabel}
          aria-describedby={errorMessage ? errorId : undefined}
          aria-invalid={Boolean(errorMessage)}
          onFocus={() => {
            setOpen(true);
            setQuery('');
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onKeyDown={handleKeyDown}
        />
        {open && (
          <ul className="resource-picker-listbox" role="listbox" id={listboxId}>
            {options.length === 0 && <li className="resource-picker-empty">{MESSAGES.dialogue.picker.noResults(query)}</li>}
            {options.map((opt, index) => (
              <li
                key={opt.id ?? 'common'}
                id={`${listboxId}-opt-${index}`}
                role="option"
                aria-selected={opt.id === value}
                className={`resource-picker-option${index === activeIndex ? ' resource-picker-option--active' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectOption(opt);
                }}
              >
                {opt.label}
              </li>
            ))}
          </ul>
        )}
      </div>
      {helpText && <p className="field-hint">{helpText}</p>}
      <InlineFieldError id={errorId} message={errorMessage} />
    </div>
  );
}
