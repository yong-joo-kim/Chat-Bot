import type { ContextSessionState, ContextSlot, ContextVariable, DialogOutput, Keyword } from '@chat-bot/shared-types';
import { containsWord, normalizeText } from './normalize';
import {
  SESSION_CANCEL_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
  SESSION_RETRY_LIMIT_MESSAGE,
  SKIP_TOKENS,
} from './constants';

function textOutput(text: string): DialogOutput {
  return { type: 'TEXT', payload: { text } };
}

function buttonOutput(text: string | undefined, buttons: { label: string; action: 'MESSAGE'; value: string }[]): DialogOutput {
  return { type: 'BUTTON', payload: { text, buttons } };
}

export interface SlotValueResult {
  valid: boolean;
  value?: string;
  error?: string;
}

const PHONE_REGEX = /^0\d{1,2}-?\d{3,4}-?\d{4}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidCalendarDate(y: number, m: number, d: number): boolean {
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

function parseDate(value: string, format: NonNullable<ContextSlot['validation']>['dateFormat']): boolean {
  const fmt = format ?? 'YYYY-MM-DD';
  let match: RegExpExecArray | null = null;
  if (fmt === 'YYYY-MM-DD') match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  else if (fmt === 'YYYY.MM.DD') match = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(value);
  else if (fmt === 'YYYYMMDD') match = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (!match) return false;
  const [, y, m, d] = match;
  return isValidCalendarDate(Number(y), Number(m), Number(d));
}

/**
 * 슬롯 타입별 값 검증(FR-8-2, §7.6). 사용자 정규식(`TEXT.pattern`)은 컴파일 실패 시 검증을 생략한다
 * (안전 실행 — 엔진은 예외를 던지지 않는다, FR-E-9).
 */
export function validateSlotValue(slot: ContextSlot, raw: string, keywords: Keyword[]): SlotValueResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { valid: false, error: '값을 입력해 주세요.' };

  switch (slot.type) {
    case 'TEXT': {
      if (slot.validation?.maxLength && trimmed.length > slot.validation.maxLength) {
        return { valid: false, error: `최대 ${slot.validation.maxLength}자까지 입력할 수 있습니다.` };
      }
      if (slot.validation?.pattern) {
        try {
          const re = new RegExp(slot.validation.pattern);
          if (!re.test(trimmed)) return { valid: false, error: '입력 형식이 올바르지 않습니다.' };
        } catch {
          // 정규식 컴파일 실패 — 검증을 생략한다(§7.6)
        }
      }
      return { valid: true, value: trimmed };
    }
    case 'NUMBER': {
      if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return { valid: false, error: '숫자만 입력해 주세요.' };
      const num = Number(trimmed);
      if (slot.validation?.min !== undefined && num < slot.validation.min) {
        return { valid: false, error: `${slot.validation.min} 이상 입력해 주세요.` };
      }
      if (slot.validation?.max !== undefined && num > slot.validation.max) {
        return { valid: false, error: `${slot.validation.max} 이하로 입력해 주세요.` };
      }
      return { valid: true, value: trimmed };
    }
    case 'DATE': {
      if (!parseDate(trimmed, slot.validation?.dateFormat)) return { valid: false, error: '날짜 형식을 확인해 주세요.' };
      return { valid: true, value: trimmed };
    }
    case 'PHONE': {
      if (!PHONE_REGEX.test(trimmed)) return { valid: false, error: '전화번호 형식을 확인해 주세요.' };
      return { valid: true, value: trimmed };
    }
    case 'EMAIL': {
      if (!EMAIL_REGEX.test(trimmed)) return { valid: false, error: '이메일 형식을 확인해 주세요.' };
      return { valid: true, value: trimmed };
    }
    case 'CHOICE': {
      const norm = normalizeText(trimmed);
      const matched = (slot.choices ?? []).find((c) => normalizeText(c) === norm);
      if (!matched) return { valid: false, error: '제시된 선택지 중에서 선택해 주세요.' };
      return { valid: true, value: matched };
    }
    case 'KEYWORD': {
      const norm = normalizeText(trimmed);
      const keyword = keywords.find((k) => k.id === slot.keywordId);
      if (!keyword) return { valid: false, error: '연결된 키워드를 찾을 수 없습니다.' };
      if (normalizeText(keyword.name) === norm) return { valid: true, value: keyword.name };
      const synonymMatch = keyword.synonyms.find((s) => normalizeText(s) === norm);
      if (synonymMatch) return { valid: true, value: keyword.name };
      return { valid: false, error: '등록된 값과 일치하지 않습니다.' };
    }
    default:
      return { valid: true, value: trimmed };
  }
}

/** 슬롯 프롬프트 출력 — CHOICE는 선택지를 버튼으로도 제시한다(AC-8-2). */
export function promptOutputsForSlot(slot: ContextSlot): DialogOutput[] {
  const outputs: DialogOutput[] = [textOutput(slot.prompt)];
  if (slot.type === 'CHOICE' && slot.choices && slot.choices.length > 0) {
    outputs.push(
      buttonOutput(
        undefined,
        slot.choices.slice(0, 5).map((choice) => ({ label: choice, action: 'MESSAGE' as const, value: choice })),
      ),
    );
  }
  return outputs;
}

export function startContextSession(definition: ContextVariable, now: Date): ContextSessionState {
  return {
    contextVariableId: definition.id,
    currentSlotIndex: 0,
    filledValues: {},
    retryCount: 0,
    startedAt: now,
    lastInteractedAt: now,
    status: 'IN_PROGRESS',
  };
}

function renderCompletionMessage(template: string | undefined, values: Record<string, string>): string | undefined {
  if (!template) return undefined;
  return template.replace(/\{([^{}]+)\}/g, (_match, key: string) => values[key] ?? '');
}

function completeSession(state: ContextSessionState, definition: ContextVariable, now: Date): AdvanceResult {
  const message = renderCompletionMessage(definition.completionMessage, state.filledValues);
  return {
    state: { ...state, status: 'COMPLETED', lastInteractedAt: now },
    outputs: message ? [textOutput(message)] : [],
  };
}

function advanceOrComplete(state: ContextSessionState, definition: ContextVariable, now: Date): AdvanceResult {
  if (state.currentSlotIndex >= definition.slots.length) {
    return completeSession(state, definition, now);
  }
  const nextSlot = definition.slots[state.currentSlotIndex];
  return { state, outputs: promptOutputsForSlot(nextSlot) };
}

export interface AdvanceResult {
  state: ContextSessionState;
  outputs: DialogOutput[];
}

/**
 * 컨텍스트 세션 상태 전이(FR-8-9, 순수 함수). 우선순위: 취소어(FR-8-11) → 타임아웃(FR-8-12)
 * → 건너뛰기(FR-8-14) → 슬롯 값 검증(FR-8-10) → 완료(FR-8-13).
 */
export function advanceContextSession(
  session: ContextSessionState,
  input: { raw: string; norm: string },
  definition: ContextVariable,
  now: Date,
  keywords: Keyword[],
): AdvanceResult {
  const normalizedCancelWords = definition.cancelKeywords.map(normalizeText);
  if (normalizedCancelWords.some((w) => containsWord(input.norm, w))) {
    return { state: { ...session, status: 'CANCELLED', lastInteractedAt: now }, outputs: [textOutput(SESSION_CANCEL_MESSAGE)] };
  }

  const elapsedMinutes = (now.getTime() - session.lastInteractedAt.getTime()) / 60000;
  if (elapsedMinutes > definition.sessionTimeoutMinutes) {
    return {
      state: { ...session, status: 'EXPIRED', lastInteractedAt: now },
      outputs: [
        buttonOutput(SESSION_EXPIRED_MESSAGE, [
          { label: '이어서 하기', action: 'MESSAGE', value: '이어서 하기' },
          { label: '처음부터', action: 'MESSAGE', value: '처음부터' },
        ]),
      ],
    };
  }

  const slot = definition.slots[session.currentSlotIndex];
  if (!slot) {
    return completeSession(session, definition, now);
  }

  if (!slot.required && SKIP_TOKENS.includes(input.norm)) {
    return advanceOrComplete(
      { ...session, currentSlotIndex: session.currentSlotIndex + 1, retryCount: 0, lastInteractedAt: now },
      definition,
      now,
    );
  }

  const result = validateSlotValue(slot, input.raw, keywords);
  if (!result.valid) {
    const nextRetry = session.retryCount + 1;
    if (nextRetry > slot.maxRetry) {
      return {
        state: { ...session, status: 'CANCELLED', lastInteractedAt: now },
        outputs: [textOutput(SESSION_RETRY_LIMIT_MESSAGE)],
      };
    }
    const example = slot.exampleValue ? ` (예: ${slot.exampleValue})` : '';
    const prompt = slot.errorPrompt?.trim() || `${result.error ?? '입력값을 확인해 주세요.'}${example}`;
    return { state: { ...session, retryCount: nextRetry, lastInteractedAt: now }, outputs: [textOutput(prompt)] };
  }

  const filledValues = { ...session.filledValues, [slot.name]: result.value ?? input.raw.trim() };
  return advanceOrComplete(
    { ...session, filledValues, currentSlotIndex: session.currentSlotIndex + 1, retryCount: 0, lastInteractedAt: now },
    definition,
    now,
  );
}
