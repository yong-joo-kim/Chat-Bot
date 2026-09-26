import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { normalizeText } from '@chat-bot/shared-types';
import type { CreateWorkflowTargetDto, UpdateWorkflowTargetDto, WorkflowTarget } from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiException } from '../../common/api.exception';
import { checkEgress } from '../../common/egress/egress-guard';
import { AuditLogService } from '../../audit-logs/audit-log.service';
import { ReferenceCheckService } from '../../dialogue-common/reference-check.service';
import { WorkflowSecretResolver } from '../secrets/workflow-secret.resolver';
import { WorkflowCatalogService } from '../catalog/workflow-catalog.service';
import { WorkflowRunStore } from '../core/workflow-run.store';
import { workflowHoldMaxMs } from '../lib/hold-max';
import { toWorkflowTargetResponse } from './workflow-target.mapper';
import type { WorkflowTargetRow } from './workflow-target.mapper';

const NOT_FOUND_MESSAGE = '요청하신 발송 대상을 찾을 수 없습니다.';

@Injectable()
export class WorkflowTargetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly auditLogService: AuditLogService,
    private readonly referenceCheck: ReferenceCheckService,
    private readonly secretResolver: WorkflowSecretResolver,
    private readonly catalog: WorkflowCatalogService,
    private readonly store: WorkflowRunStore,
  ) {}

  private assertConfirmRawPersonalData(name: string, wantsRaw: boolean, confirm?: string): void {
    if (wantsRaw && confirm !== name) {
      throw new ApiException('CONFIRM_NAME_MISMATCH', 400, '원문 송신을 켜려면 대상 이름을 다시 입력해 확인해야 합니다.');
    }
  }

  private assertEgressAllowedForSave(baseUrl: string): void {
    if (checkEgress('WORKFLOW_WEBHOOK', baseUrl) === 'BLOCKED') {
      throw new ApiException(
        'EGRESS_HOST_NOT_ALLOWED',
        400,
        '외부 전송 허용 목록에 없는 호스트입니다(서버 설정 필요).',
        [{ field: 'baseUrl', message: '허용 목록(DATA_EGRESS_ALLOWED_HOSTS)에 이 호스트를 추가해야 합니다.' }],
      );
    }
  }

  /**
   * [코드 리뷰 R1 M-1] 저장 시 호스트 검사(§9.5) — `http:` 스킴인데 `WORKFLOW_ALLOW_HTTP=false`면
   * 발송기까지 가지 않고 저장 단계에서 막는다(생성·수정 공통). 발송기(`workflow-http.sender.ts`)의
   * 같은 조건(`allowHttp`)과 이중 방어 — 저장 뒤 환경변수가 바뀌는 경우는 발송기가 여전히 막는다.
   */
  private assertHttpSchemeAllowedForSave(baseUrl: string): void {
    let scheme: string;
    try {
      scheme = new URL(baseUrl).protocol;
    } catch {
      return; // 형식 오류는 zod 스키마가 이미 막는다(방어적 반환).
    }
    const allowHttp = this.config.get<boolean>('WORKFLOW_ALLOW_HTTP') ?? false;
    if (scheme === 'http:' && !allowHttp) {
      throw new ApiException(
        'VALIDATION_FAILED',
        400,
        'http 주소는 허용되지 않습니다(서버 설정 WORKFLOW_ALLOW_HTTP=true가 필요합니다).',
        [{ field: 'baseUrl', message: 'https 주소를 입력하거나 서버에 WORKFLOW_ALLOW_HTTP를 켜야 합니다.' }],
      );
    }
  }

  private async findRowOrThrow(id: string): Promise<WorkflowTargetRow> {
    const row = await this.prisma.workflowTarget.findUnique({ where: { id } });
    if (!row) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);
    return row;
  }

  private async buildCounters(id: string) {
    const since24h = new Date(Date.now() - 24 * 60 * 60_000);
    const [referencingNodeCount, subscriptionCount, succeeded24h, failed24h, pendingCount, heldCount, failedRetainedCount] = await Promise.all([
      this.countReferencingNodes(id),
      this.prisma.workflowSubscription.count({ where: { targetId: id } }),
      this.prisma.workflowRun.count({ where: { targetId: id, status: 'SUCCEEDED', completedAt: { gte: since24h } } }),
      this.prisma.workflowRun.count({ where: { targetId: id, status: 'FAILED', completedAt: { gte: since24h } } }),
      this.prisma.workflowRun.count({ where: { targetId: id, status: 'PENDING' } }),
      this.prisma.workflowRun.count({ where: { targetId: id, status: 'HELD' } }),
      this.prisma.workflowRun.count({ where: { targetId: id, status: 'FAILED', payloadPurgedAt: null } }),
    ]);
    return { referencingNodeCount, subscriptionCount, succeeded24h, failed24h, pendingCount, heldCount, failedRetainedCount };
  }

  private async countReferencingNodes(targetId: string): Promise<number> {
    const candidates = await this.prisma.dialogNode.findMany({ where: { outputs: { contains: targetId } }, select: { outputs: true } });
    let count = 0;
    for (const c of candidates) {
      try {
        const outputs = JSON.parse(c.outputs) as Array<{ type: string; payload?: { targetId?: string } }>;
        if (outputs.some((o) => o.type === 'WORKFLOW' && o.payload?.targetId === targetId)) count += 1;
      } catch {
        // 무시
      }
    }
    return count;
  }

  async list(): Promise<{ items: WorkflowTarget[] }> {
    const rows = await this.prisma.workflowTarget.findMany({ orderBy: { name: 'asc' }, take: 200 });
    const items = await Promise.all(rows.map(async (row) => toWorkflowTargetResponse(row, this.secretResolver, await this.buildCounters(row.id))));
    return { items };
  }

  async findOne(id: string): Promise<WorkflowTarget> {
    const row = await this.findRowOrThrow(id);
    return toWorkflowTargetResponse(row, this.secretResolver, await this.buildCounters(id));
  }

  async create(dto: CreateWorkflowTargetDto): Promise<WorkflowTarget> {
    const name = dto.name.trim();
    const nameNormalized = normalizeText(name);
    const existing = await this.prisma.workflowTarget.findUnique({ where: { nameNormalized } });
    if (existing) throw new ApiException('DUPLICATE_NAME', 409, '이미 같은 이름의 발송 대상이 있습니다.');

    this.assertConfirmRawPersonalData(name, dto.allowRawPersonalData, dto.confirmRawPersonalData);
    this.assertHttpSchemeAllowedForSave(dto.baseUrl);
    this.assertEgressAllowedForSave(dto.baseUrl);

    const row = await this.prisma.workflowTarget.create({
      data: {
        name,
        nameNormalized,
        description: dto.description,
        baseUrl: dto.baseUrl,
        authType: dto.authType,
        authHeaderName: dto.authHeaderName,
        secretRef: dto.secretRef,
        signingEnabled: dto.signingEnabled,
        signingSecretRef: dto.signingSecretRef,
        urlSecretRef: dto.urlSecretRef,
        timeoutMs: dto.timeoutMs,
        maxAttempts: dto.maxAttempts,
        allowRawPersonalData: dto.allowRawPersonalData,
        enabled: dto.enabled,
      },
    });

    await this.auditLogService.record({ action: 'CREATE', targetType: 'WorkflowTarget', targetId: row.id, targetName: row.name, after: toAuditSnapshot(row) });
    this.catalog.invalidateSubscriptionCache();
    return toWorkflowTargetResponse(row, this.secretResolver, await this.buildCounters(row.id));
  }

  async update(id: string, dto: UpdateWorkflowTargetDto): Promise<WorkflowTarget> {
    const current = await this.findRowOrThrow(id);

    let name = current.name;
    let nameNormalized = current.nameNormalized;
    if (dto.name !== undefined) {
      name = dto.name.trim();
      nameNormalized = normalizeText(name);
      const dup = await this.prisma.workflowTarget.findFirst({ where: { nameNormalized, id: { not: id } } });
      if (dup) throw new ApiException('DUPLICATE_NAME', 409, '이미 같은 이름의 발송 대상이 있습니다.');
    }

    const nextAllowRaw = dto.allowRawPersonalData ?? current.allowRawPersonalData;
    if (dto.allowRawPersonalData === true && !current.allowRawPersonalData) {
      this.assertConfirmRawPersonalData(name, true, dto.confirmRawPersonalData);
    }
    if (dto.baseUrl !== undefined) {
      this.assertHttpSchemeAllowedForSave(dto.baseUrl);
      this.assertEgressAllowedForSave(dto.baseUrl);
    }

    const row = await this.prisma.workflowTarget.update({
      where: { id },
      data: {
        name,
        nameNormalized,
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.baseUrl !== undefined ? { baseUrl: dto.baseUrl } : {}),
        ...(dto.authType !== undefined ? { authType: dto.authType } : {}),
        ...(dto.authHeaderName !== undefined ? { authHeaderName: dto.authHeaderName } : {}),
        ...(dto.secretRef !== undefined ? { secretRef: dto.secretRef } : {}),
        ...(dto.signingEnabled !== undefined ? { signingEnabled: dto.signingEnabled } : {}),
        ...(dto.signingSecretRef !== undefined ? { signingSecretRef: dto.signingSecretRef } : {}),
        ...(dto.urlSecretRef !== undefined ? { urlSecretRef: dto.urlSecretRef } : {}),
        ...(dto.timeoutMs !== undefined ? { timeoutMs: dto.timeoutMs } : {}),
        ...(dto.maxAttempts !== undefined ? { maxAttempts: dto.maxAttempts } : {}),
        allowRawPersonalData: nextAllowRaw,
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
      },
    });

    await this.auditLogService.record({
      action: 'UPDATE',
      targetType: 'WorkflowTarget',
      targetId: row.id,
      targetName: row.name,
      before: toAuditSnapshot(current),
      after: toAuditSnapshot(row),
    });
    this.catalog.invalidateSubscriptionCache();
    return toWorkflowTargetResponse(row, this.secretResolver, await this.buildCounters(id));
  }

  async remove(id: string): Promise<void> {
    const current = await this.findRowOrThrow(id);
    await this.referenceCheck.assertWorkflowTargetDeletable(id);

    await this.prisma.$transaction(async (tx) => {
      await this.store.cancelForTargetDeletion(tx, id, new Date());
      await tx.workflowTarget.delete({ where: { id } });
    });

    await this.auditLogService.record({ action: 'DELETE', targetType: 'WorkflowTarget', targetId: id, targetName: current.name, before: toAuditSnapshot(current) });
    this.catalog.invalidateSubscriptionCache();
  }

  async pause(id: string): Promise<WorkflowTarget> {
    const current = await this.findRowOrThrow(id);
    const ok = await this.store.pauseTarget(id, new Date());
    if (ok) await this.auditLogService.record({ action: 'STATUS_CHANGE', targetType: 'WorkflowTarget', targetId: id, targetName: current.name, summary: '일시 정지' });
    return this.findOne(id);
  }

  async resume(id: string): Promise<WorkflowTarget> {
    const current = await this.findRowOrThrow(id);
    const { resumed, expired } = await this.store.resumeTarget(id, new Date(), workflowHoldMaxMs(this.config));
    await this.auditLogService.record({
      action: 'STATUS_CHANGE',
      targetType: 'WorkflowTarget',
      targetId: id,
      targetName: current.name,
      summary: `재개(발송 ${resumed} · 만료 ${expired})`,
    });
    return this.findOne(id);
  }
}

function toAuditSnapshot(row: WorkflowTargetRow) {
  return {
    name: row.name,
    description: row.description,
    baseUrl: row.baseUrl,
    authType: row.authType,
    authHeaderName: row.authHeaderName,
    secretRef: row.secretRef,
    signingEnabled: row.signingEnabled,
    signingSecretRef: row.signingSecretRef,
    urlSecretRef: row.urlSecretRef,
    timeoutMs: row.timeoutMs,
    maxAttempts: row.maxAttempts,
    allowRawPersonalData: row.allowRawPersonalData,
    enabled: row.enabled,
  };
}
