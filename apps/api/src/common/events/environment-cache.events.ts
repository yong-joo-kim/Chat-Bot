import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'node:events';

/**
 * [신규 No.40 R1 — M-1] `environment-separation-설계.md` §2.2의 모듈 경계(`versions → environment/**
 * import 0` · `environment/core → environment/serving import 0` · `deploy-schedules →
 * environment/serving import 0`)를 지키면서 `environment/serving`의 L1/L2 캐시(`VersionBundleService`)
 * 무효화를 알리는 전역 이벤트 버스다. 발행자(버전 삭제 — `versions/capture/version-retention.service.ts` ·
 * 운영 전환/롤백 — `environment/core/prod-switch.service.ts`)는 `VersionBundleService`를 몰라도 되고,
 * 구독자(`VersionBundleService`)만 이 파일을 안다 — 어느 쪽도 서로를 직접 import하지 않는다
 * (`rag/conversation-log.port.ts`의 "역방향 의존 금지" 취지를 이벤트 버스로 확장한 것 — 호출부가 서로
 * 다른 계층에 있어 call-site 인자 전달 패턴을 쓸 수 없다).
 *
 * `PrismaModule`과 같은 이유로 `@Global()`(`environment-cache-events.module.ts`)이며 `AppModule`에
 * 한 번만 import한다 — 개별 모듈이 `imports`에 나열할 필요가 없다.
 */
@Injectable()
export class EnvironmentCacheEvents extends EventEmitter {
  /** 버전 삭제 직후(트랜잭션 커밋 후) 발행 — `VersionBundleService.invalidateVersion()`을 부른다. */
  emitVersionDeleted(versionId: string): void {
    this.emit('version-deleted', versionId);
  }

  onVersionDeleted(listener: (versionId: string) => void): void {
    this.on('version-deleted', listener);
  }

  /** 운영 전환·롤백·모드 끄기 커밋 직후 발행 — `VersionBundleService.invalidateChatbot()`을 부른다. */
  emitChatbotPointerChanged(chatbotId: string): void {
    this.emit('chatbot-pointer-changed', chatbotId);
  }

  onChatbotPointerChanged(listener: (chatbotId: string) => void): void {
    this.on('chatbot-pointer-changed', listener);
  }
}
