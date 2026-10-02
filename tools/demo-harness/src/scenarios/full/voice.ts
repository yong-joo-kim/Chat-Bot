// [DT-2] 풀 투어 ⑧ 음성 응대(95 · 음성 입력 켬이면 140) — 설계 §9.6 · ui-spec §16.6.
// 활성 묶음: 기본 = SV-01·02·05·06·07 / 음성 입력(real·mock) = SV-01·03·04·05·06·07·08. 듣기는 항상(기기 안 음성 · 서버 전송 0), 말하기는 음성 입력일 때만.
// 말하기: 합성 음성 WAV를 가상 마이크로 한 번 녹음 → 위젯이 서버 음성 인식으로 보냄 → 입력창에 글자(자동 전송 0) → 사용자가 "전송"을 눌러야 답이 나온다.
// 정직성: 합성 음성(실제 사람 목소리·실제 마이크 아님)·영상에는 소리 없음·판정은 정확도가 아니라 동작 확인(일치율 + 핵심어 + 의도).
import { INTENTS_A } from '../../data/dataset';
import { AUTO_READ_QUESTION, VOICE_PHRASE } from '../../data/dataset-full';
import { randomUUID } from 'node:crypto';
import { voiceInactiveReason } from '../../scenario/plan';
import { CONSOLE_TEXT } from '../../selectors/console';
import { widget, WIDGET_TEXT } from '../../selectors/widget';
import { holdForMedia } from '../../scenario/pacing';
import type { FullStepEnv, SpeechRecord } from '../../scenario/full-env';
import type { SegmentDef, StepContext, StepDef } from '../../scenario/types';
import { judgeTranscript } from '../../voice/match';
import { askWidget, freshWidgetSession, norm, openWidget } from '../helpers';
import { FALLBACK_TEXTS, SV05_NO_VOICE_DISCLOSURE, sv01Disclosure, sv03Disclosure, sv07Narration } from './text';

const V = CONSOLE_TEXT.voice;
const REFUND = INTENTS_A.find((i) => i.key === 'refund')!;
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function need(ctx: StepContext): FullStepEnv {
  if (!ctx.full) throw new Error('풀 투어 실행 환경이 없습니다');
  return ctx.full;
}

// 주의(L-5): SV-01 기준값과 SV-08 검증이 KST 자정을 사이에 두면 일자가 달라져 +1 비교가 어긋날 수 있다(확률 낮음 — 자정 부근 시연은 피한다).
const kstDay =(): string => new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);

/** 오늘의 음성 인식 숫자(KST 일 — 요청·성공). */
async function voiceStats(ctx: StepContext): Promise<{ requested: number; ok: number }> {
  const d = kstDay();
  const r = (await ctx.api.admin1.get(`/chatbots/${ctx.ids.A.id}/voice/stats`, { query: { from: d, to: d } })).body as { totals: { requested: number; ok: number } };
  return { requested: r.totals.requested, ok: r.totals.ok };
}

/** 의미 매칭 설정이 꺼져 있으면 켠다(① 없이 `--only voice`로 돌릴 때) — 준비 보정으로 보고서에 남긴다. */
async function ensureSemanticOn(ctx: StepContext): Promise<void> {
  const cur = (await ctx.api.admin1.get(`/chatbots/${ctx.ids.A.id}/answer-settings`)).body as Json;
  if (cur.semanticEnabled === true) return;
  await ctx.api.admin1.put(`/chatbots/${ctx.ids.A.id}/answer-settings`, {
    semanticEnabled: true,
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
  need(ctx).record.honesty.push({ stepId: 'SV-01', kind: 'DEMO_SETTING', text: '준비 보정: 의미 매칭 설정이 꺼져 있어 음성 장면 전에 켰습니다(감사 로그에 남음)' });
}

/** 위젯의 새 봇 말풍선을 기다려 마지막 문구를 돌려준다. */
async function sendAndWait(ctx: StepContext, timeoutMs = 15_000): Promise<string> {
  const before = await widget.botMessages(ctx.site).count();
  await widget.sendButton(ctx.site).click();
  await ctx.waitFor(async () => (await widget.botMessages(ctx.site).count()) > before, { timeoutMs, label: '위젯 응답(전송 뒤)' });
  const all = await widget.botMessages(ctx.site).allInnerTexts();
  return (all[all.length - 1] ?? '').trim();
}

/** 글자 입력 대체(SV-03 fallback) — 전사를 기대 문장으로 덮어쓰므로 직전 실패 판정값(일치율·핵심어)은 비운다(L-6: 보고서 불일치 방지). */
export function applyTypedFallback(rec: SpeechRecord, expected: string | null): void {
  rec.source = 'TYPED_FALLBACK';
  rec.transcript = expected;
  rec.matchRatio = null;
  rec.keywordsOk = null;
}

function speechRecord(full: FullStepEnv): SpeechRecord {
  const v = full.voice;
  if (full.record.speech) return full.record.speech;
  const rec: SpeechRecord = {
    expected: v?.expected ?? '',
    keywords: v?.keywords ?? [],
    gateTranscript: v?.gateTranscript ?? null,
    gateRatio: v?.gateRatio ?? null,
    transcript: null,
    matchRatio: null,
    keywordsOk: null,
    intentOk: null,
    wavSec: v?.wavSec ?? 0,
    wavBytes: v?.wavBytes ?? 0,
    recordedMime: null,
    source: v?.mode === 'mock' ? 'MOCK' : 'BROWSER',
    listen: null,
    speaker: null,
  };
  full.record.speech = rec;
  return rec;
}

/** 공개 대화 API로 한 번 묻고 `speech`(말투·읽을 글) 응답 키를 돌려준다(무인 점검 SV-05 보강 — features에 speech-v1). */
async function publicSpeechPayload(ctx: StepContext): Promise<{ text?: string; tone?: string } | null> {
  const res = await fetch(`${ctx.urls.publicApi}/public/chatbots/${ctx.ids.A.slug}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ctx.urls.stage },
    body: JSON.stringify({ sessionId: randomUUID(), message: REFUND.examples[0], features: ['handoff-v1', 'feedback-v1', 'rich-v1', 'speech-v1'] }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as { speech?: { text?: string; tone?: string } };
  return body.speech ?? null;
}

const sv01: StepDef = {
  id: 'SV-01',
  title: '콘솔 음성 구역',
  narration: ['답변 듣기와 음성 입력을 챗봇별로 켭니다'],
  dynamicDisclosure: (ctx) => sv01Disclosure(ctx.plan),
  badges: ['NO_EXTERNAL_SEND', 'CPU_ONLY'],
  facts: ['GPU_USED'],
  budgetSec: 20,
  driver: 'UI',
  account: 'admin1',
  layout: 'console',
  console: (ids) => `/chatbots/${ids.A.id}/channels`,
  core: true,
  skippable: false,
  capture: 'screenshot',
  async run(ctx) {
    const full = need(ctx);
    // 사전 처리(화면 변화 없음): 의미 매칭 보정 · 인식 숫자 기준값 저장(SV-08이 +1을 검증한다)
    await ensureSemanticOn(ctx);
    const base = await voiceStats(ctx);
    full.record.voiceStatsBaseline = base;
    const entry = ctx.console.getByRole('button', { name: V.entryButton, exact: true }).first();
    await entry.waitFor({ state: 'visible', timeout: 15_000 });
    if ((await entry.getAttribute('aria-expanded')) !== 'true') await entry.click();
    const banner = ctx.plan.voiceInput === 'real' ? V.serverOk : ctx.plan.voiceInput === 'mock' ? V.serverMock : V.serverDisabled;
    await ctx.console.getByText(banner, { exact: false }).first().waitFor({ state: 'visible', timeout: 15_000 });
    await ctx.console.getByText(V.ttsToggleLabel, { exact: false }).first().waitFor({ state: 'visible', timeout: 10_000 });
  },
  async verify(ctx) {
    const o = (await ctx.api.admin1.get(`/chatbots/${ctx.ids.A.id}/voice`)).body as Json;
    const server = (o.server ?? {}) as { enabled?: boolean; provider?: string; inputAvailable?: boolean };
    const p = ctx.plan.voiceInput;
    const ok = p === 'real' ? server.enabled === true && server.provider === 'local' && server.inputAvailable === true : p === 'mock' ? server.enabled === true && server.provider === 'mock' : server.enabled === false;
    return { ok, expected: p === 'real' ? '서버 음성 인식 켜짐(local)·사용 가능' : p === 'mock' ? '모의 인식(mock)' : '서버 음성 인식 꺼짐', actual: `켜짐 ${server.enabled} · ${server.provider} · 입력 사용 가능 ${server.inputAvailable}` };
  },
};

const sv02: StepDef = {
  id: 'SV-02',
  title: '글자로 질문',
  narration: ['고객이 환불 규정을 묻습니다'],
  budgetSec: 15,
  driver: 'UI',
  layout: 'split',
  site: 'A',
  when: (p) => p.voiceInput === 'off',
  inactive: 'variant',
  core: true,
  skippable: false,
  capture: 'none',
  async run(ctx) {
    await freshWidgetSession(ctx, ctx.ids.A.slug);
    ctx.scratch.set('sv-answer', await askWidget(ctx, VOICE_PHRASE.expected, 15_000));
  },
  async verify(ctx) {
    const said = String(ctx.scratch.get('sv-answer') ?? '');
    return { ok: norm(said) === norm(REFUND.answer), expected: REFUND.answer, actual: said };
  },
};

const sv03: StepDef = {
  id: 'SV-03',
  title: '말하기에서 글자로',
  narration: ['눌러서 말하면 글자로 바꿔 입력창에 넣습니다', '음성은 저장하지 않고 사내에서만 처리합니다'],
  dynamicDisclosure: (ctx) => sv03Disclosure(ctx.plan),
  badges: ['NO_EXTERNAL_SEND'],
  facts: ['SYNTHETIC_VOICE', 'GPU_USED'],
  budgetSec: 30,
  driver: 'UI',
  layout: 'split',
  site: 'A',
  when: (p) => p.voiceInput !== 'off',
  inactive: 'option',
  inactiveReason: voiceInactiveReason,
  core: true,
  skippable: false,
  capture: 'gif-clip',
  async run(ctx) {
    const full = need(ctx);
    const v = full.voice;
    if (!v) throw new Error('합성 음성 준비 정보가 없습니다');
    const rec = speechRecord(full);
    await freshWidgetSession(ctx, ctx.ids.A.slug);
    await openWidget(ctx);
    const site = ctx.site;
    ctx.scratch.set('sv-03-bot-before', await widget.botMessages(site).count());
    const idle = widget.micByName(site, WIDGET_TEXT.micIdle);
    await idle.waitFor({ state: 'visible', timeout: 15_000 });
    ctx.log('가짜 마이크는 한 실행에 한 문장만 씁니다(같은 파일 · 새 마이크 열기마다 처음부터 재생)');
    full.record.micOpened += 1;
    await idle.click();
    await widget.micByName(site, WIDGET_TEXT.micStop).waitFor({ state: 'visible', timeout: 8_000 });
    // 관객용 스피커: 하네스 소유 버튼을 신뢰 클릭 → <audio> 재생(영상에는 소리가 없다 — 정직성)
    if (full.speakerEnabled && ctx.mode === 'visible') {
      try {
        await ctx.page.click('#voice-play', { timeout: 5_000 });
        const state = await ctx
          .waitFor(
            async () => {
              const st = (await ctx.stage.audioState()).state;
              return st === 'playing' || st === 'ended' || st === 'error' ? st : false;
            },
            { timeoutMs: 4_000, intervalMs: 100, label: '스피커 재생 시작' },
          )
          .catch(() => 'idle');
        rec.speaker = state === 'playing' || state === 'ended' ? 'PLAYED' : 'FAILED';
        if (rec.speaker === 'PLAYED') full.soundNote(`[합성 음성] ${v.expected}`);
        if (rec.speaker === 'FAILED') ctx.log('[주의] 스피커 재생에 실패했습니다(가상 마이크 입력은 정상) — 시연은 계속됩니다');
      } catch {
        rec.speaker = 'FAILED';
      }
    } else rec.speaker = 'SKIPPED';
    // 녹음 유지 = WAV 길이 + 1.0초(매체가 실제 시간으로 재생되는 시간 — 연출이 아니라 필요한 시간)
    await holdForMedia(Math.round((v.wavSec + 1.0) * 1000), ctx.signal);
    const reqP = ctx.page.waitForRequest((r) => r.url().includes('/speech/transcriptions'), { timeout: 30_000 }).catch(() => null);
    await widget.micByName(site, WIDGET_TEXT.micStop).click();
    const input = widget.input(site);
    // 위젯 대기 상한 15초 — 입력창에 글자가 채워질 때까지
    const text = await ctx.waitFor(async () => ((await input.inputValue()).trim() ? (await input.inputValue()).trim() : false), { timeoutMs: 18_000, intervalMs: 300, label: '인식 결과(입력창)' });
    const req = await reqP;
    rec.recordedMime = req ? (req.headers()['content-type'] ?? null) : null;
    rec.transcript = text;
    rec.source = v.mode === 'mock' ? 'MOCK' : 'BROWSER';
    await ctx.stage.setSound(false).catch(() => undefined);
  },
  async verify(ctx) {
    const full = need(ctx);
    const rec = speechRecord(full);
    const v = full.voice!;
    const text = rec.transcript ?? '';
    const j = judgeTranscript(v.expected, text, v.keywords);
    rec.matchRatio = Math.round(j.ratio * 100) / 100;
    rec.keywordsOk = j.keywordsOk;
    // 자동 전송 0 — 봇 말풍선 수가 그대로여야 한다 · 상태 줄 "글자로 바꿨어요…"
    const before = Number(ctx.scratch.get('sv-03-bot-before') ?? 0);
    const now = await widget.botMessages(ctx.site).count();
    const line = (await widget.voiceText(ctx.site).innerText().catch(() => '')).trim();
    const lineOk = line.includes('글자로 바꿨어요');
    const mock = v.mode === 'mock';
    return {
      ok: now === before && text.length > 0 && lineOk && (mock || j.textOk),
      expected: mock ? '입력창에 글자(모의 인식) · 자동 전송 0' : `기대 문장과 일치율 ≥ 0.8 또는 핵심어 포함 · 자동 전송 0`,
      actual: `전사 "${text}" · 일치율 ${rec.matchRatio} · 핵심어 ${j.keywordsOk ? '포함' : '없음'} · 자동 전송 ${now === before ? '없음' : '있음'} · 상태 줄 ${lineOk ? '정상' : line || '없음'}`,
    };
  },
  fallback: {
    // 권한·0바이트·15초 초과·오류 문구 → 같은 문장을 글자로 입력해 SV-04로 이어 간다(무인 점검에서는 대체하지 않고 실패)
    caption: FALLBACK_TEXTS.SV03.caption,
    async render(ctx) {
      if (ctx.mode === 'headless-check') throw new Error('무인 점검에서는 대체하지 않습니다(실패로 기록)');
      const full = need(ctx);
      const rec = speechRecord(full);
      await ctx.stage.setSound(false).catch(() => undefined);
      await openWidget(ctx);
      await ctx.pace.type(widget.input(ctx.site), full.voice?.expected ?? '');
      applyTypedFallback(rec, full.voice?.expected ?? null);
      full.record.honesty.push({ stepId: 'SV-03', kind: 'FALLBACK', text: '음성 인식이 지연되어 같은 문장을 글자로 입력했습니다' });
    },
  },
};

const sv04: StepDef = {
  id: 'SV-04',
  title: '확인 후 전송',
  narration: ['사용자가 확인한 뒤에만 보냅니다'],
  budgetSec: 15,
  driver: 'UI',
  layout: 'split',
  when: (p) => p.voiceInput !== 'off',
  inactive: 'option',
  inactiveReason: voiceInactiveReason,
  core: true,
  skippable: false,
  capture: 'none',
  async run(ctx) {
    ctx.scratch.set('sv-answer', await sendAndWait(ctx, 15_000));
  },
  async verify(ctx) {
    const said = String(ctx.scratch.get('sv-answer') ?? '');
    const full = need(ctx);
    const rec = speechRecord(full);
    const mock = ctx.plan.voiceInput === 'mock';
    rec.intentOk = norm(said) === norm(REFUND.answer);
    // 모의 인식은 고정 글자라 의도 일치를 요구하지 않는다(위젯 → API 구간 점검 — 응답이 왔으면 통과)
    return { ok: mock ? said.length > 0 : rec.intentOk, expected: mock ? '봇 응답 있음(모의 인식)' : REFUND.answer, actual: said };
  },
};

const sv05: StepDef = {
  id: 'SV-05',
  title: '답변 듣기',
  narration: ['답변을 고객 기기 안의 음성으로 읽어 줍니다', '서버로 보내는 소리는 없습니다'],
  dynamicDisclosure: (ctx) => (ctx.full?.koreanVoices === 0 ? SV05_NO_VOICE_DISCLOSURE : undefined),
  facts: ['GPU_USED'],
  budgetSec: 20,
  driver: 'UI',
  layout: 'split',
  core: true,
  skippable: false,
  capture: 'screenshot',
  async run(ctx) {
    const full = need(ctx);
    const rec = speechRecord(full);
    const site = ctx.site;
    const listen = widget.listenButtons(site).last();
    await listen.waitFor({ state: 'visible', timeout: 10_000 });
    if ((await listen.getAttribute('aria-disabled')) === 'true') {
      // 기기에 한국어 읽기 음성이 없다 — 이유 글자를 확인하고 통과(정직성 · 실패 아님 — FR-DX4-7)
      rec.listen = 'NO_VOICE';
      full.record.honesty.push({ stepId: 'SV-05', kind: 'DEMO_SETTING', text: '이 PC(브라우저)에는 기기 안 한국어 읽기 음성이 없어 듣기 버튼이 비활성으로 보였습니다' });
      return;
    }
    await listen.click();
    await widget.stopListenButtons(site).first().waitFor({ state: 'visible', timeout: 5_000 });
    if (ctx.mode === 'visible') await ctx.stage.setSound(true).catch(() => undefined);
    full.soundNote('[답변 읽는 소리]');
    // 읽는 시간(상한 25초) — 버튼이 "이 답변 듣기"로 돌아올 때까지
    await ctx.waitFor(async () => (await widget.stopListenButtons(site).count()) === 0, { timeoutMs: 25_000, intervalMs: 300, label: '답변 읽기 끝' });
    await ctx.stage.setSound(false).catch(() => undefined);
    rec.listen = 'PLAYED';
  },
  async verify(ctx) {
    const full = need(ctx);
    const rec = speechRecord(full);
    if (ctx.mode === 'headless-check') {
      // 무인 점검 보강: 공개 메시지의 `speech`(읽을 글·말투) 키 + 듣기 버튼 존재(AC-DX2-4)
      const sp = await publicSpeechPayload(ctx);
      const has = Boolean(sp?.text) && Boolean(sp?.tone);
      return { ok: has && (await widget.listenButtons(ctx.site).count()) > 0, expected: '공개 응답에 speech.text·tone · 듣기 버튼 있음', actual: `speech ${has ? '있음' : '없음'} · 듣기 상태 ${rec.listen ?? '-'}` };
    }
    return { ok: rec.listen === 'PLAYED' || rec.listen === 'NO_VOICE', expected: '읽기 시작·종료(또는 기기 음성 없음 안내)', actual: String(rec.listen) };
  },
  fallback: {
    caption: FALLBACK_TEXTS.SV05.caption,
    async render(ctx) {
      if (ctx.mode === 'headless-check') throw new Error('무인 점검에서는 대체하지 않습니다');
      await ctx.stage.setSound(false).catch(() => undefined);
      const rec = speechRecord(need(ctx));
      rec.listen = 'ERROR';
    },
  },
};

const sv06: StepDef = {
  id: 'SV-06',
  title: '자동 읽기',
  narration: ['켜 두면 새 답을 자동으로 읽어 줍니다'],
  budgetSec: 20,
  driver: 'UI',
  layout: 'split',
  core: false,
  skippable: true,
  capture: 'none',
  async run(ctx) {
    const site = ctx.site;
    const sw = widget.autoReadSwitch(site);
    await sw.waitFor({ state: 'visible', timeout: 10_000 });
    if ((await sw.getAttribute('aria-checked')) !== 'true') await sw.click();
    await askWidget(ctx, AUTO_READ_QUESTION, 15_000);
    // 새 답의 듣기 버튼이 누르지 않아도 "듣기 멈추기"로 바뀐다(기기에 음성이 없으면 이 확인은 건너뛴다)
    const novoice = (await widget.listenButtons(site).last().getAttribute('aria-disabled').catch(() => null)) === 'true';
    if (!novoice) {
      await ctx.waitFor(async () => (await widget.stopListenButtons(site).count()) > 0, { timeoutMs: 10_000, intervalMs: 250, label: '자동 읽기 시작' });
      if (ctx.mode === 'visible') await ctx.stage.setSound(true).catch(() => undefined);
      ctx.full?.soundNote('[답변 읽는 소리]');
      await ctx.waitFor(async () => (await widget.stopListenButtons(site).count()) === 0, { timeoutMs: 25_000, intervalMs: 300, label: '자동 읽기 끝' });
      await ctx.stage.setSound(false).catch(() => undefined);
    }
  },
  async verify(ctx) {
    const checked = await widget.autoReadSwitch(ctx.site).getAttribute('aria-checked');
    return { ok: checked === 'true', expected: '스위치 켜짐', actual: String(checked) };
  },
};

const sv07: StepDef = {
  id: 'SV-07',
  title: '데이터 지도 음성 절',
  narration: ['읽기는 고객 기기 안에서 합니다'],
  dynamicNarration: (ctx) => sv07Narration(ctx.plan),
  badges: ['NO_EXTERNAL_SEND'],
  budgetSec: 20,
  driver: 'UI',
  account: 'admin1',
  layout: 'console',
  console: () => '/settings/data-governance/map',
  core: true,
  skippable: false,
  capture: 'screenshot',
  async run(ctx) {
    const title = ctx.console.getByText(V.governanceTitle, { exact: false }).first();
    await title.waitFor({ state: 'visible', timeout: 15_000 });
    await title.scrollIntoViewIfNeeded();
    await ctx.console.getByText(V.governanceTts, { exact: false }).first().waitFor({ state: 'visible', timeout: 10_000 });
    if (ctx.plan.voiceInput === 'real') await ctx.console.getByText(V.governanceAudio, { exact: false }).first().waitFor({ state: 'visible', timeout: 10_000 });
  },
  async verify(ctx) {
    const map = (await ctx.api.admin1.get('/governance/map')).body as { speech?: { audioStored?: boolean; ttsServerEgress?: boolean } };
    const ok = map.speech?.audioStored === false && map.speech?.ttsServerEgress === false;
    return { ok, expected: 'speech.audioStored=false · ttsServerEgress=false', actual: `audioStored ${map.speech?.audioStored} · ttsServerEgress ${map.speech?.ttsServerEgress}` };
  },
};

const sv08: StepDef = {
  id: 'SV-08',
  title: '인식 숫자',
  narration: ['숫자만 기록하고 목소리와 글자는 남기지 않습니다'],
  budgetSec: 15,
  driver: 'UI',
  account: 'admin1',
  layout: 'console',
  console: (ids) => `/chatbots/${ids.A.id}/channels`,
  when: (p) => p.voiceInput !== 'off',
  inactive: 'option',
  inactiveReason: voiceInactiveReason,
  core: false,
  skippable: true,
  capture: 'none',
  async run(ctx) {
    const entry = ctx.console.getByRole('button', { name: V.entryButton, exact: true }).first();
    await entry.waitFor({ state: 'visible', timeout: 15_000 });
    if ((await entry.getAttribute('aria-expanded')) !== 'true') await entry.click();
    const caption = ctx.console.getByRole('table', { name: V.statsCaption });
    await caption.waitFor({ state: 'visible', timeout: 15_000 });
    await caption.scrollIntoViewIfNeeded();
  },
  async verify(ctx) {
    const full = need(ctx);
    const base = full.record.voiceStatsBaseline;
    const now = await voiceStats(ctx);
    const rec = full.record.speech;
    const needMore = rec?.source === 'BROWSER' || rec?.source === 'MOCK' ? 1 : 0;
    const delta = base ? now.requested - base.requested : 0;
    return { ok: base !== null && delta >= needMore, expected: `요청 +${needMore}(공연 직전 기준값 대비)`, actual: `요청 ${base?.requested ?? '?'} -> ${now.requested}(+${delta}) · 성공 ${now.ok}` };
  },
};

export const voiceSegment: Pick<SegmentDef, 'steps' | 'skipOrder'> = {
  steps: [sv01, sv02, sv03, sv04, sv05, sv06, sv07, sv08],
  skipOrder: ['SV-06', 'SV-08'],
};

