import { parentPort } from 'node:worker_threads';
import { runExtractJob } from '../lib/run-extract-job';
import type { KbExtractRequest } from './kb-extractor.port';

/**
 * ★ 작업 스레드 진입점(No.43, §7.2 · KB-16) — import ⊆ `kb-sync/lib/*`·`@chat-bot/pii-mask`·
 * `node:worker_threads`·`node:crypto`·`node:zlib`. Prisma·Nest·네트워크 무의존 · 스크립트 실행
 * 계열 API·VM 모듈 사용 0.
 */
parentPort?.on('message', (req: KbExtractRequest) => {
  runExtractJob(req)
    .then((result) => parentPort?.postMessage({ ok: true, result }))
    .catch((e: unknown) => parentPort?.postMessage({ ok: false, error: e instanceof Error ? e.name : 'unknown' }));
});
