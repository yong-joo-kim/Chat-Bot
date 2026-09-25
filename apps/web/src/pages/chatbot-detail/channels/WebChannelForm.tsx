import { useState } from 'react';
import { AllowedOriginSchema, type WebChannelConfig } from '@chat-bot/shared-types';
import { ChipListEditor } from '../../../components/ChipListEditor';
import { MESSAGES } from '../../../constants/messages';
import { OriginAllowAllBadge } from './OriginAllowAllBadge';

/** WEB 채널 설정 폼(인라인 확장, FR-11-6, ui-spec §4.4.3). */
export function WebChannelForm({
  initial,
  saving,
  onSave,
  onCancel,
}: {
  initial: WebChannelConfig;
  saving: boolean;
  onSave: (config: WebChannelConfig) => void;
  onCancel: () => void;
}): JSX.Element {
  const msg = MESSAGES.channels;
  const [allowedOrigins, setAllowedOrigins] = useState<string[]>(initial.allowedOrigins);
  const [greetingMessage, setGreetingMessage] = useState(initial.greetingMessage ?? '');
  const [quickReplies, setQuickReplies] = useState<string[]>(initial.quickReplies);
  const [launcherPosition, setLauncherPosition] = useState(initial.launcherPosition);
  const [showLauncher, setShowLauncher] = useState(initial.showLauncher);
  // [신규 No.44] 답변 평가 받기(feedback-loop-ui-spec.md §3.1). 키 없음 = 꺼짐(하위호환).
  const [feedbackEnabled, setFeedbackEnabled] = useState(initial.feedbackEnabled ?? false);

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    // ⚠ config는 전체 교체 시맨틱이다 — feedbackEnabled를 다른 필드와 같은 요청에 항상 포함한다.
    // 빠뜨리면 저장 시 스위치가 조용히 꺼진다(feedback-loop-ui-spec.md §3.1 ⚠).
    onSave({
      allowedOrigins,
      greetingMessage: greetingMessage || undefined,
      quickReplies,
      launcherPosition,
      showLauncher,
      feedbackEnabled,
    });
  }

  return (
    <form className="channel-config-form" onSubmit={handleSubmit}>
      <ChipListEditor
        id="web-channel-origins"
        label={msg.originsLabel}
        values={allowedOrigins}
        onChange={setAllowedOrigins}
        placeholder={msg.originsPlaceholder}
        addLabel={msg.originsAdd}
        maxItems={20}
        limitMessage={msg.originsCount(allowedOrigins.length, 20)}
        validate={(v) => (AllowedOriginSchema.safeParse(v).success ? undefined : msg.originsHint)}
      />
      <p className="field-hint">{msg.originsHint}</p>
      {allowedOrigins.length === 0 && <OriginAllowAllBadge />}

      <div className="form-field">
        <label htmlFor="web-channel-greeting">{msg.greetingLabel}</label>
        <textarea
          id="web-channel-greeting"
          rows={2}
          maxLength={200}
          value={greetingMessage}
          onChange={(e) => setGreetingMessage(e.target.value)}
        />
        <p className="field-hint">{greetingMessage.length}/200</p>
      </div>

      <ChipListEditor
        id="web-channel-quick-replies"
        label={msg.quickRepliesLabel}
        values={quickReplies}
        onChange={setQuickReplies}
        placeholder={msg.quickRepliesPlaceholder}
        addLabel={msg.originsAdd}
        maxItems={5}
        limitMessage={msg.originsCount(quickReplies.length, 5)}
        validate={(v) => (v.length > 20 ? '20자 이하로 입력해 주세요.' : undefined)}
      />

      <fieldset className="form-field" style={{ border: 'none', padding: 0 }}>
        <legend className="field-label-static">{msg.launcherPositionLabel}</legend>
        <label className="form-field--inline">
          <input type="radio" name="launcher-position" checked={launcherPosition === 'RIGHT'} onChange={() => setLauncherPosition('RIGHT')} />
          {msg.launcherPositionRight}
        </label>
        <label className="form-field--inline">
          <input type="radio" name="launcher-position" checked={launcherPosition === 'LEFT'} onChange={() => setLauncherPosition('LEFT')} />
          {msg.launcherPositionLeft}
        </label>
      </fieldset>

      <div className="form-field form-field--inline">
        <input id="web-channel-show-launcher" type="checkbox" checked={showLauncher} onChange={(e) => setShowLauncher(e.target.checked)} />
        <label htmlFor="web-channel-show-launcher">{msg.showLauncherLabel}</label>
      </div>

      <div className="form-field">
        <div className="form-field--inline">
          <input
            id="web-channel-feedback-enabled"
            type="checkbox"
            checked={feedbackEnabled}
            onChange={(e) => setFeedbackEnabled(e.target.checked)}
          />
          <label htmlFor="web-channel-feedback-enabled">{msg.feedbackEnabledLabel}</label>
        </div>
        <p className="field-hint">{msg.feedbackEnabledDesc}</p>
      </div>

      <div className="form-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={saving}>
          {msg.cancel}
        </button>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? MESSAGES.common.saving : msg.save}
        </button>
      </div>
    </form>
  );
}
