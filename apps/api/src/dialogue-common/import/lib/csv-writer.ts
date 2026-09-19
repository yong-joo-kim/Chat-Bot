import { escapeCsvCell } from '@chat-bot/shared-types';

const UTF8_BOM = '﻿';

/** 템플릿/내보내기 CSV 생성(FR-6-19, FR-6-30, AC-6B-9). UTF-8 BOM 포함, 수식 인젝션 방어 적용. */
export function buildCsv(headers: string[], rows: string[][]): string {
  const lines = [headers, ...rows].map((cols) => cols.map((c) => escapeCsvCell(c ?? '')).join(','));
  return UTF8_BOM + lines.join('\r\n') + '\r\n';
}

export const INTENT_TEMPLATE_HEADERS = ['의도명', '예문', '설명'];
export const KEYWORD_TEMPLATE_HEADERS = ['키워드명', '동의어', '설명'];
export const FAQ_TEMPLATE_HEADERS = ['분류', '질문', '답변', '대체질문'];
