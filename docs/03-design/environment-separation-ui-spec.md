# 환경 분리 / 버전 관리 (No.40) — 화면 설계서

> **대상 기능**: No.40 환경 분리/버전 관리 — 관리자 콘솔(`apps/web`) 전용. `apps/widget`·`packages/dialogue-engine`·`apps/ml-worker`는 변경 0건(J-13, FR-0-149).
> **입력 문서**: `docs/requirements/environment-separation.md`(T-1~T-12, J-1~J-20, FR-0-149~160, FR-EN1~EN9-\*, NFR-ENP/ENS/ENA/ENM, AC-EN1~EN8, EX-EN-1~26, §11 P-1~P-12 전부 추천안 확정), `docs/02-spec/environment-separation-설계.md`(§1~§29, API 11개 + 기존 6경로 확장, Prisma 3테이블+2컬럼, 신규 `ApiErrorCode` 8종, §17 권한 매트릭스, §23 관리자 콘솔 인계), `docs/02-spec/decisions/ADR-0039-environment-pointers-version-serving-and-content-addressed-vector-retention.md`
> **PM 확정**(2026-09-25, 전부 추천안): P-1(d) 한 챗봇 안의 환경 포인터(1차) · P-2(b) 3단 고정(초안→스테이징→운영, 콘솔 검수만) · P-3(b) 즉시+예약 전환(비율 분할 2차) · P-4(2) 신규 권한 `chatbot:deploy`(ADMIN 기본, 스테이징 승격은 기존 권한) · P-5 경고 게이트 기본+챗봇별 차단 선택 · P-6 켜기=자동 초기화/끄기=매번 선택(기본 "운영 유지") · P-7 복원=초안만/운영 되돌리기=롤백 · P-8 `SWITCH_PROD_VERSION`+모드 켜기 시 기존 `RESTORE_VERSION` 예약 `HELD` · P-9 스냅샷 밖 자산은 즉시 반영+안내 · P-10 위젯 이름·아바타·스킨=운영 버전 값 · P-11 1차 로그 귀속만 · P-12 GPU 1 유지
> **준수 기준**: `docs/03-design/UIUX_준수기준.md`(전 항목, 특히 §1 색상단독금지·§3 키보드·§4 버튼·§6 폼컨트롤·§7 오류메시지·§8 로딩/비동기)
> **재사용 대상**: `version-history-ui-spec.md`(§4.4 `RestoreDialog`/`restorePreviewText.tsx`의 blockers·warnings·diff요약 렌더 로직, §3.3 고정 시각 언어 관행), `scheduled-deploy-ui-spec.md`(전체 — `ScheduleDeployDialog`/`ActionPickerStep`/`ScheduledAtField`/`ReadinessWarningList`/`ChainBasisNotice`/`AttentionCountBadge`/탭 그룹 판단 방식·§1.2~1.3 대안 비교 방식), `topic-system-ui-spec.md`(환경 밖 자산 안내 배너 관행), `feedback-loop-ui-spec.md`(대상 "삭제됨" 표시 관행 — `FeedbackTargetPanels.tsx`)
> **실제 코드 확인**: `apps/web/src/pages/chatbot-detail/TabNav.tsx`(4그룹 10라우트, "배포" 그룹 3항목), `ChatbotDetailHeader.tsx`, `apps/web/src/pages/ChatbotDetailLayout.tsx`(공통 컨텍스트·`learningSummary` 1회 조회 관행), `versions/VersionListPage.tsx`+`VersionRow.tsx`+`restore/RestoreDialog.tsx`+`restore/restorePreviewText.tsx`(No.25 구현체), `deploy-schedules/ScheduleDeployDialog.tsx`+`ActionPickerStep.tsx`+`ReadinessWarningList.tsx`+`DeployScheduleRow.tsx`(No.28 구현체), `lib/deploySchedulePermissions.ts`, `lib/useDeployScheduleMeta.ts`, `components/AttentionCountBadge.tsx`+`SeverityBadge.tsx`+`VersionTriggerBadge.tsx`, `simulator/SimulatorTab.tsx`+`SimulatorDrawer.tsx`, `validation/runs/RunTriggerButton.tsx`+`EnvFingerprintBadgeGroup.tsx`, `learning/UnansweredTable.tsx`+`ClassifierBadges.tsx`+`FeedbackTargetPanels.tsx`, `chatbot-detail/AnswerSettingsTab.tsx`+`answer-settings/HandoffSettingsSection.tsx`, `chatbot-detail/ChannelsTab.tsx`+`channels/ChannelCard.tsx`, `dialogue/DialogueShell.tsx`(중첩 Outlet 컨텍스트 전달 관행)+`SurveysListPage.tsx`+`TopicsPage.tsx`+`CannedResponsesPage.tsx`, `constants/messages.ts`(네임스페이스 구조)
> **작성**: ui-designer · 2026-09-25 · **다음 단계**: `backend-implementer`(설계서 §2~§29 구현 후) → `frontend-implementer`
> **범위 경계**: React 컴포넌트 실제 코드는 작성하지 않는다.

---

## 0. 전제와 연계 확인

1. **API·데이터 스키마는 설계서 기준으로 아직 구현되지 않은 확정 계약이다.** `packages/shared-types/src/bundle-target.ts`·`environment.ts`(신규 파일 2개), `version.ts`/`deploy-schedule.ts`/`validation.ts`/`conversation.ts`/`learning.ts`/`security.ts`/`audit.ts`/`common.ts`의 확장분(설계서 §4)은 **아직 코드에 없다**. `backend-implementer`가 구현한 뒤 본 문서 기준으로 화면을 만든다(No.25/No.28과 동일한 전제).
2. **기존 10개 라우트는 하나도 바꾸지 않는다.** "배포" 그룹(현재 스킨/임베드·채널·예약 배포 3항목)에 **4번째 탭 "환경"** 1개만 추가한다(§1 — `scheduled-deploy-ui-spec.md` §12가 "No.40 도입 시 유력"이라 미리 예고한 재검토 트리거가 지금 발동한다).
3. **`packages/dialogue-engine`·`apps/widget`·`apps/ml-worker` 변경 0건**(FR-0-149, 설계서 §2.3·E-5/E-10). 화면이 다루는 것은 ① 포인터 조회·전환·이력 ② 버전 스냅샷(No.25 부품 재사용) ③ 게이트 판정(순수 함수 결과 렌더)뿐이다.
4. **No.25·No.28 컴포넌트를 최대한 재사용한다.** `restorePreviewText.tsx`의 `summaryLine`(버전 ↔ 버전 차이 요약 — `VersionDiffSummarySchema` 그대로 재사용, 설계서 §9.3 `diffSummary`), `ScheduledAtField`/`ChainBasisNotice`/`ReadinessWarningList`(예약 전환도 같은 예약 엔진이므로 그대로), `AttentionCountBadge`/`SeverityBadge`/`VersionTriggerBadge`의 "아이콘+색+텍스트" 3중 표현 관행. **완전히 새로 만드는 것은 "환경 현황 3단 표시 + 전환 미리보기(게이트·경고) + 확정" 단계와 게이트 설정 폼뿐**이다(§4).
5. **기존 파일에 손대야 하는 지점**(상세는 각 절):
   - `RestoreDialog.tsx`/`restorePreviewText.tsx` — `ENV_DRAFT_ONLY` 경고 문구 분기(§4.11)
   - `VersionRow.tsx` — `environmentBadges` 표시, 삭제 확인창에 `VERSION_REFERENCED_BY_ENVIRONMENT` 분기(§4.10, §4.12)
   - `ActionPickerStep.tsx`/`ScheduleDeployDialog.tsx`/`lib/deploySchedulePermissions.ts`/`ReadinessWarningList.tsx` — `SWITCH_PROD_VERSION` 동작 추가(§4.9, 설계서 §23이 이미 "컴파일 오류로 누락이 드러난다"고 명시한 지점)
   - `TabNav.tsx` — 4번째 탭(§1)
   - `ChatbotDetailHeader.tsx` — 환경 배지(§4.17)
   - `ChatbotDetailLayout.tsx`(`ChatbotDetailContext`) — `environmentStatus`/`refreshEnvironmentStatus` 추가(§4.2, `learningSummary` 관행과 동일)
   - `SimulatorTab.tsx`/`SimulatorDrawer.tsx`/`SimulatorPanel` — 대상 선택(§4.13)
   - `RunTriggerButton.tsx`/`EnvFingerprintBadgeGroup.tsx`/`TestRunListPage.tsx`/`TestRunDetailPage.tsx`/`TestRunComparePage.tsx` — 대상 선택·표시·비교 경고(§4.14)
   - `UnansweredTable.tsx`/`ClassifierBadges.tsx`/`FeedbackTargetPanels.tsx` — "운영 미반영"·"초안에 없음"(§4.16)
   - `SurveysListPage.tsx`/`SurveyFormPage.tsx`/`HandoffSettingsSection.tsx`/`CannedResponsesPage.tsx`/`ChannelsTab.tsx`/`TopicsPage.tsx` — 환경 밖 자산 안내(§4.15)
   - `App.tsx` — `/chatbots/:chatbotId/environment` 라우트 등록
6. **신규 권한 1종**(`chatbot:deploy`, ADMIN 기본, J-4). 스테이징 승격은 **기존 권한**(`dialogue:write` AND `chatbot:write`, EDITOR 가능)이다 — 켜기/끄기·운영 전환·롤백·예약 전환·게이트 설정만 신규 권한이 필요하다(§6).
7. **시간대**: 예약 전환도 기존 예약 배포와 같은 시간대 규약(`useDeployScheduleTimezone()`, `GET /deploy-schedules/meta`)을 그대로 쓴다 — 별도 API 호출을 만들지 않는다.
8. **문구 규칙**(FR-0-160): 화면 어디서도 "포인터"·"스냅샷 번들"·"보존 저장소" 같은 내부 용어를 쓰지 않는다. **"초안 · 스테이징 · 운영"** 을 고정 용어로 쓰고 필요시 영문(Dev/Staging/Prod)은 괄호 보조 표기만 한다. 모든 신규 한국어 문구는 `MESSAGES.environment.*`(신규 네임스페이스, §8)로 상수화하고, 기존 네임스페이스(`versions`·`deploySchedules`·`learning`·`detail`·`simulator`·`validation`) 확장분은 각 절에서 명시한다.
9. **신규 컴포넌트 배치**: `apps/web/src/pages/chatbot-detail/environment/`(환경 탭 전용) + `apps/web/src/components/`(여러 화면이 공유하는 배지·배너).
10. **데이터 바인딩 기준 스키마**는 설계서 §4(shared-types 전체) · §19(API 계약 11개 + 기존 6경로 확장 + 오류 코드 8종) · §5(모드 켜기/끄기) · §9(승격·전환·롤백·이력) · §10(게이트) · §11(예약 전환)이다.

---

## 1. 정보구조 판단 — "배포" 그룹에 4번째 탭("환경") 추가

### 1.1 현재 상태 확인 (코드 근거)

`TabNav.tsx`(실제 코드)는 4개 시각적 그룹, 10개 라우트다:

| 그룹 | 포함 탭(현재) |
|---|---|
| 운영(4) | 대시보드 · 통계 · 기본설정 · 버전 이력 |
| 설계(1) | 대화설계(서브내비 8항목: 노드·의도·동음이의어·컨텍스트·FAQ·설문·자주 쓰는 문장·토픽) |
| 검증(3) | AI 답변 설정 · 응답 테스트 · 대화검증 |
| 배포(3) | 스킨/임베드 · 채널 · **예약 배포**(No.28) |

### 1.2 검토한 대안

| 안 | 내용 | 판정 |
|---|---|---|
| A. "버전 이력" 탭 안에 서브 뷰로 통합 | 라우트 신설 0건 | **기각** — 환경은 "버전을 보는 화면"이 아니라 "지금 운영/스테이징이 어떤 버전인지 + 그것을 바꾸는 화면"이다. `version-history-ui-spec.md` §1.2-A와 `scheduled-deploy-ui-spec.md` §1.2-A가 같은 이유로 기각한 전례와 동일하다 — 탭의 의미가 "조회"에서 "동작"으로 뒤바뀐다. |
| B. "예약 배포" 탭 안에 서브 뷰로 통합 | 라우트 신설 0건, 예약 배포가 "환경"까지 포괄 | **기각** — 두 화면은 서로 다른 엔티티를 다룬다. 예약 배포는 "언제"(`DeploySchedule`) 축이고, 환경은 "지금 무엇이 운영인가"(`Chatbot.prodVersionId`/`ChatbotEnvironment`) 축이다. `SWITCH_PROD_VERSION`은 환경 전환의 **예약된 한 형태**일 뿐이므로(§4.9), 예약 배포 탭에는 지금처럼 진입점만 두고 본체는 별도 탭이 맞다 — No.25 버전 이력과 No.28 예약 배포가 분리된 것과 같은 논리. |
| **C. "배포" 그룹에 4번째 탭으로 추가(채택)** | 라우트 신설 1개, 배포 그룹 3 → 4항목 | **채택** |
| D. 신규 최상위 그룹("환경관리") 신설 | 그룹 5개로 확장 | **기각** — 항목 1개짜리 그룹은 `quality-channel-ui-spec.md` §2.4·`scheduled-deploy-ui-spec.md` §1.2-D가 정한 "그룹은 2항목 이상일 때만 분리 표시" 관행에 어긋난다. |

### 1.3 C를 채택하는 근거

1. **카탈로그 원문이 이미 "배포 전 검증"·"트래픽 전환"을 말한다.** No.40 원문(`기능요구사항.md` 89행)의 핵심 동사는 "전환"이며, 이는 "배포"라는 행위(만든 것을 내보내는 단계) 그 자체다. 기존 "배포" 그룹(스킨/임베드=위젯 노출, 채널=공개 경로, 예약 배포=시각 지정 반영)의 정의와 정확히 일치한다.
2. **`scheduled-deploy-ui-spec.md` §12가 이미 이 트리거를 예고했다.** "'배포' 그룹에 4번째 최상위 탭 요구가 들어올 때(No.40 '포인터 전환' 도입 시 유력)" — 지금이 그 시점이다. 이 문서는 그 재검토를 수행한 결과다.
3. **"운영" 그룹이 이미 4항목**(대시보드·통계·기본설정·버전 이력)이라는 선례가 있다. "배포" 그룹이 3 → 4가 되어도 기존 반응형 규칙(`quality-channel-ui-spec.md` §2.4 — 태블릿 그룹 단위 줄바꿈, 모바일 드롭다운)이 그대로 적용되며, 셸을 재구성할 필요가 없다.
4. **4탭 각각의 의미가 분명히 구분된다.** 스킨/임베드=위젯 표시 설정, 채널=공개 경로 열림/닫힘, 예약 배포=시각 축(언제), 환경=버전 축(무엇). 겹치지 않는다.
5. **"버전 이력"·"예약 배포" 탭은 그대로 둔다.** 두 탭에는 이 그룹의 **진입점만** 추가된다(버전 이력의 환경 배지·복원 확인창 문구 변경 — §4.10~4.11, 예약 배포의 동작 1종 추가 — §4.9). "관리"는 새 탭 1곳에 모인다 — No.28이 "여러 화면에서 트리거되지만 결과는 한 곳에 쌓인다"고 설계한 것과 같은 패턴이다.

### 1.4 라우트

```
/chatbots/:chatbotId/environment   → EN1 환경 탭(현황·승격·전환·롤백·게이트·이력 전부 이 화면 안)
```

전역 목록(No.28의 S4 같은 화면)은 만들지 않는다 — 환경은 챗봇마다 최대 상태 1개(켜짐/꺼짐)뿐이라 "여러 챗봇을 가로질러 확인 필요 건을 훑는" 수요가 없다(No.28의 예약 여러 건과 다른 카디널리티). 필요해지면 §12 재검토 트리거.

`TabNav` 확장(기존 파일 1곳만 수정):

```html
<div class="tab-nav-group" role="group" aria-label="배포">
  <a href="/chatbots/:id/skin">스킨/임베드</a>
  <a href="/chatbots/:id/channels">채널</a>
  <a href="/chatbots/:id/deploy-schedules">예약 배포 <NavPendingBadge .../></a>
  <a href="/chatbots/:id/environment" class="tab-nav-link">
    환경 <EnvironmentModeIndicator status={environmentStatus} />  <!-- [신규] §4.17과 별개의 소형 표시 -->
  </a>
</div>
```

`MESSAGES.detail.tabEnvironment = '환경'` 1개 키만 추가. 탭 자체에는 "확인 필요" 집계 배지를 달지 않는다(§12 — 게이트 미달·전환 대기 같은 "주의" 개념은 이 그룹에 없다. 예약된 전환의 확인 필요는 이미 "예약 배포" 탭의 기존 배지가 담당한다). 대신 모드 켜짐 챗봇에서만 렌더되는 아주 작은 `EnvironmentModeIndicator`(텍스트 "●" 없이 스크린리더 전용 접두어 없는 순수 장식 — 실제 상태 정보는 헤더 배지(§4.17)가 텍스트로 이미 제공하므로 탭에는 중복 낭독을 만들지 않는다. 시각 사용자를 위한 최소 신호만) — 상세는 §4.17.

---

## 2. 화면 목록 및 라우트 요약

| ID | 화면/구성요소 | 라우트/형태 | 진입 경로 | 권한(조회/쓰기) |
|---|---|---|---|---|
| EN1 | 환경 탭 본체(현황·승격·전환·롤백·게이트·이력) | `/chatbots/:chatbotId/environment` | `TabNav` "환경" | `chatbot:read`+`dialogue:read` / 동작별(§6) |
| EN1-a | 켜기 확인 대화상자(`EnvironmentEnableDialog`) | 모달 | EN1의 `[환경 분리 사용...]` | `chatbot:deploy` |
| EN1-b | 끄기 확인 대화상자(`EnvironmentDisableDialog`) | 모달 | EN1의 `[환경 분리 끄기...]` | `chatbot:deploy`(+내부적으로 복원 API 호출) |
| EN1-c | 스테이징 승격 확인(`StagingPromoteDialog`) | 모달(경량) | EN1의 `[스테이징으로 승격]` | `dialogue:write`+`chatbot:write` |
| EN1-d | 운영 전환·롤백 대화상자(`ProdSwitchDialog`) | 모달 | EN1의 `[운영 전환...]`/`[직전 버전으로 되돌리기...]`, 이력 표의 `[이 버전으로 롤백...]` | `chatbot:deploy` |
| EN1-e | 게이트 설정 패널(`GateSettingsPanel`) | EN1 내 인라인 확장 섹션(모달 아님) | EN1의 `[게이트 설정]` 토글 | 조회 `chatbot:read`, 저장 `chatbot:deploy` |
| EN1-f | 전환 이력 표(`EnvironmentHistoryTable`) | EN1 내 섹션(페이지네이션) | EN1 하단 | `chatbot:read` |
| E-EN1 | 예약 배포 화면(No.28 S1~S3) 확장 | 기존 라우트 그대로 | `ActionPickerStep`에 4번째 카드, EN1의 `[예약 전환...]` | `chatbot:deploy` |
| E-EN2 | 버전 이력 `VersionRow` 확장 | 기존(No.25) | 환경 배지 표시(쓰기 없음) | 조회 시 자동 |
| E-EN3 | 복원 대화상자(`RestoreDialog`) 확장 | 기존(No.25) | `ENV_DRAFT_ONLY` 경고 시 자동 | 기존과 동일 |
| E-EN4 | 버전 삭제 확인창 확장 | 기존(No.25) | `VERSION_REFERENCED_BY_ENVIRONMENT` 409 시 자동 | 기존과 동일 |
| E-EN5 | 시뮬레이터 대상 선택 | 기존(`SimulatorTab`/`SimulatorDrawer`) | 대화 영역 상단 | `simulation:read` |
| E-EN6 | TC 실행 대상 선택·표시·비교 경고 | 기존(`RunTriggerButton`/`TestRunListPage`/`TestRunDetailPage`/`TestRunComparePage`) | 실행 시작 대화상자, 목록/상세/비교 화면 | `simulation:write`(실행) / `simulation:read`(조회) |
| E-EN7 | 학습현황 "운영 미반영"·"초안에 없음" | 기존(`UnansweredTable`/`FeedbackTargetPanels`) | 통계 탭 → 학습현황 | 조회만 |
| E-EN8 | 환경 밖 자산 화면 안내(`EnvironmentScopeNotice`) | 기존 5개 화면(§4.15) | 각 화면 상단 | 조회 시 자동(모드 켜짐만) |
| E-EN9 | 콘솔 공통 헤더 환경 배지 | `ChatbotDetailHeader.tsx` | 챗봇 상세 전 화면 공통 | 조회만 |

---

## 3. 공통 UI 요소

### 3.1 재사용(변경 없음)

`Modal`/`ConfirmDialog`(기본 포커스 `[data-autofocus="cancel"]`), `Toast`, `InlineFieldError`, `SkeletonRow`/`SkeletonCard`, `EmptyState`, `ErrorState`, `SeverityBadge`, `Pagination`, `KebabMenu`, `ArchivedBanner`, `VersionTriggerBadge`, `StatusBadge`, `Avatar`. **No.25**: `restorePreviewText.tsx`의 `summaryLine(rows)`(버전 ↔ 버전 차이 요약 — `ProdSwitchPreviewResponse.diffSummary`가 같은 `VersionDiffSummarySchema`이므로 그대로 호출). **No.28**: `ScheduledAtField`(날짜·시·분 입력 + 시간대 라벨), `ChainBasisNotice`(예약 전환도 같은 체인 규칙), `ReadinessWarningList`(예약 전환의 준비도 경고 렌더 — `ENV_DRAFT_ONLY` 문구 1건만 추가, §4.9), `useDeployScheduleMeta`/`useDeployScheduleTimezone`(예약 전환 시각 입력에 그대로), `AttentionCountBadge` 관행(0건이면 렌더 안 함).

### 3.2 신규 컴포넌트

| 컴포넌트 | 용도 | 배치 |
|---|---|---|
| `EnvironmentTab` | EN1 본체(라우트 진입점) | `pages/chatbot-detail/environment/EnvironmentTab.tsx` |
| `EnvironmentOffPanel` | 모드 꺼짐 상태 화면(§4.1) | `environment/` |
| `EnvironmentStatusPanel` | 모드 켜짐 3단 카드(초안/스테이징/운영, §4.2) | `environment/` |
| `EnvironmentEnableDialog` | 켜기 미리보기·확인(§4.3) | `environment/` |
| `EnvironmentDisableDialog` | 끄기 미리보기·2단계 확인(§4.4) | `environment/` |
| `StagingPromoteDialog` | 스테이징 승격 확인(§4.5) | `environment/` |
| `ProdSwitchDialog` | 운영 전환·롤백 공용(즉시, §4.6) | `environment/` |
| `GateSettingsPanel` | 게이트 설정 인라인 폼(§4.7) | `environment/` |
| `EnvironmentHistoryTable` | 전환 이력(§4.8) | `environment/` |
| `EnvironmentBadge` | "운영"·"스테이징"·"운영 이력" 배지(색+아이콘+텍스트) — `VersionRow`·헤더·이력 표 공용 | `components/EnvironmentBadge.tsx` |
| `GateResultBadge` | 게이트 판정(PASS/WARN/BLOCK) 배지 | `components/` |
| `EnvironmentHeaderBadge` | 콘솔 공통 헤더 배지(§4.17) | `components/` |
| `EnvironmentModeIndicator` | `TabNav` "환경" 탭의 소형 점(§1.4) | `components/` |
| `switchPreviewText.tsx` | `SwitchWarningText`/`SwitchBlockerText`/`gateReasonText` 매핑 함수(§3.3) — No.25 `restorePreviewText.tsx`와 같은 패턴, 도메인 유니온이 달라 별도 파일 | `environment/lib/` |
| `EnvironmentScopeNotice` | "환경 분리 대상이 아닙니다" 배너(§4.15) | `components/` |
| `TargetSelectField` | 시뮬레이터·TC 공용 "대상"(초안/스테이징/운영/버전) 선택 컨트롤 | `components/` |
| `TargetBadge` | TC 실행 목록/상세/비교의 "대상: 스테이징(v44)" 표시 | `components/` |
| `useEnvironmentStatus` | `ChatbotDetailContext.environmentStatus` 접근 훅(관행상 `useChatbotDetailContext()`를 직접 쓰지만, 반복되는 파생값(`isEnabled`·`draftDiffers` 등)을 계산하는 순수 헬퍼) | `lib/environmentStatus.ts` |

### 3.3 고정 시각 언어

#### (1) `EnvironmentBadge` — 3종(FR-EN4-6, NFR-ENA1 — 색상 단독 금지)

| 값 | 배지 텍스트 | 아이콘 | 색상 계열 |
|---|---|---|---|
| `PROD` | "운영" | ● | 초록 |
| `STAGING` | "스테이징" | ◐ | 파랑 |
| `PROD_HISTORY` | "운영 이력" | ○ | 회색 |

한 버전이 여러 배지를 동시에 가질 수 있다(예: 스테이징이면서 동시에 직전 운영 이력). `deriveEnvironmentBadges()`(shared-types 순수 함수, 설계서 §4.1)가 정한 순서(`PROD → STAGING → PROD_HISTORY`) 그대로 나열한다. 모드 꺼진 챗봇의 버전 목록에는 이 배지 자체가 렌더되지 않는다(응답에 키가 없음 — 키 존재 여부로 분기, "빈 배열"과 "꺼짐"을 구분).

#### (2) `GateResultBadge` — 게이트 판정 3종

| `verdict` | 배지 텍스트 | 아이콘 | 색상 |
|---|---|---|---|
| `PASS` | "충족" | ✔ | 초록 |
| `WARN` | "경고" | ⚠ | 주황 |
| `BLOCK` | "미달(차단)" | ✕ | 빨강 |

`reason`이 있으면 배지 옆에 `gateReasonText(reason, run)` 문구를 병기한다(아래 표).

#### (3) 게이트 사유(`reason`) 문구 — `gateReasonText`

| `reason` | 문구 |
|---|---|
| `PASSED` | "{세트명} 최근 실행 {합격률}% (기준 {min}% 이상, {실행시각})" |
| `NO_RUN` | "최근 TC 실행 이력이 없습니다." |
| `BELOW_THRESHOLD` | "{세트명} 최근 실행 {합격률}% — 기준({min}%)에 못 미칩니다({실행시각})." |
| `EXPIRED` | "최근 실행이 유효 기간({validHours}시간)을 지났습니다({실행시각})." |
| `MODEL_CHANGED` | "실행 당시와 임베딩 모델이 달라져 결과를 신뢰할 수 없습니다." |
| `SET_MISSING` | "게이트에 지정된 TC 세트를 찾을 수 없습니다 — 게이트 설정을 확인해 주세요." |
| `NOT_CONFIGURED` | "게이트가 설정되어 있지 않습니다(경고 없이 통과)." |

#### (4) 전환 미리보기 경고(`ProdSwitchWarning`) 12종 — `SwitchWarningText`

| `code` | 문구 |
|---|---|
| `GATE_WARN` | `gateReasonText(gate.reason, gate.run)` 그대로 재사용(중복 계산 없음) |
| `LEGACY_TIEBREAK` | "이전 형식으로 저장된 버전이라 동점 규칙이 최신과 다를 수 있습니다." |
| `SEMANTIC_INDEX_PENDING` | "의미 매칭 준비 중인 문장이 {count}건 있습니다 — 준비될 때까지 규칙 매칭만 적용됩니다." |
| `CONTEXT_FLOWS_AFFECTED` | "진행 중인 대화 흐름 {count}개가 영향을 받을 수 있습니다." |
| `TOPIC_EXPOSURE_CHANGE` | "토픽 노출이 바뀝니다 — 새로 보임 {exposed}건, 숨겨짐 {hidden}건." |
| `TOPIC_MISSING` | "대상 버전이 참조하는 토픽 {count}개가 삭제되었습니다." |
| `SURVEY_MISSING` | "대상 버전이 참조하는 설문 {count}개를 찾을 수 없습니다." |
| `SURVEY_NOT_OPEN` | "대상 버전이 참조하는 설문 {count}개가 진행 중이 아닙니다." |
| `API_CONNECTION_MISSING` | "대상 버전이 참조하는 API 연결 {count}개를 찾을 수 없습니다." |
| `API_CONNECTION_DISABLED` | "대상 버전이 참조하는 API 연결 {count}개가 비활성 상태입니다." |
| `PROFILE_WILL_CHANGE` | "위젯 표시 정보({fields})가 바뀝니다." |
| `OLDER_THAN_DRAFT` | "대상 버전이 초안보다 과거 버전입니다." |

이 중 `TOPIC_MISSING`·`SURVEY_MISSING`·`SURVEY_NOT_OPEN`·`API_CONNECTION_MISSING`·`API_CONNECTION_DISABLED`는 No.25 `RestoreWarningList`의 같은 코드 문구(복원 경고 재사용 — 설계서 §9.4 "복원 경고 재사용")와 **동일 문구**를 쓴다(`restorePreviewText.tsx`의 기존 매핑 함수를 호출).

#### (5) 전환 차단(`blockers`) 6종 — `SwitchBlockerText`

| `code` | 문구 |
|---|---|
| `TARGET_NOT_ALLOWED` | "대상은 현재 스테이징 버전 또는 운영 이력 버전만 선택할 수 있습니다." |
| `GATE_BLOCKED` | "필수 시험 기준을 충족하지 못해 전환할 수 없습니다 — " + `gateReasonText` |
| `GATE_CONFIG_ERROR` | "게이트에 지정된 TC 세트를 찾을 수 없습니다. [게이트 설정 확인 →]" |
| `TARGET_UNREADABLE` | "대상 버전을 읽을 수 없습니다. 관리자에게 문의해 주세요." |
| `CHATBOT_ARCHIVED` | "보관된 챗봇은 전환할 수 없습니다." |
| `ENV_MODE_DISABLED` | "환경 분리가 꺼져 있습니다." |

`GATE_BLOCKED`/`GATE_CONFIG_ERROR`만 존재해도 확정 버튼은 비활성화되고, 게이트 설정 화면으로 가는 링크가 병기된다(§4.6).

#### (6) 신규 오류 코드 8종 — 화면별 사용자 문구

| 코드 | 발생 화면 | 문구 |
|---|---|---|
| `ENV_MODE_DISABLED` | EN1 승격/전환/롤백/끄기 버튼(선제 차단, 렌더 안 함), 시뮬레이터·TC의 `STAGING`/`PROD` 대상(400) | "환경 분리가 꺼져 있어 스테이징·운영 대상을 선택할 수 없습니다." |
| `ENV_MODE_ALREADY_ENABLED` | EN1-a 켜기 확정(경합) | "이미 다른 관리자가 환경 분리를 켰습니다." → 자동 새로고침 |
| `ENV_POINTER_STALE` | EN1-a/b/c/d 전부(경합) | "다른 관리자가 먼저 처리했습니다. 최신 상태로 다시 확인합니다." → 자동 재조회(No.25 `staleBanner`와 동일 패턴) |
| `ENV_TARGET_NOT_STAGING` | EN1-d 확정(방어적 — UI가 선제 차단하므로 정상 경로에서는 발생하지 않음) | "선택한 버전은 더 이상 전환 대상이 아닙니다." → 자동 재조회 |
| `ENV_GATE_NOT_PASSED` | EN1-d 확정(경합 — 미리보기 이후 게이트가 미달로 바뀜) | "필수 시험 기준을 충족하지 못해 전환할 수 없습니다." → 미리보기 재조회 |
| `ENV_SWITCH_BUSY` | EN1-a/d 확정(DB 경합·복원 잠금·실행 중 예약) | "잠시 후 다시 시도해 주세요." → 자동 재조회(재시도 가능, No.25 `RESTORE_BUSY`와 같은 취급) |
| `ENV_DRAFT_NOT_RESTORED` | EN1-b 확정("운영 유지" 2단계 사이 경합) | "초안 복원이 완료되지 않았습니다. 다시 시도해 주세요." → 1단계(복원)부터 재시도 |
| `VERSION_REFERENCED_BY_ENVIRONMENT` | 버전 삭제 확인창(No.25) | "이 버전은 환경(운영·스테이징·운영 이력)이 참조하고 있어 삭제할 수 없습니다." + `[환경 탭에서 보기 →]` |

`ENV_POINTER_STALE`/`ENV_SWITCH_BUSY`는 **모두 같은 UX**(다이얼로그 유지 + 자동 재확인)로 처리한다 — No.25 `RestoreDialog`가 `RESTORE_PREVIEW_STALE`/`RESTORE_BUSY`를 문구 분기 없이 같은 흐름으로 묶은 것과 동일한 원칙(오류 원인보다 "다음에 뭘 하면 되는가"를 우선 안내, UIUX §7).

---

## 4. 화면별 설계

## 4.1 EN1 — 환경 탭, 모드 꺼짐

### 목적
환경 분리가 꺼진(기본) 챗봇에서 기능을 설명하고 켜는 진입점을 제공한다.

### 상태별 UI

| 상태 | UI |
|---|---|
| 로딩 | `SkeletonCard` |
| 모드 꺼짐(기본) | §4.1.1 레이아웃 |
| `ARCHIVED` 챗봇 | `ArchivedBanner` + `[환경 분리 사용...]` 버튼 `aria-disabled`(보관 챗봇은 켜기 불가 — FR-EN1-5) |
| 조회 실패 | `ErrorState` + 재시도 |

### 4.1.1 레이아웃

```
┌ 환경 ──────────────────────────────────────────────────────────────┐
│ 이 챗봇은 환경 분리를 사용하지 않습니다.                              │
│ 지금처럼 편집한 내용이 저장 즉시 운영에 반영됩니다.                    │
│                                                                      │
│ 환경 분리를 사용하면 편집 공간(초안)과 실제 서비스(운영)가 분리되어,    │
│ 검증을 마친 버전만 운영으로 전환할 수 있습니다.                        │
│  · 초안 — 지금처럼 편집하는 공간(운영에 보이지 않음)                   │
│  · 스테이징 — 검증 중인 버전(시뮬레이터·응답 테스트로 확인)             │
│  · 운영 — 실제 사용자가 보는 버전                                     │
│                                                              [환경 분리 사용...] │
└──────────────────────────────────────────────────────────────────┘
```

`chatbot:deploy` 없는 사용자에게는 버튼이 렌더되지 않고 위 설명만 보인다(§6).

### 컴포넌트 분해

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `EnvironmentTab` | `chatbotId` → `GET .../environment`(`EnvironmentStatusSchema`, 판별 유니온 `enabled:false｜true`) |
| `EnvironmentOffPanel` | `canDeploy: boolean`, `onEnableClick: () => void` |

---

## 4.2 EN1 — 환경 탭, 모드 켜짐(현황 3단)

### 목적
초안·스테이징·운영 각각의 버전과 관계(해시 일치 여부)를 한눈에 보여주고, 승격·전환·롤백·게이트 설정·이력 조회의 허브 역할을 한다.

### 상태별 UI

| 상태 | UI |
|---|---|
| 로딩 | `SkeletonCard` × 3(카드 3장) |
| 정상 | §4.2.1 레이아웃 |
| `prod.readFailed = true`(EX-EN-1) | 운영 카드에 `SeverityBadge(ERROR)`: "운영 버전을 읽을 수 없습니다." + `[직전 운영 버전으로 되돌리기...]` 강조 버튼(게이트를 경고로 낮춘 롤백 경로로 안내) |
| `prod.legacyTiebreak`/`staging.legacyTiebreak` | 해당 카드에 `LEGACY_TIEBREAK` 경고(ⓘ, blocker 아님) |
| `prod.semanticPending > 0`/`staging.semanticPending > 0` | 해당 카드에 "의미 색인 준비 중 {n}건" |
| `activeSwitchSchedule` 존재 | 운영 카드 하단에 "예약된 전환: {시각} → v{n} ({PENDING｜HELD})" + `[예약 배포에서 보기 →]` |

### 4.2.1 레이아웃 (데스크톱, 3카드 가로 배치)

```
┌ 환경 ──────────────────────────────────────────── [환경 분리 끄기...] ┐
│ ┌ 초안 ──────────┐ ┌ 스테이징 ───────┐ ┌ 운영 ──────────────────┐ │
│ │ 운영과 다름(3건) │ │ v44             │ │ v43                    │ │
│ │                 │ │ 09-24 15:10 승격 │ │ 09-25 14:02 전환됨       │ │
│ │                 │ │ 편집자A         │ │ 관리자 김OO             │ │
│ │                 │ │ ⓘ 의미 색인      │ │                        │ │
│ │                 │ │   준비 중 2건    │ │                        │ │
│ │ [스테이징으로    │ │ [운영 전환       │ │ [직전 버전으로          │ │
│ │  승격]           │ │  미리보기...]    │ │  되돌리기...]           │ │
│ │                 │ │ [예약 전환...]   │ │                        │ │
│ └─────────────────┘ └─────────────────┘ └────────────────────────┘ │
├──────────────────────────────────────────────────────────────────┤
│ 예약된 전환: 10/1 00:00 → v45(대기)                [예약 배포에서 보기 →] │
├──────────────────────────────────────────────────────────────────┤
│ [▸ 게이트 설정]                                                     │
├──────────────────────────────────────────────────────────────────┤
│ 전환 이력                                    필터: 전체[운영 ▾]      │
│ 09-25 14:02  운영  v43 ← v44  즉시전환  관리자 김OO  "환불 정책 개정" │
│ 09-24 15:10  스테이징  v44 ← v43  승격  편집자A                      │
│ ...                                                    ◀ 1 .. 2 ▶  │
└──────────────────────────────────────────────────────────────────┘
```

- 초안 카드는 "운영과 같음"(해시 일치)이면 초록 텍스트로 "운영과 같음", 다르면 주황 텍스트+아이콘으로 "운영과 다름({changed}건)"[^1](No.25 `VersionListPage`의 `current.hasUnsavedChanges` 판정·문구 관행을 그대로 재사용 — `current()` API가 이미 계산하는 값이므로 추가 호출 없이 같은 `versionsApi.current()` 응답을 씀).
- 스테이징 카드가 초안과 해시가 같으면(승격할 변경이 없음) `[스테이징으로 승격]` 버튼은 `aria-disabled` + 툴팁 "초안과 스테이징이 이미 같습니다"(서버가 `NOOP`을 반환하지만, 화면이 먼저 판단해 무의미한 승격 시도를 줄인다 — No.28의 `PUBLISH` 선제 차단 관행과 동일).
- 운영 카드가 스테이징과 같으면(전환할 것이 없음) `[운영 전환 미리보기...]`는 `aria-disabled` + 툴팁 "운영과 스테이징이 이미 같습니다".
- 게이트 요약은 항상 보이는 소형 배지 한 줄(`GateResultBadge` 아님 — 설정 요약: "게이트: 경고만 표시" 또는 "게이트: 차단(정기 회귀 · 95% 이상)")로 카드들 아래에 상시 노출한다.

[^1]: [R1 L-3] 초안↔운영 차이 건수({changed}건)는 API 계약 부재로 미표시(후속) — `VersionCurrentStatus`(`current()` 응답)에는 초안↔운영 간 변경 건수를 세는 필드가 없고, `hasUnsavedChanges`류 boolean만 있다. 구현은 건수 없이 "운영과 다름" 텍스트만 표시한다(`EnvironmentStatusPanel`의 `sp.draftDiff`). 건수 표시가 필요해지면 `system-architect`가 API 계약에 필드를 먼저 추가해야 한다.

### 컴포넌트 분해 및 데이터 바인딩

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `EnvironmentStatusPanel` | `status: EnvironmentStatus`(enabled=true 분기), `current: VersionCurrentStatus`(기존 `versionsApi.current()` 재사용), `canDeploy`, `canPromote` |
| 초안 카드 | `status.draft.sameAsProd`/`sameAsStaging`, `current.hasUnsavedChanges`, `[스테이징으로 승격]` → `StagingPromoteDialog` 오픈 |
| 스테이징 카드 | `status.staging`(null이면 "없음" — 이론상 발생하지 않음, `enabled=true`면 항상 존재), `[운영 전환 미리보기...]` → `ProdSwitchDialog(kind='SWITCH', targetVersionId=staging.versionId)`, `[예약 전환...]` → `ScheduleDeployDialog(action='SWITCH_PROD_VERSION', versionId=staging.versionId)` |
| 운영 카드 | `status.prod`, `[직전 버전으로 되돌리기...]` → `ProdSwitchDialog(kind='ROLLBACK')`(대상 생략 — 서버가 `pickRollbackTarget` 계산) |
| 예약 배너 | `status.activeSwitchSchedule` → 링크 `/chatbots/:id/deploy-schedules/:scheduleId` |
| `GateSettingsPanel`(접기) | `status.gate` → §4.7 |
| `EnvironmentHistoryTable` | `GET .../environment/history` → §4.8 |
| `[환경 분리 끄기...]` | → `EnvironmentDisableDialog` 오픈(§4.4) |

---

## 4.3 EN1-a — 켜기 확인 대화상자 `EnvironmentEnableDialog`

### 목적
켜는 순간 운영 응답이 바뀌지 않는다는 점과, 활성 복원 예약이 보류된다는 점을 명확히 안내한 뒤 확정한다.

### 상태별 UI

| 상태 | UI |
|---|---|
| 오픈 직후 미리보기 로딩 | `role="status" aria-live="polite"` "확인하는 중…" |
| 미리보기 완료 | §4.3.1 레이아웃 |
| `blockers` 존재(`CHATBOT_ARCHIVED`/`RESTORE_IN_PROGRESS`/`SCHEDULE_RUNNING`/`ALREADY_ENABLED`) | 확인 버튼 렌더 안 됨 + 사유 문구(No.25 `RestoreBlockerList` 패턴) |
| 확정 중 | 버튼 스피너+`disabled` |
| `409 ENV_POINTER_STALE`/`ENV_SWITCH_BUSY`/`ENV_MODE_ALREADY_ENABLED` | 배너 + 자동 재확인(§3.3-6) |

### 4.3.1 레이아웃

```
┌ 환경 분리 사용 ───────────────────────────────────────────────── ✕ ┐
│ 현재 초안 상태를 새 버전(v43)으로 저장하고,                          │
│ 스테이징과 운영을 모두 이 버전으로 지정합니다.                        │
│                                                                     │
│ · 켠 직후 위젯 응답은 지금과 완전히 같습니다.                         │
│ · 이후 편집은 운영에 바로 보이지 않습니다 — 검증 후 전환해야 반영됩니다.│
│ · 예약된 버전 복원 1건이 보류(확인 필요) 상태가 됩니다.                │
│                                                                     │
│                                          [취소]  [환경 분리 사용]     │
└─────────────────────────────────────────────────────────────────┘
```

"보류되는 예약 1건" 문구는 `heldRestoreSchedules > 0`일 때만 나타난다. 0건이면 그 줄 자체가 없다(불필요한 안내로 소음을 만들지 않음).

### 컴포넌트 분해

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `EnvironmentEnableDialog` | `chatbotId`, `isOpen`, `onClose`, `onEnabled` → `POST .../enable/preview`(`EnableEnvironmentPreviewResponse`) → 확정 시 `POST .../enable`(`{ expectedDraftHash: preview.draftContentHash }`) |
| 확정 버튼 라벨 | 항상 고정 문구 "환경 분리 사용"(버전 번호는 아직 확정 전이라 명시하지 않음 — RESTORE/SWITCH처럼 "v{n}으로"를 쓰지 않는 유일한 예외, 이유를 §8에 주석) |

---

## 4.4 EN1-b — 끄기 확인 대화상자 `EnvironmentDisableDialog`

### 목적
초안과 운영이 다를 때 "운영 유지"(기본, 권장) 또는 "초안을 운영으로" 중 하나를 명시적으로 선택하게 하고, 전자를 고르면 **콘솔이 먼저 기존 복원 API를 호출**한 뒤 끄기를 확정한다(FR-0-154, 설계서 §5.4).

### 상태별 UI

| 상태 | UI |
|---|---|
| 미리보기 로딩 | "확인하는 중…" |
| `draftDiffersFromProd = false` | 선택지 없이 확인 문구만 + 확정 버튼(§4.4.1-A) |
| `draftDiffersFromProd = true` | 2択 라디오 + 차이 요약(§4.4.1-B) |
| "운영 유지" 선택 후 확정 클릭 | **1단계**: 복원 진행 표시("초안을 v43로 맞추는 중…") → **2단계**: 끄기 확정(사용자에게는 한 번의 클릭·한 번의 로딩으로 보인다 — 내부 2단계는 숨김) |
| 1단계(복원) 실패 | 기존 복원 오류 처리(`RestoreDialog`와 동일 오류 코드 — `VERSION_INTEGRITY_FAILED` 등) 그대로 노출, 끄기는 진행되지 않음 |
| 2단계에서 `409 ENV_DRAFT_NOT_RESTORED` | "초안 복원이 완료되지 않았습니다. 다시 시도해 주세요." + 재시도 버튼(1단계부터 재실행) |
| 확정 성공 | 다이얼로그 닫힘 + Toast "환경 분리를 종료했습니다." + EN1이 모드 꺼짐 화면으로 전환 |

### 4.4.1 레이아웃

**(A) 초안 = 운영(변경 없음)**
```
┌ 환경 분리 끄기 ──────────────────────────────────────────────── ✕ ┐
│ 초안과 운영이 같은 상태입니다. 끄면 앞으로 편집이 즉시 운영에         │
│ 반영됩니다.                                                        │
│                                          [취소]  [환경 분리 끄기]    │
└─────────────────────────────────────────────────────────────────┘
```

**(B) 초안 ≠ 운영**
```
┌ 환경 분리 끄기 ──────────────────────────────────────────────── ✕ ┐
│ 초안에 운영과 다른 변경이 있습니다(+ 의도 1  − FAQ 2). 끄기 전에      │
│ 어떻게 할지 선택해 주세요.                                          │
│                                                                     │
│ ◉ 운영(v43) 상태 유지 — 초안 변경은 백업 버전으로 보관됩니다.         │
│ ○ 초안을 운영으로 — 지금 초안 내용이 즉시 공개됩니다.                 │
│   ⚠ 동점 규칙이 복원 시점 기준으로 바뀔 수 있습니다.(potentialTieShift) │
│                                                                     │
│                                          [취소]  [환경 분리 끄기]    │
└─────────────────────────────────────────────────────────────────┘
```

`potentialTieShift`(§27 L-6, `KEEP_PROD`에만 해당) 경고는 "운영 유지"가 선택돼 있을 때만 보인다. 기본 선택은 **항상 "운영 유지"**(P-6 확정안 — 라디오 첫 항목, 사전 선택 자체는 "기본값 임의 선택 금지"(UIUX §6) 원칙의 예외로 취급한다 — 이 값은 성별·생년월일 같은 개인정보가 아니라 **안전한 기본 동작**(운영 응답 불변)이며 요구사항이 명시적으로 "기본 = 운영 유지"를 확정했다).

### 컴포넌트 분해

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `EnvironmentDisableDialog` | `chatbotId` → `POST .../disable/preview`(`DisableEnvironmentPreviewResponse`) |
| 라디오 그룹 | `mode: 'KEEP_PROD'｜'PROMOTE_DRAFT'`, 방향키 탐색(UIUX §6) |
| 확정 처리(내부) | `KEEP_PROD`: `versionsApi.restorePreview(chatbotId, prod.versionId)` → `versionsApi.restore(...)` → `POST .../disable({ mode:'KEEP_PROD', expectedProdVersionId, expectedDraftHash: 복원응답.contentHash })`. `PROMOTE_DRAFT`: 바로 `POST .../disable({ mode:'PROMOTE_DRAFT', expectedDraftHash: preview.draftContentHash })` |

---

## 4.5 EN1-c — 스테이징 승격 확인 `StagingPromoteDialog`

### 목적
초안을 스테이징으로 승격한다. 가벼운 동작이라 무거운 미리보기 없이 현재 변경 요약만 보여준다.

### 레이아웃

```
┌ 스테이징으로 승격 ────────────────────────────────────────────── ✕ ┐
│ 초안의 현재 상태를 스테이징(v45)으로 지정합니다. 운영은 바뀌지        │
│ 않습니다.                                                          │
│ + 의도 0  − 키워드 3  ~ 의도 1                                      │
│                                                                     │
│ 라벨(선택)  [__________]                                           │
│ 메모(선택)  [__________________________]  0/500자                  │
│                                                                     │
│                                        [취소]  [스테이징으로 승격]   │
└─────────────────────────────────────────────────────────────────┘
```

변경 요약(`+ 의도 0 − 키워드 3 ~ 의도 1`)은 `versionsApi.current()`가 이미 EN1 로드 시점에 가져온 `changesUndone`류 데이터를 그대로 쓴다(추가 조회 없음). 라벨/메모는 No.25 `CreateVersionModal`과 동일 필드(`VERSION_LIMITS.labelMaxLength`/`memoMaxLength`).

### 상태별 UI

| 상태 | UI |
|---|---|
| 승격할 변경 없음(스테이징=초안) | 위 §4.2.1에서 버튼 자체가 비활성이라 이 다이얼로그는 열리지 않는다 |
| 제출 중 | 버튼 `disabled`+스피너 |
| 성공(`CREATED`) | Toast "스테이징이 v45로 승격되었습니다." |
| 성공(`REUSED`) | Toast "기존 버전(v45)을 스테이징으로 지정했습니다." |
| `409 ENV_POINTER_STALE` | 배너 + 자동 재확인 |

### 컴포넌트 분해

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `StagingPromoteDialog` | `chatbotId`, `expectedStagingVersionId`, `label?`, `memo?` → `POST .../staging/promote` → `PromoteToStagingResponse{ outcome, staging, previousStagingVersionNo }` |

---

## 4.6 EN1-d — 운영 전환·롤백 `ProdSwitchDialog`

### 목적
스테이징(또는 이력의 특정 버전)을 운영으로 즉시 전환하거나, 직전 운영 버전으로 되돌린다. 게이트 판정과 경고를 확인한 뒤에만 확정할 수 있다.

### 상태별 UI

| 상태 | UI |
|---|---|
| 미리보기 로딩 | "확인하는 중…" |
| `outcome='NOOP'`(대상이 이미 현재 운영) | "이미 이 버전이 운영입니다." + 확인만(EX-EN-16) |
| `blockers` 존재 | §3.3-5 매핑, 확정 버튼 렌더 안 됨(`GATE_CONFIG_ERROR`는 `[게이트 설정으로 이동]` 링크 병기) |
| `blockers` 없음, `warnings` 있음 | 차이 요약 + 경고 목록 + `acknowledgeWarnings` 체크박스(필수) |
| `blockers`·`warnings` 둘 다 없음 | 차이 요약만, 체크박스 없이 바로 확정 가능 |
| 확정 중 | 버튼 스피너+`disabled` |
| `409 ENV_POINTER_STALE`/`ENV_SWITCH_BUSY` | 배너 + 자동 재확인 |
| `409 ENV_GATE_NOT_PASSED`(경합) | 배너 "필수 시험 기준을 충족하지 못해 전환할 수 없습니다." + 자동 재확인 |
| 성공 | 다이얼로그 닫힘 + Toast + EN1 자동 새로고침 |

### 4.6.1 레이아웃 — `kind='SWITCH'`

```
┌ 운영 전환 ────────────────────────────────────────────────────── ✕ ┐
│ 운영: v43  →  대상: v44(스테이징)                                   │
│ + 의도 0  − FAQ 1  ~ 노드 2                                         │
│                                                                     │
│ 게이트: ✔ 충족 — 정기 회귀 98.3%(기준 95% 이상, 10분 전)              │
│                                                                     │
│ ⚠ 경고                                                              │
│  · 의미 매칭 준비 중인 문장이 2건 있습니다.                           │
│  · 위젯 표시 정보(스킨)가 바뀝니다.                                   │
│                                                                     │
│ ☐ 위 내용을 확인했습니다.                                            │
│                                                                     │
│ 사유(선택)  [___________________________________]  0/200자          │
│                                                                     │
│                                        [취소]  [v44로 운영 전환]     │
└─────────────────────────────────────────────────────────────────┘
```

- `kind='ROLLBACK'`이면 제목 "운영 되돌리기", 대상 자동 표시("대상: v43(직전 운영)"), 게이트가 `BLOCK`이어도 `WARN`으로 낮춰서 보여준다(FR-EN4-4 — "차단"이 아니라 "경고"로만 표시, 긴급 복귀 우선). 확정 버튼 "v43으로 되돌리기".
- 확정 버튼은 항상 **대상 버전 번호를 명시**한다(NFR-ENA2 — "v44로 운영 전환"처럼 모호한 "확인" 금지, No.28 `FR-D7-5`와 동일 원칙).
- 게이트가 `BLOCK`(전환에만 해당)이면 확정 버튼 자체가 없고(blocker로 취급) `[게이트 설정 다시 보기]` 링크만 있다.
- 기본 포커스는 항상 **"취소"**(No.25/No.28과 동일 원칙, NFR-ENA2).

### 컴포넌트 분해

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `ProdSwitchDialog` | `chatbotId`, `kind: 'SWITCH'\|'ROLLBACK'`, `targetVersionId?`(SWITCH 필수, ROLLBACK 생략 가능) → `POST .../prod/preview`(`ProdSwitchPreviewResponse`) → 확정 `POST .../prod/switch` 또는 `.../prod/rollback`(`{ targetVersionId, expectedProdVersionId, acknowledgeWarnings?, reason? }`) |
| `GateResultBadge` | `gate.verdict`, `gate.reason`, `gate.run` |
| 경고 목록 | `warnings.map(SwitchWarningText)` |
| 차단 목록 | `blockers.map(SwitchBlockerText)` |

### 4.6.2 이력 표에서의 대상 제한 진입(EN1-f 확장)

`EnvironmentHistoryTable`의 `PROD` 이력 행 케밥 메뉴에 `[이 버전으로 롤백...]`을 둔다(현재 운영이 아닌 과거 `PROD` 이력 행에만) — `ProdSwitchDialog(kind='ROLLBACK', targetVersionId=그 행의 toVersionId)`를 연다. **스테이징 이력이 아닌 임의 버전(No.25 버전 이력 목록)에서는 진입점을 만들지 않는다** — 대상 제한(현재 스테이징 또는 운영 이력만, J-2)을 UI 구조로 강제한다(서버가 `ENV_TARGET_NOT_STAGING`으로 최종 통제하지만, 화면이 애초에 고를 수 없는 대상을 제시하지 않는다 — No.28 §4.3 "선제 차단" 원칙과 동일).

---

## 4.7 EN1-e — 게이트 설정 `GateSettingsPanel`

### 목적
운영 전환 전 필수 검증 기준(TC 세트·최소 합격률)을 설정한다.

### 레이아웃 (접힌 상태 → 펼침)

```
[▾ 게이트 설정]
┌────────────────────────────────────────────────────────────────┐
│ 모드                                                              │
│  ◉ 경고만 표시 — 기준 미달이어도 확인 후 전환할 수 있습니다.          │
│  ○ 차단 — 기준 미달이면 전환할 수 없습니다(롤백은 예외).             │
│                                                                    │
│ 필수 TC 세트(차단 모드에서 필수)  [ 정기 회귀 ▾ ]                    │
│ 최소 합격률(%)  [ 95 ]  (0~100)                                    │
│ 결과 유효 기간(시간)  [ 24 ]  (1~168)                               │
│                                                                    │
│                                              [취소]  [저장]         │
└────────────────────────────────────────────────────────────────┘
```

- **폼 컨트롤**: 모드는 라디오(단일 선택, UIUX §6). "필수 TC 세트"는 셀렉트(챗봇의 TC 세트 목록, `testSetsApi.list()` 재사용). "최소 합격률"·"유효 기간"은 **일반 숫자 입력 필드**(슬라이더 아님 — 드래그 정밀도보다 정확한 정수 입력이 우선이고, 두 값 모두 방향키(↑/↓) 조작 가능한 `<input type="number">`로 충분하다. `nlu-rag-answering-ui-spec.md`의 슬라이더는 "실시간 미리보기가 있는 연속값"(임계값)에 적용된 규칙이고, 이 값들은 이산적 설정값이라 슬라이더+숫자입력 이중 제공의 이득이 적다 — 레이블은 항상 필수(UIUX §5)).
- 차단 모드에서 TC 세트를 선택하지 않고 저장하면 제출 전 사전 검증(UIUX §7)으로 인라인 오류: "차단 모드에서는 필수 TC 세트를 선택해야 합니다."
- 저장 성공 시 `[▾ 게이트 설정]`이 다시 접히고 요약 배지(§4.2.1)가 즉시 갱신된다.

### 컴포넌트 분해

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `GateSettingsPanel` | `chatbotId`, `gate: EnvironmentGateSettings`, `canWrite`(=`chatbot:deploy`) → `PUT .../environment/gate` |

---

## 4.8 EN1-f — 전환 이력 `EnvironmentHistoryTable`

### 목적
스테이징·운영 포인터가 언제·누가·어떤 방식으로·어떤 사유로 바뀌었는지 append-only로 조회한다.

### 레이아웃(데스크톱 — 표)

| 시각 | 환경 | 방식 | 버전 | 주체 | 사유 |
|---|---|---|---|---|---|
| 09-25 14:02 | 운영 | 즉시 전환 | v43 ← v44 | 관리자 김OO | "환불 정책 개정" |
| 09-24 15:10 | 스테이징 | 승격 | v44 ← v43 | 편집자A | — |
| 09-24 09:00 | 운영 | 환경 분리 시작 | v42 | 관리자 김OO | — |

- `method` 라벨: `INIT`="환경 분리 시작", `PROMOTE`="승격", `IMMEDIATE`="즉시 전환", `SCHEDULED`="예약 전환 실행", `ROLLBACK`="되돌리기", `DISABLE`="환경 분리 종료"(+`disableMode`를 괄호로 "(운영 유지)"/"(초안을 운영으로)").
- `environment` 라벨: `STAGING`="스테이징", `PROD`="운영".
- 필터: 환경(전체/스테이징/운영), 페이지 20/100(No.25 관행과 동일). **정렬 없음**(`createdAt desc` 고정, 설계서 §9.6) — 헤더는 `<th scope="col">`일 뿐 `<button>`이 아니다(정렬 불가 표라 UIUX §3의 `aria-sort` 규칙 대상이 아님 — 규칙은 "정렬 가능한 표"에만 적용된다).
- 삭제·수정 액션 없음(append-only, FR-EN4-5).

### 컴포넌트 분해

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `EnvironmentHistoryTable` | `chatbotId`, `environmentFilter` → `GET .../environment/history`(`Paginated<EnvironmentSwitchLogItem>`) |

---

## 4.9 예약 전환 — No.28 화면 확장 (`SWITCH_PROD_VERSION`)

### 진입 경로

| 진입 | 고정되는 값 | 사용자가 입력하는 것 |
|---|---|---|
| EN1 스테이징 카드 `[예약 전환...]` | `action='SWITCH_PROD_VERSION'`, `targetVersionId=staging.versionId` | 시각·메모·경고 확인·G3 옵션 |
| EN1 이력 표 `PROD` 행 `[이 버전으로 예약 전환...]`(케밥) | `action='SWITCH_PROD_VERSION'`, `targetVersionId=`그 이력 버전 | 〃 |
| S1 "+ 예약 만들기" | 없음 | `ActionPickerStep`에서 4번째 카드 선택(모드 꺼진 챗봇이면 카드 자체가 `aria-disabled`) |

### `ActionPickerStep` 4번째 카드

```
[버전 복원]  [공개 시작]  [웹 채널 열기·닫기]  [운영 버전 전환]
                                              "검증된 버전을 운영으로
                                               전환합니다(환경 분리 켠
                                               챗봇만)"
```

- `disabled` 조건: 환경 분리 꺼짐(힌트: "환경 탭에서 환경 분리를 먼저 켜 주세요.") 또는 `chatbot:deploy` 없음(힌트: 기존 `NO_PERMISSION_HINT` 재사용).
- `ScheduleDeployDialog`가 카드 선택 뒤 대상(스테이징/운영 이력) 목록을 추가로 보여준다 — 진입점이 이미 `targetVersionId`를 고정하지 않은 유일한 경로(S1)이므로, 여기서만 `TargetVersionPicker`(스테이징 1개 + 운영 이력 목록) 서브스텝이 필요하다.

### 준비도 경고 확장 — `ReadinessWarningList`에 1건 추가

| `code` | 문구 |
|---|---|
| `ENV_DRAFT_ONLY`(`RESTORE_VERSION` 예약, 모드 켜진 챗봇에서 생성 시) | "환경 분리가 켜진 챗봇입니다 — 이 예약은 초안에만 적용되고, 운영은 바뀌지 않습니다." |

(이 경고는 **`RESTORE_VERSION`** 예약 생성 시 뜬다는 점에 주의 — `SWITCH_PROD_VERSION` 예약 자체의 경고가 아니라, "복원 예약이 이제 초안만 바꾼다"는 의미 변화를 알리는 것이다. FR-EN5-4.)

### 확정 버튼 라벨

| 동작 | 라벨 |
|---|---|
| `SWITCH_PROD_VERSION` | `"{M/D HH:mm}에 v{n}으로 운영 전환 예약"` |

### 실패·보류 사유 확장

| 분류 | 코드 | 라벨 |
|---|---|---|
| 실패 | `GATE_NOT_PASSED` | "필수 시험 기준 미달" |
| 실패 | `ENV_SWITCH_BUSY`(일시적) | "일시적 처리 지연"(기존 `DB_BUSY`와 같은 취급) |
| 실패 | `ENV_POINTER_STALE` | "예약 이후 운영 버전이 변경됨"(기존 `STATE_CHANGED`와 같은 문구 재사용) |
| 보류 | `ENV_MODE_CHANGED` | "환경 분리 설정이 바뀌어 보류됨"(모드 껐다 켬 — 활성 `RESTORE_VERSION` 예약이 이 사유로 `HELD` 된다, §4.9의 `ENV_DRAFT_ONLY`와 짝) |

### 결과 요약(`ScheduleResultSummaryPanel`) 확장

`SWITCH_PROD` 판별지: "운영: v43 → v44" + `outcome='NOOP'`이면 "이미 대상과 같은 상태였습니다(변경 없음)". G3 실행했다면 기존 패턴 그대로("사후 검증: … [결과 보기 →]").

### 전제 조건 사유(`SWITCH_BLOCKED`) — 생성 시 즉시 차단

미리보기 `creatable:false` + `preconditionFailures:[{code:'SWITCH_BLOCKED', message: <blocker 코드>}]`일 때 다이얼로그 상단 오류 배너에 `SwitchBlockerText(message)`를 그대로 표시한다(§3.3-5 매핑 재사용 — 새 매핑 만들지 않음).

### 변경 파일 체크리스트(설계서 §23 인용 — 컴파일 강제 지점)

`ActionPickerStep.tsx`의 `labels`/`disabledHints` 레코드, `ScheduleDeployDialog.tsx`의 `buildDto`/`confirmLabel`/`actionOptions` 분기, `lib/deploySchedulePermissions.ts`의 `switch` 문에 `case 'SWITCH_PROD_VERSION': return ['chatbot:deploy']`, `ReadinessWarningList.tsx`의 `switch` 문에 `ENV_DRAFT_ONLY` 케이스 — **전부 TypeScript 판별 유니온이 완전성을 강제**하므로(`DeployScheduleAction`에 값이 추가되면 각 `Record<DeployScheduleAction, …>`가 컴파일 실패), 네 파일 중 하나라도 빠뜨리면 빌드가 막힌다(설계서 §23이 이미 명시한 안전장치 — 재확인만 한다).

---

## 4.10 버전 목록 환경 배지 — `VersionRow` 확장

`VersionRow`의 버전 번호 배지(`<span className="version-row-no">v{item.versionNo}</span>`) 바로 옆에 `EnvironmentBadge[]`를 追加한다:

```
▸ [자동] v44 [운영] [스테이징]   09-24 15:10 · 편집자A
▸ [자동] v43 [운영 이력]         09-24 09:00 · 관리자 김OO
```

- `item.environmentBadges`가 **키 자체가 없으면**(모드 꺼짐) 아무것도 렌더하지 않는다(응답 바이트 불변 원칙과 정합 — "빈 배열"과 "필드 없음"을 구분).
- 트리거 필터(`filter` 셀렉트)에 그룹 "환경"(`ENVIRONMENT` = `ENV_INIT`+`PROMOTE`) 옵션 1개를 추가한다(`VersionListPage.tsx`의 `<option value="...">` 목록에 1행).
- 기존 액션 바(`[현재와 비교] [다른 버전과 비교] [내용 보기] [이 버전으로 복원] [예약 복원]`)는 **변경하지 않는다** — 환경 배지는 표시 전용이고, 이 버전을 운영/스테이징 전환 대상으로 고르는 액션은 §4.9에서 밝힌 대로 **EN1과 이력 표에서만** 제공한다(정보 중복·이중 진입점 방지, No.28 §4.5.1 관행과 동일 이유).

---

## 4.11 복원 확인 — `ENV_DRAFT_ONLY` 반영 (`RestoreDialog.tsx`)

모드 켜진 챗봇에서 복원 미리보기의 `warnings`에 `{ code: 'ENV_DRAFT_ONLY', prodVersionNo, stagingVersionNo }`가 있으면, 기존 `msg.laterChangesNotice(changesUndone)` 문구 **바로 위**에 강조 배너 1개를 추가한다(요청/응답 계약 자체는 불변 — `warnings` 배열의 항목 1개일 뿐이므로 `warningText()` 매핑 함수에 새 `case`만 추가하면 된다):

```
┌ v40으로 복원 ───────────────────────────────────────────────── ✕ ┐
│ ℹ 이 챗봇은 환경 분리가 켜져 있습니다.                                │
│   이 복원은 초안에만 적용됩니다. 운영(v43)·스테이징(v44)은            │
│   바뀌지 않습니다.                                                  │
│                                                                     │
│ 이후 변경 내용은 사라집니다: + 의도 2 − FAQ 1                        │
│ ...(이하 기존 레이아웃과 동일)                                       │
└─────────────────────────────────────────────────────────────────┘
```

`warningText()`(`restorePreviewText.tsx`)에 `case 'ENV_DRAFT_ONLY'` 1개를 추가하고, 렌더 쪽에서는 `ENV_DRAFT_ONLY`만 다른 경고들과 분리해 **강조 배너**(`SeverityBadge` 대신 `modal-banner modal-banner--info`, 아이콘 ⓘ)로 먼저 보여준다 — 나머지 경고(`ACTIVE_CHATBOT` 등)는 지금처럼 목록에 남는다. **`RestoreDialog`의 확인 절차(체크박스·확정 버튼 비활성 조건)는 바뀌지 않는다** — 이 배너는 순수 안내이며 새 확인 체크박스를 요구하지 않는다(설계서 §13.1 "계약 불변").

---

## 4.12 버전 삭제 보호 — `VERSION_REFERENCED_BY_ENVIRONMENT` (`VersionRow.tsx`)

No.28이 이미 만든 `VERSION_REFERENCED_BY_SCHEDULE` 분기(`handleDeleteConfirm` catch 블록)와 **나란히** 같은 패턴으로 1개 분기를 추가한다:

```diff
  } else if (e instanceof ApiError && e.code === 'VERSION_REFERENCED_BY_SCHEDULE') {
    setDeleteError(msg.deleteReferencedByScheduleError);
    setDeleteReferencedBySchedule(true);
+ } else if (e instanceof ApiError && e.code === 'VERSION_REFERENCED_BY_ENVIRONMENT') {
+   setDeleteError(msg.deleteReferencedByEnvironmentError);
+   setDeleteReferencedByEnvironment(true);
  } else {
```

확인창 하단 링크도 같은 패턴: `[환경 탭에서 보기 →]`(`/chatbots/:id/environment`). 보존 정리(자동)로 지워지지 않는 것은 화면에 별도 안내가 필요 없다(사용자가 트리거하는 동작이 아님 — 백그라운드 보호는 조용히 동작).

---

## 4.13 시뮬레이터 대상 선택

### 배치

`SimulatorPanel`(탭 모드·드로어 모드 공용) 헤더, 대화 영역 제목 바로 위 또는 그 자리에 `TargetSelectField`를 둔다(NFR-ENA4 — "현재 대상이 대화 영역 제목에 텍스트로 표시"):

```
┌ 응답 테스트 ─────────────────────────────────────────────────────┐
│ 대상  [ 초안 ▾ ]              ← 대화 상대: 초안                     │
│  ┌ 초안                                                          │
│  │ 스테이징(v44)                                                  │
│  │ 운영(v43)                                                     │
│  └ 버전 선택...                                                   │
├────────────────────────────────────────────────────────────────┤
│ (대화 영역)                                                       │
└────────────────────────────────────────────────────────────────┘
```

- 옵션은 항상 "초안"(기본값)부터 시작한다. 환경 분리가 꺼진 챗봇에서는 **선택 컨트롤 자체가 렌더되지 않는다**(대상 개념이 없음 — 항상 초안, 응답 바이트 불변 원칙과 정합).
- "버전 선택..."을 고르면 소형 팝오버로 버전 번호 검색(No.25 버전 목록과 같은 데이터, 간단 텍스트 필터).
- **오버레이(No.20 "+가상 변경")가 켜져 있으면 대상 컨트롤이 `aria-disabled` + 툴팁 "오버레이는 초안 대상에서만 사용할 수 있습니다"** 로 바뀐다(FR-EN6-1, AC-EN6-2) — 반대로 대상이 초안이 아닌 상태에서 오버레이 토글을 켜려 하면 그 토글이 비활성화된다(양방향 상호 배제, 어느 쪽을 먼저 조작해도 동일한 결과).
- 대상이 초안이 아니면 대화 시작 전 **비활성 토픽 포함 토글**(No.22)은 그대로 작동(모든 대상에 적용, FR-EN6-1 "비활성 토픽 포함 토글은 모든 대상에 적용").
- 응답 메시지 영역에 `target`(비초안일 때만) 정보를 트레이스 패널에 추가 표시: "대상: 운영(v43)" + `legacyTiebreak`이면 ⓘ "이전 형식 — 동점 규칙이 다를 수 있음" + `semanticMissing > 0`이면 "의미 색인 준비 중 {n}건".
- 로그 적재는 없다(기존과 동일, ADR-0030 불변) — 시뮬레이터 대화는 어떤 대상이든 `ConversationLog`를 만들지 않는다.

### 컴포넌트 분해

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `TargetSelectField` | `value: BundleTarget`, `onChange`, `environmentEnabled: boolean`(꺼지면 렌더 안 함), `stagingVersionNo?`, `prodVersionNo?`, `disabled?`(오버레이 켜짐), `disabledReason?` |
| `SimulatorPanel` | `simulate()` 요청에 `target`(초안이면 생략 — 요청 바이트 불변) |

---

## 4.14 TC 실행 대상 선택 · 표시 · 비교 경고

### 실행 시작(`RunTriggerButton`) — 고급 옵션에 추가

기존 "고급 옵션"(현재는 RAG 사용 체크박스만) 접이식 섹션에 `TargetSelectField`를 함께 넣는다:

```
[▸ 고급 옵션]
┌──────────────────────────────────────────────────────────────┐
│ ☐ RAG 사용                                                     │
│ 대상  [ 초안 ▾ ]                                                │
└──────────────────────────────────────────────────────────────┘
```

- 오버레이 모드(`overlaySource≠'NONE'`)에서는 대상이 항상 초안으로 고정되고 컨트롤이 `aria-disabled`(시뮬레이터와 동일 규칙, AC-EN6-2).
- 환경 분리 꺼진 챗봇에서는 컨트롤 자체가 없다.

### 실행 목록·상세 — `TargetBadge` 추가

`EnvFingerprintBadgeGroup` 옆(또는 같은 줄)에 대상이 초안이 아닐 때만 `TargetBadge`를 추가:

```
2027-01-15 09:00  정기 회귀  SINGLE  대상: 스테이징(v44)  118/120(98.3%)
```

상세 화면(`TestRunDetailPage`)에는 지문(`envFingerprint.target`) 정보를 기존 "환경 지문" 섹션에 한 줄 추가: "대상: 운영(v43) · 의미 색인 준비 중 0건".

### 비교(`TestRunComparePage`) — 대상 다름 경고

두 실행의 `target`(또는 `undefined`=초안)이 다르면 기존 `EnvFingerprintDiffBanner` 컴포넌트에 표식 1개를 추가한다: "⚠ 두 실행의 대상이 다릅니다(A: 초안, B: 스테이징 v44) — 결과 차이가 대상 차이 때문일 수 있습니다." (blocker 아님, 비교 자체는 계속 진행 — 정보 제공용 경고).

### 실행 실패 표시

`FAILED(failureReason: 'TARGET_VERSION_UNREADABLE')` → 기존 실패 사유 매핑 표(No.19 `TestRunDetailPage`가 이미 가진 실패 사유 렌더 로직)에 1행 추가: "대상 버전을 읽을 수 없습니다."

### 컴포넌트 분해

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `RunTriggerButton`(확장) | `target?: BundleTarget` state, `environmentEnabled` |
| `TargetBadge` | `target?: ResolvedBundleTarget` — 없으면(초안) 렌더 안 함 |

---

## 4.15 환경 밖 자산 화면 안내 (`EnvironmentScopeNotice`)

### 적용 대상 (P-9, FR-EN2-7 — 스냅샷 밖 운영 자산을 다루는 화면만)

| # | 화면 | 실제 코드 경로 | 다루는 자산 |
|---|---|---|---|
| 1 | 설문 목록·편집 | `pages/dialogue/SurveysListPage.tsx`, `SurveyFormPage.tsx` | 설문 정의 |
| 2 | 상담 연계 설정 | `pages/chatbot-detail/answer-settings/HandoffSettingsSection.tsx`(AI 답변 설정 탭 3번째 섹션) | 상담 설정 |
| 3 | 자주 쓰는 문장 | `pages/dialogue/CannedResponsesPage.tsx` | 상담원 문구 |
| 4 | 채널 관리 | `pages/chatbot-detail/ChannelsTab.tsx` | 채널 설정(enabled·허용 도메인 등) |
| 5 | 토픽 관리 | `pages/dialogue/TopicsPage.tsx` | 토픽 정의·활성 상태 |

**포함하지 않은 화면과 사유**: API 연결(`pages/settings/ApiConnectionsPage.tsx`)·금지어(`pages/settings/BannedWordsPage.tsx`)는 **전역**(특정 챗봇에 종속되지 않음) 설정 화면이라, 이 화면에 진입할 때 "어느 챗봇 기준으로 환경 분리 여부를 판단할지"가 정의되지 않는다 — 배너를 달 자연스러운 문맥이 없다. 두 화면의 "즉시 반영" 성격(EX-EN-3·EX-EN-4·EX-EN-22)은 이미 전역 설정이므로 원래도 챗봇 단위 "환경" 개념과 무관하다.

### 배너 문구·배치

```
ⓘ 이 화면은 환경 분리 대상이 아닙니다 — 저장 즉시 운영에 적용됩니다.
```

- `ArchivedBanner`/`ScheduleConflictBanner`(No.28)와 같은 배치 관행 — 페이지 최상단, 본문보다 먼저 Tab 순서에 들어온다.
- **환경 분리가 켜진 챗봇에서만** 렌더된다(꺼진 챗봇은 원래도 전부 즉시 반영이라 이 배너가 알릴 "차이"가 없다 — 배너를 보이면 오히려 "이 챗봇에 환경 개념이 있다"는 오해를 만든다).
- 토픽 관리(#5)는 토픽 **활성 토글**에만 한정해 배너 문구를 다르게 한다(정의 자체는 즉시 반영이지만, 관리자가 가장 자주 만지는 것은 활성/비활성이므로): "토픽 활성 상태 변경은 저장 즉시 운영에 적용됩니다. 토픽 이름·설명 등 다른 항목도 마찬가지입니다."
- 데이터 소스: 각 화면이 `useChatbotDetailContext()`의 `environmentStatus`(§4.2 컨텍스트 확장)를 그대로 읽는다 — **별도 API 호출을 만들지 않는다**. `DialogueShell.tsx`가 이미 중첩 `Outlet`에 `ctx`(컨텍스트 객체 전체)를 그대로 전달하므로(실제 코드 확인 — 41행 주석 "하위 라우트도 useChatbotDetailContext()로 chatbot/reload/setUnsavedGuard를 읽으므로 이 중첩 Outlet에도 동일 컨텍스트를 이어서 전달해야 한다"), `environmentStatus`를 `ChatbotDetailContext`에 추가하기만 하면 설문/토픽/자주 쓰는 문장 페이지가 자동으로 받는다.

### 컴포넌트 분해

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `EnvironmentScopeNotice` | `visible: boolean`(=`environmentStatus?.enabled === true`), `variant?: 'default'\|'topic'` |

---

## 4.16 학습현황 "운영 미반영" · 평가 "초안에 없음"

### 목록(`UnansweredTable.tsx`) — `RecurredBadge` 옆에 `ProdReflectionBadge` 추가

```
"주차 되나요?"  ⚠ 반영 후 재발생 2회   🕓 운영 미반영
```

- 새 컴포넌트 `ProdReflectionBadge`를 `RecurredBadge` 바로 옆(같은 셀, `questionText` 아래)에 둔다. `item.prodReflection`이 없으면(모드 꺼짐 또는 `RESOLVED`가 아님) 렌더 안 함.
- `prodReflection.status === 'PENDING_SWITCH'`일 때만 "🕓 운영 미반영" 표시. `REFLECTED`면 배지 자체가 사라진다(AC-EN7-3 "전환 후 배지 해제").
- **`RecurredBadge`의 기존 렌더 조건(`recurredCount > 0`)을 `shouldShowRecurredAfterApply()`(shared-types 순수 함수, `environment.ts`에서 export)로 교체**한다 — FE/BE 공용 함수를 그대로 import해 재구현하지 않는다(설계서 §15.1 "표시 단계 판정" 원칙):
  ```diff
  - if (recurredCount <= 0) return null;
  + if (!shouldShowRecurredAfterApply({ recurredCount, lastOccurredAt, reflection: item.prodReflection })) return null;
  ```
  모드 꺼진 챗봇(= `item.prodReflection` 필드가 아예 없음)은 함수 내부에서 기존 규칙(`recurredCount > 0`)으로 폴백하므로 **동작이 완전히 같다**(AC-EN1-1 무회귀 확인 대상).

### 평가·큐 상세 — `FeedbackTargetPanels.tsx`

`feedbackTargetLabel()`가 `target.deleted`만 보던 것을, 모드 켜진 챗봇 + 상세 조회로 얻은 `deletedInDraft`/`nameFromVersion`이 있으면 문구를 구체화한다:

| 상황 | 목록(변경 없음) | 상세(구체화) |
|---|---|---|
| 진짜 삭제(운영에도 없음) 또는 모드 꺼짐 | "FAQ · 삭제됨" | "FAQ · 삭제됨" |
| 초안에서만 삭제(운영엔 있음), 모드 켜짐 | "FAQ · 삭제됨"(목록은 버전을 읽지 않아 구분 못 함 — §27 L-9 알려진 한계, 상세에서 정정) | "FAQ · 초안에 없음(운영 버전에는 '환불 안내'로 있음)" |

```diff
  export function feedbackTargetLabel(target: FeedbackTargetRef): string {
-   if (target.deleted || !target.name) return `${targetKindLabel(target.kind)} · ${MESSAGES.learning.targetDeletedLabel}`;
+   if (target.deletedInDraft && target.nameFromVersion) {
+     return MESSAGES.learning.targetDeletedInDraftLabel(targetKindLabel(target.kind), target.nameFromVersion);
+   }
+   if (target.deleted || !target.name) return `${targetKindLabel(target.kind)} · ${MESSAGES.learning.targetDeletedLabel}`;
    return MESSAGES.learning.lastFeedbackTargetPrefix(targetKindLabel(target.kind), target.name);
  }
```

`FeedbackTargetEditLink`(편집 링크)는 `deletedInDraft`일 때도 렌더하지 않는다(초안에 없으니 편집 화면으로 보내도 대상이 없다) — 기존 `if (target.deleted || !target.id) return null;` 조건에 `target.deletedInDraft`를 추가한다.

### 컴포넌트 분해

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `ProdReflectionBadge` | `reflection?: { status: 'PENDING_SWITCH' } \| { status: 'REFLECTED'; reflectedAt: Date }` |

---

## 4.17 콘솔 공통 헤더 환경 배지 (`ChatbotDetailHeader.tsx`)

`StatusBadge` 바로 옆(`groupName`/`slug` 앞)에 `EnvironmentHeaderBadge`를 추가한다. 모드 꺼진 챗봇은 렌더하지 않는다(FR-EN4-7).

```
◀ 목록으로   [아바타] 고객센터 봇  [사용중]  운영 v43 · 스테이징 v44 · 초안 다름   그룹A  chatbot-slug
```

- 텍스트는 항상 "운영 v{n} · 스테이징 v{m} · 초안 {같음｜다름}" 형태(NFR-ENA1 — 색상 없이도 의미 전달). 클릭 시 `/chatbots/:id/environment`로 이동(`detail-header-audit-link`와 같은 소형 링크 스타일).
- 데이터 소스는 `ChatbotDetailContext.environmentStatus`(§0-5 — `ChatbotDetailLayout`이 `learningSummary`와 동일한 관행으로 챗봇 상세 마운트당 1회 조회하고, 전환·승격·켜기/끄기 성공 뒤 `refreshEnvironmentStatus()`를 호출해 갱신한다). 별도 폴링은 하지 않는다(§9).

### 컴포넌트 분해

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `EnvironmentHeaderBadge` | `status: EnvironmentStatus`(enabled=true만 렌더) |
| `ChatbotDetailContext`(확장) | `environmentStatus: EnvironmentStatus \| null`, `refreshEnvironmentStatus: () => void` |

---

## 5. 사용자 인터랙션 흐름 종합

### 5.1 환경 분리 켜기 (S-1)

```
EN1(모드 꺼짐) → [환경 분리 사용...] → EnvironmentEnableDialog
  → 미리보기: "v43으로 저장 · 운영 응답 불변 · 예약 1건 보류"
  → [환경 분리 사용] → 성공 → Toast "환경 분리를 사용합니다." → EN1이 3단 현황으로 전환
  → 헤더 배지·TabNav 표시 즉시 갱신(refreshEnvironmentStatus)
```

### 5.2 운영에 보이지 않는 편집 → 승격 → 검증 → 전환 (S-2/S-3, ★ 핵심 경로)

```
FaqsPage에서 "환불 안내" 답변 수정 → 저장(즉시 반영 아님, 기존 저장 흐름 그대로)
→ EN1 진입 → 초안 카드 "운영과 다름(1건)"
→ [스테이징으로 승격] → StagingPromoteDialog → v44 생성
→ SimulatorTab → 대상 [스테이징(v44)] 선택 → 대화로 새 답변 확인
→ ValidationTab → RunTriggerButton 고급 옵션 대상 [스테이징] → TC 실행 → 118/120
→ EN1 스테이징 카드 [운영 전환 미리보기...] → ProdSwitchDialog
  → 차이 요약 "− FAQ 1건 수정" · 게이트 ✔ 충족 · 경고 없음
  → [v44로 운영 전환] → 성공 → Toast + 이력 1행 추가 + 헤더 배지 "운영 v44"로 갱신
→ 위젯에서 새 답변 확인(다음 요청부터)
```

### 5.3 예약 전환 (S-5)

```
EN1 스테이징 카드 [예약 전환...] → ScheduleDeployDialog(action='SWITCH_PROD_VERSION', target=v44)
  → 10/1 00:00 입력 → 준비도 안내 확인 → [10/1 00:00에 v44로 운영 전환 예약]
  → Toast + "예약 배포" 탭에 PENDING 행 추가 + EN1 하단 "예약된 전환: 10/1 00:00 → v44" 표시
(그 사이 다른 관리자가 수동으로 v45 전환)
10/1 00:00 도달 → 실행 → currentProd(v45) ≠ expectedProdVersionId(v43 기준 아님, v44 전환 시점 기준 v43) → FAILED(STATE_CHANGED)
→ 담당자가 예약 배포 상세에서 사유 확인 → [지금 다시 예약](최신 상태로 재확인) 또는 EN1에서 즉시 전환
```

### 5.4 롤백 (S-6)

```
전환 후 미응답 증가 → EN1 운영 카드 [직전 버전으로 되돌리기...] → ProdSwitchDialog(kind='ROLLBACK')
  → 대상 자동 계산(v43) · 게이트 BLOCK이어도 경고로만 표시
  → [v43으로 되돌리기] → 성공 → 운영 = v43 즉시 적용, 초안·스테이징(v44)은 그대로
→ 편집자가 v44를 이어서 고침(스테이징 그대로 유지되므로 재작업 불필요)
```

### 5.5 차단 게이트 (S-7)

```
GateSettingsPanel → 모드 [차단] · TC 세트 [정기 회귀] · 최소 합격률 [95] → [저장]
→ 스테이징 v46(최근 실행 91%)에서 [운영 전환 미리보기...] 클릭
→ ProdSwitchDialog: 게이트 ✕ 미달(차단) — "정기 회귀 91% < 기준 95%"
→ 확정 버튼 없음, "[게이트 설정 다시 보기]"만 표시
```

### 5.6 학습현황과 환경 (S-8)

```
학습현황에서 "주차 되나요?"를 주차_안내 의도에 반영 → 항목에 "🕓 운영 미반영" 배지
그 사이 운영에서 같은 질문 재유입 → 발생 건수는 증가하지만 "반영 후 재발생" 배지는 뜨지 않음
EN1에서 운영 전환 → 학습현황 재조회 시 "운영 미반영" 배지 사라짐
그 이후 재유입 → 이번에는 "⚠ 반영 후 재발생" 배지가 뜬다
```

### 5.7 버전 복원의 의미 변화 (S-9)

```
환경 모드 챗봇의 버전 탭에서 v40 [이 버전으로 복원] → RestoreDialog
→ ℹ "이 복원은 초안에만 적용됩니다. 운영(v44)·스테이징(v44)은 바뀌지 않습니다."
→ 확정 → 초안만 v40 상태로 되돌아감, 위젯 응답은 변화 없음
```

### 5.8 끄기 (S-10)

```
EN1 [환경 분리 끄기...] → EnvironmentDisableDialog
→ 미리보기: 초안 ≠ 운영(v44), 차이 "+ 노드 1"
→ 기본 선택 "운영(v44) 상태 유지" 그대로 → [환경 분리 끄기]
→ (내부) 1단계: 초안을 v44로 복원(BEFORE_RESTORE 백업 생성) → 2단계: 포인터 제거
→ Toast "환경 분리를 종료했습니다." → EN1이 꺼짐 화면으로 → 이후 편집은 즉시 반영
```

### 5.9 VIEWER가 환경을 본다

```
EN1 조회 가능(현황·이력 전부) — [환경 분리 사용/끄기], [스테이징으로 승격], [운영 전환...], [예약 전환...],
[직전 버전으로 되돌리기...], [게이트 설정] 저장 버튼 전부 렌더되지 않음
헤더 환경 배지·TabNav 표시는 보임(조회 권한만 요구)
```

### 5.10 오류 처리 요약표

| 오류 | 발생 화면 | 표시 |
|---|---|---|
| `409 ENV_POINTER_STALE` | EN1-a/b/c/d 전부 | 배너 + 자동 재확인 |
| `409 ENV_SWITCH_BUSY` | EN1-a/d, 예약 실행 | 배너 + 자동 재확인(재시도 가능) |
| `409 ENV_MODE_ALREADY_ENABLED` | EN1-a | 배너 + 자동 재확인 |
| `409 ENV_TARGET_NOT_STAGING` | EN1-d(방어적) | 배너 "선택한 버전은 더 이상 전환 대상이 아닙니다." + 재확인 |
| `409 ENV_GATE_NOT_PASSED` | EN1-d 확정(경합) | 배너 + 미리보기 재조회 |
| `409 ENV_DRAFT_NOT_RESTORED` | EN1-b 2단계 | "초안 복원이 완료되지 않았습니다." + 1단계부터 재시도 버튼 |
| `409 VERSION_REFERENCED_BY_ENVIRONMENT` | 버전 삭제 확인창(No.25) | 인라인 오류 + `[환경 탭에서 보기 →]` |
| `409 ENV_MODE_DISABLED` | 시뮬레이터·TC의 `STAGING`/`PROD` 대상 선택 | 대상 컨트롤 자체가 안 보이므로 정상 경로에서는 발생하지 않음(방어적 Toast만) |
| `400 VALIDATION_FAILED(acknowledgeWarnings)` | EN1-d 확정 | 체크박스 하단 인라인 오류 |
| `403 FORBIDDEN` | 전 화면 | 버튼 자체가 렌더되지 않으므로 정상 경로에서는 발생하지 않음(방어적 Toast만) |
| `404`(교차 챗봇/삭제된 버전) | EN1-d 대상, 딥링크 | "대상 버전을 찾을 수 없습니다." + 목록 복귀 |

---

## 6. 권한별 화면 요소

| 요소 | VIEWER(`chatbot:read`+`dialogue:read`만) | EDITOR | ADMIN(`chatbot:deploy` 보유) | AGENT |
|---|---|---|---|---|
| EN1 현황·이력 조회 | 표시 | 표시 | 표시 | **렌더 안 함**(`dialogue:read` 없으면 EN1 진입 시 403 → 접근 불가 안내) |
| `[스테이징으로 승격]` | 렌더 안 함 | 렌더(`dialogue:write`+`chatbot:write`) | 렌더 | — |
| `[환경 분리 사용/끄기]`·`[운영 전환...]`·`[직전 버전으로 되돌리기...]`·게이트 저장 | 렌더 안 함 | **렌더 안 함**(P-4 (2) 확정 — 편집자도 불가) | 렌더 | — |
| 예약 생성/수정/취소/재개(`SWITCH_PROD_VERSION`) | 렌더 안 함 | 렌더 안 함 | 렌더 | — |
| 시뮬레이터 대상 선택 | 렌더(`simulation:read`) | 렌더 | 렌더 | — |
| TC 실행 대상 선택 | 렌더 안 함(`simulation:write` 없음) | 렌더(`simulation:write`) | 렌더 | — |
| 버전 목록 환경 배지·헤더 배지 | 표시 | 표시 | 표시 | — |
| 상담 응답힌트(운영 버전 기준) | — | — | — | 변경 없음(그대로 노출, §4.10 언급대로 힌트 소스만 바뀜) |

API 직접 호출 시 서버가 최종 통제(`403`) — 화면은 방어의 첫 겹일 뿐이다(No.25/No.28과 동일 원칙).

---

## 7. 상태별 화면(로딩/빈/오류) 총정리

| 화면 | 로딩 | 빈 상태 | 오류(조회 실패) |
|---|---|---|---|
| EN1(꺼짐) | `SkeletonCard` | (해당 없음 — 항상 설명+버튼) | `ErrorState` + 재시도 |
| EN1(켜짐) | `SkeletonCard` × 3 | (해당 없음) | `ErrorState` + 재시도 |
| EN1-a/b/c/d(다이얼로그) | 미리보기 `role="status"` | (해당 없음) | `loadFailed` + 재시도 버튼(No.25 관행) |
| EN1-f(이력 표) | `SkeletonRow` × 5 | "전환 이력이 없습니다." | `ErrorState` |
| `TargetSelectField` 버전 검색 | 인라인 스피너 | "검색 결과가 없습니다." | 조용히 실패(보조 기능 — 기본 목록은 항상 표시) |

---

## 8. `messages.ts` 키 설계

`MESSAGES.environment.*`(신규) — `MESSAGES.deploySchedules.*`(No.28)와 동일한 구조 관행(중첩 네임스페이스, 함수형 메시지로 동적 값 삽입). 문구 표는 각 절에 이미 명시했으므로 키 트리만 제시한다:

```
MESSAGES.environment = {
  tabLabel,                                  // 'environment' — TabNav "환경"
  off: { title, description, envListItems: { draft, staging, prod }, enableButton },
  enableDialog: { title, previewLoading, bodyLine1, bodyLine2, bodyLine3,
                  heldScheduleNotice: (n) => ..., confirmButton, cancelButton, confirming },
  disableDialog: { title, previewLoading, sameStateBody, diffBodyPrefix,
                   modeKeepProd, modePromoteDraft, potentialTieShiftWarning,
                   confirmButton, draftNotRestoredError, retryFromStep1 },
  promoteDialog: { title, body, labelField, memoField, confirmButton, reusedToast, createdToast },
  switchDialog: {
    titleSwitch, titleRollback, currentToTarget: (from, to) => ...,
    outcomeNoop, confirmButtonSwitch: (n) => ..., confirmButtonRollback: (n) => ...,
    acknowledgeLabel, reasonLabel, reasonCount,
    blockers: { TARGET_NOT_ALLOWED, GATE_BLOCKED, GATE_CONFIG_ERROR, TARGET_UNREADABLE, CHATBOT_ARCHIVED, ENV_MODE_DISABLED },
    warnings: { GATE_WARN, LEGACY_TIEBREAK, SEMANTIC_INDEX_PENDING, CONTEXT_FLOWS_AFFECTED, TOPIC_EXPOSURE_CHANGE,
                TOPIC_MISSING, SURVEY_MISSING, SURVEY_NOT_OPEN, API_CONNECTION_MISSING, API_CONNECTION_DISABLED,
                PROFILE_WILL_CHANGE, OLDER_THAN_DRAFT },
    gateGoToSettingsLink, viewGateSettingsLink,
  },
  gate: { sectionTitle, modeLabel, modeWarn, modeBlock, testSetLabel, minPassRateLabel, validHoursLabel,
          testSetRequiredError, saveButton, summaryWarnText, summaryBlockText: (setName, min) => ... },
  gateReason: { PASSED, NO_RUN, BELOW_THRESHOLD, EXPIRED, MODEL_CHANGED, SET_MISSING, NOT_CONFIGURED },
  gateVerdict: { PASS, WARN, BLOCK },
  history: { sectionTitle, envFilterLabel, envFilterAll, emptyTitle,
             methodLabel: { INIT, PROMOTE, IMMEDIATE, SCHEDULED, ROLLBACK, DISABLE },
             environmentLabel: { STAGING, PROD }, disableModeLabel: { KEEP_PROD, PROMOTE_DRAFT } },
  badge: { PROD, STAGING, PROD_HISTORY },
  headerBadge: (prodNo, stagingNo, draftSame) => ...,
  scopeNotice: { default, topic },
  targetSelect: { label, draft, staging: (n) => ..., prod: (n) => ..., versionPicker, disabledOverlayHint,
                  currentTargetPrefix: (label) => ... },
  targetBadge: { legacyTiebreakHint, semanticPendingHint: (n) => ... },
  errors: { ENV_MODE_DISABLED, ENV_MODE_ALREADY_ENABLED, ENV_POINTER_STALE, ENV_TARGET_NOT_STAGING,
            ENV_GATE_NOT_PASSED, ENV_SWITCH_BUSY, ENV_DRAFT_NOT_RESTORED, VERSION_REFERENCED_BY_ENVIRONMENT },
}
```

기존 네임스페이스 확장(각 절 diff 참조):

| 네임스페이스 | 추가 키 |
|---|---|
| `MESSAGES.detail` | `tabEnvironment: '환경'` |
| `MESSAGES.versions.restore` | `envDraftOnlyBanner: (prodNo, stagingNo) => ...` |
| `MESSAGES.versions` | `deleteReferencedByEnvironmentError`, `deleteReferencedByEnvironmentLink` |
| `MESSAGES.versions.triggerBadge`/필터 | `ENVIRONMENT: '환경'`(트리거 그룹 필터 옵션 라벨) |
| `MESSAGES.deploySchedules.actionPicker` | `SWITCH_PROD_VERSION`, `SWITCH_PROD_VERSION_DESC`, `SWITCH_PROD_VERSION_DISABLED_HINT_OFF`, `SWITCH_PROD_VERSION_DISABLED_HINT_PERM` |
| `MESSAGES.deploySchedules.actionLabel` | `SWITCH_PROD_VERSION: (versionNo) => ...` |
| `MESSAGES.deploySchedules.reasons.failure` | `GATE_NOT_PASSED`, `ENV_SWITCH_BUSY`(=`DB_BUSY`류로 매핑), `ENV_POINTER_STALE`(=`STATE_CHANGED`류로 매핑) |
| `MESSAGES.deploySchedules.reasons.held` | `ENV_MODE_CHANGED` |
| `MESSAGES.deploySchedules.detail.readiness` | `ENV_DRAFT_ONLY` |
| `MESSAGES.deploySchedules.dialog` | `confirmButtonByAction.SWITCH_PROD_VERSION: (formatted, versionNo) => ...` |
| `MESSAGES.simulator` | `targetSectionLabel`, `targetOverlayDisabledHint` |
| `MESSAGES.validation.runTrigger` | `targetSelectLabel` |
| `MESSAGES.learning` | `targetDeletedInDraftLabel: (kind, nameFromVersion) => ...`, `prodReflectionBadge`, `prodReflectionAriaLabel` |

---

## 9. 폴링/새로고침 정책

| 화면 | 정책 |
|---|---|
| EN1 전체 | 폴링 없음 — 화면 진입 시 1회, 각 동작(켜기/끄기/승격/전환/롤백/게이트 저장) 성공 뒤 자동 새로고침(§21 P-7 "폴링 금지" 요구와 정합) |
| 헤더 환경 배지·TabNav 표시 | 챗봇 상세 마운트당 1회(`learningSummary`와 동일 관행) + 위 동작들의 `refreshEnvironmentStatus()` 호출 뒤 갱신. 별도 주기 폴링 없음 |
| `TargetSelectField`(시뮬레이터·TC) | 다이얼로그/패널 오픈 시 1회 |
| 예약 배포 S1/S2 | 기존 정책 불변(`scheduled-deploy-ui-spec.md` §9) — `SWITCH_PROD_VERSION` 예약도 같은 `RUNNING`/재시도 중 `PENDING` 폴링 규칙을 그대로 받는다 |

---

## 10. `UIUX_준수기준.md` 체크리스트 매핑

| 화면 | §1 색상대비/단독금지 | §3 키보드 | §4 버튼 | §5/§6 폼 | §7 오류메시지 | §8 로딩/비동기 | §9 내비게이션 |
|---|---|---|---|---|---|---|---|
| EN1 현황 | `EnvironmentBadge`/`GateResultBadge` 아이콘+색+텍스트 3중 | 카드 내 버튼 Tab 순회, 이력 필터 셀렉트 방향키 | "스테이징으로 승격"/"운영 전환..." 등 동사형, 44×44px | — | `readFailed` 등 오류는 원인+해결(되돌리기 링크) | `SkeletonCard`, 승격/전환 뒤 자동 갱신은 `aria-live` 1회 | 예약 링크·환경 탭 딥링크 `<a>` 기반 |
| EN1-a/b(켜기/끄기) | 경고·배너 아이콘+텍스트 | 포커스 트랩·`Esc`·**기본 포커스=취소** | 확정 버튼 대상 명시("환경 분리 사용"), 44×44px, 제출 중 `disabled` | 끄기 2択 라디오 방향키(§6), 사전 선택은 "운영 유지"(안전 기본값 — 개인정보 아님) | 경합 오류 전부 원인+해결 | 미리보기 `aria-live`, 끄기 2단계는 사용자에게 단일 로딩으로 통합 | — |
| EN1-c/d/e(승격/전환/게이트) | `SwitchWarningText`/`SwitchBlockerText`/`GateResultBadge` 아이콘+색+텍스트 | 방향키(게이트 모드 라디오), Tab 순회 | 확정 버튼 대상+버전 명시(NFR-ENA2), 44×44px | 게이트 폼: 라디오(단일)·셀렉트·숫자입력 레이블 필수(플레이스홀더 아님), 사전 검증(BLOCK+세트없음) | 차단 사유는 비활성 버튼의 `aria-describedby`(NFR-ENA3) | 제출 `aria-live`, 결과 1회 안내 | 게이트 설정 이동 링크 |
| EN1-f(이력) | 방식/환경 라벨 텍스트(색상만 아님) | 필터 셀렉트 방향키 | 페이지네이션 44×44px | — | — | `SkeletonRow` | 페이지네이션 밑줄+형태, `aria-sort` 대상 아님(정렬 없음) |
| 예약 배포 확장 | 기존 상속(No.28) | 기존 상속 | "v44로 운영 전환 예약" 등 대상 명시 | `TargetVersionPicker` 라디오(§4.9) | 기존 오류 매핑 확장(§4.9) | 기존 상속 | 기존 상속 |
| 버전 목록/복원 확장 | `EnvironmentBadge` 아이콘+색+텍스트 | 기존 상속 | 기존 상속 | — | `ENV_DRAFT_ONLY` 배너 아이콘+텍스트, 삭제 409 원인+해결+링크 | — | — |
| 시뮬레이터/TC 대상 선택 | — | `TargetSelectField` 방향키(셀렉트), 비활성 시 `aria-disabled`+툴팁 | — | 레이블 있는 선택 컨트롤(NFR-ENA4), 현재 대상 대화 영역 제목에 텍스트 표시 | — | — | — |
| 환경 밖 자산 배너 | 아이콘(ⓘ)+텍스트 | 배너 자체는 비대화형 | — | — | — | — | — |
| 학습현황/평가 확장 | `ProdReflectionBadge` 아이콘+텍스트 | 기존 상속 | — | — | — | — | — |
| 헤더 환경 배지 | 텍스트만으로 의미 전달(NFR-ENA1) | 클릭 가능 링크 Tab 진입 | — | — | — | — | 헤더 링크 `<a>` 기반 |

공통: 신규/변경 화면 **axe 스캔 대비 위반 0건**, 모든 신규 버튼 **44×44px 이상**, 모든 폼 **레이블 필수**, 제출/취소 다이얼로그는 **`Modal`의 포커스 트랩·`Esc`·기본 포커스 취소를 그대로 상속**한다.

---

## 11. 반응형 고려사항

1. **EN1 현황 3카드**: 데스크톱(≥1024px)은 가로 3열. 태블릿(640~1023px)은 2열+1열 줄바꿈(초안+스테이징 / 운영). 모바일(<640px)은 세로 스택 1열(초안 → 스테이징 → 운영 순서 고정 — 흐름 방향과 일치).
2. **`EnvironmentHistoryTable`**: 데스크톱은 표. 모바일(<640px)에서는 **표 대신 카드 목록**으로 전환한다(각 카드: 시각/환경·방식 배지/버전/주체/사유 순으로 세로 나열) — `ChatbotCardList.tsx`(No.28 §5.6-4.6.3에서 인용한 선례)와 같은 "좁은 화면에서 표를 카드로 대체" 관행을 따른다. 가로 스크롤 표는 만들지 않는다(작은 화면에서 표 자체를 유지하면 열이 많아 가독성이 떨어지고 터치 스크롤 발견성이 낮다).
3. **EN1-a~d 다이얼로그**: 기존 `Modal`의 반응형 규칙(좁은 화면 전체폭, 포커스 트랩) 상속. 끄기 2択 라디오는 좁은 화면에서도 세로 배치라 변화 없음.
4. **`TabNav`**: "배포" 그룹이 3 → 4항목이 되어도 기존 규칙(`quality-channel-ui-spec.md` §2.4 — 태블릿 그룹 단위 줄바꿈, 모바일 바텀시트 드롭다운)이 그대로 적용된다. "운영" 그룹이 이미 4항목인 선례가 있어 레이아웃 폭 문제가 새로 생기지 않는다.
5. **`TargetSelectField`**(시뮬레이터·TC): 좁은 화면에서 대화 영역 제목과 같은 줄에 두지 않고 그 위 자체 줄로 내린다(제목 텍스트 잘림 방지, 레이블·현재 값 모두 유지).
6. **`apps/widget`**: 이 그룹은 위젯 화면에 변경이 없다(§0) — 최종 사용자 화면 반응형 고려사항 없음.

---

## 12. Out of scope / 재검토 트리거

| 항목 | 사유 | 재검토 트리거 |
|---|---|---|
| 전역 환경 현황 목록(No.28 S4 같은 화면) | 챗봇당 상태 1개뿐이라 "여러 챗봇 확인 필요"를 훑을 수요가 없다 | 다수 챗봇의 게이트 미달·오래된 스테이징을 한눈에 보려는 요구가 반복될 때 |
| "환경" 탭의 "확인 필요" 집계 배지 | 이 그룹에 "주의 상태" 개념이 없다(예약 대기는 이미 예약 배포 탭이 담당) | 게이트 미달·읽기 실패(`readFailed`) 같은 상태가 방치되는 사고가 보고될 때 |
| 비율 분할(카나리·A/B) UI | 요구사항 §9 — 1차 제외, 로그 귀속만 1차 | P-3 (c) 선택 또는 운영 요구 확인 |
| 서버 간 이관(export/import) UI | 2차 — 망분리 구축형 요구 확인 필요 | 해당 요구 확인 시 |
| 버전별 통계 비교 화면 | 1차는 로그 귀속만(P-11) | 2차 |
| 스테이징 외부 미리보기 링크 | P-2 (b) — 콘솔 검수만 | 현업 UAT 요구 확인 시 |
| 2인 승인 전환 | No.45 거버넌스 영역 | No.45 도입 시 |
| "배포" 그룹 5번째 탭 확장에 따른 셸 재구성 | 이번 결정으로 "배포"(4)·"운영"(4) 모두 기존 반응형 규칙 이내 유지 | "배포" 그룹에 5번째 탭 요구가 들어올 때 |

---

## 13. 다음 단계 인계

| 에이전트 | 인계 내용 |
|---|---|
| **`backend-implementer`** | 설계서 §2~§29 구현. 본 문서가 전제하는 API 계약(설계서 §19, 11개 신규 엔드포인트 + 기존 6경로 확장 + 오류 코드 8종)이 화면 데이터 바인딩의 기준이다. `ChatbotEnvironment`/`EnvironmentSwitchLog`/`EmbeddingTextVector` 3테이블과 `Chatbot.prodVersionId`·`ConversationLog.servedVersionId`·`TestRun.targetKind`/`targetVersionId`/`targetVersionNo` 컬럼이 먼저 있어야 프런트 작업을 시작할 수 있다. |
| **`frontend-implementer`** | 구현 순서 권고: ① `MESSAGES.environment.*` + 기존 네임스페이스 확장(§8) → ② `EnvironmentBadge`/`GateResultBadge`/`switchPreviewText.tsx`(가장 많이 재사용됨) → ③ `ChatbotDetailLayout`의 `environmentStatus` 컨텍스트 확장(§4.2, §4.17, §4.15가 모두 이 값에 의존) → ④ EN1 본체(꺼짐/켜짐/승격/전환/롤백/게이트/이력, §4.1~4.8) → ⑤ `TabNav`/`ChatbotDetailHeader` 배지(§1, §4.17) → ⑥ 버전 목록·복원 확장(§4.10~4.12) → ⑦ 예약 배포 확장(§4.9, 4파일 컴파일 강제 지점 먼저 확인) → ⑧ 시뮬레이터·TC 대상 선택(§4.13~4.14) → ⑨ 학습현황·평가 확장(§4.16) → ⑩ 환경 밖 자산 배너 5개 화면(§4.15, 가장 넓게 퍼진 변경이라 마지막). 권한 판정은 `can('chatbot:deploy')` 조합만 사용, 서버가 최종 통제. |
| **`test-automation`** | UI 단위 검증 대상: `ProdSwitchDialog` 기본 포커스=취소·게이트 BLOCK 시 확정 버튼 비활성+`aria-describedby`·`acknowledgeWarnings` 미체크 시 확정 불가 · `EnvironmentDisableDialog`의 "운영 유지" 2단계가 사용자에게 단일 로딩으로 보이는지(내부 복원 실패 시 끄기가 진행되지 않는지) · `TargetSelectField`가 오버레이 켜짐/대상 비초안 상호 배제를 양방향으로 지키는지 · `shouldShowRecurredAfterApply()` 적용 후 `RecurredBadge`가 모드 꺼진 챗봇에서 기존 동작과 바이트 동일(AC-EN1-1 회귀 확인 대상)한지 · VIEWER 계정으로 EN1 렌더 시 쓰기 버튼 0건 확인(§6) · `ActionPickerStep`/`ScheduleDeployDialog`/`deploySchedulePermissions.ts`/`ReadinessWarningList.tsx` 4파일에 `SWITCH_PROD_VERSION` 분기 누락 시 TypeScript 컴파일이 실제로 실패하는지(§4.9) · axe 스캔(EN1 전체, 다이얼로그 4종). |

---

## 14. 설계서와 다르게 판단했거나 설계서에 없어 가정한 사항 (ui-designer 판단 기록)

| # | 판단 | 근거 |
|---|---|---|
| G-1 | "배포" 그룹 4번째 탭으로 "환경"을 채택(설계서 §23은 "4번째 최상위 탭 판단은 ui-designer"로 위임) | §1 — `scheduled-deploy-ui-spec.md` §12가 이미 이 트리거를 예고했고, "운영" 그룹의 4항목 선례가 있어 셸 재구성 없이 수용 가능 |
| G-2 | 전역 환경 현황 목록(No.28 S4 같은 화면)을 만들지 않음 | 설계서·요구사항 어디에도 전역 목록 요구가 없고, 챗봇당 상태 1개뿐이라 카디널리티가 다르다(§12에 재검토 트리거로 기록) |
| G-3 | "운영 전환"과 "롤백"을 하나의 `ProdSwitchDialog`(kind 분기)로 통합 | API 계약(설계서 §4.1 `ProdSwitchPreviewSchema`/`ProdSwitchSchema`/`ProdRollbackSchema`)이 이미 같은 응답 모양을 공유하고, 화면상 차이는 대상 자동/수동 선택과 게이트 강도(BLOCK→WARN)뿐이라 별도 컴포넌트로 나누면 로직이 중복된다 |
| G-4 | 예약 전환(`SWITCH_PROD_VERSION`)의 대상(`targetVersionId`) 선택 진입점을 EN1(스테이징 카드·이력 표)로 한정하고, 버전 이력(No.25) 목록에는 새 버튼을 추가하지 않음 | 요구사항 J-2/설계서 §9.3이 전환 대상을 "현재 스테이징 또는 운영 이력"으로 제한한다 — 임의 버전에서 진입 가능하게 하면 서버가 결국 `ENV_TARGET_NOT_STAGING`으로 막을 대상을 화면이 먼저 제시하는 셈이라 No.28 §4.3의 "선제 차단" 원칙에 어긋난다 |
| G-5 | 게이트의 "최소 합격률"·"결과 유효 기간"을 슬라이더가 아닌 숫자 입력 필드로 설계 | UIUX §6의 슬라이더 규칙은 "실시간 미리보기가 있는 연속값"(예: 의미 임계값)에 적용된 선례이며, 이 두 값은 이산적 설정값이라 숫자 입력만으로 레이블·방향키 조작·정밀 입력 요건을 충분히 만족한다고 판단했다 |
| G-6 | 환경 밖 자산 안내 대상에서 API 연결·금지어(전역 설정 화면)를 제외 | 두 화면은 특정 챗봇에 종속되지 않아 "이 챗봇의 환경 분리 여부"를 판단할 문맥이 없다(§4.15) |
| G-7 | `EnvironmentStatus` 조회를 `ChatbotDetailLayout` 레벨에서 챗봇 상세 마운트당 1회 수행(폴링 없음)하고 `learningSummary`와 동일한 컨텍스트 공유 패턴을 적용 | 헤더 배지·TabNav 표시·EN1·환경 밖 자산 배너 4곳이 모두 같은 값을 필요로 하며, 설계서 §21 P-7이 "화면 진입·전환 후에만 새로고침(폴링 금지)"을 명시했다 — 단, `enabled=true`일 때 조회 비용이 `versions/current`와 동급(§21 P-7 "1초 P95")이므로 매 탭 전환마다 다시 조회하지 않는 것이 중요하다는 점을 구현자가 유의해야 한다 |
| G-8 | 켜기 확인 대화상자의 확정 버튼에는 버전 번호를 넣지 않고 "환경 분리 사용" 고정 문구 사용(다른 모든 확정 버튼은 대상 버전 명시, NFR-ENA2) | 켜기는 아직 버전이 확정되지 않은 상태에서 미리보기하는 유일한 동작이라(재사용/신규 여부가 트랜잭션 안에서 정해짐) 미리보기 단계의 버전 번호를 확정 버튼에 못박으면 재사용/신규 여부에 따라 문구가 흔들릴 수 있어 고정 문구를 택했다 |

---

## 15. 사용자 확인이 필요한 UX 선택

- **없음.** 요구사항 §11의 P-1~P-12가 전부 추천안으로 확정되었고(2026-09-25), 설계서 §1의 architect 확정 사항도 모두 반영이 끝난 상태라 이 화면설계서 수준에서 PM 재확인이 필요한 쟁점은 발견하지 못했다. §14의 G-1~G-8은 설계서가 명시적으로 ui-designer에게 위임했거나(G-1) 설계서에 없는 순수 화면 배치 판단(G-2~G-8)이며, 요구사항의 방향과 상충하지 않는다고 판단해 확정해 진행했다. 구현 중 이견이 생기면 §14 표를 기준으로 재논의한다.
