# 통합 통계 (No.29) — 화면 설계서

> **대상 기능**: No.29 통합 통계(그룹/전역 스코프 누적 통계) + 부수 3건(의도별 매칭 통계, KST 헬퍼 통합은 화면 영향 없음, `stats:read` 미신설)
> **입력 문서**: `docs/requirements/integrated-stats.md`(J-1~J-15, FR-0-88~95, FR-I1-\*~FR-I8-\*, PM 결정 P-1~P-9 §11), `docs/02-spec/integrated-stats-설계.md`(§8 API 계약, §13 관리자 콘솔 인계), `docs/02-spec/decisions/ADR-0033-cumulative-stats-source-log-sealing-and-group-snapshot.md`
> **준수 기준**: `docs/03-design/UIUX_준수기준.md`(전 항목, §3·§8에 이번 작업으로 2건 보강 — 문서 말미 §11 참고)
> **선례 참고**: `stats-learning-ui-spec.md`(챗봇 스코프 S1 화면·`ChartFrame`·`GranularityPeriodControl`·상태 배지·문구 톤 — 이번 화면들이 이 자산을 재사용), `chatbot-operations-ui-spec.md`(`GroupTree`·확인 대화상자 3종·오류 코드 매핑), `scheduled-deploy-ui-spec.md`(운영 배너 톤)
> **실제 코드 확인**: `apps/web/src/App.tsx`(라우트) · `apps/web/src/pages/DashboardHomePage.tsx`(대체 대상) · `apps/web/src/pages/ChatbotListPage.tsx`·`chatbot-list/GroupTree.tsx`·`chatbot-list/modals.tsx`(그룹/챗봇 확인 대화상자) · `apps/web/src/pages/stats/*`(재사용 대상 `ChartFrame`/`GranularityPeriodControl`/`StatsTrendChart`/`ResponseSourceDistribution`/`ChannelDistribution`/`HourWeekdayPanel`/`TopQuestionsPanel`/`StatsOverviewPage`) · `apps/web/src/constants/messages.ts`(`stats`/`group`/`chatbot` 네임스페이스)
> **작성**: ui-designer · 2026-09-24 · **다음 단계**: `backend-implementer`(이미 진행 가능 — API 계약 확정됨) → `frontend-implementer` → `code-reviewer` → `test-automation`
> **범위 경계**: 실제 React 컴포넌트 코드는 작성하지 않는다. 여기서 정의한 화면/컴포넌트/상태/문구는 `frontend-implementer`가 구현 기준으로 삼는다.

---

## 0. 전제와 연계 확인

1. **설계서 §13(관리자 콘솔 인계)과 FR-I8-\*를 그대로 받아들인다.** 이 문서는 그 틀을 뒤집지 않고 화면 구성만 구체화한다. 특히:
   - **콘솔 홈 `/`를 통합 통계로 대체**하고(P-8), 상태는 URL 쿼리(`scope`·`groupId`·`granularity`·`from`·`to`·`includeArchivedChatbots`)로 보존한다(FR-I8-1).
   - **No.14 순수 함수·No.2 대시보드는 한 글자도 바뀌지 않는다**(FR-0-90) — 이 문서는 챗봇 스코프 통계 화면(`/chatbots/:id/stats/overview`, S1)에 **"의도별 매칭" 섹션 1개만 맨 뒤에 추가**한다(FR-I8-5, J-13).
   - **차트 라이브러리를 도입하지 않는다**(FR-I8-4) — `ChartFrame`·`StatsTrendChart`·SVG 막대 컴포넌트를 그대로 재사용한다.
   - **보관 챗봇/보관 그룹을 합계에서 빼는 옵션은 만들지 않는다**(J-9) — 유일한 예외는 질문 순위의 "보관 챗봇 포함" 토글(P-5, 기본 켜짐).
2. **현재 코드 상태 확인 결과**(이 문서의 전제):
   - `DashboardHomePage.tsx`는 "챗봇 목록으로 이동하세요" 안내 한 줄뿐인 빈 자리다 — 이 페이지 전체를 통합 통계 화면으로 교체한다.
   - `ChatbotListPage.tsx`는 `useSearchParams`로 필터 상태를 URL에 반영하는 기존 관용구를 이미 갖고 있다 — 이번 화면의 URL 상태 관리도 동일 패턴(`useSearchParams`)을 쓴다.
   - `GroupTree.tsx`의 각 그룹 행은 이미 kebab 메뉴(`이름 수정`/`그룹 복사`/`그룹 삭제`)를 갖는다 — "그룹 통계 보기"를 그 메뉴의 **첫 항목**(읽기 동작이라 맨 위)으로 추가한다(FR-I8-2).
   - `stats/ChartFrame.tsx`·`StatsTrendChart.tsx`·`ResponseSourceDistribution.tsx`·`ChannelDistribution.tsx`·`HourWeekdayPanel.tsx`·`TopQuestionsPanel.tsx`·`GranularityPeriodControl.tsx`는 **이미 구현되어 운영 중**이며, `IntegratedSummarySchema`/`IntegratedDistributionSchema`는 각각 `StatsSummarySchema`/`StatsDistributionSchema`의 상위 호환(`.merge(IntegratedScopeMetaSchema)`)이라 **컴포넌트 본문 변경 없이 그대로 재사용 가능**하다. 유일한 필수 변경은 `ResponseSourceDistribution`/`TopQuestionsPanel`의 `chatbotId` prop을 **선택(optional)** 으로 바꾸는 것(design §2.5) — 통합 스코프에는 단일 챗봇이 없어 학습현황 딥링크를 조건부로 숨긴다.
   - `chatbot-list/modals.tsx`의 `ArchiveConfirmDialog`/`MoveGroupModal`/`DeleteGroupConfirmDialog`/`PermanentDeleteModal`은 이미 구현되어 있다 — 이번 변경은 **문구 추가만**이며 API 호출·상태 전이 로직은 불변이다.
3. **이 문서가 다루지 않는 것**
   - `apps/widget`: 변경 0(설계서 §2.4). 언급하지 않는다.
   - No.2 대시보드(`DashboardTab.tsx`) 자체: 변경 없음(FR-0-90).
   - KST 헬퍼 통합(J-11)·세션 원시 SQL(J-12)·정적 검사(J-3): 화면에 보이지 않는 백엔드 내부 리팩터링이라 이 문서의 대상이 아니다.
   - `stats:read` 권한: 신설하지 않으므로(P-7) 권한별 UI 분기는 기존 `chatbot:read` 매트릭스를 그대로 따른다(§6).
4. **문구 상수**: 신규 네임스페이스 `MESSAGES.integratedStats.*`를 추가하고, 기존 `MESSAGES.stats.*`(의도별 매칭 섹션분)·`MESSAGES.group.*`·`MESSAGES.chatbot.*`(확인 대화상자 보강분)에 항목을 더한다(§10 목록).
5. **조사 한계 승계**: 요구사항 문서가 명시한 대로 이 환경에서 ROCHA 원본 PDF의 "통합 통계" 화면 필드를 직접 렌더하지 못했다(`pdftoppm` 미설치, `integrated-stats.md` 조사 한계 재확인). 이 설계는 **FR-I3/I7/I8 텍스트 + 선행 화면(`stats-learning-ui-spec.md` S1)의 관용구 재사용**만으로 구성했다. ROCHA 원본과의 세부 필드 차이가 문제 되면 `bug-triage` 단계에서 보정한다.
6. **판단 요약(선반영)**: 통합 통계는 **화면 1개**(`IntegratedStatsPage`, `/`)가 스코프(`전체`/`그룹`)에 따라 내용만 바꾸는 구조다(탭·라우트를 스코프별로 나누지 않는다 — URL 쿼리 하나로 전체 상태가 결정되므로 새로고침·공유·뒤로가기가 자연스럽다).

---

## 1. 화면 목록 및 라우트

| ID | 화면명 | 라우트 | 성격 | 진입 경로 | 필요 권한 |
|---|---|---|---|---|---|
| G0 | **통합 통계**(전체/그룹 스코프) | `/`(콘솔 홈 대체, 쿼리: `scope`·`groupId`·`granularity`·`from`·`to`·`includeArchivedChatbots`) | 조회 전용 | 로그인 후 기본 진입점 · 챗봇 목록의 그룹 행 "그룹 통계 보기" · 상단 로고 클릭 | `chatbot:read` |
| S1(변경) | 챗봇 통계 — 기본 통계(기존 화면 + **의도별 매칭 섹션 추가**) | `/chatbots/:chatbotId/stats/overview`(기존 라우트 불변) | 조회 전용 | 기존과 동일(`StatsShell`) + G0 기여 표/질문 순위 행 클릭 | `chatbot:read` |

**변경되는 기존 화면(라우트 불변, 문구만 추가)**: 챗봇 목록(`/chatbots`) — 그룹 kebab 메뉴 항목 1개 추가, 보관·그룹 이동·그룹 삭제 확인 대화상자 문구 보강. 아래 §5에서 다룬다.

**URL 쿼리 기본값과 정규화 규칙**(EX-I-2 대응, `IntegratedStatsPage` 진입 시 프런트가 1회 정리):

| 쿼리 | 기본값 | 정규화 |
|---|---|---|
| `scope` | `ALL` | `GROUP`도 `ALL`도 아니면 `ALL`로 치환 |
| `groupId` | (없음) | `scope=ALL`인데 값이 있으면 **제거**(서버에 보내지 않음 — EX-I-2 "무시가 아니라 거부"는 서버 규약이므로, 프런트는 애초에 잘못된 조합을 만들지 않는다) · `scope=GROUP`인데 값이 없으면 그룹 선택기를 연 채 **API를 호출하지 않는다**(빈 화면 대신 "그룹을 선택해 주세요" 안내) |
| `granularity` | `DAY` | 기존 `GranularityPeriodControl` 규칙과 동일 |
| `from`/`to` | (없음) | 기존과 동일(서버 기본 기간 적용, `rangeDefaulted` 안내) |
| `includeArchivedChatbots` | `true` | 질문 순위 전용(§2.6) |

---

## 2. 공통 UI 요소(신규)

### 2.1 `ScopeSelector`

| 컴포넌트 | props | 규칙 |
|---|---|---|
| `ScopeSelector` | `{ scope: 'ALL'\|'GROUP', groupId?: string, onChange(scope, groupId?) }` | ① 세그먼트 버튼 2개 "전체" / "그룹"(라디오그룹, UIUX §6 단일선택) ② `scope==='GROUP'`이면 그 옆에 그룹 콤보박스(`GroupOptionSelect`)가 나타난다 ③ 원천은 마운트 시 1회 호출하는 `GET /stats/integrated/groups`(§2.2) ④ 변경 결과를 `aria-live="polite"`로 안내: `MESSAGES.integratedStats.scopeChangeAnnounce(label)`("세무 서비스 통계로 전환되었습니다.") ⑤ 키보드: 세그먼트는 방향키/Tab, 콤보박스는 방향키로 옵션 탐색 + Esc 닫기(UIUX §3·§6) |
| `GroupOptionSelect` | `{ options: GroupOption[], value?, onChange, truncated: boolean }` | 활성 그룹(생성일 오름차순) → 구분선(`<optgroup label="보관된 그룹">`) → 보관 그룹(보관일 내림차순) 2단 구성. 이름이 같은 그룹이 있으면 라벨에 생성일을 병기(`MESSAGES.integratedStats.scopeDuplicateNameSuffix`, EX-I-11). `truncated===true`면 셀렉트 아래 `MESSAGES.integratedStats.scopeTruncatedNotice`("그룹이 많아 일부만 표시됩니다") 노출 |

**그룹 옵션 타입**: `GroupOption = { id, name, createdAt, archivedAt: Date\|null, chatbotCount }` — `IntegratedGroupOptionsSchema.items`를 그대로 바인딩.

### 2.2 데이터 훅 — 5+1개 독립 요청 (F-3 패턴 승계)

`stats-learning-ui-spec.md` §3.3의 "3개 API는 독립 로딩·부분 렌더" 원칙을 5개로 확장한다.

| 요청 | 채우는 영역 | 실패해도 다른 영역 영향 없음 |
|---|---|---|
| `GET /stats/integrated/groups` | `ScopeSelector`(마운트 1회, 스코프 변경과 무관하게 캐시) | 실패 시 `ScopeSelector`는 "전체"만 활성, 콤보박스는 오류 안내 + 다시 시도 |
| `GET /stats/integrated/overview` | 누적 KPI 카드 4종 | ✓ |
| `GET /stats/integrated/summary` | 추이 차트 | ✓ |
| `GET /stats/integrated/distribution` | 분포 4종 | ✓ |
| `GET /stats/integrated/breakdown` | 기여 표 | ✓ |
| `GET /stats/integrated/questions` | 질문 순위 | ✓ |

스코프(`scope`/`groupId`)·기간(`granularity`/`from`/`to`)이 바뀌면 `groups`를 제외한 5개를 **병렬 재요청**한다. `includeArchivedChatbots` 토글은 `questions` 1개만 재요청한다(J-9 — 다른 4개는 이 파라미터를 받지 않음).

### 2.3 `BackfillPendingBanner`

| 컴포넌트 | 규칙 |
|---|---|
| `BackfillPendingBanner` | 5개 응답 중 **어느 하나라도** `backfillPending: true`이면 페이지 상단(스코프 선택기 아래, KPI 카드 위)에 상시 배너: `MESSAGES.integratedStats.backfillPendingBanner`("과거 데이터 정리 중 — 일부 대화가 집계에서 빠져 있습니다.") 닫기 버튼 없음(문제가 스스로 해소될 때까지 계속 알림 — `PendingLimitBanner` 선례와 동일 철학, UIUX §8 신규 "부분 정정 상태" 패턴). ALL 스코프의 기여 표에는 같은 현상이 `unassignedRow`("정리 중(미귀속)" 행, §2.5)로도 나타나 **행 단위로 어느 만큼이 빠졌는지** 확인할 수 있다 |

### 2.4 누적 KPI 카드 — `CumulativeKpiCards`

기존 `MetricCard`(3-prop, 변경 없음)를 4장 배치한다.

| 카드 | `value` | `caption` |
|---|---|---|
| 누적 대화 턴 | `overview.totals.turnCount` | — |
| 누적 응답률 | `formatPercent(overview.totals.responseRate)` | "응답률+미응답률=100%"(기존 문구 재사용) |
| 누적 세션 | `overview.totals.sessionCount` | `MESSAGES.integratedStats.kpiCumulativeSessionCaption`("세션은 챗봇별로 발급되는 대화 식별자입니다. 서로 다른 챗봇의 세션은 합산됩니다.") |
| 챗봇 수 | — | `value`는 `MESSAGES.integratedStats.kpiChatbotCountValue(active,draft,archived)`("운영 12 · 초안 3 · 보관 2") 형태의 문자열 |

카드 행 아래 한 줄: `firstDayBucket`이 있으면 `MESSAGES.integratedStats.kpiCollectionStart(date)`("2024-03-02부터 집계"), 없으면(로그 0건, AC-I2-5) `MESSAGES.integratedStats.kpiCollectionStartEmpty`("아직 집계된 대화가 없습니다.") — 이 경우도 **오류가 아니다**, 카드 값은 전부 0으로 정상 표시된다(stats-learning §3.3 "빈 상태 ①"과 동일 철학).

### 2.5 기여 표 — `SortableBreakdownTable`

| 컴포넌트 | props | 규칙 |
|---|---|---|
| `SortableBreakdownTable` | `{ items: IntegratedBreakdownItem[], othersRow?, unassignedRow?, totals, kind: 'CHATBOT'\|'GROUP', onRowClick(item) }` | ① 열: 이름 · 상태/배지 · 턴 수 · 비중 · 응답률 · 세션 수 · 미응답. `kind==='CHATBOT'`일 때만 "현재 다른 그룹" 보조 텍스트 열 ② 헤더는 정렬 가능한 열(턴 수/비중/응답률/세션 수/미응답/이름)마다 `<button>` + `aria-sort`(UIUX §3 신규 규칙, 이번 작업으로 준수기준에 추가) — 클라이언트 측 정렬(이미 받은 데이터 재정렬, 추가 요청 없음). 기본 정렬 = 턴 수 내림차순(설계 §5.5) ③ `othersRow`/`unassignedRow`는 **정렬 대상에서 제외**하고 항상 표 맨 아래 고정 ④ 행 클릭(및 Enter/Space): `kind==='CHATBOT'`이면 `/chatbots/:id/stats/overview`로 이동, `kind==='GROUP'`이면 그 그룹으로 **스코프 전환**(`?scope=GROUP&groupId=…`, 페이지 이동 없이 `setSearchParams`) ⑤ 표 하단 캡션: `MESSAGES.integratedStats.breakdownSessionCaveat`("그룹을 이동한 세션은 이동 전후 그룹 모두에 계산될 수 있어…", L6 — `kind==='GROUP'`일 때만 노출) |

**배지(색+아이콘+텍스트, UIUX §1 색상 단독 금지)**

| 배지 | 조건 | 문구 |
|---|---|---|
| 보관됨(챗봇) | `status==='ARCHIVED'` | `MESSAGES.integratedStats.breakdownArchivedBadge(date)`("보관됨 · 2025-02-10", 회색 + 보관함 아이콘 — `StatusBadge` `ARCHIVED` 스타일 재사용) |
| 현재 다른 그룹 | `currentGroupId !== 스코프 groupId`(있을 때만) | `MESSAGES.integratedStats.breakdownCurrentGroupBadge(name)`("현재: 사업자 서비스") |
| 보관된 그룹 | `archived===true`(ALL 스코프 그룹 행) | `MESSAGES.integratedStats.breakdownArchivedGroupBadge`("보관된 그룹") |
| 알 수 없는 그룹 | `missing===true` | `MESSAGES.integratedStats.breakdownMissingGroupBadge`("알 수 없는 그룹") + 이름 대신 `id` 앞 8자리 |
| 기타 n개 | `othersRow` | `MESSAGES.integratedStats.breakdownOthersRow(n)`("기타 50개") — 상한 200 초과분 합산(FR-I3-6) |
| 정리 중(미귀속) | `unassignedRow`(ALL 스코프에서만) | `MESSAGES.integratedStats.breakdownUnassignedRow`("정리 중(미귀속)") + 캡션 `breakdownUnassignedCaption`("그룹 정보를 아직 채우지 못한 과거 대화입니다. 잠시 후 자동으로 반영됩니다.") |

### 2.6 질문 순위 확장 — `IntegratedQuestionsPanel`

기존 `TopQuestionsPanel`(§0-2 재사용 확인)을 확장한다.

| 변경 | 내용 |
|---|---|
| `chatbotId` prop | **선택(optional)**로 변경. 없으면(통합 스코프) 미응답 목록의 "학습현황 보기" 딥링크를 렌더하지 않는다 |
| 신규 열 "최다 챗봇" | 각 질문 행에 `topChatbotName`이 있으면 `MESSAGES.integratedStats.questionsTopChatbotLink(name)`("배송봇 통계 보기 →") 링크를 `/chatbots/:topChatbotId/stats/overview`로 렌더. 없으면(챗봇 삭제 경합 등, 드묾) 이름만 텍스트로 |
| `includeArchivedChatbots` 토글 | `IntegratedQuestionsPanel` 상단 체크박스 1개(단일 on/off — UIUX §6 다중선택 규칙과 별개로, 챗봇 목록의 "보관됨 포함" 필터와 동일한 체크박스 관용구 재사용): `MESSAGES.integratedStats.questionsIncludeArchivedLabel`("보관 챗봇 포함", 기본 체크됨). 변경 시 `questions` API만 재요청(§2.2) |
| 근사 안내 | 기존 `approximatedCaption` 그대로 재사용(변경 없음) |

---

## 3. G0 — 통합 통계 화면 (`/`)

### 3.1 목적

관리자가 **그룹(서비스) 단위 또는 전체 단위**로 누적 대화량·응답률·세션·분포·질문 순위를 한 화면에서 본다. 챗봇을 보관해도 합계가 줄지 않고, 그룹을 옮겨도 이동 전 누적이 바뀌지 않음을 화면이 보증한다(S-1~S-6).

### 3.2 레이아웃 (데스크톱, ASCII) — 전체(ALL) 스코프

```
┌───────────────────────────────────────────────────────────────────────────┐
│ TopBar: Chat Bot | 챗봇 목록                                                │
├───────────────────────────────────────────────────────────────────────────┤
│ 통계 범위  ●전체  ○그룹 [________▾]                                        │
│ (선택 결과는 스크린리더에 aria-live로 안내됩니다)                            │
├───────────────────────────────────────────────────────────────────────────┤
│ ⓘ 과거 데이터 정리 중 — 일부 대화가 집계에서 빠져 있습니다.                   │  ← backfillPending일 때만
├───────────────────────────────────────────────────────────────────────────┤
│ ┌────────┐ ┌────────┐ ┌────────┐ ┌──────────────┐                         │
│ │누적 턴  │ │누적응답률│ │누적세션 │ │챗봇 수        │                         │
│ │ 431,204│ │ 90.8%  │ │ 98,120 │ │운영12·초안3·보관2│                       │
│ └────────┘ └────────┘ └────────┘ └──────────────┘                         │
│ 2024-03-02부터 집계                                                        │
├───────────────────────────────────────────────────────────────────────────┤
│ 단위 ○일 ○주 ●월     기간 [2025-10-01]~[2026-09-24]                        │
├───────────────────────────────────────────────────────────────────────────┤
│ 대화 추이(월별)                                    [표로 보기]              │
│  ▂▃▅▇█▆▅▇█▇▆▅                                                              │
├───────────────────────────────────────────────────────────────────────────┤
│ 응답 출처 분포             │ 채널 분포        │ 시간대별 · 요일별            │
│ (그룹/전역이라 학습현황     │                  │                              │
│  딥링크 없음)               │                  │                              │
├───────────────────────────────────────────────────────────────────────────┤
│ 그룹별 기여                                                    [표로 보기]  │
│ ▾이름          상태        턴수▾    비중   응답률   세션    미응답            │
│  세무 서비스    -           128,420  62%   91.2%   31,044   3,120  → 클릭시  │
│  사업자 서비스   -            76,210  35%   88.0%   19,880   4,400   그룹    │
│  2024 이벤트    보관된 그룹    5,102   3%   79.4%    1,200      88   전환    │
│  기타 3개                     6,880   0.5%     -        -      -            │
│  정리 중(미귀속)               412    0.1%  85.0%      98       6            │
├───────────────────────────────────────────────────────────────────────────┤
│ 인기 질문 TOP 10 [보관 챗봇 포함 ☑]     │ 미응답 질문 TOP 10                │
│ 1. 배송 언제 오나요 (1,204건)           │ 1. 해외배송도 되나요 (44건)        │
│    최다 챗봇: 배송봇 통계 보기 →         │    최다 챗봇: 세무상담봇 통계보기→ │
└───────────────────────────────────────────────────────────────────────────┘
```

### 3.3 레이아웃 차이 — 그룹(GROUP) 스코프

```
├───────────────────────────────────────────────────────────────────────────┤
│ 통계 범위  ○전체  ●그룹 [세무 서비스 ▾]                                    │
├───────────────────────────────────────────────────────────────────────────┤
│ ┌────────┐ ┌────────┐ ┌────────┐ ┌──────────────┐                         │
│ │누적 턴  │ │누적응답률│ │누적세션 │ │챗봇 수        │                         │
│ │ 128,420│ │ 91.2%  │ │ 31,044 │ │운영2·초안0·보관1│                       │
│ └────────┘ └────────┘ └────────┘ └──────────────┘                         │
├───────────────────────────────────────────────────────────────────────────┤
│  … (추이·분포는 동일 구조, 데이터만 그룹 스코프) …                            │
├───────────────────────────────────────────────────────────────────────────┤
│ 챗봇별 기여                                                    [표로 보기]  │
│ ▾이름              상태          현재소속       턴수▾  비중  응답률 세션 미응답│
│  연말정산봇         운영중        -              79,600 62%  92%  19,200 1,880│
│  부가세봇           운영중        -              35,980 28%  90%   8,900 2,010│
│  종소세봇           초안          -               8,970  7%  85%   2,100   980│
│  2024 연말정산봇     보관됨·25-02-10 -             3,870  3%  70%     844   250│
│  구 부가세봇         운영중        현재: 사업자서비스  0    0%   -       0     0│
│  기타 0개                                              -    -    -    -    -  │
└───────────────────────────────────────────────────────────────────────────┘
```

### 3.4 상태별 UI

| 상태 | UI |
|---|---|
| 초기 로딩(5+1 API 동시 요청) | `ScopeSelector` 자리 스켈레톤, KPI 카드 자리 `SkeletonCard`×4, 추이/분포/기여표/순위 자리 `SkeletonRow`×N. **각 요청은 독립적으로 로딩·완료**(§2.2) |
| 부분 실패(5개 중 일부만 오류) | 실패한 영역에만 `ErrorState`(다시 시도는 그 영역만 재요청). 성공한 영역은 그대로 표시 |
| 그룹 선택기 원천(`groups`) 실패 | `ScopeSelector`는 "전체"만 선택 가능, 그룹 콤보박스 자리에 `ErrorState` 인라인 + 다시 시도 |
| `scope=GROUP`인데 `groupId` 없음(URL 직접 수정) | 그룹 콤보박스가 열린 상태로 대기, KPI·차트·표 영역은 `MESSAGES.integratedStats.scopeSelectPrompt`("그룹을 선택해 주세요.") 안내만(요청 자체를 보내지 않음, EX-I-2 선제 방지) |
| 존재하지 않는 `groupId`(`404 NOT_FOUND`) | 5개 영역 전체를 `ErrorState`로 대체: `MESSAGES.integratedStats.scopeNotFoundTitle`("선택한 그룹을 찾을 수 없습니다.") + 액션 버튼 `MESSAGES.integratedStats.scopeNotFoundAction`("전체 통계로 이동", 클릭 시 `scope=ALL`로 전환) |
| 기간 상한 초과(`400 STATS_RANGE_TOO_WIDE`) | `GranularityPeriodControl` 하단 인라인 오류(기존 문구 재사용) + 카드/차트는 직전 값 유지 |
| **빈 상태** — 스코프 내 로그 0건 | KPI 카드 4종은 모두 0/문자열 "운영 0 · 초안 0 · 보관 0"으로 정상 표시(오류 아님, AC-I2-5). 추이·분포·기여표·순위 영역은 `EmptyState`: "이 범위에 집계된 대화 기록이 없습니다." |
| 집계 타임아웃(`503 AGGREGATION_TIMEOUT`) | 해당 영역만 `ErrorState`: "집계에 시간이 오래 걸리고 있습니다. 잠시 후 다시 시도해 주세요." — **이전 값을 보여주지 않는다**(ADR-0004 40행 규약, S-8) |
| `backfillPending: true` | §2.3 배너 + (ALL 스코프) 기여 표에 `unassignedRow` |

### 3.5 컴포넌트 분해

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `IntegratedStatsPage` | 최상위. `useSearchParams`로 `scope`/`groupId`/`granularity`/`from`/`to`/`includeArchivedChatbots` 관리(§1 정규화 규칙 적용). 6개 API 훅(§2.2) |
| `ScopeSelector` | §2.1 |
| `BackfillPendingBanner` | §2.3 |
| `CumulativeKpiCards` | §2.4, `overview` 응답 바인딩 |
| `GranularityPeriodControl` | 기존 컴포넌트 그대로 재사용(변경 없음) |
| `StatsTrendChart` | 기존 컴포넌트 그대로 재사용. `buckets: summary.buckets`, `granularity` — `IntegratedSummarySchema`가 `StatsSummarySchema` 상위 호환이라 props 타입 변경 불필요 |
| `ResponseSourceDistribution` | `chatbotId` prop **없이** 호출(통합 스코프이므로 학습현황 딥링크 없음) — 컴포넌트 자체는 `chatbotId?: string`로 시그니처만 변경(§2.6과 동일 패턴) |
| `ChannelDistribution` · `HourWeekdayPanel` | 기존 컴포넌트 그대로(원래도 `chatbotId`를 쓰지 않음) |
| `SortableBreakdownTable` | §2.5 |
| `IntegratedQuestionsPanel` | §2.6 |

### 3.6 사용자 인터랙션 흐름

```
G0 진입(scope=ALL, 쿼리 없음)
  → groups 1회 호출(ScopeSelector 채움)
  → overview·summary·distribution·breakdown·questions 5개 병렬 호출
  → 각각 독립적으로 로딩→성공/실패 렌더

"그룹" 세그먼트 선택 → 콤보박스에서 "세무 서비스" 선택
  → URL: ?scope=GROUP&groupId=<uuid>
  → 5개 API 재요청(스코프만 교체, 기간 유지)
  → aria-live: "세무 서비스 통계로 전환되었습니다."

기여 표(ALL)에서 "세무 서비스" 행 클릭
  → setSearchParams({ scope: 'GROUP', groupId }) — 페이지 이동 없이 인플레이스 전환(위와 동일 결과)

기여 표(GROUP)에서 "연말정산봇" 행 클릭
  → /chatbots/<id>/stats/overview 로 이동(새 페이지)

질문 순위 "최다 챗봇: 배송봇 통계 보기 →" 클릭
  → /chatbots/<topChatbotId>/stats/overview 로 이동

"보관 챗봇 포함" 체크 해제
  → questions API만 includeArchivedChatbots=false로 재요청
  → 누적 KPI·추이·분포·기여표는 변화 없음(J-9)

챗봇 목록에서 "세무 서비스" 그룹의 kebab → "그룹 통계 보기" 클릭
  → / 로 이동, 쿼리가 이미 ?scope=GROUP&groupId=<uuid>로 채워진 상태로 진입(직접 5개 API 호출, ALL 기본값 스킵)
```

---

## 4. S1 변경 — 챗봇 통계 화면에 "의도별 매칭" 섹션 추가

### 4.1 목적·위치

`/chatbots/:chatbotId/stats/overview`(기존 S1, `stats-learning-ui-spec.md` §3)의 **맨 마지막에** 새 섹션 1개를 추가한다. 기존 섹션(카드 5종·추이·분포·이용 동향·질문 순위)의 순서·수치·컴포넌트는 **한 글자도 바꾸지 않는다**(FR-0-90, FR-I8-5).

### 4.2 레이아웃 (기존 화면 하단에 이어서)

```
│ … (기존 S1 레이아웃, stats-learning-ui-spec.md §3.2와 동일) …             │
├───────────────────────────────────────────────────────────────────────────┤
│ 의도별 매칭                              비율 기준 ●의도 매칭 턴 대비 ○전체 턴 대비│
│ 총 1,240턴 · 의도 매칭 980턴 · 미매칭 260턴 · 서로 다른 의도 14개            │
│ [표로 보기 불필요 — 이미 표 형태]                                          │
│ ▾의도명            매칭턴   비율    응답률                                 │
│  환급일_문의         178   18.2%   94.0%   → 의도 편집                    │
│  공제_항목           119   12.1%   91.0%   → 의도 편집                    │
│  삭제된 의도(a1b2c3d4) 8    0.8%    50.0%   (링크 없음)                    │
│  기타                 …     …       …                                     │
│  의도 미매칭          260   26.5%     -     (전체 턴 대비일 때만 표시)      │
└───────────────────────────────────────────────────────────────────────────┘
```

### 4.3 상태별 UI

| 상태 | UI |
|---|---|
| 로딩 | 기존 S1 섹션들과 **독립적으로** `SkeletonRow`(별도 API 호출, `GET /stats/intents`) |
| 성공(매칭 있음) | 위 레이아웃 |
| 빈 상태(의도 매칭 0건) | `EmptyState`: `MESSAGES.stats.intentEmptyTitle`("매칭된 의도가 없습니다.") |
| 부분 실패 | 이 섹션에만 `ErrorState` + 다시 시도(다른 섹션 영향 없음, 기존 F-3 원칙 승계) |
| 기간 상한 초과 | 기존 `GranularityPeriodControl`의 오류와 동일하게 공유(같은 기간 파라미터를 쓰므로 별도 컨트롤 없음 — 이 섹션은 S1의 기존 `granularity`/`from`/`to` 상태를 그대로 구독) |

### 4.4 컴포넌트 분해

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `IntentMatchSection` | `chatbotId`, `granularity`/`from`/`to`(S1 상위 상태 재사용 — 새 기간 컨트롤을 만들지 않는다), `GET /stats/intents` 응답 |
| `IntentDenominatorToggle` | 라디오 2개: `MESSAGES.stats.intentDenominatorMatched`(기본 선택) / `MESSAGES.stats.intentDenominatorAll`. 서버가 두 비율(`shareOfIntentMatched`/`shareOfAll`)을 이미 함께 반환하므로 **추가 요청 없이 클라이언트에서 열 전환**(F-1 — 서버 값을 표시만 한다는 원칙과 일치, 재계산 아님) |
| `IntentTable` | 열: 의도명(링크 또는 "삭제된 의도(ID 앞 8자리)") · 매칭 턴 · 비율(토글값) · 응답률. `deleted===true`면 링크 없이 텍스트만, `title` 속성으로 "이 의도는 삭제되었습니다" 부연 |
| `IntentSummaryLine` | `MESSAGES.stats.intentSummary(total, matched, unmatched, distinct)` |
| "의도 미매칭" 행 | `unmatchedTurnCount` — `전체 턴 대비` 토글일 때만 표에 포함(의도 매칭 턴 대비 비율은 정의상 이 행에 적용되지 않으므로 숨김) |
| "기타" 행 | `othersTurnCount`(topN 초과분) |

의도명 클릭 → `/chatbots/:id/dialogue/intents?intentId=<id>`(의도 편집 화면, `intents` 서브내비의 기존 필터 파라미터 재사용 — `frontend-implementer`가 해당 화면의 쿼리 지원 여부를 착수 전 확인).

### 4.5 사용자 인터랙션 흐름

```
S1 화면 하단까지 스크롤
  → IntentMatchSection이 GET /stats/intents(같은 chatbotId·기간) 호출(기존 3개 API와 독립적인 4번째 요청)
  → 표 렌더, 기본 = 의도 매칭 턴 대비 비율
"전체 턴 대비" 라디오 선택 → 같은 응답 데이터에서 비율 열만 재계산 없이 전환(shareOfAll 필드로 교체), "의도 미매칭" 행 노출
"환급일_문의" 클릭 → /chatbots/:id/dialogue/intents?intentId=... 이동
```

---

## 5. 챗봇 목록 · 그룹 관리 화면 변경 (P-4, FR-I1-5, FR-I2-5/6)

기존 화면(`chatbot-operations-ui-spec.md` §3.1/§4.4, 실 구현 `ChatbotListPage.tsx`/`chatbot-list/modals.tsx`)의 **라우트·API 호출·상태 전이는 불변**이다. 아래 문구·항목만 추가한다.

| 대상 | 변경 | 근거 |
|---|---|---|
| `GroupTree.tsx`(그룹 행 kebab 메뉴) | 메뉴 최상단에 **"그룹 통계 보기"** 항목 추가(읽기 동작이라 이름수정/복사/삭제 위에 배치) → `/?scope=GROUP&groupId=<id>` | FR-I8-2 |
| `ArchiveConfirmDialog`(챗봇 보관 확인) | 기존 문구("보관 처리하면 목록에서 숨겨지며…") **아래에 한 줄 추가**: `MESSAGES.chatbot.archiveStatsNotice`("보관해도 이 챗봇의 대화 기록은 그룹 통계에 계속 포함됩니다.") | FR-I1-5 |
| `MoveGroupModal`(그룹 이동) | 대상 그룹 선택 필드 아래에 안내 문구 추가: `MESSAGES.chatbot.moveStatsNotice(현재그룹명)`("이동 이후의 대화만 새 그룹에 집계됩니다. 이동 전 대화는 '세무 서비스' 통계에 남습니다.") | FR-I2-5 |
| `DeleteGroupConfirmDialog`(그룹 삭제) | 기존 "삭제하시겠습니까? 되돌릴 수 없습니다" 문구를 대체: `MESSAGES.group.deleteConfirmStatsNotice`("대화 기록이 있는 그룹은 목록에서 사라지지만 통합 통계에는 '보관된 그룹'으로 남습니다. 기록이 없는 빈 그룹은 완전히 삭제됩니다.") — **API 응답이 두 경우 모두 동일한 `204`라서 프런트는 어느 쪽이 일어났는지 알 수 없다.** 성공 토스트는 기존 `group.deleteSuccess`("그룹이 삭제되었습니다.") 그대로 두되, 이 사전 안내로 두 결과 모두를 미리 알린다(§11 미결정 사항 1건 참고) | FR-I2-6, ADR-0033 §5 |
| `PermanentDeleteModal`(영구 삭제, 409 배너) | `CHATBOT_HAS_CHILDREN` 오류 배너를 **서버 메시지 + 보조 문구 2줄**로: 1행 `e.message`(서버 원문, 기존 그대로) / 2행 `MESSAGES.chatbot.permanentDeleteStatsHint`("대화 기록이 있는 챗봇은 통계 보존을 위해 영구삭제할 수 없습니다. 보관 상태로 유지하세요.") | FR-I1-5 |

이 5건 모두 **응답 코드·조건 분기는 그대로**이며(§11 R-6, ADR-0002 불변), 화면은 사용자가 결과를 미리 예측하도록 돕는 안내문 추가에 한정된다.

---

## 6. 권한별 UI 변화 규칙

`stats:read`를 신설하지 않으므로(P-7) 이 그룹에 새 권한 분기는 없다. `chatbot:read` 보유자(ADMIN/EDITOR/VIEWER 전원, ADR-0015 48행)는 G0·S1의 "의도별 매칭" 섹션을 동일하게 조회한다. 이 그룹에 **쓰기 액션이 없으므로**(§2.1 역할표, `integrated-stats.md`) `dialogue:write` 등 숨김 처리 대상 버튼도 없다 — 유일한 조회 이후 이동(딥링크)은 기존 화면의 권한 규칙을 그대로 따른다(예: 의도 편집 링크는 `dialogue:read` 이상이면 보이되 실제 수정은 `dialogue:write`가 그 화면에서 판정).

| 화면 | 요소 | VIEWER | EDITOR | ADMIN |
|---|---|---|---|---|
| G0 | 전체 화면(조회) | 표시 | 표시 | 표시 |
| S1 하단 "의도별 매칭" | 조회 | 표시 | 표시 | 표시 |
| 그룹/챗봇 확인 대화상자 문구 | 보관·이동은 `chatbot:write`, 그룹 삭제는 `group:write`(기존 권한 매트릭스 불변) — 이번 변경은 **문구만** | 기존과 동일 | 기존과 동일 | 기존과 동일 |

---

## 7. `UIUX_준수기준.md` 체크리스트 매핑

### 7.1 공통(G0·S1 신규 부분)

| 기준 | 항목 | 적용 |
|---|---|---|
| §1 색상대비 | 색상 단독 금지 | 기여 표 배지(보관됨/현재 다른 그룹/보관된 그룹/알 수 없는 그룹) 전부 아이콘+텍스트(§2.5), 분포 차트는 기존 `ChartFrame` 패턴(사선/점 패턴) 그대로 승계 |
| §3 키보드접근성 | Tab/Enter/Space, 모달 Esc | `ScopeSelector` 세그먼트+콤보(방향키), `SortableBreakdownTable` 헤더 버튼(신규 `aria-sort` 규칙, §11 준수기준 보강분), `IntentDenominatorToggle` 라디오 |
| §4 버튼 | 동사형, 44×44px | "다시 시도"/"전체 통계로 이동"/"표로 보기", 정렬 헤더 버튼도 터치 영역 44×44px 확보(모바일 표 대응 §9) |
| §5 텍스트 입력 | — | 이 그룹에 텍스트 입력 필드 없음(조회 전용) — 해당 없음 |
| §6 폼 컨트롤 | 단일선택=라디오/셀렉트, 다중선택=체크박스 | 스코프(라디오 2)·단위(라디오 3, 기존)·의도 비율 기준(라디오 2)는 라디오, "보관 챗봇 포함"은 단일 온오프 체크박스(기존 "보관됨 포함" 필터와 동일 관용구) |
| §7 오류 메시지 | 원인+해결방법 | `scopeNotFoundTitle`+action, `STATS_RANGE_TOO_WIDE` 인라인(기존 재사용), 409/영구삭제 보조 문구(§5) |
| §8 로딩/상태 | 스켈레톤, 완료 배지, 신규 "부분 정정 상태" | `SkeletonCard`/`SkeletonRow`(기존 재사용), `BackfillPendingBanner`(신규 준수기준 §8 항목 직접 적용) |
| §9 내비게이션 | href 기반, 페이지네이션 이중 표시 | 기여 표 행 클릭은 `<button>`/`<a>` 기반(마우스+키보드 동일 동작), G0은 페이지네이션이 없음(상한 200+기타 행으로 대체) |

### 7.2 화면별 특기 사항

| 화면 | 항목 | 지점 |
|---|---|---|
| G0 KPI 카드 | §8 완료 상태 표시 | 0건도 "정상 완료"로 표시(오류 아님), `firstDayBucket` null 캡션으로 명시 |
| G0 기여 표 | §3 신규 aria-sort 규칙 | `SortableBreakdownTable` — 이번 작업으로 `UIUX_준수기준.md` §3에 직접 추가한 규칙의 첫 적용 사례 |
| G0 스코프 선택기 | §6 셀렉트 자동 제출 금지 | 세그먼트 변경은 "필터 재조회"이지 폼 제출이 아니므로 UIUX §6의 금지 대상이 아님(stats-learning-ui-spec.md §8.2 동일 해석 승계) |
| S1 의도별 매칭 | §1 색상 단독 금지 | 삭제된 의도는 색이 아니라 "삭제된 의도" 텍스트 + 링크 부재로 구분 |

### 7.3 자동화 연계

AC-I6-8(키보드만으로 스코프·기간·토글·정렬 조작 완주, axe 대비 위반 0건)은 `test-automation` 검증 대상이며, 이 문서의 `ChartFrame`/`MetricCard` 재사용과 `SortableBreakdownTable`의 `aria-sort`/`aria-live` 규약이 그 전제 조건이다.

---

## 8. 반응형 레이아웃 원칙

`stats-learning-ui-spec.md` §10의 브레이크포인트·원칙을 그대로 상속하고 이 화면 고유의 차이만 추가한다.

| 브레이크포인트 | 폭 | 레이아웃 변화 |
|---|---|---|
| 데스크톱 | ≥ 1024px | `ScopeSelector` 가로 1줄. KPI 카드 4장 가로 1줄. 분포 3열(출처/채널/시간대·요일). 기여 표는 전 열 노출 |
| 태블릿 | 640–1023px | KPI 카드 2×2. 분포 2열→1열 순차 줄바꿈. 기여 표는 "현재 다른 그룹"/"보관일" 보조 텍스트를 배지 아래 줄로 이동(열 수는 유지, 셀 내부만 줄바꿈) |
| 모바일 | < 640px | KPI 카드 세로 스택. 모든 `ChartFrame`이 기본값을 **표 보기**로 시작(기존 S1 원칙 재사용). 기여 표는 카드 리스트(`BreakdownCard` — 이름/배지/턴수/비중을 라벨+값 스택, 나머지 지표는 펼침)로 전환. `ScopeSelector`의 그룹 콤보박스는 전체 폭 |

공통 원칙: `BackfillPendingBanner`는 모바일에서도 문서 흐름 상단에 위치(sticky 아님, 기존 배너류와 동일). `SortableBreakdownTable`의 표 보기는 모바일에서 가로 스크롤 컨테이너로 감싼다(기존 `StatsTrendChart` 표 대응과 동일 처리).

---

## 9. 사용자 인터랙션 흐름 총괄(제출 → 로딩 → 결과, 오류 포함)

§3.6·§4.5에 화면별로 기술한 흐름 외에, 화면 간 이동을 포함한 대표 시나리오 3건을 정리한다(요구사항 S-1~S-9 대응).

### 9.1 월간 서비스 보고 (S-1)

```
로그인 → 콘솔 홈(G0, scope=ALL) 진입
  → "그룹" 선택 → "세무 서비스" 선택 → 단위 "월"로 전환
  → 누적 카드 + 월별 추이 + 챗봇별 기여 표 확인
  → 기여 표 "2024 연말정산봇(보관됨, 2025-02-10)" 행에서 3% 기여 확인(S-1)
```

### 9.2 챗봇 보관 후 유지 확인 (S-2)

```
챗봇 목록 → "2024 연말정산봇" 행 "삭제" → ArchiveConfirmDialog
  → "보관해도 이 챗봇의 대화 기록은 그룹 통계에 계속 포함됩니다" 확인 → 확인
  → 204 → 목록에서 숨김
  → G0(scope=GROUP, groupId=세무서비스) 재방문 → 누적 대화 수 보관 전과 동일 → 기여 표에 "보관됨" 배지로 남음
```

### 9.3 그룹 삭제와 보관된 그룹 (S-4)

```
챗봇 목록 → "2024 이벤트" 그룹(챗봇 0개, 과거 대화 있음) kebab → "그룹 삭제"
  → DeleteGroupConfirmDialog: "대화 기록이 있는 그룹은 목록에서 사라지지만 통합 통계에는
    '보관된 그룹'으로 남습니다…" 확인 → 확인
  → 204 → GroupTree에서 사라짐
  → G0 → 그룹 콤보박스 "보관된 그룹" 구역에서 "2024 이벤트" 선택 가능 → 과거 수치 그대로 조회
```

---

## 10. `messages.ts` 추가 문구 키 목록

`apps/web/src/constants/messages.ts`에 아래를 추가한다. 값은 이 문서의 인용 문구를 초안으로 삼는다(§2~§5의 굵은 인용이 정본).

### 10.1 신규 네임스페이스 `MESSAGES.integratedStats`

```
pageTitle, backToChatbotList,
scopeLegend, scopeAll, scopeGroup, scopeGroupSelectLabel, scopeGroupPlaceholder,
scopeArchivedSectionLabel, scopeDuplicateNameSuffix(date), scopeTruncatedNotice,
scopeChangeAnnounce(label), scopeSelectPrompt, scopeNotFoundTitle, scopeNotFoundAction,
kpiCumulativeTurnLabel, kpiCumulativeResponseRateLabel, kpiCumulativeSessionLabel,
kpiCumulativeSessionCaption, kpiChatbotCountLabel, kpiChatbotCountValue(active,draft,archived),
kpiCollectionStart(date), kpiCollectionStartEmpty,
backfillPendingBanner,
breakdownTitleGroup, breakdownTitleAll,
breakdownColumnName, breakdownColumnStatus, breakdownColumnTurn, breakdownColumnShare,
breakdownColumnResponseRate, breakdownColumnSession, breakdownColumnUnanswered,
breakdownArchivedBadge(date), breakdownCurrentGroupBadge(name), breakdownArchivedGroupBadge,
breakdownMissingGroupBadge, breakdownOthersRow(n), breakdownUnassignedRow, breakdownUnassignedCaption,
breakdownSessionCaveat, breakdownRowClickHintChatbot, breakdownRowClickHintGroup,
breakdownSortAnnounce(col, dir), breakdownEmptyTitle,
questionsIncludeArchivedLabel, questionsTopChatbotColumn, questionsTopChatbotLink(name),
questionsNoTopChatbot,
emptyScopeTitle,
groupStatsLinkLabel(name)
```

### 10.2 기존 `MESSAGES.stats` 네임스페이스 추가(의도별 매칭, §4)

```
intentSectionTitle, intentDenominatorLegend, intentDenominatorMatched, intentDenominatorAll,
intentColumnName, intentColumnTurn, intentColumnShare, intentColumnResponseRate,
intentDeletedLabel(idPrefix), intentDeletedTitle, intentUnmatchedRow, intentOthersRow,
intentSummary(total, matched, unmatched, distinct), intentEmptyTitle, intentEditLink,
intentErrorTitle
```

### 10.3 기존 `MESSAGES.group` 네임스페이스 추가(§5)

```
menuStats: '그룹 통계 보기',
deleteConfirmStatsNotice: "대화 기록이 있는 그룹은 목록에서 사라지지만 통합 통계에는 '보관된 그룹'으로 남습니다. 기록이 없는 빈 그룹은 완전히 삭제됩니다.",
```

### 10.4 기존 `MESSAGES.chatbot` 네임스페이스 추가(§5)

```
archiveStatsNotice: '보관해도 이 챗봇의 대화 기록은 그룹 통계에 계속 포함됩니다.',
moveStatsNotice: (currentGroupName: string) =>
  `이동 이후의 대화만 새 그룹에 집계됩니다. 이동 전 대화는 '${currentGroupName}' 통계에 남습니다.`,
permanentDeleteStatsHint: '대화 기록이 있는 챗봇은 통계 보존을 위해 영구삭제할 수 없습니다. 보관 상태로 유지하세요.',
```

기존 `MESSAGES.group.deleteConfirmDesc`는 §5 표에 따라 `deleteConfirmStatsNotice`로 **대체**한다(두 문구를 병기하지 않는다 — 되돌릴 수 없다는 경고보다 "보관/완전삭제 분기"가 더 정확한 정보이므로).

---

## 11. `frontend-implementer` 인계 메모

1. **구현 순서 권고**: ① `App.tsx`에서 `/` 라우트를 `IntegratedStatsPage`로 교체(빈 골격 + `ScopeSelector`만 먼저) ② `ResponseSourceDistribution`/`TopQuestionsPanel`의 `chatbotId`를 optional로 바꾸고 기존 S1 화면이 회귀 없는지 먼저 확인(가장 리스크가 높은 변경 — 기존 딥링크 렌더 조건 유지) ③ `CumulativeKpiCards`·`SortableBreakdownTable`(신규 컴포넌트 2개) ④ G0 전체 조립 ⑤ 챗봇 목록·모달 문구 보강(§5, 독립적으로 진행 가능) ⑥ S1 하단 `IntentMatchSection`.
2. **의존 스키마**: `packages/shared-types/src/stats.ts`의 `IntegratedOverviewSchema`/`IntegratedSummarySchema`/`IntegratedDistributionSchema`/`IntegratedQuestionsSchema`/`IntegratedBreakdownSchema`/`IntegratedGroupOptionsSchema`/`IntentStatsSchema`(설계서 §8.2) — `backend-implementer` 산출물로 존재한다는 전제다.
3. **미해결 사항(§5 표 각주)**: 그룹 삭제 API가 물리 삭제/보관 중 어느 쪽이 일어났는지 응답으로 구분하지 않는다(설계 §4.3 "두 경우 응답 동일"). 필요하면 `backend-implementer`에게 `204` 대신 `{ mode: 'ARCHIVE'|'PURGE' }` 바디 추가를 **선택 사항**으로 문의할 수 있으나, 이번 설계는 이를 요구하지 않는다(사전 안내 문구만으로 사용자에게 두 결과 모두를 예고).
4. **차트 라이브러리**: 도입하지 않는다(FR-I8-4, §0-1). 신규 SVG 컴포넌트는 `StatsTrendChart`/`BarChartSvg` 기존 자산을 그대로 쓰고, 새 시각화(기여 표)는 SVG가 아니라 표이므로 차트 재사용 이슈 자체가 없다.
5. **정렬 상태 관리**: `SortableBreakdownTable`의 정렬은 서버 재요청 없이 클라이언트 메모리 정렬이다(최대 200행+고정행 2개, 성능 문제 없음). 정렬 상태는 URL에 반영하지 않는다(스코프/기간만 공유 가능한 상태로 취급, 정렬은 화면 UX로 한정).
6. **문구 이관**: `MESSAGES.group.deleteConfirmDesc`를 대체하는 변경(§10.3)은 기존 스냅샷 테스트(`ChatbotListPage.spec.tsx` 등)에 영향을 줄 수 있으니 `frontend-implementer`가 해당 테스트를 함께 갱신한다.
7. **G0의 `IntegratedStatsPage` 파일 위치 권고**: `apps/web/src/pages/integrated-stats/`(신규 디렉터리, `pages/stats/`와 대칭되는 명명) — `DashboardHomePage.tsx`는 삭제하거나 `IntegratedStatsPage.tsx`로 개명한다(설계서 §2.5가 "`DashboardHomePage.tsx:4-13` 대체"라고 명시했으므로 완전 교체가 원칙).

---

## 12. `UIUX_준수기준.md` 변경 내역 (이번 작업)

이 문서를 작성하며 `docs/03-design/UIUX_준수기준.md`에 아래 2건을 **최소 추가**했다(기존 항목은 수정하지 않음):

1. **§3 키보드 접근성** — 정렬 가능한 표 헤더의 `<button>` + `aria-sort` + `aria-live` 규칙 신설(`SortableBreakdownTable`, §2.5의 근거).
2. **§8 로딩/상태 피드백** — 여러 스코프를 합산하는 화면의 "부분 정정 상태"(백필 대기 등) 배너 규칙 신설(`BackfillPendingBanner`, §2.3의 근거).
3. **§참고**에 위 2건의 근거 문서 각주 1줄 추가(날짜 2026-09-24).
