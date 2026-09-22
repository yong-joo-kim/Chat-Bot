import { apiClient } from './client';
import type { EmbeddingIndexStatus } from '@chat-bot/shared-types';

/** 1단계 색인 상태·재색인 API(FR-N1-22/23, `nlu-rag-answering-설계.md` §10.1). */
export const embeddingApi = {
  status: (chatbotId: string) => apiClient.get<EmbeddingIndexStatus>(`/chatbots/${chatbotId}/embeddings/status`),
  reindex: (chatbotId: string) => apiClient.post<void>(`/chatbots/${chatbotId}/embeddings/reindex`),
};
