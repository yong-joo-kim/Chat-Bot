import { randomBytes } from 'node:crypto';

/** 혼동되기 쉬운 문자(0/O, 1/l/I)를 제외한 알파벳(NFR-S13). */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const RANDOM_LENGTH = 12;

/**
 * 임시 비밀번호 생성(FR-12-25, FR-12-29). 암호학적 난수를 쓰며, 숫자·문자·특수문자를 고정
 * 접미사로 보장해 비밀번호 정책(`validatePasswordPolicy`)을 항상 충족시킨다.
 */
export function generateTemporaryPassword(): string {
  const bytes = randomBytes(RANDOM_LENGTH);
  let body = '';
  for (let i = 0; i < RANDOM_LENGTH; i += 1) {
    body += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return `${body}#7`;
}
