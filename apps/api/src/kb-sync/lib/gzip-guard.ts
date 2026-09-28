import { Gunzip } from 'fflate';
import { pushInChunks } from './push-in-chunks';

/**
 * [신규 No.43 — 항목③ · §6.6 · KB-17] `.xml.gz` 사이트맵 압축 해제(안전) — `container-guard.ts`와
 * 같은 원칙: 압축 헤더가 아니라 **실제로 해제되는 바이트를 실시간으로 계수**하며, 상한을 넘는 순간
 * 그 자리에서 중단한다(압축 폭탄 방어 — 51MB급 gzip bomb 차단).
 */
export interface GzipGuardLimits {
  maxOutputBytes: number;
}

export const DEFAULT_GZIP_GUARD_LIMITS: GzipGuardLimits = {
  maxOutputBytes: 50 * 1024 * 1024,
};

export type GzipGuardViolationCode = 'SIZE_EXCEEDED' | 'DECODE_ERROR';

export class GzipGuardViolation extends Error {
  constructor(
    readonly code: GzipGuardViolationCode,
    /** 위반을 잡을 때까지 실제로 해제한 총 바이트 — 중단이 즉시 이뤄졌는지 시험이 확인한다. */
    readonly decompressedBytes: number = 0,
  ) {
    super(`사이트맵 gzip 안전 해제 위반: ${code}`);
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

/** 성공 시 해제된 전체 바이트. 한도 위반·디코딩 실패 시 `GzipGuardViolation`을 던진다. */
export function safeGunzip(data: Uint8Array, limits: GzipGuardLimits = DEFAULT_GZIP_GUARD_LIMITS): Uint8Array {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let violated: GzipGuardViolationCode | null = null;

  /** 상한을 넘은 뒤에 해제기가 더 만들어 낸 것까지 센 실제 해제량 — 위반 객체로 알려 시험이 즉시 중단을 확인한다. */
  let produced = 0;
  const gunzip = new Gunzip((chunk) => {
    produced += chunk.length;
    if (violated) return;
    totalBytes += chunk.length;
    if (totalBytes > limits.maxOutputBytes) {
      violated = 'SIZE_EXCEEDED';
      return;
    }
    chunks.push(chunk);
  });

  try {
    // 입력을 작은 조각으로 밀어 넣고 조각마다 위반을 확인해 즉시 멈춘다(H-4) — 한 번에 밀면 남은 입력을 끝까지 해제한다.
    pushInChunks((chunk, final) => gunzip.push(chunk, final), data, () => violated !== null);
  } catch {
    if (!violated) violated = 'DECODE_ERROR';
  }

  if (violated) throw new GzipGuardViolation(violated, produced);
  return concatUint8(chunks);
}

/** gzip 매직 바이트(1F 8B)로 판정한다 — 확장자(`.xml.gz`)에 의존하지 않는다(서버가 확장자를 안 붙이는 경우 대비). */
export function looksLikeGzip(data: Uint8Array): boolean {
  return data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b;
}
