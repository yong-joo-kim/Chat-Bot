# ADR-0004 — 대시보드 집계 전략 (DB 그룹화 + 순수 함수 정규화)

- **상태**: 채택 (Accepted)
- **일자**: 2026-09-19
- **결정자**: system-architect
- **관련**: `docs/requirements/chatbot-operations.md` FR-2-1 ~ FR-2-4, FR-2-9, NFR-P2, NFR-M3, EX-2-3, EX-2-5
- **영향 범위**: `apps/api/src/stats/*`

## 맥락

대시보드는 `ConversationLog` 10만 건 / 기간 30일 기준 **P95 500ms**(NFR-P2)를 요구한다. 동시에 NFR-M3은 "집계 로직을 순수 함수로 분리해 DB 없이 단위 테스트 가능하게" 요구한다. 두 요구는 서로 당긴다.

특히 `topQuestions`(FR-2-4)는 `userMessage`를 **정규화한 값**(앞뒤 공백 제거 + 연속 공백 1칸 축약)으로 그룹핑해야 한다. DB에는 정규화된 컬럼이 없고, SQLite에는 정규식 치환 함수도 없다. dev DB가 SQLite라는 제약(개발명세서 §6-4)도 고려해야 한다.

## 결정

**3쿼리 + 순수 함수** 조합을 채택한다.

| 지표 | 방식 |
|---|---|
| `totalLogCount`, `responseRate` | `prisma.conversationLog.groupBy({ by: ['isAnswered'], where, _count: { _all: true } })` — 1쿼리 |
| `visitCount` | `$queryRaw` 1회 — `COUNT(DISTINCT sessionId)` + `COUNT(* WHERE sessionId IS NULL)` (ADR-0001) |
| `topQuestions` | `groupBy({ by: ['userMessage'], where, _count, _max: { createdAt }, orderBy: { _count: { userMessage: 'desc' } }, take: 500 })` → 애플리케이션 순수 함수가 정규화·병합·정렬 |

- **순수 함수 계약**: `aggregateTopQuestions(rows: { question, count, lastOccurredAt }[], topN): { question, count }[]`
  - 정규화 `trim()` + `replace(/\s+/g, ' ')` 후 동일 키 병합(count 합산, `lastOccurredAt`은 최댓값)
  - 빈 문자열 제외(EX-2-3). 단 `totalLogCount`·응답률 분모에는 포함된다
  - `count desc` → 동률 시 `lastOccurredAt desc`
- `TOP_QUESTION_CANDIDATE_LIMIT = 500` 상수로 후보 개수를 제한한다.
- 비율은 `round4()` 적용, `noResponseRate = round4(1 - responseRate)`로 **파생**해 합이 정확히 1이 되게 한다. `total === 0`이면 둘 다 0(FR-2-9).
- 3쿼리를 `Promise.all`로 병렬 실행하고, 전체를 5초 타임아웃으로 감싸 초과 시 `503 AGGREGATION_TIMEOUT`(EX-2-5).
- `where`에는 항상 `chatbotId` + `createdAt` 범위가 **먼저** 들어간다(`conversation_logs(chatbotId, createdAt)` 인덱스 적중, 요구사항 D-2).

## 근거

- **"기간 필터된 로그 전량을 메모리로 가져와 집계"는 NFR-P2를 만족할 수 없다.** 10만 건 × 문자열 2개를 Node 힙에 올리면 수십 MB와 직렬화 비용이 든다. 반면 `groupBy(userMessage)` 결과는 **질문 종류 수**만큼이라 카디널리티가 1~2자릿수 작다.
- **정규화 병합을 애플리케이션에서 하는 것이 정확도와 이식성 모두에 유리하다.** SQLite에는 정규식 치환이 없고, Postgres의 `regexp_replace`를 쓰면 DB 종속 SQL이 늘어 Postgres 전환 전까지 dev/prod 동작이 달라진다. 정규화 규칙은 **단 하나의 순수 함수**에만 존재해야 한다(NFR-M3, 단위 테스트로 AC-2-4 직접 검증).
- **`take: 500`은 의도적인 근사다.** 정규화 병합으로 순위가 바뀌려면 "정규화 전 순위 500위 밖의 변형들이 합쳐져 상위 5위 안에 들어야" 하는데, 실무 질의 분포(롱테일)에서 발생 확률이 매우 낮다. 반대로 제한을 두지 않으면 질문 종류가 수만 가지인 챗봇에서 응답이 붕괴한다. **정확도 손실의 상한이 예측 가능하고, 성능 하한이 보장되는 쪽**을 택했다.
- **비율을 파생값으로 계산**하는 이유: `responseRate`와 `noResponseRate`를 각각 반올림하면 합이 `0.9999`나 `1.0001`이 되어 AC-2-1("합은 정확히 1")이 깨진다.
- **타임아웃 시 캐시를 반환하지 않는 이유**: 운영 지표는 "오래된 값을 조용히 보여주는 것"이 "못 불러왔다고 말하는 것"보다 위험하다(EX-2-5 명시 요구).

## 대안과 트레이드오프

| 대안 | 기각 사유 |
|---|---|
| 로그 전량 `findMany` 후 전부 메모리 집계 | NFR-P2 위반. 가장 테스트하기 쉽지만 확장성이 없다 |
| 전부 원시 SQL 1쿼리 | 정규식 정규화가 SQLite에서 불가. DB 종속 SQL이 늘어 Postgres 전환 시 재작성 필요. 순수 함수 단위 테스트(NFR-M3)도 불가 |
| `normalizedMessage` 컬럼 즉시 추가 + DB 그룹핑 | 가장 정확하고 빠르지만, **쓰기 주체가 없다**(대화로그 생성은 대화 엔진 Phase). 지금 넣으면 값을 채울 수 없는 컬럼만 생긴다 → **대화 엔진 Phase의 후속 조치로 예약** |
| 집계 결과 캐시(Redis) | Redis는 확장기능 Phase까지 도입하지 않기로 결정(개발명세서 §6-4). 현 데이터 규모에 과설계 |
| 일/주 단위 집계 테이블(Materialized) | 시계열 드릴다운이 필요한 No.14/No.29 범위. 현 Phase에는 과설계 |

**감수하는 비용**: ① `topQuestions`는 극단적 고카디널리티 상황에서 근사값이다. ② 원시 SQL 1회가 존재한다 — `stats.service.ts` 한 파일로 격리하고 SQLite/Postgres 공통 문법만 사용해 통제한다.

## 결과

- `stats/lib/dashboard-aggregator.ts`(순수), `stats/lib/dashboard-period.ts`(순수), `stats/stats.service.ts`(유일한 원시 SQL 보유처)로 분리.
- `DashboardSummarySchema`에 `totalLogCount`, `visitCountBasis` 추가(집계 건수 배지 FR-2-12, 산정 기준 캡션 FR-2-1).
- 후속: 대화 엔진 Phase에서 `ConversationLog.normalizedMessage` 도입을 재검토하고, 도입 시 `aggregateTopQuestions`의 정규화 단계를 우회 가능하게 한다(함수 계약은 유지).


---

## 갱신 (2026-09-24 — No.29에서도 일/주 집계 테이블 미도입)

대안 표의 "일/주 단위 집계 테이블 — No.14/No.29 범위"에 대해: **No.29(통합 통계)도 집계 테이블을 도입하지 않는다**(ADR-0033 §1·§7). 그룹·전역 스코프는 이 ADR의 "DB 그룹화 + 순수 함수" 방식을 `where`만 넓혀 재사용하며, `aggregateTopQuestions`·`computeResponseRates`·`computeVisitCount`의 계약은 불변이다(`normalizeQuestion`은 질문별 최다 챗봇 귀속을 위해 **export만** 추가 — 규칙 1벌 유지). 후보 상한 500의 근사 규약은 그룹 질문 순위와 최다 챗봇 귀속에도 그대로 적용된다. 원시 SQL 격리 원칙(감수 비용 ②)은 **"`stats` 모듈의 지정 파일"** 로 범위만 넓힌다 — 대시보드 원시 SQL(`stats.service.ts`)은 무변경이고, 그룹·전역 세션 distinct 1건이 `stats/integrated/integrated-session.query.ts`에 격리된다(보유 파일 목록은 정적 검사로 고정).
