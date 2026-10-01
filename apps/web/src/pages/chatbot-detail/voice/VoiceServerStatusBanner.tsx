import type { VoiceOverviewResponse } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../constants/messages';

type ServerStatus = VoiceOverviewResponse['server'];

/** "● 사용 가능" → 아이콘(`aria-hidden`) + 글자로 나눈다. 글자는 항상 병기한다(UIUX §1). */
function splitBadge(badge: string): { icon: string; label: string } {
  const i = badge.indexOf(' ');
  return { icon: badge.slice(0, i), label: badge.slice(i + 1) };
}

/** 배너 종류별 색 + 텍스트 병기(UIUX §1 — 색만으로 전달 금지, 아이콘은 `aria-hidden`). */
function statusView(server: ServerStatus): { tone: 'success' | 'warning' | 'info'; badge: string; text: string } {
  const msg = MESSAGES.voice;
  if (server.inputAvailable) {
    return server.provider === 'mock'
      ? { tone: 'warning', badge: msg.serverMockBadge, text: msg.serverMock }
      : { tone: 'success', badge: msg.serverOkBadge, text: msg.serverOk };
  }
  switch (server.reason) {
    case 'SERVER_DISABLED':
      return { tone: 'info', badge: msg.serverDisabledBadge, text: msg.serverDisabled };
    case 'NOT_CONFIGURED':
      return { tone: 'warning', badge: msg.serverNotConfiguredBadge, text: msg.serverNotConfigured };
    default:
      // `PROVIDER_UNAVAILABLE`와 알 수 없는 사유 — 원인을 더 쪼개 단정하지 않는다(설계 DD-135 ③ · 명세 F-5).
      return { tone: 'warning', badge: msg.serverUnavailableBadge, text: msg.serverUnavailable };
  }
}

/** VO-C2 ① 서버 음성 인식 상태 — 모델 이름·장치·주소는 어디에도 싣지 않는다. 정적 정보라 `aria-live`로 낭독하지 않는다. */
export function VoiceServerStatusBanner({ server, inputEnabled }: { server: ServerStatus; inputEnabled: boolean }): JSX.Element {
  const msg = MESSAGES.voice;
  const view = statusView(server);
  const badge = splitBadge(view.badge);
  return (
    <div className="voice-banners">
      <div className={`form-banner form-banner--${view.tone} voice-banner`} data-testid="voice-server-status">
        <p className="voice-banner-title">
          <span aria-hidden="true">{badge.icon}</span> <strong>{badge.label}</strong>
        </p>
        <p>{view.text}</p>
        {!server.inputAvailable && inputEnabled && <p>{msg.inputOnButUnavailable}</p>}
      </div>
    </div>
  );
}

/**
 * VO-C2 ② 개통 전 법무 확인 경고 — 상시 · 닫기 없음 · 켜기를 막지 않는다(운영 절차 게이트이며 가짜 게이트를 만들지 않는다 —
 * DD-133 · K-13). `id`는 음성 입력 스위치 설명에 `aria-describedby`로 연결된다.
 */
export function VoiceLegalNotice({ id }: { id: string }): JSX.Element {
  const msg = MESSAGES.voice;
  return (
    <div className="form-banner form-banner--warning voice-banner" id={id} data-testid="voice-legal-notice">
      <p className="voice-banner-title">
        <span aria-hidden="true">⚠</span> <strong>{splitBadge(msg.legalBadge).label}</strong>
      </p>
      <p>{msg.legalNotice}</p>
      <p className="field-hint">{msg.legalChecklistSource}</p>
    </div>
  );
}

/** VO-C2 ③ 맥락 배너(웹 채널 꺼짐 · 챗봇 비공개). */
export function VoiceContextBanners({ context }: { context: VoiceOverviewResponse['context'] }): JSX.Element | null {
  const msg = MESSAGES.voice;
  if (context.webChannelEnabled && context.chatbotStatus === 'ACTIVE') return null;
  return (
    <div className="voice-banners">
      {!context.webChannelEnabled && <p className="form-banner form-banner--info">{msg.webChannelOff}</p>}
      {context.chatbotStatus !== 'ACTIVE' && <p className="form-banner form-banner--info">{msg.notPublic}</p>}
    </div>
  );
}

/** VO-C 스냅샷·환경 밖 안내(K-9). */
export function VoiceNotInVersionNotice(): JSX.Element {
  return (
    <p className="form-banner form-banner--info voice-banner" role="note">
      <span aria-hidden="true">ⓘ</span> {MESSAGES.voice.notInVersion}
    </p>
  );
}
