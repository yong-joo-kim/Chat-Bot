import type { ImportRowError, TestCaseExpectedKind } from '@chat-bot/shared-types';
import { normalizeText, VALIDATION_LIMITS } from '@chat-bot/shared-types';
import type { SheetRow } from '../../dialogue-common/import/sheet-reader';

const CONTROL_CHAR_RE = /[\n\r\t]/;
const TURN_SEPARATOR = '|';

/** 한글 표기 ↔ `TestCaseExpectedKind` 변환(FR-V1-12). 대소문자·좌우 공백은 관대하게 허용한다. */
const EXPECTED_KIND_LABELS: Record<string, TestCaseExpectedKind> = {
  의도: 'INTENT',
  intent: 'INTENT',
  faq: 'FAQ',
  노드: 'NODE',
  node: 'NODE',
  폴백: 'FALLBACK',
  fallback: 'FALLBACK',
  미지정: 'ANY',
  any: 'ANY',
};

const TARGET_REQUIRED_KINDS: readonly TestCaseExpectedKind[] = ['INTENT', 'FAQ', 'NODE'];

export interface ParsedTestCaseRow {
  row: number;
  messages: string[];
  messagesNormalized: string;
  expectedKind: TestCaseExpectedKind;
  /** 유형이 INTENT/FAQ/NODE일 때만 존재 — 이름→ID 해석은 이 함수의 책임 밖이다(dry-run 후속 단계). */
  expectedTargetName?: string;
  expectedAnswerNote?: string;
}

/** 헤더 행 존재 여부를 관대하게 판별한다(FR-V1-12 — "있어도 없어도 동작한다"). */
function looksLikeHeaderRow(row: SheetRow | undefined): boolean {
  const first = (row?.cells[0] ?? '').trim().toLowerCase();
  return first === '질문문장' || first === 'question' || first === 'questions';
}

export function messagesNormalizedKey(messages: readonly string[]): string {
  return messages.map((m) => normalizeText(m)).join('\n');
}

/**
 * 업로드 행 → TC 초안 + `ImportRowError[]`(FR-V1-9~14). 이름→ID 해석은 하지 않는다(서비스가
 * 별도로 수행 — dry-run 단계에서 DB를 조회해야 하므로 순수 함수 책임 밖이다).
 */
export function parseTestCaseRows(rows: SheetRow[]): { parsed: ParsedTestCaseRow[]; errors: ImportRowError[] } {
  const dataRows = looksLikeHeaderRow(rows[0]) ? rows.slice(1) : rows;
  const errors: ImportRowError[] = [];
  const parsed: ParsedTestCaseRow[] = [];

  dataRows.forEach((row, idx) => {
    const displayRow = idx + 1;
    const rawMessages = (row.cells[0] ?? '').trim();
    const kindLabel = (row.cells[1] ?? '').trim().toLowerCase();
    const targetName = (row.cells[2] ?? '').trim();
    const note = (row.cells[3] ?? '').trim() || undefined;

    if (!rawMessages) {
      errors.push({ row: displayRow, column: 'messages', value: rawMessages, code: 'EMPTY_NAME', message: '질문 문장이 비어 있습니다.' });
      return;
    }
    const messages = rawMessages
      .split(TURN_SEPARATOR)
      .map((m) => m.trim())
      .filter((m) => m.length > 0);
    if (messages.length === 0) {
      errors.push({ row: displayRow, column: 'messages', value: rawMessages, code: 'EMPTY_NAME', message: '질문 문장이 비어 있습니다.' });
      return;
    }
    if (messages.length > VALIDATION_LIMITS.maxTurnsPerCase) {
      errors.push({
        row: displayRow,
        column: 'messages',
        value: rawMessages,
        code: 'TOO_LONG',
        message: `턴 수는 최대 ${VALIDATION_LIMITS.maxTurnsPerCase}개까지 입력할 수 있습니다.`,
      });
      return;
    }
    const tooLongTurn = messages.find((m) => m.length > VALIDATION_LIMITS.maxMessageLength);
    if (tooLongTurn) {
      errors.push({
        row: displayRow,
        column: 'messages',
        value: tooLongTurn,
        code: 'TOO_LONG',
        message: `각 턴은 최대 ${VALIDATION_LIMITS.maxMessageLength}자까지 입력할 수 있습니다.`,
      });
      return;
    }
    if (messages.some((m) => CONTROL_CHAR_RE.test(m))) {
      errors.push({ row: displayRow, column: 'messages', value: rawMessages, code: 'INVALID_CHAR', message: '개행이나 탭 문자를 포함할 수 없습니다.' });
      return;
    }

    const expectedKind = EXPECTED_KIND_LABELS[kindLabel];
    if (!expectedKind) {
      errors.push({
        row: displayRow,
        column: 'expectedKind',
        value: kindLabel,
        code: 'INVALID_CATEGORY',
        message: '기대유형은 의도/FAQ/노드/폴백/미지정 중 하나여야 합니다.',
      });
      return;
    }

    const requiresTarget = TARGET_REQUIRED_KINDS.includes(expectedKind);
    if (requiresTarget && !targetName) {
      errors.push({ row: displayRow, column: 'expectedTargetName', value: targetName, code: 'EMPTY_VALUE', message: '기대대상명이 비어 있습니다.' });
      return;
    }

    if (note && note.length > VALIDATION_LIMITS.maxAnswerNoteLength) {
      errors.push({
        row: displayRow,
        column: 'note',
        value: note,
        code: 'TOO_LONG',
        message: `비고는 최대 ${VALIDATION_LIMITS.maxAnswerNoteLength}자까지 입력할 수 있습니다.`,
      });
      return;
    }

    parsed.push({
      row: displayRow,
      messages,
      messagesNormalized: messagesNormalizedKey(messages),
      expectedKind,
      expectedTargetName: requiresTarget ? targetName : undefined,
      expectedAnswerNote: note,
    });
  });

  return { parsed, errors };
}
