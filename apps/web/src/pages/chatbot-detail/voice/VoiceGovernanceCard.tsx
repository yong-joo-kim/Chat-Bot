import type { GovernanceMapResponse } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../constants/messages';

type SpeechMap = NonNullable<GovernanceMapResponse['speech']>;

/**
 * VO-C8 데이터 지도 — 음성 카드. 응답에 선택 키 `speech`가 있을 때만 렌더된다(기본 설치의 지도 화면은 바뀌지 않는다). 읽기 전용 —
 * 콘솔에서 바꿀 수 있는 값이 없다. 문구는 **서버가 준 불리언·열거값만 보고 고정 문구를 고른다**(문구를 서버가 내려 주지 않는다 — 표기 통일 1곳).
 * 알 수 없는 값은 "확인 필요"로 표시하고 오류로 죽지 않는다.
 */
export function VoiceGovernanceCard({ map }: { map: SpeechMap }): JSX.Element {
  const msg = MESSAGES.voice.governance;
  const providerLabel = map.provider === 'local' ? msg.providerLocal : map.provider === 'mock' ? msg.providerMock : msg.providerUnknown;
  // 느슨하게 비교한다 — 서버가 계약 밖 값을 보내도 "확인 필요"로 안전하게 떨어진다(타입은 리터럴이지만 런타임은 아니다).
  const audioKnown = map.audioStored === false && map.audioDiskWrite === false;
  const transcriptKnown = (map.transcriptStored as string) === 'ONLY_WHEN_SENT';
  const ttsKnown = (map.ttsLocation as string) === 'USER_DEVICE' && map.ttsServerEgress === false && map.onlineVoicesExcluded === true;
  const countersKnown = (map.counters as string) === 'CHATBOT_DAILY_COUNTS_ONLY';
  return (
    <section className="settings-card voice-governance-card" aria-labelledby="voice-governance-title">
      <h2 id="voice-governance-title">{msg.title}</h2>
      <p>
        {map.provider === 'mock' && <span aria-hidden="true">⚠ </span>}
        {msg.serverLine(map.serverEnabled, providerLabel)}
      </p>
      <p>{msg.countsLine(map.chatbotsInputEnabled, map.chatbotsTtsEnabled)}</p>
      <p>{audioKnown ? msg.audioLine : msg.audioUnknown}</p>
      <p>{transcriptKnown ? msg.transcriptLine : msg.transcriptUnknown}</p>
      <p>{ttsKnown ? msg.ttsLine : msg.ttsUnknown}</p>
      <p>{countersKnown ? msg.countersLine : msg.countersUnknown}</p>
      <p className="field-hint">
        <span aria-hidden="true">ⓘ</span> {msg.hint}
      </p>
    </section>
  );
}
