# 품질/채널 (No.10~11) — 세부 설계서

> **상위 문서**: `docs/02-spec/개발명세서.md` (§1 아키텍처, §2 모노레포/계층규약, §3 데이터모델, §4 API, §5 비기능, §6 결정사항)
> **입력 문서**: `docs/requirements/quality-channel.md` (요구사항 정의서 — FR/AC/EX/DD 식별자 원본)
> **선행 설계서**: `docs/02-spec/chatbot-operations-설계.md`(No.1~4), `docs/02-spec/dialogue-design-설계.md`(No.5~9) — 4계층 모듈 규약·오류 봉투·삭제 정책·zod 단일 검증·챗봇 스코프 규약을 **그대로 상속**한다.
> **준수 기준**: `docs/03-design/UIUX_준수기준.md`
> **관련 ADR**: `decisions/ADR-0009` ~ `ADR-0013`(신규), `ADR-0001`·`ADR-0003`·`ADR-0004`·`ADR-0007`·`ADR-0008`(상속)
> **작성**: system-architect · 2026-09-20 · **다음 단계**: `ui-designer` → `backend-implementer` → `frontend-implementer` → `code-reviewer` → `test-automation`

이 문서는 개발명세서를 **대체하지 않고 확장**한다. 명명 규칙(엔터티 PascalCase, 테이블 snake_case `@@map`, REST `/api/v1/`, zod 단일 소스, 4계층 모듈)은 이전 두 그룹과 동일하다.

---

## 1. 범위와 전제

| 항목 | 내용 |
|---|---|
| 대상 기능 | No.10 응답 테스트/시뮬레이션 · No.11 다양한 채널 제공 + **엔진 실행공백 보강(FR-E2)** + **`apps/widget` 신규 스캐폴딩** |
| GPU 필요도 | 1 → **`apps/api` + `packages/dialogue-engine` 동기 처리**. `apps/ml-worker`/Job Queue/Redis 미도입(개발명세서 §1 설계원칙, §6-4) |
| `packages/llm-provider` | 사용하지 않음. 생성형 응답/스트리밍은 No.30 범위 |
| DB | SQLite(개발명세서 §6-4). 원시 SQL 신규 도입 **0건**(NFR-M7) |
| 신규 런타임 의존성 | **0건**. 레이트리밋은 자체 구현(§8.6, DD-30), 위젯은 런타임 의존성 0(§9, DD-28) |
| 신규 앱 | **`apps/widget`** — Vite 기반 경량 임베드 위젯(ADR-0012) |
| 이 그룹이 만드는 것 | 엔진을 호출하는 **최초의 HTTP 경로**(시뮬레이션 2 + 공개 대화 2), 채널 설정 CRUD 3, `ConversationLog`의 **최초 쓰기 주체**, 임베드 스니펫이 가리키는 **실체** |

**PM 승인 완료된 스코프 판단 3건**(요구사항 §1.3): **J-1**(No.10 비교를 "저장본 A vs 저장본+미저장 변경 B"로 재해석) · **J-2**(WEB만 종단 구현, 나머지 7종 `CONFIG_ONLY`) · **J-3**(`apps/widget` 최소 버전 스캐폴딩). 본 설계는 이 3건을 전제로 한다.

**구현 순서 권고**
`shared-types` 스키마 → **`dialogue-engine` 보강(FR-E2)** → `dialogue-common` 캐시 → `channels` → `simulation` → `conversation`(공개 API) → `apps/widget` → `apps/web` 화면.
엔진 보강이 가장 먼저인 이유: 시뮬레이션·공개 API·위젯 셋이 모두 새 진입점(`resolveTurn`)에 의존하며, 이 계약이 흔들리면 세 소비자가 동시에 흔들린다.

---

## 2. 설계 결정 요약

요구사항 §5.2가 제기한 **DD-18~DD-25**와, 설계 과정에서 추가로 확정한 **DD-26~DD-32**다.

| ID | 이슈 | 결정 | 근거 |
|---|---|---|---|
| **DD-18** | 세션 영속화 | **테이블 만들지 않음(DD-10 유지)**. 대화 상태는 **클라이언트 보관 봉투(`ConversationState`)** 로 요청-응답 왕복하고, 서버는 매 턴 `sanitizeConversationState()`로 재검증한다 | §2.1, **ADR-0009** |
| **DD-19** | `Channel` 제약·필드 | **부분 채택** — ① `@@unique([chatbotId, type])` ② `updatedAt` ③ **`enabled` 기본값 `true` → `false`로 변경(추가 결정)**. **④ `@@index([chatbotId])`는 기각**(유니크 인덱스 프리픽스로 이미 커버) | §3.1 |
| **DD-20** | `ConversationLog` | **부분 채택** — ① `matchedNodeId String?` **채택** + **`matchedFaqId String?` 보강 추가** ② `@@index([chatbotId,isAnswered,createdAt])` **기각 → No.15로 이관** | §2.2 |
| **DD-21** | PII 마스킹 위치 | **①안 채택** — `apps/api/src/conversation/lib/pii-mask.ts` 순수 함수. 적용은 `ConversationLogService.record()` **내부 단 1곳**. 종류별 차등 마스킹 | **ADR-0013** |
| **DD-22** | 번들 캐시 | **②안 채택** — `DialogueBundleCache` 인터페이스 + `InMemoryDialogueBundleCache`(TTL 60초 + LRU). **단 챗봇 상태·채널은 캐시하지 않는다**(AC-P-14를 구조적으로 보장) | §8.1 |
| **DD-23** | 레이트리밋 | **자체 구현 채택** — `lib/rate-limiter.ts`(토큰버킷 순수 함수) + `RateLimitStore` 인터페이스 + `PublicRateLimitGuard`. `@nestjs/throttler` 미도입 | §8.6, DD-30 |
| **DD-24** | 아웃풋 렌더러 공유 | **③안 채택** — 표시 모델 변환·버튼 액션 판정만 공유, 마크업은 앱별. 공유 위치는 **`@chat-bot/shared-types/output-view` 서브패스**(zod 무의존 모듈) | §4.4, **ADR-0012** |
| **DD-25** | 위젯 기술 스택 | **런타임 의존성 0의 순수 TS + Vite 라이브러리 모드(IIFE)**. React 미사용, zod 번들 반입 금지 | **ADR-0012** |
| **DD-26** | 엔진 진입점 구조 | **3층 구조** — `resolveResponse`(텍스트, 기존 시그니처 불변) / `resolveByNodeId`(버튼 NODE) / **`resolveTurn`(턴 오케스트레이터 + 상태 봉투)**. API 3개 소비자는 `resolveTurn`만 호출한다 | §7.1, **ADR-0010** |
| **DD-27** | 동음이의어 되묻기 종결 | 상태 봉투에 **`pendingClarify`** 추가 + 파이프라인에 **S1.5 단계** 신설. 해소 시 `intentId`를 **부스트가 아니라 확정**한다 | §7.3, **ADR-0010** |
| **DD-28** | 오버레이 병합 위치 | **`packages/dialogue-engine/src/overlay.ts`**(순수 함수). zod 검증은 `apps/api` 책임 | §7.5 |
| **DD-29** | 채널 구현 등급 | `ChannelImplementation`(`IMPLEMENTED`/`CONFIG_ONLY`) + `CHANNEL_IMPLEMENTATION` 상수 맵을 `shared-types`에 두되, **프런트는 상수가 아니라 API 응답값을 렌더한다** | §8.2, **ADR-0011** |
| **DD-30** | 공개 API Origin 인가 | **CORS 헤더가 아니라 서버 가드(`PublicOriginGuard`)로 판정**한다(`403 ORIGIN_NOT_ALLOWED`). 전역 CORS 설정은 현행 유지 | §8.7, **ADR-0011** |
| **DD-31** | `isAnswered` 판정식 | 요구사항의 "trace **마지막** 단계" 규칙은 **현행 엔진에서 성립하지 않는다**(폴백 노드 실행 trace가 뒤에 붙음). **"trace에 폴백 코드가 하나라도 존재하는가"** 로 확정 | §8.5 |
| **DD-32** | 비교 요청의 초기 상태 | 요구사항의 `stateA?`/`stateB?`를 **`initialState?` 단일 필드로 축약**한다(A/B는 같은 시작점에서 각각 재생) | §5.2 |

### 2.1 DD-18 — "새 소비자가 생겼는데도" 세션 테이블을 만들지 않는 이유

DD-10은 "No.10 시뮬레이터가 왕복으로 상태를 주고받는다"를 전제로 내린 결정이었다. 이번에 **공개 대화 API + 위젯**이라는 새 소비자가 생겼으므로 전제를 재검토했고, **유지**로 결론냈다.

1. **상태의 크기와 수명이 테이블을 정당화하지 못한다.** 봉투는 `contextSession`(슬롯 값 ≤20개) + `pendingClarify`(3필드)뿐이다. 테이블을 만들면 **만료 정리 배치**(cron/스케줄러)가 따라오고, 이는 이번 Phase에 없는 인프라 관심사(가용성·중복 실행 방지)를 끌어들인다.
2. **서버가 봉투를 신뢰하지 않으므로 조작 이득이 없다.** 봉투에는 권한·식별 정보가 없고(NFR-S5), 모든 필드가 매 턴 재검증된다(§7.4). 사용자가 조작할 수 있는 최대치는 "자기 자신의 슬롯 값을 바꾸는 것"인데, 그건 어차피 다음 턴에 직접 입력해도 되는 값이다.
3. **영속화가 실제로 필요해지는 시점은 "제3자가 세션을 들여다볼 때"** 다 — 상담원 인계(No.24), 옴니채널 통합 인박스(No.42), 대화 이력 복원. 셋 다 이번 범위 밖이며, 그때는 "세션 테이블"이 아니라 **대화 스레드 모델**이 필요하므로 지금 만드는 테이블은 어차피 재설계 대상이다.
4. **대신 이번에 빠진 안전장치를 넣는다** — 봉투 최대 수명 24시간, `pendingClarify` 10분, 봉투 크기 상한(§7.4). 이 셋이 "테이블이 없어서 생기는 위험"의 실체다.

> **재검토 트리거(명시)**: No.24·No.42 착수, 또는 "새로고침 후 대화 이어가기" 요구가 확정되는 시점. → **ADR-0009**

### 2.2 DD-20 — `matchedNodeId`는 통과하고 인덱스는 기각하는 이유

ADR-0004는 `ConversationLog.normalizedMessage`를 **"쓰기 주체가 없다"** 는 이유로 기각했고, DD-2(캔버스 좌표)도 같은 기준으로 기각됐다. 이번에는 같은 기준을 **양쪽으로** 적용한다.

- **`matchedNodeId` 채택**: 이 Phase에 쓰기 주체(공개 대화 API)가 **실제로 생긴다**. 기준을 통과한다.
- **`matchedFaqId` 보강 채택**(요구사항에 없던 1건): 세 매칭 경로(노드/FAQ/의도) 중 둘만 기록하면 **"FAQ가 답한 턴"과 "폴백으로 끝난 턴"을 사후에 구분할 수 없다**(둘 다 `matchedNodeId=null, matchedIntentId=null`). `isAnswered`만으로는 "무엇이 답했는가"를 알 수 없다. 쓰기 주체는 동일하므로 같은 기준을 통과한다.
- **`@@index([chatbotId, isAnswered, createdAt])` 기각**: 이 인덱스의 소비자는 "미응답 목록 조회"이며 **No.15의 기능**이다. 이번 Phase의 유일한 읽기 소비자인 No.2 대시보드는 기간 집계(`(chatbotId, createdAt)` 범위 스캔 후 앱단 집계, ADR-0004)이므로 기존 인덱스로 충분하다. 정렬·페이징 규격이 확정되지 않은 상태에서 인덱스 컬럼 순서를 미리 고르면 **No.15에서 다시 바꿔야 할 확률이 높다**. 쓰기 비용만 남는다.
- **`turnIndex`/`responseTimeMs` 미도입**: 쓰기 주체는 있으나 **소비하는 AC가 없다**. ADR-0004 기준에 걸린다.

---

## 3. 데이터 모델 변경 (개발명세서 §3 확장)

### 3.1 Prisma 스키마 변경안 (`apps/api/prisma/schema.prisma`)

변경 대상은 **2개 모델뿐**이며, 신규 테이블은 **0건**이다.

```prisma
model Channel {
  id        String   @id @default(uuid())
  chatbotId String
  chatbot   Chatbot  @relation(fields: [chatbotId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  /// ChannelType(shared-types zod enum)이 값 제약의 단일 소스다(§3.1 데이터 규약).
  type      String
  /// [변경] 기본값 true → false. 레코드 생성이 곧 "배포"가 되면 안 된다(§3.2 근거 ②).
  enabled   Boolean  @default(false)
  /// JSON 직렬화된 ChannelConfig(type 기준 판별 유니온). 자격증명 필드는 스키마에 존재하지 않는다(NFR-S7).
  config    String   @default("{}")
  createdAt DateTime @default(now())
  /// [신규] 목록 정렬·감사(FR-0-14, FR-11-13)
  updatedAt DateTime @updatedAt

  /// [신규] 챗봇당 타입별 최대 1건(FR-11-1). 동시 요청 경합의 최종 방어선이다.
  @@unique([chatbotId, type])
  @@map("channels")
}

model ConversationLog {
  id              String   @id @default(uuid())
  chatbotId       String
  chatbot         Chatbot  @relation(fields: [chatbotId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  channelType     String
  sessionId       String?
  /// ⚠ PII 마스킹 후의 값만 저장된다. 원문은 어디에도 남기지 않는다(NFR-S4, ADR-0013).
  userMessage     String
  /// ⚠ 동일. completionMessage의 {슬롯} 치환으로 사용자 입력이 섞일 수 있어 마스킹 대상이다.
  botResponse     String
  matchedIntentId String?
  /// [신규] 어떤 노드가 답했는지(DD-20). No.15/No.24/오류분석의 직접 소비 대상.
  matchedNodeId   String?
  /// [신규] 어떤 FAQ가 답했는지(DD-20 보강). 없으면 "FAQ 응답"과 "폴백"을 구분할 수 없다.
  matchedFaqId    String?
  isAnswered      Boolean  @default(true)
  createdAt       DateTime @default(now())

  @@index([chatbotId, createdAt])
  @@map("conversation_logs")
}
```

> **FK를 걸지 않는 이유**(`matchedNodeId`/`matchedFaqId`/`matchedIntentId`): 로그는 **그 시점의 사실 기록**이다. FK를 걸면 `onDelete: Restrict` 규약(개발명세서 §3.1) 때문에 **로그가 쌓인 노드는 영원히 삭제할 수 없게 된다**. 기존 `matchedIntentId`가 이미 FK 없는 문자열인 것과 동일한 판단이며, EX-11-7(`channelType` 문자열 유지)과도 같은 원칙이다.

### 3.2 마이그레이션 영향 분석 및 절차

| 변경 | 유형 | 기존 데이터 영향 |
|---|---|---|
| `Channel.updatedAt` 추가 | 비파괴 `ADD COLUMN` | `@updatedAt`은 Prisma가 쓰기 시점에 채운다. 기존 행은 마이그레이션 기본값(`now()`)으로 백필 — **정확한 이력이 아님을 감수**(현재 운영 데이터 0건이라 실질 영향 없음) |
| `Channel.enabled` 기본값 `true → false` | 비파괴(DEFAULT만 변경) | **기존 행의 값은 변하지 않는다.** seed의 `sample-support-bot` WEB 채널은 `enabled: true`를 **명시 지정**(`seed.ts:362`)하므로 영향 없음 |
| `Channel @@unique([chatbotId, type])` | 제약 추가 — **중복 행이 있으면 실패** | 현재 `channels` 테이블 행은 seed 1건뿐이고 `deleteMany` 후 `create`하므로 중복 불가. **운영 DB 적용 시에는 사전 중복 점검 쿼리를 먼저 실행**한다 |
| `ConversationLog.matchedNodeId`/`matchedFaqId` 추가 | 비파괴 `ADD COLUMN`(nullable) | 기존 seed 로그 200건은 `null`. No.2 대시보드는 이 컬럼을 읽지 않으므로 영향 0 |

**절차**(SQLite 특성상 `@@unique` 추가는 Prisma가 테이블 재작성을 수행할 수 있으므로 순서를 고정한다)

1. `prisma migrate dev --name quality-channel-schema` — 4개 변경을 **한 마이그레이션**으로 생성.
2. 생성된 SQL을 검토해 `channels` 재작성 시 `enabled`/`config` 값이 보존되는지 확인.
3. `pnpm --filter @chat-bot/api prisma:seed` 재실행 → NFR-M5 데이터(§12) 반영.
4. 롤백 경로: 이 마이그레이션은 컬럼 추가 + 유니크 제약뿐이라 **역마이그레이션이 데이터 손실을 일으키지 않는다**(제약 해제 + 컬럼 드롭).

### 3.3 개발명세서 §3 엔터티 표 갱신

| 엔터티 | 갱신 내용 |
|---|---|
| `Channel` | "채널 연동 설정" → "**채널 배포 설정. `(chatbotId, type)` 유일, 타입별 `config` 판별 유니온. 자격증명은 저장하지 않는다(NFR-S7). `enabled` 기본 false**" |
| `ConversationLog` | 설명에 "**공개 대화 API(No.11)가 유일한 쓰기 주체. 저장 전 PII 마스킹 필수(ADR-0013). `matchedNodeId`/`matchedFaqId`로 응답 출처를 추적**" 추가 |

---

## 4. `packages/shared-types` 스키마 배치

배치 규칙(개발명세서 §6-9)에 따라, **엔진 입출력 계약은 `dialogue-engine.ts`에 append**, **대화 1턴 처리라는 새 관심사는 `conversation.ts` 신설**, **채널은 `channel.ts` 재정비**로 나눈다.

### 4.1 `dialogue-engine.ts` 확장 (엔진 계약)

```ts
/* ── 되묻기 대기 상태(FR-E2-2, DD-27) ── */
export const PendingClarifySchema = z.object({
  homonymId: z.string().uuid(),
  word: z.string().min(1).max(50),
  askedAt: z.coerce.date(),
});
export type PendingClarify = z.infer<typeof PendingClarifySchema>;

/* ── 대화 상태 봉투(FR-10-3, DD-18) — 클라이언트가 보관하고 매 요청에 실어 보낸다 ── */
export const CONVERSATION_STATE_VERSION = 1;
export const ConversationStateSchema = z.object({
  version: z.literal(CONVERSATION_STATE_VERSION),
  contextSession: ContextSessionStateSchema.nullable(),
  pendingClarify: PendingClarifySchema.nullable().optional(),
});
export type ConversationState = z.infer<typeof ConversationStateSchema>;

/* ── 버튼 액션(FR-11-25, FR-W-6) — LINK는 클라이언트 전용이라 서버 계약에 없다 ── */
export const ButtonActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('MESSAGE'), text: z.string().min(1).max(200) }),
  z.object({ kind: z.literal('NODE'), nodeId: z.string().uuid(), label: z.string().max(40).optional() }),
]);
export type ButtonAction = z.infer<typeof ButtonActionSchema>;

/* ── 봉투 폐기 사유(§7.4) ── */
export const StateDiscardReason = z.enum([
  'INVALID_SCHEMA', 'VERSION_MISMATCH', 'UNKNOWN_CONTEXT',
  'SESSION_EXPIRED', 'OVERSIZED', 'UNKNOWN_HOMONYM', 'CLARIFY_EXPIRED',
]);
```

- `TraceCodeEnum`에 **`NODE_BY_ID`, `NODE_BY_ID_NOT_FOUND`, `CLARIFY_RESOLVED`, `CLARIFY_DISCARDED`, `STATE_DISCARDED`** 5종 추가(enum 값 추가는 하위호환, FR-E2-6).
- `DialogueResolutionSchema`에 **`pendingClarify: PendingClarifySchema.nullable().optional()`** 추가. **기존 필드는 하나도 건드리지 않는다**(FR-E2-3).
- `TraceStageEnum`은 변경하지 않는다 — 새 코드는 기존 `NODE`/`HOMONYM`/`PREPROCESS` 단계에 귀속된다.

### 4.2 `conversation.ts` 신설 (대화 1턴 처리 계약)

**신설 근거**: ① 시뮬레이션·비교·공개 대화는 "대화 1턴을 처리한다"는 **동일 관심사**이고 ② 오버레이는 `dialogue.ts`의 6개 도메인 스키마를 전부 참조하므로 `dialogue-engine.ts`(엔진 순수 계약)에 넣으면 파일 성격이 흐려진다. 의존 방향은 `conversation.ts → {dialogue-engine.ts, dialogue.ts, chatbot.ts, common.ts}` **단방향**이다.

| 스키마 | 내용 |
|---|---|
| `DialogueOverlaySchema` | `{ dialogNodes?, intents?, keywords?, homonyms?, contexts?, faqs?, deletedIds?: {…: string[]} }`. 각 배열 **최대 20건**, 항목은 기존 도메인 스키마 재사용(FR-10-18~21) |
| `SimulateRequestSchema` | `{ message?: string(≤1000), buttonAction?: ButtonAction, state?: ConversationState, overlay?: DialogueOverlay }` + `superRefine`: `message`/`buttonAction` 중 **정확히 하나** |
| `AssetCountsSchema` | `{ dialogNodes, intents, keywords, homonyms, contexts, faqs }`(활성 건수, FR-10-8) |
| `SimulateResponseSchema` | `DialogueResolutionSchema.extend({ state, stateDiscarded: StateDiscardReason[], matchedNodeName?, matchedIntentName?, matchedFaqQuestion?, elapsedMs, resolvedAt, assetCounts, overlayApplied })` |
| `CompareRequestSchema` | `{ messages: string[](1~20, 각 1~1000), overlay: DialogueOverlay, initialState?: ConversationState }`(DD-32) |
| `CompareTurnResultSchema` | `{ outputs, matchedNodeId?, matchedNodeName?, matchedIntentId?, matchedFaqId?, unsupportedOutputs, trace }` |
| `CompareDiffSchema` | `{ status: 'SAME'｜'DIFFERENT', outputsChanged: boolean, matchChanged: boolean }` |
| `CompareResponseSchema` | `{ turns: [{ index, message, a, b, diff }], summary: { total, same, different }, elapsedMs, resolvedAt }` |
| `PublicChatbotConfigSchema` | `{ slug, name, avatarUrl?, skin: ChatbotSkinSchema, greetingMessage?, quickReplies: string[], launcherPosition, showLauncher }` — **`id`·`groupId`·`status`·통계·대화자산 없음**(NFR-S1) |
| `PublicMessageRequestSchema` | `{ sessionId: uuid, message?: string(1~1000), buttonAction?: ButtonAction, state?: ConversationState }` + 동일 `superRefine` |
| `PublicMessageResponseSchema` | `{ messageId: uuid, outputs: DialogOutput[], state: ConversationState, stateReset: boolean }` — **`trace`·내부 ID·`unsupportedOutputs` 없음**(FR-0-18) |
| `OVERLAY_LIMITS` | `{ perKind: 20, bodyBytes: 1_048_576 }`, `COMPARE_LIMITS = { messages: 20, messageLength: 1000 }` |

> **`stateReset: boolean`이 유일하게 허용된 "내부 사정" 노출**이다. 폐기 *사유*(`StateDiscardReason`)는 내부 구조를 드러내므로 공개 응답에서 제외하고, 위젯은 이 불리언만으로 "대화가 만료되어 새로 시작합니다"(EX-10-5) 안내를 띄운다.

### 4.3 `channel.ts` 재정비

기존 Phase 0 초안(`config: z.record(z.unknown())`)은 **자유 JSON이라 검증이 불가능**하므로 교체한다.

```ts
export const ChannelImplementation = z.enum(['IMPLEMENTED', 'CONFIG_ONLY']);

/** 채널별 구현 등급(FR-11-3). 서버가 응답에 실어 내려주는 값의 원천이며, 프런트는 이 상수가 아니라 응답값을 렌더한다(DD-29). */
export const CHANNEL_IMPLEMENTATION: Record<ChannelType, ChannelImplementation> = {
  WEB: 'IMPLEMENTED',
  MOBILE: 'CONFIG_ONLY', KAKAOTALK: 'CONFIG_ONLY', LINE: 'CONFIG_ONLY',
  FACEBOOK: 'CONFIG_ONLY', NAVER_TALKTALK: 'CONFIG_ONLY', APP: 'CONFIG_ONLY', KIOSK: 'CONFIG_ONLY',
};

/** 화면/안내 문구용 한국어 레이블과 정렬 순서(FR-11-2, FR-0-23). WEB이 항상 첫 번째다. */
export const CHANNEL_TYPE_ORDER: ChannelType[] = ['WEB','MOBILE','KAKAOTALK','LINE','FACEBOOK','NAVER_TALKTALK','APP','KIOSK'];
export const CHANNEL_TYPE_LABELS: Record<ChannelType, string> = { WEB: '웹', MOBILE: '모바일 앱', /* … */ };

/** 출처 형식: 스킴 + 호스트(+포트). 경로/와일드카드/javascript: 금지(EX-11-4). */
export const AllowedOriginSchema = z.string().trim()
  .regex(/^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/i, '스킴과 도메인 형식(예: https://www.example.co.kr)으로 입력해 주세요.');

export const WebChannelConfigSchema = z.object({
  allowedOrigins: z.array(AllowedOriginSchema).max(20).default([]),
  greetingMessage: z.string().max(200).optional(),
  quickReplies: z.array(z.string().trim().min(1).max(20)).max(5).default([]),
  launcherPosition: z.enum(['RIGHT', 'LEFT']).default('RIGHT'),
  showLauncher: z.boolean().default(true),
}).strict();   // ← 미정의 필드는 통과시키지 않는다(EX-11-2)

export const PlaceholderChannelConfigSchema = z.object({ note: z.string().max(500).optional() }).strict();

/** type을 아는 쪽에서 선택한다. 자격증명 필드는 어느 분기에도 존재하지 않는다(NFR-S7). */
export function channelConfigSchemaFor(type: ChannelType) {
  return type === 'WEB' ? WebChannelConfigSchema : PlaceholderChannelConfigSchema;
}

export const ChannelListItemSchema = z.object({
  type: ChannelType,
  label: z.string(),
  implementation: ChannelImplementation,
  configured: z.boolean(),
  enabled: z.boolean(),
  config: z.union([WebChannelConfigSchema, PlaceholderChannelConfigSchema]),
  updatedAt: z.coerce.date().nullable(),
});
export const UpdateChannelSchema = z.object({ enabled: z.boolean().optional(), config: z.unknown().optional() });
```

- **`.strict()`를 쓰는 이유**: 전역 파이프는 strip 모드(ADR-0003)이므로 미정의 필드가 조용히 사라진다. 그런데 EX-11-2/AC-11-5는 관리자가 `accessToken` 같은 필드를 보냈을 때 "**저장되지 않았다는 사실을 알 수 있어야**" 한다. strict로 `400`을 돌려주면 "이 시스템은 자격증명을 받지 않는다"가 화면에서 드러난다 — 침묵 삭제보다 정직하다.
- `ChannelSchema`(단건)는 `ChannelListItemSchema`에 `id`/`chatbotId`/`createdAt`을 더한 형태로 유지하되, **API 응답에는 `ChannelListItemSchema`만 사용**한다(채널 id는 프런트가 쓸 일이 없다 — 경로 키가 `type`이다).
- `CreateChannelSchema`는 **삭제**한다. 생성은 `PATCH /channels/:type`의 upsert로만 일어난다.

### 4.4 zod 무의존 공유 모듈과 서브패스 export (DD-24)

위젯은 **gzip 100KB 예산**(NFR-P5)과 "호스트 페이지 침투 최소화" 때문에 zod(gzip ≈13KB)를 번들에 넣을 수 없다. 그렇다고 렌더 로직을 복제하면 NFR-M1을 어긴다. 해결:

```
packages/shared-types/src/
├── output-view.ts   # (신규) zod 무의존 — 아웃풋 → 표시 모델 변환 / 버튼 액션 판정 / PAUSE 일정
└── contrast.ts      # (신규) zod 무의존 — apps/web/src/lib/contrast.ts를 이동(FR-W-22, FR-4-6 재사용)
```

```jsonc
// packages/shared-types/package.json — exports 맵 추가
"exports": {
  ".":             { "types": "./dist/index.d.ts",        "default": "./dist/index.js" },
  "./output-view": { "types": "./dist/output-view.d.ts",  "default": "./dist/output-view.js" },
  "./contrast":    { "types": "./dist/contrast.d.ts",     "default": "./dist/contrast.js" }
}
```

- 두 모듈은 `import type { DialogOutput } from './dialogue'`만 사용한다 — **타입 전용 import는 컴파일 시 지워지므로** 산출물 `dist/output-view.js`에 zod가 들어가지 않는다.
- `apps/web/src/lib/contrast.ts`는 **re-export 셔임**으로 남긴다(`export * from '@chat-bot/shared-types/contrast'`). 기존 import 경로와 `contrast.spec.ts`가 수정 없이 통과한다.
- `apps/widget`에는 ESLint `@typescript-eslint/no-restricted-imports`(`allowTypeImports: true`)로 **`@chat-bot/shared-types` 루트의 값 import를 금지**한다. 번들 예산 회귀를 리뷰가 아니라 린트가 잡는다.

**`output-view.ts` 공개 API**

| 함수 | 책임 |
|---|---|
| `toOutputViews(outputs): OutputView[]` | 12종 아웃풋 → 렌더 가능한 7종 표시 모델. 미지원 3종·`CONTEXT_FORM`·`DIALOG_MOVE`는 제외(서버가 이미 처리, FR-W-5) |
| `isSafeHttpUrl(url): boolean` | `http`/`https`만 허용. 위반 URL은 렌더 생략(FR-W-11, NFR-S8) |
| `resolveButtonAction(btn): ButtonActionView` | `{kind:'MESSAGE',text}｜{kind:'NODE',nodeId,label}｜{kind:'LINK',href}` 판정(FR-W-6). 서버 전송 여부를 호출부가 아니라 이 함수가 결정한다 |
| `planPauseSchedule(views, maxTotalMs=5000)` | `PAUSE` 누적 지연 계산 + 한 턴 5초 상한(FR-W-7) |
| `outputsToPlainText(outputs, maxLength)` | 로그용 텍스트 표현(FR-11-22) — **서버 전용 소비자지만 규칙이 하나여야 하므로 같은 모듈에 둔다** |

---

## 5. API 설계 (개발명세서 §4 확장)

### 5.1 공통 규약 — 관리자 계열과 공개 계열의 분리 (FR-0-17)

| 항목 | 관리자 API | 공개 API |
|---|---|---|
| 베이스 경로 | `/api/v1/chatbots/:chatbotId/…` | **`/api/v1/public/chatbots/:slug/…`** |
| 인증 | `@RequirePermission('simulation:read'｜'channel:read'｜'channel:write')`(가드는 No.12까지 no-op) | **없음**. 보호는 Origin 가드 + 레이트리밋(§8.6~8.7) |
| 스코프 검증 | `ChatbotScopeService.assertReadable/assertWritable()` 서비스 첫 줄 | `PublicAccessService.resolve(slug)` — status + WEB 채널 판정 |
| 존재 노출 | 교차 접근 **404**(기존 규약) | **미존재 404 / 비활성 403**(NFR-S10 예외 — ADR-0011 §3) |
| 응답 스키마 | `trace`·내부 ID 포함 | **별도 스키마**. 내부 필드가 타입상 들어갈 수 없다(NFR-S1, AC-C-5) |
| 컨트롤러·DTO | 공유하지 않음 | 공유하지 않음 |
| 캐시 헤더 | 기본 | `Cache-Control: no-store`(채널 즉시 차단 — AC-P-14, S-10) |

**라우트 선언 순서 주의**: `public`은 `chatbots/:chatbotId` 패턴과 충돌하지 않도록 **별도 컨트롤러 프리픽스**(`@Controller('public/chatbots/:slug')`)로 선언한다. 채널 컨트롤러는 `@Controller('chatbots/:chatbotId/channels')`이며 `:type`은 zod enum 파이프로 검증해 오타 경로가 `404`가 아니라 `400`이 되게 한다.

### 5.2 관리자 엔드포인트 명세 (5)

> 경로 앞에 `/api/v1/chatbots/:chatbotId`가 생략되어 있다.

| # | 메서드 · 경로 | 요청 | 응답 | 오류 |
|---|---|---|---|---|
| 1 | `POST /simulate` | `SimulateRequestSchema` | `200` `SimulateResponseSchema` | 400 `VALIDATION_FAILED`·`OVERLAY_INVALID`·`LIMIT_EXCEEDED` / 404 |
| 2 | `POST /simulate/compare` | `CompareRequestSchema` | `200` `CompareResponseSchema` | 400 `NO_CHANGES_TO_COMPARE`·`LIMIT_EXCEEDED`·`OVERLAY_INVALID` / 404 |
| 3 | `GET /channels` | — | `200` `{ items: ChannelListItem[] }` **(8종 고정, 페이지네이션 없음)** | 404 |
| 4 | `PATCH /channels/:type` | `UpdateChannelSchema` | `200` `ChannelListItemSchema` | 400 / 404 / 409 `CHANNEL_NOT_IMPLEMENTED`·`CHATBOT_ARCHIVED` |
| 5 | `DELETE /channels/:type` | — | `204`(**멱등**) | 400(잘못된 type) / 404(챗봇) / 409 `CHATBOT_ARCHIVED` |

- **①②가 POST인 이유**: 조회성이지만 본문(오버레이·상태 봉투)이 크고 캐시되면 안 된다. `POST /dialog-nodes/validate`와 동일한 판단(개발명세서 §4.1 "파괴적 동작 GET 금지"와 충돌하지 않음).
- **③에 페이지네이션이 없는 이유**: 항목 수가 `ChannelType` enum 크기(8)로 **고정**이다. `{items,total,page,pageSize}` 봉투를 억지로 씌우면 프런트가 존재하지 않는 페이징 UI를 방어해야 한다.
- **⑤가 멱등 `204`인 이유**: 채널은 고정 집합이므로 레코드 부재는 "리소스 없음"이 아니라 **"미설정 상태"** 다. 삭제 = 설정 초기화이며, 초기화된 것을 다시 초기화해도 결과가 같다. 동음이의어 삭제가 항상 `204`인 선례(FR-7-9)와 같은 규칙이다.
- **④의 시맨틱**: upsert. `enabled`만 보내면 config 미변경, `config`만 보내면 enabled 미변경(부분 수정 시맨틱, 개발명세서 §3.1). `config`는 **전체 교체**(부분 병합 금지 — `allowedOrigins` 같은 배열에서 "삭제"를 표현할 수 없게 된다).
- **`CONFIG_ONLY` 채널의 409 조건 정밀화**(AC-11-3/AC-11-4): 거부 조건은 "`enabled=true`로 **전환**하려는 요청"이다. `config`만 보내는 요청과 `enabled:false`를 보내는 요청은 통과한다. 이미 `enabled=true`인 `CONFIG_ONLY` 레코드는 존재할 수 없다(생성 경로가 없다).

### 5.3 공개 엔드포인트 명세 (2)

| # | 메서드 · 경로 | 요청 | 응답 | 오류 |
|---|---|---|---|---|
| 1 | `GET /api/v1/public/chatbots/:slug/config` | — | `200` `PublicChatbotConfigSchema` | 403 `CHATBOT_NOT_PUBLISHED`·`CHANNEL_DISABLED`·`ORIGIN_NOT_ALLOWED` / 404 `NOT_FOUND` / 429 |
| 2 | `POST /api/v1/public/chatbots/:slug/messages` | `PublicMessageRequestSchema` | `200` `PublicMessageResponseSchema` | 400 / 403(동일) / 404 / 429 `RATE_LIMITED` + `Retry-After` |

- 두 엔드포인트 모두 가드 순서는 **`PublicRateLimitGuard` → `PublicOriginGuard` → 컨트롤러**다. 레이트리밋을 먼저 두는 이유: Origin 판정은 DB 조회를 수반하므로, 폭주 트래픽이 DB에 닿기 전에 잘라야 한다.
- `GET /config`는 `sessionId`가 없으므로 레이트리밋 키가 **IP 단독**이다(분당 120).
- **`POST /messages`가 `GET`이 아닌 이유**는 자명하나, **응답에 `state`를 반드시 되돌려주는 계약**을 명시한다. 클라이언트는 *항상* 응답의 `state`로 자기 보관본을 덮어쓴다(부분 갱신 금지 — 서버가 봉투를 폐기했을 때 클라이언트가 옛 값을 유지하면 무한 폐기 루프가 생긴다).

### 5.4 개발명세서 §4 표 갱신 (오류 정정 포함)

```
| 품질/시뮬레이션 | `POST /chatbots/:chatbotId/simulate`, `POST /chatbots/:chatbotId/simulate/compare` | 10 |
| 채널 | `/chatbots/:chatbotId/channels`(+`PATCH｜DELETE /:type`). `POST /webhooks/:channel`은 **미구현(외부 채널 Phase)** | 11 |
| 공개 대화(인증 없음) | `GET /public/chatbots/:slug/config`, `POST /public/chatbots/:slug/messages` | 11 |
```

정정 3건: ① `:id` → `:chatbotId` ② `/compare` → `/simulate/compare`(시뮬레이션 하위 자원임을 경로로 표현) ③ `/webhooks/:channel`은 **만들지 않으므로** 표에서 "미구현"으로 표기(요구사항 §9.1).

### 5.5 `ApiErrorCode` 추가 코드표

| code | HTTP | 발생 지점 | 사용자 메시지(기본) |
|---|---|---|---|
| `CHANNEL_NOT_IMPLEMENTED` | 409 | `PATCH /channels/:type`에서 `CONFIG_ONLY` 채널을 `enabled=true`로 전환 시도 | "이 채널은 아직 연동을 제공하지 않습니다. 설정만 미리 저장할 수 있습니다." |
| `CHANNEL_DISABLED` | 403 | 공개 API — WEB 채널 `enabled=false` | "현재 상담을 이용할 수 없습니다." |
| `CHATBOT_NOT_PUBLISHED` | 403 | 공개 API — 챗봇 `status !== 'ACTIVE'` | "현재 상담을 이용할 수 없습니다." |
| `ORIGIN_NOT_ALLOWED` | 403 | 공개 API — Origin이 `allowedOrigins`에 없음 | "허용되지 않은 도메인에서의 요청입니다." |
| `RATE_LIMITED` | 429 | 공개 API 레이트리밋 초과 | "요청이 많습니다. 잠시 후 다시 시도해 주세요." |
| `OVERLAY_INVALID` | 400 | 오버레이 항목 스키마 위반(FR-10-20) | "미저장 변경 내용에 올바르지 않은 값이 있습니다." + `details[].field = 'overlay.dialogNodes[0].outputs[1].altText'` |
| `NO_CHANGES_TO_COMPARE` | 400 | 비교 실행 시 오버레이가 비어 있음(FR-10-31) | "비교할 변경 내용이 없습니다." |

> **403 3종의 사용자 메시지를 일부러 동일하게** 만든다(`CHANNEL_DISABLED`/`CHATBOT_NOT_PUBLISHED`). 최종 사용자에게 "챗봇은 있는데 채널이 꺼졌다"와 "챗봇이 초안이다"를 구분해 줄 필요가 없다. 반면 **`code`는 구분**되므로 개발자는 응답 본문으로 원인을 판별할 수 있다(FR-11-16의 취지).

---

## 6. NestJS 모듈 구조 (개발명세서 §2.1·§2.2 확장)

```
apps/api/src/
├── app.module.ts                              # (수정) SimulationModule / ChannelsModule / ConversationModule 등록
├── main.ts                                    # (수정) TRUST_PROXY 반영(§11) — CORS 설정은 현행 유지(DD-30)
├── dialogue-common/
│   ├── dialogue-bundle.service.ts             # (수정) 캐시 조회/적재 + invalidate(chatbotId)
│   └── dialogue-bundle.cache.ts               # (신규) interface DialogueBundleCache + InMemory(TTL 60s, LRU)
├── simulation/                                # ── No.10 ──
│   ├── simulation.module.ts
│   ├── simulation.controller.ts               # POST /simulate, POST /simulate/compare
│   ├── simulation.service.ts                  # 스코프검증 → 번들 → (오버레이) → resolveTurn → 이름해석
│   └── lib/                                   # ── 순수 함수 ──
│       ├── overlay-validate.ts                # zod 검증 + 상한 + details 경로 조립(FR-10-20/21)
│       ├── compare-diff.ts                    # outputsChanged / matchChanged / status(FR-10-27)
│       └── resolution-enrich.ts               # matched*Name 해석 · assetCounts 파생(FR-10-8)
├── channels/                                  # ── No.11 설정 ──
│   ├── channels.module.ts / channels.controller.ts / channels.service.ts / channel.mapper.ts
│   └── lib/
│       ├── channel-catalog.ts                 # 레코드 + enum → 8종 목록 조립(FR-11-2)
│       └── channel-config.ts                  # type별 판별 유니온 파싱/직렬화 + 폴백(FR-11-8)
└── conversation/                              # ── No.11 공개 대화 파이프라인 ──
    ├── conversation.module.ts
    ├── public-conversation.controller.ts      # GET /config, POST /messages
    ├── public-conversation.service.ts         # 접근판정 → 어댑터 정규화 → resolveTurn → 격하 → 로그
    ├── public-access.service.ts               # slug → {chatbot, webChannel} 판정(캐시 없음 — §8.1)
    ├── conversation-log.service.ts            # ★ 적재 단일 진입점. 마스킹은 이 안에서만(ADR-0013)
    ├── adapters/
    │   ├── channel-adapter.ts                 # interface ChannelAdapter / ChannelMessage
    │   ├── channel-adapter.factory.ts         # ★ 채널 분기가 존재하는 유일한 파일(NFR-M2)
    │   └── web-channel.adapter.ts             # 이번 Phase의 유일한 구현체(FR-11-18)
    ├── guards/
    │   ├── public-rate-limit.guard.ts         # 429 + Retry-After
    │   └── public-origin.guard.ts             # 403 ORIGIN_NOT_ALLOWED(DD-30)
    ├── rate-limit.store.ts                    # interface + InMemoryRateLimitStore(ADR-0007 패턴 3회차)
    └── lib/                                   # ── 순수 함수 ──
        ├── pii-mask.ts                        # ★ maskPii(text) → { maskedText, counts }(ADR-0013)
        ├── conversation-log.ts                # judgeAnswered / buildBotResponseText / truncate
        ├── rate-limiter.ts                    # 고정 윈도 카운터(순수) — consume(key, now, limit, windowMs)
        ├── origin-match.ts                    # Origin ↔ allowedOrigins 정규화 비교
        └── output-degrade.ts                  # 채널 미지원 아웃풋 → TEXT 격하(FR-11-19)
```

**계층 책임 경계는 개발명세서 §2.1 그대로**이며, 이 그룹에 고유한 규약 3건을 추가한다.

1. **엔진 호출은 서비스 계층에서만** 하고, 컨트롤러는 DTO 변환·HTTP 상태코드만 담당한다.
2. **`ConversationLogService.record()` 밖에서는 `prisma.conversationLog.create`를 호출하지 않는다**(마스킹 우회 경로 차단). code-reviewer 점검 항목.
3. **`if (type === 'KAKAOTALK')` 류 분기는 `channel-adapter.factory.ts`와 `channel-config.ts` 2곳에만** 존재한다(NFR-M2). 그 외 위치의 채널 타입 분기는 리뷰 차단 사유다.

**개발명세서 §2.2 표 갱신**

```
| 품질/채널 (No.10~11) | `simulation`, `channels`, `conversation`(공개 대화 파이프라인·어댑터·로그 적재) + `dialogue-common`(번들 캐시 확장) | 설계 완료 → `quality-channel-설계.md` §6 |
| 보안/통계 (No.12~15) | `auth`, `audit-logs`, `stats`(확장) | 미착수 |
```

---

## 7. `packages/dialogue-engine` 보강 설계 (FR-E2) ★

> 요구사항 §4.4가 발견한 **실행 공백 2건**을 해결한다. 둘 다 순수 함수이며, **기존 230개 테스트가 한 건도 수정되지 않아야 한다**(FR-E2-3, AC-E2-6).

### 7.1 진입점 3층 구조 (DD-26)

```
                     ┌─────────────────────────────────────────────────┐
API 3개 소비자 ──────▶│ resolveTurn(turn, state, bundle, now, options)   │  ★ 유일한 상태 인식 진입점
(simulate/compare/    │  · 봉투 sanitize  · 버튼 라우팅  · nextState 조립 │
 public messages)     └───────────┬──────────────────────┬──────────────┘
                                  │ 텍스트                │ buttonAction.kind==='NODE'
                    ┌─────────────▼─────────────┐ ┌──────▼───────────────────────┐
                    │ resolveResponse(...)      │ │ resolveByNodeId(...)         │  ← 신규
                    │ 시그니처 불변 (ADR-0008)   │ │                              │
                    └───────────────────────────┘ └──────────────────────────────┘
                                  └────────┬──────────────┘
                                   공통 폴백 경로 resolveFallback() (S6 추출)
```

```ts
// packages/dialogue-engine/src/turn.ts (신규)
export interface DialogueTurnInput { message?: string; buttonAction?: ButtonAction }
export interface DialogueTurnResult extends DialogueResolution {
  /** 다음 요청에 그대로 실어 보낼 봉투. 항상 non-null이다(빈 대화도 version만 담긴 봉투). */
  nextState: ConversationState;
  /** 수신 봉투에서 폐기된 항목의 사유. 관리자 API만 노출한다(NFR-S1). */
  stateDiscarded: StateDiscardReason[];
}
export function resolveTurn(
  turn: DialogueTurnInput,
  state: unknown,                    // ← 검증 전 원본을 그대로 받는다(§7.4)
  bundle: DialogueBundle,
  now: Date,
  options?: ResolveOptions,
): DialogueTurnResult;
```

**`resolveTurn`이 `state`를 `unknown`으로 받는 이유**: 봉투 검증을 API가 "잊을 수 있는" 선택 단계로 두면 3개 소비자 중 하나는 반드시 빠뜨린다. `unknown`을 받아 **엔진이 항상 sanitize를 수행**하면, 검증 누락이 타입 시스템상 불가능해진다(NFR-S5를 구조로 보장).

**`ResolveOptions` 확장**(전부 선택 필드 — 하위호환): `pendingClarify?`, `inputLabel?`, `clarifyTtlMs?`, `stateMaxAgeMs?`.

### 7.2 `resolveByNodeId` (FR-E2-1)

```ts
export function resolveByNodeId(
  nodeId: string,
  session: ContextSessionState | null,
  bundle: DialogueBundle,
  now: Date,
  options?: ResolveOptions & { inputLabel?: string },
): DialogueResolution;
```

| 상황 | 동작 |
|---|---|
| 노드 존재 + `enabled` | `trace(NODE, NODE_BY_ID, targetId, targetName)` → `executeOutputs(node.outputs, bundle, now, { hopLimit, existingSession: session })` → `matchedNodeId` 설정 |
| 노드 없음 / `enabled=false` / `nodeId`가 uuid 형식 아님 | `trace(NODE, NODE_BY_ID_NOT_FOUND, targetId: nodeId)` → **예외 없이 공통 폴백 경로**(FALLBACK 노드 → `ERROR_RESPONSE` FAQ → 기본 문구) (FR-E2-5, AC-E2-2) |
| 진행 중 세션이 있는 상태에서 NODE 버튼 클릭 | **버튼이 이긴다.** 세션을 `CANCELLED`로 종료하고 `trace(SESSION, SESSION_CANCELLED)`. `executeOutputs`에 `existingSession`을 그대로 넘겨 `CONTEXT_FORM` 전환 고지(EX-S-7)를 재사용한다 |
| `input` / `normalizedInput` 필드 | `options.inputLabel ?? ''`. 버튼 클릭에는 "입력 문장"이 없으므로 **빈 문자열이 정직한 값**이다. 로그의 `userMessage`는 서비스가 `buttonAction.label`로 채운다(§8.5) |

> **"버튼이 세션을 이긴다"는 판단의 근거**: 슬롯 질문에 딸린 선택지 버튼은 `promptOutputsForSlot()`이 만드는 **`action:'MESSAGE'`** 버튼이다(`context-session.ts:116`). 즉 세션 진행 중에 `action:'NODE'` 버튼이 눌린다는 것은 **사용자가 봇이 제시한 다른 경로로 명시적으로 이탈하겠다는 뜻**이며, 텍스트 입력과 달리 해석의 모호성이 없다.

**리팩터링 지시**: 현재 `resolver.ts`의 S6 블록(`resolver.ts:207-248`)을 **`resolveFallback(ctx, bundle, now, options, carry)` 내부 함수로 추출**한다. `resolveResponse`와 `resolveByNodeId`가 이를 공유한다. 추출은 동작 변경이 없어야 하며(문자열·trace 순서 동일), 기존 폴백 테스트가 회귀 감시자 역할을 한다.

### 7.3 동음이의어 되묻기 종결 — `pendingClarify`와 S1.5 (FR-E2-2, DD-27)

**현행 버그의 정확한 원인**

`buildClarifyOutput()`은 의미 label(`선박`)을 `action:'MESSAGE', value:'선박'` 버튼으로 만든다(`homonym.ts:101-105`). 다음 턴에 `"선박"`이 입력되면 `resolveHomonym("선박", homonyms)`는 `containsWord("선박", "배")`를 검사하는데(`homonym.ts:27`), 입력에 원래 단어 `배`가 없으므로 **사전 자체를 건너뛴다**. 결과적으로 의미 확정이 사라지고 일반 매칭 → 대개 폴백이다(S-9 미성립).

**해결 — 파이프라인에 S1.5 단계를 신설한다**

```
S0.  전처리                                         (변경 없음)
S1.  컨텍스트 세션                                   (변경 1건 ↓)
     ├ session.status === 'IN_PROGRESS' 이면서 pendingClarify가 있으면
     │   → trace(HOMONYM, CLARIFY_DISCARDED, message:'세션 우선'); pending = null
     │     (슬롯 질문이 더 최근의 질문이다. 되묻기는 포기한다)
     └ (이하 기존 로직 동일)

S1.5 되묻기 해소 (CLARIFY) ── 신규 ────────────────────────────────────────
     if (!pending) → 건너뜀
     if (now - pending.askedAt > clarifyTtlMs(기본 10분))
        → trace(HOMONYM, CLARIFY_DISCARDED, message:'만료'); pending = null; S2로
     dict = bundle.homonyms.find(d => d.id === pending.homonymId)
     if (!dict) → trace(HOMONYM, CLARIFY_DISCARDED, message:'사전 삭제됨'); pending = null; S2로
     idx = 다음 순서로 첫 매치를 찾는다
        ① 의미 label 정규화 정확 일치      normalizeText(label) === norm      ← 버튼 클릭 경로
        ② 의미 label 단어 단위 포함         containsWord(norm, label)          ← "선박이요"
        ③ 의미 contextHints 단어 단위 포함  containsWord(norm, hint)           ← "타는 배요"
     if (idx >= 0):
        meaning = dict.meanings[idx]
        clarified = { homonymId: dict.id, intentId: meaning.intentId, label: meaning.label }
        homonymResolution = { word: dict.word, status:'RESOLVED', meaningLabel, intentId, matchedHints: [] }
        trace(HOMONYM, CLARIFY_RESOLVED, targetId: dict.id, message: meaning.label)
        pending = null
        → S2를 건너뛰고 S3으로 (재되묻기 무한루프 차단)
     else:
        trace(HOMONYM, CLARIFY_DISCARDED, targetId: dict.id)
        pending = null
        → S2 정상 진행 (일반 해석, AC-E2-5)

S2.  동음이의어 보정   (S1.5에서 확정된 경우 건너뜀. AMBIGUOUS+ASK 반환 시 ↓ 추가)
     └ 되묻기 아웃풋을 반환할 때 resolution.pendingClarify = { homonymId, word, askedAt: now } 를 함께 담는다

S3~S6 (변경 없음)
```

**의도 확정 규칙 — "부스트"로는 고쳐지지 않는다**

`matchIntent`의 `boostIntentIds`는 **예문이 일단 매칭된 뒤에만** 점수를 더한다(`matcher.ts:38-46`). 사용자가 `"선박"`만 보냈을 때 `선박_문의` 의도의 예문(`"배 언제 와요"` 등)은 정규화 부분일치에 걸리지 않으므로 `matchIntent`는 **`null`을 반환**하고, 부스트는 아무 효과가 없다. 따라서:

```ts
const intentMatch = matchIntent(raw, bundle.intents, { boostIntentIds, index: options.index });
// S1.5에서 확정된 의미가 있으면, 예문 매칭이 실패해도 그 의도를 확정 값으로 채택한다.
ctx.matchedIntentId = intentMatch?.intentId ?? clarified?.intentId;
```

- **부스트는 유지**한다(입력이 `"선박 요금 얼마예요"`처럼 풍부하면 예문 매칭이 성공하고, 그때는 확정 의도가 최우선 후보가 된다).
- **S5(의도 단독) 진입 조건 완화**: 현재 `if (ctx.matchedIntentId && intentMatch)`이다. `ctx.matchedIntentId`는 지금까지 오직 `intentMatch?.intentId`에서만 왔으므로 두 조건은 **기존 입력에 대해 논리적으로 동치**다. 이를 `if (ctx.matchedIntentId)`로 바꾸고 예문은 `intentMatch?.matchedExample ?? 해당 의도의 첫 예문 ?? ''`를 쓴다. **기존 테스트 동작은 바뀌지 않으며**, 확정 의도에 매칭 노드가 없는 경우에도 폴백 대신 의도 단독 응답이 나간다.

**`pendingClarify`가 부여/소멸되는 지점(전수)**

| 시점 | 값 |
|---|---|
| S2에서 `AMBIGUOUS` + policy `ASK` 되묻기 출력 | **부여** `{ homonymId, word, askedAt: now }` |
| S1.5에서 label/힌트 일치 | 소멸(`CLARIFY_RESOLVED`) |
| S1.5에서 불일치 / TTL 초과 / 사전 삭제 | 소멸(`CLARIFY_DISCARDED`) |
| S1에서 진행 중 세션과 동시 존재 | 소멸(`CLARIFY_DISCARDED`, 세션 우선) |
| 그 외 모든 경로 | `null`(되묻기가 아닌 응답이 나갔다면 더 이상 대기 중이 아니다) |

### 7.4 봉투 재검증 `sanitizeConversationState` (FR-10-4, NFR-S5)

`packages/dialogue-engine/src/conversation-state.ts`(신규). `resolveTurn`이 **항상 첫 줄에서** 호출한다.

| # | 검사 | 실패 시 | 사유 코드 |
|---|---|---|---|
| 1 | `ConversationStateSchema.safeParse(raw)` | 봉투 **전체** 폐기 → 새 대화 | `INVALID_SCHEMA` |
| 2 | `version !== 1` | 봉투 전체 폐기 | `VERSION_MISMATCH` |
| 3 | 직렬화 크기 > 16KB 또는 `filledValues` 키 > 20 / 값 > 1,000자 | `contextSession` 폐기 | `OVERSIZED` |
| 4 | `contextSession.contextVariableId`가 **이 챗봇 번들**에 없음 | `contextSession` 폐기 | `UNKNOWN_CONTEXT` |
| 5 | `startedAt`이 미래(허용 오차 5분) 또는 `now - startedAt > 24h` | `contextSession` 폐기 | `SESSION_EXPIRED` |
| 6 | `lastInteractedAt > now` | `now`로 **보정**(폐기 아님) | — |
| 7 | `pendingClarify.homonymId`가 번들에 없음 | `pendingClarify` 폐기 | `UNKNOWN_HOMONYM` |
| 8 | `now - pendingClarify.askedAt > 10분` | `pendingClarify` 폐기 | `CLARIFY_EXPIRED` |

- **④가 교차 챗봇 방어의 실체다**(AC-10-9, EX-10-4). 번들은 항상 요청 챗봇의 것이므로, 타 챗봇의 `contextVariableId`는 자동으로 "없는 ID"가 되어 폐기된다. **타 챗봇 자산을 조회하지 않으므로 정보가 새어나갈 경로 자체가 없다.**
- **어떤 검사도 예외를 던지지 않고 `400`을 만들지 않는다**(FR-10-4, AC-10-7). 결과는 항상 "폐기 + 새 대화"다.
- `trace(PREPROCESS, STATE_DISCARDED, message: 사유)`를 남긴다 — 관리자 시뮬레이터가 "왜 세션이 사라졌는지" 볼 수 있어야 한다.

### 7.5 오버레이 병합 `mergeOverlay` (FR-10-19, DD-28)

`packages/dialogue-engine/src/overlay.ts`(신규). **DB·zod 무의존 순수 함수**.

```ts
export function mergeOverlay(bundle: DialogueBundle, overlay: DialogueOverlay): DialogueBundle;
```

종류별(6종) 동일 규칙:
1. `deletedIds[kind]`에 포함된 id를 먼저 제거한다.
2. 오버레이 항목의 `id`가 남은 배열에 있으면 **교체**, 없으면 **추가**(`draft-` 접두 임시 id 포함).
3. 원본 `bundle`을 변형하지 않는다(새 배열 반환). 노드는 **병합 후 `rankNodes` 정렬이 다시 필요**하므로, 오버레이가 적용된 번들에 대해서는 **인덱스를 새로 만든다**(캐시된 인덱스를 재사용하면 신규 노드가 평가되지 않는다 — AC-10B-2 직결).
4. 존재하지 않는 id의 `deletedIds`는 **오류가 아니라 무시**(EX-10-8).

> **엔진에 두는 이유**: `DialogueBundle`에 배열이 추가되면(향후 No.26/27) `mergeOverlay`도 함께 바뀌어야 하는데, 같은 패키지에 있으면 **타입 누락이 컴파일 에러로 드러난다**. `apps/api`에 두면 조용히 한 종류가 병합되지 않는 버그가 생긴다.
> **zod 검증은 `apps/api`에 남긴다**: 오버레이 항목 검증은 **저장 API와 동일한 스키마**를 써야 하는데(FR-10-20), 그 스키마는 `shared-types`의 `Create*Schema` 계열이고 오류 `details[].field` 경로 조립은 HTTP 관심사다.

### 7.6 하위호환 체크리스트 (FR-E2-3, AC-E2-6)

| 항목 | 보장 방법 |
|---|---|
| `resolveResponse(input, session, bundle, now, options?)` | **시그니처 불변**. 새 입력은 전부 `options`의 선택 필드 |
| `resolveByNodeId` / `resolveTurn` | **신규 함수 추가**(기존 export 제거 없음) |
| `DialogueResolution` | 선택 필드 `pendingClarify` 1개만 추가. 기존 필드 이름·타입·유무 불변 |
| `ContextSessionState` | **변경 없음**. 봉투가 이를 *감쌀* 뿐 대체하지 않는다 |
| `TraceCodeEnum` | 값 5개 추가(제거·변경 없음) |
| `simulate()` | 변경 없음. `@deprecated` 유지 — **이번 Phase에도 제거하지 않는다**(ADR-0008은 "No.10에서 제거"를 예고했으나, 제거는 테스트 수정을 동반하므로 **기능 변경과 리팩터링을 섞지 않는다**는 원칙을 우선한다. 제거는 No.12 이후 독립 작업으로 이관) |
| `DialogueIndex` | `nodesById: Map<string, DialogNode>` 1개 추가(`resolveByNodeId` O(1) 조회용). 기존 필드 불변 |
| 기존 230개 테스트 | **수정 0건으로 통과**해야 한다. 이것이 FR-E2 구현의 완료 판정 기준이다 |

### 7.7 신규 trace 코드 요약 (FR-E2-6)

| stage | code | 의미 | 관리자 화면 한국어 레이블(FR-10-9) |
|---|---|---|---|
| `NODE` | `NODE_BY_ID` | 버튼 액션으로 노드 직접 실행 | "버튼으로 노드 실행" |
| `NODE` | `NODE_BY_ID_NOT_FOUND` | 대상 노드 없음/비활성 → 폴백 | "버튼이 가리키는 노드를 찾지 못함" |
| `HOMONYM` | `CLARIFY_RESOLVED` | 되묻기 응답으로 의미 확정 | "되묻기 응답으로 '{label}' 의미 확정" |
| `HOMONYM` | `CLARIFY_DISCARDED` | 되묻기 대기 폐기(불일치/만료/세션우선) | "되묻기 대기 해제" |
| `PREPROCESS` | `STATE_DISCARDED` | 수신 대화 상태 봉투 일부/전체 폐기 | "이전 대화 상태를 사용할 수 없어 초기화" |

---

## 8. 핵심 로직 규격 (서버)

### 8.1 번들 캐시와 무효화 (DD-22, FR-11-27, NFR-P1/P2)

```ts
export interface DialogueBundleCache {                       // ADR-0007 ImportStagingStore 패턴 3회차
  get(chatbotId: string): CachedBundle | undefined;          // { bundle, index, cachedAt }
  set(chatbotId: string, value: CachedBundle): void;
  invalidate(chatbotId: string): void;
  clear(): void;
}
```

- 구현체 `InMemoryDialogueBundleCache`: **TTL 60초**(`DIALOGUE_BUNDLE_CACHE_TTL_MS`) + **LRU 최대 50 챗봇**. 단일 인스턴스 전제이며, 다중 인스턴스 전환 시 교체 지점은 이 인터페이스 1곳이다.
- **캐시에 담는 것**: `DialogueBundle` + `buildDialogueIndex()` 결과. 인덱스 재계산이 콜드 비용의 대부분이므로 함께 담는다(NFR-P2).
- **캐시에 담지 않는 것**: `Chatbot.status`, `Channel.enabled/config`. → **§8.1의 핵심 결정**

> **챗봇 상태·채널을 캐시에서 제외하는 이유(중요)**
> AC-P-14와 S-10(긴급 중단)은 "**캐시 TTL과 무관하게 즉시** 차단"을 요구한다. 이를 캐시 무효화로 달성하려면 채널 쓰기 경로가 반드시 무효화를 호출해야 하고, 한 번 빠뜨리면 **최대 60초 동안 잘못된 답변이 계속 나간다** — 이 기능의 존재 이유 자체가 무너진다.
> 반면 `PublicAccessService`가 매 요청 `chatbot(slug)` + `channel(chatbotId, 'WEB')` 2건을 조회하면(둘 다 유니크 인덱스 적중, 합계 1ms 내외) **즉시성이 구조적으로 보장**된다. 대화 응답 예산 500ms(NFR-P1) 대비 무시할 수 있는 비용으로 "잊어버릴 수 있는 규칙"을 "잊을 수 없는 구조"로 바꾼다.

- **무효화 호출 지점**(EX-10-6): 6개 대화 자산 모듈(`intents`/`keywords`/`homonyms`/`contexts`/`dialog-nodes`/`faqs`)의 **쓰기 성공 직후**(생성·수정·삭제·대량 커밋). `DialogueCommonModule`이 `DialogueBundleService.invalidate()`를 export한다.
- **누락 시 최대 피해는 60초 지연**이며, 즉시성이 필수인 것(채널)은 위 결정으로 이미 분리돼 있다. 각 모듈 통합 테스트에 "쓰기 직후 시뮬레이션이 변경을 반영한다" 1케이스씩 추가한다.
- **오버레이 요청은 캐시를 오염시키지 않는다**: 캐시에서 저장본을 꺼낸 뒤 `mergeOverlay`로 **새 객체**를 만들고, 그 결과는 절대 `set()`하지 않는다(FR-10-22, AC-10B-1).

### 8.2 채널 구현 등급과 어댑터 계약 (FR-11-17~19, ADR-0011)

```ts
export interface ChannelAdapter {
  readonly type: ChannelType;
  readonly supportedOutputTypes: ReadonlySet<DialogOutputType>;
  normalizeInbound(raw: unknown): InboundTurn;               // { sessionId, message?, buttonAction?, state? }
  renderOutbound(outputs: DialogOutput[]): ChannelMessage[];
}
```

- **구현체는 `WebChannelAdapter` 1종뿐이다.** 나머지 7종은 **파일조차 만들지 않는다**(FR-11-18 — 빈 구현체는 "구현됐다"는 착시를 만든다).
- `web-channel.adapter.ts`: `supportedOutputTypes = {TEXT, CARD, IMAGE, BUTTON, LINK, PAUSE, PHONE_CALL}`. `renderOutbound`는 `degradeOutputs(outputs, supported)`를 거친 뒤 `[{ outputs }]` 1건을 반환한다(WEB은 격하 0건이지만 **경로는 탄다** — 새 채널이 추가될 때 격하 규칙이 이미 동작 중인 상태여야 한다).
- `degradeOutputs()`(순수, `lib/output-degrade.ts`): 미지원 타입 → `TEXT`로 격하(`[카드] 제목 / 본문`, `[이미지] altText` 등). **이번 Phase에 호출되지만 변환이 0건**이라는 사실을 단위 테스트로 고정한다.
- `channel-adapter.factory.ts`: `getChannelAdapter(type)` — `WEB`이면 어댑터, 그 외는 `ApiException('CHANNEL_NOT_IMPLEMENTED', 409)`. **채널 타입 분기가 존재하는 유일한 파일**(NFR-M2).
- **새 채널 추가 비용(설계 목표)**: 어댑터 파일 1개 + 팩토리 분기 1줄 + `channelConfigSchemaFor` 분기 1줄 + `CHANNEL_IMPLEMENTATION` 값 1개 변경. 대화 처리 코어는 **한 줄도 바뀌지 않는다.**

### 8.3 공개 대화 1턴 파이프라인 (FR-11-14~27)

```
POST /api/v1/public/chatbots/:slug/messages
 ①  PublicRateLimitGuard          sessionId 30/min · IP 120/min → 429 + Retry-After   (DB 접근 전)
 ②  PublicOriginGuard             Origin ∈ allowedOrigins(비었으면 전체 허용) → 403    (§8.7)
 ③  ZodValidationPipe             PublicMessageRequestSchema → 400
 ④  PublicAccessService.resolve(slug)
       chatbot 없음        → 404 NOT_FOUND
       status !== 'ACTIVE' → 403 CHATBOT_NOT_PUBLISHED
       WEB 채널 없음/비활성 → 403 CHANNEL_DISABLED                    ← 캐시 없음(§8.1)
 ⑤  adapter = getChannelAdapter('WEB');  inbound = adapter.normalizeInbound(dto)
 ⑥  { bundle, index } = DialogueBundleService.get(chatbot.id)         ← 캐시 적중 경로
 ⑦  result = resolveTurn({ message, buttonAction }, inbound.state, bundle, now, { index })
 ⑧  messages = adapter.renderOutbound(result.outputs)                 ← 격하 규칙 통과
 ⑨  응답 반환 { messageId, outputs, state: result.nextState, stateReset }   ★ 여기서 사용자에게 응답
 ⑩  void ConversationLogService.record({...})                         ← await 하지 않는다(FR-11-24, NFR-P6)
```

- **⑨와 ⑩의 순서가 계약이다.** 로그 적재 실패가 대화를 실패시키지 않으며(AC-P-10), 적재 지연이 P95에 반영되지 않는다(NFR-P6). `record()`는 자체 `try/catch`로 모든 예외를 삼키고 `logger.warn`만 남긴다 — **경고 로그에도 메시지 본문을 넣지 않는다**(`chatbotId`/`sessionId`/오류코드만, NFR-S4).
- `messageId`는 ⑨ 이전에 생성한 uuid이며 **`ConversationLog.id`로 그대로 사용**한다. 향후 No.44(👍/👎 피드백)가 이 값을 앵커로 쓸 수 있게 하기 위함이며, 로그 적재가 실패해도 응답은 유효한 uuid를 돌려준다(그 경우 앵커가 가리키는 행이 없을 뿐이다).
- **`GET /config`** 경로: ①②④만 수행하고 `PublicChatbotConfigSchema`를 반환한다. `greetingMessage`/`quickReplies`/`launcherPosition`/`showLauncher`는 **WEB 채널 `config`에서** 오고, `name`/`avatarUrl`/`skin`은 `Chatbot`에서 온다.
- **AC-P-15(엔진 단일 경로 동일성)의 구조적 근거**: 시뮬레이션·비교·공개 대화가 모두 ⑥⑦의 동일한 `DialogueBundleService` + `resolveTurn` 쌍을 호출한다. 차이는 오직 **오버레이 적용 여부와 응답 스키마**뿐이다(FR-0-19).

### 8.4 PII 마스킹 (FR-11-23, NFR-S4, ADR-0013)

- **구현 위치**: `apps/api/src/conversation/lib/pii-mask.ts` — `maskPii(text): { maskedText, counts }` 순수 함수(DD-21 ①안).
- **적용 위치**: `ConversationLogService.record()` **내부 단 1곳**. 인자는 `rawUserMessage`/`rawBotResponse`로 명명하고, 마스킹된 값만 Prisma에 도달한다. 이 서비스 밖에서 `prisma.conversationLog.create`를 호출하지 않는다는 규약(§6)이 우회 경로를 차단한다.
- **종류별 차등 정책**(FR-11-23의 예시와 위험도를 함께 만족시킨다)

| 종류 | 치환 결과 | 근거 |
|---|---|---|
| 주민등록번호 | `[주민등록번호]` **전량** | 뒷 7자리 자체가 고유식별정보다. 부분 노출 불가 |
| 카드번호 | `[카드번호]` **전량** | 부분도 금융정보 |
| 계좌번호 | `[계좌번호]` **전량** | 동일 |
| 전화번호 | `010-****-5678` **부분** | FR-11-23 예시. 상담 맥락 식별(같은 사람 문의인지)에 필요하고, 중간 4자리 제거로 역추적 가치가 크게 떨어진다 |
| 이메일 | `a***@example.com` **부분** | FR-11-23 예시. 도메인은 B2B 문의 분석에 쓰인다 |

- **`botResponse`도 반드시 마스킹한다.** 봇 응답은 관리자가 작성한 문구이지만, **`completionMessage`의 `{슬롯명}` 치환**(`context-session.ts:137`)으로 **사용자가 입력한 전화번호·이메일이 그대로 봇 응답에 들어간다**. 이 경로가 있는 한 `botResponse` 마스킹 생략은 곧 유출이다.
  - 부작용: `PHONE_CALL` 아웃풋의 대표번호도 마스킹된다. **수용**한다 — 운영자는 노드 편집 화면에서 원문을 볼 수 있고, 로그에서 회사 대표번호를 읽어야 할 이유가 없다.
- **탐지 구조**: 형제 프로젝트 `Auto QA`의 `packages/pii-mask` **2단계 구조를 설계로 이식**한다 — ①단계 구분자가 있어 형태로 종류가 특정되는 패턴, ②단계 남은 "구분자 없는 연속 숫자열"을 길이·문맥·검증(주민번호 날짜/성별코드, 카드 Luhn)으로 분류. **코드는 복제하지 않는다**(별도 저장소이며 드리프트 원천이 된다). fail-closed 원칙(미탐 > 과탐 위험)도 함께 상속한다.
- **한계 명시**: 규칙 기반이므로 사람 이름·주소·문맥 의존 PII는 탐지하지 못한다. 설계서·코드 주석·`docs/04-test`에 알려진 한계로 기록한다.
- **승격 조건(DD-21)**: 소비자가 2곳 이상이 되면 `packages/pii-mask`로 승격한다. 예상 트리거 — ml-worker의 학습 데이터 전처리(No.16), 통합 인박스(No.42). 그 전까지는 패키지를 만들지 않는다.

### 8.5 `isAnswered` 판정과 `botResponse` 텍스트화 (FR-11-21, FR-11-22, DD-31)

```ts
const FALLBACK_TRACE_CODES = ['FALLBACK_NODE','FALLBACK_FAQ','FALLBACK_DEFAULT','EMPTY_INPUT'] as const;
export function judgeAnswered(trace: TraceStep[]): boolean {
  return !trace.some((s) => FALLBACK_TRACE_CODES.includes(s.code));
}
```

> **요구사항의 "trace의 마지막 단계" 규칙을 수정하는 이유(DD-31)**: 현행 엔진은 `FALLBACK_NODE`를 push한 **뒤** `executeOutputs`의 trace를 이어 붙인다(`resolver.ts:210-212`). 따라서 폴백 노드에 `DIALOG_MOVE`나 미지원 아웃풋이 있으면 마지막 코드는 `BROKEN_REFERENCE`/`UNSUPPORTED_OUTPUT`이 되고, **"마지막 단계" 규칙은 폴백을 응답 성공으로 오판한다**. 폴백 코드 4종은 폴백 경로에서만 생성되므로 **존재 여부 검사가 더 정확하고 더 단순하다**.
> 부수 효과: `HOP_LIMIT_EXCEEDED`로 중단된 턴은 `isAnswered=true`로 집계된다(실제로 응답은 나갔다). 이는 의도된 동작이며, 해당 사례는 `trace`가 아니라 **설계 점검(`MOVE_CYCLE`)** 이 잡는 문제다.

`buildBotResponseText(outputs)` = `outputsToPlainText(outputs, 2000)`(§4.4) — TEXT는 본문, 그 외는 `[카드] 제목` 형태 요약, `PAUSE`는 생략, 줄바꿈 조인, 2,000자 초과 시 `…`로 절단(FR-11-22).

`userMessage` 결정 규칙:

| 입력 | 저장값 |
|---|---|
| 텍스트 메시지 | 원문(마스킹 후) |
| `buttonAction {kind:'MESSAGE', text}` | `text`(마스킹 후) — 말풍선에 표시된 그대로 |
| `buttonAction {kind:'NODE', nodeId, label}` | `label ?? '[버튼 선택]'` — **`nodeId`는 저장하지 않는다**(로그는 사용자가 본 것을 기록한다. 노드는 `matchedNodeId`에 이미 있다) |

### 8.6 레이트리밋 (NFR-S2, DD-23/DD-30)

```ts
// lib/rate-limiter.ts — 순수 함수(고정 윈도 카운터)
export function consume(entry: WindowEntry | undefined, now: number, limit: number, windowMs: number)
  : { allowed: boolean; entry: WindowEntry; retryAfterSec: number };
```

- **두 축을 동시에** 적용한다: `session:{sessionId}` 30/분, `ip:{clientIp}` 120/분. 둘 중 하나라도 초과하면 `429` + `Retry-After`(남은 초, 정수 올림).
- 저장소는 `RateLimitStore` 인터페이스 + `InMemoryRateLimitStore`(Map + 만료 항목 지연 정리). ADR-0007(`ImportStagingStore`), DD-22(`DialogueBundleCache`)와 **동일 패턴 3회차**이며, 다중 인스턴스 전환 시 교체 지점이 1곳이다.
- **`@nestjs/throttler`를 도입하지 않는 이유**: ① 요구 정책이 "서로 다른 키를 쓰는 두 축 동시 적용"이라 라이브러리의 named throttler + `getTracker` 오버라이드 조합이 버전마다 다르게 동작해 오히려 우회 코드가 늘어난다 ② 공개 API에만 적용해야 하는데 전역 가드를 붙이고 관리자 API를 `@SkipThrottle`로 빼는 형태는 "기본 열림"이라 위험하다 ③ 본체가 20줄 남짓한 순수 함수라 NFR-M1(순수 함수 단위 테스트) 규약과 정확히 맞는다 ④ 신규 런타임 의존성 0건 유지.
- **클라이언트 IP 산출**: `TRUST_PROXY=false`(기본)면 소켓 주소, `true`면 `X-Forwarded-For`의 **가장 왼쪽 값**. 무조건 헤더를 신뢰하면 IP 기준 제한을 헤더 조작으로 무력화할 수 있으므로 **명시적 opt-in**으로 둔다.
- **관리자 API에는 적용하지 않는다**(NFR-S9).

### 8.7 Origin 인가 (NFR-S3, DD-30)

**결정: CORS 헤더가 아니라 서버 가드로 판정한다.**

```
PublicOriginGuard:
  origin = req.headers.origin
  allowed = WEB 채널 config.allowedOrigins        // 매 요청 조회(§8.1 — 캐시 없음)
  if (allowed.length === 0) → 통과 (FR-11-9: 모든 출처 허용 + 화면에 주의 배지)
  if (!origin)              → 통과 (서버 간 호출·동일 출처. CORS로 보호되는 대상이 아니다)
  if (normalizeOrigin(origin) ∉ allowed) → 403 ORIGIN_NOT_ALLOWED + 서버 경고 로그(EX-P-4)
```

- **근거 3가지**: ① **CORS는 브라우저 정책이지 서버 인가가 아니다** — `curl`이나 서버 대 서버 호출은 CORS를 통과하므로 CORS만으로는 보호가 성립하지 않는다. ② `allowedOrigins` 변경이 **즉시 반영**된다(FR-11-10) — CORS delegate에서 DB를 매 preflight마다 조회하는 구조는 성능상 캐시를 강제하고, 그러면 즉시성이 깨진다. ③ **브라우저 없이 테스트할 수 있다**(supertest로 `403` 검증).
- **AC-P-11의 해석 고정**: "CORS로 차단된다" → "**허용되지 않은 Origin 헤더를 실은 요청이 `403 ORIGIN_NOT_ALLOWED`를 받는다**"로 검증한다. `test-automation` 인계 사항.
- 전역 `app.enableCors()`는 **현행 유지**한다(변경 0줄). 브라우저 프리플라이트를 통과시켜 위젯이 서버의 `403` 본문을 읽고 사용자 문구를 고를 수 있게 하기 위함이다(FR-W-10). 자격증명(쿠키)은 사용하지 않는다(`credentials: 'omit'`, NFR-S3).
- `normalizeOrigin()`(순수, `lib/origin-match.ts`): 소문자화 + 기본 포트(`:80`/`:443`) 제거 + 후행 슬래시 제거 후 **완전 일치** 비교. 서브도메인 와일드카드는 지원하지 않는다(EX-11-4).

### 8.8 비교 실행과 diff 판정 (FR-10-25~31)

```
POST /simulate/compare
  overlay가 비어 있으면(6종 배열 + deletedIds 전부 공백) → 400 NO_CHANGES_TO_COMPARE      (FR-10-31)
  bundleA = 저장본(캐시)                        indexA = 캐시된 인덱스          ← 재사용
  bundleB = mergeOverlay(bundleA, overlay)      indexB = buildDialogueIndex(B)  ← 요청당 1회만(NFR-P4)
  stateA = stateB = initialState ?? null        ← A/B 독립 진행(AC-10B-9)
  for (i, message) of messages:
     a = resolveTurn({message}, stateA, bundleA, now, {index: indexA});  stateA = a.nextState
     b = resolveTurn({message}, stateB, bundleB, now, {index: indexB});  stateB = b.nextState
     diff = compareDiff(a, b)
```

`compareDiff(a, b)`(순수, `lib/compare-diff.ts`):

| 항목 | 판정 |
|---|---|
| `outputsChanged` | 아웃풋 배열을 **정규화 직렬화** 후 비교. 정규화 = `{type, payload}` 키 정렬 + `undefined` 제거. `PAUSE.durationMs`처럼 표시에 영향 없는 필드도 포함(문구가 같아도 대기 시간이 바뀌면 변경이다) |
| `matchChanged` | `matchedNodeId`·`matchedFaqId`·`matchedIntentId` 3쌍 중 하나라도 다르면 `true`. **아웃풋 문구가 우연히 같아도 잡힌다**(AC-10B-8) |
| `status` | `outputsChanged ｜｜ matchChanged` → `'DIFFERENT'`, 아니면 `'SAME'` |

- `trace`는 diff 판정에 **쓰지 않는다**(같은 응답이어도 경유 경로 차이로 trace가 달라질 수 있어 노이즈가 된다). 단 화면에서는 행별로 펼쳐 볼 수 있도록 응답에 포함한다.
- 상한 초과(문장 21건 / 각 1,001자 / 오버레이 종류별 21건 / 본문 1MB)는 전부 `400 LIMIT_EXCEEDED`(AC-10B-5, AC-10B-11). **본문 1MB 제한은 컨트롤러가 아니라 Nest body parser 설정**으로 건다(파싱 전에 잘라야 의미가 있다).
- **읽기 전용 보장**(FR-0-21, FR-10-30, AC-10-14/AC-10B-12): `SimulationService`는 `PrismaService`의 **읽기 메서드만** 호출한다. `ConversationLogService`를 주입하지 않는다(의존성 그래프상 로그를 남길 수 없다 — 규약이 아니라 구조로 보장).

---

## 9. `apps/widget` 설계 (FR-W-1~24, ADR-0012)

### 9.1 기술 스택과 파일 구조 (DD-25)

**결정: 런타임 의존성 0의 순수 TypeScript + Vite 라이브러리 모드(IIFE). React를 쓰지 않는다.**

근거는 ADR-0012에 있으며 요약하면 ① React+ReactDOM만으로 gzip ≈45KB를 소진해 100KB 예산(NFR-P5)이 상시 리스크가 된다 ② Shadow DOM 경계에서 React 이벤트 위임은 추가 검증 부담을 만든다 ③ 화면이 **1개**(런처+패널)이고 라우팅이 플래그 1개뿐이라 프레임워크의 가치가 낮다 ④ FR-W-16("DOM 무의존 단위 테스트")은 "순수 로직 / DOM 적용" 분리로 달성되며 프레임워크가 필요 없다.

```
apps/widget/
├── package.json            # dependencies: @chat-bot/shared-types(서브패스 값 import 전용) — 그 외 런타임 의존성 0
├── vite.config.ts          # /c/:slug 전체화면 SPA 빌드
├── vite.config.loader.ts   # widget.js 라이브러리(IIFE) 빌드 — 파일명 고정, 해시 없음
├── index.html              # /c/:slug 호스트 문서
├── scripts/check-bundle-size.mjs   # gzip 100KB 게이트(AC-W-17) — node 내장 zlib만 사용
└── src/
    ├── loader.ts           # ★ widget.js 진입점: data-* 파싱 → 중복 초기화 방지 → 런처 마운트
    ├── fullscreen.ts       # /c/:slug 진입점: pathname에서 slug 추출 → 패널 100% 렌더
    ├── api/public-client.ts        # fetch 래퍼(credentials:'omit') + 오류 분류(NETWORK|400|403|404|429|5xx)
    ├── core/               # ── DOM 무의존 순수 로직(FR-W-16) ──
    │   ├── store.ts        # { status, messages[], composerText, error } + 순수 reducer
    │   ├── session.ts      # sessionId 발급/보관 + state 봉투 보관(sessionStorage→메모리 폴백, EX-W-7)
    │   ├── button-action.ts        # @chat-bot/shared-types/output-view 위임 + 전송 여부 판정
    │   └── pause-schedule.ts       # PAUSE 지연 큐(총 5초 상한, FR-W-7)
    ├── ui/                 # ── DOM 렌더 ──
    │   ├── shadow-root.ts / launcher.ts / panel.ts / message-list.ts / composer.ts
    │   └── renderers/{text,card,image,button,link,phone-call}.ts
    ├── styles.ts           # CSS를 TS 문자열 상수로 보관(Shadow DOM에 주입 — 별도 CSS 요청 0건)
    └── constants/messages.ts       # 한국어 문구 1곳(FR-0-23, FR-W-14)
```

- **`packages/dialogue-engine`을 의존하지 않는다.** 위젯은 해석하지 않고 서버 결과만 렌더한다. 엔진을 번들에 넣으면 예산이 무너지고, 더 중요하게는 **대화 자산 매칭 규칙이 클라이언트에 노출**된다.
- **`@chat-bot/shared-types` 루트 import 금지**(§4.4 ESLint 규칙). 값은 `/output-view`·`/contrast` 서브패스로만, 타입은 `import type`으로만 가져온다.
- 워크스페이스 스크립트 세트(`dev`/`build`/`test`/`lint`/`typecheck`)를 `apps/web`과 **동일한 이름**으로 제공한다(NFR-M4 — 루트 `pnpm -r build`/`test`가 그대로 동작).

### 9.2 빌드 타깃 2종과 번들 예산 게이트

| 타깃 | 진입점 | 산출물 | 특성 |
|---|---|---|---|
| 임베드 로더 | `src/loader.ts` | **`dist/widget.js`**(파일명 고정, 해시 없음) | IIFE, `cssCodeSplit:false`, CSS는 TS 문자열로 인라인. **기존 임베드 스니펫 계약(FR-W-2)을 지키려면 파일명이 고정이어야 한다** |
| 전체화면 | `index.html` → `src/fullscreen.ts` | `dist/index.html` + 해시 번들 | `/c/:slug` 라우트. 정적 호스팅에 **`/c/*` → `index.html` SPA fallback** 필요(배포 문서 인계) |

- `pnpm --filter @chat-bot/widget build` = 두 config 순차 실행 후 동일 `dist/`로 합류 → **`scripts/check-bundle-size.mjs` 실행**. `widget.js`의 gzip 크기가 **100KB를 넘으면 빌드 실패**(AC-W-17을 리뷰가 아니라 CI가 강제한다). 의존성 0(node `zlib.gzipSync`).
- 파일명이 고정이므로 캐시 무효화 전략이 필요하다 → 배포 시 `Cache-Control: max-age=300, must-revalidate` 권고 + 로더가 빌드 버전을 `console.info`로 1회 남긴다. 실제 배포 헤더 설정은 `docs/05-ops/자동배포.md` 인계 사항.
- **`EmbedCodeService`는 수정하지 않는다**(FR-W-2). 위젯이 기존 스니펫 계약(`data-chatbot`/`data-api-base`/`data-mode`/`data-fullscreen`)을 구현하는 쪽이며, AC-4-7~4-10 기존 테스트는 그대로 통과한다.

### 9.3 스타일 격리 (FR-W-12, EX-W-2)

**결정: Shadow DOM(`attachShadow({ mode: 'open' })`).**

- **네임스페이스 접두사로는 부족하다**: 호스트 페이지의 `* { box-sizing }`, `img { max-width: 100% }`, `button { all: unset }` 같은 **요소 선택자 규칙**은 클래스 접두사로 막을 수 없다. Shadow DOM은 이를 구조적으로 차단한다.
- **`open`을 쓰는 이유**: `closed`는 스크린리더·접근성 검사 도구(axe)·디버깅 도구 호환성 문제를 만든다. NFR-A8(axe 스캔 0건)을 만족시키려면 검사 가능해야 한다. 호스트가 shadowRoot에 접근할 수 있다는 위험은, 위젯이 **호스트 페이지의 DOM/쿠키/localStorage를 읽지 않는다**는 반대 방향 보장(FR-W-13, NFR-S8)과 짝을 이룬다.
- **접근성 주의**: `aria-labelledby`/`for`/`aria-controls`는 shadow 경계를 넘지 못한다. **모든 id 참조를 shadow 내부에서 완결**시킨다(FR-W-17~21 구현 시 필수 제약).
- **폴백**: `attachShadow` 미지원 환경은 네임스페이스 클래스(`cb-widget-*`) + 루트 `all: initial` 리셋으로 degrade. 기능은 유지되고 스타일 충돌 가능성만 남는다.
- **전역 심볼 1개**: `window.__ChatBotWidget`(EX-W-3). 이미 정의돼 있으면 `console.warn` 후 **초기화를 중단**한다(EX-W-4, 스니펫 2회 삽입).

### 9.4 세션과 상태 보관 (FR-W-8, DD-18)

| 키 | 값 | 수명 |
|---|---|---|
| `sessionStorage['cb.sid.<slug>']` | `crypto.randomUUID()` | 탭 종료 시 소멸 |
| `sessionStorage['cb.state.<slug>']` | `ConversationState` JSON | 동일 |

- **호스트 페이지의 쿠키·localStorage를 사용하지 않는다**(FR-W-8, NFR-S8). 추적 목적이 아니며 재방문 복원도 범위 밖이다.
- `sessionStorage` 사용 불가(프라이빗 모드 등) → **메모리 폴백**. 대화는 계속되고 새로고침 시 초기화된다(EX-W-7).
- **매 요청 body에 `state`를 실어 보내고, 응답의 `state`로 통째로 덮어쓴다.** 부분 병합을 하지 않는다 — 서버가 봉투를 폐기했는데 클라이언트가 옛 값을 유지하면 매 턴 폐기가 반복된다.
- `stateReset === true`면 안내 문구("대화가 만료되어 새로 시작합니다")를 1회 표시한다(EX-10-5).
- `sessionId`는 **로그 집계 식별자일 뿐 인증 수단이 아니다**(ADR-0001의 `visitCount` 산정 근거). 서버는 이를 신뢰하지 않으며, 레이트리밋 키로만 추가 활용한다.

### 9.5 접근성 구현 매핑 (FR-W-17~24, NFR-A1/A8)

| 요건 | 구현 규격 |
|---|---|
| FR-W-17 레이블 | `<label for="cb-input">메시지 입력</label>`(shadow 내부 id). 플레이스홀더로 대체하지 않는다. 잔여 글자 수는 `aria-live="polite"`가 아닌 **정적 텍스트**(입력마다 읽히면 소음) |
| FR-W-18 터치 영역 | 런처·전송·버튼형 아웃풋 전부 **최소 44×44px**. 시각 크기가 작아도 패딩으로 히트 영역을 확보 |
| FR-W-19 포커스 | 패널 오픈 시 입력창으로 이동, **포커스 트랩**(Tab이 패널 밖으로 나가지 않음), `Esc` → 닫기 + **런처로 복귀**. 트랩·복귀는 `core/`의 순수 포커스 순서 계산 + `ui/`의 적용으로 분리 |
| FR-W-20 키보드 | `Enter` 전송 / `Shift+Enter` 줄바꿈. 버튼형 아웃풋은 **`<button>` 요소**를 쓴다(`div+role` 금지 — `Enter`/`Space` 동작을 브라우저가 보장) |
| FR-W-21 스크린리더 | 메시지 영역 `role="log" aria-live="polite" aria-relevant="additions"`. "응답 생성 중"은 **별도 status 영역**(`role="status"`)에 둬 메시지와 섞이지 않게 한다 |
| FR-W-22 대비 | `@chat-bot/shared-types/contrast`의 `evaluateHeaderContrast(primaryColor)` → `suggestedTextColor`로 헤더 텍스트 색 자동 전환(AC-W-14). **No.4의 구현을 그대로 재사용**(§4.4) |
| FR-W-23 스크롤 | 메시지 영역 `overflow-y:auto` + `tabindex="0"`(키보드 스크롤 가능). 복사/선택 제한 없음 |
| FR-W-24 색상 단독 금지 | 오류/대기/완료는 아이콘 + 텍스트 병기. 오류 말풍선은 `role="alert"` |
| FR-W-11 XSS | **`innerHTML` 사용 0건**. 모든 텍스트는 `textContent`. 이미지/링크 URL은 `isSafeHttpUrl()` 통과분만 렌더(EX-W-5: 실패 시 대체 텍스트) |

- **오류 상태별 분기**(FR-W-10): `NETWORK` → 오류 말풍선 + `재시도` 버튼 / `429` → "요청이 많습니다…" / `403` → 패널은 열리되 입력 비활성 + "현재 상담을 이용할 수 없습니다." / `404` → **런처를 렌더하지 않고** `console.warn`만(호스트 페이지에 깨진 UI를 남기지 않는다).
- **DOM 무의존 테스트 1차 타깃**(FR-W-16): `store.ts` reducer, `pause-schedule.ts`, `button-action.ts`, `session.ts`, `output-view`(shared-types). AC-W 18건 중 접근성/브라우저 통합을 제외한 다수를 jsdom 없이 검증할 수 있어야 한다.

---

## 10. 프런트엔드 인계 제약 (`apps/web`) — `ui-designer` 입력

> 탭 구조의 **최종 판단은 `ui-designer`** 다. 아키텍처 관점의 제약과 권고만 제시한다.

| 항목 | 아키텍트 입력 |
|---|---|
| 라우트 | API 경로와 일관되게 **`/chatbots/:chatbotId/simulator`**, **`/chatbots/:chatbotId/channels`**를 권고. 기존 4탭 라우트는 변경하지 않는다(AC-C-3) |
| 탭 과밀 | 4탭 → 6탭은 좁은 화면에서 줄바꿈이 발생한다. **대안 제시**: `skin`(스킨/임베드)과 `channels`는 "배포" 관심사로 묶일 수 있다(임베드 코드는 WEB 채널의 산출물이다 — FR-11-12가 이미 상호 바로가기를 요구). `ui-designer`가 ① 6탭 평면 ② 그룹핑(운영/설계/배포) 중 판단 |
| 재사용 | `UnsavedGuardContext`·`ConfirmDialog`·`Toast`·`MESSAGES`·`SeverityBadge`·`EmptyState`·`TabNav`·`CopyButton` 기존 컴포넌트 재사용. **신규 공통 컴포넌트 추가는 최소화** |
| 렌더러 | 콘솔 시뮬레이터와 위젯은 **`@chat-bot/shared-types/output-view`의 표시 모델 변환을 공유**하고 마크업만 각자 구현한다(DD-24). 콘솔은 React 컴포넌트, 위젯은 DOM 직접 조작 |
| 드로어 진입(FR-10-17) | 탭과 드로어가 **동일 컴포넌트**(`SimulatorPanel`)를 `mode="tab"｜"drawer"`로 재사용한다. 드로어는 `UnsavedGuardContext`를 **트리거하지 않는다**(라우트 이동이 아니므로 — AC-10-17) |
| 오버레이 직렬화 | 노드/FAQ/컨텍스트 편집 폼의 현재 상태를 그대로 `overlay`로 보낸다. **신규 항목의 임시 id는 `draft-` 접두**(FR-10-19 ②) |
| 채널 카드 | `implementation`·`enabled`·`configured`는 **API 응답값**을 렌더한다(프런트가 `CHANNEL_IMPLEMENTATION` 상수를 직접 읽지 않는다 — DD-29) |
| 비활성 토글 | `disabled`가 아니라 **`aria-disabled` + 사유 안내**(NFR-A3). `disabled`는 포커스를 받지 못해 스크린리더가 사유를 읽을 수 없다 |
| trace 패널 | `stage`/`code` → 한국어 레이블 매핑 테이블은 `apps/web/src/constants/messages.ts`에 둔다. `targetId`가 있으면 `href` 기반 링크(NFR-A5) |

---

## 11. 설정 / 환경변수

| 변수 | 위치 | 필수 | dev 예시 | 용도 |
|---|---|---|---|---|
| `PUBLIC_RATE_LIMIT_SESSION_PER_MIN` | `apps/api/.env` | — | `30` | 공개 API 세션 기준 분당 상한(NFR-S2) |
| `PUBLIC_RATE_LIMIT_IP_PER_MIN` | `apps/api/.env` | — | `120` | 공개 API IP 기준 분당 상한 |
| `TRUST_PROXY` | `apps/api/.env` | — | `false` | `true`일 때만 `X-Forwarded-For`를 신뢰(§8.6) |
| `DIALOGUE_BUNDLE_CACHE_TTL_MS` | `apps/api/.env` | — | `60000` | 번들 캐시 TTL(DD-22) |
| `VITE_PUBLIC_API_BASE_URL` | `apps/widget/.env` | ✅(전체화면 빌드) | `http://localhost:3000/api/v1` | `/c/:slug` 모드의 API 베이스. **임베드 모드는 `data-api-base`에서 주입**하므로 이 값을 쓰지 않는다 |

- 기존 5개 변수는 변경하지 않는다. `WIDGET_BASE_URL`은 이제 **실제로 위젯이 서빙되는 주소**가 된다(dev: `http://localhost:5174` = `apps/widget`의 vite dev 포트).
- 신규 4개는 전부 **선택(기본값 있음)** 이므로 `env.validation.ts`에 `z.coerce.number().default(...)` / `z.coerce.boolean().default(false)`로 추가하되 **기동 실패 조건을 늘리지 않는다**(NFR-M6). 배포형태 중립 유지.

---

## 12. seed 전략 (NFR-M5)

기존 seed(`sample-support-bot` 트랙 A / 레거시 트랙 B)를 유지한 채 다음을 추가·조정한다.

| 항목 | 내용 | 검증 대상 |
|---|---|---|
| `sample-support-bot` | `status='ACTIVE'` + WEB 채널 `enabled=true` + `config.allowedOrigins=[]`(모든 출처 허용) + `greetingMessage`·`quickReplies` 3건 | 위젯 수동 검증 / AC-P-1·AC-W-1~15 |
| 채널 0건 챗봇 1개 | 신규 `sample-empty-channel-bot`(`DRAFT`) — 채널 레코드 없음 | AC-11-1(8종 전부 `configured:false`) / 빈 상태 화면 |
| `CONFIG_ONLY` 레코드 1건 | `sample-support-bot`의 `KAKAOTALK` 채널 — `enabled=false`, `config={note:'2분기 오픈빌더 심사 예정'}` | AC-11-3/AC-11-4 / S-7 화면 |
| 동음이의어 `배` | `policy='ASK'`, 의미 2종(`과일`/`선박`)에 각각 `intentId` 연결 + 해당 의도를 조건으로 갖는 노드 2건 | **AC-E2-3~E2-5(되묻기 종결)** — 이번 Phase 최우선 회귀 시나리오 |
| `NODE` 버튼 노드 1건 | `action:'NODE'` 버튼을 가진 노드 + 대상 노드 | AC-E2-1/AC-P-13 |
| 기존 대화로그 200건 | **유지**. 공개 API가 새로 만드는 로그와 구분되도록 `sessionId` 접두(`seed-session-*`/`legacy-session-*`)를 그대로 둔다 | AC-P-6(신규 1행 추가 확인) |

> seed는 **마스킹된 값만** 넣는다. seed에 원문 PII를 넣으면 "로그에 PII가 없다"는 AC-P-8 검증이 seed 데이터 때문에 흔들린다.

---

## 13. 요구사항 ↔ 설계 추적표 (발췌)

| 요구사항 | 설계 위치 |
|---|---|
| FR-10-1~17 (실시간 테스트) | §5.2 ①, §6 `simulation`, §7.1 `resolveTurn`, §10 |
| FR-10-3/4, FR-11-26, NFR-S5 (상태 봉투) | §7.4, **ADR-0009** |
| FR-10-18~24 (오버레이) | §4.2, §7.5, §8.1(캐시 오염 금지) |
| FR-10-25~31 (비교) | §5.2 ②, §8.8, DD-32 |
| FR-11-1~13 (채널 CRUD) | §3.1, §4.3, §5.2 ③④⑤, §8.2 |
| FR-11-14~16 (공개 API) | §5.3, §8.3, **ADR-0011** §3 |
| FR-11-17~19 (어댑터) | §8.2 |
| FR-11-20~24 (로그) | §3.1, §8.3 ⑩, §8.5 |
| FR-11-23, NFR-S4 (PII) | §8.4, **ADR-0013** |
| FR-11-27, NFR-P1/P2 (캐시) | §8.1 |
| **FR-E2-1** (버튼 NODE) | **§7.2** |
| **FR-E2-2** (되묻기 종결) | **§7.3**, **ADR-0010** |
| FR-E2-3~6 (하위호환·trace) | §7.6, §7.7 |
| FR-W-1~16 (위젯) | §9.1~9.4, **ADR-0012** |
| FR-W-17~24, NFR-A1/A8 (접근성) | §9.5 |
| NFR-S2 (레이트리밋) | §8.6 |
| NFR-S3 (Origin) | §8.7, DD-30 |
| NFR-S1/S10 (공개 응답 분리·403) | §4.2, §5.1, **ADR-0011** §3 |
| NFR-M1 (순수 함수) | §6 `lib/*` 목록, §9.1 `core/` |
| NFR-M2 (팩토리 1곳) | §6 규약 ③, §8.2 |
| NFR-M4 (워크스페이스 스크립트) | §9.1 |
| DD-18~DD-32 | §2 표 + 각 절 |

---

## 14. 이 Phase에서 하지 않는 것 (아키텍처 관점 재확인)

요구사항 §9를 상속하며, **아키텍처 결정으로 명시적으로 잠그는 것**만 다시 적는다.

| 항목 | 이유 / 이관 |
|---|---|
| 외부 채널 어댑터 파일·`POST /webhooks/:channel` | **파일조차 만들지 않는다**(FR-11-18). 빈 구현체는 "구현됐다"는 착시를 만든다 |
| 채널 자격증명 스키마 필드 | 암호화·시크릿 관리 방식이 미결정(NFR-S7). 저장할 곳 없이 입력만 받는 것은 보안 부채 |
| 세션/대화 스레드 테이블, 만료 정리 배치 | DD-18 유지. No.24·No.42 착수 시 재설계(**ADR-0009** 재검토 트리거) |
| `ConversationLog` 추가 인덱스·`turnIndex`·`responseTimeMs` | 소비하는 AC가 없다(ADR-0004 기준). No.14/No.15로 이관 |
| WebSocket/SSE·스트리밍 응답 | REST 1턴 단위. No.30(생성형) 착수 시 검토 |
| `packages/pii-mask` 패키지 신설 | 소비자 1곳. 2곳이 되면 승격(§8.4) |
| `@nestjs/throttler`·Redis 등 신규 런타임 의존성 | 0건 유지(§8.6, DD-23) |
| 위젯의 아이프레임 격리·CSP 세밀 제어·SRI·다국어·대화 이력 복원 | 최소 버전 범위 밖. 스타일 격리(§9.3)까지 |
| `simulate()` 제거 | ADR-0008이 예고했으나 **이번에 하지 않는다**(§7.6). 기능 변경과 리팩터링을 섞지 않는다 |
| 위젯의 `packages/dialogue-engine` 의존 | 번들 예산 + 매칭 규칙 노출(§9.1) |
| 분산 환경의 캐시·레이트리밋 동기화 | 인터페이스 추상화까지. 실제 전환은 배포 Phase |
</content>
</invoke>
