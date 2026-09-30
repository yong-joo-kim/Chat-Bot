import type { ApprovalPolicyStatus, ApproveProdSwitchResponse, ProdSwitchApprovalSummary, ProdSwitchApprovalDetail, ApprovalSummaryResponse, Paginated } from '@chat-bot/shared-types';
import { FakeClock, bootHarness } from './helpers/ai-guardrails.harness';
import type { Harness } from './helpers/ai-guardrails.harness';
import { promoteStaging, setNodeText, setupApprovalBot, switchRequestBody } from './helpers/ai-guardrails-approval.helpers';

/**
 * 운영 전환 2인 승인(No.36) 통합 시험 — `ai-guardrails-설계.md` §10 · §18.2 · AC-AG6-1~6·8~10. 예약 결합(AC-AG6-7)은
 * `prod-switch-approval-schedule.integration.spec.ts`. 시계는 `CLOCK` 오버라이드 1곳으로 승인 서비스·예약 실행기가 함께 쓴다.
 * 활성 `chatbot:deploy` 보유자 두 명 = 하네스의 ADMIN(`admin`)과 2번째 ADMIN(`admin2`).
 */
interface ApiErr {
  code: string;
  details?: Array<{ field: string; message: string }>;
}

describe('운영 전환 2인 승인(No.36) 통합 시험', () => {
  let h: Harness;
  let clock: FakeClock;

  beforeAll(async () => {
    clock = new FakeClock(new Date('2026-03-01T00:00:00.000Z'));
    h = await bootHarness({ tmpPrefix: 'prod-switch-approval-', clock });
  }, 90_000);

  afterAll(async () => {
    await h?.close();
  }, 20_000);

  const detailOf = (e: ApiErr, field: string) => e.details?.find((d) => d.field === field)?.message;
  const prodOf = async (chatbotId: string) => (await h.prisma.chatbot.findUnique({ where: { id: chatbotId }, select: { prodVersionId: true } }))!.prodVersionId;
  const requestPath = (chatbotId: string, id?: string, verb?: string) => `/chatbots/${chatbotId}/environment/approval/requests${id ? `/${id}` : ''}${verb ? `/${verb}` : ''}`;

  async function createRequest(chatbotId: string, target: string, by: Harness['admin'] = h.admin) {
    const res = await by<ProdSwitchApprovalSummary & ApiErr>('POST', requestPath(chatbotId), await switchRequestBody(h, chatbotId, target));
    return res;
  }

  describe('정책 켜기·끄기', () => {
    it('AC-AG6-1: 활성 승인 가능자(chatbot:deploy)가 2명 미만이면 켜기 409(NOT_ENOUGH_APPROVERS) — 사용자가 늘면 켤 수 있다', async () => {
      const bot = await setupApprovalBot(h, '정책켜기', { policy: false });
      await h.prisma.user.updateMany({ where: { email: 'integration-test-admin2@chat-bot.local' }, data: { status: 'DISABLED' } });
      try {
        const res = await h.admin<ApiErr>('PUT', `/chatbots/${bot.id}/environment/approval`, { required: true, ttlHours: 24 });
        expect(res.status).toBe(409);
        expect(res.body.code).toBe('APPROVAL_POLICY_UNAVAILABLE');
        expect(detailOf(res.body, 'reason')).toBe('NOT_ENOUGH_APPROVERS');
      } finally {
        await h.prisma.user.updateMany({ where: { email: 'integration-test-admin2@chat-bot.local' }, data: { status: 'ACTIVE' } });
      }
      const ok = await h.admin<ApprovalPolicyStatus>('PUT', `/chatbots/${bot.id}/environment/approval`, { required: true, ttlHours: 12 });
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ policy: { required: true, ttlHours: 12 }, envModeOn: true, eligibleApproverCount: 2, otherApproverCount: 1, offLocked: false });
      const env = await h.admin<{ approval?: { required: boolean; ttlHours: number } }>('GET', `/chatbots/${bot.id}/environment`);
      expect(env.body.approval).toEqual({ required: true, ttlHours: 12 });
    });

    it('AC-AG6-10: 환경 모드가 꺼진 챗봇은 켜기 409(ENV_MODE_DISABLED)', async () => {
      const bot = await h.createChatbot('모드꺼짐');
      const res = await h.admin<ApiErr>('PUT', `/chatbots/${bot.id}/environment/approval`, { required: true, ttlHours: 24 });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('APPROVAL_POLICY_UNAVAILABLE');
      expect(detailOf(res.body, 'reason')).toBe('ENV_MODE_DISABLED');
    });

    it('EDITOR·VIEWER는 정책 변경·요청 생성 403, 조회는 chatbot:read+dialogue:read', async () => {
      const bot = await setupApprovalBot(h, '권한');
      expect((await h.editor('PUT', `/chatbots/${bot.id}/environment/approval`, { required: false, ttlHours: 24 })).status).toBe(403);
      expect((await h.editor('POST', requestPath(bot.id), { action: 'PROD_SWITCH', targetVersionId: bot.v2Id, expectedProdVersionId: bot.v1Id })).status).toBe(403);
      expect((await h.editor('GET', '/environment-approvals')).status).toBe(403);
      expect((await h.viewer('GET', `/chatbots/${bot.id}/environment/approval`)).status).toBe(200);
    });

    it('정책이 켜져 있으면 환경 모드 끄기는 409(ENV_APPROVAL_REQUIRED · POLICY_ACTIVE)이고 미리보기에 표시된다', async () => {
      const bot = await setupApprovalBot(h, '끄기차단');
      const preview = await h.admin<{ approvalPolicyActive?: true }>('POST', `/chatbots/${bot.id}/environment/disable/preview`);
      expect(preview.status).toBe(200);
      expect(preview.body.approvalPolicyActive).toBe(true);

      const draft = await h.admin<{ draftContentHash: string; prodContentHash: string }>('POST', `/chatbots/${bot.id}/environment/disable/preview`);
      const res = await h.admin<ApiErr>('POST', `/chatbots/${bot.id}/environment/disable`, { mode: 'KEEP_PROD', expectedProdVersionId: bot.v1Id, expectedDraftHash: draft.body.draftContentHash });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('ENV_APPROVAL_REQUIRED');
      expect(detailOf(res.body, 'reason')).toBe('POLICY_ACTIVE');
      expect(await prodOf(bot.id)).toBe(bot.v1Id);
    });
  });

  describe('요청 → 승인', () => {
    it('AC-AG6-2·3·4: 즉시 전환은 409로 막히고 요청만 가능하며, 요청자는 승인할 수 없고(403 + PERMISSION_DENIED), 다른 관리자의 승인이 전환·이력 표식·감사를 만든다', async () => {
      const bot = await setupApprovalBot(h, '승인흐름');

      // AC-AG6-2 — 기존 전환 API는 정책이 켜지면 409, 포인터 불변.
      const direct = await h.admin<ApiErr>('POST', `/chatbots/${bot.id}/environment/prod/switch`, { targetVersionId: bot.v2Id, expectedProdVersionId: bot.v1Id, acknowledgeWarnings: true });
      expect(direct.status).toBe(409);
      expect(direct.body.code).toBe('ENV_APPROVAL_REQUIRED');
      expect(detailOf(direct.body, 'reason')).toBe('APPROVAL_REQUIRED');
      expect(await prodOf(bot.id)).toBe(bot.v1Id);

      const preview = await h.admin<{ approval?: { required: true } }>('POST', `/chatbots/${bot.id}/environment/prod/preview`, { kind: 'SWITCH', targetVersionId: bot.v2Id });
      expect(preview.body.approval).toEqual({ required: true });

      const created = await createRequest(bot.id, bot.v2Id);
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ status: 'PENDING', action: 'PROD_SWITCH', canApprove: false, canCancel: true, target: { versionId: bot.v2Id }, base: { versionId: bot.v1Id } });
      expect(await prodOf(bot.id)).toBe(bot.v1Id);

      // 두 번째 요청은 대기 1건 제약.
      const dup = await createRequest(bot.id, bot.v2Id);
      expect(dup.status).toBe(409);
      expect(dup.body.code).toBe('APPROVAL_PENDING_EXISTS');
      expect(detailOf(dup.body, 'requestId')).toBe(created.body.id);

      // AC-AG6-3 — 요청자 본인은 승인·반려 불가(서버 강제) + 시도 감사.
      const self = await h.admin<ApiErr>('POST', requestPath(bot.id, created.body.id, 'approve'), { acknowledgeWarnings: true });
      expect(self.status).toBe(403);
      expect(self.body.code).toBe('APPROVAL_SELF_FORBIDDEN');
      expect((await h.admin<ApiErr>('POST', requestPath(bot.id, created.body.id, 'reject'), {})).status).toBe(403);
      const denied = await h.prisma.auditLog.count({ where: { action: 'PERMISSION_DENIED', summary: { contains: '본인이 요청한 운영 전환' } } });
      expect(denied).toBeGreaterThanOrEqual(1);
      expect(await prodOf(bot.id)).toBe(bot.v1Id);

      // 전역 화면 — 요청자에게는 "내가 처리할 것"이 아니고, 다른 관리자에게는 처리 대상이다.
      const mine = await h.admin<ApprovalSummaryResponse>('GET', '/environment-approvals/summary');
      const theirs = await h.admin2<ApprovalSummaryResponse>('GET', '/environment-approvals/summary');
      expect(theirs.body.pendingForMe).toBeGreaterThanOrEqual(mine.body.pendingForMe + 1);
      const list = await h.admin2<Paginated<ProdSwitchApprovalSummary>>('GET', '/environment-approvals?status=PENDING');
      expect(list.body.items.find((i) => i.id === created.body.id)).toMatchObject({ canApprove: true, chatbotName: expect.any(String) });

      // 상세(대기 요청은 현재 운영 기준 미리보기 동반).
      const detail = await h.admin2<ProdSwitchApprovalDetail>('GET', requestPath(bot.id, created.body.id));
      expect(detail.body.livePreview?.target.versionId).toBe(bot.v2Id);

      // AC-AG6-4 — 다른 관리자의 승인이 전환을 실행한다(같은 트랜잭션 선점).
      const approved = await h.admin2<ApproveProdSwitchResponse & ApiErr>('POST', requestPath(bot.id, created.body.id, 'approve'), { acknowledgeWarnings: true });
      expect(approved.status).toBe(200);
      expect(approved.body.request).toMatchObject({ status: 'APPROVED', outcome: 'APPLIED', decidedBy: { email: 'integration-test-admin2@chat-bot.local' } });
      expect(approved.body.switch).toMatchObject({ outcome: 'APPLIED', prod: { versionId: bot.v2Id } });
      expect(await prodOf(bot.id)).toBe(bot.v2Id);

      const history = await h.admin<Paginated<{ method: string; approvalMode?: string; approvalRequestId?: string; actorEmail: string | null }>>('GET', `/chatbots/${bot.id}/environment/history?environment=PROD`);
      expect(history.body.items[0]).toMatchObject({ method: 'IMMEDIATE', approvalMode: 'APPROVED', approvalRequestId: created.body.id, actorEmail: 'integration-test-admin2@chat-bot.local' });

      const audits = await h.prisma.auditLog.findMany({ where: { targetType: 'ProdSwitchApprovalRequest', targetId: created.body.id }, orderBy: { createdAt: 'asc' } });
      expect(audits.map((a) => a.action)).toEqual(['CREATE', 'STATUS_CHANGE']);
      expect(audits.every((a) => !(a.summary ?? '').includes('사유'))).toBe(true);
      const switchAudit = await h.prisma.auditLog.findFirst({ where: { targetType: 'ChatbotEnvironment', targetId: bot.id, summary: { contains: '[2인 승인' } } });
      expect(switchAudit).not.toBeNull();

      // 공개 응답도 v2로 바뀐다.
      const pub = await h.pub<{ outputs: Array<{ payload?: { text?: string } }> }>('POST', `/public/chatbots/${bot.slug}/messages`, { sessionId: h.sessionUuid(), message: `${bot.keyword} 문의` });
      expect(pub.body.outputs[0].payload?.text).toBe('응답-v2');

      // 이미 처리된 요청은 다시 승인할 수 없다.
      const again = await h.admin2<ApiErr>('POST', requestPath(bot.id, created.body.id, 'approve'), { acknowledgeWarnings: true });
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('APPROVAL_NOT_PENDING');
      expect(detailOf(again.body, 'status')).toBe('APPROVED');
    });

    it('반려(메모는 마스킹) · 요청자 취소 · 취소 권한(요청자만)', async () => {
      const bot = await setupApprovalBot(h, '반려취소');
      const first = await createRequest(bot.id, bot.v2Id);
      const rejected = await h.admin2<ProdSwitchApprovalSummary>('POST', requestPath(bot.id, first.body.id, 'reject'), { note: '연락처 010-1234-5678 로 문의 바랍니다' });
      expect(rejected.status).toBe(200);
      expect(rejected.body).toMatchObject({ status: 'REJECTED', decisionNote: '연락처 010-****-5678 로 문의 바랍니다' });
      expect(await prodOf(bot.id)).toBe(bot.v1Id);

      const second = await createRequest(bot.id, bot.v2Id);
      expect(second.status).toBe(201);
      const forbidden = await h.admin2<ApiErr>('POST', requestPath(bot.id, second.body.id, 'cancel'));
      expect(forbidden.status).toBe(403);
      expect(forbidden.body.code).toBe('FORBIDDEN');
      const cancelled = await h.admin<ProdSwitchApprovalSummary>('POST', requestPath(bot.id, second.body.id, 'cancel'));
      expect(cancelled.body).toMatchObject({ status: 'CANCELLED', closedReason: 'REQUESTER' });

      // 교차 챗봇 접근은 404.
      const other = await setupApprovalBot(h, '교차');
      expect((await h.admin2('GET', requestPath(other.id, second.body.id))).status).toBe(404);
    });

    it('AC-AG6-5: 요청 뒤 운영 버전이 바뀌면(직전 롤백) 승인은 409 APPROVAL_BASE_CHANGED이고 요청은 종료된다', async () => {
      const bot = await setupApprovalBot(h, '기준변경');
      // v1 → v2를 승인으로 전환해 운영 이력을 만든다(직전 롤백 대상 = v1).
      const first = await createRequest(bot.id, bot.v2Id);
      expect((await h.admin2('POST', requestPath(bot.id, first.body.id, 'approve'), { acknowledgeWarnings: true })).status).toBe(200);

      await setNodeText(h, bot.id, bot.nodeId, '응답-v3');
      const v3Id = await promoteStaging(h, bot.id);
      const pending = await createRequest(bot.id, v3Id);
      expect(pending.status).toBe(201);

      // 단독 롤백(직전 버전 v1)이 운영 포인터를 바꾼다.
      const rollback = await h.admin<{ outcome: string }>('POST', `/chatbots/${bot.id}/environment/prod/rollback`, { expectedProdVersionId: bot.v2Id, acknowledgeWarnings: true });
      expect(rollback.status).toBe(201);
      expect(await prodOf(bot.id)).toBe(bot.v1Id);

      const res = await h.admin2<ApiErr>('POST', requestPath(bot.id, pending.body.id, 'approve'), { acknowledgeWarnings: true });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('APPROVAL_BASE_CHANGED');
      const row = await h.prisma.prodSwitchApprovalRequest.findUnique({ where: { id: pending.body.id } });
      expect(row).toMatchObject({ status: 'CANCELLED', closedReason: 'BASE_CHANGED', pendingLock: null });
      expect(await prodOf(bot.id)).toBe(bot.v1Id);
    });

    it('AC-AG6-6: 만료된 요청은 승인 시도가 409(APPROVAL_NOT_PENDING · EXPIRED)이고 상태가 EXPIRED로 확정된다(루프 없이 조회·변경 시점 판정)', async () => {
      const bot = await setupApprovalBot(h, '만료');
      const created = await createRequest(bot.id, bot.v2Id);
      expect(created.status).toBe(201);
      clock.advance(25 * 3_600_000);

      const res = await h.admin2<ApiErr>('POST', requestPath(bot.id, created.body.id, 'approve'), { acknowledgeWarnings: true });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('APPROVAL_NOT_PENDING');
      expect(detailOf(res.body, 'status')).toBe('EXPIRED');
      const row = await h.prisma.prodSwitchApprovalRequest.findUnique({ where: { id: created.body.id } });
      expect(row).toMatchObject({ status: 'EXPIRED', pendingLock: null });
      expect(await prodOf(bot.id)).toBe(bot.v1Id);
      const audit = await h.prisma.auditLog.findFirst({ where: { targetType: 'ProdSwitchApprovalRequest', targetId: created.body.id, action: 'STATUS_CHANGE' } });
      expect(audit?.actorEmail).toBe('system');

      // 만료 뒤에는 새 요청을 만들 수 있다(대기 1건 제약 해제).
      const fresh = await createRequest(bot.id, bot.v2Id);
      expect(fresh.status).toBe(201);
    });

    it('조회만으로도 지연 종결이 확정된다(승인 현황 조회 = 종결 수행)', async () => {
      const bot = await setupApprovalBot(h, '조회종결');
      const created = await createRequest(bot.id, bot.v2Id);
      clock.advance(25 * 3_600_000);
      const status = await h.admin<ApprovalPolicyStatus>('GET', `/chatbots/${bot.id}/environment/approval`);
      expect(status.body.pending).toBeNull();
      expect(status.body.recent[0]).toMatchObject({ id: created.body.id, status: 'EXPIRED' });
    });

    it('AC-AG6-8: 직전 운영 버전 롤백은 단독 즉시(이력 SOLO_ROLLBACK · 감사 접두 · 현황 알림), 그 밖의 이력 버전 롤백은 409', async () => {
      const bot = await setupApprovalBot(h, '단독롤백');
      const first = await createRequest(bot.id, bot.v2Id);
      await h.admin2('POST', requestPath(bot.id, first.body.id, 'approve'), { acknowledgeWarnings: true });
      await setNodeText(h, bot.id, bot.nodeId, '응답-v3');
      const v3Id = await promoteStaging(h, bot.id);
      const second = await createRequest(bot.id, v3Id);
      await h.admin2('POST', requestPath(bot.id, second.body.id, 'approve'), { acknowledgeWarnings: true });
      expect(await prodOf(bot.id)).toBe(v3Id);

      // 비직전(v1) 롤백 — 승인 필요.
      const preview = await h.admin<{ approval?: { required: true; soloRollbackAllowed?: boolean } }>('POST', `/chatbots/${bot.id}/environment/prod/preview`, { kind: 'ROLLBACK', targetVersionId: bot.v1Id });
      expect(preview.body.approval).toEqual({ required: true, soloRollbackAllowed: false });
      const blocked = await h.admin<ApiErr>('POST', `/chatbots/${bot.id}/environment/prod/rollback`, { targetVersionId: bot.v1Id, expectedProdVersionId: v3Id, acknowledgeWarnings: true });
      expect(blocked.status).toBe(409);
      expect(blocked.body.code).toBe('ENV_APPROVAL_REQUIRED');
      expect(await prodOf(bot.id)).toBe(v3Id);

      // 직전(v2) 롤백 — 즉시.
      const direct = await h.admin<ProdSwitchApprovalSummary>('POST', `/chatbots/${bot.id}/environment/prod/rollback`, { expectedProdVersionId: v3Id, acknowledgeWarnings: true });
      expect(direct.status).toBe(201);
      expect(await prodOf(bot.id)).toBe(bot.v2Id);
      const history = await h.admin<Paginated<{ method: string; approvalMode?: string }>>('GET', `/chatbots/${bot.id}/environment/history?environment=PROD`);
      expect(history.body.items[0]).toMatchObject({ method: 'ROLLBACK', approvalMode: 'SOLO_ROLLBACK' });
      const audit = await h.prisma.auditLog.findFirst({ where: { targetType: 'ChatbotEnvironment', targetId: bot.id, summary: { contains: '직전 버전 단독 롤백' } } });
      expect(audit).not.toBeNull();

      // 가드레일 현황 알림에 표시된다.
      const overview = await h.admin<{ alerts: Array<{ fromVersionNo: number; toVersionNo: number }>; hitl: { envModeOn: boolean; approvalRequired: boolean } }>('GET', `/chatbots/${bot.id}/guardrails/overview`);
      expect(overview.body.alerts).toHaveLength(1);
      expect(overview.body.hitl).toEqual({ envModeOn: true, approvalRequired: true });
    });

    it('AC-AG6-9: 정책을 끄면 대기 요청은 CANCELLED(POLICY_OFF)이고 자동 실행은 없다 — 이후 기존 전환 API가 다시 즉시 동작한다', async () => {
      const bot = await setupApprovalBot(h, '정책끔');
      const created = await createRequest(bot.id, bot.v2Id);
      const off = await h.admin<ApprovalPolicyStatus>('PUT', `/chatbots/${bot.id}/environment/approval`, { required: false, ttlHours: 24 });
      expect(off.status).toBe(200);
      const row = await h.prisma.prodSwitchApprovalRequest.findUnique({ where: { id: created.body.id } });
      expect(row).toMatchObject({ status: 'CANCELLED', closedReason: 'POLICY_OFF', pendingLock: null });
      expect(await prodOf(bot.id)).toBe(bot.v1Id);

      const direct = await h.admin('POST', `/chatbots/${bot.id}/environment/prod/switch`, { targetVersionId: bot.v2Id, expectedProdVersionId: bot.v1Id, acknowledgeWarnings: true });
      expect(direct.status).toBe(201);
      const history = await h.admin<Paginated<{ approvalMode?: string }>>('GET', `/chatbots/${bot.id}/environment/history?environment=PROD`);
      expect(history.body.items[0].approvalMode).toBeUndefined();
    });
  });

  describe('경합 · 승인 뒤 적용 실패', () => {
    it('같은 챗봇에 동시에 요청 2건 — 1건만 생성되고 나머지는 409 APPROVAL_PENDING_EXISTS(nullable 유일 pendingLock)', async () => {
      const bot = await setupApprovalBot(h, '동시요청');
      const body = await switchRequestBody(h, bot.id, bot.v2Id);
      const results = await Promise.all([h.admin<ApiErr>('POST', requestPath(bot.id), body), h.admin<ApiErr>('POST', requestPath(bot.id), body)]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      const failed = results.find((r) => r.status === 409)!;
      expect(failed.body.code).toBe('APPROVAL_PENDING_EXISTS');
      expect(await h.prisma.prodSwitchApprovalRequest.count({ where: { chatbotId: bot.id, status: 'PENDING' } })).toBe(1);
    });

    it('승인 vs 요청자 취소가 동시에 와도 먼저 커밋된 한쪽만 유효하고 포인터·요청 상태가 어긋나지 않는다', async () => {
      const bot = await setupApprovalBot(h, '승인취소경합');
      const created = await createRequest(bot.id, bot.v2Id);
      const [approve, cancel] = await Promise.all([
        h.admin2<ApiErr & Partial<ApproveProdSwitchResponse>>('POST', requestPath(bot.id, created.body.id, 'approve'), { acknowledgeWarnings: true }),
        h.admin<ApiErr>('POST', requestPath(bot.id, created.body.id, 'cancel')),
      ]);
      const row = await h.prisma.prodSwitchApprovalRequest.findUnique({ where: { id: created.body.id } });
      const prod = await prodOf(bot.id);
      if (approve.status === 200) {
        expect(cancel.status).toBe(409);
        expect(row).toMatchObject({ status: 'APPROVED', outcome: 'APPLIED' });
        expect(prod).toBe(bot.v2Id);
      } else {
        expect(cancel.status).toBe(200);
        expect(row).toMatchObject({ status: 'CANCELLED', closedReason: 'REQUESTER' });
        expect(prod).toBe(bot.v1Id);
      }
      expect(row?.pendingLock).toBeNull();
    });

    it('승인 시점에 게이트가 차단으로 바뀌었으면 원래 오류(ENV_GATE_NOT_PASSED)로 거부하되 승인은 기록(APPROVED/FAILED)하고 포인터는 불변(EX-AG-14)', async () => {
      const bot = await setupApprovalBot(h, '적용실패');
      const created = await createRequest(bot.id, bot.v2Id);
      const set = await h.admin<{ id: string }>('POST', `/chatbots/${bot.id}/test-sets`, { name: '차단게이트세트' });
      // 정책 켠 채 게이트 설정은 허용(운영 전환이 아니다).
      const gate = await h.admin('PUT', `/chatbots/${bot.id}/environment/gate`, { mode: 'BLOCK', testSetId: set.body.id, minPassRate: 95, validHours: 24 });
      expect(gate.status).toBe(200);

      const res = await h.admin2<ApiErr>('POST', requestPath(bot.id, created.body.id, 'approve'), { acknowledgeWarnings: true });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('ENV_GATE_NOT_PASSED');
      expect(detailOf(res.body, 'requestStatus')).toBe('APPROVED');
      expect(detailOf(res.body, 'outcome')).toBe('FAILED');
      const row = await h.prisma.prodSwitchApprovalRequest.findUnique({ where: { id: created.body.id } });
      expect(row).toMatchObject({ status: 'APPROVED', outcome: 'FAILED', failureCode: 'ENV_GATE_NOT_PASSED', pendingLock: null });
      expect(await prodOf(bot.id)).toBe(bot.v1Id);
    });

    it('경고가 있는 전환의 승인에 acknowledgeWarnings가 없으면 400이고 요청은 대기로 남는다', async () => {
      const bot = await setupApprovalBot(h, '경고확인');
      const preview = await h.admin<{ warnings: unknown[]; expectedProdVersionId: string }>('POST', `/chatbots/${bot.id}/environment/prod/preview`, { kind: 'SWITCH', targetVersionId: bot.v2Id });
      const created = await h.admin<ProdSwitchApprovalSummary & ApiErr>('POST', requestPath(bot.id), {
        action: 'PROD_SWITCH',
        targetVersionId: bot.v2Id,
        expectedProdVersionId: preview.body.expectedProdVersionId,
        acknowledgeWarnings: true,
      });
      expect(created.status).toBe(201);
      if (preview.body.warnings.length > 0) {
        const res = await h.admin2<ApiErr>('POST', requestPath(bot.id, created.body.id, 'approve'), {});
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_FAILED');
        const row = await h.prisma.prodSwitchApprovalRequest.findUnique({ where: { id: created.body.id } });
        expect(row?.status).toBe('PENDING');
      }
    });
  });
});
