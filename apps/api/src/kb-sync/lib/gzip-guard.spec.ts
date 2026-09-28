import { gzipSync } from 'node:zlib';
import { DEFAULT_GZIP_GUARD_LIMITS, GzipGuardViolation, looksLikeGzip, safeGunzip } from './gzip-guard';

describe('gzip-guard — 항목③ 사이트맵 .xml.gz 안전 해제', () => {
  it('정상 gzip은 원문 그대로 복원한다', () => {
    const original = Buffer.from('<?xml version="1.0"?><urlset><url><loc>https://a.example/1</loc></url></urlset>', 'utf8');
    const gz = gzipSync(original);
    expect(looksLikeGzip(new Uint8Array(gz))).toBe(true);
    const out = safeGunzip(new Uint8Array(gz));
    expect(Buffer.from(out).toString('utf8')).toBe(original.toString('utf8'));
  });

  it('gzip이 아닌 입력은 매직 바이트 판정에서 false다', () => {
    expect(looksLikeGzip(new Uint8Array(Buffer.from('<?xml version="1.0"?>', 'utf8')))).toBe(false);
  });

  it('★ 51MB로 해제되는 gzip bomb은 상한(50MB)에서 중단한다', () => {
    // 매우 잘 압축되는(0으로 채운) 51MB 원본 — 압축 후 크기는 매우 작다(진짜 폭탄과 같은 비율).
    const bombOriginal = Buffer.alloc(51 * 1024 * 1024, 0);
    const gz = gzipSync(bombOriginal);
    expect(gz.length).toBeLessThan(1024 * 1024); // 압축률이 실제 폭탄 수준임을 보여준다.

    expect(() => safeGunzip(new Uint8Array(gz))).toThrow(GzipGuardViolation);
    try {
      safeGunzip(new Uint8Array(gz));
      fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(GzipGuardViolation);
      expect((e as GzipGuardViolation).code).toBe('SIZE_EXCEEDED');
    }
  });

  it('망가진 gzip 바이트는 DECODE_ERROR로 거부한다', () => {
    const gz = gzipSync(Buffer.from('a'.repeat(1000), 'utf8'));
    const broken = new Uint8Array(gz);
    // 헤더(멤버 식별자·플래그) 이후 압축 데이터 영역을 뭉갠다 — 유효한 huffman/deflate 스트림이 아니게 된다.
    for (let i = 10; i < broken.length - 8; i += 1) broken[i] = 0xff;
    expect(() => safeGunzip(broken)).toThrow(GzipGuardViolation);
  });

  it('기본 한도는 50MB다', () => {
    expect(DEFAULT_GZIP_GUARD_LIMITS.maxOutputBytes).toBe(50 * 1024 * 1024);
  });
});
