import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { TrainingJob as PrismaTrainingJob } from '@prisma/client';
import type { TrainingJobKind, TrainingJobStatus } from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/api.exception';

const NOT_FOUND_MESSAGE = '요청하신 작업을 찾을 수 없습니다.';

type TerminalStatus = Extract<TrainingJobStatus, 'SUCCEEDED' | 'PARTIAL' | 'FAILED'>;

/**
 * `TrainingJob` 생성·전이·조회(ADR-0027 §4). ⚠ 이 서비스는 `IntentsService`·`KeywordsService`를
 * 알지 못한다(DD-96 L1 — `training-jobs`는 `IntentsModule`/`KeywordsModule`을 import하지 않는다).
 * 이 테이블은 관리자 화면의 비동기 작업 상태일 뿐이며, 대화 자산 반영과는 무관하다(ADR-0018 보론).
 */
@Injectable()
export class TrainingJobService implements OnModuleInit {
  private readonly logger = new Logger('TrainingJobService');

  constructor(private readonly prisma: PrismaService) {}

  /** 기동 시 고아 Job 정리(ADR-0027 §4) — 단일 인스턴스 전제이므로 QUEUED|RUNNING 잔존 행은
   * 전부 이전 프로세스가 죽으며 남긴 것이다. `FAILED`가 실제로 발생하는 경로 중 하나다(EX-L2-7). */
  async onModuleInit(): Promise<void> {
    const result = await this.prisma.trainingJob.updateMany({
      where: { status: { in: ['QUEUED', 'RUNNING'] } },
      data: { status: 'FAILED', failureReason: 'SERVER_RESTART', finishedAt: new Date() },
    });
    if (result.count > 0) {
      this.logger.warn(`기동 시 고아 작업 ${result.count}건을 FAILED(SERVER_RESTART)로 정리했습니다.`);
    }
  }

  async create(chatbotId: string, kind: TrainingJobKind, targetId?: string): Promise<PrismaTrainingJob> {
    return this.prisma.trainingJob.create({ data: { chatbotId, kind, targetId } });
  }

  /** 챗봇(+대상)당 동시 실행 1건 검사(FR-L1-17, FR-L2-22)의 근거 조회. 큐 자체는 동시성을 막지 않는다 —
   * 검사는 항상 호출부(augmentation/classifier 서비스)의 책임이다. */
  async findActive(chatbotId: string, kind: TrainingJobKind, targetId?: string): Promise<PrismaTrainingJob | null> {
    return this.prisma.trainingJob.findFirst({
      where: { chatbotId, kind, ...(targetId !== undefined ? { targetId } : {}), status: { in: ['QUEUED', 'RUNNING'] } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async markRunning(jobId: string): Promise<void> {
    await this.prisma.trainingJob.update({ where: { id: jobId }, data: { status: 'RUNNING', startedAt: new Date() } });
  }

  async updateProgress(jobId: string, progress: number): Promise<void> {
    await this.prisma.trainingJob
      .update({ where: { id: jobId }, data: { progress: Math.max(0, Math.min(100, Math.round(progress))) } })
      .catch(() => undefined); // 진행률 갱신 실패는 작업을 막지 않는다(관측용 부가 정보).
  }

  async markFinished(
    jobId: string,
    status: TerminalStatus,
    resultSummary?: Record<string, unknown>,
    failureReason?: string,
  ): Promise<void> {
    await this.prisma.trainingJob.update({
      where: { id: jobId },
      data: {
        status,
        progress: 100,
        finishedAt: new Date(),
        ...(resultSummary !== undefined ? { resultSummary: JSON.stringify(resultSummary) } : {}),
        ...(failureReason !== undefined ? { failureReason } : {}),
      },
    });
  }

  async getForChatbotOrThrow(chatbotId: string, id: string): Promise<PrismaTrainingJob> {
    const row = await this.prisma.trainingJob.findFirst({ where: { id, chatbotId } });
    if (!row) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);
    return row;
  }

  /** 최근 작업 1건(검증 요약 조회용 — `GET .../augmentations` 목록 응답의 `runResult`). */
  async findLatest(chatbotId: string, kind: TrainingJobKind, targetId?: string): Promise<PrismaTrainingJob | null> {
    return this.prisma.trainingJob.findFirst({
      where: { chatbotId, kind, ...(targetId !== undefined ? { targetId } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }
}
