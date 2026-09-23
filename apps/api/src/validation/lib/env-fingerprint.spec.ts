import { buildEnvFingerprint, diffFingerprint } from './env-fingerprint';

const bundle = {
  intents: [{}, {}],
  keywords: [{}],
  homonyms: [],
  contexts: [],
  dialogNodes: [{}, {}, {}],
  faqs: [{}],
} as never;

describe('buildEnvFingerprint/diffFingerprint — §6.3, FR-V2-19', () => {
  it('자산 건수 6종을 정확히 센다', () => {
    const fp = buildEnvFingerprint({
      bundle,
      embeddingModelId: 'model-a',
      semanticEnabled: true,
      thresholds: { accept: 0.8, low: 0.6, margin: 0.05 },
      degradedMode: false,
      useRag: false,
      overlaySource: 'NONE',
    });
    expect(fp.assetCounts).toEqual({ intents: 2, keywords: 1, homonyms: 0, contexts: 0, nodes: 3, faqs: 1 });
  });

  it('embeddingModelId 불일치는 강한 경고(WARNING)를 낸다', () => {
    const base = buildEnvFingerprint({ bundle, embeddingModelId: 'model-a', semanticEnabled: true, thresholds: { accept: 0.8, low: 0.6, margin: 0.05 }, degradedMode: false, useRag: false, overlaySource: 'NONE' });
    const target = { ...base, embeddingModelId: 'model-b' };
    const badges = diffFingerprint(base, target);
    expect(badges).toContainEqual({ key: 'embeddingModelId', label: '임베딩 모델 변경', severity: 'WARNING' });
  });

  it('degradedMode 불일치도 강한 경고다', () => {
    const base = buildEnvFingerprint({ bundle, embeddingModelId: 'm', semanticEnabled: true, thresholds: { accept: 0.8, low: 0.6, margin: 0.05 }, degradedMode: false, useRag: false, overlaySource: 'NONE' });
    const target = { ...base, degradedMode: true };
    expect(diffFingerprint(base, target)).toContainEqual({ key: 'degradedMode', label: '저하 모드 차이', severity: 'WARNING' });
  });

  it('완전히 동일하면 배지가 없다', () => {
    const fp = buildEnvFingerprint({ bundle, embeddingModelId: 'm', semanticEnabled: true, thresholds: { accept: 0.8, low: 0.6, margin: 0.05 }, degradedMode: false, useRag: false, overlaySource: 'NONE' });
    expect(diffFingerprint(fp, { ...fp })).toEqual([]);
  });

  it('둘 중 하나라도 null이면 빈 배열(비교 불가 상태)을 반환한다', () => {
    expect(diffFingerprint(null, null)).toEqual([]);
  });
});
