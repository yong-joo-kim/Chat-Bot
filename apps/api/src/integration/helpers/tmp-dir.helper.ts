import { rmSync } from 'node:fs';

/**
 * Windows에서 SQLite 파일 핸들 해제가 `app.close()` 직후 완전히 끝나지 않아 `rmSync`가 EPERM/EBUSY로
 * 실패하는 경우가 있다(시험 인프라 문제 — 운영 코드와 무관). 개별 시험은 통과했는데 `afterAll`의 정리 실패로
 * 스위트 전체가 "Test suite failed to run"이 되는 것을 막는다. 짧은 유예 + 재시도로 흡수하고, 그래도 실패하면
 * 임시 디렉터리 정리만 건너뛴다(OS 임시 폴더 정리 대상 — 시험 판정에는 무해).
 */
export async function safeCleanupTmpDir(dir: string): Promise<void> {
  await new Promise((r) => setTimeout(r, 300));
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // 정리 실패는 무시한다.
  }
}
