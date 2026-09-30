/**
 * 업로드 파일 형식 판별(No.21 — 설계서 §7.1, NFR-DCS3 · AC-DC2-4). **확장자가 아니라 내용**으로 판별한다:
 *  - `.xlsx`는 ZIP 로컬 헤더 서명 `50 4B 03 04`로 시작해야 한다(확장자만 바꾼 텍스트 파일은 거부).
 *  - `.csv`는 NUL 바이트가 없고 UTF-8로 디코딩했을 때 치환문자(U+FFFD)가 5% 이하여야 한다(ZIP·이진 파일은 거부).
 * DB·Nest 무의존 순수 함수.
 */

export type UploadFileKind = 'XLSX' | 'CSV';

const ZIP_LOCAL_HEADER = [0x50, 0x4b, 0x03, 0x04];
const REPLACEMENT_RATIO_LIMIT = 0.05;

export function hasZipSignature(buffer: Buffer): boolean {
  if (buffer.length < ZIP_LOCAL_HEADER.length) return false;
  return ZIP_LOCAL_HEADER.every((b, i) => buffer[i] === b);
}

/** CSV로 볼 수 있는 텍스트인가 — NUL 없음 + UTF-8 디코딩 이상(치환문자 5% 초과) 없음. */
export function looksLikeUtf8Text(buffer: Buffer): boolean {
  if (buffer.includes(0)) return false;
  const text = buffer.toString('utf-8');
  if (text.length === 0) return true;
  let bad = 0;
  for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 0xfffd) bad += 1;
  return bad / text.length <= REPLACEMENT_RATIO_LIMIT;
}

/**
 * 선언된 확장자와 내용이 일치하면 형식을, 아니면 `null`을 돌려준다(호출부가 `400 IMPORT_FILE_INVALID`로 변환).
 * 확장자가 `.xlsx`·`.csv`가 아니어도 `null`이다.
 */
export function sniffUploadKind(fileName: string, buffer: Buffer): UploadFileKind | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.xlsx')) return hasZipSignature(buffer) ? 'XLSX' : null;
  if (lower.endsWith('.csv')) return !hasZipSignature(buffer) && looksLikeUtf8Text(buffer) ? 'CSV' : null;
  return null;
}

export type UploadInspection = { readonly kind: UploadFileKind } | { readonly invalid: 'UNSUPPORTED' | 'ENCODING' };

/**
 * `sniffUploadKind`의 상세판 — 거부 사유를 구분한다. `.csv`인데 ZIP·NUL이 없고 UTF-8 디코딩만 이상하면(CP949/EUC-KR 등)
 * `ENCODING`으로 돌려 "UTF-8로 저장한 뒤 다시 올려 주세요" 안내가 나가게 한다(M-2). 그 밖의 불일치는 `UNSUPPORTED`.
 */
export function inspectUpload(fileName: string, buffer: Buffer): UploadInspection {
  const kind = sniffUploadKind(fileName, buffer);
  if (kind) return { kind };
  if (fileName.toLowerCase().endsWith('.csv') && !hasZipSignature(buffer) && !buffer.includes(0) && !looksLikeUtf8Text(buffer)) {
    return { invalid: 'ENCODING' };
  }
  return { invalid: 'UNSUPPORTED' };
}
