/**
 * 내려받은 파일(blob)을 브라우저 저장으로 넘긴다. 파일 이름은 서버 `Content-Disposition` 값을 쓴다.
 * click() 직후 URL을 해제하면 일부 브라우저에서 다운로드가 끊기므로 지연 해제하고, 링크는 DOM에 잠시 붙였다 뗀다.
 */
export const REVOKE_DELAY_MS = 10_000;

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}
