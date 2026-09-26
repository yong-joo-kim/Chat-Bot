import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  CHANNEL_CAPABILITIES,
  CHANNEL_TYPE_LABELS,
  CreateDialogNodeSchema,
  LEGACY_WEB_WIDGET_OUTPUT_PROFILE,
  degradeForProfile,
  findLegacyApiOutputIndexes,
  findLegacySurveyOutputIndexes,
  findQuickReplyPlacementIssues,
  type DialogMatchMode,
  type DialogNodeType,
  type DialogOutput,
  type DialogueOverlay,
  type RichUrlHostRule,
} from '@chat-bot/shared-types';
import { toOutputViews } from '@chat-bot/shared-types/output-view';
import { useChatbotDetailContext } from '../ChatbotDetailLayout';
import { dialogNodesApi } from '../../api/dialogue';
import { channelsApi } from '../../api/channels';
import { richMessagesApi } from '../../api/richMessages';
import { ApiError } from '../../api/client';
import { useToast } from '../../components/Toast';
import { InlineFieldError } from '../../components/InlineFieldError';
import { ReorderableList } from '../../components/ReorderableList';
import { ResourcePickerField } from '../../components/ResourcePickerField';
import { ErrorState } from '../../components/ErrorState';
import { SeverityBadge } from '../../components/SeverityBadge';
import { MESSAGES } from '../../constants/messages';
import { fieldErrorsFromApiError } from '../../lib/apiErrorHelpers';
import { DialogOutputEditor } from './components/DialogOutputEditor';
import { ChannelPreviewSection } from './components/ChannelPreviewSection';
import { SimulatorDrawer } from '../chatbot-detail/simulator/SimulatorDrawer';
import { TopicSelectField } from '../../components/TopicSelectField';
import { SystemNodeTopicLockedHint } from './components/topicBadges';
import { useTopics } from '../../lib/useTopics';

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
  const { chatbot, setUnsavedGuard, environmentStatus } = useChatbotDetailContext();
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
  const [topicId, setTopicId] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<OutputRow[]>([]);
  const { topics } = useTopics(chatbot.id);

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
  // [신규 No.46] RM-1 하단 — 챗봇 허용 도메인 목록(있으면 목록 밖 호스트를 경고, §3.1 하단).
  const [allowedHosts, setAllowedHosts] = useState<RichUrlHostRule[] | undefined>(undefined);
  // [신규 No.46] RM-4 — 저장 성공 직후 1회만 보이는 채널 강등 경고 배너(비차단, §3.4).
  const [saveWarning, setSaveWarning] = useState<{ severity: 'WARNING' | 'INFO'; text: string } | null>(null);

  useEffect(() => {
    richMessagesApi
      .getUrlPolicy(chatbot.id)
      .then((res) => setAllowedHosts(res.hosts))
      .catch(() => setAllowedHosts(undefined));
  }, [chatbot.id]);

  // [신규 No.46] RM-2 — 바로연결 배치 규칙을 outputs가 바뀔 때마다 클라이언트에서 실시간 재계산한다(§4.2).
  const quickReplyIssues = useMemo(() => findQuickReplyPlacementIssues(outputs.map((o) => o.output)), [outputs]);
  const quickReplyBanner = useMemo(() => {
    if (quickReplyIssues.length === 0) return undefined;
    const msg = MESSAGES.dialogue.outputFields;
    return quickReplyIssues.some((i) => i.reason === 'MULTIPLE') ? msg.quickReplyPlacementMultipleError : msg.quickReplyPlacementNotLastError;
  }, [quickReplyIssues]);

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
      setTopicId(node.topicId ?? null);
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
      // [신규 No.46] RM-4 — 다시 편집을 시작하면 저장 경고 배너가 사라진다(§3.4, 모달 아님).
      setSaveWarning(null);
      setter(v);
    };
  }

  /** [신규 No.46] RM-4 — 저장 성공 직후 활성/설정만 된 채널의 강등 변화를 1회 안내한다(§3.4, 순수 계산). */
  async function computeSaveWarning(savedOutputs: DialogOutput[]): Promise<{ severity: 'WARNING' | 'INFO'; text: string } | null> {
    const displayOutputs = toOutputViews(savedOutputs);
    if (displayOutputs.length === 0) return null;
    const legacyChanges = degradeForProfile(displayOutputs, LEGACY_WEB_WIDGET_OUTPUT_PROFILE).changes;
    if (legacyChanges.length > 0) {
      // [코드 리뷰 R1 Low, 오케스트레이터 결정] 설계서 §11.4 우선 — 구버전 위젯 강등은 INFO다
      // (문서 간 §3.4 표기와 모순이 있었고, 설계서를 채택했다).
      return { severity: 'INFO', text: MESSAGES.richMessages.saveWarningActiveChannel(MESSAGES.richMessages.tabLegacyWidget) };
    }
    try {
      const { items } = await channelsApi.list(chatbot.id);
      for (const ch of items) {
        if (ch.type === 'WEB' || !ch.configured) continue;
        const changes = degradeForProfile(displayOutputs, CHANNEL_CAPABILITIES[ch.type].outputs).changes;
        if (changes.length > 0) {
          return { severity: 'INFO', text: MESSAGES.richMessages.saveInfoConfigOnlyChannel(CHANNEL_TYPE_LABELS[ch.type]) };
        }
      }
    } catch {
      // 채널 목록 조회 실패는 저장 자체를 막지 않는다 — 경고 배너만 생략한다.
    }
    return null;
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (isArchived) return;
    setFormBanner(undefined);
    setFieldErrors({});
    setSaveWarning(null);

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
      topicId: nodeType === 'NORMAL' ? topicId : null,
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
        setSaveWarning(await computeSaveWarning(parsed.data.outputs));
        void load();
      }
    } catch (e2) {
      if (e2 instanceof ApiError) {
        const details = fieldErrorsFromApiError(e2);
        if (e2.code === 'DUPLICATE_NAME') {
          setFieldErrors({ name: e2.message });
        } else if (e2.code === 'START_NODE_EXISTS' || e2.code === 'FALLBACK_NODE_EXISTS') {
          setFormBanner(e2.message);
        } else if (e2.code === 'TOPIC_SYSTEM_NODE_LOCKED') {
          setFormBanner(MESSAGES.errors.TOPIC_SYSTEM_NODE_LOCKED);
        } else if (e2.code === 'INVALID_REFERENCE' && Object.keys(details).length === 0) {
          setFormBanner(MESSAGES.topics.topicFieldInvalidReference);
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
          topicId: nodeType === 'NORMAL' ? (topicId ?? undefined) : undefined,
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

      {/* [신규 No.46] RM-4 — 저장 성공 직후 1회만 보이는 채널 강등 경고(비차단, D-7 닫을 때까지 유지). */}
      {saveWarning && (
        <div aria-live="polite">
          <SeverityBadge severity={saveWarning.severity} label={saveWarning.text} />{' '}
          <button type="button" className="link-button" onClick={() => setSaveWarning(null)}>
            {MESSAGES.common.close}
          </button>
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

            {nodeType === 'NORMAL' ? (
              <TopicSelectField
                id="node-topic"
                label={MESSAGES.topics.topicFieldLabel}
                topics={topics}
                value={topicId}
                onChange={(v) => markDirty(setTopicId)(v)}
                errorMessage={fieldErrors.topicId}
              />
            ) : (
              <SystemNodeTopicLockedHint />
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
                setSaveWarning(null);
                setOutputs(next);
              }}
              maxItems={10}
              onAdd={() => {
                setDirty(true);
                setSaveWarning(null);
                setOutputs((prev) => [...prev, { key: nextKey(), output: { type: 'TEXT', payload: { text: '' } } }]);
              }}
              addLabel={msg.addOutput}
              addLimitLabel={msg.addOutputMax}
              onRemove={(key) => {
                setDirty(true);
                setSaveWarning(null);
                setOutputs((prev) => prev.filter((o) => o.key !== key));
              }}
              itemLabel={(o, i) => `${i + 1}번째 아웃풋(${MESSAGES.dialogue.outputTypes[o.output.type]})`}
              renderItem={(row, index) => (
                <DialogOutputEditor
                  value={row.output}
                  onChange={(next) => {
                    setDirty(true);
                    setSaveWarning(null);
                    setOutputs((prev) => prev.map((o) => (o.key === row.key ? { ...o, output: next } : o)));
                  }}
                  chatbotId={chatbot.id}
                  currentNodeId={nodeId}
                  nodeContextVariableId={contextVariableId}
                  highlightLegacyToken={legacyHighlight?.index === index ? legacyHighlight.token : undefined}
                  idPrefix={`output-${index}`}
                  errorFieldPrefix={`outputs.${index}.payload`}
                  fieldErrors={fieldErrors}
                  allowedHosts={allowedHosts}
                />
              )}
            />
            {/* [신규 No.46] RM-2 — 바로연결 배치 오류(§3.2, 서버 400 폴백은 fieldErrorsFromApiError가 처리). */}
            {quickReplyBanner && (
              <div className="form-banner form-banner--error" role="alert">
                {quickReplyBanner}
              </div>
            )}
          </div>

          {/* [신규 No.46] RM-3 — 채널별 미리보기(상시 노출, D-5 확정). */}
          <div className="node-form-section">
            <ChannelPreviewSection outputs={outputs.map((o) => o.output)} />
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
        environmentStatus={environmentStatus}
      />
    </div>
  );
}
