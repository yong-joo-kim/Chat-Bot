import { zipSync } from 'fflate';
import { ContainerGuardViolation, DEFAULT_CONTAINER_GUARD_LIMITS, safeUnzipEntries } from './container-guard';

/**
 * [R1 리뷰 L-1] fflate의 `UnzipFile.size`는 **압축된(zip 안에 든) 크기**이고, `originalSize`는
 * **원본(해제 후) 크기**다(fflate 타입 선언 참고). `container-guard.ts`의 `declaredCompressedSize
 * = file.size`는 이미 이 의미와 맞게 쓰였고, 압축비 = `entryBytes(해제되며 실시간으로 센 바이트) /
 * declaredCompressedSize`(해제 결과가 압축 크기의 몇 배인가)도 올바르다 — 그런데 기존
 * `container-guard.spec.ts`의 "압축 폭탄" 시험은 `maxEntryBytes`·`maxTotalBytes`(절대 크기 상한)만
 * 낮춰서 막았을 뿐, **압축비 상한(`RATIO_EXCEEDED`) 갈래 자체**는 한 번도 단독으로 타 본 적이 없었다
 * — 이 파일이 그 계산식을 절대 크기 상한과 분리해 전용으로 검증한다.
 */
describe('safeUnzipEntries — 압축비(RATIO_EXCEEDED) 계산 전용 시험(L-1)', () => {
  it('★ 절대 크기 상한은 넉넉히 주고 압축비 상한만으로 압축 폭탄을 잡는다', () => {
    const zeros = new Uint8Array(5 * 1024 * 1024); // 매우 잘 압축되는 5MB(반복 바이트).
    const data = zipSync({ 'bomb.bin': zeros }, { level: 9 });

    // 절대 크기 상한은 1GB로 넉넉히 줘서 SIZE_EXCEEDED가 절대 먼저 걸리지 않게 한다 — 이 시험이
    // 실제로 압축비 계산만으로 차단하는지 확인하기 위해서다.
    const generousSizeLimits = { ...DEFAULT_CONTAINER_GUARD_LIMITS, maxEntryBytes: 1024 ** 3, maxTotalBytes: 1024 ** 3 };
    expect(() => safeUnzipEntries(data, generousSizeLimits)).toThrow(ContainerGuardViolation);
    try {
      safeUnzipEntries(data, generousSizeLimits);
      fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ContainerGuardViolation);
      expect((e as ContainerGuardViolation).code).toBe('RATIO_EXCEEDED');
    }
  });

  it('압축비가 낮으면(정상 문서류) 같은 상한에서 통과한다 — 오탐 방지', () => {
    // 이미 압축돼 있거나 무작위에 가까운 내용은 압축비가 낮다(1~수 배 수준) — 정상 문서를 오탐하지 않아야 한다.
    const randomish = new Uint8Array(200 * 1024);
    for (let i = 0; i < randomish.length; i += 1) randomish[i] = (i * 2654435761) % 256; // 결정적 의사난수(테스트 재현성).
    const data = zipSync({ 'word/document.xml': randomish }, { level: 0 }); // level 0 = 저장만(압축 안 함) → 압축비 ≈ 1.

    const entries = safeUnzipEntries(data, DEFAULT_CONTAINER_GUARD_LIMITS);
    expect(entries.get('word/document.xml')?.length).toBe(randomish.length);
  });

  it('압축비 상한을 압축 폭탄의 실제 배율보다 넉넉히 잡으면(방어 안 함) 통과한다 — 임계값 자체가 배율로 작동함을 보여준다', () => {
    const zeros = new Uint8Array(2 * 1024 * 1024);
    const data = zipSync({ 'bomb2.bin': zeros }, { level: 9 });
    // 실제 압축비를 넉넉히 넘는 매우 높은 상한(100만 배)을 주면 더 이상 압축비로는 막히지 않는다.
    const permissive = { ...DEFAULT_CONTAINER_GUARD_LIMITS, maxEntryBytes: 1024 ** 3, maxTotalBytes: 1024 ** 3, maxCompressionRatio: 1_000_000 };
    const entries = safeUnzipEntries(data, permissive);
    expect(entries.get('bomb2.bin')?.length).toBe(zeros.length);
  });
});
