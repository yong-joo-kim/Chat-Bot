import { createHash } from 'node:crypto';

/** [신규 No.43] 해시 유틸(순수 — §8.1). sha256 hex. */
export function sha256Hex(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

/** 변환 규칙 버전 — 바뀌면 기존 지문이 전부 무효화(재적재)된다(R-25). */
export const CONVERSION_RULES_VERSION = 1;

export function computeIngestFingerprint(params: {
  contentHash: string;
  format: string;
  piiMask: boolean;
  piiMaskMode: string;
}): string {
  return sha256Hex(`${params.contentHash}|${CONVERSION_RULES_VERSION}|${params.format}|${params.piiMask}|${params.piiMaskMode}`);
}
