# 옴니채널 통합 인박스 세부 설계서 (No.42)

> **요구사항**: `docs/requirements/omnichannel-inbox.md`(T-1~T-9, J-1~J-20, FR-0-183~193, FR-OC1-\*~FR-OC9-\*, NFR-OCP/OCS/OCR/OCA/OCM, AC-OC1~OC6, EX-OC-1~22, 제약 C-1~C-8, P-1~P-12)
> **상위 문서**: `docs/02-spec/개발명세서.md` §2·§2.1·§2.2·§3·§3.1·§4·§4.1·§5·§5.1·§6(**결정 43 신설**)·§7
> **신규 ADR**: **ADR-0042**(통합 인박스 = 호스트 서명 식별 토큰(헤더) + 식별 공간 솔트 HMAC 고객 키 + 연결 행(복사 없음) + 고객 1:1 스레드 + 로그 밖 기록/시뮬레이션 + 별도 순수 신호 포트 · 엔진·봉투·공개 표면 불변)
> **갱신 ADR(각주만)**: ADR-0001(방문 = 세션 불변) · ADR-0002(사전검사 16종째 · 설정 동반 삭제) · **ADR-0009(재검토 트리거 ② 발동 → 부분 갱신)** · **ADR-0011(`InboundTurn.identity?` · 채널 능력 표 · 스텁 금지와의 관계)** · ADR-0013(여섯 번째 적용 지점 = 인박스 저장) · ADR-0016(대상 3종) · **ADR-0036(재검토 트리거 "No.42" 이행)** · ADR-0040(암호화 대상 +2 · 보존 종류 +2 · `VIEW` +3 · 정보주체 파기 착수 조건 충족) · ADR-0041(봉투 `channel` 불변 판단)
> **작성일**: 2026-09-26 · **GPU**: **1**(카탈로그 2 → 하향, P-12 — HMAC-SHA256·해시·DB 조회/집계·규칙 기반 카드 조립뿐 · 모델·학습·추론·임베딩 0 · ml-worker 변경 0) — §25
> **기존 파일 수정 목록**: 문서는 `docs/02-spec/omnichannel-inbox-patches.md`, 코드는 이 문서 §2.5.

---

## 0. 이 문서가 푸는 문제 (한 문단 요약)

카탈로그 No.42는 "여러 채널에 걸친 동일 고객 대화를 하나의 스레드로 통합하고, 채널이 바뀌어도 컨텍스트를 유지"하는 **상담원 관점 통합 뷰**다. 이 설계는 **봇 동작·엔진·봉투·공개 응답·통계를 한 바이트도 바꾸지 않고, 기능을 켜지 않은 설치에서는 관측 가능한 변화가 없게** 다음을 만든다. ① **고객 식별** — 호스트(고객사) 서버가 로그인 회원에 대해 서명한 JWT(HS256)를 위젯이 기존 메시지 요청의 **헤더 `x-cb-identity`**로 보내고, 서버는 서명·만료만 확인한 뒤 **식별 공간 솔트 HMAC 해시**로 고객을 찾는다(원 회원 번호 저장 0) + 상담원 **수동 연결·분리** ② **고객 1명 = 스레드 1개**(열림/보류/종료 · 담당 · 전역 태그) ③ **전역 통합 인박스**(참여 챗봇 전체 · "사람이 볼 일이 생긴" 고객만 목록에) ④ **채널 현실** = WEB 실연동 + **수동 기록 채널**(전화·이메일·방문·기타) + **시뮬레이션 채널**(시험 고객 전용) — 기록·시뮬레이션은 `ConversationLog`·통계·학습 큐에 **쓰지 않는다** ⑤ **컨텍스트** = 상담원 화면의 이력 + 사실만 모은 고객 카드 + 메모 ⑥ No.24 상담 콘솔에는 고객 카드 링크만 더한다.

> 이 설계가 코드에서 **추가로 찾은 제약 11건**:
> **① 공개 파이프라인은 `adapter.normalizeInbound(dto)`에 요청 본문만 넘긴다**(`conversation/public-conversation.service.ts` 149~150행) — 헤더 값은 컨트롤러의 `opts`(`public-conversation.controller.ts` 54~59행)로만 들어온다 → 식별 토큰은 컨트롤러 `@Headers` → `opts.identityToken` → 어댑터 원시 입력의 선택 키로 흘려 `InboundTurn.identity?`로 정규화한다(§5.2) ·
> **② 공개 표면 CORS는 `allowedHeaders`를 지정하지 않는다**(`main.ts` 31~36행 — cors 패키지가 요청 헤더를 반사) → 새 헤더에 CORS 변경 0(ADR-0011 §5 불변) ·
> **③ `SessionRefResolverService`는 `HandoffModule`이 export하지 않는다**(`handoff/handoff.module.ts` 57행 — export 2개) → 인박스는 모듈을 import하지 않고 `computeSessionRef()`(순수 1벌)만 import해 자체 조회(연결 행 → 상담 행 → 최근 24시간 로그)를 둔다(§7.2) ·
> **④ `SimulationModule`의 export가 0개다**(`simulation/simulation.module.ts` 37~39행) → 시뮬레이션 채널이 "기존 시뮬레이터 엔진 경로"를 쓰려면 `exports: [SimulationService]` 1줄이 필요하다(§10.2) ·
> **⑤ No.41 포트의 `HANDOFF_STARTED`에는 `sessionId`가 없고**(`handoff-thread.service.ts` 133~142행) **W-16이 원천 파일의 `kind: '…'` 리터럴을 센다**(`workflow-sealing.spec.ts` 484~497행) → No.41 포트를 재사용하지 않고 판별 키가 `signal:`인 **별도 순수 포트** `INBOX_SIGNAL_SINK`를 둔다(§8.1 · ADR-0042 §5) ·
> **⑥ 보존 전역 저장 `updateGlobal()`은 `ALL_KINDS` 전부를 돌며 `dto.days[kind]`가 `undefined`여도 `judgeShorten(current, undefined)`가 "단축"으로 판정한다**(`governance/retention-policy.service.ts` 132~148행 · `lib/retention-policy.ts` 91~95행) → 새 보존 종류는 스키마에서 **선택 키**이고 서비스는 "`undefined` = 현재값 유지" 분기를 둔다(§13.2) ·
> **⑦ `GlobalRetentionUpdateSchema.days`는 6키 필수 `.strict()`다**(`shared-types/src/governance.ts` 37~49행) — 기존 콘솔·시험이 6키만 보낸다(`data-governance-permission-matrix.integration.spec.ts` 139행) → 새 키 2개는 `.optional()` ·
> **⑧ 열람 감사 닫힌 목록 개수 8이 정적 검사 리터럴이다**(`governance-sealing.spec.ts` 590~598행) → X-3 ·
> **⑨ `MessageFeedback`에는 `sessionId`가 없다**(`schema.prisma` 680~723행) → 고객 카드의 부정 평가 수는 이미 읽은 로그 id(`conversationLogId`)로 센다 ·
> **⑩ 위젯은 공개 헤더 이름을 자체 상수로 복제해 둔다**(`apps/widget/src/constants/handoff.ts` 6~7행 — shared-types 런타임 비의존) → `constants/identity.ts` + shared-types 값과의 동등성 시험 ·
> **⑪ 영구삭제 사전검사 키는 `CHILD_COUNT_LABELS`·`counts` 두 곳에 나열된다**(`chatbots/chatbots.service.ts` 32~54·336~352행) → 16번째 `customerLinks`는 두 곳 모두에 추가(X-4).

---

## 1. PM 확정 사항 (2026-09-26 — P-1~P-12 전부 추천안)

| # | 확정 내용 | 이 문서에서의 반영 |
|---|---|---|
| **P-1 (b)** | 채널 = WEB 실연동 + 수동 기록 채널(전화·이메일·방문) + 시뮬레이션 채널(시험 고객 전용). 시뮬레이션·수동 기록은 대화 로그·통계·학습 큐에 쓰지 않는다 | §5 · §10 · §17 O-10 |
| **P-2 (a)** | 식별 = 고객사가 서명한 로그인 토큰(JWT HS256) · 기존 메시지 요청 헤더 · 해시만 저장(원 회원 번호 0) · 상담원 수동 연결·분리 · 서명 키 = 챗봇별 env 참조 | §6 · §7 |
| **P-3 (b)** | 새 전역 통합 인박스 · 고객 1명 = 스레드 1개 · 목록엔 볼 일이 생긴 고객만 · 여러 챗봇 통합 뷰 · 기존 상담 콘솔은 그대로 + 고객 카드 링크 | §8 · §9 · §15 |
| **P-4 (a)** | 컨텍스트 = 상담원 화면(이력 + 사실만 담은 고객 카드 + 메모) · 봇 동작 불변 | §9.3 · §19 |
| P-5 | 해시 + 암호화된 표시 이름 · 보존기간 경과 시 파기 | §6.4 · §13 |
| P-6 | 연결 행 방식 · 되돌릴 수 있는 병합 · 서로 다른 로그인 회원끼리 병합 금지 | §7 |
| P-7 | 상태 열림/보류(해제 시각)/종료 · 수동 배정 + 가져가기 · ADMIN 관리 전역 태그 | §8 |
| P-8 | 신규 권한 0 | §11 |
| P-9 | 챗봇별 참여 설정 · 기본 꺼짐 | §6.3 · §14 |
| P-10 | 마스킹 → 암호화 → 보존 소거 · `VIEW` 감사 화면 3개 추가 | §12 · §13 |
| P-11 | 2차 = 요구사항 §9 목록 | §26 |
| P-12 | GPU 1(하향) · 구축형 ○ · 구독형 ○ | §25 |
| (architect) | 토큰 = JWS Compact HS256 고정 · `sub`/`iat`/`exp` 필수 · `nbf`/`name`/`aud` 선택 · 시계 오차 ±300초 · 최대 수명 24시간 · 헤더 ≤2,048바이트 · 라이브러리 없이 `node:crypto` 순수 함수(알고리즘 혼동 공격면 0) | §6.1~§6.2 · R-3 |
| (architect) | 고객 키 = `HMAC-SHA256(OMNI_CUSTOMER_KEY_SECRET, "cb-omni-customer:v1\n<식별 공간 참조>\n<sub>")` — 식별 공간(= 테넌트) 솔트 · 챗봇 id는 솔트에 넣지 않는다(넣으면 챗봇 간 통합이 불가능) | §6.4 · R-6 |
| (architect) | 연결 적재 = **fire-and-forget**(`observe(): void` · 응답 비차단) + `drainForTest()` | §6.5 · R-7 |
| (architect) | 로그인 전 익명으로 스레드가 열린 세션에 유효 토큰이 오면 **익명 고객 → 식별 고객 자동 승격 병합**(되돌리기 ADMIN) | §7.4 · R-8 |
| (architect) | `CustomerLink` = `(chatbotId, sessionId)` **전체 유일**(재지정 + 이전 고객 기록) — 부분 유니크 인덱스 추가 0(4종 보존) | §3.1 · R-10 |
| (architect) | `IDENTITY` 연결 분리 = **ADMIN 전용**(토큰 재생 대응 — 분리 후 그 세션의 식별 토큰 무시) | §7.3 · R-11 ⚠ |
| (architect) | 공개 경로 `'WEB'` 하드코딩 6곳 = **1차 무변경**(2차 외부 채널 ADR의 교체 지점으로 목록화) · C-4 = 채널 능력 표 `CHANNEL_CAPABILITIES`로 정리(동작 불변) | §5.3 · §5.4 · R-2 |
| (architect) | 신호 포트 = No.41 포트와 **분리한 순수 포트** `common/inbox/inbox-signal.port.ts`(원천 2곳 · `@Optional()`) | §8.1 · 제약 ⑤ |
| (architect) | 저장 계층은 **마스킹을 거친 값(브랜드 타입 `MaskedText`)만** 받는다 — 호출부가 마스킹을 잊을 수 없다(No.26 `ValidatedLegacyRequest` 선례) | §8.3 · §13.3 · O-4 |
| (architect) | 보존 종류 **신설 2**(`INBOX_TEXT`·`CUSTOMER_IDENTITY` — 전역만) · 암호화 대상 **+2**(`INBOX_ENTRY_TEXT`·`CUSTOMER_DISPLAY_NAME` — 백필·재암호화 잡 편입) | §13 · R-20·R-21 |
| (architect) | No.24 콘솔 연계 = 기존 응답 불변 + 신규 조회 `GET /inbox/session-link` | §15.1 · R-16 |
| (architect) | 신규 `ApiErrorCode` 4종 · 관리자 32 핸들러(컨트롤러 5) · 기대값 변경 닫힌 목록 X-1~X-4 | §14.4 · §21.3 |

---

## 2. 아키텍처 배치

### 2.1 모듈 구조

기존 4계층 규약(개발명세서 §2.1)을 따른다. NestJS 모듈 **3개**(`inbox/core`·`inbox/identity`·`inbox`)를 신설하고 원천 서비스가 참조하는 포트는 **Nest 모듈이 아닌 순수 파일** 1개로 둔다.

```
apps/api/src/
├── common/inbox/
│   └── inbox-signal.port.ts                 # [신규·순수] INBOX_SIGNAL_SINK 토큰 · InboxSignal 유니온 · InboxSignalSink { signal(s): void }
├── inbox/
│   ├── core/                                # ── 쓰기 유일 + 참여 캐시 + 신호 처리 ──
│   │   ├── inbox-core.module.ts             # [신규] exports [INBOX_SIGNAL_SINK(useExisting), InboxStore, InboxParticipationCache]
│   │   ├── inbox.store.ts                   # [신규] ★ customer·customerLink·inboxThread·inboxEntry·inboxTag·inboxThreadTag·customerMerge 쓰기 유일 파일
│   │   │                                    #        ★ sealField('INBOX_ENTRY_TEXT'|'CUSTOMER_DISPLAY_NAME') 유일 파일 · 텍스트 인자 = MaskedText 브랜드만
│   │   │                                    #        전 쓰기 = $transaction + 조건부 갱신(CAS)
│   │   ├── inbox-participation.cache.ts     # [신규] 참여 챗봇 스냅샷(1쿼리 · TTL 30초 · 같은 인스턴스 저장 즉시 무효화)
│   │   ├── inbox-signal.service.ts          # [신규] 포트 구현 — signal()은 동기 반환 · 내부 비동기 · drainForTest()
│   │   └── lib/{masked-text.ts, thread-state.ts, open-rule.ts, merge-rule.ts, link-rule.ts, customer-ref.ts, display-name.ts}   # 순수
│   │                                        #   masked-text.ts = MaskedText 브랜드 + maskForInbox()(maskPii 1벌 래퍼 — 브랜드 생성 유일 지점)
│   ├── identity/                            # ── 공개 경로 전용(검증 + 연결 적재 요청) ──
│   │   ├── inbox-identity.module.ts         # [신규] exports [InboxIdentityService, InboxIdentitySecretResolver, IdentityFailureCounter]
│   │   │                                    #        imports [InboxCoreModule, BannedWordsModule] — 리졸버·카운터 주입 파일은 inbox/**로 봉인(O-1·O-11)
│   │   ├── inbox-identity.service.ts        # [신규] observe(input): void · drainForTest()
│   │   ├── inbox-identity-secret.resolver.ts# [신규] ★ OMNI_IDENTITY_SECRET__·OMNI_CUSTOMER_KEY_SECRET 읽기 유일 파일(process.env 직접 — 스키마 밖)
│   │   ├── identity-failure-counter.ts      # [신규] 챗봇×사유 24시간 링 카운터(인스턴스 로컬) + 경고 로그 스로틀
│   │   └── lib/{verify-identity-token.ts, customer-key.ts, base64url.ts, session-identity-cache.ts}   # 순수(시각·비밀 주입)
│   ├── read/                                # ── 읽기 전용 ──
│   │   ├── inbox-query.service.ts           # [신규] 목록·요약·고객 검색·세션 연결 조회·담당 후보·식별 공간
│   │   ├── inbox-thread-detail.service.ts   # [신규] 상세 = 고객 카드 + 타임라인 페이지
│   │   ├── inbox-text.reader.ts             # [신규] ★ openField 유일 파일(INBOX_ENTRY_TEXT·CUSTOMER_DISPLAY_NAME·HANDOFF_TEXT) — rawText 미선택
│   │   ├── session-ref-lookup.ts            # [신규] sessionRef → sessionId(연결 행 → 상담 행 → 최근 24시간 로그 distinct · LRU)
│   │   └── lib/{effective-status.ts, list-where.ts, build-customer-card.ts, assemble-timeline.ts}   # 순수
│   ├── manage/
│   │   ├── inbox-threads.service.ts         # [신규] 상태·담당·태그 부착·메모·기록·세션에서 열기 (+감사)
│   │   ├── inbox-customers.service.ts       # [신규] 새 익명 고객·연결·분리·병합·되돌리기 (+감사)
│   │   ├── inbox-tags.service.ts            # [신규] 전역 태그 목록(ADMIN 서비스 재검증) (+감사)
│   │   ├── inbox-test-customers.service.ts  # [신규] 시험 고객 생성·삭제·시뮬레이션(SimulationService 호출)
│   │   └── chatbot-inbox-settings.service.ts# [신규] ★ chatbotInboxSetting 쓰기 유일(영구삭제 동반 삭제 제외) · 캐시 무효화
│   ├── controllers/
│   │   ├── inbox-threads.controller.ts      # [신규] /inbox/threads* · /inbox/mask-preview · /inbox/assignees — 14 핸들러
│   │   ├── inbox-customers.controller.ts    # [신규] /inbox/customers* · /inbox/merges/* · /inbox/session-link · /inbox/identity-spaces — 8 핸들러
│   │   ├── inbox-test-customers.controller.ts # [신규] /inbox/test-customers* — 3 핸들러
│   │   ├── inbox-tags.controller.ts         # [신규] /inbox/tags* — 4 핸들러
│   │   └── chatbot-inbox-settings.controller.ts # [신규] /chatbots/:chatbotId/inbox-settings* — 3 핸들러
│   ├── guards/inbox-enabled.guard.ts        # [신규] OMNI_INBOX_ENABLED=false → 404 NOT_FOUND(컨트롤러 5개 공통)
│   ├── inbox.module.ts                      # [신규] controllers 5 · exports 0
│   └── lib/inbox-sealing.spec.ts            # §17 O-1~O-20
└── (원천·소비자 수정은 §2.5)
```

### 2.2 모듈 의존 방향

```
inbox            → inbox/core · inbox/identity(리졸버 — 회원 번호 검색 해시·설정 화면 상태 · 카운터 — 설정 화면 통계) · simulation(SimulationService) · audit-logs · chatbots(ChatbotScopeService) · banned-words · prisma · config · common/{inbox,crypto}
inbox/identity   → inbox/core · banned-words · prisma · config                       (도메인 모듈 import 0)
inbox/core       → prisma · config · common/{inbox,crypto} · handoff/lib/{session-ref, session-alert}(순수 파일)
conversation     → inbox/identity(InboxIdentityService — 공개 서비스 1곳) · inbox/core(conversation-log.service는 포트 토큰만)
handoff          → inbox/core(handoff-thread.service는 포트 토큰만)
governance       → Prisma 읽기·writer 쓰기만(inbox/** import 0)
validation｜versions｜deploy-schedules｜stats｜learning｜topics｜asset-transfer｜environment｜workflow｜feedback｜survey-responses｜simulation → inbox/** import 0
```

- **`InboxModule`의 export는 0개**다. 관리 서비스·컨트롤러·읽기 서비스는 모듈 밖에서 주입할 수 없다.
- `InboxCoreModule`은 `InboxStore`를, `InboxIdentityModule`은 리졸버·카운터를 export하지만 **주입 파일은 `inbox/**`로 봉인**한다(O-1·O-11). `handoff`·`conversation`의 DI 그래프에는 이 제공자들이 들어오지만 코드 참조는 포트 토큰과 `InboxIdentityService`뿐이다(No.41 `workflow/triggers` 선례와 같은 형태).
- **순환 없음**: `inbox/core`·`inbox/identity`는 도메인 모듈을 import하지 않는다(`BannedWordsModule`은 공용 필터 모듈). 경고 판정·`sessionRef`는 `handoff/lib`의 **순수 함수 파일**을 import한다(No.24 판정 1벌 — `HandoffModule` import 0).
- `InboxModule`은 `AppModule` imports **끝**(`WorkflowModule` 뒤)에 둔다. 루프·타이머가 없으므로 순서 의존은 없다.

### 2.3 공개 대화 파이프라인 위치

```
①  access.resolve → normalizeInbound(dto + identityToken?) 
①.5 [신규 No.42] inbound.identity가 있으면 inboxIdentity?.observe({...})   ← 동기 반환 · 예외 없음 · 헤더 없으면 호출 자체가 없다
②.5 입구 금지어(BLOCK = 조기 반환) → ②.7 상담 게이트(HANDLED = 조기 반환) → 서빙 버전 → ③④ 의미 점수 → resolveTurn
④.5 legacyApi → ④.6 survey → ④.7 workflow → ⑤.5 출구 금지어 → ⑦ RAG 분기 → ⑨ 응답 → ⑩ void logService.record()
                                                                        └─ record() 안: create → collector → workflow emit → [신규] inboxSignals?.signal(TURN_RECORDED)
```

- 식별은 **입구 금지어 앞**에서 요청된다 — BLOCK 턴·상담 HANDLED 턴·서빙 버전 없음 턴에도 "이 세션은 이 고객"이라는 사실은 기록된다(EX-OC-8). 응답·봉투·엔진 입력은 식별과 무관하다(FR-OC2-9).
- `observe()`는 `void` 반환이며 await하지 않는다. 헤더가 없으면 분기 자체가 없고(`inbound.identity` 키 부재), 헤더가 있어도 비참여 챗봇이면 참여 캐시 확인 1회(메모리) 후 반환한다(AC-OC1-2 — "헤더 파싱 0").

### 2.4 엔진·위젯·ml-worker · 워크스페이스 영향

| 워크스페이스 | 변경 |
|---|---|
| `packages/dialogue-engine` | **0건**(O-9) — 봉투 스키마·`CONVERSATION_STATE_VERSION` 불변 |
| `packages/shared-types` | **`inbox.ts` 신설**(§4.1) · `conversation.ts`(`IDENTITY_TOKEN_HEADER`) · `channel.ts`(`CHANNEL_CAPABILITIES`·`channelSupportsHandoff`) · `governance.ts`(`EncryptedFieldId` +2 · `RetentionTargetKind` +2 · 보존 요청 선택 키 2 · 지도 선택 키 `inbox?`) · `audit.ts`(`AuditTargetType` +3) · `common.ts`(`ApiErrorCode` +4) · `index.ts` |
| `packages/pii-mask` | 0건(호출만 — 여섯 번째 적용 지점) |
| `apps/web` | 통합 인박스 · 고객 스레드 · 수동 기록/메모 · 고객 검색·연결/병합 · 시뮬레이션 · 태그 관리 · 챗봇 설정 "통합 인박스" · 상담 콘솔 고객 카드 · 데이터 지도·보존 라벨 · `Record<AuditTargetType,…>`·`Record<RetentionTargetKind,…>` 라벨(컴파일 강제) — §20 |
| `apps/widget` | 식별 토큰 입력(임베드 속성·JS 호출) · 별도 `sessionStorage` 키 · 메시지 요청 헤더 · `sub` 변경 시 새 대화(§6.8) — vanilla 유지 · gzip +1.5KB 이하 |
| `apps/ml-worker` | **0건** |

### 2.5 기존 코드 변경 목록 (구현자 체크리스트)

| 파일 | 변경 | 근거 |
|---|---|---|
| `prisma/schema.prisma` + 마이그레이션 `20260926210000_omnichannel_inbox` | §3.1 — 신규 8테이블 · `Chatbot` 역참조 2(컬럼 0) · **새 모델은 파일 끝** | §3 |
| `packages/shared-types/src/*` | §2.4 표 · §4 | — |
| `common/inbox/inbox-signal.port.ts` | 신규 순수 포트 | §8.1 |
| `conversation/adapters/channel-adapter.ts` | `InboundIdentity` 타입 · `InboundTurn.identity?` · `normalizeInbound` 원시 입력 선택 키 `identityToken?` | §5.2 |
| `conversation/adapters/web-channel.adapter.ts` | `identityToken`이 있을 때만 `identity: { scheme: 'HOST_SIGNED_TOKEN', token }` 키 추가(없으면 키 부재) | FR-OC1-2 |
| `conversation/public-conversation.controller.ts` | `sendMessage`에 `@Headers(IDENTITY_TOKEN_HEADER) identityToken?` · 있을 때만 `opts`에 키 추가 | §5.2 |
| `conversation/public-conversation.service.ts` | `opts` 타입 `identityToken?` · 생성자 **18번째 선택 인자** `inboxIdentity?: InboxIdentityService` · ①.5 블록 1개 | §2.3 |
| `conversation/conversation-log.service.ts` | 생성자 5번째 `@Optional() @Inject(INBOX_SIGNAL_SINK)` · `workflowEvents?.emit` 뒤 `signal({ signal: 'TURN_RECORDED', … })` 1줄(기존 try 안) | §8.1 |
| `conversation/conversation.module.ts` | imports += `InboxIdentityModule`·`InboxCoreModule` | — |
| `handoff/handoff-thread.service.ts` | 생성자 4번째 `@Optional()` 포트 · `createHandoff` 트랜잭션 성공 뒤(No.41 emit 다음) `signal({ signal: 'HANDOFF_OPENED', … })` 1줄 — **트랜잭션 코드·쓰기 데이터 불변**(H-2·H-3·H-7 불변) | §8.1 |
| `handoff/handoff.module.ts` | imports += `InboxCoreModule` · **exports 불변(2개)** | — |
| `handoff/live-sessions.service.ts` | 115행 `agg.channelType === 'WEB'` → `channelSupportsHandoff(agg.channelType)`(동작 불변 — C-4) | §5.4 |
| `simulation/simulation.module.ts` | `exports: [SimulationService]` 1줄(서비스 코드 불변) | 제약 ④ |
| `common/crypto/encrypted-fields.ts` | `INBOX_ENTRY_TEXT`(`inbox_entries`·`text`) · `CUSTOMER_DISPLAY_NAME`(`customers`·`displayName`) | §13.1 |
| `governance/jobs/field-crypto.job.ts` | `ALL_FIELDS` += 2(백필·재암호화 편입) | EX-OC-17 |
| `governance/bootstrap/governance-bootstrap.service.ts` | `ENCRYPTED_COLUMNS` += 2(옛 키 필요 행 검사) | §13.1 |
| `governance/writer/governance-data.writer.ts` | `purgeInboxEntries(ids, now)` · `purgeCustomerIdentities(ids, now)`(각 `enableSecureDelete` + 조건부 갱신) · 재암호화·백필 필드 분기 +2 | §13.2 |
| `governance/jobs/retention.job.ts` | 전역 전용 종류 2개 블록(`CALL_LOGS` 블록 뒤) | §13.2 |
| `governance/retention-policy.service.ts` | `countAffected` +2 · `updateGlobal`의 "`undefined` = 유지" 분기 · 감사 스냅샷 키는 값이 있을 때만 | 제약 ⑥ |
| `governance/governance-map.service.ts` | 선택 키 `inbox?`(고객 0명이면 생략) | §13.4 |
| `chatbots/chatbots.service.ts` | 영구삭제 사전검사 +1(`customerLinks` — 라벨 "인박스 연결") · 동반 삭제 +1(`chatbotInboxSetting`) | §16 |
| `audit-logs/lib/audit-snapshot.ts` | `AUDIT_FIELDS` += 3 대상(§12) | 컴파일 강제 |
| `audit-logs/access/view-audit-targets.ts` | 3행 추가(§12.2) | FR-OC9-6 |
| `config/env.validation.ts` | 선택 6종 · **`OMNI_IDENTITY_SECRET__*`·`OMNI_CUSTOMER_KEY_SECRET`는 스키마에 넣지 않는다** | §3.4 |
| `app.module.ts` | imports 끝 `InboxModule` | §2.2 |
| `apps/widget/src/{loader.ts, core/identity-storage.ts(신규), core/session.ts, api/public-client.ts, constants/identity.ts(신규), ui/app.ts}` | §6.8 | FR-OC2-8 |
| 시험 파일 | §21.3 닫힌 목록 | FR-0-190 |

> **이 목록에 없는 파일은 바꾸지 않는다.** 특히 `packages/dialogue-engine/**` · `apps/ml-worker/**` · `handoff/handoff-gate.service.ts`·`handoff-public-poll.service.ts`·`session-ref-resolver.service.ts` · `handoff/lib/*`(import만) · `workflow/**` · `learning/**`·`stats/**`·`feedback/**`·`survey-responses/**` · `main.ts`(CORS 불변) · `jest.isolate-env.js`(새 루프 0).

### 2.6 커밋 분리 단위

| 커밋 | 범위 | 독립성 · 게이트 |
|---|---|---|
| **① 계약·스키마·순수 함수(관측 불변)** | shared-types(`inbox.ts`·헤더 상수·채널 능력 표·`ApiErrorCode`·`AuditTargetType` — **`RetentionTargetKind`·`EncryptedFieldId`는 제외**) · `AUDIT_FIELDS` · 웹 라벨 맵 · 마이그레이션(`CREATE`만) · 순수 lib 전부 + 단위 시험 · 위젯 상수 미러 | 등록되는 모듈이 없다 — 관측 변화 0. **기존 시험 무수정 통과**(여기서 깨지면 멈추고 보고) |
| **② 코어·식별(호출부 없음)** | `inbox/core`(store·캐시·신호) · `inbox/identity`(리졸버·서비스·카운터) · `EncryptedFieldId` +2 · 암호화 상수 · 잡 `ALL_FIELDS`·기동 검사 · O 봉인 일부 | 기대값 변경 = X-2. 호출부가 없어 고객·연결 0행 — FR-0-183 기준선을 **② 적용 후**로 잡는다 |
| **③ 원천 연결** | 공개 컨트롤러 헤더·어댑터 `identity?`·①.5 블록 · 포트 주입 2곳 · C-4 채널 능력 표 · 위젯 식별 입력 | 기대값 변경 0(생성자 인자 전부 선택 · 비참여 = 동작 동일) |
| **④ 관리 API·거버넌스·통합** | 컨트롤러 5 · 서비스 · 감사·`VIEW` · `RetentionTargetKind` +2·파기·지도 · 영구삭제 · `SimulationModule` export · `AppModule` · 웹 화면 · O 봉인 전체 | X-1 · X-3 · X-4 |

---

## 3. 데이터 모델 · 마이그레이션

### 3.1 Prisma 변경안

```prisma
model Chatbot {
  // ... 기존 필드·역참조 불변
  /// [신규 No.42] 역참조만 — DB 컬럼 변화 0.
  inboxSetting   ChatbotInboxSetting?
  customerLinks  CustomerLink[]
}

/// [신규 2026-09-26 No.42] 챗봇별 통합 인박스 참여 설정(1:1 · 행 없음 = 꺼짐). 환경 밖 — 저장 즉시 운영 반영(참여 캐시 30초 + 즉시 무효화).
/// ★ 서명 비밀 값 컬럼이 없다 — identitySecretRef(이름)만. 값은 OMNI_IDENTITY_SECRET__<REF> 환경변수(리졸버 1파일).
model ChatbotInboxSetting {
  chatbotId         String   @id
  chatbot           Chatbot  @relation(fields: [chatbotId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  enabled           Boolean  @default(false)
  /// ^[A-Z0-9]+(_[A-Z0-9]+)*$ · ≤40 · 같은 참조 = 같은 식별 공간(고객 공유) · 쓰기 = security:write 경로만
  identitySecretRef String?
  /// 경고 단계 도달 시 스레드 열기(No.24 판정 1벌 · 세션당 1회)
  openOnWarning     Boolean  @default(false)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@map("chatbot_inbox_settings")
}

/// [신규 No.42] 고객(최종 사용자). ★ 원 회원 번호(sub)·토큰·전체 sessionId 컬럼이 없다(O-5).
model Customer {
  id               String    @id @default(uuid())
  /// 16 hex 난수 — 별칭(앞 6자 · 목록 내 충돌 시 연장)의 원천. 고객 id·세션과 무관
  ref              String    @unique
  /// IDENTIFIED | ANONYMOUS | TEST — 생성 후 불변
  kind             String
  /// ACTIVE | MERGED
  status           String    @default("ACTIVE")
  /// IDENTIFIED만 — 식별 공간 참조(REF 이름)
  identitySpaceRef String?
  /// IDENTIFIED만 — HMAC-SHA256 hex 64. nullable 유일(NULL 다중 허용). 보존 소거 시 null
  customerKeyHash  String?   @unique
  /// 고객 키 비밀 지문(HMAC(secret,"cb-omni-fp:v1") 앞 8 hex) — 비밀 교체 탐지(EX-OC-20)
  keyFingerprint   String?
  /// 금지어 → PII 마스킹 → (모드 ON) 암호화. 소거 시 null
  displayName      String?
  /// MERGED일 때 대상 고객 — FK 없음
  mergedIntoId     String?
  firstSeenAt      DateTime
  lastActivityAt   DateTime
  identityPurgedAt DateTime?
  /// TEST·수동 익명 고객의 생성자 — FK 없음(사실 기록)
  createdById      String?
  createdByName    String?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  links  CustomerLink[]
  thread InboxThread?

  @@index([kind, lastActivityAt])
  @@index([lastActivityAt])           // 보존 소거·이름 검색 스캔(최근 N명)
  @@index([identitySpaceRef])
  @@map("customers")
}

/// [신규 No.42] 대화(챗봇 × 세션) ↔ 고객 연결 — 복사 없음. 세션당 현재 연결 1행.
model CustomerLink {
  id                 String    @id @default(uuid())
  customerId         String
  customer           Customer  @relation(fields: [customerId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  chatbotId          String
  chatbot            Chatbot   @relation(fields: [chatbotId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  /// 위젯 난수 — ★ 내부 전용(관리자 DTO·감사·로그 금지 — H-17 규약 확장)
  sessionId          String
  /// computeSessionRef(chatbotId, sessionId)
  sessionRef         String
  /// 대화가 들어온 배포 채널(1차 = WEB)
  channelType        String
  /// IDENTITY | MANUAL | SYSTEM
  source             String
  /// MANUAL 재지정 전 연결(분리 시 복귀 대상)
  previousCustomerId String?
  previousSource     String?
  /// 이 세션에서 서명 식별이 확인된 시각(승격 병합 후 SYSTEM/MANUAL 행에도 남는다)
  identityVerifiedAt DateTime?
  /// ADMIN 분리 — 이후 이 세션의 식별 토큰을 무시(재생 대응)
  identityBlockedAt  DateTime?
  /// 경고 단계 열림 1회 표식(CAS)
  warningOpenedAt    DateTime?
  linkedById         String?
  linkedByName       String?
  linkedAt           DateTime
  updatedAt          DateTime  @updatedAt

  @@unique([chatbotId, sessionId])    // 세션당 연결 1행 — 전체 유일(부분 유니크 아님)
  @@index([chatbotId, sessionRef])
  @@index([customerId, linkedAt])
  @@map("customer_links")
}

/// [신규 No.42] 고객 스레드(고객 1:1). "볼 일이 생긴" 순간 생성.
model InboxThread {
  id                String    @id @default(uuid())
  customerId        String    @unique
  customer          Customer  @relation(fields: [customerId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  /// OPEN | PENDING | CLOSED
  status            String
  snoozeUntil       DateTime?
  /// HANDOFF | WARNING | RECORD | NOTE | MANUAL | SIMULATION — 최초 열림 사유
  openReason        String
  /// FK 없음(사실 기록) · 이름 스냅샷
  assigneeUserId    String?
  assigneeUserName  String?
  lastActivityAt    DateTime
  /// CONVERSATION | HANDOFF | NOTE | RECORD | SIMULATION | SYSTEM
  lastActivityKind  String
  lastChannelFamily String?
  lastChannelType   String?
  lastChatbotId     String?
  /// 마지막 NOTE·RECORD·SIM 항목 — 목록 미리보기 원천(미리보기 텍스트 복제 컬럼 없음)
  lastEntryId       String?
  /// 병합으로 숨김(원 고객 스레드) — CustomerMerge.id
  hiddenByMergeId   String?
  /// 낙관적 동시성(모든 사람 쓰기가 +1)
  version           Int       @default(0)
  openedAt          DateTime
  closedAt          DateTime?
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  entries InboxEntry[]
  tags    InboxThreadTag[]

  @@index([status, lastActivityAt])
  @@index([assigneeUserId, status, lastActivityAt])
  @@index([status, snoozeUntil])
  @@index([lastActivityAt])
  @@map("inbox_threads")
}

/// [신규 No.42] 스레드 항목 — 메모·수동 기록·시뮬레이션·시스템. id = 앱 선발급(AAD).
model InboxEntry {
  id               String    @id
  threadId         String
  thread           InboxThread @relation(fields: [threadId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  /// NOTE | RECORD | SIM_USER | SIM_BOT | SYSTEM
  kind             String
  recordChannel    String?   // PHONE | EMAIL | VISIT | OTHER
  direction        String?   // INBOUND | OUTBOUND
  outcome          String?   // RESOLVED | FOLLOW_UP
  simulatedChannel String?   // ChannelType 8종(SIM_*만)
  /// SIM_*만 — FK 없음
  chatbotId        String?
  /// PII 마스킹 → (모드 ON) 암호화. SYSTEM은 "" · 소거 시 ""
  text             String    @default("")
  /// SYSTEM 이벤트 JSON — 열거값·id·별칭·직원 이름만(고객 본문·이름 0)
  meta             String    @default("{}")
  occurredAt       DateTime
  authorUserId     String?
  authorName       String?
  editedAt         DateTime?
  textPurgedAt     DateTime?
  createdAt        DateTime  @default(now())

  @@index([threadId, occurredAt])
  @@index([textPurgedAt, createdAt])  // 보존 소거 탐색
  @@map("inbox_entries")
}

/// [신규 No.42] 전역 태그(ADMIN 관리 · ≤100).
model InboxTag {
  id             String   @id @default(uuid())
  name           String
  nameNormalized String   @unique
  /// 팔레트 키(UIUX 대비 검증된 8색 중 1) — 자유 HEX 아님
  color          String
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  threads        InboxThreadTag[]

  @@map("inbox_tags")
}

model InboxThreadTag {
  threadId  String
  thread    InboxThread @relation(fields: [threadId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  tagId     String
  tag       InboxTag    @relation(fields: [tagId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  addedAt   DateTime    @default(now())
  addedById String?

  @@id([threadId, tagId])
  @@index([tagId])
  @@map("inbox_thread_tags")
}

/// [신규 No.42] 병합 기록 — 되돌리기의 근거. FK 없음(사실 기록). 본문 0.
model CustomerMerge {
  id                      String    @id @default(uuid())
  /// MANUAL | IDENTITY_PROMOTION
  kind                    String
  sourceCustomerId        String
  targetCustomerId        String
  sourceThreadId          String?
  targetThreadId          String?
  /// 대상에 스레드가 없어 원 스레드를 통째로 옮겼는가
  movedThread             Boolean   @default(false)
  movedLinkIds            String    @default("[]")
  movedEntryIds           String    @default("[]")
  addedTagIds             String    @default("[]")
  sourceThreadPriorStatus String?
  mergedById              String?
  mergedByName            String?
  mergedAt                DateTime
  revertedAt              DateTime?
  revertedById            String?
  revertedByName          String?

  @@index([sourceCustomerId])
  @@index([targetCustomerId, mergedAt])
  @@map("customer_merges")
}
```

- **부분 유니크 인덱스를 추가하지 않는다**: 요구사항 초안의 `(chatbotId, sessionId) WHERE unlinkedAt IS NULL`은 "세션당 현재 연결 1행 + 재지정·이전 고객 기록"으로 대체한다(`@@unique` 전체 유일 — SQLite·Postgres 공통). 연결 이력은 `SYSTEM` 항목·감사·`CustomerMerge`가 남긴다. **원시 부분 유니크 4종 개수 불변**(R-10).
- **FK 규약**: 새 관계는 전부 `Restrict`. `CustomerMerge`·`InboxEntry.chatbotId`·`InboxThread.assigneeUserId`·`Customer.mergedIntoId`·`CustomerLink.previousCustomerId`는 FK 없음(사실 기록 — 로그 규약).
- **`CustomerLink → Chatbot` FK `Restrict`** 때문에 연결이 있는 챗봇은 영구삭제 사전검사에서 막힌다(16번째 — §16).

### 3.2 마이그레이션 (1개 — `20260926210000_omnichannel_inbox`)

```sql
-- 전부 CREATE — 기존 테이블 재정의 0 · ALTER 0(Chatbot 역참조는 컬럼이 없다) · 백필 0
CREATE TABLE "chatbot_inbox_settings" (…, CONSTRAINT "chatbot_inbox_settings_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE);
CREATE TABLE "customers" (…);
CREATE UNIQUE INDEX "customers_ref_key" ON "customers"("ref");
CREATE UNIQUE INDEX "customers_customerKeyHash_key" ON "customers"("customerKeyHash");
CREATE INDEX … customers(kind,lastActivityAt) · (lastActivityAt) · (identitySpaceRef)
CREATE TABLE "customer_links" (… FK customerId → customers · chatbotId → chatbots — RESTRICT/CASCADE);
CREATE UNIQUE INDEX "customer_links_chatbotId_sessionId_key" ON "customer_links"("chatbotId","sessionId");
CREATE INDEX … customer_links(chatbotId,sessionRef) · (customerId,linkedAt)
CREATE TABLE "inbox_threads" (… FK customerId); CREATE UNIQUE INDEX "inbox_threads_customerId_key" …;
CREATE INDEX … inbox_threads(status,lastActivityAt) · (assigneeUserId,status,lastActivityAt) · (status,snoozeUntil) · (lastActivityAt)
CREATE TABLE "inbox_entries" (… FK threadId); CREATE INDEX … (threadId,occurredAt) · (textPurgedAt,createdAt)
CREATE TABLE "inbox_tags" (…); CREATE UNIQUE INDEX "inbox_tags_nameNormalized_key" …;
CREATE TABLE "inbox_thread_tags" (… PRIMARY KEY ("threadId","tagId") · FK 2); CREATE INDEX … (tagId)
CREATE TABLE "customer_merges" (…);  -- FK 없음
CREATE INDEX … customer_merges(sourceCustomerId) · (targetCustomerId,mergedAt)
```

- **수기 작성**(선행 그룹 규약). `prisma migrate dev`의 diff가 원시 부분 유니크 4종(`test_runs_chatbotId_active_key`·`deploy_schedules_chatbotId_scheduledAt_active_key`·`deploy_schedules_chatbotId_running_key`·`handoff_sessions_active_key`)을 지우는 구문을 끼우지 않았는지 확인한다. 적용 후 `SELECT count(*) FROM sqlite_master WHERE type='index' AND sql LIKE '%WHERE%'` = **4**.
- 통합 시험 DB는 **`prisma migrate deploy`**로 만든다(CLAUDE.md).
- **기존 데이터 호환성**: 기존 테이블에 행·컬럼 변경이 없다. 도입 직후 고객·연결·스레드는 **0행**이며, 과거 대화는 소급 연결하지 않는다(식별 토큰은 도입 이후 요청부터 · 수동 연결은 최근 24시간 세션 + 상담 이력이 있는 세션만 — §7.2). 과거 `HandoffSession`에 스레드를 소급 생성하지 않는다(K-6).

### 3.3 seed

데모 챗봇 참여 설정은 **꺼짐** 1행만 만든다(화면 확인용). 고객·스레드·태그 seed 0 — 데모 태그가 필요하면 콘솔에서 만든다. 식별 비밀 환경변수 예시는 `.env.example`에 **주석으로만**(값 없음).

### 3.4 환경변수 — 선택 6종(zod) + 비밀 2규약(스키마 밖) · 전부 기본값 · 기동 조건 아님

| 변수 | 기본 | 검증 | 용도 |
|---|---|---|---|
| `OMNI_INBOX_ENABLED` | `true` | `envBoolean` | 전역 스위치 — `false`면 인박스·설정 API `404` · 식별 검증 0 · 신호 no-op · 저장된 데이터 유지(EX-OC-18) |
| `OMNI_IDENTITY_MAX_TTL_HOURS` | `24` | 1~24 | 토큰 `exp − iat` 상한 |
| `OMNI_IDENTITY_CLOCK_SKEW_SEC` | `300` | 0~600 | `exp`·`iat`·`nbf` 허용 오차 |
| `OMNI_INBOX_POLL_MS` | `10000` | 3000~60000 | 콘솔 폴링 권고값(목록 응답 메타 `pollAfterMs`) |
| `OMNI_NAME_SEARCH_SCAN_LIMIT` | `2000` | 100~20000 | 이름 부분 일치 검색의 복호화 스캔 상한(최근 활동 순) |
| `OMNI_MERGE_REVERT_HOURS` | `24` | 1~168 | 병합 수행자 본인의 되돌리기 기한(ADMIN은 기한 없음) |
| `OMNI_CUSTOMER_KEY_SECRET` | — | **스키마 밖** | 고객 키 해시 비밀(≥32바이트). 없거나 짧으면 **식별 기능만 꺼짐**(`MISSING`/`WEAK` 배지) — 수동 연결·기록·시뮬레이션은 동작. **교체 금지**(교체 = 기존 고객과 통합 끊김 — K-3) |
| `OMNI_IDENTITY_SECRET__<REF>` · `…__<REF>__PREV` | — | **스키마 밖**(REF `^[A-Z0-9]+(_[A-Z0-9]+)*$` ≤40) | 식별 공간별 토큰 서명 비밀(≥32바이트) · `__PREV`는 호스트 비밀 교체 중 병행 검증용(선택) |

- boolean은 `envBoolean()`, 쿼리 boolean(`includeTest`·`activeHandoff`·`force`)은 `queryBoolean().default(false)`(shared-types `common.ts` — CLAUDE.md: `z.coerce.boolean()` 금지).
- 비밀 2규약은 `inbox-identity-secret.resolver.ts` **1파일만** `process.env`에서 읽는다(`ConfigService`에 싣지 않는다 — ADR-0040 §1·No.41 선례). 값은 로그·오류·응답·감사·지도 어디에도 없다(FR-0-187).
- 코드 상수(`INBOX_LIMITS` — shared-types): 태그 전역 100 · 스레드당 10 · 태그 이름 20자 · 메모 2,000자 · 기록 4,000자 · 기록 과거 7일(미래 +60초 허용) · 보류 최대 30일 · 목록 페이지 ≤50 · 타임라인 단위 50 · 세션당 턴 200 · 고객 카드 집계 세션 상한 200 · 표시 이름 40자 · 메모 수정 창 10분 · 시뮬레이션 메시지 1,000자 · 식별 헤더 2,048바이트 · 검색 결과 ≤50 · 수동 연결 조회 창 24시간 · 참여 캐시 30초 · 식별 세션 캐시 20,000건·30분.

### 3.5 배포 순서 · 롤백

1. 마이그레이션(`CREATE`만 — API 중지 불필요) → 2. API 배포 → 3. 위젯 배포(위젯은 토큰이 없으면 헤더를 보내지 않으므로 **어느 순서든 안전** — 구 API는 헤더를 무시한다). 롤백: API를 되돌리고 테이블은 남긴다(구버전은 테이블을 모른다). 거버넌스 암호화를 켠 설치는 ADR-0040 감수 비용 7(API 롤백 금지)이 그대로 적용된다(표시 이름·기록 본문이 봉투일 수 있다).

---

## 4. shared-types 계약

### 4.1 `inbox.ts`(신설 — `common.ts`·`channel.ts`·`conversation.ts`만 의존)

```ts
export const InboxSourceFamily = z.enum(['DEPLOY', 'RECORD', 'SIMULATED']);
export const RecordChannel = z.enum(['PHONE', 'EMAIL', 'VISIT', 'OTHER']);          // 배포 채널(ChannelType)이 아니다 — J-3
export const RECORD_CHANNEL_LABELS: Record<RecordChannel, string> = { PHONE: '전화', EMAIL: '이메일', VISIT: '방문', OTHER: '기타' };
export const RecordDirection = z.enum(['INBOUND', 'OUTBOUND']);                    // 고객이 연락 / 우리가 연락
export const RecordOutcome = z.enum(['RESOLVED', 'FOLLOW_UP']);
export const CustomerKind = z.enum(['IDENTIFIED', 'ANONYMOUS', 'TEST']);
export const CustomerStatus = z.enum(['ACTIVE', 'MERGED']);
export const CustomerLinkSource = z.enum(['IDENTITY', 'MANUAL', 'SYSTEM']);
export const InboxThreadStatus = z.enum(['OPEN', 'PENDING', 'CLOSED']);
export const InboxOpenReason = z.enum(['HANDOFF', 'WARNING', 'RECORD', 'NOTE', 'MANUAL', 'SIMULATION']);
export const InboxEntryKind = z.enum(['NOTE', 'RECORD', 'SIM_USER', 'SIM_BOT', 'SYSTEM']);
export const InboxSystemEvent = z.enum(['OPENED', 'STATUS', 'ASSIGNEE', 'TAGS', 'LINKED', 'UNLINKED', 'IDENTITY_BLOCKED', 'MERGED_IN', 'MERGE_REVERTED', 'PROMOTED']);
export const IdentityFailureReason = z.enum(['MALFORMED', 'SIGNATURE', 'EXPIRED', 'NOT_YET_VALID', 'TTL_TOO_LONG', 'SECRET_MISSING', 'CONFLICT']);
export const IdentitySecretStatus = z.enum(['NOT_SET', 'CONFIGURED', 'MISSING', 'WEAK']);
export const CustomerMergeKind = z.enum(['MANUAL', 'IDENTITY_PROMOTION']);
export const IDENTITY_SPACE_REF_PATTERN = /^[A-Z0-9]+(?:_[A-Z0-9]+)*$/;            // ≤40 — `__PREV` 접미와 충돌하지 않게 연속 밑줄 금지
export const INBOX_LIMITS = { /* §3.4 */ } as const;

/** 목록 행(FR-OC4-3) — ★ sessionId·원문·회원 번호·토큰·해시 키 없음(O-6) */
export const InboxThreadListItemSchema = z.object({
  threadId: z.string().uuid(),
  version: z.number().int(),
  customer: z.object({ id: z.string().uuid(), alias: z.string(), displayName: z.string().optional(), kind: CustomerKind, identityPurged: z.literal(true).optional() }),
  status: InboxThreadStatus,                    // 유효 상태(보류 해제 시각 경과 = OPEN)
  snoozeUntil: z.coerce.date().optional(),
  snoozeExpired: z.literal(true).optional(),
  assignee: z.object({ id: z.string(), name: z.string(), active: z.boolean() }).optional(),
  tags: z.array(z.object({ id: z.string().uuid(), name: z.string(), color: z.string() })),
  lastChannel: z.object({ family: InboxSourceFamily, type: z.string(), label: z.string() }).optional(),
  lastChatbot: z.object({ id: z.string().uuid(), name: z.string() }).optional(),
  linkedConversationCount: z.number().int(),    // 참여 챗봇 연결만
  activeHandoffCount: z.number().int(),
  lastActivityAt: z.coerce.date(),
  lastActivityKind: z.string(),
  lastEntryPreview: z.string().optional(),      // NOTE·RECORD·SIM만 — 마스킹본 60자(복호화) · 소거 시 없음 + lastEntryPurged
  lastEntryPurged: z.literal(true).optional(),
  noParticipatingChatbot: z.literal(true).optional(),  // EX-OC-11
});
export const InboxThreadListQuerySchema = PaginationQuerySchema.extend({
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  status: csvEnumArray(InboxThreadStatus).optional(),          // 기본 OPEN,PENDING
  assignee: z.union([z.literal('ME'), z.literal('NONE'), z.string().uuid()]).optional(),
  chatbotIds: /* uuid CSV 배열(csvEnumArray의 uuid 판 — common.ts 헬퍼) */ .optional(),
  channelFamily: csvEnumArray(InboxSourceFamily).optional(),
  tagIds: /* uuid CSV 배열 */ .optional(),
  customerKinds: csvEnumArray(CustomerKind).optional(),
  includeTest: queryBoolean().default(false),
  activeHandoff: queryBoolean().default(false),
  from: z.coerce.date().optional(), to: z.coerce.date().optional(),
});
// 응답: paginated(InboxThreadListItemSchema) + meta { pollAfterMs, generatedAt, participatingChatbots: {id,name}[] }
export const InboxSummaryResponseSchema = z.object({ open: z.number(), pending: z.number(), mine: z.number(), unassigned: z.number(), activeHandoff: z.number(), generatedAt: z.coerce.date() });

/** 타임라인 단위(FR-OC5-2) — 유니온 */
export const TimelineConversationUnitSchema = z.object({
  kind: z.literal('CONVERSATION'), at: z.coerce.date(),
  chatbot: z.object({ id: z.string().uuid(), name: z.string() }),
  channel: z.object({ family: z.literal('DEPLOY'), type: z.string(), label: z.string() }),
  sessionRef: z.string(), sessionAlias: z.string(), linkSource: CustomerLinkSource,
  startedAt: z.coerce.date(), lastAt: z.coerce.date(),
  turns: z.array(z.object({ at: z.coerce.date(), user: z.string(), bot: z.string(), answered: z.boolean(), handoffTurn: z.boolean(), blocked: z.boolean(), purged: z.literal(true).optional() })),
  handoffs: z.array(z.object({ handoffId: z.string().uuid(), status: z.string(), startedAt: z.coerce.date(), endedAt: z.coerce.date().optional(), endReason: z.string().optional(), agentName: z.string(),
                               messages: z.array(z.object({ at: z.coerce.date(), sender: z.enum(['USER', 'AGENT', 'SYSTEM']), text: z.string(), purged: z.literal(true).optional() })) })),
  truncated: z.literal(true).optional(),
});
export const TimelineEntryUnitSchema = z.object({
  kind: InboxEntryKind, at: z.coerce.date(), entryId: z.string().uuid(),
  text: z.string(), purged: z.literal(true).optional(),
  recordChannel: RecordChannel.optional(), direction: RecordDirection.optional(), outcome: RecordOutcome.optional(),
  simulated: z.object({ channel: z.string(), channelLabel: z.string(), chatbot: z.object({ id: z.string(), name: z.string() }) }).optional(),
  system: z.object({ event: InboxSystemEvent, data: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])) }).optional(),
  author: z.object({ id: z.string(), name: z.string() }).optional(), editedAt: z.coerce.date().optional(), editable: z.boolean().optional(),
});
export const InboxThreadDetailSchema = z.object({
  thread: InboxThreadListItemSchema,
  card: CustomerCardSchema,                                   // §9.3
  timeline: z.object({ units: z.array(z.union([TimelineConversationUnitSchema, TimelineEntryUnitSchema])), nextCursor: z.string().nullable() }),
  activeHandoffs: z.array(z.object({ handoffId: z.string().uuid(), chatbotId: z.string().uuid(), chatbotName: z.string(), sessionRef: z.string(), agentName: z.string() })),
});
```

요청 스키마(전부 `.strict()`): `UpdateThreadStateSchema { status, snoozeUntil?: date(미래 · ≤30일 · PENDING일 때만), version }` · `AssignThreadSchema { userId, version }` · `ReleaseThreadSchema { version }` · `SetThreadTagsSchema { tagIds: uuid[≤10], version }` · `CreateNoteSchema { text: 1~2000 }` · `UpdateNoteSchema { text }` · `CreateRecordSchema { recordChannel, direction, occurredAt, text: 1~4000, outcome? }` · `InboxMaskPreviewSchema { text: ≤4000 }` · `OpenThreadFromSessionSchema { chatbotId, sessionRef: 16 hex }` · `CustomerSearchSchema { q?: 1~40, memberId?: printable ASCII 1~128, identitySpaceRef?, kinds?, includeTest?: boolean, activeWithinDays?: 1~365, limit?: ≤50 }`(memberId ⇒ identitySpaceRef 필수 — superRefine) · `CreateAnonymousCustomerSchema { displayName?: ≤40 }` · `LinkSessionSchema { chatbotId, sessionRef }` · `MergeCustomerSchema { targetCustomerId }` · `InboxTagCreate/UpdateSchema { name: 1~20, color: 팔레트 enum }` · `CreateTestCustomerSchema { label: 1~40 }` · `SimulateInboxSchema { chatbotId, simulatedChannel: ChannelType, message?, buttonAction?, state?: unknown, target?: BundleTargetSchema }`(정확히 하나 — `SimulateRequestSchema` superRefine 재사용) · `ChatbotInboxSettingsUpdateSchema { enabled, openOnWarning }`(PUT 전체 교체) · `ChatbotInboxIdentityUpdateSchema { identitySecretRef: string(패턴) | null }`.

응답 스키마 요점: `CustomerSearchItem { customerId, alias, displayName?, kind, identified, identityPurged?, lastActivityAt, threadId?, threadStatus?, linkedConversationCount }` + `{ items, truncatedScan }` · `SessionLinkLookupResponse = { participating: false } | { participating: true, customer: null } | { participating: true, customer: { id, alias, displayName?, kind }, threadId?, threadStatus?, cardBrief: { conversationCount, lastIntentName?, handoffCount, lastNote?: 60자 } }` · `MergeResultSchema { mergeId, movedLinks, movedEntries, movedThread, droppedTags }` · `RevertMergeResultSchema { revertedLinks, skippedLinks, revertedEntries }` · `ChatbotInboxSettingsResponse { chatbotId, enabled, openOnWarning, identity: { secretRef: string|null, secretStatus: IdentitySecretStatus, customerKeyStatus: 'CONFIGURED'|'MISSING'|'WEAK', keyFingerprintChanged: boolean, stats24h: { verified: number, failures: Record<IdentityFailureReason, number>, scope: 'INSTANCE' } }, environmentNotice: 'OUTSIDE_ENVIRONMENT', updatedAt: date|null }` · `SimulateInboxResponse { outputs, state, stateReset, entries: TimelineEntryUnit[2], degradePreview: 'NOT_DEFINED' }`.

### 4.2 기존 스키마 확장 (전부 값 추가·선택 키 — 하위 호환)

| 파일 | 변경 |
|---|---|
| `conversation.ts` | `IDENTITY_TOKEN_HEADER = 'x-cb-identity'`(상담 헤더 상수 옆) — `PublicMessageRequestSchema`·`PublicMessageResponseSchema` **불변** |
| `channel.ts` | `CHANNEL_CAPABILITIES: Record<ChannelType, { handoff: boolean }>`(WEB만 true) · `channelSupportsHandoff(type: string): boolean`(모르는 문자열 = false) |
| `governance.ts` | `EncryptedFieldId` +`INBOX_ENTRY_TEXT`·`CUSTOMER_DISPLAY_NAME`(4 → 6) · `RetentionTargetKind` +`INBOX_TEXT`·`CUSTOMER_IDENTITY`(6 → 8) · `GlobalRetentionUpdateSchema.days`·`RetentionPreviewRequestSchema.days`에 **선택 키 2**(`.optional()` — 기존 6키 요청 그대로 통과) · `ChatbotRetentionUpdateSchema`·`CONVERSATION_RETENTION_KINDS` **불변**(전역만) · `GovernanceMapResponseSchema` 선택 키 `inbox?: { customers, identifiedCustomers, threads, entries, identityHashOnly: true, displayNameEncrypted: boolean, retentionDays: { INBOX_TEXT: number|null, CUSTOMER_IDENTITY: number|null } }` |
| `audit.ts` | `AuditTargetType` +`Customer`·`InboxThread`·`InboxTag`(30 → 33) · 라벨 · `AuditAction` 추가 0 |
| `common.ts` | `ApiErrorCode` +`INBOX_THREAD_CONFLICT`·`CUSTOMER_LINK_LOCKED`·`CUSTOMER_MERGE_FORBIDDEN`·`CUSTOMER_MERGE_NOT_REVERTIBLE` |

---

## 5. 채널 계층 (P-1 · J-1~J-3 · C-3 · C-4 · C-7)

### 5.1 "채널" = 대화 출처 3계열

| 계열 | 값 | 봇 답 | 상담 개입 | 로그·통계·학습 큐 | 저장 위치 |
|---|---|---|---|---|---|
| **DEPLOY**(배포 채널) | `ChannelType` 8종 중 실제로는 WEB만 | ✓ | `channelSupportsHandoff()` | ✓(기존) | `ConversationLog`·`HandoffMessage`(연결 행으로 참조만) |
| **RECORD**(기록 채널) | `PHONE｜EMAIL｜VISIT｜OTHER` — **`ChannelType`이 아니다** | ✗ | ✗ | **✗**(O-10) | `InboxEntry(kind=RECORD)` |
| **SIMULATED**(시뮬레이션) | 가상 채널 = `ChannelType` 8종 라벨 중 1(`CONFIG_ONLY` 포함) | ✓(시뮬레이터 엔진) | ✗ | **✗**(O-10) | `InboxEntry(kind=SIM_USER｜SIM_BOT)` |

라벨·능력은 shared-types 상수 1곳(`CHANNEL_TYPE_LABELS`·`RECORD_CHANNEL_LABELS`·`CHANNEL_CAPABILITIES`) — NFR-OCM2.

### 5.2 어댑터 계약 확장 — `InboundTurn.identity?`

```ts
// conversation/adapters/channel-adapter.ts
export type InboundIdentity = { scheme: 'HOST_SIGNED_TOKEN'; token: string };   // 2차: { scheme: 'PLATFORM_USER'; platform; userKey } 추가 예정(카카오 봇별 사용자 키 등)
export interface InboundTurn { sessionId; message?; buttonAction?; state?; identity?: InboundIdentity }
normalizeInbound(raw: { sessionId; message?; buttonAction?; state?; identityToken?: string }): InboundTurn;
```

- WEB 어댑터는 `identityToken`이 **문자열이고 비어 있지 않을 때만** `identity` 키를 만든다 — 없으면 기존 `InboundTurn`과 키 집합이 같다(바이트 동일).
- 판별 유니온으로 둔 이유: 2차 외부 채널은 플랫폼이 보증한 사용자 키(서명 검증은 웹훅 요청 서명으로 대체)를 같은 필드로 싣는다. **검증은 어댑터가 아니라 식별 서비스**가 한다(비밀 접근 1파일 — FR-0-187).
- `inbound.identity`를 읽는 파일은 `public-conversation.service.ts`(①.5 1곳)뿐이다(O-14). 게이트·RAG·로그 경로는 `inbound`를 받지만 `identity`를 읽지 않는다.

### 5.3 공개 경로의 `'WEB'` 하드코딩 — 1차 무변경 · 2차 교체 지점 목록화

`public-conversation.service.ts`의 `getAdapter('WEB')`(149행) · 로그 `channelType: 'WEB'`(166·204·232·294·376행) · `channelOpen: true`(193행) · `public-access.service.ts`의 WEB 채널 조회(28~30행)는 **1차에서 바꾸지 않는다**.

- **근거**: 공개 파이프라인에 들어오는 채널은 WEB 하나뿐이고(수동 기록·시뮬레이션은 공개 경로를 타지 않는다), 두 번째 어댑터 없이 매개변수화하면 "소비자 없는 추상화"가 된다(ADR-0011 근거 88행과 같은 원칙). 식별 값은 채널 매개변수가 아니라 어댑터가 정규화한 `InboundTurn.identity?`로 들어오므로 하드코딩과 독립이다.
- **2차 외부 채널 ADR의 필수 교체 지점**(ADR-0042 재검토 트리거에 기록): ① `getAdapter('WEB')` → 경로·웹훅이 결정한 `ChannelType` ② 로그·설문 적재·업무 자동화의 `'WEB'` 6곳 → `adapter.type` ③ `PublicAccessService`의 채널 행 조회를 채널 매개변수로 ④ 상담 게이트 `channelOpen`을 `channelSupportsHandoff(type)` + 채널 활성으로 ⑤ No.41 봉투 `channel` enum 확장(§15.3) ⑥ 자격증명 저장 ADR(ADR-0011 118행).

### 5.4 C-4 — 채널 능력 표로 정리 (동작 불변)

`live-sessions.service.ts` 115행 `handoffSupported: agg.channelType === 'WEB'` → `handoffSupported: channelSupportsHandoff(agg.channelType)`. `CHANNEL_CAPABILITIES`는 `CHANNEL_IMPLEMENTATION`과 같은 **속성 표**라 ADR-0011 §3 "채널 타입 분기는 팩토리·`channel-config.ts` 2파일에만"의 **분기**가 아니다 — 표를 읽는 호출은 어디서나 허용하고, `=== 'WEB'` 같은 **리터럴 비교 분기**는 여전히 2파일 밖에서 금지한다(O-18 — `apps/api/src`의 `=== 'WEB'`·`'WEB' ===` 비교 0건, 팩토리·config·어댑터 파일 제외). 인박스도 같은 함수로 "이 세션에서 상담 개입 가능?"을 판정한다.

### 5.5 ADR-0011 "스텁 어댑터 파일 금지"와의 관계

| 항목 | 판단 |
|---|---|
| 시뮬레이션 채널 | **어댑터가 아니다** — 관리자 콘솔 기능이며 `ChannelAdapterFactory`에 분기·파일을 추가하지 않는다. 기존 시뮬레이터(`SimulationService.simulate`)를 호출하고 결과를 인박스 항목에만 쓴다. "가상 카카오톡"은 라벨일 뿐 카카오 규격을 흉내 내지 않는다 → 57행 규약(가짜 구현체로 "구현됐다"는 착시 금지)과 **충돌하지 않는다** — 화면은 모든 곳에서 "시뮬레이션" 텍스트 라벨을 붙인다(NFR-OCA3) |
| 기록 채널 | `ChannelType` 값 추가가 아니다(J-3 — 배포 채널 아님). `CHANNEL_IMPLEMENTATION`·채널 설정 화면·`409 CHANNEL_NOT_IMPLEMENTED` 불변 |
| `InboundTurn.identity?` | 계약 **확장**이며 소비자(WEB 어댑터 + 식별 서비스)가 오늘 존재한다 — ADR-0011 근거 88행("계약만 미리 만드는 것은 소비자가 있을 때") 충족 |
| 채널 설정 화면 안내(FR-OC1-5) | `CONFIG_ONLY` 채널 카드에 "실제 연동은 준비 중이며, 통합 인박스에서는 시뮬레이션으로 흐름을 시험할 수 있습니다" 문구만 추가(설정·409 불변) |

---

## 6. 고객 식별 (P-2 · J-5~J-7 · J-11)

### 6.1 토큰 형식 — JWS Compact · HS256 고정

```
x-cb-identity: <base64url(header)>.<base64url(payload)>.<base64url(signature)>      (≤ 2,048바이트)
header  { "alg": "HS256", "typ"?: "JWT", "kid"?: string }                         — alg 정확히 "HS256" · crit/jku/jwk/x5u/x5c 있으면 거부
payload { "sub": string, "iat": int, "exp": int, "nbf"?: int, "name"?: string, "aud"?: string }
sub     인쇄 가능 ASCII(0x21~0x7E) 1~128자 — 공백·한글·이모지 = MALFORMED(EX-OC-4)
aud     있으면 식별 공간 참조(REF)와 정확히 같아야 한다(다른 용도로 발급된 토큰 오용 방지) — 없어도 된다
name    표시 이름(≤40자로 절단 · 제어·양방향 제어 문자 제거) — 선택
signature HMAC-SHA256(OMNI_IDENTITY_SECRET__<REF>, ASCII(header "." payload))
```

- 표준 JWT를 택한 이유: 고객사 개발자가 흔한 라이브러리(`jsonwebtoken`·`PyJWT`·`jjwt`)로 만들 수 있다. **서버는 라이브러리를 쓰지 않는다** — HS256 하나만 받는 순수 함수(`node:crypto`)라 `alg` 혼동(`none`·RS/HS 치환) 공격면이 코드에 없다(O-16 — `jsonwebtoken`·`jose` 의존성 0).

### 6.2 검증 알고리즘 (`lib/verify-identity-token.ts` — 순수 · 시각·비밀 주입)

```ts
verifyIdentityToken(token: string, secrets: { current?: Buffer; previous?: Buffer; ref: string }, now: Date,
                    opts: { maxTtlSec: number; skewSec: number }):
  | { ok: true; sub: string; name?: string; iat: number; exp: number }
  | { ok: false; reason: IdentityFailureReason }
```

1. 비밀 없음(`current` 부재) → `SECRET_MISSING`.
2. 길이 > 2,048 · 점 2개가 아님 · 각 부분이 base64url 문자 집합(`[A-Za-z0-9_-]+`)이 아님 → `MALFORMED`.
3. 헤더 디코드(≤256바이트) · JSON · `alg === 'HS256'` · `typ` 있으면 `'JWT'` · 금지 키 없음 → 아니면 `MALFORMED`(`alg:none` 포함 — AC-OC2-3).
4. **서명 먼저**(페이로드 JSON을 파싱하기 전에): `HMAC(current, "h.p")`를 계산하고 서명을 디코드해 **길이 32 확인 후 `timingSafeEqual`**. 불일치면 `previous`로 1회 더. 둘 다 불일치 → `SIGNATURE`.
5. 페이로드 디코드(≤1,024바이트) · JSON · `sub` 패턴 · `iat`/`exp` 정수 · `exp > iat` · `aud` 규칙 → 아니면 `MALFORMED`.
6. 시각(초): `exp + skew < now` → `EXPIRED` · `iat > now + skew` 또는 `nbf > now + skew` → `NOT_YET_VALID` · `exp − iat > maxTtl` → `TTL_TOO_LONG`.
7. `name` 정리(§6.4 표시 이름 규칙은 저장 직전).

- 서명 비교는 **상수 시간**(NFR-OCS1) · 예외를 던지지 않는다(모든 실패 = 사유 반환) · 입력 토큰 문자열을 오류·로그로 내보내지 않는다.
- 시험 벡터: RFC 7515 부록 A.1(HS256) 예제로 서명 계산을 교차 검증하고, 연동 가이드의 Node/Python/Java 예시로 만든 토큰을 고정 픽스처로 둔다(AC-OC2-1 교차 확인).

### 6.3 비밀 · 식별 공간 · 참여

- 챗봇 설정 `identitySecretRef`(ADMIN · `security:write` · 감사)가 `OMNI_IDENTITY_SECRET__<REF>`를 가리킨다. **같은 참조를 쓰는 챗봇들 = 하나의 식별 공간**(서로의 고객을 공유) · 다른 참조 = 다른 고객사로 간주(같은 `sub`라도 다른 고객 — AC-OC2-2).
- 리졸버 상태: `NOT_SET`(참조 없음) · `MISSING`(참조는 있는데 환경변수 없음) · `WEAK`(32바이트 미만 — **검증에 쓰지 않는다**) · `CONFIGURED`. 콘솔은 상태만 표시한다(값·길이 0).
- **식별 검증은 참여 챗봇에서만** 한다(J-11) — 참여 판정은 `InboxParticipationCache`(전 참여 챗봇 스냅샷 1쿼리 · TTL 30초 · 설정 저장 시 같은 인스턴스 즉시 무효화 · 다른 인스턴스 ≤30초 — K-4).

### 6.4 고객 키 · 표시 이름

```
customerKey  = hex(HMAC-SHA256(OMNI_CUSTOMER_KEY_SECRET, "cb-omni-customer:v1\n" + REF + "\n" + sub))   // 64 hex
fingerprint  = hex(HMAC-SHA256(OMNI_CUSTOMER_KEY_SECRET, "cb-omni-fp:v1")).slice(0, 8)
```

- **솔트 = 식별 공간(테넌트) + 도메인 구분 태그 + 서버 비밀**. `\n` 구분자는 `sub`(0x21~0x7E)·REF 패턴에 나올 수 없어 입력이 모호하지 않다(`"A:B" + "C"` 충돌 방지). **챗봇 id는 넣지 않는다** — 넣으면 같은 공간의 여러 챗봇에서 같은 사람을 묶는다는 기능 목적 자체가 사라진다(`sessionRef`가 일부러 챗봇마다 다르게 만든 것과 반대 목적 — ADR-0036 §3의 설계 의도는 `sessionRef`에 그대로 남는다).
- 서버 비밀 없이 해시를 만들 수 없으므로 DB가 유출돼도 회원 번호 사전 대입(무작위 대입)으로 되돌리기 어렵다(단순 SHA-256 기각 사유 — ADR-0042).
- **표시 이름 저장 규칙**(`lib/display-name.ts` + `maskForInbox()`): NFC → 제어·양방향 제어 문자(U+202A~202E·U+2066~2069) 제거 → 40 코드포인트 절단 → **금지어 마스킹 → PII 마스킹**(`record()`와 같은 순서 — EX-OC-6 · 식별 서비스·고객 서비스가 수행) → store가 (모드 ON) `sealField('CUSTOMER_DISPLAY_NAME')`. 오른쪽→왼쪽 문자는 화면에서 `<bdi>`로 격리(EX-OC-5 — UI).
- 원 `sub`는 검증 함수의 지역 변수로만 존재하고 저장·로그·응답·감사에 나가지 않는다(AC-OC2-6 — 전수 grep 시험).

### 6.5 연결 흐름 (`InboxIdentityService.observe` — fire-and-forget)

```
observe({ chatbotId, sessionId, channelType, identity, now }): void
 0. OMNI_INBOX_ENABLED=false → 반환
 1. 참여 캐시: 비참여 → 반환(메모리 · DB 0)
 2. 세션 식별 캐시(chatbotId:sessionId) 적중 → 반환(LRU 20,000 · 30분)
 3. 토큰 지문(sha256(token) 앞 16 hex — 메모리 전용) 실패 캐시 적중 → 반환(같은 세션·같은 토큰 재계수 방지)
 4. 동기 검증(§6.2) — 실패 = 카운터 +1 · 실패 캐시 기록 · 반환
 5. 비동기(Promise 집합 등록): store.linkIdentity({ chatbotId, sessionId, sessionRef, channelType, spaceRef, customerKey, fingerprint, displayName?: MaskedText, now })
    결과 LINKED｜ALREADY｜PROMOTED｜CONFLICT｜BLOCKED → 세션 식별 캐시 기록(CONFLICT는 카운터 +1)
    예외 = 경고 로그(chatbotId·오류 코드만) — 응답에는 이미 영향 없음(NFR-OCR1)
```

`store.linkIdentity` — 한 트랜잭션:

1. 고객: `customerKeyHash`로 조회 → 없으면 `IDENTIFIED` 생성(`ref` 난수 16 hex · P2002 = 동시 생성 → 재조회). 있으면 `lastActivityAt` 갱신 · `name`이 있고 다르면 표시 이름 갱신(마지막 값 — FR-OC2-7) · `keyFingerprint` 갱신.
2. 세션 연결(`chatbotId, sessionId` 유일):
   - 없음 → `IDENTITY` 연결 생성(`identityVerifiedAt = now`) — **LINKED**. P2002(두 탭 동시 첫 턴 — NFR-OCR3) → 재조회 후 아래 규칙.
   - 같은 식별 고객 → `identityVerifiedAt` 채움 — **ALREADY**.
   - `identityBlockedAt` 있음 → 아무것도 하지 않음 — **BLOCKED**(ADMIN 분리 — §7.3).
   - **익명 고객**(`ANONYMOUS` · `ACTIVE`)에 연결됨 → **승격 병합**(§7.4) — **PROMOTED**.
   - 다른 식별 고객 → 변경 0 — **CONFLICT**(FR-OC2-6 · AC-OC2-5).
3. 식별 고객의 스레드가 있으면 `lastActivityAt`·`lastActivityKind=CONVERSATION`·최근 채널/챗봇만 갱신 — **상태는 바꾸지 않는다**(J-16 · AC-OC4-3).

- 쿼리 수: 신규 세션 = 고객 조회 1 + (생성 1) + 연결 조회 1 + 연결 생성 1 + (스레드 갱신 1) ≈ 3~5 · 응답 경로 밖.
- `drainForTest()`(운영 코드 호출 0 — O-13)로 통합 시험이 적재를 결정적으로 기다린다.

### 6.6 검증 실패 시 동작

- **최종 사용자에게 차이가 없다**: 응답 바이트·상태 코드·지연(비동기)·레이트리밋 판정 모두 토큰 없음과 같다(AC-OC2-3 · S-5 — 공격자는 성공 여부를 알 수 없다).
- 계수: `IdentityFailureCounter` — (챗봇, 사유)별 1시간 버킷 24개 링(인스턴스 로컬). 설정 화면 `stats24h`에 "이 서버 기준" 표기(`scope: 'INSTANCE'` — 다중 인스턴스는 서버별 · K-5). 성공 수도 같은 방식.
- 경고 로그: (챗봇, 사유)당 10분에 1줄 — `chatbotId`·사유 코드·10분 누적 수만(토큰·`sub`·이름·지문 0 — O-7).
- 새 레이트리밋 버킷 0(NFR-OCS5) — 검증은 미연결 세션에서만 일어나고 실패 캐시가 반복을 흡수하며, 요청 자체는 기존 `ip`·`session` 버킷이 제한한다.

### 6.7 재생 · 만료 처리

| 위협 | 1차 처리 | 잔여 위험(수용) |
|---|---|---|
| 만료 토큰 재사용 | `exp + 300초` 초과 거부 · 최대 수명 24시간(권장 1시간 — 연동 가이드) | — |
| 유효 기간 내 **토큰 탈취·재생**(다른 브라우저에서 같은 토큰) | 서명·만료 외 추가 판정 없음(서버에 `jti` 저장소를 두지 않는다 — 세션당 1회 검증이라 재생 흔적을 남길 곳이 연결 행뿐). 재생의 효과 = **공격자의 대화가 피해자 스레드에 섞여 상담원에게 보이는 것뿐** — 식별은 봇 응답·위젯 이력·권한에 쓰이지 않아(J-7) 공격자가 얻는 정보 0 | 오염된 연결은 **ADMIN 분리**(§7.3)로 제거하고 그 세션의 이후 토큰을 무시한다. 재생 흔적(같은 고객에 짧은 시간 여러 세션)은 2차 탐지(K-2) |
| 로그인 전환(탭 안에서 A → B) | 연결 불변 + `CONFLICT` 계수 · 위젯이 새 `sessionId`로 새 대화(§6.8) | 구버전 위젯은 CONFLICT만(EX-OC-3) |
| 만료 직전 첫 턴 | 첫 턴 검증 성공 → 연결 유지(이후 만료 무관 — EX-OC-1) | — |
| 시계 오차 | ±300초(설정) · 미래 `iat`/`nbf` 300초 초과 거부 | 호스트 서버 시계가 5분 넘게 틀리면 전부 실패 — 설정 화면 사유 분포로 드러난다 |
| 서명 비밀 교체 | `__PREV` 병행 검증 → 호스트 전환 후 `__PREV` 제거 | — |

### 6.8 위젯 전달 방식

- **입력 2종**: ① 임베드 속성 `data-identity-token="<토큰>"`(서버 렌더 페이지 — 부팅 시 1회 읽음) ② JS 호출 `window.__ChatBotWidget.identify(tokenOrNull)`(SPA · 로그인/로그아웃 시점 — **전역 심볼은 여전히 1개**, EX-W-3). 둘 다 있으면 JS 호출이 이긴다.
- **보관**: `sessionStorage` 별도 키 `cb.idt.{slug}`(봉투·`cb.state`·상담 토큰 키와 분리 — ADR-0009 §3 · 상담 토큰 선례). 호스트 쿠키·localStorage 미사용(NFR-S8). 저장소 불가 시 메모리.
- **전송**: `POST …/messages`에만 헤더 `x-cb-identity`(토큰이 있을 때만 — 없으면 요청 바이트 불변). 폴링·평가·상담 폴링에는 싣지 않는다.
- **`sub` 변경 규칙**(위젯은 서명을 검증하지 않고 페이로드의 `sub`만 비교용으로 디코드): 이전 `sub`가 있었는데 새 값이 다르거나 `null`(로그아웃)이면 **새 대화** — `cb.sid`·`cb.state`·상담 토큰 키를 지우고 새 `sessionId`를 만든 뒤 상태 영역에 "새 대화를 시작했어요" 1회 안내(공용 PC에서 다음 사람이 이전 회원의 세션을 잇지 않게). 이전 `sub`가 없었고 새 토큰이 오면(로그인) **세션 유지** — 서버가 익명 → 식별 승격을 처리한다(R-8).
- 번들 예산: gzip +1.5KB 이하(ADR-0012 게이트 100KB 유지).

---

## 7. 고객 · 연결 · 병합/분리 — 상태 기계와 동시성 (P-6 · J-13 · J-14)

### 7.1 고객 상태

```
IDENTIFIED/ANONYMOUS: ACTIVE ──(병합의 원본)──▶ MERGED ──(되돌리기)──▶ ACTIVE
TEST: ACTIVE ──(삭제)──▶ (행 삭제 — 시험 데이터)
보존 소거(CUSTOMER_IDENTITY): 상태는 그대로 · customerKeyHash/displayName/keyFingerprint → null · identityPurgedAt
```

### 7.2 연결 규칙 (`lib/link-rule.ts` — 순수)

| 요청 | 조건 | 결과 |
|---|---|---|
| 수동 연결 `POST /inbox/customers/:customerId/links {chatbotId, sessionRef}` | 대상 고객 `ACTIVE`·비`TEST`·비소거 · 챗봇 참여 중 · `sessionRef` 해석 성공 | 연결 없음 → `MANUAL` 생성 · 같은 고객 → 200(변경 0) · 다른 고객의 `SYSTEM`/`MANUAL` → **재지정**(`previousCustomerId`·`previousSource` 기록) · `IDENTITY` → `409 CUSTOMER_LINK_LOCKED`(FR-OC3-3) |
| 분리 `DELETE …/links/:linkId` | 연결의 현재 고객 = 경로 고객 | `MANUAL` → 이전 연결로 복귀(이전 고객이 `ACTIVE`가 아니면 행 삭제) · `SYSTEM` → 행 삭제(세션이 미연결로 돌아간다) · `IDENTITY` → **ADMIN만**(§7.3) · 아니면 `409 CUSTOMER_LINK_LOCKED` |

- **`sessionRef` 해석**(`read/session-ref-lookup.ts`): ① `CustomerLink(chatbotId, sessionRef)` ② `HandoffSession(chatbotId, sessionRef)` ③ 최근 **24시간** 로그의 distinct `sessionId`(최대 5,000)를 `computeSessionRef()`로 대조 → 없으면 `404 NOT_FOUND`. LRU(5,000·30분). 해시 함수는 `handoff/lib/session-ref.ts` 1벌이며 조회 쿼리만 인박스 소유다(제약 ③).
- 연결·분리는 `ConversationLog`·`HandoffSession`·`HandoffMessage`를 **수정하지 않는다**(FR-OC3-6 · AC-OC3-1 — O-10).
- 기록: 대상 스레드에 `SYSTEM` 항목(`LINKED`/`UNLINKED` · 챗봇 id·`sessionRef`·출처) + 감사 1건(§12).

### 7.3 `IDENTITY` 연결 분리 = ADMIN 전용 (R-11 ⚠)

요구사항 FR-OC3-4는 "`IDENTITY` 연결은 분리할 수 없다"이지만, 토큰 재생(§6.7)·호스트 쪽 발급 실수로 **잘못된 서명 연결을 되돌릴 수단이 전혀 없는 상태**는 운영 위험이다. 그래서 `cs:write` 사용자는 여전히 `409`, **ADMIN만(서비스 재검증 — 강제 인수 선례)** 분리할 수 있고 결과는: 세션을 **새 익명 고객**으로 옮김(`source=MANUAL`) + `identityBlockedAt = now`(이후 이 세션의 식별 토큰 무시 — `BLOCKED`) + `SYSTEM` 항목 `IDENTITY_BLOCKED` + 감사. PM 확인 사항이다.

### 7.4 병합 규칙 (`lib/merge-rule.ts` — 순수) · 승격

| 원본 → 대상 | 허용 | 오류 |
|---|---|---|
| ANONYMOUS → IDENTIFIED | ✓ | — |
| ANONYMOUS → ANONYMOUS | ✓ | — |
| IDENTIFIED → * | ✗(방향을 바꿔 병합하라는 안내) | `409 CUSTOMER_MERGE_FORBIDDEN` |
| IDENTIFIED ↔ IDENTIFIED | ✗(서로 다른 로그인 회원 — AC-OC3-2 · S-4) | 〃 |
| TEST 관련 전부 | ✗(AC-OC5-3) | 〃 |
| 원본/대상 `MERGED` · 대상 식별 소거(EX-OC-14) · 자기 자신 | ✗ | 〃 |

**병합 트랜잭션**(store 1메서드 — 수동·승격 공용):

1. CAS: 원본 `updateMany where { id, status: 'ACTIVE' } → MERGED, mergedIntoId` — 영향 0 = `409 CUSTOMER_MERGE_FORBIDDEN`(경합). 대상 `ACTIVE` 재확인(같은 트랜잭션).
2. 연결 이동: 원본의 연결 id 목록을 읽고 `updateMany where { customerId: 원본 } → 대상`.
3. 스레드: 대상에 스레드가 없으면 **원본 스레드를 통째로 옮김**(`customerId` 재지정 · `movedThread=true`). 둘 다 있으면 원본 항목을 대상 스레드로 이동(`movedEntryIds`) · 대상에 없는 태그 추가(`addedTagIds` — 합계 10 초과분은 추가하지 않고 결과 `droppedTags`로 알림) · 원본 스레드 `hiddenByMergeId` + 이전 상태 기록 · 대상 `lastActivityAt = max`.
4. `CustomerMerge` 행 · 대상 스레드 `SYSTEM` 항목(`MERGED_IN` 또는 `PROMOTED` — 원본 별칭).
5. 커밋 후 감사(`STATUS_CHANGE` · 대상 = 원본 고객 · 요약 "병합: #src → #tgt" — 별칭만).

**승격**(§6.5 — 로그인 전 익명 스레드가 열린 세션에 유효 토큰): 같은 트랜잭션 메서드를 `kind=IDENTITY_PROMOTION`·주체 system으로 호출하고 세션 연결에 `identityVerifiedAt`을 채운다. 익명 고객에 상담원이 수동 연결해 둔 다른 세션·전화 기록도 함께 옮겨진다(상담원의 "같은 사람" 판단을 존중). 되돌리기는 ADMIN만.

### 7.5 되돌리기 (`POST /inbox/merges/:mergeId/revert`)

- 권한: `cs:write` + (ADMIN ∨ (병합 수행자 본인 ∧ `mergedAt + OMNI_MERGE_REVERT_HOURS` 이내)) · 승격 병합은 ADMIN만 · 아니면 `403 FORBIDDEN` / 기한 경과 `409 CUSTOMER_MERGE_NOT_REVERTIBLE`.
- 조건: `revertedAt` 없음(CAS) · 대상 고객이 아직 `ACTIVE`(대상이 그 뒤 다른 고객으로 병합됐으면 **역순으로 되돌려야 한다** — `409 CUSTOMER_MERGE_NOT_REVERTIBLE`).
- 트랜잭션: 원본 `MERGED → ACTIVE` CAS · 연결 `updateMany where { id in movedLinkIds, customerId: 대상 } → 원본`(그 사이 다시 옮겨진 연결은 건너뜀 → `skippedLinks`) · 항목 `id in movedEntryIds ∧ threadId = 대상 스레드` → 원본 스레드 · `movedThread`면 스레드 `customerId` 복귀 · `addedTagIds` 제거 · 원본 스레드 숨김 해제 + 이전 상태 복원 · `SYSTEM` 항목 `MERGE_REVERTED`(양쪽) · 감사 1건(AC-OC3-3).

### 7.6 동시성 정리

| 경합 | 장치 |
|---|---|
| 같은 세션 두 탭 첫 턴(식별) | `CustomerLink @@unique(chatbotId, sessionId)` P2002 → 재조회(NFR-OCR3) |
| 같은 회원 두 챗봇 동시 첫 턴 | `Customer.customerKeyHash @unique` P2002 → 재조회 |
| 식별 적재 ∥ 상담 시작(익명 고객 생성) | 둘 다 연결 유일 키 경합 → 뒤에 온 쪽이 재조회 후 규칙 적용(식별이 늦으면 승격 병합, 상담 신호가 늦으면 기존 연결 사용) |
| 병합 ∥ 병합 · 병합 ∥ 되돌리기 | 원본 상태 CAS + 병합 행 `revertedAt` CAS · SQLite 쓰기 직렬화(Postgres 전환 시 `Serializable` 지정 대상 — 재검토 트리거) |
| 가져가기 ∥ 가져가기 | `updateMany where { id, assigneeUserId: null, hiddenByMergeId: null }` 영향 0 = `409 INBOX_THREAD_CONFLICT`(AC-OC4-4) |
| 상태·지정·놓기·태그 ∥ 다른 편집 | 요청의 `version`과 CAS(`updateMany where { id, version } … version+1`) — 불일치 `409 INBOX_THREAD_CONFLICT`(콘솔은 새로고침 안내) |
| 신호(열림) ∥ 사람 편집 | 신호는 `version`을 요구하지 않는 조건부 갱신(열림 조건: 상태 ∈ 허용 집합)이며 반영 시 `version+1` — 사람의 다음 CAS가 실패해 최신 상태를 보게 된다 |

---

## 8. 스레드 (P-3 · P-7 · J-14~J-16)

### 8.1 신호 포트 · 스레드가 열리는 조건

```ts
// common/inbox/inbox-signal.port.ts
export const INBOX_SIGNAL_SINK = 'INBOX_SIGNAL_SINK';
export type InboxSignal =
  | { signal: 'HANDOFF_OPENED'; chatbotId: string; sessionId: string; sessionRef: string; channelType: string; handoffId: string; agentUserId: string; agentUserName: string; occurredAt: Date }
  | { signal: 'TURN_RECORDED'; chatbotId: string; sessionId: string; channelType: string; isAnswered: boolean; blockedByFilter: boolean; surveyTurn: boolean; handoffTurn: boolean; occurredAt: Date };
/** 동기 반환 · 예외 없음 · 내부 비동기. sessionId는 프로세스 안에서만 쓰인다. */
export interface InboxSignalSink { signal(s: InboxSignal): void }
```

| 조건(J-16) | 원천 · 위치 | 1회 근거 | 결과 |
|---|---|---|---|
| ① 상담 시작 | `handoff-thread.service.ts` `createHandoff` — 트랜잭션 **성공 뒤**(No.41 emit 다음 줄) | 부분 유니크 + 트랜잭션 성공 1회 | 연결 없으면 **익명 고객 + `SYSTEM` 연결** 생성 → 스레드 생성/열림 · 담당 없으면 개입 상담원(FR-OC4-6) |
| ② 경고 단계 도달 | `conversation-log.service.ts` `record` — 적재·수집기·No.41 emit 뒤 | 연결 행 `warningOpenedAt` CAS(세션당 1회 — AC-OC4-2) | `openOnWarning` 참여 챗봇 · 중립 아님 · 미응답일 때만 최근 30행 조회 → `evaluateSessionAlert()`(No.24 1벌 · 임계 = 챗봇 상담 설정, 없으면 2/3) → `WARNING`이면 ①과 같은 열림 |
| ③ 수동 기록·메모 | 관리 API | 요청 1회 | 스레드 생성/열림 |
| ④ 상담원이 직접 열기 | `POST /inbox/threads/open {chatbotId, sessionRef}`(콘솔 대화 보기) · `POST /inbox/customers`(새 익명 고객) | 요청 1회 | 〃(`openReason=MANUAL`) |
| (시뮬레이션) | 시험 고객 생성 시 | — | 스레드 생성(`SIMULATION`) |

- **재열림 규칙**(`lib/open-rule.ts` — R-15): 고객 쪽 사건(①②)은 `CLOSED`·`PENDING` → `OPEN`(보류 해제 시각 삭제), 상담원 쪽 사건(③④)은 `CLOSED` → `OPEN`만(`PENDING`은 유지 — 직원이 메모를 남겼다고 보류가 풀리지 않는다). 식별 고객의 새 봇 대화만으로는 상태를 바꾸지 않는다(AC-OC4-3). 신호는 **참여 챗봇에서만** 처리한다(비참여 = 캐시 확인 후 반환 · DB 0).
- **커밋 후 · fire-and-forget**: 원천 트랜잭션·쓰기 데이터·반환·예외 경로 불변(봉인 H-2·H-3·H-7·W-16 불변). 신호 처리 실패는 경고 로그만 — 개입 응답·대화 응답에 영향 0(AC-OC4-1 · NFR-OCR1). 발행 전 강제 종료 시 그 열림은 유실된다(K-7 — 다음 사건이나 상담원 "직접 열기"로 회복).
- `@Optional()` 주입 — 기존 spec이 생성자를 인자 없이 호출해도 no-op.

### 8.2 상태 기계 (`lib/thread-state.ts` — 순수)

```
            ┌──── 사람(cs:write) ────┐
   OPEN ◀──▶ PENDING(snoozeUntil?) ◀──▶ CLOSED
     ▲            │ snoozeUntil ≤ now → 조회 시 OPEN으로 판정(effective) · 다음 쓰기에서 확정
     └── 신호①② / ③④(CLOSED에서) ──┘
```

- 전이는 셋 모두 상호 가능(`cs:write`) · `PENDING`의 `snoozeUntil`은 선택(미래 · ≤30일) · 상태 변경 = 감사(`STATUS_CHANGE` · `InboxThread`) + `SYSTEM` 항목.
- **보류 해제 — 새 루프 0**(FR-0-193): 목록·요약·상세는 `effectiveStatus(row, now)`로 판정하고(`snoozeExpired: true` 표시), 목록 필터는 SQL 조건으로 같은 판정을 표현한다(`OPEN` = `status=OPEN ∨ (status=PENDING ∧ snoozeUntil ≤ now)` · `PENDING` = `status=PENDING ∧ (snoozeUntil IS NULL ∨ snoozeUntil > now)`). **확정**은 그 스레드의 다음 쓰기(사람 편집·신호·항목 추가)가 같은 `updateMany`의 데이터로 `status=OPEN, snoozeUntil=null`을 함께 쓴다(AC-OC4-5).
- 병합으로 숨겨진 스레드(`hiddenByMergeId`)는 목록·요약에서 제외되고 편집은 `409 INBOX_THREAD_CONFLICT`.

### 8.3 담당 · 태그 · 메모 · 기록

- **담당**: 스레드당 1명(없을 수 있음). 가져가기(없을 때만 · CAS) · 지정(대상 = `ACTIVE` 사용자 ∧ 역할 권한에 `cs:write` — `ROLE_PERMISSIONS`로 판정 · `version` CAS) · 놓기(담당자 본인 또는 ADMIN). 변경 = 감사(`UPDATE` · "담당 변경: 없음 → 김상담"). **스레드 담당 ≠ 상담 담당**(`HandoffSession.assignedUserId`) — 상담 잠금 규약 불변(J-9). 비활성 계정 담당은 "비활성" 배지 · 가져가기 불가 → 지정으로 교체(EX-OC-12).
- **태그**: 전역 목록(ADMIN 생성·수정·삭제 — 가드 `cs:write` + 서비스 역할 재검증 · 이름 ≤20자 정규화 유일 · 팔레트 색 · ≤100). 스레드 부착 `PUT …/tags`(≤10 · `version` CAS) = 감사 아님(`SYSTEM` 항목 `TAGS`). 사용 중 태그 삭제는 `?force=true`(`queryBoolean`)가 있어야 하며 모든 스레드에서 제거 후 삭제 + 감사 1건(EX-OC-13). `force` 없이 사용 중 태그를 지우면 `400 VALIDATION_FAILED`(details `inUseCount` — 콘솔이 확인 창을 띄운다).
- **메모**(FR-OC5-6): 2,000자 · 저장 = `maskForInbox()`(`maskPii()` 1벌 · `PII_MASK_MODE` — `MaskedText` 브랜드 생성 유일 지점) → store가 `sealField` · 금지어 필터 비적용(내부 기록 — FR-OC6-2) · 수정 = 작성자 본인 10분 이내(`editedAt`) · 삭제 없음(보존 소거만) · 미리보기 `POST /inbox/mask-preview`(전역 — 같은 함수).
- **수동 기록**(FR-OC6-1): 기록 채널·방향·발생 시각(`now − 7일 ≤ t ≤ now + 60초` — 밖이면 `400 VALIDATION_FAILED` · EX-OC-15)·요약 4,000자·결과 코드. 같은 마스킹·암호화. 외부 발송 0(FR-OC6-3 — 인박스에 출구 파일이 없다 · O-12).
- 메모·기록 작성은 감사가 아니다(업무 데이터 — 작성자·시각은 행에 남는다 · FR-OC9-7).

---

## 9. 인박스 목록 · 상세 · 고객 카드 · 타임라인

### 9.1 목록 쿼리 계획 (`GET /inbox/threads` — NFR-OCP1 P95 ≤500ms · 스레드 1만 · 참여 챗봇 20)

| # | 쿼리 | 인덱스 |
|---|---|---|
| 1 | `inboxThread.findMany({ where: 유효 상태 조건 ∧ hiddenByMergeId null ∧ 담당 ∧ 기간 ∧ customer.kind(관계 필터 — 기본 TEST 제외) ∧ tags.some ∧ (chatbotIds → customer.links.some) ∧ (activeHandoff → customerId in 집합), orderBy lastActivityAt desc, include { customer(ref·kind·displayName·identityPurgedAt), tags.tag }, take pageSize })` | `(status, lastActivityAt)`·`(assigneeUserId, status, lastActivityAt)`·`(lastActivityAt)` · 링크 `(customerId, linkedAt)` |
| 2 | 같은 조건 `count` | 〃 |
| 3 | `customerLink.groupBy({ by: customerId, where: { customerId in 페이지, chatbotId in 참여 } })` — 연결 대화 수 | `(customerId, linkedAt)` |
| 4 | 활성 상담 `handoffSession.findMany({ where: status in [CONNECTING, CONNECTED], chatbotId in 참여 }, select chatbotId·sessionId)`(전역 활성 수는 작다 — 수백) | `(chatbotId, status)` |
| 5 | 페이지 고객의 연결(4와 교차 — 진행 중 상담 수) | `(customerId, linkedAt)` |
| 6 | 마지막 항목 미리보기 `inboxEntry.findMany({ where: id in lastEntryIds, select text·textPurgedAt })` → 리더 개봉 · 60자 | PK |
| 7 | 담당자 활성 여부 `user.findMany({ where: id in 담당 id })` | PK |

- 챗봇 이름·참여 목록은 참여 캐시에서(쿼리 0). 별칭 = 페이지 `ref` 목록에 `assignAliases()`(No.24 1벌).
- **로그 전체 집계를 하지 않는다**(C-5) — 로그는 상세에서 연결 세션 단위로만 읽는다.
- `activeHandoff=true` 필터: 4 → 교차 세션의 고객 id 집합을 먼저 만들어 1의 `customerId in`에 넣는다.
- **요약**(`GET /inbox/threads/summary` — P95 ≤300ms): 유효 상태별 `count` 2 + 내 담당 1 + 담당 없음 1 + 진행 중 상담(4·5 재사용) — 쿼리 ≤6.

### 9.2 상세 · 타임라인 (`GET /inbox/threads/:threadId?cursor=` — NFR-OCP2 P95 ≤800ms · 연결 대화 50 · 대화당 100턴)

**타임라인 단위** = 대화 1개(연결된 세션) 또는 항목 1개. 페이지 = `before` 시각(커서) 이전의 **최근 50단위**:

1. 스레드 + 고객 1 · 연결 최근 50(`linkedAt < before`, 참여 챗봇만 — FR-OC5-4) 1 · 항목 최근 50(`occurredAt < before`) 1 → 시각 역순 병합 → 50단위 → `nextCursor` = 마지막 단위 시각(동률은 id).
2. 페이지 안 대화 단위의 로그: 챗봇별 `conversationLog.findMany({ where: { chatbotId, sessionId in [...] }, orderBy createdAt, select 표시 필드 })`(인덱스 `(chatbotId, sessionId, createdAt)` · 챗봇 수만큼 ≤20) — 세션당 200턴 상한(`truncated`).
3. 상담: `handoffSession.findMany({ where: OR (chatbotId, sessionId) 쌍 })` 1 + `handoffMessage.findMany({ where: handoffSessionId in, select id·seq·sender·text·textPurgedAt·createdAt })` 1 — **`rawText`를 선택하지 않는다**(H-5 · O-10). `text`는 리더가 `HANDOFF_TEXT`로 개봉(거버넌스 암호화 시).
4. 항목 텍스트 개봉(리더) · 시스템 항목 `meta` 파싱.

- 원문 표시는 기존 대화 보기(진행 중 상담 · 담당자·ADMIN) 1곳뿐 — 스레드는 **마스킹본만**(C-6 · AC-OC4-8). 진행 중 상담이 있으면 상단 "진행 중 상담 N건 → 상담 콘솔" 링크(FR-OC5-5 · EX-OC-7).
- 소거된 텍스트는 `purged: true`와 빈 문자열(화면 "(보존기간 경과로 삭제됨)") · 수치·시각 유지(FR-OC5-3).
- 페이지 1은 상세 응답에 포함, 다음 페이지는 같은 경로의 `cursor`로(열람 감사 대상 핸들러 1개 — §12.2).

### 9.3 고객 카드 (`lib/build-customer-card.ts` — 순수 · 텍스트 생성 0 · FR-OC5-1)

```ts
CustomerCard = {
  conversations: { total, byChannel: {type,label,count}[], byChatbot: {id,name,count}[] },
  firstActivityAt, lastActivityAt,
  topMatches: { kind: 'INTENT'|'FAQ', id, name /* 삭제 = "(삭제된 항목)" */, count }[≤3],
  unansweredTurns,
  handoffs: { count, lastEndReason?, lastAgentName?, lastEndedAt? },
  surveysCompleted, negativeFeedbacks,
  tags: {id,name,color}[], latestNote?: { text /* 마스킹본 */, authorName, at },
  truncated?: true   // 연결 세션 200 초과 — 최근 200 세션 기준
}
```

- 원천(참여 챗봇 연결 세션 최근 200): 로그 `groupBy`(챗봇별 — `matchedIntentId`·`matchedFaqId`·`isAnswered` 계수) · 의도/FAQ 이름 조회 2 · `handoffSession` 집계 1 · `surveyResponse.count({ status: COMPLETED, (chatbotId, sessionId) 쌍 })` 1 · `messageFeedback.count({ rating: DOWN, conversationLogId in 로그 id })`(제약 ⑨) 1. 쿼리 수는 챗봇 수에 비례하고 세션 수와 무관(N+1 없음).
- **"컨텍스트 유지"는 상담원 화면에서만**(P-4) — 봇 응답·봉투·엔진 입력에 카드 값이 들어가지 않는다(O-9).

### 9.4 고객 검색 (`POST /inbox/customers/search` — NFR-OCP4 P95 ≤1s)

- **POST인 이유**: 회원 번호가 URL·접근 로그·브라우저 기록에 남지 않게(R-13).
- `memberId` + `identitySpaceRef`: 고객 키 계산 → `customerKeyHash` 정확 일치(AC-OC3-5) · 응답에 회원 번호 없음. 고객 키 비밀이 없으면 `400 VALIDATION_FAILED`("서버에 고객 키 비밀이 설정되지 않았습니다").
- `q`: `^[0-9a-f]{4,16}$`이면 `ref` 접두 일치(별칭 검색) ∪ 이름 부분 일치 · 그 밖은 이름 부분 일치 — 이름은 **최근 활동 순 `OMNI_NAME_SEARCH_SCAN_LIMIT`명**의 `displayName`을 리더가 개봉해 메모리에서 비교(암호문은 DB `LIKE` 불가 · 평문·암호문 혼재도 같은 경로) · `truncatedScan` 표시.
- 결과는 전역(참여 여부와 무관 — 스레드·기록은 챗봇에 매이지 않는다) · 기본 `TEST` 제외 · ≤50건.

---

## 10. 수동 기록 · 시뮬레이션 — 데이터 경로 분리 (P-1 · C-8 · FR-0-184)

### 10.1 쓰지 않는 곳 (구조적 보장)

| 저장소 | 수동 기록 | 시뮬레이션 | 보장 장치 |
|---|---|---|---|
| `ConversationLog` | 0 | 0 | 인박스 모듈이 `ConversationLogService`를 주입하지 않는다 · `SimulationService`는 원래 로그를 쓰지 않는다(FR-0-21) · O-10(`conversationLog.create` 호출 파일 불변) |
| `UnansweredQuestion` · 학습 큐 | 0 | 0 | 수집기는 `record()` 안에서만 호출(ADR-0019) |
| `MessageFeedback` · 통계 원천 | 0 | 0 | 쓰기 파일 봉인(F-·R-) 불변 |
| `WorkflowRun`(No.41) | 0 | 0 | 인박스는 `WORKFLOW_EVENT_SINK`를 주입하지 않는다 · 시뮬레이터의 `workflowSteps`는 모의 표시뿐 |
| `HandoffSession`·`HandoffMessage` | 0 | 0 | H-2 불변 |
| 외부 출구 | 0 | RAG·레거시 실호출 0(요청이 `useRag=false`·`apiMode=MOCK` 고정) | 출구 레지스트리·G-1 불변 |

→ 대시보드·질문 순위·학습현황·만족도·업무 자동화 발송함 **증가 0**(AC-OC5-2).

### 10.2 시뮬레이션 흐름 (`POST /inbox/test-customers/:customerId/simulate`)

1. 고객 `TEST` 확인 · 챗봇 참여 확인(아니면 `400 VALIDATION_FAILED`).
2. `SimulationService.simulate(chatbotId, { message|buttonAction, state, target, useRag: false, apiMode: 'MOCK', surveyPreview: false, includeInactiveTopics: false }, actor)` — **기존 시뮬레이터 엔진 경로 1벌**(`SimulationModule` export 1줄 — 제약 ④). 서빙 버전 없음 등 시뮬레이터 오류는 그대로 전달하고 항목 0건(EX-OC-16).
3. 사용자 입력·봇 출력 텍스트(`buildBotResponseText(outputs)` — `conversation/lib` 순수 함수 파일 import)를 `maskForInbox()`로 마스킹해 `SIM_USER`·`SIM_BOT` 항목 2건으로 저장(가상 채널·챗봇 id) — 스레드 최근 채널 = `SIMULATED/<type>`.
4. 응답: `outputs`(격하 미리보기 없음 — 채널별 지원 목록 미정의 · `degradePreview: 'NOT_DEFINED'` · No.46 착수 시 `degradeOutputs(outputs, 지원 목록)`로 교체 — R-18) · `state`(다음 봉투) · 저장된 항목 2건.

- **봉투는 서버에 저장하지 않는다**(R-17): 콘솔이 메모리에 들고 다음 요청의 `state`로 보낸다(ADR-0009 결정 1 · 슬롯 원문을 DB에 남기지 않는다). 새로고침하면 새 대화로 시작한다.
- 시험 고객 삭제(`DELETE`): 항목·태그 연결·스레드·고객 행 삭제(store — 시험 데이터 · 보존 대상 아님) + 감사 `DELETE Customer`(AC-OC5-4). 실제 고객과 병합·연결 불가(§7).

---

## 11. 권한 (P-8 — 신규 권한·역할 0)

| 동작 | 가드 | 서비스 재검증 | VIEWER | EDITOR | AGENT | ADMIN |
|---|---|---|---|---|---|---|
| 인박스 목록·요약·상세·고객 검색·세션 연결 조회·식별 공간·담당 후보·태그 목록 | `cs:read` | — | ✗ | ✓ | ✓ | ✓ |
| 상태·지정·가져가기·놓기·태그 부착·메모·기록·세션에서 열기·새 익명 고객·수동 연결·분리(`MANUAL`/`SYSTEM`)·병합·마스킹 미리보기 | `cs:write` | 놓기 = 담당자·ADMIN · 메모 수정 = 작성자 10분 | ✗ | ✗ | ✓ | ✓ |
| 병합 되돌리기 | `cs:write` | ADMIN ∨ 수행자 24시간(승격 = ADMIN) | ✗ | ✗ | 본인 병합만 | ✓ |
| `IDENTITY` 연결 분리 | `cs:write` | 역할 ADMIN | ✗ | ✗ | ✗ | ✓ |
| 태그 목록 생성·수정·삭제 | `cs:write` | 역할 ADMIN | ✗ | ✗ | ✗ | ✓ |
| 시험 고객 생성·삭제·시뮬레이션 | `simulation:write` AND `cs:read` | — | ✗ | ✓ | ✗ | ✓ |
| 챗봇 인박스 설정 조회 | `chatbot:read` | — | ✓ | ✓ | ✓ | ✓ |
| 설정 저장(참여·경고 열기) | `chatbot:write` | `ARCHIVED` = 409 | ✗ | ✓ | ✗ | ✓ |
| 식별 비밀 참조 지정 | `security:write` | — | ✗ | ✗ | ✗ | ✓ |

- `@RequirePermission` AND 조합(No.25) · 역할 전역(챗봇별 상담원 가시성 제한은 멀티테넌시 그룹 — T-6) · `Permission` 18·역할 4 불변(`permission-matrix.spec.ts` 불변).
- AC-OC4-7: AGENT 조회·처리 ✓ · 태그 목록 변경 `403` · 식별 참조 변경 `403` · VIEWER 인박스 `403`.

## 12. 감사 · 열람 감사 (ADR-0016 규약 — 커밋 후 · 화이트리스트 · 실패 흡수)

### 12.1 쓰기 감사

| 동작 | `AuditAction` | `AuditTargetType` | 요약(별칭만 — 이름·회원 번호·본문 0) |
|---|---|---|---|
| 새 익명 고객 · 시험 고객 생성/삭제 | `CREATE`/`DELETE` | `Customer` | "시험 고객 생성 #3f9a1c" |
| 수동 연결 · 분리 · `IDENTITY` 분리 | `UPDATE` | `Customer` | "대화 연결: 쇼핑봇 세션 #a1b2c3 → 고객 #3f9a1c" |
| 병합 · 되돌리기 · 승격(주체 system) | `STATUS_CHANGE` | `Customer`(원본) | "병합: #1b2c3d → #3f9a1c" · "병합 되돌리기" |
| 스레드 상태 변경 | `STATUS_CHANGE` | `InboxThread` | "열림 → 보류(해제 09-29 10:00 KST)" |
| 담당 변경(가져가기·지정·놓기) | `UPDATE` | `InboxThread` | "담당: 없음 → 김상담" |
| 태그 목록 생성·수정·삭제 | `CREATE`·`UPDATE`·`DELETE` | `InboxTag` | 이름·색 · 사용 중 삭제 시 제거 스레드 수 |
| 참여·경고 열기 설정 · 식별 비밀 참조 | `UPDATE` | `Chatbot` | "통합 인박스 설정 변경" · "식별 비밀 참조: (없음) → SHOPMALL"(참조 **이름**만) |

- 비감사: 메모·기록 작성·수정 · 태그 부착 · 자동 열림(신호) · 식별 연결(공개 경로 — 발생량이 대화량에 비례) · 시뮬레이션 턴.
- `AUDIT_FIELDS`: `Customer = ['kind','status','ref']` · `InboxThread = ['status','snoozeUntil','assigneeUserId','assigneeUserName','version']` · `InboxTag = ['name','color']` — `displayName`·`customerKeyHash`·`sessionId`·`text` 0(O-6·G-18 형식).
- `AuditTargetType` 30 → 33 · `AuditAction` 추가 0(T-10 불변).

### 12.2 열람 감사(`VIEW` — 거버넌스 모드 ON에서만 · (열람자, 대상, KST 일)당 1건)

| 핸들러 | `@AuditView` |
|---|---|
| `InboxThreadsController#list` | `{ targetType: 'InboxThread' }` |
| `InboxThreadsController#detail`(타임라인 페이지 포함) | `{ targetType: 'InboxThread', idParam: 'threadId' }` |
| `InboxCustomersController#search` | `{ targetType: 'Customer' }` |

- `VIEW_AUDIT_TARGETS` 8 → **11**(X-3). 세션 연결 조회(`GET /inbox/session-link`)는 대상이 아니다 — 대화 텍스트가 없고(별칭·이름·건수·60자 메모 요약), 함께 열리는 대화 보기(`LiveSessionsController#getTranscript`)가 이미 열람 감사 대상이다(K-9). `search`는 POST 핸들러이므로 인터셉터가 POST에서도 동작하는지 구현 시 확인한다(대상 id 없는 기록 — 감사로그 목록 선례).

## 13. 거버넌스 편입 (P-10 · No.45)

### 13.1 암호화 대상 +2 (`EncryptedFieldId` 4 → 6)

| 필드 | 테이블·컬럼 | 봉인 파일 | 개봉 파일 | 백필·재암호화 | 기동 옛 키 검사 |
|---|---|---|---|---|---|
| `INBOX_ENTRY_TEXT` | `inbox_entries.text` | `inbox.store.ts`(+writer) | `inbox-text.reader.ts`(+writer) | **편입**(영구 데이터 — EX-OC-17) | 포함 |
| `CUSTOMER_DISPLAY_NAME` | `customers.displayName` | 〃 | 〃 | **편입** | 포함 |

- 순서: 금지어(표시 이름만) → PII 마스킹(`MaskedText` 브랜드) → **암호화**(저장 직전 마지막 — store) · AAD = `테이블:컬럼:행 id`(항목 id 앱 선발급 · 고객 id는 생성 트랜잭션에서 선발급).
- **고객 키 해시는 암호화 대상이 아니다**(검색 키 · 되돌릴 수 없음 — FR-OC9-2). 연결 행의 `sessionId`도 기존 로그와 같은 가명 난수라 대상 아님.
- `inbox-text.reader.ts`는 `HANDOFF_TEXT`도 개봉한다(스레드의 상담 구간) — G-5 개봉 허용 목록 +1(X-2). 개봉 실패 = `"[복호화 실패]"` + 경고(요청 성공 — ADR-0040 §3).

### 13.2 보존 종류 +2 (`RetentionTargetKind` 6 → 8 · **전역만**)

| 종류 | 대상 | 기준 시각 | 소거 동작(writer) | 하한 |
|---|---|---|---|---|
| `INBOX_TEXT` | `InboxEntry` `NOTE`·`RECORD`·`SIM_*`(SYSTEM 제외) | `createdAt` | `text → ""` + `textPurgedAt`(행·시각·작성자·기록 채널 유지) — **스레드 상태와 무관**(기록은 종단 개념이 없다 · AC-OC6-2) | 대화 하한(7일) |
| `CUSTOMER_IDENTITY` | `Customer` 중 `customerKeyHash` 또는 `displayName`이 있는 행 | `lastActivityAt` | `customerKeyHash·displayName·keyFingerprint → null` + `identityPurgedAt` — 행·연결·스레드·수치 유지("소거된 고객") · 같은 `sub`가 다시 오면 **새 고객**(AC-OC6-3) | 〃 |

- **챗봇 재정의가 없다**: 스레드·기록·고객은 챗봇에 매이지 않는다(여러 챗봇 · 전화 기록) — `CONVERSATION_RETENTION_KINDS`·`ChatbotRetentionUpdateSchema` 불변. 기본 = 무기한(현행 규약).
- 파기 잡 = **기존 No.45 `RetentionJob`에 편입**(`CALL_LOGS` 블록 뒤 전역 2블록 · 배치·양보·1회 상한·`PARTIAL` 동일 — 새 루프 0). 쓰기 = `governance-data.writer.ts` 1파일(G-7 "`textPurgedAt` 대입 = writer만" 규약 그대로 · `enableSecureDelete` 재사용 · 원시 SQL 파일 수 4 불변).
- 보존 정책 API: `GlobalRetentionUpdateSchema`의 새 키는 **선택** — 서비스는 `dto.days[kind] === undefined`를 "현재값 유지"로 처리한다(제약 ⑥·⑦ — 기존 6키 요청 결과 불변). 감사 스냅샷 키 `inboxTextDays`·`customerIdentityDays`는 값이 있을 때만 싣는다. 미리보기 `countAffected` +2. **조회 응답의 `kinds`는 8개가 된다**(의도된 변경 — §21.3 확인 항목).
- 연결·병합 이력 메타데이터는 고객 소거와 함께 정리하지 않는다(분석용 id만 — FR-OC9-4 ③).

### 13.3 PII 마스킹 — 여섯 번째 적용 지점(ADR-0013)

저장 · RAG 송신 · 증강 송신 · 레거시 송신 · 웹훅 송신 · **인박스 저장**(메모·수동 기록·시뮬레이션 입력/출력·고객 표시 이름). 함수 1벌(`packages/pii-mask`) · `PII_MASK_MODE` 반영 · 원문 저장소 0(FR-OC6-2). 표시 이름만 금지어 마스킹을 먼저 거친다(호스트가 보낸 값 — EX-OC-6). **store의 텍스트 인자 타입은 `MaskedText`(브랜드)** — `lib/masked-text.ts`의 `maskForInbox()`만 이 타입을 만들 수 있어 마스킹 누락이 컴파일 오류가 된다(O-4).

### 13.4 데이터 지도

- 선택 키 `inbox?`(고객 0명이면 **키 생략** — No.41 선례): 고객 수·식별 고객 수·스레드 수·항목 수 · `identityHashOnly: true`(원 회원 번호 미저장) · `displayNameEncrypted` · 보존 일수 2종.
- 외부 출구 행 변화 없음(6클래스 불변 — AC-OC6-4). 보존 화면 라벨: "인박스 메모·기록" · "고객 식별 정보(해시·표시 이름)".
- **정보주체 파기(T-5)**: 이 그룹이 식별자를 도입해 "고객 단위 파기"가 기술적으로 가능해졌다(고객 → 연결 세션 → 로그·상담·설문·기록). 1차는 보존기간 파기만 — ADR-0040 재검토 트리거 "정보주체 파기 요청 절차 확정"의 **착수 조건 충족**으로 기록한다(요청 절차 확정 시 writer 메서드 1개 + 고객 단위 선택).

---

## 14. 관리 API

### 14.1 엔드포인트 (관리자 32 핸들러 · 컨트롤러 5 · `@Public()` 0)

전 경로 `InboxEnabledGuard` — `OMNI_INBOX_ENABLED=false`면 `404 NOT_FOUND`(콘솔은 요약 404로 메뉴를 숨긴다 — EX-OC-18).

| 컨트롤러 | 경로 | 권한 |
|---|---|---|
| `InboxThreadsController` (`@Controller('inbox')`) | `GET threads`(목록 — VIEW) · `GET threads/summary` · `GET assignees` · `POST threads/open` · `POST mask-preview` — ⚠ 이상은 `:threadId`보다 **먼저 선언** · `GET threads/:threadId`(상세 + `?cursor=` — VIEW) · `PATCH threads/:threadId`(상태) · `POST threads/:threadId/claim｜assign｜release` · `PUT threads/:threadId/tags` · `POST threads/:threadId/notes` · `PATCH threads/:threadId/notes/:entryId` · `POST threads/:threadId/records` | 조회 `cs:read` · 나머지 `cs:write` |
| `InboxCustomersController` (`@Controller('inbox')`) | `POST customers/search`(VIEW) · `POST customers`(새 익명 고객 + 스레드) · `GET session-link?chatbotId=&sessionRef=` · `GET identity-spaces` · `POST customers/:customerId/links` · `DELETE customers/:customerId/links/:linkId` · `POST customers/:customerId/merge` · `POST merges/:mergeId/revert` | 조회 `cs:read` · 쓰기 `cs:write`(+§11 재검증) |
| `InboxTestCustomersController` (`@Controller('inbox/test-customers')`) | `POST` · `DELETE :customerId` · `POST :customerId/simulate` | `simulation:write` AND `cs:read` |
| `InboxTagsController` (`@Controller('inbox/tags')`) | `GET` · `POST` · `PATCH :tagId` · `DELETE :tagId?force=` | 조회 `cs:read` · 변경 `cs:write` + ADMIN |
| `ChatbotInboxSettingsController` (`@Controller('chatbots/:chatbotId/inbox-settings')`) | `GET` · `PUT` · `PUT identity` | `chatbot:read` · `chatbot:write` · `security:write` |

- 공개: **새 경로 0** — `POST /public/chatbots/:slug/messages`에 선택 헤더 `x-cb-identity`만(`@Public()` 8 유지 · FR-0-186).
- 목록 응답 메타 `pollAfterMs`(콘솔 폴링 — 화면 표시 중일 때만 · SSE/WebSocket 미도입 — FR-OC4-8).

### 14.2 요청·응답 요점

- 모든 스레드 쓰기 응답은 갱신된 `InboxThreadListItem`(새 `version`)을 돌려준다.
- `POST threads/open`: 세션 해석(§7.2) → 연결 없으면 익명 고객 + `SYSTEM` 연결 → 스레드 생성/열림(`MANUAL`) → `{ threadId }`.
- `GET session-link`: 참여 캐시 → 연결 조회(`chatbotId, sessionRef` 인덱스) → 카드 요약. **No.24 기존 응답(`LiveSessionRow`·`TranscriptResponse`·`HandoffDetail`)은 한 바이트도 바꾸지 않는다**(H-17·H-14 불변 — R-16).
- `GET identity-spaces`: 참여 챗봇들의 식별 참조 이름 목록(회원 번호 검색 선택지) — 상태만.
- `GET assignees`: `ACTIVE` ∧ 역할이 `cs:write`를 가진 사용자(id·이름) — 이메일 미포함.

### 14.3 챗봇 스코프 · `ARCHIVED`

설정 조회는 `ARCHIVED`에서도 허용 · 저장·식별 참조는 `409 CHATBOT_ARCHIVED` · 교차·미존재 챗봇 `404`. 보관 챗봇의 과거 대화는 스레드에 계속 보인다(FR-OC8-4). 인박스 전역 경로는 챗봇 스코프가 아니다(챗봇은 필터·연결 대상일 뿐 — 참여하지 않았거나 없는 챗봇 id로 연결·시뮬레이션 요청 = `400 VALIDATION_FAILED`).

### 14.4 오류 코드 (`ApiErrorCode` 신규 4종)

| 코드 | 상태 | 상황 |
|---|---|---|
| `INBOX_THREAD_CONFLICT` | 409 | `version` 불일치 · 가져가기 경합 · 병합으로 숨겨진 스레드 편집 |
| `CUSTOMER_LINK_LOCKED` | 409 | `IDENTITY` 연결 재지정 · 비ADMIN의 `IDENTITY` 분리 · 시험 고객에 실제 대화 연결 |
| `CUSTOMER_MERGE_FORBIDDEN` | 409 | §7.4 규칙 위반 · 병합 경합 |
| `CUSTOMER_MERGE_NOT_REVERTIBLE` | 409 | 이미 되돌림 · 기한 경과 · 대상이 그 뒤 병합됨(역순 필요) |

재사용: `NOT_FOUND`(기능 꺼짐·없는 스레드/고객/세션) · `VALIDATION_FAILED`(기록 시각 범위 · 비참여 챗봇 · 회원 번호 형식 · 고객 키 비밀 없음 · 사용 중 태그 삭제에 `force` 없음) · `LIMIT_EXCEEDED`(태그 100 · 스레드당 10) · `DUPLICATE_NAME`(태그 이름) · `FORBIDDEN`(ADMIN 전용 · 되돌리기 권한) · `CHATBOT_ARCHIVED`. **공개 대화 경로는 이 코드들을 쓰지 않는다**(식별 실패는 응답에 드러나지 않는다).

---

## 15. No.24 상담 · No.41 이벤트와의 관계

### 15.1 No.24 하이브리드 CS (ADR-0036 재검토 트리거 이행)

| 항목 | 처리 |
|---|---|
| `HandoffSession`·`HandoffMessage`·부분 유니크·잠금·토큰·원문 정책(60분·`RAW_VIEW`) | **불변**(J-9 · C-6) — 컬럼 추가 0 · 쓰기 파일 1 · 인박스는 읽기만(`rawText` 미선택) |
| 상담 1건 ↔ 스레드 | **세션 기준 조인**: 상담의 `(chatbotId, sessionId)` = 연결의 `(chatbotId, sessionId)` → 고객 → 스레드. 컬럼 추가 없이 스레드 타임라인·카드·진행 중 상담 배지에 나타난다 |
| 상담 시작 → 스레드 열림 | 포트 신호 `HANDOFF_OPENED`(커밋 후 1줄) — 익명이면 익명 고객 생성(AC-OC4-1) |
| 두 챗봇 동시 상담(EX-OC-7) | 허용(No.24 규약) · 스레드 배지 "진행 중 상담 2건" + 각 콘솔 링크 |
| 상담 콘솔 연계(FR-OC5-7) | 대화 보기·상담 상세에 **고객 카드 요약 + "스레드 열기"/"고객에 연결"** — 신규 `GET /inbox/session-link` · 기존 응답 불변 |
| 여러 챗봇 동시 모니터링(FR-CS2-8 이관) | 인박스 목록이 대체(스레드 = 볼 일이 생긴 고객) · 챗봇별 실시간 모니터링(최근 창)은 No.24 그대로 |
| C-4 | `channelSupportsHandoff()`로 정리(§5.4) |

### 15.2 식별 · 통계 경계 (ADR-0001)

방문 = 세션(ADR-0001)은 **불변**이다. 고객 식별은 통계 정의·접속수·질문 순위를 바꾸지 않고, 고유 방문자·재방문 지표는 만들지 않는다(식별 비율이 충분해지고 통계 요구가 확정될 때 재검토 — §26).

### 15.3 No.41 업무 자동화 이벤트 영향 — 봉투 `channel` 불변

- 인박스는 No.41 포트(`WORKFLOW_EVENT_SINK`)를 **주입하지 않고 발행하지 않는다** → `WorkflowEventType` 7종·봉투 v1·`channel: z.enum(['WEB'])` **불변**.
- 이유: 수동 기록·시뮬레이션은 공개 파이프라인을 타지 않아 `TURN_LOGGED`·`HANDOFF_*`가 생기지 않는다. 식별 연결은 봉투에 싣지 않는다(고객 키·별칭을 외부로 보내면 새 개인정보 전송 목적이 생긴다 — 2차 판단).
- 2차 "스레드 이벤트"(열림·배정·종료 웹훅) 착수 시: `WorkflowEventType` +3 · 봉투 `source`에 `threadId`만(고객 키·이름 0) · 기록 채널은 봉투 `channel`이 아니라 `data.recordChannel`로(봉투 `channel`은 "대화가 들어온 배포 채널"의 의미를 유지) — ADR-0041 갱신 각주.
- 원천 파일 공존: `handoff-thread.service.ts`·`conversation-log.service.ts`는 No.41 `emit(`과 No.42 `signal(`을 **각 1줄씩** 갖는다(순서: emit → signal · 둘 다 await 0 · W-16 `kind:` 개수 불변).

---

## 16. 버전 · 환경 · 복사 · 영구삭제

| 자산 | 취급 |
|---|---|
| `ChatbotInboxSetting` | **환경 밖**(설문·상담 설정과 같은 J-15) — 저장 즉시 운영 반영 · 편집 화면 "환경 분리 대상이 아닙니다 — 저장 즉시 운영에 적용(다른 서버는 최대 30초)" · 스냅샷·복사·토픽 분리 대상 아님 · 영구삭제 **동반 삭제**(22 → 23테이블) |
| 고객·스레드·항목·태그·병합 | 전역 데이터 — 스냅샷·환경과 무관 · 챗봇 영구삭제와 무관(고객은 전역 — EX-OC-19) |
| `CustomerLink` | 챗봇 FK `Restrict` → 영구삭제 **사전검사 16종째**(라벨 "인박스 연결") — 대화가 있었던 챗봇은 이미 로그 사전검사가 막으므로 차단 집합은 실질적으로 같다(ADR-0002 갱신) |
| 시뮬레이션 대상 | 시뮬레이터 규약(초안 기본 · `target`으로 스테이징/운영/버전) |

---

## 17. 봉인 · 정적 검사 — `apps/api/src/inbox/lib/inbox-sealing.spec.ts`

(검사 대상: `apps/api/src/**/*.ts` 중 `*.spec.ts`·`src/integration/**` 제외, 주석 줄 제외 — 기존 `*-sealing.spec.ts` 형식 · 스캔 0건 아님 가드 · 주요 단언은 **역검증 픽스처** 포함.)

| # | 단언 |
|---|---|
| O-1 | 문자열 `OMNI_IDENTITY_SECRET__`·`OMNI_CUSTOMER_KEY_SECRET` 보유 파일 = `inbox/identity/inbox-identity-secret.resolver.ts` 1개(`env.validation.ts`·웹·위젯 0) · 리졸버 주입 파일 ⊆ {`inbox-identity.service.ts`, `inbox-query.service.ts`, `chatbot-inbox-settings.service.ts`} |
| O-2 | `customer｜customerLink｜inboxThread｜inboxEntry｜inboxTag｜inboxThreadTag｜customerMerge`의 `create｜createMany｜update｜updateMany｜upsert｜delete｜deleteMany` 호출 파일 = {`inbox/core/inbox.store.ts`, `governance/writer/governance-data.writer.ts`} · `chatbotInboxSetting` 쓰기 = {`chatbot-inbox-settings.service.ts`, `chatbots/chatbots.service.ts`(deleteMany)} |
| O-3 | writer의 `inboxEntry.updateMany` data 키 ⊆ {`text`, `textPurgedAt`} · `customer.updateMany` data 키 ⊆ {`customerKeyHash`, `displayName`, `keyFingerprint`, `identityPurgedAt`} · writer의 새 소거 메서드 블록에 `enableSecureDelete(` |
| O-4 | `sealField('INBOX_ENTRY_TEXT'｜'CUSTOMER_DISPLAY_NAME'` 호출 파일 ⊆ {store, writer} · `openField(` 인박스 호출 파일 = `inbox/read/inbox-text.reader.ts` 1개(G-5 목록과 일치) · `MaskedText` 브랜드 생성(`as MaskedText`) 파일 = `inbox/core/lib/masked-text.ts` 1개 · store의 텍스트 매개변수 타입은 `MaskedText` |
| O-5 | `schema.prisma` 신규 8모델 `Cascade`/`SetNull` 0 · `Customer`에 `sub｜memberId｜externalId｜token｜rawName｜email｜phone` 컬럼 0 · `CustomerLink`·`InboxEntry`·`CustomerMerge`에 `rawText｜userMessage｜botResponse｜token` 0 · `ChatbotInboxSetting`에 `secret` 값 컬럼 0(`*Ref`만) |
| O-6 | (런타임) `InboxThreadListItemSchema`·`InboxThreadDetailSchema`·타임라인 단위·`CustomerSearchItem`·`SessionLinkLookupResponse`·`ChatbotInboxSettingsResponse` 키 집합 — `sessionId`·`rawText`·`customerKeyHash`·`memberId`·`sub`·`token`·`keyFingerprint` 없음 · `AUDIT_FIELDS.{Customer,InboxThread,InboxTag}`에 `displayName`·`customerKeyHash`·`sessionId`·`text` 0 |
| O-7 | `inbox/**`·`common/inbox/**` logger 호출 인자에 `token`·`identity`·`sub`·`displayName`·`name`·`text`·`sessionId`·`memberId`·`secret`·`.message` 식별자 0(휴리스틱) |
| O-8 | `inbox/**` `@Public()` 0 · 총 8(H-10·W-10과 같은 목록) |
| O-9 | `packages/dialogue-engine/src`·`apps/ml-worker`에 `identity｜customer｜inbox` 심볼 0 · `ConversationStateSchema` 키 집합 불변(H-16) · `PublicMessageRequestSchema`·`PublicMessageResponseSchema` 키 집합 불변 |
| O-10 | `inbox/**`에 `conversationLog｜unansweredQuestion｜messageFeedback｜surveyResponse｜surveyAnswer｜handoffSession｜handoffMessage｜workflowRun`의 쓰기 호출 0 · `rawText` 식별자 0 · `ConversationLogService`·`WORKFLOW_EVENT_SINK`·`WorkflowTriggerService` 주입 0 · `conversationLog.create` 호출 파일 = `conversation-log.service.ts` 1개(불변) |
| O-11 | `InboxModule` exports `[]` · `InboxCoreModule` exports = {`INBOX_SIGNAL_SINK`, `InboxStore`, `InboxParticipationCache`} · `InboxIdentityModule` exports = {`InboxIdentityService`, `InboxIdentitySecretResolver`, `IdentityFailureCounter`} · `InboxStore`·`InboxIdentitySecretResolver`·`IdentityFailureCounter` 주입 파일 ⊆ `inbox/**` |
| O-12 | `validation｜versions｜deploy-schedules｜stats｜learning｜topics｜asset-transfer｜governance｜environment｜workflow｜feedback｜survey-responses｜simulation｜rag｜legacy-api`에 `inbox/` import 0 · `conversation/**`의 `inbox/` import ⊆ {`inbox/identity/inbox-identity.module`, `inbox/identity/inbox-identity.service`, `inbox/core/inbox-core.module`} · `handoff/**` ⊆ {`inbox/core/inbox-core.module`} · 원천 서비스 파일은 `common/inbox/inbox-signal.port`만 · `inbox/**`에 `fetch(`·`node:http`·`transport.request(` 0(출구 0) |
| O-13 | 원천 2파일(`handoff-thread.service.ts`·`conversation-log.service.ts`)의 `.signal(` 호출에 `await` 0 · 발행 리터럴 `signal: 'HANDOFF_OPENED'` 1 · `signal: 'TURN_RECORDED'` 1 · `drainForTest(` 운영 코드 호출 0 |
| O-14 | `public-conversation.service.ts`의 `inboxIdentity?.observe(` 정확히 1회 · `await` 없음 · `inbound.identity` 읽기 파일 = {`public-conversation.service.ts`} · `IDENTITY_TOKEN_HEADER`/`x-cb-identity` 사용 파일(api) = {`public-conversation.controller.ts`} |
| O-15 | 위젯: `cb.idt.` 키 = `core/identity-storage.ts` 1파일 · `x-cb-identity` = `constants/identity.ts` 1파일 · `saveConversationState(` 인자에 식별 값 0 · 위젯 상수 = shared-types 상수(런타임 동등성) |
| O-16 | `verify-identity-token.ts`에 `timingSafeEqual(` 존재 · `'HS256'` 정확 비교 · `apps/api/package.json`에 `jsonwebtoken`·`jose` 의존성 0 |
| O-17 | 신규 마이그레이션 SQL에 `DROP`·`ALTER TABLE`·부분 인덱스(`WHERE`) 0 · `$queryRaw`·`$executeRaw` 보유 파일 수 불변(4 · 0) |
| O-18 | `apps/api/src`의 `=== 'WEB'`·`'WEB' ===` 리터럴 비교 = 0(팩토리·`channel-config.ts`·어댑터 파일 제외 — C-4 정리 후) |
| O-19 | `VIEW_AUDIT_TARGETS`에 인박스 3행 존재 · `inbox/**` `@AuditView(` 3건 |
| O-20 | `inbox/**`에 `setInterval(`·`PollingLoop` 0 · `jest.isolate-env.js`에 `OMNI_` 0(새 루프 0 — FR-0-193) |

## 18. 성능 예산 (NFR-OCP)

| 항목 | 예산 | 근거·측정 |
|---|---|---|
| 헤더 없는 공개 턴 · 비참여 챗봇 | 지연 증가 0 · 공개 경로 추가 쿼리 **0**(비참여 = 참여 캐시 적중 · 캐시 만료 시 인스턴스당 1쿼리/30초) | 키 부재 분기 · AC-OC1-1·2 쿼리 수 시험 |
| 참여 + 토큰 + 미연결 세션 | 동기 검증 ≤1ms(HMAC 1~2회) · 연결 적재 **응답 비차단**(≈3~5쿼리 · ≤10ms) | NFR-OCP3 |
| 연결된 세션의 후속 턴 | 0(세션 식별 캐시) | AC-OC2-4 |
| 로그 적재 뒤 신호(`TURN_RECORDED`) | 비참여·경고 열기 꺼짐·응답 턴 = DB 0 · 미응답 턴 = 1쿼리(최근 30행) + 경고 도달 시 트랜잭션 1 | No.41 연속 미응답 판정과 같은 비용 |
| 상담 시작 신호 | 원천 지연 0(동기 반환) · 처리 ≤15ms | — |
| 인박스 목록 | P95 ≤500ms(스레드 1만 · 참여 챗봇 20 · 쿼리 ≤7) | §9.1 |
| 요약 | P95 ≤300ms(쿼리 ≤6) | — |
| 스레드 상세 | P95 ≤800ms(연결 50 · 대화당 100턴 · 쿼리 ≤ 2×챗봇 수 + 8) | §9.2 |
| 고객 검색 | 해시 검색 P95 ≤50ms · 이름 검색 P95 ≤1s(스캔 2,000 · 복호화 포함) | §9.4 |
| 병합·되돌리기 | 트랜잭션 P95 ≤200ms(연결 100 · 항목 500) | — |
| 시뮬레이션 | 시뮬레이터 예산 + 쓰기 1 트랜잭션(≤20ms) | — |
| 위젯 | gzip +1.5KB 이하(100KB 게이트) | 빌드 스크립트 |

- **예산 미달을 이유로 캐시 TTL·스캔 상한·페이지 크기를 조용히 바꾸지 않는다** — 설계 문서 갱신 후 조정.

## 19. ★ 기능을 쓰지 않을 때 동작 불변 보장 (FR-0-183 · AC-OC1-1)

| 경로 | 미사용 동작 | 보장 장치 |
|---|---|---|
| 공개 대화(헤더 없음) | 컨트롤러 `opts`에 `identityToken` 키 없음 → 어댑터 `identity` 키 없음 → ①.5 분기 미진입 · 응답·쿼리 수 동일 | 쿼리 수 시험 · O-9·O-14 |
| 공개 대화(헤더 있음 · 비참여) | 참여 캐시 확인 후 반환 · 파싱 0 · 응답 바이트 동일 | AC-OC1-2 |
| 로그 적재 · 상담 시작 | `signal()` → 참여 캐시에 없음 = 즉시 반환(DB 0) · 포트 미주입 = no-op · 원천 트랜잭션·반환·예외 불변 | 원천 기존 spec 무수정(생성자 끝 `@Optional()`) · O-13 |
| 엔진·봉투·ml-worker | 변경 0 | O-9 |
| 상담 콘솔(No.24) | 기존 응답·화면 불변 — 고객 카드는 별도 조회(인박스 꺼짐·비참여 = 카드 없음) | H-14·H-17 불변 |
| 통계·학습·설문·평가·업무 자동화 | 쓰기 0 · 읽기 경로 불변 | O-10·O-12 |
| 거버넌스 | 암호화 필드 추가는 행 0이면 잡·기동 검사 결과 동일 · 파기 잡 새 블록은 0행 · 지도 `inbox?` 생략 · **보존 조회 `kinds` 8개**(의도된 변경) | §21.3 |
| 권한·감사 | 권한 18·역할 4·`AuditAction` 16 불변 · `AuditTargetType` +3(값 추가) | `permission-matrix.spec.ts`·T-10 |
| `OMNI_INBOX_ENABLED=false` | 인박스·설정 API 404 · 식별 검증 0 · 신호 no-op · 데이터 유지 | 동적 import 통합 시험 |

- **기준선**: 커밋 ②(호출부 없는 코어·식별) 적용 후 전 시험이 X-2 외 무수정 통과해야 하며, 커밋 ③은 기대값 변경 0, 커밋 ④는 §21.3 X 목록 외의 기존 시험을 바꾸지 않는다.

## 20. 관리자 콘솔 · 위젯 (ui-designer / frontend-implementer 인계)

1. **통합 인박스**(전역 메뉴 — `cs:read` · 요약 404면 숨김): 요약 칩(열림·보류·내 담당·담당 없음·진행 중 상담 — 버튼 + 개수 텍스트) · 필터(라벨 있는 컨트롤: 상태·담당·챗봇 다중·출처 계열·태그·고객 종류·기간·"시험 포함" 토글) · 목록(키보드 이동·열기 · 행 = 고객 표시(`<bdi>`)·종류 배지(색+텍스트)·상태·담당·태그·최근 채널/챗봇·연결 대화 수·진행 중 상담·마지막 활동·미리보기) · 폴링 `pollAfterMs`(화면 표시 중만 · 포커스·스크롤 유지 · 새 항목 `aria-live="polite"` 1줄 — NFR-OCA2).
2. **고객 스레드**: 고객 카드(사실 목록 — 문장 생성 0) · 타임라인(출처 배지 = 채널 라벨 + 챗봇 이름 + "시뮬레이션" 텍스트 · 소거 표시 "(보존기간 경과로 삭제됨)" · 더 보기) · 동작 패널(상태/보류 해제 시각 · 가져가기/지정/놓기 · 태그 · 메모 · 수동 기록 · 연결/분리 · 병합/되돌리기 · 진행 중 상담 → 콘솔 링크). `409 INBOX_THREAD_CONFLICT`는 "다른 사람이 먼저 바꿨습니다 — 새로 불러옵니다" 안내 후 재조회.
3. **수동 기록·메모 입력**: 라벨 있는 폼(기록 채널·방향·발생 시각·요약·결과) · 저장 전 마스킹 미리보기 · 글자 수 안내.
4. **고객 검색·연결·병합 확인 창**: 회원 번호 입력은 가림 옵션 + "입력값은 저장되지 않습니다" 풀이 · 병합 확인 창(초점 가두기·`Esc`·명시 버튼 "익명 고객 #1b2c3d를 홍길동에 합치기") · 식별↔식별 불가 안내.
5. **시뮬레이션**: 시험 고객 목록 · 챗봇·가상 채널 선택 · 대화 영역 제목 "시뮬레이션 — 카카오톡(가상)" · 모든 말풍선 "시뮬레이션" 라벨(NFR-OCA3) · "실제 고객·통계에 반영되지 않습니다".
6. **챗봇 > 통합 인박스 설정**: 참여 스위치 · 경고 단계 열기 · 식별 비밀 참조(ADMIN만 편집 · 상태 텍스트 "설정됨/없음/약함/미지정") · 고객 키 비밀 상태 · 비밀 교체 의심 경고 · 최근 24시간 식별 성공/실패 사유 표(표 형태 · "이 서버 기준") · 환경 밖 안내.
7. **상담 콘솔(No.24)**: 대화 보기·상담 상세에 고객 카드 요약 + "스레드 열기"/"고객에 연결" — 인박스 꺼짐·비참여면 영역 자체를 숨김.
8. **태그 관리**(ADMIN): 목록·팔레트 색(대비 검증 8색) · 사용 중 삭제 확인 창.
9. **채널 설정(No.11)**: `CONFIG_ONLY` 카드 안내 문구 1줄(FR-OC1-5).
10. **데이터 지도·보존**: "통합 인박스" 행 · 보존 라벨 2종.
11. 문구(FR-0-192): "통합 인박스 · 고객 스레드 · 고객 카드 · 수동 기록 · 시뮬레이션 · 연결/분리 · 담당 · 보류" — "옴니채널·해시·서명 토큰·식별 공간"은 짧은 풀이와 함께만(예: "서명(고객사 서버가 이 회원이 맞다고 보증하는 값)").
12. **위젯**(§6.8): 화면 변화 = `sub` 변경 시 상태 영역 1회 안내뿐 · 연동 가이드(`docs/05-ops/통합인박스_연동가이드.md` — deployment-engineer): 토큰 생성 예시(Node·Python·Java) · 비밀 관리·`__PREV` 교체 · 로그인 전환 · 권장 수명 1시간 · 동의·고지 문구 예시(고객사 책임) · 고객 키 비밀 교체 금지.

## 21. 시험 전략 (test-automation 인계)

### 21.1 층별 핵심

| 층 | 핵심 |
|---|---|
| 순수 함수 | ★ 토큰 검증 전 분기(`alg:none`·`RS256`·`crit`·`typ` 오류·서명 불일치·`__PREV` 성공·만료 경계 `exp+skew`·미래 `iat`/`nbf`·TTL 초과·`sub` 공백/한글·길이 2,049·base64url 불량·`aud` 불일치 — RFC 7515 A.1 벡터 교차) · 고객 키(도메인 구분·REF 분리 — AC-OC2-2) · 표시 이름 정리(제어·양방향·40자·마스킹) · 연결 규칙 표 · 병합 규칙 표(AC-OC3-2·AC-OC5-3·EX-OC-14) · 유효 상태/보류 해제(주입 시계) · 재열림 규칙 · 고객 카드 조립 · 타임라인 병합·커서 · 참여 캐시 TTL · 실패 카운터 링 |
| 서비스(목) | 식별 적재 5결과(LINKED·ALREADY·PROMOTED·CONFLICT·BLOCKED) · P2002 재조회 · 병합/되돌리기 트랜잭션(스킵 계수) · 가져가기 CAS · `version` 불일치 · 태그 한도·사용 중 삭제 · 기록 시각 범위 · ADMIN 재검증 |
| 통합(`migrate deploy` DB · 동적 import) | ★ AC-OC1-1(참여 0 — 공개 경로 쿼리 수·응답 바이트 동일) · ★ AC-OC1-2(비참여 + 유효 토큰 → 고객·연결 0) · ★ AC-OC2-1(같은 공간 두 챗봇 → 고객 1·연결 2·타임라인 2) · AC-OC2-2 · ★ AC-OC2-3(위조·만료·`alg:none` → 응답 바이트 = 토큰 없음 · 연결 0 · 계수 +1) · AC-OC2-4(두 번째 턴 쿼리 0) · AC-OC2-5 · ★ AC-OC2-6(가짜 회원 번호 `member-<난수>` 전수 grep — DB 전 테이블·로그·응답·감사 0) · AC-OC2-7 · ★ AC-OC3-1(연결·분리 → 로그·상담 행 변경 0 · 감사 2) · ★ AC-OC3-2/3 · AC-OC3-4/5 · ★ AC-OC4-1(개입 성공 → 스레드 열림 · 신호 실패 주입에도 개입 성공) · AC-OC4-2(경고 1회) · AC-OC4-3 · ★ AC-OC4-4(두 요청 동시 가져가기 → 1 성공·1 `409`) · AC-OC4-5(보류 해제 — 상대 시각) · AC-OC4-6 · ★ AC-OC4-7(역할 4종 매트릭스) · ★ AC-OC4-8(키 집합) · ★ AC-OC5-1(마스킹 · 모드 ON `enc:v1:`) · ★ AC-OC5-2(시뮬레이션 3회 → 항목 6 · 로그·통계·큐·발송함 증가 0) · AC-OC5-3/4 · AC-OC6-1(VIEW 1일 1건) · ★ AC-OC6-2(보존 소거) · AC-OC6-3(식별 소거 후 같은 `sub` = 새 고객) · AC-OC6-4/5 · 승격 병합(로그인 전 상담 → 로그인 후 같은 세션) · `OMNI_INBOX_ENABLED=false` 404 |
| 위젯 | 토큰 없음 = 요청 헤더 0(바이트 동일) · 속성/JS 호출 · `sub` A→B·A→null = 새 `sessionId`·상태 초기화 · null→A = 세션 유지 · 헤더는 `POST /messages`에만 · 상수 동등성 |
| 봉인 | O-1~O-20 + 기존 G·H·W·L·S·F·T·E 봉인 불변 |

### 21.2 시험 작성 원칙

- **★ 상대 시각 사용**: 시각 비교가 들어가는 픽스처(토큰 `iat`/`exp`/`nbf` · 보류 해제 · 기록 발생 7일 · 메모 수정 10분 · 병합 되돌리기 24시간 · 실패 카운터 24시간 · 보존 cutoff · 수동 연결 24시간 창)는 **`now` 기준 상대값**(`Math.floor(now.getTime() / 1000) - 3600`)으로 만들고 **절대 날짜 리터럴을 쓰지 않는다**. 순수 함수는 `now`를 인자로, 서비스는 `Clock` 주입으로 결정적으로 시험한다. 보존 cutoff 기대값은 리터럴이 아니라 `computeCutoff(days, now)`로 계산한다.
- **KST**: 보류 해제 시각 표시·보존 cutoff(KST 자정)는 경계 직전·직후(UTC 14:59·15:00) 케이스를 넣는다.
- **선택 env를 켜는 spec은 동적 import**: `OMNI_INBOX_ENABLED=false`·`OMNI_CUSTOMER_KEY_SECRET`·`OMNI_IDENTITY_SECRET__T`·`DATA_GOVERNANCE_MODE=ON`·`OMNI_IDENTITY_CLOCK_SKEW_SEC` 등은 `process.env` 설정 후 `await import('../app.module')`(정적 import spec의 `beforeAll` 설정은 무시된다 — CLAUDE.md). 비밀은 리졸버가 `process.env`를 직접 읽으므로 **첫 조회 전에** 설정한다.
- **통합 DB = `prisma migrate deploy`**(원시 부분 유니크 4종 포함 · 적용 후 4 단언).
- **비동기 적재 대기**: `InboxIdentityService.drainForTest()`·`InboxSignalService.drainForTest()`(타이머 대기 금지).
- **가짜 비밀·회원 번호 grep**: `OMNI_IDENTITY_SECRET__T=fake-secret-<난수 32자>` · `sub=member-<난수>`로 전 테이블 덤프·로그 캡처·응답·감사를 검사(NFR-OCS2).
- **boolean**: 환경변수 `envBoolean()` · 쿼리 `queryBoolean()` — `"false"` 문자열 케이스.

### 21.3 ★ 의도된 기존 시험 기대값 변경 (닫힌 목록 — FR-0-190 확정)

| # | 파일 | 변경 | 이유 |
|---|---|---|---|
| **X-1** | `common/auth/public-decorator-count.spec.ts` | 등록 컨트롤러 40 → **45**(인박스 컨트롤러 5개 import·목록·제목 문자열) · `@Public()` 8 목록 **불변** | 신규 컨트롤러 |
| **X-2** | `governance/lib/governance-sealing.spec.ts` G-5 | `sealField(` 허용 파일 +`inbox/core/inbox.store.ts` · `openField(` 허용 파일 +`inbox/read/inbox-text.reader.ts`(제목 문자열 갱신 — 단언 로직 불변) | 인박스 암호화(§13.1) |
| **X-3** | `governance/lib/governance-sealing.spec.ts` G-15 | `VIEW_AUDIT_TARGETS` 선언 8 → **11** · `@AuditView(` 호출 8 → **11**(제목 문자열) | 열람 감사 3화면(P-10) |
| **X-4** | `chatbots/chatbots.service.spec.ts` | 사전검사 목 +`customerLink.count`(15 → 16종) · 트랜잭션 목 +`chatbotInboxSetting.deleteMany`(주석 22 → 23테이블) — 기존 단언 불변 | 영구삭제(§16) |

- **확인 항목(변경 예상 0)**: `handoff-sealing.spec.ts` H-2·H-3·H-5·H-7·H-12·H-14·H-16·H-17 · `workflow-sealing.spec.ts` W-9·W-10·W-16 · `governance-sealing.spec.ts` G-1·G-7·G-9·G-13·G-16·G-17·G-18 · `environment-sealing.spec.ts` E-5(엔진 골든 스냅샷 — 엔진 무변경) · `topic-sealing.spec.ts` T-10(`AuditAction` 16) · `permission-matrix.spec.ts`(18) · `quality-channel.integration.spec.ts`(채널 8) · `data-governance-*.integration.spec.ts`(보존 저장 6키 요청 — 선택 키라 통과 · 조회 `kinds` 개수·순서를 단언하는 시험 없음 확인) · `public-conversation.service.spec.ts`·`conversation-log.service` 관련 spec·`handoff-thread` 관련 spec(생성자 끝 선택 인자) · 웹 `DataGovernanceRetentionPage.spec.tsx`(고정 6종 픽스처 — 응답 기반 렌더라 통과 예상) · 위젯 `public-client.spec.ts`(헤더 없는 요청 불변).
- **픽스처 보강(단언 불변)**: 없음 예상. 그 밖의 spec이 깨지면 **회귀로 취급하고 멈춘다**.

### 21.4 커밋 분할안

§2.6 ①~④(각 커밋 단독으로 전 시험 통과 · X-n은 해당 커밋에서만 — ②: X-2 · ④: X-1·X-3·X-4).

## 22. 요구사항 추적표 (요약)

| 요구사항 | 설계 |
|---|---|
| FR-0-183 · AC-OC1-1/2 | §19 · §2.3 · §18 |
| FR-0-184 · C-8 · AC-OC5-2 | §10.1 · O-10 |
| FR-0-185~186 · J-12 | §2.4 · O-8·O-9 |
| FR-0-187 · NFR-OCS2 · AC-OC2-6 | §3.4 · §6.4 · O-1·O-5·O-7 |
| FR-0-188 · C-6 · AC-OC4-8 | §9.2 · O-6·O-10 |
| FR-0-189 · 권한 | §11 |
| FR-0-190 | §21.3 X-1~X-4 |
| FR-0-191 · FR-0-193 | §3.4 · O-20 |
| FR-0-192 | §20 |
| FR-OC1-\* | §5 |
| FR-OC2-\* · AC-OC2-\* · NFR-OCS1/5 | §6 |
| FR-OC3-\* · AC-OC3-\* · NFR-OCS4 · NFR-OCR2/3 | §7 |
| FR-OC4-\* · AC-OC4-\* | §8 · §9.1 |
| FR-OC5-\* | §9.2~§9.3 · §15.1 |
| FR-OC6-\* · FR-OC7-\* · AC-OC5-\* | §8.3 · §10 |
| FR-OC8-\* | §6.3 · §14 · §16 |
| FR-OC9-\* · AC-OC6-\* | §12 · §13 |
| NFR-OCP | §18 |
| NFR-OCA | §20 |
| NFR-OCM1~3 | 순수 lib(§2.1) · 상수 1곳(§4.1) · ADR-0042 재검토 트리거 |

## 23. 알려진 제한

| # | 제한 | 수용 근거 |
|---|---|---|
| K-1 | 식별은 로그인 회원만 — 익명 방문자는 수동 연결 전까지 세션 단위 | 호스트가 동의·고지 책임을 지는 값만 받는다(C-1) · 연락처 자동 병합은 2차 |
| K-2 | 유효 기간 내 토큰 재생을 서버가 탐지하지 않는다(`jti` 저장 없음) | 재생 이득 = 상담원 화면 오염뿐(J-7) · ADMIN 분리로 제거 · 짧은 수명 권장 · 2차 탐지 |
| K-3 | 고객 키 비밀 교체 = 기존 고객과 통합 끊김(원 `sub` 미저장이라 재해시 불가) | 운영 문서 "교체 금지" · 지문 비교 경고 · 재해시 이관은 2차 |
| K-4 | 참여 설정의 다른 인스턴스 수렴 ≤30초 | 상담·구독 캐시 선례 · 화면 안내 |
| K-5 | 식별 실패 통계는 인스턴스 로컬(다중 서버 = 서버별) | 진단용 · 화면에 "이 서버 기준" |
| K-6 | 도입 전 대화·상담은 소급 연결하지 않는다 · 수동 연결은 최근 24시간 또는 상담 이력 세션만 | `sessionRef` 역해석 비용 · 개인정보 소급 처리 회피 |
| K-7 | 신호 발행 전 강제 종료 시 그 스레드 열림 유실 | 감사 기록과 같은 수용 · "직접 열기"로 회복 |
| K-8 | 이름 부분 일치 검색은 최근 2,000명 범위 | 암호문 `LIKE` 불가 · 화면 `truncatedScan` 안내 · 별칭·회원 번호 검색은 전체 |
| K-9 | 세션 연결 조회(콘솔 카드)는 열람 감사 대상이 아니다 | 텍스트 없음 · 함께 열리는 대화 보기가 감사 대상 |
| K-10 | 시뮬레이션 봉투는 콘솔 메모리 — 새로고침 시 새 대화 | 슬롯 원문 서버 저장 회피(ADR-0009) |
| K-11 | 인박스 가시성은 전역 역할(`cs:read`) — 상담원별 챗봇 제한 없음 | 멀티테넌시 그룹(T-6) |
| K-12 | 스레드 이벤트(열림·배정·종료)는 업무 자동화로 알리지 않는다 | 2차 — No.41 이벤트 확장 |

## 24. 요구사항 대비 해석 (architect 판단)

| # | 요구사항 | 해석·조정 |
|---|---|---|
| R-1 | FR-OC1-2 `identity?` = 원시 토큰 문자열 | 판별 유니온 `{ scheme: 'HOST_SIGNED_TOKEN', token }` — 2차 플랫폼 사용자 키를 같은 필드로 |
| R-2 | FR-OC1-4 채널 능력 상수·C-4 | 정리한다 — `CHANNEL_CAPABILITIES` 속성 표 + `channelSupportsHandoff()` · 리터럴 비교 0(O-18) · 공개 경로 `'WEB'` 하드코딩은 1차 무변경(§5.3) |
| R-3 | FR-OC2-1 토큰 형식 | JWS Compact HS256 고정 · `sub`/`iat`/`exp` 필수 · `nbf`/`name`/`aud` 선택 · 2,048바이트 · 라이브러리 미사용 |
| R-4 | FR-OC2-2 REF `^[A-Z0-9_]{1,40}$` | `^[A-Z0-9]+(_[A-Z0-9]+)*$` ≤40(연속 밑줄 금지 — `__PREV` 접미 보장) · 상태 +`NOT_SET`·`WEAK` |
| R-5 | FR-OC2-3 사유 5종 · 허용 오차 5분 | 사유 7종(+`NOT_YET_VALID`·`TTL_TOO_LONG`) · 오차 설정 가능(기본 300초) · 실패 캐시로 같은 세션·토큰 재계수 방지 |
| R-6 | FR-OC2-4 `"<REF>:<sub>"` | `"cb-omni-customer:v1\n<REF>\n<sub>"`(도메인 구분·모호성 제거) · 비밀 ≥32바이트 · 지문 저장 |
| R-7 | FR-OC2-5 적재 시점 | fire-and-forget(응답 비차단) + `drainForTest()` |
| R-8 | FR-OC2-6 로그인 전환 | A→B·A→없음 = 위젯 새 대화 · 없음→A = 세션 유지 + 서버 승격 병합(익명 스레드가 있을 때) |
| R-9 | FR-OC2-8 위젯 입력 | `data-identity-token` + `window.__ChatBotWidget.identify()`(전역 심볼 1개 유지) · 키 `cb.idt.{slug}` |
| R-10 | FR-OC3-2 연결 부분 유니크 | 전체 유일 `(chatbotId, sessionId)` + 재지정·이전 고객 기록 — 원시 부분 유니크 4종 불변 |
| R-11 | FR-OC3-4 `IDENTITY` 분리 불가 | ADMIN 전용 분리 허용(재생 대응) — **PM 확인 필요** |
| R-12 | FR-OC3-5 병합·되돌리기 | 원본은 익명만 · 되돌리기 = ADMIN 또는 수행자 24시간 · 승격 = ADMIN · 역순 되돌리기 |
| R-13 | FR-OC3-7 검색 `GET ?q=` | `POST /inbox/customers/search`(회원 번호 URL 미노출) · 이름 = 최근 2,000명 복호화 스캔 |
| R-14 | FR-OC4-5 보류 확정 방식 | 조회 시 유효 상태 + 다음 쓰기에서 확정 · 보류 ≤30일 |
| R-15 | FR-OC4-4 재열림 | 고객 사건(①②) = 종료·보류 → 열림 · 상담원 사건(③④) = 종료 → 열림만 |
| R-16 | FR-OC5-7 기존 API 선택 필드 | 기존 No.24 응답 불변 · 신규 `GET /inbox/session-link` |
| R-17 | FR-OC7-2 시뮬레이션 봉투 서버 보관 | 콘솔 메모리(서버 저장 0 — 슬롯 원문 저장 회피) |
| R-18 | FR-OC7-3 격하 미리보기 | 지원 목록 미정의 → 격하 0 + `degradePreview: 'NOT_DEFINED'`(No.46이 채운다) |
| R-19 | FR-OC8-4 영구삭제 | 연결 = 사전검사 16종째 · 설정 = 동반 삭제(22 → 23) |
| R-20 | FR-OC9-2 암호화 +2~3 | +2(`INBOX_ENTRY_TEXT`·`CUSTOMER_DISPLAY_NAME`) · 백필·재암호화 잡 **편입**(EX-OC-17) |
| R-21 | FR-OC9-4 보존 종류 | 신설 2(`INBOX_TEXT`·`CUSTOMER_IDENTITY`) · 전역만 · 저장 스키마 선택 키 |
| R-22 | FR-OC9-6 열람 감사 3화면 | 목록 · 상세(타임라인 페이지 포함 — 1핸들러) · 고객 검색 |
| R-23 | EX-OC-6 금지어 이름 | 저장 시 금지어 → PII 마스킹(로그 순서) |
| R-24 | FR-OC4-3 미리보기 60자 컬럼 | 텍스트 복제 컬럼 없이 `lastEntryId` → 조회 시 개봉(암호화·소거 일관) |
| R-25 | §4.10 API 가칭 | §14.1로 확정(32 핸들러) — `POST threads/open`·`GET session-link`·`GET identity-spaces`·`GET assignees`·`POST customers` 추가 |
| R-26 | FR-OC5-2 페이지 = 대화 50개 | 단위(대화 또는 항목) 50개 · 시각 커서 |
| R-27 | FR-OC4-7 사용 중 태그 삭제 "확인 후" | `?force=true` 없으면 `400 VALIDATION_FAILED` + `inUseCount` |

## 25. GPU · 배포 형태

- **GPU 1**(카탈로그 2 → 하향, P-12): HMAC-SHA256(검증 1~2회 + 고객 키 1회) · DB 조회/집계 · 규칙 기반 카드 조립 · 정규식 마스킹 — 모델·학습·추론·임베딩 0 · ml-worker 변경 0. 생성형 대화 요약(2차)은 그 기능만 옵션 AI(No.30 계열)로 별도 평가.
- **구축형 ○**: 외부 출구 0 · 새 인프라 0 · 비밀은 서버 환경변수. 고객사 로그인 서버와 챗봇 서버가 비밀을 공유해야 한다(폐쇄망 무관 — 토큰은 브라우저가 전달).
- **구독형 ○**: 식별 공간 = 고객사별 참조로 분리. 2차 카카오톡 등 실연동은 공개 HTTPS 수신 주소·플랫폼 계정·심사가 전제라 **구독형이 유리**(구축형 폐쇄망은 DMZ 중계 서버 필요).

## 26. 범위 밖 · 2차 교체 지점 (재검토 트리거는 요구사항 §9 · ADR-0042)

카카오톡·네이버 톡톡·라인·페이스북 실연동(교체 지점 §5.3 6개 + 어댑터 1 + 자격증명 ADR + 웹훅 `@Public()` +1씩) · 범용 API 채널 · 음성 전화 자동 연동(No.32) · 이메일 수신 적재·회신(No.41 내장 메일) · 봇 슬롯 이월(No.34) · AI 요약·답변 제안(옵션 AI) · 위젯 지난 대화 복원(ADR-0009 트리거 ③) · 연락처 병합 제안 · 자동 배정·SLA·대기열(No.24 후속) · 스레드 이벤트 업무 자동화(No.41 확장) · 고객 단위 정보주체 파기(No.45 2차 — 착수 조건 충족) · 고유 방문자 통계 · 멀티테넌시 가시성 · 고객 키 재해시 · CRM 연동(No.39) · 인박스 통계(No.29 확장) · 채널별 리치 출력(No.46) · 토큰 재생 탐지.

## 27. 구현 편차 기록(I-n)

| # | 내용 | 근거 | 영향 파일 |
|---|---|---|---|
| I-1 | §9.1의 "쿼리 ≤7"은 Prisma `include`가 SQLite에서 네이티브 JOIN 없이 관계마다 별도 `SELECT … WHERE id IN (…)`로 배치되는 것을 가정하지 못했다(직접 실측 확인 — `relationLoadStrategy: 'join'`은 SQLite 미지원, Prisma 5.22 기준 PostgreSQL/MySQL/CockroachDB/SQL Server 전용). `customer`(to-one)·`inbox_thread_tags`+`inbox_tags`(m:n)의 관계 로딩만으로 물리 쿼리 +3이 붙는다. 원시 SQL로 JOIN을 직접 짜면 O-17(`$queryRaw`/`$executeRaw` 보유 파일 수 4 불변) 위반이라 채택하지 않았다. **조정**: 논리 7단계 설계는 그대로 두고(참여 캐시로 챗봇 이름·목록 쿼리 0 달성), 실측 상한을 서비스 단독 호출 ≤10 · HTTP 종단(인증 미들웨어 2 포함) ≤12로 재설정했다 — `inbox-query.service.ts`(list) 상단 주석 및 `omnichannel-inbox-query-count.integration.spec.ts`에 실측 근거를 남겼다. Postgres 전환 시 `relationJoins`를 켜면 예산이 다시 7에 근접할 수 있다(재검토 트리거 후보로 추가). | 2026-09-27 실측(PrismaClient 쿼리 이벤트 계측) | `apps/api/src/inbox/read/inbox-query.service.ts`, `apps/api/src/inbox/core/inbox-participation.cache.ts`, `apps/api/src/integration/omnichannel-inbox-query-count.integration.spec.ts` |
| I-2 | `keyFingerprintChanged`(고객 키 비밀 교체 탐지, §20-6)는 항상 `false`로 둔다 — K-3(2차)로 이미 분류된 항목이라 이번 그룹에서 실제 탐지 로직(현재 비밀의 지문과 기존 고객 행 지문 분포 비교)은 구현하지 않는다. | PM 승인(K-3 2차 유지) | `apps/api/src/inbox/manage/chatbot-inbox-settings.service.ts` |
| I-3 | seed에 "데모 챗봇 참여 설정(꺼짐) 1행"을 추가하지 않았다 — `ChatbotInboxSetting` 행이 아예 없는 것과 `enabled:false` 행이 있는 것은 참여 판정(행 존재 여부로 조회)상 관측 가능한 차이가 없어(캐시·API 응답 모두 동일) 화면 확인 편의 외의 기능적 이득이 없다. | PM 승인(축소 수용) | `apps/api/prisma/seed.ts`(변경 없음) |
| I-4 | O-18(`=== 'WEB'` 리터럴 비교 0건)을 저장소 전수가 아니라 이 그룹이 실제로 정리한 범위(`live-sessions.service.ts`, C-4)로 좁혔다 — `channels.service.ts`·`workflow-trigger.service.ts`의 기존 비교문은 No.42 이전부터 있었고 이 그룹의 변경 파일 목록(§2.5) 밖이라 손대지 않았다. 전수 적용(2곳 정리)은 후속 과제로 남긴다(별도 그룹 또는 system-architect 승인 후 착수). | PM 승인(축소 수용) — 후속 과제 | `apps/api/src/channels/channels.service.ts`, `apps/api/src/workflow/triggers/workflow-trigger.service.ts`(미변경) |
| I-5 | **코드 리뷰 R1(FAIL) H-1 반영** — `inbox-thread-detail.service.ts`의 `handoffs: []` 하드코딩을 §9.2 item 3대로 채웠다. 연결 세션 페이지 전체에 대해 `handoffSession.findMany`(OR 조건) 1 + `handoffMessage.findMany`(`handoffSessionId in`) 1 — 연결 세션 수와 무관하게 1+1(§9.2 설계값 그대로, 조정 불필요). `rawText`는 선택하지 않는다(`select` 목록에서 제외 — O-10 정적 검사가 이 파일도 스캔). `text`는 `inbox-text.reader.ts`의 기존 `openHandoffText()`(`HANDOFF_TEXT` 개봉)로 열고, `textPurgedAt`이 있으면 빈 문자열 + `purged: true`(No.45와 동일 규약). §9.2에는 이 기능 단위의 별도 쿼리 상한 수치가 없어(§18 NFR-OCP2는 지연시간만 규정) I-1과 달리 예산 재조정은 필요 없다 — 다만 상세 엔드포인트에는 아직 `omnichannel-inbox-query-count.integration.spec.ts` 같은 전용 쿼리 수 계측 시험이 없다(test-automation에 후속 요청). | 코드리뷰 R1(2026-09-26) | `apps/api/src/inbox/read/inbox-thread-detail.service.ts`, `packages/shared-types/src/inbox.ts`(`TimelineConversationUnitSchema.linkId`), `apps/api/src/integration/omnichannel-inbox.integration.spec.ts`(H-1 시험) |
| I-6 | **코드 리뷰 R1 M-1 반영 + 부수 발견** — `inbox-signal.service.ts`의 `{caution:2, warning:3}` 하드코딩을 `ChatbotHandoffSetting.cautionThreshold`/`warningThreshold` 조회로 교체했다(행이 없으면 여전히 2/3 — §8.1 그대로). **구현 중 발견한 별도 버그**: 기존 코드는 `claimWarningOpen()`(세션당 1회 CAS 표식)을 `evaluateSessionAlert()` **앞**에서 호출했다 — 첫 미응답 턴(누적 1)에서 표식이 곧바로 소진되고, 정작 WARNING 문턱(기본값 3)에 도달하는 뒤 턴에서는 이미 "사용됨" 취급되어 스레드가 **영원히 열리지 않는** 회귀였다(커스텀 임계값 여부와 무관 — 리뷰 이전부터 있던 결함, 이번 그룹 첫 통합 시험에서 처음 발견). 판정 → 클레임 순서로 바꿔 해결했다. | 코드리뷰 R1(2026-09-26) + 구현 중 발견 | `apps/api/src/inbox/core/inbox-signal.service.ts`, `apps/api/src/integration/omnichannel-inbox.integration.spec.ts`(M-1 시험) |
| I-7 | **코드 리뷰 R1 M-2 반영** — 표시 이름 정리 순서(`sanitizeDisplayName()` → 금지어 마스킹 → `maskForInbox()`)를 `inbox-customers.service.ts#createAnonymous`·`inbox-test-customers.service.ts#create`에도 적용해 식별 서비스와 동일하게 맞췄다. 세 곳이 공유하는 공용 함수 `prepareDisplayName()`(`core/lib/display-name.ts`)을 신설했다(순수 정리 + 주입된 금지어 필터 호출 — §2.2가 `inbox`(최상위 모듈)의 의존으로 이미 `banned-words`를 나열해 뒀었는데 실제 import가 빠져 있었다). `InboxModule`에 `BannedWordsModule` import를 추가했다(`InboxIdentityModule`은 이미 갖고 있었다). | 코드리뷰 R1(2026-09-26) | `apps/api/src/inbox/core/lib/display-name.ts`, `apps/api/src/inbox/identity/inbox-identity.service.ts`, `apps/api/src/inbox/manage/inbox-customers.service.ts`, `apps/api/src/inbox/manage/inbox-test-customers.service.ts`, `apps/api/src/inbox/inbox.module.ts` |
| I-8 | **코드 리뷰 R1 M-3 반영 + 부수 발견** — `list-where.ts`에 `channelFamily`(DEPLOY|RECORD|SIMULATED) 조건(`lastChannelFamily: { in: … }`)을 구현했다. 구현 중 확인해 보니 `InboxThread.lastChannelFamily` 컬럼이 **어느 쓰기 경로에서도 채워진 적이 없었다**(`inbox.store.ts`의 `ensureThreadForSignal`·`linkIdentity`·`touchThreadForEntry`가 전부 `lastChannelType`만 갱신하고 `lastChannelFamily`는 빠뜨렸다) — 필터만 새로 짜면 실제 데이터가 전부 `null`이라 아무것도 좁혀지지 않는 죽은 필터가 됐을 것이다. 신호(상담·경고)·식별 연결 = `DEPLOY`, 수동 기록 = `RECORD`(+`recordChannel`), 시뮬레이션 = `SIMULATED`(+`simulatedChannel`)로 채우도록 쓰기 경로를 보강했다. 메모(NOTE)는 채널 개념이 없어 손대지 않는다(직전 값 유지). | 코드리뷰 R1(2026-09-26) + 구현 중 발견 | `apps/api/src/inbox/read/lib/list-where.ts`, `apps/api/src/inbox/core/inbox.store.ts`, `apps/api/src/inbox/read/lib/list-where.spec.ts`, `apps/api/src/integration/omnichannel-inbox.integration.spec.ts`(M-3 시험) |
| I-9 | **코드 리뷰 R1 L-1 반영** — `view-audit-targets.ts`의 `InboxThreadsController` 상세 핸들러 이름을 실제 컨트롤러 메서드명(`getDetail`)과 일치하도록 `'detail'` → `'getDetail'`로 정정했다(정적 검사 G-15/O-19는 개수만 세고 문자열 일치는 보지 않아 이전에는 시험이 통과하고 있었다 — 런타임 동작에는 영향 없었지만 목록의 실제 의미가 틀려 있었다). | 코드리뷰 R1(2026-09-26) | `apps/api/src/audit-logs/access/view-audit-targets.ts` |
| I-10 | **코드 리뷰 R1 L-3 반영** — `updateNote`가 경로의 `threadId`와 실제 `entry.threadId`가 일치하는지 검증하도록 컨트롤러·서비스 시그니처에 `threadId`를 추가했다(불일치·다른 스레드 소속 메모 = `404 NOT_FOUND`, 메모를 찾을 수 없다는 기존 메시지 그대로 재사용 — 존재 여부 추론 방지). | 코드리뷰 R1(2026-09-26) | `apps/api/src/inbox/controllers/inbox-threads.controller.ts`, `apps/api/src/inbox/manage/inbox-threads.service.ts`, `apps/api/src/integration/omnichannel-inbox.integration.spec.ts`(L-3 시험) |
| I-11 | **코드 리뷰 R1 L-2 반영(수용 + 기록)** — `InboxSignalService`·`InboxIdentityService`는 인스턴스당 **단일** `pending` 프라미스 체인으로 모든 챗봇·세션의 신호/식별 처리를 순차 직렬화한다(§8.1·§6.5 설계 그대로 — `drainForTest()`가 결정적으로 동작하려면 필요한 구조). 성능 특성: 처리 1건당 DB 왕복이 여러 번(식별 3~5 · 신호 경고 판정 최대 6)이라, 트래픽이 몰리면 뒤 요청의 처리 완료가 지연될 수 있다 — 다만 **HTTP 응답 자체는 절대 이 체인을 기다리지 않는다**(fire-and-forget이라 사용자 체감 지연 0)는 점이 완화 요인이다. 지연되는 것은 "인박스에 반영되는 시점"뿐(상담원 화면 갱신 지연 — 폴링 주기 `OMNI_INBOX_POLL_MS` 안쪽이면 체감 차이가 작다). 이번 그룹은 이 구조를 그대로 수용하고, 챗봇당 별도 체인으로 나누는 등의 병렬화는 하지 않는다. **후속 과제**: 참여 챗봇·동시 세션 규모가 커졌을 때(수백~수천 세션/분) 이 단일 체인이 실제 병목이 되는지 부하 시험으로 확인해야 한다(재검토 트리거 후보 — §26에 미등재, 다음 문서 개정 시 추가 검토). | 코드리뷰 R1(2026-09-26) — 수용 | `apps/api/src/inbox/core/inbox-signal.service.ts`, `apps/api/src/inbox/identity/inbox-identity.service.ts` |
| I-12 | **프론트엔드 계약 보강(B-1~B-7)** — ① `TimelineConversationUnitSchema.linkId`(= `CustomerLink.id`) 추가(분리 버튼용). ② `MERGED_IN`/`PROMOTED` `SYSTEM` 항목의 `meta`에 `mergeId` 추가(되돌리기 버튼용 — `system.data`는 이미 `z.record(...)`라 스키마 변경 없이 값만 추가). ③ `MergeResultSchema.targetThreadId: string \| null` 추가. ④ `HandoffHistoryItemSchema.sessionRef: string` 추가 — H-17 봉인은 `sessionId` 키 **부재**만 검사해(`sessionRef` ≠ `sessionId`) 영향 없음 · 별도 X-n 불필요. ⑤ `IdentitySpaceListResponseSchema`를 `string[]` → `{ ref, chatbots: {id,name}[] }[]`로 **형태를 바꿨다**(하위 호환 불가 — 콘솔이 "이 공간을 쓰는 챗봇"을 표시하려면 문자열 배열로는 담을 수 없다). 영향 범위 확인: api 쪽엔 이 스키마의 정확한 키 집합을 검사하는 시험이 없고, 권한 매트릭스 시험은 상태 코드만 본다 — 계약 변경의 실제 반영은 apps/web(frontend-implementer)의 몫. ⑥ `ChatbotInboxSettingsResponse.identity.stats24h.failures`를 `z.record(...)`(부분 허용)에서 7키 전부 필수인 `IdentityFailureStatsSchema`로 좁혔다 — `IdentityFailureCounter.stats24h()`는 원래도 7키를 항상 채워 반환해 서비스 코드 변경은 0. ⑦ `SimulateInboxResponse.degradePreview`는 §10.2·R-18에 **1차 범위 의도적 고정값**으로 이미 명시돼 있어(No.46 착수 시 `degradeOutputs()`로 교체 예정) 손대지 않았다 — 이 표에 재확인만 남긴다. | 코드리뷰 R1 계약 보강 요청(2026-09-26) | `packages/shared-types/src/inbox.ts`, `packages/shared-types/src/handoff.ts`, `apps/api/src/handoff/handoff-history.service.ts`, `apps/api/src/inbox/read/inbox-query.service.ts`, `apps/api/src/inbox/core/inbox.store.ts` |
| I-13 | **코드 리뷰 R2 반영 H-2** — `openOnWarning`이 사전 `CustomerLink`가 없는 순수 익명 세션에서 한 번도 열리지 않는 회귀를 고쳤다. 원인: `claimWarningOpen()`(CAS)이 기존 링크 행에만 동작하는데, 링크를 만드는 `ensureThreadForSignal()`은 클레임이 성공해야만 호출되는 순환 의존이었다. `InboxStore.openWarningThread()`를 신설해 한 트랜잭션 안에서 처리한다: 링크가 없으면 익명 고객·링크(생성 시각에 곧바로 `warningOpenedAt` 기록 — "생성 자체가 클레임")를 만들고, 생성 경합(P2002)은 흡수해 CAS 분기로 넘어간다. 링크가 있으면 `warningOpenedAt IS NULL` CAS만 수행한다. 스레드 열기/재열림 공통부는 `ensureThreadOpenTx()`로 뽑아 `ensureThreadForSignal()`과 공유한다. `InboxSignalService`는 더 이상 `claimWarningOpen()`+`ensureThreadForSignal()` 두 단계를 순서대로 부르지 않고 `openWarningThread()` 한 번만 부른다(옛 `claimWarningOpen()` 메서드는 삭제). 기존 M-1 시험은 식별 링크를 먼저 만들어 이 문제를 우회하고 있었다 — 우회 없는 케이스(H-2 통합 시험)와 동시 경합 케이스(concurrency 스위트 ⑤)를 추가했다. | 코드리뷰 R2(2026-09-26) | `apps/api/src/inbox/core/inbox.store.ts`, `apps/api/src/inbox/core/inbox-signal.service.ts`, `apps/api/src/integration/omnichannel-inbox.integration.spec.ts`(H-2·M-1 주석 정정), `apps/api/src/integration/omnichannel-inbox-concurrency.integration.spec.ts`(⑤) |
| I-14 | **코드 리뷰 R2 반영 M-4** — `inbox-thread-detail.service.ts`의 `activeHandoffCount: 0` 하드코딩을 실제 값으로 교체했다. `detail()`에서 `buildActiveHandoffs(links)`를 `toListItem()`보다 먼저 호출하도록 순서를 바꾸고, 그 결과 길이를 `toListItem()`에 새 매개변수(`activeHandoffCount`)로 전달한다(§9.2 item 3의 값 재사용 — 추가 쿼리 0). | 코드리뷰 R2(2026-09-26) | `apps/api/src/inbox/read/inbox-thread-detail.service.ts`, `apps/api/src/integration/omnichannel-inbox.integration.spec.ts`(M-4 시험) |
| I-15 | **코드 리뷰 R2 반영 M-5** — `omnichannel-inbox-query-count.integration.spec.ts`의 AC-OC1-1이 단독 3회 중 2회 실패할 만큼 불안정했다. 원인: `InboxIdentityService.observe()`(및 `InboxSignalService.signal()`)가 fire-and-forget이라 HTTP 응답이 돌아온 뒤에도 참여 캐시 확인 등 내부 처리가 잠시 더 실행될 수 있어, 그 잔여 실행이 계측 창 경계와 겹치며 쿼리 수가 흔들렸다. 계측 전후(예열 포함)로 두 서비스의 `drainForTest()`를 호출해 처리 완료를 결정적으로 기다리도록 재설계했다 — 드레인 후에는 두 요청 경로가 실제로 추가 쿼리 0을 내므로 불변식을 `<=`에서 `===`(정확히 같다)로 강화했다. 단독 10회 연속 통과를 확인했다. | 코드리뷰 R2(2026-09-26) | `apps/api/src/integration/omnichannel-inbox-query-count.integration.spec.ts` |
| I-16 | **코드 리뷰 R2 반영 M-6(Low)** — 타임라인의 상담 메시지 로딩에 `sessionTurnsMax`와 같은 방식의 상한이 없었다(무제한 `handoffMessage.findMany`). `INBOX_LIMITS.handoffMessagesPerSessionMax`(200)를 신설해 쿼리에 `take: handoffMessagesPerSessionMax × handoffIds.length`(§9.2의 1+1 쿼리 예산 불변 — 그룹 전체에 대한 총량 상한이라 상담별 정확한 상한은 아니지만 값이 충분히 커 실사용에서는 사실상 같다)를 적용하고, 각 상담 단위 응답에 상한 도달 시 `truncated: true`를 붙인다(`TimelineConversationUnitSchema.handoffs[].truncated` 신설 — 계약 추가, 하위 호환). | 코드리뷰 R2(2026-09-26) | `packages/shared-types/src/inbox.ts`, `apps/api/src/inbox/read/inbox-thread-detail.service.ts` |
| I-17 | **프론트엔드 계약 보강(ui-spec §3.6b — 되돌리기 버튼 사전 판정)** — ① `MERGED_IN`/`PROMOTED` `SYSTEM` 항목의 `meta`에 `mergedByUserId`(승격이면 `null`)·`mergedAt`(ISO 문자열)·`mergeKind`(`'MANUAL'` \| `'PROMOTED'`)를 추가했다(`system.data`는 이미 `z.record(...)`라 스키마 변경 없이 값만 추가 — I-12와 동일 패턴). ② `GET /inbox/threads/:threadId` 응답(`InboxThreadDetailSchema`)에 `mergeRevertHours: number`(= `OMNI_MERGE_REVERT_HOURS` 설정값)를 추가했다 — 추가만 하는 필드라 하위 호환. 콘솔은 기존처럼 "24시간 고정"을 가정하지 않고 이 값으로 사전 판정 기준을 맞출 수 있다(운영자가 `OMNI_MERGE_REVERT_HOURS`를 24가 아닌 값으로 바꿔도 화면과 서버 판정이 어긋나지 않는다). | 계약 보강 요청(2026-09-26) | `apps/api/src/inbox/core/inbox.store.ts`, `apps/api/src/inbox/read/inbox-thread-detail.service.ts`, `packages/shared-types/src/inbox.ts`, `apps/api/src/integration/omnichannel-inbox-identity-failures.integration.spec.ts` |
| I-18 | **코드 리뷰 R2 반영 L-4(Low)** — `openFromSession`이 기존 `CLOSED` 스레드를 다시 열지 않던 문제를 고쳤다. §8.2 재열림 규칙대로 상담원 쪽 사건(MANUAL 트리거)은 `CLOSED` → `OPEN`만(`PENDING`은 유지) 바꿔야 한다 — `InboxStore.reopenClosedThreadManual()`을 신설해 기존 스레드 분기에서 호출하도록 했다(`version` 증가 포함). | 코드리뷰 R2(2026-09-26) | `apps/api/src/inbox/core/inbox.store.ts`, `apps/api/src/inbox/manage/inbox-threads.service.ts`, `apps/api/src/integration/omnichannel-inbox.integration.spec.ts`(L-4 시험) |
