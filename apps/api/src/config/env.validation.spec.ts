import { validate } from './env.validation';

/**
 * `RAG_TIMEOUT_MS` 하한(120,000ms)·상한(300,000ms) 강제(FR-N2-26, AC-N2-14) — 코드가 값을
 * 보정한다는 사실 자체를 회귀 시험으로 고정한다("설정으로만 지킨다"는 약속은 회귀에 약하다).
 */
function baseEnv(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    DATABASE_URL: 'file:./test.db',
    WIDGET_BASE_URL: 'http://localhost:5174',
    PUBLIC_API_BASE_URL: 'http://localhost:3000/api/v1',
    ...overrides,
  };
}

describe('env.validation — validate() RAG_TIMEOUT_MS 보정(FR-N2-26, AC-N2-14)', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('AC-N2-14: 하한(120000ms) 미만이면 120000으로 자동 보정되고 경고 로그를 남긴다', () => {
    const result = validate(baseEnv({ RAG_TIMEOUT_MS: '30000' }));
    expect(result.RAG_TIMEOUT_MS).toBe(120_000);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('하한'));
  });

  it('상한(300000ms) 초과 시 300000으로 보정된다(경고 없이 조용히 클램프)', () => {
    const result = validate(baseEnv({ RAG_TIMEOUT_MS: '999999' }));
    expect(result.RAG_TIMEOUT_MS).toBe(300_000);
  });

  it('120000~300000 사이 값은 보정 없이 그대로 유지된다', () => {
    const result = validate(baseEnv({ RAG_TIMEOUT_MS: '150000' }));
    expect(result.RAG_TIMEOUT_MS).toBe(150_000);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('미설정 시 기본값 120000이며 하한과 동일해 보정이 발생하지 않는다', () => {
    const result = validate(baseEnv());
    expect(result.RAG_TIMEOUT_MS).toBe(120_000);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('AC-N4-1: RAG/임베딩 관련 환경변수를 하나도 설정하지 않아도 검증을 통과한다', () => {
    const result = validate(baseEnv());
    expect(result.RAG_BASE_URL).toBeUndefined();
    expect(result.EMBEDDING_BASE_URL).toBeUndefined();
  });

  it('필수 환경변수가 없으면 예외를 던진다(형식 검증은 그대로 유지)', () => {
    expect(() => validate({})).toThrow(/환경변수 검증 실패/);
  });
});

describe('env.validation — boolean 환경변수 명시 파싱(z.coerce.boolean 결함 회귀)', () => {
  const BOOL_VARS = [
    ['TRUST_PROXY', false],
    ['AUTH_COOKIE_SECURE', false],
    ['CLASSIFIER_ENABLED', false],
    ['VERSION_AUTO_SNAPSHOT_ENABLED', true],
    ['DEPLOY_SCHEDULE_ENABLED', true],
  ] as const;

  it.each(BOOL_VARS)('%s: "false"/"0"/" FALSE "는 false, "true"/"1"/"True"는 true로 파싱된다', (name) => {
    for (const v of ['false', '0', ' FALSE ']) expect(validate(baseEnv({ [name]: v }))[name]).toBe(false);
    for (const v of ['true', '1', 'True']) expect(validate(baseEnv({ [name]: v }))[name]).toBe(true);
  });

  it.each(BOOL_VARS)('%s: 미설정·빈 값이면 기본값(%s)이다', (name, def) => {
    expect(validate(baseEnv())[name]).toBe(def);
    expect(validate(baseEnv({ [name]: '' }))[name]).toBe(def);
  });

  it.each(BOOL_VARS)('%s: 허용되지 않은 값("yes")은 기동 시 검증 실패다', (name) => {
    expect(() => validate(baseEnv({ [name]: 'yes' }))).toThrow(/환경변수 검증 실패/);
  });
});

describe('env.validation — pass 6 Low-3 · KB_SYNC_LEASE_MS 최소값', () => {
  it('★ 제출 경로 최대 구간(재수집 60초 + 해석 30초 + 외부 전송 120초)보다 짧은 임대(60초)는 거부한다 — 최소 300초', () => {
    expect(() => validate(baseEnv({ KB_SYNC_LEASE_MS: '60000' }))).toThrow();
    expect(() => validate(baseEnv({ KB_SYNC_LEASE_MS: '299999' }))).toThrow();
  });
  it('300초 이상은 받아들이고 기본값은 600초다', () => {
    expect(validate(baseEnv({ KB_SYNC_LEASE_MS: '300000' })).KB_SYNC_LEASE_MS).toBe(300_000);
    expect(validate(baseEnv()).KB_SYNC_LEASE_MS).toBe(600_000);
  });
});

describe('env.validation — pass 7 N-10 · KB_SYNC_LEASE_MS 는 크롤 타임아웃 기준 최악 처리 구간보다 길어야 한다', () => {
  let errorSpy: jest.SpyInstance;
  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => errorSpy.mockRestore());

  it('★ 타임아웃 60초 · 임대 300초(최소값) → 파일 1요청(60초×4=240초)과 해석·전송 여유가 임대를 넘으므로 기동 실패', () => {
    expect(() => validate(baseEnv({ KB_CRAWL_TIMEOUT_MS: '60000', KB_SYNC_LEASE_MS: '300000' }))).toThrow(/KB_SYNC_LEASE_MS/);
  });
  it('임대 = 타임아웃×4 + 120초 이상이면 통과한다(60초 → 360초)', () => {
    expect(validate(baseEnv({ KB_CRAWL_TIMEOUT_MS: '60000', KB_SYNC_LEASE_MS: '360000' })).KB_SYNC_LEASE_MS).toBe(360_000);
    expect(() => validate(baseEnv({ KB_CRAWL_TIMEOUT_MS: '60000', KB_SYNC_LEASE_MS: '359999' }))).toThrow(/KB_SYNC_LEASE_MS/);
  });
  it('기본값(타임아웃 15초 · 임대 600초)과 타임아웃 15초 · 임대 300초는 그대로 통과한다(기본값 설정 변경 없음)', () => {
    expect(validate(baseEnv()).KB_SYNC_LEASE_MS).toBe(600_000);
    expect(validate(baseEnv({ KB_SYNC_LEASE_MS: '300000' })).KB_CRAWL_TIMEOUT_MS).toBe(15_000);
    expect(validate(baseEnv({ KB_CRAWL_TIMEOUT_MS: '60000' })).KB_SYNC_LEASE_MS).toBe(600_000); // 기본 임대 600초는 60초 타임아웃에도 충분
  });
  it('타임아웃 45초 · 임대 300초는 경계(45×4+120=300)라 통과한다', () => {
    expect(validate(baseEnv({ KB_CRAWL_TIMEOUT_MS: '45000', KB_SYNC_LEASE_MS: '300000' })).KB_SYNC_LEASE_MS).toBe(300_000);
  });
});
