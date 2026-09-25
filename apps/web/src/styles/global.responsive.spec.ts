import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fullCss = readFileSync(resolve(__dirname, './global.css'), 'utf-8');

// [R1 M-2] `.environment-status-cards` 규칙만 남긴 구간. 파일 전체에는 같은 브레이크포인트
// (`@media (min-width: 1024px)` 등)를 쓰는 다른 컴포넌트 규칙도 있어, 전체 텍스트에서 바로
// 매치하면 엉뚱한 블록을 집을 수 있다 — `[R1 M-2]` 주석부터 파일 끝까지만 잘라내 검사한다(이 블록이
// 파일의 마지막 규칙이라 안전하다).
const startIdx = fullCss.indexOf('[R1 M-2]');
const css = fullCss.slice(startIdx);

/**
 * [R1 M-2] `.environment-status-cards`(EN1 현황 3카드)의 반응형 규칙을
 * `environment-separation-ui-spec.md` §11.1대로 지키는지 확인한다. jsdom에는 실제 뷰포트 렌더링이
 * 없어 미디어쿼리 매치 여부까지는 검증할 수 없으므로("반응형 클래스 확인 가능 범위"), CSS 소스에
 * 각 구간의 규칙이 정확한 선택자·값으로 존재하는지를 정적으로 확인한다.
 */
describe('global.css — .environment-status-cards 반응형(§11.1)', () => {
  it('기본(모바일, <640px)은 세로 1열이다', () => {
    const match = css.match(/\.environment-status-cards\s*\{([^}]*)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/grid-template-columns:\s*1fr;/);
  });

  it('태블릿(640~1023px)은 2열이고, 세 번째 카드(운영)만 전체 폭(줄바꿈)을 차지한다', () => {
    const mediaMatch = css.match(/@media \(min-width: 640px\) and \(max-width: 1023px\)\s*\{([\s\S]*?)\n\}/);
    expect(mediaMatch).not.toBeNull();
    const block = mediaMatch![1];
    expect(block).toMatch(/\.environment-status-cards\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*1fr\);[^}]*\}/);
    expect(block).toMatch(/\.environment-status-cards\s*>\s*\.environment-status-card:nth-child\(3\)\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;[^}]*\}/);
  });

  it('데스크톱(>=1024px)은 3열 가로 배치다', () => {
    const mediaMatch = css.match(/@media \(min-width: 1024px\)\s*\{([\s\S]*?)\n\}/);
    expect(mediaMatch).not.toBeNull();
    expect(mediaMatch![1]).toMatch(/\.environment-status-cards\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*1fr\);[^}]*\}/);
  });
});
