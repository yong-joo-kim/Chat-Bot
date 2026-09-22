import type { TrainingJob as PrismaTrainingJob } from '@prisma/client';
import type { TrainingJob, TrainingJobKind, TrainingJobStatus } from '@chat-bot/shared-types';

/** Prisma row → API DTO. `resultSummary`는 JSON 문자열이며 파싱 실패 시 조용히 생략한다(경고 로그 없이도
 * 안전한 이유 — 폴링 화면은 진행률/상태를 우선 신뢰하고 요약은 보조 정보다). */
export function toTrainingJobDto(row: PrismaTrainingJob): TrainingJob {
  let resultSummary: Record<string, unknown> | undefined;
  if (row.resultSummary) {
    try {
      const parsed = JSON.parse(row.resultSummary);
      if (parsed && typeof parsed === 'object') resultSummary = parsed as Record<string, unknown>;
    } catch {
      resultSummary = undefined;
    }
  }

  return {
    id: row.id,
    kind: row.kind as TrainingJobKind,
    targetId: row.targetId ?? undefined,
    status: row.status as TrainingJobStatus,
    progress: row.progress,
    resultSummary,
    failureReason: row.failureReason ?? undefined,
    startedAt: row.startedAt ?? undefined,
    finishedAt: row.finishedAt ?? undefined,
    createdAt: row.createdAt,
  };
}
