import { useEffect, useRef, useState } from 'react';
import type { VoiceNodeToneView } from '@chat-bot/shared-types';
import { SPEECH_TONES, type SpeechTone } from '@chat-bot/shared-types/speech-voice';
import { dialogNodesApi } from '../../../api/dialogue';
import { InlineFieldError } from '../../../components/InlineFieldError';
import { ResourcePickerField } from '../../../components/ResourcePickerField';
import { MESSAGES } from '../../../constants/messages';
import { VoiceNodeMissingBadge } from './VoiceNodeMissingBadge';

/**
 * VO-C5 노드별 말투 — 선택 기능이라 기본 0개이며 빈 상태가 정상이다. 노드 후보가 20개를 넘을 수 있어 셀렉트 대신 검색형
 * `ResourcePickerField`를 쓴다(UIUX §6). **삭제는 저장 전까지 서버에 반영되지 않는다**(전체 교체 PUT이므로 저장이 확정 지점).
 * 삭제 뒤 포커스는 다음 행의 삭제 버튼, 없으면 노드 선택 필드. 삭제된 노드(`nodeMissing`)는 자동으로 지우지 않고 배지로 알린다.
 */
export function VoiceNodeToneEditor({
  chatbotId,
  rows,
  max,
  disabled,
  rowErrors,
  onChange,
}: {
  chatbotId: string;
  rows: VoiceNodeToneView[];
  max: number;
  disabled: boolean;
  /** `nodeId` → 인라인 오류(저장 시 `INVALID_REFERENCE`). */
  rowErrors: Record<string, string>;
  onChange: (rows: VoiceNodeToneView[]) => void;
}): JSX.Element {
  const msg = MESSAGES.voice;
  const [pendingNodeId, setPendingNodeId] = useState<string | null>(null);
  const [pendingTone, setPendingTone] = useState<SpeechTone>('BRIGHT');
  const [adding, setAdding] = useState(false);
  const pickerRef = useRef<HTMLInputElement>(null);
  const removeRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [focusAfterRemove, setFocusAfterRemove] = useState<number | 'picker' | null>(null);

  const full = rows.length >= max;
  const addBlockedReason = disabled ? undefined : full ? msg.nodeToneMax : pendingNodeId ? undefined : msg.nodeToneAddNeedsNode;
  const addDisabled = disabled || full || !pendingNodeId || adding;

  useEffect(() => {
    if (focusAfterRemove === null) return;
    if (focusAfterRemove === 'picker') pickerRef.current?.focus();
    else removeRefs.current[focusAfterRemove]?.focus();
    setFocusAfterRemove(null);
  }, [focusAfterRemove, rows.length]);

  async function handleAdd(): Promise<void> {
    if (addDisabled || !pendingNodeId) return;
    setAdding(true);
    let name: string | null = null;
    try {
      name = (await dialogNodesApi.findOne(chatbotId, pendingNodeId)).name;
    } catch {
      name = null; // 이름 조회 실패 — 행은 만들고 이름만 비운다(저장 시 서버가 소속을 검증).
    }
    onChange([...rows, { nodeId: pendingNodeId, tone: pendingTone, nodeName: name }]);
    setPendingNodeId(null);
    setAdding(false);
  }

  function removeAt(index: number): void {
    const next = rows.filter((_, i) => i !== index);
    onChange(next);
    setFocusAfterRemove(index < next.length ? index : 'picker');
  }

  return (
    <section className="voice-block" aria-labelledby="voice-node-tone-title">
      <h4 id="voice-node-tone-title">
        {msg.nodeToneTitle} <span className="field-hint">{msg.nodeToneCount(rows.length, max)}</span>
      </h4>
      <ul className="voice-info-list">
        <li className="field-hint">
          <span aria-hidden="true">ⓘ</span> {msg.nodeToneInfo1}
        </li>
        <li className="field-hint">
          <span aria-hidden="true">ⓘ</span> {msg.nodeToneInfo2}
        </li>
        <li className="field-hint">
          <span aria-hidden="true">ⓘ</span> {msg.nodeToneInfo3}
        </li>
      </ul>

      <div className="voice-node-add">
        <ResourcePickerField
          ref={pickerRef}
          id="voice-node-picker"
          label={msg.nodePickerLabel}
          resourceType="node"
          chatbotId={chatbotId}
          multiple={false}
          value={pendingNodeId}
          onChange={(v) => setPendingNodeId(typeof v === 'string' ? v : null)}
          excludeIds={rows.map((r) => r.nodeId)}
          disabled={disabled || full}
        />
        <div className="form-field">
          <label htmlFor="voice-node-pending-tone">{msg.nodeToneSelectLabel}</label>
          <select id="voice-node-pending-tone" value={pendingTone} disabled={disabled || full} onChange={(e) => setPendingTone(e.target.value as SpeechTone)}>
            {SPEECH_TONES.map((tone) => (
              <option key={tone} value={tone}>
                {msg.toneNames[tone]}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          aria-disabled={addDisabled || undefined}
          aria-describedby={addBlockedReason ? 'voice-node-add-reason' : undefined}
          onClick={() => void handleAdd()}
        >
          {msg.nodeToneAddButton}
        </button>
      </div>
      {addBlockedReason && (
        <p id="voice-node-add-reason" className="field-hint">
          {addBlockedReason}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="field-hint voice-empty">{msg.nodeToneEmpty}</p>
      ) : (
        <div className="dialogue-table-wrap">
          <table className="dialogue-table voice-node-table">
            <caption className="sr-only">{msg.nodeToneTitle}</caption>
            <thead>
              <tr>
                <th scope="col">{msg.nodeToneColNode}</th>
                <th scope="col">{msg.nodeToneColTone}</th>
                <th scope="col">{msg.nodeToneColStatus}</th>
                <th scope="col">
                  <span className="sr-only">{msg.nodeToneRemove}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const display = row.nodeName ?? msg.nodeUnnamed;
                const label = row.nodeMissing ? `${display} (${msg.nodeMissingLabel})` : display;
                const error = rowErrors[row.nodeId];
                const errorId = `voice-node-row-error-${row.nodeId}`;
                return (
                  <tr key={row.nodeId} data-node-id={row.nodeId}>
                    <td>{label}</td>
                    <td>
                      <select
                        aria-label={msg.nodeToneRowToneLabel(display)}
                        value={row.tone}
                        disabled={disabled}
                        aria-invalid={Boolean(error)}
                        aria-describedby={error ? errorId : undefined}
                        onChange={(e) => onChange(rows.map((r, i) => (i === index ? { ...r, tone: e.target.value as SpeechTone } : r)))}
                      >
                        {SPEECH_TONES.map((tone) => (
                          <option key={tone} value={tone}>
                            {msg.toneNames[tone]}
                          </option>
                        ))}
                      </select>
                      <InlineFieldError id={errorId} message={error} />
                    </td>
                    <td>{row.nodeMissing ? <VoiceNodeMissingBadge /> : '—'}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        ref={(el) => {
                          removeRefs.current[index] = el;
                        }}
                        aria-label={msg.nodeToneRemoveAria(display)}
                        aria-disabled={disabled || undefined}
                        onClick={() => {
                          if (!disabled) removeAt(index);
                        }}
                      >
                        {msg.nodeToneRemove}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
