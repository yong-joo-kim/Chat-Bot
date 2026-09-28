/**
 * [pass 4 · 위반 4] `configVersion`을 올려야 하는 "실제 변경" 판정(순수 — §9.8). 예전에는 수정 요청 본문에
 * 범위 필드가 **존재하기만** 하면(값이 같아도) 올려 버렸다 — 콘솔이 폼 전체를 그대로 다시 보내면 이름만
 * 바꿔도 승인이 무효가 되고 미리보기를 다시 해야 했다. 여기서는 저장된 현재 값과 **다를 때만** 변경으로 본다.
 *
 * 올리는 필드: 시작 주소·사이트맵·경로 접두·제외·잡음 패턴·쿼리 허용·깊이·최대 페이지·파일 형식·파일 상한·
 * 스코프 3단·`piiMask`·`allowRawFileIngest`. 올리지 않는 필드(이름·주기·인증·요청 간격·`enabled`)는 이 함수의
 * 입력 타입에 아예 없다.
 *
 * 목록 필드는 **집합**으로 비교한다(순서만 바뀐 저장은 같은 범위다). 숫자 상한(`maxPages`·`maxFileBytes`
 * 등)은 호출부가 서버 상한으로 잘라 낸 **저장될 값**을 넘겨야 한다 — 그래야 상한을 넘는 값을 다시 보내도
 * 저장값이 그대로면 변경이 아니다.
 */
export interface KbConfigSnapshot {
  seedUrls: readonly string[];
  sitemapUrls: readonly string[];
  pathPrefixes: readonly string[];
  excludePatterns: readonly string[];
  noisePatterns: readonly string[];
  fileTypes: readonly string[];
  allowQueryUrls: boolean;
  maxDepth: number;
  maxPages: number;
  maxFileBytes: number;
  scope: { company: string; category: string; subcategory: string };
  piiMask: boolean;
  allowRawFileIngest: boolean;
}

export interface KbConfigChange {
  changed: boolean;
  changedFields: string[];
  /** 스코프 3단 중 하나라도 바뀌었는가 — 이전에 적재된 문서에 `SCOPE_CHANGED`를 다는 근거(§9.8). */
  scopeChanged: boolean;
}

const LIST_FIELDS = ['seedUrls', 'sitemapUrls', 'pathPrefixes', 'excludePatterns', 'noisePatterns', 'fileTypes'] as const;
const SCALAR_FIELDS = ['allowQueryUrls', 'maxDepth', 'maxPages', 'maxFileBytes', 'piiMask', 'allowRawFileIngest'] as const;

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size !== sb.size) return false;
  for (const v of sa) if (!sb.has(v)) return false;
  return true;
}

export function detectConfigChange(current: KbConfigSnapshot, next: Partial<KbConfigSnapshot>): KbConfigChange {
  const changedFields: string[] = [];

  for (const f of LIST_FIELDS) {
    const n = next[f];
    if (n !== undefined && !sameSet(current[f], n)) changedFields.push(f);
  }
  for (const f of SCALAR_FIELDS) {
    const n = next[f];
    if (n !== undefined && n !== current[f]) changedFields.push(f);
  }

  let scopeChanged = false;
  if (next.scope !== undefined) {
    scopeChanged = next.scope.company !== current.scope.company || next.scope.category !== current.scope.category || next.scope.subcategory !== current.scope.subcategory;
    if (scopeChanged) changedFields.push('scope');
  }

  return { changed: changedFields.length > 0, changedFields, scopeChanged };
}
