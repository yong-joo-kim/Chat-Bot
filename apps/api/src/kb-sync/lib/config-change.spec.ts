import { detectConfigChange } from './config-change';
import type { KbConfigSnapshot } from './config-change';

const current: KbConfigSnapshot = {
  seedUrls: ['https://a.example/docs/', 'https://a.example/faq/'],
  sitemapUrls: ['https://a.example/sitemap.xml'],
  pathPrefixes: ['/docs', '/faq'],
  excludePatterns: ['/docs/old/*'],
  noisePatterns: ['목차'],
  fileTypes: ['PDF'],
  allowQueryUrls: false,
  maxDepth: 3,
  maxPages: 500,
  maxFileBytes: 20971520,
  scope: { company: '예시공사', category: '인사', subcategory: '규정' },
  piiMask: true,
  allowRawFileIngest: false,
};

describe('detectConfigChange — configVersion은 저장된 값이 실제로 바뀔 때만 올린다(pass 4 위반 4)', () => {
  it('본문이 비어 있으면 변경 없음', () => {
    expect(detectConfigChange(current, {})).toEqual({ changed: false, changedFields: [], scopeChanged: false });
  });

  it('★ 범위 필드를 같은 값으로 그대로 다시 보내도 변경이 아니다(예전엔 필드가 있기만 하면 올렸다)', () => {
    const resend: Partial<KbConfigSnapshot> = { ...current, scope: { ...current.scope } };
    const result = detectConfigChange(current, resend);
    expect(result.changed).toBe(false);
    expect(result.changedFields).toEqual([]);
  });

  it('목록은 집합으로 비교한다 — 순서만 바뀐 저장은 변경이 아니다', () => {
    expect(detectConfigChange(current, { seedUrls: [...current.seedUrls].reverse(), pathPrefixes: ['/faq', '/docs'] }).changed).toBe(false);
  });

  it('목록에 항목이 더해지거나 빠지거나 바뀌면 변경이다', () => {
    expect(detectConfigChange(current, { seedUrls: [...current.seedUrls, 'https://a.example/new/'] }).changedFields).toEqual(['seedUrls']);
    expect(detectConfigChange(current, { pathPrefixes: ['/docs'] }).changedFields).toEqual(['pathPrefixes']);
    expect(detectConfigChange(current, { excludePatterns: [] }).changedFields).toEqual(['excludePatterns']);
    expect(detectConfigChange(current, { noisePatterns: ['다른 줄'] }).changedFields).toEqual(['noisePatterns']);
    expect(detectConfigChange(current, { fileTypes: ['PDF', 'DOCX'] }).changedFields).toEqual(['fileTypes']);
    expect(detectConfigChange(current, { sitemapUrls: [] }).changedFields).toEqual(['sitemapUrls']);
  });

  it('숫자·불리언 필드는 값이 다를 때만 변경이다', () => {
    expect(detectConfigChange(current, { maxDepth: 3, maxPages: 500, maxFileBytes: 20971520, allowQueryUrls: false, piiMask: true, allowRawFileIngest: false }).changed).toBe(false);
    expect(detectConfigChange(current, { maxDepth: 2 }).changedFields).toEqual(['maxDepth']);
    expect(detectConfigChange(current, { maxPages: 501 }).changedFields).toEqual(['maxPages']);
    expect(detectConfigChange(current, { maxFileBytes: 1_048_576 }).changedFields).toEqual(['maxFileBytes']);
    expect(detectConfigChange(current, { allowQueryUrls: true }).changedFields).toEqual(['allowQueryUrls']);
    expect(detectConfigChange(current, { piiMask: false }).changedFields).toEqual(['piiMask']);
    expect(detectConfigChange(current, { allowRawFileIngest: true }).changedFields).toEqual(['allowRawFileIngest']);
  });

  it('스코프는 3단 중 하나만 달라도 변경이고 scopeChanged가 켜진다(SCOPE_CHANGED 표시의 근거)', () => {
    expect(detectConfigChange(current, { scope: { ...current.scope } })).toEqual({ changed: false, changedFields: [], scopeChanged: false });
    for (const scope of [
      { ...current.scope, company: '다른공사' },
      { ...current.scope, category: '총무' },
      { ...current.scope, subcategory: '복무' },
    ]) {
      expect(detectConfigChange(current, { scope })).toEqual({ changed: true, changedFields: ['scope'], scopeChanged: true });
    }
  });

  it('여러 필드가 함께 바뀌면 모두 나열한다 · 범위와 무관한 변경은 스코프 표시를 켜지 않는다', () => {
    const result = detectConfigChange(current, { maxDepth: 1, piiMask: false });
    expect(result.changedFields).toEqual(['maxDepth', 'piiMask']);
    expect(result.scopeChanged).toBe(false);
  });
});
