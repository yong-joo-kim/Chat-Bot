// H-T18: 로드맵 정합(FR-DX0-1) — 끝 장면 로드맵이 `기능요구사항.md` 비고 열과 어긋나지 않는다(구현된 기능을 "시연 불가"로 쓰는 재발 방지)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROADMAP, ROADMAP_STATUS_LABEL, type RoadmapStatus } from '../src/data/roadmap';
import { buildRoadmapRows } from '../src/stage/roadmap-html';

const PKG = join(__dirname, '..', '..');
const REQ = readFileSync(join(PKG, '..', '..', 'docs', '01-requirements', '기능요구사항.md'), 'utf8');

/** `| 32 | ... |` 형태의 기능 행(표의 한 줄 전체). */
function featureRow(no: number): string {
  const line = REQ.split(/\r?\n/).find((l) => new RegExp(`^\\|\\s*${no}\\s*\\|`).test(l));
  assert.ok(line, `기능요구사항.md에 No.${no} 행이 없다`);
  return line!;
}

test('로드맵 6행: No.32 · 33 · 31 · 34 · 17 · 38 (고객이 먼저 물을 법한 순)', () => {
  assert.deepEqual(ROADMAP.map((r) => r.featureNo), [32, 33, 31, 34, 17, 38]);
});

test('상태 칩 어휘 4종만 — 일정을 암시하는 말(개발 중 · 곧 · 준비 중)은 쓰지 않는다', () => {
  assert.deepEqual(Object.values(ROADMAP_STATUS_LABEL).sort(), ['구현됨 · 확장판에서 시연 예정', '미착수', '요구사항 정리 중(미착수)', '운영 서버 확인 대기'].sort());
  const all = ROADMAP.map((r) => `${r.name} ${r.why}`).join(' ') + Object.values(ROADMAP_STATUS_LABEL).join(' ');
  for (const bad of ['개발 중', '곧 ', '출시 예정', '준비 중입니다']) assert.ok(!all.includes(bad), bad);
});

test('정합: 비고 열에 "구현 완료"가 있는 기능은 "시연 불가(미착수 등)"로 쓰지 않고, 없는 기능은 "구현됨"으로 쓰지 않는다', () => {
  for (const r of ROADMAP) {
    const implemented = /구현 완료/.test(featureRow(r.featureNo));
    if (implemented) assert.equal(r.status, 'IMPLEMENTED_DEMO_LATER' as RoadmapStatus, `No.${r.featureNo}는 구현이 끝났다`);
    else assert.notEqual(r.status, 'IMPLEMENTED_DEMO_LATER' as RoadmapStatus, `No.${r.featureNo}는 구현 완료가 아니다`);
  }
});

test('No.32(음성 AI)는 "구현됨 · 확장판에서 시연 예정"이고 "미착수"가 아니다(FR-DX0-1)', () => {
  const r = ROADMAP.find((x) => x.featureNo === 32)!;
  assert.equal(ROADMAP_STATUS_LABEL[r.status], '구현됨 · 확장판에서 시연 예정');
  assert.ok(!r.why.includes('미착수') && !r.why.includes('GPU'));
});

test('로드맵 행 HTML: 모든 행의 이름 · 번호 · 상태 칩이 데이터와 같고 외부 URL이 없다', () => {
  const html = buildRoadmapRows();
  assert.equal((html.match(/<li>/g) ?? []).length, ROADMAP.length);
  for (const r of ROADMAP) {
    assert.ok(html.includes(r.name) && html.includes(`No.${r.featureNo}`) && html.includes(ROADMAP_STATUS_LABEL[r.status]), r.name);
  }
  assert.ok(!html.includes('://'));
});

test('이유 문구는 한 줄(<= 38자)이고 일정·성능을 약속하지 않는다(FR-DH10-2)', () => {
  for (const r of ROADMAP) {
    assert.ok([...r.why].length <= 38, `${r.name}: ${[...r.why].length}자`);
    assert.ok(!/(\d+분기|\d+월 출시|예정입니다|빠르게|최고)/.test(r.why), r.name);
  }
});

test('assets/roadmap.html 은 행을 {{{ROAD_ROWS}}}로 받는다(문구 단일 원천 = data/roadmap.ts)', () => {
  const html = readFileSync(join(PKG, 'assets', 'roadmap.html'), 'utf8');
  assert.ok(html.includes('{{{ROAD_ROWS}}}'));
  assert.ok(!html.includes('아직 보여 드릴 수 없음'), '구현된 기능이 있으므로 "아직 보여 드릴 수 없음" 머리 문구를 쓰지 않는다');
  assert.ok(!/<span class="chip">[^<]*<\/span><\/li>/.test(html.replace(/\{\{\{ROAD_ROWS\}\}\}/, '')), '행 문구가 템플릿에 하드코딩돼 있으면 안 된다');
});
