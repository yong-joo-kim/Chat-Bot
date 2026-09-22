/**
 * 테스트 전용 폴리필 — jsdom(25.x 기준)은 `CSS.escape`를 구현하지 않는다(jsdom/jsdom#1076, 미해결).
 * 실제 배포 대상 브라우저(Chrome/Firefox/Safari/Edge 최신)는 전부 `CSS.escape`를 지원하므로
 * 프로덕션 동작에는 영향이 없다 — 이 파일은 `renderers/pending-indicator.ts`(FR-N2-38, ADR-0023)처럼
 * `CSS.escape`를 쓰는 위젯 코드를 jsdom 기반 `*.spec.ts`에서도 예외 없이 실행하기 위한
 * 테스트 하네스 보강이며, `vite.config.ts`의 `test.setupFiles`에서만 로드된다(번들에 포함되지 않음).
 *
 * 알고리즘은 CSSOM 표준(`CSS.escape()`)의 축약 구현이다 — 위젯이 실제로 이스케이프하는 값은
 * UUID(`messageId`) 1종뿐이라 전체 스펙 커버리지가 목적이 아니라, "예외를 던지지 않고 유효한
 * CSS 식별자를 만든다"는 계약만 충족하면 충분하다.
 * 참고: https://drafts.csswg.org/cssom/#the-css.escape()-method
 */
function cssEscape(value: string): string {
  const str = String(value);
  const { length } = str;
  let result = '';

  for (let i = 0; i < length; i += 1) {
    const char = str.charAt(i);
    const code = str.charCodeAt(i);

    if (code === 0x0000) {
      result += '�';
      continue;
    }
    if (
      (code >= 0x0001 && code <= 0x001f) ||
      code === 0x007f ||
      (i === 0 && code >= 0x0030 && code <= 0x0039) ||
      (i === 1 && code >= 0x0030 && code <= 0x0039 && str.charCodeAt(0) === 0x002d)
    ) {
      result += `\\${code.toString(16)} `;
      continue;
    }
    if (i === 0 && length === 1 && code === 0x002d) {
      result += `\\${char}`;
      continue;
    }
    if (
      code >= 0x0080 ||
      code === 0x002d ||
      code === 0x005f ||
      (code >= 0x0030 && code <= 0x0039) ||
      (code >= 0x0041 && code <= 0x005a) ||
      (code >= 0x0061 && code <= 0x007a)
    ) {
      result += char;
      continue;
    }
    result += `\\${char}`;
  }
  return result;
}

type CssWithEscape = { escape?: (value: string) => string };

const globalCss = (globalThis as unknown as { CSS?: CssWithEscape }).CSS;
if (!globalCss) {
  (globalThis as unknown as { CSS: CssWithEscape }).CSS = { escape: cssEscape };
} else if (typeof globalCss.escape !== 'function') {
  globalCss.escape = cssEscape;
}
