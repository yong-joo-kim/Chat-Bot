import { Injectable } from '@nestjs/common';
import { runExtractJob } from '../lib/run-extract-job';
import type { KbExtractRequest, KbExtractResult, KbExtractorPort } from './kb-extractor.port';

/**
 * [신규 No.43] 시험용 구현(§7.2) — 같은 순수 함수(`run-extract-job.ts`)를 작업 스레드 없이 직접
 * 호출한다(ts-jest가 `.ts` 작업 스레드를 띄우지 못하는 문제 회피 — CLAUDE.md).
 */
@Injectable()
export class InProcessExtractor implements KbExtractorPort {
  async extract(req: KbExtractRequest): Promise<KbExtractResult> {
    return runExtractJob(req);
  }
}
