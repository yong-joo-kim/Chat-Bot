import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * 정적 강제(AC-N2-1, NFR-S11, ADR-0022 §9.1) — 파괴적 외부 엔드포인트 문자열이 저장소 코드에
 * **0건**임을 매 테스트 실행마다 단언한다. "호출하지 않기로 한다"는 약속은 회귀에 약하다 —
 * 이 테스트가 실패하면 CI가 즉시 잡는다.
 *
 * ⚠ **검사기 자신이 그 문자열을 포함하면 안 되므로** 탐지어를 조각으로 조립한다. 이 파일이
 * 그 트릭을 쓰는 유일한 이유는 "왜 이렇게 썼는가"를 후임자가 묻지 않게 하기 위함이다.
 */

const REPO_ROOT = resolve(__dirname, '../../../../..');
const SCAN_ROOTS = ['apps/api/src', 'apps/web/src', 'apps/widget/src', 'packages/dialogue-engine/src', 'packages/shared-types/src', 'packages/pii-mask/src'];
const SELF_ABSOLUTE = resolve(__dirname, 'rag-allowlist.spec.ts');

const FORBIDDEN_FRAGMENTS: Array<[string, string]> = [
  ['/api/docum', 'ents/reset'], // 문서 초기화 — 되돌릴 수 없다(API_RAG.md §4)
  ["'/api/docum", "ents'"], // 문서 전체 삭제 대상 경로(따옴표로 정확히 닫혀 /metadata와 구분됨)
  ['/api/rag/sett', 'ings'], // 서버 전역 설정 — 다른 이용자 응답까지 바뀐다(§7)
  ['/api/rag_prom', 'pts'], // 인증 없는 관리자 프롬프트 API(§8)
];

function walk(dir: string, extensions: string[], out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return; // 디렉터리가 없으면(예: 위젯 미착수) 건너뛴다.
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      walk(fullPath, extensions, out);
    } else if (extensions.some((ext) => entry.endsWith(ext))) {
      out.push(fullPath);
    }
  }
}

function collectSourceFiles(): string[] {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) {
    walk(join(REPO_ROOT, root), ['.ts', '.tsx'], files);
  }
  return files.filter((f) => f !== SELF_ABSOLUTE);
}

describe('RAG allowlist 정적 검사 — AC-N2-1, NFR-S11', () => {
  const files = collectSourceFiles();
  const fileContents = files.map((f) => ({ f, content: readFileSync(f, 'utf8') }));

  it('스캔 대상 파일이 존재한다(회귀 방지 — 스캔 자체가 조용히 0건이 되는 것을 막는다)', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it.each(FORBIDDEN_FRAGMENTS.map(([a, b]) => a + b))('파괴적 엔드포인트 문자열 "%s"이 코드에 0건이다', (forbidden) => {
    const offenders = fileContents.filter(({ content }) => content.includes(forbidden)).map(({ f }) => f);
    expect(offenders).toEqual([]);
  });

  it('RAG_PATHS는 rag-paths.ts·rag-http.client.ts 밖에서 참조되지 않는다(AC-N4-6)', () => {
    const offenders = fileContents
      .filter(({ f }) => !f.endsWith(join('rag', 'lib', 'rag-paths.ts')) && !f.endsWith(join('rag', 'rag-http.client.ts')))
      .filter(({ content }) => content.includes('RAG_PATHS'))
      .map(({ f }) => f);
    expect(offenders).toEqual([]);
  });

  it('RagHttpClient 밖에서 RAG_BASE_URL로 직접 fetch를 조립하지 않는다(FR-0-41)', () => {
    const offenders = fileContents
      .filter(({ f }) => !f.endsWith(join('rag', 'rag-http.client.ts')))
      .filter(({ content }) => content.includes('RAG_BASE_URL') && content.includes('fetch('))
      .map(({ f }) => f);
    expect(offenders).toEqual([]);
  });
});
