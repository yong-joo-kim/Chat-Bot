import { parseXRobotsTag } from './x-robots-tag';

describe('parseXRobotsTag (RG-11)', () => {
  const ME = 'chatbotkbcrawler';
  it.each([
    [undefined, false, false],
    ['', false, false],
    ['noindex', true, false],
    ['NOINDEX, NoFollow', true, true],
    ['none', true, true],
    ['nofollow', false, true],
    ['index, follow', false, false],
    ['noarchive', false, false],
  ])('%s → noindex %s · nofollow %s', (value, noindex, nofollow) => {
    expect(parseXRobotsTag(value, ME)).toEqual({ noindex, nofollow });
  });

  it('봇 이름이 붙은 지시는 우리 제품 토큰일 때만 반영한다', () => {
    expect(parseXRobotsTag('googlebot: noindex', ME).noindex).toBe(false);
    expect(parseXRobotsTag('ChatBotKBCrawler: noindex', ME).noindex).toBe(true);
    expect(parseXRobotsTag('googlebot: noindex, ChatBotKBCrawler: nofollow', ME)).toEqual({ noindex: false, nofollow: true });
  });

  it('봇 이름 없는 지시와 다른 봇의 지시가 섞여도 각자 적용된다', () => {
    expect(parseXRobotsTag('nofollow, googlebot: noindex', ME)).toEqual({ noindex: false, nofollow: true });
  });

  it('unavailable_after 같은 값 있는 지시어의 콜론을 봇 이름으로 오인하지 않는다', () => {
    expect(parseXRobotsTag('unavailable_after: 25 Jun 2999 15:00:00 PST, noindex', ME).noindex).toBe(true);
  });
});

describe('parseXRobotsTag — pass 6 RG-20④ · 쉼표로 합쳐진 여러 줄', () => {
  const ME = 'chatbotkbcrawler';
  // 전송 계층이 같은 이름의 헤더 여러 줄을 ', '로 합치면 줄 경계가 사라진다 — 봇 이름이 없는 조각은 "모든 봇"용이므로 늘 우리에게 적용한다(안전한 방향).
  it.each([
    ['googlebot: noindex, noindex', true, false],
    ['googlebot: nofollow, noindex', true, false],
    ['bingbot: noindex, nofollow', false, true],
    ['googlebot: noindex, ChatBotKBCrawler: nofollow, noindex', true, true],
    ['googlebot: noindex', false, false],
    ['googlebot: none', false, false],
  ])('%s → noindex %s · nofollow %s', (value, noindex, nofollow) => {
    expect(parseXRobotsTag(value, ME)).toEqual({ noindex, nofollow });
  });
});
