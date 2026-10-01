// 데모 데이터 생성(설계 §7 · P4) — 제품 API 우선, DB 직접은 ADMIN1·과거 로그 2가지뿐. 순서: 계정 -> C(이력 예약 C-1을 가장 먼저) -> A -> B -> 과거 로그 -> 재색인 -> 기준 실행 -> 사전 분석.
// 실행마다 격리 DB를 새로 만들므로 재실행은 멱등이다(같은 정의 -> 같은 결과, runId별 격리).
import { readFileSync } from 'node:fs';
import {
  CreateDialogNodeSchema,
  CreateFaqSchema,
  CreateGuardrailRuleSchema,
  CreateTestCaseSchema,
  UpdateHandoffSettingsSchema,
  validatePasswordPolicy,
} from '@chat-bot/shared-types';
import { ApiSession, assertValid } from './api-client';
import {
  ACCOUNTS,
  BASELINE_CASES,
  BOT_A,
  BOT_B,
  BOT_C,
  CANNED_A,
  FAQS_A,
  GROUP_NAME,
  GUARDRAIL_A,
  HANDOFF_A,
  IMPROVABLE_CASE,
  INTENTS_A,
  KEYWORDS_A,
  PREANALYSIS_CONDITIONS,
  TEST_SET_NAME,
  type AccountDef,
} from './dataset';
import type { DbDirect } from './db-direct';
import { planHistoricalLogs } from './history';
import { historyScheduleTime, pickValidScheduleTime } from './schedule-times';
import type { BotIds, DatasetIds, VersionRef } from './types';
import { generatePassword } from '../util/password';
import type { Redactor } from '../util/redact';
import { waitFor } from '../util/wait-for';

export interface GeneratorDeps {
  apiBase: string;
  /** 무대(모형) 출처 — WEB 채널 허용 출처. */
  siteOrigin: string;
  db: DbDirect;
  redactor: Redactor;
  log: (msg: string) => void;
  now?: () => Date;
  signal?: AbortSignal;
  /** `--no-history-schedule` */
  skipHistorySchedule: boolean;
  fixtureCsvPath: string;
}

export interface Sessions {
  admin1: ApiSession;
  admin2: ApiSession;
  agent: ApiSession;
  editor: ApiSession;
  viewer: ApiSession;
}

/** 계정별 비밀번호 — 터미널 준비 완료 요약에만 출력한다(보고서·로그·state.json 0). */
export type Credentials = Record<AccountDef['key'], { email: string; name: string; password: string }>;

export interface GeneratedData {
  ids: DatasetIds;
  sessions: Sessions;
  credentials: Credentials;
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function idOf(body: unknown, what: string): string {
  const b = body as Json | undefined;
  const id = b?.id ?? b?.intent?.id ?? b?.schedule?.id ?? b?.request?.id ?? b?.item?.id;
  if (typeof id !== 'string') throw new Error(`${what} 응답에서 ID를 찾지 못했습니다: ${JSON.stringify(body).slice(0, 200)}`);
  return id;
}

// ── P4-1 계정 ──────────────────────────────────────────────────────────────────────
export async function createAccounts(d: GeneratorDeps): Promise<{ sessions: Sessions; credentials: Credentials; accounts: DatasetIds['accounts'] }> {
  const credentials = {} as Credentials;
  const sessions = {} as Sessions;
  const accounts: DatasetIds['accounts'] = {};
  for (const a of ACCOUNTS) {
    const pw = generatePassword();
    if (!validatePasswordPolicy(pw, { email: a.email }).ok) throw new Error('생성한 비밀번호가 제품 정책을 통과하지 못했습니다');
    d.redactor.register(pw);
    credentials[a.key] = { email: a.email, name: a.name, password: pw };
    sessions[a.key] = new ApiSession(d.apiBase, a.key, d.redactor);
  }

  // ADMIN1 — DB 직접(첫 사용자 생성 API 없음)
  const admin1 = ACCOUNTS[0];
  const admin1Id = await d.db.upsertUser({ email: admin1.email, name: admin1.name, role: admin1.role, password: credentials.admin1.password });
  await sessions.admin1.login(admin1.email, credentials.admin1.password);
  accounts.admin1 = { id: admin1Id, email: admin1.email, name: admin1.name };
  d.log('계정: ADMIN1 직접 생성(첫 사용자) · 로그인');

  // 나머지 — 제품 경로(POST /users -> 임시 비밀번호 로그인 -> POST /auth/password)
  for (const a of ACCOUNTS.slice(1)) {
    const created = await sessions.admin1.post<{ user: { id: string }; temporaryPassword: string }>('/users', { email: a.email, name: a.name, role: a.role });
    const temp = created.body.temporaryPassword;
    d.redactor.register(temp);
    const tmpSession = new ApiSession(d.apiBase, `${a.key}(임시)`, d.redactor);
    const me = await tmpSession.login(a.email, temp);
    if (!me.mustChangePassword) d.log(`  (참고) ${a.key}: 임시 로그인인데 비밀번호 변경 강제가 아님`);
    await tmpSession.post('/auth/password', { currentPassword: temp, newPassword: credentials[a.key].password });
    await sessions[a.key].login(a.email, credentials[a.key].password);
    accounts[a.key] = { id: created.body.user.id, email: a.email, name: a.name };
  }
  d.log('계정: ADMIN2·상담원·편집자·조회자 생성 · 비밀번호 변경 강제 해소(제품 경로)');
  return { sessions, credentials, accounts };
}

// ── 챗봇 공통 ──────────────────────────────────────────────────────────────────────
async function createBot(api: ApiSession, d: GeneratorDeps, groupId: string, def: { name: string; slug: string; description?: string; skin?: { primaryColor: string; headerTitle: string } }): Promise<BotIds> {
  const created = await api.post('/chatbots', { groupId, name: def.name, slug: def.slug, ...(def.description ? { description: def.description } : {}) });
  const id = idOf(created.body, `챗봇 ${def.slug}`);
  if (def.skin) await api.patch(`/chatbots/${id}/skin`, def.skin);
  await api.patch(`/chatbots/${id}/status`, { status: 'ACTIVE' });
  // WEB 채널: 허용 출처 = 고객사 모형(보안 설정 시연 겸 · C-16)
  await api.patch(`/chatbots/${id}/channels/WEB`, { enabled: true, config: { allowedOrigins: [d.siteOrigin], quickReplies: [], launcherPosition: 'RIGHT', showLauncher: true } });
  return { id, slug: def.slug, name: def.name };
}

async function createNode(api: ApiSession, botId: string, body: Json): Promise<string> {
  assertValid(CreateDialogNodeSchema, body, `노드 ${body.name}`);
  const r = await api.post(`/chatbots/${botId}/dialog-nodes`, body);
  return idOf(r.body, `노드 ${body.name}`);
}

const text = (t: string) => ({ type: 'TEXT', payload: { text: t } });

// ── 챗봇 A ─────────────────────────────────────────────────────────────────────────
export async function createBotA(api: ApiSession, d: GeneratorDeps, groupId: string): Promise<DatasetIds['A']> {
  const bot = await createBot(api, d, groupId, BOT_A);
  const base = `/chatbots/${bot.id}`;

  const keywordIds: Record<string, string> = {};
  for (const k of KEYWORDS_A) {
    const r = await api.post(`${base}/keywords`, { name: k.name, synonyms: [...k.synonyms] });
    keywordIds[k.key] = idOf(r.body, `키워드 ${k.name}`);
  }
  const intents: DatasetIds['A']['intents'] = {};
  for (const def of INTENTS_A) {
    const r = await api.post(`${base}/intents`, { name: def.name, examples: def.examples });
    const intentId = idOf(r.body, `의도 ${def.name}`);
    const nodeId = await createNode(api, bot.id, {
      name: `${def.name} 응답`,
      intentIds: [intentId],
      keywordIds: (def.keywords ?? []).map((k) => keywordIds[k]),
      outputs: [text(def.answer)],
    });
    intents[def.key] = { intentId, nodeId, answer: def.answer };
  }
  const startNodeId = await createNode(api, bot.id, { name: '시작', nodeType: 'START', outputs: [text(BOT_A.greeting)] });
  const fallbackNodeId = await createNode(api, bot.id, { name: '답하지 못함', nodeType: 'FALLBACK', outputs: [text(BOT_A.fallback)] });

  const faqIds: string[] = [];
  const faqAnswers: string[] = [];
  for (const f of FAQS_A) {
    const body = { category: 'FAQ', question: f.question, answer: f.answer, altQuestions: f.altQuestions, enabled: true };
    assertValid(CreateFaqSchema, body, `FAQ ${f.question}`);
    const r = await api.post(`${base}/faqs`, body);
    faqIds.push(idOf(r.body, `FAQ ${f.question}`));
    faqAnswers.push(f.answer);
  }
  d.log(`챗봇 A: 의도 ${INTENTS_A.length} · 키워드 ${KEYWORDS_A.length} · 노드 ${INTENTS_A.length + 2} · FAQ ${FAQS_A.length}`);

  // 상담 연계(②) · 자주 쓰는 문장 3
  assertValid(UpdateHandoffSettingsSchema, HANDOFF_A, '상담 연계 설정');
  await api.put(`${base}/handoff-settings`, HANDOFF_A);
  for (const c of CANNED_A) await api.post(`${base}/canned-responses`, { ...c, enabled: true });

  // 위험 응답 규칙(⑥)
  const rule = { ...GUARDRAIL_A, expressions: [...GUARDRAIL_A.expressions], enabled: true };
  assertValid(CreateGuardrailRuleSchema, rule, '위험 응답 규칙');
  await api.post(`${base}/guardrails/rules`, rule);

  // 검증 세트 "기본 응대 15문항" — 의미 매칭 꺼짐 기준 14건 통과 + 개선 대상 1건
  const set = await api.post(`${base}/test-sets`, { name: TEST_SET_NAME, description: '기본 응대 질문을 한 번에 점검하는 세트입니다.', isDefault: true });
  const testSetId = idOf(set.body, '검증 세트');
  const all = [...BASELINE_CASES, IMPROVABLE_CASE];
  for (const c of all) {
    const targetId = c.target.kind === 'INTENT' ? intents[c.target.intentKey].intentId : faqIds[c.target.faqIndex];
    const body = { messages: [c.message], expectedKind: c.target.kind, expectedTargetId: targetId, enabled: true };
    assertValid(CreateTestCaseSchema, body, `검증 문항 ${c.message}`);
    await api.post(`${base}/test-sets/${testSetId}/cases`, body);
  }
  d.log(`챗봇 A: 상담 연계 · 자주 쓰는 문장 ${CANNED_A.length} · 위험 응답 규칙 1 · 검증 세트 ${all.length}문항`);

  return { ...bot, intents, keywordIds, faqIds, faqAnswers, startNodeId, fallbackNodeId, testSetId, baselineRunId: '', preAnalysisId: null };
}

// ── 환경 모드 챗봇 B·C ─────────────────────────────────────────────────────────────
interface EnvBot extends BotIds {
  intentId: string;
  nodeId: string;
  v1: VersionRef;
  v2: VersionRef;
}

async function envStatus(api: ApiSession, botId: string): Promise<Json> {
  return (await api.get(`/chatbots/${botId}/environment`)).body as Json;
}

function versionRef(v: Json | undefined | null, what: string): VersionRef {
  if (!v || typeof v.versionId !== 'string') throw new Error(`${what} 버전 정보를 찾지 못했습니다`);
  return { versionId: v.versionId, versionNo: v.versionNo };
}

async function createEnvBot(api: ApiSession, d: GeneratorDeps, groupId: string, def: typeof BOT_B | typeof BOT_C, v1Text: string, v2Text: string): Promise<EnvBot> {
  const bot = await createBot(api, d, groupId, def);
  const base = `/chatbots/${bot.id}`;
  const intent = await api.post(`${base}/intents`, { name: def.intent.name, examples: [...def.intent.examples] });
  const intentId = idOf(intent.body, `의도 ${def.intent.name}`);
  const nodeId = await createNode(api, bot.id, { name: `${def.intent.name} 응답`, intentIds: [intentId], outputs: [text(v1Text)] });
  await createNode(api, bot.id, { name: '시작', nodeType: 'START', outputs: [text(def.greeting)] });
  await createNode(api, bot.id, { name: '답하지 못함', nodeType: 'FALLBACK', outputs: [text(def.fallback)] });

  // 환경 모드 켜기 -> 운영 v1
  const preview = (await api.post(`${base}/environment/enable/preview`, {})).body as Json;
  await api.post(`${base}/environment/enable`, { expectedDraftHash: preview.draftContentHash, reason: '시연용 운영 통제 데모 준비' });
  let st = await envStatus(api, bot.id);
  const v1 = versionRef(st.prod, '운영 v1');

  // 2인 승인 켜기(활성 ADMIN 2명 이상 — 계정 단계에서 충족)
  await api.put(`${base}/environment/approval`, { required: true, ttlHours: 24 });

  // 초안 수정 -> 스테이징 v2
  await api.patch(`${base}/dialog-nodes/${nodeId}`, { outputs: [text(v2Text)] });
  st = await envStatus(api, bot.id);
  const promoted = (await api.post(`${base}/environment/staging/promote`, { expectedStagingVersionId: st.staging?.versionId ?? null, label: 'v2 준비' })).body as Json;
  const v2 = versionRef(promoted.staging ?? (await envStatus(api, bot.id)).staging, '스테이징 v2');
  st = await envStatus(api, bot.id);
  d.log(`챗봇 ${def.name}: 환경 모드 · 운영 v${v1.versionNo} · 스테이징 v${v2.versionNo} · 2인 승인 켬`);
  return { ...bot, intentId, nodeId, v1, v2 };
}

/** 예약 + 작성자 승인 요청 + 다른 ADMIN 승인(설계 DHD-9 — 2인 승인 챗봇의 예약은 사전 승인이 있어야 실행된다). */
export async function scheduleWithApproval(
  admin1: ApiSession,
  admin2: ApiSession,
  botId: string,
  args: { targetVersionId: string; baseVersionId: string; scheduledAt: Date; memo: string },
  log: (m: string) => void,
): Promise<{ scheduleId: string; approvalId: string; scheduledAt: Date }> {
  const base = `/chatbots/${botId}`;
  const sch = await admin1.post(`${base}/deploy-schedules`, {
    action: 'SWITCH_PROD_VERSION',
    targetVersionId: args.targetVersionId,
    previewedProdVersionId: args.baseVersionId,
    scheduledAt: args.scheduledAt.toISOString(),
    memo: args.memo,
  });
  const scheduleId = idOf(sch.body, '예약');
  const req = await admin1.post(`${base}/environment/approval/requests`, { action: 'SCHEDULED_PROD_SWITCH', deployScheduleId: scheduleId });
  const approvalId = idOf(req.body, '승인 요청');
  await admin2.post(`${base}/environment/approval/requests/${approvalId}/approve`, {});
  log(`예약: ${args.memo} · ${args.scheduledAt.toISOString()} · 작성자 요청 + 다른 ADMIN 승인 완료`);
  return { scheduleId, approvalId, scheduledAt: args.scheduledAt };
}

// ── 전체 흐름 ─────────────────────────────────────────────────────────────────────
export interface GenerateOptions {
  /** 이력용 예약 C-1 실행을 기다리는 콜백은 호출자(오케스트레이터)가 맡는다. 여기서는 걸기만 한다. */
}

export async function generateDataset(d: GeneratorDeps): Promise<GeneratedData> {
  const now = d.now ?? (() => new Date());
  const { sessions, credentials, accounts } = await createAccounts(d);
  const admin1 = sessions.admin1;

  const grp = await admin1.post('/chatbot-groups', { name: GROUP_NAME, description: '가온마켓(가상 쇼핑몰) 시연용 챗봇 묶음' });
  const groupId = idOf(grp.body, '그룹');

  // C + 이력용 예약 C-1 — 가장 먼저(준비 중 실제로 실행되게)
  const pc = now();
  const C = await createEnvBot(admin1, d, groupId, BOT_C, BOT_C.answerV1, BOT_C.answerV2);
  let historySchedule: DatasetIds['C']['historySchedule'] = null;
  if (!d.skipHistorySchedule) {
    const at = pickValidScheduleTime(historyScheduleTime(pc), now(), []);
    const r = await scheduleWithApproval(admin1, sessions.admin2, C.id, { targetVersionId: C.v2.versionId, baseVersionId: C.v1.versionId, scheduledAt: at, memo: '이력용 예약(시연 준비)' }, d.log);
    historySchedule = { scheduleId: r.scheduleId, scheduledAt: r.scheduledAt.toISOString(), approvalId: r.approvalId };
  } else {
    d.log('이력용 예약 C-1 생략(--no-history-schedule)');
  }

  const A = await createBotA(admin1, d, groupId);
  const B = await createEnvBot(admin1, d, groupId, BOT_B, BOT_B.answerV1, BOT_B.answerV2);

  // 과거 14일 로그(DB 직접)
  const rows = planHistoricalLogs(
    { chatbotId: A.id, groupId, intents: A.intents, faqIds: A.faqIds, faqAnswers: A.faqAnswers, fallbackNodeId: A.fallbackNodeId },
    { now: now() },
  );
  const historicalLogs = await d.db.insertHistoricalLogs(rows);
  d.log(`과거 14일 대화 로그 ${historicalLogs}건 직접 삽입(시연용 과거 데이터)`);

  // 사전 재색인 완료 대기(색인은 semanticEnabled와 무관 — 설계 C-6)
  await reindexAndWait(admin1, A.id, d);

  // 검증 세트 기준 실행 1회(의미 매칭 꺼짐 -> 개선 대상 1건 실패가 기준)
  A.baselineRunId = await runValidationAndWait(admin1, A.id, A.testSetId, d);

  // ⑦ 사전 분석(같은 CSV로 미리 완료한 결과)
  A.preAnalysisId = await preAnalyze(admin1, A.id, d);

  const ids: DatasetIds = {
    groupId,
    A,
    B: { id: B.id, slug: B.slug, name: B.name, intentId: B.intentId, nodeId: B.nodeId, v1: B.v1, v2: B.v2 },
    C: { id: C.id, slug: C.slug, name: C.name, intentId: C.intentId, nodeId: C.nodeId, v1: C.v1, v2: C.v2, historySchedule, v3: null },
    accounts,
    counts: { historicalLogs, accounts: ACCOUNTS.length, chatbots: 3 },
    calibrated: false,
  };
  return { ids, sessions, credentials };
}

export async function reindexAndWait(api: ApiSession, botId: string, d: Pick<GeneratorDeps, 'log' | 'signal'>): Promise<void> {
  await api.post(`/chatbots/${botId}/embeddings/reindex`, {}, { allow: [409] });
  const st = await waitFor(
    async () => {
      const s = (await api.get(`/chatbots/${botId}/embeddings/status`)).body as Json;
      return s.totalTargets > 0 && s.pending === 0 && s.failed === 0 && s.indexed >= s.totalTargets ? s : false;
    },
    { timeoutMs: 120_000, intervalMs: 1000, label: '재색인 완료', signal: d.signal },
  );
  d.log(`사전 재색인 완료: ${st.indexed}/${st.totalTargets}건 · 모델 ${st.modelId}`);
}

export async function runValidationAndWait(api: ApiSession, botId: string, setId: string, d: Pick<GeneratorDeps, 'log' | 'signal'>): Promise<string> {
  const start = await api.post(`/chatbots/${botId}/test-sets/${setId}/runs`, {});
  const runId = (start.body as Json).runId as string;
  const run = await waitFor(
    async () => {
      const r = (await api.get(`/chatbots/${botId}/test-runs/${runId}`)).body as Json;
      if (r.status === 'FAILED' || r.status === 'CANCELLED') throw new Error(`검증 실행 ${r.status}`);
      return r.status === 'SUCCEEDED' ? r : false;
    },
    { timeoutMs: 120_000, intervalMs: 500, label: '검증 실행 완료', signal: d.signal, isFatal: (e) => e instanceof Error && /검증 실행/.test(e.message) },
  );
  d.log(`검증 실행 완료(runId ${runId.slice(0, 8)}): 통과 ${run.summary?.a?.pass ?? '?'} / 실패 ${run.summary?.a?.fail ?? '?'}`);
  return runId;
}

async function preAnalyze(api: ApiSession, botId: string, d: GeneratorDeps): Promise<string | null> {
  const csv = readFileSync(d.fixtureCsvPath);
  const form = new FormData();
  form.append('file', new Blob([csv], { type: 'text/csv' }), 'utterances-demo.csv');
  form.append('conditions', JSON.stringify(PREANALYSIS_CONDITIONS));
  const started = await api.request(`POST`, `/chatbots/${botId}/utterance-analyses`, { form, timeoutMs: 120_000 });
  const analysisId = (started.body as Json).analysisId ?? (started.body as Json).id;
  if (typeof analysisId !== 'string') throw new Error(`사전 분석 시작 응답에서 ID를 찾지 못했습니다: ${JSON.stringify(started.body).slice(0, 200)}`);
  const t0 = Date.now();
  const detail = await waitFor(
    async () => {
      const r = (await api.get(`/chatbots/${botId}/utterance-analyses/${analysisId}`)).body as Json;
      if (r.status === 'FAILED') throw new Error(`사전 분석 실패: ${r.failureReason ?? ''}`);
      return r.status === 'SUCCEEDED' ? r : false;
    },
    { timeoutMs: 240_000, intervalMs: 1000, label: '사전 분석 완료', signal: d.signal, isFatal: (e) => e instanceof Error && /사전 분석 실패/.test(e.message) },
  );
  d.log(`사전 분석 완료: 묶음 ${detail.clusterCount ?? detail.clusters?.length ?? '?'}개 · ${Math.round((Date.now() - t0) / 1000)}초(사내 CPU)`);
  return analysisId;
}
