import { MockEmbeddingProvider } from './mock-embedding.provider';

describe('MockEmbeddingProvider', () => {
  it('같은 텍스트는 항상 같은 벡터를 반환한다(결정론)', async () => {
    const provider = new MockEmbeddingProvider(32);
    const [a] = await provider.embed(['배송 언제 오나요'], 'QUERY');
    const [b] = await provider.embed(['배송 언제 오나요'], 'PASSAGE');
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('다른 텍스트는 다른 벡터를 반환한다', async () => {
    const provider = new MockEmbeddingProvider(32);
    const [a] = await provider.embed(['배송 언제 오나요'], 'QUERY');
    const [b] = await provider.embed(['환불하고 싶어요'], 'QUERY');
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it('반환 벡터는 L2 정규화되어 있다(단위벡터, FR-N1-5)', async () => {
    const provider = new MockEmbeddingProvider(16);
    const [v] = await provider.embed(['테스트 문장'], 'QUERY');
    const norm = Math.sqrt(Array.from(v).reduce((sum, x) => sum + x * x, 0));
    expect(norm).toBeCloseTo(1, 4);
  });

  it('healthy()는 항상 true다', async () => {
    const provider = new MockEmbeddingProvider();
    await expect(provider.healthy()).resolves.toBe(true);
  });

  it('modelId는 mock 규약 문자열이다', () => {
    const provider = new MockEmbeddingProvider();
    expect(provider.modelId).toBe('mock@0|noprefix|l2');
  });
});
