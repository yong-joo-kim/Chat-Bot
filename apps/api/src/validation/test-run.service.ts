import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  Paginated,
  PinTestRunRequestDto,
  StartTestRunRequestDto,
  StartTestRunResponse,
  TestRun,
  TestRunListQuery,
  TestRunResult,
  TestRunResultListQuery,
} from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/api.exception';
import { toPaginated } from '../common/pagination';
import { ChatbotScopeService } from '../chatbots/chatbot-scope.service';
import { TrainingJobQueue } from '../training-jobs/training-job.queue';
import { assertOverlaySize } from '../simulation/lib/overlay-convert';
import { TestSetService } from './test-set.service';
import { TargetNameResolverService } from './target-name-resolver.service';
import type { TargetRef } from './target-name-resolver.service';
import { TestRunExecutor } from './run/test-run.executor';
import { TestRunStatusSink } from './run/test-run-status.sink';
import { TestRunCancelRegistry } from './run/test-run-cancel.registry';
import { toTestRunDto, toTestRunResultDto } from './test-run.mapper';
import { buildTestRunResultCsv } from './lib/test-case-csv';

const NOT_FOUND_MESSAGE = '요청하신 실행을 찾을 수 없습니다.';

/**
 * 실행 수명주기 + `TestRun` 상태 소유(ADR-0029 §4). `TrainingJobQueue`(kind-agnostic)를 재사용하되
 * 상태 기록은 `TestRunStatusSink`로 분리한다 — 기존 호출부(augmentation·classifier)는 변경 0건이다.
 */
@Injectable()
export class TestRunService implements OnModuleInit {
  private readonly logger = new Logger('TestRunService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ChatbotScopeService,
    private readonly setService: TestSetService,
    private readonly queue: TrainingJobQueue,
    private readonly statusSink: TestRunStatusSink,
    private readonly executor: TestRunExecutor,
    private readonly cancelRegistry: TestRunCancelRegistry,
    private readonly nameResolver: TargetNameResolverService,
    private readonly config: ConfigService,
  ) {}

  /** 기동 시 고아 실행 정리(ADR-0029 §4, `TrainingJobService`의 고아 Job 정리와 같은 규약·시점). */
  async onModuleInit(): Promise<void> {
    const result = await this.prisma.testRun.updateMany({
      where: { status: { in: ['QUEUED', 'RUNNING'] } },
      data: { status: 'FAILED', failureReason: 'SERVER_RESTART', finishedAt: new Date() },
    });
    if (result.count > 0) {
      this.logger.warn(`기동 시 고아 실행 ${result.count}건을 FAILED(SERVER_RESTART)로 정리했습니다.`);
    }
  }

  /** Prisma P2002(유니크 제약 위반) 판별 — `@prisma/client`의 에러 클래스를 import하지 않고 덕 타이핑한다(learning/unanswered-collector.service.ts와 동일 관례, 단위 테스트에서 평범한 객체로 재현 가능). */
  private isUniqueConstraintViolation(e: unknown): boolean {
    return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
  }

  private async getRowOrThrow(chatbotId: string, runId: string) {
    const row = await this.prisma.testRun.findFirst({ where: { id: runId, chatbotId } });
    if (!row) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);
    return row;
  }

  async start(chatbotId: string, setId: string, dto: StartTestRunRequestDto): Promise<StartTestRunResponse> {
    await this.scope.assertWritable(chatbotId);
    await this.setService.getRowOrThrow(chatbotId, setId);

    const inProgress = await this.prisma.testRun.findFirst({ where: { chatbotId, status: { in: ['QUEUED', 'RUNNING'] } } });
    if (inProgress) {
      throw new ApiException('TEST_RUN_IN_PROGRESS', 409, '이미 진행 중인 실행이 있습니다. 완료 후 다시 시도해 주세요.');
    }

    const runnableCount = await this.prisma.testCase.count({ where: { setId, enabled: true } });
    if (runnableCount === 0) {
      throw new ApiException('TEST_SET_EMPTY', 400, '실행할 수 있는 TC가 없습니다. TC를 추가하거나 비활성화를 해제해 주세요.');
    }

    if (dto.overlaySource === 'INLINE') assertOverlaySize(dto.overlay);

    const mode = dto.overlaySource === 'NONE' ? 'SINGLE' : 'OVERLAY_COMPARE';
    let created: { id: string };
    try {
      created = await this.prisma.testRun.create({
        data: {
          chatbotId,
          setId,
          mode,
          overlaySource: dto.overlaySource,
          status: 'QUEUED',
          totalCount: runnableCount,
          useRag: dto.useRag,
        },
      });
    } catch (e) {
      // 위 findFirst 사전 검사는 일반적인 경우를 빠르게 걸러내는 용도일 뿐, 두 요청이 거의 동시에
      // 들어오면 둘 다 통과할 수 있다(TOCTOU) — DB의 부분 유니크 인덱스(챗봇당 QUEUED|RUNNING 최대
      // 1건, schema.prisma의 test_runs 하단 주석 참고)가 최종 방어선이다. 위반 시 P2002를 409로 변환한다.
      if (this.isUniqueConstraintViolation(e)) {
        throw new ApiException('TEST_RUN_IN_PROGRESS', 409, '이미 진행 중인 실행이 있습니다. 완료 후 다시 시도해 주세요.');
      }
      throw e;
    }
    this.cancelRegistry.clear(created.id);

    this.queue.enqueue(
      created.id,
      () =>
        this.executor.execute({
          chatbotId,
          runId: created.id,
          setId,
          mode,
          overlaySource: dto.overlaySource,
          overlay: dto.overlay,
          suggestionIds: dto.suggestionIds,
          useRag: dto.useRag,
        }),
      this.statusSink,
    );

    await this.retentionCleanup(setId);

    return { runId: created.id, status: 'QUEUED' };
  }

  /** 보존 정책(세트당 최근 20건 + pin 5건) — 새 실행 생성 직후 적용한다(스케줄러 부재, §7.2). */
  private async retentionCleanup(setId: string): Promise<void> {
    const retention = this.config.get<number>('TEST_RUN_RETENTION_PER_SET') ?? 20;
    const keep = await this.prisma.testRun.findMany({
      where: { setId, pinned: false },
      orderBy: { createdAt: 'desc' },
      skip: retention,
      select: { id: true },
    });
    if (keep.length === 0) return;
    const ids = keep.map((r) => r.id);
    await this.prisma.testRunResult.deleteMany({ where: { runId: { in: ids } } });
    await this.prisma.testRun.deleteMany({ where: { id: { in: ids } } });
  }

  async list(chatbotId: string, query: TestRunListQuery): Promise<Paginated<TestRun>> {
    await this.scope.assertReadable(chatbotId);
    const where = { chatbotId, ...(query.setId ? { setId: query.setId } : {}), ...(query.status ? { status: query.status } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.testRun.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.testRun.count({ where }),
    ]);
    return toPaginated(rows.map(toTestRunDto), total, query.page, query.pageSize);
  }

  async getOne(chatbotId: string, runId: string): Promise<TestRun> {
    await this.scope.assertReadable(chatbotId);
    return toTestRunDto(await this.getRowOrThrow(chatbotId, runId));
  }

  private buildResultRefs(rows: { expectedKind: string; expectedTargetId: string | null; matchedIntentIdA: string | null; matchedFaqIdA: string | null; matchedNodeIdA: string | null; matchedIntentIdB: string | null; matchedFaqIdB: string | null; matchedNodeIdB: string | null }[]): TargetRef[] {
    const refs: TargetRef[] = [];
    for (const r of rows) {
      if (r.expectedTargetId && (r.expectedKind === 'INTENT' || r.expectedKind === 'FAQ' || r.expectedKind === 'NODE')) {
        refs.push({ kind: r.expectedKind, id: r.expectedTargetId });
      }
      if (r.matchedIntentIdA) refs.push({ kind: 'INTENT', id: r.matchedIntentIdA });
      else if (r.matchedFaqIdA) refs.push({ kind: 'FAQ', id: r.matchedFaqIdA });
      else if (r.matchedNodeIdA) refs.push({ kind: 'NODE', id: r.matchedNodeIdA });
      if (r.matchedIntentIdB) refs.push({ kind: 'INTENT', id: r.matchedIntentIdB });
      else if (r.matchedFaqIdB) refs.push({ kind: 'FAQ', id: r.matchedFaqIdB });
      else if (r.matchedNodeIdB) refs.push({ kind: 'NODE', id: r.matchedNodeIdB });
    }
    return refs;
  }

  async listResults(chatbotId: string, runId: string, query: TestRunResultListQuery): Promise<Paginated<TestRunResult>> {
    await this.scope.assertReadable(chatbotId);
    await this.getRowOrThrow(chatbotId, runId);

    const where = {
      runId,
      ...(query.resultA ? { resultA: query.resultA } : {}),
      ...(query.q ? { questionText: { contains: query.q } } : {}),
      // 요약의 regressed 집계(test-run.executor.ts)와 같은 규칙 — 페이지가 아니라 실행 전체에서 거른다.
      ...(query.regressedOnly ? { resultA: 'PASS', resultB: 'FAIL' } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.testRunResult.findMany({ where, orderBy: { seq: 'asc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.testRunResult.count({ where }),
    ]);
    const nameById = await this.nameResolver.resolveNames(chatbotId, this.buildResultRefs(rows));
    return toPaginated(rows.map((r) => toTestRunResultDto(r, nameById)), total, query.page, query.pageSize);
  }

  async cancel(chatbotId: string, runId: string): Promise<void> {
    await this.scope.assertWritable(chatbotId);
    const run = await this.getRowOrThrow(chatbotId, runId);
    if (run.status !== 'QUEUED' && run.status !== 'RUNNING') {
      throw new ApiException('TEST_RUN_CANCELLED', 409, '이미 종료된 실행은 취소할 수 없습니다.');
    }
    this.cancelRegistry.cancel(runId);
    await this.prisma.testRun.updateMany({ where: { id: runId, status: { in: ['QUEUED', 'RUNNING'] } }, data: { status: 'CANCELLED', finishedAt: new Date() } });
  }

  async pin(chatbotId: string, runId: string, dto: PinTestRunRequestDto): Promise<TestRun> {
    await this.scope.assertWritable(chatbotId);
    const run = await this.getRowOrThrow(chatbotId, runId);

    if (dto.pinned && !run.pinned) {
      const max = this.config.get<number>('TEST_RUN_PINNED_MAX') ?? 5;
      const pinnedCount = await this.prisma.testRun.count({ where: { setId: run.setId, pinned: true } });
      if (pinnedCount >= max) {
        throw new ApiException('LIMIT_EXCEEDED', 409, `고정은 세트당 최대 ${max}건까지 가능합니다.`);
      }
    }
    const updated = await this.prisma.testRun.update({ where: { id: runId }, data: { pinned: dto.pinned } });
    return toTestRunDto(updated);
  }

  async export(chatbotId: string, runId: string): Promise<{ content: string; filename: string; mimeType: string }> {
    await this.scope.assertReadable(chatbotId);
    await this.getRowOrThrow(chatbotId, runId);

    const rows = await this.prisma.testRunResult.findMany({ where: { runId }, orderBy: { seq: 'asc' } });
    const nameById = await this.nameResolver.resolveNames(chatbotId, this.buildResultRefs(rows));
    const exportRows = rows.map((r) => {
      const dto = toTestRunResultDto(r, nameById);
      return {
        seq: dto.seq,
        questionText: dto.questionText,
        expectedKind: dto.expectedKind,
        expectedTargetName: dto.expectedTargetName ?? null,
        resultA: dto.resultA,
        matchedNameA: dto.matchedNameA ?? null,
        bandA: dto.bandA,
        top1ScoreA: dto.top1ScoreA,
        outputsPreviewA: dto.outputsPreviewA,
      };
    });
    return { content: buildTestRunResultCsv(exportRows), filename: 'test-run-results.csv', mimeType: 'text/csv; charset=utf-8' };
  }
}
