import { Module } from '@nestjs/common';
import { ApiConnectionCatalogService } from './api-connection-catalog.service';

/**
 * [No.26] 읽기 전용 잎(leaf) 모듈 — `prisma`만 의존한다. 순환 없음: `catalog ← legacy-api ← api-connections`.
 * `validation/**`도 이 모듈만 가져다 쓴다(외부 출구 없이 목 원천을 읽을 수 있다 — FR-0-102).
 */
@Module({
  providers: [ApiConnectionCatalogService],
  exports: [ApiConnectionCatalogService],
})
export class ApiConnectionCatalogModule {}
