import { randomBytes } from 'node:crypto';
import { buildEnvelope, decryptWithKey, encryptWithKey, isEnvelope, parseEnvelope } from './field-envelope';

describe('field-envelope(No.45) — 봉투 포맷·AES-256-GCM 왕복', () => {
  const key = randomBytes(32);
  const otherKey = randomBytes(32);

  it('왕복: 봉인 후 개봉하면 원문과 같다(한글·이모지·결합 문자 포함)', () => {
    const samples = ['안녕하세요 상담원입니다 😀', 'A'.repeat(500), '한글🙂영어123!@#', 'é'];
    for (const plaintext of samples) {
      const aad = 'handoff_messages:text:row-1';
      const payload = encryptWithKey(key, aad, plaintext);
      const envelope = buildEnvelope('k1', payload);
      expect(isEnvelope(envelope)).toBe(true);
      expect(envelope.startsWith('enc:v1:k1:')).toBe(true);

      const parsed = parseEnvelope(envelope);
      expect(parsed).not.toBeNull();
      expect(parsed!.keyId).toBe('k1');
      const opened = decryptWithKey(key, aad, parsed!.payload);
      expect(opened).toBe(plaintext);
    }
  });

  it('빈 문자열은 봉투 판별 대상이 아니다(isEnvelope=false)', () => {
    expect(isEnvelope('')).toBe(false);
    expect(parseEnvelope('')).toBeNull();
  });

  it('평문은 parseEnvelope가 null을 반환한다(접두 없음)', () => {
    expect(parseEnvelope('그냥 평문입니다')).toBeNull();
    expect(isEnvelope('그냥 평문입니다')).toBe(false);
  });

  it('잘못된 키로 개봉하면 예외(AC-DG3-2 근거 — AAD·태그 검증 실패)', () => {
    const aad = 'handoff_messages:text:row-1';
    const payload = encryptWithKey(key, aad, '원문');
    expect(() => decryptWithKey(otherKey, aad, payload)).toThrow();
  });

  it('AAD가 다르면(행이 바뀌면) 개봉이 실패한다 — 암호문을 다른 행에 복사해 붙이는 공격 방지', () => {
    const payload = encryptWithKey(key, 'handoff_messages:text:row-1', '원문');
    expect(() => decryptWithKey(key, 'handoff_messages:text:row-2', payload)).toThrow();
  });

  it('손상된 payload(태그 변조)는 개봉이 실패한다', () => {
    const aad = 'handoff_messages:text:row-1';
    const payload = encryptWithKey(key, aad, '원문');
    const tampered = Buffer.from(payload);
    tampered[tampered.length - 1] ^= 0xff;
    expect(() => decryptWithKey(key, aad, tampered)).toThrow();
  });

  it('parseEnvelope는 keyId 형식이 잘못되면 null(영소문자·숫자 1~8자만 허용)', () => {
    expect(parseEnvelope('enc:v1:BAD-ID:AAAA')).toBeNull();
    expect(parseEnvelope('enc:v1::AAAA')).toBeNull();
  });

  it('매 호출마다 IV가 무작위라 같은 평문도 암호문이 달라진다(빈도 분석 방지)', () => {
    const aad = 'handoff_messages:text:row-1';
    const a = encryptWithKey(key, aad, '반복되는 문장');
    const b = encryptWithKey(key, aad, '반복되는 문장');
    expect(a.equals(b)).toBe(false);
  });
});
