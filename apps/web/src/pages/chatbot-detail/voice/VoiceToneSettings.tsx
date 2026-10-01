import { useState } from 'react';
import { SPEECH_TONES, SPEECH_TONE_PARAMS, type SpeechTone } from '@chat-bot/shared-types/speech-voice';
import { MESSAGES } from '../../../constants/messages';
import { DEFAULT_UNANSWERED_TONE } from './voiceForm';
import { VoiceToneRadioGroup } from './VoiceFields';

/**
 * VO-C4 말투 설정 — 기본 말투 + 미응답(폴백) 안내 말투 라디오 2그룹, 우선순위 안내(접이식), 말투 값 표(접이식 · 읽기 전용).
 * 표는 코드의 `SPEECH_TONE_PARAMS`를 **그대로 읽어 렌더**한다(화면 문구에 숫자를 따로 적지 않는다 — 값이 바뀌어도 어긋나지 않게).
 * 지정 가능한 응답 종류는 미응답 1종뿐이다(설계 §4.1 `VoiceToneByKindSchema`).
 */
export function VoiceToneSettings({
  idPrefix,
  defaultTone,
  unansweredTone,
  onChangeDefault,
  onChangeUnanswered,
  disabled,
}: {
  idPrefix: string;
  defaultTone: SpeechTone;
  unansweredTone: SpeechTone;
  onChangeDefault: (tone: SpeechTone) => void;
  onChangeUnanswered: (tone: SpeechTone) => void;
  disabled: boolean;
}): JSX.Element {
  const msg = MESSAGES.voice;
  const [orderOpen, setOrderOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  return (
    <section className="voice-block" aria-labelledby={`${idPrefix}-tone-title`}>
      <h4 id={`${idPrefix}-tone-title`}>{msg.toneGroupTitle}</h4>
      <VoiceToneRadioGroup
        name={`${idPrefix}-default-tone`}
        legend={msg.toneDefaultLegend}
        help={msg.toneDefaultHelp}
        value={defaultTone}
        onChange={onChangeDefault}
        disabled={disabled}
      />
      <VoiceToneRadioGroup
        name={`${idPrefix}-unanswered-tone`}
        legend={msg.toneUnansweredLegend}
        help={msg.toneUnansweredHelp}
        value={unansweredTone}
        onChange={onChangeUnanswered}
        disabled={disabled}
        defaultMarkFor={DEFAULT_UNANSWERED_TONE}
      />
      <p className="field-hint">
        <span aria-hidden="true">ⓘ</span> {msg.toneSafetyFixed}
      </p>
      <p className="field-hint">
        <span aria-hidden="true">ⓘ</span> {msg.toneNoContent}
      </p>

      <button type="button" className="btn btn-secondary voice-disclosure" aria-expanded={orderOpen} aria-controls={`${idPrefix}-order`} onClick={() => setOrderOpen((v) => !v)}>
        {msg.toneOrderToggle}
      </button>
      {orderOpen && (
        <ol id={`${idPrefix}-order`} className="voice-order-list">
          {msg.toneOrderItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      )}

      <button type="button" className="btn btn-secondary voice-disclosure" aria-expanded={guideOpen} aria-controls={`${idPrefix}-guide`} onClick={() => setGuideOpen((v) => !v)}>
        {msg.toneGuideToggle}
      </button>
      {guideOpen && (
        <div id={`${idPrefix}-guide`} className="voice-guide">
          <p className="field-hint">{msg.toneProvisional}</p>
          <div className="dialogue-table-wrap">
            <table className="dialogue-table">
              <caption className="sr-only">{msg.toneGuideCaption}</caption>
              <thead>
                <tr>
                  <th scope="col">{msg.toneGuideColName}</th>
                  <th scope="col">{msg.toneGuideColFeel}</th>
                  <th scope="col">rate</th>
                  <th scope="col">pitch</th>
                  <th scope="col">volume</th>
                  <th scope="col">{msg.toneGuideColStatus}</th>
                </tr>
              </thead>
              <tbody>
                {SPEECH_TONES.map((tone) => (
                  <tr key={tone}>
                    <th scope="row">
                      {msg.toneNames[tone]} <span className="field-hint">({tone})</span>
                    </th>
                    <td>{msg.toneFeel[tone]}</td>
                    <td>{SPEECH_TONE_PARAMS[tone].rate.toFixed(2)}</td>
                    <td>{SPEECH_TONE_PARAMS[tone].pitch.toFixed(2)}</td>
                    <td>{SPEECH_TONE_PARAMS[tone].volume.toFixed(1)}</td>
                    <td>{msg.toneGuideStatus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="field-hint">{msg.toneGuideBounds}</p>
        </div>
      )}
    </section>
  );
}
