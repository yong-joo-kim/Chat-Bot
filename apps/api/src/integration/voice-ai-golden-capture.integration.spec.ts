import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bootHarness, eventually, startFakeRag } from './helpers/ai-guardrails.harness';
import type { FakeRag, Harness } from './helpers/ai-guardrails.harness';

/**
 * 음성 AI(No.32) 커밋 ① — **도입 전 공개 응답 골든 캡처**(voice-ai-설계.md §2.7·§16).
 *
 * 공개 설정(`/config` · `?proactive=1`) · 메시지 응답(정상 답/미응답/BLOCK/버전 읽기 실패/보류 시작) · 보류 폴링(READY) 응답의
 * **직렬화 바이트(키 순서 포함)**를 고정한다. 이 변경(shared-types 계약 추가)은 서버 코드를 바꾸지 않으므로 지금은 당연히 같다 —
 * 가치는 이후 커밋 ③(API 통합)이 이 골든을 그대로 통과해야 한다는 데 있다:
 *   - 음성 설정 없는 챗봇은 `voice`·`speech` 키가 없고 바이트가 같다.
 *   - 시스템 안내 3종(BLOCK·버전 읽기 실패·보류 시작)은 `features:['speech-v1']`를 선언해도 바이트가 같다(H-3) — 이 시험이 지금도
 *     선언 유무 두 요청을 같은 골든과 비교한다(커밋 ③ 이후 듣기 켜짐 챗봇에서도 같은 단언을 건다).
 *
 * 동적 값(UUID·시각·슬러그·챗봇 이름)은 자리표시자로 치환해 비교한다. 골든 갱신은 의도된 변경일 때만 `VOICE_GOLDEN_WRITE=1`로 1회 실행한다
 * (설계서 §15.3 닫힌 목록에 없는 변경은 기대값 변경 금지).
 */

const GOLDEN_PATH = join(__dirname, 'helpers', 'voice-ai-golden.json');
const RAG_ANSWER = '문서 답변 본문입니다. 연락처는 02-123-4567 입니다.';

function normalize(raw: string, subs: Array<[string, string]>): string {
  let out = raw;
  for (const [from, to] of subs) out = out.split(from).join(to);
  return out
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<UUID>')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, '<ISO>');
}

describe('음성 AI(No.32) 도입 전 공개 응답 골든 캡처', () => {
  let h: Harness;
  let rag: FakeRag;

  beforeAll(async () => {
    rag = await startFakeRag();
    rag.answer = RAG_ANSWER;
    h = await bootHarness({ tmpPrefix: 'voice-golden-', env: { RAG_BASE_URL: rag.url, RAG_STATUS_CACHE_MS: '600000' } });
  }, 90_000);

  afterAll(async () => {
    await h?.close();
    await rag?.close();
  }, 20_000);

  it('공개 설정·메시지·폴링 응답 바이트가 골든과 같다(시스템 안내 3종은 speech-v1 선언 여부와 무관)', async () => {
    const captured: Record<string, string> = {};
    const post = (slug: string, message: string, features?: string[]) =>
      h.pub<Record<string, unknown> & { messageId: string }>('POST', `/public/chatbots/${slug}/messages`, { sessionId: h.sessionUuid(), message, ...(features ? { features } : {}) });

    // 1) 정상 답 · 미응답 · 공개 설정 — 엔진 챗봇.
    const engine = await h.createChatbot('골든엔진');
    const keyword = `골든키워드${engine.id.slice(0, 6)}`;
    const kw = await h.admin<{ id: string }>('POST', `/chatbots/${engine.id}/keywords`, { name: keyword, synonyms: [] });
    await h.admin('POST', `/chatbots/${engine.id}/dialog-nodes`, { name: '응답', nodeType: 'NORMAL', keywordIds: [kw.body.id], outputs: [{ type: 'TEXT', payload: { text: '엔진 답변입니다.' } }] });
    const engineSubs: Array<[string, string]> = [
      [engine.slug, '<SLUG>'],
      [keyword, '<KW>'],
    ];
    const rawBodies = new Map<string, string>();
    const record = (key: string, body: unknown, subs: Array<[string, string]>) => {
      const text = JSON.stringify(body);
      rawBodies.set(key, text);
      captured[key] = normalize(text, subs);
    };

    record('config', (await h.pub('GET', `/public/chatbots/${engine.slug}/config`)).body, [...engineSubs, [engine.id, '<ID>']]);
    record('config_proactive', (await h.pub('GET', `/public/chatbots/${engine.slug}/config?proactive=1`)).body, engineSubs);
    // 이름은 `골든엔진-<suffix>` — suffix를 치환해 비교한다.
    const nameSuffix = engine.slug.replace(/^agr-/, '');
    for (const k of ['config', 'config_proactive']) captured[k] = captured[k].split(`골든엔진-${nameSuffix}`).join('<NAME>');

    record('message_answered', (await post(engine.slug, `${keyword} 문의`)).body, engineSubs);
    record('message_unanswered', (await post(engine.slug, '전혀 관련없는 질문 zzqx').then((r) => r)).body, engineSubs);

    // 2) 시스템 안내 — BLOCK(입구 금지어 안내).
    const bannedWord = `골든금지어${Math.random().toString(36).slice(2, 8)}`;
    expect((await h.admin('POST', '/banned-words', { word: bannedWord, matchType: 'CONTAINS', policy: 'BLOCK' })).status).toBe(201);
    const blockPlain = await post(engine.slug, `${bannedWord} 포함 문의`);
    const blockDeclared = await post(engine.slug, `${bannedWord} 포함 문의`, ['speech-v1']);
    record('message_block', blockPlain.body, engineSubs);
    expect(normalize(JSON.stringify(blockDeclared.body), engineSubs)).toBe(captured.message_block);

    // 3) 시스템 안내 — 버전 읽기 실패(운영 버전 본문 손상 → 고정 폴백 문구).
    const broken = await h.createChatbot('골든버전실패');
    const brokenSubs: Array<[string, string]> = [[broken.slug, '<SLUG>']];
    await h.prisma.chatbotVersionSequence.create({ data: { chatbotId: broken.id, lastVersionNo: 1 } });
    const row = await h.prisma.chatbotVersion.create({
      data: {
        chatbotId: broken.id,
        versionNo: 1,
        trigger: 'MANUAL',
        schemaVersion: 1,
        contentHash: 'golden-corrupt-hash',
        counts: '{}',
        sizeBytes: 10,
      },
    });
    await h.prisma.chatbotVersionPayload.create({ data: { versionId: row.id, payload: 'not-a-valid-snapshot' } });
    await h.prisma.chatbot.update({ where: { id: broken.id }, data: { prodVersionId: row.id } });
    const brokenPlain = await post(broken.slug, '아무 질문');
    const brokenDeclared = await post(broken.slug, '아무 질문', ['speech-v1']);
    record('message_version_unavailable', brokenPlain.body, brokenSubs);
    expect(normalize(JSON.stringify(brokenDeclared.body), brokenSubs)).toBe(captured.message_version_unavailable);

    // 4) 시스템 안내 — 보류 RAG 시작(대기 문구) + 폴링 READY.
    const ragBot = await h.createChatbot('골든RAG');
    const put = await h.admin('PUT', `/chatbots/${ragBot.id}/answer-settings`, { semanticEnabled: false, ragEnabled: true, ragCompany: '테스트회사' });
    expect(put.status).toBe(200);
    const ragSubs: Array<[string, string]> = [[ragBot.slug, '<SLUG>']];
    const pendingPlain = await post(ragBot.slug, '문서에서 찾아줄 질문입니다');
    const pendingDeclared = await post(ragBot.slug, '문서에서 찾아줄 질문입니다', ['speech-v1']);
    record('message_pending_start', pendingPlain.body, ragSubs);
    expect(normalize(JSON.stringify(pendingDeclared.body), ragSubs)).toBe(captured.message_pending_start);
    expect(pendingPlain.body.pendingAnswer).toBeDefined();

    const done = await eventually(async () => {
      const r = await h.pub<{ status: string }>('GET', `/public/chatbots/${ragBot.slug}/messages/${pendingPlain.body.messageId}`);
      return r.body.status !== 'PENDING' ? r : null;
    }, 8000);
    expect(done).not.toBeNull();
    record('poll_ready', done!.body, ragSubs);
    expect((done!.body as { status: string }).status).toBe('READY');
    // 보류 폴링도 선언(헤더·쿼리 없음 — 폴링은 요청 본문이 없다)과 무관하다.

    // 5) [커밋 ③ 추가] 폴링 FAILED(챗봇 폴백 문구 — 개인정보만 남는 답은 출구에서 폴백으로 수렴) · FAILED + 안전 문구 대체(출구 REPLACE 규칙).
    //    음성 꺼짐·선언 없음 기준 바이트이므로 도입 전과 같다 — 커밋 ③은 같은 골든을 `speech` 키 없이 통과해야 한다.
    const pollUntilDone = async (slug: string, messageId: string) =>
      eventually(async () => {
        const r = await h.pub<{ status: string }>('GET', `/public/chatbots/${slug}/messages/${messageId}`);
        return r.body.status !== 'PENDING' ? r : null;
      }, 8000);
    const failedBot = await h.createChatbot('골든RAG폴백');
    expect((await h.admin('PUT', `/chatbots/${failedBot.id}/answer-settings`, { semanticEnabled: false, ragEnabled: true, ragCompany: '테스트회사' })).status).toBe(200);
    const failedSubs: Array<[string, string]> = [[failedBot.slug, '<SLUG>']];
    rag.answer = '901231-1234567';
    const failedFirst = await post(failedBot.slug, '문서에서 찾아줄 질문입니다');
    const failedDone = await pollUntilDone(failedBot.slug, failedFirst.body.messageId);
    expect(failedDone).not.toBeNull();
    expect((failedDone!.body as { status: string }).status).toBe('FAILED');
    record('poll_failed', failedDone!.body, failedSubs);

    const safetyBot = await h.createChatbot('골든RAG안전대체');
    expect((await h.admin('PUT', `/chatbots/${safetyBot.id}/answer-settings`, { semanticEnabled: false, ragEnabled: true, ragCompany: '테스트회사' })).status).toBe(200);
    const rule = await h.admin('POST', `/chatbots/${safetyBot.id}/guardrails/rules`, {
      name: '골든의료',
      category: 'MEDICAL_ADVICE',
      expressions: ['복용하세요'],
      appliesTo: 'OUTBOUND',
      action: 'REPLACE',
      replacementText: '지금은 안내드릴 수 없어요. 전문 상담 기관에 연락해 주세요.',
    });
    expect(rule.status).toBe(201);
    const safetySubs: Array<[string, string]> = [[safetyBot.slug, '<SLUG>']];
    rag.answer = '하루 세 번 약을 복용하세요.';
    const safetyFirst = await post(safetyBot.slug, '문서에서 찾아줄 질문입니다');
    const safetyDone = await pollUntilDone(safetyBot.slug, safetyFirst.body.messageId);
    expect(safetyDone).not.toBeNull();
    expect((safetyDone!.body as { status: string }).status).toBe('FAILED');
    record('poll_safety_replaced', safetyDone!.body, safetySubs);

    // 골든 캡처에 음성 키가 없어야 한다(도입 전).
    for (const [key, text] of Object.entries(captured)) {
      expect(text).not.toContain('"speech"');
      expect(text).not.toContain('"voice"');
      expect(key.length).toBeGreaterThan(0);
    }
    expect(Object.keys(captured)).toEqual(['config', 'config_proactive', 'message_answered', 'message_unanswered', 'message_block', 'message_version_unavailable', 'message_pending_start', 'poll_ready', 'poll_failed', 'poll_safety_replaced']);

    if (process.env.VOICE_GOLDEN_WRITE === '1' || !existsSync(GOLDEN_PATH)) {
      writeFileSync(GOLDEN_PATH, `${JSON.stringify(captured, null, 2)}\n`, 'utf8');
    }
    const golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as Record<string, string>;
    expect(captured).toEqual(golden);
  });
});
