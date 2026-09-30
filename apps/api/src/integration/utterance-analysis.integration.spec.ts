import ExcelJS from 'exceljs';
import { LearningApplyService } from '../learning/learning-apply.service';
import { RagHttpClient } from '../rag/rag-http.client';
import { waitFor } from './helpers/eventual.helper';
import {
  TOPICS,
  UNRELATED_SENTENCES,
  allTopicSentences,
  buildCsvFile,
  buildXlsxFile,
  multipartBody,
  startHarness,
  topicSentences,
} from './helpers/utterance-analysis.harness';
import type { Harness } from './helpers/utterance-analysis.harness';

/**
 * 발화 묶음 분석(No.21) 통합 시험 — 핵심 흐름(`docs/02-spec/deep-clustering-설계.md` §20 · AC-DC1~DC4 · AC-DC7-5).
 * GPU·Python·Ollama 없이 **가짜 임베딩 서버**(설계된 벡터)로 실제 알고리즘을 끝까지 돌린다. 실제 KURE-v1 전 경로
 * 수동 확인은 이 시험의 범위 밖이다(수동 게이트 AC-DC3-4·DC6-4·DC7-4).
 */

type Any = Record<string, any>;

const BASE = (chatbotId: string) => `/chatbots/${chatbotId}/utterance-analyses`;

function rowsOf(sentences: string[], count?: string): Array<[string, string?, string?]> {
  return sentences.map((s) => [s, count]);
}

describe('발화 묶음 분석(No.21) 통합 시험 — 핵심 흐름', () => {
  let h: Harness;
  let chatbotId: string;

  beforeAll(async () => {
    // RAG 주소만 설정해 둔다(아무도 호출하지 않아야 한다 — "2단계로 넘어갈 발화" 표시 시험).
    h = await startHarness({ env: { RAG_BASE_URL: 'http://127.0.0.1:1' } });
    chatbotId = await h.createChatbot();
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  }, 30_000);

  async function runAnalysis(id: string, sentences: string[], conditions: Any = {}, fileName = 'utterances.csv'): Promise<Any> {
    const res = await h.startAnalysis(id, { name: fileName, content: buildCsvFile(rowsOf(sentences)) }, conditions);
    expect(res.status).toBe(202);
    return h.waitForTerminal(id, res.body.analysisId);
  }

  async function allUtterances(id: string, analysisId: string, query = ''): Promise<Any[]> {
    const out: Any[] = [];
    for (let page = 1; ; page += 1) {
      const res = await h.api<Any>('GET', `${BASE(id)}/${analysisId}/utterances?page=${page}&pageSize=100${query}`);
      expect(res.status).toBe(200);
      out.push(...res.body.items);
      if (out.length >= res.body.total) return out;
    }
  }

  describe('마이그레이션(§10.2)', () => {
    it('새 테이블 3개와 유일 제약이 생기고 원시 부분 유니크 인덱스 4개는 그대로다', async () => {
      const partial = await h.prisma.$queryRawUnsafe<Array<{ c: number | bigint }>>("SELECT count(*) AS c FROM sqlite_master WHERE type='index' AND sql LIKE '%WHERE%'");
      expect(Number(partial[0].c)).toBe(4);
      const tables = await h.prisma.$queryRawUnsafe<Array<{ name: string }>>("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('utterance_analyses','utterance_clusters','analyzed_utterances') ORDER BY name");
      expect(tables.map((t) => t.name)).toEqual(['analyzed_utterances', 'utterance_analyses', 'utterance_clusters']);
      const indexes = await h.prisma.$queryRawUnsafe<Array<{ name: string }>>("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name IN ('utterance_analyses','utterance_clusters','analyzed_utterances') AND name NOT LIKE 'sqlite_%'");
      expect(indexes.map((i) => i.name)).toEqual(
        expect.arrayContaining([
          'utterance_analyses_activeLock_key',
          'utterance_analyses_expiresAt_status_idx',
          'utterance_clusters_analysisId_ordinal_key',
          'analyzed_utterances_analysisId_seq_key',
          'analyzed_utterances_analysisId_textNormalized_key',
        ]),
      );
    });

    it('activeLock 유일 제약 — 두 번째 ACTIVE 행은 DB가 거절하고 종결 행(null)은 여러 개 허용한다', async () => {
      const bot = await h.createChatbot('제약 시험봇');
      const base = { chatbotId: bot, fileName: 'a.csv', fileKind: 'CSV', conditions: '{}', counts: '{}', algorithmVersion: 'skmeans-1', expiresAt: new Date(Date.now() + 86_400_000) };
      const a = await h.prisma.utteranceAnalysis.create({ data: { ...base, status: 'RUNNING', activeLock: 'ACTIVE' } });
      await expect(h.prisma.utteranceAnalysis.create({ data: { ...base, status: 'QUEUED', activeLock: 'ACTIVE' } })).rejects.toMatchObject({ code: 'P2002' });
      await h.prisma.utteranceAnalysis.create({ data: { ...base, status: 'FAILED', activeLock: null } });
      await h.prisma.utteranceAnalysis.create({ data: { ...base, status: 'SUCCEEDED', activeLock: null } });
      await h.prisma.utteranceAnalysis.delete({ where: { id: a.id } });
    });
  });

  describe('capability · 양식 · 미리보기', () => {
    it('capability — 네트워크 호출 없이 가용 여부·한도·보관 현황을 준다(VIEWER도 조회 가능)', async () => {
      const res = await h.api<Any>('GET', `${BASE(chatbotId)}/capability`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        embeddingAvailable: true,
        nameSuggestAvailable: false,
        busy: { server: false, chatbot: false },
        limits: { maxFileBytes: 5 * 1024 * 1024, maxRows: 5000, maxChars: 300 },
        retentionDays: 90,
        envModeEnabled: false,
      });
      expect(res.body.stored.max).toBe(20);
      const viewer = await h.api<Any>('GET', `${BASE(chatbotId)}/capability`, { cookie: h.cookies.viewer });
      expect(viewer.status).toBe(200);
    });

    it('양식 받기 — xlsx·csv 모두 머리글 3개 + 합성 예시 2행(개인정보 0)', async () => {
      const csv = await h.api('GET', `${BASE(chatbotId)}/template?format=csv`);
      expect(csv.status).toBe(200);
      expect(String(csv.headers['content-type'])).toContain('text/csv');
      expect(csv.raw[0]).toBe(0xef); // UTF-8 BOM
      const text = csv.raw.toString('utf-8');
      expect(text).toContain('발화,발생 횟수,출처 메모');
      expect(text.split('\r\n').filter((l) => l).length).toBe(3);

      const xlsx = await h.api('GET', `${BASE(chatbotId)}/template?format=xlsx`);
      expect(xlsx.status).toBe(200);
      expect(String(xlsx.headers['content-disposition'])).toContain('utterance-analysis-template.xlsx');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(xlsx.raw as never);
      const sheet = wb.worksheets[0];
      expect([1, 2, 3].map((c) => sheet.getRow(1).getCell(c).value)).toEqual(['발화', '발생 횟수', '출처 메모']);
      expect(sheet.rowCount).toBe(3);
    });

    it('미리보기 — 건수가 정확하고 저장·감사가 전혀 없다(AC-DC2-1)', async () => {
      const valid = Array.from({ length: 100 }, (_, i) => `${TOPICS[i % 4]} 문의 사항 ${i}번째 질문입니다`);
      const rows: Array<[string, string?, string?]> = valid.map((s) => [s]);
      for (let i = 0; i < 5; i += 1) rows.push([valid[i]]); // 중복 5쌍
      for (let i = 0; i < 3; i += 1) rows.push(['', '', '']); // 빈 행 3
      for (let i = 0; i < 2; i += 1) rows.push(['가'.repeat(301)]); // 301자 2
      const before = {
        analyses: await h.prisma.utteranceAnalysis.count(),
        clusters: await h.prisma.utteranceCluster.count(),
        utterances: await h.prisma.analyzedUtterance.count(),
        audits: await h.prisma.auditLog.count(),
      };

      const mp = multipartBody({ name: 'preview.csv', content: buildCsvFile(rows) });
      const res = await h.api<Any>('POST', `${BASE(chatbotId)}/preview?minClusterSize=5`, { raw: mp });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        fileKind: 'CSV',
        totalRows: 110,
        validCount: 100,
        mergedCount: 5,
        excluded: { EMPTY: 3, TOO_LONG: 2, TOO_SHORT: 0, NO_CONTENT: 0 },
        canAnalyze: true,
        minValidCount: 10,
      });
      expect(res.body.reasonIfNot).toBeUndefined();

      expect({
        analyses: await h.prisma.utteranceAnalysis.count(),
        clusters: await h.prisma.utteranceCluster.count(),
        utterances: await h.prisma.analyzedUtterance.count(),
        audits: await h.prisma.auditLog.count(),
      }).toEqual(before);
    });

    it('기본 설정 상한(5,000행)을 넘는 5,001행 파일 = 400 IMPORT_TOO_LARGE · 분석 행 0(AC-DC2-2)', async () => {
      const before = await h.prisma.utteranceAnalysis.count();
      const rows: Array<[string, string?, string?]> = Array.from({ length: 5001 }, (_, i) => [`문의 번호 ${i}번 입니다`]);
      const res = await h.startAnalysis(chatbotId, { name: '5001rows.csv', content: buildCsvFile(rows) }, {});
      expect({ status: res.status, code: (res.body as Any).code }).toEqual({ status: 400, code: 'IMPORT_TOO_LARGE' });
      expect(await h.prisma.utteranceAnalysis.count()).toBe(before);
    });

    it('미리보기 — 발화가 부족하면 canAnalyze=false · reasonIfNot=TOO_FEW', async () => {
      const mp = multipartBody({ name: 'few.csv', content: buildCsvFile(rowsOf(['환불 문의 하나', '배송 문의 하나'])) });
      const res = await h.api<Any>('POST', `${BASE(chatbotId)}/preview`, { raw: mp });
      expect(res.body).toMatchObject({ canAnalyze: false, reasonIfNot: 'TOO_FEW', validCount: 2 });
    });
  });

  describe('요청 → 작업 → 결과(AC-DC3)', () => {
    let analysis: Any;
    let utterances: Any[];

    it('202로 접수되고 완료되면 묶음 4개(같은 의도 = 같은 묶음)·대표 키워드·감사 CREATE가 남는다', async () => {
      const startedAt = Date.now();
      const res = await h.startAnalysis(chatbotId, { name: 'four-topics.csv', content: buildCsvFile(rowsOf(allTopicSentences())) }, { targetClusterCount: 4, minClusterSize: 5 });
      expect(res.status).toBe(202);
      expect(res.body.status).toBe('QUEUED');
      analysis = await h.waitForTerminal(chatbotId, res.body.analysisId);
      expect(analysis.status).toBe('SUCCEEDED');
      expect(analysis.progress).toBe(100);
      expect(analysis.stage).toBeNull();
      expect(analysis.clusterCount).toBe(4);
      expect(analysis.unassignedCount).toBe(0);
      expect(analysis.counts).toMatchObject({ totalRows: 32, validCount: 32, mergedCount: 0 });
      expect(analysis.embeddingModelId).toBe(h.embedding.modelId);
      expect(analysis.algorithmVersion).toBe('skmeans-1');
      expect(analysis.analyzerId).toMatch(/^(garu-ko|heuristic)/);
      expect(analysis.staleModel).toBe(false);
      expect(analysis.durationMs).toBeGreaterThanOrEqual(0);
      expect(analysis.durationMs).toBeLessThan(Date.now() - startedAt + 1000);
      expect(new Date(analysis.expiresAt).getTime()).toBeGreaterThan(Date.now() + 89 * 86_400_000);
      expect(analysis.conditions).toMatchObject({ targetClusterCount: 4, minClusterSize: 5, keywordCount: 10, nounsOnly: true, nameSuggest: false });
      expect(analysis.clusters).toHaveLength(4);

      // 묶음 번호는 고유 발화 수 내림차순(모두 8개 → 동점은 발생 합·대표 발화 순) — 1..4 연속
      expect(analysis.clusters.map((c: Any) => c.ordinal)).toEqual([1, 2, 3, 4]);
      for (const c of analysis.clusters as Any[]) {
        expect(c.unassigned).toBe(false);
        expect(c.utteranceCount).toBe(8);
        expect(c.keywords.length).toBeGreaterThanOrEqual(1);
        expect(c.displayName).toBe(c.autoName);
        expect(c.representatives).toHaveLength(3);
        expect(c.suggestedName).toBeNull();
      }

      utterances = await allUtterances(chatbotId, analysis.id);
      expect(utterances).toHaveLength(32);
      // seq는 1부터 연속이고 seq 순으로 나온다
      expect(utterances.map((u) => u.seq)).toEqual(Array.from({ length: 32 }, (_, i) => i + 1));
      // 같은 주제 문장은 같은 묶음에만 있다
      const clusterOfTopic = new Map<string, Set<string>>();
      for (const u of utterances) {
        const topic = TOPICS.find((t) => (u.text as string).includes(t))!;
        clusterOfTopic.set(topic, (clusterOfTopic.get(topic) ?? new Set()).add(u.clusterId));
      }
      for (const set of clusterOfTopic.values()) expect(set.size).toBe(1);
      expect(new Set([...clusterOfTopic.values()].map((s) => [...s][0])).size).toBe(4);

      // 감사: CREATE 1건 — 문장·파일 이름 없이 건수만
      const audits = await h.prisma.auditLog.findMany({ where: { targetType: 'UtteranceAnalysis', targetId: analysis.id } });
      const create = audits.find((a) => a.action === 'CREATE');
      expect(create).toBeDefined();
      expect(create!.summary).toBe('발화 묶음 분석 요청(유효 32건)');
      expect(create!.afterValue).toContain('"validCount":32');
      expect(create!.afterValue).not.toContain('환불');
    });

    it('목록·페이지·상태 필터 — 요청 일시 내림차순, 처리 후 잠금이 풀린다', async () => {
      const list = await h.api<Any>('GET', `${BASE(chatbotId)}?status=SUCCEEDED`);
      expect(list.status).toBe(200);
      const item = list.body.items.find((i: Any) => i.id === analysis.id);
      expect(item).toMatchObject({ status: 'SUCCEEDED', fileName: 'four-topics.csv', validCount: 32, clusterCount: 4, appliedCount: 0 });
      expect(item.requestedByEmail).toContain('integration-test-admin');
      const none = await h.api<Any>('GET', `${BASE(chatbotId)}?status=FAILED`);
      expect(none.body.items.find((i: Any) => i.id === analysis.id)).toBeUndefined();
      expect(await h.prisma.utteranceAnalysis.count({ where: { activeLock: 'ACTIVE' } })).toBe(0);
    });

    it('발화 표 — 묶음·학습 후보·미반영·검색 필터와 페이지(≤100)', async () => {
      const cluster = analysis.clusters[0];
      const byCluster = await h.api<Any>('GET', `${BASE(chatbotId)}/${analysis.id}/utterances?clusterId=${cluster.id}`);
      expect(byCluster.body.total).toBe(8);
      const search = await h.api<Any>('GET', `${BASE(chatbotId)}/${analysis.id}/utterances?q=${encodeURIComponent('환불')}`);
      expect(search.body.total).toBe(8);
      const paged = await h.api<Any>('GET', `${BASE(chatbotId)}/${analysis.id}/utterances?page=2&pageSize=10`);
      expect(paged.body.items).toHaveLength(10);
      expect(paged.body.items[0].seq).toBe(11);
      const bad = await h.api<Any>('GET', `${BASE(chatbotId)}/${analysis.id}/utterances?pageSize=101`);
      expect(bad.status).toBe(400);
      const unapplied = await h.api<Any>('GET', `${BASE(chatbotId)}/${analysis.id}/utterances?unappliedOnly=true&candidateOnly=false`);
      expect(unapplied.status).toBe(200);
      expect(unapplied.body.total).toBe(32);
    });

    it('재현성 — 같은 파일·조건 2회 + 행 순서를 섞은 파일도 발화별 묶음 번호·키워드가 같다(AC-DC3-1)', async () => {
      const summarize = (items: Any[], clusters: Any[]) => ({
        byText: Object.fromEntries(items.map((u) => [u.text, clusters.find((c) => c.id === u.clusterId)!.ordinal])),
        keywords: clusters.map((c) => c.keywords),
        names: clusters.map((c) => c.displayName),
      });
      const first = summarize(utterances, analysis.clusters);

      const second = await runAnalysis(chatbotId, allTopicSentences(), { targetClusterCount: 4, minClusterSize: 5 });
      expect(second.status).toBe('SUCCEEDED');
      expect(summarize(await allUtterances(chatbotId, second.id), second.clusters)).toEqual(first);

      const shuffled = [...allTopicSentences()].sort((a, b) => (a < b ? 1 : -1)).reverse().sort((a, b) => (a.length % 7) - (b.length % 7));
      expect(shuffled).not.toEqual(allTopicSentences());
      const third = await runAnalysis(chatbotId, shuffled, { targetClusterCount: 4, minClusterSize: 5 });
      expect(third.status).toBe('SUCCEEDED');
      expect(summarize(await allUtterances(chatbotId, third.id), third.clusters)).toEqual(first);
    });

    it('목표 묶음 수가 발화 수보다 많으면 줄이고 알린다(TARGET_REDUCED · EX-DC-2/4)', async () => {
      // 발화 12개 · 최소 5 → 가능한 최대 2묶음. 목표 10 → 2로 줄어든다.
      const sentences = [...topicSentences('환불'), ...topicSentences('배송').slice(0, 4)];
      const res = await runAnalysis(chatbotId, sentences, { targetClusterCount: 10, minClusterSize: 5 });
      expect(res.status).toBe('SUCCEEDED');
      expect(res.notices).toContain('TARGET_REDUCED');
    });

    it('작은 묶음은 "미분류"로 모이고 미분류는 마지막 번호다(AC-DC3-2)', async () => {
      // 환불 8 + 배송 8 + 로그인 2(작은 묶음) → 최소 5 미만은 미분류
      const sentences = [...topicSentences('환불'), ...topicSentences('배송'), ...topicSentences('로그인').slice(0, 2)];
      const res = await runAnalysis(chatbotId, sentences, { targetClusterCount: 3, minClusterSize: 5 });
      expect(res.status).toBe('SUCCEEDED');
      const unassigned = (res.clusters as Any[]).find((c) => c.unassigned) as Any;
      expect(unassigned).toBeDefined();
      expect(unassigned.displayName).toBe('미분류');
      expect(unassigned.ordinal).toBe(res.clusters.length);
      expect(res.unassignedCount).toBe(unassigned.utteranceCount);
      expect(res.clusters[res.clusters.length - 1].unassigned).toBe(true);
      for (const c of (res.clusters as Any[]).filter((x) => !x.unassigned)) expect(c.utteranceCount).toBeGreaterThanOrEqual(5);
    });

    it('발생 횟수는 합산되고 묶음 순서에는 고유 발화 수가 먼저 쓰인다', async () => {
      const csv = buildCsvFile([...topicSentences('환불').map((s) => [s, '10'] as [string, string]), ...topicSentences('배송').map((s) => [s] as [string])]);
      const res = await h.startAnalysis(chatbotId, { name: 'counts.csv', content: csv }, { targetClusterCount: 2, minClusterSize: 5 });
      const done = await h.waitForTerminal(chatbotId, res.body.analysisId);
      const refund = (done.clusters as Any[]).find((c) => c.keywords.some((k: Any) => k.term === '환불'));
      expect(refund?.occurrenceSum).toBe(80);
      expect(done.counts.occurrenceTotal).toBe(88);
    });
  });

  describe('마스킹 — 원문·금지어가 어디에도 남지 않는다(AC-DC2-3)', () => {
    it('전화·주민번호·카드·계좌·이메일·금지어 원문이 3테이블·감사·로그·출구·엑셀에 0건', async () => {
      const banned = await h.api('POST', '/banned-words', { json: { word: '나쁜말', matchType: 'CONTAINS', policy: 'WARN' } });
      expect([200, 201]).toContain(banned.status);

      const RAW = { phone: '010-2468-1357', rrn: '900101-1234567', card: '4111-1111-1111-1111', account: '110-234-567890', email: 'tester.kim@example.com', banned: '나쁜말' };
      const rows: Array<[string, (string | number)?, string?]> = [
        ...allTopicSentences().map((s) => [s] as [string]),
        [`환불 문의인데 제 번호는 ${RAW.phone} 입니다`, 1, `담당 ${RAW.phone}`],
        [`배송 문의 주민번호 ${RAW.rrn} 확인 부탁`],
        [`결제 카드 ${RAW.card} 로 했는데 안 돼요`],
        [`환불 받을 계좌는 ${RAW.account} 입니다`],
        [`로그인 오류가 나서 ${RAW.email} 로 답장 주세요`],
        [`${RAW.banned} 배송이 왜 이렇게 늦나요`],
      ];
      const file = await buildXlsxFile(rows);

      // 로그 캡처 — 분석 전 과정에서 stdout·stderr에 나간 모든 출력
      const logged: string[] = [];
      const outSpy = jest.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
        logged.push(String(chunk));
        return true;
      }) as never);
      const errSpy = jest.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
        logged.push(String(chunk));
        return true;
      }) as never);
      let done: Any;
      try {
        const res = await h.startAnalysis(chatbotId, { name: `${RAW.phone}-상담.xlsx`, content: file }, { targetClusterCount: 4, minClusterSize: 5 });
        if (res.status !== 202) throw new Error(`요청 실패: ${res.status} ${JSON.stringify(res.body)}`);
        done = await h.waitForTerminal(chatbotId, res.body.analysisId);
      } finally {
        outSpy.mockRestore();
        errSpy.mockRestore();
      }
      expect(done.status).toBe('SUCCEEDED');
      expect(done.fileName).not.toContain('2468');
      expect(done.counts.maskedRowCount).toBeGreaterThanOrEqual(5);
      expect(done.counts.bannedRowCount).toBe(1);

      // 엑셀 — 응답 생성 후 통째로 읽어 검사한다(다운로드 파일 이름에 업로드 이름 미사용)
      const exported = await h.api('GET', `${BASE(chatbotId)}/${done.id}/export`);
      expect(exported.status).toBe(200);
      expect(String(exported.headers['content-disposition'])).toMatch(/utterance-analysis-\d{8}-[0-9a-f]{8}\.xlsx/);
      expect(String(exported.headers['content-disposition'])).not.toContain('2468');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(exported.raw as never);
      expect(wb.worksheets.map((w) => w.name)).toEqual(['묶음', '발화']);
      const excelText = JSON.stringify(wb.worksheets.map((w) => w.getSheetValues()));

      const dump = JSON.stringify({
        analyses: await h.prisma.utteranceAnalysis.findMany(),
        clusters: await h.prisma.utteranceCluster.findMany(),
        utterances: await h.prisma.analyzedUtterance.findMany(),
        audits: await h.prisma.auditLog.findMany({ where: { targetType: 'UtteranceAnalysis' } }),
        embeddingRequests: h.embedding.received,
        logged,
        excelText,
      });
      for (const secret of ['2468', '1234567', '4111-1111', '234-567890', 'tester.kim', '나쁜말']) {
        expect(dump).not.toContain(secret);
      }
      // 마스킹본 자체는 남는다(문장 보기·반영에 쓰이므로)
      expect(dump).toContain('010-****-1357');
      // 이 요청에서 ml-worker(가짜 임베딩)로 나간 텍스트도 마스킹본뿐이다
      expect(h.embedding.received.some((t) => t.includes('1357'))).toBe(true);
      expect(h.embedding.received.some((t) => t.includes('2468'))).toBe(false);
      const bannedRow = (await allUtterances(chatbotId, done.id)).find((u) => u.hasBannedWord);
      expect(bannedRow?.text).toContain('***');
      // 금지어 포함 발화는 표시만 되고, 분석 자체는 성공한다
      await h.api('DELETE', `/banned-words/${((banned.body as Any).id as string) ?? ''}`);
    });
  });

  describe('챗봇 대조(AC-DC4)', () => {
    let faqBot: string;

    beforeAll(async () => {
      faqBot = await h.createChatbot('대조 시험봇');
      const faq = await h.api('POST', `/chatbots/${faqBot}/faqs`, { json: { category: 'FAQ', question: '환불 신청은 어떻게 하나요', answer: '환불은 마이페이지에서 신청합니다.' } });
      expect(faq.status).toBe(201);
      // FAQ 저장이 예약한 백그라운드 재색인(EmbeddingVector 적재)이 끝날 때까지 기다린다 — 이후 "행 수 불변" 단언이 그 배경 쓰기와 섞이지 않게.
      await waitFor(async () => (await h.prisma.embeddingVector.count({ where: { chatbotId: faqBot, status: 'READY' } })) >= 1, { label: 'FAQ 재색인 완료' });
    });

    it('아는 발화는 답함(FAQ 이름 기록) · 무관한 발화는 답하지 못함·학습 후보 · 로그·통계 불변', async () => {
      const before = {
        logs: await h.prisma.conversationLog.count(),
        unanswered: await h.prisma.unansweredQuestion.count(),
        feedback: await h.prisma.messageFeedback.count(),
        topics: await h.prisma.topic.count(),
        vectors: await h.prisma.embeddingVector.count(),
        textVectors: await h.prisma.embeddingTextVector.count(),
        jobs: await h.prisma.trainingJob.count(),
        faqs: await h.prisma.faqEntry.count(),
        intents: await h.prisma.intent.count(),
      };
      const sentences = ['환불 신청은 어떻게 하나요', ...UNRELATED_SENTENCES, ...topicSentences('환불').slice(1, 4)];
      const done = await runAnalysis(faqBot, sentences, { targetClusterCount: 2, minClusterSize: 2 });
      expect(done.status).toBe('SUCCEEDED');
      expect(done.probe).toMatchObject({ status: 'DONE', targetKind: 'LIVE', versionNo: null });

      const items = await allUtterances(faqBot, done.id);
      const known = items.find((u) => u.text === '환불 신청은 어떻게 하나요')!;
      expect(known.probe).toMatchObject({ answered: true, matchKind: 'FAQ', matchName: '환불 신청은 어떻게 하나요' });
      expect(known.learningCandidate).toBe(false);
      const unknown = items.find((u) => u.text === UNRELATED_SENTENCES[0])!;
      expect(unknown.probe).toMatchObject({ answered: false, matchKind: null });
      expect(unknown.learningCandidate).toBe(true);
      expect(done.candidateCount).toBe(items.filter((u) => u.learningCandidate).length);
      expect(done.candidateCount).toBeGreaterThanOrEqual(UNRELATED_SENTENCES.length);

      const candidatesOnly = await h.api<Any>('GET', `${BASE(faqBot)}/${done.id}/utterances?candidateOnly=true`);
      expect(candidatesOnly.body.total).toBe(done.candidateCount);
      expect(candidatesOnly.body.items.every((u: Any) => u.learningCandidate)).toBe(true);
      for (const c of done.clusters as Any[]) {
        if (c.candidateCount > 0) expect(c.candidateRatio).toBeCloseTo(c.candidateCount / c.utteranceCount, 5);
      }

      // 대화 기록·통계·자산·색인·학습 작업 어느 것도 늘거나 바뀌지 않는다(AC-DC1-4)
      expect({
        logs: await h.prisma.conversationLog.count(),
        unanswered: await h.prisma.unansweredQuestion.count(),
        feedback: await h.prisma.messageFeedback.count(),
        topics: await h.prisma.topic.count(),
        vectors: await h.prisma.embeddingVector.count(),
        textVectors: await h.prisma.embeddingTextVector.count(),
        jobs: await h.prisma.trainingJob.count(),
        faqs: await h.prisma.faqEntry.count(),
        intents: await h.prisma.intent.count(),
      }).toEqual(before);
    });

    it('대조를 끄면 대조 필드가 전부 비고 학습 후보가 0이다(AC-DC4-4)', async () => {
      const done = await runAnalysis(faqBot, [...topicSentences('환불'), ...UNRELATED_SENTENCES], { targetClusterCount: 2, minClusterSize: 3, probe: { enabled: false } });
      expect(done.status).toBe('SUCCEEDED');
      expect(done.probe).toMatchObject({ status: 'OFF', targetKind: null, wouldUseRagCount: 0 });
      expect(done.candidateCount).toBe(0);
      const items = await allUtterances(faqBot, done.id);
      expect(items.every((u) => u.probe === null && u.learningCandidate === false)).toBe(true);
      const row = await h.prisma.analyzedUtterance.findFirst({ where: { analysisId: done.id } });
      expect(row).toMatchObject({ probeAnswered: null, probeMatchKind: null, probeBand: null, probeScore: null, learningCandidate: false });
    });

    it('학습 후보 기준 점수를 1로 올리면 답한 발화도 점수 미달이면 후보가 된다(경계)', async () => {
      // 의미 매칭이 꺼져 있으면 점수가 없어 "답하지 못함"만 본다 — 기준을 올려도 후보 수가 같다.
      const done = await runAnalysis(faqBot, ['환불 신청은 어떻게 하나요', ...UNRELATED_SENTENCES], { targetClusterCount: 2, minClusterSize: 2, probe: { enabled: true, target: 'SERVING', scoreThreshold: 1 } });
      expect(done.probe.threshold).toBe(1);
      const items = await allUtterances(faqBot, done.id);
      expect(items.find((u) => u.text === '환불 신청은 어떻게 하나요')?.learningCandidate).toBe(false);
    });
  });

  describe('취소 · 실패 · 재시작', () => {
    it('처리 중 취소 → CANCELLED · 결과 0 · 잠금 해제 · 다음 요청 가능(AC-DC6 취소 · §8.3)', async () => {
      const bot = await h.createChatbot('취소 시험봇');
      const many = Array.from({ length: 120 }, (_, i) => `${TOPICS[i % 4]} 문의 ${i}번째 사례입니다`);
      h.embedding.setDelayMs(300); // 배치 8개 × 300ms — 취소할 시간을 만든다
      try {
        const res = await h.startAnalysis(bot, { name: 'cancel.csv', content: buildCsvFile(rowsOf(many)) }, {});
        expect(res.status).toBe(202);
        await new Promise((r) => setTimeout(r, 400));
        const cancel = await h.api('POST', `${BASE(bot)}/${res.body.analysisId}/cancel`);
        expect(cancel.status).toBe(204);
        // 취소 직후에는 러너가 아직 돌고 있어 잠금이 유지된다 — 새 분석과 겹쳐 돌지 않는다(L-2)
        const overlap = await h.startAnalysis(bot, { name: 'o.csv', content: buildCsvFile(rowsOf(allTopicSentences())) }, {});
        expect({ status: overlap.status, code: (overlap.body as Any).code }).toEqual({ status: 409, code: 'UTTERANCE_ANALYSIS_BUSY' });
        // 러너가 마무리 중인 취소 행은 삭제할 수 없다(잠금이 사라져 새 분석과 겹치는 것을 막는다)
        const del = await h.api<Any>('DELETE', `${BASE(bot)}/${res.body.analysisId}`);
        expect({ status: del.status, code: del.body.code, message: del.body.message }).toEqual({
          status: 409,
          code: 'INVALID_STATUS_TRANSITION',
          message: '취소를 정리하는 중입니다. 잠시 뒤 다시 삭제해 주세요.',
        });
        expect(await h.prisma.utteranceAnalysis.count({ where: { id: res.body.analysisId } })).toBe(1);
        const done = await h.waitForTerminal(bot, res.body.analysisId);
        expect(done.status).toBe('CANCELLED');
        expect(done.clusters).toEqual([]);
        // 러너가 마저 끝나도 CANCELLED 행을 덮어쓰지 않고 결과를 저장하지 않는다
        await new Promise((r) => setTimeout(r, 1500));
        expect((await h.prisma.utteranceAnalysis.findUnique({ where: { id: res.body.analysisId } }))?.status).toBe('CANCELLED');
        expect(await h.prisma.analyzedUtterance.count({ where: { analysisId: res.body.analysisId } })).toBe(0);
        expect(await h.prisma.utteranceAnalysis.count({ where: { activeLock: 'ACTIVE' } })).toBe(0);
      } finally {
        h.embedding.setDelayMs(0);
      }
      const next = await runAnalysis(bot, allTopicSentences(), { targetClusterCount: 4 });
      expect(next.status).toBe('SUCCEEDED');
    }, 60_000);

    it('완료된 분석 취소 = 409 INVALID_STATUS_TRANSITION', async () => {
      const list = await h.api<Any>('GET', `${BASE(chatbotId)}?status=SUCCEEDED`);
      const res = await h.api<Any>('POST', `${BASE(chatbotId)}/${list.body.items[0].id}/cancel`);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('INVALID_STATUS_TRANSITION');
    });

    it('동시에 2건 요청하면 두 번째는 409 UTTERANCE_ANALYSIS_BUSY(대기열 없음 · EX-DC-13)', async () => {
      const bot = await h.createChatbot('동시 시험봇');
      const many = Array.from({ length: 64 }, (_, i) => `${TOPICS[i % 4]} 질문 ${i}번 입니다`);
      h.embedding.setDelayMs(250);
      try {
        const first = await h.startAnalysis(bot, { name: 'a.csv', content: buildCsvFile(rowsOf(many)) }, {});
        expect(first.status).toBe(202);
        const second = await h.startAnalysis(bot, { name: 'b.csv', content: buildCsvFile(rowsOf(many)) }, {});
        expect(second.status).toBe(409);
        expect(second.body.code).toBe('UTTERANCE_ANALYSIS_BUSY');
        expect(await h.prisma.utteranceAnalysis.count({ where: { chatbotId: bot } })).toBe(1);
        // 같은 서버의 다른 챗봇도 막힌다(서버 전체 1건)
        const other = await h.startAnalysis(chatbotId, { name: 'c.csv', content: buildCsvFile(rowsOf(many)) }, {});
        expect(other.status).toBe(409);
        const cap = await h.api<Any>('GET', `${BASE(bot)}/capability`);
        expect(cap.body.busy).toEqual({ server: true, chatbot: true });
        await h.waitForTerminal(bot, first.body.analysisId);
      } finally {
        h.embedding.setDelayMs(0);
      }
    }, 60_000);

    it('임베딩 서버가 실패하면 FAILED(EMBEDDING_UNAVAILABLE) · 부분 결과 0 · 잠금 해제(EX-DC-1)', async () => {
      const bot = await h.createChatbot('실패 시험봇');
      h.embedding.setFailing(true);
      let failedId = '';
      try {
        const res = await h.startAnalysis(bot, { name: 'f.csv', content: buildCsvFile(rowsOf(allTopicSentences())) }, {});
        expect(res.status).toBe(202);
        failedId = res.body.analysisId;
        const done = await h.waitForTerminal(bot, failedId);
        expect(done.status).toBe('FAILED');
        expect(done.failureReason).toBe('EMBEDDING_UNAVAILABLE');
        expect(done.clusters).toEqual([]);
      } finally {
        h.embedding.setFailing(false);
      }
      expect(await h.prisma.analyzedUtterance.count({ where: { analysisId: failedId } })).toBe(0);
      expect(await h.prisma.utteranceCluster.count({ where: { analysisId: failedId } })).toBe(0);
      expect(await h.prisma.utteranceAnalysis.count({ where: { activeLock: 'ACTIVE' } })).toBe(0);
      const list = await h.api<Any>('GET', `${BASE(bot)}`);
      expect(list.body.items[0]).toMatchObject({ status: 'FAILED', failureReason: 'EMBEDDING_UNAVAILABLE' });
      // 실패 후 재요청은 성공한다
      const again = await runAnalysis(bot, allTopicSentences(), {});
      expect(again.status).toBe('SUCCEEDED');
    }, 60_000);

    it('작업 중 임베딩 모델이 바뀌면 FAILED(EMBEDDING_MODEL_CHANGED) — 그리고 이후 상세는 staleModel을 알린다(EX-DC-12)', async () => {
      const bot = await h.createChatbot('모델 시험봇');
      const okRun = await runAnalysis(bot, allTopicSentences(), {});
      expect(okRun.staleModel).toBe(false);
      h.embedding.setModelId('another-model-v2');
      try {
        const done = await runAnalysis(bot, allTopicSentences(), {});
        expect(done.status).toBe('FAILED');
        expect(done.failureReason).toBe('EMBEDDING_MODEL_CHANGED');
      } finally {
        h.embedding.setModelId(h.embedding.modelId);
      }
    }, 60_000);

    it('서버 재시작 — 취소 뒤 러너가 끝나기 전에 내려간 CANCELLED + 잠금 유지 고아는 상태를 유지한 채 잠금만 풀린다(H-A)', async () => {
      const bot = await h.createChatbot('취소 고아 시험봇');
      const orphan = await h.prisma.utteranceAnalysis.create({
        data: {
          chatbotId: bot,
          status: 'CANCELLED',
          activeLock: 'ACTIVE',
          finishedAt: new Date(),
          fileName: 'cancelled-orphan.csv',
          fileKind: 'CSV',
          conditions: '{}',
          counts: '{}',
          algorithmVersion: 'skmeans-1',
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });
      const blocked = await h.startAnalysis(bot, { name: 'x.csv', content: buildCsvFile(rowsOf(allTopicSentences())) }, {});
      expect({ status: blocked.status, code: (blocked.body as Any).code }).toEqual({ status: 409, code: 'UTTERANCE_ANALYSIS_BUSY' });
      const { UtteranceAnalysisService } = await import('../utterance-analysis/utterance-analysis.service');
      await h.moduleRef.get(UtteranceAnalysisService).onModuleInit();
      const row = await h.prisma.utteranceAnalysis.findUniqueOrThrow({ where: { id: orphan.id } });
      expect(row).toMatchObject({ status: 'CANCELLED', activeLock: null, failureReason: null }); // 상태는 그대로
      const res = await runAnalysis(bot, allTopicSentences(), {});
      expect(res.status).toBe('SUCCEEDED');
    }, 60_000);

    it('서버 재시작 — QUEUED·RUNNING 행은 FAILED(SERVER_RESTART)로 정리되고 잠금이 풀린다(AC-DC7-5)', async () => {
      const bot = await h.createChatbot('재시작 시험봇');
      const running = await h.prisma.utteranceAnalysis.create({
        data: {
          chatbotId: bot,
          status: 'RUNNING',
          activeLock: 'ACTIVE',
          fileName: 'orphan.csv',
          fileKind: 'CSV',
          conditions: '{}',
          counts: '{}',
          algorithmVersion: 'skmeans-1',
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });
      const { UtteranceAnalysisService } = await import('../utterance-analysis/utterance-analysis.service');
      await h.moduleRef.get(UtteranceAnalysisService).onModuleInit();
      const row = await h.prisma.utteranceAnalysis.findUnique({ where: { id: running.id } });
      expect(row).toMatchObject({ status: 'FAILED', failureReason: 'SERVER_RESTART', activeLock: null });
      expect(row?.finishedAt).not.toBeNull();
      const res = await runAnalysis(bot, allTopicSentences(), {});
      expect(res.status).toBe('SUCCEEDED');
    }, 60_000);
  });

  describe('묶음 이름 수정 · 삭제 · 권한 · 스코프', () => {
    let analysisId: string;
    let clusters: Any[];

    beforeAll(async () => {
      const done = await runAnalysis(chatbotId, allTopicSentences(), { targetClusterCount: 4, minClusterSize: 5 });
      analysisId = done.id;
      clusters = done.clusters;
    }, 60_000);

    it('이름 수정 — 표시 이름이 바뀌고 null이면 자동 이름으로 되돌린다 · 감사 0(메모 성격)', async () => {
      const auditsBefore = await h.prisma.auditLog.count();
      const c = clusters[0];
      const renamed = await h.api<Any>('PATCH', `${BASE(chatbotId)}/${analysisId}/clusters/${c.id}`, { json: { customName: '  환불 관련 문의  ' } });
      expect(renamed.status).toBe(200);
      expect(renamed.body).toMatchObject({ customName: '환불 관련 문의', displayName: '환불 관련 문의', autoName: c.autoName });
      const detail = await h.api<Any>('GET', `${BASE(chatbotId)}/${analysisId}`);
      expect(detail.body.clusters.find((x: Any) => x.id === c.id).displayName).toBe('환불 관련 문의');
      const items = await h.api<Any>('GET', `${BASE(chatbotId)}/${analysisId}/utterances?clusterId=${c.id}`);
      expect(items.body.items[0].clusterDisplayName).toBe('환불 관련 문의');
      const reverted = await h.api<Any>('PATCH', `${BASE(chatbotId)}/${analysisId}/clusters/${c.id}`, { json: { customName: null } });
      expect(reverted.body).toMatchObject({ customName: null, displayName: c.autoName });
      expect(await h.prisma.auditLog.count()).toBe(auditsBefore);
    });

    it('이름 수정 — 41자·빈 문자열 400 · 금지어 BLOCK 400 · PII는 마스킹 저장 · 다른 분석의 묶음 404', async () => {
      const c = clusters[1];
      const tooLong = await h.api<Any>('PATCH', `${BASE(chatbotId)}/${analysisId}/clusters/${c.id}`, { json: { customName: '가'.repeat(41) } });
      expect(tooLong.status).toBe(400);
      const empty = await h.api<Any>('PATCH', `${BASE(chatbotId)}/${analysisId}/clusters/${c.id}`, { json: { customName: '   ' } });
      expect(empty.status).toBe(400);
      const extra = await h.api<Any>('PATCH', `${BASE(chatbotId)}/${analysisId}/clusters/${c.id}`, { json: { customName: '정상', extra: 1 } });
      expect(extra.status).toBe(400);

      const bw = await h.api<Any>('POST', '/banned-words', { json: { word: '차단어', matchType: 'CONTAINS', policy: 'BLOCK' } });
      const blocked = await h.api<Any>('PATCH', `${BASE(chatbotId)}/${analysisId}/clusters/${c.id}`, { json: { customName: '이건 차단어 입니다' } });
      expect(blocked.status).toBe(400);
      expect(blocked.body.code).toBe('BANNED_WORD_BLOCKED');
      await h.api('DELETE', `/banned-words/${bw.body.id as string}`);

      const masked = await h.api<Any>('PATCH', `${BASE(chatbotId)}/${analysisId}/clusters/${c.id}`, { json: { customName: '담당자 010-3333-4444' } });
      expect(masked.status).toBe(200);
      expect(masked.body.customName).not.toContain('3333');

      const other = await runAnalysis(await h.createChatbot('다른 봇'), allTopicSentences(), {});
      const cross = await h.api<Any>('PATCH', `${BASE(chatbotId)}/${analysisId}/clusters/${other.clusters[0].id}`, { json: { customName: '정상' } });
      expect(cross.status).toBe(404);
    });

    it('VIEWER — 조회·다운로드 200 · 요청·수정·취소·삭제 403(AC-DC5-6)', async () => {
      const v = h.cookies.viewer;
      expect((await h.api('GET', BASE(chatbotId), { cookie: v })).status).toBe(200);
      expect((await h.api('GET', `${BASE(chatbotId)}/${analysisId}`, { cookie: v })).status).toBe(200);
      expect((await h.api('GET', `${BASE(chatbotId)}/${analysisId}/utterances`, { cookie: v })).status).toBe(200);
      expect((await h.api('GET', `${BASE(chatbotId)}/${analysisId}/export`, { cookie: v })).status).toBe(200);
      expect((await h.api('GET', `${BASE(chatbotId)}/template?format=csv`, { cookie: v })).status).toBe(200);
      const file = { name: 'v.csv', content: buildCsvFile(rowsOf(allTopicSentences())) };
      expect((await h.startAnalysis(chatbotId, file, {}, { cookie: v })).status).toBe(403);
      expect((await h.api('POST', `${BASE(chatbotId)}/preview`, { cookie: v, raw: multipartBody(file) })).status).toBe(403);
      expect((await h.api('PATCH', `${BASE(chatbotId)}/${analysisId}/clusters/${clusters[0].id}`, { cookie: v, json: { customName: '가나' } })).status).toBe(403);
      expect((await h.api('POST', `${BASE(chatbotId)}/${analysisId}/cancel`, { cookie: v })).status).toBe(403);
      expect((await h.api('DELETE', `${BASE(chatbotId)}/${analysisId}`, { cookie: v })).status).toBe(403);
      const target = { utteranceIds: [clusters[0].id], target: { kind: 'NEW', intentName: '테스트' } };
      expect((await h.api('POST', `${BASE(chatbotId)}/${analysisId}/apply/preview`, { cookie: v, json: target })).status).toBe(403);
      expect((await h.api('POST', `${BASE(chatbotId)}/${analysisId}/apply`, { cookie: v, json: target })).status).toBe(403);
      // EDITOR는 요청할 수 있다(dialogue:write)
      const editor = await h.api('POST', `${BASE(chatbotId)}/preview`, { cookie: h.cookies.editor, raw: multipartBody(file) });
      expect(editor.status).toBe(200);
    });

    it('교차 챗봇·없는 분석은 404 — 존재를 알리지 않는다', async () => {
      const otherBot = await h.createChatbot('교차 봇');
      for (const [method, path] of [
        ['GET', `${BASE(otherBot)}/${analysisId}`],
        ['GET', `${BASE(otherBot)}/${analysisId}/utterances`],
        ['GET', `${BASE(otherBot)}/${analysisId}/export`],
        ['POST', `${BASE(otherBot)}/${analysisId}/cancel`],
        ['DELETE', `${BASE(otherBot)}/${analysisId}`],
        ['GET', `${BASE(chatbotId)}/00000000-0000-4000-8000-000000000000`],
      ] as const) {
        const res = await h.api<Any>(method, path);
        expect({ path, status: res.status, code: res.body.code }).toEqual({ path, status: 404, code: 'NOT_FOUND' });
      }
      expect((await h.api('GET', `${BASE('00000000-0000-4000-8000-000000000000')}/capability`)).status).toBe(404);
    });

    it('수동 삭제 — 종결 상태만 · 처리 중 409 · 삭제 후 3테이블 0행 · DELETE 감사', async () => {
      const bot = await h.createChatbot('삭제 시험봇');
      const done = await runAnalysis(bot, allTopicSentences(), {});
      const before = await h.prisma.analyzedUtterance.count({ where: { analysisId: done.id } });
      expect(before).toBe(32);
      const res = await h.api('DELETE', `${BASE(bot)}/${done.id}`);
      expect(res.status).toBe(204);
      expect(await h.prisma.utteranceAnalysis.count({ where: { id: done.id } })).toBe(0);
      expect(await h.prisma.utteranceCluster.count({ where: { analysisId: done.id } })).toBe(0);
      expect(await h.prisma.analyzedUtterance.count({ where: { analysisId: done.id } })).toBe(0);
      const audit = await h.prisma.auditLog.findFirst({ where: { action: 'DELETE', targetType: 'UtteranceAnalysis', targetId: done.id } });
      expect(audit?.afterValue).toContain('"utterances":32');
      expect((await h.api('GET', `${BASE(bot)}/${done.id}`)).status).toBe(404);

      // 처리 중 삭제는 409
      h.embedding.setDelayMs(400);
      try {
        const running = await h.startAnalysis(bot, { name: 'r.csv', content: buildCsvFile(rowsOf(allTopicSentences())) }, {});
        const del = await h.api<Any>('DELETE', `${BASE(bot)}/${running.body.analysisId}`);
        expect(del.status).toBe(409);
        expect(del.body.code).toBe('INVALID_STATUS_TRANSITION');
        await h.waitForTerminal(bot, running.body.analysisId);
      } finally {
        h.embedding.setDelayMs(0);
      }
    }, 60_000);

    it('완료되지 않은 분석은 엑셀로 받을 수 없다(409) · 다운로드는 EXPORT 감사 1건', async () => {
      const bot = await h.createChatbot('내보내기 시험봇');
      h.embedding.setFailing(true);
      let failed: Any;
      try {
        const res = await h.startAnalysis(bot, { name: 'x.csv', content: buildCsvFile(rowsOf(allTopicSentences())) }, {});
        failed = await h.waitForTerminal(bot, res.body.analysisId);
      } finally {
        h.embedding.setFailing(false);
      }
      const notReady = await h.api<Any>('GET', `${BASE(bot)}/${failed.id}/export`);
      expect(notReady.status).toBe(409);
      expect(notReady.body.code).toBe('INVALID_STATUS_TRANSITION');

      const ok = await runAnalysis(bot, allTopicSentences(), {});
      const exports = () => h.prisma.auditLog.count({ where: { action: 'EXPORT', targetType: 'UtteranceAnalysis', targetId: ok.id } });
      expect(await exports()).toBe(0);
      const file = await h.api(`GET`, `${BASE(bot)}/${ok.id}/export`);
      expect(file.status).toBe(200);
      expect(await exports()).toBe(1);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(file.raw as never);
      expect(wb.getWorksheet('묶음')!.rowCount).toBe(1 + 4);
      expect(wb.getWorksheet('발화')!.rowCount).toBe(1 + 32);
      const audit = await h.prisma.auditLog.findFirst({ where: { action: 'EXPORT', targetType: 'UtteranceAnalysis', targetId: ok.id } });
      expect(audit?.afterValue).toContain('"rows":36');
    }, 60_000);
  });

  describe('대량 — TC-21(합성 1,000행) · 자산 6종 불변(AC-DC3-5 · AC-DC5-2)', () => {
    it('1,000행(템플릿 10종 × 100 변형 · 빈 행·중복·초과 길이 포함)을 끝까지 처리한다', async () => {
      const bot = await h.createChatbot('대량 시험봇');
      const templates = ['환불', '배송', '로그인', '결제', '회원 가입', '비밀번호 변경', '쿠폰 사용', '포인트 적립', '영수증 발급', '주문 취소'];
      const rows: Array<[string, string?, string?]> = [];
      for (const t of templates) for (let i = 0; i < 100; i += 1) rows.push([`${t} 관련 문의 ${i}번 사례 확인 부탁드립니다`]);
      rows.splice(10, 0, ['', '', ''], ['', '', ''], ['', '', '']);
      rows.push([rows[0][0]]); // 중복
      rows.push(['가'.repeat(310)]);
      const before = {
        intents: await h.prisma.intent.count(),
        keywords: await h.prisma.keyword.count(),
        faqs: await h.prisma.faqEntry.count(),
        nodes: await h.prisma.dialogNode.count(),
        contexts: await h.prisma.contextVariable.count(),
        homonyms: await h.prisma.homonymDictionary.count(),
        topics: await h.prisma.topic.count(),
      };
      const res = await h.startAnalysis(bot, { name: 'tc21-1000.csv', content: buildCsvFile(rows) }, { targetClusterCount: 10, minClusterSize: 5 });
      expect(res.status).toBe(202);
      const done = await h.waitForTerminal(bot, res.body.analysisId, 120_000);
      expect(done.status).toBe('SUCCEEDED');
      expect(done.counts.excluded.EMPTY).toBe(3);
      expect(done.counts.excluded.TOO_LONG).toBe(1);
      expect(done.counts.mergedCount).toBe(1);
      expect(done.counts.validCount).toBe(1000);
      const real = (done.clusters as Any[]).filter((c) => !c.unassigned);
      expect(real.length).toBeGreaterThanOrEqual(2);
      for (const c of real) expect(c.keywords.length).toBeGreaterThanOrEqual(1);
      expect((done.clusters as Any[]).reduce((s, c) => s + c.utteranceCount, 0)).toBe(1000);

      // 조회·다운로드만으로는 자산 행이 바뀌지 않는다
      await h.api('GET', `${BASE(bot)}/${done.id}/export`);
      await allUtterances(bot, done.id);
      expect({
        intents: await h.prisma.intent.count(),
        keywords: await h.prisma.keyword.count(),
        faqs: await h.prisma.faqEntry.count(),
        nodes: await h.prisma.dialogNode.count(),
        contexts: await h.prisma.contextVariable.count(),
        homonyms: await h.prisma.homonymDictionary.count(),
        topics: await h.prisma.topic.count(),
      }).toEqual(before);
    }, 180_000);
  });

  describe('의미 매칭(임베딩) 대조 · 추천 의도 · RAG 표시(FR-DC5-5/6)', () => {
    it('점수·구간·추천 의도가 나오고 "2단계로 넘어갈 발화"는 표시만 한다(외부 호출 0)', async () => {
      const semBot = await h.createChatbot('의미 대조봇');
      expect((await h.api('POST', `/chatbots/${semBot}/faqs`, { json: { category: 'FAQ', question: '배송 조회는 어떻게 하나요', answer: '주문 내역에서 확인합니다.' } })).status).toBe(201);
      const intent = await h.api<Any>('POST', `/chatbots/${semBot}/intents`, { json: { name: '환불 문의', examples: ['환불 신청은 어떻게 하나요', '환불 방법을 알려주세요'] } });
      expect(intent.status).toBe(201);
      const setting = await h.api('PUT', `/chatbots/${semBot}/answer-settings`, { json: { semanticEnabled: true, ragEnabled: true, ragCompany: 'acme' } });
      expect(setting.status).toBe(200);
      // 색인(EmbeddingVector)이 준비될 때까지 — FAQ 질문 1 + 의도 이름 1 + 예문 2
      await waitFor(
        async () => {
          const ready = await h.prisma.embeddingVector.count({ where: { chatbotId: semBot, status: 'READY' } });
          const pending = await h.prisma.embeddingVector.count({ where: { chatbotId: semBot, status: { not: 'READY' } } });
          return ready >= 4 && pending === 0;
        },
        { label: '색인 완료', timeoutMs: 20_000 },
      );

      const ragSpy = jest.spyOn(RagHttpClient.prototype, 'query');
      let done: Any;
      try {
        done = await runAnalysis(semBot, [...topicSentences('배송'), ...topicSentences('환불'), ...UNRELATED_SENTENCES], { targetClusterCount: 3, minClusterSize: 3 });
        expect(ragSpy).not.toHaveBeenCalled();
      } finally {
        ragSpy.mockRestore();
      }
      expect(done.status).toBe('SUCCEEDED');
      expect(done.probe.status).toBe('DONE');
      const items = await allUtterances(semBot, done.id);

      const shipping = items.filter((u) => (u.text as string).startsWith('배송'));
      expect(shipping.length).toBe(8);
      for (const u of shipping) {
        expect(u.probe.band).toBe('CONFIRMED');
        expect(u.probe.score).toBeGreaterThan(0.8);
        expect(u.probe).toMatchObject({ answered: true, matchKind: 'FAQ', matchName: '배송 조회는 어떻게 하나요', wouldUseRag: false });
        expect(u.learningCandidate).toBe(false);
      }

      const refund = items.filter((u) => (u.text as string).startsWith('환불'));
      for (const u of refund) {
        expect(u.suggestedIntents[0]).toMatchObject({ name: '환불 문의', source: 'SEMANTIC' });
        expect(u.suggestedIntents[0].score).toBeGreaterThanOrEqual(0.6);
        expect(u.suggestedIntents.length).toBeLessThanOrEqual(3);
      }

      const unrelated = items.filter((u) => UNRELATED_SENTENCES.includes(u.text));
      expect(unrelated).toHaveLength(UNRELATED_SENTENCES.length);
      for (const u of unrelated) {
        expect(u.probe).toMatchObject({ answered: false, band: 'FAILED', wouldUseRag: true });
        expect(u.learningCandidate).toBe(true);
      }
      expect(done.probe.wouldUseRagCount).toBeGreaterThanOrEqual(UNRELATED_SENTENCES.length);
    }, 90_000);
  });

  describe('챗봇 영구삭제 · 열람 감사(모드 OFF)', () => {
    it('영구삭제하면 그 챗봇의 분석 3테이블이 함께 사라진다(AC-DC7-3)', async () => {
      const delBot = await h.createChatbot('군집 영구삭제봇');
      const done = await runAnalysis(delBot, allTopicSentences(), {});
      expect(await h.prisma.analyzedUtterance.count({ where: { analysisId: done.id } })).toBe(32);
      expect((await h.api('DELETE', `/chatbots/${delBot}`)).status).toBe(204); // 보관
      const purge = await h.api<Any>('POST', `/chatbots/${delBot}/permanent-delete`, { json: { confirmName: '군집 영구삭제봇' } });
      expect(purge.status).toBe(204);
      expect(await h.prisma.utteranceAnalysis.count({ where: { chatbotId: delBot } })).toBe(0);
      expect(await h.prisma.utteranceCluster.count({ where: { analysisId: done.id } })).toBe(0);
      expect(await h.prisma.analyzedUtterance.count({ where: { analysisId: done.id } })).toBe(0);
    }, 60_000);

    it('거버넌스 모드가 꺼져 있으면 발화 목록 조회에 VIEW 감사가 없다', async () => {
      const done = await runAnalysis(chatbotId, allTopicSentences(), {});
      await allUtterances(chatbotId, done.id);
      await new Promise((r) => setTimeout(r, 300));
      expect(await h.prisma.auditLog.count({ where: { action: 'VIEW', targetType: 'UtteranceAnalysis' } })).toBe(0);
    });
  });

  describe('학습 반영 서비스는 분석 완료·조회에서 호출되지 않는다', () => {
    it('applyLearning 호출 0회(반영 요청이 없으면)', async () => {
      const spy = jest.spyOn(LearningApplyService.prototype, 'applyLearning');
      try {
        const done = await runAnalysis(chatbotId, allTopicSentences(), {});
        await allUtterances(chatbotId, done.id);
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });
  });
});
