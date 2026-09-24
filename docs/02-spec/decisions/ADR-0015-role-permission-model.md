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
2. **부록 A의 권한 명명 불일치 2건이 남는다**(`chatbot:write`로 그룹 삭제, `chatbot:read`로 대시보드). 이번 매핑에서 동작 차이가 0이며, 값 변경은 75곳 재검토 비용이 이득을 넘는다. No.14에서 전역 통계 API가 추가될 때 `stats:read` 신설을 검토한다. **[검토 완료 2026-09-24 No.29 — 신설하지 않는다. 문서 끝 갱신 참고]**
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


---

## 갱신 (2026-09-23 — `Permission` 14종 → 15종)

검증/품질 고도화(No.19~20)가 **`simulation:write` 1종을 신설**한다(PM 확정). `ROLE_PERMISSIONS`는 EDITOR·ADMIN에 추가되고 **VIEWER는 변하지 않는다**(조회 전용 유지). `Role`/`Permission` 테이블 미생성·fail-closed 전역 가드·`@Public()` **6곳**·`403` 본문에 요구 권한 미표기 등 **다른 결정은 전부 불변**이며, 역할·권한이 코드 상수이므로 **데이터 마이그레이션은 0건**이다.

**신규 문자열 0건 원칙의 첫 예외인 이유**: 대안은 "읽기 `simulation:read` / 쓰기 `dialogue:write`"였고 신규 문자열이 0건이라는 장점이 있었다. 그러나 TC 세트·실행 결과는 **대화 자산이 아니라 검증 자산**이어서, 한 화면의 읽기·쓰기가 두 도메인으로 갈라진다. `simulation:write` 신설로 이 그룹의 **18개 핸들러가 `simulation:read`/`simulation:write` 2종만** 쓰게 된다. **실행(run)은 DB를 바꾸지 않지만 ml-worker 자원을 대량 소비하므로 쓰기로 분류**한다 — "동작이 바꾸는 자원을 기준으로 권한을 정한다"는 원칙의 연장이다(ADR-0029 §5).

개수 고정 테스트(권한 유니온 크기)는 무력화하지 않고 **15로 갱신**한다.


---

## 갱신 (2026-09-23 — `@RequirePermission` 복수 인자 AND, 신규 권한 0종)

챗봇 복원/버전 이력관리(No.25)의 **복원 미리보기·확정은 `dialogue:write`와 `chatbot:write`를 모두** 요구한다 — 복원은 대화 자산(`dialogue:*`)과 답변설정·표시설정(`chatbot:write`, `answer-settings.controller.ts`가 쓰는 권한)을 **함께** 바꾸기 때문이다. PM이 **신규 권한 0종**(대안 `chatbot:restore` 신설 기각)으로 확정했으므로, 단일 권한만 판정하던 데코레이터·가드를 확장한다.

```ts
export const RequirePermission = (...permissions: [Permission, ...Permission[]]) =>
  SetMetadata(PERMISSION_METADATA_KEY, permissions);      // 항상 배열로 저장
// PermissionGuard: 메타데이터가 단일 값이든 배열이든 배열로 정규화 → **전부 보유**해야 통과(AND)
```

- **불변**: `Permission` 유니온 **15종** · `ROLE_PERMISSIONS` · `@Public()` **6곳** · fail-closed 판정 순서 ①~⑦ · `403` 본문에 요구 권한 미표기 · 기존 호출(인자 1개) 한 글자도 변경 없음.
- **AND만** 지원한다. OR 조합은 수요가 없고, 섞이면 판정 규칙이 데코레이터에서 읽히지 않는다.
- 빈 호출(`RequirePermission()`)은 튜플 타입으로 **컴파일 오류**다. `PERMISSION_DENIED` 이력의 `summary`에는 요구 권한을 `a+b`로 남긴다(응답 본문에는 여전히 미포함).
- 복원이 ADMIN 전용이 아닌 이유: 복원 직전 자동 백업으로 **가역 동작**이며(ADR-0031 §4), "즉시 롤백"은 사고 현장의 EDITOR가 할 수 있어야 의미가 있다. 조직 통제상 승인이 필요해지면(No.36/45) `chatbot:restore` 신설 또는 2인 승인을 재검토한다.


---

## 갱신 (2026-09-23 — 예약 = 즉시 실행과 같은 권한 + 실행 시 재검증, 신규 권한 0종)

운영 예약 배포(No.28, ADR-0032 §5)는 **신규 권한을 만들지 않는다**(PM 확정 P-9). `Permission` 유니온 15종 · `ROLE_PERMISSIONS` · 공개 경로 6곳 · fail-closed 판정 순서는 전부 불변이다.

- **예약의 생성·수정·취소·재개·확인 권한 = 그 동작을 즉시 실행할 때의 권한**: 복원 = `dialogue:write` + `chatbot:write` · 공개 = `chatbot:write`(+ WEB 채널 동시 활성화 시 `channel:write`) · 채널 열기/닫기 = `channel:write` · 실행 직전 TC 옵션 지정 시 + `simulation:write`. 동작 → 권한 매핑은 **순수 함수 1개**이며 생성 시 판정과 실행 시 재검증이 같은 함수를 쓴다(두 집합이 어긋날 수 없다).
- **가드가 아니라 서비스가 판정한다** — 동작이 요청 본문(생성) 또는 저장된 행(수정·취소·재개)에 있어 데코레이터로 표현할 수 없다. 핸들러는 `@RequirePermission('chatbot:read')` 기준선을 유지하고(fail-closed), 서비스는 ① 관리 권한(`chatbot:write` ∨ `channel:write`)이 전혀 없으면 **행 조회 전** `403`(권한 판정 → 존재 판정 순서 유지) ② 행을 읽은 뒤 동작별 권한 전부를 확인해 부족하면 `PERMISSION_DENIED` 이력(가드와 같은 요약 형식·60초 합치기) + `403`. 응답 본문에 요구 권한을 담지 않는다.
- **실행 직전 재검증**: 예약자 사용자 행이 존재하고 `status=ACTIVE`이며 **현재 역할**이 권한을 전부 보유해야 실행한다. 아니면 `FAILED(CREATOR_NOT_AUTHORIZED)` — 권한 강등·계정 비활성 후 과거 예약이 실행되지 않는다(**예약은 권한 우회 수단이 아니다**). `mustChangePassword`는 권한 박탈이 아니므로 보지 않는다.
- 취소는 예약자가 아니어도 같은 권한 보유자면 할 수 있다(휴가·퇴사 대응). 재개해도 예약자는 바뀌지 않는다 — 자기 명의 실행을 원하면 새 예약을 만든다.


---

## 갱신 (2026-09-24 — `stats:read` 검토 결과: 신설하지 않는다, 신규 권한 0종)

감수 비용 2가 예고한 검토를 통합 통계(No.29 — 그룹·전역 스코프 통계 API 7개)에서 수행했다. **결과: 신설하지 않는다**(PM 확정 P-7). 7개 핸들러는 전부 `chatbot:read`이며 `Permission` 15종 · `ROLE_PERMISSIONS` · 공개 경로 6곳 · 판정 순서 ①~⑦ 전부 불변이다.

- **판정 차이가 0이다**: ADMIN·EDITOR·VIEWER 모두 `chatbot:read`를 가지며, 결정 1의 "그룹별 챗봇 접근 제한 없음"(48행) 때문에 `chatbot:read` 보유자는 이미 **모든 챗봇의 통계를 개별로** 볼 수 있다. 합산 화면은 새 정보를 노출하지 않고, `stats:read`를 만들어도 세 역할 모두에 부여하게 된다 — 개념만 늘고 막는 것이 없다.
- **챗봇 그룹은 조직 경계가 아니라 분류(폴더)다**(No.1). 통계 합산의 권한 문제는 "그룹별 접근 제한"이 생길 때 비로소 발생한다.
- **재검토 트리거**: 그룹별 접근 제한/멀티테넌시 도입(No.45) 또는 고객사가 "통계만 보는 역할"을 요구할 때. 그때 통합 통계의 스코프 판정 함수(`stats/lib/scope-filter.ts` 1곳)가 "허용된 그룹 집합"을 받도록 교체한다(ADR-0033 §7 ④).
- 감수 비용 2의 나머지(명명 불일치 2건 — `chatbot:write`로 그룹 삭제, `chatbot:read`로 대시보드)는 그대로 둔다. 그룹 삭제가 보관으로 처리되는 경우(ADR-0002 갱신)에도 권한은 `chatbot:write` 그대로다.


---

## 갱신 (2026-09-24 — No.26 레거시 API 연동: 신규 권한 0종, 연결 관리 = `security:*`)

레거시 API 연동(No.26, ADR-0034 §10)은 **신규 권한을 만들지 않는다**(PM 확정 P-12). `Permission` 15종 · `ROLE_PERMISSIONS` · 공개 경로 6곳 · 판정 순서는 전부 불변이다.

- **연결 CRUD·연결 테스트 = `security:write`, 연결 목록·상세 = `security:read`**(ADMIN) — "어디로 나갈 수 있는가"는 외부 송신 경계이며 금지어·로그인 정책과 같은 보안 설정 도메인이다. "동작이 바꾸는 자원을 기준으로 권한을 정한다"에 따라 자원 = 전역 보안 설정.
- 노드 편집기의 **연결 선택 목록·목 샘플 응답 = `dialogue:read`** — URL·시크릿 참조·인증 방식을 싣지 않는다. EDITOR는 등록된 연결을 **쓰기만** 한다(노드 저장 = 기존 `dialogue:write`).
- 호출 로그 = `chatbot:read`.
- **시뮬레이터 실제 호출**: 가드는 기존 `simulation:read` 그대로 두고 서비스가 `simulation:write`를 재확인한다(`deploy-schedule.service.ts`의 `hasPermission` 선례). 불충족은 `403`이 아니라 **목으로 격하 + 사유 안내**다 — VIEWER의 시뮬레이터 사용 자체를 막지 않으면서 VIEWER발 외부 호출을 막는다.
- VIEWER가 `dialogue:read`로 v1 `API_CONDITION`의 평문 헤더 토큰을 읽을 수 있던 노출은 권한 변경이 아니라 **응답 가림**으로 해소한다(ADR-0034 §7 — 권한을 올리면 VIEWER의 노드 조회 자체가 막힌다).


---

## 갱신 (2026-09-24 — No.27 설문관리: 신규 권한 0종)

설문관리(No.27, ADR-0035 §12)는 **신규 권한을 만들지 않는다**(PM 확정 P-12). `Permission` 15종 · `ROLE_PERMISSIONS` · 공개 경로 6곳 · 판정 순서는 전부 불변이다.

- **설문 정의 조회 = `dialogue:read`, 생성·수정(상태 포함)·복제·삭제 = `dialogue:write`** — 설문 문항은 최종 사용자에게 보이는 대화 문구이며 노드가 참조하는 대화 자산이다("동작이 바꾸는 자원을 기준으로").
- **참여 통계·응답 목록·자유 텍스트 목록·CSV = `chatbot:read`**(세 역할) — 통계와 같은 도메인. VIEWER는 마스킹본만 본다(VIEWER가 이미 `chatbot:read`로 마스킹된 질문 원문을 질문 순위에서 보는 것과 같은 등급).
- 시뮬레이터 설문 미리보기 = 기존 `simulation:read` — 응답을 저장하지 않으므로 VIEWER 허용이 안전하다.
- 설문 목록(`dialogue:read`)에 최근 30일 노출/완료 수를 싣는다 — 세 역할 모두 `chatbot:read`를 가져 노출 차이가 0이다(그룹별 접근 제한 도입 시 재검토 — No.45).


---

## 갱신 (2026-09-25 — No.24 하이브리드 CS: 역할 3 → 4(`AGENT`) · 권한 15 → 17(`cs:read`·`cs:write`))

하이브리드 CS(No.24, **ADR-0036 §7**)는 **"역할 3종 고정" 원칙의 의도적 갱신**이다(PM 확정 P-7). 역할→권한 매핑이 코드 상수라는 결정·`Role`/`Permission` 테이블 미도입·fail-closed 전역 가드·판정 순서는 **불변**이다.

- **왜 기존 역할에 얹지 않는가**: EDITOR에 개입권을 주면 상담원에게 대화 자산 편집권(`dialogue:write` 등)이 따라가고(과권한), VIEWER("운영 모니터")에 주면 읽기 전용 역할이 고객에게 말하게 된다(성격 붕괴). "고객에게 사람으로서 말하기"는 어떤 기존 권한과도 다른 위험이다.
- **매핑**: `AGENT` = `chatbot:read`+`cs:read`+`cs:write` · EDITOR += `cs:read`(모니터링·이력 보기만) · ADMIN += `cs:read`+`cs:write` · VIEWER 불변. 기존 역할의 기존 권한은 바뀌지 않는다(추가만). `AGENT`는 계층형이 아니다(`dialogue:read` 없음 — 대화 자산 화면 불가).
- **서비스 재검증**: 전송 = 담당자 본인 · 종료 = 담당자·ADMIN · 강제 인수 = 역할 ADMIN · 원문 열람 = `cs:write` ∧ (담당자 ∨ ADMIN) ∧ 상담 중. 권한 문자열은 여전히 가드가 강제하는 기준선이다.
- **OR 판정은 여전히 지원하지 않는다** — 자주 쓰는 문장 목록은 경로를 둘로 나눠(`dialogue:read` 관리 · `cs:read` 콘솔 검색) 각각 AND 가드를 건다.
- 역할은 전역이다 — 챗봇별 상담원 배정·부서 분리는 멀티테넌시(No.22·45) 재검토 트리거에 합류한다. `@Public()` 6 → 7(상담 폴링 — 인증 대상이 아니라 토큰 보상 통제).
