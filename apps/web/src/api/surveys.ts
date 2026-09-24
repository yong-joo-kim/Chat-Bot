import { apiClient, API_BASE_URL, ApiError } from './client';
import type {
  CopySurveyDto,
  CreateSurveyDto,
  Paginated,
  Survey,
  SurveyDetail,
  SurveyExportKind,
  SurveyListItem,
  SurveyListQuery,
  SurveyQuestionStats,
  SurveyResponseListItem,
  SurveyResponseListQuery,
  SurveyStatsQuery,
  SurveyStatsSummary,
  SurveyTextAnswerItem,
  SurveyTextAnswerListQuery,
  UpdateSurveyDto,
} from '@chat-bot/shared-types';

/** 목록 공통 쿼리를 querystring으로 직렬화한다(배열은 콤마 구분). */
function buildQuery(params: Record<string, unknown>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      qs.set(key, value.join(','));
      continue;
    }
    qs.set(key, String(value));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

/** 설문 정의 CRUD(No.27, §13.1 ①~⑥) — `dialogue:read`(조회)/`dialogue:write`(쓰기). */
export const surveysApi = {
  list: (chatbotId: string, query: Partial<SurveyListQuery> = {}) =>
    apiClient.get<{ items: SurveyListItem[] }>(`/chatbots/${chatbotId}/surveys${buildQuery(query)}`),
  findOne: (chatbotId: string, surveyId: string) => apiClient.get<SurveyDetail>(`/chatbots/${chatbotId}/surveys/${surveyId}`),
  create: (chatbotId: string, dto: CreateSurveyDto) => apiClient.post<SurveyDetail>(`/chatbots/${chatbotId}/surveys`, dto),
  update: (chatbotId: string, surveyId: string, dto: UpdateSurveyDto) =>
    apiClient.patch<SurveyDetail>(`/chatbots/${chatbotId}/surveys/${surveyId}`, dto),
  copy: (chatbotId: string, surveyId: string, dto: CopySurveyDto = {}) =>
    apiClient.post<SurveyDetail>(`/chatbots/${chatbotId}/surveys/${surveyId}/copy`, dto),
  remove: (chatbotId: string, surveyId: string) => apiClient.delete<void>(`/chatbots/${chatbotId}/surveys/${surveyId}`),
};

/** 설문 결과 조회(No.27, §13.1 ⑦~⑪) — 읽기 전용, `chatbot:read`(VIEWER 포함 — 마스킹본만). */
export const surveyResultsApi = {
  summary: (chatbotId: string, surveyId: string, query: SurveyStatsQuery) =>
    apiClient.get<SurveyStatsSummary>(`/chatbots/${chatbotId}/surveys/${surveyId}/stats/summary${buildQuery(query)}`),
  questions: (chatbotId: string, surveyId: string, query: SurveyStatsQuery) =>
    apiClient.get<SurveyQuestionStats>(`/chatbots/${chatbotId}/surveys/${surveyId}/stats/questions${buildQuery(query)}`),
  responses: (chatbotId: string, surveyId: string, query: Partial<SurveyResponseListQuery>) =>
    apiClient.get<Paginated<SurveyResponseListItem>>(`/chatbots/${chatbotId}/surveys/${surveyId}/responses${buildQuery(query)}`),
  textAnswers: (chatbotId: string, surveyId: string, query: Partial<SurveyTextAnswerListQuery>) =>
    apiClient.get<Paginated<SurveyTextAnswerItem>>(`/chatbots/${chatbotId}/surveys/${surveyId}/text-answers${buildQuery(query)}`),
  /**
   * CSV 내보내기(§10, EX-SV-23) — `apiClient`(JSON 전용)를 쓰지 않고 직접 `fetch`한다.
   * `X-Export-Truncated`/`X-Export-Total` 헤더와 `filename*=`를 읽어야 하기 때문이다.
   */
  async exportCsv(
    chatbotId: string,
    surveyId: string,
    kind: SurveyExportKind,
    query: { from: string; to: string; channel?: string; includeDuplicates?: boolean },
  ): Promise<{ blob: Blob; filename: string; truncated: boolean; total?: number }> {
    const qs = buildQuery({ ...query, kind });
    const res = await fetch(`${API_BASE_URL}/chatbots/${chatbotId}/surveys/${surveyId}/responses/export${qs}`, {
      credentials: 'include',
    });
    if (!res.ok) {
      let message = `요청 실패: ${res.status} ${res.statusText}`;
      try {
        const body = (await res.json()) as { message?: string };
        if (body.message) message = body.message;
      } catch {
        // 본문이 JSON이 아니면 기본 문구를 쓴다.
      }
      throw new ApiError(res.status, message);
    }
    const disposition = res.headers.get('Content-Disposition') ?? '';
    const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
    const asciiMatch = /filename="([^"]+)"/.exec(disposition);
    const filename = utf8Match ? decodeURIComponent(utf8Match[1]) : (asciiMatch?.[1] ?? `survey-${kind.toLowerCase()}.csv`);
    const truncated = res.headers.get('X-Export-Truncated') === 'true';
    const totalHeader = res.headers.get('X-Export-Total');
    const blob = await res.blob();
    return { blob, filename, truncated, total: totalHeader ? Number(totalHeader) : undefined };
  },
};

export type { Survey };
