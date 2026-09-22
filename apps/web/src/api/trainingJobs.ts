import { apiClient } from './client';
import type { TrainingJob } from '@chat-bot/shared-types';

/**
 * 증강 생성(`AUGMENT`)·분류기 재학습(`CLASSIFIER_TRAIN`) 공용 폴링 대상(learning-augmentation-설계.md
 * §15.1 #10). 교차 챗봇 조회는 404 — 항상 현재 챗봇 컨텍스트의 `chatbotId`로만 조회한다.
 */
export const trainingJobsApi = {
  get: (chatbotId: string, jobId: string) => apiClient.get<TrainingJob>(`/chatbots/${chatbotId}/training-jobs/${jobId}`),
};
