// 비밀 제거(설계 §17.3 · AC-DH5-3) — 보고서·로그·state.json 쓰기 경로 전부가 지난다.
// 대상: cb_session 값 · Set-Cookie/Cookie 헤더 · password 계열 필드 · DATA_ENCRYPTION_KEYS 값 ·
// 하네스 메모리의 계정 비밀번호(실행 중 생성한 값 목록과 대조해 어떤 텍스트에서든 치환).

export const REDACTED = '[가림]';

const SECRET_FIELD_RE = /("(?:password|currentPassword|newPassword|temporaryPassword)"\s*:\s*")((?:[^"\\]|\\.)*)(")/gi;

export class Redactor {
  private readonly literals = new Set<string>();

  /** 실행 중 생성한 비밀 값(비밀번호·쿠키 값·키)을 등록한다. 너무 짧은 값(4자 미만)은 오탐을 부르므로 무시. */
  register(value: string | undefined | null): void {
    if (value && value.length >= 4) this.literals.add(value);
  }

  get registeredCount(): number {
    return this.literals.size;
  }

  redact(text: string): string {
    let out = text;
    for (const lit of this.literals) out = out.split(lit).join(REDACTED);
    out = out.replace(SECRET_FIELD_RE, `$1${REDACTED}$3`);
    out = out.replace(/(cb_session=)[^;\s"']+/gi, `$1${REDACTED}`);
    out = out.replace(/^((?:set-)?cookie\s*:\s*).*$/gim, `$1${REDACTED}`);
    out = out.replace(/^(authorization\s*:\s*).*$/gim, `$1${REDACTED}`);
    out = out.replace(/(DATA_ENCRYPTION_KEYS\s*=\s*)\S+/g, `$1${REDACTED}`);
    return out;
  }

  /** 텍스트에 등록된 비밀이 남아 있는지(정리 단계 자기 검사용). */
  containsSecret(text: string): boolean {
    for (const lit of this.literals) if (text.includes(lit)) return true;
    return false;
  }
}
