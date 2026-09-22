import { judgeRagResponse } from './judge-rag-response';
import { RagQueryResponseSchema } from './rag-response.schema';

function parse(body: unknown) {
  const parsed = RagQueryResponseSchema.parse(body);
  return parsed;
}

describe('judgeRagResponse — FR-N2-17, AC-N2-5~7/30', () => {
  it('AC-N2-7: retrieval_success=1 + source_info=null이면 성공으로 처리한다(source_info로 판별하지 않음)', () => {
    const response = parse({ result: '답변입니다.', keywords: [], source_info: null, retrieval_success: 1 });
    expect(judgeRagResponse(response)).toEqual({ ok: true, response });
  });

  it('AC-N2-5: retrieval_success=0이면 실패다(NO_EVIDENCE)', () => {
    const response = parse({ result: '정보가 부족하여 답변할 수 없습니다.', keywords: [], source_info: null, retrieval_success: 0 });
    const judged = judgeRagResponse(response);
    expect(judged.ok).toBe(false);
    if (!judged.ok) expect(judged.outcome).toBe('NO_EVIDENCE');
  });

  it('AC-N2-6: retrieval_success=1이어도 LLM 오류 접두어로 시작하면 실패로 처리한다', () => {
    const response = parse({
      result: '답변 생성 중 오류가 발생했습니다: timeout',
      keywords: [],
      source_info: { total_sources: 2, sources: [] },
      retrieval_success: 1,
    });
    const judged = judgeRagResponse(response);
    expect(judged.ok).toBe(false);
  });

  it('§0-3: result가 "실패."로 끝나면 실패로 처리한다', () => {
    const response = parse({ result: 'RAG Vector DB 추가 실패.', keywords: [], source_info: null, retrieval_success: 1 });
    expect(judgeRagResponse(response).ok).toBe(false);
  });

  it('result가 빈 문자열이면 실패다', () => {
    const response = parse({ result: '   ', keywords: [], source_info: null, retrieval_success: 1 });
    expect(judgeRagResponse(response).ok).toBe(false);
  });

  it('정상 성공 응답은 ok=true다', () => {
    const response = parse({
      result: '노령연금은 가입기간이 10년 이상이면 받을 수 있어요.',
      keywords: ['수급요건'],
      source_info: { total_sources: 1, sources: [{ file_path: '/home/doota/연금.pdf', page: 12 }] },
      retrieval_success: 1,
    });
    expect(judgeRagResponse(response)).toEqual({ ok: true, response });
  });
});
