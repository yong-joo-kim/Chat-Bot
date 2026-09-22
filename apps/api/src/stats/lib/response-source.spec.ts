import { classifyResponseSource } from './response-source';

describe('classifyResponseSource (FR-14-20, §7.3)', () => {
  it('classifies as FALLBACK whenever isAnswered=false, even if matchedNodeId is set (폴백 노드 함정)', () => {
    expect(classifyResponseSource({ matchedNodeId: 'node-1', matchedFaqId: null, isAnswered: false })).toBe('FALLBACK');
  });

  it('classifies as NODE when matchedNodeId is present and answered', () => {
    expect(classifyResponseSource({ matchedNodeId: 'node-1', matchedFaqId: null, isAnswered: true })).toBe('NODE');
  });

  it('classifies as FAQ when only matchedFaqId is present and answered', () => {
    expect(classifyResponseSource({ matchedNodeId: null, matchedFaqId: 'faq-1', isAnswered: true })).toBe('FAQ');
  });

  it('classifies as OTHER when answered but neither node nor faq matched', () => {
    expect(classifyResponseSource({ matchedNodeId: null, matchedFaqId: null, isAnswered: true })).toBe('OTHER');
  });

  it('AC-N2-21: classifies as RAG when answeredByRag=true and neither node nor faq matched', () => {
    expect(classifyResponseSource({ matchedNodeId: null, matchedFaqId: null, isAnswered: true, answeredByRag: true })).toBe('RAG');
  });

  it('AC-N4-10: answeredByRag가 없어도(undefined) 기존 OTHER 판정이 그대로 유지된다(회귀 없음)', () => {
    expect(classifyResponseSource({ matchedNodeId: null, matchedFaqId: null, isAnswered: true })).toBe('OTHER');
  });
});
