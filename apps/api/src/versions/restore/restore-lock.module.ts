import { Module } from '@nestjs/common';
import { RestoreLockRegistry } from './restore-lock.registry';

/**
 * [신규 No.40 R1 — M-2] `RestoreLockRegistry`(in-process 잠금, §9.2) 단일 인스턴스 공유 모듈.
 * `versions`(복원 자체 — `VersionRestoreService`)와 `environment`(모드 켜기 진입부, §5.3 ①)가 같은
 * 잠금 상태를 봐야 하므로 `VersionCaptureModule`·`VersionReadModule`과 같은 "1 export = 1 모듈"
 * 재사용 패턴으로 분리한다. `version-capture.module.ts`(§16 V-6 — `VersionRestore`·`RestoreApplier`
 * 심볼 0건)와 달리 이 클래스는 복원 자산 쓰기를 하지 않는 순수 in-process 잠금이라 별도 모듈이다.
 */
@Module({
  providers: [RestoreLockRegistry],
  exports: [RestoreLockRegistry],
})
export class RestoreLockModule {}
