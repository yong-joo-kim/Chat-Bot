# ADR-0033 — 누적 통계 보존 = 원천 로그 직접 집계 + 로그 삭제·변경 경로 봉인, 대화 당시 그룹 스냅샷 귀속

- **상태**: 채택 (Accepted)
- **일자**: 2026-09-24
- **결정자**: system-architect (PM 확정 P-1~P-9 — 전부 권고안, 2026-09-24)
- **관련**: `docs/requirements/integrated-stats.md` **J-1~J-5 · J-10 · J-12**, FR-0-89~95, FR-I1-\*, FR-I2-\*, FR-I7-\*, AC-I1/I3/I4/I6 / **ADR-0002**(영구삭제 참조 무결성) · **ADR-0004**(집계 = DB 그룹화 + 순수 함수, 소비자 없는 구조 금지) · **ADR-0017**(KST 파생 컬럼 · 집계 테이블 미도입 · 세션 원시 SQL 탈출구) · ADR-0001(방문수 = 세션 distinct) · ADR-0013(마스킹 적재 1곳) · ADR-0015(멀티테넌시 없음) · ADR-0032(`PollingLoop`)
- **영향 범위**: `apps/api/prisma/schema.prisma`(`ConversationLog.groupId` · `ChatbotGroup.archivedAt` · `Chatbot.archivedAt` · 인덱스 2), `apps/api/prisma/scripts/backfill-conversation-group.ts`(신규), `apps/api/src/conversation/conversation-log.service.ts`, `apps/api/src/rag/{conversation-log.port,rag-answer.service}.ts`, `apps/api/src/conversation/public-conversation.service.ts`, `apps/api/src/chatbot-groups/*`, `apps/api/src/chatbots/*`, `apps/api/src/stats/**`
- **세부 설계**: `docs/02-spec/integrated-stats-설계.md`

## 맥락

카탈로그 No.29는 "**챗봇 삭제되어도 그룹(서비스) 기준 누적 통계 유지**"다. 선행 문서(`stats-learning.md` 729행, `stats-learning-설계.md` 898행)는 이것을 "ADR-0002(영구삭제 시 하위 데이터 제거)와 **충돌**하는 별도 설계"로 넘겼다. 코드를 확인한 결과 이 전제는 **사실과 반대**다.

| 사실 | 근거 |
|---|---|
| 콘솔의 "삭제" = 보관(`status='ARCHIVED'`)이며 로그에 아무 일도 일어나지 않는다 | `chatbots.service.ts:266-279` |
| 영구삭제는 대화로그·미응답이 1건이라도 있으면 `409 CHATBOT_HAS_CHILDREN` | `chatbots.service.ts:291-328` |
| 영구삭제 동반 삭제 14테이블은 전부 파생 데이터이며 `ConversationLog`는 없다 | `chatbots.service.ts:342-366` |
| DB FK `conversation_logs.chatbotId → chatbots ON DELETE RESTRICT` | `schema.prisma:372`, 최초 마이그레이션 |
| `conversationLog.deleteMany` 호출은 개발 시드뿐 | `prisma/seed.ts:153,229` |
| ADR-0002는 이미 "대화로그가 쌓인 챗봇은 사실상 영구 삭제가 불가능, `ARCHIVED`가 최종 정리 수단"을 **감수 비용으로 명시**했다 | ADR-0002 54행 |

즉 **원천은 이미 구조적으로 보존된다.** 실제 공백은 네 가지였다 — ① 그룹·전역 집계 부재 ② 보관 챗봇이 목록에서 보이지 않음 ③ **`ConversationLog`에 그룹 정보가 없어 조회 시점 조인으로 합산하면 그룹 이동이 과거 누적을 소급 변경한다**(`moveGroup()`은 `Chatbot.groupId`만 바꾼다 — `chatbots.service.ts:204-221`) ④ 미래의 삭제 경로(ADR-0002 54행이 예고한 "함께 삭제" 플로우 · No.45 보존기간 · 파기 요청)를 막는 장치가 "아무도 안 지운다"는 **우연**뿐이다.

## 결정

### 1. 통합 통계의 원천은 `ConversationLog` 직접 집계다 — 롤업/사전 집계 테이블을 만들지 않는다

No.14와 같은 방식(DB `groupBy` + 순수 함수)을 **`where` 절만 넓혀** 재사용한다. 지표 계산식은 한 벌이며(ADR-0004), 챗봇 스코프 조립 코드 중 서비스에 인라인이던 부분(버킷 조립·`turnsPerSession`·출처/채널 비율)을 순수 함수로 추출해 두 스코프가 같은 함수를 호출한다. 통계는 쓰기 대상 테이블이 0개다.

### 2. "삭제되어도 유지"는 약속이 아니라 **3층 구조**로 보장한다

| 층 | 장치 | 성격 |
|---|---|---|
| L1 DB | `ConversationLog`·`UnansweredQuestion` → `Chatbot` FK `onDelete: Restrict` | 최종 방어선(기존) |
| L2 서비스 | 영구삭제 사전검사의 `conversationLogs`·`unansweredQuestions` 409(ADR-0002 결정 3) — **이 409를 "누적 통계 보존 장치"로 명문화**한다 | UX + 정책(기존, 의미 부여) |
| L3 정적 검사 | `stats-retention-sealing.spec.ts` — `apps/api/src`에서 두 모델의 `delete`/`deleteMany`/원시 `DELETE` **0건**, 스키마의 `Cascade`/`SetNull` 부재, 사전검사 목록에 두 키 존재, 로그 `create`는 `record()` 1파일, 로그 `update*`는 **0건** | CI가 "편의상 추가"를 잡는다(신규) |

사용자 관점의 "삭제" = 보관(`ARCHIVED`)이며 보관 챗봇의 로그는 **항상** 그룹·전역 합계에 포함된다(합계에서 빼는 옵션을 두지 않는다 — 옵션 하나로 약속이 깨지지 않게). 질문 순위만 "보관 챗봇 포함" 토글(기본 포함)을 허용한다.

### 3. 향후 로그 삭제 경로의 규약을 지금 고정한다 (이번 구현 없음)

로그를 지우는 기능이 필요해지면(ADR-0002 "함께 삭제" · No.45 보존기간 정리 · 정보주체 파기 요청) **단일 서비스**로만 추가하고, 그 서비스는 **같은 트랜잭션에서 수치 롤업을 먼저 적재한 뒤** 원천을 삭제한다(대안 B). 롤업 = `(chatbotId, dayBucket, channelType)` 키 · `groupId` 스냅샷 · 턴/응답/차단/출처 5종/시간대 24칸/일 세션 수 — **텍스트·세션 ID·의도 ID를 담지 않는다**(삭제 = 원문 파기, 누적 = 수치 보존). 정적 검사의 허용 목록 상수(`LOG_DELETION_ALLOWLIST`)는 현재 **빈 배열**이며, 그 서비스 1파일 추가는 이 ADR을 대체·갱신하는 결정과 함께만 가능하다.

### 4. 그룹 귀속 = **대화 당시 그룹** — `ConversationLog.groupId` 스냅샷

- `groupId String @default("")`, **FK 없음**(그룹 행 정리와 로그 보존 분리 — `matchedIntentId`·`AuditLog.chatbotId` 선례), 인덱스 `(groupId, dayBucket)`.
- **쓰기 주체 = `ConversationLogService.record()` 1곳.** 호출부는 `PublicAccessService.resolve()`가 이미 읽은 챗봇 행의 `groupId`를 넘기므로 **추가 조회 0**. 파라미터는 `record()`·`ConversationLogPort`·`RagAnswerRunInput` 세 타입에서 **필수** — 누락은 빌드 실패. 스냅샷 시점은 턴 처리 시작 시 읽은 행이다(RAG 보류 답변도 요청 시점 그룹).
- **적재 후 불변** — `src`에 로그 `update*` 코드 0건(정적 검사). 그룹 이동은 로그를 건드리지 않으므로 이동 전 누적이 소급 변경되지 않는다.
- 기존 행은 1회성 백필로 **현재 `Chatbot.groupId`** 를 채운다(배치 2,000행 · 멱등 · `''` 조건 재확인). **감사로그 기반 소급 재귀속은 하지 않는다**(No.13 이전 이동은 복원 불가 — 부분 정확성). `''`는 백필 미완 센티넬이며 남아 있으면 응답에 `backfillPending: true`를 싣는다(조용한 과소 집계 금지).

### 5. 로그가 귀속된 그룹의 삭제 = **보관**(`ChatbotGroup.archivedAt`) — ADR-0002 결정 6의 확장

소속 챗봇이 있으면 기존 `409 GROUP_NOT_EMPTY`(판정 불변). 비어 있고 귀속 로그가 **1건 이상**이면 물리 삭제 대신 `archivedAt = now`, 0건이면 현행 물리 삭제 — 응답은 둘 다 `204`, 감사는 둘 다 `DELETE`(보관 시 summary `그룹 보관(통계 보존)`). 보관 그룹은 그룹 목록·수정·복사·삭제와 챗봇 생성·이동·복사의 대상에서 제외(`404`)되고, 통합 통계에는 "보관된 그룹"으로 남는다. 챗봇 소프트 삭제를 기각한 사유(`slug` unique 충돌 — ADR-0002 51행)는 그룹에 해당하지 않는다(이름 유일 제약 없음). 보관 그룹 되살리기는 1차 범위 밖.

### 6. 그룹·전역 스코프의 세션 distinct는 원시 SQL로 계산한다 (ADR-0017 §4 탈출구 이행)

- 챗봇 스코프(No.14)의 앱 폴딩 방식은 **바꾸지 않는다.** 그룹·전역 스코프만 DB가 `COUNT(DISTINCT)`를 계산해 반환 행 수가 **세션 수와 무관**하게 한다.
- **버킷 키 규칙은 TS에 1벌** — ISO 주차·KST 달력월을 SQL 날짜 함수로 재구현하지 않고, TS가 만든 버킷별 `dayBucket` 범위 목록을 `CASE WHEN "dayBucket" BETWEEN ? AND ? THEN ?`로 바인딩한다. 주/월 세션 = 일 버킷의 합집합(DD-61)이 정확히 보존된다.
- **세션 키 = `chatbotId || '|' || sessionId`**(서로 다른 챗봇의 세션은 별개 — 클라이언트가 보내는 값이므로 정의로 보장). `sessionId IS NULL` 행은 각 1세션(ADR-0001).
- 서브쿼리 + `CASE` + `COUNT(DISTINCT)` + `||` + `SUM`만 쓰는 SQLite/Postgres 공통 문법, 전 입력 바인딩(`$queryRawUnsafe` 금지), **격리 파일 1개**(`stats/integrated/integrated-session.query.ts`). 원시 SQL 보유 파일은 대시보드(`stats.service.ts` — 무변경)·이 파일·헬스체크 3개로 고정한다.

### 7. 롤업 도입 재검토 트리거 (개발명세서 §3 미도입 결정 ⑦ 갱신)

| # | 트리거 | 이어지는 대안 |
|---|---|---|
| ① | `ConversationLog` **1,000만 행** 도달(기존 ADR-0017 트리거 유지) | C(상시 일 롤업, `PollingLoop` 재사용) — 세션은 원천 조회 유지 하이브리드부터 |
| ② | 그룹 스코프 **누적 KPI P95 2초 · 기간 조회 P95 1초(일 30일)/2초(월 24개월)** 를 기준 데이터(그룹 100만·전역 300만 행)에서 실측 미달 — 단, 커버링 인덱스 `(groupId, dayBucket, chatbotId, sessionId)` 1차 완화 후에도 | C |
| ③ | **로그 삭제 경로 도입**(No.45 보존기간·파기 · ADR-0002 "함께 삭제") | **B 필수**(결정 3 규약) |
| ④ | 그룹별 접근 제한/멀티테넌시(No.45) | `stats:read` 신설 재검토 · 스코프 필터 교체(`scopeLogWhere()` 1곳) |
| ⑤ | 과거 그룹 이동의 정확한 재귀속 요구 | 감사 기반 재구성 스크립트(부분 정확성 고지 전제) |

### 8. 권한 — `stats:read`를 신설하지 않는다

통합 통계 7개 핸들러 전부 `chatbot:read`. 세 역할 모두 이미 전 챗봇의 통계를 개별 조회할 수 있어 합산은 새 정보를 노출하지 않으며, 신설해도 3역할 모두에 부여하게 되어 판정 차이가 0이다(ADR-0015 감수 비용 2 "No.14에서 전역 통계 API가 추가될 때 `stats:read` 신설 검토"의 검토 결과). 재검토는 트리거 ④.

## 근거

- **"충돌"이 없는 곳에 해법을 만들지 않는다.** 원천이 구조적으로 보존되는 시스템에서 B(삭제 시 롤업)는 영구삭제가 로그를 지우기 전까지 **한 행도 쓰이지 않는 테이블**이고, C(상시 롤업)는 원천이 있는데 사본을 만드는 구조다. "쓰기 주체·수용기준 없는 구조는 만들지 않는다"(ADR-0004, ADR-0015)에 어긋난다.
- **보존을 우연이 아니라 구조로.** ADR-0002가 `onDelete: Restrict` 명시로 "리뷰 포인트"를 만든 것과 같은 방식으로, 삭제·변경 코드 0건을 CI가 단언한다. 누군가 편의상 `deleteMany`나 "이동 시 로그도 옮기기"를 추가하는 순간 실패한다.
- **대화 당시 그룹이 "그룹(서비스) 기준 누적 **유지**"의 유일하게 정합적인 해석이다.** 현재 그룹 방식은 이동할 때마다 이전 그룹의 지난달 수치가 줄어든다 — "유지"와 정면 충돌하는 유일한 현재 경로(G-3)다. 비용은 로그 컬럼 1개 + 백필 1회이고, 적재 경로는 이미 챗봇 행을 들고 있어 추가 조회가 없다.
- **C는 성능 문제이지 보존 문제가 아니다.** No.28이 `PollingLoop`을 만들어 ADR-0017의 기각 사유 중 "채울 주체가 없다"는 해소됐지만, 나머지 — 집계 정의 변경 시 재계산 경로, 주/월 세션 수의 일 롤업 재현 불가(DD-61), 질문 순위의 원천 의존, 트리거(1,000만 행) 미도달 — 는 그대로다.
- **SQL 버킷 식을 TS 범위 목록으로 만드는 이유**: 주차 규칙이 SQL과 TS 두 벌이 되면 경계(연말 ISO 주차)에서 반드시 어긋난다. 범위 바인딩은 DB 날짜 함수 없이 공통 문법만으로 합집합 의미를 보존한다.

## 대안과 트레이드오프

| 대안 | 기각 사유 |
|---|---|
| **B. 삭제 시점 스냅샷(묘비 롤업) + 로그 포함 영구삭제 허용** | ADR-0002 결정 변경 + 자산 9종 "함께 삭제" 여부 + 삭제 미리보기 UI를 수반하는 **제품 정책 결정**이며 PM이 불허했다(P-2). 조회가 원천 ∪ 롤업 두 원천이 되어 정의 드리프트 위험, 삭제된 챗봇의 주/월 세션은 일 합산 근사, 대량 로그 챗봇 삭제 트랜잭션의 SQLite 쓰기 잠금. **결정 3으로 "다음 단계의 유일한 삭제 경로"로 설계를 고정**해 둔다 |
| **C. 상시 사전 집계(일 롤업 배치)** | 재계산 경로 · DD-61 불일치 · 당일분 하이브리드 · 백필/misfire/다중 인스턴스 멱등 · 질문 순위는 롤업 불가. 트리거 ①② 미도달 |
| **D. 영구삭제 시 로그를 챗봇에서 분리(묘비 챗봇·nullable)** | ADR-0002가 `SetNull`을 고아 레코드 사유로 기각. 원문(마스킹본)이 남아 파기 요구와 충돌하면서 파기의 이점도 없다 |
| **조회 시점 조인(현재 그룹 귀속)** | 그룹 이동이 과거 누적을 소급 변경 — "유지" 위반. 스키마 변경이 없다는 이점뿐 |
| **감사로그 `소속 그룹 이동` 기반 소급 재귀속** | No.13 이전 이동은 복원 불가(부분 정확성) · 통계가 감사 도메인에 의존 · 감사 보존 정책(No.45)에 종속 |
| **그룹 삭제 = 409 차단(로그 있으면)** | 빈 폴더를 영원히 지울 수 없어 그룹 목록이 쌓인다 |
| **그룹 삭제 = 현행 물리 삭제(통계는 "알 수 없는 그룹")** | 과거 통계의 그룹명을 잃는다. 이름 스냅샷 컬럼을 로그에 두면 행마다 문자열 중복 + 그룹명 변경 시 과거·현재 이름이 섞인다 |
| **`ConversationLog.groupId`에 FK** | `Restrict`면 로그가 있는 그룹을 영원히 못 지우고(보관 필요성은 같다), `SetNull`이면 귀속이 사라진다 |
| **세션 distinct도 앱 폴딩 유지** | 그룹·전역 스코프에서 반환 행이 세션 수에 비례(100만 행 그룹 = 수십만 행 직렬화) — NFR-IP3 위반 |
| **챗봇 스코프 세션도 원시 SQL로 통일** | 기존 AC·응답 무변경(FR-0-90)이 우선. 같은 결과를 내는 두 경로의 동치는 "챗봇 1개 그룹 = 챗봇 수치" 계약 테스트로 고정한다 |
| **`stats:read` 신설** | 판정 차이 0인 권한은 개념만 늘린다(결정 8) |

## 감수하는 비용

1. **대화가 있었던 챗봇은 영원히 영구삭제할 수 없다**(현행 그대로). 사용자에게 "삭제" = 보관이다 — 화면 문구로 명시한다.
2. **대화로그 보존기간이 무기한이다**(현행 그대로 — 악화 아님). 이름·주소는 규칙 기반 마스킹으로 탐지되지 않는다(ADR-0013 §6). No.45 전까지의 알려진 리스크로 개발명세서 §5에 기록한다.
3. **로그 컬럼 1개 + 인덱스 2개가 늘고 백필이 배포 절차의 일부가 된다.** 백필 전에는 그룹 집계가 불완전하며 `backfillPending`으로 드러난다.
4. **백필 이전의 그룹 이동 이력은 현재 소속으로 뭉개진다.** 스크립트 출력·릴리스 노트에 명시한다.
5. **원시 SQL 보유 파일이 1개 늘어난다**(2 → 3, 헬스체크 포함). 파일 격리·공통 문법·바인딩 전용·정적 검사로 통제한다.
6. **그룹 보관 판정·챗봇 이동의 경합 방어가 SQLite 쓰기 직렬화에 기댄다** — Postgres 전환 시 두 트랜잭션을 `Serializable` 대상에 추가한다.

## 결과

- Prisma: `ConversationLog.groupId`(+ `@@index([groupId, dayBucket])`, `@@index([dayBucket])`) · `ChatbotGroup.archivedAt` · `Chatbot.archivedAt`(보관일 표시 — 기존 보관 챗봇은 마이그레이션에서 `updatedAt` 근사). 기존 테이블 비파괴 `ADD COLUMN`만, 롤백 = DROP.
- `prisma/scripts/backfill-conversation-group.ts` 신설(멱등·재개 가능·검증 쿼리 0건 게이트).
- `record()`·`ConversationLogPort`·`RagAnswerRunInput`에 `groupId` 필수.
- `ChatbotGroupsService.remove()` = 이력 있으면 보관 · 보관 그룹 제외 7지점.
- `stats` 모듈: `integrated/`(컨트롤러·서비스·세션 원시 SQL 1파일) · `intents/` · `lib/`(순수 함수 5종 신설 + 조립 코드 추출) · `stats-retention-sealing.spec.ts`(R-1~R-10).
- 신규 `ApiErrorCode` 0 · 신규 권한 0 · `@Public()` 6 유지 · 신규 환경변수 0 · 엔진 변경 0 · ml-worker 변경 0.
- **개발명세서 갱신**: §2·§2.2·§3(엔터티 3행·미도입 ⑦)·§3.1(FK 예외·동반 삭제 비대상·인덱스)·§4(통계 행·정정 이력)·§4.1·§5(성능·보안 리스크·DB 이식성)·§5.1·§6(결정 20·21 각주, 결정 34)·§7.
- **갱신 각주**: ADR-0002(409 = 누적 통계 보존 장치 · 그룹 보관) · ADR-0004 · ADR-0015 · ADR-0017 · ADR-0001.
- `test-automation` 인계 ★: AC-I1-1(보관 후 누적 불변) · AC-I1-3(봉인 — 역검증 포함) · AC-I2-1(챗봇 1개 그룹 = 챗봇 수치, 두 세션 경로 동치) · AC-I3-1(이동 전후 귀속) · AC-I6-1(기존 통계 무수정 통과) · AC-I6-6(성능·타임아웃).
- `code-reviewer` 인계: ① `where`에 챗봇 상태 조건이 없는가 ② 조립 계산식이 서비스에 인라인으로 남지 않았는가 ③ 원시 SQL이 격리 파일 밖에 없고 전부 바인딩인가 ④ `groupId`가 세 타입에서 필수인가 · 추가 조회 0인가 ⑤ 보관 그룹 제외 7지점 ⑥ `dashboard-period.ts` 본문 무변경 ⑦ `EXPLAIN QUERY PLAN`으로 신규 인덱스 적중.


---

## 갱신 (2026-09-24 — No.27: 봉인 대상에 설문 응답 2모델 추가 · 설문 롤업 규약 · `groupId` 스냅샷 재사용)

설문관리(No.27, **ADR-0035 §8**)의 응답은 참여 통계의 **유일한 원천**이므로 이 ADR의 3층 보존 구조를 그대로 확장한다. 결정 1~8은 불변이다.

1. **L1 DB**: `SurveyResponse → Chatbot·Survey`, `SurveyAnswer → SurveyResponse` FK `onDelete: Restrict`(Cascade/SetNull 없음).
2. **L2 서비스**: 챗봇 영구삭제 사전검사에 `surveys`('설문')·`surveyResponses`('설문 응답')를 추가한다(9 → 11종, 동반 삭제 목록에 넣지 않는다). 응답(노출 포함)이 있는 설문은 삭제 불가(`409 SURVEY_HAS_RESPONSES`) → 마감으로 대체.
3. **L3 정적 검사**(`survey-sealing.spec.ts`): 두 모델의 `delete`/`deleteMany`/원시 `DELETE` **0건** · `create`/`update*`는 `SurveyResponseService` **1파일** — 로그와 달리 응답 행은 진행에 따라 **상태가 바뀌어야** 하므로 `update`를 금지하지 않고 쓰기 주체를 1파일로 한정한다(조건부 갱신의 원자성·쓰기 가드가 그 파일 안에 있다). 통계 모듈(`stats/surveys/`)은 R-8(Prisma 쓰기 0)이 그대로 적용된다.
4. **결정 3 확장 — 설문 롤업 규약**: 향후 응답 삭제(No.45 보존기간·정보주체 파기)도 **단일 서비스 + 같은 트랜잭션의 수치 롤업 선적재**로만 추가한다. 설문 롤업 = `(surveyId, dayBucket, channelType)` 키의 상태·시작 여부별 건수 + 문항·선택지/값별 건수 + `groupId` 스냅샷 — **텍스트·세션 ID를 담지 않는다**.
5. **결정 4 재사용**: `SurveyResponse.groupId` = **노출 당시** 챗봇 소속 그룹 스냅샷(FK 없음 · 적재 후 불변 · 호출부가 이미 읽은 챗봇 행에서 — 추가 조회 0). 그룹·전역 설문 통계는 1차 범위 밖이지만 후속 통합이 과거를 소급 변경하지 않도록 지금 적재한다.
6. **질문 순위의 원천 규칙 보강**: 설문이 소비한 턴(`ConversationLog.surveyTurn=true`)은 챗봇·그룹·전역 **모든 스코프의 질문 순위**에서 같은 조건 상수 1벌로 제외한다. 턴 수·세션·응답률·출처 집계는 불변이며 기존 행은 전부 false라 과거 수치가 바뀌지 않는다.


---

## 갱신 (2026-09-25 — No.24: 봉인 대상에 상담 스레드 2모델 · 원문은 행 삭제가 아니라 필드 소거 · 질문 순위 규칙 보강 · R-7 원시 SQL 4번째 파일)

하이브리드 CS(No.24, **ADR-0036 §8**). 결정 1~8은 불변이다.

1. **L1 DB**: `HandoffSession → Chatbot`, `HandoffMessage → HandoffSession` FK `onDelete: Restrict`.
2. **L2 서비스**: 챗봇 영구삭제 사전검사에 `handoffSessions`('상담')·`cannedResponses`('자주 쓰는 문장') 추가(11 → 13종, 동반 삭제 목록에 넣지 않는다 — `ChatbotHandoffSetting`만 설정 데이터로 동반 삭제).
3. **L3 정적 검사**(`handoff-sealing.spec.ts`): 두 모델의 `delete`/`deleteMany`/원시 `DELETE` **0건** · 쓰기 파일 1개 · **`HandoffMessage`의 유일한 갱신은 원문 필드(`rawText`·`rawExpiresAt`)의 `null` 소거**. PM 결정 P-9의 원문 파기는 **행 삭제가 아니라 필드 소거**로 설계되어 이 봉인과 충돌하지 않는다.
4. **질문 순위의 원천 규칙 보강**: 상담 구간 턴(`ConversationLog.handoffTurn=true`)도 설문 턴과 같은 상수 1벌로 **모든 스코프의 질문 순위**에서 제외한다. 턴 수·세션·응답률·출처(`OTHER`) 불변, 기존 행 false.
5. **R-7 갱신**: 원시 SQL 보유 파일 3 → **4**(`handoff/handoff-secure-delete.query.ts` — `PRAGMA secure_delete` 1줄, 원문 소거 트랜잭션의 SQLite 페이지 잔존 제거). `$executeRaw` 계열 0건은 유지한다.
6. **롤업 규약**: 향후 상담 기록 삭제(No.45 보존기간)도 단일 서비스 + 같은 트랜잭션의 수치 롤업 선적재로만 추가한다 — 상담 롤업 = `(chatbotId, dayBucket)` 키의 건수·종료 사유·첫 응답/상담 시간 합계 + `groupId` 스냅샷(텍스트·세션 ID 없음).


---

## 갱신 (2026-09-25 — No.44: 봉인 대상에 평가 원장 · 로그 표식 2컬럼 · `groupId` 스냅샷 복사)

피드백 기반 개선 루프(No.44, **ADR-0038 §3**). 결정 1~8은 불변이다.

1. **L1 DB**: `MessageFeedback → Chatbot` FK `onDelete: Restrict`(Cascade/SetNull 없음). `conversationLogId`는 FK 없음(로그 규약).
2. **L2 서비스**: 챗봇 영구삭제 사전검사에 `messageFeedbacks`('답변 평가')를 추가한다(14 → 15종, 동반 삭제 목록에 넣지 않는다). 원장 행은 로그 행 없이 생길 수 없어 차단 집합은 실질적으로 불변이다.
3. **L3 정적 검사**(`feedback-sealing.spec.ts`): 원장의 `delete`/`deleteMany`/원시 `DELETE` **0건** · 쓰기 1파일 · 컬럼 이름 허용 목록(텍스트·`sessionId` 없음). **로그 `update*` 0건(R-10)은 유지된다** — 평가값은 로그에 쓰지 않고 별도 원장에 둔다. 로그에 새로 생기는 `feedbackOffered`·`inputKind`는 `groupId`와 같이 **적재 시점에 확정되는 사실**이며 `record()` 1곳에서만 쓴다.
4. **결정 4 재사용**: `MessageFeedback.groupId` = 로그의 `groupId` 복사(**대화 당시** 그룹 — 평가 시점 소속이 아니다). 그룹·전역 만족도는 1차 범위 밖이지만 후속 통합이 과거를 소급 변경하지 않도록 지금 적재한다.
5. **롤업 규약**: 향후 원장 삭제(No.45 보존기간·파기)도 단일 서비스 + 같은 트랜잭션의 수치 롤업 선적재로만 추가한다 — 평가 롤업 = `(chatbotId, turnDayBucket, targetKind, targetId)` 키의 👍/👎 건수 + `groupId` 스냅샷(텍스트·세션 ID 없음).
