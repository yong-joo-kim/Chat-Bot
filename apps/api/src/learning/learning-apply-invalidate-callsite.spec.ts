import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * DD-55 인계 계약 K-1 회귀 방지(stats-learning-설계.md §10.3) — "`learning` 모듈에서
 * `DialogueBundleService.invalidate()`를 호출하는 곳은 `LearningApplyService` 1곳뿐이다."
 * `UnansweredQuestionsService`가 실수로 `bundleService`를 직접 주입받아 호출하게 되면
 * K-2(요청당 정확히 1회 호출)·K-4(appliedImmediately 하드코딩 금지)가 조용히 깨진다.
 * code-reviewer는 구현 단계에서 grep으로 1회 확인했을 뿐 자동 회귀 방지 장치가 없었다
 * (`common/auth/public-decorator-count.spec.ts`의 전수 스캔 선례를 재사용).
 *
 * 코드(JSDoc 주석 제외, 실제 호출문만) 기준으로 센다 — 이 계약을 설명하는 주석 자체에도
 * ".invalidate("라는 문자열이 등장하므로, 주석 줄은 스캔 대상에서 제외해야 오탐이 없다.
 */
describe('DD-55 K-1: learning 모듈의 invalidate() 호출은 LearningApplyService 1곳뿐이다', () => {
  it('apps/api/src/learning 소스(스펙 제외, 주석 제외) 전체에서 .invalidate( 호출은 정확히 1건이며 learning-apply.service.ts에 있다', () => {
    const occurrences: Array<{ file: string; count: number }> = [];

    function isCommentLine(line: string): boolean {
      const trimmed = line.trim();
      return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
    }

    function walk(dir: string): void {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.name.endsWith('.ts') || entry.name.endsWith('.spec.ts')) continue;
        const lines = readFileSync(full, 'utf-8').split('\n');
        let count = 0;
        for (const line of lines) {
          if (isCommentLine(line)) continue;
          const matches = line.match(/\.invalidate\(/g);
          if (matches) count += matches.length;
        }
        if (count > 0) occurrences.push({ file: full, count });
      }
    }
    walk(__dirname);

    const total = occurrences.reduce((sum, o) => sum + o.count, 0);
    expect(total).toBe(1);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0].file.replace(/\\/g, '/')).toMatch(/learning-apply\.service\.ts$/);
  });
});
