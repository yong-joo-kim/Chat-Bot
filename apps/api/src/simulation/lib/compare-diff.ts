/**
 * [승격 2026-09-23 검증/품질 고도화] 이 파일의 실제 구현은 `apps/api/src/common/lib/output-diff.ts`로
 * 옮겨졌다 — 검증 모듈의 실행기도 같은 판정이 필요해져 소비자가 2곳이 됐기 때문이다(§8, FR-0-62).
 * 이 파일은 기존 소비자(시뮬레이션 컨트롤러·테스트)의 import 경로를 그대로 보존하기 위한
 * re-export만 남긴다 — 동작 변경 0건.
 */
export { serializeOutputsForDiff, compareDiff } from '../../common/lib/output-diff';
export type { DiffableTurn } from '../../common/lib/output-diff';
