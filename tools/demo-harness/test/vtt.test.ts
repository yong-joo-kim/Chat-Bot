// H-T10: WebVTT 생성(시각 형식 · 순서 · NOTE · 겹침 0 · 최소 2초 · 일시정지 큐 · 시연 안내 접두 · 배지 NOTE)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CaptionTimeline, formatVttTime, MIN_CUE_MS } from '../src/capture/vtt';

const REC = 1_000_000;

test('시각 형식 HH:MM:SS.mmm', () => {
  assert.equal(formatVttTime(0), '00:00:00.000');
  assert.equal(formatVttTime(61_234), '00:01:01.234');
  assert.equal(formatVttTime(3_723_005), '01:02:03.005');
  assert.equal(formatVttTime(-5), '00:00:00.000');
});

test('큐 시각 = 표시한 시각 - 녹화 시작 시각, 다음 자막이 나타날 때까지 유지(빈 시간 없음)', () => {
  const t = new CaptionTimeline(REC);
  t.addCaption({ atMs: REC + 5_000, stepId: 'S0-01', lines: ['첫 자막'] });
  t.addCaption({ atMs: REC + 20_000, stepId: 'S0-02', lines: ['둘째 자막'], notice: '안내 문구' });
  const cues = t.cues(REC + 35_000);
  assert.deepEqual(cues.map((c) => [c.id, c.startMs, c.endMs]), [
    ['S0-01', 5_000, 20_000],
    ['S0-02', 20_000, 35_000],
  ]);
  assert.deepEqual(cues[1].text, ['둘째 자막', '[시연 안내] 안내 문구']);
});

test('큐는 겹치지 않고 각 큐는 2초 이상이다(너무 짧으면 늘리고 다음 큐를 뒤로 민다)', () => {
  const t = new CaptionTimeline(REC);
  t.addCaption({ atMs: REC + 1_000, stepId: 'S1-01', lines: ['a'] });
  t.addCaption({ atMs: REC + 1_500, stepId: 'S1-02', lines: ['b'] });
  t.addCaption({ atMs: REC + 2_000, stepId: 'S1-03', lines: ['c'] });
  const cues = t.cues(REC + 10_000);
  for (let i = 0; i < cues.length; i++) {
    assert.ok(cues[i].endMs - cues[i].startMs >= MIN_CUE_MS, cues[i].id);
    if (i > 0) assert.ok(cues[i].startMs >= cues[i - 1].endMs, `${cues[i].id} 겹침`);
  }
});

test('녹화 시작 전에 표시된 자막은 0초로 맞춘다', () => {
  const t = new CaptionTimeline(REC);
  t.addCaption({ atMs: REC - 500, stepId: 'S0-01', lines: ['x'] });
  assert.equal(t.cues(REC + 5_000)[0].startMs, 0);
});

test('일시정지는 "잠시 멈춤" 큐, 재개 뒤 자막이 이어진다', () => {
  const t = new CaptionTimeline(REC);
  t.addCaption({ atMs: REC + 1_000, stepId: 'S2-01', lines: ['진행'] });
  t.addPause(REC + 6_000);
  t.addResume(REC + 16_000);
  t.addCaption({ atMs: REC + 16_000, stepId: 'S2-02', lines: ['재개'] });
  const cues = t.cues(REC + 30_000);
  assert.deepEqual(cues.map((c) => c.text[0]), ['진행', '잠시 멈춤', '재개']);
  assert.equal(cues[1].startMs, 6_000);
  assert.equal(cues[1].endMs, 16_000);
});

test('대체 화면 큐 ID는 단계 ID-fallback, 줄 수는 3줄 이하', () => {
  const t = new CaptionTimeline(REC);
  t.addCaption({ atMs: REC, stepId: 'S5-07', lines: ['예약 기록 화면입니다', '둘째', '셋째'], notice: '준비 단계 기록', kind: 'fallback' });
  const [c] = t.cues(REC + 10_000);
  assert.equal(c.id, 'S5-07-fallback');
  assert.ok(c.text.length <= 3);
});

test('VTT 문자열: 헤더 · 구간 NOTE · 배지 NOTE · 큐 ID와 시각 줄', () => {
  const t = new CaptionTimeline(REC);
  t.addSegment(REC + 1_000, '장면 3/7', '통계와 대시보드');
  t.addCaption({ atMs: REC + 1_300, stepId: 'S3-02', lines: ['방금 나눈 대화가 바로 집계됩니다'], notice: '지난 14일 그래프는 시연용 과거 데이터입니다' });
  t.setBadges('S3-02', ['사내 보관', '감사 기록']);
  const vtt = t.build(REC + 20_000);
  const lines = vtt.split('\n');
  assert.equal(lines[0], 'WEBVTT');
  assert.ok(lines.includes('Kind: captions') && lines.includes('Language: ko'));
  const noteIdx = lines.indexOf('NOTE 장면 3/7 통계와 대시보드');
  const cueIdx = lines.indexOf('S3-02');
  assert.ok(noteIdx > 0 && noteIdx < cueIdx, '구간 NOTE가 큐 앞에 있어야 한다');
  assert.ok(lines.includes('NOTE 배지: 사내 보관, 감사 기록'));
  assert.equal(lines[cueIdx + 1], '00:00:01.300 --> 00:00:20.000');
  assert.ok(lines.includes('[시연 안내] 지난 14일 그래프는 시연용 과거 데이터입니다'));
});

test('영상 길이와 마지막 큐: 공연 시간 ± 10초 안에서 끝난다(AC-DH6-2 계산부)', () => {
  const t = new CaptionTimeline(REC);
  t.addCaption({ atMs: REC + 30_000, stepId: 'S0-01', lines: ['시작'] });
  const showEnd = REC + 30_000 + 600_000;
  const cues = t.cues(showEnd);
  assert.equal(cues[cues.length - 1].endMs, showEnd - REC);
});
