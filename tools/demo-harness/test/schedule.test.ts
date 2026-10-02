// H-T3(시간 관리 계산부 · AC-DH4-2·4-3) · H-T4(예약 시각 계산) · 라이브 예약 C-2 생성(설계 §7.6 · DHD-8)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { delayLabel, dwellMs, remainingSec, selectSkips } from '../src/scenario/schedule';
import { ceilMinute, formatKstHm, historyScheduleTime, liveScheduleTime, pickValidScheduleTime } from '../src/data/schedule-times';
import { createLiveSchedule } from '../src/orchestrator/live-schedule';
import { ApiError, type ApiSession } from '../src/data/api-client';
import type { DatasetIds } from '../src/data/types';
import { customerOnprem10m } from '../src/presets/customer-onprem-10m';

// ── H-T3 ──
const S1 = customerOnprem10m.segments.find((s) => s.key === 's1')!;
const s1Candidates = S1.skipOrder.map((id) => ({ id, budgetSec: S1.steps.find((s) => s.id === id)!.budgetSec }));

test('지연 0·20·60·200초: 생략 순서대로 만회량이 지연 이상이 될 때까지만 고른다', () => {
  assert.deepEqual(selectSkips(0, 0, s1Candidates), []);
  // S1 생략 순서 S1-06(15) → S1-07(10) → S1-02(10) → S1-01(10)
  assert.deepEqual(selectSkips(20, 0, s1Candidates), ['S1-06', 'S1-07']);
  assert.deepEqual(selectSkips(60, 0, s1Candidates), ['S1-06', 'S1-07', 'S1-02', 'S1-01']);
  assert.deepEqual(selectSkips(200, 0, s1Candidates), ['S1-06', 'S1-07', 'S1-02', 'S1-01'], '후보가 바닥나면 거기까지(핵심은 절대 고르지 않는다)');
});

test('이미 생략해 만회한 시간은 다시 세지 않는다(후보에서는 이미 생략한 단계를 뺀다)', () => {
  const rest = s1Candidates.slice(1); // S1-06(15초)은 이미 생략
  assert.deepEqual(selectSkips(20, 15, rest), ['S1-07']);
  assert.deepEqual(selectSkips(15, 15, rest), []);
});

test('모든 구간의 생략 순서에 핵심 단계가 없다(AC-DH4-2: 핵심 생략 0)', () => {
  for (const seg of customerOnprem10m.segments) {
    for (const id of seg.skipOrder) {
      const st = seg.steps.find((s) => s.id === id);
      assert.ok(st && !st.core && st.skippable, `${seg.key}:${id}`);
    }
  }
});

test('남은 시간 유지(dwell)는 예산에서 실측을 뺀 값(음수 없음) · 지연 표식 규칙(ui-spec §2.4)', () => {
  assert.equal(dwellMs(15, 4_000), 11_000);
  assert.equal(dwellMs(15, 20_000), 0);
  assert.equal(delayLabel(15, 17.9), null, '예산+3초 이내는 지연 아님');
  assert.equal(delayLabel(15, 19), '지연 +0:04');
  assert.equal(delayLabel(100, 118), null, '예산의 20% 이내는 지연 아님');
  assert.equal(delayLabel(100, 130), '지연 +0:30');
  assert.equal(remainingSec(600, 700), 0);
});

// ── H-T4 ──
test('ceilMinute: 초·밀리초가 0이면 그대로, 아니면 다음 분 0초', () => {
  assert.equal(ceilMinute(new Date('2026-10-01T05:00:00.000Z')).toISOString(), '2026-10-01T05:00:00.000Z');
  assert.equal(ceilMinute(new Date('2026-10-01T05:00:00.001Z')).toISOString(), '2026-10-01T05:01:00.000Z');
  assert.equal(ceilMinute(new Date('2026-10-01T05:00:59.999Z')).toISOString(), '2026-10-01T05:01:00.000Z');
});

test('이력 예약 = ceilMinute(Pc + 5분 30초) · 라이브 예약 = ceilMinute(T0 + 6분)', () => {
  assert.equal(historyScheduleTime(new Date('2026-10-01T05:00:10.000Z')).toISOString(), '2026-10-01T05:06:00.000Z');
  assert.equal(liveScheduleTime(new Date('2026-10-01T05:00:00.000Z')).toISOString(), '2026-10-01T05:06:00.000Z');
  assert.equal(liveScheduleTime(new Date('2026-10-01T05:00:01.000Z')).toISOString(), '2026-10-01T05:07:00.000Z');
});

test('최소 5분(LEAD) 위반이면 다음 분으로 미루고, 끝내 못 찾으면 오류', () => {
  const now = new Date('2026-10-01T05:00:00.000Z');
  assert.equal(pickValidScheduleTime(new Date('2026-10-01T05:04:00.000Z'), now, []).toISOString(), '2026-10-01T05:05:00.000Z');
  assert.throws(() => pickValidScheduleTime(new Date('2026-10-01T04:00:00.000Z'), now, [], 0), /규칙을 만족하는 시각/);
});

test('KST 표시 HH:mm', () => {
  assert.equal(formatKstHm(new Date('2026-10-01T05:06:00.000Z')), '14:06');
});

// ── 라이브 예약 C-2 ──
function fakeSession(handlers: { get?: (path: string) => unknown; post?: (path: string, body: unknown) => unknown }): ApiSession {
  return {
    get: async (path: string) => ({ status: 200, body: handlers.get?.(path), headers: new Headers() }),
    post: async (path: string, body?: unknown) => ({ status: 200, body: handlers.post?.(path, body), headers: new Headers() }),
  } as unknown as ApiSession;
}
const IDS = { C: { id: 'c1' } } as unknown as DatasetIds;

test('C-2: 운영 = 기준, 스테이징 = 대상으로 예약·승인 요청·승인을 순서대로 호출한다', async () => {
  const calls: string[] = [];
  const admin1 = fakeSession({
    get: () => ({ prod: { versionId: 'vProd', versionNo: 2 }, staging: { versionId: 'vStage', versionNo: 3 } }),
    post: (path, body) => {
      calls.push(`a1 ${path}`);
      if (path.endsWith('/deploy-schedules')) {
        const b = body as { targetVersionId: string; previewedProdVersionId: string; acknowledgeWarnings: boolean; scheduledAt: string };
        assert.equal(b.targetVersionId, 'vStage');
        assert.equal(b.previewedProdVersionId, 'vProd');
        assert.equal(b.acknowledgeWarnings, true);
        return { id: 'sch1' };
      }
      return { id: 'req1' };
    },
  });
  const admin2 = fakeSession({ post: (path, body) => { calls.push(`a2 ${path}`); assert.deepEqual(body, { acknowledgeWarnings: true }); return {}; } });
  const r = await createLiveSchedule({ admin1, admin2, ids: IDS, now: () => new Date('2026-10-01T05:00:00.000Z'), log: () => undefined });
  assert.equal(r.status, 'CREATED');
  assert.equal(r.scheduleId, 'sch1');
  assert.equal(r.scheduledAt, '2026-10-01T05:06:00.000Z');
  assert.equal(r.targetVersionId, 'vStage');
  assert.deepEqual(calls, ['a1 /chatbots/c1/deploy-schedules', 'a1 /chatbots/c1/environment/approval/requests', 'a2 /chatbots/c1/environment/approval/requests/req1/approve']);
});

test('C-2: 스테이징이 없으면 FAILED(던지지 않는다 — 장면 5가 이력 화면으로 대체)', async () => {
  const admin1 = fakeSession({ get: () => ({ prod: { versionId: 'v', versionNo: 1 }, staging: null }) });
  const r = await createLiveSchedule({ admin1, admin2: admin1, ids: IDS, log: () => undefined });
  assert.equal(r.status, 'FAILED');
  assert.match(r.error ?? '', /스테이징/);
});

test('C-2: 서버가 시각 규칙 위반(400)이면 다음 분으로 한 번 다시 시도한다', async () => {
  let attempts = 0;
  const admin1 = {
    get: async () => ({ status: 200, body: { prod: { versionId: 'p', versionNo: 1 }, staging: { versionId: 's', versionNo: 2 } }, headers: new Headers() }),
    post: async (path: string, body?: unknown) => {
      if (path.endsWith('/deploy-schedules')) {
        attempts++;
        if (attempts === 1) throw new ApiError('시각 규칙', 400, 'VALIDATION_FAILED', 'POST', path, {});
        assert.equal((body as { scheduledAt: string }).scheduledAt, '2026-10-01T05:07:00.000Z');
        return { status: 200, body: { id: 'sch2' }, headers: new Headers() };
      }
      return { status: 200, body: { id: 'req2' }, headers: new Headers() };
    },
  } as unknown as ApiSession;
  const admin2 = fakeSession({ post: () => ({}) });
  const r = await createLiveSchedule({ admin1, admin2, ids: IDS, now: () => new Date('2026-10-01T05:00:00.000Z'), log: () => undefined });
  assert.equal(r.status, 'CREATED');
  assert.equal(attempts, 2);
});
