# 통합 통계 세부 설계서 (No.29)

> **요구사항**: `docs/requirements/integrated-stats.md`(J-1~J-15, FR-0-88~95, FR-I1-\*~FR-I8-\*, NFR-IP/IS/IA/IM, AC-I1~I6, EX-I-1~18, P-1~P-9)
> **상위 문서**: `docs/02-spec/개발명세서.md` §2·§2.2·§3·§3.1·§4·§4.1·§5·§5.1·§6(**결정 34 신설**)·§7
> **신규 ADR**: **ADR-0033**(누적 통계 = 원천 로그 직접 집계 + 로그 삭제·변경 경로 봉인 · 대화 당시 그룹 스냅샷 귀속 · 그룹 보관 · 롤업 미도입과 재검토 트리거)
> **갱신 ADR(각주만)**: ADR-0002(대화로그 사전검사 409 = 누적 통계 보존 장치 · 그룹 삭제 = 이력 있으면 보관) · ADR-0004(일/주 집계 테이블 No.29에서도 미도입) · ADR-0017(세션 distinct 원시 SQL 확장 이행 · KST 헬퍼 중복 해소 · 롤업 트리거 갱신) · ADR-0015(`stats:read` 검토 결과 신설 안 함) · ADR-0001(그룹·전역 스코프의 세션 키)
> **작성일**: 2026-09-24 · **GPU**: **1 유지**(새 모델·추론·임베딩 0 · ml-worker 변경 0). ml-engineer 신규 작업 없음 — §19.
> **기존 파일 수정 목록**: 문서는 `docs/02-spec/integrated-stats-patches.md`, 코드는 이 문서 §2.5.

---

## 0. 이 문서가 푸는 문제 (한 문단 요약)

"챗봇이 삭제되어도 그룹 기준 누적 통계 유지"(카탈로그 No.29)는 **보존 문제가 아니라 귀속·가시성 문제**다. 코드상 대화로그는 이미 어떤 운영 경로로도 지워지지 않는다 — 콘솔의 "삭제"는 `status='ARCHIVED'`만 바꾸고(`apps/api/src/chatbots/chatbots.service.ts:266-279`), 영구삭제는 대화로그가 1건이라도 있으면 `409 CHATBOT_HAS_CHILDREN`이며(`chatbots.service.ts:291-328`), DB FK도 `onDelete: Restrict`다(`apps/api/prisma/schema.prisma:372`). 실제 공백은 ① 그룹·전역 집계가 없다 ② 보관 챗봇이 목록에서 안 보인다 ③ **그룹 이동이 과거 통계를 소급해서 옮긴다**(`ConversationLog`에 그룹 정보가 없고 `moveGroup()`은 `Chatbot.groupId`만 바꾼다 — `chatbots.service.ts:204-221`) ④ 미래의 삭제 경로를 막는 **구조적** 장치가 없다. 이 설계는 원천 직접 집계(롤업 없음)를 유지하면서 ①은 새 API/화면, ②는 보관 포함 규칙, ③은 `ConversationLog.groupId` 스냅샷, ④는 정적 검사 봉인으로 닫는다.

---

## 1. PM 확정 사항 (2026-09-24 — §11 P-1~P-9 전부 권고안)

| # | 확정 내용 | 이 문서에서의 반영 |
|---|---|---|
| P-1 | 대안 A: 원천 `ConversationLog` 직접 집계(롤업 테이블 없음) + 로그 삭제 경로 0건 정적 검사 봉인. 롤업 재검토 트리거 명시 | §5(쿼리 계획) · §11(봉인 R-1~R-10) · §12.3(트리거) · ADR-0033 §1·§2·§3 |
| P-2 | 대화로그 있는 챗봇의 로그 포함 영구삭제 불허(ADR-0002 유지, 삭제 = 보관) | §3.6(영구삭제 경로 불변) · §11 R-6(사전검사 대상 유지 단언) · FR-I1-5 문구 |
| P-3 | 대화 당시 그룹 귀속 — `ConversationLog.groupId` 스냅샷을 `record()` 1곳에서 기록, 기존 행은 현재 소속으로 백필. 감사로그 기반 소급 재귀속 없음 | §3.1·§3.3 · §4 · §11 R-9/R-10(적재 후 불변) |
| P-4 | 로그가 귀속된 그룹 삭제 → 보관(`ChatbotGroup.archivedAt`), 목록·생성·이동 대상에서 숨김, 통계에는 "보관된 그룹" | §4.3 |
| P-5 | 보관 챗봇 질문도 그룹 질문순위 기본 포함 + 제외 토글(누적 KPI·요약·분포·기여표는 항상 포함) | §5.6 · `includeArchivedChatbots` |
| P-6 | 의도별 매칭 통계는 챗봇 스코프에만, 삭제된 의도는 "삭제된 의도". 그룹 합산/FAQ·노드별 순위는 범위 밖 | §6 |
| P-7 | `stats:read` 신설 안 함(`chatbot:read` 유지, 권한 15종 불변) | §9 · ADR-0015 갱신 각주 |
| P-8 | 콘솔 홈 `/`를 통합(전역) 통계로 대체 + 챗봇 목록 그룹 행에 "그룹 통계" 링크 | §13 |
| P-9 | GPU 1 | §19 |
| (architect) | KST 헬퍼 통합(J-11) — 대시보드 동작 불변, `dashboard-period.ts`/`kst-date.ts` 중복 제거 | §7 |
| (architect) | 세션 distinct 원시 SQL 확장(J-12) — 원시 SQL 격리 원칙 유지 | §5.3 · §11 R-7 |

---

## 2. 아키텍처 배치

### 2.1 모듈 구조 — `stats` 모듈 확장 (신규 모듈 없음)

기존 4계층 규약(개발명세서 §2.1)을 따른다. 통합 통계는 **읽기 전용**이며 새 NestJS 모듈을 만들지 않는다 — 같은 원천·같은 지표 정의·같은 타임아웃을 공유해야 하므로 `StatsModule` 안에 둔다.

```
apps/api/src/stats/
├── stats.controller.ts                 # [수정] GET /stats/intents 핸들러 1개 추가(기존 4개 무변경)
├── stats.service.ts                    # [리팩터링만] 인라인 조립 코드 → lib 순수 함수 호출로 교체(응답 바이트 불변, §5.2)
├── stats-request.helpers.ts            # [신규] parseGranularityOrThrow·resolveStatsPeriodOrThrow·runWithAggregationTimeout
│                                       #        (stats.service.ts:407-430·443-462에서 이동 — 두 서비스 공용, 동작 불변)
├── integrated/
│   ├── integrated-stats.controller.ts  # [신규] @Controller('stats/integrated') — 6개 핸들러(§8.1)
│   ├── integrated-stats.service.ts     # [신규] 오케스트레이션: 스코프 판정 → 쿼리 병렬 실행 → 순수 함수 조립
│   └── integrated-session.query.ts     # [신규] ★ 세션 distinct 원시 SQL 빌더·실행기 — 이 그룹의 유일한 원시 SQL 파일(§5.3)
├── intents/
│   └── intent-stats.service.ts         # [신규] 챗봇 스코프 의도별 매칭(§6)
└── lib/                                # DB·Nest 무의존 순수 함수(NFR-IM1)
    ├── kst-date.ts                     # [무변경] KST 달력 산술 단일 소스(§7)
    ├── dashboard-period.ts             # [수정] 내부 KST 헬퍼 재정의 삭제 → kst-date.ts import(동작 불변, §7)
    ├── bucket.ts                       # [추가] buildBucketDayRanges() — 버킷별 [시작 dayBucket, 끝 dayBucket] (§5.3)
    ├── dashboard-aggregator.ts         # [추가] normalizeQuestion export(현재 private, :21-23) — 질문 귀속 병합용
    ├── summary-assembler.ts            # [신규] 버킷 조립·총계·turnsPerSession·출처/채널 비율 조립(stats.service.ts 인라인 코드 추출)
    ├── scope-filter.ts                 # [신규] 스코프 → Prisma where / SQL 조건 판정 함수 1곳(FR-I3-2)
    ├── breakdown.ts                    # [신규] 기여 표 조립 · allocateShares(최대 잔여법) · 상한 200 + 기타 행
    ├── question-attribution.ts         # [신규] 질문별 최다 챗봇 귀속(후보 병합 결과 기준)
    ├── intent-stats.ts                 # [신규] 의도별 폴딩 · 삭제 의도 표시 · 두 분모 비율
    ├── kst-date.contract.spec.ts       # [신규] kst-date 조합 ≡ shared-types toKstDayBucket 계약 테스트(FR-I5-2)
    └── stats-retention-sealing.spec.ts # [신규] 봉인 정적 검사 R-1~R-10(§11)
```

### 2.2 모듈 의존 방향

```
stats → chatbots(ChatbotsService.existsById — 기존) · prisma · config
```
- **`StatsModule`은 `ChatbotGroupsModule`을 import하지 않는다.** `ChatbotGroupsService`는 보관 그룹을 숨기도록 바뀌므로(§4.3) 통계는 그룹 행을 **Prisma로 직접 읽는다**(보관 포함).
- **`StatsModule`은 `ConversationModule`·`LearningModule`을 import하지 않는다**(현행 유지). 쓰기 대상 테이블 0개(§11 R-8).
- `chatbot-groups`·`chatbots` → `stats` 방향 참조는 없다. 그룹 보관 판정의 "로그 존재 여부"는 `ChatbotGroupsService`가 Prisma로 1건 조회한다(§4.3).

### 2.3 엔진 불가침

`packages/dialogue-engine` **변경 0건**(FR-0-88). 이 그룹은 엔진을 호출하지 않는다.

### 2.4 `apps/api` 외 워크스페이스 영향

| 워크스페이스 | 변경 |
|---|---|
| `packages/shared-types` | `stats.ts` **append**(§8.2 스키마 전부) · `common.ts` **주석만**(KST 헬퍼 "의도적 분리" 문구를 통합 완료로 정정 — `common.ts:175-181`) · `chatbot.ts` **변경 없음**(§8.4 D-5 — 그룹 DTO에 `archivedAt`을 노출하지 않는다) |
| `packages/dialogue-engine` | **변경 0건** |
| `apps/web` | 홈 `/` 통합 통계 화면(`DashboardHomePage.tsx:4-13` 대체) · 챗봇 목록 그룹 행 "그룹 통계" 링크 · 챗봇 통계 화면 "의도별 매칭" 섹션 · 보관/이동/그룹 삭제 확인 대화상자 문구 3종 · 영구삭제 409 안내 문구 · `ResponseSourceDistribution`/`TopQuestionsPanel`의 `chatbotId`를 선택 prop으로(링크 조건부) |
| `apps/widget` · `apps/ml-worker` | **변경 0건** |

### 2.5 기존 코드 변경 목록 (구현자 체크리스트)

| 파일 | 변경 | 근거 |
|---|---|---|
| `prisma/schema.prisma` + 마이그레이션 1개 | `ConversationLog.groupId String @default("")` + `@@index([groupId, dayBucket])` + `@@index([dayBucket])` · `ChatbotGroup.archivedAt DateTime?` · `Chatbot.archivedAt DateTime?` + 수기 `UPDATE`(§3.2) | §3 |
| `prisma/scripts/backfill-conversation-group.ts` | **신규** 1회성 백필(§3.3) | FR-I2-3 |
| `conversation/conversation-log.service.ts` | `RecordConversationLogParams.groupId: string` **필수** 추가(:10-28) · `create.data.groupId`(:62-79) | FR-I2-2 |
| `rag/conversation-log.port.ts` | `record()` 파라미터에 `groupId: string` **필수**(:10-21) | FR-I2-2(누락 = 컴파일 오류) |
| `rag/rag-answer.service.ts` | `RagAnswerRunInput.groupId: string` 필수(:19-31) · `logPort.record()` 2곳에 전달(:153-163, :172-182) | 〃 |
| `conversation/public-conversation.service.ts` | `record()` 2곳(:94-104, :169-181)에 `groupId: chatbot.groupId` · `startPendingRagAnswer` 입력(:147-158, :224-235)과 `ragAnswer.enqueue` 입력(:253-265)에 `groupId` 전달. **추가 DB 조회 0건** — `PublicAccessService.resolve()`가 이미 챗봇 행 전체를 읽는다(`public-access.service.ts:21`) | AC-I3-2 |
| `chatbot-groups/chatbot-groups.service.ts` | `list()`(:36-47) where `archivedAt: null`(목록·count 모두) · `findRowOrThrow()`(:135-139) `findFirst({ id, archivedAt: null })` · `copy()`(:83-87) 동일 조건 · **`remove()`(:67-79) = 인터랙티브 트랜잭션 안에서 소속 챗봇 재확인 → 로그 존재 시 `archivedAt=now` 갱신, 없으면 물리 삭제**(§4.3) | FR-I2-6/7 |
| `chatbots/chatbots.service.ts` | `create()`(:67) · `moveGroup()`(:206) · `copy()`(:228)의 그룹 조회를 `findFirst({ id, archivedAt: null })`로(보관 그룹 = `404`) · `archive()`(:269)·`updateStatus()`(:190)에서 `Chatbot.archivedAt` 동기화(§3.5 순수 함수) · **영구삭제 사전검사(:291-328)·트랜잭션(:342-366) 무변경** | FR-I2-7 · §3.5 |
| `chatbots/lib/status-transition.ts` | `archivedAtPatch(prevStatus, nextStatus, now)` 순수 함수 추가 | §3.5 |
| `stats/stats.service.ts` | 인라인 조립 코드를 `lib/summary-assembler.ts` 호출로 교체(:185-229 버킷·총계·세션·turnsPerSession, :287-312 출처·채널 비율) · private 헬퍼 3개를 `stats-request.helpers.ts`로 이동 · **`getDashboard()`(:66-136)와 그 원시 SQL(:86-94) 무변경** | FR-0-89/90 |
| `stats/stats.controller.ts` | `GET /stats/intents` 1개 추가(기존 4개 무변경) | FR-I4-1 |
| `stats/stats.module.ts` | providers에 `IntegratedStatsService`·`IntegratedSessionQuery`·`IntentStatsService`, controllers에 `IntegratedStatsController` | — |
| `stats/lib/dashboard-period.ts` | :1-2(`KST_OFFSET_MINUTES`·`MS_PER_DAY`), :13-27(`KstDateOnly`·`toKstDateOnly`·`kstDateOnlyToUtc`) 삭제 → `./kst-date` import. :3 `MAX_PERIOD_DAYS`, :35-62 본문은 **한 글자도 바꾸지 않는다** | FR-I5-1 |
| `stats/lib/stats-period.ts` | :17-18 주석("의도적 중복")만 정정 | FR-I5-1 |
| `stats/lib/dashboard-aggregator.ts` | `normalizeQuestion`(:21-23) `export` 추가(본문 불변) | §5.6 |
| `stats/lib/bucket.ts` | `buildBucketDayRanges()` 추가(기존 함수 불변) | §5.3 |
| `integration/helpers/conversation-log.helper.ts` | 입력에 `groupId?`·`matchedIntentId?` 선택 필드 추가. `groupId` 미지정 시 **챗봇의 현재 `groupId`를 조회해 채운다**(신규 통합 스펙이 센티넬을 만들지 않게 — ADR-0017 §6 ④ 선례). 기존 호출부 단언 변경 0 | NFR-IM4 |
| `prisma/seed.ts` | `conversationLog.createMany`(:155, :231) 데이터에 `groupId` 채움(시드 챗봇의 그룹) — dev DB가 `backfillPending`으로 시작하지 않게 | FR-I2-4 |
| `apps/web/src/pages/DashboardHomePage.tsx` · `App.tsx:86` | 홈을 통합 통계 페이지로 교체 | P-8 |
| `apps/web/src/pages/chatbot-list/GroupTree.tsx` | 그룹 행에 "그룹 통계" 링크(`/?scope=GROUP&groupId=…`) | FR-I8-2 |
| `apps/web/src/pages/chatbot-list/modals.tsx` | 보관·그룹 이동·그룹 삭제 확인 문구 + 영구삭제 409 안내 보강 | FR-I1-5, FR-I2-5/6 |
| `apps/web/src/pages/stats/StatsOverviewPage.tsx` | "의도별 매칭" 섹션 추가(기존 섹션·순서·수치 불변) | FR-I8-5 |

> **이 목록에 없는 파일은 바꾸지 않는다.** 특히 `packages/dialogue-engine/**`, `apps/api/src/stats/lib/{usage-trend,response-source,stats-period(주석 외)}.ts`, `getDashboard()`, 영구삭제 사전검사 목록은 **무변경**이다.

---

## 3. 데이터 모델 · 마이그레이션 · 백필

### 3.1 Prisma 변경안

```prisma
model ChatbotGroup {
  // …기존 필드 불변…
  /// [신규 No.29] 대화로그가 귀속된 그룹을 "삭제"하면 물리 삭제 대신 이 값을 채운다(ADR-0033 §5).
  /// 보관 그룹은 목록·챗봇 생성/이동/복사·그룹 수정/복사 대상에서 제외되고(404), 통합 통계에만 "보관된 그룹"으로 남는다.
  /// 쓰기 주체 = ChatbotGroupsService.remove() 1곳. 되살리기 경로는 1차 범위 밖.
  archivedAt  DateTime?
}

model Chatbot {
  // …기존 필드 불변…
  /// [신규 No.29] 가장 최근 보관 시각. status='ARCHIVED' ⇔ archivedAt != null(불변식).
  /// 쓰기 주체 = ChatbotsService.archive()·updateStatus() 2곳(순수 함수 archivedAtPatch 공용). 기여 표의 "보관일" 표시 전용.
  archivedAt  DateTime?
}

model ConversationLog {
  // …기존 필드 불변…
  /// [신규 No.29] 대화 **당시** 챗봇의 소속 그룹 스냅샷(ADR-0033 §4). **FK를 걸지 않는다** — 그룹 행 정리와 로그 보존을
  /// 분리한다(matchedIntentId·AuditLog.chatbotId와 같은 의도적 예외). 쓰기 주체 = ConversationLogService.record() 1곳이며
  /// **적재 후 변경하지 않는다**(그룹 이동이 과거 누적을 소급 변경하지 않게 — 정적 검사 R-9/R-10).
  /// `""`는 백필 미완 센티넬이다(dayBucket 선례). 백필 스크립트만 `""` → 값으로 채울 수 있다.
  groupId         String   @default("")

  @@index([chatbotId, createdAt])     // 기존
  @@index([chatbotId, dayBucket])     // 기존
  @@index([groupId, dayBucket])       // [신규] 그룹 스코프 기간 필터 · 백필 잔여 확인 · 그룹 보관 판정
  @@index([dayBucket])                // [신규] 전역 스코프 기간 필터(§3.4 판단)
}
```

**만들지 않는 것**: 롤업/사전 집계 테이블 · 그룹명 스냅샷 컬럼(보관 그룹 행이 이름을 보존한다) · 통계 캐시 · 사용자-그룹 접근 테이블 · `inputKind`·`previousNodeId` 컬럼 · `ChatbotGroup` 이름 유일 제약(기존 규약 유지 — EX-I-11은 표시로 해결).

### 3.2 마이그레이션 (1개, `YYYYMMDDHHMMSS_integrated_stats_schema`)

Prisma가 생성하는 DDL은 전부 **비파괴 `ALTER TABLE … ADD COLUMN` + `CREATE INDEX`** 다(기본값이 있는 컬럼 추가라 SQLite 테이블 재생성이 일어나지 않는다 — 생성된 SQL에 `DROP TABLE "conversation_logs"`가 있으면 **중단하고 원인을 확인**한다).

```sql
ALTER TABLE "conversation_logs" ADD COLUMN "groupId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "chatbot_groups"    ADD COLUMN "archivedAt" DATETIME;
ALTER TABLE "chatbots"          ADD COLUMN "archivedAt" DATETIME;
CREATE INDEX "conversation_logs_groupId_dayBucket_idx" ON "conversation_logs"("groupId", "dayBucket");
CREATE INDEX "conversation_logs_dayBucket_idx"         ON "conversation_logs"("dayBucket");
-- [수기 추가 — 챗봇 테이블은 작아 마이그레이션 안에서 처리] 보관 챗봇의 보관일 근사 백필
UPDATE "chatbots" SET "archivedAt" = "updatedAt" WHERE "status" = 'ARCHIVED' AND "archivedAt" IS NULL;
```

- **`Chatbot.archivedAt` 백필 = `updatedAt` 근사**: 보관 챗봇은 설정·스킨 수정이 막혀 있어(`assertNotArchived`, `chatbots.service.ts:123,152`) `updatedAt`이 대체로 보관 시각이다. 보관 중 그룹 이동이 있었으면 이동 시각이 된다 — 표시 전용 필드라 수용한다(§17 L-4).
- **기존 데이터 호환성**: 기존 행은 `groupId=''`(집계 대상 밖 — §3.3이 채운다), `ChatbotGroup.archivedAt=NULL`(전부 활성 = 현행과 동일). 기존 API 응답·동작 변화 0.
- **롤백**: 컬럼 3개·인덱스 2개 DROP으로 완전 롤백된다. 단 롤백 후 재적용하면 그 사이 스냅샷(대화 당시 그룹)은 **현재 소속 백필로만** 복원된다(§17 L-1).

### 3.3 백필 — `apps/api/prisma/scripts/backfill-conversation-group.ts` (FR-I2-3)

`backfill-conversation-buckets.ts`(ADR-0017 §6) 형식을 따른다. **원시 SQL 0건**(Prisma `findMany` + `updateMany`).

```
for each chatbot in prisma.chatbot.findMany({ select: { id, groupId } }):      // 보관 챗봇 포함
  loop:
    ids = conversationLog.findMany({ where: { chatbotId, groupId: '' }, select: { id }, take: 2000 })
    if ids.length === 0: break
    conversationLog.updateMany({ where: { id: { in: ids }, groupId: '' }, data: { groupId: chatbot.groupId } })   // 배치당 트랜잭션 1개
    진행률 출력(챗봇 수 / 누적 행)
verify: conversationLog.count({ where: { groupId: '' } }) === 0  → 아니면 exit(1)
출력 말미 고정 문구: "과거 그룹 이동 이력은 복원하지 않았습니다 — 백필 이전 로그는 모두 현재 소속 그룹에 귀속됩니다(EX-I-6)."
```

- **멱등·재개 가능**: 조건이 `groupId=''`뿐이라 두 번 실행해도 결과가 같다(AC-I3-4). `updateMany`의 `groupId: ''` 재확인이 같은 행을 이미 채운 경합에서도 덮어쓰지 않는다.
- **쓰기 잠금 예산**: 배치 2,000행 `updateMany` 1건 = SQLite 쓰기 잠금 1회(수십 ms 수준 — NFR-IP5 "배치당 1초 미만"). 100만 행 = 500배치(10분 이내 목표).
- **이 스크립트는 `apps/api/src` 밖**(`prisma/scripts`)이며 정적 검사 R-10의 "`conversationLog` 변경 호출 0건"의 유일한 예외 위치다(`prisma/` 전체가 검사 대상 밖).
- **소급 재귀속(감사로그 `소속 그룹 이동` 기반)은 하지 않는다**(P-3 부속 결정). 감사 도입(No.13) 이전 이동은 복원할 수 없어 부분 정확성밖에 얻지 못한다.

### 3.4 인덱스 판단

| 인덱스 | 소비 쿼리 | 판단 |
|---|---|---|
| `(groupId, dayBucket)` | GROUP 스코프 전 쿼리의 `WHERE groupId = ? AND dayBucket BETWEEN` · 백필 잔여 `findFirst({ groupId: '' })` · 그룹 보관 판정 `findFirst({ groupId })` | **필수**(FR-I7-1) |
| `(dayBucket)` | ALL 스코프의 기간 필터(요약·분포·질문·기여 표) | **채택.** 기존 인덱스가 전부 `chatbotId` 선행이라 ALL 스코프 기간 조회는 전량 스캔이 된다. SQLite skip-scan은 `ANALYZE` 통계가 있어야만 쓰이고 Postgres(18 미만)는 skip-scan이 없다 — "실측 후 결정"보다 이식성 있는 인덱스 1개가 싸다. 쓰기 비용은 append-only 테이블에 인덱스 1개(턴당 B-tree 삽입 1회) |
| `(chatbotId, hourBucket)` · `(groupId, hourBucket)` | — | **만들지 않는다**(ADR-0017 §2 — 시간대 조회는 항상 기간 필터 동반) |
| `(groupId, dayBucket, chatbotId, sessionId)` 커버링 | 누적 KPI 세션 distinct | **보류.** §12의 실측에서 NFR-IP2 미달일 때 **롤업 전에 먼저 시도할 1차 완화책**으로만 남긴다(쓰기 비용 증가) |

구현 시 `EXPLAIN QUERY PLAN`으로 GROUP/ALL 스코프 요약 쿼리가 각각 두 신규 인덱스를 적중하는지 확인한다(code-reviewer 점검 항목).

### 3.5 `Chatbot.archivedAt` 동기화 규칙

```ts
// chatbots/lib/status-transition.ts
export function archivedAtPatch(prev: ChatbotStatus, next: ChatbotStatus, now: Date): { archivedAt?: Date | null } {
  if (next === 'ARCHIVED' && prev !== 'ARCHIVED') return { archivedAt: now };
  if (prev === 'ARCHIVED' && next !== 'ARCHIVED') return { archivedAt: null };
  return {};
}
```
- 호출부 2곳: `archive()`(`chatbots.service.ts:269` — `data: { status: 'ARCHIVED', ...archivedAtPatch(...) }`) · `updateStatus()`(:190). `ChatbotPublicationService`는 `DRAFT→ACTIVE`만 하므로 호출 불필요. 복원(No.25)은 `status`를 바꾸지 않는다(ADR-0031).
- 감사 스냅샷(`AUDIT_FIELDS.Chatbot`)에 추가하지 않는다 — 상태 변경 감사가 이미 사실을 담는다.
- `Chatbot` DTO(`toChatbotDto`)에 노출하지 않는다 — 소비자가 기여 표 1곳뿐이다(쓰기 주체·소비자 규약).

### 3.6 영구삭제 경로 — **무변경**(P-2)

`permanentDelete()`의 사전검사 9종(`chatbots.service.ts:291-311`)과 동반 삭제 14테이블(:342-366)은 **한 글자도 바꾸지 않는다.** `conversationLogs`·`unansweredQuestions`는 계속 **사전검사(409) 대상**이며 동반 삭제 대상이 아니다. 이 두 항목이 사전검사 목록에서 빠지지 않았음을 정적 검사 R-6이 단언한다. 409 응답 코드·조건은 불변이고, **화면 문구만** "대화 기록이 있는 챗봇은 통계 보존을 위해 영구삭제할 수 없습니다. 보관 상태로 유지하세요"로 보강한다(FR-I1-5 — 서버 메시지 `연결된 데이터(...)가 있어 삭제할 수 없습니다.`는 불변, 프런트가 `CHATBOT_HAS_CHILDREN` 코드 분기에서 보조 문구를 덧붙인다).

### 3.7 배포 순서

1. 마이그레이션 적용(컬럼 3 · 인덱스 2 · 챗봇 보관일 근사).
2. API 배포 — 새 로그부터 `groupId` 스냅샷이 기록된다.
3. `pnpm --filter api exec ts-node prisma/scripts/backfill-conversation-group.ts` 실행 → 검증 0건 확인.
4. 2~3 사이에는 통합 통계가 `backfillPending: true`와 안내를 표시한다(조용한 과소 집계 금지 — FR-I2-4). 챗봇 스코프 통계(No.14)·대시보드(No.2)는 `groupId`를 쓰지 않으므로 **영향 0**.
5. ⚠ 2와 3 사이에 그룹 이동이 있으면 그 챗봇의 과거 로그는 **이동 후 그룹**으로 백필된다(EX-I-6과 같은 한계). 운영 절차상 2→3을 연속 실행한다.

---

## 4. 그룹 귀속 규칙 (J-4 · J-5)

### 4.1 쓰기 경로 — `record()` 1곳, 추가 조회 0

```
PublicConversationService.sendMessage()
  { chatbot } = access.resolve(slug)                  ← chatbot 행 전체(groupId 포함) — 기존 조회
  ├─ 금지어 차단 턴 → logService.record({ …, groupId: chatbot.groupId })            (:94)
  ├─ 일반 턴       → logService.record({ …, groupId: chatbot.groupId })            (:169)
  └─ RAG 보류 턴   → startPendingRagAnswer({ …, groupId: chatbot.groupId })
                      → ragAnswer.enqueue({ …, groupId }, { record: logService.record })
                      → (완료/폴백 시) logPort.record({ …, groupId: input.groupId })     (rag-answer.service.ts:153, :172)
```
- **스냅샷 시점 = 턴 처리 시작 시 읽은 챗봇 행**(EX-I-8). RAG 보류 답변은 최대 수십 초 뒤 적재되지만 `groupId`는 **요청 시점 값**이다 — 그 사이 그룹이 이동해도 그 턴은 이동 전 그룹에 귀속된다(대화가 시작된 시점의 사실).
- `groupId`는 `RecordConversationLogParams`·`ConversationLogPort`·`RagAnswerRunInput` 3개 타입에서 **필수**다 — 전달 누락은 빌드 실패(EX-I-7). 런타임에 빈 문자열이 들어오는 결함은 `""` 센티넬 → `backfillPending`으로 드러난다.
- 시뮬레이션·TC 실행은 로그를 남기지 않으므로(ADR-0030) 해당 없음.

### 4.2 불변성 — "이동해도 과거는 바뀌지 않는다"

- `moveGroup()`(`chatbots.service.ts:204-221`)은 **로그를 건드리지 않는다**(현행 그대로). 이동 전 로그는 이전 그룹, 이동 후 로그는 새 그룹으로 집계된다(AC-I3-1).
- 로그의 `groupId`를 적재 후 바꾸는 코드는 **`src`에 0건**이다(R-10: `conversationLog.update|updateMany|upsert` 0건). "그룹 이동 시 로그도 같이 옮기자"는 편의 코드가 들어오는 순간 CI가 실패한다.

### 4.3 그룹 삭제 = 이력 있으면 보관 (P-4)

```ts
// ChatbotGroupsService.remove(id) — 인터랙티브 트랜잭션(SQLite 직렬화 — ADR-0031 §6과 같은 근거)
const row = await tx.chatbotGroup.findFirst({ where: { id, archivedAt: null }, include: GROUP_WITH_COUNT_INCLUDE });
if (!row) → 404 NOT_FOUND                          // 이미 보관된 그룹 포함
if (row._count.chatbots > 0) → 409 GROUP_NOT_EMPTY  // 보관 챗봇 포함 — 판정·문구 불변(AC-I4-4)
const hasHistory = await tx.conversationLog.findFirst({ where: { groupId: id }, select: { id: true } });  // (groupId, dayBucket) 인덱스
if (hasHistory) { after = await tx.chatbotGroup.update({ where: { id }, data: { archivedAt: now } }); mode = 'ARCHIVE' }
else            { await tx.chatbotGroup.delete({ where: { id } }); mode = 'PURGE' }
// 커밋 후 감사(ADR-0016 §4): action='DELETE', targetType='ChatbotGroup', before=row, (ARCHIVE면) after + summary '그룹 보관(통계 보존)'
return 204   // 두 경우 응답 동일
```
- **보관 그룹은 소속 챗봇이 항상 0개다** — 비어 있어야 보관되고(위 판정), 보관 후에는 생성·이동·복사 대상이 될 수 없다(`404`). 경합(보관 트랜잭션과 `moveGroup`이 동시)은 SQLite 쓰기 직렬화로 한쪽이 대기·재확인된다. `moveGroup()`의 그룹 확인과 챗봇 갱신은 **같은 인터랙티브 트랜잭션**으로 묶는다(§2.5). Postgres 전환 시에는 `Serializable` 지정 대상에 이 2지점을 추가한다(§17 L-5).
- 보관 그룹이 제외되는 지점(전수): `GET /chatbot-groups` 목록·총계 · `GET|PATCH|DELETE /chatbot-groups/:id` · `POST /chatbot-groups/:id/copy` · `POST /chatbots`(대상 그룹) · `PATCH /chatbots/:id/group` · `POST /chatbots/:id/copy`(`targetGroupId`). `GET /chatbots?groupId=<보관 그룹>`은 소속이 0개라 빈 목록이다(오류 아님).
- **로그 백필 전**(`groupId=''` 잔존) 그룹을 삭제하면 "이력 없음"으로 판정되어 물리 삭제될 수 있다. 그 로그는 이후 백필에서 **현재 소속**(이동 후 그룹)으로 귀속되므로 고아가 되지 않는다(§3.7 ⑤와 같은 한계).
- **로그가 가리키는 그룹 행이 없는 경우**(백필 전 물리 삭제 직후 극소 경합 등)도 통계는 실패하지 않는다 — 기여 표에 `missing: true`, 이름 대신 "알 수 없는 그룹(id 앞 8자리)"로 표시한다(§5.5).
- 보관 그룹 되살리기·이름 변경은 1차 범위 밖(EX-I-10).

---

## 5. 집계 설계 (J-6~J-9 · J-12)

### 5.1 스코프 판정 — 1곳 (FR-I3-2, NFR-IM1)

```ts
// stats/lib/scope-filter.ts — 순수 함수
export type ResolvedScope = { scope: 'ALL' } | { scope: 'GROUP'; groupId: string };
export function scopeLogWhere(s: ResolvedScope): { groupId?: string } {
  return s.scope === 'GROUP' ? { groupId: s.groupId } : {};   // ★ 챗봇 상태 조건을 절대 넣지 않는다(FR-I1-2)
}
```
- GROUP 스코프: `groupId` 존재 확인은 `prisma.chatbotGroup.findUnique({ where: { id } })` — **보관 그룹도 조회 허용**, 미존재 `404 NOT_FOUND`(EX-I-1). 존재 확인은 권한 가드 통과 후(ADR-0015 ⑥).
- ALL 스코프: 조건 없음 → **`groupId=''`(백필 미완) 행도 합계에 포함**된다. 즉 ALL 스코프 합계는 백필 전에도 정확하고, 불완전한 것은 기여 표의 그룹 배분뿐이다(§5.5 `unassignedRow`).
- 모든 기간 쿼리의 `where` = `{ ...scopeLogWhere(s), dayBucket: { gte, lte } }` — 스코프 키가 선행해 인덱스를 적중한다.

### 5.2 재사용 지점 — "같은 지표의 계산식은 한 곳" (FR-0-89)

현재 `getSummary()`·`getDistribution()`은 순수 함수를 호출하되 **조립 코드 일부가 서비스 안에 인라인**이다(`stats.service.ts:185-229` 버킷 루프·총계·기간 세션·`turnsPerSession`, :287-312 출처·채널 비율). 그룹 스코프가 이를 복제하면 FR-0-89 위반이므로 **먼저 추출**한다.

| 추출 대상(현재 위치) | 새 순수 함수(`lib/summary-assembler.ts`) | 호출자 |
|---|---|---|
| 버킷 루프 + 총계(:185-216) | `assembleSummaryBuckets(buckets, foldedDayRows, sessionCountsByBucket) → { bucketResults, totals }` | 챗봇·통합 요약 |
| `turnsPerSession`(:229) | `computeTurnsPerSession(turnCount, visitCount)` | 챗봇·통합 요약·누적 KPI |
| 출처 비율(:287-302) | `assembleBySource(rows)` | 챗봇·통합 분포 |
| 채널 비율(:307-312) | `assembleByChannel(sessionCountsByChannel: Map)` | 챗봇·통합 분포 |

- **챗봇 스코프의 세션 계산 방식은 바꾸지 않는다** — 여전히 `groupBy(['dayBucket','channelType','sessionId'])` + `foldSessionCountsByBucket()`(`usage-trend.ts:87-89`)로 `Map`을 만들고 그 `Map`을 조립 함수에 넘긴다. 통합 스코프는 같은 형태의 `Map`을 **SQL 결과로** 만든다(§5.3). 조립 함수는 `Map`의 출처를 모른다.
- 리팩터링의 수용 조건은 **기존 통계·대시보드 테스트 무수정 통과**(AC-I6-1)와 **AC-I2-1**(챗봇 1개 그룹 = 챗봇 수치 — 두 세션 경로의 동치 증명).
- 그대로 재사용(무변경): `buildBuckets`·`foldDayRows`·`dayBucketToBucketKey`(`bucket.ts`), `classifyResponseSource`, `foldByHour`·`foldByWeekday`(`usage-trend.ts:21-49`), `computeResponseRates`·`computeVisitCount`·`aggregateTopQuestions`(`dashboard-aggregator.ts`), `resolveStatsPeriod`·`parseGranularity`(`stats-period.ts`).
- 타임아웃: `runWithAggregationTimeout()`(기존 `withTimeout` :443-462 이동) — 5초·`503 AGGREGATION_TIMEOUT`·캐시 반환 금지 그대로(FR-I7-3). 요청당 쿼리 묶음 1개를 감싼다.

### 5.3 ★ 세션 distinct 원시 SQL 확장 (FR-I7-2, NFR-IP3, ADR-0017 §4 탈출구 이행)

**왜 원시 SQL인가**: 챗봇 스코프의 `groupBy([... 'sessionId'])`는 반환 행 수가 **세션 수에 비례**한다(ADR-0017 §4가 인정한 카디널리티 리스크). 그룹(100만 행)·전역(300만 행) 스코프에서 세션 행을 앱으로 끌어오면 NFR-IP3을 만족할 수 없다. Prisma는 `COUNT(DISTINCT)`를 지원하지 않는다(ADR-0001 감수 비용).

**설계 원칙**
1. **버킷 키 규칙은 TS 1곳에 남긴다** — ISO 주차·KST 달력월 규칙을 SQL로 재구현하지 않는다(DB 날짜 함수 금지 — 개발명세서 §5 DB 이식성). 대신 `buildBucketDayRanges(from, to, granularity)`(= `buildBuckets()` 결과의 각 버킷을 `[toKstDayBucket(start), toKstDayBucket(end)]` 문자열 범위로 변환)가 만든 범위 목록을 **`CASE WHEN "dayBucket" >= ? AND "dayBucket" <= ? THEN ? … END`** 로 파라미터 바인딩한다. `dayBucket`은 `YYYY-MM-DD` 고정 폭이라 문자열 비교 = 날짜 비교다(ADR-0017 §1). → **주/월 세션 = 일 버킷의 합집합(DD-61)이 DB의 `COUNT(DISTINCT)`로 정확히 보존된다**(자정을 넘는 세션 1회 계산 — AC-I2-3).
2. **세션 키 = `"chatbotId" || '|' || "sessionId"`** — 그룹·전역 스코프에서 서로 다른 챗봇의 세션은 별개다(FR-I3-7). 위젯이 슬러그별 UUID를 발급하지만(`apps/widget/src/core/session.ts`) `sessionId`는 클라이언트가 보내는 값이므로 **정의로 보장**한다. 단일 챗봇에서는 `sessionId` distinct와 동치 → AC-I2-1 성립.
3. **`sessionId IS NULL` 행은 각 1세션**(ADR-0001) — `SUM(CASE WHEN "sessionId" IS NULL THEN 1 ELSE 0 END)`.
4. **공통 문법만**: 서브쿼리 + `CASE` + `COUNT(DISTINCT)` + `||` + `SUM` — SQLite/Postgres 모두 동작. `GROUP BY`는 서브쿼리 별칭으로 한다(서수·표현식 반복 불필요). 식별자는 코드 상수(닫힌 enum → 컬럼명 매핑)이며 **사용자 입력은 전부 바인딩 파라미터**다(`Prisma.sql`/`Prisma.join` — `$queryRawUnsafe` 금지, R-7). Postgres에서 `CASE … THEN $n`이 `unknown` 타입 추론 오류를 내면 `CAST($n AS TEXT)`로 감싼다(이식성 메모).
5. **격리**: 이 SQL은 `stats/integrated/integrated-session.query.ts` **1파일**에만 있다. 원시 SQL 보유 파일은 `stats.service.ts`(대시보드 1건 — 무변경)와 이 파일 2개다(R-7). 결과 BigInt/number는 `Number()` 정규화(`SessionCountRow` 선례 — `stats.service.ts:41-44`).

**빌더 계약**

```ts
// integrated-session.query.ts
type SessionGroupKey = 'NONE' | 'BUCKET' | 'CHANNEL' | 'CHATBOT' | 'GROUP';
interface SessionCountRequest {
  scope: ResolvedScope;
  period?: { fromDayBucket: string; toDayBucket: string };      // 누적 KPI는 생략
  groupBy: SessionGroupKey;
  bucketRanges?: Array<{ key: string; fromDay: string; toDay: string }>;  // groupBy='BUCKET'일 때 필수
  excludeChatbotIds?: string[];                                   // 사용하지 않는다(세션은 토글 대상 아님) — 예약하지 않음
}
interface SessionCountRow { key: string | null; distinctSessions: number; nullSessions: number }
buildSessionCountSql(req): Prisma.Sql          // 순수(단위 테스트 — 파라미터 개수·바인딩 순서·식별자 화이트리스트)
IntegratedSessionQuery.count(req): Promise<SessionCountRow[]>
```

**생성 SQL 예 (GROUP 스코프 · 주 단위 요약)**

```sql
SELECT t."k" AS "key",
       COUNT(DISTINCT t."sk") AS "distinctSessions",
       SUM(t."ns")            AS "nullSessions"
FROM (
  SELECT CASE
           WHEN "dayBucket" >= $1 AND "dayBucket" <= $2 THEN $3      -- '2026-09-01'..'2026-09-06' → '2026-W36'
           WHEN "dayBucket" >= $4 AND "dayBucket" <= $5 THEN $6      -- …(버킷 수만큼, 최대 92개)
         END AS "k",
         CASE WHEN "sessionId" IS NOT NULL THEN "chatbotId" || '|' || "sessionId" END AS "sk",
         CASE WHEN "sessionId" IS NULL THEN 1 ELSE 0 END AS "ns"
  FROM "conversation_logs"
  WHERE "groupId" = $g                                  -- ALL 스코프면 이 줄 없음
    AND "dayBucket" >= $from AND "dayBucket" <= $to
) t
GROUP BY t."k"
```

| `groupBy` | 소비 | `k` 식 | 반환 행 상한 |
|---|---|---|---|
| `NONE` | 요약 기간 총 세션 · 누적 KPI(기간 없음) | (없음 — `GROUP BY` 생략) | 1 |
| `BUCKET` | 요약 버킷별 세션 | 위 `CASE` | 버킷 수(≤92) |
| `CHANNEL` | 분포 채널별 세션 | `"channelType"` | 채널 수(≤8) |
| `CHATBOT` | GROUP 기여 표 | `"chatbotId"` | 그룹에 로그를 남긴 챗봇 수 |
| `GROUP` | ALL 기여 표 | `"groupId"` | 그룹 수(+ `''` 1행) |

→ **반환 행 수는 세션 수와 무관**하다(AC-I6-7: `BUCKET`·`CHANNEL`은 버킷 수 × 채널 수 이하). 바인딩 파라미터는 최대 3×92+4 = 280개(SQLite 상한 32,766 미만).

### 5.4 엔드포인트별 쿼리 계획

모든 쿼리 묶음은 `Promise.all` 병렬 + `runWithAggregationTimeout` 1회로 감싼다.

| 엔드포인트 | 쿼리 | 조립(순수 함수) |
|---|---|---|
| **overview**(기간 없음) | ① `groupBy(['isAnswered','blockedByFilter'])` where `scopeLogWhere` ② `aggregate({ _min: { dayBucket } })` where `scope + dayBucket ≠ ''` ③ 세션 `NONE`(기간 없음) ④ `chatbot.groupBy(['status'])` where GROUP이면 `{ groupId }`, ALL이면 전체 ⑤ `findFirst({ groupId: '' })`(백필 잔여) | `computeResponseRates` · `computeVisitCount` · `computeTurnsPerSession` |
| **summary** | ① `groupBy(['dayBucket','isAnswered','blockedByFilter'])` ② 세션 `BUCKET` ③ 세션 `NONE`(기간) ④ 백필 잔여 | `buildBuckets` · `foldDayRows` · `assembleSummaryBuckets` · `computeVisitCount` · `computeTurnsPerSession` |
| **distribution** | ① `groupBy(['matchedNodeId','matchedFaqId','isAnswered','answeredByRag'])` ② `groupBy(['hourBucket'])` ③ `groupBy(['dayBucket','isAnswered'])` ④ 세션 `CHANNEL` ⑤ 백필 잔여 | `assembleBySource` · `foldByHour` · `foldByWeekday` · `assembleByChannel` |
| **questions** | ① `groupBy(['userMessage'])` take 500 ② 같은 조건 + `isAnswered=false, blockedByFilter=false` take 500 ③ (GROUP·ALL 공통) 귀속 조회 — §5.6 ④ 백필 잔여 | `aggregateTopQuestions` · `attributeTopChatbot` |
| **breakdown** | GROUP: ① `groupBy(['chatbotId','isAnswered'])` ② 세션 `CHATBOT` ③ `chatbot.findMany({ where: { OR: [{ id: { in: 로그 기여 챗봇 } }, { groupId }] } })` + 현재 그룹명 / ALL: ① `groupBy(['groupId','isAnswered'])` ② 세션 `GROUP` ③ `chatbotGroup.findMany()`(보관 포함, 전체) ④ 백필 잔여 | `assembleBreakdown` · `allocateShares` · `computeResponseRates` |
| **groups**(선택기) | `chatbotGroup.findMany({ include: _count chatbots })` 보관 포함 · 상한 1,000 | 활성(생성일 오름차순) → 보관(보관일 내림차순) 정렬 |

- 질문 순위의 `where`에는 `blockedByFilter=false` 조건이 미응답 순위에만 붙는다(No.14 규칙 그대로 — EX-I-14).
- 백필 잔여 확인(`findFirst({ where: { groupId: '' }, select: { id: true } })`)은 `(groupId, dayBucket)` 인덱스로 1행 탐색이다. **스코프와 무관하게 전역 값**이다(어느 그룹의 행인지 알 수 없으므로).

### 5.5 기여 표 (J-7 · FR-I3-5/6)

```ts
// stats/lib/breakdown.ts
export function allocateShares(counts: number[], scale = 10_000): number[]
//  최대 잔여법(Hamilton): floor(count/total*scale)를 먼저 배분하고, 남은 단위를 소수부 큰 순(동률 = 입력 순서)으로 1씩 배분.
//  total = 0이면 전부 0. 결과 단위 합 = scale 정확히(AC-I2-6). share = units / scale (소수 4자리).
export function assembleBreakdown(rows: BreakdownInputRow[], opts: { maxRows: 200 }): { items, othersRow, unassignedRow }
```
- **항목 구성**: GROUP = (그 그룹에 로그를 남긴 챗봇) ∪ (현재 소속 챗봇 — 기간 내 0턴이어도 0으로 표시). ALL = (기간 내 로그가 있는 그룹 — 보관·미존재 포함) ∪ (활성 그룹 전체). `groupId=''` 행은 그룹 목록에 넣지 않고 **`unassignedRow`**(백필 대기분)로 분리한다.
- **정렬**: `turnCount desc → name asc → id asc`(결정론). 화면 정렬은 클라이언트(`aria-sort`).
- **상한**: 정렬 후 200행 + 나머지는 `othersRow { count: n, turnCount, answeredCount, unansweredCount, sessionCount }`. 비중은 `items ∪ othersRow ∪ unassignedRow` 전체에 대해 `allocateShares` → 합 = 1(AC-I2-7: 행 턴 합 = 요약 턴 합).
- **행 필드**: `turnCount`·`answeredCount`·`unansweredCount`(= turn − answered, 차단 포함 — 요약과 같은 정의)·`responseRate`(`computeResponseRates`)·`sessionCount`·`share`. GROUP 행 추가: `status`·`archivedAt`·`currentGroupId`/`currentGroupName`(현재 소속 ≠ 스코프 그룹일 때만 — "현재: 사업자 서비스"). ALL 행 추가: `archived`·`archivedAt`·`missing`(그룹 행 없음).
- **세션 합의 성질**: 챗봇 행 세션은 세션 키에 `chatbotId`가 포함돼 서로 겹치지 않으므로 합 = 그룹 세션(단, 한 세션이 그룹 이동 경계를 넘으면 두 그룹 행에 1씩 — ALL 기여 표 세션 합 ≥ 전역 세션일 수 있다). 캡션에 명시한다.

### 5.6 질문 순위와 최다 챗봇 (J-9 · FR-I3-8/9 · P-5)

1. 후보 조회·병합은 챗봇 스코프와 **완전히 같다** — `groupBy(['userMessage'])` take 500 → `aggregateTopQuestions(rows, topN)`(`dashboard-aggregator.ts:30-52`). `approximated = 후보 행 수 ≥ 500`(AC-I5-3).
2. **최다 챗봇 귀속**(GROUP·ALL): 후보 500행 중 **최종 topN 질문으로 정규화되는 원문 변형들**을 `normalizeQuestion`(export만 추가 — 규칙 1벌)으로 모은 뒤, `groupBy(['userMessage','chatbotId'])` where `스코프 + 기간 + userMessage IN (변형들)`(≤500 파라미터) 1회 → `attributeTopChatbot(variantsByQuestion, rows)`가 질문별 챗봇 합산 최댓값(동률 = 최근 발생 → chatbotId asc)을 고른다. 챗봇 이름은 `chatbot.findMany({ id in })` 1회(N+1 금지). 결과는 후보 병합 기준의 근사이며 `approximated`를 공유한다(FR-I3-9).
3. **`includeArchivedChatbots=false`**(기본 `true`): 현재 `ARCHIVED`인 챗봇 id 목록을 1회 조회해 ①②③ 쿼리에 `chatbotId: { notIn: [...] }`를 더한다. **누적 KPI·요약·분포·기여 표에는 이 파라미터가 없다**(J-9 — 합계에서 빼는 옵션이 있으면 "보관해도 누적 유지"가 화면 설정 하나로 깨진다). AC-I5-2.
4. `unansweredQuestionId` 딥링크는 **통합 스코프에 없다** — 학습 큐는 챗봇 스코프이며, 대신 `topChatbotId`로 그 챗봇의 통계·학습현황 화면으로 이동한다.
5. 저장값은 이미 마스킹된 문자열이다(ADR-0013) — 새 원문 저장소를 만들지 않는다(FR-0-92). 서버 로그에 질문 텍스트를 남기지 않는다(NFR-IS2).

### 5.7 누적 KPI 정의 (J-8 · FR-I3-4)

- 기간 파라미터를 **받지 않는다**(보내면 zod strip — 무시). 범위 = 스코프 내 전 로그.
- `firstDayBucket` = `MIN(dayBucket)`(센티넬 `''` 제외) · 로그 0건이면 `null`, 모든 수치 0, 응답률 0(AC-I2-5).
- 미래 `dayBucket`(시계 변경 — EX-I-18)도 누적에 포함된다.
- `chatbotCounts { active, draft, archived }` = **현재 소속 챗봇**의 상태별 수(ALL = 전체 챗봇). 과거에 이 그룹에 로그를 남기고 떠난 챗봇은 여기서 세지 않고 기여 표에 "현재: 다른 그룹"으로 나타난다.

### 5.8 서버 로그

통합 통계 요청마다 `scope`·`groupId`·엔드포인트·소요 ms·결과 코드만 debug 로그로 남긴다. 질문 텍스트·세션 ID·챗봇 이름을 남기지 않는다(NFR-IS2).

---

## 6. 의도별 매칭 통계 — 챗봇 스코프 (J-13 · P-6)

- `GET /stats/intents?chatbotId&from&to&topN` — `chatbot:read` · `ARCHIVED` 허용 · 미존재 `404` · 기간 규칙 = `getDistribution`과 같이 DAY 기본 기간(`resolveStatsPeriod`, 상한 `STATS_MAX_RANGE_DAYS`).
- 쿼리 2개: ① `groupBy(['matchedIntentId','isAnswered'])` where `{ chatbotId, dayBucket 범위 }` — `null` 그룹이 "의도 미매칭" ② `intent.findMany({ where: { chatbotId, id: { in: 등장 id } }, select: { id, name } })` 1회(N+1 금지 — FR-I4-2).
- 순수 함수 `foldIntentStats(rows, names, topN)`(`lib/intent-stats.ts`): 의도별 `turnCount`·`answeredCount`·`responseRate`(`computeResponseRates`)·`shareOfAll`(= turn / 전체 턴)·`shareOfIntentMatched`(= turn / 의도 매칭 턴), 이름이 없으면 `name: null, deleted: true`(AC-I5-5). 정렬 `turnCount desc → intentId asc`, 상위 `topN`(기본 10·최대 50) + `othersTurnCount` + `unmatchedTurnCount`(AC-I5-6) + `distinctIntentCount`.
- 다른 챗봇의 같은 이름 의도가 섞이지 않도록 이름 해석도 `chatbotId`로 한정한다. 버전 스냅샷에서 과거 이름을 찾지 않는다(§16).
- 그룹/전역 스코프에는 제공하지 않는다(FR-I4-5). FAQ·노드별 순위는 같은 패턴으로 확장 가능하나 범위 밖.

---

## 7. KST 헬퍼 통합 (J-11)

**현황**: KST 헬퍼가 세 곳에 있다 — ① `packages/shared-types/src/common.ts:182-207`(`toKstDayBucket`·`toKstHourOfDay`·`toKstWeekday` — 적재·백필·웹) ② `stats/lib/kst-date.ts:8-36`(달력 산술) ③ `stats/lib/dashboard-period.ts:1-2,13-27`(②와 **글자 수준으로 같은** `KST_OFFSET_MINUTES`·`MS_PER_DAY`·`KstDateOnly`·`toKstDateOnly`·`kstDateOnlyToUtc` 재정의).

**결정**
1. ③의 재정의를 삭제하고 `import { KstDateOnly, MS_PER_DAY, toKstDateOnly, kstDateOnlyToUtc } from './kst-date'`. `MAX_PERIOD_DAYS`(:3)·`ResolvedPeriod`·`InvalidPeriodError`·`resolveDashboardPeriod` 본문(:35-62)·오류 문구·366일 상한은 **바이트 단위로 불변**(FR-I5-1). 수용 조건: `dashboard-period.spec.ts` 무수정 통과 + 대시보드 AC(AC-2-\*, AC-14A-9) 회귀 0(AC-I6-4).
2. ①과 ②는 **역할이 다르므로 합치지 않는다** — ①은 적재 시점 문자열 확정(워크스페이스 4곳 공용), ②는 `apps/api` 통계 내부 달력 산술. 대신 **동치를 계약 테스트로 고정**한다: `kst-date.contract.spec.ts` — 고정 시드 의사난수(LCG) 1,000개 + 경계(KST 00:00:00.000·23:59:59.999, UTC 14:59:59.999/15:00:00.000, 12/31→1/1, 2/28→2/29→3/1 윤년, 1970-01-01)에 대해 `formatDayBucket(toKstDateOnly(d)) === toKstDayBucket(d)`(FR-I5-2, AC-I6-5). `Math.random` 금지(재현성).
3. **대시보드의 `createdAt` 범위 필터는 바꾸지 않는다**(FR-I5-3 — ADR-0017 84행 기각 유지).
4. 통합 통계 신규 코드는 KST 계산을 재정의하지 않는다 — 정적 검사 R-5b(§11).
5. 주석 정정: `common.ts:179-180`("의도적으로 분리")·`stats-period.ts:17-18`("의도적 중복")을 "No.29에서 통합 — 동치는 `kst-date.contract.spec.ts`"로.

---

## 8. API 계약

### 8.1 엔드포인트 (전부 `GET` · `@RequirePermission('chatbot:read')` · 읽기 전용)

| # | 경로 | 쿼리 스키마 | 응답 스키마 | 비고 |
|---|---|---|---|---|
| 1 | `/stats/integrated/overview` | `IntegratedOverviewQuerySchema` | `IntegratedOverviewSchema` | 누적 KPI(기간 없음) |
| 2 | `/stats/integrated/summary` | `IntegratedStatsQuerySchema` | `IntegratedSummarySchema` | 기간 요약 + 시계열 |
| 3 | `/stats/integrated/distribution` | `IntegratedDistributionQuerySchema` | `IntegratedDistributionSchema` | 출처·채널·시간대·요일 |
| 4 | `/stats/integrated/questions` | `IntegratedQuestionsQuerySchema` | `IntegratedQuestionsSchema` | 질문 순위 + 최다 챗봇 |
| 5 | `/stats/integrated/breakdown` | `IntegratedStatsQuerySchema` | `IntegratedBreakdownSchema` | GROUP=챗봇별 / ALL=그룹별 |
| 6 | `/stats/integrated/groups` | (없음) | `IntegratedGroupOptionsSchema` | 스코프 선택기(보관 그룹 포함) — §18 D-1 |
| 7 | `/stats/intents` | `IntentStatsQuerySchema` | `IntentStatsSchema` | 챗봇 스코프(`StatsController`에 추가) |

- **기존 `/stats/dashboard|summary|distribution|questions` 요청·응답·오류 문구 불변**(FR-0-90).
- `@Public()` 추가 0건(6곳 유지) · 신규 권한 0종 · 아웃바운드 HTTP 0건 · 신규 환경변수 0개(FR-0-93).
- 컨트롤러는 `@Controller('stats/integrated')` 별도 클래스 — 기존 `StatsController`에 경로 파라미터가 없어 라우트 충돌이 없다.

### 8.2 `packages/shared-types/src/stats.ts` append

```ts
/* ---------------- No.29 통합 통계(integrated-stats-설계.md §8, ADR-0033) ---------------- */
export const StatsScope = z.enum(['ALL', 'GROUP']);
export type StatsScope = z.infer<typeof StatsScope>;

export const INTEGRATED_STATS_LIMITS = { breakdownMaxRows: 200, groupOptionsMax: 1000 } as const;   // 코드 상수(환경변수 아님)

/** 스코프 규칙(EX-I-2): GROUP이면 groupId 필수, ALL이면 groupId 금지(무시가 아니라 거부) → VALIDATION_FAILED */
const scopeFields = { scope: StatsScope.default('ALL'), groupId: z.string().uuid().optional() };
function refineScope<T extends z.ZodRawShape>(shape: T)            // z.object(shape).superRefine(...) 반환 헬퍼
export const IntegratedOverviewQuerySchema     = refineScope({ ...scopeFields });
export const IntegratedStatsQuerySchema        = refineScope({ ...scopeFields, from: z.coerce.date().optional(), to: z.coerce.date().optional(),
                                                               granularity: z.string().trim().min(1).optional() });   // ⚠ enum 아님 — INVALID_GRANULARITY 규약(StatsQuerySchema 선례)
export const IntegratedDistributionQuerySchema = refineScope({ ...scopeFields, from: …, to: … });
export const IntegratedQuestionsQuerySchema    = refineScope({ ...scopeFields, from: …, to: …,
                                                               topN: z.coerce.number().int().min(1).max(STATS_LIMITS.topNMax).default(STATS_LIMITS.topNDefault),
                                                               includeArchivedChatbots: queryBoolean().default(true) });   // "false" → false(명시 파서)

/** 모든 통합 응답 공통 메타(FR-0-95) */
export const IntegratedScopeMetaSchema = z.object({
  scope: StatsScope,
  groupId: z.string().uuid().nullable(),
  /** groupId='' 로그가 남아 있으면 true(FR-I2-4). 전역 값 */
  backfillPending: z.boolean(),
  generatedAt: z.coerce.date(),
  timezone: z.literal('Asia/Seoul'),
});

export const IntegratedOverviewSchema = IntegratedScopeMetaSchema.extend({
  group: z.object({ id, name, createdAt, archivedAt: z.coerce.date().nullable() }).nullable(),   // ALL이면 null
  totals: StatsSummarySchema.shape.totals,                // 필드 재사용(turn·answered·unanswered·blocked·rate×2·session·basis·turnsPerSession)
  firstDayBucket: z.string().nullable(),
  chatbotCounts: z.object({ active: nonneg int, draft: nonneg int, archived: nonneg int }),
});
export const IntegratedSummarySchema      = StatsSummarySchema.merge(IntegratedScopeMetaSchema);       // 기존 필드 그대로 + 메타
export const IntegratedDistributionSchema = StatsDistributionSchema.merge(IntegratedScopeMetaSchema);  // 기존 차트 컴포넌트가 그대로 소비
export const IntegratedQuestionItemSchema = z.object({ question: z.string(), count: nonneg int,
                                                       topChatbotId: z.string().uuid().nullable(), topChatbotName: z.string().nullable() });
export const IntegratedQuestionsSchema = StatsPeriodMetaSchema.merge(IntegratedScopeMetaSchema).extend({
  topQuestions: z.array(IntegratedQuestionItemSchema),
  topUnansweredQuestions: z.array(IntegratedQuestionItemSchema),
  approximated: z.boolean(), candidateLimit: z.number().int().positive(),
  includeArchivedChatbots: z.boolean(),
});
const BreakdownMetricsSchema = z.object({ turnCount, answeredCount, unansweredCount, sessionCount /* nonneg int */,
                                          responseRate: z.number().min(0).max(1), share: z.number().min(0).max(1) });
export const IntegratedBreakdownItemSchema = z.discriminatedUnion('kind', [
  BreakdownMetricsSchema.extend({ kind: z.literal('CHATBOT'), id, name: z.string(), status: ChatbotStatus,
                                  archivedAt: z.coerce.date().nullable(),
                                  currentGroupId: z.string().uuid().nullable(), currentGroupName: z.string().nullable() }),
  BreakdownMetricsSchema.extend({ kind: z.literal('GROUP'), id, name: z.string().nullable(), createdAt: z.coerce.date().nullable(),
                                  archived: z.boolean(), archivedAt: z.coerce.date().nullable(), missing: z.boolean() }),
]);
export const IntegratedBreakdownSchema = StatsPeriodMetaSchema.merge(IntegratedScopeMetaSchema).extend({
  items: z.array(IntegratedBreakdownItemSchema),
  othersRow: BreakdownMetricsSchema.extend({ count: z.number().int().positive() }).nullable(),
  unassignedRow: BreakdownMetricsSchema.nullable(),         // groupId='' 백필 대기분(ALL 스코프에서만 채워진다)
  totals: z.object({ turnCount: nonneg int, sessionCount: nonneg int }),
  shareScale: z.literal(10000),                              // 비중 합 검증 단위(AC-I2-6)
});
export const IntegratedGroupOptionsSchema = z.object({
  items: z.array(z.object({ id, name, createdAt, archivedAt: z.coerce.date().nullable(), chatbotCount: nonneg int })),
  truncated: z.boolean(),
});

/** 챗봇 스코프 의도별 매칭(J-13) */
export const IntentStatsQuerySchema = z.object({ chatbotId: z.string().uuid(), from: …, to: …,
                                                 topN: z.coerce.number().int().min(1).max(STATS_LIMITS.topNMax).default(STATS_LIMITS.topNDefault) });
export const IntentStatsItemSchema = z.object({ intentId: z.string().uuid(), name: z.string().nullable(), deleted: z.boolean(),
                                                turnCount, answeredCount /* nonneg int */, responseRate, shareOfAll, shareOfIntentMatched /* 0..1 */ });
export const IntentStatsSchema = StatsPeriodMetaSchema.extend({
  chatbotId: z.string().uuid(), generatedAt: z.coerce.date(),
  totalTurnCount, matchedTurnCount, unmatchedTurnCount, othersTurnCount, distinctIntentCount /* nonneg int */,
  items: z.array(IntentStatsItemSchema),
});
// + 각 스키마의 z.infer 타입 export
```

- `StatsPeriodMetaSchema.granularity`는 분포·질문·의도에서 항상 `'DAY'`(기존 규약 그대로).
- 신규 파일을 만들지 않는다 — 통계 관심사 동일(ADR-0003 §9 배치 규칙).

### 8.3 오류 (신규 `ApiErrorCode` 0종 — FR-0-94)

| 상황 | 코드 |
|---|---|
| `scope=GROUP` + `groupId` 누락 / `scope=ALL` + `groupId` 지정 / 형식 오류 | `400 VALIDATION_FAILED`(EX-I-2) |
| 존재하지 않는 `groupId` / `chatbotId` | `404 NOT_FOUND`(보관 그룹·보관 챗봇은 조회 허용) |
| 기간 역전 · 상한 초과 · 잘못된 단위 | `400 INVALID_PERIOD` · `STATS_RANGE_TOO_WIDE` · `INVALID_GRANULARITY`(No.14와 같은 헬퍼 — 문구 동일) |
| 5초 초과 | `503 AGGREGATION_TIMEOUT`(캐시·이전 값 반환 금지) |
| 비로그인 / 권한 없음 | `401` / `403`(가드 — 존재 판정보다 먼저) |

### 8.4 요구사항 초안(§5.3~5.4)과 다른 점

| # | 초안 | 확정 | 이유 |
|---|---|---|---|
| D-1 | 엔드포인트 6개 | **7개**(`/stats/integrated/groups` 추가) | 선택기는 **보관 그룹 포함 전체 그룹**이 필요하나 `GET /chatbot-groups`는 보관 그룹을 숨기게 된다(P-4). 기여 표(ALL)는 "기간 내 로그 있는 그룹"만 담아 선택기 원천이 될 수 없다. 페이지네이션 대신 상한 1,000 + `truncated`(선택기 옵션 — 목록 규약 예외, §4.1 "항목 수 고정 목록" 예외와 같은 성격) |
| D-2 | `IntegratedSummarySchema` = 기존 + `scope`·`groupId?`·`backfillPending` | + `generatedAt`·`timezone`을 공통 메타로 | FR-0-95. `groupId`는 `nullable`로 통일(선택 필드보다 분기가 적다) |
| D-3 | `IntegratedBreakdownSchema` `status?｜archived?` 혼합 | `kind` 판별 유니온 | 프런트 분기 명확화 · `missing`(그룹 행 없음) 추가 |
| D-4 | 기여 표 보관일 | `Chatbot.archivedAt` 컬럼 신설 | 보관 시각이 데이터에 없다(감사로그 역산은 No.13 이전 보관을 복원 못 하고 통계가 감사 도메인을 읽게 된다) |
| D-5 | `ChatbotGroup` DTO에 `archivedAt?` | **추가하지 않음** | 그룹 API는 보관 그룹을 반환하지 않으므로 항상 `null`인 필드가 된다. 보관 정보는 통계 선택기 응답에만 있다 |
| D-6 | 전역 `dayBucket` 인덱스 "실측 판단" | **채택** | §3.4 — Postgres skip-scan 부재로 이식성 있는 판단 |
| D-7 | 질문 순위 딥링크 | 통합 스코프에는 `unansweredQuestionId` 없음, `topChatbotId`로 대체 | 학습 큐가 챗봇 스코프 |

---

## 9. 권한 (J-10 · P-7)

- 7개 핸들러 전부 `@RequirePermission('chatbot:read')`. `Permission` 유니온 **15종 불변** · `ROLE_PERMISSIONS` 불변 · `@Public()` **6곳** 불변(AC-I6-3).
- **`stats:read`를 신설하지 않는 근거**: 세 역할 모두 `chatbot:read`를 가지며(`shared-types/src/security.ts:48` — VIEWER 읽기 4종 포함), `chatbot:read` 보유자는 이미 **모든 챗봇의 통계를 개별로** 볼 수 있다(그룹별 접근 제한 없음 — ADR-0015 48행). 합산 화면은 새 정보를 노출하지 않고, 신설해도 3역할 모두에 부여하게 되어 **판정 차이 0**이다.
- **재검토 트리거**: 그룹별 접근 제한/멀티테넌시 도입(No.45) — 그때는 통합 통계의 스코프 필터가 "허용된 그룹 집합"을 받아야 하며, `scopeLogWhere()` 1곳이 교체 지점이다.

---

## 10. 감사로그

| 동작 | 감사 | 비고 |
|---|---|---|
| 통합 통계·의도별 통계 조회 | **없음** | 읽기(기존 통계와 동일) |
| 그룹 삭제 — 물리 삭제 | `DELETE` / `ChatbotGroup`(현행) | 불변 |
| 그룹 삭제 — **보관** | `DELETE` / `ChatbotGroup` + `after`(archivedAt 포함) + summary `그룹 보관(통계 보존)` | **신규 `AuditAction`·`AuditTargetType` 0종** — 사용자 의도는 "삭제"이고 결과만 다르다 |
| 챗봇 보관·상태 변경 | 현행(`DELETE`·`STATUS_CHANGE`) | `archivedAt` 동기화는 같은 쓰기 안에서 일어난다 |
| 백필 스크립트 | 없음 | 운영 스크립트(사용자 동작 아님 — `backfill-conversation-buckets.ts` 선례) |

`RequestContextService.get()` 호출 지점은 여전히 `AuditLogService` 1곳이다.

---

## 11. 봉인 · 정적 검사 — `stats/lib/stats-retention-sealing.spec.ts` (J-3 · FR-I1-3 · NFR-IS3)

검사 대상: `apps/api/src/**/*.ts` 중 `*.spec.ts`·`src/integration/**` 제외(주석 제거 후 검사 — 기존 `*-sealing.spec.ts` 유틸 재사용). `prisma/`(seed·scripts)는 `src` 밖이라 자연히 제외된다.

| # | 단언 | 막는 것 |
|---|---|---|
| R-1 | `\.conversationLog\s*\.\s*(delete|deleteMany)\b` **0건** | 로그 삭제 코드(트랜잭션 `tx.` 포함) |
| R-2 | `\.unansweredQuestion\s*\.\s*(delete|deleteMany)\b` **0건** | 미응답 원천 삭제(FR-I1-3 ②) |
| R-3 | `DELETE\s+FROM\s+"?(conversation_logs|unanswered_questions)"?` **0건**(대소문자 무시, 원시 SQL 문자열 포함) | 원시 SQL 우회 |
| R-4 | 허용 목록 상수 `LOG_DELETION_ALLOWLIST = [] as const`가 **빈 배열**이다 — 비우지 않으려면 이 파일과 ADR-0033을 함께 고쳐야 한다(FR-I1-4) | "편의상 허용 파일 추가" |
| R-5 | `schema.prisma`의 `ConversationLog`·`UnansweredQuestion` 모델에서 `chatbot` 관계가 `onDelete: Restrict`이고 파일 어디에도 이 두 모델에 `onDelete: Cascade|SetNull`이 없다 | DB 차원 연쇄 삭제 도입 |
| R-5b | `apps/api/src/stats/**`(`kst-date.ts` 제외)에 `KST_OFFSET_MINUTES\s*=`·`function toKstDateOnly`·`function kstDateOnlyToUtc` 정의 0건 | KST 헬퍼 재중복(FR-I5-4, AC-I6-4) |
| R-6 | `chatbots.service.ts`의 영구삭제 사전검사 목록에 `conversationLogs`·`unansweredQuestions` 키가 **존재**하고, `permanentDelete` 트랜잭션 블록에 두 모델의 삭제 호출이 없다 | 사전검사(409) 완화 — P-2 |
| R-7 | 원시 SQL(`$queryRaw`) 보유 파일 = `stats/stats.service.ts`·`stats/integrated/integrated-session.query.ts`·`health/health.controller.ts` **정확히 3개**, `stats/**`에 `$queryRawUnsafe`·`$executeRaw`·`$executeRawUnsafe` 0건 | 원시 SQL 확산·주입 경로(NFR-IM3) |
| R-8 | `stats/**`에 Prisma 쓰기 호출(`.create|createMany|update|updateMany|upsert|delete|deleteMany(`) 0건 | 통계의 부수효과(FR-0-92 — 캐시·복제 저장소 금지) |
| R-9 | `conversationLog\s*\.\s*(create|createMany)\b` 호출 파일 = `conversation/conversation-log.service.ts` **1개** | 적재 단일 지점(스냅샷·마스킹 우회) |
| R-10 | `conversationLog\s*\.\s*(update|updateMany|upsert)\b` **0건** | 적재 후 `groupId` 변경(소급 재귀속) — "그룹 이동 시 로그도 이동" 코드 |

**R-4가 요구하는 향후 규약(FR-I1-4, 이번 구현 없음)**: 로그를 지우는 기능(ADR-0002 "함께 삭제" 플로우 · No.45 보존기간 정리 · 파기 요청)은 **단일 서비스**로만 추가하며, 그 서비스는 **같은 트랜잭션에서** ① 대상 로그의 수치 롤업(`StatsRollupDaily` 가칭 — 키 `(chatbotId, dayBucket, channelType)` · `groupId` 스냅샷 · 턴·응답·차단·출처 5종·시간대 24칸·일 세션 수, **텍스트·세션 ID·의도 ID 없음**)을 적재한 뒤 ② 원천을 삭제한다. 그 시점에 통합 통계 조회는 "원천 ∪ 롤업"으로 바뀌고, `LOG_DELETION_ALLOWLIST`에 그 서비스 1파일만 추가된다(ADR-0033 §3).

---

## 12. 성능 예산 (NFR-IP)

### 12.1 목표

| 대상 | 기준 데이터(NFR-IP1) | P95 |
|---|---|---|
| overview(누적 KPI) | 그룹 100만 행 / 전역 300만 행 | **2초** |
| summary·distribution·breakdown — 일 30일 | 〃 | **1초** |
| summary·breakdown — 월 24개월 | 〃 | **2초** |
| questions | 〃 | **2초** |
| groups(선택기) | 그룹 1,000 | 300ms |
| 의도별(챗봇 스코프, 30일) | 챗봇 10만 행 | 1초(No.14 시계열 예산과 동일) |
| 공개 대화 경로 | — | **변화 측정 불가 수준**(NFR-IP4 — 필드 1개 추가·조회 0) |
| 백필 | 100만 행 | 10분 · 배치당 잠금 1초 미만(NFR-IP5) |
| 전 쿼리 | — | 5초 초과 → `503 AGGREGATION_TIMEOUT` |

### 12.2 측정 방법(test-automation 인계)

- 픽스처 생성 스크립트(테스트 전용, `src/integration/perf/` 또는 `prisma/scripts/perf-*`): 그룹 1개 = 챗봇 20개 · 2년 · 100만 행 / 전역 = 그룹 5개 300만 행. 세션 분포는 "세션당 평균 4턴 · 10%는 자정 경계" · 질문 종류 3,000(근사 경로 유도).
- 측정은 CI 기본 경로에서 제외하고(시간) 수동/야간 게이트로 돌린다 — 결과는 `docs/04-test`에 기록.
- 쿼리 계측으로 AC-I6-7(세션 쿼리 반환 행 수 ≤ 버킷 × 채널)을 단언한다.

### 12.3 미달 시 경로 — 재검토 트리거(FR-I7-4 · ADR-0033 §7)

1. **1차 완화(스키마 소변경)**: overview 세션 distinct가 병목이면 커버링 인덱스 `(groupId, dayBucket, chatbotId, sessionId)` 시도 — 쓰기 비용 측정과 함께.
2. **트리거 ①** 로그 1,000만 행 도달 **또는 ②** 1차 완화 후에도 NFR-IP2 미달 → **대안 C(상시 일 롤업, `PollingLoop` 재사용)** 재검토. 이때 세션 수는 주/월 정확 재현이 불가(DD-61)하므로 "세션 = 원천 조회 유지 + 나머지 롤업" 하이브리드부터 검토한다.
3. **트리거 ③** 로그 삭제 경로 도입(No.45·ADR-0002 함께 삭제·파기) → **대안 B(삭제 시 롤업 선적재)** 가 필수(§11 규약).

---

## 13. 관리자 콘솔 (ui-designer / frontend-implementer 인계)

- **위치(P-8)**: `/` = 통합 통계. `DashboardHomePage.tsx`의 안내 문구는 페이지 상단 보조 링크(챗봇 목록으로)로 축소 유지 가능. 상태는 URL 쿼리(`scope`·`groupId`·`granularity`·`from`·`to`·`includeArchivedChatbots`)로 보존 — 새로고침·공유·세션 만료 후 복원(EX-I-15).
- **스코프 선택기**: 원천 = `GET /stats/integrated/groups`. 활성 그룹 → 구분선 → "보관된 그룹" 구역. 이름 중복 시 생성일(또는 id 앞 8자리) 병기(EX-I-11). 키보드 조작 + 변경 결과 `aria-live="polite"`(NFR-IA3). `truncated`면 안내.
- **구성(FR-I8-3)**: ① 누적 KPI 카드 4종(누적 턴 · 누적 응답률 · 누적 세션(`visitCountBasis` 캡션) · 챗봇 수 운영/초안/보관) + "집계 시작일 YYYY-MM-DD" ② 기간 선택(`GranularityPeriodControl` 재사용) ③ 추이(`StatsTrendChart` 재사용 — `IntegratedSummary`가 `StatsSummary` 상위 호환) ④ 분포 4종(`ResponseSourceDistribution`·`ChannelDistribution`·`HourWeekdayPanel` 재사용 — `chatbotId` prop을 선택으로 바꾸고 없으면 학습현황 링크 숨김) ⑤ 기여 표(정렬 가능 `aria-sort`, 보관/현재 다른 그룹/보관된 그룹/알 수 없는 그룹 **텍스트 배지**, 행 클릭 → 챗봇 통계(`/chatbots/:id/stats/overview`) 또는 그룹 스코프, "기타 n개"·"정리 중(미귀속)" 행) ⑥ 질문 순위(보관 포함 토글 · 근사 안내 · 최다 챗봇 열).
- **차트 라이브러리 도입 없음**(FR-I8-4) — 다축 비교는 표로.
- **상태 구분(FR-I8-7)**: `backfillPending`("과거 데이터 정리 중 — 일부 대화가 그룹 집계에서 빠져 있습니다") · `approximated` · `503`("지금은 통계를 불러올 수 없습니다. 기간을 줄이거나 잠시 후 다시 시도해 주세요") · 0건(빈 상태 문구) — 각각 다른 안내. 빈 차트만 보여 주지 않는다.
- **확인 대화상자 문구(FR-I8-6)**: 보관 — "보관해도 이 챗봇의 대화 기록은 그룹 통계에 계속 포함됩니다" / 그룹 이동 — "이동 이후의 대화만 새 그룹에 집계됩니다. 이동 전 대화는 '{현재 그룹}' 통계에 남습니다" / 그룹 삭제 — "대화 기록이 있는 그룹은 목록에서 사라지지만 통합 통계에는 '보관된 그룹'으로 남습니다" / 영구삭제 409 — 서버 메시지 + "대화 기록이 있는 챗봇은 통계 보존을 위해 영구삭제할 수 없습니다. 보관 상태로 유지하세요".
- **챗봇 통계 화면(FR-I8-5)**: `/chatbots/:id/stats/overview`에 "의도별 매칭" 섹션을 **맨 뒤에** 추가(기존 섹션 순서·수치 불변). 두 분모 전환(기본 = 의도 매칭 턴 대비), 삭제된 의도는 "삭제된 의도(ID 앞 8자리)" · 링크 없음, 나머지는 의도 편집 화면(`/chatbots/:id/dialogue/intents` + 선택 상태)으로 링크.
- **접근성**: 모든 차트 표 대체(NFR-IA1) · 상태는 색 + 텍스트 배지(NFR-IA2) · axe 대비 위반 0(NFR-IA4). 사용자 화면에 "백필"·"스냅샷"·"센티넬" 같은 내부 용어를 쓰지 않는다.
- ROCHA 원본 "통합 통계" 화면 필드 확인은 ui-designer 단계에서(요구사항 조사 한계).

---

## 14. 시험 설계 포인트 (test-automation 인계)

| 층 | 대상 | 핵심 |
|---|---|---|
| 단위(순수) | `allocateShares` | 합 = scale 정확히(무작위 1,000세트 속성 테스트) · total 0 · 동률 결정론 |
| 〃 | `assembleBreakdown` | 200 + 기타 행 · 기타 행 합 · `unassignedRow` · 정렬 결정론 · 현재 다른 그룹 표시 |
| 〃 | `buildBucketDayRanges` | DAY/WEEK/MONTH 범위가 `dayBucketToBucketKey`와 **모든 날짜에서 일치**(속성 테스트 — 버킷 규칙 2벌 방지) · 부분 첫 주·월 |
| 〃 | `buildSessionCountSql` | 5개 `groupBy` 모드 · 스코프별 WHERE · 파라미터 바인딩(문자열 보간 0) · 식별자 화이트리스트 |
| 〃 | `attributeTopChatbot` · `foldIntentStats` · `archivedAtPatch` · `scopeLogWhere` | 동률 규칙 · 삭제된 의도 · 두 분모 · 상태 전이 3경우 · 상태 조건 부재 |
| 〃 | `kst-date.contract.spec.ts` | 1,000점 + 경계(AC-I6-5) |
| 정적 | `stats-retention-sealing.spec.ts` R-1~R-10 | **AC-I1-3 ★** — 임의 파일에 `conversationLog.deleteMany` 추가 시 실패하는지 역검증(픽스처 문자열로) |
| 통합 | 누적 보존 | **AC-I1-1 ★**(보관 전후 누적 동일 + `보관됨`·보관일) · AC-I1-2(영구삭제 409 불변) · AC-I1-4(3상태 합산) |
| 〃 | 정의 일치 | **AC-I2-1 ★**(챗봇 1개 그룹 = 챗봇 요약·분포 **전 필드 일치** — SQL 세션 경로 vs 앱 폴딩 경로의 동치) · AC-I2-2(A+B, 세션 비공유) · **AC-I2-3**(자정 걸친 세션 주 1회) · AC-I2-4(ALL = 그룹 합 + 미귀속) · AC-I2-5~7 |
| 〃 | 귀속 | **AC-I3-1 ★**(9/10 이동 전후 G1=100·G2=20, 이동 전 G1 수치 불변) · AC-I3-2(적재 `groupId` + **쿼리 계측으로 추가 조회 0**) · AC-I3-3(센티넬 → `backfillPending` → 백필 후 false·수치 증가) · AC-I3-4(백필 2회 멱등) · RAG 보류 턴의 `groupId` = 요청 시점 그룹(이동 후 완료해도) |
| 〃 | 그룹 보관 | AC-I4-1~4 · 보관 그룹 대상 지정 7경로 전부 `404` · 보관 그룹 통계 조회 허용 |
| 〃 | 질문·의도 | AC-I5-1~6 · `includeArchivedChatbots=false` 문자열 파싱 |
| 〃 | 비회귀 | **AC-I6-1 ★**(기존 통계·대시보드 스펙 **무수정** 통과 — 리팩터링 수용 조건) · AC-I6-2/3(VIEWER 200 · 비로그인 401 · 권한 15 · `@Public()` 6) · AC-I6-4(`dashboard-period.spec.ts` 무수정) |
| 성능 | NFR-IP | **AC-I6-6 ★**(예산 · 5초 초과 주입 → 503, 이전 값 미반환) · AC-I6-7(반환 행 수) |
| 화면 | 접근성 | AC-I6-8(키보드 · axe) · 상태 4종 구분 안내 |

**시험 데이터(`docs/04-test/시험데이터.md` 추가 제안)**: 그룹 이동 시나리오(이동 전/후 로그) · 보관 챗봇·보관 그룹 · 자정 걸친 세션 · 같은 질문 공백 변형 · 삭제된 의도 로그 · `groupId=''` 센티넬 행 · 성능 픽스처.

---

## 15. 요구사항 추적표

| 요구사항 | 설계 위치 |
|---|---|
| FR-0-88 엔진 무수정 | §2.3 |
| FR-0-89 순수 함수 재사용·복제 금지 | §5.2 · AC-I2-1 |
| FR-0-90 No.2/No.14 불변 | §2.5 · §5.2 · §7 · AC-I6-1 |
| FR-0-91 로그 삭제 경로 0건 | §11 R-1~R-4 |
| FR-0-92 새 원문 저장소 금지 | §5.6 ⑤ · §11 R-8 |
| FR-0-93 권한·공개·아웃바운드·환경변수 0 | §8.1 · §9 |
| FR-0-94 신규 오류코드 0 | §8.3 |
| FR-0-95 `timezone`·`generatedAt` | §8.2 `IntegratedScopeMetaSchema` |
| FR-I1-1~2 원천 직접 집계 · 상태 조건 없음 | §5.1 · §5.4 |
| FR-I1-3 정적 검사 | §11 |
| FR-I1-4 향후 삭제 규약 | §11 말미 · ADR-0033 §3 |
| FR-I1-5 보관·영구삭제 안내 | §3.6 · §13 |
| FR-I2-1 `groupId` + 인덱스 | §3.1 · §3.4 |
| FR-I2-2 `record()` 단일 지점 · 필수 파라미터 | §4.1 · §11 R-9 |
| FR-I2-3 백필 | §3.3 |
| FR-I2-4 `backfillPending` | §5.4 · §8.2 · §13 |
| FR-I2-5 이동 안내 | §13 |
| FR-I2-6/7 그룹 보관·제외 | §4.3 |
| FR-I2-8 소급 재귀속 없음 | §3.3 |
| FR-I3-1/2 스코프 · 판정 1곳 | §5.1 |
| FR-I3-3 기간 규칙 | §5.2 · §8.3 |
| FR-I3-4 누적 KPI | §5.7 |
| FR-I3-5/6 비중 합 1 · 상한 200 | §5.5 |
| FR-I3-7 세션 정의 | §5.3 ②③ |
| FR-I3-8/9 보관 토글 · 최다 챗봇 근사 | §5.6 |
| FR-I4-1~5 의도별 | §6 |
| FR-I5-1~4 KST 통합 | §7 · §11 R-5b |
| FR-I6-1/2 권한 | §9 · ADR-0015 갱신 각주 |
| FR-I7-1 인덱스 적중 | §3.4 |
| FR-I7-2 원시 SQL 세션 | §5.3 |
| FR-I7-3 타임아웃 공유 | §5.2 |
| FR-I7-4 롤업 트리거 | §12.3 · ADR-0033 §7 |
| FR-I8-1~7 콘솔 | §13 |
| NFR-IP1~5 | §12 |
| NFR-IS1~4 | §9 · §5.8 · §11 · 개발명세서 §5 보안 리스크 항목(patches A-16) |
| NFR-IA1~4 | §13 |
| NFR-IM1~4 | §2.1 lib · §5.2 · §5.3 ⑤ · §2.5 |
| AC-I1~I6 | §14 |
| EX-I-1~4 | §8.3 |
| EX-I-5 · 7 | §5.4 · §4.1 |
| EX-I-6 · 8 | §3.3 · §4.1 |
| EX-I-9 | §3.5(배지만 변경 — 합계 불변) |
| EX-I-10 · 11 | §4.3 · §13 |
| EX-I-12~14 | §5.4(출처 분류 불변) · §5.6 |
| EX-I-15 | §13(URL 상태) |
| EX-I-16 | 표시만(경고·알림은 No.24) |
| EX-I-17 | §5.3 ③ |
| EX-I-18 | §5.7 |

---

## 16. 범위 밖 (재검토 트리거는 요구사항 §9 · ADR-0033 §7)

로그 포함 영구삭제·삭제 시 롤업(대안 B — P-2) · 상시 사전 집계(대안 C) · 보존기간/파기(No.45) · 그룹별 접근 제한·`stats:read` · 감사 기반 소급 재귀속 · 보관 그룹 복구·이름 변경 · 복수 그룹 임의 선택 · 그룹/전역 의도 통계 · 과거 의도명(버전 스냅샷) 해석 · FAQ/노드별 순위 · 대화 흐름 분석(No.24) · `inputKind` 지표(No.24) · 신규/재방문·이탈률(No.45) · 사용자별 활동량 · 채널 전환율 · CSV/정기 리포트 · 실시간 갱신 · 대시보드 `dayBucket` 전환.

---

## 17. 알려진 제한

| # | 제한 | 수용 근거 |
|---|---|---|
| L-1 | 백필 이전 그룹 이동 이력은 복원되지 않는다 — 과거 로그 전부 현재 소속 그룹(EX-I-6). 롤백 후 재적용 시에도 같다 | 감사 도입 이전 이동은 복원 불가(부분 정확성). 백필 스크립트 출력·릴리스 노트에 명시 |
| L-2 | RAG 보류 턴은 요청 시점 그룹에 귀속(적재는 최대 수십 초 뒤) | 대화 시작 시점의 사실 기록이 일관된 정의 |
| L-3 | 최다 챗봇은 후보 500 기준 근사 | ADR-0004 근사 규약과 같은 성질, `approximated` 공유 |
| L-4 | 기존 보관 챗봇의 보관일 = `updatedAt` 근사 | 표시 전용 · 신규 보관부터 정확 |
| L-5 | 그룹 보관·챗봇 이동의 경합 방어는 SQLite 쓰기 직렬화에 기댄다 | Postgres 전환 시 해당 2트랜잭션을 `Serializable` 대상에 추가(개발명세서 §5 DB 이식성의 No.25 메모와 같은 방식) |
| L-6 | ALL 기여 표의 그룹 행 세션 합은 그룹 이동 경계 세션만큼 전역 세션보다 클 수 있다 | 캡션 명시. 전역 세션 수 자체는 정확 |
| L-7 | 대화로그 보존기간이 무기한이다(현행과 동일 — 악화 아님) | No.45. 개발명세서 §5 보안에 "알려진 리스크"로 기록(NFR-IS4) |
| L-8 | 백필 전 삭제된 빈 그룹의 로그는 이후 현재 소속으로 귀속된다 | §3.7 절차(배포 직후 백필)로 창을 최소화 |

---

## 18. 요구사항 대비 해석 (architect 판단)

| # | 요구사항 표현 | 이 설계의 해석 |
|---|---|---|
| I-1 | "호출부 3곳"(FR-I2-2) | 직접 호출 2곳(`public-conversation.service.ts:94,169`) + 포트 경유 2곳(`rag-answer.service.ts:153,172`) — 포트 타입까지 필수화해야 누락이 컴파일 오류가 된다 |
| I-2 | "원시 SQL은 `stats.service.ts` 계열 파일에 격리"(FR-I7-2) | 대시보드 원시 SQL 파일은 **무변경**(FR-0-90)으로 두고, 신규 원시 SQL은 `stats/integrated/integrated-session.query.ts` 1파일에 격리. 보유 파일 목록을 R-7로 고정 |
| I-3 | "주/월 합집합을 SQL로 보존하는 버킷 키 식"(FR-I7-2) | DB 날짜 함수 대신 **TS가 만든 범위 목록의 `CASE` 바인딩** — 버킷 규칙 단일 소스 유지 + 공통 문법 |
| I-4 | 정적 검사 대상 "`unansweredQuestion` 삭제 0건" | 그대로 채택. 미응답 큐는 `IGNORED`로 정리하는 현행 규약(ADR-0019)과 일치하며, 향후 큐 정리 배치도 R-4 규약(단일 서비스)을 따른다 |
| I-5 | "`ChatbotGroup` DTO에 `archivedAt?`" | 노출하지 않음(§8.4 D-5) |
| I-6 | 기여 표 "보관일" | `Chatbot.archivedAt` 신설(§8.4 D-4) |
| I-7 | "적재 후 불변" | 요구사항에 명시는 없으나 P-3의 논리적 귀결 — R-10으로 봉인 |
| I-8 | 엔드포인트 6개 | 7개(§8.4 D-1) |

---

## 19. GPU · 배포 형태

| No | 카탈로그 | 재확인 | 근거 |
|---|:---:|:---:|---|
| 29 | 1 | **1 유지** | `GROUP BY`·`COUNT(DISTINCT)`·순수 함수 병합뿐. 새 모델·추론·임베딩 0 · ml-worker 변경 0. 대안 C를 택해도 CPU 배치다 |

구축형 ○(외부 의존 0, SQLite 단일 인스턴스 동작) · 구독형 ○(상태 없는 조회 — 인스턴스 수 무관, 프로세스 로컬 상태 추가 0). ml-engineer 인계 없음.
