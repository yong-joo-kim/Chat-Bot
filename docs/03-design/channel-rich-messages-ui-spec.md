# 채널별 리치 메시지 컴포넌트 (No.46) — 화면 설계서

> **요구사항**: `docs/requirements/channel-rich-messages.md`(T-1~T-6 · J-1~J-16 · FR-0-194~202 · FR-RM1-\*~FR-RM8-\* · NFR-RMP/RMS/RMR/RMA/RMM · AC-RM1~RM7 · EX-RM-1~20 · P-1~P-12 전부 추천안 확정, 2026-09-27)
> **설계**: `docs/02-spec/channel-rich-messages-설계.md`(§2 아키텍처 배치 · §4 shared-types 계약 · §7 채널 능력표·강등 알고리즘 · §9 주소 안전 · §10 저장 검증 · §11 콘솔 인계 · §12 위젯 렌더 · §15 새 타입 수정 지점 닫힌 목록) · **ADR-0043**
> **UIUX 기준**: `docs/03-design/UIUX_준수기준.md`(§1 색상 단독 금지·"예상 모습" 라벨 · §3 키보드·캐러셀 규칙 · §4 버튼 · §5·§6 폼 · §7 오류 · §8 일시 선택지·로딩 · §9 내비게이션) — 이번 패치(2026-09-27)로 캐러셀·일시 선택지·"예상 모습" 규칙이 §1·§3·§8에 이미 반영되어 있다.
> **형식 참조**: `docs/03-design/omnichannel-inbox-ui-spec.md` · `docs/03-design/workflow-automation-ui-spec.md`
> **작성일**: 2026-09-27 · **최종 정정**: 2026-09-27(오케스트레이터 §13 확정 반영 — §14 변경 이력 참조) · **범위**: `apps/web`(관리자 콘솔) 신규/확장 화면 + `apps/widget`(캐러셀·바로연결 렌더 — 계약·상태만, 코드 없음).

---

## 0. 전제와 연계 확인 (코드 확인)

- **재사용 대상 확인**(요청서 지정 컴포넌트 실제 확인 완료):
  - `apps/web/src/pages/dialogue/components/DialogOutputEditor.tsx` — `OUTPUT_TYPES`(34~49행, 13종) · `defaultPayloadFor()` switch(51~98행) · 타입별 서브폼 분기(154행~) · 내부 `ButtonListEditor`(510~554행, 미export — `ReorderableList` + `ButtonItemEditor` 재사용, 드래그 없이 위/아래 버튼만). **캐러셀 추가는 이 파일의 패턴을 그대로 따른다** — `OUTPUT_TYPES`에 `'CAROUSEL'` 추가, `defaultPayloadFor`에 `case 'CAROUSEL'` 추가(§15 #15 컴파일 강제 대상), 새 서브폼 분기 추가.
  - `apps/web/src/pages/dialogue/components/ButtonItemEditor.tsx` — 버튼 1개 서브폼(레이블·동작 셀렉트·동작별 값 입력). **카드/캐러셀 버튼 공용 재사용** — 컴포넌트 자체는 수정하지 않고, 호출부가 `valueError`(기존 prop)로 https 검사 결과를 흘려보낸다(§3.1).
  - `apps/web/src/components/ReorderableList.tsx` — 드래그 없는 위/아래 버튼 재정렬(UIUX §3 캐러셀 카드 순서 원칙과 정확히 일치) · `minItems`/`maxItems`/`removeDisabled`/`addDisabled`(버튼을 숨기지 않고 비활성 + 이유 텍스트, No.27 선례) · 이동 후 포커스가 이동한 항목의 같은 버튼에 남는다(AC-5-8 선례). **캐러셀 카드 목록에 그대로 재사용**(`minItems=2, maxItems=10`).
  - `apps/web/src/components/OutputRenderer.tsx` — 아웃풋 → 화면 렌더러. `toOutputViews()`가 정한 순서·타입만 그리며 **위젯과 "무엇을 어떤 순서로 보여줄지" 변환 로직을 공유**한다(주석 5~6행). **시뮬레이터(`ChatBubble.tsx` 70행)와 채널별 미리보기가 이 컴포넌트 하나를 공유** — `CAROUSEL` case 1개, 바로연결 칩 렌더 분기 1개를 이 파일에 추가하면 두 화면에 동시 반영된다(중복 구현 금지).
  - `apps/web/src/pages/dialogue/badges.tsx` — `OUTPUT_ICONS: Record<DialogOutputType, string>`(86~101행, 신규 타입 추가 시 컴파일 오류로 누락 방지하는 기존 패턴) · `UnsupportedOutputBadge()`(정보 배지 = 아이콘+텍스트). **`CAROUSEL` 아이콘을 이 Record에 추가**(예: `⛶` 또는 카드 여러 장을 암시하는 문자) — 새 배지 컴포넌트는 만들지 않고 이 패턴을 그대로 따른다.
  - `apps/web/src/pages/chatbot-detail/simulator/OverlayBadge.tsx` — "미저장 변경 적용됨" 정보 배지(색+아이콘+텍스트, `SeverityBadge` 계열과 같은 병기 원칙). **통합 인박스 시뮬레이션의 "이 채널에서는 이렇게 보입니다" 격하 미리보기 배지**(§3.7)와 **콘솔 채널별 미리보기의 "예상 모습" 배지**(§3.3)는 이 컴포넌트를 그대로 쓰지 않고(문구가 다르다) **같은 스타일 원칙(색+아이콘+텍스트, `.overlay-badge`류 클래스)을 공유하는 새 배지 2종**(`AssumedPreviewBadge`·`DegradePreviewNotice`)을 만든다 — 재사용 여부는 §2.2에서 표로 정리.
  - `apps/web/src/pages/chatbot-detail/simulator/ChatBubble.tsx`(65~90행) · `SimulatorPanel.tsx`/`SimulatorDrawer.tsx`(No.10 응답 테스트 시뮬레이터) — `OutputRenderer`를 그대로 쓰고 있어 §0의 `OutputRenderer` 확장만으로 FR-RM5-4(시뮬레이터가 캐러셀·바로연결을 원형으로 렌더)를 만족한다. **신규 컴포넌트 0개**(§3.6).
  - `apps/web/src/components/inbox/SimulationChatPanel.tsx`(No.42, 23~98행) — `inboxApi.simulate()` 응답의 `res.outputs`만 `ChatBubble`에 넘기고 `res.degradePreview`는 **지금 화면에서 쓰지 않는다**(T-1이 남긴 자리). 이 그룹은 이 컴포넌트에 `degradePreview` 표시를 **추가**한다(§3.7) — 파일은 수정하되 기존 렌더링 흐름(`outputs`가 곧 봇 말풍선 원형이라는 규약, R-16)은 바꾸지 않는다.
  - `apps/web/src/pages/chatbot-detail/SettingsTab.tsx` — `section` 쿼리스트링으로 서브탭 전환(`basic`/`retention`/`inbox`, 65~81행 — No.42가 3번째 서브탭을 추가한 선례). **이 그룹은 4번째 서브탭 `richUrlPolicy`를 같은 패턴으로 추가**한다(§3.5). 서브탭 진입 게이트는 `chatbot:read`(조회는 전 역할 허용 — No.42 `inbox` 서브탭과 같은 이유: EDITOR도 허용 목록 유무를 알아야 인라인 경고를 이해할 수 있다).
  - `apps/web/src/pages/chatbot-detail/inbox-settings/ChatbotInboxSettingsSection.tsx` — 조회(`GET`)+저장(`PUT`) 폼의 표준 골격(로딩 스켈레톤 → `ErrorState` → 폼 → 권한별 읽기 전용 전환 → 저장 버튼 스피너 → 토스트). **허용 도메인 목록 화면(§3.5)이 이 골격을 그대로 따른다.**
  - `apps/web/src/pages/dialogue/components/FlowPreviewPanel.tsx` — 흐름 트리 노드 배지 확장 선례(`hasWorkflowOutput` → 아이콘 배지, 81~88행). **캐러셀 카드 버튼의 NODE 연결은 기존 카드 버튼과 동일하게 자식 노드로 이미 그려진다**(엔진 `getOutgoingNodeRefs()`가 캐러셀을 포함하도록 확장되므로 `FlowTree` 응답 자체가 이미 포함 — 이 화면의 코드 변경 0, §3.8).
  - `apps/web/src/pages/chatbot-detail/versions/diff/DiffItemDrawer.tsx` — 구조체(STRUCT) 필드는 JSON 전/후 텍스트로 보여주는 범용 폴백이 이미 있다(58~78행). **캐러셀 아웃풋의 필드 차이는 이 STRUCT 폴백으로 최소 동작**하지만, FR-RM5-6("캐러셀(카드 N장)" 요약)을 만족하려면 목록 화면(L2, 항목 라벨)에 요약 문구 1줄을 추가해야 한다(§3.8) — JSON 원문 표시(D2)는 그대로 둔다.
  - `apps/web/src/pages/dialogue/components/DesignValidationPanel.tsx` — `DesignIssue.resourceType === 'NODE'`는 이미 `/chatbots/:chatbotId/dialogue/nodes/:resourceId`로 링크한다(46~48행). **`RICH_URL_NOT_ALLOWED`·`RICH_URL_SUSPICIOUS`는 새 case 없이 기존 `NODE` 분기로 자동 처리**된다(§3.5 "목록 밖 주소를 쓰는 노드" 링크의 근거).
  - `apps/widget/src/ui/renderers/{index,card,button}.ts` — `renderOutputView()` switch(index.ts 21~38행) · `renderCard()`(이미지 지연 로딩·오류 시 `<img>` 제거·카드 버튼 `allowStackedLayout:false`) · `renderButtonGroup()`/`renderButtonBlock()`(모두 `<button>`, `role="group"`, 44px). **캐러셀·바로연결 렌더러는 이 3개 파일의 패턴(순수 DOM 생성 함수 + `textContent`만)을 그대로 따르는 신규 파일 2개**(`renderers/carousel.ts`·`renderers/quick-reply.ts`)로 만든다(§3.9·§3.10).
  - `apps/widget/src/ui/message-list.ts` — 봇 말풍선 구조 `el(cb-msg) > b(cb-bubble, 아웃풋들) [+ feedbackBar(el의 형제)]`(135~148행). **바로연결 칩 묶음은 `b`의 형제로, `feedbackBar`보다 앞에** 같은 삽입 동작(`root.appendChild(el)` 전)에서 만들어져야 한다(§3.10 — "말풍선 아래 · 평가 막대 앞", 설계서 제약 ⑩).
  - `apps/widget/src/ui/feedback-bar.ts` — "새 DOM 노드를 추가하지 않고 기존 요소의 속성/텍스트만 바꾼다"는 규약의 선례(18~21행 주석). **바로연결 칩의 "사용 후 숨김"이 같은 원칙**(`hidden` 속성만 토글, §3.10).
  - `apps/widget/src/ui/panel.ts`(55~58행) — `#cb-status`(`role="status"`) 이미 존재. **캐러셀 위치 안내는 이 요소를 재사용**(새 live 영역 0, §3.9).
  - `apps/widget/src/api/public-client.ts`(76~84행) · `constants/{handoff,feedback}.ts` — `features` 배열에 상수를 더하는 기존 패턴(`WIDGET_FEATURE_HANDOFF_V1`·`WIDGET_FEATURE_FEEDBACK_V1`). **`WIDGET_FEATURE_RICH_V1`도 `constants/rich.ts` 신설 + 같은 자리에 추가**(§3.9).
  - `apps/web/src/constants/messages.ts` — `dialogue`(643행, `outputTypes`/`outputFields`) · `simulator`(260행) · `inboxSettings`/`inboxTags`(No.42 선례, 4324·4361행) 네임스페이스 구조. **이 그룹은 `dialogue.outputTypes.CAROUSEL`·`dialogue.outputFields`(캐러셀 필드) 확장 + 신규 `richMessages`/`richUrlPolicy` 네임스페이스**를 같은 패턴으로 추가한다(§7).
  - `apps/web/src/App.tsx` 라우트 확인: `nodes/:nodeId`·`nodes/new` → `NodeFormPage`(146~148행). 새 라우트 0(§1) — 모두 기존 화면 확장.

---

## 1. 화면 목록 및 라우트

| # | 화면 | 라우트 | 권한 | 유형 |
|---|---|---|---|---|
| RM-1 | 노드 편집기 — 캐러셀 아웃풋 편집 | `/chatbots/:chatbotId/dialogue/nodes/:nodeId`(`/new`) | 조회 `dialogue:read` · 편집 `dialogue:write` | 기존 화면 확장 |
| RM-2 | 노드 편집기 — 버튼 "표시 방식"(바로연결) | 위와 동일 | 동일 | 기존 화면 확장 |
| RM-3 | 노드 편집기 — 채널별 미리보기 패널 | 위와 동일(신규 섹션) | 조회 권한과 동일(읽기만) | 신규 |
| RM-4 | 노드 편집기 — 저장 시 경고(비차단) | 위와 동일 | 동일 | 신규 |
| RM-5 | 챗봇 설정 — 이미지·링크 허용 도메인 | `/chatbots/:chatbotId/settings?section=richUrlPolicy`(기존 `SettingsTab` 서브탭) | 조회 `chatbot:read` · 저장 `chatbot:write` | 기존 화면 확장(신규 서브탭) |
| RM-6 | 응답 테스트 시뮬레이터 — 캐러셀·바로연결 렌더 | `SimulatorDrawer`(No.10, `NodeFormPage`·`NodesListPage` 안) | 기존 시뮬레이터 권한 그대로 | 기존 화면 확장 |
| RM-7 | 통합 인박스 — 시뮬레이션 채널 격하 미리보기 | `/inbox/:threadId`(No.42 `SimulationChatPanel`) | 기존 `simulation:write ∧ cs:read` | 기존 화면 확장 |
| RM-8 | 노드 목록·버전 차이·흐름 트리 — 캐러셀 표시 확장 | `/chatbots/:chatbotId/dialogue/nodes`·`.../versions/:id/diff`·흐름 미리보기(기존) | 기존 | 기존 화면 확장(1~2줄) |
| RM-9 | 위젯 — 캐러셀 렌더 | 위젯(관리자 콘솔 아님) | — | 신규(계약·상태만, §3.9) |
| RM-10 | 위젯 — 바로연결 칩 렌더 | 위젯 | — | 신규(계약·상태만, §3.10) |

**새 라우트는 0개다.** RM-1~RM-4는 모두 기존 `NodeFormPage` 한 화면 안의 확장이며, RM-5는 기존 `SettingsTab`의 4번째 서브탭이다.

---

## 2. 공통 UI 요소

### 2.1 재사용(변경 없음)

`InlineFieldError` · `ReorderableList`(카드 순서·버튼 순서) · `ButtonItemEditor`(카드/캐러셀 버튼 공용) · `SkeletonRow`/`SkeletonCard` · `ErrorState`/`EmptyState` · `SeverityBadge`(`ERROR`/`WARNING`/`INFO`) · `OutputRenderer`(웹 콘솔의 채널별 미리보기·시뮬레이터 공용 — 아래에서 확장) · `DesignValidationPanel`(새 이슈 코드 2종을 기존 `NODE` 링크 분기로 자동 처리) · `FlowPreviewPanel`(캐러셀 카드 버튼 NODE 연결이 자동 반영) · `ChatBubble`/`SimulatorDrawer`(No.10) · `SimulationChatPanel`/`ChatBubble`(No.42, `outputs` 표시 로직 불변) · `Modal`/`ConfirmDialog`(이 그룹은 파괴적 확인 모달이 없어 실사용 0) · `CopyButton`(URL 복사, 허용 도메인 표에서 재사용 가능하나 필수는 아님).

### 2.2 신규 배지·표시 요소(색+아이콘+텍스트 병기 — UIUX §1)

| 요소 | 위치 | 값·라벨 | 비고 |
|---|---|---|---|
| `AssumedPreviewBadge` | RM-3 채널별 미리보기 탭 안(카카오톡·텍스트만 채널) · RM-7 인박스 시뮬레이션(`source !== 'MEASURED'`) | "예상 모습(실제 규격 확인 전 추정)" — 노랑 계열 배경 + `ⓘ` 아이콘 + 텍스트 | UIUX §1 "추정 미리보기 표기" 규칙을 그대로 구현하는 **공용 배지**(RM-3·RM-7이 하나를 공유 — `components/AssumedPreviewBadge.tsx`) |
| `DegradeChangesNotice` | RM-3 미리보기 하단 · RM-4 저장 경고 · RM-7 인박스 시뮬레이션 | "바뀐 점" 문장 목록(예: "카드 버튼 5개 중 3개만 보입니다", "이미지가 빠집니다") | `DEGRADE_CHANGE_KINDS` 11종 → 문장 매핑 테이블(§7.1) · 목록 0건이면 렌더하지 않음(노이즈 방지) |
| 캐러셀 아이콘(`OUTPUT_ICONS.CAROUSEL`) | 노드 목록·흐름 트리·아웃풋 편집기 종류 셀렉트 | `⛶`(가칭 — 카드 여러 장 암시) | `badges.tsx` `Record<DialogOutputType,…>` 확장(컴파일 강제) |
| "바로연결" 표시 배지 | 노드 목록 아웃풋 요약(`OutputTypeIconList`) | 기존 `BUTTON` 아이콘(▦) 그대로 + 개수만 표시 — **별도 아이콘 추가 없음**(바로연결은 새 타입이 아니라 `BUTTON`의 선택 표시 방식이므로 목록 요약에서 시각적으로 구분하지 않는다, `display` 필드는 노드 상세에서만 드러난다) | 판단 기록 D-1(§12) |

### 2.3 신규 컴포넌트

| 컴포넌트 | 위치(제안) | 역할 |
|---|---|---|
| `CarouselOutputEditor` | `apps/web/src/pages/dialogue/components/CarouselOutputEditor.tsx` | 캐러셀 페이로드 편집 — 안내 문구 입력 + `ReorderableList`로 카드 2~10장 관리(추가/삭제/순서 이동/복제) |
| `CarouselCardFields` | 같은 파일 안(비export 서브함수) | 카드 1장의 제목·설명·이미지 URL·대체 텍스트·버튼(≤3, `ButtonItemEditor` 재사용) |
| `QuickReplyDisplayToggle` | `DialogOutputEditor.tsx` 안(BUTTON 서브폼에 라디오 2개 추가) | "표시 방식: 일반 버튼 / 바로연결" — 바로연결 선택 시 각 버튼의 LINK 동작을 비활성 + 이유 표시 |
| `ChannelPreviewSection` | `apps/web/src/pages/dialogue/components/ChannelPreviewSection.tsx` | RM-3 — `role="tablist"` 4탭 + `OutputRenderer`(강등 결과) + `AssumedPreviewBadge` + `DegradeChangesNotice` |
| `AssumedPreviewBadge` | `apps/web/src/components/AssumedPreviewBadge.tsx` | §2.2 |
| `DegradeChangesNotice` | `apps/web/src/components/DegradeChangesNotice.tsx` | §2.2 — `changes: DegradeChange[]` → 문장 목록 |
| `RichUrlPolicySection` | `apps/web/src/pages/chatbot-detail/settings/RichUrlPolicySection.tsx` | RM-5 — 허용 도메인 표 + 추가 폼 + 저장 |
| `RichUrlHostRow` | 같은 파일 안 | 표 1행(호스트·하위 도메인 포함 체크박스·삭제) |
| `DegradePreviewNotice` | `apps/web/src/components/inbox/DegradePreviewNotice.tsx` | RM-7 — `degradePreview` 객체 → "예상 모습" 배지(조건부) + 바뀐 점 요약 + "실제 이 채널 모습 보기" 토글(펼치면 `OutputRenderer`로 `degradePreview.outputs` 렌더) |
| `renderers/carousel.ts` | `apps/widget/src/ui/renderers/carousel.ts` | 위젯 캐러셀 DOM(§3.9) |
| `renderers/quick-reply.ts` | `apps/widget/src/ui/renderers/quick-reply.ts` | 위젯 바로연결 칩 DOM(§3.10) |
| `core/carousel.ts` | `apps/widget/src/core/carousel.ts` | 순수 함수 — 가장 가까운 카드 판정·위치 텍스트 계산 |
| `core/quick-reply.ts` | `apps/widget/src/core/quick-reply.ts` | 순수 함수 — 마지막 바로연결 선택(`splitQuickReply`) |
| `constants/rich.ts` | `apps/widget/src/constants/rich.ts` | `WIDGET_FEATURE_RICH_V1` 복제 + 위젯 전용 문구(§7.2) |

---

## 3. 화면별 설계

## 3.1 RM-1 — 노드 편집기: 캐러셀 아웃풋 편집

### 목적
EDITOR/ADMIN이 "캐러셀(카드 여러 장 넘겨 보기)"을 새 아웃풋 종류로 골라 카드 2~10장을 만들고, 카드마다 제목·설명·이미지·버튼(≤3)을 편집한다(S-1, FR-RM1-\*).

### 진입 경로
`DialogOutputEditor`의 "아웃풋 종류" 셀렉트(`OUTPUT_TYPES`)에서 **"캐러셀(카드 여러 장 넘겨 보기)"**을 선택 — 기존 12종 선택 흐름과 동일(타입 변경 시 새 서브폼 첫 필드로 포커스 이동, 기존 `useEffect` 로직 그대로 재사용).

### 상태별 UI

| 상태 | UI |
|---|---|
| 최초 선택(신규) | 기본 페이로드 `{ version: 1, cards: [{ title: '' }, { title: '' }] }` — **카드 2장으로 시작**(하한을 만족한 상태로 시작해 "카드가 부족합니다" 오류를 처음부터 겪지 않게) |
| 카드 2장(하한) | 각 카드의 "삭제" 버튼이 `disabled` + `aria-label`에 이유 포함("2장 미만으로 줄일 수 없습니다") — `ReorderableList`의 `removeDisabled` 기존 prop 그대로 사용 |
| 카드 10장(상한) | "+ 카드 추가" 버튼이 `disabled` + 옆에 "최대 10장까지 추가할 수 있습니다"(`ReorderableList`의 `addLimitLabel`) |
| 이미지 URL 입력 중 — https 위반 | 필드 아래 인라인 오류(제출 없이 즉시, `onBlur` 또는 `onChange` 디바운스): "https 주소만 쓸 수 있습니다." |
| 이미지 URL — `@` 포함 | 인라인 오류: "주소에 '@'가 포함된 형식은 쓸 수 없습니다(다른 사이트로 보내는 속임수에 쓰입니다)." |
| 이미지 URL — 퓨니코드·IP·단축 URL | 인라인 **경고**(오류 아님, 저장 가능): "국제화 도메인(퓨니코드)입니다 — 실제 주소를 확인해 주세요." 등 |
| 허용 도메인 목록 밖 호스트(챗봇에 목록이 있을 때) | 인라인 경고: "허용 도메인 목록에 없는 주소입니다 — 저장 시 거부될 수 있습니다."(최종 판정은 서버, §3.1 하단 참고) |
| 이미지 있음 + 대체 텍스트 없음 | 기존 CARD와 동일한 인라인 오류: "이미지에는 대체 텍스트가 필요합니다." |
| 카드 버튼 3개(카드별 상한) | "+ 버튼 추가" 비활성 + "카드당 버튼은 최대 3개입니다" |
| 서버 저장 거부(400, 카드 1장/11장·버튼 4개 등) | `errorFieldPrefix` 기반 필드 오류(`outputs.i.payload.cards.j.title` 등)를 `CarouselOutputEditor`가 각 카드 위치에 매핑해 인라인 표시(기존 `fieldErrors` 배관 그대로) |

### 3.1.1 레이아웃

```
아웃풋 종류: [캐러셀(카드 여러 장 넘겨 보기) ▾]

안내 문구(선택)
[ 이번 달 추천 요금제예요                              ]  18/300자

┌ 1번째 카드(스타터 요금제) ─────────────────── [▲][▼][⧉ 복제][⌫ 삭제] ┐
│ 제목 *        [ 스타터 요금제                              ]         │
│ 설명          [ 월 3만원 · 데이터 5GB                       ]         │
│ 이미지 URL    [ https://img.example.com/starter.png        ]         │
│ 대체 텍스트 * [ 스타터 요금제 카드 이미지                    ]         │
│ 버튼 목록(0~3)                                                       │
│  1번째 버튼(자세히 보기)                          [▲][▼][⌫]          │
│   레이블 [ 자세히 보기 ]  동작 [ 링크 열기 ▾ ]  URL [ https://… ]     │
│  [+ 버튼 추가]                                                       │
└──────────────────────────────────────────────────────────────────┘
┌ 2번째 카드(스탠다드 요금제) ─────────────────── [▲][▼][⧉ 복제][⌫ 삭제] ┐
│ …                                                                    │
└──────────────────────────────────────────────────────────────────┘
[+ 카드 추가](2/10장)
```

### 컴포넌트 분해 및 데이터 바인딩

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `CarouselOutputEditor` | `value: CarouselOutputPayloadV1`, `onChange`, `chatbotId`, `errorFieldPrefix`, `fieldErrors`, `allowedHosts?: RichUrlHostRule[]`(§3.1 하단 — 인라인 경고용, `chatbotId`로 1회 조회해 부모(`NodeFormPage`)가 내려줌) |
| `ReorderableList<CarouselCard>` | `items = payload.cards`, `getKey = index 기반 안정 key`, `minItems=2, maxItems=10`, `onAdd/onRemove/move`는 기존 컴포넌트 그대로, `itemLabel = (c, i) => \`${i+1}번째 카드(${c.title || '제목 없음'})\`` |
| "복제" 버튼 | `ReorderableList`에는 복제 슬롯이 없어 `CarouselOutputEditor`가 `renderItem` 안에서 카드 필드 옆에 독립 `<button>`으로 추가(§12 판단 기록 D-2) — 클릭 시 같은 인덱스 뒤에 카드 사본 삽입(상한 10장이면 비활성) |
| `CarouselCardFields` | `value: CarouselCard`, `onChange`, `chatbotId`, `idPrefix`, `errPrefix`(`outputs.i.payload.cards.j`), `fieldErrors` — 제목·설명·이미지·대체텍스트는 기존 `DialogOutputEditor`의 CARD 서브폼과 동일한 마크업 재사용(복붙 대신 공용 헬퍼로 추출 권장, frontend-implementer 재량) |
| 카드 버튼 목록 | `ButtonListEditor`를 **일반화**(현재 `DialogOutputEditor.tsx`에 비export로 있음 → export하고 `maxItems`를 인자로 받는 그대로 재사용, `maxItems=3`) + `ButtonItemEditor`에 넘기는 `valueError`를 `CarouselCardFields`가 `action==='LINK'`일 때 `inspectRichUrl(value.value)` 결과로 계산해 주입(컴포넌트 자체 수정 없음) |

### 인라인 검증 상세(FR-RM6-\*)

- **https 전용·위험 형식 차단**: `@chat-bot/shared-types`가 export하는 `inspectRichUrl()`(zod 무의존)을 웹 번들이 직접 import해 매 입력마다 판정한다(서버 호출 없음 — 성능 예산 §17 "탭 전환 ≤16ms"와 같은 원칙). 오류(`NOT_HTTPS`·`USERINFO`·`INVALID_CHARS`·`TOO_LONG`·`INVALID`)는 `RICH_URL_ERROR_MESSAGES`(shared-types 상수)를 그대로 표시해 서버 오류 문구와 **1:1로 일치**시킨다.
- **경고(저장 허용)**: `PUNYCODE`·`IP_HOST`·`SHORTENER`는 노란 인라인 경고(오류와 다른 스타일 — 배경색+아이콘 다름, 텍스트로도 "경고"임을 알 수 있게).
- **허용 도메인 목록 사전 확인**: `NodeFormPage`가 챗봇 진입 시 `GET /chatbots/:chatbotId/rich-url-policy`를 1회 호출해 `hosts`를 보관하고, `CarouselOutputEditor`/버튼 URL 입력이 이 목록에 없으면 **경고**(차단 아님 — 최종 결정은 저장 시 서버 `400`)로 안내한다. 목록이 비어 있으면(모든 https 허용) 이 검사는 건너뛴다.
- 기존 `CARD`·`IMAGE`·`LINK`·`BUTTON`의 URL 필드는 **이 검사를 적용하지 않는다**(FR-RM6-1, 하위 호환 — `http` 계속 허용).

### 참조 삭제 보호

카드 버튼의 NODE 대상은 기존 카드 버튼과 동일하게 노드 삭제 사전검사(`409`)·설계 점검·자산 이전·토픽 분할 대상이다(설계서 §5.1 EN-5·§14). 화면 동작은 **기존 CARD 버튼 NODE 참조와 동일**하므로 이 화면에서 별도 UI를 추가하지 않는다.

---

## 3.2 RM-2 — 버튼 아웃풋: 표시 방식(바로연결)

### 목적
EDITOR/ADMIN이 기존 `BUTTON` 아웃풋에 "일반 버튼" 대신 "바로연결(답 아래 빠른 선택 칩)"을 고를 수 있게 한다(S-2, FR-RM2-\*).

### 레이아웃(기존 BUTTON 서브폼 확장분)

```
아웃풋 종류: [버튼 ▾]

문구(선택) [ 어떤 문의를 도와드릴까요?                      ]

표시 방식
( ) 일반 버튼(말풍선 안 버튼)
(•) 바로연결(답 아래 빠른 선택 칩) — 다음 입력을 하면 사라집니다

버튼 목록(1~5)
 1번째 버튼(반품 문의)                              [▲][▼][⌫]
  레이블 [ 반품 문의 ]  동작 [ 메시지 전송 ▾ ]  값 [ 반품하고 싶어요 ]
  ⚠ 20자를 넘으면 칩이 길어질 수 있습니다(현재 4자)
 2번째 버튼(교환 문의)
  레이블 [ 교환 문의 ]  동작 [ 링크 열기 ▾(비활성) ]
  ⓘ 바로연결은 대화 안 선택지만 가능합니다. 링크는 카드나 링크 아웃풋을 쓰세요.
 [+ 버튼 추가]
```

### 상태별 UI

| 상태 | UI |
|---|---|
| "바로연결" 선택 | 각 버튼 행의 동작 셀렉트에서 **"링크 열기"만 비활성**(`<option disabled>` + 옆에 이유 텍스트, MESSAGE·NODE는 그대로 선택 가능) — 이미 LINK로 저장돼 있던 버튼을 바로연결로 전환하면 그 버튼의 동작을 자동으로 바꾸지 않고 인라인 **오류**로 표시("이 버튼은 링크입니다 — 바로연결에서는 쓸 수 없습니다") |
| 라벨 20자 초과(바로연결일 때만) | 인라인 **경고**(저장은 허용): "20자를 넘으면 칩이 길어질 수 있습니다(현재 24자)" — 기존 라벨 상한(40자)은 그대로, 이 경고는 바로연결 표시일 때만 뜬다 |
| 노드의 다른 아웃풋이 이 버튼 뒤에 옴(표시용 타입) | 폼 하단 배너(오류): "바로연결은 응답 맨 끝에 한 번만 둘 수 있습니다." — `findQuickReplyPlacementIssues(outputs)`(shared-types export)를 `NodeFormPage`가 outputs 변경마다 클라이언트에서 호출해 실시간 표시(§4 참고). `DIALOG_MOVE`·`WORKFLOW`(비표시)는 예외로 허용 |
| 한 노드에 바로연결 2개 이상 | 같은 배너, 2번째부터 "이미 다른 아웃풋에 바로연결이 있습니다" |
| 서버 저장 거부(400 `OUTPUT_PAYLOAD_INVALID`) | 클라이언트 사전 검사를 우회한 경합 상황(예: 다른 창에서 노드를 바꾼 뒤)에 대비한 폴백 — 폼 상단 배너로 서버 메시지 그대로 표시 |

### 컴포넌트 분해

| 컴포넌트 | props |
|---|---|
| `QuickReplyDisplayToggle` | `value: 'NORMAL' \| 'QUICK_REPLY'`(payload.display 유무로 파생), `onChange` — 라디오 2개, `role` 불필요(네이티브 `<input type="radio">` 그룹 + `<fieldset><legend>`) |
| `ButtonItemEditor`(기존, 무수정) | 바로연결일 때 `DialogOutputEditor`가 `disabledActions={['LINK']}` 유사 정보를 **새 prop**으로 넘긴다(§12 판단 기록 D-3 — 기존 컴포넌트에 최소 확장 1개 prop 추가: `disabledAction?: { action: ButtonItem['action']; reason: string }`) |
| 라벨 길이 경고 | `DialogOutputEditor`가 `display==='QUICK_REPLY'`일 때만 각 버튼 아래 `field-hint field-hint--warning` 렌더(20자 기준, 서버 거부 아님) |

---

## 3.3 RM-3 — 노드 편집기: 채널별 미리보기 패널

### 목적
운영자가 저장 전에 "이 응답이 웹·구버전 위젯·카카오톡(예상)·텍스트만 채널에서 각각 어떻게 보이는지"를 확인한다(S-4, FR-RM5-2).

### 진입 경로
`NodeFormPage`의 아웃풋 목록 아래, 저장 버튼 위에 **상시 노출 섹션**("채널별 미리보기") — 별도 열기 동작 없이 노드를 편집하는 동안 항상 보이고, outputs가 바뀔 때마다 즉시(서버 호출 없이) 다시 계산된다. 최소 1개의 표시 아웃풋(`toOutputViews` 대상)이 있을 때만 렌더하고, 없으면 "표시할 응답이 없습니다"만 간단히 보인다(FlowPreviewPanel의 `EmptyState` 패턴과 통일된 어조, 별도 배너는 만들지 않음). **[확정(2026-09-27, D-5)]** 편집 화면 전체가 길어지지 않도록 미리보기 영역은 **최대 높이 320px + 내부 세로 스크롤**(`overflow-y:auto`)로 제한한다(카드 개수·강등 텍스트 길이와 무관하게 화면 전체 스크롤 길이는 늘지 않는다).

### 상태별 UI

| 상태 | UI |
|---|---|
| 탭 전환 | `role="tablist"` 4탭 — 즉시 전환(서버 호출 없음, 성능 예산 ≤16ms) |
| `웹` 탭(MEASURED) | `OutputRenderer`로 **강등 없이** 원형 렌더(WEB의 모든 상한이 스키마 최대치이므로 원형 = 강등 결과와 항상 같다) · "예상 모습" 배지 없음 |
| `구버전 웹 위젯` 탭(MEASURED, 가상 프로필) | `degradeForProfile(outputs, LEGACY_WEB_WIDGET_OUTPUT_PROFILE)` 결과 렌더 · 캐러셀이 있으면 카드 여러 장(세로)으로, 바로연결이 있으면 일반 버튼으로 보임 · "예상 모습" 배지 없음(구버전 위젯의 동작은 실측·확정된 사실이다) |
| `카카오톡(예상)` 탭(ASSUMED) | `degradeForProfile(outputs, CHANNEL_CAPABILITIES.KAKAOTALK.outputs)` 결과 렌더 + **`AssumedPreviewBadge`**("예상 모습(실제 규격 확인 전 추정)") |
| `텍스트만 채널(예상 — 라인·페이스북 등)` 탭(DEFAULT) | 텍스트 강등 결과(§7.3 형식) + `AssumedPreviewBadge` |
| 강등으로 바뀐 점이 있는 탭 | 미리보기 아래 `DegradeChangesNotice`(문장 목록, 예: "카드 버튼 5개 중 3개만 보입니다" · "이미지가 빠집니다(대체 텍스트로 표시)") |
| 바뀐 점이 없는 탭(예: 순수 텍스트 노드) | `DegradeChangesNotice` 렌더 안 함(노이즈 방지) |
| 미리보기 내용이 320px보다 긴 탭(카드 10장 등) | 미리보기 영역 안에서만 세로 스크롤(내부 `overflow-y:auto`) — 탭·"바뀐 점" 목록·저장 버튼 위치는 그대로 고정 |

### 3.3.1 레이아웃

```
채널별 미리보기
[ 웹 ] [ 구버전 웹 위젯 ] [ 카카오톡(예상) ] [ 텍스트만 채널(예상) ]
                              ─────────────
ⓘ 예상 모습(실제 카카오 규격을 확인하기 전의 추정)

┌ 미리보기(최대 높이 320px · 내부 스크롤) ─────────────────┐
│ ◀  [카드1: 스타터 요금제] [카드2: 스탠다드 요금제] …   ▶  │
│                  2개 중 1번째                              │
└──────────────────────────────────────────────────────┘

바뀐 점
· 카드 버튼 5개 중 3개만 보입니다.
· 이미지가 빠집니다(대체 텍스트로 표시).
```

### 컴포넌트 분해 및 데이터 바인딩

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `ChannelPreviewSection` | `outputs: DialogOutput[]`(현재 폼 state, 저장 전 값 그대로) → 내부에서 `toOutputViews`로 표시 아웃풋만 추출 후 4개 프로필 각각에 `degradeForProfile` 적용(순수 계산, `useMemo`) |
| 탭 버튼 | `role="tab"` + `aria-selected` + `aria-controls`(SettingsTab 서브탭과 동일한 마크업 패턴, App 전역에서 반복되는 확립된 패턴) |
| `OutputRenderer` | `outputs = 선택된 탭의 강등 결과 outputs`, `onButtonClick`은 미리보기이므로 **무동작**(클릭해도 아무 일도 일어나지 않음 — 읽기 전용 미리보기임을 버튼에 `aria-disabled` 대신 클릭 핸들러를 빈 함수로 둔다. 버튼 자체의 포커스·읽기는 그대로 허용) |
| `AssumedPreviewBadge` | `visible: boolean`(`source !== 'MEASURED'`) |
| `DegradeChangesNotice` | `changes: DegradeChange[]` → §7.1 매핑 테이블로 문장화 |
| 미리보기 컨테이너 | `max-height: 320px; overflow-y: auto;`(CSS) — 탭·배지·"바뀐 점" 목록은 이 컨테이너 밖(고정 영역)에 둔다 |

### DIALOG_MOVE로 이어지는 노드 안내

설계서 §11-3 지침대로, `toOutputViews` 대상에 포함되지 않는(비표시) 아웃풋이 있는 노드(예: `DIALOG_MOVE`로 끝나는 노드)는 미리보기 섹션 상단에 안내 1줄: "이 노드의 응답 뒤에는 다른 노드로 이동하는 아웃풋이 있어 미리보기에 포함되지 않습니다."

---

## 3.4 RM-4 — 저장 시 경고(비차단)

### 목적
저장 자체는 막지 않되, 강등으로 정보가 달라지는 채널이 있으면 저장 직후 알린다(FR-RM5-3).

### 흐름

```
[저장] 클릭 → 기존 유효성 검사(§3.1·§3.2 인라인 규칙 포함) 통과 → PUT/POST 저장 성공
  → 토스트 "저장되었습니다"(기존)
  → (조건부) 두 번째 안내:
     활성 채널(현재 배포된 WEB) 자체에 바뀐 점이 있으면 → SeverityBadge "WARNING" 톤 배너
     구버전 웹 위젯 강등만 있으면 → "INFO" 톤 배너(설계서 §11.4 우선 — 2026-09-27 오케스트레이터 정정)
       "웹(구버전 위젯)에서는 카드 3개로 보입니다."
     설정만 된 채널(카카오톡 등 CONFIG_ONLY)에만 바뀐 점이 있으면 → "INFO" 톤 배너
       "카카오톡(예상)에서는 버튼이 텍스트로 보입니다 — 아직 연동되지 않은 채널입니다."
  → aria-live="polite" 영역에서 1회만 안내(기존 저장 토스트 영역 재사용 — 새 live 영역 추가 없음)
```

- **차단하지 않는다** — 경고가 있어도 저장은 이미 완료된 뒤다(저장 실패와 시각적으로 명확히 구분: 성공 토스트는 초록, 경고 배너는 노랑/파랑이며 둘 다 동시에 보일 수 있다).
- 경고 계산은 §3.3과 동일한 순수 함수 재사용(서버 API 호출 없음, R-9). "활성 채널" 판정은 해당 챗봇의 채널 목록(`GET /chatbots/:chatbotId/channels`, 기존 API)에서 `WEB`의 활성 여부를 읽어온다.
- 배너는 저장 성공 직후 1회만 보이고 페이지를 떠나거나 다시 편집을 시작하면 사라진다(모달 아님, 별도 닫기 버튼 있는 인라인 배너).

---

## 3.5 RM-5 — 챗봇 설정: 이미지·링크 허용 도메인

### 목적
챗봇별로 캐러셀·바로연결의 이미지·링크에 허용할 도메인 목록을 관리한다(선택 사항 — 기본은 제한 없음, FR-RM6-4).

### 진입 경로
`SettingsTab.tsx`의 서브탭에 **"이미지·링크 허용 도메인"** 추가(4번째, `section=richUrlPolicy`) — `basic`/`retention`/`inbox`와 같은 쿼리스트링 패턴. 서브탭 자체는 `chatbot:read`만 있으면 보인다(No.42 `inbox` 서브탭과 같은 이유). **[확정(2026-09-27, D-6) — 서브탭 이름은 "이미지·링크 허용 도메인"이다. 최초 초안의 "리치 메시지 주소"는 §12 D-6·§13에서 이 이름으로 대체됐다.]**

### 상태별 UI

| 상태 | UI |
|---|---|
| 로딩 | `SkeletonRow`×3 |
| 조회 성공(목록 있음) | §3.5.1 레이아웃 |
| 조회 성공(빈 목록 = 제한 없음) | 표 대신 안내: "등록된 허용 도메인이 없습니다 — 모든 https 주소를 쓸 수 있습니다." + 추가 폼은 그대로 보임 |
| 저장 중 | 저장 버튼 스피너 |
| 저장 성공 | 토스트 "저장되었습니다" |
| 중복 호스트 추가 시도 | 입력 필드 인라인 오류: "이미 목록에 있는 호스트입니다." |
| 형식 오류(호스트에 스킴·경로·포트 포함) | 인라인 오류: "호스트 이름만 입력해 주세요(예: img.example.com)." |
| 50개 초과 시도 | "+ 호스트 추가" 비활성 + "최대 50개까지 등록할 수 있습니다." |
| `404 CHATBOT_ARCHIVED`류(저장 시도) | 인라인 "보관된 챗봇은 설정을 바꿀 수 없습니다." |
| `chatbot:write` 없음(EDITOR 등) | 입력·추가·삭제·저장 요소를 렌더하지 않고 표만 읽기 전용으로 표시(`ChatbotInboxSettingsSection`의 `canWriteIdentity` 분기 패턴) |
| 거버넌스 모드 ON + 목록 비어 있음 | 경고 배지(색+텍스트): "외부 이미지·링크 주소에 제한이 없습니다." |

### 3.5.1 레이아웃

```
┌ 챗봇 설정 ─ [기본 정보] [보존기간] [통합 인박스] [이미지·링크 허용 도메인] ─┐
│ ⓘ 캐러셀·바로연결의 이미지·링크 주소에만 적용됩니다.                  │
│   비워두면 모든 https 주소를 허용합니다. 저장 즉시 적용되며,           │
│   이후 저장하는 노드부터 검사합니다(기존 노드는 그대로 동작).          │
│                                                                     │
│ ⚠ 외부 이미지·링크 주소에 제한이 없습니다(거버넌스 모드 켜짐)  ← 조건부│
│                                                                     │
│ 허용 도메인(2/50)                                                   │
│ 호스트                     하위 도메인 포함                          │
│ img.intra.example            ☑                        [삭제]       │
│ cdn.example.com               ☐                        [삭제]       │
│                                                                     │
│ 호스트 추가                                                         │
│ [ img.example.com                    ] ☐ 하위 도메인 포함  [추가]    │
│                                                                     │
│ 목록 밖 주소를 쓰는 초안 노드: 3개  [노드 목록에서 확인 →]           │
│                                              [저장]                 │
└─────────────────────────────────────────────────────────────────┘
```

### 컴포넌트 분해

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `RichUrlPolicySection` | `GET /chatbots/:chatbotId/rich-url-policy` → `{ hosts, updatedAt, outsideNodeCount, governanceModeOn }`(shared-types `RichUrlPolicyResponseSchema`) |
| `RichUrlHostRow`(표 1행) | `host`, `includeSubdomains`, `onRemove` — 로컬 state만 변경(즉시 API 호출 안 함), "저장" 버튼이 전체 배열을 `PUT`으로 한 번에 교체(부분 병합 금지 규약, 설계서 §9.3) |
| 추가 폼 | 입력값을 `RichUrlHostSchema` 정규식으로 즉시 검증(shared-types export) → 통과 시 로컬 목록에 추가(중복 검사 포함) |
| "노드 목록에서 확인" 링크 | `/chatbots/:chatbotId/dialogue/nodes`로 이동(기존 `DesignValidationPanel`이 `RICH_URL_NOT_ALLOWED` 이슈를 이미 `NODE` 링크로 보여준다 — §0) |
| "저장" | `PUT /chatbots/:chatbotId/rich-url-policy { hosts }` — `chatbot:write`일 때만 렌더 |

---

## 3.6 RM-6 — 응답 테스트 시뮬레이터(No.10) 확장

### 목적
운영자가 대화 시험 중 캐러셀·바로연결을 **웹 위젯과 같은 모습**으로 확인한다(FR-RM5-4).

### 변경 내용

`ChatBubble.tsx`가 그대로 사용하는 `OutputRenderer`에 `CAROUSEL` case와 바로연결 칩 렌더 분기를 추가하면 **이 화면의 다른 코드는 변경되지 않는다**(§0 확인). 시뮬레이터는 **강등 없이 원형**을 보여준다(신버전 웹 기준 — RM-3의 "웹" 탭과 동일한 계산 결과).

### 상태별 UI(변경분만)

| 상태 | UI |
|---|---|
| 봇 응답에 캐러셀 포함 | 말풍선 안에 캐러셀(가로 스크롤 + 이전/다음 버튼) — 위젯과 동일한 시각 구조, 카드 버튼 클릭은 기존 `onButtonClick`(NODE 이동·MESSAGE 발화)으로 그대로 위임 |
| 봇 응답에 바로연결 포함 | 말풍선 아래 칩 묶음 — 칩 클릭 시 `handleButtonClick`(기존)으로 처리, 클릭 또는 사용자가 직접 메시지를 입력해 다음 턴을 보내면 칩 묶음이 사라짐(위젯과 동일한 사용자 경험을 재현해 운영자가 실제 동작을 미리 검증할 수 있게 함 — §12 판단 기록 D-4). 칩을 다시 보려면 아래 "대화 다시 시작"을 쓴다(사라진 칩이 스스로 복원되지는 않음) |
| 대화 다시 시작(No.10 기존 "대화 초기화" 기능) | 칩·캐러셀 스크롤 위치 등 로컬 state 전체 초기화(기존 재시작 흐름 그대로) — **[확정(2026-09-27, D-4)]** 반복 시험이 필요하면 이 "대화 초기화"로 같은 노드를 처음부터 다시 실행해 바로연결 칩을 다시 받는다 |

### 컴포넌트 분해

변경 파일은 `apps/web/src/components/OutputRenderer.tsx` 1개뿐(§0) — `ChatBubble.tsx`·`SimulatorPanel.tsx`·`SimulatorDrawer.tsx`는 **무수정**.

---

## 3.7 RM-7 — 통합 인박스(No.42): 시뮬레이션 채널 격하 미리보기

### 목적
상담원이 가상 채널(예: 카카오톡)로 시험 대화를 나눌 때 "이 채널에서는 이렇게 보입니다"를 실제 값으로 확인한다(T-1 이행, FR-RM5-5).

### 변경 내용

`SimulationChatPanel.tsx`(No.42, §0 확인)가 지금은 버리고 있는 `res.degradePreview`를 봇 말풍선 옆에 표시한다. **봇 말풍선 자체(`res.outputs` 기준 원형 렌더)는 바꾸지 않는다** — 대화 기록의 원형 요약 규약(R-16)을 유지하기 위해서다.

### 상태별 UI

| 상태 | UI |
|---|---|
| `degradePreview === 'NOT_DEFINED'`(이론상 발생하지 않음 — 하위 호환용 리터럴) | 아무것도 추가 표시하지 않음(기존 동작) |
| `degradePreview` 객체, `changes.length === 0`(가상 채널 WEB 등 — 바뀐 점 없음) | 아무것도 추가 표시하지 않음(노이즈 방지) |
| `degradePreview` 객체, `changes.length > 0` | 말풍선 아래 `DegradePreviewNotice` — 요약 1줄 + (`source !== 'MEASURED'`면) `AssumedPreviewBadge` |
| 요약 펼치기("실제 이 채널 모습 보기") | `OutputRenderer`로 `degradePreview.outputs`(강등된 결과)를 접힘 영역에 렌더 |

### 3.7.1 레이아웃(§3.7 확장분만 — 전체 레이아웃은 `omnichannel-inbox-ui-spec.md` §3.7 참고)

```
┌ 시뮬레이션 — 카카오톡(가상) ────────────────────┐
│ [시뮬레이션] 봇: 요금제를 카드로 보여드릴게요       │
│   (원형: 캐러셀 3장, 웹 신버전 기준)                │
│ ⓘ 예상 모습 · 바뀐 점: 카드 버튼 5개 중 3개만 보입니다│
│   [실제 이 채널 모습 보기 ▾]                        │
│   ┌ (펼침) ─────────────────────────────────────┐ │
│   │ 1) 스타터 요금제 — 월 3만원              │ │
│   │    자세히 보기: https://…                  │ │
│   │ 2) 스탠다드 요금제 — 월 5만원             │ │
│   │    외 1개 더 있습니다.                     │ │
│   └────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
```

### 컴포넌트 분해

| 컴포넌트 | props |
|---|---|
| `DegradePreviewNotice` | `preview: DegradePreview`(shared-types) — 내부에서 `changes`를 §7.1 문장 매핑으로 변환, `outputs`는 접었다 펼 때만 `OutputRenderer`에 전달(항상 렌더하지 않아 목록이 길어지는 부담을 줄임) |
| `SimulationChatPanel`(수정) | `res.degradePreview`를 해당 봇 메시지(`SimMessage`)에 함께 저장해 `ChatBubble` 다음 형제로 `DegradePreviewNotice`를 렌더 |

---

## 3.8 RM-8 — 노드 목록·버전 차이·흐름 트리: 캐러셀 표시 확장

| 화면 | 변경 | 근거 |
|---|---|---|
| 노드 목록(`NodesListPage`, `OutputTypeIconList`) | `OUTPUT_ICONS`에 `CAROUSEL` 아이콘 추가 — 개수 요약(`⛶×1`)이 자동으로 함께 표시된다(기존 로직 무수정, badges.tsx 86~117행) | §2.2 |
| 버전 차이 보기(`DiffItemDrawer`, No.25) | STRUCT 필드 렌더는 그대로(JSON 전/후) — 항목 목록(L2, 이 드로어를 여는 상위 화면)의 항목 라벨을 캐러셀일 때 "캐러셀(카드 N장)"으로 요약(예: 기존 CARD가 "제목" 필드값을 라벨로 쓰던 자리에 카드 수를 대신 넣는다) | FR-RM5-6 |
| 흐름 트리(`FlowPreviewPanel`) | 코드 변경 0 — `FlowTree` API 응답이 캐러셀 카드 버튼의 NODE 연결을 이미 포함하도록 엔진이 확장되므로(EN-5) 화면은 기존 카드 버튼과 동일하게 자동으로 그린다 | §0 |
| 설계 점검(`DesignValidationPanel`) | 코드 변경 0 — `RICH_URL_NOT_ALLOWED`(WARNING)·`RICH_URL_SUSPICIOUS`(INFO)가 기존 `NODE` 링크 분기로 자동 처리 | §0 |

---

## 3.9 RM-9 — 위젯: 캐러셀 렌더 (계약·상태)

### 목적
`rich-v1`을 선언한 신버전 위젯이 `CAROUSEL` 아웃풋을 가로로 넘겨 보는 카드 묶음으로 렌더한다(S-3, FR-RM8-2·3).

### 진입 조건
공개 응답의 아웃풋 중 `type: 'CAROUSEL'`이 있을 때. `rich-v1` 미선언 요청은 서버가 이미 `CARD` 여러 개로 강등해 보내므로 위젯은 **캐러셀 자체를 받지 않는다**(구버전 위젯 코드는 무수정 — RM-9는 신버전 렌더러 신설만).

### 상태(모두 위젯 봇 말풍선 안)

| 상태 | UI |
|---|---|
| 정상(카드 2~10장) | 가로 스크롤 트랙, 모든 카드 DOM 존재, 카드 폭 ≈80%(다음 카드 살짝 보임), 이전/다음 `<button>`, 위치 "K / N" 텍스트 |
| 첫 카드에서 "이전" | `aria-disabled="true"` + 시각 흐림(포커스는 유지, 클릭 무시) |
| 마지막 카드에서 "다음" | 동일 |
| 이전/다음 버튼 클릭 | 해당 카드로 스크롤(감속 애니메이션, `prefers-reduced-motion`이면 즉시 이동) + 포커스는 버튼에 유지 + `#cb-status`에 "N개 중 K번째 카드: 제목" **1회** 안내 |
| 손가락 스와이프·Tab 이동으로 카드 변경 | 위치 표시 숫자만 갱신, `#cb-status` 낭독 없음(소음 방지) |
| 카드 이미지 로드 실패 | 대체 텍스트로 교체(카드 상자 높이는 유지 — 레이아웃 흔들림 방지) |
| 카드 이미지 URL이 https가 아님(서버 우회 주입 방어) | `<img>` 자체를 만들지 않음 |
| 320px 좁은 화면 | 카드 폭 비율 유지, 이전/다음 버튼 44px 확보, 제목 2줄 말줄임(`aria-label`에는 전체 제목) |
| 다국어 제목(아랍어 등) | `dir="auto"` |

### 3.9.1 구조(ASCII)

```
[cb-carousel role=group aria-roledescription="캐러셀" aria-label="카드 2개"]
  <p>안내 문구</p>                      (있을 때만)
  [트랙: 가로 스크롤, scroll-snap-type:x mandatory]
    [카드1 role=group aria-roledescription="카드" aria-label="2개 중 1번째: 스타터 요금제"]
    [카드2 role=group aria-roledescription="카드" aria-label="2개 중 2번째: 스탠다드 요금제"]
  [탐색줄]
    <button aria-label="이전 카드">◀</button>
    <span aria-hidden="true">1 / 2</span>
    <button aria-label="다음 카드">▶</button>
```

### 데이터 바인딩

- `WIDGET_FEATURE_RICH_V1 = 'rich-v1'`을 `public-client.ts`의 `features` 배열에 추가(`['handoff-v1', 'feedback-v1', 'rich-v1']`, 3/5).
- 렌더 입력은 서버가 이미 강등을 마친 `outputs`(위젯은 `rich-degrade` 모듈을 import하지 않는다 — R-8, 번들 절약).
- 순수 판단(`core/carousel.ts` `nearestCardIndex(scrollLeft, cardOffsets)`)과 DOM(`ui/renderers/carousel.ts`)을 분리(기존 `core/`·`ui/` 관례).

### 번들·성능 가이드(frontend-implementer용)

- 자동 넘김 금지(`setInterval`/`setTimeout` 사용 0) · 애니메이션 라이브러리 0(CSS `scroll-snap`만) · 이미지 지연 로딩은 브라우저 기본(`loading="lazy"`, `IntersectionObserver` 직접 구현 금지).
- gzip 증가 이 컴포넌트 몫 **≤4KB**(캐러셀+바로연결 합산 상한 6KB 중 배분, NFR-RMP3) — 빌드 후 `scripts/check-bundle-size.mjs` 로그에 증가분을 남긴다.

---

## 3.10 RM-10 — 위젯: 바로연결 칩 렌더 (계약·상태)

### 목적
`display: 'QUICK_REPLY'`가 있는 `BUTTON` 아웃풋을 봇 말풍선 아래 칩 묶음으로 렌더하고, 다음 입력 시 사라지게 한다(S-2, FR-RM8-4).

### 상태

| 상태 | UI |
|---|---|
| 봇 응답에 바로연결 있음 | 말풍선 **아래**, 줄바꿈 배치 칩 묶음(`role="group"` `aria-label="바로 선택"`), 칩 = `<button>` 44px 이상 |
| 한 턴에 바로연결이 여러 개(예: `DIALOG_MOVE` 경유) | **마지막 1개만** 칩으로 표시, 앞의 것은 말풍선 안 일반 버튼으로 표시(`core/quick-reply.ts` `splitQuickReply`) |
| 칩 클릭 | 기존 버튼 클릭 처리(MESSAGE·NODE만, 서버가 배치 검증 — LINK는 오지 않는다)와 동일하게 위임 → 처리 즉시 칩 묶음 `hidden`(같은 요소, 새 DOM 노드 0) |
| 칩을 누르지 않고 입력창에 직접 입력해 전송 | 전송 시점에 마찬가지로 칩 묶음 `hidden` |
| 칩에 포커스가 있던 상태에서 숨김 처리 | 포커스를 입력창으로 이동(포커스 유실 방지, NFR-RMA4) |
| 새로고침 | 칩 없음(메시지 이력 비복원 — K-7, 새 세션과 동일한 화면) |
| 상담원 개입 중 칩 클릭 | 기존 상담 게이트 규약대로 처리(칩은 동일하게 숨김) |

### 3.10.1 구조(ASCII)

```
[.cb-msg.cb-msg-bot]
  [.cb-bubble]  ← 봇 답변 텍스트/카드/캐러셀
  [.cb-quick-replies role=group aria-label="바로 선택" hidden?]
    <button>반품 문의</button>
    <button>교환 문의</button>
    <button>처음으로</button>
  [.cb-feedback-bar]  ← (No.44, 있을 때만) 항상 이 순서로 뒤에 위치
```

- 삽입 시점: `message-list.ts`의 `addBotOutputs`에서 `el.appendChild(b)` 직후, `feedbackBar` 삽입 **이전**에 칩 묶음을 `el`의 자식으로 추가한다(같은 삽입 동작 안에서 완성 — `aria-relevant="additions"` 재낭독 방지 원칙 준수).
- 숨김 처리: `hidden` 속성만 토글(요소 재생성 없음) — `feedback-bar.ts`의 "새 노드 추가 없이 속성만 바꾼다" 원칙을 그대로 따른다.

### 데이터 바인딩

- 렌더 입력도 서버 강등 결과(구버전 위젯 프로필에서는 `display`가 이미 제거된 채 도착하므로 위젯은 `display` 유무만 보고 분기하면 된다 — 강등 로직 자체를 알 필요 없음).

---

## 4. 사용자 인터랙션 흐름 종합

### 4.1 캐러셀 작성 → 미리보기 → 저장 → 경고(S-1)

```
NodeFormPage 진입 → 아웃풋 추가 → 종류 "캐러셀" 선택
→ 카드 2장 기본 생성 → 카드 필드 채움(이미지 URL 입력 시 즉시 https 검사)
→ 채널별 미리보기에서 "카카오톡(예상)" 탭 확인 → "바뀐 점: 카드 버튼 5개 중 3개만 보입니다" 확인
→ [저장] → 성공 토스트 → (활성 채널 WEB에는 바뀐 점 없음 → 경고 배너 없음, 카카오는 CONFIG_ONLY라 정보성이면 표시하지 않을 수도 있음 — §3.4 판단 기준 그대로)
```

### 4.2 바로연결 배치 오류 → 실시간 수정(S-2)

```
"배송 조회" 노드 마지막에 TEXT 아웃풋 추가 → 그 앞의 BUTTON(바로연결)이 "맨 끝"이 아니게 됨
→ NodeFormPage가 outputs 변경마다 findQuickReplyPlacementIssues() 재계산
→ 폼 하단 배너: "바로연결은 응답 맨 끝에 한 번만 둘 수 있습니다."
→ 운영자가 TEXT를 바로연결 앞으로 이동(ReorderableList 위 버튼) → 배너 사라짐
→ [저장] 정상 진행
```

### 4.3 피싱 형식 링크 차단(S-7)

```
카드 LINK 버튼 URL에 https://bank.example.com@phish.example.net/login 붙여넣기
→ onBlur 즉시 인라인 오류: "주소에 '@'가 포함된 형식은 쓸 수 없습니다(다른 사이트로 보내는 속임수에 쓰입니다)."
→ 저장 버튼은 활성 상태지만 제출 시 같은 필드에 재검증(클라이언트 우회 방지 목적이 아니라 방어 심층) → 서버도 400으로 거부
→ 운영자가 주소 수정 → 오류 사라짐 → 저장 성공
```

### 4.4 위젯: 캐러셀 넘김 + 바로연결 사용(S-3, 최종 사용자 관점)

```
봇: [캐러셀 ◀ 카드1 | 카드2 | 카드3 ▶ "1 / 3"]
    [바로연결: (요금 비교) (상담 연결) (처음으로)]
사용자가 Tab으로 "다음 카드" 이동 → Enter → 스크롤 이동 + #cb-status "3개 중 2번째 카드: 스탠다드 요금제"
사용자가 "상담 연결" 칩 클릭 → 서버에 MESSAGE 턴 전송 → 칩 묶음 hidden(새 DOM 노드 0)
```

### 4.5 구버전 위젯(S-6)

```
고객사가 몇 달 전 스크립트를 그대로 쓰는 사이트 → features에 rich-v1 없음
→ 서버가 CAROUSEL을 CARD 3개(세로)로 강등해 응답 → 위젯은 평소처럼 CARD 3개를 렌더
→ 바로연결은 display 키가 제거된 채 도착 → 위젯은 평소 BUTTON처럼 말풍선 안 버튼으로 렌더
→ 빈 말풍선 없음(NFR-RMR1)
```

### 4.6 오류 처리 요약표

| 오류/상황 | 화면 | 처리 |
|---|---|---|
| `400 VALIDATION_FAILED`(카드 1장/11장, 카드 버튼 4개, https 위반, `@` 형식) | RM-1 | 인라인 필드 오류(§3.1) — 서버 `details[].field` 경로를 카드 인덱스에 매핑 |
| `400 OUTPUT_PAYLOAD_INVALID`(바로연결 배치 위반) | RM-2 | 폼 하단 배너(§3.2, 클라이언트 사전 검사로 대부분 선제 차단) |
| `409 INVALID_REFERENCE`(카드 버튼 NODE 참조 오류) | RM-1 | 기존 카드 버튼과 동일한 필드 경로 인라인 오류 |
| `400 VALIDATION_FAILED`(허용 도메인 목록 밖) | RM-1(저장 시), RM-5(저장 시) | RM-1은 인라인 경고 후 서버 거부 시 필드 오류로 승격 표시 · RM-5는 호스트 추가 폼 인라인 오류 |
| `400`(허용 도메인 형식·중복·상한) | RM-5 | 인라인 오류(§3.5) |
| `404 CHATBOT_ARCHIVED`류 | RM-1, RM-5 | 기존 `ArchivedBanner`/인라인 오류 패턴 |
| `403`(권한 없음 — 허용 도메인 저장) | RM-5 | 입력·저장 요소 자체를 렌더하지 않음(정상 경로로는 도달하지 않음) |
| 이미지 404·CSP 차단(위젯) | RM-9 | 대체 텍스트로 교체, 카드 나머지 정상(EX-RM-1) |
| 위젯 세션 만료 중 칩 표시 | RM-10 | 새 세션 = 칩 없음(EX-RM-6) |

---

## 5. 권한별 화면 요소

| 역할 | RM-1·RM-2·RM-3(편집·미리보기) | RM-4(저장 경고) | RM-5(허용 도메인) | RM-6(시뮬레이터) | RM-7(인박스 시뮬레이션) |
|---|---|---|---|---|---|
| ADMIN | 조회+편집(`dialogue:write`) | 조회+저장 | 조회+편집(`chatbot:write`) | 조회+실행 | 조회+실행(`simulation:write`) |
| EDITOR | 조회+편집(대화노드 편집 권한 보유 시) | 조회+저장 | 조회만(관리는 `chatbot:write` 보유자) | 조회+실행 | `simulation:write` 있으면 조회+실행 |
| AGENT | 조회만(대화노드 편집 권한 없음이 일반적) | — | 조회만 | 조회만(시뮬레이터 열람 권한에 따름, 기존과 동일) | `simulation:write` 없으면 진입 불가(기존 No.42 규칙 그대로) |
| VIEWER | 조회만 | — | 조회만(`chatbot:read`) | 조회만 | 진입 불가(기존) |

- **신규 권한·역할 0종**(FR-0-199·J-15) — 이 표는 모두 **기존 권한의 새 적용**일 뿐이다.
- 미리보기(RM-3)는 읽기 전용 순수 계산이라 조회 권한만 있으면 누구나 볼 수 있다(저장은 여전히 `dialogue:write` 필요).

---

## 6. 상태별 화면(로딩/빈/오류) 총정리

| 화면 | 로딩 | 빈 상태 | 오류 |
|---|---|---|---|
| RM-1 캐러셀 편집 | 노드 폼 전체 로딩(기존) | 신규 아웃풋 선택 시 카드 2장으로 즉시 채워짐(빈 상태 없음) | 인라인 필드 오류(§3.1) |
| RM-3 채널별 미리보기 | 없음(순수 계산, 즉시) | "표시할 응답이 없습니다" | 없음(계산 실패 시나리오 없음 — 입력이 항상 유효한 폼 state) |
| RM-5 허용 도메인 | `SkeletonRow`×3 | "등록된 허용 도메인이 없습니다 — 모든 https 주소를 쓸 수 있습니다." | `ErrorState`(조회 실패) / 인라인(저장 실패) |
| RM-7 인박스 시뮬레이션 미리보기 | 기존 시뮬레이션 전송 로딩(스피너) 재사용 | `changes` 0건이면 알림 자체를 렌더하지 않음(빈 상태 = 무표시) | 기존 시뮬레이션 오류 배너 재사용 |

---

## 7. `messages.ts` 키 설계

### 7.1 `apps/web/src/constants/messages.ts` — `dialogue` 네임스페이스 확장

```ts
// dialogue.outputTypes 확장
CAROUSEL: '캐러셀',

// dialogue.outputFields 확장
carouselText: '안내 문구',
carouselCards: '카드 목록',
carouselCardTitle: '제목',
carouselCardDescription: '설명',
carouselCardImageUrl: '이미지 URL',
carouselCardAltText: '대체 텍스트',
carouselCardButtons: '버튼 목록(0~3)',
carouselAddCard: '+ 카드 추가',
carouselDuplicateCard: '복제',
carouselCardMinError: '카드는 최소 2장이어야 합니다.',
carouselCardMaxError: '카드는 최대 10장까지 추가할 수 있습니다.',
carouselCardButtonMaxError: '카드당 버튼은 최대 3개입니다.',
quickReplyDisplayLabel: '표시 방식',
quickReplyDisplayNormal: '일반 버튼(말풍선 안 버튼)',
quickReplyDisplayQuickReply: '바로연결(답 아래 빠른 선택 칩) — 다음 입력을 하면 사라집니다',
quickReplyLinkDisabledReason: '바로연결은 대화 안 선택지만 가능합니다. 링크는 카드나 링크 아웃풋을 쓰세요.',
quickReplyLabelLongWarning: (n: number) => `20자를 넘으면 칩이 길어질 수 있습니다(현재 ${n}자)`,
quickReplyPlacementNotLastError: '바로연결은 응답 맨 끝에 한 번만 둘 수 있습니다.',
quickReplyPlacementMultipleError: '이미 다른 아웃풋에 바로연결이 있습니다.',
richUrlNotHttpsError: 'https 주소만 쓸 수 있습니다.',
richUrlUserInfoError: "주소에 '@'가 포함된 형식은 쓸 수 없습니다(다른 사이트로 보내는 속임수에 쓰입니다).",
richUrlInvalidCharsError: '주소에 공백·제어 문자·역슬래시를 쓸 수 없습니다.',
richUrlTooLongError: '주소는 2,048자 이하여야 합니다.',
richUrlInvalidError: '주소 형식을 확인해 주세요.',
richUrlPunycodeWarning: '국제화 도메인(퓨니코드)입니다 — 실제 주소를 확인해 주세요.',
richUrlIpHostWarning: 'IP 주소 호스트입니다 — 실제 서비스 주소인지 확인해 주세요.',
richUrlShortenerWarning: '단축 URL로 보입니다 — 실제 목적지 주소인지 확인해 주세요.',
richUrlOutsideAllowlistWarning: '허용 도메인 목록에 없는 주소입니다 — 저장 시 거부될 수 있습니다.',
richUrlNoDisplayHint: '이 노드의 응답 뒤에는 다른 노드로 이동하는 아웃풋이 있어 미리보기에 포함되지 않습니다.',
```

### 7.2 신규 네임스페이스 `MESSAGES.richMessages`(채널별 미리보기·저장 경고 공용)

```ts
richMessages: {
  previewSectionTitle: '채널별 미리보기',
  previewEmpty: '표시할 응답이 없습니다.',
  tabWeb: '웹',
  tabLegacyWidget: '구버전 웹 위젯',
  tabKakao: '카카오톡(예상)',
  tabTextOnly: '텍스트만 채널(예상 — 라인·페이스북 등)',
  assumedBadge: '예상 모습(실제 규격 확인 전 추정)',
  assumedBadgeShortHelp: '예상 모습',
  changesTitle: '바뀐 점',
  // DEGRADE_CHANGE_KINDS 11종 → 문장 매핑(§7.1 상세는 컴포넌트 구현 시 detail 삽입)
  changeCarouselToCards: (count: number) => `캐러셀이 카드 ${count}장으로 나뉘어 보입니다.`, // CAROUSEL_TO_CARDS는 항상 무손실(EX-RM-12) — detail "N→N"의 N 사용(2026-09-27 정정)
  changeCarouselToText: '카드 대신 목록 텍스트로 보입니다.',
  changeCardsTruncated: (from: number, to: number) => `카드 ${from}장 중 앞 ${to}장만 보입니다.`,
  changeButtonsTruncated: (from: number, to: number) => `버튼 ${from}개 중 ${to}개만 보입니다.`,
  changeQuickReplyToButton: '바로연결 칩 대신 일반 버튼으로 보입니다.',
  changeButtonToText: '버튼 대신 텍스트로 보입니다.',
  changeOutputToText: '이 응답이 텍스트로 바뀝니다.',
  changeOutputRemoved: '이 응답이 표시되지 않습니다.',
  changeImageRemoved: '이미지가 빠집니다(대체 텍스트로 표시).',
  changeTextTruncated: '글자 수 제한으로 일부가 줄임표(…)로 표시됩니다.',
  changeActionLost: (kind: string) => `${kind} 동작은 이 채널에서 전달할 수 없습니다.`,
  saveWarningActiveChannel: (label: string) => `${label}에서는 응답 모습이 달라집니다.`,
  saveInfoConfigOnlyChannel: (label: string) => `${label}에서는 응답 모습이 달라집니다(아직 연동되지 않은 채널입니다).`,
} as const,
```

### 7.3 신규 네임스페이스 `MESSAGES.richUrlPolicy`(챗봇 설정 서브탭 — "이미지·링크 허용 도메인")

```ts
richUrlPolicy: {
  tabLabel: '이미지·링크 허용 도메인',
  intro: '캐러셀·바로연결의 이미지·링크 주소에만 적용됩니다. 비워두면 모든 https 주소를 허용합니다.',
  outsideEnvironmentNotice: '저장 즉시 적용되며, 이후 저장하는 노드부터 검사합니다(기존 노드는 그대로 동작).',
  governanceWarningBadge: '외부 이미지·링크 주소에 제한이 없습니다.',
  hostsTitle: (n: number) => `허용 도메인(${n}/50)`,
  hostColumnLabel: '호스트', includeSubdomainsColumnLabel: '하위 도메인 포함',
  removeButton: '삭제',
  addSectionTitle: '호스트 추가',
  addHostInputLabel: '호스트', addIncludeSubdomainsLabel: '하위 도메인 포함', addButton: '추가',
  duplicateHostError: '이미 목록에 있는 호스트입니다.',
  hostFormatError: '호스트 이름만 입력해 주세요(예: img.example.com).',
  limitExceededError: '최대 50개까지 등록할 수 있습니다.',
  outsideNodeCountLabel: (n: number) => `목록 밖 주소를 쓰는 초안 노드: ${n}개`,
  goToNodesLink: '노드 목록에서 확인 →',
  empty: '등록된 허용 도메인이 없습니다 — 모든 https 주소를 쓸 수 있습니다.',
  archivedSaveError: '보관된 챗봇은 설정을 바꿀 수 없습니다.',
  save: '저장', saveSuccess: '저장되었습니다.',
} as const,
```

### 7.4 `apps/widget/src/constants/messages.ts` 확장 (위젯이 사용자에게 보여주는 **모든** 새 문구)

```ts
carousel: {
  prevCard: '이전 카드',
  nextCard: '다음 카드',
  position: (k: number, n: number) => `${k} / ${n}`,
  cardLabel: (k: number, n: number, title: string) => `${n}개 중 ${k}번째: ${title}`,
  containerLabelWithText: (text: string) => text,
  containerLabelDefault: (n: number) => `카드 ${n}개`,
  statusAnnounce: (k: number, n: number, title: string) => `${n}개 중 ${k}번째 카드: ${title}`,
  roleDescriptionGroup: '캐러셀',
  roleDescriptionCard: '카드',
},
quickReplies: {
  groupLabel: '바로 선택',
},
```

`WIDGET_FEATURE_RICH_V1 = 'rich-v1'`(`constants/rich.ts`, `MESSAGES`가 아니라 별도 상수 — 기존 `handoff.ts`/`feedback.ts`와 같은 배치).

이 2개 그룹(`carousel`·`quickReplies`)이 이번 기능이 위젯 사용자에게 보여주는 **전체 신규 문구**다(카드 필드 값 자체는 관리자가 입력한 텍스트라 문구집 대상이 아님).

---

## 8. `UIUX_준수기준.md` 체크리스트 매핑

### 8.1 공통

| 항목 | 반영 |
|---|---|
| §1 색상 단독 금지 | `AssumedPreviewBadge`·`DegradeChangesNotice`·`SeverityBadge`(WARNING/INFO) 전부 아이콘+텍스트 병행 |
| §1 추정 미리보기 표기("예상 모습") | RM-3 탭 이름 자체에 "(예상)" 포함 + `AssumedPreviewBadge`(색+텍스트) · RM-7 동일 배지 재사용 · 바뀐 점 문장 목록 항상 병기 |
| §3 키보드 접근성 | RM-1 카드 순서(`ReorderableList`, 드래그 없음) · RM-9 캐러셀 Tab 순서(카드 버튼들 → 이전 → 다음) · RM-10 칩 Tab 진입 |
| §3 캐러셀 규칙(신설) | RM-9가 §3.9 표에서 ①~⑦ 전항목을 만족: 자동 넘김 금지 · 모든 카드 DOM 유지 · `aria-disabled` 끝 버튼(44px) · `role="group"`+`aria-roledescription` · 버튼 이동 시만 1회 안내 · `prefers-reduced-motion` · "K / N" 텍스트 |
| §4 버튼 | RM-1·RM-5 모든 버튼 동사형("추가"·"삭제"·"저장") · 44×44px(RM-9 이전/다음, RM-10 칩) |
| §5 텍스트 입력 | RM-1 안내 문구 글자 수 카운터(0/300) · 카드 제목·설명 레이블 필수 |
| §6 폼 컨트롤 | RM-2 표시 방식 = 라디오(단일 선택) · RM-5 하위 도메인 포함 = 체크박스 · 기본값 임의 선택 금지(신규 카드는 빈 값으로 시작) |
| §7 오류 메시지 | 전 폼 인라인(제출 시점 + 가능한 곳은 즉시) — §4.6 오류표 |
| §8 일시 선택지(신설) | RM-10이 §3.10에서 그대로 구현: 봇 말풍선 아래 라벨 있는 묶음 · 다음 입력 시 `hidden`(새 노드 0) · 포커스 이동 · 여러 개면 마지막만 |
| §8 로딩/상태 피드백 | RM-4 저장 경고 = `aria-live="polite"` 1회 · RM-7 시뮬레이션 로딩은 기존 패턴 재사용 |
| §9 내비게이션 | RM-5 서브탭은 기존 `SettingsTab` 탭 구조(키보드 접근 가능한 `role="tab"`) 그대로 |

### 8.2 화면별 세부

| 화면 | 항목 | 세부 |
|---|---|---|
| RM-1 | §5 텍스트 입력 | 대체 텍스트 필수 표시(이미지 있을 때) — 기존 CARD와 동일한 패턴 |
| RM-3 | §1 색상 단독 금지 | 탭 이름에 "(예상)" 텍스트 포함 — 색상으로만 MEASURED/ASSUMED/DEFAULT를 구분하지 않음 |
| RM-5 | §6 폼 컨트롤 | 필수/선택 일관 표시(허용 도메인은 전부 선택 항목 — 별표 없음, 안내 문구로 "선택 사항"임을 명시) |
| RM-9 | §3 캐러셀 규칙 | §3.9 표 전항목 |
| RM-10 | §8 일시 선택지 | §3.10 그대로 |
| RM-2 | §4 버튼 | 동작 셀렉트의 비활성 옵션에도 이유 텍스트 병기(색상만으로 "왜 안 되는지" 전달하지 않음) |

---

## 9. 반응형 고려사항

- **분기점**: 기존 관리자 콘솔 반응형 분기(`<640px`, No.42/No.24 선례)를 그대로 따른다 — RM-1·RM-3·RM-5는 별도 분기점을 추가하지 않는다(폼·탭 모두 세로 스택으로 자연히 줄어듦).
- **RM-1 카드 편집**: 모바일 폭에서는 카드 필드가 세로 1열로 쌓이고, 순서 이동 버튼(▲▼)·복제·삭제 버튼은 카드 헤더 줄에 아이콘+텍스트로 유지(44px 터치 영역, UIUX §4).
- **RM-3 채널별 미리보기**: 탭 4개는 좁은 화면에서 가로 스크롤 탭 바(`overflow-x:auto`)로 전환하거나 2줄 래핑 — 이 그룹은 **가로 스크롤 방식**을 권고한다(탭 개수가 4개로 고정이라 접이식보다 단순). 미리보기 내부 영역의 최대 높이 320px·내부 스크롤 규칙(§3.3)은 모바일에서도 동일하게 적용한다.
- **RM-9 위젯 캐러셀**: 320px 폭까지 카드 비율 유지(§3.9 표) — 위젯 패널 전체 폭 반응형은 기존 위젯 반응형 규칙(변경 없음)을 그대로 따른다.
- **RM-10 위젯 바로연결**: 칩은 줄바꿈 배치라 화면 폭에 따라 자연히 여러 줄로 쌓인다(고정 개수 배치 없음).
- **RM-5 설정 폼**: 항상 1열(다른 설정 폼과 동일).

---

## 10. Out of scope / 재검토 트리거

요구사항 §9·설계서 §24 표를 그대로 따른다(이 문서는 화면을 추가하지 않는다): 카카오톡 실연동 실제 화면(2차 어댑터), 카카오 전용 컴포넌트(상담원 연결·채널 추가·공유 버튼) 편집기, 목록형 카드·상품 카드 편집기, 버튼 동작 확장(전화·공유·상담 연결), 채널별 수동 대체 응답 지정 화면, 이미지 업로드·자체 호스팅 화면, 컴포넌트별 노출·클릭률 통계 화면, 캐러셀 자동 넘김(채택 안 함), 제3자 컴포넌트 설치(No.47), 카드·버튼 단위 클릭 로그 화면.

---

## 11. 다음 단계 인계(`frontend-implementer`)

1. `shared-types` 빌드 확인(`CarouselOutputPayloadV1Schema`·`RichHttpsUrlSchema`·`inspectRichUrl`·`degradeForProfile`·`CHANNEL_CAPABILITIES[*].outputs`·`WIDGET_FEATURE_RICH_V1` 등) 후 `apps/web`·`apps/widget`에서 import.
2. `apps/web` 순서 권장: ① `DialogOutputEditor.tsx`(`OUTPUT_TYPES`+`defaultPayloadFor`+`CarouselOutputEditor`+표시 방식 라디오) → ② `badges.tsx`(아이콘) → ③ `OutputRenderer.tsx`(`CAROUSEL`+바로연결 칩 — 시뮬레이터·미리보기 동시 반영) → ④ `ChannelPreviewSection.tsx`+`AssumedPreviewBadge`+`DegradeChangesNotice`(§3.3, 최대 높이 320px·내부 스크롤 CSS 포함) → ⑤ `NodeFormPage.tsx`에 §3.3·§3.4 배선 → ⑥ `RichUrlPolicySection.tsx`+`SettingsTab.tsx` 4번째 서브탭(§3.5, 탭 라벨 "이미지·링크 허용 도메인") → ⑦ `SimulationChatPanel.tsx`+`DegradePreviewNotice`(§3.7) → ⑧ `DesignValidationPanel`/`FlowPreviewPanel`/`DiffItemDrawer` 확인(코드 변경 최소, §3.8).
3. `apps/widget` 순서 권장: ① `constants/rich.ts`+`public-client.ts`의 `features` 배열 → ② `core/carousel.ts`·`core/quick-reply.ts`(순수, 단위 시험 먼저) → ③ `ui/renderers/carousel.ts`·`ui/renderers/quick-reply.ts` → ④ `ui/renderers/index.ts`(`CAROUSEL` case) → ⑤ `ui/message-list.ts`(바로연결 칩 삽입 위치) → ⑥ `styles.ts`(스크롤 스냅·칩 스타일) → ⑦ 번들 크기 확인(`scripts/check-bundle-size.mjs`, 증가분 ≤6KB 보고).
4. `messages.ts`(웹·위젯 둘 다)에 §7 키를 그대로 추가 — 카피라이팅 재작업 불필요.
5. 접근성 자동 시험은 기존 `*.a11y.spec.tsx` 패턴을 따라 위젯 캐러셀·바로연결에 최소 1개씩 작성(설계서 §18.1 "위젯(jsdom)" 항목과 연계).
6. `NodeFormPage`의 `findQuickReplyPlacementIssues` 실시간 검사와 §3.1 URL 인라인 검사는 **클라이언트 전용 편의 기능**이며 서버 400이 최종 권위임을 유지 — 클라이언트 검사가 서버 검사와 어긋나면(예: 정규식 차이) 서버 오류 문구를 그대로 보여주는 폴백 경로를 반드시 남긴다.

---

## 12. 설계서와 다르게 판단했거나 설계서에 없어 가정한 사항(ui-designer 판단 기록)

| # | 내용 | 판단 |
|---|---|---|
| D-1 | 노드 목록 아웃풋 요약(`OutputTypeIconList`)에서 "바로연결"을 별도 아이콘으로 구분할지 | 설계서에 지정 없음 — `display`는 `BUTTON`의 선택 속성일 뿐 새 타입이 아니므로 목록 요약(아이콘+개수) 단계에서는 구분하지 않는다(구분하려면 아이콘 2종을 조건부로 골라야 해 `Record<DialogOutputType,…>` 컴파일 강제 패턴이 깨진다). 노드 상세(편집기)에서는 표시 방식 라디오로 명확히 드러난다 |
| D-2 | 캐러셀 카드 "복제" 버튼의 구현 위치 | `ReorderableList`는 복제 슬롯이 없다. 공용 컴포넌트에 복제 기능을 추가하면 다른 소비자(버튼 목록 등)에 불필요한 옵션이 늘어나므로, `CarouselOutputEditor`가 `renderItem` 안에 독립 버튼으로 추가하는 방식을 택한다(공용 컴포넌트 무수정) |
| D-3 | `ButtonItemEditor`에 "특정 동작 비활성화" prop을 추가할지, 아니면 `CarouselOutputEditor`/`DialogOutputEditor`가 래퍼를 씌울지 | 기존 `ButtonItemEditor`가 이미 `labelError`/`valueError` 2개의 표시용 prop을 받는 구조라, 같은 패턴으로 `disabledAction?: { action; reason }` 1개만 추가하는 편이 새 래퍼 컴포넌트를 만드는 것보다 변경 범위가 작다고 판단(기존 파일 1곳만 확장) |
| D-4 | 응답 테스트 시뮬레이터(RM-6)에서 바로연결 칩도 위젯처럼 "사용 후 숨김" 규칙을 적용할지 | 설계서 FR-RM5-4는 "웹 위젯과 같은 모습"만 요구하고 사용 후 숨김 여부는 명시하지 않는다. 운영자가 실제 사용자 경험(칩이 사라지는 것까지)을 미리 검증할 수 있어야 시험 도구로서 의미가 있다고 보아 위젯과 동일한 숨김 동작을 적용한다. **[확정(2026-09-27) — 오케스트레이터가 이 판단을 그대로 수용했다. 다만 반복 시험을 위해 기존 "대화 초기화" 동작으로 칩이 다시 나타난다는 점을 §3.6에 명시했다(사라진 칩이 저절로 복원되지는 않는다).]** |
| D-5 | RM-3 채널별 미리보기의 화면 내 위치(상시 노출 vs 접이식 패널/모달) | 설계서 §11-3은 "노드 편집기 패널"이라고만 한다. `FlowPreviewPanel`류의 열고 닫는 패널 대신 **상시 노출 섹션**으로 설계했다 — 저장 전에 "지금 편집 중인 응답"을 계속 확인하며 다듬는 것이 이 기능의 핵심 가치이기 때문(캐러셀 카드 편집은 반복적 조정이 많은 작업). **[확정(2026-09-27) — 오케스트레이터가 상시 노출을 그대로 수용했다. 다만 편집 화면이 길어지지 않도록 §3.3에 미리보기 영역 최대 높이 320px + 내부 세로 스크롤(`overflow-y:auto`) 규칙을 추가했다.]** |
| D-6 | RM-5 서브탭 이름 | 최초 초안은 "리치 메시지 주소"였다(요구사항·설계서가 화면 제목을 지정하지 않아 ui-designer가 임의로 붙임). **[확정(2026-09-27) — 오케스트레이터가 사용자에게 더 이해하기 쉬운 이름 "이미지·링크 허용 도메인"으로 변경을 확정했다. §1 화면 목록·§3.5 제목·진입 경로·레이아웃·§7.3 `richUrlPolicy.tabLabel`을 모두 이 이름으로 갱신했다(내부 라우트 쿼리 `section=richUrlPolicy`와 messages 네임스페이스 이름 `richUrlPolicy`는 식별자라 바꾸지 않았다).]** |
| D-7 | RM-4 저장 경고의 지속 방식(토스트 vs 인라인 배너) | 성공 토스트(짧게 사라짐)와 별개로 경고는 **닫기 전까지 남는 인라인 배너**로 설계했다 — "바뀐 점"은 토스트처럼 빠르게 사라지면 놓치기 쉬운 정보라고 판단 |

---

## 13. 사용자 확인이 필요한 UX 선택 — 확정(2026-09-27)

요구사항·설계서의 P-1~P-12·R-1~R-24는 2026-09-27에 전부 추천안으로 확정되었다(§0). 이 화면 설계서가 새로 열었던 UX 결정 3건(D-4·D-5·D-6)은 **2026-09-27 오케스트레이터 결정으로 아래와 같이 확정**되었다(코드는 변경하지 않고 본 문서만 갱신):

1. **D-4 확정 — 응답 테스트 시뮬레이터의 바로연결 "사용 후 숨김"**: 위젯과 동일하게 사용 후 칩을 숨긴다. 반복 시험을 위해 기존 "대화 초기화" 동작을 쓰면 칩이 다시 나타난다는 점을 §3.6에 1줄 명시했다.
2. **D-5 확정 — 채널별 미리보기의 상시 노출**: 상시 노출을 그대로 쓴다. 편집 화면이 길어지지 않도록 미리보기 영역에 **최대 높이 320px + 내부 세로 스크롤**(`overflow-y:auto`) 규칙을 §3.3·§9에 추가했다.
3. **D-6 확정 — RM-5 서브탭 이름**: "리치 메시지 주소" 대신 **"이미지·링크 허용 도메인"**으로 확정했다. §1·§3.5·§7.3·§11의 관련 표기를 모두 갱신했다.

이 3건 외에 새로 여는 UX 결정은 없다.

---

## 14. 변경 이력

| 날짜 | 내용 |
|---|---|
| 2026-09-27 | 최초 작성(§0~§13) |
| 2026-09-27(오케스트레이터 확정) | §13 D-4·D-5·D-6 확정 반영: §3.6에 "대화 초기화" 시 바로연결 칩 복원 안내 추가, §3.3·§9에 채널별 미리보기 최대 높이 320px·내부 스크롤 규칙 추가, §1·§3.5·§7.3·§11의 RM-5 서브탭 이름을 "리치 메시지 주소" → "이미지·링크 허용 도메인"으로 변경 |
