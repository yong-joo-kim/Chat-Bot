import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { WorkflowOutcome, WorkflowTestSendRequestDto, WorkflowTestSendResult } from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiException } from '../../common/api.exception';
import type { RateLimitStore } from '../../common/rate-limit/rate-limit.store';
import { WorkflowRunEnqueueWriter } from '../triggers/workflow-run-enqueue.writer';
import { buildEnvelopeJson } from '../triggers/lib/envelope';
import { WorkflowHttpSender } from '../dispatch/workflow-http.sender';
import { classifyHttpStatus, classifyTransportOutcome } from '../dispatch/lib/classify-result';
import { parseRetryAfterMs } from '../dispatch/lib/retry-after';

const NOT_FOUND_MESSAGE = '요청하신 발송 대상을 찾을 수 없습니다.';

function guidanceFor(outcome: WorkflowOutcome | null, attempted: boolean): string {
  if (!attempted) return '확인 중 문제가 발생했습니다.';
  switch (outcome) {
    case 'SUCCESS':
      return '정상적으로 응답을 받았습니다.';
    case 'HTTP_ERROR':
      return '대상 서버가 오류 상태 코드를 반환했습니다.';
    case 'TIMEOUT':
      return '응답이 시간 내에 오지 않았습니다.';
    case 'NETWORK_ERROR':
      return '대상 서버에 연결할 수 없습니다.';
    case 'BLOCKED_ADDRESS':
      return '대상 주소는 보안상 호출할 수 없습니다.';
    case 'EGRESS_BLOCKED':
      return '이 주소는 서버의 외부 전송 허용 목록에 없습니다.';
    case 'SECRET_MISSING':
      return '필요한 시크릿이 설정되지 않았습니다.';
    case 'TARGET_HOST_MISMATCH':
      return '비밀 주소의 호스트가 등록된 주소와 다릅니다.';
    case 'INVALID_TARGET_URL':
      return '주소 형식이 올바르지 않습니다.';
    case 'REDIRECT_NOT_ALLOWED':
      return '대상 서버가 리다이렉트 응답을 반환했습니다.';
    default:
      return '확인 중 문제가 발생했습니다.';
  }
}

/**
 * [신규 No.41] 테스트 발송(§13.5) — 동기 1회 · 재시도 없음 · 실제 경로(출구 게이트·SSRF·서명·타임아웃
 * 동일) · 본문 비저장. 대상당 분당 5회(인스턴스 로컬 토큰버킷).
 */
@Injectable()
export class WorkflowTestSendService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly sender: WorkflowHttpSender,
    private readonly writer: WorkflowRunEnqueueWriter,
    @Inject('RateLimitStore') private readonly rateLimitStore: RateLimitStore,
  ) {}

  async send(targetId: string, dto: WorkflowTestSendRequestDto): Promise<WorkflowTestSendResult> {
    const target = await this.prisma.workflowTarget.findUnique({ where: { id: targetId } });
    if (!target) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);

    const rate = this.rateLimitStore.consume(`workflow:test:${targetId}`, Date.now(), 5, 60_000);
    if (!rate.allowed) throw new ApiException('RATE_LIMITED', 429, '지금은 테스트 발송을 더 보낼 수 없습니다. 잠시 후 다시 시도해 주세요.');

    const fieldNames = await this.collectFieldNames(targetId);
    const id = randomUUID();
    const now = new Date();
    const actionKey = dto.actionKey ?? 'test.ping';
    const fields: Record<string, string> = {};
    for (const name of fieldNames) fields[name] = '예시';

    const envelopeJson = buildEnvelopeJson({
      deliveryId: id,
      eventType: 'TEST',
      occurredAt: now,
      test: true,
      chatbot: null,
      channel: null,
      sessionRef: null,
      source: {},
      action: { key: actionKey },
      fields,
    });

    const started = Date.now();
    let outcome: WorkflowOutcome | null = null;
    let httpStatus: number | undefined;
    let attempted = true;
    let blockedAddress: string | undefined;

    try {
      const result = await this.sender.send(
        {
          baseUrl: target.baseUrl,
          authType: target.authType as never,
          authHeaderName: target.authHeaderName,
          secretRef: target.secretRef,
          signingEnabled: target.signingEnabled,
          signingSecretRef: target.signingSecretRef,
          urlSecretRef: target.urlSecretRef,
          timeoutMs: target.timeoutMs,
        },
        'TEST',
        id,
        1,
        envelopeJson,
        now,
      );
      if (result.kind === 'RESPONSE') {
        httpStatus = result.status;
        const decision = classifyHttpStatus(result.status, parseRetryAfterMs(result.retryAfter, now));
        outcome = decision.kind === 'SUCCESS' ? 'SUCCESS' : decision.outcome;
      } else if (result.kind === 'BLOCKED') {
        outcome = result.outcome;
        blockedAddress = result.blockedAddress;
        attempted = false;
      } else {
        outcome = classifyTransportOutcome(result.outcome).outcome;
      }
    } catch {
      outcome = 'NETWORK_ERROR';
    }

    const latencyMs = Date.now() - started;
    const runId = await this.writer.createTerminal({ id, targetId, targetName: target.name, actionKey, fieldNames, outcome, httpStatus: httpStatus ?? null, latencyMs, now });

    return {
      runId,
      outcome: outcome ?? 'NETWORK_ERROR',
      ...(httpStatus !== undefined ? { httpStatus } : {}),
      latencyMs,
      attempted,
      targetDisabled: !target.enabled,
      targetPaused: !!target.pausedAt,
      ...(blockedAddress ? { blockedAddress } : {}),
      guidance: guidanceFor(outcome, attempted),
    };
  }

  private async collectFieldNames(targetId: string): Promise<string[]> {
    const candidates = await this.prisma.dialogNode.findMany({ where: { outputs: { contains: targetId } }, select: { outputs: true } });
    const names = new Set<string>();
    for (const c of candidates) {
      try {
        const outputs = JSON.parse(c.outputs) as Array<{ type: string; payload?: { targetId?: string; fields?: Array<{ name: string }> } }>;
        for (const o of outputs) {
          if (o.type === 'WORKFLOW' && o.payload?.targetId === targetId) {
            for (const f of o.payload.fields ?? []) names.add(f.name);
          }
        }
      } catch {
        // 무시
      }
      if (names.size >= 20) break;
    }
    return [...names].slice(0, 20);
  }
}
