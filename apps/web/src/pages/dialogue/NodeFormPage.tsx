import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  CreateDialogNodeSchema,
  findLegacyApiOutputIndexes,
  findLegacySurveyOutputIndexes,
  type DialogMatchMode,
  type DialogNodeType,
  type DialogOutput,
  type DialogueOverlay,
} from '@chat-bot/shared-types';
import { useChatbotDetailContext } from '../ChatbotDetailLayout';
import { dialogNodesApi } from '../../api/dialogue';
import { ApiError } from '../../api/client';
import { useToast } from '../../components/Toast';
import { InlineFieldError } from '../../components/InlineFieldError';
import { ReorderableList } from '../../components/ReorderableList';
import { ResourcePickerField } from '../../components/ResourcePickerField';
import { ErrorState } from '../../components/ErrorState';
import { MESSAGES } from '../../constants/messages';
import { fieldErrorsFromApiError } from '../../lib/apiErrorHelpers';
import { DialogOutputEditor } from './components/DialogOutputEditor';
import { SimulatorDrawer } from '../chatbot-detail/simulator/SimulatorDrawer';

interface OutputRow {
  key: string;
  output: DialogOutput;
}

let keySeq = 0;
function nextKey(): string {
  keySeq += 1;
  return `output-${keySeq}-${Date.now()}`;
}

/** D1a/D1b — 노드 생성/편집 폼(ui-spec §4.2). */
export function NodeFormPage(): JSX.Element {
  const { chatbot, setUnsavedGuard } = useChatbotDetailContext();
  const { nodeId } = useParams<{ nodeId: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const isArchived = chatbot.status === 'ARCHIVED';
  const msg = MESSAGES.dialogue.nodeForm;
  const isNew = !nodeId;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [nodeType, setNodeType] = useState<DialogNodeType>('NORMAL');
  const [matchMode, setMatchMode] = useState<DialogMatchMode>('ANY');
  const [enabled, setEnabled] = useState(true);
  const [priority, setPriority] = useState(100);
  const [intentIds, setIntentIds] = useState<string[]>([]);
  const [keywordIds, setKeywordIds] = useState<string[]>([]);
  const [contextVariableId, setContextVariableId] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<OutputRow[]>([]);

  const [loading, setLoading] = useState(!isNew);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formBanner, setFormBanner] = useState<string | undefined>(undefined);
  const [simulatorOpen, setSimulatorOpen] = useState(false);
  // [No.26] `API_OUTPUT_LEGACY_FORMAT` 저장 거부 시 v1 카드로 스크롤·포커스+강조(ui-spec §3.3-5).
  // `token`은 같은 인덱스에서 재시도해도 효과가 다시 발동하도록 매번 갱신한다.
  const [legacyHighlight, setLegacyHighlight] = useState<{ index: number; token: number } | null>(null);

  const load = useCallback(async () => {
    if (isNew || !nodeId) return;
    setLoading(true);
    setNotFound(false);
    try {
      const node = await dialogNodesApi.findOne(chatbot.id, nodeId);
      setName(node.name);
      setDescription(node.description ?? '');
      setNodeType(node.nodeType);
      setMatchMode(node.matchMode);
      setEnabled(node.enabled);
      setPriority(node.priority);
      setIntentIds(node.intentIds);
      setKeywordIds(node.keywordIds);
      setContextVariableId(node.contextVariableId ?? null);
      setOutputs(node.outputs.map((o) => ({ key: nextKey(), output: o })));
      setDirty(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setNotFound(true);
      else showToast(MESSAGES.errors.generic);
    } finally {
      setLoading(false);
    }
  }, [chatbot.id, nodeId, isNew, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setUnsavedGuard(dirty ? () => window.confirm(msg.unsavedConfirm) : null);
    return () => setUnsavedGuard(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  function markDirty<T>(setter: (v: T) => void) {
    return (v: T) => {
      setDirty(true);
      setter(v);
    };
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (isArchived) return;
    setFormBanner(undefined);
    setFieldErrors({});

    const payload = {
      name,
      description: description || undefined,
      nodeType,
      matchMode,
      enabled,
      priority,
      intentIds,
      keywordIds,
      contextVariableId: contextVariableId ?? undefined,
      outputs: outputs.map((o) => o.output),
    };

    // 클라이언트 사전검증(서버와 동일한 zod 스키마 재사용) — 실패 시 요청을 보내지 않는다(§5.1).
    const parsed = CreateDialogNodeSchema.safeParse(payload);
    if (!parsed.success) {
      const map: Record<string, string> = {};
      let banner: string | undefined;
      parsed.error.issues.forEach((issue) => {
        const path = issue.path.join('.');
        if (path === '' || path === 'intentIds' || path === 'outputs') banner = issue.message;
        else map[path] = issue.message;
      });
      setFieldErrors(map);
      if (banner) setFormBanner(banner);
      return;
    }

    setSaving(true);
    try {
      if (isNew) {
        await dialogNodesApi.create(chatbot.id, parsed.data);
        showToast(msg.saveSuccess);
        setDirty(false);
        navigate(`/chatbots/${chatbot.id}/dialogue/nodes`);
      } else if (nodeId) {
        await dialogNodesApi.update(chatbot.id, nodeId, parsed.data);
        showToast(msg.saveSuccess);
        setDirty(false);
        void load();
      }
    } catch (e2) {
      if (e2 instanceof ApiError) {
        const details = fieldErrorsFromApiError(e2);
        if (e2.code === 'DUPLICATE_NAME') {
          setFieldErrors({ name: e2.message });
        } else if (e2.code === 'START_NODE_EXISTS' || e2.code === 'FALLBACK_NODE_EXISTS') {
          setFormBanner(e2.message);
        } else if (e2.code === 'API_OUTPUT_LEGACY_FORMAT') {
          // [No.26] v1 카드로 스크롤·포커스를 옮기고 "연결로 전환" 버튼을 강조한다(ui-spec §3.3-5).
          setFormBanner(MESSAGES.dialogue.outputFields.saveBlockedLegacyFormat);
          const legacyIndexes = findLegacyApiOutputIndexes(outputs.map((o) => o.output));
          if (legacyIndexes.length > 0) {
            setLegacyHighlight({ index: legacyIndexes[0], token: Date.now() });
          }
        } else if (e2.code === 'SURVEY_OUTPUT_LEGACY_FORMAT') {
          // [No.27] v1 카드로 스크롤·포커스+강조(survey-management-ui-spec.md §3.4 전환 흐름 5).
          setFormBanner(MESSAGES.dialogue.outputFields.saveBlockedSurveyLegacyFormat);
          const legacyIndexes = findLegacySurveyOutputIndexes(outputs.map((o) => o.output));
          if (legacyIndexes.length > 0) {
            setLegacyHighlight({ index: legacyIndexes[0], token: Date.now() });
          }
        } else if (Object.keys(details).length > 0) {
          setFieldErrors(details);
          setFormBanner(e2.message);
        } else {
          setFormBanner(e2.message || MESSAGES.errors.generic);
        }
      } else {
        setFormBanner(MESSAGES.errors.generic);
      }
    } finally {
      setSaving(false);
    }
  }

  function handleCancel(): void {
    navigate(`/chatbots/${chatbot.id}/dialogue/nodes`);
  }

  /**
   * SIM1-D(FR-10-23) — 현재 폼 상태를 오버레이로 직렬화한다. 신규 노드는 `draft-1` 임시 id를 쓴다
   * (FR-10-19 ②). 드로어가 열려 있는 동안 폼을 더 고치면 이 값이 매 렌더 갱신되어 재직렬화된다(ui-spec §4.2-3).
   */
  function buildOverlay(): DialogueOverlay {
    return {
      dialogNodes: [
        {
          id: nodeId ?? 'draft-1',
          name,
          description: description || undefined,
          nodeType,
          matchMode,
          enabled,
          priority,
          intentIds,
          keywordIds,
          contextVariableId: contextVariableId ?? undefined,
          outputs: outputs.map((o) => o.output),
        },
      ],
    };
  }

  if (loading) return <p role="status">{MESSAGES.common.loading}</p>;
  if (notFound) return <ErrorState title={msg.notFound} />;

  const conditionsDisabled = nodeType !== 'NORMAL';

  return (
    <div className="node-form-layout">
      <Link to={`/chatbots/${chatbot.id}/dialogue/nodes`} className="detail-back-link">
        {msg.backToList}
      </Link>
      <div className="node-form-header">
        <h2>{isNew ? msg.titleNew : msg.titleEdit(name)}</h2>
        <button type="button" className="btn btn-secondary" onClick={() => setSimulatorOpen(true)}>
          {MESSAGES.simulator.openInDrawer}
        </button>
      </div>

      {formBanner && (
        <div className="form-banner form-banner--error" role="alert">
          {formBanner}
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate>
        <fieldset disabled={isArchived} style={{ border: 'none', padding: 0, margin: 0 }}>
          <div className="node-form-section">
            <div className="form-field">
              <label htmlFor="node-name">
                {msg.nameLabel} <span className="required-mark" aria-hidden="true">*</span>
              </label>
              <input
                id="node-name"
                type="text"
                value={name}
                maxLength={100}
                onChange={(e) => markDirty(setName)(e.target.value)}
                aria-describedby={fieldErrors.name ? 'node-name-error' : undefined}
                aria-invalid={Boolean(fieldErrors.name)}
              />
              <InlineFieldError id="node-name-error" message={fieldErrors.name} />
            </div>
            <div className="form-field">
              <label htmlFor="node-description">{msg.descriptionLabel}</label>
              <textarea
                id="node-description"
                value={description}
                maxLength={300}
                rows={2}
                onChange={(e) => markDirty(setDescription)(e.target.value)}
              />
            </div>

            <fieldset className="form-field" style={{ border: 'none', padding: 0 }}>
              <legend className="field-label-static">{msg.typeLabel}</legend>
              <label className="form-field--inline">
                <input type="radio" name="node-type" checked={nodeType === 'NORMAL'} onChange={() => markDirty(setNodeType)('NORMAL')} />
                {msg.typeNormal}
              </label>
              <label className="form-field--inline">
                <input type="radio" name="node-type" checked={nodeType === 'START'} onChange={() => markDirty(setNodeType)('START')} />
                {msg.typeStart}
              </label>
              <label className="form-field--inline">
                <input type="radio" name="node-type" checked={nodeType === 'FALLBACK'} onChange={() => markDirty(setNodeType)('FALLBACK')} />
                {msg.typeFallback}
              </label>
            </fieldset>

            <div className="form-field form-field--inline">
              <input id="node-enabled" type="checkbox" checked={enabled} onChange={(e) => markDirty(setEnabled)(e.target.checked)} />
              <label htmlFor="node-enabled">{msg.enabledLabel}</label>
            </div>
            {!enabled && <p className="field-hint">{msg.enabledHelp}</p>}

            {nodeType === 'NORMAL' && (
              <div className="form-field">
                <label htmlFor="node-priority">{msg.priorityLabel}</label>
                <input
                  id="node-priority"
                  type="number"
                  min={-1000}
                  max={1000}
                  value={priority}
                  onChange={(e) => markDirty(setPriority)(Number(e.target.value))}
                />
                <p className="field-hint">{msg.priorityHelp}</p>
              </div>
            )}
          </div>

          <div className="node-form-section">
            <h3>{msg.conditionsTitle}</h3>
            {conditionsDisabled ? (
              <p className="field-hint">{msg.conditionsDisabledHelp}</p>
            ) : (
              <>
                <fieldset className="form-field" style={{ border: 'none', padding: 0 }}>
                  <legend className="field-label-static">{msg.matchModeLabel}</legend>
                  <label className="form-field--inline">
                    <input type="radio" name="match-mode" checked={matchMode === 'ANY'} onChange={() => markDirty(setMatchMode)('ANY')} />
                    {msg.matchModeAny}
                  </label>
                  <label className="form-field--inline">
                    <input type="radio" name="match-mode" checked={matchMode === 'ALL'} onChange={() => markDirty(setMatchMode)('ALL')} />
                    {msg.matchModeAll}
                  </label>
                  <p className="field-hint">{msg.matchModeHelp}</p>
                </fieldset>

                <ResourcePickerField
                  id="node-intents"
                  label={msg.intentsLabel}
                  resourceType="intent"
                  chatbotId={chatbot.id}
                  multiple
                  value={intentIds}
                  onChange={(v) => markDirty(setIntentIds)(v as string[])}
                  createHref={`/chatbots/${chatbot.id}/dialogue/intents?resource=intent`}
                  errorMessage={fieldErrors.intentIds}
                />
                <ResourcePickerField
                  id="node-keywords"
                  label={msg.keywordsLabel}
                  resourceType="keyword"
                  chatbotId={chatbot.id}
                  multiple
                  value={keywordIds}
                  onChange={(v) => markDirty(setKeywordIds)(v as string[])}
                  createHref={`/chatbots/${chatbot.id}/dialogue/intents?resource=keyword`}
                  errorMessage={fieldErrors.keywordIds}
                />
                <ResourcePickerField
                  id="node-context"
                  label={msg.contextLabel}
                  resourceType="context"
                  chatbotId={chatbot.id}
                  multiple={false}
                  value={contextVariableId}
                  onChange={(v) => markDirty(setContextVariableId)((v as string) || null)}
                  createHref={`/chatbots/${chatbot.id}/dialogue/contexts/new`}
                  helpText={msg.contextHelp}
                  errorMessage={fieldErrors.contextVariableId}
                />
              </>
            )}
          </div>

          <div className="node-form-section">
            <h3>{msg.outputsTitle(outputs.length)}</h3>
            <ReorderableList
              items={outputs}
              getKey={(o) => o.key}
              onChange={(next) => {
                setDirty(true);
                setOutputs(next);
              }}
              maxItems={10}
              onAdd={() => {
                setDirty(true);
                setOutputs((prev) => [...prev, { key: nextKey(), output: { type: 'TEXT', payload: { text: '' } } }]);
              }}
              addLabel={msg.addOutput}
              addLimitLabel={msg.addOutputMax}
              onRemove={(key) => {
                setDirty(true);
                setOutputs((prev) => prev.filter((o) => o.key !== key));
              }}
              itemLabel={(o, i) => `${i + 1}번째 아웃풋(${MESSAGES.dialogue.outputTypes[o.output.type]})`}
              renderItem={(row, index) => (
                <DialogOutputEditor
                  value={row.output}
                  onChange={(next) => {
                    setDirty(true);
                    setOutputs((prev) => prev.map((o) => (o.key === row.key ? { ...o, output: next } : o)));
                  }}
                  chatbotId={chatbot.id}
                  currentNodeId={nodeId}
                  nodeContextVariableId={contextVariableId}
                  highlightLegacyToken={legacyHighlight?.index === index ? legacyHighlight.token : undefined}
                  idPrefix={`output-${index}`}
                  errorFieldPrefix={`outputs.${index}.payload`}
                  fieldErrors={fieldErrors}
                />
              )}
            />
          </div>
        </fieldset>

        {!isArchived && (
          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={handleCancel} disabled={saving}>
              {MESSAGES.common.cancel}
            </button>
            <button type="submit" className="btn btn-primary" disabled={!dirty || saving}>
              {saving ? MESSAGES.common.saving : MESSAGES.common.save}
            </button>
          </div>
        )}
      </form>

      <SimulatorDrawer
        isOpen={simulatorOpen}
        onClose={() => setSimulatorOpen(false)}
        chatbotId={chatbot.id}
        isArchived={isArchived}
        overlay={buildOverlay()}
      />
    </div>
  );
}
