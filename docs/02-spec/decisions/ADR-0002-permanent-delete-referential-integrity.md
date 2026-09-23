# ADR-0002 — 챗봇 영구 삭제의 참조 무결성 정책 (cascade 금지)

- **상태**: 채택 (Accepted)
- **일자**: 2026-09-19
- **결정자**: system-architect
- **관련**: `docs/requirements/chatbot-operations.md` §5.4 D-3, FR-1-15, FR-1-16, AC-1-11, EX-1-9
- **영향 범위**: `apps/api/prisma/schema.prisma`, `apps/api/src/chatbots/*`, `apps/api/src/common/all-exceptions.filter.ts`

## 맥락

`Chatbot`은 이 시스템의 루트 엔터티로, 후속 Phase에서 `Intent`/`Keyword`/`HomonymDictionary`/`DialogNode`/`ContextVariable`/`FaqEntry`/`Channel`/`ConversationLog`/`UnansweredQuestion` 9개 하위 엔터티가 붙는다. 삭제 시 이 데이터를 어떻게 다룰지 결정해야 한다.

현재 `schema.prisma`의 관계에는 `onDelete`가 **명시되어 있지 않다**. 다만 실제 생성된 `migrations/20260919001312_init/migration.sql`을 확인한 결과, Prisma가 required relation의 기본값으로 이미 `ON DELETE RESTRICT ON UPDATE CASCADE`를 DDL에 기록해 두었다.

## 결정

1. **암묵적 cascade를 금지한다.** 9개 하위 관계 + `Chatbot → ChatbotGroup` 관계 전부에 `onDelete: Restrict, onUpdate: Cascade`를 **명시적으로 기재**한다.
2. 삭제는 **2단계**로 분리한다.
   - `DELETE /api/v1/chatbots/:id` = 보관(`status = ARCHIVED`). 되돌릴 수 있다.
   - `POST /api/v1/chatbots/:id/permanent-delete` = 영구 삭제. `ARCHIVED` 상태에서만 가능.
3. 영구 삭제는 서비스 계층에서 하위 9종을 **병렬 count로 사전 검사**하고, 합이 0보다 크면 `409 CHATBOT_HAS_CHILDREN`(0이 아닌 항목명·건수를 메시지에 나열)으로 거부한다.
4. 경합으로 검사를 통과한 뒤 FK 위반(`Prisma P2003`)이 발생하면 전역 예외 필터가 동일한 `409 CHATBOT_HAS_CHILDREN`으로 변환한다. DB 오류가 500으로 새어 나가지 않는다.
5. 영구 삭제 요청 본문에 `confirmName`을 받아 **서버에서 챗봇 이름과 일치 여부를 재검증**한다(불일치 시 `400 CONFIRM_NAME_MISMATCH`).
6. 그룹 삭제도 같은 원칙이다 — 소속 챗봇이 1건 이상이면 `409 GROUP_NOT_EMPTY`.

## 근거

- **복구 불가능한 파괴적 동작에는 명시적 의사표시를 요구한다.** cascade는 클릭 한 번으로 대화 설계 자산 전체(의도/FAQ/대화그래프)와 통계 원천(대화로그)을 지운다. 이 시스템에는 아직 버전 스냅샷/롤백(No.25)도, 감사 로그 실기록(No.13)도 없어 **되돌릴 수단이 전무하다**.
- **`onDelete` 명시는 DDL 변경을 유발하지 않는다.** 이미 생성된 SQL과 동일하므로 마이그레이션 diff가 없고, SQLite 테이블 재생성도 일어나지 않는다. 즉 **비용 0으로 의도를 스키마에 고정**해, 후속 Phase에서 누군가 편의상 `onDelete: Cascade`로 바꾸려 할 때 리뷰 포인트가 된다.
- **DB 제약만으로는 UX를 만들 수 없다.** `Restrict`만 두면 사용자는 Prisma의 `P2003` 스택 트레이스를 받는다. 사전 count 검사가 있어야 "FAQ 12건, 대화로그 340건이 있어 삭제할 수 없습니다" 같은 **원인 + 해결 방법**(UIUX §7, FR-0-3)을 줄 수 있다. 사전 검사는 UX용, `Restrict`는 최종 방어선으로 역할을 나눈다.

### 엔드포인트 형태를 요구사항안에서 바꾼 이유 (D-9)

요구사항 정의서 §5.3은 `DELETE /chatbots/:id?permanent=true`를 제안했다. 이를 `POST /chatbots/:id/permanent-delete`로 변경한다.

| 관점 | 쿼리 플래그 안 | 채택안(별도 POST 경로) |
|---|---|---|
| 사고 위험 | 플래그 하나 차이로 보관 ↔ 영구삭제가 갈린다. 프록시/클라이언트가 쿼리를 누락·보존하는 방식에 따라 의도와 다른 동작 가능 | 경로가 물리적으로 다르다 |
| 확인 문구 서버 재검증 | `DELETE`에 본문을 싣는 것은 HTTP 규격상 비권장이며 일부 클라이언트/프록시가 본문을 제거한다 | `POST` 본문으로 `confirmName` 전달 가능 → NFR-S1(서버 재검증) 충족 |
| 권한 분리 | 동일 핸들러라 No.12에서 권한을 나누기 어렵다 | 핸들러가 분리되어 `chatbot:delete` vs `chatbot:purge` 권한 분리가 자연스럽다 |
| REST 순수성 | 더 RESTful | 액션 스타일이라 다소 덜 RESTful — **감수** |

엔드포인트 총 개수(19)는 변하지 않는다.

## 대안과 트레이드오프

| 대안 | 기각 사유 |
|---|---|
| `onDelete: Cascade` | 복구 수단이 없는 현 단계에서 위험이 과도. 통계 원천 데이터가 조용히 소실된다 |
| `onDelete: SetNull` | `chatbotId`가 required라 적용 불가. nullable로 바꾸면 고아 레코드가 생겨 더 나쁘다 |
| 소프트 삭제(`deletedAt`) 전면 도입 | 모든 조회에 필터가 전파되고 unique 제약(`slug`)과 충돌한다. `status = ARCHIVED`가 이미 소프트 삭제 역할을 수행하므로 중복 |
| "강제 삭제" 옵션 제공 | 사용자가 결과를 예측할 수 없는 상태에서의 강제 삭제는 위험. 하위 리소스 관리 화면(후속 Phase)이 갖춰진 뒤 재검토 |

**감수하는 비용**: 대화로그가 쌓인 챗봇은 사실상 영구 삭제가 불가능해진다. 이는 의도된 것이며, 사용자에게는 `ARCHIVED`가 최종 정리 수단이다. 일괄 정리가 필요해지면 후속 Phase에서 "하위 데이터 함께 삭제" 체크박스 + 삭제 대상 목록 미리보기를 갖춘 별도 플로우로 도입한다.

## 결과

- `schema.prisma`: 10개 관계에 `onDelete: Restrict, onUpdate: Cascade` 명시(DDL 무변경).
- `chatbots.service.ts`: `archive()` / `permanentDelete()` 분리, 후자는 사전 count 검사 포함.
- `all-exceptions.filter.ts`: `P2002 → 409 DUPLICATE_SLUG`, `P2003 → 409 CHATBOT_HAS_CHILDREN` 매핑.
- 후속 Phase(No.13 이력관리)는 영구 삭제 직전 스냅샷을 `AuditLog.beforeValue`에 남기는 지점으로 `permanentDelete()`를 사용한다.


---

## 갱신 (2026-09-23 — No.25로 "되돌릴 수단"이 생겼다)

§근거의 "버전 스냅샷/롤백(No.25)도 … 없어 **되돌릴 수단이 전무하다**"는 **대화 자산에 한해 더 이상 사실이 아니다.** No.25가 대화 자산 시점 스냅샷과 ID 보존 원자적 복원을 도입했다(ADR-0031). **이 ADR의 결정은 전부 불변이다** — cascade 금지·2단계 삭제·사전 검사 409·`confirmName` 서버 재검증.

- **영구삭제는 여전히 불가역이다.** `ChatbotVersion`·`ChatbotVersionPayload`·`ChatbotVersionSequence`는 **"하위 데이터 제거" 분류**로 영구삭제 트랜잭션에서 **동반 삭제**된다(사전 검사 409 대상이 아니다 — 스냅샷이 영구삭제를 막으면 보관 챗봇을 영원히 지울 수 없다). 따라서 영구삭제 후에는 스냅샷도 남지 않는다. 오프사이트 백업은 No.45의 몫이다.
- **보관(`ARCHIVED`) 중에는 스냅샷이 보존**되며 보관 해제 후 복원할 수 있다.
- **복원은 이 ADR이 말하는 "복구 불가능한 파괴적 동작"이 아니다** — 복원 직전 상태를 같은 트랜잭션에서 자동 백업하므로 가역이다. 그래서 `chatbot:purge`(ADMIN 전용)와 같은 등급을 요구하지 않고 `dialogue:write` + `chatbot:write`(EDITOR 이상)로 둔다.


---

## 갱신 (2026-09-23 — No.28 `DeploySchedule` 동반 삭제)

운영 예약 배포(No.28, ADR-0032)의 **`DeploySchedule`은 "하위 데이터 제거" 분류**로 영구삭제 트랜잭션에서 **동반 삭제**된다(13 → 14테이블, `tx.chatbot.delete` 직전 `deleteMany` 1건). 사전 검사(409) 대상이 아니다 — 예약이 영구삭제를 막으면 보관 챗봇을 영원히 지울 수 없다. **이 ADR의 결정(cascade 금지 · 2단계 삭제 · 사전 검사 409 · `confirmName` 재검증)은 불변**이다.

- 예약의 `targetVersionId` 등 참조 컬럼에는 **FK를 걸지 않는다** — `Restrict`면 종단 예약이 참조하는 버전이 보존 정리로 영원히 지워지지 않는다. 대신 **활성 예약이 참조하는 버전의 수동 삭제는 서비스 계층에서 `409 VERSION_REFERENCED_BY_SCHEDULE`** 로 거부한다(이 ADR의 "사전 검사는 UX, 최종 방어선은 트랜잭션 안 재확인" 원칙 그대로).
- `ARCHIVED` 챗봇의 남은 예약은 실행 시 `FAILED(CHATBOT_ARCHIVED)`가 되며, 보관 중에도 **취소·조회는 허용**한다.
