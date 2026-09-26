import { Injectable } from '@nestjs/common';
import type { RetentionRunKind, RetentionTargetKind } from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { enableSecureDelete } from '../../handoff/handoff-secure-delete.query';
import { DECRYPT_FAILED_TEXT, openField, sealField } from '../../common/crypto/field-crypto';
import type { EncryptedFieldId } from '@chat-bot/shared-types';

/**
 * ★ 소거·재암호화·호출로그/감사로그 삭제·파기 앵커·`RetentionRun` 쓰기 유일 파일(No.45, §9.2·§7.6).
 * **export하지 않는다** — `governance/jobs/**`만 import한다(정적 검사 G-10). 소거 트랜잭션은
 * `enableSecureDelete()`(원시 SQL 보유 파일 재사용, G-17)를 쓴다.
 */
@Injectable()
export class GovernanceDataWriter {
  constructor(private readonly prisma: PrismaService) {}

  /** `ConversationLog` 텍스트 소거 — 행·수치·`sessionId`·`groupId` 등은 그대로(CAS: `textPurgedAt: null`). */
  async purgeConversationLogs(ids: readonly string[], now: Date): Promise<number> {
    if (ids.length === 0) return 0;
    return this.prisma.$transaction(async (tx) => {
      await enableSecureDelete(tx);
      const result = await tx.conversationLog.updateMany({
        where: { id: { in: [...ids] }, textPurgedAt: null },
        data: { userMessage: '', botResponse: '', textPurgedAt: now },
      });
      return result.count;
    });
  }

  /** 종결 미응답 항목 소거 — `questionNormalized`는 유일 키 보존을 위해 행마다 다른 `#PURGED#<id>`. */
  async purgeUnansweredClosed(ids: readonly string[], now: Date): Promise<number> {
    if (ids.length === 0) return 0;
    let count = 0;
    await this.prisma.$transaction(async (tx) => {
      await enableSecureDelete(tx);
      for (const id of ids) {
        const result = await tx.unansweredQuestion.updateMany({
          where: { id, textPurgedAt: null },
          data: { questionText: '', variants: '[]', questionNormalized: `#PURGED#${id}`, textPurgedAt: now },
        });
        count += result.count;
      }
    });
    return count;
  }

  /** 설문 자유 텍스트 소거 — 선택·척도 행은 대상 아님(호출부가 id를 골라 넘긴다). */
  async purgeSurveyAnswers(ids: readonly string[], now: Date): Promise<number> {
    if (ids.length === 0) return 0;
    return this.prisma.$transaction(async (tx) => {
      await enableSecureDelete(tx);
      const result = await tx.surveyAnswer.updateMany({ where: { id: { in: [...ids] }, textPurgedAt: null }, data: { textValue: '', textPurgedAt: now } });
      return result.count;
    });
  }

  /** 종료 상담 메시지 텍스트 소거 — `rawText`는 이미 null인 것이 정상(방어적으로 함께 null 대입). */
  async purgeHandoffMessages(ids: readonly string[], now: Date): Promise<number> {
    if (ids.length === 0) return 0;
    return this.prisma.$transaction(async (tx) => {
      await enableSecureDelete(tx);
      const result = await tx.handoffMessage.updateMany({
        where: { id: { in: [...ids] }, textPurgedAt: null },
        data: { text: '', rawText: null, textPurgedAt: now },
      });
      return result.count;
    });
  }

  /** 호출 로그 2종 — 텍스트 없는 메타데이터라 행 삭제(봉인 대상 아님, 영구삭제 동반 삭제 선례). */
  async deleteCallLogsBatch(cutoff: Date, batchSize: number): Promise<number> {
    const ragIds = await this.prisma.ragCallLog.findMany({ where: { createdAt: { lt: cutoff } }, select: { id: true }, take: batchSize });
    let count = 0;
    if (ragIds.length > 0) {
      const r = await this.prisma.ragCallLog.deleteMany({ where: { id: { in: ragIds.map((x) => x.id) } } });
      count += r.count;
    }
    const apiIds = await this.prisma.apiCallLog.findMany({ where: { createdAt: { lt: cutoff } }, select: { id: true }, take: batchSize });
    if (apiIds.length > 0) {
      const r = await this.prisma.apiCallLog.deleteMany({ where: { id: { in: apiIds.map((x) => x.id) } } });
      count += r.count;
    }
    // [신규 No.41] 업무 자동화 실행 이력 — 종단 상태(대기·보류·발송 중 제외)만 파기 대상이다(§10.3).
    const workflowIds = await this.prisma.workflowRun.findMany({
      where: { createdAt: { lt: cutoff }, status: { in: ['SUCCEEDED', 'FAILED', 'SKIPPED', 'CANCELLED', 'EXPIRED'] } },
      select: { id: true },
      take: batchSize,
    });
    if (workflowIds.length > 0) {
      const r = await this.prisma.workflowRun.deleteMany({ where: { id: { in: workflowIds.map((x) => x.id) } } });
      count += r.count;
    }
    return count;
  }

  /**
   * 감사로그 1배치 삭제 — ⓐ 체인 이전·폴백 행(`seq:null`) 우선 ⓑ 그다음 체인 행을 앞부분부터
   * `[minSeq, S]` 구간으로 지우고 `RETENTION` 앵커를 같은 트랜잭션에 갱신한다(§9.2).
   */
  async deleteAuditLogsBatch(cutoff: Date, batchSize: number): Promise<{ deleted: number; anchorSeq?: number; anchorHash?: string }> {
    const preRows = await this.prisma.auditLog.findMany({ where: { seq: null, createdAt: { lt: cutoff } }, select: { id: true }, take: batchSize });
    if (preRows.length > 0) {
      const r = await this.prisma.auditLog.deleteMany({ where: { id: { in: preRows.map((x) => x.id) } } });
      return { deleted: r.count };
    }

    const head = await this.prisma.auditChainHead.findUnique({ where: { id: 'HEAD' } });
    if (!head) return { deleted: 0 };

    const firstKeep = await this.prisma.auditLog.findFirst({
      where: { createdAt: { gte: cutoff }, seq: { not: null } },
      orderBy: { seq: 'asc' },
      select: { seq: true },
    });
    const upperBoundSeq = firstKeep?.seq !== undefined && firstKeep?.seq !== null ? firstKeep.seq - 1 : head.headSeq;
    if (upperBoundSeq < 1) return { deleted: 0 };

    const rows = await this.prisma.auditLog.findMany({
      where: { seq: { lte: upperBoundSeq } },
      orderBy: { seq: 'asc' },
      take: batchSize,
      select: { seq: true, rowHash: true },
    });
    if (rows.length === 0) return { deleted: 0 };

    const first = rows[0].seq as number;
    const last = rows[rows.length - 1];
    const lastSeq = last.seq as number;
    const lastHash = last.rowHash ?? '';

    return this.prisma.$transaction(async (tx) => {
      const r = await tx.auditLog.deleteMany({ where: { seq: { gte: first, lte: lastSeq } } });
      await tx.auditChainAnchor.upsert({
        where: { id: 'RETENTION' },
        create: { id: 'RETENTION', seq: lastSeq, hash: lastHash },
        update: { seq: lastSeq, hash: lastHash },
      });
      return { deleted: r.count, anchorSeq: lastSeq, anchorHash: lastHash };
    });
  }

  /** `RetentionRun` 보존 하한 경과분 삭제(감사로그와 같은 정책). */
  async deleteOldRetentionRuns(cutoff: Date): Promise<number> {
    const r = await this.prisma.retentionRun.deleteMany({ where: { startedAt: { lt: cutoff } } });
    return r.count;
  }

  /** `HandoffMessage.text`|`rawText` 재암호화(백필 겸용) — CAS(`updateMany` where 옛값 일치). */
  async reencryptHandoffColumn(
    column: 'text' | 'rawText',
    field: EncryptedFieldId,
    rows: readonly { id: string; oldValue: string }[],
  ): Promise<number> {
    let count = 0;
    for (const row of rows) {
      const plaintext = openField(field, row.id, row.oldValue);
      if (plaintext === null || plaintext === DECRYPT_FAILED_TEXT) continue;
      const newValue = sealField(field, row.id, plaintext);
      if (newValue === row.oldValue) continue;
      const result =
        column === 'text'
          ? await this.prisma.handoffMessage.updateMany({ where: { id: row.id, text: row.oldValue }, data: { text: newValue } })
          : await this.prisma.handoffMessage.updateMany({ where: { id: row.id, rawText: row.oldValue }, data: { rawText: newValue } });
      count += result.count;
    }
    return count;
  }

  /** `SurveyAnswer.textValue` 재암호화(백필 겸용). */
  async reencryptSurveyTextValue(rows: readonly { id: string; oldValue: string }[]): Promise<number> {
    let count = 0;
    for (const row of rows) {
      const plaintext = openField('SURVEY_TEXT_VALUE', row.id, row.oldValue);
      if (plaintext === null || plaintext === DECRYPT_FAILED_TEXT) continue;
      const newValue = sealField('SURVEY_TEXT_VALUE', row.id, plaintext);
      if (newValue === row.oldValue) continue;
      const result = await this.prisma.surveyAnswer.updateMany({ where: { id: row.id, textValue: row.oldValue }, data: { textValue: newValue } });
      count += result.count;
    }
    return count;
  }

  async createRetentionRun(data: {
    runId: string;
    kind: RetentionRunKind;
    target: RetentionTargetKind | EncryptedFieldId | null;
    chatbotId: string | null;
    days: number | null;
    cutoff: Date | null;
    affectedCount: number;
    status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
    resultCode: string | null;
    headSeq: number | null;
    headHash: string | null;
    anchorSeq: number | null;
    instanceId: string;
    startedAt: Date;
    finishedAt: Date | null;
  }): Promise<void> {
    await this.prisma.retentionRun.create({ data });
  }
}
