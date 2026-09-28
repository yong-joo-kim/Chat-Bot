import { Injectable, Logger } from '@nestjs/common';

const MAX_SECRET_LENGTH = 4096;
const INVALID_CHARS_RE = /[\r\n\0]/;
const REF_PATTERN = /^[A-Z0-9]+(_[A-Z0-9]+)*$/;

/**
 * ★ `KB_SECRET__` 문자열 보유 유일 파일(No.43, KB-11 · No.26·No.41 규약). 소스의 고정 헤더 값은
 * `KB_SECRET__<REF>` 환경변수에서만 읽는다 — DB·로그·오류·응답·감사 어디에도 값을 남기지 않는다.
 */
@Injectable()
export class KbSecretResolver {
  private readonly logger = new Logger('KbSecretResolver');

  get(ref: string): string | null {
    if (!REF_PATTERN.test(ref)) return null;
    const value = process.env[`KB_SECRET__${ref}`];
    if (value === undefined) return null;
    if (value.length > MAX_SECRET_LENGTH || INVALID_CHARS_RE.test(value)) {
      this.logger.warn(`KB_SECRET__${ref} 값이 유효하지 않아 없음으로 처리합니다.`);
      return null;
    }
    return value;
  }
}
