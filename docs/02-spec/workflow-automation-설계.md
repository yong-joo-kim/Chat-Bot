# 업무 자동화 워크플로우 커넥터 세부 설계서 (No.41)

> **요구사항**: `docs/requirements/workflow-automation.md`(T-1~T-7, J-1~J-22, FR-0-172~182, FR-WF1-\*~FR-WF10-\*, NFR-WFP/WFR/WFS/WFA/WFM, AC-WF1~WF7, EX-WF-1~26, 제약 C-1~C-8, P-1~P-12)
> **상위 문서**: `docs/02-spec/개발명세서.md` §2·§2.1·§2.2·§3·§3.1·§4·§4.1·§5·§5.1·§6(**결정 42 신설**)·§7
> **신규 ADR**: **ADR-0041**(업무 자동화 = 비종결 엔진 이벤트 방출 · 커밋 후 이벤트 포트 · DB 발송함(행 선점 · 최소 1회 + 멱등키) · 서명 웹훅 · 출구 6번째 클래스 · SSRF 부품 이동 없는 공유)
> **갱신 ADR(각주만)**: ADR-0002(동반 삭제 +2) · ADR-0008(엔진 세 번째 의도된 확장 — 비종결 방출) · ADR-0013(적용 지점 5번째) · ADR-0016(대상 +3 · 발송 1건 비감사) · ADR-0031(`WORKFLOW` 스냅샷 포함 · 대상 스냅샷 밖) · ADR-0034(재검토 트리거 "쓰기형 후속 액션" 이행 · 전송 부품 공유 · 선택 필드 2) · ADR-0035(엔진 이벤트 방출 두 번째 사례) · ADR-0039(구독 = 환경 밖 · 전환 경고 2종) · ADR-0040(출구 6클래스 · 암호화 대상 4번째 · `CALL_LOGS` 편입)
> **작성일**: 2026-09-26 · **GPU**: **1**(카탈로그 2 → 하향, P-12 — JSON 조립·HMAC-SHA256·HTTP 송신·DB 발송함 읽기/쓰기뿐 · 모델·학습·추론·임베딩 0 · ml-worker 변경 0) — §25
> **기존 파일 수정 목록**: 문서는 `docs/02-spec/workflow-automation-patches.md`, 코드는 이 문서 §2.5.

---

## 0. 이 문서가 푸는 문제 (한 문단 요약)

카탈로그 No.41은 "대화 중 트리거된 이벤트를 사내 업무 자동화 도구(Power Automate류)와 연결해 승인·티켓 생성 등 후속 처리를 자동 실행"이다. 이 설계는 **대화 응답을 기다리게 하지 않고, 쓰지 않는 설치의 동작을 바이트 단위로 바꾸지 않으면서** 다음을 만든다. ① **발송 대상 레지스트리**(전역 · ADMIN · 비밀은 `WORKFLOW_SECRET__<REF>` 환경변수 참조) ② **명시 트리거** — 대화그래프 아웃풋 `WORKFLOW`("업무 요청 보내기" — 폼 슬롯·상수 바인딩, 사용자에게 보이지 않음). 엔진은 **정지하지 않고** 결과 선택 필드 `workflowEvents?`에 "보낼 것"만 싣는다(`surveyEvents` 선례) ③ **암묵 트리거** — 챗봇별 이벤트 구독 5종(상담 시작·종료·설문 완료·부정 평가·연속 미응답 N회) — 원천 서비스가 **커밋 후** 순수 포트로 발행 ④ **DB 발송함**(`WorkflowRun` = 발송함 겸 실행 이력) + `PollingLoop` + 행 선점 CAS · 최소 1회 + 멱등키 · 지수 백오프 · 실패 보관 · 보류/만료 ⑤ **서명 웹훅**(HMAC-SHA256 `t=,v1=` · `X-Chatbot-Delivery`) ⑥ **No.45 출구 게이트 6번째 클래스**(`WORKFLOW_WEBHOOK`) + **No.26 SSRF 부품을 이동 없이 공유** ⑦ 실행 이력·재발송·취소·일시 정지·테스트 발송·요약 통계.

> 이 설계가 코드에서 **추가로 찾은 제약 9건**:
> **① `NodeHttpTransport`는 응답 본문이 `maxBytes`를 넘으면 상태 코드를 버리고 `RESPONSE_TOO_LARGE`로 끝난다**(`legacy-api/transport/node-http.transport.ts` 85~99행) — 받는 쪽이 큰 본문과 함께 200을 주면 성공이 실패가 된다 → 전송 요청에 선택 필드 `responseMode: 'STATUS_ONLY'`(§9.4) ·
> **② 전송 파일의 방어 이중화 가드가 `checkEgress('LEGACY_API', …)`로 출구 id를 고정**한다(25행) — 공유하면 차단 판정 문맥이 틀어진다 → 선택 필드 `exitId`(기본 `LEGACY_API`) ·
> **③ 역할 `AGENT`가 `chatbot:read`를 가진다**(`shared-types/src/security.ts` 72행) — 요구사항 FR-WF8-1 "AGENT 접근 없음"을 `chatbot:read` 단독 가드로는 지킬 수 없다 → 챗봇 스코프 조회 = `chatbot:read` AND `dialogue:read`(§14) ·
> **④ `resumeAfterApiCall`의 분기 노드 실행은 `completedForm`을 넘기지 않는다**(`dialogue-engine/src/api-call.ts` 230~239행) — API 분기 뒤 노드의 `WORKFLOW` `SLOT` 바인딩은 항상 누락된다 → 재진입 상태에 폼 값 이월(단, `WORKFLOW` 있는 번들만 — §5.6) ·
> **⑤ 요구사항 FR-WF3-5의 "API 고정 문구 턴 제외"는 No.24 경고 판정과 모순**이다 — `evaluateSessionAlert()`(`handoff/lib/session-alert.ts` 38~41행)는 API 고정 문구 턴을 **미응답으로 센다**(ADR-0036 결정 ⑥) → 같은 함수를 재사용해 모니터링 화면과 웹훅 숫자를 일치시킨다(§6.4 · R-5) ·
> **⑥ 노드 출력이 `WORKFLOW`뿐이면 `executeOutputs`의 0건 보장**(`outputs.ts` 264~275행)이 기본 폴백 문구를 붙이고 `EMPTY_OUTPUT` trace로 그 턴이 미응답이 된다 → 엔진은 그대로 두고 설계 점검 `WORKFLOW_ONLY_OUTPUT`(WARNING) ·
> **⑦ No.26/27 선례상 없는 참조는 `404 INVALID_REFERENCE`, 아웃풋 형식 위반은 `400 OUTPUT_PAYLOAD_INVALID`** — 요구사항 제안 `WORKFLOW_OUTPUT_INVALID`는 기존 코드로 흡수(신규 오류 코드 3 → 2) ·
> **⑧ 설문 `COMPLETED` 적재는 가드 읽기 후 `update`(CAS 아님)**(`survey-response.service.ts` 150~177행) — 같은 응답의 동시 완료가 이론상 2회 발행될 수 있다 → 발송함 유일 키(응답 id)가 흡수 ·
> **⑨ 대상 삭제 409를 운영/스테이징 스냅샷 참조까지 넓히면 스냅샷 본문 테이블 참조 파일 봉인(V-7 — `version-sealing.spec.ts` 229행)을 깬다** → No.26 선례대로 초안 노드 + 구독만 검사하고, 운영 버전 참조는 경고·실행 시 건너뜀(§12.3 · R-8).

---

## 1. PM 확정 사항 (2026-09-26 — P-1~P-12 전부 추천안)

| # | 확정 내용 | 이 문서에서의 반영 |
|---|---|---|
| **P-1 (c)** | 트리거 = 대화그래프 "업무 요청 보내기" 노드(폼 값 전송) **+** 이벤트 구독(닫힌 목록 5종) | §5 · §6 |
| **P-2 (a)** | 엔진에 새 출력 종류 — `surveyEvents` 방식(엔진은 "보낼 것"만 결과에) · 기존 엔진 시험 무수정 통과 · 재조립 경로(`resumeAfterApiCall` 등)에서 필드 소실 금지(FR-WF2-4 · AC-WF2-6) | §5 |
| **P-3 (a)** | 범용 아웃바운드 웹훅 1종 · HMAC 서명 · 재시도 · 멱등키 · "비밀 주소" 옵션 | §7 · §8 |
| **P-4 (a)** | 비동기 발송만 · 대화는 결과를 기다리지 않음 · 결과는 콘솔 이력 · `@Public()` 8 유지 | §6.1 · §13 · §17 W-10 |
| P-5 | 이벤트 5종: 상담 시작·종료 · 설문 완료 · 부정 평가 · 연속 미응답 N회 | §6.2 |
| P-6 | 페이로드 = 메타데이터 + `sessionRef` + 마스킹된 폼 값 · 대상별 원문 허용(ADMIN 확인 문구 + 감사) · 대화 본문 0 · 재시도 본문은 성공 즉시·실패 7일 뒤 소거 | §8.1 · §10 · §11 |
| P-7 | 비밀 = `WORKFLOW_SECRET__<REF>` · DB 값 0 | §8.4 · §17 W-1 |
| P-8 | 신규 권한 0 — 대상 `security:write` · 구독·재발송 `chatbot:write` · 노드 `dialogue:write` | §14 |
| P-9 | 일시 정지 중 보류 → 재개 시 발송 · 24시간 초과 만료 | §7.6 |
| P-10 | 노드 = 스냅샷 자동 포함 · 대상·구독 = 저장 즉시 운영 반영(환경 밖) | §16 |
| P-11 | 2차 = 콜백·대화 표시·프리셋·메일·운영 이벤트·대화 종료·발췌 첨부 | §26 |
| P-12 | GPU 1(하향) · 구축형 ○ · 구독형 ○ | §25 |
| (architect) | 바인딩 형태 = No.26 `ApiBindingSchema`(`kind: CONST｜SLOT`) **그대로 재사용**(요구사항 초안의 `source` 키 대신 — 해석 함수 1벌) | §4.1 · R-1 |
| (architect) | 이벤트 발행 포트 = `common/workflow/workflow-event.port.ts`(순수 · 토큰 + 유니온) · 원천 4곳 `@Optional()` 주입 · **커밋 후 fire-and-forget** | §6.2 |
| (architect) | 모듈 3분할: `workflow/catalog`(읽기 전용) · `workflow/triggers`(적재·포트 구현) · `workflow`(관리·발송 — export 0) | §2.1 |
| (architect) | SSRF 재사용 = No.26 전송·DNS·IP 정책 부품을 **이동 없이 두 번째 DI 토큰으로 등록** + 전송 요청 선택 필드 2개 · 사설 허용 목록은 **별도** `WORKFLOW_PRIVATE_ALLOWLIST` | §9.4 · C-2 해소 |
| (architect) | `WorkflowAttempt` 미도입(마지막 시도 필드) · 부분 유일 인덱스 대신 nullable `@unique dedupeKey` | §3.1 |
| (architect) | 발송함 본문 = `EncryptedFieldId` 4번째 `WORKFLOW_PAYLOAD`(봉인 1파일·개봉 1파일) · 백필/재암호화 잡 제외 · 기동 키 검사 포함 | §10.1 |
| (architect) | 대상 삭제 409 = 초안 노드 + 구독(스냅샷 참조 비차단 — V-7) | §12.3 |
| (architect) | `servedVersionId` 기록 · 스냅샷 업캐스터 불필요 · 금지어 필터 봉투 비적용 확정 | §16 · §11 |
| (architect) | 신규 `ApiErrorCode` 2종(`WORKFLOW_TARGET_IN_USE`·`WORKFLOW_RUN_NOT_RETRYABLE`) | §12.4 |
| (architect) | 기대값 변경 닫힌 목록 X-1~X-5 | §21.3 |

---

## 2. 아키텍처 배치

### 2.1 모듈 구조

기존 4계층 규약(개발명세서 §2.1)을 따른다. NestJS 모듈 **3개**를 신설하고 원천 서비스가 참조하는 포트는 **Nest 모듈이 아닌 순수 파일** 1개로 둔다.

```
apps/api/src/
├── common/workflow/
│   └── workflow-event.port.ts              # [신규·순수] WORKFLOW_EVENT_SINK 토큰 · WorkflowSourceEvent 유니온 · WorkflowEventSink { emit(e): void }
├── workflow/
│   ├── catalog/                            # ── 읽기 전용(출구 없음) ──
│   │   ├── workflow-catalog.module.ts      # [신규] exports [WorkflowCatalogService]
│   │   ├── workflow-catalog.service.ts     # [신규] picker · 적재용 대상 조회 · 설계 점검/시뮬레이터 정보 · 구독 캐시(get/invalidate)
│   │   └── lib/subscription-cache.ts       # [신규·순수] 전 챗봇 구독 스냅샷 TTL 캐시(주입 시계)
│   ├── secrets/
│   │   └── workflow-secret.resolver.ts     # [신규] ★ `WORKFLOW_SECRET__` 읽기 유일 파일 — get(ref) · status(ref) · isWeak(ref)
│   ├── triggers/                           # ── 적재(쓰기: create만) ──
│   │   ├── workflow-triggers.module.ts     # [신규] exports [WorkflowTriggerService, WORKFLOW_EVENT_SINK(useExisting)]
│   │   ├── workflow-trigger.service.ts     # [신규] enqueueNodeEmissions() · emit()(포트 구현) · recordTestRun() · drainForTest()
│   │   ├── workflow-run-enqueue.writer.ts  # [신규] ★ workflowRun.create 유일 파일 · ★ sealField('WORKFLOW_PAYLOAD') 유일 파일(미export)
│   │   └── lib/{envelope.ts, event-data.ts, field-values.ts, dedupe-key.ts, session-limit.ts, streak.ts}   # 순수
│   ├── core/
│   │   └── workflow-run.store.ts           # [신규] ★ workflowRun.update*·workflowTarget 카운터 쓰기 유일 파일 · ★ openField('WORKFLOW_PAYLOAD') 유일 파일
│   ├── dispatch/
│   │   ├── workflow-dispatch.job.ts        # [신규] PollingLoop 소비자 · tick() public · onModuleInit/onModuleDestroy
│   │   ├── workflow-http.sender.ts         # [신규] ★ 출구 파일(레지스트리 등록) — checkEgress → DNS 1회 → 주소 판정 → transport.request
│   │   └── lib/{classify-result.ts, backoff.ts, retry-after.ts, signature.ts, headers.ts, claim-plan.ts}   # 순수
│   ├── targets/
│   │   ├── workflow-targets.controller.ts  # [신규] /workflow-targets* 9 핸들러
│   │   ├── workflow-targets.service.ts     # [신규] ★ workflowTarget CRUD·정지/재개 쓰기(카운터 제외) · 저장 시 출구 검사 · 원문 허용 확인
│   │   ├── workflow-test-send.service.ts   # [신규] 테스트 발송(동기 1회 · 재시도 없음 · 본문 비보관)
│   │   └── workflow-target.mapper.ts
│   ├── chatbot-workflow.controller.ts      # [신규] /chatbots/:chatbotId/workflow-* 10 핸들러
│   ├── subscriptions/workflow-subscriptions.service.ts   # [신규] ★ workflowSubscription 쓰기(영구삭제 제외) · 캐시 무효화
│   ├── runs/
│   │   ├── workflow-runs.controller.ts     # [신규] /workflow-runs · /workflow-runs/summary (전역)
│   │   ├── workflow-runs-query.service.ts  # [신규] 이력 조회(본문 미조회 — select 허용 목록)
│   │   ├── workflow-run-ops.service.ts     # [신규] 재발송·취소(store 위임) · 감사
│   │   └── workflow-summary.service.ts     # [신규] 7/30일 요약 · 경고(attention)
│   ├── workflow.module.ts                  # [신규] controllers 3 · providers · exports 0
│   └── lib/workflow-sealing.spec.ts        # §17 W-1~W-18
├── legacy-api/transport/{legacy-transport.port.ts, node-http.transport.ts}   # [수정] 선택 필드 exitId·responseMode(기본값 = 현행)
├── common/egress/egress-registry.ts        # [수정] 6번째 클래스 WORKFLOW_WEBHOOK
├── common/crypto/encrypted-fields.ts       # [수정] WORKFLOW_PAYLOAD
└── (원천·소비자 수정은 §2.5)
```

### 2.2 모듈 의존 방향

```
workflow            → workflow/catalog · workflow/triggers · audit-logs · chatbots(ChatbotScopeService) · dialogue-common(ReferenceCheckService) · prisma · config · common/{egress,crypto,polling,rate-limit}
                      + legacy-api/transport/{legacy-transport.port, node-http.transport, node-dns.resolver} · legacy-api/lib/ip-policy (파일 import — LegacyApiModule import 0)
workflow/triggers   → workflow/catalog · prisma · config · common/{workflow,crypto} · handoff/lib/{session-ref, session-alert}(순수 파일)
workflow/catalog    → prisma · config                                               (도메인 모듈 import 0)
conversation｜handoff｜survey-responses｜feedback → workflow/triggers(모듈) — 코드 참조는 common/workflow/workflow-event.port 토큰만(conversation 공개 서비스는 WorkflowTriggerService 1개)
dialog-nodes｜simulation → workflow/catalog(읽기 전용 1개)
versions｜environment/core｜governance → Prisma 읽기만(workflow/** import 0)
validation｜deploy-schedules｜stats｜learning｜topics｜asset-transfer → workflow/** import 0
```

- **`WorkflowModule`의 export는 0개**다. 발송기·전송·비밀 리졸버·발송함 store는 모듈 밖에서 주입할 수 없다. 원천 모듈의 DI 그래프에는 **적재(create)** 경로만 있고 발송·상태 전이 경로가 없다.
- **순환 없음**: `workflow/triggers`·`workflow/catalog`는 어떤 도메인 모듈도 import하지 않는다(Prisma·Config는 전역). 연속 미응답 판정·`sessionRef`는 `handoff/lib`의 **순수 함수 파일**을 import한다(No.24 판정 1벌 재사용 — `HandoffModule` import 0).
- `WorkflowModule`은 `AppModule` imports **끝**(`GovernanceModule` 뒤)에 둔다 — 발송 루프 `onModuleInit`이 Prisma 연결·거버넌스 런타임 설치 뒤에 시작한다.

### 2.3 공개 대화 파이프라인 위치

```
①  access.resolve → ②.5 입구 금지어(BLOCK = 조기 반환) → ②.7 상담 게이트(HANDLED = 조기 반환) → 서빙 버전(실패 = 조기 반환)
③④ 의미 점수 → resolveTurn(엔진: WORKFLOW → result.workflowEvents?)
④.5 legacyApi.completeTurn(재진입 — workflowEvents 이월·합산)
④.6 surveyResponses.apply
④.7 [신규 No.41] workflowEvents가 있으면 await workflowTriggers.enqueueNodeEmissions()   ← 없으면 분기 1개 · 추가 조회 0
⑤.5 출구 금지어 필터 → ⑦ RAG 분기 → ⑨ 응답 → ⑩ void logService.record()
                                                   └─ record() 안: create → collector → [신규] workflowEvents?.emit(TURN_LOGGED)(연속 미응답 판정)
```

조기 반환 3경로(BLOCK·HANDLED·서빙 버전 없음)는 엔진을 호출하지 않으므로 노드 트리거가 **구조적으로** 없다(AC-WF2-8). 로그 적재 경로의 `TURN_LOGGED`는 BLOCK·상담 턴에도 발행되지만 구독 캐시·중립 판정에서 걸러진다(§6.4).

### 2.4 엔진·위젯·ml-worker · 워크스페이스 영향

| 워크스페이스 | 변경 |
|---|---|
| `packages/dialogue-engine` | **닫힌 목록 E-1~E-8**(§5.1) — I/O 0(L-5 유지) · `WORKFLOW` 없는 번들 결과·`apiCall` 바이트 동일 |
| `packages/shared-types` | **`workflow.ts` 신설**(§4.2) · `dialogue.ts`(`DialogOutputType` +`WORKFLOW` · `WorkflowOutputPayloadV1Schema` · 유니온 +1) · `dialogue-engine.ts`(`TraceCode` +2 · `DesignIssueCode` +5) · `conversation.ts`(`SimulateResponse.workflowSteps?`) · `governance.ts`(`EgressExitId`·`EgressDataKind`·`EncryptedFieldId` +1 · 지도 선택 키 2) · `audit.ts`(`AuditTargetType` +3) · `common.ts`(`ApiErrorCode` +2) · `version.ts`·`environment.ts`(경고 +2씩) · `index.ts` |
| `apps/web` | 설정 > 업무 자동화(발송 대상·실행 이력·요약) · 노드 편집기 "업무 요청 보내기" · 챗봇 > 업무 자동화(이벤트 구독·챗봇 이력) · 시뮬레이터 "업무 요청(모의)" 패널 · 데이터 지도 행 · `Record<DialogOutputType,…>`·`Record<AuditTargetType,…>`·`Record<DesignIssueCode,…>` 라벨(컴파일 강제) — §20 |
| `apps/widget` · `apps/ml-worker` | **0건**(W-11). 위젯 렌더러는 `default: return null`이며 엔진이 `WORKFLOW`를 출력에 넣지 않는다 |

### 2.5 기존 코드 변경 목록 (구현자 체크리스트)

| 파일 | 변경 | 근거 |
|---|---|---|
| `prisma/schema.prisma` + 마이그레이션 `20260926180000_workflow_automation` | §3.1 — 신규 3테이블 · `Chatbot` 역참조 1(컬럼 0) · **새 필드는 모델 끝** | §3 |
| `packages/shared-types/src/*` | §2.4 표 · §4 | — |
| `packages/dialogue-engine/src/{workflow-output.ts(신규), outputs.ts, resolver.ts, api-call.ts, turn.ts, design-validator.ts, index.ts}` | §5.1 닫힌 목록 | P-2 |
| `common/workflow/workflow-event.port.ts` | 신규 순수 포트 | §6.2 |
| `conversation/public-conversation.service.ts` | 생성자 **17번째 선택 인자** `workflowTriggers?: WorkflowTriggerService` · ④.7 블록 1개(§6.1) | FR-WF2-5 |
| `conversation/conversation-log.service.ts` | 생성자 4번째 `@Optional() @Inject(WORKFLOW_EVENT_SINK)` · `collector.collect()` 뒤 `emit({ kind:'TURN_LOGGED', … })` 1줄(기존 try 안) | FR-WF3-5 |
| `conversation/conversation.module.ts` | imports += `WorkflowTriggersModule` | — |
| `handoff/handoff-thread.service.ts` | 생성자 3번째 `@Optional()` 포트 · `createHandoff` 트랜잭션 성공 뒤 `HANDOFF_STARTED` · `endHandoff` 트랜잭션 뒤 `ended===true`일 때 `HANDOFF_ENDED` — **트랜잭션 코드·쓰기 데이터 불변**(H-2·H-3·H-7 불변) | §6.2 |
| `handoff/handoff.module.ts` · `survey-responses/*.module.ts` · `feedback/feedback.module.ts` | imports += `WorkflowTriggersModule` | — |
| `survey-responses/survey-response.service.ts` | 생성자 3번째 `@Optional()` 포트 · `COMPLETED` 트랜잭션 뒤 `SURVEY_COMPLETED` 1줄(S-2·S-11 불변) | §6.2 |
| `feedback/message-feedback.service.ts` | 생성자 4번째 `@Optional()` 포트 · `claimAndEnqueue()`의 `claim.count===0` 반환 **뒤** `FEEDBACK_NEGATIVE` 1줄(F-2·F-15 불변) | §6.2 |
| `dialog-nodes/*.service.ts` | 저장 시 `WORKFLOW` 검증(대상 존재 `404 INVALID_REFERENCE` · 노드당 ≤3 `400 OUTPUT_PAYLOAD_INVALID`) · `validate()` 컨텍스트에 `workflowTargets`(`WORKFLOW`가 있을 때만 조회 1회) · 모듈 imports += `WorkflowCatalogModule` | FR-WF2-8 |
| `simulation/simulation.service.ts` · 모듈 | 응답 `workflowSteps?`(모의 — `WorkflowCatalogService` 1회 조회 · 발송 0) | FR-WF2-7 |
| `dialogue-common/reference-check.service.ts` | `assertWorkflowTargetDeletable(targetId)`(초안 노드 — `contains` 사전 필터 + 파싱 재확인 · No.26 `assertApiConnectionDeletable` 형제) | FR-WF1-8 |
| `versions/lib/external-refs.ts` · `versions/restore/restore-warnings.service.ts` · `environment/core/lib/switch-warnings.ts` · `environment/core/prod-switch.service.ts` | `workflowTargetIds` 수집 · 경고 `WORKFLOW_TARGET_MISSING`·`WORKFLOW_TARGET_DISABLED`(Prisma 읽기) | FR-WF9-2 |
| `legacy-api/transport/legacy-transport.port.ts` · `node-http.transport.ts` | 요청 선택 필드 `exitId?`·`responseMode?` · 결과 선택 필드 `retryAfter?`(STATUS_ONLY일 때만) — **기본값 = 현행 동작** | §9.4 |
| `common/egress/egress-registry.ts` | `WORKFLOW_WEBHOOK` 항목 · `masked` 유니온 +`PER_TARGET` | §9.1 |
| `common/crypto/encrypted-fields.ts` | `WORKFLOW_PAYLOAD`(`workflow_runs`·`payload`) | §10.1 |
| `governance/bootstrap/governance-bootstrap.service.ts` | `ENCRYPTED_COLUMNS` += `WORKFLOW_PAYLOAD`(옛 키 필요 행 검사) | §10.2 |
| `governance/writer/governance-data.writer.ts` · `governance/retention-policy.service.ts` | `CALL_LOGS` 삭제·미리보기 건수에 종단 `workflowRun` 포함 | §10.3 |
| `governance/governance-map.service.ts` | 선택 키 `egress.workflowTargets?`·`risks.rawPersonalDataWorkflowTargets?`(대상 0개면 생략) | §9.6 |
| `chatbots/chatbots.service.ts` | 영구삭제 동반 삭제 +2(`workflowRun`·`workflowSubscription` — 챗봇 삭제 직전) · 사전검사 15종 불변 | §10.4 |
| `audit-logs/lib/audit-snapshot.ts` | `AUDIT_FIELDS` += 3 대상(§15) | 컴파일 강제 |
| `config/env.validation.ts` | 선택 16종 + 교차 검사 1(임대 ≥ 타임아웃 + 30초 — 경고 후 보정) · **`WORKFLOW_SECRET__*`는 스키마에 넣지 않는다** | §3.4 |
| `app.module.ts` | imports 끝 `WorkflowModule` | §2.2 |
| `jest.isolate-env.js` | `WORKFLOW_DISPATCH_ENABLED='false'` 1줄 | CLAUDE.md |
| 시험 파일 | §21.3 닫힌 목록 | FR-0-180 |

> **이 목록에 없는 파일은 바꾸지 않는다.** 특히 `apps/widget/**` · `apps/ml-worker/**` · `legacy-api/legacy-api-http.client.ts`·`legacy-api.service.ts`·`legacy-api-secret.resolver.ts`·`transport/node-dns.resolver.ts` · `legacy-api/lib/ip-policy.ts`(import만) · `handoff/lib/session-ref.ts`·`session-alert.ts`(import만) · `common/polling/**`(재사용만) · `governance/jobs/field-crypto.job.ts`(`ALL_FIELDS` 불변) · `stats/**`·`learning/**`·`validation/**`·`deploy-schedules/**`.

### 2.6 커밋 분리 단위

| 커밋 | 범위 | 독립성 · 게이트 |
|---|---|---|
| **① 계약·엔진·스키마(관측 불변)** | shared-types 추가(값·선택 키만) · 엔진 E-1~E-8 + 엔진 신규 spec · 마이그레이션(`CREATE`만) · `workflow/catalog`(읽기 전용) · dialog-nodes 저장 검증(대상 0개 = `WORKFLOW` 저장은 항상 `404 INVALID_REFERENCE`) · 웹 라벨 맵 컴파일 보완(`WORKFLOW` 아이콘·설계 점검 라벨 — 편집기 노출은 ④) | 대상이 없어 `WORKFLOW`를 저장할 수 없다 — 관측 가능한 동작 변화 0. **기존 엔진·API·웹 시험 무수정 통과**(여기서 깨지면 멈추고 보고) |
| **② 발송 기반** | secrets · core store · triggers(writer·서비스 — 아직 호출부 없음) · dispatch(잡·발송기) · 전송 선택 필드 · 레지스트리·암호화 상수 · 기동 키 검사 · `jest.isolate-env.js` · W 봉인 일부 | 기대값 변경 = X-2 · X-4. 호출부가 없어 발송함이 항상 비어 있다 — FR-0-172 기준선을 **② 적용 후**로 잡는다 |
| **③ 트리거 연결** | 공개 대화 ④.7 · 포트 주입 4곳 · 시뮬레이터 모의 · 설계 점검 컨텍스트 | 기대값 변경 0(생성자 인자 전부 선택) |
| **④ 관리 API·운영·통합** | 컨트롤러 3 · 서비스 · 감사 · 거버넌스 지도/보존 · 버전/환경 경고 · 영구삭제 · 웹 화면 · W 봉인 전체 | X-1 · X-3 |

---

## 3. 데이터 모델 · 마이그레이션

### 3.1 Prisma 변경안

```prisma
model Chatbot {
  // ... 기존 필드·역참조 불변
  /// [신규 No.41] 이벤트 구독(환경 밖 — 스냅샷·복사·토픽 분리 대상 아님 · 영구삭제 동반 삭제). 컬럼 추가 0.
  workflowSubscriptions WorkflowSubscription[]
}

/// [신규 2026-09-26 No.41] 업무 자동화 발송 대상(전역 — 챗봇 스코프 아님, ADR-0041 §1).
/// ★ 비밀 값 컬럼이 없다 — `secretRef`·`signingSecretRef`·`urlSecretRef`(이름)만 두고 값은
/// `WORKFLOW_SECRET__<REF>` 환경변수에서 `WorkflowSecretResolver` 1파일만 읽는다.
/// 노드 → 대상 참조는 `DialogNode.outputs` JSON 안이라 FK가 없다(앱 레벨 409 — 초안 노드만).
model WorkflowTarget {
  id                   String    @id @default(uuid())
  name                 String
  /// normalizeText(name) — 전역 유일(ApiConnection 선례)
  nameNormalized       String    @unique
  description          String?
  /// https(+ WORKFLOW_ALLOW_HTTP일 때 http) 스킴·호스트·포트·경로. 사용자정보·쿼리·프래그먼트 금지
  baseUrl              String
  /// NONE | API_KEY_HEADER | BEARER | BASIC (ApiConnectionAuthType 재사용)
  authType             String    @default("NONE")
  authHeaderName       String?
  secretRef            String?
  signingEnabled       Boolean   @default(true)
  signingSecretRef     String?
  /// 있으면 발송 주소 = 환경변수의 전체 주소(호스트·포트는 baseUrl과 같아야 한다)
  urlSecretRef         String?
  timeoutMs            Int       @default(5000)
  maxAttempts          Int       @default(5)
  allowRawPersonalData Boolean   @default(false)
  enabled              Boolean   @default(true)
  /// 일시 정지 — 값 있음 = 새 요청 HELD · 대기 요청 HELD
  pausedAt             DateTime?
  /// 발송 결과 카운터(쓰기 = workflow-run.store.ts 1파일 · 이 3키만)
  consecutiveFailures  Int       @default(0)
  lastSuccessAt        DateTime?
  lastFailureAt        DateTime?
  subscriptions        WorkflowSubscription[]
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt

  @@index([updatedAt])
  @@map("workflow_targets")
}

/// [신규 No.41] 챗봇 × 이벤트 × 대상 구독(환경 밖 — 저장 즉시 운영 반영).
model WorkflowSubscription {
  id         String         @id @default(uuid())
  chatbotId  String
  chatbot    Chatbot        @relation(fields: [chatbotId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  /// HANDOFF_STARTED | HANDOFF_ENDED | SURVEY_COMPLETED | FEEDBACK_NEGATIVE | UNANSWERED_STREAK
  eventType  String
  targetId   String
  target     WorkflowTarget @relation(fields: [targetId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  enabled    Boolean        @default(true)
  pausedAt   DateTime?
  /// JSON { threshold?: 2~10, includeStructuredAnswers?: boolean } — 이벤트별 zod
  conditions String         @default("{}")
  createdAt  DateTime       @default(now())
  updatedAt  DateTime       @updatedAt

  @@unique([chatbotId, eventType, targetId])
  @@index([targetId])
  @@map("workflow_subscriptions")
}

/// [신규 No.41] 발송함 겸 실행 이력(ADR-0041 §4). id = deliveryId(앱 선발급 uuid — 봉투·AAD·멱등키).
/// FK 없음(로그 규약 — 대상·노드·구독이 지워져도 기록은 남는다). ★ 텍스트 본문·sessionId·필드 값 컬럼이 없다
/// — 유일한 예외는 재시도용 일시 보관 `payload`(종단 전이 시 소거 · 실패 7일 뒤 소거 · 거버넌스 암호화 대상).
model WorkflowRun {
  id                 String    @id
  targetId           String
  /// 적재 시점 대상 이름 스냅샷(AuditLog.targetName 선례)
  targetName         String
  /// TEST는 null
  chatbotId          String?
  /// NODE | EVENT | TEST
  triggerKind        String
  /// WorkflowEventType 7종
  eventType          String
  actionKey          String?
  nodeId             String?
  outputIndex        Int?
  subscriptionId     String?
  /// 공개 대화 messageId(= ConversationLog.id) — NODE·UNANSWERED_STREAK·FEEDBACK_NEGATIVE
  messageId          String?
  /// handoffId | surveyResponseId | messageFeedbackId
  sourceRefId        String?
  /// NODE: N:<messageId>:<nodeId>:<outputIndex> · EVENT: E:<subscriptionId>:<sourceKey> · TEST: null
  dedupeKey          String?   @unique
  /// computeSessionRef(chatbotId, sessionId) — sessionId 원값 컬럼은 없다
  sessionRef         String?
  servedVersionId    String?
  /// PENDING | HELD | SENDING | SUCCEEDED | FAILED | SKIPPED | CANCELLED | EXPIRED
  status             String
  /// WorkflowStatusReason(SKIPPED·CANCELLED·FAILED·EXPIRED의 사유)
  statusReason       String?
  /// TARGET | SUBSCRIPTION (HELD일 때만)
  holdReason         String?
  heldAt             DateTime?
  attemptCount       Int       @default(0)
  nextAttemptAt      DateTime?
  claimToken         String?
  claimedAt          DateTime?
  lastAttemptAt      DateTime?
  /// WorkflowOutcome
  lastOutcome        String?
  lastHttpStatus     Int?
  lastLatencyMs      Int?
  /// SLOT 값이 마스킹으로 바뀌었는가 — 원문도 마스킹본도 이 테이블 메타데이터에는 없다
  personalDataMasked Boolean   @default(false)
  /// JSON string[] — 필드 **이름**만
  fieldNames         String    @default("[]")
  /// 봉투 JSON 바이트(UTF-8 문자열) 또는 enc:v1 봉투 — 일시 보관
  payload            String?
  /// 본문을 만든 행만 값이 있다(SKIPPED 적재·TEST = null)
  payloadBytes       Int?
  payloadPurgedAt    DateTime?
  manualRetryCount   Int       @default(0)
  lastManualRetryAt  DateTime?
  firstSentAt        DateTime?
  completedAt        DateTime?
  /// 성공 시 completedAt - createdAt(ms) — 요약 P95용
  deliveryLatencyMs  Int?
  /// KST 일 버킷(ADR-0017 — 발생 시각 기준)
  dayBucket          String
  /// = 이벤트 발생 시각(앱이 명시 — 봉투 occurredAt과 같다)
  createdAt          DateTime

  @@index([status, nextAttemptAt])
  @@index([status, claimedAt])
  @@index([status, completedAt])
  @@index([targetId, status])
  @@index([targetId, sessionRef, createdAt])
  @@index([subscriptionId, status])
  @@index([chatbotId, createdAt])
  @@index([createdAt])
  @@map("workflow_runs")
}
```

- **`WorkflowAttempt` 미도입**: 1차 콘솔 요구(FR-WF7-1)는 "시도 수 · 마지막 결과 코드·HTTP 상태·지연 · 다음 시도"로 충분하다. 시도별 표가 필요해지면 1:N 테이블을 추가한다(재검토).
- **유일 키 = nullable `@unique dedupeKey`**: SQLite·Postgres 모두 `UNIQUE`에서 NULL을 여러 개 허용하므로 TEST·재발송과 공존한다. 요구사항 초안의 "부분 유일(마이그레이션 전용 인덱스)"은 불필요하다 — **원시 부분 유니크 인덱스 4종 개수가 그대로**다(R-4).
- **FK 규약**: `WorkflowRun`은 FK 0(로그). `WorkflowSubscription`만 `Chatbot`·`WorkflowTarget`에 `Restrict` FK — 구독이 남은 대상 삭제는 DB가 최종 거부한다(앱은 먼저 `409`).

### 3.2 마이그레이션 (1개 — `20260926180000_workflow_automation`)

```sql
-- 전부 CREATE — 기존 테이블 재정의 0 · ALTER 0(Chatbot 역참조는 컬럼이 없다) · 백필 0
CREATE TABLE "workflow_targets" (… "nameNormalized" TEXT NOT NULL, … "consecutiveFailures" INTEGER NOT NULL DEFAULT 0, …);
CREATE UNIQUE INDEX "workflow_targets_nameNormalized_key" ON "workflow_targets"("nameNormalized");
CREATE INDEX "workflow_targets_updatedAt_idx" ON "workflow_targets"("updatedAt");

CREATE TABLE "workflow_subscriptions" (…,
  CONSTRAINT "workflow_subscriptions_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "workflow_subscriptions_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "workflow_targets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE);
CREATE UNIQUE INDEX "workflow_subscriptions_chatbotId_eventType_targetId_key" ON "workflow_subscriptions"("chatbotId","eventType","targetId");
CREATE INDEX "workflow_subscriptions_targetId_idx" ON "workflow_subscriptions"("targetId");

CREATE TABLE "workflow_runs" (…);                -- FK 없음
CREATE UNIQUE INDEX "workflow_runs_dedupeKey_key" ON "workflow_runs"("dedupeKey");
CREATE INDEX … (status,nextAttemptAt) · (status,claimedAt) · (status,completedAt) · (targetId,status) · (targetId,sessionRef,createdAt) · (subscriptionId,status) · (chatbotId,createdAt) · (createdAt)
```

- 마이그레이션은 **수기 작성**(선행 그룹 규약)하고 `prisma migrate dev`의 diff가 원시 부분 유니크 4종(`test_runs_chatbotId_active_key`·`deploy_schedules_chatbotId_scheduledAt_active_key`·`deploy_schedules_chatbotId_running_key`·`handoff_sessions_active_key`)을 지우는 구문을 끼우지 않았는지 확인한다. 적용 후 `SELECT count(*) FROM sqlite_master WHERE type='index' AND sql LIKE '%WHERE%'` = **4**.
- 통합 시험 DB는 **`prisma migrate deploy`**로 만든다(CLAUDE.md — `db push`는 원시 부분 유니크를 만들지 않는다).

### 3.3 seed

변경하지 않는다. 발송 대상·구독·실행 이력 0행이 정상 상태다(데모 대상을 만들면 dev 서버가 실제 외부로 발송을 시도한다). 연동 확인은 콘솔 "테스트 발송" + 운영자가 준비한 수신 엔드포인트로 한다.

### 3.4 환경변수 — 선택 16종(zod) + 비밀 접두 규약(스키마 밖) · 전부 기본값 · 기동 조건 아님

| 변수 | 기본 | 검증 | 용도 |
|---|---|---|---|
| `WORKFLOW_ENABLED` | `true` | `envBoolean` | 기능 전체 — `false`면 노드 방출 `SKIPPED(FEATURE_DISABLED)` 기록 · 이벤트 적재 0 · 루프 미시작 · 콘솔 배너 |
| `WORKFLOW_DISPATCH_ENABLED` | `true`(시험 `false`) | `envBoolean` | 이 인스턴스의 발송 루프(발송 전담 인스턴스 지정) |
| `WORKFLOW_DISPATCH_INTERVAL_MS` | `5000` | 1000~60000 | 루프 주기 |
| `WORKFLOW_DISPATCH_BATCH` | `20` | 1~100 | tick당 선점 상한 |
| `WORKFLOW_CLAIM_LEASE_MS` | `60000` | 10000~600000 | `SENDING` 임대 — `< WORKFLOW_MAX_TIMEOUT_MS + 30000`이면 **경고 + 보정**(기동 실패 아님 — No.28 선례) |
| `WORKFLOW_MAX_TIMEOUT_MS` | `15000` | 1000~15000 | 대상 타임아웃 상한 |
| `WORKFLOW_MAX_ATTEMPTS_CAP` | `10` | 1~10 | 대상 최대 시도 상한 |
| `WORKFLOW_BACKOFF_SCHEDULE` | `30s,2m,10m,30m,2h` | `^\d+(s\|m\|h)(,\d+(s\|m\|h)){0,9}$` | 재시도 간격(마지막 값 반복) |
| `WORKFLOW_PAYLOAD_MAX_BYTES` | `16384` | 1024~65536 | 봉투 상한 |
| `WORKFLOW_SESSION_LIMIT` · `WORKFLOW_SESSION_WINDOW_MIN` | `3` · `10` | 1~50 · 1~1440 | (세션, 대상) 노드 요청 상한 |
| `WORKFLOW_TARGET_RATE_PER_MIN` | `60` | 1~6000 | 대상 분당 시도 상한(근사 — K-3) |
| `WORKFLOW_HOLD_MAX_HOURS` | `24` | 1~168 | 보류 만료 |
| `WORKFLOW_FAILED_PAYLOAD_RETENTION_DAYS` | `7` | 1~30 | 실패 본문 보관(재발송 창) |
| `WORKFLOW_PRIVATE_ALLOWLIST` | `''` | `ip-policy.parseAllowlist` 형식 | 사설 대역 허용(레거시 목록과 **별도** — 최소 권한) |
| `WORKFLOW_ALLOW_HTTP` | `false` | `envBoolean` | 평문 http 대상 허용(개발·사내 전용 — 켜져 있으면 대상 목록 경고) |
| `WORKFLOW_SECRET__<REF>` | — | **스키마 밖**(REF `^[A-Z0-9_]{1,40}$`) | 서명 비밀·헤더 토큰·비밀 주소 — 리졸버 1파일만 `process.env` 읽기 |

- boolean은 전부 `envBoolean()`(CLAUDE.md — `z.coerce.boolean()` 금지). 코드 상수(`WORKFLOW_LIMITS` — shared-types): 인스턴스 동시 발송 10 · 대상 동시 `SENDING` 2 · 노드당 `WORKFLOW` 3 · 필드 20 · 필드 값 500자 · 턴당 방출 처리 10 · 챗봇당 구독 20 · 테스트 발송 대상당 분당 5 · 재발송·취소 100건 · 이력 조회 기간 90일 · 응답 본문 소비 4KB.

### 3.5 배포 순서 · 롤백

1. 마이그레이션(`CREATE`만 — API 중지 불필요) → 2. API 배포. 롤백: API를 되돌리고 테이블은 남겨 둔다(구버전은 테이블을 모른다 · `WORKFLOW` 아웃풋이 저장된 노드는 구버전 엔진에서 `PAYLOAD_INVALID` trace로 **그 아웃풋만 건너뛴다** — 구버전 `DialogOutputSchema`가 모르는 타입). 거버넌스 암호화를 켠 설치는 ADR-0040 감수 비용 7(API 롤백 금지)이 그대로 적용된다.

---

## 4. shared-types 계약

### 4.1 `dialogue.ts` — 아웃풋 타입

```ts
export const DialogOutputType = z.enum([... , 'API_CONDITION', 'WORKFLOW']);   // 12 → 13 (UNSUPPORTED_OUTPUT_TYPES 불변 — 실행 지원)

export const WORKFLOW_OUTPUT_LIMITS = { perNode: 3, fieldsMax: 20, fieldNameMax: 40, constValueMax: 500, actionKeyPattern: /^[a-z0-9._-]{1,60}$/ } as const;

/** [No.41] "업무 요청 보내기" — 사용자에게 보이지 않는 비종결 아웃풋. 바인딩은 No.26 ApiBindingSchema 그대로. */
export const WorkflowOutputPayloadV1Schema = z.object({
  version: z.literal(1),
  targetId: z.string().uuid(),
  actionKey: z.string().regex(WORKFLOW_OUTPUT_LIMITS.actionKeyPattern, '동작 키는 영문 소문자·숫자·.·_·- 60자 이내입니다.'),
  fields: z.array(z.object({ name: z.string().regex(/^[A-Za-z0-9_]{1,40}$/), value: ApiBindingSchema })).max(20).default([]),
}).superRefine((val, ctx) => { /* 필드 이름 중복 → issue(path ['fields', i, 'name']) */ });
export type WorkflowOutputPayloadV1 = z.infer<typeof WorkflowOutputPayloadV1Schema>;

export const DialogOutputSchema = z.discriminatedUnion('type', [ ...기존 12,
  z.object({ type: z.literal('WORKFLOW'), payload: WorkflowOutputPayloadV1Schema }),
]);
```

- `ApiBindingSchema`는 `dialogue.ts` 안에 있으므로 페이로드 스키마도 `dialogue.ts`에 둔다(`workflow.ts` ↔ `dialogue.ts` 순환 방지).
- **v1 한 형태뿐**이라 형태 판별 함수(`isWorkflowV1`)·읽기 합집합이 필요 없다. 향후 v2는 SURVEY/API 선례처럼 합집합 + 판별 함수로 연다.

### 4.2 `workflow.ts`(신설 — `common.ts`·`dialogue.ts`·`legacy-api.ts`·`governance.ts`만 의존)

```ts
export const WorkflowEventType = z.enum(['NODE_ACTION','HANDOFF_STARTED','HANDOFF_ENDED','SURVEY_COMPLETED','FEEDBACK_NEGATIVE','UNANSWERED_STREAK','TEST']);
export const WorkflowSubscriptionEventType = z.enum(['HANDOFF_STARTED','HANDOFF_ENDED','SURVEY_COMPLETED','FEEDBACK_NEGATIVE','UNANSWERED_STREAK']);
export const WorkflowTriggerKind = z.enum(['NODE','EVENT','TEST']);
export const WorkflowRunStatus = z.enum(['PENDING','HELD','SENDING','SUCCEEDED','FAILED','SKIPPED','CANCELLED','EXPIRED']);
export const WorkflowStatusReason = z.enum([
  'FEATURE_DISABLED','TARGET_UNAVAILABLE','BINDING_MISSING','RATE_LIMITED','PAYLOAD_TOO_LARGE',   // SKIPPED
  'TARGET_DELETED','MANUAL',                                                                       // CANCELLED
  'PERMANENT_ERROR','MAX_ATTEMPTS',                                                                // FAILED
  'HOLD_EXPIRED',                                                                                  // EXPIRED
]);
export const WorkflowOutcome = z.enum(['SUCCESS','HTTP_ERROR','TIMEOUT','NETWORK_ERROR','REDIRECT_NOT_ALLOWED','BLOCKED_ADDRESS',
  'EGRESS_BLOCKED','SECRET_MISSING','TARGET_HOST_MISMATCH','INVALID_TARGET_URL','LEASE_EXPIRED']);   // ApiCallOutcome과 겹치는 값은 같은 이름
export const WorkflowHoldReason = z.enum(['TARGET','SUBSCRIPTION']);
export const WORKFLOW_LIMITS = { /* §3.4 코드 상수 */ } as const;

// 대상
export const WorkflowTargetBaseUrlSchema = SafeUrlSchema.superRefine(/* 사용자정보·쿼리·프래그먼트·경로 이탈 금지 — ApiConnectionBaseUrlSchema 규칙 */);
export const CreateWorkflowTargetSchema = z.object({
  name, description?, baseUrl: WorkflowTargetBaseUrlSchema,
  authType: ApiConnectionAuthType.default('NONE'), authHeaderName?, secretRef?,
  signingEnabled: z.boolean().default(true), signingSecretRef?, urlSecretRef?,
  timeoutMs: int 1000~15000 (기본 5000), maxAttempts: int 1~10 (기본 5),
  allowRawPersonalData: z.boolean().default(false), enabled: z.boolean().default(true),
  confirmRawPersonalData: z.string().max(200).optional(),
}).superRefine(/* authType≠NONE ⇒ secretRef · signingEnabled ⇒ signingSecretRef · 금지 헤더 이름(isForbiddenHeaderName + x-chatbot-* · idempotency-key) */);
export const UpdateWorkflowTargetSchema = /* 전 필드 optional·nullable 규약 + confirmRawPersonalData */;
export const WorkflowSecretStates = z.object({ auth: ApiSecretStatus, signing: ApiSecretStatus, url: ApiSecretStatus, signingWeak: z.boolean() });
export const WorkflowTargetSchema = z.object({ id, name, description, baseUrl, baseUrlHost, authType, authHeaderName, secretRef, signingEnabled,
  signingSecretRef, urlSecretRef, timeoutMs, maxAttempts, allowRawPersonalData, enabled, pausedAt, secretStates: WorkflowSecretStates,
  insecureHttp: z.boolean(), egressDecision: EgressDecision, consecutiveFailures, lastSuccessAt, lastFailureAt,
  referencingNodeCount, subscriptionCount, stats24h: { succeeded, failed }, pendingCount, heldCount, failedRetainedCount, createdAt, updatedAt });
export const WorkflowTargetPickerItemSchema = z.object({ id, name, enabled, paused: z.boolean(), ready: z.boolean(), allowRawPersonalData });   // 주소·secretRef 없음
export const WorkflowTestSendRequestSchema = z.object({ actionKey: z.string().regex(...).optional() });
export const WorkflowTestSendResultSchema = z.object({ runId, outcome: WorkflowOutcome, httpStatus?, latencyMs, attempted: z.boolean(),
  targetDisabled: z.boolean(), targetPaused: z.boolean(), blockedAddress?: z.string(), guidance: z.string() });

// 구독
export const WorkflowSubscriptionConditionsSchema = z.object({ threshold: z.number().int().min(2).max(10).optional(),
  includeStructuredAnswers: z.boolean().optional() }).strict();   // 이벤트별 허용 키는 superRefine(UNANSWERED_STREAK만 threshold · SURVEY_COMPLETED만 includeStructuredAnswers)
export const CreateWorkflowSubscriptionSchema = z.object({ eventType: WorkflowSubscriptionEventType, targetId: z.string().uuid(),
  enabled: z.boolean().default(true), conditions: WorkflowSubscriptionConditionsSchema.default({}) });
export const UpdateWorkflowSubscriptionSchema = z.object({ targetId?, enabled?, conditions? });
export const WorkflowSubscriptionSchema = z.object({ id, chatbotId, eventType, targetId, targetName, targetEnabled, targetPaused, enabled, pausedAt, conditions, createdAt, updatedAt });

// 실행 이력
export const WorkflowRunItemSchema = z.object({ id /* = deliveryId */, targetId, targetName, chatbotId: nullable, triggerKind, eventType,
  actionKey: nullable, nodeId: nullable, subscriptionId: nullable, sessionRef: nullable, status, statusReason: nullable, holdReason: nullable,
  attemptCount, nextAttemptAt: nullable, lastOutcome: nullable, lastHttpStatus: nullable, lastLatencyMs: nullable,
  personalDataMasked, fieldNames: z.array(z.string()), retryable: z.boolean(), payloadPurged: z.boolean(),
  manualRetryCount, createdAt, completedAt: nullable });            // ★ payload·필드 값·sessionId 키 없음(W-14)
export const WorkflowRunListQuerySchema = PaginationQuerySchema.extend({
  targetId?, chatbotId? /* 전역만 */, triggerKind: csvEnumArray(WorkflowTriggerKind), eventType: csvEnumArray(WorkflowEventType),
  status: csvEnumArray(WorkflowRunStatus), from: z.coerce.date().optional(), to: z.coerce.date().optional(),
  retryableOnly: queryBoolean(false) });                            // boolean 쿼리 = queryBoolean(CLAUDE.md)
export const WorkflowRunBulkRequestSchema = z.object({ runIds: z.array(z.string().uuid()).min(1).max(100) });
export const WorkflowRunBulkResultSchema = z.object({ updated: z.number().int() });
export const WorkflowSummaryResponseSchema = z.object({ days: z.union([z.literal(7), z.literal(30)]), timezone: z.string(),
  totals: { occurred, succeeded, failed, skipped, cancelled, expired, pending, held }, retryRate: z.number(), p95DeliveryMs: z.number().nullable(),
  approximated: z.boolean(), byTarget: [...], byEvent: [...], daily: [{ dayBucket, succeeded, failed, skipped }],
  attention: { failingTargets, failedRetained, secretMissingTargets, oldestPendingMinutes: z.number().nullable(), enqueueFailures24h } });

// 시뮬레이터 모의
export const WorkflowStepViewSchema = z.object({ nodeId, targetId, targetName: z.string().nullable(),
  targetState: z.enum(['READY','DISABLED','PAUSED','MISSING','SECRET_MISSING']), actionKey,
  fields: z.array(z.object({ name, value: z.string(), source: z.enum(['CONST','SLOT']) })),
  bindingMissing: z.boolean(), rawPersonalData: z.boolean(), personalDataMasked: z.boolean(), mock: z.literal(true) });
```

### 4.3 봉투 v1 — 외부 계약(`WorkflowEnvelopeV1Schema` · `.strict()`)

```ts
export const WorkflowEnvelopeV1Schema = z.object({
  specVersion: z.literal('1'),
  deliveryId: z.string().uuid(),
  eventType: WorkflowEventType,
  occurredAt: z.string().datetime(),                         // UTC ISO 8601 'Z' — 외부 계약(화면 표시는 KST)
  test: z.boolean(),
  chatbot: z.object({ id: z.string().uuid(), name: z.string() }).strict().nullable(),   // TEST = null
  channel: z.enum(['WEB']).nullable(),
  sessionRef: z.string().regex(/^[0-9a-f]{16}$/).nullable(),
  source: z.object({ messageId: uuid.optional(), nodeId: uuid.optional(), outputIndex: int.optional(),
    handoffId: uuid.optional(), surveyResponseId: uuid.optional(), feedbackId: uuid.optional(), subscriptionId: uuid.optional() }).strict(),
  action: z.object({ key: z.string() }).strict().optional(),  // NODE_ACTION·TEST
  fields: z.record(z.string()).optional(),                    // NODE_ACTION·TEST
  data: WorkflowEventDataSchema.optional(),                   // 이벤트형(§6.5)
}).strict();
```

- **하위 호환 규칙**: v1 안에서는 **필드 추가만**(받는 쪽은 모르는 필드를 무시). 제거·의미 변경은 `specVersion: "2"`.
- 직렬화: 빌더(`triggers/lib/envelope.ts`)가 **고정 키 순서** 객체를 만들고 `JSON.stringify` 1회 — 그 문자열이 저장·서명·송신 바이트다(재직렬화 금지 — §8.2).
- `sessionId`·사용자 발화·봇 답변·자유 텍스트·상담 메시지 **키 자체가 없다**(스키마 `.strict()` + W-14).

### 4.4 기존 스키마 확장 (전부 값 추가·선택 키 — 하위 호환)

| 파일 | 추가 |
|---|---|
| `dialogue-engine.ts` | `TraceCode` +`WORKFLOW_EMITTED`·`WORKFLOW_BINDING_MISSING`(stage `OUTPUT` · `targetId` = 대상 id만 — 값 0) · `DesignIssueCode` +`WORKFLOW_SLOT_BINDING_UNREACHABLE`·`WORKFLOW_TARGET_UNAVAILABLE`·`WORKFLOW_NO_FIELDS`·`WORKFLOW_ONLY_OUTPUT`·`WORKFLOW_RAW_PERSONAL_DATA` |
| `conversation.ts` | `SimulateResponseSchema.workflowSteps: z.array(WorkflowStepViewSchema).optional()`(방출 있을 때만) |
| `governance.ts` | `EgressExitId` +`WORKFLOW_WEBHOOK` · `EgressDataKind` +`WORKFLOW_PAYLOAD` · `EncryptedFieldId` +`WORKFLOW_PAYLOAD` · `GovernanceMapResponse.egress.workflowTargets?` · `risks.rawPersonalDataWorkflowTargets?`(대상 0개 = 키 부재) |
| `audit.ts` | `AuditTargetType` +`WorkflowTarget`·`WorkflowSubscription`·`WorkflowRun`(27 → 30) + 라벨(발송 대상·이벤트 구독·업무 요청 실행) — `AuditAction` 16 불변 |
| `common.ts` | `ApiErrorCode` +`WORKFLOW_TARGET_IN_USE`·`WORKFLOW_RUN_NOT_RETRYABLE` |
| `version.ts` · `environment.ts` | 복원·전환 경고 유니온 +`WORKFLOW_TARGET_MISSING`·`WORKFLOW_TARGET_DISABLED`(`count`) |

---

## 5. 엔진 변경 명세 (P-2 (a))

### 5.1 닫힌 목록 — 이 표 밖의 엔진 변경은 금지

| # | 파일 | 변경 |
|---|---|---|
| **E-1** | (shared-types) `dialogue.ts`·`dialogue-engine.ts` | 타입 `WORKFLOW` · 페이로드 스키마 · 유니온 +1 · `TraceCode` +2 · `DesignIssueCode` +5 |
| **E-2** | `workflow-output.ts`(신규) | `WorkflowEmission` 타입 · `bindWorkflowOutput()` · `hasWorkflowOutputs(bundle)` — 순수 |
| **E-3** | `api-call.ts` | `resolveBinding` **export 추가**(시그니처·동작 불변) · `ApiResumeState.workflow?` · `resumeAfterApiCall`의 폼 전달·합산(§5.6) |
| **E-4** | `outputs.ts` | `case 'WORKFLOW'` 1개 · `ExecuteOutputsResult.workflowEmissions?`(1건 이상일 때만 키) |
| **E-5** | `resolver.ts` | `EngineResolution.workflowEvents?` · 실행 지점 4곳(폴백 노드·설문 완료 이동·S3·`resolveByNodeId`)의 정상 반환에 키 전파 · `buildSuspendedResolution` 인자 `workflow?` |
| **E-6** | `turn.ts` | `DialogueTurnResult.workflowEvents?` 선언만(비정지 경로는 기존 구조 분해 전개로 자동 전파 · 정지 경로는 폴리필 재진입 결과가 이미 포함) |
| **E-7** | `design-validator.ts` | `DesignValidationContext.workflowTargets?` · 규칙 5종(§5.7) |
| **E-8** | `index.ts` | `WorkflowEmission`·`bindWorkflowOutput`·`hasWorkflowOutputs` export |

엔진에 I/O·타이머·`Date.now()`·난수·`process.env`·Nest·Prisma 심볼 0건(L-5 · W-8). 엔진 패키지에 `webhook`·`hmac`·`workflowRun`·`WorkflowTarget`·`fetch` 심볼 0건(W-8).

### 5.2 타입

```ts
// packages/dialogue-engine/src/workflow-output.ts
export interface WorkflowEmission {
  readonly nodeId: string;          // 아웃풋을 소유한 노드(DIALOG_MOVE 후에는 이동한 노드) — executeOutputs QueueItem.nodeId
  readonly outputIndex: number;
  readonly targetId: string;
  readonly actionKey: string;
  /** 바인딩 성공 시에만 값이 있다. ★ SLOT 값은 원본(마스킹 전) — API 계층이 대상 설정에 따라 마스킹한다(엔진은 PII를 모른다). */
  readonly fields: ReadonlyArray<{ name: string; value: string; source: 'CONST' | 'SLOT' }>;
  /** SLOT 하나라도 불충족이면 true + fields = [](부분 값을 싣지 않는다 — 빈 티켓 방지). 없으면 키 부재. */
  readonly bindingMissing?: true;
}

// DialogueTurnResult (turn.ts)
  /** [No.41] 이번 턴에 WORKFLOW 아웃풋이 실행됐을 때만. 없으면 키 생략(surveyEvents 규약). 사용자 출력·trace 값·위젯 응답에 싣지 않는다. */
  workflowEvents?: WorkflowEmission[];

// ApiResumeState (api-call.ts)
  /** [No.41] 정지 전 방출분 + 같은 턴 완료 폼(분기 노드 SLOT 바인딩용). 조건(§5.6)을 만족할 때만 키가 있다. */
  workflow?: { eventsSoFar: WorkflowEmission[]; completedForm?: CompletedFormInfo };
```

### 5.3 빌더 `bindWorkflowOutput(payload, nodeId, outputIndex, completedForm?)`

```ts
export function bindWorkflowOutput(p: WorkflowOutputPayloadV1, nodeId: string, outputIndex: number, completedForm?: CompletedFormInfo): WorkflowEmission {
  const fields = [];
  for (const f of p.fields) {
    const bound = resolveBinding(f.value, completedForm);   // api-call.ts — No.26과 같은 1벌(CONST 그대로 · SLOT = 같은 턴 완료 폼 · 공백 = 누락)
    if (!bound) return { nodeId, outputIndex, targetId: p.targetId, actionKey: p.actionKey, fields: [], bindingMissing: true };
    fields.push({ name: f.name, value: bound.value, source: bound.source });
  }
  return { nodeId, outputIndex, targetId: p.targetId, actionKey: p.actionKey, fields };
}
export function hasWorkflowOutputs(bundle: DialogueBundle): boolean { return bundle.dialogNodes.some((n) => n.outputs.some((o) => o.type === 'WORKFLOW')); }
```

- 값 절단(500자)·제어 문자 제거·마스킹은 **엔진이 하지 않는다** — API 계층 `field-values.ts`(대상 설정 의존).

### 5.4 `executeOutputs` 분기(E-4)

```ts
case 'WORKFLOW': {
  const emission = bindWorkflowOutput(o.payload, item.nodeId, item.index, opts.completedForm);
  emissions.push(emission);
  trace.push({ stage: 'OUTPUT', code: emission.bindingMissing ? 'WORKFLOW_BINDING_MISSING' : 'WORKFLOW_EMITTED', targetId: o.payload.targetId });
  break;                                   // ★ out에 추가하지 않는다 · 종결자 아님(뒤 아웃풋 계속)
}
...
return { ..., ...(emissions.length > 0 ? { workflowEmissions: emissions } : {}) };
```

- 종결자(`CONTEXT_FORM`·v2 `SURVEY`)·정지(v2 `API_CONDITION`) **뒤**의 `WORKFLOW`는 기존 규칙대로 그 턴에 실행되지 않는다(정지 뒤는 재진입이 잇지 않는다 — 기존 `API_OUTPUT_NOT_LAST`/`SURVEY_OUTPUT_NOT_LAST` 경고가 이미 알린다).
- 0건 보장: `WORKFLOW`만 실행된 경우 `out.length===0` → 기존 폴백 문구 + `EMPTY_OUTPUT`(바이트 규칙 불변 — 제약 ⑥).

### 5.5 `resolver.ts` 전파(E-5)

4개 실행 지점(167·267·558·796행)마다:

- **정상 반환**: `...(execResult.workflowEmissions ? { workflowEvents: execResult.workflowEmissions } : {})` 1줄. `resolveTurn`의 `{ survey: _survey, ...resolutionWithoutSurvey }` 전개가 키를 그대로 `DialogueTurnResult`로 옮긴다(`turn.ts` 로직 변경 0).
- **정지 반환**: `buildSuspendedResolution({ ..., workflow: workflowCarry(execResult.workflowEmissions, completedForm, bundle) })` — `workflowCarry`는 §5.6 조건을 만족할 때만 객체, 아니면 `undefined`(→ `resumeState`에 키 부재).
- 설문 완료 이동(267행)·버튼 진입(796행)은 폼 완료가 없으므로 `completedForm = undefined`.

### 5.6 ★ 재조립 경로 보존 — `resumeAfterApiCall`·폴리필 동봉본 (FR-WF2-4 · AC-WF2-6 · C-4)

```ts
// workflowCarry(emissions, completedForm, bundle)
//   = (emissions?.length || (completedForm && hasWorkflowOutputs(bundle))) ? { eventsSoFar: emissions ?? [], ...(completedForm ? { completedForm } : {}) } : undefined

// resumeAfterApiCall(...)
const wf = resumeState.workflow;
const exec = executeOutputs(target.outputs, bundle, now, { ...,
  ...(wf?.completedForm ? { completedForm: wf.completedForm } : {}) });        // apiCallsRemaining 0 — bindRequest 미호출이라 다른 영향 0
const workflowEvents = [...(wf?.eventsSoFar ?? []), ...(exec?.workflowEmissions ?? [])];
return { ..., ...(workflowEvents.length > 0 ? { workflowEvents } : {}) };
```

| 경로 | 결과의 `workflowEvents` |
|---|---|
| 정지 없음 | 실행 지점의 방출분 |
| 정지 → 실제 호출 성공/실패 → `resumeAfterApiCall`(공개 대화 `completeTurn` · 시뮬레이터 LIVE) | 정지 전분 + **실제 분기 노드** 방출분 |
| 정지 → `resolveTurn` 폴리필 동봉본(`NOT_EXECUTED` 가정 — `apiCall` 미처리 소비자) | 정지 전분 + 실패 분기 노드 방출분(`apiCall` 처리 소비자는 이 값을 버리고 재진입 결과를 쓴다 — `completeTurn`은 `resumeState`만 읽는다) |
| 정지 → 목 완결(`completeApiTurnSync` — 시뮬레이터 MOCK·TC·비교) | 정지 전분 + 목 결과 분기 방출분(시뮬레이터 = 모의 표시 · TC·비교 = 무시) |
| 바인딩 누락 `BINDING_MISSING` 재진입 | 정지 전분 + 실패 분기 방출분 |

- **키 부재 규칙**: `WORKFLOW` 없는 번들 → `workflowCarry = undefined` → `resumeState`에 `workflow` 키가 없고 결과에 `workflowEvents` 키가 없다 → 기존 `apiCall`·결과 **바이트 동일**(손으로 만든 `resumeState`를 쓰는 기존 spec(`api-call.spec.ts` 51·94행)도 무수정 통과 — 선택 필드).
- `completedForm`은 이미 결과 밖 불투명 상태(`apiCall.resumeState`)에 있다 — 공개 응답·로그·시뮬레이터 응답은 `apiCall`을 직렬화하지 않는다(기존 규약 · W-14가 시뮬레이터 응답 조립을 확인).

### 5.7 설계 점검 규칙(E-7) — 저장을 막지 않는다

| 코드 | 심각도 | 조건 |
|---|---|---|
| `BROKEN_REFERENCE`(재사용) | ERROR | 컨텍스트가 있고 `targetId` 대상이 없다 |
| `WORKFLOW_TARGET_UNAVAILABLE` | WARNING | 대상 꺼짐·일시 정지·필요한 비밀 미설정 |
| `WORKFLOW_SLOT_BINDING_UNREACHABLE` | WARNING | `SLOT.contextVariableId ≠ node.contextVariableId`(버튼 진입 노드 포함 — 항상 누락, FR-WF2-8 ①④) |
| `WORKFLOW_ONLY_OUTPUT` | WARNING | 노드 아웃풋이 전부 `WORKFLOW`(사용자에게 기본 안내 문구가 나가고 미응답으로 집계 — 제약 ⑥) |
| `WORKFLOW_NO_FIELDS` | INFO | 필드 0개 |
| `WORKFLOW_RAW_PERSONAL_DATA` | INFO | 대상이 원문 개인정보 허용 |

컨텍스트(`workflowTargets`)는 `DialogNodesService.validate()`가 **노드에 `WORKFLOW`가 있을 때만** 카탈로그 1회 조회로 넘긴다(엔진 순수성 · 없으면 추가 조회 0).

### 5.8 봉인 · 회귀 시험

| # | 시험 | 단언 |
|---|---|---|
| EN-1 | 기존 엔진 전 스위트 | **무수정 통과**(AC-WF1-2) |
| EN-2 | `workflow-output.spec.ts`(신규) | CONST·SLOT·누락·공백·다중 필드 · `hasWorkflowOutputs` |
| EN-3 | `workflow-regression.spec.ts`(신규) | 대표 노드 모양 8종(TEXT·CARD·BUTTON·CONTEXT_FORM 완료·DIALOG_MOVE 체인·v2 SURVEY·v2 API 성공/실패·폴백 노드)에 대해 **`WORKFLOW`를 앞·중간·뒤에 넣은 번들과 뺀 번들**의 `outputs`·`nextState`·`unsupportedOutputs`·`pendingClarify`·trace(WORKFLOW 코드 제외) 바이트 동일(AC-WF2-2) |
| EN-4 | 같은 spec | `WORKFLOW` 없는 번들: `'workflowEvents' in result === false` · `'workflow' in (result.apiCall?.resumeState ?? {}) === false` |
| EN-5 | `api-call.spec.ts`에 **추가** 케이스(기존 케이스 불변) | ★ AC-WF2-6: A=[`WORKFLOW`#1, API] · 성공 분기 B=[`WORKFLOW`#2(SLOT), TEXT] — `resolveTurn` → 실제 `resumeAfterApiCall`(SUCCESS)로 #1·#2 · FAILURE·`NOT_EXECUTED` 폴리필·`BINDING_MISSING`에서도 #1 유지 · B의 SLOT이 A 턴 폼 값으로 채워짐 |
| EN-6 | 정적(W-8 · L-5) | 엔진 신규 파일 I/O 0 · 금지 심볼 0 |

---

## 6. 트리거

### 6.1 명시 트리거 — 노드 방출 적재(공개 대화 ④.7)

```ts
// public-conversation.service.ts — ④.6 설문 적재 블록 바로 뒤
if (result.workflowEvents && result.workflowEvents.length > 0) {
  await this.workflowTriggers?.enqueueNodeEmissions(result.workflowEvents, {
    chatbot: { id: chatbot.id, name: chatbot.name }, sessionId: dto.sessionId, messageId, channel: 'WEB',
    servedVersionId: serving.versionId ?? null, now,
  });   // 예외를 던지지 않는다(내부 try/catch — 경고 로그: chatbotId·targetId·오류 코드만)
}
```

`WorkflowTriggerService.enqueueNodeEmissions()` 순서(방출 최대 10건 — 초과분은 경고 로그 후 무시):

1. `WORKFLOW_ENABLED=false` → 방출마다 `SKIPPED(FEATURE_DISABLED)` 행(본문 없음).
2. 대상 조회 1회(`catalog.findForEnqueue(targetIds)` — 이름·사용 여부·정지·원문 허용).
3. 방출마다: 대상 없음·꺼짐 → `SKIPPED(TARGET_UNAVAILABLE)` · `bindingMissing` → `SKIPPED(BINDING_MISSING)`(필드 **이름**은 기록) · 세션 상한(§6.6) 초과 → `SKIPPED(RATE_LIMITED)` · 값 가공(§11.1) → 봉투 조립(§4.3) → 16KB 초과 → `SKIPPED(PAYLOAD_TOO_LARGE)` · 대상 정지 → `HELD(TARGET)` · 그 외 `PENDING(nextAttemptAt = now)`.
4. writer가 행 id 선발급 → `sealField('WORKFLOW_PAYLOAD', id, json)` → `create`(`dedupeKey = N:<messageId>:<nodeId>:<outputIndex>` · `payloadBytes` 기록 — P2002 = 이미 적재됨, 무시).

- 봇 응답은 어떤 경우에도 바뀌지 않는다(적재 실패·건너뜀·보류 전부 — AC-WF4-7 · EX-WF-26).
- 조회·쓰기 수(방출 1건 기준): 대상 1 + 세션 상한 계수 1 + create 1 = **3쿼리**(NFR-WFP2 ≤15ms).

### 6.2 ★ 이벤트 발행 포트 위치 · 1회 발행 보장

포트(`common/workflow/workflow-event.port.ts`):

```ts
export const WORKFLOW_EVENT_SINK = 'WORKFLOW_EVENT_SINK';
export type WorkflowSourceEvent =
  | { kind: 'HANDOFF_STARTED'; chatbotId: string; handoffId: string; sessionRef: string; channelType: string; alertLevelAtStart: string; consecutiveUnansweredAtStart: number; occurredAt: Date }
  | { kind: 'HANDOFF_ENDED'; chatbotId: string; handoffId: string; reason: HandoffEndReason; occurredAt: Date }
  | { kind: 'SURVEY_COMPLETED'; chatbotId: string; sessionId: string; channelType: string; surveyId: string; surveyName: string; responseId: string; isDuplicate: boolean; missingRequiredCount: number; occurredAt: Date }
  | { kind: 'FEEDBACK_NEGATIVE'; chatbotId: string; sessionId: string; channelType: string; feedbackId: string; messageId: string; targetKind: string; targetId: string | null; answeredByRag: boolean; occurredAt: Date }
  | { kind: 'TURN_LOGGED'; chatbotId: string; sessionId: string; channelType: string; messageId?: string; isAnswered: boolean; blockedByFilter: boolean; surveyTurn: boolean; handoffTurn: boolean; apiNotice: boolean; occurredAt: Date };
/** 동기 반환 · 예외 없음 · 내부에서 비동기 적재(fire-and-forget). sessionId는 프로세스 안에서만 쓰이고 저장되지 않는다. */
export interface WorkflowEventSink { emit(event: WorkflowSourceEvent): void }
```

| 이벤트 | 발행 파일 · 위치(요구사항 §1.3.1 원천 지점) | 1회 근거 | 발송함 `dedupeKey` |
|---|---|---|---|
| `HANDOFF_STARTED` | `handoff-thread.service.ts` `createHandoff` — `$transaction` **성공 반환 뒤**(catch 경로 밖) | 부분 유니크(세션당 활성 상담 1) + 트랜잭션 성공 1회 | `E:<subscriptionId>:<handoffId>` |
| `HANDOFF_ENDED` | 같은 파일 `endHandoff` — `$transaction` 결과 `ended===true`일 때만(호출부 4곳 공통 1지점) | 상태 CAS `updateMany count===1` | `E:<subscriptionId>:<handoffId>` |
| `SURVEY_COMPLETED` | `survey-response.service.ts` `applyOne` `COMPLETED` — 트랜잭션 뒤 | 완료 가드(읽기) — CAS 아님(제약 ⑧) → 유일 키가 흡수 | `E:<subscriptionId>:<responseId>` |
| `FEEDBACK_NEGATIVE` | `message-feedback.service.ts` `claimAndEnqueue` — `claim.count===0` 반환 **뒤**, 수집기 호출 **전**(수집 실패와 무관) | 큐 선점 CAS(`queueOutcome IS NULL`) — 👎→👍→👎에도 1회(AC-WF3-3 · EX-WF-13) | `E:<subscriptionId>:<feedbackId>` |
| `UNANSWERED_STREAK` | `conversation-log.service.ts` `record` — `create`·`collector.collect()` 뒤(RAG 보류 턴은 최종 결과 적재 시 — 같은 `record()`) | 연속 판정(§6.4) + **세션당 1회** 유일 키 | `E:<subscriptionId>:<sessionRef>` |
| `NODE_ACTION` | `public-conversation.service.ts` ④.7(§6.1) | 턴마다 새 `messageId` | `N:<messageId>:<nodeId>:<outputIndex>` |

- **커밋 후 · fire-and-forget**: 원천 트랜잭션·쓰기 데이터·반환값·예외 경로가 바뀌지 않는다(봉인 H-2·H-3·H-7·S-2·S-11·F-2·F-10·F-15 불변). 발행 전 프로세스 강제 종료 시 그 이벤트는 유실된다(NFR-WFR2 · C-8 — 요약 `enqueueFailures24h`는 적재 **예외**만 센다).
- **주입은 `@Optional()`**: 기존 spec이 생성자를 인자 없이 호출해도 `undefined` → no-op(생성자 끝 선택 인자 — 무수정 통과).
- `WorkflowTriggerService.emit()`은 즉시 반환하고 내부 Promise 집합에 등록한다. 통합 시험은 `drainForTest()`(이름에 `ForTest` — 운영 코드 호출 0, W-15)로 결정적으로 기다린다.

### 6.3 구독 캐시(`subscription-cache.ts` — 순수 + 주입 시계)

- 스냅샷 = **전 챗봇의 사용 중(`enabled`) 구독** + 대상 상태(사용·정지) + 챗봇 이름을 **1쿼리**로 적재 → `Map<chatbotId, Map<eventType, Sub[]>>`. TTL 30초 · 같은 인스턴스의 구독·대상 저장 시 즉시 `invalidate()`.
- 원천 이벤트 1건의 비용: 캐시 적중 = **DB 0** · 해당 챗봇·이벤트 구독 없음 = 즉시 반환(FR-WF3-4 · AC-WF1-1). 캐시 만료 시 인스턴스당 1쿼리/30초(챗봇 수와 무관).
- 다른 인스턴스 수렴 ≤30초(K-4) — "저장 즉시 운영 반영"은 같은 인스턴스 즉시 · 전체 30초 이내로 정의한다(상담 설정 캐시 ADR-0036 §8 선례 · 편집 화면 안내 문구).

### 6.4 연속 미응답 판정(`UNANSWERED_STREAK` — FR-WF3-5 · R-5)

1. `TURN_LOGGED` 수신 → 캐시에 이 챗봇의 `UNANSWERED_STREAK` 구독이 없으면 종료(DB 0).
2. 이번 턴이 **중립**(`blockedByFilter`·`surveyTurn`·`handoffTurn`)이거나 `isAnswered=true`면 종료(DB 0).
3. 세션 최근 30행 조회 1회(`conversationLog.findMany where chatbotId, sessionId orderBy createdAt desc take 30 select 판정 플래그 5개` — 인덱스 `(chatbotId, sessionId, createdAt)`) → 오름차순으로 뒤집어 **`evaluateSessionAlert()`(No.24 1벌)** 로 `consecutiveUnanswered` 계산.
4. 구독마다 `consecutiveUnanswered ≥ threshold`(기본 3)면 적재 — 유일 키 `E:<sub>:<sessionRef>`로 **세션당 1회**(4·5회째 재적재 없음 · 연속이 끊겼다 다시 N에 도달해도 같은 세션이면 없음 — S-4).

- API 고정 문구 턴은 **미응답으로 센다**(No.24 판정 그대로 — 모니터링 화면의 "연속 미응답 3"과 웹훅의 3이 같은 뜻 · 요구사항 문구 정정 D-11).
- 최근 30행 안에 중립 턴이 많아 창이 모자라면 과소 계수(보수적 — 알림 누락 쪽).

### 6.5 이벤트별 봉투 `data`(텍스트 본문 0 · 수치·열거값·id만)

| 이벤트 | `data` | 추가 조회 |
|---|---|---|
| `HANDOFF_STARTED` | `{ handoffId, alertLevelAtStart, consecutiveUnansweredAtStart }` | 0(이벤트에 있음) |
| `HANDOFF_ENDED` | `{ handoffId, endReason, userMessageCount, agentMessageCount, firstResponseSeconds: number｜null, durationSeconds }` | `HandoffSession` PK 1(구독 있을 때만) |
| `SURVEY_COMPLETED` | `{ surveyId, surveyName, responseId, isDuplicate, missingRequiredCount, answers?: [{ questionKey, choiceKeys?: string[], score?: number }] }` — `answers`는 `includeStructuredAnswers=true`일 때만(선택·척도 **key·정수**만 — 자유 텍스트 문항은 제외) | 옵션 켜짐 시 `SurveyAnswer` 1(응답 id로 — 암호문 컬럼 미선택) |
| `FEEDBACK_NEGATIVE` | `{ feedbackId, messageId, targetKind, targetId, answeredByRag }` | 0 |
| `UNANSWERED_STREAK` | `{ streakCount, threshold, lastMessageId, lastReason: 'FALLBACK'｜'API_NOTICE' }` | §6.4의 1 |
| `NODE_ACTION` | (`data` 없음) `action.key` · `fields{}` | — |

공통: `chatbot{id,name}`(캐시) · `channel` · `sessionRef`(`computeSessionRef(chatbotId, sessionId)` — `HANDOFF_*`은 상담 행의 값) · `source{...}` · `occurredAt`(원천 시각 UTC).

### 6.6 남용 방지(C-6 · FR-WF5-8)

- **(세션, 대상) 노드 요청 상한** 기본 10분에 3회: `workflowRun.count(where targetId, sessionRef, triggerKind='NODE', status ≠ SKIPPED, createdAt ≥ now − window)` — 인덱스 `(targetId, sessionRef, createdAt)` · DB 계수라 인스턴스 무관. 초과 = `SKIPPED(RATE_LIMITED)`.
- 새 탭·세션 만료는 새 `sessionRef` → 계수 초기화(익명 한계 — EX-WF-12, ADR-0034 감수 비용과 같은 수용).
- 받는 쪽 업무 키 중복 판단(같은 폼 재제출 — EX-WF-11)은 연동 가이드.

---

## 7. 발송 큐 · 잡 (`WorkflowDispatchJob`)

### 7.1 상태 기계

```
         (적재) ─┬─> PENDING ──선점──> SENDING ──2xx──────────────> SUCCEEDED(본문 소거)
                 │     ^  │              │  ──재시도 대상──> PENDING(nextAttemptAt = 백오프)
                 │     │  │              │  ──영구 실패·최대 시도──> FAILED(본문 7일 보관) ──재발송──> PENDING
                 │     │  │              └──임대 만료 회수──> PENDING(또는 최대 시도 시 FAILED)
                 │  재개│  └정지─> HELD ──24h──> EXPIRED(본문 소거)
                 ├─> HELD(대상/구독 정지)
                 └─> SKIPPED(사유 — 본문 없음)
 PENDING｜HELD ──취소──> CANCELLED(MANUAL｜TARGET_DELETED — 본문 소거)
 PENDING ──선점 시 대상 꺼짐──> SKIPPED(TARGET_UNAVAILABLE — 본문 소거)
```

모든 전이는 `workflow-run.store.ts` 1파일의 `updateMany`(기대 상태 · 필요 시 `claimToken` 조건) + 영향 행 수다(원시 SQL 0 · W-3).

### 7.2 tick 흐름(기본 5초 · `PollingLoop` 재사용 — 겹침 불가)

1. **후보 1쿼리**: `findMany where OR[{ status: PENDING, nextAttemptAt ≤ now }, { status: SENDING, claimedAt < now − lease }] orderBy nextAttemptAt asc take batch×2 select(id, status, targetId, claimToken, attemptCount)`. **0행이면 종료**(빈 발송함 = 1쿼리 — NFR-WFP4).
2. 임대 만료 `SENDING` 회수: `updateMany where id, status SENDING, claimToken = 관측값 → PENDING, claimToken null, nextAttemptAt now, lastOutcome LEASE_EXPIRED`(시도 수 ≥ 최대면 `FAILED(MAX_ATTEMPTS)`).
3. 대상 상태 1쿼리(후보의 대상들 — 사용·정지·설정) + 대상별 `SENDING` 수·최근 60초 시도 수 `groupBy` 1쿼리씩.
4. 계획(순수 `claim-plan.ts`): 대상 정지 → `HELD(TARGET)` 전이 · 대상 없음·꺼짐 → `SKIPPED(TARGET_UNAVAILABLE)`(본문 소거) · 대상 동시 2·분당 상한·인스턴스 동시 10 초과분은 **이번 tick 제외**(대기 — 실패 아님) · 최대 `batch`건.
5. 행마다 선점 CAS: `updateMany where id, status PENDING, nextAttemptAt ≤ now → SENDING, claimToken = uuid, claimedAt = now, attemptCount + 1, lastAttemptAt = now` → `count===1`인 행만 발송(다른 인스턴스와 겹치면 0 → 건너뜀 — **같은 행 동시 발송 0**, NFR-WFR3).
6. 선점 행 본문 읽기(`openField`) → 발송기 호출(동시 10) → 결과 분류(§7.4) → 종결 CAS(`where id, status SENDING, claimToken`) — `count===0`이면 임대를 잃은 것(경고 로그만 — 이미 회수·재발송됨).
7. **정리(60초마다 1회 — tick 카운터)**: 보류 만료 `updateMany(HELD ∧ createdAt < now − holdMax → EXPIRED(HOLD_EXPIRED), payload null)` · 실패 본문 소거 `updateMany(FAILED ∧ payload ≠ null ∧ completedAt < now − retentionDays → payload null, payloadPurgedAt)`.

- 루프 시작은 `onModuleInit`에서 `WORKFLOW_ENABLED ∧ WORKFLOW_DISPATCH_ENABLED`일 때만 · 시험은 `jest.isolate-env.js`가 끄고 `tick()`을 직접 호출한다(CLAUDE.md).
- `tick(now?: Date)`는 시계·난수를 주입받는다(`common/polling/clock.ts` 재사용 + `random: () => number`) — 백오프·보류 만료를 결정적으로 시험한다.

### 7.3 다중 인스턴스 안전성

| 위험 | 방어 |
|---|---|
| 두 인스턴스가 같은 행 발송 | 선점 CAS(기대 상태 `PENDING` + `nextAttemptAt ≤ now`) — 한 인스턴스만 `count===1` |
| 발송 중 인스턴스 사망 | 임대(기본 60초 ≥ 타임아웃 15초 + 30초) 만료 후 다른 인스턴스가 회수 → **같은 `deliveryId`로 재발송**(최소 1회 — AC-WF4-5) |
| 늦게 끝난 원 인스턴스의 종결 덮어쓰기 | 종결 CAS가 `claimToken`을 조건으로 — 회수 시 토큰이 지워져 `count===0` |
| 대상 한도 | DB `groupBy` 기준이지만 tick 사이 경합으로 **인스턴스 수만큼 초과 가능**(근사 — K-3) |
| SQLite 쓰기 경합 | 선점·종결 `updateMany`는 행 단위 단문 · 배치 20 · 발송(네트워크 대기)은 트랜잭션 밖 |

### 7.4 결과 분류(`classify-result.ts` — 순수 · NFR-WFM1)

| 입력 | 분류 | `lastOutcome` |
|---|---|---|
| 응답 2xx | 성공 | `SUCCESS` |
| 응답 408·425·429·5xx | 재시도(429·503은 `Retry-After` 반영) | `HTTP_ERROR` + `lastHttpStatus` |
| 응답 그 밖의 4xx | 영구 | `HTTP_ERROR` |
| 전송 `REDIRECT_NOT_ALLOWED`(3xx) | 영구 | `REDIRECT_NOT_ALLOWED` |
| 전송 `TIMEOUT` · `NETWORK_ERROR`(DNS 실패 포함) | 재시도 | 같은 이름 |
| 발송 전 차단: 출구 `EGRESS_BLOCKED` · 주소 `BLOCKED_ADDRESS` · `SECRET_MISSING` · `TARGET_HOST_MISMATCH` · `INVALID_TARGET_URL`(비밀 주소 파싱 실패·http 불허) | 영구(송신 0) | 같은 이름 |

- 영구 실패 = `FAILED(PERMANENT_ERROR)` · 재시도 대상인데 `attemptCount ≥ min(target.maxAttempts, WORKFLOW_MAX_ATTEMPTS_CAP)` = `FAILED(MAX_ATTEMPTS)`.
- 대상 카운터(같은 store): 성공 → `consecutiveFailures = 0`·`lastSuccessAt` · 실패(재시도·영구) → `+1`·`lastFailureAt`. `≥10`이면 목록·요약 "연속 실패" 경고(자동 정지 없음 — FR-WF5-9).

### 7.5 재시도 백오프(`backoff.ts`·`retry-after.ts` — 순수)

- 지연 = `schedule[min(n−1, len−1)] × (0.8 + 0.4 × random())`(n = 방금 실패한 시도 번호 · 기본 30초·2분·10분·30분·2시간 ±20%).
- `Retry-After`(초 또는 HTTP-date)가 429·503에 있으면 **백오프 대신** 그 값 — 상한 2시간 · 과거·파싱 실패는 백오프로(AC-WF4-3).
- `nextAttemptAt = now + 지연`(UTC 저장 · 콘솔 표시는 KST).

### 7.6 보류 · 재개 · 만료(P-9 · FR-WF7-5)

| 동작 | 트랜잭션 |
|---|---|
| 대상 정지(`security:write`) | `pausedAt = now`(CAS `pausedAt IS NULL`) + 그 대상 `PENDING → HELD(TARGET), heldAt` |
| 대상 재개 | `pausedAt = null` + 그 대상 `HELD(TARGET)` 중 ① `createdAt < now − holdMax` → `EXPIRED` ② 구독이 정지된 행 → `holdReason = SUBSCRIPTION`(보류 유지) ③ 나머지 → `PENDING(nextAttemptAt now)` |
| 구독 정지(`chatbot:write`) | `pausedAt = now` + 그 구독 `PENDING → HELD(SUBSCRIPTION)` |
| 구독 재개 | 그 구독 `HELD(SUBSCRIPTION)` 중 만료 → `EXPIRED` · 대상 정지 중 → `holdReason = TARGET` · 나머지 → `PENDING` |

- 적재 시 정지 판정은 캐시·대상 조회값으로 하고, 적재와 정지 커밋이 엇갈린 `PENDING`은 **선점 계획(§7.2-4)이 대상 정지를 다시 보고 `HELD`로** 돌린다(이중 방어). `SENDING` 중이던 행은 정상 종결된다.
- 대상 **꺼짐**(`enabled=false`)은 정지와 다르다 — 새 요청 `SKIPPED(TARGET_UNAVAILABLE)` · 대기 요청은 선점 시 같은 사유로 건너뜀(콘솔 확인 창: "대기 N건은 보내지 않습니다. 잠시 멈추려면 일시 정지를 쓰세요").

### 7.7 실패 보관(데드레터) · 수동 재발송 · 취소

- 실패 보관 = `FAILED ∧ payload ≠ null`(보관 기간 7일). 이력 `retryable = true`.
- **재발송**(`POST /chatbots/:chatbotId/workflow-runs/retry { runIds ≤100 }` · `chatbot:write`): 전건 사전 검사(이 챗봇 소속 · `FAILED` · 본문 있음) → 하나라도 불가면 **전체 거부** `409 WORKFLOW_RUN_NOT_RETRYABLE`(`details[]` = 불가 id·사유) → 트랜잭션 `updateMany(where id IN, status FAILED, payload ≠ null) → PENDING, attemptCount 0, nextAttemptAt now, statusReason null, completedAt null, manualRetryCount + 1, lastManualRetryAt` — `count ≠ n`(경합)이면 롤백 후 같은 409. **`deliveryId`·본문 바이트 불변**(받는 쪽 중복 제거 — AC-WF6-1) · 감사 1건(§15).
- **취소**(`…/cancel` · `chatbot:write`): `PENDING｜HELD`만 → `CANCELLED(MANUAL)` + 본문 소거 · 그 밖의 상태 포함 시 `400 INVALID_STATUS_TRANSITION`(`details[]`) · 감사 1건.
- 교차 챗봇 id = `404 NOT_FOUND`(존재 노출 금지). `ARCHIVED` 챗봇에서도 재발송·취소 허용(발송함 운영 — 예약 배포 취소 선례).

### 7.8 본문 소거(파기 주체 = 발송 모듈 1파일)

| 전이 | 본문 |
|---|---|
| → `SUCCEEDED` · `CANCELLED` · `EXPIRED` · 선점 시 `SKIPPED` | **같은 `updateMany`에서** `payload = null, payloadPurgedAt = now` |
| 적재 시 `SKIPPED` | 본문을 만들지 않는다(`payload = null`, `payloadBytes = null`, `payloadPurgedAt = null`) |
| → `FAILED` | 보관 → 정리 단계가 `completedAt + 7일` 뒤 소거 |
| 테스트 발송 | 본문을 저장하지 않는다(행은 종단 상태로 생성 · `payloadBytes = null`) |

소거는 필드 `null` 대입이며 `secure_delete`를 쓰지 않는다(원시 SQL 보유 파일 4 불변 — 물리 잔존은 디스크 암호화 운영 전제, ADR-0040 감수 비용 5와 같다).

### 7.9 서버 종료

`onModuleDestroy` → `loop.stop(30000)` — 진행 중 tick(발송 포함)을 30초까지 기다린다. 미완료 `SENDING`은 임대 만료로 회수된다(EX-WF-4).

---

## 8. 웹훅 전송 계약

### 8.1 요청

```
POST <발송 주소>
Content-Type: application/json; charset=utf-8
Content-Length: <bytes>
User-Agent: ChatBot-Workflow/1
X-Chatbot-Event: <eventType>
X-Chatbot-Delivery: <deliveryId>
Idempotency-Key: <deliveryId>
X-Chatbot-Attempt: <n>                                  # 1부터 · 수동 재발송은 다시 1부터
X-Chatbot-Signature: t=<unix초>,v1=<hex64>             # signingEnabled일 때
<인증 헤더>                                              # API_KEY_HEADER: <헤더 이름>: <비밀> · BEARER: Authorization: Bearer <비밀> · BASIC: Authorization: Basic base64(<비밀>)
Connection: close

<봉투 v1 바이트 — 적재 시 확정된 문자열 그대로>
```

- 발송 주소 = `urlSecretRef` 있으면 `WORKFLOW_SECRET__<urlSecretRef>`의 전체 주소, 없으면 `baseUrl`. 메서드는 **POST 고정**(J-9).
- 응답: 상태 코드만 사용 · 본문은 최대 4KB 소비 후 연결 종료 · **저장·로그 0**(NFR-WFS6). `Retry-After`만 읽는다.
- 200인데 본문에 오류가 있어도 성공(EX-WF-14 — 가이드: "실패는 4xx/5xx로 응답").

### 8.2 서명 형식 · 재생 방지(`signature.ts` — 순수)

- `signedPayload = "<t>." + <raw body 문자열>`(UTF-8) · `v1 = hex(HMAC-SHA256(key = UTF-8(비밀 문자열), signedPayload))` · `t` = **발송 시점** unix 초(시도마다 새로 — 본문은 불변).
- 받는 쪽 검증(연동 가이드 예시 코드): ① 헤더 파싱 ② `|now − t| ≤ 300초`(재생 창) ③ 같은 식으로 계산해 **상수 시간 비교** ④ `X-Chatbot-Delivery`를 처리 목록에서 확인(재생·중복 제거). **본문을 재직렬화하지 말고 받은 원시 바이트로 검증**한다.
- 비밀 최소 길이 32자 — 미만이면 대상 상태 `signingWeak`(경고 — 기동 실패 아님 · NFR-WFS4). 비밀 교체는 환경변수 변경·재기동 → 다음 시도부터 새 비밀(EX-WF-16). 이중 서명(교체 창)은 2차(K-9).

### 8.3 멱등키

`deliveryId` = `WorkflowRun.id`(적재 시 앱 선발급 uuid v4) — 봉투 `deliveryId`·`X-Chatbot-Delivery`·`Idempotency-Key`가 같은 값이고 **자동 재시도·임대 회수 재발송·수동 재발송 모두 불변**이다. 다른 턴의 같은 폼 재제출은 새 `deliveryId`(EX-WF-11 — 업무 키 중복 판단은 받는 쪽).

### 8.4 비밀 · 인증 · 비밀 주소(`workflow-secret.resolver.ts` — 읽기 1파일)

- `get(ref)`: `process.env['WORKFLOW_SECRET__' + ref]`(REF 정규식 재검증 · 빈 문자열 = 없음) · `status(ref)`: `NOT_REQUIRED｜CONFIGURED｜MISSING` · `isWeak(ref)`.
- 발송 직전 필요한 비밀이 없으면 송신 없이 `FAILED(PERMANENT_ERROR)` · `lastOutcome = SECRET_MISSING`(재발송은 환경변수 설정·재기동 뒤 — AC-WF4-9).
- 비밀 주소: 파싱 → 스킴(https · `WORKFLOW_ALLOW_HTTP`일 때 http) → 사용자정보 금지 → **호스트(소문자·punycode)·포트가 `baseUrl`과 같아야** 한다(다르면 `TARGET_HOST_MISMATCH` — AC-WF4-8 · FR-WF1-4). 쿼리(서명 토큰)는 허용하되 어디에도 기록하지 않는다(로그에는 호스트만).
- 비밀 값은 리졸버 밖으로 문자열 반환되는 경로가 **발송기 1곳**뿐(W-1 · NFR-WFS1 — 가짜 비밀 전수 grep 시험).

### 8.5 연동 가이드(deployment-engineer 인계 — `docs/05-ops/업무자동화_연동가이드.md`)

봉투 v1 계약 · 서명 검증 예시(Node·Python·C#) · 중복 제거(`deliveryId` 보관 기간 ≥ 재시도 창 3시간 + 수동 재발송 창 7일) · 재시도 표 · 실패 응답 규칙(4xx/5xx) · Power Automate류 "비밀 주소" 설정 · 폐쇄망 중계 서버 · 거버넌스 허용 목록 등록 · 사설 대역 허용 목록.

---

## 9. 출구 게이트 편입(No.45) · SSRF

### 9.1 레지스트리 6번째 클래스

```ts
// common/egress/egress-registry.ts
{
  exitId: 'WORKFLOW_WEBHOOK',
  files: ['workflow/dispatch/workflow-http.sender.ts', 'legacy-api/transport/node-http.transport.ts', 'legacy-api/transport/node-dns.resolver.ts'],
  dataKind: 'WORKFLOW_PAYLOAD',
  masked: 'PER_TARGET',                  // EgressExitDef.masked 유니온 +1(응답 스키마의 exits[]에는 나타나지 않는다 — §9.6)
  label: '업무 자동화 웹훅',
}
```

- 공유 전송·DNS 파일을 `LEGACY_API`와 **두 클래스 모두에** 나열한다 — "이 파일로 무엇이 나가는가"를 레지스트리가 사실대로 말한다. 정적 검사 G-1은 파일 집합(Set)이라 중복 나열의 영향이 없다.

### 9.2 G-1 · G-2 준수 — "레지스트리 = 송신 파일 집합" · 가드 선행

| 검사 | 이 그룹의 충족 |
|---|---|
| **G-1**(`governance-sealing.spec.ts` 144~170행: 출구 문자열 `fetch(`·`http.request(`·`https.request(`·`node:dns` 보유 파일 ⊆ 레지스트리, 레지스트리 파일 존재) | 발송기는 출구 문자열을 쓰지 않고 공유 전송 포트(`this.transport.request(`)를 호출한다 — 그래도 **레지스트리에 등록**해 G-2의 대상이 되게 한다(등록하지 않으면 G-1은 통과하지만 가드 검사를 피하는 구멍이 된다 — W-2가 "`transport.request(` 호출 파일 ⊆ 레지스트리"를 추가 단언). 새 `fetch(`·`node:http(s)`·`node:dns` 보유 파일 0 |
| **G-2**(172~248행: 레지스트리 각 파일의 가드 수 ≥ 송신 수 · 순서) | 발송기: `checkEgress('WORKFLOW_WEBHOOK', url)`(DNS 조회 **전**) 1회가 `transport.request(` 1회보다 앞 · 전송 파일: 기존 `checkEgress(req.exitId ?? 'LEGACY_API', req.url)` 1회가 `transport.request(` 앞(수·순서 불변) |

### 9.3 모드 ON 리다이렉트 차단(I-11) · 모드 OFF

- 공유 전송은 `node:http(s).request`라 **리다이렉트를 원래 따라가지 않는다** — 3xx는 전송이 `REDIRECT_NOT_ALLOWED`로 끝낸다(`node-http.transport.ts` 78~81행). 따라서 거버넌스 모드 ON의 "리다이렉트로 게이트 우회 금지"(I-11 — `fetch` 출구용 `egressRedirectMode()`)는 **모드와 무관하게 구조적으로** 충족되고, 웹훅은 모드 OFF에서도 3xx = 영구 실패다(FR-WF5-4 · AC-WF5-3).
- 모드 OFF: `checkEgress()`는 URL 파싱 없이 `ALLOWED`(ADR-0040 규약) — 모드 OFF 설치의 추가 비용 0.

### 9.4 ★ SSRF 재사용 방식 — C-2 해소

**결정: No.26 부품을 이동 없이 두 번째 DI 토큰으로 등록한다.**

```ts
// workflow.module.ts providers
{ provide: WORKFLOW_TRANSPORT, useClass: NodeHttpTransport },    // legacy-api/transport/node-http.transport.ts (클래스 파일 import — LegacyApiModule import 0)
{ provide: WORKFLOW_DNS_RESOLVER, useClass: NodeDnsResolver },    // legacy-api/transport/node-dns.resolver.ts
// 발송기: import { classifyAddress, isAddressAllowlisted, isHostnameAllowlisted, parseAllowlist } from '../../legacy-api/lib/ip-policy';
```

발송기(`workflow-http.sender.ts`) 순서 — ADR-0034 §4 방어 층 전부:

1. 주소 결정(비밀 주소 포함) · URL 재파싱 동일성 · 스킴·사용자정보 검사 → 실패 `INVALID_TARGET_URL`.
2. **`checkEgress('WORKFLOW_WEBHOOK', url)`** → `BLOCKED` = `EGRESS_BLOCKED`(송신 0 · DNS 0 — AC-WF5-1).
3. IP 리터럴이 아니면 `dnsResolver.lookupAll(host)` **1회** → 빈 결과 = `NETWORK_ERROR`(재시도).
4. **모든 주소** 판정: `ABSOLUTE_BLOCKED`(루프백·링크로컬·메타데이터·미지정 등 — 어떤 설정으로도 열 수 없음) → `BLOCKED_ADDRESS` · `PRIVATE`는 `WORKFLOW_PRIVATE_ALLOWLIST`(주소·호스트 규칙 — 레거시 목록과 **별도**)에 있을 때만(AC-WF5-2).
5. 헤더 조립(§8.1 · 인증·서명) — 비밀 없음 = `SECRET_MISSING`.
6. `transport.request({ url, method: 'POST', headers, body, pinnedAddresses, hostname, timeoutMs: min(target, MAX), maxBytes: 4096, exitId: 'WORKFLOW_WEBHOOK', responseMode: 'STATUS_ONLY' })` — 검증 주소로만 연결(커스텀 `lookup`) · SNI·인증서 검증은 호스트명 · 단일 데드라인 · 연결 재사용 없음.

**전송 포트 선택 필드(기본값 = 현행 동작 — 레거시 호출부·spec 무수정)**:

```ts
// legacy-transport.port.ts
export interface LegacyTransportRequest { ...기존; exitId?: EgressExitId; responseMode?: 'BODY' | 'STATUS_ONLY' }
export type LegacyTransportResult =
  | { kind: 'RESPONSE'; status: number; contentType?: string; bytes: number; body: Buffer; retryAfter?: string }   // retryAfter는 STATUS_ONLY일 때만
  | { kind: 'ERROR'; ... };
// node-http.transport.ts: checkEgress(req.exitId ?? 'LEGACY_API', req.url) · STATUS_ONLY = 헤더 수신 시 상태 확정 → 본문 maxBytes까지 소비 후 destroy → body 빈 버퍼
```

| 대안 | 판정 |
|---|---|
| ① 전송·DNS·IP 정책을 `common/outbound/`로 이동해 공용화 | 기각 — L-2 경로 문자열·레지스트리 `LEGACY_API` 파일 목록·기존 spec import가 바뀌고 효과는 결정과 같다(재검토 트리거: 세 번째 공유 출구) |
| ② 발송 전용 전송 파일(`node:http` 두 번째 import) | 기각 — L-2 완화 + SSRF 코드 두 벌 |
| ③ `fetch` + `redirect:'manual'` | 기각 — DNS 주소 고정 불가(재바인딩) |
| **④ 이동 없는 두 번째 토큰 + 선택 필드 2(채택)** | L-2(`node:http(s)`·`node:dns` import 1파일씩)·L-4(`LegacyApiHttpClient` 주입 1파일)·L-6·L-10 **불변** · SSRF 코드 1벌 · FR-WF6-4 "레거시 연결 없이 호출하는 경로가 생기지 않게" = 발송기는 `LegacyApiHttpClient`·`ValidatedLegacyRequest`를 쓰지 않고 자기 검증을 거친 요청만 만든다(W-12) |

### 9.5 저장 시 호스트 검사(FR-WF1-6 · EX-WF-20·22)

대상 생성·`baseUrl` 수정 시 URL 정규화(소문자·punycode — `new URL`) → 모드 ON이면 `checkEgress('WORKFLOW_WEBHOOK', baseUrl)` 목록 밖 = `400 EGRESS_HOST_NOT_ALLOWED`(ADR-0040 재사용) · `http:`인데 `WORKFLOW_ALLOW_HTTP=false`면 `400 VALIDATION_FAILED`. 모드 ON 전환 후 목록 밖이 된 기존 대상은 저장 재검사·발송 시 `EGRESS_BLOCKED`·목록 "차단" 표시.

### 9.6 데이터 지도(FR-WF4-8 · AC-WF5-4)

`GovernanceMapService.buildEgress()`: `exits`는 **레거시와 같이** DB 결정 출구를 제외하므로 `WORKFLOW_WEBHOOK`도 제외(배열 바이트 불변) · 대상이 1개 이상일 때만 선택 키

```ts
egress.workflowTargets?: [{ targetId, name, host, enabled, paused, decision: EgressDecision, allowRawPersonalData, failedLast24h, payloadRetained }]
risks.rawPersonalDataWorkflowTargets?: number
```

— 대상 0개 설치의 지도 응답은 바이트 동일(FR-0-172). 화면: "업무 자동화 웹훅 · 대상 N(허용 · 차단) · 송신 데이터 = 폼 값·이벤트 메타데이터 · 마스킹 = 대상별(원문 허용 N) · 본문 일시 보관(실패 보관 N건)".

---

## 10. 필드 암호화 · 보존 · 파기(No.45 상호작용)

### 10.1 발송함 본문 = 암호화 대상 4번째(C-5 · FR-WF4-6 · AC-WF5-5)

- `EncryptedFieldId` +`WORKFLOW_PAYLOAD` · `ENCRYPTED_FIELDS` += `{ table: 'workflow_runs', column: 'payload' }` → AAD = `workflow_runs:payload:<runId>`(행 id 앱 선발급).
- 봉인 = 적재 writer 1파일(`sealField('WORKFLOW_PAYLOAD', id, envelopeJson)`) · 개봉 = 발송함 store 1파일(선점 행 읽기 시 `openField`). 모드 OFF·키 없음 = 평문 그대로(ADR-0040 기본값 규약).
- 개봉 결과가 `DECRYPT_FAILED_TEXT`(키 없음·태그 불일치)면 **송신하지 않고** `FAILED(PERMANENT_ERROR)` + `lastOutcome = null` + 경고 로그(행 id·키 id만)로 종결한다 — 깨진 본문을 외부로 보내지 않는다(본문은 보관 → 키 복구 후 재발송 가능).

### 10.2 키 교체와의 관계

- 발송함 본문은 **백필·재암호화 잡(`field-crypto.job.ts` `ALL_FIELDS`) 대상이 아니다** — 성공 즉시·실패 7일 뒤 사라지는 일시 데이터이며, 잡의 커서·통계·writer 봉인(G-8)을 늘릴 가치가 없다.
- 대신 부트스트랩 "옛 키 필요 행" 검사(`ENCRYPTED_COLUMNS`)에 포함한다 — 실패 보관 본문이 옛 키로 남았는데 키를 빼면 **기동 실패**(암호문 유실 방지). 운영 절차: 새 키 추가 → 실패 보관 기간(7일) 경과 또는 해당 실패 건 처리 → 옛 키 제거.
- 암호화를 켜기 전에 적재된 대기 본문은 평문으로 남는다(최대 보관 7일 — K-6).

### 10.3 보존 = `CALL_LOGS` 편입(FR-WF4-7 · AC-WF5-6)

- 파기 잡 writer `deleteCallLogsBatch(cutoff)`에 3번째 테이블: `workflowRun.findMany(where createdAt < cutoff ∧ status ∈ {SUCCEEDED, FAILED, SKIPPED, CANCELLED, EXPIRED}) take batch → deleteMany(id IN)` — **대기·보류·발송 중 행은 파기하지 않는다**. 보존 종류 신설 0 · 기본 무기한 = 현행.
- 미리보기(`retention-policy.service.ts` `CALL_LOGS` 건수)에 같은 조건의 `count` 추가. 라벨 "호출 로그" → "호출·발송 로그"(웹).
- `FAILED` 행이 보존기간(최소값 이하)보다 먼저 파기되면 본문도 함께 사라진다(재발송 불가 — 정상).

### 10.4 영구삭제(EX-WF-19 · ADR-0002)

챗봇 영구삭제 트랜잭션에 `tx.workflowRun.deleteMany({ where: { chatbotId: id } })` · `tx.workflowSubscription.deleteMany({ where: { chatbotId: id } })`(챗봇 삭제 직전 — 20 → 22테이블) · 사전검사 15종 불변. 대기 건도 함께 삭제되며 삭제 확인 화면이 "대기 N건 취소"를 보인다(프런트가 챗봇 이력 요약으로 조회). `WorkflowTarget`은 전역이라 무관.

---

## 11. PII 마스킹 · 원문 허용 · 금지어

### 11.1 필드 값 가공(`field-values.ts` — 순수)

순서: ① 제어 문자 제거(`\p{Cc}` 중 `\t` 외) ② 500자(코드 포인트) 절단 ③ `SLOT` ∧ `!target.allowRawPersonalData` → `maskPii(value).maskedText`(1벌 · `PII_MASK_MODE` 반영 — EX-WF-21) · 바뀌었으면 `personalDataMasked = true` ④ `CONST`는 마스킹하지 않는다(관리자 작성 — No.26 규약). **ADR-0013 5번째 적용 지점**(저장·RAG·증강·레거시·**웹훅**).

### 11.2 원문 허용(FR-WF1-5 · NFR-WFS7)

- `allowRawPersonalData=true`로 생성·변경할 때 `confirmRawPersonalData`가 대상 이름(정규화 비교)과 다르면 `400 CONFIRM_NAME_MISMATCH` · ADMIN(`security:write`) · 감사 `UPDATE` before/after(`allowRawPersonalData`).
- 콘솔·데이터 지도·노드 편집기(배지)·설계 점검(`WORKFLOW_RAW_PERSONAL_DATA`)·시뮬레이터(`rawPersonalData`)에서 **항상 표시**.

### 11.3 어디에도 남지 않는 것

실행 이력 행(메타데이터)·서버 로그·감사 요약·trace·오류 응답에는 필드 **값**·본문·`sessionId` 원값·비밀이 없다(필드 **이름**·`personalDataMasked`만 — FR-0-176 · W-5·W-6·W-14). 발송함 `payload`만 일시 예외(§7.8).

### 11.4 금지어 필터 — 봉투 비적용 확정(FR-WF4-5)

금지어 필터는 **사용자에게 보이는 출력**(출구)과 **저장 로그**의 규약이다. 봉투는 사용자 출력이 아니라 업무 데이터이며, 금지어 마스킹이 결재 사유·티켓 본문을 바꾸면 업무가 왜곡된다. No.26 레거시 송신과 같은 판단으로 **적용하지 않는다**(요구사항 ⚠ 재확인 완료).

---

## 12. 관리 API

### 12.1 엔드포인트(관리자 21 핸들러 · `@Public()` 0)

| 메서드 · 경로 | 권한 | 용도 |
|---|---|---|
| `GET /workflow-targets` | `security:read` | 대상 목록(상태 요약 — FR-WF1-9) |
| `POST /workflow-targets` | `security:write` | 생성(출구·http·원문 확인) |
| `GET /workflow-targets/picker` ⚠ `:id`보다 먼저 | `dialogue:read` | 선택 목록(이름·사용·정지·준비 여부·원문 허용 — **주소·ref 없음**, AC-WF7-2) |
| `GET /workflow-targets/:id` | `security:read` | 상세 |
| `PATCH /workflow-targets/:id` | `security:write` | 수정(사용 여부 포함 · 원문 허용은 확인 문자열) |
| `DELETE /workflow-targets/:id` | `security:write` | 삭제(§12.3) |
| `POST /workflow-targets/:id/test` | `security:write` | 테스트 발송(§13.5) |
| `POST /workflow-targets/:id/pause` · `/resume` | `security:write` | 대상 정지·재개 |
| `GET /workflow-runs` · `GET /workflow-runs/summary` | `security:read` | 전역 이력·요약 |
| `GET /chatbots/:chatbotId/workflow-subscriptions` | `chatbot:read` + `dialogue:read` | 구독 목록 |
| `POST /chatbots/:chatbotId/workflow-subscriptions` | `chatbot:write` | 생성(챗봇당 ≤20) |
| `PATCH｜DELETE /chatbots/:chatbotId/workflow-subscriptions/:subscriptionId` | `chatbot:write` | 수정·삭제 |
| `POST …/workflow-subscriptions/:subscriptionId/pause` · `/resume` | `chatbot:write` | 구독 정지·재개 |
| `GET /chatbots/:chatbotId/workflow-runs` · `…/workflow-runs/summary` | `chatbot:read` + `dialogue:read` | 챗봇 이력·요약 |
| `POST /chatbots/:chatbotId/workflow-runs/retry` · `…/cancel` | `chatbot:write` | 재발송·취소(≤100) |

- 동작 경로 `POST …/pause｜resume｜retry｜cancel`은 No.45 `…/pending/cancel` 관례(비-GET 상태 변경 — CSRF 규약).
- 컨트롤러 3개(`WorkflowTargetsController`·`WorkflowRunsController`·`ChatbotWorkflowController`) — 등록 컨트롤러 37 → 40(X-1).

### 12.2 요청·응답 요점

- 목록 응답: 대상 목록 `{ items }`(전역 설정 — 페이지네이션 없음, 상한 200) · 이력 `{ items, total, page, pageSize }`(기본 `createdAt desc, id desc` 고정 · 기간 기본 최근 7일 KST · 최대 90일 초과 `400 STATS_RANGE_TOO_WIDE` 재사용 · `from`/`to`는 오프셋 포함 ISO).
- 이력 조회는 `select` 허용 목록으로 **`payload` 컬럼을 읽지 않는다** — `retryable = status === 'FAILED' && payloadBytes !== null && payloadPurgedAt === null` · `payloadPurged = payloadPurgedAt !== null`(본문을 만든 적 없는 `SKIPPED`·`TEST` 행은 `payloadBytes = null`).
- 챗봇 스코프: 교차 챗봇 `subscriptionId`·`runId` = `404` · `ARCHIVED` = 구독 조회·이력·요약·재발송·취소 허용, 구독 생성·수정·삭제·정지·재개 `409 CHATBOT_ARCHIVED`.

### 12.3 대상 삭제 판정(FR-WF1-8 · R-8)

1. `ReferenceCheckService.assertWorkflowTargetDeletable(targetId)` — 전 챗봇 **초안 노드**(`dialogNode.findMany where outputs contains targetId` → 파싱 후 `type==='WORKFLOW' && payload.targetId===targetId` 재확인)
2. 구독 `count(targetId)`
3. 하나라도 있으면 `409 WORKFLOW_TARGET_IN_USE`(`details[]` 최대 5 — "챗봇명 › 노드명"·"챗봇명 › 이벤트 구독: 상담 종료", `chatbotId` 동봉 — No.26 M-2 형식)
4. 없으면 트랜잭션: 그 대상 `PENDING｜HELD` → `CANCELLED(TARGET_DELETED)`(본문 소거 — EX-WF-17) + 대상 삭제 → 커밋 후 감사 · 구독 캐시 무효화.

- **운영/스테이징 스냅샷 참조는 검사하지 않는다**(V-7 봉인 · No.26 선례) — 그 버전이 서빙 중이면 실행 시 `SKIPPED(TARGET_UNAVAILABLE)` + 요약 경고, 복원·전환 미리보기가 경고한다(§16). 콘솔 삭제 확인 창 안내: "운영 중인 버전이 이 대상을 쓰고 있으면 전송이 건너뛰어집니다 — 먼저 '사용 안 함'으로 영향을 확인하세요".

### 12.4 오류 코드(`ApiErrorCode` 신규 2종)

| 코드 | 상태 | 상황 |
|---|---|---|
| **`WORKFLOW_TARGET_IN_USE`** | 409 | 초안 노드·구독이 참조하는 대상 삭제(`details[]`) |
| **`WORKFLOW_RUN_NOT_RETRYABLE`** | 409 | 재발송 대상에 본문 소거·비`FAILED` 건 포함(`details[]` = id·사유) |
| (재사용) `INVALID_REFERENCE` | 404 | 노드 저장의 없는 `targetId` · 구독의 없는 대상 |
| (재사용) `OUTPUT_PAYLOAD_INVALID` | 400 | 노드당 `WORKFLOW` 4개 이상(EX-WF-8) |
| (재사용) `VALIDATION_FAILED` | 400 | zod(필드 이름 중복·패턴·조건 키) · http 불허 |
| (재사용) `EGRESS_HOST_NOT_ALLOWED` · `CONFIRM_NAME_MISMATCH` | 400 | 모드 ON 호스트 · 원문 허용 확인 불일치 |
| (재사용) `DUPLICATE_NAME` · `LIMIT_EXCEEDED` | 409 | 대상 이름·같은 챗봇·이벤트·대상 구독 중복 · 구독 20 초과 |
| (재사용) `BULK_SIZE_EXCEEDED` · `INVALID_STATUS_TRANSITION` · `STATS_RANGE_TOO_WIDE` | 400 | 재발송·취소 >100 · 취소 불가 상태 · 이력 기간 >90일 |
| (재사용) `RATE_LIMITED` | 429 | 테스트 발송 분당 5 초과 |
| (재사용) `CHATBOT_ARCHIVED` · `NOT_FOUND` | 409 · 404 | 보관 챗봇 구독 쓰기 · 교차 챗봇 |

요구사항 제안 `WORKFLOW_OUTPUT_INVALID`는 기존 코드로 흡수(제약 ⑦ · R-3). **공개 대화 경로는 이 코드들을 쓰지 않는다** — 적재 실패·건너뜀은 응답에 드러나지 않는다.

### 12.5 기존 경로 확장

| 경로 | 확장 |
|---|---|
| 노드 저장(생성·수정·복사) | `WORKFLOW` 대상 존재 검사(`404 INVALID_REFERENCE`) · 노드당 ≤3(`400 OUTPUT_PAYLOAD_INVALID`) — 복사·토픽 분리·챗봇 복사는 아웃풋을 그대로 복사(대상 전역 · 슬롯 `contextVariableId`는 기존 UUID 잎 재매핑 규칙 — FR-WF2-9) |
| `POST …/dialog-nodes/validate` | 설계 점검 규칙 5종(§5.7) |
| `POST …/simulate` | 응답 `workflowSteps?`(§13.6) · `compare`·TC = 무시(응답 불변) |
| 복원 미리보기 · 운영 전환 미리보기 | 경고 `WORKFLOW_TARGET_MISSING`·`WORKFLOW_TARGET_DISABLED`(blocker 아님) |
| `GET /governance/map` · 보존 미리보기 | §9.6 · §10.3 |

---

## 13. 운영 — 이력 · 재발송 · 정지 · 테스트 · 경고 · 통계

### 13.1 실행 이력(FR-WF7-1 · AC-WF6-4)

열: 발생 시각(KST) · 챗봇 · 트리거(노드 이름·동작 키 또는 이벤트 라벨 — 노드 이름은 조회 시점 해석, 없으면 "삭제된 노드") · 대상 이름 스냅샷 · 상태·사유(텍스트 라벨) · 시도 수 · 마지막 결과 코드·HTTP 상태·지연 · 다음 시도(KST) · `deliveryId` 앞 8자 + 복사 · 필드 **이름** · 마스킹 여부 · 재발송 가능 여부. 필터: 대상·챗봇(전역)·트리거·이벤트·상태·기간·재발송 가능만.

### 13.2 재발송 · 취소 · 정지

§7.6·§7.7. 결과는 `aria-live="polite"` 1회("5건을 다시 보냈어요").

### 13.3 경고(FR-WF7-6)

`summary.attention`: 연속 실패 대상(≥10) · 실패 보관 건수 · 비밀 미설정 대상을 참조하는 노드/구독 수 · **가장 오래된 대기 분**(`PENDING ∧ nextAttemptAt < now − 3×주기` — 발송 루프가 없는 인스턴스만 있을 때 드러난다, EX-WF-23 · 예약 배포 "기한 넘긴 PENDING" 선례) · 최근 24시간 적재 실패 수. 콘솔: `설정 > 업무 자동화` 배지(전역 — ADMIN) · 챗봇 > 업무 자동화 탭 배지(챗봇 요약). 챗봇 목록·대시보드 배지는 1차 범위에서 **챗봇 목록 API를 바꾸지 않는다**(바이트 불변 — K-8).

### 13.4 요약 통계(FR-WF7-7)

`days = 7｜30` · 기간 = KST 일 버킷(`dayBucket`) · 대상별·이벤트별 발생·성공·실패·건너뜀·취소·만료 · 재시도율(시도 수 > 1인 종단 비율) · **P95 전달 지연**(성공 행 `deliveryLatencyMs` — 최근 10,000행 표본, 초과 시 `approximated: true`) · 일별 추이. 쿼리: `groupBy(dayBucket, status)` 1 + `groupBy(targetId, eventType, status)` 1 + 지연 표본 1 + attention 3 = **≤6쿼리**. No.14/29 통계 화면은 변경하지 않는다.

### 13.5 테스트 발송(FR-WF1-7 · AC-WF6-5 · EX-WF-25)

- 동기 1회 · 재시도 없음 · 실제 경로(출구 게이트·SSRF·서명·타임아웃 동일) · 대상 꺼짐·정지여도 허용(`targetDisabled`·`targetPaused` 안내).
- 봉투: `eventType: 'TEST'` · `test: true` · `chatbot/channel/sessionRef = null` · `action.key` = 요청값 또는 `"test.ping"` · `fields` = 이 대상을 참조하는 초안 노드들의 필드 **이름** 합집합(≤20) + 값 `"예시"`.
- 기록: `WorkflowRun`(`triggerKind TEST` · `chatbotId null` · 종단 상태 · **본문 비저장**) — writer의 `recordTestRun()`. 대상당 분당 5회(인스턴스 로컬 토큰버킷 `common/rate-limit` 재사용) 초과 `429 RATE_LIMITED`.
- 응답: `{ runId, outcome, httpStatus?, latencyMs, attempted, targetDisabled, targetPaused, blockedAddress?, guidance }`(안내 문구 = No.26 `guidanceFor` 표현 규약) · 받는 쪽 응답 본문 미반환.

### 13.6 시뮬레이터 모의(FR-WF2-7 · AC-WF2-5 · EX-WF-24)

- `workflowEvents`가 있으면 카탈로그 1회 조회로 `workflowSteps[]` 조립: 대상 이름·상태 · 동작 키 · 필드(**발송될 값** — §11.1 가공 결과: 원문 허용 대상은 원문 + `rawPersonalData: true`, 아니면 마스킹본) · `bindingMissing` · `mock: true`. **발송·적재 0**(시뮬레이터는 `WorkflowTriggerService`를 주입하지 않는다 — W-9).
- 시뮬레이터의 LIVE API 모드(`SIMULATION_LIVE`)여도 웹훅은 발송하지 않는다(실발송 확인 = 테스트 발송 — J-13). 오버레이로 추가한 `WORKFLOW`도 모의만.
- 관리자 본인이 방금 입력한 값의 표시는 ADR-0013 §5 예외 범위(시뮬레이터)다.

---

## 14. 권한 (P-8 — 신규 권한·역할 0)

| 동작 | 권한 | VIEWER | EDITOR | AGENT | ADMIN |
|---|---|---|---|---|---|
| 대상 CRUD·원문 허용·테스트 발송·대상 정지 | `security:write` | ✗ | ✗ | ✗ | ✓ |
| 대상 목록·상세 · 전역 이력·요약 | `security:read` | ✗ | ✗ | ✗ | ✓ |
| 대상 선택 목록(picker) | `dialogue:read` | ✓ | ✓ | ✗ | ✓ |
| 노드 `WORKFLOW` 편집 | `dialogue:write`(노드 기존 권한) | ✗ | ✓ | ✗ | ✓ |
| 구독 조회 · 챗봇 이력·요약 | `chatbot:read` **AND** `dialogue:read` | ✓ | ✓ | **✗**(제약 ③) | ✓ |
| 구독 CRUD·정지·재개 · 재발송·취소 | `chatbot:write` | ✗ | ✓ | ✗ | ✓ |
| 시뮬레이터 모의 표시 | `simulation:read`(기존) | ✓ | ✓ | ✗ | ✓ |

- `@RequirePermission('chatbot:read', 'dialogue:read')`(No.25 AND) — `Permission` 18종·역할 4종 불변(`permission-matrix.spec.ts`·E-14·T-10 불변).
- AC-WF7-1: EDITOR 대상 생성·원문 허용·테스트 발송 `403` · VIEWER 조회만 · AGENT 전부 `403`.

## 15. 감사 (ADR-0016 규약 — 커밋 후 기록 · 화이트리스트 · 실패 흡수)

| 동작 | `AuditAction` | `AuditTargetType` | 요약·스냅샷 |
|---|---|---|---|
| 대상 생성·수정·삭제 | `CREATE`·`UPDATE`·`DELETE` | `WorkflowTarget` | 화이트리스트: `name`·`description`·`baseUrl`·`authType`·`authHeaderName`·`secretRef`·`signingEnabled`·`signingSecretRef`·`urlSecretRef`·`timeoutMs`·`maxAttempts`·`allowRawPersonalData`·`enabled` — ref **이름**만(값은 DB에도 없다 · FR-WF8-3) |
| 대상 정지·재개 | `STATUS_CHANGE` | `WorkflowTarget` | "일시 정지(보류 N건)" · "재개(발송 N · 만료 N)" |
| 구독 생성·수정·삭제 | `CREATE`·`UPDATE`·`DELETE` | `WorkflowSubscription` | `eventType`·`targetId`·`enabled`·`conditions` |
| 구독 정지·재개 | `STATUS_CHANGE` | `WorkflowSubscription` | 건수 |
| 재발송·취소 | `STATUS_CHANGE`(요약 1건 — `before/after` 없음) | `WorkflowRun` | 대상 id = 챗봇 id · "실패 5건 재발송(대상: 그룹웨어 결재 흐름)" |
| 테스트 발송 | `CREATE` | `WorkflowRun` | "테스트 발송 · 결과 SUCCESS · HTTP 202"(결과 코드만) |

- **발송 1건 1건은 감사가 아니다**(실행 이력 — ADR-0034 §6 선례 · AC-WF7-3). `AuditAction` 추가 0(16 — T-10 불변) · `AuditTargetType` 27 → 30.
- `AUDIT_FIELDS.WorkflowRun = []`(요약 전용) · 세 대상 모두 `payload`·`fields`·`value`·`sessionId`·비밀 값 필드명 0(W-6).

## 16. 버전 · 환경 · 복사 (P-10)

| 자산 | 취급 |
|---|---|
| 노드 `WORKFLOW` 아웃풋 | 대화 자산 → **스냅샷·차이·복원·환경 포인터 자동 포함** · `SNAPSHOT_SCHEMA_VERSION = 1` 유지 · **업캐스터 불필요**(읽기 스키마에 타입 추가뿐 — 과거 스냅샷엔 `WORKFLOW`가 없다) · 해시 규칙 불변 |
| `WorkflowTarget` | 전역 설정 → 스냅샷 밖(ApiConnection 선례) · 복원·운영 전환·예약 전환 미리보기에서 참조 대상 없음/꺼짐 = **경고**(blocker 아님) · 실행 시 `SKIPPED(TARGET_UNAVAILABLE)`(AC-WF7-4) |
| `WorkflowSubscription` | **환경 밖**(설문·상담 설정과 같은 J-15) — 저장 즉시 운영 반영 · 편집 화면에 "환경 분리 대상이 아닙니다 — 저장 즉시 운영에 적용" 안내 · 챗봇 복사·토픽 분리 비복사 |
| 운영 발송 | 환경 모드 챗봇의 공개 대화는 **운영 버전 번들의 `WORKFLOW`**로 발송(초안에만 추가한 아웃풋은 운영에서 0건 — AC-WF7-5) · 이력에 `servedVersionId` 기록(어느 버전 노드가 보냈는지) |

## 17. 봉인 · 정적 검사 — `apps/api/src/workflow/lib/workflow-sealing.spec.ts`

(검사 대상: `apps/api/src/**/*.ts` 중 `*.spec.ts`·`src/integration/**` 제외, 주석 줄 제외 — 기존 `*-sealing.spec.ts` 형식 · 스캔 0건 아님 가드 · 주요 단언은 **역검증 픽스처** 포함.)

| # | 단언 |
|---|---|
| W-1 | 문자열 `WORKFLOW_SECRET__` 보유 파일 = `workflow/secrets/workflow-secret.resolver.ts` 1개(`env.validation.ts`·엔진·웹 0) · `WorkflowSecretResolver` 주입 파일 = {`workflow-catalog.service.ts`, `workflow-http.sender.ts`, `workflow-targets.service.ts`} · `.get(` 호출은 발송기 1파일 |
| W-2 | `EGRESS_REGISTRY`에 `WORKFLOW_WEBHOOK` 존재 · 그 `files`에 발송기 포함 · **`transport.request(` 호출 파일 ⊆ 레지스트리 파일 집합**(G-1 보강) · 발송기에 `fetch(` 0 · 발송기의 `checkEgress('WORKFLOW_WEBHOOK'`이 `transport.request(`보다 앞(G-2 재확인) |
| W-3 | `workflowRun.create｜createMany` 호출 파일 = `triggers/workflow-run-enqueue.writer.ts` 1개 · `workflowRun.update｜updateMany｜upsert` = `core/workflow-run.store.ts` 1개 · `workflowRun.delete｜deleteMany` = {`governance/writer/governance-data.writer.ts`, `chatbots/chatbots.service.ts`} |
| W-4 | `workflowTarget` 쓰기 = {`workflow-targets.service.ts`, `workflow-run.store.ts`} · store의 `workflowTarget.update*` data 키 ⊆ {`consecutiveFailures`, `lastSuccessAt`, `lastFailureAt`} · `workflowSubscription` 쓰기 = {`workflow-subscriptions.service.ts`, `chatbots.service.ts`(deleteMany)} |
| W-5 | `workflow/**`·`common/workflow/**` logger 호출 인자에 `payload`·`fields`·`value`·`sessionId`·`secret`·`url`·`body`·`headers`·`.message` 식별자 0(휴리스틱) |
| W-6 | `AUDIT_FIELDS.WorkflowTarget｜WorkflowSubscription｜WorkflowRun`에 `payload`·`fields`·`value`·`sessionId`·`secret`(값) 필드명 0(ref 이름 키 `secretRef`류는 허용 목록) |
| W-7 | `schema.prisma`: 신규 3모델 `Cascade`/`SetNull` 0 · `WorkflowRun`에 `sessionId`·`userMessage`·`botResponse`·`text`·`fields`·`headers`·`url` 컬럼 0(텍스트 컬럼 허용 목록 = `payload`·이름/ref 스냅샷) · `WorkflowTarget`에 `secret` 값 컬럼 0(`*Ref`만) |
| W-8 | `packages/dialogue-engine/src`에 `webhook`·`hmac`·`workflowRun`·`WorkflowTarget`·`dispatch`·`deliveryId` 심볼 0 · `workflow-output.ts`에 L-5 금지 심볼 0 |
| W-9 | `validation`·`versions`·`deploy-schedules`·`stats`·`learning`·`topics`·`asset-transfer`·`governance`·`environment`에 `workflow/` import 0 · `simulation`·`dialog-nodes`의 `workflow/` import ⊆ `workflow/catalog/**` · `handoff`·`survey-responses`·`feedback`의 `workflow/` import ⊆ 모듈 파일의 `workflow/triggers/workflow-triggers.module`(서비스 파일은 `common/workflow/workflow-event.port`만) |
| W-10 | `workflow/**` `@Public()` 0 · 총 8(H-10·F-6과 같은 목록) |
| W-11 | `apps/widget/src`·`apps/ml-worker`에 `workflow`·`WORKFLOW_`·`webhook` 심볼 0 |
| W-12 | `workflow/**`의 `legacy-api/` import ⊆ {`transport/legacy-transport.port`, `transport/node-http.transport`, `transport/node-dns.resolver`, `lib/ip-policy`} · `LegacyApiHttpClient`·`LegacyApiService`·`ValidatedLegacyRequest`·`LegacyApiSecretResolver`·`LEGACY_API_SECRET` 심볼 0 |
| W-13 | `sealField('WORKFLOW_PAYLOAD'` 호출 파일 = 적재 writer 1개 · `openField('WORKFLOW_PAYLOAD'` = store 1개(G-5 목록과 일치) |
| W-14 | (런타임) `WorkflowEnvelopeV1Schema`·`WorkflowRunItemSchema`·`WorkflowStepViewSchema`·`WorkflowTargetPickerItemSchema` 키 집합 정확 일치 — 봉투·이력에 `sessionId`·`payload`, picker에 `baseUrl`·`*Ref` 없음 · `simulation.service.ts`가 `apiCall`·`workflowEvents`를 응답에 전개하지 않는다(`...result` 0) |
| W-15 | `drainForTest(` 운영 코드 호출 0 · `WorkflowModule` exports `[]` · `WorkflowTriggersModule` exports = {`WorkflowTriggerService`, `WORKFLOW_EVENT_SINK`} · `WorkflowCatalogModule` exports = {`WorkflowCatalogService`} |
| W-16 | 원천 4파일(`handoff-thread`·`survey-response`·`message-feedback`·`conversation-log`)의 포트 호출은 `emit(` 1종이며 `await` 0 · 각 파일 발행 문자열 `kind: '<이벤트>'` 개수 = 설계 표(§6.2) |
| W-17 | `jest.isolate-env.js`에 `WORKFLOW_DISPATCH_ENABLED = 'false'` · `workflow-dispatch.job.ts`가 `PollingLoop`를 쓰고 `setInterval(` 0 |
| W-18 | `$queryRaw`·`$executeRaw` 보유 파일 수 불변(4 · 0) · 신규 마이그레이션 SQL에 `DROP`·`ALTER TABLE`·`WHERE`(부분 인덱스) 0 |

## 18. 성능 예산 (NFR-WFP)

| 항목 | 예산 | 근거·측정 |
|---|---|---|
| 미사용 챗봇·`WORKFLOW` 없는 턴 | 지연 증가 0(오차 범위) · 공개 경로 추가 쿼리 **0**(구독 캐시 적중) | 키 존재 분기 1개 · `TURN_LOGGED`는 캐시 확인 후 즉시 반환 |
| `WORKFLOW` 턴 적재 | 추가 지연 **P95 ≤15ms**(방출 1건 = 3쿼리) · 외부 호출 0 | 기존 공개 대화 예산(500ms)의 별도 항목 |
| 이벤트 적재 | 원천 동작 추가 지연 **0**(fire-and-forget — 원천은 `emit()` 동기 반환) · 적재 자체 ≤10ms | 원천 응답 모양 불변 |
| 발생 → 첫 시도 | **P95 ≤10초**(주기 5초 · 받는 쪽 정상) | tick 시각 주입 시험 |
| 유휴 루프 | 1쿼리/주기(`(status, nextAttemptAt)` 인덱스) + 정리 2쿼리/60초 | NFR-WFP4 |
| 발송 부하(분당 600) | 공개 대화 P95 증가 <10% · **대화 로그 적재 유실 0** | 배치 20 · 발송 대기는 트랜잭션 밖 · 선점/종결 단문 — 실측 기록(SQLite 단일 작성자) |
| 관리 API | 이력 목록 P95 300ms(10만 행) · 요약 30일 P95 1초 · 대상 목록 P95 500ms(노드 1만) | 인덱스 §3.1 · `contains` 사전 필터 |
| 테스트 발송 | 대상 타임아웃 + 50ms | 동기 |

- **예산 미달을 이유로 주기·배치·타임아웃 기본값을 조용히 바꾸지 않는다** — 설계 문서 갱신 후 조정.

## 19. ★ 기능을 쓰지 않을 때 동작 불변 보장 (FR-0-172 · AC-WF1-1)

| 경로 | 미사용 동작 | 보장 장치 |
|---|---|---|
| 엔진 | `WORKFLOW` 없는 번들 → `workflowEvents` 키 부재 · `resumeState.workflow` 키 부재 · 출력·trace·상태 동일 | EN-1(기존 스위트 무수정) · EN-3·EN-4 |
| 공개 대화 | ④.7 분기 1개(키 없음 = 건너뜀) · 응답 스키마·바이트 불변(`workflowEvents`는 응답에 싣지 않는다) | 쿼리 수 시험(AC-WF1-1) · FR-WF10-3 |
| 로그 적재 · 상담 · 설문 · 평가 | `emit()` → 구독 캐시에 없음 = 즉시 반환(DB 0) · 포트 미주입 = no-op · 원천 트랜잭션·반환·예외 불변 | 원천 기존 spec 무수정(생성자 끝 `@Optional()`) · W-16 |
| 발송 루프 | 빈 발송함 1쿼리/주기 · `WORKFLOW_ENABLED=false`면 미시작 · 시험에서는 꺼짐 | `jest.isolate-env.js` |
| 레거시 API | 전송 선택 필드 기본값 = 현행(`exitId` 미지정 → `LEGACY_API` · `responseMode` 미지정 → `BODY`) | `legacy-api-*.spec.ts` 무수정 · L-1~L-14 불변 |
| 거버넌스 | 지도·보존 미리보기 선택 키 생략(대상·실행 0) · 암호화 필드 추가는 행 0이면 기동 검사 결과 동일 · 파기 잡의 3번째 삭제는 0행 | `governance-sealing.spec.ts` X-2 외 불변 |
| 버전·환경 | 경고 코드 추가는 참조 0이면 미발생 | 기존 복원·전환 시험 무수정 |
| 관리 API·통계·권한 | 신규 경로만 추가 · 기존 응답 불변 · 권한 18·역할 4·`AuditAction` 16 불변 | `permission-matrix.spec.ts`·T-10·E-14 |
| 위젯·ml-worker | 변경 0 | W-11 |

- **기준선**: 커밋 ②(호출부 없는 발송 기반) 적용 후 전 시험이 X-2·X-4 외 무수정 통과해야 하며, 커밋 ③·④는 §21.3 X 목록 외의 기존 시험을 바꾸지 않는다.

## 20. 관리자 콘솔 (ui-designer / frontend-implementer 인계)

1. **설정 > 업무 자동화**(ADMIN): 탭 ① 발송 대상(목록 — 사용·정지·비밀 상태(설정됨/미설정/약함 텍스트)·24시간 성공/실패·연속 실패·대기·보류·실패 보관·참조 노드/구독 수 · 등록/수정 폼(라벨 있는 필드 · 인증 방식별 조건부 필드 · "서명(받는 쪽이 진짜 우리 요청인지 확인하는 값)" 풀이) · 원문 허용 확인 창(초점 가두기·`Esc`·대상 이름 재입력 라벨·버튼 "원문 전송 허용") · 테스트 발송 결과 `aria-live`) ② 실행 이력(전역 — 필터·상태 텍스트 라벨+아이콘 대체 텍스트) ③ 요약(표 대체 동반 차트).
2. **노드 편집기 "업무 요청 보내기"**: 대상 선택(picker — 이름·상태 텍스트) · 동작 키 · 필드 표(이름 · 상수/폼 슬롯 라디오 · 슬롯 선택) · "이 아웃풋은 사용자에게 보이지 않습니다. 앞뒤에 안내 문구를 넣으세요"(스크린리더 읽힘 — NFR-WFA4) · 원문 허용 대상 배지 · 노드당 3개 상한 안내.
3. **챗봇 > 업무 자동화**: 이벤트 구독 표(이벤트 5종 × 대상 · 조건(연속 N · 구조 답 포함) · 사용 · 정지) + "환경 분리 대상이 아닙니다 — 저장 즉시 운영에 적용(다른 서버 인스턴스는 최대 30초)" · 챗봇 이력·재발송/취소 일괄(확인 창 버튼 "5건 재발송").
4. **시뮬레이터**: 결과 패널 "업무 요청(모의)" — 대상·동작 키·필드(발송될 값)·"원문 전송됨" 배지·"실제로 보내지 않았습니다".
5. **데이터 지도**: 업무 자동화 웹훅 행(§9.6). 보존 화면 라벨 "호출·발송 로그".
6. 문구(FR-0-182): "업무 자동화·발송 대상·업무 요청 보내기·이벤트 구독·실행 이력·재발송·일시 정지·테스트 발송" — "웹훅·HMAC·멱등키·발송함·백오프"는 짧은 풀이와 함께만. 상태는 색만으로 구분하지 않는다(NFR-WFA1). 위젯 변경 0.

## 21. 시험 전략 (test-automation 인계)

### 21.1 층별 핵심

| 층 | 핵심 |
|---|---|
| 엔진 | EN-1~EN-6(§5.8) — ★ AC-WF1-2 · AC-WF2-2 · AC-WF2-6 |
| 순수 함수 | 결과 분류 표 전부 · 백오프(지터 경계 — 난수 0/1 주입) · `Retry-After`(초·HTTP-date·과거·파싱 실패·상한) · 서명(★ AC-WF4-6 — 연동 가이드 예시 코드로 교차 검증 · 고정 벡터) · 봉투 조립(키 순서·`.strict()`·16KB) · 필드 가공(제어 문자·500자·마스킹·FULL) · `dedupeKey` · 세션 상한 · 선점 계획(정지·꺼짐·대상 동시·분당) · 연속 미응답(중립 턴·API 고정 문구 산입) · 구독 캐시 TTL(주입 시계) |
| 서비스(목) | 적재 분기(FEATURE_DISABLED·TARGET_UNAVAILABLE·BINDING_MISSING·RATE_LIMITED·PAYLOAD_TOO_LARGE·HELD·PENDING) · P2002 무시 · 재발송 전체 거부·경합 롤백 · 정지/재개 전이 표(§7.6) · 삭제 409 · 원문 허용 확인 |
| 발송기(전송·DNS 목) | 비밀 없음·호스트 불일치·http 불허 → 송신 0 · 절대 차단 대역(127.0.0.1·169.254.169.254·::1) → 사설 허용 목록에 넣어도 차단(★ AC-WF5-2) · 사설 허용 · DNS 재바인딩(해석 주소만 연결 — `pinnedAddresses` 단언) · 헤더 집합(서명·멱등키·인증 4종) |
| 통합(`migrate deploy` DB · 동적 import) | ★ AC-WF1-1(미사용 무변경 — 공개 경로 쿼리 수) · ★ AC-WF2-1/4(폼 완료 → 발송함 1행 · 수신 본문 마스킹) · AC-WF2-3/8 · ★ AC-WF3-1(상담원 종료 ∥ 정리 루프 시간 종료 동시 → 1행) · AC-WF3-2~6 · ★ AC-WF4-1(503·503·200 — `tick(now)` 반복, 같은 `X-Chatbot-Delivery` 3회) · AC-WF4-2/3/5/7~9 · ★ AC-WF4-4(앱 2개 동시 `tick()` → 전송 목 호출 수 = 행 수) · ★ AC-WF5-1(모드 ON 저장 400 · 목록에서 뺀 뒤 송신 0) · AC-WF5-3/5/6 · AC-WF6-1~6 · ★ AC-WF7-1(역할 4종 매트릭스) · AC-WF7-2~5 · ★ AC-WF1-3(W-1~W-18 + G·L 봉인) |
| 보안 | 가짜 비밀(`WORKFLOW_SECRET__T=fake-secret-<난수>`) 전수 grep — 로그·응답·DB 전 테이블·이력·감사(NFR-WFS1) · 가짜 개인정보 슬롯 값 grep(원문 허용 꺼짐 — 발송함 평문·이력·로그 0) |

### 21.2 시험 작성 원칙

- **★ 상대 시각 사용**: 최근 고정 날짜 픽스처가 시간이 지나 깨진 사례가 있었다. 시각 비교가 들어가는 픽스처(보류 24시간 만료·실패 본문 7일·세션 상한 10분·임대 60초·백오프·요약 7/30일·이력 기간 90일·`dayBucket`)는 **`now` 기준 상대값**(`new Date(now.getTime() − 25 * 3600_000)`)으로 만들고 **절대 날짜 리터럴을 쓰지 않는다**. `dayBucket` 기대값은 리터럴이 아니라 `toKstDayBucket(now)`로 계산한다. 잡·서비스는 `Clock`·`now` 인자를 주입받아 결정적으로 시험한다.
- **KST**: "하루" 경계(요약·이력 기본 기간)는 KST 자정 — 경계 직전·직후(UTC 14:59·15:00) 케이스를 넣는다. 봉투 `occurredAt`은 UTC `Z`임을 단언한다.
- **선택 env를 켜는 spec은 동적 import**: `WORKFLOW_DISPATCH_ENABLED`·`WORKFLOW_ENABLED=false`·`DATA_GOVERNANCE_MODE=ON`·`WORKFLOW_ALLOW_HTTP` 등은 `process.env` 설정 후 `await import('../app.module')`(정적 import spec의 `beforeAll` 설정은 무시된다 — CLAUDE.md). 루프 동작은 `WorkflowDispatchJob.tick()` **직접 호출**.
- **통합 DB = `prisma migrate deploy`**(원시 부분 유니크 4종 포함).
- **받는 쪽 = 전송 목**: 절대 차단 대역 때문에 루프백 목 서버로 실발송 시험을 할 수 없다 — `WORKFLOW_TRANSPORT`·`WORKFLOW_DNS_RESOLVER` 토큰을 목으로 덮는다(NFR-LM2 선례).
- **이벤트 발행 대기**: `WorkflowTriggerService.drainForTest()`로 fire-and-forget 적재를 기다린다(타이머 대기 금지).
- **boolean**: 환경변수 `envBoolean()` · 쿼리(`retryableOnly`) `queryBoolean()` — `"false"` 문자열 케이스를 넣는다.

### 21.3 ★ 의도된 기존 시험 기대값 변경 (닫힌 목록 — FR-0-180 확정)

| # | 파일 | 변경 | 이유 |
|---|---|---|---|
| **X-1** | `common/auth/public-decorator-count.spec.ts` | 등록 컨트롤러 37 → **40**(`WorkflowTargetsController`·`WorkflowRunsController`·`ChatbotWorkflowController` import·목록·제목 문자열) · `@Public()` 8 목록 **불변** | 신규 컨트롤러 |
| **X-2** | `governance/lib/governance-sealing.spec.ts` G-5 | `sealField(` 허용 파일 +`workflow/triggers/workflow-run-enqueue.writer.ts` · `openField(` 허용 파일 +`workflow/core/workflow-run.store.ts`(G-1 제목의 "6파일" 문자열은 선택 갱신 — 단언 로직 불변) | 발송함 본문 암호화(§10.1) |
| **X-3** | `chatbots/chatbots.service.spec.ts` | 트랜잭션 목 +`workflowRun.deleteMany`·`workflowSubscription.deleteMany` · 주석 "20 → 22테이블"(기존 단언 불변) | 동반 삭제 |
| **X-4** | `jest.isolate-env.js`(시험 인프라) | `process.env.WORKFLOW_DISPATCH_ENABLED = 'false'` | 백그라운드 루프 규약 |
| **X-5** | `environment/lib/environment-sealing.spec.ts` E-5 | `git status --porcelain`으로 `packages/dialogue-engine`의 미커밋 diff가 0인지 보던 검사를 제거하고, **골든 스냅샷 비교**(① `src/` 최상위 파일 목록 정적 스캔 ② 빌드된 `@chat-bot/dialogue-engine`의 `Object.keys(...)` 런타임 내보내기 심볼 집합)로 대체한다 — 두 스냅샷 모두 No.41이 늘린 최종 상태(파일 21개·내보내기 심볼 64개)를 승인값으로 고정한다. 역검증 픽스처(승인 목록에 없는 파일/심볼을 넣으면 실제로 실패하는지) 포함. | I-3 — No.26/No.27/No.41 순서로 엔진이 "의도된 예외"로 확장되며 커밋 전·부분 스테이징 중에도 항상 깨지는 작업 트리 의존 검사가 더는 목적에 맞지 않는다. 새 검사는 git 상태와 무관하게 엔진 표면 자체의 승인 여부만 본다 |

- **확인 항목(변경 예상 0)**: `legacy-api-sealing.spec.ts` L-1~L-14(L-2 `node:http(s)`·`node:dns` 1파일 불변 · L-4 불변 · L-5 엔진 I/O 0) · `governance-sealing.spec.ts` G-1(파일 집합 — 발송기는 출구 문자열 0)·G-2(가드 순서)·G-9·G-13·G-16·G-17 · `handoff-sealing.spec.ts` H-2·H-3·H-7·H-11·H-12 · `survey-sealing.spec.ts` S-2·S-6·S-11 · `feedback-sealing.spec.ts` F-2·F-7(`/handoff/` import 금지 — 포트는 `common/workflow`)·F-10·F-15 · `version-sealing.spec.ts` V-7(본문 테이블 참조 0) · `environment-sealing.spec.ts` E-14 · `topic-sealing.spec.ts` T-10(`AuditAction` 16) · `permission-matrix.spec.ts`(18) · 엔진 전 스위트 · `api-call.spec.ts`(기존 케이스) · 웹 `badges.spec.tsx`·`NodesListPage*.spec.tsx`(추가만).
- **픽스처 보강(단언 불변)**: 없음 예상 — 원천 4서비스의 생성자 인자는 전부 끝 `@Optional()`이다. 그 밖의 spec이 깨지면 **회귀로 취급하고 멈춘다**.

### 21.4 커밋 분할안

§2.6 ①~④(각 커밋 단독으로 전 시험 통과 · X-n은 해당 커밋에서만).

## 22. 요구사항 추적표 (요약)

| 요구사항 | 설계 |
|---|---|
| FR-0-172~174 · AC-WF1 | §19 · §5.8 · §17 W-10·W-11 |
| FR-0-175~176 · NFR-WFS1·2·6 | §8.4 · §11.3 · W-1·W-5·W-14 |
| FR-0-177 · FR-WF6-\* · AC-WF5-1~4 | §9 |
| FR-0-178 · FR-WF8-\* · AC-WF7-1~3 | §14 · §15 |
| FR-0-179 | §12.4(신규 2 · 흡수 1) |
| FR-0-180 | §21.3 X-1~X-5 |
| FR-0-181 | §3.4 · X-4 |
| FR-WF1-\* | §3.1 · §8.4 · §9.5 · §11.2 · §12 · §13.5 |
| FR-WF2-\* · AC-WF2-\* | §5 · §6.1 · §13.6 · §12.5 |
| FR-WF3-\* · AC-WF3-\* | §6.2~§6.5 |
| FR-WF4-\* | §4.3 · §8 · §10 · §11 |
| FR-WF5-\* · AC-WF4-\* | §7 · §8 |
| FR-WF7-\* · AC-WF6-\* | §7.6·§7.7 · §13 |
| FR-WF9-\* | §16 |
| FR-WF10-\* | §17 · §5.8 |
| NFR-WFP · NFR-WFR | §18 · §7.3 · §6.2 |
| NFR-WFA | §20 |
| NFR-WFM1~3 | 순수 lib 파일(§2.1) · 상수 1곳(§4.2) · ADR-0041 재검토 트리거 |

## 23. 알려진 제한

| # | 제한 | 수용 근거 |
|---|---|---|
| K-1 | 중복 전달 가능(최소 1회) | 받는 쪽 `deliveryId` 중복 제거가 계약(연동 가이드) |
| K-2 | 커밋 후 발행 전 강제 종료 시 이벤트 유실 | 감사 기록과 같은 수용 · 적재 예외는 요약 계수 |
| K-3 | 대상 동시·분당 상한은 다중 인스턴스에서 근사 | 발송 전담 인스턴스로 엄격화 가능 |
| K-4 | 구독 변경의 다른 인스턴스 수렴 ≤30초 | 상담 설정 캐시 선례 · 화면 안내 |
| K-5 | 발송 순서 보장 없음(백오프·다중 인스턴스) | 이벤트마다 `occurredAt` · 받는 쪽 정렬 |
| K-6 | 암호화 켜기 전 대기 본문은 평문(최대 7일) | 일시 데이터 · 백필 대상 제외 |
| K-7 | 운영 버전이 참조하던 대상의 삭제를 막지 않는다 | V-7 봉인 · 경고·건너뜀 기록 |
| K-8 | 챗봇 목록·대시보드 "확인 필요" 배지 없음(1차) | 챗봇 목록 API 바이트 불변 — 업무 자동화 메뉴·챗봇 탭 배지로 대체 |
| K-9 | 서명 비밀 교체 시 이중 서명 없음 | 교체 = 재기동 · 받는 쪽 이전/새 비밀 병행 검증 권고 |
| K-10 | 세션 상한은 새 탭·새 세션으로 우회 가능 | 익명 한계(ADR-0034 감수 비용과 같은 수용) · 받는 쪽 업무 키 |
| K-11 | 연속 미응답 창 30행 — 중립 턴이 많으면 과소 계수 | 알림 누락 쪽(보수적) |
| K-12 | 공유 전송 파일이 `legacy-api/` 아래 | 세 번째 공유 출구에서 이동(재검토 트리거) |

## 24. 요구사항 대비 해석 (architect 판단)

| # | 요구사항 | 해석·조정 |
|---|---|---|
| R-1 | FR-WF2-1 바인딩 `{ source: CONST｜SLOT }` | No.26 `ApiBindingSchema`(`kind`) **그대로** — 해석 함수·편집기 컴포넌트 1벌 |
| R-2 | FR-WF1-1 선택 목록 `dialogue:read`/`chatbot:read` | `dialogue:read` 단일(OR 가드 없음 · AGENT 배제) · 구독 화면도 이 목록을 쓴다 |
| R-3 | FR-0-179 신규 3종 | 신규 2종 · `WORKFLOW_OUTPUT_INVALID` → `INVALID_REFERENCE`(404)·`OUTPUT_PAYLOAD_INVALID`(400)·`VALIDATION_FAILED` 재사용 |
| R-4 | §5.2 부분 유일(마이그레이션 전용) | nullable `@unique dedupeKey`(원시 DDL 0) |
| R-5 | FR-WF3-5 "API 고정 문구 턴 제외" | No.24 `evaluateSessionAlert` 재사용 — **산입**(화면·웹훅 수치 일치) |
| R-6 | FR-WF5-3 "대상당 동시 SENDING ≤2(DB 계수 — 인스턴스 무관)" | DB 계수 기반이지만 tick 간 경합으로 **근사**(K-3) |
| R-7 | FR-WF6-3 구현 방식 | ④ 이동 없는 두 번째 토큰 + 선택 필드 2 · 사설 목록 별도 |
| R-8 | FR-WF1-8 스냅샷 참조 포함 | 초안 노드 + 구독만(V-7 · No.26) — 경고·건너뜀 |
| R-9 | FR-WF8-1 · FR-WF7-1 챗봇 이력 `chatbot:read` | `chatbot:read` AND `dialogue:read`(AGENT 배제) |
| R-10 | FR-WF4-6 암호화 "No.45 sealField 대상 +1" | 편입 + 백필/재암호화 잡 제외 + 기동 키 검사 포함 |
| R-11 | FR-WF9-4 `servedVersionId` | 기록 |
| R-12 | FR-WF9-1 업캐스터 | 불필요 |
| R-13 | FR-WF4-5 금지어 | 비적용 확정 |
| R-14 | FR-WF7-6 챗봇 목록·대시보드 배지 | 1차는 업무 자동화 메뉴·챗봇 탭 배지(K-8) |
| R-15 | FR-WF2-5 적재 실패 경고 | 로그 + 요약 `enqueueFailures24h`(적재 예외 계수 — 인스턴스 로컬 24시간 링 카운터) |
| R-16 | FR-WF7-3 재발송 "시도 수 초기화" | 초기화 + `manualRetryCount`·`X-Chatbot-Attempt` 1부터 |

## 25. GPU · 배포 형태

- **GPU 1**(카탈로그 2 → 하향, P-12): JSON 조립·HMAC-SHA256(발송 1건 1회)·HTTP 송신·DB 발송함 선점/갱신·마스킹(정규식) — 모델·학습·추론·임베딩 0 · ml-worker 변경 0. 2차 "상담 요약 첨부"(생성형)는 그 기능만 옵션 AI로 별도 평가.
- **구축형 ○**: 사내 결재·ITSM·메신저가 같은 망이면 사설 대역 허용 목록(`WORKFLOW_PRIVATE_ALLOWLIST`)을 운영자가 연다(절대 차단 대역 불가). 폐쇄망에서 클라우드 도구로 보내려면 외부 출구 또는 사내 중계 서버. 거버넌스 모드 설치는 허용 목록 등록 필수.
- **구독형 ○**: 고객 클라우드 도구로 즉시 · 고객 사내망은 고정 송신 IP·방화벽 개방 전제(No.26과 같은 조건) · 대상 전역 가시성은 멀티테넌시 그룹과 함께 재검토(ADR-0041 감수 비용 8).

## 26. 범위 밖 (재검토 트리거는 요구사항 §9 · ADR-0041)

인바운드 콜백·결과의 대화 표시 · 도구별 프리셋·전용 커넥터 · 내장 메일/SMS · 운영 이벤트(예약 실패·위험 동작·설문 임계·정기 리포트) · 대화 종료 이벤트 · 사용자 요청형 상담 이벤트 · 대화 발췌·상담 요약 첨부 · 노드 도달 구독 · PUT/PATCH/DELETE · 같은 턴 결과 사용(No.26) · 워크플로우 편집기 · LLM 도구 선택(No.31) · 실행 이력 CSV · 대상의 챗봇/그룹별 가시성 · 시도별 이력 테이블 · 이중 서명.

## 27. 구현 편차 기록(I-n)

| # | 내용 | 근거 | 영향 파일 |
|---|---|---|---|
| I-1 | `WorkflowStatusReason`에 `DECRYPT_FAILED`를 추가했다 — §10.1의 "개봉 결과가 `DECRYPT_FAILED_TEXT`면 송신하지 않고 `FAILED(PERMANENT_ERROR)`로 종결"을 `FAILED(DECRYPT_FAILED)`로 세분화한다(`lastOutcome`은 여전히 `null` — 송신 자체가 없었다, `firstSentAt` 미기록). 대상 카운터(`consecutiveFailures`)도 올리지 않는다(송신 시도가 아니므로). 본문은 그대로 보관(옛 키 복구 후 수동 재발송 가능 — §10.1 불변). | coordinator 지시(화면설계 계약) — 콘솔이 "받는 쪽 거부"와 "우리 쪽 키 문제"를 구분해 표시해야 한다 | `packages/shared-types/src/workflow.ts`(`WorkflowStatusReason`), `apps/api/src/workflow/core/workflow-run.store.ts`(`ClaimedRun.decryptFailed`·`finalizePermanent` 3번째 사유), `apps/api/src/workflow/dispatch/workflow-dispatch.job.ts`(`dispatchOne` 조기 분기) |
| I-2 | 챗봇 스코프 실행 이력 목록(`GET /chatbots/:chatbotId/workflow-runs`)이 전역 이력(`GET /workflow-runs`)과 **동일한** `WorkflowRunListQuerySchema`(`targetId` 포함)를 그대로 재사용한다 — 별도 스키마를 만들지 않는다. | coordinator 지시(화면설계 계약) — 두 목록 화면이 같은 필터 UI를 쓴다 | `packages/shared-types/src/workflow.ts`(`WorkflowRunListQuerySchema` — 변경 없음, 재사용 확인) · `apps/api/src/workflow/chatbot-workflow.controller.ts`(`listRuns`) |
| I-3 | `environment-sealing.spec.ts` E-5(엔진 미커밋 diff 0 — `git status --porcelain` 기반)를 **X-5**로 재설계했다. No.41이 엔진 변경을 세 번째 "의도된 예외"(No.26 API_CONDITION → No.27 SURVEY → No.41 WORKFLOW)로 공식화한 이상, 작업 트리 상태에 의존하는 검사는 커밋 전·부분 스테이징 구간에서 항상 실패하는 구조적 결함이 된다. 새 검사는 git과 무관하게 ① `packages/dialogue-engine/src` 최상위 파일 목록 ② 빌드 산출물이 런타임에 실제로 내보내는 심볼 집합(`Object.keys(dialogueEngine)`)을 **골든 스냅샷**과 비교한다 — No.41 반영 후 최종 상태(파일 21개·심볼 64개)를 승인값으로 고정하고, 역검증 픽스처로 검사 자체의 탐지력을 확인한다. `docs/02-spec/environment-separation-설계.md` §24.2의 (동명이지만 무관한) 기존 X-5 항목은 그대로 두고 건드리지 않았다 — 두 문서의 X-n 번호는 각자 문서 스코프 안에서만 유효하다. | coordinator 지시(2026-09-26 후속 3건 중 1번) | `apps/api/src/environment/lib/environment-sealing.spec.ts`(E-5 전체 재작성) |
| I-4 | **코드 리뷰 R1 H-1 수정** — 구독 기반 이벤트 5종의 웹훅 봉투에서 `chatbot`이 항상 `null`로 나가던 결함을 고쳤다. `CachedSubscription`·`SubscriptionSnapshotRow`에 `chatbotName`을 추가하고, `refreshSubscriptionCache()`의 1쿼리에 `chatbot: { select: { name: true } }`를 얹었다(조회 수 불변 — §6.3). `WorkflowTriggerService.enqueueEvent()`가 `chatbot: null` 대신 `chatbot: { id: input.chatbotId, name: sub.chatbotName }`을 봉투에 싣는다. **챗봇 이름 변경 시 캐시 무효화는 하지 않기로 결정했다** — §6.3은 "구독·대상 저장 시 즉시 무효화 · 그 밖은 TTL 30초"로 이미 정의돼 있고, 챗봇 이름은 그 규약이 다루는 대상(구독·대상)이 아니다. 극히 드문 개명 직후 30초 동안 구 이름이 실릴 수 있는 정도는 기존에 이미 받아들인 것과 같은 수준의 지연이라 새 무효화 지점(`ChatbotsModule → WorkflowCatalogModule` 교차 의존)을 추가하지 않았다 — 이 결정은 system-architect 재검토 대상으로 남긴다. | 코드 리뷰 R1(2026-09-26) | `apps/api/src/workflow/catalog/lib/subscription-cache.ts`, `apps/api/src/workflow/catalog/workflow-catalog.service.ts`, `apps/api/src/workflow/triggers/workflow-trigger.service.ts` |
| I-5 | **코드 리뷰 R1 H-2 수정** — 재개(resume) 시 보류 최대 시간이 두 서비스(`WorkflowTargetsService`·`WorkflowSubscriptionsService`)에 `24 * 3_600_000`으로 하드코딩돼 있어 `WORKFLOW_HOLD_MAX_HOURS`를 바꿔도 재개 판정에는 반영되지 않던 결함을 고쳤다. 새 헬퍼 `workflowHoldMaxMs(config: ConfigService): number`(`WORKFLOW_HOLD_MAX_HOURS ?? 24` 시간 → ms)를 1파일에 두고, 정리 루프(`WorkflowDispatchJob.holdMaxMs()`)·두 서비스의 `resume()`이 전부 이 헬퍼를 호출한다 — "같은 값을 쓰도록 헬퍼 1곳으로 공유"(리뷰 지시) 충족. ⚠ `WorkflowTargetsService.resume()`·`WorkflowSubscriptionsService.resume()`은 여전히 `new Date()`(실제 벽시계)를 쓴다 — `CLOCK` 토큰은 주입돼 있지 않다(정리 루프만 주입 시계를 쓴다). 이 차이는 이번 리뷰 지시 범위(env 하드코딩) 밖이라 손대지 않았다 — 두 서비스에 `CLOCK`을 주입할지는 system-architect 판단 대상으로 남긴다(시험은 이 사실을 반영해 `Date.now()` 기준 상대 시각으로 픽스처를 만든다 — `workflow-automation-hold-expiry.integration.spec.ts`). | 코드 리뷰 R1(2026-09-26) | `apps/api/src/workflow/lib/hold-max.ts`(신규), `apps/api/src/workflow/dispatch/workflow-dispatch.job.ts`, `apps/api/src/workflow/targets/workflow-targets.service.ts`, `apps/api/src/workflow/subscriptions/workflow-subscriptions.service.ts` |
| I-6 | **코드 리뷰 R1 M-1 수정** — §9.5의 저장 시 호스트 검사에서 "`http:` 스킴이고 `WORKFLOW_ALLOW_HTTP=false`면 `400 VALIDATION_FAILED`"가 코드에 빠져 있었다(출구 허용목록 검사만 있었다). `WorkflowTargetsService`에 `assertHttpSchemeAllowedForSave()`를 추가해 생성·수정(`baseUrl` 변경 시) 모두에 적용했다 — 발송기(`workflow-http.sender.ts`)의 같은 조건과 이중 방어(저장 뒤 환경변수가 바뀌는 경우는 발송기가 여전히 막는다). 오류 코드는 요구사항 문구 그대로 기존 재사용 코드 `VALIDATION_FAILED`(신규 코드 0)를 쓴다. | 코드 리뷰 R1(2026-09-26) | `apps/api/src/workflow/targets/workflow-targets.service.ts` |
| I-7 | **코드 리뷰 R1 M-2 수정** — `WorkflowDispatchJob`이 백오프 지터 계산에 `Math.random`을 인라인으로 직접 호출해 잡 수준(통합) 시험에서 지터를 결정적으로 고정할 방법이 없었다(순수 함수 `computeBackoffMs()`는 이미 `random` 매개변수를 받고 있었다 — 순수 함수 시험은 기존에도 결정적이었다). `CLOCK` 토큰과 같은 패턴으로 `WORKFLOW_RANDOM` 토큰을 신설하고, 생성자 끝에 `@Optional() @Inject(WORKFLOW_RANDOM) private readonly random: () => number = Math.random`를 추가했다(`workflow.module.ts`가 운영 기본값 `Math.random`을 등록 — 시험만 오버라이드). `dispatchOne()`의 `computeBackoffMs(..., Math.random)` 호출을 `computeBackoffMs(..., this.random)`으로 바꿨다. 잡 수준 결정성 시험 3건(`random()=0` 하한·`random()=1` 상한·미주입 기본값 범위)을 추가했다. | 코드 리뷰 R1(2026-09-26) | `apps/api/src/workflow/dispatch/workflow-dispatch.job.ts`(`WORKFLOW_RANDOM` 토큰 신설), `apps/api/src/workflow/workflow.module.ts`(기본 바인딩), `apps/api/src/workflow/dispatch/workflow-dispatch.job.spec.ts`(신규) |
| I-8 | **프런트엔드 계약 보강 ① — 흐름 미리보기 WORKFLOW 표시**(coordinator 지시, R1 후속). `FlowNode`(`dialogue-engine.ts`)에 `hasWorkflowOutput?: true`를 추가했다 — **엔진(`buildFlowTree`)은 건드리지 않는다**(No.41 엔진 변경 닫힌 목록 §5.1 밖). 대신 `apps/api/src/dialog-nodes/lib/annotate-flow-workflow.ts`(순수 후처리, 신규)가 `DialogNodesService.flow()`에서 엔진이 만든 트리를 순수 함수로 주석만 붙인다 — WORKFLOW 아웃풋을 가진 노드가 하나도 없으면 원본 트리 참조를 그대로 반환해 바이트 동일을 보장한다(FR-0-172급). | coordinator 지시(2026-09-26 R1 병행 지시) | `packages/shared-types/src/dialogue-engine.ts`(`FlowNode`·`FlowNodeSchema`), `apps/api/src/dialog-nodes/lib/annotate-flow-workflow.ts`(신규)·`.spec.ts`(신규), `apps/api/src/dialog-nodes/dialog-nodes.service.ts`(`flow()`) |
| I-9 | **프런트엔드 계약 보강 ② — `WORKFLOW_ENABLED` 콘솔 노출**(coordinator 지시). `WorkflowSummaryResponseSchema`에 `featureEnabled: z.boolean()`을 추가했다(필드 위치: **`GET /workflow-runs/summary`·`GET /chatbots/:chatbotId/workflow-runs/summary` 응답 최상위**, `days` 다음·`totals` 앞). `WorkflowSummaryService.summarize()`가 `ConfigService.get<boolean>('WORKFLOW_ENABLED') ?? true`를 채운다 — 별도 엔드포인트를 신설하지 않고 이미 있는 요약 화면에 얹는 방식을 택했다(권장안 그대로). | coordinator 지시(2026-09-26 R1 병행 지시) | `packages/shared-types/src/workflow.ts`(`WorkflowSummaryResponseSchema`), `apps/api/src/workflow/runs/workflow-summary.service.ts` |
| I-10 | **프런트엔드 계약 보강 ③ — `exits[].masked`에 `'PER_TARGET'` 추가**(coordinator 지시). `GovernanceMapResponseSchema.egress.exits[].masked` 유니온에 `'PER_TARGET'`을 추가했다. ⚠ **기존 §9.1·§9.6과 긴장 관계**: §9.1의 레지스트리 주석은 "`EgressExitDef.masked` 유니온 +1(**응답 스키마의 `exits[]`에는 나타나지 않는다** — §9.6)"이라고 명시적으로 적어 두었고, `GovernanceMapService.buildEgress()`는 실제로 `WORKFLOW_WEBHOOK`을 `exits` 배열에서 계속 제외한다(DB 결정 출구 — 레거시와 같은 처리, §9.6 불변, 이번에 손대지 않았다). 즉 이번 변경은 **타입만 넓히는 순수 추가**(zod enum 확장)이고, 실제 응답 어디에서도 `'PER_TARGET'`이 `exits[]`에 실제로 나타나지는 않는다(코드 동작 변화 0 — 오직 `workflowTargets[]`가 대상별 원문 허용 정보를 이미 별도로 나른다, §9.6). coordinator 지시를 문언 그대로 반영했으나, §9.1/§9.6 주석과 실제 의도(화면이 `workflowTargets[]` 행에 이 값을 쓸지, 아니면 정말 `exits[]` 노출 범위를 넓힐지)가 다를 가능성이 있어 **system-architect 확인을 요청한다**. | coordinator 지시(2026-09-26 R1 병행 지시) — §9.1/§9.6과의 긴장은 system-architect 확인 대기 | `packages/shared-types/src/governance.ts`(`GovernanceMapResponseSchema.egress.exits[].masked`) |
| I-12 | **프런트엔드 계약 보강 ④ — 시뮬레이터 필드 단위 마스킹 표시**(coordinator 지시). `WorkflowStepViewSchema.fields[]`(모의 표시 전용, §13.6 — 봉투 `WorkflowEnvelopeV1Schema`와 무관)의 각 항목에 `masked: z.literal(true).optional()`을 추가했다. 집계 플래그 `personalDataMasked`(단계 전체 1개)만으로는 콘솔이 어떤 필드가 실제로 가공됐는지 알 수 없어 전 필드를 일괄 마스킹 처리하던 과잉 마스킹을 없앤다. `SimulationService.buildWorkflowSteps()`가 `processFieldValue()`(`field-values.ts`)의 반환값 `ProcessedField.masked`(불리언, §11.1 로직 그대로 — 변경 없음)를 그대로 실어 `masked: true`일 때만 키를 넣고 `false`면 키 자체를 생략한다(CONST 필드·마스킹되지 않은 SLOT 필드는 `masked` 키 없음). 서버 가공 로직(`processFieldValue`)·외부 웹훅 봉투는 손대지 않았다 — 시뮬레이터 응답 전용 필드다. | coordinator 지시(2026-09-26) | `packages/shared-types/src/workflow.ts`(`WorkflowStepViewSchema.fields[]`), `apps/api/src/simulation/simulation.service.ts`(`buildWorkflowSteps()`) |
