import { normalizeText } from '@chat-bot/shared-types';
import {
  ExistingNameValueRecord,
  conflictsToRowErrors,
  findSynonymConflicts,
  planNameValueImport,
} from './import-planner';
import type { ParsedNameValueRow } from './import-row-parser';

/**
 * M2 리뷰 수정 — 키워드 대량업로드 동의어 충돌 시 검증 리포트(`errors[]`)와 실제 커밋 결과가
 * 어긋나지 않는지 검증한다(`keywords.service.ts` `importCommit`이 묶음 전체를 스킵하는 기준과
 * `conflictsToRowErrors`가 오류로 보고하는 범위가 항상 일치해야 한다).
 */
describe('conflictsToRowErrors (M2 — 묶음 전체 스킵과 검증 리포트 일치)', () => {
  it('충돌이 없는 동의어 행까지 포함해 같은 묶음의 모든 생존 행을 SYNONYM_CONFLICT로 보고한다', () => {
    const parsedRows: ParsedNameValueRow[] = [
      { row: 1, name: '음료', value: '커피' }, // 다른 키워드와 충돌
      { row: 2, name: '음료', value: '주스' }, // 그 자체로는 충돌 없음 — 같은 묶음이라 함께 스킵되어야 함
    ];
    const existing: ExistingNameValueRecord[] = [
      { id: 'other-1', name: '커피', nameNormalized: normalizeText('커피'), values: [] },
    ];

    const plan = planNameValueImport(parsedRows, []);
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0].values).toEqual(['커피', '주스']);
    expect(plan.items[0].sourceRows).toEqual([1, 2]);

    const conflicts = findSynonymConflicts(plan.items, existing);
    expect(conflicts).toHaveLength(1);

    const rowErrors = conflictsToRowErrors(conflicts, parsedRows, plan.items);

    // 리뷰에서 지적된 버그: 기존에는 '커피' 행만 오류로 보고되고 '주스' 행은 "오류 없음"으로
    // 보고됐지만, 커밋 시점에는 묶음 전체(주스 포함)가 스킵됐다. 수정 후에는 두 행 모두 보고되어야 한다.
    expect(rowErrors.map((e) => e.row).sort()).toEqual([1, 2]);
    expect(rowErrors.every((e) => e.code === 'SYNONYM_CONFLICT')).toBe(true);

    // 비충돌 값(주스)의 메시지는 "그룹 전체 스킵"임을 명시해야 한다(UIUX §7 — 원인+해결방법).
    const juiceError = rowErrors.find((e) => e.row === 2);
    expect(juiceError?.message).toContain('그룹');
  });

  it('충돌이 없는 묶음의 행은 오류로 보고하지 않는다', () => {
    const parsedRows: ParsedNameValueRow[] = [
      { row: 1, name: '과일', value: '사과' },
      { row: 2, name: '과일', value: '바나나' },
    ];
    const plan = planNameValueImport(parsedRows, []);
    const conflicts = findSynonymConflicts(plan.items, []);
    expect(conflicts).toHaveLength(0);

    const rowErrors = conflictsToRowErrors(conflicts, parsedRows, plan.items);
    expect(rowErrors).toHaveLength(0);
  });

  it('파일 내 중복 행(sourceRows에서 제외됨)은 충돌 오류와 중복 집계되지 않는다', () => {
    const parsedRows: ParsedNameValueRow[] = [
      { row: 1, name: '음료', value: '커피' },
      { row: 2, name: '음료', value: '커피' }, // 파일 내 중복 — duplicatedRows로 집계, sourceRows에는 없음
      { row: 3, name: '음료', value: '녹차' },
    ];
    const existing: ExistingNameValueRecord[] = [
      { id: 'other-1', name: '커피', nameNormalized: normalizeText('커피'), values: [] },
    ];

    const plan = planNameValueImport(parsedRows, existing);
    expect(plan.duplicatedRows).toBe(1);
    expect(plan.items[0].sourceRows).toEqual([1, 3]); // 2행(중복)은 제외

    const conflicts = findSynonymConflicts(plan.items, existing);
    const rowErrors = conflictsToRowErrors(conflicts, parsedRows, plan.items);

    // 충돌 오류는 살아남은 행(1, 3)에만 표시되고, 2행은 duplicatedRows 쪽에서만 집계되어야
    // skippedRows = duplicatedRows + errors.length 공식이 이중 계산 없이 정확해진다.
    expect(rowErrors.map((e) => e.row).sort()).toEqual([1, 3]);
    const impliedSkippedRows = plan.duplicatedRows + rowErrors.length;
    expect(impliedSkippedRows).toBe(3); // 파일의 3개 행 전부가 최종적으로 스킵됨
  });
});
