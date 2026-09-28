import { sha256Hex } from './content-fingerprint';

/**
 * [신규 No.43] 결정적 외부 파일 이름(순수 — §5.4 · FR-KB4-3 · KB-20). `kb_<소스 id 8>_<URL 해시
 * 16>.<ext>` — 같은 URL은 같은 이름 → 외부 덮어쓰기 = 갱신. 이 함수가 이름을 만드는 **유일한 곳**이다.
 */
export type ExternalFileExt = 'docx' | 'txt' | 'html' | 'pdf' | 'xlsx' | 'pptx';

const NAME_RE = /^kb_[0-9a-f]{8}_[0-9a-f]{16}\.(docx|txt|html|pdf|xlsx|pptx)$/;

export function urlHash(normalizedUrl: string): string {
  return sha256Hex(normalizedUrl);
}

export function buildExternalFileName(sourceId: string, normalizedUrl: string, ext: ExternalFileExt): string {
  const sourcePart = sourceId.replace(/-/g, '').slice(0, 8);
  const hashPart = urlHash(normalizedUrl).slice(0, 16);
  return `kb_${sourcePart}_${hashPart}.${ext}`;
}

export function isValidExternalFileName(name: string): boolean {
  return NAME_RE.test(name);
}
