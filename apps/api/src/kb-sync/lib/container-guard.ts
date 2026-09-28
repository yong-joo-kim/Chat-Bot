import { Unzip, UnzipInflate } from 'fflate';
import { pushInChunks } from './push-in-chunks';

/**
 * [신규 No.43] OOXML(zip) 컨테이너 안전 해제(§7.3 · KB-17). 중앙 디렉터리가 선언한 크기를 믿지 않고
 * **해제되는 바이트를 실시간으로 계수**하며, 상한을 넘는 순간 그 자리에서 중단한다(압축 폭탄 방어).
 * 경로에 `..`·절대경로·NUL이 있는 항목도 거부한다.
 */
export interface ContainerGuardLimits {
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
  maxCompressionRatio: number;
}

export const DEFAULT_CONTAINER_GUARD_LIMITS: ContainerGuardLimits = {
  maxEntries: 2000,
  maxEntryBytes: 50 * 1024 * 1024,
  maxTotalBytes: 100 * 1024 * 1024,
  maxCompressionRatio: 100,
};

export type ContainerGuardViolationCode = 'MAX_ENTRIES' | 'UNSAFE_PATH' | 'SIZE_EXCEEDED' | 'RATIO_EXCEEDED' | 'DECODE_ERROR';

export class ContainerGuardViolation extends Error {
  constructor(
    readonly code: ContainerGuardViolationCode,
    /** 위반을 잡을 때까지 실제로 해제한 총 바이트 — 중단이 즉시 이뤄졌는지 시험이 확인한다. */
    readonly decompressedBytes: number = 0,
  ) {
    super(`OOXML 컨테이너 안전 해제 위반: ${code}`);
  }
}

function concatUint8(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/** 성공 시 항목 이름 → 해제 바이트 맵. 한도 위반 시 `ContainerGuardViolation`을 던진다. */
export function safeUnzipEntries(data: Uint8Array, limits: ContainerGuardLimits = DEFAULT_CONTAINER_GUARD_LIMITS): Map<string, Uint8Array> {
  const entries = new Map<string, Uint8Array>();
  let entryCount = 0;
  let totalBytes = 0;
  let violated: ContainerGuardViolationCode | null = null;
  let produced = 0;

  const unzipper = new Unzip((file) => {
    if (violated) return;
    entryCount += 1;
    if (entryCount > limits.maxEntries) {
      violated = 'MAX_ENTRIES';
      return;
    }
    const name = file.name;
    if (name.includes('..') || name.startsWith('/') || name.includes('\0')) {
      violated = 'UNSAFE_PATH';
      return;
    }
    // [R1 리뷰 L-1 확인] fflate의 `UnzipFile.size`는 **압축된(zip 안의) 크기**이고
    // `originalSize`는 **원본(해제 후) 크기**다(fflate 타입 선언 기준 — 반대로 알기 쉬운 이름이라
    // 명시한다). 압축비 = 해제되며 실제로 센 바이트(`entryBytes`) ÷ 이 압축 크기 — "해제 결과가
    // 압축 크기의 몇 배로 부풀었는가"이며, 중앙 디렉터리가 선언한 값이 아니라 실측값을 분자로 써서
    // 선언 위조에 의존하지 않는다.
    const declaredCompressedSize = file.size ?? 0;
    const chunks: Uint8Array[] = [];
    let entryBytes = 0;
    file.ondata = (err, chunk, final) => {
      if (!err) produced += chunk.length;
      if (violated) return;
      if (err) {
        violated = 'DECODE_ERROR';
        return;
      }
      entryBytes += chunk.length;
      totalBytes += chunk.length;
      if (entryBytes > limits.maxEntryBytes || totalBytes > limits.maxTotalBytes) {
        violated = 'SIZE_EXCEEDED';
        return;
      }
      if (declaredCompressedSize > 0 && entryBytes / declaredCompressedSize > limits.maxCompressionRatio) {
        violated = 'RATIO_EXCEEDED';
        return;
      }
      chunks.push(chunk);
      if (final) entries.set(name, concatUint8(chunks));
    };
    file.start();
  });
  unzipper.register(UnzipInflate);
  // 입력을 작은 조각으로 밀어 넣고 조각마다 위반을 확인해 즉시 멈춘다(H-4) — 한 번에 밀면 남은 입력을 끝까지 해제한다.
  pushInChunks((chunk, final) => unzipper.push(chunk, final), data, () => violated !== null);

  if (violated) throw new ContainerGuardViolation(violated, produced);
  return entries;
}
