import { toKstDayBucket } from '@chat-bot/shared-types';
import type { GovernanceMapResponse, GuardrailSettingsResponse, GuardrailTestResponse } from '@chat-bot/shared-types';
import { bootHarness, eventually } from './helpers/ai-guardrails.harness';
import type { Harness } from './helpers/ai-guardrails.harness';

/**
 * 가드레일(No.36) × 데이터 거버넌스(No.45) 모드 ON — `ai-guardrails-설계.md` §7.4 · §8.5 · §8.6 · X-2.
 * 거버넌스 모드는 프로세스 전역 1회 설치라 별도 파일에서 값을 먼저 설정한 뒤 동적 import로 기동한다(CLAUDE.md 규약).
 */
describe('가드레일(No.36) × 거버넌스 모드 ON', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await bootHarness({
      tmpPrefix: 'ai-guardrails-governance-',
      env: {
        RAG_BASE_URL: '',
        EMBEDDING_BASE_URL: '',
        DATA_GOVERNANCE_MODE: 'ON',
        DATA_ENCRYPTION_ENABLED: 'false',
        DATA_ENCRYPTION_KEYS: '',
        DATA_EGRESS_ALLOWED_HOSTS: '',
        DATA_RETENTION_JOB_ENABLED: 'false',
        DATA_REENCRYPT_JOB_ENABLED: 'false',
      },
    });
  }, 90_000);

  afterAll(async () => {
    await h?.close();
  }, 20_000);

  it('데이터 지도(이 파일의 첫 시험 — 다른 시험이 규칙을 만들기 전) — 규칙·이벤트·설정·승인 정책이 모두 없으면 guardrails 키가 생략되고, 생기면 문장 0 · 출구 0으로 표시된다', async () => {
    const before = await h.admin<GovernanceMapResponse>('GET', '/governance/map');
    expect(before.status).toBe(200);
    expect('guardrails' in before.body).toBe(false);

    const bot = await h.createChatbot('데이터지도');
    await h.admin('POST', `/chatbots/${bot.id}/guardrails/rules`, { name: '지도규칙', category: 'OTHER', expressions: ['위험표현'], appliesTo: 'INBOUND' });
    const after = await h.admin<GovernanceMapResponse>('GET', '/governance/map');
    expect(after.body.guardrails).toMatchObject({
      chatbotsWithRules: 1,
      rules: 1,
      enabledRules: 1,
      events: 0,
      eventsStoreText: false,
      exits: [],
      piiExitDefaultKinds: ['RRN', 'CARD'],
      piiExitCustomizedChatbots: 0,
      approvalPolicyChatbots: 0,
      serverEnabled: true,
    });
    // 새 출구 0 — 기존 출구 7종 그대로.
    expect(after.body.egress).toBeDefined();
  });

  it('주민번호·카드 가림은 끌 수 없다 — 저장 400(GOVERNANCE_FLOOR) · 조회에 하한 표시 · 시험하기도 하한을 강제한다', async () => {
    const bot = await h.createChatbot('거버넌스하한');
    const initial = await h.admin<GuardrailSettingsResponse>('GET', `/chatbots/${bot.id}/guardrails/settings`);
    expect(initial.body.governanceFloor).toEqual(['RRN', 'CARD']);

    const off = await h.admin<{ code: string; details: Array<{ field: string; message: string }> }>('PUT', `/chatbots/${bot.id}/guardrails/settings`, { piiExit: { kinds: [], preserveDates: true } });
    expect(off.status).toBe(400);
    expect(off.body.code).toBe('VALIDATION_FAILED');
    expect(off.body.details[0].message.startsWith('GOVERNANCE_FLOOR')).toBe(true);
    expect((await h.admin('PUT', `/chatbots/${bot.id}/guardrails/settings`, { piiExit: { kinds: ['CARD'], preserveDates: true } })).status).toBe(400);

    const ok = await h.admin<GuardrailSettingsResponse>('PUT', `/chatbots/${bot.id}/guardrails/settings`, { piiExit: { kinds: ['RRN', 'CARD', 'PHONE'], preserveDates: true } });
    expect(ok.status).toBe(200);
    expect(ok.body.piiExit.kinds).toEqual(['RRN', 'CARD', 'PHONE']);

    // 모드를 나중에 켠 챗봇 방어 — 저장된 설정이 하한 미만이어도 런타임은 합집합으로 강제한다.
    await h.prisma.chatbotGuardrailSetting.update({ where: { chatbotId: bot.id }, data: { piiExitKinds: '[]' } });
    const tested = await h.admin<GuardrailTestResponse>('POST', `/chatbots/${bot.id}/guardrails/test`, { text: '주민번호 901231-1234567 입니다', stage: 'OUTBOUND' });
    expect(tested.body).toMatchObject({ result: 'MASKED', resultText: '주민번호 [주민등록번호] 입니다' });
  });

  it('X-2: 이벤트 목록 조회는 대화 마스킹본 열람이라 거버넌스 모드에서 VIEW 감사(ConversationLog)를 남긴다', async () => {
    const bot = await h.createChatbot('열람감사');
    const created = await h.admin('POST', `/chatbots/${bot.id}/guardrails/rules`, { name: '기록', category: 'OTHER', expressions: ['위험표현'], appliesTo: 'INBOUND' });
    expect(created.status).toBe(201);
    const res = await h.pub<{ messageId: string }>('POST', `/public/chatbots/${bot.slug}/messages`, { sessionId: h.sessionUuid(), message: '위험표현 문의' });
    await eventually(() => h.prisma.guardrailEvent.findFirst({ where: { chatbotId: bot.id, messageId: res.body.messageId } }));

    const today = toKstDayBucket(new Date());
    const list = await h.admin('GET', `/chatbots/${bot.id}/guardrails/events?from=${today}&to=${today}`);
    expect(list.status).toBe(200);

    const audit = await eventually(() => h.prisma.auditLog.findFirst({ where: { action: 'VIEW', targetType: 'ConversationLog', chatbotId: bot.id } }));
    expect(audit).not.toBeNull();
  });
});
