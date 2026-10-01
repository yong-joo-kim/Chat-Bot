// 시연 계정 비밀번호 생성기(설계 §7.2 · NFR-DHS3) — 실행마다 `crypto.randomInt` 기반 20자(영문·숫자·특수 3종 모두 포함).
// 제품 정책(`validatePasswordPolicy`)을 통과해야 하며, 터미널 요약에만 출력한다(보고서·로그·캡처 0).
import { randomInt } from 'node:crypto';

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz'; // 헷갈리는 I·O·l 제외
const DIGITS = '23456789'; // 0·1 제외
const SPECIALS = '!@#$%^*-_+=?';

function pick(set: string): string {
  return set[randomInt(set.length)];
}

export function generatePassword(length = 20): string {
  if (length < 8) throw new Error('비밀번호 길이는 8자 이상이어야 합니다');
  const all = LETTERS + DIGITS + SPECIALS;
  const chars = [pick(LETTERS), pick(DIGITS), pick(SPECIALS)];
  while (chars.length < length) chars.push(pick(all));
  // Fisher-Yates 섞기(암호학적 난수)
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}
