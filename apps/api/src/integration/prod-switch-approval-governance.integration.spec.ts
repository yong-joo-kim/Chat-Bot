import type { ApprovalPolicyStatus } from '@chat-bot/shared-types';
import { bootHarness } from './helpers/ai-guardrails.harness';
import type { Harness } from './helpers/ai-guardrails.harness';
import { setupApprovalBot } from './helpers/ai-guardrails-approval.helpers';

/**
 * 2인 승인 끄기 잠금 × 거버넌스 모드 ON(N36-1, ADR-0049) — ENV_APPROVAL_OFF_LOCKED 미설정.
 * 거버넌스 모드·환경 스냅샷은 프로세스 전역 1회라 파일마다 값을 먼저 설정한 뒤 동적 import로 기동한다(CLAUDE.md 규약).
 */
interface ApiErr {
  code: string;
  details?: Array<{ field: string; message: string }>;
}

describe('2인 승인 끄기 잠금 × 거버넌스 ON(미설정)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await bootHarness({
      tmpPrefix: 'prod-switch-approval-governance-unset-',
      env: {
        RAG_BASE_URL: '',
        EMBEDDING_BASE_URL: '',
        DATA_GOVERNANCE_MODE: 'ON',
        DATA_ENCRYPTION_ENABLED: 'false',
        DATA_ENCRYPTION_KEYS: '',
        DATA_EGRESS_ALLOWED_HOSTS: '',
        DATA_RETENTION_JOB_ENABLED: 'false',
        DATA_REENCRYPT_JOB_ENABLED: 'false',
        ENV_APPROVAL_OFF_LOCKED: '',
      },
    });
  }, 90_000);

  afterAll(async () => {
    await h?.close();
  }, 20_000);

  it('N36-1 재현: 미설정이면 켜기 200 · 끄기 409(OFF_LOCKED) · 현황 offLocked:true + offLockedBy:GOVERNANCE_MODE — 끄기 우회 불가', async () => {
    const bot = await setupApprovalBot(h, '거버넌스잠금', { policy: false });
    const on = await h.admin<ApprovalPolicyStatus>('PUT', `/chatbots/${bot.id}/environment/approval`, { required: true, ttlHours: 24 });
    expect(on.status).toBe(200);
    expect(on.body).toMatchObject({ policy: { required: true }, offLocked: true, offLockedBy: 'GOVERNANCE_MODE' });

    const off = await h.admin<ApiErr>('PUT', `/chatbots/${bot.id}/environment/approval`, { required: false, ttlHours: 24 });
    expect(off.status).toBe(409);
    expect(off.body.code).toBe('APPROVAL_POLICY_UNAVAILABLE');
    expect(off.body.details?.find((d) => d.field === 'reason')?.message).toBe('OFF_LOCKED');

    const status = await h.admin<ApprovalPolicyStatus>('GET', `/chatbots/${bot.id}/environment/approval`);
    expect(status.body.policy.required).toBe(true);
    expect(status.body).toMatchObject({ offLocked: true, offLockedBy: 'GOVERNANCE_MODE' });
  });
});
