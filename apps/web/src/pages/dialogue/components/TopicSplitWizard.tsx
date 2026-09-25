import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ChatbotGroupWithCount, Topic, TopicSplitPreview, TopicSplitResult } from '@chat-bot/shared-types';
import { TOPIC_SPLIT_LIMITS } from '@chat-bot/shared-types';
import { Modal } from '../../../components/Modal';
import { SkeletonRow } from '../../../components/Skeleton';
import { ErrorState } from '../../../components/ErrorState';
import { SlugAvailabilityField, type SlugCheckStatus } from '../../../components/SlugAvailabilityField';
import { InlineFieldError } from '../../../components/InlineFieldError';
import { MESSAGES } from '../../../constants/messages';
import { topicsApi } from '../../../api/topics';
import { groupsApi } from '../../../api/groups';
import { ApiError } from '../../../api/client';
import { formatDateTime } from '../../../lib/date';

export interface TopicSplitWizardProps {
  isOpen: boolean;
  chatbotId: string;
  topics: Topic[];
  onClose: () => void;
}

// [코드 리뷰 1회차 L-3] 하드코딩 한글 라벨을 `MESSAGES.topics.assetCountFieldLabel`로 옮겼다.
const COUNT_LABEL = MESSAGES.topics.assetCountFieldLabel;

function countsSummary(counts: Record<string, number>): string {
  return Object.entries(counts)
    .filter(([k]) => COUNT_LABEL[k])
    .map(([k, v]) => `${COUNT_LABEL[k]} ${v}`)
    .join(' · ');
}

/**
 * `TopicSplitWizard` — TP0 안의 4단계 모달(`topic-system-ui-spec.md` §3.7). 독립 라우트를 갖지
 * 않는다. 진행 중(§3.7.4)에는 `Esc`·배경 클릭을 비활성화한다.
 */
export function TopicSplitWizard({ isOpen, chatbotId, topics, onClose }: TopicSplitWizardProps): JSX.Element {
  const msg = MESSAGES.topics;
  const navigate = useNavigate();

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>([]);
  const [includeCommon, setIncludeCommon] = useState(false);
  const [systemNodeLinks, setSystemNodeLinks] = useState<'TRIM' | 'FOLLOW'>('TRIM');

  const [preview, setPreview] = useState<TopicSplitPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [showAllTrimmed, setShowAllTrimmed] = useState(false);
  const [showAllClosure, setShowAllClosure] = useState(false);
  const [showAllFollowed, setShowAllFollowed] = useState(false);

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugStatus, setSlugStatus] = useState<SlugCheckStatus>('idle');
  const [groups, setGroups] = useState<ChatbotGroupWithCount[]>([]);
  const [targetGroupId, setTargetGroupId] = useState<string | undefined>(undefined);
  const [step3Errors, setStep3Errors] = useState<{ slug?: string; group?: string }>({});

  const [submitting, setSubmitting] = useState(false);
  const [busyBanner, setBusyBanner] = useState(false);
  const [result, setResult] = useState<TopicSplitResult | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setStep(1);
    setSelectedTopicIds([]);
    setIncludeCommon(false);
    setSystemNodeLinks('TRIM');
    setPreview(null);
    setPreviewError(false);
    setName('');
    setSlug('');
    setStep3Errors({});
    setResult(null);
    setBusyBanner(false);
    groupsApi
      .list()
      .then((res) => setGroups(res.items))
      .catch(() => setGroups([]));
  }, [isOpen]);

  const fetchPreview = useCallback(async () => {
    setPreviewLoading(true);
    setPreviewError(false);
    try {
      const res = await topicsApi.splitPreview(chatbotId, { topicIds: selectedTopicIds, includeCommon, systemNodeLinks });
      setPreview(res);
    } catch {
      setPreviewError(true);
    } finally {
      setPreviewLoading(false);
    }
  }, [chatbotId, selectedTopicIds, includeCommon, systemNodeLinks]);

  async function goToStep2(): Promise<void> {
    setStep(2);
    setShowAllTrimmed(false);
    setShowAllClosure(false);
    setShowAllFollowed(false);
    await fetchPreview();
  }

  function toggleTopic(id: string): void {
    setSelectedTopicIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function handleClose(): void {
    if (submitting) return;
    onClose();
  }

  async function handleSplit(): Promise<void> {
    if (submitting) return;
    setSubmitting(true);
    setBusyBanner(false);
    setStep3Errors({});
    try {
      const res = await topicsApi.split(chatbotId, {
        topicIds: selectedTopicIds,
        includeCommon,
        systemNodeLinks,
        name: name.trim() || undefined,
        slug: slug.trim() || undefined,
        targetGroupId,
      });
      setResult(res);
      setStep(4);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'TOPIC_SPLIT_TOO_LARGE') {
        setStep(2);
        await fetchPreview();
      } else if (e instanceof ApiError && e.code === 'TOPIC_SPLIT_BUSY') {
        setBusyBanner(true);
      } else if (e instanceof ApiError && e.code === 'DUPLICATE_SLUG') {
        setStep3Errors({ slug: msg.splitStep3DuplicateSlug });
      } else if (e instanceof ApiError && e.status === 404) {
        setStep3Errors({ group: msg.splitStep3ArchivedGroup });
      } else {
        setBusyBanner(true);
      }
    } finally {
      setSubmitting(false);
    }
  }

  const step1NextDisabled = selectedTopicIds.length === 0 && !includeCommon;
  const exceeded = preview?.exceeded ?? [];
  const step2NextDisabled = previewLoading || previewError || !preview || exceeded.length > 0;

  const trimmedItems = preview?.trimmedLinks.items ?? [];
  const closureItems = preview?.closureItems.items ?? [];
  const followedItems = preview?.followedSystemLinks.items ?? [];
  const visibleTrimmed = showAllTrimmed ? trimmedItems : trimmedItems.slice(0, 50);
  const visibleClosure = showAllClosure ? closureItems : closureItems.slice(0, 50);
  const visibleFollowed = showAllFollowed ? followedItems : followedItems.slice(0, 50);

  return (
    <Modal
      isOpen={isOpen}
      title={msg.splitDialogTitle}
      onClose={handleClose}
      closeOnEsc={!submitting}
      initialFocusSelector={step === 1 ? undefined : '[data-autofocus="cancel"]'}
    >
      <p className="wizard-step-indicator" role="status">
        {msg.splitStepIndicator(step, 4)}
      </p>

      {step === 1 && (
        <div>
          <p>{msg.splitStep1Title}</p>
          <fieldset className="form-field" style={{ border: 'none', padding: 0 }}>
            <legend className="field-label-static">{msg.splitStep1TopicsLabel}</legend>
            {topics.map((t) => (
              <label key={t.id} className="form-field--inline">
                <input type="checkbox" checked={selectedTopicIds.includes(t.id)} onChange={() => toggleTopic(t.id)} disabled={includeCommon} />
                {t.name}({t.enabled ? MESSAGES.topics.statusActive : MESSAGES.topics.statusInactive})
              </label>
            ))}
          </fieldset>
          <label className="form-field--inline">
            <input
              type="checkbox"
              checked={includeCommon}
              onChange={(e) => {
                setIncludeCommon(e.target.checked);
              }}
            />
            {msg.splitStep1IncludeCommonLabel}
          </label>

          {!includeCommon && (
            <fieldset className="form-field" style={{ border: 'none', padding: 0 }}>
              <legend className="field-label-static">{msg.splitStep1SystemLinksLabel}</legend>
              <label className="form-field--inline">
                <input type="radio" name="split-system-links" checked={systemNodeLinks === 'TRIM'} onChange={() => setSystemNodeLinks('TRIM')} />
                {msg.splitStep1SystemLinksTrim}
              </label>
              <label className="form-field--inline">
                <input type="radio" name="split-system-links" checked={systemNodeLinks === 'FOLLOW'} onChange={() => setSystemNodeLinks('FOLLOW')} />
                {msg.splitStep1SystemLinksFollow}
              </label>
            </fieldset>
          )}
          {step1NextDisabled && <p className="field-hint">{msg.splitStep1NextDisabledHint}</p>}

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              {MESSAGES.common.cancel}
            </button>
            <button type="button" className="btn btn-primary" disabled={step1NextDisabled} aria-disabled={step1NextDisabled} onClick={() => void goToStep2()}>
              {MESSAGES.common.confirm}
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          {previewLoading && (
            <p role="status" aria-live="polite">
              {msg.splitPreviewLoading}
            </p>
          )}
          {!previewLoading && previewError && <ErrorState title={msg.splitPreviewFailed} onRetry={() => void fetchPreview()} />}
          {!previewLoading && !previewError && preview && (
            <>
              <p>
                {msg.splitStep2Title}: {countsSummary(preview.selected)}
              </p>
              <p>{msg.splitStep2ClosureTitle(preview.closureItems.total)}</p>
              {closureItems.length > 0 && (
                <>
                  <ul className="topic-split-list">
                    {visibleClosure.map((c) => (
                      <li key={`${c.kind}-${c.id}`}>{c.name}</li>
                    ))}
                  </ul>
                  {closureItems.length > 50 && (
                    <button type="button" className="link-button" onClick={() => setShowAllClosure((v) => !v)}>
                      {showAllClosure ? MESSAGES.common.close : msg.splitStep2ListMore(preview.closureItems.total - 50)}
                    </button>
                  )}
                </>
              )}
              {preview.closureDominates && (
                <p className="form-banner form-banner--warning" role="status">
                  <span aria-hidden="true">⚠</span> {msg.splitStep2ClosureDominatesWarning}
                </p>
              )}
              <p>{msg.splitStep2SystemNodesLine(preview.systemNodes.start, preview.systemNodes.fallback)}</p>

              <p className="field-label-static">{msg.splitStep2TrimmedLinksTitle(preview.trimmedLinks.total)}</p>
              {trimmedItems.length === 0 ? (
                <p className="field-hint">—</p>
              ) : (
                <>
                  <ul className="topic-split-list">
                    {visibleTrimmed.map((l, i) => (
                      <li key={i}>
                        [{MESSAGES.topics.edgeLabel[l.edge] ?? l.edge}] {l.nodeName} → {l.targetName}({l.targetTopicName})
                      </li>
                    ))}
                  </ul>
                  {trimmedItems.length > 50 && (
                    <button type="button" className="link-button" onClick={() => setShowAllTrimmed((v) => !v)}>
                      {showAllTrimmed ? MESSAGES.common.close : msg.splitStep2ListMore(preview.trimmedLinks.total - 50)}
                    </button>
                  )}
                </>
              )}
              <p className="field-label-static">{msg.splitStep2FollowedLinksTitle(preview.followedSystemLinks.total)}</p>
              {followedItems.length === 0 ? (
                <p className="field-hint">—</p>
              ) : (
                <>
                  <ul className="topic-split-list">
                    {visibleFollowed.map((l, i) => (
                      <li key={i}>
                        [{MESSAGES.topics.edgeLabel[l.edge] ?? l.edge}] {l.nodeName} → {l.targetName}({l.targetTopicName})
                        {l.reason === 'TRIM_WOULD_EMPTY' && <span className="field-hint"> — {MESSAGES.topics.trimmedLinkReasonTrimWouldEmpty}</span>}
                      </li>
                    ))}
                  </ul>
                  {followedItems.length > 50 && (
                    <button type="button" className="link-button" onClick={() => setShowAllFollowed((v) => !v)}>
                      {showAllFollowed ? MESSAGES.common.close : msg.splitStep2ListMore(preview.followedSystemLinks.total - 50)}
                    </button>
                  )}
                </>
              )}
              <p>
                {msg.splitStep2SurveysDuplicated(preview.selected.surveys)} · {msg.splitStep2ApiConnectionsKept(preview.apiConnectionsKept)}
              </p>
              <p className="field-label-static">{msg.splitStep2NotCopiedTitle}</p>
              <p className="field-hint">{preview.notCopied.map((k) => MESSAGES.topics.notCopiedItemLabels[k]).join(' · ')}</p>

              <p className="field-label-static">{msg.splitStep2SizeEstimateTitle}</p>
              <ul className="topic-split-list">
                {(Object.keys(TOPIC_SPLIT_LIMITS) as (keyof typeof TOPIC_SPLIT_LIMITS)[]).map((k) => {
                  const count = preview.totals[k as keyof typeof preview.totals] ?? 0;
                  const limit = TOPIC_SPLIT_LIMITS[k];
                  const isExceeded = exceeded.includes(k);
                  return (
                    <li key={k} className={isExceeded ? 'topic-split-exceeded' : undefined}>
                      {isExceeded ? msg.splitStep2ExceededLabel(COUNT_LABEL[k] ?? k, count, limit) : `${COUNT_LABEL[k] ?? k} ${count}/${limit}`}
                    </li>
                  );
                })}
              </ul>
              {exceeded.length > 0 && (
                <p className="form-banner form-banner--error" role="alert">
                  {msg.splitTooLargeError}
                </p>
              )}
            </>
          )}

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setStep(1)}>
              {MESSAGES.common.cancel}
            </button>
            <button type="button" className="btn btn-primary" disabled={step2NextDisabled} aria-disabled={step2NextDisabled} onClick={() => setStep(3)}>
              {MESSAGES.common.confirm}
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div>
          {busyBanner && (
            <p className="form-banner form-banner--error" role="alert">
              {msg.splitBusyError}
            </p>
          )}
          <div className="form-field">
            <label htmlFor="split-name">{msg.splitStep3NameLabel}</label>
            <input id="split-name" type="text" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
            <p className="field-hint">{msg.splitStep3NameAutoHint}</p>
          </div>
          <SlugAvailabilityField id="split-slug" label={msg.splitStep3SlugLabel} value={slug} onChange={setSlug} externalError={step3Errors.slug} onStatusChange={setSlugStatus} required={false} />
          <p className="field-hint">{msg.splitStep3SlugAutoHint}</p>
          <div className="form-field">
            <label htmlFor="split-group">{msg.splitStep3GroupLabel}</label>
            <select id="split-group" value={targetGroupId ?? ''} onChange={(e) => setTargetGroupId(e.target.value || undefined)}>
              <option value="">원본과 동일</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            <InlineFieldError id="split-group-error" message={step3Errors.group} />
          </div>
          <p className="field-hint">
            <span aria-hidden="true">ⓘ</span> {msg.splitStep3DraftNotice}
          </p>
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setStep(2)} disabled={submitting}>
              {MESSAGES.common.cancel}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={submitting || slugStatus === 'unavailable'}
              onClick={() => void handleSplit()}
            >
              {submitting ? msg.splitRunning : msg.splitAction}
            </button>
          </div>
        </div>
      )}

      {step === 4 && result && (
        <div>
          <p role="status">
            <span aria-hidden="true">✔</span> {msg.splitStep4Success(result.chatbot.name)}
          </p>
          <p>{countsSummary(result.totals)}</p>
          <p>
            {msg.splitStep4ClosureIncluded(Object.values(result.closureAdded).reduce((a, b) => a + b, 0))} · {msg.splitStep2TrimmedLinksTitle(result.trimmedLinks)} ·{' '}
            {msg.splitStep2SurveysDuplicated(result.surveysCopied)}
          </p>
          <p>{msg.splitStep4DesignCheckSummary(result.designCheck.error, result.designCheck.warning, result.designCheck.info)}</p>
          <p className="field-hint">{formatDateTime(result.capturedAt)}</p>
          <p className="field-hint">{msg.splitStep4ReindexingNotice}</p>
          <p className="field-label-static">{msg.splitStep4NotCopiedTitle}</p>
          <p className="field-hint">{result.notCopied.map((k) => MESSAGES.topics.notCopiedItemLabels[k]).join(' · ')}</p>
          <p className="field-hint">
            {msg.splitStep4OriginalDisableHint}{' '}
            <button
              type="button"
              className="link-button"
              onClick={() => {
                onClose();
              }}
            >
              {msg.splitStep4GoToOriginalTopics}
            </button>
          </p>
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              {msg.splitStep4Close}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                const newId = result.chatbot.id;
                onClose();
                navigate(`/chatbots/${newId}`);
              }}
            >
              {msg.splitStep4GoToChatbot}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
