import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { EncryptedFieldId } from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { PollingLoop } from '../../common/polling/polling-loop';
import { governanceRuntime } from '../../common/governance/governance-runtime';
import { fieldKeyProvider } from '../../common/crypto/env-key.provider';
import { isEnvelope, parseEnvelope } from '../../common/crypto/field-envelope';
import { GovernanceJobLease } from './job-lease';
import { GovernanceDataWriter } from '../writer/governance-data.writer';

const JOB_NAME = 'FIELD_CRYPTO';
const TICK_INTERVAL_MS = 60_000;
const LEASE_MS = 10 * 60_000;
const MAX_ROWS_PER_TICK = 20_000;
const STATS_IDLE_RECOMPUTE_MS = 60 * 60_000; // 유휴 시 1시간마다(§7.6)

export interface FieldStatsEntry {
  field: EncryptedFieldId;
  plaintextRows: number;
  byKey: Record<string, number>;
  unknownKeyRows: number;
}

interface JobStateShape {
  cursors?: Partial<Record<EncryptedFieldId, string>>;
  passKeyId?: string;
  stats?: FieldStatsEntry[];
  statsComputedAt?: string;
}

// [신규 No.42] +2(영구 데이터 — 백필·재암호화 잡 편입, ADR-0042 §6).
const ALL_FIELDS = ['HANDOFF_TEXT', 'HANDOFF_RAW_TEXT', 'SURVEY_TEXT_VALUE', 'INBOX_ENTRY_TEXT', 'CUSTOMER_DISPLAY_NAME'] as const;

function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

function needsReencrypt(value: string, writeKeyId: string): boolean {
  if (value === '') return false;
  if (!isEnvelope(value)) return true; // 평문
  const parsed = parseEnvelope(value);
  if (!parsed) return true; // 형식 불일치(사실상 평문 취급)
  return parsed.keyId !== writeKeyId;
}

/**
 * ★ 백필·재암호화 잡(No.45 §7.6) — `DATA_REENCRYPT_JOB_ENABLED` ∧ 키링이 있을 때만 시작한다.
 * id 오름차순 커서(필드별)로 이미 처리한 행을 다시 훑지 않는다. `tick()`은 public(CLAUDE.md 규약).
 */
@Injectable()
export class FieldCryptoJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('FieldCryptoJob');
  private readonly loop: PollingLoop;
  private readonly instanceId = randomUUID();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly writer: GovernanceDataWriter,
    private readonly lease: GovernanceJobLease,
  ) {
    this.loop = new PollingLoop({ name: 'governance-field-crypto', intervalMs: TICK_INTERVAL_MS, onTick: (signal) => this.tick(signal), logger: this.logger });
  }

  private jobEnabled(): boolean {
    return this.config.get<boolean>('DATA_REENCRYPT_JOB_ENABLED') ?? true;
  }
  private batchSize(): number {
    return this.config.get<number>('DATA_REENCRYPT_BATCH_SIZE') ?? 500;
  }
  private batchPauseMs(): number {
    return this.config.get<number>('DATA_RETENTION_BATCH_PAUSE_MS') ?? 200;
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.lease.ensureRow(JOB_NAME);
    if (!this.jobEnabled() || fieldKeyProvider().keyIds().length === 0) return;
    this.loop.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.loop.stop(10_000);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** `tick()`은 public — 시험이 직접 호출한다(CLAUDE.md 규약 — `DATA_REENCRYPT_JOB_ENABLED`는
   * 자동 루프 시작 여부만 결정하고, 수동 `tick()` 호출은 이 플래그와 무관하게 동작한다).
   * 쓰기 키가 없으면(키링 미설정) 할 일이 없으므로 그대로 반환한다. */
  async tick(signal?: { stopping(): boolean }): Promise<void> {
    void governanceRuntime();
    const provider = fieldKeyProvider();
    const writeKeyId = provider.writeKeyId();
    if (!writeKeyId) return;

    const token = await this.lease.claim(JOB_NAME, LEASE_MS, new Date());
    if (!token) return;

    try {
      const stateRow = await this.prisma.governanceJobState.findUnique({ where: { jobName: JOB_NAME } });
      let state: JobStateShape = stateRow ? safeJsonParse(stateRow.state, {}) : {};
      if (state.passKeyId !== writeKeyId) {
        // 쓰기 키가 바뀌었다 — 새 패스(커서 초기화).
        state = { passKeyId: writeKeyId, cursors: {} };
      }

      let budget = MAX_ROWS_PER_TICK;
      const runId = randomUUID();
      let totalAffected = 0;
      let anyPassDone = false;

      for (const field of ALL_FIELDS) {
        if (signal?.stopping() || budget <= 0) break;
        const cursor = state.cursors?.[field] ?? null;
        const { affected, nextCursor, done } = await this.passField(field, writeKeyId, cursor, budget, signal);
        totalAffected += affected;
        budget -= affected;
        if (done) anyPassDone = true;
        state.cursors = { ...state.cursors, [field]: done ? undefined : (nextCursor ?? cursor ?? undefined) };
      }

      // [신규 §7.6] 패스 완료 시 + 유휴(1시간 경과) 시 통계 재계산 — 요청 경로 풀스캔 0(잡이 미리 계산).
      const statsAgeMs = state.statsComputedAt ? Date.now() - new Date(state.statsComputedAt).getTime() : Number.POSITIVE_INFINITY;
      if (anyPassDone || statsAgeMs >= STATS_IDLE_RECOMPUTE_MS) {
        state.stats = await this.computeStats(provider.keyIds());
        state.statsComputedAt = new Date().toISOString();
      }

      await this.prisma.governanceJobState.updateMany({ where: { jobName: JOB_NAME }, data: { state: JSON.stringify(state) } });

      if (totalAffected > 0) {
        await this.writer.createRetentionRun({
          runId,
          kind: 'REENCRYPT',
          target: null,
          chatbotId: null,
          days: null,
          cutoff: null,
          affectedCount: totalAffected,
          status: 'SUCCEEDED',
          resultCode: null,
          headSeq: null,
          headHash: null,
          anchorSeq: null,
          instanceId: this.instanceId,
          startedAt: new Date(),
          finishedAt: new Date(),
        });
      }
    } finally {
      await this.lease.release(JOB_NAME, token);
    }
  }

  private async passField(
    field: EncryptedFieldId,
    writeKeyId: string,
    cursor: string | null,
    budget: number,
    signal?: { stopping(): boolean },
  ): Promise<{ affected: number; nextCursor: string | null; done: boolean }> {
    let affected = 0;
    let curCursor = cursor;
    let processedInPass = 0;

    for (;;) {
      if (signal?.stopping() || affected >= budget) return { affected, nextCursor: curCursor, done: false };
      const rows = await this.selectBatch(field, curCursor, this.batchSize());
      if (rows.length === 0) return { affected, nextCursor: curCursor, done: true };

      const toFix = rows.filter((r) => r.value !== null && needsReencrypt(r.value, writeKeyId));
      if (toFix.length > 0) {
        const fixedCount = await this.reencrypt(field, toFix);
        affected += fixedCount;
      }
      curCursor = rows[rows.length - 1].id;
      processedInPass += rows.length;
      if (processedInPass > 1_000_000) return { affected, nextCursor: curCursor, done: false }; // 방어적 상한
      await this.sleep(this.batchPauseMs());
    }
  }

  private async selectBatch(field: EncryptedFieldId, cursor: string | null, take: number): Promise<Array<{ id: string; value: string | null }>> {
    const idFilter = cursor ? { id: { gt: cursor } } : {};
    if (field === 'HANDOFF_TEXT') {
      const rows = await this.prisma.handoffMessage.findMany({ where: idFilter, orderBy: { id: 'asc' }, take, select: { id: true, text: true } });
      return rows.map((r) => ({ id: r.id, value: r.text }));
    }
    if (field === 'HANDOFF_RAW_TEXT') {
      const rows = await this.prisma.handoffMessage.findMany({
        where: { ...idFilter, rawText: { not: null } },
        orderBy: { id: 'asc' },
        take,
        select: { id: true, rawText: true },
      });
      return rows.map((r) => ({ id: r.id, value: r.rawText }));
    }
    if (field === 'SURVEY_TEXT_VALUE') {
      const rows = await this.prisma.surveyAnswer.findMany({
        where: { ...idFilter, textValue: { not: null } },
        orderBy: { id: 'asc' },
        take,
        select: { id: true, textValue: true },
      });
      return rows.map((r) => ({ id: r.id, value: r.textValue }));
    }
    // [신규 No.42]
    if (field === 'INBOX_ENTRY_TEXT') {
      const rows = await this.prisma.inboxEntry.findMany({ where: idFilter, orderBy: { id: 'asc' }, take, select: { id: true, text: true } });
      return rows.map((r) => ({ id: r.id, value: r.text }));
    }
    const rows = await this.prisma.customer.findMany({
      where: { ...idFilter, displayName: { not: null } },
      orderBy: { id: 'asc' },
      take,
      select: { id: true, displayName: true },
    });
    return rows.map((r) => ({ id: r.id, value: r.displayName }));
  }

  private async reencrypt(field: EncryptedFieldId, rows: Array<{ id: string; value: string | null }>): Promise<number> {
    const payload = rows.filter((r): r is { id: string; value: string } => r.value !== null).map((r) => ({ id: r.id, oldValue: r.value }));
    if (field === 'SURVEY_TEXT_VALUE') return this.writer.reencryptSurveyTextValue(payload);
    if (field === 'INBOX_ENTRY_TEXT') return this.writer.reencryptInboxEntryText(payload);
    if (field === 'CUSTOMER_DISPLAY_NAME') return this.writer.reencryptCustomerDisplayName(payload);
    const column = field === 'HANDOFF_TEXT' ? 'text' : 'rawText';
    return this.writer.reencryptHandoffColumn(column, field, payload);
  }

  /** ★ [신규 §7.6] 필드별 평문 잔존 행 수·키별 행 수·미지 키 행 수 — 데이터 지도가 읽는다(요청 시 풀스캔 0). */
  private async computeStats(knownKeyIds: string[]): Promise<FieldStatsEntry[]> {
    const results: FieldStatsEntry[] = [];
    for (const field of ALL_FIELDS) {
      results.push(await this.computeFieldStats(field, knownKeyIds));
    }
    return results;
  }

  private async computeFieldStats(field: EncryptedFieldId, knownKeyIds: string[]): Promise<FieldStatsEntry> {
    if (field === 'HANDOFF_TEXT') {
      const plaintextRows = await this.prisma.handoffMessage.count({ where: { text: { not: '' }, NOT: { text: { startsWith: 'enc:v1:' } } } });
      const encryptedTotal = await this.prisma.handoffMessage.count({ where: { text: { startsWith: 'enc:v1:' } } });
      const byKey: Record<string, number> = {};
      let knownTotal = 0;
      for (const keyId of knownKeyIds) {
        const c = await this.prisma.handoffMessage.count({ where: { text: { startsWith: `enc:v1:${keyId}:` } } });
        byKey[keyId] = c;
        knownTotal += c;
      }
      return { field, plaintextRows, byKey, unknownKeyRows: Math.max(0, encryptedTotal - knownTotal) };
    }
    if (field === 'HANDOFF_RAW_TEXT') {
      const plaintextRows = await this.prisma.handoffMessage.count({ where: { rawText: { not: null }, NOT: { rawText: { startsWith: 'enc:v1:' } } } });
      const encryptedTotal = await this.prisma.handoffMessage.count({ where: { rawText: { startsWith: 'enc:v1:' } } });
      const byKey: Record<string, number> = {};
      let knownTotal = 0;
      for (const keyId of knownKeyIds) {
        const c = await this.prisma.handoffMessage.count({ where: { rawText: { startsWith: `enc:v1:${keyId}:` } } });
        byKey[keyId] = c;
        knownTotal += c;
      }
      return { field, plaintextRows, byKey, unknownKeyRows: Math.max(0, encryptedTotal - knownTotal) };
    }
    if (field === 'SURVEY_TEXT_VALUE') {
      // 소거 센티넬(빈 문자열)은 평문 잔존이 아니므로 제외한다.
      const plaintextRows = await this.prisma.surveyAnswer.count({
        where: { textValue: { not: null }, AND: [{ NOT: { textValue: '' } }, { NOT: { textValue: { startsWith: 'enc:v1:' } } }] },
      });
      const encryptedTotal = await this.prisma.surveyAnswer.count({ where: { textValue: { startsWith: 'enc:v1:' } } });
      const byKey: Record<string, number> = {};
      let knownTotal = 0;
      for (const keyId of knownKeyIds) {
        const c = await this.prisma.surveyAnswer.count({ where: { textValue: { startsWith: `enc:v1:${keyId}:` } } });
        byKey[keyId] = c;
        knownTotal += c;
      }
      return { field: 'SURVEY_TEXT_VALUE', plaintextRows, byKey, unknownKeyRows: Math.max(0, encryptedTotal - knownTotal) };
    }
    if (field === 'INBOX_ENTRY_TEXT') {
      const plaintextRows = await this.prisma.inboxEntry.count({ where: { text: { not: '' }, NOT: { text: { startsWith: 'enc:v1:' } } } });
      const encryptedTotal = await this.prisma.inboxEntry.count({ where: { text: { startsWith: 'enc:v1:' } } });
      const byKey: Record<string, number> = {};
      let knownTotal = 0;
      for (const keyId of knownKeyIds) {
        const c = await this.prisma.inboxEntry.count({ where: { text: { startsWith: `enc:v1:${keyId}:` } } });
        byKey[keyId] = c;
        knownTotal += c;
      }
      return { field: 'INBOX_ENTRY_TEXT', plaintextRows, byKey, unknownKeyRows: Math.max(0, encryptedTotal - knownTotal) };
    }
    // CUSTOMER_DISPLAY_NAME
    const plaintextRows = await this.prisma.customer.count({
      where: { displayName: { not: null }, AND: [{ NOT: { displayName: '' } }, { NOT: { displayName: { startsWith: 'enc:v1:' } } }] },
    });
    const encryptedTotal = await this.prisma.customer.count({ where: { displayName: { startsWith: 'enc:v1:' } } });
    const byKey: Record<string, number> = {};
    let knownTotal = 0;
    for (const keyId of knownKeyIds) {
      const c = await this.prisma.customer.count({ where: { displayName: { startsWith: `enc:v1:${keyId}:` } } });
      byKey[keyId] = c;
      knownTotal += c;
    }
    return { field: 'CUSTOMER_DISPLAY_NAME', plaintextRows, byKey, unknownKeyRows: Math.max(0, encryptedTotal - knownTotal) };
  }
}
