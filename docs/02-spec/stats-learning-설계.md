# 통계/분석 (No.14~15) — 세부 설계서

> **상위 문서**: `docs/02-spec/개발명세서.md` (§1 아키텍처, §2 모노레포/계층규약, §3 데이터모델, §4 API, §5 비기능, §6 결정사항)
> **입력 문서**: `docs/requirements/stats-learning.md` (요구사항 정의서 — FR/AC/EX/DD/J 식별자 원본, 판단 J-1~J-8)
> **선행 설계서**: `chatbot-operations-설계.md`(No.1~4) · `dialogue-design-설계.md`(No.5~9) · `quality-channel-설계.md`(No.10~11) · `security-audit-설계.md`(No.12~13) — 4계층 모듈 규약·오류 봉투·챗봇 스코프 규약·zod 단일 검증·감사 기록 규약을 **그대로 상속**한다.
> **준수 기준**: `docs/03-design/UIUX_준수기준.md`
> **관련 ADR**: `decisions/ADR-0017`·`ADR-0018`·`ADR-0019`(신규), `ADR-0001`·`ADR-0004`·`ADR-0006`·`ADR-0008`·`ADR-0013`·`ADR-0015`·`ADR-0016`(상속)
> **작성**: system-architect · 2026-09-22 · **다음 단계**: **`ui-designer`**(화면 2종 — §12) → `backend-implementer` → `frontend-implementer` → `code-reviewer` → `test-automation`
> **이번 그룹으로 1차 개발 범위(기본기능 No.1~15)가 완결된다.**

이 문서는 개발명세서를 **대체하지 않고 확장**한다. 명명 규칙(엔터티 PascalCase, 테이블 snake_case `@@map`, REST `/api/v1/`, zod 단일 소스, 4계층 모듈)은 이전 네 그룹과 동일하다.

---

## 1. 범위와 전제

| 항목 | 내용 |
|---|---|
| 대상 기능 | No.14 기본 통계(일/주/월 사용자현황·대화현황·질문순위·이용동향) · No.15 학습현황(미응답 큐 수집 → 검토 → 의도 예문 반영) |
| GPU 필요도 | **1~2 → `apps/api` 동기 처리.** `apps/ml-worker`·Job Queue·Redis·`TrainingJob` **미도입**(개발명세서 §1 설계원칙, §6-4) |
| 투입 에이전트 | **`backend-implementer` 단독**(+`ui-designer`/`frontend-implementer`). **`ml-engineer`는 투입하지 않는다**(J-1, ADR-0018) |
| `packages/dialogue-engine` | **수정 0줄.** 추천 의도는 `apps/api`의 `lib/`에 둔다(J-5). 엔진은 통계·큐·추천을 알지 못한다(ADR-0008 규약 유지) |
| `packages/llm-provider` | 사용하지 않음 |
| `apps/widget` | **수정 0줄.** 위젯은 통계·학습현황을 호출하지 않는다 |
| 기존 No.2 대시보드 | **코드·AC·화면 변경 0건**(J-4). `GET /stats/dashboard`의 요청/응답/쿼리 경로를 건드리지 않는다 |
| DB | SQLite(개발명세서 §6-4). **신규 원시 SQL 0건**(NFR-M5, AC-X-7 — 달성 방법은 §7.1) |
| 신규 런타임 의존성 | **0건.** 차트 라이브러리 도입 여부는 `ui-designer` 판단이며, 그 결정은 `apps/web`에만 영향한다(§12) |
| 이 그룹이 만드는 것 | `UnansweredQuestion` 테이블의 **최초 쓰기 주체**, 기간 시계열 통계 API 3종, 미응답 검토 큐 UI, **No.16/23으로 넘길 재학습 인계 지점 1곳**(DD-55) |
| 이 그룹이 **최초로 소비하는 것** | `matchedNodeId`·`matchedFaqId`(DD-20) · `blockedByFilter`(DD-37) · `channelType` — 적재는 되고 있었으나 읽는 화면이 없던 필드들 |

**PM 확정 전제 8건**(요구사항 §1.3): **J-1**(재학습 = 예문 반영 + 캐시 무효화까지) · **J-2**(`UnansweredQuestion` 실시간 수집) · **J-3**(`dayBucket` 컬럼 + 앱 버킷팅) · **J-4**(대시보드 불변, 계산 함수만 공유) · **J-5**(추천은 신규 순수함수, 엔진 재사용 불가) · **J-6**(감사는 `Intent`에만) · **J-7**(신규 권한 없음) · **J-8**(세션 = 1회 방문, 방문자 지표 제외). 본 설계는 이 8건을 **확정 전제**로 하며 재논의하지 않는다.

**구현 순서 권고**

```
① shared-types — stats.ts 재정비 + learning.ts 신설 + ApiErrorCode 4종 + common.ts KST 버킷 순수함수
② Prisma 마이그레이션 ①단계(컬럼 2개 + 인덱스) → ConversationLogService 버킷 쓰기 →
   백필 스크립트 실행 → 통합테스트 로그 헬퍼(§13.2)
③ stats 모듈 확장 — lib/ 순수함수 4종 → StatsPeriodService/StatsService → 엔드포인트 3종
④ learning 모듈 골격 + UnansweredCollectorService + conversation 훅(inputKind 전달)
⑤ IntentsService.applyLearningExample() 추출 — 기존 의도 AC 무회귀 확인(⑥의 선행조건)
⑥ LearningApplyService(DD-55) + resolve / ignore / reopen
⑦ bulk-resolve / bulk-ignore
⑧ lib/intent-suggest.ts(추천) + 상세(변형·발생추이)
⑨ seed 보강(NFR-M7) + 통합 테스트 스펙 신설
(⑩ GET /stats/export — P2, 이번 구현 범위 제외 · DD-66)
```

**②가 ③보다 먼저인 이유**: 통계 API는 전부 `dayBucket`을 조회 조건으로 쓴다. 백필 전에 API를 노출하면 과거 로그가 집계에서 **조용히 사라진다**(EX-14-8). 마이그레이션·쓰기·백필은 **한 덩어리**로 처리하고, 그 뒤에 읽기를 붙인다.

**⑤가 ⑥보다 먼저인 이유**: 반영은 예문 병합·상한·충돌 검사·감사 기록을 `IntentsService`에서 **재사용**해야 한다(NFR-M4). 먼저 공용 메서드를 추출해 기존 의도 CRUD가 무회귀임을 확인한 뒤, 그 위에 학습현황을 얹는다. 순서를 뒤집으면 "복제 구현을 나중에 합치는" 경로로 흘러간다.

---

## 2. 설계 결정 요약

DD 번호는 `security-audit-설계.md`의 **DD-48에 이어 DD-49**부터 부여한다. 요구사항 §5.2가 제안한 DD-49~58은 **번호를 그대로 승계**하고, 설계 단계에서 새로 확정한 결정은 DD-59부터 붙인다.

### 2.1 결정 일람

| ID | 이슈 | 결정 | 근거 |
|---|---|---|---|
| **DD-49** | `UnansweredQuestion` 필드 | **거의 전량 채택**(①~⑪). `questionNormalized` + `@@unique([chatbotId, questionNormalized])`, 상태 3종, `lastOccurredAt`, `updatedAt`, `resolvedIntentId/At/ById`(FK 없음), `recurredCount`/`recurredAfterAt`, `source`, `variants`, `channelType`, **`suggestedIntentName` 제거**, 인덱스 2종. **보강 1건** — `lastOccurredAt`에 `@default(now())`를 둔다(seed·백필에서 누락 시 정렬이 깨지는 것을 구조로 막는다) | §3.1, J-2/J-5 |
| **DD-50** | `ConversationLog.dayBucket` | **채택**(`String @default("")`, `YYYY-MM-DD`, KST, 적재 시점 확정) + `@@index([chatbotId, dayBucket])`. `$queryRaw` 날짜 함수 대안 **기각** | §3.2, **ADR-0017** |
| **DD-51** | 수집 지점 | **①안 채택 + 권고 반영** — `ConversationLogService.record()` 내부에서 **`UnansweredCollectorService`를 호출**한다. `record()`는 "무엇을 수집할지"를 알지 않고 파라미터를 넘기기만 한다 | §8.1, **ADR-0019** |
| **DD-52** | 버튼 턴 판별 | **②안 채택** — `RecordConversationLogParams.inputKind`(`TEXT`\|`BUTTON_NODE`\|`BUTTON_MESSAGE`)를 **파라미터로 전달**한다. `ConversationLog` 컬럼을 늘리지 않는다 | §8.2 |
| **DD-53** | 미응답 판정 재사용 | **채택**. 수집기는 별도 판정을 만들지 않고 `judgeAnswered()`의 결과(`isAnswered`)를 받아 쓴다 | §8.2 |
| **DD-54** | 집계 캐시 | **채택 — 두지 않는다.** 기간 상한 + 인덱스 + 5초 타임아웃으로 예산을 지키고, 타임아웃 시 오래된 값을 대신 반환하지 않는다 | §7.5 |
| **DD-55** | 재학습 확장 지점 | **`LearningApplyService.applyLearning()` 단일 메서드로 확정.** 현재 본문은 `bundleService.invalidate(chatbotId)` 1줄 + 반환값 `{ mode:'IMMEDIATE', appliedImmediately:true, jobId:null }`. No.16/23 착수 시 **이 메서드 1곳**이 Job 큐 적재로 교체된다 | §10.3, **ADR-0018** |
| **DD-56** | `AuditTargetType` | **채택 — 확장하지 않는다.** `UnansweredQuestion`을 추가하지 않고 `AUDIT_FIELDS` 화이트리스트도 손대지 않는다 | §11.2, NFR-S8 |
| **DD-57** | 모듈 경계 | **①안 채택** — `stats` 확장(읽기 전용) + **`learning` 신규**(쓰기). 의존 방향은 `learning → intents / dialogue-common / chatbots`의 **단방향**이며 역방향 참조를 만들지 않는다 | §6 |
| **DD-58** | 순위 근사 상한 | **채택**. `TOP_QUESTION_CANDIDATE_LIMIT = 500`을 인기질문·미응답 순위에 **동일 적용**하고, 상수는 `stats/lib/dashboard-aggregator.ts`에서 **export해 재사용**한다(두 벌 금지) | §7.4 |
| **DD-59** | 시간대 분포의 이식성 갭 | **`ConversationLog.hourBucket Int @default(-1)` 추가**(0~23, KST). `dayBucket`만으로는 **시간대 분포(FR-14-28)를 원시 SQL 없이 만들 수 없다** — 요구사항이 놓친 갭이다. 요일 분포는 `dayBucket` 문자열에서 **앱이 파생**하므로 컬럼이 필요 없다 | §7.1, **ADR-0017** |
| **DD-60** | 집계 쿼리 계획 | **신규 원시 SQL 0건으로 확정**(AC-X-7 충족). 세션 distinct는 `groupBy(['dayBucket','channelType','sessionId'])` **1회**로 얻고, 버킷별·채널별·기간전체 세션 수를 그 결과에서 앱이 파생한다 | §7.1 |
| **DD-61** | 세션 수의 합계 보존 | **세션 수는 합계 보존 지표가 아니다.** 주/월 버킷의 `sessionCount`는 일 버킷의 **합이 아니라 distinct 재계산**이다. AC-14A-2의 합계 보존 검증 대상은 `turnCount`·`answeredCount`·`unansweredCount`·`blockedCount` **4종으로 고정**한다 | §7.2 |
| **DD-62** | 예문 반영 경로 | **`IntentsService.applyLearningExample()` 공용 메서드를 추출**해 `learning`이 호출한다. 예문 병합·중복 제거·상한·충돌 검사·감사 기록을 복제하지 않는다(NFR-M4). 번들 무효화는 **호출부로 미룬다**(`deferBundleInvalidate`) | §10.2 |
| **DD-63** | 반영 순서와 경합 방어 | **① 예문 반영 → ② 상태 전이(조건부 `updateMany`) → ③ `applyLearning()`** 순서로 고정하고 **DB 트랜잭션으로 묶지 않는다.** 예문 추가가 dedupe로 **멱등**이라 이 순서가 두 AC(15B-9 / 15B-11)를 동시에 만족한다 | §10.4 |
| **DD-64** | 마이그레이션 방식 | **2+1단계** — ①컬럼 2개(기본값 있음) + 인덱스 추가 → ②백필 스크립트(배치·멱등·재개 가능) → ③검증 쿼리(센티넬 0건 확인). **`NOT NULL` 무기본값 전환은 하지 않는다**(NFR-M8 — 기존 테스트 2곳·seed가 기계적 수정 없이 컴파일된다) | §3.3 |
| **DD-65** | 신규 오류코드 | **5종 → 4종**. `STATS_RANGE_TOO_WIDE`·`INVALID_GRANULARITY`·`ALREADY_RESOLVED`·`BULK_SIZE_EXCEEDED`만 추가하고 **`INTENT_LIMIT_EXCEEDED`는 기각**한다 — 예문 상한은 기존 `LIMIT_EXCEEDED`가 이미 쓰이고 AC-15B-9도 그 코드를 기대한다 | §4.3 |
| **DD-66** | CSV 내보내기(FR-14-31) | **이번 Phase 구현 범위 제외.** 엔드포인트·응답 규격만 §5.1에 남기고 구현은 후속으로 넘긴다. 대응 AC가 0건이며, 마스킹 우회 경로 검토(NFR-S6)가 필요해 "덤으로 넣는" 기능이 아니다 | §15 |
| **DD-67** | 발생 추이(FR-15-13) | **`variants[]` 기반 파생**으로 구현한다 — `ConversationLog`를 `userMessage IN (variants) + dayBucket 범위`로 `groupBy`한다. 일별 발생 이력 테이블을 만들지 않으며, 변형이 5종을 넘으면 일부가 빠질 수 있으므로 응답에 **`trendApproximated`** 플래그를 실어 화면이 캡션으로 알린다 | §9.3 |

### 2.2 요구사항 내부 충돌·오기 해소 (구현자가 반드시 읽을 것)

요구사항 문서 안에서 서로 다른 답을 요구하거나 식별자가 어긋난 지점이 4건 있다. 설계에서 확정한다.

| # | 충돌/오기 | 확정 |
|---|---|---|
| **C-1** | EX-15-6은 "**보관 챗봇은 반영 허용**"이라고 하는데, FR-15-23이 재사용을 지시한 `IntentsService`는 `ChatbotScopeService.assertWritable()`을 통과해야 하고 이 함수는 `ARCHIVED`를 **409 `CHATBOT_ARCHIVED`** 로 거부한다(FR-0-11, 전 그룹 공통 규약) | **조회는 허용, 쓰기는 409로 확정한다.** ① `GET /stats/*`·`GET .../unanswered-questions*`는 `ARCHIVED` 챗봇에서도 `200`(EX-14-10, FR-2-11과 동일) ② `resolve`/`bulk-resolve`/`ignore`/`reopen`은 **`assertWritable()`을 타서 `409`**. 근거: 반영은 실제로 `Intent.examples`를 바꾸는 대화 자산 쓰기이므로 우회 경로를 만들면 "보관 챗봇은 못 고치는데 학습현황으로는 고쳐지는" 구멍이 된다. `ignore`/`reopen`만 예외로 허용하면 같은 화면의 버튼 3개가 서로 다른 규칙을 갖게 되어 사용자가 예측할 수 없다 → **`test-automation` 인계**(EX-15-6의 기대값을 409로 수정) |
| **C-2** | FR-0-36은 `INTENT_LIMIT_EXCEEDED` 신설을 요구하지만 FR-15-23·AC-15B-9는 기존 `LIMIT_EXCEEDED`를 기대한다 | **`LIMIT_EXCEEDED` 재사용**(DD-65). `INTENT_LIMIT_EXCEEDED`를 만들지 않는다 |
| **C-3** | §1.4 근거 2가 "FR-15-20(반영 후 노드 미연결 경고)", 근거 3이 "FR-15-15(일괄 반영)"를 인용하지만, §4에서 **FR-15-20 = resolve 엔드포인트 / FR-15-25 = 노드 미연결 경고 / FR-15-15 = 추천 후보 3건 / FR-15-30 = 일괄 반영**이다 | §4의 번호가 정본이다. 본 설계서의 추적표(§16)는 **FR-15-25**(노드 미연결)·**FR-15-30**(일괄)을 기준으로 한다. 요구사항 §1.4의 포인터는 오기이며 기능 내용에는 영향이 없다 |
| **C-4** | AC-14A-2는 "일별 합계 = 주별 합계"를 **버킷 전체**에 요구하지만, 세션 수는 원리적으로 합계 보존이 성립하지 않는다(한 세션이 두 날에 걸치면 일별 distinct의 합 > 주별 distinct) | **DD-61로 확정.** 합계 보존 검증은 `turnCount`/`answeredCount`/`unansweredCount`/`blockedCount` 4종에만 적용하고, `sessionCount`는 **버킷 단위 distinct 재계산**임을 응답 스키마 주석과 화면 캡션에 명시한다 |

---

## 3. 데이터 모델 변경 (개발명세서 §3 확장)

### 3.1 Prisma 스키마 변경안 (`apps/api/prisma/schema.prisma`)

변경 대상은 **기존 2개 모델**이다(신규 테이블 0건).

```prisma
model ConversationLog {
  id              String   @id @default(uuid())
  chatbotId       String
  chatbot         Chatbot  @relation(fields: [chatbotId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  channelType     String
  sessionId       String?
  userMessage     String
  botResponse     String
  matchedIntentId String?
  matchedNodeId   String?
  matchedFaqId    String?
  isAnswered      Boolean  @default(true)
  blockedByFilter Boolean  @default(false)
  /// [신규 DD-50] KST(Asia/Seoul) 기준 일 버킷 `YYYY-MM-DD`. **적재 시점에 확정**되며 조회 시점에
  /// 재계산하지 않는다(EX-14-7/EX-14-12). 문자열 사전순 비교가 날짜순과 일치하므로 기간 필터도
  /// 이 컬럼의 gte/lte로 수행한다 — DB 날짜 함수를 쓰지 않는다(ADR-0017).
  /// `""`는 **백필 미완 센티넬**이다(§3.3). 정상 경로에서는 생기지 않는다.
  dayBucket       String   @default("")
  /// [신규 DD-59] KST 기준 시각(0~23). 시간대 분포(FR-14-28) 전용이며 `-1`은 백필 미완 센티넬이다.
  hourBucket      Int      @default(-1)
  createdAt       DateTime @default(now())

  @@index([chatbotId, createdAt])
  @@index([chatbotId, dayBucket])
  @@map("conversation_logs")
}

/// [전면 보강 DD-49] 미응답 질문 검토 큐. Phase 0부터 테이블만 있었고 **쓰기 주체는 이번 Phase에 생긴다**
/// (ADR-0004의 "쓰기 주체가 생길 때 채운다" 기준 충족 시점 — ADR-0019).
/// ⚠ 저장되는 문자열은 전부 **금지어·PII 마스킹이 끝난 값**이다(ADR-0013). 마스킹 전 원문은 유입 경로가 없다.
model UnansweredQuestion {
  id                 String    @id @default(uuid())
  chatbotId          String
  chatbot            Chatbot   @relation(fields: [chatbotId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  /// 표시용 원문 — 최초 수집 1건을 보존한다(FR-15-4).
  questionText       String
  /// [신규] normalizeText(questionText). 병합 키이며 유일성 판정 기준이다(ADR-0006).
  questionNormalized String
  /// [신규] 최근 표기 변형 샘플 **최대 5건**(JSON string[]). 상세 표시 + 발생 추이 파생(DD-67).
  variants           String    @default("[]")
  occurredCount      Int       @default(1)
  /// [신규] 최근 발생 시각. 목록 기본 정렬 2순위·기간 필터의 기준이다(`createdAt`은 최초 발생).
  lastOccurredAt     DateTime  @default(now())
  /// UnansweredQuestionStatus: PENDING | RESOLVED | IGNORED (zod enum이 값 제약의 단일 소스)
  status             String    @default("PENDING")
  /// [신규] 반영/무시 이후 재발생 횟수. 상태를 자동으로 되돌리지 않는다(FR-15-5).
  recurredCount      Int       @default(0)
  recurredAfterAt    DateTime?
  /// [신규] 수집 소스. 이번 Phase는 'UNANSWERED' 1종. No.44(피드백 루프)가 'NEGATIVE_FEEDBACK'을 더한다.
  source             String    @default("UNANSWERED")
  /// [신규] 최초 수집 턴의 채널. FK는 걸지 않는다(로그성 스냅샷).
  channelType        String?
  /// [신규] 반영 결과. FK를 걸지 않는다 — 의도가 삭제돼도 "그때 이 의도로 반영했다"는 사실은 남는다
  /// (`AuditLog.actorId`·`ConversationLog.matchedIntentId`와 동일한 의도적 예외, 개발명세서 §3.1).
  resolvedIntentId   String?
  resolvedAt         DateTime?
  resolvedById       String?
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt

  @@unique([chatbotId, questionNormalized])
  @@index([chatbotId, status, occurredCount])
  @@index([chatbotId, lastOccurredAt])
  @@map("unanswered_questions")
}
```

**제거**: `suggestedIntentName`(J-5 — 추천은 조회 시점 계산이라 저장하면 즉시 낡고, 끝내 쓰기 주체가 생기지 않는다).

**인덱스 3종을 채택한 근거**(ADR-0004의 "소비하는 수용기준이 없는 구조는 만들지 않는다" 기준 통과 확인)

| 인덱스 | 직접 소비자 |
|---|---|
| `@@unique([chatbotId, questionNormalized])` | 수집 upsert의 병합 키(FR-15-3, AC-15A-2) — **없으면 기능이 성립하지 않는다** |
| `@@index([chatbotId, status, occurredCount])` | 목록 기본 조회(status 필터 + `occurredCount desc` 정렬, FR-15-10/11) |
| `@@index([chatbotId, lastOccurredAt])` | 기간 필터·`lastOccurredAt desc` 정렬(FR-15-10/11) |
| `@@index([chatbotId, dayBucket])`(ConversationLog) | 통계 3종의 모든 `where`(NFR-P2) |
| ~~`(chatbotId, hourBucket)`~~ | **만들지 않는다.** 시간대 분포는 항상 기간 필터(`dayBucket`)와 함께 오므로 위 인덱스가 선행 열을 제공한다. 쓰기 비용만 늘린다 |

### 3.2 `dayBucket`을 컬럼으로 두는 이유 (DD-50 · ADR-0017 요약)

요구사항 §4.1.2의 근거 5건을 승계하며, 설계 단계에서 확인한 사실 2건을 덧붙인다.

1. **문자열 사전순 = 날짜순**이므로 `dayBucket: { gte: '2026-08-24', lte: '2026-09-22' }` 하나로 기간 필터·그룹핑·버킷 라벨이 전부 해결된다. `createdAt` 범위 → KST 경계 환산 → 그룹 재환산의 3단 변환이 사라진다.
2. **대시보드와 값이 어긋나지 않는다.** 대시보드는 `createdAt` 범위(KST 자정 → UTC 환산)로 조회하고 신규 API는 `dayBucket` 범위로 조회하지만, `dayBucket`이 **동일한 KST 규칙으로 `createdAt`에서 파생**된 값이므로 두 필터는 같은 행 집합을 고른다(AC-14A-9). 이 동치성은 백필 완료를 전제로 하므로 **배포 순서가 정확성의 일부**다(§3.3, EX-14-8).

> **기각한 대안**: `$queryRaw` + DB 날짜 함수(`strftime` vs `date_trunc`) — SQLite/Postgres 이식성(개발명세서 §5) 위반, AC-X-7 위반. 전량 `findMany` 후 앱 버킷팅 — ADR-0004가 이미 기각. 사전 집계 테이블 — 채울 스케줄러가 없다(§15).

### 3.3 마이그레이션 영향 분석 및 절차 (DD-64)

| 변경 | 유형 | 기존 데이터 영향 |
|---|---|---|
| `ConversationLog.dayBucket` 추가(`String @default("")`) | 비파괴 `ADD COLUMN` | seed 로그 220건 + dev 로그가 `""`가 된다 → **②단계 백필 필수** |
| `ConversationLog.hourBucket` 추가(`Int @default(-1)`) | 비파괴 | 동일 |
| `conversation_logs(chatbotId, dayBucket)` 인덱스 | 비파괴 | 행 수가 적어 즉시 완료 |
| `UnansweredQuestion` 필드 9종 추가 + `suggestedIntentName` 제거 + 유니크/인덱스 3종 | **`questionNormalized`는 `NOT NULL` 무기본값** | **현재 `unanswered_questions` 행 수는 0이다** — `apps/api/src` 전체에 `unansweredQuestion.create/upsert`가 없고 seed도 만들지 않는다(읽기는 `chatbots.service.ts`의 카운트 1곳뿐). 따라서 필수 컬럼 추가·유니크 인덱스 생성이 안전하다. ⚠ **마이그레이션 전 `SELECT COUNT(*) FROM unanswered_questions` = 0 확인**, 0이 아니면 해당 행을 삭제한 뒤 진행한다(실사용 데이터가 존재할 수 없는 상태다) |

**절차**

1. `prisma migrate dev --name stats_learning_schema` — 위 변경을 **한 마이그레이션**으로 생성한다. SQLite는 컬럼 제거·유니크 추가 시 테이블 재작성을 유발하므로 생성된 SQL을 검토한다(`unanswered_questions`는 행 0건이라 실질 위험 없음).
2. **②단계 백필** — `apps/api/prisma/scripts/backfill-conversation-buckets.ts` 신설(`backfill-dialogue-normalized.ts` 선례를 따른다).
   - `id`/`createdAt`만 `select`해 **2,000행 배치**로 순회하고 배치마다 커밋한다. 중단 후 재실행해도 같은 값을 덮어쓰므로 **멱등**이며, `where: { dayBucket: '' }` 조건으로 재개하면 이미 처리한 행을 건너뛴다(NFR-P7 — 100만 행 10분 이내).
   - 버킷 계산은 API와 **같은 순수 함수**(`@chat-bot/shared-types`의 `toKstDayBucket`/`toKstHourOfDay`)를 import한다. 스크립트가 자체 날짜 로직을 갖지 않는다(FR-0-31).
3. **③단계 검증** — `SELECT COUNT(*) FROM conversation_logs WHERE dayBucket = '' OR hourBucket < 0` 이 **0**임을 확인한다. 0이 아니면 API를 노출하지 않는다(EX-14-8).
4. `pnpm --filter @chat-bot/api prisma:seed` 재실행 → §14.1의 seed 보강분(시계열·미응답 큐) 반영.
5. **롤백 경로**: 컬럼 2개 추가 + 인덱스 3개 + 빈 테이블 재구성뿐이라 역마이그레이션이 데이터 손실을 일으키지 않는다. 단 `UnansweredQuestion`에 이미 수집된 행이 있으면 역마이그레이션은 **그 행을 잃는다**(대화 로그에서 재수집되지 않는다 — 과거 턴은 다시 오지 않는다). 운영 반영 후에는 롤백보다 전진 수정을 택한다.

**`NOT NULL` 무기본값으로 전환하지 않는 이유(DD-64 트레이드오프)**

- 얻는 것: "버킷을 안 채우면 INSERT가 실패한다"는 구조적 강제.
- 잃는 것: 통합 테스트의 `prisma.conversationLog.create` 직접 호출 **2곳**(`chatbot-operations.integration.spec.ts:286, 551`)과 seed의 `createMany`가 **컴파일 에러**가 된다. NFR-M8은 "기계적 수정으로 끝나게 하라"고 요구한다.
- 대체 통제: ① 쓰기 주체가 `ConversationLogService.record()` **1곳**이고 거기서 항상 계산한다 ② `""`/`-1` **센티넬**이 조회에서 자동 제외되므로 누락이 "0으로 표시"가 아니라 "집계 대상 밖"으로 드러난다 ③ ③단계 검증 쿼리 ④ `code-reviewer` 점검 항목(§16) ⑤ 테스트용 로그 생성 헬퍼 제공(§13.2)로 **새 테스트가 센티넬을 만들지 않게** 한다.

### 3.4 영구삭제 경로에 대한 영향 (요구사항 §5.1 확인 요청 항목)

`chatbots.service.ts`의 영구삭제 사전검사는 `unansweredQuestions` 카운트를 이미 포함하고 있어(ADR-0002 Restrict 규약), **이번 Phase에 처음으로 0이 아닌 값이 나타난다.** 검토 결과 **경로 변경은 필요하지 않다.**

- 수집은 `ConversationLogService.record()` 안에서만 일어나므로 **`UnansweredQuestion`이 있는 챗봇은 반드시 `ConversationLog`도 있다**(포함관계). 그리고 `conversationLogs`는 **이미** 영구삭제를 막는 항목이다. 따라서 미응답 큐가 **단독으로 새로 삭제를 막는 경우는 발생하지 않는다** — 차단 집합이 실질적으로 변하지 않는다(AC-1-11 불변).
- 예외는 **seed가 로그 없이 큐만 만드는 경우**뿐이다. seed는 큐를 만드는 챗봇에 대화 로그도 함께 생성해 이 불변식을 유지한다(§14.1).
- 사용자에게 보이는 변화는 `409 CHATBOT_HAS_CHILDREN` 메시지의 상세 문구에 "미응답 질문 N건"이 함께 나타나는 것뿐이다(`CHILD_COUNT_LABELS`에 라벨이 이미 있다).

### 3.5 개발명세서 §3 엔터티 표 갱신

| 현재 행 | 갱신 |
|---|---|
| `ConversationLog` \| … `blockedByFilter`로 금지어 차단 턴을 추적한다 | 설명에 "**`dayBucket`(KST 일 버킷)·`hourBucket`(KST 시)은 적재 시점에 확정되는 파생 컬럼이며 No.14 시계열/시간대 집계의 근거다(ADR-0017)**" 추가 |
| (행 없음) | **`UnansweredQuestion` 행 신설** — "미응답 질문 검토 큐(정규화 병합·발생 횟수·검토 상태 3종·재발생 카운트). **No.11 대화 파이프라인이 유일한 쓰기 주체**이며 저장값은 마스킹 후 문자열이다. 물리 삭제 API가 없고 `IGNORED`로 대체한다(ADR-0019)" \| 15 |
| `TrainingJob` \| DLE 증강학습/임베딩/군집분석 Job \| 16, 18, 21 | 유지 + 각주 "**No.15(학습현황)는 이 테이블을 쓰지 않는다** — 현행 규칙 매칭에는 학습 연산이 없고 반영은 캐시 무효화로 완결된다(ADR-0018)" |

---

## 4. `packages/shared-types` 스키마 배치

배치 규칙(개발명세서 §6-9)에 따라 **통계는 기존 `stats.ts` 재정비**, **학습현황은 관심사가 분명히 다르고 스키마가 비대하므로 `learning.ts` 신설**로 나눈다. `learning.ts`는 `common.ts`에만 의존하는 **단방향**이며, `stats.ts`를 import하지 않는다.

> `UnansweredQuestionSchema`·`ResolveUnansweredQuestionSchema`를 `stats.ts`에서 `learning.ts`로 **이동**한다. 현재 소비자가 0이고 `index.ts`가 두 파일을 함께 re-export하므로 **import 경로 변경은 발생하지 않는다.**

### 4.1 `common.ts` 추가 — KST 버킷 순수 함수 (FR-0-31)

```ts
export const KST_OFFSET_MINUTES = 540;              // 대한민국은 서머타임이 없다(EX-14-12)
export function toKstDayBucket(date: Date): string;  // → 'YYYY-MM-DD'
export function toKstHourOfDay(date: Date): number;  // → 0~23
export function toKstWeekday(dayBucket: string): number; // → 0(월)~6(일). 문자열만으로 판정
```

- `normalizeText`와 같은 **횡단 관심사**이며 `apps/api`(적재·집계) · `prisma/scripts`(백필) · `prisma/seed.ts` · `apps/web`(라벨 표기) 네 소비자가 공유한다.
- ⚠ **기존 `apps/api/src/stats/lib/dashboard-period.ts`의 KST 헬퍼는 수정하지 않는다**(J-4 — 대시보드 무변경). 대신 **신규 코드는 위 함수만 사용**하고, 두 구현이 동일 규칙임을 AC-14A-9(대시보드 vs 요약 수치 일치) 계약 테스트로 고정한다. 통합 시점은 No.29(통합 통계) 착수 시로 명시한다(§15).

### 4.2 `stats.ts` 재정비

```ts
/* ── 기존 유지(변경 금지) ── */
DashboardQuerySchema, VisitCountBasis, DashboardSummarySchema      // FR-14-1

/* ── 보강 ── */
ConversationLogSchema        // matchedNodeId/matchedFaqId/blockedByFilter/dayBucket/hourBucket 추가
                             // (현재 Phase 0 초안이 실제 모델과 어긋나 있다)

/* ── 신규 ── */
StatsGranularity  = z.enum(['DAY','WEEK','MONTH'])                       // FR-14-4
ResponseSource    = z.enum(['NODE','FAQ','OTHER','FALLBACK'])            // FR-14-20
RESPONSE_SOURCE_LABELS: Record<ResponseSource, string>                   // 노드/FAQ/기타/폴백(미응답)
STATS_LIMITS = { maxRangeDays:92, maxRangeWeeks:53, maxRangeMonths:24,
                 defaultDays:30, defaultWeeks:12, defaultMonths:12,
                 topNMax:50, topNDefault:10, timezone:'Asia/Seoul' }     // FR-14-7/8/23

StatsQuerySchema        { chatbotId, from?, to?, granularity=DAY }        // FR-14-10
StatsDistributionQuerySchema { chatbotId, from?, to? }                    // 단위 없음(기간 전체 축)
StatsQuestionsQuerySchema    { chatbotId, from?, to?, topN=10 }

StatsPeriodMetaSchema   { periodStart, periodEnd, granularity, timezone:'Asia/Seoul' }   // FR-14-12
StatsBucketSchema       { key, label, start, end, turnCount, answeredCount,
                          unansweredCount, blockedCount, responseRate,
                          sessionCount /* ⚠ 버킷 단위 distinct — 합계 보존 대상 아님(DD-61) */ }
StatsSummarySchema      { ...periodMeta, totals:{ turnCount, answeredCount, unansweredCount,
                          blockedCount, responseRate, noResponseRate, sessionCount,
                          visitCountBasis, turnsPerSession }, buckets: StatsBucket[] }
StatsDistributionSchema { ...periodMeta,
                          bySource:  [{ source, count, ratio }],          // 항상 4종
                          byChannel: [{ channelType, sessionCount, ratio }],
                          byHour:    [{ hour, turnCount }],               // 항상 24개
                          byWeekday: [{ weekday, turnCount, responseRate }] } // 항상 7개
StatsQuestionsSchema    { ...periodMeta, topQuestions:[{question,count}],
                          topUnansweredQuestions:[{question,count,unansweredQuestionId?}],
                          approximated: boolean, candidateLimit: number }  // FR-14-23/25, ADR-0004
```

- `turnsPerSession`은 **서버가 계산해 소수 첫째 자리로 반환**한다. 프런트가 나눗셈을 하지 않는다(NFR-M2, FR-14-14 — 0 나눗셈 방지도 서버 책임).
- `topUnansweredQuestions[].unansweredQuestionId`는 학습현황 큐에 대응 항목이 있을 때만 채운다(FR-14-25). 없으면 화면이 링크를 렌더하지 않는다.

### 4.3 `learning.ts` 신설

```ts
UnansweredQuestionStatus = z.enum(['PENDING','RESOLVED','IGNORED'])          // DD-49
UNANSWERED_STATUS_LABELS = { PENDING:'대기', RESOLVED:'반영 완료', IGNORED:'무시됨' }
UnansweredSource         = z.enum(['UNANSWERED'])   // No.44에서 확장
LEARNING_LIMITS = { bulkMaxItems:50, maxPendingPerChatbot:5000, maxQuestionLength:200,
                    variantsMax:5, suggestionsMax:3, suggestMinScore:0.25, trendDays:14 }

UnansweredQuestionListItemSchema  { id, chatbotId, questionText, occurredCount, status,
                                    firstOccurredAt /* = createdAt */, lastOccurredAt,
                                    recurredCount, recurredAfterAt?, channelType?,
                                    resolvedIntentId?, resolvedIntentName?, resolvedAt?,
                                    suggestions: IntentSuggestion[] }
UnansweredQuestionListQuerySchema { status='PENDING'(콤마 복수), from?, to?, q?,
                                    recurredOnly=false, sort='occurredCount'|'lastOccurredAt'|'createdAt',
                                    order='desc', page=1, pageSize=20 }
UnansweredQuestionSummarySchema   { pendingCount, limitReached: boolean }     // FR-15-14, FR-15-8
UnansweredQuestionDetailSchema    { ...listItem, variants: string[],
                                    trend: [{ dayBucket, count }], trendApproximated: boolean }
IntentSuggestionSchema            { intentId, intentName, score /*0~1*/, matchedExample }

ResolveUnansweredQuestionSchema   { intentId?, intentName?, exampleText? }
                                  .refine(intentId || intentName)             // FR-15-20
ResolveResultSchema               { questionId, intentId, intentName, created: boolean,
                                    exampleCount, linkedNodeCount, conflicts: ExampleConflict[],
                                    appliedImmediately: boolean /* DD-55 반환값 그대로 */ }
BulkResolveSchema  { items: [{ id, intentId?, intentName?, exampleText? }] } .max(50)
BulkIgnoreSchema   { ids: string[] } .max(50)
BulkResultSchema   { succeeded: number, results: ResolveResult[],
                     failed: [{ id, code: ApiErrorCode, message }] }          // FR-15-31
```

- **`appliedImmediately`를 `z.literal(true)`로 고정하지 않는다.** No.16 도입 시 이 값이 `false`가 되고 화면 문구가 자동으로 바뀌는 것이 DD-55 인계 계약의 핵심이다(§10.3).
- `conflicts`는 **기존 `IntentMutationResult['meta']['conflicts']` 타입을 재사용**한다(새 스키마를 만들지 않는다 — `dialogue.ts`에서 export 중).

### 4.4 `common.ts` — `ApiErrorCode` 4종 추가 (DD-65)

```ts
// 통계/분석(No.14~15) 그룹 추가(stats-learning-설계.md §4.4)
'STATS_RANGE_TOO_WIDE',   // 400 — 단위별 기간 상한 초과(FR-14-8). message에 더 큰 단위 대안 포함
'INVALID_GRANULARITY',    // 400 — DAY|WEEK|MONTH 외 값(FR-14-4)
'ALREADY_RESOLVED',       // 409 — PENDING이 아닌 항목의 재반영(FR-15-26)
'BULK_SIZE_EXCEEDED',     // 400 — 일괄 처리 50건 초과(FR-15-30/32)
```

재사용하는 기존 코드: `INVALID_PERIOD`(from>to, EX-14-4) · `AGGREGATION_TIMEOUT`(503, EX-14-5) · `LIMIT_EXCEEDED`(예문 상한, AC-15B-9) · `NOT_FOUND`(404) · `CHATBOT_ARCHIVED`(409, C-1) · `VALIDATION_FAILED`.

---

## 5. API 설계 (개발명세서 §4 확장)

### 5.1 신규 엔드포인트 10개 (+규격만 1개)

**통계** — 전부 `chatbot:read`, 읽기 전용(FR-0-35), `ARCHIVED` 허용(EX-14-10)

| # | 메서드 · 경로 | 요청 | 응답 | 오류 |
|---|---|---|---|---|
| 1 | `GET /stats/summary` | `StatsQuerySchema` | `StatsSummarySchema` | 400(`INVALID_PERIOD`·`STATS_RANGE_TOO_WIDE`·`INVALID_GRANULARITY`) / 404 / 503 |
| 2 | `GET /stats/distribution` | `StatsDistributionQuerySchema` | `StatsDistributionSchema` | 400 / 404 / 503 |
| 3 | `GET /stats/questions` | `StatsQuestionsQuerySchema` | `StatsQuestionsSchema` | 400 / 404 / 503 |
| — | `GET /stats/export` | `StatsQuerySchema` + `format=csv` | `text/csv; charset=utf-8`, 버킷 시계열 1행/버킷, `csv-writer.ts` 재사용 | **DD-66 — 이번 Phase 미구현(규격만)** |
| — | `GET /stats/dashboard` | *(기존 · 변경 0)* | — | FR-14-1 |

**학습현황** — `/api/v1/chatbots/:chatbotId/unanswered-questions`

| # | 메서드 · 경로 | 권한 | 요청 | 응답 | 오류 |
|---|---|---|---|---|---|
| 4 | `GET` `` | `dialogue:read` | `UnansweredQuestionListQuerySchema` | `Paginated<UnansweredQuestionListItem>` | 400 / 404 |
| 5 | `GET` `/summary` | `dialogue:read` | — | `UnansweredQuestionSummarySchema` | 404 |
| 6 | `GET` `/:id` | `dialogue:read` | — | `UnansweredQuestionDetailSchema` | 404 |
| 7 | `POST` `/:id/resolve` | `dialogue:write` | `ResolveUnansweredQuestionSchema` | `ResolveResultSchema` | 400(`VALIDATION_FAILED`·`LIMIT_EXCEEDED`) / 404 / 409(`ALREADY_RESOLVED`·`CHATBOT_ARCHIVED`) |
| 8 | `POST` `/:id/ignore` | `dialogue:write` | — | `UnansweredQuestionListItemSchema` | 404 / 409 |
| 9 | `POST` `/:id/reopen` | `dialogue:write` | — | `UnansweredQuestionListItemSchema` | 404 / 409 |
| 10 | `POST` `/bulk-resolve` | `dialogue:write` | `BulkResolveSchema` | `BulkResultSchema` | 400(`BULK_SIZE_EXCEEDED`) / 404 / 409 |
| 11 | `POST` `/bulk-ignore` | `dialogue:write` | `BulkIgnoreSchema` | `BulkResultSchema` | 400 / 404 / 409 |

- **물리 삭제 경로는 존재하지 않는다**(FR-15-29, AC-15B-16). 컨트롤러에 `Delete`를 import하지 않는다 — `audit-logs.controller.ts`와 같은 규약이다.
- ⚠ **라우트 선언 순서**: `@Get('summary')`를 `@Get(':id')`보다 **먼저** 선언한다. 뒤에 두면 `:id`가 `summary`를 삼켜 `404`가 된다(`ZodParamPipe`의 uuid 검증에 걸려 `400`이 될 수도 있다).
- `@Public()`을 **부착하지 않는다**. 전역 fail-closed 가드가 보호하며 `@Public()` 핸들러 수는 **정확히 5개로 유지**된다(FR-15-38, AC-X-3/AC-C-4).
- 챗봇 스코프 검증은 **권한 통과 이후**다(NFR-S4, ADR-0015). `chatbotId`는 `ZodParamPipe`로 uuid 검증한다.

### 5.2 개발명세서 §4 표 갱신

| 현재 행 | 갱신 |
|---|---|
| 통계 \| `GET /stats/dashboard`, `/stats/usage`, `/stats/training-status` \| 2, 14, 15 | **통계** \| `GET /stats/dashboard`(No.2 · 변경 없음), **`/stats/summary`, `/stats/distribution`, `/stats/questions`**. `/stats/usage`는 `summary`+`distribution`으로 구체화되고 **`/stats/training-status`는 삭제**한다 — 조회할 "학습 상태"라는 것이 시스템에 존재하지 않는다(ADR-0018) \| 2, 14 |
| (행 없음) | **학습현황** \| **`GET/POST /chatbots/:chatbotId/unanswered-questions`**(+`/summary`, `/:id`, `/:id/resolve｜ignore｜reopen`, `/bulk-resolve｜bulk-ignore`). 조회 `dialogue:read` / 반영·무시 `dialogue:write`. **삭제 경로 없음** \| 15 |

> **정정 이력(2026-09-22)**: 통계 행의 `/stats/usage`·`/stats/training-status`를 실제 설계에 맞춰 정정하고, **학습현황 행을 신설**했다. 학습현황은 "상태 조회"가 아니라 **챗봇 스코프의 검토 큐 처리**이므로 `/stats/*`가 아니라 `/chatbots/:chatbotId/*` 중첩 경로에 둔다(`stats-learning-설계.md` §5.1·§5.2).

---

## 6. NestJS 모듈 구조 (개발명세서 §2.1·§2.2 확장)

**DD-57 — `stats`는 확장, `learning`은 신설.** 근거: `stats`는 읽기 전용(FR-0-35)이고 `learning`은 **대화 자산을 바꾸는 쓰기 모듈**이라 의존성·권한·감사 표면이 완전히 다르다. 한 모듈에 섞으면 "통계 모듈이 `IntentsService`와 `DialogueBundleService`를 주입"하는 구조가 되어 계층 규약이 흐려진다.

```
apps/api/src/stats/                          # 확장 — 읽기 전용
├── stats.module.ts                          # imports: [ChatbotsModule]  (변경: 없음)
├── stats.controller.ts                      # +3 핸들러(summary/distribution/questions)
├── stats.service.ts                         # getDashboard() 불변 + getSummary/getDistribution/getQuestions 추가
│                                            # withTimeout()·resolvePeriodOrThrow() 기존 private 재사용
└── lib/
    ├── dashboard-aggregator.ts              # 변경: TOP_QUESTION_CANDIDATE_LIMIT export만 추가(DD-58)
    ├── dashboard-period.ts                  # 변경 0줄(J-4). InvalidPeriodError만 재사용
    ├── stats-period.ts        [신규]        # 단위별 기본기간·상한 검증 → { periodStart, periodEnd,
    │                                        #   fromDayBucket, toDayBucket }. StatsRangeTooWideError
    ├── bucket.ts              [신규]        # 버킷 키·라벨 생성 / 빈 버킷 채우기 / 일→주·월 폴딩
    ├── response-source.ts     [신규]        # classifyResponseSource() — 판정 규칙 단일 소스(FR-14-20)
    └── usage-trend.ts         [신규]        # foldByHour(24) / foldByWeekday(7) / 세션 집합 폴딩

apps/api/src/learning/                       # 신규 — 쓰기 모듈
├── learning.module.ts                       # imports: [ChatbotsModule, IntentsModule, DialogueCommonModule]
│                                            # providers: UnansweredQuestionsService, LearningApplyService,
│                                            #            UnansweredCollectorService
│                                            # exports:   UnansweredCollectorService   ← conversation이 주입
├── unanswered-questions.controller.ts       # 8 핸들러(§5.1 #4~11)
├── unanswered-questions.service.ts          # 목록/상세/요약/resolve/ignore/reopen/bulk
├── unanswered-question.mapper.ts            # row ↔ DTO(JSON variants 파싱, 상태 enum 폴백)
├── unanswered-collector.service.ts          # 수집 단일 진입점(DD-51) — prisma.unansweredQuestion 쓰기는 이 파일뿐
├── learning-apply.service.ts                # ★ DD-55 인계 지점(§10.3)
└── lib/
    ├── collect-decision.ts    [신규]        # shouldCollect() — 수집 조건 5종 판정(FR-15-1, 순수)
    ├── variants.ts            [신규]        # mergeVariants() — 최대 5건 LRU 병합(순수)
    ├── intent-suggest.ts      [신규]        # suggestIntents() — 문자 bigram 자카드(순수, J-5)
    └── occurrence-trend.ts    [신규]        # foldTrend() — dayBucket 행 → 최근 N일 추이(순수)

apps/api/src/conversation/                   # 최소 침습
├── conversation-log.service.ts              # +inputKind 파라미터, +dayBucket/hourBucket 계산,
│                                            # +수집기 호출 1줄(§8.1)
└── public-conversation.service.ts           # +inputKind 산출 1줄(기존 resolveFilterableInboundText와 동일 기준)

apps/api/src/intents/
└── intents.service.ts                       # +applyLearningExample() 공용 메서드(DD-62, §10.2)

apps/api/prisma/scripts/
└── backfill-conversation-buckets.ts [신규]  # ②단계 백필(§3.3)
```

**모듈 의존 방향(순환 금지)**

```
conversation ──▶ learning(UnansweredCollectorService)      ← 신규 간선 1개
learning ──▶ intents(IntentsService) ──▶ dialogue-common ──▶ prisma
learning ──▶ dialogue-common(DialogueBundleService) / chatbots(ChatbotScopeService) / audit-logs(간접)
stats ──▶ chatbots                                          ← 기존 그대로
```

- `IntentsModule`은 현재 `IntentsService`를 **export하지 않는다** → `exports: [IntentsService]` 추가가 필요하다(유일한 기존 모듈 수정).
- `learning`은 `AuditLogService`를 **직접 주입하지 않는다.** 감사 기록은 `IntentsService` 내부에서 일어나므로(FR-15-34) 이중 기록 경로를 만들지 않는다(DD-56).
- `conversation → learning` 간선이 **역방향(learning → conversation)을 만들지 않는지** `code-reviewer`가 확인한다. 학습현황은 대화 파이프라인을 호출할 일이 없다.

---

## 7. No.14 집계 설계

### 7.1 쿼리 계획 — 신규 원시 SQL 0건 (DD-60, NFR-M5/AC-X-7)

공통 `where` = `{ chatbotId, dayBucket: { gte: fromDayBucket, lte: toDayBucket } }` → `(chatbotId, dayBucket)` 인덱스 적중(NFR-P2). **모든 조회는 Prisma `groupBy`이며 `$queryRaw`를 추가하지 않는다.**

| 엔드포인트 | 쿼리 | `by` | 예상 카디널리티(92일 상한) |
|---|---|---|---|
| `summary` | Q1 | `['dayBucket','isAnswered','blockedByFilter']` + `_count._all` | ≤ 92 × 4 = **368행** |
| `summary` | Q2 | `['dayBucket','channelType','sessionId']` + `_count._all` | (일, 채널, 세션) 조합 수 |
| `distribution` | Q3 | `['hourBucket']` + `_count._all` | ≤ **24행** |
| `distribution` | Q4 | `['dayBucket','isAnswered']` + `_count._all` | ≤ 184행 → 요일 폴딩 |
| `distribution` | Q5 | `['matchedNodeId','matchedFaqId','isAnswered']` + `_count._all` | ≈ 챗봇의 노드+FAQ 수(수십) |
| `distribution` | Q6 | `['channelType','sessionId']` + `_count._all` | 기간 내 세션 수 |
| `questions` | Q7 | `['userMessage']`, `orderBy _count desc`, `take 500` | ≤ **500행** — 대시보드와 동일 패턴 |
| `questions` | Q8 | 동일 + `where { isAnswered:false, blockedByFilter:false }` | ≤ 500행 |

**세션 distinct를 `groupBy`로 얻는 방법(핸드오프 ⑨의 답)**

`groupBy(['dayBucket','channelType','sessionId'])`의 결과 1행 = **(날짜, 채널, 세션) 유일 조합**이다. 앱에서:

- 일 버킷 `sessionCount` = 그 날짜 행 중 `sessionId !== null`의 **행 수** + `sessionId === null` 행의 `_count._all` 합계
- 주/월 버킷 = 그 구간의 **`sessionId` 집합 합집합 크기** + null 건수 합계 (**DD-61** — 합이 아니라 재계산)
- 기간 전체 `sessionCount`/`visitCountBasis` = 전 구간 합집합에 **기존 `computeVisitCount()`를 그대로 호출**해 산출 → 대시보드와 정의가 한 벌로 유지되고 AC-14A-9가 구조적으로 성립한다
- `byChannel`(Q6) = 채널별 `sessionId` 집합 크기

> **카디널리티 리스크와 탈출구(명시)**: Q2/Q6의 행 수는 최악의 경우(세션당 1턴) 기간 내 로그 수에 근접한다. 방어 수단은 ① **기간 상한**(일 92 / 주 53 / 월 24 — NFR-S9의 DoS 방어와 동일 장치) ② 행당 payload가 문자열 2개 + 정수 1개로 작다 ③ 5초 타임아웃(DD-54)이다. **재검토 트리거**: `ConversationLog` 100만 행 도달 또는 NFR-P1(P95 1초) 미달 시 — 그때는 **기존 `stats.service.ts`의 세션 카운트 원시 SQL에 `GROUP BY dayBucket`을 더해 확장**한다(파일·문법 격리 조건은 그대로, 원시 SQL 총 개수는 1건 유지). 지금 그 길을 택하지 않는 이유는 AC-X-7이 "신규 원시 SQL 0건"을 수용기준으로 고정했기 때문이다.

**`hourBucket`이 필요한 이유(DD-59)**: `byHour`(FR-14-28)는 `groupBy(['hourBucket'])` **24행**으로 끝난다. 이 컬럼이 없으면 선택지는 ①DB 시간 함수(이식성 위반) ②전량 `findMany`(NFR-P2 위반)뿐이다. 반면 **요일 분포는 `dayBucket` 문자열에서 `toKstWeekday()`로 파생**되므로 컬럼이 필요 없다 — 파생 가능한 것에는 컬럼을 만들지 않는다(ADR-0004).

### 7.2 버킷 순수 함수 계약 (FR-14-11, NFR-M1)

```ts
// stats/lib/stats-period.ts
resolveStatsPeriod(input: { from?: Date; to?: Date; granularity: StatsGranularity; now: Date })
  → { periodStart: Date; periodEnd: Date; fromDayBucket: string; toDayBucket: string }
  // FR-14-7 기본기간(일30·주12·월12) / FR-14-8 상한(92·53·24) / FR-14-10 한쪽 생략 보정 /
  // EX-14-6 미래 날짜는 오늘까지로 보정하고 보정 사실을 반환 플래그로 알린다
  // throws InvalidPeriodError(기존 재사용) | StatsRangeTooWideError(신규, message에 대안 단위 포함)

// stats/lib/bucket.ts
buildBuckets(fromDayBucket, toDayBucket, granularity) → BucketKey[]
  // DAY   : key='2026-09-22', label='09/22(화)'
  // WEEK  : key='2026-W39',  label='2026-W39(09/21~09/27)'   ← 월요일 시작, ISO-8601(FR-14-5)
  // MONTH : key='2026-09',   label='2026-09'                  ← KST 달력월(FR-14-6)
foldDayRows<T>(rows, buckets, pick) → Map<bucketKey, T[]>       // 빈 버킷도 키가 존재(FR-14-9)
dayBucketToBucketKey(dayBucket, granularity) → string           // 폴딩의 단일 규칙
```

- **주 경계는 문자열 날짜 연산으로만** 계산한다(`toKstWeekday()` + 일수 가감). `Date` 타임존 함수에 의존하지 않아 서버 TZ와 무관하게 결정적이다.
- 빈 버킷 채우기는 **합계 보존 검증(AC-14A-2)의 전제**다. 버킷 배열을 먼저 만들고 행을 부어 넣는 구조라 누락 구간이 생길 수 없다.

### 7.3 응답 출처 판정 (FR-14-20, 순수 함수 1곳)

```ts
// stats/lib/response-source.ts
classifyResponseSource(row: { matchedNodeId: string|null; matchedFaqId: string|null; isAnswered: boolean })
  → ResponseSource
// 판정 순서(고정):
//   isAnswered === false                    → 'FALLBACK'   ← 먼저 판정한다
//   matchedNodeId != null                   → 'NODE'
//   matchedFaqId  != null                   → 'FAQ'
//   그 외(응답했으나 출처 미상)             → 'OTHER'
```

- 요구사항 FR-14-20의 서술 순서(노드 → FAQ → 기타 → 폴백)와 달리 **`isAnswered=false`를 최우선**으로 둔다. 폴백 노드가 답한 턴은 `matchedNodeId`가 채워진 채 `isAnswered=false`이므로(`judgeAnswered()`가 `FALLBACK_NODE` trace로 판정), 노드를 먼저 보면 **폴백이 `NODE`로 집계돼 미응답률과 출처 분포가 어긋난다.** 결과는 항상 `bySource.FALLBACK === totals.unansweredCount`로 일치해야 한다 → `test-automation` 검증 항목.
- `OTHER`는 정상적으로 0에 가깝다. 0이 아니면 파이프라인 결손 신호이므로 화면이 조각을 숨기지 않고 표시한다.

### 7.4 질문 순위 (FR-14-23~27)

- `aggregateTopQuestions()`를 **시그니처 변경 없이 재사용**하고, 후보 상한 상수는 `dashboard-aggregator.ts`에서 export해 공유한다(DD-58).
- 미응답 순위는 `where`에 `isAnswered:false, blockedByFilter:false`만 더한다(FR-14-24 — 차단 턴은 개선 대상이 아니다, DD-37의 취지).
- 응답의 `approximated`/`candidateLimit`로 근사 사실을 **서버가 알린다**(FR-0-34, EX-14-9). 프런트가 "500"을 하드코딩하지 않는다.
- `unansweredQuestionId` 매핑(FR-14-25)은 **정규화 키 1회 조회**로 붙인다 — `questionNormalized IN (normalize(top N))`. 행마다 조회하지 않는다(N+1 금지).

### 7.5 성능·타임아웃 (NFR-P1/P8, DD-54)

- **기존 `StatsService.withTimeout()`(5초 → `503 AGGREGATION_TIMEOUT`)을 그대로 재사용**한다. 신규 3개 메서드가 각자의 `Promise.all`을 이 래퍼로 감싼다. 타임아웃 시 오래된 캐시를 반환하지 않는다(EX-14-5 판단 승계).
- 엔드포인트 3종은 **서로를 기다리지 않는다**(NFR-P8). 화면은 요약/분포/순위를 병렬 호출해 부분 렌더한다.
- 챗봇 존재 확인은 `chatbotsService.existsById()`(기존) 1회. 404 판정이 집계보다 먼저다(AC-14A-11).

---

## 8. No.15 미응답 수집 설계 (ADR-0019)

### 8.1 적재 지점 — `ConversationLogService.record()` 내부 (DD-51)

```
PublicConversationService.sendMessage()
  ⑨ 응답 반환
  ⑩ void logService.record({ ..., inputKind })            ← await 하지 않는다(기존 계약)
        ├─ ① 금지어 마스킹 → ② PII 마스킹                  (기존, ADR-0013)
        ├─ ③ dayBucket / hourBucket 계산                    ← 신규 DD-50/59
        ├─ ④ conversation_logs INSERT                       (기존)
        └─ ⑤ void collector.collect({ chatbotId, channelType, questionText: userMessage,
                                       isAnswered, blockedByFilter, inputKind })   ← 신규 DD-51
```

**규약 5건**

1. `record()`는 **수집 조건을 알지 않는다.** 마스킹이 끝난 값과 판정 결과를 넘기기만 하고, "무엇을 수집할지"는 전부 `UnansweredCollectorService`와 `lib/collect-decision.ts`에 있다.
2. 수집 호출은 **INSERT 성공 이후**다. 로그가 없는 큐 항목이 생기지 않아 §3.4의 포함관계 불변식이 유지된다.
3. `record()` 전체가 이미 try/catch이며, 수집기 **내부에도 자체 try/catch**를 둔다. 수집 실패가 로그 적재 성공을 되돌리지 않는다(FR-0-37, FR-15-6, AC-15A-8).
4. **경고 로그에 질문 본문을 넣지 않는다** — `chatbotId` + 오류코드만(NFR-S7).
5. `prisma.unansweredQuestion`의 **쓰기는 `UnansweredCollectorService` 파일 1곳**뿐이다(NFR-M3). 상태 전이(resolve/ignore/reopen)만 `UnansweredQuestionsService`가 수행하며, 이 둘의 경계는 "수집(자동) vs 검토(사람)"다 → `code-reviewer` 점검 항목.

**시뮬레이션 자동 제외**: 관리자 시뮬레이션(No.10)은 `ConversationLog`를 적재하지 않으므로(FR-10-5) 수집 경로에 **구조적으로 도달할 수 없다**(AC-15A-6). 별도 플래그를 만들지 않는다.

### 8.2 수집 조건 판정 (FR-15-1/2, DD-52/53)

```ts
// learning/lib/collect-decision.ts — 순수 함수
shouldCollect(input: { isAnswered: boolean; blockedByFilter: boolean;
                       inputKind: 'TEXT'|'BUTTON_NODE'|'BUTTON_MESSAGE';
                       questionText: string; maxLength: number })
  → { collect: true; normalized: string } | { collect: false; reason: CollectSkipReason }
// 5조건 전부 만족해야 수집(FR-15-1):
//   ① isAnswered === false              (DD-53 — judgeAnswered() 결과를 그대로 신뢰)
//   ② blockedByFilter === false         (AC-15A-3)
//   ③ inputKind !== 'BUTTON_NODE'       (AC-15A-4 — 봇이 제시한 선택지는 사용자 질문이 아니다)
//   ④ normalizeText(questionText) !== ''(AC-15A-5)
//   ⑤ normalized.length <= maxLength(기본 200)  (EX-15-3)
```

- `inputKind` 산출은 `public-conversation.service.ts`의 기존 판정 기준과 **동일 규칙**이다(`buttonAction.kind === 'NODE'` → `BUTTON_NODE`, `'MESSAGE'` → `BUTTON_MESSAGE`, 그 외 `TEXT`). `resolveFilterableInboundText()`가 이미 같은 분기를 갖고 있으므로 **판정식을 복제하지 않고 `inputKind`를 먼저 구해 두 곳이 그것을 참조**하게 정리한다.
- **트레이드오프(DD-52)**: 컬럼을 만들지 않으므로 **사후 로그 분석으로는 버튼 턴을 구분할 수 없다.** 소비자가 1곳뿐인 컬럼을 늘리지 않는다는 ADR-0004 기준에 따라 수용한다. 재검토 트리거는 No.24(실시간 모니터링)·No.29(통합 통계)가 입력 유형별 지표를 요구할 때다.

### 8.3 병합 upsert와 상한 (FR-15-3/5/8)

```ts
// UnansweredCollectorService.collect()  — 정상 경로 쿼리 1~2회(NFR-P3)
const normalized = normalizeText(questionText);
try {
  await prisma.unansweredQuestion.update({          // ① 낙관적 갱신(존재 시)
    where: { chatbotId_questionNormalized: { chatbotId, questionNormalized: normalized } },
    data: {
      occurredCount: { increment: 1 },
      lastOccurredAt: now,
      variants: mergeVariants(currentVariants, questionText, 5),   // 읽기 필요 → §주석
      ...(status !== 'PENDING' ? { recurredCount: { increment: 1 }, recurredAfterAt: now } : {}),
    },
  });
} catch (P2025 /* 없음 */) {
  if (await pendingCountAtLimit(chatbotId)) { warn(); return; }    // ② 상한(FR-15-8)
  await prisma.unansweredQuestion.create({ ... });                 // ③ 신규
}
```

- `variants` 병합과 재발생 판정에 **현재 행의 값이 필요**하므로 구현은 `findUnique` → `update`/`create` 2쿼리가 된다. 경합으로 `create`가 유니크 위반(`P2002`)을 만나면 **한 번만 재시도**해 `update` 경로로 합류한다(정상 경로 재시도 없음). 트랜잭션으로 감싸지 않는다 — 수집은 카운터 정확도보다 **대화 응답 무영향**이 우선이다(같은 턴에 ±1 오차가 생겨도 운영 판단이 바뀌지 않는다).
- **상태를 자동으로 되돌리지 않는다**(FR-15-5). `RESOLVED`/`IGNORED` 항목의 재유입은 `occurredCount`·`recurredCount`만 올리고 상태를 유지한다. 화면은 `반영 후 재발생 N회` 배지로 드러낸다(S-9, AC-15A-10) — 자동 재오픈은 무한 재검토를 만들지만, 재발생 사실은 "반영이 듣지 않았다"는 가장 중요한 신호라 숨기면 안 된다.
- **상한 검사는 신규 생성 경로에서만** 수행한다(기존 항목 카운트 증가는 계속 — AC-15A-11). `count()` 1회가 추가되지만 신규 질문에만 발생한다.
- `mergeVariants()`는 순수 함수: 중복 제거 + 최신 우선 + 최대 5건 + 각 항목 200자 상한.

---

## 9. No.15 검토 · 추천 설계

### 9.1 목록 조회 (FR-15-9~12)

- 공통 페이지네이션 규약(`{ items, total, page, pageSize }`, `toPaginated()` 재사용).
- 기본 정렬 `occurredCount desc` → 동률 `lastOccurredAt desc`(FR-15-11). Prisma `orderBy` 배열로 지정해 DB가 결정한다(앱 재정렬 금지).
- 필터: `status`(콤마 복수, 기본 `PENDING`) · `from`/`to`(**`lastOccurredAt` 기준**) · `q`(`questionText contains`) · `recurredOnly`(`recurredCount > 0`).
- `summary` 엔드포인트는 `count()` 1회 + 상한 비교만 수행한다(FR-15-14 — 탭 배지가 목록 전체를 불러오지 않게 한다).

### 9.2 추천 의도 (FR-15-15~19, J-5)

```ts
// learning/lib/intent-suggest.ts — 순수 함수, DB·Nest 무의존
suggestIntents(
  normalizedQuestion: string,
  intents: Array<{ id: string; name: string; examples: string[] }>,   // 요청당 1회 로드(공유)
  opts: { minScore: number; max: number },
) → IntentSuggestion[]
// 점수 = max( bigramJaccard(질문, 후보) )  over 후보 ∈ (예문 전체 ∪ {의도명})
// 정규화는 normalizeText() 후 문자 bigram 집합. minScore(기본 0.25) 미만은 제시하지 않는다.
```

- **의도 집합은 요청당 1회 로드해 전 행이 공유**한다(NFR-P4, N+1 금지 — `prisma.intent.findMany({ where:{chatbotId}, select:{id,name,examples} })` 1회). 20행 × 의도 N개의 유사도 계산은 CPU 순수 연산이다.
- **성능 탈출구(EX-15-9)**: `의도 수 × 예문 수`가 상한(기본 20,000 후보)을 넘으면 추천을 **생략하고** `suggestions: []` + 응답 플래그로 "추천 계산을 건너뛰었습니다"를 알린다. 목록 조회 자체가 느려지지 않게 한다.
- 엔진(`matchIntent`)을 호출하지 않는다 — 미응답 질문은 정의상 그 판정을 통과하지 못한 문장이므로 항상 `null`이다(J-5). `packages/dialogue-engine`은 **수정 0줄**.
- 화면에 "**의미가 아니라 글자 유사도 기반**이라 놓치는 경우가 있습니다"를 캡션으로 명시한다(임베딩 기반 추천은 No.18 범위).

### 9.3 상세 · 발생 추이 (FR-15-13, DD-67)

- `variants[]`(최대 5) + 추천 상위 3건 + 반영 이력(`resolvedIntentId`/`resolvedIntentName`/`resolvedAt`) + **발생 추이**.
- 발생 추이 = `conversationLog.groupBy({ by:['dayBucket'], where:{ chatbotId, userMessage: { in: variants }, dayBucket: { gte: 최근 N일 } } })`.
  - `userMessage`는 **마스킹 후 값**이고 `variants`도 같은 값이므로 **정확 일치가 성립**한다(별도 정규화 컬럼 불필요 — `ConversationLog.normalizedMessage`는 여전히 만들지 않는다, §15).
  - 변형이 5종을 넘으면 일부 표기가 빠질 수 있으므로 **`trendApproximated: true`** 를 실어 화면이 캡션으로 알린다. 추이는 **보조 정보**이며 권위 있는 수치는 `occurredCount`다.

---

## 10. No.15 반영 설계 — DD-55 확장 지점 (★ 이 그룹의 핵심)

### 10.1 반영 1건의 전체 흐름

```
POST /chatbots/:chatbotId/unanswered-questions/:id/resolve   { intentId? | intentName?, exampleText? }
  │
  ├─ 권한 dialogue:write (전역 가드)                                    NFR-S4/S5
  ├─ ChatbotScopeService.assertWritable(chatbotId)   → ARCHIVED면 409   C-1
  ├─ 항목 조회 → 없거나 다른 챗봇이면 404 / status !== PENDING이면 409  FR-15-26
  │
  ├─① IntentsService.applyLearningExample(...)        ← DD-62 (예문·감사·충돌·상한 전부 여기)
  │     ├─ intentId 주어짐        → 그 의도(404 검증)
  │     ├─ intentName 주어짐      → (chatbotId, normalizeText(name)) 조회
  │     │                            있으면 병합 / 없으면 Intent 생성(created=true)   AC-15B-6/7
  │     ├─ 예문 dedupe·상한 500 검사 → 초과 시 400 LIMIT_EXCEEDED (상태 변경 없음)    AC-15B-9
  │     ├─ 충돌 검사 conflicts[]  (저장은 허용, 경고만)                              EX-15-8
  │     ├─ AuditLog: Intent UPDATE(또는 신규 시 CREATE) 1건 + summary                FR-15-34
  │     └─ ⚠ bundleService.invalidate() 는 호출하지 않는다(deferBundleInvalidate)
  │
  ├─② UnansweredQuestion 상태 전이 — 조건부 updateMany(status:'PENDING')             AC-15B-11
  │     count === 0 → 409 ALREADY_RESOLVED
  │
  ├─③ LearningApplyService.applyLearning({ chatbotId, intentIds:[id], reason, resolvedCount:1 })
  │     ← ★ DD-55. 현재 구현 = bundleService.invalidate(chatbotId)                   FR-15-24
  │
  └─④ linkedNodeCount = dialogNodeIntent.count({ intentId })  → 0이면 화면 경고      FR-15-25
```

### 10.2 `IntentsService.applyLearningExample()` (DD-62, NFR-M4)

```ts
// apps/api/src/intents/intents.service.ts
async applyLearningExample(
  chatbotId: string,
  target: { intentId?: string; intentName?: string },
  exampleText: string,
  opts: { auditSummary: string; deferBundleInvalidate?: boolean },
): Promise<{
  intentId: string; intentName: string; created: boolean;
  exampleCount: number; linkedNodeCount: number;
  conflicts: IntentMutationResult['meta']['conflicts'];
}>
```

**구현 규약**

1. 기존 `create()`/`updateExamples()`와 **공통 코어를 공유**한다. `assertNameFree`·`dedupeExamples`/`mergeExampleMutation`·`MAX_EXAMPLES`·`computeConflicts`·`toAuditSnapshot`·`auditLogService.record`를 **그대로 재사용**하며, 예문 병합·상한·충돌 로직을 `learning` 쪽에 복제하지 않는다(NFR-M4). 필요하면 private 코어 메서드를 먼저 추출하고 세 public 메서드가 그것을 호출한다.
2. **`deferBundleInvalidate: true`면 `bundleService.invalidate()`를 호출하지 않는다.** 기본값은 `false`이므로 **기존 호출부의 동작은 바뀌지 않는다**(무회귀 — 기존 의도 AC 전량 통과가 ⑤단계의 완료 조건이다).
3. `auditSummary`는 호출부가 준다 — `"학습현황 반영 (미응답 1건)"` / `"학습현황 일괄 반영 (미응답 N건)"`(FR-15-34). **질문 문자열을 넣지 않는다**(FR-15-36, NFR-S2). 스냅샷은 기존 화이트리스트(`name`/`description`/`exampleCount`)이므로 예문 본문은 애초에 들어가지 않는다(ADR-0016).
4. 반환값에 `linkedNodeCount`를 포함한다 — `updateExamples()`가 이미 `dialogNodeIntent`를 조회하므로 **추가 쿼리가 늘지 않는다**(ADR-0005 역참조 재사용).
5. `exampleText` 미지정 시 `questionText`(마스킹된 원문)를 그대로 쓴다(FR-15-22). 길이 1~200자·trim은 기존 예문 검증 규칙을 그대로 통과시킨다(FR-15-23).

### 10.3 `LearningApplyService.applyLearning()` — ml-worker 인계 계약 (★ DD-55 / ADR-0018)

```ts
// apps/api/src/learning/learning-apply.service.ts
export type LearningApplyReason = 'UNANSWERED_RESOLVE' | 'UNANSWERED_BULK_RESOLVE';

export interface LearningApplyResult {
  /** 'IMMEDIATE' = 규칙 매칭 즉시 반영(현재) · 'QUEUED' = 학습 Job 적재(향후 No.16/23) */
  mode: 'IMMEDIATE' | 'QUEUED';
  /** 화면이 "반영 완료" vs "학습 중"을 고르는 근거. 컨트롤러가 하드코딩하지 않는다. */
  appliedImmediately: boolean;
  /** 현재는 항상 null. Job 큐 전환 시 TrainingJob.id가 담긴다. */
  jobId: string | null;
}

@Injectable()
export class LearningApplyService {
  constructor(private readonly bundleService: DialogueBundleService) {}

  /**
   * ★ 재학습 반영의 마지막 단계 — **이 시스템에서 "학습"에 해당하는 유일한 지점**이다(ADR-0018).
   * 현행 매칭은 규칙 기반이라(ADR-0008) 예문 추가 + 번들 캐시 무효화로 반영이 완결된다.
   * No.16(DLE 증강학습)·No.23(경량 분류기 재학습) 착수 시 **이 메서드 본문 1곳**이
   * `TrainingJob` 적재로 교체되고, 반환값이 { mode:'QUEUED', appliedImmediately:false, jobId }가 된다.
   * 그때 컨트롤러·서비스·프런트의 분기 코드는 수정되지 않는다 — 반환값만 바뀐다.
   */
  async applyLearning(input: {
    chatbotId: string;
    intentIds: string[];      // 향후 Job payload. 단건도 배열로 넘긴다.
    reason: LearningApplyReason;
    resolvedCount: number;
  }): Promise<LearningApplyResult> {
    this.bundleService.invalidate(input.chatbotId);     // ← 현재 구현의 전부(1줄)
    return { mode: 'IMMEDIATE', appliedImmediately: true, jobId: null };
  }
}
```

**인계 계약 6건**(No.16/No.23 담당자와 `code-reviewer`가 함께 지킨다)

| # | 계약 |
|---|---|
| K-1 | **`learning` 모듈에서 `DialogueBundleService.invalidate()`를 호출하는 곳은 이 메서드 1곳뿐이다.** `UnansweredQuestionsService`는 `bundleService`를 주입하지 않는다 |
| K-2 | **요청당 정확히 1회 호출**한다. 단건도 1회, 일괄 50건도 1회(FR-15-33, AC-15B-12) |
| K-3 | 호출 위치는 **상태 전이 성공 이후, 트랜잭션 밖**이다(ADR-0016 §4의 "커밋 후" 원칙과 동일). 캐시 무효화는 롤백할 수 없으므로 트랜잭션 안에서 부르지 않는다 |
| K-4 | 응답의 `appliedImmediately`는 **이 메서드의 반환값을 그대로 전달**한다. `true`를 하드코딩하거나 프런트가 상수로 두지 않는다 — 이것이 No.16 전환 시 화면 문구가 자동으로 바뀌는 근거다 |
| K-5 | **실패를 삼키지 않는다.** 무효화 실패(현재는 발생 경로 없음) 또는 향후 큐 적재 실패는 호출부로 전파해 `503`으로 응답한다. 반영이 안 됐는데 "반영 완료"라고 말하면 안 된다 — 로그 적재(삼킴)와 성격이 다르다 |
| K-6 | `POST /retrain` 같은 **수동 트리거 API를 만들지 않는다**(J-1 근거 5 — 내부가 no-op인 API는 관리자를 오해시킨다) |

### 10.4 반영 순서와 동시 편집 경합 (DD-63)

**순서 = ① 예문 반영 → ② 상태 전이(조건부 `updateMany`) → ③ `applyLearning()`. DB 트랜잭션으로 묶지 않는다.**

| 시나리오 | 결과 | 근거 AC |
|---|---|---|
| 예문 상한 초과(①에서 400) | 상태는 **`PENDING` 그대로**, 의도 변경 없음, 부분 반영 없음 | AC-15B-9 |
| 두 관리자가 동시 `resolve` | ①이 양쪽에서 실행되지만 `dedupeExamples`로 **예문 집합이 동일**(중복 추가 0) → ②의 `updateMany({ where:{ status:'PENDING' } })`에서 **한쪽만 count=1**, 다른 쪽 `409` | AC-15B-11 |
| ① 성공 후 ②가 실패(프로세스 종료 등) | 예문은 반영됨 + 항목은 `PENDING` 유지 → 관리자가 다시 반영하면 dedupe로 **무해한 no-op**. **대화 자산을 잃지 않는 방향**의 결손 | — |
| 이미 `RESOLVED` | ②에서 count=0 → `409 ALREADY_RESOLVED`. `reopen` 후 재시도 안내 | AC-15B-10/26 |

- **트랜잭션을 쓰지 않는 이유**: ①은 `IntentsService`(자체 `this.prisma` 사용 + 감사 기록 커밋 후 쓰기)를 통과해야 한다. 트랜잭션 클라이언트를 인자로 흘리면 `IntentsService`의 모든 메서드 시그니처가 오염되고 감사 기록이 트랜잭션 안으로 들어가 ADR-0016 §4(Postgres aborted transaction)에 정면으로 걸린다. **예문 추가가 멱등**이라는 성질이 트랜잭션 없이도 두 AC를 동시에 만족시킨다.
- ②의 상태 전이는 **`updateMany` + `where.status='PENDING'`(compare-and-set)** 으로만 수행한다. `findFirst` 후 `update`는 검사와 갱신 사이에 경합 창이 열린다 → `code-reviewer` 점검 항목.

### 10.5 `ignore` / `reopen` (FR-15-27/28/37)

- 둘 다 `dialogue:write`이며 **조건부 `updateMany`** 로 전이한다: `ignore`는 `PENDING → IGNORED`, `reopen`은 `RESOLVED|IGNORED → PENDING`. 대상 상태가 아니면 `409`.
- `reopen`은 **반영된 예문을 되돌리지 않는다**(FR-15-28). 응답에 `exampleRetained: true`를 담고 화면이 "추가된 예문은 남아 있습니다. 되돌리려면 의도 편집에서 삭제해 주세요"를 안내한다(EX-15-13) — 되돌리기가 조용히 대화 자산을 바꾸면 안 된다.
- `reopen`은 `resolvedIntentId`/`resolvedAt`을 **지우지 않는다**(이력 보존). 화면은 "이전 반영: 배송문의(2026-09-15)"로 표시할 수 있다.
- **감사 기록 없음**(DD-56, FR-15-35, AC-15B-18).

### 10.6 일괄 처리 (FR-15-30~33)

- `bulk-resolve`: 항목별로 ①→② 를 **독립 실행**하고 실패를 `failed[]`에 모은다(부분 성공, FR-15-31). 전체를 하나의 트랜잭션으로 묶지 않는다 — 1건의 상한 초과가 나머지 49건을 막아서는 안 된다.
- 성공한 `intentIds`를 모아 **`applyLearning()`을 마지막에 1회**만 호출한다(K-2, AC-15B-12).
- **추천 의도 집합·챗봇 스코프 검증은 루프 밖에서 1회**만 수행한다(NFR-P5 — 50건 P95 5초).
- 51건 이상은 컨트롤러의 zod `.max(50)`에서 `400 BULK_SIZE_EXCEEDED`(AC-15B-13).

---

## 11. 권한 · 감사 (J-6 / J-7)

### 11.1 권한 — 신규 권한 0종

| 대상 | 권한 | 비고 |
|---|:---:|---|
| `GET /stats/summary｜distribution｜questions` | `chatbot:read` | 전부 챗봇 스코프 조회. 전역/그룹 통계(No.29)가 생길 때 `stats:read` 신설을 재검토한다(security-audit 부록 A-3의 조건이 아직 성립하지 않는다) |
| `GET .../unanswered-questions*` | `dialogue:read` | VIEWER(운영 모니터)가 볼 수 있어야 역할 정의와 맞는다 |
| `POST .../resolve｜ignore｜reopen｜bulk-*` | `dialogue:write` | **동작이 바꾸는 자원 기준**. 별도 권한을 만들면 "의도 편집은 막혔는데 학습현황으로는 편집되는" 우회가 생긴다 |

`Permission` 유니온은 **14종 그대로**이며 `ROLE_PERMISSIONS`도 수정하지 않는다(ADR-0015). `@Public()` 핸들러는 **정확히 5개 유지**(AC-X-3).

### 11.2 감사 — `Intent` 1건만 기록 (DD-56)

| 동작 | 감사 기록 |
|---|---|
| `resolve`(기존 의도) | `Intent` **UPDATE** 1건, `summary = "학습현황 반영 (미응답 1건)"` |
| `resolve`(새 의도 생성) | `Intent` **CREATE** 1건, 동일 `summary` |
| `bulk-resolve` | **성공 건마다 `Intent` UPDATE/CREATE 1건**, `summary = "학습현황 일괄 반영 (미응답 N건)"`. 근거: 대상 의도가 서로 달라 `BULK_*` 요약 1건으로 묶으면 "어느 의도가 바뀌었나"를 잃는다. 상한이 50이라 볼륨도 문제되지 않는다(ADR-0016 §1의 대량 요약 규칙은 "같은 targetType의 동일 동작"을 전제한다) |
| `ignore` / `reopen` | **기록하지 않는다.** `AuditTargetType`을 확장하지 않는다 |

- 근거(J-6): ① 실제로 통제가 필요한 변경은 예문 추가이고 그 경로는 이미 감사 대상이다 ② 큐 상태는 되돌릴 수 있는 내부 작업 상태다 ③ 기록하면 `targetName`·스냅샷에 **사용자 발화가 들어가 NFR-S8("감사로그에 대화 원문·PII 금지")을 정면 위반**한다.
- **어떤 감사 레코드에도 미응답 질문 문자열이 담기지 않는다**(AC-15B-19). `summary`는 건수만, `before`/`after`는 기존 화이트리스트(`name`/`description`/`exampleCount`)뿐이다.

---

## 12. 프런트엔드 인계 제약 (`apps/web`) — `ui-designer` 입력

> **다음 단계는 `ui-designer`다.** 이 그룹은 화면이 기능의 본체다(통계는 시각화이고, 학습현황은 검토 UI 없이 성립하지 않는다). 아래는 **아키텍처가 고정하는 제약**이며, 화면 설계·정보구조 결정은 `ui-designer`가 한다.

| # | 제약 |
|---|---|
| F-1 | **지표 계산은 서버가 끝낸다.** 프런트는 비율·합계·세션당 턴수를 재계산하지 않고 응답값을 표시만 한다(NFR-M2). `responseRate + noResponseRate = 1`도 서버가 보장한다 |
| F-2 | **빈 버킷은 서버가 0으로 채워 보낸다**(FR-14-9). 프런트가 날짜를 보간하거나 구간을 추론하지 않는다 |
| F-3 | 통계 3종 API는 **독립 호출·부분 렌더**다(NFR-P8). 한 영역의 지연이 다른 영역을 막지 않으며, 각 영역이 자체 로딩/오류 상태를 갖는다 |
| F-4 | 기간/단위 변경 시 **기본 기간이 서버 규칙(일 30·주 12·월 12)으로 자동 전환**된다. 프런트가 기본값을 하드코딩하지 않고 응답의 `periodStart`/`periodEnd`를 표시한다(FR-14-12) |
| F-5 | **`sessionCount`는 버킷별 distinct 재계산 값**이라 일별 합 ≠ 주별 값이다(DD-61). 표/차트에 "세션 수는 합산되지 않습니다" 캡션이 필요하다. 또한 "세션은 대화 식별자이며 사람 수와 다를 수 있습니다"(FR-14-17), "현재 유입 채널은 1종입니다"(FR-14-15, EX-14-11), "인기질문은 상위 500 후보 기준 근사입니다"(응답 `approximated`) 3종 캡션을 서버 값에 따라 표시한다 |
| F-6 | **차트는 색상만으로 정보를 전달하지 않는다**(NFR-A1). 계열 텍스트 라벨·값 병기 + **표 보기 토글** + 차트 요약 문장(`role="img"` + `aria-label` 또는 동등 수단, NFR-A2) |
| F-7 | 권한 없는 쓰기 액션은 **렌더하지 않는다**(비활성이 아니라 숨김 — FR-C-6, F-4 상속). VIEWER에게 `반영`·`무시`·체크박스·일괄 액션 바가 보이지 않으며, 서버가 최종 판정자다(`403`) |
| F-8 | **노드 미연결 경고(`linkedNodeCount === 0`)는 토스트가 아니라 지속 표시 경고 영역**이다(FR-C-8, NFR-A8). 원인 + 해결 방법(노드 생성 링크)을 함께 안내한다 |
| F-9 | 반영 모달은 **저장 전에** "기존 의도에 추가" vs "새 의도를 만듭니다"를 구분해 표시한다(AC-UI-9). 판정 기준은 정규화 이름 일치이며 프런트가 자체 비교하지 말고 **의도 목록 조회 결과(정규화 일치)** 로 판단한다 |
| F-10 | "학습 중"이라는 표현을 쓰지 않는다. 응답 `appliedImmediately === true`면 **"반영 완료 — 다음 대화부터 적용됩니다"**(J-1, K-4). 이 문구는 `appliedImmediately` 값에 따라 분기하도록 작성한다 |
| F-11 | 일괄 처리 결과는 **실패 건의 사유를 목록으로** 보여준다(FR-C-9). "N건 성공" 토스트로 끝내지 않는다 |
| F-12 | 기존 공용 컴포넌트를 재사용한다 — `MetricCard`·`PeriodSelector`·`Modal`·`ConfirmDialog`·`Toast`·`Pagination`·`EmptyState`·`ErrorState`·`StatusBadge`·`InlineFieldError`. 문구는 `MESSAGES` 1곳(FR-C-13) |
| F-13 | `apps/widget`은 **수정하지 않는다** |
| F-14 | 응답 출처 분포의 `폴백` 조각 → 학습현황(`status=PENDING`) 링크, 미응답 순위 행 → 해당 큐 항목 링크(`unansweredQuestionId`가 있을 때만). 딥링크 파라미터 규격을 `ui-designer`가 확정한다(FR-14-21/25, AC-UI-8) |

**`ui-designer`가 결정할 항목**(아키텍처가 정하지 않음)

1. ⚠ **정보구조 — 챗봇 상세가 6탭에서 8탭이 되는 과밀 문제**(FR-C-1). 현재 `TabNav`는 **6개 라우트를 4개 시각적 그룹**(운영: 대시보드·설정 / 설계: 대화설계 / 검증: 응답테스트 / 배포: 스킨·채널)으로 묶고 있다. 선택지는 ① 그룹 안에 탭 추가(통계 → 운영, 학습현황 → 설계 또는 검증) ② 대시보드 하위 서브탭으로 통합 ③ 좌측 내비/별도 화면으로 분리다.
   - **선례 참고**: `security-audit.md` FR-13-23이 제기한 같은 과밀 이슈는 결과적으로 **챗봇 상세 탭을 늘리지 않고** 전역 `/settings/audit-logs` 화면 + `chatbotId` 필터로 해결됐다. 통계/학습현황은 감사 이력과 달리 **챗봇 스코프가 본질**(전역 통계는 No.29)이므로 같은 해법이 그대로 옳다고 단정할 수 없다 — 두 사례를 함께 놓고 판단할 것.
   - 아키텍처 제약: **API 경로는 이 결정과 무관**하다(통계 `/stats?chatbotId=`, 학습현황 `/chatbots/:chatbotId/...`). 화면 배치를 자유롭게 정해도 백엔드 변경이 없다.
2. **기본 통계 화면 레이아웃** — 요약 카드(세션·총 턴·응답률·미응답·차단) + 시계열 차트 + 분포 4종(출처/채널/시간대/요일) + 순위 2종의 배치. 시간대·요일 분포는 **버킷 시계열과 다른 축**임을 시각적으로 구분해야 한다(FR-14-30).
3. **학습현황 화면** — 목록(정렬·필터·상태 배지·재발생 배지·펼침 상세) / 반영 모달(신규·기존 구분, 예문 편집, 충돌 경고) / 일괄 선택·액션 바 / 부분 성공 결과 / 상한 도달 배너(FR-15-8).
4. **차트 구현 방식 권고**(FR-C-11) — 신규 경량 라이브러리 vs SVG 직접 구현. 판단 기준은 **번들 크기 + 접근성(`role`/`aria`) 대응 가능성**이며, 현재 `apps/web`에 차트 의존성은 없다. 도입 시 `system-architect` 확인을 거친다.
5. **빈 상태 3종**(FR-C-12) — 기간 내 대화 0건 / 미응답 0건(**"좋은 신호입니다" 긍정 표현**) / 전부 처리 완료.
6. **탭 배지**(FR-C-2) — `GET .../unanswered-questions/summary`의 `pendingCount`를 숫자+텍스트로 전달(색상 단독 금지).
7. **원본 매뉴얼 p.59~62 직접 확인** — 요구사항 §1.4는 PDF 페이지 렌더 불가로 간접 인용했다. 화면 세부 필드를 원본과 대조해 보정할 것.

---

## 13. 회귀 위험 관리

### 13.1 위험 순위

| 순위 | 위험 | 완화 |
|---|---|---|
| 1 | **백필 누락으로 과거 로그가 집계에서 사라짐** | 마이그레이션·쓰기·백필·검증을 **한 배포 단위**로 묶는다(§3.3). ③단계 검증 쿼리가 0이 아니면 API를 노출하지 않는다. AC-X-6(백필 후 대시보드 수치 불변)으로 고정 |
| 2 | **`IntentsService` 리팩터링이 기존 의도 CRUD를 깨뜨림** | ⑤단계를 독립 커밋으로 하고 기존 의도 AC 전량 통과를 완료 조건으로 삼는다. `deferBundleInvalidate` 기본값 `false`로 **기존 호출부의 동작이 바뀌지 않게** 한다 |
| 3 | **수집 호출이 대화 응답 시간을 잠식** | `record()`는 이미 `void`(fire-and-forget)이며 수집은 그 안에서 쿼리 1~2회다. AC-X-5(공개 대화 AC 전량 + 응답시간 무증가)로 측정 |
| 4 | **대시보드와 신규 통계의 수치 불일치** | 계산 함수 3종을 재사용(FR-14-2)하고 AC-14A-9를 계약 테스트로 고정. 필터 동치성 근거는 §3.2 |
| 5 | **추천 계산 N+1** | 의도 집합 요청당 1회 로드 규약 + `code-reviewer` 점검 + EX-15-9 탈출구 |
| 6 | **감사·경고 로그로 질문 원문/PII 누출** | `summary`는 건수만(§11.2), 경고 로그는 `chatbotId`+코드만(§8.1 규약 4). AC-15B-19/AC-15A-9로 검증 |

### 13.2 통합 테스트 로그 생성 헬퍼 (NFR-M8)

```
apps/api/src/integration/helpers/conversation-log.helper.ts   [신규]
  createConversationLog(prisma, { chatbotId, userMessage, isAnswered, createdAt, ... })
    → dayBucket/hourBucket을 shared-types 함수로 계산해 채운 뒤 create
```

- 기존 2곳(`chatbot-operations.integration.spec.ts:286, 551`)은 **기본값 덕분에 수정 없이 통과**하지만(AC-X-1), 통계 스펙이 새로 만드는 로그는 반드시 이 헬퍼를 쓴다. 센티넬(`""`/`-1`)을 만드는 테스트가 늘어나면 "버킷 없는 로그"가 정상처럼 보이기 시작한다.
- seed도 같은 함수로 버킷을 계산한다(§14.1).

---

## 14. 환경변수 (개발명세서 §5.1 확장)

**신규 8종 — 전부 선택, 기본값 있음**(FR-0-38, AC-X-4). `config/env.validation.ts`의 `EnvSchema`에 추가한다.

| 변수 | 기본값 | 용도 |
|---|---|---|
| `STATS_MAX_RANGE_DAYS` | `92` | 일 단위 조회 상한(FR-14-8, NFR-S9) |
| `STATS_MAX_RANGE_WEEKS` | `53` | 주 단위 조회 상한 |
| `STATS_MAX_RANGE_MONTHS` | `24` | 월 단위 조회 상한 |
| `STATS_TIMEZONE` | `Asia/Seoul` | 버킷·표기 기준. **변경 비권장**(과거 `dayBucket`은 재계산되지 않는다 — 값 검증용으로만 노출) |
| `UNANSWERED_MAX_PENDING` | `5000` | 챗봇당 `PENDING` 상한(FR-15-8) |
| `UNANSWERED_MAX_QUESTION_LENGTH` | `200` | 수집 대상 질문 길이 상한(EX-15-3) |
| `INTENT_SUGGEST_MIN_SCORE` | `0.25` | 추천 최소 임계값(FR-15-17) |
| `LEARNING_BULK_MAX_ITEMS` | `50` | 일괄 처리 상한(FR-15-30) |

> `STATS_TIMEZONE`은 **버킷 계산 함수의 상수를 대체하지 않는다.** KST 고정 오프셋(540분)이 코드의 기준이며, 이 변수는 운영자가 "이 인스턴스가 어떤 기준으로 집계 중인가"를 확인·표기하는 용도다. 실제 다중 타임존 지원은 No.45 범위다(값이 `Asia/Seoul`이 아니면 기동 시 경고 로그).

### 14.1 seed 전략 (NFR-M7)

| 트랙 | 목적 |
|---|---|
| **A(기존 `sample-support-bot`)** | 대시보드 AC 유지 — **기존 로그 구성을 바꾸지 않는다**(AC-2-* 회귀 금지). `dayBucket`/`hourBucket`만 계산해 채운다 |
| **신규 D(`stats-trend-bot`)** | **최근 60일에 분포한 로그** — 응답/미응답/금지어 차단 혼합, 노드·FAQ 응답 출처 혼합, **시간대 편중**(평일 10~11시·14~15시), 주말 저조. 주/월 버킷 합계 보존(AC-14A-2)과 시간대·요일 분포(AC-14B-5) 검증용. **KST 일 경계 검증용 로그 2건**(`23:50`·`00:10`)을 반드시 포함(AC-14A-4) |
| **신규 E(`learning-queue-bot`)** | 미응답 큐 — 정규화 병합 대상 변형 3종, `PENDING`/`RESOLVED`/`IGNORED` 각 1건 이상, **반영 후 재발생 1건**(`recurredCount > 0`), 추천이 걸리는 의도(`배송문의` + 예문)와 **추천 0건인 질문** 각 1건. ⚠ 큐를 만드는 챗봇에는 **대응 대화 로그도 함께 생성**한다(§3.4 불변식) |
| **F(기존 `empty-dashboard-bot`)** | 로그 0건 유지 — 빈 상태 AC(AC-14A-10, AC-UI-7) 검증용. **변경하지 않는다** |

seed는 `UnansweredQuestion`을 **직접 생성해도 된다**(수집 경로를 타지 않는다). 단 `questionNormalized`·`lastOccurredAt`·`variants`를 반드시 채워 유니크·정렬 규약을 깨지 않게 한다.

---

## 15. 이 Phase에서 하지 않는 것 (아키텍처 관점 재확인)

| 항목 | 이유 / 이관 |
|---|---|
| **`TrainingJob` 테이블 · `apps/ml-worker` · Job 큐 · 학습 Job · 수동 재학습 트리거 API** | 현행 엔진에 학습 연산이 없다(ADR-0008/0018). 쓰기 주체 없는 스키마를 만들지 않는다(ADR-0004). 교체 지점은 **DD-55의 메서드 1곳** → **No.16 / No.23** |
| **경량 분류기 재학습 · 질문의 낱개 요소 분리 · 엔티티 자동 부여** | **No.23**의 정의 그 자체 |
| **딥러닝 군집분석(토픽 클러스터링)** | **No.21**(GPU 7, ml-worker 배치). ⚠ `기능요구사항.md` §2 No.15 행의 "19번"은 **21번의 오기**다(요구사항 §10에 정정 제안이 있으며 본 설계서는 No.21로 표기한다) |
| **임베딩·의미 유사도 추천** | **No.18**. 이번 추천은 문자 bigram 자카드이며 의미를 이해하지 않는다는 한계를 화면에 명시한다 |
| **반영 후 자동 회귀 검증(학습영향도 TEST) / 운영 챗봇 복사·교체 워크플로우** | **No.20 / No.25·No.28** |
| **그룹·전역 통합 통계, 삭제된 챗봇의 누적 통계** | **No.29**. ADR-0002(영구삭제 시 하위 데이터 제거)와 충돌하는 별도 설계가 필요하다 |
| **신규/재방문·고유 방문자·이탈률·체류시간** | 방문자 식별자가 없다(J-8, ADR-0001). 쿠키 `visitorId`는 동의·보관기간·처리방침이 선행 → **No.45** |
| **실시간 모니터링 · 대화 흐름(노드 전이) 분석 · 만족도 지표 · 설문 통계 · 정기 리포트 발송** | **No.24 / No.24·29 / No.44 / No.27 / 알림 인프라 확보 시** |
| **집계 캐시 · 사전 집계 테이블 · 스케줄러/배치** | DD-54. 스케줄러 인프라가 없고 현 데이터 규모에 과설계다. 재검토 트리거는 로그 1,000만 행 또는 NFR-P1 미달. 백필 스크립트는 **1회성 수동 실행**이다 |
| **`ConversationLog.normalizedMessage` 컬럼** | 이번엔 파생 컬럼을 **`dayBucket`/`hourBucket` 2개로 제한**한다(한 번에 여러 파생 컬럼을 넣으면 백필 위험이 커진다). 인기질문 정규화는 현행 앱 집계 유지 |
| **통계 CSV 내보내기**(FR-14-31) | **DD-66** — 규격만 남기고 구현은 후속. 대응 AC가 0건이고 마스킹 우회 검토(NFR-S6)가 선행돼야 한다 |
| **미응답 질문 보존기간 정책·자동 정리 배치 / 물리 삭제 API** | 상한(FR-15-8) + `IGNORED` 수동 정리로 운영 가능하게 하고 리스크로 명시 → **No.45** |
| **`dashboard-period.ts`의 KST 헬퍼 통합** | J-4(대시보드 무변경)를 지키기 위해 남긴 **의도적 중복**이다. 두 구현의 동일성은 AC-14A-9로 고정하고, 통합 시점은 **No.29** 착수 시 |
| **마스킹 정책 변경 시 기존 큐 데이터 재처리** | 큐는 마스킹 완료 데이터의 2차 저장소다(NFR-S8). 정책(ADR-0013)이 바뀌면 **과거 항목은 과거 정책의 마스킹 상태로 남는다** — 재처리 필요성은 정책 변경 시점에 판단한다(EX-15-14, 운영 리스크로 기록) |
| **CI 연동·실제 배포** | `docs/05-ops/자동배포.md` §1 |

---

## 16. 요구사항 ↔ 설계 추적표 (발췌)

| 요구사항 | 설계 위치 |
|---|---|
| J-1 / FR-15-24, FR-15-33 | §10.3 `LearningApplyService.applyLearning()`, DD-55, **ADR-0018** |
| J-2 / FR-15-1~8 | §8, DD-51/52/53, **ADR-0019** |
| J-3 / FR-14-4~12, FR-0-31 | §3.2, §7.1, §7.2, DD-50/59, **ADR-0017** |
| J-4 / FR-14-1~3 | §1(전제), §4.1(주의), §7.4, AC-14A-9 |
| J-5 / FR-15-15~19 | §9.2 `lib/intent-suggest.ts` |
| J-6 / FR-15-34~36 | §11.2, DD-56 |
| J-7 / FR-15-37/38 | §11.1 |
| J-8 / FR-14-13~17 | §7.1(세션 파생), DD-61, F-5 |
| FR-14-20/21 | §7.3 `classifyResponseSource()`(폴백 우선 판정) |
| FR-14-28/29 | §7.1 Q3/Q4, DD-59, `lib/usage-trend.ts` |
| FR-15-20~26 | §10.1~10.4 |
| FR-15-30~33 | §10.6 |
| FR-C-1 | §12 판단항목 1(8탭 과밀 — `ui-designer`) |
| NFR-M5 / AC-X-7 | §7.1(원시 SQL 0건 + 탈출구) |
| NFR-M8 / AC-X-6 | §3.3, §13.2 |
| EX-15-6 | §2.2 C-1(409로 확정 — 요구사항 기대값 수정) |

**`code-reviewer` 중점 점검 항목**(요구사항 §11 승계 + 설계 추가분)

① 지표 계산이 두 벌로 구현되지 않았는가(FR-0-32/NFR-M2) ② **예문 추가·상한·충돌·감사 로직이 복제되지 않았는가**(NFR-M4 — `learning`에 `MAX_EXAMPLES`나 `dedupeExamples` 호출이 없어야 한다) ③ **신규 원시 SQL 0건**(AC-X-7) ④ 감사·경고 로그에 질문 원문/PII 0건 ⑤ `@Public()` 5개 유지 ⑥ 통계 API에 쓰기 0건(FR-0-35) ⑦ `prisma.unansweredQuestion` **쓰기**가 `UnansweredCollectorService`(수집) + `UnansweredQuestionsService`(상태 전이) 밖에 없는가 ⑧ 추천 계산 N+1 부재 ⑨ **`packages/dialogue-engine` 무수정** ⑩ 버킷·타임존 계산이 `shared-types` 순수 함수 1곳인가 ⑪ **`learning` 안에서 `bundleService.invalidate()` 호출이 `LearningApplyService` 1곳인가**(K-1) ⑫ **상태 전이가 조건부 `updateMany`(CAS)인가** — `findFirst` 후 `update` 패턴 금지(§10.4) ⑬ `conversation → learning` 역방향 의존 0건 ⑭ `@Get('summary')`가 `@Get(':id')`보다 먼저 선언됐는가.

---

## 17. 개발명세서 갱신분 (§2.2 / §3 / §4 / §5 / §6 / §7)

| 절 | 갱신 |
|---|---|
| §2 워크스페이스 표 | 상태를 "구현 중(**No.1~13 완료, No.14~15 설계 완료**)"로, `apps/widget` 행에 "**No.14~15에서도 수정하지 않는다**" 추가 |
| §2.2 | 통계 행 → **`stats`(확장) + `learning`(신규)** / 상태 "설계 완료 → `stats-learning-설계.md` §6". 인용 블록에 "**엔진 불가침(No.14~15)**: 통계 집계·추천 유사도·미응답 수집은 전부 `apps/api` 경계에 있고 엔진은 수정 0줄이다" 추가 |
| §3 엔터티 표 | §3.5의 3건(ConversationLog 설명 보강 / `UnansweredQuestion` 행 신설 / `TrainingJob` 각주) |
| §3.1 인덱스 목록 | `conversation_logs(chatbotId, dayBucket)`, `unanswered_questions(chatbotId, questionNormalized) UNIQUE`, `unanswered_questions(chatbotId, status, occurredCount)`, `unanswered_questions(chatbotId, lastOccurredAt)` 추가. 정규화 유일성 문단에 `UnansweredQuestion.questionNormalized` 포함 |
| §4 API 표 | §5.2의 2건(통계 행 정정 + 학습현황 행 신설) + 정정 이력(2026-09-22) |
| §5 성능 | "통계 집계 500ms(P95)" → "**챗봇 대시보드 집계 500ms(P95), 기간 시계열 통계는 로그 10만 행/90일 기준 1초(P95)이며 5초 초과 시 `503`, 학습현황 목록(추천 포함) 500ms(P95), 일괄 반영 50건 5초(P95)**" |
| §5.1 환경변수 | §14의 8종 추가 + 각주 "통계/분석 그룹(No.14~15)이 추가한 8개는 **전부 선택(기본값 있음)**" |
| §6 결정 사항 | **22~24번 신설** — ADR-0017(시계열 버킷 전략) / ADR-0018(No.15 재학습 범위 경계와 ml-worker 인계 지점) / ADR-0019(미응답 큐 수집 모델) |
| §7 인덱스 | `stats-learning-설계.md` 행 + ADR-0017/0018/0019 행 추가 |

`docs/04-test/` 갱신 제안(요구사항 §10 승계, `test-automation` 인계): **TC-15의 "재학습 Job 생성"은 이번 범위에 존재하지 않는다** → "저장 → 의도 예문 반영 + 번들 캐시 무효화 → 다음 턴부터 매칭"으로 정정하고 AC-15A/15B로 상세화한다. TC-14는 유지하고 AC-14A/14B를 상세 항목으로 추가한다. `시험데이터.md` §6의 미응답 질문 샘플은 DD-49 확장 필드(변형 3종·상태 3종·재발생)를 반영해 갱신한다.
