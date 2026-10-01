import { SPEECH_TONES } from '@chat-bot/shared-types';
import type { SpeechReplyPlan, SpeechResponseKind, SpeechTone } from '@chat-bot/shared-types';
import type { VoiceSettings } from './voice-settings-codec';

/**
 * [신규 No.32] 말투 결정(voice-ai-설계.md §6.2 · DD-127) — **`speech.tone` 값을 만드는 함수는 이 파일 1개**다(봉인 VO-10).
 * 규칙 기반 — 판정 모델 호출 0 · 글자 내용 변경 0. 결과는 닫힌 4종 식별자 중 하나뿐이다.
 *
 * 우선순위: `SAFETY` 고정(CALM) > 노드 꼬리표(`ANSWERED`·`UNANSWERED`이고 엔진 결과 `matchedNodeId`가 꼬리표에 있을 때) >
 * 종류 규칙(`UNANSWERED` → `toneByKind.UNANSWERED ?? APOLOGETIC`) > `defaultTone`(`ANSWERED`).
 * [H-3] 시스템 안내(BLOCKED·ERROR·WAITING)는 읽기 대상이 아니라 종류 자체가 없다.
 */

/** `SAFETY` 고정 말투 — 관리자가 바꿀 수 없다(FR-VO4-4). */
export const SAFETY_TONE: SpeechTone = 'CALM';
/** 미응답(폴백) 안내의 내장 기본 말투 — `toneByKind.UNANSWERED`가 없을 때. */
export const UNANSWERED_DEFAULT_TONE: SpeechTone = 'APOLOGETIC';

export function isSpeechToneValue(value: unknown): value is SpeechTone {
  return typeof value === 'string' && (SPEECH_TONES as readonly string[]).includes(value);
}

/** 설정 → 대화 턴 1회 계획(말투 이름만 — 글자 0). */
export function buildSpeechReplyPlan(settings: VoiceSettings): SpeechReplyPlan {
  return {
    answeredTone: settings.defaultTone,
    unansweredTone: settings.toneByKind.UNANSWERED ?? UNANSWERED_DEFAULT_TONE,
    nodeTones: new Map(settings.nodeTones.map((n) => [n.nodeId, n.tone] as const)),
  };
}

export function decideSpeechTone(plan: SpeechReplyPlan, kind: SpeechResponseKind, matchedNodeId?: string | null): SpeechTone {
  if (kind === 'SAFETY') return SAFETY_TONE;
  if (matchedNodeId) {
    const nodeTone = plan.nodeTones.get(matchedNodeId);
    if (nodeTone) return nodeTone;
  }
  return kind === 'UNANSWERED' ? plan.unansweredTone : plan.answeredTone;
}
