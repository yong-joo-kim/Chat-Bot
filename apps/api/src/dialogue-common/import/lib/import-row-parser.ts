import type { ImportRowError } from '@chat-bot/shared-types';
import type { SheetRow } from '../sheet-reader';

const CONTROL_CHAR_RE = /[\n\r\t]/;

export interface ParsedNameValueRow {
  row: number;
  name: string;
  value: string;
  description?: string;
}

/**
 * 의도/키워드 공용 2열(+선택 3열 설명) 행 파서(FR-6-19, FR-6-23). 행 번호는 헤더를 제외한 1-base다.
 */
export function parseNameValueRows(
  dataRows: SheetRow[],
  limits: { nameMax: number; valueMax: number },
): { parsed: ParsedNameValueRow[]; errors: ImportRowError[] } {
  const errors: ImportRowError[] = [];
  const parsed: ParsedNameValueRow[] = [];

  dataRows.forEach((row, idx) => {
    const displayRow = idx + 1; // 헤더 제외 1-base(FR-6-23)
    const name = (row.cells[0] ?? '').trim();
    const value = (row.cells[1] ?? '').trim();
    const description = (row.cells[2] ?? '').trim() || undefined;

    if (!name) {
      errors.push({ row: displayRow, column: 'name', value: name, code: 'EMPTY_NAME', message: '이름이 비어 있습니다.' });
      return;
    }
    if (!value) {
      errors.push({ row: displayRow, column: 'value', value, code: 'EMPTY_VALUE', message: '값이 비어 있습니다.' });
      return;
    }
    if (name.length > limits.nameMax) {
      errors.push({
        row: displayRow,
        column: 'name',
        value: name,
        code: 'TOO_LONG',
        message: `이름은 최대 ${limits.nameMax}자까지 입력할 수 있습니다.`,
      });
      return;
    }
    if (value.length > limits.valueMax) {
      errors.push({
        row: displayRow,
        column: 'value',
        value,
        code: 'TOO_LONG',
        message: `값은 최대 ${limits.valueMax}자까지 입력할 수 있습니다.`,
      });
      return;
    }
    if (CONTROL_CHAR_RE.test(name) || CONTROL_CHAR_RE.test(value)) {
      errors.push({
        row: displayRow,
        column: 'value',
        value,
        code: 'INVALID_CHAR',
        message: '개행이나 탭 문자를 포함할 수 없습니다.',
      });
      return;
    }

    parsed.push({ row: displayRow, name, value, description });
  });

  return { parsed, errors };
}

export interface ParsedFaqRow {
  row: number;
  category: string;
  question: string;
  answer: string;
  altQuestion?: string;
}

const VALID_FAQ_CATEGORIES = ['FAQ', 'SMALL_TALK', 'SELF_SERVICE', 'ERROR_RESPONSE'];

/** FAQ 4열(분류/질문/답변/대체질문) 행 파서(FR-9-9). 대체질문은 행 반복으로 표현된다. */
export function parseFaqRows(dataRows: SheetRow[]): { parsed: ParsedFaqRow[]; errors: ImportRowError[] } {
  const errors: ImportRowError[] = [];
  const parsed: ParsedFaqRow[] = [];

  dataRows.forEach((row, idx) => {
    const displayRow = idx + 1;
    const category = (row.cells[0] ?? '').trim().toUpperCase();
    const question = (row.cells[1] ?? '').trim();
    const answer = (row.cells[2] ?? '').trim();
    const altQuestion = (row.cells[3] ?? '').trim() || undefined;

    if (!VALID_FAQ_CATEGORIES.includes(category)) {
      errors.push({
        row: displayRow,
        column: 'category',
        value: category,
        code: 'INVALID_CATEGORY',
        message: '분류는 FAQ/SMALL_TALK/SELF_SERVICE/ERROR_RESPONSE 중 하나여야 합니다.',
      });
      return;
    }
    if (!question) {
      errors.push({ row: displayRow, column: 'question', value: question, code: 'EMPTY_NAME', message: '질문이 비어 있습니다.' });
      return;
    }
    if (!answer && !altQuestion) {
      errors.push({ row: displayRow, column: 'answer', value: answer, code: 'EMPTY_VALUE', message: '답변이 비어 있습니다.' });
      return;
    }
    if (question.length > 300) {
      errors.push({ row: displayRow, column: 'question', value: question, code: 'TOO_LONG', message: '질문은 최대 300자입니다.' });
      return;
    }
    if (answer.length > 2000) {
      errors.push({ row: displayRow, column: 'answer', value: answer, code: 'TOO_LONG', message: '답변은 최대 2000자입니다.' });
      return;
    }
    if (CONTROL_CHAR_RE.test(question)) {
      errors.push({ row: displayRow, column: 'question', value: question, code: 'INVALID_CHAR', message: '개행/탭 문자를 포함할 수 없습니다.' });
      return;
    }

    parsed.push({ row: displayRow, category, question, answer, altQuestion });
  });

  return { parsed, errors };
}
