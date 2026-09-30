import { installGovernanceRuntime, resetGovernanceRuntimeForTest } from '../common/governance/governance-runtime';
import type { RetentionJob } from '../governance/jobs/retention.job';
import { waitFor } from './helpers/eventual.helper';
import { allTopicSentences, csvOf, multipartBody, startFixtureEmbeddingServer, startHarness, topicSentences } from './helpers/utterance-analysis.harness';
import type { FixtureEmbeddingServer, Harness } from './helpers/utterance-analysis.harness';

/**
 * 발화 묶음 분석(No.21) 통합 시험 — 데이터 거버넌스(No.45) 편입(설계서 §13 · §14 · AC-DC7-1/2 · FR-DC9). 거버넌스 모드 ON
 * 서버에서 ① 출구 사전 판정(허용 목록에서 문장 분석 서비스 주소가 빠지면 409 · 실행 중 막히면 FAILED) ② 발화 목록
 * 열람 감사(VIEW — 같은 날 1건) ③ 데이터 지도 절(분석 0건이면 키 생략) ④ 만료 분석 파기 잡 단계(반영 예문 유지 ·
 * 요약 감사에 `affectedByKind.UTTERANCE_ANALYSIS` · 0건이면 키 없음)를 확인한다.
 */

type Any = Record<string, any>;
const BASE = (chatbotId: string) => `/chatbots/${chatbotId}/utterance-analyses`;

describe('발화 묶음 분석(No.21) 통합 시험 — 데이터 거버넌스 편입', () => {
  let h: Harness;
  let embedding: FixtureEmbeddingServer;
  let bot: string;
  let allowedHost: string;

  beforeAll(async () => {
    embedding = await startFixtureEmbeddingServer();
    allowedHost = new URL(embedding.url).host;
    h = await startHarness({
      embedding,
      env: {
        DATA_GOVERNANCE_MODE: 'ON',
        DATA_ENCRYPTION_ENABLED: 'false',
        DATA_ENCRYPTION_KEYS: '',
        DATA_EGRESS_ALLOWED_HOSTS: allowedHost,
        DATA_REENCRYPT_JOB_ENABLED: 'false',
        DATA_RETENTION_WINDOW: '00:00-00:00', // 항상 창 안 — tick()이 즉시 동작
        RAG_BASE_URL: '',
      },
    });
    bot = await h.createChatbot('거버넌스 시험봇');
  }, 120_000);

  afterAll(async () => {
    await h?.close();
    await embedding?.close();
  }, 30_000);

  async function analyze(chatbotId: string, sentences: string[], conditions: Any = { targetClusterCount: 4, minClusterSize: 5 }): Promise<Any> {
    const res = await h.startAnalysis(chatbotId, { name: 'g.csv', content: csvOf(sentences) }, conditions);
    if (res.status !== 202) throw new Error(`요청 실패 ${res.status} ${JSON.stringify(res.body)}`);
    return h.waitForTerminal(chatbotId, res.body.analysisId);
  }

  function setAllowlist(hosts: string[]): void {
    resetGovernanceRuntimeForTest();
    installGovernanceRuntime({ mode: 'ON', egress: { allowlist: hosts, enforce: true }, encryptionEnabled: false });
  }

  describe('데이터 지도(§13.4)', () => {
    it('분석이 0건이면 utteranceAnalysis 키가 없다(바이트 동일)', async () => {
      const res = await h.api<Any>('GET', '/governance/map');
      expect(res.status).toBe(200);
      expect(Object.keys(res.body)).not.toContain('utteranceAnalysis');
    });
  });

  describe('출구 사전 판정(AC-DC7-2)', () => {
    it('허용 목록에 문장 분석 서비스 주소가 있으면 분석이 성공한다', async () => {
      const done = await analyze(bot, allTopicSentences());
      expect(done.status).toBe('SUCCEEDED');
    });

    it('허용 목록에서 빠지면 요청은 409 EGRESS_HOST_NOT_ALLOWED · 분석 행이 생기지 않는다', async () => {
      const before = await h.prisma.utteranceAnalysis.count();
      setAllowlist(['other.example.com']);
      try {
        const res = await h.startAnalysis(bot, { name: 'blocked.csv', content: csvOf(allTopicSentences()) }, {});
        expect({ status: res.status, code: (res.body as Any).code }).toEqual({ status: 409, code: 'EGRESS_HOST_NOT_ALLOWED' });
        expect((res.body as Any).message).toContain('허용되지 않았습니다');
        expect(await h.prisma.utteranceAnalysis.count()).toBe(before);
      } finally {
        setAllowlist([allowedHost]);
      }
    });

    it('미리보기도 요청과 같은 출구 사전 판정을 한다 · capability는 출구 차단을 반영한다(네트워크 호출 0)', async () => {
      const cap = () => h.api<Any>('GET', `${BASE(bot)}/capability`);
      expect((await cap()).body.embeddingAvailable).toBe(true);
      setAllowlist(['other.example.com']);
      try {
        const preview = await h.api<Any>('POST', `${BASE(bot)}/preview`, { raw: multipartBody({ name: 'p.csv', content: csvOf(allTopicSentences()) }) });
        expect({ status: preview.status, code: preview.body.code }).toEqual({ status: 409, code: 'EGRESS_HOST_NOT_ALLOWED' });
        const callsBefore = embedding.embedCalls();
        expect((await cap()).body.embeddingAvailable).toBe(false);
        expect(embedding.embedCalls()).toBe(callsBefore);
      } finally {
        setAllowlist([allowedHost]);
      }
    });

    it('감사 targetName에는 파일 이름이 아니라 분석 id 앞 8자리만 남는다(UA-9 정합)', async () => {
      const done = await h.startAnalysis(bot, { name: '010-2468-1357-상담.csv', content: csvOf(allTopicSentences()) }, {});
      const finished = await h.waitForTerminal(bot, done.body.analysisId);
      const audit = await h.prisma.auditLog.findFirstOrThrow({ where: { action: 'CREATE', targetType: 'UtteranceAnalysis', targetId: finished.id } });
      expect(audit.targetName).toBe(`분석 ${finished.id.slice(0, 8)}`);
    });

    it('작업 도중 출구가 막히면 FAILED(EGRESS_BLOCKED) — 부분 결과 0', async () => {
      const many = Array.from({ length: 64 }, (_, i) => `${['환불', '배송', '로그인', '결제'][i % 4]} 문의 ${i}번째 사례입니다`);
      const big = await h.createChatbot('출구 도중 차단봇');
      embedding.setDelayMs(300);
      try {
        const res = await h.startAnalysis(big, { name: 'mid.csv', content: csvOf(many) }, {});
        expect(res.status).toBe(202);
        await new Promise((r) => setTimeout(r, 100));
        setAllowlist(['other.example.com']);
        const done = await h.waitForTerminal(big, res.body.analysisId, 30_000);
        expect(done.status).toBe('FAILED');
        expect(done.failureReason).toBe('EGRESS_BLOCKED');
        expect(await h.prisma.analyzedUtterance.count({ where: { analysisId: res.body.analysisId } })).toBe(0);
      } finally {
        embedding.setDelayMs(0);
        setAllowlist([allowedHost]);
      }
    }, 60_000);
  });

  describe('열람·내보내기 감사(§13.2)', () => {
    let analysisId: string;

    beforeAll(async () => {
      const done = await analyze(bot, allTopicSentences());
      analysisId = done.id;
    }, 60_000);

    it('발화 목록 조회는 VIEW 감사를 남긴다 — 같은 열람자·같은 분석·같은 날 1건(폴링·페이지 넘김 중복 억제)', async () => {
      const views = () => h.prisma.auditLog.count({ where: { action: 'VIEW', targetType: 'UtteranceAnalysis', targetId: analysisId } });
      expect(await views()).toBe(0);
      expect((await h.api('GET', `${BASE(bot)}/${analysisId}/utterances`)).status).toBe(200);
      // 열람 감사는 응답 뒤에 발사 후 망각으로 기록된다 — 결과가 생길 때까지 폴링한다.
      await waitFor(async () => (await views()) >= 1, { label: 'VIEW 감사 기록' });
      expect(await views()).toBe(1);
      await h.api('GET', `${BASE(bot)}/${analysisId}/utterances?page=2&pageSize=10`);
      await h.api('GET', `${BASE(bot)}/${analysisId}/utterances?q=${encodeURIComponent('환불')}`);
      await new Promise((r) => setTimeout(r, 300));
      expect(await views()).toBe(1);
      const audit = await h.prisma.auditLog.findFirstOrThrow({ where: { action: 'VIEW', targetType: 'UtteranceAnalysis', targetId: analysisId } });
      expect(audit.chatbotId).toBe(bot);
      // 문장은 감사에 없다
      expect(`${audit.summary ?? ''}${audit.afterValue ?? ''}${audit.beforeValue ?? ''}`).not.toContain('환불');
    });

    it('묶음 상세(문장 없는 요약)는 열람 감사 대상이 아니다', async () => {
      const before = await h.prisma.auditLog.count({ where: { action: 'VIEW', targetType: 'UtteranceAnalysis' } });
      await h.api('GET', `${BASE(bot)}/${analysisId}`);
      await h.api('GET', BASE(bot));
      expect(await h.prisma.auditLog.count({ where: { action: 'VIEW', targetType: 'UtteranceAnalysis' } })).toBe(before);
    });

    it('엑셀 다운로드는 EXPORT 감사를 남긴다(모드 무관)', async () => {
      const res = await h.api('GET', `${BASE(bot)}/${analysisId}/export`);
      expect(res.status).toBe(200);
      const audit = await h.prisma.auditLog.findFirstOrThrow({ where: { action: 'EXPORT', targetType: 'UtteranceAnalysis', targetId: analysisId } });
      expect(audit.summary).toBe('발화 묶음 분석 결과 내보내기(36행)');
      expect(audit.afterValue).toContain('"utterances":32');
    });
  });

  describe('데이터 지도 · 만료 분석 파기(§14.2 · AC-DC7-1)', () => {
    it('분석이 생기면 데이터 지도에 "업로드 발화 분석" 절이 나타난다', async () => {
      const res = await h.api<Any>('GET', '/governance/map');
      expect(res.status).toBe(200);
      expect(res.body.utteranceAnalysis).toMatchObject({
        storesMaskedOnly: true,
        originalFileStored: false,
        retentionDays: 90,
        exits: ['EMBEDDING'],
        nameSuggestEnabled: false,
        retentionJobEnabled: false, // 이 시험 환경은 파기 잡 루프를 끈다 — 화면이 "자동 삭제가 동작하지 않습니다"를 경고한다
      });
      expect(res.body.utteranceAnalysis.analyses).toBeGreaterThanOrEqual(2);
      expect(res.body.utteranceAnalysis.utterances).toBeGreaterThanOrEqual(64);
    });

    it('만료된 종결 분석만 파기 잡이 지운다 — 반영된 의도 예문은 남고 요약 감사에 건수만 남는다', async () => {
      const purgeBot = await h.createChatbot('파기 시험봇');
      const intent = await h.api<Any>('POST', `/chatbots/${purgeBot}/intents`, { json: { name: '환불 문의', examples: ['기존 예문 하나'] } });
      const intentId = intent.body.intent.id as string;

      const expired = await analyze(purgeBot, allTopicSentences());
      const fresh = await analyze(purgeBot, allTopicSentences());
      const failed = await h.prisma.utteranceAnalysis.create({
        data: { chatbotId: purgeBot, status: 'FAILED', failureReason: 'INTERNAL_ERROR', fileName: 'x.csv', fileKind: 'CSV', conditions: '{}', counts: '{}', algorithmVersion: 'skmeans-1', expiresAt: new Date(Date.now() - 86_400_000) },
      });
      // 처리 중인 분석은 만료 시각이 지났어도 지우지 않는다(잠금 행 — 마지막에 정리)
      const running = await h.prisma.utteranceAnalysis.create({
        data: { chatbotId: purgeBot, status: 'RUNNING', activeLock: 'ACTIVE', fileName: 'r.csv', fileKind: 'CSV', conditions: '{}', counts: '{}', algorithmVersion: 'skmeans-1', expiresAt: new Date(Date.now() - 86_400_000) },
      });

      // 반영 1건 — 분석이 파기돼도 예문은 자산이라 남는다
      const items = (await h.api<Any>('GET', `${BASE(purgeBot)}/${expired.id}/utterances?pageSize=100`)).body.items as Any[];
      const target = items.find((u) => (u.text as string).startsWith('환불'))!;
      const applied = await h.api<Any>('POST', `${BASE(purgeBot)}/${expired.id}/apply`, { json: { utteranceIds: [target.id], target: { kind: 'EXISTING', intentId } } });
      expect(applied.body.succeeded).toBe(1);

      await h.prisma.utteranceAnalysis.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

      const purgeRunsBefore = await h.prisma.auditLog.count({ where: { action: 'PURGE', targetType: 'RetentionRun' } });
      const job = h.moduleRef.get<RetentionJob>((await import('../governance/jobs/retention.job')).RetentionJob, { strict: false });
      await h.prisma.governanceJobState.updateMany({ where: { jobName: 'RETENTION' }, data: { lastCompletedDay: null } });
      await job.tick();

      expect(await h.prisma.utteranceAnalysis.findUnique({ where: { id: expired.id } })).toBeNull();
      expect(await h.prisma.utteranceCluster.count({ where: { analysisId: expired.id } })).toBe(0);
      expect(await h.prisma.analyzedUtterance.count({ where: { analysisId: expired.id } })).toBe(0);
      expect(await h.prisma.utteranceAnalysis.findUnique({ where: { id: failed.id } })).toBeNull();
      expect(await h.prisma.utteranceAnalysis.findUnique({ where: { id: fresh.id } })).not.toBeNull(); // 만료 전
      expect(await h.prisma.analyzedUtterance.count({ where: { analysisId: fresh.id } })).toBe(32);
      expect(await h.prisma.utteranceAnalysis.findUnique({ where: { id: running.id } })).not.toBeNull(); // 처리 중 — 지우지 않는다

      // 반영된 의도 예문은 그대로
      const intentRow = await h.prisma.intent.findUniqueOrThrow({ where: { id: intentId } });
      expect(JSON.parse(intentRow.examples)).toContain(target.text);

      // 요약 감사 — 건수만(문장 0)
      const purgeAudits = await h.prisma.auditLog.findMany({ where: { action: 'PURGE', targetType: 'RetentionRun' }, orderBy: { createdAt: 'desc' } });
      expect(purgeAudits.length).toBe(purgeRunsBefore + 1);
      expect(purgeAudits[0].afterValue).toContain('"UTTERANCE_ANALYSIS":2');
      expect(purgeAudits[0].afterValue).not.toContain('환불');

      await h.prisma.utteranceAnalysis.delete({ where: { id: running.id } }); // 정리(잠금 해제)
    }, 120_000);

    it('만료된 분석이 없으면 파기 결과에 UTTERANCE_ANALYSIS 키가 없다(바이트 동일)', async () => {
      const job = h.moduleRef.get<RetentionJob>((await import('../governance/jobs/retention.job')).RetentionJob, { strict: false });
      await h.prisma.governanceJobState.updateMany({ where: { jobName: 'RETENTION' }, data: { lastCompletedDay: null } });
      await job.tick();
      // 다른 보존 종류의 0건 항목은 기존처럼 남지만, 이 그룹의 키는 만들어지지 않는다.
      const latest = await h.prisma.auditLog.findFirstOrThrow({ where: { action: 'PURGE', targetType: 'RetentionRun' }, orderBy: { createdAt: 'desc' } });
      expect(latest.afterValue).not.toContain('UTTERANCE_ANALYSIS');
    });
  });

  describe('기동 검사(§13.3)', () => {
    it('모드 ON + 이름 제안 켬이면 로컬 생성기 호스트도 허용 목록에 있어야 한다(순수 함수)', async () => {
      const { checkEgressBootUrls } = await import('../governance/bootstrap/lib/egress-boot-check');
      const allow = (allowed: string[]) => (url: string) => allowed.includes(new URL(url).hostname);
      const off = checkEgressBootUrls({ augmentationProvider: 'rule', augmentationLocalBaseUrl: 'http://gen.internal:8101', utteranceNameSuggestEnabled: false }, allow([]));
      expect(off.ok).toBe(true);
      const blocked = checkEgressBootUrls({ augmentationProvider: 'rule', augmentationLocalBaseUrl: 'http://gen.internal:8101', utteranceNameSuggestEnabled: true }, allow(['ml-worker.internal']));
      expect(blocked.ok).toBe(false);
      expect(blocked.reason).toMatch(/발화 묶음 분석 이름 제안/);
      const allowed = checkEgressBootUrls({ augmentationProvider: 'rule', augmentationLocalBaseUrl: 'http://gen.internal:8101', utteranceNameSuggestEnabled: true }, allow(['gen.internal']));
      expect(allowed.ok).toBe(true);
      // 증강 provider=local이면 기존 검사가 이미 같은 호스트를 본다(중복 검사 없음)
      const localProvider = checkEgressBootUrls({ augmentationProvider: 'local', augmentationLocalBaseUrl: 'http://gen.internal:8101', utteranceNameSuggestEnabled: true }, allow(['gen.internal']));
      expect(localProvider.ok).toBe(true);
    });
  });
});
