import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { normalizeText } from '@chat-bot/shared-types';
import type { KbSourceCreateDto, KbSourceResponse, KbSourceUpdateDto } from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/api.exception';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { checkEgress } from '../common/egress/egress-guard';
import { classifyAddress, isAddressAllowlisted, isHostnameAllowlisted, parseAllowlist } from '../legacy-api/lib/ip-policy';
import type { LegacyDnsResolver } from '../legacy-api/transport/legacy-transport.port';
import { KB_DNS_RESOLVER } from '../kb-sync/crawl/kb-crawl-http.fetcher';
import { KbRunStore } from './core/kb-run.store';
import type { KbRunCancelCode } from './core/kb-run.store';
import { governanceViolation, governanceViolationField, governanceViolationMessage } from './lib/governance-flags';
import type { GovernanceViolation } from './lib/governance-flags';
import { toKbSourceResponse } from './kb-source.mapper';
import { KB_SYNC_LIMITS } from '@chat-bot/shared-types';
import { computeScopeWarnings } from './lib/scope-warnings';
import { buildRunView } from './lib/build-run-view';
import { isPreviewConfigStale } from './lib/preview-stale';
import { detectConfigChange } from './lib/config-change';
import { isWithinBulkWindow } from './lib/ingest-lane';
import type { KbConfigSnapshot } from './lib/config-change';

/** 종결·해제 트랜잭션 옵션 — 대량 실행의 작업 정리가 기본 5초를 넘길 수 있고, SQLite 단일 연결이라 시작 대기도 넉넉히 둔다. */
const TX_OPTIONS = { maxWait: 10_000, timeout: 60_000 } as const;
const TERMINAL_RUN_STATUSES: ReadonlySet<string> = new Set(['SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED']);

/**
 * ★ `KbSource` 쓰기 유일 파일(No.43, KB-9). 저장 시 호스트 판정(SSRF·거버넌스 허용 목록)·스코프
 * 3단·권리 확인을 검증한다(§6.2).
 */
@Injectable()
export class KbSourcesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly auditLogService: AuditLogService,
    private readonly store: KbRunStore,
    @Inject(KB_DNS_RESOLVER) private readonly dnsResolver: LegacyDnsResolver,
  ) {}

  private async findRowOrThrow(id: string) {
    const row = await this.prisma.kbSource.findUnique({ where: { id } });
    if (!row) throw new ApiException('NOT_FOUND', 404, '요청하신 지식베이스 소스를 찾을 수 없습니다.');
    return row;
  }

  private async validateHost(hostname: string): Promise<void> {
    if (this.config.get<string>('DATA_GOVERNANCE_MODE') === 'ON' || (this.config.get<string>('DATA_EGRESS_ALLOWED_HOSTS') ?? '').length > 0) {
      if (checkEgress('KB_CRAWL', `https://${hostname}/`) === 'BLOCKED') {
        throw new ApiException('EGRESS_HOST_NOT_ALLOWED', 400, '출구 허용 목록에 없는 호스트입니다(서버 설정 필요).', [{ field: 'seedUrls', message: hostname }]);
      }
    }
    const isLiteral = isIP(hostname) !== 0;
    const addresses = isLiteral ? [hostname] : await this.dnsResolver.lookupAll(hostname);
    if (addresses.length === 0) {
      throw new ApiException('KB_HOST_NOT_ALLOWED', 400, '호스트 이름을 확인할 수 없습니다.', [{ field: 'seedUrls', message: 'DNS_FAILED' }]);
    }
    const allowlist = parseAllowlist(this.config.get<string>('KB_CRAWL_PRIVATE_ALLOWLIST') ?? '', 'KB_CRAWL_PRIVATE_ALLOWLIST');
    const hostnameAllowlisted = !isLiteral && isHostnameAllowlisted(hostname, allowlist);
    for (const addr of addresses) {
      const cls = classifyAddress(addr);
      if (cls === 'ABSOLUTE_BLOCKED') {
        throw new ApiException('KB_HOST_NOT_ALLOWED', 400, '접속할 수 없는 주소입니다.', [{ field: 'seedUrls', message: 'ABSOLUTE_BLOCKED' }]);
      }
      if (cls === 'PRIVATE' && !hostnameAllowlisted && !isAddressAllowlisted(addr, allowlist)) {
        throw new ApiException('KB_HOST_NOT_ALLOWED', 400, '사설망 주소는 서버 운영자가 허용 목록에 등록해야 합니다.', [{ field: 'seedUrls', message: 'PRIVATE_NOT_ALLOWLISTED' }]);
      }
    }
  }

  private deriveAllowedHosts(seedUrls: string[], sitemapUrls: string[]): string[] {
    const hosts = new Set<string>();
    for (const raw of [...seedUrls, ...sitemapUrls]) {
      try {
        hosts.add(new URL(raw).hostname.toLowerCase());
      } catch {
        // 형식 오류는 zod가 이미 막는다(방어적).
      }
    }
    return [...hosts];
  }

  private async assertValidHosts(hosts: readonly string[]): Promise<void> {
    for (const h of hosts) await this.validateHost(h);
  }

  /**
   * [신규 No.43 — 3차 보완 · 설계서 :1078] 저장(등록·수정) 응답 전용 — 목록·단건 조회에서는 부르지
   * 않는다(조회마다 비용을 들이지 않기 위해). 챗봇 매칭 규칙은 §11과 같다(회사 일치 ∧ 챗봇의
   * 카테고리·서브카테고리가 없거나 같음 — `kb-status.service.ts`의 `chatbotStatus()`와 동일 규칙).
   */
  private async scopeWarnings(row: { id: string; scopeCompany: string; scopeCategory: string; scopeSubcategory: string }) {
    const [sharedCount, matchingChatbotCount] = await Promise.all([
      this.prisma.kbSource.count({ where: { id: { not: row.id }, scopeCompany: row.scopeCompany, scopeCategory: row.scopeCategory, scopeSubcategory: row.scopeSubcategory } }),
      this.prisma.chatbotAnswerSetting.count({
        where: {
          ragCompany: row.scopeCompany,
          AND: [{ OR: [{ ragCategory: null }, { ragCategory: row.scopeCategory }] }, { OR: [{ ragSubcategory: null }, { ragSubcategory: row.scopeSubcategory }] }],
        },
      }),
    ]);
    return computeScopeWarnings({ sharedByOtherSource: sharedCount > 0, readByAnyChatbot: matchingChatbotCount > 0 });
  }

  private auditSnapshot(row: Record<string, unknown>): Record<string, unknown> {
    return {
      name: row.name,
      seedUrls: row.seedUrls,
      sitemapUrls: row.sitemapUrls,
      pathPrefixes: row.pathPrefixes,
      excludePatterns: row.excludePatterns,
      noisePatterns: row.noisePatterns,
      allowQueryUrls: row.allowQueryUrls,
      maxDepth: row.maxDepth,
      maxPages: row.maxPages,
      fileTypes: row.fileTypes,
      maxFileBytes: row.maxFileBytes,
      minIntervalMs: row.minIntervalMs,
      scopeCompany: row.scopeCompany,
      scopeCategory: row.scopeCategory,
      scopeSubcategory: row.scopeSubcategory,
      scheduleKind: row.scheduleKind,
      scheduleTime: row.scheduleTime,
      scheduleWeekday: row.scheduleWeekday,
      authKind: row.authKind,
      authHeaderName: row.authHeaderName,
      authSecretRef: row.authSecretRef,
      piiMask: row.piiMask,
      allowRawFileIngest: row.allowRawFileIngest,
      enabled: row.enabled,
      configVersion: row.configVersion,
    };
  }

  /**
   * 거버넌스 모드 ON의 개인정보 관련 저장 거부(§10 · AC-KB6-2·3) — 등록과 수정이 **같은 검사**를 쓴다
   * (예전에는 수정 경로에 이 검사가 없어 `PATCH { piiMask: false }`로 우회됐다). 넘긴 값만 검사한다 —
   * 수정에서 본문에 없는 필드는 "이번에 바꾸는 값"이 아니므로(거버넌스를 나중에 켠 기존 소스를 이름만 고치거나
   * 일시중지하는 것까지 막지 않는다) 검사하지 않는다.
   */
  private assertGovernanceFlags(flags: { piiMask?: boolean; allowRawFileIngest?: boolean }): void {
    if (this.config.get<string>('DATA_GOVERNANCE_MODE') !== 'ON') return;
    if (flags.piiMask === false) {
      throw new ApiException('VALIDATION_FAILED', 400, '거버넌스 모드에서는 개인정보 마스킹을 끌 수 없습니다.', [{ field: 'piiMask', message: 'GOVERNANCE_MASK_REQUIRED' }]);
    }
    if (flags.allowRawFileIngest === true && !(this.config.get<boolean>('KB_ALLOW_RAW_FILE_INGEST') ?? false)) {
      throw new ApiException('VALIDATION_FAILED', 400, '거버넌스 모드에서 원본 파일 전달을 켜려면 서버 설정(KB_ALLOW_RAW_FILE_INGEST)이 필요합니다.', [
        { field: 'allowRawFileIngest', message: 'GOVERNANCE_RAW_FILE_NOT_ALLOWED' },
      ]);
    }
  }

  /**
   * [pass 8 · PM 결정 2026-09-28] 이 소스의 **저장된** 값이 지금 거버넌스 규칙에 걸리는가 — `assertGovernanceFlags`와 같은 규칙(순수 판정은 `governance-flags.ts`)이지만 "이번에 바꾸는 값"이 아니라
   * 저장돼 있는 값을 본다. 모드를 켜기 전에 저장된 소스가 원문을 비마스킹으로 계속 적재하는 것을 실행 시작(`claimAndCreateRun`)·예약(`KbScheduler`)에서 막는 데 쓴다.
   */
  governanceViolationOf(source: { piiMask: boolean; allowRawFileIngest: boolean }): GovernanceViolation | null {
    return governanceViolation(
      { governanceOn: this.config.get<string>('DATA_GOVERNANCE_MODE') === 'ON', rawFileAllowedByServer: this.config.get<boolean>('KB_ALLOW_RAW_FILE_INGEST') ?? false },
      source,
    );
  }

  /** 서버 상한으로 잘라 낸 **저장될 값** — 등록과 수정이 같은 규칙을 쓴다(수정에는 상한이 없어 상한을 넘는 값이 그대로 저장됐다). */
  private clampLimits(v: { maxDepth?: number; maxPages?: number; maxFileBytes?: number; minIntervalMs?: number }): { maxDepth?: number; maxPages?: number; maxFileBytes?: number; minIntervalMs?: number } {
    return {
      ...(v.maxDepth !== undefined ? { maxDepth: Math.min(v.maxDepth, KB_SYNC_LIMITS.maxDepthMax) } : {}),
      ...(v.maxPages !== undefined ? { maxPages: Math.min(v.maxPages, this.config.get<number>('KB_CRAWL_MAX_PAGES_CAP') ?? KB_SYNC_LIMITS.maxPagesCapDefault) } : {}),
      ...(v.maxFileBytes !== undefined ? { maxFileBytes: Math.min(v.maxFileBytes, this.config.get<number>('KB_CRAWL_MAX_FILE_BYTES') ?? 20971520) } : {}),
      ...(v.minIntervalMs !== undefined ? { minIntervalMs: Math.max(v.minIntervalMs, KB_SYNC_LIMITS.minIntervalMsFloor) } : {}),
    };
  }

  async create(dto: KbSourceCreateDto, userId: string): Promise<KbSourceResponse> {
    const count = await this.prisma.kbSource.count();
    if (count >= KB_SYNC_LIMITS.maxSources) throw new ApiException('LIMIT_EXCEEDED', 400, `소스는 최대 ${KB_SYNC_LIMITS.maxSources}개까지 등록할 수 있습니다.`);

    const name = dto.name.trim();
    const nameNormalized = normalizeText(name);
    const dup = await this.prisma.kbSource.findUnique({ where: { nameNormalized } });
    if (dup) throw new ApiException('DUPLICATE_NAME', 409, '이미 같은 이름의 소스가 있습니다.');

    this.assertGovernanceFlags({ piiMask: dto.piiMask, allowRawFileIngest: dto.allowRawFileIngest });

    const allowedHosts = this.deriveAllowedHosts(dto.seedUrls, dto.sitemapUrls);
    const limits = this.clampLimits(dto);
    await this.assertValidHosts(allowedHosts);

    const now = new Date();
    const row = await this.prisma.kbSource.create({
      data: {
        name,
        nameNormalized,
        seedUrls: JSON.stringify(dto.seedUrls),
        sitemapUrls: JSON.stringify(dto.sitemapUrls),
        allowedHosts: JSON.stringify(allowedHosts),
        pathPrefixes: JSON.stringify(dto.pathPrefixes),
        excludePatterns: JSON.stringify(dto.excludePatterns),
        noisePatterns: JSON.stringify(dto.noisePatterns),
        allowQueryUrls: dto.allowQueryUrls,
        maxDepth: limits.maxDepth!,
        maxPages: limits.maxPages!,
        fileTypes: JSON.stringify(dto.fileTypes),
        maxFileBytes: limits.maxFileBytes!,
        minIntervalMs: limits.minIntervalMs!,
        scopeCompany: dto.scope.company,
        scopeCategory: dto.scope.category,
        scopeSubcategory: dto.scope.subcategory,
        scheduleKind: dto.schedule.kind,
        scheduleTime: dto.schedule.kind === 'MANUAL' ? null : dto.schedule.time,
        scheduleWeekday: dto.schedule.kind === 'WEEKLY' ? dto.schedule.weekday : null,
        authKind: dto.auth.kind,
        authHeaderName: dto.auth.kind === 'STATIC_HEADER' ? dto.auth.headerName : null,
        authSecretRef: dto.auth.kind === 'STATIC_HEADER' ? dto.auth.secretRef : null,
        piiMask: dto.piiMask,
        allowRawFileIngest: dto.allowRawFileIngest,
        rightsConfirmedById: userId,
        rightsConfirmedAt: now,
        createdById: userId,
        updatedById: userId,
      },
    });

    await this.auditLogService.record({ action: 'CREATE', targetType: 'KbSource', targetId: row.id, targetName: row.name, after: this.auditSnapshot(row) });
    const [response, warnings] = await Promise.all([this.toResponse(row), this.scopeWarnings(row)]);
    return { ...response, warnings };
  }

  async update(id: string, dto: KbSourceUpdateDto, userId: string): Promise<KbSourceResponse> {
    const current = await this.findRowOrThrow(id);

    // 거버넌스 검사는 등록과 같다(수정 경로에서 빠져 있던 것 — pass 4 위반 3).
    this.assertGovernanceFlags({ piiMask: dto.piiMask, allowRawFileIngest: dto.allowRawFileIngest });

    const limits = this.clampLimits(dto);
    const parsedCurrent = this.snapshotOf(current);
    // 본문에 **있는** 범위 필드만 "저장될 값"으로 정규화해 현재 값과 비교한다 — 값이 같으면 변경이 아니다(위반 4).
    const change = detectConfigChange(parsedCurrent, {
      ...(dto.seedUrls !== undefined ? { seedUrls: dto.seedUrls } : {}),
      ...(dto.sitemapUrls !== undefined ? { sitemapUrls: dto.sitemapUrls } : {}),
      ...(dto.pathPrefixes !== undefined ? { pathPrefixes: dto.pathPrefixes } : {}),
      ...(dto.excludePatterns !== undefined ? { excludePatterns: dto.excludePatterns } : {}),
      ...(dto.noisePatterns !== undefined ? { noisePatterns: dto.noisePatterns } : {}),
      ...(dto.fileTypes !== undefined ? { fileTypes: dto.fileTypes } : {}),
      ...(dto.allowQueryUrls !== undefined ? { allowQueryUrls: dto.allowQueryUrls } : {}),
      ...(limits.maxDepth !== undefined ? { maxDepth: limits.maxDepth } : {}),
      ...(limits.maxPages !== undefined ? { maxPages: limits.maxPages } : {}),
      ...(limits.maxFileBytes !== undefined ? { maxFileBytes: limits.maxFileBytes } : {}),
      ...(dto.scope !== undefined ? { scope: dto.scope } : {}),
      ...(dto.piiMask !== undefined ? { piiMask: dto.piiMask } : {}),
      ...(dto.allowRawFileIngest !== undefined ? { allowRawFileIngest: dto.allowRawFileIngest } : {}),
    });
    const configVersionAffected = change.changed;

    if (current.activeRunId && configVersionAffected) {
      throw new ApiException('KB_SOURCE_BUSY', 409, '실행 중인 소스의 범위 설정은 먼저 중지한 뒤 수정할 수 있습니다.');
    }

    let name = current.name;
    let nameNormalized = current.nameNormalized;
    if (dto.name !== undefined) {
      name = dto.name.trim();
      nameNormalized = normalizeText(name);
      const dup = await this.prisma.kbSource.findFirst({ where: { nameNormalized, id: { not: id } } });
      if (dup) throw new ApiException('DUPLICATE_NAME', 409, '이미 같은 이름의 소스가 있습니다.');
    }

    const seedUrls = dto.seedUrls ?? JSON.parse(current.seedUrls);
    const sitemapUrls = dto.sitemapUrls ?? JSON.parse(current.sitemapUrls);
    let allowedHosts = JSON.parse(current.allowedHosts) as string[];
    if (dto.seedUrls !== undefined || dto.sitemapUrls !== undefined) {
      allowedHosts = this.deriveAllowedHosts(seedUrls, sitemapUrls);
      await this.assertValidHosts(allowedHosts);
    }

    const row = await this.prisma.kbSource.update({
      where: { id },
      data: {
        name,
        nameNormalized,
        ...(dto.seedUrls !== undefined ? { seedUrls: JSON.stringify(dto.seedUrls) } : {}),
        ...(dto.sitemapUrls !== undefined ? { sitemapUrls: JSON.stringify(dto.sitemapUrls) } : {}),
        ...(dto.seedUrls !== undefined || dto.sitemapUrls !== undefined ? { allowedHosts: JSON.stringify(allowedHosts) } : {}),
        ...(dto.pathPrefixes !== undefined ? { pathPrefixes: JSON.stringify(dto.pathPrefixes) } : {}),
        ...(dto.excludePatterns !== undefined ? { excludePatterns: JSON.stringify(dto.excludePatterns) } : {}),
        ...(dto.noisePatterns !== undefined ? { noisePatterns: JSON.stringify(dto.noisePatterns) } : {}),
        ...(dto.allowQueryUrls !== undefined ? { allowQueryUrls: dto.allowQueryUrls } : {}),
        ...(limits.maxDepth !== undefined ? { maxDepth: limits.maxDepth } : {}),
        ...(limits.maxPages !== undefined ? { maxPages: limits.maxPages } : {}),
        ...(dto.fileTypes !== undefined ? { fileTypes: JSON.stringify(dto.fileTypes) } : {}),
        ...(limits.maxFileBytes !== undefined ? { maxFileBytes: limits.maxFileBytes } : {}),
        ...(limits.minIntervalMs !== undefined ? { minIntervalMs: limits.minIntervalMs } : {}),
        ...(dto.scope !== undefined ? { scopeCompany: dto.scope.company, scopeCategory: dto.scope.category, scopeSubcategory: dto.scope.subcategory } : {}),
        ...(dto.schedule !== undefined
          ? {
              scheduleKind: dto.schedule.kind,
              scheduleTime: dto.schedule.kind === 'MANUAL' ? null : dto.schedule.time,
              scheduleWeekday: dto.schedule.kind === 'WEEKLY' ? dto.schedule.weekday : null,
            }
          : {}),
        ...(dto.auth !== undefined
          ? { authKind: dto.auth.kind, authHeaderName: dto.auth.kind === 'STATIC_HEADER' ? dto.auth.headerName : null, authSecretRef: dto.auth.kind === 'STATIC_HEADER' ? dto.auth.secretRef : null }
          : {}),
        ...(dto.piiMask !== undefined ? { piiMask: dto.piiMask } : {}),
        ...(dto.allowRawFileIngest !== undefined ? { allowRawFileIngest: dto.allowRawFileIngest } : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        ...(configVersionAffected ? { configVersion: { increment: 1 } } : {}),
        updatedById: userId,
      },
    });

    // §9.8 — 스코프가 바뀌면 이전에 적재된 ACTIVE 문서에 "정리 필요(SCOPE_CHANGED)"를 단다.
    if (change.scopeChanged) await this.store.markScopeChanged(id);

    await this.auditLogService.record({
      action: 'UPDATE',
      targetType: 'KbSource',
      targetId: row.id,
      targetName: row.name,
      before: this.auditSnapshot(current),
      after: this.auditSnapshot(row),
      summary: configVersionAffected ? '범위 설정 변경 — 다시 미리보기가 필요합니다' : undefined,
    });

    // §9.9 — 일시중지·재개는 별도 감사이고, 일시중지는 진행 중인 실행을 중지와 같은 방식으로 끝낸다.
    if (dto.enabled !== undefined && dto.enabled !== current.enabled) {
      await this.auditLogService.record({ action: 'STATUS_CHANGE', targetType: 'KbSource', targetId: row.id, targetName: row.name, summary: dto.enabled ? '[재개]' : '[일시중지]' });
      if (!dto.enabled && current.activeRunId) {
        const now = new Date();
        await this.cancelRunAndRelease(id, current.activeRunId, now, userId, 'SOURCE_DISABLED');
      }
    }

    const fresh = (await this.prisma.kbSource.findUnique({ where: { id } })) ?? row;
    const [response, warnings] = await Promise.all([this.toResponse(fresh), this.scopeWarnings(fresh)]);
    return { ...response, warnings };
  }

  /** 저장된 행 → 변경 판정용 스냅샷(JSON 열을 배열로 푼다). */
  private snapshotOf(row: Awaited<ReturnType<typeof this.findRowOrThrow>>): KbConfigSnapshot {
    const arr = (json: string): string[] => {
      try {
        const v = JSON.parse(json);
        return Array.isArray(v) ? v.map(String) : [];
      } catch {
        return [];
      }
    };
    return {
      seedUrls: arr(row.seedUrls),
      sitemapUrls: arr(row.sitemapUrls),
      pathPrefixes: arr(row.pathPrefixes),
      excludePatterns: arr(row.excludePatterns),
      noisePatterns: arr(row.noisePatterns),
      fileTypes: arr(row.fileTypes),
      allowQueryUrls: row.allowQueryUrls,
      maxDepth: row.maxDepth,
      maxPages: row.maxPages,
      maxFileBytes: row.maxFileBytes,
      scope: { company: row.scopeCompany, category: row.scopeCategory, subcategory: row.scopeSubcategory },
      piiMask: row.piiMask,
      allowRawFileIngest: row.allowRawFileIngest,
    };
  }

  async remove(id: string): Promise<void> {
    const current = await this.findRowOrThrow(id);
    if (current.activeRunId) throw new ApiException('KB_SOURCE_BUSY', 409, '실행 중인 소스는 삭제할 수 없습니다. 먼저 중지하세요.');
    await this.store.deleteDocumentsForSource(id);
    await this.prisma.kbSource.delete({ where: { id } });
    await this.auditLogService.record({ action: 'DELETE', targetType: 'KbSource', targetId: current.id, targetName: current.name, before: this.auditSnapshot(current) });
  }

  /** ★ `KbSource.activeRunId` CAS(소스당 동시 실행 1 — R-6). 엔진(스케줄러·러너)이 호출한다.
   * `kbSource` 쓰기는 이 파일에만 있어야 한다(KB-9) — 엔진 전용 메서드도 여기 둔다. */
  async claimForRun(sourceId: string, runId: string, nextRunAt: Date | null, tx?: Prisma.TransactionClient): Promise<boolean> {
    const { count } = await (tx ?? this.prisma).kbSource.updateMany({ where: { id: sourceId, activeRunId: null }, data: { activeRunId: runId, nextRunAt } });
    return count === 1;
  }

  /**
   * ★ 소스 선점(CAS)과 실행 행 생성을 **한 트랜잭션**으로 한다(§9.2 — "실행 행 생성과 CAS는 한 트랜잭션").
   * 따로 하면 CAS 뒤 실행 행을 만들다 실패(또는 프로세스 종료)할 때 `activeRunId`가 존재하지 않는 실행을 가리켜
   * 그 소스가 영구히 "실행 중"이 된다. `approval`이 있으면 적재 승인 기록도 같은 트랜잭션이라, 선점에 실패하면
   * (이미 실행 중) 승인도 남지 않는다. 선점에 실패하면 `null`.
   *
   * 트랜잭션 안에서는 **`tx`만** 쓴다(SQLite는 연결이 하나라 `this.prisma`를 부르면 트랜잭션이 끝나기를 기다리다
   * 교착한다).
   */
  async claimAndCreateRun(input: {
    sourceId: string;
    sourceName: string;
    kind: 'PREVIEW' | 'SYNC' | 'FULL_RESEND';
    trigger: 'SCHEDULED' | 'MANUAL' | 'APPROVAL';
    configVersion: number;
    nextRunAt: Date | null;
    createdById?: string | null;
    approval?: { configVersion: number; userId: string };
    /** `FULL_RESEND { acknowledgeCleanup: true }` — GONE 행 삭제·정리 표시 해제를 **선점에 성공한 같은 트랜잭션**에서 한다(선점에 지면 아무것도 지우지 않는다). */
    acknowledgeCleanup?: boolean;
  }): Promise<{ id: string } | null> {
    const runId = randomUUID();
    return this.prisma.$transaction(async (tx) => {
      // [pass 8 · PM 결정 2026-09-28] 거버넌스 ON인데 저장된 값이 규칙에 걸리는 소스는 선점·승인·실행 행 생성 **전에** 거부한다 — 이 트랜잭션 안이라 아무것도 남지 않는다(롤백).
      const stored = await tx.kbSource.findUnique({ where: { id: input.sourceId }, select: { piiMask: true, allowRawFileIngest: true } });
      const violation = stored ? this.governanceViolationOf(stored) : null;
      if (violation) throw new ApiException('KB_INGEST_NOT_ALLOWED', 409, governanceViolationMessage(violation), [{ field: governanceViolationField(violation), message: violation }]);
      const claimed = await this.claimForRun(input.sourceId, runId, input.nextRunAt, tx);
      if (!claimed) return null;
      if (input.approval) await this.approveConfigVersion(input.sourceId, input.approval.configVersion, input.approval.userId, tx);
      if (input.acknowledgeCleanup) await this.store.applyCleanupAcknowledge(input.sourceId, tx);
      const run = await this.store.createRun(
        { id: runId, sourceId: input.sourceId, sourceName: input.sourceName, kind: input.kind, trigger: input.trigger, configVersion: input.configVersion, createdById: input.createdById },
        tx,
      );
      return { id: run.id };
    });
  }

  /**
   * [pass 8] 예약 시각이 된 소스가 거버넌스 규칙에 걸려 이번 예약을 건너뛴다 — 실행을 만들지 않고 `nextRunAt`을 **다음 예약 시각**으로 넘긴다. 넘기지 않으면 이 소스가 매 tick 다시 "예약 시각이 지난 후보"가 돼
   * (1) 같은 사유의 로그·감사가 tick마다 쌓이고 (2) `findDueSources`의 tick당 후보 상한(10) 안에서 다른 소스의 예약을 밀어낸다. `nextRunAt` 조건부 갱신(CAS)이라 여러 인스턴스가 동시에 봐도 이긴 쪽 1곳만
   * `true`(로그·감사를 남긴다). 마스킹을 켜 저장하면 다음 예약 시각에 정상 실행된다.
   */
  async skipScheduledRunForGovernance(source: { id: string; name: string; nextRunAt: Date | null }, nextRunAt: Date | null, violation: GovernanceViolation): Promise<boolean> {
    const { count } = await this.prisma.kbSource.updateMany({ where: { id: source.id, activeRunId: null, nextRunAt: source.nextRunAt }, data: { nextRunAt } });
    if (count !== 1) return false;
    await this.auditLogService.record({ action: 'STATUS_CHANGE', targetType: 'KbSource', targetId: source.id, targetName: source.name, summary: `[예약 실행 건너뜀] ${governanceViolationMessage(violation)}` });
    return true;
  }

  /**
   * [pass 10 · U-3] 적재 제출 직전 거버넌스 게이트(`KbIngestRunner.terminateIfGovernanceBlocked`)가 실행을 끝낸다 — 중지 경로(`cancelRunAndRelease`)와 같은 트랜잭션 종결이고, **CAS에 이긴 인스턴스만**
   * 감사 `STATUS_CHANGE` `[적재 차단] …` 1건을 남긴다(예약 건너뜀 `[예약 실행 건너뜀]`과 같은 방식·같은 고정 문구 — URL·비밀·본문 조각 없음). 이미 종단이면 `false`(다른 인스턴스가 먼저 끝냄 · 감사 없음).
   * 적재 러너에는 감사 의존성을 주입하지 않는다 — 감사·쓰기는 이 서비스가 맡고 러너는 이 메서드만 부른다(거버넌스 모듈 의존 0 — KB-13).
   */
  async terminateRunForGovernance(sourceId: string, runId: string, now: Date, violation: GovernanceViolation): Promise<boolean> {
    const cancelled = await this.cancelRunAndRelease(sourceId, runId, now, null, violation);
    if (!cancelled) return false;
    const source = await this.prisma.kbSource.findUnique({ where: { id: sourceId }, select: { name: true } });
    await this.auditLogService.record({ action: 'STATUS_CHANGE', targetType: 'KbSource', targetId: sourceId, targetName: source?.name, summary: `[적재 차단] ${governanceViolationMessage(violation)}` });
    return true;
  }

  async releaseActiveRun(sourceId: string, runId: string, status: string, finishedAt: Date, tx?: Prisma.TransactionClient): Promise<void> {
    await (tx ?? this.prisma).kbSource.updateMany({ where: { id: sourceId, activeRunId: runId }, data: { activeRunId: null, lastRunId: runId, lastRunStatus: status, lastRunFinishedAt: finishedAt } });
  }

  /**
   * [pass 5 · RG-5] 실행 종결과 소스 선점 해제를 **한 트랜잭션**으로 묶는다 — 따로 하면 그 사이 프로세스가 죽을 때 실행은 종단 상태인데
   * `activeRunId`가 남아 소스가 영구히 "실행 중"이 된다(예약 제외 · 수동 실행·범위 수정·삭제 409 · 중지도 종단 실행이라 CAS 실패).
   * 종결 CAS에 지면(중지·다른 인스턴스가 먼저 끝냄) 해제도 하지 않는다 — 먼저 끝낸 쪽이 자기 트랜잭션에서 이미 풀었다.
   * 트랜잭션 안에서는 `tx`만 쓴다(SQLite는 연결이 하나라 `this.prisma`를 부르면 교착).
   */
  async finishCrawlAndRelease(sourceId: string, runId: string, data: Parameters<KbRunStore['finishCrawl']>[1], opts: { demoteReview: boolean } = { demoteReview: true }): Promise<boolean> {
    return this.prisma.$transaction(
      async (tx) => {
        const ok = await this.store.finishCrawl(runId, data, tx);
        if (ok && data.status !== 'INGESTING') await this.releaseActiveRun(sourceId, runId, data.status, data.crawlFinishedAt, tx);
        // [pass 6 · M-1] 자동 강등(새로 비율·인증 벽)은 종결 CAS가 성공했을 때만, 같은 트랜잭션에서 반영한다 — 중지된 실행이 소스 승인을 해제하지 않고, 종결과 강등 사이에서 죽어도 어긋나지 않는다.
        // [pass 8 · RG-21] `demoteReview: false`(미리보기의 인증 벽 의심)는 사유를 실행에만 남기고 소스 승인은 건드리지 않는다.
        if (ok && data.demotedReason && opts.demoteReview) await this.demoteReview(sourceId, data.demotedReason, tx);
        return ok;
      },
      TX_OPTIONS,
    );
  }

  /** 적재 종결(SUCCEEDED·PARTIAL) + 소스 선점 해제 — `finishCrawlAndRelease`와 같은 이유로 한 트랜잭션이다. */
  async finishIngestingAndRelease(sourceId: string, runId: string, status: 'SUCCEEDED' | 'PARTIAL', finishedAt: Date): Promise<boolean> {
    return this.prisma.$transaction(
      async (tx) => {
        const ok = await this.store.finishIngesting(runId, status, finishedAt, tx);
        if (ok) await this.releaseActiveRun(sourceId, runId, status, finishedAt, tx);
        return ok;
      },
      TX_OPTIONS,
    );
  }

  /** 중지(관리자 중지 · 소스 일시중지) + 작업·슬롯 정리 + 소스 선점 해제를 한 트랜잭션으로 한다. 이미 종단이면 `false`. */
  async cancelRunAndRelease(sourceId: string, runId: string, now: Date, cancelledById: string | null, failureCode: KbRunCancelCode): Promise<boolean> {
    return this.prisma.$transaction(
      async (tx) => {
        const ok = await this.store.cancelRun(runId, now, cancelledById, failureCode, tx);
        if (ok) await this.releaseActiveRun(sourceId, runId, 'CANCELLED', now, tx);
        return ok;
      },
      TX_OPTIONS,
    );
  }

  /**
   * [pass 5 · RG-5 · NFR-KBR2] 자가 치유 — `activeRunId`가 가리키는 실행이 종단 상태(또는 부재)면 풀어 준다. 종결 트랜잭션이 도입되기 전의
   * 잔여 상태나 예기치 못한 어긋남을 스케줄러 tick 첫머리에서 복구한다(해제 경로가 없어 DB를 손으로 고쳐야 했다). 진행 중(QUEUED·CRAWLING·
   * INGESTING)인 실행은 건드리지 않는다. 해제는 CAS(`activeRunId = 실행`)라 그 사이 정상 종결이 끼어들어도 무해하다. 풀린 소스 수를 돌려준다.
   */
  async healOrphanedActiveRuns(): Promise<number> {
    const held = await this.prisma.kbSource.findMany({ where: { activeRunId: { not: null } }, select: { id: true, activeRunId: true } });
    if (held.length === 0) return 0;
    const runIds = held.map((s) => s.activeRunId).filter((id): id is string => !!id);
    const runs = await this.prisma.kbSyncRun.findMany({ where: { id: { in: runIds } }, select: { id: true, status: true, finishedAt: true } });
    const byId = new Map(runs.map((r) => [r.id, r]));
    const now = new Date();
    let healed = 0;
    for (const source of held) {
      if (!source.activeRunId) continue;
      const run = byId.get(source.activeRunId);
      if (run && !TERMINAL_RUN_STATUSES.has(run.status)) continue;
      await this.releaseActiveRun(source.id, source.activeRunId, run?.status ?? 'FAILED', run?.finishedAt ?? now);
      healed += 1;
    }
    return healed;
  }

  async demoteReview(sourceId: string, reason: 'NEW_RATIO' | 'AUTH_WALL', tx?: Prisma.TransactionClient): Promise<void> {
    await (tx ?? this.prisma).kbSource.updateMany({ where: { id: sourceId }, data: { approvedConfigVersion: null, reviewRequiredReason: reason } });
  }

  /** 첫 회 미리보기 확인 후 적재 승인(§9.8) — `kb-runs.service.ts`가 호출한다. */
  async approveConfigVersion(sourceId: string, configVersion: number, userId: string, tx?: Prisma.TransactionClient): Promise<void> {
    await (tx ?? this.prisma).kbSource.update({ where: { id: sourceId }, data: { approvedConfigVersion: configVersion, approvedAt: new Date(), approvedById: userId, reviewRequiredReason: null } });
  }

  async findOne(id: string): Promise<KbSourceResponse> {
    const row = await this.findRowOrThrow(id);
    return this.toResponse(row);
  }

  async list(page: number, pageSize: number): Promise<{ items: KbSourceResponse[]; total: number; page: number; pageSize: number }> {
    const [rows, total] = await Promise.all([
      this.prisma.kbSource.findMany({ orderBy: { updatedAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.kbSource.count(),
    ]);
    const sourceIds = rows.map((r) => r.id);
    // [R1 리뷰 M-1 · 설계서 §16] 목록 조회의 집계 4종을 소스별 개별 쿼리 대신 groupBy 4회(페이지
    // 크기와 무관하게 고정)로 배치 처리한다 — activeDocumentCount·needsCleanupCount·
    // repeatedFailureCount·previewStale(최근 성공 PREVIEW configVersion).
    const [activeCountMap, needsCleanupMap, repeatedFailureMap, previewCfgMap] = await Promise.all([
      this.prisma.kbDocument.groupBy({ by: ['sourceId'], where: { sourceId: { in: sourceIds }, state: 'ACTIVE' }, _count: { _all: true } }).then((g) => new Map(g.map((x) => [x.sourceId, x._count._all]))),
      this.store.countNeedsCleanupBatch(sourceIds),
      this.store.countRepeatedFailuresBatch(sourceIds),
      this.store.latestSuccessfulPreviewConfigVersions(sourceIds),
    ]);
    const items = await Promise.all(
      rows.map((r) =>
        this.toResponse(r, {
          activeDocumentCount: activeCountMap.get(r.id) ?? 0,
          needsCleanupCount: needsCleanupMap.get(r.id) ?? 0,
          repeatedFailureCount: repeatedFailureMap.get(r.id) ?? 0,
          previewStale: previewCfgMap.has(r.id) ? isPreviewConfigStale(previewCfgMap.get(r.id)!, r.configVersion) : false,
        }),
      ),
    );
    return { items, total, page, pageSize };
  }

  private async toResponse(
    row: Awaited<ReturnType<typeof this.findRowOrThrow>>,
    precomputed?: { activeDocumentCount: number; needsCleanupCount: number; repeatedFailureCount: number; previewStale: boolean },
  ): Promise<KbSourceResponse> {
    const [activeRun, needsCleanupCount, repeatedFailureCount, activeDocumentCount, previewStale] = await Promise.all([
      row.activeRunId ? this.store.findRun(row.activeRunId) : Promise.resolve(null),
      precomputed?.needsCleanupCount ?? this.store.countNeedsCleanup(row.id),
      precomputed?.repeatedFailureCount ?? this.store.countRepeatedFailures(row.id),
      precomputed?.activeDocumentCount ?? this.prisma.kbDocument.count({ where: { sourceId: row.id, state: 'ACTIVE' } }),
      precomputed
        ? Promise.resolve(precomputed.previewStale)
        : this.store.latestSuccessfulPreviewConfigVersions([row.id]).then((m) => (m.has(row.id) ? isPreviewConfigStale(m.get(row.id)!, row.configVersion) : false)),
    ]);
    const waitingCtx = activeRun ? await this.store.getWaitingContext([activeRun.id]) : null;
    const activeRunView = activeRun
      ? await buildRunView(activeRun, {
          now: new Date(),
          waiting: waitingCtx
            ? { ragReady: waitingCtx.ragReady, bulkWindowOpen: isWithinBulkWindow(this.config.get<string>('KB_INGEST_BULK_WINDOW') ?? '', new Date()), pendingBulk: (id: string) => waitingCtx.pendingBulkByRun.get(id) ?? 0 }
            : undefined,
          leaseMs: this.config.get<number>('KB_SYNC_LEASE_MS') ?? 600000,
          slotCount: this.config.get<number>('KB_INGEST_CONCURRENCY') ?? 1,
          countJobsByRun: (runId) => this.store.countJobsByRun(runId),
          getEtaInputs: (runId) => this.store.getEtaInputs(runId),
        })
      : null;
    return toKbSourceResponse(row, {
      activeRun: activeRunView,
      needsCleanupCount,
      repeatedFailureCount,
      activeDocumentCount,
      previewStale,
    });
  }
}
