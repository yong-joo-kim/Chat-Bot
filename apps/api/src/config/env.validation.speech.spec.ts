import { validate } from './env.validation';

const base = {
  DATABASE_URL: 'file:./dev.db',
  WIDGET_BASE_URL: 'http://localhost:5174',
  PUBLIC_API_BASE_URL: 'http://localhost:3000/api/v1',
};

/**
 * 음성 AI(No.32) 환경변수·운영 mock 교차 검사(voice-ai-설계.md §12.1 · §15.2 — `validate()`에 설정 객체를 직접 넘겨 동적 import 불필요).
 * DD-135(H-10): 운영(`NODE_ENV=production`) ∧ `SPEECH_ENABLED=true` ∧ `mock`(명시·기본값 모두) = 기동 실패.
 */
describe('validate() — 음성 AI 환경변수', () => {
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    warn.mockRestore();
    error.mockRestore();
  });
  const speechWarnings = () => warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('SPEECH_PROVIDER'));

  it('기본값(전부 미설정) — 꺼짐 · mock · 한도 기본값, 경고 0', () => {
    const cfg = validate({ ...base });
    expect(cfg).toMatchObject({
      SPEECH_ENABLED: false,
      SPEECH_PROVIDER: 'mock',
      SPEECH_STT_TIMEOUT_MS: 10000,
      SPEECH_MAX_AUDIO_BYTES: 1048576,
      SPEECH_MAX_CONCURRENCY: 2,
      SPEECH_HEALTH_CACHE_MS: 30000,
      SPEECH_SETTINGS_CACHE_TTL_MS: 60000,
      PUBLIC_SPEECH_RATE_LIMIT_IP_PER_MIN: 30,
      PUBLIC_SPEECH_RATE_LIMIT_SESSION_PER_MIN: 10,
    });
    expect(cfg.ML_WORKER_SPEECH_URL).toBeUndefined();
    expect(speechWarnings()).toHaveLength(0);
  });

  describe('운영 mock 교차 검사(DD-135 ②)', () => {
    it('운영 ∧ 켜짐 ∧ 공급자 미설정(기본 mock) → throw', () => {
      expect(() => validate({ ...base, NODE_ENV: 'production', SPEECH_ENABLED: 'true' })).toThrow(/운영 환경\(NODE_ENV=production\)에서 SPEECH_ENABLED=true이면 SPEECH_PROVIDER=local이 필요합니다/);
    });
    it('운영 ∧ 켜짐 ∧ mock 명시 → throw', () => {
      expect(() => validate({ ...base, NODE_ENV: 'production', SPEECH_ENABLED: 'true', SPEECH_PROVIDER: 'mock' })).toThrow(/SPEECH_PROVIDER=local/);
    });
    it('NODE_ENV 앞뒤 공백도 운영으로 본다', () => {
      expect(() => validate({ ...base, NODE_ENV: ' production ', SPEECH_ENABLED: 'true' })).toThrow();
    });
    it('운영 ∧ 켜짐 ∧ local → 통과', () => {
      expect(validate({ ...base, NODE_ENV: 'production', SPEECH_ENABLED: 'true', SPEECH_PROVIDER: 'local', ML_WORKER_SPEECH_URL: 'http://stt.internal:8102/' }).ML_WORKER_SPEECH_URL).toBe('http://stt.internal:8102');
    });
    it('운영 ∧ 꺼짐(미설정·false) → 통과(기본 설치 동작 불변)', () => {
      expect(() => validate({ ...base, NODE_ENV: 'production' })).not.toThrow();
      expect(() => validate({ ...base, NODE_ENV: 'production', SPEECH_ENABLED: 'false' })).not.toThrow();
      expect(() => validate({ ...base, NODE_ENV: 'production', SPEECH_ENABLED: 'false', SPEECH_PROVIDER: 'mock' })).not.toThrow();
    });
    it('비운영(development·test·미설정·대소문자 다른 값) ∧ 켜짐 ∧ mock → 통과 + 경고 1회', () => {
      for (const env of [{ NODE_ENV: 'development' }, { NODE_ENV: 'test' }, {}, { NODE_ENV: 'Production' }, { NODE_ENV: 'prod' }]) {
        warn.mockClear();
        expect(() => validate({ ...base, ...env, SPEECH_ENABLED: 'true' })).not.toThrow();
        expect(speechWarnings()).toHaveLength(1);
        expect(speechWarnings()[0]).toContain('mock');
      }
    });
    it('운영 ∧ 켜짐 ∧ local ∧ 주소 없음 → 기동은 한다(R-16) + 경고 1회', () => {
      expect(() => validate({ ...base, NODE_ENV: 'production', SPEECH_ENABLED: 'true', SPEECH_PROVIDER: 'local' })).not.toThrow();
      expect(speechWarnings()).toHaveLength(1);
      expect(speechWarnings()[0]).toContain('ML_WORKER_SPEECH_URL');
    });
  });

  describe('SPEECH_PROVIDER 오타 → 기동 실패(H-8)', () => {
    it.each(['cloud', 'Local', 'mok', ''])('"%s"', (value) => {
      expect(() => validate({ ...base, SPEECH_PROVIDER: value })).toThrow(/환경변수 검증 실패/);
    });
  });

  it('범위 밖 값은 기동 실패', () => {
    expect(() => validate({ ...base, SPEECH_STT_TIMEOUT_MS: '100' })).toThrow();
    expect(() => validate({ ...base, SPEECH_MAX_AUDIO_BYTES: '1' })).toThrow();
    expect(() => validate({ ...base, SPEECH_MAX_CONCURRENCY: '0' })).toThrow();
    expect(() => validate({ ...base, SPEECH_HEALTH_CACHE_MS: '10' })).toThrow();
    expect(() => validate({ ...base, SPEECH_SETTINGS_CACHE_TTL_MS: '10' })).toThrow();
  });

  it('boolean은 envBoolean — "false" 문자열이 true가 되지 않는다', () => {
    expect(validate({ ...base, SPEECH_ENABLED: 'false' }).SPEECH_ENABLED).toBe(false);
    expect(validate({ ...base, SPEECH_ENABLED: 'true', SPEECH_PROVIDER: 'local', ML_WORKER_SPEECH_URL: 'http://x:1' }).SPEECH_ENABLED).toBe(true);
  });

  it('NODE_ENV는 스키마 키가 아니다(결과 설정에 없다)', () => {
    expect(Object.keys(validate({ ...base, NODE_ENV: 'production' }))).not.toContain('NODE_ENV');
  });
});
