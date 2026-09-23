import type { ImportRowError, TestCaseExpectedKind, TestCaseResultKind } from '@chat-bot/shared-types';
import { buildCsv } from '../../dialogue-common/import/lib/csv-writer';

/**
 * TC 임포트/내보내기·오류 행·실행 결과 CSV 조립(FR-V1-14/15, FR-V3-13). `buildCsv()`(UTF-8 BOM +
 * `escapeCsvCell` 재사용)를 그대로 쓴다 — 새 CSV 인코딩 규칙을 만들지 않는다.
 */
export const TEST_CASE_TEMPLATE_HEADERS = ['질문문장', '기대유형', '기대대상명', '비고'];

export const EXPECTED_KIND_TO_LABEL: Record<TestCaseExpectedKind, string> = {
  INTENT: '의도',
  FAQ: 'FAQ',
  NODE: '노드',
  FALLBACK: '폴백',
  ANY: '미지정',
};

export function buildTestCaseTemplateCsv(): string {
  return buildCsv(TEST_CASE_TEMPLATE_HEADERS, []);
}

export interface TestCaseExportRow {
  messages: string[];
  expectedKind: TestCaseExpectedKind;
  expectedTargetName?: string | null;
  expectedAnswerNote?: string | null;
}

/** 업로드와 **같은 컬럼 규격**이다(FR-V1-15) — 내보내기 → 수정 → 재업로드 왕복이 성립해야 한다. */
export function buildTestCaseExportCsv(rows: readonly TestCaseExportRow[]): string {
  const lines = rows.map((r) => [r.messages.join('|'), EXPECTED_KIND_TO_LABEL[r.expectedKind], r.expectedTargetName ?? '', r.expectedAnswerNote ?? '']);
  return buildCsv(TEST_CASE_TEMPLATE_HEADERS, lines);
}

export function buildImportErrorCsv(errors: readonly ImportRowError[]): string {
  const headers = ['행', '열', '값', '오류코드', '메시지'];
  const lines = errors.map((e) => [String(e.row), e.column, e.value, e.code, e.message]);
  return buildCsv(headers, lines);
}

export interface TestRunResultExportRow {
  seq: number;
  questionText: string;
  expectedKind: TestCaseExpectedKind;
  expectedTargetName: string | null;
  resultA: TestCaseResultKind;
  matchedNameA: string | null;
  bandA: string | null;
  top1ScoreA: number | null;
  outputsPreviewA: string | null;
}

export function buildTestRunResultCsv(rows: readonly TestRunResultExportRow[]): string {
  const headers = ['순번', '질문', '기대유형', '기대대상', '판정', '실제매칭', '구간', '점수', '응답미리보기'];
  const lines = rows.map((r) => [
    String(r.seq),
    r.questionText,
    EXPECTED_KIND_TO_LABEL[r.expectedKind],
    r.expectedTargetName ?? '',
    r.resultA,
    r.matchedNameA ?? '',
    r.bandA ?? '',
    r.top1ScoreA !== null ? String(r.top1ScoreA) : '',
    r.outputsPreviewA ?? '',
  ]);
  return buildCsv(headers, lines);
}
