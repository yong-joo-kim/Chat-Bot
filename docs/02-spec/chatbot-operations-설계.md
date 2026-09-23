# 챗봇 운영관리 (No.1~4) — 세부 설계서

> **상위 문서**: `docs/02-spec/개발명세서.md` (§2 모노레포 구조, §3 데이터모델, §4 API, §5 비기능, §6 결정사항)
> **입력 문서**: `docs/requirements/chatbot-operations.md` (요구사항 정의서, FR/AC/EX 식별자 원본)
> **준수 기준**: `docs/03-design/UIUX_준수기준.md`
> **관련 ADR**: `decisions/ADR-0001` ~ `ADR-0004`
> **작성**: system-architect · 2026-09-19 · **다음 단계**: `ui-designer` → `backend-implementer` → `frontend-implementer`

이 문서는 개발명세서를 **대체하지 않고 확장**한다. 개발명세서 §3/§4의 명명 규칙(엔터티 PascalCase, 테이블 snake_case `@@map`, REST `/api/v1/`, zod 단일 소스)을 그대로 따른다.

---

## 1. 범위와 전제

| 항목 | 내용 |
|---|---|
| 대상 기능 | No.1 챗봇 리스트/그룹 관리, No.2 대시보드, No.3 챗봇 기본설정, No.4 스킨/임베드 설정 |
| GPU 필요도 | 전부 1 → **`apps/api` + Prisma 단독 동기 처리**. `apps/ml-worker`/Job Queue 불필요 (개발명세서 §1 설계원칙) |
| `packages/dialogue-engine` | 이 Phase에서는 사용하지 않음(대화 처리 Phase에서 진입) |
| `packages/llm-provider` | 사용하지 않음. 단 **배포형태 중립**(구축형/구독형) 제약은 환경변수 주입 규칙(§8)으로 만족 |
| DB | SQLite (개발명세서 §6-4). Postgres 전환 대비 제약은 NFR-M2 → 원시 SQL은 `stats.service.ts` 한 곳으로 격리 |
| 쓰기 경로 없는 데이터 | `ConversationLog`는 **읽기(집계) 전용**. 생성은 대화 엔진 Phase |

---

## 2. 설계 결정 요약

요구사항 정의서 §5.4가 제기한 이슈 D-1~D-5와 설계 과정에서 추가로 확정한 항목이다.

| ID | 이슈 | 결정 | 근거 |
|---|---|---|---|
| **D-1** | 접속수 산정 기준 | **A안 채택** — `ConversationLog.sessionId String?` 추가, `visitCount = COUNT(DISTINCT sessionId) + COUNT(sessionId IS NULL)` | ADR-0001 |
| **D-2** | 집계 인덱스 | **추가** — `conversation_logs(chatbotId, createdAt)`. 부수적으로 `chatbots(groupId, status)`, `chatbots(updatedAt)` | ADR-0001 §결과 |
| **D-3** | 영구 삭제 참조 무결성 | **암묵 cascade 금지** — 전 관계에 `onDelete: Restrict, onUpdate: Cascade` 명시 + 서비스 사전 검사 409 + FK 예외(P2003) 409 매핑 | ADR-0002 |
| **D-4** | 동시 수정 충돌 | Phase 1 last-write-wins. 모든 응답에 `updatedAt` 포함(향후 낙관적 잠금 확장 지점) | 요구사항 §5.4 D-4 수용 |
| **D-5** | seed 데이터 | **3-트랙 시드**(데이터 보유 / 로그 0건 / 보관+과거로그) + 멱등 재실행 | §10 |
| **D-6** | API 버저닝 | `setGlobalPrefix('api')` + `enableVersioning(URI, default '1')` → `/api/v1/*`. `health`는 `VERSION_NEUTRAL`로 `/api/health` 유지 | ADR-0003 |
| **D-7** | 위젯 base URL 환경변수 | `WIDGET_BASE_URL`, `PUBLIC_API_BASE_URL` 2종. 부팅 시 필수 검증(EX-4-3) | §8 |
| **D-8** | 오류 응답 봉투 | 전역 `AllExceptionsFilter` + `ApiErrorCode` enum. `details[].field` 항상 제공 | ADR-0003 |
| **D-9** | 영구 삭제 엔드포인트 | `DELETE /chatbots/:id?permanent=true` 대신 **`POST /chatbots/:id/permanent-delete`** (body `confirmName` 서버 재검증) | ADR-0002 |
| **D-10** | 선택 필드 "값 지우기" | 부분 수정에서 **명시적 `null` = 삭제**, `undefined`(키 없음) = 미변경 | §7.4 |
| **D-11** | 대시보드 집계 방식 | DB `groupBy` 2회 + 원시 SQL 1회 → 애플리케이션 순수 함수로 정규화·병합(NFR-M3) | ADR-0004 |

---

## 3. 데이터 모델 변경 (개발명세서 §3 확장)

### 3.1 Prisma 스키마 변경 (`apps/api/prisma/schema.prisma`)

#### (1) `ConversationLog` — 세션 식별자 + 집계 인덱스

```prisma
model ConversationLog {
  id              String   @id @default(uuid())
  chatbotId       String
  chatbot         Chatbot  @relation(fields: [chatbotId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  channelType     String
  /// 대화 세션 식별자(No.2 대시보드 visitCount 산정 근거, ADR-0001).
  /// 대화 처리 Phase에서 채워진다. Phase 1에는 seed 데이터만 값을 가진다.
  sessionId       String?
  userMessage     String
  botResponse     String
  matchedIntentId String?
  isAnswered      Boolean  @default(true)
  createdAt       DateTime @default(now())

  @@index([chatbotId, createdAt])
  @@map("conversation_logs")
}
```

#### (2) `Chatbot` — 목록 조회 인덱스 + 관계 정책 명시

```prisma
model Chatbot {
  // ... 기존 필드 변경 없음 ...
  group ChatbotGroup @relation(fields: [groupId], references: [id], onDelete: Restrict, onUpdate: Cascade)

  @@index([groupId, status])
  @@index([updatedAt])
  @@map("chatbots")
}
```

#### (3) 전 하위 엔터티 관계 — `onDelete: Restrict, onUpdate: Cascade` 명시

`Intent`, `Keyword`, `HomonymDictionary`, `DialogNode`, `ContextVariable`, `FaqEntry`, `Channel`, `ConversationLog`, `UnansweredQuestion`의 `chatbot` 관계에 동일 옵션을 **명시적으로** 기재한다.

> **중요**: Prisma의 required relation 기본 동작이 이미 `RESTRICT/CASCADE`이며, 실제 `migration.sql`(`20260919001312_init`) 154행에도 `ON DELETE RESTRICT ON UPDATE CASCADE`로 생성되어 있음을 확인했다. 따라서 **이 명시는 DDL 변경을 유발하지 않는 문서화 목적**이다(ADR-0002). 후속 Phase에서 누군가 무심코 `onDelete: Cascade`로 바꾸지 못하도록 의도를 스키마에 고정한다.

#### (4) `status` enum 미도입 유지

SQLite는 네이티브 enum이 없어 `status String @default("DRAFT")`을 유지한다. 값 제약은 **zod `ChatbotStatus`가 단일 소스**이며, DB→DTO 매핑 계층(§7.5)에서 파싱 실패 시 `DRAFT` 폴백 + 경고 로그로 방어한다.

### 3.2 마이그레이션 영향 분석

| 항목 | 내용 |
|---|---|
| 마이그레이션 이름(권장) | `add_conversation_session_and_indexes` |
| DDL | ① `ALTER TABLE "conversation_logs" ADD COLUMN "sessionId" TEXT;` ② `CREATE INDEX "conversation_logs_chatbotId_createdAt_idx" ...` ③ `CREATE INDEX "chatbots_groupId_status_idx" ...` ④ `CREATE INDEX "chatbots_updatedAt_idx" ...` |
| **기존 데이터 호환성** | `sessionId`는 **nullable, 기본값 없음** → 기존 행 백필 불필요, 무중단 적용 가능. 현재 dev DB에는 `conversation_logs` 행이 0건이라 실질 영향 없음 |
| 되돌리기 | 컬럼/인덱스 드롭만으로 복구 가능(파괴적 변경 없음) |
| SQLite 테이블 재생성 | 발생하지 않음(FK 정책이 기존과 동일하므로 Prisma가 `ALTER TABLE ADD COLUMN`만 생성). 만약 diff에 테이블 재생성 SQL이 보이면 **FK 옵션을 잘못 적은 것**이므로 재검토할 것 |
| Postgres 전환 시 | 동일 DDL이 그대로 유효. `(chatbotId, createdAt)` 인덱스는 Postgres에서도 동일 효과 |
| 실행 절차 | `pnpm --filter @chatbot/api exec prisma migrate dev --name add_conversation_session_and_indexes` → `prisma generate` → `prisma db seed` |

### 3.3 개발명세서 §3 엔터티 표 보강

`ConversationLog` 행의 설명을 "대화 원문 로그(통계/학습현황 소스) — **세션 식별자 `sessionId` 보유(No.2 접속수 산정)**"로 갱신한다.

---

## 4. `packages/shared-types` 스키마 배치

요구사항 §5.2가 제안한 10종 + 설계상 추가 필요분이다. **파일 배치 원칙**: 도메인 응집을 우선해 챗봇 관련 스키마는 기존 `chatbot.ts`에 섹션 주석과 함께 append하고, **여러 도메인이 공유하는 횡단 관심사(페이지네이션/오류/정렬/안전 URL)만 신규 `common.ts`로 분리**한다. (요구사항 문서는 "기존 파일 미수정"을 권장했으나, `ChatbotSchema`를 `.pick()/.partial()`로 파생하는 스키마를 다른 파일에 두면 순환 import와 "정의 위치 탐색 비용"이 커져 채택하지 않는다.)

### 4.1 신규 파일 `packages/shared-types/src/common.ts`

| 익스포트 | 정의 | 근거 FR |
|---|---|---|
| `SortOrder` | `z.enum(['asc','desc'])` | FR-1-9 |
| `PaginationQuerySchema` | `{ page: coerce.number().int().min(1).default(1), pageSize: coerce.number().int().min(1).max(100).default(20) }` | FR-0-5 |
| `paginated<T>(item)` | `z.object({ items: z.array(item), total, page, pageSize })` 제네릭 헬퍼 함수 | FR-0-5 |
| `ApiErrorCode` | `z.enum([...])` — §5.4 코드표 | FR-0-3 |
| `ApiErrorSchema` | `{ statusCode: number, code: ApiErrorCode, message: string, details?: { field, message }[] }` | FR-0-3, AC-5-2 |
| `SafeUrlSchema` | `z.string().url().refine(v => /^https?:\/\//i.test(v), 'http 또는 https 주소만 사용할 수 있습니다.')` | **NFR-S3, AC-3-4** |
| `csvEnumArray(enumSchema)` | `?status=DRAFT,ACTIVE` 형태의 콤마 구분 쿼리를 배열로 전처리하는 헬퍼 | FR-1-9 |

> `SafeUrlSchema`가 반드시 필요한 이유: zod의 `.url()`은 `new URL()` 기반이라 **`javascript:alert(1)`을 통과시킨다**. AC-3-4(400 기대)를 충족하려면 스킴 화이트리스트 refine이 필수다.

`index.ts`에 `export * from './common';`을 **최상단 첫 줄**에 추가한다(다른 파일이 참조하므로).

### 4.2 `packages/shared-types/src/chatbot.ts` 변경

**(a) 기존 스키마 보강 (변경)**

| 대상 | 변경 | 근거 |
|---|---|---|
| `RESERVED_SLUGS` (신규 상수) | `['api','admin','www','health','static','assets','widget','new','edit'] as const` | FR-3-6 |
| `SlugSchema` (신규) | `z.string().min(3).max(50).regex(/^[a-z0-9-]+$/, '소문자/숫자/하이픈만 사용할 수 있습니다.').refine(s => !RESERVED_SLUGS.includes(s), '사용할 수 없는 예약어입니다.')` | FR-3-5, FR-3-6 |
| `ChatbotSchema.slug` | 인라인 정의 → `SlugSchema` 참조로 교체 | 동일 규칙 단일화 |
| `ChatbotSchema.avatarUrl` | `z.string().url()` → `SafeUrlSchema` | NFR-S3 |
| `ChatbotSkinSchema.logoUrl` | `z.string().url()` → `SafeUrlSchema` | NFR-S3 |
| `UpdateChatbotSettingsSchema` | `.partial()` 결과에 `avatarUrl`, `description`을 **`.nullable()`** 로 확장 | D-10(값 지우기) |
| `UpdateChatbotSkinSchema` | `.partial()` 결과에 `logoUrl`을 **`.nullable()`** 로 확장 | FR-4-7(기본값 되돌리기 시 로고 제거) |
| `DEFAULT_CHATBOT_SKIN` (신규 상수) | `{ primaryColor: '#4F46E5', headerTitle: '챗봇 상담' }` — Prisma 기본값 문자열과 **같은 값을 참조**하도록 API가 이 상수를 사용 | FR-1-8, AC-4-6 |
| `CHATBOT_STATUS_TRANSITIONS` (신규 상수) | `{ DRAFT: ['ACTIVE','ARCHIVED'], ACTIVE: ['ARCHIVED'], ARCHIVED: ['DRAFT'] }` — FE/BE 공용(버튼 비활성 판단) | FR-1-17, AC-1-13 |

**(b) 신규 스키마 (추가)**

| 스키마 | 정의 | 근거 FR |
|---|---|---|
| `UpdateChatbotGroupSchema` | `CreateChatbotGroupSchema.partial()` (`description` nullable) | FR-1-4 |
| `ChatbotGroupWithCountSchema` | `ChatbotGroupSchema.extend({ chatbotCount: z.number().int().nonnegative() })` | FR-1-2 |
| `CopyChatbotGroupSchema` | `{ name?: string.min(1).max(100) }` | FR-1-7 |
| `ChatbotListQuerySchema` | `PaginationQuerySchema.extend({ groupId?: uuid, status?: csvEnumArray(ChatbotStatus), q?: string.max(100), sort: z.enum(['createdAt','updatedAt','name']).default('updatedAt'), order: SortOrder.default('desc'), includeArchived: queryBoolean().default(false) })` | FR-1-9, FR-1-10, FR-0-5 |
| `ChatbotListItemSchema` | `ChatbotSchema.extend({ groupName: z.string() })` — 목록 행에 소속 그룹명 표시 | FR-1-11 |
| `CopyChatbotSchema` | `{ targetGroupId?: uuid, name?: string, slug?: SlugSchema }` | FR-1-13 |
| `UpdateChatbotStatusSchema` | `{ status: ChatbotStatus }` | FR-1-17 |
| `MoveChatbotGroupSchema` | `{ groupId: uuid }` | FR-1-12 |
| `PermanentDeleteChatbotSchema` | `{ confirmName: z.string().min(1) }` | FR-1-15(b), D-9 |
| `SlugAvailabilityQuerySchema` | `{ slug: z.string(), excludeChatbotId?: uuid }` | FR-3-7 |
| `SlugAvailabilitySchema` | `{ slug, available: boolean, reason?: z.enum(['FORMAT','RESERVED','TAKEN']), message: string }` | FR-3-7, AC-3-6 |
| `EmbedCodeSchema` | `{ pc: string, mobile: string, publicUrl: string, scriptUrl: string }` | FR-4-9, FR-4-14 |

> `SlugAvailabilityQuerySchema.slug`는 **`SlugSchema`가 아니라 raw string**이다. 형식 위반 입력도 400이 아니라 `available: false, reason: 'FORMAT'`으로 응답해야 실시간 피드백 UX(FR-3-7)가 성립한다.
> `excludeChatbotId`는 요구사항 문서에 없던 보강 항목이다 — 자기 자신의 현재 slug를 재확인할 때 "이미 사용 중"으로 표시되는 오탐을 막는다.

### 4.3 `packages/shared-types/src/stats.ts` 변경

| 대상 | 변경 | 근거 |
|---|---|---|
| `ConversationLogSchema` | `sessionId: z.string().optional()` 추가 | ADR-0001 |
| `DashboardQuerySchema` (신규) | `{ chatbotId: uuid, from?: z.coerce.date(), to?: z.coerce.date(), topN: z.coerce.number().int().min(1).max(10).default(5) }` | FR-2-5, FR-2-4 |
| `DashboardSummarySchema` | `totalLogCount: z.number().int().nonnegative()`, `visitCountBasis: z.enum(['SESSION','LOG_COUNT'])` 추가 | FR-2-1 캡션, FR-2-12 "집계 건수" 배지 |

> `visitCountBasis`: 기간 내 로그에 `sessionId`가 **하나도 없으면 `'LOG_COUNT'`**, 하나라도 있으면 `'SESSION'`을 반환한다. UI 카드 캡션 문구(FR-2-1)를 서버 상태에 맞게 자동 전환하기 위한 필드다.

---

## 5. API 설계 (개발명세서 §4 확장)

### 5.1 공통 규약

| 항목 | 규칙 |
|---|---|
| 베이스 경로 | `/api/v1` (`setGlobalPrefix('api')` + URI 버저닝 기본값 `1`, ADR-0003) |
| 검증 | `ZodValidationPipe`(body) / `ZodQueryPipe`(query). `strip` 모드로 미정의 필드 제거(FR-0-2) |
| 목록 응답 | `{ items, total, page, pageSize }` (FR-0-5) |
| 날짜 | 요청/응답 모두 ISO-8601 UTC 문자열(FR-0-6) |
| 오류 | `{ statusCode, code, message, details?: [{ field, message }] }` (FR-0-3) |
| 권한 훅 | 모든 변경 계열 핸들러에 `@RequirePermission('chatbot:write')`, 조회 계열에 `@RequirePermission('chatbot:read')` 데코레이터를 **지금 부착**한다. Phase 1의 `PermissionGuard`는 항상 통과하는 no-op이며 No.12에서 구현만 채운다(NFR-S5) |

### 5.2 엔드포인트 명세 (총 19)

#### 그룹 (`chatbot-groups`)

| # | 메서드 · 경로 | 요청 | 응답(200/201) | 오류 |
|---|---|---|---|---|
| 1 | `POST /chatbot-groups` | `CreateChatbotGroupSchema` | `201` `ChatbotGroupWithCountSchema` | 400 |
| 2 | `GET /chatbot-groups` | `PaginationQuerySchema`(정렬 `createdAt asc` 고정) | `paginated(ChatbotGroupWithCountSchema)` | 400 |
| 3 | `GET /chatbot-groups/:id` | — | `ChatbotGroupWithCountSchema` | 404 |
| 4 | `PATCH /chatbot-groups/:id` | `UpdateChatbotGroupSchema` | `ChatbotGroupWithCountSchema` | 400 / 404 |
| 5 | `DELETE /chatbot-groups/:id` | — | `204` | 404 / **409 `GROUP_NOT_EMPTY`**(message에 잔여 수 포함, FR-1-5) |
| 6 | `POST /chatbot-groups/:id/copy` | `CopyChatbotGroupSchema` | `201` `ChatbotGroupWithCountSchema` | 404 / 409 |

#### 챗봇 (`chatbots`)

| # | 메서드 · 경로 | 요청 | 응답 | 오류 |
|---|---|---|---|---|
| 7 | `POST /chatbots` | `CreateChatbotSchema` | `201` `ChatbotSchema` | 400 / 404(`groupId`) / 409 `DUPLICATE_SLUG` |
| 8 | `GET /chatbots` | `ChatbotListQuerySchema` | `paginated(ChatbotListItemSchema)` | 400 |
| 9 | `GET /chatbots/slug-available` | `SlugAvailabilityQuerySchema` | `SlugAvailabilitySchema` | 400(slug 누락) |
| 10 | `GET /chatbots/:id` | — | `ChatbotSchema` | 404 |
| 11 | `PATCH /chatbots/:id/settings` | `UpdateChatbotSettingsSchema` | `ChatbotSchema` | 400 / 404 / 409 `DUPLICATE_SLUG` \| `CHATBOT_ARCHIVED` |
| 12 | `PATCH /chatbots/:id/skin` | `UpdateChatbotSkinSchema` | `ChatbotSchema` | 400 / 404 / 409 `CHATBOT_ARCHIVED` |
| 13 | `PATCH /chatbots/:id/status` | `UpdateChatbotStatusSchema` | `ChatbotSchema` | 400 `INVALID_STATUS_TRANSITION` / 404 |
| 14 | `PATCH /chatbots/:id/group` | `MoveChatbotGroupSchema` | `ChatbotSchema` | 404(챗봇/그룹) |
| 15 | `POST /chatbots/:id/copy` | `CopyChatbotSchema` | `201` `ChatbotSchema` | 404 / 409 |
| 16 | `DELETE /chatbots/:id` | — | `204` (= `ARCHIVED` 전환) | 404 |
| 17 | `POST /chatbots/:id/permanent-delete` | `PermanentDeleteChatbotSchema` | `204` | 400(`confirmName` 불일치) / 404 / 409 `CHATBOT_NOT_ARCHIVED` \| `CHATBOT_HAS_CHILDREN` |
| 18 | `GET /chatbots/:id/embed-code` | — | `EmbedCodeSchema` | 404 / 500 `CONFIG_ERROR` |

#### 통계 (`stats`)

| # | 메서드 · 경로 | 요청 | 응답 | 오류 |
|---|---|---|---|---|
| 19 | `GET /stats/dashboard` | `DashboardQuerySchema` | `DashboardSummarySchema` | 400 `INVALID_PERIOD` / 404 / 503 `AGGREGATION_TIMEOUT` |

> **라우트 선언 순서 주의**: NestJS는 선언 순서로 매칭하므로 `@Get('slug-available')`을 반드시 `@Get(':id')` **앞에** 선언해야 한다. 그렇지 않으면 `slug-available`이 `id`로 해석되어 404가 난다.

### 5.3 개발명세서 §4 표 갱신

§4의 "챗봇 운영관리" 행을 다음으로 갱신한다.

```
| 챗봇 운영관리 | `/chatbot-groups`(+`/:id/copy`), `/chatbots`(+`/:id/settings|skin|status|group|copy|permanent-delete|embed-code`, `/slug-available`) | 1, 3, 4 |
| 통계 | `GET /stats/dashboard`, `/stats/usage`, `/stats/training-status` | 2, 14, 15 |
```

### 5.4 `ApiErrorCode` 코드표

| code | HTTP | 발생 지점 | 사용자 메시지(기본) |
|---|---|---|---|
| `VALIDATION_FAILED` | 400 | zod 파이프 | "입력값을 확인해 주세요." + `details[]` |
| `RESERVED_SLUG` | 400 | slug refine | "사용할 수 없는 예약어입니다." |
| `INVALID_STATUS_TRANSITION` | 400 | 상태 전이 | "{from} 상태에서 {to} 상태로 바꿀 수 없습니다." |
| `INVALID_PERIOD` | 400 | 대시보드 기간 | "조회 기간을 확인해 주세요(최대 366일)." |
| `CONFIRM_NAME_MISMATCH` | 400 | 영구 삭제 | "챗봇 이름이 일치하지 않습니다." |
| `NOT_FOUND` | 404 | 전 리소스 | "요청하신 대상을 찾을 수 없습니다." |
| `DUPLICATE_SLUG` | 409 | 생성/수정/복사 | "이미 사용 중인 고유 URL입니다. 다른 값을 입력해 주세요." |
| `GROUP_NOT_EMPTY` | 409 | 그룹 삭제 | "소속 챗봇 {n}개를 먼저 이동하거나 삭제해 주세요." |
| `CHATBOT_ARCHIVED` | 409 | 설정/스킨 수정 | "보관된 챗봇은 수정할 수 없습니다. 초안으로 되돌린 뒤 수정해 주세요." |
| `CHATBOT_NOT_ARCHIVED` | 409 | 영구 삭제 | "보관 처리한 챗봇만 영구 삭제할 수 있습니다." |
| `CHATBOT_HAS_CHILDREN` | 409 | 영구 삭제 | "연결된 데이터({항목} {n}건)가 있어 삭제할 수 없습니다." |
| `CONFIG_ERROR` | 500 | 임베드 코드 | "서버 설정(WIDGET_BASE_URL)이 누락되었습니다. 관리자에게 문의해 주세요." |
| `AGGREGATION_TIMEOUT` | 503 | 대시보드 | "지금은 통계를 불러올 수 없습니다. 잠시 후 다시 시도해 주세요." |
| `INTERNAL_ERROR` | 500 | 기타 | "처리 중 오류가 발생했습니다." |

---

## 6. NestJS 모듈 구조 (개발명세서 §2 확장)

`backend-implementer`가 그대로 따라갈 수 있는 파일 단위 구조다.

```
apps/api/src/
├── app.module.ts                        # (수정) ChatbotGroupsModule, ChatbotsModule, StatsModule 등록
├── main.ts                              # (수정) enableVersioning + 전역 필터/파이프 등록 (ADR-0003)
├── config/
│   └── env.validation.ts                # (신규) zod로 env 검증 — DATABASE_URL, API_PORT,
│                                        #        WIDGET_BASE_URL, PUBLIC_API_BASE_URL (EX-4-3)
├── common/
│   ├── zod-validation.pipe.ts           # (신규) body 검증 — ZodError → details[{field,message}]
│   ├── zod-query.pipe.ts                # (신규) query 검증(coerce 포함)
│   ├── api.exception.ts                 # (신규) ApiException(code, status, message, details?)
│   ├── all-exceptions.filter.ts         # (신규) ApiException/HttpException/Prisma P2002·P2003 → 오류 봉투
│   ├── pagination.ts                    # (신규) toPaginated(items,total,query) 헬퍼
│   └── auth/
│       ├── permission.guard.ts          # (신규) Phase 1 no-op — 항상 통과 (NFR-S5)
│       └── require-permission.decorator.ts
├── chatbot-groups/
│   ├── chatbot-groups.module.ts
│   ├── chatbot-groups.controller.ts     # 엔드포인트 1~6
│   ├── chatbot-groups.service.ts        # CRUD + 삭제 사전검사(409) + 그룹 복사 트랜잭션
│   └── chatbot-groups.mapper.ts         # Prisma row(+_count) → ChatbotGroupWithCount
├── chatbots/
│   ├── chatbots.module.ts               # exports: ChatbotsService (StatsModule이 존재검증에 사용)
│   ├── chatbots.controller.ts           # 엔드포인트 7~18
│   ├── chatbots.service.ts              # CRUD/상태전이/복사/보관/영구삭제/그룹이동
│   ├── chatbot.mapper.ts                # Prisma row ↔ DTO (skin JSON parse/stringify, null↔undefined,
│   │                                    #                   status 파싱 폴백)
│   ├── embed-code.service.ts            # 임베드 스니펫 생성(조회 시점 생성, FR-4-13)
│   └── lib/                             # ── 순수 함수(DB 무의존, 단위 테스트 대상) ──
│       ├── slug.util.ts                 # 형식/예약어 검증, 사본 slug 파생(EX-1-7)
│       ├── copy-name.util.ts            # "{원본명} (사본)" 파생 + 100자 클램프
│       ├── status-transition.ts         # 허용 전이 판정
│       └── skin.util.ts                 # parseSkin/mergeSkin/serializeSkin (EX-4-1 폴백)
└── stats/
    ├── stats.module.ts
    ├── stats.controller.ts              # 엔드포인트 19
    ├── stats.service.ts                 # ★ 원시 SQL은 이 파일에만 존재(NFR-M2)
    └── lib/
        ├── dashboard-period.ts          # resolvePeriod(from,to,now) — Asia/Seoul 경계(FR-2-7)
        └── dashboard-aggregator.ts      # 순수 집계 함수(NFR-M3, AC-2-1~2-4)
```

**계층 책임 경계 (NFR-M2)**

- `controller`: 경로/파이프/가드/HTTP 상태코드만. Prisma 타입을 절대 노출하지 않는다.
- `service`: Prisma 직접 의존 허용. 비즈니스 규칙(전이/중복/무결성)의 **단일 진입점**(FR-0-7 — 향후 `AuditLog` 기록 지점).
- `mapper`: Prisma row ↔ zod DTO 변환 전담. `null → undefined`, `skin: string → object` 변환이 여기에 집중된다.
- `lib/*`: DB·Nest 의존 없는 순수 함수. `test-automation`의 단위 테스트 1차 타깃.

---

## 7. 핵심 로직 규격

### 7.1 사본 이름/slug 파생 (FR-1-13, EX-1-7, AC-1-7, AC-1-8)

```
copyName(name):
  suffix = " (사본)"            # 5자
  base = name.length + 5 > 100 ? name.slice(0, 95).trimEnd() : name
  return base + suffix

copySlug(slug, exists):
  root = slug
  cand = clamp(root, "-copy")           # clamp(r,s) = r.slice(0, 50 - s.length) 후 끝 '-' 제거 + s
  n = 2
  while exists(cand):
     if n > 999: throw ApiException(DUPLICATE_SLUG)
     cand = clamp(root, `-copy-${n}`); n++
  return cand
```

- `exists` 조회와 `create` 사이의 경합은 DB unique 제약이 최종 방어선이다. `P2002` 발생 시 **최대 3회 재시도** 후 409.
- 그룹 복사(FR-1-7)는 `prisma.$transaction`으로 그룹 생성 + N개 챗봇 복제를 원자적으로 수행한다. 하위 대화설계 리소스는 복제하지 않는다(FR-1-14).

### 7.2 상태 전이 (FR-1-17, AC-1-13)

| from \ to | DRAFT | ACTIVE | ARCHIVED |
|---|---|---|---|
| **DRAFT** | no-op 200 | ✅ | ✅ |
| **ACTIVE** | ❌ 400 | no-op 200 | ✅ |
| **ARCHIVED** | ✅ | ❌ 400 | no-op 200 |

- **동일 상태 요청은 400이 아닌 200 no-op**로 처리한다(UI 연타/중복 요청 멱등성, NFR-A3).
- `DELETE /chatbots/:id`(보관)는 내부적으로 이 전이 테이블을 재사용하며, 이미 `ARCHIVED`면 204 no-op.
- `ARCHIVED` 상태에서 **차단되는 것은 `settings`/`skin` PATCH뿐**이다(FR-1-18). `status`/`group`/`copy`는 보관본 정리·복구에 필요하므로 허용한다.

### 7.3 skin 직렬화 (FR-4-8, AC-4-5, AC-4-6, EX-4-1)

```
parseSkin(raw: string, chatbotId): ChatbotSkin
  try { obj = JSON.parse(raw) } catch { warn; return DEFAULT_CHATBOT_SKIN }
  r = ChatbotSkinSchema.safeParse(obj)
  return r.success ? r.data : (warn(chatbotId, r.error), DEFAULT_CHATBOT_SKIN)

mergeSkin(current, patch): ChatbotSkin
  # patch.logoUrl === null  → 키 삭제
  # patch.logoUrl === undefined → 유지
  # 그 외 → 덮어쓰기
```

`기본값으로 되돌리기`(FR-4-7)는 별도 엔드포인트 없이 `PATCH /skin` 으로 `{ primaryColor: '#4F46E5', headerTitle: '챗봇 상담', logoUrl: null }`을 전송한다. 프런트는 `DEFAULT_CHATBOT_SKIN` 상수를 사용해 값을 하드코딩하지 않는다.

### 7.4 부분 수정 시맨틱 (D-10)

| 전송 값 | 의미 |
|---|---|
| 키 없음 / `undefined` | 변경하지 않음 |
| `null` | **값 삭제**(DB `NULL`) — `avatarUrl`, `description`, `logoUrl`에만 허용 |
| 값 | 해당 값으로 교체 |

`name`, `slug`, `primaryColor`, `headerTitle`은 필수 성격이므로 `null`을 허용하지 않는다(400). AC-3-2(빈 문자열 400)는 `min(1)`이 담당한다.

### 7.5 DB→DTO 매핑 방어 (`chatbot.mapper.ts`)

- `status`: `ChatbotStatus.safeParse` 실패 시 `'DRAFT'` 폴백 + `logger.warn`.
- `avatarUrl`/`description`/`logoUrl`: Prisma `null` → DTO `undefined`(zod `.optional()`과 정합).
- `skin`: `parseSkin()` 적용. **API 경계에서는 항상 객체**(FR-4-8).
- 목록의 `groupName`: `include: { group: { select: { name: true } } }`로 N+1 없이 조회.

### 7.6 대시보드 기간 계산 (FR-2-7, AC-2-7, AC-2-8)

```
KST_OFFSET_MINUTES = 540   # 대한민국은 서머타임이 없어 고정 오프셋으로 충분(외부 tz 라이브러리 미도입)

resolvePeriod(from?, to?, now):
  toKstDate   = to   ?? kstToday(now)
  fromKstDate = from ?? addDays(toKstDate, -6)        # 기본 최근 7일(오늘 포함)
  if fromKstDate > toKstDate            -> 400 INVALID_PERIOD
  if diffDays(from,to) + 1 > 366        -> 400 INVALID_PERIOD
  periodStart = kstMidnightToUtc(fromKstDate)                     # 00:00:00.000 KST
  periodEnd   = kstEndOfDayToUtc(toKstDate)                       # 23:59:59.999 KST
```

응답의 `periodStart`/`periodEnd`에는 **실제 적용된 UTC 경계를 그대로** 담는다(AC-2-7). 프리셋(오늘/7일/30일)은 프런트가 날짜만 계산해 보내며, 서버는 프리셋 개념을 모른다.

### 7.7 집계 쿼리 (ADR-0004)

| 지표 | 쿼리 |
|---|---|
| `totalLogCount`, `responseRate` | `groupBy({ by: ['isAnswered'], where, _count: { _all: true } })` 1회 |
| `visitCount` | `$queryRaw` 1회 — `COUNT(DISTINCT "sessionId") WHERE "sessionId" IS NOT NULL` **+** `COUNT(*) WHERE "sessionId" IS NULL` |
| `topQuestions` | `groupBy({ by: ['userMessage'], where, _count: { _all: true }, _max: { createdAt: true }, orderBy: { _count: { userMessage: 'desc' } }, take: TOP_QUESTION_CANDIDATE_LIMIT })` 1회 → 순수 함수가 정규화·병합·정렬 |

- `TOP_QUESTION_CANDIDATE_LIMIT = 500` (상수). 정규화 병합 때문에 `topN`보다 넉넉히 가져온다.
- 순수 함수 계약: `aggregateTopQuestions(rows: {question, count, lastOccurredAt}[], topN): {question, count}[]`
  - 정규화: `trim()` + `replace(/\s+/g, ' ')` (AC-2-4)
  - 빈 문자열 제외(EX-2-3) — 단 분모(`totalLogCount`)에는 포함
  - 정렬: `count desc` → 동률 시 `lastOccurredAt desc` (FR-2-4)
- 비율: `responseRate = round4(answered / total)`, `noResponseRate = round4(1 - responseRate)`. `total === 0`이면 **둘 다 0**(FR-2-9, AC-2-5). 두 값의 합이 정확히 1이 되도록 `noResponseRate`는 반올림된 `responseRate`로부터 파생한다(AC-2-1).
- 타임아웃: 집계 전체를 `Promise.race`로 **5초** 제한, 초과 시 `503 AGGREGATION_TIMEOUT`(EX-2-5). 캐시된 과거 결과를 대신 반환하지 않는다.
- `ARCHIVED` 챗봇도 조회 허용(FR-2-11, AC-2-10). 존재 여부만 확인하고 상태는 검사하지 않는다.

### 7.8 영구 삭제 사전 검사 (FR-1-16, AC-1-11, ADR-0002)

```
permanentDelete(id, confirmName):
  bot = findOrThrow(id)                                  # 404
  if bot.status !== 'ARCHIVED'      -> 409 CHATBOT_NOT_ARCHIVED
  if confirmName !== bot.name       -> 400 CONFIRM_NAME_MISMATCH
  counts = 병렬 count(intents, keywords, homonyms, dialogNodes, contextVariables,
                     faqs, channels, conversationLogs, unansweredQuestions)
  if sum(counts) > 0 -> 409 CHATBOT_HAS_CHILDREN (message에 0이 아닌 항목명·건수 나열)
  delete
```

경합으로 검사 통과 후 FK 위반(`P2003`)이 나면 전역 필터가 동일한 409 `CHATBOT_HAS_CHILDREN`으로 변환한다.

### 7.9 임베드 코드 생성 (FR-4-9, FR-4-13, FR-4-14, NFR-S2)

조회 시점에 생성하며 DB에 저장하지 않는다.

```html
<!-- PC -->
<script src="{WIDGET_BASE_URL}/widget.js"
        data-chatbot="{slug}"
        data-api-base="{PUBLIC_API_BASE_URL}"
        data-mode="desktop"
        defer></script>

<!-- Mobile -->
<script src="{WIDGET_BASE_URL}/widget.js"
        data-chatbot="{slug}"
        data-api-base="{PUBLIC_API_BASE_URL}"
        data-mode="mobile"
        data-fullscreen="true"
        defer></script>
```

- `publicUrl = {WIDGET_BASE_URL}/c/{slug}`, `scriptUrl = {WIDGET_BASE_URL}/widget.js`.
- **스니펫에는 `name`/`headerTitle` 등 자유 입력 문자열을 포함하지 않는다.** `slug`는 `^[a-z0-9-]+$`로 제한되어 있어 HTML 주입이 구조적으로 불가능하다(NFR-S2를 "이스케이프"가 아니라 "미포함"으로 해결).
- `WIDGET_BASE_URL` 미설정 시 서버는 **부팅 단계에서** 실패한다(§8). 런타임 500 대신 기동 실패가 우선이며, 검증을 우회한 경우에만 `CONFIG_ERROR`가 반환된다.

---

## 8. 설정 / 환경변수 (D-7, NFR-M1, EX-4-3)

| 변수 | 위치 | 필수 | 예시(dev) | 용도 |
|---|---|---|---|---|
| `DATABASE_URL` | `apps/api/.env` | ✅ | `file:./dev.db` | 기존 |
| `API_PORT` | `apps/api/.env` | — | `3000` | 기존 |
| `WIDGET_BASE_URL` | `apps/api/.env` | ✅ | `http://localhost:5174` | 임베드 스크립트/공개 URL 베이스 |
| `PUBLIC_API_BASE_URL` | `apps/api/.env` | ✅ | `http://localhost:3000/api/v1` | 임베드 스니펫이 위젯에 주입할 API 베이스 |
| `VITE_API_BASE_URL` | `apps/web/.env` | ✅ | `http://localhost:3000/api/v1` | **`/api` → `/api/v1`로 갱신 필요**(ADR-0003) |

- `ConfigModule.forRoot({ isGlobal: true, validate })`에 zod 기반 `env.validation.ts`를 연결해 **부팅 시 검증**한다. 실패 시 기동 중단(NFR-M1: 하드코딩 금지, 구축형/구독형 동일 코드).
- 루트 `.env.example`, `apps/web/.env.example`도 동일하게 갱신한다.

---

## 9. 프런트엔드 인계 제약 (`apps/web`)

| 항목 | 내용 |
|---|---|
| `apiClient` 확장 | `apps/web/src/api/client.ts`는 현재 오류 본문을 파싱하지 않는다. `ApiErrorSchema`로 본문을 파싱해 `ApiError`에 `code`/`details`를 싣도록 확장한다(FR-0-3, AC-5-2). 파싱 실패 시 기존 문구로 폴백 |
| 401 훅 자리 | `request()`에 `if (res.status === 401) { /* No.12 Phase: 재로그인 유도 */ }` 분기 자리만 마련(EX-X-1) |
| 라우팅 | `/chatbots`(리스트) · `/chatbots/:id` 하위 탭 3종 `dashboard`(기본) / `settings` / `skin`. 탭은 URL 세그먼트로 두어 새로고침·딥링크·뒤로가기가 동작해야 한다 |
| 화면 구조 제약 | 모든 폼 필드에 `<label htmlFor>` 연결(플레이스홀더 대체 금지, NFR-A4), 상태 배지는 색상+텍스트 병기(NFR-A1), 모달은 포커스 트랩+Esc+포커스 복귀(NFR-A2, AC-5-5), 파괴적 액션은 확인 모달 필수 |
| 상수 집약 | UI 문구는 `apps/web/src/constants/messages.ts` 한 곳에 모은다(FR-0-8, i18n 준비) |
| 클라이언트 전용 로직 | 스킨 미리보기(NFR-P3)와 대비비 계산(FR-4-6)은 서버 왕복 없이 수행. 대비비는 WCAG relative luminance 공식으로 계산하며 **경고일 뿐 저장을 막지 않는다** |

---

## 10. seed 전략 (D-5)

`apps/api/prisma/seed.ts`를 다음 3트랙으로 확장한다. **멱등**(재실행 시 slug 기준 upsert, 대화로그는 `deleteMany` 후 재생성)이어야 한다.

| 트랙 | 챗봇 | 상태 | 로그 | 검증 목적 |
|---|---|---|---|---|
| A | `sample-support-bot` | `ACTIVE` | **100건**(응답 90 / 미응답 10), 최근 7일 분포, `sessionId` 40종, "배송 조회" 12건 · "환불 절차" 7건 포함, `" 배송  조회 "` 변형 포함, `userMessage` 빈 문자열 1건 | AC-2-1 ~ AC-2-4, EX-2-3, D-1 A안 |
| B | `empty-dashboard-bot` | `DRAFT` | **0건** | **AC-2-5, AC-2-6(빈 상태)**, AC-4-10(DRAFT 임베드 주의 문구) |
| C | `archived-legacy-bot` | `ARCHIVED` | 30일 이전 로그 20건 | AC-1-11(영구삭제 409), AC-1-12(편집 409), AC-2-10(보관본 조회) |

- 그룹은 `고객지원 그룹`(A·B) + `보관 그룹`(C) 2개 — AC-1-5(잔여 챗봇 있는 그룹 삭제 409)와 EX-1-4(빈 그룹 삭제 204) 검증을 위해 **챗봇 0개인 `테스트 그룹`도 1개** 추가한다.
- 로그 생성 시각은 `now` 기준 상대 오프셋으로 계산해 언제 실행해도 "최근 7일"에 들어오게 한다(AC-2-7 재현성).
- 난수는 고정 시드의 결정론적 생성기를 쓰고, 랜덤 라이브러리를 새로 추가하지 않는다.
- seed는 **개발/수동 검증용**이다. 자동 테스트는 자체 fixture를 쓰되 수치는 위 표와 정렬시킨다(`test-automation` 인계).

---

## 11. 요구사항 ↔ 설계 추적표 (발췌)

| 요구사항 | 설계 반영 위치 |
|---|---|
| FR-0-3(필드별 오류) | §5.4, `common/all-exceptions.filter.ts`, §9 apiClient 확장 |
| FR-0-5(페이지네이션) | §4.1 `paginated()`, `common/pagination.ts` |
| FR-0-7(AuditLog 지점) | §6 계층 책임 — service 단일 진입점 |
| FR-1-5 / AC-1-5 | §5.2 #5 `GROUP_NOT_EMPTY` |
| FR-1-13 / AC-1-7~8 | §7.1 사본 파생 알고리즘 |
| FR-1-16 / AC-1-11 | §7.8, ADR-0002 |
| FR-1-17 / AC-1-13 | §7.2 전이 테이블 + `CHATBOT_STATUS_TRANSITIONS` 공유 상수 |
| FR-2-1 | §3.1 `sessionId`, §7.7, `visitCountBasis` 필드(ADR-0001) |
| FR-2-7 / AC-2-7 | §7.6 `resolvePeriod` |
| FR-2-9 / AC-2-5 | §7.7 비율 계산 규칙 |
| FR-3-6 / AC-3-5 | §4.2 `RESERVED_SLUGS` + `SlugSchema` |
| FR-3-7 / AC-3-6 | §5.2 #9 + `excludeChatbotId` 보강 |
| FR-4-7 / AC-4-6 | §7.3 `mergeSkin` + `null` 시맨틱(D-10) |
| FR-4-13 / AC-4-9 | §7.9 조회 시점 생성 |
| NFR-S3 / AC-3-4 | §4.1 `SafeUrlSchema` |
| NFR-M3 | §6 `lib/` 순수 함수 디렉터리 |

---

## 12. 이 Phase에서 하지 않는 것 (재확인)

요구사항 정의서 §9를 그대로 승계한다. 아키텍처 관점에서 특히 명시해 둘 항목:

- **`apps/ml-worker`·Redis/BullMQ·pgvector·docker-compose는 도입하지 않는다.** 개발명세서 §6-4 결정에 따라 확장기능(No.16~) 착수 시점까지 보류한다.
- **`packages/llm-provider`/`dialogue-engine`을 이 Phase 코드가 import하지 않는다.** 의존 방향을 미리 만들지 않아 후속 Phase의 설계 자유도를 남긴다.
- 인증/RBAC은 가드·데코레이터 **자리만** 만든다(동작 없음).
- `ConversationLog` 쓰기 경로는 만들지 않는다.
