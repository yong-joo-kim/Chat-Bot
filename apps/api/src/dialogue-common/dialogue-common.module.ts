import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ReferenceCheckService } from './reference-check.service';
import { DialogueBundleService } from './dialogue-bundle.service';
import { InMemoryDialogueBundleCache } from './dialogue-bundle.cache';
import { CsvSheetReader } from './import/csv-sheet-reader';
import { XlsxSheetReader } from './import/xlsx-sheet-reader';
import { InMemoryImportStagingStore } from './import/import-staging.store';
import { EmbeddingModule } from '../embedding/embedding.module';

/**
 * 대화 설계(No.5~9) 6개 모듈 + 품질/채널(No.10~11) 모듈이 공유하는 횡단 관심사(개발명세서 §2.2).
 * 참조 사전검사·엔진 번들 조립(+캐시, DD-22)·대량 업로드 인프라를 제공한다.
 * `EmbeddingModule`을 import해 `DialogueBundleService.invalidate()`가 색인 예약·벡터 캐시
 * 무효화를 같은 지점에서 수행한다(DD-76, nlu-rag-answering-설계.md §7.1).
 */
@Module({
  imports: [EmbeddingModule],
  providers: [
    ReferenceCheckService,
    DialogueBundleService,
    CsvSheetReader,
    XlsxSheetReader,
    { provide: 'ImportStagingStore', useClass: InMemoryImportStagingStore },
    {
      provide: 'DialogueBundleCache',
      useFactory: (config: ConfigService) => new InMemoryDialogueBundleCache(config.get<number>('DIALOGUE_BUNDLE_CACHE_TTL_MS') ?? 60000),
      inject: [ConfigService],
    },
  ],
  exports: [ReferenceCheckService, DialogueBundleService, CsvSheetReader, XlsxSheetReader, 'ImportStagingStore'],
})
export class DialogueCommonModule {}
