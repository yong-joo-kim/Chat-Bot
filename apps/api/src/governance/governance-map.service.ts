import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DialogOutput, EgressDecision, GovernanceMapResponse, PiiMaskMode } from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { governanceRuntime } from '../common/governance/governance-runtime';
import { checkEgress } from '../common/egress/egress-guard';
import { EGRESS_REGISTRY } from '../common/egress/egress-registry';
import { fieldKeyProvider, auditChainSigner } from '../common/crypto/env-key.provider';
import { RetentionPolicyService } from './retention-policy.service';
import { nodeHasV1PlainHeader } from './lib/v1-token-scan';
import { nextWindowStart } from './lib/retention-window';

interface RetentionJobState {
  v1TokenCheck?: { computedAt: string; snapshotCount: number };
}

function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * ★ 데이터 지도 조립(No.45 §13) — 읽기 전용 · 모드 OFF에서도 제공(P-12). 필드 암호화 통계는
 * 잡이 계산해 `GovernanceJobState.state`에 남긴 값을 읽는다(요청 경로 풀스캔 0).
 */
@Injectable()
export class GovernanceMapService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly retentionPolicy: RetentionPolicyService,
  ) {}

  async build(): Promise<GovernanceMapResponse> {
    const runtime = governanceRuntime();
    const now = new Date();

    const databaseUrl = this.config.get<string>('DATABASE_URL') ?? '';
    const storage = this.buildStorage(databaseUrl);
    const egress = await this.buildEgress();
    const encryption = await this.buildEncryption();
    const retention = await this.buildRetention();
    const auditChain = await this.buildAuditChain();
    const risks = await this.buildRisks();
    const inbox = await this.buildInbox();

    return {
      mode: runtime.mode,
      generatedAt: now,
      storage,
      egress,
      encryption,
      retention,
      auditChain,
      risks,
      ...(inbox ? { inbox } : {}),
    };
  }

  /** [신규 No.42] 고객 0명이면 키 자체를 생략한다(§13.4 — No.41 선례). */
  private async buildInbox(): Promise<GovernanceMapResponse['inbox']> {
    const customers = await this.prisma.customer.count();
    if (customers === 0) return undefined;
    const identifiedCustomers = await this.prisma.customer.count({ where: { kind: 'IDENTIFIED' } });
    const threads = await this.prisma.inboxThread.count();
    const entries = await this.prisma.inboxEntry.count();
    const displayNameEncrypted = governanceRuntime().encryptionEnabled;
    const global = await this.retentionPolicy.getGlobal();
    const inboxTextDays = global.kinds.find((k) => k.kind === 'INBOX_TEXT')?.days ?? null;
    const customerIdentityDays = global.kinds.find((k) => k.kind === 'CUSTOMER_IDENTITY')?.days ?? null;
    return {
      customers,
      identifiedCustomers,
      threads,
      entries,
      identityHashOnly: true,
      displayNameEncrypted,
      retentionDays: { INBOX_TEXT: inboxTextDays, CUSTOMER_IDENTITY: customerIdentityDays },
    };
  }

  /** ★ [신규] v1 평문 헤더 노드는 실시간 쿼리(비용 낮음) · 스냅샷 수는 `RetentionJob`의 주간 점검
   * 캐시를 읽기만 한다(요청 경로 본문 스캔 0 — §13). */
  private async buildRisks(): Promise<GovernanceMapResponse['risks']> {
    const nodes = await this.prisma.dialogNode.findMany({ where: { outputs: { contains: '"API_CONDITION"' } }, select: { outputs: true } });
    let v1PlainHeaderNodes = 0;
    for (const n of nodes) {
      try {
        const outputs = JSON.parse(n.outputs) as DialogOutput[];
        if (nodeHasV1PlainHeader(outputs)) v1PlainHeaderNodes += 1;
      } catch {
        // 형식 오류 행은 건너뛴다(위험 집계에서 과소 계상 — 안전 측 아님을 알고 있는 트레이드오프).
      }
    }

    const retentionState = await this.prisma.governanceJobState.findUnique({ where: { jobName: 'RETENTION' } });
    const parsed = retentionState ? safeJsonParse<RetentionJobState>(retentionState.state, {}) : {};

    // [신규 No.41] 원문 허용 업무 자동화 대상 — 대상 0개면 키 자체를 생략한다(§9.6).
    const rawPersonalDataWorkflowTargetsCount = await this.prisma.workflowTarget.count({ where: { allowRawPersonalData: true } });

    return {
      v1PlainHeaderNodes,
      v1PlainHeaderSnapshots: parsed.v1TokenCheck?.snapshotCount ?? null,
      snapshotScanAt: parsed.v1TokenCheck ? new Date(parsed.v1TokenCheck.computedAt) : null,
      rawPersonalDataConnections: await this.prisma.apiConnection.count({ where: { allowRawPersonalData: true } }),
      externalLlmAugmentation: (this.config.get<string>('AUGMENTATION_PROVIDER') ?? 'rule') === 'gemini',
      piiMaskMode: (this.config.get<string>('PII_MASK_MODE') === 'FULL' ? 'FULL' : 'PARTIAL') as PiiMaskMode,
      ...(rawPersonalDataWorkflowTargetsCount > 0 ? { rawPersonalDataWorkflowTargets: rawPersonalDataWorkflowTargetsCount } : {}),
    };
  }

  private buildStorage(databaseUrl: string): GovernanceMapResponse['storage'] {
    const allowedDirs = (this.config.get<string>('DATA_RESIDENCY_ALLOWED_DIRS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const allowedDbHosts = (this.config.get<string>('DATA_RESIDENCY_ALLOWED_DB_HOSTS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const declared = this.config.get<boolean>('DATA_AT_REST_ENCRYPTION_DECLARED') ?? false;
    const isFile = databaseUrl.startsWith('file:');
    const location = isFile ? databaseUrl.slice('file:'.length) : this.safeHost(databaseUrl);
    const configured = isFile ? allowedDirs.length > 0 : allowedDbHosts.length > 0;
    const residency: GovernanceMapResponse['storage']['residency'] = !configured ? 'NOT_CONFIGURED' : governanceRuntime().mode === 'ON' ? 'ALLOWED' : 'NOT_ENFORCED';
    return { kind: isFile ? 'SQLITE_FILE' : 'REMOTE_DB', location, residency, allowedDirs, allowedDbHosts, atRestEncryptionDeclared: declared };
  }

  private safeHost(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  }

  private async buildEgress(): Promise<GovernanceMapResponse['egress']> {
    const allowedHosts = (this.config.get<string>('DATA_EGRESS_ALLOWED_HOSTS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const urlByExit: Record<string, string | undefined> = {
      EMBEDDING: this.config.get<string>('EMBEDDING_BASE_URL'),
      RAG: this.config.get<string>('RAG_BASE_URL'),
      AUGMENT_GEMINI: this.config.get<string>('AUGMENTATION_PROVIDER') === 'gemini' ? this.config.get<string>('AUGMENTATION_GEMINI_BASE_URL') : undefined,
      AUGMENT_LOCAL: this.config.get<string>('AUGMENTATION_PROVIDER') === 'local' ? this.config.get<string>('AUGMENTATION_LOCAL_BASE_URL') : undefined,
    };

    // [신규 No.41] `WORKFLOW_WEBHOOK`도 레거시와 같이 DB 결정 출구라 exits[]에서 제외한다(§9.6).
    const exits = EGRESS_REGISTRY.filter((e) => e.exitId !== 'LEGACY_API' && e.exitId !== 'WORKFLOW_WEBHOOK').map((def) => {
      const url = urlByExit[def.exitId];
      const configured = !!url;
      const host = url ? this.safeHost(url) || null : null;
      const decision: EgressDecision = !configured ? 'NOT_CONFIGURED' : governanceRuntime().egress.enforce ? checkEgress(def.exitId, url as string) : 'NOT_ENFORCED';
      return {
        exitId: def.exitId,
        configured,
        host,
        dataKind: def.dataKind,
        // WORKFLOW_WEBHOOK(PER_TARGET)은 이미 위 filter에서 제외됐다 — 남은 값은 3종뿐이다.
        masked: def.masked as 'YES' | 'NO' | 'PER_CONNECTION',
        decision,
        ...(def.exitId === 'EMBEDDING' && host && !/^(127\.|localhost$|\[?::1\]?$)/.test(host) ? { rawTextOffHost: true as const } : {}),
      };
    });

    const connections = await this.prisma.apiConnection.findMany({ select: { id: true, name: true, baseUrl: true, enabled: true, allowRawPersonalData: true } });
    const since24h = new Date(Date.now() - 24 * 60 * 60_000);
    const blockedGroups = await this.prisma.apiCallLog.groupBy({
      by: ['connectionId'],
      where: { outcome: 'EGRESS_BLOCKED', createdAt: { gte: since24h } },
      _count: { _all: true },
    });
    const blockedByConnection = new Map(blockedGroups.map((g) => [g.connectionId, g._count._all]));

    const legacyConnections = connections.map((c) => {
      const host = this.safeHost(c.baseUrl) || c.baseUrl;
      const decision: EgressDecision = governanceRuntime().egress.enforce ? checkEgress('LEGACY_API', c.baseUrl) : 'NOT_ENFORCED';
      return { connectionId: c.id, name: c.name, host, enabled: c.enabled, decision, allowRawPersonalData: c.allowRawPersonalData, blockedLast24h: blockedByConnection.get(c.id) ?? 0 };
    });

    // [신규 No.41] 업무 자동화 발송 대상 — 대상이 1개 이상일 때만 채운다(대상 0개 설치는 바이트 동일).
    const workflowTargetRows = await this.prisma.workflowTarget.findMany({
      select: { id: true, name: true, baseUrl: true, enabled: true, pausedAt: true, allowRawPersonalData: true },
    });
    let workflowTargets: GovernanceMapResponse['egress']['workflowTargets'];
    if (workflowTargetRows.length > 0) {
      const since24hW = new Date(Date.now() - 24 * 60 * 60_000);
      const failedGroups = await this.prisma.workflowRun.groupBy({
        by: ['targetId'],
        where: { lastOutcome: { not: 'SUCCESS' }, completedAt: { gte: since24hW } },
        _count: { _all: true },
      });
      const failedByTarget = new Map(failedGroups.map((g) => [g.targetId, g._count._all]));
      const retainedGroups = await this.prisma.workflowRun.groupBy({
        by: ['targetId'],
        where: { status: 'FAILED', payloadPurgedAt: null },
        _count: { _all: true },
      });
      const retainedByTarget = new Map(retainedGroups.map((g) => [g.targetId, g._count._all]));
      workflowTargets = workflowTargetRows.map((t) => {
        const host = this.safeHost(t.baseUrl) || t.baseUrl;
        const decision: EgressDecision = governanceRuntime().egress.enforce ? checkEgress('WORKFLOW_WEBHOOK', t.baseUrl) : 'NOT_ENFORCED';
        return {
          targetId: t.id,
          name: t.name,
          host,
          enabled: t.enabled,
          paused: !!t.pausedAt,
          decision,
          allowRawPersonalData: t.allowRawPersonalData,
          failedLast24h: failedByTarget.get(t.id) ?? 0,
          payloadRetained: retainedByTarget.get(t.id) ?? 0,
        };
      });
    }

    return { allowedHosts, exits, legacyConnections, ...(workflowTargets ? { workflowTargets } : {}) };
  }

  private async buildEncryption(): Promise<GovernanceMapResponse['encryption']> {
    const provider = fieldKeyProvider();
    const stateRow = await this.prisma.governanceJobState.findUnique({ where: { jobName: 'FIELD_CRYPTO' } });
    const state = stateRow ? safeJsonParse<{ stats?: GovernanceMapResponse['encryption']['fields']; statsComputedAt?: string }>(stateRow.state, {}) : {};
    return {
      enabled: governanceRuntime().encryptionEnabled,
      writeKeyId: provider.writeKeyId(),
      keyIds: provider.keyIds(),
      fields: state.stats ?? [],
      statsComputedAt: state.statsComputedAt ? new Date(state.statsComputedAt) : null,
      passInProgress: !!(stateRow?.claimToken),
    };
  }

  private async buildRetention(): Promise<GovernanceMapResponse['retention']> {
    const global = await this.retentionPolicy.getGlobal();
    const chatbotOverrideCount = await this.prisma.retentionPolicy.count({ where: { chatbotId: { not: null } } });
    const lastRuns = await this.prisma.retentionRun.findMany({ orderBy: { startedAt: 'desc' }, take: 6 });
    const window = this.config.get<string>('DATA_RETENTION_WINDOW') ?? '02:00-05:00';
    return {
      global: global.kinds,
      chatbotOverrideCount,
      nextWindowStartAt: nextWindowStart(new Date(), window),
      jobEnabled: this.config.get<boolean>('DATA_RETENTION_JOB_ENABLED') ?? true,
      lastRuns: lastRuns.map((r) => ({
        id: r.id,
        runId: r.runId,
        kind: r.kind as GovernanceMapResponse['retention']['lastRuns'][number]['kind'],
        target: r.target,
        chatbotId: r.chatbotId,
        days: r.days,
        cutoff: r.cutoff,
        affectedCount: r.affectedCount,
        status: r.status as GovernanceMapResponse['retention']['lastRuns'][number]['status'],
        resultCode: r.resultCode,
        headSeq: r.headSeq,
        headHash: r.headHash,
        anchorSeq: r.anchorSeq,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
      })),
      bounds: global.bounds,
      ...((this.config.get<number>('RETENTION_MIN_DAYS_AUDIT') ?? 365) < 365 ? { auditMinimumLowered: true as const } : {}),
    };
  }

  private async buildAuditChain(): Promise<GovernanceMapResponse['auditChain']> {
    const signer = auditChainSigner();
    const head = await this.prisma.auditChainHead.findUnique({ where: { id: 'HEAD' } });
    const lastVerify = await this.prisma.retentionRun.findFirst({ where: { kind: 'CHAIN_VERIFY' }, orderBy: { startedAt: 'desc' } });
    return {
      method: signer.keyId ? 'HMAC' : 'SHA256',
      signingKeyId: signer.keyId,
      head: head ? { seq: head.headSeq, hash: head.headHash } : null,
      lastVerification: lastVerify ? { at: lastVerify.startedAt, status: lastVerify.resultCode ?? lastVerify.status, checkedRows: lastVerify.affectedCount } : null,
    };
  }
}
