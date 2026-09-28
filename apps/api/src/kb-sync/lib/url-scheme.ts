/**
 * [신규 No.43 — R1 리뷰 L-2] URL의 실제 스킴(http/https)을 돌려준다(순수) — robots.txt 요청이
 * 항상 https를 가정하지 않고 문서 URL의 실제 스킴을 따르게 하기 위해서다(http만 쓰는 사내 사이트
 * 지원). 파싱 실패(방어적) 시에만 https로 대체한다.
 */
export function httpOrHttpsScheme(url: string): 'http:' | 'https:' {
  try {
    return new URL(url).protocol === 'http:' ? 'http:' : 'https:';
  } catch {
    return 'https:';
  }
}
