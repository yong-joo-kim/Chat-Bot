import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * AC-DC3-4 자동 부분(deep-clustering-설계.md §20.5·§20.7) — 품질 측정 보고서의 필수 항목 존재 검사만 한다.
 * 수치 합격 판정은 수동 게이트(PM 확정 전까지 "측정 기록 존재 + 결정론 일치").
 */
describe('군집 품질 보고서 필수 항목(AC-DC3-4)', () => {
  const dir = __dirname;
  const reports = readdirSync(dir).filter((f) => /^clustering-quality_.*\.md$/.test(f));

  it('보고서가 1건 이상 있다', () => {
    expect(reports.length).toBeGreaterThan(0);
  });

  it.each(reports)('%s — 머리 항목(일자·장비·OS·명령·modelId·algorithmVersion·데이터셋·조건)과 핵심 지표·결정론 절이 있다', (file) => {
    const text = readFileSync(join(dir, file), 'utf8');
    for (const key of ['일자', '장비', 'OS', '명령', 'modelId', 'algorithmVersion', '데이터셋', '조건']) {
      expect(text).toMatch(new RegExp(`\|\s*${key}\s*\|`));
    }
    expect(text).toMatch(/순도/);
    expect(text).toMatch(/ARI/);
    expect(text).toMatch(/결정론/);
  });
});
