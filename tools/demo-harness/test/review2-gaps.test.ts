// 시험 단계(2차) 추가 — 추적표에서 "자동화 가능한데 비어 있던" 항목을 메운다(하네스 소스 수정 0).
//   H-T31 자막 띠 대비 4.5:1 · 글자 24px 이상(AC-DH6-4 · AC-DX 상속) — assets/stage.css 토큰·#caption 규칙을 읽어 계산
//   H-T32 합성 음성 문장 불변식(VOICE_PHRASE) — 기대 문장 ∋ 핵심어 · 대체 문장에 '언제' 없음(핵심어 경로 불가 → 일치율 경로로만 통과)
//   H-T33 일치 판정 규칙 고정 — 일치율 ≥0.8 또는 (핵심어 전부 ∧ ≥0.5) · 핵심어 한 단어만 맞는 전사는 실패
//   H-T34 고객 전달 자산에 개발자 로컬 경로 0 — assets/*.html·css·js 에 드라이브 경로·'Team Source' 없음
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { VOICE_PHRASE } from '../src/data/dataset-full';
import { judgeTranscript, keywordsAllIn, matchRatio, KEYWORD_PATH_MIN_RATIO, MATCH_RATIO_THRESHOLD } from '../src/voice/match';

// 컴파일 산출물(dist/test)에서도 소스 트리의 assets 를 읽는다
const PKG_ROOT = join(__dirname, '..', '..');
const css = readFileSync(join(PKG_ROOT, 'assets', 'stage.css'), 'utf8');

function token(name: string): string {
  const m = css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`));
  assert.ok(m, `토큰 ${name} 없음`);
  return m[1];
}
function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test('H-T31: 자막 띠 글자색 대비 4.5:1 이상(본문 · 보조 · 알림 · 배지 글자) · 배지 테두리·표식은 3:1 이상', () => {
  const bg = token('--h-chrome-bg');
  for (const t of ['--h-chrome-text', '--h-chrome-muted', '--h-notice']) {
    assert.ok(contrast(token(t), bg) >= 4.5, `${t} on chrome-bg = ${contrast(token(t), bg).toFixed(2)}`);
  }
  // 배지(.badge): 글자는 상속(chrome-text) · 배경 badge-bg
  assert.ok(contrast(token('--h-chrome-text'), token('--h-badge-bg')) >= 4.5, '배지 글자');
  assert.ok(contrast(token('--h-accent'), token('--h-badge-bg')) >= 3, '배지 테두리');
  assert.ok(contrast(token('--h-accent'), bg) >= 3, '배지 표식');
});

test('H-T31: #caption 안 모든 글자 크기는 24px 이상(1920 기준 --u=1px) — 자막 본문 36 · 배지 28 · 알림 28 · 칩 24', () => {
  const sizes = [...css.matchAll(/(#caption[^{]*)\{[^}]*?font-size:\s*calc\((\d+)\s*\*\s*var\(--u\)\)/g)].map((m) => [m[1].trim(), Number(m[2])] as const);
  assert.ok(sizes.length >= 4, `#caption font-size 규칙 ${sizes.length}개(4개 이상 기대)`);
  for (const [sel, px] of sizes) assert.ok(px >= 24, `${sel}: ${px}px`);
  const body = sizes.find(([s]) => s.includes('.cap-body') && !s.includes('div'));
  assert.ok(body && body[1] >= 32, '자막 본문은 32px 이상');
});

test('H-T32: VOICE_PHRASE 불변식 — 기대 문장은 핵심어를 모두 포함 · 대체 문장에는 "언제"가 없다(핵심어 경로로 못 통과)', () => {
  assert.ok(keywordsAllIn(VOICE_PHRASE.expected, VOICE_PHRASE.keywords), '기대 문장 ∋ 핵심어');
  assert.ok(VOICE_PHRASE.keywords.includes('환불'));
  assert.ok(!VOICE_PHRASE.alternate.includes('언제'), '대체 문장에 "언제" 없음');
  assert.equal(keywordsAllIn(VOICE_PHRASE.alternate, VOICE_PHRASE.keywords), false, '대체 문장은 핵심어 전부 규칙을 못 채운다');
  // 그래도 대체 문장을 기대 문장으로 바꿔 판정하면(SV-03) 일치율 1.0 으로 통과한다 — 핵심어가 아니라 일치율 경로
  const j = judgeTranscript(VOICE_PHRASE.alternate, VOICE_PHRASE.alternate, VOICE_PHRASE.keywords);
  assert.equal(j.textOk, true);
  assert.equal(j.keywordsOk, false);
  assert.equal(j.ratio, 1);
  assert.ok(VOICE_PHRASE.expected.length <= 20, '기대 문장은 짧게(자막·인식 안정)');
});

test('H-T33: 일치 판정 규칙 고정 — (일치율 ≥ 0.8) ∨ (핵심어 전부 ∧ 일치율 ≥ 0.5)', () => {
  assert.equal(MATCH_RATIO_THRESHOLD, 0.8);
  assert.equal(KEYWORD_PATH_MIN_RATIO, 0.5);
  const kw = VOICE_PHRASE.keywords;
  // 정확 일치(띄어쓰기·문장부호 차이 흡수)
  assert.equal(judgeTranscript(VOICE_PHRASE.expected, '주문취소하면 환불은 언제되나요?', kw).textOk, true);
  // 핵심어 한 단어만 전사 — 일치율 하한 미달 · 핵심어 전부도 아님 → 실패(L-4)
  assert.equal(judgeTranscript(VOICE_PHRASE.expected, '환불', kw).textOk, false);
  // 핵심어 전부 + 일치율 0.5 이상 → 통과, 핵심어 전부 + 0.5 미만 → 실패
  const mid = judgeTranscript(VOICE_PHRASE.expected, '환불 언제 되나요 고객센터 번호 알려줘', kw);
  assert.equal(mid.keywordsOk, true);
  assert.equal(mid.textOk, mid.ratio >= KEYWORD_PATH_MIN_RATIO);
  const low = judgeTranscript(VOICE_PHRASE.expected, '환불 언제 ' + '가'.repeat(60), kw);
  assert.equal(low.keywordsOk, true);
  assert.ok(low.ratio < KEYWORD_PATH_MIN_RATIO);
  assert.equal(low.textOk, false);
  // 의미가 다른 오인식("반불 규정이")은 일치율도 핵심어도 못 채움
  assert.equal(judgeTranscript(VOICE_PHRASE.expected, '반불 규정이', kw).textOk, false);
  assert.ok(matchRatio('', '') === 1);
});

test('H-T34: 고객에게 보이는 자산(assets/*.html·css·js)에 개발자 로컬 경로·드라이브 문자 경로가 없다', () => {
  const dir = join(PKG_ROOT, 'assets');
  const bad: string[] = [];
  for (const f of readdirSync(dir)) {
    if (!/\.(html|css|js)$/.test(f)) continue;
    const text = readFileSync(join(dir, f), 'utf8');
    if (/Team Source/.test(text) || /\b[A-Za-z]:[\\/](?!\/)[^\s'"]*[\\/]/.test(text.replace(/https?:\/\/\S+/g, ''))) bad.push(f);
  }
  assert.deepEqual(bad, []);
});

// ★ 시험 단계(2차) 발견 결함 R3-1 — `file:` 접두 + 공백 포함 경로(이 저장소 폴더 "2. Team Source")는 isPathLike가 놓쳐
//   DATABASE_URL 공개값이 result.json·(고객 전달판 표)에 로컬 절대경로 그대로 실린다. 하네스 소스 수정은 시험 담당 범위 밖이라
//   `todo`로 둔다(실패해도 묶음 결과에 영향 0 · 수정되면 todo 표시를 지우면 된다).
import { publicOverrideValue } from '../src/report/public-value';
test('R3-1: DATABASE_URL(file:D:/공백 있는 경로)도 공개값에서 일반화된다', {}, () => {
  for (const v of ['file:D:/2. Team Source/Chat Bot/.demo-runs/x/demo.db', 'file:/home/u/a b/demo.db']) {
    const out = publicOverrideValue('DATABASE_URL', v);
    assert.ok(!/Team Source|\/home\//.test(out), `경로 노출: ${out}`);
  }
});
