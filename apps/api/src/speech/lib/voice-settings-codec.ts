import { SPEECH_LIMITS } from '@chat-bot/shared-types';
import type { SpeechTone, VoiceSettingsInput, VoiceToneByKind } from '@chat-bot/shared-types';

/**
 * [신규 No.32] 음성 설정 행 ↔ DTO(voice-ai-설계.md §2.3). JSON 컬럼은 **안전하게** 파싱한다 — 깨졌거나 모르는 값이면 해당 항목만 기본값
 * (한 챗봇의 불량 행이 공개 설정·대화 경로를 깨뜨리지 않게 한다). 순수 — DB·Nest·시계 무의존.
 */
export interface VoiceSettings {
  inputEnabled: boolean;
  ttsEnabled: boolean;
  autoReadToggleVisible: boolean;
  rateMultiplier: number;
  defaultTone: SpeechTone;
  toneByKind: VoiceToneByKind;
  nodeTones: Array<{ nodeId: string; tone: SpeechTone }>;
}

export interface VoiceSettingsRow {
  inputEnabled: boolean;
  ttsEnabled: boolean;
  autoReadToggleVisible: boolean;
  rateMultiplier: number;
  defaultTone: string;
  toneByKind: string;
  nodeTones: string;
}

const TONES: readonly string[] = ['CALM', 'BRIGHT', 'APOLOGETIC', 'INFORMATIVE'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const DEFAULT_VOICE_SETTINGS: Readonly<VoiceSettings> = Object.freeze({
  inputEnabled: false,
  ttsEnabled: false,
  autoReadToggleVisible: true,
  rateMultiplier: 1.0,
  defaultTone: 'CALM' as SpeechTone,
  toneByKind: Object.freeze({}) as VoiceToneByKind,
  nodeTones: Object.freeze([]) as unknown as Array<{ nodeId: string; tone: SpeechTone }>,
});

function isTone(value: unknown): value is SpeechTone {
  return typeof value === 'string' && TONES.includes(value);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function decodeToneByKind(json: string): VoiceToneByKind {
  const parsed = parseJson(json);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const value = (parsed as Record<string, unknown>).UNANSWERED;
  return isTone(value) ? { UNANSWERED: value } : {};
}

export function decodeNodeTones(json: string): Array<{ nodeId: string; tone: SpeechTone }> {
  const parsed = parseJson(json);
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const out: Array<{ nodeId: string; tone: SpeechTone }> = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const { nodeId, tone } = item as { nodeId?: unknown; tone?: unknown };
    if (typeof nodeId !== 'string' || !UUID.test(nodeId) || !isTone(tone) || seen.has(nodeId)) continue;
    seen.add(nodeId);
    out.push({ nodeId, tone });
    if (out.length >= SPEECH_LIMITS.nodeTonesMax) break;
  }
  return out;
}

function decodeRate(value: number): number {
  if (!Number.isFinite(value)) return 1.0;
  return Math.min(SPEECH_LIMITS.rateMultiplier.max, Math.max(SPEECH_LIMITS.rateMultiplier.min, value));
}

/** 행 없음(`null`) = 전부 꺼짐 기본값. */
export function decodeVoiceSettingsRow(row: VoiceSettingsRow | null | undefined): VoiceSettings {
  if (!row) return { ...DEFAULT_VOICE_SETTINGS, toneByKind: {}, nodeTones: [] };
  return {
    inputEnabled: row.inputEnabled === true,
    ttsEnabled: row.ttsEnabled === true,
    autoReadToggleVisible: row.autoReadToggleVisible !== false,
    rateMultiplier: decodeRate(row.rateMultiplier),
    defaultTone: isTone(row.defaultTone) ? row.defaultTone : 'CALM',
    toneByKind: decodeToneByKind(row.toneByKind),
    nodeTones: decodeNodeTones(row.nodeTones),
  };
}

/** DTO → 저장 컬럼(JSON 직렬화). */
export function encodeVoiceSettingsInput(input: VoiceSettingsInput): { toneByKind: string; nodeTones: string } {
  const toneByKind: VoiceToneByKind = input.toneByKind.UNANSWERED ? { UNANSWERED: input.toneByKind.UNANSWERED } : {};
  return {
    toneByKind: JSON.stringify(toneByKind),
    nodeTones: JSON.stringify(input.nodeTones.map((n) => ({ nodeId: n.nodeId, tone: n.tone }))),
  };
}
