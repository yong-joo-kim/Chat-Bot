import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * [신규 No.46] RM-13 정적 검사 동등 구현(`channel-rich-messages-설계.md` §16 RM-13) — 원안은
 * `apps/api/src/rich-messages/lib/rich-message-sealing.spec.ts`에 "frontend-implementer 구현 뒤
 * test-automation이 추가"하도록 돼 있으나, 이번 작업 지시가 `apps/api` 수정을 금지해 이 파일로
 * 동등하게 구현한다(위젯 소스만 정적 스캔 — apps/api 무수정).
 */

const RENDERERS_DIR = resolve(__dirname, '.');

function read(file: string): string {
  return readFileSync(join(RENDERERS_DIR, file), 'utf8');
}

function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

/** 원안 `rich-message-sealing.spec.ts`의 `nonCommentOccurrences`와 같은 원칙 — 주석 줄은 제외한다. */
function nonCommentMatches(content: string, pattern: RegExp): string[] {
  const found: string[] = [];
  for (const line of content.split('\n')) {
    if (isCommentLine(line)) continue;
    const m = line.match(pattern);
    if (m) found.push(...m);
  }
  return found;
}

const carousel = read('carousel.ts');
const quickReply = read('quick-reply.ts');

describe('RM-13 동등 구현 — 위젯 캐러셀·바로연결 렌더러 정적 검사', () => {
  it('innerHTML·insertAdjacentHTML·outerHTML·style.backgroundImage·url( 을 쓰지 않는다', () => {
    const forbidden = /innerHTML|insertAdjacentHTML|outerHTML|style\.backgroundImage|url\(/g;
    expect(nonCommentMatches(carousel, forbidden)).toEqual([]);
    expect(nonCommentMatches(quickReply, forbidden)).toEqual([]);
  });

  it('setInterval(·setTimeout( 을 쓰지 않는다(자동 넘김 금지)', () => {
    const forbidden = /setInterval\(|setTimeout\(/g;
    expect(nonCommentMatches(carousel, forbidden)).toEqual([]);
    expect(nonCommentMatches(quickReply, forbidden)).toEqual([]);
  });

  it('carousel.ts에 referrerPolicy·no-referrer가 존재한다(이미지 Referer 차단)', () => {
    expect(carousel).toContain('referrerPolicy');
    expect(carousel).toContain('no-referrer');
  });

  it('carousel.ts는 카드 요소에 aria-hidden을 설정하지 않는다(화면낭독기가 모든 카드를 선형으로 읽는다, NFR-RMA2)', () => {
    // "cardEl"(카드 DOM 변수)에 aria-hidden을 세팅하는 코드가 없는지 확인 — 역검증: 파일 자체에는
    // aria-hidden 속성 설정 코드가 위치(position span)에만 존재해야 한다.
    const cardElAriaHidden = /cardEl\.setAttribute\('aria-hidden'/;
    expect(carousel).not.toMatch(cardElAriaHidden);
    // 역검증 — 이 파일이 aria-hidden 자체를 전혀 안 쓰는 게 아니라, 위치 표시(span)에는 의도적으로 쓴다.
    expect(carousel).toContain("position.setAttribute('aria-hidden', 'true')");
  });
});
