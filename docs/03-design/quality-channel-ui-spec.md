# 품질/채널 (No.10~11) — 화면 설계서

> **대상 기능**: No.10 응답 테스트/시뮬레이션, No.11 다양한 채널 제공 + 엔진 보강(FR-E2) 노출 UI + **`apps/widget` 신규**
> **입력 문서**: `docs/requirements/quality-channel.md`(FR/AC/EX), `docs/02-spec/quality-channel-설계.md`(§4 스키마, §5 API, §7 엔진, §8 로직, §9 위젯, §10 인계), `docs/02-spec/decisions/ADR-0009~0013`
> **준수 기준**: `docs/03-design/UIUX_준수기준.md`(전 항목, 위젯은 (a) 대상 그 자체 — NFR-A1)
> **재사용 대상**: `chatbot-operations-ui-spec.md`(모달/토스트/오류 패턴), `dialogue-design-ui-spec.md`(드로어 없는 전용 페이지·UnsavedGuardContext·픽커 패턴)
> **작성**: ui-designer · 2026-09-20 · **다음 단계**: `backend-implementer` → `frontend-implementer`
> **범위 경계**: React 컴포넌트 실제 코드는 작성하지 않는다. `apps/widget`은 React가 아니므로(ADR-0012) 컴포넌트 트리 대신 **마크업 구조·상태 전이·이벤트 흐름**으로 기술한다.

---

## 0. 전제와 연계 확인

1. **기존 4탭 라우트는 절대 변경하지 않는다**(AC-C-3): `/chatbots/:chatbotId/{dashboard,settings,skin,dialogue}`. 신규 라우트만 추가한다 — `/chatbots/:chatbotId/simulator`, `/chatbots/:chatbotId/channels`(설계서 §10 권고 그대로).
2. **탭 과밀 판단(§2)**: 6개 라우트를 평면 나열하지 않는다. 라우트는 그대로 두고 `TabNav` 컴포넌트만 **4개 시각적 그룹**으로 재구성한다 — 구조 변경이 아니라 `TabNav` 1개 파일의 렌더링 방식 변경이므로 AC-C-3과 충돌하지 않는다.
3. **드로어/탭 공유 컴포넌트**(FR-10-17): `SimulatorPanel`을 `mode: 'tab' | 'drawer'`로 재사용한다. 드로어는 라우트 이동이 아니므로 `UnsavedGuardContext.setGuard()`를 호출하지 않는다 — 드로어를 연 채로 관리자가 브라우저 뒤로가기를 눌러도(라우트가 바뀌지 않으므로 발생하지 않음) 편집 폼의 dirty 상태와 무관하다.
4. **채널 카드는 API 응답값을 렌더링한다**(DD-29). `packages/shared-types`의 `CHANNEL_IMPLEMENTATION` 상수를 `apps/web`이 import해 직접 판정하지 않는다 — `ChannelListItemSchema.implementation`만 읽는다.
5. **비활성 토글은 `disabled`가 아니라 `aria-disabled` + 사유 텍스트**(NFR-A3). `disabled` 속성은 포커스를 받지 못해 스크린리더가 인접 사유 텍스트를 읽을 기회 자체가 없다.
6. **데이터 바인딩 기준 스키마**는 설계서 §4의 `SimulateResponseSchema`/`CompareResponseSchema`/`ChannelListItemSchema`/`PublicChatbotConfigSchema`/`PublicMessageResponseSchema`이며, 아직 `packages/shared-types`에 구현되지 않은 **설계 확정 스키마**다. `backend-implementer`가 이를 구현한 뒤 본 문서 기준으로 프런트/위젯을 구현한다(선행 두 설계서와 동일한 전제).
7. **위젯은 `apps/web`과 완전히 다른 컴포넌트 체계다**(ADR-0012 — 런타임 의존성 0, React 없음, Shadow DOM). §5를 별도 섹션으로 두고 마크업 예시(HTML)·상태 다이어그램·이벤트 표로 기술하며, `apps/web`처럼 `props`/컴포넌트 트리로 쓰지 않는다.
8. **아웃풋 렌더러는 `@chat-bot/shared-types/output-view`의 표시 모델 변환을 공유**하고 마크업만 앱별로 만든다(DD-24). `apps/web`의 시뮬레이터는 React 컴포넌트로, `apps/widget`은 DOM 직접 조작으로 각각 구현하되 "무엇을 어떤 순서로 보여줄지"는 `toOutputViews()`/`resolveButtonAction()`/`planPauseSchedule()` 결과를 그대로 따른다.
9. 신규 화면의 모든 한국어 문구는 `apps/web/src/constants/messages.ts`(콘솔)와 `apps/widget/src/constants/messages.ts`(위젯) 두 곳에 나눠 상수화한다(FR-0-23). 두 파일은 공유하지 않는다 — 위젯은 zod/React 무의존이므로 콘솔의 `MESSAGES` 객체를 import할 수 없다.

---

## 1. 화면 목록 및 라우트

| ID | 화면명 | 라우트 | 진입 경로 | 구현 앱 |
|---|---|---|---|---|
| SIM1 | 응답 테스트 — 탭 | `/chatbots/:chatbotId/simulator` | `TabNav`의 "응답 테스트" 탭 | `apps/web` |
| SIM1-D | 응답 테스트 — 드로어 | 라우트 없음(오버레이) | `NodeFormPage`/`FaqEditModal`/`ContextFormPage`의 "이 설정으로 테스트" 버튼 | `apps/web` |
| SIM2 | 비교 모드 | `/chatbots/:chatbotId/simulator?mode=compare` (SIM1 내부 모드 전환, 새 라우트 아님) | SIM1/SIM1-D 내부 "비교" 토글 | `apps/web` |
| CH1 | 채널 관리 | `/chatbots/:chatbotId/channels` | `TabNav`의 "채널" 탭, `대시보드`·`스킨/임베드`의 상호 바로가기 | `apps/web` |
| W1 | 위젯 런처+대화 패널 | 없음(호스트 페이지에 임베드) | `EmbedCodeService`가 발급한 `<script>` 스니펫 | `apps/widget`(`dist/widget.js`) |
| W2 | 위젯 전체화면 대화 | `/c/:slug` | CH1 "공개 URL 미리보기" 클릭, 모바일 전체화면 임베드(`data-fullscreen`) | `apps/widget`(별도 SPA 빌드) |

`mode=compare`를 새 라우트로 만들지 않는 이유: 비교는 실시간 테스트와 **같은 오버레이·같은 대화 컨텍스트**를 공유하는 "같은 화면의 다른 뷰"다(S-4 시나리오 — 미리보기하다가 곧바로 비교로 전환). 라우트를 분리하면 오버레이를 다시 구성해야 한다.

---

## 2. 탭 구조 판단 — 6탭 평면이 아니라 시각적 그룹핑

### 2.1 판단

**라우트는 6개 그대로 두되(AC-C-3), `TabNav`를 4개 그룹으로 시각적으로 묶는다.** 평면 6탭을 채택하지 않는 이유:

- 기존 `tab-nav`는 단일 `<nav>` 안에 `<NavLink>`를 가로로 나열하는 구조다(현 `TabNav.tsx`). 6개를 그대로 추가하면 태블릿 폭(640~1023px)에서 줄바꿈이 발생해 탭 1줄이 2줄로 밀리고, 두 번째 줄의 탭이 시각적으로 "덜 중요해 보이는" 부작용이 생긴다.
- 시스템 아키텍트가 제공한 근거(FR-11-12 — WEB 채널 카드가 임베드 코드 탭 바로가기를 요구)를 그대로 반영하면 **"스킨/임베드"와 "채널"은 이미 상호 참조가 필요한 한 쌍**이다. 이 둘을 시각적으로 인접시키면 사용자가 "배포"라는 의도를 자연히 인식한다.
- 라우트를 그룹 세그먼트(`/deploy/skin`, `/deploy/channels`)로 바꾸는 안은 **기각**한다. 기존 `/skin` 라우트가 AC-4-7~AC-4-10 기존 테스트·임베드 코드 안내 문서·즐겨찾기 링크에 이미 노출돼 있어 변경 비용이 그룹핑의 이득보다 크다(AC-C-3의 취지와도 정면 배치).

### 2.2 그룹과 탭 순서

작업 흐름(만들기 → 검증 → 꾸미기 → 배포)을 그대로 탭 순서에 반영한다.

| 그룹 | 그룹 레이블(`aria-label`, 시각 캡션은 데스크톱에서만 노출) | 포함 탭 |
|---|---|---|
| 운영 | "운영" | 대시보드, 기본설정 |
| 설계 | "설계" | 대화설계 |
| 검증 | "검증" | **응답 테스트**(신규) |
| 배포 | "배포" | 스킨/임베드, **채널**(신규) |

### 2.3 마크업 구조 (`TabNav` 확장안)

```html
<nav class="tab-nav" aria-label="챗봇 상세 탭">
  <div class="tab-nav-group" role="group" aria-label="운영">
    <a href="/chatbots/:id/dashboard" class="tab-nav-link">대시보드</a>
    <a href="/chatbots/:id/settings" class="tab-nav-link">기본설정</a>
  </div>
  <span class="tab-nav-divider" aria-hidden="true"></span>
  <div class="tab-nav-group" role="group" aria-label="설계">
    <a href="/chatbots/:id/dialogue" class="tab-nav-link">대화설계</a>
  </div>
  <span class="tab-nav-divider" aria-hidden="true"></span>
  <div class="tab-nav-group" role="group" aria-label="검증">
    <a href="/chatbots/:id/simulator" class="tab-nav-link">응답 테스트</a>
  </div>
  <span class="tab-nav-divider" aria-hidden="true"></span>
  <div class="tab-nav-group" role="group" aria-label="배포">
    <a href="/chatbots/:id/skin" class="tab-nav-link">스킨/임베드</a>
    <a href="/chatbots/:id/channels" class="tab-nav-link">채널</a>
  </div>
</nav>
```

- **여전히 6개 모두 `<a href>` 기반 링크**다(UIUX §9, NFR-A5). `role="group"`은 그룹 경계를 스크린리더에 전달할 뿐 탐색 방식(Tab 순차)은 바꾸지 않는다.
- 구분자(`tab-nav-divider`)는 `aria-hidden`(순수 시각 요소, 정보 전달자가 아님 — 그룹 경계는 `role="group"`으로 이미 전달됨).
- 그룹 캡션 텍스트("운영"/"설계"/"검증"/"배포")는 **데스크톱(≥1024px)에서만 탭 위에 11px 회색 라벨로 표시**하고, 태블릿 이하에서는 숨겨 공간을 아낀다(`aria-label`은 항상 유지되므로 접근성 손실 없음).
- 현재 탭 표시는 기존 규약 유지(색상 단독 아님 — 밑줄 + 굵기, `tab-nav-link--active`).

### 2.4 좁은 화면 대응 (§8 반응형과 연계)

- **태블릿(640~1023px)**: 각 그룹은 줄바꿈 단위로 묶인다(`white-space: nowrap` per group, `flex-wrap: wrap` on 전체 nav) — 그룹이 다음 줄로 넘어가도 "스킨/임베드"와 "채널"은 항상 붙어 있다. 최악의 경우 2줄이 되지만, 잘리는 지점이 항상 그룹 경계라 어색한 줄바꿈(예: "스킨/임베…" + "…드")이 생기지 않는다.
- **모바일(< 640px)**: `TabNav` 전체가 `chatbot-operations-ui-spec.md` §8의 그룹트리 드롭다운과 동일한 패턴으로 접힌다 — 헤더에 "메뉴: {현재 탭명} ▾" 버튼(44×44px 이상, `aria-expanded`) 하나만 보이고, 클릭 시 그룹 헤더 + 탭 링크 목록이 바텀시트로 펼쳐진다. 목록 내부는 여전히 `<a href>` 기반이라 키보드로 전부 접근 가능하다.

---

## 3. 공통 UI 요소 — 재사용/신규

### 3.1 재사용(변경 없음)

`ConfirmDialog`/`Modal`, `Toast`, `InlineFieldError`, `SkeletonCard`/`SkeletonRow`, `EmptyState`, `ErrorState`, `SeverityBadge`(INFO/WARNING/ERROR), `CopyButton`, `ChipListEditor`(allowedOrigins·quickReplies에 재사용), `ResourcePickerField`(노드 점프 피커에 재사용), `UnsavedGuardContext`, `MESSAGES`, `ArchivedBanner` 패턴.

### 3.2 신규 컴포넌트

| 컴포넌트 | 용도 | 배치 |
|---|---|---|
| `SimulatorPanel` | 응답 테스트 화면의 본체. `mode:'tab'\|'drawer'` | `pages/chatbot-detail/simulator/SimulatorPanel.tsx` |
| `ChatMessageList` | 메시지 목록(사용자/봇 말풍선) | 동일 디렉터리 |
| `ChatBubble` | 말풍선 1개 — `role: 'user'\|'bot'`, `overlayApplied?: boolean` | 동일 |
| `OutputRenderer` | `@chat-bot/shared-types/output-view`의 `toOutputViews()` 결과를 React로 렌더 | `components/OutputRenderer.tsx`(콘솔·향후 다른 화면에서도 재사용 가능하도록 공용 위치) |
| `SessionStatePanel` | 세션 상태 우측 패널(FR-10-11) | `simulator/` |
| `TracePanel` | 메시지별 판정 근거 토글(FR-10-9) | `simulator/` |
| `TraceStepRow` | trace 1건 — 한국어 레이블 + `href` 링크 | `simulator/` |
| `NodeJumpPicker` | `ResourcePickerField`를 감싼 "노드로 바로 테스트" 컨트롤 | `simulator/` |
| `OverlayBadge` | "미저장 변경 적용됨" 배지 | `simulator/` |
| `CompareView` | A/B 비교 결과 2단/스택 레이아웃 | `simulator/` |
| `CompareTurnRow` | 비교 결과 1행 | `simulator/` |
| `DiffBadge` | `SAME`/`DIFFERENT` 배지 | `simulator/` |
| `SimulatorDrawer` | 드로어 셸(포커스 트랩, `Esc` 닫기) — `UnsavedGuardContext` 미등록 | `simulator/` |
| `ChannelCardGrid` / `ChannelCard` | 8종 카드 | `pages/chatbot-detail/channels/` |
| `ChannelToggle` | `aria-disabled` + 사유 툴팁/텍스트를 갖는 토글 | `channels/` |
| `WebChannelForm` | WEB 설정 폼 | `channels/` |
| `PlaceholderChannelForm` | `CONFIG_ONLY` 설정 폼(`note`만) | `channels/` |
| `OriginAllowAllBadge` | `allowedOrigins` 빈 배열 경고 배지 | `channels/` |
| `ChannelDeleteConfirmDialog` | 채널 삭제 확인 | `channels/` |

---

## 4. 화면별 설계

## 4.1 SIM1 — 응답 테스트(탭) `/chatbots/:chatbotId/simulator`

### 목적
관리자가 실시간으로 대화를 시험하고, 응답의 판정 근거(trace)와 진행 중 세션 상태를 확인한다. 저장 전 미리보기(오버레이)·비교(SIM2)의 출발점이기도 하다.

### 상태별 UI

| 상태 | 조건 | UI |
|---|---|---|
| 초기 로딩 | 탭 진입 직후, `assetCounts` 조회 전 | 대화 영역 `SkeletonRow` 3개, 우측 패널 `SkeletonCard` |
| 빈 상태(자산 0건) | `assetCounts` 전 항목 0(FR-10-16) | 상단 `SeverityBadge(INFO)` 배너: "이 챗봇에는 활성 노드 0건 · 의도 0건이 있습니다." + "대화설계로 이동" 링크(`href="/chatbots/:id/dialogue"`). **테스트 입력창은 비활성화하지 않는다** — 기본 폴백 문구가 정상 응답이다(FR-10-16) |
| ARCHIVED 배너 | `chatbot.status === 'ARCHIVED'`(FR-10-2) | 상단 `SeverityBadge(WARNING)`: "보관된 챗봇입니다. 시뮬레이션은 계속 가능합니다." — 시뮬레이션은 읽기 전용이라 계속 허용(FR-0-22) |
| 대화 중 | 메시지 1건 이상 | 아래 레이아웃대로 |
| 응답 대기 | 전송 직후 | 봇 말풍선 자리에 타이핑 인디케이터(●●●) + "응답 생성 중"(`role="status"`, UIUX §8) |
| 세션 만료 안내 | 서버가 `stateDiscarded` 비어있지 않음(EX-10-3~5) | 해당 지점에 시스템 말풍선(중립색): "이전 대화 상태를 사용할 수 없어 새 대화로 시작합니다." — trace의 `STATE_DISCARDED` 사유를 펼치면 구체 사유(`INVALID_SCHEMA`/`SESSION_EXPIRED`/`UNKNOWN_CONTEXT` 등) 한국어 레이블 확인 가능 |

### 레이아웃 (데스크톱 ≥1024px, ASCII)

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ (ARCHIVED일 때) ⚠ 보관된 챗봇입니다. 시뮬레이션은 계속 가능합니다.                    │
│ (자산 0건일 때) ⓘ 활성 노드 0건 · 의도 0건입니다. [대화설계로 이동]                   │
├──────────────────────────────────────┬─────────────────────────────────────────┤
│ ( ● 실시간 테스트 )  ( ○ 비교(A/B) )   │  세션 상태                                │
│                              [대화 초기화]│  컨텍스트: 커피주문 · 진행중              │
├──────────────────────────────────────┤  슬롯 2/3 · 재시도 0회                    │
│ 사용자  배송 조회해주세요                │  메뉴 = 아메리카노                        │
│                                        │  사이즈 = (미입력)                       │
│              봇  배송 조회 노드입니다.   │  ────────────────────────────           │
│                  [주문 조회] [취소]      │  이번 테스트는 통계에 반영되지 않습니다.   │
│                  판정 근거 보기 ▾        │                                        │
│                  ┌ NODE · 노드 매칭 성공 ────────┐                                │
│                  │ 의도 매칭: 주문_배송조회        │                                │
│                  │ → 배송조회_응답 [편집으로 이동]  │                                │
│                  └───────────────────────────┘                                  │
├──────────────────────────────────────┴─────────────────────────────────────────┤
│ 노드로 바로 테스트: [검색: 노드명_______▾]  [이 노드로 시작]                        │
├──────────────────────────────────────────────────────────────────────────────────┤
│ 메시지 입력          [___________________________________]  1000자 중 12자  [전송] │
└──────────────────────────────────────────────────────────────────────────────────┘
```

빈 오버레이 드로어(SIM1-D) 진입 시 상단에 `OverlayBadge`가 항상 보인다(§4.2).

### 컴포넌트 분해

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `SimulatorPanel` | `mode:'tab'\|'drawer'`, `chatbotId`, `overlay?: DialogueOverlay`(드로어 진입 시 편집 폼에서 주입), `initialFocusRef?` |
| `SimulatorModeToggle` | `mode:'chat'\|'compare'`, `onChange` — 라디오 그룹(단일 선택, UIUX §6) |
| `AssetEmptyBanner` | `assetCounts: AssetCounts`, `dialogueHref` |
| `ArchivedNotice` | `visible: boolean` |
| `ChatMessageList` | `messages: SimMessage[]`(`{id, role, outputs?, text?, trace?, matchedNodeName?, matchedIntentName?, matchedFaqQuestion?, overlayApplied, elapsedMs}`) |
| `ChatBubble` | `role`, `children`(=`OutputRenderer` 결과 또는 사용자 텍스트), `overlayApplied?` → `OverlayBadge` 인라인 표시 |
| `OutputRenderer` | `views: OutputView[]`(=`toOutputViews(outputs)`), `onButtonClick(action: ButtonActionView)` |
| `TracePanel` | `trace: TraceStep[]`, `open`, `onToggle` — 기본 접힘, 버튼은 `aria-expanded`(HomonymEditModal의 기존 패턴 승계, 시각을 표로 고도화) |
| `TraceStepRow` | `stage`, `code`, `message?`, `targetId?`, `targetType?: 'node'\|'intent'\|'faq'\|'homonym'` → `targetId` 있으면 `<a href="/chatbots/:id/dialogue/{targetType별 라우트}/{targetId}">편집으로 이동</a>` |
| `SessionStatePanel` | `state: ConversationState \| null` → 없으면 "진행 중인 폼 없음"(FR-10-11). 있으면 컨텍스트명, `슬롯 {filled}/{total}`, `filledValues`(마스킹 없이 그대로, NFR-S6), `retryCount`, 상태 배지(`IN_PROGRESS`/`COMPLETED`/`CANCELLED`) |
| `NodeJumpPicker` | `ResourcePickerField(resourceType:'node', multiple:false)` 래핑 + "이 노드로 시작" 버튼 → 클릭 시 `buttonAction:{kind:'NODE', nodeId}`로 시뮬레이션 요청(§4.1.1 흐름 참고) |
| `ResetConversationButton` | `onClick` → 메시지·상태 즉시 초기화(확인 모달 없음, FR-10-12) |
| `MessageComposer` | `value`, `maxLength=1000`, `remaining`, `onSend`, `sending` — 잔여 글자수 실시간 텍스트(정적, `aria-live` 아님 — 입력마다 읽히면 소음), 초과 시 전송 버튼 `aria-disabled` + 카운터 빨강 전환 |
| `TestingStatCaption` | 고정 문구: "이번 테스트는 통계에 반영되지 않습니다."(FR-10-5) — 화면 진입 시 상시 노출 |
| `UnsupportedOutputsNotice` | `types: DialogOutputType[]`(비어있지 않을 때만) → `SeverityBadge(INFO)`: "이번 버전에서는 실행되지 않는 아웃풋 N종({types})이 포함되어 있습니다."(FR-10-10) |

### 4.1.1 전송 흐름 (텍스트 입력)

1. 사용자가 입력창에 문장을 입력하고 `Enter`(또는 "전송" 클릭).
2. 공백/빈 문자열이면 요청을 보내지 않고 입력창 하단에 인라인 안내: "메시지를 입력해 주세요."(FR-10-15) — 서버 호출 없음.
3. 1,000자 초과면 전송 버튼이 `aria-disabled`이고 카운터가 빨강으로 전환. 초과 상태에서 `Enter`도 무시된다(FR-10-13, FR-10-16 클라이언트 우선 차단).
4. 사용자 말풍선 즉시 추가 → `POST /chatbots/:id/simulate` `{ message, state: lastState, overlay? }` 전송, 버튼/입력 `aria-disabled` 처리(연타 방지, AC-10-13).
5. 응답 대기 중 봇 말풍선 자리에 타이핑 인디케이터 + "응답 생성 중"(`role="status"`).
6. 200 응답 → 봇 말풍선에 `OutputRenderer(toOutputViews(outputs))` 렌더, `TracePanel`(접힘) 부착, `matchedNodeName`/`matchedIntentName`/`matchedFaqQuestion`이 있으면 말풍선 상단에 회색 캡션으로 요약 표시("노드: 배송조회_응답"). `state`로 로컬 상태 전량 교체(부분 병합 금지 — ADR-0009와 동일 원칙을 관리자 화면에도 적용해 일관성 유지). `SessionStatePanel` 갱신.
7. `unsupportedOutputs`가 있으면 말풍선 아래 `UnsupportedOutputsNotice`.
8. `stateDiscarded`가 비어있지 않으면 그 턴 앞에 시스템 안내 말풍선(상태별 UI 표 참고).
9. 네트워크 오류/5xx → 봇 말풍선 대신 오류 말풍선(`role="alert"`) + "다시 시도" 버튼(직전 입력을 재전송).

### 4.1.2 버튼 클릭 흐름 (FR-10-7, FR-W-6과 동일 판정 로직 공유)

`OutputRenderer`가 렌더한 `BUTTON`/`CARD` 내부 버튼을 클릭(또는 키보드 `Enter`/`Space`)하면 `resolveButtonAction(btn)`(공유 로직, §0-8)의 판정에 따라:

| 판정 | 클라이언트 동작 |
|---|---|
| `MESSAGE` | 클릭한 버튼의 `text`가 **사용자가 방금 타이핑한 것처럼** 사용자 말풍선으로 추가되고, 동일하게 `POST /simulate`에 `{ message: text }`로 전송(AC-10-15) |
| `NODE` | 사용자 말풍선에 "[버튼] {label}"로 표시(실제 텍스트 입력이 아님을 시각적으로 구분), `POST /simulate`에 `{ buttonAction: { kind:'NODE', nodeId, label } }`로 전송 — 서버가 `resolveByNodeId`를 태워 `trace`에 `NODE_BY_ID`가 남는다(AC-E2-1) |
| `LINK` | 새 탭으로 이동(`rel="noopener noreferrer"`), **서버 호출 없음**(FR-11-25) |

**동음이의어 되묻기 시나리오(S-9)는 별도 UI가 필요 없다** — 되묻기 아웃풋은 `BUTTON` 타입에 `action:'MESSAGE'` 값(예: `과일`/`선박`)을 담아 오므로(DD-27), 위 표의 `MESSAGE` 분기를 그대로 탄다. 다만 화면에서 이 흐름이 눈에 보이도록 다음을 적용한다:

```
봇   "배" 언제 와요?  →  어떤 '배'를 말씀하시는 건가요?
     [ 과일 ]  [ 선박 ]
     판정 근거 보기 ▾
     └ HOMONYM · AMBIGUOUS — 동음이의어 '배' 되묻기 (정책: ASK)

사용자  [버튼] 선박                      ← "선박" 버튼 클릭, MESSAGE 액션이므로 일반 입력처럼 표시
봇   선박 관련 안내입니다 …
     판정 근거 보기 ▾
     └ HOMONYM · 되묻기 응답으로 '선박' 의미 확정   ← CLARIFY_RESOLVED 레이블(§7.7)
```

- `pendingClarify`는 `ConversationState`의 일부이므로 응답의 `state`를 그대로 다음 요청에 실으면(§4.1.1 6단계) 서버가 자동으로 S1.5 단계를 태운다 — **프런트가 `pendingClarify`를 직접 다루는 로직은 없다.**
- 불일치/만료 시(AC-E2-5) trace에 `CLARIFY_DISCARDED`("되묻기 대기 해제")가 표시되고 일반 해석 결과가 이어진다 — 화면에는 별도 오류 없이 자연스러운 다음 응답으로만 보인다.

### 4.1.3 노드로 바로 테스트 (FR-E2-1 노출)

- `NodeJumpPicker`는 `ResourcePickerField(resourceType:'node')`를 그대로 감싼다 — 검색 콤보박스로 노드명을 찾고 선택.
- "이 노드로 시작" 클릭 시 사용자 말풍선 대신 **시스템 안내 말풍선**("[테스트] '배송조회_응답' 노드를 직접 실행합니다")을 추가하고 `POST /simulate`에 `{ buttonAction: { kind:'NODE', nodeId } }`를 전송한다. 대화 맥락(`state`)은 그대로 유지되므로, "진행 중인 슬롯 폼이 있는데 노드로 점프하면 세션이 어떻게 되는가"(§7.2 "버튼이 세션을 이긴다")까지 함께 검증할 수 있다.
- 존재하지 않거나 비활성인 노드를 골랐다면(다른 관리자가 방금 삭제) `NODE_BY_ID_NOT_FOUND` trace + 폴백 응답이 정상적으로 표시된다(AC-E2-2) — 오류 토스트가 아니다.

### 4.1.4 대화 초기화
"대화 초기화" 클릭 → 메시지 목록과 로컬 `state`를 즉시 비움. 확인 모달 없음(FR-10-12, 로컬 동작이라 되돌리기 필요 없음).

---

## 4.2 SIM1-D — 응답 테스트(드로어) (FR-10-17, FR-10-23, AC-10-17)

### 진입 지점

| 편집 화면 | 버튼 위치 | 오버레이 직렬화 대상 |
|---|---|---|
| `NodeFormPage` | 폼 상단 액션 바("저장" 옆) "이 설정으로 테스트" | `overlay.dialogNodes = [현재 폼 상태]`(신규 노드면 `id: 'draft-1'`) |
| `FaqEditModal` | 모달 하단 액션 | `overlay.faqs = [현재 폼 상태]` |
| `ContextFormPage` | 폼 상단 액션 바 | `overlay.contexts = [현재 폼 상태]` |

### 레이아웃 (우측 슬라이드 드로어, 데스크톱 폭 480px)

```
┌ 응답 테스트 ─────────────────────────────── ✕ ┐
│ 🟡 미저장 변경 적용됨 — 저장하지 않은 이 설정으로 │
│    테스트합니다.                                │
├─────────────────────────────────────────────┤
│ ( ● 실시간 테스트 )  ( ○ 저장본과 비교 )        │
├─────────────────────────────────────────────┤
│ (SIM1의 ChatMessageList와 동일 컴포넌트)         │
│                                               │
├─────────────────────────────────────────────┤
│ 메시지 입력 [___________________]  [전송]      │
└─────────────────────────────────────────────┘
```

### 동작 규칙

1. **이탈 경고를 일으키지 않는다.** 드로어는 라우트를 바꾸지 않으므로 `UnsavedGuardContext.setGuard()`를 호출하지 않는다 — 편집 폼의 dirty 상태와 드로어 열림/닫힘은 완전히 독립적이다(설계서 §10, AC-10-17).
2. 열릴 때 포커스는 드로어 내부 입력창으로 이동, `Esc`로 닫히며 포커스는 트리거 버튼("이 설정으로 테스트")으로 복귀(`Modal`의 기존 포커스 트랩 패턴 재사용, 배경 편집 폼은 클릭 불가하지 않고 **드로어만 오버레이 형태로 우측에 고정**돼 배경 폼이 가려지지 않게 한다 — S-4 시나리오가 "편집 폼을 보면서 동시에 테스트"를 요구하지 않으므로 단순 오버레이로 충분하다).
3. 열릴 때마다 **현재 폼 상태를 오버레이로 재직렬화**한다(고정 스냅샷이 아니라 갱신) — 드로어를 열어둔 채 폼을 더 고치고 재전송하면 최신 상태가 반영된다.
4. `OverlayBadge`는 드로어 진입 시 항상 노출(오버레이가 없는 상태로는 드로어에 들어올 수 없다 — 드로어 자체가 "이 설정으로 테스트"로만 열린다).
5. "저장본과 비교" 토글 클릭 → SIM2(§4.3)와 동일한 `CompareView`가 드로어 내부에 렌더된다(같은 오버레이를 재사용, S-4 문장 5개 입력 시나리오).

---

## 4.3 SIM2 — 비교 모드(A vs B) (FR-10-25~31, J-1)

### 목적
저장본(A)과 "저장본 + 오버레이"(B)를 같은 문장들로 나란히 돌려 회귀를 조기에 발견한다. SIM1/SIM1-D 내부 모드 전환이며 별도 라우트가 아니다.

### 상태별 UI

| 상태 | UI |
|---|---|
| 오버레이 없음(SIM1 탭에서 바로 비교 클릭) | 실행 자체를 막는다: "비교할 변경 내용이 없습니다. 편집 화면에서 '이 설정으로 테스트'로 진입해 주세요." + 버튼 비활성(AC-10B-10, FR-10-31) |
| 문장 입력 전 | "비교 실행" 버튼 `aria-disabled` |
| 실행 중 | 결과 영역 `SkeletonRow` × 문장 수 |
| 완료 | "N턴 · 차이 M건" 완료 배지(NFR-A4) + 결과 목록 |
| 21건 초과 입력 | 전송 전 클라이언트 차단: "최대 20문장까지 입력할 수 있습니다." + 초과분 카운터 빨강(AC-10B-11 방어선) |

### 레이아웃 (데스크톱, 결과 2단)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 문장 입력(줄바꿈으로 구분, 최대 20건) — 18/20문장                          │
│ ┌────────────────────────────────────────────────────────────────────┐ │
│ │ 배송 조회                                                            │ │
│ │ 환불                                                                 │ │
│ │ 영업시간                                                             │ │
│ └────────────────────────────────────────────────────────────────────┘ │
│ ☐ 달라진 것만 보기                                      [비교 실행]      │
├──────────────────────────────────────────────────────────────────────────┤
│ 완료 · 5턴 · 차이 1건                                                     │
├───────────────────────────────────┬──────────────────────────────────────┤
│ A(저장본)                          │ B(저장본 + 미저장 변경)                │
│ 1. 배송 조회                        │ 1. 배송 조회                          │
│    "배송은 2~3일 소요됩니다"        │    "배송은 2~3일 소요됩니다"           │
│                                     │                          🟨 변경됨    │
│ 2. 환불                             │ 2. 환불                               │
│    "환불은 영업일 기준 5일"         │    "환불은 영업일 기준 3일"            │
└───────────────────────────────────┴──────────────────────────────────────┘
```

### 컴포넌트 분해

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `CompareInputArea` | `messages: string[]`(줄바꿈 분리), `maxCount=20`, `maxLength=1000` |
| `CompareRunButton` | `disabled = overlay가 비었거나 messages가 비었을 때` |
| `CompareSummaryBadge` | `{ total, same, different }`(=`CompareResponseSchema.summary`) |
| `DifferentOnlyFilter` | 체크박스(다중 선택 아님 — 단일 토글이므로 사실상 UIUX §6의 "다중선택=체크박스" 예외적 단일 필터. 라디오가 아닌 이유: on/off 2상태이며 폼 제출이 아니다) |
| `CompareView` | `turns: CompareTurn[]`, `layout:'columns'\|'stack'`(반응형에 따라 전환) |
| `CompareTurnRow` | `index`, `message`, `a: CompareTurnResult`, `b: CompareTurnResult`, `diff: {status,outputsChanged,matchChanged}` |
| `DiffBadge` | `status:'SAME'\|'DIFFERENT'` → SAME은 배지 없음(노이즈 최소화, 목록이 길 때 DIFFERENT만 부각), DIFFERENT는 노란 배경 + "변경됨" 텍스트(색상 단독 금지) |
| `CompareTurnDetail`(각 행 펼침) | `a.trace`, `b.trace` — `TracePanel` 재사용, 좌우 각각 |

### 실행 흐름

1. 문장 입력 → "비교 실행" 클릭 → `POST /chatbots/:id/simulate/compare` `{ messages, overlay, initialState? }`(DD-32 — `stateA`/`stateB` 대신 `initialState` 단일 필드, A/B는 같은 시작점에서 각자 진행).
2. 결과 수신 → `CompareSummaryBadge` + `CompareTurnRow` 목록 렌더. `diff.status==='DIFFERENT'`인 행은 양쪽 모두에 `DiffBadge` 부착.
3. "달라진 것만 보기" 체크 시 `status==='SAME'` 행을 목록에서 숨긴다(요청 재전송 없음, 클라이언트 필터).
4. 각 행 확장 시 좌우 `matchedNodeName`/`matchedFaqQuestion` 캡션과 개별 `TracePanel`을 볼 수 있어 "왜 달라졌는지"(`matchChanged` vs `outputsChanged`)를 판별한다.
5. 20문장 초과, 오버레이 종류별 21건 초과 등 서버 `400 LIMIT_EXCEEDED` 응답 시 입력 영역 상단에 인라인 오류 배너.

---

## 4.4 CH1 — 채널 관리 `/chatbots/:chatbotId/channels`

### 목적
8종 채널을 조회하고, WEB 채널은 활성화·상세 설정까지, 나머지 7종은 메모만 저장한다.

### 상태별 UI

| 상태 | UI |
|---|---|
| 로딩 | `SkeletonCard` × 8 |
| 정상(성공) | 8종 카드 그리드(§4.4.2). 항상 8장 — "빈 상태"가 없다(FR-11-2, AC-11-1: 레코드 0건이어도 8종 전부 `configured:false`로 반환) |
| `ARCHIVED` 챗봇 | 상단 `SeverityBadge(WARNING)`: "보관된 챗봇입니다. 채널 설정을 변경하려면 먼저 '초안으로 복구'하세요." — 카드 자체는 조회 가능(목록 조회는 허용), 쓰기 액션(토글·저장·삭제)만 `aria-disabled`(FR-0-22, AC-11-9) |

### 레이아웃 (데스크톱, 카드 그리드 2~3열)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 채널                                                                       │
├───────────────────────────┬───────────────────────────┬──────────────────┤
│ 웹(WEB)          [ON ●]   │ 모바일 앱        준비중배지 │ 카카오톡  준비중배지│
│ 대화 가능 · 도메인 2개      │ (토글 aria-disabled)       │ (토글 aria-disabled)│
│ [설정 열기] [임베드 코드]   │ [설정 열기]                │ [설정 열기]        │
├───────────────────────────┼───────────────────────────┼──────────────────┤
│ 라인       준비중배지       │ 페이스북   준비중배지        │ 네이버 톡톡 준비중배지│
├───────────────────────────┼───────────────────────────┼──────────────────┤
│ 앱(APP)    준비중배지       │ 키오스크   준비중배지         │                  │
└───────────────────────────┴───────────────────────────┴──────────────────┘
```

### 4.4.1 `ChannelCard` 공통 구조

```
┌ {label} ────────────────────────────────────┐
│ {구현상태 배지}  {활성 배지(configured일 때만)} │
│ {요약 캡션}                                    │
│ [토글: 사용 { ON | OFF }]  (aria-disabled + 사유) │
│ [설정 열기]  (+ WEB만: [임베드 코드 보기])       │
└───────────────────────────────────────────────┘
```

| 요소 | 데이터 바인딩 / 규칙 |
|---|---|
| 구현상태 배지 | `item.implementation === 'IMPLEMENTED'` → 배지 없음(정상이 기본값이라 노이즈 최소화) / `'CONFIG_ONLY'` → `SeverityBadge`류 회색 배지 "준비 중"(색상 단독 아님, 아이콘+텍스트) |
| 활성 배지 | `item.enabled === true`일 때만 초록 "사용 중" 배지. `configured===true && enabled===false`면 "설정됨 · 미사용"(중립색) |
| 요약 캡션 | WEB: "대화 가능 · 도메인 {allowedOrigins.length}개"(0개면 "모든 도메인 허용" + `OriginAllowAllBadge`) / `CONFIG_ONLY`: `config.note` 앞 40자 또는 "메모 없음" |
| 토글 | `ChannelToggle` — 아래 §4.4.2 |
| "설정 열기" | 카드 내 인라인 확장(아코디언) 또는 별도 드로어 — **인라인 확장**을 채택(카드가 8장뿐이라 모달/드로어보다 스크롤 이동이 적음) |
| "임베드 코드 보기"(WEB 전용) | `href="/chatbots/:id/skin?section=embed"`(기존 스킨 탭의 임베드 서브탭, FR-11-12 상호 바로가기) |

### 4.4.2 `ChannelToggle` — `aria-disabled` 규칙 (NFR-A3, AC-11-12)

```html
<!-- IMPLEMENTED(WEB), 정상 -->
<button type="button" role="switch" aria-checked="true" class="channel-toggle">사용 중</button>

<!-- CONFIG_ONLY, 활성화 불가 -->
<button type="button" role="switch" aria-checked="false" aria-disabled="true"
        aria-describedby="kakaotalk-toggle-reason" class="channel-toggle channel-toggle--locked">
  사용 안 함
</button>
<p id="kakaotalk-toggle-reason" class="channel-toggle-reason">
  이 채널은 아직 연동을 제공하지 않습니다. 설정만 미리 저장할 수 있습니다.
</p>
```

- **`disabled`가 아니라 `aria-disabled`를 쓰는 이유**를 마크업 수준에서 강제한다 — `disabled` 버튼은 Tab으로 포커스를 받지 못해 인접한 `channel-toggle-reason`에 스크린리더가 도달할 경로가 없다. `aria-disabled`는 포커스는 받되 클릭/Enter/Space 시 아무 요청도 보내지 않고(클라이언트가 즉시 차단), 대신 `aria-describedby`로 연결된 사유 문단을 함께 읽게 한다.
- 클릭을 시도해 만약 클라이언트 차단을 우회해 서버까지 도달하면(방어적 코딩 미비 시) 서버가 `409 CHANNEL_NOT_IMPLEMENTED`로 재차 거부하므로 이중 방어가 된다(AC-11-3).
- 시각적으로도 `channel-toggle--locked`는 회색 처리 + 잠금 아이콘을 병기해 "비활성"임을 색상 외 수단으로도 전달한다(UIUX §1).
- `ARCHIVED` 챗봇에서는 WEB 토글도 동일하게 `aria-disabled` + 사유 "보관된 챗봇은 채널을 변경할 수 없습니다. 먼저 초안으로 복구하세요."로 전환된다(FR-0-22).

### 4.4.3 WEB 카드 — 설정 폼(인라인 확장)

```
┌ 웹(WEB) 설정 ──────────────────────────────────────────────────┐
│ 허용 도메인 (비우면 모든 도메인 허용)                              │
│ [ https://www.example.co.kr × ] [ https://m.example.co.kr × ]   │
│ [___________________________] [추가]           2/20              │
│ ⚠ 형식: https://도메인(:포트) — 경로·와일드카드 불가               │
├──────────────────────────────────────────────────────────────────┤
│ 인사말 (최대 200자)      [무엇을 도와드릴까요?______________] 12/200│
│ 빠른 응답 (최대 5개)      [배송조회 ×][환불 ×] [___________][추가] 2/5│
│ 런처 위치                (●) 오른쪽   ( ) 왼쪽                     │
│ ☑ 런처 버튼 표시                                                  │
├──────────────────────────────────────────────────────────────────┤
│                                                [취소]   [저장]     │
└──────────────────────────────────────────────────────────────────┘
```

| 필드 | 컴포넌트 | 검증/비고 |
|---|---|---|
| 허용 도메인 | `ChipListEditor`(재사용) | `AllowedOriginSchema` 정규식(스킴+호스트) — 형식 위반 칩은 추가 즉시 인라인 오류(제출 전 클라이언트 검증), 최대 20개. 0개면 `OriginAllowAllBadge`("⚠ 모든 도메인에서 호출 가능") 상시 노출(FR-11-9, AC-11-7) |
| 인사말 | `TextAreaField` | `maxLength=200`, 잔여 글자수 실시간(UIUX §5) |
| 빠른 응답 | `ChipListEditor` | 각 항목 `maxLength=20`, 최대 5개 |
| 런처 위치 | 라디오 2개(단일 선택, UIUX §6) | `RIGHT`/`LEFT` |
| 런처 표시 | 체크박스 | `showLauncher` |

저장 시 `PATCH /chatbots/:id/channels/WEB` `{ config: {...} }`(부분 수정 시맨틱 — `enabled`는 토글이 별도로 보낸다). 저장 성공 → `Toast` + 카드 요약 캡션 갱신 + `updatedAt` 갱신.

### 4.4.4 `CONFIG_ONLY` 카드 — 설정 폼(인라인 확장)

```
┌ 카카오톡 설정 ─────────────────────────────────────────┐
│ ⓘ 이 채널은 설정을 미리 기록해 둘 수 있으나, 실제 메시지   │
│   연동은 다음 버전에서 제공됩니다.                        │
│ 메모 (최대 500자)                                        │
│ [2분기 오픈빌더 심사 예정__________________________]      │
│                                          [취소]  [저장]   │
└──────────────────────────────────────────────────────────┘
```

- 필드는 `note` 1개뿐(NFR-S7 — 자격증명 입력란 자체가 없다). 토큰/시크릿을 붙여넣어도 저장 폼에 입력란이 없으므로 "실수로라도" 입력할 경로가 UI 단계에서부터 없다.
- 저장은 `enabled`를 건드리지 않으므로 `PATCH .../channels/KAKAOTALK` `{ config: { note } }`만 전송 — 409가 발생하지 않는다(§5.2 설계서 "CONFIG_ONLY의 409 조건 정밀화": 전환 시도만 거부).

### 4.4.5 삭제 흐름 (FR-11-11)

카드 확장 영역 하단(또는 kebab)에 "설정 초기화" 액션 → `ChannelDeleteConfirmDialog`("이 채널의 설정을 초기화하시겠습니까? WEB 채널이면 비활성화도 함께 적용됩니다.") → 확인 시 `DELETE /channels/:type` → `204`, 카드가 즉시 `configured:false` 상태로 재렌더(FR-11-11, AC-11-10). `Esc`로 취소 시 아무 변경 없이 포커스가 트리거로 복귀(AC-C-6).

---

## 5. `apps/widget` 설계 (FR-W-1~24, ADR-0012) — 별도 컴포넌트 체계

> React가 아니므로 "컴포넌트 props"가 아니라 **DOM 구조(마크업) · 상태 전이 · 이벤트 핸들러**로 기술한다. `core/`(순수 로직, FR-W-16)와 `ui/`(DOM 적용)의 분리를 그대로 화면 설계에 반영한다.

### 5.1 전체 구조와 Shadow DOM 경계

```html
<!-- 호스트 페이지 -->
<script src="https://.../widget.js" data-chatbot="order-bot" data-api-base="..." data-mode="desktop"></script>

<!-- widget.js가 body 말단에 주입하는 구조 -->
<div id="cb-widget-root">
  #shadow-root (open)
    <style>/* styles.ts의 TS 문자열, Shadow 내부에만 적용 */</style>
    <div class="cb-root" data-state="closed|opening|open|closing">
      <button id="cb-launcher" class="cb-launcher" aria-haspopup="dialog" aria-expanded="false" aria-controls="cb-panel">
        <!-- 아이콘 + 미확인 알림 점(있다면, 이번 Phase는 없음) -->
      </button>
      <section id="cb-panel" class="cb-panel" role="dialog" aria-modal="false" aria-labelledby="cb-panel-title" hidden>
        <header class="cb-header">
          <img class="cb-logo" src="" alt="" hidden />
          <h2 id="cb-panel-title" class="cb-title"></h2>
          <button id="cb-close" class="cb-close" aria-label="상담창 닫기">✕</button>
        </header>
        <div id="cb-messages" class="cb-messages" role="log" aria-live="polite" aria-relevant="additions" tabindex="0"></div>
        <div id="cb-status" class="cb-status" role="status"></div> <!-- "응답 생성 중" 전용, 메시지 로그와 분리 -->
        <form id="cb-composer" class="cb-composer">
          <label for="cb-input" class="cb-input-label">메시지 입력</label>
          <textarea id="cb-input" class="cb-input" maxlength="1000" aria-describedby="cb-remaining"></textarea>
          <span id="cb-remaining" class="cb-remaining" aria-hidden="true">1000자 남음</span>
          <button type="submit" id="cb-send" class="cb-send">전송</button>
        </form>
      </section>
    </div>
</div>
```

- **모든 `id`/`for`/`aria-labelledby`/`aria-controls`/`aria-describedby`는 shadow root 내부에서 완결**된다(§9.5 제약, shadow 경계를 넘지 못하므로). 호스트 페이지의 `id`와 충돌하지 않는다.
- `#cb-widget-root`는 호스트 문서(light DOM)에 존재하는 **유일한 노출 요소**이며, 전역 심볼은 `window.__ChatBotWidget` 1개뿐(EX-W-3).
- `role="dialog" aria-modal="false"`인 이유: 완전한 모달(배경 스크롤 잠금·포커스 완전 가둠)은 범위 밖(§9.3 제외 항목에 명시되지 않았지만 최소 버전 원칙상 페이지 콘텐츠를 잠그지 않는다)이며, 대신 패널 내부에는 포커스 트랩을 적용한다(§5.3).

### 5.2 상태 전이 (`core/store.ts` reducer가 관리하는 상태)

```
        click/Enter 런처              Esc / close 클릭
  CLOSED ───────────────────▶ OPENING ───────────────────▶ CLOSED
    ▲                            │ (config fetch 완료, 인사말 1회 표시)
    │                            ▼
    │                          OPEN ◀────────────┐
    │                            │ 전송            │ 200 응답 수신
    │                            ▼                │
    │                        SENDING ──────────────┘
    │                            │ 오류(NETWORK/429/403/404)
    │                            ▼
    │                          ERROR ─(재시도 클릭)─▶ SENDING
    └────────────────────────────┘ (403은 OPEN에 머물되 입력만 비활성)
```

| 상태 | 화면 |
|---|---|
| `CLOSED` | 런처만 보임(`aria-expanded="false"`, `hidden` on panel) |
| `OPENING` | `GET /public/chatbots/:slug/config` 요청 중 — 런처는 로딩 스피너로 즉시 전환(패널이 열리기 전 시각 피드백) |
| `OPEN` | 패널 렌더 완료, 포커스가 입력창으로 이동(FR-W-19), 인사말+퀵리플라이 1회 표시(FR-W-15) |
| `SENDING` | 입력/전송 버튼 `aria-disabled`, `#cb-status`에 "응답 생성 중" 기입(`role="status"`가 스크린리더에 자동 알림, FR-W-21) |
| `ERROR` | 오류 유형별 문구(§5.5), 네트워크 오류는 대화가 끊기지 않고 같은 패널에서 재시도 가능 |
| `404`(런처 자체 미노출) | store 상태가 아니라 **부팅 단계**에서 분기 — `loader.ts`가 `GET /config` 404를 받으면 `<div id="cb-widget-root">` 자체를 마운트하지 않고 `console.warn`만 남긴다(FR-W-10) |

`config`가 `403`(`CHATBOT_NOT_PUBLISHED`/`CHANNEL_DISABLED`)이면 런처는 정상 렌더하되 **패널은 열려도 입력창이 `aria-disabled`** 로 고정되고 안내 문구("현재 상담을 이용할 수 없습니다.")가 `#cb-messages`에 시스템 메시지로 1회 표시된다(AC-W-13) — `store.status`에 `DISABLED` 값을 별도로 둔다.

### 5.3 이벤트 흐름 / 키보드 상호작용 (FR-W-19~21, AC-W-2~5, AC-W-15)

| 트리거 | 동작 |
|---|---|
| 런처 클릭 또는 포커스 후 `Enter`/`Space` | `CLOSED → OPENING → OPEN`, 포커스가 `#cb-input`으로 이동(`focus()` 호출) |
| 패널 열린 상태에서 `Tab`/`Shift+Tab` | 포커스 트랩 — `#cb-panel` 내부 포커스 가능 요소(닫기 버튼 → 메시지 로그(`tabindex=0`) → 입력창 → 전송 버튼 → 다시 닫기 버튼)만 순환한다. `core/`의 순수 함수 `computeFocusOrder(panelState)`가 순서를 계산하고 `ui/`가 `focus()`를 적용(관심사 분리, FR-W-16) |
| `Esc`(패널 열린 상태) | `OPEN → CLOSED`, 포커스가 **런처로 복귀**(`#cb-launcher.focus()`, FR-W-19, AC-W-3) |
| `Enter`(입력창, `Shift` 없이) | 전송(폼 `submit`) |
| `Shift+Enter`(입력창) | 줄바꿈(기본 textarea 동작, `preventDefault` 하지 않음) |
| 아웃풋 버튼 클릭 또는 `Enter`/`Space` | `<button>` 요소이므로 브라우저가 두 방식을 동일하게 처리(FR-W-20 — `div+role="button"` 금지) |
| 메시지 영역 스크롤 | `overflow-y:auto` + `tabindex="0"`이라 휠/방향키(`↑`/`↓`/`PageUp`/`PageDown`)로 스크롤 가능(FR-W-23) |

### 5.4 아웃풋 렌더링 (FR-W-5~7, FR-W-11)

`core/`에서 `toOutputViews(outputs)`(공유 로직)로 얻은 `OutputView[]`를 `ui/renderers/{text,card,image,button,link,phone-call}.ts`가 각각 DOM으로 그린다.

| 타입 | 마크업 규칙 |
|---|---|
| `TEXT` | `<p class="cb-msg-text"></p>`, `textContent`로만 삽입(FR-W-11, `innerHTML` 0건) |
| `CARD` | `<div class="cb-card"><img alt="{altText}" loading="lazy"><h3></h3><p></p><div class="cb-card-buttons">…버튼…</div></div>`. `imageUrl`이 `isSafeHttpUrl()` 실패 시 `<img>` 자체를 렌더하지 않고 대체 텍스트만(EX-W-5) |
| `IMAGE` | `<img alt="{altText}">` 필수(`altText` 없는 데이터는 서버 저장 단계에서 이미 막힘, 방어적으로 빈 문자열 폴백) |
| `BUTTON` | 버튼 그룹은 `<div class="cb-buttons" role="group" aria-label="선택지">` 안에 `<button>` N개, 각 44×44px 이상(FR-W-18) |
| `LINK` | `<a href="{url}" target="_blank" rel="noopener noreferrer">`, `isSafeHttpUrl()` 실패 시 렌더 생략 |
| `PAUSE` | DOM 요소를 만들지 않는다 — `planPauseSchedule()`이 계산한 지연만큼 `#cb-status`에 "입력 중…" 표시 후 다음 아웃풋 렌더(누적 최대 5초, FR-W-7) |
| `PHONE_CALL` | `<a href="tel:{phoneNumber}" class="cb-phone">{label}</a>` |

### 5.5 오류/로딩 상태 (FR-W-9, FR-W-10, EX-W-*)

| 상황 | 화면 |
|---|---|
| 응답 대기 | `#cb-status`(`role="status"`) = "응답 생성 중", 전송 버튼 `aria-disabled`(연타해도 `SENDING` 상태에서 재전송 막힘) |
| `NETWORK` | `#cb-messages`에 오류 말풍선(`role="alert"`, 아이콘+텍스트): "일시적인 오류가 발생했어요. 다시 시도해 주세요." + `재시도` 버튼(직전 페이로드 재전송) |
| `429` | "요청이 많습니다. 잠시 후 다시 시도해 주세요." (재시도 버튼 없음 — 즉시 재시도는 또 429를 유발) |
| `403` | 패널은 열리되 입력 `aria-disabled` + "현재 상담을 이용할 수 없습니다." |
| `404`(config 조회) | 런처 자체 미마운트, `console.warn`만 |
| 이미지 URL 깨짐 | `<img>` `onerror` → 대체 텍스트 노드로 교체, 레이아웃 유지(EX-W-5) |
| 응답 아웃풋 0건(이론상) | "잠시 후 다시 시도해 주세요." 기본 문구(빈 말풍선 금지, EX-W-6) |
| `sessionStorage` 불가(프라이빗 모드) | `core/session.ts`가 메모리 객체로 폴백, 사용자에게는 표시하지 않음(대화는 계속됨, EX-W-7) |

### 5.6 스킨 반영 (FR-W-4, FR-W-22)

- 부팅 시 `GET /public/chatbots/:slug/config` 응답의 `skin.{primaryColor,headerTitle,logoUrl}`을 `#cb-header`에 적용: 배경색 `primaryColor`, `#cb-title.textContent = headerTitle`, `logoUrl` 있으면 `<img class="cb-logo">` 노출(없으면 `hidden` 유지).
- 헤더 텍스트 색은 `@chat-bot/shared-types/contrast`의 `evaluateHeaderContrast(primaryColor)` → `suggestedTextColor`로 자동 전환해 4.5:1 대비를 보장한다(AC-W-14) — 관리자가 고른 색과 무관하게 위젯이 스스로 판정한다(No.4 로직 재사용, §0-8).
- `greetingMessage`는 `OPEN` 진입 최초 1회만 봇 말풍선으로 렌더, `quickReplies`는 그 아래 버튼 그룹(`MESSAGE` 액션과 동일, FR-W-15).

### 5.7 전체화면 `/c/:slug` (W2, FR-W-3)

- `apps/widget`의 두 번째 빌드 타깃(`fullscreen.ts`)으로, `<div id="cb-widget-root">` 대신 **`<body>` 전체를 패널로 사용**한다 — Shadow DOM은 여전히 쓰되 `mode='desktop'` 임베드와 달리 런처가 없고 `OPEN` 상태로 바로 시작한다.
- `pathname`에서 `slug`를 추출(`/c/{slug}`), `VITE_PUBLIC_API_BASE_URL`(환경변수)로 API 베이스를 결정(임베드 모드처럼 `data-api-base`를 받을 host script가 없으므로).
- 정적 호스팅은 `/c/*` → `index.html` SPA fallback이 필요(설계서 §9.2, 배포 인계 사항 — 이 문서는 화면 설계이므로 인프라 설정 자체는 `docs/05-ops`로 넘긴다).
- `data-fullscreen="true"` 임베드 모드(모바일)는 **동일한 전체화면 렌더링**을 `widget.js` 내부에서 재사용한다(별도 페이지 이동 없이 `data-mode=mobile`일 때 패널이 뷰포트 전체를 차지하도록 CSS만 전환).

### 5.8 접근성 구현 매핑 (설계서 §9.5 그대로 계승 — 요건 ↔ 마크업 1:1)

| 요건 | 본 화면 설계의 구체 반영 |
|---|---|
| FR-W-17 레이블 | `<label for="cb-input">메시지 입력</label>`(§5.1 마크업). 잔여 글자수(`#cb-remaining`)는 정적 텍스트, `aria-live` 아님 |
| FR-W-18 터치 영역 | `.cb-launcher`/`.cb-send`/`.cb-buttons button` CSS `min-width:44px; min-height:44px` |
| FR-W-19 포커스 | §5.3 표 그대로 |
| FR-W-20 키보드 | `<button>` 요소 강제(§5.4), `Enter`/`Shift+Enter` 분기(§5.3) |
| FR-W-21 스크린리더 | `#cb-messages[role="log"][aria-live="polite"]`, `#cb-status[role="status"]` 분리(§5.1) |
| FR-W-22 대비 | §5.6 |
| FR-W-23 스크롤 | `#cb-messages{overflow-y:auto} tabindex="0"` |
| FR-W-24 색상 단독 금지 | 오류 말풍선 `role="alert"` + 경고 아이콘 + 텍스트, "응답 생성 중"도 아이콘(●●● 타이핑 인디케이터)+텍스트 병기 |
| FR-W-11 XSS | `textContent`만 사용, `isSafeHttpUrl()` 게이트(§5.4) |

---

## 6. 사용자 인터랙션 흐름 (제출 → 로딩 → 결과, 오류 포함)

### 6.1 단건 시뮬레이션 (SIM1)

```
[입력] → (클라이언트 검증: 공백/1000자) → 실패: 인라인 안내, 요청 안 보냄
                                      → 통과: 사용자 말풍선 추가 + POST /simulate
                                             → 대기: 타이핑 인디케이터 + "응답 생성 중"
                                             → 200: 봇 말풍선 렌더 + trace 부착 + 세션패널 갱신
                                             → 4xx/5xx: 오류 말풍선 + 재시도
```

### 6.2 비교 실행 (SIM2)

```
[오버레이 없음] → 실행 버튼 비활성 + 안내 문구
[문장 입력] → [비교 실행] → 대기: 결과 영역 스켈레톤
                          → 200: 완료 배지("N턴·차이 M건") + CompareTurnRow 목록
                          → 400 LIMIT_EXCEEDED: 입력 영역 상단 인라인 오류
```

### 6.3 채널 활성화 (CH1, WEB)

```
[토글 클릭] → 낙관적 UI 없음(즉시 PATCH 전송, 로딩 스피너를 토글 위에 표시)
           → 200: 배지 "사용 중"으로 전환 + Toast
           → 409 CHATBOT_ARCHIVED: 토글 원복 + 상단 배너로 안내
```

### 6.4 채널 활성화 시도 (CONFIG_ONLY, 방어선 우회 상황 대비)

```
[토글은 처음부터 aria-disabled — 클릭해도 요청 자체가 발생하지 않음]
(방어선이 뚫린 예외 상황 가정 시) → 409 CHANNEL_NOT_IMPLEMENTED → Toast로 동일 사유 안내
```

### 6.5 위젯 대화 전송

```
[Enter] → 사용자 말풍선 즉시 추가 → SENDING(입력 비활성 + "응답 생성 중")
        → 200: 봇 말풍선(OutputRenderer) + state 통째 교체
        → NETWORK: 오류 말풍선 + 재시도 버튼
        → 429: 오류 말풍선(재시도 버튼 없음)
        → 403: 입력창 즉시 비활성 전환 + 안내 문구
```

### 6.6 동음이의어 되묻기 (SIM1 §4.1.2 / 위젯 §5.4 공통)

```
"배 언제 와요?" 전송 → 봇: 되묻기 BUTTON 출력([과일][선박]) + state.pendingClarify 포함
"선박" 버튼 클릭(MESSAGE 액션) → 사용자 말풍선 "선박" → POST(state에 pendingClarify 포함)
  → 서버 S1.5 단계에서 CLARIFY_RESOLVED → 선박 의미 확정 응답
  → (불일치/만료 시) CLARIFY_DISCARDED → 일반 해석 결과로 자연 진행
```

### 6.7 노드 점프 (SIM1 §4.1.3)

```
[노드 검색 → 선택] → [이 노드로 시작] → 시스템 말풍선("[테스트] '{노드명}' 직접 실행")
                                     → POST { buttonAction:{kind:'NODE', nodeId} }
                                     → 200: 해당 노드 아웃풋 렌더 + trace에 NODE_BY_ID
                                     → (노드 없음/비활성) NODE_BY_ID_NOT_FOUND + 폴백 응답(오류 아님)
```

---

## 7. `UIUX_준수기준.md` 체크리스트 매핑

### 7.1 공통(SIM1/SIM1-D/SIM2/CH1 — 관리자 콘솔)

| 기준 | 항목 | 적용 지점 |
|---|---|---|
| §1 색상대비 | 텍스트 4.5:1, 색상 단독 금지 | `DiffBadge`/`SeverityBadge`/구현상태 배지 전부 아이콘+텍스트 병기, `OriginAllowAllBadge` |
| §3 키보드접근성 | Tab 순차, Enter/Space 실행, Esc+포커스복귀 | 드로어(§4.2), 채널 삭제 모달(§4.4.5, AC-C-6), `TracePanel` 토글(`aria-expanded`) |
| §4 버튼 | 동사형 레이블, 연타 방지, 44×44px | "전송"/"저장"/"비교 실행", `MessageComposer` 전송 중 `aria-disabled`, `ChannelToggle` |
| §5 텍스트입력필드 | 레이블 필수, 글자수 실시간 | `MessageComposer`(1000자), `WebChannelForm` 인사말(200자)/빠른응답(20자) |
| §6 폼컨트롤 | 단일선택=라디오, 다중선택=체크박스 | `SimulatorModeToggle`(라디오), `DifferentOnlyFilter`(체크박스), 런처 위치(라디오) |
| §7 오류메시지 | 원인+해결방법, 제출 시점 | 도메인 형식 오류, `LIMIT_EXCEEDED` 인라인 배너 |
| §8 로딩/상태 | 스켈레톤, 완료 배지 | `CompareSummaryBadge`("N턴·차이M건"), 채널 카드 로딩 스켈레톤 |
| §9 내비게이션 | href 기반, 현재 탭 구분 | `TabNav`(§2.3), `TraceStepRow`의 편집 이동 링크 |

### 7.2 화면별

| 화면 | UIUX 항목 | 적용 지점 |
|---|---|---|
| SIM1 | §8(로딩→완료) | "응답 생성 중" → 봇 말풍선 전환 |
| | §7(빈 상태 vs 오류 구분) | 자산 0건 배너(중립 INFO) ≠ 네트워크 오류 말풍선(`role="alert"`) |
| SIM2 | §6(체크박스 단일 토글) | `DifferentOnlyFilter` |
| | §9(표 키보드 탐색) | `CompareTurnRow` 확장은 버튼(`aria-expanded`)으로, 표 자체가 아닌 리스트 구조 사용 |
| CH1 | §1(비활성 토글 사유) | `ChannelToggle` `aria-disabled`+`aria-describedby`(§4.4.2) |
| | §4(터치 영역) | 카드 내 모든 액션 버튼 44×44px, 모바일 그리드 1열 |
| 위젯(W1/W2) | (a) 전 항목 | §5.8 매핑표 |

### 7.3 자동화 연계
`AC-C-2`(관리자 화면 키보드 전 과정 완료), `NFR-A8`(위젯 axe 스캔 대비 0건)은 `test-automation` 검증 대상이며, 본 설계의 `<label for>` 강제, href 기반 탭, Shadow 내부 id 완결 규칙이 그 전제 조건이다.

---

## 8. 반응형 고려사항

### 8.1 관리자 콘솔(`apps/web`)

| 브레이크포인트 | 폭 | 레이아웃 변화 |
|---|---|---|
| 데스크톱 | ≥1024px | SIM1: 대화영역(좌, 가변) + 세션상태 패널(우, 고정 300px) 2단. SIM2: 결과 A/B 2단(`layout='columns'`). CH1: 카드 3열 그리드 |
| 태블릿 | 640~1023px | SIM1: 세션상태 패널이 대화영역 **아래**로 이동(세로 스택), `TracePanel`은 말풍선 내부 유지. SIM2: `layout='stack'`(각 턴이 A 카드 → B 카드 순서로 세로 배치). CH1: 카드 2열. `TabNav`는 §2.4 그룹 단위 줄바꿈 |
| 모바일 | <640px | SIM1: 세션상태 패널은 접이식 아코디언(기본 접힘, "세션 상태 보기" 토글)으로 전환해 대화 영역을 최대화. `MessageComposer`는 화면 하단 고정(sticky). CH1: 카드 1열, 인라인 확장 폼은 전체 너비. `TabNav`는 §2.4 드롭다운으로 축소. 모든 클릭 요소 44×44px 유지 |

### 8.2 위젯(`apps/widget`)

| 모드 | 트리거 | 크기 |
|---|---|---|
| 데스크톱 플로팅(`data-mode="desktop"`) | 기본 | 패널 고정 크기(예: 360×560px), 호스트 페이지 우하단(또는 좌하단, `launcherPosition`) 고정 배치, 호스트 레이아웃에 영향 없음(`position:fixed`, Shadow 내부) |
| 모바일(`data-mode="mobile"` 또는 `data-fullscreen="true"`) | 스니펫 속성 | 패널이 뷰포트 전체를 차지(`100vw × 100dvh`), 헤더에 닫기 버튼이 유일한 탈출 경로 |
| 전체화면(`/c/:slug`) | 직접 URL 접속 | 모바일 모드와 동일한 전체화면 렌더링을 처음부터 적용, 런처 없음 |

공통 원칙: 위젯은 호스트 페이지의 반응형 레이아웃에 개입하지 않는다(`position:fixed` + Shadow DOM 격리) — 호스트 CSS 미디어쿼리와 무관하게 위젯 자신의 컨테이너 쿼리(또는 `data-mode` 정적 분기)로만 판단한다(FR-W-12 연장).

---

## 9. `frontend-implementer` 인계 메모

1. **선행 확인**: `packages/shared-types`의 `output-view.ts`/`contrast.ts` 서브패스 export(DD-24)와 `conversation.ts`/`channel.ts` 스키마(설계서 §4)가 먼저 구현돼 있어야 이 문서의 데이터 바인딩이 그대로 맞는다. `apps/widget`은 이 서브패스만 값 import하고 루트 import는 ESLint로 금지된다(§0-8).
2. **`TabNav` 변경은 파일 1개, 구조 변경 아님**(§2) — 기존 4개 라우트·컴포넌트는 그대로 두고 그룹 래퍼 `<div role="group">`만 추가한다.
3. **`SimulatorPanel`을 먼저 `mode='tab'`으로 완성한 뒤 `mode='drawer'`로 감싸는 순서**를 권장한다 — 드로어는 탭 버전의 셸(포커스 트랩 + `Esc`)만 다르고 내부는 100% 동일 컴포넌트다.
4. **`TracePanel`의 한국어 레이블 맵**은 `apps/web/src/constants/messages.ts`에 `simulator.traceLabels: Record<TraceCode, string>`으로 두고, 설계서 §7.7의 신규 5종(`NODE_BY_ID`/`NODE_BY_ID_NOT_FOUND`/`CLARIFY_RESOLVED`/`CLARIFY_DISCARDED`/`STATE_DISCARDED`)과 기존 코드(대화설계 Phase에서 이미 존재하는 코드들, `HomonymEditModal.tsx`가 현재 `stage/code` 원시값만 표시하던 부분)를 합쳐 완성한다.
5. **채널 카드는 `CHANNEL_IMPLEMENTATION` 상수를 import하지 않는다**(DD-29) — `apps/web`이 이 상수를 참조하면 code-reviewer 단계에서 반려 사유가 된다.
6. **위젯은 별도 워크스페이스 앱**이다. `apps/web`의 컴포넌트·훅·`MESSAGES`를 import하지 않는다(런타임 의존성 0 유지, ADR-0012). 위젯 작업은 `core/`(순수, 테스트 우선) → `ui/`(DOM) 순서로 진행할 것을 권장한다(§5의 상태 전이표가 `core/store.ts` reducer 설계의 입력이 된다).
7. **미결정 사항**: `SessionStatePanel`의 모바일 아코디언 애니메이션, 위젯 데스크톱 패널의 정확한 px 크기·그림자 스타일은 컴포넌트 라이브러리/디자인 토큰 확정 후 조정 대상(레이아웃 원칙만 규정, 챗봇 운영관리 설계서와 동일한 유보 방식).
