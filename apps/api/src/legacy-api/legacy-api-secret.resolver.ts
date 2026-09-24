import { Injectable, Logger } from '@nestjs/common';
import type { ApiConnectionAuthType, ApiSecretStatus } from '@chat-bot/shared-types';

const MAX_SECRET_LENGTH = 4096;
const INVALID_CHARS_RE = /[\r\n\0]/;

/**
 * ★ `LEGACY_API_SECRET__` 참조 유일 파일(§7.7, §13 L-1). 캐시하지 않는다(환경변수는 재기동 없이
 * 바뀌지 않는다 — 시크릿 교체 = 환경변수 변경 + 재기동, EX-L-19). 값·길이·접두어를 어떤 로그·오류·
 * 응답·trace·감사·`ApiCallLog`에도 쓰지 않는다(AC-L2-2).
 */
@Injectable()
export class LegacyApiSecretResolver {
  private readonly logger = new Logger('LegacyApiSecretResolver');

  /** CR·LF·NUL이 있거나 4,096자를 넘으면 없음으로 취급(헤더 주입 방지) + 기동 시 경고(키 이름만). */
  get(ref: string): string | null {
    const value = process.env[`LEGACY_API_SECRET__${ref}`];
    if (value === undefined) return null;
    if (value.length > MAX_SECRET_LENGTH || INVALID_CHARS_RE.test(value)) {
      this.logger.warn(`LEGACY_API_SECRET__${ref} 값이 유효하지 않아 없음으로 처리합니다.`);
      return null;
    }
    return value;
  }

  status(authType: ApiConnectionAuthType, ref: string | null): ApiSecretStatus {
    if (authType === 'NONE') return 'NOT_REQUIRED';
    if (!ref) return 'MISSING';
    return this.get(ref) !== null ? 'CONFIGURED' : 'MISSING';
  }
}
