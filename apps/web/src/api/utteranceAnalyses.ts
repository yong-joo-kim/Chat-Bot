import { ApiErrorSchema } from '@chat-bot/shared-types';
import type {
  AnalyzedUtterance,
  ClusterRenameRequest,
  Paginated,
  StartUtteranceAnalysisResponse,
  UtteranceAnalysisCapability,
  UtteranceAnalysisConditions,
  UtteranceAnalysisDetail,
  UtteranceAnalysisListItem,
  UtteranceApplyPreviewResponse,
  UtteranceApplyRequest,
  UtteranceApplyResponse,
  UtteranceCluster,
  UtterancePreviewResponse,
} from '@chat-bot/shared-types';
import { apiClient, API_BASE_URL, ApiError } from './client';

/** 발화 묶음 분석(No.21) — 13개 핸들러 전부(`deep-clustering-ui-spec.md` §8.1). 경로는 챗봇 스코프다. */
const base = (chatbotId: string): string => `/chatbots/${chatbotId}/utterance-analyses`;

/** 값이 없거나 빈 값은 건너뛰고, 배열은 콤마로 잇는다. 불리언은 `'true'` 문자열로만 보낸다(`queryBoolean` 규약). */
function buildQuery(params: Record<string, unknown>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || value === false) continue;
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

export interface DownloadedFile {
  blob: Blob;
  filename: string;
}

/** `Content-Disposition`의 파일 이름(`filename*=UTF-8''…` 우선, 없으면 `filename="…"`)을 읽는다. */
export function parseContentDispositionFilename(disposition: string | null, fallback: string): string {
  const header = disposition ?? '';
  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf8Match) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      // 잘못된 인코딩이면 아래 일반 형식으로 폴백한다.
    }
  }
  const asciiMatch = /filename="([^"]+)"/.exec(header);
  return asciiMatch?.[1] ?? fallback;
}

/**
 * 파일 응답 전용(`apiClient`는 JSON 전용이라 쓰지 않는다). 오류 본문은 `ApiErrorSchema`로 읽어 `code`를 살린다 —
 * 화면은 서버 메시지가 아니라 코드로 문구를 고른다.
 */
async function download(path: string, fallbackName: string): Promise<DownloadedFile> {
  const res = await fetch(`${API_BASE_URL}${path}`, { credentials: 'include' });
  if (!res.ok) {
    let message = `요청 실패: ${res.status} ${res.statusText}`;
    let code;
    let details;
    try {
      const parsed = ApiErrorSchema.safeParse(await res.json());
      if (parsed.success) {
        message = parsed.data.message;
        code = parsed.data.code;
        details = parsed.data.details;
      }
    } catch {
      // 본문이 JSON이 아니면 기본 문구를 쓴다.
    }
    throw new ApiError(res.status, message, code, details);
  }
  const blob = await res.blob();
  return { blob, filename: parseContentDispositionFilename(res.headers.get('Content-Disposition'), fallbackName) };
}

export interface UtteranceAnalysisListParams {
  page?: number;
  pageSize?: number;
  status?: string[];
}

export interface UtteranceListParams {
  clusterId?: string;
  candidateOnly?: boolean;
  unappliedOnly?: boolean;
  q?: string;
  page?: number;
  pageSize?: number;
}

export const utteranceAnalysesApi = {
  /** ① 양식 받기(`dialogue:read`). */
  downloadTemplate: (chatbotId: string, format: 'xlsx' | 'csv') =>
    download(`${base(chatbotId)}/template?format=${format}`, `utterance-template.${format}`),
  /** ② 기능 상태 — `404`는 "기능 꺼짐" 신호다(호출부가 `ApiError.status`로 분기). */
  capability: (chatbotId: string) => apiClient.get<UtteranceAnalysisCapability>(`${base(chatbotId)}/capability`),
  /** ③ 파일 검사(저장 없음, `dialogue:write`). */
  preview: (chatbotId: string, file: File, minClusterSize?: number) => {
    const form = new FormData();
    form.append('file', file);
    return apiClient.postForm<UtterancePreviewResponse>(`${base(chatbotId)}/preview${buildQuery({ minClusterSize })}`, form);
  },
  /** ④ 분석 요청(`202`). 조건은 `conditions` 필드에 JSON 문자열로 담는다. 파일은 메모리에만 있고 저장하지 않는다. */
  create: (chatbotId: string, file: File, conditions: UtteranceAnalysisConditions) => {
    const form = new FormData();
    form.append('file', file);
    form.append('conditions', JSON.stringify(conditions));
    return apiClient.postForm<StartUtteranceAnalysisResponse>(base(chatbotId), form);
  },
  /** ⑤ 목록. */
  list: (chatbotId: string, params: UtteranceAnalysisListParams = {}) =>
    apiClient.get<Paginated<UtteranceAnalysisListItem>>(`${base(chatbotId)}${buildQuery({ ...params })}`),
  /** ⑥ 상세(처리 중이면 `clusters=[]`). */
  get: (chatbotId: string, analysisId: string) => apiClient.get<UtteranceAnalysisDetail>(`${base(chatbotId)}/${analysisId}`),
  /** ⑦ 발화 목록(마스킹본). */
  listUtterances: (chatbotId: string, analysisId: string, params: UtteranceListParams = {}) =>
    apiClient.get<Paginated<AnalyzedUtterance>>(`${base(chatbotId)}/${analysisId}/utterances${buildQuery({ ...params })}`),
  /** ⑧ 묶음 이름 수정(`customName=null`이면 자동 이름 복귀). */
  renameCluster: (chatbotId: string, analysisId: string, clusterId: string, dto: ClusterRenameRequest) =>
    apiClient.patch<UtteranceCluster>(`${base(chatbotId)}/${analysisId}/clusters/${clusterId}`, dto),
  /** ⑨ 엑셀 받기(감사 기록 대상). */
  exportXlsx: (chatbotId: string, analysisId: string) =>
    download(`${base(chatbotId)}/${analysisId}/export`, `utterance-analysis-${analysisId.slice(0, 8)}.xlsx`),
  /** ⑩ 예문 넣기 미리보기(DB 변경 없음). */
  previewApply: (chatbotId: string, analysisId: string, dto: UtteranceApplyRequest) =>
    apiClient.post<UtteranceApplyPreviewResponse>(`${base(chatbotId)}/${analysisId}/apply/preview`, dto),
  /** ⑪ 예문 넣기(자산 쓰기의 유일한 경로). */
  apply: (chatbotId: string, analysisId: string, dto: UtteranceApplyRequest) =>
    apiClient.post<UtteranceApplyResponse>(`${base(chatbotId)}/${analysisId}/apply`, dto),
  /** ⑫ 분석 취소(`204`). */
  cancel: (chatbotId: string, analysisId: string) => apiClient.post<void>(`${base(chatbotId)}/${analysisId}/cancel`),
  /** ⑬ 분석 삭제(`204`, 종결 상태만). */
  remove: (chatbotId: string, analysisId: string) => apiClient.delete<void>(`${base(chatbotId)}/${analysisId}`),
};
