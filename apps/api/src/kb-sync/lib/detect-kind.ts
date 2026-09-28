/**
 * [신규 No.43 — pass 7] 문서 종류 판정(순수) — 크롤러와 적재기가 같은 규칙을 쓴다. 예전에는 크롤러 파일 안의 지역 함수였는데, 리다이렉트로 종류가 바뀌는 경우(N-6)를 적재 단계도
 * 같은 기준으로 판정해야 해서 옮겼다. 규칙은 그대로다: 확장자가 문서 파일(PDF·DOCX·XLSX·PPTX)이면 그 종류(소스 `fileTypes`가 비어 있지 않으면 목록 안일 때만), 확장자로 명백한
 * 비대상(이미지·압축·구형 문서 등)은 `null`, 그 밖은 `HTML`. 응답 `Content-Type` 판정은 아직 없다(§25.2 RG-11 잔여).
 */
export function detectKind(url: string, contentType: string | undefined, fileTypes: readonly string[]): string | null {
  const path = new URL(url).pathname.toLowerCase();
  if (path.endsWith('.pdf')) return fileTypes.length === 0 || fileTypes.includes('PDF') ? 'PDF' : null;
  if (path.endsWith('.docx')) return fileTypes.length === 0 || fileTypes.includes('DOCX') ? 'DOCX' : null;
  if (path.endsWith('.xlsx')) return fileTypes.length === 0 || fileTypes.includes('XLSX') ? 'XLSX' : null;
  if (path.endsWith('.pptx')) return fileTypes.length === 0 || fileTypes.includes('PPTX') ? 'PPTX' : null;
  if (/\.(jpg|jpeg|png|gif|svg|zip|hwp|hwpx|doc|xls|ppt|mp4|mp3|css|js)$/.test(path)) return null;
  void contentType;
  return 'HTML';
}

/** 이 URL의 확장자가 문서 파일(PDF·OOXML)인가 — 소스 `fileTypes` 필터와 무관하게 요청 크기·타임아웃을 정하는 데 쓴다(비대상 확장자는 HTML 기준으로 보수적으로). */
export function isFileUrl(url: string): boolean {
  const kind = detectKind(url, undefined, []);
  return kind !== null && kind !== 'HTML';
}
