import { Injectable, Logger } from '@nestjs/common';
import type { ApiConnection as PrismaApiConnection } from '@prisma/client';
import type { ApiConnectionPickerItem, ApiHttpMethod, ApiSampleResponse } from '@chat-bot/shared-types';
import type { DesignValidationApiConnectionInfo } from '@chat-bot/dialogue-engine';
import { PrismaService } from '../../prisma/prisma.service';
import { isInsecureHttp } from './lib/connection-rules';

const logger = new Logger('ApiConnectionCatalogService');

export interface ConnectionForCall {
  id: string;
  name: string;
  baseUrl: string;
  allowedMethods: ApiHttpMethod[];
  authType: PrismaApiConnection['authType'];
  authHeaderName: string | null;
  secretRef: string | null;
  timeoutMs: number;
  rateLimitPerMin: number;
  allowRawPersonalData: boolean;
  enabled: boolean;
}

export interface MockSource {
  name: string;
  enabled: boolean;
  samples: ApiSampleResponse[];
}

function parseMethods(json: string): ApiHttpMethod[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as ApiHttpMethod[]) : ['GET'];
  } catch {
    return ['GET'];
  }
}

function parseSamples(json: string, connectionId: string): ApiSampleResponse[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as ApiSampleResponse[]) : [];
  } catch {
    logger.warn(`sampleResponses 파싱 실패(connectionId=${connectionId}) — 기본값([])으로 폴백`);
    return [];
  }
}

/**
 * [No.26] 읽기 전용 카탈로그(NFR-LM1·L-11) — Prisma read만, 외부 출구(`legacy-api/**`) import 0건.
 * TC·비교·시뮬레이터 목 경로가 외부 출구를 DI 그래프에 들이지 않고도 연결 정보를 읽을 수 있게 한다
 * (FR-0-102).
 */
@Injectable()
export class ApiConnectionCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  /** 실제/연결테스트 호출용 — `LegacyApiService`·연결 테스트 전용. 캐시하지 않는다(§21 D-15). */
  async findForCall(id: string): Promise<ConnectionForCall | null> {
    const row = await this.prisma.apiConnection.findUnique({ where: { id } });
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      baseUrl: row.baseUrl,
      allowedMethods: parseMethods(row.allowedMethods),
      authType: row.authType,
      authHeaderName: row.authHeaderName,
      secretRef: row.secretRef,
      timeoutMs: row.timeoutMs,
      rateLimitPerMin: row.rateLimitPerMin,
      allowRawPersonalData: row.allowRawPersonalData,
      enabled: row.enabled,
    };
  }

  /** 시뮬레이터 MOCK·비교·TC 실행용 — 연결별 샘플 응답만 읽는다(실행당 1회 로드 — N+1 금지). */
  async loadMockSources(ids: readonly string[]): Promise<Map<string, MockSource>> {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) return new Map();
    const rows = await this.prisma.apiConnection.findMany({ where: { id: { in: uniqueIds } } });
    const map = new Map<string, MockSource>();
    for (const row of rows) {
      map.set(row.id, { name: row.name, enabled: row.enabled, samples: parseSamples(row.sampleResponses, row.id) });
    }
    return map;
  }

  /**
   * 설계 점검 컨텍스트(§5.9 ⑧~⑪) — `DialogNodesService.validate()`가 1회 조회해 엔진에 주입한다.
   * ⚠ `secretStatus`는 저장된 `secretRef` 유무로만 근사한다(`CONFIGURED`|`NOT_REQUIRED`) — 실제
   * 환경변수 존재 여부까지 정확히 반영하려면 `legacy-api/**`를 가져와야 하는데 L-11이 이를 금지한다.
   * 정확한 상태가 필요한 관리 화면(`ApiConnectionsService`)은 `LegacyApiService.secretStatus()`를 쓴다.
   */
  async designInfo(connectionIds: readonly string[]): Promise<ReadonlyMap<string, DesignValidationApiConnectionInfo>> {
    const uniqueIds = [...new Set(connectionIds)];
    if (uniqueIds.length === 0) return new Map();
    const rows = await this.prisma.apiConnection.findMany({ where: { id: { in: uniqueIds } } });
    const map = new Map<string, DesignValidationApiConnectionInfo>();
    for (const row of rows) {
      map.set(row.id, {
        name: row.name,
        enabled: row.enabled,
        secretStatus: row.authType === 'NONE' ? 'NOT_REQUIRED' : row.secretRef ? 'CONFIGURED' : 'MISSING',
        insecureHttp: isInsecureHttp(row.baseUrl),
        personalDataLookup: row.personalDataLookup,
        allowRawPersonalData: row.allowRawPersonalData,
        allowedMethods: parseMethods(row.allowedMethods),
      });
    }
    return map;
  }

  /** 편집기 선택 목록(`dialogue:read`) — `baseUrl`·`secretRef`·`authType` 미포함(FR-L2-1). */
  async pickerItems(): Promise<ApiConnectionPickerItem[]> {
    const rows = await this.prisma.apiConnection.findMany({ orderBy: { name: 'asc' } });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      allowedMethods: parseMethods(row.allowedMethods),
      enabled: row.enabled,
      personalDataLookup: row.personalDataLookup,
      allowRawPersonalData: row.allowRawPersonalData,
      sampleLabels: parseSamples(row.sampleResponses, row.id).map((s) => s.label),
    }));
  }
}
