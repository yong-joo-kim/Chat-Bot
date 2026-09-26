import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, realpathSync } from 'node:fs';
import { configurePiiMaskMode } from '@chat-bot/pii-mask';
import type { PiiMaskMode } from '@chat-bot/pii-mask';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit-logs/audit-log.service';
import { installGovernanceRuntime } from '../../common/governance/governance-runtime';
import { matchHost, parseAllowlist, parseEgressTarget } from '../../common/egress/egress-guard';
import { fieldKeyProvider } from '../../common/crypto/env-key.provider';
import { parseEnvelope } from '../../common/crypto/field-envelope';
import { checkResidency } from './lib/residency-check';
import { checkEgressBootUrls } from './lib/egress-boot-check';
import { judgeKeyUsage } from './lib/key-usage-plan';

const ENCRYPTED_COLUMNS: Array<{ field: string; label: string; query: (prisma: PrismaService, knownIds: string[]) => Promise<{ id: string; value: string } | null>; count: (prisma: PrismaService, keyId: string) => Promise<number> }> = [
  {
    field: 'HANDOFF_TEXT',
    label: '상담 메시지',
    query: async (prisma, known) => {
      const row = await prisma.handoffMessage.findFirst({
        where: { text: { startsWith: 'enc:v1:' }, AND: known.map((k) => ({ NOT: { text: { startsWith: `enc:v1:${k}:` } } })) },
        select: { id: true, text: true },
      });
      return row ? { id: row.id, value: row.text } : null;
    },
    count: (prisma, keyId) => prisma.handoffMessage.count({ where: { text: { startsWith: `enc:v1:${keyId}:` } } }),
  },
  {
    field: 'HANDOFF_RAW_TEXT',
    label: '상담 원문',
    query: async (prisma, known) => {
      const row = await prisma.handoffMessage.findFirst({
        where: { rawText: { startsWith: 'enc:v1:' }, AND: known.map((k) => ({ NOT: { rawText: { startsWith: `enc:v1:${k}:` } } })) },
        select: { id: true, rawText: true },
      });
      return row && row.rawText !== null ? { id: row.id, value: row.rawText } : null;
    },
    count: (prisma, keyId) => prisma.handoffMessage.count({ where: { rawText: { startsWith: `enc:v1:${keyId}:` } } }),
  },
  {
    field: 'SURVEY_TEXT_VALUE',
    label: '설문 자유 텍스트',
    query: async (prisma, known) => {
      const row = await prisma.surveyAnswer.findFirst({
        where: { textValue: { startsWith: 'enc:v1:' }, AND: known.map((k) => ({ NOT: { textValue: { startsWith: `enc:v1:${k}:` } } })) },
        select: { id: true, textValue: true },
      });
      return row && row.textValue !== null ? { id: row.id, value: row.textValue } : null;
    },
    count: (prisma, keyId) => prisma.surveyAnswer.count({ where: { textValue: { startsWith: `enc:v1:${keyId}:` } } }),
  },
  {
    // [신규 No.41] 발송함 본문(일시 보관) — 백필·재암호화 잡 제외지만 옛 키 필요 행 검사에는 포함한다
    // (실패 보관 본문이 옛 키로 남았는데 키를 빼면 기동 실패, ADR-0041 §7).
    field: 'WORKFLOW_PAYLOAD',
    label: '업무 자동화 발송 본문',
    query: async (prisma, known) => {
      const row = await prisma.workflowRun.findFirst({
        where: { payload: { startsWith: 'enc:v1:' }, AND: known.map((k) => ({ NOT: { payload: { startsWith: `enc:v1:${k}:` } } })) },
        select: { id: true, payload: true },
      });
      return row && row.payload !== null ? { id: row.id, value: row.payload } : null;
    },
    count: (prisma, keyId) => prisma.workflowRun.count({ where: { payload: { startsWith: `enc:v1:${keyId}:` } } }),
  },
];

/**
 * ★ 거버넌스 기동 검증 + 런타임 설치 유일 파일(No.45 §5.1) — `onModuleInit` 1곳. 실패는 예외 =
 * 기동 실패. 모드 OFF는 대부분의 검사를 건너뛴다(FR-0-161 기준선).
 */
@Injectable()
export class GovernanceBootstrapService implements OnModuleInit {
  private readonly logger = new Logger('GovernanceBootstrap');

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async onModuleInit(): Promise<void> {
    const mode = this.config.get<'OFF' | 'ON'>('DATA_GOVERNANCE_MODE') ?? 'OFF';
    const encryptionEnabled = this.config.get<boolean>('DATA_ENCRYPTION_ENABLED') ?? false;
    const allowlistRaw = this.config.get<string>('DATA_EGRESS_ALLOWED_HOSTS') ?? '';
    const allowlist = allowlistRaw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    if (mode === 'ON') {
      this.checkResidencyOrThrow();
      this.checkEgressBootOrThrow(allowlist);
    }

    // 키가 설정되어 있으면(모드 무관) 사용 행 검사 — §5.1 5단계.
    if (fieldKeyProvider().keyIds().length > 0 || mode === 'ON') {
      await this.checkKeyUsageOrThrow();
    }

    installGovernanceRuntime({
      mode,
      egress: { allowlist, enforce: mode === 'ON' },
      encryptionEnabled,
    });
    configurePiiMaskMode((this.config.get<string>('PII_MASK_MODE') === 'FULL' ? 'FULL' : 'PARTIAL') as PiiMaskMode);

    await this.auditLog.ensureChainHead();
    await this.ensureJobStateRows();

    const provider = fieldKeyProvider();
    this.logger.log(
      `데이터 거버넌스 모드=${mode} · 암호화=${encryptionEnabled ? `켜짐(키=${provider.writeKeyId() ?? '-'})` : '꺼짐'} · 출구 허용=${allowlist.length}개`,
    );
  }

  private checkResidencyOrThrow(): void {
    const allowedDirs = (this.config.get<string>('DATA_RESIDENCY_ALLOWED_DIRS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const allowedDbHosts = (this.config.get<string>('DATA_RESIDENCY_ALLOWED_DB_HOSTS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (allowedDirs.length === 0 && allowedDbHosts.length === 0) return;
    const databaseUrl = this.config.get<string>('DATABASE_URL') ?? '';
    const result = checkResidency(databaseUrl, allowedDirs, allowedDbHosts, { existsSync, realpathSync });
    if (!result.ok) throw new Error(`[데이터 거버넌스] 저장 위치 검증 실패: ${result.reason}`);
  }

  private checkEgressBootOrThrow(allowlist: string[]): void {
    // [신규 No.45] M-2 픽스(코드 리뷰 R1) — 기동 검사는 런타임 설치 전이라 `checkEgress()`의
    // enforce 판정을 쓸 수 없지만, 매칭 로직 자체는 `egress-guard.ts`의 순수 함수
    // (`parseAllowlist`·`matchHost`)를 그대로 재사용한다(포트 검사 포함 — 기동 판정과 런타임 판정이
    // 어긋나지 않게). 형식이 잘못된 항목은 `parseAllowlist`가 던지는 예외를 그대로 기동 실패로 올린다.
    let entries: ReturnType<typeof parseAllowlist>;
    try {
      entries = parseAllowlist(allowlist.join(','));
    } catch (e) {
      throw new Error(`[데이터 거버넌스] ${e instanceof Error ? e.message : '출구 허용 목록 형식이 올바르지 않습니다'}`);
    }
    const result = checkEgressBootUrls(
      {
        embeddingBaseUrl: this.config.get<string>('EMBEDDING_BASE_URL'),
        ragBaseUrl: this.config.get<string>('RAG_BASE_URL'),
        augmentationProvider: this.config.get<string>('AUGMENTATION_PROVIDER') ?? 'rule',
        augmentationGeminiApiKey: this.config.get<string>('AUGMENTATION_GEMINI_API_KEY'),
        augmentationGeminiBaseUrl: this.config.get<string>('AUGMENTATION_GEMINI_BASE_URL'),
        augmentationLocalBaseUrl: this.config.get<string>('AUGMENTATION_LOCAL_BASE_URL'),
      },
      (url) => {
        try {
          return matchHost(parseEgressTarget(url), entries);
        } catch {
          return false;
        }
      },
    );
    if (!result.ok) throw new Error(`[데이터 거버넌스] ${result.reason}`);
  }

  private async checkKeyUsageOrThrow(): Promise<void> {
    const provider = fieldKeyProvider();
    const knownIds = provider.keyIds();
    if (knownIds.length === 0) return;

    // [신규 No.45] L-1 픽스(코드 리뷰 R1) — `col.query`가 매번 `known`에 없는 keyId만 찾도록 조건을
    // 걸어주므로, 발견된 keyId는 구성상 항상 "키링에 없는 키"다. 옛 코드는 첫 발견 즉시 throw해서
    // attempt 2회차 이후가 도달하지 않았다(`known = [...known, parsed.keyId]` 이후 반복은 죽은 코드).
    // 미지 키를 발견하면 기동을 실패시키는 동작은 그대로 두되, 최대 10개까지 모아 한 번에 보고한다
    // (키 값은 절대 포함하지 않는다 — keyId·행 수만).
    for (const col of ENCRYPTED_COLUMNS) {
      const excluded = [...knownIds];
      const unknown: Array<{ keyId: string; rows: number }> = [];

      for (let attempt = 0; attempt < 10; attempt += 1) {
        const found = await col.query(this.prisma, excluded);
        if (!found) break;
        const parsed = parseEnvelope(found.value);
        if (!parsed || excluded.includes(parsed.keyId)) break; // 안전장치(무한루프 방지)
        const rowCount = await col.count(this.prisma, parsed.keyId);
        const judgement = judgeKeyUsage(col.label, parsed.keyId, rowCount);
        if (!judgement.ok && judgement.unknownKeyId) {
          unknown.push({ keyId: judgement.unknownKeyId, rows: judgement.affectedRows ?? rowCount });
        }
        excluded.push(parsed.keyId);
      }

      if (unknown.length > 0) {
        const keyIdList = unknown.map((u) => `"${u.keyId}"`).join(', ');
        const totalRows = unknown.reduce((sum, u) => sum + u.rows, 0);
        throw new Error(
          `[데이터 거버넌스] 키링에 없는 키 id ${keyIdList}가 필요한 행 ${totalRows.toLocaleString()}개(${col.label}) — 키링에서 제거하기 전에 재암호화를 완료하세요.`,
        );
      }
    }
  }

  private async ensureJobStateRows(): Promise<void> {
    for (const jobName of ['RETENTION', 'FIELD_CRYPTO']) {
      try {
        await this.prisma.governanceJobState.create({ data: { jobName } });
      } catch {
        // 이미 존재 — 무시.
      }
    }
  }
}
