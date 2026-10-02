// H-T9: 선택자 문구 = 제품 상수 파일 문자열(정규식으로 원문 추출해 비교 — 제품 소스는 import하지 않는다)
// 제품 문구가 바뀌면 이 시험이 먼저 알려 준다. 숫자가 든 문구(함수)는 숫자를 기준으로 조각을 나눠 모든 조각이 원문에 있는지 확인한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONSOLE_TEXT } from '../src/selectors/console';
import { WIDGET_TEXT } from '../src/selectors/widget';

const REPO = join(__dirname, '..', '..', '..', '..');

function readAll(dir: string, ext: string): string {
  if (!existsSync(dir)) return '';
  return readdirSync(dir)
    .filter((n) => n.endsWith(ext) && !n.endsWith('.spec.ts'))
    .map((n) => readFileSync(join(dir, n), 'utf8'))
    .join('\n');
}

const WEB_SRC = readAll(join(REPO, 'apps', 'web', 'src', 'constants'), '.ts');
const WIDGET_SRC = readAll(join(REPO, 'apps', 'widget', 'src', 'constants'), '.ts');
const SHARED_AUDIT = readFileSync(join(REPO, 'packages', 'shared-types', 'src', 'audit.ts'), 'utf8');

function leaves(value: unknown, path: string, out: Array<{ path: string; text: string }>): void {
  if (typeof value === 'string') out.push({ path, text: value });
  else if (typeof value === 'function') {
    // 숫자 인자로 호출한 결과를 조각(숫자 사이 글자)으로 쪼개 원문에 있는지 본다
    const text = (value as (...a: unknown[]) => unknown)(7, 8) as string;
    out.push({ path, text });
  } else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) leaves(v, `${path}.${k}`, out);
}

function pieces(text: string): string[] {
  return text.split(/\d+/).map((p) => p.trim()).filter((p) => p.length >= 2);
}

test('콘솔 선택자 문구가 apps/web 문구 상수·shared-types 라벨에 그대로 있다', () => {
  const all: Array<{ path: string; text: string }> = [];
  leaves(CONSOLE_TEXT, 'CONSOLE_TEXT', all);
  assert.ok(all.length > 30);
  const corpus = WEB_SRC + '\n' + SHARED_AUDIT;
  const missing: string[] = [];
  for (const { path, text } of all) {
    for (const p of pieces(text)) if (!corpus.includes(p)) missing.push(`${path}: "${p}"`);
  }
  assert.deepEqual(missing, []);
});

test('위젯 선택자 문구가 apps/widget 문구 상수에 그대로 있다', () => {
  const missing = Object.entries(WIDGET_TEXT).filter(([, v]) => !WIDGET_SRC.includes(v)).map(([k, v]) => `${k}: "${v}"`);
  assert.deepEqual(missing, []);
});

test('시나리오 파일에 하드코딩된 한글 선택자 문구가 없는 새 장면(opening·s5·s6·s7·closing)은 선택자 모듈의 상수를 쓴다', () => {
  // 새 장면 파일이 선택자 모듈(CONSOLE_TEXT)을 import한다 — 문구를 시나리오에 복제하지 않는다(NFR-DHM1)
  for (const f of ['opening', 's5', 's6', 's7']) {
    const src = readFileSync(join(__dirname, '..', '..', 'src', 'scenarios', `${f}.ts`), 'utf8');
    assert.ok(/from '\.\.\/selectors\/console'/.test(src), `${f}.ts`);
  }
});
