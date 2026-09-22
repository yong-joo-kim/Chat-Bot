/**
 * ADR-0027 §2 재검토 트리거("골든셋에서 분류기 top-1이 1단계 kNN 대비 +5%p 이상 높을 때")의
 * 실측 근거 스크립트. 프로덕션 코드(`trainMultinomialLogistic`/`predictProbabilities`,
 * `cosineSimilarity`)를 그대로 가져와 쓴다(별도 구현 복제 없음).
 *
 * 사용법(ml-worker가 KURE-v1로 기동 중이어야 한다 — `apps/ml-worker`에서 `npm run dev` 등):
 *   EMBEDDING_BASE_URL=http://localhost:8100 npx ts-node -r tsconfig-paths/register \
 *     src/classifier/eval/compare-classifier-vs-knn.ts src/classifier/eval/dataset-hard.json
 *
 * 결과 요약(2026-09-22 실측 — 실제 `apps/ml-worker` + KURE-v1을 기동해 이 스크립트로 직접 측정,
 * `classifier-vs-knn-comparison.md`에 원본 로그 포함):
 *   - `dataset-easy.json`(의도당 예문 6건, 의도 간 어휘 겹침 없음) → kNN 100.0% / 분류기 100.0%(동률)
 *   - `dataset-hard-small.json`(의도당 예문 3건 = FR-L2-15 최소 기준, 환불/반품/교환/AS 등
 *     어휘가 겹치는 혼동 의도) → kNN **86.7%** / 분류기 **80.0%**(분류기가 -6.7%p 낮음)
 *   - `dataset-hard.json`(같은 혼동 의도, 예문 6건으로 증량) → kNN 83.3% / 분류기 83.3%(동률)
 *   → 이 저장소의 실측 범위 안에서는 재검토 트리거(+5%p)가 **발동하지 않는다**(ADR-0027의 대화
 *     경로 미편입 결정을 지지하는 근거) — 오히려 예문이 적고 의도가 혼동되기 쉬운, 실무에서 가장
 *     흔한 상황일수록 분류기가 kNN보다 불리할 수 있다는 점이 이번 실측의 핵심 발견이다.
 */
import * as fs from 'fs';
import { cosineSimilarity } from '../../embedding/lib/cosine';
import { predictProbabilities, trainMultinomialLogistic } from '../lib/logistic-regression';

interface DatasetFile {
  intents: Record<string, string[]>;
  testQueries: { text: string; intent: string }[];
}

interface EmbedResponse {
  modelId: string;
  dimension: number;
  vectors: number[][];
}

/** ml-worker의 배치 상한(기본 64)을 넘을 수 있으므로 청크로 나눠 호출한다(NFR-LP3와 같은 규약). */
async function embed(baseUrl: string, texts: string[], kind: 'QUERY' | 'PASSAGE', batchMax = 64): Promise<EmbedResponse> {
  let modelId = '';
  let dimension = 0;
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += batchMax) {
    const chunk = texts.slice(i, i + batchMax);
    const res = await fetch(`${baseUrl}/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts: chunk, kind }),
    });
    if (!res.ok) throw new Error(`ml-worker /embed HTTP ${res.status}`);
    const body = (await res.json()) as EmbedResponse;
    modelId = body.modelId;
    dimension = body.dimension;
    vectors.push(...body.vectors);
  }
  return { modelId, dimension, vectors };
}

async function main() {
  const baseUrl = process.env.EMBEDDING_BASE_URL ?? 'http://localhost:8100';
  const datasetPath = process.argv[2] ?? `${__dirname}/dataset-hard.json`;
  const dataset: DatasetFile = JSON.parse(fs.readFileSync(datasetPath, 'utf-8'));

  const classes = Object.keys(dataset.intents);
  const trainTexts: string[] = [];
  const trainLabels: string[] = [];
  for (const [intent, examples] of Object.entries(dataset.intents)) {
    for (const ex of examples) {
      trainTexts.push(ex);
      trainLabels.push(intent);
    }
  }

  console.log(`[compare] ml-worker(${baseUrl})에 임베딩 요청 중... (train ${trainTexts.length}건)`);
  const trainEmbed = await embed(baseUrl, trainTexts, 'PASSAGE');
  const testEmbed = await embed(baseUrl, dataset.testQueries.map((q) => q.text), 'QUERY');
  console.log(`[compare] modelId=${trainEmbed.modelId} dim=${trainEmbed.dimension}`);

  const trainVectors = trainEmbed.vectors.map((v) => Float32Array.from(v));
  const testVectors = testEmbed.vectors.map((v) => Float32Array.from(v));

  // ── kNN(1-NN, 1단계 의미 매칭과 동일한 max-cosine 방식) ──
  function knnPredict(q: Float32Array): string {
    let bestLabel = trainLabels[0];
    let bestScore = -Infinity;
    for (let i = 0; i < trainVectors.length; i++) {
      const score = cosineSimilarity(q, trainVectors[i]);
      if (score > bestScore) {
        bestScore = score;
        bestLabel = trainLabels[i];
      }
    }
    return bestLabel;
  }

  // ── 경량 분류기(프로덕션 코드 그대로) ──
  const classIndex = new Map(classes.map((c, i) => [c, i]));
  const samples = trainVectors.map((v, i) => ({ vector: v, classIndex: classIndex.get(trainLabels[i])! }));
  const model = await trainMultinomialLogistic({
    samples,
    classCount: classes.length,
    dimension: trainEmbed.dimension,
    maxEpochs: 300,
  });

  function classifierPredict(q: Float32Array): string {
    const probs = predictProbabilities(q, model.weights, model.bias, classes.length, trainEmbed.dimension);
    let best = 0;
    for (let i = 1; i < probs.length; i++) if (probs[i] > probs[best]) best = i;
    return classes[best];
  }

  let knnCorrect = 0;
  let clfCorrect = 0;
  dataset.testQueries.forEach((q, i) => {
    if (knnPredict(testVectors[i]) === q.intent) knnCorrect += 1;
    if (classifierPredict(testVectors[i]) === q.intent) clfCorrect += 1;
  });

  const n = dataset.testQueries.length;
  const knnAcc = (knnCorrect / n) * 100;
  const clfAcc = (clfCorrect / n) * 100;
  console.log(`kNN top-1: ${knnAcc.toFixed(1)}% (${knnCorrect}/${n})`);
  console.log(`분류기 top-1: ${clfAcc.toFixed(1)}% (${clfCorrect}/${n})`);
  console.log(`격차(분류기-kNN): ${(clfAcc - knnAcc).toFixed(1)}%p — 재검토 트리거(+5%p) ${clfAcc - knnAcc >= 5 ? '발동' : '미발동'}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
