// 공개표 값의 경로 일반화(M-1) — 고객 전달판·result.json에 이 PC의 로컬 절대경로(사용자 폴더 이름 포함)를 싣지 않는다.

/** 드라이브 문자 · UNC · 슬래시 시작 · 슬래시를 포함한 공백 없는 경로형 값(URL `://`은 제외). */
export function isPathLike(v: string): boolean {
  const t = v.trim().replace(/^file:/i, '');
  if (/^[A-Za-z]:[\\/]/.test(t)) return true;
  if (t.startsWith('\\\\') || t.startsWith('/')) return true;
  if (/:\/\//.test(t)) return false;
  return /[\\/]/.test(t) && !/\s/.test(t);
}

/** 경로형이면 모델 이름 키(`*_MODEL_ID`)는 마지막 폴더 이름만, 그 밖은 '(내부 경로)'. 경로가 아니면 그대로. */
export function publicOverrideValue(key: string, value: string): string {
  if (!isPathLike(value)) return value;
  if (/MODEL_ID$/.test(key)) {
    const base = value.trim().replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '';
    if (/^[\w.\-]+$/.test(base)) return base;
  }
  return '(내부 경로)';
}
