/**
 * [신규 No.32 · DD-135] 운영 환경 판별의 **유일한 정의**(voice-ai-설계.md §2.6 · 봉인 VO-17 ③).
 *
 * 저장소에는 지금까지 운영 판별 기준이 없었다(C-17). 이 기능이 Node 관례 `NODE_ENV=production`을 처음 읽는다 —
 * 앞뒤 공백을 제거한 값이 정확히 `production`(대소문자 구분)일 때만 운영이다. `NODE_ENV` 값을 읽는 파일은 이 파일 1개뿐이어야 한다
 * (정적 검사 VO-17 ③). 판별 기준을 프로젝트 공통으로 바꾸면(재검토 트리거 §22) 이 함수 1곳만 교체한다.
 */
export function isProductionRuntime(env: Record<string, unknown>): boolean {
  return String(env.NODE_ENV ?? '').trim() === 'production';
}
