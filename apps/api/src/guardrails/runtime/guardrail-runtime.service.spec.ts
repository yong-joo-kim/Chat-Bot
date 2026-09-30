import type { GuardrailRuleRow } from '../lib/types';
import type { ExitSetting } from './guardrail-profile.cache';
import { GuardrailRuntimeService } from './guardrail-runtime.service';

const RRN = '901231-1234567';

function rule(overrides: Partial<GuardrailRuleRow> = {}): GuardrailRuleRow {
  return {
    id: 'r1',
    name: '규칙',
    category: 'CRISIS_SELF_HARM',
    expressions: ['위험표현'],
    matchType: 'CONTAINS',
    appliesTo: 'INBOUND',
    action: 'REPLACE',
    replacementText: '안전 문구',
    sortOrder: 1,
    createdAt: new Date(2026, 0, 1),
    ...overrides,
  };
}

interface Harness {
  service: GuardrailRuntimeService;
  loader: { loadIndex: jest.Mock; loadRules: jest.Mock; loadSetting: jest.Mock };
  events: { write: jest.Mock };
  env: Record<string, unknown>;
}

function build(env: Record<string, unknown> = {}): Harness {
  const loader = {
    loadIndex: jest.fn().mockResolvedValue(new Set(['bot-with-rules'])),
    loadRules: jest.fn().mockResolvedValue([rule()]),
    loadSetting: jest.fn().mockResolvedValue({ kinds: ['RRN', 'CARD'], preserveDates: true, isDefault: true } satisfies ExitSetting),
  };
  const events = { write: jest.fn() };
  const config = { get: jest.fn((key: string) => env[key]) };
  const bannedWords = { maskPlainText: jest.fn(async (t: string) => t) };
  const service = new GuardrailRuntimeService(loader as never, events as never, config as never, bannedWords as never);
  return { service, loader, events, env };
}

describe('GuardrailRuntimeService — 입구', () => {
  it('규칙 없는 챗봇은 쿼리 1회(색인)로 PASS, 이후 턴은 쿼리 0(색인 캐시 적중)', async () => {
    const { service, loader } = build();
    expect((await service.evaluateInbound('plain-bot', '아무 말')).action).toBe('PASS');
    expect(loader.loadIndex).toHaveBeenCalledTimes(1);
    expect(loader.loadRules).not.toHaveBeenCalled();

    await service.evaluateInbound('plain-bot', '또 아무 말');
    await service.evaluateInbound('other-bot', '다른 챗봇');
    expect(loader.loadIndex).toHaveBeenCalledTimes(1);
    expect(loader.loadRules).not.toHaveBeenCalled();
  });

  it('규칙 있는 챗봇은 프로필을 1회 적재하고 그 뒤로는 캐시로 판정한다', async () => {
    const { service, loader } = build();
    const first = await service.evaluateInbound('bot-with-rules', '위험표현이 있어요');
    expect(first.action).toBe('REPLACE');
    expect(first.replacementText).toBe('안전 문구');
    await service.evaluateInbound('bot-with-rules', '또 위험표현');
    expect(loader.loadRules).toHaveBeenCalledTimes(1);
  });

  it('무효화 즉시 반영 — 규칙 쓰기 뒤 다음 판정은 다시 적재한다', async () => {
    const { service, loader } = build();
    await service.evaluateInbound('bot-with-rules', '위험표현');
    service.invalidate('bot-with-rules', 'RULES');
    await service.evaluateInbound('bot-with-rules', '위험표현');
    expect(loader.loadIndex).toHaveBeenCalledTimes(2);
    expect(loader.loadRules).toHaveBeenCalledTimes(2);
  });

  it('콜드 + DB 장애면 입구는 PASS(대화 중단 금지)이고 예외를 던지지 않는다', async () => {
    const { service, loader } = build();
    loader.loadIndex.mockRejectedValue(new Error('DB 장애'));
    await expect(service.evaluateInbound('bot-with-rules', '위험표현')).resolves.toMatchObject({ action: 'PASS' });
  });

  it('stale-on-error — TTL이 지난 뒤 적재가 실패해도 직전 색인·프로필로 판정한다', async () => {
    let now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const { service, loader } = build({ GUARDRAIL_CACHE_TTL_MS: 1000 });
      expect((await service.evaluateInbound('bot-with-rules', '위험표현')).action).toBe('REPLACE');
      now += 2000;
      loader.loadIndex.mockRejectedValue(new Error('DB 장애'));
      loader.loadRules.mockRejectedValue(new Error('DB 장애'));
      expect((await service.evaluateInbound('bot-with-rules', '위험표현')).action).toBe('REPLACE');
    } finally {
      jest.restoreAllMocks();
    }
  });

  it('GUARDRAILS_ENABLED=false면 캐시·DB를 조회하지 않고 PASS', async () => {
    const { service, loader } = build({ GUARDRAILS_ENABLED: false });
    expect((await service.evaluateInbound('bot-with-rules', '위험표현')).action).toBe('PASS');
    expect(loader.loadIndex).not.toHaveBeenCalled();
  });

  it('REPLACE인데 대체 문구가 없는 데이터 이상은 흐름을 바꾸지 않는다(MONITOR)', async () => {
    const { service, loader } = build();
    loader.loadRules.mockResolvedValue([rule({ replacementText: null })]);
    expect((await service.evaluateInbound('bot-with-rules', '위험표현')).action).toBe('MONITOR');
  });
});

describe('GuardrailRuntimeService — 출구(설계서 §6.3 수렴 표)', () => {
  it('규칙·설정을 적재해 주민번호를 가린다(기본 종류)', async () => {
    const { service } = build();
    const v = await service.evaluateOutbound('plain-bot', `번호는 ${RRN} 입니다`);
    expect(v.kind).toBe('MASKED');
    expect(v.text).toBe('번호는 [주민등록번호] 입니다');
  });

  it('콜드 + DB 장애 → FALLBACK(PROFILE_UNAVAILABLE)', async () => {
    const { service, loader } = build();
    loader.loadRules.mockRejectedValue(new Error('DB 장애'));
    const v = await service.evaluateOutbound('bot-with-rules', '답변');
    expect(v).toMatchObject({ kind: 'FALLBACK', fallbackReason: 'PROFILE_UNAVAILABLE' });
  });

  it('판정 예외 + 개인정보 가림이 켜져 있음(기본) → FALLBACK(ERROR, 예외 이름만)', async () => {
    const { service } = build();
    jest.spyOn(service as never as { judge: () => never }, 'judge').mockImplementation(() => {
      throw new RangeError('내부 오류');
    });
    const v = await service.evaluateOutbound('plain-bot', '답변');
    expect(v).toMatchObject({ kind: 'FALLBACK', fallbackReason: 'ERROR', errorCode: 'RangeError' });
    expect(JSON.stringify(v)).not.toContain('내부 오류');
  });

  it('판정 예외 + 대체 규칙 없음 + 가림 꺼짐 → 원답 PASS + 오류 이름(FR-AG3-6)', async () => {
    const { service, loader } = build();
    loader.loadSetting.mockResolvedValue({ kinds: [], preserveDates: true, isDefault: false } satisfies ExitSetting);
    loader.loadRules.mockResolvedValue([]);
    jest.spyOn(service as never as { judge: () => never }, 'judge').mockImplementation(() => {
      throw new TypeError('x');
    });
    const v = await service.evaluateOutbound('plain-bot', '원답');
    expect(v).toMatchObject({ kind: 'PASS', text: '원답', errorCode: 'TypeError' });
  });

  it('GUARDRAILS_ENABLED=false면 출구도 PASS(가림 포함 전부 꺼짐)', async () => {
    const { service, loader } = build({ GUARDRAILS_ENABLED: false });
    const v = await service.evaluateOutbound('plain-bot', `번호 ${RRN}`);
    expect(v).toMatchObject({ kind: 'PASS', text: `번호 ${RRN}` });
    expect(loader.loadRules).not.toHaveBeenCalled();
  });
});

describe('GuardrailRuntimeService — 이벤트', () => {
  it('recordEvents는 행을 만들어 writer에 넘기고 예외를 던지지 않는다', () => {
    const { service, events } = build();
    service.recordEvents({
      chatbotId: 'bot-1',
      messageId: 'msg-1',
      verdict: { action: 'MONITOR', decisiveRuleId: 'r1', hits: [{ ruleId: 'r1', ruleName: 'n', category: 'OTHER', action: 'MONITOR', sortOrder: 1, matched: ['x'] }] },
    });
    expect(events.write).toHaveBeenCalledTimes(1);
    expect(events.write.mock.calls[0][0][0]).toMatchObject({ stage: 'INBOUND', kind: 'RULE', chatbotId: 'bot-1', messageId: 'msg-1' });
  });

  it('toRagPreview — 대체·폴백은 원답을 저장 마스킹본으로만 싣는다', async () => {
    const { service } = build();
    const preview = await service.toRagPreview(
      { kind: 'REPLACE', text: `원답 ${RRN}`, replacementText: '안전 문구', hits: [{ ruleId: 'r', ruleName: '규칙', category: 'OTHER', action: 'REPLACE', sortOrder: 1, matched: [] }], piiCounts: {} },
      `원답 ${RRN}`,
      '기본 폴백',
    );
    expect(preview.outcome).toBe('REPLACED');
    expect(preview.finalText).toBe('안전 문구');
    expect(preview.originalMasked).toBe('원답 [주민등록번호]');
    expect(preview.ruleNames).toEqual(['규칙']);
  });
});
