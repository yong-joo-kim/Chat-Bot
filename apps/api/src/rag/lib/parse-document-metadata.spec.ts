import { parseDocumentMetadata, scopeChunkCount } from './parse-document-metadata';

const SAMPLE = [
  '--- 벡터 DB 메타 정보 ---',
  '',
  '총 저장된 벡터의 개수: 1842',
  '',
  '회사별 벡터 저장 인덱스 개수:',
  '- 국민연금: 1200개',
  '- 근로복지공단: 642개',
  '',
  '회사별 카테고리 및 서브카테고리 정보 및 벡터 저장 인덱스 개수:',
  '',
  '- 국민연금:',
  '  - 노령연금: 800개',
  '    - 수급요건: 500개',
  '    - 청구방법: 300개',
  '  - 유족연금: 400개',
  '',
  '- 근로복지공단:',
  '  - 산재보험: 642개',
  '    - 요양급여: 642개',
].join('\n');

describe('parseDocumentMetadata — API_RAG.md §2-2', () => {
  it('전체 청크 수를 파싱한다', () => {
    expect(parseDocumentMetadata(SAMPLE).totalChunks).toBe(1842);
  });

  it('회사별 총계를 파싱한다', () => {
    const parsed = parseDocumentMetadata(SAMPLE);
    expect(parsed.byCompany.get('국민연금')?.total).toBe(1200);
    expect(parsed.byCompany.get('근로복지공단')?.total).toBe(642);
  });

  it('카테고리·서브카테고리를 파싱한다', () => {
    const parsed = parseDocumentMetadata(SAMPLE);
    const category = parsed.byCompany.get('국민연금')?.categories.get('노령연금');
    expect(category?.total).toBe(800);
    expect(category?.subcategories.get('수급요건')).toBe(500);
    expect(category?.subcategories.get('청구방법')).toBe(300);
  });

  it('빈 문자열은 totalChunks 0으로 처리한다', () => {
    expect(parseDocumentMetadata('').totalChunks).toBe(0);
  });
});

describe('scopeChunkCount — FR-N2-7, AC-N3-3/5', () => {
  const parsed = parseDocumentMetadata(SAMPLE);

  it('company만 지정하면 회사 총계를 반환한다', () => {
    expect(scopeChunkCount(parsed, { company: '국민연금' })).toBe(1200);
  });

  it('company+category를 지정하면 카테고리 총계를 반환한다', () => {
    expect(scopeChunkCount(parsed, { company: '국민연금', category: '노령연금' })).toBe(800);
  });

  it('company+category+subcategory를 지정하면 서브카테고리 값을 반환한다', () => {
    expect(scopeChunkCount(parsed, { company: '국민연금', category: '노령연금', subcategory: '수급요건' })).toBe(500);
  });

  it('AC-N3-3: 오타난 company는 0을 반환한다(적재된 문서 0건 안내의 근거)', () => {
    expect(scopeChunkCount(parsed, { company: '국민연금공단' })).toBe(0);
  });
});
