import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiConnection,
  ApiConnectionListItem,
  ApiConnectionSamplesResponse,
  ApiConnectionTestRequestDto,
  ApiConnectionTestResult,
  CreateApiConnectionDto,
  UpdateApiConnectionDto,
  normalizeText,
} from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/api.exception';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { ReferenceCheckService } from '../dialogue-common/reference-check.service';
import { LegacyApiService } from '../legacy-api/legacy-api.service';
import { ApiCallLogService } from '../legacy-api/api-call-log.service';
import { resolveDefaultRateLimit } from './catalog/lib/connection-rules';
import { parseSamples, toApiConnectionAuditSnapshot, toApiConnectionDto, toApiConnectionListItemDto } from './api-connection.mapper';

const NOT_FOUND_MESSAGE = '요청하신 API 연결을 찾을 수 없습니다.';

@Injectable()
export class ApiConnectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly auditLogService: AuditLogService,
    private readonly referenceCheck: ReferenceCheckService,
    private readonly legacyApiService: LegacyApiService,
    private readonly callLogService: ApiCallLogService,
  ) {}

  private async findRowOrThrow(id: string) {
    const row = await this.prisma.apiConnection.findUnique({ where: { id } });
    if (!row) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);
    return row;
  }

  /** API_CONDITION 아웃풋을 가진 노드만 걸러내는 DB 단 사전 필터(M-1) — 대부분의 노드는 이 리터럴을
   * 포함하지 않으므로 JSON 파싱 대상을 크게 줄인다. 정확한 판정(v2 + connectionId 일치)은
   * 파싱 이후에 한다(부분 문자열 오탐 배제). */
  private static readonly API_CONDITION_MARKER = '"type":"API_CONDITION"';

  /** [No.26 M-1] 단건 참조 노드 수 — `contains: connectionId`로 후보를 먼저 거른다(§14 성능 목표). */
  private async countReferencingNodes(connectionId: string): Promise<number> {
    const nodes = await this.prisma.dialogNode.findMany({ where: { outputs: { contains: connectionId } }, select: { outputs: true } });
    let count = 0;
    for (const n of nodes) {
      try {
        const outputs = JSON.parse(n.outputs) as Array<{ type: string; payload?: { version?: number; connectionId?: string } }>;
        if (outputs.some((o) => o.type === 'API_CONDITION' && o.payload?.version === 2 && o.payload?.connectionId === connectionId)) count += 1;
      } catch {
        // 무시
      }
    }
    return count;
  }

  /**
   * [No.26 M-1] `list()` 전용 — API_CONDITION을 가진 노드를 **1회만** 조회해 `connectionId → count`
   * 맵을 만든다(N+1 제거). 연결마다 반복 쿼리하지 않는다.
   */
  private async countReferencingNodesMap(): Promise<Map<string, number>> {
    const nodes = await this.prisma.dialogNode.findMany({
      where: { outputs: { contains: ApiConnectionsService.API_CONDITION_MARKER } },
      select: { outputs: true },
    });
    const map = new Map<string, number>();
    for (const n of nodes) {
      try {
        const outputs = JSON.parse(n.outputs) as Array<{ type: string; payload?: { version?: number; connectionId?: string } }>;
        for (const o of outputs) {
          if (o.type === 'API_CONDITION' && o.payload?.version === 2 && o.payload?.connectionId) {
            map.set(o.payload.connectionId, (map.get(o.payload.connectionId) ?? 0) + 1);
          }
        }
      } catch {
        // 무시
      }
    }
    return map;
  }

  private async buildExtras(row: { id: string; authType: string; secretRef: string | null }, referencingNodeCountOverride?: number) {
    const [referencingNodeCount, stats24h] = await Promise.all([
      referencingNodeCountOverride !== undefined ? Promise.resolve(referencingNodeCountOverride) : this.countReferencingNodes(row.id),
      this.callLogService.stats24h(row.id),
    ]);
    return {
      secretStatus: this.legacyApiService.secretStatus(row.authType as never, row.secretRef),
      circuitOpen: this.legacyApiService.isCircuitOpen(row.id),
      referencingNodeCount,
      stats24h,
    };
  }

  async list(): Promise<{ items: ApiConnectionListItem[] }> {
    const rows = await this.prisma.apiConnection.findMany({ orderBy: { name: 'asc' }, take: 200 });
    const referencingCounts = await this.countReferencingNodesMap();
    const items = await Promise.all(
      rows.map(async (row) => toApiConnectionListItemDto(row, await this.buildExtras(row, referencingCounts.get(row.id) ?? 0))),
    );
    return { items };
  }

  async findOne(id: string): Promise<ApiConnection> {
    const row = await this.findRowOrThrow(id);
    return toApiConnectionDto(row, await this.buildExtras(row));
  }

  async samples(id: string): Promise<ApiConnectionSamplesResponse> {
    const row = await this.findRowOrThrow(id);
    return { items: parseSamples(row.sampleResponses) };
  }

  private assertConfirmRawPersonalData(name: string, wantsRaw: boolean, confirm?: string): void {
    if (wantsRaw && confirm !== name) {
      throw new ApiException('CONFIRM_NAME_MISMATCH', 400, '원문 송신을 켜려면 연결 이름을 다시 입력해 확인해야 합니다.');
    }
  }

  async create(dto: CreateApiConnectionDto): Promise<ApiConnection> {
    const name = dto.name.trim();
    const nameNormalized = normalizeText(name);
    const existing = await this.prisma.apiConnection.findUnique({ where: { nameNormalized } });
    if (existing) throw new ApiException('DUPLICATE_NAME', 409, '이미 같은 이름의 연결이 있습니다.');

    this.assertConfirmRawPersonalData(name, dto.allowRawPersonalData, dto.confirmRawPersonalData);

    const defaultTimeout = this.config.get<number>('LEGACY_API_DEFAULT_TIMEOUT_MS') ?? 3000;
    const rateLimitPerMin = dto.rateLimitPerMin ?? resolveDefaultRateLimit(dto.personalDataLookup);

    const row = await this.prisma.apiConnection.create({
      data: {
        name,
        nameNormalized,
        description: dto.description,
        baseUrl: dto.baseUrl,
        allowedMethods: JSON.stringify(dto.allowedMethods),
        authType: dto.authType,
        authHeaderName: dto.authHeaderName,
        secretRef: dto.secretRef,
        timeoutMs: dto.timeoutMs ?? defaultTimeout,
        rateLimitPerMin,
        allowRawPersonalData: dto.allowRawPersonalData,
        personalDataLookup: dto.personalDataLookup,
        sampleResponses: JSON.stringify(dto.sampleResponses),
        enabled: dto.enabled,
      },
    });

    await this.auditLogService.record({
      action: 'CREATE',
      targetType: 'ApiConnection',
      targetId: row.id,
      targetName: row.name,
      after: toApiConnectionAuditSnapshot(row),
    });

    return toApiConnectionDto(row, await this.buildExtras(row));
  }

  async update(id: string, dto: UpdateApiConnectionDto): Promise<ApiConnection> {
    const current = await this.findRowOrThrow(id);

    let name = current.name;
    let nameNormalized = current.nameNormalized;
    if (dto.name !== undefined) {
      name = dto.name.trim();
      nameNormalized = normalizeText(name);
      const dup = await this.prisma.apiConnection.findFirst({ where: { nameNormalized, id: { not: id } } });
      if (dup) throw new ApiException('DUPLICATE_NAME', 409, '이미 같은 이름의 연결이 있습니다.');
    }

    const nextAllowRaw = dto.allowRawPersonalData ?? current.allowRawPersonalData;
    if (dto.allowRawPersonalData === true && !current.allowRawPersonalData) {
      this.assertConfirmRawPersonalData(name, true, dto.confirmRawPersonalData);
    }

    const row = await this.prisma.apiConnection.update({
      where: { id },
      data: {
        name,
        nameNormalized,
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.baseUrl !== undefined ? { baseUrl: dto.baseUrl } : {}),
        ...(dto.allowedMethods !== undefined ? { allowedMethods: JSON.stringify(dto.allowedMethods) } : {}),
        ...(dto.authType !== undefined ? { authType: dto.authType } : {}),
        ...(dto.authHeaderName !== undefined ? { authHeaderName: dto.authHeaderName } : {}),
        ...(dto.secretRef !== undefined ? { secretRef: dto.secretRef } : {}),
        ...(dto.timeoutMs !== undefined ? { timeoutMs: dto.timeoutMs } : {}),
        ...(dto.rateLimitPerMin !== undefined ? { rateLimitPerMin: dto.rateLimitPerMin } : {}),
        allowRawPersonalData: nextAllowRaw,
        ...(dto.personalDataLookup !== undefined ? { personalDataLookup: dto.personalDataLookup } : {}),
        ...(dto.sampleResponses !== undefined ? { sampleResponses: JSON.stringify(dto.sampleResponses) } : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
      },
    });

    await this.auditLogService.record({
      action: 'UPDATE',
      targetType: 'ApiConnection',
      targetId: row.id,
      targetName: row.name,
      before: toApiConnectionAuditSnapshot(current),
      after: toApiConnectionAuditSnapshot(row),
      summary: this.buildUpdateSummary(current, row),
    });

    return toApiConnectionDto(row, await this.buildExtras(row));
  }

  private buildUpdateSummary(before: { allowRawPersonalData: boolean; enabled: boolean }, after: { allowRawPersonalData: boolean; enabled: boolean }): string | undefined {
    const parts: string[] = [];
    if (!before.allowRawPersonalData && after.allowRawPersonalData) parts.push('원문 송신 허용으로 전환');
    if (before.allowRawPersonalData && !after.allowRawPersonalData) parts.push('원문 송신 해제');
    if (before.enabled && !after.enabled) parts.push('사용 중지로 전환');
    if (!before.enabled && after.enabled) parts.push('사용 재개');
    return parts.length > 0 ? parts.join(', ') : undefined;
  }

  async remove(id: string): Promise<void> {
    const current = await this.findRowOrThrow(id);
    await this.referenceCheck.assertApiConnectionDeletable(id);
    await this.prisma.apiConnection.delete({ where: { id } });

    await this.auditLogService.record({
      action: 'DELETE',
      targetType: 'ApiConnection',
      targetId: current.id,
      targetName: current.name,
      before: toApiConnectionAuditSnapshot(current),
    });
  }

  async test(id: string, dto: ApiConnectionTestRequestDto): Promise<ApiConnectionTestResult> {
    return this.legacyApiService.testConnection(id, dto.path);
  }
}
