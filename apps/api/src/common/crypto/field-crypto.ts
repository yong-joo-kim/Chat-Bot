import { Logger } from '@nestjs/common';
import type { EncryptedFieldId } from '@chat-bot/shared-types';
import { governanceRuntime } from '../governance/governance-runtime';
import { buildFieldAad } from './encrypted-fields';
import { isEnvelope, parseEnvelope } from './field-envelope';
import { fieldKeyProvider } from './env-key.provider';

const logger = new Logger('FieldCrypto');

/** 개봉 실패(키 없음·태그 불일치·손상) 시 필드에 대신 넣는 값 — 요청은 성공한다(FR-DG4-4). */
export const DECRYPT_FAILED_TEXT = '[복호화 실패]';

/**
 * 저장 직전 마지막 단계(금지어 → PII 마스킹 → **암호화**). 런타임 미설치·`encryptionEnabled=false`
 * ∧ 이미 봉투 형태가 아닌 입력이면 평문 그대로 반환한다(미설치 = 현행 동작 — FR-0-161).
 * 빈 문자열은 암호화하지 않는다(`sealField('')` === `''` — 소거값과 충돌하지 않게).
 */
export function sealField(field: EncryptedFieldId, rowId: string, plaintext: string): string {
  if (plaintext === '') return '';
  const runtime = governanceRuntime();
  const provider = fieldKeyProvider();

  if (runtime.encryptionEnabled) {
    const writeKeyId = provider.writeKeyId();
    if (!writeKeyId) return plaintext; // 기동 검사가 이 상태를 막아야 하지만 방어적으로 평문 유지
    return provider.aesGcmSeal(buildFieldAad(field, rowId), plaintext);
  }

  // 꺼짐 ∧ 키링 있음 ∧ 입력이 이미 봉투 형태 — 평문이 봉투로 오독되는 것을 막기 위해 그대로 봉인한다.
  if (provider.keyIds().length > 0 && isEnvelope(plaintext)) {
    const writeKeyId = provider.writeKeyId();
    if (writeKeyId) return provider.aesGcmSeal(buildFieldAad(field, rowId), plaintext);
  }

  return plaintext;
}

/**
 * 읽기 경로 전용. 키링이 없으면 파싱 없이 `stored` 그대로(모드 OFF 바이트 동일). 봉투가 아니면
 * 평문 그대로. 개봉 실패는 `DECRYPT_FAILED_TEXT` + 경고(필드·행 id·키 id만 — 평문 노출 0).
 */
export function openField(field: EncryptedFieldId, rowId: string, stored: string | null): string | null {
  if (stored === null || stored === '') return stored;
  const provider = fieldKeyProvider();
  if (provider.keyIds().length === 0) return stored;

  const parsed = parseEnvelope(stored);
  if (!parsed) return stored;

  try {
    return provider.aesGcmOpen(parsed.keyId, buildFieldAad(field, rowId), parsed.payload);
  } catch {
    logger.warn(`필드 복호화 실패: field=${field} rowId=${rowId} keyId=${parsed.keyId}`);
    return DECRYPT_FAILED_TEXT;
  }
}
