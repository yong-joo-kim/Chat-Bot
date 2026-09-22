# ADR-0014 — 세션 기반 인증과 자격증명 보관 방식(불투명 토큰 · httpOnly 쿠키 · scrypt · CORS 경로 분기)

- **상태**: 채택 (Accepted)
- **일자**: 2026-09-21
- **결정자**: system-architect
- **관련**: `docs/requirements/security-audit.md` **J-1**, **J-2**, FR-12-1 ~ FR-12-15, FR-0-29, FR-U-2/U-6/U-9, NFR-S1 ~ S4, NFR-S9/S10, NFR-P2, AC-12A-1~14, AC-12B-2, AC-C-6, EX-12-1~11 / `ADR-0011 §5`(CORS는 인가 수단이 아니다) / `ADR-0009`(클라이언트 보관 상태와의 구분)
- **영향 범위**: `apps/api/prisma/schema.prisma`(`User`·`Session`), `apps/api/src/auth/**`, `apps/api/src/common/auth/lib/{cookie.ts,password-hash.ts}`, `apps/api/src/main.ts`(CORS), `apps/api/src/config/env.validation.ts`, `apps/web/src/api/client.ts`, `apps/web/.env`
- **세부 설계**: `docs/02-spec/security-audit-설계.md` §7

## 맥락

세 개 기능그룹(No.1~11)이 `main`에 병합되는 동안 인증은 일관되게 "No.12에서"로 유보되었다. 그 결과 **관리자 API 75개 핸들러가 전부 인증 없이 호출 가능**하며, 네트워크에 닿는 누구나 `POST /chatbots/:id/permanent-delete`로 챗봇을 영구 삭제할 수 있다. 이번 그룹이 시스템 최초의 인증 경계를 만든다.

결정해야 할 것이 네 가지다.

1. **세션인가 JWT인가** — 토큰을 서버가 보관할 것인가, 무상태로 서명만 검증할 것인가.
2. **토큰을 어떻게 브라우저에 전달하는가** — httpOnly 쿠키인가 `Authorization: Bearer`인가.
3. **비밀번호를 무엇으로 해시하는가** — 신규 네이티브 의존성(`bcrypt`/`argon2`)을 들일 것인가.
4. **CORS를 어떻게 바꾸는가** — 현재 `app.enableCors()`(전체 허용)는 쿠키 인증과 함께 쓸 수 없는데, **위젯이 의존하는 공개 API의 CORS 동작을 깨뜨리면 안 된다**(ADR-0011, FR-0-29).

네 번째가 특히 위험하다. CORS 설정은 파일 한 줄이지만, 잘못 바꾸면 **No.11 전체(공개 대화 API + 위젯)가 조용히 죽는다.**

## 결정

### 1. 서버 보관 불투명 세션 토큰 + `Session` 테이블. JWT 기각 (J-1)

- 토큰은 `randomBytes(32)`(256bit) base64url 문자열이며 **의미를 담지 않는다**(불투명).
- DB에는 **`sha256(token)` hex만** 저장한다. DB가 유출돼도 세션을 복원할 수 없다(NFR-S2).
- 수명은 **유휴 만료(기본 120분, 슬라이딩) + 절대 만료(기본 12시간, 갱신 불가)** 2중이다.

**세션 토큰에 scrypt를 쓰지 않는 이유**: 256bit 난수는 사전·무차별 대입 대상이 아니다. 저엔트로피 비밀(비밀번호)에는 느린 해시를, 고엔트로피 난수(세션 토큰)에는 빠른 해시를 쓰는 것이 표준 판단이다. 매 요청마다 scrypt를 돌리면 NFR-P1(가드 오버헤드 P95 20ms)을 즉시 위반한다.

### 2. httpOnly 쿠키 전달. Bearer 헤더 기각

```
Set-Cookie: cb_session=<opaque>; HttpOnly; SameSite=Lax; Path=/api; Secure(운영); Max-Age=<절대만료까지>
```

- `HttpOnly` — JS가 읽을 수 없어 XSS 1건이 전 계정 탈취로 번지지 않는다.
- `SameSite=Lax` — 크로스사이트 **POST/PATCH/DELETE에 전송되지 않는다.** 상태 변경 API가 전부 비-GET인 현재 구조(개발명세서 §4.1 "파괴적 동작의 GET 노출 금지")에서 **CSRF 토큰 없이 방어가 성립**한다.
- `Path=/api` — 위젯 전체화면 경로(`/c/:slug`)·정적 자산 요청에 쿠키가 실리지 않는다.
- **읽기는 자체 파서**(`common/auth/lib/cookie.ts`, 순수 함수)로 하고 `cookie-parser`를 도입하지 않는다. 쓰기는 Express 내장 `res.cookie()`를 쓴다.
- 쿠키를 만지는 지점은 **`AuthController` 1곳**이다. `AuthService`는 토큰 문자열만 반환한다(개발명세서 §2.1 — 서비스의 HTTP 개념 의존 금지).

> **CSRF 방어의 전제를 규약으로 못 박는다**: `SameSite=Lax`는 "상태 변경이 비-GET"일 때만 유효하다. 따라서 "파괴적 동작의 GET 노출 금지"는 스타일 규칙이 아니라 **보안 통제**이며, `code-reviewer`의 상시 점검 항목으로 승격한다(NFR-S9).

### 3. 비밀번호 해시는 Node 내장 `crypto.scrypt`

| 항목 | 값 |
|---|---|
| 파라미터 | `N=32768(2^15)`, `r=8`, `p=1`, `keylen=32`, **`maxmem=64MiB`** |
| 솔트 | `randomBytes(16)` |
| 저장 형식 | `scrypt$N=32768,r=8,p=1$<saltB64url>$<hashB64url>` |
| 비교 | `timingSafeEqual` |

- **`maxmem`을 반드시 넘긴다.** scrypt 메모리 사용량은 `128 × N × r = 32MiB`이고 Node 기본 `maxmem`이 정확히 32MiB라 **기본값으로는 `ERR_CRYPTO_INVALID_SCRYPT_PARAMS`가 발생한다.**
- **파라미터를 해시 문자열에 포함**해 향후 파라미터 상향 시 로그인 성공 시점에 재해싱할 수 있게 한다(FR-12-4).
- **계정 열거 방지**(FR-12-3): 이메일이 존재하지 않아도 **모듈 로드 시 1회 생성한 더미 해시**로 검증을 수행해 경로별 소요시간을 맞춘다. 매 요청 더미 해시를 새로 만들면 오히려 느려져 역방향 신호가 된다.

### 4. CORS는 **경로로 분기**한다 — ADR-0011 §5를 깨지 않는 유일한 방법

```
app.enableCors((req, cb) => {
  if (/^\/api\/(v1\/public\/|health)/.test(req.url))
    cb(null, { origin: '*', credentials: false });                       // 현행 100% 보존
  else if (adminOrigins.includes(req.headers.origin))
    cb(null, { origin: req.headers.origin, credentials: true });          // 관리자 콘솔만
  else
    cb(null, { origin: false });                                          // 동일 출처 전용(기본)
});
```

- **공개 경로(`/api/v1/public/*`, `/api/health`)는 현행과 완전히 동일한 헤더**를 낸다. 위젯은 임의 도메인의 호스트 페이지에서 동작해야 하므로 `*`가 필수다.
- 공개 API의 **인가는 여전히 `PublicOriginGuard`(서버 판정)** 가 한다. 이 delegate는 브라우저 상호운용 설정일 뿐 인가가 아니다 — **ADR-0011 §5의 원칙이 그대로 유지된다.**
- `ADMIN_WEB_ORIGIN` **미설정이 기본이며 이때는 동일 출처만 동작**한다. 이것이 권장 구성이다.
- Origin에 따라 응답 헤더가 달라지므로 **`Vary: Origin`** 을 포함한다.

**dev 구성**: `apps/web/vite.config.ts`에 **이미 `/api` → `localhost:3000` 프록시가 존재한다.** `apps/web/.env`의 `VITE_API_BASE_URL`을 `http://localhost:3000/api/v1` → **`/api/v1`** 로 바꾸면 dev가 동일 출처가 되어 CORS·`credentials` 문제가 애초에 발생하지 않는다. 운영(리버스 프록시 동일 출처)과 구성이 일치한다는 것이 더 큰 이득이다. **`apps/widget`의 `VITE_PUBLIC_API_BASE_URL`은 절대 바꾸지 않는다.**

### 5. MFA는 컬럼이 아니라 **판별 필드**로만 확장 지점을 남긴다 (J-2)

```ts
LoginResponseSchema = z.object({ status: z.literal('OK'), user: CurrentUserSchema });
```

- `User`에 `mfaSecret`류 컬럼을 **만들지 않는다**(쓰기 주체 없는 스키마 금지 — ADR-0004 선례).
- 향후 `{ status: 'MFA_REQUIRED', challengeId }` 분기를 **하위호환으로** 추가할 수 있게 `status` 판별 필드만 둔다. 지금은 리터럴 1종이라 프런트가 분기할 것이 없다.

## 근거

- **즉시 회수가 이 그룹의 수용기준이다.** AC-12B-8(역할 강등이 재로그인 없이 다음 요청부터 반영)·AC-12C-9(비활성화 즉시 401)·AC-12A-9(비밀번호 변경 시 다른 세션 무효화)는 전부 **서버가 세션을 끊을 수 있어야** 통과한다. 무상태 JWT로 이를 만족하려면 결국 **서버 측 무효화 목록(=세션 테이블)** 을 함께 둬야 하는데, 그러면 JWT의 유일한 장점인 무상태성이 사라지고 **두 개의 진실**(서명 + 블랙리스트)만 남는다.
- **세션을 DB에 두는 것은 확장성 원칙과 충돌하지 않는다.** 개발명세서 §5는 "단일 인스턴스 전제의 **서버 상태**는 인터페이스로 추상화"를 요구하는데, DB 테이블은 애초에 프로세스 로컬 상태가 아니다. 번들 캐시·레이트리밋 카운터(인메모리)와 달리 다중 인스턴스 전환 시 손댈 곳이 없다.
- **토큰 보관 위치에 안전한 선택지가 하나뿐이다.** `localStorage`는 XSS 1건으로 전 계정이 털리고, 메모리 보관은 새로고침마다 로그아웃되어 실사용이 불가능하다(S-2는 "브라우저를 닫았다 2시간 안에 열면 재로그인 없이"를 요구한다). httpOnly 쿠키가 두 문제를 동시에 푼다.
- **네이티브 의존성을 들이지 않는 것이 구축형에 유리하다.** 현재 신규 런타임 의존성은 `exceljs` 1건뿐이다. `bcrypt`/`argon2`는 네이티브 빌드(node-gyp, 파이썬, 컴파일러)를 요구하며, **온프레미스 설치 환경에서 빌드 실패는 설치 자체를 막는다.** `scrypt`는 OWASP 권장군에 속하고 Node 표준 라이브러리에 있다.
- **CORS를 통짜로 바꾸지 않는 이유**: 공개 API와 관리자 API는 **정반대의 요구**를 갖는다(전자는 임의 Origin 허용·무자격증명, 후자는 제한 Origin·자격증명). 하나의 전역 설정으로 둘을 동시에 만족시킬 수 없으므로 분기가 필수다. 분기 기준을 "경로"로 두면 **판정이 요청 데이터에 의존하지 않아** 테스트가 쉽고 DB 조회도 필요 없다.

## 대안과 트레이드오프

| 대안 | 기각 사유 |
|---|---|
| **JWT(무상태)** | 만료 전 회수 불가 → AC-12B-8/AC-12C-9/AC-12A-9를 만족할 수 없다. 블랙리스트를 붙이면 무상태성이 사라져 세션 테이블보다 복잡해진다 |
| **JWT + 짧은 만료 + refresh 토큰** | refresh 토큰을 서버가 보관해야 하므로 결국 세션 테이블이다. 토큰 2종·갱신 경합·회전 정책이 추가로 필요한데, 이 프로젝트는 **단일 관리자 콘솔**이라 얻는 것이 없다 |
| **`Authorization: Bearer` 헤더** | 토큰을 JS가 읽어야 한다 → `localStorage`(XSS 전면 노출) 또는 메모리(새로고침마다 로그아웃). S-2·NFR-S3 위반 |
| **`SameSite=Strict`** | 외부 링크로 콘솔에 진입하면 첫 요청에 쿠키가 실리지 않아 매번 로그인 화면을 본다. `Lax`로도 비-GET은 차단되므로 CSRF 방어는 동일하다 |
| **CSRF 토큰 이중화(Double Submit)** | `SameSite=Lax` + 전부 비-GET 구조에서 추가 방어 효과가 거의 없다. 토큰 발급·회전·multipart 경로 처리가 새 복잡도로 들어온다. 파괴적 동작을 GET으로 여는 순간 필요해지므로, **그 규약을 지키는 쪽**을 택했다 |
| **`bcrypt`/`argon2id`** | 네이티브 빌드 의존성. 온프레미스 설치 실패 위험 대비 이득이 작다. `argon2id`가 이론적으로 더 강하지만, 이 시스템의 위협 모델(내부 관리자 계정 수십 개)에서 scrypt와 실질 차이가 없다 |
| **`crypto.pbkdf2`** | 메모리 하드 함수가 아니라 GPU 병렬화에 취약하다. 같은 내장 모듈이라면 scrypt가 명백히 낫다 |
| **`passport` / `@nestjs/passport`** | 전략 추상화의 소비자가 1종(local)뿐이다. 의존성 2개와 개념(전략·직렬화·세션 미들웨어)을 들여오고 얻는 것이 없다 |
| **`express-session` + 스토어** | 세션 데이터를 DB에 JSON으로 밀어 넣는 구조라 `Session` 스키마를 우리가 통제할 수 없고, `revokedAt`·`absoluteExpiresAt` 같은 도메인 필드를 자연스럽게 둘 수 없다 |
| **CORS를 전역 `credentials: true` + Origin 반사로 통일** | 위젯이 임의 도메인에서 공개 API를 호출하지 못해 **No.11이 통째로 깨진다**(AC-P-11, AC-U-10) |
| **CORS delegate에서 DB로 Origin 조회** | ADR-0011 §5가 이미 기각했다 — 프리플라이트마다 DB 조회는 캐시를 강제하고, 그러면 `allowedOrigins` 변경의 즉시 반영(FR-11-10)이 깨진다 |
| **dev도 크로스오리진 유지(`localhost:3000` 직접 호출)** | `ADMIN_WEB_ORIGIN` 설정이 dev 필수가 되고, 운영(동일 출처)과 구성이 달라 "dev에서만 되는" 버그가 생긴다. **프록시는 이미 존재한다** |
| **MFA를 지금 도입** | TOTP 시크릿의 **암호화 저장 방식이 미결정**이다(NFR-S7: 채널 자격증명조차 저장하지 않기로 했다). 복구 코드 없이 도입하면 관리자 잠금 = 서비스 전면 중단. SMS/메일 발송 인프라도 없다 |

**감수하는 비용**

1. **매 요청 DB 조회 1회**(세션+사용자 조인). 유니크 인덱스 PK 조인이라 SQLite에서 1ms 미만이며 NFR-P1(20ms)에 여유가 크다. 캐시를 두지 않는 이유는 `security-audit-설계.md` §8.3.
2. **세션 테이블이 증가**한다. 로그인 시 해당 사용자의 만료 세션을 정리하고 조회 시 만료 판정을 하므로 무한 증가하지는 않지만, 정리 배치가 없어 **로그인하지 않는 사용자의 만료 세션은 남는다.** 행 크기가 작고(200B 내외) 사용자 수가 수십~수백 규모라 실질 문제가 아니다. 재검토 트리거는 Redis 전환(개발명세서 §6-4).
3. **`lastSeenAt` 갱신의 쓰기 증폭** — 매 요청 UPDATE는 SQLite 쓰기 락 경합을 만든다. 갱신 주기를 `유휴만료/10`(기본 12분)으로 두어 완화했고, AC-12A-8은 그보다 오래된 세션을 다루므로 통과한다.
4. **CORS delegate가 경로 문자열 정규식에 의존**한다 — `setGlobalPrefix('api')` + URI 버저닝(ADR-0003)이 바뀌면 함께 바뀌어야 한다. 정규식을 `main.ts` 1곳에 두고 주석으로 의존을 명시한다.
5. **MFA 부재**를 운영 문서에 명시한다. 부트스트랩 계정의 초기 비밀번호를 바꾸지 않은 채 운영 전환하는 실수는 `mustChangePassword` 강제로 구조적으로 막힌다(EX-12-9).

## 결과

- Prisma: `User`에 `passwordHash`·`status`·`mustChangePassword`·`failedLoginCount`·`lockedUntil`·`lastLoginAt`·`updatedAt` 추가, **`Session` 테이블 신설**(`tokenHash @unique`, `expiresAt`, `absoluteExpiresAt`, `revokedAt`).
- `apps/api/src/auth/`: `auth.controller.ts`(4 엔드포인트, 쿠키를 만지는 유일한 지점) / `auth.service.ts` / `session.service.ts` / `login-rate-limit.guard.ts` / `lib/{temporary-password.ts, session-expiry.ts}`.
- `apps/api/src/common/auth/lib/`: `cookie.ts`(파싱 순수 함수) / `password-hash.ts`(scrypt).
- `main.ts`: `app.enableCors()` → **경로 분기 delegate**. 공개 경로 응답 헤더는 변경 0.
- `ApiErrorCode` 추가: `UNAUTHENTICATED`·`SESSION_EXPIRED`·`ACCOUNT_DISABLED`·`INVALID_CREDENTIALS`·`ACCOUNT_LOCKED`·`PASSWORD_CHANGE_REQUIRED`·`PASSWORD_POLICY`.
- 환경변수 7종 추가(전부 선택·기본값 있음): `SESSION_IDLE_TIMEOUT_MIN`, `SESSION_ABSOLUTE_TIMEOUT_HOURS`, `LOGIN_MAX_FAILURES`, `LOGIN_LOCKOUT_MIN`, `LOGIN_RATE_LIMIT_IP_PER_MIN`, `AUTH_COOKIE_SECURE`, `ADMIN_WEB_ORIGIN`.
- `apps/web`: `.env`의 `VITE_API_BASE_URL` → `/api/v1`, `client.ts`의 `request()`·**`postForm()` 양쪽**에 `credentials: 'include'`.
- **`apps/widget` 수정 0줄.**
- `test-automation` 인계(우선순위 상위): ① AC-12A-2/3(계정 열거 방지 — 미존재 이메일과 틀린 비밀번호의 **응답 본문·상태코드 동일**) ② AC-12A-7(절대 만료가 슬라이딩으로 되살아나지 않음) ③ **AC-P-11/AC-C-6 — 공개 API 프리플라이트가 여전히 `*`를 반환하는지**(CORS 회귀) ④ AC-U-9(`postForm` 인증) ⑤ 응답·로그 어디에도 `passwordHash`·세션 토큰 원문이 없는지.
- `code-reviewer` 인계: ① 쿠키를 만지는 파일이 `auth.controller.ts` 1개인지 ② `scrypt` 호출에 `maxmem`이 있는지 ③ **파괴적 동작이 GET으로 노출되지 않았는지**(CSRF 방어 전제) ④ `main.ts` CORS 분기에 공개 경로가 빠지지 않았는지.
- **후속 Phase 인계**: MFA·SSO를 붙일 때는 이 ADR을 Supersedes하지 말고 **확장**한다 — `LoginResponse.status` 분기 추가 + 시크릿 암호화 저장 방식 ADR 신규 작성.
