import { randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { zipSync } from 'fflate';
import { ContainerGuardViolation, DEFAULT_CONTAINER_GUARD_LIMITS, safeUnzipEntries } from './container-guard';
import { GzipGuardViolation, safeGunzip } from './gzip-guard';

/**
 * [pass 6 · H-4] 압축 폭탄 방어는 "한도 초과가 거부된다"뿐 아니라 **초과한 자리에서 실제로 해제를 멈춰야** 한다.
 * fflate의 `Gunzip.push`/`Unzip.push`는 한 번 받은 입력을 끝까지 해제하므로(실측: 300KB gzip → 300MB 해제 · RSS +600MB,
 * 2MB → 2GB면 4GB 이상) 입력을 작은 조각으로 나눠 밀어 넣고 조각마다 위반을 확인해야 한다. 아래 시험은 위반이 잡힌 시점까지
 * 실제로 해제한 바이트(`decompressedBytes`)가 "한도 + 조각 하나가 만들 수 있는 최대 출력(≈ 조각 × 1032배)" 수준인지 본다.
 */
const MB = 1024 * 1024;
/** 조각 4KB × deflate 최대 배율 ~1032 ≈ 4.2MB — 여유를 두어 8MB. */
const ONE_CHUNK_SLACK = 8 * MB;

function zeroGzip(sizeBytes: number): Buffer {
  return gzipSync(Buffer.alloc(sizeBytes, 0), { level: 9 });
}

describe('H-4 — gzip(사이트맵) 폭탄은 한도를 넘는 자리에서 해제를 멈춘다', () => {
  it('★ 300MB로 풀리는 단일 멤버 gzip(≈300KB) — 해제한 총량이 한도(50MB) + 한 조각 수준을 넘지 않는다', () => {
    const gz = zeroGzip(300 * MB);
    expect(gz.length).toBeLessThan(2 * MB);
    const started = Date.now();
    let violation: GzipGuardViolation | null = null;
    try {
      safeGunzip(new Uint8Array(gz));
    } catch (e) {
      violation = e as GzipGuardViolation;
    }
    expect(violation).toBeInstanceOf(GzipGuardViolation);
    expect(violation?.code).toBe('SIZE_EXCEEDED');
    expect(violation?.decompressedBytes).toBeGreaterThan(50 * MB);
    expect(violation?.decompressedBytes).toBeLessThanOrEqual(50 * MB + ONE_CHUNK_SLACK);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('★ 2MB 입력이 2GB로 풀리는 다중 멤버 gzip — 한도 + 한 조각에서 멈춘다(끝까지 풀지 않는다)', () => {
    const member = zeroGzip(10 * MB); // 10MB → 약 10KB
    const members: Buffer[] = [];
    for (let i = 0; i < 200; i += 1) members.push(member); // 200 × 10MB = 2GB
    const gz = Buffer.concat(members);
    expect(gz.length).toBeLessThan(3 * MB);
    let violation: GzipGuardViolation | null = null;
    try {
      safeGunzip(new Uint8Array(gz));
    } catch (e) {
      violation = e as GzipGuardViolation;
    }
    expect(violation?.code).toBe('SIZE_EXCEEDED');
    // 2GB 전체를 풀었다면 이 값이 2,000MB 부근이다.
    expect(violation?.decompressedBytes).toBeLessThanOrEqual(50 * MB + ONE_CHUNK_SLACK);
  });

  it('한도를 낮춰도(10MB) 같은 규칙이 적용된다', () => {
    const gz = zeroGzip(100 * MB);
    let violation: GzipGuardViolation | null = null;
    try {
      safeGunzip(new Uint8Array(gz), { maxOutputBytes: 10 * MB });
    } catch (e) {
      violation = e as GzipGuardViolation;
    }
    expect(violation?.decompressedBytes).toBeLessThanOrEqual(10 * MB + ONE_CHUNK_SLACK);
  });

  it('정상 크기 gzip은 조각으로 나눠 풀어도 원문과 정확히 같다(경계 오탐 없음)', () => {
    const text = Buffer.from('<urlset>' + '<url><loc>https://a.example/가나다</loc></url>'.repeat(5000) + '</urlset>', 'utf8');
    const out = safeGunzip(new Uint8Array(gzipSync(text)));
    expect(Buffer.from(out).equals(text)).toBe(true);
  });
});

describe('H-4 — OOXML 컨테이너(zip) 폭탄도 한도를 넘는 자리에서 해제를 멈춘다(RG-8 사전 검사 경로)', () => {
  it('★ 120MB 항목 1개(≈120KB) — 항목 상한(50MB) + 한 조각 수준에서 멈춘다', () => {
    const zeros = new Uint8Array(120 * MB);
    const data = zipSync({ 'word/document.xml': zeros }, { level: 6 });
    expect(data.length).toBeLessThan(2 * MB);
    let violation: ContainerGuardViolation | null = null;
    try {
      safeUnzipEntries(data, { ...DEFAULT_CONTAINER_GUARD_LIMITS, maxCompressionRatio: 1_000_000 }); // 압축비 검사가 먼저 걸리지 않게 — 크기 상한만으로 멈추는지 본다.
    } catch (e) {
      violation = e as ContainerGuardViolation;
    }
    expect(violation).toBeInstanceOf(ContainerGuardViolation);
    expect(violation?.code).toBe('SIZE_EXCEEDED');
    expect(violation?.decompressedBytes).toBeLessThanOrEqual(50 * MB + ONE_CHUNK_SLACK); // 항목 상한(50MB)이 먼저 걸린다.
  });

  it('★ 압축비 위반도 한 조각 안에서 멈춘다(작은 한도)', () => {
    const zeros = new Uint8Array(100 * MB);
    const data = zipSync({ 'bomb.bin': zeros }, { level: 6 });
    let violation: ContainerGuardViolation | null = null;
    try {
      safeUnzipEntries(data, { ...DEFAULT_CONTAINER_GUARD_LIMITS, maxEntryBytes: 1024 ** 3, maxTotalBytes: 1024 ** 3 });
    } catch (e) {
      violation = e as ContainerGuardViolation;
    }
    expect(violation?.code).toBe('RATIO_EXCEEDED');
    // 압축비 100:1 × 압축 크기(약 100KB) = 10MB 부근에서 잡혀야 한다 — 100MB 전체를 풀지 않는다.
    expect(violation?.decompressedBytes).toBeLessThanOrEqual(data.length * 100 + ONE_CHUNK_SLACK);
  });

  it('정상 zip은 조각으로 나눠 풀어도 항목 내용이 같다(항목이 조각 경계에 걸려도)', () => {
    const big = new Uint8Array(randomBytes(300 * 1024)); // 압축이 거의 안 되는 내용 — 항목이 여러 조각에 걸친다.
    const data = zipSync({ 'a.bin': big, 'b.txt': new TextEncoder().encode('안녕'), 'word/document.xml': new TextEncoder().encode('<w:document/>') }, { level: 6 });
    const entries = safeUnzipEntries(data);
    expect(Buffer.from(entries.get('a.bin')!).equals(Buffer.from(big))).toBe(true);
    expect(new TextDecoder().decode(entries.get('b.txt'))).toBe('안녕');
    expect(entries.size).toBe(3);
  });
});
