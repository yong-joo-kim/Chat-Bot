# ADR-0001 — 대시보드 접속수(visitCount) 산정 기준과 `sessionId` 도입

- **상태**: 채택 (Accepted)
- **일자**: 2026-09-19
- **결정자**: system-architect
- **관련**: `docs/requirements/chatbot-operations.md` §5.4 D-1/D-2, FR-2-1, AC-2-5
- **영향 범위**: `apps/api/prisma/schema.prisma`, `packages/shared-types/src/stats.ts`, `apps/api/src/stats/*`, `apps/api/prisma/seed.ts`

## 맥락

No.2 대시보드의 핵심 지표 중 하나가 "접속수"다. 그러나 현재 `ConversationLog` 모델에는 **세션 식별자가 없어** 방문(세션) 단위 집계가 불가능하다. 요구사항 정의서는 두 안을 제시했다.

- **A안**: `ConversationLog.sessionId String?`를 추가하고 `visitCount = distinct sessionId`로 정의.
- **B안**: Phase 1에서는 `visitCount = 로그 건수`를 대리지표로 쓰고, 대화 처리 Phase에서 재정의.

제약 조건은 두 가지다. ① 이 Phase에는 `ConversationLog`를 **쓰는 경로가 아예 없다**(대화 엔진은 별도 Phase). 즉 어떤 안을 택해도 Phase 1의 실제 화면 동작은 "0건"이 기본이다. ② 대시보드 응답 스키마 `DashboardSummarySchema`는 이미 확정되어 FE/BE가 공유한다.

## 결정

**A안을 채택한다.** 단, B안의 폴백 동작을 A안 안에 흡수한다.

1. `ConversationLog`에 `sessionId String?`(nullable, 기본값 없음)을 추가한다.
2. 산정식:
   `visitCount = COUNT(DISTINCT sessionId WHERE sessionId IS NOT NULL) + COUNT(* WHERE sessionId IS NULL)`
   즉 세션값이 없는 행은 **각각 독립된 1회 방문**으로 계산한다.
3. `DashboardSummarySchema`에 `visitCountBasis: 'SESSION' | 'LOG_COUNT'`를 추가한다. 기간 내 로그에 `sessionId`가 하나도 없으면 `'LOG_COUNT'`, 하나라도 있으면 `'SESSION'`을 반환한다.
4. UI는 `visitCountBasis`에 따라 카드 캡션 문구를 전환한다(FR-2-1의 "산정 기준 명시" 요건).
5. 함께 `conversation_logs`에 `@@index([chatbotId, createdAt])`를 추가한다(요구사항 D-2 수용).

## 근거

- **A안이 B안을 포함한다.** 위 산정식은 `sessionId`가 전부 `NULL`일 때 정확히 "로그 건수"가 되어 B안과 결과가 같다. 따라서 A안을 택해도 Phase 1에서 잃는 것이 없고, 대화 엔진이 세션을 채우기 시작하면 **마이그레이션이나 API 변경 없이** 정확한 정의로 자동 승격된다.
- **지표 정의 변경은 비용이 크다.** B안은 후속 Phase에서 `visitCount`의 의미를 바꾸게 되는데, 이 값은 화면 카드·테스트 기대값·향후 통계(No.14/29)에 전파된다. 의미가 조용히 바뀌는 지표는 운영 신뢰를 잃는다.
- **마이그레이션 비용이 사실상 0이다.** nullable 컬럼 추가라 기존 행 백필이 필요 없고, 현재 dev DB의 `conversation_logs`는 0건이다. 지금이 가장 싸게 추가할 수 있는 시점이다.
- `visitCountBasis`를 응답에 포함시켜 **"산정 기준을 UI에 표시하라"는 요구(FR-2-1)를 프런트 하드코딩이 아니라 서버 상태로** 해결한다. 대화 엔진 도입 후 프런트를 수정할 필요가 없다.

## 대안과 트레이드오프

| 대안 | 기각 사유 |
|---|---|
| B안(로그 건수 고정) | 후속 Phase에서 지표 의미가 바뀌고, 그때 마이그레이션 + FE/BE/테스트 동시 수정이 필요 |
| `sessionId String @default(uuid())` (non-null) | 쓰기 경로가 없는 상태에서 의미 없는 UUID가 채워져 "세션 1건 = 로그 1건"이 고정되고, 실제 세션이 도입될 때 과거 데이터와 구분이 불가능 |
| 별도 `ConversationSession` 테이블 즉시 도입 | 쓰기 주체(대화 엔진)가 없는 시점에 세션 생명주기/만료 정책을 결정해야 하는데 근거가 없다. 대화 엔진 Phase에서 `sessionId`를 FK로 승격하는 경로가 열려 있으므로 지금은 과설계 |

**감수하는 비용**: `visitCount` 산출에 Prisma의 타입 안전 API 대신 원시 SQL(`$queryRaw`) 1회가 필요하다(Prisma는 `COUNT(DISTINCT col)`을 지원하지 않음). 이 비용은 원시 SQL을 `stats.service.ts` 한 파일로 격리하고 Postgres/SQLite 양쪽에서 동작하는 표준 SQL만 쓰는 것으로 통제한다(NFR-M2).

## 결과

- 마이그레이션: `add_conversation_session_and_indexes` — `ALTER TABLE ADD COLUMN "sessionId" TEXT;` + 인덱스 3종(`conversation_logs(chatbotId, createdAt)`, `chatbots(groupId, status)`, `chatbots(updatedAt)`).
- `ConversationLogSchema`에 `sessionId?: string` 추가.
- seed는 트랙 A에서 `sessionId` 40종을 채워 `'SESSION'` 경로를, 트랙 B(로그 0건)에서 빈 상태를 검증할 수 있게 한다.
- 후속: 대화 엔진 Phase는 세션 생성/만료 정책을 정의하고 `sessionId`를 반드시 채운다. 이때 `ConversationSession` 테이블로 승격할지 재검토한다.


---

## 갱신 (2026-09-24 — No.29: 그룹·전역 스코프의 세션 = (챗봇, 세션) 쌍)

통합 통계(No.29, ADR-0033 §6)는 여러 챗봇을 합산하므로 세션 distinct의 키를 **`(chatbotId, sessionId)` 쌍**으로 정의한다 — 서로 다른 챗봇의 세션은 같은 `sessionId` 문자열이라도 별개다(위젯이 슬러그별로 발급하지만 값은 클라이언트가 보내므로 정의로 보장한다). 단일 챗봇에서는 `sessionId` distinct와 동치이므로 이 ADR의 산정식(`distinct + null 행 각 1건`)·`visitCountBasis` 규칙은 **불변**이다. 결과적으로 그룹 세션 = 소속 챗봇 세션의 합이며, 주/월 세션은 여전히 일 버킷의 합집합(DD-61)이다.
