import { Module } from '@nestjs/common';
import { VersionReadModule } from '../../versions/read/version-read.module';
import { EmbeddingModule } from '../../embedding/embedding.module';
import { DialogueCommonModule } from '../../dialogue-common/dialogue-common.module';
import { VersionBundleService } from './version-bundle.service';
import { VersionCoreCache } from './version-core.cache';

/**
 * [신규 No.40] §2.2 — export는 `VersionBundleService` 1개다. 포인터를 쓰는 코드는 이 모듈에 없으므로
 * 공개 대화·시뮬레이터·TC·상담·학습의 DI 그래프에 포인터 쓰기 경로가 들어가지 않는다.
 * `DialogueCommonModule`을 import하는 이유는 L2 합성 캐시(`VersionServingBundleCache`)의 무효화
 * 지점을 `DialogueBundleService.invalidate()` 1곳과 공유하기 위함이다(§7.3, AC-EN2-3/4).
 */
@Module({
  imports: [VersionReadModule, EmbeddingModule, DialogueCommonModule],
  providers: [VersionBundleService, VersionCoreCache],
  exports: [VersionBundleService],
})
export class EnvironmentServingModule {}
