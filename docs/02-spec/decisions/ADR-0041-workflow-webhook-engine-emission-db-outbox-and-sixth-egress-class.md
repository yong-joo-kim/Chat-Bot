# ADR-0041 — 업무 자동화 = 비종결 엔진 이벤트 방출 · 커밋 후 이벤트 포트 · DB 발송함(행 선점 · 최소 1회 + 멱등키) · 서명 웹훅 · 출구 6번째 클래스

- **상태**: 채택 (Accepted)
- **일자**: 2026-09-26
- **결정자**: system-architect (범위·방식 12건은 PM 확정 — 요구사항 §11 P-1~P-12 전부 추천안, 2026-09-26)
- **관련**: `docs/requirements/workflow-automation.md` J-1~J-22, FR-0-172~182, FR-WF1-\*~FR-WF10-\*, NFR-WFP/WFR/WFS/WFA/WFM, AC-WF1~WF7, EX-WF-1~26, C-1~C-8, P-1~P-12 / ADR-0008(엔진 파이프라인) · ADR-0013(PII 마스킹) · ADR-0016(감사) · ADR-0031/0039(스냅샷·환경) · ADR-0032(`PollingLoop`·행 선점) · **ADR-0034(레거시 출구·SSRF·재진입 — 재검토 트리거 "쓰기형 후속 액션 → No.41" 이행)** · ADR-0035(엔진 이벤트 방출 선례 `surveyEvents`) · ADR-0036(상담·`sessionRef`) · ADR-0038(부정 평가 선점) · **ADR-0040(출구 레지스트리 — 재검토 트리거 "새 외부 출구 클래스는 레지스트리 등록" 이행)**
- **Supersedes(부분)**: 없음. ADR-0040 §2의 "외부 HTTP 출구 5클래스"는 이 ADR로 **6클래스**가 된다(결정 본문 불변 — 범위 확장). ADR-0034 결정 4의 "유일 출구"는 레거시 연결에 대해 불변이며, 그 전송·DNS·주소 판정 **부품**을 두 번째 출구가 공유한다(결정 6).
- **영향 범위**: `apps/api/prisma/schema.prisma`(+ 마이그레이션 1) · `apps/api/src/{workflow(신규), common/workflow(신규 순수 포트), conversation, handoff, survey-responses, feedback, dialog-nodes, simulation, versions, environment/core, governance, chatbots, legacy-api/transport, common/egress, common/crypto, audit-logs, config}` · `packages/shared-types/src/{workflow(신규), dialogue, dialogue-engine, conversation, governance, audit, common, version, environment, index}.ts` · **`packages/dialogue-engine`(닫힌 목록)** · `apps/web`. **`apps/widget`·`apps/ml-worker` 변경 0**
- **세부 설계**: `docs/02-spec/workflow-automation-설계.md`

## 맥락

카탈로그 No.41은 "대화 중 트리거된 이벤트를 사내 업무 자동화 도구(Power Automate류)와 연결해 승인·티켓 생성 등 후속 처리를 자동 실행"이다. 선행 그룹이 No.41로 넘긴 것은 재시도·멱등키·재시도 큐(No.26), 외부 알림(No.24·27·28·12)이다. 코드 확인 결과 결정할 것은 여덟 가지다.

1. 폼 값(티켓 필드)은 엔진 내부(`CompletedFormInfo`)에만 있다 — 엔진을 바꾸지 않고는 보낼 수 없다. 바꾼다면 어떻게 통제하나.
2. 상담 시작·종료, 설문 완료, 부정 평가, 연속 미응답은 **봉인된 쓰기 파일**(상담 H-2·설문 S-2·평가 F-2)과 fire-and-forget 로그 적재에서 생긴다. 어디서, 몇 번 발행하나.
3. 비동기 발송의 원천·선점·재시도·다중 인스턴스 안전성.
4. 받는 쪽이 진위·중복을 판단할 수 있는 계약.
5. 새 외부 출구를 No.45 게이트(정적 검사 G-1·G-2)와 No.26 SSRF 방어(`node:http(s)`·`node:dns` import 1파일 봉인 L-2)에 **동시에** 맞추는 방법.
6. 재시도용 본문(개인정보 가능)의 보관·암호화·파기.
7. 권한(`AGENT`가 `chatbot:read`를 가진다)·감사·버전/환경 취급.
8. 쓰지 않는 설치의 동작 불변 보장.

## 결정

### 1. 트리거 = 노드 아웃풋 "업무 요청 보내기"(`WORKFLOW`) + 챗봇별 이벤트 구독(닫힌 목록 5종) (P-1 (c) · P-5)

- 명시 트리거: 대화그래프 아웃풋 `WORKFLOW`(`{ version: 1, targetId, actionKey, fields: [{ name, value: ApiBinding }] }` — 바인딩은 No.26 v2 `ApiBindingSchema`(`CONST`｜`SLOT`) **그대로 재사용**, 자유 템플릿 없음). 노드당 ≤3 · 필드 ≤20.
- 암묵 트리거: `WorkflowSubscription`(챗봇 × 이벤트 × 대상, 유일) — `HANDOFF_STARTED`·`HANDOFF_ENDED`·`SURVEY_COMPLETED`·`FEEDBACK_NEGATIVE`·`UNANSWERED_STREAK`(세션당 1회 · 임계 2~10, 기본 3). 대화 종료·운영 이벤트는 2차.

### 2. 엔진 = 비종결 이벤트 방출 · 닫힌 목록 · 재진입 이월 (P-2 (a))

- 엔진은 `WORKFLOW`를 만나면 **정지하지 않고** 바인딩을 해석해 결과의 선택 필드 `workflowEvents?: WorkflowEmission[]`에 싣는다(없으면 **키 부재** — `surveyEvents` 규약). 사용자 출력(`outputs`)에는 아무것도 넣지 않고 뒤 아웃풋은 계속 실행한다. I/O 0 — 실제 적재·발송은 API 계층.
- 닫힌 목록(설계서 §5.1 E-1~E-8): 타입 1 · 빌더 파일 1(`workflow-output.ts`) · `executeOutputs` 분기 1 · `resolver.ts`의 4개 실행 지점 전파 · `ApiResumeState.workflow?` 이월 · `resumeAfterApiCall` 합산 · `DialogueTurnResult.workflowEvents?` · 설계 점검 규칙 5종.
- **재진입 이월**: API 정지 전 방출분(`eventsSoFar`)과 **같은 턴 완료 폼**(`completedForm`)을 `ApiResumeState.workflow`에 싣고, 분기 노드 실행에 폼을 넘기며 결과에 정지 전분 + 분기분을 이어 붙인다(ADR-0034 갱신 2 결함 재발 방지). 이 키는 **정지 전 방출이 있거나, 폼이 완료됐고 번들에 `WORKFLOW` 아웃풋이 1개 이상일 때만** 생긴다 — `WORKFLOW` 없는 번들의 `apiCall`·결과는 바이트 동일.
- `WORKFLOW`만 있는 노드는 출력 0건 → 기존 0건 보장 규칙(기본 폴백 문구 + `EMPTY_OUTPUT`)이 적용된다. 엔진을 바꾸지 않고 설계 점검 `WORKFLOW_ONLY_OUTPUT`(WARNING)으로 알린다.

### 3. 이벤트 = 원천 커밋 후 포트 발행(fire-and-forget) · 원천의 1회 신호 + 발송함 유일 키

- 포트 = `apps/api/src/common/workflow/workflow-event.port.ts`(순수 — 토큰 `WORKFLOW_EVENT_SINK` + `WorkflowSourceEvent` 유니온 + `emit(): void`). 원천 서비스 4개(`handoff-thread`·`survey-response`·`message-feedback`·`conversation-log`)는 `@Optional()` 주입만 하며 발송 모듈 내부를 import하지 않는다.
- 발행 위치는 원천이 이미 보장하는 **1회 신호 직후**: 개입 트랜잭션 성공 · `endHandoff`의 `ended=true`(CAS) · 설문 `COMPLETED` 트랜잭션 성공 · 평가 큐 선점 `claim.count===1` · 로그 적재 성공. 중복은 발송함 `dedupeKey`(유일)가 흡수한다.
- 원천 트랜잭션에 발송함 쓰기를 넣지 않는다(봉인 쓰기 파일 불변 · 원천 지연 0). **커밋 후 발행 전 프로세스가 죽으면 그 이벤트는 유실된다** — 감사 기록과 같은 수용(C-8).

### 4. 발송 = DB 발송함(`WorkflowRun` = 발송함 겸 실행 이력) + `PollingLoop` + 행 선점 CAS · 최소 1회 + 멱등키 (P-4 (a))

- 대화는 결과를 기다리지 않는다. 노드 이벤트는 공개 파이프라인 ④.6(설문 적재) 뒤에 **await 적재**(≤15ms), 이벤트는 포트가 비동기 적재.
- 루프(기본 5초)가 `PENDING ∧ nextAttemptAt ≤ now` 행을 행마다 `updateMany`(기대 상태 조건) + 영향 행 수로 선점(`claimToken`)하고, 임대 만료 `SENDING`은 회수한다. 전달 의미는 **최소 1회**이며 같은 `deliveryId`(= 행 id)로 받는 쪽이 중복을 제거한다. "정확히 1회"는 약속하지 않는다.
- 결과: 2xx 성공 · 408/425/429/5xx·시간 초과·네트워크 = 재시도(30초·2분·10분·30분·2시간 ±20%, `Retry-After`는 2시간 상한) · 그 밖의 4xx·3xx·출구/주소 차단·비밀 없음·호스트 불일치 = 영구 실패(`FAILED` — 본문 보관 7일 → 수동 재발송 창) · 최대 시도 초과 = `FAILED(MAX_ATTEMPTS)`.
- 일시 정지(대상·구독) = 보류(`HELD`) → 재개 시 `PENDING` · 24시간 초과 보류 = `EXPIRED`(P-9). 연속 실패 10회는 경고만(자동 정지 없음).

### 5. 전송 계약 = 범용 서명 웹훅 1종 (P-3 (a))

- `POST` + `application/json; charset=utf-8` 봉투 v1(zod `.strict()` — `specVersion`·`deliveryId`·`eventType`·`occurredAt`(UTC ISO)·`test`·`chatbot`·`channel`·`sessionRef`·`source`·`action`/`fields` 또는 `data`). 봉투 바이트는 **적재 시점에 확정**해 모든 재시도가 같은 바이트를 보낸다.
- 헤더: `X-Chatbot-Event` · `X-Chatbot-Delivery` · `Idempotency-Key`(같은 값) · `X-Chatbot-Attempt` · 서명 사용 시 `X-Chatbot-Signature: t=<unix초>,v1=<hex(HMAC-SHA256(secret, "<t>.<raw body>"))>`(재생 방지 = 받는 쪽 5분 허용 오차 + `deliveryId` 중복 제거) · 헤더 인증 4종(No.26 enum 재사용).
- **비밀 주소**(주소 자체에 서명이 든 도구): `urlSecretRef` 환경변수의 전체 주소로 보내되 호스트·포트가 DB 기준 주소와 다르면 영구 실패(`TARGET_HOST_MISMATCH`) — DB에 보이는 호스트 = 실제 나가는 호스트.
- 응답 본문은 해석·저장하지 않는다(상태 코드만 — 최대 4KB 소비 후 종료).

### 6. 출구 = 레지스트리 6번째 클래스 `WORKFLOW_WEBHOOK` · SSRF 부품은 이동 없이 공유 (C-1 · C-2)

- `EgressExitId`·`EgressDataKind`(`WORKFLOW_PAYLOAD`) +1 · 레지스트리에 발송 파일 `workflow/dispatch/workflow-http.sender.ts`(+ 공유 전송·DNS 파일)를 등록한다. 발송 파일은 송신(`transport.request(`) **앞에** `checkEgress('WORKFLOW_WEBHOOK', url)`을 호출한다 — G-1(파일 집합)·G-2(가드 수·순서)가 그대로 강제한다. 모드 OFF = 파싱 없이 통과.
- **SSRF = ADR-0034 §4 전부**를 No.26의 `NodeHttpTransport`·`NodeDnsResolver`·`lib/ip-policy.ts`를 **파일 이동 없이** 두 번째 DI 토큰으로 등록해 재사용한다: DNS 1회 해석 → 모든 주소 판정(절대 차단 대역 불가역 · 사설 대역은 **별도** `WORKFLOW_PRIVATE_ALLOWLIST`만) → 검증 주소로만 연결 → 단일 데드라인 → **리다이렉트 불추종(모드 무관 — `http.request`는 따라가지 않는다 · 3xx = 영구 실패)** — 거버넌스 모드 ON의 리다이렉트 차단(I-11)은 구조적으로 충족된다.
- 전송 포트에 **선택 필드 2개**만 더한다: `exitId?`(가드 호출의 출구 id — 기본 `LEGACY_API`) · `responseMode?: 'BODY'｜'STATUS_ONLY'`(기본 `BODY` — 웹훅은 본문 상한 초과로 상태 코드를 잃지 않게). 레거시 동작·L-2(`node:http(s)`/`node:dns` import 1파일씩)·L-4(`LegacyApiHttpClient` 주입 1파일) **불변**.

### 7. 데이터 보호 = 비밀 환경변수 · 기본 마스킹 + 대상 단위 원문 허용 · 본문 일시 보관(암호화 편입) · 이력 `CALL_LOGS` 보존 (P-6 · P-7)

- 비밀(서명·헤더 토큰·비밀 주소) = `WORKFLOW_SECRET__<REF>` — 읽기 1파일(`workflow-secret.resolver.ts`) · DB·스냅샷·응답·감사·로그·이력에 값 0 · zod 스키마 밖.
- `SLOT` 값 = 기본 `maskPii()`(1벌 · `PII_MASK_MODE` 반영), 대상의 `allowRawPersonalData`만 원문 — ADMIN · 대상 이름 재입력 · 감사(**ADR-0013 5번째 적용 지점**). `CONST`·이벤트 메타데이터는 마스킹 대상 아님. 대화 본문·자유 텍스트·상담 메시지·`sessionId` 원값은 봉투에 없다(`sessionRef`만).
- 발송함 `payload`는 재시도용 일시 보관 — `SUCCEEDED`·`SKIPPED`·`CANCELLED`·`EXPIRED` 전이 시 즉시 소거, `FAILED`는 7일 뒤 소거. 거버넌스 암호화가 켜져 있으면 **`EncryptedFieldId` 4번째 `WORKFLOW_PAYLOAD`**로 봉인(AAD = `workflow_runs:payload:<runId>`) — 봉인 1파일(적재 writer)·개봉 1파일(발송함 store). 백필·재암호화 잡 대상은 아니다(일시 데이터) — 대신 기동 시 "옛 키 필요 행" 검사에 포함해 키 선제거를 막는다.
- 실행 이력(메타데이터)은 보존 종류 `CALL_LOGS`에 편입(종단 행만 행 삭제 — 대기 행 제외).

### 8. 권한·감사·버전/환경 (P-8 · P-10)

- 신규 권한·역할 0: 대상 = `security:*` · 구독 쓰기·재발송·취소 = `chatbot:write` · 노드 = `dialogue:write` · **챗봇 스코프 조회 = `chatbot:read` AND `dialogue:read`**(`AGENT`는 `chatbot:read`를 갖지만 `dialogue:read`가 없어 403 — 요구사항 "AGENT 접근 없음"을 신규 권한 없이 충족) · 대상 선택 목록 = `dialogue:read`.
- 감사: 대상·구독 CRUD·사용 여부·원문 허용·정지/재개 · 재발송·취소(요약 1건) · 테스트 발송(`WorkflowRun` `CREATE` — 결과 코드만). 발송 1건 1건은 감사가 아니다. `AuditTargetType` +3 · `AuditAction` 추가 0.
- 노드 아웃풋은 스냅샷에 자동 포함(스키마 버전 1 · 업캐스터 불필요) · 대상 = 전역·스냅샷 밖(복원·전환 미리보기 경고 2종) · 구독 = 환경 밖 즉시 반영(캐시 30초 + 즉시 무효화). 대상 삭제 409는 **초안 노드 + 구독**만 검사한다(스냅샷 본문 참조 봉인 V-7 · No.26 선례) — 운영 버전이 참조하던 대상의 삭제는 실행 시 `SKIPPED(TARGET_UNAVAILABLE)` + 경고.

### 9. 쓰지 않는 설치는 바이트 단위로 같다 (FR-0-172)

공개 대화: 엔진 결과에 `workflowEvents` 키가 없으면 분기 1개 · 추가 조회 0. 이벤트 원천: 포트 미주입 = no-op, 주입돼도 구독 캐시(전 챗봇 1쿼리/30초/인스턴스)에 구독이 없으면 추가 조회 0. 발송 루프: 빈 발송함 1쿼리/주기. 관리 API·통계·데이터 지도·보존 미리보기는 대상 0개일 때 선택 키를 생략한다. `@Public()` 8 · 위젯·ml-worker 변경 0.

## 근거

- **폼 값은 엔진 안에만 있다.** 그래프 밖 "노드 도달 구독"은 엔진 0 변경이지만 결재·티켓의 핵심인 폼 값을 못 보낸다. `surveyEvents`가 이미 증명한 "엔진은 방출만, API가 적재" 형태는 엔진 순수성(L-5)과 소비자 대칭(시뮬레이터 모의·비교/TC 무시)을 유지한다.
- **커밋 후 발행이 봉인과 가장 적게 부딪힌다.** 트랜잭셔널 아웃박스는 전달 보장이 한 단계 강하지만 상담·설문·평가의 **쓰기 유일 파일 봉인**(H-2·S-2·F-2)에 발송함 쓰기를 퍼뜨리고 원천 트랜잭션을 늘린다. 원천이 이미 CAS로 1회를 보장하므로 발행 지점만 그 뒤에 두면 된다.
- **DB 발송함 + 행 CAS는 이 저장소의 검증된 패턴이다**(예약 배포 ADR-0032). 인메모리 큐는 재시작·다중 인스턴스에서 유실·중복되고, Redis/BullMQ는 구축형 인프라를 늘린다.
- **`fetch`로는 DNS 고정이 안 된다.** undici의 기본 조회를 쓰면 판정 후 재해석(재바인딩)을 막을 수 없다. ADR-0034가 `node:http` + 커스텀 `lookup`을 택한 이유가 그대로 적용되며, 그 부품을 옮기지 않고 두 번째 토큰으로 등록하면 L-2·레지스트리 기존 경로·기존 spec import가 한 줄도 바뀌지 않는다.
- **봉투를 적재 시점에 확정**해야 재시도·재발송이 같은 바이트(같은 서명 대상)를 보내고, 챗봇 이름 변경·원문 허용 변경이 이미 발생한 요청을 흔들지 않는다.
- **AND 권한 조합**은 No.25가 도입한 기존 장치다 — 역할·권한 매트릭스를 바꾸지 않고 `AGENT`를 배제한다.

## 대안과 트레이드오프

| 대안 | 기각 사유 |
|---|---|
| 그래프 밖 "노드 도달 구독"(엔진 0) | 폼 값 불가 · 편집기에서 발송 사실이 안 보이는 숨은 부작용 — 2차 보조 후보 |
| No.26 `API_CONDITION`에 "비동기 연결" 종류 추가 | 종결자·턴당 1회라 조회 API와 한 턴 공존 불가 · 분기 무의미 · `ApiCallLog`·회로 의미 혼재 · No.26/41 경계 붕괴 |
| `SCENARIO` 재사용 | No.39 자리 선점 · 자유 문자열 맵(바인딩 없음) |
| 원천 트랜잭션 안 적재(트랜잭셔널 아웃박스) | 봉인 쓰기 파일 3곳에 `workflowRun` 쓰기 확산 · 원천 지연 증가 — 커밋 후 발행 + 유실 창 명시로 대체 |
| 인메모리 큐 / Redis·BullMQ | 재시작 유실·다중 인스턴스 중복 / 구축형 인프라 추가 |
| 전송·DNS·IP 정책 파일을 `common/outbound/`로 이동해 공용화 | L-2 경로·레지스트리 `LEGACY_API` 파일 목록·기존 spec import가 연쇄 변경 — 효과는 "이동 없는 두 번째 토큰 등록"과 같다(이름·위치 불일치는 감수 비용으로 남긴다) |
| 발송 전용 전송 파일(`node:http` 2번째) | L-2 봉인 완화 + SSRF 코드 복제(두 벌 유지) |
| `fetch` + `redirect:'manual'` | DNS 주소 고정 불가(재바인딩) |
| 서명 비밀 DB 암호화 저장(No.45 키링) | P-7 — DB 값 0이 더 강하다. 셀프서비스 요구 시 `KeyProvider` 재사용 |
| 시도별 테이블 `WorkflowAttempt` | 1차 콘솔 요구는 마지막 시도로 충분 · 행 수 × 시도 수 증가 |
| 부분 유일 인덱스(원시 DDL, `sourceKey`) | nullable `@unique`가 SQLite·Postgres 모두 NULL 다중 허용 — 원시 부분 유니크 4종 개수 불변 |
| 봉투를 발송 시점에 조립 | 재시도마다 바이트가 바뀔 수 있고 원천 재조회 필요 |
| 연속 실패 시 대상 자동 정지 | 이벤트 유실 — 경고만 |
| 정확히 1회 | 분산 트랜잭션 필요 — 멱등키로 대체 |
| 인바운드 콜백(`@Public()` 9번째) | 1차 효익 = 이력 표시뿐 · 공개 접촉면 +1 — 2차 |
| `AGENT` 배제용 신규 권한 `workflow:read` | AND 조합으로 같은 판정 — 신규 권한 0 유지 |
| 대상 삭제가 운영/스테이징 스냅샷 참조까지 검사 | 스냅샷 본문 테이블 참조 파일 봉인(V-7) 위반 · No.26 선례(스냅샷 참조 비차단) — 경고·실행 시 건너뜀으로 대체 |
| 발송함 본문을 백필·재암호화 잡 대상에 편입 | 일시 데이터(성공 즉시·실패 7일) — 기동 키 검사로 선제거만 막는다 |

## 감수하는 비용

1. **중복 전달 가능**(임대 회수·응답 유실) — 받는 쪽 `deliveryId` 중복 제거가 계약이다(연동 가이드에 명시).
2. **커밋 후 발행 전 강제 종료 시 이벤트 유실** — 경고 로그·요약 "적재 실패" 계수로 관측한다.
3. **대상당 동시 발송·분당 상한은 다중 인스턴스에서 근사**(인스턴스 수만큼 초과 가능) — 발송 전담 인스턴스(`WORKFLOW_DISPATCH_ENABLED`)로 엄격화할 수 있다.
4. **구독 변경의 다른 인스턴스 수렴은 최대 30초**(같은 인스턴스는 즉시) — 상담 설정 캐시(ADR-0036 §8)와 같은 수용.
5. **공유 전송 파일이 `legacy-api/transport/`에 남는다**(두 출구 공용인데 위치는 레거시) — 세 번째 공유 출구가 생기면 이동(재검토 트리거).
6. **암호화 켜기 전에 적재된 대기 본문은 평문으로 남는다**(백필 없음 — 최대 7일) · 키 제거는 실패 보관 기간 이후.
7. **결과를 대화로 되돌리지 않는다** — 같은 턴 결과는 No.26, 대화 표시는 No.35와 함께 2차.
8. **대상이 전역이라 구독형 다고객 서버에서 고객 간 대상 목록이 보인다** — 멀티테넌시 그룹과 함께 재검토.

## 결과

- 신규 테이블 3개(`WorkflowTarget`·`WorkflowSubscription`·`WorkflowRun`) · 마이그레이션 1개 — 전부 `CREATE TABLE`/`CREATE INDEX`(테이블 재정의 0 · 원시 부분 유니크 4종 보존 · 백필 0) · `Chatbot` 역참조 1(컬럼 0). 영구삭제 동반 삭제 20 → 22테이블(사전검사 15종 불변).
- 신규 모듈 3개(`workflow/catalog`(읽기 전용) · `workflow/triggers`(적재·포트) · `workflow`(관리·발송 — export 0)) + 순수 포트 `common/workflow` · 관리자 핸들러 21개 · `@Public()` 추가 0 · 신규 권한 0 · `ApiErrorCode` +2(`WORKFLOW_TARGET_IN_USE`·`WORKFLOW_RUN_NOT_RETRYABLE`) · `AuditTargetType` +3 · `DialogOutputType` 12 → 13 · `TraceCode` +2 · `DesignIssueCode` +5 · `EgressExitId`/`EgressDataKind`/`EncryptedFieldId` +1 · 선택 환경변수 16종 + 비밀 접두 규약.
- `packages/dialogue-engine` 닫힌 목록 수정(엔진 I/O 0 — L-5 유지) · `apps/widget`·`apps/ml-worker` 변경 0. GPU **1**(카탈로그 2에서 하향 — P-12).
- 정적 검사 `workflow-sealing.spec.ts` W-1~W-18 · 의도된 기존 시험 기대값 변경 X-1~X-4(설계서 §21.3 닫힌 목록).
- `test-automation` 필수 인계: 미사용 무변경 회귀(쿼리 수) · 엔진 회귀(WORKFLOW 유무 출력 동일 · 키 부재) · 재진입 이월 · 상담 종료 동시 경합 1행 · 재시도 백오프·같은 멱등키 · 2인스턴스 선점 · 서명 검증 · 출구·SSRF 송신 0 · 비밀·본문 무유출 · 봉인.

## 재검토 트리거

- **받는 쪽 결과(승인/반려)를 콘솔에서 봐야 한다** → 인바운드 콜백 `POST /public/workflow-callbacks/:deliveryId`(`@Public()` 9번째 · HMAC 검증 · 재생 방지 · 레이트) — 새 ADR.
- **결과를 대화에 표시** → No.35(선제 메시징)·서버 대화 세션(ADR-0009 재검토)과 함께.
- **도구 형식 변환 요구가 2종 이상 반복**(Teams 카드·Jira 필드) → 대상별 본문 프리셋(같은 출구).
- **업무 도구 없는 고객의 메일 알림 요구** → 내장 SMTP 출구(레지스트리 7번째 클래스).
- **운영 이벤트(예약 실패·위험 동작·설문 임계) 요구** → 이벤트 목록 확장(같은 발송 엔진 · 시스템 구독 스코프).
- **대화 종료 이벤트 요구** → 서버 세션 또는 무활동 추정 배치.
- **발송량이 분당 600건을 상시 초과 · SQLite 쓰기 경합 관측** → 발송 전담 인스턴스 분리 → Postgres 전환 시 `FOR UPDATE SKIP LOCKED` 선점 검토(현행 CAS 유지 가능).
- **대상 한도의 엄격한 전역 보장 요구** → DB 토큰 버킷 행.
- **비밀 셀프서비스 요구** → No.45 `KeyProvider`로 DB 암호화 저장(결정 7 대체).
- **세 번째 출구가 같은 전송 부품을 공유** → `legacy-api/transport/*`·`lib/ip-policy.ts`를 `common/outbound/`로 이동(L-2 경로 갱신).
- **No.39 착수** → 커넥터 허브의 "액션" 템플릿이 이 발송 엔진 위에 올라간다(데이터 연동 = No.26 위, 액션 = No.41 위).


---

## 갱신 (2026-09-26 — No.42: 봉투 `channel` 불변 · 원천 파일의 두 번째 포트 공존)

통합 인박스(No.42, **ADR-0042 §5**). 결정 1~9는 **불변**이다.

1. **봉투 `channel: z.enum(['WEB'])`·이벤트 7종 불변**: 인박스는 `WORKFLOW_EVENT_SINK`를 주입·발행하지 않는다. 수동 기록·시뮬레이션은 공개 파이프라인을 타지 않아 `TURN_LOGGED`·상담 이벤트를 만들지 않고, 식별 연결(고객 키·이름)은 봉투에 싣지 않는다(새 외부 전송 목적 — 2차 판단). 봉투 `channel`은 "대화가 들어온 배포 채널"의 의미를 유지한다.
2. **원천 파일 공존**: `handoff-thread.service.ts`·`conversation-log.service.ts`는 No.41 `emit(`과 No.42 `signal(`(순수 포트 `INBOX_SIGNAL_SINK`)을 각 1줄씩 갖는다 — 순서 emit → signal · 둘 다 await 0 · W-16의 `kind:` 리터럴 개수 불변(인박스 포트의 판별 키는 `signal:`).
3. **이 포트를 재사용하지 않은 이유**: 상담 이벤트에 `sessionId`가 없고(`sessionRef`만), 단일 제공자 토큰을 팬아웃으로 바꾸면 W-15 모듈 exports·배선이 바뀌며 인박스 처리 실패가 발송 적재 경로와 묶인다.
4. **2차 스레드 이벤트**(열림·배정·종료 알림) 착수 시: `WorkflowEventType` +3 · 봉투 `source.threadId`만(고객 키·표시 이름 0) · 기록 채널은 `channel`이 아니라 `data.recordChannel` — 봉투 v1 확장 규칙(선택 키) 안에서.
