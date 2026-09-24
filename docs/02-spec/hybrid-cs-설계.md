# 하이브리드 CS 세부 설계서 (No.24)

> **요구사항**: `docs/requirements/hybrid-cs.md`(T-1~11, J-1~J-20, FR-0-118~128, FR-CS1-\*~FR-CS11-\*, NFR-CSP/CSS/CSA/CSM, AC-CS1~CS7(+패치로 신설하는 AC-CS8), EX-CS-1~28(+EX-CS-29~33), P-1~P-18)
> **상위 문서**: `docs/02-spec/개발명세서.md` §2·§2.2·§3·§3.1·§4·§4.1·§5·§5.1·§6(**결정 37 신설**)·§7
> **신규 ADR**: **ADR-0036**(하이브리드 CS = 개입 세션에만 서버 상담 스레드 · API 계층 봇 일시정지(엔진 수정 0) · 상담 전용 짧은 폴링 + 관찰 창 + 편승 격하 · 서버 발급 상담 토큰 · CAS 배정 · 조회 시점 종료 판정 + 원문 파기 정리 루프 · **상담 중 한정 원문(영구 저장은 마스킹본만)** · 원문 열람 감사 · 상담 스레드 삭제 봉인 · `AGENT` 역할)
> **갱신 ADR(각주만)**: ADR-0002(사전검사 11 → 13종) · ADR-0009(트리거 ① 해소 — 부분 갱신) · ADR-0011(공개 경로 7번째 · 폴링 버킷 · 프리플라이트 캐시) · ADR-0012(Preact 트리거 미발동) · ADR-0013(저장 지점 3번째 테이블 · 상담 중 한정 원문 예외) · ADR-0015(역할 3 → 4 · 권한 15 → 17) · ADR-0016(`HandoffSession`·`CannedResponse` · `RAW_VIEW` — 최초의 열람 감사) · ADR-0019(`HANDOFF_TURN`) · ADR-0023(폴링 전용 버킷 · 흡수하지 않음) · ADR-0026(LLM 승격 트리거 미발동) · ADR-0030(상담 모듈 DI 격리) · ADR-0031(상담 설정·문장은 스냅샷 밖 · 답변 설정 행 동거 기각) · ADR-0032(`PollingLoop` 두 번째 소비자) · ADR-0033(봉인 대상 확장)
> **작성일**: 2026-09-25 · **GPU**: **1 유지**(DB 조회·CAS·순수 판정·문자 bigram — 의미 힌트는 기존 ml-worker 임베딩 호출만, 새 모델·학습·생성 0). ml-engineer 신규 작업 없음 — §27.
> **기존 파일 수정 목록**: 문서는 `docs/02-spec/hybrid-cs-patches.md`, 코드는 이 문서 §2.5.

---

## 0. 이 문서가 푸는 문제 (한 문단 요약)

공개 대화는 **사용자가 말할 때만 요청하는 HTTP 1턴**이고(`public-conversation.controller.ts`), 서버는 세션을 모르며(봉투 — ADR-0009), 원문 저장소가 없다(ADR-0013). 이 설계는 **상담원이 개입한 세션에만** 서버에 상담 스레드(`HandoffSession` + `HandoffMessage`)를 만들고, 공개 대화 파이프라인이 **입구 금지어 판정 직후·엔진 호출 전**에 그 스레드를 조회해 개입 중이면 엔진을 건너뛴다(엔진 수정 0). 상담원 메시지는 위젯의 **상담 전용 짧은 폴링**(`@Public()` 7번째)으로 전달하고, 제3자 엿보기·가장은 **서버 발급 1회 상담 토큰**(해시만 저장, 봉투 밖)으로 막는다. 담당 배정은 **부분 유니크 인덱스 + CAS**, 시간 종료는 **조회 시점 판정**이다. PM 결정 P-9("상담 중에만 원문 표시")에 따라 사용자 메시지 원문은 **활성 상담 동안 `HandoffMessage.rawText`에만** 임시 보관되고, **종료 트랜잭션·60초 정리 루프·60분 절대 상한** 세 겹으로 **행 삭제가 아닌 필드 소거**로 파기되며(`secure_delete` 포함), 담당자·ADMIN만 명시 요청(`includeRaw`)으로 열람하고 **(상담, 열람자)당 1건 `RAW_VIEW` 감사**가 남는다. 영구 저장·목록·이력·힌트·통계·스냅샷·CSV·로그는 전부 마스킹본이다. 이 설계가 추가로 찾은 제약 2건 — **① 답변 설정 행에 상담 설정을 동거시키면 버전 복원이 상담 설정을 지우거나 되돌린다(ADR-0031)** · **② 조회 시점 판정만으로는 아무도 조회하지 않는 세션의 원문이 영원히 남는다** — 의 처리를 §3.1·§9에 고정한다. 상담 기능이 꺼진 챗봇의 공개 응답은 바이트 단위로 불변이다.

---

## 1. PM 확정 사항 (2026-09-25 — P-9만 권고안과 다름, 나머지 권고안)

| # | 확정 내용 | 이 문서에서의 반영 |
|---|---|---|
| P-1 | 상담원 주도 개입만 · WEB만. 사용자 요청 핸드오프·대기열은 후속 | §24 · §8.2 (WEB 외 채널 = `HANDOFF_SESSION_NOT_LIVE`) |
| P-2 | 상담 전용 짧은 폴링(상담 중 3초 · 미응답 턴 뒤 3분 관찰 창 5초) · 구버전 위젯 편승 격하 · `@Public` 6 → 7 · 폴링 전용 레이트리밋 버킷 · SSE/WebSocket/롱폴 기각 | §5.5·§5.6·§7·§14 · ADR-0036 §2 |
| P-3 | 콘솔 폴링(목록 5초 · 열린 대화 2초) · "진행 중" = 최근 10분 로그 | §10·§11·§21 |
| P-4 | 개입 세션만 상담 스레드 · 봇 상태는 봉투 유지(ADR-0009 부분 갱신) · 개입 분기는 엔진 호출 전 API 계층 · 엔진 수정 0 | §2.3·§5 |
| P-5 | 서버 발급 상담 토큰(1회 발급 · 해시만 · 봉투 분리) · 전체 `sessionId` 콘솔 미노출(별칭) | §6·§10.2 |
| P-6 | `isAnswered` 기준 연속 미응답(주의 2 · 경고 3 · 챗봇별) · 금지어·설문·상담 구간 중립 · API 고정 문구 산입 · 조회 시점 계산 | §10.1 |
| P-7 | **`AGENT` 역할 + `cs:read`/`cs:write` 신설**(역할 3 → 4 · 권한 15 → 17) · EDITOR는 읽기만 · VIEWER 불변 | §15 |
| P-8 | 세션당 상담 1건 · 담당 1명 · CAS + 부분 유니크 · 강제 인수는 ADMIN만 | §8.2·§8.5 |
| **P-9** | ★ **상담 중에만 원문 표시**(권고안 "마스킹본만"과 다름) — 영구 저장은 마스킹본만 · `ConversationLog` 마스킹(ADR-0013) 불변 · architect가 (a)~(g) 확정 | **§9 전체** · ADR-0036 §6 |
| P-10 | 힌트 = 의미 매칭 FAQ/의도 상위 3 + 자주 쓰는 문장 상위 3 · 임베딩 없으면 문자 유사도 · RAG·LLM 미사용 | §12 |
| P-11 | 챗봇별 공용 `CannedResponse`(`dialogue:write` 관리, 복사·입력창 삽입) | §12.3 |
| P-12 | `ConversationLog.handoffTurn` → 질문 순위·미응답 제외 · 응답출처 `OTHER` · 상담 스레드 삭제 경로 0 · 영구삭제 사전검사 11 → 13 | §3.1·§8.1·§18 |
| P-13 | 위젯 변경 수용(vanilla TS · 100KB) | §14 |
| P-14 | 사용자 무응답 10분 · 상담원 무응답 5분 · 조회 시점 판정 · 종료 후 이동 노드 선택 | §8.4 — **P-9 (b)의 결과로 같은 판정 함수를 60초 정리 루프도 호출한다**(§8.6 · PM 확인 필요 1 — 보고) |
| P-15 | 이력 목록·상세 + 요약(건수·평균 첫 응답·평균 상담 시간) · 상담원 간 비교 제외 | §13 |
| P-16 | `HandoffSession`·`CannedResponse` 감사 · 원문 열람 감사는 P-9 (d)로 조정 | §16 |
| P-17 | GPU 1 | §27 |
| P-18 | K-1(보류 답변 폴링 IP 버킷 공유 결함)에도 폴링 전용 버킷 적용 · **별도 커밋 가능 단위** | §2.6 · §7.3 |
| (architect) | **상담 설정 저장 위치** = 신규 1:1 `ChatbotHandoffSetting` + 전용 캐시(답변 설정 행 동거 기각 — 버전 복원이 `ChatbotAnswerSetting`을 `DELETE`/`UPSERT`한다) | §3.1 · §26 D-1 |
| (architect) | **`ConversationLog.apiNotice` 컬럼 추가**(마지막 미응답 사유 "연동 실패" 표시의 유일한 근거 — 현재는 `record()` 파라미터로만 존재해 로그에서 파생 불가) | §3.1 · §26 D-2 |
| (architect) | **원문 파기 보증 3겹 + `secure_delete`** · 원문 열람 = 명시 요청 + (상담, 열람자)당 1건 감사 · 상담원 발신은 계속 마스킹 | §9 |

---

## 2. 아키텍처 배치

### 2.1 모듈 구조

기존 4계층 규약(개발명세서 §2.1)을 따른다. **NestJS 모듈 2개를 신설**한다. 상담 스레드의 **쓰기 서비스는 1파일**이고, 공개 경로가 쓰는 서비스 2개만 export해 `ConversationModule` 1곳에서 import한다.

```
apps/api/src/
├── handoff/                                   # [신규] HandoffModule
│   ├── handoff.module.ts                      # imports: prisma, banned-words, answer-settings, embedding, dialogue-common, chatbots, audit-logs
│   │                                          # exports: [HandoffGateService, HandoffPublicPollService] — import처 = ConversationModule뿐
│   ├── handoff-thread.service.ts              # ★ HandoffSession/HandoffMessage 쓰기 유일 파일(생성 CAS·토큰 발급·메시지 적재·종료·인수·원문 소거)
│   ├── handoff-secure-delete.query.ts         # ★ `$queryRaw\`PRAGMA secure_delete = ON\`` 1줄 격리(SQLite 전용 — R-7 네 번째 파일)
│   ├── handoff-gate.service.ts                # 공개 대화 ②.7 분기(설정 캐시 → 최신 스레드 1건 조회 → 판정 → 적재·응답 조립)
│   ├── handoff-public-poll.service.ts         # 공개 폴링(토큰 1회 발급·커서 이후 메시지·종료 유예)
│   ├── handoff-settings.service.ts            # ChatbotHandoffSetting 쓰기 유일 파일(PUT 전체 교체·draining·감사·캐시 무효화)
│   ├── handoff-settings-cache.service.ts      # 챗봇별 메모리 캐시(TTL 30초 + 즉시 무효화 — AnswerSettingsCacheService와 같은 형식)
│   ├── handoff-sweeper.service.ts             # PollingLoop 60초 — 시간 종료 판정·원문 만료 소거·draining 해제(onApplicationBootstrap에서 즉시 1회)
│   ├── live-sessions.service.ts               # 진행 중 세션 목록(쿼리 3회 고정) · sessionRef 역해석
│   ├── handoff-transcript.service.ts          # ★ 대화 보기(원문 노출 유일 출구 · RAW_VIEW 감사)
│   ├── handoff-hints.service.ts               # 응답힌트(의미 → 저하) + 자주 쓰는 문장 매칭(발화당 1회 메모)
│   ├── handoff-history.service.ts             # 이력 목록·상세·요약(읽기 전용 · 원문 미조회)
│   ├── live-sessions.controller.ts            # @Controller('chatbots/:chatbotId/live-sessions') — ①~④
│   ├── handoffs.controller.ts                 # @Controller('chatbots/:chatbotId/handoffs') — ⑤~⑫(정적 세그먼트 먼저 선언)
│   ├── handoff-settings.controller.ts         # @Controller('chatbots/:chatbotId/handoff-settings') — ⑱⑲
│   ├── handoff-console.controller.ts          # @Controller('handoff-console') — ⑳ 챗봇 선택기·내 상담 수
│   ├── handoff.mapper.ts                      # row ↔ DTO(sessionId 필드 없음 — 타입으로 봉인)
│   └── lib/                                   # DB·Nest 무의존 순수 함수(NFR-CSM1)
│       ├── session-ref.ts                     # computeSessionRef(chatbotId, sessionId) · assignAliases(refs)
│       ├── session-alert.ts                   # evaluateSessionAlert(rows, thresholds) — P-6
│       ├── handoff-expiry.ts                  # judgeHandoffExpiry(row, settings, channelOpen, now) → reason | null
│       ├── handoff-token.ts                   # hashToken · 상수 시간 비교(crypto.timingSafeEqual)
│       ├── handoff-auth.ts                    # classifyHandoffRequest(row, ctx) → §5.3 판정표 G-0~G-9
│       ├── envelope-clear.ts                  # clearEnvelopeForHandoff(state, connectedAt) — 진행 폼·설문·되묻기 비우기(엔진 밖)
│       ├── raw-visibility.ts                  # canViewRaw(handoff, viewer, includeRaw) — 담당자·ADMIN · CONNECTED 한정
│       ├── hint-rank.ts                       # 의미 ranked → 힌트 항목 · 저하 모드 입력 확장(suggestIntents 재사용)
│       ├── handoff-summary.ts                 # 이력 요약 조립(평균 첫 응답·평균 상담 시간·분포·표본 수)
│       └── transcript-cursor.ts               # 불투명 커서 인코딩/디코딩(base64url JSON)
├── canned-responses/                          # [신규] CannedResponsesModule
│   ├── canned-responses.controller.ts         # @Controller('chatbots/:chatbotId/canned-responses') — ⑬~⑰
│   ├── canned-responses.service.ts            # ★ CannedResponse 쓰기 유일 파일(200개 상한·정규화 유일·위/아래 이동·감사)
│   └── canned-responses.mapper.ts
├── common/rate-limit/public-rate-bucket.decorator.ts   # [신규 — K-1 커밋] @PublicRateBucket({ key, perKeyLimit })
├── conversation/guards/public-rate-limit.guard.ts      # [수정 — K-1 커밋] 폴링 경로는 poll-ip + 경로 키 버킷(기존 ip·session 미소비)
├── conversation/public-conversation.controller.ts      # [수정] pollMessage에 버킷 데코레이터(K-1) · pollHandoff 신설(@Public 7번째)
└── conversation/public-conversation.service.ts         # [수정] ②.7 게이트 · 관찰 창 · record(handoffTurn/apiNotice)
```

### 2.2 모듈 의존 방향

```
handoff            → banned-words(maskPlainText) / answer-settings(AnswerSettingsCacheService — 임계값 읽기)
                     / embedding(SemanticMatchService — 힌트) / dialogue-common(DialogueBundleService — 노드·FAQ 이름·텍스트)
                     / chatbots(ChatbotScopeService) / audit-logs / prisma / config          (conversation을 import하지 않는다)
canned-responses   → chatbots / audit-logs / prisma
conversation       → handoff(HandoffGateService · HandoffPublicPollService) + 기존
dialogue-common    → (ReferenceCheckService가 prisma.chatbotHandoffSetting 읽기 1회 추가 — 모듈 import 추가 0)
chatbots           → (영구삭제 사전검사 prisma.handoffSession.count·cannedResponse.count · 동반 삭제 chatbotHandoffSetting — import 추가 0)
simulation · validation · versions · deploy-schedules · stats · learning → ★ handoff/·canned-responses/ import 금지(§18 H-12)
```
- **`HandoffModule`의 export는 2개**(`HandoffGateService`·`HandoffPublicPollService`)이며 import처는 `ConversationModule` 1곳이다. 시뮬레이터·TC·비교·버전·예약·통계에는 **상담 스레드를 읽거나 쓸 수단이 DI 그래프에 없다**(FR-0-123, ADR-0030 형식).
- 콘솔 API 컨트롤러 4개는 `HandoffModule` 안에 있어 외부로 export되지 않는다.
- `handoff-thread.service.ts`는 모듈 내부 provider이며, 게이트·폴링·관리자 서비스·정리 루프가 **전부 이 파일을 통해서만** 쓴다(§18 H-2).

### 2.3 엔진 수정 범위 — **0건** (FR-0-118)

- `packages/dialogue-engine`은 **한 파일도 바꾸지 않는다.** 개입 분기는 `public-conversation.service.ts`의 ②.5 입구 금지어 **뒤**, 번들·엔진 **앞**(②.7)에서 끝난다 — 기존 BLOCK 경로(엔진을 부르지 않고 요청 봉투를 그대로 반환)와 같은 모양이다.
- 봉투 스키마·`CONVERSATION_STATE_VERSION`(1)·키 집합(5키 — `legacy-api-sealing.spec.ts` L-12)은 불변이다. 개입 시 진행 폼·설문·되묻기를 비우는 일은 **API 계층의 순수 함수**(`lib/envelope-clear.ts`)가 **유효한 봉투 값만 줄이는 방향**으로 한다(새 키·새 값 0 — §5.4).
- 엔진 패키지에 `handoff`·`cannedResponse` 심볼 0건을 정적 검사가 단언한다(§18 H-9).

### 2.4 `apps/api` 외 워크스페이스 영향

| 워크스페이스 | 변경 |
|---|---|
| `packages/shared-types` | **`handoff.ts` 신설**(§4.1) · `conversation.ts`(요청 `features?` · 응답 `handoff?` · 폴링 스키마 — §4.2) · `security.ts`(`AGENT`·`cs:read`·`cs:write` — §15) · `audit.ts`(`RAW_VIEW` · `HandoffSession`·`CannedResponse`) · `common.ts`(`ApiErrorCode` 7종 — §17.3) · `index.ts` export |
| `packages/dialogue-engine` · `packages/pii-mask` · `apps/ml-worker` | **변경 0건** |
| `apps/widget` | 상담 모드(§14) — `core/handoff-poll.ts`·`core/handoff-storage.ts` 신설 · `core/store.ts`·`api/public-client.ts`·`ui/app.ts`·`ui/message-list.ts`·`constants/messages.ts` 수정 · 번들 게이트 100KB |
| `apps/web` | `모니터링` 메뉴(진행 중 목록·대화 보기·힌트 패널·개입/전송/종료/인수·이력·요약) · 챗봇 상세 `상담 연계` 설정 · `자주 쓰는 문장` 관리 · 사용자 관리 역할 `상담원` — §21 |

### 2.5 기존 코드 변경 목록 (구현자 체크리스트)

| 파일 | 변경 | 근거 |
|---|---|---|
| `prisma/schema.prisma` + 마이그레이션 1개(+ 원시 DDL 1줄) | 신규 4모델 · `ConversationLog.handoffTurn`·`apiNotice` · 인덱스 `(chatbotId, sessionId, createdAt)` · `Chatbot` 역참조 3개 · 부분 유니크 경고 주석(§3.1) | §3 |
| `prisma/seed.ts` | 데모 챗봇에 `ChatbotHandoffSetting`(enabled=false) + 자주 쓰는 문장 3건 + 데모 `AGENT` 계정 1개(`agent@chat-bot.local`, `mustChangePassword=true`). **스레드 시드 없음** | §3.3 |
| `packages/shared-types/src/{handoff,conversation,security,audit,common,index}.ts` | §4 · §15 · §16 · §17.3 | — |
| `conversation/public-conversation.service.ts` | 생성자 인자 `HandoffGateService` 추가 · ②.7 게이트 · 응답 `handoff?`(관찰 창 · 보류 턴 `IF_PENDING_FAILS`) · `record()`에 `apiNotice`·`handoffTurn` · `pollHandoff()` 위임 | §5 |
| `conversation/public-conversation.controller.ts` | `pollHandoff` 핸들러(`@Public()` 7번째) · `sendMessage`가 토큰 헤더를 3번째 인자로 전달 · `pollMessage`에 `@PublicRateBucket`(K-1) | §7 |
| `conversation/conversation.module.ts` | `HandoffModule` import | §2.2 |
| `conversation/conversation-log.service.ts` | `RecordConversationLogParams.handoffTurn?`(기본 false) → `create.data.handoffTurn` · `apiNotice` → `create.data.apiNotice`(현재 파라미터만 있음) · 수집기에 `handoffTurn` 전달 | FR-CS11-1 |
| `conversation/guards/public-rate-limit.guard.ts` + `common/rate-limit/public-rate-bucket.decorator.ts` | `Reflector` 주입 · 폴링 버킷 분기(K-1 커밋) | §7.3 |
| `learning/lib/collect-decision.ts` · `learning/unanswered-collector.service.ts` | `CollectSkipReason`에 `'HANDOFF_TURN'` · 입력 `handoffTurn?`(기본 false, `surveyTurn` 다음 순서) | FR-CS11-3 |
| `stats/lib/question-ranking-filter.ts` | `{ surveyTurn: false, handoffTurn: false }` — 같은 상수(5곳 자동 반영) | FR-CS11-2 |
| `chatbots/chatbots.service.ts` | `CHILD_COUNT_LABELS`에 `handoffSessions: '상담'`·`cannedResponses: '자주 쓰는 문장'` · 사전검사 `counts`에 두 키(11 → 13) · 동반 삭제 트랜잭션에 **`chatbotHandoffSetting.deleteMany`만** 추가(스레드·문장 삭제 0) | FR-CS11-6 · ADR-0002 |
| `dialogue-common/reference-check.service.ts` | `assertNodeDeletable`에 "종료 후 버튼 노드" 참조 검사 1회(`409 NODE_IN_USE`, 사유 "상담 연계 설정의 종료 후 버튼") | FR-CS1-3 |
| `audit-logs/lib/audit-snapshot.ts` | `AUDIT_FIELDS.HandoffSession`·`AUDIT_FIELDS.CannedResponse` | §16 |
| `config/env.validation.ts` | 선택 환경변수 5종(§3.4) | FR-0-128 |
| `main.ts` | 공개 표면 CORS 옵션에 `maxAge: 600`(프리플라이트 캐시 — 커스텀 헤더 도입 대응) | §7.1 |
| `users/*` | 변경 0(역할 값은 `RoleName` 단일 소스 — `GET /roles`가 4행 반환) | §15 |
| `apps/widget/**` · `apps/web/**` | §14 · §21 | — |
| 시험 파일 | §22.2 닫힌 목록 | FR-0-126 |

> **이 목록에 없는 파일은 바꾸지 않는다.** 특히 `packages/dialogue-engine/**`, `stats/lib/response-source.ts`·`summary-assembler.ts`(FR-CS11-4 — 상담 턴 = `OTHER`), `versions/**`(스냅샷·복원 무변경), `deploy-schedules/**`, `rag/**`(보류 답변 저장소·`pollMessage` 서비스 로직 무변경 — K-1은 가드·데코레이터만), `answer-settings/**`(동거 기각 — §26 D-1)는 무변경이다.

### 2.6 커밋 분리 단위 (P-18)

| 커밋 | 범위 | 독립성 |
|---|---|---|
| **① K-1 보류 답변 폴링 전용 버킷** | `public-rate-bucket.decorator.ts`(신규) · `public-rate-limit.guard.ts`(Reflector 분기) · `public-conversation.controller.ts`(`pollMessage`에 데코레이터 1줄) · `env.validation.ts`(`PUBLIC_POLL_RATE_LIMIT_IP_PER_MIN`) · 가드 단위 시험(신규) · 개발명세서 §5.1 행 1개 | **No.24 코드에 의존하지 않는다.** 단독 배포 시 동작 변화 = 보류 답변 폴링이 `ip`·`session` 버킷을 더 이상 소비하지 않고 `poll-ip`(600/분)·`poll-key:msg:{messageId}`(60/분)만 소비. `@Public` 수 불변(6) |
| ② No.24 본체 | 나머지 전부 | ①의 데코레이터를 재사용한다(①이 먼저) |

---

## 3. 데이터 모델 · 마이그레이션

### 3.1 Prisma 변경안

```prisma
/// [신규 No.24] 챗봇별 상담 연계 설정(1:1). ★ ChatbotAnswerSetting에 동거시키지 않는다 — 버전 복원이
/// 답변 설정 행을 DELETE/UPSERT하므로(restore-plan.ts) 동거하면 복원이 상담 설정을 지우거나 되돌린다(ADR-0031 갱신).
/// 스냅샷 대상이 아니다. 쓰기 주체 = handoff-settings.service.ts 1파일. 행이 없으면 전부 기본값(꺼짐).
model ChatbotHandoffSetting {
  chatbotId           String   @id
  chatbot             Chatbot  @relation(fields: [chatbotId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  enabled             Boolean  @default(false)
  /// 끈 시점에 활성 상담이 있으면 true — 게이트가 계속 조회해 진행 중 상담을 끝까지 유지한다(FR-CS1-4). 활성 0건이 되면 정리 루프가 false로 되돌린다
  draining            Boolean  @default(false)
  cautionThreshold    Int      @default(2)    // 1~10
  warningThreshold    Int      @default(3)    // caution+1 ~ 10
  activeWindowMinutes Int      @default(10)   // 5~60 — "진행 중" 창
  userIdleMinutes     Int      @default(10)   // 3~60
  agentNoReplyMinutes Int      @default(5)    // 1~30
  connectNotice       String   @default("상담원이 연결되었어요. 잠시만 기다려 주세요.")
  endNotice           String   @default("상담이 종료되었어요. 이제 챗봇이 도와드릴게요.")
  failNotice          String   @default("지금은 상담원 연결이 어려워요. 챗봇이 계속 도와드릴게요.")
  /// 종료 후 버튼(선택) — 둘 다 있거나 둘 다 없다. 노드 참조는 FK 없음(앱 레벨 409 NODE_IN_USE — §2.5)
  endButtonLabel      String?
  endButtonNodeId     String?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  @@map("chatbot_handoff_settings")
}

/// [신규 No.24] 세션 1개의 상담 1건(개입 ~ 종료). ★ 쓰기 주체 = handoff-thread.service.ts 1파일 · 삭제 코드 0건(§18 H-1).
/// ⚠ 이 테이블에는 스키마에 표현되지 않는 부분 유니크 인덱스가 1개 있다 — 파일 하단 경고 주석 참고.
model HandoffSession {
  id                           String    @id @default(uuid())
  chatbotId                    String
  chatbot                      Chatbot   @relation(fields: [chatbotId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  /// 개입 당시 챗봇 소속 그룹 스냅샷 — FK 없음 · 불변(ADR-0033 §4 선례, FR-CS10-4)
  groupId                      String
  /// 위젯 난수. ★ 관리자 API·콘솔·감사·로그에 싣지 않는다(DTO에 필드 자체가 없다 — §18 H-17)
  sessionId                    String
  /// computeSessionRef(chatbotId, sessionId) — 16 hex. 관리자 경로 식별자·별칭의 원천
  sessionRef                   String
  channelType                  String    @default("WEB")
  /// CONNECTING | CONNECTED | ENDED
  status                       String    @default("CONNECTING")
  /// AGENT_ENDED | USER_IDLE | AGENT_NO_REPLY | NOT_DELIVERED | CHANNEL_CLOSED
  endReason                    String?
  /// MODERN(토큰) | LEGACY(편승 격하) — 첫 접촉 시 확정, 그 전 null
  clientMode                   String?
  /// 담당자 — FK 없음(사실 기록, DeploySchedule.createdById 규약) · 이름은 표시용 스냅샷
  assignedUserId               String
  assignedUserName             String
  startedById                  String
  startedByName                String
  /// 개입 당시 경고 판정 스냅샷(NORMAL|CAUTION|WARNING) — 이력 표시(FR-CS10-1)
  alertLevelAtStart            String
  consecutiveUnansweredAtStart Int
  /// sha256(token) hex. ★ 토큰 원문 컬럼은 존재하지 않는다(NFR-CSS1)
  tokenHash                    String?   @unique
  tokenIssuedAt                DateTime?
  unverifiedAttemptCount       Int       @default(0)
  /// 스레드 내 seq 발급기(원자 증가) · 구버전 위젯 편승 전달 커서
  lastSeq                      Int       @default(0)
  legacyDeliveredSeq           Int       @default(0)
  userMessageCount             Int       @default(0)
  agentMessageCount            Int       @default(0)
  startedAt                    DateTime
  connectedAt                  DateTime?
  firstAgentReplyAt            DateTime?
  lastUserMessageAt            DateTime?
  lastAgentMessageAt           DateTime?
  endedAt                      DateTime?
  endedById                    String?
  endedByName                  String?
  /// KST 개입일 — 적재 시점 확정·불변(ADR-0017)
  dayBucket                    String
  createdAt                    DateTime  @default(now())
  updatedAt                    DateTime  @updatedAt

  messages HandoffMessage[]

  @@index([chatbotId, sessionId, startedAt])   // 게이트·폴링: 세션의 최신 상담 1건
  @@index([chatbotId, sessionRef])             // 관리자 경로 sessionRef 역해석
  @@index([chatbotId, status])                 // 진행 중 목록의 활성 상담 조회
  @@index([chatbotId, dayBucket])              // 이력 기간 필터·요약
  @@index([status, startedAt])                 // 정리 루프: 전 챗봇 활성 상담
  @@index([assignedUserId, status])            // 내 상담 수
  @@map("handoff_sessions")
}

/// [신규 No.24] 상담 구간 메시지(append-only). ★ 쓰기 주체 = handoff-thread.service.ts 1파일 · 삭제 코드 0건.
/// 행이 생긴 뒤의 유일한 갱신은 원문 소거(rawText·rawExpiresAt → null)다(§18 H-3).
model HandoffMessage {
  id                String         @id @default(uuid())
  handoffSessionId  String
  handoffSession    HandoffSession @relation(fields: [handoffSessionId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  /// 비정규화(조인 없는 조회) — FK 없음
  chatbotId         String
  seq               Int
  /// USER | AGENT | SYSTEM
  sender            String
  /// SYSTEM 전용: CONNECTED | ENDED | FAILED | TAKEOVER(내부 — 공개 폴링에 내보내지 않는다)
  systemKind        String?
  senderUserId      String?
  senderUserName    String?
  /// ★ 금지어 → PII 마스킹 후 값만(영구)
  text              String
  /// ★ [P-9] 사용자 원문 — USER 메시지 · 활성 상담 중 · 마스킹본과 다를 때만 값이 있다. 종료 트랜잭션·정리 루프·
  /// 절대 상한(rawExpiresAt)으로 null이 된다(행 삭제 아님). 인덱스 없음
  rawText           String?
  /// createdAt + 60분(HANDOFF_RAW_TEXT_MAX_AGE_MS). rawText와 함께 null이 된다
  rawExpiresAt      DateTime?
  /// USER 턴의 ConversationLog.id(= messageId) — FK 없음
  conversationLogId String?
  /// SYSTEM ENDED 전용 JSON { kind:'NODE', nodeId, label } — 종료 시점 설정 스냅샷
  action            String?
  createdAt         DateTime       @default(now())

  @@unique([handoffSessionId, seq])
  @@index([rawExpiresAt])                      // 정리 루프: 만료 원문(값이 있는 행만 소수)
  @@map("handoff_messages")
}

/// [신규 No.24] 챗봇별 공용 자주 쓰는 문장(P-11). 대화 번들·스냅샷·엔진 밖. 쓰기 주체 = canned-responses.service.ts 1파일.
model CannedResponse {
  id              String   @id @default(uuid())
  chatbotId       String
  chatbot         Chatbot  @relation(fields: [chatbotId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  title           String   // 1~50
  titleNormalized String   // normalizeText(title)
  body            String   // 1~1,000
  category        String?  // ≤30
  shortcut        String?  // ≤20 · [A-Za-z0-9가-힣_-] — 입력창 '/단축어'
  sortOrder       Int
  enabled         Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([chatbotId, titleNormalized])
  @@unique([chatbotId, shortcut])              // SQLite·Postgres 모두 NULL은 서로 다름 — 단축어 없는 행 다수 허용
  @@index([chatbotId, sortOrder])
  @@map("canned_responses")
}

model ConversationLog {
  // … 기존 필드 불변 …
  /// [신규 No.24] 상담 구간(개입 중 · 검증된 발신)의 사용자 턴. 질문 순위·미응답 수집에서 제외(FR-CS11-2/3), 턴·세션·응답률 포함.
  /// 쓰기 주체 = record() 1곳. 인덱스 없음. 백필 불필요(기존 행 = false가 사실).
  handoffTurn     Boolean  @default(false)
  /// [신규 No.24] 외부 API 고정 문구로 끝난 턴(No.26 FR-L4-13 — 지금까지는 record() 파라미터로만 존재). 진행 중 목록의
  /// "마지막 미응답 사유 = 연동 실패"의 유일한 근거(파생 불가 — ADR-0004 통과). 인덱스 없음. 기존 행 false(사유 미상 → "답변 못함" 표시)
  apiNotice       Boolean  @default(false)

  @@index([chatbotId, sessionId, createdAt])   // [신규 No.24] 세션 1개 전문 조회(FR-CS3-6)
}

model Chatbot {
  // … 기존 필드 불변 …
  /// [신규 No.24] 역참조만 — DB 컬럼 변화 0
  handoffSetting  ChatbotHandoffSetting?
  handoffSessions HandoffSession[]
  cannedResponses CannedResponse[]
}

// [신규 No.24] handoff_sessions에는 이 스키마에 표현되지 않는 부분 유니크 인덱스가 1개 더 있다 —
// (chatbotId, sessionId) WHERE status IN ('CONNECTING','CONNECTED') — 세션당 활성 상담 최대 1건(P-8).
// test_runs_chatbotId_active_key·deploy_schedules 선례와 같이 마이그레이션 SQL에 raw로만 존재한다.
// `prisma migrate dev` diff가 이 인덱스(와 기존 3개)를 삭제하는 구문을 끼워 넣지 않는지 반드시 확인할 것.
```

**만들지 않는 것**: 전 세션 서버 세션 테이블 · 원문 영구 테이블·원문 메모리 캐시 · 상담원 온라인 상태 테이블 · 개인 자주 쓰는 문장 · 상담 롤업 · 읽음 확인 · 입력 중 표시 · 원문 열람 권한 부여 테이블(열람 판정은 순수 함수 + 감사 — §9.3).

### 3.2 마이그레이션 (1개, `YYYYMMDDHHMMSS_hybrid_cs`)

1. `CREATE TABLE chatbot_handoff_settings` / `handoff_sessions`(+ 인덱스 6 · `tokenHash` UNIQUE) / `handoff_messages`(+ UNIQUE `(handoffSessionId, seq)` · INDEX `rawExpiresAt`) / `canned_responses`(+ UNIQUE 2 · INDEX 1).
2. **원시 DDL 1줄**: `CREATE UNIQUE INDEX "handoff_sessions_active_key" ON "handoff_sessions"("chatbotId", "sessionId") WHERE "status" IN ('CONNECTING', 'CONNECTED');`
3. `ALTER TABLE conversation_logs ADD COLUMN handoffTurn BOOLEAN NOT NULL DEFAULT false` · `apiNotice` 동일.
4. `CREATE INDEX "conversation_logs_chatbotId_sessionId_createdAt_idx" ON "conversation_logs"("chatbotId", "sessionId", "createdAt");`
- **비파괴 변경만** — 기존 행·컬럼 변경 0, **백필 0**(두 불리언 = false가 사실이거나 "사유 미상"으로 안전하게 표시). 롤백 = 4테이블 DROP + 2컬럼 제거 + 인덱스 2개 DROP.
- ⚠ `prisma migrate dev` diff에 `test_runs`·`deploy_schedules`의 부분 유니크 삭제 구문이 끼어들지 않는지 확인하고 있으면 제거한다(기존 규약).
- **인덱스 생성 비용(NFR-CSP7)**: SQLite `CREATE INDEX`는 테이블 전체를 읽고 생성 동안 DB 쓰기 잠금을 잡는다. **기존 배포 순서(마이그레이션 → API 기동)대로 API 중지 상태에서 실행**하므로 대화 로그 쓰기 경합이 없다. 구현자는 `conversation_logs` 100만 행 합성 DB에서 소요 시간·파일 증가량을 측정해 `docs/05-ops/자동배포.md`에 기록한다(기대: 수 초 ~ 수십 초). Postgres 전환 시 `CREATE INDEX CONCURRENTLY`로 분리 실행한다(재검토 트리거).
- 신규 컬럼 2개는 **상수 기본값 `ADD COLUMN`**이라 SQLite에서 테이블 재작성이 없다.

### 3.3 seed

- 데모 챗봇: `ChatbotHandoffSetting`(enabled=false — 기본 꺼짐 확인용) · 자주 쓰는 문장 3건(분류 "인사"·"배송"·"환불", 단축어 `hi`·`ship`·`refund`).
- 데모 `AGENT` 계정 1개(`agent@chat-bot.local`, 임시 비밀번호는 `BOOTSTRAP_ADMIN_PASSWORD`와 같은 규약 — 첫 로그인 변경 강제). **스레드·메시지 시드는 만들지 않는다**(상담은 대화로만 생긴다 — 시험 픽스처는 시험 코드가 직접 적재).

### 3.4 신규 환경변수 (5종 — 전부 선택 · 기본값 · 기동 조건 아님, FR-0-128)

| 변수 | 기본 | 설명 | 커밋 |
|---|---|---|---|
| `PUBLIC_POLL_RATE_LIMIT_IP_PER_MIN` | `600` | 공개 폴링 공용 IP 버킷(`poll-ip:{ip}`) — 보류 답변·상담 폴링 공용 | ① K-1 |
| `PUBLIC_HANDOFF_POLL_RATE_LIMIT_SESSION_PER_MIN` | `40` | 상담 폴링 세션 키 버킷(`poll-key:handoff:{sessionId}`) — 3초 간격 20회 × 탭 복제 2 | ② |
| `HANDOFF_POLL_INTERVAL_MS` | `3000` | 상담 중 폴링 간격(서버가 `pollAfterMs`로 전달) | ② |
| `HANDOFF_WATCH_WINDOW_MS` | `180000` | 관찰 창 길이 | ② |
| `HANDOFF_WATCH_INTERVAL_MS` | `5000` | 관찰 창 폴링 간격 | ② |

코드 상수(환경변수 아님): 보류 답변 폴링 키 버킷 60/분 · 정리 루프 60초 · 원문 절대 상한 60분(`HANDOFF_RAW_TEXT_MAX_AGE_MS`) · 종료 후 토큰 유예 5분 · 힌트 메모 LRU 500건/30분 · `HANDOFF_LIMITS`(§4.1). **기능 스위치는 챗봇별 설정**이다.

### 3.5 배포 순서 · 롤백

① K-1 커밋(단독 배포 가능) → ② 마이그레이션(API 중지) → API 배포 → 콘솔 배포 → **위젯 배포는 마지막**(구버전 위젯은 편승 격하로 동작하므로 순서가 뒤바뀌어도 오류 0).
- **롤백 안전성**: 구버전 API는 요청의 `features`와 헤더를 무시(strip)하고 봇으로 응답한다 — 새 위젯은 `handoff` 필드가 없으면 폴링하지 않는다(오류 0). 활성 상담 행은 남지만 구버전은 읽지 않는다. **⚠ 롤백 시 `rawText`가 남은 행은 구버전이 정리하지 못한다** → 롤백 절차에 `UPDATE handoff_messages SET rawText = NULL, rawExpiresAt = NULL` 1회 실행을 포함한다(운영 문서 인계 — §25 K-9).

---

## 4. shared-types 스키마

### 4.1 `packages/shared-types/src/handoff.ts` (신설 — 위젯 비유입)

| 스키마/상수 | 내용 |
|---|---|
| `HandoffStatus` | `z.enum(['CONNECTING','CONNECTED','ENDED'])` |
| `HandoffEndReason` | `z.enum(['AGENT_ENDED','USER_IDLE','AGENT_NO_REPLY','NOT_DELIVERED','CHANNEL_CLOSED'])` + `HANDOFF_END_REASON_LABELS`(`USER_IDLE` = "응답 없음으로 종료" — §26 D-9) |
| `HandoffClientMode` | `z.enum(['MODERN','LEGACY'])` |
| `AlertLevel` | `z.enum(['NORMAL','CAUTION','WARNING'])` + `ALERT_LEVEL_LABELS`("정상"·"주의"·"경고") |
| `UnansweredReason` | `z.enum(['FALLBACK','API_NOTICE'])`("답변 못함"·"연동 실패") |
| `HANDOFF_LIMITS` | `{ cannedPerChatbot: 200, messageMax: 1000, noticeMax: 200, buttonLabelMax: 40, takeoverReasonMax: 200, liveListPageSize: 50, liveListRowCap: 20000, transcriptPage: 200, historyMaxDays: 92, cannedTitleMax: 50, cannedCategoryMax: 30, cannedShortcutMax: 20 }` |
| `HandoffSettingsSchema` · `UpdateHandoffSettingsSchema` | §3.1 필드(`draining` 제외 — 서버 관리). **PUT 전체 교체**(`ChatbotAnswerSetting` 규약) · `superRefine`: `warning > caution` · 버튼 라벨/노드 둘 다 또는 둘 다 없음 · 범위 |
| `SessionRefParamSchema` | `z.string().regex(/^[0-9a-f]{16}$/)` |
| `LiveSessionListQuerySchema` | `alert?`(csvEnumArray `AlertLevel`) · `handoff?`(`NONE｜ACTIVE｜ENDED`) · `channel?` · `page` · `pageSize`(기본 50) |
| `LiveSessionRowSchema` | `sessionRef` · `alias` · `channelType` · `firstAt` · `lastAt` · `turnCount` · `consecutiveUnanswered` · `windowUnanswered` · `blockedCount` · `alertLevel` · `lastUserText`(마스킹 100자) · `lastUnansweredReason?` · `handoff?: { id, status, assignedUserName, isMine, clientMode?, unverifiedAttemptCount, idleSeconds }` · `handoffSupported`(WEB 여부) — **`sessionId` 키 없음** |
| `LiveSessionListResponseSchema` | `paginated(LiveSessionRow)` ∧ `{ summary: { live, warning, caution, handoffActive }, truncated, windowMinutes, handoffEnabled, generatedAt }` |
| `TranscriptQuerySchema` | `cursor?`(불투명 문자열) · `includeRaw?`(queryBoolean) |
| `TranscriptEntrySchema` | 판별 유니온 `kind`: `BOT_TURN { logId, at, userText, botText, isAnswered, blocked, answeredBy?: { kind:'NODE'｜'FAQ'｜'RAG', name? }, unansweredReason? }` · `HANDOFF { messageId, handoffId, seq, at, sender, systemKind?, text, rawText?, senderName? }` |
| `TranscriptResponseSchema` | `{ entries, nextCursor, handoff: HandoffBriefSchema｜null, rawVisible: boolean, blockedDuringHandoff: number }` |
| `HintResponseSchema` | `{ source: { key, text(마스킹 100자) }｜null, mode: 'SEMANTIC'｜'LEXICAL', answers: HintAnswerItem[≤3], canned: HintCannedItem[≤3] }` · `HintAnswerItem { kind:'FAQ'｜'INTENT', refName, text, score }` · `HintCannedItem { id, title, body, category?, score }` |
| `HandoffDetailSchema` · `HandoffBriefSchema` | 상담 요약(id · alias · status · endReason · clientMode · 담당자 이름 · 시각들 · 카운트 · `unverifiedAttemptCount`) — **`sessionId`·`tokenHash` 없음** |
| `SendAgentMessageSchema` · `SendAgentMessageResponseSchema` | `{ text: 1~1000 }` → `{ seq, text(마스킹본), masked: boolean }` |
| `TakeoverHandoffSchema` | `{ reason: 1~200 }` |
| `MaskPreviewRequestSchema` · `MaskPreviewResponseSchema` | `{ text: 1~1000 }` → `{ maskedText, changed }` |
| `HandoffHistoryQuerySchema` · `HandoffHistoryItemSchema` · `HandoffSummaryResponseSchema` · `HandoffHistoryDetailResponseSchema` | 기간(`from`·`to` KST `dayBucket` 필수, ≤92일) · 상태 · 담당자 · 종료 사유 · 페이지 / 요약: `count`·`connectedCount`·`avgFirstResponseSec｜null`·`firstResponseSamples`·`avgDurationSec｜null`·`durationSamples`·`endReasonCounts` |
| `CannedResponseSchema` · `CreateCannedResponseSchema` · `UpdateCannedResponseSchema` · `MoveCannedResponseSchema`(`{ direction: 'UP'｜'DOWN' }`) · `CannedResponseListQuerySchema`(`q?`·`category?`·`enabled?`) | FR-CS8-1 |
| `HandoffConsoleChatbotItemSchema` | `{ chatbotId, name, status, handoffEnabled, activeHandoffCount }` · 응답 `{ items, myActiveCount }` |

순수 판정 함수는 **API `lib/`에 둔다**(콘솔은 서버 판정 결과만 렌더 — 공유 필요 없음. `evaluateSessionAlert`를 shared로 올리는 트리거 = 콘솔 로컬 미리보기 요구).

### 4.2 공개 계약 확장 (`packages/shared-types/src/conversation.ts`)

```ts
export const WIDGET_FEATURE_HANDOFF_V1 = 'handoff-v1';
export const HANDOFF_SESSION_HEADER = 'x-cb-session-id';
export const HANDOFF_TOKEN_HEADER = 'x-cb-handoff-token';

// PublicMessageRequestSchema — z.object 필드 1개 추가(strip 유지 · superRefine 불변)
features: z.array(z.string().min(1).max(32)).max(5).optional(),

// PublicMessageResponseSchema — 선택 필드 1개 추가. 없으면 바이트 동일(pendingAnswer 선례)
handoff: PublicHandoffStateSchema.optional(),

export const PublicHandoffStateSchema = z.object({
  status: z.enum(['NONE', 'CONNECTED', 'ENDED']),
  token: z.string().optional(),                 // 이 응답에서 1회만(§6)
  pollAfterMs: z.number().int().nonnegative().optional(),
  watch: z.object({
    windowMs: z.number().int().positive(),
    pollAfterMs: z.number().int().positive(),
    trigger: z.enum(['NOW', 'IF_PENDING_FAILS']),
  }).optional(),
});

export const HandoffPollQuerySchema = z.object({
  after: z.coerce.number().int().min(0).default(0),
  restore: queryBoolean().optional(),           // 새로고침 복구 — 자기 USER 메시지(마스킹본)도 포함
});

export const HandoffPollMessageSchema = z.object({
  seq: z.number().int().positive(),
  sender: z.enum(['USER', 'AGENT', 'SYSTEM']),  // USER는 restore=true일 때만
  text: z.string(),                             // ★ 항상 마스킹본 — rawText 키는 타입상 존재하지 않는다
  sentAt: z.coerce.date(),
  action: z.object({ kind: z.literal('NODE'), nodeId: z.string().uuid(), label: z.string() }).optional(),
});

export const HandoffPollResponseSchema = z.object({
  status: z.enum(['NONE', 'CONNECTED', 'ENDED']),
  token: z.string().optional(),
  messages: z.array(HandoffPollMessageSchema),
  cursor: z.number().int().min(0),              // 이번 응답이 훑은 최대 seq(내부 SYSTEM 포함 — 재요청 방지)
  pollAfterMs: z.number().int().positive().nullable(), // null = 폴링 중단
});
```
- 위젯은 zod를 번들에 넣지 않으므로 **헤더 이름·기능 문자열을 `apps/widget/src/constants/handoff.ts`에 복제**하고, 위젯 시험이 shared-types 상수와 같은지 단언한다(시험 전용 import).
- `ConversationStateSchema`·`PendingAnswerPollResponseSchema`는 **불변**이다.

---

## 5. 공개 대화 파이프라인 — 개입 분기 위치 (FR-0-118/119 · FR-CS4-\*)

### 5.1 순서 (`PublicConversationService.sendMessage(slug, dto, { handoffToken? })`)

```
①   access.resolve(slug)                         (기존 — 챗봇·WEB 채널, 캐시 없음)
②   adapter.normalizeInbound(dto)                (기존)
②.5 입구 금지어 → BLOCK이면 기존 그대로 반환     (★ 불변 — 상담 조회도 하지 않는다. 상담 중 BLOCK은 상담원에게 전달 0, 콘솔은 로그의 blockedByFilter로 "차단된 입력 n건")
②.7 [No.24] HandoffGateService.evaluate({ chatbot, dto, inbound, token, now })
      hs = handoffSettingsCache.get(chatbotId)                               // 메모리(미스 시 PK 1회 / 30초)
      needLookup = hs.enabled || hs.draining || token !== undefined           // 꺼진 챗봇 + 토큰 없음 = 조회 0 → 기존 경로 그대로
      latest = handoffSession.findFirst({ chatbotId, sessionId }, orderBy startedAt desc)   // 인덱스 1회
      → §5.3 판정표: HANDLED(응답 반환 · 엔진 미호출) | PASS(clearedState?) | PASS_WITH_ENDED_NOTICE
③~④.6 (기존) 번들·설정·의미 점수·resolveTurn·레거시 완결·설문 적재 — 입력 봉투는 PASS가 돌려준 값(§5.4)
⑤~⑨ (기존) 출구 필터·RAG 분기·응답 조립
      + [No.24] 응답에 handoff 부착(§5.5): hs.enabled && features ∋ handoff-v1 && !isAnswered → watch{NOW}
                                      PENDING 경로 → watch{IF_PENDING_FAILS}   (그 밖엔 키 없음)
⑩   record({ …, apiNotice, handoffTurn: false })  fire-and-forget (apiNotice는 이제 컬럼에도 기록)
```
- **상담 꺼진 챗봇(행 없음·`enabled=false`·`draining=false`)이고 토큰 헤더가 없으면** ②.7은 메모리 조회 1회 후 즉시 `PASS(원래 봉투)`이며 응답에 `handoff` 키가 없다 → **바이트 동일 · 캐시 적중 시 추가 DB 조회 0**(FR-0-119). 캐시 미스(챗봇·인스턴스당 30초에 최대 1회)에만 PK 1회가 추가된다 — 요구사항 문구를 이 의미로 정밀화한다(패치 D-9·D-26).
- **토큰 헤더가 있으면 설정과 무관하게 조회**한다 — 다른 인스턴스의 설정 캐시가 30초 늦어도 토큰을 가진 사용자의 발화가 봇으로 새지 않게 한다(§25 K-3).

### 5.2 `HandoffGateService` 입력·출력

```ts
type GateResult =
  | { kind: 'PASS'; state: unknown }                               // 엔진으로 진행(state = 원래 또는 정리된 봉투)
  | { kind: 'PASS_WITH_ENDED_NOTICE'; state: unknown }             // 방금 끝난 상담의 토큰 보유 위젯 — 응답에 handoff{ENDED, pollAfterMs:0}
  | { kind: 'HANDLED'; response: PublicMessageResponse; log: RecordConversationLogParams };  // 엔진 미호출
```
`HANDLED` 응답 조립·스레드 적재는 게이트 안에서 끝나고, 로그 적재(fire-and-forget)만 파이프라인이 기존 `logService.record()`로 수행한다(쓰기 주체 1곳 유지 — R-9).

### 5.3 판정표 (`lib/handoff-auth.ts` + `lib/handoff-expiry.ts`)

| # | 최신 상담 `latest` | 요청 | 판정 · 동작 |
|---|---|---|---|
| G-0 | 없음 | — | `PASS(원래 봉투)` |
| G-1 | 활성인데 `judgeHandoffExpiry()`가 종료 사유 반환 | — | `thread.endHandoff(CAS)` 후 `ENDED`로 보고 G-7~G-9로 재판정 |
| G-2 | `CONNECTING` · `tokenHash=null` · `clientMode=null` | `features ∋ handoff-v1` | **첫 접촉(MODERN)**: 토큰 CAS 발급(§6) + `CONNECTED` → G-4 처리(이번 발화 = 첫 USER 메시지) + 응답 `handoff{CONNECTED, token, pollAfterMs:0}`. CAS에서 지면(동시 폴링이 먼저 발급) G-6 |
| G-3 | 위와 같음 | `features` 없음(구버전) | **첫 접촉(LEGACY)**: `clientMode=LEGACY`·`CONNECTED` CAS → G-5. CAS에서 지면 G-6 |
| G-4 | `CONNECTED` · `MODERN` | 토큰 헤더 = `tokenHash`(상수 시간 비교) | **검증됨**: USER 메시지 await 적재(§8.3 — 실패 시 `503 HANDOFF_UNAVAILABLE`) → `HANDLED { outputs: [], state: clearEnvelopeForHandoff(요청 봉투), stateReset:false, handoff{CONNECTED, pollAfterMs: HANDOFF_POLL_INTERVAL_MS} }` · 로그 `handoffTurn=true, isAnswered=true, botResponse=''` |
| G-5 | `CONNECTED` · `LEGACY` | 토큰 없음 · `features` 없음 | **편승 격하**: USER 적재 → `HANDLED { outputs: 미전달 AGENT·공개 SYSTEM 메시지를 TEXT로(seq > legacyDeliveredSeq), state: 정리된 봉투 }` + `legacyDeliveredSeq` CAS 전진 · **`handoff` 키 없음**(AC-CS4-7) |
| G-6 | 활성이지만 G-2~G-5 어디에도 해당하지 않음 | `MODERN` 상담에 토큰 없음·불일치·구버전 요청 · `LEGACY` 상담에 토큰/기능 선언 요청 · 첫 접촉 CAS에서 진 요청 | **미확인**: 적재 0 · `unverifiedAttemptCount` 원자 +1 · `HANDLED { outputs: [TEXT "지금은 메시지를 보낼 수 없어요. 잠시 후 다시 시도해 주세요."], state: 요청 봉투 그대로 }` · `handoff` 키 없음 · 로그 `handoffTurn=true` |
| G-7 | `ENDED` · `endedAt + 5분 ≥ now` · 토큰 유효 | — | `PASS_WITH_ENDED_NOTICE(정리된 봉투)` — 위젯은 봇 출력을 그리기 **전에** 폴링 1회로 종료 안내를 먼저 그린다(§14.2 ⑥) |
| G-8 | `ENDED` · `LEGACY` · `legacyDeliveredSeq < lastSeq` | 구버전 | `PASS(정리된 봉투)` + **봇 출력 앞에** 미전달 종료 안내(TEXT) 전치 + 커서 전진 |
| G-9 | `ENDED`(그 밖) | — | `PASS(connectedAt 이전 진행 상태만 정리 — §5.4)` |

- `NODE` 버튼 입력은 상담 구간에서 **노드를 실행하지 않고** `"[선택] {label}"` 텍스트로 USER 메시지가 된다(FR-CS4-3·EX-CS-9). `MESSAGE` 버튼은 그 텍스트.
- 상담 구간에서는 엔진·의미 점수·레거시·설문 적재·RAG가 **호출되지 않는다**(구조 — 반환이 ③보다 앞).
- G-6 메시지는 **엔진 밖 고정 문구**이며 금지어 출구 필터를 통과시킨다(기존 BLOCK 안내와 같은 취급).

### 5.4 봉투 정리 (`lib/envelope-clear.ts` — J-16 확정)

```ts
/** 상담이 연결된 시각 이전에 시작된 진행 상태를 비운다. 새 키·새 값 0 — 줄이기만 한다. 멱등. */
export function clearEnvelopeForHandoff(raw: unknown, connectedAt: Date): unknown
// ConversationStateSchema.safeParse 실패 → raw 그대로(엔진이 기존 sanitize로 처리)
// contextSession(startedAt < connectedAt) → null · surveySession(startedAt < connectedAt) → 키 삭제
// pendingClarify → 키 삭제(발급 시각 필드가 있으면 connectedAt 이전만) · completedSurveyIds·version 유지
```
- **상담 중(G-4/G-5)에는 매 응답에서 정리된 봉투를 돌려준다**(멱등 — 이미 비었으면 요청과 동일). 요구사항 J-16의 "첫 전달 응답에서만 비우고 이후 그대로 반환"은 **토큰이 폴링으로 발급되는 경우 POST 응답이 없어** 성립하지 않으므로 이 규칙으로 대체한다(§26 D-5).
- **종료 후(G-7~G-9)** 첫 턴에도 같은 함수를 적용한다 — 폴링으로만 연결되고 사용자가 한 번도 말하지 않은 상담 뒤 첫 발화가 오래된 폼·설문 답으로 소비되는 혼선 방지.
- 설문은 봉투에서 사라지면 **조회 시점 이탈 판정**으로 자연 처리된다(설문 이탈 사유 신설 없음 — ADR-0035).

### 5.5 관찰 창 (J-2 · §1.3.2)

- 조건: `hs.enabled` ∧ 요청 `features ∋ handoff-v1` ∧ 이번 턴 `isAnswered=false` ∧ `blockedByFilter=false`(BLOCK 경로는 ②.5에서 이미 반환) ∧ 활성 상담 없음.
- 응답: `handoff: { status: 'NONE', watch: { windowMs: HANDOFF_WATCH_WINDOW_MS, pollAfterMs: HANDOFF_WATCH_INTERVAL_MS, trigger: 'NOW' } }`.
- **보류 답변(PENDING) 턴**: 결과를 모르므로 `trigger: 'IF_PENDING_FAILS'`를 싣는다 — 위젯이 보류 폴링 결과가 `FAILED`/`EXPIRED`/시간 초과면 그때 관찰 창을 연다. **`pollMessage` 서버 코드·응답 스키마는 무변경**(ADR-0023 경로 불가침 — §26 D-6).
- `apiNotice` 턴(`isAnswered=false`)도 관찰 창 대상이다(P-6 "연동 실패 = 사람이 도울 사용자").
- 설문 턴(`isAnswered`가 설문 때문에 false가 되지 않음 — AC-SV2-9)·응답 턴은 창을 열지 않는다. 새 미응답마다 창이 **연장**된다(위젯 규칙).

### 5.6 구버전 위젯 (편승 격하 — P-2)

- `features`가 없는 요청에는 **관찰 창·토큰·`handoff` 필드를 절대 싣지 않는다**(구버전 스키마가 strip하더라도 계약상 0).
- 개입은 다음 사용자 발화의 응답에서만 전달된다(G-3 → G-5). 전달 내용은 연결 안내 + 상담원 메시지를 `TEXT` 아웃풋으로(발신자 구분 없음 — 구버전 한계, 콘솔에 `구버전 위젯` 배지).
- **신뢰 수준**: LEGACY 상담은 토큰이 없어 `sessionId`만으로 송수신된다(기존 봇 대화와 같은 신뢰 수준). 선점 위험은 §6.4와 같이 수용·탐지한다. 위젯은 우리 서버가 배포하므로 구버전은 브라우저 캐시·자체 호스팅 사본에서만 생긴다(재검토 트리거: LEGACY 비율 > 5% 지속 → 격하 경로 제거 검토).

### 5.7 로그 적재 규칙

| 턴 | `ConversationLog` | `HandoffMessage` |
|---|---|---|
| 상담 구간 검증 발화(G-4/G-5) | 1행 · `handoffTurn=true` · `isAnswered=true` · `botResponse=''`(G-5는 전달한 TEXT) · `matched*=null` · fire-and-forget | USER 1행 · **await**(전달 보장 — FR-CS4-4) |
| 미확인 발화(G-6) | 1행 · `handoffTurn=true` · `botResponse`=중립 안내 | 0 |
| 상담 중 BLOCK | 기존 BLOCK 1행(`blockedByFilter=true`, `handoffTurn=false` — 경고 판정에서 어차피 중립) | 0 |
| 상담원·시스템 메시지 | 0(사용자 턴이 아니다) | AGENT/SYSTEM 1행 |

`handoffTurn=true`는 **스레드 적재 결정과 같은 판단**에서 파이프라인이 전달한다(API가 추정하지 않는다 — 판정 1곳). 로그 `update` 0건(R-10) 유지.

---

## 6. 상담 토큰 (P-5 · NFR-CSS1)

### 6.1 형식·보관

- `randomBytes(32).toString('base64url')`(43자, 256비트). DB에는 **`sha256(token)` hex만** `HandoffSession.tokenHash`(UNIQUE)에 저장. 원문 컬럼 없음.
- 위젯은 `sessionStorage` **별도 키** `cb.handoff.{slug}`에 `{ token, cursor }`로 보관하고 봉투에 넣지 않는다(ADR-0009 §3). 요청 시 헤더 `x-cb-handoff-token`으로만 전송(URL·본문 금지).
- 비교는 요청 토큰의 해시로 `tokenHash` 동등 조회 후 `timingSafeEqual`로 재확인하고, **슬러그의 챗봇·요청 `sessionId`·상담 행이 모두 일치**해야 유효하다(교차 챗봇 = `404`).

### 6.2 1회 발급 (CAS)

```ts
// handoff-thread.service.ts — 발급은 이 조건부 갱신 1곳뿐
const count = await tx.handoffSession.updateMany({
  where: { id, status: 'CONNECTING', tokenHash: null, clientMode: null },
  data: { tokenHash: sha256(token), tokenIssuedAt: now, clientMode: 'MODERN', status: 'CONNECTED', connectedAt: now },
});
// count === 1 → 이번 응답에만 token 원문을 싣는다 · count === 0 → 다른 요청이 먼저 가져감 → G-6(미확인)으로 처리
```
- 발급 경로는 **공개 폴링(관찰 창)과 POST(다음 발화) 중 먼저 온 쪽**이다(FR-CS4-7). 재발급 API는 없다.
- 토큰 원문은 **응답 본문 1회**에만 존재한다 — 서버 로그·감사·오류 응답·`HandoffMessage`·metrics 어디에도 없다(§18 H-6 · AC-CS4-9).

### 6.3 무효화

- `ENDED` 후 **5분 유예** 동안은 종료 안내 수신용으로 유효(`status: ENDED` 응답), 그 뒤 `404 HANDOFF_NOT_FOUND`(위젯은 키 삭제). 재개입은 **새 `HandoffSession` + 새 토큰**(FR-CS5-8).
- `tokenHash`는 무효화 후에도 지우지 않는다(이력 행 불변 — 유예 판정은 `endedAt` 기준).

### 6.4 위협 대응 요약 (요구사항 §1.4.2 → 설계 위치)

| 위협 | 방어 | 위치 |
|---|---|---|
| 엿보기 | 토큰 없으면 메시지 0 · 토큰 없는 폴링은 활성 상담 존재도 숨김(`NONE`) | §7.2 |
| 가장 | 토큰 없는/틀린 발화는 전달 0 + 중립 안내 | §5.3 G-6 |
| 선점 | 1회 발급 CAS · 두 번째 요청자는 미확인 처리 → `unverifiedAttemptCount` 콘솔 표시 · 상담원 종료 후 재개입 | §6.2 · EX-CS-11 |
| 교차 챗봇 | 슬러그↔상담 챗봇 불일치 `404` | §6.1 |
| 폭주 | 폴링 전용 버킷 + Origin 가드 상속 | §7.3 |
| `sessionId` 유출 | 관리자 경로는 `sessionRef`(해시)만 · DTO에 `sessionId` 필드 부재 | §10.2 · §18 H-17 |

---

## 7. 공개 상담 폴링 API · 폴링 버킷 (FR-CS6-\* · P-2 · P-18)

### 7.1 계약

```
GET /api/v1/public/chatbots/:slug/handoff?after=<seq>&restore=<bool>
헤더: x-cb-session-id: <uuid v4>(필수) · x-cb-handoff-token: <token>(선택)
→ 200 HandoffPollResponse · Cache-Control: no-store
→ 400 VALIDATION_FAILED(세션 헤더 없음/형식 오류) · 403(챗봇 비공개·채널 닫힘 — 기존 DISABLED 처리) · 404 HANDOFF_NOT_FOUND(토큰 무효·만료·교차) · 429
```
- `@Public()` **7번째** — `PublicConversationController#pollHandoff`(가드 `PublicRateLimitGuard` → `PublicOriginGuard` 클래스 단위 상속).
- **GET + 헤더**를 택한다: 폴링은 읽기(멱등)이고 `sessionId`·토큰이 URL(접근 로그·프록시 로그)에 남지 않는다. 커스텀 헤더는 CORS 프리플라이트를 유발하므로 **공개 표면 CORS 옵션에 `maxAge: 600`**을 추가한다(`main.ts` — 공개 경로 판정·`origin: '*'`·무자격증명은 불변. 브라우저가 프리플라이트를 최대 10분 캐시 — Chromium 상한 2시간 이내). 기존 요청 헤더는 `cors` 기본값(요청 헤더 반사)으로 허용된다.
- 응답에 상담원 이름·이메일·사용자 id·`HandoffSession.id`·전체 `sessionId`·원문이 **없다**(스키마로 봉인 — §4.2).

### 7.2 처리 순서 (`HandoffPublicPollService.poll()`)

1. (컨트롤러) `access.resolve(slug)` — 기존과 같은 403/404.
2. `latest = handoffSession.findFirst({ chatbotId, sessionId }, orderBy startedAt desc)`(1회). **설정이 꺼져 있어도 조회**한다(진행 중 상담 유지 — FR-CS1-4).
3. 활성 + 만료면 `endHandoff(CAS)`(G-1과 같은 함수).
4. 분기:
   - 토큰 있음: 해시·챗봇·세션·상담 일치 + (`CONNECTED` 또는 `ENDED` 5분 유예 내) → 메시지 반환 / 불일치·유예 경과 → `404`.
   - 토큰 없음 + `CONNECTING` + 미발급 → **1회 발급**(§6.2) → `status: CONNECTED, token` + 커서 이후 메시지.
   - 토큰 없음 + 그 밖(활성 MODERN 포함) → `{ status: 'NONE', messages: [], cursor: after, pollAfterMs: HANDOFF_WATCH_INTERVAL_MS }` — 활성 상담이면 `unverifiedAttemptCount` +1(존재를 드러내지 않는다 — AC-CS4-2).
5. 메시지: `handoffMessage.findMany({ handoffSessionId, seq > after }, orderBy seq, take 100)` — 반환 대상 = `AGENT` · `SYSTEM(CONNECTED｜ENDED｜FAILED)` · (`restore=true`면) `USER`. **`text`만 매핑**(원문 컬럼 미선택 — `select` 목록에 `rawText` 없음). `cursor` = 훑은 최대 seq.
6. `pollAfterMs`: `CONNECTED` → `HANDOFF_POLL_INTERVAL_MS` · `ENDED` → `null` · `NONE` → 관찰 간격.
- 폴링은 **DB 읽기 전용**이다(예외: 토큰 1회 발급 CAS · 만료 종료 CAS · 미확인 카운트 +1). 쿼리 = 가드 2(Origin) + resolve 2 + 상담 1 + 메시지 1 = **6회**(NFR-CSP3 P95 50ms — §19).

### 7.3 폴링 전용 레이트리밋 버킷 (K-1 포함)

```ts
// common/rate-limit/public-rate-bucket.decorator.ts
export interface PublicRateBucketSpec {
  kind: 'POLL';
  /** 두 번째 축의 키 출처 — 경로 파라미터 또는 요청 헤더 */
  key: { from: 'param'; name: 'messageId'; ns: 'msg' } | { from: 'header'; name: 'x-cb-session-id'; ns: 'handoff' };
  perKeyLimit: number | { env: string; fallback: number };
}
export const PublicRateBucket = (spec: PublicRateBucketSpec) => SetMetadata(PUBLIC_RATE_BUCKET_KEY, spec);
```
| 경로 | 1축(IP) | 2축(키) | 기존 `ip`·`session` 버킷 |
|---|---|---|---|
| `POST …/messages`·`GET …/config` | `ip:{ip}` 120/분 | `session:{body.sessionId}` 30/분 | **소비**(불변) |
| `GET …/messages/:messageId`(보류 답변 — **K-1 커밋**) | `poll-ip:{ip}` 600/분 | `poll-key:msg:{messageId}` 60/분(상수) | **미소비** |
| `GET …/handoff`(상담 폴링) | `poll-ip:{ip}` 600/분 | `poll-key:handoff:{x-cb-session-id}` 40/분 | **미소비** |

- 가드는 `Reflector`로 메타데이터를 읽어 **폴링이면 1·2축만** 소비한다. 키 값이 없거나 형식이 틀리면 2축을 건너뛴다(핸들러가 400). 초과 시 기존과 같은 `429 RATE_LIMITED` + `Retry-After`.
- 같은 NAT 뒤 상담 중 사용자 30명(3초 간격)까지 `poll-ip` 안이고 **일반 전송 `ip` 버킷은 폴링 때문에 소모되지 않는다**(AC-CS4-5). 공격자가 `sessionId`를 바꿔 가며 폴링해도 `poll-ip`가 상한이다.
- 저장소는 기존 `RateLimitStore`(프로세스 로컬 — 다중 인스턴스에선 인스턴스별 한도, 기존 수용과 같다).

---

## 8. 상담 스레드 쓰기 (`handoff-thread.service.ts` — 쓰기 유일 파일)

### 8.1 메서드 (전부 인터랙티브 트랜잭션 · CAS)

| 메서드 | 핵심 | 호출처 |
|---|---|---|
| `createHandoff(input)` | `create` — 부분 유니크 위반(`P2002`) → `409 HANDOFF_ALREADY_ASSIGNED`(현 담당자 이름) · 같은 tx에서 `SYSTEM CONNECTED`(연결 안내 문구 스냅샷, seq 1) 적재 | 관리자 ④ |
| `issueModernToken` / `markLegacy` | §6.2 CAS | 게이트·폴링 |
| `appendUserMessage(id, rawInput, logId)` | 마스킹(§8.3) → `lastSeq` 원자 증가 → USER 행(`rawText` 조건부 · `rawExpiresAt`) → `lastUserMessageAt`·`userMessageCount` | 게이트 |
| `appendAgentMessage(id, userId, text)` | CAS 조건 `status ∈ 활성 ∧ assignedUserId = 요청자`(0행 → `409 HANDOFF_NOT_ACTIVE` 또는 `403 HANDOFF_NOT_ASSIGNEE` 재판정) → 출구 마스킹(§9.5) → AGENT 행 → `firstAgentReplyAt`(null일 때만)·`lastAgentMessageAt` | 관리자 ⑤ |
| `endHandoff(id, reason, actor?)` | **①** `enableSecureDelete(tx)` **②** `updateMany(status ∈ 활성 → ENDED, endReason, endedAt, endedBy*)` 0행이면 종료(멱등) **③** `SYSTEM ENDED`(또는 `AGENT_NO_REPLY`로 연결돼 있었으면 `FAILED` + `ENDED`) + 종료 후 버튼 `action`(노드가 존재·사용 중일 때만) **④** `handoffMessage.updateMany({ handoffSessionId: id, rawText: { not: null } } → rawText: null, rawExpiresAt: null)` | 관리자 ⑥ · 게이트 · 폴링 · 목록 · 정리 루프 |
| `takeover(id, admin, reason)` | CAS 담당자 교체 + `SYSTEM TAKEOVER`(내부) | 관리자 ⑦ |
| `incrementUnverified(id)` · `advanceLegacyCursor(id, seq)` | 원자 증가 / CAS | 게이트·폴링 |
| `purgeExpiredRaw(now)` | ① pragma ② `updateMany({ rawExpiresAt ≤ now })` ③ `updateMany({ rawExpiresAt ≠ null, handoffSession.status = ENDED })`(방어선) | 정리 루프 |

- **`lastSeq` 발급**: `update({ where: { id }, data: { lastSeq: { increment: 1 } }, select: { lastSeq } })` → 그 값으로 메시지 생성(같은 tx). `(handoffSessionId, seq)` UNIQUE가 최종 방어선.
- **예외 처리**: Prisma 예외는 **코드·클래스명만** 경고 로그로 남기고(메시지 본문·인자 미기록 — Prisma 검증 오류 메시지는 호출 인자를 포함할 수 있다) `ApiException`으로 재포장한다(`503 HANDOFF_UNAVAILABLE` 또는 해당 409).

### 8.2 개입 생성 (P-8)

순서: 스코프·권한(`cs:write`) → 설정 `enabled`(아니면 `409 HANDOFF_DISABLED`) → 챗봇 `ACTIVE` ∧ WEB 채널 사용 중(아니면 `409 HANDOFF_SESSION_NOT_LIVE`) → `sessionRef` 역해석(§10.2) → 세션 채널 = WEB ∧ 마지막 로그가 활성 창 안(아니면 `409 HANDOFF_SESSION_NOT_LIVE`) → 경고 판정 스냅샷 → `createHandoff`(부분 유니크 CAS) → 감사 `CREATE`. 두 요청이 겹치면 DB 유니크가 정확히 1건만 통과시킨다(AC-CS3-1 · 다중 인스턴스 포함).

### 8.3 사용자 메시지 마스킹·원문 조건

```ts
const masked = maskPii(await bannedWordFilter.maskPlainText(input)).maskedText;   // record()와 같은 함수·같은 순서(ADR-0013)
const rawText = handoff.status === 'CONNECTED' && masked !== input ? input : null; // P-9: 달라진 경우에만 · 활성 상담 중에만
const rawExpiresAt = rawText ? addMs(now, HANDOFF_RAW_TEXT_MAX_AGE_MS) : null;
```

### 8.4 시간 기반 종료 판정 (`lib/handoff-expiry.ts` — P-14)

```ts
judgeHandoffExpiry(row, s: HandoffSettings, channelOpen: boolean, now): HandoffEndReason | null
// 우선순위: ① !channelOpen(챗봇 비ACTIVE·WEB 비활성) → CHANNEL_CLOSED
//          ② firstAgentReplyAt=null ∧ now − startedAt ≥ agentNoReply → AGENT_NO_REPLY
//          ③ status=CONNECTING ∧ now − startedAt ≥ userIdle → NOT_DELIVERED
//          ④ status=CONNECTED ∧ now − max(connectedAt, lastUserMessageAt, lastAgentMessageAt) ≥ userIdle → USER_IDLE
```
- ④는 **"양쪽 모두 10분간 아무 말이 없음"**이다 — 상담원이 방금 보낸 메시지에 사용자가 답하지 않은 것뿐 아니라 사용자가 보낸 뒤 상담원이 10분간 답하지 않은 경우도 끝낸다(사용자가 봇 없이 무기한 갇히지 않게). 표시 라벨은 "응답 없음으로 종료"(§26 D-9).
- 판정 시점: 콘솔 목록·대화 보기·개입·전송·종료 요청, 공개 POST·폴링, **정리 루프(60초)**. 여러 인스턴스가 동시에 판정해도 `endHandoff`의 CAS가 1회만 통과시킨다(AC-CS6-4).
- `CHANNEL_CLOSED`는 공개 요청에서는 `access.resolve()`가 먼저 403을 내므로 콘솔·정리 루프에서 판정된다(FR-CS5-7).

### 8.5 강제 인수 · 종료 권한

- 종료: 담당자 또는 ADMIN(`cs:write` + 서비스 재검증 — `403 HANDOFF_NOT_ASSIGNEE`).
- 강제 인수: `cs:write` + **현재 사용자 역할 = ADMIN**(서비스 재검증) · 사유 1~200자 · 토큰·스레드·사용자 화면 불변 · 이전 담당자의 전송은 즉시 `403`(CAS 조건에서 탈락) · 감사 `UPDATE`(사유 포함, 본문 없음).

### 8.6 정리 루프 (`handoff-sweeper.service.ts` — P-9 (b)의 결과)

- `common/polling/PollingLoop`(ADR-0032) **두 번째 소비자**. 주기 60초 · `onApplicationBootstrap`에서 `runOnce()` 1회 후 `start()` · `onModuleDestroy`에서 `stop()`. 시계는 `CLOCK` 포트 주입(시험은 `FakeClock` + `runOnce()`).
- tick: ① 활성 상담 조회(`status IN (CONNECTING, CONNECTED)` — `@@index([status, startedAt])`, 상한 500) ② 해당 챗봇 상태·WEB 채널 1회 조회 + 설정 캐시 ③ `judgeHandoffExpiry` → `endHandoff` ④ `purgeExpiredRaw(now)` ⑤ `draining=true`인데 활성 0건인 챗봇 → `handoff-settings.service`가 false로 갱신·캐시 무효화.
- **모든 인스턴스가 실행**한다(선점 불필요 — 모든 연산이 멱등 CAS·조건부 갱신). tick 예외는 코드만 로그(메시지 인자 금지)로 흡수.
- **P-14와의 관계**: 종료 판정 함수·시점은 그대로이고, **같은 함수를 주기적으로도 호출**한다. 조회 시점 판정만으로는 아무도 보지 않는 상담(사용자 이탈 + 콘솔 닫힘)의 원문이 무기한 남기 때문이다 — **PM 확인 1**(보고서). 거부 시 대안: 루프가 상태는 바꾸지 않고 원문만 소거(판정 결과가 "끝났어야 함"인 상담의 원문 소거) — 결과(원문 파기 시각)는 같고 상태 전이 시각만 늦어진다.

---

## 9. ★ 원문 보관 · 파기 · 열람 (P-9 (a)~(g))

### 9.1 (a) 어디에, 얼마나 — `HandoffMessage.rawText`(DB 컬럼 · 행 단위 임시)

| 후보 | 판정 |
|---|---|
| 서버 메모리(Map·LRU) | **기각** — 사용자 발화를 받은 인스턴스와 콘솔 요청을 받은 인스턴스가 다르면 보이지 않고, 재시작 시 사라진다(ADR-0032 "프로세스 로컬 상태를 정합성 근거로 쓰지 않는다"). 공유하려면 Redis(유보) 필요 |
| 별도 원문 테이블 + 종료 시 행 삭제 | **기각** — PM 조건 "행 삭제가 아닌 필드 소거" · 상담 테이블 삭제 경로 0 봉인과 충돌(삭제 허용 테이블이 새로 생긴다) |
| **`HandoffMessage.rawText` 컬럼 + 조건부 NULL 소거** ★ | **채택** — DB가 원천이라 다중 인스턴스·재시작에 안전, 소거는 `updateMany` 1회(행 보존), 봉인은 "이 컬럼의 유일한 쓰기 = 적재 시 값 · 이후 NULL"로 표현 가능 |

- **대상**: 사용자(USER) 메시지만 · **활성 상담(`CONNECTED`) 중 적재된 것만** · **마스킹본과 다를 때만**(PII·금지어가 없는 발화는 원문 = 마스킹본이라 저장하지 않는다 — 원문 저장량 최소화). 봇 구간(`ConversationLog`)·상담원 메시지·시스템 메시지에는 원문이 **없다**.
- **보관 기간**: 상담이 끝날 때까지, 단 **메시지당 최대 60분**(`rawExpiresAt`). 긴 상담에서 60분이 지난 초기 발화는 마스킹본으로 돌아간다(§25 K-5).

### 9.2 (b) 확실한 파기 — 3겹 + 물리 잔존 대책

| 겹 | 시점 | 방법 |
|---|---|---|
| ① 종료 트랜잭션 | 상담원 종료·강제 종료·시간 종료·채널 닫힘 판정 **그 순간** | `endHandoff` 안에서 상태 CAS와 **같은 트랜잭션**으로 `rawText = NULL` — "종료됐는데 원문이 남은" 상태가 커밋될 수 없다 |
| ② 정리 루프 | 60초마다(+ 기동 즉시 1회) | 시간 종료 판정 → ①을 호출 · `rawExpiresAt ≤ now` 소거 · `ENDED`인데 남은 원문 소거(방어선) |
| ③ 절대 상한 | 적재 후 60분 | 읽기 경로가 `rawExpiresAt > now`만 노출(논리 즉시) + ②가 물리 소거(최대 60초 지연) |

- **읽기 즉시성**: 열람 판정(§9.3)이 `status = CONNECTED ∧ rawExpiresAt > now`를 요구하므로 **종료·만료 순간부터 응답에 원문이 실리지 않는다** — 물리 소거를 기다리지 않는다.
- **물리 잔존**: SQLite는 갱신으로 비워진 셀 내용을 기본적으로 파일에 남긴다. 소거 트랜잭션마다 **`PRAGMA secure_delete = ON`**(`handoff-secure-delete.query.ts` — `$queryRaw` 1줄, 트랜잭션 연결에 적용, Postgres에서는 호출하지 않음)을 먼저 실행해 비워지는 셀을 0으로 덮는다. 이 때문에 `stats-retention-sealing.spec.ts` R-7의 원시 SQL 보유 파일이 **3 → 4**가 된다(의도된 변경 — §22.2). **남는 잔존**(rollback 저널 파일 블록·백업·파일시스템 스냅샷·B-tree 재균형 중 복사된 여유 공간)은 애플리케이션이 보증하지 않는다 → 디스크 암호화·백업 보존 정책은 운영/No.45(§25 K-6).
- **봉인과의 관계**: 상담 테이블 **행 삭제 0건**은 그대로다. `HandoffMessage`의 **유일한 갱신이 원문 소거**임을 정적 검사가 단언한다(§18 H-3). 서버 정지 중에는 파기가 지연되고 기동 즉시 ②가 처리한다(§25 K-7).

### 9.3 (c) 열람 권한 — 담당자·ADMIN · 명시 요청 · 상담 중 한정

```ts
// lib/raw-visibility.ts
export function canViewRaw(h: { status; assignedUserId }, viewer: { id; role; permissions }, includeRaw: boolean): boolean {
  return includeRaw
    && h.status === 'CONNECTED'
    && viewer.permissions.includes('cs:write')
    && (h.assignedUserId === viewer.id || viewer.role === 'ADMIN');
}
```
| 열람자 | 원문 |
|---|---|
| 담당 상담원(AGENT·ADMIN 담당) | 상담 중 `includeRaw=true` 요청 시 ○ |
| 담당이 아닌 ADMIN | ○(상담 중 · 감사됨) |
| 담당이 아닌 AGENT | ✕(마스킹본) |
| EDITOR(`cs:read`만) | ✕ |
| VIEWER | 화면 접근 불가 |
| 종료 후 누구든 | ✕(원문 자체가 없다) |

- **원문 노출 출구는 `GET …/live-sessions/:sessionRef/transcript` 1개뿐**이다. 이력 상세·목록·힌트·폴링·이력 요약은 `rawText`를 **선택(select)조차 하지 않는다**(§18 H-5).
- 강제 인수 후 이전 담당자는 다음 폴링부터 `rawVisible: false`가 된다. 응답의 `rawVisible=false`를 받은 콘솔은 **캐시된 모든 항목에서 `rawText`를 지운다**(프런트 인계 — §21).
- `includeRaw`는 콘솔의 **`원문 보기` 토글**(기본값은 ui-designer — PM 확인 3)이 켜진 동안만 붙는다. 토글을 켜면 커서 없이 전체 재조회한다(증분 커서 응답에는 과거 항목의 원문이 없으므로).

### 9.4 (d) 원문 열람 감사 — P-16 조정안

- **`AuditAction`에 `RAW_VIEW`(라벨 "원문 열람") 신설**(13 → 14) — 이 프로젝트 **최초의 열람(읽기) 감사**다. 대상 `HandoffSession`, `targetName` = `상담 #{alias}`, summary = `상담 중 원문 열람(담당자｜관리자)`, `before/after` 없음, **본문 0**.
- **단위 = (상담, 열람자)당 1건**: 응답에 원문이 **실제로 1건 이상 실렸을 때** 처음 1회 기록한다. 중복 방지는 `auditLog.findFirst({ actorId, action: 'RAW_VIEW', targetType: 'HandoffSession', targetId })`(인덱스 `(actorId, createdAt)` + `createdAt ≥ handoff.startedAt`) + 인스턴스 로컬 메모(Set, 1,000건). 다중 인스턴스 동시 요청에서 **최대 인스턴스 수만큼 중복**될 수 있다 — 감사는 누락보다 중복이 안전하므로 수용한다.
- 2초 폴링마다 기록하지 않는 이유: 상담 1건에 수백 행이 쌓여 감사로그의 신호가 사라진다. "누가 어느 상담의 원문을 봤는가"라는 질문에는 1건으로 충분하다.
- 마스킹본 열람(대화 보기·이력)은 **계속 비감사**다(기존 결정 유지 — 마스킹본은 이미 VIEWER도 질문 순위로 본다).
- 강제 인수(`UPDATE`) 감사는 "누가 원문 열람 자격을 얻었는가"의 기록을 겸한다.

### 9.5 (e) 상담원 발신 메시지 — **마스킹 유지**(권고 유지)

- 저장·전달 모두 **출구 금지어 마스킹 → PII 마스킹**(`maskOutbound`와 같은 규칙의 평문 버전 `maskPlainText` → `maskPii`) 후 값이며, **전달 원천 = 저장본** 1벌이다.
- 근거: ① 원문 예외는 PM 결정의 범위("사용자 메시지 원문을 볼 수 있다")에 한정한다 ② 상담원 원문을 전달하려면 상담원 원문도 임시 보관해야 해(새로고침 복구·재조회) 원문 저장 대상이 두 배가 된다 ③ 위젯은 호스트 페이지(제3자 스크립트 공존) 안에서 렌더된다 — 외부로 나가는 PII를 최소화한다 ④ 출구 금지어 필터는 사람이 쓴 문장도 예외 없다(개발명세서 §5 보안). 운영 안내: "번호를 되읽지 말고 확인을 요청하세요". 콘솔 입력창의 **전송 전 미리보기**(⑧ `mask-preview`)가 가려질 부분을 보여 준다.
- 재검토 트리거: 상담원이 고객에게 PII를 **보내야** 하는 업무 요구(예: 가상계좌 안내) 확정 → 상담원 발신 원문 예외 ADR.

### 9.6 (f) 마스킹본 전용 화면

진행 중 목록의 마지막 발화 미리보기 · 비개입 세션 대화 보기 · 봇 구간 전부(`ConversationLog`) · 상담 이력 목록·상세 · 요약 · 응답힌트의 대상 문장(`source.text`) · 새로고침 복구 폴링의 USER 메시지 · 구버전 편승 전달 — 전부 마스킹본이다.

### 9.7 (g) 원문 누출 봉인

| 경로 | 봉인 |
|---|---|
| 로그 | 상담 모듈의 `logger.*` 인자에 `rawText`·`text`·`body`·`token`·`sessionId`·`.message` 식별자 0(§18 H-6) · Prisma 예외 메시지 미기록(§8.1) · `PollingLoop`에 넘기는 예외는 코드만 담은 새 Error |
| 오류 응답 | 상담 서비스는 입력 값을 오류 `details`에 되싣지 않는다(zod 파이프는 경로·메시지만) |
| 스냅샷 | `versions/**`에 `handoff`·`rawText` 심볼 0(§18 H-12) — 상담 테이블은 스냅샷 범위 밖 |
| CSV | 상담 CSV 없음(P-15) · 기존 CSV 경로 무변경 |
| 통계 | `stats/**`는 `ConversationLog`만 읽는다(마스킹본) · `handoff*` 참조 0 |
| 감사 | `AUDIT_FIELDS.HandoffSession`에 텍스트 필드 0(§16) |
| 힌트·임베딩 | 힌트 입력 = 마스킹본(원문이 ml-worker로 가지 않는다) |
| 공개 폴링 | 스키마에 `rawText` 키 없음(런타임 키 집합 단언 — §18 H-14) |
| 이력·요약 | `select`에 `rawText` 없음(§18 H-5) |
| 브라우저 | 콘솔 쿼리 캐시는 메모리 전용(영속 캐시·localStorage 금지) · `rawVisible=false` 수신 시 즉시 삭제 |

---

## 10. 모니터링 · 경고 판정 (FR-CS2-\* · P-3 · P-6)

### 10.1 `evaluateSessionAlert(rows, { caution, warning })` (순수)

```ts
// rows: 한 세션의 활성 창 내 로그(createdAt 오름차순) { isAnswered, blockedByFilter, surveyTurn, handoffTurn, apiNotice }
// ① blockedByFilter | surveyTurn | handoffTurn → 중립(세지도 끊지도 않음) · blocked는 blockedCount +1
// ② !isAnswered → consecutive +1 · windowUnanswered +1 · lastReason = apiNotice ? 'API_NOTICE' : 'FALLBACK'
// ③ 그 외 → consecutive = 0
// level = consecutive ≥ warning ? 'WARNING' : consecutive ≥ caution ? 'CAUTION' : 'NORMAL'
```
- `isAnswered` 재판정 금지(ADR-0019) — 적재된 값만 읽는다. RAG 턴은 백그라운드 완료 시 1행으로 들어오므로 최종 결과가 자연 반영된다(AC-CS2-5).
- **API 고정 문구 턴**: `isAnswered=false`라 ②로 센다(P-6) · 사유는 `apiNotice` 컬럼(신규 — 마이그레이션 이전 행은 `FALLBACK` 표시).

### 10.2 `sessionRef` · 별칭 (P-5)

- `computeSessionRef(chatbotId, sessionId) = sha256("cb-handoff-ref:v1:" + chatbotId + ":" + sessionId).hex.slice(0, 16)` — 챗봇마다 다른 값(교차 상관 불가), UUID v4 엔트로피로 역산 불가.
- 별칭 = 앞 6자, 같은 목록 안에서 충돌하면 해당 행만 8·10·…16자로 늘린다(`assignAliases`). 화면 표기 `#a3f9c1`.
- 역해석(`sessionRef → sessionId`): ① `HandoffSession(chatbotId, sessionRef)` 인덱스 조회 ② 없으면 활성 창 내 `ConversationLog`의 `distinct sessionId`를 읽어 해시 비교(창 내 세션 수에 비례 — 수백 건 · 수 ms) ③ 결과를 인스턴스 로컬 LRU(5,000건 · 30분)에 둔다(파생값 — 정합성 근거 아님). 창 밖이고 상담 이력도 없으면 `404`.

### 10.3 목록 쿼리 (쿼리 수 = 3 고정 — AC-CS2-8)

1. `conversationLog.findMany({ where: { chatbotId, createdAt ≥ now − window, sessionId ≠ null }, select: { id, sessionId, createdAt, channelType, isAnswered, blockedByFilter, surveyTurn, handoffTurn, apiNotice }, orderBy: { createdAt: 'desc' }, take: 20,000 })` — 기존 인덱스 `(chatbotId, createdAt)`. 상한 도달 시 `truncated: true`.
2. `handoffSession.findMany({ where: { chatbotId, OR: [{ status: 활성 }, { endedAt ≥ windowStart }] } })` — 활성 상담 세션은 창 밖이어도 목록에 포함.
3. (현재 페이지 행만) `conversationLog.findMany({ where: { id: { in: 마지막 사용자 턴 id ≤ 50 } }, select: { id, userMessage } })` — 100자 절단.
- 설정·챗봇 이름은 캐시. 활성 상담 중 만료된 것은 `endHandoff`(쓰기, 만료분만).
- 정렬: 경고 단계 desc → 마지막 활동 desc. 필터·페이지네이션(기본 50)은 메모리 조립(행 수가 창 크기로 상한).
- 보관·비공개 챗봇: 빈 목록 + `handoffEnabled` · 상태 안내(FR-CS2-1).

---

## 11. 대화 보기 (FR-CS3-\*)

`GET /chatbots/:chatbotId/live-sessions/:sessionRef/transcript?cursor&includeRaw`

1. 역해석(§10.2) → 세션의 상담들(`handoffSession.findMany({ chatbotId, sessionId, startedAt ≥ windowStart } ∪ 활성)`).
2. 봇 구간: `conversationLog.findMany({ chatbotId, sessionId, createdAt ≥ from, handoffTurn: false, (커서 이후) }, orderBy [createdAt, id], take 200)` — **신규 인덱스** 사용. `handoffTurn=true` 행은 스레드 USER 메시지와 중복이라 제외. 답한 노드·FAQ 이름은 번들 캐시에서(조회 0), RAG 여부는 `answeredByRag`.
3. 상담 구간: 해당 상담들의 메시지(커서 이후, 200). `rawText`는 **`canViewRaw()`가 참이고 해당 상담이 현재 활성이며 `rawExpiresAt > now`인 USER 행에만** 실린다.
4. 두 목록을 시각순 병합 → `nextCursor`(base64url JSON `{ l: [at, id], m: [at, id] }`).
5. `rawVisible` = 이번 요청이 원문 자격을 통과했는가. 원문이 1건 이상 실렸으면 `RAW_VIEW` 감사(§9.4).
6. `blockedDuringHandoff` = 활성 상담 `connectedAt` 이후 `blockedByFilter=true` 로그 수(EX-CS-6 — `count` 1회, 인덱스).
- 고지 문구(FR-CS3-5 갱신): "개인정보는 자동으로 가려진 상태로 표시됩니다(이름·주소는 가려지지 않을 수 있습니다). 상담 중 담당자에게는 사용자가 보낸 원문을 표시할 수 있으며, 상담이 끝나면 원문은 파기됩니다."
- 응답 헤더 `Cache-Control: no-store`.

---

## 12. 응답힌트 · 자주 쓰는 문장 (P-10 · P-11)

### 12.1 대상 · 계산 시점

- 대상 = 세션의 **마지막 사용자 발화의 마스킹본**(봇 구간 로그 또는 스레드 USER 텍스트 — 둘 중 늦은 것). `source.key` = 그 행 id.
- **발화당 1회 계산**: 인스턴스 로컬 LRU(`key → HintResponse`, 500건·30분). 콘솔은 `source.key`가 바뀔 때만 요청한다(AC-CS5-5). 적재 0.

### 12.2 가까운 답변 상위 3

- **의미 모드**: `answerSettingsCache.get()`의 `semanticEnabled` ∧ `SemanticMatchService.score(chatbotId, 마스킹본, bundle, thresholds)`가 값 반환 → `ranked` 상위부터 FAQ = 답변 텍스트 · 의도 = **그 의도를 인풋 조건으로 쓰는 사용 중 노드 중 우선순위 첫 노드의 첫 `TEXT` 아웃풋**(없으면 건너뛰고 다음 후보) — 3건.
  - 질의 임베딩 캐시는 **운영 LRU(`QueryEmbeddingService`)를 공유**한다 — 입력이 실제 사용자 발화(운영 질의와 같은 분포)라 오염이 아니며, 호출 빈도는 발화당 1회로 상한(ADR-0030의 격리 대상인 대량 TC와 다르다 — FR-CS7-3 확정).
- **저하 모드**(임베딩 꺼짐·장애·타임아웃·벡터 없음): `suggestIntents(normalizeText(마스킹본), 후보, { minScore: 0.1, max: 3 })` **함수 1벌 재사용** — 후보 = 의도 `{ name, examples }` ∪ FAQ `{ name: question, examples: altQuestions }`(입력만 넓힌다 · 함수 수정 0). 응답 `mode: 'LEXICAL'`("간이 추천" 배지). 오류가 아니라 저하다(AC-CS5-2).
- 외부 RAG·LLM·요약 호출 0(FR-CS7-8) — `handoff/**`에 `RagHttpClient`·`augmentation` import 0(§18 H-11).
- 힌트 텍스트는 관리자 작성 자산 원문이라 마스킹하지 않는다. 보낼 때 §9.5를 거친다.

### 12.3 자주 쓰는 문장

- 힌트 상위 3: 같은 `suggestIntents` 재사용 — 후보 `{ name: title, examples: [body, shortcut?] }`(enabled만) · 0점 제외.
- 관리 API(⑬~⑰ — `dialogue:read`/`dialogue:write`): 챗봇당 200(`409 LIMIT_EXCEEDED`) · 제목 정규화 유일·단축어 유일(`409 DUPLICATE_NAME` + `details[].field`) · 위/아래 이동(`sortOrder` 교환 — 트랜잭션 2행) · 삭제는 물리 삭제(대화 자산 편집 — 감사 `DELETE`).
- 콘솔 검색(⑪ — `cs:read`): enabled만 · `q`(제목·본문·단축어 부분 일치) · `category` · 정렬 `sortOrder` · 최대 200행(페이지네이션 없음).
- `{…}` 자리표시자 치환 없음(FR-CS8-5). **챗봇 복사는 문장·상담 설정을 복사하지 않는다** — 기존 챗봇 복사가 프로필만 복사하는 규약(`chatbots.service.ts` `copy()` — 대화 자산도 복사하지 않음)을 따른다(§26 D-8).

---

## 13. 상담 이력 · 요약 (P-15)

- 목록 ⑨: `handoffSession.findMany({ chatbotId, dayBucket ∈ [from, to], status?, assignedUserId?, endReason? }, orderBy startedAt desc, skip/take)` + `count`. 행: 별칭 · 시작/연결/종료 · 담당자 이름 · 종료 사유 · 사용자/상담원 메시지 수 · 첫 응답 초 · 개입 당시 경고 · `clientMode`.
- 요약 ⑩: 같은 필터의 시각 컬럼만 `findMany`(92일 상한 · `(chatbotId, dayBucket)` 인덱스) → `lib/handoff-summary.ts` 순수 조립: 첫 응답 = `max(0, firstAgentReplyAt − connectedAt)`(연결된 상담만) · 상담 시간 = `endedAt − connectedAt`(연결·종료된 것만) · 종료 사유 분포 · 표본 수. 5초 초과 `503 AGGREGATION_TIMEOUT`(기존 `runWithAggregationTimeout`). 상담원별 비교·순위·CSV 없음.
- 상세 ⑫: 상담 요약 + 병합 전문(봇 구간 = `startedAt − activeWindow` ~ `endedAt`, 상담 구간 전체 · 내부 `TAKEOVER` 이벤트 포함) — **마스킹본만**(활성 상담의 상세도 원문 없음 — 원문 출구는 §11 하나).
- `ARCHIVED` 챗봇: 이력·요약·상세 조회 허용, 개입·전송·종료 `409`.

---

## 14. 위젯 변경 명세 (P-13 · FR-CS9-\*)

### 14.1 파일

| 파일 | 변경 |
|---|---|
| `core/handoff-poll.ts` **신규** | 순수: `createHandoffPollState()` · `onSendResponse(state, handoff, now)`(관찰 창 시작·연장 · `IF_PENDING_FAILS` 보류 · CONNECTED 전환) · `onPendingResult(state, reason, now)` · `nextDelayMs(state, visibility)`(CONNECTED 3,000 / 관찰 5,000 / 숨김 15,000 · 서버 `pollAfterMs` 우선) · `onPollResponse(state, res)`(seq 중복 제거·커서 전진·종료 판정 → `STOP`) · 세대 카운터 · 네트워크 오류 30초 연속 판정 |
| `core/handoff-storage.ts` **신규** | `sessionStorage` 키 `cb.handoff.{slug}` = `{ token, cursor }` 읽기/쓰기/삭제(봉투 키와 분리 · 메모리 폴백은 `session.ts`와 같은 방식) |
| `core/store.ts` | `WidgetMessage.role`에 `'agent'` · `WidgetState.handoff?: { mode: 'WATCHING'｜'CONNECTED' }`(**선택 키 — `createInitialState()` 결과 불변**) · 액션 `HANDOFF_WATCH_STARTED`·`HANDOFF_CONNECTED`·`HANDOFF_MESSAGES`·`HANDOFF_ENDED`. 기존 7상태는 그대로(상담 모드는 상태와 **직교하는 필드** — 입력창을 잠그지 않는다) |
| `api/public-client.ts` | `sendMessage(payload, { handoffToken? })` — 본문에 `features: ['handoff-v1']` 항상 포함, 토큰은 헤더(기존 `Content-Type` 헤더를 덮어쓰지 않게 병합) · `pollHandoff({ sessionId, token?, after, restore? })` GET(헤더 2개) · 404 → `NOT_FOUND` |
| `ui/app.ts` | 전송 응답의 `handoff` 처리 · 상담 폴링 루프(보류 답변 폴링과 **독립 세대 카운터** — 서로 폐기하지 않음) · 메시지 렌더 · 종료 처리 · 로드 시 복구(§14.3) · `visibilitychange` |
| `ui/message-list.ts` | `agent` 역할 말풍선: **보이는 텍스트 라벨 "상담원"** + 전용 클래스(색 단독 구분 금지) · `textContent`만 · 기존 `role="log" aria-live="polite"` 상속 |
| `constants/messages.ts` · `constants/handoff.ts` | 문구("상담원" · "연결이 원활하지 않아요" · "이전 챗봇 대화는 다시 표시되지 않아요") · 헤더·기능 상수(shared-types와 동일성 시험) |

### 14.2 흐름

1. 전송 응답 `handoff.watch.trigger='NOW'` → 관찰 창(3분, 새 미응답마다 연장) · `'IF_PENDING_FAILS'` → 보류 폴링이 `FAILED`/`EXPIRED`/`TIMEOUT`으로 끝나면 창 시작.
2. 폴링 응답 `token` → 저장소 저장 → `HANDOFF_CONNECTED` · 상태 영역(`#cb-status`)에 "상담원이 연결되었어요" 1회 안내(서버 SYSTEM 문구) · 3초 폴링.
3. `AGENT` → `agent` 말풍선 · `SYSTEM` → 기존 `system` 역할 · `action` → 기존 `BUTTON` 렌더러에 `NODE` 버튼 1개(새 버튼 종류 0 — FR-CS9-6).
4. `ENDED` → 종료 안내·버튼 렌더 → 저장소 삭제 → 폴링 중단 · 상태 영역 1회 안내. 이후 전송은 봇으로 간다.
5. 상담 중 전송: 토큰 헤더 포함 · 응답 `outputs=[]`이면 봇 말풍선 없음(사용자 말풍선만) · `503` → 기존 재시도 UI.
6. 전송 응답 `handoff.status='ENDED'`(G-7) → **봇 출력을 그리기 전에** `pollHandoff` 1회로 종료 안내를 먼저 그린다.
7. 폴링 404 → 저장소 삭제 · 조용히 종료. 네트워크 오류는 같은 간격 재시도, 30초 연속 실패 시 상태 영역 "연결이 원활하지 않아요".

### 14.3 새로고침 복구 (FR-CS9-7 확정)

로드 시 저장소에 토큰이 있으면 `pollHandoff({ after: 0, restore: true })` 1회 → **상담 구간 메시지(USER는 마스킹본 · AGENT · 공개 SYSTEM)**를 다시 그리고 "이전 챗봇 대화는 다시 표시되지 않아요" 안내 1줄 → 폴링 재개. 사용자 자신의 발화도 복원한다(대화 맥락 — 단 마스킹본이라 자기 전화번호가 가려져 보일 수 있음, §25 K-8).

### 14.4 접근성 · 예산

- 폴링 갱신이 입력 포커스를 옮기지 않는다 · 연결/종료는 상태 영역 1회 · 상담원 말풍선은 "상담원" 텍스트로 시작해 읽힌다(NFR-CSA5).
- vanilla TS · 런타임 의존성 0 · **gzip 100KB 게이트 통과**, 증가분(예상 4~6KB)을 빌드 로그로 보고(FR-CS9-9).
- 폴링 상한: 상담 중 분당 20회 · 관찰 12회 · 숨김 4회(NFR-CSP6).

---

## 15. 권한 매트릭스 (P-7 — 역할 3 → 4 · 권한 15 → 17)

```ts
export const RoleName = z.enum(['ADMIN', 'EDITOR', 'VIEWER', 'AGENT']);   // 순서: 기존 3 뒤에 추가(기존 인덱스 불변)
ROLE_LABELS.AGENT = '상담원';
Permission += 'cs:read', 'cs:write';                                         // 15 → 17
ROLE_PERMISSIONS = {
  VIEWER: [… 불변 4종],
  EDITOR: [… 기존 9종, 'cs:read'],
  AGENT:  ['chatbot:read', 'cs:read', 'cs:write'],
  ADMIN:  [… 기존 15종, 'cs:read', 'cs:write'],
};
```

| 동작 | 권한(가드) | 서비스 재검증 | VIEWER | EDITOR | AGENT | ADMIN |
|---|---|---|---|---|---|---|
| 챗봇 선택기 ⑳ · 진행 중 목록 ① · 대화 보기(마스킹) ② · 힌트 ③ · 이력 ⑨⑩⑫ · 문장 검색 ⑪ | `cs:read` | — | 403 | ○ | ○ | ○ |
| 대화 보기 **원문** ②`includeRaw` | `cs:read` | `canViewRaw()` — `cs:write` ∧ (담당자 ∨ ADMIN) ∧ `CONNECTED` | — | ✕(마스킹) | 담당 시 ○ | ○ |
| 개입 ④ · 마스킹 미리보기 ⑧ | `cs:write` | — | 403 | 403 | ○ | ○ |
| 메시지 전송 ⑤ | `cs:write` | 담당자 본인(`403 HANDOFF_NOT_ASSIGNEE`) | 403 | 403 | 담당 시 ○ | 담당 시 ○ |
| 종료 ⑥ | `cs:write` | 담당자 ∨ ADMIN | 403 | 403 | 담당 시 ○ | ○ |
| 강제 인수 ⑦ | `cs:write` | 역할 = ADMIN | 403 | 403 | 403 | ○ |
| 자주 쓰는 문장 관리 목록 ⑬ | `dialogue:read` | — | ○ | ○ | 403 | ○ |
| 자주 쓰는 문장 생성·수정·삭제·이동 ⑭~⑰ | `dialogue:write` | — | 403 | ○ | 403 | ○ |
| 상담 설정 조회 ⑱ / 저장 ⑲ | `chatbot:read` / `chatbot:write` | — | ○/403 | ○/○ | ○/403 | ○/○ |

- `AGENT`는 `chatbot:read`로 챗봇 목록·통계·설문 결과·답변 설정 조회 등 **기존 `chatbot:read` 화면을 모두 조회**할 수 있다(P-7이 확정한 집합 — 마스킹본 등급. 대화 자산(`dialogue:read`) 화면은 볼 수 없다). 챗봇별 배정은 후속(전역 역할 — §24).
- 가드는 AND만 지원하므로(ADR-0015 No.25 갱신) 문장 목록은 **경로를 둘로 나눠** `dialogue:read`(관리 ⑬)·`cs:read`(콘솔 검색 ⑪)를 각각 건다(OR 가드 신설 0 — §26 D-10).
- `permission-matrix.spec.ts`의 "EDITOR ⊇ VIEWER"·"ADMIN = 전체"는 계속 성립한다. `AGENT ⊄ VIEWER`(`dialogue:read` 없음) — 계층형 역할이 아니다.
- 사용자 관리 화면·`GET /roles`는 `RoleName` 단일 소스라 코드 변경 0으로 `상담원`이 나타난다(표시 순서는 ui-designer).

---

## 16. 감사 (P-16 · §9.4)

| 대상 | 동작 | 기록 | summary | 화이트리스트 |
|---|---|---|---|---|
| `HandoffSession`(신규, 라벨 "상담") | 개입 | `CREATE` | `상담 개입 (#alias · 경고 단계)` | `AUDIT_FIELDS.HandoffSession = ['status','endReason','assignedUserName','alertLevelAtStart','alias']` — **`sessionId`·`sessionRef` 전체·토큰·텍스트 0** |
| 〃 | 상담원·관리자 종료 | `STATUS_CHANGE` | `상담 종료(상담원｜관리자)` | 〃 |
| 〃 | 강제 인수 | `UPDATE` | `강제 인수: {사유}` | before/after `assignedUserName` |
| 〃 | **원문 열람** | **`RAW_VIEW`(신규 액션)** | `상담 중 원문 열람(담당자｜관리자)` | 없음 |
| `CannedResponse`(신규, 라벨 "자주 쓰는 문장") | 생성·수정·삭제·이동 | `CREATE`·`UPDATE`(이동은 summary `순서 변경`)·`DELETE` | — | `['title','category','shortcut','enabled','sortOrder','bodyLength']` — **본문 제외**(FAQ 답변 제외 선례) |
| `Chatbot` | 상담 설정 저장 | `UPDATE` | `상담 연계 설정 변경`(답변 설정 경로와 같은 형식) | 사용 여부·임계값·분 값·버튼 라벨·노드 id · 안내 문구는 **길이만** |

- **감사하지 않는 것**: 시간 기반 종료(`USER_IDLE`·`AGENT_NO_REPLY`·`NOT_DELIVERED`·`CHANNEL_CLOSED` — 시스템 전이, 스레드 행에 `endReason`이 남는다) · 메시지 1건 1건(스레드 자체가 기록) · 마스킹본 열람 · 이력 조회 · 토큰 발급.
- `AuditAction` 13 → **14**(`RAW_VIEW` — `DESTRUCTIVE_AUDIT_ACTIONS` 아님) · `AuditTargetType` 17 → **19**.

---

## 17. API 계약

### 17.1 엔드포인트 (관리자 20 + 공개 1 = 신규 21개 · `@Public()` +1)

| # | 메서드 | 경로 | 권한 | 요청 → 응답 | 오류 |
|---|---|---|---|---|---|
| ① | GET | `/chatbots/:chatbotId/live-sessions` | `cs:read` | `LiveSessionListQuery` → `LiveSessionListResponse` | `404` |
| ② | GET | `…/live-sessions/:sessionRef/transcript` | `cs:read` | `TranscriptQuery` → `TranscriptResponse` | `404` |
| ③ | GET | `…/live-sessions/:sessionRef/hints` | `cs:read` | → `HintResponse` | `404` |
| ④ | POST | `…/live-sessions/:sessionRef/handoff` | `cs:write` | `{}` → `201 HandoffDetail` | `409 HANDOFF_ALREADY_ASSIGNED`·`HANDOFF_SESSION_NOT_LIVE`·`HANDOFF_DISABLED` · `404` |
| ⑤ | POST | `/chatbots/:chatbotId/handoffs/:handoffId/messages` | `cs:write` | `SendAgentMessage` → `201 SendAgentMessageResponse` | `403 HANDOFF_NOT_ASSIGNEE` · `409 HANDOFF_NOT_ACTIVE` · `503 HANDOFF_UNAVAILABLE` |
| ⑥ | POST | `…/handoffs/:handoffId/end` | `cs:write` | `{}` → `HandoffDetail` | `403` · `409 HANDOFF_NOT_ACTIVE` |
| ⑦ | POST | `…/handoffs/:handoffId/takeover` | `cs:write`(+ADMIN) | `TakeoverHandoff` → `HandoffDetail` | `403` · `409 HANDOFF_NOT_ACTIVE` |
| ⑧ | POST | `…/handoffs/mask-preview` | `cs:write` | `MaskPreviewRequest` → `MaskPreviewResponse`(저장·로그 0) | `400` |
| ⑨ | GET | `…/handoffs` | `cs:read` | `HandoffHistoryQuery` → `Paginated<HandoffHistoryItem>` | `400`(92일 초과 `STATS_RANGE_TOO_WIDE`) |
| ⑩ | GET | `…/handoffs/summary` | `cs:read` | 같은 쿼리 → `HandoffSummaryResponse` | `400` · `503 AGGREGATION_TIMEOUT` |
| ⑪ | GET | `…/handoffs/canned-responses` | `cs:read` | `?q&category` → `{ items: CannedResponse[] }`(enabled만) | — |
| ⑫ | GET | `…/handoffs/:handoffId` | `cs:read` | → `HandoffHistoryDetailResponse`(마스킹본) | `404` |
| ⑬ | GET | `/chatbots/:chatbotId/canned-responses` | `dialogue:read` | `CannedResponseListQuery` → `{ items }`(≤200) | — |
| ⑭ | POST | `…/canned-responses` | `dialogue:write` | `CreateCannedResponse` → `201` | `409 LIMIT_EXCEEDED`·`DUPLICATE_NAME` · `409 CHATBOT_ARCHIVED` |
| ⑮ | PATCH | `…/canned-responses/:cannedId` | `dialogue:write` | `UpdateCannedResponse` → `CannedResponse` | 위 + `404` |
| ⑯ | DELETE | `…/canned-responses/:cannedId` | `dialogue:write` | → `204` | `404` |
| ⑰ | POST | `…/canned-responses/:cannedId/move` | `dialogue:write` | `MoveCannedResponse` → `{ items }` | `404` |
| ⑱ | GET | `/chatbots/:chatbotId/handoff-settings` | `chatbot:read` | → `HandoffSettings`(행 없으면 기본값) | — |
| ⑲ | PUT | `…/handoff-settings` | `chatbot:write` | `UpdateHandoffSettings` → `HandoffSettings` | `400 VALIDATION_FAILED` · `404 INVALID_REFERENCE`(버튼 노드) · `409 CHATBOT_ARCHIVED` |
| ⑳ | GET | `/handoff-console/chatbots` | `cs:read` | → `{ items: HandoffConsoleChatbotItem[], myActiveCount }` | — |
| ㉑ | GET | `/public/chatbots/:slug/handoff` | **`@Public()`** | §7.1 | §7.1 |

- **선언 순서**: `HandoffsController`는 정적 세그먼트 `summary`·`canned-responses`·`mask-preview`를 **`:handoffId`보다 먼저** 선언한다.
- 모든 관리자 경로에 **`sessionId`가 없다**(경로·쿼리·본문·응답 — §18 H-17). `handoffId`는 내부 UUID이며 관리자 경로에만 쓴다(공개 응답 0).
- ⑲ 저장 시 `enabled: true → false`이고 활성 상담이 있으면 `draining=true`를 함께 저장한다. 캐시 무효화 후 감사.

### 17.2 확장(기존 경로)

`POST /public/chatbots/:slug/messages` — 요청 `features?`·헤더 `x-cb-handoff-token`(선택), 응답 `handoff?`(상담 켜진 챗봇의 미응답·보류·상담 턴에만) · `GET /public/chatbots/:slug/messages/:messageId` — **레이트리밋 버킷만 변경**(K-1) · `GET /roles` — 4행 · `POST /chatbots/:chatbotId/permanent-delete` — 사전검사 13종 · 노드 삭제 — 종료 후 버튼 참조 `409 NODE_IN_USE`.

### 17.3 오류 코드 (`ApiErrorCode` 신규 7종)

| 코드 | 상태 | 쓰임 |
|---|---|---|
| `HANDOFF_ALREADY_ASSIGNED` | 409 | 같은 세션에 활성 상담 존재(담당자 이름을 `message`에) |
| `HANDOFF_NOT_ACTIVE` | 409 | 종료된 상담에 전송·종료·인수 |
| `HANDOFF_SESSION_NOT_LIVE` | 409 | 활성 창 밖 · WEB 외 채널 · 챗봇 비공개/보관/WEB 닫힘 |
| `HANDOFF_NOT_FOUND` | 404 | 공개 폴링의 토큰 무효·교차·유예 경과 |
| `HANDOFF_DISABLED` | 409 | 상담 꺼진 챗봇에 개입 |
| **`HANDOFF_NOT_ASSIGNEE`**(요구사항 대비 추가) | 403 | 담당자가 아닌 전송·종료(ADMIN 제외)·ADMIN 아닌 인수 |
| **`HANDOFF_UNAVAILABLE`**(요구사항 대비 추가) | 503 | 상담 구간 사용자 메시지·상담원 메시지 적재 실패(재시도 가능 — FR-CS4-4) |

재사용: `LIMIT_EXCEEDED`·`DUPLICATE_NAME`(문장) · `INVALID_REFERENCE`(버튼 노드) · `NODE_IN_USE`(노드 삭제) · `STATS_RANGE_TOO_WIDE`·`AGGREGATION_TIMEOUT`(이력) · `CHATBOT_ARCHIVED` · `RATE_LIMITED`. **대화 경로 오류는 `HANDOFF_UNAVAILABLE`(503) 1종뿐**이다 — 나머지 상담 사정은 중립 안내·봇 경로로 수렴한다.

---

## 18. 봉인 · 정적 검사 — `apps/api/src/handoff/lib/handoff-sealing.spec.ts`

검사 대상: `apps/api/src/**/*.ts`(`*.spec.ts`·`src/integration/**` 제외, 주석 제거) + `packages/dialogue-engine/src/**` + `schema.prisma` + (런타임) shared-types 스키마. 탐지어는 조각 조립(검사기 자신이 문자열을 포함하지 않게). **역검증 픽스처 포함**.

| # | 단언 | 막는 것 |
|---|---|---|
| H-1 | `handoffSession`·`handoffMessage`의 `delete｜deleteMany` 0건 · 원시 `DELETE FROM "handoff_sessions｜handoff_messages"` 0건 | 상담 기록 삭제(P-12) |
| H-2 | 두 모델의 `create｜createMany｜update｜updateMany｜upsert` 호출 파일 = `handoff/handoff-thread.service.ts` **1개** | 쓰기 주체 확산 |
| H-3 | 그 파일 안 `handoffMessage.update｜updateMany` 호출의 `data` 키 ⊆ `{rawText, rawExpiresAt}`이고 값은 `null` · `rawText:`에 null 아닌 값을 쓰는 곳은 `appendUserMessage` 블록 1곳 | 메시지 변조 · 원문 재기록(append-only) |
| H-4 | `schema.prisma`: 신규 4모델 `onDelete: Restrict`만 · `HandoffSession`에 `token`/`tokenRaw` 류 필드 0(`tokenHash`만) · `HandoffMessage` 필드 = §3.1 허용 목록 정확히 · `rawText`에 `@@index` 0 | 토큰 원문·원문 인덱스 |
| H-5 | `rawText` 식별자 등장 파일 ⊆ {`handoff/handoff-thread.service.ts`, `handoff/handoff-transcript.service.ts`, `handoff/lib/raw-visibility.ts`, `handoff/handoff.mapper.ts`} · `handoff-history.service.ts`·`handoff-public-poll.service.ts`·`handoff-hints.service.ts`·`stats/**`·`versions/**`·`audit-logs/**` = 0 | 원문 출구 확산(P-9 (c)(g)) |
| H-6 | `handoff/**`·`canned-responses/**`의 `logger.(log｜warn｜error｜debug)(` 인자에 `rawText｜text｜body｜token｜sessionId｜\.message` 0(휴리스틱) | 원문·토큰 로그 — 최종 보증은 §22 누출 grep 시험 |
| H-7 | `endHandoff`·`purgeExpiredRaw` 블록에 `enableSecureDelete(`와 `rawText: null`이 모두 있음 · `$queryRaw` 보유 파일 중 handoff는 `handoff-secure-delete.query.ts` 1개 | 파기 누락·원시 SQL 확산 |
| H-8 | `chatbots.service.ts` 사전검사 `counts`에 `handoffSessions`·`cannedResponses` 존재 · 동반 삭제 트랜잭션에 `handoffSession｜handoffMessage｜cannedResponse` 삭제 0(`chatbotHandoffSetting.deleteMany`만 허용) | 영구삭제로 기록 소실 |
| H-9 | `packages/dialogue-engine/src`에 `handoff`·`cannedResponse`·`HandoffGate` 심볼 0 | 엔진 수정(FR-0-118) |
| H-10 | `@Public()` 총 7(컨트롤러 전수) · 7번째 = `PublicConversationController#pollHandoff` | 공개 표면 |
| H-11 | `handoff/**`·`canned-responses/**`에 `fetch(`·`axios`·`http.request`·`WebSocket`·`EventSource`·`@Sse`·`socket.io`·`RagHttpClient`·`augmentation` 0 | 외부 송신·실시간 채널·생성형 힌트 |
| H-12 | `simulation/**`·`validation/**`·`versions/**`·`deploy-schedules/**`·`stats/**`·`learning/**`에 `handoff/`·`canned-responses/` import 0 | DI 격리(FR-0-123) |
| H-13 | `appendUserMessage`·`appendAgentMessage` 블록에 `maskPlainText(`가 `maskPii(`보다 먼저 · 다른 파일에서 `handoffMessage` 쓰기의 `text:` 0 | 마스킹 누락·순서 역전 |
| H-14 | (런타임) `HandoffPollMessageSchema` 키 = `{seq,sender,text,sentAt,action}` · `HandoffPollResponseSchema` 키 = `{status,token,messages,cursor,pollAfterMs}` · `PublicHandoffStateSchema` 키 = `{status,token,pollAfterMs,watch}` | 공개 응답에 원문·내부 id·신원 |
| H-15 | `AUDIT_FIELDS.HandoffSession`·`CannedResponse`에 `text｜body｜rawText｜sessionId｜sessionRef｜token` 0 | 감사로그 원문 |
| H-16 | `CONVERSATION_STATE_VERSION === 1` · `ConversationStateSchema` 키 집합 5키 불변(L-12와 같은 단언을 상담 관점에서 재확인) | 봉투에 상담 상태 유입(ADR-0009 §3) |
| H-17 | (런타임) `LiveSessionRowSchema`·`TranscriptResponseSchema`·`HandoffDetailSchema`·`HandoffHistoryItemSchema`·`HandoffBriefSchema`에 `sessionId` 키 0 | 전체 `sessionId` 노출(P-5) |

기존 검사 갱신은 §22.2 닫힌 목록을 따른다.

---

## 19. 성능 예산 (NFR-CSP)

| 대상 | 목표 · 내역 |
|---|---|
| 상담 꺼진 챗봇 공개 대화 | **P95 500ms 불변** · 캐시 적중 시 추가 조회 0(설정 캐시 미스 = PK 1회/30초/인스턴스) · 응답 바이트 동일(NFR-CSP1) |
| 상담 켜진 챗봇 · 상담 없는 턴 | 기존 + **5ms**(최신 상담 1건 인덱스 조회) · 미응답 턴의 `handoff` 필드 수십 바이트 |
| 상담 구간 턴(G-4/G-5) | **P95 100ms**(엔진 미호출 · 마스킹 · 쓰기 트랜잭션 1 await) |
| 공개 상담 폴링 | **P95 50ms**(쿼리 6 · 쓰기 0이 일반) · 동시 상담 50 + 관찰 200세션에서 다른 공개 API P95 증가 20% 미만(NFR-CSP3) |
| 진행 중 목록 | **P95 300ms**(창 10분 · 로그 5,000행 · 쿼리 3 고정) · 상한 20,000행 |
| 대화 전문 증분 | **P95 150ms**(신규 인덱스 · 200행 페이지) · 원문 감사 조회 +1(최초만) |
| 힌트 | 의미 **P95 1초**(임베딩 ≤300ms 포함) · 저하 100ms · 같은 발화 재요청 0ms(메모) |
| 이력 목록 300ms · 요약 1초(92일) · 5초 초과 `503` | |
| 정리 루프 tick | 활성 상담 500건 기준 **50ms 이내**(인덱스 2 + 판정 순수 + CAS는 만료분만) · 유휴 tick = 쿼리 2(활성 목록·원문 만료) |
| 전달 지연 | 상담원 전송 → 위젯 표시 P95 ≤ 4초 · 개입 → 관찰 창 위젯 표시 P95 ≤ 6초(NFR-CSP5) |
| 위젯 | gzip 100KB 이내 · 폴링 분당 20/12/4회 상한(NFR-CSP6) |
| 마이그레이션 | 인덱스 생성 100만 행 소요·잠금 측정 보고(NFR-CSP7 — §3.2) |

---

## 20. 다른 기능과의 경계 (시뮬레이터·버전·예약·통계)

- **시뮬레이터·비교·TC(No.10/19/20)**: 영향 0 — 엔진 0 · 상담 서비스 미주입(H-12) · 시뮬레이터에 상담 모드 없음 · 시뮬레이터는 로그를 남기지 않으므로 목록에 나타나지 않는다(EX-CS-25).
- **버전(No.25)**: 상담 설정·자주 쓰는 문장·상담 스레드는 **스냅샷 밖**(`snapshot-envelope.ts`가 자산을 명시 나열 — 코드 변경 0). **상담 설정을 `ChatbotAnswerSetting`에 넣지 않은 이유가 이것**이다 — 답변 설정 행은 스냅샷에 포함되고 복원이 `DELETE`/`UPSERT`한다(§26 D-1). 복원이 종료 후 버튼 노드를 지우면 종료 시 버튼 없이 안내만(EX-CS-19) + 설정 화면 경고(버튼 노드 부재 표시 — 복원 경고 신설 0).
- **예약 배포(No.28)**: 액션 추가 0 · 복원·공개 실행이 진행 중 상담에 영향 없음(봇이 멈춰 있다) · 채널 닫기 예약 실행 후 다음 판정에서 `CHANNEL_CLOSED`.
- **통계(No.2/14/29)**: 질문 순위 5곳이 같은 상수로 `handoffTurn` 제외 · 턴·세션·응답률 포함 · 응답 출처 `OTHER` 불변(조립 함수 수정 0) · 기존 행 전부 false라 과거 수치 불변.
- **미응답 큐(No.15)**: 봇 구간 미응답은 그대로 수집 · 상담 구간은 `HANDOFF_TURN` 제외.
- **설문(No.27)**: 설문 턴 중립 · 개입 시 봉투 정리로 진행 중 설문은 조회 시점 이탈 · 종료 후 버튼으로 설문 노드 연결 가능(엔진·설문 변경 0).
- **외부 RAG(No.30)**: 상담 중 호출 0 · 보류 턴 실패 시 관찰 창(`IF_PENDING_FAILS`) · 늦게 도착한 보류 답변은 기존 폴링대로 표시(EX-CS-20).

---

## 21. 관리자 콘솔 (ui-designer / frontend-implementer 인계)

- **`모니터링` 독립 메뉴**(`cs:read` 보유 시 노출): ① 챗봇 선택기(⑳ — 상담 켜진 챗봇 우선 · `내 상담 n건`) ② 진행 중 목록(표 · 경고 단계 **색 + 텍스트 + 아이콘** · 5초 갱신이 포커스·스크롤 보존 · 새 경고 `aria-live="polite"` 1회 · 숨김 탭 30초 · 30초 연속 실패 배너) ③ 대화 보기(2초 증분 · 봇/상담 구간 시각 구분 · 답한 노드 배지 · 미응답 배지 · 고지 문구 · **`원문 보기` 토글 — 담당자·ADMIN·상담 중에만 활성, "열람은 기록됩니다" 안내, 원문 항목에 `원문` 텍스트 배지** · `rawVisible=false` 수신 시 캐시 원문 즉시 삭제) ④ 힌트 패널(가까운 답변 3 · 자주 쓰는 문장 3 · 검색 · `간이 추천` 배지 · `복사`(클립보드 실패 시 텍스트 선택 폴백 + "복사했어요" 안내) · `입력창에 넣기`(개입 후 담당자만, 즉시 전송 금지)) ⑤ 개입/전송/종료/강제 인수(확인 대화상자 포커스 트랩 · 비활성 버튼 사유 텍스트 · 전송 전 마스킹 미리보기 ⑧ 디바운스 300ms · 미확인 연결 시도 n회 · 구버전 위젯 배지 · "사용자가 다음에 말할 때 연결됩니다" 안내(관찰 창 밖 개입)) ⑥ 상담 이력·요약(표본 수 병기 · 종료 사유 필터).
- **챗봇 상세**: `상담 연계` 설정(⑱⑲ — 임계값·분 값 수치 입력 · 안내 문구 3종 · 종료 후 버튼(노드 선택기) · 부재 노드 경고) · `자주 쓰는 문장` 관리(⑬~⑰ — 위/아래 버튼).
- **사용자 관리**: 역할 `상담원` 선택지·배지(텍스트 병기).
- 콘솔의 쿼리 캐시는 **메모리 전용**(원문이 브라우저 저장소에 남지 않게).
- ⚠ ROCHA 매뉴얼 p.66~70 직접 확인(색상 단계·힌트 위치·문장 소유 단위)은 ui-designer 인계 그대로.

---

## 22. 시험 설계 포인트 (test-automation 인계)

### 22.1 층별 핵심

| 층 | 대상 | 핵심 |
|---|---|---|
| 순수(api lib) | `session-alert` | ★ AC-CS2-1~5 시퀀스 표(시험데이터 고정 — BLOCK·설문·상담 중립, API 고정 문구 산입, 사유) |
| 순수 | `handoff-expiry` | 우선순위 4종 · 경계값(9:59/10:00) · 양쪽 침묵 기준 |
| 순수 | `handoff-auth` · `envelope-clear` · `raw-visibility` · `session-ref`(별칭 충돌 확장) · `handoff-summary` · `transcript-cursor` | 판정표 G-0~G-9 전 행 · 봉투 멱등·유효 스키마 유지 · 원문 권한 표(§9.3) 전 행 |
| 위젯 순수 | `core/handoff-poll.ts` | 창 시작·연장·만료 · `IF_PENDING_FAILS` · seq 중복 제거 · 숨김 간격 · 세대 폐기 · 30초 오류 판정 |
| 통합 | 공개 경로 | ★ **상담 꺼진 챗봇 바이트 동일·조회 수 동일(캐시 적중 상태)**(AC-CS1-1) · ★ 엔진 미호출·봉투 정리(AC-CS3-2 — 엔진 스파이) · ★ 토큰 1회(AC-CS4-2 — 동시 폴링 2건 경합) · 교차 슬러그 404 · 커서 멱등 · 구버전 편승(AC-CS4-7) · 관찰 창 밖 다음 발화 전달(AC-CS4-8) · 스레드 쓰기 실패 주입 → 503(AC-CS3-5) · NODE 버튼 라벨 전달(AC-CS3-6) · 미확인 발화 카운트(AC-CS3-3) |
| 통합 | 레이트리밋 | ★ 같은 IP 10세션 3초 폴링 1분 + 같은 IP 일반 전송 → 429 0건(AC-CS4-5) · **K-1: 같은 IP 보류 대기 4명 1.5초 폴링 + 전송 → 429 0건** |
| 통합 | 동시성 | ★ 동시 개입 2건(두 앱 인스턴스 — `scheduled-deploy-multi-instance` 하네스 재사용) → 1성공·1 `409`·활성 1행(AC-CS3-1) · 동시 시간 종료 판정 1회(AC-CS6-4) |
| 통합 | ★ 원문(P-9) | §22.3 |
| 통합 | 힌트·문장 | ★ FAQ 1위(AC-CS5-1) · 임베딩 중단 저하(AC-CS5-2) · 발화당 1회(AC-CS5-5 — `SemanticMatchService` 호출 횟수) · 201번째·중복·권한(AC-CS5-6) |
| 통합 | 권한·감사·봉인 | 역할별 매트릭스(AC-CS7-1 + §15 표) · 감사 본문 0(AC-CS7-2) · `handoff-sealing.spec.ts` H-1~H-17(AC-CS7-3) · 시뮬레이터·TC 후 상담 테이블 0행(AC-CS7-4) |
| 통합 | 종료·이력 | 사용자 무응답 11분(FakeClock) · 상담원 무응답 5분 → 실패 안내·봇 복귀 · 종료 후 버튼 → 설문 시작(AC-CS6-3) · 이력 요약 고정 픽스처(AC-CS6-6) · 질문 순위·미응답 큐 제외(AC-CS6-7) · 영구삭제 409 `상담`(AC-CS6-8) |
| E2E/접근성 | 콘솔·위젯 | 키보드만 경고 세션 → 넣기 → 개입 → 전송 → 종료(AC-CS7-6) · axe 대비 0(AC-CS7-5) · 번들 게이트(AC-CS7-7) |

### 22.2 ★ 의도된 기존 시험 기대값 변경 (닫힌 목록 — FR-0-126 확정)

| # | 파일 | 변경 | 근거 |
|---|---|---|---|
| E-1 | `apps/api/src/common/auth/public-decorator-count.spec.ts` | `@Public()` **6 → 7** — 주석·`it` 제목("정확히 7곳")·개별 단언에 `PublicConversationController#pollHandoff` 추가·전수 목록 기대값에 `'PublicConversationController#pollHandoff'` 추가 · 전수 스캔 컨트롤러 목록에 신규 5개(`LiveSessionsController`·`HandoffsController`·`HandoffSettingsController`·`HandoffConsoleController`·`CannedResponsesController`) import 추가와 제목의 컨트롤러 수 갱신 | P-2 · ADR-0036 §2 |
| E-2 | `apps/api/src/versions/lib/version-sealing.spec.ts` V-8 | `describe`·`it` 제목과 `expect(total).toBe(6)` → **7** | 〃 |
| E-3 | `apps/api/src/validation/lib/validation-sealing.spec.ts` 7) | 제목("정확히 6개 … 변동 없음") → "정확히 7개(No.24 상담 폴링 — 이 그룹은 추가하지 않는다)" · `toBe(6)` → **7** | 〃 |
| E-4 | `apps/api/src/deploy-schedules/lib/deploy-schedule-sealing.spec.ts` D-5 | `describe`("총수 6")·`it`("6개다") 제목과 `toBe(6)` → **7** | 〃 |
| E-5 | `apps/api/src/common/auth/lib/permission-matrix.spec.ts` | `Permission.options` 길이 **15 → 17** · `arrayContaining`에 `'cs:read'`·`'cs:write'` 추가 · 제목의 "15종" → "17종(No.24 `cs:*` 신설)" · ADMIN 테스트 제목의 "15종" → "17종" | P-7 |
| E-6 | `apps/api/src/stats/lib/stats-retention-sealing.spec.ts` R-7 | `$queryRaw` 보유 파일 **3 → 4** — `expected`에 `'handoff/handoff-secure-delete.query.ts'` 추가 · `toBe(3)` → **4** · 제목 갱신 | P-9 (b) · §9.2 |
| E-7 | `apps/api/src/conversation/public-conversation.service.spec.ts` | `new PublicConversationService(…)`에 15번째 인자 `{} as HandoffGateService` 추가(No.27 `SurveyResponseService` 추가 선례) — **단언 변경 0** | §2.5 |

- **추가 단언(기존 기대값 변경 아님)**: `validation-sealing.spec.ts` 금지 import 목록에 `handoff/`·`canned-responses/` 추가 · `survey-sealing.spec.ts`는 무변경.
- **전수 확인 결과 변경 불필요**: `nlu-rag-answering.integration.spec.ts`의 `describe` 제목 "(@Public 6번째)"는 단언이 아니다 · 통합 시험 파일에 `@Public` 개수 간접 단언 0건 · `RoleName`/`AuditAction`/`AuditTargetType`/`ApiErrorCode` 개수 단언 0건 · 위젯 `app.spec.ts`·`app.pending.spec.ts`는 요청 본문 특정 필드만 읽어 `features` 추가에 무영향 · `store.spec.ts`는 `createInitialState()` 불변(`handoff?` 선택 키) · `legacy-api-sealing.spec.ts` L-12(봉투 5키) 불변.
- **그 밖의 기존 시험이 깨지면 회귀**로 취급한다.

### 22.3 ★ 원문(P-9) 시험

| # | 시나리오 | 기대 |
|---|---|---|
| R-1 | 담당 AGENT가 `includeRaw=true`로 대화 보기 · 사용자 "제 번호 010-1234-5678" | 해당 항목 `text`=`010-****-5678` · `rawText`=원문 · `rawVisible=true` · `RAW_VIEW` 감사 1건 |
| R-2 | 같은 요청 10회 반복 | `RAW_VIEW` 1건 유지 |
| R-3 | 비담당 AGENT · EDITOR · `includeRaw` 없는 담당자 | `rawText` 키 없음 · 감사 0 |
| R-4 | 비담당 ADMIN | 원문 ○ · 감사 1건(관리자) |
| R-5 | ★ 상담원 종료 직후 | 같은 트랜잭션에서 `rawText` 전부 NULL(DB 직접 조회) · 대화 보기 `rawVisible=false` |
| R-6 | ★ 사용자 무응답 11분 · **콘솔·위젯 요청 0** · 정리 루프 `runOnce()` | 상태 `ENDED(USER_IDLE)` · 원문 NULL(조회 없이도 파기) |
| R-7 | 상담 60분 초과 메시지 | 읽기 즉시 원문 비노출 · `runOnce()` 후 NULL |
| R-8 | 강제 인수 | 이전 담당자 다음 조회 `rawVisible=false` |
| R-9 | ★ 누출 grep — 고유 표식 `CS-RAW-7f2b` + `010-1234-5678`을 상담 중 전송 → 종료 → 루프 | 서버 로그·감사로그·오류 응답·`ConversationLog`·이력 API·폴링 응답·힌트 응답 전수에서 원문 0 · **SQLite DB 파일 바이트에서 원문 문자열 0**(체크포인트 후 — `secure_delete` 검증) |
| R-10 | 공개 폴링 `restore=true` | USER 메시지 `text`=마스킹본 · `rawText` 키 없음 |
| R-11 | 상담원이 "010-1234-5678로 연락드릴게요" 전송 | 저장·전달·콘솔 모두 마스킹본(원문 없음) · 미리보기 ⑧가 같은 결과 |
| R-12 | PII 없는 발화 | `rawText=null`(저장 안 함) |

---

## 23. 요구사항 추적표

| 요구사항 | 설계 위치 |
|---|---|
| T-1 · J-4 · P-4 · FR-0-118 · AC-CS1-2 | §2.3 · §5 · ADR-0036 §1 |
| T-2 · J-2 · P-2 · FR-CS6-\* · AC-CS4-\* | §5.5~§5.6 · §7 · §14 |
| T-3 · J-3 · P-3 · FR-CS2-\* · AC-CS2-6~8 | §10 |
| T-4 · J-13 · P-13 · FR-CS9-\* · AC-CS7-7 | §14 |
| T-5 · T-8 · J-10 · P-10 · FR-CS7-\* · AC-CS5-1~2/5 | §12 |
| T-6 · J-15 · P-14 · FR-CS5-\* · FR-CS4-8/9 · AC-CS6-3~5 | §8.4 · §8.6 · §20 |
| T-7 · T-9 | §24 |
| T-10 | §11(답한 노드) |
| T-11 · J-6 · P-6 · FR-CS2-3/4 · AC-CS2-1~5 | §10.1 · §22.1 |
| J-1 · P-1 · FR-CS1-5 | §8.2 · §24 |
| J-5 · P-5 · FR-CS3-2 · NFR-CSS1~3 · AC-CS2-7 · AC-CS4-2/3/6/9 | §6 · §10.2 · §18 H-14/H-17 |
| J-7 · P-7 · FR-0-124 · AC-CS7-1 | §15 |
| J-8 · P-8 · FR-CS4-1/10 · AC-CS3-1/7/8 | §8.2 · §8.5 |
| **J-9 · P-9 · FR-0-122 · FR-CS3-5/7 · NFR-CSS4 · AC-CS6-1/2 · AC-CS8-\*(신규)** | **§9 · §22.3** |
| J-11 · P-11 · FR-CS8-\* · AC-CS5-3/4/6 | §12.3 · §21 |
| J-12 · P-12 · FR-0-121 · FR-CS11-\* · AC-CS6-7/8 · AC-CS7-3 | §3.1 · §5.7 · §18 |
| J-14 · FR-0-120 · FR-CS6-5 · AC-CS4-5 · P-18 | §7 · §2.6 |
| J-16 · FR-CS4-7 · AC-CS3-4 | §5.4 |
| J-17 · P-16 · AC-CS7-2 | §16 · §9.4 |
| J-18 · P-15 · FR-CS10-\* · AC-CS6-6 | §13 |
| J-19 · FR-0-123 · AC-CS7-4 | §2.2 · §20 |
| J-20 · P-17 | §27 |
| FR-0-119 · AC-CS1-1 | §5.1 · §22.1 |
| FR-0-125 | §17.3 |
| FR-0-126 | §22.2 |
| FR-0-127 | §14.1 문구 · §5.3 G-6 |
| FR-0-128 | §3.4 |
| FR-CS1-1~4 · AC-CS1-3/4 | §3.1 · §17.1 ⑲ · §5.1(draining) |
| FR-CS3-1~6 | §11 · §3.2 |
| FR-CS4-2~6 · AC-CS3-2/3/5/6 | §5.3 · §5.7 |
| NFR-CSP1~7 | §19 |
| NFR-CSA1~6 · AC-CS7-5/6 | §14.4 · §21 |
| NFR-CSM1~3 | §2.1 lib · §14.1 · §8.6 |
| EX-CS-1~3 · 26 | §5.5 · §5.6 · §8.4 |
| EX-CS-4 · 12 · 13 · 15 · 16 | §6 · §14.3 · §8 |
| EX-CS-5~11 | §5.3 · §9.5 · §12 |
| EX-CS-14 · 17~25 · 27 · 28 | §14.2 · §20 · §8.4 · §10.1 |
| EX-CS-29~33(신규) | §9.3 · §25 K-3/K-5/K-7/K-9 |

---

## 24. 범위 밖 (재검토 트리거는 요구사항 §9 · ADR-0036 재검토 트리거)

사용자 요청형 상담 연결·대기열·근무시간·부재 안내·온라인 상태(P-1) · SSE/WebSocket/롱폴 · 외부 RAG 힌트·LLM 답변 제안·상담 요약 · 개인 자주 쓰는 문장·자리표시자 치환 · 상담원 간 인계·동시 담당 상한·자동 배정 · 챗봇별 상담원 배정 · 상담원 성과 비교·CSV · 옴니채널 통합 인박스(No.42) · 상담원 리치 메시지·파일·음성 · 봇 구간 이력 복원 · 소리·데스크톱 알림 · 입력 중 표시·읽음 확인 · "상담원 응대" 응답 출처 · 상담원 평가 지표·세션당 설문 다회 · 대화 흐름·입력 유형 통계 · 여러 챗봇 동시 모니터링 · **상담원 발신 원문 예외**(§9.5) · **원문 열람 권한 위임·원문 보존 연장·원문 내보내기** · 상담 설정·문장 버전 스냅샷·복원 경고.

---

## 25. 알려진 제한

| # | 제한 | 수용 근거 · 완화 |
|---|---|---|
| K-1 | "진행 중"은 최근 활동 근사(연결 종료 신호 없음) | P-3 · 창 설정 5~60분 |
| K-2 | 관찰 창 밖 세션의 개입은 다음 발화까지 지연 | 콘솔 안내 · EX-CS-3 |
| K-3 | 다중 인스턴스에서 상담을 **켠 직후 30초** 동안 다른 인스턴스는 설정 캐시가 낡아 첫 접촉(POST)을 놓칠 수 있다 — 관찰 창 폴링은 설정과 무관하게 조회하므로 전달되고, 토큰 보유 발화는 설정과 무관하게 조회된다 | 캐시 TTL 30초(답변 설정과 같은 수용) |
| K-4 | LEGACY 상담은 `sessionId`만으로 송수신(토큰 없음) | 구버전 격하의 본질 · 콘솔 배지 · 재검토 트리거(LEGACY > 5%) |
| K-5 | 60분을 넘긴 초기 발화는 상담 중에도 마스킹본으로 돌아간다 | 원문 절대 상한(P-9 최소 보관) |
| K-6 | SQLite 저널·백업·파일시스템 수준의 물리 잔존은 애플리케이션이 보증하지 않는다(`secure_delete`는 DB 파일 페이지만) | 디스크 암호화·백업 보존 정책 = 운영/No.45 · Postgres 전환 시 VACUUM 정책 필요 |
| K-7 | 서버 정지 중에는 원문 파기가 지연된다(기동 즉시 처리) | DB가 원천 · 정리 루프 기동 시 1회 |
| K-8 | 새로고침 복구 시 사용자 자신의 발화도 마스킹본으로 보인다 | 원문은 공개 표면으로 나가지 않는다(P-9 (g)) |
| K-9 | API 롤백 시 구버전은 원문을 정리하지 못한다 | 롤백 절차에 `rawText` NULL 1회 실행 포함(§3.5) |
| K-10 | `RAW_VIEW` 감사는 다중 인스턴스 동시 요청에서 인스턴스 수만큼 중복될 수 있다 | 누락보다 중복이 안전 |
| K-11 | 탭 복제 시 두 탭이 같은 토큰으로 송수신(EX-CS-12) | 콘솔은 한 사용자로 본다 · 폴링 키 버킷 40/분이 2탭 허용 |
| K-12 | 이름·주소는 마스킹되지 않는다(ADR-0013 §6) — 영구 저장본에도 남는다 | 고지 · No.45 |
| K-13 | 로그 적재 순서 역전(RAG 늦은 적재)으로 연속 수가 일시적으로 달라질 수 있다(EX-CS-28) | 고지 |
| K-14 | 마이그레이션 이전의 API 고정 문구 턴은 사유 "답변 못함"으로 표시된다 | `apiNotice` 백필 불가(파라미터였음) |

---

## 26. 요구사항 대비 해석 (architect 판단)

| # | 요구사항 | 해석·변경 | 근거 |
|---|---|---|---|
| D-1 | FR-CS1-1 "답변 설정 캐시 동거 권고" | **신규 1:1 `ChatbotHandoffSetting` + 전용 캐시**. "꺼진 챗봇 추가 조회 0"은 **캐시 적중 기준**으로 정밀화(미스 시 PK 1회/30초) | `ChatbotAnswerSetting`은 스냅샷 대상이며 복원이 `DELETE`/`UPSERT`한다(`restore-plan.ts`) — 동거하면 복원이 상담을 끄거나 설정을 되돌린다. `Chatbot` 컬럼 동거는 챗봇 DTO·복사·스냅샷 프로필 경계를 흐린다 |
| D-2 | FR-CS2-2 "마지막 미응답 사유 `API_NOTICE`" | **`ConversationLog.apiNotice` 컬럼 추가** | 지금은 `record()` 파라미터로만 존재 — 로그 행에서 파생 불가(ADR-0004 통과). 수집기 전달은 불변 |
| D-3 | P-9 | §9 전체(원문 컬럼 · 3겹 파기 · `secure_delete` · 명시 요청 · 1건 감사 · 상담원 발신 마스킹 유지) | PM 결정 · (a)~(g) |
| D-4 | FR-CS5-5 "배치·타이머 없이" · AC-CS6-4 "스케줄러·타이머 코드 없음" | **조회 시점 판정 + 같은 함수를 호출하는 60초 정리 루프**(`PollingLoop` 재사용) | P-9 (b) — 아무도 조회하지 않는 상담의 원문이 무기한 남는다. **PM 확인 1** |
| D-5 | J-16 "첫 전달 응답에서만 봉투 정리, 이후 그대로" | **상담 중 모든 응답 + 종료 후 첫 턴에 `connectedAt` 기준 정리(멱등)** | 토큰이 폴링으로 발급되면 "첫 전달 POST 응답"이 없다 |
| D-6 | §1.3.2 주 "보류 답변 FAILED 시 관찰 창 — 폴링 응답에 같은 필드" | **PENDING 응답의 `watch.trigger='IF_PENDING_FAILS'`** — 보류 폴링 서버 코드·스키마 무변경 | ADR-0023 경로 불가침 · 폴링 서비스가 설정·기능 선언을 알 필요가 없다 |
| D-7 | FR-CS6-5 버킷 `handoff-ip`·`handoff-token` | **`poll-ip`(보류·상담 공용 600) + `poll-key:handoff:{sessionId}`(40)** · 환경변수명 변경 | 토큰 없는 관찰 창 폴링에도 2축이 필요하다(토큰 키로는 불가). K-1과 1축 공유 |
| D-8 | FR-CS8-4 "챗봇 복사 시 문장 복사(권고)" | **복사하지 않는다** | 기존 복사는 프로필만 복사(대화 자산도 미복사) — 문장만 복사하면 규약이 갈라진다 |
| D-9 | J-15 "사용자 무응답 10분" | **양쪽 모두 10분 침묵** · 라벨 "응답 없음으로 종료"(enum `USER_IDLE` 유지) | 사용자 발화 뒤 상담원이 사라지면 사용자가 봇 없이 갇힌다 |
| D-10 | FR-CS8-1 "읽기 `cs:read` 또는 `dialogue:read`" | **경로 2개**(관리 `dialogue:read` · 콘솔 검색 `cs:read`) | 가드는 AND만 지원 — OR 가드 신설 0 |
| D-11 | FR-0-125 오류 5종 | **7종**(+`HANDOFF_NOT_ASSIGNEE` 403 · `HANDOFF_UNAVAILABLE` 503) | FR-CS5-1 "403" · FR-CS4-4 "503"에 코드가 없었다 |
| D-12 | FR-CS4-1 개입 경로 `…/live-sessions/:alias/handoff`, 전송·종료·인수 `…/handoff/*` | 개입은 `:sessionRef`(16 hex) · 이후 동작은 **`/handoffs/:handoffId/*`** | 별칭(6자)은 충돌 시 길이가 변한다 · 재개입 시 같은 세션에 상담이 여러 건 — 동작 대상은 상담 id가 정확하다 |
| D-13 | FR-CS1-3 "노드 삭제 409 — ADR-0005 규칙 편입 여부" | `ReferenceCheckService.assertNodeDeletable`에 1회 조회 추가(`NODE_IN_USE`) · **복원 경고는 추가하지 않는다**(런타임 생략 + 설정 화면 경고) | 참조 규칙 1벌 · `versions/**` 무변경 |
| D-14 | FR-CS9-2 "상태 확장 `HANDOFF_CONNECTED`·`WATCHING`" | **상태와 직교하는 선택 필드 `handoff.mode`** | 기존 7상태(`SENDING`·`AWAITING_ANSWER`)와 동시에 성립해야 한다 · 초기 상태 불변 |
| D-15 | FR-CS9-7 "USER 복원 여부" | **복원한다(마스킹본)** | 대화 맥락 · 원문은 공개 표면 밖 |
| D-16 | FR-CS7-3 "질의 LRU 공유 여부" | **공유**(`SemanticMatchService` 그대로) | 입력이 실제 사용자 발화 · 발화당 1회 상한 |
| D-17 | FR-CS6-1 메서드·`sessionId` 위치 | **GET + 헤더 2개** · 공개 CORS `maxAge: 600` | URL 로그 유출 방지 · 프리플라이트 비용 상쇄 |
| D-18 | AC-CS4-4 "커서 1 → seq 2·3" | 연결 안내가 seq 1 → **스레드 seq 1~4에서 커서 2 → 3·4** | 시스템 메시지도 같은 순서열 |
| D-19 | AC-CS2-8 "쿼리 ≤3" | 목록 3 고정 · `내 상담 n건`은 ⑳으로 분리 | 목록 쿼리가 사용자 축을 갖지 않게 |
| D-20 | NFR-CSS7 "10단언" | **17단언**(H-1~H-17) | P-9 봉인(H-3·H-5·H-7) · DTO `sessionId` 부재(H-17) 추가 |

---

## 27. GPU · 배포 형태

- **GPU 1 유지**(P-17): DB 조회·CAS·순수 판정·문자 bigram. 의미 힌트는 **기존** ml-worker 임베딩 호출(발화당 1회)만 — 새 모델·학습·생성 0. ml-worker 변경 0.
- **구축형 ○**: 외부 의존·아웃바운드 0 · 새 인프라 0 · 임베딩 없으면 문자 유사도 힌트. 원문은 고객 DB 안에서만 잠시 존재하고 파기된다.
- **구독형 ○(전제 명시)**: DB 원천 + CAS + 부분 유니크 + 멱등 정리 루프라 다중 인스턴스 조정이 없다. 폴링 트래픽은 상담 중·관찰 창 세션에만 비례. ⚠ 고객 최종 사용자·상담원 대화(마스킹본)가 우리 인프라에 **무기한** 저장되고 원문이 **상담 중 최대 60분** 저장된다 — 보존·위치·암호화는 No.45(고객 약관 반영은 운영 문서 과제).

## 28. 구현 편차 (2026-09-25, 코드 리뷰 1회차 후 기록)

설계와 형태가 다르지만 기능 요건은 유지되는 구현 판단이다. 재검토 트리거가 오면 설계대로 되돌린다.

1. **원문 소거 시각**: `endHandoff`·`purgeExpiredRaw`는 요청 처리 시작 시 캡처한 애플리케이션 시각(`now`)으로 판정·기록한다. 실제 DB 커밋 시각과 미세한 차이가 있을 수 있다(60분 상한·60초 루프의 의미에는 영향 없음).
2. **`RAW_VIEW` 감사 중복 방지**: 설계의 인스턴스 로컬 메모(Set, 1,000건)는 두지 않았다. 매 요청 `auditLog.findFirst`로 (상담, 열람자) 기존 기록을 조회해 1건만 남긴다. 기능은 같고, 인스턴스가 많아지면 조회 비용만 늘어난다.
3. **`appendAgentMessage` 담당자 재검증**: 단일 원자 CAS 대신 `updateMany(where: assignedUserId + status)` 가드 후 메시지를 삽입한다. SQLite 단일 작성자 특성상 실질 위험은 낮다. Postgres 전환 시 같은 트랜잭션의 조건부 갱신으로 바꾼다(ADR-0036 재검토 트리거).
4. **모듈 의존 엣지 `HandoffModule → CannedResponsesModule`**: 콘솔의 자주 쓰는 문장 검색(`handoffs/canned-responses`)이 `CannedResponsesService.search()`를 재사용하기 위해 추가했다. §2.2 금지 목록(반대 방향)과 충돌하지 않는다.
5. **계약 보강(리뷰 1회차)**: `HandoffBriefSchema.isMine`, `HandoffDetailSchema.endButtonLabel`, 개입 전용 응답 `InterveneHandoffResponseSchema.watchWindowMissed`를 추가했다. 담당자 판정은 서버 `isMine`만 사용한다(이름 비교 금지).
6. **봉투 정리 기준 시각(리뷰 2회차 Low)**: `handleFirstContact`·`handleVerified`(§5.3 G-2/G-3/G-4)에서 `clearEnvelopeForHandoff(state, connectedAt)`를 호출할 때 상담 행의 실제 `connectedAt`이 아니라 **이번 요청의 `now`**를 넘긴다. 첫 접촉 턴에서는 `connectedAt`이 바로 이 요청에서 `now`로 설정되므로 값이 같지만, 이후 검증된 턴(G-4)에서는 매 요청마다 자르는 기준이 다시 "지금"으로 전진한다. 상담 구간에서는 엔진이 호출되지 않아 `contextSession`이 새로 생기지 않으므로 관찰되는 결과는 실제 `connectedAt`을 쓴 경우와 같지만(§5.4 요구사항 — 멱등 정리), 엔진이 다시 켜지는 장래 변경(§24 범위 밖 트리거)이 생기면 반드시 상담 행의 `connectedAt`으로 바꿔야 한다.
