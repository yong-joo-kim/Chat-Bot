/**
 * No.21 발화 묶음 분석의 군집 품질 측정 도구(설계서 §20.5 · P-5 · AC-DC3-4). CI 밖 수동 도구다.
 *
 * **제품 함수를 그대로** 호출한다(`sphericalKMeansSync`·`resolveClusterCount`·`postprocessClusters`·
 * `extractKeywordTerms`·`computeClusterKeywords`) — 측정한 것 = 배포되는 것. 임베딩은 등록된 출구 파일의
 * `HttpEmbeddingProvider.connect()`를 쓰므로 이 스크립트가 `fetch`를 직접 쓰지 않는다.
 *
 * 사용법(ml-worker가 KURE-v1로 기동 중이어야 한다 — `apps/ml-worker`에서 `pnpm start`):
 *   cd apps/api
 *   EMBEDDING_BASE_URL=http://localhost:8100 npx ts-node -r tsconfig-paths/register --transpile-only \
 *     src/utterance-analysis/eval/measure-clustering-quality.ts \
 *     [--dataset <json>] [--k <n>] [--min 5] [--nouns] [--mask-inject 0.2] [--repeat 2] \
 *     [--scale 5000] [--dump <dir>] [--dump-clusters <json>] [--report <path>]
 *
 * 옵션(설계서 §20.5-3):
 *   --dataset      정답표 `{ intents: Record<의도, 예문[]> }`(기본 `dataset-clustering-ko.json`, 여러 번 지정 가능)
 *   --k            추가로 측정할 목표 묶음 수(기본: 의도 수와 10을 항상 측정)
 *   --min          묶음 최소 발화 수(기본 5)
 *   --nouns        (기본 켜짐) `--no-nouns`로 끄면 동사·형용사 어간·어근도 키워드 후보
 *   --mask-inject  비율(0~1) — 그만큼의 문장에 가짜 개인정보를 넣고 마스킹한 뒤 다시 측정(FR-DC2-4)
 *   --repeat       결정론 확인 반복 횟수(기본 2)
 *   --scale        합성 확장 발화 수(예: 5000) — 소요 시간 "동작 확인" 전용(품질 판정에는 쓰지 않는다)
 *   --dump         벡터 float32 바이너리 + 라벨 JSON 저장 디렉터리(파이썬 기준선용)
 *   --dump-clusters 묶음별 키워드·대표 발화(합성 문장) JSON 경로 — ml-worker/eval/cluster_label_check.py 입력
 *   --report       보고서 경로(기본 `eval/report/clustering-quality_<modelId>_<날짜>.md`)
 *
 * 개인정보: 정답표는 합성 문장뿐이고, 마스킹 주입에 쓰는 개인정보는 형식만 맞춘 무효 값이다. 보고서에는
 * 문장을 싣지 않는다(지표·건수·묶음별 키워드 요약만).
 */
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { maskPii } from '@chat-bot/pii-mask';
import { normalizeText } from '@chat-bot/shared-types';
import { HttpEmbeddingProvider } from '../../embedding/providers/http-embedding.provider';
import { GaruAnalyzer } from '../../learning/morph/garu-analyzer';
import { HeuristicAnalyzer } from '../../learning/morph/heuristic-analyzer';
import type { MorphAnalyzerPort } from '../../learning/morph/morph-analyzer.port';
import { computeClusterKeywords } from '../lib/cluster-keywords';
import { compareCodeUnit, postprocessClusters, ProcessedCluster, resolveClusterCount } from '../lib/cluster-postprocess';
import { extractKeywordTerms } from '../lib/keyword-tokens';
import { CLUSTERING_ALGORITHM, mulberry32, sphericalKMeansSync } from '../lib/spherical-kmeans';

// ───────────────────────────── 인자 ─────────────────────────────
interface Args {
  datasets: string[];
  extraK: number[];
  min: number;
  nouns: boolean;
  maskInject: number;
  repeat: number;
  scale: number;
  dump: string | null;
  dumpClusters: string | null;
  report: string | null;
  command: string;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { datasets: [], extraK: [], min: 5, nouns: true, maskInject: 0, repeat: 2, scale: 0, dump: null, dumpClusters: null, report: null, command: argv.join(' ') };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    const next = () => argv[++i];
    if (v === '--dataset') a.datasets.push(path.resolve(next()));
    else if (v === '--k') a.extraK.push(Number(next()));
    else if (v === '--min') a.min = Number(next());
    else if (v === '--nouns') a.nouns = true;
    else if (v === '--no-nouns') a.nouns = false;
    else if (v === '--mask-inject') a.maskInject = Number(next());
    else if (v === '--repeat') a.repeat = Number(next());
    else if (v === '--scale') a.scale = Number(next());
    else if (v === '--dump') a.dump = path.resolve(next());
    else if (v === '--dump-clusters') a.dumpClusters = path.resolve(next());
    else if (v === '--report') a.report = path.resolve(next());
    else throw new Error(`알 수 없는 옵션: ${v}`);
  }
  if (a.datasets.length === 0) a.datasets.push(path.join(__dirname, 'dataset-clustering-ko.json'));
  return a;
}

// ───────────────────────────── 데이터 ─────────────────────────────
interface Row {
  text: string;
  label: string;
}

function loadRows(files: string[]): Row[] {
  const rows: Row[] = [];
  for (const f of files) {
    const data = JSON.parse(fs.readFileSync(f, 'utf-8')) as { intents: Record<string, string[]> };
    for (const [label, examples] of Object.entries(data.intents)) for (const text of examples) rows.push({ text, label });
  }
  return rows;
}

/** 정규화 문자열이 같은 행 병합(라벨이 다르면 모호하므로 제외하고 건수를 센다) → 정규화 오름차순 정렬. */
function dedupeAndSort(rows: Row[]): { rows: Row[]; normalized: string[]; ambiguousDropped: number; mergedDuplicates: number } {
  const map = new Map<string, Row & { labels: Set<string> }>();
  let mergedDuplicates = 0;
  for (const r of rows) {
    const key = normalizeText(r.text);
    const hit = map.get(key);
    if (hit) {
      hit.labels.add(r.label);
      mergedDuplicates++;
    } else map.set(key, { ...r, labels: new Set([r.label]) });
  }
  let ambiguousDropped = 0;
  const entries = [...map.entries()].filter(([, v]) => {
    if (v.labels.size > 1) {
      ambiguousDropped++;
      return false;
    }
    return true;
  });
  entries.sort((a, b) => compareCodeUnit(a[0], b[0]));
  return { rows: entries.map(([, v]) => ({ text: v.text, label: v.label })), normalized: entries.map(([k]) => k), ambiguousDropped, mergedDuplicates };
}

/** 합성 확장(소요 시간 전용) — 기존 문장에 접두·접미를 붙여 서로 다른 문장을 만든다(라벨 유지). */
const PREFIXES = ['', '저기요 ', '안녕하세요 ', '급해요 ', '문의드립니다 ', '혹시 ', '그런데 ', '죄송하지만 ', '다시 여쭙는데 ', '오늘 아침에 ', '어제부터 ', '계속 ', '빨리 ', '앱에서 ', '전화로 ', '처음인데 '];
const SUFFIXES = ['', ' 부탁드려요', ' 알려주세요', ' 궁금합니다', ' 확인 부탁해요', ' 도와주세요', ' 가능할까요', ' 감사합니다'];

function scaleUp(rows: Row[], target: number): Row[] {
  const out: Row[] = [];
  outer: for (const suffix of SUFFIXES) {
    for (const prefix of PREFIXES) {
      for (const r of rows) {
        out.push({ text: `${prefix}${r.text}${suffix}`, label: r.label });
        if (out.length >= target) break outer;
      }
    }
  }
  return out;
}

/** 마스킹 주입(FR-DC2-4) — 형식만 맞춘 무효 값. 문장은 결정론적으로 고른다. */
const FAKE_PII = [
  (i: number) => `제 번호는 010-0000-${String(1000 + (i % 9000)).padStart(4, '0')} 입니다`,
  (i: number) => `이메일 test${i}@example.com 으로 답 주세요`,
  (i: number) => `주민번호 000101-3${String(100000 + (i % 900000))} 로 확인해 주세요`,
  (i: number) => `카드 1234-5678-9012-${String(1000 + (i % 9000))} 입니다`,
  (i: number) => `계좌 123-456-${String(700000 + (i % 99999))} 입니다`,
];

/** `NONE` = 대조군(같은 문장을 붙이되 마스킹하지 않음 — 마스킹 표식 자체의 영향과 덧붙인 문장의 영향을 가른다). */
function injectPii(rows: Row[], ratio: number, mode: 'PARTIAL' | 'FULL' | 'NONE'): Row[] {
  const mask = (t: string) => (mode === 'NONE' ? t : maskPii(t, { mode }).maskedText);
  const rng = mulberry32(CLUSTERING_ALGORITHM.seed + 99);
  return rows.map((r, i) => {
    if (rng() >= ratio) return { ...r, text: mask(r.text) };
    const pii = FAKE_PII[i % FAKE_PII.length](i);
    return { ...r, text: mask(`${r.text} ${pii}`) };
  });
}

// ───────────────────────────── 지표 ─────────────────────────────
function comb2(n: number): number {
  return (n * (n - 1)) / 2;
}

interface Metrics {
  purity: number;
  inversePurity: number;
  ari: number;
  nmi: number;
  pairPrecision: number;
  pairRecall: number;
}

/** 라벨·묶음 번호 배열에서 지표 계산. */
function computeMetrics(labels: string[], clusters: number[]): Metrics {
  const n = labels.length;
  const labelIds = new Map<string, number>();
  labels.forEach((l) => {
    if (!labelIds.has(l)) labelIds.set(l, labelIds.size);
  });
  const clusterIds = new Map<number, number>();
  clusters.forEach((c) => {
    if (!clusterIds.has(c)) clusterIds.set(c, clusterIds.size);
  });
  const R = labelIds.size;
  const C = clusterIds.size;
  const table: number[][] = Array.from({ length: R }, () => new Array<number>(C).fill(0));
  for (let i = 0; i < n; i++) table[labelIds.get(labels[i])!][clusterIds.get(clusters[i])!]++;
  const rowSum = table.map((r) => r.reduce((s, x) => s + x, 0));
  const colSum = new Array<number>(C).fill(0);
  for (const r of table) r.forEach((x, c) => (colSum[c] += x));

  let purity = 0;
  for (let c = 0; c < C; c++) purity += Math.max(...table.map((r) => r[c]));
  let inverse = 0;
  for (let r = 0; r < R; r++) inverse += Math.max(...table[r]);

  let sumComb = 0;
  for (const r of table) for (const x of r) sumComb += comb2(x);
  const sumRow = rowSum.reduce((s, x) => s + comb2(x), 0);
  const sumCol = colSum.reduce((s, x) => s + comb2(x), 0);
  const expected = (sumRow * sumCol) / comb2(n);
  const maxIdx = (sumRow + sumCol) / 2;
  const ari = maxIdx - expected === 0 ? 1 : (sumComb - expected) / (maxIdx - expected);

  // NMI(산술 평균 정규화 — sklearn 기본)
  let mi = 0;
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      const x = table[r][c];
      if (x === 0) continue;
      mi += (x / n) * Math.log((x * n) / (rowSum[r] * colSum[c]));
    }
  }
  const entropy = (sums: number[]) => -sums.reduce((s, x) => (x === 0 ? s : s + (x / n) * Math.log(x / n)), 0);
  const hl = entropy(rowSum);
  const hc = entropy(colSum);
  const nmi = hl + hc === 0 ? 1 : (2 * mi) / (hl + hc);

  return {
    purity: purity / n,
    inversePurity: inverse / n,
    ari,
    nmi,
    pairPrecision: sumCol === 0 ? 0 : sumComb / sumCol,
    pairRecall: sumRow === 0 ? 0 : sumComb / sumRow,
  };
}

// ───────────────────────────── 임베딩 ─────────────────────────────
async function embedAll(provider: HttpEmbeddingProvider, texts: string[]): Promise<{ vectors: Float32Array[]; ms: number }> {
  const start = Date.now();
  const vectors: Float32Array[] = [];
  for (let i = 0; i < texts.length; i += 64) {
    vectors.push(...(await provider.embed(texts.slice(i, i + 64), 'QUERY')));
    if (texts.length > 500 && (i / 64) % 10 === 0) process.stdout.write(`\r  임베딩 ${Math.min(i + 64, texts.length)}/${texts.length}`);
  }
  if (texts.length > 500) process.stdout.write('\n');
  return { vectors, ms: Date.now() - start };
}

// ───────────────────────────── 1회 측정 ─────────────────────────────
interface RunResult {
  k: number;
  usedK: number;
  minClusterSize: number;
  clusterCount: number;
  unassignedCount: number;
  unassignedRatio: number;
  metricsAll: Metrics; // 미분류를 별도 묶음 하나로 두고 전 발화 대상
  metricsAssigned: Metrics | null; // 미분류 제외
  coverage: number;
  kmeansMs: number;
  postprocessMs: number;
  iterations: number;
  assignmentsByText: Map<string, number>; // 결정론·순서 무관 확인용(정규화 문자열 → 묶음 번호(ordinal))
  ordinalByItem: Int32Array;
  clusters: readonly ProcessedCluster[];
  notices: readonly string[];
}

function runOnce(normalized: string[], labels: string[], vectors: Float32Array[], targetK: number, min: number): RunResult {
  const resolved = resolveClusterCount(normalized.length, min, targetK);
  const usedK = resolved.tooFew ? 0 : resolved.k;
  const t0 = Date.now();
  const km = sphericalKMeansSync(vectors, usedK);
  const kmeansMs = Date.now() - t0;
  const t1 = Date.now();
  const post = postprocessClusters({
    items: normalized.map((n, i) => ({ normalized: n, count: 1, assignment: km.assignments[i], similarity: km.similarities[i] })),
    minClusterSize: min,
    targetClusterCount: targetK,
    usedK,
  });
  const postprocessMs = Date.now() - t1;
  const clusterOf = Array.from(post.ordinalByItem);
  const metricsAll = computeMetrics(labels, clusterOf);
  const unassignedOrdinal = post.clusters.find((c) => c.unassigned)?.ordinal ?? -1;
  const keep = clusterOf.map((c, i) => (c === unassignedOrdinal ? -1 : i)).filter((i) => i >= 0);
  const metricsAssigned = keep.length > 1 ? computeMetrics(keep.map((i) => labels[i]), keep.map((i) => clusterOf[i])) : null;
  const unassignedCount = normalized.length - keep.length;
  const byText = new Map<string, number>();
  normalized.forEach((n, i) => byText.set(n, post.ordinalByItem[i]));
  return {
    k: targetK,
    usedK,
    minClusterSize: min,
    clusterCount: post.clusterCount,
    unassignedCount,
    unassignedRatio: unassignedCount / normalized.length,
    metricsAll,
    metricsAssigned,
    coverage: keep.length / normalized.length,
    kmeansMs,
    postprocessMs,
    iterations: km.iterations,
    assignmentsByText: byText,
    ordinalByItem: post.ordinalByItem,
    clusters: post.clusters,
    notices: post.notices,
  };
}

function sameAssignments(a: RunResult, b: RunResult): boolean {
  if (a.assignmentsByText.size !== b.assignmentsByText.size) return false;
  for (const [k, v] of a.assignmentsByText) if (b.assignmentsByText.get(k) !== v) return false;
  return true;
}

// ───────────────────────────── 형식 ─────────────────────────────
const f3 = (x: number) => x.toFixed(3);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function gpuInfo(): string {
  try {
    const out = execSync('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return out || '없음';
  } catch {
    return '없음(nvidia-smi 미확인)';
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = process.env.EMBEDDING_BASE_URL ?? 'http://localhost:8100';
  const provider = await HttpEmbeddingProvider.connect(baseUrl, { batchTimeoutMs: 120_000 });
  const analyzer: MorphAnalyzerPort = await (async () => {
    const g = await GaruAnalyzer.load();
    return g.ready ? g : new HeuristicAnalyzer();
  })();
  console.log(`[measure] modelId=${provider.modelId} dim=${provider.dimension} analyzer=${analyzer.analyzerId}`);

  const rawRows = loadRows(args.datasets);
  const base = dedupeAndSort(rawRows);
  const intentCount = new Set(base.rows.map((r) => r.label)).size;
  console.log(`[measure] 의도 ${intentCount} · 문장 ${base.rows.length}(병합 ${base.mergedDuplicates} · 모호 제외 ${base.ambiguousDropped})`);

  const lines: string[] = [];
  const out = (s = '') => lines.push(s);

  // ── 원문 임베딩
  const emb = await embedAll(provider, base.rows.map((r) => r.text));
  const labels = base.rows.map((r) => r.label);
  console.log(`[measure] 임베딩 ${emb.ms}ms (${((emb.ms / base.rows.length) | 0)}ms/건)`);

  if (args.dump) {
    fs.mkdirSync(args.dump, { recursive: true });
    const buf = Buffer.alloc(emb.vectors.length * provider.dimension * 4);
    emb.vectors.forEach((v, i) => Buffer.from(v.buffer, v.byteOffset, v.byteLength).copy(buf, i * provider.dimension * 4));
    fs.writeFileSync(path.join(args.dump, 'vectors.f32'), buf);
    fs.writeFileSync(path.join(args.dump, 'labels.json'), JSON.stringify({ dimension: provider.dimension, n: emb.vectors.length, modelId: provider.modelId, labels, normalized: base.normalized }));
    console.log(`[measure] 덤프 저장: ${args.dump}`);
  }

  // ── 측정 구성
  const ks = [...new Set([intentCount, 10, ...args.extraK])].filter((k) => k >= 2);
  const results = new Map<number, RunResult>();
  const determinism: string[] = [];
  for (const k of ks) {
    const first = runOnce(base.normalized, labels, emb.vectors, k, args.min);
    results.set(k, first);
    let same = true;
    for (let r = 1; r < args.repeat; r++) same = same && sameAssignments(first, runOnce(base.normalized, labels, emb.vectors, k, args.min));
    // 입력 순서 무관: 섞은 뒤 호출부 규약대로 다시 정렬하면 같은 결과여야 한다
    const rng = mulberry32(12345 + k);
    const order = base.rows.map((_, i) => i).sort(() => rng() - 0.5);
    const shuffledRows = order.map((i) => base.rows[i]);
    const resorted = dedupeAndSort(shuffledRows);
    const vecByNorm = new Map(base.normalized.map((n, i) => [n, emb.vectors[i]]));
    const second = runOnce(resorted.normalized, resorted.rows.map((r) => r.label), resorted.normalized.map((n) => vecByNorm.get(n)!), k, args.min);
    const orderFree = sameAssignments(first, second);
    determinism.push(`| ${k} | ${same ? '일치' : '**불일치**'} (${args.repeat}회) | ${orderFree ? '일치' : '**불일치**'} |`);
    console.log(`[measure] k=${k}: 묶음 ${first.clusterCount} 순도 ${f3(first.metricsAll.purity)} ARI ${f3(first.metricsAll.ari)} 반복${same ? '일치' : '불일치'} 순서무관${orderFree ? '일치' : '불일치'} (${first.kmeansMs}ms)`);
  }

  // ── 키워드 점검(k = 의도 수)
  const main = results.get(intentCount)!;
  const keywordSummary = (() => {
    const clustersByOrdinal = new Map<number, number[]>();
    main.ordinalByItem.forEach((ord, i) => {
      const list = clustersByOrdinal.get(ord) ?? [];
      list.push(i);
      clustersByOrdinal.set(ord, list);
    });
    const ords = [...clustersByOrdinal.keys()].sort((a, b) => a - b);
    const terms = base.rows.map((r) => extractKeywordTerms(r.text, analyzer, { nounsOnly: args.nouns }));
    const kw = computeClusterKeywords(ords.map((o) => ({ docs: clustersByOrdinal.get(o)!.map((i) => terms[i]) })), 5);
    const withKw = kw.filter((k) => k.length > 0).length;
    // 묶음의 다수 라벨과 상위 키워드 3개를 함께 보인다(합성 데이터 — 문장 아님)
    const rows = ords.map((o, idx) => {
      const idxs = clustersByOrdinal.get(o)!;
      const cnt = new Map<string, number>();
      idxs.forEach((i) => cnt.set(labels[i], (cnt.get(labels[i]) ?? 0) + 1));
      const [top, topN] = [...cnt.entries()].sort((a, b) => b[1] - a[1] || compareCodeUnit(a[0], b[0]))[0];
      return `| ${o} | ${idxs.length} | ${top} (${pct(topN / idxs.length)}) | ${kw[idx].slice(0, 3).map((k) => k.term).join(' · ') || '-'} |`;
    });
    return { withKw, total: ords.length, rows };
  })();

  if (args.dumpClusters) {
    // 묶음별 키워드 + 대표 발화(정답표의 합성 문장 — 실제 고객 문장 0). 이름 제안 동작 확인 입력용.
    const terms = base.rows.map((r) => extractKeywordTerms(r.text, analyzer, { nounsOnly: args.nouns }));
    const kws = computeClusterKeywords(main.clusters.map((c) => ({ docs: c.itemIndexes.map((i) => terms[i]) })), 5);
    const payload = main.clusters.map((c, idx) => ({
      ordinal: c.ordinal,
      unassigned: c.unassigned,
      size: c.uniqueCount,
      keywords: kws[idx].map((k) => k.term),
      samples: c.itemIndexes.slice(0, 5).map((i) => base.rows[i].text),
    }));
    fs.writeFileSync(args.dumpClusters, JSON.stringify({ modelId: provider.modelId, clusters: payload }, null, 2), 'utf-8');
    console.log(`[measure] 묶음 덤프: ${args.dumpClusters}`);
  }

  // ── 마스킹 주입
  const maskResults: Array<{ mode: string; res: RunResult; texts: number }> = [];
  if (args.maskInject > 0) {
    for (const mode of ['NONE', 'PARTIAL', 'FULL'] as const) {
      const injected = dedupeAndSort(injectPii(base.rows, args.maskInject, mode));
      const e = await embedAll(provider, injected.rows.map((r) => r.text));
      const res = runOnce(injected.normalized, injected.rows.map((r) => r.label), e.vectors, intentCount, args.min);
      maskResults.push({ mode, res, texts: injected.rows.length });
      console.log(`[measure] 마스킹 주입 ${mode}: 순도 ${f3(res.metricsAll.purity)} ARI ${f3(res.metricsAll.ari)}`);
    }
  }

  // ── 규모 시간(동작 확인)
  let scaleReport: string[] | null = null;
  if (args.scale > 0) {
    const scaled = dedupeAndSort(scaleUp(base.rows, args.scale));
    console.log(`[measure] 규모 시험: 고유 ${scaled.rows.length}건`);
    const e = await embedAll(provider, scaled.rows.map((r) => r.text));
    const kScale = Math.min(50, Math.floor(scaled.rows.length / args.min));
    const t0 = Date.now();
    const res = runOnce(scaled.normalized, scaled.rows.map((r) => r.label), e.vectors, kScale, args.min);
    const terms0 = Date.now();
    const terms = scaled.rows.map((r) => extractKeywordTerms(r.text, analyzer, { nounsOnly: args.nouns }));
    const byOrd = new Map<number, string[][]>();
    res.ordinalByItem.forEach((o, i) => byOrd.set(o, [...(byOrd.get(o) ?? []), terms[i]]));
    computeClusterKeywords([...byOrd.keys()].sort((a, b) => a - b).map((o) => ({ docs: byOrd.get(o)! })), 5);
    const keywordsMs = Date.now() - terms0;
    void t0;
    scaleReport = [
      `- 합성 확장 고유 발화 ${scaled.rows.length}건 · 목표 묶음 수 ${kScale} · 최소 ${args.min}`,
      `- 임베딩(KURE-v1 CPU, 배치 64): **${(e.ms / 1000).toFixed(1)}초** (${(e.ms / scaled.rows.length).toFixed(1)}ms/건)`,
      `- 구면 k-평균(${CLUSTERING_ALGORITHM.version}, nInit ${CLUSTERING_ALGORITHM.nInit}, 반복 ${res.iterations}회): **${(res.kmeansMs / 1000).toFixed(2)}초**`,
      `- 후처리: ${res.postprocessMs}ms · 키워드(형태소 분석 포함): ${(keywordsMs / 1000).toFixed(2)}초`,
      `- 합계(임베딩+군집+후처리+키워드): **${((e.ms + res.kmeansMs + res.postprocessMs + keywordsMs) / 1000).toFixed(1)}초**`,
      `- 결과: 묶음 ${res.clusterCount}개 · 미분류 ${pct(res.unassignedRatio)} · 순도 ${f3(res.metricsAll.purity)} · ARI ${f3(res.metricsAll.ari)} (합성 변형이라 품질 판정 근거 아님)`,
      '- **"동작 확인" 기록**이며 예산 판정 근거가 아니다(FR-0-293 — 운영 장비 실측 전제).',
    ];
  }

  // ───────────── 보고서 ─────────────
  const today = new Date().toISOString().slice(0, 10);
  const safeModel = provider.modelId.replace(/[^A-Za-z0-9._@-]+/g, '_');
  const reportPath = args.report ?? path.join(__dirname, 'report', `clustering-quality_${safeModel}_${today}.md`);
  const cpus = os.cpus();
  out(`# 군집 품질 측정 보고서 — ${provider.modelId}`);
  out();
  out('| 항목 | 값 |');
  out('|---|---|');
  out(`| 일자 | ${today} |`);
  out(`| 장비 | CPU ${cpus[0]?.model.trim()} x${cpus.length} · RAM ${(os.totalmem() / 1024 ** 3).toFixed(1)}GB · GPU ${gpuInfo()} (임베딩은 ml-worker CPU 경로) |`);
  out(`| OS | ${os.type()} ${os.release()} · Node ${process.version} |`);
  out(`| 명령 | \`${args.command}\` |`);
  out(`| modelId | \`${provider.modelId}\` (dim ${provider.dimension}) |`);
  out(`| algorithmVersion | \`${CLUSTERING_ALGORITHM.version}\` (seed ${CLUSTERING_ALGORITHM.seed} · nInit ${CLUSTERING_ALGORITHM.nInit} · maxIter ${CLUSTERING_ALGORITHM.maxIter}) |`);
  out(`| 형태소 분석기 | \`${analyzer.analyzerId}\` |`);
  out(`| 데이터셋 | ${args.datasets.map((d) => path.basename(d)).join(', ')} — 의도 ${intentCount}개 · 문장 ${base.rows.length}건(병합 ${base.mergedDuplicates} · 모호 제외 ${base.ambiguousDropped}) · 합성 문장(실제 고객 문장 0) |`);
  out(`| 조건 | 묶음 최소 발화 수 ${args.min} · 키워드 ${args.nouns ? '명사만' : '명사 + 동사·형용사 어간·어근'} · 발생 횟수 1 · 임베딩 kind=QUERY |`);
  out();
  out('> 지표 정의: 순도 = Σ(묶음별 최다 라벨 수)/N · 역순도 = Σ(라벨별 최다 묶음 수)/N · ARI(조정 랜드 지수) · NMI(산술 평균 정규화) · 쌍 정밀도/재현율(같은 묶음에 든 쌍 기준). **전 발화 기준**은 미분류를 별도 묶음 1개로 두고 계산해 보수적이다. **미분류 제외 기준**은 실제 묶음에 든 발화만 본다.');
  out();
  out('## 1. 핵심 지표');
  out();
  out('| 목표 k | 실제 묶음 | 미분류 비율 | 구분 | 순도 | 역순도 | ARI | NMI | 쌍 정밀도 | 쌍 재현율 |');
  out('|---|---|---|---|---|---|---|---|---|---|');
  for (const k of ks) {
    const r = results.get(k)!;
    const row = (name: string, m: Metrics | null) =>
      m
        ? `| ${k}${k === intentCount ? ' (=의도 수)' : ''} | ${r.clusterCount} | ${pct(r.unassignedRatio)} | ${name} | ${f3(m.purity)} | ${f3(m.inversePurity)} | ${f3(m.ari)} | ${f3(m.nmi)} | ${f3(m.pairPrecision)} | ${f3(m.pairRecall)} |`
        : `| ${k} | ${r.clusterCount} | ${pct(r.unassignedRatio)} | ${name} | - | - | - | - | - | - |`;
    out(row('전 발화', r.metricsAll));
    out(row('미분류 제외', r.metricsAssigned));
  }
  out();
  out(`알림 코드(k=의도 수): ${main.notices.length ? main.notices.join(', ') : '없음'} · 반복 횟수 ${main.iterations}회 · 군집 소요 ${main.kmeansMs}ms(동작 확인).`);
  out();
  out('## 2. 결정론');
  out();
  out('| 목표 k | 같은 입력 반복 | 입력 순서를 섞은 뒤 정규화 정렬 |');
  out('|---|---|---|');
  determinism.forEach((d) => out(d));
  out();
  if (maskResults.length > 0) {
    out(`## 3. 마스킹 주입 전후 비교 (문장의 ${pct(args.maskInject)}에 가짜 개인정보를 붙인 뒤 \`maskPii\` 적용, k=${intentCount})`);
    out();
    out('| 구성 | 문장 수 | 순도 | 역순도 | ARI | NMI | 쌍 정밀도 | 쌍 재현율 |');
    out('|---|---|---|---|---|---|---|---|');
    out(`| 마스킹 없음(기준) | ${base.rows.length} | ${[main.metricsAll.purity, main.metricsAll.inversePurity, main.metricsAll.ari, main.metricsAll.nmi, main.metricsAll.pairPrecision, main.metricsAll.pairRecall].map(f3).join(' | ')} |`);
    for (const m of maskResults) {
      const x = m.res.metricsAll;
      out(`| 주입 + ${m.mode === 'NONE' ? '마스킹 안 함(대조군)' : `${m.mode} 마스킹`} | ${m.texts} | ${[x.purity, x.inversePurity, x.ari, x.nmi, x.pairPrecision, x.pairRecall].map(f3).join(' | ')} |`);
    }
    out();
    out('> 덧붙인 문장(예: "카드 ... 입니다", "이메일 ... 답 주세요")은 의도와 무관한 단어를 끌어들이므로 "마스킹 안 함(대조군)"도 기준보다 떨어진다. **마스킹 표식 자체의 영향 = 대조군 대비 PARTIAL·FULL의 차이**다.');
    out();
  }
  out(`## ${maskResults.length > 0 ? 4 : 3}. 묶음별 대표 키워드 점검 (k=${intentCount}, 문장은 싣지 않음)`);
  out();
  out(`키워드가 1개 이상인 묶음: ${keywordSummary.withKw}/${keywordSummary.total}`);
  out();
  out('| 묶음 번호 | 발화 수 | 최다 정답 라벨(비율) | 상위 키워드 3개 |');
  out('|---|---|---|---|');
  keywordSummary.rows.forEach((r) => out(r));
  out();
  if (scaleReport) {
    out('## 규모 시간 (동작 확인)');
    out();
    scaleReport.forEach((l) => out(l));
    out();
  }
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, lines.join('\n') + '\n', 'utf-8');
  console.log(`[measure] 보고서: ${reportPath}`);
}

main().catch((e) => {
  console.error('[measure] 실패:', e instanceof Error ? e.message : e);
  process.exit(1);
});
