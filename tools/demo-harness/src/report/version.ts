// playwright-core 버전(보고서 환경 정보) — 하네스 node_modules에서 읽는다(정확 버전 고정이라 package.json과 같다).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { harnessRoot } from '../config';

export function playwrightVersion(): string {
  try {
    return (JSON.parse(readFileSync(join(harnessRoot(), 'node_modules', 'playwright-core', 'package.json'), 'utf8')) as { version: string }).version;
  } catch {
    return '확인 못함';
  }
}
