# 옴니채널 통합 인박스 (No.42) — 화면 설계서

> **요구사항**: `docs/requirements/omnichannel-inbox.md`(FR-0-183~193 · FR-OC1~OC9 · NFR-OCP/OCS/OCR/OCA/OCM · AC-OC1~OC6 · EX-OC-1~22 · P-1~P-12 전부 추천안 확정, 2026-09-26)
> **설계**: `docs/02-spec/omnichannel-inbox-설계.md`(§4 shared-types 계약 · §6~§10 식별·연결·병합·스레드·채널 · §11~§14 권한·감사·거버넌스·API · §15 No.24 연계 · §20 ui-designer 인계) · **ADR-0042**
> **PM 추가 확정(2026-09-26)**: IDENTITY 연결 분리는 ADMIN 전용(R-11) · 로그인 시 익명 대화가 식별 고객으로 자동 병합(되돌리기 ADMIN 전용, R-8) · 고객 키 비밀 교체 금지(운영 규칙, FR-OC9-3)
> **UIUX 기준**: `docs/03-design/UIUX_준수기준.md`(특히 §1 색상 단독 금지·민감정보 열람 토글, §3 키보드, §5·§6 폼, §7 오류, §8 로딩/폴링, §9 내비게이션)
> **형식 참조**: `docs/03-design/workflow-automation-ui-spec.md` · `docs/03-design/data-governance-ui-spec.md`
> **작성일**: 2026-09-26 · **최종 정정**: 2026-09-26(§14 변경 이력 참조) · **범위**: `apps/web`(관리자 콘솔) 신규/확장 화면 + `apps/widget` 식별 토큰 전달(§3.13, 콘솔 화면 아님 — 코드 없이 계약만).

---

## 0. 전제와 연계 확인 (코드 확인)

- **재사용 대상 확인**(요청서 지정 컴포넌트 실제 확인 완료):
  - 상담 콘솔(No.24) 목록 패턴: `apps/web/src/components/handoff/LiveSessionTable.tsx` — 데스크톱 `<table>` + `<640px` 카드 리스트 이중 렌더, `role="status" aria-live="polite"` 1줄 신규 항목 안내, `SessionSummaryBar`(칩형 요약), `PollingStaleBanner`(연속 실패 30초 이상). **통합 인박스 목록·요약 칩·폴링 정지 배너는 이 세 컴포넌트의 구조를 그대로 재사용**한다(신규 `InboxThreadTable`/`InboxSummaryBar`는 같은 패턴의 새 컴포넌트 — 데이터 모양이 달라 컴포넌트 자체는 공유하지 않는다).
  - `components/handoff/TranscriptPanel.tsx` — 대화 로그를 `role="log" aria-live="polite"`로 감싸고, 2초 폴링 + 세션 전환 시 원문 관련 state를 동기적으로 리셋하는 패턴. **고객 스레드 타임라인은 이 패널의 폴링·리셋 골격을 재사용**하되 원문 토글은 없다(C-6 — 타임라인은 마스킹본만).
  - `components/handoff/badges.tsx`(`AlertLevelBadge`·`HandoffStateBadge`·`RawViewBadge`·`EndReasonBadge`) — 색+아이콘+텍스트 배지 패턴을 그대로 따른다. 새 배지(`InboxThreadStatusBadge`·`CustomerKindBadge`·`ChannelFamilyBadge`·`SimulationBadge`)는 이 파일과 나란히 `components/inbox/badges.tsx`에 신설.
  - `components/DataGovernanceBadges.tsx`의 `GovernedTextValue`/`PurgedFieldNotice`/`DecryptFailedNotice` — **그대로 재사용**한다(파기된 메모·기록 본문, 상담 구간 텍스트 표시에 동일 규칙 적용, FR-OC5-3).
  - `components/GovernanceViewAuditBanner.tsx` — **그대로 재사용**한다(신규 3개 화면이 `VIEW` 대상에 추가되므로 §3.2·§3.3에서 삽입 위치를 지정).
  - `components/security/SystemSettingsMenu.tsx` — 이 그룹은 이 메뉴에 **항목을 추가하지 않는다**(태그 관리(ADMIN)는 인박스 화면 안에서 진입하는 것이 P-3 "전역 통합 인박스" 취지에 맞다 — §12 D-1).
  - `pages/chatbot-detail/simulator/`(`ChatBubble.tsx`·`MessageComposer.tsx`·`ChatMessageList.tsx`) — 시뮬레이션 채널의 대화 입력·말풍선 렌더는 이 3개 컴포넌트를 **그대로 재사용**한다(§3.7). `OverlayBadge.tsx`(격하 미리보기 배지)도 FR-OC7-3의 "이 채널에서는 이렇게 보입니다" 미리보기에 재사용.
  - `constants/messages.ts` — 기존 `MESSAGES.handoffConsole`·`MESSAGES.dataGovernance`·`MESSAGES.channels` 네임스페이스 구조를 그대로 따라 `MESSAGES.inbox`(+ `inboxSettings`·`inboxTags`) 네임스페이스를 신설한다(§7).
  - `App.tsx` 라우트 확인: `/handoff-console`·`/settings/data-governance`·`/settings/workflow-automation`는 각각 독립 서브라우트 트리이고, `ChatbotDetailLayout`의 `settings` 탭은 `?section=` 쿼리스트링으로 서브탭을 나눈다(`SettingsTab.tsx` 65~76행 — `basic`/`retention`). **이 그룹은 `section=inbox`를 추가**해 같은 패턴을 따른다(§3.11).
  - `components/TopBar.tsx` — "모니터링"(`/handoff-console`, `cs:read` 게이트)이 전역 최상단 내비게이션 링크임을 확인. **통합 인박스도 같은 위치·같은 권한 게이트**로 추가한다(설계서 §20-1이 "전역 메뉴"라고만 하고 정확한 배치를 지정하지 않아 ui-designer가 TopBar를 선택 — §12 D-2).
  - `pages/chatbot-detail/ChannelsTab.tsx`/`channels/ChannelCard.tsx`/`channels/PlaceholderChannelForm.tsx` — `CONFIG_ONLY` 채널 안내는 `PlaceholderChannelForm.tsx`의 `msg.configOnlyNotice`(`SeverityBadge severity="INFO"`) 문구 **한 줄만 확장**하면 된다(FR-OC1-5, 새 컴포넌트 불필요).
  - `pages/handoff-console/LiveSessionDetailPage.tsx`·`HandoffHistoryDetailPage.tsx`·`components/handoff/TranscriptPanel.tsx` — 세션 헤더(`<h2>` 아래) 위치에 고객 카드 요약 배지를 삽입할 자리를 확인(§3.9).
  - `pages/settings/data-governance/DataGovernanceMapPage.tsx`·`DataGovernanceRetentionPage.tsx`(§3.1·§3.2, 참조 문서) — "통합 인박스" 카드 행과 보존 라벨 2종을 추가한다(§3.12).
- 위젯(`apps/widget`)은 **관리자 콘솔 화면이 아니다** — §3.13은 임베드 계약(속성·JS 호출)만 명시하고 실제 구현은 frontend-implementer/deployment-engineer 인계(연동 가이드) 사항이다.

---

## 1. 화면 목록 및 라우트

| # | 화면 | 라우트 | 권한 | 유형 |
|---|---|---|---|---|
| OI-1 | 통합 인박스 — 목록 | `/inbox` | `cs:read` | 신규 |
| OI-2 | 고객 스레드 상세 | `/inbox/:threadId` | `cs:read`(처리 `cs:write`) | 신규 |
| OI-3 | 수동 기록 작성(패널) | OI-2 안 | `cs:write` | 신규 |
| OI-4 | 메모 작성(패널) | OI-2 안 | `cs:write` | 신규 |
| OI-5 | 고객 검색·연결 모달 | OI-1/OI-2/No.24 콘솔 안 | 조회 `cs:read` · 연결 `cs:write` | 신규 |
| OI-6 | 병합/되돌리기 확인 모달 | OI-2 안 | `cs:write`(되돌리기 재검증 §5) | 신규 |
| OI-7 | 시뮬레이션 패널 + 시험 고객 만들기 | OI-1(생성) / OI-2(대화, `customer.kind==='TEST'`일 때) | `simulation:write` AND `cs:read` | 신규 |
| OI-8 | 전역 태그 관리 | `/inbox/tags` | 조회 `cs:read` · 변경 ADMIN(`cs:write`+역할) | 신규 |
| OI-9 | 챗봇 설정 — 통합 인박스 | `/chatbots/:chatbotId/settings?section=inbox`(기존 `SettingsTab` 서브탭) | 조회 `chatbot:read` · 참여 저장 `chatbot:write` · 식별 참조 `security:write` | 기존 화면 확장 |
| OI-10 | 상담 콘솔(No.24) 고객 카드 연계 | `/handoff-console/:chatbotId/live/:sessionRef` · `/history/:handoffId`(기존) | 기존 권한 그대로 | 기존 화면 확장 |
| OI-11 | 채널 설정(No.11) 안내 문구 | `/chatbots/:chatbotId/channels`(기존) | 기존 권한 | 기존 화면 확장(문구 1줄) |
| OI-12 | 데이터 지도·보존 정책(No.45) 라벨 확장 | `/settings/data-governance/map`·`/retention`(기존) | 기존 권한 | 기존 화면 확장 |
| OI-13 | TopBar 진입점 | 전역 | `cs:read` | 기존 화면 확장 |

OI-1·OI-2·OI-8은 `InboxEnabledGuard`가 `OMNI_INBOX_ENABLED=false`일 때 `GET /inbox/threads/summary`를 **404**로 반환하므로, TopBar 진입점 자체가 이 응답을 보고 스스로 숨는다(§3.13 — EX-OC-18, "메뉴 숨김"). **셋 다 라우트 게이트는 동일하게 `cs:read` 하나**다(OI-8도 예외가 아니다 — 태그 "관리"만 ADMIN 서비스 재검증이고, 태그 "목록 조회"는 다른 두 화면과 같은 문이다, §5).

---

## 2. 공통 UI 요소

### 2.1 재사용(변경 없음)

`SkeletonRow`/`SkeletonCard` · `ErrorState`/`EmptyState` · `Pagination` · `InlineFieldError` · `ConfirmDialog`/`Modal`(포커스 트랩·Esc·기본 포커스 "취소") · `GovernedTextValue`/`PurgedFieldNotice`/`DecryptFailedNotice`(`components/DataGovernanceBadges.tsx`) · `GovernanceViewAuditBanner` · `CopyButton`/`TruncatedHash`(고객 키 해시 표시가 필요하지 않으므로 이 그룹은 미사용 — 회원 번호는 애초에 응답에 없음, FR-0-187) · `SeverityBadge` · `AsyncJobProgress`(이 그룹에는 비동기 백그라운드 잡이 없어 미사용) · `pages/chatbot-detail/simulator/{ChatBubble, MessageComposer, ChatMessageList, OverlayBadge}`.

### 2.2 신규 배지 (`components/inbox/badges.tsx`, 색+아이콘+텍스트 병기 — UIUX §1)

| 배지 | 값 | 아이콘 | 색(bg/fg) | 라벨 |
|---|---|---|---|---|
| `InboxThreadStatusBadge` | `OPEN` | `●` | `#DCFCE7`/`#166534` | "열림" |
| 〃 | `PENDING`(유효) | `◐` | `#FEF3C7`/`#92400E` | "보류(해제 예정 M-D HH:mm)" 또는 해제 시각 경과 시 "보류(곧 열림)" |
| 〃 | `CLOSED` | `○` | `#F3F4F6`/`#374151` | "종료" |
| `CustomerKindBadge` | `IDENTIFIED` | `✔` | `#DBEAFE`/`#1D4ED8` | "식별 회원" |
| 〃 | `ANONYMOUS` | `?` | `#F3F4F6`/`#374151` | "익명" |
| 〃 | `TEST` | `🧪`(aria-hidden, 텍스트 병기) | `#EDE9FE`/`#5B21B6` | "시험 고객" |
| `ChannelFamilyBadge` | `DEPLOY` | — | `#F3F4F6`/`#374151` | 채널 라벨 그대로(예: "웹") |
| 〃 | `RECORD` | `☎`/`✉`/`📍`/`•`(기록 채널별) | `#F3F4F6`/`#374151` | "전화 기록"·"이메일 기록"·"방문 기록"·"기타 기록" |
| 〃 | `SIMULATED` | `🧪` | `#EDE9FE`/`#5B21B6` | "시뮬레이션 · {채널 라벨}(가상)" |
| `IdentitySecretStatusBadge` | `NOT_SET`/`MISSING`/`WEAK`/`CONFIGURED` | `—`/`⚠`/`⚠`/`✔` | 중립/경고/경고/성공 톤 | "미지정"/"없음(서버 설정 필요)"/"약함(서버 설정 확인 필요)"/"설정됨" |

이 표는 `Record<Enum, …>`로 구현해 신규 열거값 추가 시 컴파일이 깨지게 한다(No.45 `AuditActionBadge` 선례, §2.2 컴파일 강제 원칙).

### 2.3 신규 컴포넌트

| 컴포넌트 | 위치(제안) | 역할 |
|---|---|---|
| `InboxSummaryChips` | `components/inbox/InboxSummaryChips.tsx` | 열림·보류·내 담당·담당 없음·진행 중 상담 5개 칩 — 클릭 시 목록 필터 반영(버튼 + 개수, `LiveSessionTable`의 `SessionSummaryBar` 패턴 확장판) |
| `InboxThreadTable` | `components/inbox/InboxThreadTable.tsx` | 데스크톱 표 + `<640px` 카드 리스트 이중 렌더(`LiveSessionTable` 패턴). 행 = 고객 표시(`<bdi>`)·종류 배지·상태 배지·담당·태그·최근 채널/챗봇·연결 대화 수·진행 중 상담 배지·마지막 활동·미리보기 60자 |
| `InboxFilterBar` | `components/inbox/InboxFilterBar.tsx` | 라벨 있는 컨트롤(상태 체크박스 그룹·담당 셀렉트·챗봇 다중 선택·출처 계열 체크박스·태그 다중 선택·고객 종류 체크박스·기간(`DateRangeField` 재사용)·"시험 포함" 토글) |
| `CustomerCardPanel` | `components/inbox/CustomerCardPanel.tsx` | 고객 카드(사실 목록 — 문장 생성 0). props = `CustomerCard`(shared-types) |
| `InboxTimeline` | `components/inbox/InboxTimeline.tsx` | 대화 단위·항목 단위를 시간순 한 줄기로. `role="log"`, 폴링(§4)에서 스크롤·포커스 유지, 새 항목 `aria-live="polite"` 1회 |
| `ThreadActionPanel` | `components/inbox/ThreadActionPanel.tsx` | 상태/보류 해제 시각·가져가기/지정/놓기·태그·진행 중 상담 링크를 묶은 패널 |
| `TagPickerField` | `components/inbox/TagPickerField.tsx` | 체크박스 목록(≤10 선택, UIUX §6 다중 선택=체크박스) + "태그 관리" 링크(ADMIN만 노출) |
| `ManualRecordForm` | `components/inbox/ManualRecordForm.tsx` | 기록 채널(라디오)·방향(라디오)·발생 시각·요약(textarea, 글자 수 카운터)·결과 코드(셀렉트) + 마스킹 미리보기 |
| `NoteForm` | `components/inbox/NoteForm.tsx` | 메모 textarea(≤2,000자) + 마스킹 미리보기 + 수정(작성자 본인 10분 이내만) |
| `CustomerSearchModal` | `components/inbox/CustomerSearchModal.tsx` | 별칭/이름 검색 탭 + 회원 번호 검색 탭(식별 공간 셀렉트 필수) — 결과 행에 "연결"/"병합 대상으로 선택" 버튼(모드 prop으로 구분) |
| `SessionLinkForm` | `components/inbox/SessionLinkForm.tsx` | 챗봇 셀렉트 + `sessionRef` 입력 — 기존 고객에게 "다른 대화 연결하기" |
| `MergeConfirmDialog` | `components/inbox/MergeConfirmDialog.tsx` | `ConfirmDialog` 재사용 + 명시 문구("익명 고객 #1b2c3d를 홍길동에 합치기") |
| `SimulationChatPanel` | `components/inbox/SimulationChatPanel.tsx` | 챗봇 셀렉트(참여 챗봇)·가상 채널 셀렉트 + `ChatMessageList`/`MessageComposer`/`ChatBubble` 재사용 + "시뮬레이션" 상시 라벨 |
| `IdentityStatsTable` | `pages/chatbot-detail/inbox-settings/IdentityStatsTable.tsx` | 최근 24시간 식별 성공/실패 사유별 표(스코프 "이 서버 기준" 안내) |

---

## 3. 화면별 설계

## 3.1 OI-1 — 통합 인박스 목록 (`/inbox`)

### 목적
`cs:read` 보유자가 **참여 챗봇 전체**에서 "사람이 볼 일이 생긴" 고객 스레드를 상태·담당·태그·채널로 관리한다(S-1·S-2, FR-OC4-1~8).

### 상태별 UI

| 상태 | UI |
|---|---|
| 로딩(최초) | `SkeletonRow` × 5 (칩 자리는 숫자 없이 라벨만 먼저 렌더) |
| 조회 성공 · 결과 있음 | §3.1.1 레이아웃 |
| 조회 성공 · 결과 0건(필터 기본값) | `EmptyState`("볼 일이 생긴 고객이 없습니다 — 상담이 시작되거나 경고 단계에 도달하면 자동으로 나타납니다") |
| 필터 적용 후 결과 0건 | `EmptyState`("조건에 맞는 스레드가 없습니다" + "필터 초기화" 버튼) |
| 조회 실패 | `ErrorState`(재시도) |
| 폴링 30초 연속 실패 | `PollingStaleBanner` 패턴 재사용("연결이 원활하지 않습니다") |
| 참여 챗봇 0개(`GET summary` 200이지만 `participatingChatbots: []`) | 목록 대신 안내 카드: "통합 인박스에 참여하는 챗봇이 없습니다 — 챗봇 설정에서 켤 수 있습니다"(`chatbot:write` 있으면 바로가기 링크) |
| 기능 꺼짐(`404`) | 이 라우트 자체가 TopBar에서 숨겨지므로 직접 URL 접근 시에만 `ErrorState`("이 기능은 사용할 수 없습니다") |

### 3.1.1 레이아웃 (데스크톱)

```
┌ 통합 인박스 ───────────────────────────────────────────────────────┐
│ [열림 12] [보류 3] [내 담당 5] [담당 없음 4] [진행 중 상담 2]   (요약 칩)│
├────────────────────────────────────────────────────────────────┤
│ 상태:☑열림 ☑보류 □종료   담당:[전체 ▾]   챗봇:[전체(3개) ▾]         │
│ 채널:☑웹 ☑기록 □시뮬레이션   태그:[선택 ▾]   기간:[     ]~[     ]    │
│ 고객종류:☑식별 ☑익명 □시험   검색:[이름·별칭·회원번호            🔍]│
│                                          [새 고객·기록] [시험 고객] │
├────────────────────────────────────────────────────────────────┤
│고객            상태  담당   태그    최근채널/챗봇   대화 상담 마지막활동 미리보기│
│홍길동(식별) ✔  ●열림 김상담 [환불]  웹→전화/쇼핑봇   3   1   3분 전   "환불 계좌…"│
│#a1b2c3(익명)?  ◐보류(10-03) —    —     전화/—       1   0   1시간전  "재구매 문…"│
│#f9e8d7(익명)?  ●열림 이상담 —    웹/회원봇          2   1건진행중 방금  "카드 안…"│
└────────────────────────────────────────────────────────────────┘
```

모바일(<640px)은 `LiveSessionTable` 카드 리스트 패턴(헤더/배지 → 미리보기 → 메타 정보) 그대로 세로 스택.

### 컴포넌트 분해 및 데이터 바인딩

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `InboxListPage` | `GET /inbox/threads/summary`(요약 칩) + `GET /inbox/threads`(목록, 필터 쿼리) — 폴링 `pollAfterMs`(응답 메타, 기본 10초) 화면 표시 중일 때만(Page Visibility, `LiveSessionListPage` 패턴) |
| `InboxSummaryChips` | `InboxSummaryResponseSchema` — 클릭 시 `status`/`assignee`/`activeHandoff` 쿼리 반영 |
| `InboxFilterBar` | 로컬 필터 state → 쿼리스트링 동기화(뒤로가기 시 필터 복원) |
| `InboxThreadTable` | `InboxThreadListItemSchema[]` — 행 클릭/Enter → `/inbox/:threadId` |
| "새 고객·기록" 버튼 | `cs:write`일 때만 렌더 → OI-3(새 익명 고객 + 수동 기록 흐름, §4.2) |
| "시험 고객" 버튼 | `simulation:write AND cs:read`일 때만 렌더 → OI-7 생성 모달 |
| "필터 초기화" | 쿼리스트링 제거 + 기본값(열림·보류, 시험 제외) 재적용 |

---

## 3.2 OI-2 — 고객 스레드 상세 (`/inbox/:threadId`)

### 목적
한 고객의 여러 챗봇·여러 채널 대화를 시간순으로 보고, 상태·담당·태그·메모·기록·연결을 처리한다(S-2, FR-OC5-1~7).

### 상태별 UI

| 상태 | UI |
|---|---|
| 로딩 | 헤더 자리 `SkeletonRow` + 고객 카드 자리 `SkeletonCard` + 타임라인 자리 `SkeletonRow`×3 |
| 조회 성공 | §3.2.1 레이아웃 |
| 없는 스레드(`404`) | `ErrorState`("스레드를 찾을 수 없습니다") + 인박스로 돌아가기 |
| 병합으로 숨겨진 스레드(`hiddenByMergeId` 존재 — 편집 `409`) | 상단 배너 "이 스레드는 다른 고객과 합쳐졌습니다 → {대상 고객} 스레드로 이동"(링크, 조회는 가능하되 조회 응답에 `noParticipatingChatbot`류로 편집 불가 안내) |
| 참여 챗봇이 하나도 없는 고객(EX-OC-11) | 목록에서 이미 안내되며, 상세에서는 타임라인이 기록·메모만 보이고 상단에 "참여 챗봇 대화가 없습니다(수동 기록만 표시)" |
| `409 INBOX_THREAD_CONFLICT`(다른 사람이 먼저 수정) | 배너 "다른 사람이 먼저 바꿨습니다 — 새로 불러옵니다" + 자동 재조회(§4.4) |
| 진행 중 상담 있음 | 상단 "진행 중 상담 N건" + 콘솔 이동 링크(FR-OC5-5) |
| 타임라인 다음 페이지 로딩 | "더 보기" 버튼이 스피너로 전환 |
| 소거된 텍스트 항목 | `PurgedFieldNotice`("보존기간 경과로 삭제됨") |

### 3.2.1 레이아웃 (데스크톱 — 2열: 좌 고객 카드+동작, 우 타임라인)

```
┌ 인박스 > 홍길동(식별 회원) ✔ ──────────────────────────── ●열림 ──┐
│ ⚠ 진행 중 상담 1건(쇼핑봇) → 상담 콘솔로 이동                        │
├───────────────── 좌: 고객 카드 · 동작 ─── 우: 타임라인 ────────────┤
│ 대화 3건(웹 2·전화 1)         │ [웹·쇼핑봇 09-25 14:02]              │
│ 챗봇 2개 · 첫 활동 09-20      │  사용자: 환불하고 싶어요             │
│ 최근 의도: 환불 문의(3)       │  봇: 환불 절차를 안내해 드릴게요…     │
│ 미응답 2건 · 상담 1건(종료:   │ [상담 09-25 14:10 · 김상담]           │
│  상담원 종료, 마지막 상담원   │  상담원: 계좌를 다시 확인해 주세요    │
│  김상담)                     │ [전화 기록 09-26 10:00 · 이상담]       │
│ 설문 완료 1 · 부정평가 1     │  "계좌 재확인 완료, 3일 내 환불"        │
│ 태그: [환불]                 │ [메모 09-26 10:05 · 이상담]            │
│ 최근 메모: "3일 내 환불 예정" │  "3일 내 환불 예정, 재문의 대비"        │
│                              │ [시스템 09-26 10:05] 상태: 열림→보류    │
│ ── 동작 ──────────────────── │  (더 보기)                             │
│ 상태:[열림▾] 해제:[   ]      │                                        │
│ 담당: 김상담 [놓기]           │                                        │
│ 태그: [환불 ×] [+ 추가]       │                                        │
│ [메모 작성] [수동 기록]       │                                        │
│ [다른 대화 연결] [병합]       │                                        │
│ 연결된 대화:                 │                                        │
│  · 웹/쇼핑봇 #a1b2(자동-식별) │                                        │
│  · 웹/회원봇 #c3d4(자동-식별) │                                        │
│  · 전화 기록(수동)            │                                        │
└──────────────────────────────┴────────────────────────────────────────┘
```

모바일(<768px)은 상단에 고객 카드 요약(접힘 가능한 아코디언), 그 아래 동작 패널, 그 아래 타임라인 순서로 세로 스택(`InboxTimeline`이 화면 대부분을 차지).

### 컴포넌트 분해 및 데이터 바인딩

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `InboxThreadDetailPage` | `GET /inbox/threads/:threadId`(1페이지 포함) — 폴링 10초(화면 표시 중, `TranscriptPanel` 패턴) · `version` 보관(쓰기 CAS용) |
| `CustomerCardPanel` | `detail.card`(`CustomerCard`) — "최근 매칭 의도/FAQ" 항목은 `topMatches`, 삭제된 항목은 "(삭제된 항목)" 그대로 표시 |
| `ThreadActionPanel` | `detail.thread`(상태·담당·태그·`version`) — 상태 변경 시 `PATCH …/threads/:id`, 놓기/가져가기/지정은 각 엔드포인트, 전부 `version` CAS 실패 시 §4.4 처리 |
| `TagPickerField` | `detail.thread.tags` + `GET /inbox/tags`(전역 목록) |
| `InboxTimeline` | `detail.timeline.units`(유니온) — `nextCursor` 있으면 "더 보기" |
| `ManualRecordForm`/`NoteForm` | §3.3·§3.4 |
| `CustomerSearchModal`(모드=`link`) | §3.5 |
| `MergeConfirmDialog` | §3.6 |
| "진행 중 상담 N건" 링크 | `detail.activeHandoffs[]` → `/handoff-console/{chatbotId}/live/{sessionRef}` |

### 접근·연결 동작 상세

- **가져가기**: 담당 없음일 때만 버튼 노출, 클릭 즉시 `POST …/claim`(본인 지정) — `409`면 "방금 다른 상담원이 가져갔습니다" 배너 + 재조회.
- **지정**: 담당 유무 무관 셀렉트(`GET /inbox/assignees` — `cs:write` 보유 활성 사용자만) + "지정" 버튼. 비활성 담당자는 셀렉트에 없고, 현재 담당이 비활성이면 이름 옆 "비활성" 배지(EX-OC-12).
- **놓기**: 담당자 본인 또는 ADMIN만 버튼 활성(그 외엔 숨김이 아니라 비활성 + 사유 "담당자만 놓을 수 있어요" — `TranscriptPanel`의 "담당자가 아니어서 보낼 수 없습니다" 패턴).
- **상태**: 셀렉트(열림/보류/종료) — 보류 선택 시 해제 시각 입력(선택, 미래·≤30일 — UIUX §6 날짜 입력 하한/상한 안내 텍스트 병행). 보류 해제 시각이 지난 스레드는 목록·상세 모두 "열림"으로 **표시**하되, 배지에 작은 안내 "(보류 해제 시각 지남 — 다음 변경 시 자동 반영)"를 달아 서버 확정 시점의 지연을 숨기지 않는다.
- **연결된 대화 행**: 각 행에 출처 배지(`IDENTITY`/`MANUAL`/`SYSTEM`)와, `MANUAL`/`SYSTEM`이면 "분리" 버튼. `IDENTITY`는 "분리" 버튼이 **ADMIN에게만** 노출되고(비ADMIN에겐 자물쇠 아이콘 + "관리자만 해제할 수 있어요" 텍스트), ADMIN이 눌러도 곧바로 실행하지 않고 §3.6b 확인 창을 띄운다(R-11 ⚠ — §13-1 PM 확인 완료 항목이지만 위험도가 높아 확인 모달은 유지).
- **"다른 대화 연결"**: `SessionLinkForm`(챗봇 셀렉트 + `sessionRef` 입력) — 상담원이 다른 화면(예: 상담 콘솔의 `SessionRefLabel`)에서 본 값을 그대로 붙여넣는 것을 전제로 한 텍스트 입력이다(자동완성 없음 — 별도 검색 API가 없다, 설계서 §7.2).

---

## 3.3 OI-3 — 수동 기록 작성 (`ManualRecordForm`, OI-2 안 패널/모달)

### 목적
전화·이메일·방문·기타로 있었던 응대를 스레드에 남긴다(FR-OC6-1~4).

### 레이아웃

```
┌ 수동 기록 작성 ──────────────────────────────┐
│ 기록 채널 *  ○전화 ○이메일 ○방문 ○기타         │
│ 방향 *      ○고객이 연락  ○우리가 연락          │
│ 발생 시각 * [2026-09-26] [10:00]  (오늘부터 최대 7일 전까지)│
│ 요약 *                                        │
│ ┌──────────────────────────────────────────┐│
│ │계좌 재확인 완료, 3일 내 환불 예정           ││
│ └──────────────────────────────────────────┘│
│ 0/4000자                                      │
│ 결과      ○해결 ○후속 필요 ○선택 안 함          │
│ [미리보기 보기] → "계좌 재확인 완료…" (가려질 정보 없음)│
│                              [취소]  [저장]     │
└────────────────────────────────────────────┘
```

- 필수 항목은 `*`(UIUX §6 필수/선택 일관 표시). 기본 선택값은 없음(방향·기록 채널 모두 사용자가 명시적으로 선택해야 저장 버튼 활성 — UIUX §6 "기본값 임의 선택 금지").
- 발생 시각이 미래이거나 7일 초과 과거면 **제출 시점**에 인라인 오류(`400 VALIDATION_FAILED`) — "발생 시각은 오늘부터 최대 7일 전까지만 입력할 수 있습니다"(UIUX §7, 포커스 이동만으로 팝업 금지).
- "미리보기 보기"는 `POST /inbox/mask-preview` 재사용(No.24 `maskPreviewLabel` 패턴과 동일 문구 체계 — §3.3 `maskPreviewNoChangeHint`/`maskPreviewChangedHint`).
- 저장 성공 시 스레드가 `CLOSED`였다면 자동으로 `OPEN`으로 바뀌고(FR-OC6-1) 상태 배지가 즉시 갱신되며 `aria-live="polite"`로 "기록이 저장되었습니다. 상태가 열림으로 바뀌었습니다"를 1회 안내한다.
- 참여 챗봇이 없는(즉, 아직 인박스에 스레드가 없는) 새 연락처의 경우 OI-1의 "새 고객·기록" 버튼이 먼저 `CreateAnonymousCustomerSchema`(표시 이름 선택)로 익명 고객을 만들고, 그 결과로 연 스레드(§4.2)에서 바로 이 폼이 이어진다.

---

## 3.4 OI-4 — 메모 작성 (`NoteForm`, OI-2 안 패널)

### 레이아웃

```
┌ 메모 ────────────────────────────────────────┐
│ ┌──────────────────────────────────────────┐│
│ │재문의 대비, 환불 계좌 재확인 필요            ││
│ └──────────────────────────────────────────┘│
│ 0/2000자                                      │
│ [미리보기 보기]                     [저장]     │
├ 최근 메모 ──────────────────────────────────────┤
│ 이상담 · 09-26 10:05 · "3일 내 환불 예정…" [수정]│  ← 작성자 본인 + 10분 이내만 [수정] 노출
└────────────────────────────────────────────┘
```

- 메모는 **감사 대상이 아니다**(FR-OC9-7) — 저장 시 토스트("메모가 저장되었습니다")만 표시하고 별도 확인 모달 없음.
- 삭제 버튼 없음(보존 소거만, FR-OC5-6) — "삭제" UI 자체를 두지 않는다(사용자가 삭제를 시도할 지점이 없어야 함).
- 수정 창(10분)이 지나면 "수정" 버튼이 사라지고 대신 회색 텍스트 "작성 후 10분이 지나 수정할 수 없습니다"(호버 시에만, 상시 노출은 아님 — 메모 목록이 길어지는 것을 막기 위해 최근 메모 1건에만 적용).

---

## 3.5 OI-5 — 고객 검색·연결 (`CustomerSearchModal`)

### 목적
익명 세션을 기존 고객에 붙이거나(FR-OC3-3), 회원 번호로 고객을 찾는다(FR-OC3-7). No.24 콘솔과 OI-2 양쪽에서 재사용한다.

### 진입 경로 2가지

1. **No.24 콘솔에서**(OI-10 연계): 세션 컨텍스트(`chatbotId`+`sessionRef`)를 이미 알고 있는 상태에서 "고객에 연결" 클릭 → 이 모달이 열리고, 검색 결과에서 고객을 고르면 즉시 `POST /inbox/customers/:id/links {chatbotId, sessionRef}`.
2. **OI-2에서**("다른 대화 연결"): 고객은 이미 알고(현재 스레드), 연결할 세션을 몰라 `SessionLinkForm`(챗봇+`sessionRef` 입력)을 먼저 채운 뒤 확인.

### 상태별 UI

| 상태 | UI |
|---|---|
| 초기 | 탭 2개: "이름·별칭" / "회원 번호" — 입력 전 결과 없음(`EmptyState` 텍스트 "검색어를 입력하세요") |
| 검색 중 | 결과 영역 `SkeletonRow`×3 |
| 결과 있음 | 리스트(별칭·표시 이름·종류 배지·대화 수·스레드 상태) + 각 행 액션 버튼 |
| 결과 0건 | `EmptyState`("일치하는 고객이 없습니다") |
| 고객 키 비밀 미설정(회원 번호 탭) | 탭 진입 시 안내 "서버에 고객 키 비밀이 설정되지 않아 회원 번호로 찾을 수 없습니다"(입력 필드 비활성) |
| 대상이 `IDENTITY` 연결(연결 시도) | `409 CUSTOMER_LINK_LOCKED` → 모달 안 인라인 오류 "이 대화는 이미 다른 회원으로 확인되어 있어 연결할 수 없습니다" |

### 레이아웃

```
┌ 고객에 연결 ──────────────────────────────────┐
│ [이름·별칭]  [회원 번호]                        │
│ 검색: [홍길동                          🔍]      │
│ ┌──────────────────────────────────────────┐ │
│ │ 홍길동 ✔ 식별 회원 · 대화 3건 · 스레드 열림  [연결]│
│ │ #a1b2c3 ? 익명 · 대화 1건 · 스레드 없음      [연결]│
│ └──────────────────────────────────────────┘ │
│                                      [취소]    │
└──────────────────────────────────────────────┘
```

회원 번호 탭:

```
┌ 회원 번호로 찾기 ─────────────────────────────┐
│ 식별 공간: [SHOPMALL ▾]                        │
│ 회원 번호: [●●●●●●1234] [표시 전환 👁]           │
│ ⓘ 입력한 값은 저장되지 않습니다(해시로만 대조).    │
│                                     [검색]      │
└──────────────────────────────────────────────┘
```

- 회원 번호 입력은 기본 마스킹(`type="password"` 유사) + "표시 전환" 토글(UIUX §1 민감정보 열람 토글 원칙과 유사하게 시각적 노출만 전환하고 서버 저장과는 무관함을 도움말로 명시).
- 검색은 **제출형**(Enter/버튼) — 값 변경만으로 자동 조회하지 않는다(회원 번호가 URL·요청 로그에 남지 않게 `POST`, 그리고 타이핑 중간값이 과다 요청되지 않게).

### 컴포넌트 분해

| 컴포넌트 | props |
|---|---|
| `CustomerSearchModal` | `mode: 'link' | 'merge'`, `context: { chatbotId, sessionRef } | { sourceCustomerId }`, `onDone` |
| `SessionLinkForm` | `participatingChatbots`, `onSubmit({chatbotId, sessionRef})` |
| 결과 행 액션 | `mode==='link'` → "연결" 버튼, `mode==='merge'` → "병합 대상으로 선택"(다음 §3.6 확인 모달로 이동) |

---

## 3.6 OI-6 — 병합/되돌리기 (`MergeConfirmDialog` + 되돌리기 인라인 버튼)

### 목적
익명 고객을 식별 고객(또는 다른 익명 고객)에 합치고, 잘못 합쳤을 때 되돌린다(FR-OC3-5, §7.4~§7.5).

### 3.6a 병합 흐름

```
OI-2(익명 고객 스레드) → [병합] 클릭 → CustomerSearchModal(mode=merge)
→ 대상 고객 선택 → MergeConfirmDialog:
   제목: "고객을 합칠까요?"
   설명: "익명 고객 #1b2c3d를 홍길동에 합칩니다. 대화·메모·기록이 홍길동의 스레드로 옮겨집니다.
          잘못 합쳤다면 24시간 안에 되돌릴 수 있습니다."
   [취소]  [합치기]
→ 성공: 대상 스레드로 이동(`/inbox/:targetThreadId`) + Toast "병합되었습니다"
→ 실패(409 CUSTOMER_MERGE_FORBIDDEN):
   - 식별↔식별: "서로 다른 로그인 회원은 합칠 수 없습니다"(S-4)
   - 시험 고객 관련: "시험 고객은 실제 고객과 합칠 수 없습니다"
   - 소거된 고객 대상: "이미 개인정보가 삭제된 고객과는 합칠 수 없습니다"
```

- 병합 버튼은 고객 종류가 `IDENTIFIED`인 스레드에서는 **렌더되지 않는다**(원본이 될 수 없음 — 방향을 헷갈리지 않게 아예 숨김. 대상으로는 여전히 검색 결과에 나타난다).
- 병합 확인 모달은 `ConfirmDialog`를 재사용하되 `danger`는 **아님**(되돌릴 수 있는 동작이라 파괴적 톤 대신 중립 톤 — 단, 명시적 버튼 이름 "합치기"는 유지, UIUX 버튼 동사형 원칙).

### 3.6b 되돌리기 흐름

타임라인의 `MERGED_IN`/`PROMOTED` 시스템 항목 옆에 인라인 버튼:

```
[시스템 09-26 11:00] 병합됨: 익명 고객 #1b2c3d → 이 고객                [되돌리기]
```

- 버튼 노출 규칙: `cs:write` **및** (ADMIN **또는** 본인이 수행한 병합이고 `mergedAt` + 24시간 이내) — 조건 미충족이면 버튼을 숨기지 않고 회색 비활성 + 사유 텍스트("관리자만 되돌릴 수 있어요" / "되돌릴 수 있는 시간(24시간)이 지났어요"). **로그인 승격 병합**(`kind='IDENTITY_PROMOTION'`)은 항상 ADMIN 전용 사유 텍스트.
- **이 노출 규칙은 클라이언트에서 사전 판정한다(서버 재조회 0)**: 타임라인 응답에 이미 내려온 해당 SYSTEM 항목의 `meta.mergedByUserId`·`meta.mergedAt`·`meta.mergeKind`와, 상세 응답 최상위 `mergeRevertHours`(서버 설정 `OMNI_MERGE_REVERT_HOURS`, 기본 24 — 고정값을 하드코딩하지 않는다)를 대조해 "지금 이 사용자가 눌러도 되는지"를 화면에서 미리 계산한다 — 버튼 활성/비활성만을 위해 별도 API를 호출하지 않는다. **최종 판정은 여전히 서버 재검증**(§5·§11)이며, 사전 판정과 서버 판정이 어긋나는 경우(예: 시계 오차로 경계값 근처)는 §4.7의 `403`/`409` 오류 처리로 흡수한다.
- 클릭 → `ConfirmDialog`("병합을 되돌릴까요?" / "옮겨진 대화·메모·태그가 원래 고객으로 돌아갑니다") → `POST /inbox/merges/:mergeId/revert`.
- 실패(`409 CUSTOMER_MERGE_NOT_REVERTIBLE`): "이미 되돌려졌거나, 그 뒤 다시 합쳐져 지금은 되돌릴 수 없습니다."

### 3.6c IDENTITY 분리(ADMIN 전용, R-11)

OI-2 "연결된 대화" 행에서 `IDENTITY` 출처 행의 분리:

```
[ADMIN에게만] [분리] 클릭 → ConfirmDialog(danger=true):
  제목: "이 회원 연결을 강제로 해제할까요?"
  설명: "이 대화는 서버가 서명을 확인해 자동으로 연결한 것입니다. 강제로 해제하면 이 세션은
        새 익명 고객이 되고, 이후 이 세션에서 오는 로그인 정보는 무시됩니다. 이 동작은 대부분의
        경우 필요하지 않으며, 토큰 오발급·재사용이 의심될 때만 사용하세요."
  [취소]  [강제로 해제]
```

이 확인 문구는 §13-1 목록에 없던 화면 판단이며 "고위험 동작 명시" 원칙(UIUX 버튼 §4·NFR-DGA2 선례)에 따라 ui-designer가 추가했다(§12 D-3).

---

## 3.7 OI-7 — 시뮬레이션 채널 (시험 고객)

### 목적
카카오톡 등 미연동 채널을 계약 전에 **시험 고객**으로 시연·검증한다(FR-OC7-1~5, S-6). 실제 로그·통계·학습 큐에 영향 0임을 화면 전체에서 반복 고지한다(NFR-OCA3).

### 진입 경로

- OI-1 "시험 고객" 버튼 → 목록(간단 모달 또는 `/inbox?customerKinds=TEST` 필터 + 만들기 폼) → 생성 시 `label`(≤40자, 필수) 입력 → 생성 즉시 그 고객의 스레드(OI-2)로 이동.
- OI-2에서 `customer.kind === 'TEST'`이면 동작 패널의 "수동 기록" 버튼 자리가 **"시뮬레이션"** 패널로 대체된다(둘 다 동시에 보이지 않음 — 시험 고객은 실제 응대 기록 대상이 아니다).

### 레이아웃 (`SimulationChatPanel`, OI-2 안)

```
┌ 시뮬레이션 — 카카오톡(가상) ────────────────────┐
│ 챗봇: [쇼핑봇 ▾]   가상 채널: [카카오톡 ▾]         │
│ ┌──────────────────────────────────────────┐│
│ │ [시뮬레이션] 사용자: 배송 언제 와요?          ││
│ │ [시뮬레이션] 봇: 주문번호를 알려주시겠어요?    ││
│ │   ⓘ 이 채널에서는 버튼이 텍스트로 보입니다    ││ ← OverlayBadge 재사용(격하 미리보기)
│ └──────────────────────────────────────────┘│
│ [메시지를 입력하세요                      ] [전송]│
│ ⚠ 이 대화는 실제 고객·통계·학습에 반영되지 않습니다│
└──────────────────────────────────────────────┘
```

- 모든 말풍선에 "시뮬레이션" 텍스트 라벨이 **말풍선 자체**에 병기된다(색상 배경만으로 구분하지 않음 — NFR-OCA3, `ChatBubble` 확장 지점).
- 가상 채널 셀렉트는 `ChannelType` 8종 라벨(설정 여부 무관 — `CONFIG_ONLY` 채널 포함) 중 선택.
- 서빙 버전이 없는 등 시뮬레이터 오류(EX-OC-16)는 시뮬레이터의 기존 오류 배너를 그대로 재사용하고, 이 경우 항목은 저장되지 않는다.
- 시험 고객 삭제(OI-1 목록 또는 OI-2 헤더의 "시험 고객 삭제" 버튼)는 `ConfirmDialog(danger=true)` — "시험 고객과 시뮬레이션 기록이 모두 삭제됩니다".

### 컴포넌트 분해

| 컴포넌트 | props |
|---|---|
| `SimulationChatPanel` | `customerId`, `participatingChatbots`, `onEntryAdded`(타임라인에 `SIM_USER`/`SIM_BOT` 2건 추가) |
| 봉투 보관 | 페이지 로컬 state(서버 저장 0, R-17) — 새로고침 시 초기화 안내 문구 "새로고침하면 대화가 처음부터 시작됩니다" |

---

## 3.8 OI-8 — 전역 태그 관리 (`/inbox/tags`)

### 목적
ADMIN이 태그 이름·색을 관리한다(FR-OC4-7). **조회는 `cs:read` 하나로 열려 있다** — OI-1·OI-2와 같은 문이다(§1).

### 레이아웃

```
┌ 태그 관리 ───────────────────────────────────┐
│ [+ 태그 추가]                                  │
│ 이름     색       사용 중       │
│ 환불    🟥 빨강    12건 스레드    [수정] [삭제] │
│ VIP     🟦 파랑     3건 스레드    [수정] [삭제] │
└──────────────────────────────────────────────┘
```

- 색 선택은 **팔레트 8색 셀렉트**(자유 HEX 아님 — 대비 검증된 값만, 설계서 `InboxTag.color`).
- 사용 중 태그 삭제 시 `ConfirmDialog`("이 태그는 12개 스레드에서 쓰이고 있습니다. 삭제하면 모든 스레드에서 제거됩니다") + 확인 후 `?force=true`로 재요청.
- **라우트 진입 자체는 `cs:read`만 있으면 된다** — ADMIN이 아닌 `cs:read` 사용자(EDITOR·AGENT)도 이 화면에 들어와 목록을 볼 수 있다. "+ 태그 추가"·"수정"·"삭제" 버튼만 ADMIN이 아니면 렌더되지 않는다(가드는 라우트 1곳, 변경 동작만 서비스 재검증 — §5).

---

## 3.9 OI-9 — 챗봇 설정 · 통합 인박스 (`SettingsTab` `section=inbox`)

### 목적
챗봇별로 인박스 참여·경고 열기·식별 비밀 참조를 설정한다(FR-OC8-1~5).

### 진입 경로 · 정보구조

`SettingsTab.tsx`의 서브탭을 `basic`/`retention`(No.45 기존)/**`inbox`**(신규) 3개로 확장한다(§0에서 확인한 `?section=` 쿼리 패턴 그대로). 서브탭 자체는 **`chatbot:read`만 있으면 보인다**(조회는 전 역할 가능 — G2의 "EDITOR에게 서브탭 자체가 없다"와 달리, 이 그룹은 "참여 여부"를 EDITOR도 알아야 하므로 조회를 넓게 연다).

### 상태별 UI

| 상태 | UI |
|---|---|
| 로딩 | `SkeletonRow`×4 |
| 조회 성공 | §3.9.1 레이아웃 |
| 저장 중(참여/경고) | 저장 버튼 스피너 |
| `404 CHATBOT_ARCHIVED`류(저장 시도) | 인라인 "보관된 챗봇은 설정을 바꿀 수 없습니다" |
| 식별 참조 저장 권한 없음(`security:write` 없음) | 필드 자체가 읽기 전용 텍스트로만 표시(입력 요소 렌더 안 함) |

### 3.9.1 레이아웃

```
┌ 챗봇 설정 ─ [기본 정보] [보존기간] [통합 인박스] ──────────────────┐
│ ⓘ 이 설정은 환경 분리 대상이 아닙니다 — 저장 즉시 운영에 적용됩니다   │
│  (다른 서버는 최대 30초 뒤 반영)                                     │
│                                                                     │
│ 통합 인박스 참여  [🔘 켜짐]                                          │
│ 경고 단계 도달 시 스레드 열기  [⚪ 꺼짐]                              │
│                                                                     │
│ ── 식별 연동(고객사 로그인 회원 자동 통합) ───────────────────────── │
│ 식별 비밀 참조 *  [SHOPMALL          ]  (ADMIN만 편집 가능)          │
│  상태: ✔ 설정됨 · 고객 키 비밀: ✔ 설정됨                             │
│  ⚠ 최근 서버 재시작 이후 지문이 바뀐 것으로 보입니다 — 비밀이         │  ← EX-OC-20, 조건부
│    교체된 경우 이전 고객과 새 대화가 연결되지 않습니다.               │
│                                                                     │
│ 최근 24시간 식별 현황(이 서버 기준)                                  │
│ 성공 128 · 서명불일치 3 · 만료 5 · 형식오류 0 · 충돌 1 · 비밀없음 0   │
│                                                                     │
│ 같은 참조("SHOPMALL")를 쓰는 다른 챗봇: 회원혜택봇                    │
│                                                                     │
│                                                     [저장]           │
└─────────────────────────────────────────────────────────────────┘
```

- "식별 비밀 참조" 입력값 형식(`^[A-Z0-9]+(_[A-Z0-9]+)*$`, ≤40)은 제출 전 클라이언트 검증 + 인라인 오류("영문 대문자·숫자·밑줄만, 최대 40자").
- "같은 참조를 쓰는 다른 챗봇" 목록(`GET identity-spaces`)은 **서로의 고객을 공유한다**는 사실을 눈에 보이게 해 실수를 막는다(FR-OC2-2 의도 고지).
- 참여를 끌 때(끄기 확인 없이 즉시 반영 — 파괴적이지 않음, 데이터는 유지) 도움말: "기존 스레드·연결은 유지되며, 이 챗봇의 대화만 인박스에서 숨겨집니다."

### 컴포넌트 분해

| 컴포넌트 | props |
|---|---|
| `ChatbotInboxSettingsSection` | `GET /chatbots/:id/inbox-settings` → 폼 상태 |
| `IdentitySecretRefField` | `value`, `secretStatus`(`IdentitySecretStatusBadge`), `readOnly = !can('security:write')` |
| `IdentityStatsTable` | `stats24h`(`ChatbotInboxSettingsResponse.identity.stats24h`) |
| "저장" | `PUT …/inbox-settings`(참여·경고) — 식별 참조는 **별도** `PUT …/inbox-settings/identity`(`security:write`) 버튼(같은 폼 안이지만 저장 호출은 분리 — 권한 경계를 명확히) |

---

## 3.10 OI-10 — 상담 콘솔(No.24) 고객 카드 연계

### 목적
기존 화면(진행 중 세션·대화 보기·상담 이력 상세)을 **바꾸지 않고** 고객 카드 요약과 이동 링크만 추가한다(FR-OC5-7 · H-14/H-17 응답 키 집합 불변).

### 삽입 위치 (실제 파일 확인)

| 화면 | 파일 | 위치 |
|---|---|---|
| 대화 보기(진행 중) | `LiveSessionDetailPage.tsx` | `<h2>`(세션 별칭 + 배지들) 바로 아래, `TranscriptPanel` 위 |
| 대화 보기(패널 자체, 이력 재사용분 포함) | `TranscriptPanel.tsx` | 헤더(`transcript-panel-header`) 아래, `GovernanceViewAuditBanner` 다음 |
| 상담 이력 상세 | `HandoffHistoryDetailPage.tsx` | `GovernanceViewAuditBanner` 다음, `TranscriptEntryList` 위 |

### 표시 규칙 (`GET /inbox/session-link?chatbotId=&sessionRef=`)

```
participating: false                 → 아무것도 렌더하지 않음(인박스 꺼짐/비참여 — 영역 자체 숨김)
participating: true, customer: null  → [고객에 연결] 버튼(OI-5 모달, mode=link)
participating: true, customer 있음   → CustomerBriefBadge(별칭·표시이름·종류배지)
                                        + "대화 {n}건 · 최근 의도 {x} · 상담 {n}건 · 최근메모 '…'"
                                        + threadId 있으면 [스레드 열기]() 링크(새 탭 아님 — 같은 탭 이동, 진행 중 상담 화면 이탈 주의 안내 없음: 상담은 별도 탭에서 유지되는 세션이 아니므로 이동해도 안전)
                                        + threadId 없으면 [스레드 만들기] 버튼(POST …/threads/open)
```

- 이 영역은 **폴링 대상이 아니다**(TranscriptPanel의 2초 폴링에 얹지 않는다) — 세션 진입 시 1회 조회, "스레드 만들기" 성공 시에만 재조회.
- `LiveSessionTable`의 행에는 이 카드 요약을 넣지 않는다(목록은 그대로, 상세에서만 — 목록 성능·시각적 밀도 유지).

---

## 3.11 OI-11 — 채널 설정(No.11) 안내 문구 확장

`PlaceholderChannelForm.tsx`의 `msg.configOnlyNotice`(`SeverityBadge severity="INFO"`) 문구 뒤에 한 문장을 추가한다(새 UI 요소 없음, FR-OC1-5):

> 기존: "이 채널은 아직 설정만 저장되며 실제 연동은 지원하지 않습니다."(예시)
> 확장: "…(기존 문구) 실제 연동은 준비 중이며, **통합 인박스**에서는 시뮬레이션으로 흐름을 시험할 수 있습니다."

`cs:read`가 없는 사용자에게도 이 문구는 그대로 보인다(안내일 뿐 기능 진입점은 아님 — "통합 인박스" 텍스트는 링크가 아니다).

---

## 3.12 OI-12 — 데이터 지도·보존 정책(No.45) 라벨 확장

- `DataGovernanceMapPage.tsx`(§3.1 참조 문서 레이아웃)의 외부 전송/필드 암호화 카드들 **다음**에 새 카드 "통합 인박스" 1개 추가:

```
├─ 통합 인박스 ──────────────────────────────────────────────────────┤
│ 고객: 128명(식별 92 · 익명 36) · 스레드 130개 · 기록/메모 412건        │
│ 식별 정보: 해시만 저장(회원 번호 원문 없음) · 표시 이름 암호화: 켜짐    │
│ 보존: 인박스 메모·기록 180일 · 고객 식별 정보 365일                    │
└────────────────────────────────────────────────────────────────┘
```

고객 0명이면 이 카드 자체가 **렌더되지 않는다**(선택 키 `inbox?` 생략과 대응 — "0"을 보여주는 대신 카드를 생략해 빈 기능처럼 보이지 않게 한다).

- `DataGovernanceRetentionPage.tsx`(§3.2 레이아웃)의 보존 종류 표에 행 2개 추가: "인박스 메모·기록"(하한 7일) · "고객 식별 정보(해시·표시 이름)"(하한 7일, 챗봇별 재정의 없음 — "전역만" 안내 텍스트 병기, 다른 4종과 달리 "챗봇별 재정의" 열이 항상 "—").

---

## 3.13 OI-13 — TopBar 진입점 + 위젯 식별 토큰(계약만)

### TopBar

`components/TopBar.tsx`의 "모니터링" 링크 다음에 추가:

```tsx
{canSeeInbox && (
  <Link to="/inbox">
    {MESSAGES.common.inboxNav}
    {inboxMine > 0 && ` (${MESSAGES.inbox.myAssignedCount(inboxMine)})`}
  </Link>
)}
```

- `canSeeInbox = can('cs:read')`. 요약 조회가 **404**(기능 꺼짐)면 `canSeeInbox`와 무관하게 링크를 숨긴다 — `SystemSettingsMenu`의 "확인 필요" 배지 패턴처럼 `useEffect`로 1회(+60초 간격) `GET /inbox/threads/summary`를 불러 성공하면 `inboxMine`(요약의 `mine`)을 채우고, 404를 받으면 `enabled=false`로 링크 자체를 렌더하지 않는다.
- 이 배치(모니터링 옆)와 "내 담당 N건" 카운트는 설계서 §20-1이 정확히 지정하지 않아 ui-designer가 기존 "내 상담 n건" 패턴을 그대로 확장한 것이다(§12 D-2).

### 위젯 식별 토큰 — 관리자 콘솔 화면 아님(계약 요약만)

- 임베드 속성 `data-identity-token="<토큰>"` 또는 `window.__ChatBotWidget.identify(token | null)`(설계서 §6.8). 관리자 콘솔에는 이 토큰을 **입력하는 화면이 없다** — OI-9의 "식별 비밀 참조"는 **서버 비밀의 이름**만 다루고, 토큰 자체는 고객사 서버가 만든다.
- 연동 가이드(`docs/05-ops/통합인박스_연동가이드.md`, deployment-engineer 인계)에 Node/Python/Java 토큰 생성 예시·동의 고지 문구 예시·비밀 교체(`__PREV`) 절차를 둔다. OI-9 화면에는 이 문서로의 링크 1줄만 추가한다: "연동 방법 안내 보기 →"(외부 문서 링크, 새 탭).

---

## 4. 사용자 인터랙션 흐름 종합

### 4.1 로그인 회원 자동 통합 확인 (S-1)

```
(백그라운드) 고객사 서버가 서명 토큰 발급 → 위젯이 헤더로 전송 → 서버가 연결 적재(비차단)
상담원이 OI-1 진입 → "홍길동(식별 회원)" 행 클릭 → OI-2 →
고객 카드에 "대화 3건(웹 2 · 전화 1) · 챗봇 2개" 확인 → 타임라인에서 두 챗봇 대화가 시간순으로 섞여 보임
```

### 4.2 새 연락처 전화 응대 → 스레드 생성 (S-2 후반)

```
OI-1 "새 고객·기록" → 표시 이름(선택) 입력 → 생성(POST /inbox/customers)
→ 새 익명 고객의 OI-2로 이동(스레드 자동 열림, openReason=MANUAL)
→ ManualRecordForm 작성 → 저장 → 타임라인에 RECORD 항목 1건
→ (나중에) OI-2 "병합" → 회원 번호로 검색 → 식별 고객 A에 병합 → S-2 완결(§3.6a)
```

### 4.3 오병합 방지 (S-4)

```
OI-2(식별 고객 B) → [병합] → CustomerSearchModal → 식별 고객 A 선택 → [합치기]
→ 409 CUSTOMER_MERGE_FORBIDDEN → 모달 안 인라인 오류
  "서로 다른 로그인 회원은 합칠 수 없습니다 — 회원 정보가 잘못됐다면 고객사 시스템을 확인하세요."
→ 모달 유지(다른 대상 재선택 가능)
```

### 4.4 동시 편집 경합 (AC-OC4-4)

```
상담원 A·B가 같은 스레드에서 동시에 [가져가기] 클릭
→ A 성공(200, 새 version) · B는 409 INBOX_THREAD_CONFLICT
→ B 화면: 배너 "다른 사람이 먼저 바꿨습니다 — 새로 불러옵니다"(2초 후 자동 사라짐)
→ 스레드 상세 자동 재조회(GET) → 담당 "김상담(A)"로 갱신 → B의 가져가기 버�튼은 사라짐(이미 담당 있음)
```

이 배너는 폴링 실패 배너와 시각적으로 다른 톤(정보성 `role="status"` 1회, 경고성 폴링 정지 배너와 혼동되지 않게 `field-hint`류가 아니라 `form-banner form-banner--info`).

### 4.5 시험 고객 시연 (S-6)

```
OI-1 "시험 고객" → label "영업시연-01" → 생성 → OI-2(SIMULATION 패널)
→ 챗봇 "쇼핑봇" · 가상 채널 "카카오톡" → "배송 언제 와요?" 전송 → 봇 답 렌더(시뮬레이션 라벨)
→ 가상 채널을 "웹"으로 바꿔 다시 전송(같은 고객·스레드) → 타임라인에 두 채널이 함께 쌓임
→ 대시보드로 이동해 통계·질문 순위가 그대로임을 확인(이 그룹이 만드는 화면 아님)
```

### 4.6 토큰 위조 시도 (S-5, 상담원 관점)

```
(공격자가 위조 토큰 전송 → 대화는 정상 처리되어 최종 사용자는 아무 차이를 못 느낌)
운영자가 OI-9(챗봇 설정 통합 인박스) 진입 → "최근 24시간 식별 현황"에서 "서명불일치 17건" 확인
→ 필요 시 고객사에 통보(콘솔에서는 사유별 수치까지만 제공, 개별 시도 상세는 없음 — FR-0-187)
```

### 4.7 오류 처리 요약표

| 오류 코드 | 화면 | 처리 |
|---|---|---|
| `INBOX_THREAD_CONFLICT`(409) | OI-2 모든 쓰기 | 정보 배너 + 자동 재조회(§4.4) |
| `CUSTOMER_LINK_LOCKED`(409) | OI-2 연결/분리, OI-5 연결 | 인라인 오류("이미 다른 회원으로 확인되어 있어…" / 비ADMIN 분리 시도는 버튼 자체가 비활성) |
| `CUSTOMER_MERGE_FORBIDDEN`(409) | OI-6a | 모달 안 인라인 오류(사유별 문구 §4.3) |
| `CUSTOMER_MERGE_NOT_REVERTIBLE`(409) | OI-6b | 버튼 클릭 시 토스트 오류(버튼은 평소 비활성으로 대부분 막힘 — 경합 시에만 도달) |
| `VALIDATION_FAILED`(400, 기록 시각 범위) | OI-3 | 발생 시각 필드 인라인 오류 |
| `VALIDATION_FAILED`(400, 비참여 챗봇) | OI-5 `SessionLinkForm`, OI-7 챗봇 셀렉트 | 셀렉트가 참여 챗봇만 나열하므로 정상 경로로는 도달하지 않음(방어적 인라인 오류만) |
| `VALIDATION_FAILED`(400, 고객 키 비밀 없음) | OI-5 회원 번호 탭 | 탭 진입 시 필드 비활성 + 안내(§3.5) |
| `LIMIT_EXCEEDED`(태그 100/스레드당 10) | OI-8, OI-2 태그 | 인라인 오류("태그는 최대 10개까지 붙일 수 있습니다" / "전역 태그는 최대 100개입니다") |
| `DUPLICATE_NAME`(태그) | OI-8 | 이름 필드 인라인 오류 |
| `FORBIDDEN`(403, ADMIN 전용 동작) | OI-6b·6c, OI-8 | 버튼이 평소 비활성+사유(정상 경로로는 403 도달 드묾) |
| `CHATBOT_ARCHIVED`(409) | OI-9 저장 | 인라인 오류 + 저장 버튼 비활성 유지 |
| `NOT_FOUND`(404, 세션 해석 실패) | OI-5 `SessionLinkForm` | "이 챗봇에서 해당 세션을 찾을 수 없습니다(최근 24시간 대화만 연결할 수 있습니다)" |
| `PERMISSION_DENIED`(403, 진입 자체) | OI-1/OI-2/OI-8 | 기존 `ForbiddenState`/`RequirePermission` 패턴(OI-1/OI-2/OI-8은 전부 `cs:read` 게이트라 정상 경로에서는 VIEWER만 도달) |

---

## 5. 권한별 화면 요소

| 역할 | OI-1 목록 | OI-2 상세·처리 | OI-6b 되돌리기 | OI-6c IDENTITY 분리 | OI-7 시뮬레이션 | OI-8 태그 | OI-9 설정 | OI-9 식별 참조 |
|---|---|---|---|---|---|---|---|---|
| ADMIN | 조회 | 조회+전체 처리 | 항상 가능 | 가능 | 조회+실행(가능) | 조회+관리 | 조회+저장 | 조회+편집 |
| EDITOR | 조회만 | 조회만(처리 불가) | — | — | 조회+실행(가능, `simulation:write`) | 조회만(관리는 ADMIN) | 조회+저장(참여/경고) | 조회만(읽기 텍스트) |
| AGENT | 조회+처리 | 조회+처리 | 본인 병합만 24시간 이내 | 비활성+사유 | 진입 불가(`simulation:write` 없음) | 조회만(관리는 ADMIN) | 조회만 | 조회만 |
| VIEWER | 진입 불가(403) | 진입 불가 | — | — | 진입 불가 | 진입 불가 | 조회만(`chatbot:read`) | 조회만 |

- **OI-1·OI-2·OI-8은 라우트 가드가 전부 `cs:read` 하나다**(§1) — EDITOR는 `cs:write`가 없어 세 화면 모두 "조회만" 가능하고(목록·상세·태그 목록을 볼 수 있다), 담당·상태·메모·기록·연결·태그 변경 같은 쓰기 동작은 버튼 자체가 비활성/미노출로 처리된다(가드가 아니라 화면 단위 표시 제어). AGENT는 `cs:write`가 있어 OI-1·OI-2는 "조회+처리"가 되지만, OI-8은 `cs:write`만으로는 부족하고 ADMIN 역할의 서비스 재검증이 별도로 필요해 AGENT도 "조회만"에 머문다. VIEWER만 `cs:read` 자체가 없어 셋 다 `403`이다.
- OI-10(No.24 콘솔 연계)은 **기존 화면의 권한 그대로**(추가 게이트 0) — 카드 자체가 인박스 꺼짐/비참여일 때만 숨는다.
- AC-OC4-7 확인: AGENT는 조회·처리 가능하되 태그 목록 변경·식별 참조 변경은 `403`(버튼이 애초에 비활성/읽기 전용이라 정상 경로로는 도달하지 않음).

---

## 6. 상태별 화면(로딩/빈/오류) 총정리

| 화면 | 로딩 | 빈 상태 | 오류 |
|---|---|---|---|
| OI-1 목록 | `SkeletonRow`×5 | `EmptyState`(기본 필터/필터 적용 2종, §3.1) | `ErrorState` |
| OI-2 상세 | `SkeletonRow`+`SkeletonCard` | 없음(스레드는 항상 최소 1개 항목으로 열림) | `ErrorState`(404) / 배너(409) |
| OI-5 검색 | `SkeletonRow`×3 | `EmptyState`("일치하는 고객이 없습니다") | 인라인(고객 키 비밀 없음 등) |
| OI-7 시뮬레이션 | 시뮬레이터 기존 로딩 상태 재사용 | — | 시뮬레이터 기존 오류 배너 재사용 |
| OI-8 태그 | `SkeletonRow`×4 | `EmptyState`("등록된 태그가 없습니다") | `ErrorState` |
| OI-9 설정 | `SkeletonRow`×4 | 없음(항상 기본값 "꺼짐") | `ErrorState`/인라인 |

---

## 7. `messages.ts` 키 설계 (`apps/web/src/constants/messages.ts`)

### 7.1 `MESSAGES.common`(확장)

```ts
inboxNav: '통합 인박스',
```

### 7.2 신규 네임스페이스 `MESSAGES.inbox`

```ts
inbox: {
  // 목록
  title: '통합 인박스',
  myAssignedCount: (n: number) => `내 담당 ${n}건`,
  summaryOpen: '열림', summaryPending: '보류', summaryMine: '내 담당', summaryUnassigned: '담당 없음', summaryActiveHandoff: '진행 중 상담',
  emptyDefault: '볼 일이 생긴 고객이 없습니다 — 상담이 시작되거나 경고 단계에 도달하면 자동으로 나타납니다.',
  emptyFiltered: '조건에 맞는 스레드가 없습니다.',
  resetFilters: '필터 초기화',
  noParticipatingChatbots: '통합 인박스에 참여하는 챗봇이 없습니다 — 챗봇 설정에서 켤 수 있습니다.',
  goToChatbotSettings: '챗봇 설정으로 이동',
  newRecordButton: '새 고객·기록',
  newTestCustomerButton: '시험 고객',
  filterStatusLabel: '상태', filterAssigneeLabel: '담당', filterChatbotLabel: '챗봇', filterChannelLabel: '채널',
  filterTagLabel: '태그', filterKindLabel: '고객종류', filterPeriodLabel: '기간', filterIncludeTest: '시험 포함',
  searchPlaceholder: '이름 · 별칭 · 회원번호',
  columnCustomer: '고객', columnStatus: '상태', columnAssignee: '담당', columnTags: '태그',
  columnLastChannel: '최근채널/챗봇', columnConversations: '대화', columnHandoffs: '상담', columnLastActivity: '마지막활동', columnPreview: '미리보기',
  noParticipatingChatbotBadge: '참여 챗봇 없음',

  // 배지
  kindIdentified: '식별 회원', kindAnonymous: '익명', kindTest: '시험 고객',
  statusOpen: '열림', statusPending: (at: string) => `보류(해제 예정 ${at})`, statusPendingExpired: '보류(곧 열림)', statusClosed: '종료',
  statusPendingStaleHint: '보류 해제 시각 지남 — 다음 변경 시 자동 반영',
  channelSimulated: (label: string) => `시뮬레이션 · ${label}(가상)`,

  // 상세
  breadcrumb: (name: string) => `인박스 > ${name}`,
  activeHandoffBanner: (n: number) => `진행 중 상담 ${n}건`,
  goToConsole: '상담 콘솔로 이동',
  hiddenByMergeBanner: (name: string) => `이 스레드는 다른 고객과 합쳐졌습니다 → ${name} 스레드로 이동`,
  noParticipatingChatbotThread: '참여 챗봇 대화가 없습니다(수동 기록만 표시).',
  conflictBanner: '다른 사람이 먼저 바꿨습니다 — 새로 불러옵니다.',
  purgedEntryNotice: '(보존기간 경과로 삭제됨)',
  loadMoreTimeline: '더 보기',
  cardConversations: (total: number) => `대화 ${total}건`,
  cardFirstActivity: '첫 활동', cardLastActivity: '마지막 활동',
  cardTopMatches: '최근 의도', cardDeletedItem: '(삭제된 항목)',
  cardUnanswered: (n: number) => `미응답 ${n}건`,
  cardHandoffs: (n: number, reason?: string, agent?: string) => (n === 0 ? '상담 이력 없음' : `상담 ${n}건${reason ? `(${reason}${agent ? `, 마지막 상담원 ${agent}` : ''})` : ''}`),
  cardSurveys: (n: number) => `설문 완료 ${n}건`, cardNegativeFeedback: (n: number) => `부정평가 ${n}건`,
  cardLatestNote: '최근 메모',

  // 동작 패널
  actionsTitle: '동작', statusLabel: '상태', snoozeUntilLabel: '해제',
  claimButton: '가져가기', assignLabel: '담당', releaseButton: '놓기',
  releaseDisabledReason: '담당자만 놓을 수 있어요', assigneeInactiveBadge: '비활성',
  addNoteButton: '메모 작성', addRecordButton: '수동 기록',
  linkOtherConversationButton: '다른 대화 연결', mergeButton: '병합',
  linkedConversationsTitle: '연결된 대화',
  unlinkButton: '분리', unlinkDisabledReasonNonAdmin: '관리자만 해제할 수 있어요',
  unlinkIdentityConfirmTitle: '이 회원 연결을 강제로 해제할까요?',
  unlinkIdentityConfirmDesc: '이 대화는 서버가 서명을 확인해 자동으로 연결한 것입니다. 강제로 해제하면 이 세션은 새 익명 고객이 되고, 이후 이 세션에서 오는 로그인 정보는 무시됩니다. 이 동작은 대부분의 경우 필요하지 않으며, 토큰 오발급·재사용이 의심될 때만 사용하세요.',
  forceUnlinkConfirmButton: '강제로 해제',
  claimConflictBanner: '방금 다른 상담원이 가져갔습니다.',
  statusChangedAnnounce: '기록이 저장되었습니다. 상태가 열림으로 바뀌었습니다.',

  // 수동 기록
  recordChannelLabel: '기록 채널', recordChannelPhone: '전화', recordChannelEmail: '이메일', recordChannelVisit: '방문', recordChannelOther: '기타',
  recordDirectionLabel: '방향', recordDirectionInbound: '고객이 연락', recordDirectionOutbound: '우리가 연락',
  recordOccurredAtLabel: '발생 시각', recordOccurredAtHint: '오늘부터 최대 7일 전까지',
  recordOccurredAtRangeError: '발생 시각은 오늘부터 최대 7일 전까지만 입력할 수 있습니다.',
  recordSummaryLabel: '요약', recordOutcomeLabel: '결과', recordOutcomeResolved: '해결', recordOutcomeFollowUp: '후속 필요', recordOutcomeNone: '선택 안 함',
  recordSave: '저장',

  // 메모
  noteLabel: '메모', noteSave: '저장', noteEditButton: '수정',
  noteEditExpiredHint: '작성 후 10분이 지나 수정할 수 없습니다.',
  maskPreviewLabel: '미리보기 보기', maskPreviewNoChangeHint: '(가려질 부분 없음)', maskPreviewChangedHint: '개인정보는 가려져 저장됩니다.',

  // 검색·연결
  searchModalTitle: '고객에 연결', searchTabName: '이름 · 별칭', searchTabMemberId: '회원 번호',
  searchEmptyPrompt: '검색어를 입력하세요', searchEmptyResult: '일치하는 고객이 없습니다.',
  memberIdSecretMissing: '서버에 고객 키 비밀이 설정되지 않아 회원 번호로 찾을 수 없습니다.',
  memberIdSpaceLabel: '식별 공간', memberIdInputLabel: '회원 번호', memberIdRevealToggle: '표시 전환',
  memberIdNotStoredHint: '입력한 값은 저장되지 않습니다(해시로만 대조).',
  linkButton: '연결', linkLockedError: '이 대화는 이미 다른 회원으로 확인되어 있어 연결할 수 없습니다.',
  sessionLinkChatbotLabel: '챗봇', sessionLinkSessionRefLabel: '세션 참조', sessionLinkSubmit: '확인',
  sessionRefNotFoundError: '이 챗봇에서 해당 세션을 찾을 수 없습니다(최근 24시간 대화만 연결할 수 있습니다).',

  // 병합
  mergeSelectButton: '병합 대상으로 선택',
  mergeConfirmTitle: '고객을 합칠까요?',
  mergeConfirmDesc: (source: string, target: string) => `익명 고객 ${source}를 ${target}에 합칩니다. 대화·메모·기록이 ${target}의 스레드로 옮겨집니다. 잘못 합쳤다면 24시간 안에 되돌릴 수 있습니다.`,
  mergeConfirmButton: '합치기',
  mergeForbiddenIdentity: '서로 다른 로그인 회원은 합칠 수 없습니다 — 회원 정보가 잘못됐다면 고객사 시스템을 확인하세요.',
  mergeForbiddenTest: '시험 고객은 실제 고객과 합칠 수 없습니다.',
  mergeForbiddenPurged: '이미 개인정보가 삭제된 고객과는 합칠 수 없습니다.',
  revertButton: '되돌리기',
  revertDisabledReasonAdminOnly: '관리자만 되돌릴 수 있어요',
  revertDisabledReasonExpired: '되돌릴 수 있는 시간(24시간)이 지났어요',
  revertConfirmTitle: '병합을 되돌릴까요?', revertConfirmDesc: '옮겨진 대화·메모·태그가 원래 고객으로 돌아갑니다.',
  revertNotRevertibleError: '이미 되돌려졌거나, 그 뒤 다시 합쳐져 지금은 되돌릴 수 없습니다.',

  // 태그
  tagAddButton: '+ 추가', tagManageLink: '태그 관리', tagLimitError: '태그는 최대 10개까지 붙일 수 있습니다.',

  // 시뮬레이션
  simulationTitle: (label: string) => `시뮬레이션 — ${label}(가상)`,
  simulationChatbotLabel: '챗봇', simulationChannelLabel: '가상 채널', simulationBadge: '시뮬레이션',
  simulationNotRealNotice: '이 대화는 실제 고객·통계·학습에 반영되지 않습니다.',
  simulationRefreshResetNotice: '새로고침하면 대화가 처음부터 시작됩니다.',
  newTestCustomerLabel: '시험 고객 이름(구분용)', createTestCustomer: '만들기',
  deleteTestCustomerButton: '시험 고객 삭제', deleteTestCustomerConfirmDesc: '시험 고객과 시뮬레이션 기록이 모두 삭제됩니다.',

  // 세션 연계(No.24)
  linkToCustomerButton: '고객에 연결',
  openThreadButton: '스레드 열기', goToThreadButton: '스레드 열기',
  sessionCardConversations: (n: number) => `대화 ${n}건`,
} as const,
```

### 7.3 신규 네임스페이스 `MESSAGES.inboxSettings`

```ts
inboxSettings: {
  tabLabel: '통합 인박스',
  outsideEnvironmentNotice: '이 설정은 환경 분리 대상이 아닙니다 — 저장 즉시 운영에 적용됩니다(다른 서버는 최대 30초).',
  participationLabel: '통합 인박스 참여', openOnWarningLabel: '경고 단계 도달 시 스레드 열기',
  identitySectionTitle: '식별 연동(고객사 로그인 회원 자동 통합)',
  identitySecretRefLabel: '식별 비밀 참조', identitySecretRefAdminOnlyHint: '관리자만 편집 가능',
  identitySecretRefFormatError: '영문 대문자·숫자·밑줄만, 최대 40자',
  secretStatusNotSet: '미지정', secretStatusMissing: '없음(서버 설정 필요)', secretStatusWeak: '약함(서버 설정 확인 필요)', secretStatusConfigured: '설정됨',
  customerKeyStatusLabel: '고객 키 비밀',
  fingerprintChangedWarning: '최근 서버 재시작 이후 지문이 바뀐 것으로 보입니다 — 비밀이 교체된 경우 이전 고객과 새 대화가 연결되지 않습니다.',
  stats24hTitle: '최근 24시간 식별 현황(이 서버 기준)',
  statVerified: '성공', statSignature: '서명불일치', statExpired: '만료', statMalformed: '형식오류',
  statConflict: '충돌', statSecretMissing: '비밀없음', statTtlTooLong: '수명초과', statNotYetValid: '유효시작전',
  sharedSpaceHint: (chatbots: string) => `같은 참조를 쓰는 다른 챗봇: ${chatbots}`,
  archivedSaveError: '보관된 챗봇은 설정을 바꿀 수 없습니다.',
  integrationGuideLink: '연동 방법 안내 보기',
  save: '저장',
} as const,
```

### 7.4 신규 네임스페이스 `MESSAGES.inboxTags`

```ts
inboxTags: {
  title: '태그 관리', addButton: '+ 태그 추가', nameLabel: '이름', colorLabel: '색',
  usageCount: (n: number) => `${n}건 스레드`, editButton: '수정', deleteButton: '삭제',
  deleteInUseConfirmDesc: (name: string, n: number) => `"${name}" 태그는 ${n}개 스레드에서 쓰이고 있습니다. 삭제하면 모든 스레드에서 제거됩니다.`,
  duplicateNameError: '이미 사용 중인 태그 이름입니다.', limitExceededError: '전역 태그는 최대 100개입니다.',
  empty: '등록된 태그가 없습니다.',
} as const,
```

### 7.5 `MESSAGES.channels`(확장 1건)

```ts
configOnlyNoticeSimulationAddendum: ' 실제 연동은 준비 중이며, 통합 인박스에서는 시뮬레이션으로 흐름을 시험할 수 있습니다.',
```

### 7.6 `MESSAGES.dataGovernance.map`(확장)

```ts
inboxCardTitle: '통합 인박스',
inboxCustomersLine: (total: number, identified: number, anon: number) => `고객: ${total}명(식별 ${identified} · 익명 ${anon})`,
inboxThreadsLine: (threads: number, entries: number) => `스레드 ${threads}개 · 기록/메모 ${entries}건`,
inboxIdentityLine: '식별 정보: 해시만 저장(회원 번호 원문 없음)',
inboxDisplayNameEncrypted: (on: boolean) => `표시 이름 암호화: ${on ? '켜짐' : '꺼짐'}`,
```

### 7.7 `MESSAGES.dataGovernance.retention`(확장 라벨 2)

```ts
kindInboxText: '인박스 메모·기록',
kindCustomerIdentity: '고객 식별 정보(해시·표시 이름)',
kindCustomerIdentityGlobalOnlyHint: '전역만(챗봇별 재정의 없음)',
```

---

## 8. `UIUX_준수기준.md` 체크리스트 매핑

### 8.1 공통(이 그룹 신규/확장 화면 전체)

| 항목 | 반영 |
|---|---|
| §1 색상 단독 금지 | 모든 배지(§2.2)가 아이콘+텍스트 병행. 제안-자산 시각적 분리 패턴은 이 그룹에 해당 사례 없음(승인 대기 개념 없음) |
| §1 민감정보 열람 토글 | 회원 번호 입력(마스킹 기본+표시 전환, §3.5), IDENTITY 강제 분리(§3.6c)는 "위험 동작 고지" 원칙을 준용(원문 열람은 아니지만 같은 확인 강도 적용) |
| §2 타이포그래피 | 기존 디자인 토큰(본문 16px 이상) 그대로 |
| §3 키보드 접근성 | 목록·타임라인 키보드 이동(행 `<Link>`/`<button>`), 모달 포커스 트랩(`ConfirmDialog`/`Modal` 재사용), 태그 셀렉트/색 셀렉트 방향키 |
| §4 버튼 | 전부 동사형("가져가기"·"합치기"·"강제로 해제") · 중복 클릭 방지(저장류 버튼 `disabled` 중 재클릭 차단) · 터치 영역 44×44px(모바일 카드 리스트 버튼) |
| §5 텍스트 입력 | 메모·기록 텍스트영역 레이블 필수 + 글자 수 실시간 표시(§3.3·§3.4) |
| §6 폼 컨트롤 | 기록 채널·방향=라디오(단일 선택) · 태그=체크박스(다중) · 색=팔레트 셀렉트(20개 이하 아님, 8색뿐이라 셀렉트 적합) · 필수 `*` 표시 · 기본값 미리 선택 안 함(§3.3) |
| §7 오류 메시지 | 전 폼 인라인(제출 시점) — §4.7 표 |
| §8 로딩/폴링 | OI-1·OI-2 폴링(10초/화면표시중) — 스크롤·포커스 유지, 새 항목 `aria-live` 1회, 30초 연속 실패 배너(`PollingStaleBanner` 패턴). 시뮬레이션은 시뮬레이터 기존 비동기 대기 패턴 재사용 |
| §9 내비게이션 | 건너뛰기 링크는 `TopBar` 공통 적용 유지, OI-1 페이지네이션(있다면 `Pagination` 재사용) |

### 8.2 화면별 세부

| 화면 | 항목 | 세부 |
|---|---|---|
| OI-1 | §8 폴링 | 스크롤 위치 유지 확인 대상(목록 갱신 시 선택된 필터·스크롤 보존) |
| OI-2 | §1 색상 단독 금지 | 상태 배지(열림/보류/종료) 색+아이콘+텍스트 |
| OI-2 타임라인 | §8 대화 로그 안 보조 버튼 | 되돌리기 버튼은 새 DOM을 추가하지 않고 기존 시스템 항목 옆에 고정 배치(폴링 갱신 시 재생성 방지 — key를 항목 id로 고정) |
| OI-3/4 | §5·§6·§7 | 텍스트영역 레이블·글자수, 라디오, 제출 시점 검증 |
| OI-5 | §1 민감정보 | 회원 번호 마스킹 기본값 + 전환 토글 |
| OI-6c | §4 버튼 | 위험 동작 확인 문구(고지 강화) |
| OI-7 | NFR-OCA3(시뮬레이션 라벨) | 모든 말풍선 텍스트 라벨 병기(색만 아님) |
| OI-9 | §6 폼 | 식별 비밀 참조 정규식 인라인 오류, 스위치는 온/오프 텍스트 병기 |

---

## 9. 반응형 고려사항

- **분기점**: `<640px`(모바일 카드 전환, `LiveSessionTable` 기준값 재사용) · `<768px`(OI-2 2열→세로 스택).
- **OI-1**: 데스크톱 표 ↔ 모바일 카드 리스트(`InboxThreadTable` 이중 렌더). 필터바는 모바일에서 접이식(펼치기 버튼)으로 전환해 화면 상단을 필터가 다 차지하지 않게 한다.
- **OI-2**: 데스크톱 2열(고객카드+동작 / 타임라인) → 모바일 세로 1열, 고객 카드는 아코디언으로 기본 접힘(타임라인을 먼저 보여줌 — 상담원이 최근 대화부터 확인하는 빈도가 높다는 가정, §12 D-4).
- **OI-7 시뮬레이션**: 기존 시뮬레이터 패널의 반응형 규칙을 그대로 상속(`SimulatorDrawer`류가 아니라 인라인 패널이므로 별도 드로어 전환 없음).
- **OI-9**: 폼은 항상 1열(설정 폼은 원래도 좁은 폭).
- 위젯(`apps/widget`) 자체의 반응형은 이 그룹으로 인한 변경이 없다(화면 요소 추가 0, §3.13).

---

## 10. Out of scope / 재검토 트리거

요구사항 §9 표를 그대로 따른다(이 문서는 화면을 추가하지 않는다): 카카오톡 등 실채널 UI(2차 어댑터+웹훅 화면), 인박스 통계(채널별 처리시간 — 2차 No.29 확장), 자동 배정·SLA·대기열 UI, 위젯 "지난 대화 복원" 화면, 연락처 기반 병합 "제안" UI(2차 — 지금은 상담원이 검색으로 직접 찾는다), 고객 단위 정보주체 파기 요청 화면(No.45 2차), CRM 프로필 화면(No.39).

---

## 11. 다음 단계 인계 (`frontend-implementer`)

1. shared-types 빌드 확인 후(`inbox.ts` 등) `apps/web`에서 타입 가져오기.
2. §2.3 신규 컴포넌트를 `components/inbox/**`에 우선 구현(배지 → 목록 → 상세 → 폼 → 모달 순 권장 — 목록·상세가 나머지 폼의 컨테이너이므로).
3. `App.tsx`에 `/inbox`·`/inbox/:threadId`·`/inbox/tags` 라우트 추가(핸들러 인계 §2.2 컨트롤러 5개와 매핑), `SettingsTab.tsx`에 `section=inbox` 분기 추가.
4. `TopBar.tsx`·`SettingsTab.tsx`·`ChannelsTab`/`PlaceholderChannelForm.tsx`·`LiveSessionDetailPage.tsx`·`TranscriptPanel.tsx`·`HandoffHistoryDetailPage.tsx`·`DataGovernanceMapPage.tsx`·`DataGovernanceRetentionPage.tsx`는 **기존 파일에 조각만 추가**한다(신규 파일 아님) — 각 파일의 기존 테스트가 깨지지 않아야 한다(설계서 §19 회귀 불변 원칙을 화면단에서도 지킨다).
5. `messages.ts`에 §7 키 전부 추가(문자열은 이 문서를 그대로 반영 — 별도 카피라이팅 재작업 불필요).
6. 위젯 쪽(§3.13)은 콘솔과 독립적으로 진행 가능(계약이 헤더 1개·스토리지 키 1개로 작음) — `apps/widget/src/constants/identity.ts`·`core/identity-storage.ts` 신설은 설계서 §2.5 표를 그대로 따른다.
7. 접근성 자동 시험(`*.a11y.spec.tsx`)은 기존 `HandoffChatbotPickerPage.a11y.spec.tsx` 등 패턴을 따라 OI-1·OI-2에 최소 1개씩 작성.

---

## 12. 설계서와 다르게 판단했거나 설계서에 없어 가정한 사항 (ui-designer 판단 기록)

| # | 내용 | 판단 |
|---|---|---|
| D-1 | 전역 태그 관리(OI-8)의 배치 — `SystemSettingsMenu`(보안 설정류) vs 인박스 안 | 설계서 §20-8은 "태그 관리(ADMIN)"라고만 함. `cs:read`/`cs:write` 도메인이라 보안 메뉴가 아니라 **인박스 화면 안**(`/inbox/tags`, OI-1 필터바에서 진입)에 둔다 — 태그는 인박스 전용 자원이라 시스템 설정과 성격이 다름 |
| D-2 | 통합 인박스 진입점 위치 — 설계서 §20-1은 "전역 메뉴"라고만 함 | `TopBar`의 "모니터링" 옆(같은 `cs:read` 게이트, 같은 시선 높이)에 배치. `SystemSettingsMenu`에 넣지 않음(그 메뉴는 `security:read` 계열 항목 위주) |
| D-3 | IDENTITY 강제 분리(§3.6c)에 대한 추가 확인 모달 | PM이 R-11(ADMIN 전용)을 이미 확정했지만, 되돌릴 수 없는 부작용(재생 토큰 영구 무시)이 커서 ui-designer가 확인 모달 1단계를 추가함(권한 확정과 UX 확인 단계는 별개 사안으로 판단) |
| D-4 | OI-2 모바일에서 고객 카드를 기본 접힘으로 둠 | 설계서에 지정 없음 — 상담원이 통화 중 빠르게 이전 이력을 참고하는 시나리오(S-2)를 볼 때 타임라인 우선 노출이 유리하다고 판단(가정, 사용성 시험 필요 시 재조정) |
| D-5 | "다른 대화 연결"을 자동완성 없는 텍스트 입력(`sessionRef`)으로 설계 | 설계서 §7.2는 API만 정의하고 UI 검색 수단을 지정하지 않음. 세션을 찾는 별도 목록 API가 없어(설계상 의도 — 성능/최근 24시간 제한) 상담원이 다른 화면에서 본 `sessionRef`를 붙여넣는 흐름으로 가정 |
| D-6 | OI-9 참여/경고 저장과 식별 참조 저장을 **버튼 2개로 분리** | 권한이 다르므로(`chatbot:write` vs `security:write`) 한 버튼으로 묶으면 EDITOR가 "저장"을 눌렀을 때 식별 참조 변경분이 조용히 무시되는 것처럼 보일 위험이 있어 분리 |
| D-7 | 병합 확인 모달을 `danger=false`(중립 톤)로 지정 | 병합은 24시간 내 되돌릴 수 있는 동작이라(설계서 §7.5) 완전 파괴적 톤(빨강)까지는 과하다고 판단 — 단 버튼 라벨은 명시적으로 유지 |

---

## 13. 사용자 확인이 필요한 UX 선택

설계서·요구사항의 P-1~P-12·R-1~R-21은 2026-09-26 PM이 전부 추천안으로 확정했고(§0), R-11(IDENTITY 분리 ADMIN 전용)도 명시적으로 확정됐다. 이 화면 설계서 자체가 새로 여는 UX 결정은 다음 2건이며, **현재는 ui-designer 판단(§12 D-2·D-3)으로 진행**하되 frontend-implementer 착수 전 최종 확인을 권고한다:

1. **통합 인박스 TopBar 배치(D-2)** — "모니터링" 옆에 나란히 둘지, 혹은 두 화면을 언젠가 통합할 계획이 있다면 지금부터 하나의 진입점(예: "상담" 드롭다운 아래 "모니터링"/"통합 인박스" 2개 하위 항목)으로 둘지. 지금은 전자(나란히 링크 2개)로 진행.
2. **IDENTITY 강제 분리 확인 모달(D-3)** — 권한(ADMIN 전용)은 이미 확정됐으나, 확인 모달의 문구 강도(위 §3.6c 문구)가 실제 운영에서 과한 마찰인지(토큰 재생 대응이 드문 빈도의 응급 조치라면 문구를 더 짧게 줄일 수도 있음)는 실사용 피드백 후 조정 여지를 남긴다.

---

## 14. 변경 이력

| 날짜 | 내용 |
|---|---|
| 2026-09-26 | 최초 작성(§0~§13) |
| 2026-09-26(정정) | §1·§5·§3.8 — EDITOR/AGENT의 OI-1·OI-2·OI-8 권한 표기를 실제 구현(`/inbox/tags` 전체가 `cs:read` 단일 게이트)에 맞춰 정정: EDITOR "진입 불가(403)" → "조회만"(OI-1·OI-2), AGENT·EDITOR의 OI-8 "진입 가능(읽기만)" → "조회만(관리는 ADMIN)"으로 통일해 §1의 "OI-8 조회 `cs:read`"와의 모순을 해소. §3.6b — 되돌리기 버튼 노출 규칙이 클라이언트에서 사전 판정되는 근거(타임라인 SYSTEM 항목 `meta.mergedByUserId`/`mergedAt`/`mergeKind` + `INBOX_LIMITS`의 24h)를 1줄 추가(최종 판정은 여전히 서버 재검증). 이후 같은 날 기한 출처를 상세 응답 `mergeRevertHours`(서버 설정값)로 정정. |
