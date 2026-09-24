# 레거시 API 연동 세부 설계서 (No.26)

> **요구사항**: `docs/requirements/legacy-api-integration.md`(T-1~8, J-1~20, FR-0-96~105, FR-L1-\*~FR-L9-\*, NFR-LP/LS/LA/LM, AC-L1~L8, EX-L-1~25, P-1~P-15)
> **상위 문서**: `docs/02-spec/개발명세서.md` §2·§2.1·§2.2·§3·§3.1·§4·§4.1·§5·§5.1·§6(**결정 35 신설**)·§7
> **신규 ADR**: **ADR-0034**(레거시 API 연동 = 전역 연결 레지스트리 + 환경변수 시크릿 참조 + 엔진 정지점/순수 재진입 + 동기 단발 호출 + SSRF 다층 방어 + 메타데이터 전용 호출 로그)
> **갱신 ADR(각주만)**: ADR-0008(실행 가능 판정 = 타입이 아니라 형태 · 엔진 수정 닫힌 목록) · ADR-0013(PII 적용 지점 4번째 — 레거시 송신, 연결 단위 원문 예외) · ADR-0015(신규 권한 0종 · 연결 관리 = `security:*`) · ADR-0016(§5 `ApiCallLog` 도입 — 원문 미저장) · ADR-0022(외부 출구 봉인 형식 계승 · `RagHttpClient` 보강 제안) · ADR-0030(TC·비교는 레거시를 목으로만) · ADR-0031(연결은 스냅샷 밖 · 참조 끊김 = 경고)
> **작성일**: 2026-09-24 · **GPU**: **1 유지**(HTTP 1회 · JSON 파싱 · 경로 추출 · 문자열 치환 — 새 모델·추론·임베딩 0 · ml-worker 호출 0). ml-engineer 신규 작업 없음 — §22.
> **기존 파일 수정 목록**: 문서는 `docs/02-spec/legacy-api-integration-patches.md`, 코드는 이 문서 §2.5.

---

## 0. 이 문서가 푸는 문제 (한 문단 요약)

`API_CONDITION`은 No.5 때부터 **저장만 되고 실행되지 않는** 아웃풋이다(`packages/dialogue-engine/src/outputs.ts:94-99`). ADR-0008 §4는 "`UNSUPPORTED_OUTPUT_TYPES`에서 값을 빼는 것만으로 실행이 열린다"고 예고했지만 코드상 성립하지 않는다 — ① 엔진은 동기 순수 함수라 호출할 자리가 없고(`resolver.ts:115-126`, `outputs.ts:28-33`) ② 저장 스키마는 URL·인증 헤더(평문 토큰)를 **노드 JSON 안에** 담아(`packages/shared-types/src/dialogue.ts:520-530`) 노드 조회 권한(`dialogue:read`, VIEWER 보유 — `security.ts:48`)만으로 토큰이 읽히고 ③ 응답값 매핑·실패 분기가 없으며 ④ 노드 참조 무결성 4곳이 `conditions[].nextNodeId`를 모른다(`design-validator.ts:5-18`, `dialog-nodes.service.ts:92-104`, `reference-check.service.ts:132-158`, `snapshot-integrity.ts:83-101`). 이 설계는 **시크릿과 호출 대상을 노드 밖(ADMIN 관리 전역 `ApiConnection` + 환경변수)으로 빼고**, 엔진은 v2 `API_CONDITION`에서 **정지 → API 계층이 1회 호출 → 엔진 순수 함수로 재진입**하게 하며, 외부 출구를 `LegacyApiHttpClient` 1곳 + SSRF 다층 방어로 봉인하고, 호출은 **원문 없는 메타데이터 로그**로만 남긴다. API 노드가 없는 챗봇의 모든 소비자 결과는 바이트 단위로 불변이다.

---

## 1. PM 확정 사항 (2026-09-24 — §11 P-1~P-15 전부 권고안)

| # | 확정 내용 | 이 문서에서의 반영 |
|---|---|---|
| P-1 | `API_CONDITION`만 실행. `SCENARIO`는 미지원 유지(No.39) | §4.1 `UNSUPPORTED_OUTPUT_TYPES = ['SCENARIO','SURVEY']` · §19 |
| P-2 | ADMIN 관리 **전역 `ApiConnection`** 레지스트리. 노드는 `connectionId` + 상대 경로만 | §3.1 · §4.1(v2 스키마) · §7 |
| P-3 | 시크릿은 DB 미저장. `secretRef` + 환경변수 `LEGACY_API_SECRET__<REF>` | §7.7 · §13 L-1 |
| P-4 | v1: 읽기 가능 · 실행 안 함 · 신규 v1 저장 400 · 편집 시 v2 전환 필요 · **조회 응답에서 헤더 값 가림**(VIEWER 평문 토큰 열람 해소) · 자동 변환·삭제 없음 | §4.2~§4.3 · §15 |
| P-5 | 같은 응답 내 동기 호출 · 연결별 타임아웃 기본 3초(1~10) · 턴당 1회 · 재시도 없음 · 회로차단 5회/60초 · API 노드 없는 턴 예산 불변 | §5 · §7.5~§7.6 · §14 |
| P-6 | GET/POST만 | §4.1 · §7.2 |
| P-7 | `defaultNodeId`/`failureNodeId` 선택, 미지정 시 고정 문구, `API_CONDITION`은 노드의 마지막 아웃풋(뒤는 실행 안 함) | §5.4~§5.6 · §5.9 |
| P-8 | `{api.이름}`은 같은 턴 · 텍스트 필드만 치환 · URL 필드 치환 금지 · 다음 턴 이월 없음 | §8 · FR-0-101 |
| P-9 | 루프백/링크로컬/메타데이터 절대 차단 · 사설 대역은 환경변수 allowlist로만(기본 빈 목록) · DNS 해석 후 실제 접속 IP 검사 · 리다이렉트 불추종 · 256KB · JSON만. 기존 NFR-S4 재정의 | §7.3~§7.5 |
| P-10 | 기본 마스킹 송신 · 연결별 `allowRawPersonalData`(ADMIN · 확인값 · 감사) · 로그에 원문 없음 | §7.1 ⑦ · §9 · §11 |
| P-11 | `ApiCallLog` 메타데이터만(`RagCallLog` 선례) · 목/TC 미기록 · 자동 보존정리 없음(No.45) | §3.1 · §9 |
| P-12 | 신규 권한 0종(연결 관리 `security:write` · 선택 목록 `dialogue:read` · 호출로그 `chatbot:read` · 시뮬레이터 실호출 `simulation:write`) | §10 |
| P-13 | 시뮬레이션·TC 기본 목(연결 샘플 응답). 실호출은 `simulation:write` + GET + 저장된 노드 + 시뮬레이터 단건만 | §6.2~§6.5 |
| P-14 | 익명 조회 위험 수용·가시화(`personalDataLookup` 표시 · 편집기 경고 · 기본 레이트리밋 30/분) | §3.1 · §5.9 · §16 |
| P-15 | GPU 1 | §22 |
| (architect) | **엔진 연결 방식** — J-4 정지점 → 엔진 밖 실행 → 순수 재진입. 엔진 수정 = FR-0-96 닫힌 목록 + 엔진 I/O 심볼 0건 정적 검사 | §2.3 · §5 · §13 L-5 |
| (architect) | **참조 무결성 편입**(J-17) — `conditions[].nextNodeId`·`defaultNodeId`·`failureNodeId`를 4곳에 편입(기존 결함 해소) | §5.8 |
| (architect) | **스냅샷 취급**(J-18) — 연결은 스냅샷 밖, 노드의 `connectionId` 참조는 스냅샷 안, 시크릿이 들어갈 자리 없음 | §15 |

---

## 2. 아키텍처 배치

### 2.1 모듈 구조

기존 4계층 규약(개발명세서 §2.1)을 따른다. **NestJS 모듈 3개를 신설**하되 역할을 "읽기 카탈로그 / 외부 출구 / 관리 CRUD"로 나눠 — TC·비교·시뮬레이터 목 경로가 **외부 출구를 DI 그래프에 들이지 않고도** 연결 정보(샘플 응답·사용 여부)를 읽을 수 있게 한다(FR-0-102).

```
apps/api/src/
├── api-connections/                         # [신규] ApiConnectionsModule — 관리 CRUD(ADMIN)
│   ├── api-connections.controller.ts        # @Controller('api-connections') — 8핸들러(§12.1). ⚠ picker를 :id보다 먼저 선언
│   ├── api-connections.service.ts           # ★ ApiConnection 쓰기 유일 파일(§13 L-10) · 감사 기록 · 참조 409 · 24h 통계 조립
│   ├── api-connection.mapper.ts             # row ↔ DTO(JSON 필드 파싱, secretStatus·insecureHttp 파생, 감사용 baseUrlHost·sampleCount)
│   └── catalog/                             # [신규] ApiConnectionCatalogModule — ★ 읽기 전용(Prisma read만), 외부 출구 없음
│       ├── api-connection-catalog.service.ts  # findForCall(id) · loadMockSources(ids) · designInfo(ids) · pickerItems()
│       └── lib/
│           ├── mock-outcome.ts              # 샘플/직접입력/실패유형 → ApiCallResult(순수) · 샘플 해시 앞 8자리
│           └── connection-rules.ts          # baseUrl 규칙·authHeaderName 금지목록·secretRef 형식·rateLimit 기본값(순수)
├── legacy-api/                              # [신규] LegacyApiModule — 외부 출구(export는 LegacyApiService·ApiCallLogService만)
│   ├── legacy-api.module.ts
│   ├── legacy-api.service.ts                # 턴 완결(live) · 연결 테스트 — 게이트·PII·조립·호출·재진입·로그 오케스트레이션(§7.1)
│   ├── legacy-api-http.client.ts            # ★ 레거시 호출 유일 출구(§7.3) — ValidatedLegacyRequest만 받음 · DNS→IP 정책→전송
│   ├── legacy-api-secret.resolver.ts        # ★ LEGACY_API_SECRET__ 읽기 유일 파일(§7.7)
│   ├── legacy-api-gate.service.ts           # 연결 단위 회로·레이트·동시성(인스턴스 로컬, 인터페이스 1곳 — §7.6)
│   ├── transport/
│   │   ├── legacy-transport.port.ts         # LegacyTransport · LegacyDnsResolver 포트(테스트 대체 지점 — NFR-LM2)
│   │   ├── node-http.transport.ts           # ★ node:http/https import 유일 파일 — 고정 주소 lookup·리다이렉트 불추종·크기 상한·데드라인
│   │   └── node-dns.resolver.ts             # node:dns lookup({ all:true, verbatim:true })
│   ├── api-call-log.service.ts              # ★ ApiCallLog create 유일 파일(fire-and-forget) · 목록·요약 조회
│   ├── api-call-logs.controller.ts          # @Controller('chatbots/:chatbotId/api-call-logs') — 2핸들러
│   └── lib/                                 # DB·Nest·네트워크 무의존 순수 함수(NFR-LM1)
│       ├── build-request.ts                 # ★ ValidatedLegacyRequest 생성 유일 파일 — URL 조립·인코딩·재파싱 검증·본문 구성
│       ├── ip-policy.ts                     # 주소 분류(절대 차단/사설/공인) · 임베디드 IPv4 추출 · allowlist 파싱
│       ├── outcome-class.ts                 # 결과 코드 → 회로 분류(INFRA_FAILURE/ALIVE/NEUTRAL)
│       ├── response-check.ts                # Content-Type 판정 · JSON 파싱(reviver 없음)
│       └── legacy-api-sealing.spec.ts       # 봉인 정적 검사 L-1~L-14(§13)
├── common/lib/
│   └── api-turn.ts                          # [신규] completeApiTurnSync(result, executor, …) — 목 실행기 공용 헬퍼(NFR-LM4, 순수)
├── conversation/public-conversation.service.ts   # [수정] ④.5 API 턴 완결 삽입(§6.1)
├── simulation/simulation.service.ts              # [수정] apiMode MOCK/LIVE · compare 목(§6.2~§6.3)
└── validation/run/test-run.executor.ts           # [수정] 목 완결 + apiMock 기록(§6.4)
```

### 2.2 모듈 의존 방향

```
api-connections  → catalog / legacy-api(LegacyApiService — 연결 테스트) / audit-logs / prisma / config
legacy-api       → catalog / prisma / config                          (conversation·simulation을 import하지 않는다)
conversation     → legacy-api(LegacyApiService) + 기존
simulation       → legacy-api(LegacyApiService) / catalog + 기존
dialog-nodes     → catalog(저장 검증·설계 점검 컨텍스트) + 기존
validation       → catalog + 기존                 ★ legacy-api import 금지(FR-0-102, §13 L-6)
versions         → (Prisma 직접 읽기 — 복원 경고의 연결 존재 확인)  ★ legacy-api import 금지
deploy-schedules → 변경 없음                        ★ legacy-api import 금지
```
- **`LegacyApiModule`의 export는 `LegacyApiService`·`ApiCallLogService` 2개뿐**이다. `LegacyApiHttpClient`·전송 포트·시크릿 리졸버·게이트는 export하지 않는다 — 다른 모듈은 **주입 자체가 불가능**하다(ADR-0025 봉인 L1과 같은 방식).
- `ApiConnectionCatalogModule`은 `prisma`만 의존하는 **읽기 전용 잎(leaf)** 이다. 순환 없음: `catalog ← legacy-api ← api-connections`.
- `ChatbotsModule`(영구삭제)은 `apiCallLog.deleteMany`를 트랜잭션 `tx`로 직접 호출한다(`ragCallLog` 선례 — `chatbots.service.ts:357`). 모듈 import 추가 0.

### 2.3 엔진 수정 범위 — FR-0-96 닫힌 목록 (FR-0-78·88 "엔진 불가침"의 의도된 예외)

| # | 파일 | 변경 | 비고 |
|---|---|---|---|
| ① | `packages/dialogue-engine/src/outputs.ts` | `executeOutputs`에 옵션 5개(`sourceNodeId`·`initialHops`·`completedForm`·`apiCallsRemaining`·`apiVariables`) + 반환 `suspended?`·`hops` 추가. v2 `API_CONDITION` 분기(정지 / 턴당 1회 초과 처리). 큐 원소에 `(nodeId, index)` 추적. **텍스트 필드 `{api.*}` 치환**(`apiVariables`가 있을 때만) | §5.2 · §8 |
| ② | `packages/dialogue-engine/src/api-call.ts` **신규** | `ApiCallSuspension`·`ApiStepResult` 타입 · `resumeAfterApiCall()` · 내부 `bindRequest()`(바인딩 해석) · 고정 문구 적용 | §5.1 · §5.4 |
| ③ | (순수 함수 3종) | `extractPath`·`evaluateApiConditions`·`renderApiTokens`는 **`packages/shared-types/src/api-mapping.ts`**(zod 무의존)에 두고 엔진은 import만 한다 — **apps/web이 shared-types만 의존**(`apps/web/package.json:14`)해 편집기 미리보기가 같은 함수를 써야 하기 때문(§21 D-4) | §4.5 |
| ④ | `design-validator.ts` · `flow-tree.ts` | `getOutgoingNodeRefs()` 반환에 `apiTargets` 추가 · 끊어진 참조 검사·들어오는 참조 수에 편입 · 흐름 트리 `via: 'API_BRANCH'` · 설계 점검 신규 항목 + 선택 3번째 인자 `DesignValidationContext` | §5.8 · §5.9 |
| ⑤ | `resolver.ts` · `turn.ts` · `index.ts` | `resolveResponse`/`resolveByNodeId` 반환 타입 `EngineResolution = DialogueResolution & { apiCall? }` · 폼 완료 값(`completedForm`)을 `executeOutputs`에 전달 · `resolveTurn`이 정지 시 **폴백 결과 동봉**(FR-L4-9) · export 추가 | §5.3 · §5.7 |
| — | `constants.ts` | 고정 문구 2종 상수 추가(`API_FAILURE_NOTICE`·`API_NO_MATCH_NOTICE`) — ②에 딸린 상수 | §5.6 |

- 엔진은 여전히 **I/O·타이머·`fetch`·`process.env`·Nest·Prisma 심볼 0건**이며 §13 L-5가 매 실행 단언한다.
- 이 목록에 없는 엔진 파일(`matcher.ts`·`node-matcher.ts`·`context-session.ts`·`conversation-state.ts`·`homonym.ts`·`faq.ts`·`semantic.ts`·`overlay.ts`·`dialogue-index.ts`·`normalize.ts`)은 **수정하지 않는다**. `CONVERSATION_STATE_VERSION`은 1 그대로다(FR-0-101).

### 2.4 `apps/api` 외 워크스페이스 영향

| 워크스페이스 | 변경 |
|---|---|
| `packages/shared-types` | `dialogue.ts`(API_CONDITION v1/v2 · 판정·가림 함수 · `UNSUPPORTED_OUTPUT_TYPES` 축소) · **`api-mapping.ts` 신설**(zod 무의존 순수 함수) · **`legacy-api.ts` 신설**(연결·로그·시뮬레이터 확장 스키마) · `dialogue-engine.ts`(trace 단계 1 + 코드 11 · 설계 점검 코드 · 흐름 `via`) · `conversation.ts`(시뮬레이터 `apiMode`·`mockResponse`·`apiStep`) · `version.ts`(복원 경고 3종) · `validation.ts`(결과 `apiMockA/B`) · `audit.ts`(`ApiConnection`) · `common.ts`(`ApiErrorCode` 2종) · `index.ts` export |
| `packages/dialogue-engine` | §2.3 닫힌 목록 |
| `apps/web` | 보안 설정 > API 연결 화면 · 노드 편집기 `API 조건분기` v2 폼(헤더·URL 입력 제거) · v1 표시·전환 · 시뮬레이터 `외부 API` 단계 · 챗봇 상세 `외부 연동 로그` 탭 · 미지원 배지를 공유 판정 함수로(`DialogOutputEditor.tsx:126` 하드코딩 제거) · 흐름 트리 `API_BRANCH` 표시 · 복원 미리보기 경고 3종 문구 |
| `apps/widget` · `apps/ml-worker` | **변경 0건**(위젯은 `textContent` 렌더 — `apps/widget/src/ui/renderers/text.ts:1-6`, 송신 클라이언트 타임아웃 없음) |

### 2.5 기존 코드 변경 목록 (구현자 체크리스트)

| 파일 | 변경 | 근거 |
|---|---|---|
| `prisma/schema.prisma` + 마이그레이션 1개 | `ApiConnection`·`ApiCallLog` 신설 · `TestRunResult.apiMockA/apiMockB String?` 추가(§3.1) | §3 |
| `prisma/scripts/report-legacy-api-conditions.ts` | **신규** 읽기 전용 v1 잔존 계측(노드·버전) | FR-L9-4 · §3.3 |
| `prisma/seed.ts` | 데모 연결 1건(`https://legacy.example.invalid/api` · 샘플 2개) + 데모 챗봇 v2 노드 1개(시뮬레이터 목 확인용). 기존 `SURVEY` 시드(:497-498) 불변 | §3.4 |
| `config/env.validation.ts` | 선택 변수 7종(§3.5) · `LEGACY_API_PRIVATE_ALLOWLIST` 파싱 경고(기동 실패 아님) | FR-0-103 |
| `packages/shared-types/src/dialogue.ts` | :431-432 상수 축소 · :511-530 v1 이름 변경 + v2·union·판정/가림 함수 추가 · :532-545 union의 `API_CONDITION` payload = v1∪v2 | §4 |
| `packages/dialogue-engine/src/*` | §2.3 ①~⑤ | FR-0-96 |
| `dialog-nodes/dialog-nodes.service.ts` | `create`/`update`(dto.outputs 있을 때) 앞에 `assertNoLegacyApiOutputs()` · `validateReferences`(:74-114)에 API 참조·연결·메서드·SLOT 검사 · `copy`(:286-329)에서 v1 `API_CONDITION` 제외(:311 `outputs: original.outputs` 대체) · 모든 응답 반환을 `toDialogNodeResponse()`(가림)로 · `validate()`(:351-355)가 연결 설계 정보를 컨텍스트로 전달 | FR-L1-4/6 · FR-L3-1/2 |
| `dialog-nodes/dialog-node.mapper.ts` | `toDialogNodeResponse(row)` = `toDialogNodeEntity(row)` + `redactLegacyApiOutputs(outputs)` 추가. **`toDialogNodeEntity`·`parseOutputs`는 무변경**(감사 스냅샷·수정 시 기존 값 보존 경로가 원본을 써야 한다) | FR-L1-6 |
| `dialog-nodes/dialog-nodes.controller.ts` | `copy` 응답에 `excludedLegacyApiOutputCount` | FR-L1-4 |
| `dialogue-common/reference-check.service.ts` | `assertNodeDeletable`(:132-158)을 `getOutgoingNodeRefs()` 재사용으로 교체(규칙 1벌 — API 참조 자동 편입, v1 포함) · `assertApiConnectionDeletable(connectionId)` 추가(전 챗봇 노드) | AC-L1-7 · FR-L2-3 |
| `conversation/public-conversation.service.ts` | `messageId` 생성을 `resolveTurn` 직후로 앞당김(:139) · ④.5 `LegacyApiService.completeTurn()`(§6.1) · RAG 판정에 `apiTurn`(:146) · `record()`에 `apiNotice` | FR-L4-11~13 |
| `conversation/lib/conversation-log.ts` | `FALLBACK_TRACE_CODES`(:5)에 `'API_FIXED_NOTICE'` 추가 | FR-L4-13 |
| `conversation/conversation-log.service.ts` | `RecordConversationLogParams.apiNotice?: boolean` → 수집기에 전달(:88-95) | FR-L4-13 |
| `learning/lib/collect-decision.ts` · `learning/unanswered-collector.service.ts` | `CollectSkipReason`에 `'API_NOTICE'` · 입력 `apiNotice?`(기본 false — 기존 호출 무변경) | FR-L4-13 · ADR-0019 |
| `rag/lib/should-run-rag.ts` | `ShouldRunRagInput.apiTurn?: boolean`(기본 false) → true면 false(조건 ⑩) | FR-L4-12 |
| `simulation/simulation.service.ts` · `simulation.controller.ts` | `simulate(chatbotId, dto, actor)` — 컨트롤러가 `@CurrentUser()` 전달(권한이 비즈니스 인자 — 개발명세서 §2.1 actor 규약) · §6.2 · `compare()`(:169-212) 목 완결 | FR-L7-1~4 |
| `validation/run/test-run.executor.ts` | 실행당 목 원천 1회 로드 · `runSide`(:363-447) 턴마다 `completeApiTurnSync` · `SideOutcome.apiMock` · `flush`(:300-342) `apiMockA/B` | FR-L7-5/6 |
| `validation/lib/validation-sealing.spec.ts` | 금지 import에 `legacy-api/` 추가 | FR-0-102 |
| `versions/lib/snapshot-integrity.ts` | `apiTargets` → `BROKEN_REFERENCE_NODE_API` 경고(:83-101 블록) · 캡처 모드 `API_LEGACY_FORMAT` 경고 규칙 | FR-L3-2 ④ · FR-L8-3 |
| `versions/restore/restore-warnings.service.ts` | 경고 3종(§15) — `prisma.apiConnection.findMany` 읽기 1회 | FR-L8-2 |
| `versions/version.service.ts` · `versions/diff/version-diff.service.ts` | `content()`(:111)·`diffItemDetail()`(:84) 응답의 노드 `outputs`에 `redactLegacyApiOutputs` | FR-L1-6 · FR-L8-3 |
| `chatbots/chatbots.service.ts` | 영구삭제 트랜잭션에 `tx.apiCallLog.deleteMany({ where: { chatbotId } })`(:357 옆) — 14 → 15테이블 | FR-L6-6 |
| `audit-logs/lib/audit-snapshot.ts` | `AUDIT_FIELDS.ApiConnection`(:53 옆) | FR-L2-4 |
| `common/lib/api-turn.ts` | **신규** | NFR-LM4 |
| `apps/web/**` | §16 | FR-L9-\* |

> **이 목록에 없는 파일은 바꾸지 않는다.** 특히 `rag/rag-http.client.ts`(보강은 제안만 — §19), `conversation-state.ts`, 위젯 전부, `stats/**`(응답출처 분류 무변경 — §20 K-5)는 무변경이다.

---

## 3. 데이터 모델 · 마이그레이션

### 3.1 Prisma 변경안

```prisma
/// [신규 No.26] 레거시 API 연결 레지스트리(전역 — 챗봇 스코프 아님, ADR-0034 §2). ADMIN만 쓴다.
/// ★ 시크릿 **값** 컬럼은 존재하지 않는다 — `secretRef`(이름)만 두고 값은 환경변수
/// `LEGACY_API_SECRET__<secretRef>`에서 `LegacyApiSecretResolver`만 읽는다(ADR-0034 §3).
/// 노드 → 연결 참조는 `DialogNode.outputs` JSON 안이라 FK가 없다(앱 레벨 검사 — 삭제 409).
model ApiConnection {
  id                   String   @id @default(uuid())
  name                 String
  /// normalizeText(name) — 전역 유일(ADR-0006, BannedWord.wordNormalized와 같은 전역 규약)
  nameNormalized       String   @unique
  description          String?
  /// 스킴+호스트+포트+기준 경로. 사용자정보·쿼리·프래그먼트 금지(§7.2)
  baseUrl              String
  /// JSON 배열 — ["GET"] | ["POST"] | ["GET","POST"]
  allowedMethods       String   @default("[\"GET\"]")
  /// NONE | API_KEY_HEADER | BEARER | BASIC (zod ApiConnectionAuthType)
  authType             String   @default("NONE")
  authHeaderName       String?
  /// ^[A-Z0-9_]{1,40}$ — 이름뿐이다(값 아님)
  secretRef            String?
  timeoutMs            Int      @default(3000)
  rateLimitPerMin      Int      @default(120)
  allowRawPersonalData Boolean  @default(false)
  personalDataLookup   Boolean  @default(false)
  /// JSON [{ label, httpStatus, body }] 0~5개 — 목 전용 관리자 작성 데이터(각 body ≤16KB)
  sampleResponses      String   @default("[]")
  enabled              Boolean  @default(true)
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  @@index([updatedAt])
  @@map("api_connections")
}

/// [신규 No.26] 레거시 API 호출 관측 로그(ADR-0016 §5 예고의 실체화, ADR-0034 §6). **메타데이터 전용** —
/// 치환된 URL·쿼리·헤더·요청/응답 본문·바인딩 값·응답 값 컬럼은 **존재하지 않는다**(정적 검사 L-7).
/// FK 없음(로그 규약) — 연결·노드가 삭제돼도 기록은 남고, 챗봇 영구삭제 시 서비스가 동반 삭제한다.
model ApiCallLog {
  id                 String   @id @default(uuid())
  /// CONNECTION_TEST는 챗봇 무관이라 null
  chatbotId          String?
  connectionId       String
  /// 기록 시점 연결 이름 스냅샷(AuditLog.targetName 선례 — 연결 삭제 후에도 목록이 UUID 나열이 되지 않게)
  connectionName     String
  nodeId             String?
  /// 공개 대화의 messageId(= ConversationLog.id). FK 없음
  conversationLogId  String?
  /// PUBLIC | SIMULATION_LIVE | CONNECTION_TEST
  source             String
  /// GET | POST
  method             String
  /// 치환 전 템플릿(예: "/orders/{0}") — 바인딩 값 없음
  pathTemplate       String
  /// ApiCallOutcome 18종(§7.8)
  outcome            String
  httpStatus         Int?
  latencyMs          Int
  responseBytes      Int?
  /// CONDITION | DEFAULT | FAILURE | NOTICE (연결 테스트는 null)
  branch             String?
  /// branch=CONDITION일 때 1부터
  conditionIndex     Int?
  /// 송신 값이 마스킹으로 바뀌었는가(FR-L6-3) — 원문도 마스킹본도 저장하지 않는다
  personalDataMasked Boolean  @default(false)
  /// ADR-0017 KST 버킷 규약 재사용
  dayBucket          String   @default("")
  createdAt          DateTime @default(now())

  @@index([chatbotId, dayBucket])
  @@index([chatbotId, createdAt])
  @@index([connectionId, createdAt])
  @@map("api_call_logs")
}

model TestRunResult {
  // … 기존 필드 불변 …
  /// [신규 No.26] 이 TC 판정에 API 목이 관여했는가: null = 관여 없음 · "NO_SAMPLE" · 샘플 해시 앞 8자리(FR-L7-6)
  apiMockA String?
  apiMockB String?
}
```

**만들지 않는 것**(요구사항 §5.2 그대로): 시크릿 저장 테이블 · 요청/응답 원문 로그 · 챗봇↔연결 허용 조인 · 재시도 큐 · 호출 결과 캐시 · 대화 세션 변수 저장소.

### 3.2 마이그레이션 (1개, `YYYYMMDDHHMMSS_legacy_api_integration`)

1. `CREATE TABLE api_connections` + `UNIQUE(nameNormalized)` + `INDEX(updatedAt)`.
2. `CREATE TABLE api_call_logs` + 인덱스 3개.
3. `ALTER TABLE test_run_results ADD COLUMN apiMockA TEXT NULL` · `apiMockB TEXT NULL`.
- **비파괴 변경만** — 기존 행·컬럼 변경 0, 백필 0. 롤백 = 두 테이블 DROP + 두 컬럼 제거.
- ⚠ `prisma migrate dev`가 생성한 diff에 `deploy_schedules`·`test_runs`의 **부분 유니크 인덱스 삭제 구문**이 끼어들지 않는지 확인하고, 있으면 그 줄을 제거한다(`schema.prisma:944-951` 주석 규약).
- **v1 `API_CONDITION` 데이터는 마이그레이션하지 않는다**(P-4 — 자동 변환·스크럽 없음, ADR-0034 §7).

### 3.3 v1 잔존 계측 — `prisma/scripts/report-legacy-api-conditions.ts` (FR-L9-4)

- **읽기 전용**. 출력: 챗봇별 `v1 API 조건 보유 노드 수` · `헤더 보유 노드 수` · 버전(스냅샷) 중 v1 포함 `versionId`·`versionNo` 목록. **URL·헤더 키·값을 출력하지 않는다**(건수·ID만).
- `ChatbotVersionPayload`를 읽지만 스크립트는 `apps/api/src` 밖이라 본문 참조 봉인(`version-sealing.spec.ts:233` V-7)의 대상이 아니다.
- 배포 직후 1회 실행 결과를 운영 기록에 남기고, 0이 아니면 설계 점검 요약·콘솔 알림(§16 ⑥)이 대상 노드로 안내한다.

### 3.4 seed

- `ApiConnection` 1건: 이름 `샘플 주문 조회`, `baseUrl = https://legacy.example.invalid/api`(`.invalid` TLD — **절대 해석되지 않아 LIVE는 항상 `NETWORK_ERROR`**, 외부 네트워크 호출 0), `allowedMethods ["GET"]`, `authType NONE`, 샘플 2개(`배송중` `{ "data": { "status":"SHIPPED", "delivery": { "eta":"09/26" } } }` · `준비중`).
- 데모 챗봇에 폼 완료 조건 v2 노드 1개 + 분기 노드 2개(시뮬레이터 목 데모). 기존 시드 행 불변.

### 3.5 신규 환경변수 (전부 선택 · 기본값 있음 — FR-0-103)

| 변수 | 기본값 | 검증 | 설명 |
|---|---|---|---|
| `LEGACY_API_ENABLED` | `true` | `envBoolean` 명시 파서 | `false`면 모든 레거시 호출 `FEATURE_DISABLED`(아웃바운드 0 — 연결 테스트·시뮬레이터 LIVE 포함) |
| `LEGACY_API_PRIVATE_ALLOWLIST` | (빈 값) | 문자열 — 기동 시 파싱 | 쉼표 구분 CIDR(IPv4/IPv6)·정확한 호스트명. **잘못된 항목·절대 차단 대역과 겹치는 항목은 무시 + 기동 경고**(기동 실패 아님) |
| `LEGACY_API_DEFAULT_TIMEOUT_MS` | `3000` | int 1000~10000 | 연결 생성 시 기본 타임아웃 |
| `LEGACY_API_MAX_TIMEOUT_MS` | `10000` | int 1000~10000 | 연결 타임아웃 상한. 저장값이 상한보다 크면 **호출 시 `min()`** 적용 |
| `LEGACY_API_MAX_RESPONSE_BYTES` | `262144` | int 1024~1048576 | 응답 본문 상한 |
| `LEGACY_API_CIRCUIT_FAILURE_THRESHOLD` | `5` | int ≥1 | 연결 단위 연속 인프라 실패 수 |
| `LEGACY_API_CIRCUIT_OPEN_MS` | `60000` | int ≥1000 | 회로 개방 유지 |
| `LEGACY_API_SECRET__<REF>` | — | **`EnvSchema`에 등록하지 않는다** | 연결 시크릿. `LegacyApiSecretResolver`가 `process.env`에서 접두사 규약으로 직접 읽는다(zod 스키마는 알 수 없는 키를 걸러 내므로 검증 대상이 될 수 없다 — `env.validation.ts:123-130`). 값을 로그·오류에 출력 금지 |

동시성 상한(연결당 10 · 전체 50)·샘플 한도·경로 한도는 FE/BE 공용 코드 상수(`API_CONNECTION_LIMITS`·`API_CONDITION_LIMITS`)다.

### 3.6 배포 순서

마이그레이션 → API 배포(v1 노드는 계속 미실행 — 기존 동작) → `report-legacy-api-conditions.ts` 1회 → 콘솔 배포. 역순 롤백 시 v2 노드가 남아 있으면 구버전 엔진은 v2 payload를 `PAYLOAD_INVALID`로 건너뛴다(구 `DialogOutputSchema`가 v2를 모른다) — **롤백 전 v2 노드를 비활성화**하라는 운영 메모를 남긴다(§20 K-8).

---

## 4. shared-types 스키마

### 4.1 `API_CONDITION` v1 / v2 (`packages/shared-types/src/dialogue.ts`)

```ts
/** 실행 미지원 아웃풋 "타입"(FR-L1-1). API_CONDITION은 타입이 아니라 형태로 판정한다 — isUnsupportedOutput(). */
export const UNSUPPORTED_OUTPUT_TYPES = ['SCENARIO', 'SURVEY'] as const;

export const API_CONDITION_LIMITS = {
  pathMaxLength: 300, pathParamsMax: 5, queryMax: 20, bodyMax: 30, bodyFieldDepthMax: 3,
  mappingsMax: 20, mappingMaxLengthDefault: 200, mappingMaxLengthMax: 500,
  conditionsMin: 1, conditionsMax: 10, responsePathMaxLength: 200, responsePathDepthMax: 10, constValueMax: 500,
} as const;

/** [No.5 원형 — 읽기 호환 전용] 새로 저장할 수 없다(서비스가 400 API_OUTPUT_LEGACY_FORMAT). @deprecated */
export const ApiConditionOutputPayloadV1Schema = z.object({ /* 기존 :524-530 그대로 — method 5종·url·headers·bodyTemplate·conditions */ });

export const ApiBindingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('CONST'), value: z.string().max(500) }),
  z.object({ kind: z.literal('SLOT'), contextVariableId: z.string().uuid(), slotName: z.string().min(1).max(50) }),
]);
export const ApiResponseMappingSchema = z.object({
  name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,29}$/),
  path: ApiResponsePathSchema,                 // parseResponsePath() !== null refine(§4.5)
  required: z.boolean().default(false),
  maxLength: z.number().int().min(1).max(500).default(200),
});
export const ApiConditionItemV2Schema = ApiConditionItemSchema.extend({ path: ApiResponsePathSchema });

/** [No.26] 연결 참조형. 헤더·URL·자유 본문 템플릿 필드가 **존재하지 않는다**(NFR-LS6 ⑦). */
export const ApiConditionOutputPayloadV2Schema = z.object({
  version: z.literal(2),                        // ★ 판별 필드
  connectionId: z.string().uuid(),
  method: z.enum(['GET', 'POST']),
  path: ApiRelativePathSchema,                  // "/"로 시작 · {0}~{4} · 금지 문자(§7.2)
  pathParams: z.array(ApiBindingSchema).max(5).default([]),
  query: z.array(z.object({ name: z.string().regex(/^[A-Za-z0-9_.\-]{1,50}$/), value: ApiBindingSchema })).max(20).default([]),
  body: z.array(z.object({ field: ApiBodyFieldSchema, value: ApiBindingSchema })).max(30).default([]),
  responseMappings: z.array(ApiResponseMappingSchema).max(20).default([]),
  conditions: z.array(ApiConditionItemV2Schema).min(1).max(10),
  defaultNodeId: z.string().uuid().optional(),
  failureNodeId: z.string().uuid().optional(),
}).superRefine(/* 자리표시자 수 = pathParams 수 · GET이면 body 0 · 매핑 이름 유일 · query name 유일 · body field 유일 + 접두 충돌 금지("a"와 "a.b") */);

/** 읽기 스키마 = v2 ∪ v1(v2 먼저). 이름은 기존 export를 유지하되 의미가 "합집합"으로 넓어진다. */
export const ApiConditionOutputPayloadSchema = z.union([ApiConditionOutputPayloadV2Schema, ApiConditionOutputPayloadV1Schema]);
```
- `DialogOutputSchema`(:532-545)의 `API_CONDITION` 항목은 이 **합집합**을 쓴다 — 엔진 파싱(`outputs.ts:44`)·번들·스냅샷 복원 검증(`snapshot-integrity.ts:52`)·응답 DTO가 v1을 계속 읽어야 하기 때문이다(AC-L1-2 · AC-L7-3).
- **판별**: `version === 2`. v2는 `url`이 없어 v1 파싱이 실패하고, v1은 `version`·`connectionId`가 없어 v2 파싱이 실패한다. 둘 다 실패하면 기존대로 `PAYLOAD_INVALID`.
- 요청 파이프가 strip 모드라(`zod-validation.pipe.ts:5-6`) v2에 섞여 온 `headers`·`url`은 **조용히 제거**된다(저장되지 않음 — 안전 방향).
- `.default([])` 때문에 저장 JSON에 빈 배열이 항상 들어가 스냅샷 해시가 "생략 vs 빈 배열"로 흔들리지 않는다(§15).

### 4.2 판정 · 쓰기 제한 · 업캐스트 정책

```ts
export function isApiConditionV2(p: ApiConditionOutputPayload): p is ApiConditionOutputPayloadV2;   // p.version === 2
/** 실행 미지원 = SCENARIO·SURVEY·v1 API_CONDITION. 엔진·설계 점검·웹 배지 공용(FR-L1-5). */
export function isUnsupportedOutput(o: DialogOutput): boolean;
/** v1 API_CONDITION 아웃풋의 인덱스(쓰기 거부·복사 제외 공용). */
export function findLegacyApiOutputIndexes(outputs: readonly DialogOutput[]): number[];
```
- **쓰기 = v2만**을 zod DTO 분리가 아니라 **서비스 가드**로 강제한다: `DialogNodesService.create()`와 `update()`(dto.outputs가 있을 때)가 `findLegacyApiOutputIndexes(dto.outputs).length > 0`이면 **`400 API_OUTPUT_LEGACY_FORMAT`**(`details[].field = outputs[i]`, 메시지 "API 조건을 연결 방식으로 전환해야 저장할 수 있습니다."). 이유: ① 전용 오류 코드로 분기해야 하는데 파이프는 `VALIDATION_FAILED`만 만든다(`zod-validation.pipe.ts:16-24`) ② 시뮬레이터 오버레이(`conversation.ts:39` — `CreateDialogNodeSchema` 재사용)는 v1을 받아도 **실행되지도 저장되지도 않아 무해**하다 — 오버레이까지 거부하면 v1이 남은 노드의 다른 아웃풋을 시험할 수 없다.
- `update()`에서 `dto.outputs`가 **없으면** 기존 v1을 그대로 둔다(`dialog-nodes.service.ts:234` — 사용 여부 토글 등). v1을 "편집 없이 보존"하는 것은 P-4의 "자동 삭제 없음"과 일치한다.
- **복사**: 원본 v1 `API_CONDITION`은 사본에서 **제외**하고 응답에 `excludedLegacyApiOutputCount`를 싣는다(헤더 토큰 복제 차단 — FR-L1-4). v2는 그대로 복사(시크릿 없음 — FR-L3-5).
- **업캐스트 없음**: 서버 쪽 자동 v1→v2 변환 함수를 만들지 않는다(ADR-0034 §7 — 연결을 임의 생성하는 것은 ADMIN 승인 없는 송신 경계 확장). 스냅샷 `SNAPSHOT_SCHEMA_VERSION`도 올리지 않는다(읽기 스키마가 합집합이라 업캐스터 불필요 — `snapshot-upcasters.ts:9` 빈 맵 유지). 웹 편집기 전용 `toApiConditionV2Draft(v1Redacted)`는 **메서드(GET/POST만 — 그 외는 GET으로 두고 경고)와 조건 목록만** 옮긴 미완성 초안을 만들며 연결 선택을 요구한다(§21 D-5).

### 4.3 응답 가림 — `redactLegacyApiOutputs()` (FR-L1-6 · FR-L8-3 · AC-L1-4)

```ts
export const LEGACY_REDACTED_VALUE = '[비공개]';
/** v1 API_CONDITION만 변환: url → origin + "/" · headers의 모든 값 → LEGACY_REDACTED_VALUE(키 유지) · bodyTemplate(있으면) → LEGACY_REDACTED_VALUE. v2·그 외 아웃풋은 그대로. 결과는 여전히 v1 스키마를 통과한다. */
export function redactLegacyApiOutputs(outputs: readonly DialogOutput[]): DialogOutput[];
```
- 적용 지점(응답 직렬화 **3곳**): 노드 CRUD 응답 전부(`toDialogNodeResponse` — 목록·상세·생성·수정·복사) · 버전 내용 조회(`version.service.ts:111`) · 버전 차이 항목 상세(`version-diff.service.ts:84`). 흐름 트리·설계 점검·시뮬레이터·공개 대화는 노드 `outputs`를 반환하지 않는다(엔진 결과에는 `API_CONDITION`이 실리지 않는다).
- 가린 값이 되돌아와 저장되는 사고는 구조적으로 없다 — v1 저장 자체가 400이다.
- 감사 스냅샷은 원래 `outputs`를 담지 않는다(`audit-snapshot.ts:39`) — 불변.

### 4.4 `packages/shared-types/src/legacy-api.ts` 신설 (위젯 비유입)

| 이름 | 내용 |
|---|---|
| `ApiConnectionAuthType` | `NONE`·`API_KEY_HEADER`·`BEARER`·`BASIC` |
| `ApiHttpMethod` | `GET`·`POST` |
| `ApiCallOutcome` | 18종(§7.8) |
| `ApiCallSource` · `ApiCallBranch` · `ApiSecretStatus` | `PUBLIC｜SIMULATION_LIVE｜CONNECTION_TEST` · `CONDITION｜DEFAULT｜FAILURE｜NOTICE` · `NOT_REQUIRED｜CONFIGURED｜MISSING` |
| `API_CONNECTION_LIMITS` | 이름 50 · 설명 300 · 샘플 5개 · 샘플 본문 16,384B · 라벨 50 · 레이트 1~600(기본 120, 개인정보 조회형 30) · 타임아웃 하한 1000 · 연결당 동시 10 · 전체 동시 50 · `secretRef` `^[A-Z0-9_]{1,40}$` · `authHeaderName` `^[A-Za-z0-9-]{1,64}$` · 금지 헤더명(`host`·`content-length`·`content-type`·`cookie`·`set-cookie`·`transfer-encoding`·`connection`·`accept`·`user-agent`·`te`·`upgrade`·`proxy-*`·`x-forwarded-*`) |
| `ApiSampleResponseSchema` | `{ label ≤50, httpStatus 100~599, body: unknown }` — body는 JSON 객체/배열, 직렬화 16KB 이하 |
| `CreateApiConnectionSchema` | 이름·설명·`baseUrl`·`allowedMethods`(1~2, 중복 금지)·`authType`·`authHeaderName?`·`secretRef?`·`timeoutMs?`·`rateLimitPerMin?`(미지정 시 서비스가 `personalDataLookup ? 30 : 120`)·`allowRawPersonalData`(기본 false)·`personalDataLookup`·`sampleResponses`·`enabled` + `confirmRawPersonalData?: string` · superRefine(`authType≠NONE ⇒ secretRef` · `API_KEY_HEADER ⇒ authHeaderName`) |
| `UpdateApiConnectionSchema` | 전 필드 선택 + `confirmRawPersonalData?`. **`allowRawPersonalData`를 false→true로 바꾸는(또는 true로 생성하는) 요청은 `confirmRawPersonalData === 연결 이름`이어야 한다**(아니면 `400 CONFIRM_NAME_MISMATCH` — 영구삭제 확인 규약 재사용) |
| `ApiConnectionSchema`(상세 응답) | 저장 필드 전부(시크릿 **값** 필드 없음) + `secretStatus` · `insecureHttp`(스킴 http) · `circuitOpen` · `referencingNodeCount` · `stats24h { calls, failures }` |
| `ApiConnectionListItemSchema` | 상세에서 `sampleResponses` 본문 제외(`sampleCount`만) + `baseUrlHost` |
| `ApiConnectionPickerItemSchema` | `id`·`name`·`allowedMethods`·`enabled`·`personalDataLookup`·`allowRawPersonalData`·`sampleLabels[]` — **`baseUrl`·`secretRef`·`authType` 없음**(FR-L2-1) |
| `ApiConnectionSamplesResponseSchema` | `{ items: ApiSampleResponse[] }`(편집기 미리보기 — §21 D-10) |
| `ApiConnectionTestRequestSchema` · `ApiConnectionTestResultSchema` | `{ path = "/" }`(자리표시자 금지) · `{ outcome, httpStatus?, latencyMs, contentType?, bytes?, jsonParsable, blockedAddress?, guidance }` — **본문 없음** |
| `ApiCallResult`(엔진 입력) | `{ kind:'SUCCESS', httpStatus, json } ｜ { kind:'FAILURE', outcome: Exclude<ApiCallOutcome,'SUCCESS'｜'MAPPING_MISSING'>, httpStatus? }` |
| `ApiCallLogItemSchema` · `ApiCallLogListQuerySchema` · `ApiCallLogSummarySchema` | §9.2 · §12.2 |
| `SimulateApiMode` · `SimulateMockResponseSchema` · `ApiStepViewSchema` | `MOCK｜LIVE` · `{ sampleLabel } ｜ { httpStatus, body } ｜ { failure }` · §6.2 |

`conversation.ts`: `SimulateRequestSchema`(:72-94)에 `apiMode: SimulateApiMode.default('MOCK')`·`mockResponse: SimulateMockResponseSchema.optional()` · `SimulateResponseSchema`(:117-129)에 `apiStep: ApiStepViewSchema.optional()`. 의존 방향 `conversation.ts → legacy-api.ts → dialogue.ts` 단방향.

### 4.5 `packages/shared-types/src/api-mapping.ts` 신설 — 경로 추출·조건 판정·치환 (zod 무의존 순수 함수)

| 함수 | 규칙 |
|---|---|
| `parseResponsePath(path)` | 문법 = `토큰(.토큰)*`, 토큰 = `키([정수])*` 또는 선두 `[정수]`. 키 = `/^[^.\[\]\s"'`\\]{1,64}$/u`, 정수 0~9999. **와일드카드·필터식·재귀 하강·슬라이스·스크립트 없음.** 금지 키 `__proto__`·`constructor`·`prototype`. 깊이(토큰 수) ≤10. 위반이면 `null`(저장 시 거부 — `ApiResponsePathSchema` refine) |
| `extractPath(json, path)` | 파싱 결과를 따라가며 **자기 속성만**(`Object.prototype.hasOwnProperty.call`) 읽는다. 배열 인덱스는 `Array.isArray`일 때만. `{ found:false }` / `{ found:true, value }` |
| `toComparable(v)` | 문자열 그대로 · 유한 숫자 `String()` · 불리언 `'true'｜'false'` · `null`/없음 → `undefined`(없음) · 객체·배열 → `undefined`(비교 불가, CONTAINS 제외) |
| `evaluateApiConditions(json, conditions)` | **위에서부터 첫 일치의 인덱스**(0부터) 또는 `null`. 연산자 의미는 요구사항 §4.4.3 그대로 — `EQ`/`NEQ` 대소문자 구분 완전 일치(값 없으면 EQ 거짓·NEQ 참) · `GT…LTE`는 양쪽이 `/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/`이고 유한일 때만(아니면 거짓 — `"0x10"`·`""` 차단) · `CONTAINS` 문자열 부분 일치 또는 배열 원소(스칼라) 문자열화 일치 · `EXISTS` 값 있고 `null` 아님. 조건 `value` 미지정은 `""` |
| `buildApiVariables(json, mappings)` | `{ vars: Record<string,string>, missingRequired: string[], dropped: string[] }` — 스칼라는 `normalizeApiValue()`, 객체·배열은 `""` + `dropped`(비스칼라), 없음/`null`은 `required`면 `missingRequired` |
| `normalizeApiValue(v, maxLength)` | 문자열화 → **제어·서식 문자 제거**(`\u0000-\u001F`·`\u007F-\u009F`·`​-‏`·` - `·`‪-‮`·`⁦-⁩`) → **코드 포인트 기준** `maxLength` 절단 |
| `renderApiTokens(text, vars)` | 정규식 `/\{api\.([a-zA-Z][a-zA-Z0-9_]{0,29})\}/g`만 치환 — 없는 이름은 `""`. **그 외 `{...}`는 문자 그대로 유지**(AC-L3-8). 컨텍스트 완료 메시지의 `{슬롯}` 치환(`context-session.ts:135-138`)과 **다른 함수**이며 서로 호출하지 않는다 |

엔진(`api-call.ts`)·웹 편집기 미리보기·시뮬레이터가 **같은 함수**를 호출한다(복제 0). 256KB 응답·매핑 20·조건 10 기준 5ms 이내(NFR-LP4) 단위 벤치.

### 4.6 trace · 설계 점검 · 흐름 코드 (`packages/shared-types/src/dialogue-engine.ts`)

- `TraceStageEnum`(:96)에 `'API'` 추가.
- `TraceCodeEnum`(:99-138)에 11종: `API_CALL_REQUESTED`(targetId = 연결 id) · `API_CALL_SUCCEEDED` · `API_CALL_FAILED`(message = 결과 코드 — 폴백 동봉본은 `NOT_EXECUTED`) · `API_BRANCH_MATCHED`(message = 조건 번호) · `API_BRANCH_DEFAULT` · `API_BRANCH_FAILURE` · `API_FIXED_NOTICE`(message = `FAILURE｜NO_MATCH｜CALL_LIMIT`) · `API_MAPPING_MISSING`(targetName = 매핑 이름) · `API_VALUE_DROPPED`(targetName = 매핑 이름 — 비스칼라·치환 후 빈 필드) · `API_CALL_LIMIT` · `API_MOCKED`(message = `SAMPLE｜INLINE｜FAILURE｜NO_SAMPLE`). **trace에 바인딩 값·응답 값·URL을 넣지 않는다**(FR-L4-10).
- `DesignIssueCode`(:191-200)에 10종(§5.9 — ⑧은 기존 `BROKEN_REFERENCE` 재사용).
- `FlowNode.via`에 `'API_BRANCH'`.
- **v1 `API_CONDITION`의 trace는 무변경**(`UNSUPPORTED_OUTPUT`, `targetId: 'API_CONDITION'`) — 요구사항 FR-L1-3의 사유 `LEGACY_FORMAT` 병기는 AC-L1-2(바이트 동일)와 충돌해 넣지 않는다(§21 D-1).

---

## 5. 엔진 변경 명세 (`packages/dialogue-engine`)

### 5.1 계약 — `src/api-call.ts`(신규)

```ts
export interface ApiBoundValue { value: string; source: 'CONST' | 'SLOT' }
export interface ApiCallRequestSpec {
  connectionId: string;
  method: 'GET' | 'POST';
  pathTemplate: string;                                   // 치환 전(로그용)
  pathValues: ApiBoundValue[];                            // 자리표시자 순서
  query: Array<{ name: string; value: ApiBoundValue }>;
  body: Array<{ field: string; value: ApiBoundValue }>;
}
export interface ApiCallSuspension {
  readonly nodeId: string;                                // API_CONDITION을 가진 노드(DIALOG_MOVE로 들어간 노드일 수 있다)
  readonly outputIndex: number;                           // 그 노드 outputs 내 위치
  readonly payload: ApiConditionOutputPayloadV2;
  /** null = 바인딩 누락 → 호출 금지, BINDING_MISSING으로 재진입해야 한다(FR-L4-2). */
  readonly request: ApiCallRequestSpec | null;
  /** @internal 재진입 전용 불투명 상태 — 소비자는 읽지 않는다. */
  readonly resumeState: ApiResumeState;
}
export interface ApiStepResult {
  outcome: ApiCallOutcome;                                // MAPPING_MISSING은 엔진이 판정
  httpStatus?: number;
  branch: ApiCallBranch;
  conditionIndex?: number;                                // 1부터
  /** ★ 원본 값 — 관리자 표시 전 maskPii 필수, 공개 응답·로그·trace 금지 */
  variables: Record<string, string>;
}
export type EngineResolution = DialogueResolution & { apiCall?: ApiCallSuspension };
export interface DialogueTurnResult extends DialogueResolution {   // turn.ts — 기존 필드 불변
  nextState: ConversationState;
  stateDiscarded: StateDiscardReason[];
  /** 정지했을 때만. 이때 outputs/nextState/trace는 "호출 실패(NOT_EXECUTED)" 가정의 폴백 결과다(FR-L4-9). */
  apiCall?: ApiCallSuspension;
  /** resumeAfterApiCall 결과에만. */
  apiStep?: ApiStepResult;
}
export function resumeAfterApiCall(
  turn: DialogueTurnResult & { apiCall: ApiCallSuspension },
  result: ApiCallResult,
  bundle: DialogueBundle,
  now: Date,
  options?: ResolveOptions,
): DialogueTurnResult;                                     // 반환값에 apiCall 없음, apiStep 있음
```
- `ApiResumeState`(내부)는 정지 시점의 `input`·`normalizedInput`·`matchedNodeId`·`matchedIntentId`·`homonymResolution`·**정지 전까지의 trace**(상태 폐기 trace 포함)·`carry`(정지 전 출력 = 폼 완료 문구 + 앞 아웃풋)·`unsupported`·`hops`·`hopLimit`·`sessionFallback`(`execResult.nextSession ?? nextSessionOverride ?? null` 규칙의 값)·`existingSession`(전환 고지 판단)·`stateDiscarded`를 담는다.
- **바인딩 원문을 담는 곳은 `request`뿐**이며 어떤 직렬화 경로(응답·로그)에도 실리지 않는다 — 공개·시뮬레이터 응답은 필드를 명시 나열해 만든다(`public-conversation.service.ts:163-168`, `simulation.service.ts:85-107`). 이 명시 나열 규약을 깨는 스프레드(`...result`) 응답 조립을 code-reviewer 점검 항목으로 둔다.

### 5.2 `executeOutputs` 변경 (`outputs.ts`)

| 옵션/반환 | 의미 | 기본값(= 기존 동작) |
|---|---|---|
| `sourceNodeId?` | 시작 아웃풋 목록의 소유 노드 id. `DIALOG_MOVE` 후에는 대상 노드 id로 바뀐다 | 없음 |
| `initialHops?` | hop 초기값(재진입 시 이어서 센다) | 0 |
| `completedForm?` | `{ contextVariableId, values }` — **이번 턴에 완료된 폼**만(§5.3) | 없음 |
| `apiCallsRemaining?` | `1`이면 v2 `API_CONDITION`에서 정지, `0`이면 턴당 1회 초과 처리 | 1 |
| `apiVariables?` | 있으면 텍스트 필드 `{api.*}` 치환(§8) | 없음(치환 안 함) |
| 반환 `suspended?` | `{ nodeId, outputIndex, payload, request, hops }` | — |
| 반환 `hops` | 최종 hop | — |

`API_CONDITION` 분기(`outputs.ts:94-99` 대체):
1. `!isApiConditionV2(payload)` → **기존과 동일**(`unsupported.push` + `UNSUPPORTED_OUTPUT` trace) — v1 바이트 동일.
2. v2이고 `apiCallsRemaining === 1` → `bindRequest(payload, completedForm)`로 `request`(또는 null) 생성 → `trace(API_CALL_REQUESTED, targetId=connectionId)` → `suspended`를 채우고 **`break outer`**(뒤 아웃풋 실행 안 함 — J-6). `out`이 비어 있어도 `EMPTY_OUTPUT` 폴백을 넣지 않는다(재진입이 채운다).
3. v2이고 `apiCallsRemaining === 0` → `trace(API_CALL_LIMIT)` → `failureNodeId`가 있고 활성이면 hop+1 후 그 노드 아웃풋으로 큐 교체(`DIALOG_MOVE`와 같은 처리 — hop 초과 시 기존 `HOP_LIMIT_EXCEEDED`), 없거나 끊겼으면 `API_FIXED_NOTICE(CALL_LIMIT)` + 실패 고정 문구 출력 후 `break outer`.

`bindRequest`: `CONST` → 그대로. `SLOT` → `completedForm?.contextVariableId === binding.contextVariableId`이고 `values[slotName]`이 공백 제거 후 비어 있지 않을 때만. 하나라도 불충족이면 `request = null`(FR-L4-2). 값의 PII 마스킹은 엔진이 하지 않는다(연결 설정은 API 계층 소관 — §7.1 ⑦).

### 5.3 `resolver.ts` 변경

- S1 폼 완료(`resolver.ts:201-204`)에서 `completedForm = { contextVariableId: def.id, values: advance.state.filledValues }`를 보관하고, **S3 노드 실행(:323)과 S6 폴백 노드 실행(:75)** 에 전달한다. 버튼 진입(`resolveByNodeId` :495)은 폼 완료가 없으므로 전달하지 않는다(AC-L3-12).
- 세 실행 지점에서 `execResult.suspended`가 있으면 `EngineResolution.apiCall`을 구성해 반환한다(`resumeState`에 위 필드). 나머지 필드(`outputs` 등)는 **`resolveTurn`이 폴백으로 채운다**(§5.7).
- 되묻기(:262-274)는 노드 매칭 전에 반환하므로 API 호출이 없다(EX-L-17 — 기존 흐름 그대로).

### 5.4 재진입 알고리즘 — `resumeAfterApiCall()`

```
입력: suspension(s), result(r)
1. trace ← s.resumeState.trace 복사
2. r = FAILURE(o)            → trace(API_CALL_FAILED, message=o) → 분기 = FAILURE, outcome = o
   r = SUCCESS(json, status) → trace(API_CALL_SUCCEEDED)
       m = buildApiVariables(json, payload.responseMappings)
       m.missingRequired ≠ ∅  → trace(API_MAPPING_MISSING × n) → outcome = MAPPING_MISSING, 분기 = FAILURE
       m.dropped 각각         → trace(API_VALUE_DROPPED)
       i = evaluateApiConditions(json, payload.conditions)
       i ≠ null → 분기 = CONDITION(i+1), 대상 = conditions[i].nextNodeId, trace(API_BRANCH_MATCHED, message=i+1)
       i = null → 분기 = DEFAULT, 대상 = payload.defaultNodeId, trace(API_BRANCH_DEFAULT)
3. 분기 = FAILURE → 대상 = payload.failureNodeId, trace(API_BRANCH_FAILURE)
4. 대상 미지정              → 고정 문구(FAILURE→실패 문구 / DEFAULT→불일치 문구), trace(API_FIXED_NOTICE), branch = NOTICE
   대상 노드가 없음·비활성 → trace(BROKEN_REFERENCE, targetId) + 같은 고정 문구, branch = NOTICE   (FR-L4-6)
   대상 있음              → hops+1(> hopLimit이면 기존 HOP_LIMIT_EXCEEDED 문구)
                            exec = executeOutputs(target.outputs, bundle, now, { sourceNodeId: target.id,
                                   initialHops: hops+1, apiCallsRemaining: 0, apiVariables: (실패면 {} | m.vars),
                                   existingSession: s.resumeState.existingSession, hopLimit })
5. outputs = carry + (exec.outputs | [고정 문구])
   unsupportedOutputs = resumeState.unsupported + exec.unsupported
   nextSession = exec.nextSession ?? resumeState.sessionFallback
   nextState = { version: 1, contextSession: nextSession, pendingClarify: null }
   matchedNodeId = 최초 매칭 노드(변경 없음 — FR-L4-13)
   apiStep = { outcome, httpStatus, branch, conditionIndex, variables: (실패면 {} | m.vars) }
```
- 분기 노드가 `CONTEXT_FORM`으로 폼을 시작할 수 있다 — 다음 상태는 **재진입 결과로 확정**된다(PENDING을 재사용하지 않은 이유 — ADR-0034 대안 D).
- 분기 노드의 v2 `API_CONDITION`은 `apiCallsRemaining: 0`이라 §5.2 ③(턴당 1회)로 처리된다(AC-L3-6).

### 5.5 텍스트 치환 — §8 참조

### 5.6 고정 문구 (`constants.ts`, 내부 용어 금지 — FR-N2-24 규약)

- `API_FAILURE_NOTICE = '지금은 요청하신 정보를 확인할 수 없어요. 잠시 후 다시 시도해 주세요.'`
- `API_NO_MATCH_NOTICE = '확인한 결과에 맞는 안내를 찾지 못했어요. 다른 방법으로 문의해 주세요.'`
- 턴당 1회 초과(`CALL_LIMIT`)도 실패 문구를 쓴다. 문구 커스터마이즈는 분기 노드로 한다(FR-L4-8).

### 5.7 폴백 결과 동봉 (FR-L4-9)

`resolveTurn`은 `resolution.apiCall`이 있으면 **내부에서 `resumeAfterApiCall(…, { kind:'FAILURE', outcome: NOT_EXECUTED })`를 먼저 계산**해 그 `outputs`·`nextState`·`trace`·`unsupportedOutputs`를 결과 본체로 쓰고 `apiCall`을 붙여 반환한다(`NOT_EXECUTED`는 엔진 내부 표식 — `ApiCallOutcome`에 없고 trace message로만 보인다). 따라서 `apiCall`을 무시하는 소비자도 **실패 분기와 같은 출력**(최소 1건)을 받는다. 계산 비용은 분기 노드 아웃풋 1회 실행으로 무시 가능하며, API 노드가 없는 턴에서는 발생하지 않는다.

### 5.8 참조 무결성 편입 (J-17)

```ts
export function getOutgoingNodeRefs(node: DialogNode): { moveTargets: string[]; buttonTargets: string[]; apiTargets: string[] };
// apiTargets = API_CONDITION(v1·v2 모두)의 conditions[].nextNodeId + (v2) defaultNodeId·failureNodeId
```
| 지점 | 변경 | 결과 |
|---|---|---|
| ① 저장 검증 `dialog-nodes.service.ts:92-104` | `apiTargets`를 `nodeTargetIds`에 합류(오류 필드 `outputs.apiCondition.nextNodeId`) | 끊긴 참조 저장 `404 INVALID_REFERENCE`(기존 코드·상태 — §21 D-3) |
| ② 삭제 409 `reference-check.service.ts:132-158` | 자체 JSON 탐색을 **`getOutgoingNodeRefs()` 재사용으로 교체**(v1 포함) | `409 NODE_IN_USE`(AC-L1-7) · 규칙 복제 0 |
| ③ `computeIncomingCounts`(:21-30)·설계 점검 끊긴 참조(:143-155)·고아 판정(:170-180) | 세 배열 합산 | API 분기로만 참조되는 노드가 고아가 아니다(AC-L1-8) |
| ③' 흐름 트리 `flow-tree.ts:25-34` | `apiTargets` → 자식 `via: 'API_BRANCH'` | 흐름 요약에 분기 표시 |
| ④ 스냅샷 무결성 `snapshot-integrity.ts:83-101` | `BROKEN_REFERENCE_NODE_API` 경고(캡처·복원 모두 경고 — EX-H-5 규약) | — |

- API 노드가 없는 번들에서 세 배열 합은 기존과 같다 → 들어오는 참조 수·고아·흐름·경고 **불변**(FR-0-97).
- 순환 검사(`findMoveCycles` :33-75)는 `DIALOG_MOVE` 전용 그대로 — API 분기는 턴당 1회 제한으로 턴 내 무한 루프가 불가능하다.

### 5.9 설계 점검 신규 항목 (FR-L3-3/4, 선택 컨텍스트)

`validateDialogueDesign(bundle, now?, context?: DesignValidationContext)` — `context.apiConnections?: ReadonlyMap<string, { name, enabled, secretStatus, insecureHttp, personalDataLookup, allowRawPersonalData, allowedMethods }>`. 컨텍스트가 없으면 연결 의존 항목(⑧~⑪)만 건너뛴다(엔진 순수성 유지 — 데이터는 `DialogNodesService.validate()`가 카탈로그에서 1회 조회해 넘긴다).

| # | 코드 | 심각도 | 조건 |
|---|---|---|---|
| ① | `API_OUTPUT_NOT_LAST` | WARNING | v2 `API_CONDITION` 뒤에 아웃풋 있음("실행되지 않습니다") |
| ② | `API_MULTIPLE_OUTPUTS` | ERROR | 한 노드에 v2 2개 이상 |
| ③ | `API_NESTED_CALL` | WARNING | 분기 대상(조건·기본·실패) 노드가 v2를 가짐 |
| ④ | `API_LEGACY_FORMAT` | WARNING | v1 형식("연결 방식으로 전환 필요") — 기존 `UNSUPPORTED_OUTPUT` INFO(:182-195)에서 v1은 빠진다(`isUnsupportedOutput` 사용) |
| ⑤ | `API_SLOT_BINDING_UNREACHABLE` | WARNING | SLOT 바인딩의 폼이 그 노드의 `contextVariableId` 조건이 아님(버튼·이동으로만 도달 → 값이 비어 실패) |
| ⑥ | `API_FAILURE_BRANCH_MISSING` | INFO | `failureNodeId` 미지정(고정 문구로 안내됨) |
| ⑦ | `API_TOKEN_IN_URL_FIELD` | WARNING | `LINK.url`·`IMAGE.imageUrl`·`CARD.imageUrl`·버튼 `LINK` 값에 `{api.` 포함(치환되지 않음) |
| ⑧ | `BROKEN_REFERENCE`(기존 코드) | ERROR | 연결 id가 컨텍스트에 없음("존재하지 않는 API 연결") |
| ⑨ | `API_CONNECTION_UNAVAILABLE` | WARNING | 연결 사용 중지 · `secretStatus=MISSING` · 메서드가 연결 허용 목록 밖 |
| ⑩ | `API_CONNECTION_INSECURE` | INFO | `http` 연결 |
| ⑪ | `API_PERSONAL_DATA_LOOKUP` · `API_RAW_PERSONAL_DATA` | INFO | 개인정보 조회형(레거시 2요소 대조 권고 — J-19) · 원문 송신 연결 |

---

## 6. 소비자 통합 — 턴 완결

### 6.1 공개 대화 (`public-conversation.service.ts`)

```
②.5 입구 금지어(불변) → ③④ 의미 점수(불변) → resolveTurn (:134)
→ messageId = randomUUID()            (기존 :139에서 앞당김 — 값만 쓰므로 동작 동일)
→ ④.5 [신규] result.apiCall 있으면: result = await legacyApi.completeTurn(result, { chatbotId, conversationLogId: messageId, source:'PUBLIC', bundle, index, now })
          ─ completeTurn은 예외를 던지지 않는다. 예상 밖 예외면 result(폴백 동봉본) 그대로 사용 + 경고 로그(결과 코드만)
→ ⑤ renderOutbound → ⑤.5 maskOutbound (불변 — 외부 값 포함 최종 출력 전체, FR-L4-14 · AC-L3-10)
→ isAnswered = judgeAnswered(trace)   (API_FIXED_NOTICE는 폴백 코드 — false)
→ ⑦ RAG 판정: shouldRunRag({ …, apiTurn: 원본 결과에 apiCall이 있었는가 })  → API 턴은 항상 false(FR-L4-12 · AC-L3-15)
→ ⑩ record({ …, apiNotice: apiStep?.branch === 'NOTICE' })  (fire-and-forget, 불변)
```
- **API 노드가 없는 턴**: `result.apiCall === undefined` 분기 1개가 유일한 추가 비용이다(추가 조회·계산 0 — NFR-LP1).
- `ConversationLog`: `matchedNodeId` = 최초 매칭 노드, `botResponse` = 치환된 최종 출력(기존 PII 마스킹 경유). 고정 문구 턴은 `isAnswered=false`이고 **미응답 큐에 적재하지 않는다**(`shouldCollect` 사유 `API_NOTICE` — AC-L3-14). 분기 노드로 끝난 턴(실패 분기 포함)은 노드 응답이라 `isAnswered=true`다.

### 6.2 시뮬레이터 (`simulation.service.ts`)

`simulate(chatbotId, dto, actor)` — `resolveTurn`(:74) 후 `result.apiCall`이 있으면:

1. **모드 결정** — `dto.apiMode === 'LIVE'`이고 아래 **전부** 만족할 때만 LIVE, 아니면 **MOCK으로 격하 + `downgradeReason`**(오류가 아니다 — FR-L7-2 권고):
   `hasPermission(actor.role, 'simulation:write')`(`deploy-schedule.service.ts:75` 선례) → 아니면 `NO_PERMISSION` · 메서드 GET → `METHOD_NOT_GET` · **저장된 노드와 동일**: 기본 번들(`baseBundle`, :53)에 `nodeId` 노드가 있고 `serializeOutputsForDiff([base.outputs[outputIndex]]) === serializeOutputsForDiff([정지한 아웃풋])`(`common/lib/output-diff.ts:23` 재사용 — 오버레이로 **같은 id를 덮어쓴 경우**까지 차단, AC-L6-3) → `UNSAVED_NODE` · 연결 사용 중 → `CONNECTION_DISABLED` · `LEGACY_API_ENABLED` → `FEATURE_DISABLED`.
2. LIVE → `legacyApi.completeTurn(result, { source:'SIMULATION_LIVE', chatbotId, … })` — `ApiCallLog` 1행(`SIMULATION_LIVE`), `ConversationLog` 없음(FR-L7-7).
3. MOCK → `catalog.loadMockSources([connectionId])` → `completeApiTurnSync(result, mockExecutor(dto.mockResponse), …)`. 로그 0.
4. 응답 `apiStep: { mode, downgradeReason?, connectionId, connectionName, method, pathTemplate, outcome, httpStatus?, latencyMs?, branch, conditionIndex?, sampleLabel?, variables: [{ name, value: maskPii(value).maskedText }] }` — 해석된 URL·바인딩 원문 없음(FR-L7-3 · AC-L6-5).

목 원천 규칙(`mock-outcome.ts`, 순수): `mockResponse` 지정 시 그것 — `{sampleLabel}`(없는 라벨 → `400 VALIDATION_FAILED`) · `{httpStatus, body}`(2xx면 SUCCESS, 아니면 `HTTP_ERROR`) · `{failure}`. 미지정 → 연결의 **첫 번째 샘플**, 샘플이 없으면 **`FAILURE(INVALID_RESPONSE)` + trace `API_MOCKED`(message `NO_SAMPLE`)** 로 실패 분기를 재현한다(FR-L7-1 · §21 D-17). 연결이 없거나 사용 중지면 현실과 같게 `CONNECTION_MISSING`·`CONNECTION_DISABLED` 실패. 모든 목 턴은 trace `API_MOCKED`를 남긴다.

### 6.3 비교 실행 (`compare()` :169-212)

A/B 두 번들의 v2 `connectionId` 합집합으로 목 원천을 **요청당 1회** 로드하고, 모든 턴의 A·B에 **같은 목 원천**을 쓴다(FR-L7-4). 실제 호출 경로가 없다(LIVE 파라미터 없음).

### 6.4 TC 대량 실행 (`test-run.executor.ts`)

- `execute()`에서 번들 로드(:123) 직후 `catalog.loadMockSources(ids(bundleA ∪ bundleB))` **실행당 1회**(N+1 금지).
- `runSide`(:408 이후): `result.apiCall`이면 `completeApiTurnSync(result, mockExecutor(firstSample), bundle, now, { index })` → 그 결과의 `nextState`로 다음 턴을 잇는다. `SideOutcome.apiMock` = 샘플 해시 앞 8자리 | `'NO_SAMPLE'`(마지막 턴 기준 — 판정 규약과 같음) → `flush`(:300-342)가 `apiMockA/B`에 기록(FR-L7-6).
- 기존 `unsupportedCountA`(:320)는 v1·`SCENARIO`·`SURVEY`만 센다(`일부 아웃풋 미실행` 배지 — FR-L7-5).
- 판정은 순수 함수 목이라 **결정론적**이며 처리량 500 TC/분 불변(NFR-LP6 · AC-L6-6). `ApiCallLog`·`ConversationLog` 0건.
- ⚠ 응답 해시 불연속(FR-L7-6): v2 노드를 포함한 TC는 No.26 전(미지원 안내 폴백)·후(목 분기)의 `outputsHash`가 다르다. 실행 비교 화면은 **두 실행 중 한쪽만 `apiMock`이 있거나 샘플 해시가 다르면** "외부 API 실행 방식 또는 샘플 응답이 달라 비교 결과가 달라질 수 있습니다" 안내를 1회 표시한다(ADR-0029 버전 축 설명과 연계).

### 6.5 공용 헬퍼 — `common/lib/api-turn.ts` (NFR-LM4)

```ts
export type SyncApiExecutor = (s: ApiCallSuspension) => { result: ApiCallResult; mock?: { sampleHash8?: string; sampleLabel?: string; noSample?: boolean } };
export function completeApiTurnSync(turn: DialogueTurnResult, exec: SyncApiExecutor, bundle, now, options?): { turn: DialogueTurnResult; mock?: … };
```
- 소비자별로 달라지는 것은 **실행기(목/실제) 하나**다. 실제 실행기(비동기)는 `LegacyApiService.completeTurn()` 안에 있고 같은 `resumeAfterApiCall`을 호출한다. `request === null`(바인딩 누락)은 두 경로 모두 **실행기를 부르지 않고** `FAILURE(BINDING_MISSING)`로 재진입한다.

---

## 7. 외부 호출 서비스

### 7.1 `LegacyApiService.completeTurn()` 처리 순서 (FR-L4-11)

| 단계 | 판정 | 실패 결과(외부 호출 0) |
|---|---|---|
| ① | `LEGACY_API_ENABLED` | `FEATURE_DISABLED` |
| ② | `suspension.request === null` | `BINDING_MISSING` |
| ③ | `catalog.findForCall(connectionId)` — **PK 1회 조회, 캐시 없음**(사용 중지 즉시 반영 — §21 D-15) | 없음 → `CONNECTION_MISSING` · `enabled=false` → `CONNECTION_DISABLED` |
| ④ | `method ∈ allowedMethods` | `METHOD_NOT_ALLOWED` |
| ⑤ | `authType≠NONE`이면 `secretResolver.status(secretRef) === CONFIGURED` | `SECRET_MISSING` |
| ⑥ | `gate.tryAcquire(connectionId, rateLimitPerMin)` | `CIRCUIT_OPEN` · `RATE_LIMITED`(대기 없음 — NFR-LP3) |
| ⑦ | 송신 값 PII: `allowRawPersonalData=false`면 **SLOT 값에만** `maskPii()`(`packages/pii-mask` — 복제 금지). 값이 바뀌면 `personalDataMasked=true`. `CONST`는 비적용(FR-L6-1) | — |
| ⑧ | `buildLegacyRequest(connection, spec, maskedValues)`(§7.2) | `BLOCKED_URL` |
| ⑨ | `client.send(req, auth, { timeoutMs: min(conn.timeoutMs, MAX), maxBytes })`(§7.3) | `TIMEOUT`·`NETWORK_ERROR`·`BLOCKED_ADDRESS`·`REDIRECT_NOT_ALLOWED`·`RESPONSE_TOO_LARGE` |
| ⑩ | 응답 판정: 2xx가 아니면 `HTTP_ERROR(status)` · Content-Type이 `application/json`·`*/*+json`이 아니면 `INVALID_RESPONSE` · `JSON.parse` 실패·빈 본문 → `INVALID_RESPONSE` | — |
| ⑪ | `gate.release(connectionId, classify(outcome, status))` | — |
| ⑫ | `resumeAfterApiCall(turn, result, …)` → `apiStep.outcome`(MAPPING_MISSING은 여기서 결정) | — |
| ⑬ | `void callLog.record({ … 메타데이터만 … })` | — |

- 어떤 단계의 예외도 삼켜 `NETWORK_ERROR`로 수렴한다(엔진 가용성 규약과 대칭). ⑥에서 획득한 슬롯은 `finally`에서 반드시 반납한다(`RagGateService` 슬롯 누수 교훈 — `public-conversation.service.ts:243-255`).
- 서버 로그는 `connectionId · nodeId · outcome · httpStatus · latencyMs · responseBytes`와 Node 오류 코드(`ECONNREFUSED` 등)만(FR-0-105). **예외 `message`를 로그에 넣지 않는다**(호스트 내부 경로·해석된 URL이 섞일 수 있다).

### 7.2 요청 조립 — `lib/build-request.ts` (★ `ValidatedLegacyRequest` 생성 유일 파일)

- **호스트 해석은 WHATWG `URL`로만** 한다 — `http://0x7f000001`·`http://127.1`·`http://017700000001`은 `hostname`이 `127.0.0.1`로 정규화되어 IP 정책에 걸린다(NFR-LS1).
- `baseUrl` 규칙(저장 시 · `connection-rules.ts`): `SafeUrlSchema`(`common.ts:155-160`) + `username`·`password`·`search`·`hash` 비어 있음 + `pathname`에 `%2e`·`..`·`//` 금지. `http`는 허용하되 `insecureHttp` 경고.
- 노드 `path` 규칙: `/`로 시작 · ≤300 · 허용 문자 `[A-Za-z0-9\-._~/!$&'()*+,;=:@]`와 `{0}`~`{4}` · `..` 세그먼트·`//`·`\`·`?`·`#`·`%`·제어문자 금지(쿼리는 `query`로만 — FR-L3-1).
- 조립: `origin + basePath(끝 "/" 제거) + path` 문자열에서 `{n}` → `encodeURIComponent(value)`(`/`·`?`·`#`·`%`·`"` 모두 인코딩). **경로 값이 `.`·`..`(대소문자 무관 퍼센트 디코딩 후 동등 포함)이거나 빈 문자열이면 `BLOCKED_URL`** — WHATWG가 `%2e%2e`도 `..`로 해석해 상위 경로로 올라가기 때문이다. 쿼리 = `encodeURIComponent(name)=encodeURIComponent(value)`를 `&`로 연결.
- **재파싱 검증**: `new URL(조립 문자열)`의 `protocol`·`hostname`·`port`가 `baseUrl`과 같고 `pathname`이 조립한 경로와 **문자 그대로 같아야** 한다(정규화가 일어났다면 구조가 바뀐 것 — `BLOCKED_URL`). 이것으로 CRLF·경로 이탈·호스트 변경을 막는다(AC-L4-6).
- 본문(POST): `field`(세그먼트 `^[A-Za-z_][A-Za-z0-9_]{0,49}$`, 깊이 ≤3, 금지 키)를 따라 **객체를 만든 뒤 `JSON.stringify`** — 문자열 이어붙이기 없음. 값은 전부 문자열(1차 — 타입 지정 바인딩은 범위 밖).
- 헤더는 조립기가 만들지 않는다 — 전송 직전 클라이언트가 고정 집합만 붙인다(§7.3).
- 결과 `ValidatedLegacyRequest`는 `unique symbol` 브랜드를 가진 불투명 객체이며 **이 파일 밖에서 만들 수 없다**(§13 L-3).

### 7.3 `LegacyApiHttpClient` — 유일 출구 (FR-0-99)

```ts
@Injectable() export class LegacyApiHttpClient {
  send(req: ValidatedLegacyRequest, auth: { authType; authHeaderName?; secretRef? }, limits: { timeoutMs; maxBytes }): Promise<LegacyHttpResult>;
}
type LegacyHttpResult =
  | { kind: 'RESPONSE'; status: number; contentType?: string; bytes: number; body: Buffer }
  | { kind: 'ERROR'; outcome: 'TIMEOUT'|'NETWORK_ERROR'|'BLOCKED_ADDRESS'|'REDIRECT_NOT_ALLOWED'|'RESPONSE_TOO_LARGE'|'SECRET_MISSING'; blockedAddress?: string; errorCode?: string };
```
처리(한 개의 **데드라인 `AbortController`** 가 DNS·연결·헤더·본문 전체를 덮는다 — slow-loris 방어, EX-L-23):
1. `hostname`이 IP 리터럴이면 그 주소만, 아니면 `LegacyDnsResolver.lookupAll(hostname)`(`dns.lookup({ all:true, verbatim:true })`) — **1회만** 해석한다.
2. **해석된 모든 주소**를 `ip-policy.classify()`(§7.4) — 하나라도 절대 차단이면, 또는 사설인데 allowlist에 없으면 `BLOCKED_ADDRESS`(첫 위반 주소를 `blockedAddress`로 — 관리자 연결 테스트 안내용).
3. 인증 헤더: `secretResolver.get(secretRef)`(이 클라이언트와 리졸버만 시크릿 값을 만진다 — FR-0-98) → `BEARER` `Authorization: Bearer v` · `BASIC` `Authorization: Basic base64(v)` · `API_KEY_HEADER` `<authHeaderName>: v`. 값 없음 → `SECRET_MISSING`.
4. 고정 헤더: `Accept: application/json` · (POST) `Content-Type: application/json` · `User-Agent: ChatBot-LegacyConnector/1` · `Connection: close`. **노드·연결에서 임의 헤더를 받지 않는다**(FR-L5-2).
5. `LegacyTransport.request({ url, method, headers, body, pinnedAddresses, signal, maxBytes })` — 실제 구현 `NodeHttpTransport`:
   - `node:http`/`node:https` `request()`에 **`lookup` 옵션으로 검증된 주소만 반환하는 함수**를 넘긴다(`opts.all`이 true인 호출 — Node 20의 `autoSelectFamily` — 에도 검증된 주소 배열을 반환). 호스트명은 그대로 두어 **TLS SNI·인증서 검증은 호스트명 기준**으로 유지한다. `agent: false`(연결 재사용 없음 — 해석·검증이 요청마다 새로 일어난다).
   - **리다이렉트를 따라가지 않는다**(node:http는 원래 따라가지 않는다) — 3xx면 소켓 파기 후 `REDIRECT_NOT_ALLOWED`(AC-L4-4).
   - `content-length`가 상한 초과면 즉시, 아니면 스트림 누적 바이트가 상한을 넘는 순간 `destroy()` → `RESPONSE_TOO_LARGE`(AC-L4-5).
   - 데드라인 도달 → `TIMEOUT`. 그 외 소켓 오류 → `NETWORK_ERROR`(`errorCode`만 보관).
- `fetch`(undici)를 쓰지 않는 이유: 주소 고정(커스텀 lookup)·리다이렉트 제어·스트림 상한을 **신규 의존성 0**으로 표현하려면 `undici` 패키지를 직접 의존해야 한다(NFR-LM5). `node:https`의 `lookup` 옵션은 공개 API다.

### 7.4 IP 정책 — `lib/ip-policy.ts` (P-9 · FR-L5-3/4)

| 분류 | 대역 | allowlist로 열 수 있나 |
|---|---|---|
| **절대 차단** | IPv4 `0.0.0.0/8` · `127.0.0.0/8` · `169.254.0.0/16`(메타데이터 `169.254.169.254` 포함) · `192.0.0.0/24` · `224.0.0.0/4` · `240.0.0.0/4`(`255.255.255.255` 포함) · 클라우드 메타데이터 단일 주소 `100.100.100.200`·`168.63.129.16` / IPv6 `::`·`::1`·`fe80::/10`·`ff00::/8`·`fd00:ec2::254` | **불가** — allowlist에 있어도 무시 + 기동 경고(EX-L-13 · AC-L4-1) |
| **사설·내부** | IPv4 `10/8`·`172.16/12`·`192.168/16`·`100.64/10`·`198.18/15` / IPv6 `fc00::/7`·`fec0::/10` | `LEGACY_API_PRIVATE_ALLOWLIST`의 CIDR에 포함되거나, **연결 호스트명이 allowlist 호스트명과 정확히 일치**할 때만 |
| 공인 | 그 외 | 항상 |

- **임베디드 IPv4**: `::ffff:0:0/96`(매핑) · `::/96`(호환, `::`·`::1` 제외) · `64:ff9b::/96`(NAT64) · `2002::/16`(6to4)은 **내장된 IPv4를 꺼내 IPv4 규칙으로** 다시 판정한다(`::ffff:127.0.0.1` → 절대 차단).
- 구현은 Node 내장 `net.BlockList`(CIDR 판정) + 자체 임베디드 추출 — 신규 의존성 0. allowlist 파싱은 기동 시 1회(`parseAllowlist`)이며 잘못된 항목·절대 차단과 겹치는 항목(대표 주소 `127.0.0.1`·`169.254.169.254`·`0.0.0.0`·`::1`·`fe80::1` 포함 여부, IPv4 `/8` 미만 접두)은 무시 + 경고.
- **루프백 절대 차단의 이유**: 같은 호스트에 ml-worker·임베딩 서버가 떠 있다(ADR-0024). 같은 서버에 설치된 레거시는 사설 IP/내부 DNS로 노출해야 한다(EX-L-12 — 연결 테스트 안내 문구로 알린다).

### 7.5 응답 판정 — `lib/response-check.ts`

- 성공 = HTTP 2xx + JSON(`application/json` 또는 `+json`, 파라미터 허용) + `JSON.parse`(reviver 없음) 성공. 4xx 본문은 분기에 쓰지 않는다(1차 — FR-L5-7).
- 파싱된 JSON 자체는 zod로 검증하지 않고 **추출 경로만 읽는다**(NFR-LS4). 깊은 중첩은 크기 상한이 파싱을 보호하고 추출은 깊이 10에서 멈춘다(EX-L-15).

### 7.6 탄력성 — `LegacyApiGateService` (FR-L5-8, 인스턴스 로컬, 인터페이스 `ApiConnectionGateStore` 1곳)

- 연결별 상태 `{ consecutiveInfraFailures, openUntil, halfOpenProbe, windowStart, count, inFlight }` + 전체 `inFlight`.
- `tryAcquire`: 회로 개방 중이면 `CIRCUIT_OPEN`(개방 시간이 지나면 **탐침 1건만** 통과 — half-open) → 분당 창(`rateLimitPerMin`) 초과 `RATE_LIMITED` → 연결당 동시 10 · 전체 동시 50 초과 `RATE_LIMITED`(대기 없음 — EX-L-14 · NFR-LP5).
- `release(classify)` — `outcome-class.ts`: **INFRA_FAILURE** = `TIMEOUT`·`NETWORK_ERROR`·`HTTP_ERROR(5xx)`·`INVALID_RESPONSE`·`RESPONSE_TOO_LARGE` → 연속 수 +1, 임계치면 `openUntil = now + OPEN_MS` / **ALIVE** = 2xx·4xx 응답 → 0으로 리셋 / **NEUTRAL** = `BLOCKED_*`·`REDIRECT_NOT_ALLOWED` 등 설정 문제 → 변화 없음. ★ **4xx를 실패로 세지 않는다** — 익명 사용자가 존재하지 않는 주문번호를 반복 입력해 회로를 열어 다른 사용자의 조회를 막는 것을 방지한다(§21 D-19).
- 공개 대화·시뮬레이터 LIVE는 게이트를 전부 거친다. **연결 테스트는 회로·레이트를 우회**하고(ADMIN 진단 — 회로가 열려 있어도 확인할 수 있어야 한다) 동시성만 점유하며 회로 카운터를 바꾸지 않는다(§21 D-14).
- 다중 인스턴스에서 카운터는 인스턴스별(EX-L-18 — RAG 게이트와 같은 수용).

### 7.7 시크릿 — `LegacyApiSecretResolver` (★ `LEGACY_API_SECRET__` 참조 유일 파일)

- `get(ref)`: `process.env['LEGACY_API_SECRET__' + ref]` — 값에 CR·LF·NUL이 있거나 4,096자를 넘으면 **없음으로 취급**(헤더 주입 방지) + 기동 시 경고(키 이름만). `status(ref)`: `NOT_REQUIRED｜CONFIGURED｜MISSING`.
- 캐시하지 않는다(환경변수는 재기동 없이 바뀌지 않는다). 시크릿 교체 = 환경변수 변경 + 재기동(EX-L-19).
- **값·길이·접두어를 어떤 로그·오류·응답·trace·감사·`ApiCallLog`에도 쓰지 않는다**(AC-L2-2 — 가짜 시크릿 문자열 전수 grep 시험).

### 7.8 결과 코드 `ApiCallOutcome` (18종) → 분기

| 코드 | 발생 | 분기 | 회로 |
|---|---|---|---|
| `SUCCESS` | 2xx + JSON | 조건/기본 | ALIVE |
| `MAPPING_MISSING` | 필수 매핑 없음(엔진 판정) | 실패 | ALIVE |
| `HTTP_ERROR` | 비 2xx(3xx 제외) | 실패 | 5xx INFRA / 4xx ALIVE |
| `TIMEOUT` · `NETWORK_ERROR` · `INVALID_RESPONSE` · `RESPONSE_TOO_LARGE` | §7.3·§7.5 | 실패 | INFRA |
| `REDIRECT_NOT_ALLOWED` · `BLOCKED_ADDRESS` · `BLOCKED_URL` | §7.2~§7.4 | 실패 | NEUTRAL |
| `CIRCUIT_OPEN` · `RATE_LIMITED` | §7.6 | 실패 | — |
| `CONNECTION_DISABLED` · `CONNECTION_MISSING` · `METHOD_NOT_ALLOWED` · `SECRET_MISSING` · `BINDING_MISSING` · `FEATURE_DISABLED` | §7.1 | 실패 | — |

요구사항 FR-L5-10의 16종에 **`CONNECTION_MISSING`·`METHOD_NOT_ALLOWED` 2종을 추가**했다(삭제된 연결·저장 후 연결의 허용 메서드 축소를 "사용 중지"와 구분해 진단 — §21 D-7). 사용자 화면에는 어떤 코드도 드러나지 않는다.

### 7.9 연결 테스트 (`POST /api-connections/:id/test`, FR-L2-5)

- `security:write`. 요청 `{ path = "/" }`(자리표시자·쿼리 금지, 노드 경로 규칙 동일). 메서드 **GET 고정**. 연결이 사용 중지여도 실행(설정 확인 목적) · `LEGACY_API_ENABLED=false`면 `FEATURE_DISABLED`.
- 대화 경로와 **같은** 조립기·클라이언트·IP 정책·타임아웃·크기 상한(AC-L4-8).
- 응답 `200 { outcome, httpStatus?, latencyMs, contentType?, bytes?, jsonParsable, blockedAddress?, guidance }` — **본문을 반환하지 않는다**(AC-L2-6). 실패도 오류가 아니라 **결과 데이터**다(요구사항의 `API_CONNECTION_TEST_FAILED` 오류 코드는 만들지 않는다 — §21 D-2). `guidance`는 원인+해결 문구(NFR-LA3 — 예: `BLOCKED_ADDRESS` 사설 → "사설 주소(10.20.1.5)는 서버 허용 목록에 없어 호출할 수 없습니다. 운영자에게 허용 목록 추가를 요청하세요", 루프백 → "같은 서버 주소(localhost)는 보안상 호출할 수 없습니다. 사내 주소(사설 IP/내부 DNS)로 노출한 뒤 허용 목록에 추가하세요").
- `ApiCallLog`에 `source=CONNECTION_TEST`, `chatbotId=null`로 기록.

---

## 8. 템플릿 치환 (P-8 · J-10)

- **범위**: 재진입 후 **분기 노드 실행 구간**(조건·기본·실패 분기 노드와 그 노드의 `DIALOG_MOVE` 연쇄)에서 생성되는 아웃풋만. 정지 전 `carry`(폼 완료 문구·앞 아웃풋)는 치환하지 않는다.
- **대상 필드(텍스트만)**: `TEXT.text` · `CARD.title` · `CARD.description` · `BUTTON.text` · `CARD/BUTTON.buttons[].label`. **URL 필드**(`LINK.url`·`IMAGE.imageUrl`·`CARD.imageUrl`·버튼 `LINK` 값)와 **버튼 `MESSAGE` 값**(사용자 입력으로 되돌아온다)·`NODE` 값·`altText`·`PHONE_CALL`은 치환하지 않는다(AC-L3-9).
- **값**: 매핑 결과(§4.5 정규화 — 제어문자 제거·매핑 `maxLength` 절단). 실패 분기에서는 변수가 비어 `{api.*}`는 `""`.
- **치환 후 길이**: 필드 스키마 상한(TEXT 1000 · CARD 제목 100 · 설명 500 · BUTTON 문구 500 · 라벨 40)으로 **코드 포인트 기준 절단**. 치환 결과가 최소 길이(1)를 못 채우는 필수 필드는 그 아웃풋을 **버리고** `API_VALUE_DROPPED` trace(최소 1건 출력은 `EMPTY_OUTPUT` 규약이 보장).
- **HTML 주입**: 위젯은 `textContent`만 쓴다(AC-L3-11). **금지어**: 최종 출력 전체가 출구 필터를 통과한다(AC-L3-10).
- **다음 턴 이월 없음**: 변수는 `resumeAfterApiCall` 지역 값이며 `ConversationState`·`ContextVariable`에 쓰지 않는다(FR-0-101 · AC-L3-13).

---

## 9. 로그

### 9.1 `ApiCallLog` 적재 (`ApiCallLogService.record()` — 쓰기 유일 지점, fire-and-forget)

| 필드 | 값 |
|---|---|
| `chatbotId` · `connectionId` · `connectionName` · `nodeId` · `conversationLogId` | 식별자·이름 스냅샷(`messageId` — 공개 대화만) |
| `source` · `method` · `pathTemplate` | 치환 전 템플릿(`/orders/{0}`) |
| `outcome` · `httpStatus` · `latencyMs` · `responseBytes` | 결과(외부 대기 없이 끝난 실패는 `latencyMs=0`) |
| `branch` · `conditionIndex` · `personalDataMasked` · `dayBucket` | 분기·마스킹 여부·KST 일 버킷(`toKstDayBucket`) |

- **원문 0**: 해석된 URL·쿼리·헤더·요청/응답 본문·바인딩 값·응답 값 컬럼이 없다(AC-L5-2 · §13 L-7). 적재 실패는 경고 로그(코드만)로 흡수.
- **기록하지 않는 것**: 시뮬레이터 MOCK · 비교 · TC(AC-L5-3 · ADR-0030 ① 원칙).
- **보존**: 자동 정리 1차 없음(행당 수백 바이트 — P-11). 재검토 트리거 = 1,000만 행 또는 No.45 착수(`PollingLoop` 재사용 가능). 챗봇 영구삭제 시 동반 삭제(ADR-0033 봉인은 `ConversationLog`·`UnansweredQuestion` 대상이라 저촉되지 않는다 — FR-L6-6 확인).

### 9.2 조회 (`chatbot:read`)

- 목록 `GET /chatbots/:chatbotId/api-call-logs` — 쿼리 `from`·`to`(KST `YYYY-MM-DD`, 최대 92일) · `connectionId?` · `outcome?`(csv) · `source?`(csv, 기본 `PUBLIC,SIMULATION_LIVE`) · `page` · `pageSize`(기본 50 · 최대 100). 정렬 `createdAt desc` 고정. 인덱스 `(chatbotId, dayBucket)`.
- 요약 `GET …/summary` — 같은 필터 → `{ total, success, successRate, byOutcome, p95LatencyMs, byConnection[{ connectionId, connectionName, total, failures }] }`. P95는 `count` 후 `orderBy latencyMs desc · skip floor(0.05·count) · take 1`(원시 SQL 0 · 이식성 — 개발명세서 §5 DB 이식성).
- 챗봇 스코프 규약: 교차 챗봇 `404`, `ARCHIVED` 조회 허용(통계·학습현황과 같은 판단).

### 9.3 대화 로그·서버 로그

- `ConversationLog`는 기존 1건 규약 그대로(§6.1). `botResponse`에는 치환된 외부 값이 들어가며 **기존 금지어 → PII 마스킹**을 거친다(`conversation-log.service.ts:55-58`).
- 서버 로그 허용 필드: 연결 id · 노드 id · 결과 코드 · HTTP 상태 · 지연 · 응답 바이트 · Node 오류 코드(FR-0-105).

---

## 10. 권한 (P-12 — 신규 0종, `Permission` 15종 불변)

| 동작 | 권한 | 비고 |
|---|---|---|
| 연결 목록·상세 | `security:read` | ADMIN |
| 연결 생성·수정·삭제·테스트 | `security:write` | ADMIN — "어디로 나갈 수 있는가" = 외부 송신 경계 |
| 편집기 선택 목록 · 샘플 응답 조회 | `dialogue:read` | `baseUrl`·`secretRef`·`authType` 미포함 |
| 노드 저장(v2 설정) | `dialogue:write` | 기존 — 등록된 연결을 **쓰기만** 한다 |
| 호출 로그 목록·요약 | `chatbot:read` | 세 역할 |
| 시뮬레이터 MOCK | `simulation:read` | VIEWER 포함 |
| 시뮬레이터 LIVE | `simulation:read`(가드) + 서비스가 `simulation:write` 재확인 | 불충족은 거부가 아니라 MOCK 격하 |

`@Public()` 추가 0건 · 레거시 프록시 경로 0건(FR-0-100).

---

## 11. 감사 (FR-L2-4 · FR-L6-7)

- `AuditTargetType`에 **`ApiConnection`**(라벨 `'API 연결'`, 15 → 16종). `AuditAction` 추가 0.
- `AUDIT_FIELDS.ApiConnection = ['name','baseUrlHost','allowedMethods','authType','secretRef','timeoutMs','rateLimitPerMin','allowRawPersonalData','personalDataLookup','enabled','sampleCount']` — `secretRef`는 **이름**, `baseUrl`은 **호스트만**, 샘플은 **개수만**.
- 기록: 생성 `CREATE` · 수정 `UPDATE`(summary: 원문 송신 허용/해제·사용 중지/재개를 문장으로) · 삭제 `DELETE`. **연결 테스트·호출 1건 1건은 감사 대상이 아니다**(ADR-0016 §5 — 호출은 `ApiCallLog`). 노드 저장 감사는 기존 그대로(`outputs` 화이트리스트 밖 — `audit-snapshot.ts:39`).

---

## 12. API 계약

### 12.1 엔드포인트 (신규 10개 · `@Public()` 0)

| 메서드 | 경로 | 권한 | 요청 → 응답 | 오류 |
|---|---|---|---|---|
| GET | `/api-connections` | `security:read` | → `{ items: ApiConnectionListItem[] }`(전역 소량 — 페이지네이션 없음, 상한 200) | — |
| GET | `/api-connections/picker` | `dialogue:read` | → `{ items: ApiConnectionPickerItem[] }` | — |
| POST | `/api-connections` | `security:write` | `CreateApiConnection` → `201 ApiConnection` | `400 VALIDATION_FAILED` · `409 DUPLICATE_NAME` · `400 CONFIRM_NAME_MISMATCH` |
| GET | `/api-connections/:id` | `security:read` | → `ApiConnection` | `404` |
| GET | `/api-connections/:id/samples` | `dialogue:read` | → `ApiConnectionSamplesResponse` | `404` |
| PATCH | `/api-connections/:id` | `security:write` | `UpdateApiConnection` → `ApiConnection` | 위 + `404` |
| DELETE | `/api-connections/:id` | `security:write` | → `204` | **`409 API_CONNECTION_IN_USE`**(`details[]` = 참조 노드 최대 5 — `챗봇명 › 노드명`) |
| POST | `/api-connections/:id/test` | `security:write` | `ApiConnectionTestRequest` → `200 ApiConnectionTestResult` | `404` |
| GET | `/chatbots/:chatbotId/api-call-logs` | `chatbot:read` | `ApiCallLogListQuery` → `Paginated<ApiCallLogItem>` | `400 VALIDATION_FAILED`(92일 초과) · `404` |
| GET | `/chatbots/:chatbotId/api-call-logs/summary` | `chatbot:read` | 같은 필터 → `ApiCallLogSummary` | 〃 |

확장(기존 경로): `POST /chatbots/:chatbotId/simulate`(요청 `apiMode`·`mockResponse`, 응답 `apiStep`) · `POST …/simulate/compare`(목 완결 — 계약 불변) · 노드 CRUD(v2 검증·가림·복사 제외 수) · `POST …/dialog-nodes/validate`(신규 코드) · `GET …/dialog-nodes/flow`(`via: API_BRANCH`) · 복원 미리보기(경고 3종) · 버전 내용·차이(가림) · TC 결과(`apiMockA/B`).

개발명세서 §4의 예고 `/legacy-apis`는 **`/api-connections`로 정정**한다 — 자원은 "API"가 아니라 "연결"이다.

### 12.2 `ApiCallLogItemSchema`

`{ id, createdAt, connectionId, connectionName, nodeId?, conversationLogId?, source, method, pathTemplate, outcome, httpStatus?, latencyMs, responseBytes?, branch?, conditionIndex?, personalDataMasked }` — 원문 필드 없음.

### 12.3 오류 코드 (`ApiErrorCode` 신규 2종 — FR-0-104 5종 제안에서 축소)

| 코드 | 상태 | 쓰임 |
|---|---|---|
| `API_OUTPUT_LEGACY_FORMAT` | 400 | v1 `API_CONDITION`을 담은 노드 생성·수정 |
| `API_CONNECTION_IN_USE` | 409 | 현재 노드가 참조하는 연결 삭제(스냅샷 참조는 막지 않음 — FR-L8-5) |

재사용: 존재하지 않는 연결·분기 노드·폼 슬롯 = 기존 **`INVALID_REFERENCE`(404, `details[]`)** — `dialog-nodes.service.ts:111-113`의 기존 규약과 맞춘다(§21 D-3) · 원문 송신 확인값 불일치 = **`CONFIRM_NAME_MISMATCH`(400)** · 연결 이름 중복 = `DUPLICATE_NAME`(409) · 메서드가 연결 허용 목록 밖 = `VALIDATION_FAILED`(400). 연결 테스트 실패는 결과 데이터, 시뮬레이터 LIVE 불충족은 격하 — 오류 코드 없음. **대화 경로는 이 코드들을 쓰지 않는다**(외부 실패는 분기/고정 문구로 수렴).

---

## 13. 봉인 · 정적 검사 — `apps/api/src/legacy-api/lib/legacy-api-sealing.spec.ts`

검사 대상: `apps/api/src/**/*.ts`(`*.spec.ts`·`src/integration/**` 제외, 주석 제거) + `packages/dialogue-engine/src/**/*.ts`(spec 제외). 탐지어는 `rag-allowlist.spec.ts` 방식으로 **조각 조립**(검사기 자신이 문자열을 포함하지 않게).

| # | 단언 | 막는 것 |
|---|---|---|
| L-1 | `LEGACY_API_SECRET__` 문자열 보유 파일 = `legacy-api/legacy-api-secret.resolver.ts` **1개** | 시크릿 읽기 경로 확산(FR-0-98) |
| L-2 | `node:http`·`node:https`·`'http'`·`'https'` 모듈 import = `legacy-api/transport/node-http.transport.ts` **1개**(구현 착수 시 기존 파일에 이미 있으면 그 목록을 상수로 고정) · `node:dns`/`'dns'` import = `node-dns.resolver.ts` 1개 | 두 번째 레거시 출구 |
| L-3 | `ValidatedLegacyRequest` 브랜드 심볼 생성 = `legacy-api/lib/build-request.ts` 1개 | 임의 URL로 클라이언트 호출(FR-0-99) |
| L-4 | `LegacyApiHttpClient` 주입(생성자 파라미터 타입) = `legacy-api/legacy-api.service.ts` 1개 · `LegacyApiModule`의 `exports` = `[LegacyApiService, ApiCallLogService]` | 출구 우회 |
| L-5 | `packages/dialogue-engine/src`에 `fetch(`·`from 'node:`·`'http'`·`'https'`·`'net'`·`'dns'`·`'undici'`·`setTimeout(`·`setInterval(`·`process.env`·`@nestjs`·`@prisma` **0건** | 엔진 I/O(FR-0-96) |
| L-6 | `validation/**`·`versions/**`·`deploy-schedules/**`에 `legacy-api/` 경로 import **0건** · `LegacyApiService` 참조 0건 | TC·버전·예약의 실호출(FR-0-102) |
| L-7 | `schema.prisma`의 `ApiCallLog` 블록 필드명이 §3.1의 허용 목록과 **정확히 일치** · `apiCallLog.create` 호출 파일 = `api-call-log.service.ts` 1개 | 원문 컬럼 추가(AC-L5-2) |
| L-8 | `@Public()` 핸들러 6개(기존 `public-decorator-count.spec.ts` 유지) | 레거시 프록시 공개(FR-0-100) |
| L-9 | `ApiConditionOutputPayloadV2Schema`의 키 집합에 `headers`·`url`·`bodyTemplate` 없음(런타임 단언) | v2에 인라인 시크릿 부활(NFR-LS6 ⑦) |
| L-10 | `apiConnection.(create｜update｜updateMany｜upsert｜delete｜deleteMany)` 호출 파일 = `api-connections/api-connections.service.ts` 1개 · `ApiConnection` 모델에서 `secret`으로 시작하는 필드는 `secretRef` 하나 | 시크릿 값 저장 컬럼 |
| L-11 | `api-connections/catalog/**`에 Prisma 쓰기 0건 · `legacy-api/**` import 0건 | 카탈로그가 출구·쓰기 경로가 되는 것 |
| L-12 | `CONVERSATION_STATE_VERSION === 1`(런타임) · `ConversationStateSchema` 키 집합 불변 | 응답값의 상태 이월(FR-0-101) |
| L-13 | 운영 코드에서 IP 정책 제공자 토큰(`LEGACY_API_ADDRESS_POLICY`)을 재정의하는 코드 0건(스펙 파일만 허용) | 테스트용 루프백 허용이 운영에 새는 것 |
| L-14 | `legacy-api/**`의 `logger.(log｜warn｜error｜debug)(` 인자에 `url`·`body`·`headers`·`.message` 식별자 0건(휴리스틱) | 원문 로그(FR-0-105) — 최종 보증은 AC-L2-2 가짜 시크릿 grep 시험 |

---

## 14. 성능 예산 (NFR-LP)

| 대상 | 목표 |
|---|---|
| API 노드 없는 공개 대화 턴 | **P95 500ms(캐시 적중) 불변** — 추가 조회 0 · `apiCall` 유무 분기 1개(NFR-LP1) |
| API 턴 | P95 ≤ 기존 예산 + 외부 응답 시간 + **우리 오버헤드 50ms**(연결 PK 조회 · DNS 해석 · IP 판정 · 파싱 · 매핑 · 재진입). **최악 = 연결 타임아웃 + 500ms**(AC-L3-3: 타임아웃 3초 → 3.5초 이내). 예산 미달을 이유로 타임아웃 상한을 조용히 올리지 않는다(NFR-LP2) |
| 회로 개방·레이트 초과·사용 중지·시크릿 미설정·바인딩 누락 | **10ms 이내** 실패 분기(외부 대기 0 — NFR-LP3 · AC-L3-4) |
| 경로 추출·조건·치환 | 256KB·매핑 20·조건 10 기준 **5ms**(NFR-LP4 단위 벤치) |
| 외부 지연의 전파 | 연결당 동시 10 · 전체 50 상한으로 다른 챗봇·관리자 API P95 증가 **20% 미만**(NFR-LP5 — 스트림 수신, 이벤트 루프 비차단) |
| TC 대량 실행 | 500 TC/분 불변(목 = 순수 함수 — NFR-LP6) |
| 호출 로그 | 목록 P95 300ms · 요약(30일) P95 1초 · 적재는 응답 경로 대기 0(NFR-LP7) |
| 연결 목록 | 노드 1만 · 연결 50 기준 P95 500ms(참조 수 = `outputs contains connectionId` 후보 조회 + 파싱 확인 1회, 24h 통계 = `(connectionId, createdAt)` 인덱스 `groupBy` 1회) |

TLS 연결 재사용이 없어(§7.3 `agent: false`) 호출마다 핸드셰이크가 붙는다 — 외부 응답 시간에 포함되는 비용으로 수용하며, 레거시 P95가 상시 1초를 넘으면 **검증 주소 고정을 유지하는 연결 풀**을 재검토한다(§20 K-3).

---

## 15. 버전(No.25) · 예약 배포(No.28) — J-18

- **캡처**: 노드 `outputs`를 그대로 담는다(v1·v2). `ApiConnection`은 스냅샷 대상이 아니다(금지어·채널과 같은 전역 설정 — ADR-0031 §1 표에 추가). v2에는 시크릿 필드가 없으므로 **스냅샷에 시크릿이 들어갈 자리가 원천적으로 없다**(AC-L7-2).
- **해시 안정성**(FR-L8-1): `snapshot-canonical.ts`는 키를 깊게 정렬하므로(:108-119) v2 필드 순서와 무관하다. v2 zod `.default([])`로 저장 JSON에 빈 배열이 항상 포함되어 "생략 vs 빈 배열" 흔들림도 없다. 배열 순서(조건·매핑)는 의미이므로 해시에 포함되는 것이 맞다.
- **스키마 버전**: `SNAPSHOT_SCHEMA_VERSION` 불변, 업캐스터 불필요(AC-L7-3).
- **무결성 경고**: `BROKEN_REFERENCE_NODE_API`(분기 노드 없음) · 캡처 모드 `API_LEGACY_FORMAT`(v1 포함 — `integrityWarnings`에 저장되어 **No.26 이후 캡처한 버전**은 목록·상세에서 "이전 형식 API 조건 포함(헤더 값 저장됨)" 표시 가능. 이전 버전은 본문을 읽어야 알 수 있어 목록 표시가 불가 — 본문 참조 봉인 V-7(`version-sealing.spec.ts:233`) 때문이며, 내용 조회·복원 미리보기·계측 스크립트로 드러난다 — §21 D-6).
- **복원 미리보기 경고 3종**(`RestoreWarningSchema` discriminated union 추가, 전부 blocker 아님 — FR-L8-2 · AC-L7-1):
  `{ code: 'API_CONNECTION_MISSING', count }` · `{ code: 'API_CONNECTION_DISABLED', count }` · `{ code: 'API_LEGACY_FORMAT', count }` — `restore-warnings.service.ts`가 대상 스냅샷의 v2 `connectionId` 집합으로 `prisma.apiConnection.findMany({ select: { id, enabled } })` 1회.
- **복원 후**: 연결이 없으면 해당 노드 실행은 `CONNECTION_MISSING` 실패 분기(EX-H-5 "캡처 당시 상태의 재현이 복원의 정의").
- **v1 스냅샷의 평문 헤더**(FR-L8-3): 내용·차이 응답은 가린다(§4.3). 제거가 필요하면 **해당 버전 삭제**(기존 기능)로 한다 — 스냅샷 본문 수정 경로를 만들지 않는다(해시 불변 · ADR-0031).
- **예약 배포**: 변경 0. 복원 예약 실행기는 `versionRestore.preview()`를 호출하므로(`restore-version.executor.ts:49`) 위 경고가 **자동으로 준비도 경고에 포함**된다(FR-L8-4 — 추가 코드 0). 연결 삭제 409는 **현재 노드 참조만** 검사한다(FR-L8-5).

---

## 16. 관리자 콘솔 (ui-designer / frontend-implementer 인계)

- **① 보안 설정 > API 연결**(ADMIN): 목록(이름 · 호스트 · 허용 메서드 · 인증 방식 · 시크릿 상태 · 원문 송신 · 개인정보 조회형 · 사용 여부 · 회로 열림 · 참조 노드 수 · 24시간 호출/실패) · 생성/수정 대화상자(시크릿은 **입력 칸이 없다** — `secretRef` 이름과 "서버에 `LEGACY_API_SECRET__{ref}` 설정 필요" 안내, 상태 배지) · 원문 송신 켜기 = 연결 이름 재입력 확인 · 샘플 응답 편집(JSON 입력 + 형식·16KB 검증, "편집자·조회자에게 보입니다 — 실제 개인정보를 넣지 마세요" 안내) · 연결 테스트(상대 경로 입력 → 결과 요약 `aria-live="polite"`) · 삭제 409 목록 안내.
- **② 노드 편집기 `API 조건분기` v2 폼**: 연결 선택(picker — URL·시크릿 비노출, 사용 중지·개인정보 조회형·원문 송신 텍스트 배지) → 메서드(연결 허용분만) → 경로 + 자리표시자 값(상수/폼 슬롯 선택기) → 쿼리 목록 → 본문 필드 목록(POST) → 응답 매핑 목록 → 조건 목록(기존 편집기 재사용 — 경로는 응답 경로 문법 검증) → 기본/실패 분기 노드 선택 → **샘플/직접 입력 JSON으로 미리보기**(`api-mapping.ts` 공용 함수 — 추출값·선택 분기 즉시 표시). 목록 순서 변경은 위/아래 버튼(NFR-LA1). 헤더·URL 직접 입력 필드 **없음**(`DialogOutputEditor.tsx:410-413`의 기존 편집기 대체 — 헤더 마스킹 표시 스펙은 폐기).
- **③ v1 표시**: "이전 형식 — 실행되지 않음" 배지(`isUnsupportedOutput` 공용 판정 — `DialogOutputEditor.tsx:126` 하드코딩 제거) · 헤더 키·개수만(값은 서버가 이미 `[비공개]`) · `연결로 전환` 버튼(메서드·조건만 옮기고 연결 선택 요구, 헤더·URL·본문 템플릿은 버린다는 확인 대화상자). 저장 400 `API_OUTPUT_LEGACY_FORMAT` 시 전환 안내.
- **④ 시뮬레이터**: 결과 패널 `외부 API` 단계(모드 · 격하 사유 · 연결명 · 결과 · 분기 · 변수(마스킹)) · 목 선택(샘플 목록/직접 입력/실패 유형) · `실제 호출` 토글(조건 불충족 시 비활성 + 사유 텍스트 — "POST는 시뮬레이터에서 실제로 호출하지 않습니다(목으로만 확인)" 등).
- **⑤ 챗봇 상세 `외부 연동 로그` 탭**(`chatbot:read`): 기간(KST)·연결·결과 필터, 요약(호출 수 · 성공률 · 결과 코드 분포 표 · P95), 목록(시각 · 연결 · 메서드 · 경로 템플릿 · HTTP 상태 · 지연 · 분기) — 페이지네이션 필수(기본 50).
- **⑥ v1 잔존 알림**(FR-L9-4): 설계 점검 요약에 `API_LEGACY_FORMAT` 건수 · 대시보드 알림은 선택(ui-designer 판단).
- **⑦ 흐름 트리**: `via: API_BRANCH` 표시(텍스트 라벨 "API 분기").
- **⑧ 복원 미리보기**: 경고 3종 문구("대상 버전의 노드 N개가 존재하지 않는 API 연결을 참조합니다(실행 시 실패 분기로 처리)" 등).
- **접근성**: 모든 입력 레이블·오류 `aria-describedby` · 배지 = 색 + 텍스트(NFR-LA2) · 오류 문구는 원인 + 해결(NFR-LA3) · 신규 화면 3종 axe 대비 위반 0(AC-L8-2). 위젯 전송 중 표시의 보조기술 알림은 ui-designer 확인(NFR-LA4 — 위젯 코드 변경은 이 설계 범위 밖, 필요 시 별도 요청).
- 사용자(위젯) 화면에 "API"·"HTTP"·"타임아웃" 등 내부 용어 금지(FR-L9-7 — 고정 문구 §5.6).

---

## 17. 시험 설계 포인트 (test-automation 인계)

| 층 | 대상 | 핵심 |
|---|---|---|
| 순수(shared-types) | `api-mapping.ts` | 경로 문법(금지 키·깊이·인덱스) · 연산자 표 전 조합(숫자 형식·null·배열 CONTAINS) · 치환(비-api 토큰 유지 AC-L3-8) · 제어/bidi 문자 · 코드 포인트 절단(EX-L-9) · 5ms 벤치 |
| 순수(shared-types) | 판정·가림 | v1/v2 판별 · `redactLegacyApiOutputs` 결과가 v1 스키마 통과 + 원 토큰 문자열 0(AC-L1-4) |
| 엔진 | `executeOutputs`/`resolveTurn`/`resumeAfterApiCall` | **API 노드 없는 번들 기존 스위트 무수정 통과**(AC-L1-10) · v1 바이트 동일(AC-L1-2) · 정지 위치·뒤 아웃풋 미실행(AC-L3-5) · 폴백 동봉 · 분기 3종 + 고정 문구 · 끊긴 분기 참조 · 턴당 1회(AC-L3-6) · hop 이어 세기 · 폼 완료 바인딩/버튼 진입 누락(AC-L3-12) · 분기 노드가 폼 시작 시 `nextState` · 상태 봉투 불변(AC-L3-13) |
| 엔진 | 참조 편입 | 고아 판정·들어오는 참조(AC-L1-8) · 흐름 `API_BRANCH` · 설계 점검 신규 코드 |
| API 순수 | `build-request.ts` | ★ 인젝션 표(`../admin?x=1#`·`a"},"role":"admin`·`\r\nX-Evil: 1`·`%2e%2e`·`.`·유니코드) → 세그먼트 수·쿼리 키 집합·본문 키 집합 불변(AC-L4-6) · 호스트/포트 불변 · `user:pass@` 거부 |
| API 순수 | `ip-policy.ts` | ★ `127.1`·`0x7f000001`·`017700000001`·`[::1]`·`::ffff:127.0.0.1`·`64:ff9b::7f00:1`·`2002:7f00:1::`·`169.254.169.254`·`fd00:ec2::254`·`100.100.100.200` · allowlist에 절대 대역 기재 시 무시(AC-L4-1 · EX-L-13) · IPv6 CIDR allowlist(EX-L-25) |
| API 서비스 | `LegacyApiHttpClient` + **가짜 리졸버 · 가짜 전송** | ★ 재바인딩(첫 해석 공인 → 두 번째 루프백): 리졸버 호출 1회 · 전송이 받은 주소 = 검증된 공인(AC-L4-3) · 사설 해석 + 빈 allowlist → 전송 0(AC-L4-2) · 시크릿 헤더 구성 |
| API 전송 | `NodeHttpTransport` + **로컬 가짜 레거시 서버**(127.0.0.1 — 정책을 거치지 않는 전송 단위 시험) | 지연(타임아웃 AC-L3-3) · 302 → 두 번째 요청 0(AC-L4-4) · 2MB/Content-Length 과대(AC-L4-5) · `text/html` · 깨진 JSON · 느린 조각 전송(EX-L-23) · SNI 호스트명 유지 |
| API 서비스 | 게이트 | 연속 5회 INFRA → 6번째 10ms 이내 `CIRCUIT_OPEN`(AC-L3-4) · half-open 탐침 1건 · 4xx 연속은 회로 미개방 · 레이트·동시성 · 슬롯 반납(예외 경로 포함) |
| 통합 | 공개 대화 | ★ S-1 한 응답(AC-L3-1 — `pendingAnswer` 없음) · 분기 3종(AC-L3-2) · RAG 0건(AC-L3-15) · 미응답 큐 미적재(AC-L3-14) · 출구 마스킹(AC-L3-10) · `LEGACY_API_ENABLED=false` 아웃바운드 0(AC-L4-8) |
| 통합 | 시크릿 | ★ `LEGACY_API_SECRET__ERP=tok-XYZ` — 연결 조회·목록·감사·`ApiCallLog`·서버 로그 캡처·시뮬레이터·오류 응답 전수 grep 0회(AC-L2-2) · 미설정 `MISSING`(AC-L2-3) |
| 통합 | 권한·연결 | EDITOR 연결 CRUD/테스트 403 · picker 필드(AC-L2-1) · 삭제 409·사용 중지 즉시 반영(AC-L2-4) · 원문 송신 확인값·감사 before/after(AC-L2-5) · 테스트 본문 미반환(AC-L2-6) |
| 통합 | 노드 | v1 저장 400(AC-L1-3) · VIEWER 토큰 미노출(노드·버전 내용·차이 — AC-L1-4) · 복사 제외(AC-L1-5) · 끊긴 분기 참조 저장 404(AC-L1-6) · ★ 분기 참조 노드 삭제 409(v1 포함 — AC-L1-7) · 허용 메서드 밖 저장 400(AC-L4-7) |
| 통합 | 시뮬레이터·TC | VIEWER LIVE 격하(AC-L6-1) · POST 격하(AC-L6-2) · ★ **오버레이 LIVE 차단 — 새 노드 + 같은 id 덮어쓰기 2케이스**(AC-L6-3) · 목 실패 유형(AC-L6-4) · 변수 마스킹(AC-L6-5) · TC 2,000건 외부 0·결정론·처리량(AC-L6-6) · 샘플 없음(AC-L6-7) · `ApiCallLog` 0행(AC-L5-3) |
| 통합 | 로그·버전 | 호출 100건 원문 grep 0 · `pathTemplate` 형태(AC-L5-2) · 영구삭제 동반 삭제(AC-L5-4) · 감사 0건(AC-L5-5) · 복원 경고·실패 분기(AC-L7-1) · 스냅샷에 연결 필드 없음(AC-L7-2) · v1 포함 과거 스냅샷 복원(AC-L7-3) |
| 정적 | `legacy-api-sealing.spec.ts` | L-1~L-14(AC-L5-6 · AC-L7-4) |
| E2E/접근성 | 콘솔 3화면 | 키보드만으로 연결 등록 → v2 설정 → 저장(AC-L8-1) · axe 0(AC-L8-2) · 사설 주소 실패 안내 `aria-live`(AC-L8-3) |

**실제 외부 네트워크 호출 테스트 0건** — 전부 가짜 리졸버·가짜 전송·로컬 가짜 서버(NFR-LM2). 전송 시험에서 로컬 서버를 쓰기 위해 IP 정책을 **테스트 모듈에서만** 교체한다(L-13이 운영 코드의 교체를 막는다). 웹 `DialogOutputEditor.spec.tsx:81`(API_CONDITION 전환 시 미지원 배지 기대)은 **의도된 동작 변경**으로 갱신한다(v2 초안에는 배지가 없다 — §21 D-18).

---

## 18. 요구사항 추적표

| 요구사항 | 설계 위치 |
|---|---|
| T-1 / FR-L1-1~3 · AC-L1-1/2/9 | §4.1~§4.2 · §5.2 ① · §4.6(D-1) |
| T-2 / NFR-S4 재정의 · FR-L5-1~6 · NFR-LS1/3/7 · AC-L4-1~6 · EX-L-5/12/13/25 | §7.2~§7.5 |
| T-3/T-5 / FR-0-98 · FR-L2-2 · NFR-LS2 · AC-L2-2/3 · EX-L-19 | §3.1 · §7.7 · §13 L-1/L-10 |
| T-4 / FR-L6-4~7 · AC-L5-2~5 · NFR-LP7 | §3.1 · §9 · §11 |
| T-6 · P-1 | §4.1 · §19 |
| T-7 · FR-L7-1~7 · AC-L6-1~7 | §6.2~§6.5 |
| T-8 · FR-L1-5 · FR-L9-2/3 | §4.2 · §16 ②③ |
| FR-0-96 · FR-0-97 · AC-L1-10 | §2.3 · §5 · §13 L-5 · §17 |
| FR-0-99 · FR-0-100 · FR-0-102 · FR-0-103 · FR-0-105 | §7.3 · §10 · §13 L-2~L-4/L-6/L-8 · §3.5 · §7.1 |
| FR-0-101 · AC-L3-13 | §8 · §13 L-12 |
| FR-0-104 | §12.3(D-2) |
| FR-L1-4/6 · AC-L1-3~5 · FR-L8-3 | §4.2~§4.3 · §15 |
| FR-L2-1~7 · AC-L2-1/4~6 | §4.4 · §7.9 · §10~§12 · §14 |
| FR-L3-1~5 · AC-L1-6~8 · AC-L4-7 | §5.8~§5.9 · §7.2 · §2.5 |
| FR-L4-1~10 · AC-L3-1~9/11/12 · EX-L-1~4/6~8/15~17/20/24 | §5 · §8 |
| FR-L4-11~14 · AC-L3-10/14/15 | §6.1 · §7.1 |
| FR-L5-7~10 · EX-L-7/14/18/23 | §7.5~§7.8 |
| FR-L6-1~3/8/9 · NFR-LS5/8 · AC-L5-1 · EX-L-10/22 · P-14 | §7.1 ⑦ · §3.1 · §5.9 ⑪ · §16 |
| FR-L8-1~5 · AC-L7-1~4 | §15 |
| FR-L9-1~7 · NFR-LA1~4 · AC-L8-1~3 | §16 |
| NFR-LP1~7 | §14 |
| NFR-LM1~5 | §2.1 · §6.5 · §7.3 · §7.6 |
| J-17 · J-18 | §5.8 · §15 |
| EX-L-9/11/21 | §4.5 · §5.3 · §4.4 |

---

## 19. 범위 밖 (재검토 트리거는 요구사항 §9 · ADR-0034 재검토 트리거)

`SCENARIO` 실행·표준 커넥터(No.39 — 이 그룹의 `ApiConnection`이 커넥터 인스턴스 토대) · 시크릿 DB 암호화/콘솔 입력/키 회전/외부 비밀 관리자(No.45) · PUT/PATCH/DELETE·재시도·멱등키·비동기 콜백·재시도 큐(No.41) · PENDING/폴링 비동기 전달 · 응답값 다음 턴 보존/세션 변수 저장소/서명 상태 · 4xx 본문 분기 · XML/SOAP/폼/파일 응답·mTLS·OAuth2 토큰 발급 · 최종 사용자 본인확인 · 챗봇별 연결 허용 목록 · 요청/응답 본문 디버그 로그 · `ApiCallLog`/`RagCallLog` 보존 자동 정리 · 전역 정확 레이트리밋 · URL 필드 치환 · 타입 지정 본문 바인딩(숫자·불리언) · **`RagHttpClient`의 리다이렉트 불허·응답 크기 상한 보강**(제안만 — `rag-http.client.ts:72-79`가 `fetch` 기본 리다이렉트 추종·`res.text()` 전체 수신이다. 고정 서버라 1차 허용했으나 같은 방어를 적용할 것을 코드리뷰 과제로 남긴다 — ADR-0022 갱신 각주).

---

## 20. 알려진 제한

| # | 제한 | 수용 근거 · 완화 |
|---|---|---|
| K-1 | 시크릿 추가·교체에 운영자 작업(환경변수 + 재기동)이 필요 — 구독형 셀프서비스 불가 | P-3. 트리거 = 구독형 고객 증가 · No.45 필드 암호화 |
| K-2 | 회로·레이트·동시성 카운터는 인스턴스별 | RAG 게이트와 같은 수용(EX-L-18). 교체 지점 1곳 |
| K-3 | TLS 연결 재사용 없음(호출마다 해석·검증·핸드셰이크) | 주소 고정의 단순성 우선. 레거시 P95 상시 1초 초과 시 검증 주소 고정 풀 재검토 |
| K-4 | 익명 사용자의 타인 정보 조회를 근본 차단할 수 없다 | P-14 — 표시·경고·30/분·레거시 2요소 대조 권고 |
| K-5 | 고정 문구로 끝난 API 턴은 응답출처 통계에서 `FALLBACK`으로 분류된다(`stats/lib/response-source.ts:17` — `isAnswered=false` 우선) | 통계 분류 무변경(FR-0-97 우선). 상세는 `외부 연동 로그` 탭이 담당 |
| K-6 | TC `expectedKind: NODE`는 **최초 매칭 노드**(API 조건 보유 노드)로 판정된다 — 분기 노드가 아니다 | `matchedNodeId` 규약(FR-L4-13) 일관. 분기 결과 변화는 응답 해시로 감지 |
| K-7 | No.26 이전에 캡처한 버전은 목록에서 "v1 포함" 표시가 없다 | 본문 참조 봉인 V-7. 내용 조회·복원 미리보기·계측 스크립트로 확인 |
| K-8 | API 배포 롤백 시 구버전 엔진은 v2를 `PAYLOAD_INVALID`로 건너뛴다 | 롤백 전 v2 노드 비활성화 운영 메모 |
| K-9 | 연결 테스트에는 수행자(actor) 기록이 없다(`ApiCallLog`에 actor 컬럼 없음, 감사 비대상) | ADMIN 전용 · 외부 송신 GET 1건. 규제 요구 시 감사 대상으로 승격 |
| K-10 | 본문 바인딩 값은 전부 문자열이다 | 1차 단순화 — 숫자 필수 레거시는 레거시 쪽 변환 또는 후속 타입 바인딩 |

---

## 21. 요구사항 대비 해석 (architect 판단)

| # | 요구사항 | 해석·변경 | 근거 |
|---|---|---|---|
| D-1 | FR-L1-3 v1 trace에 사유 `LEGACY_FORMAT` | **넣지 않는다** — v1 trace 무변경 | AC-L1-2 "No.26 이전과 바이트 단위 동일"(시뮬레이터 응답의 trace 포함)과 충돌. 사유는 설계 점검 `API_LEGACY_FORMAT`·배지로 드러난다 |
| D-2 | FR-0-104 신규 코드 5종 | **2종**(`API_OUTPUT_LEGACY_FORMAT`·`API_CONNECTION_IN_USE`) | 연결 부재는 기존 `INVALID_REFERENCE` · 연결 테스트 실패는 결과 데이터 · LIVE 불충족은 격하(오류 아님) — 쓰이지 않는 코드를 만들지 않는다 |
| D-3 | AC-L1-6 끊긴 참조 저장 "400" | 기존 **`404 INVALID_REFERENCE` + `details`** | `dialog-nodes.service.ts:111-113`의 `DIALOG_MOVE`·버튼 규약과 한 벌(같은 화면에서 참조 종류별로 코드가 갈리면 FE 분기가 늘어난다) |
| D-4 | FR-0-96 ③ 순수 함수 3종을 "엔진 패키지"에 | **`shared-types/api-mapping.ts`**(zod 무의존)에 두고 엔진은 import | 웹이 `shared-types`만 의존(`apps/web/package.json:14`) — 편집기 미리보기와 같은 함수 1벌. 엔진 I/O 0 불변식은 그대로 |
| D-5 | FR-L9-3 전환 시 "경로 일부" 이관 | **메서드·조건만** 이관 | FR-L1-6이 응답의 URL을 호스트까지만 남기므로 경로를 알 수 없다(가림이 우선) |
| D-6 | FR-L8-3 버전 목록의 v1 표시 | **No.26 이후 캡처분만**(무결성 경고 저장) | 목록은 본문을 읽지 않는다(V-7 봉인). 과거분은 내용·미리보기·스크립트 |
| D-7 | FR-L5-10 결과 코드 16종 | **18종**(+`CONNECTION_MISSING`·`METHOD_NOT_ALLOWED`) | 삭제·허용 메서드 축소를 사용 중지와 구분해야 원인 추적이 된다 |
| D-8 | FR-L1-4 "쓰기 스키마 = v2만" | zod DTO 분리 대신 **서비스 가드** · 오버레이는 v1 허용 | 파이프가 전용 오류 코드를 만들 수 없고, 오버레이 v1은 실행·저장되지 않아 무해 |
| D-9 | §5.2 `ApiCallLog` 컬럼 | `chatbotId` nullable(연결 테스트) · `connectionName` 스냅샷 · `conditionIndex` 분리 | 연결 삭제 후 목록 가독성 · 분기 필터 |
| D-10 | §5.4 엔드포인트 | **`GET /api-connections/:id/samples`(`dialogue:read`) 추가** | 편집기 미리보기(FR-L9-2)가 샘플 본문을 필요로 하나 picker에 싣기엔 크다(최대 80KB/연결) |
| D-11 | FR-L7-6 "사용된 샘플 해시 기록" | `TestRunResult.apiMockA/B` 컬럼 | 결과 행 단위 기록처가 달리 없다 |
| D-12 | FR-L7-2 LIVE 불충족 | **MOCK 격하 + `downgradeReason`**(요구사항 권고안) | 시뮬레이터 흐름을 끊지 않는다 |
| D-13 | "오버레이가 아닌 저장된 노드" 판정 | 노드 id 존재 + **정지한 아웃풋이 저장본과 직렬화 동일** | 오버레이가 기존 id를 덮어써 경로·바인딩을 바꾸는 우회(AC-L6-3 변형) 차단 |
| D-14 | 연결 테스트와 게이트 | 회로·레이트 **우회**, 동시성만 점유, 카운터 불변 | ADMIN 진단이 회로 개방 중에도 가능해야 하고, 진단이 사용자 회로를 열면 안 된다 |
| D-15 | 연결 캐시(TTL ≤5초 선택지) | **캐시 없음** — API 턴마다 PK 1회 조회 | API 턴에서만 발생하는 1ms급 조회. 사용 중지 즉시 반영(AC-L2-4)을 캐시 무효화 없이 보장 |
| D-16 | `update()`에서 outputs 미포함 | 기존 v1 보존(거부하지 않음) | 목록의 사용 여부 토글 등 outputs 무관 편집 허용 — P-4 "자동 삭제 없음" |
| D-17 | 목 샘플 없음의 실패 코드 | `INVALID_RESPONSE` + trace `API_MOCKED(NO_SAMPLE)` | 실패 분기 재현이 목적(FR-L7-1). 결과 코드를 늘리지 않는다 |
| D-18 | FR-0-97 "기존 테스트 무수정" | 엔진·대화·통계·검증 스위트는 무수정. **웹 `DialogOutputEditor.spec.tsx:81` 1건은 갱신** | 그 시험이 단언하는 동작(API_CONDITION = 미지원 배지)이 이 기능의 본체 변경이다 |
| D-19 | FR-L5-8 회로 "연속 실패" | **4xx·설정 오류는 실패로 세지 않는다**(인프라 실패만) | 익명 사용자가 잘못된 입력으로 회로를 열어 서비스 거부를 유발하는 경로 차단 |
| D-20 | 설계 점검의 연결 의존 항목 | `validateDialogueDesign`에 **선택 3번째 인자** | 엔진 순수성 유지(데이터는 서비스가 조회해 주입) · 기존 호출 무변경 |

---

## 22. GPU · 배포 형태

- **GPU 1 유지**(P-15): HTTP 1회 · JSON 파싱(≤256KB) · 경로 추출 · 문자열 치환 — §1 기준표 "1~2 CPU 전용". 새 모델·추론·임베딩 0, ml-worker 호출 0. **루프백 절대 차단으로 레거시 연결이 ml-worker를 호출할 수 없음이 구조적으로 보장**된다(ml-engineer 참고).
- **구축형 ○**: 주 무대 — 사설 대역은 `LEGACY_API_PRIVATE_ALLOWLIST`로 운영자가 연다. 폐쇄망 증명은 `LEGACY_API_ENABLED=false`(아웃바운드 0). 같은 서버의 레거시는 사내 DNS/사설 IP로 노출해야 한다(EX-L-12).
- **구독형 ○(전제조건)**: 고객 레거시가 인터넷 경유 HTTPS로 도달 가능 + 고객 방화벽에 우리 **고정 송신 IP** 등록(`docs/05-ops/자동배포.md` 착수 시 인프라 요구로 반영) · 사설 allowlist 빈 값 유지 · 시크릿은 운영자 작업(K-1).
