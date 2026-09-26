# 채널별 리치 메시지 컴포넌트 세부 설계서 (No.46)

> **요구사항**: `docs/requirements/channel-rich-messages.md`(T-1~T-6, J-1~J-16, FR-0-194~202, FR-RM1-\*~FR-RM8-\*, NFR-RMP/RMS/RMR/RMA/RMM, AC-RM1~RM7, EX-RM-1~20, 제약 C-1~C-13, P-1~P-12)
> **상위 문서**: `docs/02-spec/개발명세서.md` §2·§2.2·§3·§3.1·§4·§4.1·§5·§6(**결정 44 신설**)·§7
> **신규 ADR**: **ADR-0043**(리치 메시지 = `CAROUSEL` 새 타입 1 + `BUTTON.display` 선택 키 · 채널 출력 능력 프로필(속성 표 1곳) · 3단 강등 순수 함수 1벌 · 구버전 위젯 `rich-v1` · 새 컴포넌트 https 전용). ⚠ 요구사항이 제안한 "ADR-0046"은 가번호다 — `decisions/`의 현재 최대가 0042라 **0043**이다.
> **갱신 ADR(각주만)**: **ADR-0011(능력표 아웃풋 프로필 · 어댑터 파생 · `renderOutbound` 문맥 인자 · 강등 3단)** · **ADR-0012(Preact 재검토 트리거 점검 — 미발동)** · **ADR-0042(R-18 이행 — `degradePreview` 합집합)** · ADR-0002(동반 삭제 23 → 24) · ADR-0031(새 타입·선택 키 스냅샷 포함 · `.default()` 금지) · ADR-0034(BUTTON 재조립 결함 재발 방지) · ADR-0035(위젯 설문 컴포넌트 트리거 — 미발동) · ADR-0038(기능 선언 3번째 `rich-v1`)
> **작성일**: 2026-09-27 · **GPU**: **1 유지**(P-12 — 스키마 검증·순수 변환·DOM 렌더뿐 · 모델·학습·추론 0 · ml-worker 변경 0) — §23
> **기존 파일 수정 목록**: 문서는 `docs/02-spec/channel-rich-messages-patches.md`, 코드는 이 문서 §2.5 · §15.
> **표기**: 이 문서의 엔진 변경 번호는 **EN-1~EN-6**이다(`environment-sealing.spec.ts`의 봉인 번호 E-n과 구분 — "E-5"는 그 파일의 엔진 표면 골든 스냅샷을 뜻한다).

---

## 0. 이 문서가 푸는 문제 (한 문단 요약)

카탈로그 No.46은 "카카오톡 바로연결버튼·캐러셀 등 채널 고유 UI 컴포넌트를 대화그래프 아웃풋에서 선택"이다. 1차에 실제로 대화가 오가는 채널은 **WEB 하나**이므로(ADR-0011 · ADR-0042), 이 설계는 **새 컴포넌트를 쓰지 않는 챗봇·구버전 위젯의 결과를 한 바이트도 바꾸지 않고** 다음을 만든다. ① **캐러셀**(새 타입 `CAROUSEL` — 카드 2~10장, 카드당 버튼 ≤3)과 **바로연결 버튼**(기존 `BUTTON`의 선택 키 `display: 'QUICK_REPLY'`)을 노드 편집기에서 고르고 **WEB 위젯에서 실제로 렌더** ② 8개 배포 채널의 **출력 능력표**(WEB 실측 · 카카오톡 가정치 · 나머지 텍스트만)를 No.42의 속성 표 `CHANNEL_CAPABILITIES` 한 곳에 두고 ③ **3단 강등 순수 함수**(원형 → 대체 컴포넌트 → 텍스트) 1벌을 서버(구버전 위젯·시뮬레이션)와 콘솔(채널별 미리보기·저장 경고)이 함께 쓴다 ④ No.42 시뮬레이션의 `degradePreview`를 실제 값으로 채운다 ⑤ 새 컴포넌트의 이미지·링크는 **https 전용 + 피싱 형식 차단 + (선택) 챗봇별 허용 도메인 목록**이다. 엔진은 기존 2파일의 **분기 추가만** 하고(새 파일·새 export 0 — 엔진 표면 골든 불변), 금지어·로그·강등 후처리는 **모든 타입을 명시하고 `never`로 망라**해 "새 타입이 조용히 새는" 결함 유형을 구조적으로 닫는다.

> 이 설계가 코드에서 **추가로 찾은 제약 12건**(요구사항 C-1~C-13 외):
> **① 공개 응답은 계약 시험에서 `PublicMessageResponseSchema.parse`로 검증된다**(`quality-channel.integration.spec.ts` 477행 · `nlu-rag-answering.integration.spec.ts` 272행) → 엔진·강등이 내보내는 모든 아웃풋은 `DialogOutputSchema`를 통과해야 한다. 치환 뒤 **카드 1장만 남은 캐러셀**(스키마 2~10장)은 그대로 내보낼 수 없다 → 엔진이 `CARD`로 바꾼다(§5.3 · R-2) ·
> **② 기존 `degradedText('PAUSE')`는 빈 문자열 `TEXT`를 만든다**(`output-degrade.ts` 27~28행 — `TextOutputPayloadSchema`는 1자 이상) → 운영 경로 도달 0이지만 새 강등 함수는 `PAUSE` 미지원 시 **제거**한다(R-6) ·
> **③ WEB 능력의 상한을 캐러셀 카드 기준(버튼 3)으로 하나만 두면 기존 `CARD`(버튼 ≤5)가 WEB에서 잘린다** → 프로필에 `cardMaxButtons`(기존 CARD)와 `carouselCardMaxButtons`(캐러셀 카드)를 분리하고 WEB의 모든 상한 = 스키마 최대치(§7.1 · R-4) ·
> **④ `ButtonItemSchema`의 LINK 검사는 `SafeUrlSchema`(http 허용)다**(`dialogue.ts` 497행) → 캐러셀 카드 버튼은 `RichButtonItemSchema`(https 추가 검사)로 감싼다(§4.1) ·
> **⑤ 위젯 `resolveButtonAction`은 `isSafeHttpUrl`(http 허용)로 판정한다**(`output-view.ts` 23~26행) → 캐러셀 렌더러는 버튼을 그리기 전에 `isSafeRichUrl`로 LINK를 **걸러낸다**(서버 우회 주입 방어 — AC-RM5-4) ·
> **⑥ 노드 저장 검증은 zod 스키마 + 서비스 단언의 조합이다**(`dialog-nodes.service.ts` 64~103행 — `WORKFLOW` ≤3 선례) → 바로연결 배치 규칙은 읽기 스키마(`DialogNodeSchema`)가 아니라 **서비스 저장 단언**으로 둔다(읽기 경로 불변 — R-15) ·
> **⑦ `@Public()` 전수 스캔 시험이 등록 컨트롤러 목록을 하드코딩한다**(`public-decorator-count.spec.ts` 110행 — 45개) → 신규 컨트롤러 1개 = X-3 ·
> **⑧ 영구삭제 트랜잭션 목이 동반 삭제 테이블을 나열한다**(`chatbots.service.spec.ts` — No.42 X-4 선례) → X-4 ·
> **⑨ 위젯은 메시지 이력을 저장·복원하지 않는다**(`core/session.ts` — `sessionId`·`state`만) → "새로고침 시 마지막 턴 칩 복원"은 할 수 없다 → 새로고침 = 칩 없음(R-13) ·
> **⑩ 위젯 메시지 목록은 봇 메시지 요소를 먼저 `role="log"`에 붙이고 그 안에 내용을 채운다**(`message-list.ts` 135~148행 — 평가 막대도 같은 요소) → 바로연결 칩 묶음은 같은 메시지 요소 안(말풍선 뒤·평가 막대 앞)에 한 번만 만들고 이후에는 `hidden` 속성만 바꾼다 ·
> **⑪ 상태 알림 영역 `#cb-status`(`role="status"`)와 "자기 문구일 때만 지우기" 헬퍼가 이미 있다**(`panel.ts` 58행 · `app.ts` 316~329행) → 캐러셀 위치 안내는 이것을 재사용한다(새 live 영역 0) ·
> **⑫ 대량 가져오기(No.9) 자원에 대화 노드가 없다**(`bulk-import.ts` 11행 — `INTENT｜KEYWORD｜FAQ｜TEST_CASE`) → EX-RM-17은 해당 없음(R-14).

---

## 1. PM 확정 사항 (2026-09-27 — P-1~P-12 전부 추천안)

| # | 확정 내용 | 이 문서에서의 반영 |
|---|---|---|
| **P-1 (a)** | WEB 위젯에서 실제 렌더 · 8채널 능력표(WEB 실측 · 카카오 가정치 · 나머지 텍스트만) · 다른 채널은 추정 미리보기 · 카카오 전용 모델링·실연동 2차 | §7 · §11 · §12 |
| **P-2 (a)** | 캐러셀 + 바로연결 버튼(닫힌 목록) | §4.1 · §5 · §12 |
| **P-3 (a)** | 3단 자동 강등 · 콘솔 채널별 미리보기 · 저장 시 경고(비차단) · No.42 `degradePreview` 실제 값 | §7 · §8 · §11 |
| **P-4 (a)** | 새 컴포넌트 https 전용 · 피싱 형식(`@` 등) 차단 · 허용 도메인 목록(선택) · 업로드 2차 | §9 |
| P-5 | `CAROUSEL` 새 타입 · 바로연결 = `BUTTON.display?: 'QUICK_REPLY'` | §4.1 · §5 |
| P-6 | 클릭 기록 기존 수준 | §13 · §19 |
| P-7 | 카드 2~10장 · 카드당 버튼 ≤3 | §4.1 |
| P-8 | `rich-v1` 없는 위젯 = 서버가 캐러셀을 CARD 여러 개로 강등 | §8 |
| P-9 | 위젯 vanilla · 증가 ≤6KB · ADR-0012 Preact 트리거 미발동 | §12.4 |
| P-10 | 신규 권한 0 | §13 |
| P-11 | 2차 = 요구사항 §9 | §24 |
| P-12 | GPU 1 | §23 |
| (architect) | ADR 번호 = **0043**(요구사항 가번호 0046 정정) | R-1 |
| (architect) | 강등 함수 위치 = `packages/shared-types/src/rich-degrade.ts`(zod 무의존) · 소비자 = api·콘솔(**위젯은 import하지 않음** — 서버 강등) | §7 · R-8 |
| (architect) | 능력표 = `CHANNEL_CAPABILITIES[type].outputs` + 표 밖 가상 프로필 `LEGACY_WEB_WIDGET_OUTPUT_PROFILE` · `cardMaxButtons`/`carouselCardMaxButtons` 분리 | §7.1 · R-4 · R-19 |
| (architect) | 어댑터 계약 = `renderOutbound(outputs, ctx?: ChannelRenderContext)` · `ctx.features` · 인자 없음 = 구버전(안전측) | §8.1 |
| (architect) | 치환 뒤 1장 남은 캐러셀 = `CARD` 1개(+ 안내 문구 `TEXT`) — 엔진 출력 스키마 유효 불변식 | §5.3 · R-2 |
| (architect) | 구버전 위젯 강등 시 `display` **제거**(강등 사다리 일관성) | §7.2 · R-3 |
| (architect) | 미리보기·저장 경고 = 콘솔 순수 함수(`output-preview` API 미채택) · 설계 점검(엔진)에 채널 규칙 0 | §11 · R-9 |
| (architect) | 허용 도메인 목록 = 신규 1:1 테이블 `ChatbotRichUrlPolicy` → **마이그레이션 1개**(`CREATE TABLE`만 · 부분 유니크 4 보존) · 검사 = 노드 편집 API 저장 시점 · 그 밖 경로는 설계 점검 경고 | §3 · §9.3 · §10 · R-10 |
| (architect) | `degradePreview` = `'NOT_DEFINED' ∪ { channelType, source, outputs, changes }` · 서비스는 항상 객체 반환 | §4.7 · §11.6 · R-18 |
| (architect) | 끝 버튼 = `aria-disabled="true"`(포커스 유지) · 새로고침 칩 복원 없음 · 한 턴 여러 바로연결 = 마지막만 칩 | §12 · R-12 · R-13 |
| (architect) | 기대값 변경 닫힌 목록 X-1~X-4 · 새 타입 수정 지점 닫힌 목록 22곳(§15) | §18.3 · §15 |

---

## 2. 아키텍처 배치

### 2.1 파일 구조 (신규 · 주요 수정)

```
packages/shared-types/src/
├── dialogue.ts            # [수정] DialogOutputType +CAROUSEL · CAROUSEL_LIMITS · RichButtonItemSchema · CarouselCardSchema
│                          #        CarouselOutputPayloadV1Schema · ButtonOutputPayloadSchema.display? · findQuickReplyPlacementIssues()
├── common.ts              # [수정] RichHttpsUrlSchema(신규 export — SafeUrlSchema 불변)
├── rich-url.ts            # [신규·zod 무의존] inspectRichUrl() · isSafeRichUrl() · hostMatchesRules() · RICH_URL_MAX_LENGTH · KNOWN_URL_SHORTENER_HOSTS
├── rich-degrade.ts        # [신규·zod 무의존] ChannelOutputProfile · degradeForProfile() · DEGRADE_CHANGE_KINDS · OUTPUT_PROFILE_SOURCES
├── rich-message.ts        # [신규] 허용 도메인 목록 계약(RichUrlHostRuleSchema · UpdateRichUrlPolicySchema · RichUrlPolicyResponseSchema)
├── channel.ts             # [수정] CHANNEL_CAPABILITIES[*].outputs · LEGACY_WEB_WIDGET_OUTPUT_PROFILE · outputProfileFor()
├── output-view.ts         # [수정] toOutputViews 대상 +CAROUSEL · outputsToPlainText 망라 · isSafeRichUrl 재노출(./rich-url)
├── conversation.ts        # [수정] WIDGET_FEATURE_RICH_V1 = 'rich-v1'
├── inbox.ts               # [수정] DegradePreviewSchema · SimulateInboxResponse.degradePreview 합집합
├── dialogue-engine.ts     # [수정] DesignIssueCode +2(RICH_URL_NOT_ALLOWED · RICH_URL_SUSPICIOUS — API 계층 산출)
└── index.ts               # [수정] export 추가
packages/dialogue-engine/src/
├── outputs.ts             # [수정 — 분기 추가만] case CAROUSEL · default never · BUTTON 재조립 스프레드 · 내부 applyApiVariablesToCarousel
└── design-validator.ts    # [수정 — 분기 추가만] getOutgoingNodeRefs 캐러셀 카드 버튼 · ⑦ URL 필드 캐러셀
apps/api/src/
├── rich-messages/                          # ── 신규 모듈(export 0) ──
│   ├── rich-messages.module.ts             # controllers [RichUrlPolicyController] · exports []
│   ├── rich-url-policy.controller.ts       # GET·PUT /chatbots/:chatbotId/rich-url-policy — 2 핸들러
│   ├── rich-url-policy.service.ts          # ★ chatbotRichUrlPolicy 쓰기 유일(영구삭제 동반 삭제 제외) · 감사
│   ├── rich-url-policy.mapper.ts
│   └── lib/
│       ├── collect-rich-urls.ts            # 순수 — 새 컴포넌트 URL(카드 이미지·카드 LINK 버튼) + zod 경로 수집
│       ├── rich-url-issues.ts              # 순수 — 설계 점검 RICH_URL_NOT_ALLOWED·RICH_URL_SUSPICIOUS · 목록 밖 노드 수
│       └── rich-message-sealing.spec.ts    # §16 RM-1~RM-18
├── conversation/adapters/{channel-adapter.ts, web-channel.adapter.ts}   # [수정] ChannelRenderContext · 표 파생 · 프로필 선택
├── conversation/lib/output-degrade.ts      # [수정] degradeForProfile 래퍼(기존 시그니처 유지 + 프로필 오버로드)
├── conversation/public-conversation.service.ts   # [수정] renderOutbound(result.outputs, { features: dto.features }) 1줄
├── banned-words/lib/output-text-fields.ts  # [수정] CAROUSEL · 전 타입 명시 · never
├── dialog-nodes/{dialog-nodes.service.ts, lib/node-target-refs.ts}      # [수정] 배치 단언 · 허용 목록 검사 · 점검 병합 · 캐러셀 참조
├── asset-transfer/lib/system-node-trim.ts  # [수정] 캐러셀 카드 버튼 TRIM/FOLLOW
├── inbox/manage/{inbox-test-customers.service.ts, lib/degrade-preview.ts(신규·순수)}   # [수정] degradePreview 채움
├── chatbots/chatbots.service.ts            # [수정] 동반 삭제 +1
├── audit-logs/lib/audit-snapshot.ts        # [수정] AUDIT_FIELDS.Chatbot +richUrlHosts
└── app.module.ts                           # [수정] imports 끝 RichMessagesModule
apps/widget/src/
├── constants/rich.ts                       # [신규] WIDGET_FEATURE_RICH_V1 복제 + 문구
├── core/{carousel.ts, quick-reply.ts}      # [신규·순수] 위치·가장 가까운 카드·버튼 상태 / 마지막 바로연결 선택·칩 분리
├── ui/renderers/{carousel.ts, quick-reply.ts}   # [신규] DOM
└── (수정) api/public-client.ts · ui/renderers/index.ts · ui/message-list.ts · ui/app.ts · styles.ts
apps/web/src/  — §11(편집기·미리보기·시뮬레이터·인박스·설정)
```

### 2.2 모듈 의존 방향

```
rich-messages   → chatbots(ChatbotScopeService) · audit-logs · prisma · config        (도메인 모듈 import 0 · export 0)
dialog-nodes    → (기존) + Prisma 읽기 chatbotRichUrlPolicy(1쿼리 — 모듈 import 0) + rich-messages/lib 순수 함수 파일 import
conversation    → shared-types(degradeForProfile · CHANNEL_CAPABILITIES) — 새 모듈 import 0
inbox           → shared-types(degradeForProfile) — 새 모듈 import 0
엔진            → shared-types(스키마·타입) — 채널·강등·프로필 심볼 0(RM-1)
widget          → shared-types/output-view(zod 무의존 서브패스 — rich-url 포함) — rich-degrade import 0
```

- `RichMessagesModule`의 export는 **0개**다. 노드 저장 검증은 허용 목록을 **Prisma로 직접 읽는다**(읽기 1쿼리 — 서비스 계층 Prisma 허용 규약) — 쓰기 봉인(RM-6)만 유지하면 모듈 의존을 만들 이유가 없다.
- `rich-messages/lib/*.ts`는 DB·Nest 무의존 순수 함수 파일이라 `dialog-nodes`가 import해도 모듈 순환이 생기지 않는다(`handoff/lib` 순수 파일 import 선례).
- `AppModule` imports **끝**에 둔다(루프·타이머 없음 — 순서 무관).

### 2.3 공개 대화 파이프라인 위치

```
① access.resolve → normalizeInbound
②.5 입구 금지어 → ②.7 상담 게이트 → 서빙 버전 → ③④ 의미 점수 → resolveTurn(엔진 — CAROUSEL 통과)
④.5 legacyApi(치환 재진입 — CAROUSEL·BUTTON.display 보존) → ④.6 survey → ④.7 workflow
⑤ [수정] adapter.renderOutbound(result.outputs, { features: dto.features })   ← rich-v1 → WEB 프로필 / 없음 → 구버전 프로필 · 순수 · DB 0
⑤.5 출구 금지어(maskOutbound — CAROUSEL 전 필드) → ⑦ RAG 분기(fallbackText = 요약) → ⑨ 응답 → ⑩ 로그(botResponse = 요약)
```

- 강등은 **출구 금지어 앞**이다 — 강등으로 만든 텍스트("외 N개 더 있습니다" · 텍스트 목록)도 마스킹을 거친다(FR-RM4-5).
- 공개 서비스는 `features`를 넘기기만 한다 — 프로필 선택은 어댑터 안(채널 분기 규약 — ADR-0011 §3).

### 2.4 엔진·위젯·ml-worker · 워크스페이스 영향

| 워크스페이스 | 변경 |
|---|---|
| `packages/dialogue-engine` | **`outputs.ts`·`design-validator.ts` 분기 추가만**(§5 EN-1~EN-6) — 새 파일·새 export 0 → `environment-sealing.spec.ts` E-5 골든 **불변** · 봉투·`CONVERSATION_STATE_VERSION` 불변 · 기존 엔진 시험 무수정 |
| `packages/shared-types` | §2.1 · §4 |
| `packages/pii-mask` | 0 |
| `apps/api` | §2.5 · 신규 모듈 1(컨트롤러 1·핸들러 2) · 테이블 1 · 마이그레이션 1 |
| `apps/widget` | `rich-v1` · 캐러셀·바로연결 렌더 · vanilla 유지 · gzip +6KB 이하(§12.4) |
| `apps/web` | §11 |
| `apps/ml-worker` | **0** |

### 2.5 기존 코드 변경 목록 (구현자 체크리스트 — 새 타입 자체의 수정 지점은 §15)

| 파일 | 변경 | 근거 |
|---|---|---|
| `prisma/schema.prisma` + 마이그레이션 `20260927120000_channel_rich_messages` | `ChatbotRichUrlPolicy` 신규(파일 끝) · `Chatbot.richUrlPolicy` 역참조(컬럼 0) | §3 |
| `packages/shared-types/src/*` | §4 | — |
| `packages/dialogue-engine/src/outputs.ts`·`design-validator.ts` | §5 EN-1~EN-6 | C-1 · C-2 · C-7 |
| `conversation/adapters/channel-adapter.ts` | `ChannelRenderContext` 타입 · `renderOutbound(outputs, ctx?)` | §8.1 |
| `conversation/adapters/web-channel.adapter.ts` | `supportedOutputTypes` = 표 파생 · 프로필 선택 · 타입 리터럴 목록 제거 | C-8 · AC-RM3-5 |
| `conversation/lib/output-degrade.ts` | `degradeOutputs(outputs, supported: ReadonlySet<DialogOutputType> \| ChannelOutputProfile)` → `degradeForProfile` 위임 | §7.6 |
| `conversation/public-conversation.service.ts` | ⑤ `renderOutbound` 둘째 인자 1개 | §2.3 |
| `banned-words/lib/output-text-fields.ts` | §6.1 | C-3 |
| `dialog-nodes/dialog-nodes.service.ts` | `assertQuickReplyPlacement` · `assertRichUrlsAllowed`(create·update·copy 쓰기 경로) · `validate()`에 `rich-url-issues` 병합 | §10 |
| `dialog-nodes/lib/node-target-refs.ts` | 캐러셀 카드 버튼 NODE(`outputs.i.payload.cards.j.buttons.k.value`) | C-7 |
| `dialog-nodes/lib/node-target-refs.parity.spec.ts` | 픽스처 **추가**(캐러셀 — 기존 단언 불변) | K-2 |
| `asset-transfer/lib/system-node-trim.ts` | 캐러셀 카드 버튼 TRIM(카드는 남김)·빈 결과 보정 FOLLOW | C-7 |
| `inbox/manage/inbox-test-customers.service.ts` + `lib/degrade-preview.ts` | `degradePreview` 채움 | §11.6 |
| `chatbots/chatbots.service.ts` | 동반 삭제 `chatbotRichUrlPolicy.deleteMany` 1줄(23 → 24테이블) | §14 |
| `audit-logs/lib/audit-snapshot.ts` | `AUDIT_FIELDS.Chatbot` +`richUrlHosts`(호스트 문자열 — 비개인정보) | §13 |
| `app.module.ts` | imports 끝 `RichMessagesModule` | §2.2 |
| `apps/widget/src/*` | §12 | — |
| `apps/web/src/*` | §11 | — |
| 시험 파일 | §18.3 닫힌 목록(X-1~X-4) + 신규 | FR-0-201 |

> **이 목록과 §15에 없는 파일은 바꾸지 않는다.** 특히 `apps/ml-worker/**` · `conversation/conversation-log.service.ts`(요약은 호출부 문자열 — 서비스 불변) · `handoff/**` · `legacy-api/**`(재진입은 엔진 `resumeAfterApiCall` 경로 — 엔진 수정으로 흡수) · `versions/**`·`topics/**`(참조는 `getOutgoingNodeRefs()` 경유 자동 반영) · `governance/**`(출구·지도 불변) · `main.ts` · `jest.isolate-env.js`.

### 2.6 커밋 분리 단위

| 커밋 | 범위 | 독립성 · 게이트 |
|---|---|---|
| **① 계약·순수 함수·엔진(관측 불변)** | shared-types 전부(§4 — `inbox.ts` 합집합 포함) · 엔진 EN-1~EN-6 · 후처리 3종(금지어·로그·강등 래퍼) · 참조 수집·트림 · `rich-messages/lib` 순수 함수 + 단위 시험 · 위젯 상수 미러 | 공개 경로 어댑터는 아직 기존 인자(1개) — 캐러셀을 저장한 노드가 없으므로 관측 변화 0. **기존 시험 무수정 통과**(여기서 깨지면 멈추고 보고) |
| **② 공개 경로·위젯** | 어댑터 계약·WEB 프로필·공개 서비스 1줄 · 위젯 `rich-v1`·렌더러 | X-1 · X-2 |
| **③ 저장·정책·관리 API** | 마이그레이션(`CREATE`만) · `rich-messages` 모듈 · 노드 저장 단언·허용 목록 검사·설계 점검 병합 · 인박스 `degradePreview` · 영구삭제 동반 삭제 · 감사 · `AppModule` | X-3 · X-4 |
| **④ 콘솔·봉인** | 편집기·채널별 미리보기·저장 경고·시뮬레이터·인박스 미리보기·설정 화면 · RM 봉인 전체 · 골든 해시 시험 | 기대값 변경 0 |

---

## 3. 데이터 모델 · 마이그레이션

### 3.1 Prisma 변경안

```prisma
model Chatbot {
  // …(기존 필드 불변)
  /// [신규 No.46] 역참조만 — DB 컬럼 변화 0.
  richUrlPolicy           ChatbotRichUrlPolicy?
}

/// [신규 No.46] 챗봇별 리치 메시지(캐러셀) 이미지·링크 허용 도메인 목록(1:1 · 행 없음 = 제한 없음 — ADR-0043 §7).
/// 환경 밖(저장 즉시 반영 — 공개 경로는 읽지 않는다) · 스냅샷·복사·토픽 분리 대상 아님 · 영구삭제 동반 삭제.
/// ★ 쓰기 = rich-messages/rich-url-policy.service.ts 1파일(+ chatbots.service.ts 동반 삭제 deleteMany) — RM-6.
model ChatbotRichUrlPolicy {
  chatbotId   String   @id
  chatbot     Chatbot  @relation(fields: [chatbotId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  /// JSON 직렬화 RichUrlHostRule[](≤50 · { host: 소문자 ASCII, includeSubdomains }) — 빈 배열 = 제한 없음
  hosts       String   @default("[]")
  /// 마지막 변경자(FK 없음 — 사실 기록 · AuditLog 규약)
  updatedById String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@map("chatbot_rich_url_policies")
}
```

- 아웃풋 스키마 변경(`CAROUSEL`·`display`)은 **`DialogNode.outputs` JSON 안**이라 컬럼 변경 0(ADR-0005 — 아웃풋 = JSON).
- 인덱스: PK(`chatbotId`)만 — 조회는 챗봇 단위 1행.

### 3.2 마이그레이션 (1개 — `20260927120000_channel_rich_messages`)

```sql
-- CreateTable
CREATE TABLE "chatbot_rich_url_policies" (
    "chatbotId" TEXT NOT NULL PRIMARY KEY,
    "hosts" TEXT NOT NULL DEFAULT '[]',
    "updatedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "chatbot_rich_url_policies_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
```

- **판단**: 요구사항은 "마이그레이션 없음"을 예상했지만(§5.4 "신규 저장소"), P-4 (a)가 **챗봇별** 허용 목록을 확정했고 이를 담을 기존 챗봇 단위 JSON 컬럼이 없다(`Chatbot.skin`은 표시 설정 · WEB `Channel.config`는 채널별·전체 교체 규약 · `ChatbotAnswerSetting`은 스냅샷 해시 범위). 따라서 **1:1 설정 테이블 1개**(`ChatbotInboxSetting`·`ChatbotHandoffSetting` 선례)를 만든다(R-10).
- **`CREATE TABLE` 1개뿐** — 기존 테이블 재정의 0 · 백필 0 · 기존 행 값 변경 0. **수기 작성**(선행 그룹 규약): `prisma migrate dev`의 diff가 원시 부분 유니크 4종(`test_runs_chatbotId_active_key`·`deploy_schedules_chatbotId_scheduledAt_active_key`·`deploy_schedules_chatbotId_running_key`·`handoff_sessions_active_key`)을 지우는 구문을 끼우지 않았는지 확인한다. 적용 후 `SELECT count(*) FROM sqlite_master WHERE type='index' AND sql LIKE '%WHERE%'` = **4**(RM-12).
- **배포·롤백**: 코드 ①②를 먼저 배포해도(테이블 미사용) 안전하다. ③ 롤백 = 새 테이블은 참조하는 코드가 없어져도 무해(행 방치 가능) — 되돌릴 때 테이블 삭제는 선택.

### 3.3 스냅샷 해시 영향 (ADR-0031 · FR-0-195)

- `CarouselOutputPayloadV1Schema`·`CarouselCardSchema`·`ButtonOutputPayloadSchema.display`에 **`.default()` 0**(RM-10 정적 + 런타임). zod 객체는 입력에 없는 선택 키를 출력에 만들지 않으므로 기존 `BUTTON` 노드를 다시 파싱해도 `display` 키가 생기지 않는다 → `sortKeysDeep`(undefined 생략) 결과 · **`contentHash` 바이트 동일**.
- 새 컴포넌트를 쓴 노드만 해시가 바뀐다(정상 — 내용이 바뀌었다). `SNAPSHOT_SCHEMA_VERSION = 1` 유지 · **업캐스터 불필요**(읽기 스키마에 타입·선택 키 추가뿐 — 과거 스냅샷엔 없다).
- **골든 해시 시험**(`versions/lib/snapshot-rich-messages-golden.spec.ts` — 신규): 도입 **전** 커밋(`9113b1d`)의 코드로 `TEXT`·`CARD`(버튼 5)·`BUTTON`(문구 유·무)·`LINK`·`IMAGE` 노드 픽스처의 `computeContentHash()`를 계산해 리터럴로 고정하고, 도입 후 같은 값임을 단언한다(`snapshot-topic-normalize.spec.ts` 선례 — AC-RM1-2).
- 허용 도메인 목록은 **스냅샷 밖**(환경 밖 설정 — EX-RM-14).

### 3.4 seed · 환경변수

- seed 변경 0(행 없음 = 제한 없음과 관측 차이 없음 — No.42 I-3 선례).
- **신규 환경변수 0**(FR-0-197).

---

## 4. shared-types 계약

### 4.1 `dialogue.ts` — `CAROUSEL` · `BUTTON.display` · 배치 규칙

```ts
export const DialogOutputType = z.enum([ /* 기존 13종 … */ 'WORKFLOW',
  // [신규 No.46] 캐러셀(카드 여러 장 넘겨 보기) — 표시용 비종결(IMAGE·LINK와 같은 분류).
  'CAROUSEL',
]);

export const CAROUSEL_LIMITS = {
  cardsMin: 2, cardsMax: 10, cardButtonsMax: 3,
  textMax: 300, titleMax: 100, descriptionMax: 500, altTextMax: 200,
} as const;

/** 캐러셀 카드 버튼 — 기존 ButtonItemSchema(MESSAGE·LINK·NODE) + LINK는 https 전용·위험 형식 차단(rich-url). */
export const RichButtonItemSchema = ButtonItemSchema.superRefine((btn, ctx) => {
  if (btn.action !== 'LINK') return;
  const r = inspectRichUrl(btn.value);
  if (!r.ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message: RICH_URL_ERROR_MESSAGES[r.error], path: ['value'] });
});

export const CarouselCardSchema = z
  .object({
    title: z.string().trim().min(1).max(CAROUSEL_LIMITS.titleMax),
    description: z.string().max(CAROUSEL_LIMITS.descriptionMax).optional(),
    imageUrl: RichHttpsUrlSchema.optional(),
    altText: z.string().max(CAROUSEL_LIMITS.altTextMax).optional(),
    buttons: z.array(RichButtonItemSchema).max(CAROUSEL_LIMITS.cardButtonsMax).optional(),
  })
  .superRefine((val, ctx) => {           // CARD와 같은 규칙(R-21)
    if (val.imageUrl && !val.altText) ctx.addIssue({ code: 'custom', message: '이미지에는 대체 텍스트가 필요합니다.', path: ['altText'] });
  });

/** [No.46] 캐러셀 v1 — `version` 리터럴은 형태 판별(No.26·27·41 선례). ★ .default() 0(RM-10). */
export const CarouselOutputPayloadV1Schema = z.object({
  version: z.literal(1),
  text: z.string().max(CAROUSEL_LIMITS.textMax).optional(),
  cards: z.array(CarouselCardSchema).min(CAROUSEL_LIMITS.cardsMin).max(CAROUSEL_LIMITS.cardsMax),
});

export const ButtonOutputPayloadSchema = z
  .object({
    text: z.string().max(500).optional(),
    buttons: z.array(ButtonItemSchema).min(1).max(5),
    /** [No.46] 없음 = 일반 버튼(바이트 동일). ★ .default() 금지(ADR-0043 §1 · FR-0-195). */
    display: z.literal('QUICK_REPLY').optional(),
  })
  .superRefine((val, ctx) => {
    if (val.display !== 'QUICK_REPLY') return;
    val.buttons.forEach((b, i) => {
      if (b.action === 'LINK') ctx.addIssue({ code: 'custom', path: ['buttons', i, 'action'],
        message: '바로연결은 대화 안 선택지만 가능합니다. 링크는 카드나 링크 아웃풋을 쓰세요.' });
    });
  });

// DialogOutputSchema 판별 유니온 끝에 추가
z.object({ type: z.literal('CAROUSEL'), payload: CarouselOutputPayloadV1Schema }),

/** [No.46] 바로연결 배치 규칙(FR-RM2-3) — 노드 저장 서비스·콘솔 편집기가 공용(읽기 스키마에는 넣지 않는다 — R-15). */
export const QUICK_REPLY_FOLLOWER_TYPES = ['DIALOG_MOVE', 'WORKFLOW'] as const;
export function findQuickReplyPlacementIssues(outputs: readonly DialogOutput[]):
  Array<{ index: number; reason: 'MULTIPLE' | 'NOT_LAST' }>;
// 규칙: display=QUICK_REPLY인 BUTTON이 2개 이상 → 두 번째부터 MULTIPLE ·
//       바로연결 뒤에 QUICK_REPLY_FOLLOWER_TYPES 밖 타입이 있으면 NOT_LAST
```

- 바로연결 라벨 ≤20자는 **권고**(콘솔 경고 — 스키마 한도는 기존 40 유지).
- `LinkOutputPayloadSchema.openInNewTab`의 기존 `.default(true)`는 손대지 않는다(기존 동작).
- `isUnsupportedOutput()`은 `CAROUSEL`을 지원 타입으로 본다(변경 0).

### 4.2 `common.ts` · `rich-url.ts`(zod 무의존)

```ts
// rich-url.ts — import 0(브라우저·Node 공통 WHATWG URL만)
export const RICH_URL_MAX_LENGTH = 2048;
export type RichUrlError = 'NOT_HTTPS' | 'USERINFO' | 'INVALID_CHARS' | 'TOO_LONG' | 'INVALID';
export type RichUrlWarning = 'PUNYCODE' | 'IP_HOST' | 'SHORTENER';
export const RICH_URL_ERROR_MESSAGES: Record<RichUrlError, string>;   // 문구 §9.1
export const KNOWN_URL_SHORTENER_HOSTS: readonly string[];           // bit.ly · t.co · tinyurl.com · goo.gl · han.gl · me2.do · url.kr · vo.la · naver.me · buly.kr (선택 목록 — 경고 전용)
export function inspectRichUrl(url: string):
  { ok: true; host: string; warnings: RichUrlWarning[] } | { ok: false; error: RichUrlError };
export function isSafeRichUrl(url: string): boolean;                 // inspectRichUrl(url).ok
export function hostMatchesRules(host: string, rules: readonly { host: string; includeSubdomains: boolean }[]): boolean;

// common.ts — 기존 SafeUrlSchema 불변(C-11 · 하위 호환)
export const RichHttpsUrlSchema = z.string().superRefine((v, ctx) => {
  const r = inspectRichUrl(v);
  if (!r.ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message: RICH_URL_ERROR_MESSAGES[r.error] });
});
```

### 4.3 `channel.ts` — 출력 능력 프로필

```ts
export const CHANNEL_CAPABILITIES: Record<ChannelType, { handoff: boolean; outputs: ChannelOutputProfile }> = { … }; // §7.1 값
export const LEGACY_WEB_WIDGET_OUTPUT_PROFILE: ChannelOutputProfile;   // WEB 파생 — CAROUSEL 제외 · quickReply 미지원
export function outputProfileFor(type: ChannelType): ChannelOutputProfile;   // 표 조회(분기 아님)
// channelSupportsHandoff()는 타입 표기만 갱신(동작 불변)
```

### 4.4 `rich-degrade.ts`(zod 무의존 — `import type`만)

```ts
export const OUTPUT_PROFILE_SOURCES = ['MEASURED', 'ASSUMED', 'DEFAULT'] as const;
export type OutputProfileSource = (typeof OUTPUT_PROFILE_SOURCES)[number];
export interface ChannelOutputProfile {
  readonly source: OutputProfileSource;
  readonly types: readonly DialogOutputType[];          // 표시 지원 타입(항상 TEXT 포함 — 불변식 시험)
  readonly carouselMaxCards: number;                    // CAROUSEL 지원 시 ≥2
  readonly carouselCardMaxButtons: number;
  readonly cardMaxButtons: number;                      // 기존 CARD용(캐러셀 카드와 분리 — R-4)
  readonly quickReply: { readonly supported: boolean; readonly max: number };
  readonly buttonActions: readonly ('MESSAGE' | 'LINK' | 'NODE')[];
  readonly image: boolean;                              // 카드·캐러셀 카드 이미지(IMAGE 아웃풋은 types로 판정)
  readonly textLimits: { readonly title: number; readonly description: number; readonly buttonLabel: number };
}
export const DEGRADE_CHANGE_KINDS = ['CAROUSEL_TO_CARDS', 'CAROUSEL_TO_TEXT', 'CARDS_TRUNCATED', 'BUTTONS_TRUNCATED',
  'QUICK_REPLY_TO_BUTTON', 'BUTTON_TO_TEXT', 'OUTPUT_TO_TEXT', 'OUTPUT_REMOVED', 'IMAGE_REMOVED', 'TEXT_TRUNCATED', 'ACTION_LOST'] as const;
export type DegradeChangeKind = (typeof DEGRADE_CHANGE_KINDS)[number];
export interface DegradeChange { outputIndex: number; kind: DegradeChangeKind; detail?: string }
export interface DegradeResult { outputs: DialogOutput[]; changes: DegradeChange[] }
export const DEGRADE_TEXT_MAX = 1000;                  // TextOutputPayloadSchema 상한과 같다
export function degradeForProfile(outputs: readonly DialogOutput[], profile: ChannelOutputProfile): DegradeResult;
```

### 4.5 `output-view.ts`

- `OutputView` = `Extract<DialogOutput, { type: …기존 7종 | 'CAROUSEL' }>` · `RENDERABLE_TYPES` +`CAROUSEL` → 콘솔 시뮬레이터·위젯 공용(FR-RM5-4).
- `outputsToPlainText` — 전 타입 명시 + `never`(§6.2).
- `isSafeRichUrl`을 `./rich-url`에서 재노출(위젯이 서브패스 하나로 쓰게) — `./rich-url`은 import 0이라 zod 반입 0(RM-4).

### 4.6 `conversation.ts`

```ts
/** [No.46] 위젯 기능 선언(ADR-0043 §6) — 없으면 서버가 구버전 위젯 프로필로 강등한다. */
export const WIDGET_FEATURE_RICH_V1 = 'rich-v1';
```
- `PublicMessageRequestSchema.features`(≤5)·`PublicMessageResponseSchema` **정의 불변** — 응답의 `outputs` 원소가 `DialogOutputSchema` 확장분을 따를 뿐이다(T-13 재귀 키 검사: 새 키 `cards`·`display` — `topic` 부분 문자열 0). `Public*Schema` 신규 export 0(T-13 가드 개수 불변).

### 4.7 `inbox.ts`

```ts
export const DegradeChangeSchema = z.object({
  outputIndex: z.number().int().nonnegative(),
  kind: z.enum(DEGRADE_CHANGE_KINDS),
  detail: z.string().max(100).optional(),
});
export const DegradePreviewSchema = z.object({
  channelType: ChannelType,
  source: z.enum(OUTPUT_PROFILE_SOURCES),
  outputs: z.array(DialogOutputSchema),
  changes: z.array(DegradeChangeSchema),
});
// SimulateInboxResponseSchema.degradePreview: z.literal('NOT_DEFINED') → z.union([z.literal('NOT_DEFINED'), DegradePreviewSchema])
```
- `'NOT_DEFINED'`은 **하위 호환용으로 스키마에 남기고** 서비스는 더 이상 만들지 않는다(R-18). 콘솔은 두 형태를 모두 처리한다.

### 4.8 `dialogue-engine.ts` · `rich-message.ts`

```ts
// DesignIssueCode 끝에 — API 계층 순수 함수(rich-messages/lib/rich-url-issues.ts)가 산출해 엔진 결과 뒤에 합친다(토픽 규칙 선례 · 엔진 변경 0)
'RICH_URL_NOT_ALLOWED',   // WARNING — 허용 목록이 비어 있지 않은데 목록 밖 호스트
'RICH_URL_SUSPICIOUS',    // INFO — 퓨니코드·IP·단축 URL

// rich-message.ts
export const RICH_URL_POLICY_LIMITS = { hostsMax: 50, hostMax: 253 } as const;
export const RichUrlHostSchema = z.string().trim().toLowerCase().max(253)
  .regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/,
    '호스트 이름만 입력해 주세요(예: img.example.com — https://·경로·포트 제외, 한글 도메인은 퓨니코드로).');
export const RichUrlHostRuleSchema = z.object({ host: RichUrlHostSchema, includeSubdomains: z.boolean() }).strict();
export const UpdateRichUrlPolicySchema = z.object({ hosts: z.array(RichUrlHostRuleSchema).max(50) }).strict()
  .superRefine(/* host 중복 → path ['hosts', i, 'host'] '이미 목록에 있는 호스트입니다.' */);
export const RichUrlPolicyResponseSchema = z.object({
  chatbotId: z.string().uuid(),
  hosts: z.array(RichUrlHostRuleSchema),
  updatedAt: z.coerce.date().nullable(),          // 행 없음 = null
  outsideNodeCount: z.number().int().nonnegative(), // 목록 밖 주소를 쓰는 초안 노드 수(EX-RM-13)
  governanceModeOn: z.boolean(),                   // 거버넌스 모드 + 빈 목록 = 콘솔 경고 배지(FR-RM6-5)
});
```

---

## 5. 엔진 변경 — 닫힌 목록 (FR-0-196 · C-1 · C-2 · C-7)

### 5.1 변경 항목

| # | 파일 | 변경 | 비고 |
|---|---|---|---|
| **EN-1** | `outputs.ts` `executeOutputs` | `case 'CAROUSEL':` — `opts.apiVariables`가 있으면 `out.push(...applyApiVariablesToCarousel(o, vars, trace))`, 없으면 `out.push(o)` | 표시용 비종결 · 원본 객체 통과(바이트 동일) |
| **EN-2** | `outputs.ts` `executeOutputs` | `switch` 끝에 `default: { const unreachable: never = o; void unreachable; }` | **컴파일 시 망라 검출** — 파싱 통과 후라 런타임 도달 0(동작 = 지금의 "default 없음"과 같다) |
| **EN-3** | `outputs.ts` `applyApiVariables` BUTTON | `return { type: 'BUTTON', payload: { ...output.payload, text, buttons } };` | ★ `display` 보존(ADR-0034 결함 유형 재발 방지). 키 없는 기존 BUTTON은 `JSON.stringify` 결과가 이전과 같다(`text: undefined`는 직렬화 생략) |
| **EN-4** | `outputs.ts` 내부 함수 `applyApiVariablesToCarousel`(export 0) | §5.3 | CARD 치환 규약과 같은 필드만 |
| **EN-5** | `design-validator.ts` `getOutgoingNodeRefs` | `if (output.type === 'CAROUSEL') for (const c of output.payload.cards) for (const b of c.buttons ?? []) if (b.action === 'NODE') buttonTargets.push(b.value);` | 순환·고아·`incomingCount`·삭제 409·스냅샷 무결성·흐름 트리·토픽 간선이 자동 반영(호출부 전부 이 함수) |
| **EN-6** | `design-validator.ts` ⑦ URL 필드 | 캐러셀 카드 `imageUrl`·LINK 버튼 값을 `urlFields`에 추가 | `API_TOKEN_IN_URL_FIELD` 규칙 |

- **새 파일 0 · 새 export 0** → `environment-sealing.spec.ts`의 `APPROVED_ENGINE_FILES`·`APPROVED_ENGINE_EXPORTS` 골든(E-5) **불변**(AC-RM1-3). 기존 봉인들의 엔진 금지 심볼 검사(`environment｜prodversion｜servedversion` · `identity｜customer｜inbox` · `chatbotversion` · `testcase｜testrun` · `classifier｜augmentation` · `deployschedule` · I/O·타이머·`process.env`)에 걸리는 단어를 쓰지 않는다.
- 엔진에 `channel`·`degrade`·`profile`·`QUICK_REPLY`·`quickReply` 심볼 0 · `CAROUSEL` 문자열 보유 파일 ⊆ {`outputs.ts`, `design-validator.ts`}(RM-1) — 엔진은 채널과 표시 방식을 모른다.
- **재진입 경로**(`resumeAfterApiCall` → `executeOutputs(… apiVariables)`)도 같은 함수를 타므로 EN-1·EN-3이 그대로 적용된다(AC-RM2-4 — 통합 시험은 v2 `API_CONDITION` 성공 분기 뒤 노드로 검증).

### 5.2 기존 엔진 시험 영향

- EN-3의 반환 객체는 `display` 없는 입력에서 `{ …payload(text?, buttons), text, buttons }` — `toEqual`/`toStrictEqual`/스냅샷 모두 이전과 같다(키 집합 동일 · `undefined` 값 키는 이전에도 존재). **기존 엔진 시험 무수정**(AC-RM2-6).

### 5.3 캐러셀 `{api.*}` 치환 규칙 (FR-RM1-5)

```
text'   = text  ? truncate(renderApiTokens(text), 300)  : undefined     (빈 문자열 → 키 생략)
각 카드 c:
  title' = truncate(renderApiTokens(c.title), 100)
  title' 빈 문자열 → 카드 제거 + trace { stage:'API', code:'API_VALUE_DROPPED', targetName:'CAROUSEL.cards[j].title' }
  description' = c.description !== undefined ? truncate(renderApiTokens(...), 500) : undefined
  buttons'     = c.buttons?.map(label 치환·40자 절단).filter(label 비어 있지 않음)
  imageUrl·altText·버튼 value = 원본(비치환 — AC-L3-9)
남은 카드 수 n:
  n = 0 → [] + trace targetName 'CAROUSEL.cards'
  n = 1 → [ (text' ? TEXT(text') : 없음), CARD(카드 필드 그대로 — 버튼 ≤3 ≤ CARD 한도 5 · https ⊂ SafeUrl) ]  (R-2)
  n ≥ 2 → [ { type:'CAROUSEL', payload:{ version:1, text', cards' } } ]
```

- 절단은 기존 `truncateCodePoints`(코드 포인트 — EX-RM-4).

---

## 6. 출력 후처리 3종 — 전 타입 명시 + `never` (FR-0-198 · NFR-RMM3)

### 6.1 금지어 마스킹 `banned-words/lib/output-text-fields.ts`

| 타입 | 마스킹 필드 |
|---|---|
| `TEXT`·`CARD`·`IMAGE`·`LINK`·`PHONE_CALL` | 기존과 같다 |
| `BUTTON` | 기존과 같다(`{ ...payload }` 스프레드 — `display` 보존) |
| **`CAROUSEL`** | `text?` · 카드마다 `title` · `description?` · `altText?` · `buttons[].label` |
| `PAUSE` · `CONTEXT_FORM` · `DIALOG_MOVE` · `SCENARIO` · `SURVEY` · `API_CONDITION` · `WORKFLOW` | **명시 `case`로 원본 반환**(사용자 노출 문자열 없음) |
| `default` | `const unreachable: never = output; return unreachable;` — 새 타입을 추가하면 컴파일 오류 |

- 버튼 `value`(MESSAGE 문구)·URL은 마스킹하지 않는다(기존 CARD·BUTTON 규약과 같다 — 필드 화이트리스트는 "화면에 보이는 문자열").
- 주석의 "`default` 분기로 통과시킨다" 설명은 삭제하고 "전 타입 명시"로 갱신한다.

### 6.2 로그 텍스트화 `outputsToPlainText`(shared-types `output-view.ts`)

| 타입 | 한 줄 요약 |
|---|---|
| 기존 6종 · 일반 `BUTTON` | **불변**(`[카드] 제목` · `[버튼] 문구`/`[버튼]` …) |
| `BUTTON` + `display: 'QUICK_REPLY'` | 문구 있음 `[바로연결] 문구` · 없음 `[바로연결] 라벨1 · 라벨2 …` |
| **`CAROUSEL`** | `[캐러셀] ` + (안내 문구 ? `문구 — ` : ``) + 앞 5장 제목 `A · B · C` + (6장 이상 ? ` 외 N장` : ``) |
| `PAUSE`·비표시 6종 | 생략(명시 `case`) |
| `default` | `never` |

- 2,000자 상한 규약 불변. 이 요약이 대화 로그 `botResponse`·RAG 대기 폴백 문구·인박스 시뮬레이션 기록에 공통으로 쓰인다(AC-RM6-2).
- 로그는 **실제로 나간 아웃풋**(강등·마스킹 뒤)의 요약이다 — 구버전 위젯 턴은 `[카드] A\n[카드] B…`(R-16).

### 6.3 강등 텍스트 — §7

기존 `degradedText()`는 `rich-degrade.ts`의 텍스트 단계로 옮기고, 기존 5종 문구(`[카드] 제목` · `[이미지] 대체 텍스트` · `[버튼] 문구`/`[버튼]` · `[링크] 라벨` · `[전화] 라벨`)와 모르는 타입 `[지원하지 않는 응답]`은 **바이트 동일**하다(AC-RM3-4).

---

## 7. 채널 능력표 · 강등 알고리즘 (J-6 · J-7 · FR-RM3 · FR-RM4)

### 7.1 능력표 값

| 항목 | **WEB**(`MEASURED`) | **KAKAOTALK**(`ASSUMED` ⚠) | **나머지 6채널**(`DEFAULT`) | 가상: **구버전 웹 위젯**(`MEASURED`) |
|---|---|---|---|---|
| `types` | TEXT·CARD·IMAGE·BUTTON·LINK·PAUSE·PHONE_CALL·**CAROUSEL** | TEXT·CARD·IMAGE·BUTTON·LINK·CAROUSEL | TEXT | WEB − CAROUSEL |
| `carouselMaxCards` | 10 | 10 | 0 | 0 |
| `carouselCardMaxButtons` | 3 | 3 | 0 | 0 |
| `cardMaxButtons` | **5**(기존 CARD 스키마 최대) | 3 | 0 | 5 |
| `quickReply` | 지원 · 5 | 지원 · 10 | 미지원 | **미지원** |
| `buttonActions` | MESSAGE·LINK·NODE | MESSAGE·LINK·NODE | — | MESSAGE·LINK·NODE |
| `image` | ○ | ○ | × | ○ |
| `textLimits`(제목/설명/라벨) | 100 / 500 / 40(스키마 최대) | **50 / 230 / 14**(보수값) | 100 / 500 / 40(무의미 — 텍스트만) | 100 / 500 / 40 |

- ⚠ **카카오 값은 규격 미확인 보수값**이다(요구사항 조사 한계 · 이 세션도 웹 출처 재확인 불가 — R-5). 콘솔·시뮬레이션은 `ASSUMED`·`DEFAULT` 프로필을 쓸 때 항상 "예상 모습" 라벨을 단다. 2차 실연동 착수 전 **실제 계정 1개로 규격을 확인**해 `MEASURED`로 바꾼다(ADR-0043 재검토 트리거).
- **WEB의 모든 상한 ≥ 스키마 최대치**이므로 기존 아웃풋이 WEB에서 바뀌는 경로가 없다(불변식 I-2 · 시험).
- 나머지 6채널 = `MOBILE`·`LINE`·`FACEBOOK`·`NAVER_TALKTALK`·`APP`·`KIOSK`(규격 정의 전 — 가장 단순한 모습).

### 7.2 강등 사다리 (`degradeForProfile` — 아웃풋별 · 입력 순서 유지)

| 입력 | ① 원형(프로필 지원) | ② 대체 컴포넌트 | ③ 텍스트 |
|---|---|---|---|
| **`CAROUSEL`** | `CAROUSEL ∈ types` → 카드 초과 시 앞 `carouselMaxCards`장 + 뒤에 `TEXT "외 N개 더 있습니다."`(`CARDS_TRUNCATED` `"10→3"`) · 카드별 규칙(아래) | `CARD ∈ types` → [안내 문구 `TEXT`?] + `CARD` × N(카드 수 제한 없음 — EX-RM-12) · `CAROUSEL_TO_CARDS` · 각 CARD에 카드 규칙(`cardMaxButtons`) | `TEXT`(§7.3 목록 형식) · `CAROUSEL_TO_TEXT` · NODE 버튼 `ACTION_LOST "NODE"` · 이미지 있었으면 `IMAGE_REMOVED` |
| **`BUTTON`(QUICK_REPLY)** | `quickReply.supported` → 초과 시 앞 `max`개(`BUTTONS_TRUNCATED`) · 라벨·동작 규칙 | `BUTTON ∈ types` → **`display` 제거**(`QUICK_REPLY_TO_BUTTON`) + 일반 BUTTON 규칙 | `TEXT "문구\n다음 중 입력해 주세요: A / B"`(MESSAGE 라벨만) · `BUTTON_TO_TEXT` · NODE `ACTION_LOST` · 남는 내용 0 → 제거(`OUTPUT_REMOVED`) |
| `BUTTON`(일반) | `BUTTON ∈ types` → 라벨 절단·미지원 동작 제거(개수 제한 없음 — 스키마 5 ≤ 모든 프로필) | — | 기존 문구 `[버튼] 문구`/`[버튼]` · `BUTTON_TO_TEXT` · `ACTION_LOST "BUTTONS"` |
| `CARD` | `CARD ∈ types` → 카드 규칙(`cardMaxButtons`) | — | 기존 `[카드] 제목` · `OUTPUT_TO_TEXT "CARD"`(+ 버튼 NODE/LINK 있었으면 `ACTION_LOST` · 이미지 `IMAGE_REMOVED`) |
| `IMAGE` | `IMAGE ∈ types` → 그대로 | — | 기존 `[이미지] 대체 텍스트` · `OUTPUT_TO_TEXT` · `IMAGE_REMOVED` |
| `LINK` | 라벨 절단 | — | 기존 `[링크] 라벨` · `OUTPUT_TO_TEXT` · `ACTION_LOST "LINK"`(주소 누락 — 기존 문구 불변 우선, R-6) |
| `PHONE_CALL` | 그대로 | — | 기존 `[전화] 라벨` · `OUTPUT_TO_TEXT` · `ACTION_LOST "PHONE"` |
| `PAUSE` | 그대로 | — | **제거**(`OUTPUT_REMOVED` — 빈 TEXT 금지, 제약 ②) |
| `TEXT` | 그대로(모든 프로필이 TEXT 지원 — 불변식) | — | — |
| 비표시 6종·모르는 입력 | — | — | 기존 `[지원하지 않는 응답]`(`OUTPUT_TO_TEXT`) |

**카드 규칙**(캐러셀 카드는 `carouselCardMaxButtons`, CARD는 `cardMaxButtons`):
1. 버튼 초과 → 앞에서 상한만큼(`BUTTONS_TRUNCATED "5→3"`).
2. `buttonActions`에 없는 동작의 버튼 제거(`ACTION_LOST "<action>"`).
3. `image = false`인데 이미지 → `imageUrl`·`altText` 제거, 설명 앞에 `[이미지: 대체 텍스트] ` 삽입(설명 상한으로 절단 · `IMAGE_REMOVED`).
4. 제목·설명·버튼 라벨이 `textLimits` 초과 → 코드 포인트 `상한−1` + `…`(`TEXT_TRUNCATED "title"｜"description"｜"buttonLabel"`).
5. 규칙 1~4에서 변화가 없으면 **입력 객체를 그대로** 반환한다.

### 7.3 텍스트 단계 형식

```
캐러셀 → TEXT (코드 포인트 1,000자 상한 — 초과 시 999자 + "…" · TEXT_TRUNCATED)
{안내 문구}                                 ← 있을 때만
1) {제목} — {설명 앞 50자(초과 시 …)}          ← 설명 없으면 " — …" 생략
   {LINK 라벨}: {https 주소}
   · {MESSAGE 라벨}
2) …
(NODE 버튼은 텍스트로 표현할 수 없다 → 줄 없음 + ACTION_LOST "NODE")

바로연결 → TEXT
{문구}                                      ← 있을 때만
다음 중 입력해 주세요: {라벨1} / {라벨2}       ← MESSAGE 버튼만
```

### 7.4 바뀐 점(`changes`) — 닫힌 목록 11종

`CAROUSEL_TO_CARDS` · `CAROUSEL_TO_TEXT` · `CARDS_TRUNCATED` · `BUTTONS_TRUNCATED` · `QUICK_REPLY_TO_BUTTON` · `BUTTON_TO_TEXT` · `OUTPUT_TO_TEXT` · `OUTPUT_REMOVED` · `IMAGE_REMOVED` · `TEXT_TRUNCATED` · `ACTION_LOST`. `outputIndex`는 **입력** 배열 위치 · 같은 `(outputIndex, kind, detail)`은 1건으로 합친다 · `detail` ≤100자. 공개 응답에는 싣지 않는다(FR-RM4-3) — 콘솔 미리보기·저장 경고·`degradePreview`만.

### 7.5 불변식 (순수 함수 시험 — 속성 기반 포함)

| # | 불변식 |
|---|---|
| I-1 | 결과의 모든 아웃풋은 `DialogOutputSchema.safeParse` 성공(모든 프로필 × 최대 크기 픽스처 — 캐러셀 10장·제목 100·설명 500·주소 2,048·버튼 3) |
| I-2 | 바뀌지 않은 아웃풋은 **입력과 같은 참조**(`===`) · WEB/구버전 프로필 × 기존 7종 픽스처 = `changes` 0 · 결과 원소 전부 `===` |
| I-3 | 예외 0(`null`·빈 `cards`·모르는 `type` 입력 → `[지원하지 않는 응답]`) |
| I-4 | 멱등: `degrade(degrade(x, p).outputs, p).changes` = `[]` |
| I-5 | `changes`가 비어 있으면 결과 배열 원소가 입력 원소와 모두 `===` |
| I-6 | 프로필 표 정합: 모든 프로필 `types ∋ 'TEXT'` · `CAROUSEL ∈ types ⇒ carouselMaxCards ≥ 2` · WEB 상한 = 스키마 최대치 |
| I-7 | 성능: 아웃풋 10개 × 카드 10장 ≤1ms(NFR-RMP1 — 100회 평균) |

### 7.6 api 래퍼 `conversation/lib/output-degrade.ts`

```ts
export function degradeOutputs(outputs: DialogOutput[], supported: ReadonlySet<DialogOutputType> | ChannelOutputProfile): DialogOutput[]
// Set이면 typeSetProfile(set) = { source:'MEASURED', types:[...set], 상한 전부 스키마 최대, quickReply 지원, 전 동작, image true } 로 변환 후 위임
```
- 기존 `output-degrade.spec.ts`(WEB 집합 변환 0 · `CARD`→`[카드] 카드제목`)는 **무수정 통과**.

---

## 8. 어댑터 계약 · 구버전 위젯 · 채널 능력 1곳 (C-6 · C-8 · FR-RM4-4)

### 8.1 계약

```ts
// channel-adapter.ts
/** [신규 No.46] 렌더 문맥 — 위젯 기능 선언 등. 없으면 구버전 클라이언트로 취급한다(안전측). */
export interface ChannelRenderContext { features?: readonly string[] }
export interface ChannelAdapter {
  readonly type: ChannelType;
  readonly supportedOutputTypes: ReadonlySet<DialogOutputType>;   // 유지 — 구현은 표에서 파생
  normalizeInbound(…): InboundTurn;
  renderOutbound(outputs: DialogOutput[], ctx?: ChannelRenderContext): ChannelMessage[];
}

// web-channel.adapter.ts
readonly supportedOutputTypes = new Set<DialogOutputType>(CHANNEL_CAPABILITIES[this.type].outputs.types);   // 리터럴 목록 0(RM-5)
renderOutbound(outputs, ctx?) {
  const profile = (ctx?.features ?? []).includes(WIDGET_FEATURE_RICH_V1)
    ? CHANNEL_CAPABILITIES[this.type].outputs
    : LEGACY_WEB_WIDGET_OUTPUT_PROFILE;
  return [{ outputs: degradeOutputs(outputs, profile) }];
}
```

- 공개 서비스: `adapter.renderOutbound(result.outputs, { features: dto.features })` — 1줄(RM-11). 상담 게이트 전치 아웃풋(TEXT)·버전 없음 폴백(TEXT)은 기존 그대로(강등 대상 아님).
- **C-8 해소**: 채널 능력 목록의 원천은 `CHANNEL_CAPABILITIES` 1곳이다. `apps/api/src` 운영 코드에 `new Set<DialogOutputType>([` 리터럴 0 · 어댑터 파일에 `'TEXT'`·`'CARD'` 등 타입 문자열 리터럴 0(RM-5). 채널 리터럴 비교(`=== 'WEB'`) 0 규약 불변.

### 8.2 구버전 위젯 결과 (AC-RM3-1 · NFR-RMR1)

| 요청 | 캐러셀 3장 노드 | 바로연결 노드 | 기존 노드 |
|---|---|---|---|
| `features ∋ 'rich-v1'` | `CAROUSEL` 원형 | `BUTTON` + `display` | 바이트 동일 |
| `rich-v1` 없음(구버전·타 클라이언트) | [안내 `TEXT`?] + `CARD` × 3 | `BUTTON`(`display` 제거) | **바이트 동일**(I-2) |

---

## 9. 주소 안전 · 허용 도메인 목록 · No.45와의 관계 (P-4 · J-10 · J-11)

### 9.1 `inspectRichUrl()` 판정 순서

1. 길이 > 2,048 → `TOO_LONG`("주소는 2,048자 이하여야 합니다.")
2. 제어 문자(`\u0000-\u001F`·`\u007F`)·공백 류(`\s`)·역슬래시 → `INVALID_CHARS`("주소에 공백·제어 문자·역슬래시를 쓸 수 없습니다.")
3. `/^https:\/\//i` 아님 → `NOT_HTTPS`("https 주소만 쓸 수 있습니다.") — `http:`·`javascript:`·`data:`·`vbscript:`·`file:`·`https:host`(슬래시 없음) 전부
4. 권한부(`//` 뒤 첫 `/`·`?`·`#` 전)에 `@` → `USERINFO`("주소에 '@'가 포함된 형식은 쓸 수 없습니다(다른 사이트로 보내는 속임수에 쓰입니다).")
5. `new URL()` 실패 · `protocol !== 'https:'` · `hostname` 비어 있음 → `INVALID`("주소 형식을 확인해 주세요.") · 파서의 `username`/`password`가 있으면 `USERINFO`(이중 검사 — 퍼센트 인코딩 우회 포함)
6. 경고(저장 허용): 호스트 라벨에 `xn--` → `PUNYCODE`(국제화 도메인은 파서가 퓨니코드로 바꾸므로 한글 도메인도 여기 걸린다) · IPv4/`[IPv6]` → `IP_HOST` · `KNOWN_URL_SHORTENER_HOSTS` 일치 → `SHORTENER`
- 포트가 붙은 주소는 허용(경고 없음).

### 9.2 적용 범위

| 필드 | 규칙 |
|---|---|
| 캐러셀 카드 `imageUrl` · 캐러셀 카드 LINK 버튼 값 | **`RichHttpsUrlSchema`**(스키마 — 저장·스냅샷 복원 검증·엔진 파싱) + 허용 목록(노드 편집 API) |
| 기존 `CARD.imageUrl`·`IMAGE.imageUrl`·`LINK.url`·`BUTTON`/`CARD` LINK 버튼 | **기존 `SafeUrlSchema` 불변**(`http` 허용 — 하위 호환 · 2차 재검토) |
| 위젯 렌더 | 캐러셀의 이미지·LINK는 `isSafeRichUrl` 통과분만 렌더(방어 심층 — 서버 우회 주입 차단) |

### 9.3 허용 도메인 목록 API (`rich-messages` 모듈)

| 메서드 · 경로 | 권한 | 동작 |
|---|---|---|
| `GET /chatbots/:chatbotId/rich-url-policy` | `chatbot:read` | 행 없음 = `{ hosts: [], updatedAt: null }` · `outsideNodeCount`(초안 노드 전체 스캔 — `collect-rich-urls` + `hostMatchesRules`, 목록이 비면 0) · `governanceModeOn` · `ARCHIVED` 조회 허용 |
| `PUT /chatbots/:chatbotId/rich-url-policy` | `chatbot:write` | 전체 교체(부분 병합 금지 — 채널 설정 규약) · `upsert` · 빈 배열 허용(= 제한 없음) · `ARCHIVED` = `409 CHATBOT_ARCHIVED` · 감사 `UPDATE Chatbot`(요약 `리치 메시지 허용 도메인 변경 (N → M개)` · 전후 `richUrlHosts`) · 변경이 없으면 쓰기·감사 0 |

- 매칭: `host === rule.host || (rule.includeSubdomains && host.endsWith('.' + rule.host))`(소문자 비교 · 파서가 정규화한 호스트).
- 존재 노출 규약: 챗봇 스코프 검증은 `ChatbotScopeService`(교차 접근 404).
- **공개 대화 경로는 이 테이블을 읽지 않는다**(NFR-RMP1 — 추가 DB 조회 0).

### 9.4 No.45 외부 출구 게이트와의 관계 (J-11)

| 항목 | 판단 |
|---|---|
| 캐러셀 이미지·링크는 서버 출구인가 | **아니다** — 최종 사용자 **브라우저가 직접** 가져간다. 서버는 그 주소에 접속하지 않는다(존재 확인·썸네일·프록시 0 — `rich-messages/**`·`rich-url.ts`에 `fetch(`·`node:http`·`dns` 0, RM-8) |
| `EgressExitId` · 데이터 지도 · `DATA_EGRESS_ALLOWED_HOSTS` | **불변**(6클래스) — 서버가 보내는 데이터가 없다 |
| 허용 도메인 목록과 출구 허용 목록 | 재사용하지 않는다 — 주체(브라우저 vs 서버) · 목적(콘텐츠 정책 vs 데이터 반출) · 범위(챗봇 vs 전역)가 다르다 |
| 거버넌스 모드 ON + 빈 목록 | 설정 화면 경고 배지 "외부 이미지·링크 주소에 제한이 없습니다"(FR-RM6-5) — 차단 아님 |
| 개인정보 | 브라우저가 외부 이미지 호스트에 접속하면 **IP·브라우저 정보가 그 호스트에 노출**된다 — Referer는 `no-referrer`로 막는다 · 연동 가이드·처리방침 고지(운영 문서 §5.6) · 폐쇄망은 사내 이미지 서버 + 허용 목록 권장 |

---

## 10. 노드 저장 검증 · 설계 점검 (FR-RM2-2·3 · FR-RM6-4 · EX-RM-13)

### 10.1 저장 경로(`DialogNodesService` create · update · copy)

| 순서 | 검사 | 실패 |
|---|---|---|
| 1 | zod(`CreateDialogNodeSchema`·`UpdateDialogNodeSchema` — 캐러셀 2~10장·버튼 ≤3·https·`@`·바로연결 LINK 거부) | `400 VALIDATION_FAILED`(zod 경로) |
| 2 | 기존 단언(v1 레거시·`WORKFLOW` ≤3 …) | 기존 |
| 3 | **`assertQuickReplyPlacement(outputs)`** — `findQuickReplyPlacementIssues` | `400 OUTPUT_PAYLOAD_INVALID` "바로연결은 응답 맨 끝에 한 번만 둘 수 있습니다." · details `outputs[i].payload.display` |
| 4 | 참조 검증(`collectNodeTargetRefs` — 캐러셀 카드 버튼 포함) | 기존 `400 INVALID_REFERENCE`(field `outputs.i.payload.cards.j.buttons.k.value` — AC-RM2-2) |
| 5 | **`assertRichUrlsAllowed(chatbotId, outputs)`** — 새 컴포넌트 URL이 있을 때만 허용 목록 1쿼리 | `400 VALIDATION_FAILED` "허용 도메인 목록에 없는 주소입니다(img.example.com)." · field `outputs.i.payload.cards.j.imageUrl`·`…buttons.k.value` |

- 신규 `ApiErrorCode` 0. update는 **병합된 최종 outputs**로 검사한다(`outputs` 키가 없으면 3·5 생략).
- **노드 `copy()`도 3·5를 거친다**(코드 리뷰 R1 M-1) — v1 레거시 아웃풋을 제외한 뒤의 `filteredOutputs`로 검사한다. 원본이 저장된 뒤 허용 도메인 목록이 좁아졌다면(3에서 실패할 배치는 애초에 없다 — 원본이 이미 통과했으므로) **5에서 사본 생성을 거부**한다(허용 목록은 저장 시점 통제 원칙을 copy에도 동일 적용).
- 복원(No.25)·자산 이전·토픽 분할·**챗봇 전체 복사**·환경 승격은 (노드 단위 `copy()`와 별개로) **검사하지 않는다**(이미 저장된 노드의 일괄 복제 — 허용 목록은 저장 시점 통제, R-10) → 10.2 점검 경고로 드러낸다.

### 10.2 설계 점검 병합(`validate()` — 엔진 결과 뒤 · 토픽 규칙 선례)

| 코드 | 심각도 | 조건 |
|---|---|---|
| `RICH_URL_NOT_ALLOWED` | WARNING | 허용 목록이 비어 있지 않고, 노드의 새 컴포넌트 URL 호스트가 목록 밖 |
| `RICH_URL_SUSPICIOUS` | INFO | 퓨니코드·IP·단축 URL 경고가 있는 새 컴포넌트 URL |

- 채널 강등 경고는 설계 점검에 넣지 않는다(엔진·번들이 채널을 모른다 — 콘솔 저장 경고 §11.4, R-9).

---

## 11. 관리자 콘솔 (ui-designer / frontend-implementer 인계)

1. **아웃풋 편집기**: 종류 목록 +"캐러셀(카드 여러 장 넘겨 보기)" · 기본 페이로드 `{ version: 1, cards: [{ title: '' }, { title: '' }] }` · 카드 목록(추가 ≤10 · 삭제는 2장에서 비활성 + 이유 텍스트 · **위/아래 이동 버튼**(드래그만 금지) · 복제) · 카드 필드(제목·설명·이미지 주소·대체 텍스트·버튼 ≤3 — 기존 `ButtonItemEditor` 재사용 · LINK는 https 안내) · 안내 문구(≤300 · 남은 글자 수). 버튼 아웃풋에 **"표시 방식: 일반 버튼 / 바로연결(답 아래 빠른 선택)"** 라디오 — 바로연결이면 LINK 동작 선택지 비활성 + 이유 · 라벨 20자 초과 경고.
2. **주소 입력 즉시 검사**: `inspectRichUrl`로 거부 사유(인라인 오류)·경고(퓨니코드·IP·단축 URL — "비슷한 글자로 속이는 주소일 수 있습니다" 풀이)를 표시한다. 허용 목록이 있으면 목록 밖 호스트를 저장 전에 알린다(서버 재검증).
3. **채널별 미리보기**(노드 편집기 패널 — `role="tablist"`): `웹` · `구버전 웹 위젯` · `카카오톡(예상)` · `텍스트만 채널(예상 — 라인·페이스북 등)`. 노드의 **표시 아웃풋**(`toOutputViews` 대상 — `DIALOG_MOVE`로 이어지는 노드는 포함하지 않는다는 안내)을 `degradeForProfile(…, 프로필)`로 강등해 `OutputRenderer`로 그리고, `changes`를 "바뀐 점" 목록(문장)으로 보인다. `ASSUMED`·`DEFAULT`는 **"예상 모습(실제 규격 확인 전 추정)" 라벨 — 색 + 텍스트**.
4. **저장 시 경고(비차단)**: 저장은 그대로 진행하고, 결과 영역에 활성 채널(현재 WEB — 채널 목록 API의 `enabled`)의 바뀐 점은 **경고**, 설정만 된 채널은 **정보**로 표시(`aria-live="polite"` 1회). 구버전 웹 위젯 강등은 정보("구버전 위젯에서는 카드 N개로 보입니다").
5. **응답 테스트 시뮬레이터(No.10)**: `OutputRenderer`에 `CAROUSEL`(위젯과 같은 구조 — 이전/다음·위치) · 바로연결은 봇 말풍선 아래 칩 모양. 시뮬레이터는 **강등 없이** 원형을 보인다(웹 신버전 기준).
6. **통합 인박스 시뮬레이션(No.42)**: 응답 `degradePreview`가 객체면 "이 채널에서는 이렇게 보입니다" 패널(가상 채널 라벨 + `source` 라벨 + 바뀐 점) · `'NOT_DEFINED'`면 기존 표시. 스레드 기록은 원형 요약 그대로.
7. **챗봇 설정 > 리치 메시지 주소 허용 목록**: 표(호스트·하위 도메인 포함 체크박스·삭제) · 추가 폼(라벨 있는 입력 · 형식 오류 인라인) · 개수 `N/50` · "목록 밖 주소를 쓰는 노드 N개"(대화 설계 점검으로 이동 링크) · 거버넌스 모드 경고 배지(색 + 텍스트) · 환경 밖 안내("저장 즉시 적용 — 이후 저장하는 노드부터 검사") · VIEWER는 읽기 전용(저장 버튼 없음 — `403` 처리).
8. **노드 목록 아이콘·버전 차이 보기·흐름 트리**: `Record<DialogOutputType, …>` 아이콘(컴파일 강제) · 버전 차이는 "캐러셀(카드 N장)" 요약 · 흐름 트리는 엔진 흐름 트리가 카드 버튼 NODE를 `BUTTON_NODE` 간선으로 이미 포함(EN-5).
9. **문구**(FR-0-202): "캐러셀(카드 여러 장 넘겨 보기) · 바로연결 버튼(답 아래 빠른 선택) · 채널별 미리보기 · 예상 모습" — "강등·격하·능력 프로필·퓨니코드"는 짧은 풀이와 함께만.
10. **UIUX 준수기준 신설 규칙**(§3 캐러셀 · 일시 선택지 · §1 "예상 모습" 라벨 — 패치 U-1~U-3)을 화면 명세 `docs/03-design/channel-rich-messages-ui-spec.md`에서 구체화한다.

---

## 12. 위젯 렌더 (FR-RM8 · NFR-RMA · UIUX 신설 규칙)

### 12.1 캐러셀

| 항목 | 규칙 |
|---|---|
| 구조 | 컨테이너 `div.cb-carousel` `role="group"` `aria-roledescription="캐러셀"` `aria-label`(안내 문구 또는 "카드 N개") → 안내 문구 `p`(있을 때) → 트랙(가로 스크롤 · CSS `scroll-snap-type: x mandatory` · 카드 폭 ≈80% — 다음 카드가 살짝 보임) → 카드마다 `role="group"` `aria-roledescription="카드"` `aria-label="N개 중 K번째: 제목"` → 탐색 줄(이전 버튼 · 위치 "K / N"(`aria-hidden` — 정보는 카드 이름·상태 안내가 전달) · 다음 버튼) |
| 모든 카드 DOM 유지 | 숨김 슬라이드·`aria-hidden` 카드·`display:none` 카드 0 — 화면낭독기는 모든 카드를 선형으로 읽는다(NFR-RMA2) |
| 이전/다음 | `<button type="button">` · 텍스트 이름 "이전 카드"/"다음 카드" · 44×44px 이상 · 누르면 해당 카드로 스크롤(`prefers-reduced-motion`이면 `behavior: 'auto'`, 아니면 `'smooth'`) · **포커스는 버튼에 유지** · 끝에서는 `aria-disabled="true"` + 시각 비활성(흐림 + 텍스트 대비 유지) — 누름 무시(R-12) |
| 위치 안내 | 버튼 이동 시 `#cb-status`에 "N개 중 K번째 카드: 제목" 1회(`clearStatusTextIfUnchanged` 재사용) · 손가락 스크롤·Tab 이동은 위치 표시·버튼 상태만 갱신(낭독 0 — 소음 방지) |
| 현재 카드 판정 | `core/carousel.ts` `nearestCardIndex(scrollLeft, cardOffsets)`(순수) · 스크롤 이벤트는 `requestAnimationFrame` 1회로 묶음 · 카드 안 요소가 포커스를 받으면(`focusin`) 그 카드를 현재로 |
| 자동 넘김 | **없음**(타이머 0 — 정적 검사 RM-13) |
| 키보드 | Tab 순서 = 카드1 버튼들 → … → 카드N 버튼들 → 이전 → 다음(브라우저가 포커스된 카드를 스크롤 안으로 옮긴다) · Enter/Space = 클릭 · 방향키 사용자 정의 0 |
| 좁은 화면(320px) | 카드 폭 비율 유지 · 탐색 버튼 44px 확보 · 제목 2줄 말줄임(전체는 `aria-label`에) |
| 다국어 | 제목·설명 `dir="auto"`(EX-RM-3) |

### 12.2 바로연결

| 항목 | 규칙 |
|---|---|
| 선택 | `core/quick-reply.ts` `splitQuickReply(views)`(순수): 한 턴의 `display=QUICK_REPLY` BUTTON 중 **마지막 1개**만 칩 · 나머지는 말풍선 안 일반 버튼(FR-RM2-3 · EX-RM-11) · LINK 칩은 걸러냄(방어) |
| 위치 | 봇 메시지 요소 안 — 말풍선 **아래**, 평가 막대 **앞**(제약 ⑩) · `div.cb-quick-replies` `role="group"` `aria-label="바로 선택"` · 칩 = `<button>` 높이 44px 이상 · 줄바꿈 배치 · 문구(`text`)는 말풍선 안에 |
| 숨김 | 사용자가 **다음 입력을 보내는 순간**(칩 클릭·버튼 클릭·직접 입력 — `SEND_STARTED`) 활성 칩 묶음에 `hidden` — **새 DOM 노드 0**(UIUX §8 선례) · 포커스가 칩 안에 있었으면 입력창으로 이동(NFR-RMA4) |
| 상담 중(EX-RM-7) | 칩 클릭 = 기존 버튼 턴 → 상담 게이트 규약 · 칩 숨김 동일 |
| 새로고침 | 칩 없음(메시지 이력 비복원 — R-13 · EX-RM-6) |
| 인사말 빠른 답장(채널 설정) | **불변**(기존 BUTTON 렌더 — 이 키를 쓰지 않는다, FR-RM2-5) |

### 12.3 이미지 · 링크 · 텍스트

- 이미지: `loading="lazy"` · `decoding="async"` · `referrerPolicy="no-referrer"` · **고정 비율 상자**(`aspect-ratio: 16 / 9` + `object-fit: cover` — 레이아웃 흔들림 방지) · 로드 실패 시 상자 안에 대체 텍스트로 교체(기존 `image.ts` 패턴 — 높이 유지, AC-RM7-4) · `isSafeRichUrl` 실패 = `<img>` 미생성 · `src` 속성으로만(CSS `url()` 0).
- 지연 로딩은 **브라우저 기본**(IntersectionObserver 직접 구현 0 — 번들) — 가로 스크롤 안 로드 시점은 브라우저 구현을 따른다(K-8).
- 카드 버튼: 기존 `renderButtonGroup`(`allowStackedLayout: false`) · LINK는 `isSafeRichUrl` 통과분만 · 클릭 = 기존 `handleButtonAction`(LINK = `window.open(href, '_blank', 'noopener,noreferrer')` · 서버 전송 0).
- 모든 문자열 `textContent`(HTML 해석 0).

### 12.4 번들 · 스택 (P-9)

- vanilla TS · 런타임 의존성 0 · `rich-degrade.ts` import 0(서버가 강등) · gzip 100KB 게이트 통과 · **이 그룹 증가분 ≤6KB**(예상 +3KB — 빌드 로그로 보고, AC-RM7-5).
- ADR-0012 감수 비용 ③ **Preact 재검토 트리거 미발동**: `core/carousel.ts`·`core/quick-reply.ts`(순수) + `ui/renderers/carousel.ts`·`quick-reply.ts`(DOM) + 기존 파일 수정으로 흡수된다. 남은 트리거 = 파일 첨부(No.33).
- 위젯 상수 `constants/rich.ts` `WIDGET_FEATURE_RICH_V1 = 'rich-v1'`(shared-types 값 복제 — 런타임 동등성 시험 RM-14) · 요청 `features: ['handoff-v1', 'feedback-v1', 'rich-v1']`(3/5).

---

## 13. 권한 · 감사 (P-10 · FR-0-199)

| 동작 | 권한 | 감사 |
|---|---|---|
| 캐러셀·바로연결 저장 | 기존 `dialogue:write`(노드 생성·수정) | 기존 노드 감사(`UPDATE DialogNode` — 화이트리스트 `outputCount` 불변) |
| 채널별 미리보기 · 시뮬레이터 | 기존 조회 권한(콘솔 계산 — 서버 호출 0) | 없음 |
| 허용 목록 조회 | `chatbot:read` | 없음 |
| 허용 목록 변경 | `chatbot:write` | `UPDATE Chatbot` · 요약 `리치 메시지 허용 도메인 변경 (N → M개)`(+ 호스트 수가 같아도 무엇이 바뀌었는지 드러나도록 추가/삭제/하위 도메인 포함 변경 내역을 덧붙인다 — 코드 리뷰 R1 M-2) · 전후 `richUrlHosts`는 `{host, includeSubdomains}[]`(화이트리스트 +1 — NFR-RMS4) |
| 인박스 시뮬레이션 미리보기 | 기존 `simulation:write` ∧ `cs:read` | 없음(기존) |

- **신규 권한·역할 0**(`Permission` 18 · 역할 4 · `AuditTargetType`·`AuditAction` 추가 0).
- 클릭 기록(P-6): 카드 버튼·칩의 MESSAGE·NODE = 기존 버튼 턴(`inputKind = BUTTON_MESSAGE｜BUTTON_NODE`) · 질문 순위·미응답 수집 규약(ADR-0019) 불변 · 링크 클릭 무기록 · `ConversationLog` 컬럼 추가 0.

---

## 14. 버전 · 환경 · 복사 · 자산 이전 · 토픽 분할 · 영구삭제

| 경로 | 동작 |
|---|---|
| 스냅샷·차이·복원(No.25) | 새 타입·선택 키는 노드 자산이라 자동 포함 · 스키마 버전 1 · 업캐스터 0 · 기존 노드 해시 바이트 동일(§3.3) · 무결성 경고 `BROKEN_REFERENCE_NODE_BUTTON`이 카드 버튼도 본다(EN-5) |
| 환경 모드(No.40) | 초안에만 있는 캐러셀은 운영 서빙 버전에 없음 · 승격 후 반영(EX-RM-15) · 허용 목록은 환경 밖 |
| 챗봇 복사·토픽 분할(No.22) | ID 잎 재작성(`rewriteIdLeaves`)이 카드 버튼 NODE 값을 자동 재매핑(원본 UUID 잎 규칙) · 허용 목록은 복사하지 않는다 |
| 자산 이전(시작·폴백 노드 TRIM/FOLLOW) | `system-node-trim.ts` — 캐러셀 카드마다 keep 밖 NODE 버튼 제거(카드는 유지 → 2장 이상 보존) · 전부 잘려 빈 결과가 되면 FOLLOW로 되돌리는 기존 보정에 카드 버튼 NODE 포함(EX-RM-16) |
| 노드 삭제 사전검사 | `reference-check.service.ts`가 `getOutgoingNodeRefs()`로 캐러셀 참조를 본다 → 기존 `409`(참조 노드 목록 — AC-RM2-2, R-17) |
| 챗봇 영구삭제 | `ChatbotRichUrlPolicy` **동반 삭제**(설정 데이터 — 23 → 24테이블) · 사전검사 16종 불변 |
| 거버넌스 보존·암호화 | 대상 아님(관리자 설정 · 개인정보 0) |

---

## 15. ★ 새 아웃풋 타입 수정 지점 — 닫힌 목록 (NFR-RMM2 · 다음 타입(목록형 카드 등)의 체크리스트)

| # | 지점 | 파일 | 누락 시 증상 | 컴파일 강제 |
|---|---|---|---|---|
| 1 | 타입 열거·판별 유니온·페이로드 스키마 | `shared-types/dialogue.ts` | 저장 불가 | — |
| 2 | 엔진 실행 `case` | `dialogue-engine/outputs.ts` | 조용히 소실 → 폴백 문구 | ✓(EN-2 `never`) |
| 3 | 엔진 `{api.*}` 치환 | `dialogue-engine/outputs.ts` | 치환 누락 | — (체크리스트) |
| 4 | 노드 참조(엔진) | `dialogue-engine/design-validator.ts` `getOutgoingNodeRefs` | 삭제 409·고아·흐름 트리·무결성 누락 | — (동등성 시험 #5와 짝) |
| 5 | 노드 참조(저장 검증) | `api/dialog-nodes/lib/node-target-refs.ts` | 없는 노드 참조 저장 | — (**동등성 시험**) |
| 6 | URL 필드 `{api.*}` 점검 | `dialogue-engine/design-validator.ts` ⑦ | 경고 누락 | — |
| 7 | 자산 이전 트림 | `api/asset-transfer/lib/system-node-trim.ts` | 이전 범위 밖 참조 잔존 | — |
| 8 | 금지어 필드 화이트리스트 | `api/banned-words/lib/output-text-fields.ts` | **금지어 노출(보안)** | ✓(`never`) |
| 9 | 로그 텍스트화 | `shared-types/output-view.ts` `outputsToPlainText` | 빈 `botResponse` | ✓(`never`) |
| 10 | 강등 사다리 | `shared-types/rich-degrade.ts` | `[지원하지 않는 응답]` | ✓(`never`) |
| 11 | 채널 능력표 | `shared-types/channel.ts` `CHANNEL_CAPABILITIES[*].outputs.types` | WEB에서 텍스트로 강등 | — (표 정합 시험 I-6) |
| 12 | 표시 모델 | `shared-types/output-view.ts` `RENDERABLE_TYPES` | 위젯·시뮬레이터 소실 | — |
| 13 | 위젯 렌더러 | `apps/widget/src/ui/renderers/index.ts` + 전용 파일 | 위젯 소실 | ✓(`never` — 이 그룹에서 도입) |
| 14 | 콘솔 시뮬레이터 렌더러 | `apps/web/src/components/OutputRenderer.tsx` | 시뮬레이터 소실 | ✓(`never`) |
| 15 | 콘솔 편집기 타입 목록·기본 페이로드·서브폼 | `apps/web/.../DialogOutputEditor.tsx` | 선택 불가 | ✓(`defaultPayloadFor` `never`) |
| 16 | 콘솔 아이콘·라벨 | `apps/web/.../badges.tsx` · `constants/messages.ts` | — | ✓(`Record<DialogOutputType,…>`) |
| 17 | 금지어 전 필드 통합 시험 | `integration/*` | 회귀 미탐지 | — |
| 18 | 버전 차이 요약 | `apps/web` 버전 차이 렌더 | 원시 JSON 표시 | — |
| 19 | 설계 점검(타입 고유 규칙) | 엔진 또는 API 계층 | — | — |
| 20 | URL 정책(새 URL 필드) | `api/rich-messages/lib/collect-rich-urls.ts` | 허용 목록 우회 | — |
| 21 | 스냅샷 골든 해시 | `versions/lib/snapshot-rich-messages-golden.spec.ts` | 해시 회귀 미탐지 | — |
| 22 | 봉인 존재 검사 | `rich-message-sealing.spec.ts` RM-18(1~16 파일에 새 타입 문자열 존재) | 체크리스트 누락 | — |

---

## 16. 봉인 · 정적 검사 — `apps/api/src/rich-messages/lib/rich-message-sealing.spec.ts`

(검사 대상: 운영 코드 `*.ts` — `*.spec.ts`·`src/integration/**` 제외, 주석 줄 제외 · 스캔 0건 아님 가드 · 주요 단언은 **역검증 픽스처** 포함 — 기존 `*-sealing.spec.ts` 형식.)

| # | 단언 |
|---|---|
| RM-1 | `packages/dialogue-engine/src`에 `channel｜degrade｜profile｜quickReply｜QUICK_REPLY` 심볼 0 · `'CAROUSEL'` 보유 파일 ⊆ {`outputs.ts`, `design-validator.ts`} · 엔진 새 파일·export 0은 `environment-sealing.spec.ts` E-5 골든이 담당 |
| RM-2 | `outputs.ts`의 BUTTON 재조립 반환문이 `...output.payload` 스프레드를 포함 · `payload: { text, buttons }` 형태(필드 나열 재조립) 0 — ADR-0034 결함 유형 재발 방지 |
| RM-3 | `output-text-fields.ts`·`output-view.ts`(`outputsToPlainText`)·`rich-degrade.ts`에 `default: return output`·`default:\s*break` 0 · `: never` 대입 ≥1 · 두 후처리 파일이 `'CAROUSEL'` 분기를 가짐 |
| RM-4 | `rich-url.ts`·`rich-degrade.ts`·`output-view.ts`에 `from 'zod'` 0 · `./dialogue`·`./common`·`./channel` 값 import 0(`import type`만) · `rich-url.ts` import 0 |
| RM-5 | `web-channel.adapter.ts`에 `'TEXT'｜'CARD'｜'IMAGE'｜'BUTTON'｜'LINK'｜'PAUSE'｜'PHONE_CALL'｜'CAROUSEL'` 문자열 리터럴 0 · `CHANNEL_CAPABILITIES` 참조 ≥1 · `apps/api/src` 운영 코드의 `new Set<DialogOutputType>([` 0(C-8 · AC-RM3-5) |
| RM-6 | `chatbotRichUrlPolicy`의 `create｜createMany｜update｜updateMany｜upsert｜delete｜deleteMany` 호출 파일 = {`rich-messages/rich-url-policy.service.ts`, `chatbots/chatbots.service.ts`(deleteMany만)} |
| RM-7 | `rich-messages/**` `@Public()` 0 · 전체 8(H-10·W-10·O-8과 같은 목록) |
| RM-8 | `rich-messages/**`·`shared-types/src/rich-url.ts`·`rich-degrade.ts`에 `fetch(`·`node:http`·`node:https`·`node:dns`·`transport.request(` 0 · `EgressExitId.options.length === 6`(서버는 새 컴포넌트 주소에 접속하지 않는다) |
| RM-9 | `Permission.options.length === 18` · `rich-messages/**` `@RequirePermission(` 인자 ⊆ {`chatbot:read`, `chatbot:write`} |
| RM-10 | (정적) `dialogue.ts`의 `CarouselCardSchema`·`CarouselOutputPayloadV1Schema`·`ButtonOutputPayloadSchema` 선언 블록에 `.default(` 0 · (런타임) 기존 BUTTON·CARD 픽스처 `DialogOutputSchema.parse` 결과에 `display` 키 없음(`'display' in payload === false`) |
| RM-11 | `public-conversation.service.ts`의 `renderOutbound(` 호출 1회 · 두 번째 인자에 `features` · 이 파일의 `degradeForProfile(`·`LEGACY_WEB_WIDGET_OUTPUT_PROFILE` 직접 사용 0(어댑터 경유) |
| RM-12 | 신규 마이그레이션 SQL에 `DROP`·`ALTER TABLE`·`WHERE` 0 · `$queryRaw`·`$executeRaw` 보유 파일 수 불변 · (통합) 적용 후 부분 인덱스 4 |
| RM-13 | 위젯 `ui/renderers/{carousel,quick-reply}.ts`에 `innerHTML`·`insertAdjacentHTML`·`outerHTML`·`style.backgroundImage`·`url(` 0 · `setInterval(`·`setTimeout(` 0(자동 넘김 0) · `referrerPolicy`·`no-referrer` 존재 · 카드 요소 `aria-hidden` 설정 0 |
| RM-14 | 위젯 `constants/rich.ts` 값 = shared-types `WIDGET_FEATURE_RICH_V1`(런타임 동등성 — 위젯 spec) · 위젯 소스에 `rich-degrade` import 0 |
| RM-15 | `rich-messages/**`에 `setInterval(`·`PollingLoop` 0 · `env.validation.ts`·`jest.isolate-env.js`에 이 그룹 키 0(새 환경변수·루프 0) |
| RM-16 | (런타임) 골든 해시 — 도입 전 픽스처 `contentHash` 리터럴 일치(`snapshot-rich-messages-golden.spec.ts`) |
| RM-17 | `schema.prisma` `ChatbotRichUrlPolicy`에 `Cascade`(onDelete)·`SetNull` 0 · 값 컬럼은 `hosts`·`updatedById`·시각뿐 |
| RM-18 | §15의 지점 1·2·4·5·6·7·8·9·10·11·12·13·14·15·16 파일에 `CAROUSEL` 문자열 존재(체크리스트 가드 — 역검증: 목록 파일 1개를 뺀 픽스처가 실패) |

---

## 17. 성능 예산 (NFR-RMP)

| 항목 | 예산 | 근거·측정 |
|---|---|---|
| 공개 턴(기존 노드 · 모든 위젯) | 지연 증가 ≈0 · **추가 DB 조회 0** · 응답 바이트 동일 | 강등 = 참조 반환 · I-2 · 쿼리 수 시험 |
| 공개 턴(캐러셀 10장) | 강등 ≤1ms · 응답 ≤40KB(제목·설명·주소 최대치) | I-7 · NFR-RMP2 |
| 노드 저장 | +1쿼리(새 컴포넌트 URL이 있을 때만 — 허용 목록 PK 조회) | §10.1 |
| 설계 점검 | +1쿼리(허용 목록) + 순수 스캔 | §10.2 |
| 허용 목록 조회(`outsideNodeCount`) | P95 ≤300ms(노드 2,000개 스캔) | §9.3 |
| 허용 목록 저장 | ≤50ms(쓰기 1 + 감사 1 — 변경 없으면 둘 다 0) · 조회는 `assertWritable`(이름 포함) 1 + 이전 값 1 + `outsideNodeCount` 1(목록이 비어 있으면 0) — `update()`가 `this.get()`을 다시 부르지 않고 이미 가진 값으로 응답을 조립한다(코드 리뷰 R1 L-1) | — |
| 위젯 | gzip +6KB 이하 · 첫 렌더 이미지 동시 요청은 브라우저 지연 로딩에 맡김 | NFR-RMP3·4 |
| 콘솔 미리보기 | 탭 전환 ≤16ms(순수 함수 · 서버 호출 0) | — |

- 예산 미달을 이유로 상한(카드 수·주소 길이·스캔 범위)을 조용히 바꾸지 않는다 — 설계 문서 갱신 후 조정.

---

## 18. 시험 전략 (test-automation 인계)

### 18.1 층별 핵심

| 층 | 핵심 |
|---|---|
| 순수 함수 | ★ `degradeForProfile` 불변식 I-1~I-7 × 4프로필(WEB·구버전·카카오·텍스트만) · 사다리 표 전 칸 · 텍스트 형식 골든(§7.3) · 기존 5종 문구 바이트 동일(AC-RM3-4) · `inspectRichUrl` 표(`http:`·`HTTPS://`(대문자 허용)·`https:host`·`https://a.example@b.example/`·`https://a%40b.example`·`https://b.example/p@x`(경로의 @ 허용)·공백·탭·`\`·2,048/2,049자·`xn--`·한글 도메인·`127.0.0.1`·`[::1]`·포트·단축 URL) · `hostMatchesRules`(하위 도메인 on/off · `example.com` vs `badexample.com`) · `findQuickReplyPlacementIssues` · `outputsToPlainText`(캐러셀 5/6장·문구 유무·바로연결) · `maskOutputText` 전 필드 · 위젯 `core/carousel.ts`·`core/quick-reply.ts` |
| 엔진 | EN-1(원본 통과 `===`) · ★ EN-3 치환 턴 `display` 보존 · §5.3 치환 규칙(0장·1장→CARD·2장 이상·URL 비치환·trace) · EN-5·EN-6 · 기존 엔진 시험 **무수정** · 엔진 표면 골든(E-5) 불변 |
| 서비스(목) | 배치 단언 · 허용 목록 검사(빈 목록 = 통과 · update 병합 후 검사 · **copy도 동일 검사 — 코드 리뷰 R1 M-1**) · 설계 점검 병합 · 허용 목록 저장(전체 교체·변경 없음 = 쓰기·감사 0·`includeSubdomains` 단독 변경 감지·중복 호스트 400·`outsideNodeCount`·**`this.get()` 재호출 없이 응답 조립 — 코드 리뷰 R1 L-1**) · `degradePreview` 조립 |
| 통합(`migrate deploy` DB) | ★ AC-RM1-1(기존 시나리오 — `rich-v1` 유무 두 벌 응답·로그 바이트 동일) · ★ AC-RM1-2(골든 해시) · AC-RM2-1(1장·11장·버튼 4 → 400) · ★ AC-RM2-2(카드 버튼 참조 노드 삭제 409 · 저장 시 없는 노드 → 필드 경로) · AC-RM2-3 · ★ AC-RM2-4(v2 `API_CONDITION` 성공 분기 → 바로연결·캐러셀 노드 — 실제 공개 대화 1턴 · `resumeAfterApiCall` 경로) · AC-RM2-5 · ★ AC-RM3-1(`rich-v1` 유 → CAROUSEL / 무 → CARD 3 · `PublicMessageResponseSchema.parse` 통과) · ★ AC-RM4-2(시험 고객 KAKAOTALK → `ASSUMED` 객체 · WEB → `changes: []` · 스레드 기록 = 원형 요약) · AC-RM4-4(VIEWER GET 200 · PUT 403) · ★ AC-RM5-1(캐러셀 `http`·`@` 거부 · 기존 CARD `http` 저장 가능) · AC-RM5-2 · AC-RM5-3(퓨니코드 저장 + 설계 점검 INFO) · AC-RM5-5(감사 1건 전후 값) · ★ AC-RM6-1(카드 제목·설명·라벨·안내 문구·**강등 텍스트** 금지어 마스킹) · AC-RM6-2(`botResponse` 요약) · AC-RM6-3(칩 클릭 `inputKind`) · 영구삭제 동반 삭제 · 자산 이전·토픽 분할 카드 버튼 재매핑(NFR-RMR2) |
| 위젯(jsdom) | ★ AC-RM7-1(카드 5장 전부 DOM · `aria-label` 형식 · 버튼 `<button>` · 끝 `aria-disabled`) · ★ AC-RM7-2(키보드 Tab·Enter/Space · 타이머 0) · ★ AC-RM7-3(직접 입력 → `hidden` · 노드 수 불변 · 포커스 이동) · AC-RM7-4(이미지 오류 → 대체 텍스트 · 상자 유지) · AC-RM5-4(`rel`·`referrerpolicy` · 비 https 미렌더) · 한 턴 바로연결 2개 → 마지막만 칩 · AC-RM7-6(`features` 3개) · 번들 크기(AC-RM7-5 — 빌드 스크립트 로그) |
| 콘솔(vitest) | 편집기(캐러셀 카드 추가·삭제 하한·위/아래 이동 버튼·복제 · 표시 방식 라디오 · LINK 비활성) · 채널별 미리보기 탭 + "예상 모습" 라벨 · 저장 경고 비차단 · 인박스 미리보기 두 형태 · 허용 목록 화면(VIEWER 읽기 전용) |
| 봉인 | RM-1~RM-18 + 기존 E·O·H·W·L·S·F·T·G 봉인 불변 |

### 18.2 시험 작성 원칙

- **★ 상대 시각 사용**: 이 그룹의 시각 비교(허용 목록 `updatedAt` · 감사 `createdAt` 정렬 · 통합 시험의 로그 조회 구간)는 **`now` 기준 상대값**(`new Date(now.getTime() - 60_000)`)으로 만들고 **절대 날짜 리터럴을 쓰지 않는다**. 순수 함수는 시각을 받지 않는다(강등·URL 판정은 시각 무관 — 결정적).
- **골든 해시는 도입 전 커밋에서 계산**: `snapshot-rich-messages-golden.spec.ts`의 기대 해시는 `9113b1d`(도입 전) 코드로 픽스처 해시를 계산해 리터럴로 적는다 — 도입 후 코드로 계산하면 회귀를 잡지 못한다. 픽스처의 시각 필드는 해시 범위 밖이므로(ADR-0031) 상대 시각을 써도 해시가 흔들리지 않는다.
- **계약 검증**: 공개 응답을 받는 통합 시험은 `PublicMessageResponseSchema.parse`를 반드시 통과시킨다(제약 ①).
- **선택 env를 켜는 spec은 동적 import**: 거버넌스 모드(`governanceModeOn` 경고) 등은 `process.env` 설정 후 `await import('../app.module')`(CLAUDE.md).
- **통합 DB = `prisma migrate deploy`**(원시 부분 유니크 4종 포함 · 적용 후 4 단언).
- **위젯 순수/DOM 분리**: 위치 계산·마지막 바로연결 선택은 `core/` 단위 시험, DOM은 jsdom(스크롤 API는 목 — `scrollTo` 호출 인자 단언).
- **boolean**: 새 쿼리·환경변수 0(해당 없음).

### 18.3 ★ 의도된 기존 시험 기대값 변경 (닫힌 목록 — FR-0-201 확정)

| # | 파일 | 변경 | 이유 | 커밋 |
|---|---|---|---|---|
| **X-1** | `apps/widget/src/api/public-client.spec.ts`(27행) | `body.features` 기대값 `['handoff-v1', 'feedback-v1']` → `['handoff-v1', 'feedback-v1', 'rich-v1']` | 기능 선언 추가(P-8) | ② |
| **X-2** | `apps/widget/src/ui/app.feedback.spec.ts`(77행) | 같은 변경 | 같은 이유 | ② |
| **X-3** | `apps/api/src/common/auth/public-decorator-count.spec.ts` | 전수 스캔 목록 +`RichUrlPolicyController`(import·목록·제목 문자열 45 → **46**) · `@Public()` 8 목록 **불변** | 신규 컨트롤러 | ③ |
| **X-4** | `apps/api/src/chatbots/chatbots.service.spec.ts` | 트랜잭션 목 +`chatbotRichUrlPolicy.deleteMany`(주석 23 → 24테이블) — 기존 단언 불변 | 영구삭제 동반 삭제(§14) | ③ |

- **요구사항 FR-0-201이 예상했으나 변경이 필요 없는 항목**: `DialogOutputType` 개수 단언(존재하지 않음 — 확인) · `degradePreview` 리터럴 단언(시험 0 — 확인) · WEB 어댑터 지원 타입 7 단언(시험 0 — `output-degrade.spec.ts`는 자체 Set을 쓰며 무수정) · 엔진 `switch` 망라 시험(기존 없음 — 신규 시험).
- **확인 항목(변경 예상 0)**: `environment-sealing.spec.ts` E-5(엔진 골든 — 새 파일·export 0) · `output-degrade.spec.ts` · `node-target-refs.parity.spec.ts`(픽스처 **추가**만 — 기존 단언 불변) · `topic-sealing.spec.ts` T-13(새 키 `cards`·`display`에 `topic` 없음 · `Public*Schema` 개수 불변)·T-10(`AuditAction` 16) · `feedback-sealing.spec.ts`(`PublicMessageResponseSchema.shape` 불변) · `handoff-sealing.spec.ts` H-16(봉투 키 5) · `inbox-sealing.spec.ts` O-8·O-9 · `permission-matrix.spec.ts`(18) · `snapshot-topic-normalize.spec.ts`(골든 해시) · 엔진 전 spec · 웹 `DialogOutputEditor.spec.tsx`(`selectOptions('카드')` — 정확 일치라 "캐러셀(…)"과 충돌 없음).
- **그 밖의 spec이 깨지면 회귀로 취급하고 멈춘다**(커밋 ①·④에서 깨지면 즉시 보고).

### 18.4 커밋 분할안

§2.6 ①~④ — 각 커밋 단독으로 전 시험 통과 · X-n은 표의 커밋에서만(② X-1·X-2 · ③ X-3·X-4).

---

## 19. ★ 기능을 쓰지 않을 때 동작 불변 보장 (FR-0-194 · AC-RM1-1)

| 경로 | 미사용 동작 | 보장 장치 |
|---|---|---|
| 공개 대화 · `rich-v1` 유/무 · 기존 노드 | 강등 = 입력 참조 그대로 · 응답·로그·쿼리 수 동일 | I-2 · 통합 바이트 비교 · RM-11 |
| 엔진 | 기존 타입 경로 불변 · BUTTON 재조립 결과 직렬화 동일 | 기존 엔진 시험 무수정 · E-5 골든 |
| 금지어·로그 | 기존 7종 변환 결과 동일(명시 `case`는 이전 `default`와 같은 반환) | 후처리 단위 시험 |
| 스냅샷 해시 | 기존 노드 해시 바이트 동일 | RM-10 · RM-16 |
| 노드 저장 | 새 컴포넌트 URL 없음 = 허용 목록 조회 0 · 바로연결 없음 = 배치 단언 통과 | 서비스 시험 |
| 설계 점검 | 새 컴포넌트 없음 = 새 이슈 0(허용 목록 1쿼리만) | — |
| 인박스 시뮬레이션 | 응답에 `degradePreview` 객체(**의도된 변경** — 합집합 스키마 안) · 스레드 기록 불변 | AC-RM4-2 |
| 위젯 | 요청 `features` +1(**의도된 변경** — X-1·X-2) · 새 컴포넌트 없는 응답의 렌더 결과 동일 | 기존 위젯 시험 |
| 통계·학습·설문·평가·상담·업무 자동화·거버넌스 | 불변(로그 컬럼·출구·권한 0) | RM-8 · RM-9 |
| 영구삭제 | 동반 삭제 +1(행 없으면 0행 삭제) · 사전검사 16종 불변 | X-4 |

- **기준선**: 커밋 ① 적용 후 전 시험이 무수정 통과해야 하며, ②③은 표의 X만, ④는 기대값 변경 0이다.

---

## 20. 요구사항 추적표 (요약)

| 요구사항 | 설계 |
|---|---|
| FR-0-194 · AC-RM1-1 | §19 · §7.5 I-2 · §8.2 |
| FR-0-195 · AC-RM1-2 | §3.3 · RM-10 · RM-16 |
| FR-0-196 · AC-RM1-3 | §5 · RM-1 |
| FR-0-197 · AC-RM1-4 | §3.4 · §13 · RM-7·8·9·15 |
| FR-0-198 · NFR-RMS1 | §6 · RM-3 |
| FR-0-199 | §13 |
| FR-0-200 · AC-RM3-5 | §8.1 · RM-5 |
| FR-0-201 | §18.3 X-1~X-4 |
| FR-0-202 | §11.9 |
| FR-RM1-\* · AC-RM2-1·2·5 | §4.1 · §5.3 · §10 · §14 |
| FR-RM2-\* · AC-RM2-3·4 | §4.1 · §5.1 EN-3 · §10.1 · §12.2 |
| FR-RM3-\* | §7.1 |
| FR-RM4-\* · AC-RM3-\* | §7 · §8 |
| FR-RM5-\* · AC-RM4-\* | §11 · §4.7 |
| FR-RM6-\* · AC-RM5-\* · NFR-RMS2·3 | §9 · §10 · §12.3 |
| FR-RM7-\* · AC-RM6-\* | §6.2 · §13 |
| FR-RM8-\* · AC-RM7-\* · NFR-RMA | §12 |
| NFR-RMP | §17 |
| NFR-RMR1~3 | §8.2 · §14 · §7.5 I-3 |
| NFR-RMM1~3 | §4.3~4.4 · §15 · §6 |

## 21. 알려진 제한

| # | 제한 | 수용 근거 |
|---|---|---|
| K-1 | 카카오톡 모습은 가정치(보수값) — 실제와 다를 수 있다 | 규격 미확인(조사 한계) · 항상 "예상 모습" 라벨 · 실연동 시 실측 교체 |
| K-2 | 구버전 위젯에서 캐러셀이 세로 카드 N개로 길어진다 | 정보 손실 0 우선(EX-RM-12) |
| K-3 | 이미지 호스트 가용성·호스트 페이지 CSP를 서버가 확인하지 않는다 | 서버 출구 0 원칙 · 대체 텍스트 폴백 · 연동 가이드 `img-src` 안내(EX-RM-1·2) |
| K-4 | 허용 목록은 노드 편집 API 저장 시점만 강제 — 복원·이전·복사·분리로 들어온 목록 밖 주소는 경고로만 | 공개 경로 조회 0 · 설계 점검 + 설정 화면 개수 |
| K-5 | 카드·버튼 단위 클릭·링크 클릭 무기록 | P-6 · 2차(No.29 확장) |
| K-6 | 로그 요약이 위젯 버전에 따라 다르다(`[캐러셀] …` vs `[카드] …`) | 실제로 나간 것의 기록(R-16) |
| K-7 | 새로고침하면 바로연결 칩이 없다 | 위젯 메시지 이력 비복원(ADR-0009 트리거 ③) |
| K-8 | 가로 스크롤 안 이미지 지연 로딩 시점은 브라우저 구현에 따른다 | 번들 절약(IntersectionObserver 직접 구현 0) |
| K-9 | 퓨니코드·IP·단축 URL은 경고만 — 동형 문자 피싱은 운영자 확인 · 허용 목록이 최종 통제 | 국제화 도메인 정상 사용 보장 |
| K-10 | 사용자 브라우저가 외부 이미지 호스트에 접속(IP·브라우저 정보 노출) | Referer 차단 · 처리방침 고지 · 폐쇄망은 사내 호스트 |
| K-11 | 치환으로 1장만 남은 캐러셀은 CARD로 바뀐다(넘김 UI 없음) | 공개 응답 계약 유지(R-2) |
| K-12 | 기존 타입(CARD·IMAGE·LINK)은 여전히 `http`·`@` 형식을 허용 | 하위 호환 · 2차 이관 도구와 함께 |

## 22. 요구사항 대비 해석 (architect 판단)

| # | 요구사항 | 해석·조정 |
|---|---|---|
| R-1 | §10·§12 "ADR-0046(신규)" | **ADR-0043**(decisions 최대 0042 다음 빈 번호 — 가번호 정정) |
| R-2 | FR-RM1-5 "1장만 남으면 캐러셀 1장 허용" | 1장 → **CARD 1개(+ 안내 문구 TEXT)** — 캐러셀 스키마 2~10장 · 공개 응답 계약 유지 |
| R-3 | FR-RM4-4 "`display` 제거하지 않음 권고" | **제거**(`QUICK_REPLY_TO_BUTTON`) — 강등 사다리 일관성 · 구버전은 어차피 무시하므로 관측 차이 0 · 로그 요약도 `[버튼]` |
| R-4 | FR-RM3-1·2 "카드 버튼 3" | 프로필에 `cardMaxButtons`(기존 CARD — WEB 5)와 `carouselCardMaxButtons`(WEB 3) 분리 — 기존 CARD가 WEB에서 잘리지 않게 |
| R-5 | FR-RM3-3 카카오 글자 수 "공개 문서 확인 후" | 확인 불가 → **보수값**(제목 50 · 설명 230 · 라벨 14 · 바로연결 10 · 카드 버튼 3) — `ASSUMED` 표기, 실연동 전 실측 |
| R-6 | FR-RM4-2 "기존 6종 문구 불변" | 기존 5종 텍스트 문구 불변 · LINK 주소·카드 설명 누락은 `OUTPUT_TO_TEXT`·`ACTION_LOST`로 보고 · **PAUSE는 빈 TEXT 대신 제거**(스키마 무효 방지 · 운영 경로 도달 0) |
| R-7 | FR-RM4-3 바뀐 점 9종 | **11종**(+`OUTPUT_TO_TEXT`·`OUTPUT_REMOVED`) |
| R-8 | FR-RM4-1 "api·콘솔·위젯 공유" | 강등 함수는 api·콘솔 공유 · **위젯은 import하지 않는다**(서버가 강등 — 번들) · 위젯은 `rich-url`만 공유 |
| R-9 | FR-RM5-3 "저장 시 설계 점검 경고" · §4.9 `output-preview` | 채널 강등 경고 = **콘솔 순수 함수**(비차단) · 미리보기 API 미채택 · 엔진 설계 점검에 채널 규칙 0 |
| R-10 | FR-RM6-4 저장 위치 · §5.4 | 신규 1:1 테이블 `ChatbotRichUrlPolicy` → **마이그레이션 1개**(`CREATE`만) · 강제 = 노드 편집 API 저장 시점 · 다른 쓰기 경로는 설계 점검 `RICH_URL_NOT_ALLOWED` |
| R-11 | FR-RM6-3 경고 | 콘솔 입력 즉시 + 설계 점검 `RICH_URL_SUSPICIOUS`(INFO) · 저장 응답에 경고 필드 추가 0 |
| R-12 | FR-RM8-2 "끝에서 비활성" | `aria-disabled="true"` + 시각 표시(포커스 유지) — `disabled`는 포커스를 잃게 한다 |
| R-13 | FR-RM8-4 "새로고침 시 마지막 턴 칩 복원" | **복원 없음** — 위젯은 메시지 이력을 복원하지 않는다(ADR-0009 트리거 ③) |
| R-14 | EX-RM-17 엑셀 가져오기 | **해당 없음** — 대량 가져오기 자원에 대화 노드가 없다 |
| R-15 | FR-RM2-3 배치 규칙 | 서비스 저장 단언(`400 OUTPUT_PAYLOAD_INVALID`) · 뒤에 올 수 있는 타입 = `DIALOG_MOVE`·`WORKFLOW` · 읽기 스키마 불변 |
| R-16 | FR-RM7-1 요약 사용처 | 로그 = **실제로 나간 아웃풋**(강등·마스킹 뒤) 요약 · 인박스 시뮬레이션 기록 = 원형 요약 |
| R-17 | AC-RM2-2 "참조 위치 보고" | 필드 경로는 **저장 검증**(`INVALID_REFERENCE` details) · 삭제 409는 기존 형식(참조 노드 목록) |
| R-18 | J-9·§5.3 `{ channel, assumed }` | FR-RM5-5 명칭 `{ channelType, source, outputs, changes }` · `'NOT_DEFINED'`은 스키마에만 남김(서비스는 항상 객체) |
| R-19 | J-6 `LEGACY_WEB_WIDGET` 프로필 | 채널이 아니므로 `CHANNEL_CAPABILITIES` **밖** 상수(WEB 파생) — 표 = 실제 채널 8행 그대로 |
| R-20 | FR-RM6-2 거부 형식 | +`https:` 뒤 `//` 없음 · 빈 호스트 · 퍼센트 인코딩 `@`(파서 이중 검사) · 경로·쿼리의 `@`는 허용 |
| R-21 | FR-RM1-2 대체 텍스트 | CARD와 같은 규칙(이미지 있으면 비어 있지 않은 문자열 필수) |
| R-22 | FR-RM6-4 규칙 형식 | `{ host(소문자 ASCII · 국제화 도메인은 퓨니코드), includeSubdomains }` · 포트·경로 없음 · 중복 400 |
| R-23 | J-2 닫힌 목록 | 제3자 렌더 컴포넌트는 No.47 — 이 그룹의 타입 목록은 스키마 판별 유니온으로 닫힌다 |
| R-24 | FR-RM5-4 시뮬레이터 | `toOutputViews` +CAROUSEL · 시뮬레이터는 강등 없이 원형(웹 신버전) · 채널별 모습은 미리보기 탭 |

## 23. GPU · 배포 형태

- **GPU 1 유지**(P-12): 스키마 검증 · 순수 변환(O(아웃풋 × 카드)) · DOM/CSS 렌더 — 모델·학습·추론·임베딩 0 · ml-worker 변경 0. (2차) 업로드 리사이즈·썸네일도 CPU.
- **구축형 ○**: 외부 연동 0 · 새 인프라 0. 이미지는 최종 사용자 브라우저가 이미지 주소로 직접 받으므로 폐쇄망은 **사내 이미지 서버 주소 + 허용 목록**을 쓴다(업로드 저장소는 2차).
- **구독형 ○**: 챗봇별 허용 목록으로 고객사별 통제. 2차 카카오 실연동은 No.42 2차와 같은 전제(공개 HTTPS·계정·심사 — 구독형 유리).

## 24. 범위 밖 · 2차 (재검토 트리거는 요구사항 §9 · ADR-0043)

카카오톡 실연동(능력표 `ASSUMED → MEASURED` + 어댑터) · 카카오 전용 버튼 동작(상담원 연결·채널 추가·공유) · 목록형 카드·상품 카드(§15 체크리스트) · 버튼 동작 확장(전화·공유·상담 연결) · 채널별 수동 대체 응답 · 이미지 업로드·자체 호스팅 · 기존 타입 https 전용 확대 · 컴포넌트별 노출·클릭률 통계·링크 클릭 기록 · 캐러셀 자동 넘김(채택 안 함) · 제3자 컴포넌트(No.47) · 생성형 카드 문구·이미지(옵션 AI) · 네이버 톡톡·라인·페이스북 실측 프로필 · 위젯 설문 전용 컴포넌트(ADR-0035 트리거 — 이번 점검 미발동) · 상담원 메시지 리치 컨텐츠(No.24 후속).

## 25. 구현 편차 기록(I-n)

| # | 내용 | 근거 | 영향 파일 |
|---|---|---|---|
| I-1 | §2.1은 허용 도메인 목록 직렬화/역직렬화(`parseRichUrlHosts`·`serializeRichUrlHosts`)를 어디에 둘지 명시하지 않았다 — 구현이 `rich-messages/lib/` 아래 별도 파일(`rich-url-policy-codec.ts`, zod 무의존 순수 함수)로 분리했다. `rich-url-policy.service.ts`·`dialog-nodes.service.ts`(`assertRichUrlsAllowed`) 양쪽이 같은 코덱을 재사용한다 | §2.1(파일 구조) — 코덱 위치 미기재 | `apps/api/src/rich-messages/lib/rich-url-policy-codec.ts` |
| I-2 | §2.1이 명시한 `rich-url-policy.mapper.ts`(응답 매퍼)를 생략했다 — 응답 조립이 단순 필드 대입뿐이라 서비스 메서드(`get`·`update`) 안에서 직접 조립한다(별도 매퍼 클래스/함수 없음) | §2.1(파일 구조) — `rich-url-policy.mapper.ts` | `apps/api/src/rich-messages/rich-url-policy.service.ts`(매퍼 파일 미생성) |
| I-3 | §12.3 LINK 컴포넌트 라벨 절단은 전용 상한이 설계에 없어 `degradeForProfile`이 기존 `textLimits.buttonLabel`(바로연결·CARD 버튼과 동일 한도)을 재사용한다 — 채널별 프로필에 LINK 전용 한도를 새로 추가하지 않았다 | §7.2(강등 사다리)·§12.3 — LINK 라벨 전용 상한 미기재 | `packages/shared-types/src/rich-degrade.ts`(`truncateChars(o.payload.label, profile.textLimits.buttonLabel)`) |
| I-4 | §16 RM-13(위젯 렌더러 정적 검사)·RM-14(위젯 기능 상수 동등성)는 이 커밋(backend-implementer 범위)에서 검사하지 않는다 — `apps/widget`은 frontend-implementer가 별도로 구현·시험한다(`rich-message-sealing.spec.ts` 파일 상단 범위 안내에 명시) | §16(봉인·정적 검사) — RM-13·RM-14 | `apps/api/src/rich-messages/lib/rich-message-sealing.spec.ts`(범위 안내 주석) |
| I-5 | 코드 리뷰 R1(PASS) 개선 권고 반영 — ① `DialogNodesService.copy()`에도 `assertQuickReplyPlacement`·`assertRichUrlsAllowed`를 적용해 §10.1(저장 경로 create·update·copy)과 일치시켰다(원본 저장 뒤 허용 목록이 좁아졌으면 사본 생성을 거부) ② `RichUrlPolicyService.update()` 감사 before/after에 `includeSubdomains`를 포함하고 summary에 추가/삭제/하위 도메인 변경 내역을 구체적으로 남긴다(§13) ③ `RichUrlPolicyService.update()`가 `assertWritable`의 반환값(이름 포함)을 재사용하고 마지막 `this.get()` 재호출을 없애 쿼리 수를 줄였다(§17) | 코드 리뷰 R1 M-1·M-2·L-1 | `apps/api/src/dialog-nodes/dialog-nodes.service.ts` · `apps/api/src/rich-messages/rich-url-policy.service.ts` · `apps/api/src/chatbots/chatbot-scope.service.ts` |
| I-6 | 프론트 계약 보강 ① — §7.4는 `CAROUSEL_TO_CARDS`(② 대체 컴포넌트 단계)에 `detail`을 요구하지 않았으나, 콘솔이 "카드 N장 중 앞 M장만 보입니다"(ui-spec §7.2 `changeCarouselToCards(from, to)`) 문구를 만들려면 `CARDS_TRUNCATED`와 같은 `"${from}→${to}"` 형식의 수량 정보가 필요하다 — `degradeForProfile`이 `CAROUSEL_TO_CARDS`에도 원래 카드 수·결과 CARD 수를 담은 `detail`을 싣도록 확장했다(카드 수 제한 없음 — EX-RM-12 — 이므로 현재는 항상 `from === to`이지만, 같은 outputIndex의 `CARDS_TRUNCATED`와 `kind`로 구분되므로 향후 절단 규칙이 추가돼도 충돌하지 않는다). `DegradeChangeSchema.detail`(기존 `z.string().max(100).optional()`)은 스키마 변경 없이 그대로 호환 | §7.4(바뀐 점 닫힌 목록) — `CAROUSEL_TO_CARDS` detail 형식 미기재 | `packages/shared-types/src/rich-degrade.ts` |
| I-7 | 프론트 계약 보강 ② — §7.3(버전 차이 화면)·ui-spec §3.8(RM-8)이 요구하는 "캐러셀(카드 N장)" 요약(FR-RM5-6)은 항목 상세 드로어(STRUCT 필드는 JSON 그대로, 변경 없음)가 아니라 **항목 목록(L2)** 이 노드 상세를 열지 않고도 보여줘야 한다 — L2가 받는 `DiffItem`(§7 밖, `versions/lib/version-diff.ts`)에는 원래 `outputs` 값 자체가 없어 콘솔 단독 계산이 불가능하므로, `DiffItem`·`VersionDiffListItemSchema`에 `outputSummary?: string[]`를 추가했다(선택 필드 — 기존 응답과 하위 호환). `kind === 'NODE'`에서만 채우며, 아웃풋 중 `CAROUSEL`만 `"캐러셀(카드 N장)"`으로 뽑는다(그 외 12종은 값을 만들지 않는다 — 노드 목록 아이콘 배지가 이미 전 타입 개수 요약을 맡는다, §3.8 1행). ADDED·MODIFIED는 target(현재) 엔티티, REMOVED는 base(삭제 전) 엔티티 기준. No.25/No.40 콘텐츠 해시·복원 계획은 `diffSnapshots`를 참조하지 않으므로(해시는 `snapshot-canonical.ts`가 전담) 영향 없음(회귀 확인 — `snapshot-rich-messages-golden.spec.ts`·`version-sealing.spec.ts` 무수정 통과) | §7.3·ui-spec §3.8(RM-8) — 서버 응답 소스 미기재 | `apps/api/src/versions/lib/version-diff.ts` · `packages/shared-types/src/version.ts`(`VersionDiffListItemSchema`) |
