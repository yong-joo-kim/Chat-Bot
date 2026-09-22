# 보안/이력 (No.12~13) — 세부 설계서

> **상위 문서**: `docs/02-spec/개발명세서.md` (§1 아키텍처, §2 모노레포/계층규약, §3 데이터모델, §4 API, §5 비기능, §6 결정사항)
> **입력 문서**: `docs/requirements/security-audit.md` (요구사항 정의서 — FR/AC/EX/DD/J 식별자 원본, PM이 J-1~J-7 전 건 승인)
> **선행 설계서**: `chatbot-operations-설계.md`(No.1~4), `dialogue-design-설계.md`(No.5~9), `quality-channel-설계.md`(No.10~11) — 4계층 모듈 규약·오류 봉투·삭제 정책·zod 단일 검증·챗봇 스코프 규약을 **그대로 상속**한다.
> **준수 기준**: `docs/03-design/UIUX_준수기준.md`
> **관련 ADR**: `decisions/ADR-0014`·`ADR-0015`·`ADR-0016`(신규), `ADR-0003`·`ADR-0004`·`ADR-0006`·`ADR-0007`·`ADR-0011`·`ADR-0013`(상속)
> **작성**: system-architect · 2026-09-21 · **다음 단계**: `ui-designer` → `backend-implementer` → `frontend-implementer` → `code-reviewer` → `test-automation`

이 문서는 개발명세서를 **대체하지 않고 확장**한다. 명명 규칙(엔터티 PascalCase, 테이블 snake_case `@@map`, REST `/api/v1/`, zod 단일 소스, 4계층 모듈)은 이전 세 그룹과 동일하다.

---

## 1. 범위와 전제

| 항목 | 내용 |
|---|---|
| 대상 기능 | No.12 회원·권한·보안 관리 · No.13 이력관리(감사추적) + **기존 9개 도메인 모듈 감사 소급** + **`apps/web` 인증 도입** |
| GPU 필요도 | 1 → **`apps/api` 동기 처리**. `apps/ml-worker`/Job Queue/Redis 미도입(개발명세서 §1 설계원칙, §6-4) |
| `packages/llm-provider` | 사용하지 않음 |
| `packages/dialogue-engine` | **수정 0줄**. 엔진은 인증·권한·금지어를 알지 못한다(FR-12-41, ADR-0008 규약 유지) |
| `apps/widget` | **수정 0줄**(FR-U-10, AC-U-10). 공개 API 2개만 호출하며 자격증명을 보내지 않는다 |
| DB | SQLite(개발명세서 §6-4). 원시 SQL 신규 도입 **0건**(NFR-M6) |
| 신규 런타임 의존성 | **0건**. 비밀번호 해시는 Node 내장 `crypto.scrypt`, 세션 토큰은 `crypto.randomBytes`, 쿠키 파싱은 자체 순수 함수(§7.4) — `cookie-parser`·`bcrypt`·`argon2`·`passport`·`@nestjs/jwt` 전부 미도입 |
| 이 그룹이 만드는 것 | 시스템 최초의 **인증 경계**, `PermissionGuard`의 **실제 구현**, `AuditLog`·`User` 테이블의 **최초 쓰기 주체**, `apps/web`의 **로그인/권한 UI** |
| 이 그룹이 **고치는 것** | 관리자 API 75개의 무인증 노출(①), 권한 문자열의 무타입(②), 감사 결손(③), 콘솔의 로그인 부재(④) — 요구사항 §1.1의 4대 미완 상태 |

**PM 승인 완료된 판단 7건**(요구사항 §1.3): **J-1**(세션+httpOnly 쿠키) · **J-2**(MFA out of scope) · **J-3**(금지어 필터 2지점) · **J-4**(감사 전면 소급) · **J-5**(API 연동 로그는 별도 테이블로 분리·이번 범위 제외) · **J-6**(역할 3종 코드 상수) · **J-7**(사용자 그룹 테이블 제외). 본 설계는 이 7건을 **확정 전제**로 한다.

**구현 순서 권고**

```
① shared-types(security.ts 재정비 + audit.ts 신설 + ApiErrorCode)
② common/request-context(ALS) + common/rate-limit 승격
③ common/auth(가드 실구현 · @Public · @CurrentUser) — 단 APP_GUARD 등록은 ⑤ 직후
④ audit-logs 모듈(AuditLogService 먼저) + banned-words 모듈
⑤ auth 모듈 + users 모듈 + seed 부트스트랩
⑥ 전역 가드 등록 + 컨트롤러 @UseGuards 11건 제거 + 통합테스트 인증 헬퍼(§13.2)
⑦ 9개 도메인 모듈 감사 기록 소급 삽입(§9.5, 40지점)
⑧ conversation 금지어 필터 2지점 + ConversationLog.blockedByFilter
⑨ apps/web 인증(AuthContext·/login·401 훅·credentials) → 신규 화면 3종
```

**⑥이 ⑦보다 먼저인 이유**: 전역 가드를 켜는 순간 기존 통합 테스트 2종이 전부 `401`이 된다(NFR-M4). 감사 소급(⑦, 40지점)을 먼저 하면 "테스트가 빨간 상태에서 40곳을 고치는" 구간이 생겨 회귀 원인을 분리할 수 없다. 인증 헬퍼로 녹색을 회복한 뒤 소급에 들어간다.

---

## 2. 설계 결정 요약

### 2.0 ⚠ DD 번호 충돌 해소 (선행 조치)

요구사항 §5.2는 "`quality-channel.md`의 DD-25에 이어 DD-26부터"로 번호를 부여했으나, **`quality-channel-설계.md` §2가 이미 DD-26~DD-32를 사용**하고 있다(엔진 진입점 구조·되묻기 종결·오버레이 위치·채널 등급·Origin 인가·`isAnswered` 판정식·비교 초기상태). 추적 가능성을 지키기 위해 **이 그룹의 DD는 DD-33부터 재부여**하고, 요구사항 문서의 원 번호를 병기한다.

| 요구사항 원번호 | 이 설계서 번호 | 주제 |
|---|---|---|
| DD-26 | **DD-33** | `User` 필드 확장 |
| DD-27 | **DD-34** | `Session` 신규 테이블 |
| DD-28 | **DD-35** | `AuditLog` 필드·인덱스 보강 |
| DD-29 | **DD-36** | `BannedWord` 신규 테이블 |
| DD-30 | **DD-37** | `ConversationLog.blockedByFilter` |
| DD-31 | **DD-38** | 감사 기록 위치(서비스 명시 호출 vs 인터셉터) |
| DD-32 | **DD-39** | 역할→권한 매핑 상수의 배치 위치 |

> `backend-implementer`/`test-automation`은 두 번호 중 어느 것으로 검색해도 이 표에 도달한다. 이후 그룹은 **DD-48 다음**부터 부여한다.

### 2.1 결정 일람

| ID | 이슈 | 결정 | 근거 |
|---|---|---|---|
| **DD-33**(=DD-26) | `User` 필드 | **전량 채택** — `passwordHash`(필수) / `status @default("ACTIVE")` / `mustChangePassword @default(true)` / `failedLoginCount @default(0)` / `lockedUntil?` / `lastLoginAt?` / `updatedAt @updatedAt` / `@@index([role])`·`@@index([status, createdAt])`. **MFA 컬럼 미생성** | §3.1, J-2 |
| **DD-34**(=DD-27) | `Session` 신규 | **채택** + 보강 — `tokenHash @unique`, `@@index([userId])`, `@@index([expiresAt])`. 토큰 원문 미저장. 정리 배치 미도입 | §3.1, §7.3 |
| **DD-35**(=DD-28) | `AuditLog` | **부분 채택** — 필드 7종(`actorEmail`/`actorRole`/`targetName`/`chatbotId`/`ip`/`userAgent` + `summary`) 전량 채택, FK 미부여 채택. **인덱스는 4종 중 3종 채택**(`createdAt`·`actorId+createdAt`·`chatbotId+createdAt`), **`targetType+targetId+createdAt`은 기각** | §2.2 |
| **DD-36**(=DD-29) | `BannedWord` 신규 | **채택**. 전역 1벌, `@@unique([wordNormalized])` | §3.1 |
| **DD-37**(=DD-30) | `ConversationLog.blockedByFilter` | **채택**. 이번 Phase에 쓰기 주체(입구 필터)가 생겨 ADR-0004 기준을 통과 | §3.1 |
| **DD-38**(=DD-31) | 감사 기록 위치 | **①안 채택** — 각 서비스가 `AuditLogService`를 주입받아 **명시 호출**. 인터셉터 기각 | §9.1, **ADR-0016** |
| **DD-39**(=DD-32) | 권한 매핑 배치 | **②안 채택** — `packages/shared-types/src/security.ts`의 `ROLE_PERMISSIONS` 상수 + `hasPermission()` 순수 함수. FE/BE 단일 소스 | §4.1, **ADR-0015** |
| **DD-40** | `actor` 전달 방식(FR-0-26, NFR-M7) | **`AsyncLocalStorage` 기반 `RequestContextService`**. Nest **요청 스코프 provider는 기각** — 의존성 전파로 `DialogueBundleCache`·`RateLimitStore` 등 싱글턴 상태가 요청마다 재생성되어 ADR-0007/DD-22 설계가 무너진다 | §8.4, **ADR-0016** |
| **DD-41** | 감사 기록의 트랜잭션 경계(FR-13-12 vs FR-13-13) | **본 동작 성공(커밋) 직후 별도 쓰기**로 통일한다. 트랜잭션 내부 기록은 채택하지 않는다 | §9.2, **ADR-0016** |
| **DD-42** | 세션/사용자 조회 캐시(FR-12-17, NFR-P1) | **캐시를 두지 않는다**(요청당 1쿼리). TTL 캐시는 무효화 경로 4곳을 새로 만들며 AC-12B-8(즉시 반영)을 구조가 아니라 규율로 지키게 된다 | §8.3 |
| **DD-43** | 레이트리미터 승격(FR-12-6) | `apps/api/src/conversation/{rate-limit.store.ts, lib/rate-limiter.ts}` → **`apps/api/src/common/rate-limit/`** 로 이동 + `@Global() RateLimitModule`. 주입 토큰 `'RateLimitStore'` 문자열은 **불변** | §11 |
| **DD-44** | 금지어 필터 소유 모듈 | **`banned-words` 모듈이 사전·캐시·순수함수·`BannedWordFilterService`를 소유**하고 export. `conversation`이 주입해 2지점에 적용. 엔진·`dialogue-common`은 무관 | §10 |
| **DD-45** | `@Public()` 부착 개수 | **4곳 → 5곳으로 확정**(`POST /auth/logout` 추가). FR-12-20이 요구한 "설계 문서의 근거"를 §8.2에 남긴다 | §8.2 |
| **DD-46** | `PERMISSION_DENIED` 합치기(FR-13-9) | 승격한 `RateLimitStore`를 **그대로 재사용**한다(key=`audit:denied:{userId}:{method} {path}`, limit=1, window=60초). 전용 dedupe 저장소를 새로 만들지 않는다 | §9.4 |
| **DD-47** | `AuditLog` ↔ `ApiCallLog` 분리(J-5) | **승인**. 개발명세서 §3의 `AuditLog` 설명에서 "API 연동 상세로그"를 삭제하고, No.26 착수 시 `ApiCallLog` 별도 테이블로 설계함을 명시 | §3.4, §15 |
| **DD-48** | CORS 변경 범위(ADR-0011 §5 보호) | **경로 분기 CORS delegate** — `/api/v1/public/*`·`/api/health`는 현행(`*`, 무자격증명) 유지, 관리자 경로만 `ADMIN_WEB_ORIGIN` allowlist 반사 + `credentials: true`. 기본값은 **동일 출처 전용**(dev는 이미 존재하는 Vite `/api` 프록시 사용) | §7.5, **ADR-0014** |

### 2.2 DD-35 — `AuditLog` 인덱스 4종 중 1종을 기각하는 이유

`AuditLog`는 이 시스템에서 **무한 증가하는 유일한 테이블**이다(EX-13-9). 인덱스는 조회를 빠르게 하지만 **모든 쓰기(=관리자의 모든 변경 동작)에 비용을 더한다.** NFR-P3(감사 소급이 기존 API 응답시간을 20% 이상 늘리지 않을 것)은 인덱스 개수와 직결된다.

- **채택 `@@index([createdAt])`**: FR-13-17이 기간 필터를 **강제**하므로(기본 30일·최대 90일) 모든 조회가 이 범위 스캔으로 시작한다. 워크호스 인덱스다.
- **채택 `@@index([actorId, createdAt])`**: "이 사람이 무엇을 했나"(FR-13-16 `actorId` 필터)의 직접 소비자.
- **채택 `@@index([chatbotId, createdAt])`**: FR-13-23(챗봇 상세에서 그 챗봇의 이력만)의 직접 소비자. 이 필터가 없으면 대화 자산 변경 추적이라는 이번 그룹의 핵심 가치가 성립하지 않는다.
- **기각 `@@index([targetType, targetId, createdAt])`**: 이 인덱스의 소비자는 "특정 리소스 1건의 변경 이력"인데, **이번 Phase의 어떤 AC도 `targetId`로 조회하지 않는다.** FR-13-16의 `targetType`은 콤마 복수 필터(저선택도)이고, FR-13-22는 이력에서 리소스로 **나가는** 링크이지 리소스에서 이력으로 들어오는 조회가 아니다. ADR-0004의 "소비하는 수용기준이 없는 구조는 만들지 않는다" 기준에 정확히 걸린다.
  > **재검토 트리거(명시)**: No.25(챗봇 복원/버전 이력관리)가 "이 노드의 변경 이력" 화면을 만들 때. 그때는 정렬·페이징 규격이 함께 확정되므로 컬럼 순서를 한 번에 옳게 고를 수 있다(DD-20에서 `ConversationLog` 인덱스를 미룬 것과 동일한 판단).

### 2.3 요구사항 충돌 2건의 해소 (구현자가 반드시 읽을 것)

요구사항 문서 안에서 서로 다른 답을 요구하는 지점이 2건 있다. 설계에서 확정한다.

| # | 충돌 | 확정 |
|---|---|---|
| **C-1** | FR-12-2는 "비활성 계정도 `INVALID_CREDENTIALS`와 **동일 문구**"라고 하는데, S-8/AC-12C-9는 "재로그인도 실패한다(**비활성화된 계정입니다**)"라고 한다 | **로그인 경로에서는 언제나 `401 INVALID_CREDENTIALS` 동일 문구**를 쓴다(계정 열거 방지가 우선). `ACCOUNT_DISABLED`는 **이미 세션을 가진 요청**을 가드가 끊을 때만 사용한다(FR-12-16 ④). AC-12C-9의 "재로그인도 실패"는 **실패 사실**로 검증하고 코드로 검증하지 않는다 → `test-automation` 인계 |
| **C-2** | AC-12C-4(자기 자신 변경 → `SELF_MODIFICATION`)와 AC-12C-5(마지막 ADMIN 강등 → `LAST_ADMIN`)는 **동시에 성립한다**. ADMIN이 1명뿐이면 그 사람이 곧 요청자이기 때문이다 | **`LAST_ADMIN`을 먼저 판정**한다. 원인이 더 구체적이고, 관리자가 취해야 할 조치("다른 ADMIN을 먼저 만드세요")를 정확히 지시한다. AC-12C-4는 **ACTIVE ADMIN이 2명 이상인 전제**에서 검증한다 → `test-automation` 인계 |

---

## 3. 데이터 모델 변경 (개발명세서 §3 확장)

### 3.1 Prisma 스키마 변경안 (`apps/api/prisma/schema.prisma`)

변경 대상은 **기존 3개 모델 + 신규 2개 모델**이다.

```prisma
model User {
  id                String   @id @default(uuid())
  /// 정규화(trim + 소문자) 후 저장된다. 별도 *Normalized 컬럼을 두지 않는 이유는 §3.3.
  email             String   @unique
  name              String
  /// RoleName(shared-types zod enum)이 값 제약의 단일 소스다(개발명세서 §3.1).
  role              String   @default("VIEWER")
  /// [신규] `alg$params$salt$hash` 형식 문자열(§7.2). 평문은 어떤 경로로도 저장되지 않는다(NFR-S1).
  /// ⚠ UserSchema(shared-types)에는 이 필드가 존재하지 않는다 — 타입 수준에서 응답 유출을 막는다.
  passwordHash      String
  /// [신규] UserStatus: ACTIVE | DISABLED. 물리 삭제는 제공하지 않는다(FR-12-30).
  status            String   @default("ACTIVE")
  /// [신규] 최초 로그인/관리자 초기화 직후 true. true인 동안 다른 API는 403이다(FR-12-13).
  mustChangePassword Boolean @default(true)
  /// [신규] 연속 실패 카운터. 성공 시 0으로 초기화된다(FR-12-6).
  failedLoginCount  Int      @default(0)
  /// [신규] 잠금 해제 시각. now()보다 미래면 잠금 상태다.
  lockedUntil       DateTime?
  /// [신규] 마지막 로그인 성공 시각(FR-12-34 목록 표시).
  lastLoginAt       DateTime?
  createdAt         DateTime @default(now())
  /// [신규] 목록 정렬·감사(Channel과 동일 문제 — quality-channel-설계.md §3.1).
  updatedAt         DateTime @updatedAt

  sessions          Session[]

  @@index([role])
  @@index([status, createdAt])
  @@map("users")
}

/// [신규] 서버 보관 불투명 세션(J-1, ADR-0014). JWT를 쓰지 않는 이유는 ADR-0014 참고.
model Session {
  id                 String   @id @default(uuid())
  userId             String
  user               User     @relation(fields: [userId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  /// ⚠ 토큰 원문은 저장하지 않는다. sha256(token) hex만 저장한다(NFR-S2).
  tokenHash          String   @unique
  createdAt          DateTime @default(now())
  /// 슬라이딩 유휴 만료의 기준. 쓰기 증폭을 막기 위해 갱신 주기를 둔다(§7.3).
  lastSeenAt         DateTime @default(now())
  /// 유휴 만료 시각(요청 시 갱신).
  expiresAt          DateTime
  /// 절대 만료 시각(갱신 불가, AC-12A-7).
  absoluteExpiresAt  DateTime
  ip                 String?
  userAgent          String?
  /// 로그아웃·강제 무효화 시각. null이 아니면 무효 세션이다.
  revokedAt          DateTime?

  @@index([userId])
  @@index([expiresAt])
  @@map("sessions")
}

model AuditLog {
  id          String   @id @default(uuid())
  /// 시스템 동작(seed·부트스트랩)은 null이다(FR-13-10).
  actorId     String?
  /// [신규] 기록 시점 스냅샷. 계정이 비활성/개명돼도 그때의 사실을 보존한다(FR-13-7, EX-13-7).
  actorEmail  String?
  /// [신규] 기록 시점의 역할 스냅샷.
  actorRole   String?
  /// AuditAction(shared-types zod enum) 12종이 값 제약의 단일 소스다(FR-13-4).
  action      String
  /// Prisma 모델명과 동일한 PascalCase 문자열(§9.3 targetType 표).
  targetType  String
  targetId    String
  /// [신규] 삭제된 대상도 목록에서 이름으로 읽힌다(FR-13-7, AC-13-15).
  targetName  String?
  /// [신규] 대화 자산 변경의 소속 챗봇(FR-13-6). FK는 걸지 않는다.
  chatbotId   String?
  /// 허용 필드 화이트리스트 스냅샷(JSON 문자열). 8KB 초과 시 절단 + truncated 표기(FR-13-11).
  beforeValue String?
  afterValue  String?
  /// [신규] 대량 작업 요약·거부 사유 등 사람이 읽는 한 줄(FR-13-5, FR-13-9).
  summary     String?
  /// [신규] 인증 이력의 출처(FR-13-8).
  ip          String?
  userAgent   String?
  createdAt   DateTime @default(now())

  @@index([createdAt])
  @@index([actorId, createdAt])
  @@index([chatbotId, createdAt])
  @@map("audit_logs")
}

/// [신규] 전역 금지어 사전(J-3, FR-12-35). 챗봇 스코프가 아니다.
model BannedWord {
  id             String   @id @default(uuid())
  word           String
  /// normalizeText() 결과(ADR-0006). 유일성·매칭의 기준이다.
  wordNormalized String
  /// BannedWordMatchType: EXACT | CONTAINS
  matchType      String   @default("CONTAINS")
  /// BannedWordPolicy: BLOCK | WARN
  policy         String   @default("BLOCK")
  enabled        Boolean  @default(true)
  description    String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([wordNormalized])
  @@map("banned_words")
}

model ConversationLog {
  // ... 기존 필드 유지 ...
  /// [신규] 입구 금지어 필터에 차단된 턴(DD-37, FR-12-45). No.15가 재학습 후보로 잘못 집어 올리는 것을 막는다.
  blockedByFilter Boolean @default(false)
}
```

**FK를 걸지 않는 필드**(`AuditLog.actorId`/`chatbotId`/`targetId`): `ConversationLog`와 동일한 **의도적 예외**다(개발명세서 §3.1). FK를 걸면 `onDelete: Restrict` 규약 때문에 **이력이 쌓인 챗봇·사용자를 영원히 삭제할 수 없게 된다.** 반대로 `Session.userId`는 **FK를 건다** — 세션은 "그 시점의 사실 기록"이 아니라 살아 있는 참조이며, 사용자를 물리 삭제하지 않기로 했으므로(FR-12-30) `Restrict`가 실제 제약이 되지 않는다.

### 3.2 마이그레이션 영향 분석 및 절차

| 변경 | 유형 | 기존 데이터 영향 |
|---|---|---|
| `User.passwordHash` 추가(**필수·기본값 없음**) | **비어 있는 테이블에만 안전** | **현재 `users` 테이블 행 수는 0이다.** `apps/api/prisma/seed.ts`는 사용자를 생성하지 않으며(`prisma.user` 호출 0건), `apps/api/src` 어디에도 `user.create`가 없다. 따라서 `NOT NULL` 컬럼 추가가 안전하다. ⚠ **마이그레이션 실행 전 `SELECT COUNT(*) FROM users` 가 0인지 확인**하고, 0이 아니면 해당 행을 삭제한 뒤 진행한다(실사용 계정이 존재할 수 없는 상태다) |
| `User` 나머지 6개 컬럼 추가 | 비파괴 `ADD COLUMN`(전부 기본값 또는 nullable) | 영향 없음 |
| `User.updatedAt @updatedAt` | 비파괴 | 기존 행 없음. Prisma가 쓰기 시점에 채운다 |
| `Session` 테이블 신규 | 신규 | 없음 |
| `BannedWord` 테이블 신규 | 신규 | 없음 |
| `AuditLog` 컬럼 7종 추가(전부 nullable) | 비파괴 `ADD COLUMN` | 기존 행 0건(쓰기 주체가 없었다). 영향 없음 |
| `AuditLog` 인덱스 3종 추가 | 비파괴 | 행 0건이라 즉시 완료 |
| `ConversationLog.blockedByFilter` 추가 | 비파괴 `ADD COLUMN`(기본 false) | seed 로그 220건은 `false`. No.2 대시보드는 이 컬럼을 읽지 않는다 |

**절차**

1. `prisma migrate dev --name security-audit-schema` — 위 변경을 **한 마이그레이션**으로 생성.
2. 생성된 SQL 검토: SQLite는 `NOT NULL` 컬럼 추가 시 테이블 재작성을 유발할 수 있다. `users` 재작성 시 기존 컬럼 값이 보존되는지 확인(행 0건이라 실질 위험은 없다).
3. `pnpm --filter @chat-bot/api prisma:seed` 재실행 → §14의 부트스트랩/역할별 계정·금지어 반영.
4. **롤백 경로**: 컬럼 추가 + 테이블 2개 추가 + 인덱스 3개뿐이라 역마이그레이션이 데이터 손실을 일으키지 않는다. 단 **역마이그레이션은 인증을 끄는 것이 아니다** — 전역 가드는 코드에 있으므로, 롤백 시에는 코드도 함께 되돌린다.
5. **감사로그 백필은 하지 않는다**(§9.3 각주 — 기술적으로 불가능). 이력 화면에 "이력 기록은 YYYY-MM-DD부터 시작되었습니다" 안내를 표시한다(`ui-designer` 인계).

### 3.3 이메일 정규화에 `*Normalized` 컬럼을 두지 않는 이유

`Intent.nameNormalized` 등 기존 정규화 컬럼(ADR-0006)은 **원문을 보존하면서 정규화 기준으로 유일성을 강제**해야 했다("주문 조회"와 "주문조회"를 같게 보되 입력 그대로 표시). 이메일은 다르다.

- 이메일의 정규화는 **trim + 소문자**뿐이고, 이는 **손실이 아니다**(대소문자만 다른 이메일은 동일 주소로 취급하는 것이 표준 관행이다).
- 따라서 **정규화 결과를 `email` 컬럼에 그대로 저장**하고 기존 `@unique`를 그대로 쓴다. 컬럼이 늘지 않는다.
- `normalizeText()`(NFKC·연속공백 축약)는 **쓰지 않는다** — 이메일에 공백은 애초에 유효하지 않고, NFKC가 도메인을 변형할 여지를 남길 이유가 없다. 전용 함수 `normalizeEmail()`을 `shared-types/security.ts`에 둔다(FR-12-26).

### 3.4 개발명세서 §3 엔터티 표 갱신

| 현재 행 | 갱신 |
|---|---|
| `User` / `Role` / `Permission` \| 회원·권한·보안 \| 12 | **`User` / `Session` / `BannedWord`** \| 회원·세션·금지어 사전. **`Role`/`Permission` 테이블은 만들지 않는다**(J-6 — 역할은 `User.role` String + zod enum, 권한 매핑은 `shared-types` 코드 상수, ADR-0015) \| 12 |
| `AuditLog` \| 변경 이력 + **API 연동 상세로그** \| 13 | `AuditLog` \| **변경 이력(감사추적) 전용**. 전 도메인 쓰기 동작의 단일 기록 대상이며 append-only다. **API 연동 상세로그는 No.26 착수 시 `ApiCallLog` 별도 테이블로 분리**(J-5, DD-47) \| 13 |
| `ConversationLog` \| ... | 설명에 "**`blockedByFilter`로 금지어 차단 턴을 구분한다**(No.12)" 추가 |

---

## 4. `packages/shared-types` 스키마 배치

배치 규칙(개발명세서 §6-9)에 따라 **보안 도메인은 `security.ts`에 재정비·append**, **감사(이력)는 관심사가 분명히 다르고 스키마가 비대하므로 `audit.ts` 신설**로 나눈다. `audit.ts`는 `common.ts`에만 의존하는 **단방향 의존**이다.

### 4.1 `security.ts` 재정비 (인증 · 권한 · 회원 · 금지어)

```ts
/* ── 역할 (기존 유지) ── */
export const RoleName = z.enum(['ADMIN', 'EDITOR', 'VIEWER']);

/* ── 권한 14종 유니온 (FR-0-25, FR-12-18) ──
   ⚠ 기존 75곳의 @RequirePermission 문자열이 전부 이 목록에 존재해야 한다.
   명명 규칙: `<도메인>:<동작>` (부록 A-7). 새 도메인이 생기면 이 규칙으로 추가한다. */
export const Permission = z.enum([
  'chatbot:read', 'chatbot:write', 'chatbot:delete', 'chatbot:purge',
  'dialogue:read', 'dialogue:write',
  'channel:read', 'channel:write',
  'simulation:read',
  'user:read', 'user:write',
  'security:read', 'security:write',
  'audit:read',
]);
export type Permission = z.infer<typeof Permission>;

/* ── 역할→권한 매핑 (DD-39, ADR-0015). FE/BE 공통 단일 소스다. ── */
export const ROLE_PERMISSIONS: Record<RoleName, readonly Permission[]> = {
  VIEWER: ['chatbot:read', 'dialogue:read', 'channel:read', 'simulation:read'],
  EDITOR: [...VIEWER, 'chatbot:write', 'chatbot:delete', 'dialogue:write', 'channel:write'],
  ADMIN:  [...EDITOR, 'chatbot:purge', 'user:read', 'user:write',
           'security:read', 'security:write', 'audit:read'],
};
export const ROLE_LABELS: Record<RoleName, string> = { ADMIN: '시스템 관리자', EDITOR: '챗봇 편집자', VIEWER: '운영 모니터' };
export function hasPermission(role: RoleName, permission: Permission): boolean;

/* ── 사용자 ── */
export const UserStatus = z.enum(['ACTIVE', 'DISABLED']);
export const UserSchema = z.object({
  id, email, name, role: RoleName, status: UserStatus,
  mustChangePassword: z.boolean(), lastLoginAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(), updatedAt: z.coerce.date(),
});                                        // ⚠ passwordHash 없음 — 타입으로 유출을 막는다(NFR-S1)
export const UserListQuerySchema           // q / role(csvEnumArray) / status / page / pageSize
export const CreateUserSchema              // { email, name, role }
export const UpdateUserSchema              // { name?, role? }  — email 변경 불가(FR-12-27)
export const UpdateUserStatusSchema        // { status }
export const CreateUserResponseSchema      // { user, temporaryPassword }  ← 1회성 전용
export const PasswordResetResponseSchema   // { temporaryPassword }
export const RoleListItemSchema            // { role, label, permissions[] }

/* ── 인증 ── */
export const LoginRequestSchema            // { email, password }
export const CurrentUserSchema             // UserSchema.pick(...) + { permissions: Permission[] }
export const LoginResponseSchema = z.object({ status: z.literal('OK'), user: CurrentUserSchema });
export const ChangePasswordSchema          // { currentPassword, newPassword }

/* ── 비밀번호 정책 (FR-12-12) — FE/BE가 같은 함수를 쓴다 ── */
export const PASSWORD_POLICY = { minLength: 10, minCharClasses: 2 } as const;
export type PasswordRuleId = 'LENGTH' | 'CHAR_CLASSES' | 'EMAIL_LOCALPART';
export function validatePasswordPolicy(
  password: string, opts: { email?: string },
): { ok: boolean; violations: { rule: PasswordRuleId; message: string }[] };

/* ── 금지어 (DD-36) ── */
export const BannedWordMatchType = z.enum(['EXACT', 'CONTAINS']);
export const BannedWordPolicy    = z.enum(['BLOCK', 'WARN']);
export const BannedWordSchema, CreateBannedWordSchema, UpdateBannedWordSchema
export const BannedWordTestRequestSchema   // { text }
export const BannedWordTestResponseSchema  // { matches: [{ word, matchType, policy }], maskedText, decision: 'PASS'|'WARN'|'BLOCK' }

/* ── 이메일 정규화 (FR-12-26, §3.3) ── */
export function normalizeEmail(email: string): string;   // trim + toLowerCase
```

> `LoginResponseSchema`에 **`status` 판별 필드를 둔다**(요구사항 §9.1 MFA 확장 지점). 향후 `{ status: 'MFA_REQUIRED', challengeId }` 분기를 **하위호환으로** 추가할 수 있다. 지금은 `'OK'` 리터럴 1종이므로 프런트가 분기할 것이 없고, 컬럼도 만들지 않는다(J-2).

### 4.2 `audit.ts` 신설 (이력)

```ts
/* ── 동작 12종 (FR-13-4) ── */
export const AuditAction = z.enum([
  'CREATE', 'UPDATE', 'DELETE', 'PURGE', 'STATUS_CHANGE', 'BULK_DELETE',
  'IMPORT', 'COPY', 'LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'PERMISSION_DENIED',
]);
export const AUDIT_ACTION_LABELS: Record<AuditAction, string>;           // 배지 문구(FR-13-21)
export const DESTRUCTIVE_AUDIT_ACTIONS = ['DELETE','PURGE','BULK_DELETE'] as const;  // 시각 구분(FR-13-21)

/* ── 대상 유형 (§9.3) — Prisma 모델명과 1:1 ── */
export const AuditTargetType = z.enum([
  'ChatbotGroup','Chatbot','Intent','Keyword','HomonymDictionary','ContextVariable',
  'DialogNode','FaqEntry','Channel','User','BannedWord','Session',
]);
export const AUDIT_TARGET_LABELS: Record<AuditTargetType, string>;       // '의도', '챗봇' 등
/** 대상 편집 화면 경로 템플릿(FR-13-22). 서버가 링크를 만들지 않고 프런트가 이 맵으로 조립한다. */
export const AUDIT_TARGET_ROUTE: Partial<Record<AuditTargetType, string>>;

export const AuditLogListItemSchema   // id, createdAt, actorId?, actorEmail?, actorRole?, action,
                                      // targetType, targetId, targetName?, chatbotId?, summary?
export const AuditLogDetailSchema     // ListItem + { before: Record<string,unknown>|null,
                                      //              after: ..., changedFields: string[],
                                      //              truncated: boolean, ip?, userAgent? }
export const AuditLogListQuerySchema  // from?, to?, actorId?, action(csv), targetType(csv),
                                      // chatbotId?, q?, page, pageSize
export const AuditLogListResponseSchema // Paginated<AuditLogListItem> + { appliedFrom, appliedTo, rangeDefaulted }
export const AUDIT_LIMITS = { defaultRangeDays: 30, snapshotBytes: 8192, bulkTargetIds: 50, exportRows: 10000 } as const;
```

> `AuditLogListResponse`에 **`appliedFrom`/`appliedTo`/`rangeDefaulted`** 를 실어 보낸다. AC-13-9("기간 미지정 시 30일 제한 사실이 응답 또는 화면에 명시")를 **서버가 판정하고 프런트는 렌더만** 하게 하기 위함이다(FR-11-3의 "서버 상수" 선례와 동일).
> `AUDIT_QUERY_MAX_RANGE_DAYS`는 **환경변수**(기본 90)이므로 상한값은 상수가 아니라 서버 판정 결과로 전달된다 — 프런트는 400 응답의 `message`를 그대로 보여준다.

### 4.3 `common.ts` — `ApiErrorCode` 13종 추가 (FR-0-28)

| 코드 | HTTP | 발생 지점 |
|---|---|---|
| `UNAUTHENTICATED` | 401 | 세션 쿠키 없음/형식 오류(EX-12-1, EX-12-2) |
| `SESSION_EXPIRED` | 401 | 유휴·절대 만료, 무효화된 세션(AC-12A-7) |
| `ACCOUNT_DISABLED` | 401 | 세션은 유효하나 계정이 `DISABLED`(가드 ④) — **로그인 경로에서는 쓰지 않는다**(C-1) |
| `INVALID_CREDENTIALS` | 401 | 로그인 실패 전부(미존재·불일치·비활성) |
| `ACCOUNT_LOCKED` | 401 | 연속 실패 잠금(FR-12-6) |
| `FORBIDDEN` | 403 | 권한 부족(요구 권한 문자열을 본문에 담지 않는다 — FR-12-23) |
| `PASSWORD_CHANGE_REQUIRED` | 403 | `mustChangePassword=true`(FR-12-13) |
| `PASSWORD_POLICY` | 400 | 정책 위반. `details[]`에 위반 규칙(FR-12-12) |
| `LAST_ADMIN` | 409 | 마지막 ADMIN 강등/비활성(FR-12-32) |
| `SELF_MODIFICATION` | 409 | 본인 역할/상태 변경(FR-12-31) |
| `DUPLICATE_EMAIL` | 409 | 이메일 중복(FR-12-26) |
| `BANNED_WORD_BLOCKED` | — | **응답 코드로 쓰지 않는다**(§10.3 참고). 사전 등록 충돌 등 향후 용도를 위해 enum에만 추가 |
| `AUDIT_RANGE_TOO_WIDE` | 400 | 조회 기간 상한 초과(FR-13-17) |

> `BANNED_WORD_BLOCKED`만 예약 코드다. 입구 필터 차단은 **오류가 아니라 정상 200 응답**(안내 아웃풋)이기 때문이다(§10.3). enum에 남기는 이유는 요구사항 FR-0-28이 13종을 명시했고, 금지어 사전 중복 등록(409) 등 후속 용도가 있어서다 — 사용되지 않는 동안에도 **응답 스키마에 영향을 주지 않는다**(enum 확장은 하위호환).

---

## 5. API 설계 (개발명세서 §4 확장)

### 5.1 신규 엔드포인트 19개 (확정)

**인증 `/api/v1/auth`** — 컨트롤러 `AuthController`

| # | 메서드 | 경로 | 권한 | 요청 | 응답 | 오류 |
|---|---|---|---|---|---|---|
| 1 | POST | `/auth/login` | **`@Public()`** | `LoginRequest` | `200 LoginResponse` + `Set-Cookie` | 400 `VALIDATION_FAILED` / 401 `INVALID_CREDENTIALS`·`ACCOUNT_LOCKED` / 429 `RATE_LIMITED` |
| 2 | POST | `/auth/logout` | **`@Public()`**(DD-45) | — | `204` (멱등) | — |
| 3 | GET | `/auth/me` | 인증만 | — | `200 CurrentUser` | 401 |
| 4 | POST | `/auth/password` | 인증만(`mustChangePassword` 예외 경로) | `ChangePassword` | `204` | 400 `PASSWORD_POLICY` / 401 `INVALID_CREDENTIALS`(현재 비밀번호 불일치) |

**회원·권한 `/api/v1`** — 컨트롤러 `UsersController`, `RolesController`

| # | 메서드 | 경로 | 권한 | 응답 | 오류 |
|---|---|---|---|---|---|
| 5 | GET | `/users` | `user:read` | `200 Paginated<User>` | 403 |
| 6 | POST | `/users` | `user:write` | `201 CreateUserResponse` | 400 / 409 `DUPLICATE_EMAIL` |
| 7 | GET | `/users/:id` | `user:read` | `200 User` | 404 |
| 8 | PATCH | `/users/:id` | `user:write` | `200 User` | 400 / 404 / 409 `LAST_ADMIN`·`SELF_MODIFICATION` |
| 9 | PATCH | `/users/:id/status` | `user:write` | `200 User` | 404 / 409 `LAST_ADMIN`·`SELF_MODIFICATION` |
| 10 | POST | `/users/:id/password-reset` | `user:write` | `200 PasswordResetResponse` | 404 |
| 11 | GET | `/roles` | `user:read` | `200 { items: RoleListItem[] }` | 403 |

**금지어 `/api/v1/banned-words`** — 컨트롤러 `BannedWordsController`

| # | 메서드 | 경로 | 권한 | 응답 | 오류 |
|---|---|---|---|---|---|
| 12 | GET | `/banned-words` | `security:read` | `200 Paginated<BannedWord>` | 403 |
| 13 | POST | `/banned-words` | `security:write` | `201 BannedWord` | 400 / 409 `DUPLICATE_NAME` |
| 14 | PATCH | `/banned-words/:id` | `security:write` | `200 BannedWord` | 400 / 404 / 409 |
| 15 | DELETE | `/banned-words/:id` | `security:write` | `204` | 404 |
| 16 | POST | `/banned-words/test` | `security:read` | `200 BannedWordTestResponse` | 400 |

**이력 `/api/v1/audit-logs`** — 컨트롤러 `AuditLogsController`

| # | 메서드 | 경로 | 권한 | 응답 | 오류 |
|---|---|---|---|---|---|
| 17 | GET | `/audit-logs` | `audit:read` | `200 AuditLogListResponse` | 400 `AUDIT_RANGE_TOO_WIDE` / 403 |
| 18 | GET | `/audit-logs/export` | `audit:read` | `200 text/csv` | 400 *(P2 — §15)* |
| 19 | GET | `/audit-logs/:id` | `audit:read` | `200 AuditLogDetail` | 404 |

**규약 메모**

- **라우트 선언 순서**: `/audit-logs/export`를 `/audit-logs/:id`보다 **먼저** 선언한다(`chatbots.controller.ts`의 `slug-available` 선례와 동일한 함정).
- **금지어 중복**은 기존 `DUPLICATE_NAME`(409)을 재사용한다 — 새 코드를 만들지 않는다(정규화 유일성 위반이라는 같은 의미).
- **이력에는 수정·삭제 경로가 존재하지 않는다**(FR-13-14, NFR-S11). 컨트롤러에 `Patch`/`Delete` import가 없어야 한다 — `code-reviewer` 점검 항목.
- **`/users`의 기본 정렬은 `createdAt desc`** 다(FR-12-24). 공통 규약(`updatedAt desc`)의 **명시적 예외**이며, 회원 목록은 "언제 합류했나"가 기본 축이다.
- 모든 목록은 공통 페이지네이션 봉투 `{ items, total, page, pageSize }`를 따른다. `/roles`만 **enum 크기로 고정된 목록**이므로 `{ items }`만 반환한다(개발명세서 §4.1의 채널 8종과 동일 예외).

### 5.2 개발명세서 §4 표 갱신

| 현재 행 | 갱신 |
|---|---|
| 보안/이력 \| `/users`, `/roles`, `/audit-logs` \| 12, 13 | **인증** \| `/auth/login｜logout｜me｜password` \| 12 <br> **회원·권한** \| `/users`(+`/:id/status`, `/:id/password-reset`), **`/roles`(상수 조회 API — 테이블 기반 CRUD가 아니다)** \| 12 <br> **보안(금지어)** \| `/banned-words`(+`/test`) \| 12 <br> **이력** \| `/audit-logs`(+`/:id`, `/export`). **쓰기·삭제 경로 없음(append-only)** \| 13 |

### 5.3 개발명세서 §4.1 공통 규약 표 갱신

| 항목 | 현재 | 갱신 |
|---|---|---|
| 권한 | "Phase 1 가드는 no-op이며 No.12에서 구현만 채운다" | "**No.12에서 구현 완료. `PermissionGuard`는 `APP_GUARD` 전역 가드(fail-closed)이며, 공개 경로는 `@Public()`으로 명시 opt-out 한다(정확히 5곳, §8.2). 권한 문자열의 단일 소스는 `shared-types`의 `Permission` 유니온이며 데코레이터 인자 타입이 이를 강제한다.** 공개 API에는 `@RequirePermission`을 부착하지 않는다" |
| **인증**(신규 행) | — | "**관리자 API는 세션 쿠키(`cb_session`, httpOnly·SameSite=Lax) 인증이 기본이다. 인증 실패는 `401`, 권한 부족은 `403`이며, 권한 판정은 리소스 조회보다 먼저 수행된다(존재하지 않는 ID + 권한 없음 = `403`). CSRF는 `SameSite=Lax` + 상태 변경 API 전부 비-GET 구조로 방어한다**(ADR-0014)" |
| 파괴적 동작 | "GET으로 노출 금지..." | 기존 문장 + "**이 규약은 CSRF 방어의 전제다**(NFR-S9) — 위반 시 `SameSite=Lax` 보호가 무력화된다" |

---

## 6. NestJS 모듈 구조 (개발명세서 §2.1·§2.2 확장)

```
apps/api/src/
├── common/
│   ├── auth/
│   │   ├── permission.guard.ts             # [개조] no-op → 실제 RBAC. APP_GUARD로 등록
│   │   ├── require-permission.decorator.ts # [개조] (permission: Permission)로 시그니처 축소
│   │   ├── public.decorator.ts             # [신규] @Public() — opt-out 마커
│   │   ├── current-user.decorator.ts       # [신규] @CurrentUser() 파라미터 데코레이터
│   │   ├── session-context.ts              # [신규] AuthenticatedActor 타입 + 컨텍스트 키
│   │   ├── auth.module.ts                  # [신규] @Global() — 가드가 쓰는 SessionService를 export
│   │   └── lib/
│   │       ├── cookie.ts                   # [신규] parseCookieHeader / buildSetCookie (순수·의존성 0)
│   │       └── password-hash.ts            # [신규] hashPassword / verifyPassword (scrypt, §7.2)
│   ├── request-context/
│   │   ├── request-context.service.ts      # [신규] AsyncLocalStorage 래퍼(DD-40)
│   │   ├── request-context.middleware.ts   # [신규] 전 요청을 als.run()으로 감싼다
│   │   └── request-context.module.ts       # [신규] @Global()
│   └── rate-limit/                         # [이동] conversation/ → common/ (DD-43)
│       ├── rate-limit.store.ts             #   RateLimitStore 인터페이스 + InMemory 구현
│       ├── rate-limit.module.ts            # [신규] @Global() — provide: 'RateLimitStore'
│       └── lib/rate-limiter.ts             #   consume() 순수 함수(+ 기존 spec 동반 이동)
├── auth/
│   ├── auth.controller.ts                  # 4 엔드포인트
│   ├── auth.service.ts                     # 로그인/로그아웃/비밀번호 변경 — AuditLog 기록 지점
│   ├── session.service.ts                  # 세션 발급·검증·무효화(가드가 주입받는 유일한 경로)
│   ├── login-rate-limit.guard.ts           # IP 기준 로그인 폭주 차단(FR-12-6)
│   └── lib/
│       ├── temporary-password.ts           # 임시 비밀번호 생성(NFR-S13)
│       └── session-expiry.ts               # 유휴/절대 만료·슬라이딩 판정 순수 함수
├── users/
│   ├── users.controller.ts / users.service.ts / user.mapper.ts
│   ├── roles.controller.ts                 # GET /roles — shared-types 상수를 그대로 반환
│   └── lib/last-admin.ts                   # 마지막 관리자·자기수정 판정 순수 함수
├── banned-words/
│   ├── banned-words.controller.ts / banned-words.service.ts / banned-word.mapper.ts
│   ├── banned-word.cache.ts                # TTL + 쓰기 즉시 무효화(번들 캐시와 동일 패턴)
│   ├── banned-word-filter.service.ts       # [export] 대화 파이프라인이 주입받는 진입점
│   ├── banned-words.module.ts              # BannedWordFilterService를 exports
│   └── lib/
│       ├── banned-word-filter.ts           # detect / maskText / decide (순수, DB·Nest 무의존)
│       └── output-text-fields.ts           # 아웃풋 12종의 사용자 노출 문자열 필드 화이트리스트
├── audit-logs/
│   ├── audit-logs.controller.ts            # 조회 3개(쓰기 경로 없음)
│   ├── audit-logs.service.ts               # 조회 전용
│   ├── audit-log.service.ts                # ★ record() — 전 도메인의 단일 기록 진입점(NFR-M3)
│   ├── audit-log.mapper.ts
│   ├── audit-logs.module.ts                # @Global() — 12개 모듈이 소비(PrismaModule 선례)
│   └── lib/
│       ├── audit-snapshot.ts               # 화이트리스트 스냅샷 + 8KB 절단(FR-13-11)
│       ├── audit-diff.ts                   # changedFields 산출(FR-13-18)
│       └── audit-range.ts                  # 기간 기본값·상한 판정(FR-13-17)
└── conversation/
    ├── public-conversation.service.ts      # [개조] 입구/출구 필터 2지점 삽입(§10.2)
    └── conversation-log.service.ts         # [개조] 금지어 마스킹 → PII 마스킹 순서(FR-12-45)
```

**`@Global()` 을 쓰는 신규 모듈 3개**(`RequestContextModule`, `RateLimitModule`, `AuditLogsModule`)와 `common/auth/AuthModule`: 전부 **횡단 관심사이고 소비 모듈이 10곳 이상**이다. `PrismaModule`이 이미 같은 이유로 `@Global()`인 선례를 따른다. 반대로 `auth`/`users`/`banned-words`/`audit-logs`의 **도메인 컨트롤러·서비스는 일반 모듈**이다 — `BannedWordFilterService`만 `exports`로 내보내 `ConversationModule`이 명시적으로 import 한다(암묵 전역화 금지).

**개발명세서 §2.2 표 갱신**

| 현재 | 갱신 |
|---|---|
| 보안/이력/통계 (No.12~15): `auth`, `audit-logs`, `stats`(확장) — 미착수 | **보안/이력 (No.12~13)**: `auth`, `users`, `banned-words`, `audit-logs` + **횡단 `common/auth`(가드 실구현·전역 등록) · `common/request-context`(신규) · `common/rate-limit`(승격)** — **설계 완료 → `security-audit-설계.md` §6** <br> 통계 (No.14~15): `stats`(확장) — 미착수 |

**개발명세서 §2.1 계층 규약 갱신**(1줄 정정)

- 서비스 계층 책임: "비즈니스 규칙의 단일 진입점(**향후** `AuditLog` 기록 지점)" → "비즈니스 규칙의 단일 진입점이며 **`AuditLog` 기록 지점이다(No.12부터 실제 동작)**. 컨트롤러·매퍼·`lib/`는 `AuditLog`를 알지 못한다(FR-0-27). **예외 1건**: 인증·인가 이력(`LOGIN`/`LOGIN_FAILED`/`LOGOUT`/`PERMISSION_DENIED`)은 서비스 계층이 아니라 `auth` 서비스와 `common/auth` 가드가 기록한다(§9.4)."
- 공통 횡단 목록에 `auth/public.decorator.ts`, `auth/current-user.decorator.ts`, `request-context/`, `rate-limit/` 추가. `auth/permission.guard.ts`의 "(Phase 1 no-op)" 표기 삭제.

---

## 7. 인증 설계 (No.12-c, J-1 / ADR-0014)

### 7.1 전체 흐름

```
[브라우저] ──POST /auth/login {email,password}──▶ LoginRateLimitGuard(IP)
                                                  └▶ AuthService.login()
     ◀── 200 {status:'OK', user} + Set-Cookie: cb_session=<opaque>; HttpOnly; SameSite=Lax; Path=/api
[브라우저] ──GET /chatbots (Cookie 자동 첨부)──▶ RequestContextMiddleware(ALS 시작)
                                                  └▶ PermissionGuard
                                                       ├ @Public()?          → 통과
                                                       ├ SessionService.resolve(token)  ← 1쿼리(세션+사용자 join)
                                                       ├ 만료/무효/비활성 판정  → 401
                                                       ├ mustChangePassword   → 403
                                                       ├ hasPermission(role,p) → 403(+PERMISSION_DENIED 기록)
                                                       └ ALS에 actor 주입 → 통과
```

### 7.2 비밀번호 해시 — Node 내장 `scrypt` (요구사항 ③ 확정)

**결정: `crypto.scrypt`. `bcrypt`/`argon2` 네이티브 모듈은 도입하지 않는다.**

| 항목 | 값 |
|---|---|
| 알고리즘 | `scrypt`(Node `crypto`, OWASP 권장군) |
| 파라미터 | `N=32768(2^15)`, `r=8`, `p=1`, `keylen=32`, `maxmem=64MiB` |
| 솔트 | `randomBytes(16)` |
| 저장 형식 | `scrypt$N=32768,r=8,p=1$<saltB64url>$<hashB64url>` — **파라미터를 문자열에 포함**해 향후 재해싱이 가능하다(FR-12-4) |
| 비교 | `timingSafeEqual`(길이 불일치 시 즉시 false, FR-12-5) |
| 구현 | `common/auth/lib/password-hash.ts` — `hashPassword(pw): Promise<string>` / `verifyPassword(pw, stored): Promise<boolean>`. 순수 모듈(Nest·DB 무의존) |

> ⚠ **`maxmem` 을 반드시 명시한다.** scrypt의 메모리 사용량은 `128 × N × r = 32MiB`인데 Node 기본 `maxmem`이 정확히 32MiB라 **기본값으로는 `ERR_CRYPTO_INVALID_SCRYPT_PARAMS`가 난다.** `maxmem: 64 * 1024 * 1024`를 넘긴다.
> **성능 예산**: 이 파라미터는 일반 하드웨어에서 ~80~150ms다(NFR-P2 P95 300ms 충족). 해시는 **로그인·비밀번호 변경·회원 생성 경로에서만** 수행되며 일반 API 경로에는 절대 등장하지 않는다.
> **계정 열거 방지**(FR-12-3): 이메일이 없을 때도 **모듈 로드 시 1회 생성한 더미 해시**로 `verifyPassword`를 수행해 소요시간을 맞춘다. 더미 해시를 매번 생성하면 오히려 느려져 역방향 신호가 된다.

### 7.3 세션 수명주기

| 단계 | 규격 |
|---|---|
| 토큰 생성 | `randomBytes(32).toString('base64url')`(256bit, NFR-S2). **DB에는 `sha256(token)` hex만 저장**한다 |
| 왜 세션 토큰은 scrypt가 아닌가 | 토큰은 256bit 난수라 사전·무차별 대입 대상이 아니다. 매 요청마다 scrypt를 돌리면 NFR-P1(20ms)을 즉시 위반한다. **저엔트로피 비밀은 느린 해시, 고엔트로피 난수는 빠른 해시**가 표준 판단이다 |
| 발급 | `expiresAt = now + SESSION_IDLE_TIMEOUT_MIN`, `absoluteExpiresAt = now + SESSION_ABSOLUTE_TIMEOUT_HOURS`. `ip`/`userAgent` 기록 |
| 검증(매 요청) | `session.findUnique({ where: { tokenHash }, include: { user: true } })` **1쿼리**. `revokedAt != null` → 401 `SESSION_EXPIRED` / `now >= expiresAt` 또는 `now >= absoluteExpiresAt` → 401 `SESSION_EXPIRED` / `createdAt > now` → 무효(EX-12-10 시계 역행) |
| 슬라이딩 갱신 | `expiresAt = min(now + idle, absoluteExpiresAt)`. **절대 만료를 넘지 않는다**(AC-12A-7) |
| 쓰기 증폭 방지 | `lastSeenAt`/`expiresAt` 갱신은 **마지막 갱신 후 `idle/10`(기본 12분) 경과 시에만** 수행한다. 매 요청 UPDATE는 SQLite에서 쓰기 락 경합을 만든다. AC-12A-8(유휴 만료 직전 세션의 `lastSeenAt` 갱신)은 12분을 훨씬 넘긴 상태이므로 그대로 통과한다 |
| 무효화(단건) | 로그아웃 — `revokedAt = now` |
| 무효화(전건) | 비밀번호 변경(FR-12-11)·비밀번호 초기화(FR-12-29)·계정 비활성(FR-12-28) — 해당 `userId`의 전 세션 `revokedAt = now`. 비밀번호 **본인 변경 시에는 현재 세션을 즉시 재발급**해 사용자가 튕기지 않게 한다 |
| 정리 | **배치를 만들지 않는다**(요구사항 §9.3). 로그인 성공 시 해당 사용자의 만료·무효 세션만 `deleteMany`. 조회 시점 만료 판정이 최종 방어선이다 |

### 7.4 쿠키 규격과 자체 파서

| 속성 | 값 | 근거 |
|---|---|---|
| 이름 | `cb_session` | — |
| `HttpOnly` | 항상 | XSS 시 토큰 탈취 차단(NFR-S3) |
| `SameSite` | `Lax` | 크로스사이트 비-GET에 전송되지 않음 = CSRF 방어(NFR-S9) |
| `Secure` | `AUTH_COOKIE_SECURE`(기본 `false`, 운영 `true`) | dev는 http |
| `Path` | `/api` | 위젯 전체화면 경로(`/c/:slug`)·정적 자산 요청에 쿠키가 실리지 않는다 |
| `Max-Age` | 절대 만료까지의 초 | 브라우저도 함께 만료시킨다 |

- **읽기**: `cookie-parser` 의존성을 추가하지 않고 `common/auth/lib/cookie.ts`의 `parseCookieHeader(header): Record<string,string>`(순수 함수, 단위 테스트 대상)로 `req.headers.cookie`를 직접 파싱한다. 레이트리미터를 자체 구현한 것(DD-23)과 같은 판단 — 20줄짜리 표준 포맷 파싱에 의존성을 늘리지 않는다.
- **쓰기**: Express `res.cookie()`는 **프레임워크 내장**이라 추가 의존성이 없다. 다만 `AuthController`가 `@Res({ passthrough: true })`로 응답 객체를 만지는 **유일한 컨트롤러**이며, 이 경계를 벗어나지 않는다(§2.1 계층 규약 — 서비스는 HTTP 개념에 의존하지 않는다. `AuthService`는 토큰 문자열만 반환하고 쿠키는 컨트롤러가 세팅한다).

### 7.5 CORS 변경 — ADR-0011 §5를 깨지 않는 방법 (요구사항 ② 확정, DD-48)

**문제**: 현재 `main.ts`의 `app.enableCors()`는 `Access-Control-Allow-Origin: *`이며, 브라우저는 `*` + `credentials`를 **동시에 허용하지 않는다.** 그렇다고 전역을 `credentials: true` + 특정 Origin 반사로 바꾸면 **위젯(다른 도메인의 호스트 페이지)이 공개 API를 호출하지 못해 No.11이 통째로 깨진다.**

**결정: 경로로 분기하는 CORS delegate를 쓴다.**

```
app.enableCors((req, cb) => {
  if (isPublicSurface(req.url))                      // /api/v1/public/*, /api/health
    cb(null, { origin: '*', credentials: false });   // ← 현행 동작 100% 보존
  else if (ADMIN_WEB_ORIGIN 목록에 req.headers.origin 이 있으면)
    cb(null, { origin: req.headers.origin, credentials: true });
  else
    cb(null, { origin: false });                     // ← CORS 헤더를 주지 않음 = 동일 출처만
});
```

| 확인 항목 | 결과 |
|---|---|
| ADR-0011 §5("CORS는 인가 수단이 아니다") | **유지된다.** 공개 API의 인가는 여전히 `PublicOriginGuard`(서버 판정)가 하며, 이 delegate는 공개 경로에 대해 **현행과 완전히 동일한 헤더**를 낸다. 관리자 경로의 인가도 CORS가 아니라 `PermissionGuard`가 한다 — CORS allowlist는 **브라우저 상호운용 설정**일 뿐 인가가 아니다 |
| FR-0-29 / NFR-S10 / AC-P-11 | 공개 경로 분기가 변경 0의 동작을 보장하므로 통과. `test-automation`은 **프리플라이트 응답이 `*`를 유지하는지**를 회귀 케이스로 고정한다 |
| `Vary: Origin` | 관리자 분기는 Origin에 따라 응답 헤더가 달라지므로 **`Vary: Origin`을 반드시 포함**한다(`cors` 미들웨어가 자동 부여하지만 캐시 경유 시 점검 대상) |
| 기본값 | `ADMIN_WEB_ORIGIN` **미설정 = 동일 출처 전용**. 이것이 권장 구성이다 |

**dev 구성(권고 확정)**: `apps/web/vite.config.ts`에 **이미 `/api` → `localhost:3000` 프록시가 존재한다.** `apps/web/.env`의 `VITE_API_BASE_URL`을 `http://localhost:3000/api/v1` → **`/api/v1`** 로 바꾸기만 하면 dev가 동일 출처가 되어 CORS·`credentials` 문제가 **애초에 발생하지 않는다.** 운영(리버스 프록시 동일 출처)과 구성이 일치한다는 점이 더 큰 이득이다.

- ⚠ 이 변경은 `VITE_API_BASE_URL`이 **필수 환경변수**라는 개발명세서 §5.1 표를 바꾸지 않는다(값만 바뀐다).
- ⚠ `apps/widget`의 `VITE_PUBLIC_API_BASE_URL`은 **절대 바꾸지 않는다** — 위젯은 본질적으로 크로스오리진이며 공개 경로만 쓴다.

**Bearer 헤더 방식을 기각한 이유**는 ADR-0014 §대안 표 참고(요약: 토큰을 JS가 읽어야 하므로 `localStorage` 보관 → XSS 1건에 전 계정 탈취, 또는 메모리 보관 → 새로고침마다 로그아웃).

---

## 8. 인가 설계 (No.12-b, J-6 / ADR-0015)

### 8.1 `PermissionGuard` 판정 순서 (FR-12-16)

```
① @Public()(핸들러 또는 클래스)      → 통과
② 쿠키 없음 / 형식 오류               → 401 UNAUTHENTICATED
③ 세션 미존재 / 만료 / revoked        → 401 SESSION_EXPIRED
④ user.status !== 'ACTIVE'            → 401 ACCOUNT_DISABLED
⑤ user.mustChangePassword === true    → 403 PASSWORD_CHANGE_REQUIRED
     (예외 경로: GET /auth/me, POST /auth/password  ※ /auth/logout은 @Public이라 애초에 ①에서 통과)
⑥ @RequirePermission(p) 있음 && !hasPermission(user.role, p)
                                      → 403 FORBIDDEN (+ PERMISSION_DENIED 이력, §9.4)
⑦ 데코레이터 없음                     → 인증만 요구하고 통과
```

- **②·③을 구분하는 이유**: 프런트가 "로그인이 필요합니다"(②)와 "로그인이 만료되었습니다. 다시 로그인해 주세요"(③, S-6 모달)를 다르게 안내해야 한다. 둘 다 401이므로 보안상 노출 차이는 없다.
- **⑥은 리소스 조회보다 먼저다**(FR-12-22, AC-12B-13). NestJS 실행 순서가 `미들웨어 → 가드 → 인터셉터 → 파이프 → 핸들러`이므로 **구조적으로 보장**된다 — 서비스가 `404`를 던질 기회 자체가 없다. 기존 "교차 챗봇 접근은 404"(FR-0-9)는 권한 통과 후 서비스 계층 규칙이라 충돌하지 않는다.
- **⑥ 응답 본문에 요구 권한 문자열을 넣지 않는다**(FR-12-23, AC-12B-7). 서버 로그와 `AuditLog.summary`에는 남긴다.
- 가드는 마지막에 **ALS 컨텍스트에 `actor`를 주입**한다(§8.4).

### 8.2 전역 등록과 `@Public()` — 정확히 5곳 (DD-45)

`AppModule`에 `{ provide: APP_GUARD, useClass: PermissionGuard }`를 등록하고, **11개 컨트롤러의 `@UseGuards(PermissionGuard)`를 제거**한다(FR-12-19). 등록 지점이 1곳이 되어 "가드를 깜빡한 신규 컨트롤러"가 존재할 수 없다(FR-0-24, AC-12B-10).

| # | 경로 | 근거 |
|---|---|---|
| 1 | `GET /api/health` | 헬스체크. 인증을 요구하면 오케스트레이터가 재시작 루프에 빠진다 |
| 2 | `GET /api/v1/public/chatbots/:slug/config` | 최종 사용자 대상(FR-0-29). `PublicRateLimitGuard`+`PublicOriginGuard`가 보호 |
| 3 | `POST /api/v1/public/chatbots/:slug/messages` | 동일 |
| 4 | `POST /api/v1/auth/login` | 인증을 얻는 경로가 인증을 요구할 수 없다. `LoginRateLimitGuard`가 보호 |
| **5** | **`POST /api/v1/auth/logout`** | **요구사항 FR-12-20의 4곳에서 1곳 늘린다.** 근거: ① FR-12-8이 "**이미 만료된 세션으로 호출해도 `204`(멱등)**"를 명시했는데, 인증을 요구하면 만료 세션 로그아웃이 `401`이 되어 요구사항을 만족할 수 없다 ② 로그아웃은 **세션을 파괴만** 하므로 인증 없이 호출해도 공격자가 얻는 것이 없다(쿠키 보유자가 자기 세션을 지울 뿐이며, 쿠키가 없으면 지울 대상 자체가 없다) ③ 프런트가 "세션 만료 → 로그아웃 버튼 → 오류 토스트"라는 모순된 UX를 갖지 않는다 |

> **`test-automation` 인계**: AC-C-4의 고정 개수를 **4 → 5**로 갱신한다. 테스트는 "핸들러 메타데이터에 `IS_PUBLIC`이 있는 핸들러 수 = 5"로 작성하고, **`@Public()`은 클래스가 아니라 핸들러에 부착**한다(공개 대화 컨트롤러도 핸들러 2곳에 각각). 부착 단위가 섞이면 개수 고정 테스트가 의미를 잃는다.

### 8.3 세션·사용자 캐시를 두지 않는다 (DD-42)

FR-12-17은 "캐시를 두더라도 TTL 60초 이내 + 사용자 변경 시 무효화"를 허용하지만, **두지 않는 쪽을 택한다.**

1. **AC-12B-8(역할 강등의 즉시 반영)·AC-12C-9(비활성의 즉시 반영)를 구조로 보장한다.** 캐시를 두면 즉시 반영이 "무효화 호출을 4곳(역할 변경·상태 변경·비밀번호 변경·로그아웃)에서 빠뜨리지 않는 규율"에 의존하게 된다. 규율은 잊히고 구조는 잊히지 않는다.
2. **비용이 낮다.** `sessions.tokenHash`는 유니크 인덱스이며 `include: { user: true }`는 PK 조인 1회다. SQLite에서 1ms 미만이고 NFR-P1(P95 20ms)에 크게 못 미친다.
3. **재검토 트리거**: 다중 인스턴스 전환(개발명세서 §6-4) 또는 P95 20ms 초과가 관측될 때. 그때는 캐시가 아니라 **세션 저장소 자체를 Redis로 옮기는** 판단이 함께 필요하다.

### 8.4 `actor` 전달 — AsyncLocalStorage (요구사항 ⑥ 확정, DD-40)

**제약**: 9개 도메인 모듈의 **서비스 메서드 시그니처를 바꾸지 않아야 한다**(NFR-M7). `chatbots.service.ts`만 해도 쓰기 메서드가 8개이고, 40개 기록 지점 전부에 `actor` 파라미터를 추가하면 **컨트롤러 75곳과 기존 단위·통합 테스트가 전부 바뀐다**.

| 대안 | 판정 |
|---|---|
| 모든 서비스 메서드에 `actor` 파라미터 추가 | **기각** — 변경 표면이 40 서비스 메서드 + 75 컨트롤러 핸들러 + 기존 테스트. 회귀 위험이 이번 그룹 최대 리스크가 된다 |
| Nest **요청 스코프 provider**(`Scope.REQUEST`) | **기각** — 요청 스코프는 **의존성 트리를 타고 전파**된다. `AuditLogService`가 요청 스코프가 되면 그것을 주입하는 9개 서비스가 전부 요청 스코프가 되고, 다시 그 서비스가 주입하는 `DialogueBundleService`·`RateLimitStore`까지 요청마다 재생성된다. **번들 캐시(DD-22)와 레이트리밋 카운터(DD-23)가 무력화**되어 ADR-0007/ADR-0011의 설계가 무너진다 |
| 서비스가 `Request`를 주입 | **기각** — §2.1 계층 규약 위반(서비스의 HTTP 개념 의존 금지), FR-0-26 정면 위반 |
| **`AsyncLocalStorage`(`node:async_hooks`)** | **채택** — Node 내장(의존성 0), 싱글턴 서비스 유지, 서비스 시그니처 불변, 테스트에서는 `runWith({ actor })`로 손쉽게 주입 |

```ts
// common/request-context/request-context.service.ts
interface RequestContext { actor: AuthenticatedActor | null; ip?: string; userAgent?: string; requestPath: string; }
class RequestContextService {
  run<T>(ctx: RequestContext, fn: () => T): T;       // 미들웨어가 호출
  setActor(actor: AuthenticatedActor): void;          // 가드가 인증 성공 후 호출
  get(): RequestContext | undefined;                  // AuditLogService만 호출한다
}
```

**규약 3건**(`code-reviewer` 점검 항목)

1. `RequestContextService.get()`을 호출해도 되는 곳은 **`AuditLogService` 1곳뿐**이다. 도메인 서비스가 직접 호출하면 "숨은 전역 상태"가 되어 기각한 대안들과 같은 문제가 생긴다.
2. 컨텍스트가 비어 있어도(배치·seed·테스트) **예외를 던지지 않는다.** `actorId=null` + `actorEmail='system'`으로 기록한다(FR-13-10).
3. `@CurrentUser()` 데코레이터는 **컨트롤러 전용**이다(본인 비밀번호 변경·자기수정 판정 등 actor가 **비즈니스 인자**인 경우). 이때는 서비스 시그니처에 `actorId`를 명시적으로 넘긴다 — 감사 기록용 암묵 전달과 비즈니스 인자를 섞지 않는다.

### 8.5 데코레이터 타입 축소 (FR-12-18)

```ts
export const RequirePermission = (permission: Permission): MethodDecorator & ClassDecorator => ...
```

`permission: string` → `permission: Permission`. **기존 75곳의 문자열 값은 한 글자도 바꾸지 않는다**(부록 A-2/A-5의 불일치도 그대로 둔다 — 값 변경은 75곳 재검토의 신호탄이며 EDITOR가 두 권한을 모두 갖는 매핑에서 동작 차이가 없다). 유니온에 없는 문자열은 **빌드가 실패**한다(AC-12B-9, EX-12-13).

---

## 9. 감사로그 설계 (No.13, J-4 / ADR-0016)

### 9.1 `AuditLogService.record()` — 단일 진입점 (FR-13-1, DD-38)

```ts
interface AuditRecordInput {
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string;
  targetName?: string | null;
  chatbotId?: string | null;
  before?: unknown;          // 도메인 엔터티(스냅샷 전 원본) — 서비스가 그대로 넘긴다
  after?: unknown;
  summary?: string;
  actorOverride?: { id: string | null; email: string; role: string | null };  // auth 경로 전용
}
class AuditLogService { async record(input: AuditRecordInput): Promise<void>; }
```

- **`before`/`after`는 화이트리스트 스냅샷으로 변환된 뒤 저장된다**(§9.6). 호출부는 "무엇을 기록하지 말지"를 기억할 필요가 없다 — `ConversationLogService`가 PII 마스킹을 내부에서 수행하는 것(ADR-0013)과 동일한 구조적 안전장치다. **단, 요약 액션(`BULK_DELETE`/`IMPORT`)은 예외다 — §9.6 말미 참조.**
- **`actor`는 인자가 아니다.** ALS에서 읽는다(§8.4). 예외는 `actorOverride`로, 로그인 **실패** 이력처럼 "인증되지 않은 주체"를 기록해야 하는 auth 경로 전용이다.
- **전체가 `try/catch`로 감싸여 있고 모든 예외를 삼키며 `logger.warn`만 남긴다**(FR-13-13, AC-13-13). 경고 로그에 `before`/`after` 내용을 넣지 않는다(NFR-S8).
- **`prisma.auditLog.create`를 이 서비스 밖에서 호출하지 않는다**(NFR-M3). `code-reviewer` 점검 항목.

### 9.2 트랜잭션 경계 — "커밋 후 기록"으로 통일 (요구사항 ⑤ 확정, DD-41)

요구사항 FR-13-12(같은 트랜잭션에서 기록)와 FR-13-13(기록 실패가 본 동작을 실패시키지 않음)은 **트랜잭션 내부 기록에서 서로 모순된다.** 트랜잭션 안에서 기록 실패를 삼키려면 예외를 잡아야 하는데, 그러면 트랜잭션이 이미 오염된 상태로 커밋을 시도하게 된다(Postgres 전환 시 `current transaction is aborted`로 **본 동작까지 실패**한다 — 개발명세서 §6-4가 예정한 전환이다).

**확정: 감사 기록은 항상 본 동작 성공(커밋) 직후 별도 쓰기로 수행한다.**

| 요구 | 충족 방식 |
|---|---|
| FR-13-12("본 동작이 롤백되면 이력도 남지 않아야 한다") | **충족.** 커밋 후에만 기록하므로 롤백된 변경은 애초에 기록되지 않는다. AC-13-14(유효성 오류 요청은 이력 없음)도 자동 충족 |
| FR-13-13("기록 실패가 본 동작을 실패시키지 않는다") | **충족.** 별도 쓰기이므로 실패를 삼켜도 본 동작에 영향이 없다 |
| 역방향 결손(본 동작 성공 + 기록 실패) | **수용한다.** FR-13-13이 명시적으로 허용한 트레이드오프이며, 경고 로그로 관측된다 |
| `beforeValue` 확보 | **변경 전에 캡처한다.** 대부분의 쓰기 메서드가 이미 존재 확인용 `findUnique`를 수행하고 있어 추가 조회가 거의 필요 없다(요구사항 §4.2.1 근거 4). 삭제 경로는 삭제 전 조회 결과를 스냅샷으로 들고 있는다 |
| `await` 여부 | **`await` 한다.** 대화로그(`void this.logService.record(...)`)와 달리 관리자 API는 저지연 요구가 낮고(목록 300ms 예산), 감사 기록은 "남았는지"가 기능 자체다. 단일 INSERT 1건이라 NFR-P3(20% 이내)에 여유가 크다 |

### 9.3 `targetType` 값과 명명 규칙

`targetType`은 **Prisma 모델명(PascalCase)과 1:1**로 둔다 — 개발명세서 §3 엔터티 표에서 바로 찾을 수 있고, 새 모듈이 생겨도 규칙이 자명하다. 화면 표시용 한글 라벨은 `AUDIT_TARGET_LABELS`(shared-types)가 단일 소스다.

> **백필 불가 안내**: 기록 시작 시점 이전의 변경은 **DB 어디에도 원천 데이터가 없어** 복원이 불가능하다(요구사항 §9.3). 이력 화면 상단에 "이력 기록은 YYYY-MM-DD부터 시작되었습니다" 안내를 고정 표시한다(`ui-designer` 인계).

### 9.4 인증·인가 이력의 기록 주체 (FR-0-27의 명시적 예외)

| 이력 | 기록 주체 | 비고 |
|---|---|---|
| `LOGIN` / `LOGIN_FAILED` | `AuthService`(서비스 계층) | `targetType='Session'`, `targetId`=세션 ID 또는 `'-'`. `ip`/`userAgent` 기록. **`LOGIN_FAILED`는 시도된 이메일만** 기록하고 비밀번호는 어떤 형태로도 남기지 않는다(FR-13-8, AC-12A-14) |
| `LOGOUT` | `AuthService` | 유효 세션이 있었을 때만 기록(멱등 호출은 기록 없음) |
| `PERMISSION_DENIED` | **`PermissionGuard`**(가드) | 서비스 계층 규약의 예외임을 §2.1에 명시한다. 가드 외에는 이 동작을 알 수 있는 지점이 없다 |

**`PERMISSION_DENIED` 폭증 방지(FR-13-9, NFR-P7, DD-46)**: 승격한 `RateLimitStore`를 그대로 써서 `key = audit:denied:{userId}:{method} {path}`, `limit = 1`, `window = 60_000`으로 `consume()` 한다. 허용되면 기록하고, 거부되면 건너뛴다. **전용 dedupe 저장소를 새로 만들지 않는다** — 토큰버킷 저장소는 정확히 이 형태의 문제를 푸는 도구이며, 다중 인스턴스 전환 시 교체 지점도 1곳으로 유지된다.

`summary`에 `"{METHOD} {path} · 요구 권한 {permission}"`을 담는다(응답 본문에는 넣지 않는다 — FR-12-23).

### 9.5 소급 대상 40개 기록 지점 (요구사항 ⑦ 확정, FR-13-2)

> 각 행은 **서비스 메서드 1곳에 `record()` 호출 1~2줄**을 추가하는 작업이다. `chatbotId` 열이 ✓인 지점은 반드시 함께 기록한다(FR-13-6 — 없으면 챗봇별 이력 조회가 성립하지 않는다).

**① `chatbot-groups.service.ts` (4)**

| 메서드 | action | targetType | targetName | chatbotId |
|---|---|---|---|---|
| `create` | `CREATE` | `ChatbotGroup` | `group.name` | — |
| `update` | `UPDATE` | `ChatbotGroup` | `group.name` | — |
| `remove` | `DELETE` | `ChatbotGroup` | 삭제 전 `name` | — |
| `copy` | `COPY` | `ChatbotGroup` | 새 그룹 `name` | — |

**② `chatbots.service.ts` (8)**

| 메서드 | action | targetName | chatbotId |
|---|---|---|---|
| `create` | `CREATE` | `chatbot.name` | ✓(자기 자신) |
| `updateSettings` | `UPDATE` | `chatbot.name` | ✓ |
| `updateSkin` | `UPDATE` | `chatbot.name` | ✓ |
| `updateStatus` | **`STATUS_CHANGE`** | `chatbot.name` | ✓ |
| `moveGroup` | `UPDATE` | `chatbot.name` | ✓ |
| `copy` | **`COPY`** | 새 챗봇 `name` | ✓(새 챗봇) |
| `archive` | **`DELETE`** | `chatbot.name` | ✓ |
| `permanentDelete` | **`PURGE`** | 삭제 전 `name` | ✓ |

> `archive`(`DELETE`)와 `permanentDelete`(`PURGE`)의 구분이 AC-13-4다. ADR-0002가 권한까지 나눈 두 동작이 이력에서 같아지면 안 된다.

**③ `intents.service.ts` (6)** — `targetType='Intent'`, `chatbotId` 전부 ✓

`create`→`CREATE` / `update`→`UPDATE` / `updateExamples`→`UPDATE`(summary에 예문 증감) / `remove`→`DELETE` / `bulkDelete`→**`BULK_DELETE`**(배치 1건) / `importCommit`→**`IMPORT`**(배치 1건)

**④ `keywords.service.ts` (5)** — `targetType='Keyword'`, `chatbotId` ✓ : `create`/`update`/`remove`/`bulkDelete`/`importCommit`

**⑤ `homonyms.service.ts` (3)** — `targetType='HomonymDictionary'`, `chatbotId` ✓ : `create`/`update`/`remove`
> `test()`는 **기록하지 않는다**(DB 무변경 진단 경로).

**⑥ `contexts.service.ts` (3)** — `targetType='ContextVariable'`, `chatbotId` ✓ : `create`/`update`/`remove`

**⑦ `dialog-nodes.service.ts` (4)** — `targetType='DialogNode'`, `chatbotId` ✓ : `create`/`update`/`copy`→**`COPY`**/`remove`
> `validate()`/`flow()`는 조회이므로 기록하지 않는다.

**⑧ `faqs.service.ts` (5)** — `targetType='FaqEntry'`, `chatbotId` ✓ : `create`/`update`/`remove`/`bulkDelete`/`importCommit`

**⑨ `channels.service.ts` (2)** — `targetType='Channel'`, `targetId`=채널 `id`, `targetName`=채널 타입 라벨, `chatbotId` ✓

| 메서드 | action |
|---|---|
| `upsert` | 레코드 존재 여부로 **`CREATE` 또는 `UPDATE`** 분기. `enabled` 값이 바뀌면 `STATUS_CHANGE` 대신 `UPDATE` + `summary`로 표기(채널은 상태 머신이 아니다) |
| `remove` | `DELETE` (멱등 `204` — **레코드가 없으면 기록하지 않는다**) |

**신규 모듈의 기록 지점(FR-13-3, 소급 아님)**

| 모듈 | 지점 |
|---|---|
| `users` | `create`→`CREATE` / `update`→`UPDATE`(역할 변경 시 summary 명시) / `updateStatus`→**`STATUS_CHANGE`** / `resetPassword`→`UPDATE`(+summary `"비밀번호 초기화"`) |
| `banned-words` | `create`/`update`/`remove` |
| `auth` | `LOGIN` / `LOGIN_FAILED` / `LOGOUT`(§9.4) |
| `common/auth` 가드 | `PERMISSION_DENIED`(§9.4) |

**기록하지 않는 것**(범위 통제 장치): 모든 조회(`list`/`findOne`/`export`/`suggest`/`flow`/`validate`), 시뮬레이션·비교(`simulation`), 임포트 **dry-run**(`importValidate` — 커밋만 기록), 공개 대화 API 전체, 템플릿 다운로드, `stats`.

### 9.6 스냅샷·diff·대량 요약

**화이트리스트 스냅샷**(`lib/audit-snapshot.ts`, 순수 함수 — FR-13-11, NFR-S8)

```ts
const AUDIT_FIELDS: Record<AuditTargetType, readonly string[]> = {
  Chatbot:           ['name','slug','status','groupId','description','avatarUrl'],
  ChatbotGroup:      ['name','description'],
  Intent:            ['name','description','exampleCount'],          // ← examples 원문이 아니라 건수
  Keyword:           ['name','synonymCount'],
  HomonymDictionary: ['word','policy','meaningCount'],
  ContextVariable:   ['name','slotCount','cancelWords','timeoutSec'],
  DialogNode:        ['name','nodeType','priority','enabled','outputCount','intentIds','keywordIds','contextVariableId'],
  FaqEntry:          ['question','category','enabled','altQuestionCount'],
  Channel:           ['type','enabled'],
  User:              ['email','name','role','status'],               // ← passwordHash 절대 없음
  BannedWord:        ['word','matchType','policy','enabled'],
  Session:           [],                                             // 인증 이력은 before/after를 쓰지 않는다
};
```

- **원문 대량 필드는 건수로 대체한다**(`examples`→`exampleCount`, `outputs`→`outputCount`). 의도 1건의 예문 12건을 통째로 넣으면 8KB 상한을 금방 넘고, AC-13-3("삭제 직전 값으로 무엇을 복구할지 안다")에는 **무엇이 몇 개 있었는지**로 충분하다. 완전 복원은 No.25(버전 이력)의 책임이다(요구사항 §9.2).
- **`User` 스냅샷에 `passwordHash`가 물리적으로 들어갈 수 없다**(화이트리스트에 없다) — FR-12-33/AC-12C-11을 구조로 보장한다.
- 직렬화 결과가 `AUDIT_LIMITS.snapshotBytes`(8KB)를 넘으면 **필드를 뒤에서부터 잘라내고** `{ ..., __truncated: true }`를 남긴다(EX-13-11).

**diff**(`lib/audit-diff.ts`): `changedFields = before/after 스냅샷의 키 합집합 중 값이 다른 키`. 상세 응답(FR-13-18)에 실어 보내 **프런트가 변경된 필드만 좌/우 대비**로 렌더한다. `simulation/lib/compare-diff.ts`는 **재사용하지 않는다** — 그쪽은 아웃풋 시퀀스 비교라 자료구조가 다르다(요구사항이 "재사용 검토"라 했으나 검토 결과 부적합).

**대량 작업 요약**(FR-13-5, AC-13-5/6): `bulkDelete`·`importCommit`은 **배치 1건**으로 기록하고 `afterValue`에 `{ created, updated, deleted, fileName?, targetIds: string[](최대 50), truncated }`를 담는다. `summary`에는 `"대량 등록 / 의도 / 신규 4,812건·갱신 188건"` 형태의 한 줄을 넣어 목록에서 바로 읽히게 한다(S-14).

**⚠ 요약 액션은 화이트리스트 대상이 아니다** (FR-13-11 ↔ §9.6 충돌 해소, 2026-09-21 확정 — ADR-0016 §7)

`action`이 **`BULK_DELETE` / `IMPORT`**인 경우 `record()`는 `buildSnapshot(targetType, ...)`을 **적용하지 않고** 서비스가 구성한 요약 객체를 그대로 저장한다. 도메인 화이트리스트를 그대로 적용하면 요약 전용 키(`created`/`updated`/`deleted`/`targetIds`/`truncated`)가 **도메인 엔터티 필드가 아니라는 이유로 전부 걸러져** `afterValue`가 `{}`가 되고, FR-13-5/AC-13-5·6(대량 작업 1건 요약)이 성립하지 않는다.

- **필드 제한 역할은 고정 요약 스키마 자체가 수행한다.** 요약 객체에 허용되는 값은 **건수(number)·엔터티 UUID 배열·boolean·업로드 파일명**뿐이며, **도메인 엔터티의 필드값(질문/답변/예문/동의어 원문, 개인정보, 대화 원문)을 어떤 형태로도 넣지 않는다.** 이것이 NFR-S8을 만족시키는 실제 장치다.
- `targetIds`는 **엔터티 ID(UUID)만** 담는다(최대 `AUDIT_LIMITS.bulkTargetIds`=50, 초과 시 `truncated: true`). 이름·본문 등 표시용 문자열을 섞지 않는다.
- `summary` 한 줄에도 **건수와 고정 라벨만** 넣는다(대상 이름 나열 금지). 요약 액션에는 `targetName`을 설정하지 않는다.
- `fileName`은 선택 필드다(현재 구현은 담지 않는다). 담을 경우 업로드 원본 파일명만 넣고 파일 **내용**은 넣지 않는다.
- **8KB 상한·절단(`serializeSnapshot`)은 요약 액션에도 동일하게 적용**된다 — 우회되는 것은 화이트리스트 한 가지뿐이다.
- 이 예외 분기는 `AuditLogService.record()` **내부 1곳**에만 존재한다(NFR-M3의 단일 지점 원칙 유지). 요약 액션을 추가할 때는 이 분기와 본 절·ADR-0016 §7을 함께 갱신한다.
- `code-reviewer` 점검 항목: 요약 액션 호출부 **6곳**(`intents`/`keywords`/`faqs` × `bulkDelete`·`importCommit`)의 `after` 객체가 위 값 종류 외의 것을 담지 않는지 전수 확인.

### 9.7 조회 설계 (FR-13-15~19)

- **기간 판정 순수 함수** `lib/audit-range.ts`: `resolveRange(from?, to?, maxDays)` → `{ from, to, defaulted }` 또는 `AUDIT_RANGE_TOO_WIDE` 위반. 기본 30일, 상한 `AUDIT_QUERY_MAX_RANGE_DAYS`(기본 90). **경계 판정은 UTC로 하고 화면 표시만 `Asia/Seoul`** (개발명세서 §4.1).
- **정렬은 `createdAt desc` 고정**이다. `sort`/`order` 쿼리를 받지 않는다(FR-13-16) — 감사 목적상 다른 기본 정렬이 의미가 없고, 정렬 자유도를 열면 인덱스 전략(§2.2)이 무너진다.
- `q`는 **`targetName` 부분 일치**만 본다(대상명 검색). `beforeValue`/`afterValue` 본문 검색은 제공하지 않는다(풀스캔 유발 + PII 유입 경로).
- **`/export`(P2)**: `dialogue-common/import/lib/csv-writer.ts` 재사용, 기간 필터 필수, 최대 10,000행. 일정 압박 시 후속 Phase로 이관 가능(§15).

---

## 10. 금지어 필터 설계 (No.12-d, J-3)

### 10.1 순수 함수 계약 (`banned-words/lib/banned-word-filter.ts`)

```ts
interface BannedWordEntry { word: string; wordNormalized: string; matchType: 'EXACT'|'CONTAINS'; policy: 'BLOCK'|'WARN'; }
export function detect(text: string, dict: readonly BannedWordEntry[]): BannedWordEntry[];
export function decide(matches: readonly BannedWordEntry[]): 'PASS' | 'WARN' | 'BLOCK';
export function maskText(text: string, matches: readonly BannedWordEntry[]): string;
```

| 항목 | 규격 |
|---|---|
| 탐지 기준 | `normalizeText()`(NFKC·trim·소문자·연속공백 축약, ADR-0006) 적용 후 비교. `CONTAINS`=부분 문자열 포함, `EXACT`=공백 분리 토큰 완전 일치 |
| 정규식 금지 | 사전 값은 **리터럴 문자열로만** 취급한다. 정규식 메타문자를 이스케이프하거나 `indexOf` 기반 비교를 쓴다(NFR-S12, AC-12D-9) |
| 마스킹 기준 | **NFKC + 소문자만 적용한 사본**에서 위치를 찾아 **원문의 같은 인덱스**를 `***`로 치환한다. 연속공백 축약을 쓰지 않으므로 인덱스가 1:1로 보존된다 |
| 알려진 한계 | 공백 변형(`X X`)은 **탐지(=차단/경고)되지만 마스킹은 놓칠 수 있다.** 차단이 우선 적용되므로 사용자에게 도달하지 않는다. 이 한계를 함수 헤더 주석에 명시한다 |
| 조기 반환 | `dict.length === 0`이면 즉시 `[]` 반환(FR-12-46, AC-12D-6). 정규화조차 수행하지 않는다 |
| 성능 | 사전 1,000건 기준 5ms 이내(NFR-P6). `enabled=false` 항목은 캐시 적재 시점에 제외한다 |

**캐시**(`banned-word.cache.ts`): `DialogueBundleCache`와 **동일 패턴** — TTL(`BANNED_WORD_CACHE_TTL_MS`, 기본 60초) + **쓰기 시 즉시 무효화**(AC-12D-8, EX-12-28). 전역 사전 1벌이므로 키가 없는 단일 슬롯 캐시다.

### 10.2 대화 파이프라인 적용 2지점 (FR-12-38/40/41)

`PublicConversationService.sendMessage()`의 기존 흐름에 **2단계만** 삽입한다. **`resolveTurn()` 호출 규약(FR-0-19)과 `packages/dialogue-engine`은 변경 0줄이다.**

```
① access.resolve(slug)
② adapter.normalizeInbound(dto)
②.5 ★ 입구 필터 — 사용자 텍스트(message 또는 buttonAction.kind==='MESSAGE'의 text)를 판정
      ├ BLOCK → 엔진을 호출하지 않고 고정 안내 아웃풋(TEXT 1건) 반환 + state 보존 + 로그 적재(blockedByFilter=true)
      └ WARN/PASS → 원문 그대로 ③으로 진행(마스킹한 입력을 엔진에 넣지 않는다 — FR-12-39)
③ bundleService.getCached → ④ resolveTurn → ⑤ adapter.renderOutbound
⑤.5 ★ 출구 필터 — outputs의 사용자 노출 문자열 전부를 마스킹(정책 무관·차단 없음, FR-12-40)
⑥ 응답 반환 → ⑦ 로그 적재(void, 기존과 동일)
```

| 항목 | 규격 |
|---|---|
| 입구 대상 | `message` 텍스트, `buttonAction.kind==='MESSAGE'`의 `text`(EX-12-27). **`NODE` 버튼의 `nodeId`/`label`은 대상이 아니다**(사용자 입력이 아니라 봇이 제공한 선택지) |
| `BLOCK` 시 상태 | `nextState`는 **요청에 실려온 상태를 그대로 반환**한다. 슬롯이 채워지지 않고 세션도 끊기지 않는다(EX-12-26) |
| 출구 대상 | `lib/output-text-fields.ts`의 화이트리스트 — TEXT 본문, CARD 제목/본문, BUTTON 라벨 등 **사용자에게 보이는 모든 문자열**. ⚠ 이 목록은 기존 `conversation/lib/conversation-log.ts`의 `buildBotResponseText()`가 추출하는 필드 집합과 **반드시 일치**해야 한다(둘이 어긋나면 "로그에는 남는데 화면에는 마스킹된" 상태가 된다). **단일 소스로 통합**하고 `buildBotResponseText`가 이 목록을 참조하도록 리팩터링한다 |
| 시뮬레이션 | **적용하지 않는다**(FR-12-42, AC-12D-5). `simulation` 모듈은 `BannedWordFilterService`를 주입받지 않는다 — 구조적으로 불가능하게 둔다. 화면 캡션은 `ui-designer` 인계 |
| 엔진 | `packages/dialogue-engine`은 금지어를 알지 못한다(FR-12-41). 필터는 `apps/api` 경계에만 존재한다 |

### 10.3 `BLOCK`은 오류가 아니라 정상 200 응답이다

차단 시 `403`/`400`을 반환하지 않고 **고정 안내 아웃풋을 담은 정상 `200`** 을 반환한다.

1. 위젯(FR-W-*)은 `200` 경로에서만 말풍선을 그린다. 오류 코드로 내려보내면 위젯이 **"일시적 오류" 문구**를 띄워 사용자가 원인을 알 수 없다.
2. S-11이 요구하는 것은 "바람직하지 않은 표현이 포함되어 있습니다. 다시 입력해 주세요"라는 **대화 턴**이지 오류 화면이 아니다.
3. `apps/widget` 수정 0줄 원칙(FR-U-10)을 지킬 수 있다.

### 10.4 로그 적재 시 마스킹 순서 (FR-12-45)

**금지어 마스킹 → PII 마스킹** 순서로 처리하며, **두 마스킹 모두 `ConversationLogService.record()` 내부에서 수행**한다. ADR-0013이 세운 "마스킹은 서비스 내부 단 1곳" 규약을 **확장 유지**하는 것이다 — 호출부가 마스킹을 기억해야 하는 설계는 반드시 잊힌다.

- `ConversationLogService`가 `BannedWordFilterService`를 주입받는다(`ConversationModule`이 `BannedWordsModule`을 import).
- 출구 필터로 **이미 마스킹된 outputs**에서 만들어진 `rawBotResponse`는 금지어 마스킹이 사실상 no-op이 된다(멱등). 문제가 되지 않는다.
- `blockedByFilter=true`, `isAnswered=false`로 적재한다(AC-12D-2). **원문은 어디에도 남기지 않는다** — 경고 로그·trace·예외 메시지 포함(NFR-S4 상속).

---

## 11. 레이트리미터 `common/` 승격 (요구사항 ⑧ 확정, DD-43)

| 항목 | 내용 |
|---|---|
| 이동 | `conversation/rate-limit.store.ts` → `common/rate-limit/rate-limit.store.ts`, `conversation/lib/rate-limiter.ts`(+`.spec.ts`) → `common/rate-limit/lib/rate-limiter.ts` |
| 승격 근거 | PII 마스킹과 동일한 승격 규칙("소비자가 2곳 이상"). 이번 Phase에 소비자가 **3곳**이 된다 — `PublicRateLimitGuard`(기존), `LoginRateLimitGuard`(FR-12-6), `PERMISSION_DENIED` 합치기(DD-46) |
| 모듈 | `@Global() RateLimitModule`이 `{ provide: 'RateLimitStore', useClass: InMemoryRateLimitStore }`를 제공·export. **`ConversationModule`의 동일 provider 등록은 제거**한다 |
| 호환 | 주입 토큰 문자열 `'RateLimitStore'`와 `consume()` 시그니처는 **불변**이다. `PublicRateLimitGuard`는 import 경로만 바뀐다 |
| 전역 인스턴스화 주의 | 승격으로 인스턴스가 **1개로 통합**된다. 키 네임스페이스가 겹치지 않도록 접두사 규약을 둔다 — `public:session:*` / `public:ip:*`(기존) · `login:ip:*`(신규) · `audit:denied:*`(신규) |
| 확장성 | 개발명세서 §5의 "단일 인스턴스 전제 상태는 인터페이스로 추상화" 항목을 계속 만족한다(교체 지점 1곳) |

**로그인 레이트리밋**(FR-12-6): `LoginRateLimitGuard`가 `POST /auth/login`에만 부착되고 `key=login:ip:{clientIp}`, `limit=LOGIN_RATE_LIMIT_IP_PER_MIN`(기본 20), `window=60_000`. 초과 시 `429 RATE_LIMITED` + `Retry-After`. 클라이언트 IP 산출은 기존 `conversation/lib/client-ip.ts`(`TRUST_PROXY` 반영)를 **`common/rate-limit/lib/client-ip.ts`로 함께 이동**해 재사용한다.

> **계정 잠금과 IP 레이트리밋은 별개 장치다.** 잠금(5회/15분, `User.lockedUntil`)은 **DB 영속**이라 재기동에도 유지되고, IP 레이트리밋은 **인메모리**로 폭주 트래픽을 막는다. 둘 다 있어야 "한 계정을 여러 IP에서"와 "한 IP에서 여러 계정을" 모두 막힌다.

---

## 12. 프런트엔드 인계 제약 (`apps/web`) — `ui-designer` 입력

> 화면 설계는 `ui-designer`가 한다. 아래는 **아키텍처가 고정하는 제약**이다.

| # | 제약 |
|---|---|
| F-1 | `/login`은 `TopBar`·`UnsavedGuardProvider` **바깥의 독립 라우트**다(FR-U-1). `App.tsx`의 라우트 트리를 `<Routes>` 최상단에서 인증/비인증으로 가른다 |
| F-2 | 앱 부팅 시 `GET /auth/me` **1회**로 세션을 확인한다. 응답 전에는 라우트를 렌더하지 않고 로딩 상태를 표시한다(깜빡임·잘못된 403 화면 방지). 미인증이면 `/login?returnTo=<원경로>`(FR-U-2) |
| F-3 | `AuthContext`가 **유일한 인증 상태 소유자**이며 `can(permission: Permission)`을 제공한다(FR-U-3). **컴포넌트가 역할 문자열을 비교하지 않는다.** 권한 목록은 `/auth/me` 응답값을 쓰고 `ROLE_PERMISSIONS` 상수를 프런트에서 재계산하지 않는다(서버가 최종 판정자 — NFR-S6) |
| F-4 | 쓰기 액션은 권한이 없으면 **렌더하지 않는다**(비활성이 아니라 숨김, FR-U-4). 페이지 단위 거부는 **403 안내 화면**(FR-U-5) |
| F-5 | `client.ts`의 `request()`와 **`postForm()` 양쪽**에 `credentials: 'include'`를 적용한다(FR-U-9, AC-U-9). `postForm`이 별도 `fetch`라 누락되기 쉬운 지점이다 — 동일 출처 구성에서도 명시적으로 넣어 구성 변경에 견디게 한다 |
| F-6 | `401` 훅(현재 주석만 있는 빈 블록, `client.ts:22-25`)을 실제로 구현한다. **화면을 전환하지 않고** 재로그인 모달을 띄우며, 재인증 성공 시 모달만 닫고 원래 요청을 재시도할 수 있게 한다(FR-U-6, AC-U-4). 편집 중 dirty 상태를 건드리지 않는다 |
| F-7 | `403`은 토스트/인라인 오류로 안내하고 **로그아웃시키지 않는다**(FR-U-7) |
| F-8 | `mustChangePassword=true`면 **비밀번호 변경 화면으로 고정**하고 다른 라우트로 이동할 수 없게 한다(FR-12-13) |
| F-9 | `VITE_API_BASE_URL`을 **`/api/v1`(동일 출처)** 로 바꾼다(§7.5). Vite 프록시는 이미 존재하므로 코드 변경이 아니라 `.env` 값 변경이다 |
| F-10 | 신규 화면 3종은 기존 공용 컴포넌트를 재사용한다(FR-U-11). 문구는 `MESSAGES` 1곳(FR-U-12) |
| F-11 | 비밀번호 정책 실시간 안내는 `shared-types`의 `validatePasswordPolicy()`를 **그대로 호출**한다(FE/BE 동일 판정, NFR-A3) |
| F-12 | `apps/widget`은 **수정하지 않는다**(FR-U-10, AC-U-10) |

**`ui-designer`가 판단할 항목**(아키텍처가 정하지 않음): 로그인 화면 레이아웃, 최초 비밀번호 변경 화면, 세션 만료 모달, 403 안내 화면, `TopBar` 사용자 메뉴와 `시스템 설정` 정보구조, 회원/금지어/이력 3화면, **챗봇 상세의 7번째 탭 추가 여부**(FR-13-23 — 현재 6탭으로 과밀하므로 링크 이동도 가능), 빈 상태 3종.

---

## 13. 회귀 위험 관리

### 13.1 이 그룹의 회귀 위험 순위

| 순위 | 위험 | 완화 |
|---|---|---|
| 1 | **기존 통합 테스트 2종이 전부 401** | §13.2 인증 헬퍼를 **가드 전역 등록과 같은 커밋**에서 도입 |
| 2 | **감사 소급 40지점의 누락** | §9.5 표를 체크리스트로 사용. AC-13-7(9개 모듈 최소 1케이스)로 테스트 고정. `code-reviewer`가 쓰기 메서드 전수 대조 |
| 3 | **CORS 변경이 위젯/공개 API를 깨뜨림** | §7.5 경로 분기 + AC-P-1~15 전량 재실행(AC-C-6) |
| 4 | **`@Public()` 오남용으로 인가 우회** | 개수 고정 테스트 5(AC-C-4) + 코드리뷰 |
| 5 | **성능 회귀**(가드 1쿼리 + 감사 1 INSERT) | NFR-P1/P3을 `test-automation`이 측정(AC-13-16) |

### 13.2 통합 테스트 인증 헬퍼 (NFR-M4)

```
apps/api/src/integration/helpers/auth.helper.ts
  seedUsers(prisma)                 → ADMIN/EDITOR/VIEWER 3계정(해시는 테스트 전용 저비용 파라미터)
  loginAs(app, role)                → 실제 POST /auth/login 호출 후 Set-Cookie 문자열 반환
  withAuth(req, cookie)             → supertest 요청에 Cookie 헤더 부착
```

- **실제 로그인 경로를 타게 한다.** 세션 레코드를 직접 INSERT하는 우회 헬퍼를 만들면 인증 경로 자체의 회귀를 놓친다.
- 각 스펙의 수정은 **기계적 1~2줄**이어야 한다(`.set('Cookie', cookie)` 추가). 이를 넘어서는 수정이 필요하면 설계가 잘못된 것이므로 `system-architect`로 되돌린다.
- 테스트 전용 scrypt 파라미터: `PASSWORD_HASH_COST`류 환경변수를 **만들지 않는다**(운영에서 약한 값이 설정될 위험). 대신 헬퍼가 **동일 해시를 1회 생성해 재사용**한다(3계정 × 1회 = ~300ms, 허용 범위).

---

## 14. 환경변수 (개발명세서 §5.1 확장)

**신규 9종 — 전부 선택, 기본값 있음**(FR-0-30, AC-C-5). `config/env.validation.ts`의 `EnvSchema`에 추가한다.

| 변수 | 기본값 | 용도 |
|---|---|---|
| `SESSION_IDLE_TIMEOUT_MIN` | `120` | 유휴 만료(분). 슬라이딩 갱신 기준 |
| `SESSION_ABSOLUTE_TIMEOUT_HOURS` | `12` | 절대 만료(시간). 갱신 불가 |
| `LOGIN_MAX_FAILURES` | `5` | 계정 잠금 임계 |
| `LOGIN_LOCKOUT_MIN` | `15` | 잠금 지속(분) |
| `LOGIN_RATE_LIMIT_IP_PER_MIN` | `20` | 로그인 IP 분당 상한 |
| `AUDIT_QUERY_MAX_RANGE_DAYS` | `90` | 이력 조회 기간 상한 |
| `BANNED_WORD_CACHE_TTL_MS` | `60000` | 금지어 사전 캐시 TTL |
| `AUTH_COOKIE_SECURE` | `false` | 운영은 `true`(HTTPS 전제) |
| `ADMIN_WEB_ORIGIN` | 미설정 | 콤마 구분 allowlist. **미설정 = 동일 출처 전용**(§7.5) |

**seed 전용 2종**(`prisma/seed.ts`에서만 읽으며 `EnvSchema` 대상이 아니다 — API 기동 조건이 되어서는 안 된다)

| 변수 | 기본값 | 용도 |
|---|---|---|
| `BOOTSTRAP_ADMIN_EMAIL` | `admin@chat-bot.local` | 초기 ADMIN 이메일(FR-12-14) |
| `BOOTSTRAP_ADMIN_PASSWORD` | `ChangeMe!2026` | 초기 비밀번호. `mustChangePassword=true`로 생성 |

> **사용자 0명 경고**(FR-12-14, AC-12A-12): API 기동 시 `users` 건수가 0이면 **경고 로그**를 남기고 정상 기동한다. 기동 실패로 만들지 않는다 — 기동 실패 조건을 늘리지 않는다는 개발명세서 §5 원칙이 우선이며, 컨테이너 재시작 루프가 더 나쁜 장애다.

### 14.1 seed 전략 (NFR-M5)

| 데이터 | 내용 |
|---|---|
| 사용자 3명 | `BOOTSTRAP_ADMIN_*`의 ADMIN 1 + `editor@chat-bot.local`(EDITOR) + `viewer@chat-bot.local`(VIEWER). 권한별 수동 검증용. **ADMIN만 `mustChangePassword=true`**, 나머지 2명은 `false`(수동 검증 시 매번 변경 화면에 막히면 검증이 불가능하다) |
| 금지어 3~5건 | `BLOCK` 2건 · `WARN` 1~2건 · `EXACT` 1건(매칭 타입 차이 확인용). **실제 비속어 대신 `테스트금지어1` 같은 중립 문자열**을 쓴다 — 저장소에 비속어 사전을 커밋하지 않는다 |
| 세션 | **만들지 않는다**(로그인으로만 생성되어야 한다) |
| 감사로그 | **만들지 않는다**(FR-13-2 검증의 전제 — 실제 동작으로만 생성되어야 "기록되고 있음"을 증명할 수 있다) |

---

## 15. 이 Phase에서 하지 않는 것 (아키텍처 관점 재확인)

요구사항 §9의 제외 항목을 **아키텍처 결과로** 재확인한다. 아래는 전부 "만들지 않았다"가 **코드/스키마로 검증 가능**하다.

| 항목 | 아키텍처적 귀결 |
|---|---|
| MFA(J-2) | `User`에 MFA 컬럼 **0개**. 확장 지점은 `LoginResponseSchema.status` 판별 필드 1개뿐 |
| SSO/OAuth/SAML/LDAP | 인증 provider 추상화를 **만들지 않는다**. 소비자가 없는 인터페이스는 만들지 않는 선례(ADR-0011 §어댑터 판단) |
| 사용자 그룹(조직) 테이블(J-7) | 테이블 0개. 75개 핸들러의 스코프 필터 변경 0건 |
| 커스텀 역할 / `Role`·`Permission` 테이블(J-6) | 테이블 0개. 매핑은 `ROLE_PERMISSIONS` 상수 1곳(ADR-0015) |
| 비밀번호 재설정 메일 / SMTP | 발송 코드 0줄. ADMIN 수동 초기화로 대체 |
| API 키 / 서비스 계정 | 인증 방식 1종(세션)만 존재 |
| 기기 목록 / 원격 세션 종료 UI | `Session` 조회 API **0개**(테이블은 있으나 관리 표면이 없다) |
| Redis 세션 저장소 / 만료 정리 배치 | 스케줄러 도입 0건. 로그인 시 정리 + 조회 시 판정 |
| 챗봇별 금지어 사전 / AI 유해표현 탐지 | `BannedWord`에 `chatbotId` 컬럼 **없음**. GPU 경로 0건 |
| 관리자 콘솔 입력 금지어 필터(J-3) | 9개 도메인 모듈의 저장 경로에 필터 호출 **0건** |
| **레거시 API 연동 상세 로그(J-5, DD-47)** | `ApiCallLog` 테이블 **만들지 않는다**. No.26 착수 시 별도 설계 — 보존기간·용량·마스킹 요건이 감사로그와 충돌하므로 같은 테이블에 섞지 않는다 |
| 감사로그 보존기간 정책 / 아카이브 배치 | 무한 보존 + **조회 기간 상한**(FR-13-17)으로 운영. **운영 리스크로 명시**(EX-13-9), No.45로 이관 |
| 이력 기반 롤백/복원 | `beforeValue`는 **건수 요약을 포함한 부분 스냅샷**이라 복원에 쓸 수 없다(§9.6). 복원은 No.25의 본체 |
| 이력 서명/해시 체인 | append-only + 수정·삭제 API 부재로 애플리케이션 수준 통제만 |
| 조회(READ) 이력 기록 | 기록 지점 40곳은 **전부 쓰기 경로**다 |
| `/audit-logs/export`(P2) | 일정 압박 시 **후속 Phase로 이관 가능**. 이관해도 다른 AC가 깨지지 않도록 컨트롤러 1개 메서드로 격리한다 |

---

## 16. 요구사항 ↔ 설계 추적표 (발췌)

| 요구사항 | 설계 위치 |
|---|---|
| J-1 / FR-12-1~15 / NFR-S2·S3 | §7, **ADR-0014** |
| J-6 / FR-0-24·25 / FR-12-16~23 | §8, **ADR-0015** |
| J-4 / FR-13-1~14 / NFR-M3·M7 | §9, **ADR-0016** |
| J-3 / FR-12-35~46 | §10 |
| J-5 / J-7 / J-2 | §15(제외 확인), §3.4 |
| DD-33~DD-37 | §3.1 |
| DD-38 / DD-41 | §9.1, §9.2 |
| DD-39 | §4.1 |
| DD-40(FR-0-26, NFR-M7) | §8.4 |
| DD-43(FR-12-6) | §11 |
| DD-45(FR-12-20) | §8.2 |
| DD-48(CORS·ADR-0011 §5) | §7.5 |
| FR-13-2 소급 40지점 | §9.5 |
| FR-U-1~12 | §12 |
| NFR-M4(기존 테스트) | §13.2 |
| §10 상위 문서 정정 | §3.4, §5.2, §5.3, §6, §14 |

---

## 17. 개발명세서 §5·§6·§7 갱신분

**§5 보안 문단 정정**

> "금지어/비속어 필터(사전 매칭, No.12 — 적용 지점은 *입력 수신 직후*와 *응답 반환 직전* 2곳, **관리자 시뮬레이션에는 적용하지 않는다**), 로그인 정책(**MFA는 1차 범위 제외** — 시크릿 관리 방식 미결정, `security-audit-설계.md` §15), RBAC(**역할 3종 고정, 역할→권한 매핑은 `shared-types` 코드 상수 — ADR-0015**). **관리자 API는 전역 fail-closed 가드로 보호되며 공개 경로 5곳만 `@Public()`으로 opt-out 한다. 세션은 서버 보관 불투명 토큰 + httpOnly 쿠키이며 비밀번호는 Node 내장 `scrypt`로 해시한다(ADR-0014). 전 도메인의 쓰기 동작은 `AuditLogService` 단일 진입점을 통해 `AuditLog`에 기록된다(ADR-0016).**"

**§6 결정사항 추가 3건**

> 19. **세션 기반 인증과 자격증명 보관 방식 확정(2026-09-21)**: 서버 보관 불투명 세션 토큰(`Session` 테이블) + httpOnly·SameSite=Lax 쿠키로 확정하고 JWT를 기각한다. 비밀번호는 신규 의존성 없이 Node 내장 `crypto.scrypt`(N=2^15, r=8, p=1, maxmem 64MiB)로 해시하며 파라미터를 해시 문자열에 포함해 재해싱 경로를 남긴다. CORS는 경로 분기 delegate로 공개 API의 현행 동작(`*`, 무자격증명)을 보존한 채 관리자 경로만 `ADMIN_WEB_ORIGIN` allowlist + `credentials`를 연다. dev는 이미 존재하는 Vite `/api` 프록시로 동일 출처를 구성한다. → **ADR-0014**
> 20. **권한 모델의 코드 상수화와 fail-closed 전역 가드 확정(2026-09-21)**: `Role`/`Permission` 테이블을 만들지 않고 역할 3종 고정 + 역할→권한 매핑을 `packages/shared-types`의 `ROLE_PERMISSIONS` 상수로 둔다. 권한 문자열은 `Permission` 유니온 14종이 단일 소스이며 `@RequirePermission` 인자 타입이 이를 강제한다. `PermissionGuard`를 `APP_GUARD`로 전역 등록해 기본 보호 상태로 만들고, 공개 경로 5곳만 `@Public()`으로 명시 opt-out 한다. → **ADR-0015**
> 21. **감사로그 소급 범위·기록 단위·기록 위치 확정(2026-09-21)**: 기존 9개 도메인 모듈 40개 쓰기 지점에 전면 소급한다. 기록은 각 서비스가 `AuditLogService.record()`를 명시 호출하며(인터셉터 기각), **본 동작 커밋 직후 별도 쓰기**로 수행해 FR-13-12/13의 모순을 해소한다. `actor`는 `AsyncLocalStorage` 요청 컨텍스트로 전달해 9개 모듈의 서비스 시그니처를 바꾸지 않는다(요청 스코프 provider는 싱글턴 캐시를 파괴하므로 기각). 대량 작업은 배치 1건 요약, `before`/`after`는 필드 화이트리스트 스냅샷(8KB 상한)이다. API 연동 상세 로그는 `AuditLog`에서 분리해 No.26의 `ApiCallLog`로 이관한다. → **ADR-0016**

**§7 인덱스 추가**

| 문서 | 대상 |
|---|---|
| **`security-audit-설계.md`** | **보안/이력 No.12~13 — Prisma 변경안(`User` 확장·`Session`·`BannedWord` 신설·`AuditLog` 보강), shared-types 배치(`security.ts` 재정비·`audit.ts` 신설), 19개 엔드포인트 명세, 4+3 모듈 구조, 세션 인증·전역 RBAC 가드·`AsyncLocalStorage` actor 전달·감사 소급 40지점·금지어 2지점 필터·레이트리미터 승격, 프런트 인증 제약, seed** |
| `decisions/ADR-0014-session-auth.md` | 세션 기반 인증 · 쿠키 규격 · scrypt · CORS 경로 분기 |
| `decisions/ADR-0015-role-permission-model.md` | 역할/권한 코드 상수화 · `Permission` 유니온 · fail-closed 전역 가드 |
| `decisions/ADR-0016-audit-log-backfill-scope.md` | 감사 소급 범위 · 기록 단위 · 기록 위치와 트랜잭션 경계 · actor 전달 · `ApiCallLog` 분리 |
