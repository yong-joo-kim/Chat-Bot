import { Module } from '@nestjs/common';
import { DialogueCommonModule } from '../dialogue-common/dialogue-common.module';
import { AssetTransferCaptureService } from './asset-transfer-capture.service';
import { AssetTransferLoader } from './asset-transfer.loader';

/**
 * [신규 No.22] 챗봇 간 자산 이관 부품(topic-system-설계.md §2.1) — 복원 적재기(ID 보존)와 코드를
 * 섞지 않는다(NFR-TPM2, §17 T-15). 대화 자산 6모듈·`VersionsModule`·`TopicsModule`을 import하지 않는다.
 */
@Module({
  imports: [DialogueCommonModule],
  providers: [AssetTransferCaptureService, AssetTransferLoader],
  exports: [AssetTransferCaptureService, AssetTransferLoader],
})
export class AssetTransferModule {}
