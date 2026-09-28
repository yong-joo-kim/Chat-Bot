import { judgeIngestResultText } from './judge-ingest-result-text';

describe('judgeIngestResultText', () => {
  it('"...성공."은 SUCCESS', () => {
    expect(judgeIngestResultText('RAG Vector DB 추가 성공.')).toBe('SUCCESS');
  });
  it('"...실패."는 FAILURE(200인데 실패하는 함정 — API_RAG.md)', () => {
    expect(judgeIngestResultText('RAG Vector DB 추가 실패.')).toBe('FAILURE');
  });
  it('둘 다 아니면 UNKNOWN', () => {
    expect(judgeIngestResultText('처리 중')).toBe('UNKNOWN');
    expect(judgeIngestResultText(undefined)).toBe('UNKNOWN');
  });
});
