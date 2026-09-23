import { apiClient, API_BASE_URL } from './client';
import type {
  BulkDisableTestCasesDto,
  CreateTestCaseDto,
  CreateTestCaseSetDto,
  ImportCommitRequestDto,
  ImportCommitResult,
  ImportValidateResult,
  Paginated,
  PinTestRunRequestDto,
  StartTestRunRequestDto,
  StartTestRunResponse,
  TestCase,
  TestCaseListQuery,
  TestCaseSet,
  TestCaseSetListQuery,
  TestRun,
  TestRunComparison,
  TestRunComparisonQuery,
  TestRunListQuery,
  TestRunResult,
  TestRunResultListQuery,
  UpdateTestCaseDto,
  UpdateTestCaseSetDto,
} from '@chat-bot/shared-types';

/**
 * 검증/품질 고도화(No.19/20) API 클라이언트. 실제 라우트는
 * `apps/api/src/validation/{test-sets,test-cases,test-runs}.controller.ts`(코드 확인)를 그대로 따른다
 * — `docs/02-spec/validation-regression-설계.md` §9 원문의 `.../cases/:caseId`는 실제로는
 * `.../test-sets/:setId/cases/:caseId`다(코드가 근거).
 */
function buildQuery(params: Record<string, unknown>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    qs.set(key, String(value));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

/* ------------------------------------------------------------------------------------------------
 * TC 세트
 * ---------------------------------------------------------------------------------------------- */
export const testSetsApi = {
  /**
   * ⚠ 백엔드에 `GET .../test-sets/:setId`(단건 조회) 핸들러가 없다(`test-sets.controller.ts` 코드 확인
   * — list/create/template/patch/delete 5개뿐). 세트당 최대 20개(§VALIDATION_LIMITS)이므로 상세 화면은
   * 이 `list()`를 pageSize=20으로 호출해 클라이언트에서 `setId`로 찾는 방식으로 우회한다(임시 처리 —
   * 완료 보고에 기재).
   */
  list: (chatbotId: string, query: Partial<TestCaseSetListQuery> = {}) =>
    apiClient.get<Paginated<TestCaseSet>>(`/chatbots/${chatbotId}/test-sets${buildQuery(query)}`),
  create: (chatbotId: string, dto: CreateTestCaseSetDto) =>
    apiClient.post<TestCaseSet>(`/chatbots/${chatbotId}/test-sets`, dto),
  update: (chatbotId: string, setId: string, dto: UpdateTestCaseSetDto) =>
    apiClient.patch<TestCaseSet>(`/chatbots/${chatbotId}/test-sets/${setId}`, dto),
  remove: (chatbotId: string, setId: string) => apiClient.delete<void>(`/chatbots/${chatbotId}/test-sets/${setId}`),
  templateUrl: (chatbotId: string, format: 'csv' | 'xlsx') =>
    `${API_BASE_URL}/chatbots/${chatbotId}/test-sets/template?format=${format}`,
};

/* ------------------------------------------------------------------------------------------------
 * TC — `.../test-sets/:setId/cases/*`
 * ---------------------------------------------------------------------------------------------- */
export const testCasesApi = {
  list: (chatbotId: string, setId: string, query: Partial<TestCaseListQuery> = {}) =>
    apiClient.get<Paginated<TestCase>>(`/chatbots/${chatbotId}/test-sets/${setId}/cases${buildQuery(query)}`),
  create: (chatbotId: string, setId: string, dto: CreateTestCaseDto) =>
    apiClient.post<TestCase>(`/chatbots/${chatbotId}/test-sets/${setId}/cases`, dto),
  update: (chatbotId: string, setId: string, caseId: string, dto: UpdateTestCaseDto) =>
    apiClient.patch<TestCase>(`/chatbots/${chatbotId}/test-sets/${setId}/cases/${caseId}`, dto),
  remove: (chatbotId: string, setId: string, caseId: string) =>
    apiClient.delete<void>(`/chatbots/${chatbotId}/test-sets/${setId}/cases/${caseId}`),
  bulkDisable: (chatbotId: string, setId: string, dto: BulkDisableTestCasesDto) =>
    apiClient.post<{ updated: number }>(`/chatbots/${chatbotId}/test-sets/${setId}/cases/bulk-disable`, dto),
  exportUrl: (chatbotId: string, setId: string) => `${API_BASE_URL}/chatbots/${chatbotId}/test-sets/${setId}/cases/export`,
};

/**
 * `BulkImportModal`(§4.2.2)이 기대하는 `{importValidate, importCommit, templateUrl}` 모양으로
 * 세트 ID를 클로저에 가둔 어댑터를 만든다 — TC 업로드는 세트 스코프가 필요한 유일한 소비자다.
 */
export function createTestCaseImportApi(setId: string) {
  return {
    importValidate: (chatbotId: string, formData: FormData) =>
      apiClient.postForm<ImportValidateResult>(`/chatbots/${chatbotId}/test-sets/${setId}/cases/import/validate`, formData),
    importCommit: (chatbotId: string, dto: ImportCommitRequestDto) =>
      apiClient.post<ImportCommitResult>(`/chatbots/${chatbotId}/test-sets/${setId}/cases/import/commit`, dto),
    templateUrl: (chatbotId: string, format: 'csv' | 'xlsx') => testSetsApi.templateUrl(chatbotId, format),
  };
}

/* ------------------------------------------------------------------------------------------------
 * 실행(TestRun)
 * ---------------------------------------------------------------------------------------------- */
export const testRunsApi = {
  start: (chatbotId: string, setId: string, dto: StartTestRunRequestDto) =>
    apiClient.post<StartTestRunResponse>(`/chatbots/${chatbotId}/test-sets/${setId}/runs`, dto),
  list: (chatbotId: string, query: Partial<TestRunListQuery> = {}) =>
    apiClient.get<Paginated<TestRun>>(`/chatbots/${chatbotId}/test-runs${buildQuery(query)}`),
  getOne: (chatbotId: string, runId: string) => apiClient.get<TestRun>(`/chatbots/${chatbotId}/test-runs/${runId}`),
  listResults: (chatbotId: string, runId: string, query: Partial<TestRunResultListQuery> = {}) =>
    apiClient.get<Paginated<TestRunResult>>(`/chatbots/${chatbotId}/test-runs/${runId}/results${buildQuery(query)}`),
  cancel: (chatbotId: string, runId: string) => apiClient.post<void>(`/chatbots/${chatbotId}/test-runs/${runId}/cancel`, undefined),
  pin: (chatbotId: string, runId: string, dto: PinTestRunRequestDto) =>
    apiClient.post<TestRun>(`/chatbots/${chatbotId}/test-runs/${runId}/pin`, dto),
  exportUrl: (chatbotId: string, runId: string) => `${API_BASE_URL}/chatbots/${chatbotId}/test-runs/${runId}/export`,
  compare: (chatbotId: string, query: TestRunComparisonQuery & { filter?: string }) =>
    apiClient.get<TestRunComparison>(`/chatbots/${chatbotId}/test-runs/compare${buildQuery(query)}`),
};
