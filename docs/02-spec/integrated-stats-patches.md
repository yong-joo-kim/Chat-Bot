# No.29 통합 통계 — 기존 문서 패치 목록

> 작성: system-architect · 2026-09-24 · 근거: `docs/02-spec/integrated-stats-설계.md`, `docs/02-spec/decisions/ADR-0033-cumulative-stats-source-log-sealing-and-group-snapshot.md`
> **적용 상태**: ✅ **적용 완료(2026-09-24)** — 오케스트레이터 세션이 36건 전부 "찾을 원문 정확히 1회" 확인 후 기계적으로 적용했다.
> **적용 방법**: 각 항목의 "찾을 원문"을 대상 파일에서 **정확히 1회** 찾아 "바꿀 내용"으로 교체한다. 모든 원문은 2026-09-24 시점 파일에서 복사했고 문자열 검색(Grep)으로 대상 파일 안 유일성을 확인했다. "append" 항목은 원문을 그대로 포함한 채 뒤에 덧붙인다.
> **줄바꿈 주의**: 대상 파일은 CRLF일 수 있다. 모든 "찾을 원문"은 **한 줄 안의 부분 문자열**(줄바꿈 미포함)로 잡았다. "바꿀 내용"의 줄바꿈은 대상 파일의 줄바꿈으로 정규화한다.
> **순서 독립**: 어떤 "바꿀 내용"도 다른 항목의 "찾을 원문"을 새로 만들지 않는다.
> 코드 변경은 이 파일의 범위가 아니다 — 설계서 §2.5 체크리스트를 따른다.
> 항목 수: 개발명세서 23 · ADR 7 · 기능요구사항 1 · 선행 요구사항/설계서 정정 3 · 통합 통계 요구사항(PM 결정 기록) 2 = **36건**

---

## A. `docs/02-spec/개발명세서.md`

### A-1. §2 워크스페이스 상태 표 — `stats/integrated` 행 추가

**찾을 원문**
````text
추가 0건 · 신규 권한 0종**(ADR-0032) |
````
**바꿀 내용**
````text
추가 0건 · 신규 권한 0종**(ADR-0032) |
| **`apps/api/src/stats/integrated`** · **`apps/api/src/stats/intents`** | **통합 통계 Phase에 신설**(No.29) — 그룹·전역 스코프 통계(누적 KPI·기간 시계열·분포·기여 표·질문 순위)와 챗봇 스코프 의도별 매칭. 원천 `ConversationLog` **직접 집계**(롤업 테이블 0) · `stats` 모듈 확장(신규 NestJS 모듈 0) · No.14 순수 함수 재사용. **`packages/dialogue-engine`·ml-worker·widget 변경 0건 · `@Public()` 추가 0건 · 신규 권한 0종 · 신규 환경변수 0개**(ADR-0033) |
````

### A-2. §2.2 기능그룹별 모듈 배치 표 — No.29 행 추가

**찾을 원문**
````text
`chatbots`(영구삭제 동반 삭제 14테이블) | **설계 완료 → `scheduled-deploy-설계.md`** |
````
**바꿀 내용**
````text
`chatbots`(영구삭제 동반 삭제 14테이블) | **설계 완료 → `scheduled-deploy-설계.md`** |
| **통합 통계 (No.29)** | **`stats`(확장 — `integrated/`(6핸들러 · ★세션 distinct 원시 SQL 격리 파일 `integrated-session.query.ts`) · `intents/`(의도별 매칭) · `lib/` 순수 함수 5종 신설 + 챗봇 스코프 조립 코드 추출 · KST 헬퍼 중복 제거)** + `conversation`/`rag`(`record()`·`ConversationLogPort`·`RagAnswerRunInput`에 `groupId` 필수 — 대화 당시 그룹 스냅샷) · `chatbot-groups`(이력 있는 그룹 삭제 = 보관 · 보관 그룹 제외) · `chatbots`(보관 그룹 대상 404 · `archivedAt` 동기화 — **영구삭제 사전검사 무변경**) | **설계 완료 → `integrated-stats-설계.md`** |
````

### A-3. §2.2 주석 블록 — 엔진 불가침·모듈 의존 방향(No.29) 추가

**찾을 원문**
````text
한 트랜잭션으로 처리한다(ADR-0032).
````
**바꿀 내용**
````text
한 트랜잭션으로 처리한다(ADR-0032).
>
> **엔진 불가침(통합 통계 No.29)**: 이 그룹은 엔진을 **호출하지도, 바꾸지도 않는다**(FR-0-88).
>
> **모듈 의존 방향(No.29)**: `stats → chatbots(existsById) / prisma / config` 그대로다. **`StatsModule`은 `ChatbotGroupsModule`·`ConversationModule`·`LearningModule`을 import하지 않는다** — 그룹 행은 보관 포함으로 Prisma에서 직접 읽고(그룹 서비스는 보관 그룹을 숨긴다), 통계의 Prisma 쓰기 대상은 **0개**다(`stats-retention-sealing.spec.ts` R-8). 그룹 보관 판정의 "귀속 로그 존재"는 `ChatbotGroupsService`가 Prisma 1건 조회로 한다(`chatbot-groups → stats` 참조 없음). 대화 로그 적재의 `groupId`는 `PublicAccessService.resolve()`가 이미 읽은 챗봇 행에서 오며 **추가 조회 0건**이다(ADR-0033 §4).
````

### A-4. §3 엔터티 표 — `ChatbotGroup` 행

**찾을 원문**
````text
| `ChatbotGroup` | 챗봇 그룹(폴더). 1단계 평면 구조(계층 폴더 미지원) | 1 |
````
**바꿀 내용**
````text
| `ChatbotGroup` | 챗봇 그룹(폴더). 1단계 평면 구조(계층 폴더 미지원). **[No.29] `archivedAt`** — 대화로그가 귀속된 빈 그룹을 "삭제"하면 물리 삭제 대신 보관한다(없으면 현행 물리 삭제). 보관 그룹은 그룹 목록·수정·복사·삭제와 챗봇 생성·이동·복사 대상에서 제외(`404`)되고 **통합 통계에만 "보관된 그룹"으로 남는다**. 소속 챗봇은 항상 0개. 되살리기 경로 없음(1차) — ADR-0033 §5 | 1, 29 |
````

### A-5. §3 엔터티 표 — `Chatbot` 행

**찾을 원문**
````text
| `Chatbot` | 챗봇 인스턴스(이름/아바타/URL/스킨/상태). `skin`은 JSON 직렬화 문자열, API 경계에서는 객체 | 1, 3, 4 |
````
**바꿀 내용**
````text
| `Chatbot` | 챗봇 인스턴스(이름/아바타/URL/스킨/상태). `skin`은 JSON 직렬화 문자열, API 경계에서는 객체. **[No.29] `archivedAt`**(가장 최근 보관 시각 — `status='ARCHIVED'` ⇔ 값 있음. 쓰기 주체 `archive()`·`updateStatus()` 2곳, 통합 통계 기여 표의 "보관일" 표시 전용 · DTO 미노출. 기존 보관 챗봇은 `updatedAt` 근사 백필) | 1, 3, 4, 29 |
````

### A-6. §3 엔터티 표 — `ConversationLog` 행에 `groupId` 추가

**찾을 원문**
````text
`PENDING` 시점에는 적재하지 않는다(ADR-0023)** | 14, 15, 30 |
````
**바꿀 내용**
````text
`PENDING` 시점에는 적재하지 않는다(ADR-0023)** **[No.29] `groupId`는 대화 **당시** 챗봇 소속 그룹의 스냅샷이다(FK 없음 · `""` = 백필 미완 센티넬). `record()` 1곳에서 기록하고 **적재 후 변경하지 않는다** — 그룹 이동이 과거 누적을 소급 변경하지 않는다. 이 테이블은 **누적 통계의 유일한 원천**이며 운영 코드의 삭제·변경 경로가 **0건**임을 정적 검사가 단언한다(ADR-0033)** | 14, 15, 29, 30 |
````

### A-7. §3 엔터티 표 — `UnansweredQuestion` 행 보강

**찾을 원문**
````text
수집 조건에 `answeredByRag` 분기를 추가하지 않는다** | 15 |
````
**바꿀 내용**
````text
수집 조건에 `answeredByRag` 분기를 추가하지 않는다** **[No.29] 물리 삭제 코드 0건을 정적 검사로 단언한다(`ConversationLog`와 같은 봉인 — ADR-0033 §2). 향후 큐 정리 배치(No.45)도 "단일 서비스 + 롤업 선적재" 규약을 따른다** | 15 |
````

### A-8. §3 미도입 결정 ⑦ — 보론(재검토 트리거 3종)

**찾을 원문**
````text
재검토 트리거는 로그 1,000만 행 도달이다(**ADR-0017**).
````
**바꿀 내용**
````text
재검토 트리거는 로그 1,000만 행 도달이다(**ADR-0017**). **[보론 2026-09-24 No.29] 통합 통계도 롤업을 만들지 않는다(ADR-0033)** — No.28 `PollingLoop`으로 "채울 주체 없음" 사유는 해소됐지만 재계산 경로·주/월 세션 재현 불가(DD-61)·질문 순위 원천 의존 사유는 그대로이고, 원천은 영구삭제 사전검사·FK `Restrict`·삭제 코드 0건 정적 검사로 구조적으로 보존된다. **재검토 트리거는 3종으로 갱신한다**: ① 로그 1,000만 행 ② 그룹 스코프 누적 KPI P95 2초 · 기간 조회 P95 1초/2초 실측 미달(커버링 인덱스 1차 완화 후에도) → 상시 일 롤업(`PollingLoop` 재사용) ③ **로그 삭제 경로 도입**(No.45 보존기간·파기 · ADR-0002 "함께 삭제") → **같은 트랜잭션의 롤업 선적재가 필수**.
````

### A-9. §3.1 참조 무결성 — FK 미설정 예외에 `ConversationLog.groupId` 추가

**찾을 원문**
````text
**`DeploySchedule`의 `targetVersionId`/`predecessorScheduleId`/`heldByScheduleId`/`postRunTestSetId`/`testRunId`/`createdById`/`cancelledById`/`acknowledgedById`** 는 **FK를 걸지 않는다**
````
**바꿀 내용**
````text
**`DeploySchedule`의 `targetVersionId`/`predecessorScheduleId`/`heldByScheduleId`/`postRunTestSetId`/`testRunId`/`createdById`/`cancelledById`/`acknowledgedById`**, **`ConversationLog.groupId`**(No.29 — 대화 당시 그룹 스냅샷. `Restrict`면 로그가 있는 그룹을 영원히 지울 수 없고 `SetNull`이면 귀속이 사라진다 — 대신 그룹은 보관한다, ADR-0033 §5) 는 **FK를 걸지 않는다**
````

### A-10. §3.1 파생 데이터 동반 삭제 — 대화로그·미응답은 동반 삭제 대상이 아님을 명시

**찾을 원문**
````text
**`ARCHIVED`(보관) 상태에서는 스냅샷을 보존**한다(ADR-0002 갱신 각주).
````
**바꿀 내용**
````text
**`ARCHIVED`(보관) 상태에서는 스냅샷을 보존**한다(ADR-0002 갱신 각주). **[No.29] 반대로 `ConversationLog`·`UnansweredQuestion`은 파생 데이터가 아니라 누적 통계의 원천이므로 동반 삭제 대상이 될 수 없다** — 계속 영구삭제 **사전검사(409) 대상**이며, 이 409는 누적 통계 보존 장치다(ADR-0002 갱신 각주, ADR-0033 §2). 이 분류를 바꾸려면 롤업 선적재 규약(ADR-0033 §3)을 먼저 구현해야 한다.
````

### A-11. §3.1 인덱스 — `conversation_logs` 인덱스 2개 추가

**찾을 원문**
````text
**`conversation_logs.answeredByRag`에는 인덱스를 두지 않는다**
````
**바꿀 내용**
````text
**[No.29] `conversation_logs(groupId, dayBucket)`(그룹 스코프 기간 필터·백필 잔여·그룹 보관 판정), `conversation_logs(dayBucket)`(전역 스코프 기간 필터 — 기존 인덱스가 전부 `chatbotId` 선행이라 전량 스캔이 되며, Postgres에 skip-scan이 없어 이식성 있는 인덱스 1개를 택했다 — ADR-0033).** **`conversation_logs.answeredByRag`에는 인덱스를 두지 않는다**
````

### A-12. §4 API 표 — 통계 행에 No.29 경로 추가

**찾을 원문**
````text
`/stats/export`(CSV)는 규격만 정의(후속 Phase) | 2, 14 |
````
**바꿀 내용**
````text
`/stats/export`(CSV)는 규격만 정의(후속 Phase). **[No.29] 챗봇 스코프 `GET /stats/intents`(의도별 매칭 — 삭제된 의도 표시) + 그룹·전역 스코프 `GET /stats/integrated/overview｜summary｜distribution｜questions｜breakdown｜groups`(6개 — `scope=ALL｜GROUP`, 보관 챗봇·보관 그룹 포함, `groups`는 스코프 선택기). 기존 4개의 요청·응답·오류 문구 불변 · 전부 `chatbot:read` · `@Public()` 추가 0건** | 2, 14, 29 |
````

### A-13. §4 정정 이력 — 2026-09-24 항목 추가

**찾을 원문**
````text
외부 cron 트리거 경로를 만들지 않는다(`scheduled-deploy-설계.md` §13).
````
**바꿀 내용**
````text
외부 cron 트리거 경로를 만들지 않는다(`scheduled-deploy-설계.md` §13).
> **정정 이력(2026-09-24 — 통합 통계)**: ① 통계 행에 **`/stats/integrated/*` 6개 + `/stats/intents` 1개**를 추가했다(요구사항 초안 6개 → **7개**: 스코프 선택기 `groups`는 보관 그룹 포함 전체 그룹이 필요한데 `GET /chatbot-groups`는 보관 그룹을 숨기게 되므로 분리 — 페이지네이션 대신 상한 1,000 + `truncated`). ② 통합 통계는 **챗봇 스코프 중첩 경로가 아니다** — 스코프가 챗봇보다 크며 그룹 존재 판정(보관 허용)은 서비스가 한다. ③ 신규 `ApiErrorCode` 0종 · 공개 경로 6곳 불변(`integrated-stats-설계.md` §8).
````

### A-14. §4.1 집계 조회 — 통합 스코프 공통 메타

**찾을 원문**
````text
(프런트가 상한값을 하드코딩하지 않는다) |
````
**바꿀 내용**
````text
(프런트가 상한값을 하드코딩하지 않는다). **[No.29] 그룹·전역 스코프 응답은 `scope`·`groupId`·`backfillPending`(대화 당시 그룹 백필 미완 — 조용한 과소 집계 금지)·`generatedAt`·`timezone`을 공통 메타로 싣는다. 합계에서 보관 챗봇을 빼는 파라미터는 두지 않는다(질문 순위의 `includeArchivedChatbots`만 예외 — ADR-0033 §2). `scope=GROUP`에 `groupId` 누락·`scope=ALL`에 `groupId` 지정은 `400 VALIDATION_FAILED`, 미존재 그룹은 `404`(보관 그룹은 조회 허용)** |
````

### A-15. §5 성능 — No.29 항목 추가

**찾을 원문**
````text
상태 점검은 캡처 1회(P95 1초).
````
**바꿀 내용**
````text
상태 점검은 캡처 1회(P95 1초).
  - **[신규 2026-09-24 — 통합 통계] 공개 대화 경로 영향은 측정 불가 수준**이다(`record()`에 문자열 1개 추가 · 추가 조회 0). 관리자 경로 — 기준 데이터 **그룹 1개 = 챗봇 20개·로그 100만 행 / 전역 = 300만 행**에서 **누적 KPI P95 2초 · 요약·분포·기여 표 일 30일 P95 1초 · 월 24개월 P95 2초 · 질문 순위 P95 2초**, 챗봇 스코프 의도별 통계는 기존 시계열 예산(10만 행 1초). 그룹·전역 스코프의 세션 distinct는 **반환 행 수가 세션 수와 무관**해야 한다(버킷 수 × 채널 수 이하). 5초 초과는 기존과 같이 `503 AGGREGATION_TIMEOUT`(캐시 반환 금지). 그룹 귀속 백필은 **100만 행 10분 이내 · 배치당 쓰기 잠금 1초 미만**. 미달 시 커버링 인덱스 1차 완화 → 롤업 재검토(ADR-0033 §7).
````

### A-16. §5 보안 — 통계 원천 보존 봉인 + 보존기간 알려진 리스크

**찾을 원문**
````text
16단언**으로 강제한다.
````
**바꿀 내용**
````text
16단언**으로 강제한다.
  - **[신규 2026-09-24] 누적 통계 원천의 봉인(ADR-0033)**: ① `apps/api/src`에서 `ConversationLog`·`UnansweredQuestion`의 `delete`/`deleteMany`/원시 `DELETE` **0건**, 허용 목록 상수는 **빈 배열** ② 두 모델에 `onDelete: Cascade｜SetNull` 없음 · 영구삭제 사전검사에 두 키 존재 ③ 로그 `create`는 `record()` 1파일, 로그 `update*`는 **0건**(대화 당시 그룹 스냅샷의 소급 변경 금지) ④ 통계 모듈 Prisma 쓰기 0건(새 원문 저장소·캐시 금지) ⑤ 원시 SQL 보유 파일 3개 고정 · `$queryRawUnsafe` 0건 — `stats-retention-sealing.spec.ts` **R-1~R-10**. 향후 로그 삭제 기능은 **단일 서비스 + 같은 트랜잭션의 수치 롤업 선적재**로만 추가한다(롤업에 텍스트·세션 ID·의도 ID 없음).
  - **[알려진 리스크 2026-09-24 — NFR-IS4] 대화로그(`userMessage`/`botResponse` 마스킹본)의 보존기간이 무기한이다.** 통합 통계는 이 상태를 **바꾸지 않는다**(악화도 개선도 아님 — 새 원문 저장소 0). 규칙 기반 마스킹은 이름·주소를 탐지하지 못하므로(ADR-0013 §6) 보존기간·자동 정리·정보주체 파기는 **No.45**에서 결정하며, 그때 ADR-0033 §3의 롤업 선적재 규약을 따른다.
````

### A-17. §5 DB 이식성 — 원시 SQL 1건 추가(격리 파일)

**찾을 원문**
````text
(시계열·세션 distinct는 Prisma `groupBy` + 앱 순수 함수, 유사도는 메모리 내적 — ADR-0017 §4, ADR-0024).
````
**바꿀 내용**
````text
(시계열·세션 distinct는 Prisma `groupBy` + 앱 순수 함수, 유사도는 메모리 내적 — ADR-0017 §4, ADR-0024). **[No.29] 통합 통계(그룹·전역 스코프)의 세션 distinct가 원시 SQL을 `stats/integrated/integrated-session.query.ts` 1파일에 추가한다**(ADR-0017 §4가 예고한 탈출구 — 반환 행 수를 세션 수와 무관하게). 버킷 키는 DB 날짜 함수가 아니라 **TS가 만든 `dayBucket` 범위 목록의 `CASE` 바인딩**이며(주차 규칙 1벌 유지), 서브쿼리·`CASE`·`COUNT(DISTINCT)`·`||`·`SUM`만 쓰고 전 입력을 바인딩한다. 챗봇 스코프(No.14)의 세션 계산은 바꾸지 않는다. 원시 SQL 보유 파일은 `stats.service.ts`(대시보드 — 무변경)·이 파일·헬스체크 **3개로 고정**된다(`stats-retention-sealing.spec.ts` R-7, ADR-0033 §6). 그룹 보관·챗봇 이동의 경합 방어도 SQLite 쓰기 직렬화에 기대므로 Postgres 전환 시 두 트랜잭션을 `Serializable` 지정 대상에 추가한다.
````

### A-18. §5.1 환경변수 주석 — No.29 문단 추가(신규 0개)

**찾을 원문**
````text
`DeploySchedule` 0행이 정상 상태다.**
````
**바꿀 내용**
````text
`DeploySchedule` 0행이 정상 상태다.**
> **통합 통계 그룹(No.29)은 신규 환경변수를 추가하지 않는다.** 기간 상한은 기존 `STATS_MAX_RANGE_DAYS|WEEKS|MONTHS`를 그대로 쓰고, 기여 표 상한(200)·선택기 상한(1,000)·질문 후보(500)는 코드 상수(`INTEGRATED_STATS_LIMITS`·`TOP_QUESTION_CANDIDATE_LIMIT`)다. **seed는 `ConversationLog.groupId`를 채운다**(dev DB가 백필 대기 상태로 시작하지 않게). 운영 배포는 마이그레이션 → API 배포 → `prisma/scripts/backfill-conversation-group.ts`(검증 0건 게이트)를 **연속 실행**한다.
````

### A-19. §6 결정 20(권한) — No.29 갱신 각주

**찾을 원문**
````text
공개 경로 6곳 불변(ADR-0032 §5, ADR-0015 갱신 각주).
````
**바꿀 내용**
````text
공개 경로 6곳 불변(ADR-0032 §5, ADR-0015 갱신 각주).
    - **갱신(2026-09-24 — No.29)**: 통합 통계·의도별 통계 7개 핸들러는 전부 **`chatbot:read`** 다. ADR-0015 감수 비용 2가 예고한 **`stats:read` 신설은 검토 결과 하지 않는다** — 세 역할 모두 `chatbot:read`를 가지고 그룹별 챗봇 접근 제한이 없어(ADR-0015 48행) 합산 화면이 새 정보를 노출하지 않으며, 신설해도 판정 차이가 0이다. 재검토 트리거는 그룹별 접근 제한/멀티테넌시 도입(No.45)이며 교체 지점은 스코프 판정 함수 1곳이다(PM 확정 P-7, ADR-0033 §8). `Permission` 15종 · 공개 경로 6곳 불변.
````

### A-20. §6 결정 21(감사) — No.29 갱신 각주

**찾을 원문**
````text
`AuditLogService` 1곳이다(ADR-0032 §5, ADR-0016 갱신 각주).
````
**바꿀 내용**
````text
`AuditLogService` 1곳이다(ADR-0032 §5, ADR-0016 갱신 각주).
    - **갱신(2026-09-24 — No.29)**: **`AuditAction`·`AuditTargetType` 추가 0종.** 이력 있는 그룹의 "삭제"가 보관으로 처리돼도 사용자 의도는 삭제이므로 기존 `DELETE`/`ChatbotGroup`으로 기록하고 `after`(보관 시각 포함)와 summary `그룹 보관(통계 보존)`으로 구분한다. 통계 조회·그룹 귀속 백필 스크립트는 감사 대상이 아니다(읽기 / 운영 스크립트 — `backfill-conversation-buckets.ts` 선례).
````

### A-21. §6 결정 34 신설

**찾을 원문**
````text
→ **ADR-0032**(+ ADR-0002·0011·0015·0016·0025·0027·0031 갱신 각주)
````
**바꿀 내용**
````text
→ **ADR-0032**(+ ADR-0002·0011·0015·0016·0025·0027·0031 갱신 각주)

34. **통합 통계(No.29)의 누적 보존 방식·그룹 귀속·그룹 삭제·세션 집계·권한 확정(2026-09-24)**: 선행 문서가 "ADR-0002(영구삭제 시 하위 데이터 제거)와 충돌"이라고 넘긴 전제는 **사실과 반대**였다 — 콘솔의 삭제는 보관(`ARCHIVED`)이고, 영구삭제는 대화로그가 있으면 `409`이며 FK도 `Restrict`라 **원천은 이미 구조적으로 보존된다**. 실제 공백은 그룹·전역 집계 부재, 보관 챗봇의 비가시성, **그룹 이동의 과거 누적 소급 변경**, 미래 삭제 경로에 대한 무방비였다. **① 원천 `ConversationLog` 직접 집계 · 롤업 테이블 미도입**(PM P-1) — No.14 순수 함수를 `where`만 넓혀 재사용하고 인라인 조립 코드를 순수 함수로 추출해 계산식 1벌을 유지한다. **② 보존 = 3층 구조**(FK `Restrict` · 영구삭제 사전검사 409를 "누적 통계 보존 장치"로 명문화(P-2 — 로그 포함 영구삭제 불허) · 삭제·변경 코드 0건 정적 검사 R-1~R-10). 향후 삭제 경로는 **단일 서비스 + 같은 트랜잭션 롤업 선적재**만 허용(허용 목록 빈 배열). **③ 대화 당시 그룹 귀속**(P-3) — `ConversationLog.groupId` 스냅샷(FK 없음 · `record()` 1곳 · 호출부 추가 조회 0 · 세 타입에서 필수 · **적재 후 불변**), 기존 행은 현재 소속으로 1회 백필(멱등), 감사 기반 소급 재귀속 없음, 백필 잔여는 `backfillPending`. **④ 이력 있는 그룹의 삭제 = 보관**(P-4, `ChatbotGroup.archivedAt` — 목록·대상에서 숨김, 통계에는 "보관된 그룹"). **⑤ 보관 챗봇은 합계에 항상 포함**, 질문 순위만 제외 토글(P-5). **⑥ 그룹·전역 세션 distinct = 원시 SQL 1파일**(ADR-0017 §4 탈출구 — 버킷 키는 TS 범위 목록의 `CASE` 바인딩, 세션 키 `chatbotId|sessionId`, 챗봇 스코프 불변). **⑦ 의도별 매칭은 챗봇 스코프만**(P-6, 삭제된 의도 표시). **⑧ `stats:read` 미신설**(P-7). **⑨ 콘솔 홈 `/` = 통합 통계**(P-8). **⑩ KST 헬퍼 통합** — `dashboard-period.ts`의 재정의를 `kst-date.ts` import로(동작 불변), `kst-date` ↔ `shared-types` 동치는 계약 테스트. 롤업 재검토 트리거 = 1,000만 행 · 성능 예산 실측 미달 · **로그 삭제 경로 도입**. 신규 `ApiErrorCode`·권한·환경변수·공개 경로 0. GPU **1 유지**(P-9). → **ADR-0033**(+ ADR-0001·0002·0004·0015·0017 갱신 각주)
````

### A-22. §7 인덱스 — 설계서 행 추가

**찾을 원문**
````text
| 요구사항: `docs/requirements/scheduled-deploy.md` |
````
**바꿀 내용**
````text
| 요구사항: `docs/requirements/scheduled-deploy.md` |
| **`integrated-stats-설계.md`** | **통합 통계(No.29) — Prisma 변경안(`ConversationLog.groupId` 스냅샷 + 인덱스 2 · `ChatbotGroup.archivedAt` · `Chatbot.archivedAt`, **비파괴 `ADD COLUMN`만·DROP으로 롤백**), 그룹 귀속 백필(멱등·현재 소속·소급 재귀속 없음)·배포 순서, `record()`/포트/RAG 입력 필수 `groupId`(추가 조회 0·적재 후 불변), 그룹 보관 판정·제외 7지점, 스코프 판정 1곳, No.14 조립 코드 순수 함수 추출(계산식 1벌), **세션 distinct 원시 SQL(버킷 범위 `CASE` 바인딩·세션 키 `chatbotId｜sessionId`·격리 1파일)**, 엔드포인트별 쿼리 계획, 기여 표(최대 잔여법 비중 합 1·상한 200·기타/미귀속 행), 질문 최다 챗봇 귀속·보관 토글, 누적 KPI, 챗봇 스코프 의도별 매칭, KST 헬퍼 통합·계약 테스트, 7개 엔드포인트·shared-types 스키마(**신규 오류코드·권한·환경변수·공개 경로 0**), 감사(`DELETE` + summary), **봉인 정적 검사 R-1~R-10**, 성능 예산·측정·트리거, 콘솔 인계, 시험 포인트, 알려진 제한 8건, 요구사항 대비 해석 8건** | 요구사항: `docs/requirements/integrated-stats.md` |
````

### A-23. §7 인덱스 — ADR-0033 행 추가

**찾을 원문**
````text
FR-0-78~87, FR-D1~D7, AC-D1~D6 |
````
**바꿀 내용**
````text
FR-0-78~87, FR-D1~D7, AC-D1~D6 |
| **`decisions/ADR-0033-cumulative-stats-source-log-sealing-and-group-snapshot.md`** | **누적 통계 = 원천 로그 직접 집계(롤업 미도입 — "ADR-0002 충돌" 전제 정정) · 보존 3층(FK `Restrict`·영구삭제 사전검사 409 명문화·삭제/변경 코드 0건 정적 검사) · 향후 삭제 경로 = 단일 서비스 + 롤업 선적재 · ★ 대화 당시 그룹 스냅샷(`ConversationLog.groupId`, 적재 후 불변, 현재 소속 백필) · 이력 있는 그룹 삭제 = 보관 · 그룹·전역 세션 distinct 원시 SQL(버킷 범위 바인딩) · 롤업 재검토 트리거 3종 · `stats:read` 미신설 · 대안 B/C/D·조회 시점 조인·감사 재귀속 기각** | 요구사항 J-1~J-5/J-10/J-12, FR-0-89~95, FR-I1-\*, FR-I2-\*, FR-I7-\*, AC-I1/I3/I4/I6 |
````

---

## B. 기존 ADR (결정 본문은 수정하지 않는다 — 파일 끝 append + 인라인 표식 2건)

### B-1. `docs/02-spec/decisions/ADR-0002-permanent-delete-referential-integrity.md` — 409 = 누적 통계 보존 장치 · 그룹 보관 (append)

**찾을 원문**
````text
- `ARCHIVED` 챗봇의 남은 예약은 실행 시 `FAILED(CHATBOT_ARCHIVED)`가 되며, 보관 중에도 **취소·조회는 허용**한다.
````
**바꿀 내용**
````text
- `ARCHIVED` 챗봇의 남은 예약은 실행 시 `FAILED(CHATBOT_ARCHIVED)`가 되며, 보관 중에도 **취소·조회는 허용**한다.


---

## 갱신 (2026-09-24 — No.29: 대화로그 사전검사 409는 누적 통계 보존 장치다 · 그룹 삭제 = 이력 있으면 보관)

통합 통계(No.29, **ADR-0033**)는 "챗봇이 삭제되어도 그룹 기준 누적 통계 유지"를 **이 ADR의 결정 그대로** 충족한다. 선행 문서(`stats-learning.md` §9.1, `stats-learning-설계.md` §15)가 이 ADR을 "영구삭제 시 하위 데이터 제거"로 요약하고 No.29와 **충돌**한다고 적었으나 **사실과 반대**다 — 이 ADR은 cascade를 금지하고(결정 1) 대화로그가 있으면 영구삭제를 `409`로 거부하며(결정 3), "대화로그가 쌓인 챗봇은 사실상 영구 삭제 불가, `ARCHIVED`가 최종 정리 수단"을 감수 비용으로 명시했다. "하위 데이터 제거" 분류(위 두 갱신)는 **파생 테이블**(버전·예약·임베딩 등)에만 적용된다. **결정 1~6은 전부 불변이다**(PM 확정 P-2 — 로그 포함 영구삭제 불허).

- **결정 3의 `conversationLogs`·`unansweredQuestions` 사전검사는 이제 누적 통계의 보존 장치이기도 하다.** 이 두 항목을 사전검사에서 빼거나 "하위 데이터 함께 삭제" 플로우(감수 비용 문단의 후속 Phase)를 도입하는 변경은 **같은 트랜잭션에서 수치 롤업을 먼저 적재**해야 한다(ADR-0033 §3). 두 키가 사전검사 목록에 남아 있음과 두 모델의 삭제 코드 0건을 `stats-retention-sealing.spec.ts`가 단언한다.
- **결정 6(그룹 삭제)의 확장**: 소속 챗봇이 있으면 `409 GROUP_NOT_EMPTY`(보관 챗봇 포함 — 불변). 비어 있고 **대화로그가 귀속된 그룹**(`ConversationLog.groupId` — 대화 당시 그룹 스냅샷)은 물리 삭제 대신 **보관**(`ChatbotGroup.archivedAt`)한다 — 과거 통계가 그룹 이름을 잃지 않게 하기 위해서다. 귀속 로그가 없으면 현행 물리 삭제. 응답은 둘 다 `204`. 챗봇 소프트 삭제를 기각한 사유(`slug` unique 충돌)는 그룹에 해당하지 않는다(이름 유일 제약 없음). 보관 그룹은 목록·수정·복사·삭제·챗봇 생성/이동/복사 대상에서 `404`이며 통합 통계에만 남는다.
````

### B-2. `docs/02-spec/decisions/ADR-0004-dashboard-aggregation-strategy.md` — 집계 테이블 No.29에서도 미도입 (append)

**찾을 원문**
````text
- 후속: 대화 엔진 Phase에서 `ConversationLog.normalizedMessage` 도입을 재검토하고, 도입 시 `aggregateTopQuestions`의 정규화 단계를 우회 가능하게 한다(함수 계약은 유지).
````
**바꿀 내용**
````text
- 후속: 대화 엔진 Phase에서 `ConversationLog.normalizedMessage` 도입을 재검토하고, 도입 시 `aggregateTopQuestions`의 정규화 단계를 우회 가능하게 한다(함수 계약은 유지).


---

## 갱신 (2026-09-24 — No.29에서도 일/주 집계 테이블 미도입)

대안 표의 "일/주 단위 집계 테이블 — No.14/No.29 범위"에 대해: **No.29(통합 통계)도 집계 테이블을 도입하지 않는다**(ADR-0033 §1·§7). 그룹·전역 스코프는 이 ADR의 "DB 그룹화 + 순수 함수" 방식을 `where`만 넓혀 재사용하며, `aggregateTopQuestions`·`computeResponseRates`·`computeVisitCount`의 계약은 불변이다(`normalizeQuestion`은 질문별 최다 챗봇 귀속을 위해 **export만** 추가 — 규칙 1벌 유지). 후보 상한 500의 근사 규약은 그룹 질문 순위와 최다 챗봇 귀속에도 그대로 적용된다. 원시 SQL 격리 원칙(감수 비용 ②)은 **"`stats` 모듈의 지정 파일"** 로 범위만 넓힌다 — 대시보드 원시 SQL(`stats.service.ts`)은 무변경이고, 그룹·전역 세션 distinct 1건이 `stats/integrated/integrated-session.query.ts`에 격리된다(보유 파일 목록은 정적 검사로 고정).
````

### B-3. `docs/02-spec/decisions/ADR-0015-role-permission-model.md` — 감수 비용 2 인라인 표식

**찾을 원문**
````text
No.14에서 전역 통계 API가 추가될 때 `stats:read` 신설을 검토한다.
````
**바꿀 내용**
````text
No.14에서 전역 통계 API가 추가될 때 `stats:read` 신설을 검토한다. **[검토 완료 2026-09-24 No.29 — 신설하지 않는다. 문서 끝 갱신 참고]**
````

### B-4. `docs/02-spec/decisions/ADR-0015-role-permission-model.md` — `stats:read` 검토 결과 (append)

**찾을 원문**
````text
- 취소는 예약자가 아니어도 같은 권한 보유자면 할 수 있다(휴가·퇴사 대응). 재개해도 예약자는 바뀌지 않는다 — 자기 명의 실행을 원하면 새 예약을 만든다.
````
**바꿀 내용**
````text
- 취소는 예약자가 아니어도 같은 권한 보유자면 할 수 있다(휴가·퇴사 대응). 재개해도 예약자는 바뀌지 않는다 — 자기 명의 실행을 원하면 새 예약을 만든다.


---

## 갱신 (2026-09-24 — `stats:read` 검토 결과: 신설하지 않는다, 신규 권한 0종)

감수 비용 2가 예고한 검토를 통합 통계(No.29 — 그룹·전역 스코프 통계 API 7개)에서 수행했다. **결과: 신설하지 않는다**(PM 확정 P-7). 7개 핸들러는 전부 `chatbot:read`이며 `Permission` 15종 · `ROLE_PERMISSIONS` · 공개 경로 6곳 · 판정 순서 ①~⑦ 전부 불변이다.

- **판정 차이가 0이다**: ADMIN·EDITOR·VIEWER 모두 `chatbot:read`를 가지며, 결정 1의 "그룹별 챗봇 접근 제한 없음"(48행) 때문에 `chatbot:read` 보유자는 이미 **모든 챗봇의 통계를 개별로** 볼 수 있다. 합산 화면은 새 정보를 노출하지 않고, `stats:read`를 만들어도 세 역할 모두에 부여하게 된다 — 개념만 늘고 막는 것이 없다.
- **챗봇 그룹은 조직 경계가 아니라 분류(폴더)다**(No.1). 통계 합산의 권한 문제는 "그룹별 접근 제한"이 생길 때 비로소 발생한다.
- **재검토 트리거**: 그룹별 접근 제한/멀티테넌시 도입(No.45) 또는 고객사가 "통계만 보는 역할"을 요구할 때. 그때 통합 통계의 스코프 판정 함수(`stats/lib/scope-filter.ts` 1곳)가 "허용된 그룹 집합"을 받도록 교체한다(ADR-0033 §7 ④).
- 감수 비용 2의 나머지(명명 불일치 2건 — `chatbot:write`로 그룹 삭제, `chatbot:read`로 대시보드)는 그대로 둔다. 그룹 삭제가 보관으로 처리되는 경우(ADR-0002 갱신)에도 권한은 `chatbot:write` 그대로다.
````

### B-5. `docs/02-spec/decisions/ADR-0017-timeseries-bucket-strategy.md` — 감수 비용 5 인라인 표식

**찾을 원문**
````text
통합 시점을 No.29로 못 박았다.
````
**바꿀 내용**
````text
통합 시점을 No.29로 못 박았다. **[해소 2026-09-24 No.29 — 문서 끝 갱신 참고]**
````

### B-6. `docs/02-spec/decisions/ADR-0017-timeseries-bucket-strategy.md` — KST 헬퍼 통합 · 세션 원시 SQL 탈출구 이행 · 롤업 트리거 갱신 (append)

**찾을 원문**
````text
④ 통계 경로의 모든 `where`에 `chatbotId` + `dayBucket` 범위가 선행하는지 ⑤ 센티넬을 만드는 신규 쓰기 경로가 없는지.
````
**바꿀 내용**
````text
④ 통계 경로의 모든 `where`에 `chatbotId` + `dayBucket` 범위가 선행하는지 ⑤ 센티넬을 만드는 신규 쓰기 경로가 없는지.


---

## 갱신 (2026-09-24 — No.29: KST 헬퍼 중복 해소 · §4 세션 원시 SQL 탈출구 이행 · §5 재검토 트리거 갱신)

통합 통계(No.29, **ADR-0033**)에 따라 다음을 갱신한다. §1~§3·§6의 결정(KST 파생 컬럼·적재 시점 확정·주/월 앱 폴딩·센티넬·백필 2+1단계)은 **불변**이다.

1. **KST 헬퍼 중복 해소(감수 비용 5)**: `dashboard-period.ts`의 파일 내부 `KST_OFFSET_MINUTES`·`MS_PER_DAY`·`KstDateOnly`·`toKstDateOnly`·`kstDateOnlyToUtc` 재정의(`kst-date.ts`와 글자 수준 동일)를 삭제하고 `stats/lib/kst-date.ts`를 import한다. `resolveDashboardPeriod`의 시그니처·반환값·오류 문구·366일 상한과 대시보드의 `createdAt` 범위 필터는 **불변**(대안 표 84행의 `dayBucket` 전환 기각은 유지). `kst-date.ts`와 `shared-types`의 `toKstDayBucket`은 역할이 달라(달력 산술 / 적재 문자열 확정) 합치지 않고, **동치를 계약 테스트**(`kst-date.contract.spec.ts` — 경계 + 1,000점)로 고정한다. 통계 모듈에서 KST 헬퍼 재정의 0건을 정적 검사가 단언한다.
2. **§4 탈출구 이행 — 범위 한정**: 챗봇 스코프(No.14)의 `groupBy(['dayBucket','channelType','sessionId'])` 앱 폴딩은 **그대로 둔다**(무회귀). **그룹·전역 스코프에서만** 세션 distinct를 원시 SQL로 계산한다 — 반환 행 수가 세션 수에 비례하는 리스크가 스코프 확대로 현실화하기 때문이다. 버킷 키는 DB 날짜 함수가 아니라 **`buildBuckets()`가 만든 버킷별 `dayBucket` 범위 목록을 `CASE WHEN "dayBucket" >= ? AND "dayBucket" <= ? THEN ?`로 바인딩**해 주차 규칙을 TS 1벌로 유지하고, 주/월 세션 = 일 버킷의 합집합(DD-61)을 DB `COUNT(DISTINCT)`로 정확히 보존한다. 세션 키 = `chatbotId || '|' || sessionId`. 격리 파일은 `stats/integrated/integrated-session.query.ts` 1개다(§4의 "원시 SQL 총 개수 1건 그대로" 예고는 **대시보드 파일 무변경**(FR-0-90)을 우선해 "지정 파일 2개 + 헬스체크"로 정정 — 보유 파일 목록은 정적 검사로 고정). 두 경로의 동치는 "챗봇 1개 그룹 = 챗봇 수치" 계약 테스트(AC-I2-1)로 고정한다.
3. **§5 사전 집계 테이블 — 여전히 미도입, 재검토 트리거 3종으로 갱신**: No.28의 `PollingLoop`으로 "채울 주체가 없다"는 사유는 해소됐으나 재계산 경로·DD-61 재현 불가·질문 순위 원천 의존 사유는 유지된다. 트리거 = ① 로그 1,000만 행(유지) ② 그룹 스코프 성능 예산 실측 미달(커버링 인덱스 1차 완화 후) ③ **로그 삭제 경로 도입 — 삭제 전 롤업 적재 필수**(ADR-0033 §3·§7).
4. **인덱스 추가**: `conversation_logs(groupId, dayBucket)`·`conversation_logs(dayBucket)`. §2의 "`hourBucket` 인덱스 미도입" 판단은 그룹·전역 스코프에도 그대로 적용한다.
````

### B-7. `docs/02-spec/decisions/ADR-0001-visit-count-session-id.md` — 그룹·전역 스코프의 세션 키 (append)

**찾을 원문**
````text
- 후속: 대화 엔진 Phase는 세션 생성/만료 정책을 정의하고 `sessionId`를 반드시 채운다. 이때 `ConversationSession` 테이블로 승격할지 재검토한다.
````
**바꿀 내용**
````text
- 후속: 대화 엔진 Phase는 세션 생성/만료 정책을 정의하고 `sessionId`를 반드시 채운다. 이때 `ConversationSession` 테이블로 승격할지 재검토한다.


---

## 갱신 (2026-09-24 — No.29: 그룹·전역 스코프의 세션 = (챗봇, 세션) 쌍)

통합 통계(No.29, ADR-0033 §6)는 여러 챗봇을 합산하므로 세션 distinct의 키를 **`(chatbotId, sessionId)` 쌍**으로 정의한다 — 서로 다른 챗봇의 세션은 같은 `sessionId` 문자열이라도 별개다(위젯이 슬러그별로 발급하지만 값은 클라이언트가 보내므로 정의로 보장한다). 단일 챗봇에서는 `sessionId` distinct와 동치이므로 이 ADR의 산정식(`distinct + null 행 각 1건`)·`visitCountBasis` 규칙은 **불변**이다. 결과적으로 그룹 세션 = 소속 챗봇 세션의 합이며, 주/월 세션은 여전히 일 버킷의 합집합(DD-61)이다.
````

---

## C. `docs/01-requirements/기능요구사항.md`

### C-1. §3 No.29 행 — 설계 완료 반영

**찾을 원문**
````text
| 29 | 통계/분석 | 통합 통계 | 챗봇 삭제되어도 그룹(서비스) 기준 누적 통계 유지 | 1 | 집계 쿼리 | ○ | ○ | - |
````
**바꿀 내용**
````text
| 29 | 통계/분석 | 통합 통계 | 그룹·전역 스코프 통계(누적 KPI·기간 시계열·분포·챗봇별/그룹별 기여·질문 순위) — **보관(삭제)된 챗봇 포함 · 대화 당시 그룹 귀속**(이동해도 과거 누적 불변) + 챗봇 스코프 의도별 매칭 | 1 | 집계 쿼리(원천 로그 직접 집계 — 롤업·새 모델 0건) | ○ | ○ | **설계 완료(2026-09-24, `docs/02-spec/integrated-stats-설계.md` · ADR-0033).** 원문 "챗봇 삭제되어도 그룹(서비스) 기준 누적 통계 유지". 원천 로그는 영구삭제 사전검사(ADR-0002)·FK `Restrict`로 보존되며 삭제·변경 코드 0건을 정적 검사로 보장. **로그 포함 영구삭제·보존기간 정리는 No.45 — 도입 시 삭제 전 롤업 적재 의무** |
````

---

## D. 선행 문서의 잘못된 "ADR-0002 충돌" 서술 정정

### D-1. `docs/requirements/stats-learning.md` 729행(§9.1)

**찾을 원문**
````text
삭제된 챗봇의 통계를 유지하려면 로그를 챗봇에서 분리 보관해야 하고, 이는 ADR-0002(영구삭제 시 하위 데이터 제거)와 충돌하는 별도 설계다
````
**바꿀 내용**
````text
**[정정 2026-09-24]** ~~삭제된 챗봇의 통계를 유지하려면 로그를 챗봇에서 분리 보관해야 하고, 이는 ADR-0002(영구삭제 시 하위 데이터 제거)와 충돌하는 별도 설계다~~ → ADR-0002는 대화로그가 있으면 영구삭제를 `409`로 막으므로(cascade 금지) **원천은 보존된다** — 콘솔의 "삭제"는 보관(`ARCHIVED`)이다. No.29에서 정리했다(`integrated-stats.md` §1.2.1, ADR-0033)
````

### D-2. `docs/02-spec/stats-learning-설계.md` 898행(§15)

**찾을 원문**
````text
**No.29**. ADR-0002(영구삭제 시 하위 데이터 제거)와 충돌하는 별도 설계가 필요하다
````
**바꿀 내용**
````text
**No.29**. **[정정 2026-09-24]** ~~ADR-0002(영구삭제 시 하위 데이터 제거)와 충돌하는 별도 설계가 필요하다~~ → ADR-0002는 대화로그가 있으면 영구삭제를 `409`로 막아 원천이 보존되므로 충돌하지 않는다. 원천 직접 집계 + 삭제 코드 0건 봉인 + 대화 당시 그룹 스냅샷으로 설계 완료(`integrated-stats-설계.md`, ADR-0033)
````

### D-3. `docs/02-spec/stats-learning-설계.md` 905행(§15) — KST 헬퍼 통합 각주

**찾을 원문**
````text
통합 시점은 **No.29** 착수 시 |
````
**바꿀 내용**
````text
통합 시점은 **No.29** 착수 시. **[갱신 2026-09-24] No.29에서 통합 설계 완료** — `dashboard-period.ts`의 재정의를 삭제하고 `kst-date.ts`를 import(동작 불변), `kst-date` ↔ `shared-types` 동치는 계약 테스트로 고정(`integrated-stats-설계.md` §7, ADR-0017 갱신) |
````

---

## E. `docs/requirements/integrated-stats.md` — PM 결정 기록

### E-1. §1.6 핵심 판단 표 머리 — PM 결정 표기

**찾을 원문**
````text
### 1.6 이 문서의 핵심 판단 15건 (⚠ = PM 확인 필요)
````
**바꿀 내용**
````text
### 1.6 이 문서의 핵심 판단 15건 (⚠ = PM 확인 필요)

> **PM 결정: 권고안 채택(2026-09-24)** — ⚠ 표시 항목(J-1·J-2·J-4·J-5·J-10·J-13)을 포함해 아래 "결정(제안)" 열이 전부 확정되었다. J-11(KST 헬퍼 통합)·J-12(세션 distinct 원시 SQL 확장, 롤업 미도입)는 architect 확정 사항이다. 세부 설계: `docs/02-spec/integrated-stats-설계.md` · ADR-0033.
````

### E-2. §11 PM 확인 항목 — 결정 기록

**찾을 원문**
````text
## 11. PM 확인이 필요한 항목
````
**바꿀 내용**
````text
## 11. PM 확인이 필요한 항목

> **PM 결정: 권고안 채택(2026-09-24)** — P-1~P-9 전부 아래 표의 "미확정 시 기본값(권고)" 열로 확정했다.
>
> | # | PM 결정(2026-09-24) |
> |---|---|
> | P-1 | **A** — 원천 `ConversationLog` 직접 집계(롤업 테이블 없음) + 로그 삭제 경로 0건 정적 검사 봉인. 롤업 재검토 트리거(1,000만 행 / 성능 예산 미달 / 로그 삭제 경로 도입)는 ADR-0033에 명시 |
> | P-2 | **허용하지 않음** — 대화로그 있는 챗봇의 로그 포함 영구삭제 불허(ADR-0002 유지, 삭제 = 보관) |
> | P-3 | **대화 당시 그룹** — `ConversationLog.groupId` 스냅샷을 `record()` 1곳에서 기록, 기존 행은 현재 소속으로 백필. 감사로그 기반 소급 재귀속 없음 |
> | P-4 | **보관** — 로그가 귀속된 그룹 삭제 시 `ChatbotGroup.archivedAt`, 목록·생성·이동 대상에서 숨김, 통계에는 "보관된 그룹" |
> | P-5 | **포함이 기본 + 토글로 제외 가능**(질문 순위만). 누적 KPI·요약·분포·기여표는 항상 포함 |
> | P-6 | **챗봇 스코프에만** 의도별 매칭, 삭제된 의도는 "삭제된 의도". 그룹 합산·FAQ/노드별 순위는 범위 밖 |
> | P-7 | **`stats:read` 신설 안 함**(`chatbot:read` 유지, 권한 15종 불변) |
> | P-8 | **콘솔 홈 `/`를 통합(전역) 통계로 대체** + 챗봇 목록 그룹 행에 "그룹 통계" 링크 |
> | P-9 | **GPU 1 유지** |
````

---

## F. 적용 후 확인 체크리스트

- [ ] A-1~A-23 · B-1~B-7 · C-1 · D-1~D-3 · E-1~E-2 각 "찾을 원문"이 적용 전 대상 파일에서 정확히 1회 검색되는지(0회 = 파일이 그 사이 바뀜 → 이 문서를 갱신 후 적용).
- [ ] 개발명세서 §7 인덱스에 설계서·ADR-0033 행이 각 1개인지.
- [ ] `docs/04-test/시험항목.md`·`시험데이터.md`에 AC-I1~I6 및 그룹 이동·보관·자정 걸친 세션·성능 픽스처 항목 추가는 **test-automation 단계**에서 한다(이 목록에 포함하지 않음).
- [ ] `docs/03-design/UIUX_준수기준.md`의 차트 표 대체·상태 배지 텍스트 병기 규칙 보강 여부는 **ui-designer 판단**(개발명세서 §5 접근성 항목에 이미 명시되어 있어 필수 아님).
