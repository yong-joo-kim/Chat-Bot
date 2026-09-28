import { decideChange, isShrunk } from './change-detect';

describe('decideChange', () => {
  it('이전 해시가 없으면 NEW', () => {
    const result = decideChange({}, { contentHash: 'h1', ingestFingerprint: 'f1' });
    expect(result).toEqual({ change: 'NEW', shrunk: false });
  });

  it('해시·지문이 같으면 UNCHANGED', () => {
    const result = decideChange({ contentHash: 'h1', ingestFingerprint: 'f1' }, { contentHash: 'h1', ingestFingerprint: 'f1' });
    expect(result).toEqual({ change: 'UNCHANGED', shrunk: false });
  });

  it('해시가 다르면 CHANGED', () => {
    const result = decideChange({ contentHash: 'h1', ingestFingerprint: 'f1' }, { contentHash: 'h2', ingestFingerprint: 'f1' });
    expect(result.change).toBe('CHANGED');
  });

  it('지문만 달라도 CHANGED다(마스킹·형식 변경 시 자동 재적재 — R-25)', () => {
    const result = decideChange({ contentHash: 'h1', ingestFingerprint: 'f1' }, { contentHash: 'h1', ingestFingerprint: 'f2' });
    expect(result.change).toBe('CHANGED');
  });

  it('이전에 적재된 문서가 50% 미만으로 줄면 shrunk=true', () => {
    const result = decideChange(
      { contentHash: 'h1', ingestFingerprint: 'f1', textLength: 1000, lastIngestedAt: new Date() },
      { contentHash: 'h2', ingestFingerprint: 'f1', textLength: 400 },
    );
    expect(result).toEqual({ change: 'CHANGED', shrunk: true });
  });

  it('적재된 적 없으면 축소 판정을 하지 않는다', () => {
    const result = decideChange({ contentHash: 'h1', ingestFingerprint: 'f1', textLength: 1000, lastIngestedAt: null }, { contentHash: 'h2', ingestFingerprint: 'f1', textLength: 10 });
    expect(result.shrunk).toBe(false);
  });
});

describe('isShrunk (RG-6 — 적재 성공 시점의 축소 판정)', () => {
  const ingested = new Date();
  it('본문 길이가 이전의 절반 미만이면 축소, 정확히 절반이면 아니다', () => {
    expect(isShrunk({ textLength: 1000, lastIngestedAt: ingested }, { textLength: 499 })).toBe(true);
    expect(isShrunk({ textLength: 1000, lastIngestedAt: ingested }, { textLength: 500 })).toBe(false);
  });
  it('파일은 바이트 크기로 판정한다', () => {
    expect(isShrunk({ byteSize: 10_000, lastIngestedAt: ingested }, { byteSize: 4999 })).toBe(true);
    expect(isShrunk({ byteSize: 10_000, lastIngestedAt: ingested }, { byteSize: 5000 })).toBe(false);
  });
  it('관측 값이 없으면(null) 그 축은 판정하지 않는다 — HTML의 변환 문서 바이트는 넘기지 않는다', () => {
    expect(isShrunk({ textLength: 1000, byteSize: 30_000, lastIngestedAt: ingested }, { textLength: 900, byteSize: null })).toBe(false);
  });
  it('이전에 적재된 적이 없으면 축소가 아니다', () => {
    expect(isShrunk({ textLength: 1000, lastIngestedAt: null }, { textLength: 1 })).toBe(false);
  });
});
