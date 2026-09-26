import { Injectable } from '@nestjs/common';
import { openField, DECRYPT_FAILED_TEXT } from '../../common/crypto/field-crypto';

/**
 * ★ [신규 No.42] `openField(` 인박스 호출 유일 파일(O-4 · G-5 목록 일치) — `INBOX_ENTRY_TEXT`·
 * `CUSTOMER_DISPLAY_NAME`·`HANDOFF_TEXT`(스레드의 상담 구간)를 개봉한다. `rawText`는 선택하지 않는다.
 */
@Injectable()
export class InboxTextReader {
  openEntryText(entryId: string, stored: string): string {
    return openField('INBOX_ENTRY_TEXT', entryId, stored) ?? '';
  }

  openDisplayName(customerId: string, stored: string | null): string | null {
    return openField('CUSTOMER_DISPLAY_NAME', customerId, stored);
  }

  openHandoffText(messageId: string, stored: string): string {
    return openField('HANDOFF_TEXT', messageId, stored) ?? '';
  }

  isDecryptFailed(text: string): boolean {
    return text === DECRYPT_FAILED_TEXT;
  }
}
