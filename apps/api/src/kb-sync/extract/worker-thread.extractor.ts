import { existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import { Worker } from 'node:worker_threads';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { KbExtractRequest, KbExtractResult, KbExtractorPort } from './kb-extractor.port';
import { WorkerEntryMissingError } from './kb-extractor.port';
import { kbErrorCode, kbLogLine } from '../lib/kb-log-line';

/** [항목② — 시험 가시성] 값을 시험에서 직접 검증할 수 있도록 상수를 export한다(동작은 그대로). */
export const JOB_TIMEOUT_MS = 30_000;
export const HTML_JOB_TIMEOUT_MS = 5_000;
export const RESPAWN_AFTER_JOBS = 200;
export const WORKER_RESOURCE_LIMITS = { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 32, codeRangeSizeMb: 16, stackSizeMb: 4 } as const;

/**
 * [신규 No.43 — 3차 보완] `KB_EXTRACTOR`의 **운영 기본값**(§7.2 · 보안 설계 요건 — 문서 해석은
 * 작업 스레드 샌드박스에서 격리한다). `worker_threads` 작업 스레드 1개(인스턴스당) · 요청 직렬 큐 ·
 * `resourceLimits`(힙 192MB) · 작업별 시간 상한(HTML 5초·그 외 30초) · 초과·비정상 종료 시 재생성.
 *
 * 빌드 산출물(`dist/kb-sync/extract/extract.worker.js`)이 있을 때만 동작한다 — 없으면 **조용히
 * 인프로세스로 대체하지 않고**, 실제 해석 요청이 들어와 워커를 처음 띄우려는 시점에 명확한 오류를
 * 던진다(`workerScriptPath()`). 운영(`pnpm build` 후 `node dist/main.js`)·로컬 개발(`pnpm dev` —
 * `ts-node-dev`로 소스에서 직접 실행) 모두 최초 1회 `pnpm build`(또는 `tsc -p tsconfig.json`)가
 * 필요하다 — 개발 편의를 위해 이 클래스 자체를 다른 구현으로 바꾸지 않는다. 빌드 산출물 없이 도는
 * 시험(ts-jest)은 `KB_EXTRACTOR`를 `InProcessExtractor`로 override한다(시험 구성 변경 — 프로덕션
 * DI 배선은 그대로 이 클래스다).
 *
 * `__dirname` 옆(`extract.worker.js`, 운영 빌드 산출물의 정상 위치)이 없으면 `src` → `dist` 치환
 * 경로도 확인한다 — ts-jest 실행 시(`__dirname`이 `src/...`)에도 직전에 만든 `dist/...`가 있으면
 * 그걸 쓴다(`worker-thread.extractor.spec.ts`가 실제로 이렇게 검증한다). 두 경로 모두 없으면
 * 명확한 오류를 던진다 — **자동으로 빌드를 트리거하지 않는다**(런타임 부작용 금지).
 */
@Injectable()
export class WorkerThreadExtractor implements KbExtractorPort, OnModuleDestroy {
  private readonly logger = new Logger('WorkerThreadExtractor');
  private worker: Worker | null = null;
  private jobsSinceSpawn = 0;
  private queue: Promise<unknown> = Promise.resolve();

  /** [R1 리뷰 M-2] 작업 스레드를 띄우지 않고 엔트리 존재만 확인한다(부팅 시 사전 점검용). */
  checkAvailability(): void {
    this.workerScriptPath();
  }

  private workerScriptPath(): string {
    const primary = join(__dirname, 'extract.worker.js');
    if (existsSync(primary)) return primary;

    const srcMarker = `${sep}src${sep}`;
    if (__dirname.includes(srcMarker)) {
      const distDir = __dirname.replace(srcMarker, `${sep}dist${sep}`);
      const distCandidate = join(distDir, 'extract.worker.js');
      if (existsSync(distCandidate)) return distCandidate;
    }

    throw new WorkerEntryMissingError(
      'extract.worker.js 빌드 산출물이 없습니다 — `pnpm build`(또는 `tsc -p tsconfig.json`)를 먼저 실행하세요. ' +
        '문서 해석은 작업 스레드 샌드박스 격리가 보안 설계 요건이라 인프로세스로 조용히 대체하지 않습니다.',
    );
  }

  private ensureWorker(): Worker {
    if (this.worker && this.jobsSinceSpawn < RESPAWN_AFTER_JOBS) return this.worker;
    this.worker?.terminate().catch(() => undefined);
    const worker = new Worker(this.workerScriptPath(), { resourceLimits: WORKER_RESOURCE_LIMITS });
    worker.on('error', (e) => {
      // 오류 원문은 문서 내용 조각을 담을 수 있다 — 클래스명 코드만 남긴다(KB-15).
      this.logger.warn(kbLogLine({ host: '-', path: 'extract-worker', code: kbErrorCode(e) }));
      // [버그 수정 — 항목②] 죽은(크래시한) 참조를 들고 있으면 다음 요청이 응답 없는 워커에 postMessage
      // 하게 된다 — 참조를 비워 다음 `ensureWorker()`가 반드시 새로 만들게 한다.
      if (this.worker === worker) this.worker = null;
    });
    this.worker = worker;
    this.jobsSinceSpawn = 0;
    return worker;
  }

  async extract(req: KbExtractRequest): Promise<KbExtractResult> {
    const run = this.queue.then(() => this.runOne(req));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private runOne(req: KbExtractRequest): Promise<KbExtractResult> {
    const worker = this.ensureWorker();
    this.jobsSinceSpawn += 1;
    const timeoutMs = req.kind === 'HTML' ? HTML_JOB_TIMEOUT_MS : JOB_TIMEOUT_MS;

    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = (): void => {
        clearTimeout(timer);
        worker.off('message', onMessage);
        worker.off('error', onError);
      };

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        worker.terminate().catch(() => undefined);
        if (this.worker === worker) this.worker = null;
        reject(new Error('FILE_UNSAFE_TIMEOUT'));
      }, timeoutMs);

      const onMessage = (msg: { ok: boolean; result?: KbExtractResult; error?: string }): void => {
        if (settled) return;
        settled = true;
        cleanup();
        if (msg.ok && msg.result) resolve(msg.result);
        else reject(new Error(msg.error ?? 'EXTRACT_FAILED'));
      };
      // [버그 수정 — 항목②] 작업 스레드가 (예: 192MB 힙 상한 초과로) 죽으면 기존에는 `settled`이
      // 될 때까지(=시간 상한까지) 그냥 멈춰 있었다 — 이제 즉시 실패로 수렴시킨다(응답성 개선).
      const onError = (e: Error): void => {
        if (settled) return;
        settled = true;
        cleanup();
        if (this.worker === worker) this.worker = null;
        reject(new Error(`WORKER_CRASHED:${kbErrorCode(e)}`));
      };
      worker.on('message', onMessage);
      worker.on('error', onError);

      const transferList = 'bytes' in req && req.bytes instanceof Uint8Array ? [req.bytes.buffer as ArrayBuffer] : [];
      worker.postMessage(req, transferList);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.terminate().catch(() => undefined);
  }
}
