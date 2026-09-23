import { Injectable } from '@nestjs/common';

/**
 * 챗봇 단위 in-process 복원 잠금(§9.2) — `Set<chatbotId>` · `tryAcquire()`/`release()` 전부 동기
 * (await 없음, `ReindexQueueService.isRunning/schedule`과 같은 규약). 정합성의 근거는 **SQLite
 * 직렬화 트랜잭션 안의 재확인**(§9.1)이며, 이 잠금은 UX용 빠른 실패 + 불필요한 캡처 비용 절감이다.
 * 서버 재시작 시 자연 해제된다(EX-H-6).
 */
@Injectable()
export class RestoreLockRegistry {
  private readonly locked = new Set<string>();

  tryAcquire(chatbotId: string): boolean {
    if (this.locked.has(chatbotId)) return false;
    this.locked.add(chatbotId);
    return true;
  }

  release(chatbotId: string): void {
    this.locked.delete(chatbotId);
  }

  isLocked(chatbotId: string): boolean {
    return this.locked.has(chatbotId);
  }
}
