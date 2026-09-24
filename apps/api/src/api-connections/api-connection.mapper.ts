import type { ApiConnection as PrismaApiConnection } from '@prisma/client';
import type { ApiConnection, ApiConnectionAuthType, ApiConnectionListItem, ApiHttpMethod, ApiSampleResponse, ApiSecretStatus } from '@chat-bot/shared-types';
import { extractHost, isInsecureHttp } from './catalog/lib/connection-rules';

export function parseMethods(json: string): ApiHttpMethod[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as ApiHttpMethod[]) : ['GET'];
  } catch {
    return ['GET'];
  }
}

export function parseSamples(json: string): ApiSampleResponse[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as ApiSampleResponse[]) : [];
  } catch {
    return [];
  }
}

export interface ConnectionMapperExtras {
  secretStatus: ApiSecretStatus;
  circuitOpen: boolean;
  referencingNodeCount: number;
  stats24h: { calls: number; failures: number };
}

/** [No.26] Prisma row → 관리 응답 DTO. 시크릿 **값** 필드는 존재하지 않는다(L-10). */
export function toApiConnectionDto(row: PrismaApiConnection, extras: ConnectionMapperExtras): ApiConnection {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    baseUrl: row.baseUrl,
    allowedMethods: parseMethods(row.allowedMethods),
    authType: row.authType as ApiConnectionAuthType,
    authHeaderName: row.authHeaderName,
    secretRef: row.secretRef,
    timeoutMs: row.timeoutMs,
    rateLimitPerMin: row.rateLimitPerMin,
    allowRawPersonalData: row.allowRawPersonalData,
    personalDataLookup: row.personalDataLookup,
    sampleResponses: parseSamples(row.sampleResponses),
    enabled: row.enabled,
    secretStatus: extras.secretStatus,
    insecureHttp: isInsecureHttp(row.baseUrl),
    circuitOpen: extras.circuitOpen,
    referencingNodeCount: extras.referencingNodeCount,
    stats24h: extras.stats24h,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** 목록 항목 — `sampleResponses` 본문 대신 `sampleCount`만(대량 필드 절감). */
export function toApiConnectionListItemDto(row: PrismaApiConnection, extras: ConnectionMapperExtras): ApiConnectionListItem {
  const full = toApiConnectionDto(row, extras);
  const { sampleResponses: _omit, ...rest } = full;
  return { ...rest, sampleCount: parseSamples(row.sampleResponses).length, baseUrlHost: extractHost(row.baseUrl) };
}

/** 감사 스냅샷(§11) — `secretRef`는 이름, `baseUrl`은 호스트만, 샘플은 개수만. */
export function toApiConnectionAuditSnapshot(row: PrismaApiConnection): Record<string, unknown> {
  return {
    name: row.name,
    baseUrlHost: extractHost(row.baseUrl),
    allowedMethods: parseMethods(row.allowedMethods),
    authType: row.authType,
    secretRef: row.secretRef,
    timeoutMs: row.timeoutMs,
    rateLimitPerMin: row.rateLimitPerMin,
    allowRawPersonalData: row.allowRawPersonalData,
    personalDataLookup: row.personalDataLookup,
    enabled: row.enabled,
    sampleCount: parseSamples(row.sampleResponses).length,
  };
}
