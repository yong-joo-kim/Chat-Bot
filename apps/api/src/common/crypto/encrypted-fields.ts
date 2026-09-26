import type { EncryptedFieldId } from '@chat-bot/shared-types';

/**
 * ★ 암호화 대상 3필드 코드 상수(No.45, `data-governance-설계.md` §7.1) — 데이터 지도·정적 검사 공용.
 */
export interface EncryptedFieldDef {
  readonly field: EncryptedFieldId;
  readonly table: string;
  readonly column: string;
}

export const ENCRYPTED_FIELDS: readonly EncryptedFieldDef[] = [
  { field: 'HANDOFF_RAW_TEXT', table: 'handoff_messages', column: 'rawText' },
  { field: 'HANDOFF_TEXT', table: 'handoff_messages', column: 'text' },
  { field: 'SURVEY_TEXT_VALUE', table: 'survey_answers', column: 'textValue' },
  // [신규 No.41] 발송함 본문(재시도용 일시 보관) — 백필·재암호화 잡 대상 아님(일시 데이터, ADR-0041 §7).
  { field: 'WORKFLOW_PAYLOAD', table: 'workflow_runs', column: 'payload' },
  // [신규 No.42] 인박스 항목 본문·고객 표시 이름 — 영구 데이터라 백필·재암호화 잡에 편입(ADR-0042 §6).
  { field: 'INBOX_ENTRY_TEXT', table: 'inbox_entries', column: 'text' },
  { field: 'CUSTOMER_DISPLAY_NAME', table: 'customers', column: 'displayName' },
];

export function encryptedFieldDef(field: EncryptedFieldId): EncryptedFieldDef {
  const found = ENCRYPTED_FIELDS.find((f) => f.field === field);
  if (!found) throw new Error(`알 수 없는 암호화 대상: ${field}`);
  return found;
}

/** AAD = `테이블:컬럼:행 id`(§7.2). */
export function buildFieldAad(field: EncryptedFieldId, rowId: string): string {
  const def = encryptedFieldDef(field);
  return `${def.table}:${def.column}:${rowId}`;
}
