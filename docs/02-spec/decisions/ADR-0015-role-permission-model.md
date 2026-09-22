# ADR-0015 — 권한 모델의 코드 상수화와 fail-closed 전역 가드

- **상태**: 채택 (Accepted)
- **일자**: 2026-09-21
- **결정자**: system-architect
- **관련**: `docs/requirements/security-audit.md` **J-6**, **J-7**, FR-0-24, FR-0-25, FR-12-16 ~ FR-12-23, FR-12-30, NFR-S5 ~ S7, NFR-M2, AC-12B-1~13, AC-C-4, EX-12-12~18, 부록 A(전수 감사) / `ADR-0004`(쓰기 주체·수용기준 없는 구조 금지) / `ADR-0006`(zod enum 단일 소스)
- **영향 범위**: `packages/shared-types/src/security.ts`, `apps/api/src/common/auth/**`, `apps/api/src/app.module.ts`, 기존 11개 컨트롤러(`@UseGuards` 제거), `apps/web/src/context/AuthContext`
- **세부 설계**: `docs/02-spec/security-audit-설계.md` §4.1, §8

## 맥락

Phase 1~3에서 `@RequirePermission('...')` 데코레이터를 **미리 부착**해 왔다. 전수 조사 결과 **11개 컨트롤러 · 75개 핸들러 · 9종 권한 문자열**이 부착돼 있으나, 세 가지 문제가 있다.

| # | 현재 상태 | 위험 |
|---|---|---|
| ① | `PermissionGuard.canActivate()`가 무조건 `true`를 반환한다 | 관리자 API 전부가 무방비 |
| ② | 권한 문자열 9종이 **어디에도 정의돼 있지 않다**(시그니처가 `permission: string`) | 오타가 타입 검사를 통과한다. 가드를 켜는 순간 오타 1건 = 해당 API 영구 403 |
| ③ | 가드가 **컨트롤러마다 `@UseGuards`로 개별 부착**돼 있다(11곳) | 신규 컨트롤러가 빠뜨리면 그 모듈만 조용히 무방비가 된다 |

여기서 결정해야 할 것은 두 가지다.

1. **권한 체계를 DB에 둘 것인가 코드에 둘 것인가** — `Role`/`Permission` 테이블을 만들어 관리자가 커스텀 역할을 정의하게 할 것인가(개발명세서 §3 엔터티 표가 그렇게 예고해 뒀다), 아니면 역할 3종을 고정하고 매핑을 코드 상수로 둘 것인가.
2. **가드를 어떻게 부착할 것인가** — 지금처럼 컨트롤러별로 opt-in 할 것인가, 전역 등록 후 공개 경로만 opt-out 할 것인가.

## 결정

### 1. 역할 3종 고정 + 역할→권한 매핑은 **코드 상수**. `Role`/`Permission` 테이블을 만들지 않는다 (J-6)

```ts
// packages/shared-types/src/security.ts
export const RoleName   = z.enum(['ADMIN', 'EDITOR', 'VIEWER']);      // 기존 유지
export const Permission = z.enum([ /* 14종 */ ]);
export const ROLE_PERMISSIONS: Record<RoleName, readonly Permission[]> = { VIEWER: [...], EDITOR: [...], ADMIN: [...] };
export function hasPermission(role: RoleName, permission: Permission): boolean;
```

| 권한 | 부착 | VIEWER | EDITOR | ADMIN |
|---|---:|:---:|:---:|:---:|
| `chatbot:read` / `dialogue:read` / `channel:read` / `simulation:read` | 32 | ✓ | ✓ | ✓ |
| `chatbot:write` / `dialogue:write` / `channel:write` / `chatbot:delete` | 42 | | ✓ | ✓ |
| `chatbot:purge` | 1 | | | ✓ |
| `user:read` / `user:write` / `security:read` / `security:write` / `audit:read` | 신규 | | | ✓ |

- **매핑 상수는 `packages/shared-types`에 둔다**(DD-39). 프런트도 같은 개념으로 메뉴·버튼을 판정해야 하며, 두 벌이 되면 반드시 어긋난다.
- 단, **프런트는 `ROLE_PERMISSIONS`를 재계산하지 않고 `GET /auth/me`가 반환한 `permissions[]`를 쓴다.** 상수는 서버가 그 목록을 만드는 근거이고, **판정의 최종 권위는 언제나 서버**다(NFR-S6). `GET /roles`도 같은 상수를 그대로 반환해 "상수 소스가 서버"임을 보장한다(FR-12-21).
- **기존 75곳의 데코레이터 값은 한 글자도 바꾸지 않는다.** 부록 A가 지적한 불일치 2건(A-2 `DELETE /chatbot-groups/:id`가 `chatbot:write`, A-3 `GET /stats/dashboard`가 `chatbot:read`)도 그대로 둔다 — 이번 매핑에서 **동작 차이가 0**이고, 값 변경은 75곳 재검토의 신호탄이 된다.
- **권한 명명 규칙을 명문화한다**: `<도메인>:<동작>`. 새 도메인이 생기면 이 규칙으로 추가한다(부록 A-7이 확인한 기존 패턴).
- **사용자 그룹(조직) 테이블도 만들지 않는다**(J-7). 그룹의 실질 목적 ①그룹 단위 권한 부여는 역할이 이미 수행하고, ②그룹별 챗봇 접근 제한은 **멀티테넌시**여서 75개 핸들러 전부의 스코프 필터와 404 규약을 바꿔야 한다.

### 2. `@RequirePermission`의 인자 타입을 `Permission` 유니온으로 좁힌다

```ts
export const RequirePermission = (permission: Permission): MethodDecorator & ClassDecorator => ...
```

오타는 **빌드 실패**로 드러난다(AC-12B-9, EX-12-13). 기존 75곳의 문자열이 전부 유니온에 존재해야 타입 검사가 통과하므로, **유니온이 곧 전수 검증**이다.

### 3. `PermissionGuard`를 `APP_GUARD`로 전역 등록한다 (fail-closed)

`AppModule`에 `{ provide: APP_GUARD, useClass: PermissionGuard }`를 등록하고 **11개 컨트롤러의 `@UseGuards(PermissionGuard)`를 제거**한다. 등록 지점이 1곳이 되어 "가드를 깜빡한 신규 컨트롤러"가 존재할 수 없다.

**판정 순서**

```
① @Public()                          → 통과
② 쿠키 없음/형식 오류                → 401 UNAUTHENTICATED
③ 세션 미존재/만료/revoked           → 401 SESSION_EXPIRED
④ user.status !== 'ACTIVE'           → 401 ACCOUNT_DISABLED
⑤ mustChangePassword (예외 경로 제외) → 403 PASSWORD_CHANGE_REQUIRED
⑥ @RequirePermission(p) 불충족        → 403 FORBIDDEN (+ PERMISSION_DENIED 이력)
⑦ 데코레이터 없음                    → 인증만 요구하고 통과
```

- **⑦이 중요하다.** 데코레이터를 빠뜨린 신규 핸들러는 "누구나 호출 가능"이 아니라 "최소한 로그인은 필요"가 된다. 실수의 기본값이 **열림이 아니라 닫힘**이다(EX-12-14).
- **⑥은 리소스 조회보다 먼저다**(FR-12-22, AC-12B-13). NestJS 실행 순서가 `미들웨어 → 가드 → 인터셉터 → 파이프 → 핸들러`이므로 **구조적으로 보장**된다. 존재하지 않는 ID에 대한 권한 없는 요청은 `404`가 아니라 `403`이다. 기존 "교차 챗봇 접근은 404"(FR-0-9)는 권한 통과 후의 서비스 계층 규칙이라 충돌하지 않는다.
- **응답 본문에 요구 권한 문자열을 넣지 않는다**(FR-12-23, AC-12B-7). 내부 권한 체계를 노출하지 않는다. 서버 로그와 `AuditLog.summary`에는 남긴다.
- **역할을 세션에 굳히지 않는다**(FR-12-17). 매 요청 현재 사용자 레코드로 판정하며 캐시를 두지 않는다 → 역할 강등이 **재로그인 없이 다음 요청부터** 반영된다(AC-12B-8).

### 4. `@Public()` opt-out은 **정확히 5곳**

| # | 경로 | 근거 |
|---|---|---|
| 1 | `GET /api/health` | 인증을 요구하면 오케스트레이터가 재시작 루프에 빠진다 |
| 2 | `GET /api/v1/public/chatbots/:slug/config` | 최종 사용자 대상. `PublicRateLimitGuard`+`PublicOriginGuard`가 보호(ADR-0011) |
| 3 | `POST /api/v1/public/chatbots/:slug/messages` | 동일 |
| 4 | `POST /api/v1/auth/login` | 인증을 얻는 경로가 인증을 요구할 수 없다 |
| **5** | **`POST /api/v1/auth/logout`** | 요구사항 FR-12-20의 4곳에서 **1곳 늘린다.** FR-12-8이 "이미 만료된 세션으로 호출해도 `204`(멱등)"를 명시했는데 인증을 요구하면 만료 세션 로그아웃이 `401`이 되어 요구사항을 만족할 수 없다. 로그아웃은 **세션을 파괴만** 하므로 인증 없이 호출해도 공격자가 얻는 것이 없고(쿠키 보유자가 자기 세션을 지울 뿐), 프런트가 "세션 만료 → 로그아웃 버튼 → 오류 토스트"라는 모순된 UX를 갖지 않는다 |

- **`@Public()`은 클래스가 아니라 핸들러에 부착**한다. 부착 단위가 섞이면 개수 고정 테스트(AC-C-4)가 의미를 잃는다. 공개 대화 컨트롤러도 핸들러 2곳에 각각 부착한다.
- **AC-C-4의 고정 개수를 4 → 5로 갱신**한다(`test-automation` 인계).

## 근거

- **권한은 이미 코드에 하드코딩돼 있다.** `@RequirePermission('chatbot:purge')`는 소스에 박힌 문자열이다. 권한 목록을 DB로 옮겨도 "새 권한 추가"는 여전히 코드 수정이 필요하므로, 테이블은 **유연성의 착시**만 만들고 "DB의 권한 ↔ 코드의 데코레이터" 동기화라는 정합성 부담을 새로 만든다. 게다가 DB에서 삭제된 권한 문자열을 데코레이터가 계속 요구하면 **해당 API가 영구 403**이 된다 — 테이블이 오히려 새로운 장애 모드를 만든다.
- **소비하는 수용기준이 없다.** "관리자가 커스텀 역할을 만든다"는 시나리오는 기준 목록 No.12의 설명("회원(그룹)관리, 권한관리")에서 도출되지 않으며, 요구사항의 어떤 AC도 이를 검증하지 않는다. **쓰기 주체·수용기준 없는 구조는 만들지 않는다**(ADR-0004, DD-20).
- **이미 단일 소스가 있다.** `RoleName` zod enum과 Prisma `User.role String`은 개발명세서 §3.1의 "enum은 DB String + zod 단일 소스" 규약을 이미 따르고 있다. 권한 매핑을 같은 파일에 두면 **일관성이 확장**될 뿐 새 개념이 늘지 않는다.
- **되돌리기 쉽다.** 매핑이 상수 1곳이므로, 커스텀 역할이 실제로 필요해지는 시점(No.45 규제산업 거버넌스)에 테이블로 승격하는 비용은 "상수를 읽던 곳이 DB를 읽게 하는 것"뿐이다. 반대 방향(테이블 → 상수)이 훨씬 비싸다.
- **fail-closed가 이 그룹의 존재 이유다.** 이번 그룹은 "인증을 깜빡한 결과"를 수습하는 그룹이다(요구사항 §1.1). 같은 실수가 반복될 수 있는 구조(컨트롤러별 opt-in)를 그대로 두고 구현만 채우는 것은 근본 원인을 남기는 것이다. **실수의 기본값이 닫힘**이어야 한다.
- **`@Public()` 개수를 테스트로 고정하는 이유**: 인가 우회는 "추가된 코드"가 아니라 "추가된 예외"로 발생한다. 예외의 개수를 자동 검증하면 리뷰가 놓쳐도 CI가 잡는다.

## 대안과 트레이드오프

| 대안 | 기각 사유 |
|---|---|
| **`Role`/`Permission` 테이블 + 관리 UI** | 권한 문자열이 코드에 하드코딩된 상태에서는 반쪽 유연성이다. 정합성 검증 부담과 "DB에서 지운 권한 = 영구 403" 장애 모드를 새로 만든다. 소비하는 AC가 없다 |
| **`User`에 권한 배열을 직접 부여**(역할 없이) | 사용자마다 권한이 달라져 "이 사람이 뭘 할 수 있나"를 화면·감사에서 설명할 수 없다. 최소 권한 검토도 불가능해진다 |
| **역할에 계층(상속) 도입**(ADMIN ⊃ EDITOR ⊃ VIEWER를 코드로 표현) | `ROLE_PERMISSIONS` 상수 정의에서 스프레드로 이미 표현된다. 별도 상속 메커니즘은 개념만 늘린다 |
| **권한을 유니온이 아니라 `const` 객체 + `keyof`** | zod enum이 이미 값 제약의 단일 소스 규약이다(ADR-0006). 런타임 검증(`/roles` 응답 스키마)까지 한 번에 얻는다 |
| **가드 유지(컨트롤러별 opt-in) + 코드리뷰 규율** | 규율은 잊힌다. 이 그룹 자체가 "미뤄둔 것을 잊은" 결과다(요구사항 §1.1). 구조로 막는 편이 싸다 |
| **전역 가드 + `@Public()` 대신 경로 화이트리스트 배열** | 배열과 라우트가 분리돼 리팩터링 시 어긋난다. 데코레이터는 핸들러 옆에 있어 함께 움직인다 |
| **`mustChangePassword`를 인터셉터에서 판정** | 가드에서 판정해야 리소스 조회 전에 차단된다. 인터셉터는 가드 이후라 이미 인가를 통과한 상태다 |
| **`403` 본문에 요구 권한을 담아 디버깅 편의 제공** | 내부 권한 체계가 노출된다(FR-12-23). 서버 로그와 감사 이력에 남으므로 운영자는 여전히 원인을 알 수 있다 |
| **권한 판정 결과를 TTL 캐시(60초)** | AC-12B-8(즉시 반영)을 "무효화를 4곳에서 빠뜨리지 않는 규율"에 의존하게 만든다. 1쿼리 비용이 NFR-P1에 크게 못 미쳐 얻는 것이 없다 |

**감수하는 비용**

1. **커스텀 역할을 만들 수 없다.** 역할 요구가 3종을 넘으면 코드 배포가 필요하다 — 재검토 트리거는 No.45(규제산업 거버넌스) 또는 고객사 요건 확정 시점이다.
2. **부록 A의 권한 명명 불일치 2건이 남는다**(`chatbot:write`로 그룹 삭제, `chatbot:read`로 대시보드). 이번 매핑에서 동작 차이가 0이며, 값 변경은 75곳 재검토 비용이 이득을 넘는다. No.14에서 전역 통계 API가 추가될 때 `stats:read` 신설을 검토한다.
3. **전역 가드 전환 시점에 기존 통합 테스트 2종이 전부 `401`이 된다.** 인증 헬퍼(`security-audit-설계.md` §13.2)를 **같은 커밋**에서 도입해 완화한다.
4. **`@Public()` 5번째 항목(logout)은 요구사항 문구를 넘어선 결정**이다. FR-12-20이 요구한 "설계 문서에 근거를 남긴다"를 이 ADR §4와 설계서 §8.2로 이행한다.

## 결과

- `packages/shared-types/src/security.ts`: `Permission`(14종 zod enum), `ROLE_PERMISSIONS`, `ROLE_LABELS`, `hasPermission()`. **권한 문자열의 단일 소스**(NFR-M2).
- `apps/api/src/common/auth/`: `permission.guard.ts`(no-op → 실구현), `require-permission.decorator.ts`(시그니처 축소), **`public.decorator.ts`**·**`current-user.decorator.ts`** 신규.
- `apps/api/src/app.module.ts`: `APP_GUARD` 등록. 11개 컨트롤러의 `@UseGuards(PermissionGuard)` 제거.
- `GET /api/v1/roles`: 역할 3종 + 역할별 권한 목록(상수 그대로).
- `ApiErrorCode` 추가: `FORBIDDEN`.
- `apps/web`: `AuthContext`가 `can(permission)`을 제공. **컴포넌트가 역할 문자열을 비교하지 않는다.** 쓰기 액션은 권한 없으면 **숨김**(비활성 아님), 페이지 단위 거부는 403 안내 화면.
- `test-automation` 인계: ① **AC-C-4 — `@Public()` 부착 핸들러 수 = 5 고정** ② AC-12B-10(가드 미부착 신규 컨트롤러도 401) ③ AC-12B-5(클라이언트 우회 직접 호출이 403이고 DB 무변경) ④ AC-12B-8(강등 즉시 반영) ⑤ AC-12B-13(권한 없음 + 미존재 ID = 403) ⑥ AC-12B-2/AC-C-6(공개 경로 동작 불변).
- `code-reviewer` 인계: ① `@Public()`이 5곳을 넘지 않는가 ② `@RequirePermission` 인자가 전부 유니온 값인가 ③ 컨트롤러에 `@UseGuards(PermissionGuard)` 잔존이 없는가 ④ `403` 응답 본문에 권한 문자열이 없는가 ⑤ 프런트가 역할 문자열을 직접 비교하는 곳이 없는가.
