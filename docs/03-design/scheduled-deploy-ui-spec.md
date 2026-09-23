# 운영 예약 배포 (No.28) — 화면 설계서

> **대상 기능**: No.28 운영 예약 배포 — 전부 관리자 콘솔(`apps/web`) 기능이며 `apps/widget`은 건드리지 않는다(동작 결과가 위젯 동작에 영향을 주지만, 위젯 화면 자체는 변경 0건 — S-8/S-9는 기존 규약대로 동작).
> **입력 문서**: `docs/requirements/scheduled-deploy.md`(J-1~J-15, FR-0-78~87, FR-D1~D7-\*, NFR-DP/DS/DA/DM, AC-D1~D6, S-1~S-11, EX-D-1~20, §11 PM 확정 P-1~P-12), `docs/02-spec/scheduled-deploy-설계.md`(§1~§16, API 13개, Prisma 1테이블 + 부분 유니크 2개, 신규 `ApiErrorCode` 6종, §12 준비도 경고 9종, §13 API 계약, §14 시간대), `docs/02-spec/decisions/ADR-0032-scheduled-deploy-one-shot-actions-and-db-claimed-polling.md`
> **PM 확정**(2026-09-23, 전부 권장안): 동작 3종(`RESTORE_VERSION`/`PUBLISH`/`SET_WEB_CHANNEL`) · misfire 유예 10분 · 실행 전 TC 게이트 없음(G0/G0'만) · G3(실행 직후 TC, 보고만) 선택·기본 꺼짐 · 엄격 해시 바인딩(강행 옵션 없음) · 체인 실패 시 후속 전부 `HELD` · 한도(활성 5건·리드 5분·최대 90일·간격 1분) · 수정은 시각·메모만 · 복원 예약은 append-only(끼워넣기 불가, D-4) · "확인함"은 관리 권한 필요(VIEWER 불가) · 알림은 콘솔+감사로그만
> **준수 기준**: `docs/03-design/UIUX_준수기준.md`(전 항목, 특히 §1 색상단독금지·§3 키보드·§4 버튼·§5 텍스트입력·§7 오류메시지·§8 로딩/비동기·§9 내비게이션)
> **재사용 대상**: `version-history-ui-spec.md`(§4.4 `RestoreDialog`/`RestoreBlockerList`/`RestoreWarningList`/`RestoreResultPanel` — 미리보기·blockers·warnings 컴포넌트 전부 재사용, §3.3 고정 시각 언어 관행, §1 정보구조 판단 방식), `validation-regression-ui-spec.md`(`TestRunListPage`+`TestRunDetailPage` 목록+상세 분리 패턴, `POLL_INTERVAL_MS` RUNNING 폴링 관행), `stats-learning-ui-spec.md`(`NavPendingBadge` 배지 관행)
> **실제 코드 확인**: `apps/web/src/App.tsx`(라우트 전체), `apps/web/src/pages/chatbot-detail/TabNav.tsx`(10라우트·4그룹 — 운영4/설계1/검증3/배포2, No.25가 이미 "버전 이력"을 운영 그룹에 추가한 상태), `apps/web/src/components/TopBar.tsx`+`SystemSettingsMenu.tsx`(전역 메뉴 — 사용자/금지어/감사로그 3항목), `apps/web/src/pages/chatbot-detail/StatusTransitionControls.tsx`(상태 전이 3버튼), `apps/web/src/pages/chatbot-detail/channels/ChannelCard.tsx`(채널 카드 액션 바), `apps/web/src/pages/chatbot-detail/versions/VersionListPage.tsx`+`restore/RestoreDialog.tsx`(No.25 구현체 — 209행 `handleConfirm`의 409 분기), `apps/web/src/pages/chatbot-list/ChatbotTable.tsx`+`ChatbotListPage.tsx`, `apps/web/src/pages/stats/NavPendingBadge.tsx`, `apps/web/src/constants/messages.ts`(`MESSAGES.versions.restore.*` 확인)
> **작성**: ui-designer · 2026-09-23 · **다음 단계**: `backend-implementer`(설계서 §2~§16 구현 후) → `frontend-implementer`
> **범위 경계**: React 컴포넌트 실제 코드는 작성하지 않는다. `apps/widget`은 이 그룹과 무관하다(전부 관리자 콘솔).

---

## 0. 전제와 연계 확인

1. **API·데이터 스키마는 설계서 기준으로 아직 구현되지 않은 확정 계약이다.** `packages/shared-types/src/deploy-schedule.ts`(설계서 §3) — `DeployScheduleAction`/`DeployScheduleStatus`/`CreateDeployScheduleSchema`/`DeployScheduleListItemSchema`/`DeployScheduleDetailSchema`/`DeploySchedulePreviewResponseSchema`/`DeployScheduleMetaSchema`/`DeployScheduleSummarySchema`/`DeployScheduleNoticeSchema` 등은 **아직 코드에 없다**. `backend-implementer`가 구현한 뒤 본 문서 기준으로 화면을 만든다(No.25와 동일한 전제).
2. **기존 10개 라우트는 하나도 바꾸지 않는다.** `TabNav.tsx`(실제 코드 확인)는 이미 운영4(대시보드·통계·기본설정·**버전 이력**)·설계1·검증3·배포2(스킨/임베드·채널) 구조다. 이 문서는 **"배포" 그룹에 3번째 탭 1개**만 추가한다(§1).
3. **`packages/dialogue-engine` 변경 0건**(FR-0-78) — 화면은 엔진 산출물을 다루지 않는다. 예약이 다루는 것은 ① 버전 스냅샷 복원(No.25 경로 그대로) ② 상태 전환 ③ 채널 `enabled` 뿐이다.
4. **No.25 컴포넌트를 최대한 재사용한다.** `RestoreDialog`의 미리보기·blockers·warnings 렌더링 로직, `RestoreBlockerList`/`RestoreWarningList`의 문구 매핑, `VersionTriggerBadge`/`ChangeKindBadge`의 "아이콘+색+텍스트" 3중 표현 관행을 그대로 따른다. **완전히 새로 만드는 것은 "동작 선택 + 시각 입력 + 준비도 경고 + 확정" 단계뿐**이다(§4.3).
5. **기존 `RestoreDialog.tsx`에 1개 분기를 추가해야 한다**(설계서 §9.1, 이 문서 과제 (9)): `handleConfirm`의 409 오류 분기(179행)에 `RESTORE_BUSY`를 `RESTORE_PREVIEW_STALE`/`RESTORE_BLOCKED_BY_ACTIVE_JOB`과 **같은 그룹**으로 추가한다(§4.6.1). 이 변경은 **No.25 화면(즉시 복원)에도 적용**되며 예약 생성/재개 다이얼로그와 **같은 오류 코드·같은 UX**를 공유한다.
6. **신규 권한 0종**(J-8). 조회 `chatbot:read`. 쓰기(생성·수정·취소·재개)는 **동작별로 다르다**(§6). "확인함"은 조회 권한이 아니라 **관리 권한**(동작별 쓰기 권한 중 하나 이상)이 필요하다 — VIEWER는 "확인함" 버튼도 렌더되지 않는다(PM 확정 사항, 설계서 §8.2 ①의 "관리 권한 중 하나라도" 판정과 정합).
7. **시간대**: 저장은 UTC 순간, 표시·입력은 `STATS_TIMEZONE`(기본 `Asia/Seoul`) 기준이며 `GET /deploy-schedules/meta`에서 값을 받는다(J-12). 화면의 모든 시각에는 **항상 `(KST, UTC+9)` 같은 시간대 라벨을 병기**한다(NFR-DA1).
8. **신규 화면의 모든 한국어 문구는 `MESSAGES.deploySchedules.*` 네임스페이스로 상수화**한다(§8). 탭 라벨 신규 키 `MESSAGES.detail.tabDeploySchedules`, 전역 메뉴 신규 키 `MESSAGES.systemSettings.deploySchedules` 1개씩 추가.
9. **알림은 콘솔 + 감사로그뿐**(J-10) — 이메일·웹소켓 등을 이 문서가 요구하지 않는다. "확인 필요" 표시는 전부 **주기 조회 기반**이다(§9).
10. **데이터 바인딩 기준 스키마**는 설계서 §3(`deploy-schedule.ts`)·§13(API 계약 13개)·§12(준비도 경고 9종)·§7.6(재시도/실패 사유 표)·§4.3(상태 기계)이다.

---

## 1. 정보구조 판단 — "배포" 그룹에 3번째 탭("예약 배포") 추가 + 전역 메뉴에 통합 현황 페이지

### 1.1 현재 상태 확인 (코드 근거)

`TabNav.tsx`(실제 코드)는 4개 시각적 그룹, 10개 라우트다:

| 그룹 | 포함 탭(현재) |
|---|---|
| 운영(4) | 대시보드 · 통계 · 기본설정 · **버전 이력**(No.25) |
| 설계(1) | 대화설계 |
| 검증(3) | AI 답변 설정 · 응답 테스트 · 대화검증 |
| 배포(2) | 스킨/임베드 · 채널 |

### 1.2 검토한 대안

| 안 | 내용 | 판정 |
|---|---|---|
| A. "버전 이력" 탭 안에 서브 라우트로 통합(예약 목록을 그 탭의 2번째 뷰로) | 라우트 신설 0건 | **기각** — 예약은 `RESTORE_VERSION` 1종만이 아니라 `PUBLISH`·`SET_WEB_CHANNEL`도 다룬다(J-1). "버전 이력" 탭에 상태 전환·채널 예약까지 넣으면 탭의 의미가 "버전을 다루는 화면"에서 "예약을 다루는 화면"으로 뒤바뀌어 이름과 내용이 어긋난다. version-history-ui-spec.md §1.2-A가 "레일에 성격이 다른 것을 섞으면 오인을 유발한다"고 기각한 것과 같은 근거다. |
| B. "운영" 그룹에 5번째 탭으로 추가 | 라우트 신설 1개, 운영 그룹 4 → 5항목 | **기각** — `version-history-ui-spec.md` §9의 재검토 트리거("'운영' 그룹에 5번째 최상위 탭 요구가 들어올 때 — 셸 재구성 재검토")를 **정확히 발동시킨다**. 셸 재구성은 이 그룹의 범위를 벗어나는 별도 리팩터링이며, 지금 필요한 것은 "운영 지표를 보는 화면"이 아니라 "배포 동작을 예약하는 화면"이라 애초에 운영 그룹과 멘탈모델이 다르다(아래 1.3-③). |
| C. "배포" 그룹에 3번째 탭으로 추가(**채택**) | 라우트 신설 1개, 배포 그룹 2 → 3항목 | **채택** |
| D. 신규 최상위 그룹("운영관리") 신설 | 그룹 5개로 확장 | **기각** — 항목 1개짜리 그룹은 `quality-channel-ui-spec.md` §2.4가 정한 "그룹은 2항목 이상일 때만 분리 표시" 관행에 어긋나고, 지금 배포 그룹이 정확히 이 항목을 받아들일 자리를 이미 가지고 있다(아래). |

### 1.3 C를 채택하는 근거

1. **카탈로그 원문·요구사항 문서가 이미 "배포"라는 이름을 쓴다.** No.28 이름 자체가 "운영 **예약 배포**"이고, 요구사항 §1.4 목적 1번은 "이미 검증된 반영 동작이... 정확히 한 번 실행되게 한다"다. "배포"는 "제작(설계)도 검증도 아닌, 만든 것을 내보내는 단계"라는 정확히 기존 "배포" 그룹(스킨/임베드=위젯 노출·채널=공개 경로)의 정의와 일치한다.
2. **동작 3종이 전부 "배포"가 다루는 대상과 겹친다.** `PUBLISH`는 상태 전환(공개 여부), `SET_WEB_CHANNEL`은 정확히 "채널" 탭이 다루는 대상(WEB `enabled`)이다. `RESTORE_VERSION`만 성격이 다르지만, 예약이라는 행위 자체("지정 시각에 반영")는 세 동작 모두에 공통이므로 **엔티티(`DeploySchedule`) 1개를 1개 화면군에서 다루는 것**이 세 곳에 흩어 놓는 것보다 일관적이다.
3. **진입점은 여러 화면에 흩어지지만(FR-D7-2), "관리"는 한 곳에 모인다.** 버전 이력 행의 "예약 복원", 기본설정의 "공개 예약", 채널 카드의 "열기/닫기 예약"은 각자의 문맥에서 **생성 대화상자**를 여는 진입점일 뿐이고, 생성된 예약을 **보고·수정·취소·확인**하는 것은 이 탭 하나다 — No.25가 "여러 화면에서 트리거되지만 결과는 한 곳(버전 이력)에 쌓인다"고 설계한 것과 동일한 패턴이다(`autoSnapshot` 트리거 8지점 vs 버전 이력 탭 1곳).
4. **그룹 폭이 기존 최대치(3)를 넘지 않는다.** "배포" 그룹이 2 → 3항목이 되어도 "검증" 그룹이 이미 3항목이라 반응형 규칙(`quality-channel-ui-spec.md` §2.4 — 태블릿 그룹 단위 줄바꿈)이 그대로 적용된다.
5. **"운영" 그룹의 5항목 재검토 트리거를 소비하지 않는다.** 이 기능이 "운영" 그룹으로 갔다면 그 트리거가 지금 발동해야 했다. "배포" 그룹으로 가면 두 그룹 모두 기존 최대치(3) 이내로 유지되어 **셸 재구성이라는 별도 작업을 만들지 않는다.**

### 1.4 전역 통합 현황 — `SystemSettingsMenu`에 1항목 추가

FR-D3-1의 "전체 챗봇 통합" 목록(운영 화면)은 **탭 안의 화면이 아니라 전역 화면**이다(관리자가 특정 챗봇 문맥 밖에서 "오늘 밤 실행될 예약이 뭐가 있나"를 확인하는 용도, 전역 감사로그·사용자 관리와 같은 성격). `SystemSettingsMenu.tsx`(실제 코드 — 사용자/금지어/감사로그 3항목, 권한별 필터링)에 **4번째 항목**을 추가한다:

```ts
{ label: MESSAGES.systemSettings.deploySchedules, href: '/settings/deploy-schedules', permission: 'chatbot:read' }
```

`chatbot:read`는 사실상 모든 로그인 사용자가 보유하므로(요구사항 문서 전제) 이 메뉴는 VIEWER에게도 보인다 — **VIEWER도 예약 현황을 조회할 수 있어야 한다**(요구사항 S-10과 동일한 조회 허용 원칙). 메뉴 트리거 버튼 우측에 "확인 필요" 총건수 배지를 붙인다(§3.3 `AttentionCountBadge`, §1.5).

### 1.5 라우트 표

```
/chatbots/:chatbotId/deploy-schedules                     → S1 예약 목록(해당 챗봇)
/chatbots/:chatbotId/deploy-schedules/:scheduleId         → S2 예약 상세
/settings/deploy-schedules                                 → S4 전역 예약 목록(운영 화면, 권한 범위 내 챗봇 전체)
```

예약 **생성**(S3)은 라우트가 아니라 모달이다(`RestoreDialog` 선례와 동일 이유 — 항상 문맥(대상 버전/챗봇 상태/채널)이 이미 화면에 있고, `previewedContentHash` 같은 상태를 URL에 노출할 이유가 없다). 목록 페이지 자체("+ 예약 만들기")·버전 이력 행·기본설정·채널 카드 어디서나 같은 모달을 연다.

`TabNav` 확장(기존 파일 1곳만 수정):

```html
<div class="tab-nav-group" role="group" aria-label="배포">
  ...
  <a href="/chatbots/:id/skin">스킨/임베드</a>
  <a href="/chatbots/:id/channels">채널</a>
  <a href="/chatbots/:id/deploy-schedules" class="tab-nav-link">
    예약 배포 <NavPendingBadge count={needsAttentionCount} />  <!-- [신규] -->
  </a>
</div>
```

`MESSAGES.detail.tabDeploySchedules = '예약 배포'` 1개 키만 추가.

---

## 2. 화면 목록 및 라우트 요약

| ID | 화면명 | 라우트/형태 | 진입 경로 | 권한(조회/쓰기) |
|---|---|---|---|---|
| S1 | 챗봇별 예약 목록 | `/chatbots/:chatbotId/deploy-schedules` | `TabNav` "예약 배포" | `chatbot:read` / 동작별(§6) |
| S2 | 예약 상세 | `/chatbots/:chatbotId/deploy-schedules/:scheduleId` | S1 행 클릭, S4 행 클릭, 알림 배너 링크 | `chatbot:read` / 동작별 |
| S3 | 예약 생성/재개 대화상자(`ScheduleDeployDialog`) | 모달(비라우트) | E1/E2/E3의 진입 버튼, S1의 "+ 예약 만들기", S2의 "지금 다시 예약"/"보류 해제" | 동작별(§6) |
| S4 | 전역 예약 목록(운영 화면) | `/settings/deploy-schedules` | `SystemSettingsMenu` "예약 배포 현황" | `chatbot:read` |
| E1 | 버전 이력 행 확장 | `versions/VersionListPage.tsx`(기존, No.25) | `VersionRow` 액션 바에 버튼 추가 | `dialogue:write`+`chatbot:write` |
| E2 | 기본설정 상태 전환 영역 | `SettingsTab.tsx`(기존)의 `StatusTransitionControls` 인접 | `DRAFT` 챗봇에 버튼 추가 | `chatbot:write`(+`channel:write`) |
| E3 | 채널 카드(WEB) | `ChannelCard.tsx`(기존) | 액션 바에 버튼 추가 | `channel:write` |
| E4 | 대화 자산 편집 화면군 | 다수(§4.6.2 목록) | 활성 `RESTORE_VERSION` 예약이 있을 때 상단 배너 | 조회 시 자동 노출(쓰기 권한 무관) |
| E5 | 챗봇 목록 | `ChatbotListPage.tsx`/`ChatbotTable.tsx`(기존) | "확인 필요" 컬럼/배지 | 조회만 |
| E6 | 챗봇 상세 대시보드 | `DashboardTab.tsx`(기존) | 상단 배너 | 조회만 |
| E7 | `TopBar`/`SystemSettingsMenu` | 기존 컴포넌트 | 확인 필요 총건수 배지 | `chatbot:read` |
| E8 | No.25 `RestoreDialog` | `restore/RestoreDialog.tsx`(기존) | 409 분기에 `RESTORE_BUSY` 추가 | 기존과 동일 |

---

## 3. 공통 UI 요소

### 3.1 재사용(변경 없음)

`Modal`/`ConfirmDialog`(기본 포커스 `[data-autofocus="cancel"]`), `Toast`, `InlineFieldError`, `Skeleton`(`SkeletonRow`), `EmptyState`, `ErrorState`, `SeverityBadge`, `Pagination`, `KebabMenu`, `ArchivedBanner`, `IndexStatusBadge`, **No.25 전체**: `RestoreBlockerList`(원인+해결 문구 매핑), `RestoreWarningList`(경고 나열), `ActiveChatbotAcknowledgeCheckbox`(패턴 재사용 — 이 그룹에서는 `acknowledgeActive` 체크박스로 이름만 다르게), `NavPendingBadge`(0건이면 렌더 안 함, 999+ 절삭 관행).

### 3.2 신규 컴포넌트

| 컴포넌트 | 용도 | 배치 |
|---|---|---|
| `DeployScheduleListPage` | S1 본체(챗봇 스코프) | `pages/chatbot-detail/deploy-schedules/DeployScheduleListPage.tsx` |
| `GlobalDeployScheduleListPage` | S4 본체(전역) | `pages/settings/DeploySchedulesPage.tsx` |
| `DeployScheduleRow` | 목록 1행(공통 — 두 목록에서 재사용, `chatbotName` prop 유무로 분기) | `deploy-schedules/` |
| `DeployScheduleStatusBadge` | 상태 7종 고정 배지(§3.3) | `components/` 공용 |
| `DeployScheduleActionLabel` | 동작 3종 라벨("버전 복원"/"공개 시작"/"웹 채널 열기·닫기") | `components/` 공용 |
| `AttentionCountBadge` | "확인 필요 n" — `NavPendingBadge`와 동일 패턴, 색상은 주의색(주황) | `components/` 공용 |
| `DeployScheduleDetailPage` | S2 본체 | `deploy-schedules/DeployScheduleDetailPage.tsx` |
| `ScheduleChainPanel` | 선행/후속 체인 표시(예약id·시각·상태 링크) | 동일 |
| `StateCheckPanel` | "지금 기준 상태 점검" — `state-check` 지연 조회 | 동일 |
| `ScheduleResultSummaryPanel` | `resultSummary` 판별 유니온 렌더(RESTORE/PUBLISH/SET_WEB_CHANNEL 3분기) | 동일 |
| `ReadinessWarningList` | 준비도 경고 9종(§4.3.3) — `RestoreWarningList`와 다른 코드 유니온(G0')이므로 별도 컴포넌트(No.25 관행: 도메인 유니온이 다르면 재사용 아님) | 동일 |
| `ScheduleDeployDialog` | S3 본체 — 동작 선택(진입 문맥에 따라 생략) → 대상 확인/미리보기 → 시각·메모 → 준비도 경고 → 확정 | `deploy-schedules/ScheduleDeployDialog.tsx` |
| `ActionPickerStep` | S1 "+ 예약 만들기"에서만 렌더되는 1단계(동작 3종 카드 선택) | 동일 |
| `ScheduledAtField` | 날짜·시·분 텍스트 입력 + 달력 보조 + 시간대 라벨 + 상대시간 보조문(FR-D7-3, NFR-DA1) | `components/` 공용 |
| `ChainBasisNotice` | "기준: 10/1 00:00 예약(v31) 반영 후 상태" 안내(FR-D7-4) | `deploy-schedules/` |
| `AcknowledgeActiveCheckbox` | `ACTIVE`(또는 예약 시각에 `ACTIVE`일 예정)일 때만 렌더 | 동일 |
| `PostRunTestOption` | G3 — TC 세트 선택 체크박스(기본 해제) | 동일 |
| `ScheduleConfirmButton` | 라벨이 항상 시각+대상 명시(FR-D7-5) | 동일 |
| `ScheduleConflictBanner` | E4 — 대화 자산 편집 화면 공용 배너 | `components/` 공용 |
| `EngineDisabledBanner` | S1/S4 상단 — 엔진 비활성 경고(FR-D3-8/FR-D7-8) | `components/` 공용 |
| `Summary24hBar` | S4 상단 — "최근 24시간: 성공 n · 실패 n · 누락 n" | `deploy-schedules/` |
| `NeedsAttentionBadgeCell` | E5 — 챗봇 목록 행의 "확인 필요 n" 셀 | `chatbot-list/` |
| `DeployScheduleNoticeBanner` | E6 — 챗봇 대시보드 상단(다가오는 예약 안내, `notice` API) | `chatbot-detail/` |

### 3.3 고정 시각 언어 — 이 그룹 전체에서 재사용

#### (1) `DeployScheduleStatusBadge` — 상태 7종(NFR-DA2 — 색상 + 텍스트, 색상 단독 금지)

| `status` | 배지 텍스트 | 아이콘 | 색상 계열 | 비고 |
|---|---|---|---|---|
| `PENDING`(재시도 없음) | "대기" | ○ | 회색 | `scheduledAt` 표시 |
| `PENDING`(재시도 중, `attemptCount≥1`) | "대기(재시도 중)" | ↻ | 파랑 | `lastTransientReason` 한글 라벨 병기 |
| `RUNNING` | "실행 중" | ●(펄스 애니메이션 없이 정적 아이콘) | 파랑 | — |
| `SUCCEEDED`(`APPLIED`) | "성공" | ✔ | 초록 | `delaySeconds>0`이면 "성공(지연 실행)" |
| `SUCCEEDED`(`NOOP`) | "성공(변경 없음)" | ✔ | 초록(옅게) | 감사 없음 안내 병기(상세에서만) |
| `SUCCEEDED`(`RECOVERED`) | "성공(복구 확인)" | ✔ | 초록 | 상세에 "서버 재시작 중 실행되어 사후 확인됨" 설명 |
| `FAILED` | "실패" | ✕ | 빨강 | `failureReason` 한글 라벨 병기 |
| `MISSED` | "누락" | ▲ | 주황 | — |
| `HELD` | "보류" | ▮ | 주황 | `heldReason` 한글 라벨 병기 |
| `CANCELLED` | "취소" | ⊘ | 회색 | — |

`SUCCEEDED`는 세 `outcome`(`APPLIED`/`NOOP`/`RECOVERED`)에 따라 배지 텍스트를 분기하되 **기본 배지 색상은 전부 초록**(성공이라는 공통 의미가 우선) — 세부는 상세에서만 텍스트로 구분한다.

**"확인 필요" 판정**(NFR-DA2): `status ∈ {FAILED, MISSED, HELD}` AND `acknowledgedAt === null`인 행은 목록 행 자체에 `AttentionCountBadge`를 추가로 병기한다(배지 2개 나열 — 상태 배지를 대체하지 않는다).

#### (2) `DeployScheduleActionLabel` — 동작 3종

| `action` | 라벨 | 대상 표시(목록·감사 `targetName` 규약과 동일 톤) |
|---|---|---|
| `RESTORE_VERSION` | "버전 복원" | "v{targetVersionNo}로 복원" |
| `PUBLISH` | "공개 시작" | `enableWebChannel`이면 "공개 시작 + 웹 채널 열기", 아니면 "공개 시작" |
| `SET_WEB_CHANNEL` | "웹 채널 열기"｜"웹 채널 닫기" | `enabled` 값으로 결정 |

#### (3) `failureReason`/`heldReason`/`lastTransientReason` 한글 라벨(상세·목록 공용)

| 분류 | 코드 | 라벨 |
|---|---|---|
| 실패 | `STATE_CHANGED` | "예약 이후 자산이 변경됨" |
| | `TARGET_VERSION_MISSING` | "대상 버전을 찾을 수 없음" |
| | `INTEGRITY_FAILED` | "자산 무결성 문제" |
| | `SCHEMA_UNSUPPORTED` | "지원되지 않는 버전 형식" |
| | `BACKUP_TOO_LARGE` | "백업 생성 실패(용량 초과)" |
| | `CHATBOT_ARCHIVED` | "챗봇이 보관 상태로 변경됨" |
| | `CHATBOT_NOT_FOUND` | "챗봇을 찾을 수 없음" |
| | `INVALID_TRANSITION` | "허용되지 않는 상태 전환" |
| | `CREATOR_NOT_AUTHORIZED` | "예약자의 권한이 없음" |
| | `BLOCKED_TOO_LONG` | "진행 중인 작업으로 15분간 실행하지 못함" |
| | `INTERRUPTED` | "서버 중단으로 실행 여부를 확인할 수 없어 취소 처리됨" |
| | `INTERNAL_ERROR` | "알 수 없는 오류" |
| 보류 | `PREDECESSOR_FAILED` | "선행 예약 실패로 보류됨" |
| | `PREDECESSOR_MISSED` | "선행 예약 누락으로 보류됨" |
| | `PREDECESSOR_CANCELLED` | "선행 예약 취소로 보류됨" |
| | `PREDECESSOR_HELD` | "앞선 보류가 해제되지 않아 보류됨" |
| 재시도 중 | `DB_BUSY` | "일시적 처리 지연" |
| | `ACTIVE_JOB` | "진행 중인 작업 대기 중" |
| | `RESTORE_LOCKED` | "다른 복원 작업 대기 중" |

`RestoreBlockerList`/`RestoreWarningList`(No.25)와 같은 "코드 → 문구 매핑 함수" 패턴을 그대로 따른다(스위치문 1개, `MESSAGES.deploySchedules.reasons.*`).

---

## 4. 화면별 설계

## 4.1 S1 — 챗봇별 예약 목록 `/chatbots/:chatbotId/deploy-schedules`

### 목적
해당 챗봇에 걸린 예약(대기·실행중·완료·실패 전체)을 시각순으로 조회하고, 생성·취소·재개·확인함 진입점을 제공한다.

### 상태별 UI

| 상태 | UI |
|---|---|
| 로딩 | `SkeletonRow` × 5 |
| 빈 상태(예약 0건) | `EmptyState`: "예약된 배포가 없습니다." + 동작 3종 설명(버전 복원·공개 시작·웹 채널 열기/닫기) + **"운영 중 챗봇의 내용 변경 예약은 버전 이력에서 시작합니다"** 안내 + `[버전 이력으로 이동]`(FR-D7-7) |
| 정상 | §4.1.2 레이아웃 |
| `ARCHIVED` 챗봇 | `ArchivedBanner`(재사용). 조회는 허용, "+ 예약 만들기"는 `aria-disabled`(생성만 409 대상 — 취소·확인은 허용, §13.1 근거) |
| 엔진 비활성(`meta.engine.enabledOnThisInstance=false`) | `EngineDisabledBanner`: "이 서버에서는 예약 실행이 비활성화되어 있습니다. 예약은 생성·수정·취소할 수 있지만 자동으로 실행되지 않습니다."(FR-D3-8) |
| `meta.engine.overduePendingCount > 0` | 위 배너와 별개로 `SeverityBadge(WARNING)`: "예정 시각이 지났는데 실행되지 않은 예약이 {n}건 있습니다. 실행 서버 설정을 확인해 주세요."(§13.1) |

### 레이아웃 (데스크톱)

```
┌ 예약 배포 ───────────────────────────────────────── [+ 예약 만들기] ┐
│ ⚠ 이 서버에서는 예약 실행이 비활성화되어 있습니다.                    │
│ 필터: 상태[ 전체 ▾ ] 동작[ 전체 ▾ ] 기간[_____ ~ _____] ☐확인 필요만  │
├──────────────────────────────────────────────────────────────────┤
│ ○ 대기   버전 복원 · v30으로 복원   2027-01-15 09:00 (KST)          │
│          편집자A · 메모: "이벤트 전 복귀"                            │
├──────────────────────────────────────────────────────────────────┤
│ ▮ 보류 ⚠확인필요  공개 시작   2027-01-15 09:00 (KST)                │
│          선행 예약 실패로 보류됨 → [선행 예약 보기]                   │
├──────────────────────────────────────────────────────────────────┤
│ ✕ 실패 ⚠확인필요  버전 복원 · v31로 복원   2027-01-01 00:00 (KST)    │
│          예약 이후 자산이 변경됨 · 09:00:03 실행 시도                │
│          [지금 다시 예약]  [확인함]                                  │
├──────────────────────────────────────────────────────────────────┤
│                                                    ◀ 1 .. 2 ▶       │
└──────────────────────────────────────────────────────────────────┘
```

### 컴포넌트 분해 및 데이터 바인딩

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `DeployScheduleListPage` | `chatbotId` |
| 필터 바 | `status[]`(다중 체크 드롭다운, `chatbot:read`), `action[]`, `from`/`to`(날짜), `needsAttention` 토글 — 값 변경 시 즉시 재조회(§4.1의 트리거 필터와 동일 관행), `aria-live="polite"`로 결과 건수 안내 |
| `DeployScheduleRow` | `{ id, action, status, scheduledAt, targetVersionNo, enableWebChannel, channelEnabled, memo, createdByEmail, attemptCount, lastTransientReason, delaySeconds, outcome, failureReason, heldReason, needsAttention }` — `GET .../deploy-schedules` 응답 그대로(캡처·해시 계산 없음, NFR-DP3) |
| `DeployScheduleStatusBadge`/`DeployScheduleActionLabel`/`AttentionCountBadge` | §3.3 |
| `[지금 다시 예약]` | `FAILED`/`MISSED` 행에만(FR-D4-0a) — `ScheduleDeployDialog`를 **같은 동작·파라미터로 사전 채운 새 생성 흐름**으로 연다(최소 리드타임 5분부터, 미리보기 재확인 포함). **즉시 실행 버튼은 만들지 않는다** — 안내 문구: "지금 바로 반영하려면 버전 이력(또는 기본설정/채널)에서 즉시 실행해 주세요." + 해당 화면 링크 |
| `[선행 예약 보기]` | `HELD` 행의 `heldByScheduleId` → S2로 이동 |
| `[확인함]` | `status ∈ {FAILED, MISSED, HELD}` AND `!acknowledgedAt` AND 관리 권한 보유 시에만 렌더 — `POST .../acknowledge`(멱등, 감사 없음) → 배지 즉시 제거 |
| `[취소]`(케밥) | `PENDING`/`HELD`에서만 — `ConfirmDialog(danger, 기본 포커스 취소)`: "이 예약을 취소하시겠습니까? {복원 체인 중간이면} 이후 예약 {n}건도 함께 보류됩니다." |
| `[+ 예약 만들기]` | `ScheduleDeployDialog`를 **동작 선택 단계부터** 연다(`ActionPickerStep`) |
| `Pagination` | 재사용, 기본 페이지 크기 20(`DEPLOY_SCHEDULE_LIMITS.listPageSizeDefault`) |

### 폴링

`RUNNING` 또는 `PENDING`(재시도 중, `attemptCount≥1`) 행이 목록에 있을 때만 **5초 간격**으로 재조회한다(`TestRunListPage`의 `POLL_INTERVAL_MS` 관행 재사용, 값만 대화형 최신성을 위해 짧게). 그 외에는 폴링하지 않고 `[새로고침]` 버튼만 제공.

---

## 4.2 S2 — 예약 상세 `/chatbots/:chatbotId/deploy-schedules/:scheduleId`

### 목적
예약 1건의 전체 정보(파라미터·체인·결과·실패 사유·TC 링크)를 확인하고 수정·취소·재개·확인함·되돌리기를 수행한다.

### 상태별 UI

| 상태 | UI |
|---|---|
| 로딩 | `SkeletonRow` × 6 |
| 교차 챗봇/존재하지 않는 id | `404` → "요청한 예약을 찾을 수 없습니다." + 목록으로 |
| `status='PENDING'` | §4.2.1 레이아웃(A) |
| `status='RUNNING'` | 진행 표시만(취소 불가 안내) — "실행 중입니다(보통 수 초 안에 끝납니다)." `role="status" aria-live="polite"`, 3초 폴링으로 자동 갱신 |
| `status='SUCCEEDED'` | §4.2.1 레이아웃(B) — `ScheduleResultSummaryPanel` |
| `status='FAILED'`/`'MISSED'` | §4.2.1 레이아웃(C) — 사유 + "지금 다시 예약" + "확인함" |
| `status='HELD'` | §4.2.1 레이아웃(D) — 보류 사유 + 선행 예약 링크 + "보류 해제" |
| `status='CANCELLED'` | 취소자·취소 시각만 표시, 액션 없음 |

### 4.2.1 레이아웃 (데스크톱, 공통 헤더 + 상태별 본문)

```
┌ 예약 상세 · 버전 복원(v30) ───────────────────────────────────────┐
│ ○ 대기   2027-01-15 09:00 (KST, UTC+9)   생성: 편집자A · 01/10 14:20 │
│ 메모: "이벤트 전 복귀"                              [시각/메모 수정] │
├────────────────────────────────────────────────────────────────┤
│ 대상: v30 · 기준: 현재 상태(previewedContentHash 일치 확인됨)        │
│ 선행 예약: 없음   후속 예약: 1건 → [09:00 공개 시작 (대기)]           │
├────────────────────────────────────────────────────────────────┤
│ [지금 기준 상태 점검]  마지막 확인: 아직 확인하지 않음                │
├────────────────────────────────────────────────────────────────┤
│ 준비도 안내                                                       │
│  · 최근 TC 실행: "정기 회귀" 통과 468/471 (01/09 03:00)             │
│  · 임베딩 색인: 완료(대기 0건)                                      │
├────────────────────────────────────────────────────────────────┤
│                                          [취소]                   │
└────────────────────────────────────────────────────────────────┘
```

- (B) `SUCCEEDED`일 때 "준비도 안내" 블록 대신 `ScheduleResultSummaryPanel`: `RESTORE_VERSION`이면 "백업: v33(복원 직전 백업) [되돌리려면 여기]" + 재색인 상태 + `outcome='NOOP'`이면 "이미 대상과 같은 상태였습니다(변경 없음, 감사 기록 없음)" 안내. G3 실행했다면 "사후 검증: '정기 회귀' 통과 465/471 [결과 보기 →]"(No.19 `TestRunDetailPage` 링크) 또는 `SKIPPED`/`REJECTED` 사유.
- (C) `FAILED`/`MISSED`일 때 사유(§3.3 표) + 지연시간(있으면) + `[지금 다시 예약]`/`[확인함]`.
- (D) `HELD`일 때 `heldReason` + `[heldByScheduleId로 이동]` + `[보류 해제]`(새 시각 필수, 복원이면 새 미리보기 필수 — `ScheduleDeployDialog`를 "재개 모드"로 연다) + `[취소]`.

### 컴포넌트 분해

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `DeployScheduleDetailPage` | `chatbotId`, `scheduleId` → `GET .../deploy-schedules/:scheduleId`(+ `readinessWarnings`) |
| `ScheduleChainPanel` | `predecessor`/`heldBy` — 각각 `{ id, scheduledAt, status, action, targetVersionNo? }` → 클릭 시 같은 페이지 내 라우팅(react-router `navigate`) |
| `StateCheckPanel` | `[지금 기준 상태 점검]` 클릭 시 `POST .../state-check`(DB 변경 0, 캡처 1회 — 자동 조회 아님, NFR-DP3) → `{ applicable, basis, matches, checkedAt }`. `matches===false`면 `SeverityBadge(WARNING)`: "현재 상태가 예약 시점과 다릅니다 — 지금 실행되면 실패합니다." |
| `ReadinessWarningList` | `readinessWarnings[]`(§4.3.3, 상세 조회 시점 계산 — `RESTORE_WARNINGS`는 계산하지 않음, 필요하면 state-check로 유도) |
| `ScheduleResultSummaryPanel` | `resultSummary` 판별 유니온(§설계서 §13.2) |
| `[시각/메모 수정]` | `PENDING`/`HELD`에서만 — 인라인 편집 폼(`ScheduledAtField` + 메모) → `PATCH`. 체인 순서를 바꾸는 시각이면 `409 DEPLOY_SCHEDULE_PRECONDITION_FAILED(ORDER_CHANGE)` → 인라인 오류 "이 시각으로 바꾸면 예약 순서가 바뀝니다. 취소 후 다시 예약해 주세요." |

---

## 4.3 S3 — 예약 생성/재개 대화상자 `ScheduleDeployDialog`

### 진입 경로별 사전 채움

| 진입 | 고정되는 값 | 사용자가 입력하는 것 |
|---|---|---|
| E1 버전 이력 행 "예약 복원" | `action='RESTORE_VERSION'`, `versionId`(대상 버전) | 시각·메모·(`ACTIVE`면)확인·G3 옵션 |
| E2 기본설정 "공개 예약" | `action='PUBLISH'` | `enableWebChannel` 체크·시각·메모·G3 옵션(허용 동작) |
| E3 채널 카드 "열기 예약"/"닫기 예약" | `action='SET_WEB_CHANNEL'`, `enabled`(버튼이 이미 목표값 결정) | 시각·메모 |
| S1 "+ 예약 만들기" | 없음 | `ActionPickerStep`에서 동작 선택부터 |
| S1/S2 "지금 다시 예약" | 실패/누락된 예약과 **동일 동작·파라미터** | 새 시각(리드타임 5분부터)·메모 유지 |
| S2 "보류 해제" | 기존 예약의 동작·파라미터, "재개 모드" 플래그 | 새 시각 필수(+ 복원이면 새 미리보기 필수) |

`ActionPickerStep`(진입 문맥이 없을 때만 1단계로 표시): 카드 3개("버전 복원 — 특정 버전으로 되돌립니다" / "공개 시작 — 초안을 공개로 전환합니다(DRAFT만)" / "웹 채널 열기·닫기") — 방향키로 탐색 가능한 라디오 그룹(UIUX §6). `PUBLISH`/`RESTORE_VERSION`은 챗봇이 대상 상태(DRAFT/버전 존재)가 아니면 카드가 `aria-disabled` + 이유 툴팁.

### 상태별 UI (오픈 이후)

| 상태 | UI |
|---|---|
| (동작 선택 후) 미리보기/사전 검증 로딩 | `Skeleton` — "예약 조건을 확인하는 중…"(`aria-live="polite"`) |
| 미리보기 완료, blockers 없음 | §4.3.1 레이아웃 |
| blockers 존재(RESTORE의 `RESTORE_BLOCKED`, PUBLISH의 `ALREADY_ACTIVE`/`DUPLICATE_PUBLISH` 등) | `RestoreBlockerList` 재사용 패턴으로 표시, 확정 버튼 렌더 안 됨(FR-D2-3 예외: `ACTIVE_JOB`/`RESTORE_IN_PROGRESS`는 **경고로 격하**되어 blockers가 아니라 준비도 경고 쪽에 표시) |
| 제출 중 | 확정 버튼 스피너+`disabled`(연타 방지), `Esc`/배경클릭 비활성 |
| 제출 성공 | 다이얼로그 닫힘 + Toast "{확정 버튼과 같은 문구}로 예약되었습니다." + 목록 자동 새로고침 |
| `409 RESTORE_PREVIEW_STALE` | 다이얼로그 유지, 배너 "미리보기 이후 상태가 변경되었습니다. 최신 내용으로 다시 확인합니다." → 자동 재확인(§4.6.1과 동일 톤) |
| `409 RESTORE_BUSY` | 위와 **동일 배너·동일 자동 재확인**(§4.6.1, §0-5) |
| `400 DEPLOY_SCHEDULE_INVALID_TIME` | `ScheduledAtField` 하단 인라인 오류(§4.3.2) |
| `409 DEPLOY_SCHEDULE_LIMIT_EXCEEDED` | 다이얼로그 상단 오류 배너: "이 챗봇에 이미 활성 예약이 5건 있습니다. 기존 예약을 취소하거나 완료된 뒤 다시 시도해 주세요." + `[예약 목록 보기]` |
| `409 DEPLOY_SCHEDULE_PRECONDITION_FAILED(CHAIN_ORDER)` | "이 시각에는 이미 그 이후 시각의 복원 예약이 있습니다. 복원 예약은 항상 가장 나중 순서로만 추가할 수 있습니다." (D-4, append-only 안내) |
| `409 DEPLOY_SCHEDULE_PRECONDITION_FAILED(DUPLICATE_PUBLISH)` | "이미 공개 시작 예약이 있습니다." + 해당 예약 링크 |
| `400 VALIDATION_FAILED(acknowledgeActive)` | 체크박스 하단 인라인 오류 |

### 4.3.1 레이아웃 — 정상(`RESTORE_VERSION`, 체인 후속 예시)

```
┌ 예약 만들기 · 버전 복원 ──────────────────────────────────────── ✕ ┐
│ 대상: v30                                                          │
│ 기준: 10/1 00:00 예약(v31) 반영 후 상태 — 아직 실행되지 않았습니다    │
│                                                                     │
│ + 의도 0  − 키워드 3  ~ 의도 1                                      │
│                                                                     │
│ 실행 시각 *                                                        │
│  [2027-11-01] [00] : [00]  (KST, UTC+9)               [📅]         │
│  → 지금으로부터 306일 22시간 후                                     │
│                                                                     │
│ 메모(선택)                                                          │
│  [___________________________________________]  0/200자            │
│                                                                     │
│ ⓘ 준비도 안내                                                      │
│  · 앞선 보류가 해제되지 않으면 이 예약도 보류됩니다.                  │
│  · 장기 예약입니다 — 그 사이 편집이 있으면 실행되지 않습니다.         │
│                                                                     │
│ ☐ 이 챗봇은 그때 운영 중일 예정입니다. 계속하려면 확인해 주세요.       │
│                                                                     │
│ ☐ 반영 직후 TC로 검증(선택) — 세트 [ 정기 회귀 ▾ ]                   │
│                                                                     │
│                                    [취소]  [11/1 00:00에 v30으로 복원 예약] │
└─────────────────────────────────────────────────────────────────┘
```

### 4.3.2 `ScheduledAtField` — 시각 입력(FR-D7-3, NFR-DA1)

- **날짜·시·분 각각 텍스트 입력 필드**(레이블 필수: "연-월-일", "시", "분") + 달력 아이콘(`📅`)은 **보조 입력 수단**일 뿐 — 키보드만으로 텍스트 필드에 직접 타이핑해 완결할 수 있다(마우스·달력 단독 입력 금지, NFR-DA1).
- 필드 레이블/접근 가능한 이름에 **시간대를 항상 포함**: `aria-label="실행 시각(KST, UTC+9 기준)"`.
- 값 변경 시 즉시 보조 텍스트 갱신: "지금으로부터 {n}일 {n}시간 후" 또는 위반 시 즉시 인라인 오류(제출 전 사전 검증, UIUX §7):
  - 리드타임 위반: "예약 시각은 지금부터 5분 이후여야 합니다. {now+5분}부터 입력해 주세요."
  - 최대 기간 위반: "예약은 최대 90일 이내만 가능합니다. {now+90일}까지 입력해 주세요."
  - 간격 위반: "이 챗봇의 다른 예약({기존시각})과 같은 분입니다. 최소 1분 이상 차이를 두세요."
- `DEPLOY_SCHEDULE_LIMITS`(shared-types 코드 상수)를 프런트가 직접 import해 **서버 요청 전에** 1차 검증(요구사항 §5.5 — FE/BE 공용 상수). 서버 `now` 권위 원칙(§6.3)에 따라 최종 판정은 응답의 `400 DEPLOY_SCHEDULE_INVALID_TIME`이 갖는다.
- `LONG_HORIZON`(30일 초과) 경고는 오류가 아니라 준비도 안내 블록에만 표시.

### 4.3.3 준비도 경고(G0') 매핑 — `ReadinessWarningList`

| `code` | 문구 |
|---|---|
| `EMBEDDING_INDEX_INCOMPLETE` | "임베딩 색인이 진행 중입니다({n}건 대기) — 실행 시각까지 끝나지 않으면 규칙 매칭만 적용됩니다." |
| `LAST_TEST_RUN` | "최근 TC 실행: '{세트명}' 통과 {passed}/{total} ({실행시각})" (정보성, 경고 아이콘 없이 ⓘ) |
| `NO_RECENT_TEST_RUN` | "최근 TC 실행 이력이 없습니다." |
| `ACTIVE_JOB` | "진행 중인 작업이 있습니다 — 실행 시각까지 끝나지 않으면 최대 15분간 재시도합니다." |
| `RESTORE_WARNINGS` | (미리보기 시에만) No.25 `RestoreWarningList` 그대로 재사용 |
| `WEB_CHANNEL_NOT_CONFIGURED` | "웹 채널에 허용 도메인이 설정되어 있지 않습니다." |
| `PUBLISHED_BUT_CHANNEL_CLOSED` | "공개되어도 웹 채널이 닫혀 있어 위젯이 열리지 않습니다." |
| `LONG_HORIZON` | "장기 예약입니다({n}일 후) — 그 사이 편집이 있으면 실행되지 않습니다." |
| `PREDECESSOR_HELD` | "앞선 보류 예약이 해제되지 않으면 이 예약도 보류됩니다." |
| `ENGINE_DISABLED_ON_THIS_INSTANCE` | "이 서버에서는 예약 실행이 비활성화되어 있습니다." |

`RESTORE_WARNINGS`를 제외한 8종은 **아이콘(ⓘ)+텍스트**로, `RESTORE_WARNINGS`는 No.25와 동일하게(경고 아이콘 ⚠, `ACCEPTED_SUGGESTIONS_NOT_RESUGGESTED`는 강조 배너) 표시한다(색상 단독 금지, UIUX §1).

### 4.3.4 확정 버튼 라벨(FR-D7-5 — 모호한 "확인" 금지)

| 동작 | 라벨 예 |
|---|---|
| `RESTORE_VERSION` | `"{M/D HH:mm}에 v{n}으로 복원 예약"` |
| `PUBLISH`(웹 채널 동시) | `"{M/D HH:mm}에 공개 시작 + 웹 채널 열기 예약"` |
| `PUBLISH`(단독) | `"{M/D HH:mm}에 공개 시작 예약"` |
| `SET_WEB_CHANNEL` | `"{M/D HH:mm}에 웹 채널 {열기｜닫기} 예약"` |
| 재개(HELD→PENDING) | `"{M/D HH:mm}로 보류 해제"` |

기본 포커스는 항상 **"취소"**(파괴적이지 않은 선택, NFR-DA3 — 예약 생성은 파괴적 동작은 아니지만 무인 실행을 만드는 행위이므로 같은 보수적 기본값을 적용).

---

## 4.4 S4 — 전역 예약 목록(운영 화면) `/settings/deploy-schedules`

### 목적
권한 범위 내 모든 챗봇의 예약을 한 화면에서 조회하고 "확인 필요" 건을 챗봇별로 훑는다. **쓰기 액션은 제공하지 않는다** — 각 행에서 S2(챗봇 스코프 상세)로 이동해 처리한다(권한 판정이 챗봇 스코프라 전역 화면에서 바로 취소/재개를 허용하면 판정 UX가 이중화된다).

### 상태별 UI

| 상태 | UI |
|---|---|
| 로딩 | `Summary24hBar` 스켈레톤 + `SkeletonRow` × 8 |
| 빈 상태 | "권한 범위 내 챗봇에 예약이 없습니다." |
| 정상 | §4.4.1 레이아웃 |

### 4.4.1 레이아웃

```
┌ 예약 배포 현황 ─────────────────────────────────────────────────┐
│ 최근 24시간: 성공 12 · 실패 1 · 누락 0        (2027-01-15 09:12 기준)│
│ 확인 필요: 총 3건 — 연말정산봇 2 · 이벤트봇 1                        │
├────────────────────────────────────────────────────────────────┤
│ 필터: 챗봇[ 전체 ▾ ] 상태[ 전체 ▾ ] 동작[ 전체 ▾ ] ☐확인 필요만      │
├────────────────────────────────────────────────────────────────┤
│ 챗봇          동작        시각                상태      생성자      │
│ 연말정산봇     공개 시작    01/15 09:00(KST)    ✕ 실패    편집자A    │
│ 이벤트봇       웹채널닫기   01/18 18:00(KST)    ○ 대기    편집자B    │
├────────────────────────────────────────────────────────────────┤
│                                                    ◀ 1 .. 3 ▶     │
└────────────────────────────────────────────────────────────────┘
    행 클릭 → /chatbots/{chatbotId}/deploy-schedules/{scheduleId}(S2)로 이동
```

### 컴포넌트 분해

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `GlobalDeployScheduleListPage` | — |
| `Summary24hBar` | `GET /deploy-schedules/summary` → `{ needsAttention:{total, byChatbot[]}, last24h:{succeeded,failed,missed}, generatedAt }`(FR-D6-3). "확인 필요" 챗봇별 목록은 최대 5개까지 나열 + "외 n개"(≤100 상한, 설계서 §13.1) |
| 필터 바 | `chatbotId?`(콤보), `status[]`, `action[]`, `needsAttention` |
| `DeployScheduleRow`(전역용) | §4.1과 동일 컴포넌트에 `chatbotName` 표시 열 추가 |

### 폴링

`RUNNING` 행 존재 시 5초, 그 외 60초 간격으로 `summary`만 재조회(목록 전체 재조회는 사용자 액션 시에만) — 전역 화면은 "지금 무슨 일이 있었나"를 훑는 용도라 실시간성 요구가 S1보다 낮다.

---

## 4.5 진입점 화면 확장 (E1~E3)

### 4.5.1 E1 — 버전 이력 `VersionRow` 액션 바 (No.25 `VersionListPage.tsx`)

기존 액션 4개(`[현재와 비교] [다른 버전과 비교] [내용 보기] [이 버전으로 복원]`) 뒤에 **5번째 버튼** `[예약 복원]` 추가:

```
[현재와 비교] [다른 버전과 비교] [내용 보기] [이 버전으로 복원] [예약 복원]
```

- 렌더 조건: `canRestore`(`dialogue:write` AND `chatbot:write`, 기존 `VersionListPage`의 판정 그대로 재사용 — 즉시 복원과 예약 복원의 권한이 같다, §설계서 §8.1).
- 클릭 시 `ScheduleDeployDialog(action='RESTORE_VERSION', versionId=item.id, versionNo=item.versionNo)` 오픈.
- **활성 복원 예약이 이미 있는 챗봇**(같은 목록에서 `notice.upcomingRestore`로 판정)이면, 새 복원 예약을 만들 때 자동으로 "체인 후속"이 된다는 사실을 다이얼로그의 `ChainBasisNotice`가 알려준다(§4.3.1) — `VersionRow` 자체는 이를 미리 알릴 필요가 없다(정보 중복 방지, 다이얼로그가 유일한 진실 공급원).

### 4.5.2 E2 — 기본설정(`SettingsTab.tsx`, `StatusTransitionControls` 인접)

`StatusTransitionControls`(기존 3버튼 — 공개/보관/초안복구) **바로 아래**에 조건부 4번째 행 추가:

```
[초안으로 복구]  [공개 시작]  [보관]
─────────────────────────────────────
챗봇이 DRAFT일 때만:  [공개 예약...]
```

- 렌더 조건: `chatbot.status === 'DRAFT'` AND `can('chatbot:write')`.
- 클릭 시 `ScheduleDeployDialog(action='PUBLISH')` 오픈 — `enableWebChannel` 체크박스 기본값은 **미체크**(웹 채널을 동시에 열지는 관리자가 명시적으로 선택해야 함, No.6 폼 컨트롤의 "기본값 임의 선택 금지" 원칙과 정합).
- 이미 `ACTIVE`거나 `ARCHIVED`면 버튼 자체를 렌더하지 않는다(생성 조건 FR-D2-5와 동일 — 서버 왕복 없이 화면에서 선제 차단).
- `StatusTransitionControls`의 "공개 시작"(즉시)과 "공개 예약..."(지정 시각)을 **시각적으로 구분**(예약 버튼은 outline 스타일 + 말줄임 "..." 접미사로 "추가 입력이 필요한 동작"임을 표시, `SkinPreviewPanel` 류의 관행과 달리 이 화면 고유 스타일).

### 4.5.3 E3 — 채널 카드(`ChannelCard.tsx`, WEB 타입만)

기존 액션 바(`[설정 열기/닫기] [임베드 코드] [삭제]`) 옆, `ChannelToggle`(즉시 토글) **아래**에 예약 버튼 1개:

```
[ 사용 ●───○ 미사용 ]                    ← 기존 즉시 토글(ChannelToggle)
[열기 예약...] 또는 [닫기 예약...]        ← 신규(현재 enabled 값의 반대 방향만 제시)
```

- 렌더 조건: `item.type === 'WEB'` AND `!locked`(기존 `locked` 판정 — 보관/구현안됨과 동일 기준 재사용) AND `can('channel:write')`.
- 버튼 라벨은 **현재 상태의 반대**만 제시한다(`enabled`면 "닫기 예약...", 아니면 "열기 예약..." — 이미 그 상태로의 예약은 실행 시 NOOP이 되어 혼란만 준다, 요구사항 FR-D2-6이 "같은 값 예약도 허용"이라 했지만 **UI 기본 동선에서는 유용한 경우만 제시**하고, 반대로도 만들고 싶으면 S1의 "+ 예약 만들기"로 우회할 수 있다).
- 클릭 시 `ScheduleDeployDialog(action='SET_WEB_CHANNEL', enabled=!item.enabled)` 오픈.

---

## 4.6 오류·경고 확장 (E4~E8)

### 4.6.1 E8 — No.25 `RestoreDialog.tsx` 409 분기에 `RESTORE_BUSY` 추가 (설계서 §9.1, 이 문서 과제 (9))

**변경 대상**: `handleConfirm`(179행)의 조건식.

```diff
- if (e instanceof ApiError && (e.code === 'RESTORE_PREVIEW_STALE' || e.code === 'RESTORE_BLOCKED_BY_ACTIVE_JOB')) {
+ if (e instanceof ApiError && (e.code === 'RESTORE_PREVIEW_STALE' || e.code === 'RESTORE_BLOCKED_BY_ACTIVE_JOB' || e.code === 'RESTORE_BUSY')) {
    setStaleBanner(true);
    await fetchPreview();
```

- **문구는 바꾸지 않는다** — 기존 `msg.staleBanner`("미리보기 이후 자산이 변경되었습니다. 최신 내용으로 다시 확인합니다.")를 그대로 쓴다. `RESTORE_BUSY`는 "경합"이지 "변경 확정"은 아니지만, 사용자 입장에서 취할 행동(재확인 후 다시 시도)이 동일하므로 **문구를 분기하지 않는 것이 이 컴포넌트의 기존 설계 원칙**(오류 원인보다 "다음에 뭘 하면 되는가"를 우선 안내, UIUX §7)과 맞다. 정확한 원인 구분이 필요하면 서버 로그·감사가 담당한다(설계서 §7.6이 분류를 이미 코드 레벨에서 보장).
- **같은 컴포넌트를 `ScheduleDeployDialog`의 생성/재개 흐름도 재사용**하므로(§4.3), 이 수정 1곳으로 두 화면(즉시 복원·예약 생성) 모두에 `RESTORE_BUSY` 처리가 적용된다.
- 회귀 확인: 기존 `RestoreDialog.spec.tsx`(있다면) 및 `version-history.integration.spec.ts`의 `RESTORE_PREVIEW_STALE` 단언은 **무수정 통과**(설계서 §9.1 "즉시 복원 경로 영향" 그대로 인용).

### 4.6.2 E4 — 대화 자산 편집 화면군의 "예약 충돌 예고" 배너(`ScheduleConflictBanner`, FR-D4-3)

**적용 대상 화면 목록**(요구사항 FR-D4-3 원문 그대로 — 대화 자산 편집 화면 8종 + 증강/대량/학습 반영 화면 3종, 실제 코드 라우트로 매핑):

| # | 화면 | 실제 코드 경로 |
|---|---|---|
| 1 | 의도·키워드 편집 | `pages/dialogue/IntentsKeywordsPage.tsx` |
| 2 | 동음이의어 편집 | `pages/dialogue/HomonymsPage.tsx` |
| 3 | 컨텍스트 편집 | `pages/dialogue/ContextFormPage.tsx`/`ContextsListPage.tsx` |
| 4 | 노드 편집 | `pages/dialogue/NodeFormPage.tsx`/`NodesListPage.tsx` |
| 5 | FAQ 편집 | `pages/dialogue/FaqsPage.tsx` |
| 6 | 답변설정 | `pages/chatbot-detail/AnswerSettingsTab.tsx` |
| 7 | 기본설정(표시설정 부분) | `pages/chatbot-detail/SettingsTab.tsx` |
| 8 | 증강 제안 승인 | `pages/dialogue/components/AugmentationPanel.tsx`(No.16/23) |
| 9 | 대량 업로드(임포트) | `dialogue-design-ui-spec.md` `BulkImportModal`(No.25 `AutoSnapshotPreNotice`가 이미 있는 자리 — 그 바로 아래에 병기) |
| 10 | 학습현황 일괄 반영 | `pages/learning/LearningQueuePage.tsx`(`BulkResolveModal`) |

**표시 조건**: 화면 진입 시 `GET .../deploy-schedules/notice`(설계서 §13.1, `/:scheduleId`보다 먼저 선언된 전용 엔드포인트 — 인덱스 조회 1~2건, 캐시 없음) 호출 → `upcomingRestore !== null`이면 배너 노출.

**문구**: "이 챗봇에 예약된 복원이 있습니다({scheduledAt} · v{targetVersionNo}{chainLength>1이면 " 외 {n}건"}). 지금 변경하면 예약이 실행되지 않습니다." + `[예약 배포에서 보기 →]`(S1로 이동).

**배너는 저장을 막지 않는다**(FR-D4-3 — "예약이 편집을 인질로 잡지 않는다"). `SeverityBadge(WARNING)` 톤으로 화면 상단 상시 배너(다이얼로그 아님, `ArchivedBanner`와 같은 배치 관행 — 페이지 최상단, 본문보다 먼저 Tab 순서에 들어옴).

**호출 시점**: 각 화면의 최초 마운트 시 1회(요청 폭주 방지) — 저장 성공 후 재호출하지 않는다(저장 자체는 `FAILED: STATE_CHANGED`를 만들 뿐 즉시 되돌릴 수단이 없으므로, 배너를 지금 지워도 실질적 의미가 없다. 사용자가 화면을 다시 방문하면 배너가 사라진 것을 보고 "실행되지 않을 것"이라 오인할 위험만 커진다 — **저장 후에도 배너는 유지**하고, 다음 방문(새 마운트)에서만 갱신한다).

### 4.6.3 E5 — 챗봇 목록 "확인 필요" 배지(`ChatbotTable.tsx`/`ChatbotCardList.tsx`)

`ChatbotTable`의 "상태" 컬럼(`StatusBadge`) 옆에 `NeedsAttentionBadgeCell` 추가:

```
상태          확인 필요
● 사용중       ⚠ 확인 필요 2
```

- 데이터 소스: `GET /deploy-schedules/summary`의 `needsAttention.byChatbot[]`을 `ChatbotListPage`가 목록 조회와 **별도로** 1회 호출해 `chatbotId → count` 맵으로 각 행에 매칭(챗봇 목록 API 계약 자체는 바꾸지 않는다 — 설계서 §13.1 "`ChatbotListItem` 계약을 바꾸지 않는다"와 정합).
- 0건이면 셀이 빈칸(배지 렌더 안 함, `NavPendingBadge` 관행).
- 클릭 시 `/chatbots/:chatbotId/deploy-schedules?needsAttention=true`로 이동.
- 모바일 카드 뷰(`ChatbotCardList.tsx`)에는 카드 하단에 같은 배지를 인라인으로 추가.

### 4.6.4 E6 — 챗봇 상세 대시보드(`DashboardTab.tsx`) 상단 배너

기존 `dashboard-toolbar`(기간 선택기) **위**에 조건부 배너 1개:

```
⚠ 확인이 필요한 예약이 2건 있습니다. [예약 배포에서 확인 →]
```

- 데이터 소스: E4와 같은 `notice` 엔드포인트를 재사용하지 않고, S1/E5와 같은 `summary` 데이터를 챗봇 스코프로 필터링해 사용(또는 `notice.activeCount`가 아니라 목록 진입 시 별도 `GET .../deploy-schedules?needsAttention=true&pageSize=1`로 총건수만 확인 — 구현 시 `frontend-implementer`가 가장 저렴한 조회를 선택, 이 문서는 **표시 위치와 조건만** 규정한다).
- `dashboard.periodError`와 같은 배치(상단, `role="status"`)이되 별도 배너 컴포넌트로 분리(기간 오류와 섞이지 않게).

### 4.6.5 E7 — `TopBar`/`SystemSettingsMenu` 확인 필요 총건수

`SystemSettingsMenu`의 메뉴 항목 배열에 `badge?: (count: number) => string` 필드를 추가하는 대신, **메뉴 트리거 버튼 자체**에 총합 배지를 붙인다(개별 항목이 아니라 버튼 전체 — 사용자가 드롭다운을 열기 전에 "볼 게 있다"를 알아야 하므로):

```
[ 시스템 설정 ▾ ⚠3 ]
```

- `AttentionCountBadge`가 `summary.needsAttention.total`을 표시(0이면 렌더 안 함).
- 폴링: 로그인 세션 동안 **60초 간격**으로 `summary`만 가볍게 재조회(NFR-DP 예산에 영향 없는 저빈도 — 실시간 푸시는 만들지 않는다는 J-10 원칙과 일치). 탭이 백그라운드일 때는 폴링을 멈춘다(`document.visibilityState`).

---

## 5. 사용자 인터랙션 흐름 종합

### 5.1 신규 챗봇 오픈 시각 예약 (S-1, ★ 핵심 경로)

```
SettingsTab(DRAFT) → [공개 예약...] → ScheduleDeployDialog(PUBLISH)
  → ☑ 웹 채널도 함께 열기 → 시각 2027-01-15 09:00 입력 → 보조문 "지금으로부터 3일 후"
  → 준비도: LAST_TEST_RUN "정기 회귀 통과 412/420" 확인 → [1/15 09:00에 공개 시작 + 웹 채널 열기 예약]
  → Toast + S1 목록에 PENDING 행 추가
(1/15 09:00:20) → 상태 ACTIVE, WEB 채널 사용으로 전환 → S1에서 SUCCEEDED(APPLIED) 확인
  → 감사로그: "상태변경 DRAFT→ACTIVE [예약 실행 #...]" + "사용여부변경 false→true [예약 실행 #...]"
```

### 5.2 캠페인 교체와 자동 복귀 (S-2, 체인)

```
버전이력 v31(이벤트 FAQ) 저장 → 즉시 v30으로 복원(운영 원상태)
→ v31 행 [예약 복원] → 10/1 00:00 예약(선행 없음, 기준=현재)
→ v30 행 [예약 복원] → 11/1 00:00 예약
  → ChainBasisNotice "기준: 10/1 00:00 예약(v31) 반영 후 상태"(자동 계산, 사용자 입력 없음)
→ 10/1 00:00 실행 → v31 반영, BEFORE_RESTORE 백업 생성
→ 11/1 00:00 실행 → v30 반영, 새 백업 생성
```

### 5.3 예약 이후 누가 편집했다 (S-3, J-4)

```
FaqsPage 진입 → notice API가 upcomingRestore 감지 → ScheduleConflictBanner 노출
  ("11/1 00:00 v30 복원 예약이 있습니다. 지금 변경하면 예약이 실행되지 않습니다.")
→ 그래도 저장(배너는 막지 않음) → Toast "저장되었습니다."(평소와 동일, 예약 언급 없음)
11/1 00:00 → 예약 상태 FAILED(STATE_CHANGED) → 챗봇 목록/대시보드 "확인 필요" 배지
→ 담당자가 S2에서 사유 확인 → [지금 다시 예약](미리보기 재확인, 최신 변경 포함) 또는 버전 이력에서 즉시 복원
```

### 5.4 서버가 꺼져 있었다 (S-4, misfire)

```
S1/S4에서 지연 실행된 행: DeployScheduleStatusBadge "성공(지연 실행)" + 상세에 "5분 지연 실행"
유예 초과: "누락" 배지 + 후속 예약 자동 HELD
→ S2에서 [지금 다시 예약]
```

### 5.5 선행 예약 실패 시 후속 보류 (S-7)

```
S1: 08:55 버전 복원(FAILED: INTEGRITY_FAILED) · 09:00 공개 시작(HELD: PREDECESSOR_FAILED)
→ 09:00 행 [선행 예약 보기] → 08:55 상세 → 실패 사유 확인
→ 원인 해결(대상 버전 재검토 또는 다른 버전 선택) 후
   09:00 행에서 [보류 해제] → ScheduleDeployDialog 재개 모드(새 시각 필수)
```

### 5.6 VIEWER가 예약을 본다 (S-10)

```
S1/S2/S4 조회 가능 — [+ 예약 만들기]/[취소]/[확인함]/[시각·메모 수정] 전부 렌더되지 않음
SystemSettingsMenu "예약 배포 현황"도 보임(chatbot:read만 요구)
```

### 5.7 오류 처리 요약표

| 오류 | 발생 화면 | 표시 |
|---|---|---|
| `409 RESTORE_PREVIEW_STALE` | S3 확정 | 다이얼로그 유지 + 자동 재확인 |
| `409 RESTORE_BUSY` | S3 확정, No.25 `RestoreDialog`(E8) | **동일** — 다이얼로그 유지 + 자동 재확인(§4.6.1) |
| `409 DEPLOY_SCHEDULE_LIMIT_EXCEEDED` | S3 생성 | 오류 배너 + 목록 링크 |
| `400 DEPLOY_SCHEDULE_INVALID_TIME` | S3 시각 입력 | `ScheduledAtField` 인라인 오류(원인별 문구, §4.3.2) |
| `409 DEPLOY_SCHEDULE_PRECONDITION_FAILED` | S3 생성/재개 | `details.message`(Reason) 매핑 문구(§4.3, §4.3.4 표) |
| `409 DEPLOY_SCHEDULE_NOT_MODIFIABLE` | S2 수정/취소/재개(경합) | Toast "이미 상태가 바뀌어 처리할 수 없습니다." + 상세 재조회 |
| `409 VERSION_REFERENCED_BY_SCHEDULE` | 버전 이력 L1 삭제(No.25 화면, 이 그룹이 유발) | 기존 `409 VERSION_PINNED` 처리와 같은 인라인 오류 패턴 + 참조 예약 목록 링크(No.25 `KebabMenu` "삭제" 흐름에 1개 분기 추가 — `frontend-implementer`가 `VersionRow`에 반영) |
| `403 FORBIDDEN`(VIEWER 변경 시도) | 전 화면 | 버튼 자체가 렌더되지 않으므로 정상 경로에서는 발생하지 않음(방어적으로만 Toast) |
| `404`(교차 챗봇/삭제된 예약) | S2 딥링크 | "찾을 수 없습니다" + 목록 복귀 |

---

## 6. 권한별 화면 요소

| 요소 | VIEWER(`chatbot:read`만) | 동작별 관리 권한 보유 |
|---|---|---|
| S1/S2/S4 조회 | 표시 | 표시 |
| `[+ 예약 만들기]`(S1), 각 진입점(E1/E2/E3) | **렌더 안 함** | 동작별 권한 있을 때만(아래 표) |
| `[시각/메모 수정]`/`[취소]`/`[보류 해제]`(S2) | **렌더 안 함** | 해당 예약의 `action`에 필요한 권한 전부 보유 시 |
| `[확인함]` | **렌더 안 함**(관리 권한 필요, PM 확정) | `chatbot:write` ∨ `channel:write` 중 하나 이상 보유 시(§8.2 ① 판정과 동일 기준) |
| `SystemSettingsMenu` "예약 배포 현황" | 표시(`chatbot:read`만 요구) | 표시 |

동작별 필요 권한(설계서 §8.1 그대로, 생성=수정=취소=재개=즉시 실행과 동일):

| 동작 | 필요 권한(AND) |
|---|---|
| `RESTORE_VERSION` | `dialogue:write` + `chatbot:write` |
| `PUBLISH` | `chatbot:write`(+ `enableWebChannel=true`면 `channel:write`) |
| `SET_WEB_CHANNEL` | `channel:write` |
| G3(`postRunTestSetId`) | 위 + `simulation:write`(생성 시만 필수) |

API 직접 호출 시 서버가 최종 통제(`403`) — 화면은 방어의 첫 겹일 뿐이다(No.25와 동일 원칙).

---

## 7. 상태별 화면(로딩/빈/오류) 총정리

| 화면 | 로딩 | 빈 상태 | 오류(조회 실패) |
|---|---|---|---|
| S1 | `SkeletonRow`×5 | `EmptyState` + 동작 3종 설명 + 버전 이력 안내 | `ErrorState` + 재시도 |
| S2 | `SkeletonRow`×6 | (단건 조회라 해당 없음) | `ErrorState` 또는 `404` 전용 문구 |
| S3 | 미리보기 `Skeleton` | (해당 없음) | `loadFailed` + 재시도 버튼 |
| S4 | `Summary24hBar` 스켈레톤 + `SkeletonRow`×8 | "권한 범위 내 챗봇에 예약이 없습니다." | `ErrorState` |

모든 목록 로딩은 UIUX §8("조회 중" 명시) 원칙에 따라 스피너 단독이 아니라 **스켈레톤 행**으로 표시한다(No.25/No.19 관행 상속).

---

## 8. `messages.ts` 키 설계 (`MESSAGES.deploySchedules.*`)

`MESSAGES.versions.restore.*`(No.25)와 동일한 구조 관행(중첩 네임스페이스, 함수형 메시지로 동적 값 삽입)을 따른다. `frontend-implementer`가 구현 시 아래 뼈대를 채운다(문구 표는 본문 각 절에 이미 명시했으므로 여기서는 **키 트리 구조**만 제시):

```
MESSAGES.deploySchedules = {
  pageTitle, globalPageTitle,
  createButton, actionPicker: { RESTORE_VERSION, PUBLISH, SET_WEB_CHANNEL, ... },
  emptyTitle, emptyDesc, emptyCreateButton, engineDisabledBanner, overdueBanner,
  filterLabel, filterAllStatus, filterAllAction, needsAttentionFilterLabel,
  statusBadge: { PENDING, PENDING_RETRYING, RUNNING, SUCCEEDED_APPLIED, SUCCEEDED_NOOP, SUCCEEDED_RECOVERED, FAILED, MISSED, HELD, CANCELLED },
  actionLabel: { RESTORE_VERSION, PUBLISH, PUBLISH_WITH_CHANNEL, SET_WEB_CHANNEL_OPEN, SET_WEB_CHANNEL_CLOSE },
  reasons: { failure: {...12종}, held: {...4종}, transient: {...3종} },
  attentionBadgeAriaLabel, attentionBadgeText,
  detail: { chainPredecessor, chainSuccessor, stateCheckButton, stateCheckMismatch, readiness: {...9종},
            resultSummary: {...}, revertLink, tcResultLink, retryButton, resumeButton, cancelButton,
            acknowledgeButton, editTimeButton },
  dialog: { titleByAction, chainBasisNotice, scheduledAtLabel, scheduledAtRelative, memoLabel,
            acknowledgeActiveLabel, postRunTestOptionLabel, confirmButtonByAction, timeErrors: { LEAD, HORIZON, SPACING },
            limitExceeded, chainOrderBlocked, duplicatePublish },
  notice: { conflictBannerText, goToScheduleLink },
  summary: { last24hText, needsAttentionText },
  global: { chatbotColumn, ... },
}
```

기존 `MESSAGES.detail.tabDeploySchedules`(탭 라벨), `MESSAGES.systemSettings.deploySchedules`(전역 메뉴 항목) 2개는 각각 기존 네임스페이스에 추가한다(§0-8).

---

## 9. 폴링/새로고침 정책 총정리

| 화면 | 정책 |
|---|---|
| S1(챗봇별 목록) | `RUNNING` 또는 재시도 중 `PENDING` 존재 시 5초 폴링, 그 외 수동 새로고침 |
| S2(상세) | `status='RUNNING'`일 때만 3초 폴링(`TestRunListPage`의 `POLL_INTERVAL_MS` 관행), 종결 상태 도달 시 폴링 자동 중단 |
| S3(다이얼로그) | 폴링 없음(요청-응답 1회성 흐름) |
| S4(전역 목록) | `summary`만 60초, 목록 본문은 수동 새로고침 |
| E5(챗봇 목록 배지) | 목록 진입 시 1회(`summary`) — 페이지 유지 중 재조회 없음(필터/페이지 변경과 무관한 별도 데이터라 과도한 재조회 방지) |
| E6(챗봇 대시보드 배너) | 탭 진입 시 1회 |
| E7(TopBar 배지) | 세션 동안 60초, 탭 비활성 시 중단 |
| E4(자산 편집 배너) | 화면 마운트 시 1회, 저장 후에도 재조회하지 않음(§4.6.2 근거) |

실시간 푸시(웹소켓)는 만들지 않는다(J-10, FR-D6-3) — 위 표가 "화면 진입·주기 조회로 충분하다"는 요구사항 결정의 구체화다.

---

## 10. `UIUX_준수기준.md` 체크리스트 매핑

| 화면 | §1 색상대비/단독금지 | §3 키보드 | §4 버튼 | §5 텍스트입력 | §6 폼컨트롤 | §7 오류메시지 | §8 로딩/비동기 | §9 내비게이션 |
|---|---|---|---|---|---|---|---|---|
| S1 목록 | `DeployScheduleStatusBadge`/`AttentionCountBadge` 아이콘+색+텍스트 3중 | 행·케밥 Tab 순회, 필터 다중선택 방향키 | "예약 만들기"/"확인함" 동사형, 44×44px | 기간 필터 레이블 필수 | 상태/동작 다중선택(체크박스, §6 다중=체크박스 원칙), 값변경 즉시 반영은 목록 필터 관례 | 사유 문구 원인+해결(§3.3 표) | `SkeletonRow`, `EmptyState`, 폴링 상태는 시각 표시+`aria-live` | 페이지네이션 밑줄+형태, 행 클릭 라우팅 |
| S2 상세 | `ScheduleChainPanel`/`ReadinessWarningList` 아이콘+텍스트 | 버튼 Tab 순회 | "지금 다시 예약"/"확인함" 44×44px | 시각/메모 인라인 편집 레이블 필수 | — | 상태 불일치·수정 거부 인라인 오류(원인+해결) | 상태 점검 스피너+`aria-live`, RUNNING 폴링 시각 표시 | 체인 링크 `<a>` 유사 라우팅 |
| S3 다이얼로그 | blockers/warnings 아이콘+색+텍스트(No.25 패턴 상속) | 포커스 트랩·Esc·**기본 포커스=취소** | 확정 버튼 대상 명시(FR-D7-5), 44×44px, 제출 중 `disabled` | `ScheduledAtField` 날짜/시/분 레이블 필수(플레이스홀더 아님), 메모 글자수 실시간 표시(§5) | `ActionPickerStep` 라디오 그룹 방향키, `acknowledgeActive`/G3 체크박스 명시적 문장 레이블 | 시각 규칙·한도·경합 오류 전부 원인+해결(§4.3), 결과 `aria-live` | 미리보기 로딩 스피너+`aria-live`, 제출 진행 표시 | — |
| S4 전역 목록 | 동일(S1과 공유 컴포넌트) | 동일 | "새로고침" 44×44px | — | 챗봇 콤보 방향키 탐색 | — | `Summary24hBar` 스켈레톤 | 행→S2 라우팅 |
| E1~E3 진입점 확장 | 신규 버튼 색상 단독 아님(기존 버튼 스타일 상속) | 기존 컴포넌트 Tab 흐름 상속 | "예약 복원"/"공개 예약..."/"열기·닫기 예약..." 44×44px | — | — | — | — | — |
| E4 배너 | `SeverityBadge(WARNING)` 아이콘+텍스트 | 배너 내 링크 Tab 진입 | — | — | — | — | — | 배너 링크 |
| E5~E7 배지 | `AttentionCountBadge` 색상+텍스트(건수 숫자 병기) | 배지 자체는 비대화형(포커스 대상 아님), 링크는 Tab 진입 | — | — | — | — | — | — |

공통: 신규/변경 화면 **axe 스캔 대비 위반 0건**, 모든 신규 버튼 **44×44px 이상**, 모든 폼 **레이블 필수**, 제출/취소 다이얼로그는 **`Modal`의 포커스 트랩·`Esc`·기본 포커스 취소를 그대로 상속**한다.

---

## 11. 반응형 고려사항

1. **S1/S4 목록**: 행 기반 리스트이므로 별도 브레이크포인트 없이 모바일에서도 동일 구조 유지. 좁은 화면(<640px)에서는 필터 바가 접이식(`ChatbotFilterBar` 모바일 패턴 상속)으로 전환되고, 행 액션(`[선행 예약 보기]`/`[지금 다시 예약]`/`[확인함]`)은 세로 스택으로 줄바꿈되되 각 44×44px 이상 유지.
2. **S2 상세**: 데스크톱은 2단 레이아웃(좌: 요약/체인, 우: 준비도/결과) 여지가 있으나 기본 설계는 **1단 세로 스택**으로 통일(No.19 `TestRunDetailPage` 관행과 동일 — 반응형 예외를 만들지 않는다).
3. **S3 `ScheduleDeployDialog`**: 기존 `Modal`의 반응형 규칙(좁은 화면 전체폭, 포커스 트랩)을 상속. `ScheduledAtField`의 날짜/시/분 3필드는 좁은 화면에서 세로 스택(각 필드 레이블 유지, 가로 배치 강제 안 함).
4. **`TabNav` 자체**: "배포" 그룹이 2 → 3항목이 되어도 기존 규칙(`quality-channel-ui-spec.md` §2.4 — 태블릿 그룹 단위 줄바꿈, 모바일 바텀시트 드롭다운)이 그대로 적용된다 — 신규 반응형 예외 없음.
5. **`apps/widget`**: 이 그룹은 위젯 화면에 변경이 없다(§0) — 최종 사용자 화면 반응형 고려사항 없음. 다만 S-8/S-9(복원·채널 닫기 순간의 대화 중 사용자)는 화면이 아니라 기존 위젯의 오류/폴백 표시(No.11/25 규약)를 그대로 따른다는 점만 재확인한다.

---

## 12. Out of scope / 재검토 트리거

| 항목 | 사유 | 재검토 트리거 |
|---|---|---|
| S1/S2에서 전역 목록처럼 여러 챗봇을 한 화면에 섞어 보기 | 챗봇 스코프 권한 판정을 단일 화면으로 유지(§4.4 판단) | 전역 화면에서도 취소·재개가 필요하다는 요구가 반복될 때 |
| 반복 예약(cron) UI | 요구사항 §9 — 1회성만 | `@nestjs/schedule` 재검토와 함께(요구사항 §9 트리거) |
| 실행 전 TC 게이트(G1/G2) 관련 UI(합격 임계 설정 등) | PM 확정 P-3 — 1차 제외 | 스냅샷 번들 TC 모드가 생길 때 |
| "변경 무시하고 강행" 옵션 UI | PM 확정 P-4 — 1차 제외 | `STATE_CHANGED` 실패가 반복 보고될 때 |
| 외부 알림(이메일·웹훅) 설정 UI | J-10 — 콘솔+감사로그만 | No.41/45 |
| "운영" 그룹 5항목 확장에 따른 셸 재구성 | 이번 결정으로 "운영"(4)·"배포"(3) 모두 기존 최대치 이내 유지 | "배포" 그룹에 4번째 최상위 탭 요구가 들어올 때(No.40 "포인터 전환" 도입 시 유력) |
| S2 상세의 2단 데스크톱 레이아웃 | 1차는 1단 통일(§11-2) | 정보량이 늘어 스크롤이 길어진다는 피드백이 쌓일 때 |

---

## 13. 다음 단계 인계

| 에이전트 | 인계 내용 |
|---|---|
| **`backend-implementer`** | 설계서 §2~§16 구현. 본 문서가 전제하는 API 계약(설계서 §13, 13개 핸들러 + `notice`/`summary`/`meta`/`state-check`)이 화면 데이터 바인딩의 기준이다. 특히 `notice` 엔드포인트(§4.6.2)는 8~10개 자산 편집 화면이 **마운트마다** 호출하므로 응답이 가볍고(인덱스 조회 1~2건) 캐시 없이도 빨라야 한다(이미 설계서 §13.1이 이렇게 설계함 — 회귀 없이 그대로 사용). `RESTORE_BUSY` 신설(설계서 §9.1)이 완료되어야 §4.6.1 프런트 변경이 의미를 갖는다. |
| **`frontend-implementer`** | 구현 순서 권고: ① `MESSAGES.deploySchedules.*`/`MESSAGES.detail.tabDeploySchedules`/`MESSAGES.systemSettings.deploySchedules` 상수 + `TabNav.tsx`·`SystemSettingsMenu.tsx` 링크 2개 추가 → ② `DeployScheduleStatusBadge`/`DeployScheduleActionLabel`/`AttentionCountBadge`(공용 컴포넌트, 가장 많이 재사용됨) → ③ S1 목록(필터·행·취소·확인함) → ④ S2 상세(체인·상태점검·결과·재시도/재개) → ⑤ `ScheduleDeployDialog`(No.25 `RestoreDialog`의 미리보기/blockers/warnings 렌더 로직을 최대한 함수 단위로 추출해 공유 — 신규 컴포넌트가 그 로직을 복제하지 않게 주의) → ⑥ E1/E2/E3 진입점 버튼(가장 마지막 — 대상 다이얼로그가 먼저 있어야 함) → ⑦ S4 전역 목록 → ⑧ E4~E7(배너·배지, 여러 기존 화면에 걸쳐 있어 회귀 위험이 가장 큼 — 각 화면 기존 스냅샷/접근성 테스트가 있으면 먼저 확인) → ⑨ **No.25 `RestoreDialog.tsx`의 `RESTORE_BUSY` 1줄 수정**(§4.6.1, 어느 단계에서 해도 무방하나 누락 방지를 위해 체크리스트에 명시). 권한 판정은 `can()` 조합만 사용, 서버가 최종 통제. |
| **`test-automation`** | UI 단위 검증 대상: `ScheduleDeployDialog` 기본 포커스=취소 · 시각 입력 3종(리드타임/최대기간/간격) 인라인 오류 · `acknowledgeActive`/G3 체크박스 미체크 시 확정 버튼 비활성 · `RESTORE_BUSY`/`RESTORE_PREVIEW_STALE` 두 코드 모두 동일 재확인 흐름 트리거 확인(E8) · `DeployScheduleStatusBadge` 7종 색상단독 아님(axe 대비 포함) · VIEWER 계정으로 S1/S2/S4 렌더 시 쓰기 버튼 0건 확인(§6) · E4 배너가 `upcomingRestore=null`이면 8~10개 화면 어디서도 렌더되지 않음 확인 · S1/S2 폴링이 종결 상태 도달 시 정상 정지하는지(누수 없음) 확인. |
