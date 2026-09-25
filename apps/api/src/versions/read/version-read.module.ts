import { Module } from '@nestjs/common';
import { VersionPayloadReader } from './version-payload.reader';

/**
 * [신규 No.40] `VersionPayloadReader`를 독립 모듈로 분리해 export한다(§2.1) — `VersionsModule`·
 * `environment/core`·`environment/serving`이 순환 없이 공유한다. 클래스·파일 위치는 불변이다.
 */
@Module({
  providers: [VersionPayloadReader],
  exports: [VersionPayloadReader],
})
export class VersionReadModule {}
