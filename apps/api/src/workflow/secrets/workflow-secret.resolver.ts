import { Injectable, Logger } from '@nestjs/common';
import type { ApiConnectionAuthType, ApiSecretStatus } from '@chat-bot/shared-types';

const MAX_SECRET_LENGTH = 4096;
const INVALID_CHARS_RE = /[\r\n\0]/;
const REF_PATTERN = /^[A-Z0-9_]{1,40}$/;

/**
 * ★ `WORKFLOW_SECRET__` 참조 유일 파일(No.41, §8.4 · W-1). 캐시하지 않는다(환경변수는 재기동 없이
 * 바뀌지 않는다 — 시크릿 교체 = 환경변수 변경 + 재기동, EX-WF-16). 값·길이·접두어를 어떤 로그·오류·
 * 응답·trace·감사·`WorkflowRun`에도 쓰지 않는다.
 */
@Injectable()
export class WorkflowSecretResolver {
  private readonly logger = new Logger('WorkflowSecretResolver');

  /** CR·LF·NUL이 있거나 4,096자를 넘으면 없음으로 취급(헤더 주입 방지) + 경고(키 이름만). */
  get(ref: string): string | null {
    if (!REF_PATTERN.test(ref)) return null;
    const value = process.env[`WORKFLOW_SECRET__${ref}`];
    if (value === undefined) return null;
    if (value.length > MAX_SECRET_LENGTH || INVALID_CHARS_RE.test(value)) {
      this.logger.warn(`WORKFLOW_SECRET__${ref} 값이 유효하지 않아 없음으로 처리합니다.`);
      return null;
    }
    return value;
  }

  status(authType: ApiConnectionAuthType, ref: string | null): ApiSecretStatus {
    if (authType === 'NONE') return 'NOT_REQUIRED';
    if (!ref) return 'MISSING';
    return this.get(ref) !== null ? 'CONFIGURED' : 'MISSING';
  }

  signingStatus(signingEnabled: boolean, ref: string | null): ApiSecretStatus {
    if (!signingEnabled) return 'NOT_REQUIRED';
    if (!ref) return 'MISSING';
    return this.get(ref) !== null ? 'CONFIGURED' : 'MISSING';
  }

  urlStatus(ref: string | null): ApiSecretStatus {
    if (!ref) return 'NOT_REQUIRED';
    return this.get(ref) !== null ? 'CONFIGURED' : 'MISSING';
  }

  /** 서명 비밀 32자 미만 = 약함(경고 — 기동 실패 아님, NFR-WFS4). */
  isWeak(ref: string | null): boolean {
    if (!ref) return false;
    const value = this.get(ref);
    return value !== null && value.length < 32;
  }
}
