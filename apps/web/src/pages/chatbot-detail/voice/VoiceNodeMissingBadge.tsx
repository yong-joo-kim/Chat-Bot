import { MESSAGES } from '../../../constants/messages';

/** 노드 꼬리표의 노드가 삭제된 경우(`nodeMissing`) — 주의색 + 텍스트 병기(UIUX §1). 행은 자동으로 지우지 않는다(설계 §10.1). */
export function VoiceNodeMissingBadge(): JSX.Element {
  const text = MESSAGES.voice.nodeMissingBadge;
  const i = text.indexOf(' ');
  return (
    <span className="channel-status-badge voice-badge-warning">
      <span aria-hidden="true">{text.slice(0, i)}</span> {text.slice(i + 1)}
    </span>
  );
}
