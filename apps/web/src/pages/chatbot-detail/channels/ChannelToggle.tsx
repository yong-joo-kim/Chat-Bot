import { MESSAGES } from '../../../constants/messages';

/**
 * `aria-disabled` + 사유 안내를 갖는 토글(NFR-A3, AC-11-12). `disabled` 속성은 쓰지 않는다 —
 * 포커스를 받지 못해 스크린리더가 인접한 사유 텍스트에 도달할 경로가 없기 때문이다(ui-spec §4.4.2).
 */
export function ChannelToggle({
  id,
  enabled,
  locked,
  reason,
  onToggle,
}: {
  id: string;
  enabled: boolean;
  locked: boolean;
  reason?: string;
  onToggle: () => void;
}): JSX.Element {
  const reasonId = `${id}-reason`;
  return (
    <div className="channel-toggle-wrap">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-disabled={locked || undefined}
        aria-describedby={locked && reason ? reasonId : undefined}
        className={`channel-toggle${locked ? ' channel-toggle--locked' : ''}`}
        onClick={() => {
          if (locked) return;
          onToggle();
        }}
      >
        <span aria-hidden="true">{locked ? '🔒' : enabled ? '●' : '○'}</span> {enabled ? MESSAGES.channels.toggleOn : MESSAGES.channels.toggleOff}
      </button>
      {locked && reason && (
        <p id={reasonId} className="channel-toggle-reason">
          {reason}
        </p>
      )}
    </div>
  );
}
