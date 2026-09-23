import { Injectable } from '@nestjs/common';
import type { TestRunComparison, TestRunComparisonKind, TestRunComparisonQuery, TestRunEnvFingerprint } from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiException } from '../../common/api.exception';
import { ChatbotScopeService } from '../../chatbots/chatbot-scope.service';
import { compareRuns, countByClassification, sortComparisonRows } from '../lib/compare-runs';
import type { ComparableResult } from '../lib/compare-runs';
import { diffFingerprint } from '../lib/env-fingerprint';
import { toTestRunDto } from '../test-run.mapper';

const NOT_FOUND_MESSAGE = '요청하신 실행을 찾을 수 없습니다.';

/**
 * M1(실행 간 비교) — **저장하지 않고 조회 시점에 계산**한다(FR-V2-5, ADR-0029 §2).
 * `compareRuns()` 순수 함수를 그대로 재사용하며 복제하지 않는다.
 */
@Injectable()
export class TestRunCompareService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ChatbotScopeService,
  ) {}

  private parseFingerprint(json: string | null): TestRunEnvFingerprint | null {
    if (!json) return null;
    try {
      return JSON.parse(json) as TestRunEnvFingerprint;
    } catch {
      return null;
    }
  }

  async compare(chatbotId: string, query: TestRunComparisonQuery): Promise<TestRunComparison> {
    await this.scope.assertReadable(chatbotId);

    const [base, target] = await Promise.all([
      this.prisma.testRun.findFirst({ where: { id: query.baseRunId, chatbotId } }),
      this.prisma.testRun.findFirst({ where: { id: query.targetRunId, chatbotId } }),
    ]);
    if (!base || !target) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);
    if (base.setId !== target.setId) {
      throw new ApiException('TEST_RUN_NOT_COMPARABLE', 400, '서로 다른 검증 세트의 실행은 비교할 수 없습니다.');
    }
    if (base.status !== 'SUCCEEDED' || target.status !== 'SUCCEEDED') {
      throw new ApiException('TEST_RUN_NOT_COMPARABLE', 400, '취소되었거나 완료되지 않은 실행은 비교 기준으로 쓸 수 없습니다.');
    }

    const [baseRows, targetRows] = await Promise.all([
      this.prisma.testRunResult.findMany({ where: { runId: base.id } }),
      this.prisma.testRunResult.findMany({ where: { runId: target.id } }),
    ]);

    const toComparable = (rows: typeof baseRows): ComparableResult[] =>
      rows.map((r) => ({
        caseId: r.caseId,
        questionText: r.questionText,
        result: r.resultA as ComparableResult['result'],
        matchedIntentId: r.matchedIntentIdA,
        matchedFaqId: r.matchedFaqIdA,
        matchedNodeId: r.matchedNodeIdA,
        outputsHash: r.outputsHashA,
      }));

    const allRows = sortComparisonRows(compareRuns(toComparable(baseRows), toComparable(targetRows)));
    const counts = countByClassification(allRows);

    const filterKinds = query.filter
      ? new Set(query.filter.split(',').map((s) => s.trim()).filter((s): s is TestRunComparisonKind => s.length > 0) as TestRunComparisonKind[])
      : null;
    const filtered = filterKinds ? allRows.filter((r) => filterKinds.has(r.classification)) : allRows;

    const start = (query.page - 1) * query.pageSize;
    const page = filtered.slice(start, start + query.pageSize);

    const baseFingerprint = this.parseFingerprint(base.envFingerprint);
    const targetFingerprint = this.parseFingerprint(target.envFingerprint);

    return {
      base: toTestRunDto(base),
      target: toTestRunDto(target),
      counts,
      fingerprintDiff: diffFingerprint(baseFingerprint, targetFingerprint),
      items: page,
      total: filtered.length,
      page: query.page,
      pageSize: query.pageSize,
    };
  }
}
