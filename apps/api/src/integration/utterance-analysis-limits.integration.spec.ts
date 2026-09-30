import { buildCsvFile, buildXlsxFile, csvOf, multipartBody, startHarness, topicSentences } from './helpers/utterance-analysis.harness';
import type { Harness } from './helpers/utterance-analysis.harness';

/**
 * 발화 묶음 분석(No.21) 통합 시험 — 입력 한도·형식·조건 검증·보관 상한(설계서 §7.1 · §7.4 · AC-DC2-2/4 · EX-DC-2/18/19).
 * 한도를 낮춘 환경(`UTTERANCE_ANALYSIS_MAX_ROWS=100` · `MAX_STORED_PER_CHATBOT=2`)에서 사전 검사의 거절 코드와
 * "거절되면 분석 행이 하나도 생기지 않는다"를 확인한다.
 */

type Any = Record<string, any>;
const BASE = (chatbotId: string) => `/chatbots/${chatbotId}/utterance-analyses`;

describe('발화 묶음 분석(No.21) 통합 시험 — 한도 · 형식 · 조건 · 보관 상한', () => {
  let h: Harness;
  let bot: string;

  beforeAll(async () => {
    h = await startHarness({ env: { UTTERANCE_ANALYSIS_MAX_ROWS: '100', UTTERANCE_ANALYSIS_MAX_STORED_PER_CHATBOT: '2' } });
    bot = await h.createChatbot('한도 시험봇');
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  }, 30_000);

  const rows = (n: number) => Array.from({ length: n }, (_, i) => [`문의 사항 번호 ${i}번 내용입니다`] as [string]);
  const start = (name: string, content: Buffer, conditions?: Any | string) => h.startAnalysis(bot, { name, content }, conditions);
  const analysisRows = () => h.prisma.utteranceAnalysis.count();

  describe('파일 한도 · 형식(AC-DC2-2 · AC-DC2-4)', () => {
    it('행 수 상한(설정 100) 초과 = 400 IMPORT_TOO_LARGE · 분석 행 0(미리보기도 같다)', async () => {
      const before = await analysisRows();
      const res = await start('big.csv', buildCsvFile(rows(101)));
      expect({ status: res.status, code: (res.body as Any).code }).toEqual({ status: 400, code: 'IMPORT_TOO_LARGE' });
      expect(await analysisRows()).toBe(before);
      const preview = await h.api<Any>('POST', `${BASE(bot)}/preview`, { raw: multipartBody({ name: 'big.csv', content: buildCsvFile(rows(101)) }) });
      expect({ status: preview.status, code: preview.body.code }).toEqual({ status: 400, code: 'IMPORT_TOO_LARGE' });
    });

    it('정확히 상한(100행)은 받는다', async () => {
      const preview = await h.api<Any>('POST', `${BASE(bot)}/preview`, { raw: multipartBody({ name: 'edge.csv', content: buildCsvFile(rows(100)) }) });
      expect(preview.status).toBe(200);
      expect(preview.body.totalRows).toBe(100);
    });

    it('5MB 초과 파일 = 400 IMPORT_TOO_LARGE(서버 오류가 아니다)', async () => {
      const res = await start('huge.csv', Buffer.alloc(5 * 1024 * 1024 + 2048, 'a'));
      expect({ status: res.status, code: (res.body as Any).code }).toEqual({ status: 400, code: 'IMPORT_TOO_LARGE' });
      expect(await h.prisma.utteranceAnalysis.count({ where: { chatbotId: bot } })).toBe(0);
    });

    it('확장자만 .xlsx인 텍스트 파일 = 400 IMPORT_FILE_INVALID(내용 기반 판별)', async () => {
      const res = await start('fake.xlsx', buildCsvFile(rows(20)));
      expect({ status: res.status, code: (res.body as Any).code }).toEqual({ status: 400, code: 'IMPORT_FILE_INVALID' });
      expect((res.body as Any).message).toContain('엑셀(.xlsx) 또는 CSV');
    });

    it('ZIP(엑셀)을 .csv로 위장하거나 NUL 바이트가 있거나 확장자가 다르거나 인코딩이 깨져도 거부한다', async () => {
      const xlsx = await buildXlsxFile(rows(20));
      for (const [name, content] of [
        ['disguised.csv', xlsx],
        ['nul.csv', Buffer.concat([Buffer.from('발화\n'), Buffer.from([0, 0, 0]), Buffer.from('내용\n')])],
        ['notes.txt', buildCsvFile(rows(20))],
        ['euckr.csv', Buffer.from([0xb9, 0xdf, 0xc8, 0xad, 0x0a, 0xb9, 0xdf, 0xc8, 0xad, 0xb9, 0xdf, 0xc8, 0xad])],
      ] as Array<[string, Buffer]>) {
        const res = await start(name, content);
        expect({ name, status: res.status, code: (res.body as Any).code }).toEqual({ name, status: 400, code: 'IMPORT_FILE_INVALID' });
      }
    });

    it('CP949(EUC-KR)로 저장된 CSV는 "UTF-8로 저장한 뒤 다시 올려 주세요" 안내로 거절한다(M-2)', async () => {
      // EUC-KR 바이트("발화", "환불 문의", "배송 문의") — UTF-8로는 해석할 수 없다
      const euckr = Buffer.from([0xb9, 0xdf, 0xc8, 0xad, 0x0a, 0xc8, 0xaf, 0xba, 0xd2, 0x20, 0xb9, 0xae, 0xc0, 0xc7, 0x0a, 0xb9, 0xe8, 0xbc, 0xdb, 0x20, 0xb9, 0xae, 0xc0, 0xc7, 0x0a]);
      for (const path of [BASE(bot), `${BASE(bot)}/preview`]) {
        const res = await h.api<Any>('POST', path, { raw: multipartBody({ name: 'cp949.csv', content: euckr }, path === BASE(bot) ? { conditions: '{}' } : {}) });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('IMPORT_FILE_INVALID');
        expect(res.body.message).toBe('UTF-8로 저장한 뒤 다시 올려 주세요.');
        expect(res.body.details).toEqual([{ field: 'encoding', message: 'UTF-8로 저장한 뒤 다시 올려 주세요.' }]);
      }
      // 확장자가 다른 이진 파일은 여전히 일반 안내다
      const other = await start('notes.txt', euckr);
      expect((other.body as Any).message).toContain('엑셀(.xlsx) 또는 CSV');
      expect((other.body as Any).details).toBeUndefined();
    });

    it('진짜 xlsx도 받는다 — exceljs가 만든 파일(workbook.xml이 뒤)과 양식 파일을 그대로 올려도 읽힌다', async () => {
      const file = await buildXlsxFile(rows(20));
      const preview = await h.api<Any>('POST', `${BASE(bot)}/preview`, { raw: multipartBody({ name: 'real.xlsx', content: file }) });
      expect(preview.status).toBe(200);
      expect(preview.body).toMatchObject({ fileKind: 'XLSX', totalRows: 20, validCount: 20 });
      // 받은 양식을 손대지 않고 올리면 예시 2행이 그대로 읽힌다
      const template = await h.api('GET', `${BASE(bot)}/template?format=xlsx`);
      const again = await h.api<Any>('POST', `${BASE(bot)}/preview`, { raw: multipartBody({ name: 'template.xlsx', content: template.raw }) });
      expect(again.status).toBe(200);
      expect(again.body.totalRows).toBe(2);
    });

    it('머리글이 다르면 400 + details[header] · 파일이 없으면 400 · 빈 파일도 400(EX-DC-19)', async () => {
      const wrong = await start('wrong.csv', buildCsvFile(rows(20), ['질문', '횟수', '메모']));
      expect(wrong.status).toBe(400);
      expect((wrong.body as Any).code).toBe('IMPORT_FILE_INVALID');
      expect((wrong.body as Any).details).toEqual([{ field: 'header', message: '1열 머리글은 "발화"여야 합니다 — 양식을 받아 사용하세요' }]);
      // 영문 별칭은 허용한다
      const alias = await h.api<Any>('POST', `${BASE(bot)}/preview`, { raw: multipartBody({ name: 'alias.csv', content: buildCsvFile(rows(20), ['utterance', 'count', 'memo']) }) });
      expect(alias.status).toBe(200);

      const noFile = await h.startAnalysis(bot, null, {});
      expect({ status: noFile.status, code: (noFile.body as Any).code }).toEqual({ status: 400, code: 'IMPORT_FILE_INVALID' });
      const empty = await start('empty.csv', Buffer.alloc(0));
      expect({ status: empty.status, code: (empty.body as Any).code }).toEqual({ status: 400, code: 'IMPORT_FILE_INVALID' });
    });

    it('머리글만 있는 파일 = 400 UTTERANCE_ANALYSIS_TOO_FEW', async () => {
      const res = await start('header-only.csv', buildCsvFile([]));
      expect({ status: res.status, code: (res.body as Any).code }).toEqual({ status: 400, code: 'UTTERANCE_ANALYSIS_TOO_FEW' });
    });
  });

  describe('조건 검증(§11 — zod strict)', () => {
    const good = () => buildCsvFile(rows(30));

    it.each([
      ['목표 묶음 수 1', { targetClusterCount: 1 }, 'targetClusterCount'],
      ['목표 묶음 수 51', { targetClusterCount: 51 }, 'targetClusterCount'],
      ['최소 발화 수 1', { minClusterSize: 1 }, 'minClusterSize'],
      ['최소 발화 수 101', { minClusterSize: 101 }, 'minClusterSize'],
      ['키워드 수 0', { keywordCount: 0 }, 'keywordCount'],
      ['키워드 수 21', { keywordCount: 21 }, 'keywordCount'],
      ['소수 묶음 수', { targetClusterCount: 2.5 }, 'targetClusterCount'],
      ['기준 점수 1.5', { probe: { enabled: true, target: 'SERVING', scoreThreshold: 1.5 } }, 'probe.scoreThreshold'],
      ['대조 대상 오타', { probe: { target: 'LIVE' } }, 'probe.target'],
      ['알 수 없는 키', { foo: 1 }, ''],
    ])('%s → 400 VALIDATION_FAILED', async (_name, conditions, field) => {
      const before = await analysisRows();
      const res = await start('c.csv', good(), conditions as Any);
      expect(res.status).toBe(400);
      expect((res.body as Any).code).toBe('VALIDATION_FAILED');
      if (field) expect(((res.body as Any).details as Any[]).some((d) => d.field === field)).toBe(true);
      expect(await analysisRows()).toBe(before);
    });

    it('JSON이 아닌 조건 문자열 = 400 · 이름 제안을 서버가 꺼 둔 상태에서 요청하면 400(details.field = nameSuggest)', async () => {
      const bad = await start('c.csv', good(), '{not json');
      expect({ status: bad.status, code: (bad.body as Any).code }).toEqual({ status: 400, code: 'VALIDATION_FAILED' });
      const suggest = await start('c.csv', good(), { nameSuggest: true });
      expect(suggest.status).toBe(400);
      expect(((suggest.body as Any).details as Any[]).map((d) => d.field)).toContain('nameSuggest');
      // 기능 꺼짐 상태의 capability도 같은 판단이다
      expect((await h.api<Any>('GET', `${BASE(bot)}/capability`)).body.nameSuggestAvailable).toBe(false);
    });

    it('발화가 최소 발화 수의 2배 미만이면 400 UTTERANCE_ANALYSIS_TOO_FEW(EX-DC-2) — 경계 값', async () => {
      const nine = await start('nine.csv', buildCsvFile(rows(9)), { minClusterSize: 5 });
      expect({ status: nine.status, code: (nine.body as Any).code }).toEqual({ status: 400, code: 'UTTERANCE_ANALYSIS_TOO_FEW' });
      expect(await h.prisma.utteranceAnalysis.count({ where: { chatbotId: bot } })).toBe(0);
      const ten = await start('ten.csv', csvOf(topicSentences('환불').concat(topicSentences('배송')).slice(0, 10)), { minClusterSize: 5 });
      expect(ten.status).toBe(202);
      await h.waitForTerminal(bot, (ten.body as Any).analysisId);
      await h.api('DELETE', `${BASE(bot)}/${(ten.body as Any).analysisId}`);
    });
  });

  describe('보관 상한(EX-DC-18 — 자동 삭제 아님)', () => {
    it('챗봇당 2개가 차면 새 요청은 409 UTTERANCE_ANALYSIS_STORE_FULL · 삭제하면 다시 요청할 수 있다', async () => {
      const store = await h.createChatbot('보관 상한 시험봇');
      const file = () => csvOf(topicSentences('환불').concat(topicSentences('배송')));
      const ids: string[] = [];
      for (let i = 0; i < 2; i += 1) {
        const res = await h.startAnalysis(store, { name: `s${i}.csv`, content: file() }, { minClusterSize: 5 });
        expect(res.status).toBe(202);
        ids.push(res.body.analysisId);
        await h.waitForTerminal(store, res.body.analysisId);
      }
      const cap = await h.api<Any>('GET', `${BASE(store)}/capability`);
      expect(cap.body.stored).toEqual({ count: 2, max: 2 });
      const full = await h.startAnalysis(store, { name: 's3.csv', content: file() }, { minClusterSize: 5 });
      expect({ status: full.status, code: (full.body as Any).code }).toEqual({ status: 409, code: 'UTTERANCE_ANALYSIS_STORE_FULL' });
      expect(await h.prisma.utteranceAnalysis.count({ where: { chatbotId: store } })).toBe(2); // 오래된 것이 자동으로 지워지지 않았다

      expect((await h.api('DELETE', `${BASE(store)}/${ids[0]}`)).status).toBe(204);
      const again = await h.startAnalysis(store, { name: 's4.csv', content: file() }, { minClusterSize: 5 });
      expect(again.status).toBe(202);
      await h.waitForTerminal(store, again.body.analysisId);
      // 다른 챗봇은 영향 없다(상한은 챗봇별)
      const other = await h.createChatbot('상한 다른 봇');
      const ok = await h.startAnalysis(other, { name: 'o.csv', content: file() }, { minClusterSize: 5 });
      expect(ok.status).toBe(202);
      await h.waitForTerminal(other, ok.body.analysisId);
    }, 60_000);
  });
});
