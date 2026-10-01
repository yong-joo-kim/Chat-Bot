// H-T14: 단건 지연 결정 규칙(경계값 200·201·1000·1001) · 백분위 · 반복 측정
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideEmbeddingTimeout, measureEmbedLatency, percentile } from '../src/measure/latency';

test('결정 규칙 경계값: <=200 유지, 201 -> 450, 1000 -> 2000, 1001 -> 2000 + 확인', () => {
  assert.deepEqual(decideEmbeddingTimeout(0), { timeoutMs: 300, action: 'keep' });
  assert.deepEqual(decideEmbeddingTimeout(119), { timeoutMs: 300, action: 'keep' });
  assert.deepEqual(decideEmbeddingTimeout(200), { timeoutMs: 300, action: 'keep' });
  assert.deepEqual(decideEmbeddingTimeout(201), { timeoutMs: 450, action: 'raised' });
  assert.deepEqual(decideEmbeddingTimeout(1000), { timeoutMs: 2000, action: 'raised' });
  assert.deepEqual(decideEmbeddingTimeout(1001), { timeoutMs: 2000, action: 'confirm' });
  assert.deepEqual(decideEmbeddingTimeout(5000), { timeoutMs: 2000, action: 'confirm' });
});

test('결정 규칙: 50ms 단위 올림 · 하한 400 · 상한 2000', () => {
  assert.equal(decideEmbeddingTimeout(210).timeoutMs, 450); // 420 -> 450
  assert.equal(decideEmbeddingTimeout(250).timeoutMs, 500);
  assert.equal(decideEmbeddingTimeout(333).timeoutMs, 700); // 666 -> 700
  assert.equal(decideEmbeddingTimeout(999).timeoutMs, 2000); // 1998 -> 2000
  for (const p of [201, 250, 400, 700, 1000]) {
    const t = decideEmbeddingTimeout(p).timeoutMs;
    assert.ok(t >= 400 && t <= 2000 && t % 50 === 0, `${p} -> ${t}`);
  }
});

test('결정 규칙: 측정 불가(NaN)는 2000 + 확인', () => {
  assert.deepEqual(decideEmbeddingTimeout(Number.NaN), { timeoutMs: 2000, action: 'confirm' });
});

test('백분위: 20개의 P95는 19번째 값, P50은 10번째 값', () => {
  const v = Array.from({ length: 20 }, (_, i) => i + 1);
  assert.equal(percentile(v, 0.95), 19);
  assert.equal(percentile(v, 0.5), 10);
  assert.equal(percentile([7], 0.95), 7);
  assert.ok(Number.isNaN(percentile([], 0.5)));
});

test('측정: 앞 3건을 버리고 20건으로 계산, 안정적이면 1회로 끝난다', async () => {
  const calls: string[] = [];
  const m = await measureEmbedLatency({
    baseUrl: 'http://unused',
    embedOnce: async (t) => {
      calls.push(t);
      return calls.length <= 3 ? 900 : 100 + calls.length; // 앞 3건은 느림(버려짐)
    },
  });
  assert.equal(calls.length, 23);
  assert.equal(m.rounds.length, 1);
  assert.equal(m.samples, 20);
  assert.ok(m.p95Ms <= 200, `P95 ${m.p95Ms}`);
  assert.deepEqual(decideEmbeddingTimeout(m.p95Ms), { timeoutMs: 300, action: 'keep' });
});

test('측정: 느린 라운드는 최대 3회까지 반복하고 마지막 라운드로 결정, 모든 라운드를 기록한다', async () => {
  let n = 0;
  const m = await measureEmbedLatency({
    baseUrl: 'http://unused',
    embedOnce: async () => {
      n++;
      return n <= 23 ? 700 : n <= 46 ? 400 : 150; // 1라운드 700, 2라운드 400, 3라운드 150
    },
  });
  assert.equal(m.rounds.length, 3);
  assert.deepEqual(m.rounds.map((r) => Math.round(r.p95Ms)), [700, 400, 150]);
  assert.equal(Math.round(m.p95Ms), 150);
});

test('측정: 끝까지 느리면 3라운드 후 마지막 값으로 결정(무한 반복 없음)', async () => {
  let n = 0;
  const m = await measureEmbedLatency({ baseUrl: 'http://unused', embedOnce: async () => (++n, 800) });
  assert.equal(m.rounds.length, 3);
  assert.equal(n, 69);
  assert.deepEqual(decideEmbeddingTimeout(m.p95Ms), { timeoutMs: 1600, action: 'raised' });
});

test('측정: 호출이 던지면 그대로 전파(호출자가 기동 실패로 처리)', async () => {
  await assert.rejects(measureEmbedLatency({ baseUrl: 'x', embedOnce: async () => { throw new Error('연결 거부'); } }), /연결 거부/);
});
