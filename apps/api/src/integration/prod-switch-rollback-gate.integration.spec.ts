import type { ProdSwitchApprovalSummary } from '@chat-bot/shared-types';
import { DeploySchedulesEngine } from '../deploy-schedules/engine/deploy-schedule.engine';
import { FakeClock, bootHarness } from './helpers/ai-guardrails.harness';
import type { Harness } from './helpers/ai-guardrails.harness';
import { promoteStaging, setNodeText, setupApprovalBot, switchRequestBody } from './helpers/ai-guardrails-approval.helpers';
import type { ApprovalBot } from './helpers/ai-guardrails-approval.helpers';

/**
 * N40-1 보강 시험(코드 리뷰 낮음-6/8) — 게이트 완화는 "직전 운영 버전 롤백"에만. 2인 승인 실행 경로 · 예약 실행기 경로 ·
 * 폴백(이력 1건·같은 버전·환경 모드 꺼짐) · preview/switch 판정 동일성(`directRollback` 응답 필드).
 */
interface ApiErr {
  code: string;
  details?: Array<{ field: string; message: string }>;
}
interface Preview {
  kind: string;
  gate: { verdict: string };
  blockers: string[];
  directRollback?: boolean;
  outcome: string;
}

describe('N40-1 롤백 게이트 — 직전 운영 버전에만 완화(통합)', () => {
  let h: Harness & { moduleRef: { get: <T>(token: new (...args: never[]) => T) => T } };
  let clock: FakeClock;
  let engine: DeploySchedulesEngine;

  beforeAll(async () => {
    clock = new FakeClock(new Date('2026-03-01T00:00:00.000Z'));
    h = (await bootHarness({ tmpPrefix: 'prod-switch-rollback-gate-', clock })) as typeof h;
    engine = h.moduleRef.get(DeploySchedulesEngine);
  }, 90_000);

  afterAll(async () => {
    await h?.close();
  }, 20_000);

  const requestPath = (chatbotId: string, id?: string, verb?: string) => `/chatbots/${chatbotId}/environment/approval/requests${id ? `/${id}` : ''}${verb ? `/${verb}` : ''}`;
  const prodOf = async (chatbotId: string) => (await h.prisma.chatbot.findUnique({ where: { id: chatbotId }, select: { prodVersionId: true } }))!.prodVersionId;
  const preview = (chatbotId: string, body: Record<string, unknown>) => h.admin<Preview>('POST', `/chatbots/${chatbotId}/environment/prod/preview`, body);

  async function setBlockGate(chatbotId: string): Promise<void> {
    const set = await h.admin<{ id: string }>('POST', `/chatbots/${chatbotId}/test-sets`, { name: `차단세트-${chatbotId.slice(0, 6)}` });
    const gate = await h.admin('PUT', `/chatbots/${chatbotId}/environment/gate`, { mode: 'BLOCK', testSetId: set.body.id, minPassRate: 95, validHours: 24 });
    expect(gate.status).toBe(200);
  }

  /** 정책 꺼진 챗봇에서 v1 → v2 → v3(현재 운영)까지 직접 전환한다. */
  async function threeVersionBot(prefix: string): Promise<ApprovalBot & { v3Id: string }> {
    const bot = await setupApprovalBot(h, prefix, { policy: false });
    const s1 = await h.admin('POST', `/chatbots/${bot.id}/environment/prod/switch`, { targetVersionId: bot.v2Id, expectedProdVersionId: bot.v1Id, acknowledgeWarnings: true });
    expect(s1.status).toBe(201);
    await setNodeText(h, bot.id, bot.nodeId, '응답-v3');
    const v3Id = await promoteStaging(h, bot.id);
    const s2 = await h.admin('POST', `/chatbots/${bot.id}/environment/prod/switch`, { targetVersionId: v3Id, expectedProdVersionId: bot.v2Id, acknowledgeWarnings: true });
    expect(s2.status).toBe(201);
    return { ...bot, v3Id };
  }

  it('④ preview와 switch의 판정이 같다 — 직전은 directRollback=true·WARN·201, 비직전은 false·BLOCK·409, SWITCH 응답에는 키가 없다', async () => {
    const bot = await threeVersionBot('판정동일');
    await setBlockGate(bot.id);

    const far = await preview(bot.id, { kind: 'ROLLBACK', targetVersionId: bot.v1Id });
    expect(far.body).toMatchObject({ kind: 'ROLLBACK', directRollback: false });
    expect(far.body.gate.verdict).toBe('BLOCK');
    expect(far.body.blockers).toContain('GATE_BLOCKED');
    const farRes = await h.admin<ApiErr>('POST', `/chatbots/${bot.id}/environment/prod/rollback`, { targetVersionId: bot.v1Id, expectedProdVersionId: bot.v3Id, acknowledgeWarnings: true });
    expect(farRes.status).toBe(409);
    expect(farRes.body.code).toBe('ENV_GATE_NOT_PASSED');

    const sw = await preview(bot.id, { kind: 'SWITCH', targetVersionId: bot.v1Id });
    expect('directRollback' in sw.body).toBe(false);
    expect(sw.body.gate.verdict).toBe('BLOCK');

    // 대상 생략 = 서버가 직전 버전을 고른다 → directRollback true.
    const auto = await preview(bot.id, { kind: 'ROLLBACK' });
    expect(auto.body).toMatchObject({ directRollback: true });
    expect(auto.body.gate.verdict).toBe('WARN');
    expect(auto.body.blockers).not.toContain('GATE_BLOCKED');
    const direct = await h.admin('POST', `/chatbots/${bot.id}/environment/prod/rollback`, { expectedProdVersionId: bot.v3Id, acknowledgeWarnings: true });
    expect(direct.status).toBe(201);
    expect(await prodOf(bot.id)).toBe(bot.v2Id);
  });

  it('① 2인 승인이 켜져도 비직전 이력 버전 롤백은 승인 후에도 BLOCK이면 409 ENV_GATE_NOT_PASSED(승인은 FAILED로 기록·포인터 불변)', async () => {
    const bot = await setupApprovalBot(h, '승인롤백BLOCK');
    const first = await h.admin<ProdSwitchApprovalSummary>('POST', requestPath(bot.id), await switchRequestBody(h, bot.id, bot.v2Id));
    await h.admin2('POST', requestPath(bot.id, first.body.id, 'approve'), { acknowledgeWarnings: true });
    await setNodeText(h, bot.id, bot.nodeId, '응답-v3');
    const v3Id = await promoteStaging(h, bot.id);
    const second = await h.admin<ProdSwitchApprovalSummary>('POST', requestPath(bot.id), await switchRequestBody(h, bot.id, v3Id));
    await h.admin2('POST', requestPath(bot.id, second.body.id, 'approve'), { acknowledgeWarnings: true });
    expect(await prodOf(bot.id)).toBe(v3Id);

    // 비직전(v1) 롤백 승인 요청을 먼저 만든 뒤 게이트를 차단으로 바꾼다.
    const req = await h.admin<ProdSwitchApprovalSummary & ApiErr>('POST', requestPath(bot.id), await switchRequestBody(h, bot.id, bot.v1Id, 'ROLLBACK'));
    expect(req.status).toBe(201);
    await setBlockGate(bot.id);
    const approve = await h.admin2<ApiErr>('POST', requestPath(bot.id, req.body.id, 'approve'), { acknowledgeWarnings: true });
    expect(approve.status).toBe(409);
    expect(approve.body.code).toBe('ENV_GATE_NOT_PASSED');
    const row = await h.prisma.prodSwitchApprovalRequest.findUnique({ where: { id: req.body.id } });
    expect(row).toMatchObject({ status: 'APPROVED', outcome: 'FAILED', failureCode: 'ENV_GATE_NOT_PASSED' });
    expect(await prodOf(bot.id)).toBe(v3Id);

    // 직전(v2) 단독 롤백은 같은 BLOCK 게이트에서도 기존대로 즉시(예외 유지 — 회귀 없음).
    const direct = await h.admin('POST', `/chatbots/${bot.id}/environment/prod/rollback`, { expectedProdVersionId: v3Id, acknowledgeWarnings: true });
    expect(direct.status).toBe(201);
    expect(await prodOf(bot.id)).toBe(bot.v2Id);
  });

  it('② 예약 실행기 경로 — 이력의 과거 버전으로 예약된 전환은 BLOCK이면 GATE_NOT_PASSED로 실패하고 운영은 불변', async () => {
    const bot = await threeVersionBot('예약과거');
    const scheduledAt = new Date(clock.now().getTime() + 10 * 60_000);
    const created = await h.admin<{ schedule: { id: string } }>('POST', `/chatbots/${bot.id}/deploy-schedules`, {
      action: 'SWITCH_PROD_VERSION',
      targetVersionId: bot.v1Id,
      previewedProdVersionId: bot.v3Id,
      scheduledAt: scheduledAt.toISOString(),
      acknowledgeWarnings: true,
    });
    expect(created.status).toBe(201);
    await setBlockGate(bot.id);
    clock.advance(10 * 60_000 + 5_000);
    await engine.tick();
    const row = await h.prisma.deploySchedule.findUnique({ where: { id: created.body.schedule.id } });
    expect(row).toMatchObject({ status: 'FAILED', failureReason: 'GATE_NOT_PASSED' });
    expect(await prodOf(bot.id)).toBe(bot.v3Id);
  });

  it('③ 폴백 — 이력 1건(직전 없음)·같은 버전 반복·환경 모드 꺼짐에서는 directRollback=false(완화 없음)', async () => {
    // 이력 1건: 운영 v1뿐 — 직전 버전이 없다.
    const one = await setupApprovalBot(h, '이력1건', { policy: false });
    const noTarget = await preview(one.id, { kind: 'ROLLBACK' });
    expect(noTarget.status).toBe(200);
    expect(noTarget.body.directRollback).toBe(false);
    expect(noTarget.body.blockers).toContain('TARGET_NOT_ALLOWED');

    // 같은 버전 반복: 대상 = 현재 운영 → NOOP, 완화 대상 아님.
    const same = await preview(one.id, { kind: 'ROLLBACK', targetVersionId: one.v1Id });
    expect(same.body.directRollback).toBe(false);
    expect(same.body.outcome).toBe('NOOP');

    // 환경 모드 꺼짐: 운영 포인터가 없다.
    const off = await h.createChatbot('모드꺼짐롤백');
    const offPreview = await preview(off.id, { kind: 'ROLLBACK', targetVersionId: one.v1Id });
    expect(offPreview.body.directRollback).toBe(false);
    expect(offPreview.body.blockers).toContain('ENV_MODE_DISABLED');
  });

  it('⑤ 2인 승인 경로 — 승인 상세의 재확인 미리보기(livePreview)에도 ROLLBACK이면 directRollback 키가 실리고 SWITCH면 생략된다(웹 위임 전제)', async () => {
    const bot = await setupApprovalBot(h, '승인상세키');
    const first = await h.admin<ProdSwitchApprovalSummary>('POST', requestPath(bot.id), await switchRequestBody(h, bot.id, bot.v2Id));
    await h.admin2('POST', requestPath(bot.id, first.body.id, 'approve'), { acknowledgeWarnings: true });
    await setNodeText(h, bot.id, bot.nodeId, '응답-v3');
    const v3Id = await promoteStaging(h, bot.id);
    const second = await h.admin<ProdSwitchApprovalSummary>('POST', requestPath(bot.id), await switchRequestBody(h, bot.id, v3Id));
    await h.admin2('POST', requestPath(bot.id, second.body.id, 'approve'), { acknowledgeWarnings: true });
    expect(await prodOf(bot.id)).toBe(v3Id);

    // 요청 생성 전 미리보기(승인 요청 미리보기) — 직전/비직전 모두 키 존재.
    expect((await preview(bot.id, { kind: 'ROLLBACK', targetVersionId: bot.v2Id })).body.directRollback).toBe(true);
    expect((await preview(bot.id, { kind: 'ROLLBACK', targetVersionId: bot.v1Id })).body.directRollback).toBe(false);

    type Detail = { livePreview: (Preview & { approval?: unknown }) | null };
    const far = await h.admin<ProdSwitchApprovalSummary>('POST', requestPath(bot.id), await switchRequestBody(h, bot.id, bot.v1Id, 'ROLLBACK'));
    expect(far.status).toBe(201);
    const farDetail = await h.admin<Detail>('GET', requestPath(bot.id, far.body.id));
    expect(farDetail.body.livePreview).toMatchObject({ kind: 'ROLLBACK', directRollback: false });
    await h.admin2('POST', requestPath(bot.id, far.body.id, 'reject'), { reason: '시험 정리' });

    const near = await h.admin<ProdSwitchApprovalSummary>('POST', requestPath(bot.id), await switchRequestBody(h, bot.id, bot.v2Id, 'ROLLBACK'));
    expect(near.status).toBe(201);
    const nearDetail = await h.admin<Detail>('GET', requestPath(bot.id, near.body.id));
    expect(nearDetail.body.livePreview).toMatchObject({ kind: 'ROLLBACK', directRollback: true });
    await h.admin2('POST', requestPath(bot.id, near.body.id, 'reject'), { reason: '시험 정리' });

    // SWITCH 요청 상세에는 키가 없다(기존 응답과 바이트 동일).
    const sw = await h.admin<ProdSwitchApprovalSummary>('POST', requestPath(bot.id), await switchRequestBody(h, bot.id, bot.v1Id));
    expect(sw.status).toBe(201);
    const swDetail = await h.admin<Detail>('GET', requestPath(bot.id, sw.body.id));
    expect(swDetail.body.livePreview).not.toBeNull();
    expect('directRollback' in (swDetail.body.livePreview as object)).toBe(false);
  });
});
