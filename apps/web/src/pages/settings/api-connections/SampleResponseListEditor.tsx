import { useRef, useState } from 'react';
import type { ApiSampleResponse } from '@chat-bot/shared-types';
import { ReorderableList } from '../../../components/ReorderableList';
import { InlineFieldError } from '../../../components/InlineFieldError';
import { MESSAGES } from '../../../constants/messages';

interface SampleRow {
  key: string;
  label: string;
  httpStatus: number;
  bodyText: string;
  bodyValue: unknown;
}

export interface SampleResponseListEditorProps {
  items: ApiSampleResponse[];
  onChange: (items: ApiSampleResponse[]) => void;
  maxItems?: number;
}

/**
 * AC1 편집 모달 — 샘플 응답 목록(ui-spec §2.2 `SampleResponseListEditor`). `ReorderableList` 재사용.
 * 본문 JSON 초안(`bodyText`)은 이 컴포넌트가 소유한다 — 파싱에 실패한 중간 입력 상태를 부모 state로
 * 매번 되돌리지 않기 위함이다(파싱 성공 시에만 부모 `onChange`에 반영되는 `body`가 갱신된다).
 */
export function SampleResponseListEditor({ items, onChange, maxItems = 5 }: SampleResponseListEditorProps): JSX.Element {
  const msg = MESSAGES.apiConnections;
  const keySeq = useRef(0);
  function newKey(): string {
    keySeq.current += 1;
    return `sample-${keySeq.current}`;
  }
  const [rows, setRows] = useState<SampleRow[]>(() =>
    items.map((it) => ({ key: newKey(), label: it.label, httpStatus: it.httpStatus, bodyText: JSON.stringify(it.body, null, 2), bodyValue: it.body })),
  );

  function commit(next: SampleRow[]): void {
    setRows(next);
    onChange(next.map((r) => ({ label: r.label, httpStatus: r.httpStatus, body: r.bodyValue })));
  }

  function updateRow(index: number, patch: Partial<Pick<SampleRow, 'label' | 'httpStatus' | 'bodyText'>>): void {
    const next = [...rows];
    const row = { ...next[index], ...patch };
    if (patch.bodyText !== undefined) {
      try {
        row.bodyValue = JSON.parse(patch.bodyText);
      } catch {
        // 파싱 실패 — bodyValue(부모에 반영될 값)는 이전 값을 유지하고, 화면에는 오류를 표시한다.
      }
    }
    next[index] = row;
    commit(next);
  }

  return (
    <div className="form-field">
      <span className="field-label-static">{msg.sampleResponsesTitle(rows.length, maxItems)}</span>
      <p className="field-hint field-hint--warning">
        <span aria-hidden="true">⚠</span> {msg.sampleResponsesWarning}
      </p>
      <ReorderableList
        items={rows}
        getKey={(r) => r.key}
        onChange={commit}
        maxItems={maxItems}
        onAdd={() => commit([...rows, { key: newKey(), label: '', httpStatus: 200, bodyText: '{}', bodyValue: {} }])}
        addLabel={msg.addSample}
        onRemove={(key) => commit(rows.filter((r) => r.key !== key))}
        itemLabel={(r, i) => `${i + 1}번째 샘플(${r.label || '레이블 없음'})`}
        renderItem={(r, index) => {
          let bodyError: string | undefined;
          try {
            JSON.parse(r.bodyText);
          } catch {
            bodyError = msg.sampleBodyInvalidJson;
          }
          return (
            <div className="key-value-row">
              <div className="form-field">
                <label htmlFor={`sample-${r.key}-label`}>{msg.sampleLabel}</label>
                <input
                  id={`sample-${r.key}-label`}
                  type="text"
                  maxLength={50}
                  value={r.label}
                  onChange={(e) => updateRow(index, { label: e.target.value })}
                />
              </div>
              <div className="form-field">
                <label htmlFor={`sample-${r.key}-status`}>{msg.sampleHttpStatus}</label>
                <input
                  id={`sample-${r.key}-status`}
                  type="number"
                  min={100}
                  max={599}
                  value={r.httpStatus}
                  onChange={(e) => updateRow(index, { httpStatus: Number(e.target.value) })}
                />
              </div>
              <div className="form-field">
                <label htmlFor={`sample-${r.key}-body`}>{msg.sampleBody}</label>
                <textarea
                  id={`sample-${r.key}-body`}
                  rows={3}
                  maxLength={16384}
                  value={r.bodyText}
                  onChange={(e) => updateRow(index, { bodyText: e.target.value })}
                  aria-invalid={Boolean(bodyError)}
                />
                <InlineFieldError id={`sample-${r.key}-body-error`} message={bodyError} />
              </div>
            </div>
          );
        }}
      />
    </div>
  );
}

