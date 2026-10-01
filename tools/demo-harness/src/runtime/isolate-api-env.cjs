// API 선적재 스크립트(`node -r`) — 설계 §13.1 · DHD-10 3.
// `@prisma/client`는 require 시점에 apps/api/.env를 process.env로 읽어 들인다. 먼저 require해 그 적재를 소진시킨 뒤,
// 하네스가 넘기지 않은 새 키를 지운다(apps/api/jest.isolate-env.js와 같은 기법). 제품 코드는 바꾸지 않는다.
// 지운 키의 "이름"만(값 X) stderr 한 줄로 남겨 보고서 외부 송신 점검표("선적재가 지운 키")의 근거로 쓴다.
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS 선적재 스크립트(node -r)는 require를 쓴다 */
'use strict';

const before = new Set(Object.keys(process.env));
const pkg = process.env.CBDEMO_API_PACKAGE_JSON;
if (pkg) {
  try {
    const { createRequire } = require('node:module');
    require(createRequire(pkg).resolve('@prisma/client'));
  } catch (e) {
    process.stderr.write('[cbdemo] @prisma/client 선적재 실패(무시): ' + (e && e.message ? e.message : String(e)) + '\n');
  }
}
const removed = [];
for (const k of Object.keys(process.env)) {
  if (!before.has(k)) {
    removed.push(k);
    delete process.env[k];
  }
}
process.stderr.write('[cbdemo] 선적재가 지운 .env 키 이름: ' + (removed.length > 0 ? removed.sort().join(',') : '(없음)') + '\n');
