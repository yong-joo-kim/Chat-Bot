import type { ButtonItem, DialogOutput } from '@chat-bot/shared-types';
import { SPEECH_LIMITS } from '@chat-bot/shared-types';

/**
 * [신규 No.32] 읽기용 글자 만들기(voice-ai-설계.md §6.1 · DD-126). 순수 — DB·Nest·시계 무의존.
 *
 * 입력은 같은 응답에서 화면으로 보내는 **최종 봇 출력**이다(출구 금지어·RAG 출구 가림 이후 · 앞에 붙은 G-8 상담원 미전달 메시지는
 * 호출자가 `slice`로 뺀다 — C-16). 화면에서 가려진 것은 소리로도 가려진다. No.46 강등 함수(`rich-degrade.ts`)는 재사용하지 않는다(C-7) —
 * 같은 판별 유니온을 **전수 분기**하는 구조만 따른다(새 출력 타입 추가 시 `never` 검사로 컴파일 오류).
 *
 * 정리 규칙은 순서 고정이며 정규식은 전부 선형이다(역참조·중첩 반복 없음).
 */

/** 가림 표시 → 읽기 닫힌 목록(C-13) — `packages/pii-mask`가 상수를 export하지 않아 API에 둔다. 표류 감시 시험이 `maskPii()` 출력과 대조한다(VO-14). */
export const PII_MASK_READ_LABELS: ReadonlyArray<readonly [string, string]> = [
  ['[주민등록번호]', '주민등록번호 가림'],
  ['[카드번호]', '카드번호 가림'],
  ['[계좌번호]', '계좌번호 가림'],
  ['[전화번호]', '전화번호 가림'],
  ['[이메일]', '이메일 가림'],
];

/** 장식 기호 제거 닫힌 목록 — 마침표·쉼표·물음표·느낌표·괄호·퍼센트·원 기호는 보존한다. */
const DECORATIVE_SYMBOLS = /[★☆●○◎■□▲△▶◀◆◇※→←↑↓•\u25AA]/g;
const STARS = /\*{2,}/g;
const URL_TOKEN = /(?:https?:\/\/|www\.)\S+/gi;
const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]/gu;
const PHONE = /(\d{2,4})-(\d{3,4})-(\d{4})/g;
const SENTENCE_END = /[.?!。…]$/;

function sentence(text: string): string {
  const t = text.trim();
  if (t.length === 0) return '';
  return SENTENCE_END.test(t) ? t : `${t}.`;
}

function choices(buttons: readonly ButtonItem[] | undefined): string {
  if (!buttons || buttons.length === 0) return '';
  return `선택지: ${buttons.map((b) => b.label).join(', ')}.`;
}

function join(parts: ReadonlyArray<string | undefined>): string {
  return parts.filter((p): p is string => !!p && p.trim().length > 0).join(' ');
}

function assertNever(value: never): never {
  throw new Error(`읽기 글자: 처리되지 않은 출력 타입 ${JSON.stringify(value)}`);
}

/** 출력 1건 → 읽기 조각(없으면 빈 문자열). 새 출력 타입이 추가되면 `never` 검사가 컴파일 오류를 낸다. */
export function outputToSpeechPiece(output: DialogOutput): string {
  switch (output.type) {
    case 'TEXT':
      return output.payload.text;
    case 'CARD': {
      const p = output.payload;
      return join([sentence(p.title), p.description ? sentence(p.description) : undefined, choices(p.buttons)]);
    }
    case 'CAROUSEL': {
      const p = output.payload;
      const cards = p.cards.map((card, idx) =>
        join([`${idx + 1}번,`, sentence(card.title), card.description ? sentence(card.description) : undefined, choices(card.buttons)]),
      );
      return join([p.text ? sentence(p.text) : undefined, ...cards]);
    }
    case 'BUTTON': {
      const p = output.payload;
      return join([p.text ? sentence(p.text) : undefined, choices(p.buttons)]);
    }
    case 'LINK':
      return output.payload.label;
    case 'IMAGE': {
      const alt = output.payload.altText;
      return alt && alt.trim().length > 0 ? `이미지: ${alt.trim()}` : '';
    }
    case 'PHONE_CALL':
      return '전화 연결 버튼이 있습니다.';
    case 'PAUSE':
      // 문장 끊김 — 출력 사이 경계가 이미 ". "로 정리되므로 따로 글자를 만들지 않는다.
      return '';
    case 'CONTEXT_FORM':
    case 'DIALOG_MOVE':
    case 'SCENARIO':
    case 'SURVEY':
    case 'API_CONDITION':
    case 'WORKFLOW':
      return '';
    default:
      return assertNever(output);
  }
}

function applyMaskLabels(text: string): string {
  let out = text;
  for (const [mark, spoken] of PII_MASK_READ_LABELS) out = out.split(mark).join(spoken);
  return out;
}

/** 줄 경계 → ". "(앞이 이미 문장 부호로 끝나면 공백만). 줄 안 가로 공백은 1개로 줄인다 — 전부 선형. */
function normalizeWhitespace(text: string): string {
  const lines = text
    .split(/\r\n|\r|\n/)
    .map((line) => line.replace(/[ \t\f\v\u00a0]+/g, ' ').trim())
    .filter((line) => line.length > 0);
  let out = '';
  for (const line of lines) {
    if (out.length === 0) out = line;
    else out += SENTENCE_END.test(out) ? ` ${line}` : `. ${line}`;
  }
  return out;
}

function truncateToLimit(text: string): string {
  const max = SPEECH_LIMITS.speechTextMaxChars;
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  let cut = -1;
  for (let i = head.length - 1; i > 0; i -= 1) {
    if (/[.?!。…]/.test(head[i]) && (i === head.length - 1 || head[i + 1] === ' ')) {
      cut = i + 1;
      break;
    }
  }
  if (cut <= 0) cut = head.lastIndexOf(' ');
  if (cut <= 0) cut = max;
  return `${head.slice(0, cut).trim()} ${SPEECH_LIMITS.speechTextTail}`;
}

/** 이미 만들어진 글자에 정리 규칙 ①~⑧을 적용한다(시험·재사용용 분리). */
export function cleanSpeechText(raw: string): string {
  let text = applyMaskLabels(raw); // ① 가림 표시 → 읽기
  text = text.replace(STARS, ' 가림 '); // ② 부분 가림(별표 2개 이상)
  text = text.replace(URL_TOKEN, ' '); // ③ URL 제거
  text = text.replace(EMOJI, ''); // ④ 이모지 제거
  text = text.replace(DECORATIVE_SYMBOLS, ''); // ⑤ 장식 기호 제거
  text = text.replace(PHONE, '$1, $2, $3'); // ⑥ 전화번호 쉼
  text = normalizeWhitespace(text); // ⑦ 공백 정리
  return truncateToLimit(text); // ⑧ 상한
}

/** 출력 목록 → 읽기용 글자. 빈 문자열이면 호출자는 `speech` 키를 만들지 않는다(⑨). */
export function buildSpeechText(outputs: readonly DialogOutput[]): string {
  const pieces = outputs.map(outputToSpeechPiece).filter((p) => p.trim().length > 0);
  if (pieces.length === 0) return '';
  return cleanSpeechText(pieces.join('\n'));
}
