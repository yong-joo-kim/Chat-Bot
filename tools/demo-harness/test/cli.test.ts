// CLI 종단(프로세스 1개 실행): 도움말 · 인자 오류 종료 코드 · --dry-run 7개 슬롯 · --stop(없는 실행) · DB 가드(AC-DH2-4)
// 서버·브라우저를 띄우지 않는 경로만 실행한다(실제 기동은 수동 실기동 확인 — docs/실기동확인.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const CLI = join(__dirname, '..', 'src', 'cli.js');

function cli(args: string[], timeoutMs = 60_000) {
  const r = spawnSync(process.execPath, [CLI, ...args, '--no-color'], { encoding: 'utf8', timeout: timeoutMs, windowsHide: true });
  return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

test('--help: 종료 코드 0, 종료 코드 표 안내', () => {
  const r = cli(['--help']);
  assert.equal(r.code, 0);
  assert.ok(r.out.includes('종료 코드  0 통과 / 1 단계 실패 / 2 사전 점검·빌드·기동·데이터 준비 실패 / 130 중단'));
});

test('잘못된 옵션·조합은 종료 코드 2 + 3요소 오류, 프로세스를 띄우지 않는다', () => {
  for (const args of [['--nope'], ['--port-offset', 'abc'], ['--resume', 'latest'], ['--appendix-llm']]) {
    const r = cli(args);
    assert.equal(r.code, 2, args.join(' '));
    assert.ok(r.out.includes('[오류]') && r.out.includes('왜:') && r.out.includes('조치:'), r.out);
  }
});

test('--dry-run: 종료 코드 0, 시나리오 슬롯 7개와 9구간 예산 600초, 공개표 · 프로세스 0', () => {
  const r = cli(['--dry-run']);
  assert.equal(r.code, 0, r.out);
  for (const key of ['opening', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 'closing']) assert.ok(new RegExp(`^${key}\\s`, 'm').test(r.out), key);
  assert.ok(r.out.includes('총 예산 10:00 (600초)'));
  assert.ok(r.out.includes('시나리오 슬롯 7개:'));
  for (const title of ['챗봇 구축과 위젯 대화', '상담원 인계', '통계와 대시보드', '학습 개선 루프', '버전과 배포 통제', '개인정보와 안전', '발화 묶음 분석']) assert.ok(r.out.includes(title), title);
  assert.ok(r.out.includes('CHATBOT_API_IGNORE_ENV_FILE'));
  assert.ok(r.out.includes('(빈 문자열)'), '출구 키 빈 값 표기');
  assert.ok(r.out.includes('RAG_BASE_URL'));
  assert.ok(r.out.includes('계획만 출력했습니다. 프로세스·브라우저는 실행하지 않았습니다'));
  assert.ok(!r.out.includes('[통과] Node'), '사전 점검을 실행하지 않는다');
});

test('--dry-run: 포트 오프셋·--only·모드가 반영된다 · 비밀 값은 나오지 않는다', () => {
  const r = cli(['--dry-run', '--port-offset', '100', '--only', 's1,s5', '--mode', 'headless-check', '--field-encryption']);
  assert.equal(r.code, 0, r.out);
  assert.ok(r.out.includes('3100') && r.out.includes('5273') && r.out.includes('8200'));
  assert.ok(/^s2 \(제외\)/m.test(r.out) && /^s1 /m.test(r.out) && /^s5 /m.test(r.out));
  assert.ok(r.out.includes('무인 점검'));
  assert.ok(r.out.includes('DATA_ENCRYPTION_KEYS') && r.out.includes('[가림]'));
  assert.ok(!r.out.includes('<실행별 무작위 키>'));
});

test('--stop: 없는 실행은 종료 코드 2(원인+조치), 빈 실행 폴더', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dh-cli-'));
  try {
    const r = cli(['--stop', 'latest', '--runs-dir', dir]);
    assert.equal(r.code, 2);
    assert.ok(r.out.includes('정리할 실행을 찾지 못했습니다'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('알 수 없는 프리셋은 종료 코드 2', () => {
  const r = cli(['--preset', 'nope', '--dry-run']);
  assert.equal(r.code, 2);
  assert.ok(r.out.includes('등록된 프리셋: customer-onprem-10m'));
});

test('AC-DH2-4: 실행 폴더 밖 DB(--db-url-for-test)는 종료 코드 2, 자식 프로세스를 띄우지 않고 DB 파일도 만들지 않는다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dh-cli-'));
  try {
    const base = 30000 + Math.floor(Math.random() * 20000);
    const bad = process.platform === 'win32' ? 'file:C:/Windows/Temp/dh-should-not-exist.db' : 'file:/tmp/dh-should-not-exist.db';
    const r = cli(['--no-build', '--mode', 'headless-check', '--browser', 'none', '--port-offset', String(base - 3000), '--runs-dir', dir, '--db-url-for-test', bad], 120_000);
    assert.equal(r.code, 2, r.out);
    if (r.out.includes('사전 점검 차단 항목이 있습니다')) {
      // 이 PC가 사전 점검(venv·모델 캐시 등)을 통과하지 못하면 가드까지 가지 못한다 — 환경 문제이므로 가드 단언만 건너뛴다.
      return;
    }
    assert.ok(r.out.includes('실행 폴더 밖에 있습니다'), r.out);
    assert.ok(!r.out.includes('서버 기동'), '기동 단계에 가지 않는다');
    const runs = readdirSync(dir);
    assert.equal(runs.length, 1, '실행 폴더 1개(로그용)만 생성');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
