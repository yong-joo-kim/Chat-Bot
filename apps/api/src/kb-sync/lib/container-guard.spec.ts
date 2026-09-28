import { zipSync } from 'fflate';
import { safeUnzipEntries, ContainerGuardViolation, DEFAULT_CONTAINER_GUARD_LIMITS } from './container-guard';

describe('safeUnzipEntries', () => {
  it('정상 zip은 항목을 그대로 돌려준다', () => {
    const data = zipSync({ 'word/document.xml': new TextEncoder().encode('<w:document/>') });
    const entries = safeUnzipEntries(data);
    expect(new TextDecoder().decode(entries.get('word/document.xml'))).toBe('<w:document/>');
  });

  it('압축 폭탄(고압축비 대용량 항목)을 해제 도중 차단한다', () => {
    const zeros = new Uint8Array(20 * 1024 * 1024); // 20MB의 반복 바이트 — 매우 높은 압축비
    const data = zipSync({ 'bomb.bin': zeros }, { level: 9 });
    expect(() => safeUnzipEntries(data, { ...DEFAULT_CONTAINER_GUARD_LIMITS, maxEntryBytes: 1024 * 1024, maxTotalBytes: 1024 * 1024 })).toThrow(ContainerGuardViolation);
  });

  it('경로에 ..이 있는 항목은 거부한다', () => {
    const data = zipSync({ '../../etc/passwd': new TextEncoder().encode('x') });
    expect(() => safeUnzipEntries(data)).toThrow(ContainerGuardViolation);
  });

  it('항목 수 상한을 넘으면 거부한다', () => {
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < 5; i += 1) files[`f${i}.txt`] = new TextEncoder().encode('x');
    const data = zipSync(files);
    expect(() => safeUnzipEntries(data, { ...DEFAULT_CONTAINER_GUARD_LIMITS, maxEntries: 3 })).toThrow(ContainerGuardViolation);
  });
});
