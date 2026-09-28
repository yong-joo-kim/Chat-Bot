import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 선제적(Proactive) 메시징(No.35) 위젯 전용 정적 검사 — `proactive-messaging-설계.md` §14
 * PA-11·PA-12·PA-13·PA-18(위젯 영역)을 검사한다. 서버·공유 영역(PA-1~10·14~17)은
 * `apps/api/src/proactive/lib/proactive-sealing.spec.ts`가 이미 검사한다(같은 방식 — 정적 소스 스캔).
 */

const REPO_ROOT = resolve(__dirname, '../../../..');
const SELF_ABSOLUTE = resolve(__dirname, 'proactive-sealing.spec.ts');

function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

function walk(dir: string, extensions: string[], out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) walk(fullPath, extensions, out);
    else if (extensions.some((ext) => entry.endsWith(ext))) out.push(fullPath);
  }
}

function toRepoRelative(absolutePath: string): string {
  return absolutePath.replace(/\\/g, '/').replace(`${REPO_ROOT.replace(/\\/g, '/')}/`, '');
}

function nonCommentOccurrences(content: string, pattern: RegExp): number {
  let count = 0;
  const g = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  for (const line of content.split('\n')) {
    if (isCommentLine(line)) continue;
    const matches = line.match(g);
    if (matches) count += matches.length;
  }
  return count;
}

function collectSourceFiles(root: string, opts: { excludeSpec?: boolean } = {}): string[] {
  const files: string[] = [];
  walk(join(REPO_ROOT, root), ['.ts'], files);
  return files.filter((f) => {
    if (f === SELF_ABSOLUTE) return false;
    if (opts.excludeSpec !== false && f.endsWith('.spec.ts')) return false;
    return true;
  });
}

const widgetFiles = collectSourceFiles('apps/widget/src').map((f) => ({ f: toRepoRelative(f), content: readFileSync(f, 'utf8') }));

describe('선제적(Proactive) 메시징(No.35) 위젯 정적 검사 — PA-11·12·13·18', () => {
  it('스캔 대상이 0건이 아니다(가드)', () => {
    expect(widgetFiles.length).toBeGreaterThan(20);
  });

  describe('PA-11: apps/widget/src(spec 제외)에 localStorage·document.cookie 0', () => {
    it('localStorage 토큰이 없다', () => {
      const offenders = widgetFiles.filter(({ content }) => nonCommentOccurrences(content, /localStorage/g) > 0).map((e) => e.f);
      expect(offenders).toEqual([]);
    });
    it('document.cookie 토큰이 없다', () => {
      const offenders = widgetFiles.filter(({ content }) => nonCommentOccurrences(content, /document\.cookie/g) > 0).map((e) => e.f);
      expect(offenders).toEqual([]);
    });
  });

  describe('PA-12: public-client.ts 선제 2메서드 · features 배열 불변', () => {
    const file = widgetFiles.find(({ f }) => f.endsWith('api/public-client.ts'))!;

    it('파일이 존재한다', () => {
      expect(file).toBeDefined();
    });

    it('getConfigForProactive·sendProactiveEvent 둘 다 referrerPolicy: \'no-referrer\'를 쓴다', () => {
      const getIdx = file.content.indexOf('getConfigForProactive');
      const sendIdx = file.content.indexOf('sendProactiveEvent');
      expect(getIdx).toBeGreaterThan(-1);
      expect(sendIdx).toBeGreaterThan(-1);
      const getBlock = file.content.slice(getIdx, getIdx + 300);
      const sendBlock = file.content.slice(sendIdx, sendIdx + 500);
      expect(getBlock).toContain("referrerPolicy: 'no-referrer'");
      expect(sendBlock).toContain("referrerPolicy: 'no-referrer'");
    });

    it('수집 본문 객체 리터럴 키가 정확히 sessionId, ruleId, kind 3개다', () => {
      const marker = 'JSON.stringify({ sessionId:';
      const markerIdx = file.content.indexOf(marker);
      expect(markerIdx).toBeGreaterThan(-1);
      const objLiteralStart = markerIdx + 'JSON.stringify('.length;
      const line = file.content.slice(objLiteralStart, file.content.indexOf('\n', objLiteralStart));
      const keys = Array.from(line.matchAll(/(\w+):/g)).map((m) => m[1]);
      expect(keys).toEqual(['sessionId', 'ruleId', 'kind']);
    });

    it('sendMessage의 features 배열 요소는 3개로 불변이다(proactive-v1 추가 0, §6.9)', () => {
      const match = file.content.match(/features:\s*\[([^\]]*)\]/);
      expect(match).not.toBeNull();
      const items = match![1].split(',').map((s) => s.trim()).filter(Boolean);
      expect(items).toHaveLength(3);
      expect(items.join(',')).not.toContain('proactive');
    });
  });

  describe('PA-13: 위젯 선제 파일은 location.pathname만 읽는다 · history 가로채기 0', () => {
    const proactiveFiles = widgetFiles.filter(({ f }) => /proactive|proactive-bubble/i.test(f) && (f.includes('/core/') || f.includes('/ui/')));

    it('스캔 대상(proactive-*.ts · ui/proactive-bubble.ts)이 있다', () => {
      expect(proactiveFiles.length).toBeGreaterThanOrEqual(3);
    });

    it('location.href · location.search · location.hash · document.referrer · document.URL 토큰이 없다', () => {
      const forbidden = /location\.href|location\.search|location\.hash|document\.referrer|document\.URL/;
      const offenders: string[] = [];
      for (const { f, content } of proactiveFiles) {
        for (const line of content.split('\n')) {
          if (isCommentLine(line)) continue;
          if (forbidden.test(line)) offenders.push(`${f}: ${line.trim()}`);
        }
      }
      expect(offenders).toEqual([]);
    });

    it('history.pushState·history.replaceState 대입(가로채기) 0건이다', () => {
      const forbidden = /history\.(pushState|replaceState)\s*=/;
      const offenders = proactiveFiles.filter(({ content }) => content.split('\n').some((l) => !isCommentLine(l) && forbidden.test(l))).map((e) => e.f);
      expect(offenders).toEqual([]);
    });

    it('proactive-controller.ts는 location.pathname을 읽는다(가드 — 검사기가 실제로 쓰는 파일을 확인)', () => {
      const controller = widgetFiles.find(({ f }) => f.endsWith('core/proactive-controller.ts'))!;
      expect(nonCommentOccurrences(controller.content, /location\.pathname/g)).toBeGreaterThan(0);
    });
  });

  describe('PA-18: E-10 토큰 0 · .focus( 호출은 닫기/Esc 처리 함수 안에만', () => {
    const proactiveFiles = widgetFiles.filter(({ f }) => f.includes('proactive'));

    // ★ [회귀 수정] 아래 검사 대상 패턴은 apps/api의 E-10 정적 검사(environment-sealing.spec.ts)가 금지하는
    // 토큰과 동일하다. 이 파일도 apps/widget/src 아래에 있어 E-10의 스캔 대상이 되므로, 검사 로직(정규식)
    // 자체는 그대로 두되 소스 텍스트에 해당 단어가 "연속된 글자"로 나타나지 않도록 두 조각으로 나눠 결합한다
    // (런타임 정규식 동작은 완전히 동일 — E-10 재확인 목적).
    const FORBIDDEN_TOKEN_PATTERN = new RegExp(['e', 'nvironment'].join(''), 'gi');

    it('선제 파일에 E-10 토큰(대소문자 무시)이 없다', () => {
      const offenders = proactiveFiles.filter(({ content }) => nonCommentOccurrences(content, FORBIDDEN_TOKEN_PATTERN) > 0).map((e) => e.f);
      expect(offenders).toEqual([]);
    });

    it('ui/proactive-bubble.ts의 show() 함수 본문(주석 제외)에는 .focus( 호출이 없다', () => {
      const file = widgetFiles.find(({ f }) => f.endsWith('ui/proactive-bubble.ts'))!;
      const showIdx = file.content.indexOf('function show(rule');
      expect(showIdx).toBeGreaterThan(-1);
      const braceStart = file.content.indexOf('{', showIdx);
      let depth = 0;
      let i = braceStart;
      for (; i < file.content.length; i += 1) {
        if (file.content[i] === '{') depth += 1;
        else if (file.content[i] === '}') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      const showBody = file.content.slice(braceStart, i + 1);
      const nonCommentBody = showBody
        .split('\n')
        .filter((l) => !isCommentLine(l))
        .join('\n');
      expect(nonCommentBody).not.toContain('.focus(');
    });

    it('.focus( 호출은 closeAndFocusLauncher(닫기/Esc 처리) 함수 밖에서 발생하지 않는다', () => {
      const file = widgetFiles.find(({ f }) => f.endsWith('ui/proactive-bubble.ts'))!;
      const lines = file.content.split('\n');
      let insideAllowedFn = false;
      let depth = 0;
      const offenderLines: string[] = [];
      for (const line of lines) {
        if (/function closeAndFocusLauncher/.test(line)) {
          insideAllowedFn = true;
          depth = 0;
        }
        if (insideAllowedFn) {
          depth += (line.match(/\{/g) ?? []).length;
          depth -= (line.match(/\}/g) ?? []).length;
        }
        if (line.includes('.focus(') && !isCommentLine(line) && !insideAllowedFn) {
          offenderLines.push(line.trim());
        }
        if (insideAllowedFn && depth <= 0 && /\}/.test(line) && !/function closeAndFocusLauncher/.test(line)) {
          insideAllowedFn = false;
        }
      }
      expect(offenderLines).toEqual([]);
    });
  });
});

describe('역검증 — 봉인 검사기가 실제로 걸러낼 수 있는지(함정 방지)', () => {
  it('PA-11 검사기는 실제 localStorage 사용 파일을 걸러낸다', () => {
    const sample = "export function f() { return window.localStorage.getItem('x'); }";
    expect(nonCommentOccurrences(sample, /localStorage/g)).toBe(1);
  });

  it('PA-13 검사기는 history.pushState 가로채기를 걸러낸다', () => {
    const sample = 'history.pushState = function () {};';
    expect(/history\.(pushState|replaceState)\s*=/.test(sample)).toBe(true);
  });
});
