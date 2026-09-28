import { bodyObservedHash, countsTowardConvergence, hasLoginSignal, isRedirectOriginHash, isRedirectTargetHash, outOfScopeTargetHash, redirectLoginTargetHash, redirectOriginHash } from './observed-hash';
import { sha256Hex } from './content-fingerprint';

describe('observed-hash (pass 9 · H-1)', () => {
  describe('hasLoginSignal', () => {
    it.each([
      'https://a.example/docs/login',
      'https://a.example/member/loginForm.do',
      'https://a.example/docs/sign-in',
      'https://a.example/docs/signin?next=/x',
      'https://a.example/docs/SignIn',
      'https://a.example/sso/start',
      'https://a.example/oauth2/authorize',
      'https://a.example/auth/callback',
      'https://sso.example/anything',
      'https://login.corp.example/',
      'https://idp.corp.example/adfs/ls/',
      'https://a.example/cas/login',
    ])('신호 있음 — %s', (url) => {
      expect(hasLoginSignal(url)).toBe(true);
    });
    it.each([
      'https://a.example/docs/latest/',
      'https://a.example/docs/lesson-1/', // sso가 부분 문자열로 들어 있지만 토큰이 아니다
      'https://a.example/docs/authors/',
      'https://a.example/docs/casual/',
      'https://newdocs.example/docs/p1',
      'https://a.example/',
    ])('신호 없음 — %s', (url) => {
      expect(hasLoginSignal(url)).toBe(false);
    });
    // [pass 11 · L-A] 진짜 로그인 URL — 오탐을 줄이면서도 그대로 신호여야 한다.
    it.each([
      'https://a.example/sso/login',
      'https://a.example/cas/login',
      'https://a.example/auth/login',
      'https://a.example/oauth/authorize',
      'https://a.example/saml/sso',
      'https://a.example/login',
      'https://a.example/signin',
      'https://a.example/sign-in',
      'https://a.example/idp/',
      'https://a.example/sso/start',
      'https://a.example/auth-callback', // 문서 단어가 없는 이어진 조각은 종전대로 신호
      'https://a.example/auth.do',
      'https://a.example/signinForm', // signin 뒤에 g가 아닌 글자가 이어져도 신호(단어 경계를 뒤 영문자 전부로 넓히면 미탐이 된다)
      'https://a.example/user/signin.jsp',
      'https://a.example/member/sign_in',
      'https://a.example/member/%EB%A1%9C%EA%B7%B8%EC%9D%B8', // 인코딩된 한국어 로그인
    ])('[L-A] 진짜 로그인 URL은 신호 — %s', (url) => {
      expect(hasLoginSignal(url)).toBe(true);
    });
    it('[L-A] 미탐 — 한국어 로그인 경로 · 스프링 시큐리티 로그인 처리 경로', () => {
      expect(hasLoginSignal('https://a.example/member/로그인')).toBe(true);
      expect(hasLoginSignal('https://a.example/j_spring_security_check')).toBe(true);
      expect(hasLoginSignal('https://a.example/j_security_check')).toBe(true);
    });
    it.each([
      'https://a.example/docs/cas-studies/x', // cas 토큰 + 문서 단어
      'https://a.example/blog/designing-apis', // signin이 designing의 부분 문자열
      'https://a.example/tasks/assigning-work',
      'https://a.example/docs/signing-documents',
      'https://a.example/docs/sso-setup-guide',
      'https://a.example/docs/auth-guide',
      'https://a.example/docs/authentication-guide',
      'https://a.example/author/',
      'https://a.example/blog/design-in-practice', // sign-in이 design-in의 부분 문자열
      'https://a.example/docs/what-is-sso',
    ])('[L-A] 오탐 — 로그인 URL이 아닌 문서 경로는 신호 없음 — %s', (url) => {
      expect(hasLoginSignal(url)).toBe(false);
    });
    it('해석할 수 없는 URL은 신호 없음', () => {
      expect(hasLoginSignal('not a url')).toBe(false);
    });
  });

  it('본문이 비면(공백뿐 포함) 지문이 없다 · 있으면 sha256', () => {
    expect(bodyObservedHash('')).toBeUndefined();
    expect(bodyObservedHash('  \n ')).toBeUndefined();
    expect(bodyObservedHash('본문')).toBe(sha256Hex('본문'));
  });

  it('리다이렉트 원래 행 — 로그인 목적지는 RL:, 그 밖은 R:(분포에서 뺀다)', () => {
    expect(redirectOriginHash('https://a.example/docs/login', false)).toMatch(/^RL:[0-9a-f]{64}$/);
    expect(redirectOriginHash('https://a.example/docs/latest/', false)).toMatch(/^R:[0-9a-f]{64}$/);
    expect(redirectOriginHash('https://a.example/docs/latest/#x', false)).toBe(redirectOriginHash('https://a.example/docs/latest/', false)); // 정규화 뒤 같은 목적지는 같은 지문
  });

  it('[pass 11 · M-B] 로그인 목적지 원래 행(RL:)의 지문은 쿼리를 제외한다 — 페이지별 return 파라미터가 달라도 같은 지문(쿼리 허용 여부 무관)', () => {
    for (const allow of [true, false]) {
      expect(redirectOriginHash('https://a.example/login?next=%2Fdocs%2Fp1', allow)).toBe(redirectOriginHash('https://a.example/login?next=%2Fdocs%2Fp2', allow));
      expect(redirectOriginHash('https://a.example/login?next=%2Fdocs%2Fp1', allow)).toBe(redirectOriginHash('https://a.example/login', allow));
    }
    expect(redirectOriginHash('https://a.example/login?next=%2Fdocs%2Fp1', true)).toMatch(/^RL:[0-9a-f]{64}$/);
    expect(redirectOriginHash('https://a.example/login', true)).not.toBe(redirectOriginHash('https://a.example/sign-in', true)); // 경로가 다르면 다른 지문
    // 로그인이 아닌 목적지의 R: 표식은 종전대로 쿼리를 구분한다(분포에 세지 않는 표식 — 동작 변화 없음).
    expect(redirectOriginHash('https://a.example/docs/x?p=1', true)).not.toBe(redirectOriginHash('https://a.example/docs/x?p=2', true));
  });

  it('[pass 11 · M-B] 로그인 목적지 행(RD:) — 쿼리 제외 · 분포(분자·하한)에 세지 않는다', () => {
    const h = redirectLoginTargetHash('https://a.example/login?next=%2Fdocs%2Fp1');
    expect(h).toMatch(/^RD:[0-9a-f]{64}$/);
    expect(h).toBe(redirectLoginTargetHash('https://a.example/login?next=%2Fdocs%2Fp2'));
    expect(isRedirectTargetHash(h)).toBe(true);
    expect(isRedirectTargetHash('RL:abc')).toBe(false);
    expect(isRedirectTargetHash('abc')).toBe(false);
    expect(isRedirectTargetHash(null)).toBe(false);
    expect(countsTowardConvergence(h)).toBe(false);
    expect(isRedirectOriginHash(h)).toBe(false); // FULL_RESEND 대상 제외(원래 행 표식)에는 쓰지 않는다
  });

  it('범위 밖 목적지 — 로그인 신호가 있을 때만 X: (쿼리는 지문에서 제외)', () => {
    expect(outOfScopeTargetHash('https://sso.example/login?next=%2Fa')).toBe(outOfScopeTargetHash('https://sso.example/login?next=%2Fb'));
    expect(outOfScopeTargetHash('https://sso.example/login?next=%2Fa')).toMatch(/^X:/);
    expect(outOfScopeTargetHash('https://newdocs.example/docs/p1')).toBeUndefined();
  });

  it('원래 행 지문 판별 · 분포에 세는 지문 판별', () => {
    expect(isRedirectOriginHash('R:abc')).toBe(true);
    expect(isRedirectOriginHash('RL:abc')).toBe(true);
    expect(isRedirectOriginHash('X:abc')).toBe(false);
    expect(isRedirectOriginHash('abcdef')).toBe(false);
    expect(isRedirectOriginHash(null)).toBe(false);
    expect(countsTowardConvergence('R:abc')).toBe(false);
    expect(countsTowardConvergence('RL:abc')).toBe(true);
    expect(countsTowardConvergence('X:abc')).toBe(true);
    expect(countsTowardConvergence('abcdef')).toBe(true);
    expect(countsTowardConvergence(null)).toBe(false);
  });
});
