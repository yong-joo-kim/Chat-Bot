# 검증/품질 고도화 세부 설계서 (No.19 대화검증시스템·TC테스트 / No.20 학습영향도 TEST)

> **요구사항**: `docs/requirements/validation-regression.md`(FR-V1-\*/V2-\*/V3-\*, AC-V1~V4, J-1~J-12)
> **상위 문서**: `docs/02-spec/개발명세서.md` §2.2·§3·§4·§5·§6(결정 31)
> **신규 ADR**: **ADR-0029**(검증 실행 스냅샷·판정 모델·작업 인프라) · **ADR-0030**(대량 실행의 운영 자원 격리 — 임베딩 캐시·RAG·로그 봉인)
> **갱신 ADR(각주만)**: ADR-0007(임포트 3번째 소비자) · ADR-0015(`Permission` 14 → 15) · ADR-0016(`TestCaseSet` 감사 대상) · ADR-0022(allowlist 3번째 소비자) · ADR-0027(큐의 학습 외 첫 소비자)
> **작성일**: 2026-09-23 · **GPU**: 이 그룹은 **새 모델을 적재하지 않는다**(자체 GPU 0). ml-engineer 신규 작업 없음 — §13 참고.

---

## 1. PM 확정 사항 (이 설계의 전제)

| # | 확정 내용 | 이 문서에서의 반영 |
|---|---|---|
| 1 | **엔티티 직접 판정 없음** — `expectedKind: 'NODE'` 간접 검증. `packages/dialogue-engine` **한 줄도 수정하지 않는다** | §2.3 봉인 · §5.2 판정표. 요구사항 P-2는 **기각 확정**이며 `matchedKeywordIds?` 확장은 만들지 않는다 |
| 2 | **수동 실행만** — 스케줄러·야간 자동 실행 인프라 미도입 | §6.1. 실행 트리거는 관리자 요청 핸들러 1곳뿐이다(자동 실행 코드 경로 0건) |
| 3 | **외부 RAG 옵션 허용 + 실행당 상한** — 기존 `RagHttpClient`/`RagGateService` 재사용, 새 HTTP 출구 0건 | §7 · **ADR-0030 §3**. 상한 기본 **50건/실행**(`TEST_RUN_RAG_MAX_CALLS`) |
| 4 | **`simulation:write` 신설**(14 → 15종) · 조회는 `simulation:read` | §9. 이 그룹의 18개 핸들러는 **이 2종만** 쓴다 |
| 5 | **"버전 비교" = `TestRun` 간 비교** — 자산 스냅샷 테이블 미생성(No.25 미선점) | §4.3 · **ADR-0029 §2** |
| 6 | **No.20 = M1 + M2**. M2 오버레이 소스는 `PENDING` 제안 id 배열, 서버가 합성·미리보기만 하고 **영구 저장 0바이트** | §6.4 · §6.5 |
| 7 | **`TrainingJobQueue` 재사용 + `TrainingJob`에 새 kind 추가 금지** → 신규 `TestRun` 테이블 | §4.2 · **ADR-0029 §4**(⚠ 현 구현의 제약과 해결안 — 이 설계의 핵심 변경 1건) |
| 8 | **판정 = 매칭 대상 ID 일치만**(4값). `UNRESOLVED`는 FAIL로 집계하지 않는다. 응답은 `serializeOutputsForDiff()` 해시로 변화 감지만 | §5 |
| 9 | ⚠ **임베딩 캐시 축출 위험(J-8)을 설계로 해결** — TC 실행은 운영 LRU 캐시를 공유하지 않는다 | §7.1 · **ADR-0030 §2**(의존성 그래프 봉인 — `QueryEmbeddingService`를 **주입하지 않는다**) |
| 10 | **`ConversationLogService` 미주입** — 로그·통계·미응답 큐 오염 0건 | §2.3 · §12 정적 검사 |

---

## 2. 아키텍처 배치

### 2.1 신규 모듈 `apps/api/src/validation/`

기존 4계층 규약(§2.1 개발명세서)을 그대로 따른다. **기능 이름이 아니라 도메인 이름**으로 짓는다(`simulation`·`augmentation`·`classifier` 선례).

```
apps/api/src/validation/
├── validation.module.ts
├── test-sets.controller.ts        # 세트 CRUD · 템플릿 다운로드
├── test-set.service.ts            # 세트 규칙 + AuditLog 기록 지점
├── test-set.mapper.ts
├── test-cases.controller.ts       # TC CRUD · 일괄 비활성 · 내보내기
├── test-case.service.ts
├── test-case.mapper.ts
├── import/
│   └── test-case-import.service.ts   # SheetReader·ImportStagingStore 100% 재사용(ADR-0007)
├── test-runs.controller.ts        # 실행 생성(202)·조회·취소·고정·비교·내보내기
├── test-run.service.ts            # 실행 수명주기 + TestRun 상태 소유
├── test-run.mapper.ts
├── run/
│   ├── test-run.executor.ts          # ★ 실행 루프(ConversationLogService 미주입)
│   ├── test-run-embedding.service.ts # ★ 실행 로컬 배치 임베딩(전역 LRU 캐시 우회 — J-8)
│   ├── test-run-overlay.builder.ts   # AUGMENTATION_SUGGESTIONS 합성(제안 읽기 전용)
│   ├── test-run-rag.service.ts       # RagHttpClient/RagGateService 재사용 + 실행당 상한
│   └── test-run-status.sink.ts       # 큐 상태 싱크 구현(ADR-0029 §4)
├── compare/
│   └── test-run-compare.service.ts   # M1 비교 — 저장하지 않고 조회 시점 계산
└── lib/                              # DB·Nest 무의존 순수 함수
    ├── judge-test-case.ts            # 판정 4값(§5.2)
    ├── summarize-run.ts              # 요약 집계(§5.4)
    ├── compare-runs.ts               # M1 5분류(§6.2)
    ├── parse-test-case-row.ts        # 엑셀 행 → TC 초안 + ImportRowError
    ├── env-fingerprint.ts            # 환경 지문 조립 · 차이 항목 산출(§6.3)
    └── test-case-csv.ts              # 내보내기 행 조립(escapeCsvCell 재사용)
```

### 2.2 모듈 의존 방향 (단방향)

```
validation → chatbots(ChatbotScopeService)
           → dialogue-common(DialogueBundleService)
           → embedding(EmbeddingProviderFactory · VectorCacheService)   ※ QueryEmbeddingService는 주입하지 않는다
           → answer-settings(AnswerSettingsCacheService)
           → rag(RagHttpClient · RagGateService)                        ※ RagCallLogService는 주입하지 않는다
           → training-jobs(TrainingJobQueue)                            ※ TrainingJobService는 주입하지 않는다
           → audit-logs(AuditLogService)
           → prisma(PrismaService)
```

**import 하지 않는 모듈(봉인 — 컴파일 불가로 강제):**

| 금지 대상 | 이유 |
|---|---|
| `ConversationModule` / `ConversationLogService` | 로그·통계·미응답 큐 오염 0건(FR-0-60, J-9). `SimulationService` 선례 — **규약이 아니라 의존성 그래프로** 보장한다 |
| `IntentsModule` / `KeywordsModule` / `FaqModule` / `DialogNodesModule` | 실행이 대화 자산을 바꾸는 코드가 **작성돼도 컴파일되지 않는다**(FR-0-61, ADR-0025 L1과 동일 방식) |
| **`AugmentationModule`** | ⚠ import하면 **승격 유일 지점**인 `AugmentationAcceptService`가 이 모듈의 DI 그래프에 들어온다(ADR-0025 봉인 약화). M2가 필요한 것은 **제안 문장 읽기뿐**이므로 `PrismaService`로 `AugmentationSuggestion`을 **직접 읽는다** — `ClassifierTrainingService`가 `IntentsService`를 주입하지 않고 Prisma로만 읽는 선례와 동일하다 |
| `ChannelsModule`·`LearningModule`·`StatsModule` | 관심사 무관. 역방향 참조(`learning → validation`)도 만들지 않는다 |

**TC 임포트의 이름 → ID 해석도 서비스 주입이 아니라 Prisma 읽기**다(`intent.findMany({select:{id,name,nameNormalized}})` 등 3회). 같은 이유다.

### 2.3 엔진 불가침(검증/품질 고도화)

이 그룹은 `packages/dialogue-engine`을 **한 줄도 바꾸지 않는다**(FR-0-59, NFR-VM3). `resolveTurn`·`mergeOverlay`·`buildDialogueIndex`·`judgeBand`·`normalizeText`를 **호출만** 한다. `ResolveOptions`에 필드를 추가하지 않으며, 엔진 패키지에 `testCase`·`testRun` 심볼이 **0건**임을 정적 검사가 단언한다. 요구사항 P-2(`matchedKeywordIds?` 선택 필드)는 **PM 확정으로 기각**됐으므로 예외가 존재하지 않는다.

### 2.4 `apps/api` 외 워크스페이스 영향

| 워크스페이스 | 변경 |
|---|---|
| `packages/shared-types` | **`validation.ts` 신설** + `common.ts`(ApiErrorCode 5종) · `security.ts`(Permission 15종·ROLE_PERMISSIONS) · `audit.ts`(TargetType 1종) · `bulk-import.ts`(ResourceType 1종·RowErrorCode 2종) **append** |
| `packages/dialogue-engine` | **변경 0건** |
| `apps/web` | 검증 화면 5뷰 신설 + 증강 승인 화면에 진입 액션 1개(FR-V3-3) + 시뮬레이터 안내문 → 링크 교체(FR-V3-2) |
| `apps/widget` · `apps/ml-worker` | **변경 0건**. ml-worker는 기존 `/embed` 계약을 그대로 쓴다(호출량만 늘어난다 — §7) |

---

## 3. `shared-types` 배치 (`validation.ts` 신설)

ADR-0003 §9 배치 규칙 적용 — 관심사가 명확히 다르고 기존 도메인 파일 어디에도 속하지 않는다. **`conversation.ts`에 넣지 않는다**: 그 파일은 위젯 서브패스(`/output-view`)와 같은 번들 경계를 공유하므로 검증 타입이 위젯 빌드에 딸려 들어갈 위험이 있다.

```
packages/shared-types/src/validation.ts   [신설]
  - TestCaseExpectedKind   = z.enum(['INTENT','FAQ','NODE','FALLBACK','ANY'])
  - TestCaseResultKind     = z.enum(['PASS','FAIL','NOT_JUDGED','UNRESOLVED'])
  - TestRunMode            = z.enum(['SINGLE','OVERLAY_COMPARE'])
  - TestRunStatus          = z.enum(['QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED'])
  - TestRunOverlaySource   = z.enum(['NONE','INLINE','AUGMENTATION_SUGGESTIONS'])
  - TestRunComparisonKind  = z.enum(['REGRESSED','IMPROVED','CHANGED','UNCHANGED','ONLY_IN_ONE'])
  - TestCaseSetSchema / CreateTestCaseSetSchema / UpdateTestCaseSetSchema
  - TestCaseSchema / CreateTestCaseSchema / UpdateTestCaseSchema / TestCaseListQuerySchema
  - TestRunEnvFingerprintSchema / TestRunSummarySchema / TestRunSchema / TestRunListQuerySchema
  - TestRunResultSchema / TestRunResultListQuerySchema
  - StartTestRunRequestSchema  (overlaySource + overlay? + suggestionIds? + useRag)
  - TestRunComparisonSchema / TestRunComparisonQuerySchema
  - VALIDATION_LIMITS 상수(세트 20 · TC/세트 2000 · TC/챗봇 5000 · 턴 5 · 문장 1000자 · 메모 500자)
```

`StartTestRunRequestSchema.overlay`는 **No.10과 동일한 `DialogueOverlaySchema`를 재사용**한다(AC-V3-9 — 새 DTO를 만들지 않는다). `validation.ts → conversation.ts` **단방향 import**이며 역방향은 없다.

**기존 파일 append(하위호환 확장만):**

| 파일 | 추가 |
|---|---|
| `common.ts` | `ApiErrorCode` 5종 — `TEST_RUN_IN_PROGRESS`(409) · `TEST_RUN_NOT_COMPARABLE`(400) · `TEST_SET_EMPTY`(400) · `TEST_CASE_LIMIT_EXCEEDED`(409) · `TEST_RUN_CANCELLED`(409) |
| `security.ts` | `Permission`에 **`simulation:write`**(14 → 15종), `ROLE_PERMISSIONS`의 EDITOR·ADMIN에 추가(VIEWER 제외) |
| `audit.ts` | `AuditTargetType`에 **`TestCaseSet`**, `AUDIT_TARGET_LABELS`에 `'검증 세트'` |
| `bulk-import.ts` | `ImportResourceType`에 **`TEST_CASE`**, `ImportRowErrorCode`에 **`TARGET_NOT_FOUND`·`AMBIGUOUS_TARGET`** |

---

## 4. 데이터 모델 (Prisma)

### 4.1 신규 4테이블 — 기존 테이블 컬럼 변경 0건

```prisma
model TestCaseSet {
  id             String   @id @default(uuid())
  chatbotId      String
  chatbot        Chatbot  @relation(fields: [chatbotId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  name           String
  /// normalizeText(name). 챗봇 내 유일(ADR-0006 규약 재사용).
  nameNormalized String
  description    String?
  isDefault      Boolean  @default(false)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  cases          TestCase[]
  runs           TestRun[]

  @@unique([chatbotId, nameNormalized])
  @@index([chatbotId, updatedAt])
  @@map("test_case_sets")
}

model TestCase {
  id                  String      @id @default(uuid())
  setId               String
  set                 TestCaseSet @relation(fields: [setId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  /// 조회·상한 판정용 비정규화 컬럼(세트 조인 없이 챗봇 총량을 센다).
  chatbotId           String
  seq                 Int
  /// JSON string[] 1~5턴. 2건 이상이면 멀티턴이며 **마지막 턴으로 판정**한다(FR-V1-2).
  messages            String
  /// 턴을 '\n'으로 결합한 뒤 normalizeText. 세트 내 중복 판정 키(FR-V1-7).
  messagesNormalized  String
  /// INTENT | FAQ | NODE | FALLBACK | ANY (zod TestCaseExpectedKind가 값 제약 단일 소스)
  expectedKind        String
  /// Intent/FaqEntry/DialogNode.id. ⚠ FK를 걸지 않는다 — 걸면 TC가 있는 의도를 삭제할 수 없고,
  /// 삭제는 정당한 동작이다(`AugmentationSuggestion.intentId`와 동일한 의도적 예외).
  /// 대상이 사라지면 실행 시 UNRESOLVED로 드러난다(FR-V1-26).
  expectedTargetId    String?
  /// 참고 메모. **판정에 일절 사용되지 않는다**(FR-V1-5).
  expectedAnswerNote  String?
  tags                String?
  enabled             Boolean  @default(true)
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  @@unique([setId, messagesNormalized])
  @@index([setId, seq])
  @@index([chatbotId])
  @@map("test_cases")
}

model TestRun {
  id              String      @id @default(uuid())
  chatbotId       String
  chatbot         Chatbot     @relation(fields: [chatbotId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  setId           String
  set             TestCaseSet @relation(fields: [setId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  /// SINGLE | OVERLAY_COMPARE
  mode            String   @default("SINGLE")
  /// NONE | INLINE | AUGMENTATION_SUGGESTIONS
  overlaySource   String   @default("NONE")
  /// QUEUED | RUNNING | SUCCEEDED | FAILED | CANCELLED
  status          String   @default("QUEUED")
  progress        Int      @default(0)
  totalCount      Int      @default(0)
  processedCount  Int      @default(0)
  /// JSON. { a:{pass,fail,notJudged,unresolved}, b?:{...}, regressed?, improved?, excludedSuggestions? }
  summary         String?
  /// JSON 환경 지문(§6.3) — 이것이 "무엇이 달랐나"의 1차 설명이다.
  envFingerprint  String?
  degradedMode    Boolean  @default(false)
  useRag          Boolean  @default(false)
  ragCallCount    Int      @default(0)
  /// 보존 정책(세트당 20건)에서 제외되는 고정 실행. 세트당 최대 5건.
  pinned          Boolean  @default(false)
  failureReason   String?
  startedAt       DateTime?
  finishedAt      DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  results         TestRunResult[]

  @@index([chatbotId, setId, createdAt])
  @@index([chatbotId, status])
  @@map("test_runs")
}

model TestRunResult {
  id                String   @id @default(uuid())
  runId             String
  run               TestRun  @relation(fields: [runId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  /// TestCase.id. ⚠ FK 없음 — TC가 지워져도 과거 실행 결과는 사실 기록으로 남아야 한다.
  caseId            String
  seq               Int
  /// 실행 시점 스냅샷. TC가 수정·삭제돼도 결과 화면이 성립해야 한다.
  /// ⚠ `TrainingJob.resultSummary`의 "문장 원문 미포함" 규약과 **다르다**(ADR-0029 §4 — 보존 목적이 다르다).
  questionText      String
  expectedKind      String
  expectedTargetId  String?
  /// PASS | FAIL | NOT_JUDGED | UNRESOLVED
  resultA           String
  matchedIntentIdA  String?
  matchedFaqIdA     String?
  matchedNodeIdA    String?
  /// CONFIRMED | AMBIGUOUS | FAILED | SKIPPED
  bandA             String?
  top1ScoreA        Float?
  top1KindA         String?
  top1IdA           String?
  marginToTop2A     Float?
  /// serializeOutputsForDiff()의 sha256. 판정이 아니라 **변화 감지**에만 쓴다(FR-V1-28).
  outputsHashA      String
  /// 선두 120자. 화면 미리보기 전용.
  outputsPreviewA   String?
  unsupportedCountA Int      @default(0)
  blockedByFilterA  Boolean  @default(false)
  elapsedMsA        Int      @default(0)
  /// mode=OVERLAY_COMPARE일 때만 채워진다(B 계열).
  resultB           String?
  matchedIntentIdB  String?
  matchedFaqIdB     String?
  matchedNodeIdB    String?
  bandB             String?
  top1ScoreB        Float?
  outputsHashB      String?
  outputsPreviewB   String?
  /// SAME | DIFFERENT — compareDiff() 결과(복제 0건).
  diffStatus        String?
  wouldUseRag       Boolean  @default(false)
  ragAttempted      Boolean  @default(false)
  ragLatencyMs      Int?
  ragSourceCount    Int?
  createdAt         DateTime @default(now())

  @@index([runId, resultA])
  @@index([runId, caseId])
  @@map("test_run_results")
}
```

> **명명 확정**: 요구사항 문서의 `TestRunCase`를 **`TestRunResult`로 확정**한다. 이 테이블은 `DialogNodeIntent` 같은 다대다 조인이 아니라 **실행 1회의 판정 결과 행**이며, `TestRunCase`라는 이름은 "실행에 포함된 TC 목록"으로 오독된다. PM 지시문의 표기와도 일치한다.

**Chatbot 모델**에는 역참조 필드 2개(`testCaseSets TestCaseSet[]`, `testRuns TestRun[]`)만 추가된다(Prisma 양방향 관계 요건 — **DB 컬럼 변화 0**).

### 4.2 만들지 않는 것

자산 스냅샷 테이블(No.25 선점 금지) · TC 세트 버전 이력 · **`TrainingJob`의 `TC_RUN` kind** · 비교 결과 저장 테이블(조회 시점 계산) · 새 큐 클래스 · Redis/BullMQ · `ImportBatch`(ADR-0007 유지) · `trace` 전문 저장(용량 — 단건 재현은 시뮬레이터로 넘긴다).

### 4.3 마이그레이션 영향 (기존 데이터 호환성)

| 항목 | 판정 |
|---|---|
| **기존 테이블 컬럼 변경** | **0건**. 신규 테이블 4개 CREATE만 |
| **백필** | **불필요**. 4테이블 모두 **0행에서 시작하는 것이 정상 상태**다(더미 세트·샘플 TC를 seed하지 않는다) |
| **enum 확장 4건**(`ImportResourceType`·`ImportRowErrorCode`·`AuditTargetType`·`Permission`) | 전부 **값 추가**이며 DB는 `String` 저장이라 **스키마 마이그레이션 없음**. 기존 행의 값은 전부 유효하게 유지된다 |
| **`ROLE_PERMISSIONS` 변경** | 코드 상수이며 DB에 역할·권한 테이블이 없다(ADR-0015) → **데이터 마이그레이션 0건**. 로그인 중인 EDITOR/ADMIN 세션은 `GET /auth/me` 재조회 시점부터 `simulation:write`를 갖는다 |
| **롤백** | 4테이블 **DROP만으로 완전 롤백**. 기존 기능은 이 그룹을 알지 못한다 |
| **챗봇 영구삭제** | `chatbots.service.ts`의 트랜잭션에 `testRunResult`(runId 기준 선행) → `testRun` → `testCase` → `testCaseSet` **deleteMany 4건 추가**(6 → 10 테이블). **사전 검사(409) 대상이 아니라 동반 삭제 대상**이다 — 검증 자산은 대화 자산이 아닌 파생 자산이다(ADR-0002 "하위 데이터 제거" 분류, NFR-VS8) |

---

## 5. 판정 설계 (No.19 — 정확성의 근거)

### 5.1 실행 단위

TC 1건 = **독립 세션**. 멀티턴 TC는 `state`를 TC 내부에서만 이어받고 TC 간에는 절대 잇지 않는다. 실행 전체가 **고정된 단일 `now`**(`const now = new Date()` 1회)를 쓴다 — 세션 TTL·되묻기 TTL 판정이 실행 소요 시간에 영향받지 않아야 재현성이 성립한다(FR-V1-18, S-12).

### 5.2 판정 순수 함수 `judgeTestCase()`

```
judgeTestCase(
  expected: { kind, targetId? },
  result:   { matchedIntentId?, matchedFaqId?, matchedNodeId? },
  liveIds:  { intents: Set<string>, faqs: Set<string>, nodes: Set<string> }
): 'PASS' | 'FAIL' | 'NOT_JUDGED' | 'UNRESOLVED'
```

| `expectedKind` | 판정 |
|---|---|
| `ANY` | 항상 `NOT_JUDGED`(회귀 비교 전용 — 해시·매칭 ID는 그대로 기록된다) |
| `INTENT`/`FAQ`/`NODE` | `targetId`가 `liveIds`에 **없으면 `UNRESOLVED`**, 있으면 해당 `matched*Id` 일치 여부로 `PASS`/`FAIL` |
| `FALLBACK` | 세 매칭 ID가 **모두 없음**이면 `PASS`, 아니면 `FAIL`(폴백 **노드**가 응답하면 `matchedNodeId`가 채워지므로 FAIL — 화면이 이 규칙을 명시한다, EX-V-9) |

`liveIds`는 **실행 시작 시 1회 로드한 번들**에서 만든다(TC마다 DB를 조회하지 않는다). 따라서 실행 도중 자산이 삭제돼도 그 실행은 일관되며, 삭제는 **다음 실행부터** `UNRESOLVED`로 나타난다(EX-V-3).

**`UNRESOLVED`는 `fail`에 합산하지 않는다**(FR-V1-27) — 자산 삭제는 의도된 변경이지 회귀가 아니며, FAIL로 세면 회귀 신호가 노이즈에 묻힌다.

### 5.3 응답 텍스트는 판정하지 않는다

`serializeOutputsForDiff(outputs)`(기존 `simulation/lib/compare-diff.ts`)의 **sha256만** 저장하고 선두 120자를 미리보기로 남긴다. 해시는 M1/M2의 `outputsChanged` 판정에만 쓰인다. 근거는 요구사항 J-4 그대로다 — RAG/생성형 비결정론, 미지원 아웃풋 3종(ADR-0008), 슬롯 치환.

⚠ **해시 함수 위치**: `serializeOutputsForDiff`는 `simulation` 모듈 안에 있다. `validation`이 `SimulationModule`을 import하면 불필요한 결합이 생기므로, **이 순수 함수 파일만 `packages/shared-types/src/output-diff.ts`(zod 무의존)로 이동**하거나 `apps/api/src/common/lib/`로 승격한다. **승격안을 택한다** — `apps/api/src/common/lib/output-diff.ts`로 옮기고 `simulation/lib/compare-diff.ts`는 re-export만 남긴다(`packages/pii-mask` 승격과 동일한 "소비자 2곳" 규약, 동작 변경 0건, 기존 테스트 무수정 통과).

### 5.4 요약 집계

`summarizeRun(results)` 순수 함수가 `{ pass, fail, notJudged, unresolved }`를 낸다. **합 = 실행 대상 TC 수**(AC-V2-3)이며 `enabled=false`인 TC는 분모에 들어가지 않는다. `OVERLAY_COMPARE`는 A/B 각각을 내고 `regressed`/`improved`를 함께 담는다.

---

## 6. 비교 설계 (No.20)

### 6.1 실행 모드 2종

| | `SINGLE` | `OVERLAY_COMPARE` |
|---|---|---|
| 계열 | A(저장본)만 | A(저장본) + B(저장본+오버레이) |
| 번들 | 1벌 | 2벌(`mergeOverlay` + `buildDialogueIndex` **실행당 각 1회**) |
| 질의 벡터 | 실행 로컬 맵 1벌 | **동일 맵을 A/B가 공유**(임베딩 호출 증가 0 — J-7) |
| 용도 | M1의 비교 대상 | M2 그 자체(1회 실행 안에서 완결) |

### 6.2 M1 — 실행 간 비교(저장하지 않는다)

`GET .../test-runs/compare?baseRunId=&targetRunId=&filter=`가 **조회 시점에 계산**한다(FR-V2-5 — 저장하면 낡는다). 순수 함수 `compareRuns(baseResults, targetResults)`가 `caseId` 기준으로 매칭해 5분류한다:

`REGRESSED`(PASS→FAIL) · `IMPROVED`(FAIL→PASS) · `CHANGED`(판정 동일·매칭 대상 또는 `outputsHash` 변화) · `UNCHANGED` · `ONLY_IN_ONE`(한쪽에만 존재 — **요약 델타에서 분리 표기**, FR-V2-18).

기본 정렬은 **`REGRESSED` 우선**이고 기본 필터는 `실패 + 회귀`다. 응답은 **페이지네이션 필수**(기본 50행).

**비교 가능성 사전 판정**: ① 같은 `setId`가 아니면 `400 TEST_RUN_NOT_COMPARABLE` ② `CANCELLED`/`FAILED` 실행은 기준선 불가(같은 코드) ③ `chatbotId` 교차는 `404`.

### 6.3 환경 지문 `envFingerprint`

```json
{ "assetCounts": { "intents": 0, "keywords": 0, "homonyms": 0, "contexts": 0, "nodes": 0, "faqs": 0 },
  "embeddingModelId": "…|null", "semanticEnabled": true,
  "thresholds": { "accept": 0.8, "low": 0.6, "margin": 0.05 },
  "degradedMode": false, "useRag": false, "overlaySource": "NONE", "engineVersion": "…" }
```

`diffFingerprint(base, target)` 순수 함수가 차이 항목을 배지로 낸다. **`embeddingModelId`가 다르면 강한 경고**(입력 공간이 달라 차이의 대부분이 회귀가 아니다), `degradedMode` 불일치도 강한 경고다(FR-V2-19, EX-V-12). 경고는 **비교를 막지 않는다**.

### 6.4 M2 — 오버레이 소스 3종

| `overlaySource` | 본문 | 처리 |
|---|---|---|
| `NONE` | — | `SINGLE` 실행 |
| `INLINE` | `overlay: DialogueOverlay` | No.10과 **동일 DTO·동일 상한**(종류별 20건, `assertOverlaySize` 재사용) |
| `AUGMENTATION_SUGGESTIONS` | `suggestionIds: string[]`(≤50) | 서버가 오버레이를 **합성** |

### 6.5 `AUGMENTATION_SUGGESTIONS` 합성 규칙 (★ 직전 그룹과의 접합부)

`TestRunOverlayBuilder`(읽기 전용):
1. `suggestionIds`로 `AugmentationSuggestion`을 **Prisma로 읽는다**(챗봇 스코프 검증 포함).
2. `status !== 'PENDING'`이거나 `modelId`가 현재와 달라 stale인 id는 **조용히 제외**하고 `summary.excludedSuggestions`에 건수를 담는다(FR-V2-12 — 요청 전체를 거부하지 않는다).
3. 남은 제안을 **`intentId`별로 묶어**, 해당 `Intent`의 현재 `examples`에 제안 문장을 **append한 오버레이 intent 항목**을 만든다(id는 실제 uuid — 기존 항목 교체).
   → 제안 50건이어도 **오버레이 항목 수 = 관련 의도 수**이므로 종류별 20건 상한 안에 들어간다.
4. **쓰기 0건**: `AugmentationSuggestion`의 `status`·`updatedAt`이 변하지 않는다(NFR-VS3, AC-V3-6). 승격 경로는 여전히 accept 핸들러 1곳뿐이다(ADR-0025 불변).

**오버레이 예문의 벡터**(FR-V2-13): 저장된 벡터가 없으므로 **실행 시작 시 1회 배치 임베딩**(`PASSAGE`)해 **실행 로컬 entries**로만 쓴다. `EmbeddingVector`에 저장하지 않는다(승인 전 자산이 색인에 들어가면 봉인이 깨진다 — FR-V2-14). 비용은 **제안 문장 수(수십 건)** 이며 TC 수와 무관하다. 임베딩 불가 시 M2는 **저하 모드로 실행하되** "증강 효과가 반영되지 않았습니다"를 결과 헤더에 명시한다(실행을 거부하지 않는다 — FR-V2-15).

---

## 7. 대량 실행 파이프라인 (★ 이 그룹의 최대 리스크 구간)

```
POST .../runs → 검증 → TestRun(QUEUED) 생성 → TrainingJobQueue.enqueue(runId, task, testRunSink) → 202 { runId }
                                                        │
  ┌─────────────────────── 비동기 실행 루프 ───────────────────────┐
  │ ① now 1회 고정 · 번들/인덱스 getCached 1회 · 설정 1회 로드      │
  │ ② mode=OVERLAY_COMPARE면 mergeOverlay + buildDialogueIndex 1회 │
  │ ③ VectorCacheService.get() 1회 → entries 사본 (+ 오버레이 벡터) │
  │ ④ 고유 정규화 질문을 batch(64)로 임베딩 → 실행 로컬 Map         │
  │    ★ QueryEmbeddingService를 거치지 않는다(전역 LRU 무오염)     │
  │ ⑤ TC 루프: assembleSemanticInput → resolveTurn → judgeBand      │
  │           → judgeTestCase → outputsHash → TestRunResult 축적    │
  │    · 20건마다 createMany + progress 갱신(최소 주기 1초)         │
  │    · 배치 경계마다 setImmediate로 이벤트 루프 양보              │
  │    · 매 TC 경계에서 취소 플래그 확인                            │
  │ ⑥ 요약 집계 → TestRun(SUCCEEDED) → 보존 정리(세트당 20 + pin 5) │
  └────────────────────────────────────────────────────────────────┘
```

### 7.1 임베딩 캐시 격리 (J-8 — 요구사항 9번, 반드시 지켜야 할 설계)

| 수단 | 내용 |
|---|---|
| **의존성 봉인** | `TestRunExecutor`·`TestRunEmbeddingService`는 **`QueryEmbeddingService`를 주입하지 않는다.** 전역 LRU에 접근할 수단이 DI 그래프에 없으므로 **오염 코드가 작성돼도 컴파일되지 않는다**(정적 검사가 단언 — §12) |
| **직접 배치 호출** | `EmbeddingProviderFactory.getProvider()` → `provider.embed(texts, 'QUERY')`. **`ClassifierPredictService.predictBatch()`가 이미 쓰는 선례**이며 새 패턴이 아니다 |
| **실행 로컬 중복 제거** | `Map<normalizedText, Float32Array>`. 같은 문장이 여러 TC에 나와도 **1회만** 임베딩. 실행 종료와 함께 GC된다(전역 상태 0) |
| **배치 크기** | `TEST_RUN_EMBED_BATCH_SIZE` 기본 **64**(색인기·provider 상한과 동일). TC 2,000건 = 최대 **32회 호출**이지 2,000회가 아니다 |
| **A/B 벡터 공유** | 같은 질문·같은 `modelId`이므로 두 계열이 **벡터 1개를 공유**한다. 비교 실행이 임베딩 호출을 2배로 늘리지 않는다(FR-V1-21) |
| **저하 전환** | 배치가 실패하면 그 실행은 **저하 모드로 계속**(규칙 매칭만, `band: SKIPPED`)하고 `degradedMode=true`를 기록한다. 실행을 실패시키지 않는다(EX-V-1, AC-V2-13) |

**점수 조립 함수의 재사용(복제 0건)**: 현재 `SemanticMatchService.score()`는 `embed → vectorCache.get → 코사인/랭킹 조립`이 한 메서드에 붙어 있다. **조립부를 `embedding/lib/assemble-semantic-input.ts` 순수 함수로 추출**하고 `score()`가 그것을 호출하도록 리팩터링한다(동작 변경 0, 기존 테스트 무수정 통과). 실행기는 **같은 순수 함수**에 실행 로컬 벡터와 (오버레이 벡터가 더해진) entries를 넘긴다 — 랭킹·타이브레이크 규칙이 두 벌이 되지 않는다(NFR-VM2).

### 7.2 동시성·취소·복구

- **챗봇당 동시 실행 1건**. 진행 중 재요청은 `409 TEST_RUN_IN_PROGRESS`(DB의 `QUEUED|RUNNING` 존재 여부로 판정 — 프로세스 로컬 플래그에 의존하지 않는다).
- **취소**: `POST .../cancel`이 `TestRun.status`를 `CANCELLED`로 CAS 갱신하고, 실행기는 **다음 TC 경계**에서 이를 읽어 중단한다(프로세스 로컬 취소 레지스트리 + DB 상태 이중). 취소된 실행은 `processedCount`를 남기며 **비교 기준선으로 선택할 수 없다**.
- **서버 재시작**: 기동 시 `QUEUED|RUNNING` 실행을 `FAILED(SERVER_RESTART)`로 정리한다(`TrainingJobService`의 고아 Job 정리와 **같은 규약·같은 시점**).
- **보존 정리**: 새 실행 **완료 직후** 그 세트의 `pinned=false` 실행을 최신 20건만 남기고 결과와 함께 삭제한다(스케줄러 없음 — 선행 그룹과 동일 판단). `pinned`는 세트당 5건 상한.

### 7.3 외부 RAG(2단계) — 옵션 허용 + 상한 (PM 결정 3)

| 규칙 | 내용 |
|---|---|
| **출구 재사용** | **`RagHttpClient`·`RagGateService`를 그대로 주입**한다. `apps/api`의 외부 HTTP 출구는 **여전히 3곳**이며 allowlist 3경로도 불변이다(ADR-0022 봉인 유지 — 두 번째 RAG 출구를 만들지 않는다) |
| **기본값** | `useRag=false`. 미지정 실행은 **외부로 나가는 HTTP 0건**(AC-V3-10) |
| **실행당 상한** | `TEST_RUN_RAG_MAX_CALLS` 기본 **50건/실행**. 초과분은 호출하지 않고 `wouldUseRag=true`로 **표시만** 한다(`ThresholdPreviewResponse.wouldUseRag` 선례) |
| **운영 대화 우선** | 실행기는 RAG를 **직렬(in-flight 1)** 로만 호출하고, `ragGate.tryAcquire()`가 실패하면 **대기하지 않고 건너뛴다**(`wouldUseRag=true`). 대량 실행이 게이트를 독점해 운영 대화의 2단계를 굶기지 않는다 |
| **판정 제외** | RAG를 실제로 호출한 TC는 **`NOT_JUDGED`**. 비결정론 응답은 회귀 판정의 기준이 될 수 없다(NFR-VM6) |
| **로그 없음** | `RagCallLog`·`ConversationLog` **미기록**(시뮬레이션과 동일 — FR-N2-3/AC-N2-25 상속) |
| **PII** | 외부 송신 직전 `maskPii()` **예외 없이** 통과(ADR-0013 적용 지점 3곳 규약 유지 — **새 지점이 아니라 기존 "RAG 송신" 지점의 재사용**이다) |
| **호출 조건** | `band === 'FAILED'` + `ragEnabled` + `ragCompany` 설정 + `isConfigured()` — 시뮬레이터와 **같은 조건식**을 쓴다 |

---

## 8. 대량 업로드 (ADR-0007 인프라 100% 재사용)

| 항목 | 규격 |
|---|---|
| 계약 | 기존 2단계(`validate` dry-run → `commit`). `importToken`은 **메모리 스테이징 TTL 10분·1회용 소비·챗봇 교차 차단**. `ImportBatch` 미생성 |
| 파서 | 기존 `SheetReader`의 **세 번째 소비자**. `.csv` 자체 구현 / `.xlsx` `exceljs` 스트리밍. **새 파서 0건** |
| 상한 | `IMPORT_LIMITS` 그대로(5MB · 5,000행). `memoryStorage()` 후 즉시 폐기 |
| 컬럼(4열) | `질문문장`(필수, 멀티턴은 `\|` 구분 ≤5) · `기대유형`(`의도`/`FAQ`/`노드`/`폴백`/`미지정`) · `기대대상명`(유형에 따라 필수) · `비고`(선택). 헤더 행 자동 판별 |
| 이름 → ID | **dry-run 단계에서 해석**. 실패는 `TARGET_NOT_FOUND`, 정규화 기준 동명이인은 `AMBIGUOUS_TARGET`(커밋하지 않는다) |
| 중복 | 세트 내 `messagesNormalized` 동일 = 중복 → 오류가 아니라 `duplicatedRows`로 집계·건너뜀 |
| 내보내기 | 세트 내보내기(업로드와 **같은 컬럼 규격**) · 오류 행 CSV · 결과 CSV · 비교 CSV. 전부 **UTF-8 BOM + `escapeCsvCell()`**(수식 인젝션 방어) |
| 템플릿 | `GET .../test-sets/template?format=csv\|xlsx` — 기존 템플릿 생성기 재사용 |

---

## 9. API 계약 (18개 핸들러 · `@Public()` 추가 0건)

| 메서드 | 경로 | 권한 | 비고 |
|---|---|---|---|
| `GET` | `/chatbots/:chatbotId/test-sets` | `simulation:read` | 목록(`{items,total,page,pageSize}`) |
| `POST` | `/chatbots/:chatbotId/test-sets` | `simulation:write` | 세트 ≤20 · 이름 정규화 유일 · **감사 CREATE** |
| `GET` | `/chatbots/:chatbotId/test-sets/template` | `simulation:read` | `format=csv\|xlsx` (⚠ `:setId`보다 **먼저 선언**) |
| `PATCH`/`DELETE` | `/chatbots/:chatbotId/test-sets/:setId` | `simulation:write` | **감사 UPDATE/DELETE**. 실행 이력과 함께 삭제 |
| `GET` | `.../test-sets/:setId/cases` | `simulation:read` | 페이지네이션 · `expectedTargetName`은 **조회 시점 해석**(FR-V1-4) |
| `POST` | `.../test-sets/:setId/cases` | `simulation:write` | 세트 2,000 / 챗봇 5,000 초과 시 `TEST_CASE_LIMIT_EXCEEDED` |
| `PATCH`/`DELETE` | `.../cases/:caseId` | `simulation:write` | 소속 세트의 UPDATE로 감사 기록 |
| `POST` | `.../cases/bulk-disable` | `simulation:write` | `UNRESOLVED` 일괄 비활성(S-4). ≤500건 |
| `POST` | `.../cases/import/validate` | `simulation:write` | multipart → `importToken` + 검증 리포트 |
| `POST` | `.../cases/import/commit` | `simulation:write` | 토큰 1회 소비. **감사 배치 1건 + 요약** |
| `GET` | `.../cases/export` | `simulation:read` | CSV(BOM) |
| `POST` | `.../test-sets/:setId/runs` | `simulation:write` | **`202 { runId, status }`**. 동시 1건 |
| `GET` | `/chatbots/:chatbotId/test-runs` | `simulation:read` | 세트 필터 · 최신순 |
| `GET` | `/chatbots/:chatbotId/test-runs/compare` | `simulation:read` | ⚠ `:runId`보다 **먼저 선언**. 조회 시점 계산 |
| `GET` | `/chatbots/:chatbotId/test-runs/:runId` | `simulation:read` | 상태·진행률·요약·환경 지문(폴링 대상) |
| `GET` | `.../test-runs/:runId/results` | `simulation:read` | 결과 행(필터·페이지네이션 기본 50) |
| `POST` | `.../test-runs/:runId/cancel` | `simulation:write` | 다음 TC 경계에서 중단 |
| `POST` | `.../test-runs/:runId/pin` | `simulation:write` | `{ pinned }` 토글. 세트당 ≤5 |
| `GET` | `.../test-runs/:runId/export` | `simulation:read` | 결과 CSV |

**권한 결정(PM 4)**: 이 그룹은 **`simulation:read`/`simulation:write` 2종만** 쓴다. TC 세트는 대화 자산이 아니라 **검증 자산**이므로 조회까지 `dialogue:read`로 섞지 않는다. 실행은 DB를 바꾸지 않지만 **ml-worker 자원을 대량 소비**하므로 쓰기 권한으로 본다. VIEWER는 `simulation:read`만 가지므로 **조회만** 가능하다(S-13/AC-V4-5).

**챗봇 스코프 규약**: 교차 챗봇 접근은 `404`. **`ARCHIVED` 챗봇은 조회 허용 / 세트·TC 쓰기와 실행은 `409 CHATBOT_ARCHIVED`**(일반 쓰기 규약. 실행은 자원을 쓰므로 조회 예외에 넣지 않는다).

**감사(ADR-0016)**: `TestCaseSet` **1종만** 추가한다. 세트 CRUD·임포트는 기록하고 **실행·취소·고정·비교는 기록하지 않는다**(읽기 연산이며 실행 1회당 감사 1건이 쌓인다 — FR-15-35·FR-L2-25와 같은 판단). 결과에 담기는 문장은 **관리자가 작성한 검증 입력**이라 NFR-S8(감사로그에 사용자 발화 유입 금지)과 무관하다.

---

## 10. 비기능 설계

### 10.1 성능
- 실행 처리량: 의미 매칭 활성 **500 TC/분** 이상, 저하 모드 **2,000 TC/분** 이상(단일 인스턴스).
- **번들·인덱스·벡터 맵은 실행당 각 1회 로드**(N+1 금지). 진행률 DB 쓰기는 **1초 또는 20건 중 늦은 쪽**.
- 실행 중 **다른 API의 P95 지연 증가 20% 미만**(배치 경계 양보 — ADR-0027과 같은 규약).
- ⚠ **실행 전후로 전역 질의 임베딩 캐시의 적중률이 떨어지지 않는다**(§7.1, AC-V4-3).
- 결과·비교 조회는 **페이지네이션 필수**. dry-run 10초 / 커밋 20초(기존 예산 그대로).
- **공개 대화 API의 성능 예산에 영향 0건**(대화 경로 신규 조회·계산 0건).

### 10.2 보안·거버넌스
`ConversationLog`·`UnansweredQuestion`·`RagCallLog` **생성 0건**(의존성 그래프) · 대화 자산 변경 0건 · `AugmentationSuggestion` 쓰기 0건 · 업로드 파일 디스크 미저장 · 내보내기 전량 `escapeCsvCell` · **TC 문장에 PII 마스킹을 적용하지 않는다**(관리자 작성 입력이며 수집된 발화가 아니다. 단 **외부 RAG 송신 직전에는 마스킹한다**) · 실행·비교 **로그에 문장 원문 미기록**(건수·소요시간·사유 분포만. API 응답·화면·CSV에는 포함된다).

### 10.3 접근성
PASS/FAIL·회귀/개선은 **아이콘 + 텍스트 라벨 병기**(색상 단독 금지) · 진행률·완료는 `aria-live="polite"` · 결과 표는 키보드만으로 행 이동·상세 펼침 · A/B는 좁은 화면에서 **세로 스택(읽기 순서 A → B)** · axe 대비 위반 0건. 새 레이아웃 규칙을 만들지 않고 FR-10-28 규칙을 그대로 쓴다.

### 10.4 유지보수성
판정·요약·비교·행 파싱·지문 비교는 **DB·Nest 무의존 순수 함수** · `compareDiff`/`serializeOutputsForDiff`/`judgeBand`/`normalizeText`/`mergeOverlay` **복제 0건** · 엔진 변경 0건 · 신규 원시 SQL 0건 · 기존 테스트 전체 무수정 통과 · **Mock 임베딩만으로 전 테스트 통과**.

---

## 11. 환경변수 (전부 선택 · 기본값 있음)

| 변수 | 기본값 | 설명 |
|---|---|---|
| `TEST_SET_MAX_CASES` | `2000` | 세트당 TC 상한 |
| `TEST_CASE_MAX_PER_CHATBOT` | `5000` | 챗봇당 총 TC 상한(`IMPORT_LIMITS.maxRows`와 정합) |
| `TEST_RUN_MAX_CASES` | `2000` | 실행 1회 TC 상한 |
| `TEST_RUN_EMBED_BATCH_SIZE` | `64` | 질문 임베딩 배치 크기(색인기·provider 상한과 동일) |
| `TEST_RUN_RAG_MAX_CALLS` | `50` | **실행당 RAG 호출 상한**(`useRag=true`일 때만) |
| `TEST_RUN_RETENTION_PER_SET` | `20` | 세트당 보존 실행 수 |
| `TEST_RUN_PINNED_MAX` | `5` | 세트당 고정 실행 수 |
| `TEST_RUN_PROGRESS_MIN_INTERVAL_MS` | `1000` | 진행률 DB 쓰기 최소 주기 |

하나도 설정하지 않아도 정상 동작한다. **신규 seed 없음** — 4테이블 0행이 정상 상태다.

---

## 12. 정적 검사 (`validation/lib/validation-sealing.spec.ts`)

`rag-allowlist.spec.ts`·`asset-write-sealing.spec.ts`와 **같은 형식**으로 저장소 텍스트를 스캔해 단언한다.

1. `apps/api/src/validation/**`에 **`ConversationLogService` 참조 0건**.
2. `validation.module.ts`의 imports에 `IntentsModule`·`KeywordsModule`·`FaqModule`·`DialogNodesModule`·`ConversationModule`·**`AugmentationModule`** 0건.
3. `apps/api/src/validation/**`에 **`QueryEmbeddingService` 참조 0건**(J-8 캐시 오염 봉인).
4. `validation/**`에 `fetch(`/`axios` 직접 호출 0건(외부 출구는 여전히 3곳).
5. `validation/**`에 `prisma.augmentationSuggestion.update|updateMany|delete|create` 0건(읽기 전용).
6. `packages/dialogue-engine/**`에 `testCase`/`testRun` 심볼 0건.
7. `@Public()` 핸들러 수 = **정확히 6개**(변동 없음).

---

## 13. 다음 단계 인계

| 에이전트 | 인계 내용 |
|---|---|
| **`ml-engineer`** | **이번 그룹은 건너뛴다.** 새 모델·새 엔드포인트·ml-worker 변경이 0건이며 기존 `/embed` 계약을 호출량만 늘려 쓴다. §7.1의 배치 크기 64는 색인기 선례를 그대로 따르므로 실측 없이 착수 가능하다. ⚠ **단 NFR(500 TC/분 · 타 API P95 +20% 미만)을 실측에서 못 지키면** 그때 배치 크기 재조정·실행 전용 워커 분리를 ml-engineer 과제로 올린다(요구사항 P-1 재검토 트리거) |
| **`ui-designer`** | 5뷰 정보 구조(최상위 탭 vs 서브내비는 위임) · **증강 승인 화면의 진입 동선(FR-V3-3 — 이 그룹의 가치가 여기서 결정된다)** · 델타 우선 요약 · `UNRESOLVED` 그룹 안내 · 저하 모드/모델 변경 경고 배지 · 업로드 2단계(기존 패턴) · 진행/취소 UX |
| **`backend-implementer`** | §2~§12 전부. ★ **최우선 3가지**: ① `ConversationLogService`·`QueryEmbeddingService` **미주입**(정적 검사로 단언) ② `TrainingJobQueue` 상태 싱크 분리(**ADR-0029 §4** — 기존 호출부 2곳 무변경) ③ `serializeOutputsForDiff` **승격 후 재사용**(복제 금지). 순서 권고: shared-types → Prisma 4테이블 → 세트/TC CRUD → 임포트 → 실행기 → 비교 |
| **`frontend-implementer`** | FR-V3-\*. 기존 대량 업로드·시뮬레이터 컴포넌트 재사용 우선. `simulation:write` 기준 버튼 가시성 |
| **`test-automation`** | AC-V1~V4. ★ **필수 3종**: AC-V2-10(로그·큐 오염 0) · **AC-V4-3(캐시 오염 0)** · AC-V2-12(결정론) |

## 14. 알려진 제한사항 (code-reviewer 2차 검증, 2026-09-23)

**M2(오버레이 비교) "회귀만 보기"는 현재 페이지 기준으로만 동작한다.** `TestRunResultListQuerySchema`에 classification/diffStatus 서버 필터 파라미터가 없어, 51번째 TC 이후의 결과는 페이지를 이동해야 확인할 수 있다(페이지네이션 + "현재 페이지 기준" 안내 문구로 완화됨, 상단 요약의 총 회귀 건수는 항상 정확함). **후속 조치 후보**: M1의 `TestRunComparisonQuerySchema.filter`(콤마 구분 분류 필터) 패턴을 참고해 `listResults`에도 서버사이드 필터를 추가하는 설계 변경을 검토할 것. 착수 전까지는 이 제한을 감수한다.

**`TestRunStatusSink.markFinished()`에서 `prisma.testRun.updateMany` 실패 시 `cancelRegistry.clear()`가 스킵될 수 있다.** DB 순간 장애 시에만 발생하는 드문 경로이며, 그 경우 해당 `runId`가 취소 레지스트리에 프로세스 재시작 전까지 남는다(무한 누적 버그의 재발은 아님 — 정상 종료 경로는 전부 정리됨). **후속 조치 후보**: `updateMany` 이후 로직을 `finally`로 감싸 정리 호출을 보장할 것.
