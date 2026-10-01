import { SPEECH_LIMITS } from '@chat-bot/shared-types';
import type { VoiceNodeToneView, VoiceSettingsInput, VoiceSettingsView } from '@chat-bot/shared-types';
import type { SpeechTone } from '@chat-bot/shared-types/speech-voice';

/** 서버 내장 기본 미응답(폴백) 안내 말투 — `toneByKind.UNANSWERED`가 없을 때 화면이 보이는 값(설계 §6.2). */
export const DEFAULT_UNANSWERED_TONE: SpeechTone = 'APOLOGETIC';

/**
 * 콘솔 폼 상태 — 읽기 속도는 입력 도중 "1.23"처럼 단위가 어긋난 값도 그대로 보여 저장 시점에 인라인 오류를 내야 하므로
 * 숫자가 아니라 **문자열**로 들고 있는다(voice-ai-ui-spec §3.3).
 */
export interface VoiceFormState {
  inputEnabled: boolean;
  ttsEnabled: boolean;
  autoReadToggleVisible: boolean;
  rateText: string;
  defaultTone: SpeechTone;
  unansweredTone: SpeechTone;
  /** 서버에 미응답 말투가 명시 저장돼 있었거나 사용자가 바꿨는가 — 아니면 저장 시 키를 생략해 "기본값" 의미를 보존한다. */
  unansweredExplicit: boolean;
  nodeTones: VoiceNodeToneView[];
}

export function fromView(view: VoiceSettingsView): VoiceFormState {
  const explicit = view.toneByKind.UNANSWERED !== undefined;
  return {
    inputEnabled: view.inputEnabled,
    ttsEnabled: view.ttsEnabled,
    autoReadToggleVisible: view.autoReadToggleVisible,
    rateText: view.rateMultiplier.toFixed(2),
    defaultTone: view.defaultTone,
    unansweredTone: view.toneByKind.UNANSWERED ?? DEFAULT_UNANSWERED_TONE,
    unansweredExplicit: explicit,
    nodeTones: view.nodeTones.map((n) => ({ ...n })),
  };
}

export type RateProblem = 'range' | 'step' | null;

/** 읽기 속도 검증 — 0.8~1.2 · 0.05 단위(부동소수 오차 없이 ×100 정수로 검사, 서버 스키마와 같은 규칙). */
export function validateRate(text: string): RateProblem {
  const v = Number(text);
  if (text.trim() === '' || !Number.isFinite(v)) return 'range';
  if (v < SPEECH_LIMITS.rateMultiplier.min || v > SPEECH_LIMITS.rateMultiplier.max) return 'range';
  const scaled = Math.round(v * 100);
  if (Math.abs(scaled - v * 100) > 1e-6 || scaled % 5 !== 0) return 'step';
  return null;
}

/** 입력 중 문자열을 슬라이더 값으로(범위 밖·숫자 아님은 가장 가까운 유효 값으로 — 표시용). */
export function rateForSlider(text: string): number {
  const v = Number(text);
  if (!Number.isFinite(v) || text.trim() === '') return 1;
  return Math.min(SPEECH_LIMITS.rateMultiplier.max, Math.max(SPEECH_LIMITS.rateMultiplier.min, v));
}

export function toInput(form: VoiceFormState): VoiceSettingsInput {
  const sendUnanswered = form.unansweredExplicit || form.unansweredTone !== DEFAULT_UNANSWERED_TONE;
  return {
    inputEnabled: form.inputEnabled,
    ttsEnabled: form.ttsEnabled,
    autoReadToggleVisible: form.autoReadToggleVisible,
    rateMultiplier: Number(form.rateText),
    defaultTone: form.defaultTone,
    toneByKind: sendUnanswered ? { UNANSWERED: form.unansweredTone } : {},
    nodeTones: form.nodeTones.map((n) => ({ nodeId: n.nodeId, tone: n.tone })),
  };
}

export function isDirty(a: VoiceFormState, b: VoiceFormState): boolean {
  return JSON.stringify(toComparable(a)) !== JSON.stringify(toComparable(b));
}

function toComparable(f: VoiceFormState): unknown {
  return [f.inputEnabled, f.ttsEnabled, f.autoReadToggleVisible, Number(f.rateText), f.rateText.trim(), f.defaultTone, f.unansweredTone, f.nodeTones.map((n) => [n.nodeId, n.tone])];
}

/** `INVALID_REFERENCE` 오류 상세 메시지("노드를 찾을 수 없습니다: {id}")에서 문제 노드 id를 뽑는다. */
export function missingNodeIdsFromDetails(details: Array<{ message: string }> | undefined): string[] {
  if (!details) return [];
  return details
    .map((d) => d.message.split(': ').pop() ?? '')
    .filter((id) => /^[0-9a-f-]{36}$/i.test(id));
}
