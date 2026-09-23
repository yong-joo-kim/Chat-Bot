import { Injectable, Logger } from '@nestjs/common';
import { hasPermission } from '@chat-bot/shared-types';
import type { PostRunTestOutcome, RoleName } from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiException } from '../../common/api.exception';
import { TestRunService } from '../../validation/test-run.service';
import { POST_RUN_TEST_PERMISSION } from '../lib/required-permissions';

/**
 * [신규 2026-09-23 No.28] G3(선택, 기본 꺼짐) — 성공 직후 TC 실행 시작(§11). `TestRunService.start()`를
 * 호출하는 예약 모듈 유일 파일이다(§16 D-16). 실패는 예약 결과를 바꾸지 않는다 — 절대 throw하지 않는다.
 */
@Injectable()
export class PostRunTestStarter {
  private readonly logger = new Logger('PostRunTestStarter');

  constructor(
    private readonly prisma: PrismaService,
    private readonly testRunService: TestRunService,
  ) {}

  async start(chatbotId: string, postRunTestSetId: string, actorRole: RoleName): Promise<PostRunTestOutcome> {
    try {
      if (!hasPermission(actorRole, POST_RUN_TEST_PERMISSION)) {
        return { status: 'SKIPPED', reason: 'CREATOR_NOT_AUTHORIZED' };
      }
      const set = await this.prisma.testCaseSet.findUnique({ where: { id: postRunTestSetId }, select: { id: true, chatbotId: true } });
      if (!set || set.chatbotId !== chatbotId) {
        return { status: 'SKIPPED', reason: 'TEST_SET_MISSING' };
      }
      const caseCount = await this.prisma.testCase.count({ where: { setId: postRunTestSetId, enabled: true } });
      if (caseCount === 0) {
        return { status: 'SKIPPED', reason: 'TEST_SET_EMPTY' };
      }
      const result = await this.testRunService.start(chatbotId, postRunTestSetId, { overlaySource: 'NONE', useRag: false });
      return { status: 'STARTED', testRunId: result.runId };
    } catch (e) {
      if (e instanceof ApiException) {
        const body = e.getResponse() as { code?: string };
        if (body.code === 'TEST_RUN_IN_PROGRESS') return { status: 'REJECTED', reason: 'TEST_RUN_IN_PROGRESS' };
      }
      this.logger.warn(`G3 실행 시작 실패(예약 결과에는 영향 없음): chatbotId=${chatbotId} error=${e instanceof Error ? e.message : 'unknown'}`);
      return { status: 'REJECTED' };
    }
  }
}
