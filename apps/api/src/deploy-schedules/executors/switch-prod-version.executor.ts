import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { SwitchProdVersionParamsSchema } from '@chat-bot/shared-types';
import type { Permission, SwitchProdVersionParams } from '@chat-bot/shared-types';
import { ApiException } from '../../common/api.exception';
import type { ScheduledInvocation } from '../../audit-logs/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ProdSwitchService } from '../../environment/core/prod-switch.service';
import { requiredPermissions } from '../lib/required-permissions';
import { classifyExecutionError } from '../lib/outcome-classifier';
import { resolveSwitchBinding, hasLaterActiveSwitch } from '../lib/switch-chain';
import type {
  ActionPreviewResult,
  DeployActionExecutor,
  DerivedFields,
  ExecutionContext,
  ExecutionOutcome,
  InsertContext,
  PreviewContext,
  RecoveryContext,
  RecoveryVerdictOutcome,
} from './deploy-action-executor';

/**
 * [신규 No.40] `SWITCH_PROD_VERSION` 실행기(§11) — 포인터를 직접 쓰지 않는다. 쓰기는
 * `environment/core`의 `ProdSwitchService`가 한다(D-1 불변 — `deploySchedule` 외 모델 쓰기 0건).
 *
 * §11.2 체인 지원 — 같은 챗봇의 앞선 활성 전환 예약이 있으면 그 대상 버전을 기준(`base:'SCHEDULE'`)
 * 으로 삼는다(복원 체인 `findPredecessor`와 같은 규칙, `resolveSwitchBinding`). 없으면 현재 운영
 * (`base:'CURRENT'`)을 기준으로 삼는다.
 *
 * ⚠ 구현 편차(§27 I-4 참고): 미리보기 화면의 게이트 판정·차이·경고(`switchProd.gate/blockers/warnings`)
 * 는 `ProdSwitchService.preview()`가 항상 "현재 실제 운영 버전"을 기준으로 계산한 값을 그대로 싣는다
 * (체인 기준 버전과의 차이를 다시 계산하지 않는다). 실제 **저장되는 CAS 기준값**(`expectedContentHash`
 * 재사용 컬럼)은 체인을 정확히 반영한다 — 선행 예약이 먼저 실행되면 운영 포인터가 선행의 대상으로
 * 바뀌고, 그 값이 이 예약이 저장해 둔 기준값과 일치해 정상 실행된다(안전성은 완전하다).
 */
@Injectable()
export class SwitchProdVersionExecutor implements DeployActionExecutor<'SWITCH_PROD_VERSION'> {
  readonly action = 'SWITCH_PROD_VERSION' as const;
  readonly paramsSchema = SwitchProdVersionParamsSchema;

  constructor(
    private readonly prisma: PrismaService,
    private readonly prodSwitch: ProdSwitchService,
  ) {}

  requiredPermissions(params: SwitchProdVersionParams): Permission[] {
    return requiredPermissions('SWITCH_PROD_VERSION', params);
  }

  async preview(ctx: PreviewContext<'SWITCH_PROD_VERSION'>): Promise<ActionPreviewResult> {
    const binding = resolveSwitchBinding(ctx.activeSwitchSiblings, ctx.scheduledAt);
    const preview = await this.prodSwitch.preview(ctx.chatbotId, { kind: 'SWITCH', targetVersionId: ctx.params.targetVersionId });

    // [신규 No.40 — 2026-09-25 프론트 계약 보강] RESTORE_VERSION 선례(RESTORE_BLOCKED)와 정확히 같은
    // 2단 구조다: 이 `preconditionFailures`(생성 409의 `details[].message`가 되는 값, §11.2)는
    // 항상 일반 신호 `'SWITCH_BLOCKED'`뿐이다 — **개별 사유는 담지 않는다**. 세부 사유는 같은 응답의
    // `switchProd.blockers`(열거형 배열 — `TARGET_NOT_ALLOWED`·`GATE_BLOCKED`·`GATE_CONFIG_ERROR`·
    // `TARGET_UNREADABLE`·`CHATBOT_ARCHIVED`·`ENV_MODE_DISABLED`)에서 읽는다. 콘솔은 생성 이전에
    // 이미 이 미리보기 응답을 화면에 그려 두었으므로(같은 페이지 흐름) 개별 코드는 생성 시점의 409
    // 본문이 아니라 그 미리보기 데이터에서 가져와야 한다.
    const preconditionFailures: ActionPreviewResult['preconditionFailures'] = [];
    if (preview.blockers.length > 0) {
      preconditionFailures.push({ code: 'SWITCH_BLOCKED' });
    }

    // [신규 No.40 — 2026-09-25 프론트 계약 보강] §11.2 — 체인 기준(base='SCHEDULE')이면 앞선 예약의
    // 대상 버전이 "실행 시점 기준값"이다. `preview.expectedProdVersionId`(environment/core가 계산한
    // "지금의 실제 운영")를 그대로 쓰면 체인일 때 생성 단계에서 409 ENV_POINTER_STALE가 난다.
    const expectedProdVersionId = binding.base === 'SCHEDULE' ? binding.targetVersionId : preview.expectedProdVersionId;

    return {
      preconditionFailures,
      switchProd: {
        base: binding.base,
        expectedProdVersionId,
        targetVersion: { id: preview.target.versionId, versionNo: preview.target.versionNo },
        gate: preview.gate,
        blockers: preview.blockers,
        warnings: preview.warnings,
      },
    };
  }

  async resolveForInsert(tx: Prisma.TransactionClient, ctx: InsertContext<'SWITCH_PROD_VERSION'>): Promise<DerivedFields> {
    // R2 — 전환 체인은 뒤에만 붙는다.
    if (hasLaterActiveSwitch(ctx.activeSwitchSiblings, ctx.scheduledAt)) {
      throw new ApiException('DEPLOY_SCHEDULE_PRECONDITION_FAILED', 409, '이 챗봇에는 이 예약보다 늦은 전환 예약이 이미 있습니다.', [
        { field: 'precondition', message: 'CHAIN_ORDER' },
      ]);
    }

    const binding = resolveSwitchBinding(ctx.activeSwitchSiblings, ctx.scheduledAt);

    let expectedProdVersionId: string;
    let predecessorScheduleId: string | null = null;
    if (binding.base === 'CURRENT') {
      const chatbot = await tx.chatbot.findUnique({ where: { id: ctx.chatbotId }, select: { prodVersionId: true } });
      if (!chatbot?.prodVersionId) {
        throw new ApiException('ENV_MODE_DISABLED', 409, '환경 분리 모드가 꺼져 있어 운영 전환을 예약할 수 없습니다.');
      }
      expectedProdVersionId = chatbot.prodVersionId;
    } else {
      // 체인 기준 — 선행 예약의 대상 버전이 실행되면 그 버전이 새 운영이 된다.
      expectedProdVersionId = binding.targetVersionId;
      predecessorScheduleId = binding.scheduleId;
    }

    // R4 — 미리보기 이후 기준이 달라지면 거부.
    if (ctx.previewedContentHash !== undefined && ctx.previewedContentHash !== expectedProdVersionId) {
      throw new ApiException('ENV_POINTER_STALE', 409, '미리보기 이후 기준 상태가 변경되었습니다. 차이를 다시 확인해 주세요.');
    }

    const targetVersion = await tx.chatbotVersion.findUnique({ where: { id: ctx.params.targetVersionId } });
    if (!targetVersion || targetVersion.chatbotId !== ctx.chatbotId) {
      throw new ApiException('NOT_FOUND', 404, '요청하신 버전을 찾을 수 없습니다.');
    }

    return {
      targetVersionId: targetVersion.id,
      targetVersionNo: targetVersion.versionNo,
      // [신규 No.40] `expectedContentHash` 컬럼(재사용) = 기준 버전 id(내용 해시가 아니다 — RESTORE_VERSION의
      // "기준 해시" 재사용 규약과 같은 컬럼을 다른 의미로 쓴다, 스키마 변경 0).
      expectedContentHash: expectedProdVersionId,
      predecessorScheduleId,
    };
  }

  async execute(ctx: ExecutionContext<'SWITCH_PROD_VERSION'>): Promise<ExecutionOutcome> {
    const chatbot = await this.prisma.chatbot.findUnique({ where: { id: ctx.chatbotId }, select: { status: true, prodVersionId: true } });
    if (!chatbot) return { kind: 'PERMANENT', reason: 'CHATBOT_NOT_FOUND' };
    if (chatbot.status === 'ARCHIVED') return { kind: 'PERMANENT', reason: 'CHATBOT_ARCHIVED' };
    if (!chatbot.prodVersionId) return { kind: 'PERMANENT', reason: 'STATE_CHANGED' }; // 방어 — 끄기가 CANCELLED로 정리한다.

    const targetVersion = await this.prisma.chatbotVersion.findUnique({ where: { id: ctx.params.targetVersionId }, select: { id: true, chatbotId: true, versionNo: true } });
    if (!targetVersion || targetVersion.chatbotId !== ctx.chatbotId) return { kind: 'PERMANENT', reason: 'TARGET_VERSION_MISSING' };

    if (chatbot.prodVersionId !== ctx.expectedContentHash) return { kind: 'PERMANENT', reason: 'STATE_CHANGED' };

    const invocation: ScheduledInvocation = {
      actor: { id: ctx.actor.id, email: ctx.actor.email, role: ctx.actor.role },
      auditSummaryPrefix: ctx.auditSummaryPrefix,
      triggerContext: { deployScheduleId: ctx.deployScheduleId },
    };

    try {
      // [D-12] `deploy-schedules/**`는 시계를 직접 호출하지 않는다 — `now`를 생략하면
      // `ProdSwitchService`(environment/core, 스캔 대상 밖)가 기본값을 채운다.
      const response = await this.prodSwitch.switch(
        ctx.chatbotId,
        { targetVersionId: ctx.params.targetVersionId, expectedProdVersionId: ctx.expectedContentHash ?? '', acknowledgeWarnings: true },
        'SWITCH',
        { actor: invocation.actor, auditSummaryPrefix: invocation.auditSummaryPrefix, deployScheduleId: ctx.deployScheduleId },
      );
      const summary = { kind: 'SWITCH_PROD' as const, fromVersionNo: response.fromVersionNo, toVersionNo: response.prod.versionNo };
      return { kind: response.outcome === 'APPLIED' ? 'APPLIED' : 'NOOP', summary };
    } catch (e) {
      return classifyExecutionError(e);
    }
  }

  async judgeRecovery(ctx: RecoveryContext<'SWITCH_PROD_VERSION'>): Promise<RecoveryVerdictOutcome> {
    const committed = await this.prisma.environmentSwitchLog.findFirst({
      where: { chatbotId: ctx.chatbotId, deployScheduleId: ctx.deployScheduleId },
      select: { fromVersionNo: true, toVersionNo: true },
    });
    if (committed) {
      return {
        kind: 'RECOVERED',
        summary: { kind: 'SWITCH_PROD', fromVersionNo: committed.fromVersionNo ?? 0, toVersionNo: committed.toVersionNo ?? 0 },
      };
    }

    const chatbot = await this.prisma.chatbot.findUnique({ where: { id: ctx.chatbotId }, select: { prodVersionId: true } });
    if (chatbot?.prodVersionId === ctx.params.targetVersionId) {
      return { kind: 'NOOP', summary: { kind: 'SWITCH_PROD', fromVersionNo: 0, toVersionNo: 0 } };
    }
    return { kind: 'INTERRUPTED' };
  }
}
