# No.41 업무 자동화 워크플로우 커넥터 — 기존 문서 패치 목록

> 작성: system-architect · 2026-09-26 · 근거: `docs/02-spec/workflow-automation-설계.md`, `docs/02-spec/decisions/ADR-0041-workflow-webhook-engine-emission-db-outbox-and-sixth-egress-class.md`
> **적용 상태**: ✅ **적용 완료(2026-09-26, 86건)** — 오케스트레이터 세션이 항목마다 "찾을 원문 정확히 1회"를 확인한 뒤 기계적으로 적용한다.
> **적용 방법**: 각 항목의 "찾을 원문"을 대상 파일에서 **정확히 1회** 찾아 "바꿀 내용"으로 교체한다. 모든 원문은 2026-09-26 시점 파일(No.45 데이터 거버넌스 패치 적용 후)에서 복사했고, 문자열 검색(Grep count)으로 대상 파일 안 유일성을 확인했다. "바꿀 내용"이 원문을 그대로 포함하는 항목은 append다(취소선 표기 항목은 원문을 `~~…~~`로 감싸 보존한다).
> **줄바꿈 주의**: 대상 파일은 CRLF일 수 있다. 모든 "찾을 원문"은 **한 줄 안의 부분 문자열**(줄바꿈 미포함)로 잡았다. "바꿀 내용"의 줄바꿈은 대상 파일의 줄바꿈으로 정규화한다.
> **순서 독립**: 어떤 "바꿀 내용"도 다른 항목의 "찾을 원문"을 새로 만들지 않는다. 같은 줄에 앵커가 둘인 항목은 없다.
> 코드 변경은 이 파일의 범위가 아니다 — 설계서 §2.5 체크리스트와 §21.3(의도된 시험 기대값 변경 닫힌 목록)을 따른다.
> 항목 수: 개발명세서 34 · ADR 9 · 기능요구사항 8 · 업무 자동화 요구사항(PM 결정 기록 + 설계 반영) 28 · 선행 요구사항 인계 정정 6 · 운영 문서 1 = **86건**

---

## A. `docs/02-spec/개발명세서.md`

### A-1. [개발명세서 `docs/02-spec/개발명세서.md`] §2 워크스페이스 상태 표 — `workflow` 행 추가

**찾을 원문**
````text
선택 환경변수 18 + 키 2(스키마 밖)**(ADR-0040) |
````
**바꿀 내용**
````text
선택 환경변수 18 + 키 2(스키마 밖)**(ADR-0040) |
| **`apps/api/src/workflow`**(+ `workflow/catalog`·`workflow/triggers`·`common/workflow`) | **업무 자동화 Phase에 신설**(No.41) — 전역 발송 대상 레지스트리(ADMIN · 비밀 = `WORKFLOW_SECRET__<REF>` 환경변수 참조 1파일) · 대화그래프 아웃풋 `WORKFLOW`("업무 요청 보내기" — 폼 슬롯·상수 바인딩, 비종결·사용자 출력 0) + 챗봇별 이벤트 구독 5종(상담 시작·종료·설문 완료·부정 평가·연속 미응답) · DB 발송함 `WorkflowRun`(`PollingLoop` + 행 선점 CAS · 최소 1회 + 멱등키 · 지수 백오프 · 실패 보관·재발송 · 보류/만료) · HMAC 서명 웹훅 · 출구 레지스트리 6번째 클래스 `WORKFLOW_WEBHOOK`(No.26 SSRF 부품 이동 없는 공유). **`packages/dialogue-engine` 닫힌 목록 수정(비종결 방출 `workflowEvents?` · 재진입 이월 — 엔진 I/O 0) · ml-worker·widget 변경 0건 · `@Public()` 8 유지 · 신규 권한·역할 0 · 선택 환경변수 16 + 비밀 접두 규약**(ADR-0041) |
````

### A-2. [개발명세서 `docs/02-spec/개발명세서.md`] §2.1 외부 HTTP 출구 규약 — 6번째 클래스

**찾을 원문**
````text
파일 집합·호출 수를 `governance-sealing.spec.ts` G-1·G-2가 단언한다(ADR-0040 §2).**
````
**바꿀 내용**
````text
파일 집합·호출 수를 `governance-sealing.spec.ts` G-1·G-2가 단언한다(ADR-0040 §2).** **[No.41 — 2026-09-26] 6번째 클래스 `WORKFLOW_WEBHOOK`(업무 자동화 웹훅) — 발송 파일 `workflow/dispatch/workflow-http.sender.ts`가 DNS 조회 전 `checkEgress('WORKFLOW_WEBHOOK', …)`를 호출하고, `node:http(s)`·`node:dns` 전송 부품은 No.26 파일(`legacy-api/transport/*`)을 **이동 없이 두 번째 DI 토큰으로** 공유한다(선택 필드 `exitId`·`responseMode` — 기본값 = 현행). `node:http(s)`/`node:dns` import 파일 수(L-2)·`LegacyApiHttpClient` 주입 파일(L-4)은 불변이며, `transport.request(` 호출 파일 ⊆ 레지스트리를 `workflow-sealing.spec.ts` W-2가 추가로 단언한다(ADR-0041 §6).**
````

### A-3. [개발명세서 `docs/02-spec/개발명세서.md`] §2.1 공통 횡단 관심사 — 업무 자동화 이벤트 포트

**찾을 원문**
````text
★키 환경변수 읽기 유일 파일 `env-key.provider.ts`)는 Nest 모듈이 아닌 순수 모듈이다(ADR-0040 §1).**
````
**바꿀 내용**
````text
★키 환경변수 읽기 유일 파일 `env-key.provider.ts`)는 Nest 모듈이 아닌 순수 모듈이다(ADR-0040 §1).** **[No.41] `workflow/workflow-event.port.ts`(업무 자동화 이벤트 발행 포트 — 토큰 `WORKFLOW_EVENT_SINK` + 이벤트 유니온 · `emit(): void`)도 순수 파일이며 원천 서비스 4곳(상담 스레드·설문 응답·답변 평가·대화 로그 적재)이 `@Optional()`로 주입한다(ADR-0041 §3).**
````

### A-4. [개발명세서 `docs/02-spec/개발명세서.md`] §2.2 기능그룹별 모듈 배치 표 — No.41 행 추가

**찾을 원문**
````text
설계 완료 → `data-governance-설계.md`** |
````
**바꿀 내용**
````text
설계 완료 → `data-governance-설계.md`** |
| **업무 자동화 워크플로우 (No.41)** | **`workflow`(신규 — 발송 대상·구독·실행 이력·재발송·정지·테스트 발송·요약 21 핸들러 · 발송 루프(`PollingLoop` + 행 선점 CAS) · ★출구 파일 `workflow-http.sender.ts` · ★발송함 상태 전이 유일 파일 `workflow-run.store.ts` · ★비밀 읽기 유일 파일 `workflow-secret.resolver.ts` · export 0개) + `workflow/catalog`(신규 — 읽기 전용: 선택 목록·적재용 대상·설계 점검/시뮬레이터 정보·구독 캐시, export 1) + `workflow/triggers`(신규 — ★발송함 적재 유일 파일 `workflow-run-enqueue.writer.ts` · 노드 방출 적재 · 이벤트 포트 구현, export 2) + `common/workflow`(순수 포트)** + `packages/dialogue-engine`(닫힌 목록 — `WORKFLOW` 비종결 방출·재진입 이월·설계 점검 5종) · `conversation`(④.7 노드 적재 · `record()` 뒤 `TURN_LOGGED`) · `handoff`·`survey-responses`·`feedback`(커밋 후 이벤트 발행 1줄씩 — 쓰기 코드 불변) · `dialog-nodes`(대상 참조 검증·설계 점검 컨텍스트) · `simulation`(모의 표시) · `dialogue-common`(대상 삭제 409) · `versions`·`environment/core`(복원·전환 경고 2종) · `legacy-api/transport`(선택 필드 2) · `common/egress`(6번째 클래스)·`common/crypto`(암호화 대상 4번째) · `governance`(데이터 지도·`CALL_LOGS`·기동 키 검사) · `chatbots`(동반 삭제 +2) | **설계 완료 → `workflow-automation-설계.md`** |
````

### A-5. [개발명세서 `docs/02-spec/개발명세서.md`] §2.2 주석 블록 — 엔진 확장(No.41) · 모듈 의존 방향(No.41)

**찾을 원문**
````text
출구·암호화 소비자는 순수 모듈 `common/egress`·`common/crypto`만 import한다(ADR-0040 §1).
````
**바꿀 내용**
````text
출구·암호화 소비자는 순수 모듈 `common/egress`·`common/crypto`만 import한다(ADR-0040 §1).
>
> **엔진 확장(업무 자동화 No.41)**: FR-0-78·88 "엔진 불가침"의 **세 번째 의도된 예외**(No.26·27 다음)이며 **닫힌 목록 E-1~E-8**로 한정한다 — ① 아웃풋 타입 `WORKFLOW`(v1 — 대상 참조 + 동작 키 + No.26 `ApiBindingSchema` 필드) ② 순수 빌더 `workflow-output.ts`(`bindWorkflowOutput`·`hasWorkflowOutputs`) ③ `resolveBinding` export ④ `executeOutputs` 분기 1개(**정지하지 않고 사용자 출력 0 · 비종결** — 결과 선택 필드 `workflowEvents?`, 없으면 키 부재) ⑤ `resolver.ts` 실행 지점 4곳 전파 ⑥ `ApiResumeState.workflow?`(정지 전 방출분 + 같은 턴 완료 폼 — `WORKFLOW` 있는 번들만) 이월과 `resumeAfterApiCall` 합산 ⑦ `DialogueTurnResult.workflowEvents?` ⑧ 설계 점검 5종. 엔진은 여전히 **I/O·타이머·`process.env`·Nest·Prisma 심볼 0건**(L-5) · 적재·발송은 API 계층 · `WORKFLOW` 없는 번들의 모든 소비자 결과와 `apiCall`은 바이트 단위로 불변이다(ADR-0041 §2).
>
> **모듈 의존 방향(No.41)**: `workflow → workflow/catalog · workflow/triggers · audit-logs · chatbots · dialogue-common · common/{egress,crypto,polling,rate-limit}` + `legacy-api/transport/*`·`legacy-api/lib/ip-policy`(**파일 import — `LegacyApiModule` import 0**) · `workflow/triggers → workflow/catalog · common/{workflow,crypto} · handoff/lib`(순수 함수 파일) · `conversation｜handoff｜survey-responses｜feedback → workflow/triggers` · `dialog-nodes｜simulation → workflow/catalog` 단방향이다. **`WorkflowModule`의 export는 0개**라 원천·공개 대화의 DI 그래프에는 발송함 **적재** 경로만 있고 발송·상태 전이·비밀 읽기 경로가 없다. 원천 서비스는 순수 포트 토큰만 `@Optional()` 주입한다. `validation`·`versions`·`deploy-schedules`·`stats`·`learning`·`topics`·`asset-transfer`·`governance`·`environment`는 `workflow/**`를 import하지 않는다(버전·환경·거버넌스는 Prisma 읽기만 — ADR-0041).
````

### A-6. [개발명세서 `docs/02-spec/개발명세서.md`] §3 엔터티 표 — `DialogNode` 행에 `WORKFLOW` 아웃풋

**찾을 원문**
````text
v1 키로 설문을 자동 연결·변환하지 않는다(ADR-0035 §9)** | 5, 26, 27 |
````
**바꿀 내용**
````text
v1 키로 설문을 자동 연결·변환하지 않는다(ADR-0035 §9)** **[No.41] 아웃풋 13종째 `WORKFLOW`("업무 요청 보내기" — v1 `{ version: 1, targetId, actionKey, fields[≤20]: { name, value: CONST｜SLOT } }` · 노드당 ≤3 · 사용자 출력 0 · 비종결). 대상은 전역 `WorkflowTarget` 참조(FK 없음 — 없는 대상 저장 `404 INVALID_REFERENCE` · 초안 노드가 참조하면 대상 삭제 `409 WORKFLOW_TARGET_IN_USE`) · 스냅샷 자동 포함(스키마 버전 1)(ADR-0041 §1·§2)** | 5, 26, 27, 41 |
````

### A-7. [개발명세서 `docs/02-spec/개발명세서.md`] §3 엔터티 표 — 신규 3엔터티 행 추가

**찾을 원문**
````text
v1 토큰 점검 결과 — 본문 0). 부팅 시 행 보장 | 45 |
````
**바꿀 내용**
````text
v1 토큰 점검 결과 — 본문 0). 부팅 시 행 보장 | 45 |
| **`WorkflowTarget`** | **업무 자동화 발송 대상(No.41 — 전역, ADR-0041 §1·§5).** 이름(`nameNormalized` 전역 유일)·기준 주소(https — 개발용 http는 서버 설정 · 사용자정보·쿼리·프래그먼트 금지)·인증 방식 4종(No.26 enum)·헤더 이름·`secretRef`·서명 사용 + `signingSecretRef`·비밀 주소 `urlSecretRef`(주소 자체가 비밀인 도구 — 호스트는 기준 주소와 같아야 함)·타임아웃(1~15초)·최대 시도(1~10)·`allowRawPersonalData`·사용 여부·`pausedAt`·발송 카운터 3(`consecutiveFailures`·`lastSuccessAt`·`lastFailureAt`). **★ 비밀 값 컬럼이 없다**(`WORKFLOW_SECRET__<REF>` 환경변수 — 리졸버 1파일). 쓰기 = `workflow-targets.service.ts`(ADMIN `security:write`) + 카운터 3키만 `workflow-run.store.ts`. 스냅샷 밖(전역 설정) | 41 |
| **`WorkflowSubscription`** | **챗봇 × 이벤트 × 대상 구독(No.41).** 이벤트 5종(`HANDOFF_STARTED`·`HANDOFF_ENDED`·`SURVEY_COMPLETED`·`FEEDBACK_NEGATIVE`·`UNANSWERED_STREAK`) · `(chatbotId, eventType, targetId)` 유일 · 챗봇당 20 · 사용 여부·`pausedAt`·`conditions` JSON(연속 임계 2~10 · 설문 구조 답 포함). FK `Restrict`(챗봇·대상) · **환경 밖 — 저장 즉시 운영 반영**(구독 캐시 30초 + 즉시 무효화) · 스냅샷·복사·토픽 분리 대상 아님 · 영구삭제 동반 삭제 | 41 |
| **`WorkflowRun`** | **발송함 겸 실행 이력(No.41 — ADR-0041 §4).** `id` = `deliveryId`(앱 선발급 — 봉투·멱등키·AAD) · 대상 id·이름 스냅샷 · 챗봇 · 트리거(`NODE`/`EVENT`/`TEST`)·이벤트 7종·동작 키·노드·구독·메시지·원천 참조 · `dedupeKey`(nullable 유일 — 중복 적재 차단) · `sessionRef`(원 `sessionId` 없음) · `servedVersionId` · 상태 8종(`PENDING`·`HELD`·`SENDING`·`SUCCEEDED`·`FAILED`·`SKIPPED`·`CANCELLED`·`EXPIRED`)·사유 · 선점 `claimToken`/`claimedAt` · 시도·다음 시도·마지막 결과/HTTP/지연 · `personalDataMasked` · 필드 **이름** 목록 · **`payload`(재시도용 봉투 — 일시 보관: 성공·취소·만료 즉시 소거 · 실패 7일 뒤 소거 · 거버넌스 암호화 대상)** · `dayBucket`(KST). **텍스트 본문·필드 값·`sessionId` 컬럼 없음**(정적 검사) · FK 없음(로그 규약) · 적재 = writer 1파일 · 상태 전이 = store 1파일 · 보존 = `CALL_LOGS`(종단 행만 행 삭제) · 영구삭제 동반 삭제 | 41 |
````

### A-8. [개발명세서 `docs/02-spec/개발명세서.md`] §3 미도입 결정 머리 — 17건 → 18건

**찾을 원문**
````text
> **미도입 결정 17건**
````
**바꿀 내용**
````text
> **미도입 결정 18건**
````

### A-9. [개발명세서 `docs/02-spec/개발명세서.md`] §3 미도입 결정 ⑱ 신설 — 업무 자동화 관련 미도입

**찾을 원문**
````text
KMS는 `KeyProvider` 교체 지점 1곳으로 2차(**ADR-0040**).
````
**바꿀 내용**
````text
KMS는 `KeyProvider` 교체 지점 1곳으로 2차(**ADR-0040**).
> ⑱ **발송 시도별 이력 테이블(`WorkflowAttempt`)·발송함 부분 유일 인덱스(원시 DDL)·인바운드 콜백 테이블·서명 비밀 DB 저장·대화 세션 테이블(대화 종료 이벤트용)** — 1차 콘솔 요구는 마지막 시도로 충분하다. 중복 적재 차단은 nullable `@unique dedupeKey`로 충분하다(SQLite·Postgres 모두 NULL 다중 허용 — 원시 부분 유니크 4종 개수 불변). 결과 콜백·대화 표시는 2차(No.35와 함께). 비밀은 환경변수 참조(DB 값 0). 대화 종료 이벤트는 서버 세션이 없어 2차(ADR-0009 재검토와 함께 — **ADR-0041**).
````

### A-10. [개발명세서 `docs/02-spec/개발명세서.md`] §3.1 참조 무결성 예외 — `WorkflowRun` FK 없음

**찾을 원문**
````text
보호는 앱 레벨 `409 VERSION_REFERENCED_BY_ENVIRONMENT` + 보존 정리 보호 집합이다(ADR-0039 §2).
````
**바꿀 내용**
````text
보호는 앱 레벨 `409 VERSION_REFERENCED_BY_ENVIRONMENT` + 보존 정리 보호 집합이다(ADR-0039 §2). **[No.41] `WorkflowRun`의 `targetId`/`chatbotId`/`nodeId`/`subscriptionId`/`messageId`/`sourceRefId`/`servedVersionId`도 FK를 걸지 않는다** — 발송 이력은 대상·노드·구독이 지워져도 사실 기록으로 남는다(대상 이름 스냅샷 동반). 노드 → 대상 참조는 `outputs` JSON 안이라 FK가 없고 앱 레벨 `409 WORKFLOW_TARGET_IN_USE`(초안 노드) · 구독 → 대상은 `Restrict` FK(ADR-0041).
````

### A-11. [개발명세서 `docs/02-spec/개발명세서.md`] §3.1 파생 데이터 동반 삭제 — 구독·발송 이력

**찾을 원문**
````text
"대화가 있었던 챗봇은 영구삭제 불가"(사전검사 409)는 그대로다(ADR-0002 갱신 각주, ADR-0040).**
````
**바꿀 내용**
````text
"대화가 있었던 챗봇은 영구삭제 불가"(사전검사 409)는 그대로다(ADR-0002 갱신 각주, ADR-0040).** **[No.41] `WorkflowSubscription`(설정 데이터)·`WorkflowRun`(발송 로그 — `ApiCallLog` 선례)도 동반 삭제다(20 → 22테이블 · 대기 발송 건 포함 — 삭제 확인 화면이 건수를 알린다). 사전검사 15종은 불변이며 `WorkflowTarget`은 전역이라 무관하다(ADR-0002 갱신 각주, ADR-0041).**
````

### A-12. [개발명세서 `docs/02-spec/개발명세서.md`] §3.1 인덱스 — No.41 인덱스 추가

**찾을 원문**
````text
암호문 컬럼에는 인덱스를 두지 않는다. 전부 `ADD COLUMN`/`CREATE`라 부분 유니크 4개에 영향이 없다(ADR-0040).**
````
**바꿀 내용**
````text
암호문 컬럼에는 인덱스를 두지 않는다. 전부 `ADD COLUMN`/`CREATE`라 부분 유니크 4개에 영향이 없다(ADR-0040).** **[No.41] `workflow_targets(nameNormalized)` 유일·`(updatedAt)` · `workflow_subscriptions(chatbotId, eventType, targetId)` 유일·`(targetId)` · `workflow_runs(dedupeKey)` 유일(nullable)·`(status, nextAttemptAt)`(발송 선점)·`(status, claimedAt)`(임대 회수)·`(status, completedAt)`(실패 본문 소거)·`(targetId, status)`·`(targetId, sessionRef, createdAt)`(세션 상한)·`(subscriptionId, status)`·`(chatbotId, createdAt)`·`(createdAt)`(전역 이력·보존). 본문 `payload`에는 인덱스를 두지 않는다. 전부 `CREATE`라 부분 유니크 4개에 영향이 없다(ADR-0041).**
````

### A-13. [개발명세서 `docs/02-spec/개발명세서.md`] §4 API 표 — 업무 자동화 행 신설

**찾을 원문**
````text
총 12개 핸들러 · **`@Public()` 추가 0건 · 공개 대화 요청·응답 스키마 불변** | 45 |
````
**바꿀 내용**
````text
총 12개 핸들러 · **`@Public()` 추가 0건 · 공개 대화 요청·응답 스키마 불변** | 45 |
| **업무 자동화 워크플로우** | **`/workflow-targets`(GET 목록 `security:read` · POST 생성 `security:write`), `GET /workflow-targets/picker`(노드 편집기·구독 선택 목록 — `dialogue:read`, 주소·비밀 참조 미포함 · ⚠ `:id`보다 먼저 선언), `GET｜PATCH｜DELETE /workflow-targets/:id`(삭제는 초안 노드·구독 참조 중 `409 WORKFLOW_TARGET_IN_USE`), `POST /workflow-targets/:id/test｜pause｜resume`(`security:write`), `GET /workflow-runs`(+`/summary` — 전역 `security:read`), `/chatbots/:chatbotId/workflow-subscriptions`(GET `chatbot:read`+`dialogue:read` / POST·PATCH·DELETE·`/:subscriptionId/pause｜resume` `chatbot:write`), `GET /chatbots/:chatbotId/workflow-runs`(+`/summary` — `chatbot:read`+`dialogue:read`), `POST /chatbots/:chatbotId/workflow-runs/retry｜cancel`(`chatbot:write` · ≤100건)**. 총 21개 핸들러 · 기존 경로 확장: 노드 `WORKFLOW` 아웃풋 · 설계 점검 5종 · 시뮬레이터 `workflowSteps?`(모의 — 발송 0) · 복원·전환 경고 2종 · 데이터 지도 선택 키 · **`@Public()` 추가 0건 · 인바운드 콜백 경로 0건 · 공개 대화 요청·응답 스키마 불변** | 41 |
````

### A-14. [개발명세서 `docs/02-spec/개발명세서.md`] §4 정정 이력 — 2026-09-26b 항목 추가

**찾을 원문**
````text
공개 경로 8곳 불변(`data-governance-설계.md` §15).
````
**바꿀 내용**
````text
공개 경로 8곳 불변(`data-governance-설계.md` §15).
> **정정 이력(2026-09-26b — 업무 자동화)**: ① **업무 자동화 행을 신설**했다 — 발송 대상은 전역 설정(`/workflow-targets`), 구독·챗봇 이력은 챗봇 스코프(`/chatbots/:chatbotId/workflow-*`). ② 요구사항 초안의 선택 목록 `GET /workflow-targets/options`는 No.26 선례에 맞춰 **`/picker`** 로 확정했다. ③ 결과를 받는 인바운드 콜백(공개 경로)은 만들지 않는다(P-4 (a) — 2차). ④ 신규 `ApiErrorCode` 2종(제안 3종 중 `WORKFLOW_OUTPUT_INVALID`는 기존 `INVALID_REFERENCE`·`OUTPUT_PAYLOAD_INVALID`로 흡수) · 공개 경로 8곳 불변(`workflow-automation-설계.md` §12).
````

### A-15. [개발명세서 `docs/02-spec/개발명세서.md`] §4.1 오류 봉투 — No.41 오류 코드 2종

**찾을 원문**
````text
체인 검증 범위 초과는 기존 `AUDIT_RANGE_TOO_WIDE`를 재사용한다 |
````
**바꿀 내용**
````text
체인 검증 범위 초과는 기존 `AUDIT_RANGE_TOO_WIDE`를 재사용한다 **[No.41] 2종 추가** — `WORKFLOW_TARGET_IN_USE`(409 — 초안 노드·구독이 참조하는 발송 대상 삭제, `details[]` = "챗봇명 › 노드명")·`WORKFLOW_RUN_NOT_RETRYABLE`(409 — 재발송 대상에 본문 소거·비실패 건 포함, 전체 거부). 없는 대상 참조는 `INVALID_REFERENCE`(404), 노드당 4개 이상은 `OUTPUT_PAYLOAD_INVALID`(400), 모드 ON 호스트는 `EGRESS_HOST_NOT_ALLOWED`, 원문 허용 확인 불일치는 `CONFIRM_NAME_MISMATCH`, 테스트 발송 분당 초과는 `RATE_LIMITED`(429)를 재사용한다. **공개 대화 경로는 이 코드를 쓰지 않는다**(적재 실패·건너뜀은 응답에 드러나지 않는다) |
````

### A-16. [개발명세서 `docs/02-spec/개발명세서.md`] §4.1 챗봇 스코프 — 업무 자동화 `ARCHIVED` 규칙

**찾을 원문**
````text
교차 챗봇 버전을 포인터·대상으로 지정하면 `404`다 |
````
**바꿀 내용**
````text
교차 챗봇 버전을 포인터·대상으로 지정하면 `404`다. **[No.41] 업무 자동화는 구독 조회·챗봇 이력·요약·재발송·취소를 `ARCHIVED`에서도 허용**하고(대기 발송 정리 — 예약 취소 선례) 구독 생성·수정·삭제·정지·재개는 `409 CHATBOT_ARCHIVED`다. 교차 챗봇 `subscriptionId`·`runId`는 `404`다 |
````

### A-17. [개발명세서 `docs/02-spec/개발명세서.md`] §4.1 권한 — No.41 권한 보론

**찾을 원문**
````text
같은 완화 방향 설정은 환경변수로만** 바꾼다(콘솔은 읽기 표시만) |
````
**바꿀 내용**
````text
같은 완화 방향 설정은 환경변수로만** 바꾼다(콘솔은 읽기 표시만). **[2026-09-26 No.41] 업무 자동화는 신규 권한·역할 0종이다** — 발송 대상 CRUD·원문 허용·테스트 발송·대상 정지 = `security:write` · 대상 상세·전역 이력 = `security:read` · 노드 `WORKFLOW` = `dialogue:write` · 대상 선택 목록 = `dialogue:read` · 구독 쓰기·재발송·취소 = `chatbot:write` · **구독 조회·챗봇 이력·요약 = `chatbot:read` AND `dialogue:read`**(`AGENT`는 `chatbot:read`를 갖지만 `dialogue:read`가 없어 403 — 신규 권한 없이 상담원을 배제한다, ADR-0041 §8) |
````

### A-18. [개발명세서 `docs/02-spec/개발명세서.md`] §5 성능 — No.41 항목 추가

**찾을 원문**
````text
기동 검사 ≤2초(암호문 100만 행) · 데이터 지도 P95 1초(ADR-0040).
````
**바꿀 내용**
````text
기동 검사 ≤2초(암호문 100만 행) · 데이터 지도 P95 1초(ADR-0040).
  - **[신규 2026-09-26 — 업무 자동화] `WORKFLOW` 아웃풋·이벤트 구독이 없는 챗봇의 공개 대화 지연·응답 바이트·요청 경로 쿼리 수는 불변**이다(엔진 결과 키 분기 1개 · 로그 적재 뒤 구독 캐시 확인만 — 캐시 적중 시 DB 0). `WORKFLOW` 턴의 발송함 적재 **P95 ≤15ms**(방출 1건 = 3쿼리 · 외부 호출 0 — 대화는 발송 결과를 기다리지 않는다) · 이벤트 적재는 원천 동작에 지연 0(커밋 후 fire-and-forget) · 발생 → 첫 시도 P95 ≤10초 · 유휴 발송 루프 1쿼리/5초 · 분당 600건 발송 중 공개 대화 P95 증가 <10%·대화 로그 적재 유실 0(실측 기록) · 이력 목록 P95 300ms(10만 행) · 요약 30일 P95 1초(ADR-0041).
````

### A-19. [개발명세서 `docs/02-spec/개발명세서.md`] §5 보안 — 업무 자동화 비밀·서명·마스킹

**찾을 원문**
````text
구독형 셀프서비스 요구 시 재사용할 확장점만 남긴다(ADR-0040).
````
**바꿀 내용**
````text
구독형 셀프서비스 요구 시 재사용할 확장점만 남긴다(ADR-0040). **[결정 2026-09-26 No.41] 업무 자동화 발송 대상의 서명 비밀·헤더 토큰·비밀 주소도 DB에 저장하지 않고 `WORKFLOW_SECRET__<REF>` 환경변수 참조로만 주입한다** — 읽는 곳은 리졸버 1파일이며 값은 응답·로그·감사·스냅샷·실행 이력 어디에도 없다. 웹훅 송신은 HMAC-SHA256 서명(`X-Chatbot-Signature: t=,v1=` — 받는 쪽 5분 재생 창) + 멱등키(`X-Chatbot-Delivery`)를 싣고, 폼 값은 기본 `maskPii()`(ADR-0013 5번째 적용 지점) · 대상 단위 원문 허용은 ADMIN·이름 재입력·감사(ADR-0041 §5·§7).
````

### A-20. [개발명세서 `docs/02-spec/개발명세서.md`] §5 보안 — 업무 자동화 봉인 항목 추가

**찾을 원문**
````text
평가 원장(텍스트 없음)은 1차 보존 대상이 아니다.
````
**바꿀 내용**
````text
평가 원장(텍스트 없음)은 1차 보존 대상이 아니다.
  - **[신규 2026-09-26] 업무 자동화의 봉인(ADR-0041)**: ① 비밀 환경변수 접두 `WORKFLOW_SECRET__` 보유 파일 1개 ② 출구 레지스트리 6번째 클래스 · `transport.request(` 호출 파일 ⊆ 레지스트리 · 가드 선행 ③ 발송함 적재(`create`) 1파일 · 상태 전이(`update*`) 1파일 · 삭제 = 보존 writer·영구삭제만 ④ 실행 이력·로그·감사에 필드 값·본문·`sessionId`·비밀 0(발송함 `payload`만 일시 예외 — 종단 소거) ⑤ 엔진 I/O 0 · 엔진에 발송 심볼 0 ⑥ 검증·버전·예약·통계·학습·토픽·거버넌스·환경 모듈의 `workflow/` import 0 · 원천 서비스는 순수 포트만 ⑦ `@Public()` 8 · 위젯·ml-worker 심볼 0 ⑧ 레거시 모듈에서는 전송·DNS·IP 정책 파일만 import(`LegacyApiHttpClient` 0) — `workflow-sealing.spec.ts` **W-1~W-18**. **[알려진 한계]** 전달은 최소 1회(받는 쪽 멱등키 중복 제거가 계약) · 원천 커밋 후 발행 전 강제 종료 시 그 이벤트 유실 · 대상 한도는 다중 인스턴스에서 근사.
````

### A-21. [개발명세서 `docs/02-spec/개발명세서.md`] §5 접근성/UI 품질 — 업무 자동화 화면 원칙

**찾을 원문**
````text
(내부 용어 "AAD"·"앵커"·"블라인드 인덱스"·"CAS" 금지).**
````
**바꿀 내용**
````text
(내부 용어 "AAD"·"앵커"·"블라인드 인덱스"·"CAS" 금지).** **[No.41] 업무 자동화의 실행 상태(성공·실패·보류·건너뜀·만료)는 텍스트 라벨 + 아이콘 대체 텍스트(색만으로 구분 금지) · 원문 허용 켜기·대상 삭제·일괄 재발송 확인 창은 초점 가두기·`Esc` 취소·재입력 필드 라벨·명시적 버튼 이름("5건 재발송") · 테스트 발송·재발송 결과 `aria-live="polite"` 1회 · 노드 편집기의 "사용자에게 보이지 않는 아웃풋" 안내는 스크린리더로 읽힌다 · 화면 문구는 "업무 자동화·발송 대상·업무 요청 보내기·이벤트 구독·실행 이력·재발송·일시 정지·테스트 발송"("웹훅·HMAC·멱등키·발송함·백오프"는 짧은 풀이와 함께만).**
````

### A-22. [개발명세서 `docs/02-spec/개발명세서.md`] §5 확장성 — 다중 인스턴스 정합

**찾을 원문**
````text
열람 감사 중복 억제는 인스턴스 로컬(중복 허용 — 누락보다 중복).
````
**바꿀 내용**
````text
열람 감사 중복 억제는 인스턴스 로컬(중복 허용 — 누락보다 중복). **[No.41] 업무 자동화의 다중 인스턴스 정합도 DB가 보장한다** — 발송함 행마다 선점 CAS(`claimToken`)로 같은 행을 두 인스턴스가 동시에 보내지 않고, 죽은 인스턴스의 `SENDING`은 임대(60초) 만료 후 **같은 `deliveryId`로** 재발송한다(최소 1회 + 받는 쪽 멱등키). 프로세스 로컬 상태는 구독 캐시(30초 + 즉시 무효화)·테스트 발송 토큰버킷·적재 실패 계수뿐이며, 대상당 동시·분당 상한은 DB 계수 기반 근사다. `WORKFLOW_DISPATCH_ENABLED`로 발송 전담 인스턴스를 지정할 수 있다(`PollingLoop` 재사용 — ADR-0041 §4).
````

### A-23. [개발명세서 `docs/02-spec/개발명세서.md`] §5 가용성 — 받는 쪽 장애는 대화 실패가 아니다

**찾을 원문**
````text
해당 항목만 의미 매칭에서 빠진다(규칙 매칭 유지 — ADR-0039).
````
**바꿀 내용**
````text
해당 항목만 의미 매칭에서 빠진다(규칙 매칭 유지 — ADR-0039). **[신규 2026-09-26] 받는 쪽 업무 도구의 장애는 대화 실패가 아니다** — 대화는 발송 결과를 기다리지 않고, 408·425·429·5xx·시간 초과·네트워크 오류는 지수 백오프(30초·2분·10분·30분·2시간 ±20%, `Retry-After` 2시간 상한)로 재시도하며, 영구 실패는 본문을 7일 보관해 콘솔에서 재발송한다. 발송함 적재·이벤트 발행 실패는 봇 응답·상담 종료·설문 적재·평가 응답을 실패시키지 않는다(경고 로그 + 요약 계수). 대상 연속 실패 10회는 경고만(자동 정지 없음 — 유실 방지)(ADR-0041).
````

### A-24. [개발명세서 `docs/02-spec/개발명세서.md`] §5 DB 이식성 — 발송함 CAS · nullable 유일

**찾을 원문**
````text
Postgres 전환 시 `secure_delete`는 VACUUM 정책으로 대체(재검토 트리거).**
````
**바꿀 내용**
````text
Postgres 전환 시 `secure_delete`는 VACUUM 정책으로 대체(재검토 트리거).** **[No.41] 발송함 선점·종결·임대 회수·보류/재개·재발송은 Prisma `updateMany` + 영향 행 수(CAS)이며 원시 SQL 0(보유 파일 4 불변) · 중복 적재 차단은 nullable `@unique`(NULL 다중 허용 — SQLite·Postgres 공통, 부분 인덱스 불필요) · 모든 스키마 변경은 `CREATE TABLE`/`CREATE INDEX`(재정의 0 — 부분 유니크 4개 보존). Postgres 전환 후 발송량이 커지면 선점을 `FOR UPDATE SKIP LOCKED`로 바꿀 수 있다(재검토 트리거 — 현행 CAS도 정확하다).**
````

### A-25. [개발명세서 `docs/02-spec/개발명세서.md`] §5.1 환경변수 표 — No.41 추가

**찾을 원문**
````text
`FULL`이면 전화·이메일도 전량 치환(이후 적재분부터) |
````
**바꿀 내용**
````text
`FULL`이면 전화·이메일도 전량 치환(이후 적재분부터) |
| **`WORKFLOW_ENABLED`** · **`WORKFLOW_DISPATCH_ENABLED`** | `apps/api/.env` | — | `true` · `true` | 업무 자동화 기능 전체(No.41 — `false`면 노드 요청 건너뜀 기록·이벤트 적재 0·루프 미시작) · 이 인스턴스의 발송 루프(발송 전담 인스턴스 지정 — 시험은 `jest.isolate-env.js`가 `false`) |
| **`WORKFLOW_DISPATCH_INTERVAL_MS`** · **`WORKFLOW_DISPATCH_BATCH`** · **`WORKFLOW_CLAIM_LEASE_MS`** | `apps/api/.env` | — | `5000` · `20` · `60000` | 발송 루프 주기·tick당 선점 상한·`SENDING` 임대(타임아웃 상한 + 30초 미만이면 경고 후 보정) |
| **`WORKFLOW_MAX_TIMEOUT_MS`** · **`WORKFLOW_MAX_ATTEMPTS_CAP`** · **`WORKFLOW_BACKOFF_SCHEDULE`** | `apps/api/.env` | — | `15000` · `10` · `30s,2m,10m,30m,2h` | 대상 타임아웃·최대 시도 상한 · 재시도 간격(±20% 지터) |
| **`WORKFLOW_PAYLOAD_MAX_BYTES`** · **`WORKFLOW_SESSION_LIMIT`** · **`WORKFLOW_SESSION_WINDOW_MIN`** · **`WORKFLOW_TARGET_RATE_PER_MIN`** | `apps/api/.env` | — | `16384` · `3` · `10` · `60` | 봉투 상한 · (세션, 대상) 노드 요청 상한 · 대상 분당 시도 상한(근사) |
| **`WORKFLOW_HOLD_MAX_HOURS`** · **`WORKFLOW_FAILED_PAYLOAD_RETENTION_DAYS`** | `apps/api/.env` | — | `24` · `7` | 일시 정지 보류 만료 · 실패 본문 보관(재발송 창) |
| **`WORKFLOW_PRIVATE_ALLOWLIST`** · **`WORKFLOW_ALLOW_HTTP`** | `apps/api/.env` | — | 없음 · `false` | 웹훅 사설 대역 허용(레거시 목록과 별도 · 절대 차단 대역은 불가) · 평문 http 대상 허용(개발·사내 전용) |
| `WORKFLOW_SECRET__<REF>` | `apps/api/.env` | — | — | 발송 대상 서명 비밀·헤더 토큰·비밀 주소(`secretRef`·`signingSecretRef`·`urlSecretRef`별). **`EnvSchema`에 등록하지 않고** 리졸버 1파일이 접두사 규약으로 직접 읽는다. 값을 로그·오류·응답에 출력 금지 · 서명 비밀 32자 이상 권장 |
````

### A-26. [개발명세서 `docs/02-spec/개발명세서.md`] §5.1 그룹별 주석 — No.41

**찾을 원문**
````text
시험은 `jest.isolate-env.js`가 잡 2종을 끈다. seed는 변경하지 않는다.
````
**바꿀 내용**
````text
시험은 `jest.isolate-env.js`가 잡 2종을 끈다. seed는 변경하지 않는다.
> **업무 자동화 그룹(No.41)이 추가한 16개도 전부 선택이며 API 전용이다(ml-worker 변수 추가 0건).** 하나도 설정하지 않으면 기능 켜짐·발송 루프 5초·임대 60초·재시도 5회(30초~2시간)·세션 상한 10분 3회·보류 24시간·실패 본문 7일·사설 대역 전부 거부·https만으로 동작하며, **발송 대상이 0개이면 관측 가능한 변화가 없다**(빈 발송함 1쿼리/주기). 비밀은 `WORKFLOW_SECRET__<REF>` 접두 규약(스키마 밖 — 레거시 시크릿 선례)이며 필요한 비밀이 없으면 해당 요청이 `SECRET_MISSING`으로 실패한다(기동 실패 아님). boolean은 전부 `envBoolean()`. 시험은 `jest.isolate-env.js`가 발송 루프를 끈다. 데모 발송 대상 seed는 만들지 않는다(실제 외부 발송 방지).
````

### A-27. [개발명세서 `docs/02-spec/개발명세서.md`] §6 결정 18(ADR-0013) — No.41 갱신 각주

**찾을 원문**
````text
원문 예외는 넓히지 않는다(ADR-0013 갱신 각주, ADR-0040 §3).
````
**바꿀 내용**
````text
원문 예외는 넓히지 않는다(ADR-0013 갱신 각주, ADR-0040 §3).
    - **갱신(2026-09-26 — No.41)**: **다섯 번째 적용 지점 = 업무 자동화 웹훅 송신**(저장·RAG·증강·레거시·웹훅) — 노드 `WORKFLOW`의 폼 슬롯 값만 `maskPii()`(1벌 · `PII_MASK_MODE` 반영) · 상수는 비적용 · **대상 단위 원문 허용**(ADMIN·이름 재입력·감사 — No.26 연결 예외와 같은 규약) · 이벤트 봉투에는 텍스트 본문이 없다(`sessionRef`·수치·id만). 재시도용 봉투는 발송함에 일시 보관(성공 즉시·실패 7일 뒤 소거 · 거버넌스 암호화 대상)(ADR-0013 갱신 각주, ADR-0041 §7).
````

### A-28. [개발명세서 `docs/02-spec/개발명세서.md`] §6 결정 21(ADR-0016) — No.41 갱신 각주

**찾을 원문**
````text
파기 요약은 기존 `PURGE`(주체 system)(ADR-0016 갱신 각주, ADR-0040 §5·§7).
````
**바꿀 내용**
````text
파기 요약은 기존 `PURGE`(주체 system)(ADR-0016 갱신 각주, ADR-0040 §5·§7).
    - **갱신(2026-09-26 — No.41)**: `AuditTargetType` **27 → 30**(`WorkflowTarget`·`WorkflowSubscription`·`WorkflowRun`) · `AuditAction` 추가 0(16). 대상·구독 CRUD·정지/재개 · 원문 허용(`UPDATE` before/after) · 재발송·취소(`STATUS_CHANGE` 요약 1건) · 테스트 발송(`WorkflowRun` `CREATE` — 결과 코드만). **발송 1건 1건은 감사가 아니다**(실행 이력 — §5 `ApiCallLog` 선례)(ADR-0016 갱신 각주, ADR-0041 §8).
````

### A-29. [개발명세서 `docs/02-spec/개발명세서.md`] §6 결정 32(ADR-0031) — No.41 갱신 각주

**찾을 원문**
````text
보존 보호 집합에 환경 참조 버전(ADR-0031 갱신 각주, ADR-0039).
````
**바꿀 내용**
````text
보존 보호 집합에 환경 참조 버전(ADR-0031 갱신 각주, ADR-0039).
    - **갱신(2026-09-26 — No.41)**: 노드 `WORKFLOW` 아웃풋은 대화 자산이라 **스냅샷에 자동 포함**(스키마 버전 1 · 업캐스터 불필요 · 해시 규칙 불변). 발송 대상(`WorkflowTarget`)은 전역 설정이라 스냅샷 밖 — 참조 대상 없음/꺼짐은 복원·전환 미리보기 **경고**(`WORKFLOW_TARGET_MISSING`·`WORKFLOW_TARGET_DISABLED` — blocker 아님), 대상 삭제는 스냅샷 참조를 검사하지 않는다(No.26 선례). 이벤트 구독은 환경 밖(ADR-0031 갱신 각주, ADR-0041 §8).
````

### A-30. [개발명세서 `docs/02-spec/개발명세서.md`] §6 결정 35(ADR-0034) — No.41 갱신 각주

**찾을 원문**
````text
경과 시 행 삭제(ADR-0034 갱신 각주, ADR-0040 §2).
````
**바꿀 내용**
````text
경과 시 행 삭제(ADR-0034 갱신 각주, ADR-0040 §2).
    - **갱신(2026-09-26 — No.41)**: 재검토 트리거 "쓰기형 후속 액션(승인·티켓 생성) → No.41"을 **이행**한다 — 재시도·멱등키·재시도 큐는 No.41의 비동기 발송(POST 고정)이며 No.26은 같은 턴 동기 조회/단발 POST 그대로다(같은 턴 결과가 필요하면 No.26). 업무 자동화 발송기는 이 결정의 **전송(`node-http.transport.ts`)·DNS(`node-dns.resolver.ts`)·주소 판정(`ip-policy.ts`) 부품을 이동 없이 두 번째 DI 토큰으로 공유**한다 — 전송 요청 선택 필드 `exitId`·`responseMode`(기본값 = 현행) · `LegacyApiHttpClient` 주입 1파일(L-4)·`node:http(s)`/`node:dns` import 1파일(L-2) 불변 · 사설 대역 허용 목록은 별도(`WORKFLOW_PRIVATE_ALLOWLIST`)(ADR-0034 갱신 각주, ADR-0041 §6).
````

### A-31. [개발명세서 `docs/02-spec/개발명세서.md`] §6 결정 36(ADR-0035) — No.41 갱신 각주

**찾을 원문**
````text
(+ ADR-0002·0008·0009·0013·0015·0016·0019·0030·0031·0033·0034 갱신 각주)
````
**바꿀 내용**
````text
(+ ADR-0002·0008·0009·0013·0015·0016·0019·0030·0031·0033·0034 갱신 각주)
    - **갱신(2026-09-26 — No.41)**: `surveyEvents`의 "엔진은 방출만, API 계층이 적재" 형태를 업무 자동화가 **두 번째로** 쓴다(`workflowEvents?` — 비종결·사용자 출력 0 · 정지점 미사용). 재진입 이월 규칙(③ 중 `resumeAfterApiCall` 이월)도 같은 방식으로 `ApiResumeState.workflow?`에 적용한다. 설문 완료는 이벤트 구독 `SURVEY_COMPLETED`의 원천이다(완료 트랜잭션 뒤 포트 발행 1줄 — 쓰기 코드 불변)(ADR-0035 갱신 각주, ADR-0041 §2·§3).
````

### A-32. [개발명세서 `docs/02-spec/개발명세서.md`] §6 결정 41(ADR-0040) 갱신 각주 + 결정 42 신설

**찾을 원문**
````text
(+ ADR-0002·0013·0015·0016·0022·0026·0033·0034·0036 갱신 각주)
````
**바꿀 내용**
````text
(+ ADR-0002·0013·0015·0016·0022·0026·0033·0034·0036 갱신 각주)
    - **갱신(2026-09-26 — No.41)**: 외부 출구 **5 → 6클래스**(`WORKFLOW_WEBHOOK` — 데이터 종류 `WORKFLOW_PAYLOAD` · 마스킹 대상별) · 필드 암호화 대상 **4번째** `WORKFLOW_PAYLOAD`(발송함 재시도 본문 — 봉인·개봉 1파일씩 · 백필/재암호화 잡 제외 · 기동 옛 키 검사 포함) · 실행 이력은 보존 종류 `CALL_LOGS`에 편입(종단 행만 행 삭제) · 데이터 지도 선택 키 2(대상 0개면 생략)(ADR-0040 갱신 각주, ADR-0041 §6·§7).

42. **업무 자동화 워크플로우(No.41)의 트리거·엔진 통합·발송 모델·전송 계약·출구·보안·권한 확정(2026-09-26 — PM 확정, P-1~P-12 추천안)**: **① 트리거 = 대화그래프 아웃풋 `WORKFLOW`("업무 요청 보내기" — 폼 값 전송) + 챗봇별 이벤트 구독 5종**(상담 시작·종료·설문 완료·부정 평가·연속 미응답 N회 — 대화 종료·운영 이벤트는 2차)(P-1 (c)·P-5). **② 엔진 = 비종결 이벤트 방출**(`workflowEvents?` — 키 부재 규칙 · 사용자 출력 0 · 정지 없음) · 닫힌 목록 E-1~E-8 · **재진입 이월**(`ApiResumeState.workflow?` — 정지 전 방출분 + 같은 턴 완료 폼, `WORKFLOW` 있는 번들만) · 엔진 I/O 0(P-2 (a)). **③ 이벤트 = 원천 커밋 후 순수 포트 발행**(원천의 1회 신호 — 개입 성공·종료 CAS·설문 완료·평가 선점·로그 적재 — + 발송함 유일 키 · 원천 쓰기 코드 불변 · 발행 전 강제 종료 시 유실 수용). **④ 발송 = DB 발송함 `WorkflowRun` + `PollingLoop`(5초) + 행 선점 CAS · 최소 1회 + 멱등키(`deliveryId`) · 지수 백오프(30초~2시간 · `Retry-After`) · 영구 실패 7일 보관·재발송 · 보류 24시간 만료** · 대화는 결과를 기다리지 않는다(P-4 (a) — `@Public()` 8 유지 · 콜백 2차). **⑤ 범용 서명 웹훅**(POST JSON 봉투 v1 — 적재 시 바이트 확정 · `X-Chatbot-Signature: t=,v1=` HMAC-SHA256 · 헤더 인증 4종 · 비밀 주소(호스트 일치 강제) · 응답 본문 미저장)(P-3 (a)). **⑥ 출구 6번째 클래스 + No.26 SSRF 부품 이동 없는 공유**(C-2 해소 — L-2·L-4 불변 · 사설 목록 별도 · 리다이렉트 불추종 = 모드 무관). **⑦ 비밀 = `WORKFLOW_SECRET__<REF>`**(P-7) · **폼 값 기본 마스킹 + 대상 단위 원문 허용(ADR-0013 5번째)** · 대화 본문·`sessionId` 0(`sessionRef`) · 본문 일시 보관·암호화 편입·`CALL_LOGS` 보존(P-6). **⑧ 신규 권한·역할 0**(구독 조회·챗봇 이력 = `chatbot:read` AND `dialogue:read` — AGENT 배제)(P-8) · 노드 = 스냅샷 포함 · 대상 = 전역·스냅샷 밖 · 구독 = 환경 밖(P-10) · 대상 삭제 409 = 초안 노드 + 구독. 신규 `ApiErrorCode` 2종 · 선택 환경변수 16종 + 비밀 접두 규약 · 관리자 21 핸들러 · 위젯·ml-worker 변경 0. GPU **2 → 1**(P-12). → **ADR-0041**(+ ADR-0002·0008·0013·0016·0031·0034·0035·0039·0040 갱신 각주)
````

### A-33. [개발명세서 `docs/02-spec/개발명세서.md`] §7 인덱스 — 설계서 행 추가

**찾을 원문**
````text
| 요구사항: `docs/requirements/data-governance.md` |
````
**바꿀 내용**
````text
| 요구사항: `docs/requirements/data-governance.md` |
| **`workflow-automation-설계.md`** | **업무 자동화 워크플로우(No.41) — 모듈 배치(`workflow` export 0 · `workflow/catalog` 읽기 전용 · `workflow/triggers` 적재·포트 구현 · 순수 포트 `common/workflow`) · Prisma 변경안(`WorkflowTarget`·`WorkflowSubscription`·`WorkflowRun` — 마이그레이션 1개 · `CREATE`만 · 부분 유니크 4 보존 · nullable `dedupeKey` 유일) · shared-types(`workflow.ts` 신설 · 봉투 v1 zod `.strict()`) · ★엔진 닫힌 목록 E-1~E-8(비종결 방출 · 재진입 이월 · 폼 값 이월 조건) · ★이벤트 발행 포트 위치·1회 보장 표 · 구독 캐시 · 연속 미응답 판정(No.24 1벌) · ★발송 큐(상태 기계 · tick 흐름 · 선점 CAS · 임대 회수 · 결과 분류 · 백오프 · 보류/재개/만료 · 실패 보관·재발송) · 서명 형식·재생 방지·멱등키 · ★출구 6번째 클래스 · G-1/G-2 준수 · SSRF 부품 이동 없는 공유(C-2) · 암호화 편입·키 교체·`CALL_LOGS` · PII·원문 허용·금지어 · 21개 엔드포인트·오류 2종 · 권한(AGENT 배제 AND) · 감사 · 버전/환경 · **봉인 W-1~W-18** · 성능 예산 · **미사용 동작 불변 보장표** · 콘솔 인계 · 시험 전략(★상대 시각 원칙)·**의도된 기대값 변경 4건(닫힌 목록)** · 알려진 제한 12건 · 요구사항 대비 해석 16건** | 요구사항: `docs/requirements/workflow-automation.md` |
````

### A-34. [개발명세서 `docs/02-spec/개발명세서.md`] §7 인덱스 — ADR-0041 행 추가

**찾을 원문**
````text
AC-DG1~DG8 |
````
**바꿀 내용**
````text
AC-DG1~DG8 |
| **`decisions/ADR-0041-workflow-webhook-engine-emission-db-outbox-and-sixth-egress-class.md`** | **업무 자동화 = 노드 아웃풋 `WORKFLOW` + 이벤트 구독 5종(노드 도달 구독·`API_CONDITION`/`SCENARIO` 재사용 기각) · 엔진 비종결 방출 `workflowEvents?` + 재진입 이월(닫힌 목록) · 원천 커밋 후 순수 포트 발행(트랜잭셔널 아웃박스 기각 — 봉인 쓰기 파일 불변) · DB 발송함 + `PollingLoop` + 행 선점 CAS · 최소 1회 + 멱등키(인메모리 큐·Redis 기각) · 서명 웹훅 v1 · 출구 6번째 클래스 + No.26 SSRF 부품 이동 없는 공유(공용 이동·전용 전송·`fetch` 기각) · 비밀 환경변수 · 대상 단위 원문 허용 · 본문 일시 보관·암호화 편입 · 신규 권한 0(AND로 AGENT 배제)** | 요구사항 J-1~J-22, FR-0-172~182, FR-WF1-\*~FR-WF10-\*, AC-WF1~WF7 |
````

---

## B. 기존 ADR (결정 본문은 수정하지 않는다 — 파일 끝 append)

### B-1. [ADR-0002] `docs/02-spec/decisions/ADR-0002-permanent-delete-referential-integrity.md` — 구독·발송 이력 동반 삭제 (append)

**찾을 원문**
````text
로그 포함 영구삭제는 여전히 불허(No.29 P-2).
````
**바꿀 내용**
````text
로그 포함 영구삭제는 여전히 불허(No.29 P-2).


---

## 갱신 (2026-09-26 — No.41: 구독·발송 이력 동반 삭제 · 사전검사 불변)

업무 자동화(No.41, **ADR-0041 §8**). 결정 1~6은 불변이다.

- 챗봇 이벤트 구독(`WorkflowSubscription` — FK `Restrict`)은 설정 데이터라 **동반 삭제**, 발송 이력(`WorkflowRun` — FK 없음)은 호출 로그(`ApiCallLog`) 선례로 **동반 삭제**다(20 → 22테이블 · 대기 발송 건 포함 — 삭제 확인 화면이 건수를 알린다). 사전검사 목록(15종)은 불변이다.
- 발송 대상(`WorkflowTarget`)은 전역 설정이라 챗봇 영구삭제와 무관하다. 대상 삭제는 초안 노드·구독 참조 시 `409 WORKFLOW_TARGET_IN_USE`(구독 → 대상 FK `Restrict`가 최종 방어선)이며, 대기 발송 건은 `CANCELLED(TARGET_DELETED)`로 종결한다.
````

### B-2. [ADR-0008] `docs/02-spec/decisions/ADR-0008-dialogue-resolution-pipeline.md` — 세 번째 의도된 엔진 확장 (append)

**찾을 원문**
````text
캡처 시점 초안과도 같다.
````
**바꿀 내용**
````text
캡처 시점 초안과도 같다.


---

## 갱신 (2026-09-26 — No.41: 세 번째 의도된 엔진 확장 — 비종결 이벤트 방출 `WORKFLOW`)

업무 자동화(No.41, **ADR-0041 §2**). §1~§8의 결정(진입점·우선순위·예외 없음·설계 점검의 엔진 배치)은 불변이다.

1. **아웃풋 13종째 `WORKFLOW`는 실행 지원 타입**이다(`UNSUPPORTED_OUTPUT_TYPES` 불변). 엔진은 이 아웃풋을 **출력에 넣지 않고, 정지하지도 종결하지도 않는다** — 바인딩(No.26 `resolveBinding` 1벌)을 해석한 `WorkflowEmission`을 결과 선택 필드 `workflowEvents?`에 싣고 뒤 아웃풋을 계속 실행한다. 없으면 키 부재(결과 모양 불변).
2. **§6 "항상 최소 1건 응답"은 그대로다** — 노드 아웃풋이 `WORKFLOW`뿐이면 기존 0건 보장(기본 폴백 문구 + `EMPTY_OUTPUT`)이 적용된다. 엔진은 바꾸지 않고 §7 설계 점검 `WORKFLOW_ONLY_OUTPUT`(WARNING)으로 알린다.
3. **§7 설계 점검**: 규칙 5종(`WORKFLOW_SLOT_BINDING_UNREACHABLE`·`WORKFLOW_TARGET_UNAVAILABLE`·`WORKFLOW_ONLY_OUTPUT`·`WORKFLOW_NO_FIELDS`·`WORKFLOW_RAW_PERSONAL_DATA`) + 없는 대상 `BROKEN_REFERENCE`. 대상 정보는 `validateDialogueDesign`의 선택 3번째 인자에 `workflowTargets`로 더한다(엔진이 DB를 읽지 않는 원칙 유지).
4. 엔진 수정은 ADR-0041 §2의 **닫힌 목록 E-1~E-8**이며 엔진 I/O 0건 정적 검사(L-5)가 계속 단언한다. `WORKFLOW`가 없는 번들의 모든 소비자 결과(API 정지 시 `apiCall` 포함)는 바이트 단위로 불변이다.
````

### B-3. [ADR-0013] `docs/02-spec/decisions/ADR-0013-pii-masking-policy-and-placement.md` — 다섯 번째 적용 지점 (append)

**찾을 원문**
````text
출구 레지스트리가 `QUERY_RAW`로 분류하고 거버넌스 모드에서 호스트 승인·경고로 드러낸다.
````
**바꿀 내용**
````text
출구 레지스트리가 `QUERY_RAW`로 분류하고 거버넌스 모드에서 호스트 승인·경고로 드러낸다.


---

## 갱신 (2026-09-26 — No.41: 다섯 번째 적용 지점 = 업무 자동화 웹훅 송신 · 대상 단위 원문 예외)

업무 자동화(No.41, **ADR-0041 §7**). 정책(대상·차등)·함수 1벌·순서는 **불변**이다.

1. **적용 지점 5번째**(저장 · RAG 송신 · 증강 송신 · 레거시 송신 · **웹훅 송신**): 노드 `WORKFLOW`의 **폼 슬롯 값**만 `maskPii()`(`PII_MASK_MODE` 반영)를 거친다. 관리자 상수는 비적용(No.26 규약).
2. **대상 단위 예외**: `WorkflowTarget.allowRawPersonalData=true`만 원문 — ADMIN(`security:write`) · 대상 이름 재입력 · 감사 before/after · 콘솔·데이터 지도·노드 편집기·설계 점검·시뮬레이터에 항상 표시. 기본값 false.
3. **예외 없는 곳**: 실행 이력·서버 로그·감사·trace·오류 응답에 필드 값이 **원문이든 마스킹본이든** 없다(`personalDataMasked` 플래그·필드 이름만). 이벤트 봉투(상담·설문·평가·연속 미응답)에는 텍스트 본문이 없고 `sessionId` 대신 `sessionRef`만 싣는다.
4. **재시도용 봉투의 일시 보관**: 발송함 `payload`는 성공·취소·만료 즉시 소거, 실패는 7일 뒤 소거되며 거버넌스 모드에서 필드 암호화 대상(ADR-0040 §3의 4번째 필드)이다 — "원문 경로 0" 원칙의 예외가 아니라 **송신 직전 값의 재시도 버퍼**다(원문 허용 대상이면 원문, 아니면 마스킹본). 금지어 필터는 봉투에 적용하지 않는다(업무 데이터 — 레거시 송신과 같은 판단).
````

### B-4. [ADR-0016] `docs/02-spec/decisions/ADR-0016-audit-log-backfill-scope.md` — 대상 3종 · 발송 1건 비감사 (append)

**찾을 원문**
````text
상세 응답 `chain?`(값 있을 때만) · 목록 응답 불변.
````
**바꿀 내용**
````text
상세 응답 `chain?`(값 있을 때만) · 목록 응답 불변.


---

## 갱신 (2026-09-26 — No.41: 대상 3종 · 발송 1건은 감사가 아니다)

업무 자동화(No.41, **ADR-0041 §8**). 기록 위치·커밋 후 기록·화이트리스트·실패 흡수 규약은 **불변**이다.

1. **`AuditTargetType` 27 → 30**: `WorkflowTarget`(발송 대상)·`WorkflowSubscription`(이벤트 구독)·`WorkflowRun`(업무 요청 실행 — 요약 전용, `AUDIT_FIELDS = []`). **`AuditAction` 추가 0**(16 — `topic-sealing.spec.ts` T-10 불변).
2. 기록: 대상·구독 `CREATE`·`UPDATE`·`DELETE` · 정지/재개 `STATUS_CHANGE` · 원문 허용 변경 `UPDATE`(before/after) · 재발송·취소 `STATUS_CHANGE` 요약 1건(대상 = 챗봇 · 건수·대상 이름) · 테스트 발송 `WorkflowRun` `CREATE`(결과 코드·HTTP 상태만).
3. 화이트리스트에 비밀 **참조 이름**(`secretRef`·`signingSecretRef`·`urlSecretRef`)은 넣되 값은 없다(DB에도 없다). 필드 값·봉투·`sessionId`는 넣지 않는다.
4. **발송 1건 1건·자동 재시도·보류 만료·본문 소거는 감사하지 않는다** — 실행 이력(`WorkflowRun` 메타데이터)이 기록이다(§5 `ApiCallLog` 선례).
````

### B-5. [ADR-0031] `docs/02-spec/decisions/ADR-0031-chatbot-version-snapshot-and-id-preserving-restore.md` — `WORKFLOW` 스냅샷 포함 · 대상·구독 스냅샷 밖 (append)

**찾을 원문**
````text
운영 되돌리기는 복원이 아니라 포인터 롤백(ADR-0039 §5)이다.
````
**바꿀 내용**
````text
운영 되돌리기는 복원이 아니라 포인터 롤백(ADR-0039 §5)이다.


---

## 갱신 (2026-09-26 — No.41: `WORKFLOW` 아웃풋은 스냅샷 포함 · 발송 대상·구독은 스냅샷 밖)

업무 자동화(No.41, **ADR-0041 §8**). 스냅샷 범위·ID 보존 복원·단일 트랜잭션·해시 규칙은 **불변**이다.

1. 노드 `WORKFLOW` 아웃풋(대상 id·동작 키·필드 바인딩)은 노드 자산이라 **스냅샷·차이·복원·환경 포인터에 자동 포함**된다. `SNAPSHOT_SCHEMA_VERSION = 1` 유지 · **업캐스터 불필요**(읽기 스키마에 타입 추가뿐 — 과거 스냅샷엔 없다).
2. **`WorkflowTarget`은 스냅샷 대상이 아니다** — `ApiConnection`과 같은 전역 설정이다(비밀도 환경변수라 스냅샷에 들어갈 자리가 없다). 복원·운영 전환·예약 전환 미리보기 경고 2종(blocker 아님): `WORKFLOW_TARGET_MISSING` · `WORKFLOW_TARGET_DISABLED` — 실행 시 `SKIPPED(TARGET_UNAVAILABLE)`.
3. **대상 삭제는 스냅샷 참조를 검사하지 않는다**(초안 노드·구독만 `409`) — 스냅샷 본문 테이블 참조 파일 봉인(V-7)을 넓히지 않는다(No.26 갱신 4 선례).
4. **`WorkflowSubscription`은 스냅샷 밖**(환경 밖 — 저장 즉시 운영 반영)이며 챗봇 복사·토픽 분리 대상이 아니다.
````

### B-6. [ADR-0034] `docs/02-spec/decisions/ADR-0034-legacy-api-connection-registry-and-engine-suspension.md` — 재검토 트리거 이행 · 전송 부품 공유 (append)

**찾을 원문**
````text
"평문 토큰 잔존 노드 수·스냅샷 수"를 점검 표시한다.
````
**바꿀 내용**
````text
"평문 토큰 잔존 노드 수·스냅샷 수"를 점검 표시한다.


---

## 갱신 (2026-09-26 — No.41: 재검토 트리거 "쓰기형 후속 액션" 이행 · 전송 부품 공유 · 선택 필드 2)

업무 자동화(No.41, **ADR-0041 §4·§6**). 결정 1~11은 불변이다.

1. 재검토 트리거 "**쓰기형 후속 액션(승인·티켓 생성) 요구 → No.41(재시도 큐·멱등키·비동기 콜백)**"을 **이행**한다 — 재시도·멱등키·재시도 큐는 No.41의 DB 발송함(POST 고정 · 최소 1회 + `deliveryId`)이다. 비동기 콜백은 No.41 2차. 같은 턴 결과(접수번호 즉시 표시)는 여전히 이 결정의 동기 `API_CONDITION`이다.
2. **전송·DNS·주소 판정 부품 공유**: 업무 자동화 발송기가 `NodeHttpTransport`·`NodeDnsResolver`를 **파일 이동 없이** 자기 모듈의 두 번째 DI 토큰으로 등록하고 `lib/ip-policy.ts`를 import한다 — 결정 4의 방어 층(DNS 1회·모든 주소 검사·절대 차단 대역·사설 allowlist·검증 주소 고정·단일 데드라인·리다이렉트 불추종)이 두 출구에서 한 벌이다. `LegacyApiModule`·`LegacyApiHttpClient`·`ValidatedLegacyRequest`·시크릿 리졸버는 공유하지 않는다 — L-2(`node:http(s)`·`node:dns` import 1파일씩)·L-4(`LegacyApiHttpClient` 주입 1파일) **불변**.
3. **전송 포트 선택 필드 2개**(기본값 = 현행 — 레거시 호출부·spec 무수정): `exitId?`(방어 이중화 가드의 출구 id — 기본 `LEGACY_API`) · `responseMode?: 'BODY'｜'STATUS_ONLY'`(웹훅은 상태 코드만 — 본문 상한 초과로 성공을 잃지 않게) + 결과 선택 필드 `retryAfter?`(`STATUS_ONLY`일 때만).
4. 사설 대역 허용 목록은 **출구별로 분리**한다(`LEGACY_API_PRIVATE_ALLOWLIST` · `WORKFLOW_PRIVATE_ALLOWLIST`) — 조회 연동을 위해 연 사설 대역이 쓰기형 웹훅에 자동으로 열리지 않게(최소 권한).
5. 새 재검토 트리거: **세 번째 출구가 같은 부품을 공유** → `transport/*`·`lib/ip-policy.ts`를 `common/outbound/`로 이동(L-2 경로 갱신).
````

### B-7. [ADR-0035] `docs/02-spec/decisions/ADR-0035-survey-dialogue-session-and-server-response-ledger.md` — 엔진 이벤트 방출 두 번째 사례 (append)

**찾을 원문**
````text
완료 트랜잭션을 `Serializable` 대상에 추가(동시 완료 경합).
````
**바꿀 내용**
````text
완료 트랜잭션을 `Serializable` 대상에 추가(동시 완료 경합).


---

## 갱신 (2026-09-26 — No.41: 엔진 이벤트 방출의 두 번째 사례 · 설문 완료 = 업무 자동화 이벤트 원천)

업무 자동화(No.41, **ADR-0041 §2·§3**). 결정 1~12는 불변이다.

1. §3의 "엔진은 방출만(`surveyEvents`), API 계층이 사후 적재" 형태를 **업무 자동화가 두 번째로** 쓴다 — `workflowEvents?`(비종결 · 사용자 출력 0 · 키 부재 규칙 · 정지점 미사용). 재진입 이월(`ApiResumeState.survey`)도 같은 방식으로 `ApiResumeState.workflow?`에 적용한다.
2. 설문 완료(`COMPLETED` 적재 트랜잭션 성공)는 이벤트 구독 `SURVEY_COMPLETED`의 원천이다 — `SurveyResponseService`는 트랜잭션 **뒤** 순수 포트 `emit()` 1줄만 더하며 쓰기 코드·쓰기 파일 봉인(S-2)·마스킹 순서(S-11)는 불변이다. 완료 판정은 CAS가 아니므로(가드 읽기 후 `update`) 중복 발행은 발송함 유일 키(응답 id)가 흡수한다. 봉투에는 자유 텍스트가 없고 선택·척도 답(key·정수)만 구독 옵션으로 싣는다.
````

### B-8. [ADR-0039] `docs/02-spec/decisions/ADR-0039-environment-pointers-version-serving-and-content-addressed-vector-retention.md` — 구독 환경 밖 · 전환 경고 (append)

**찾을 원문**
````text
서명 토큰 미리보기 링크(공개 표면 +1)를 새 ADR로.
````
**바꿀 내용**
````text
서명 토큰 미리보기 링크(공개 표면 +1)를 새 ADR로.


---

## 갱신 (2026-09-26 — No.41: 업무 자동화 구독은 환경 밖 · 운영 발송은 운영 버전 번들 · 전환 경고 2종)

업무 자동화(No.41, **ADR-0041 §8**). 결정 1~8은 불변이다.

1. 노드 `WORKFLOW` 아웃풋은 스냅샷에 포함되므로 **환경 모드 챗봇의 공개 대화는 운영 버전 번들의 `WORKFLOW`로 발송**한다 — 초안에만 추가한 아웃풋은 운영에서 발송 0(편집 격리 그대로). 실행 이력에 `servedVersionId`를 남긴다.
2. **이벤트 구독(`WorkflowSubscription`)·발송 대상은 환경 밖**이다(설문·상담 설정·토픽 활성과 같은 "저장 즉시 운영 반영" 규약 — 구독 캐시 30초 + 즉시 무효화). 편집 화면이 이를 안내한다.
3. 운영 전환·예약 전환 미리보기 경고 +2(`WORKFLOW_TARGET_MISSING`·`WORKFLOW_TARGET_DISABLED` — blocker 아님).
````

### B-9. [ADR-0040] `docs/02-spec/decisions/ADR-0040-data-governance-mode-egress-gate-field-encryption-text-purge-and-audit-hash-chain.md` — 출구 6클래스 · 암호화 4번째 · `CALL_LOGS` (append)

**찾을 원문**
````text
스냅샷 스크럽 도구(ADR-0034 §7 판단 재검토).
````
**바꿀 내용**
````text
스냅샷 스크럽 도구(ADR-0034 §7 판단 재검토).


---

## 갱신 (2026-09-26 — No.41: 출구 6클래스 · 암호화 대상 4번째 · `CALL_LOGS` 편입)

업무 자동화(No.41, **ADR-0041 §6·§7**). 결정 1~7은 불변이다 — 재검토 트리거 "새 외부 출구 클래스는 레지스트리 등록"의 첫 이행이다.

1. **출구 5 → 6클래스**: `WORKFLOW_WEBHOOK`(라벨 "업무 자동화 웹훅" · `EgressDataKind` `WORKFLOW_PAYLOAD` · 마스킹 대상별). 발송 파일 `workflow/dispatch/workflow-http.sender.ts`가 DNS 조회 전 `checkEgress('WORKFLOW_WEBHOOK', …)`를 호출하고(G-2 순서 충족), 공유 전송·DNS 파일은 두 클래스 모두에 나열한다(G-1 파일 집합). 모드 ON 저장 시 호스트 검사 `400 EGRESS_HOST_NOT_ALLOWED` · 발송 시 `EGRESS_BLOCKED`(송신 0 · 영구 실패). 공유 전송은 `node:http`라 리다이렉트를 원래 따라가지 않으므로 I-11(모드 ON 리다이렉트 차단)은 모드 무관으로 충족된다. 데이터 지도 `exits[]`는 DB 결정 출구(레거시·웹훅)를 제외하는 기존 규칙 그대로이고 선택 키 `egress.workflowTargets?`로 보여 준다(대상 0개 = 바이트 동일).
2. **필드 암호화 대상 4번째 `WORKFLOW_PAYLOAD`**(`workflow_runs.payload` — 발송함 재시도 봉투 · AAD = 테이블:컬럼:행 id): 봉인 1파일(적재 writer)·개봉 1파일(발송함 store) — G-5 허용 목록 +1씩. **백필·재암호화 잡 대상이 아니다**(성공 즉시·실패 7일 뒤 소거되는 일시 데이터) · 대신 기동 "옛 키 필요 행" 검사에 포함해 키 선제거를 막는다.
3. **`CALL_LOGS`에 실행 이력 편입**: 파기 잡 writer가 종단 상태 `WorkflowRun`을 보존기간 경과 시 행 삭제(대기·보류·발송 중 제외) — 보존 종류 신설 0 · 라벨 "호출·발송 로그".
````

---

## C. `docs/01-requirements/기능요구사항.md`

### C-1. [기능요구사항 `docs/01-requirements/기능요구사항.md`] §4-1 No.41 행 — PM 확정 · 설계 완료 반영

**찾을 원문**
````text
| 41 | 워크플로우 자동화 | 업무 자동화 워크플로우 커넥터 | 대화 중 트리거된 이벤트를 사내 업무자동화 도구(Power Automate류)와 연결해 승인·티켓생성 등 후속 처리를 자동 실행 | 2 | ○ | ○ | Copilot Studio 벤치마킹. 39번(커넥터 허브)이 "데이터 연동"이라면 이건 "액션 자동 실행" 계층 |
````
**바꿀 내용**
````text
| 41 | 워크플로우 자동화 | 업무 자동화 워크플로우 커넥터 | 대화그래프 아웃풋 **"업무 요청 보내기"**(폼 값 바인딩 · 사용자에게 보이지 않음) + 챗봇별 **이벤트 구독**(상담 시작·종료·설문 완료·부정 평가·연속 미응답 N회) → 전역 **발송 대상(웹훅)** 으로 **비동기 발송**(HMAC 서명 · 멱등키 · 지수 백오프 재시도 · 실패 보관·재발송 · 일시 정지·보류 · 실행 이력 · 테스트 발송) — 승인·티켓 생성 등 후속 처리는 받는 쪽 업무 도구(Power Automate류·ITSM·메신저)가 수행 | 1 | ○ | ○ | **✅ PM 도입 확정(2026-09-25) · 범위·방식 확정(2026-09-26 — P-1~P-12 전부 추천안) · 설계 완료(`docs/02-spec/workflow-automation-설계.md` · ADR-0041).** GPU 2 → **1 하향**(JSON·HMAC·HTTP·DB 발송함뿐). 같은 턴 결과 사용(접수번호 즉시 표시)은 **No.26** · 결과 콜백·대화 표시는 2차(No.35와 함께) · 도구별 프리셋·전용 커넥터는 No.39/47 · 내장 메일·운영 이벤트(예약 실패·위험 동작 알림)·대화 종료 이벤트는 2차 · 새 출구는 No.45 레지스트리 **6번째 클래스**(`WORKFLOW_WEBHOOK`) · 엔진은 닫힌 목록 수정(비종결 방출) · `@Public()` 8 유지 · 신규 권한 0 · 위젯·ml-worker 변경 0. Copilot Studio 벤치마킹. 39번(커넥터 허브)이 "데이터 연동"이라면 이건 "액션 자동 실행" 계층 |
````

### C-2. [기능요구사항 `docs/01-requirements/기능요구사항.md`] §4-1 사용자 확인 결과(106행) — No.41 범위·방식 확정

**찾을 원문**
````text
P-1~P-12 전부 추천안 · 설계 `docs/02-spec/data-governance-설계.md` · ADR-0040).**
````
**바꿀 내용**
````text
P-1~P-12 전부 추천안 · 설계 `docs/02-spec/data-governance-설계.md` · ADR-0040).** **[2026-09-26 갱신] No.41 업무 자동화 워크플로우 커넥터도 범위·방식까지 확정(요구사항 `docs/requirements/workflow-automation.md` §11 P-1~P-12 전부 추천안 · 설계 `docs/02-spec/workflow-automation-설계.md` · ADR-0041).**
````

### C-3. [기능요구사항 `docs/01-requirements/기능요구사항.md`] §3 No.24 행 — 상담 이벤트 알림 결과

**찾을 원문**
````text
원문 정책(상담 중 60분·`RAW_VIEW`) 불변(ADR-0040)** |
````
**바꿀 내용**
````text
원문 정책(상담 중 60분·`RAW_VIEW`) 불변(ADR-0040)** **[2026-09-26 No.41 설계 완료] 상담 시작·종료·연속 미응답 N회를 이벤트 구독으로 업무 도구·메신저(Teams·Slack 수신 웹훅)에 알릴 수 있다(본문 없이 `sessionRef`·수치만 — ADR-0041) · 소리·데스크톱 알림은 범위 밖** |
````

### C-4. [기능요구사항 `docs/01-requirements/기능요구사항.md`] §3 No.26 행 — 쓰기형 후속 액션 이행

**찾을 원문**
````text
시크릿 DB 암호화는 1차 불변(환경변수 참조가 더 강함)(ADR-0040)** |
````
**바꿀 내용**
````text
시크릿 DB 암호화는 1차 불변(환경변수 참조가 더 강함)(ADR-0040)** **[2026-09-26 No.41 설계 완료] 쓰기형 후속 액션(재시도·멱등키·재시도 큐)은 No.41 비동기 발송으로 이행 — 이 기능은 같은 턴 동기 조회/단발 POST 그대로 · 전송·DNS·주소 판정 부품을 No.41이 공유(ADR-0041)** |
````

### C-5. [기능요구사항 `docs/01-requirements/기능요구사항.md`] §3 No.27 행 — 설문 완료 이벤트

**찾을 원문**
````text
대화 종료 자동 설문은 No.24. `SCENARIO`는 No.39 |
````
**바꿀 내용**
````text
대화 종료 자동 설문은 No.24. `SCENARIO`는 No.39 **[2026-09-26 No.41 설계 완료] 설문 완료(응답 1건 단위 — 선택·척도 답 선택 포함)를 업무 도구로 보낼 수 있다 · 응답 수 도달 알림·정기 리포트는 No.41 2차(ADR-0041)** |
````

### C-6. [기능요구사항 `docs/01-requirements/기능요구사항.md`] §3 No.28 행 — 외부 알림 위치

**찾을 원문**
````text
모드 켜진 챗봇은 준비 편집이 운영에 보이지 않는다(ADR-0039)** |
````
**바꿀 내용**
````text
모드 켜진 챗봇은 준비 편집이 운영에 보이지 않는다(ADR-0039)** **[2026-09-26 No.41 설계 완료] 예약 실행 결과의 외부 알림(웹훅·메신저)은 No.41 2차(운영 이벤트) — 1차 콘솔 배지·감사 유지(ADR-0041)** |
````

### C-7. [기능요구사항 `docs/01-requirements/기능요구사항.md`] §4-1 No.44 행 — 부정 평가 이벤트

**찾을 원문**
````text
평가 원장은 1차 보존 대상 아님(ADR-0040)** |
````
**바꿀 내용**
````text
평가 원장은 1차 보존 대상 아님(ADR-0040)** **[2026-09-26 No.41 설계 완료] 👎(첫 선점 1회)를 이벤트 구독으로 품질 티켓 등 업무 도구에 보낼 수 있다(질문·답변 본문 없이 메시지·대상 참조만 — ADR-0041)** |
````

### C-8. [기능요구사항 `docs/01-requirements/기능요구사항.md`] §4-1 No.45 행 — 출구 6클래스

**찾을 원문**
````text
36번(AI거버넌스·가드레일)이 "응답 안전성"이라면 이건 "데이터 거버넌스" |
````
**바꿀 내용**
````text
36번(AI거버넌스·가드레일)이 "응답 안전성"이라면 이건 "데이터 거버넌스" **[2026-09-26 No.41 설계 완료] 외부 출구 5 → 6클래스(업무 자동화 웹훅) · 발송함 재시도 본문이 필드 암호화 4번째 대상 · 발송 이력은 `CALL_LOGS` 보존(ADR-0041)** |
````

---

## D. `docs/requirements/workflow-automation.md` — PM 결정 기록 · 설계 반영

### D-1. [업무 자동화 요구사항 `docs/requirements/workflow-automation.md`] 머리 "도입 상태" — 범위·방식 확정

**찾을 원문**
````text
이 문서는 도입 여부를 묻지 않고 **범위와 방식만** 묻는다(§11).
````
**바꿀 내용**
````text
이 문서는 도입 여부를 묻지 않고 **범위와 방식만** 묻는다(§11). **[범위·방식 확정(2026-09-26, 추천안)] PM이 §11 P-1~P-12를 전부 추천안으로 확정했다 — 설계: `docs/02-spec/workflow-automation-설계.md` · ADR-0041.**
````

### D-2. [업무 자동화 요구사항 `docs/requirements/workflow-automation.md`] 머리 "다음 단계" — 완료 표식

**찾을 원문**
````text
**다음 단계**: PM이 §11 핵심 4건(P-1~P-4)을 결정 →
````
**바꿀 내용**
````text
**다음 단계**: **[2026-09-26 PM 결정·architect 설계 완료 — 다음은 `ui-designer`]** 원 계획: ~~PM이 §11 핵심 4건(P-1~P-4)을 결정~~(완료) →
````

### D-3. [업무 자동화 요구사항 `docs/requirements/workflow-automation.md`] §1.11 핵심 판단 표 머리 — PM 결정 표기

**찾을 원문**
````text
### 1.11 이 문서의 핵심 판단 22건 (⚠ = PM 확인 필요)
````
**바꿀 내용**
````text
### 1.11 이 문서의 핵심 판단 22건 (⚠ = PM 확인 필요)

> **PM 결정(2026-09-26)** — ⚠ 표시 항목을 포함해 아래 "결정(제안)" 열이 **전부 추천안대로 확정**되었다(§11 P-1~P-12). architect 확정·조정은 설계서 §1·§24에 있다: 바인딩 = No.26 `ApiBindingSchema` 재사용(R-1) · 선택 목록 `dialogue:read`(R-2) · 신규 오류 코드 2종(R-3) · `dedupeKey` nullable 유일(R-4) · 연속 미응답 = No.24 판정 재사용(API 고정 문구 산입 — R-5) · 대상 한도 근사(R-6) · SSRF 부품 이동 없는 공유(R-7) · 대상 삭제 409 = 초안 노드 + 구독(R-8) · 챗봇 스코프 조회 `chatbot:read` AND `dialogue:read`(R-9) · 본문 암호화 편입(R-10).
````

### D-4. [업무 자동화 요구사항 `docs/requirements/workflow-automation.md`] §11 PM 확인 항목 — P 절 확정 표기

**찾을 원문**
````text
## 11. PM 확인이 필요한 항목
````
**바꿀 내용**
````text
## 11. PM 확인이 필요한 항목

> **PM 결정(2026-09-26) — 확정(2026-09-26, 추천안).** No.41 도입(2026-09-25) · P-1~P-12 전부 권고안 채택.
> - **P-1 (c)** 확정(2026-09-26, 추천안): 대화그래프 "업무 요청 보내기" 노드(폼 값 전송) + 이벤트 구독(닫힌 목록 5종) 둘 다
> - **P-2 (a)** 확정(2026-09-26, 추천안): 엔진에 새 아웃풋 `WORKFLOW` — `surveyEvents` 선례(`turn.ts` 35~36행)대로 엔진은 "보낼 것"만 결과(`workflowEvents?`)에 싣는다 · 기존 엔진 시험 무수정 통과 · `resumeAfterApiCall` 등 재조립 경로에서 필드 보존(FR-WF2-4 · AC-WF2-6)
> - **P-3 (a)** 확정(2026-09-26, 추천안): 범용 아웃바운드 웹훅 1종 — HMAC 서명·재시도·멱등키 · "비밀 주소" 옵션
> - **P-4 (a)** 확정(2026-09-26, 추천안): 비동기 발송만 · 대화는 결과를 기다리지 않음 · 결과는 콘솔 이력 · `@Public()` 추가 0(8 유지)
> - **P-5** 확정(2026-09-26, 추천안): 이벤트 5종(상담 시작·종료 · 설문 완료 · 부정 평가 · 연속 미응답 N회) · 대화 종료·운영 이벤트는 2차
> - **P-6** 확정(2026-09-26, 추천안): 메타데이터 + `sessionRef` + 마스킹된 폼 값 · 대상별 원문 허용(ADMIN 확인 문구 + 감사) · 대화 본문 0 · 재시도 본문은 성공 즉시·실패 7일 뒤 소거
> - **P-7** 확정(2026-09-26, 추천안): 비밀 = 환경변수 `WORKFLOW_SECRET__<REF>` · DB 값 0
> - **P-8** 확정(2026-09-26, 추천안): 신규 권한 0 — 발송 대상 `security:write` · 구독·재발송 `chatbot:write` · 노드 `dialogue:write`
> - **P-9** 확정(2026-09-26, 추천안): 일시 정지 중 보류 → 재개 시 발송 · 24시간 초과 만료
> - **P-10** 확정(2026-09-26, 추천안): 노드 아웃풋 = 스냅샷 자동 포함 · 발송 대상 = 전역 · 구독 = 환경 밖(저장 즉시 운영 반영)
> - **P-11** 확정(2026-09-26, 추천안): 1차/2차 분리 = §4.13·§9 목록대로
> - **P-12** 확정(2026-09-26, 추천안): GPU 2 → 1 하향 · 구축형 ○ · 구독형 ○
>
> 표 아래 architect 확정 항목의 결정은 설계서 §1 "(architect)" 행과 §24를 따른다.
````

### D-5. [업무 자동화 요구사항 `docs/requirements/workflow-automation.md`] FR-0-179 — 오류 코드 확정

**찾을 원문**
````text
기존 재사용: `EGRESS_HOST_NOT_ALLOWED`(모드 ON 호스트) · `CONFIRM_NAME_MISMATCH`(원문 허용 재입력). 오류 봉투 형식 불변 | ADR-0003 |
````
**바꿀 내용**
````text
기존 재사용: `EGRESS_HOST_NOT_ALLOWED`(모드 ON 호스트) · `CONFIRM_NAME_MISMATCH`(원문 허용 재입력). **[확정 — 신규 2종: `WORKFLOW_TARGET_IN_USE`·`WORKFLOW_RUN_NOT_RETRYABLE`. `WORKFLOW_OUTPUT_INVALID`는 미도입 — 없는 대상은 `INVALID_REFERENCE`(404, No.26/27 선례), 노드당 4개 이상은 `OUTPUT_PAYLOAD_INVALID`(400), 필드 이름 중복은 `VALIDATION_FAILED` — 설계서 §12.4]** 오류 봉투 형식 불변 | ADR-0003 |
````

### D-6. [업무 자동화 요구사항 `docs/requirements/workflow-automation.md`] FR-0-180 — 기대값 변경 닫힌 목록 확정

**찾을 원문**
````text
| FR-0-180 | **의도된 기존 시험 기대값 변경은 architect가 닫힌 목록으로 확정**한다
````
**바꿀 내용**
````text
| FR-0-180 | **의도된 기존 시험 기대값 변경은 architect가 닫힌 목록으로 확정**한다 **[확정 — 설계서 §21.3 X-1~X-4: 컨트롤러 등록 37 → 40(`@Public()` 8 불변) · G-5 `sealField`/`openField` 허용 파일 +1씩 · 영구삭제 트랜잭션 목 +2(20 → 22) · `jest.isolate-env.js` 발송 루프 끔. `DialogOutputType`·`EgressExitId`·`AuditTargetType` 개수를 단언하는 기존 시험은 없고, L-2/L-4는 전송 부품을 이동 없이 공유해 불변]**
````

### D-7. [업무 자동화 요구사항 `docs/requirements/workflow-automation.md`] FR-WF1-1 — 선택 목록 권한 확정

**찾을 원문**
````text
노드 편집기·구독 화면의 선택 목록은 `dialogue:read`/`chatbot:read`(이름·사용 여부·상태만 — **주소·secretRef 미포함**). |
````
**바꿀 내용**
````text
노드 편집기·구독 화면의 선택 목록은 `dialogue:read`/`chatbot:read`(이름·사용 여부·상태만 — **주소·secretRef 미포함**). **[확정 — `GET /workflow-targets/picker` · `dialogue:read` 단일(OR 가드 없음 · `AGENT` 배제) — 설계서 §12.1 · R-2]** |
````

### D-8. [업무 자동화 요구사항 `docs/requirements/workflow-automation.md`] FR-WF1-8 — 삭제 참조 판정 범위 확정

**찾을 원문**
````text
| FR-WF1-8 | 삭제: 노드 아웃풋(초안·운영/스테이징 버전 포인터가 가리키는 스냅샷 포함 — architect) 또는 구독이 참조하면
````
**바꿀 내용**
````text
| FR-WF1-8 | 삭제: 노드 아웃풋(~~초안·운영/스테이징 버전 포인터가 가리키는 스냅샷 포함 — architect~~ **[확정 — 초안 노드만. 스냅샷 본문 참조 파일 봉인(V-7)·No.26 선례로 스냅샷 참조는 검사하지 않고, 운영 버전이 참조하면 실행 시 `SKIPPED(TARGET_UNAVAILABLE)` + 복원·전환 미리보기 경고 — 설계서 §12.3 · R-8]**) 또는 구독이 참조하면
````

### D-9. [업무 자동화 요구사항 `docs/requirements/workflow-automation.md`] FR-WF2-1 — 바인딩 형태 확정

**찾을 원문**
````text
바인딩 규약은 **No.26 v2 바인딩과 같은 형태**(구조적 바인딩 — 자유 템플릿 없음). |
````
**바꿀 내용**
````text
바인딩 규약은 **No.26 v2 바인딩과 같은 형태**(구조적 바인딩 — 자유 템플릿 없음). **[확정 — 필드 값은 No.26 `ApiBindingSchema` 그대로(`{ kind: 'CONST', value }｜{ kind: 'SLOT', contextVariableId, slotName }` — 위 `source` 표기 대신 `kind`) · 해석 함수 1벌(`resolveBinding`) — 설계서 §4.1 · R-1]** |
````

### D-10. [업무 자동화 요구사항 `docs/requirements/workflow-automation.md`] FR-WF2-8 — 저장 오류 코드 확정

**찾을 원문**
````text
알 수 없는 `targetId`(존재하지 않음)는 저장 시 `400 WORKFLOW_OUTPUT_INVALID`. |
````
**바꿀 내용**
````text
알 수 없는 `targetId`(존재하지 않음)는 저장 시 ~~`400 WORKFLOW_OUTPUT_INVALID`~~ **`404 INVALID_REFERENCE`(No.26/27 선례) · 노드당 4개 이상은 `400 OUTPUT_PAYLOAD_INVALID` — 설계서 §12.4**. |
````

### D-11. [업무 자동화 요구사항 `docs/requirements/workflow-automation.md`] FR-WF3-5 — 연속 미응답 판정 규칙 정정

**찾을 원문**
````text
(`isAnswered=false` · BLOCK·상담·설문·API 고정 문구 턴 제외 — No.24 경고 판정과 같은 제외 규칙)
````
**바꿀 내용**
````text
(`isAnswered=false` · BLOCK·상담·설문 턴 ~~·API 고정 문구 턴~~ 제외 — No.24 경고 판정과 같은 제외 규칙 **[확정 — No.24 `evaluateSessionAlert()` 1벌 재사용: API 고정 문구 턴은 미응답으로 센다(ADR-0036 결정 ⑥) — 모니터링 화면과 웹훅의 연속 수치가 같다 · 세션 최근 30행 · 설계서 §6.4 · R-5]**)
````

### D-12. [업무 자동화 요구사항 `docs/requirements/workflow-automation.md`] FR-WF3-7 — 이벤트 발행 포트 확정

**찾을 원문**
````text
원천 모듈이 발송 모듈 내부를 import하지 않는다(모듈 경계 — architect). |
````
**바꿀 내용**
````text
원천 모듈이 발송 모듈 내부를 import하지 않는다(모듈 경계 — architect). **[확정 — 순수 포트 `common/workflow/workflow-event.port.ts`(토큰 `WORKFLOW_EVENT_SINK` · `emit(): void`) · 원천 4곳(`handoff-thread`·`survey-response`·`message-feedback`·`conversation-log`) `@Optional()` 주입 · 커밋 후 fire-and-forget — 설계서 §6.2]** |
````

### D-13. [업무 자동화 요구사항 `docs/requirements/workflow-automation.md`] FR-WF4-5 — 금지어 비적용 확정

**찾을 원문**
````text
금지어 필터는 봉투 값에 적용하지 않는다(업무 데이터 — No.26 송신과 같은 규약). ⚠ architect 재확인 항목. |
````
**바꿀 내용**
````text
금지어 필터는 봉투 값에 적용하지 않는다(업무 데이터 — No.26 송신과 같은 규약). ~~⚠ architect 재확인 항목.~~ **[확정 — 비적용 · 설계서 §11.4]** |
````

### D-14. [업무 자동화 요구사항 `docs/requirements/workflow-automation.md`] FR-WF4-6 — 본문 암호화 편입 확정

**찾을 원문**
````text
(No.45 `sealField` 대상 목록에 1필드 추가 — architect · C-5). 소거 주체는 발송 모듈 1파일. |
````
**바꿀 내용**
````text
(No.45 `sealField` 대상 목록에 1필드 추가 — architect · C-5). 소거 주체는 발송 모듈 1파일. **[확정 — `EncryptedFieldId` 4번째 `WORKFLOW_PAYLOAD`(봉인 = 적재 writer 1파일 · 개봉 = 발송함 store 1파일) · 백필/재암호화 잡 대상 아님(일시 데이터) · 기동 옛 키 검사 포함 — 설계서 §10.1·§10.2]** |
````

### D-15. [업무 자동화 요구사항 `docs/requirements/workflow-automation.md`] FR-WF5-3 — 대상 동시 상한의 성격 확정

**찾을 원문**
````text
**대상당 동시 `SENDING` ≤2**(DB 계수 — 인스턴스 무관)
````
**바꿀 내용**
````text
**대상당 동시 `SENDING` ≤2**(DB 계수 — ~~인스턴스 무관~~ **[확정 — DB `groupBy` 기준이지만 tick 사이 경합으로 인스턴스 수만큼 초과 가능한 근사 · 엄격화 = 발송 전담 인스턴스 — 설계서 §7.3 · K-3]**)
````

### D-16. [업무 자동화 요구사항 `docs/requirements/workflow-automation.md`] FR-WF6-3 — SSRF 재사용 방식 확정(C-2)

**찾을 원문**
````text
**구현 방식**(① `LegacyTransport` 포트·IP 정책·DNS 해석기를 공용 위치로 옮겨 두 출구가 공유 ② 발송 전용 전송 파일 + 봉인 L-2 갱신)은 architect가 결정하되
````
**바꿀 내용**
````text
**구현 방식**(① `LegacyTransport` 포트·IP 정책·DNS 해석기를 공용 위치로 옮겨 두 출구가 공유 ② 발송 전용 전송 파일 + 봉인 L-2 갱신)은 architect가 결정하되 **[확정 — ③ 이동 없이 두 번째 DI 토큰으로 공유(`NodeHttpTransport`·`NodeDnsResolver`·`ip-policy.ts`) + 전송 요청 선택 필드 `exitId`·`responseMode`(기본값 = 현행) — L-2·L-4 불변 · 사설 대역 목록은 별도 `WORKFLOW_PRIVATE_ALLOWLIST` — 설계서 §9.4 · R-7]**
````

### D-17. [업무 자동화 요구사항 `docs/requirements/workflow-automation.md`] FR-WF6-4 — 브랜드 요청 분리 확정

**찾을 원문**
````text
브랜드 요청 타입을 출구별로 분리한다(architect). |
````
**바꿀 내용**
````text
브랜드 요청 타입을 출구별로 분리한다(architect). **[확정 — 발송기는 `LegacyApiHttpClient`·`ValidatedLegacyRequest`·레거시 시크릿 리졸버를 쓰지 않고 자기 검증(주소·출구·DNS·주소 판정)을 거친 전송 요청만 만든다 · `workflow/**`의 `legacy-api/` import = 전송 포트·전송·DNS·IP 정책 4파일만(W-12)]** |
````

### D-18. [업무 자동화 요구사항 `docs/requirements/workflow-automation.md`] FR-WF7-1 — 챗봇 이력 권한 확정

**찾을 원문**
````text
(`GET /workflow-runs` — 전역 `security:read` / 챗봇 스코프 `GET /chatbots/:id/workflow-runs` `chatbot:read`)
````
**바꿀 내용**
````text
(`GET /workflow-runs` — 전역 `security:read` / 챗봇 스코프 `GET /chatbots/:id/workflow-runs` `chatbot:read` **[확정 — `chatbot:read` AND `dialogue:read`(AGENT 배제) · R-9]**)
````

### D-19. [업무 자동화 요구사항 `docs/requirements/workflow-automation.md`] FR-WF7-5 — P-9 확정

**찾을 원문**
````text
⚠ P-9 — "정지 중 요청은 버린다(`SKIPPED(PAUSED)`)" 대안 있음. |
````
**바꿀 내용**
````text
~~⚠ P-9 — "정지 중 요청은 버린다(`SKIPPED(PAUSED)`)" 대안 있음.~~ **[P-9 확정(2026-09-26, 추천안) — 보류 후 재개 시 발송 · 24시간 초과 만료 · 대상/구독 보류 사유 구분 — 설계서 §7.6]** |
````

### D-20. [업무 자동화 요구사항 `docs/requirements/workflow-automation.md`] FR-WF8-1 — AGENT 배제 방식 확정

**찾을 원문**
````text
챗봇 이력·요약 = `chatbot:read`. AGENT는 접근 없음. |
````
**바꿀 내용**
````text
챗봇 이력·요약 = `chatbot:read`. AGENT는 접근 없음. **[확정 — AGENT가 `chatbot:read`를 가지므로(역할 매핑) 챗봇 스코프 조회는 `chatbot:read` AND `dialogue:read`, 선택 목록은 `dialogue:read` — 신규 권한 0 · 설계서 §14]** |
````

### D-21. [업무 자동화 요구사항 `docs/requirements/workflow-automation.md`] FR-WF9-1 — 업캐스터 판정

**찾을 원문**
````text
업캐스터 불필요 여부는 architect). |
````
**바꿀 내용**
````text
업캐스터 불필요 여부는 architect). **[확정 — 업캐스터 불필요 · 스키마 버전 1 유지]** |
````

### D-22. [업무 자동화 요구사항 `docs/requirements/workflow-automation.md`] FR-WF9-4 — `servedVersionId` 기록 확정

**찾을 원문**
````text
이력에 `servedVersionId`를 남길지는 architect(권고: 남김 — 어느 버전 노드가 보냈는지 추적). |
````
**바꿀 내용**
````text
이력에 `servedVersionId`를 남길지는 architect(권고: 남김 — 어느 버전 노드가 보냈는지 추적). **[확정 — 남긴다]** |
````

### D-23. [업무 자동화 요구사항 `docs/requirements/workflow-automation.md`] §5.2 `WorkflowRun` 행 — 유일 키 형태 확정

**찾을 원문**
````text
부분 유일(sourceKey — 마이그레이션 전용 인덱스 규약) |
````
**바꿀 내용**
````text
~~부분 유일(sourceKey — 마이그레이션 전용 인덱스 규약)~~ **[확정 — nullable `@unique dedupeKey`(NULL 다중 허용 — 원시 부분 유니크 4종 개수 불변) · 설계서 §3.1]** |
````

### D-24. [업무 자동화 요구사항 `docs/requirements/workflow-automation.md`] §5.2 `WorkflowAttempt` 행 — 미도입 확정

**찾을 원문**
````text
— architect(1차는 `WorkflowRun`의 "마지막 시도"만으로 충분할 수 있음) |
````
**바꿀 내용**
````text
— architect(1차는 `WorkflowRun`의 "마지막 시도"만으로 충분할 수 있음) **[확정 — 미도입]** |
````

### D-25. [업무 자동화 요구사항 `docs/requirements/workflow-automation.md`] §5.5 API 표 주석 — 최종 경로 확정

**찾을 원문**
````text
(동작 경로 `POST …/pause` 형식은 No.45 `…/pending/cancel` 관례 — 최종 경로는 architect.)
````
**바꿀 내용**
````text
(동작 경로 `POST …/pause` 형식은 No.45 `…/pending/cancel` 관례 — 최종 경로는 architect.) **[확정 — 위 경로 그대로 · 선택 목록만 `GET /workflow-targets/options` → `/picker`(No.26 선례) · 총 21 핸들러 — 설계서 §12.1]**
````

### D-26. [업무 자동화 요구사항 `docs/requirements/workflow-automation.md`] §5.6 `WORKFLOW_PRIVATE_ALLOWLIST` — 별도 목록 확정

**찾을 원문**
````text
| 사설 대역 허용(또는 레거시 목록 공용 — architect) |
````
**바꿀 내용**
````text
| 사설 대역 허용(~~또는 레거시 목록 공용 — architect~~ **[확정 — 별도 목록 · 최소 권한]**) |
````

### D-27. [업무 자동화 요구사항 `docs/requirements/workflow-automation.md`] §11 architect 확정 사항 문단 — 완료 표식

**찾을 원문**
````text
> **architect 확정 사항**(권고안 제시):
````
**바꿀 내용**
````text
> **architect 확정 사항**(권고안 제시) **[2026-09-26 전부 확정 — 설계서 §1 "(architect)" 행 · §24 R-1~R-16]**:
````

### D-28. [업무 자동화 요구사항 `docs/requirements/workflow-automation.md`] §12 인계 — system-architect 행 완료 표식

**찾을 원문**
````text
| **`system-architect`** | ① **ADR-0041** 작성
````
**바꿀 내용**
````text
| **`system-architect`** | **✅ 완료(2026-09-26 — `docs/02-spec/workflow-automation-설계.md` · ADR-0041 · `docs/02-spec/workflow-automation-patches.md`)** ① **ADR-0041** 작성
````

---

## E. 선행 요구사항 문서 — No.41 인계 정정

### E-1. [레거시 API 요구사항 `docs/requirements/legacy-api-integration.md`] 경계 표(436행) — No.41 결과

**찾을 원문**
````text
이 그룹은 **동기 조회/단발 POST**만 |
````
**바꿀 내용**
````text
이 그룹은 **동기 조회/단발 POST**만 **[2026-09-26 No.41 설계 완료] 후속 액션 = No.41 비동기 발송(서명 웹훅 · 재시도 · 멱등키 · 실행 이력) · 결과 콜백은 No.41 2차 — `workflow-automation-설계.md` · ADR-0041** |
````

### E-2. [레거시 API 요구사항 `docs/requirements/legacy-api-integration.md`] 범위 밖(701행) — 쓰기형 연동 이행

**찾을 원문**
````text
| 쓰기형 연동 요구 → No.41 |
````
**바꿀 내용**
````text
| 쓰기형 연동 요구 → No.41 **[2026-09-26 No.41 설계 완료] 재시도·멱등키·재시도 큐 = No.41 발송함(POST 고정) · PUT/PATCH/DELETE·비동기 콜백은 여전히 범위 밖(No.41 2차) — ADR-0041** |
````

### E-3. [보안/이력 요구사항 `docs/requirements/security-audit.md`] 범위 밖(721행) — 위험 동작 알림 위치

**찾을 원문**
````text
| 알림 채널(메일/Slack)이 없다 | No.41(워크플로우 자동화) |
````
**바꿀 내용**
````text
| 알림 채널(메일/Slack)이 없다 | No.41(워크플로우 자동화) **[2026-09-26 No.41 설계 완료] 1차는 대화 이벤트만 — 위험 동작 실시간 알림(운영 이벤트)은 No.41 2차(같은 발송 엔진에 이벤트 추가) · ADR-0041** |
````

### E-4. [예약 배포 요구사항 `docs/requirements/scheduled-deploy.md`] 범위 밖(698행) — 외부 알림 위치

**찾을 원문**
````text
| No.41(워크플로우 커넥터) 또는 No.45 |
````
**바꿀 내용**
````text
| No.41(워크플로우 커넥터) 또는 No.45 **[2026-09-26 No.41 설계 완료] 예약 실행 결과 알림은 No.41 2차(운영 이벤트) — 외부 출구는 No.45 레지스트리 6번째 클래스로 이미 봉인됨 · ADR-0041** |
````

### E-5. [하이브리드 CS 요구사항 `docs/requirements/hybrid-cs.md`] 범위 밖(787행) — 알림 결과

**찾을 원문**
````text
| 알림 인프라 없음 | No.41 |
````
**바꿀 내용**
````text
| 알림 인프라 없음 | No.41 **[2026-09-26 No.41 설계 완료] 상담 시작·종료·연속 미응답 N회 → 이벤트 구독으로 메신저·업무 도구에 웹훅 알림(본문 없이 `sessionRef`·수치만) · 소리·데스크톱 알림은 콘솔 UI 영역이라 범위 밖 · ADR-0041** |
````

### E-6. [설문관리 요구사항 `docs/requirements/survey-management.md`] 범위 밖(825행) — 설문 알림 결과

**찾을 원문**
````text
| 응답 수 도달 알림·정기 리포트 | 알림 인프라 없음 | No.41/45 |
````
**바꿀 내용**
````text
| 응답 수 도달 알림·정기 리포트 | 알림 인프라 없음 | No.41/45 **[2026-09-26 No.41 설계 완료] 응답 1건 단위 `SURVEY_COMPLETED` 이벤트는 1차(선택·척도 답 선택 포함) · 임계 도달·정기 리포트는 No.41 2차 · ADR-0041** |
````

---

## F. 운영 문서

### F-1. [자동배포 `docs/05-ops/자동배포.md`] §5.4 신설 — 업무 자동화(No.41) 운영 요구

**찾을 원문**
````text
적용 후 부분 유니크 4종 존재 · 신규 테이블 5 · `PRAGMA foreign_key_check` 0행 · 데이터 지도에서 모드·출구 판정·체인 머리 확인.
````
**바꿀 내용**
````text
적용 후 부분 유니크 4종 존재 · 신규 테이블 5 · `PRAGMA foreign_key_check` 0행 · 데이터 지도에서 모드·출구 판정·체인 머리 확인.

### 5.4 업무 자동화(No.41) 운영 요구 (2026-09-26 추가)

`workflow-automation-설계.md` · ADR-0041. 발송 대상을 1개 이상 등록하는 설치의 **운영 책임**이다.

1. **비밀 설정**: 대상의 `secretRef`·`signingSecretRef`·`urlSecretRef`마다 `WORKFLOW_SECRET__<REF>=<값>`을 서버 환경변수로 넣고 재기동한다(서명 비밀은 32자 이상 — 예: `openssl rand -hex 32`). 값은 로그·티켓·채팅에 붙이지 않는다. 비밀 교체는 받는 쪽이 새·옛 비밀을 함께 검증하도록 먼저 조정한 뒤 환경변수를 바꾼다(이중 서명 없음).
2. **도달성**: 구축형에서 사내 결재·ITSM·메신저가 사설 대역이면 `WORKFLOW_PRIVATE_ALLOWLIST`에 그 주소·호스트를 명시한다(레거시 목록과 별도 · 루프백·링크로컬·메타데이터 대역은 열 수 없다 — 같은 서버의 수신기는 사내 주소로 노출). 폐쇄망에서 클라우드 도구로 보내려면 외부 출구 또는 사내 중계 서버를 대상으로 둔다. 구독형은 고객 사내망 도구에 고정 송신 IP·방화벽 개방이 필요하다.
3. **거버넌스 모드 설치**: 대상 호스트를 `DATA_EGRESS_ALLOWED_HOSTS`에 먼저 등록해야 대상 저장이 된다(목록 밖 = 저장 400 · 발송 차단).
4. **발송 전담 인스턴스(선택)**: 다중 인스턴스에서 대상 한도를 엄격히 지키려면 1개 인스턴스만 `WORKFLOW_DISPATCH_ENABLED=true`로 둔다. 모든 인스턴스가 `false`면 적재만 되고 발송되지 않는다(콘솔 "발송 지연" 경고).
5. **받는 쪽 연동 확인**: 대상 등록 후 콘솔 "테스트 발송"으로 서명 검증·응답 코드(실패는 4xx/5xx로 응답)를 확인한다. 받는 쪽은 `X-Chatbot-Delivery`로 중복을 제거해야 한다(최소 1회 전달 — 재시도·재발송이 같은 값을 보낸다). 연동 가이드: `docs/05-ops/업무자동화_연동가이드.md`(deployment-engineer 작성 예정).
6. **배포 후 확인**: 마이그레이션 `20260926180000_workflow_automation` 적용 뒤 원시 부분 유니크 인덱스 개수가 4 그대로인지 · 신규 테이블 3 · 외래 키 점검 0행 · 콘솔 업무 자동화 화면·데이터 지도 "업무 자동화 웹훅" 행 확인.
````

---

## Z. 적용 후 확인 체크리스트

- [ ] A-1~A-34 · B-1~B-9 · C-1~C-8 · D-1~D-28 · E-1~E-6 · F-1 각 "찾을 원문"이 적용 전 대상 파일에서 **정확히 1회** 검색되는지(0회 = 파일이 그 사이 바뀜 → 이 문서를 갱신 후 적용). 특히 D-4의 `## 11. PM 확인이 필요한 항목`이 요구사항 문서 756행 1곳뿐인지, A-31(결정 36 꼬리)과 A-32(결정 41 꼬리)의 괄호 목록이 서로 다른지, A-34의 `AC-DG1~DG8 |`가 ADR-0040 인덱스 행 1곳뿐인지 확인한다.
- [ ] 개발명세서 §2 표(A-1 — 2열)·§2.2 표(A-4 — 3열)·§3 표(A-6·A-7 — 3열)·§4 표(A-13 — 3열)·§4.1 표(A-15~A-17 — 2열 셀 안 append)·§5.1 표(A-25 — 5열)·§7 표(A-33·A-34 — 3열)의 행이 열 개수를 유지하는지.
- [ ] 개발명세서 §3 엔터티 표에 `WorkflowTarget`·`WorkflowSubscription`·`WorkflowRun` 행이 `GovernanceJobState` 행 바로 뒤에 순서대로 있는지 · §3 "미도입 결정 18건" 머리와 ⑱ 항목이 함께 있는지 · §6에 결정 42가 41 바로 뒤에 있는지 · §6 결정 18·21·32·35·36·41 아래 "갱신(2026-09-26 — No.41)" 각주가 각 1개인지 · §7 인덱스에 설계서·ADR-0041 행이 각 1개인지.
- [ ] `docs/01-requirements/기능요구사항.md` No.41 행(8열)·No.24·26·27·28·44·45 행의 열 개수가 표 머리와 같은지 · §4-1 사용자 확인 결과 인용 블록 끝에 "No.41 … 범위·방식까지 확정" 문장이 1개인지(C-2).
- [ ] `docs/requirements/workflow-automation.md` 머리 도입 상태(D-1)·다음 단계(D-2)·§1.11 머리(D-3)·§11 머리의 **P-1~P-12 "확정(2026-09-26, 추천안)" 표기(D-4)**가 있는지 · FR 표(FR-0-179·180, FR-WF1-1·WF1-8·WF2-1·WF2-8·WF3-5·WF3-7·WF4-5·WF4-6·WF5-3·WF6-3·WF6-4·WF7-1·WF7-5·WF8-1·WF9-1·WF9-4)·§5.2·§5.5·§5.6 표·§11 architect 문단·§12 표의 셀 구조가 깨지지 않는지 · 취소선이 셀 구조를 깨지 않는지.
- [ ] ADR-0002·0008·0013·0016·0031·0034·0035·0039·0040 끝에 "갱신 (2026-09-26 — No.41 …)" 절이 각 1개인지. ADR-0034는 기존 No.45 갱신 절 다음, ADR-0035·0039·0040은 재검토 트리거 목록 다음에 붙는 것이 정상이다.
- [ ] `docs/05-ops/자동배포.md` §5.4가 §5.3 다음, 파일 끝 "⚠ §4의 헬스체크 기준" 주석 앞에 있는지.
- [ ] `CLAUDE.md`의 "구현 완료 기능"·"다음 단계"·"보완 8종 … 사용자 확인 대기 중" 문구는 **이 패치의 범위가 아니다** — 에이전트는 `CLAUDE.md`를 수정하지 않으며, 반영 여부는 사용자가 직접 결정한다.
- [ ] `docs/03-design/UIUX_준수기준.md`의 "사용자에게 보이지 않는 아웃풋 표기 규칙 · 실행 상태 텍스트 라벨" 보강과 업무 자동화 화면 정보구조(설정 메뉴 위치·탭 구성·노드 편집기 아웃풋 편집기)는 **ui-designer 단계**에서 한다(개발명세서 §5 접근성 문단에 원칙을 먼저 기록했다 — A-21). 산출물 `docs/03-design/workflow-automation-ui-spec.md`.
- [ ] `docs/04-test/시험항목.md`에 TC-41(AC-WF1~WF7)을 추가하고, 전송 목·DNS 목 픽스처 · 시각 주입(상대 시각) 재시도 절차 · 2인스턴스 선점 시험(동적 import 앱 2개) · 가짜 비밀 전수 grep 절차를 `시험데이터.md`·`자동시험_전략.md`에 추가하는 일은 **test-automation 단계**에서 한다.
- [ ] 연동 가이드 `docs/05-ops/업무자동화_연동가이드.md`(봉투 v1·서명 검증 예시·중복 제거·재시도 표·비밀 주소·폐쇄망 중계)는 **deployment-engineer 단계**에서 작성한다(설계서 §8.5).
- [ ] 코드 쪽 기대값 변경(설계서 §21.3 X-1~X-4)은 **구현 단계에서** 반영한다. 그 밖의 기존 시험이 깨지면 회귀로 취급한다(커밋 ①·②에서 깨지면 멈추고 보고).
- [ ] 코드 쪽 주석(`egress-registry.ts` 머리 "출구 5클래스" · `governance-sealing.spec.ts` G-1 제목 "6파일" · `legacy-transport.port.ts` 머리 "구현은 … 뿐이다"(공유 소비자 병기) · `node-http.transport.ts` 머리 주석 · `public-decorator-count.spec.ts` 머리 주석(37 → 40) · `chatbots.service.spec.ts` 머리 주석(동반 삭제 테이블 수) · `schema.prisma` `DialogNode.outputs` 주석 "12종" · 개발명세서 §2.1 "총 4곳" 계열 문구)은 **구현 단계에서** No.41 내용으로 갱신한다.
