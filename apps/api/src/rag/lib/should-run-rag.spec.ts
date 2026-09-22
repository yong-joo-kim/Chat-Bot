import { shouldRunRag } from './should-run-rag';
import type { ShouldRunRagInput } from './should-run-rag';

function baseInput(overrides: Partial<ShouldRunRagInput> = {}): ShouldRunRagInput {
  return {
    ragEnabled: true,
    ragCompany: '국민연금',
    judgeAnswered: false,
    inputKind: 'TEXT',
    blockedByFilter: false,
    sessionInProgress: false,
    wasClarifyResolution: false,
    normalizedLength: 10,
    fallbackPolicy: 'RAG_FIRST',
    hasFallbackNode: false,
    ...overrides,
  };
}

describe('shouldRunRag — FR-N2-1', () => {
  it('9조건을 전부 만족하면 true다', () => {
    expect(shouldRunRag(baseInput())).toBe(true);
  });

  it('ragEnabled=false면 false다', () => {
    expect(shouldRunRag(baseInput({ ragEnabled: false }))).toBe(false);
  });

  it('ragCompany 미설정이면 false다(RAG_NOT_CONFIGURED 조건)', () => {
    expect(shouldRunRag(baseInput({ ragCompany: null }))).toBe(false);
  });

  it('1단계가 이미 답했으면(judgeAnswered=true) false다', () => {
    expect(shouldRunRag(baseInput({ judgeAnswered: true }))).toBe(false);
  });

  it('AC-N2-24와 동형: 금지어 BLOCK 턴이면 false다', () => {
    expect(shouldRunRag(baseInput({ blockedByFilter: true }))).toBe(false);
  });

  it('AC-N2-23: NODE 버튼 턴이면 false다', () => {
    expect(shouldRunRag(baseInput({ inputKind: 'BUTTON_NODE' }))).toBe(false);
  });

  it('AC-N2-22: 컨텍스트 세션 진행 중이면 false다', () => {
    expect(shouldRunRag(baseInput({ sessionInProgress: true }))).toBe(false);
  });

  it('되묻기 해소 턴이면 false다', () => {
    expect(shouldRunRag(baseInput({ wasClarifyResolution: true }))).toBe(false);
  });

  it('정규화 길이가 2자 미만이면 false다', () => {
    expect(shouldRunRag(baseInput({ normalizedLength: 1 }))).toBe(false);
  });

  it('정규화 길이가 200자 초과면 false다', () => {
    expect(shouldRunRag(baseInput({ normalizedLength: 201 }))).toBe(false);
  });

  it('NODE_FIRST 정책 + 폴백 노드가 있으면 false다(FR-N2-2)', () => {
    expect(shouldRunRag(baseInput({ fallbackPolicy: 'NODE_FIRST', hasFallbackNode: true }))).toBe(false);
  });

  it('NODE_FIRST 정책이어도 폴백 노드가 없으면 true다', () => {
    expect(shouldRunRag(baseInput({ fallbackPolicy: 'NODE_FIRST', hasFallbackNode: false }))).toBe(true);
  });
});
