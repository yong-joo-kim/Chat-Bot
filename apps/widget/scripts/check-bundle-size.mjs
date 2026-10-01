#!/usr/bin/env node
// widget.js gzip 크기 게이트(NFR-P5, AC-W-17, ADR-0012 §9.2). node 내장 zlib만 사용(의존성 0).
import { readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = path.resolve(__dirname, '../dist/widget.js');
const BUDGET_BYTES = 100 * 1024; // 100KB(gzip)

if (!existsSync(target)) {
  console.error(`✖ 빌드 산출물을 찾을 수 없습니다: ${target}`);
  process.exit(1);
}

const raw = readFileSync(target);
const gzipped = gzipSync(raw);
const rawKb = (raw.length / 1024).toFixed(2);
const gzipKb = (gzipped.length / 1024).toFixed(2);

if (gzipped.length > BUDGET_BYTES) {
  console.error(`✖ widget.js gzip 크기 초과: ${gzipKb}KB > 100KB (raw ${rawKb}KB)`);
  process.exit(1);
}

console.log(`✔ widget.js gzip 크기: ${gzipKb}KB (raw ${rawKb}KB) — 100KB 예산 이내`);

// [신규 No.32] 음성 AI 증가분 기록(설계서 §9.7 · NFR: gzip 증가 ≤7KB — PM 2026-10-01 상향, 실측 +6.17KB). 음성 도입 직전 기준선은 19,760바이트(19.30KB).
// 100KB 게이트와 달리 이 줄은 **기록·경고만** 한다(빌드를 실패시키지 않는다 — 초과 시 PM 결정 사안).
const BASELINE_BEFORE_VOICE_BYTES = 19760;
const VOICE_BUDGET_BYTES = 7 * 1024;
const delta = gzipped.length - BASELINE_BEFORE_VOICE_BYTES;
const deltaKb = (delta / 1024).toFixed(2);
console.log(
  delta <= VOICE_BUDGET_BYTES
    ? `✔ 음성 AI(No.32) gzip 증가분: +${deltaKb}KB — 7KB 예산 이내`
    : `⚠ 음성 AI(No.32) gzip 증가분: +${deltaKb}KB — 7KB 예산 초과(기록만 · 빌드는 통과)`,
);
