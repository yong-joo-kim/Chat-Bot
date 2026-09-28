import type { KbMetaResponse, KbRunFailureCode } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../constants/messages';

export type KbGovernanceViolation = Extract<KbRunFailureCode, 'GOVERNANCE_MASK_REQUIRED' | 'GOVERNANCE_RAW_FILE_NOT_ALLOWED'>;

/**
 * 서버 `governanceViolation()`(`apps/api/src/kb-sync/lib/governance-flags.ts`)과 같은 규칙을 클라이언트에서
 * 계산한다. 입력은 `GET /kb-sources/meta`의 `governanceMode`·`rawFileIngestAllowedByServer`와 소스의
 * `piiMask`·`allowRawFileIngest`뿐이다.
 *
 * 확실히 아는 경우에만 위반을 돌려준다 — 메타가 없거나(로딩·오류) 필요한 필드가 boolean/`'ON'`으로 확인되지
 * 않으면 `null`(모름)이라 버튼은 종전대로 활성이고 서버 409 배너가 폴백이다.
 * 판정 순서도 서버와 같다(마스킹 → 원본 파일).
 */
export function clientGovernanceViolation(
  meta: Pick<KbMetaResponse, 'governanceMode' | 'rawFileIngestAllowedByServer'> | null | undefined,
  source: { piiMask?: boolean; allowRawFileIngest?: boolean } | null | undefined,
): KbGovernanceViolation | null {
  if (!meta || !source) return null;
  if (meta.governanceMode !== 'ON') return null;
  if (source.piiMask === false) return 'GOVERNANCE_MASK_REQUIRED';
  if (source.allowRawFileIngest === true && meta.rawFileIngestAllowedByServer === false) return 'GOVERNANCE_RAW_FILE_NOT_ALLOWED';
  return null;
}

/**
 * 실행 버튼이 비활성인 이유를 보이는 텍스트로 알린다(색·툴팁만으로 전달하지 않음 — UIUX). 버튼은
 * `aria-describedby={id}`로 이 문단을 가리킨다. 문구는 실행 실패 코드 라벨을 재사용한다.
 */
export function KbGovernanceBlockedHint({ id, violation }: { id: string; violation: KbGovernanceViolation }): JSX.Element {
  return (
    <p id={id} className="field-hint field-hint--warning">
      <span aria-hidden="true">⚠</span> {MESSAGES.kbRuns.failureCodeLabel[violation]}
    </p>
  );
}
