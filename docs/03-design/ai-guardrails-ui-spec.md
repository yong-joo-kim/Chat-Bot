# AI 거버넌스·가드레일(No.36) 관리자 콘솔 화면 설계서

> **대상 기능**: No.36 AI 거버넌스·가드레일 — 규모 A(위험 응답 규칙 + AI 답변 개인정보 가림 + 운영 전환 2인 승인). 콘솔 화면 이름은 **"안전 가드레일"**(챗봇 상세 탭 이름 1곳에만 쓴다 — §0 용어 원칙) · 전역 화면 이름은 **"운영 전환 승인"**
> **근거 문서**: `docs/requirements/ai-guardrails.md`(J-1~J-12, FR-AG1~AG5·AG9, NFR-AGA1~3, AC-AG1~AG6, EX-AG-1~20) · `docs/02-spec/ai-guardrails-설계.md`(§4 규칙 · §6.2 출구 처리 · §7.4 가림 설정 · §8.4~8.6 현황·이벤트·지도 · §9 시뮬레이터 · §10 2인 승인(상태 기계·요청·승인·예약·끄기 차단) · §11 HITL 현황표 · §13 API·오류 코드 · §17 화면 정보구조 · §20 K-1~K-14 · §21 R-1~R-22 · §22 D-1~D-4) · `docs/02-spec/decisions/ADR-0048-*.md` · `docs/03-design/UIUX_준수기준.md`
> **참고한 기존 화면 명세**: `deep-clustering-ui-spec.md`(문서 형식 · 기능 꺼짐 · 열람 감사 배너 · 데이터 지도 절) · `environment-separation-ui-spec.md`(EN1 환경 탭 · 전환 대화상자 · 이력 표) · `scheduled-deploy-ui-spec.md`(예약 생성 · 실패 사유) · `security-audit-ui-spec.md`(금지어 "문장으로 시험하기") · `learning-augmentation-ui-spec.md`(제안-자산 분리 컨테이너) · `data-governance-ui-spec.md`(열람 감사 배너 · 데이터 지도)
> **작성**: ui-designer · 2026-09-30 · **다음 단계**: `frontend-implementer`(이 문서 기반 구현) → `code-reviewer` → `test-automation`
> **범위 경계**: 실제 React 코드는 작성하지 않는다. **위젯·`packages/dialogue-engine` 변경 0**(설계서 AG-1 · D-4 — 위젯의 `FAILED` 상태 문구 고정 문제는 관리자 화면 안내로만 다룬다, §5.4·§8.5). 신규 권한 0(`security:read/write` · `chatbot:deploy` · 기존 `chatbot:read`+`dialogue:read`). 문구 상수는 이 문서의 상자 안 문자열이 실제 화면 문구다.

---

## 0. 전제와 코드 확인 결과

### 0.1 확정 조건(PM)

| 항목 | 내용 | 이 문서 반영 |
|---|---|---|
| 규모 | A — 위험 응답 규칙 + AI 답변 개인정보 가림 + 운영 전환 2인 승인. 편향·환각 점검·근거 대조·AI 답변 고지는 **하지 않음** | §0.3 용어 · §3.6 한계 안내 |
| 가림 기본 | **주민등록번호·카드번호만** 기본 선택. 계좌·전화·이메일은 챗봇별 선택. 거버넌스 모드에서는 주민등록번호·카드번호 가림 **하한**(끌 수 없음) | §6 |
| 2인 승인 | 기본 **꺼짐** · 롤백 예외(직전 운영 버전만) · 자기 승인 금지 · 만료 | §9 |

### 0.2 확인한 기존 코드(`apps/web/src`) — 어디에 붙일지의 근거

| 확인한 것 | 결과 | 이 문서의 결정 |
|---|---|---|
| `pages/chatbot-detail/TabNav.tsx` | 4개 시각 그룹(운영/설계/검증/배포). "검증" 그룹 = `답변 설정 · 응답 테스트 · 대화검증` 3탭. 탭 수를 단언하는 시험은 없다(`TabNav.spec.tsx`는 "환경" 탭 렌더만 확인). 권한 없는 탭도 링크는 보이고 페이지에서 `ForbiddenState`를 그린다(No.41 선례 주석) | **"검증" 그룹 끝(4번째)에 최상위 탭 "안전 가드레일" 추가**(설계서 §17.1). 통계 서브내비에 끼우지 않는다 — 통계가 아니라 운영 설정이다 |
| `App.tsx` 라우트 | 챗봇 상세 하위에 `validation`(셸+서브라우트) 패턴이 있다. 최상위 전역 화면은 `/inbox`·`/handoff-console`(TopBar 링크) · `/settings/*`(시스템 설정 메뉴) | 챗봇 스코프 = `/chatbots/:chatbotId/guardrails/*`(셸 + 서브라우트) · 전역 승인 대기 = 새 최상위 `/environment-approvals` |
| `TopBar.tsx` / `SystemSettingsMenu.tsx` | TopBar 링크(챗봇 목록·상담 모니터링·통합 인박스)는 **자주 확인하는 업무**이고 배지(건수)를 `(n)` 글자로 붙인다(60초 폴링). 시스템 설정 메뉴는 설정성 화면(금지어·API 연결·예약 배포 현황 …) | 승인 대기는 **만료 시각이 있는 업무**라 TopBar 링크 + `(n)` 배지(인박스 선례). 설정 메뉴가 아니다 |
| `EnvironmentTab.tsx` · `EnvironmentStatusPanel.tsx` | 3카드(초안·스테이징·운영) → 예약 배너 → 게이트 요약 → `GateSettingsPanel` → `EnvironmentHistoryTable`. `canDeploy = can('chatbot:deploy') && !ARCHIVED`. `dialogue:read` 없으면 `ForbiddenState` | 승인 대기 카드 · 2인 승인 설정 패널을 **3카드와 게이트 사이**에 넣는다(§9.2) |
| `ProdSwitchDialog.tsx` | `kind: SWITCH \| ROLLBACK` 공용. `preview.blockers`·`warnings`·`acknowledgeWarnings`·`reason`. 오류 시 `e.code` 분기 후 미리보기 재조회(`reason`·체크 상태는 유지됨). 포커스 = 취소 버튼(`data-autofocus="cancel"`) | **같은 대화상자에 "요청 모드"를 얹는다** — 새 대화상자를 만들지 않는다(§9.4) |
| `EnvironmentDisableDialog.tsx` | 끄기 미리보기 → 확정. 오류는 `ApiError.message` 그대로 | 끄기 버튼을 **`aria-disabled` + 사유 글자**로 막고, 대화상자에서도 409를 방어 처리(§9.9) |
| `EnvironmentHistoryTable.tsx` | 표(데스크톱) + 카드(모바일, `desktop-only`/`mobile-only`) · "방식" 열 = `methodLabel` | "방식" 셀에 글자 표식 추가(§9.11) |
| `ScheduleDeployDialog.tsx` | `SWITCH_PROD_VERSION` 분기 · 확정 버튼 문구 `confirmButtonByAction` · 생성 후 `onCreated(label)`. `MESSAGES.deploySchedules.reasons.failure` 라벨 맵 | 정책 켜짐이면 확정 버튼 문구 · 생성 성공 직후 **같은 흐름에서 승인 요청 호출**(설계서 R-6) — §9.10 |
| `DeployScheduleRow.tsx` | 행 = 상태 배지 + 동작 링크 + 시각 + `reasonText`(실패 사유) + 재시도/확인/취소 버튼 | 행에 **승인 상태 글자** 추가(챗봇 스코프 목록·상세만 — §9.10) |
| `SimulatorPanel` · `TracePanel` · `RagUsageToggle` | 판정 근거(`TracePanel`)는 **기본 접힘** | 가드레일 입구 안내·AI 답변 미리보기는 접힘 밖(말풍선 바로 아래)에 둔다(§10.1) |
| `Modal.tsx`(`Modal`·`ConfirmDialog`) | 열림 시 포커스 이동 · Esc · 포커스 트랩 · `ConfirmDialog` 기본 포커스 = 취소 | 모든 확인은 이 둘로만(§14) |
| `EmptyState` · `ErrorState` · `SkeletonRow/Card` · `Pagination` · `InlineFieldError` · `SeverityBadge` · `GateResultBadge` · `ChannelToggle`(`aria-disabled`+사유 토글) · `ChipListEditor` · `KebabMenu` · `ProposalContainer` · `GovernanceViewAuditBanner` · `ArchivedBanner` · `PeriodSelector` · `MetricCard` · `RequirePermission`/`ForbiddenState` · `useToast` · `UnsavedGuardContext` | 전부 존재. `AutoSnapshotNotice`는 **쓰지 않는다** — 규칙·정책·승인은 버전 스냅샷을 만들지 않는다(설계서 AG-14) | 재사용 목록 §2.2 |
| `EnvironmentScopeNotice` | 환경 분리가 켜졌을 때만 뜨는 "환경 분리 대상이 아닙니다" 배너 | 규칙·가림 설정은 환경 분리와 무관하게 "버전 기록에 들어가지 않고 저장 즉시 적용" 안내가 필요하므로 **전용 상시 배너**를 둔다(§3.2) |
| `DataGovernanceMapPage.tsx` | 절 단위 확장(`{data.utteranceAnalysis && <…Section/>}`) | 같은 방식으로 `data.guardrails` 절 추가(§10.2) |
| `user.governanceModeOn`(`useAuth()`) | 열람 감사 배너 조건 | 이벤트 목록(적중 기록)에만 사용(설계서 §8.5) |
| `ROLE_PERMISSIONS`(`shared-types/security.ts`) | `security:read/write`·`chatbot:deploy` = **ADMIN만** | 규칙·가림·승인 화면은 실질 ADMIN 전용. 그래도 권한 분기는 `can()`으로 쓴다 |

### 0.3 용어 원칙(요구사항 NFR-AGA2 · 설계서 AG-16 · 관리자에게 쉬운 말)

- **"가드레일"은 탭·페이지 제목 1곳("안전 가드레일")에만 쓴다.** 설계서 §17.1이 정한 이름이고, 본문 문구는 아래 쉬운 말로 풀어 쓴다. 다른 곳(안내 문장·버튼·표 머리)에는 "가드레일"을 쓰지 않는다. (요구사항 §0의 "가드레일" 산문 용어를 화면에 그대로 옮기지 않는다.)
- **화면 문자열에 "환각"·"hallucination"·"편향 없음"·"환각 탐지"를 쓰지 않는다**(vitest 문자열 스캔 — 설계서 AG-16). AI 답이 문서와 맞는지 검사하지 않는다는 사실은 "**AI 답변 내용이 문서와 맞는지는 검사하지 않습니다**"로 적는다.
- 그 외 금지: "RAG"·"입구/출구"·"이벤트"·"PII"·"마스킹"·"프로필"·"캐시"·"CAS"·"포인터" — 대신 아래 대응어.

| 내부 개념 | 화면 용어 |
|---|---|
| 입구(INBOUND) / 출구(OUTBOUND) / 둘 다 | **사용자 질문** / **AI 답변** / **둘 다** |
| 외부 RAG 답 | **AI 답변**(콘솔 "AI 답변 설정" 탭과 같은 말) |
| 위험 응답 규칙 | **위험 응답 규칙**(줄여서 "규칙") |
| 적중(hit) · 이벤트 | **걸림** · **걸린 기록** · 화면 이름 "적중 기록" → **"걸린 기록"** |
| 마스킹 | **가림**(예: "주민등록번호 1건을 가렸습니다") |
| MONITOR / REPLACE / NO_RAG | **기록만** / **안전 문구로 대체** / **AI로 보내지 않음**(shared-types `GUARDRAIL_ACTION_LABELS`를 그대로 쓴다 — 문구를 새로 만들지 않는다) |
| 분류 8종 | shared-types `GUARDRAIL_CATEGORY_LABELS`(위기·자해 / 의료 조언 / 법률 조언 / 투자·재무 조언 / 개인정보 요구 / 지시 무시 시도 / 차별·혐오 / 기타) |
| appliedAction | 기록만 / 안전 문구로 대체 / AI로 보내지 않음 / **개인정보 가림** / **기본 안내 문구로 대체** |
| effect CHANGED / NONE | **답이 바뀜** / **답 변화 없음** |
| 2인 승인 | **운영 전환 2인 승인**(줄여서 "2인 승인") · 승인 요청 · 승인 대기 |
| 직전 운영 버전 롤백(SOLO_ROLLBACK) | **직전 버전으로 되돌리기**(승인 예외) · 기록 표식 "**승인 없이 되돌림**" |
| 요청 상태 | §9.5 표(전부 글자) |
| 폴백(FALLBACK) | **기본 안내 문구**(AI 답변을 준비하지 못했을 때 나가는 문구) |

---

## 1. 화면 목록 · 라우트 · 메뉴 · 권한

### 1.1 화면 목록

| ID | 화면 | 라우트 | 진입 경로 | 조회 권한 | 쓰기 권한 |
|---|---|---|---|---|---|
| **GR-0** | 안전 가드레일 셸(서브내비 4 + 공통 배너) | `/chatbots/:chatbotId/guardrails`(index → `rules`) | 챗봇 상세 → "검증" 그룹 → **안전 가드레일** 탭 | `security:read` | — |
| **GR-1** | 위험 응답 규칙 목록 | `…/guardrails/rules` | 서브내비 "위험 응답 규칙" | `security:read` | 추가·켜기/끄기·이동·삭제 `security:write` |
| **GR-2** | 규칙 만들기 / 고치기(+ 문장으로 시험하기) | `…/guardrails/rules/new` · `…/guardrails/rules/:ruleId` | GR-1 "규칙 추가" · 행 "수정" | `security:read` | 저장·삭제 `security:write` |
| **GR-3** | AI 답변 개인정보 가림 설정(+ 시험하기) | `…/guardrails/pii` | 서브내비 "개인정보 가림" | `security:read` | 저장 `security:write` |
| **GR-4** | 현황(요약·규칙별·가림 종류별·승인 없이 되돌린 알림·사람이 확인하는 절차 표) | `…/guardrails/overview` | 서브내비 "현황" | `security:read` | — |
| **GR-5** | 걸린 기록(목록 + 대화 보기) | `…/guardrails/events` | 서브내비 "걸린 기록" · GR-4 규칙 행 링크 | `security:read` (+ 거버넌스 모드 열람 감사) | — |
| **AP-0** | 환경 탭 보강(2인 승인 설정 패널 · 승인 대기 카드 · 버튼 분기 · 끄기 비활성 · 이력 표식) | `/chatbots/:chatbotId/environment`(기존) | 기존 진입 | `chatbot:read`+`dialogue:read` | 정책 변경·요청·취소 `chatbot:deploy` |
| **AP-1** | 전역 승인 대기 목록 | `/environment-approvals` | TopBar "승인 대기" 링크 | `chatbot:deploy` | — |
| **AP-2** | 승인 요청 상세(다시 확인 → 승인/반려/취소) | `/environment-approvals/:chatbotId/:requestId` | AP-1 행 · AP-0 대기 카드 | 조회 `chatbot:read`+`dialogue:read` | 승인·반려·취소 `chatbot:deploy` |
| AP-0a | 2인 승인 켜기 대화상자 · AP-0b 끄기 확인 · AP-0c 요청 취소 확인 · AP-2a 승인 최종 확인 · AP-2b 반려 대화상자 | 모달(URL 없음) | 각 버튼 | — | `chatbot:deploy` |
| **EN-1** | 기존 운영 전환·되돌리기 대화상자(`ProdSwitchDialog`)의 **요청 모드 / 단독 롤백 모드** | 모달(기존) | 기존 진입 | — | `chatbot:deploy` |
| **SC-1** | 예약 생성 대화상자(`ScheduleDeployDialog`) · 예약 목록/상세 행의 승인 상태 · 실패 사유 `APPROVAL_MISSING` | 기존 | 기존 진입 | 기존 | 기존 + 승인 요청 `chatbot:deploy` |
| **SM-1** | 시뮬레이터 결과 보강(입구 판정 안내 · AI 답변 미리보기) | 기존 드로어·탭 | 기존 진입 | 기존(`simulation:*`) | — |
| **DM-1** | 데이터 지도 "안전 가드레일" 절 | `/settings/data-governance/map`(기존) | 기존 진입 | `security:read`(기존) | — |

- 새 라우트는 `App.tsx`에 **① `/chatbots/:chatbotId` 하위 `guardrails`(셸 + 서브라우트 5개) ② 최상위 `/environment-approvals`·`/environment-approvals/:chatbotId/:requestId` 2개**를 추가한다. 각 라우트는 `RequirePermission`(GR-* = `security:read` · GR-2 new/GR-3 저장 화면 자체는 read로 진입 가능하되 쓰기 컨트롤 미렌더 · AP-1/AP-2 = `chatbot:deploy`)으로 감싸고 메뉴 이름은 "안전 가드레일" / "운영 전환 승인"을 넘긴다.
- **URL에 넣는 것**: GR-5 필터·페이지(`?from=&to=&ruleId=&stage=&appliedAction=&page=`) · GR-4 기간(`?from=&to=`). 모달 안 단계·GR-2 폼 값은 넣지 않는다.
- **탭 링크는 권한이 없어도 보인다**(`TabNav` 관행 — `security:read`가 없는 EDITOR·VIEWER·AGENT가 눌러 들어가면 페이지 안에서 `ForbiddenState`). 단 `TopBar`의 "승인 대기" 링크는 `chatbot:deploy`가 없으면 **렌더하지 않는다**(전역 링크 F-4 숨김 원칙 — `상담 모니터링` 링크와 같다).

### 1.2 메뉴 위치 판단

| 안 | 판정 |
|---|---|
| A. 통계 탭 서브내비 5번째 | **기각** — 통계는 조회 화면이고 규칙·설정은 쓰기 화면. 규칙 저장은 대화 결과를 바꾼다 |
| B. 시스템 설정 메뉴(전역, `/settings/guardrails`) | **기각** — 규칙은 **챗봇별**(설계서 P-8)이라 챗봇 문맥이 필요하다. 전역 목록이 필요해지면 재검토 |
| **C. 챗봇 상세 "검증" 그룹 4번째 탭 "안전 가드레일"** | **채택**(설계서 §17.1) — "AI 답변 설정 · 응답 테스트 · 대화검증"과 같은 성격(답이 어떻게 나가는지 다룬다) |
| 전역 승인 대기: 시스템 설정 메뉴 항목 | 기각 — 승인은 24시간 등 **기한이 있는 업무**라 항상 보이는 링크 + 건수가 낫다. 설정 메뉴 안에 숨으면 놓친다 |
| **전역 승인 대기: TopBar 링크 + `(n)`** | **채택** — `통합 인박스` 링크와 같은 패턴(`chatbot:deploy` 게이트 · 60초 폴링 · 탭 숨김 시 정지) |

### 1.3 서브내비 구성 — 설계서 §17(2개)에서 **4개로 나눈 이유**

설계서는 하위 탭을 "규칙 · 현황" 2개로 두고 가림 설정을 규칙 탭의 절로, 이벤트 목록을 현황의 절로 적었다. 이 문서는 다음 이유로 **4개**로 나눈다(§17 조정 A-1):

| 서브내비 | 이유 |
|---|---|
| 위험 응답 규칙 | 규칙 표 + 시험하기 |
| **개인정보 가림** | 규칙과 **쓰기 API·목적·저장 위치가 다르다**(`PUT settings`). 규칙 표·시험하기와 한 화면에 섞으면 길어지고 "규칙을 저장했는데 가림도 저장됐나?" 혼동이 생긴다 |
| 현황 | 집계(조회 전용) — **열람 감사 대상이 아니다** |
| **걸린 기록** | 이벤트 목록은 **대화 마스킹본을 함께 싣고 거버넌스 모드에서 열람 감사(VIEW)** 대상이다(설계서 §8.5·R-13). 감사 배너를 집계 화면에 달면 사실과 다르다(No.21 UA-1/UA-3 분리와 같은 판단) |

### 1.4 권한별 화면(신규 권한 0)

| 요소 | ADMIN(`security:*` · `chatbot:deploy`) | EDITOR | VIEWER | AGENT(`cs:*`) |
|---|---|---|---|---|
| 탭 링크 "안전 가드레일" | 보임 | 보임 | 보임 | 보임 |
| GR-1~GR-5 화면 | 조회 + 쓰기 | `ForbiddenState` | `ForbiddenState` | `ForbiddenState` |
| 규칙 추가·수정·삭제·켜기/끄기·이동 · 가림 설정 저장 | 표시 | — | — | — |
| 문장으로 시험하기 | 표시(`security:read`) | — | — | — |
| 환경 탭의 **2인 승인 설정 패널·대기 카드(조회)** | 표시 | 표시(읽기 전용 — 컨트롤 미렌더) | 표시(읽기 전용) | `ForbiddenState`(환경 탭 기존 규칙) |
| 정책 켜기/끄기 · 승인 요청 · 요청 취소 | 표시 | 미렌더 | 미렌더 | — |
| TopBar "승인 대기" · AP-1 · AP-2 | 표시 | 링크 미렌더 · 직접 접근 `ForbiddenState` | 같음 | 같음 |
| 승인·반려 버튼 | 표시(요청자 본인이면 비활성 + 이유 글자) | — | — | — |
| 시뮬레이터의 입구 판정 안내 · AI 답변 미리보기 | 표시 | 표시(설계서 S-9 — 관리자 화면 한정) | — | — |
| 데이터 지도 "안전 가드레일" 절 | 표시(`security:read`) | — | — | — |

- 서버가 최종 방어(403)다. 화면은 첫 겹이다. **`ARCHIVED` 챗봇**: 조회·시험하기만 가능. 쓰기 컨트롤은 **렌더하지 않고** 상단 `ArchivedBanner`("보관된 챗봇은 …")를 둔다. 서버 `409 CHATBOT_ARCHIVED`는 방어적으로 같은 문구로 처리한다(EX-AG-10).

---

## 2. 공통 규칙 · 컴포넌트

### 2.1 신규 컴포넌트

디렉터리: `apps/web/src/pages/chatbot-detail/guardrails/`(GR-*) · `apps/web/src/pages/chatbot-detail/environment/approval/`(AP-0 · 환경 탭 보강) · `apps/web/src/pages/settings/environment-approvals/`(AP-1·AP-2) · API 클라이언트 `apps/web/src/api/guardrails.ts` · `apps/web/src/api/switchApprovals.ts`.

| 컴포넌트 | props(표시 데이터) | 설명 |
|---|---|---|
| `GuardrailShell` | — | 서브내비 4 + 공통 배너(§3.2) + `Outlet`. **규칙 목록을 한 번 조회해 `Outlet context`로 내려준다**(`rules`·`meta{ragActive, serverEnabled, limits}`·`reload`) — `ragActive`·`serverEnabled`가 규칙 목록 응답에만 있어서다(§17 조정 A-3) |
| `GuardrailRuleListPage` / `GuardrailRuleFormPage` / `GuardrailPiiSettingsPage` / `GuardrailOverviewPage` / `GuardrailEventsPage` | 라우트 | 각 화면 최상위 |
| `GuardrailRuleTable` | `rules`, `canWrite`, `ragActive`, `onToggle`, `onMove`, `onDelete` | 데스크톱 표 + 모바일 카드 |
| `RuleActionBadge` | `action` | 동작을 **글자 배지**로(색+아이콘+글자, `SeverityBadge` 톤 위임 — 기록만=INFO · 안전 문구로 대체=WARNING · AI로 보내지 않음=WARNING) |
| `RuleStageText` | `appliesTo` | "사용자 질문" / "AI 답변" / "둘 다" 글자 |
| `RuleWarningList` | `rule`, `ragActive` | 행 아래 확인할 점(§4.3) |
| `RuleForm` | `initial`, `errors`, `ragActive`, `onChange` | 규칙 폼(§5.2) |
| `ExpressionListEditor` | `values`, `matchType`, `errors` | `ChipListEditor` 래퍼 — 줄바꿈 붙여넣기 분할 · 개수 표시 · 검증(§5.3) |
| `GuardrailTestPanel` | `chatbotId`, `mode: 'rules' \| 'pii'`, `draftRule?`, `draftRuleId?`, `draftPiiExit?` | "문장으로 시험하기"(§5.5) — 규칙 편집·개인정보 가림 화면 공용 |
| `TestResultView` | `result: GuardrailTestResponse`, `stage` | 결과 배지 · 걸린 규칙 표 · 결과 문구 · 가림 건수 |
| `PiiKindCheckboxGroup` | `kinds`, `preserveDates`, `governanceFloor`, `onChange` | 가림 종류 체크박스 5(가나다순) + 경고(§6.2) |
| `OverviewSummaryCards` | `overview` | 요약 카드 7(§7.2) |
| `RuleHitTable` | `rows`, `chatbotId` | 규칙별 표 |
| `PiiCountTable` | `rows` | 종류별 가림 건수 |
| `SoloRollbackAlertList` | `alerts` | 승인 없이 되돌린 알림(§7.4) |
| `HitlProcedureTable` | `hitl`, `chatbotId`, `can` | 사람이 확인하는 절차 표(§7.5) |
| `EventFilterBar` | `rules`, `value`, `onChange` | 기간·규칙·위치·처리 결과 필터 |
| `EventTable` / `EventRow` | `items`, `expandedId`, `onToggle` | 걸린 기록 표 + 대화 보기 펼침 |
| `ConversationMaskedView` | `conversation`, `textPurged` | 사용자 질문·봇 답(가림 처리본) — 글자만 렌더 |
| `ApprovalPolicyPanel` | `chatbotId`, `status: ApprovalPolicyStatus`, `canDeploy`, `onChanged` | 환경 탭 2인 승인 절(§9.3) |
| `ApprovalPolicyDialog` | `chatbotId`, `currentTtl`, `isOpen` | 켜기(만료 시간 입력) |
| `ApprovalPendingCard` | `request`, `me`, `canDeploy`, `now` | 환경 탭 대기 요청 카드(§9.6) — `ProposalContainer` 사용 |
| `ApprovalStatusText` | `request` | 상태 글자(§9.5 표) |
| `RemainingTimeText` | `expiresAt`, `now` | "23시간 12분 남음 · 2026-10-01 14:02 만료" + 임박 시 글자 병기 |
| `ApprovalRecentTable` | `items` | 최근 요청 20건 표/카드 |
| `ProdSwitchDialog`(확장) | + `approvalPolicy?` | 요청 모드·단독 롤백 모드(§9.4) — 기존 props 무변경 |
| `ApprovalListPage` / `ApprovalDetailPage` | 라우트 | AP-1 / AP-2 |
| `ApprovalNavLink` | — | TopBar 링크 + `(n)` |
| `ApprovalRejectDialog` / `ApprovalApproveConfirm` | `request`, … | AP-2b / AP-2a |
| `ScheduleApprovalStatusText` | `schedule`, `approvalStatus` | 예약 행·상세의 승인 상태 글자(§9.10) |
| `GuardrailInboundNotice` / `RagPreviewPanel` | `guardrailInbound` / `ragPreview` | 시뮬레이터(§10.1) |
| `GuardrailDataMapSection` | `map.guardrails` | 데이터 지도 절(§10.2) |
| `useApprovalPolicy(chatbotId)` | — | `GET …/environment/approval`를 1회 조회·재조회하는 훅(환경 탭 · 예약 대화상자 · 예약 목록 공용 — `useDeployScheduleMeta` 방식의 가벼운 공유 캐시) |

- **일반화 요청**(선택): `ChannelToggle`이 `MESSAGES.channels.toggleOn/Off`("사용 중/사용 안 함")에 묶여 있다. 규칙 사용 스위치는 그대로 쓰고, 2인 승인 스위치는 "켜짐/꺼짐" 라벨이 필요하므로 `onLabel`·`offLabel` 선택 props를 추가한다(기본값 = 기존 문구 → 기존 소비자 무변경).
- **재사용**: `Modal`·`ConfirmDialog`·`EmptyState`·`ErrorState`·`SkeletonRow/SkeletonCard`·`Pagination`·`InlineFieldError`·`SeverityBadge`·`GateResultBadge`·`ProposalContainer`·`GovernanceViewAuditBanner`·`ArchivedBanner`·`PeriodSelector`·`MetricCard`·`KebabMenu`·`RequirePermission`·`ForbiddenState`·`useToast`·`UnsavedGuardContext`·`switchPreviewText`(`SwitchBlockerText`·`SwitchWarningText`)·`summaryLine`.
- **신규 스타일 원칙**: 기존 클래스 재사용(`settings-page`·`dialogue-table`·`desktop-only`/`mobile-only`·`settings-card-list`·`form-field`·`field-hint`·`field-error`·`form-banner`·`modal-banner`·`environment-status-card`·`stats-subnav`). 색은 `SeverityBadge` 토큰만 쓰고 새 색을 만들지 않는다.

### 2.2 문구 상수 위치

`constants/messages.ts`에 `MESSAGES.guardrails`(GR-*) · `MESSAGES.switchApproval`(AP-*·EN-1·SC-1 확장) 두 블록을 신설한다. 이 문서의 상자 안 문자열이 그대로 값이다. 라벨 상수(분류·동작·가림 종류)는 shared-types 것을 **import해서 쓰고 복제하지 않는다**. 추가로: `MESSAGES.detail.tabGuardrails: '안전 가드레일'` · `MESSAGES.common.approvalsNav: '승인 대기'` · `MESSAGES.deploySchedules.reasons.failure.APPROVAL_MISSING`(§13.3).

### 2.3 결과 알림(공통 `aria-live`) 규칙

- 각 화면에 **`role="status"`(polite) 알림 영역 1개**를 둔다(`GuardrailActionStatus`). 켜기/끄기·이동·삭제·저장 결과를 **동작이 끝났을 때 1회** 문장으로 넣는다(예: "‘투자 권유’ 규칙을 사용 중으로 바꿨습니다."). 목록이 다시 그려져도 같은 문장을 반복하지 않는다(문장이 바뀔 때만).
- 남은 시간·건수 같은 **주기 갱신 값은 낭독하지 않는다**(§9.6).
- 오류는 필드에 붙는 것은 `InlineFieldError`(`role="alert"`), 화면 전체 실패는 `ErrorState`(`role="alert"`).

---

## 3. 셸(GR-0) — 공통 배너와 서브내비

### 3.1 레이아웃

```
안전 가드레일                                     (h1, 탭 페이지 제목 · 서브 문구는 아래)
위험한 답을 막고, 운영에 나가는 말을 지키는 설정입니다.

(배너들 — 해당할 때만, 이 순서)
 ⚠ 보관된 챗봇 배너                                  [ArchivedBanner]
 ⚠ 서버 설정으로 꺼짐 배너                          [serverEnabled=false]
 ⓘ 저장 즉시 적용 안내(상시)

[위험 응답 규칙] [개인정보 가림] [현황] [걸린 기록]     ← 서브내비(stats-subnav 관행 · 현재 항목 밑줄+굵게)

<Outlet>
```

### 3.2 공통 배너 문구

| 배너 | 조건 | 문구 | 표시 방식 |
|---|---|---|---|
| **저장 즉시 적용**(상시) | 항상 | "규칙과 가림 설정은 **저장하면 바로** 운영 중인 대화에 적용됩니다. 초안·운영 구분이 없고 버전 기록·복원·예약 배포에 포함되지 않습니다." | `environment-scope-notice` 스타일 · `role="status"` 아님(페이지 로드 시 정적 문단) |
| **서버 꺼짐** | `meta.serverEnabled === false` | "서버 설정으로 안전 가드레일이 꺼져 있어 **규칙과 개인정보 가림이 지금은 적용되지 않습니다.** 설정은 저장하고 시험할 수 있지만 대화에는 반영되지 않습니다. 서버 관리자에게 문의해 주세요." | `form-banner--warning` + ⚠ · 정적 문단 · "기능 꺼짐" 상태(§11) |
| 보관 | `chatbot.status === 'ARCHIVED'` | 기존 `ArchivedBanner` 문구 | 기존 컴포넌트 |
| **AI 답변 미사용**(GR-1·GR-3에서만) | `meta.ragActive === false` | "이 챗봇은 AI 답변(문서 기반 답변)을 쓰지 않아 **‘AI 답변’에 적용하는 규칙과 개인정보 가림은 동작하지 않습니다.** ‘사용자 질문’에 적용하는 규칙은 그대로 동작합니다." + 링크 "AI 답변 설정 보기"(`dialogue:read`가 있을 때 `/chatbots/:id/answer-settings`) | `form-banner--info` ⓘ · EX-AG-16 |

- 배너들은 페이지 최상단·본문 앞 Tab 순서에 둔다(`ArchivedBanner` 관행).
- 서버 꺼짐일 때 GR-4·GR-5의 수치는 0 또는 과거 값이다 — GR-4 상단에 같은 배너를 다시 보이고 카드 아래에 "서버 설정이 꺼진 동안에는 새로 걸린 기록이 쌓이지 않습니다." 한 줄을 더한다.

### 3.3 상태

| 상태 | UI |
|---|---|
| 셸 로딩(규칙 목록 최초 조회) | 서브내비는 즉시 표시 · 본문 자리 `SkeletonCard` 2개 · `aria-busy="true"` |
| 셸 조회 실패 | 서브내비 유지 + `ErrorState`("안전 가드레일 정보를 불러오지 못했습니다") + "다시 시도" — GR-4·GR-5는 규칙 목록 없이도 자체 API로 동작하므로 **셸 실패가 다른 서브탭을 막지 않는다**(GR-5 규칙 필터는 "규칙 목록을 불러오지 못해 규칙 필터를 쓸 수 없습니다" 한 줄) |
| 권한 없음 | `security:read` 없음 → `ForbiddenState`(라우트 가드) |

---

## 4. 화면 GR-1 — 위험 응답 규칙 목록

### 4.1 목적

챗봇의 위험 응답 규칙을 한눈에 보고, 추가·켜기/끄기·순서 바꾸기·삭제하며, 저장 전에 문장으로 시험한다.

### 4.2 레이아웃(데스크톱)

```
위험 응답 규칙                              규칙 3/50 · 표현 18/2,000            [+ 규칙 추가]

ⓘ 표현 목록에 적은 말만 찾습니다. 띄어쓰기를 바꾸거나 비슷한 다른 말은 찾지 못할 수 있습니다.
  AI 답변 내용이 문서와 맞는지는 검사하지 않습니다.  (상시 표시)
ⓘ 여러 규칙이 함께 걸리면 가장 강한 동작(안전 문구로 대체 → AI로 보내지 않음 → 기록만)이 적용되고,
  같은 강도끼리는 표에서 위에 있는 규칙의 문구가 쓰입니다.

▾ 문장으로 시험하기                                                    (GuardrailTestPanel — §5.5)

<caption>위험 응답 규칙 목록</caption>
순서   이름         분류          적용 위치      동작                표현  사용        최근 7일 걸림   확인할 점                    동작
[▲][▼] 투자 권유    투자·재무 조언  AI 답변        ⓘ 기록만            6    ● 사용 중     12             —                          [수정][삭제]
[▲][▼] 위기 표현    위기·자해       사용자 질문     ⚠ 안전 문구로 대체   8    ● 사용 중     0              ⚠ 대체 문구에 금지어가 있습니다  [수정][삭제]
[▲][▼] 지시 무시    지시 무시 시도  사용자 질문     ⚠ AI로 보내지 않음   4    ○ 사용 안 함   —             —                          [수정][삭제]
```

- 표 `<table>` + `<caption>`, 열 머리 `<th scope="col">`. **정렬 버튼은 두지 않는다**(순서가 의미 — 동률 판정 기준, 설계서 FR-AG1-4).
- 열 이름: 순서 · 이름 · 분류 · 적용 위치 · 동작 · 표현 · 사용 · 최근 7일 걸림 · 확인할 점 · 동작(sr-only "작업").
- **동작 열**은 `RuleActionBadge`(색 + 아이콘(aria-hidden) + **글자**). "기록만"은 그 옆에 "(관찰 중)" 보조 글자를 붙이지 않는다(글자 배지가 이미 뜻을 전한다) — 대신 표 위 안내 문장으로 관찰 흐름을 안내한다(§4.4 빈 상태 · GR-2 동작 힌트).
- **순서 열**: 위/아래 이동 버튼 2개. 각 44×44px(터치). `aria-label="‘{이름}’ 규칙을 위로 이동"` / `"… 아래로 이동"`. 첫 행 위/마지막 행 아래는 `disabled` 대신 **`aria-disabled="true"` + 시각 표시**(포커스 유지 — 캐러셀 규칙과 같은 원칙, UIUX §3). 이동 후에는 **이동한 행의 같은 방향 버튼으로 포커스를 유지**하고(`ReorderableList` 관행) 알림 영역에 "‘{이름}’ 규칙을 {n}번째로 옮겼습니다."를 넣는다. 요청이 진행 중인 동안 이동 버튼은 `aria-disabled`(중복 실행 방지, UIUX §4).
- **사용 열**: `ChannelToggle`(`role="switch"`, "사용 중/사용 안 함"). 클릭 → `POST …/enable|disable`. 진행 중 `aria-disabled`. 실패는 토스트 + 스위치 원상복구(낙관적 갱신 없음 — 응답으로만 바꾼다). 결과는 알림 영역에 1회 낭독.
- **최근 7일 걸림**: 숫자 + 0이면 "0". 사용 안 함 규칙은 "—"가 아니라 실제 값(꺼져 있어도 과거 걸림은 있다) — 서버 값을 그대로 표시한다.
- **작업 열**: "수정"(링크 `<a>` → GR-2) · "삭제"(버튼 → §4.5). `canWrite`가 아니면 열 자체를 **렌더하지 않고**, 순서·사용 열은 글자만("사용 중"/"사용 안 함") 남긴다.

### 4.3 "확인할 점"(`RuleWarningList`) — 행마다 글자 경고(색 단독 금지)

| 조건 | 문구 | 근거 |
|---|---|---|
| `replacementBannedHit` | "⚠ 대체 문구에 지금 금지어 사전의 단어가 들어 있습니다. 실제 대화에서는 그 단어가 가려져 나갑니다. 문구를 고쳐 주세요." | EX-AG-9 |
| `!ragActive` ∧ `appliesTo === 'OUTBOUND'` | "ⓘ 이 챗봇은 AI 답변을 쓰지 않아 이 규칙은 동작하지 않습니다." | EX-AG-16 |
| `!ragActive` ∧ `action === 'NO_RAG'` | "ⓘ 이 챗봇은 AI 답변을 쓰지 않아 ‘AI로 보내지 않음’은 효과가 없습니다." | 같음 |
| `!ragActive` ∧ `appliesTo === 'BOTH'` | "ⓘ ‘AI 답변’ 쪽 적용은 동작하지 않고 ‘사용자 질문’ 쪽만 동작합니다." | 같음 |
| 없음 | "—" | |

- 경고 문구는 `SeverityBadge`(WARNING/INFO)로 색+아이콘+글자. 여러 개면 목록(`<ul>`).

### 4.4 상태별 UI

| 상태 | UI |
|---|---|
| **로딩**(최초) | 표 자리 `SkeletonRow` 5개 · 머리·안내 문장은 정적 표시 · `aria-busy="true"` |
| **빈 상태**(규칙 0개, 쓰기 권한) | `EmptyState`: 제목 "아직 만든 규칙이 없습니다" · 설명 "제품은 의료·법률 같은 문구를 미리 넣어 두지 않습니다. 필요한 위험 주제를 직접 정해 규칙을 만들어 보세요." · 3단계 번호 목록 "① 규칙을 만들 때 동작은 ‘기록만’으로 시작합니다 ② 며칠 뒤 ‘걸린 기록’에서 잘못 걸린 것이 없는지 확인합니다 ③ 문제가 없으면 ‘안전 문구로 대체’ 등으로 강화합니다" · 버튼 "규칙 추가" |
| **빈 상태**(읽기 전용) | "만들어진 규칙이 없습니다." (버튼 없음) |
| **성공** | §4.2 |
| **오류**(조회 실패) | `ErrorState`("규칙 목록을 불러오지 못했습니다") + "다시 시도" |
| **권한 없음** | `ForbiddenState` |
| **기능 꺼짐** | §3.2 서버 꺼짐 배너(화면은 정상 사용 가능) |
| **한도 도달** | `meta.limits.usedRules >= maxRules` → "규칙 추가" 버튼 `aria-disabled` + 이유 글자 "규칙은 챗봇당 최대 {max}개입니다({used}/{max}). 쓰지 않는 규칙을 삭제한 뒤 추가해 주세요." (`aria-describedby`) · 표현 총합이 한도에 가까우면(≥90%) 머리에 "표현 {n}/{max}" 옆 "한도에 가깝습니다" 글자 병기 |
| **삭제 진행** | 확인 대화상자의 "삭제" 버튼 `disabled`(스피너 글자 "삭제하는 중…") |

### 4.5 삭제 확인(`ConfirmDialog`, `danger`, 기본 포커스 = 취소)

- 제목 "규칙 삭제" · 본문 "‘{이름}’ 규칙을 삭제할까요? 삭제하면 **바로 적용이 멈추고**, 지금까지 걸린 기록은 남습니다. 되돌릴 수 없습니다." · 버튼 "삭제" / "취소".
- 성공: 행 제거 + 토스트 "‘{이름}’ 규칙을 삭제했습니다." + 알림 영역 1회. 포커스는 **표 머리 `<h1>`(tabIndex=-1)**로(행이 사라져 포커스를 잃지 않게). 실패: `NOT_FOUND`("이미 삭제된 규칙입니다. 목록을 새로 불러왔습니다." → reload) · `CHATBOT_ARCHIVED` · 기타 `ApiError.message`.

### 4.6 컴포넌트 분해 · 데이터 바인딩

| 컴포넌트 | 바인딩 |
|---|---|
| `GuardrailRuleListPage` | Outlet context(`rules`·`meta`) — `GET …/rules` |
| `GuardrailRuleTable` | `rules[]`(`GuardrailRule`: id·name·category·appliesTo·action·enabled·sortOrder·expressionCount·replacementBannedHit·recentHits7d·updatedByEmail) |
| 사용 스위치 | `POST …/rules/:id/enable|disable` → 갱신된 `GuardrailRule` |
| 이동 | `POST …/rules/:id/move {direction}` → `GuardrailRule[]`(전체 재정렬본) |
| 삭제 | `DELETE …/rules/:id` → 204 |
| 모바일 카드 | 같은 데이터 · 이름을 카드 제목 · 나머지는 `dl` |

---

## 5. 화면 GR-2 — 규칙 만들기 / 고치기

### 5.1 목적

규칙 1개를 만들거나 고친다. **저장 전에** 오른쪽(모바일은 아래) 시험하기 패널에서 편집 중인 내용을 문장으로 시험할 수 있다.

### 5.2 레이아웃(데스크톱 2열)

```
위험 응답 규칙 > 규칙 만들기                                  (편집이면 "규칙 고치기 — 투자 권유")

┌ 규칙 내용 ───────────────────────────────┐  ┌ 문장으로 시험하기 ─────────────────────┐
│ 이름 (필수)                                │  │ (§5.5 GuardrailTestPanel)              │
│ [                              ] 0/50      │  │  시험 대상 규칙                        │
│                                            │  │   ◉ 지금 편집 중인 내용(저장 전)        │
│ 분류 (필수)                                │  │   ○ 저장된 규칙만                      │
│ [ 분류를 선택하세요            ▾]          │  │  시험할 문장 [                    ]    │
│                                            │  │  위치 ◉ 사용자 질문 ○ AI 답변           │
│ 적용 위치 (필수)                           │  │  [시험하기]                             │
│  ○ 사용자 질문(들어오는 말)                 │  │  ─ 결과(aria-live) ─                   │
│  ○ AI 답변(나가는 말)                       │  └────────────────────────────────────────┘
│  ○ 둘 다                                    │
│                                            │
│ 동작 (필수)                                │
│  ◉ 기록만  ○ 안전 문구로 대체               │
│  ○ AI로 보내지 않음  ← (사용자 질문일 때만)  │
│  ⓘ 처음에는 ‘기록만’으로 두고 …             │
│                                            │
│ 찾을 표현 (필수, 1~100개)   6/100개         │
│ [            ][추가]                       │
│ (칩 목록: 수익 보장 ×  원금 보장 × …)        │
│                                            │
│ 찾는 방식 (필수)                           │
│  ◉ 표현이 들어 있으면 걸림(포함)             │
│  ○ 표현이 한 단어로 정확히 있을 때만(단어 일치) │
│                                            │
│ 대체 문구 (동작이 ‘안전 문구로 대체’일 때 필수)  │
│ [                                 ] 0/300   │
│                                            │
│ ☑ 저장하면 바로 사용                        │
│                                            │
│ [저장] [취소]                     ([삭제])   │
└────────────────────────────────────────────┘
```

### 5.3 필드 명세

| 필드 | 컨트롤 · 레이블 | 규칙 |
|---|---|---|
| 이름 | `<input type="text">` 레이블 "이름" + 필수 표시 · `maxLength=50` · 글자 수 "0/50"(실시간 남은 글자) | 1~50자 · 챗봇 안에서 유일(서버 `DUPLICATE_NAME`) |
| 분류 | `<select>` 레이블 "분류" · 첫 옵션 "분류를 선택하세요"(**사전 선택 금지**, UIUX §6) · 8종은 `GUARDRAIL_CATEGORY_LABELS` | 필수 |
| 적용 위치 | 라디오 3 `fieldset` + `legend` "적용 위치" · **사전 선택 없음**(설계서 §4.1 "필수, 기본값 없음") | 각 라벨에 괄호 설명 "(들어오는 말)"/"(나가는 말)" · 도움말: "‘AI 답변’은 문서 기반 AI 답변에만 적용됩니다. 관리자가 직접 쓴 답변에는 적용되지 않습니다." |
| 동작 | 라디오 3 `fieldset` + `legend` "동작" · **기본 "기록만"**(PM 확정 — 새 규칙 기본) | 안내 "처음에는 ‘기록만’으로 두고, ‘걸린 기록’에서 잘못 걸린 것이 없는지 확인한 뒤 강화하세요." |
| └ AI로 보내지 않음 | 적용 위치가 "사용자 질문"이 아니면 **`aria-disabled="true"`(포커스 가능) + 이유 글자** "‘AI로 보내지 않음’은 ‘사용자 질문’에만 쓸 수 있습니다. 적용 위치를 ‘사용자 질문’으로 바꾸면 선택할 수 있습니다."(`aria-describedby`) | `BOTH`도 불가(서버 검증 동일) |
| └ 자동 되돌림 | 이미 "AI로 보내지 않음"을 골랐다가 적용 위치를 다른 값으로 바꾸면 동작을 "기록만"으로 되돌리고 알림 영역에 "적용 위치가 바뀌어 동작을 ‘기록만’으로 되돌렸습니다." 1회 낭독 | |
| 찾을 표현 | `ExpressionListEditor` = `ChipListEditor` 래퍼 · 레이블 "찾을 표현" · 안내 "한 번에 하나씩 적고 Enter 또는 ‘추가’를 누르세요. 여러 줄을 붙여넣으면 줄마다 하나씩 추가됩니다." · 개수 "n/100개" · 정규식·와일드카드는 쓸 수 없음 | 각 표현 1~50자, 앞뒤 공백을 지운 뒤 공백·대소문자 정리 기준 **2글자 이상**. 같은 표현은 하나로 합쳐짐(서버). 붙여넣기 제한 금지(UIUX §5) — 줄바꿈이 있으면 분할 추가(**`ChipListEditor` 선택 prop `splitPastedLines` 추가 요청**) |
| 찾는 방식 | 라디오 2 `fieldset` · **기본 "포함"**(`CONTAINS`) | "단어 일치"(`EXACT`)는 **공백이 없는 한 단어 표현**만. 표현에 공백이 있으면 표현 목록 아래 인라인 오류 "‘단어 일치’는 띄어쓰기 없는 한 단어 표현만 쓸 수 있습니다: ‘{표현}’" (제출 시 표시) |
| 대체 문구 | `<textarea>` 레이블 "대체 문구" · 필수 표시는 **동작이 대체일 때만** · `maxLength=300` · "n/300" 실시간 · 줄바꿈 최대 5줄 | 동작이 대체가 아니면 `disabled` + 힌트 "동작이 ‘안전 문구로 대체’일 때만 적습니다."(값은 화면에서 유지 — 저장 시 서버가 버림). 안내: "링크(http…)나 HTML 태그는 쓸 수 없고 글자만 적을 수 있습니다. 저장할 때 금지어 검사를 합니다." |
| └ 위젯 안내(D-4) | 적용 위치가 `OUTBOUND`/`BOTH` ∧ 동작이 대체일 때 필드 아래 `field-hint`: "AI 답변이 이 문구로 바뀔 때 대화창에는 이 문구와 함께 ‘지금은 답변을 준비하지 못했어요.’ 같은 안내가 같이 보일 수 있습니다(대화창 표시 방식). 상담이 켜진 챗봇이면 상담 연결 안내도 이어서 나옵니다." | 설계서 K-5·D-4 — 위젯 변경 없음, 관리자에게만 안내 |
| └ 입구 대체 안내 | 적용 위치가 `INBOUND`/`BOTH` ∧ 동작이 대체 | "이 문구는 AI에게 묻지 않고 **바로** 나갑니다. 위기·상담 안내가 필요하면 관리자가 확인한 기관 정보를 적으세요. 같은 질문을 반복하면 매번 이 문구가 나가고 ‘미응답’으로 세어집니다." |
| 사용 | 체크박스 "저장하면 바로 사용" · 기본 켬 | 끄면 저장만 되고 적용은 안 됨 |

### 5.4 검증 · 오류(UIUX §7 — 제출 시점 표시, 입력 중 팝업 없음)

- **입력 중에는 오류 팝업을 띄우지 않는다.** 표현 추가 시 개별 검증(2글자 미만·50자 초과·중복)만 `ChipListEditor`의 인라인 `validate`로 즉시 표시(그 필드 안).
- **제출 시 사전 검사**: 이름 비어 있음 · 분류 미선택 · 적용 위치 미선택 · 표현 0개 · 대체 동작인데 문구 비어 있음 → 각 필드 아래 `InlineFieldError`(`role="alert"`) + 첫 오류 필드로 포커스 이동. 서버를 부르지 않는다.
- **서버 오류 → 필드 매핑**(`400 VALIDATION_FAILED`의 `details[].field`·메시지 코드):

| 서버 신호 | 표시 위치 | 문구 |
|---|---|---|
| `name` 관련 | 이름 | "이름을 1~50자로 적어 주세요." |
| `expressions.<i>` + `TOO_SHORT` | 표현 목록(해당 칩 강조 + 목록 아래) | "‘{표현}’은 너무 짧습니다. 2글자 이상으로 적어 주세요. 너무 짧은 말은 정상 문장에도 자주 걸립니다." |
| `expressions.<i>` + `EXACT_MULTI_TOKEN` | 표현 목록 | "‘단어 일치’는 띄어쓰기 없는 한 단어 표현만 쓸 수 있습니다: ‘{표현}’" |
| `replacementText` + `NOT_PLAIN_TEXT` | 대체 문구 | "링크나 HTML 태그는 쓸 수 없습니다. 글자만 적어 주세요." |
| `action` + NO_RAG 교차 오류 | 동작 | "‘AI로 보내지 않음’은 ‘사용자 질문’에만 쓸 수 있습니다." |
| `409 DUPLICATE_NAME` | 이름 | "같은 이름의 규칙이 이미 있습니다. 다른 이름을 적어 주세요." |
| `400 BANNED_WORD_BLOCKED`(`details`에 걸린 단어 — 관리자 화면 전용) | 대체 문구 | "대체 문구에 금지어({단어 목록})가 들어 있어 저장할 수 없습니다. 문구를 고쳐 주세요." |
| `409 LIMIT_EXCEEDED` | 폼 상단 배너 | "규칙 수 또는 표현 수가 한도를 넘었습니다. 쓰지 않는 규칙이나 표현을 정리한 뒤 다시 저장해 주세요." |
| `409 CHATBOT_ARCHIVED` | 폼 상단 배너 | "보관된 챗봇은 규칙을 바꿀 수 없습니다." |
| `404 NOT_FOUND`(고치기 중 다른 관리자가 삭제) | 폼 상단 배너 + "목록으로" | "이 규칙을 찾을 수 없습니다. 다른 관리자가 삭제했을 수 있습니다." |
| `401`(세션 만료) | 기존 `SessionExpiredModal` | 입력한 값은 **메모리에 유지**되고 재로그인 뒤 다시 저장한다(EX-AG-15 — 부분 저장 0) |

- **중복 표현**: 저장 성공 응답의 `expressionCount`가 입력 개수보다 적으면 토스트에 "겹치는 표현 {k}개는 하나로 합쳤습니다."를 덧붙인다(서버가 정규화 기준으로 합침).
- **성공**: 토스트 "규칙을 저장했습니다. 지금 바로 적용됩니다." → GR-1로 이동 · GR-1 `<h1>` 포커스 · 저장 버튼은 진행 중 `disabled`+"저장하는 중…"(더블클릭 방지).
- **이탈 보호**: 폼이 dirty면 `UnsavedGuardContext`에 등록해 TopBar·탭 이동 시 확인 대화상자.
- **삭제**(고치기 화면 하단, `canWrite`): GR-1과 같은 `ConfirmDialog`.

### 5.5 "문장으로 시험하기"(`GuardrailTestPanel`) — 금지어 시험하기 선례를 확장

- **목적**: 규칙이 실제로 어떻게 걸리는지 저장·기록 없이 본다. 저장 0 · 감사 0 · 걸린 기록 0(서버 규약 — 시험은 대화 기록을 남기지 않는다).
- **입력**:

| 필드 | 컨트롤 |
|---|---|
| 시험할 문장 | `<textarea>` 레이블 "시험할 문장" · `maxLength=2000` · "n/2000" · 여러 줄 허용(붙여넣기 허용) |
| 위치 | 라디오 "사용자 질문으로 시험" / "AI 답변으로 시험" · 기본 = 규칙 편집이면 규칙의 적용 위치(둘 다면 "사용자 질문"), 개인정보 가림 화면이면 "AI 답변"(고정·라디오 미렌더) |
| 시험 대상 규칙 | (GR-2에서만) 라디오 "지금 편집 중인 내용(저장 전)"(기본 — `draftRule`/`draftRuleId`) / "저장된 규칙만" |
| 버튼 | "시험하기"(`type="submit"`) — **입력 중 자동 실행하지 않는다**(요청 폭주·낭독 소음 방지). 진행 중 `disabled` + "시험하는 중…" |

- **"편집 중인 내용으로 시험"이 불가한 경우**(필수 항목 미입력 등 `400`): 결과 영역에 정보 문구 "규칙의 필수 항목을 채워야 저장 전 내용으로 시험할 수 있습니다. 또는 ‘저장된 규칙만’을 선택해 주세요."(오류 색을 쓰지 않는 `field-hint`).
- **결과**(`TestResultView` — `role="status" aria-live="polite" aria-atomic="true"` 영역 1개, 새 시험마다 내용 교체):

| 서버 `result` | 결과 배지(글자) | 부가 |
|---|---|---|
| `PASS` | "걸리지 않음 — 그대로 나갑니다" | 결과 문구 = 입력한 문장 그대로 |
| `MONITOR` | "기록만 — 규칙 {n}개가 걸렸고 답은 그대로 나갑니다" | 걸린 규칙 표 |
| `NO_RAG` | "AI로 보내지 않음 — 이 질문은 AI 답변으로 넘어가지 않습니다" | 엔진이 답하지 못하면 기본 안내로 끝남을 한 줄 안내 |
| `REPLACE` | "안전 문구로 대체 — 아래 문구가 나갑니다" | 결과 문구 |
| `MASKED` | "개인정보 {n}건을 가려서 나갑니다" | 종류별 건수 |
| `FALLBACK` | "AI 답변 대신 기본 안내 문구가 나갑니다(가리고 나니 남은 내용이 없음 등)" | |

  - **걸린 규칙 표**: 규칙 이름(분류) · 동작 · "이 규칙이 결과를 정했습니다"(`decisive`) · 걸린 표현(`matchedExpressions` — 관리자 화면 한정 표시). 규칙이 저장 전 규칙이면 이름 옆 "(저장 전)" 글자.
  - **결과 문구 상자**: 제목 "사용자에게 나가는 문구" + `resultText`(글자로만 렌더 · `white-space: pre-wrap`).
  - **가림 건수**: "주민등록번호 1건 · 카드번호 0건 · …"(0건 종류는 생략, 모두 0이면 줄 생략). **사용자 질문 위치로 시험하면 이 줄과 안내는 생략**하고 한 줄 안내 "사용자 질문에는 개인정보 가림을 적용하지 않습니다."
  - 상시 안내: "시험은 저장·기록을 남기지 않습니다."
- **접근성**: 결과 영역이 하나라 스크린리더는 시험마다 배지 문장 1회만 읽는다(표·상세는 사용자가 탐색). 포커스는 "시험하기" 버튼에 그대로 둔다.
- **오류**: `400`(문장 비어 있음 등 사전 검사 실패) → 문장 필드 인라인 "시험할 문장을 입력해 주세요." · 그 외 `ErrorState` 축약("시험하지 못했습니다") + "다시 시도".

### 5.6 상태별 UI

| 상태 | UI |
|---|---|
| **로딩**(고치기 — 기존 값 조회) | 폼 자리 `SkeletonCard` · `aria-busy` · 시험 패널은 미리 표시(저장된 규칙만 시험 가능) |
| **성공** | §5.2 |
| **오류**(조회 실패) | `ErrorState` + "목록으로" |
| **읽기 전용**(`security:write` 없음) | 모든 컨트롤 `disabled` 없이 **읽기 전용 문단 표시**(dl) + 시험하기만 사용 가능 |
| **보관 챗봇** | 읽기 전용 + `ArchivedBanner` |
| **저장 진행** | §5.4 |

### 5.7 컴포넌트 분해 · 데이터 바인딩

| 컴포넌트 | 바인딩 |
|---|---|
| `GuardrailRuleFormPage` | 고치기: `GET …/rules/:ruleId`(표현 전체) · 저장: 신규 `POST …/rules`(201) / 수정 `PUT …/rules/:ruleId`(전체 교체 — 생성과 같은 본문) |
| `RuleForm` 값 | `CreateGuardrailRuleSchema` 모양(name·category·expressions·matchType·appliesTo·action·replacementText·enabled) |
| `GuardrailTestPanel` | `POST …/test` `{ text, stage, draftRule?, draftRuleId?, draftPiiExit? }` → `GuardrailTestResponse` |

---

## 6. 화면 GR-3 — AI 답변 개인정보 가림 설정

### 6.1 목적 · 레이아웃

문서 기반 AI 답변에 주민등록번호·카드번호 같은 번호 형식이 있으면 **사용자에게 나가기 전에 가린다.** 어떤 종류를 가릴지 챗봇별로 정한다.

```
AI 답변 개인정보 가림
문서 기반 AI 답변에 아래 형식의 번호가 있으면 사용자에게 나가기 전에 가립니다.
(예: 주민등록번호 900101-1234567 → [주민등록번호])

ⓘ 현재: 기본 설정을 쓰고 있습니다(주민등록번호·카드번호를 가림).        ← 또는 "이 챗봇 전용 설정을 쓰고 있습니다"
(배너: AI 답변 미사용 — 해당 시)

가릴 번호 종류                                                      (fieldset + legend, 체크박스는 가나다순 · 수직 배치)
 ☐ 계좌번호
     ⚠ 숫자-숫자-숫자 형식이라 날짜(예: 2026-09-30)나 버전 번호도 계좌번호로 오인되어 가려질 수 있습니다.
     ☑ 날짜(연-월-일 형식)는 가리지 않기                  ← 계좌번호를 가릴 때만 의미가 있습니다
 ☐ 이메일 주소
     기관 문의 이메일 안내도 가려질 수 있습니다.
 ☐ 전화번호
     기관 대표번호·상담 전화 안내도 가려질 수 있습니다.
 ☑ 주민등록번호  [기본]
 ☑ 카드번호  [기본]
     14~16자리 연속 숫자(주문번호·고객번호 등)도 카드번호로 보고 가릴 수 있습니다.

ⓘ 가리는 강도(일부만 가릴지 전부 가릴지)는 서버의 개인정보 가림 설정을 따르며 이 화면에서 바꿀 수 없습니다.
ⓘ 형식이 정해진 번호만 가립니다. 이름·주소·병력 같은 정보는 가리지 못합니다.
   문서를 올리기 전에 민감한 정보를 정리해 주세요 — 이 기능이 그것을 대신하지 않습니다.

[저장]  [기본값으로 되돌리기]

▾ 문장으로 시험하기 (AI 답변 전용 · 편집 중인 설정으로 시험)          [예시 넣기]
```

### 6.2 필드 명세

| 요소 | 규칙 |
|---|---|
| 체크박스 순서 | **가나다순**(UIUX §6): 계좌번호 → 이메일 주소 → 전화번호 → 주민등록번호 → 카드번호. 기본 선택 종류에는 **글자 배지 "기본"**을 붙인다(정렬이 아니라 표식으로 알린다). 수직 배치 |
| 종류별 경고 | 계좌: **체크했을 때뿐 아니라 항상** 보이는 `field-hint` 경고(위 문구) + 체크 시 `role="status"`로 1회 "계좌번호 가림을 켰습니다. 날짜·번호가 가려질 수 있습니다." · 카드/전화/이메일: 항상 보이는 한 줄 힌트 |
| 날짜 보호 체크박스 | 레이블 "날짜(연-월-일 형식)는 가리지 않기" · 기본 켬 · **[2026-10-01 · ADR-0049 §4]** 켬이어도 `생년월일`·`생일`·`출생`·`탄생일`·`birth`·`birth date`·`DOB` 바로 뒤(구분 문자·`(양력)`류 주석을 사이에 둬도) 날짜는 가린다(계좌번호 켬일 때) — **레이블 문자열은 바꾸지 않는다**(`GuardrailPiiSettingsPage.spec.tsx`가 접근성 이름으로 찾음) · 필요하면 보조 설명(`aria-describedby`)만 추가(선택) · 계좌번호가 꺼져 있으면 **`aria-disabled` + 이유 "계좌번호를 가릴 때만 필요합니다."**(`aria-describedby`) — 값은 유지 |
| **거버넌스 하한** | 설정 응답 `governanceFloor`에 `RRN`·`CARD`가 있으면 그 두 체크박스는 **체크됨 + `aria-disabled` + 🔒 + 이유 글자** "거버넌스 모드에서는 끌 수 없습니다. 서버 설정으로만 바꿀 수 있습니다."(`aria-describedby`). 페이지 상단에 `DataGovernanceModeBanner`가 이미 있으면 재사용하지 않고 이 문구만 |
| 현재 상태 문구 | `isDefault` → "현재: **기본 설정**을 쓰고 있습니다(주민등록번호·카드번호를 가림). 이 기능은 기본으로 켜져 있습니다." (U-1 — 배포 즉시 적용된다는 사실을 알린다) · 아니면 "현재: **이 챗봇 전용 설정**을 쓰고 있습니다." |
| 저장 버튼 | "저장" · 변경이 없으면 `aria-disabled` · 진행 중 `disabled`+"저장하는 중…" |
| 기본값으로 되돌리기 | "기본값으로 되돌리기" — 폼 값을 `['RRN','CARD']` + 날짜 보호 켬으로 **채울 뿐** 저장은 별도(의도치 않은 즉시 저장 방지). 알림 영역 "기본값으로 채웠습니다. 저장을 눌러야 적용됩니다." |
| 강도·한계 안내 | 위 두 `ⓘ` 문구 상시(접지 않음) |

### 6.3 저장 확인(약화 저장 — `ConfirmDialog`, 기본 포커스 = 취소)

저장하려는 종류에 **주민등록번호 또는 카드번호가 없고**(이전 저장값에는 있었거나 기본값이라면), 확인 대화상자를 연다.

- 제목 "개인정보 가림 줄이기" · 본문 "‘{빠지는 종류}’ 가림을 끄면 AI 답변에 그 번호가 있어도 **그대로 사용자에게 나갑니다.** 계속할까요?"(모두 끄는 경우 "모든 가림을 끄면 …") · 버튼 "가림 줄이기 저장" / "취소".
- 종류를 늘리기만 하는 저장은 확인 없이 저장한다.

### 6.4 결과 · 오류

| 결과 | 문구 |
|---|---|
| 성공 | 토스트 "개인정보 가림 설정을 저장했습니다. 다음 AI 답변부터 적용됩니다." · 상태 문구 갱신 · 알림 영역 1회 |
| `400 VALIDATION_FAILED`(`GOVERNANCE_FLOOR`) | 폼 상단 배너 "거버넌스 모드에서는 주민등록번호·카드번호 가림을 끌 수 없습니다." + 설정을 다시 불러와 하한 잠금 반영 |
| `409 CHATBOT_ARCHIVED` | "보관된 챗봇은 설정을 바꿀 수 없습니다." |
| 조회 실패 | `ErrorState` "가림 설정을 불러오지 못했습니다" + "다시 시도" |

### 6.5 시험하기 결합

- 같은 페이지 하단에 `GuardrailTestPanel mode="pii"`. `draftPiiExit`에는 **저장 전 폼 값**을 실어 보낸다(`kinds`·`preserveDates`) — 저장하지 않고도 "이 설정이면 무엇이 가려지나"를 본다. 결과는 가림 건수·가려진 결과 문구를 보여 준다.
- **"예시 넣기" 버튼**: 시험 문장에 합성 예시를 채운다 — "주민등록번호는 900101-1234567, 결제 카드는 1234-5678-9012-3456, 신청 기한은 2026-09-30까지입니다." (가짜 번호 · 계좌를 켜고 날짜 보호를 끄면 날짜가 가려지는 것을 직접 확인할 수 있다)
- 시험 결과의 규칙 표는 이 화면에서는 숨긴다(개인정보 가림만 시험).

### 6.6 상태별 UI

| 상태 | UI |
|---|---|
| 로딩 | 체크박스 자리 `SkeletonCard` |
| 성공 | §6.1 |
| 오류 | `ErrorState` + 재시도 |
| 읽기 전용 | 체크박스 읽기 전용 표시(체크 상태만 글자 "가림"/"가리지 않음") · 저장·되돌리기 미렌더 |
| 기능 꺼짐(서버) | §3.2 배너 |
| AI 답변 미사용 | §3.2 배너(설정은 저장 가능) |
| 보관 | 읽기 전용 + 배너 |

### 6.7 바인딩

`GET …/settings` → `{ piiExit:{kinds, preserveDates}, isDefault, governanceFloor }` · `PUT …/settings` `{ piiExit:{kinds, preserveDates} }` · 종류 라벨은 shared-types `GuardrailPiiKind` 대응표(`RRN`=주민등록번호 · `CARD`=카드번호 · `ACCOUNT`=계좌번호 · `PHONE`=전화번호 · `EMAIL`=이메일 주소).

---

## 7. 화면 GR-4 — 현황

### 7.1 목적 · 레이아웃

기간 동안 규칙이 얼마나·어떻게 걸렸는지, AI 답변이 얼마나 바뀌었는지, 승인 없이 되돌린 기록이 있는지, 사람이 확인하는 절차가 무엇인지를 한 곳에서 본다. **이 화면의 수치는 기본 통계·통합 통계의 수치를 바꾸지 않는다**(설계서 §8.3).

```
현황                                                     [기간 선택: 오늘|7일|30일|직접]
(서버 꺼짐 배너 — 해당 시)

요약(카드 7)
 사용자 질문에서 걸림 │ AI 답변에서 걸림 │ 안전 문구로 바뀜 │ AI로 보내지 않음 │ 개인정보를 가린 AI 답변 │ 오류로 기본 안내 │ AI 답변 중 바뀐 비율
       12            │      8          │      5          │       2         │        14           │      0        │  11.5%
 ⓘ ‘걸림’은 규칙이 문장에서 표현을 찾은 횟수입니다. 한 문장에 여러 규칙이 걸리면 규칙마다 셉니다.
 ⓘ AI 답변 {전달} + {바뀜} + {오류} = {분모}건 중 {바뀜}건이 바뀌었습니다.

규칙별 걸림                                            (RuleHitTable)
 규칙(분류) │ 위치 │ 현재 동작 │ 걸린 횟수 │ 답이 바뀐 횟수 │ 기록만 횟수 │ [걸린 기록 보기]
 
개인정보 가림 종류별                                     (PiiCountTable)
 종류 │ 가린 건수

알림 — 승인 없이 되돌린 기록                             (SoloRollbackAlertList)

사람이 확인하는 절차                                     (HitlProcedureTable — §7.5)
```

- 기간: `PeriodSelector`(오늘·7일·30일·직접 입력). **최대 90일**. 90일을 넘기면 조회하지 않고 기간 필드 아래 인라인 "조회 기간은 최대 90일입니다."(서버 `400 STATS_RANGE_TOO_WIDE`도 같은 문구). 시작일이 종료일보다 늦으면 "시작일이 종료일보다 늦을 수 없습니다."(`INVALID_PERIOD`). 기간은 URL(`?from=&to=`).

### 7.2 요약 카드(`OverviewSummaryCards` · `MetricCard` 7)

| 카드 | 값 | 캡션(쉬운 말) |
|---|---|---|
| 사용자 질문에서 걸림 | 입구 걸림 합계 | "사용자 질문에서 규칙이 걸린 횟수" |
| AI 답변에서 걸림 | 출구 걸림 합계 | "AI 답변에서 규칙이 걸린 횟수" |
| 안전 문구로 바뀜 | 대체 적용 횟수 | "질문 또는 AI 답변이 안전 문구로 바뀐 횟수" |
| AI로 보내지 않음 | 해당 횟수 | "질문을 AI 답변으로 넘기지 않은 횟수" |
| 개인정보를 가린 AI 답변 | 가림 답 수 | "번호 형식을 가리고 나간 AI 답변 수" |
| 오류로 기본 안내 | 오류 폴백 수 | "검사 중 문제가 생겨 기본 안내 문구가 나간 횟수 — 0이 아니면 서버 관리자에게 알려 주세요" |
| AI 답변 중 바뀐 비율 | `replacedRatio`(백분율, 분모 0이면 "—") | "분모 = 전달된 AI 답변 + 안전 문구로 바뀐 답 + 오류로 기본 안내가 나간 답" |

- 값 옆에 **글자 레이블을 항상 병기**(색으로 좋고 나쁨을 전달하지 않음 — FR-2-13). 값이 0이어도 카드를 숨기지 않는다. 분모 0의 비율은 "—" + `aria-label`로 "해당 기간에 AI 답변이 없습니다".
- **카드 필드 이름은 shared-types `GuardrailOverviewSchema`를 따른다**(설계서 §8.4는 응답 개요만 기술 — 필드명은 구현 시 스키마에서 매핑, 이 문서는 개념·문구만 고정 — §17 조정 A-6).

### 7.3 규칙별 표 · 가림 종류별 표

- `RuleHitTable` 열: 규칙(이름·분류) · 적용 위치 · **현재 동작**(글자 배지) · 걸린 횟수 · **답이 바뀐 횟수**(`effect = CHANGED`) · 기록만 횟수. 표 아래 안내 "‘답이 바뀐 횟수’에는 ‘기록만’으로 걸린 것과, 이미 AI 답변으로 넘어가지 않았을 질문에 걸린 ‘AI로 보내지 않음’은 들어가지 않습니다."
- 삭제된 규칙은 이름 스냅샷 + "(삭제된 규칙)" 글자.
- 행 끝 "걸린 기록 보기" 링크 → `…/guardrails/events?ruleId=&from=&to=`(같은 기간). 삭제된 규칙은 링크 없음.
- `PiiCountTable`: 종류(주민등록번호 …) · 가린 건수. 없으면 "이 기간에 가린 번호가 없습니다."
- 표는 모바일에서 카드.

### 7.4 알림 — 승인 없이 되돌린 기록(`SoloRollbackAlertList`)

- 제목 "승인 없이 되돌린 기록" · 설명 "2인 승인이 켜진 챗봇에서도 **직전 운영 버전으로 되돌리기**는 긴급 복구를 위해 승인 없이 바로 실행됩니다. 아래 기록을 확인해 주세요."
- 행: 일시 · 실행자(이메일) · "v{현재} ← v{되돌린 버전}" · 링크 "전환 이력 보기"(`/chatbots/:id/environment`).
- 없으면 "이 기간에 승인 없이 되돌린 기록이 없습니다." — **`role="alert"`를 쓰지 않는다**(긴급 알림이 아니라 사후 확인용 정보 — 정적 섹션).

### 7.5 사람이 확인하는 절차 표(`HitlProcedureTable` — FR-AG4-6 · 설계서 §11 H-1~H-10)

- 제목 "사람이 확인하는 절차" · 안내 "AI가 만든 결과는 관리자가 확인한 뒤에만 챗봇에 반영됩니다. 아래는 이 제품에서 사람이 확인하는 자리입니다." **데이터 변경 없음**(읽기 전용 표).
- 열: 절차 · 사람이 확인하는 것 · 확인하는 사람 · 2인 승인 · 바로가기.

| 절차(H-#) | 사람이 확인하는 것 | 확인하는 사람(권한) | 2인 승인 | 바로가기(링크 — 권한 없으면 글자만) |
|---|---|---|---|---|
| H-1 AI 예문 후보 반영 | 만들어진 예문 후보를 골라 승인(한 번에 최대 50개) | 편집 권한 | 없음 | `/chatbots/:id/dialogue/intents` |
| H-2 발화 묶음 분석 반영 | 고른 발화만 확인 후 의도 예문으로 반영 | 편집 권한 | 없음 | `/chatbots/:id/stats/utterance-analyses` |
| H-3 미응답·👎 검토 큐 | 예문 반영 · "직접 수정 완료" · 무시 중에서 선택(AI 답변에 대한 👎 포함) | 편집 권한 | 없음 | `/chatbots/:id/stats/learning` |
| H-4 운영 전환 | 차이·경고·시험 기준 확인 후 확정 | 배포 권한 | **{켜짐 / 꺼짐 / 환경 분리 꺼짐}** — `hitl` 값을 글자로 | `/chatbots/:id/environment` |
| H-5 예약 운영 전환 | 미리보기·경고 확인 후 예약, 실행 시 시험 기준 재확인 | 배포 권한 | **{켜짐이면 "승인된 예약만 실행"}** | `/chatbots/:id/deploy-schedules` |
| H-6 버전 복원 | 복원 미리보기(차이·백업) 확인 후 확정 | 편집 권한 | 없음(운영에 바로 닿지 않음) | `/chatbots/:id/versions` |
| H-7 실시간 상담 개입 | 연속 미응답 경고 후 상담원이 개입 · AI 답변이 실패하거나 안전 문구로 바뀐 턴은 상담 연결 안내 | 상담 권한 | 해당 없음 | `/handoff-console/:id/live` |
| H-8 업무 자동화 발송 | 발송 대상 등록·원문 허용은 관리자, 실패 재발송은 관리자 | 관리자 | 범위 밖 | `/settings/workflow-automation` |
| H-9 지식베이스 첫 적재 | 첫 회 미리보기 확인 후 적재 승인 | 관리자 | 없음 | `/settings/kb-crawling`(기능이 꺼져 있으면 링크 미렌더) |
| H-10 AI 답변 | 답은 미리 승인할 수 없어(실시간) **위험 응답 규칙**으로 막고, 👎는 H-3로 모임 | 관리자 | 해당 없음 | `…/guardrails/rules` |

- "2인 승인" 셀은 **글자**로(예: "이 챗봇은 켜짐"·"이 챗봇은 꺼짐"·"환경 분리가 꺼져 있어 해당 없음"). 색 단독 금지. H-4·H-5만 챗봇별 값(`overview.hitl { envModeOn, approvalRequired }`)을 쓴다.
- 권한이 없는 링크는 `<a>`를 렌더하지 않고 글자만 둔다(F-4).
- 관리자용 문서 링크(도움말): 표 아래에 "자세한 내용은 운영 가이드의 ‘사람이 확인하는 절차’를 참고하세요." 텍스트(콘솔에 문서 뷰어가 없어 문서 파일 경로를 화면에 노출하지 않는다 — 문서 근거는 `docs/02-spec/ai-guardrails-설계.md` §11, 구현자용 메모).

### 7.6 상태별 UI

| 상태 | UI |
|---|---|
| **로딩** | 카드 자리 `SkeletonCard` 7 · 표 `SkeletonRow` 3 · `aria-busy`. 절차 표는 정적이라 즉시 표시(`hitl` 값 셀만 "확인 중") |
| **빈 상태**(기간 내 걸림 0) | 카드는 0으로 표시 + `EmptyState`(표 자리) "이 기간에 규칙이 걸린 기록이 없습니다." · 규칙이 0개면 추가 설명 "아직 규칙이 없습니다." + 링크 "규칙 만들기" |
| **오류** | `ErrorState`("현황을 불러오지 못했습니다") + 재시도. 절차 표는 표시 유지 |
| **권한 없음** | `ForbiddenState` |
| **기능 꺼짐** | §3.2 배너 + "새로 걸린 기록이 쌓이지 않습니다." 한 줄 |

### 7.7 바인딩

`GET …/overview?from=&to=` → `GuardrailOverview`(합계 · 규칙별 행 · 개인정보 종류별 · AI 답변 `{delivered, replaced, masked, fallbackOnError, replacedRatio}` · 알림 목록 · `hitl`). 규칙별·종류별·알림은 서버 집계 그대로 표시하고 클라이언트에서 합계를 다시 계산하지 않는다(합계 = 이벤트 합 — AC-AG5-2).

---

## 8. 화면 GR-5 — 걸린 기록

### 8.1 목적 · 레이아웃

규칙이나 개인정보 가림이 실제로 적용된 **기록**(문장이 아니라 사실)을 보고, 필요하면 그 대화의 **가림 처리된 본문**을 펼쳐 잘못 걸린 것은 없는지 확인한다.

```
걸린 기록
<GovernanceViewAuditBanner visible={user.governanceModeOn}>   "이 화면 열람은 감사로그에 기록됩니다."(기존 문구 · 정적 문단)

필터: 기간(시작일~종료일) · 규칙 [전체 ▾] · 위치 [전체 ▾] · 처리 결과 [전체 ▾]        [필터 지우기]
<caption>걸린 기록 목록 — 총 {n}건</caption>
시각          위치        규칙 / 내용                         처리 결과           답 변화     대화
09-30 14:02  AI 답변     투자 권유(투자·재무 조언)            ⓘ 기록만            답 변화 없음  [대화 보기 ▸]
09-30 13:40  사용자 질문  위기 표현(위기·자해)                 ⚠ 안전 문구로 대체   답이 바뀜     [대화 보기 ▸]
09-30 13:12  AI 답변     개인정보 가림 — 주민등록번호 1건      개인정보 가림        답이 바뀜     [대화 보기 ▸]
09-30 12:55  AI 답변     검사 오류(원인: TimeoutError)         기본 안내 문구로 대체 답이 바뀜     [대화 보기 ▸]
   └(펼침) 사용자 질문(가림 처리본) … / 봇 응답(가림 처리본) …
(페이지네이션)
```

- 기간 **필수**(기본 최근 7일 · 최대 90일). 필터는 URL 쿼리와 동기화. 필터 변경 시 1페이지로.
- **규칙 필터**: 셸이 내려준 규칙 목록 + "전체". 삭제된 규칙은 규칙 목록에 없으므로 필터로 고를 수 없다(행에는 이름 스냅샷 + "(삭제된 규칙)").
- 필터 컨트롤은 전부 레이블 연결. 값 변경만으로 즉시 조회하지 않고 **"조회" 버튼**으로 적용한다(UIUX §6 "셀렉트 값 변경만으로 폼 자동 제출 금지"). 조회 결과 개수는 `caption`과 `role="status"`로 1회 안내("걸린 기록 {n}건").
- 행 종류별 "규칙 / 내용" 표시: `kind=RULE` → 규칙 이름 + 분류 · `kind=PII` → "개인정보 가림 — {종류} {건수}건" · `kind=ERROR` → "검사 오류 — 원인 코드: {errorCode}"(관리자용 짧은 코드 · 문장 아님).
- **대화 보기**(`EventRow`): `<button aria-expanded aria-controls>` "대화 보기". 펼치면 **추가 API 호출 없이**(목록 응답에 실려 온 본문) `ConversationMaskedView` 표시:
  - 소제목 "사용자 질문(개인정보 가림 처리본)" / "봇 응답(개인정보 가림 처리본)".
  - `textPurged` → "보존 기간이 지나 문장이 삭제되었습니다. 걸린 기록 수치만 남아 있습니다." · `conversation === null` → "연결된 대화 기록을 찾을 수 없습니다."
  - 상시 안내 1줄 "저장할 때 개인정보가 가려진 문장입니다. 규칙이 잘못 걸렸다면 규칙의 표현을 조정하세요."
  - **글자로만 렌더**(`dangerouslySetInnerHTML` 금지 · `white-space: pre-wrap`) — 사용자 입력에 HTML이 있어도 그대로 글자다.
  - 펼침 상태는 행 단위 · 페이지 이동 시 초기화 · 한 번에 여러 행을 펼칠 수 있다.
- **열람 감사 문구**: `GovernanceViewAuditBanner`(정적 문단 · `aria-live` 없음 — 기존 규약). 열람 감사는 이 **목록 조회 1회**가 기록되므로(펼침은 추가 호출 없음) 배너 문구 그대로 정확하다. 거버넌스 모드 OFF면 배너 미렌더.

### 8.2 상태별 UI

| 상태 | UI |
|---|---|
| **로딩** | 표 자리 `SkeletonRow` 5 · `aria-busy` |
| **빈 상태**(기간 내 0건, 필터 없음) | `EmptyState` "이 기간에 걸린 기록이 없습니다." + (규칙 0개면) 링크 "규칙 만들기" |
| **빈 상태**(필터 결과 0건) | "조건에 맞는 기록이 없습니다" + "필터 지우기" |
| **오류** | `ErrorState`("걸린 기록을 불러오지 못했습니다") + 재시도. 기간 오류(`400 STATS_RANGE_TOO_WIDE`/`INVALID_PERIOD`)는 기간 필드 인라인 |
| **권한 없음** | `ForbiddenState` |
| **기능 꺼짐** | §3.2 배너(과거 기록은 볼 수 있음) |

### 8.3 바인딩 · 반응형

`GET …/events?from=&to=&ruleId=&stage=&appliedAction=&page=&pageSize=`(기본 50 · 최대 100) → `Paginated<GuardrailEventItem>`(항목에 대화 마스킹본 동반). `Pagination` 재사용. 640px 미만은 카드 목록(`EventCard`).

---

## 9. 운영 전환 2인 승인 (AP-0 · AP-1 · AP-2 · EN-1 · SC-1)

### 9.1 개념 요약(화면이 알려야 하는 것)

| 항목 | 내용 |
|---|---|
| 무엇 | 환경 모드(스테이징/운영 분리)가 켜진 챗봇에서, **운영 전환**(즉시·예약)과 **직전 버전이 아닌 버전으로 되돌리기**는 요청한 사람이 아닌 **다른 관리자의 승인**이 있어야 실행된다 |
| 기본 | **꺼짐**. 켜려면 환경 모드가 켜져 있고 **활성 관리자가 2명 이상**이어야 한다 |
| 예외 | **직전 운영 버전으로 되돌리기**는 승인 없이 즉시(긴급 복구) — 기록·표식이 남고 "현황" 알림에 나온다 |
| 켜진 동안 | **환경 분리 끄기는 할 수 없다**(초안이 곧 라이브가 되어 승인이 무력화되므로) — 먼저 2인 승인을 꺼야 한다 |
| 만료 | 요청은 정한 시간(기본 24시간, 1~168) 안에 승인되지 않으면 만료된다. 예약 전환 요청은 **예약 시각까지만** 유효 |
| 대기 | 챗봇당 대기 요청은 **1건** |

### 9.2 환경 탭(AP-0) 배치 — 켜진 모드(`EnvironmentStatusPanel`) 위에서 아래로

```
환경 분리 (h1)                                   [환경 분리 끄기...]   ← 2인 승인 켜짐이면 aria-disabled + 사유
[ 초안 ] [ 스테이징 ] [ 운영 ]      (3카드: 스테이징 카드의 [운영 전환 …] 버튼 문구는 정책에 따라 §9.4)
예약된 전환 배너(기존)

┌ 승인 대기 요청 (제안 · 승인 전) ─────────────────────┐   ← ApprovalPendingCard (대기 요청이 있을 때만) — ProposalContainer
└─────────────────────────────────────────────────────┘
┌ 운영 전환 2인 승인 ─────────────────────────────────┐   ← ApprovalPolicyPanel (모드 켜짐일 때 항상)
└─────────────────────────────────────────────────────┘
게이트 요약 + GateSettingsPanel(기존)
전환 이력(기존 — 방식 셀에 표식 §9.11)
```

- 모드가 **꺼진** 환경 탭(`EnvironmentOffPanel`)에는 2인 승인 패널을 렌더하지 않는다. 대신 패널 하단에 한 줄 "환경 분리를 켠 뒤 ‘운영 전환 2인 승인’을 설정할 수 있습니다."(`field-hint`).
- 두 패널은 `useApprovalPolicy(chatbotId)` 결과 하나로 그린다. 환경 탭 진입·새로고침(`handleRefresh`)·정책/요청 변경 뒤 재조회.

### 9.3 2인 승인 설정 패널(`ApprovalPolicyPanel`)

```
운영 전환 2인 승인                                         (h2)
상태: ● 켜짐 — 요청한 뒤 24시간 안에 다른 관리자가 승인해야 합니다.        (또는 ○ 꺼짐)
ⓘ 켜면 운영 전환·예약 전환은 요청한 사람이 아닌 다른 관리자가 승인해야 실행됩니다.
  직전 운영 버전으로 되돌리기는 긴급 복구를 위해 승인 없이 바로 실행되고 기록이 남습니다.
  켜져 있는 동안에는 환경 분리를 끌 수 없습니다.
승인할 수 있는 다른 관리자: 2명

[ 켜짐 ●  ] (스위치)         [승인 유효 시간 변경…]        ← canDeploy에게만
⚠ (경고 상자 — 켜짐이고 다른 승인 가능 관리자 0명일 때)
```

| 요소 | 규칙 |
|---|---|
| 상태 글자 | "켜짐 — 요청한 뒤 {ttl}시간 안에 다른 관리자가 승인해야 합니다." / "꺼짐 — 운영 전환은 배포 권한이 있는 한 사람의 확인만으로 실행됩니다." (색 단독 금지 — ● / ○ + 글자) |
| 승인 가능자 수 | `otherApproverCount`(나 제외) → "승인할 수 있는 다른 관리자: {n}명" |
| **경고(EX-AG-12)** | 켜짐 ∧ `otherApproverCount === 0` → `form-banner--warning` ⚠ "**승인할 수 있는 다른 관리자가 없습니다.** 요청을 보내도 승인할 사람이 없습니다. 관리자를 추가하거나 2인 승인을 끄는 것을 검토해 주세요."(정보만 — 자동으로 끄지 않음) + `can('user:read')`이면 링크 "회원 관리" |
| 스위치 | `ChannelToggle` 일반화(§2.1) — `role="switch"` · "켜짐/꺼짐" 글자. 클릭 시 곧바로 바꾸지 않고 **대화상자**를 연다(켜기 → AP-0a · 끄기 → AP-0b) |
| 켜기 불가(`aria-disabled` + 사유 `aria-describedby`) | ① `eligibleApproverCount < 2` → "활성 상태의 관리자가 2명 이상이어야 켤 수 있습니다(지금 {n}명)." ② 챗봇 보관 → "보관된 챗봇은 바꿀 수 없습니다." (환경 모드가 꺼진 경우는 패널 자체가 없다) |
| 끄기 불가 | `offLocked` → "서버 설정으로 2인 승인 끄기가 잠겨 있습니다. 서버 관리자에게 문의해 주세요." (`aria-disabled` + 🔒) — ~~**거버넌스 모드와 무관**(R-9)~~ **[2026-10-01 · ADR-0049 §2]** `offLockedBy === 'GOVERNANCE_MODE'`이면 "데이터 거버넌스 모드에서는 2인 승인 끄기가 기본으로 잠겨 있습니다. 끄려면 서버 관리자에게 문의해 주세요." · 그 밖(`SERVER_SETTING`·필드 없음)은 위 기존 문구. 표시 방식(`aria-disabled` + 🔒 + 이유 텍스트) 동일. 켜기 확인 대화상자에 일반 문구 1문장 추가: "서버 설정에 따라 켠 뒤에는 끄지 못할 수 있습니다." |
| 승인 유효 시간 변경 | 켜짐일 때만 "승인 유효 시간 변경" 버튼 → 작은 인라인 폼(숫자 입력 1~168 · 레이블 "승인 유효 시간(시간)" · 저장) — **새 요청부터 적용**된다는 안내. `PUT …/approval {required:true, ttlHours}` |
| 읽기 전용 | `canDeploy` 없음(EDITOR·VIEWER) → 상태·승인 가능자·최근 요청만 글자로, 스위치·버튼 미렌더 |
| **최근 요청 표** | `ApprovalRecentTable`(최근 20건): 요청 시각 · 동작 · 대상 ← 기준 버전 · 요청자 · 결과(`ApprovalStatusText`) · 결정자. 없으면 "아직 승인 요청이 없습니다." 모바일 카드 |

**켜기 대화상자(AP-0a, `Modal`)**
- 제목 "운영 전환 2인 승인 켜기" · 본문 3문장(개념 요약 — 켜면 무엇이 달라지는지 · 되돌리기 예외 · 끄기 제한).
- 필드: 레이블 "승인 유효 시간(시간)" 숫자 입력 기본 24 · 범위 안내 "1~168시간" · 인라인 오류 "1~168 사이의 숫자를 입력해 주세요."(제출 시).
- 버튼: "취소"(**기본 포커스**) / "2인 승인 켜기". 진행 중 `disabled`+"켜는 중…".
- 결과 오류(`409 APPROVAL_POLICY_UNAVAILABLE`): `details.reason` → §13.2 표.
- 성공: 토스트 "운영 전환 2인 승인을 켰습니다." + 패널 갱신 + 알림 영역 1회.

**끄기 확인(AP-0b, `ConfirmDialog` danger, 기본 포커스 = 취소)**
- 제목 "운영 전환 2인 승인 끄기" · 본문 "끄면 운영 전환이 다시 **한 사람의 확인만으로** 실행됩니다. 승인을 기다리는 요청이 있으면 **취소**됩니다(자동으로 실행되지 않습니다)." + 대기 요청이 있으면 한 줄 "지금 대기 중인 요청 1건이 취소됩니다." · 버튼 "2인 승인 끄기" / "취소".
- 성공 토스트 "운영 전환 2인 승인을 껐습니다." (대기 요청이 있었으면 "대기 중이던 요청은 취소되었습니다.")

### 9.4 기존 전환 화면 보강(EN-1) — `ProdSwitchDialog` **요청 모드 / 단독 롤백 모드**

**원칙**: 새 대화상자를 만들지 않는다. 대화상자는 미리보기 응답의 `approval?`(`{ required: true, soloRollbackAllowed? }`)로 모드를 정한다(응답 키가 없으면 지금과 **바이트 동일**한 기존 동작).

| 상황 | 제목 | 안내(상단 `modal-banner--info`) | 확정 버튼 | 추가 컨트롤 |
|---|---|---|---|---|
| `kind=SWITCH` ∧ 정책 켜짐 | "운영 전환 승인 요청" | "이 챗봇은 운영 전환에 **다른 관리자의 승인**이 필요합니다. 요청을 보내면 승인될 때까지 운영은 **바뀌지 않습니다.** 요청은 {ttl}시간 안에 승인되지 않으면 만료됩니다." (`ttl` 미상이면 "정해진 시간 안에") | "v{n} 승인 요청 보내기" | 기존 경고 확인 체크·사유 입력 그대로(요청에 함께 전달) |
| `kind=ROLLBACK` ∧ 정책 켜짐 ∧ `soloRollbackAllowed` | "직전 버전으로 되돌리기" | `SeverityBadge WARNING "승인 예외"` + "직전 운영 버전으로 되돌리는 것은 긴급 복구를 위해 **승인 없이 바로** 실행됩니다. 실행 기록이 남고 ‘안전 가드레일 > 현황’의 알림에 표시됩니다." | "v{n}로 즉시 되돌리기(승인 없이)" | **필수 체크** "승인 없이 바로 실행됨을 이해했습니다"(미체크로 확정 → 인라인 오류 "체크해 주세요." — 단독 롤백 확인은 중첩 대화상자 대신 이 체크로 한다) + 보조 버튼 "대신 승인 요청 보내기"(`btn-secondary` — 즉시 되돌리지 않고 요청으로 진행) |
| `kind=ROLLBACK` ∧ 정책 켜짐 ∧ `!soloRollbackAllowed` | "되돌리기 승인 요청" | "직전 운영 버전이 **아닌** 버전으로 되돌리려면 다른 관리자의 승인이 필요합니다." | "v{n} 되돌리기 승인 요청 보내기" | 같음 |
| 정책 꺼짐(`approval` 키 없음) | 기존 그대로 | — | 기존 그대로 | — |

- **요청 모드 흐름**: 확정 버튼 → `POST …/environment/approval/requests`(`action` = `PROD_SWITCH`/`PROD_ROLLBACK`, `targetVersionId`, `expectedProdVersionId`, `acknowledgeWarnings?`, `reason?`) → 성공 시 대화상자 닫기 + 토스트 "승인 요청을 보냈습니다. 다른 관리자가 승인하면 운영에 반영됩니다." + `onRefresh` → 대기 카드 갱신. **포커스는 새로 생긴 대기 카드 제목(`tabIndex=-1`)으로 이동**(트리거 버튼이 문구를 바꾸며 사라질 수 있어 `Modal`의 포커스 복귀만으로는 유실 가능).
- **게이트 차단(`blockers`)**은 지금처럼 확정 버튼을 없애고 "확인" 버튼만 둔다(요청도 생성 불가 — 서버가 같은 blocker로 409).
- **롤백의 게이트 처리**: 기존 규약(롤백은 차단 게이트도 경고로만 취급) 그대로.

**스테이징 카드·롤백 버튼(`EnvironmentStatusPanel`)의 문구 보강**(정책 켜짐일 때만):

| 버튼 | 정책 꺼짐(기존) | 정책 켜짐 |
|---|---|---|
| 스테이징 카드 운영 전환 | "운영 전환 미리보기..." | "운영 전환 승인 요청..." |
| 스테이징 카드 예약 전환 | "예약 전환..." | "예약 전환 + 승인 요청..." |
| 운영 카드 되돌리기 | "직전 버전으로 되돌리기..." | 그대로 + 버튼 아래 `field-hint` "긴급 복구용 — 승인 없이 바로 실행되고 기록이 남습니다."(`aria-describedby`) |
| 이력 표 KebabMenu "이 버전으로 롤백..." | 그대로 | 그대로(대화상자가 직전 여부에 따라 즉시/요청 모드를 정한다) |

**409를 받았을 때(기존 화면이 정책을 모르고 열려 있던 경우)** — `ENV_APPROVAL_REQUIRED`(`details.reason = APPROVAL_REQUIRED`):
- 예: 다른 관리자가 정책을 켠 직후, 열려 있던 대화상자에서 "운영 전환"을 눌렀다.
- 처리: 대화상자 상단 `modal-banner--warning`(`role="status"`) "**방금 이 챗봇에 운영 전환 2인 승인이 켜졌습니다.** 이제 승인 요청으로 진행해야 합니다. 아래 ‘승인 요청 보내기’를 눌러 요청해 주세요." → **미리보기를 다시 조회**(응답에 `approval`이 생겨 요청 모드로 전환) · `reason`·경고 확인 체크는 유지(기존 `fetchPreview`가 이를 초기화하지 않는다) · 환경 상태·정책 재조회(`onRefresh` 없이 패널 갱신은 대화상자 닫을 때) — 한 번 더 확정 버튼을 눌러야 요청이 나간다(자동 요청 금지).
- `details.reason = POLICY_ACTIVE`(끄기): §9.9.

### 9.5 요청 상태 — 전부 **글자**(`ApprovalStatusText`, 색·아이콘 보조)

| status | outcome / closedReason | 화면 글자 | 톤(`SeverityBadge`) |
|---|---|---|---|
| `PENDING` | — | "승인 대기" | INFO |
| `APPROVED` | `APPLIED` | "승인됨 · 운영에 적용됨" | 성공(초록 + ✔ + 글자) |
| `APPROVED` | `SCHEDULED` | "승인됨 · 예약 시각에 전환 예정" | INFO |
| `APPROVED` | `SCHEDULED` + `executedAt` 있음 | "승인됨 · 예약 시각에 운영에 적용됨" | 성공 |
| `APPROVED` | `FAILED` (+ `failureCode`) | "승인됨 · 적용 실패({사유})" — §13.2 사유 표 | ERROR |
| `APPROVED` | `NOOP` | "승인됨 · 변경 없음(이미 같은 버전)" | INFO |
| `REJECTED` | — | "반려됨" (+ 메모 있으면 줄 아래 "사유: …") | 중립 |
| `CANCELLED` | `REQUESTER` | "요청자가 취소함" | 중립 |
| `CANCELLED` | `POLICY_OFF` | "2인 승인을 꺼서 취소됨" | 중립 |
| `CANCELLED` | `BASE_CHANGED` | "운영 버전이 바뀌어 종료됨" | WARNING |
| `CANCELLED` | `SCHEDULE_INACTIVE` | "예약이 취소·실행되어 종료됨" | 중립 |
| `EXPIRED` | — | "기한이 지나 만료됨" | WARNING |

- 대기 요청의 실시간 유효 상태(만료·기준 변경)는 **서버가 조회 시 판정·종결**한다(설계서 §10.3 지연 판정). 화면은 서버가 준 `status`만 믿고 자체로 만료를 판정해 바꾸지 않는다. 남은 시간 표시(`RemainingTimeText`)만 시계를 쓴다.

### 9.6 대기 요청 카드(`ApprovalPendingCard`) — 환경 탭

`ProposalContainer`(UIUX §1 제안-자산 분리)로 감싼다: **제목 "승인 대기 요청 (제안 · 승인 전)"** · 상시 안내 "승인될 때까지 운영 챗봇에는 아무 영향이 없습니다." (`ProposalContainer`의 `safetyNotice`).

```
승인 대기 요청 (제안 · 승인 전)        ⓘ 승인될 때까지 운영 챗봇에는 아무 영향이 없습니다.
 운영 전환 요청: v12(현재 운영) → v13                   [게이트: ✔ 충족]  경고 2건 · 바뀌는 항목 14개
 요청자 kim@example.com · 2026-09-30 14:02 요청
 만료: 23시간 12분 남음 · 2026-10-01 14:02 만료
 사유: "10월 안내문 교체"
 [자세히 보기 · 승인하기]      (다른 관리자)      /      ⓘ 본인이 요청한 건입니다 — 다른 관리자의 승인을 기다리는 중입니다. [요청 취소]   (요청자)
```

| 요소 | 규칙 |
|---|---|
| 동작 글자 | `PROD_SWITCH` "운영 전환 요청" · `PROD_ROLLBACK` "되돌리기 요청" · `SCHEDULED_PROD_SWITCH` "예약 전환 요청(예약 {일시})" |
| 요청자 | 이메일 · **`requestedBy.active === false`면 "(계정 비활성)"** 글자 병기 + `field-hint` "요청자 계정이 비활성이어도 요청은 그대로 승인할 수 있습니다."(EX-AG-11) |
| 게이트 | `GateResultBadge`(스냅샷 판정 — 승인 시 다시 평가된다는 설명은 AP-2에서) |
| 남은 시간 | `RemainingTimeText`: "{h}시간 {m}분 남음 · {만료 일시} 만료" — 1시간 미만 "{m}분 남음", **10분 미만이면 "곧 만료됩니다({m}분 남음)" + WARNING 글자 배지**. 분 단위로만 갱신(1분 타이머 · 화면 낭독 없음) |
| 버튼 | 다른 관리자(`canApprove`) → "자세히 보기 · 승인하기"(링크 → AP-2 — **목록에서 바로 승인하지 않고 반드시 상세에서 다시 확인**) · 요청자 → 안내 문장 + "요청 취소"(`canCancel` — §9.7) · `canDeploy` 없음 → 링크 "자세히 보기"만 |
| 만료 직전 새로고침 | 만료 시각이 지난 뒤에도 카드가 남아 있으면(서버 종결 전 화면) 남은 시간 자리에 "만료되었습니다. 새로 고치면 사라집니다." + 버튼 "새로 고침" — 자체로 카드를 지우지 않는다 |

### 9.7 요청 취소(AP-0c — `ConfirmDialog` danger, 기본 포커스 = 취소)

- 요청자만. 제목 "승인 요청 취소" · 본문 "‘{동작 요약}’ 요청을 취소할까요? 취소하면 운영은 바뀌지 않습니다." · 버튼 "요청 취소" / "닫기".
- 성공: 토스트 "승인 요청을 취소했습니다." + 카드 제거 + 포커스는 패널 제목으로. `409 APPROVAL_NOT_PENDING`(그 사이 승인·만료 등) → 알림 문구(§13.2) + 새로고침.

### 9.8 전역 승인 대기(AP-1) · 상세(AP-2)

**AP-1 `/environment-approvals`**

```
운영 전환 승인                                              [새로 고침]
ⓘ 운영 전환·되돌리기·예약 전환의 승인 요청입니다. 본인이 요청한 건은 다른 관리자가 승인합니다.
보기: (●) 승인 대기만  ( ) 전체(최근)                       ← 라디오 · 값 변경 후 "적용"
<caption>승인 요청 목록</caption>
챗봇  동작  대상 ← 기준  요청자  게이트  경고  만료까지  상태  내가 할 일  동작
```

- 열: 챗봇(이름 링크 → 환경 탭) · 동작 · 대상 ← 기준(예: `v13 ← v12`) · 요청자 · 게이트(`GateResultBadge` `showReason=false`) · 경고 수 · 만료까지(`RemainingTimeText` 짧은 형태) · 상태(`ApprovalStatusText`) · **내가 할 일**(`canApprove` → "승인하거나 반려할 수 있습니다" / 요청자 → "내가 요청한 건입니다" / 종결 → "—") · 동작("자세히 보기" 링크).
- 정렬은 서버 순서(변경 없음) · 정렬 버튼 없음. `Pagination`. 640px 미만 카드.
- 새로 고침 버튼 = 수동 재조회(폴링 없음 — 만료 종결은 조회 시 서버가 처리). TopBar 배지는 60초 간격 요약 폴링.
- 상태: 로딩 `SkeletonRow` 5 · **빈 상태** "승인을 기다리는 요청이 없습니다."(전체 보기면 "승인 요청 기록이 없습니다.") · 오류 `ErrorState`("승인 요청을 불러오지 못했습니다") · 권한 없음 `ForbiddenState`(메뉴 이름 "운영 전환 승인").
- 바인딩 `GET /environment-approvals?status=PENDING|ALL&page=` → `Paginated<ProdSwitchApprovalSummary>`(챗봇 이름·`canApprove` 포함).

**TopBar `ApprovalNavLink`**: `can('chatbot:deploy')`일 때만 렌더 · 텍스트 "승인 대기" + `pendingForMe > 0`이면 " (n)" · `GET /environment-approvals/summary` 60초 폴링(`visibilityState === 'visible'`일 때만 — `TopBar` 인박스 링크와 같은 방식) · 실패는 조용히 무시(링크는 숫자 없이 유지). 낭독 소음 방지를 위해 `aria-live` 없음.

**AP-2 `/environment-approvals/:chatbotId/:requestId`** — 승인자가 **지금 기준으로 다시 확인**하는 화면

```
운영 전환 승인 요청                                       ← 목록으로 / 환경 탭으로
상태: 승인 대기      만료: 23시간 12분 남음 · 2026-10-01 14:02 만료

요청 내용 (dl)
 챗봇       고객상담봇
 동작       운영 전환 요청
 대상       v13
 요청 시점 운영  v12
 요청자     kim@example.com(계정 비활성)   요청 2026-09-30 14:02
 사유       10월 안내문 교체
 (예약 전환이면) 예약 시각  2026-10-05 09:00 → 예약 배포에서 보기

지금 기준으로 다시 확인한 내용        ⓘ 승인하면 이 내용 기준으로 진행됩니다(요청 때 본 내용과 다를 수 있습니다).
 현재 운영 v12 → 대상 v13   [바뀌는 항목 14개]  (summaryLine)
 시험 기준: [GateResultBadge — 지금 다시 평가]
 경고 목록 ⚠ … (있으면) ☐ 위 경고를 확인했습니다   (미체크 승인 → 인라인 오류)
 (차단 사유가 있으면) ⚠ 차단 사유 목록 → 승인 버튼 aria-disabled + 이유

[승인하고 운영에 적용]  [반려…]          (다른 관리자)
ⓘ 본인이 요청한 건은 승인하거나 반려할 수 없습니다. 요청을 취소하려면 ‘요청 취소’를 누르세요.  [요청 취소]   (요청자 본인)
```

| 요소 | 규칙 |
|---|---|
| 승인 버튼 문구 | 즉시(`PROD_SWITCH`·`PROD_ROLLBACK`) "승인하고 운영에 적용" · 예약 "승인하기(예약 시각에 전환)" |
| **자기 요청** | 승인·반려 버튼을 **`aria-disabled="true"`(포커스 가능) + 이유 글자**(`aria-describedby`) "본인이 요청한 건은 승인하거나 반려할 수 없습니다. 다른 관리자에게 승인을 요청해 주세요."(서버도 403 — 방어) · "요청 취소" 버튼(요청자만) 표시 |
| 다시 확인 영역 | `livePreview`(대기일 때만 — `ProdSwitchPreviewResponse`): `summaryLine(diffSummary.rows)` · `GateResultBadge`(지금 재평가) · 경고(`SwitchWarningText`) · 차단(`SwitchBlockerText`) — `ProdSwitchDialog`의 렌더 로직을 재사용 |
| 경고 확인 | 경고가 있으면 체크 필수(`acknowledgeWarnings`) — 승인자가 본 적 없는 경고로 전환하지 않는다(설계서 R-20) |
| **차단 사유가 있을 때** | 승인 버튼 `aria-disabled` + 사유 글자 "지금 기준으로 {차단 사유}. 승인해도 적용되지 않습니다. 반려하거나, 시험을 다시 실행한 뒤 요청자에게 새로 요청하도록 안내하세요." — 반려는 계속 가능 |
| 종결 요청 | `livePreview === null` → "다시 확인" 영역 대신 종결 상태 안내(§9.5 문구) + 결과 요약. 승인·반려 버튼 미렌더 |
| 승인 최종 확인(AP-2a, `ConfirmDialog`, 기본 포커스 = 취소) | 즉시: "v13을 운영에 바로 적용합니다. 계속할까요?" · 예약: "예약 시각({일시})에 v13로 전환되도록 승인합니다. 승인 시점에는 운영이 바뀌지 않습니다." · 버튼 "승인" / "취소". 진행 중 "승인하는 중…" `disabled` |
| 반려(AP-2b, `Modal`) | 제목 "승인 요청 반려" · 필드 "반려 사유(선택)" `<textarea>` 200자 + 남은 글자 · 안내 "사유는 요청자가 볼 수 있습니다. 개인정보는 적지 마세요." · 버튼 "취소"(**기본 포커스** — 확인 대화상자 규칙 일관) / "반려하기"(danger) |
| 요청 취소 | §9.7 |
| 결과 표시 | 승인 성공(APPLIED) → 페이지 상단 `form-banner--info`(`role="status"`) "v13을 운영에 적용했습니다." + 상태 갱신 + 포커스를 상태 제목(`tabIndex=-1`)으로. 예약 승인 성공 → "승인했습니다. {일시}에 전환됩니다." 반려 성공 → "반려했습니다." 실패 → §13.2 |
| 링크 | 챗봇 이름 → 환경 탭 · 예약이면 "예약 배포에서 보기 →" `/chatbots/:id/deploy-schedules/:scheduleId` |
| 요청자 비활성 | EX-AG-11 문구 |

- 상태: 로딩 `SkeletonCard` 3 · **없음/삭제**(`404`) `EmptyState` "이 승인 요청을 찾을 수 없습니다." + "목록으로" · 오류 `ErrorState` · 권한 없음 `ForbiddenState`.
- **경합·만료 처리**: 화면이 열려 있는 동안 서버 상태가 바뀔 수 있다(만료·다른 관리자의 승인). 승인·반려·취소 응답이 `409 APPROVAL_NOT_PENDING`이면 서버 `details.status`에 맞는 문구(§13.2)를 페이지 배너로 보이고 **상세를 다시 조회**해 종결 상태를 그린다.

### 9.9 환경 모드 끄기 — 2인 승인 켜진 동안 거부 안내

| 위치 | 처리 |
|---|---|
| `EnvironmentStatusPanel`의 "환경 분리 끄기..." 버튼 | 정책 켜짐이면 **`aria-disabled="true"`(포커스 가능) + 🔒 + 사유 글자**(버튼 아래 `field-hint`, `aria-describedby`): "운영 전환 2인 승인이 켜져 있어 환경 분리를 끌 수 없습니다. 먼저 아래 ‘운영 전환 2인 승인’을 끄세요." + 링크 "2인 승인 설정으로 이동"(같은 페이지 `#approval-policy` — 패널 제목으로 포커스). 클릭해도 대화상자를 열지 않는다 |
| `EnvironmentDisableDialog`(방어) | ① 미리보기 응답에 `approvalPolicyActive === true`이면 본문 대신 `modal-banner--warning` 위 문구와 "확인" 버튼만(확정 버튼 미렌더). ② 확정 시 `409 ENV_APPROVAL_REQUIRED`(`details.reason = POLICY_ACTIVE`)를 받으면 같은 문구를 `modal-banner--error`로 표시하고 확정 버튼을 없앤다(정책이 그 사이에 켜진 경우) |

### 9.10 예약 전환(SC-1)의 승인 요청 · `APPROVAL_MISSING` 실패 안내

**예약 생성 흐름(정책 켜짐 ∧ `SWITCH_PROD_VERSION`)** — 예약 생성 API는 그대로이고 콘솔이 **이어서** 승인 요청을 보낸다(설계서 R-6·§10.7):

```
[예약 + 승인 요청] 클릭
  1) POST …/deploy-schedules (예약 생성)              ── 실패 → 기존 오류 처리(요청은 보내지 않음)
  2) POST …/environment/approval/requests {SCHEDULED_PROD_SWITCH, deployScheduleId, reason?}
       ├─ 성공 → 대화상자 닫기 · 토스트 "예약을 만들고 승인 요청을 보냈습니다. 승인되어야 예약 시각에 전환됩니다."
       └─ 실패 → 대화상자를 닫지 않고 결과 화면으로 전환(아래)
```

- 정책 여부는 `useApprovalPolicy`(다이얼로그가 `SWITCH_PROD_VERSION`을 고르면 1회 조회)로 안다. 정책 켜짐이면: ① 대화상자 상단 `modal-banner--info` "이 챗봇은 운영 전환에 2인 승인이 켜져 있습니다. 예약을 만들면 **승인 요청도 함께 보냅니다.** 승인되지 않으면 예약 시각에 전환되지 않습니다(운영은 바뀌지 않고 ‘승인 없음’으로 끝납니다)." ② 확정 버튼 문구 "{일시} · v{n} 예약 + 승인 요청" ③ 제목 그대로.
- **요청자 = 예약 작성자**: 이 흐름에서 자동으로 성립. 예약을 만든 사람만 요청할 수 있다.
- **2단계 실패(예약은 만들어졌고 요청이 실패)** — 결과 화면(대화상자 안): "예약은 만들어졌지만 **승인 요청을 보내지 못했습니다.** 승인 요청이 없으면 예약 시각에 전환되지 않습니다." + 사유(§13.2 — `APPROVAL_PENDING_EXISTS` "이 챗봇에는 이미 승인을 기다리는 요청이 있습니다. 그 요청을 먼저 처리해 주세요."(챗봇당 대기 1건) 등) + 버튼 "예약 배포에서 보기"(링크) / "닫기". 예약 목록 행에 "승인 요청 필요" 버튼이 남는다.
- **예약 목록(`DeployScheduleRow`)·상세(`DeployScheduleDetailPage`) 보강**(**챗봇 스코프 목록 S1·상세 S2만**): `SWITCH_PROD_VERSION` ∧ 정책 켜짐인 행에 `ScheduleApprovalStatusText` — `useApprovalPolicy`의 `pending`·`recent`에서 `deployScheduleId`로 매칭:

| 매칭 결과 | 행 글자 | 행 버튼 |
|---|---|---|
| 대기 요청 있음 | "승인 대기(만료 {일시})" | "승인 요청 보기"(→ AP-2) |
| 승인됨(`SCHEDULED`) | "승인됨 — 예약 시각에 전환됩니다" | — |
| 반려/취소/만료 | "승인 요청이 {반려됨/취소됨/만료됨}" | "승인 요청 다시 보내기"(작성자만) |
| 매칭 없음 ∧ 상태 `PENDING`/`HELD` | "**승인 요청 필요** — 승인 요청이 없으면 실행되지 않습니다" | "승인 요청 보내기"(작성자만 · 실패 시 §13.2) |
| 정책 꺼짐 | 글자 없음 | — |

  - 전역 목록(S4 `/settings/deploy-schedules`)은 챗봇마다 승인 조회를 하지 않으므로 **승인 상태 글자를 넣지 않는다**(§17 조정 A-7). 실패 사유 라벨만 표시.
  - `recent` 20건에 없는 오래된 요청은 매칭되지 않을 수 있다 → "승인 요청 필요"로 오해되지 않도록, 예약 시각이 아직 미래이고 `recent` 항목 수가 20이면(더 있을 수 있음) 문구를 "승인 상태를 확인할 수 없습니다 — 환경 탭에서 확인하세요"로 대체한다.
- **실패 사유 `APPROVAL_MISSING`**(예약 시각까지 승인 없음 → 실행 0):
  - 목록 행 `reasonText`: "승인 없음(2인 승인 필요)" — `MESSAGES.deploySchedules.reasons.failure.APPROVAL_MISSING`.
  - 상세 화면 사유 문단: "**승인이 없어 실행하지 않았습니다.** 이 챗봇은 운영 전환에 2인 승인이 필요한데, 예약 시각까지 다른 관리자의 승인이 없었습니다. 운영은 바뀌지 않았습니다. 새로 예약하고 승인 요청을 보내 주세요." — "확인 필요" 배지 · 기존 `retryButton`("지금 다시 예약") 유지(재예약 시 위 흐름이 다시 시작됨).
  - 체인 예약: 뒤 예약은 기존 규칙대로 `HELD(PREDECESSOR_FAILED)` — 기존 문구 그대로.
- **예약 재개(`resume`)로 기준이 바뀌면 기존 승인은 무효**(K-9) — 재개 대화상자에서 정책 켜짐이면 한 줄 "재개하면 예약 기준이 바뀌어 기존 승인이 무효가 될 수 있습니다. 재개 뒤 승인 상태를 확인하세요."(정보 문구).

### 9.11 전환 이력 표식(`EnvironmentHistoryTable`)

- 이력 항목의 `approvalMode`가 있으면 "방식" 셀에 글자 배지를 덧붙인다: `APPROVED` → `SeverityBadge INFO "2인 승인"` · `SOLO_ROLLBACK` → `SeverityBadge WARNING "승인 없이 되돌림"`. 표·모바일 카드 모두. 배지 뒤 `sr-only`는 필요 없다(글자가 배지에 있음).
- 승인된 전환의 "주체(실행자)"는 **승인자**다. 요청자 정보는 이력 응답에 없으므로 링크·표시를 만들지 않는다(요청자는 감사 로그 요약 접두 `[2인 승인 · 요청 …]`에 있다 — 필요하면 이력 관리 화면에서 확인).
- 이력 표의 KebabMenu·바이트 동일성: `approvalMode`가 없으면 기존과 같다.

---

## 10. 기존 화면 보강 — 시뮬레이터 · 데이터 지도 · 라벨

### 10.1 시뮬레이터(SM-1) — 입구 판정 안내 · AI 답변 미리보기

**배치 원칙**: `TracePanel`(판정 근거)은 기본 접힘이다. 이 정보는 "운영에서 실제로 무엇이 나가나"라서 **접힘 밖 — 봇 말풍선 바로 아래**에 둔다(`ChatMessageList`의 봇 메시지 항목).

**`GuardrailInboundNotice`(응답에 `guardrailInbound`가 있을 때만)** — `role="status"` 정적 블록(메시지 도착 시 1회 낭독)

| `guardrailInbound.action` | 문구 |
|---|---|
| `REPLACE` | "**운영에서는 이 질문에 ‘{규칙 이름}’ 규칙이 걸려, 대화 엔진과 AI 답변을 거치지 않고 아래 안전 문구가 나갑니다.** ‘{대체 문구}’ (이 시뮬레이터는 엔진의 원래 결과를 그대로 보여 줍니다.)" |
| `NO_RAG` | "**운영에서는 이 질문에 ‘{규칙 이름}’ 규칙이 걸려 AI 답변으로 넘어가지 않습니다.** 대화 엔진이 답하지 못하면 기본 안내 문구로 끝납니다." + (`useRag`가 켜져 있으면) "AI 답변 사용을 선택했지만 이 질문은 AI로 보내지 않았습니다." |
| `MONITOR` | "이 질문에 ‘{규칙 이름}’ 규칙이 걸렸지만 ‘기록만’이라 답은 그대로 나갑니다." |

- 규칙 이름이 여러 개면 쉼표로 이어 쓴다. `security:read`가 있으면 링크 "규칙 보기"(`…/guardrails/rules`).
- 시각 표시: `SeverityBadge`(REPLACE/NO_RAG=WARNING, MONITOR=INFO) + 글자. 색 단독 금지.

**`RagPreviewPanel`(`matchTrace.ragPreview`가 있을 때만)** — 봇 말풍선 아래, `GuardrailInboundNotice` 다음

```
AI 답변 미리보기 (운영에서 실제로 나가는 모습)
 결과: 안전 문구로 바뀌어 나갑니다 — ‘투자 권유’ 규칙
 운영에서 나가는 문구: "투자 판단은 고객님께서 직접 …"
 ▸ 원래 AI 답변 보기(개인정보는 저장할 때처럼 가려서 표시)      ← <details> · 대체·기본 안내일 때만
 가린 개인정보: 주민등록번호 1건
 ⓘ 시뮬레이터에서는 걸린 기록이 남지 않습니다.
```

| `outcome` | 결과 글자 |
|---|---|
| `PASS` | "그대로 나갑니다" |
| `MONITOR` | "그대로 나갑니다 — ‘{규칙 이름}’ 규칙이 걸렸지만 기록만입니다" |
| `MASKED` | "개인정보를 가려서 나갑니다" |
| `REPLACED` | "안전 문구로 바뀌어 나갑니다 — ‘{규칙 이름}’ 규칙" |
| `FALLBACK` | "AI 답변 대신 기본 안내 문구가 나갑니다" |

- `finalText`는 "운영에서 나가는 문구"로 글자 렌더. `originalMasked`(대체·기본 안내일 때만)는 `<details>`(기본 접힘 — `aria-expanded` 기본 동작)로 두고 안내 "관리자 화면에서도 개인정보 원문은 보여 주지 않습니다."
- `RagUsageToggle` 캡션에 한 줄 추가: "운영과 같은 위험 응답 규칙·개인정보 가림 결과도 함께 보여 줍니다."(기존 캡션 뒤에 붙임).
- `useRag`를 꺼서 RAG를 부르지 않으면 `ragPreview`가 없고 `GuardrailInboundNotice`만 나올 수 있다.
- 비교 보기(`CompareView`)·TC 실행은 이번 범위 밖(설계서 R-1 — TC 실행 표시 이월).

### 10.2 데이터 지도 "안전 가드레일" 절(DM-1)

`data.guardrails`가 있을 때만(`{data.guardrails && <GuardrailDataMapSection map={data.guardrails}/>}` — 키 없으면 절 미렌더 = 바이트 동일) `DataGovernanceMapPage`의 `utteranceAnalysis` 절 뒤에 추가.

| 항목 | 값 표시 |
|---|---|
| 제목 | "안전 가드레일(위험 응답 규칙·개인정보 가림·운영 전환 2인 승인)" |
| 규칙 | "규칙이 있는 챗봇 {n}개 · 규칙 {rules}개(사용 중 {enabledRules}개)" |
| 걸린 기록 | "걸린 기록 {events}건 — **문장은 저장하지 않고 규칙·횟수·시각만 남깁니다.**" (`eventsStoreText=false` 리터럴을 문장으로) |
| 외부 전송 | "이 기능이 새로 만드는 외부 전송 통로는 없습니다." (`exits: []`) |
| 가림 기본 | "AI 답변 개인정보 가림 기본 종류: 주민등록번호·카드번호 · 종류를 바꾼 챗봇 {n}개" |
| 2인 승인 | "운영 전환 2인 승인을 켠 챗봇 {n}개" |
| 서버 스위치 | "서버 스위치: {켜짐/꺼짐}" (글자 · `serverEnabled`) |

- 표(`dl`) 형태로 기존 절 스타일을 따른다. 링크 없음(챗봇 단위 화면은 챗봇 목록에서 진입).

### 10.3 라벨 상수(감사 로그·필터)

- 감사 대상 라벨: `GuardrailRule` = "위험 응답 규칙" · `ProdSwitchApprovalRequest` = "운영 전환 승인 요청" — shared-types 감사 대상 라벨 상수(설계서 §19.1)에 추가되고, 이력 관리 화면의 대상 종류 필터·표는 그 상수에서 파생되는지 구현 시 확인한다(콘솔에 별도 하드코딩 맵이 있으면 함께 갱신).
- 예약 실패 사유 라벨 `APPROVAL_MISSING` = "승인 없음"(shared-types) → 콘솔 `reasons.failure`는 §13.3의 더 긴 문구.

---

## 11. 상태 총정리(빈/로딩/오류/권한 없음/기능 꺼짐)

| 화면 | 로딩 | 빈 상태 | 오류 | 권한 없음 | 기능 꺼짐·잠금 |
|---|---|---|---|---|---|
| GR-0 셸 | 서브내비 + `SkeletonCard` 2 | — | `ErrorState`(서브탭은 자체 API라 계속 사용 가능) | `ForbiddenState` | 서버 꺼짐 배너 |
| GR-1 규칙 목록 | `SkeletonRow` 5 | 규칙 0개 안내(§4.4) | `ErrorState` + 재시도 | `ForbiddenState` | 서버 꺼짐 배너 · AI 답변 미사용 배너 · 한도 도달 |
| GR-2 편집 | `SkeletonCard` | — | `ErrorState`/404 배너 | `ForbiddenState`/읽기 전용 | 서버 꺼짐 배너 |
| GR-3 가림 설정 | `SkeletonCard` | — | `ErrorState` | 읽기 전용 | 서버 꺼짐·AI 답변 미사용 배너 · **거버넌스 하한 잠금** |
| GR-4 현황 | 카드·표 스켈레톤 | 걸림 0 안내 | `ErrorState`(절차 표 유지) | `ForbiddenState` | 서버 꺼짐 배너 |
| GR-5 걸린 기록 | `SkeletonRow` 5 | 0건 안내 | `ErrorState` | `ForbiddenState` | 서버 꺼짐 배너 |
| AP-0 환경 탭 승인 절 | `SkeletonCard`(패널 자리) — 정책 조회 실패 시 패널만 `ErrorState` 축약 + 재시도(**전환 대화상자는 서버 미리보기 응답 `approval`을 기준으로 하므로 패널 실패가 전환 흐름을 막지 않음**) | 최근 요청 0건 안내 | 패널 `ErrorState` | 읽기 전용 | **끄기 잠금**(`offLocked`)·**환경 분리 꺼짐**(패널 미렌더) |
| AP-1 목록 | `SkeletonRow` 5 | "승인을 기다리는 요청이 없습니다" | `ErrorState` | `ForbiddenState` | — |
| AP-2 상세 | `SkeletonCard` 3 | 404 안내 | `ErrorState` | `ForbiddenState` | — |
| EN-1 전환 대화상자 | 기존(`previewLoading`) | — | 기존(`loadFailed`) | 미렌더(`canDeploy`) | — |
| SM-1 | 기존 | 키 없음 = 미렌더 | 기존 | — | — |

- **"기능 꺼짐" 정의**: 이 기능은 서버 스위치(`GUARDRAILS_ENABLED=false`)가 꺼져도 관리 API가 동작한다(설계서 R-18) — 그래서 **404로 화면을 숨기지 않고 상시 배너**로 알린다(No.21/No.43의 404 숨김과 다르다). 2인 승인은 서버 스위치가 없다(끄기 잠금 `ENV_APPROVAL_OFF_LOCKED`만).

---

## 12. 사용자 인터랙션 흐름 종합 (제출 → 로딩 → 결과, 오류 포함)

### 12.1 규칙 만들기 → 시험 → 관찰 → 강화 (S-1·S-2)

```
GR-1 [규칙 추가] → GR-2 폼(동작 기본 "기록만")
  → (선택) 시험하기: 문장 입력 → [시험하기] → POST test(draftRule) → 결과 배지 낭독 → 규칙 표·결과 문구 확인
  → [저장] → 사전 검사 → POST rules → 성공: 토스트 + GR-1 이동 / 실패: 필드 인라인 오류(§5.4)
며칠 뒤 GR-4 현황: "투자 권유 — 걸림 12" → [걸린 기록 보기] → GR-5 → [대화 보기]로 잘못 걸린 것 확인
  → GR-2 수정: 동작을 "안전 문구로 대체" + 대체 문구 → 저장(감사 기록) → 즉시 적용
```

### 12.2 개인정보 가림 설정(S-6)

```
GR-3 진입 → GET settings → 상태 문구(기본/전용) → 종류 체크 변경 → (선택) 시험하기(draftPiiExit) → [저장]
  → 약화 저장이면 확인 대화상자 → PUT settings → 성공 토스트 / 거버넌스 하한 오류 배너
```

### 12.3 2인 승인 켜기 → 요청 → 승인 (S-7)

```
[관리자 A] 환경 탭 → 2인 승인 스위치 → AP-0a(만료 시간) → 켜기 → 패널 "켜짐"
[A] 스테이징 카드 "운영 전환 승인 요청..." → 대화상자(요청 모드) → 경고 확인·사유 → "승인 요청 보내기"
     → 대기 카드 표시(포커스 이동) · TopBar 배지는 관리자 B에게 (n)
[관리자 B] TopBar "승인 대기 (1)" → AP-1 → AP-2: 지금 기준 재확인(차이·게이트·경고) → 경고 확인 → [승인하고 운영에 적용]
     → AP-2a 확인(기본 포커스 취소) → POST approve → 성공: "v13을 운영에 적용했습니다"
     → 실패 분기: 기준 변경(409 BASE_CHANGED) · 이미 처리(409 NOT_PENDING) · 적용 실패(게이트 등) → §13.2
[A] 환경 탭 이력: "2인 승인" 배지
```

### 12.4 기타 경로

- **기존 전환 화면이 409**(§9.4) → 안내 배너 → 미리보기 재조회 → 요청 모드로 전환 → 다시 확정.
- **긴급 되돌리기**(S-8): 운영 카드 "직전 버전으로 되돌리기..." → 대화상자(단독 롤백 모드 — 체크 필수) → 즉시 실행 → 이력 "승인 없이 되돌림" → GR-4 알림에 표시.
- **예약 전환**(§9.10): 예약 + 요청 2단계 → 실패 시 예약 행 "승인 요청 필요" → 예약 시각까지 승인 없으면 `APPROVAL_MISSING`.
- **끄기 시도**(§9.9): 버튼 `aria-disabled` + 사유 → 정책 끄기 → 그다음에야 환경 분리 끄기 가능.
- **세션 만료 중 저장**: 전역 `SessionExpiredModal` → 재로그인 → 값 유지 상태에서 다시 저장(EX-AG-15). 승인 요청은 서버에 남는다(S-10).

---

## 13. API 호출 매핑 · 오류 코드 → 화면 문구

### 13.1 호출 매핑표

**가드레일(`/chatbots/:chatbotId/guardrails`) — 13개 핸들러**

| 메서드 · 경로 | 권한 | 사용하는 컴포넌트 · 시점 |
|---|---|---|
| `GET …/rules` | `security:read` | `GuardrailShell` — 셸 진입 1회 + 변경 후 `reload` |
| `POST …/rules` | `security:write` | `GuardrailRuleFormPage`(신규 저장) |
| `GET …/rules/:ruleId` | `security:read` | `GuardrailRuleFormPage`(고치기 진입) |
| `PUT …/rules/:ruleId` | `security:write` | 같은 페이지(수정 저장 — 전체 교체) |
| `DELETE …/rules/:ruleId` | `security:write` | GR-1·GR-2 삭제 확인 |
| `POST …/rules/:ruleId/enable`·`/disable` | `security:write` | GR-1 사용 스위치 |
| `POST …/rules/:ruleId/move` | `security:write` | GR-1 위/아래 버튼 |
| `POST …/test` | `security:read` | `GuardrailTestPanel`(GR-1·GR-2·GR-3) — 제출 시 |
| `GET …/settings` | `security:read` | GR-3 진입 |
| `PUT …/settings` | `security:write` | GR-3 저장 |
| `GET …/overview?from=&to=` | `security:read` | GR-4 — 진입·기간 변경 |
| `GET …/events?…` | `security:read`(+ VIEW 감사) | GR-5 — 조회 버튼·페이지 이동 |

**운영 전환 2인 승인**

| 메서드 · 경로 | 권한 | 사용하는 컴포넌트 · 시점 |
|---|---|---|
| `GET /chatbots/:id/environment/approval` | `chatbot:read`+`dialogue:read` | `useApprovalPolicy` — 환경 탭 진입·새로고침·변경 뒤 · 예약 대화상자(`SWITCH_PROD_VERSION` 선택 시) · 예약 목록/상세 |
| `PUT …/environment/approval` | `chatbot:deploy` | AP-0a 켜기 · AP-0b 끄기 · TTL 변경 |
| `POST …/environment/approval/requests` | `chatbot:deploy` | `ProdSwitchDialog` 요청 모드 · 예약 생성 뒤 자동 요청 · 예약 행 "승인 요청 보내기" |
| `GET …/environment/approval/requests/:requestId` | `chatbot:read`+`dialogue:read` | AP-2 진입(대기면 `livePreview` 동반) |
| `POST …/requests/:requestId/approve` | `chatbot:deploy` | AP-2a 확인 후 |
| `POST …/requests/:requestId/reject` | `chatbot:deploy` | AP-2b |
| `POST …/requests/:requestId/cancel` | `chatbot:deploy`(요청자만) | AP-0c · AP-2 "요청 취소" |
| `GET /environment-approvals?status=&page=` | `chatbot:deploy` | AP-1 |
| `GET /environment-approvals/summary` | `chatbot:deploy` | `ApprovalNavLink` 60초 |

**기존 API의 변화를 소비하는 곳**(요청 스키마 불변)

| 경로 | 소비 |
|---|---|
| `POST …/environment/prod/preview` → 응답 `approval?` | `ProdSwitchDialog` 모드 결정 |
| `POST …/environment/prod/switch|rollback` → `409 ENV_APPROVAL_REQUIRED` | `ProdSwitchDialog` 방어(§9.4) |
| `POST …/environment/disable/preview` → `approvalPolicyActive?` · `POST …/disable` → `409` | `EnvironmentDisableDialog` 방어(§9.9) |
| `GET …/environment/history` → 항목 `approvalMode?` | `EnvironmentHistoryTable` 표식 |
| `POST /chatbots/:id/simulate` → `guardrailInbound?` · `matchTrace.ragPreview?` | SM-1 |
| 예약 목록·상세 → `failureReason = APPROVAL_MISSING` | `DeployScheduleRow`·상세 |
| `GET /governance/map` → `guardrails?` | DM-1 |
| 공개 대화·보류 폴링 | **콘솔 무관**(스키마 불변) |

### 13.2 오류 코드 → 화면 문구

**2인 승인**

| 코드 · 조건 | 어디에 | 문구 |
|---|---|---|
| `409 ENV_APPROVAL_REQUIRED`(`APPROVAL_REQUIRED`) | 전환·되돌리기 대화상자 | "방금 이 챗봇에 운영 전환 2인 승인이 켜졌습니다. 이제 승인 요청으로 진행해야 합니다. 아래 ‘승인 요청 보내기’를 눌러 요청해 주세요."(`role="status"` — 미리보기 재조회) |
| `409 ENV_APPROVAL_REQUIRED`(`POLICY_ACTIVE`) | 끄기 대화상자 | "운영 전환 2인 승인이 켜져 있어 환경 분리를 끌 수 없습니다. 먼저 2인 승인을 꺼 주세요." |
| `403 APPROVAL_SELF_FORBIDDEN` | AP-2 배너 | "본인이 요청한 건은 승인하거나 반려할 수 없습니다. 다른 관리자에게 승인을 요청해 주세요." |
| `409 APPROVAL_NOT_PENDING` — `details.status = APPROVED` | AP-2·카드 | "이미 다른 관리자가 승인했습니다. 최신 상태를 불러왔습니다." |
| 〃 `REJECTED` | 〃 | "이미 반려된 요청입니다." |
| 〃 `CANCELLED` | 〃 | "이미 취소된 요청입니다." |
| 〃 `EXPIRED` | 〃 | "승인 기한이 지나 만료되었습니다. 필요하면 요청자에게 새로 요청하도록 안내해 주세요." |
| `409 APPROVAL_BASE_CHANGED` | AP-2 배너 | "요청한 뒤 운영 버전(또는 예약)이 바뀌어 이 요청은 종료되었습니다. 최신 상태에서 새로 요청해 주세요." |
| `409 APPROVAL_PENDING_EXISTS` | 요청 대화상자·예약 결과 | "이 챗봇에는 승인을 기다리는 요청이 이미 있습니다. 그 요청을 처리하거나 취소한 뒤 다시 요청해 주세요." + 링크 "대기 중인 요청 보기"(`details.requestId` → AP-2) |
| `409 APPROVAL_POLICY_UNAVAILABLE` — `ENV_MODE_DISABLED` | 켜기/요청 | "환경 분리가 꺼져 있어 2인 승인을 쓸 수 없습니다." |
| 〃 `NOT_ENOUGH_APPROVERS` | 켜기 | "활성 상태의 관리자가 2명 이상이어야 켤 수 있습니다." |
| 〃 `OFF_LOCKED` | 끄기 | "서버 설정으로 2인 승인 끄기가 잠겨 있습니다. 서버 관리자에게 문의해 주세요." |
| 〃 `NOT_REQUIRED` | 요청 | "이 챗봇은 2인 승인이 꺼져 있어 승인 요청이 필요하지 않습니다. 화면을 새로 불러왔습니다." |
| `400 VALIDATION_FAILED`(경고 미확인) | 승인·요청 | 기존 `acknowledgeError`("경고를 확인해 주세요" 계열) 필드 인라인 |
| `409 ENV_POINTER_STALE`(요청 생성 중) | 요청 대화상자 | 기존 `ENV_POINTER_STALE` 문구 + 미리보기 재조회 |
| `409 ENV_SWITCH_BUSY` | 요청·승인 | "잠시 후 다시 시도해 주세요."(대기 유지 — 자동 재시도 없음) |
| **승인 뒤 적용 실패** — `409 ENV_GATE_NOT_PASSED`(`details.requestStatus='APPROVED'`, `outcome='FAILED'`) | AP-2 배너 | "승인은 기록되었지만 **필수 시험 기준을 충족하지 못해 운영에 적용하지 못했습니다.** 운영은 바뀌지 않았습니다." |
| 〃 `ENV_TARGET_NOT_STAGING` | 〃 | "승인은 기록되었지만 대상 버전이 더 이상 전환 대상이 아니어서 적용하지 못했습니다." |
| 〃 `404 NOT_FOUND` | 〃 | "승인은 기록되었지만 대상 버전을 찾을 수 없어 적용하지 못했습니다." |
| 〃 `CHATBOT_ARCHIVED` / `ENV_MODE_DISABLED` | 〃 | "승인은 기록되었지만 챗봇이 보관되었거나 환경 분리가 꺼져 적용하지 못했습니다." |
| `403 FORBIDDEN`(요청 취소 — 요청자 아님) | 카드·AP-2 | "요청한 사람만 취소할 수 있습니다." |
| `403 FORBIDDEN`(예약 요청 — 예약 작성자 아님) | 예약 행 | "예약을 만든 사람만 승인 요청을 보낼 수 있습니다." |
| `404 NOT_FOUND`(요청) | AP-2 | "이 승인 요청을 찾을 수 없습니다." |
| 그 외 5xx·네트워크 | 화면 | `ErrorState` "처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요." + 재시도 |

**가드레일**

| 코드 | 문구(위치) |
|---|---|
| `400 VALIDATION_FAILED`(`TOO_SHORT`·`EXACT_MULTI_TOKEN`·`NOT_PLAIN_TEXT`·`GOVERNANCE_FLOOR`) | §5.4 · §6.4 표 |
| `400 BANNED_WORD_BLOCKED` | §5.4 |
| `409 DUPLICATE_NAME` · `409 LIMIT_EXCEEDED` · `409 CHATBOT_ARCHIVED` · `404 NOT_FOUND` | §5.4 |
| `400 STATS_RANGE_TOO_WIDE` / `INVALID_PERIOD` | 기간 필드 인라인(§7.1) |
| `401` | 전역 세션 만료 대화상자 |
| `403` | `ForbiddenState` |

### 13.3 예약 실패 사유 · 기존 상수 확장

| 상수 | 값 |
|---|---|
| `MESSAGES.deploySchedules.reasons.failure.APPROVAL_MISSING`(행 한 줄) | "승인 없음(2인 승인 필요)" |
| 예약 상세 사유 문단 | §9.10 문구 |
| 승인 상태 실패 사유(`failureCode` → 글자) | `ENV_GATE_NOT_PASSED` "필수 시험 기준 미달" · `ENV_TARGET_NOT_STAGING` "대상 버전이 더 이상 전환 대상이 아님" · `NOT_FOUND` "대상 버전을 찾을 수 없음" · `CHATBOT_ARCHIVED` "챗봇이 보관됨" · `ENV_MODE_DISABLED` "환경 분리가 꺼짐" · 그 외 "알 수 없는 사유" |

---

## 14. `UIUX_준수기준.md` 체크리스트 매핑

| § | 항목 | 이 기능의 적용 |
|---|---|---|
| **§1 색상/명도 대비** | 4.5:1 · 비텍스트 3:1 · 색 단독 금지 | 모든 상태·동작·게이트·승인 상태는 **색+아이콘(aria-hidden)+글자**(`SeverityBadge`·`GateResultBadge` 토큰 재사용 — 대비 기검증). 규칙 사용 여부 "● 사용 중/○ 사용 안 함"·2인 승인 "● 켜짐/○ 꺼짐" 글자 병기. 카드 값 옆 레이블 상시. 새 색 정의 없음 |
| §1 **제안-자산 분리** | 제안(승인 전)은 별도 컨테이너·텍스트 라벨·상시 안내 | 승인 대기 요청 카드 = `ProposalContainer`("승인 대기 요청 (제안 · 승인 전)" + "승인될 때까지 운영 챗봇에는 아무 영향이 없습니다") · 승격(승인)은 상세 화면의 단일 진입점 · 목록/카드에서 바로 승인하는 버튼 없음 · 자산 쪽에 "끌어오기" 버튼 없음 |
| §1 **민감 정보 임시 열람** | 기본 마스킹·열람 고지 | 걸린 기록은 **가림 처리본만** 표시(원문 경로 없음). 거버넌스 모드 열람 감사는 `GovernanceViewAuditBanner`(목록 조회 1회가 감사 대상임을 정적 문구로) |
| §1 추정 미리보기 | "예상" 라벨 | 해당 없음 — 시뮬레이터 AI 답변 미리보기는 "운영에서 실제로 나가는 모습"을 서버가 같은 판정 함수로 계산한 값(추정 아님). 다만 외부 AI 답은 매번 달라질 수 있으므로 패널 제목에 "이번 답 기준" 글자를 넣지는 않고 "시뮬레이터에서는 걸린 기록이 남지 않습니다"만 안내 |
| §2 타이포 | 16~17px · 행간 1.5 | 기존 전역 스타일 사용 · 표·카드 본문 글자 크기 유지 |
| **§3 키보드/포커스** | Tab 순서 · Enter/Space · 셀렉트 Esc | 모든 컨트롤 네이티브 요소(`button`·`a`·`input`·`select`·`textarea`). 표 행 동작은 보이는 버튼. **위/아래 이동 버튼**(드래그 없음)·이동 후 포커스 유지 · 끝 행 버튼 `aria-disabled`(포커스 유실 방지) · 모달 포커스 트랩·Esc·복귀(`Modal`) · 삭제·전환 후 포커스 대상 지정(헤딩 `tabIndex=-1`) · 펼침 버튼 `aria-expanded`/`aria-controls`(대화 보기·경고 접힘) |
| **§4 버튼** | 동사형 · 중복 실행 방지 · 44×44px | 버튼 문구 동사형("추가"·"저장"·"승인 요청 보내기"·"승인하고 운영에 적용"·"반려하기"·"요청 취소"·"시험하기"). **진행 중 `disabled`+진행 문구**(저장·승인·삭제·시험·요청 전부). 이동/스위치는 진행 중 `aria-disabled`(포커스 유지). 터치 영역 44×44px(이동·칩 제거·스위치·체크박스 행 포함) |
| **§5 텍스트 입력** | 레이블 필수 · 글자 수 표시 · 붙여넣기 제한 금지 | 모든 입력에 `<label>`(placeholder로 대체 금지) — 이름·표현·대체 문구(300)·시험할 문장(2000)·요청 사유(200)·반려 사유(200)·승인 유효 시간. **남은 글자 실시간 표시**. 표현 입력은 줄바꿈 붙여넣기 분할(제한 없음). 대체 문구·시험 문장 `textarea` 세로 스크롤 |
| **§6 폼 컨트롤** | 라디오/체크박스 용도 · 사전 선택 금지 · 필수 표시 · 체크박스 가나다순 | 적용 위치·분류는 **사전 선택 없음**(필수 표시 `*`+글자). 동작 기본 "기록만"은 PM이 정한 안전 기본값이며 안내문 병기. 단일 선택 = 라디오, 다중 = 체크박스, 가림 종류 5개는 **가나다순 수직** + "기본" 글자 표식. 셀렉트 값 변경만으로 제출 금지(걸린 기록은 "조회" 버튼). 승인 유효 시간은 숫자 입력(슬라이더 없음). 옵션 20개 초과 없음 |
| **§7 오류 메시지** | 원인+해결 · 제출 시점 · 사전 검사 | 폼 오류는 **제출 시** 필드 하단 인라인(`InlineFieldError` `role="alert"`) + 첫 오류로 포커스. 입력 중 팝업 없음(표현 추가 검증만 그 필드 안). 모든 오류 문구는 "무엇이 문제인지 + 어떻게 고치는지"(§5.4·§13.2). 사전 검사(빈 값·범위·EXACT 공백·글자 수)를 서버 호출 전에 수행 |
| **§8 로딩/상태** | 스켈레톤 · 완료 표시 · 비동기 대기 | 모든 목록·카드 `Skeleton*` + `aria-busy`. 결과 개수 `caption`+`role="status"`. 진행 문구 "…하는 중…". 2인 승인은 서버 즉시 응답(비동기 대기 패턴 해당 없음). **주기 갱신 값(남은 시간)은 낭독하지 않음**(분 단위 갱신 · `aria-live` 없음). TopBar 배지 폴링은 탭 숨김 시 정지 · 실패 조용히 무시. 알림 영역 1개 · 문장이 바뀔 때만 1회 낭독 |
| **§9 내비게이션** | 건너뛰기 링크 · href 링크 · 페이지네이션 | 서브내비·규칙 "수정"·목록 "자세히 보기"는 `<a href>`(`NavLink`). 현재 서브탭 밑줄+굵게(색 단독 아님). `Pagination` 기존 컴포넌트(현재 페이지 밑줄) |
| 확인 대화상자 | 오조작 방지 | 규칙 삭제 · 2인 승인 끄기 · 요청 취소 · 승인 최종 확인 · 반려 · 가림 줄이기 저장 = **`ConfirmDialog`/`Modal` 기본 포커스 "취소"**(`data-autofocus="cancel"`). 단독 롤백은 중첩 대화상자 대신 **필수 체크**로 확인 |
| 스크린리더 | 상태 낭독 | 표 `<caption>`·`<th scope>` · 배지 글자가 곧 이름 · 아이콘 `aria-hidden` · `aria-disabled` 컨트롤은 `aria-describedby`로 이유 글자 연결 · 시험 결과 영역 `role="status" aria-live="polite" aria-atomic="true"` · 이동/스위치/삭제 결과 문장 1회 · 대화 보기 본문은 글자로만(HTML 주입 방지) |

### 14.1 스크린리더 세부

- **`aria-disabled` 사용 지점**(포커스 가능 + 이유 연결): "AI로 보내지 않음" 라디오 · 규칙 이동 끝 행 버튼 · 규칙 추가(한도) · 계좌 날짜 보호 체크 · 거버넌스 하한 체크박스 · 2인 승인 스위치(켜기 불가/끄기 잠금) · "환경 분리 끄기..." 버튼 · AP-2 승인·반려(자기 요청·차단 사유) · 카드 "요청 취소"(요청자 아님이면 미렌더).
- **동작·상태 배지 읽기**: 배지 안 텍스트 그대로("안전 문구로 대체"·"승인 대기"). 아이콘은 `aria-hidden`.
- **포커스 이동 표**(동작 뒤 포커스 유실 방지): 규칙 삭제/저장 → GR-1 `<h1>`(`tabIndex=-1`) · 승인 요청 전송 → 대기 카드 제목 · 요청 취소 → 승인 설정 패널 제목 · 승인/반려 성공 → AP-2 상태 제목 · 정책 켜기/끄기 → 스위치(아직 존재) · 모달 닫힘 → 트리거 복귀(`Modal` 기본).
- **`ForbiddenState`**: 진입 시 제목 포커스(기존).

---

## 15. 반응형 고려사항

기본 원칙(기존 콘솔 관행 — `desktop-only`/`mobile-only` 토글, **640px 미만 카드 전환**, 가로 스크롤 표 금지, 터치 44×44px):

| 화면 | 데스크톱 | 640px 미만 |
|---|---|---|
| GR-1 규칙 표 | 표 | 카드 목록: 카드 제목=규칙 이름 · `dl`(분류·위치·동작·표현 수·걸림) · 아래 줄 사용 스위치 · 이동(위/아래) · 수정/삭제 버튼(각 44×44) · 확인할 점은 카드 하단 목록 |
| GR-2 편집 | 2열(폼 + 시험 패널) | **1열**: 폼 → 시험하기 패널(접이식 `▾ 문장으로 시험하기`, 기본 펼침). 저장/취소 버튼은 폼 끝(스크롤 끝) + 고정하지 않음 |
| GR-3 | 1열(체크박스 수직) | 동일. 시험 패널 아래 배치 |
| GR-4 | 카드 7 = 가로 격자 | 카드 세로 1열(2열 격자까지 허용) · 규칙별/종류별 표 → 카드 · 절차 표 → 카드 목록(절차 이름 제목 + `dl`) |
| GR-5 | 표 + 행 펼침 | 카드 + "대화 보기" 펼침(카드 안) · 필터는 세로 스택 |
| 환경 탭 승인 절 | 패널/카드 가로 배치 | 세로 스택 · 최근 요청 표 → 카드 |
| AP-1 | 표 | 카드 |
| AP-2 | 2열 dl + 재확인 영역 | 1열 · 승인/반려 버튼 세로 전체 폭(44px 이상) |
| TopBar "승인 대기" | 링크 | 기존 TopBar 줄바꿈 규칙을 따름(별도 메뉴화 없음) |
| 모달 | 기존 `Modal` | 기존 규약(화면 폭에 맞춤 · 내부 스크롤) |
| 시뮬레이터 안내·미리보기 | 말풍선 아래 블록 | 동일(드로어 폭에 맞춰 줄바꿈) |

- 텍스트 길이(한국어 긴 문구)는 줄바꿈 허용 — 잘림(`text-overflow`) 금지. 이메일·긴 규칙 이름은 `word-break: break-all`.
- **위젯 레이아웃은 관여하지 않는다**(변경 0).

---

## 16. frontend-implementer 체크리스트

### 16.1 라우팅·메뉴·권한
- [ ] `TabNav`: "검증" 그룹 4번째 탭 "안전 가드레일"(`/chatbots/:id/guardrails`) — 권한 없어도 링크 표시 · `TabNav.spec` 무수정 통과 확인.
- [ ] `App.tsx`: `guardrails` 셸 + `rules`·`rules/new`·`rules/:ruleId`·`pii`·`overview`·`events`(index → `rules`) · 최상위 `/environment-approvals`·`/environment-approvals/:chatbotId/:requestId`(`RequirePermission chatbot:deploy`).
- [ ] `TopBar`: `ApprovalNavLink`(`chatbot:deploy` 게이트 · 60초 폴링 · 탭 숨김 정지 · 실패 무시).
- [ ] `ChatbotDetailLayout` 컨텍스트 변경 없음(`useApprovalPolicy`는 독립 훅). 환경 탭에서만 재조회.

### 16.2 API·상태
- [ ] `api/guardrails.ts`(13) · `api/switchApprovals.ts`(9) — 기존 `apiClient`·`ApiError` 사용 · shared-types 스키마 재사용(설계서 §13.2) · 라벨 상수 import.
- [ ] `GuardrailShell`이 규칙 목록을 1회 조회해 Outlet context로 공유(`reload` 제공).
- [ ] `useApprovalPolicy(chatbotId)` 공유 조회·재조회 · 환경 탭·예약 다이얼로그·예약 목록에서 사용.
- [ ] 이벤트 목록의 대화 본문은 **글자로만** 렌더(HTML 주입 금지) — 테스트로 `<script>`·`<b>` 입력이 글자로 보이는지 확인.

### 16.3 화면별
- [ ] GR-1: 표+카드 · 이동(포커스 유지·진행 중 `aria-disabled`) · 사용 스위치(응답 반영·낙관 갱신 없음) · 삭제 확인 · 한도·경고 문구 · 빈 상태 3단계 안내.
- [ ] GR-2: 필드·사전 선택 규칙(적용 위치·분류 미선택) · 동작 기본 "기록만" · NO_RAG 잠금·자동 되돌림 · `ExpressionListEditor`(줄바꿈 분할·검증) · 대체 문구 조건부 · 위젯 안내(D-4) · 서버 오류 필드 매핑 · 저장 성공(중복 합침 토스트) · `UnsavedGuard` · 시험 패널(저장 전/저장된 규칙).
- [ ] GR-3: 체크박스 가나다순+"기본" 표식 · 계좌 경고·날짜 보호 · 거버넌스 하한 잠금 · 약화 저장 확인 · 기본값 되돌리기(저장 별도) · 예시 넣기 · 시험 결합.
- [ ] GR-4: 카드 7·표·알림·절차 표(링크 권한별) · 기간 90일 검증 · 서버 꺼짐 문구.
- [ ] GR-5: 필터(조회 버튼)·URL 동기화 · 행 종류별 표시 · 대화 보기 펼침(추가 호출 없음) · `textPurged`/`null` 안내 · 거버넌스 배너.
- [ ] 환경 탭: `ApprovalPolicyPanel`(켜기·끄기·TTL·경고·잠금) · `ApprovalPendingCard`(`ProposalContainer`) · 버튼 문구·롤백 힌트 · 끄기 버튼 `aria-disabled`+사유 · 이력 표식.
- [ ] `ProdSwitchDialog`: 미리보기 `approval?`에 따른 요청 모드·단독 롤백 모드 · 409 안내→재조회 · 단독 롤백 필수 체크 · 요청 성공 후 포커스 이동. **`approval` 키 없을 때 기존 시험(`ProdSwitchDialog.spec`) 무수정 통과.**
- [ ] `EnvironmentDisableDialog`: `approvalPolicyActive`·409 방어.
- [ ] `ScheduleDeployDialog`: 정책 켜짐 시 안내·확정 버튼 문구·2단계(예약→요청) · 2단계 실패 결과 화면. `DeployScheduleRow`/상세: 승인 상태 글자·"승인 요청 보내기" · `APPROVAL_MISSING` 사유.
- [ ] AP-1/AP-2: 목록·상세·승인 최종 확인·반려 대화상자·자기 요청 비활성·경고 확인·차단 사유·경합 처리(`NOT_PENDING` 재조회).
- [ ] 시뮬레이터: `GuardrailInboundNotice`·`RagPreviewPanel`(접힘 밖) · 두 키가 없으면 기존과 바이트 동일.
- [ ] 데이터 지도 절 · 감사 대상 라벨 갱신 확인.

### 16.4 문구·상수·시험
- [ ] `MESSAGES.guardrails`·`MESSAGES.switchApproval` 신설 · `detail.tabGuardrails`·`common.approvalsNav`·`reasons.failure.APPROVAL_MISSING` 추가 · 이 문서의 문구를 그대로 사용.
- [ ] **문자열 스캔 시험(AG-16)**: 이 기능 화면 문자열에 "환각"·"hallucination"·"편향 없음"·"가드레일"(탭·페이지 제목 상수 1곳 외) 0건.
- [ ] a11y 시험(`*.a11y.spec.tsx` 선례 — `jest-axe` 계열): GR-1·GR-2·GR-3·AP-1·AP-2 · 확인 대화상자 기본 포커스(취소) 단언.
- [ ] 시험 기본값: 색 단독 정보 없음(글자 단언) · `aria-disabled` 컨트롤의 이유 연결 · 시험 결과 영역 `aria-live`.
- [ ] 기존 시험 무수정: `TabNav.spec`·`ProdSwitchDialog.spec`·`EnvironmentTab.spec`·`EnvironmentHistoryTable.spec`·`ScheduleDeployDialog*.spec`·`SimulatorPanel*.spec`.
- [ ] 위젯·`packages/dialogue-engine` 변경 0 확인.

---

## 17. 설계서와 어긋나거나 조정한 점 (ui-designer 판단 기록)

| # | 설계서/요구사항 | 이 문서 | 이유 |
|---|---|---|---|
| **A-1** | §17.1: 하위 탭 2개(규칙 · 현황), 가림 설정은 규칙 탭의 절, 이벤트 목록은 현황의 절 | **서브내비 4개**(위험 응답 규칙 · 개인정보 가림 · 현황 · 걸린 기록) | ① 이벤트 목록만 열람 감사(VIEW) 대상이라 집계 화면에 감사 배너를 달면 사실과 다르다 ② 가림 설정은 쓰기 API·목적이 규칙과 달라 한 화면에 섞으면 혼동·길이 문제. 데이터·API는 설계서 그대로 |
| **A-2** | §17.1: 규칙 편집 "대화상자 또는 페이지" | **페이지**(`rules/new`·`rules/:ruleId`) | 표현 100개·조건부 필드·저장 전 시험 패널을 나란히 둘 공간이 필요하고, 뒤로가기·`UnsavedGuard` 이탈 보호가 페이지에서 자연스럽다 |
| **A-3** | 규칙 목록 응답 `meta`에만 `ragActive`·`serverEnabled` | 셸이 규칙 목록을 1회 조회해 공유 | 별도 API 없이 서버 꺼짐·AI 답변 미사용 배너를 모든 서브탭에 띄우기 위함. 권고(선택): architect가 `overview`·`settings` 응답에도 `serverEnabled`를 싣거나 별도 경량 `meta`를 두면 셸 의존이 줄어든다(필수 아님) |
| **A-4** | 요구사항 `화면 이름 "가드레일 현황"` · 설계서 §17.1 "안전 가드레일" | 탭·제목 1곳만 "안전 가드레일", 본문은 쉬운 말 · "적중 기록" → **"걸린 기록"** · "이벤트" 용어 금지 | 관리자에게 쉬운 말 원칙 · 요구사항 NFR-AGA2 |
| **A-5** | §17.3: 단독 롤백 "확인 대화상자" | 기존 전환 대화상자 안의 **필수 체크**로 대체(중첩 대화상자 없음) | 이미 대화상자(미리보기+취소 기본 포커스)이고 이중 모달은 포커스 트랩·낭독이 복잡해진다. 오조작 방지 효과는 체크가 동등 |
| **A-6** | §8.4: 현황 응답 필드 상세 미열거(개념만) | 카드·표는 **개념·문구만 고정**, 필드명은 shared-types `GuardrailOverviewSchema`에서 매핑 | 구현 시 스키마가 정본. 불명확한 필드가 있으면 architect에 확인 |
| **A-7** | §10.7: "예약 목록이 승인 현황 조회로 상태를 합성" | **챗봇 스코프 예약 목록·상세만** 합성. 전역 예약 현황(S4)은 승인 상태 글자 없음(실패 사유 라벨만) | 전역 목록은 여러 챗봇 → 챗봇별 조회 N회 필요. 정책·요청 조회 API가 챗봇 스코프뿐이다. 필요하면 architect가 예약 목록 항목에 `approvalState` 선택 필드를 싣는 방안 검토 |
| **A-8** | 환경 상태 응답(`EnvironmentStatus`)에 승인 정책이 없음 | `useApprovalPolicy`가 `GET …/environment/approval` 별도 조회 | 설계서 §10.2 `PointerStatus.approval`은 서버 내부 필드이고 콘솔용 응답에는 노출되지 않는다. 대화상자는 서버 미리보기 `approval?`로 판단하므로 패널 조회 실패가 전환을 막지 않음. 권고(선택): 켜진 모드 `EnvironmentStatus`에 `approval:{required,ttlHours}` 선택 필드를 더하면 호출 1회가 준다 |
| **A-9** | §10.8: 이력 항목 선택 필드는 `approvalMode?`뿐 | 이력에서 요청 상세로 가는 링크를 **만들지 않음** | `approvalRequestId`가 응답 계약에 없다. 요청자 확인은 감사 로그로 |
| **A-10** | 체크박스 가나다순(UIUX §6) vs 기본 선택 종류를 위에 두는 편이 자연스러움 | **가나다순 유지 + "기본" 글자 표식** | 준수 기준 우선 |
| **A-11** | 요구사항 FR-AG5-2 "요청 = 대화상자" · 설계서 R-21 별도 요청 경로 | 기존 `ProdSwitchDialog`에 **요청 모드**로 통합(새 대화상자 없음) | 미리보기·경고·사유 UI 재사용 · 기존 시험 무수정(`approval` 키 없으면 동일) |
| **A-12** | 반려 대화상자 기본 포커스 | **취소**(메모 입력은 Tab 이동) | 확인 대화상자 기본 포커스 규칙의 일관성 우선 |
| **A-13** | D-4 위젯 `FAILED` 상태 문구 고정 | 관리자 화면 안내로만 처리(§5.3 조건부 `field-hint`) | 위젯 변경 0 원칙(K-5) |
| A-14 | TC 실행 표시 이월(R-1) | 시뮬레이터만(SM-1) | 설계서 그대로 |

### 17.1 구현 중 설계서 확인이 필요할 수 있는 항목(architect 회신 대기 아님 — 가정으로 진행)

- `GuardrailTestResponse.resultText`가 `FALLBACK`일 때 무엇인지(기본 안내 문구 자체인지 원답 마스킹본인지) — 이 문서는 "사용자에게 나가는 문구"로 표시하되 `FALLBACK`이면 배지 문장을 우선한다. 값이 비어 있으면 결과 문구 상자를 생략.
- `draftRule`(id 없음)은 "저장된 규칙 + 이 규칙(맨 뒤)"으로, `draftRuleId`는 "저장본을 이 값으로 대체"로 해석(설계서 §13.2 주석).
- `GuardrailEventItem`의 필드명(kind·stage·규칙 스냅샷·`piiKind`·`piiCount`·`errorCode`·`effect`·`conversation`·`textPurged`)은 shared-types 스키마에서 매핑.
- 요청 생성 시 `ttl` 표시는 `useApprovalPolicy` 값. 조회 실패 시 "정해진 시간 안에" 문구로 대체.

### 17.2 구현 결과 편차 (2026-09-30)

| ID | 항목 | 구현 결과 |
|---|---|---|
| I-13 | `Modal.tsx` 공용 수정 | `onClose`·`closeOnEsc`·`initialFocusSelector`를 ref로 들고 초기 포커스는 열릴 때·대상이 뒤늦게 나타날 때만 이동(모달 안 입력 중 포커스가 취소로 돌아가던 기존 결함 수정). 회귀 시험 `Modal.focus.spec.tsx` |
| I-14 | 문구 | '가드레일'은 탭·페이지 제목 1곳만. §3.2·§3.3·§9.4·§10.2 문구를 원칙에 맞게 변경(서버 꺼짐 배너·셸 로드 실패·단독 롤백 안내·데이터 지도 제목). 문자열 스캔 시험이 가드레일·환각·hallucination·편향 없음·RAG·PII·마스킹·이벤트·입구·출구 0건 단언 |
| I-15 | 제목·접근성 | 셸 h1 하나, 하위 화면 제목은 `h2 tabIndex=-1`. 이메일 라벨은 shared-types 상수('이메일'). 토스트가 aria-live이므로 삭제·가림 저장·승인 정책 변경은 별도 sr-only 알림을 겹치지 않음. `useApprovalPolicy`는 공유 캐시 없이 화면별 조회 |
| I-16 | AP-2 상세 라우트 | `chatbot:deploy` 대신 `chatbot:read`로 감싸고(API 조회 권한과 일치) 승인·반려·취소 컨트롤은 화면 안에서 `chatbot:deploy`로 재차 가림. 이력에 '요청 보기' 링크(`approvalRequestId` 존재·배포 권한 시에만, §9.11 링크 금지 조정) |
| I-17 | 현황 규칙별 표 | `appliesTo`·기록만 횟수가 응답에 없어 [규칙·현재 동작·사용자 질문에서 걸린 횟수·AI 답변에서 걸린 횟수·답이 바뀐 횟수·걸린 기록 보기]로 구성. 승인 유효 시간 변경 버튼은 끄기 잠금 중에도 표시 |
| I-5 | `resultText` | §17.1 가정대로 출구 판정이 `FALLBACK`이면 서버가 빈 문자열을 보내며 결과 문구 상자를 생략 |
| I-11 | 예약 항목 승인 상태 | 응답에 `approvalState`가 없어(A-7 미적용) 프런트가 `GET …/environment/approval`의 `recent`·`pending`과 요청 상세로 합성 |
| I-21 | 이월 | H9 바로가기는 기능 꺼짐 여부 미확인(`security:read`만으로 링크). TC 실행·회귀 화면의 가드레일 표시는 규모 B로 이월 |
| I-20 | 알려진 한계 | `Modal` 두 번째 이펙트가 `initialFocusSelector` 대화상자에서 포커스가 밖(중첩 포털)으로 나간 채 재렌더되면 되돌림(L-4). `ApprovalNavLink`는 60초마다 전역 목록 조회(L-1). 이벤트의 `conversation`이 null일 수 있고 화면은 null 처리 |

---

## 18. Out of scope / 재검토 트리거

| 항목 | 이유 | 재검토 트리거 |
|---|---|---|
| 규칙 내보내기/가져오기·챗봇 간 복사 | 요구사항 권고 2차 | 여러 챗봇에 같은 규칙을 반복 등록하는 요구가 생기면 |
| TC 실행·회귀 화면의 가드레일 판정 표시 | 규모 B 이월(R-1) | 안전 점검 세트 도입 시 |
| 환각·편향 점검 화면 · 근거 대조 | 규모 B·C 제외(PM 확정) — 화면·문구에 "환각" 금지 | 운영 모델 실측 후 별도 그룹 |
| AI 답변 고지(위젯 문구) | 법무 확인 전 구현 안 함(P-11) · 위젯 변경 0 | 법무 결론 후 |
| 알림 메일·메신저(승인 대기) | 1차는 콘솔 배지만(FR-AG5-9) | No.41 운영 이벤트 확장 시 |
| 복원·거버넌스 설정의 2인 승인 | 설계서 J-6 | 금융·공공 고객의 명시 요구 |
| 전역 규칙 목록(챗봇 가로지르기)·전역 예약 목록의 승인 상태 | 챗봇 스코프 API뿐 | 운영 규모가 커져 필요할 때(A-7) |
| 승인 요청 이력 전용 검색 화면 | 최근 20건 + 감사 로그로 충분 | 감사 요구가 늘면 |
| 규칙 표현의 의미 기반 확장·정규식 | 규모 A는 리터럴/토큰 매칭(K-1) | 별도 그룹 |
