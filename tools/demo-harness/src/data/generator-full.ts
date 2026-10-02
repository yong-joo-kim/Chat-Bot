// [DT-2] 풀 투어 추가 데이터 생성(설계 §7 · P4) — 제품 API로 챗봇 A 음성 설정 · "기록만" 규칙 · 챗봇 D(선제 안내)를 더한다.
// 10분판은 이 파일을 호출하지 않는다(10분판 데이터 불변).
import { CreateGuardrailRuleSchema, ProactiveRuleInputSchema, ProactiveSettingsInputSchema, VoiceSettingsInputSchema } from '@chat-bot/shared-types';
import { assertValid, type ApiSession } from './api-client';
import { BOT_D, GUARDRAIL_A_MONITOR, PROACTIVE_RULE_D, PROACTIVE_SETTINGS_D, voiceSettingsA } from './dataset-full';
import { createBot, createNode, idOf, text, type GeneratedData, type GeneratorDeps } from './generator';
import type { DatasetIds } from './types';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** 선제 안내 코드는 삽입 코드에 `data-proactive="on"`이 있을 때만 초기화된다 — 콘솔 `ProactiveSection`이 예시로 보여 주는 것과 같은 변환(설계 DXD-12). 이미 있으면 그대로. */
export function withProactiveAttr(snippet: string): string {
  if (/\sdata-proactive=/.test(snippet)) return snippet;
  return snippet.replace('></script>', ' data-proactive="on"></script>');
}

export interface FullExtrasInput {
  /** 음성 입력(말하기)까지 켤지 — voice real·mock이면 true. */
  voiceInput: boolean;
}

/** 챗봇 A 음성 설정 + 위험 응답 규칙 2번 + 챗봇 D. 생성한 ID를 `ids`에 채운다. */
export async function createFullExtras(d: GeneratorDeps, data: GeneratedData, input: FullExtrasInput): Promise<void> {
  const api = data.sessions.admin1;
  const ids = data.ids;
  const A = ids.A;

  // 음성 설정(전체 교체 PUT)
  const voice = voiceSettingsA(input.voiceInput, A.intents.refund.nodeId);
  assertValid(VoiceSettingsInputSchema, voice, '음성 설정');
  await api.put(`/chatbots/${A.id}/voice`, voice);
  d.log(`챗봇 A: 음성 설정(듣기 켬 · 입력 ${input.voiceInput ? '켬' : '끔'} · 기본 안내형 · 미응답 사과형 · 환불 응답 차분형)`);

  // 위험 응답 규칙 2번 "투자 권유 문의" — 기록만
  const rule = { ...GUARDRAIL_A_MONITOR, expressions: [...GUARDRAIL_A_MONITOR.expressions], enabled: true };
  assertValid(CreateGuardrailRuleSchema, rule, '위험 응답 규칙(기록만)');
  const created = await api.post(`/chatbots/${A.id}/guardrails/rules`, rule);
  const monitorRuleId = idOf(created.body, '위험 응답 규칙 2');
  d.log('챗봇 A: 위험 응답 규칙 2 "투자 권유 문의"(기록만)');

  ids.extras = { monitorRuleId, voiceInputEnabled: input.voiceInput };
  ids.D = await createBotD(api, d, ids.groupId);
  d.log(`챗봇 D: 의도 2 · 노드 4 · 선제 안내 규칙 1(머문 시간 ${PROACTIVE_RULE_D.trigger.dwellSec}초)`);
}

async function createBotD(api: ApiSession, d: GeneratorDeps, groupId: string): Promise<NonNullable<DatasetIds['D']>> {
  const bot = await createBot(api, d, groupId, { name: BOT_D.name, slug: BOT_D.slug, description: BOT_D.description });
  const base = `/chatbots/${bot.id}`;
  const made: Record<string, { intentId: string; nodeId: string; answer: string }> = {};
  for (const key of ['delivery', 'hours'] as const) {
    const def = BOT_D.intents[key];
    const intent = await api.post(`${base}/intents`, { name: def.name, examples: [...def.examples] });
    const intentId = idOf(intent.body, `의도 ${def.name}`);
    const nodeId = await createNode(api, bot.id, { name: `${def.name} 응답`, intentIds: [intentId], outputs: [text(def.answer)] });
    made[key] = { intentId, nodeId, answer: def.answer };
  }
  await createNode(api, bot.id, { name: '시작', nodeType: 'START', outputs: [text(BOT_D.greeting)] });
  await createNode(api, bot.id, { name: '답하지 못함', nodeType: 'FALLBACK', outputs: [text(BOT_D.fallback)] });

  // 선제 안내: 설정 켬 → 규칙 생성(꺼짐으로 만들어진다) → 켜기
  assertValid(ProactiveSettingsInputSchema, PROACTIVE_SETTINGS_D, '선제 안내 설정');
  await api.put(`${base}/proactive/settings`, PROACTIVE_SETTINGS_D);
  const ruleBody = JSON.parse(JSON.stringify(PROACTIVE_RULE_D)) as Json;
  assertValid(ProactiveRuleInputSchema, ruleBody, '선제 안내 규칙');
  const rule = await api.post(`${base}/proactive/rules`, ruleBody);
  const proactiveRuleId = idOf(rule.body, '선제 안내 규칙');
  await api.post(`${base}/proactive/rules/${proactiveRuleId}/enable`, {});
  return { ...bot, intents: { delivery: made.delivery, hours: made.hours }, proactiveRuleId };
}
