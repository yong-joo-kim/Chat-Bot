import { allTopicSentences, csvOf, startFakeLabelServer, startHarness, topicSentences } from './helpers/utterance-analysis.harness';
import type { FakeLabelServer, Harness } from './helpers/utterance-analysis.harness';

/**
 * 발화 묶음 분석(No.21) 통합 시험 — 묶음 이름 제안(LLM 선택 기능 · 설계서 §16 · AC-DC6-1~3). **가짜 ml-worker HTTP 서버**로
 * `/cluster-label` 계약(요청 = 키워드 + 마스킹 표본 ≤5 · 응답 = 이름 또는 null)과 실패 시나리오(오류·시간 초과·영문·잘림·
 * 금지어)를 확인한다. 이름 제안이 어떻게 실패해도 분석은 SUCCEEDED이고 그 묶음은 키워드 이름만 쓴다. 3050·Ollama 실제
 * 호출은 수동 게이트(AC-DC6-4)라 이 시험의 범위 밖이다.
 */

type Any = Record<string, any>;
const BASE = (chatbotId: string) => `/chatbots/${chatbotId}/utterance-analyses`;

describe('발화 묶음 분석(No.21) 통합 시험 — 묶음 이름 제안(가짜 ml-worker)', () => {
  let h: Harness;
  let label: FakeLabelServer;
  let bot: string;

  beforeAll(async () => {
    label = await startFakeLabelServer();
    h = await startHarness({
      env: {
        UTTERANCE_ANALYSIS_NAME_SUGGEST_ENABLED: 'true',
        AUGMENTATION_LOCAL_BASE_URL: label.url,
        UTTERANCE_ANALYSIS_NAME_SUGGEST_TIMEOUT_MS: '1000',
        UTTERANCE_ANALYSIS_NAME_SUGGEST_BUDGET_MS: '10000',
      },
    });
    bot = await h.createChatbot('이름 제안 봇');
  }, 120_000);

  afterAll(async () => {
    await h?.close();
    await label?.close();
  }, 30_000);

  beforeEach(() => {
    label.requests.length = 0;
    label.setMode('OK');
  });

  async function run(sentences: string[], conditions: Any): Promise<Any> {
    const res = await h.startAnalysis(bot, { name: 'n.csv', content: csvOf(sentences) }, { targetClusterCount: 4, minClusterSize: 5, ...conditions });
    if (res.status !== 202) throw new Error(`요청 실패 ${res.status} ${JSON.stringify(res.body)}`);
    return h.waitForTerminal(bot, res.body.analysisId);
  }

  it('capability — 설정을 켜고 로컬 생성기 주소가 있으면 nameSuggestAvailable=true', async () => {
    const cap = await h.api<Any>('GET', `${BASE(bot)}/capability`);
    expect(cap.body.nameSuggestAvailable).toBe(true);
  });

  it('요청에서 끄면(기본) 생성 백엔드 호출 0 · 상태 OFF', async () => {
    const done = await run(allTopicSentences(), {});
    expect(done.status).toBe('SUCCEEDED');
    expect(done.nameSuggest).toEqual({ status: 'OFF', failureReason: null });
    expect(label.requests).toHaveLength(0);
    expect((done.clusters as Any[]).every((c) => c.suggestedName === null)).toBe(true);
  });

  it('켜면 묶음당 1회 · 키워드 + 마스킹 표본 ≤5 · 미분류 요청 0 · 제안은 이름을 대체하지 않는다(AC-DC6-3)', async () => {
    const phone = '010-2468-1357';
    const sentences = [
      ...topicSentences('환불').map((s, i) => (i === 0 ? `${s} 연락처 ${phone}` : s)),
      ...topicSentences('배송'),
      ...topicSentences('결제'),
      ...topicSentences('로그인').slice(0, 2), // 작은 묶음 -> 미분류
    ];
    const done = await run(sentences, { targetClusterCount: 4, nameSuggest: true });
    expect(done.status).toBe('SUCCEEDED');
    expect(done.nameSuggest).toEqual({ status: 'DONE', failureReason: null });

    const real = (done.clusters as Any[]).filter((c) => !c.unassigned);
    const unassigned = (done.clusters as Any[]).find((c) => c.unassigned) as Any;
    expect(unassigned).toBeDefined();
    expect(label.requests).toHaveLength(real.length); // 미분류는 요청하지 않는다
    for (const r of label.requests) {
      expect(r.locale).toBe('ko');
      expect(r.keywords.length).toBeGreaterThanOrEqual(1);
      expect(r.keywords.length).toBeLessThanOrEqual(20);
      expect(r.keywords.every((k) => k.length <= 30)).toBe(true);
      expect(r.samples.length).toBeLessThanOrEqual(5);
      expect(r.samples.length).toBeGreaterThanOrEqual(1);
    }
    const sent = JSON.stringify(label.requests);
    expect(sent).not.toContain('2468'); // 원문 전화번호 0 — 마스킹본만 나간다
    for (const c of real) {
      expect(c.suggestedName).toMatch(/ 안내 문의$/);
      expect(c.displayName).toBe(c.autoName); // AI 제안은 이름을 대체하지 않는다
      expect(c.customName).toBeNull();
    }
    expect(unassigned.suggestedName).toBeNull();

    // "이 이름 사용" — 관리자가 customName으로 복사하면 표시 이름이 바뀐다
    const adopt = await h.api<Any>('PATCH', `${BASE(bot)}/${done.id}/clusters/${real[0].id}`, { json: { customName: real[0].suggestedName } });
    expect(adopt.body.displayName).toBe(real[0].suggestedName);
  });

  it.each([
    ['영문 출력', 'ENGLISH', 'NAME_REJECTED'],
    ['너무 긴 출력(30자 초과)', 'LONG', 'NAME_REJECTED'],
    ['빈 응답(null)', 'EMPTY', 'NAME_SUGGEST_UNAVAILABLE'],
    ['HTTP 500', 'HTTP_ERROR', 'NAME_SUGGEST_UNAVAILABLE'],
  ] as const)('%s → 분석은 SUCCEEDED · suggestedName null · 이름 제안 FAILED(%s)(AC-DC6-2)', async (_name, mode, reason) => {
    label.setMode(mode);
    const done = await run(allTopicSentences(), { nameSuggest: true });
    expect(done.status).toBe('SUCCEEDED');
    expect(done.nameSuggest).toEqual({ status: 'FAILED', failureReason: reason });
    expect((done.clusters as Any[]).every((c) => c.suggestedName === null)).toBe(true);
    expect((done.clusters as Any[]).every((c) => c.displayName === c.autoName)).toBe(true);
    expect(label.requests.length).toBe(4);
  });

  it('일부만 통과하면 PARTIAL — 통과한 묶음만 제안 이름을 갖는다', async () => {
    label.setMode('ALTERNATE');
    const done = await run(allTopicSentences(), { nameSuggest: true });
    expect(done.status).toBe('SUCCEEDED');
    expect(done.nameSuggest.status).toBe('PARTIAL');
    const named = (done.clusters as Any[]).filter((c) => c.suggestedName);
    expect(named).toHaveLength(2);
  });

  it('응답이 없으면(시간 초과 1초) 분석은 계속되어 SUCCEEDED · 이름 제안 FAILED', async () => {
    label.setMode('HANG');
    const started = Date.now();
    const done = await run([...topicSentences('환불'), ...topicSentences('배송')], { targetClusterCount: 2, nameSuggest: true });
    expect(done.status).toBe('SUCCEEDED');
    expect(done.nameSuggest).toEqual({ status: 'FAILED', failureReason: 'NAME_SUGGEST_UNAVAILABLE' });
    expect(Date.now() - started).toBeGreaterThanOrEqual(1500); // 묶음 2개 × 시간 제한 1초
    expect(label.requests).toHaveLength(2);
  }, 60_000);

  it('금지어가 들어간 제안은 버린다 — 금지어 사전에 "안내"가 있으면 "○○ 안내 문의"는 탈락', async () => {
    const bw = await h.api<Any>('POST', '/banned-words', { json: { word: '안내', matchType: 'CONTAINS', policy: 'WARN' } });
    expect([200, 201]).toContain(bw.status);
    try {
      const done = await run(allTopicSentences(), { nameSuggest: true });
      expect(done.status).toBe('SUCCEEDED');
      expect(done.nameSuggest).toEqual({ status: 'FAILED', failureReason: 'NAME_REJECTED' });
      expect((done.clusters as Any[]).every((c) => c.suggestedName === null)).toBe(true);
    } finally {
      await h.api('DELETE', `/banned-words/${bw.body.id as string}`);
    }
  });
});
