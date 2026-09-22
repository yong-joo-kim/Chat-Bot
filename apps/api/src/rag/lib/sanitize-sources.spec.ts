import { sanitizeSources, scopeMismatchDetected } from './sanitize-sources';
import { RagSourceInfoSchema } from './rag-response.schema';

describe('sanitizeSources — FR-N2-20~23, AC-N2-8/9', () => {
  it('AC-N2-8: file_path의 절대경로를 노출하지 않고 파일명만 남긴다', () => {
    const sourceInfo = RagSourceInfoSchema.parse({
      total_sources: 1,
      sources: [{ file_path: '/home/doota/backend/uploads/연금안내서.pdf', page: 12, section_title: '노령연금 수급요건' }],
    });
    const result = sanitizeSources(sourceInfo);
    expect(result).toEqual([{ fileName: '연금안내서.pdf', sectionTitle: '노령연금 수급요건', page: 12 }]);
  });

  it('AC-N2-9: page/section_title이 "N/A"면 오류 없이 생략된다', () => {
    const sourceInfo = RagSourceInfoSchema.parse({
      total_sources: 1,
      sources: [{ file_path: 'a/b/c.pdf', page: 'N/A', section_title: 'N/A', total_pages: 'N/A' }],
    });
    const result = sanitizeSources(sourceInfo);
    expect(result).toEqual([{ fileName: 'c.pdf' }]);
  });

  it('최대 3건까지만 반환한다(FR-N2-20)', () => {
    const sourceInfo = RagSourceInfoSchema.parse({
      total_sources: 5,
      sources: Array.from({ length: 5 }, (_, i) => ({ file_path: `f${i}.pdf` })),
    });
    expect(sanitizeSources(sourceInfo)).toHaveLength(3);
  });

  it('source_info가 null이면 빈 배열이다', () => {
    expect(sanitizeSources(null)).toEqual([]);
  });

  it('sources가 빈 배열이면 빈 배열을 반환한다(EX-N2-8 — 출처 영역 미표시)', () => {
    const sourceInfo = RagSourceInfoSchema.parse({ total_sources: 0, sources: [] });
    expect(sanitizeSources(sourceInfo)).toEqual([]);
  });

  describe('scopeMismatchDetected — EX-N2-14', () => {
    it('common_metadata.company가 기대 스코프와 다르면 true다', () => {
      const sourceInfo = RagSourceInfoSchema.parse({ total_sources: 1, common_metadata: { company: '다른회사' }, sources: [] });
      expect(scopeMismatchDetected(sourceInfo, '국민연금')).toBe(true);
    });

    it('common_metadata.company가 "N/A"면 판정하지 않는다(false)', () => {
      const sourceInfo = RagSourceInfoSchema.parse({ total_sources: 1, common_metadata: { company: 'N/A' }, sources: [] });
      expect(scopeMismatchDetected(sourceInfo, '국민연금')).toBe(false);
    });
  });
});
