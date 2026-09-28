/**
 * [신규 No.43] `kb-sync/**` 로그의 유일 형식(§10 · KB-15) — 호스트·경로·코드만(쿼리·헤더·본문·오류
 * 원문 0). 호스트는 소문자, 경로는 120자로 절단한다.
 */
export interface KbLogLineInput {
  host: string;
  path: string;
  code: string;
}

export function kbLogLine(input: KbLogLineInput): string {
  const host = input.host.toLowerCase();
  const path = input.path.length > 120 ? input.path.slice(0, 120) : input.path;
  return `kb-sync host=${host} path=${path} code=${input.code}`;
}

/**
 * 오류를 로그에 남길 때의 유일한 표기 — 오류 **원문(`message`)이 아니라 식별자**만 쓴다(§10 · KB-15). 원문에는
 * URL·경로·응답 조각·비밀이 섞일 수 있다. 식별자는 ① Node·라이브러리가 붙이는 대문자 오류 코드(`ECONNRESET`·
 * `ERR_WORKER_OUT_OF_MEMORY`·`P2002` 형식일 때만) ② 없으면 클래스명이다. 어느 쪽도 식별자 형식이 아니면 `UnknownError`.
 */
export function kbErrorCode(e: unknown): string {
  if (!(e instanceof Error)) return 'UnknownError';
  const code = (e as { code?: unknown }).code;
  if (typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,59}$/.test(code)) return code;
  const name = e.constructor?.name || e.name;
  return /^[A-Za-z][A-Za-z0-9_]{0,59}$/.test(name) ? name : 'UnknownError';
}
