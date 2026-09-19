# 챗봇 운영관리 (No.1~4) — 화면 설계서

> **대상 기능**: No.1 챗봇 리스트/그룹 관리, No.2 대시보드, No.3 챗봇 기본설정, No.4 스킨/임베드 설정
> **입력 문서**: `docs/requirements/chatbot-operations.md`(FR/AC/EX), `docs/02-spec/chatbot-operations-설계.md`(§4 스키마, §5 API, §7 로직, §9 프런트 제약), `docs/02-spec/decisions/ADR-0001`, `ADR-0004`
> **준수 기준**: `docs/03-design/UIUX_준수기준.md`(전 항목)
> **작성**: ui-designer · 2026-09-19 · **다음 단계**: `backend-implementer` → `frontend-implementer`
> **범위 경계**: 실제 React 컴포넌트 코드는 작성하지 않는다. 여기서 정의한 화면/컴포넌트/상태/문구는 `frontend-implementer`가 그대로 구현 기준으로 삼는다.

---

## 0. 전제와 연계 확인

- 탭 3종(`dashboard`/`settings`/`skin`)은 **URL 세그먼트**로 구성한다(설계서 §9). 스킨/임베드는 하나의 라우트(`/skin`)에 스킨 설정과 임베드 코드 두 섹션을 담고, 그 안의 전환은 **클라이언트 상태 하위 탭**(URL 세그먼트 아님)으로 처리한다. 이유는 §3.5 참고.
- `DashboardSummarySchema`는 설계서 §4.3 변경분(`totalLogCount`, `visitCountBasis`)을 반영한 **미래 스키마**를 기준으로 설계한다. 현재 `packages/shared-types/src/stats.ts`에는 아직 반영되어 있지 않으므로 `backend-implementer`가 스키마를 갱신한 뒤 본 문서 기준으로 프런트를 구현해야 한다.
- **`apps/web/src/api/client.ts`는 현재 오류 응답 본문을 파싱하지 않는다.** 이 문서가 요구하는 필드별 인라인 오류(§6), 오류 코드 분기(§6.2), 409/400 안내 문구는 모두 `ApiErrorSchema({ statusCode, code, message, details? })` 파싱을 전제로 한다. `frontend-implementer`는 착수 즉시 `apiClient`를 확장해야 하며, 이를 빠뜨리면 이 문서의 AC-5-2, FR-3-10, FR-1-5 등 다수 요구사항을 화면에서 구현할 수 없다. (설계서 §9 "프런트엔드 인계 제약" 표와 동일 지적)
- UI 문구는 전부 `apps/web/src/constants/messages.ts`에 상수로 모은다(FR-0-8). 본 문서에 등장하는 모든 따옴표 문구는 그 상수의 **값 초안**으로 취급한다.

---

## 1. 화면 목록 및 라우트

| ID | 화면명 | 라우트 | 진입 경로 |
|---|---|---|---|
| S1 | 그룹/챗봇 목록 | `/chatbots` | TopBar "챗봇 목록", 홈(`/`)에서 링크, 임의 화면에서 뒤로가기 |
| S2 | 챗봇 상세 — 대시보드 탭 | `/chatbots/:chatbotId/dashboard` | S1 행 액션 "대시보드", 챗봇 생성 후 자동 이동하지 않음(생성 직후는 설정 탭으로 이동) |
| S3 | 챗봇 상세 — 기본설정 탭 | `/chatbots/:chatbotId/settings` | S1 행 액션 "설정", 챗봇 생성 직후 자동 이동(S-1 시나리오), 상세 탭 내 이동 |
| S4 | 챗봇 상세 — 스킨/임베드 탭 | `/chatbots/:chatbotId/skin` | S1 행 액션 "스킨·임베드", 대시보드 빈 상태의 "임베드 설정 바로가기" 링크 |
| — | 챗봇 상세 공통 셸(헤더+탭바) | `/chatbots/:chatbotId/*` | 위 3개 라우트의 공통 레이아웃. `/chatbots/:chatbotId`(탭 없음)로 접근 시 `/dashboard`로 리다이렉트 |

라우트 보강 원칙(권장, 강제 아님): 목록 화면의 필터 상태(`groupId`, `status`, `q`, `sort`, `order`, `page`)는 쿼리스트링에 반영해 새로고침·공유 링크·뒤로가기가 동작하게 한다. 예: `/chatbots?groupId=g1&status=ACTIVE,DRAFT&q=주문&page=1`.

---

## 2. 공통 UI 요소

### 2.1 상태 배지 (`StatusBadge`)

색상 단독 전달 금지(UIUX §1) — 색상 + 아이콘 + 텍스트 레이블을 항상 병기한다.

| status | 레이블 | 배경/텍스트(예시 토큰) | 아이콘 |
|---|---|---|---|
| `DRAFT` | "초안" | 배경 `#F3F4F6` / 텍스트 `#374151`(대비 약 8.3:1) | 연필 |
| `ACTIVE` | "운영중" | 배경 `#DCFCE7` / 텍스트 `#166534`(대비 약 6.4:1) | 체크원 |
| `ARCHIVED` | "보관됨" | 배경 `#FEF3C7` / 텍스트 `#92400E`(대비 약 5.9:1) | 보관함 |

- props: `{ status: ChatbotStatus; size?: 'sm' | 'md' }`
- 배지 자체는 상호작용 요소가 아니다(버튼 아님). 상태 변경은 상세 화면 헤더의 별도 컨트롤에서 수행.

### 2.2 모달 (`Modal` / `ConfirmDialog`)

- 열릴 때 포커스는 모달 내부 첫 상호작용 요소(보통 첫 입력 필드 또는 취소 버튼)로 이동, 닫히면 트리거 버튼으로 복귀(UIUX §3, AC-5-5).
- `Esc` 키로 닫힘(파괴적 동작 진행 중이 아닐 때), 배경 클릭으로도 닫힘. 포커스 트랩: Tab이 모달 밖으로 빠져나가지 않음.
- 파괴적 액션(삭제/영구삭제/기본값 되돌리기)은 `ConfirmDialog(danger=true)`를 사용하며, 기본 포커스는 **취소** 버튼에 둔다(오조작 방지).
- props(`ConfirmDialog`): `{ isOpen, title, description, confirmLabel, cancelLabel, danger?, onConfirm, onCancel, confirmDisabled? }`

### 2.3 오류/토스트/스켈레톤

| 컴포넌트 | 용도 | 규칙 |
|---|---|---|
| `Toast` | 성공/일반 안내 | 3~4초 자동 소멸, 스크린리더용 `aria-live="polite"` |
| `InlineFieldError` | 폼 필드 인라인 오류 | 필드 하단에 원인+해결방법 문구, 빨강 텍스트 + 경고 아이콘(대비 4.5:1), `aria-describedby`로 입력과 연결(UIUX §7) |
| `SkeletonCard` / `SkeletonRow` | 로딩 중 표시 | 최소 200ms 이상 유지해 깜빡임 방지, 실제 데이터로 즉시 교체 |
| `EmptyState` | 데이터 없음(오류 아님) | 중립 색(회색/파랑 계열), 안내문 + 다음 행동 버튼/링크. **빨강 사용 금지**(FR-2-10, AC-2-6) |
| `ErrorState` | 실제 조회 실패(5xx/503) | `EmptyState`와 시각적으로 구분되는 경고색 + "다시 시도" 버튼 |

### 2.4 오류 인라인 표시 공통 규칙 (NFR-A6, AC-5-2)

1. 제출(저장/생성/복사/삭제 확인) 시점에만 검증 오류를 표시한다. 입력 중/포커스 이동만으로 오류를 띄우지 않는다(UIUX §7).
2. `ApiErrorSchema.details[].field`가 있으면 해당 `id`의 필드 하단에 `message`를 그대로 표시한다.
3. `details`가 없는 오류(예: 409 `GROUP_NOT_EMPTY`, 503 `AGGREGATION_TIMEOUT`)는 폼/모달 상단 배너 또는 `Toast`로 표시한다.
4. 필드 오류 문구는 원인만이 아니라 **해결 방법**을 포함한다. 예: "이미 사용 중인 고유 URL입니다. 다른 값을 입력해 주세요."(서버 메시지 그대로 사용 가능하도록 API 메시지 자체가 이 형식을 따름 — 설계서 §5.4)

---

## 3. 화면별 설계

## 3.1 S1 — 그룹/챗봇 목록 (`/chatbots`)

### 목적
그룹 단위로 챗봇을 탐색·생성·복사·이동·보관·영구삭제한다. 이 그룹의 진입점이자 모든 후속 화면(S2~S4)의 출발점.

### 레이아웃 (데스크톱, ASCII)

```
┌───────────────────────────────────────────────────────────────────────────┐
│ TopBar: Chat Bot | 챗봇 목록                                                │
├───────────────┬───────────────────────────────────────────────────────────┤
│ [그룹]         │  검색 [__________]  상태 ☑초안 ☑운영중 ☐보관됨   정렬[수정일▾]│
│ + 그룹 추가     │                                          [+ 챗봇 만들기]  │
│               ├───────────────────────────────────────────────────────────┤
│ ▣ 전체 (12)    │  아바타 이름          slug          상태     그룹   수정일시  액션 │
│ ▢ 고객지원(8) ⋮ │  [AB] 주문 상담봇     order-bot     ●운영중  고객지원 09-18  ⋮  │
│ ▢ 마케팅(3)  ⋮ │  [OB] 환불 상담봇     refund-bot    ○초안    고객지원 09-17  ⋮  │
│ ▢ 테스트(0)  ⋮ │  ...                                                       │
│               │                                          ◀ 1 2 3 ▶         │
└───────────────┴───────────────────────────────────────────────────────────┘
```

빈 상태(그룹 0개, EX-1-5):
```
좌측 트리: "그룹이 없습니다. 그룹을 먼저 만들어 주세요." + [+ 그룹 추가]
우상단 "+ 챗봇 만들기" 버튼: 비활성(disabled) + 툴팁 "그룹을 먼저 만들어야 챗봇을 생성할 수 있습니다."
```

빈 상태(그룹은 있으나 챗봇 0개 / 검색결과 0건):
```
본문 영역: EmptyState "아직 챗봇이 없습니다." / "검색 결과가 없습니다." + [+ 챗봇 만들기] 또는 [검색 초기화]
```

### 컴포넌트 분해

| 컴포넌트 | props / 데이터 바인딩 | 비고 |
|---|---|---|
| `GroupTree` | `groups: ChatbotGroupWithCountSchema[]`(`id,name,description?,chatbotCount,createdAt,updatedAt`), `selectedGroupId?`, `onSelect(groupId?)` | 최상단 "전체" 고정 항목(= `groupId` 미지정 필터). `chatbotCount`를 트리 항목 우측 배지로 표시 |
| `GroupTreeItem` | `group`, `selected`, `onEdit`, `onCopy`, `onDelete` | 각 항목에 kebab 메뉴 버튼(`⋮`, `aria-label="{그룹명} 그룹 관리"`) — Tab/Enter로 접근, 메뉴 내 "이름 수정" · "그룹 복사" · "그룹 삭제" |
| `CreateGroupModal` | 필드: `name`(필수,1~100), `description`(선택,500) | 동일 이름 그룹 존재 시 서버 응답과 무관하게 **차단하지 않는 안내**("같은 이름의 그룹이 있습니다") — 제출 전 클라이언트가 기존 목록과 대조해 실시간 표시(FR-1-6) |
| `EditGroupModal` | `PATCH` 대상: `name?`, `description?` | 동일 폼, "삭제" 버튼 없음(별도 액션) |
| `CopyGroupModal` | 원본 `group`, `name?`(기본값 `{원본명} (사본)` 미리 채움, 수정 가능) | 안내 문구: "그룹에 속한 챗봇 {n}개가 함께 복제됩니다. 대화설계 등 하위 데이터는 복제되지 않습니다." |
| `DeleteGroupConfirmDialog` | `group` | 빈 그룹(0건)만 실제 삭제 진행. 409 응답 시 §3.1 하단 참고 |
| `ChatbotFilterBar` | `q`, `status: ('DRAFT'\|'ACTIVE'\|'ARCHIVED')[]`, `sort`, `order`, `onChange` | 검색은 300ms 디바운스. 상태는 체크박스 3개(초안/운영중/보관됨) — **"보관됨" 체크 = FR-1-10의 "보관됨 포함" 토글**을 겸함. 기본값: 초안✓ 운영중✓ 보관됨☐ |
| `SortSelect` | `sort: 'createdAt'\|'updatedAt'\|'name'`, `order: 'asc'\|'desc'` | 셀렉트 값 변경 시 **자동 제출 아님** — 별도 상태이나 목록은 fetch 트리거(단, "자동 제출 금지"는 폼 submit 의미이며 필터 변경에 의한 재조회는 허용, UIUX §6 취지는 값 변경만으로 페이지 이동/폼 제출을 막는 것) |
| `ChatbotTable`(데스크톱) / `ChatbotCardList`(모바일, §8) | `items: ChatbotListItemSchema[]`(`id,groupId,groupName,name,avatarUrl?,slug,status,skin,updatedAt`), `loading`, `onAction(type, id)` | 컬럼: 아바타(또는 이니셜), 이름, slug, 상태배지, 소속그룹명, 수정일시, 액션 |
| `ChatbotRowActions` | `chatbot`, `onAction` | 메뉴: 설정 / 스킨·임베드 / 대시보드 / 복사 / 그룹 이동 / 삭제(보관) / **영구 삭제**(status===ARCHIVED일 때만 노출) |
| `CreateChatbotModal` | 필드: `groupId`(select, 트리에서 선택된 그룹으로 사전 채움, 필수), `name`(필수), `slug`(필수, `SlugAvailabilityIndicator` 내장), `avatarUrl?`, `description?` | 저장 성공 시 `/chatbots/:id/settings`로 이동(S-1) |
| `CopyChatbotModal` | 원본 `chatbot`, `targetGroupId?`(기본 원본과 동일, 변경 가능 select) | 안내 문구(FR-1-14 고지): "이름·slug·스킨만 복제됩니다. 의도/키워드/FAQ/대화노드/채널/대화이력 등은 복제되지 않습니다." 미리보기: 새 이름/새 slug 예상값 표시(클라이언트에서 서버 규칙과 동일 로직 재현하거나, 서버가 없어도 "저장 시 자동 생성됨"으로 안내) |
| `MoveGroupModal` | `chatbot`, `targetGroupId`(select, 필수) | 대상 그룹 없음(그룹 0개) 시 비활성 + 안내 |
| `ArchiveConfirmDialog` | `chatbot` | "삭제"= 보관 처리, 문구: "보관 처리하면 목록에서 숨겨지며, 나중에 '보관됨 포함' 필터로 다시 볼 수 있습니다. 계속할까요?" |
| `PermanentDeleteModal` | `chatbot`(`ARCHIVED` 상태만 접근 가능) | §4.4 참고 |
| `Pagination` | `page,pageSize,total,onPageChange` | 현재 페이지는 배경색 + 밑줄(대비 3:1 이상)로 이중 표시(UIUX §9, NFR-A8) |

### 삭제 거부(409 `GROUP_NOT_EMPTY`) 처리 흐름 (EX-1-3, AC-1-5)
1. `DeleteGroupConfirmDialog`에서 "삭제" 클릭 → `DELETE /chatbot-groups/:id`
2. 409 응답 수신 → 모달을 닫지 않고 **모달 내부 상단**에 인라인 오류 배너 표시: "소속 챗봇 {n}개를 먼저 이동하거나 삭제해 주세요." + 링크 버튼 "챗봇 목록에서 보기"(클릭 시 모달 닫고 `GroupTree`에서 해당 그룹 선택 상태로 전환)
3. `Esc`/취소로 닫으면 그룹은 변경되지 않는다.

### 목록 상태별 UI

| 상태 | UI |
|---|---|
| 로딩 | `SkeletonRow` × pageSize(또는 최소 5행) |
| 성공(데이터 있음) | 테이블/카드 + "총 {total}건" 결과 배지(UIUX §8) |
| 성공(빈 결과) | `EmptyState`(그룹 0개 / 챗봇 0개 / 검색결과 0건 — 문구 상이) |
| 오류(네트워크/5xx) | `ErrorState` + "다시 시도" |

---

## 3.2 챗봇 상세 공통 셸 (`/chatbots/:chatbotId/*`)

S2~S4가 공유하는 헤더/탭바.

```
┌───────────────────────────────────────────────────────────────────────────┐
│ ← 목록으로   [AB] 주문 상담봇   ●운영중   고객지원 그룹   order-bot          │
│              [활성화] [보관] [초안으로 복구]   (허용되지 않는 전이는 비활성) │
├───────────────────────────────────────────────────────────────────────────┤
│  대시보드   기본설정   스킨/임베드                                          │
├───────────────────────────────────────────────────────────────────────────┤
│  (탭 콘텐츠)                                                                │
└───────────────────────────────────────────────────────────────────────────┘
```

### 컴포넌트

| 컴포넌트 | props | 비고 |
|---|---|---|
| `ChatbotDetailHeader` | `chatbot: ChatbotSchema` | 아바타(또는 이니셜), 이름, `StatusBadge`, 그룹명, slug |
| `StatusTransitionControls` | `status`, `allowedTransitions`(공용 상수 `CHATBOT_STATUS_TRANSITIONS` 참조) | 버튼 3개: "활성화"(→ACTIVE), "보관"(→ARCHIVED, `ArchiveConfirmDialog` 경유), "초안으로 복구"(→DRAFT). 허용되지 않는 전이는 `disabled` + `title`(이유) — 예: `ACTIVE`일 때 "초안으로 복구" 비활성 + "운영중 챗봇은 보관 후에만 초안으로 되돌릴 수 있습니다." |
| `TabNav` | `active: 'dashboard'\|'settings'\|'skin'`, `chatbotId` | `<nav>` + `<a href>` 기반 링크(키보드 포커스 가능, UIUX §9). 현재 탭은 밑줄+굵게(색상 단독 아님) |
| `ArchivedBanner` | `visible: status==='ARCHIVED'` | settings/skin 탭 상단에 노출: "보관된 챗봇입니다. 수정하려면 먼저 '초안으로 복구'하세요." (AC-1-12) |

라우팅 세부: `/chatbots/:chatbotId`(탭 없음) 접근 시 `/chatbots/:chatbotId/dashboard`로 리다이렉트. 존재하지 않는 `chatbotId`(404)는 셸 레벨에서 `ErrorState`("요청하신 챗봇을 찾을 수 없습니다." + 목록으로 돌아가기)로 전체 대체.

---

## 3.3 S2 — 대시보드 탭 (`/chatbots/:chatbotId/dashboard`)

### 목적
기간별 접속수/응답률/미응답률/인기질문을 요약 확인.

### 레이아웃

```
┌───────────────────────────────────────────────────────────────────────────┐
│ 기간: (●오늘 ○7일 ○30일 ○직접지정) [2026-09-13] ~ [2026-09-19]  [새로고침]  │
│                                   조회 기간 2026-09-13~09-19 · 집계 105건   │
├───────────────────┬───────────────────┬───────────────────┬───────────────┤
│ 접속수             │ 응답률             │ 미응답률            │              │
│ 105                │ 90.0%              │ 10.0%              │              │
│ 대화 세션 기준      │ 응답 성공 / 전체    │ 1 − 응답률          │              │
├───────────────────┴───────────────────┴───────────────────┴───────────────┤
│ 인기질문 TOP 5                                                              │
│ 1. 배송 조회        12건                                                    │
│ 2. 환불 절차         7건                                                    │
│ ...                                                                         │
└───────────────────────────────────────────────────────────────────────────┘
```

빈 상태(로그 0건, EX-2-1/AC-2-6):
```
접속수 0 / 응답률 0.0% / 미응답률 0.0%  (오류 색 아님, 중립 색)
인기질문 영역:
  ⓘ 아직 수집된 대화 데이터가 없습니다.
     챗봇을 배포하고 대화가 쌓이면 표시됩니다.  [임베드 설정으로 이동]
```

로딩 상태: 4개 카드 + 인기질문 리스트 전체 `SkeletonCard`/`SkeletonRow`. 배지 영역("조회 기간 · 집계 건수")은 로딩 중 숨김, 완료 시 표시(FR-2-12).

오류(503 `AGGREGATION_TIMEOUT`, EX-2-5):
```
카드 영역 전체를 ErrorState로 대체: "지금은 통계를 불러올 수 없습니다. 잠시 후 다시 시도해 주세요." [다시 시도]
(직전 정상 결과가 있었더라도 그 값을 그대로 보여주지 않는다 — 캐시 금지)
```

기간 오류(400 `INVALID_PERIOD`, EX-2-4):
```
기간 선택 컨트롤 하단에 인라인 오류: "조회 기간을 확인해 주세요(최대 366일, 시작일이 종료일보다 늦을 수 없습니다)."
카드 영역은 직전 유효 조회 결과를 유지(화면을 비우지 않음). 사용자가 기간을 고치기 전까지 재요청하지 않는다.
```

### 컴포넌트 분해

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `PeriodSelector` | `preset: 'TODAY'\|'7D'\|'30D'\|'CUSTOM'`(기본 `'7D'`), `from`, `to`, `onChange`. `CUSTOM` 선택 시 두 개 날짜 입력(`<input type="date">`, 각각 `<label>` 연결) 노출 |
| `RefreshButton` | `onClick`, `loading` | 클릭 즉시 `disabled` 처리 후 응답 도착 시 해제 — 연타 시 요청 1회만 발생(AC-2-12, UIUX §4) |
| `ResultSummaryBadge` | `periodStart`, `periodEnd`, `totalLogCount` | "조회 기간 {A}~{B} · 집계 {N}건" — 완료 상태 표시(FR-2-12) |
| `MetricCard`(공용) | `label`, `value`, `caption`, `loading` | 접속수/응답률/미응답률 3종에 재사용 |
| `VisitCountCard` | `value = visitCount`, `basis = visitCountBasis` | 캡션 분기(FR-2-1, ADR-0001): `basis==='SESSION'` → "대화 세션 기준", `basis==='LOG_COUNT'` → "세션 정보가 없어 대화 건수로 집계했습니다." |
| `ResponseRateCard` / `NoResponseRateCard` | `value: number(0~1)` → 화면 표시는 `(value*100).toFixed(1) + '%'` | 수치+레이블 병기, 색상만으로 좋고 나쁨 전달 금지(FR-2-13) |
| `TopQuestionsList` | `items: {question,count}[]`, `loading`, `isEmpty` | 순위 1~5, 각 항목 "{question} · {count}건" |
| `DashboardEmptyState` | `ctaHref = /chatbots/:id/skin` | "임베드 설정으로 이동" 버튼(§4 임베드 서브탭으로 랜딩) |
| `DashboardErrorState` | `onRetry` | 503/네트워크 오류 전용, 빨강 계열 허용(실제 오류이므로) |

### 데이터 흐름
1. 탭 진입 / 기간 프리셋 변경 / 새로고침 클릭 → `GET /stats/dashboard?chatbotId=&from=&to=&topN=5`
2. 요청 파라미터의 `from/to`는 프런트가 `PeriodSelector` 프리셋으로부터 로컬 날짜(YYYY-MM-DD, `Asia/Seoul` 기준 오늘)를 계산해 채운다. 서버는 프리셋 개념을 모른다(설계서 §7.6).
3. 응답 성공 → 카드/리스트/배지 갱신.
4. `ARCHIVED` 챗봇도 조회 가능(FR-2-11) — 이 탭에는 `ArchivedBanner`를 표시하지 않는다(대시보드는 보관 챗봇도 정상 열람 대상).

---

## 3.4 S3 — 기본설정 탭 (`/chatbots/:chatbotId/settings`)

### 목적
이름/아바타/소개/고유 URL(slug)을 편집.

### 레이아웃

```
┌───────────────────────────────────────────────────────────────────────────┐
│ (ARCHIVED일 때만) ⚠ 보관된 챗봇입니다. 수정하려면 먼저 '초안으로 복구'하세요. │
├───────────────────────────────────────────────────────────────────────────┤
│ 이름 *          [______________________]                                   │
│ 아바타 URL       [______________________]  [AB] 미리보기(이니셜 대체 가능)  │
│ 소개             [______________________________]  0/500자                 │
│                  [______________________________]                          │
│ 고유 URL(slug) * [order-bot_________]  ✔ 사용 가능                          │
│ 공개 주소        https://widget.example.com/c/order-bot   [복사]           │
├───────────────────────────────────────────────────────────────────────────┤
│                                                   [취소]  [저장]            │
└───────────────────────────────────────────────────────────────────────────┘
```

### 컴포넌트 분해

| 컴포넌트 | props / 검증 |
|---|---|
| `SettingsForm` | 초기값 `ChatbotSchema`, `onSubmit(patch: UpdateChatbotSettingsDto)` |
| `TextInputField`(이름) | `id="name"`, `<label htmlFor="name">이름 *</label>`, `required`, `maxLength=100`, 빈 문자열 제출 시 클라이언트 사전검증으로 "이름을 입력해 주세요." 즉시 차단(제출 시점) |
| `TextInputField`(아바타 URL) | `id="avatarUrl"`, 선택 항목(별표 없음), 옆에 미리보기 썸네일 — URL 비어있으면 이름 첫 글자 이니셜 아바타로 대체(FR-3-3). 이미지 로드 실패(`onError`) 시에도 이니셜로 폴백(EX-3-2), 콘솔 오류만 남기고 화면은 깨지지 않음 |
| `TextAreaField`(소개) | `id="description"`, 선택, `maxLength=500`, 우측 하단 "{입력수}/500자" 실시간 표시(UIUX §5). 500자 초과 입력 시도는 브라우저 레벨에서 막되, 붙여넣기로 501자 이상이 들어오면 카운터가 빨강으로 전환되고 저장 버튼 비활성화 |
| `SlugField` | `id="slug"`, 필수, `pattern="[a-z0-9-]+"`, `minLength=3 maxLength=50`, 입력 300~400ms 후 `GET /chatbots/slug-available?slug=&excludeChatbotId={현재id}` 호출 | `SlugAvailabilityIndicator`와 결합 |
| `SlugAvailabilityIndicator` | `status: 'idle'\|'checking'\|'available'\|'unavailable'`, `reason?`, `message` | 아이콘+텍스트: 확인 중(스피너 "확인 중…") / 사용 가능(체크 "✔ 사용 가능") / 사용 불가(경고 "✖ {message}"). 사용 불가 상태에서는 저장 버튼 비활성화(AC-3-6) |
| `PublicUrlPreview` | `url = {WIDGET_BASE_URL}/c/{slug}`(읽기 전용), `CopyButton` | 저장 성공 후 새 `slug` 기준으로 즉시 갱신(AC-3-9) |
| `SlugChangeWarningModal` | 원래 slug vs 새 slug | "저장" 클릭 시 slug가 변경되었으면 먼저 노출: "고유 URL을 변경하면 기존에 배포된 임베드 코드와 공유 링크가 더 이상 동작하지 않을 수 있습니다. 계속하시겠습니까?" [취소] [변경 후 저장] — 확인해야만 실제 `PATCH` 전송(FR-3-8, AC-3-7) |
| `FormActions` | `dirty`, `saving`, `onSave`, `onCancel` | 변경 없으면 "저장" 비활성. 저장 중 버튼에 스피너 + `disabled`(중복 제출 방지) |
| `UnsavedChangesGuard` | `dirty` | 탭 전환/뒤로가기/다른 라우트 이동 시 `window.confirm` 또는 커스텀 확인 모달: "저장하지 않은 변경 사항이 있습니다. 이동하시겠습니까?"(FR-3-12, AC-3-8) |

### 필드-오류 매핑 (details[].field → 컴포넌트)

| field | 표시 위치 | 대표 메시지 |
|---|---|---|
| `name` | 이름 필드 하단 | "이름을 입력해 주세요." (빈 문자열, AC-3-2) |
| `avatarUrl` | 아바타 URL 필드 하단 | "http 또는 https로 시작하는 주소만 사용할 수 있습니다." (AC-3-4) |
| `description` | 소개 영역 하단(글자 수 카운터 옆) | "소개는 500자를 초과할 수 없습니다." (AC-3-3) |
| `slug` | slug 필드 하단(=`SlugAvailabilityIndicator`와 동일 위치) | "사용할 수 없는 예약어입니다."(AC-3-5) / "이미 사용 중인 고유 URL입니다." |

### 저장 흐름
1. 편집 → `dirty=true`.
2. 저장 클릭 → 클라이언트 사전검증(필수값, 길이) → 실패 시 인라인 오류만 표시하고 요청 보내지 않음.
3. slug가 원본과 다르면 `SlugChangeWarningModal` 표시 → 확인.
4. `PATCH /chatbots/:id/settings` 전송, 버튼 로딩.
5. 200 → `Toast`("저장되었습니다") + `updatedAt` 갱신 + `PublicUrlPreview` 갱신 + `dirty=false`.
6. 400/409 → 해당 필드 인라인 오류, 모달/포커스는 오류 필드로 이동.
7. `ARCHIVED` 상태에서는 애초에 모든 입력이 `disabled`이고 저장 버튼 자체가 숨겨지므로 409 `CHATBOT_ARCHIVED`는 경합 상황(다른 관리자가 방금 보관 처리)에서만 발생 — 이 경우 전체 폼을 `ArchivedBanner`와 함께 비활성화 상태로 재동기화하고 토스트로 안내.

---

## 3.5 S4 — 스킨/임베드 탭 (`/chatbots/:chatbotId/skin`)

### 목적
외형(주색상/헤더문구/로고)을 실시간 미리보기와 함께 설정하고, PC/모바일 임베드 코드를 확인·복사한다.

### 하위 구조 (URL 세그먼트 아님, 클라이언트 상태 서브탭)
`설계서 §9`가 지정한 URL 세그먼트는 `skin` 하나뿐이므로, 스킨 설정과 임베드 코드는 같은 라우트 안에서 좌측(또는 상단) 서브탭 `스킨 | 임베드`로 전환한다. 기본 진입은 "스킨" 서브탭. 서브탭 상태는 `?section=embed` 같은 쿼리로 보존해 "임베드 설정 바로가기" 딥링크(대시보드 빈 상태 CTA)가 바로 임베드 섹션을 열도록 한다.

### 레이아웃 — 스킨 서브탭

```
┌───────────────────────────────────────────────────────────────────────────┐
│ (DRAFT/ARCHIVED 등 비활성 상태 공용 배너는 ARCHIVED에서만, 아래 참고)         │
│ [ 스킨 ] [ 임베드 ]                                                         │
├───────────────────────────────┬─────────────────────────────────────────┤
│ 주 색상 *   [■ #4F46E5] [피커]  │   미리보기                                │
│             (대비 경고 없음/있음) │  ┌───────────────────────────┐        │
│ 헤더 문구 * [챗봇 상담_______]   │  │ ●●● 챗봇 상담          ✕  │ ← 헤더  │
│             10/50자             │  ├───────────────────────────┤        │
│ 로고 URL    [______________]    │  │  안녕하세요! 무엇을         │        │
│                                 │  │  도와드릴까요?              │        │
│                                 │  ├───────────────────────────┤        │
│                                 │  │ [메시지를 입력하세요   ][전송]│        │
│                                 │  └───────────────────────────┘        │
│ [기본값으로 되돌리기]            │                                        │
├─────────────────────────────────┴─────────────────────────────────────────┤
│                                                   [취소]   [저장]           │
└───────────────────────────────────────────────────────────────────────────┘
```

대비 경고 배지(예시, AC-4-3):
```
주 색상 필드 하단: ⚠ 헤더 텍스트(흰색) 대비 3.1:1 — 기준(4.5:1) 미달
                  권장: 검정 텍스트로 전환 [적용]   (저장은 막지 않음)
```

### 레이아웃 — 임베드 서브탭

```
┌───────────────────────────────────────────────────────────────────────────┐
│ [ 스킨 ] [ 임베드 ]                                                         │
├───────────────────────────────────────────────────────────────────────────┤
│ (DRAFT일 때) ⚠ 현재 '초안' 상태입니다. 활성화 후 임베드해야 정상 동작합니다. │
│              [지금 활성화하기]                                              │
├───────────────────────────────────────────────────────────────────────────┤
│ 공개 URL                                                                    │
│ https://widget.example.com/c/order-bot                          [복사]     │
├───────────────────────────────────────────────────────────────────────────┤
│ PC용 스니펫                                                        [복사]   │
│ ┌─────────────────────────────────────────────────────────────────────┐   │
│ │ <script src="https://.../widget.js" data-chatbot="order-bot" ...>   │   │
│ └─────────────────────────────────────────────────────────────────────┘   │
├───────────────────────────────────────────────────────────────────────────┤
│ 모바일용 스니펫                                                    [복사]   │
│ ┌─────────────────────────────────────────────────────────────────────┐   │
│ │ <script ... data-mode="mobile" data-fullscreen="true" ...>          │   │
│ └─────────────────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────────────────┘
```

복사 성공 피드백: 버튼 텍스트가 일시적으로 "복사" → "✔ 복사되었습니다"(2초) 전환(FR-4-10).
클립보드 API 실패(EX-4-2): 코드 블록 전체가 자동 선택되고 블록 하단에 "클립보드 접근이 제한되었습니다. Ctrl+C로 복사해 주세요." 안내 표시.

### 컴포넌트 분해

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `SkinSubTabs` | `active: 'skin'\|'embed'` (쿼리스트링 동기화) |
| `SkinForm` | 초기값 `ChatbotSkinSchema`, `onSubmit(patch: UpdateChatbotSkinDto)` |
| `ColorPickerField`(primaryColor) | `id="primaryColor"`, hex 텍스트 입력(`pattern="#[0-9A-Fa-f]{6}"`) + `<input type="color">` 동기화, 필수 |
| `HeaderTitleField` | `id="headerTitle"`, `maxLength=50`, 잔여 글자수 실시간 표시, 비워두면 저장 시 서버가 기본값 `챗봇 상담` 유지(FR-4-3) — UI는 placeholder가 아니라 "미입력 시 기본값 '챗봇 상담'이 유지됩니다." 도움말 텍스트로 안내 |
| `LogoUrlField` | `id="logoUrl"`, 선택, 유효 URL만, 값 지우면 저장 시 `null` 전송(로고 제거, D-10) |
| `ContrastWarningBadge` | `ratio: number`, `passes: boolean`, `suggestedTextColor: 'white'\|'black'` | WCAG relative luminance 공식으로 클라이언트에서 즉시 계산(NFR-P3, 서버 왕복 없음). `passes=false`일 때만 노출, **저장 차단하지 않음**(FR-4-6, AC-4-3) |
| `SkinPreviewPanel` | `skin: {primaryColor,headerTitle,logoUrl?}`, `chatbotName` | 폼 값이 바뀔 때마다 100ms 이내 반영(NFR-P3). 챗봇 위젯 헤더+말풍선+입력창의 축소 목업. `headerTitle`에 HTML 태그가 들어와도 텍스트로만 렌더링(이스케이프, NFR-S2, AC-4-11 검증 대상) |
| `ResetSkinButton` + `ResetSkinConfirmDialog` | — | 확인 시 **폼 값만** `DEFAULT_CHATBOT_SKIN`(+`logoUrl` 빈 값)으로 되돌리고 미리보기 갱신. 실제 서버 반영은 이어지는 "저장" 클릭 시 발생(AC-4-6과 정합) |
| `FormActions` | `dirty,saving,onSave,onCancel` | 기본설정 탭과 동일 패턴 |
| `PublicUrlBlock` | `url: EmbedCodeSchema.publicUrl` | 복사 버튼 포함 |
| `EmbedCodeBlock` | `label: 'PC용'\|'모바일용'`, `code: string`(각각 `EmbedCodeSchema.pc` / `.mobile`) | `<pre><code>` 읽기 전용이나 `user-select: text`(복사/선택 제한 금지, UIUX §5, FR-4-11). 코드 내부에 자유 입력 문자열 없음(설계서 §7.9 — slug만 포함, HTML 주입 구조적으로 불가) |
| `DraftEmbedNotice` | `visible: status!=='ACTIVE'` | 문구 + "지금 활성화하기" 버튼(`StatusTransitionControls`의 "활성화"와 동일 동작 트리거) — 임베드 코드 확인/복사 자체는 항상 가능(FR-4-12) |

### 필드-오류 매핑

| field | 표시 위치 | 대표 메시지 |
|---|---|---|
| `primaryColor` | 색상 필드 하단 | "#RRGGBB 형식(6자리 16진수)만 사용할 수 있습니다." (AC-4-2) |
| `headerTitle` | 헤더 문구 필드 하단(카운터 옆) | "헤더 문구는 50자를 초과할 수 없습니다." (AC-4-4) |
| `logoUrl` | 로고 URL 필드 하단 | "http 또는 https로 시작하는 주소만 사용할 수 있습니다." |

### 저장/복원 후 검증
저장 성공(200) 후 재조회 시 `skin`은 항상 **객체**로 내려온다(AC-4-5) — 프런트는 파싱 없이 그대로 폼 초기값에 바인딩.

---

## 4. 모달/플로우 상세 정리 (요약표)

| 플로우 | 트리거 | 확인 모달 | 성공 결과 | 대표 실패 처리 |
|---|---|---|---|---|
| 그룹 생성 | S1 "+ 그룹 추가" | — | 토스트 + 트리 갱신 | 400 필드 오류 인라인 |
| 그룹 수정 | 트리 항목 kebab "이름 수정" | — | 토스트 + 트리 갱신 | 400 인라인 |
| 그룹 삭제 | 트리 항목 kebab "삭제" | `DeleteGroupConfirmDialog` | 204, 트리에서 제거 | 409 모달 내 배너(§3.1) |
| 그룹 복사 | 트리 항목 kebab "복사" | `CopyGroupModal` | 201, 새 그룹+챗봇 N개 생성, 트리 갱신 후 새 그룹 자동 선택 | 404(경합) 토스트 |
| 챗봇 생성 | S1 "+ 챗봇 만들기" | — (slug 실시간 확인은 있으나 확인 모달 아님) | 201 → `/chatbots/:id/settings` 이동 | 400/409 인라인(모달 유지) |
| 챗봇 복사 | 행 액션 "복사" | `CopyChatbotModal`(복제범위 고지) | 201, 목록 갱신+신규행 하이라이트 | 404 토스트 |
| 챗봇 그룹 이동 | 행 액션 "그룹 이동" | `MoveGroupModal` | 200, 목록 갱신 | 404 인라인 |
| 챗봇 보관(삭제) | 행 액션 "삭제" 또는 상세 헤더 "보관" | `ArchiveConfirmDialog` | 204, `status=ARCHIVED`, 기본 필터에서 숨김 | 없음(멱등 200) |
| 챗봇 활성화/복구 | 상세 헤더 버튼 | — (비파괴적) | 200, 배지 갱신 | 400 불허 전이 시 버튼 자체가 비활성이라 사실상 발생 안 함 |
| 영구 삭제 | 행 액션 "영구 삭제"(`ARCHIVED`만) | `PermanentDeleteModal`(이름 타이핑) | 204, 목록에서 제거 | 409 `CHATBOT_HAS_CHILDREN` 모달 내 항목별 건수 안내 / 400 이름 불일치 인라인 |
| slug 변경 저장 | S3 저장 클릭(slug 변경 시) | `SlugChangeWarningModal` | 200 | 취소 시 저장 미전송 |
| 스킨 기본값 복원 | S4 "기본값으로 되돌리기" | `ResetSkinConfirmDialog` | 폼 값만 리셋(서버 미반영) → 이후 "저장"으로 확정 | — |
| 임베드 코드 복사 | S4 "복사" 버튼 | — | 클립보드 성공 피드백 | 폴백: 전체 선택 안내 |

### 4.4 영구 삭제 모달 상세 (`PermanentDeleteModal`)

```
┌─────────────────────────────────────────────┐
│  영구 삭제 — 되돌릴 수 없습니다               │
│  '주문 상담봇' 챗봇을 영구 삭제하면 모든 설정이│
│  삭제되며 복구할 수 없습니다.                  │
│                                               │
│  확인을 위해 챗봇 이름을 입력하세요.           │
│  label: "챗봇 이름"                            │
│  [_____________________]                     │
│  (입력값이 '주문 상담봇'과 일치해야 활성화)    │
│                                               │
│           [취소]      [영구 삭제] (danger, 기본 disabled) │
└─────────────────────────────────────────────┘
```
- 입력값이 챗봇 이름과 정확히 일치할 때만 "영구 삭제" 버튼 활성화(클라이언트 사전 체크). 서버도 `confirmName`을 재검증한다(D-9).
- 409 `CHATBOT_HAS_CHILDREN` 응답 시: 모달 내 배너 "연결된 데이터(대화이력 20건)가 있어 삭제할 수 없습니다." — 모달은 닫히지 않고 사용자가 "취소"로 종료해야 함.
- 400 `CONFIRM_NAME_MISMATCH`(동시편집 경합 등): 입력 필드 하단 인라인 "챗봇 이름이 일치하지 않습니다."

---

## 5. 상태 전이 UI 규칙 (FR-1-17, AC-1-13)

`CHATBOT_STATUS_TRANSITIONS`(shared-types 공용 상수, 설계서 §4.2)를 그대로 사용해 버튼 활성/비활성을 판단한다. 서버 재검증을 신뢰하되, 클라이언트도 동일 규칙으로 **선제 차단**해 400 응답을 최대한 줄인다.

| 현재 상태 | "활성화" | "보관" | "초안으로 복구" |
|---|---|---|---|
| `DRAFT` | 활성 | 활성(확인모달) | 비활성(현재 상태) |
| `ACTIVE` | 비활성(현재 상태) | 활성(확인모달) | 비활성 + 사유: "운영중 챗봇은 보관 후에만 초안으로 되돌릴 수 있습니다." |
| `ARCHIVED` | 비활성 + 사유: "보관된 챗봇은 초안으로 복구한 뒤 다시 활성화할 수 있습니다." | 비활성(현재 상태) | 활성 |

동일 상태로의 전환 요청은 서버가 200 no-op으로 허용하지만(설계서 §7.2), UI에서는 애초에 "현재 상태" 버튼을 비활성으로 눌러도 요청이 나가지 않게 한다(불필요한 네트워크 호출 방지).

---

## 6. 오류 처리 및 `apiClient` 확장 요구사항 (구현 필수)

### 6.1 필수 확장 사항 (설계서 §9와 동일 지적, 재확인)

현재 `apps/web/src/api/client.ts`의 `request()`는 `!res.ok`일 때 상태 코드/문자열 메시지만 담아 `throw`하고, **응답 본문(JSON)을 읽지 않는다.** 이 문서의 다음 요구는 전부 오류 본문 파싱을 전제로 한다.

- FR-0-3 / AC-5-2: 필드별 인라인 오류(`details[].field`) 렌더링 — §3.3(설정)/§3.4(스킨)/생성·그룹 모달 전부.
- 409 `GROUP_NOT_EMPTY`, `CHATBOT_HAS_CHILDREN` 등 코드 기반 분기 UI(§3.1, §4.4).
- 503 `AGGREGATION_TIMEOUT` 시 `DashboardErrorState` vs 그 외 오류의 구분(§3.3).

**요구 형태(`frontend-implementer`가 구현)**: `ApiError`에 `code?: ApiErrorCode`, `details?: { field: string; message: string }[]`를 추가하고, `request()`에서 `!res.ok`일 때 body를 `ApiErrorSchema`로 `safeParse`해 성공하면 그 값을 사용, 실패하면 기존 `상태코드+statusText` 문구로 폴백한다.

### 6.2 오류 코드 → 화면 반응 매핑

| code | 발생 화면 | UI 반응 |
|---|---|---|
| `VALIDATION_FAILED` | 전 폼 | `details[]`를 필드별 인라인 오류로 분배 |
| `RESERVED_SLUG` | S3 설정, 챗봇 생성 모달 | slug 필드 인라인 |
| `INVALID_STATUS_TRANSITION` | 상세 헤더(경합 상황) | 토스트 + 버튼 상태 재동기화 |
| `INVALID_PERIOD` | S2 대시보드 | 기간 선택 하단 인라인, 카드 영역 유지 |
| `CONFIRM_NAME_MISMATCH` | 영구삭제 모달 | 이름 입력 필드 하단 인라인 |
| `NOT_FOUND` | 전 화면 | 대상별 문맥 처리 — 목록: 토스트+재조회 / 상세 셸: 전체 `ErrorState` |
| `DUPLICATE_SLUG` | S3 설정, 챗봇 생성 모달 | slug 필드 인라인 |
| `GROUP_NOT_EMPTY` | S1 그룹 삭제 모달 | 모달 내 배너(§3.1) |
| `CHATBOT_ARCHIVED` | S3/S4 | 폼 비활성 재동기화 + 토스트 |
| `CHATBOT_NOT_ARCHIVED` | 영구삭제 시도(경합) | 모달 배너 + 액션 메뉴에서 "영구 삭제" 숨김 재동기화 |
| `CHATBOT_HAS_CHILDREN` | 영구삭제 모달 | 모달 배너(항목별 건수) |
| `CONFIG_ERROR` | S4 임베드 서브탭 | `ErrorState`: "서버 설정이 누락되었습니다. 관리자에게 문의해 주세요." |
| `AGGREGATION_TIMEOUT` | S2 대시보드 | `DashboardErrorState` + 다시 시도 |
| `INTERNAL_ERROR` / 미분류 | 전 화면 | 공통 토스트: "처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." |

### 6.3 401 훅 자리 (EX-X-1, No.12 대비)
`request()` 내 `if (res.status === 401) { /* No.12 Phase: 재로그인 유도, 현재는 no-op */ }` 분기만 마련한다. 이번 Phase 화면 설계에는 로그인 화면/리다이렉트를 포함하지 않는다.

---

## 7. `UIUX_준수기준.md` 체크리스트 매핑

### 7.1 공통(전 화면)

| 기준 | 항목 | 적용 |
|---|---|---|
| §1 색상대비 | 텍스트 4.5:1 / 비텍스트 3:1, 색상 단독 금지 | `StatusBadge`(색+아이콘+텍스트), 오류 텍스트, `ContrastWarningBadge` |
| §3 키보드접근성 | Tab 순차/Shift+Tab 역순, Enter/Space 실행, 모달 Esc+포커스복귀 | 그룹트리 kebab 메뉴, 모든 모달(§2.2), `TabNav`(href 기반) |
| §4 버튼 | 동사형 레이블, 중복 실행 방지, 터치 44×44px | "저장"/"복사"/"삭제"/"새로고침", `RefreshButton` 연타 방지, 모바일 버튼 크기(§8) |
| §7 오류 메시지 | 원인+해결방법, 제출 시점 표시 | §2.4, §3.3/3.4 필드 매핑표 |
| §8 로딩/상태 | 스켈레톤, 완료 시 건수 배지 | `SkeletonRow/Card`, `ResultSummaryBadge`, S1 "총 N건" |

### 7.2 화면별

| 화면 | UIUX 항목 | 적용 지점 |
|---|---|---|
| S1 그룹/목록 | §5(입력필드 레이블) | `CreateGroupModal`/`CreateChatbotModal`의 모든 필드 `<label htmlFor>` |
| | §6(폼 컨트롤) | 상태 필터는 체크박스(다중선택), 정렬은 셀렉트(단일선택)+수동 트리거 |
| | §9(내비게이션/페이지네이션) | `Pagination` 현재 페이지 밑줄+배경 이중 표시 |
| S2 대시보드 | §8(로딩/완료 배지) | 카드 스켈레톤 → "조회기간·집계건수" 배지 |
| | §7(오류 vs 빈상태 구분) | `EmptyState`(중립색) ≠ `DashboardErrorState`(경고색) — FR-2-10 |
| S3 기본설정 | §5(글자수 실시간 표시) | 소개 500자 카운터 |
| | §6(필수/선택 구분) | 이름/slug `*` 표시, 아바타/소개는 표시 없음 |
| | §7(인라인 오류) | 필드-오류 매핑표(§3.4) |
| S4 스킨/임베드 | §1(명도대비 검사 자체가 기능) | `ContrastWarningBadge`(FR-4-6) |
| | §5(복사/붙여넣기 제한 금지) | `EmbedCodeBlock`은 `user-select` 제한 없음 |
| | §4(버튼 반응영역) | 색상피커, 복사버튼 44×44px(모바일) |

### 7.3 자동화 연계
`AC-5-3`(키보드만으로 전 과정 완료), `AC-5-4`(axe 스캔 대비 4.5:1 미만 0건)는 `test-automation` 단계 검증 대상이며, 본 설계의 `<label htmlFor>` 강제·href 기반 탭·모달 포커스 트랩 규칙이 그 전제 조건이다.

---

## 8. 반응형 레이아웃 원칙

관리자 콘솔(`apps/web`) 기준. 실제 챗봇 위젯(`apps/widget`)의 PC/모바일 렌더링 자체는 이 Phase 범위 밖(FR-4-15, §9.2)이며, S4의 미리보기는 **위젯 외형을 흉내 낸 목업**일 뿐 실제 위젯 컴포넌트가 아니다.

| 브레이크포인트 | 폭 | 레이아웃 변화 |
|---|---|---|
| 데스크톱 | ≥ 1024px | S1: 좌측 그룹트리(고정 240px) + 우측 본문 2단. S4: 폼(좌) + 미리보기(우) 2단 |
| 태블릿 | 640–1023px | S1: 그룹트리는 상단 "그룹 ▾" 드롭다운/드로어로 접힘(토글 버튼으로 열고 닫음, 키보드 접근 가능). S4: 폼과 미리보기는 세로 스택(미리보기가 폼 아래) |
| 모바일 | < 640px | S1: 테이블 대신 `ChatbotCardList`(카드 1열, 행 정보 라벨+값 스택). 그룹트리는 전체화면 바텀시트. S2: 카드 2열→1열, 기간선택은 셀렉트로 축약. S3/S4: 폼 필드 1열, `FormActions`는 화면 하단 고정(sticky) 바로 전환. 모든 클릭 가능 요소 44×44px 이상 유지(§4) |

공통 원칙:
- 모달은 모바일 폭에서 전체화면(바텀시트형)으로 전환하되 포커스 트랩/Esc 규칙은 동일하게 유지.
- 텍스트 영역(소개, 임베드 코드)은 모든 폭에서 컨테이너 전체 너비 사용(UIUX §5).
- 좌우 스크롤이 발생하지 않도록 테이블은 모바일에서 카드로 전환하는 쪽을 기본으로 하고, 불가피한 넓은 표(없음, 이 Phase 기준)는 가로 스크롤 컨테이너로 감싼다.

---

## 9. `frontend-implementer` 인계 메모

1. **선행 작업**: `apiClient` 오류 파싱 확장(§6.1)을 다른 화면 작업보다 먼저 처리할 것 — 이후 모든 폼의 인라인 오류 구현이 이 위에서 동작한다.
2. **의존 스키마**: `DashboardSummarySchema.totalLogCount`/`visitCountBasis`, `EmbedCodeSchema`, `SlugAvailabilitySchema`, `ChatbotListItemSchema`, `ChatbotGroupWithCountSchema` 등은 설계서 §4 기준 **아직 코드에 반영되지 않은 스키마**다. `backend-implementer` 산출물(및 `packages/shared-types` 갱신)이 선행되어야 이 문서의 데이터 바인딩이 그대로 맞는다.
3. **상수 파일**: 이 문서에 등장한 모든 한국어 문구(오류/안내/버튼 레이블/빈 상태 문구)는 `apps/web/src/constants/messages.ts`에 키-값으로 옮겨 담는다(FR-0-8). 서버가 내려주는 `message`(오류 본문)는 예외로, 서버 문구를 그대로 표시하되 `code` 기반 UI 반응(§6.2)은 상수화한다.
4. **미결정/후속 확인 필요**
   - `topN` 파라미터(1~10, 기본 5)를 사용자에게 노출하는 컨트롤은 이번 화면에 포함하지 않았다(요구사항에 명시적 UI 요건 없음) — 필요 시 PM 확인 후 `PeriodSelector` 옆에 추가.
   - `SkinPreviewPanel`/실제 `apps/widget` 렌더링 간 시각적 정합성(폰트, 여백 등)은 위젯 구현 Phase에서 재검토 대상.
   - 모바일 그룹트리 바텀시트, 데스크톱 드로어 등 구체적 모션/애니메이션 스펙은 이 문서에서 다루지 않음(레이아웃 원칙만 규정) — 프런트 컴포넌트 라이브러리 선정 후 확정.
