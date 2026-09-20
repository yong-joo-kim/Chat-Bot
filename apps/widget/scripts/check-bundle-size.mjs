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
