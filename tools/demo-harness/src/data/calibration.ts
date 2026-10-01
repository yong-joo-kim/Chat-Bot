// 보정 게이트(설계 §7.9 · P5) — 공연 전에 "될 장면인지" 확인한다. 의미 매칭 점수는 모델·예문에 좌우되므로 데이터 정의가 바뀌면 여기서 먼저 잡힌다.
// 켜고 끄는 보정은 감사 로그 "AI 답변 설정 변경" 2행과 임베딩 캐시를 남긴다 — 보고서 "준비 단계 보정"에 공개한다.
import { randomUUID } from 'node:crypto';
import { BOT_B, GUARDRAIL_A, SCENE_TEXT } from './dataset';
import type { GeneratedData } from './generator';
import type { ApiSession } from './api-client';

export interface GateResult {
  id: 'G-1' | 'G-2' | 'G-3' | 'G-4';
  scene: string;
  ok: boolean;
  detail: string;
}

export interface CalibrationResult {
  ok: boolean;
  gates: GateResult[];
}

interface CalibrationDeps {
  data: GeneratedData;
  apiBase: string;
  siteOrigin: string;
  log: (m: string) => void;
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function putSemantic(api: ApiSession, botId: string, enabled: boolean): Promise<void> {
  const cur = (await api.get(`/chatbots/${botId}/answer-settings`)).body as Json;
  await api.put(`/chatbots/${botId}/answer-settings`, {
    semanticEnabled: enabled,
    acceptThreshold: cur.acceptThreshold,
    lowThreshold: cur.lowThreshold,
    marginThreshold: cur.marginThreshold,
    ragEnabled: false,
    ragCompany: null,
    ragCategory: null,
    ragSubcategory: null,
    ragSimilarityThreshold: null,
    fallbackPolicy: cur.fallbackPolicy ?? 'RAG_FIRST',
    showSources: cur.showSources ?? true,
    ragTimeoutMs: cur.ragTimeoutMs ?? 120_000,
  });
}

async function simulate(api: ApiSession, botId: string, message: string): Promise<{ node: string | undefined; stages: string[] }> {
  const r = (await api.post(`/chatbots/${botId}/simulate`, { message })).body as Json;
  return { node: r.matchedNodeName, stages: (r.trace ?? []).map((t: Json) => `${t.stage}:${t.code ?? ''}`) };
}

async function preview(api: ApiSession, botId: string, message: string): Promise<{ band: string; top: Json | undefined }> {
  const r = (await api.post(`/chatbots/${botId}/answer-settings/preview`, { message })).body as Json;
  return { band: r.band, top: r.top3?.[0] };
}

export async function runCalibrationGates(c: CalibrationDeps): Promise<CalibrationResult> {
  const { data } = c;
  const api = data.sessions.admin1;
  const A = data.ids.A;
  const gates: GateResult[] = [];
  const add = (id: GateResult['id'], scene: string, ok: boolean, detail: string) => {
    gates.push({ id, scene, ok, detail });
    c.log(`보정 ${id}(${scene}): ${ok ? '통과' : '실패'} - ${detail}`);
  };

  // G-1 ①: 꺼짐에서 폴백, 켜짐에서 배송조회 확정
  let semanticOn = false;
  try {
    const off = await simulate(api, A.id, SCENE_TEXT.notYetArrived);
    const offOk = off.node === '답하지 못함';
    await putSemantic(api, A.id, true);
    semanticOn = true;
    const on = await preview(api, A.id, SCENE_TEXT.notYetArrived);
    const onOk = on.band === 'CONFIRMED' && on.top?.id === A.intents.delivery.intentId;
    add('G-1', '장면 1', offOk && onOk, `꺼짐 ${off.node ?? '(없음)'} / 켜짐 ${on.band} 1위 ${on.top?.label ?? '없음'} ${on.top ? Number(on.top.score).toFixed(2) : ''}`);

    // G-2 ②: 상담원 연결 문장 2개가 켜짐에서도 폴백(점수가 되묻기 구간에 들면 안 된다)
    const second = await Promise.all([SCENE_TEXT.handoff1, SCENE_TEXT.handoff2].map((m) => preview(api, A.id, m)));
    const ok2 = second.every((p) => p.band === 'FAILED');
    add('G-2', '장면 2', ok2, second.map((p, i) => `${[SCENE_TEXT.handoff1, SCENE_TEXT.handoff2][i]} -> ${p.band} ${p.top ? Number(p.top.score).toFixed(2) : ''}`).join(' / '));
  } finally {
    if (semanticOn) await putSemantic(api, A.id, false);
  }

  // G-3 ⑤: 챗봇 B 위젯 질문이 운영 v1 문구로 응답(별도 세션, 공개 대화 API)
  const pub = await fetch(`${c.apiBase}/public/chatbots/${data.ids.B.slug}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: c.siteOrigin },
    body: JSON.stringify({ sessionId: randomUUID(), message: BOT_B.question }),
    signal: AbortSignal.timeout(15_000),
  });
  const pubBody = (await pub.json().catch(() => ({}))) as Json;
  const said = (pubBody.outputs?.[0]?.payload?.text as string | undefined) ?? '';
  add('G-3', '장면 5', pub.status === 200 && said === BOT_B.answerV1, `응답 "${said || pub.status}"`);

  // G-4 ⑥: 위험 질문이 대체 문구
  const g = (await api.post(`/chatbots/${A.id}/guardrails/test`, { text: '이 약을 두 배로 먹어도 되나요?', stage: 'INBOUND' })).body as Json;
  add('G-4', '장면 6', g.result === 'REPLACE' && g.resultText === GUARDRAIL_A.replacementText, `결과 ${g.result}`);

  return { ok: gates.every((x) => x.ok), gates };
}
