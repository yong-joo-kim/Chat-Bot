import { Injectable } from '@nestjs/common';
import type { UtteranceAnalysisStage } from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { enableSecureDelete } from '../../handoff/handoff-secure-delete.query';
import type { MaskedUtteranceText } from '../lib/prepare-utterances';

/** DB 쓰기 조각 크기 — SQLite 바인드 변수 상한(행 × 컬럼 수)을 넘지 않게 한다. */
const CREATE_MANY_CHUNK = 250;
const COMMIT_TX_TIMEOUT_MS = 120_000;

export interface CreateQueuedInput {
  chatbotId: string;
  fileName: string;
  fileKind: 'XLSX' | 'CSV';
  conditionsJson: string;
  countsJson: string;
  algorithmVersion: string;
  expiresAt: Date;
  requestedById: string | null;
  requestedByEmail: string | null;
}

export interface CommitClusterRow {
  id: string;
  ordinal: number;
  unassigned: boolean;
  keywordsJson: string;
  autoName: string;
  suggestedName: string | null;
  utteranceCount: number;
  occurrenceSum: number;
  candidateCount: number;
  representativeSeqsJson: string;
}

/** ★ `text`·`sourceMemo`는 `MaskedUtteranceText` 브랜드만 받는다(DC-7) — 마스킹을 건너뛴 저장은 컴파일되지 않는다. */
export interface CommitUtteranceRow {
  clusterId: string;
  seq: number;
  text: MaskedUtteranceText;
  textNormalized: string;
  occurrenceCount: number;
  sourceMemo: MaskedUtteranceText | null;
  hasBannedWord: boolean;
  hasMaskToken: boolean;
  similarityToCentroid: number | null;
  probeAnswered: boolean | null;
  probeMatchKind: string | null;
  probeMatchId: string | null;
  probeMatchName: string | null;
  probeBand: string | null;
  probeScore: number | null;
  wouldUseRag: boolean;
  learningCandidate: boolean;
  suggestedIntentsJson: string;
}

export interface CommitSummary {
  clusterCount: number;
  unassignedCount: number;
  candidateCount: number;
  noticesJson: string;
  embeddingModelId: string | null;
  analyzerId: string | null;
  probeStatus: 'OFF' | 'DONE' | 'FAILED';
  probeFailureReason: string | null;
  probeTargetKind: 'LIVE' | 'PROD' | null;
  probeVersionId: string | null;
  probeVersionNo: number | null;
  probeContentHash: string | null;
  probeThreshold: number | null;
  nameSuggestStatus: 'OFF' | 'DONE' | 'PARTIAL' | 'FAILED';
  nameSuggestFailureReason: string | null;
}

export class ResultCommitRejectedError extends Error {
  constructor() {
    super('RESULT_COMMIT_REJECTED');
    this.name = 'ResultCommitRejectedError';
  }
}

/**
 * ★ `UtteranceAnalysis`·`UtteranceCluster`·`AnalyzedUtterance` **쓰기의 유일한 파일**(DC-5 — 삭제는 이 파일 +
 * 거버넌스 파기 writer + 챗봇 영구삭제 서비스). 정적 검사 UA-5가 3테이블의 `create*`·`update*`·`upsert`
 * 호출 파일 집합을 단언한다. 상태 전이는 전부 CAS(조건부 갱신)이며 종결 상태로 갈 때 `activeLock`을 같은
 * UPDATE에서 푼다(§8.1). 문장·파일 내용을 로그에 남기지 않는다(DC-9).
 */
@Injectable()
export class UtteranceAnalysisStore {
  constructor(private readonly prisma: PrismaService) {}

  /** 행 생성 = 동시 실행 잠금(`activeLock = 'ACTIVE'` 유일 제약 — 위반은 호출부가 P2002로 변환). */
  async createQueued(input: CreateQueuedInput): Promise<{ id: string }> {
    return this.prisma.utteranceAnalysis.create({
      data: {
        chatbotId: input.chatbotId,
        status: 'QUEUED',
        progress: 0,
        activeLock: 'ACTIVE',
        fileName: input.fileName,
        fileKind: input.fileKind,
        conditions: input.conditionsJson,
        counts: input.countsJson,
        algorithmVersion: input.algorithmVersion,
        expiresAt: input.expiresAt,
        requestedById: input.requestedById,
        requestedByEmail: input.requestedByEmail,
      },
      select: { id: true },
    });
  }

  async markRunning(id: string): Promise<void> {
    await this.prisma.utteranceAnalysis.updateMany({ where: { id, status: 'QUEUED' }, data: { status: 'RUNNING', startedAt: new Date() } });
  }

  /** 진행률·단계(RUNNING일 때만 — 실패는 무시: 관측용 부가 정보). */
  async updateProgress(id: string, progress: number, stage?: UtteranceAnalysisStage): Promise<void> {
    await this.prisma.utteranceAnalysis
      .updateMany({
        where: { id, status: 'RUNNING' },
        data: { progress: Math.max(0, Math.min(100, Math.round(progress))), ...(stage ? { stage } : {}) },
      })
      .catch(() => undefined);
  }

  /** 종결(FAILED) — 이미 CANCELLED·SUCCEEDED인 행은 덮어쓰지 않는다. 같은 UPDATE에서 잠금을 푼다. */
  async markFailed(id: string, failureReason: string): Promise<void> {
    await this.prisma.utteranceAnalysis.updateMany({
      where: { id, status: { in: ['QUEUED', 'RUNNING'] } },
      data: { status: 'FAILED', failureReason, activeLock: null, finishedAt: new Date() },
    });
  }

  /** 잠금 해제 — 러너(작업)가 실제로 끝났을 때 싱크가 호출한다. 취소 후에도 러너가 끝나기 전에는 새 분석이 시작되지 않게(L-2). */
  async releaseLock(id: string): Promise<void> {
    await this.prisma.utteranceAnalysis.updateMany({ where: { id, activeLock: { not: null } }, data: { activeLock: null } });
  }

  /** 취소 CAS — `status ∈ {QUEUED, RUNNING} ∧ resultsCommittedAt IS NULL`. 0이면 취소 불가. 잠금은 러너 종료 시 풀린다. */
  async cancel(id: string, chatbotId: string): Promise<number> {
    const r = await this.prisma.utteranceAnalysis.updateMany({
      where: { id, chatbotId, status: { in: ['QUEUED', 'RUNNING'] }, resultsCommittedAt: null },
      data: { status: 'CANCELLED', finishedAt: new Date() },
    });
    return r.count;
  }

  /**
   * ★ 결과 커밋 — 완료 전이(SUCCEEDED)와 묶음·발화 쓰기를 **한 트랜잭션**으로 한다(NFR-DCR1 — 결과가 반쯤
   * 저장된 "성공"이 구조적으로 없다). 그사이 취소·삭제되어 RUNNING 갱신이 0행이면 예외로 롤백한다.
   */
  async commitResults(analysisId: string, summary: CommitSummary, clusters: readonly CommitClusterRow[], utterances: readonly CommitUtteranceRow[]): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction(
      async (tx) => {
        const updated = await tx.utteranceAnalysis.updateMany({
          where: { id: analysisId, status: 'RUNNING' },
          data: {
            status: 'SUCCEEDED',
            stage: null,
            progress: 100,
            activeLock: null,
            resultsCommittedAt: now,
            finishedAt: now,
            clusterCount: summary.clusterCount,
            unassignedCount: summary.unassignedCount,
            candidateCount: summary.candidateCount,
            notices: summary.noticesJson,
            embeddingModelId: summary.embeddingModelId,
            analyzerId: summary.analyzerId,
            probeStatus: summary.probeStatus,
            probeFailureReason: summary.probeFailureReason,
            probeTargetKind: summary.probeTargetKind,
            probeVersionId: summary.probeVersionId,
            probeVersionNo: summary.probeVersionNo,
            probeContentHash: summary.probeContentHash,
            probeThreshold: summary.probeThreshold,
            nameSuggestStatus: summary.nameSuggestStatus,
            nameSuggestFailureReason: summary.nameSuggestFailureReason,
            failureReason: null,
          },
        });
        if (updated.count !== 1) throw new ResultCommitRejectedError();

        for (let i = 0; i < clusters.length; i += CREATE_MANY_CHUNK) {
          await tx.utteranceCluster.createMany({
            data: clusters.slice(i, i + CREATE_MANY_CHUNK).map((c) => ({
              id: c.id,
              analysisId,
              ordinal: c.ordinal,
              unassigned: c.unassigned,
              keywords: c.keywordsJson,
              autoName: c.autoName,
              suggestedName: c.suggestedName,
              utteranceCount: c.utteranceCount,
              occurrenceSum: c.occurrenceSum,
              candidateCount: c.candidateCount,
              representativeSeqs: c.representativeSeqsJson,
            })),
          });
        }
        for (let i = 0; i < utterances.length; i += CREATE_MANY_CHUNK) {
          await tx.analyzedUtterance.createMany({
            data: utterances.slice(i, i + CREATE_MANY_CHUNK).map((u) => ({
              analysisId,
              clusterId: u.clusterId,
              seq: u.seq,
              text: u.text,
              textNormalized: u.textNormalized,
              occurrenceCount: u.occurrenceCount,
              sourceMemo: u.sourceMemo,
              hasBannedWord: u.hasBannedWord,
              hasMaskToken: u.hasMaskToken,
              similarityToCentroid: u.similarityToCentroid,
              probeAnswered: u.probeAnswered,
              probeMatchKind: u.probeMatchKind,
              probeMatchId: u.probeMatchId,
              probeMatchName: u.probeMatchName,
              probeBand: u.probeBand,
              probeScore: u.probeScore,
              wouldUseRag: u.wouldUseRag,
              learningCandidate: u.learningCandidate,
              suggestedIntents: u.suggestedIntentsJson,
            })),
          });
        }
      },
      { timeout: COMMIT_TX_TIMEOUT_MS, maxWait: COMMIT_TX_TIMEOUT_MS },
    );
  }

  /** 묶음 이름 수정(메모 — 자산 아님 · 감사 아님). 다른 분석의 묶음이면 0. */
  async renameCluster(analysisId: string, clusterId: string, customName: string | null): Promise<number> {
    const r = await this.prisma.utteranceCluster.updateMany({ where: { id: clusterId, analysisId }, data: { customName } });
    return r.count;
  }

  /** 반영 표시 CAS(`appliedAt IS NULL`) — 0이면 동시 반영(이미 다른 요청이 표시함). */
  async markApplied(
    utteranceId: string,
    analysisId: string,
    applied: { intentId: string; intentName: string; byId: string | null; byEmail: string | null },
  ): Promise<boolean> {
    const r = await this.prisma.analyzedUtterance.updateMany({
      where: { id: utteranceId, analysisId, appliedAt: null },
      data: {
        appliedIntentId: applied.intentId,
        appliedIntentName: applied.intentName,
        appliedById: applied.byId,
        appliedByEmail: applied.byEmail,
        appliedAt: new Date(),
      },
    });
    return r.count === 1;
  }

  /** 묶음·분석의 `appliedCount`를 발화 행에서 다시 센다. */
  async refreshAppliedCounts(analysisId: string): Promise<number> {
    const grouped = await this.prisma.analyzedUtterance.groupBy({
      by: ['clusterId'],
      where: { analysisId, appliedAt: { not: null } },
      _count: { _all: true },
    });
    const byCluster = new Map(grouped.map((g) => [g.clusterId, g._count._all]));
    const clusters = await this.prisma.utteranceCluster.findMany({ where: { analysisId }, select: { id: true } });
    let total = 0;
    for (const c of clusters) {
      const n = byCluster.get(c.id) ?? 0;
      total += n;
      await this.prisma.utteranceCluster.updateMany({ where: { id: c.id }, data: { appliedCount: n } });
    }
    await this.prisma.utteranceAnalysis.updateMany({ where: { id: analysisId }, data: { appliedCount: total } });
    return total;
  }

  /** 수동 삭제(종결 상태만) — 발화 → 묶음 → 분석 순서, `secure_delete`. 삭제된 분석 수를 돌려준다. */
  async deleteAnalysis(id: string, chatbotId: string): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const target = await tx.utteranceAnalysis.findFirst({
        where: { id, chatbotId, status: { in: ['SUCCEEDED', 'FAILED', 'CANCELLED'] }, activeLock: null },
        select: { id: true },
      });
      if (!target) return 0; // 처리 중이거나 이미 없다 — 자식 행부터 지우지 않는다.
      await enableSecureDelete(tx);
      await tx.analyzedUtterance.deleteMany({ where: { analysisId: id } });
      await tx.utteranceCluster.deleteMany({ where: { analysisId: id } });
      const r = await tx.utteranceAnalysis.deleteMany({ where: { id, chatbotId, status: { in: ['SUCCEEDED', 'FAILED', 'CANCELLED'] } } });
      return r.count;
    });
  }

  /** 기동 시 고아 정리(§8.4) — QUEUED·RUNNING → FAILED(`SERVER_RESTART`) · 잠금 해제. 재개하지 않는다. */
  async failOrphans(): Promise<number> {
    const r = await this.prisma.utteranceAnalysis.updateMany({
      where: { status: { in: ['QUEUED', 'RUNNING'] } },
      data: { status: 'FAILED', failureReason: 'SERVER_RESTART', activeLock: null, finishedAt: new Date() },
    });
    // 취소 뒤 러너가 끝나기 전에 서버가 내려간 행(CANCELLED + 잠금 유지) — 상태는 그대로 두고 잠금만 푼다.
    const locks = await this.prisma.utteranceAnalysis.updateMany({ where: { activeLock: { not: null } }, data: { activeLock: null } });
    return r.count + locks.count;
  }
}
