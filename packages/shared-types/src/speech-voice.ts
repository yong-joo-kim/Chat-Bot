/**
 * [신규 No.32] 음성 AI 말투 대응표·읽기 보조 순수 함수 — **zod 무의존 서브패스**
 * (`@chat-bot/shared-types/speech-voice`, ADR-0012 · `output-view`·`contrast`·`proactive-eval` 선례).
 *
 * 이 파일은 다른 `packages/shared-types` 파일을 import하지 않는다(VO-11 — import 0). 위젯(기기 안 읽기)·
 * 콘솔(말투 들어보기)·서버(말투 이름 검증)가 이 모듈 1벌을 공유한다(NFR-VOM2). 서버는 말투 **이름**만 응답에
 * 싣고 숫자 매개변수는 보내지 않는다(대응표가 바뀌어도 서버·응답 바이트 불변 — 설계서 §6.3).
 *
 * ⚠ 대응표 값은 제안값이다 — ui-designer가 실제 기기 청취 후 확정한다(voice-ai-ui-spec U-1). 코드 분기가 아니라
 * 표 값만 바꾸면 되도록 두었다.
 */

/** 말투 닫힌 4종(FR-VO4-5). 화면 이름: 차분함·밝게·사과·안내. */
export const SPEECH_TONES = ['CALM', 'BRIGHT', 'APOLOGETIC', 'INFORMATIVE'] as const;
export type SpeechTone = (typeof SPEECH_TONES)[number];

export interface SpeechToneParams {
  rate: number;
  pitch: number;
  volume: number;
}

/** 말투 → 발화 매개변수 대응표(제안값 — 실제 기기 청취 후 확정). */
export const SPEECH_TONE_PARAMS: Readonly<Record<SpeechTone, SpeechToneParams>> = {
  CALM: { rate: 0.95, pitch: 0.95, volume: 1.0 },
  BRIGHT: { rate: 1.05, pitch: 1.1, volume: 1.0 },
  APOLOGETIC: { rate: 0.9, pitch: 0.9, volume: 0.9 },
  INFORMATIVE: { rate: 1.0, pitch: 1.0, volume: 1.0 },
};

/** 안전 구간 — 기기 음성이 알아들을 수 없게 되는 극단값을 막는다. */
export const SPEECH_PARAM_BOUNDS = {
  rate: { min: 0.7, max: 1.3 },
  pitch: { min: 0.8, max: 1.2 },
  volume: { min: 0.8, max: 1.0 },
} as const;

/** 관리자 읽기 속도 배율 범위(`SPEECH_LIMITS.rateMultiplier`와 같은 값 — zod 무의존이라 여기서 따로 둔다). */
const RATE_MULTIPLIER_MIN = 0.8;
const RATE_MULTIPLIER_MAX = 1.2;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** 문자열이 닫힌 말투 4종 중 하나인지(방어용). */
export function isSpeechTone(value: unknown): value is SpeechTone {
  return typeof value === 'string' && (SPEECH_TONES as readonly string[]).includes(value);
}

/**
 * `rate = clamp(표.rate × clamp(배율, 0.8, 1.2))` · pitch·volume는 표 값을 안전 구간으로 clamp.
 * 모르는 말투는 `CALM`으로 대체한다(방어 — 서버가 새 말투를 먼저 보내도 읽기는 깨지지 않는다).
 */
export function computeUtteranceParams(tone: string, rateMultiplier: number): SpeechToneParams {
  const row = isSpeechTone(tone) ? SPEECH_TONE_PARAMS[tone] : SPEECH_TONE_PARAMS.CALM;
  const multiplier = clamp(rateMultiplier, RATE_MULTIPLIER_MIN, RATE_MULTIPLIER_MAX);
  return {
    rate: clamp(row.rate * multiplier, SPEECH_PARAM_BOUNDS.rate.min, SPEECH_PARAM_BOUNDS.rate.max),
    pitch: clamp(row.pitch, SPEECH_PARAM_BOUNDS.pitch.min, SPEECH_PARAM_BOUNDS.pitch.max),
    volume: clamp(row.volume, SPEECH_PARAM_BOUNDS.volume.min, SPEECH_PARAM_BOUNDS.volume.max),
  };
}

/** `SpeechSynthesisVoice`의 구조적 부분집합(DOM 타입 비의존). */
export interface VoiceLike {
  lang?: unknown;
  localService?: unknown;
  default?: unknown;
}

/**
 * 기기 안(`localService === true`) 한국어(`ko*`) 음성만 인정한다. `localService`가 `true`가 아닌 값(누락·
 * `undefined` 포함)은 전부 제외한다 — 판별 불확실 = 쓰지 않는다(FR-VO6-8, 서버로 글자가 나가는 온라인 음성 배제).
 */
export function isLocalKoreanVoice(v: VoiceLike): boolean {
  return typeof v.lang === 'string' && v.lang.toLowerCase().startsWith('ko') && v.localService === true;
}

/** 조건 만족 중 `default === true` 우선 → 없으면 첫 번째 → 없으면 `null`. */
export function selectLocalKoreanVoice<T extends VoiceLike>(voices: readonly T[]): T | null {
  const candidates = voices.filter((v) => isLocalKoreanVoice(v));
  if (candidates.length === 0) return null;
  return candidates.find((v) => v.default === true) ?? candidates[0];
}

const SENTENCE_END = new Set(['.', '?', '!', '。', '…']);
const SOFT_BREAK = new Set([',', '，', '、', ';', ':', ' ', '\t']);

/** 200자 초과 조각을 쉼표·공백에서 다시 자른다(없으면 강제 절단). */
function splitLong(piece: string, maxChunk: number): string[] {
  const out: string[] = [];
  let rest = piece;
  while (rest.length > maxChunk) {
    let cut = -1;
    for (let i = maxChunk; i > 0; i -= 1) {
      if (SOFT_BREAK.has(rest[i - 1])) {
        cut = i;
        break;
      }
    }
    if (cut <= 0) cut = maxChunk;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut);
  }
  out.push(rest.trim());
  return out;
}

/**
 * 읽기용 글자를 기기 음성이 잘 처리하는 길이로 나눈다 — 문장 경계(`. ? ! 。 …` · 줄바꿈)로 나누고, `maxChunk`
 * 초과 조각은 쉼표·공백에서 다시 자른다(공백 없으면 강제 절단). 빈 조각은 제거한다. 선형 스캔(정규식 0).
 */
export function splitForSpeech(text: string, maxChunk = 200): string[] {
  const limit = Number.isFinite(maxChunk) && maxChunk >= 1 ? Math.floor(maxChunk) : 200;
  const sentences: string[] = [];
  let current = '';
  const flush = (): void => {
    const trimmed = current.trim();
    if (trimmed.length > 0) sentences.push(trimmed);
    current = '';
  };
  for (const ch of text) {
    if (ch === '\n' || ch === '\r') {
      flush();
      continue;
    }
    current += ch;
    if (SENTENCE_END.has(ch)) flush();
  }
  flush();
  const out: string[] = [];
  for (const s of sentences) {
    if (s.length <= limit) out.push(s);
    else for (const part of splitLong(s, limit)) if (part.length > 0) out.push(part);
  }
  return out;
}
