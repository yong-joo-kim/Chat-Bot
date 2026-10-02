// [DT-2] 풀 투어 ⑦ 발화 묶음 분석(90 · 실시간 분석 켬이면 150) — 설계 §9.5.
//  - S7-01: 실시간 분석을 끄면 DT-1 단계 그대로(보이는 시연은 검사까지 · 무인은 실제 분석) / 켜면 업로드·검사까지만 하는 핵심 변형(입력)
//  - S7-07(C): "분석 시작"을 눌러 지금 분석하고 완료까지 대기(상한 120초 · 단계 상한 180초) → 새 분석 ID를 S7-02가 보인다 · 상한 초과면 사전 분석으로 대체
//  - S7-06: 상세 화면에서 "엑셀로 받기" → 브라우저 다운로드 저장 · 파일 형식 + 제품 감사 로그의 내보내기 행(묶음 + 발화 수)으로 검증(새 의존성 0)
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CONSOLE_TEXT } from '../../selectors/console';
import type { SegmentDef, StepContext, StepDef } from '../../scenario/types';
import { s7Segment } from '../s7';
import { derive, pick } from './derive';
import { FALLBACK_TEXTS, s702Narration, s707Disclosure } from './text';

const A_ = CONSOLE_TEXT.analysis;
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const listPath = (ids: { A: { id: string } }) => `/chatbots/${ids.A.id}/stats/utterance-analyses`;

async function analysisDetail(ctx: StepContext, id: string): Promise<Json> {
  return (await ctx.api.admin1.get(`/chatbots/${ctx.ids.A.id}/utterance-analyses/${id}`)).body as Json;
}

/** 이번 장면이 보는 분석 ID — 방금 실제로 분석한 것이 있으면 그것, 아니면 준비 단계의 사전 분석. */
function currentAnalysisId(ctx: StepContext): string {
  const id = (ctx.scratch.get('s7-analysis-id') as string | undefined) ?? ctx.ids.A.preAnalysisId;
  if (!id) throw new Error('볼 수 있는 분석이 없습니다(사전 분석 실패)');
  return id;
}

const base = s7Segment.steps;
const s701Plain = derive(pick(base, 'S7-01'), { when: (p) => !p.liveClustering, inactive: 'variant' });
// 실시간 분석의 입력 — 업로드·검사까지(분석은 S7-07). 모드와 무관하게 같은 동작이라 headless 분기가 없다.
const s701Live = derive(pick(base, 'S7-01'), { core: true, skippable: false, when: (p) => p.liveClustering, inactive: 'variant', headless: 'same' });

const s707: StepDef = {
  id: 'S7-07',
  title: '실시간 분석',
  narration: ['사내 CPU로 지금 문장을 묶는 중입니다'],
  dynamicDisclosure: async (ctx) => {
    const id = ctx.ids.A.preAnalysisId;
    if (!id) return undefined;
    const d = await analysisDetail(ctx, id).catch(() => null);
    const sec = d ? Math.round(Number(d.durationMs ?? 0) / 1000) : 0;
    return s707Disclosure(sec > 0 ? sec : null);
  },
  badges: ['CPU_ONLY'],
  facts: ['GPU_USED'],
  budgetSec: 60,
  driver: 'UI',
  account: 'admin1',
  layout: 'console',
  // 업로드·검사 화면(S7-01)에 그대로 머문다 — 이동하지 않는다
  when: (p) => p.liveClustering,
  inactive: 'option',
  // 실시간 분석을 켜지 않은 것은 "생략한 장면"이 아니다(분석 장면 자체는 있다) — 고객 줄에 올리지 않는다
  inactiveReason: () => ({ kind: 'NOT_REQUESTED', sceneName: '실시간 분석', customer: '', internal: '실시간 분석 옵션 미지정 (--live-clustering)', hidden: true }),
  core: true,
  skippable: false,
  capture: 'none',
  waitMaxMs: 180_000,
  async run(ctx) {
    const before = ((await ctx.api.admin1.get(`/chatbots/${ctx.ids.A.id}/utterance-analyses`)).body as { items: Array<{ id: string }> }).items.map((i) => i.id);
    await ctx.console.getByRole('button', { name: A_.submit, exact: true }).click();
    const created = await ctx.waitFor(
      async () => {
        const list = ((await ctx.api.admin1.get(`/chatbots/${ctx.ids.A.id}/utterance-analyses`)).body as { items: Array<{ id: string }> }).items;
        return list.find((i) => !before.includes(i.id))?.id ?? false;
      },
      { timeoutMs: 20_000, intervalMs: 500, label: '새 분석 생성' },
    );
    await ctx.waitFor(
      async () => {
        const d = await analysisDetail(ctx, created);
        if (d.status === 'FAILED') throw new Error(`분석 실패: ${d.failureReason ?? ''}`);
        return d.status === 'SUCCEEDED' ? d : false;
      },
      { timeoutMs: 120_000, intervalMs: 1000, label: '발화 묶음 분석 완료', isFatal: (e) => e instanceof Error && /분석 실패/.test(e.message) },
    );
    ctx.scratch.set('s7-analysis-id', created);
  },
  async verify(ctx) {
    const id = String(ctx.scratch.get('s7-analysis-id') ?? '');
    const d = await analysisDetail(ctx, id);
    const n = ((d.clusters ?? []) as Json[]).filter((c) => !c.unassigned).length;
    return { ok: d.status === 'SUCCEEDED' && n >= 3, expected: '완료 · 묶음 3개 이상', actual: `${d.status} · 묶음 ${n}개 · ${Math.round(Number(d.durationMs ?? 0) / 1000)}초` };
  },
  fallback: {
    // 상한을 넘으면 사전 분석으로 — S7-02가 사전 분석을 보이도록 새 분석 ID를 버린다(화면 변화 없음)
    caption: FALLBACK_TEXTS.S707.caption,
    async render(ctx) {
      ctx.scratch.delete('s7-analysis-id');
    },
  },
};

const s702 = derive(pick(base, 'S7-02'), {
  dynamicNarration: (ctx) => s702Narration(ctx.scratch.has('s7-analysis-id')),
  facts: ['GPU_USED'],
});

const s706: StepDef = {
  id: 'S7-06',
  title: '엑셀로 받기',
  narration: [FALLBACK_TEXTS.S706.caption],
  badges: ['AUDIT_TRAIL'],
  budgetSec: 20,
  driver: 'UI',
  account: 'admin1',
  layout: 'console',
  core: false,
  skippable: true,
  capture: 'none',
  async run(ctx) {
    const id = currentAnalysisId(ctx);
    const full = ctx.full;
    if (!full) throw new Error('풀 투어 실행 환경이 없습니다');
    await ctx.openConsole(`${listPath(ctx.ids)}/${id}`);
    const btn = ctx.console.getByRole('button', { name: A_.exportButton, exact: true });
    await btn.waitFor({ state: 'visible', timeout: 15_000 });
    mkdirSync(full.downloadsDir, { recursive: true });
    const auditBefore = await exportAuditCount(ctx);
    const [download] = await Promise.all([ctx.page.waitForEvent('download', { timeout: 30_000 }), btn.click()]);
    const savedPath = join(full.downloadsDir, download.suggestedFilename());
    await download.saveAs(savedPath);
    const fail = await download.failure();
    if (fail) throw new Error(`다운로드 실패: ${fail}`);
    await ctx.console.getByText(A_.exportDone, { exact: false }).first().waitFor({ state: 'visible', timeout: 15_000 });
    const buf = readFileSync(savedPath);
    const sig = buf.subarray(0, 4).toString('hex');
    ctx.scratch.set('s7-06-file', { path: savedPath, bytes: statSync(savedPath).size, sig, via: 'BROWSER', auditBefore });
  },
  async verify(ctx) {
    const f = ctx.scratch.get('s7-06-file') as { path: string; bytes: number; sig: string; via: 'BROWSER' | 'API'; auditBefore: number } | undefined;
    if (!f) return { ok: false, expected: '내려받은 파일', actual: '없음' };
    const extOk = /\.xlsx$/i.test(f.path);
    const sigOk = f.sig === '504b0304';
    // 감사 로그의 내보내기 행(받은 사람·시각·행 수) — 행 수 = 묶음 수 + 발화 수(DX-5), 발화 수 = 분석의 분석 대상 발화 수
    const audit = await latestExportAudit(ctx);
    const detail = await analysisDetail(ctx, currentAnalysisId(ctx));
    const valid = Number(detail.counts?.validCount ?? NaN);
    const auditOk = audit !== null && audit.rows === audit.clusters + audit.utterances && (Number.isNaN(valid) || audit.utterances === valid);
    const full = ctx.full!;
    full.record.downloads.push({ stepId: 'S7-06', file: f.path.split(/[\\/]/).slice(-2).join('/'), bytes: f.bytes, via: f.via, auditRows: audit?.rows ?? null, signature: f.sig });
    const newRow = audit !== null;
    return {
      ok: extOk && f.bytes > 0 && sigOk && auditOk && newRow,
      expected: '확장자 .xlsx · 크기 > 0 · PK 시그니처 · 감사 내보내기 행(행 수 = 묶음 + 발화)',
      actual: `${extOk ? '.xlsx' : '확장자 이상'} · ${f.bytes}바이트 · ${f.sig} · 감사 ${audit ? `행 ${audit.rows}(묶음 ${audit.clusters} + 발화 ${audit.utterances})` : '없음'}`,
    };
  },
  fallback: {
    caption: FALLBACK_TEXTS.S706.caption,
    notice: FALLBACK_TEXTS.S706.notice,
    async render(ctx) {
      if (ctx.mode === 'headless-check') throw new Error('무인 점검에서는 대체하지 않습니다');
      // 다운로드가 막힌 경우 하네스가 API로 같은 파일을 받아 형식만 확인한다(파일은 화면에 열지 않는다)
      const id = currentAnalysisId(ctx);
      const full = ctx.full;
      if (!full) return;
      const url = `${ctx.urls.apiBase}/chatbots/${ctx.ids.A.id}/utterance-analyses/${id}/export`;
      const res = await fetch(url, { headers: { cookie: `cb_session=${encodeURIComponent(ctx.api.admin1.sessionValue ?? '')}` }, signal: AbortSignal.timeout(30_000) });
      const buf = Buffer.from(await res.arrayBuffer());
      const sig = buf.subarray(0, 4).toString('hex');
      const audit = await latestExportAudit(ctx);
      full.record.downloads.push({ stepId: 'S7-06', file: '(API 수신 — 저장 안 함)', bytes: buf.length, via: 'API', auditRows: audit?.rows ?? null, signature: sig });
      if (!res.ok || sig !== '504b0304') throw new Error('API로 받은 파일 형식이 xlsx가 아닙니다');
    },
  },
};

interface ExportAudit {
  rows: number;
  clusters: number;
  utterances: number;
}

/** 감사 로그의 내보내기(EXPORT) 행 수(챗봇 A). */
async function exportAuditCount(ctx: StepContext): Promise<number> {
  const r = (await ctx.api.admin1.get('/audit-logs', { query: { chatbotId: ctx.ids.A.id, action: 'EXPORT', pageSize: 50 } })).body as { items?: unknown[] };
  return (r.items ?? []).length;
}

/** 가장 최근 내보내기 감사 행의 상세 — `after.{rows,utterances,clusters}`는 목록이 아니라 상세에만 있다(DX-5). */
async function latestExportAudit(ctx: StepContext): Promise<ExportAudit | null> {
  const r = (await ctx.api.admin1.get('/audit-logs', { query: { chatbotId: ctx.ids.A.id, action: 'EXPORT', pageSize: 20 } })).body as { items?: Array<{ id: string; createdAt?: string }> };
  const items = [...(r.items ?? [])].sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
  for (const it of items) {
    const d = (await ctx.api.admin1.get(`/audit-logs/${it.id}`)).body as { after?: { rows?: number; utterances?: number; clusters?: number } | string | null };
    let after = d.after;
    if (typeof after === 'string') {
      try {
        after = JSON.parse(after) as typeof after;
      } catch {
        after = null;
      }
    }
    if (after && typeof after === 'object' && typeof after.rows === 'number') return { rows: after.rows, clusters: Number(after.clusters ?? 0), utterances: Number(after.utterances ?? 0) };
  }
  return null;
}

export const s7FullSegment: Pick<SegmentDef, 'steps' | 'skipOrder'> = {
  steps: [s701Plain, s701Live, s707, s702, pick(base, 'S7-03'), pick(base, 'S7-04'), pick(base, 'S7-05'), s706],
  skipOrder: ['S7-06', 'S7-01', 'S7-05'],
};
