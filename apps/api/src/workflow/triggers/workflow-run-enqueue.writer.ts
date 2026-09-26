import { Injectable, Logger } from '@nestjs/common';
import { toKstDayBucket } from '@chat-bot/shared-types';
import type { WorkflowEventType, WorkflowHoldReason, WorkflowOutcome, WorkflowRunStatus, WorkflowStatusReason, WorkflowTriggerKind } from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { sealField } from '../../common/crypto/field-crypto';

function isUniqueConstraintViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
}

export interface EnqueueWriteInput {
  /** = deliveryId. 호출부가 선발급한다(봉투에 이미 실려 서명·헤더와 일치해야 하므로). */
  id: string;
  targetId: string;
  targetName: string;
  chatbotId: string | null;
  triggerKind: WorkflowTriggerKind;
  eventType: WorkflowEventType;
  actionKey?: string | null;
  nodeId?: string | null;
  outputIndex?: number | null;
  subscriptionId?: string | null;
  messageId?: string | null;
  sourceRefId?: string | null;
  dedupeKey?: string | null;
  sessionRef?: string | null;
  servedVersionId?: string | null;
  status: WorkflowRunStatus;
  statusReason?: WorkflowStatusReason | null;
  holdReason?: WorkflowHoldReason | null;
  heldAt?: Date | null;
  nextAttemptAt?: Date | null;
  personalDataMasked: boolean;
  fieldNames: string[];
  /** 있으면 봉인해서 저장한다(§10.1) — `PENDING`/`HELD` 적재에만 존재한다. */
  payloadJson?: string | null;
  now: Date;
}

/**
 * ★ 발송함 적재(`workflowRun.create`) 유일 파일(No.41, §6.1·§10.1 · W-3). `sealField('WORKFLOW_PAYLOAD'`
 * 호출도 이 파일에만 있다. `id`(= deliveryId)를 앱이 선발급해 AAD·서명·멱등키에 일관되게 쓴다.
 * 유일 제약(`dedupeKey`) 위반은 "이미 적재됨"으로 조용히 흡수한다(리플레이 무시).
 */
@Injectable()
export class WorkflowRunEnqueueWriter {
  private readonly logger = new Logger('WorkflowRunEnqueueWriter');

  constructor(private readonly prisma: PrismaService) {}

  async enqueue(input: EnqueueWriteInput): Promise<{ created: boolean; id: string }> {
    const id = input.id;
    const payload = input.payloadJson ? sealField('WORKFLOW_PAYLOAD', id, input.payloadJson) : null;

    try {
      await this.prisma.workflowRun.create({
        data: {
          id,
          targetId: input.targetId,
          targetName: input.targetName,
          chatbotId: input.chatbotId,
          triggerKind: input.triggerKind,
          eventType: input.eventType,
          actionKey: input.actionKey ?? null,
          nodeId: input.nodeId ?? null,
          outputIndex: input.outputIndex ?? null,
          subscriptionId: input.subscriptionId ?? null,
          messageId: input.messageId ?? null,
          sourceRefId: input.sourceRefId ?? null,
          dedupeKey: input.dedupeKey ?? null,
          sessionRef: input.sessionRef ?? null,
          servedVersionId: input.servedVersionId ?? null,
          status: input.status,
          statusReason: input.statusReason ?? null,
          holdReason: input.holdReason ?? null,
          heldAt: input.heldAt ?? null,
          nextAttemptAt: input.nextAttemptAt ?? null,
          personalDataMasked: input.personalDataMasked,
          fieldNames: JSON.stringify(input.fieldNames),
          payload,
          payloadBytes: payload !== null ? Buffer.byteLength(input.payloadJson as string, 'utf8') : null,
          dayBucket: toKstDayBucket(input.now),
          createdAt: input.now,
        },
      });
      return { created: true, id };
    } catch (e) {
      if (isUniqueConstraintViolation(e)) return { created: false, id };
      this.logger.warn(`워크플로우 발송함 적재 실패: targetId=${input.targetId} eventType=${input.eventType}`);
      throw e;
    }
  }

  /** 테스트 발송(§13.5) — 동기 1회 완결 · 본문 비저장 · 종단 상태로 즉시 생성한다. */
  async createTerminal(input: {
    id: string;
    targetId: string;
    targetName: string;
    actionKey: string;
    fieldNames: string[];
    outcome: WorkflowOutcome | null;
    httpStatus: number | null;
    latencyMs: number;
    now: Date;
  }): Promise<string> {
    const id = input.id;
    await this.prisma.workflowRun.create({
      data: {
        id,
        targetId: input.targetId,
        targetName: input.targetName,
        chatbotId: null,
        triggerKind: 'TEST',
        eventType: 'TEST',
        actionKey: input.actionKey,
        personalDataMasked: false,
        fieldNames: JSON.stringify(input.fieldNames),
        status: input.outcome === 'SUCCESS' ? 'SUCCEEDED' : 'FAILED',
        statusReason: input.outcome === 'SUCCESS' ? null : 'PERMANENT_ERROR',
        lastOutcome: input.outcome,
        lastHttpStatus: input.httpStatus,
        lastLatencyMs: input.latencyMs,
        attemptCount: 1,
        lastAttemptAt: input.now,
        completedAt: input.now,
        deliveryLatencyMs: input.latencyMs,
        dayBucket: toKstDayBucket(input.now),
        createdAt: input.now,
      },
    });
    return id;
  }
}
