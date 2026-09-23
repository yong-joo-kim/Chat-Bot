import { Module } from '@nestjs/common';
import { ChatbotsModule } from '../chatbots/chatbots.module';
import { DialogueCommonModule } from '../dialogue-common/dialogue-common.module';
import { EmbeddingModule } from '../embedding/embedding.module';
import { AnswerSettingsModule } from '../answer-settings/answer-settings.module';
import { RagModule } from '../rag/rag.module';
import { TrainingJobsModule } from '../training-jobs/training-jobs.module';
import { TestSetsController } from './test-sets.controller';
import { TestCasesController } from './test-cases.controller';
import { TestRunsController } from './test-runs.controller';
import { TestSetService } from './test-set.service';
import { TestCaseService } from './test-case.service';
import { TestRunService } from './test-run.service';
import { TargetNameResolverService } from './target-name-resolver.service';
import { TestCaseImportService } from './import/test-case-import.service';
import { TestRunExecutor } from './run/test-run.executor';
import { TestRunEmbeddingService } from './run/test-run-embedding.service';
import { TestRunOverlayBuilder } from './run/test-run-overlay.builder';
import { TestRunRagService } from './run/test-run-rag.service';
import { TestRunStatusSink } from './run/test-run-status.sink';
import { TestRunCancelRegistry } from './run/test-run-cancel.registry';
import { TestRunCompareService } from './compare/test-run-compare.service';

/**
 * 검증/품질 고도화(No.19 대화검증시스템·TC테스트 / No.20 학습영향도 TEST) 모듈(validation-regression-설계.md §2).
 *
 * ⚠ **봉인(ADR-0029·0030) — 아래 모듈은 절대 import하지 않는다**(정적 검사 `validation-sealing.spec.ts`가
 * 매 실행 단언한다): `ConversationModule`(로그·통계·미응답 큐 오염 0건) · `IntentsModule`/`KeywordsModule`/
 * `FaqModule`/`DialogNodesModule`(대화 자산 변경 코드가 컴파일되지 않는다) · `AugmentationModule`
 * (import하면 승격 유일 지점이 이 모듈의 DI 그래프에 들어와 ADR-0025 봉인이 약해진다 — 제안 문장은
 * Prisma로 직접 읽는다). 실행 경로는 `QueryEmbeddingService`(운영 질의 임베딩 캐시)·`ConversationLogService`도
 * 주입하지 않는다 — `EmbeddingModule`/`RagModule`을 import해도 그 두 서비스는 **소비하지 않는다**.
 */
@Module({
  imports: [ChatbotsModule, DialogueCommonModule, EmbeddingModule, AnswerSettingsModule, RagModule, TrainingJobsModule],
  controllers: [TestSetsController, TestCasesController, TestRunsController],
  providers: [
    TestSetService,
    TestCaseService,
    TestRunService,
    TargetNameResolverService,
    TestCaseImportService,
    TestRunExecutor,
    TestRunEmbeddingService,
    TestRunOverlayBuilder,
    TestRunRagService,
    TestRunStatusSink,
    TestRunCancelRegistry,
    TestRunCompareService,
  ],
  // [신규 2026-09-23 No.28] 운영 예약 배포의 G3(실행 직후 TC) 1파일(`post-run-test.starter.ts`)만
  // 재사용한다. imports는 무변경 — validation-sealing.spec.ts 무수정 통과(§11).
  exports: [TestRunService],
})
export class ValidationModule {}
