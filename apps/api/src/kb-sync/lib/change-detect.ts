/**
 * [신규 No.43] 변경 감지 판정(순수 — §8.1 · J-9). 조건부 요청(304)은 호출부가 먼저 판정하고, 여기는
 * 본문을 받은 뒤(200)의 해시·지문 비교만 다룬다.
 */
export interface PrevDocumentState {
  contentHash?: string | null;
  ingestFingerprint?: string | null;
  textLength?: number | null;
  byteSize?: number | null;
  lastIngestedAt?: Date | null;
}

export interface ObservedContent {
  contentHash: string;
  ingestFingerprint: string;
  textLength?: number;
  byteSize?: number;
}

export interface ChangeDecision {
  change: 'NEW' | 'CHANGED' | 'UNCHANGED';
  shrunk: boolean;
}

/**
 * 축소 판정(순수 — §8.1 ⑤ · AC-KB3-5): 이전에 적재된 적이 있고 본문 길이(HTML) 또는 바이트 크기(파일)가 이전 값의 절반 미만이면
 * 축소다. 호출부는 종류에 맞는 쪽만 넘긴다(HTML은 `textLength`, 파일은 `byteSize` — 변환 문서의 바이트는 본문 축소와 무관하다).
 */
export function isShrunk(prev: PrevDocumentState, observed: { textLength?: number | null; byteSize?: number | null }): boolean {
  if (!prev.lastIngestedAt) return false;
  if (prev.textLength != null && observed.textLength != null && observed.textLength < prev.textLength * 0.5) return true;
  if (prev.byteSize != null && observed.byteSize != null && observed.byteSize < prev.byteSize * 0.5) return true;
  return false;
}

export function decideChange(prev: PrevDocumentState, observed: ObservedContent): ChangeDecision {
  if (!prev.contentHash) {
    return { change: 'NEW', shrunk: false };
  }
  const sameHash = prev.contentHash === observed.contentHash;
  const sameFingerprint = prev.ingestFingerprint === observed.ingestFingerprint;
  if (sameHash && sameFingerprint) {
    return { change: 'UNCHANGED', shrunk: false };
  }

  return { change: 'CHANGED', shrunk: isShrunk(prev, observed) };
}
