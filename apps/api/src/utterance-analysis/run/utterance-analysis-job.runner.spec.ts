import { EgressBlockedError } from '../../common/egress/egress-guard';
import { EmbeddingModelChangedError, EmbeddingProviderUnavailableError } from '../../embedding/embedding-provider.port';
import type { EmbeddingProvider } from '../../embedding/embedding-provider.port';
import { ResultCommitRejectedError } from '../core/utterance-analysis.store';
import type { CommitClusterRow, CommitSummary, CommitUtteranceRow } from '../core/utterance-analysis.store';
import type { MaskedUtteranceText, PreparedUtterance } from '../lib/prepare-utterances';
import { UtteranceAnalysisCancelRegistry } from './utterance-analysis-cancel.registry';
import * as kmeans from '../lib/spherical-kmeans';
import { CLUSTERING_SLICE_POINTS, UtteranceAnalysisJobRunner } from './utterance-analysis-job.runner';
import type { AnalysisJobParams } from './utterance-analysis-job.runner';

/**
 * 분석 작업 러너 단위 시험(설계서 §8) — 통합 시험이 시간·타이밍 때문에 다루기 어려운 규약: 임베딩 배치 크기 · 적응형 양보
 * (배치 소요 × 비율 · 최소 휴식) · 취소 관측 시점 · 실패 사유 분류 · 결과 커밋은 한 번(부분 결과 0) · 이름 제안 예산.
 */

const DIM = 4;

function utterance(text: string, count = 1): PreparedUtterance {
  return { text: text as MaskedUtteranceText, normalized: text.replace(/\s+/g, '').toLowerCase(), count, memo: null, hasBannedWord: false, hasMaskToken: false };
}

/** 두 주제("환불"/"배송") × n개 — 주제 키워드에 따라 서로 직교하는 축 + 미세 잡음. */
function corpus(perTopic: number): PreparedUtterance[] {
  const out: PreparedUtterance[] = [];
  for (let i = 0; i < perTopic; i += 1) out.push(utterance(`환불 문의 ${String(i).padStart(3, '0')}번 내용`));
  for (let i = 0; i < perTopic; i += 1) out.push(utterance(`배송 문의 ${String(i).padStart(3, '0')}번 내용`));
  return out;
}

function vectorOf(text: string): Float32Array {
  const v = new Float32Array(DIM);
  v[text.startsWith('환불') ? 0 : text.startsWith('배송') ? 1 : 3] = 1;
  const seed = [...text].reduce((s, c) => s + c.charCodeAt(0), 0);
  v[2] = ((seed % 7) - 3) * 0.01;
  return v;
}

interface Harness {
  runner: UtteranceAnalysisJobRunner;
  registry: UtteranceAnalysisCancelRegistry;
  store: { updateProgress: jest.Mock; commitResults: jest.Mock };
  provider: { modelId: string; dimension: number; embed: jest.Mock; healthy: jest.Mock };
  probe: { probe: jest.Mock };
  suggester: { suggesterId: 'mock'; suggest: jest.Mock };
  calls: Array<{ size: number; at: number; kind: string }>;
}

function build(opts: { config?: Record<string, unknown>; embed?: (texts: string[]) => Promise<Float32Array[]>; suggest?: (input: { keywords: readonly string[] }) => Promise<string | null>; noProvider?: boolean } = {}): Harness {
  const registry = new UtteranceAnalysisCancelRegistry();
  const calls: Harness['calls'] = [];
  const provider = {
    modelId: 'fake-model',
    dimension: DIM,
    embed: jest.fn(async (texts: string[], kind: string) => {
      calls.push({ size: texts.length, at: Date.now(), kind });
      return opts.embed ? opts.embed(texts) : texts.map(vectorOf);
    }),
    healthy: jest.fn().mockResolvedValue(true),
  };
  const store = { updateProgress: jest.fn().mockResolvedValue(undefined), commitResults: jest.fn().mockResolvedValue(undefined) };
  const probe = { probe: jest.fn().mockResolvedValue({ status: 'DONE', targetKind: 'LIVE', versionId: null, versionNo: null, contentHash: null, threshold: 0.8, items: [] }) };
  const suggester = { suggesterId: 'mock' as const, suggest: jest.fn(async (input: { keywords: readonly string[] }) => (opts.suggest ? opts.suggest(input) : `${input.keywords[0]} 문의`)) };
  const config = {
    UTTERANCE_ANALYSIS_EMBED_BATCH_SIZE: 16,
    UTTERANCE_ANALYSIS_EMBED_PAUSE_MS: 0,
    UTTERANCE_ANALYSIS_EMBED_YIELD_RATIO: 0,
    UTTERANCE_ANALYSIS_NAME_SUGGEST_BUDGET_MS: 300_000,
    ...opts.config,
  } as Record<string, unknown>;
  const runner = new UtteranceAnalysisJobRunner(
    store as never,
    { get: jest.fn().mockResolvedValue(opts.noProvider ? undefined : (provider as unknown as EmbeddingProvider)) } as never,
    probe as never,
    { getAnalyzer: () => ({ analyzerId: 'heuristic@0', ready: true, analyze: (t: string) => t.split(/\s+/).map((surface, i) => ({ surface, start: i, end: i + 1, pos: 'NNG' })) }) } as never,
    { create: () => suggester } as never,
    { evaluateInbound: jest.fn().mockResolvedValue({ decision: 'PASS', matches: [] }) } as never,
    registry,
    { get: (k: string) => config[k] } as never,
  );
  return { runner, registry, store, provider, probe, suggester, calls };
}

function params(utterances: PreparedUtterance[], over: Partial<AnalysisJobParams['conditions']> = {}, id = 'analysis-1'): AnalysisJobParams {
  return {
    analysisId: id,
    chatbotId: 'bot-1',
    utterances,
    conditions: { targetClusterCount: 2, minClusterSize: 3, keywordCount: 5, nounsOnly: true, probe: { enabled: false, target: 'SERVING', scoreThreshold: null }, nameSuggest: false, ...over },
  };
}

describe('UtteranceAnalysisJobRunner — 분석 작업 본체(설계서 §8)', () => {
  it('성공 — 결과 커밋은 정확히 1번, 묶음 2개·발화 전부·요약이 함께 넘어간다(부분 결과 0)', async () => {
    const h = build();
    const result = await h.runner.run(params(corpus(10)));
    expect(result.status).toBe('SUCCEEDED');
    expect(h.store.commitResults).toHaveBeenCalledTimes(1);
    const [analysisId, summary, clusters, utterances] = h.store.commitResults.mock.calls[0] as [string, CommitSummary, CommitClusterRow[], CommitUtteranceRow[]];
    expect(analysisId).toBe('analysis-1');
    expect(summary).toMatchObject({ clusterCount: 2, unassignedCount: 0, embeddingModelId: 'fake-model', probeStatus: 'OFF', nameSuggestStatus: 'OFF', analyzerId: 'heuristic@0' });
    expect(JSON.parse(summary.noticesJson)).toContain('HEURISTIC_ANALYZER');
    expect(clusters.map((c) => c.ordinal)).toEqual([1, 2]);
    expect(clusters.every((c) => c.utteranceCount === 10)).toBe(true);
    expect(utterances).toHaveLength(20);
    // seq는 1부터 연속이고 묶음 안에서는 같은 주제만 모인다
    expect(utterances.map((u) => u.seq)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    const clusterOf = new Map(clusters.map((c) => [c.id, c.ordinal]));
    const topicByCluster = new Map<number, Set<string>>();
    for (const u of utterances) topicByCluster.set(clusterOf.get(u.clusterId)!, (topicByCluster.get(clusterOf.get(u.clusterId)!) ?? new Set()).add(u.text.slice(0, 2)));
    for (const set of topicByCluster.values()) expect(set.size).toBe(1);
  });

  it('군집 계산에 양보 간격 slicePoints=64를 주입한다', async () => {
    const spy = jest.spyOn(kmeans, 'sphericalKMeans');
    try {
      const h = build();
      await h.runner.run(params(corpus(10)));
      expect(CLUSTERING_SLICE_POINTS).toBe(64);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][2]).toMatchObject({ slicePoints: 64 });
    } finally {
      spy.mockRestore();
    }
  });

  it('임베딩은 설정한 배치 크기(16)로 QUERY 종류만 호출한다 — 33건 = 16 · 16 · 1', async () => {
    const h = build();
    await h.runner.run(params(corpus(17).slice(0, 33)));
    expect(h.calls.map((c) => c.size)).toEqual([16, 16, 1]);
    expect(h.calls.every((c) => c.kind === 'QUERY')).toBe(true);
    // 정규화 문자열 오름차순으로 넘긴다(파일 행 순서 무관 — 결정론)
    const sent = h.provider.embed.mock.calls.flatMap((c) => c[0] as string[]);
    const normalized = sent.map((t) => t.replace(/\s+/g, '').toLowerCase());
    expect(normalized).toEqual([...normalized].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });

  it('적응형 양보 — 배치 사이 쉬는 시간은 max(최소 휴식, 배치 소요 × 비율)이다', async () => {
    const slow = build({
      config: { UTTERANCE_ANALYSIS_EMBED_PAUSE_MS: 10, UTTERANCE_ANALYSIS_EMBED_YIELD_RATIO: 1 },
      embed: async (texts) => {
        await new Promise((r) => setTimeout(r, 80)); // 배치 소요 ≈ 80ms → 휴식 ≥ 80ms
        return texts.map(vectorOf);
      },
    });
    await slow.runner.run(params(corpus(17).slice(0, 33)));
    const gaps = slow.calls.slice(1).map((c, i) => c.at - slow.calls[i].at);
    expect(gaps).toHaveLength(2);
    for (const g of gaps) expect(g).toBeGreaterThanOrEqual(80 + 60); // 소요 80 + 휴식 ≥ 80(타이머 오차 여유)

    const minPause = build({ config: { UTTERANCE_ANALYSIS_EMBED_PAUSE_MS: 120, UTTERANCE_ANALYSIS_EMBED_YIELD_RATIO: 0 } });
    await minPause.runner.run(params(corpus(17).slice(0, 33)));
    const gaps2 = minPause.calls.slice(1).map((c, i) => c.at - minPause.calls[i].at);
    for (const g of gaps2) expect(g).toBeGreaterThanOrEqual(100); // 배치는 즉시 끝나도 최소 휴식 120ms
  });

  it('마지막 배치 뒤에는 쉬지 않는다(불필요한 지연 0)', async () => {
    const h = build({ config: { UTTERANCE_ANALYSIS_EMBED_PAUSE_MS: 200 } });
    const started = Date.now();
    await h.runner.run(params(corpus(8))); // 16건 = 배치 1개
    expect(Date.now() - started).toBeLessThan(150);
  });

  describe('취소', () => {
    it('임베딩 배치 사이에 취소가 관측되면 CANCELLED로 끝나고 결과를 저장하지 않는다', async () => {
      const h = build({ config: { UTTERANCE_ANALYSIS_EMBED_PAUSE_MS: 30 } });
      h.provider.embed.mockImplementationOnce(async (texts: string[]) => {
        h.registry.cancel('analysis-1');
        return texts.map(vectorOf);
      });
      const result = await h.runner.run(params(corpus(17).slice(0, 33)));
      expect(result).toEqual({ status: 'FAILED', failureReason: 'CANCELLED' });
      expect(h.provider.embed).toHaveBeenCalledTimes(1);
      expect(h.store.commitResults).not.toHaveBeenCalled();
    });

    it('시작 전에 이미 취소되어 있으면 임베딩도 부르지 않는다', async () => {
      const h = build();
      h.registry.cancel('analysis-1');
      const result = await h.runner.run(params(corpus(10)));
      expect(result).toEqual({ status: 'FAILED', failureReason: 'CANCELLED' });
      expect(h.provider.embed).not.toHaveBeenCalled();
      expect(h.store.commitResults).not.toHaveBeenCalled();
    });

    it('저장 직전 취소 관측 — 대조·키워드가 끝난 뒤에도 결과를 버린다', async () => {
      const h = build();
      h.probe.probe.mockImplementationOnce(async () => {
        h.registry.cancel('analysis-1');
        return { status: 'DONE', targetKind: 'LIVE', versionId: null, versionNo: null, contentHash: null, threshold: 0.8, items: new Array(20).fill(null).map(() => ({ answered: true, matchKind: null, matchId: null, matchName: null, band: 'SKIPPED', score: null, wouldUseRag: false, learningCandidate: false, suggestedIntents: [] })) };
      });
      const result = await h.runner.run(params(corpus(10), { probe: { enabled: true, target: 'SERVING', scoreThreshold: null } }));
      expect(result).toEqual({ status: 'FAILED', failureReason: 'CANCELLED' });
      expect(h.store.commitResults).not.toHaveBeenCalled();
    });
  });

  describe('실패 사유 분류(문장 0 — §8.5)', () => {
    it('임베딩 공급원이 없으면 EMBEDDING_UNAVAILABLE', async () => {
      const h = build({ noProvider: true });
      expect(await h.runner.run(params(corpus(10)))).toEqual({ status: 'FAILED', failureReason: 'EMBEDDING_UNAVAILABLE' });
    });

    it.each([
      ['연결 실패', () => new EmbeddingProviderUnavailableError('ml-worker 호출 실패'), 'EMBEDDING_UNAVAILABLE'],
      ['모델 변경', () => new EmbeddingModelChangedError('ml-worker 모델이 변경되었습니다(expected=a, actual=b)'), 'EMBEDDING_MODEL_CHANGED'],
      ['출구 차단(원인 예외)', () => new EmbeddingProviderUnavailableError('ml-worker 호출 실패', new EgressBlockedError('EMBEDDING', 'x.example')), 'EGRESS_BLOCKED'],
      ['출구 차단(직접)', () => new EgressBlockedError('EMBEDDING', 'x.example'), 'EGRESS_BLOCKED'],
      ['알 수 없는 예외', () => new Error('문장이 섞인 메시지 환불 010-1234-5678'), 'EMBEDDING_UNAVAILABLE'],
    ] as const)('%s → %s', async (_name, makeError, reason) => {
      const h = build();
      h.provider.embed.mockRejectedValueOnce(makeError());
      const result = await h.runner.run(params(corpus(10)));
      expect(result).toEqual({ status: 'FAILED', failureReason: reason });
      expect(JSON.stringify(result)).not.toContain('010-1234'); // 예외 message가 결과에 새지 않는다
      expect(h.store.commitResults).not.toHaveBeenCalled();
    });

    it('벡터 개수·차원이 어긋나면 모델이 바뀐 것으로 본다', async () => {
      const wrongCount = build({ embed: async (texts) => texts.slice(1).map(vectorOf) });
      expect(await wrongCount.runner.run(params(corpus(10)))).toEqual({ status: 'FAILED', failureReason: 'EMBEDDING_MODEL_CHANGED' });
      const wrongDim = build({ embed: async (texts) => texts.map(() => new Float32Array(DIM + 3)) });
      expect(await wrongDim.runner.run(params(corpus(10)))).toEqual({ status: 'FAILED', failureReason: 'EMBEDDING_MODEL_CHANGED' });
    });

    it('결과 커밋이 거절되면 SAVE_FAILED · 그사이 취소됐다면 CANCELLED', async () => {
      const rejected = build();
      rejected.store.commitResults.mockRejectedValueOnce(new ResultCommitRejectedError());
      expect(await rejected.runner.run(params(corpus(10)))).toEqual({ status: 'FAILED', failureReason: 'SAVE_FAILED' });

      const cancelled = build();
      cancelled.store.commitResults.mockImplementationOnce(async () => {
        cancelled.registry.cancel('analysis-1');
        throw new ResultCommitRejectedError();
      });
      expect(await cancelled.runner.run(params(corpus(10)))).toEqual({ status: 'FAILED', failureReason: 'CANCELLED' });

      const dbError = build();
      dbError.store.commitResults.mockRejectedValueOnce(new Error('FOREIGN KEY constraint failed'));
      expect(await dbError.runner.run(params(corpus(10)))).toEqual({ status: 'FAILED', failureReason: 'SAVE_FAILED' });
    });

    it('발화 수가 최소 발화 수 × 2 미만이면 군집을 시도하지 않고 CLUSTERING_FAILED(서비스가 요청 단계에서 이미 거절한다)', async () => {
      const h = build();
      const result = await h.runner.run(params(corpus(2), { minClusterSize: 5 }));
      expect(result).toEqual({ status: 'FAILED', failureReason: 'CLUSTERING_FAILED' });
    });
  });

  describe('진행률 · 단계', () => {
    it('진행률 DB 쓰기는 단계 전환 때 즉시, 같은 단계 안에서는 1초에 1회 이하다', async () => {
      const h = build();
      await h.runner.run(params(corpus(10)));
      const stages = h.store.updateProgress.mock.calls.map((c) => c[2]);
      // 대조·이름 제안을 끈 실행: EMBEDDING → CLUSTERING → KEYWORDS → SAVING
      expect(stages.filter((s, i) => s !== stages[i - 1])).toEqual(['EMBEDDING', 'CLUSTERING', 'KEYWORDS', 'SAVING']);
      // 20건은 배치 2개뿐이라 1초 안의 배치 진행률 쓰기는 억제된다
      expect(h.store.updateProgress.mock.calls.length).toBeLessThanOrEqual(6);
      const values = h.store.updateProgress.mock.calls.map((c) => c[1] as number);
      expect([...values].sort((a, b) => a - b)).toEqual(values); // 단조 증가
    });

    it('대조를 켜면 PROBING 단계가 추가되고 그 결과가 발화 행에 기록된다', async () => {
      const h = build();
      h.probe.probe.mockResolvedValueOnce({
        status: 'DONE',
        targetKind: 'PROD',
        versionId: 'v-1',
        versionNo: 3,
        contentHash: 'hash',
        threshold: 0.75,
        items: new Array(20).fill(null).map((_, i) => ({ answered: i % 2 === 0, matchKind: null, matchId: null, matchName: null, band: 'CONFIRMED', score: 0.9, wouldUseRag: false, learningCandidate: i % 2 === 1, suggestedIntents: [] })),
      });
      const result = await h.runner.run(params(corpus(10), { probe: { enabled: true, target: 'SERVING', scoreThreshold: 0.75 } }));
      expect(result.status).toBe('SUCCEEDED');
      const [, summary, clusters, utterances] = h.store.commitResults.mock.calls[0] as [string, CommitSummary, CommitClusterRow[], CommitUtteranceRow[]];
      expect(summary).toMatchObject({ probeStatus: 'DONE', probeTargetKind: 'PROD', probeVersionNo: 3, probeContentHash: 'hash', probeThreshold: 0.75, candidateCount: 10 });
      expect(utterances.filter((u) => u.learningCandidate)).toHaveLength(10);
      expect(clusters.reduce((s, c) => s + c.candidateCount, 0)).toBe(10);
      expect(h.store.updateProgress.mock.calls.map((c) => c[2])).toContain('PROBING');
      // 대조는 임베딩 단계의 벡터를 그대로 받는다(추가 임베딩 호출 0)
      const probeArgs = h.probe.probe.mock.calls[0][0];
      expect(probeArgs.items).toHaveLength(20);
      expect(probeArgs.modelId).toBe('fake-model');
      expect(h.provider.embed.mock.calls.flatMap((c) => c[0] as string[])).toHaveLength(20);
    });

    it('대조가 실패해도 분석은 성공하고 발화 대조 필드는 비어 있다(R-20)', async () => {
      const h = build();
      h.probe.probe.mockResolvedValueOnce({ status: 'FAILED', failureReason: 'TARGET_VERSION_UNREADABLE', targetKind: 'PROD', versionId: 'v-1', versionNo: null, contentHash: null, threshold: null });
      const result = await h.runner.run(params(corpus(10), { probe: { enabled: true, target: 'SERVING', scoreThreshold: null } }));
      expect(result.status).toBe('SUCCEEDED');
      const [, summary, , utterances] = h.store.commitResults.mock.calls[0] as [string, CommitSummary, CommitClusterRow[], CommitUtteranceRow[]];
      expect(summary).toMatchObject({ probeStatus: 'FAILED', probeFailureReason: 'TARGET_VERSION_UNREADABLE', candidateCount: 0 });
      expect(utterances.every((u) => u.probeAnswered === null && u.learningCandidate === false)).toBe(true);
    });
  });

  describe('묶음 이름 제안 단계(§16.3)', () => {
    it('묶음 번호 순서로 직렬 1건씩 · 미분류는 요청하지 않는다 · 검사를 통과한 이름만 저장한다', async () => {
      const order: string[] = [];
      let inFlight = 0;
      let maxInFlight = 0;
      const h = build({
        suggest: async (input) => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          order.push(input.keywords[0]);
          await new Promise((r) => setTimeout(r, 5));
          inFlight -= 1;
          return order.length === 1 ? '환불 신청 문의' : 'Refund inquiry'; // 둘째는 영문 — 탈락
        },
      });
      // 환불 8 + 배송 8 + 작은 묶음(로그인 2) → 미분류
      const items = [...corpus(8), utterance('로그인 문의 001번 내용'), utterance('로그인 문의 002번 내용')];
      const result = await h.runner.run(params(items, { nameSuggest: true, targetClusterCount: 3, minClusterSize: 3 }));
      expect(result.status).toBe('SUCCEEDED');
      const [, summary, clusters] = h.store.commitResults.mock.calls[0] as [string, CommitSummary, CommitClusterRow[]];
      const real = clusters.filter((c) => !c.unassigned);
      expect(h.suggester.suggest).toHaveBeenCalledTimes(real.length); // 미분류 제외
      expect(maxInFlight).toBe(1);
      expect(summary.nameSuggestStatus).toBe('PARTIAL');
      expect(clusters.filter((c) => c.suggestedName).map((c) => c.suggestedName)).toEqual(['환불 신청 문의']);
      expect(clusters.find((c) => c.unassigned)?.suggestedName).toBeNull();
      // 표본은 최대 5개 · 키워드는 최대 20개
      for (const call of h.suggester.suggest.mock.calls) {
        expect((call[0] as { samples: string[] }).samples.length).toBeLessThanOrEqual(5);
        expect((call[0] as { keywords: string[] }).keywords.length).toBeLessThanOrEqual(20);
      }
    });

    it('단계 예산이 바닥나면 남은 묶음은 요청하지 않는다 — PARTIAL(TIMEOUT)', async () => {
      const h = build({
        config: { UTTERANCE_ANALYSIS_NAME_SUGGEST_BUDGET_MS: 60 },
        suggest: async () => {
          await new Promise((r) => setTimeout(r, 80));
          return '환불 신청 문의';
        },
      });
      const result = await h.runner.run(params(corpus(8), { nameSuggest: true }));
      expect(result.status).toBe('SUCCEEDED');
      const [, summary, clusters] = h.store.commitResults.mock.calls[0] as [string, CommitSummary, CommitClusterRow[]];
      expect(h.suggester.suggest).toHaveBeenCalledTimes(1); // 첫 요청이 예산을 다 썼다
      expect(summary.nameSuggestStatus).toBe('PARTIAL');
      expect(summary.nameSuggestFailureReason).toBe('TIMEOUT');
      expect(clusters.filter((c) => c.suggestedName)).toHaveLength(1);
    });

    it('표본은 각 300자로 자른다 — 발화 최대 길이 설정이 300을 넘어도 /cluster-label 계약(≤300)을 지킨다', async () => {
      const long = (topic: string, i: number) => utterance(`${topic} 문의 ${String(i).padStart(3, '0')} ${'가'.repeat(450)}`);
      const items = [...Array.from({ length: 8 }, (_, i) => long('환불', i)), ...Array.from({ length: 8 }, (_, i) => long('배송', i))];
      const h = build();
      const result = await h.runner.run(params(items, { nameSuggest: true }));
      expect(result.status).toBe('SUCCEEDED');
      expect(h.suggester.suggest).toHaveBeenCalled();
      for (const call of h.suggester.suggest.mock.calls) {
        const samples = (call[0] as { samples: string[] }).samples;
        expect(samples.length).toBeGreaterThan(0);
        expect(samples.every((t) => t.length <= 300)).toBe(true);
      }
    });

    it('제안 포트가 예외를 던져도 작업은 계속된다(방어)', async () => {
      const h = build({
        suggest: async () => {
          throw new Error('boom');
        },
      });
      const result = await h.runner.run(params(corpus(8), { nameSuggest: true }));
      expect(result.status).toBe('SUCCEEDED');
      const [, summary] = h.store.commitResults.mock.calls[0] as [string, CommitSummary];
      expect(summary).toMatchObject({ nameSuggestStatus: 'FAILED', nameSuggestFailureReason: 'NAME_SUGGEST_UNAVAILABLE' });
    });
  });
});
