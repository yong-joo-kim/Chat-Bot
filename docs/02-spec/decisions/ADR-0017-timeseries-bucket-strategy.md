# ADR-0017 — 시계열 집계 버킷 전략(KST 파생 컬럼) 과 집계 계산 위치

- **상태**: 채택 (Accepted)
- **일자**: 2026-09-22
- **결정자**: system-architect
- **관련**: `docs/requirements/stats-learning.md` **J-3**, FR-0-31/32, FR-14-4~12, FR-14-28~30, NFR-P1/P2/P6/P7, NFR-M1/M5, AC-14A-1~13, AC-14B-5, AC-X-6/X-7, EX-14-7/EX-14-8/EX-14-12 / `ADR-0004`(집계는 DB `groupBy` + 앱 순수함수, 소비자 없는 구조 금지) / `ADR-0001`(접속수 산정) / `ADR-0006`(정규화 결과를 컬럼으로 저장한 선례)
- **영향 범위**: `apps/api/prisma/schema.prisma`(`ConversationLog`), `apps/api/prisma/scripts/backfill-conversation-buckets.ts`(신규), `apps/api/src/conversation/conversation-log.service.ts`, `apps/api/src/stats/**`, `packages/shared-types/src/common.ts`
- **세부 설계**: `docs/02-spec/stats-learning-설계.md` §3.2·§3.3·§7

## 맥락

No.2 대시보드(ADR-0004)는 **단일 기간의 스냅샷**만 계산한다. No.14는 같은 원천 데이터(`ConversationLog`)에서 **일/주/월 시계열 + 시간대/요일 분포**를 만들어야 한다. 여기서 결정해야 할 것이 세 가지다.

1. **"하루"를 무엇으로 묶을 것인가.** `groupBy(['createdAt'])`은 의미가 없다 — 타임스탬프는 행마다 유일해서 그룹이 행 수만큼 생긴다. 어딘가에서 날짜로 뭉쳐야 한다.
2. **KST 경계를 언제 판정할 것인가.** DB에는 UTC로 저장되지만 "하루"의 경계는 KST 자정이다(FR-0-31). 적재 시점 확정 vs 조회 시점 계산.
3. **시간대 분포(0~23시)를 어떻게 얻을 것인가.** 요구사항 J-3은 일 버킷만 다뤘고 이 갭을 명시하지 않았다.

제약이 세 방향에서 동시에 걸린다. **DB 이식성**(개발명세서 §5 — SQLite/Postgres 공통 문법, ADR-0004의 "DB 종속 SQL을 늘리지 않는다"), **성능**(NFR-P1/P2 — 전량 `findMany` 금지), **수용기준**(AC-X-7 — "신규 원시 SQL이 추가되지 않았다"가 명문화된 검증 항목이다).

## 결정

### 1. `ConversationLog`에 KST 파생 컬럼 **2개**를 두고 적재 시점에 확정한다

```prisma
dayBucket  String @default("")   // 'YYYY-MM-DD' (Asia/Seoul)
hourBucket Int    @default(-1)   // 0~23 (Asia/Seoul)
@@index([chatbotId, dayBucket])
```

- **쓰기 주체는 `ConversationLogService.record()` 단 1곳**이다. ADR-0004의 "쓰기 주체 없는 컬럼 금지" 기준을 통과한다(DD-20·DD-37과 같은 논리).
- **조회도 이 컬럼으로 한다.** `dayBucket`은 `YYYY-MM-DD` 고정 폭이라 **문자열 사전순 = 날짜순**이므로 `{ gte: from, lte: to }` 하나로 기간 필터·그룹핑·버킷 라벨이 모두 해결된다. `createdAt` 범위 → KST 환산 → 재환산의 3단 변환이 사라진다.
- **타임존이 데이터에 고정된다.** 서버 TZ 설정이 바뀌어도 과거 집계가 흔들리지 않는다(EX-14-7/EX-14-12). 대한민국은 서머타임이 없어 고정 오프셋 540분으로 충분하다.

### 2. `hourBucket`을 별도 컬럼으로 둔다. 요일은 컬럼으로 두지 않는다

- **시간대 분포**(FR-14-28)는 `groupBy(['hourBucket'])` = **24행**으로 끝난다. 이 컬럼이 없으면 선택지는 DB 시간 함수(이식성 위반) 또는 전량 `findMany`(NFR-P2 위반)뿐이다.
- **요일 분포**(FR-14-29)는 `dayBucket` 문자열에서 `toKstWeekday()`로 **앱이 파생**한다. 파생 가능한 것에는 컬럼을 만들지 않는다(ADR-0004).
- `(chatbotId, hourBucket)` 인덱스는 **만들지 않는다.** 시간대 조회는 항상 기간 필터와 함께 오므로 `(chatbotId, dayBucket)`이 선행 열을 제공한다. 인덱스는 모든 대화 턴의 쓰기 비용이다.

### 3. 주/월 버킷은 DB가 아니라 **앱 순수 함수**가 일 버킷에서 폴딩한다

- 주 = **월요일 시작 ISO-8601**, 라벨은 `2026-W39(09/21~09/27)`(주차 번호만으로는 읽을 수 없다). 월 = KST 달력월, 라벨 `2026-09`.
- 순수 함수 위치: `apps/api/src/stats/lib/{stats-period.ts, bucket.ts, response-source.ts, usage-trend.ts}` — DB·Nest 무의존, 단위 테스트 1차 대상(NFR-M1).
- KST 변환 원시 함수(`toKstDayBucket`/`toKstHourOfDay`/`toKstWeekday`)는 `packages/shared-types/src/common.ts`에 둔다 — `apps/api`(적재·집계)·`prisma/scripts`(백필)·`prisma/seed.ts`·`apps/web`(표기) 네 소비자가 공유하는 횡단 관심사이며, `normalizeText`와 같은 위치·같은 성격이다(개발명세서 §6-9).

### 4. **신규 원시 SQL 0건**으로 집계를 구성한다 (AC-X-7)

세션 distinct가 유일한 난관이었다(대시보드는 `$queryRaw`로 해결). 해법은 `groupBy(['dayBucket','channelType','sessionId'])` **1회**다 — 결과 1행 = (날짜, 채널, 세션) 유일 조합이므로, 앱이 그 결과에서 **버킷별 distinct·채널별 distinct·기간 전체 distinct**를 모두 파생할 수 있다. 기간 전체 값은 기존 `computeVisitCount()`에 그대로 넣어 대시보드와 정의를 한 벌로 유지한다(AC-14A-9).

- **카디널리티 리스크를 인정하고 탈출구를 명시한다.** 최악의 경우(세션당 1턴) 행 수가 기간 내 로그 수에 근접한다. 방어는 기간 상한(일 92/주 53/월 24)·작은 행 payload·5초 타임아웃이다. **재검토 트리거**: 로그 100만 행 도달 또는 P95 1초 미달. 그때는 **기존 세션 카운트 원시 SQL에 `GROUP BY dayBucket`을 더해 확장**한다(파일 격리·공통 문법 조건 유지, 원시 SQL 총 개수는 1건 그대로).

### 5. 집계 캐시·사전 집계 테이블을 두지 않는다 (DD-54)

기간 상한 + 인덱스 + 5초 타임아웃(`503 AGGREGATION_TIMEOUT`)으로 예산을 지키고, **타임아웃 시 오래된 캐시를 반환하지 않는다**(EX-2-5의 기존 판단 승계). 스케줄러 인프라가 없어 집계 테이블은 채울 주체가 없다.

### 6. 마이그레이션은 **기본값을 둔 2+1단계**다 (DD-64)

①컬럼 2개(`@default("")`/`@default(-1)`) + 인덱스 추가 → ②백필 스크립트(배치 2,000행·멱등·재개 가능) → ③검증 쿼리(`dayBucket=''` 또는 `hourBucket<0`이 **0건**). 검증을 통과하기 전에는 통계 API를 노출하지 않는다(EX-14-8).

**`NOT NULL` 무기본값으로 전환하지 않는다**: 통합 테스트의 `prisma.conversationLog.create` 직접 호출 2곳과 seed의 `createMany`가 컴파일 에러가 되어 NFR-M8("기계적 수정으로 끝나게 하라")을 위반한다. 대신 ① 쓰기 주체 1곳 ② 센티넬이 조회에서 자동 제외되어 누락이 "0으로 표시"가 아니라 "집계 대상 밖"으로 드러남 ③ ③단계 검증 쿼리 ④ 테스트용 로그 생성 헬퍼 ⑤ `code-reviewer` 점검으로 통제한다.

## 근거

- **`groupBy(['createdAt'])`은 성립하지 않는다.** 시계열을 얻으려면 어딘가에서 날짜로 뭉쳐야 하고, 선택지는 DB 함수 / 파생 컬럼 / 앱 전량 처리 셋뿐이다.
- **DB 날짜 함수는 이식성을 깨뜨린다.** SQLite `strftime('%Y-%m-%d', createdAt, '+9 hours')` vs Postgres `date_trunc('day', createdAt AT TIME ZONE 'Asia/Seoul')`. 개발명세서 §6-4가 Postgres 전환을 예정하고 있으므로, 지금 SQLite에서 동작한다는 것은 근거가 되지 않는다. 게다가 AC-X-7이 원시 SQL 불추가를 **수용기준으로 명문화**했다.
- **파생 컬럼은 이미 이 프로젝트의 확립된 패턴이다.** ADR-0006이 같은 이유(함수 기반 인덱스 부재·이식성)로 `*Normalized` 컬럼을 택했다. 같은 문제에 같은 해법을 쓰는 것이 일관성이다.
- **적재 시점 확정이 조회 시점 계산보다 옳은 이유**: "KST 기준 하루"가 데이터에 고정되므로 서버 TZ 변경·시계 조정이 과거 집계를 바꾸지 못한다. 로그는 "그 시점의 사실 기록"이라는 기존 판단(FK 예외 조항)과 같은 철학이다.
- **비용이 사실상 0이다.** 적재 시 문자열 1개 + 정수 1개 계산이며 대화 응답 시간에 측정 가능한 영향이 없다(NFR-P6). 반면 조회 시점 계산은 매 요청 전량 변환이다.
- **요구사항이 놓친 갭을 설계에서 메웠다.** J-3은 일 버킷만 다뤘고 FR-14-28(시간대 분포)이 그 전략으로는 구현 불가능하다는 사실을 명시하지 않았다. `hourBucket`은 그 갭을 **컬럼 1개**로 닫으면서 이식성·성능 제약을 동시에 만족시키는 유일한 선택지였다.

## 대안과 트레이드오프

| 대안 | 기각 사유 |
|---|---|
| **`$queryRaw` + DB 날짜 함수로 버킷팅** | SQLite/Postgres 문법 분기 필요(이식성), AC-X-7("신규 원시 SQL 0건") 정면 위반, 순수 함수 단위 테스트 불가. 성능은 동등하나 세 축에서 불리하다 |
| **컬럼 없이 전량 `findMany` 후 앱 버킷팅** | ADR-0004가 이미 기각한 대안. 3개 컬럼만 선택해도 10만 행 직렬화 비용이 NFR-P1 예산을 잠식한다 |
| **사전 집계 테이블(일별 통계 Materialized)** | 채울 주체(스케줄러/배치)가 없다. 현 데이터 규모에 과설계이며, 집계 정의가 바뀔 때마다 재계산 경로가 필요해진다. 재검토 트리거는 로그 1,000만 행 |
| **`hourBucket` 대신 `dayBucket`을 `YYYY-MM-DDTHH`(시 단위)로** | 일 버킷 조회가 문자열 `substring` 비교나 앱 폴딩(92×24=2,208행)을 요구해 가장 흔한 질의가 비싸진다. `dayBucket`의 의미(J-3·FR 문구의 `YYYY-MM-DD`)도 달라져 요구사항 텍스트가 전부 어긋난다 |
| **요일도 컬럼으로 저장** | `dayBucket` 문자열에서 순수 함수로 파생 가능하다. 파생 가능한 값에 컬럼을 만들지 않는다(ADR-0004) |
| **`(chatbotId, hourBucket)` 인덱스 추가** | 소비하는 질의가 항상 기간 필터를 동반해 `(chatbotId, dayBucket)`으로 충분하다. 모든 대화 턴의 쓰기 비용만 늘린다 |
| **`NOT NULL` 무기본값 컬럼으로 강제** | 기존 테스트 2곳 + seed가 컴파일 에러(NFR-M8 위반). 대체 통제 5종으로 같은 목적을 달성한다 |
| **`dayBucket String?`(nullable)** | 센티넬보다 의미가 정직하지만, `groupBy` 결과에 `null` 그룹이 섞이고 매퍼·집계 함수마다 null 분기가 늘어난다. 기본값 센티넬은 "집계 대상 밖"이라는 동일 효과를 분기 없이 얻는다 |
| **타임존을 환경변수로 실제 지원** | 과거 `dayBucket`은 재계산되지 않으므로 변경 시 데이터가 두 기준으로 섞인다. 다중 타임존은 No.45 범위이며, `STATS_TIMEZONE`은 표기·확인 용도로만 노출한다 |
| **대시보드도 `dayBucket` 필터로 전환해 KST 헬퍼를 일원화** | J-4(대시보드 코드·AC·화면 무변경)를 깨뜨린다. 확정된 AC 14건이 회귀 대상이 된다. 의도적 중복으로 남기고 동일성은 AC-14A-9로 고정, 통합 시점은 No.29 |

**감수하는 비용**

1. **파생 컬럼 2개가 늘어난다** — 원천이 `createdAt`이므로 이론상 중복이다. 대신 쓰기 주체 1곳·검증 쿼리·백필 멱등성으로 불일치 가능성을 막는다.
2. **백필이 배포 절차의 일부가 된다** — 미완 상태로 API를 노출하면 과거 로그가 조용히 사라진다. ③단계 검증을 게이트로 둔다(AC-X-6).
3. **센티넬(`""`/`-1`)이 데이터에 존재할 수 있다** — 정상 경로에서는 생기지 않으며, 생기면 집계에서 빠져 "총합이 안 맞는다"로 드러난다. 새 테스트가 센티넬을 만들지 않도록 로그 생성 헬퍼를 제공한다.
4. **세션 distinct 쿼리의 카디널리티가 기간에 비례한다** — 기간 상한·타임아웃으로 방어하고, 초과 시 기존 원시 SQL 확장이라는 탈출구를 문서에 명시했다.
5. **KST 헬퍼가 두 곳(`dashboard-period.ts` / `shared-types`)에 존재한다** — J-4를 지키기 위한 의도적 중복. AC-14A-9가 두 구현의 동일성을 고정하고 통합 시점을 No.29로 못 박았다. **[해소 2026-09-24 No.29 — 문서 끝 갱신 참고]**

## 결과

- Prisma `ConversationLog`: `dayBucket`·`hourBucket` 추가 + `@@index([chatbotId, dayBucket])`.
- `packages/shared-types/src/common.ts`: `KST_OFFSET_MINUTES`·`toKstDayBucket()`·`toKstHourOfDay()`·`toKstWeekday()` 추가.
- `apps/api/src/conversation/conversation-log.service.ts`: 적재 시 버킷 2개 계산(마스킹 직후, INSERT 직전).
- `apps/api/prisma/scripts/backfill-conversation-buckets.ts` 신설(배치·멱등·재개 가능) + 검증 쿼리 절차.
- `apps/api/src/stats/lib/`: `stats-period.ts`·`bucket.ts`·`response-source.ts`·`usage-trend.ts` 신설. `dashboard-aggregator.ts`는 `TOP_QUESTION_CANDIDATE_LIMIT` export만 추가, `dashboard-period.ts`는 **변경 0줄**.
- `apps/api/src/stats/stats.service.ts`: `getSummary()`·`getDistribution()`·`getQuestions()` 추가(기존 `withTimeout()` 재사용), **`getDashboard()`는 변경 0줄**.
- 환경변수: `STATS_MAX_RANGE_DAYS`(92)·`STATS_MAX_RANGE_WEEKS`(53)·`STATS_MAX_RANGE_MONTHS`(24)·`STATS_TIMEZONE`(Asia/Seoul) — 전부 선택.
- `ApiErrorCode` 추가: `STATS_RANGE_TOO_WIDE`·`INVALID_GRANULARITY`.
- **개발명세서 갱신**: §3 `ConversationLog` 설명, §3.1 인덱스 목록, §5 성능 기준(기간 시계열 P95 1초), §5.1 환경변수 4종.
- `test-automation` 인계: ① **AC-14A-2(일/주/월 합계 보존 — `turnCount`·`answeredCount`·`unansweredCount`·`blockedCount` 4종. 세션 수는 대상 아님)** ② **AC-14A-4(KST 23:50 / 00:10이 다른 날 버킷)** ③ AC-14A-9(대시보드 vs 요약 수치 완전 일치) ④ **AC-X-6(백필 후 대시보드 수치 불변)** ⑤ AC-14B-5(byHour 24개·byWeekday 7개 고정) ⑥ AC-14A-6/7(기간 상한·미지원 단위) ⑦ AC-14A-12(5초 타임아웃 → 503, 캐시 대체 금지).
- `code-reviewer` 인계: ① 신규 `$queryRaw` 0건 ② 버킷 계산이 `shared-types` 함수 1곳인지 ③ `dashboard-period.ts`·`getDashboard()` 무수정 ④ 통계 경로의 모든 `where`에 `chatbotId` + `dayBucket` 범위가 선행하는지 ⑤ 센티넬을 만드는 신규 쓰기 경로가 없는지.


---

## 갱신 (2026-09-24 — No.29: KST 헬퍼 중복 해소 · §4 세션 원시 SQL 탈출구 이행 · §5 재검토 트리거 갱신)

통합 통계(No.29, **ADR-0033**)에 따라 다음을 갱신한다. §1~§3·§6의 결정(KST 파생 컬럼·적재 시점 확정·주/월 앱 폴딩·센티넬·백필 2+1단계)은 **불변**이다.

1. **KST 헬퍼 중복 해소(감수 비용 5)**: `dashboard-period.ts`의 파일 내부 `KST_OFFSET_MINUTES`·`MS_PER_DAY`·`KstDateOnly`·`toKstDateOnly`·`kstDateOnlyToUtc` 재정의(`kst-date.ts`와 글자 수준 동일)를 삭제하고 `stats/lib/kst-date.ts`를 import한다. `resolveDashboardPeriod`의 시그니처·반환값·오류 문구·366일 상한과 대시보드의 `createdAt` 범위 필터는 **불변**(대안 표 84행의 `dayBucket` 전환 기각은 유지). `kst-date.ts`와 `shared-types`의 `toKstDayBucket`은 역할이 달라(달력 산술 / 적재 문자열 확정) 합치지 않고, **동치를 계약 테스트**(`kst-date.contract.spec.ts` — 경계 + 1,000점)로 고정한다. 통계 모듈에서 KST 헬퍼 재정의 0건을 정적 검사가 단언한다.
2. **§4 탈출구 이행 — 범위 한정**: 챗봇 스코프(No.14)의 `groupBy(['dayBucket','channelType','sessionId'])` 앱 폴딩은 **그대로 둔다**(무회귀). **그룹·전역 스코프에서만** 세션 distinct를 원시 SQL로 계산한다 — 반환 행 수가 세션 수에 비례하는 리스크가 스코프 확대로 현실화하기 때문이다. 버킷 키는 DB 날짜 함수가 아니라 **`buildBuckets()`가 만든 버킷별 `dayBucket` 범위 목록을 `CASE WHEN "dayBucket" >= ? AND "dayBucket" <= ? THEN ?`로 바인딩**해 주차 규칙을 TS 1벌로 유지하고, 주/월 세션 = 일 버킷의 합집합(DD-61)을 DB `COUNT(DISTINCT)`로 정확히 보존한다. 세션 키 = `chatbotId || '|' || sessionId`. 격리 파일은 `stats/integrated/integrated-session.query.ts` 1개다(§4의 "원시 SQL 총 개수 1건 그대로" 예고는 **대시보드 파일 무변경**(FR-0-90)을 우선해 "지정 파일 2개 + 헬스체크"로 정정 — 보유 파일 목록은 정적 검사로 고정). 두 경로의 동치는 "챗봇 1개 그룹 = 챗봇 수치" 계약 테스트(AC-I2-1)로 고정한다.
3. **§5 사전 집계 테이블 — 여전히 미도입, 재검토 트리거 3종으로 갱신**: No.28의 `PollingLoop`으로 "채울 주체가 없다"는 사유는 해소됐으나 재계산 경로·DD-61 재현 불가·질문 순위 원천 의존 사유는 유지된다. 트리거 = ① 로그 1,000만 행(유지) ② 그룹 스코프 성능 예산 실측 미달(커버링 인덱스 1차 완화 후) ③ **로그 삭제 경로 도입 — 삭제 전 롤업 적재 필수**(ADR-0033 §3·§7).
4. **인덱스 추가**: `conversation_logs(groupId, dayBucket)`·`conversation_logs(dayBucket)`. §2의 "`hourBucket` 인덱스 미도입" 판단은 그룹·전역 스코프에도 그대로 적용한다.
