import type { ApprovalPolicyStatus } from '@chat-bot/shared-types';
import { bootHarness } from './helpers/ai-guardrails.harness';
import type { Harness } from './helpers/ai-guardrails.harness';
import { setupApprovalBot } from './helpers/ai-guardrails-approval.helpers';

/**
 * 2인 승인 끄기 잠금 × 거버넌스 모드 ON(N36-1, ADR-0049) — ENV_APPROVAL_OFF_LOCKED 명시 false.
 * 거버넌스 모드·환경 스냅샷은 프로세스 전역 1회라 파일마다 값을 먼저 설정한 뒤 동적 import로 기동한다(CLAUDE.md 규약).
 */
interface ApiErr {
  code: string;
  details?: Array<{ field: string; message: string }>;
}

describe('2인 승인 끄기 잠금 × 거버넌스 ON(명시 false)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await bootHarness({
      tmpPrefix: 'prod-switch-approval-governance-explicit-',
      env: {
        RAG_BASE_URL: '',
        EMBEDDING_BASE_URL: '',
        DATA_GOVERNANCE_MODE: 'ON',
        DATA_ENCRYPTION_ENABLED: 'false',
        DATA_ENCRYPTION_KEYS: '',
        DATA_EGRESS_ALLOWED_HOSTS: '',
        DATA_RETENTION_JOB_ENABLED: 'false',
        DATA_REENCRYPT_JOB_ENABLED: 'false',
        ENV_APPROVAL_OFF_LOCKED: 'false',
      },
    });
  }, 90_000);

  afterAll(async () => {
    await h?.close();
  }, 20_000);

  it('거버넌스 ON이어도 명시 false면 끄기 200 · offLockedBy 키 없음', async () => {
    const bot = await setupApprovalBot(h, '명시해제', { policy: true });
    const off = await h.admin<ApprovalPolicyStatus>('PUT', `/chatbots/${bot.id}/environment/approval`, { required: false, ttlHours: 24 });
    expect(off.status).toBe(200);
    expect(off.body.offLocked).toBe(false);
    expect('offLockedBy' in off.body).toBe(false);
  });
});
