import { judgeKeyUsage } from './key-usage-plan';

/**
 * ★ 키 사용 행 검사 판정(AC-DG3-4 · FR-DG4-9) — 지금까지 이 순수 함수를 직접 겨냥한 단위
 * 시험이 없었다(통합 시험 `data-governance-key-rotation.integration.spec.ts`가 부트스트랩
 * 전체 흐름으로 간접 검증할 뿐이다). test-automation 보강(2026-09-26).
 */
describe('judgeKeyUsage(No.45 §5.3) — 키 사용 행 검사 판정', () => {
  it('미지 키 id가 없으면(unknownKeyId=null) 통과다', () => {
    expect(judgeKeyUsage('HANDOFF_TEXT', null, 0)).toEqual({ ok: true });
  });

  it('미지 키 id가 있으면 실패하고, 필드·키 id·영향 행 수를 담는다(키 값은 담지 않는다)', () => {
    const result = judgeKeyUsage('HANDOFF_TEXT', 'k1', 42);
    expect(result).toEqual({ ok: false, field: 'HANDOFF_TEXT', unknownKeyId: 'k1', affectedRows: 42 });
    // 반환값에 키 바이트·base64 등 키 값 자체가 없다(NFR-DGS — 로그·오류에 키 값 노출 금지).
    expect(JSON.stringify(result)).not.toMatch(/[A-Za-z0-9+/]{40,}={0,2}/); // base64 32바이트 특유의 긴 문자열 부재
  });

  it('영향 행 수가 0이어도 미지 키 id가 있으면 실패다(존재 자체가 위험 신호)', () => {
    expect(judgeKeyUsage('SURVEY_TEXT_VALUE', 'zz', 0)).toEqual({ ok: false, field: 'SURVEY_TEXT_VALUE', unknownKeyId: 'zz', affectedRows: 0 });
  });
});
