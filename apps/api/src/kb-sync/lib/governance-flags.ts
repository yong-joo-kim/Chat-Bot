/**
 * [No.43 pass 8 · PM 결정 2026-09-28] 거버넌스 모드 ON에서 소스가 **지금** 허용되지 않는 개인정보 관련 설정을 가졌는가(순수 — 설계 §10 · AC-KB6-2·3).
 *
 * 저장(등록·수정) 시점 검증(`KbSourcesService.assertGovernanceFlags`)은 "이번에 바꾸는 값"만 본다 — 모드를 켜기 **전에** 마스킹을 끄거나 원본 파일 전달을 켜 저장한 소스는 모드를 켠 뒤에도
 * 그대로 원문을 비마스킹으로 적재한다(문서 1건 삭제 API가 없어 외부로 나간 원문은 되돌릴 수 없다 — K-1). 그래서 **실행 시작 시**와 **적재 제출 직전**에 같은 규칙으로 저장된 값을 다시 본다.
 * 반환값은 저장 검증이 쓰는 `details[].message`와 같은 이름이며 그대로 실행 수준 실패 코드(`KbRunFailureCode`)이기도 하다.
 */
export type GovernanceViolation = 'GOVERNANCE_MASK_REQUIRED' | 'GOVERNANCE_RAW_FILE_NOT_ALLOWED';

export interface GovernanceEnv {
  /** `DATA_GOVERNANCE_MODE === 'ON'`. */
  governanceOn: boolean;
  /** `KB_ALLOW_RAW_FILE_INGEST` — 서버 운영자가 거버넌스 ON에서도 원본 파일 전달을 허용했는가. */
  rawFileAllowedByServer: boolean;
}

export function governanceViolation(env: GovernanceEnv, source: { piiMask: boolean; allowRawFileIngest: boolean }): GovernanceViolation | null {
  if (!env.governanceOn) return null;
  if (source.piiMask === false) return 'GOVERNANCE_MASK_REQUIRED';
  if (source.allowRawFileIngest === true && !env.rawFileAllowedByServer) return 'GOVERNANCE_RAW_FILE_NOT_ALLOWED';
  return null;
}

/** 사용자에게 보이는 원인 + 해결 방법(UIUX §7) — 실행 시작 거부 응답에 쓴다. */
export function governanceViolationMessage(v: GovernanceViolation): string {
  return v === 'GOVERNANCE_MASK_REQUIRED'
    ? '거버넌스 모드에서는 개인정보 마스킹을 끌 수 없습니다. 소스를 수정해 마스킹을 켜 주세요.'
    : '거버넌스 모드에서는 서버 설정(KB_ALLOW_RAW_FILE_INGEST) 없이 원본 파일 전달을 쓸 수 없습니다. 소스를 수정해 원본 파일 전달을 끄거나 서버 운영자에게 허용을 요청해 주세요.';
}

/** 실행 시작 거부 응답의 `details[].field`. */
export function governanceViolationField(v: GovernanceViolation): 'piiMask' | 'allowRawFileIngest' {
  return v === 'GOVERNANCE_MASK_REQUIRED' ? 'piiMask' : 'allowRawFileIngest';
}
