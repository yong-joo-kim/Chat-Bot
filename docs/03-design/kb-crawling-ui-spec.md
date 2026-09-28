# 지식베이스 자동 크롤링/동기화 (No.43) — 화면 설계서

> **요구사항**: `docs/requirements/kb-crawling.md`(T-1~T-6, J-1~J-19, FR-0-203~214, FR-KB1-\*~FR-KB9-\*, NFR-KBP/KBS/KBR/KBA/KBM, AC-KB1~KB7, EX-KB-1~22, P-1~P-12 전부 추천안 확정 2026-09-27)
> **설계**: `docs/02-spec/kb-crawling-설계.md`(§2 아키텍처·§3 데이터모델·§4 계약·§5 외부 RAG 적재·§6 수집·§8 변경감지·§9 예약/실행/잡·§10 개인정보·§11 API·§12 관리자 콘솔 인계·§13 권한/감사·§14 환경) · **ADR-0044**
> **UIUX 기준**: `docs/03-design/UIUX_준수기준.md`(§1 색상 단독 금지·§3 키보드 접근성·§4 버튼 44×44px·§5 텍스트 입력·§6 폼 컨트롤·§7 오류 메시지·§8 로딩/비동기 대기/실시간 폴링·§9 내비게이션)
> **형식 참조**: `docs/03-design/channel-rich-messages-ui-spec.md` · `docs/03-design/workflow-automation-ui-spec.md`(전역 `/settings/*` 셸 + 배지 + `messages.ts` 네임스페이스 구성 방식의 직접 선례)
> **실제 코드 확인**: `apps/web/src/components/security/SystemSettingsMenu.tsx`(메뉴 추가 지점 — 권한 없는 항목 렌더 생략) · `apps/web/src/pages/settings/ApiConnectionsPage.tsx` + `api-connections/{ApiConnectionEditModal,ApiConnectionFilterBar,DeleteApiConnectionConfirmDialog,badges}.tsx`(No.26 — 전역 자원 목록+모달+삭제확인의 1:1 선례) · `apps/web/src/pages/settings/workflow-automation/{WorkflowAutomationShell,WorkflowRunsPage,WorkflowRunTable}.tsx`(서브라우트 탭 셸 · 진행 중 건이 있을 때만 폴링하는 패턴의 직접 선례) · `apps/web/src/pages/settings/data-governance/DataGovernanceMapPage.tsx`(출구 절 확장 지점 — `egress.workflowTargets` 선택 키 렌더 방식을 `egress.kbSources`에 그대로 적용) · `apps/web/src/components/AsyncJobProgress.tsx`(진행 표시 공용 컴포넌트) · `apps/web/src/pages/chatbot-detail/answer-settings/AnswerSettingsPage.tsx`(RAG 스코프 입력 영역 — 읽기 카드 삽입 지점) · `apps/web/src/constants/messages.ts`(네임스페이스 관례)
> **작성**: ui-designer · 2026-09-27 · **다음 단계**: `backend-implementer` → `frontend-implementer` → `code-reviewer` → `test-automation`
> **범위 경계**: 실제 React 컴포넌트 코드는 작성하지 않는다. `apps/widget` 변경 0건(공개 대화 경로 불변 — FR-0-206). 이 문서는 설계서 §12가 정한 9개 화면 항목을 화면으로 구체화한다.

---

## 0. 전제와 연계 확인

1. **PM 결정 P-1~P-12는 전부 추천안대로 확정**(2026-09-27)되었고 architect가 §1(R-1~R-30)에서 세부를 확정했다. 이 문서는 그 결정을 화면으로 구체화할 뿐 재론하지 않는다. 화면에 직접 영향을 주는 것만 다시 적는다.
   - 우리는 **수집·변경 감지만** 한다. 청킹·임베딩·검색·답변은 외부 RAG가 한다 — 화면 어디에도 "문서 내용 미리보기"나 "청크 확인" 기능은 없다(원문 비저장, FR-0-210).
   - **신규 권한 0종**. 소스 등록·수정·삭제·실행·적재 시작·전체 다시 적재 = `security:write`(No.26 전역 연결과 같은 등급) · 조회 = `security:read` · 챗봇 답변 설정의 읽기 카드 = `chatbot:read`(EDITOR·AGENT·VIEWER도 볼 수 있다 — URL·호스트는 노출하지 않는다).
   - **첫 회는 항상 미리보기**(P-4 (a)). 관리자가 "적재 시작"을 눌러야 그 소스가 외부 RAG에 처음 반영된다. 범위·스코프·개인정보 옵션을 바꾸면 다시 미리보기로 돌아간다(`configVersion` 불일치 — 값이 실제로 바뀔 때만 · 설계서 §25 I-38).
   - **전송 전제 게이트**(`KB_INGEST_TRANSPORT_ACK`)가 서버에 없으면 미리보기까지는 되지만 적재(승인·`SYNC`·`FULL_RESEND`)는 전부 막힌다 — 화면은 이 상태를 "적재 시작" 비활성 + 사유 텍스트로 드러낸다.
   - **자동 삭제는 절대 없다**(ADR-0022 파괴적 경로 봉인 불변). 사라지거나 짧아진 페이지는 "정리 필요" 표시 + "외부 RAG에서 직접 정리한 뒤 전체 다시 적재" 안내만 한다.
   - 값이 있는 비밀(고정 헤더 값)은 **화면 어디에도 입력란이 없다** — 헤더 **이름**과 환경변수 **참조 이름**만 입력하고, 실제 값은 서버 환경변수(`KB_SECRET__<REF>`)에서만 읽는다(No.26 방식 그대로).
   - **환경(No.40) 밖 자원**이다 — 지식베이스 동기화는 스테이징/운영 구분 없이 즉시 반영된다. 답변 설정 읽기 카드가 이를 안내한다(J-15).
   - **기능 꺼짐**(`KB_SYNC_ENABLED=false`, 기본값)이면 관리 API 13개가 전부 `404`를 반환한다 — 콘솔은 `meta` 404를 신호로 메뉴 항목·챗봇 카드·데이터 지도 절을 전부 숨긴다(OMNI·워크플로우 선례와 동일한 패턴).
2. **선행 화면과의 관계**
   - 소스 목록·등록 모달은 `ApiConnectionsPage`(No.26)의 "전역 자원 목록 + 필터 바 + 편집 모달 + 케밥 메뉴 + 삭제 확인 다이얼로그" 구조를 **그대로** 따른다. 다른 점은 항목마다 "실행 이력·문서 목록"으로 더 들어가는 상세 화면이 있다는 점이다(단일 편집 모달로 끝나지 않는다).
   - 소스 상세는 `WorkflowAutomationShell`(No.41)과 같은 `role="tablist"` 서브라우트 셸 패턴을 쓰되, 전역이 아니라 **소스 1건에 스코프**된다(`data-governance-ui-spec.md`의 `DataGovernanceShell`이 아니라, 개별 자원 상세라는 점에서 챗봇 상세 탭에 더 가깝다 — 다만 라우트는 `/settings/kb-crawling/:sourceId/*`로 설정 영역에 둔다).
   - 실행 이력 화면의 "진행 중 건이 있을 때만 짧은 간격으로 다시 읽고, 상태가 바뀔 때만 화면낭독 알림"은 `WorkflowRunsPage`의 폴링 패턴(§3.2)을 그대로 가져온다. 다만 설계서(§12 화면 5)가 5초 간격을 명시하므로 워크플로우의 10초 대신 **5초**를 쓴다.
   - 데이터 지도 확장은 `DataGovernanceMapPage`가 이미 가진 "선택 키 있으면 절 추가"(`egress.workflowTargets` 선례)를 `egress.kbSources`에 그대로 적용한다 — 소스 0개 설치는 이 절 자체가 렌더되지 않는다(응답에 키가 없다).
   - `AsyncJobProgress`는 **그대로 재사용하지 않고 규칙을 하나 얹는다**: 이 컴포넌트의 컨테이너는 `role="status" aria-live="polite"`가 고정이라 5초 폴링마다 진행률 텍스트 전체가 다시 낭독될 위험이 있다(설계서 §12 화면 5 "상태가 바뀔 때만 알림"과 충돌). 그래서 이 그룹의 실행 진행 표시는 `AsyncJobProgress`를 **시각적 스피너·진행바로만** 쓰고(`progress` prop), 화면낭독 알림은 `WorkflowRunsPage`처럼 **별도의 `aria-live="polite"` sr-only 텍스트**를 상태 변화 시에만 갱신하는 방식으로 감싼다(§12-① 판단 근거).
3. **문구 상수**: 신규 네임스페이스 `MESSAGES.kbSources`·`MESSAGES.kbRuns`·`MESSAGES.kbDocuments`를 추가하고, 기존 `MESSAGES.systemSettings`·`MESSAGES.dataGovernance.map`·챗봇 상세의 RAG 답변 설정 문구 그룹에 항목을 더한다(§7).
4. **`UIUX_준수기준.md` 보강 여부**: 신규 규칙 없음. §1(색상 단독 금지)·§3(키보드)·§4(버튼)·§5(텍스트 입력)·§6(폼)·§7(오류)·§8(로딩·비동기 대기·실시간 폴링)·§9(내비게이션)로 전부 커버된다.

---

## 1. 화면 목록 및 라우트

| ID | 화면명 | 라우트 | 성격 | 진입 경로 | 필요 권한 |
|---|---|---|---|---|---|
| KB1 | `SystemSettingsMenu` 항목 "지식베이스 동기화" | — | 메뉴 항목 | — | `security:read`(항목 자체) · `meta` 404면 항목 자체 렌더 안 함 |
| KB2 | **소스 목록**(전역) | `/settings/kb-crawling` | 페이지(목록 + 등록 모달) | KB1 | `security:read`(조회) / `security:write`(등록·수정·삭제·실행) |
| KB3 | 소스 상세 — 개요·미리보기 | `/settings/kb-crawling/:sourceId`(index→`overview`) `/settings/kb-crawling/:sourceId/overview` | 페이지(`KbSourceShell` 1번째 탭) | KB2 행 클릭 | `security:read`/`security:write` |
| KB4 | 소스 상세 — 실행 이력 | `/settings/kb-crawling/:sourceId/runs` | 페이지(`KbSourceShell` 2번째 탭) | 셸 내 탭 전환 | `security:read`/`security:write`(중지) |
| KB5 | 소스 상세 — 문서 목록·정리 필요 | `/settings/kb-crawling/:sourceId/documents` | 페이지(`KbSourceShell` 3번째 탭) | 셸 내 탭 전환 | `security:read`/`security:write`(전체 다시 적재) |
| KB6 | 소스 등록·수정 모달(`KbSourceEditModal`) | — | 모달(KB2 내부) | "+ 소스 추가" / 행 케밥 "수정" | `security:write` |
| KB7 | 소스 삭제 확인 다이얼로그 | — | 모달(KB2 내부) | 행 케밥 "삭제" | `security:write` |
| KB8 | 적재 시작 확인 다이얼로그 | — | 모달(KB3 내부) | 개요 탭 "적재 시작" 버튼 | `security:write` |
| KB9 | 전체 다시 적재 확인 다이얼로그 | — | 모달(KB5 내부) | 문서 목록 탭 "전체 다시 적재" 버튼 | `security:write` |
| KB10 | 챗봇 답변 설정 — 지식베이스 동기화 상태 카드 | 기존 `/chatbots/:chatbotId/answer-settings`(RAG 영역 하단) | 페이지 내 카드 추가 | 기존과 동일 | `chatbot:read` |
| KB11 | 데이터 지도 — "지식베이스 동기화" 절 | `/settings/data-governance/map`(기존 라우트) | 페이지 내 절 추가 | 기존과 동일 | `security:read` |
| KB12 | 기능 꺼짐 / 직접 URL 접근 | `/settings/kb-crawling/**` (기능 꺼짐 상태) | 오류 상태 | 메뉴 숨김 상태에서 URL 직접 이동 시 | — |

**신규 최상위 라우트는 KB2(셸 포함 3서브) 1그룹뿐**이다. KB10·KB11은 기존 화면의 확장이며 라우트를 새로 만들지 않는다.

**라우트 배치 근거**: 지식베이스 소스는 "어떤 외부 사이트에 접속해 무엇을 내보내는가"를 정하는 **보안 설정 도메인**(No.26·No.41과 같은 논리)이므로 `/settings/*` 패턴을 따른다. 다만 워크플로우처럼 "전역 목록/전역 이력/전역 요약"이 아니라 **소스 1건마다** 실행 이력·문서 목록이 붙는 구조라서, 상세 화면에 `WorkflowAutomationShell`과 동형이지만 **개별 자원 스코프**인 `KbSourceShell`을 둔다.

---

## 2. 공통 UI 요소(신규)

### 2.1 배지류 (색상+텍스트 병기, UIUX §1)

| 컴포넌트 | 용도 | 규칙 |
|---|---|---|
| `KbSourceEnabledBadge`(`ConnectionEnabledBadge`와 동형) | 소스 목록 | `사용 중`(초록 점) / `일시중지`(회색) |
| `KbNeedsPreviewBadge`(신규) | 소스 목록·개요 | `미리보기 필요`(파랑, "ⓘ") — `ingestApproved=false`일 때(새 소스·범위 변경·강등 공통) |
| `KbNeedsCleanupBadge`(신규) | 소스 목록·문서 목록 탭 | `정리 필요 N`(주황, "⚠") — `needsCleanupCount > 0`일 때 |
| `KbRepeatedFailureBadge`(신규) | 소스 목록 | `반복 실패`(빨강, "✖") — `repeatedFailureCount > 0`일 때(같은 문서 3회 연속 실패) |
| `KbDemotedBadge`(신규) | 소스 목록·개요 | `확인 필요`(주황, "⚠") + 툴팁으로 사유(새 페이지 비율 급증 / 로그인 필요로 보임) — `reviewRequiredReason`이 있을 때 |
| `KbRunStatusBadge`(신규, 9값 — `WorkflowRunStatusBadge`와 동형) | 실행 이력·개요 | 대기 중(회색,"◐")·수집 중(파랑,"↻")·적재 중(파랑,"↻")·성공(초록,"✔")·일부 실패(주황,"◐")·실패(빨강,"✖")·취소됨(회색,"⊘")·**끊김**(회색,"⧖", `INTERRUPTED` 표시 전용 — "다른 서버가 이어받는 중") |
| `KbDocumentStateBadge`(신규, 3값) | 문서 목록 | 있음(초록) / 없어짐(회색,"—") / 제외됨(회색,"○") |
| `KbCleanupReasonBadge`(신규, 5값) | 문서 목록·정리 필요 배너 | 없어짐 / 짧아짐 / robots에서 막힘 / 적재 위치 변경됨 / 형식 변경됨 — 전부 주황 톤(정리 필요라는 공통 의미) |
| `KbExcludeReasonBadge`(신규, 12값) | 문서 목록·미리보기 결과 | robots 제외 / 지원하지 않는 형식 / 크기 초과 / 리다이렉트 범위 밖 / 본문 없음(SPA 의심) / 검색 제외 표시(noindex) / 원본 파일 전달 꺼짐 / 인코딩 문제 / 마스킹 없이 개인정보 발견 / 파일 처리 불가 / 암호 걸린 파일 / 로그인 필요로 보임 — 전부 회색(제외는 오류가 아니라는 톤) |
| `KbTransportAckBadge`(신규) | 소스 목록·개요·데이터 지도 | `내부망(운영자 확인)` / `인증 적용` / `TLS 적용` / **`전송 전제 미확인`**(주황, "⚠" — 이 값이면 적재 전체가 막힌다) |
| `KbPiiMaskBadge`·`KbRawFileBadge`(신규) | 소스 목록·개요·데이터 지도 | `개인정보 마스킹 켜짐/꺼짐`, `원본 파일 전달 켜짐`(켜짐일 때만 주황 — "원문이 마스킹 없이 나갈 수 있음") |

### 2.2 폼·목록 전용 컴포넌트

| 컴포넌트 | props(요약) | 규칙 |
|---|---|---|
| `KbSourceEditModal` | `sourceId: string \| null`, `onClose`, `onSaved` | `ApiConnectionEditModal`과 동형. 저장 시 서버가 `warnings[]`(스코프 중복·이 스코프를 읽는 챗봇 없음)를 돌려주면 저장은 성공하되 배너로 안내한다(§3.6). 범위 필드(시작 주소·사이트맵·경로·깊이·최대 페이지·파일 형식·파일 상한·스코프 3단·마스킹·원본 파일 옵션)를 바꾸면 저장 버튼 옆에 상시 안내: "저장하면 다시 미리보기가 필요합니다." (구현 — 설계서 §25 I-38: 서버는 저장된 값과 **실제로 다를 때만** `configVersion`을 올린다 · 목록은 집합 비교 · 숫자는 서버 상한 적용 후 비교 — 콘솔 안내 조건과의 차이는 §14 I-38) |
| `KbScheduleField` | `value: KbSchedule`, `onChange` | 안 함(수동) / 매일 HH:mm / 매주 요일+HH:mm 라디오 3종 — 첫 선택이 "안 함"이 아니면 시각 입력이 나타난다(UIUX §6 조건부 표시 규칙) |
| `KbAuthField` | `value: KbAuth`, `onChange` | "인증 없음" / "고정 헤더" 라디오. 고정 헤더 선택 시 헤더 이름 입력 + **비밀 참조 이름**(값 아님) 입력 + 안내: "실제 값은 서버 환경변수 `KB_SECRET__<참조 이름>`에 설정합니다. 이 화면에는 값을 입력하지 않습니다." |
| `KbScopeField` | `company`, `category`, `subcategory`, `onChange*` | `RagScopeField`(답변 설정의 3단 입력 컴포넌트)를 **그대로 재사용**한다 — 같은 외부 RAG 스코프 3단이다 |
| `KbPreviewSummaryPanel` | `run: KbRunView` | §3.3 상세 — 적재 예정(새로·바뀜)·변경 없음·제외(사유별 배지+개수)·마스킹 건수·원본 파일 개인정보 건수·최대 페이지 도달 경고·강등 사유 |
| `KbRunProgress` | `run: KbRunView` | `AsyncJobProgress`를 감싼 래퍼 — "N개 중 K개 완료 · 약 H시간 남음" 텍스트 + 대기 사유(외부 RAG 준비 안 됨/야간 적재 시간 대기/속도 제한 — 구현: 서버는 앞의 둘만 낸다 · 설계서 §25 I-43) + 상태가 바뀔 때만 갱신되는 sr-only `aria-live` 알림(§0-2) |
| `KbDocumentTable` | `items`, `filters`, `onFilterChange` | 열: 표시 URL(경로까지) · 상태 · 정리 필요 사유 · 마지막 변경 · 마지막 적재 · 외부 파일 이름(복사 버튼) — 필터: 상태·정리 필요만·제외 사유·실행 |
| `KbCleanupBanner` | `source: KbSourceDetail` | S-3 문구 + 서브카테고리 이름 복사 버튼 + "전체 다시 적재" 버튼(§3.9로 연결) |
| `KbTransportAckNotice` | `ack: KbSourceDetail['ingestAck']` | 미확인이면 "적재 시작·전체 다시 적재를 사용할 수 없습니다 — 서버 운영자가 외부 RAG 전송 구간(내부망/인증/TLS)을 확인해야 합니다"를 상시 배너로 |
| `KbSyncStatusCard`(신규) | `chatbotId` | KB10 — 챗봇 답변 설정 RAG 영역에 삽입, §3.10 |

### 2.3 신규 페이지 셸

| 컴포넌트 | 위치 | 역할 |
|---|---|---|
| `KbSourcesPage` | `pages/settings/kb-crawling/KbSourcesPage.tsx` | KB2 — `ApiConnectionsPage`와 동형 |
| `KbSourceShell` | `pages/settings/kb-crawling/KbSourceShell.tsx` | 소스 1건 스코프 3탭(개요/실행 이력/문서 목록) — `role="tablist"` + `<Outlet/>`, `WorkflowAutomationShell`과 동형이나 헤더에 소스 이름 + 상태 배지들을 함께 표시 |

---

## 3. 화면별 설계

## 3.1 KB2 — 소스 목록 (`/settings/kb-crawling`)

### 목적
ADMIN이 등록된 지식베이스 수집 소스 전체를 한눈에 보고, 새 소스를 등록하거나 기존 소스를 수정·일시중지·삭제한다.

### 상태별 UI

| 상태 | UI |
|---|---|
| 로딩 | `SkeletonRow` × 3 |
| 성공(데이터 있음) | 표(총 {total}건, UIUX §8) |
| **빈 상태**(소스 0건) | `EmptyState`: "등록된 지식베이스 소스가 없습니다." + "사내 사이트를 등록하면 정해진 주기로 바뀐 페이지만 골라 외부 RAG에 반영합니다." + `[+ 소스 추가]` |
| 오류 | `ErrorState` + 다시 시도 |
| 검색 결과 0건 | `EmptyState` + 필터 초기화 |
| 거버넌스 모드 ON(서버 설정) | 목록 위 상시 배너: "데이터 거버넌스 모드가 켜져 있습니다 — 출구 허용 목록에 없는 호스트는 저장할 수 없습니다"(EX-KB-18 안내) |
| 전송 전제 미확인 | 목록 위 상시 배너 `KbTransportAckNotice`(적재 전체가 막혀 있다는 안내 — 등록·미리보기는 가능) |

### 레이아웃 (데스크톱)

```
지식베이스 동기화                                          [+ 소스 추가]
─────────────────────────────────────────────────────────────────
⚠ 서버 운영자가 외부 RAG 전송 전제를 아직 확인하지 않았습니다.
  등록·미리보기는 가능하지만 적재는 시작할 수 없습니다.
─────────────────────────────────────────────────────────────────
[검색: 이름……]  [상태: 전체/사용중/일시중지 ▾]

이름          적재 위치         주기      마지막 실행         다음 실행        상태                        ⋮
인사규정 게시판  예시공사/인사/…   매일 03:00 ✔ 성공(2시간 전)  내일 03:00      사용 중 · 정리 필요 1        ⋮
공지사항        예시공사/공지     매일 06:00 ⓘ 미리보기 필요   —              사용 중 · 미리보기 필요       ⋮
복지 포털       예시공사/복지     매주 월 02시 ✖ 실패(어제)     오늘 02:00     사용 중 · 반복 실패          ⋮
```

### 컴포넌트 분해

```
KbSourcesPage
├── KbTransportAckNotice(조건부)
├── DataGovernanceModeBanner(조건부, 기존 컴포넌트 재사용)
├── 필터 바(검색어 · 사용중/일시중지)
├── KebabMenu × N: 수정 / 사용중지·재개 / 지금 실행(미리보기) / 삭제
├── 표 행마다: 이름(클릭→ KB3) · KbScopeField 요약 텍스트 · 주기 텍스트 ·
│   마지막 실행(KbRunStatusBadge + 상대 시각) · 다음 실행 · 배지 묶음
│   (KbSourceEnabledBadge · KbNeedsPreviewBadge · KbNeedsCleanupBadge ·
│    KbRepeatedFailureBadge · KbDemotedBadge)
├── KbSourceEditModal(등록·수정)
└── 삭제 확인 다이얼로그(KB7)
```

---

## 3.2 KB6 — 소스 등록·수정 모달 (`KbSourceEditModal`)

### 목적
S-1 흐름의 첫 단계 — 이름·시작 주소·범위·수집 옵션·적재 위치·주기·인증·개인정보 옵션을 입력하고 권리 확인을 받는다.

### 레이아웃

```
┌─ 소스 등록 ──────────────────────────────────────────────┐
│ 이름 * [__________________________]                      │
│                                                            │
│ ── 수집 대상 ──                                           │
│ 시작 주소 * [https://intra.example.local/hr/          ]  │
│           [+ 시작 주소 추가](최대 10개)                    │
│ 사이트맵(선택) [https://intra.example.local/sitemap.xml]  │
│           도움말 ⓘ "사이트맵 = 사이트가 제공하는 페이지 목록 파일" │
│                                                            │
│ ── 범위 ──                                                │
│ 경로 접두(선택, 비우면 전체) [/hr/                    ]   │
│ 제외 패턴(선택) [/hr/archive/*                        ]   │
│ 깊이 [3 ▾]   최대 페이지 [500    ] (서버 상한 5,000)      │
│ 수집 파일 형식 ☑PDF ☑DOCX ☑XLSX ☑PPTX  최대 20MB          │
│ ☑ robots.txt 준수(항상 켜짐 — 끌 수 없음)                  │
│                                                            │
│ ── 적재 위치(외부 RAG) ──                                  │
│ 회사 * [예시공사]  카테고리 [인사]  서브카테고리 [크롤_인사규정] │
│ 도움말: "이 소스가 만든 문서는 이 3단 아래에만 들어갑니다.    │
│         운영자가 직접 올린 문서와 섞이지 않게 전용 서브카테고리를 권장합니다." │
│                                                            │
│ ── 주기·인증 ──                                            │
│ 주기 (●) 매일 [03:00]  ( ) 매주 [월요일 ▾][02:00]  ( ) 수동 │
│ 인증 (●) 없음  ( ) 고정 헤더  헤더 이름[____] 참조 이름[HR] │
│   ⓘ 값은 서버 환경변수 KB_SECRET__HR 에서만 읽습니다.        │
│                                                            │
│ ── 개인정보 ──                                             │
│ ☑ 추출한 텍스트의 개인정보를 자동으로 가립니다(권장, 기본값) │
│ ☐ 문서 파일은 마스킹 없이 원본 그대로 전달합니다(기본 꺼짐)  │
│                                                            │
│ ☑ 이 사이트의 내용을 수집·이용할 권한이 있음을 확인합니다 *  │
│   (필수 — 감사 기록에 확인자·시각이 남습니다)                 │
│                                                            │
│                                    [취소]  [저장]           │
└────────────────────────────────────────────────────────────┘
```

### 필드-오류 매핑

| 필드 | 오류 조건 | 오류 메시지(인라인, UIUX §7) |
|---|---|---|
| 이름 | 빈 값 · 100자 초과 · 중복 | "이름을 입력하세요." / "100자 이내로 입력하세요." / "이미 사용 중인 이름입니다." |
| 시작 주소 | 빈 값 · http(s) 아님 · 사설 IP(허용 목록 밖) · 절대 차단 대역 · DNS 실패 | "주소를 1개 이상 입력하세요." / "http:// 또는 https://로 시작하는 주소를 입력하세요." / "사설 주소입니다. 서버 운영자에게 사설망 허용을 요청하세요."(`KB_HOST_NOT_ALLOWED · PRIVATE_NOT_ALLOWLISTED`) / "이 주소는 보안상 허용되지 않습니다."(`ABSOLUTE_BLOCKED`) / "주소를 확인할 수 없습니다."(`DNS_FAILED`) |
| 시작 주소(거버넌스 ON) | 출구 허용 목록 밖 | "데이터 거버넌스 설정에서 이 호스트가 허용되어 있지 않습니다."(`EGRESS_HOST_NOT_ALLOWED`) |
| 회사/카테고리/서브카테고리 | **3단 모두** 빈 값(구현 — 설계서 §25 I-25: `KbSourceScopeSchema` 3단 필수 계약과 일치 · RAG 답변 설정 스코프와 달리 카테고리도 필수) | "회사를 입력하세요."(외부 RAG 필수값) · 카테고리·서브카테고리도 각각 필수 문구(`errorScopeCategoryRequired`·`errorScopeSubcategoryRequired`) |
| 깊이/최대 페이지/파일 상한 | 서버 상한 초과 | "최대 {N}까지 입력할 수 있습니다." |
| 헤더 이름 | 금지 헤더(Host·Cookie 등) | "이 헤더 이름은 사용할 수 없습니다." |
| 마스킹 끄기 | 거버넌스 모드 ON | "데이터 거버넌스 모드에서는 마스킹을 끌 수 없습니다." |
| 원본 파일 전달 켜기 | 거버넌스 ON ∧ 서버가 허용하지 않음 | "서버 설정에서 원본 파일 전달이 허용되어 있지 않습니다." |
| 권리 확인 | 미체크 | "확인란에 체크해야 저장할 수 있습니다." |
| (저장 응답 `warnings[]`) | 스코프 중복 / 이 스코프를 읽는 챗봇 없음 | 저장은 성공 + 배너: "같은 적재 위치를 다른 소스가 사용하고 있습니다." / "이 적재 위치를 읽는 챗봇이 없습니다." |

- 소스 최대 50개 도달 시 "+ 소스 추가" 버튼 비활성 + 툴팁("소스는 최대 50개까지 등록할 수 있습니다").
- 실행 중인 소스의 범위·스코프·개인정보 필드 수정 시도 → 저장 버튼 클릭 시 `409 KB_SOURCE_BUSY` → "이 소스는 실행 중입니다. 먼저 중지한 뒤 수정하세요."(모달 유지, 값 보존).
- **구현(설계서 §25 I-27)**: 잡음 줄 패턴(`noisePatterns`)은 "범위" 섹션 안의 목록 입력으로 둔다 — 라벨 "잡음 줄 패턴(선택, 고급)" · 별도 접힘 섹션은 없다(`KbSourceEditModal.tsx:302-310` · `messages.ts:3651`).
- **구현(설계서 §25 I-28)**: 시작 주소·사이트맵·경로 접두·제외 패턴·잡음 줄 패턴의 여러 줄 입력은 `KbStringListField`가 기존 `ReorderableList`(No.27 선례)를 재사용한다(`KbStringListField.tsx:2·52`).
- **[pass 6 — 설계서 §25 I-72① · §25.4 · frontend 후속]** 서버의 경로 접두 비교가 **경로 세그먼트 단위**로 바뀌었다. 경로 접두 목록 입력에 도움말을 단다 — 목록 레이블 아래 보이는 텍스트로 두고 `aria-describedby`로 입력 묶음에 연결(색·툴팁만으로 전달하지 않음 — UIUX 준수기준). 권장 문구(`messages.ts` 1키 · 예: `formPathPrefixHint`): "경로 단위로 비교합니다. `/docs`는 `/docs`와 그 아래(`/docs/…`)만 포함하고 `/docs-guide`·`/docsecret`은 포함하지 않습니다." 입력 검증·저장 형식·동작 변경 없음. 제외 패턴 안내(글롭 `*`·`?`)는 그대로.
- **[pass 9 구현 — 설계서 §25 I-97③ · 접근성 결함 수정]** 한 모달에 목록 필드가 여럿(시작 주소·사이트맵·경로 접두·제외·잡음)인데 모두 같은 입력 id(`k0-input`)를 쓰던 결함을 `useId()` 접두로 고쳤다 — 레이블·오류 연결이 다른 필드의 입력을 가리키지 않는다(UIUX 레이블 연결 규칙). 도움말(`hint`)이 있으면 보이는 텍스트로 렌더하고 모든 행 입력의 `aria-describedby`에 도움말 id와 그 행 오류 id를 함께 연결한다(둘 다 없으면 속성 생략) — 경로 접두(`formPathPrefixHint`)와 사이트맵 도움말이 연결됨(시험 `KbStringListField.spec.tsx`).

---

## 3.3 KB3 — 소스 상세: 개요·미리보기 (`/settings/kb-crawling/:sourceId/overview`)

### 목적
S-1·S-4·S-8 흐름 — 소스의 현재 상태를 요약하고, 미리보기 결과를 확인한 뒤 "적재 시작"으로 첫 동기화를 승인한다.

### 상태별 UI

| 상태 | UI |
|---|---|
| 진행 중인 실행 없음 · `ingestApproved=true` | 요약 카드(마지막 실행·다음 실행·정리 필요·반복 실패) |
| **미리보기 필요**(`ingestApproved=false`) | `KbPreviewSummaryPanel` + "적재 시작" 버튼(비활성 사유는 §3.3.1) |
| 진행 중(`CRAWLING`/`INGESTING`) | `KbRunProgress` + "중지" 버튼 |
| 강등됨(`demotedReason`) | 배너: "자동 점검 결과 확인이 필요합니다 — {사유}" + 미리보기 패널 재표시 |
| **[pass 9 구현]** 최근 미리보기 실행에 `demotedReason`(PREVIEW `AUTH_WALL` — 소스 강등 아님 · 승인 유지) | 미리보기 카드 안 경고 `role="status"` — `msg.demotedBanner(사유 라벨)`(⚠ 아이콘은 `aria-hidden`) · 소스 배너(`reviewRequiredReason`)와 같은 사유면 중복 표시 생략 · "적재 시작"은 활성 그대로(`KbSourceOverviewPage.tsx` · 시험 `KbSourceOverviewPage.spec.tsx` "미리보기 강등(demotedReason) 경고") |
| **[pass 9 구현]** 적재 승인 409(`KB_INGEST_NOT_ALLOWED`) | 오류 배너(`role="alert"`) 문구 = `resolveApproveErrorText(details[0].message, e.message)` — ① `approveButtonDisabledReason` 표(전송 전제·RAG 미설정·미리보기 필요/오래됨·검토 필요) ② `failureCodeLabel` 표(`GOVERNANCE_MASK_REQUIRED`·`GOVERNANCE_RAW_FILE_NOT_ALLOWED` 등) ③ 서버 `message` ④ 일반 오류 문구 순 · 표 조회는 `hasOwnProperty`(프로토타입 키 오인 방지) · 빈 문구 없음(UIUX §7 — 원인·해결) **[웹 RG-27 구현 — 설계서 §25 I-108] `PREVIEW_STALE` 예외**: 이 코드는 서버에서 두 원인(설정 변경 / 강등 뒤 미리보기 없음)에 공통이므로, 서버 `message`가 비지 않고 원인 없는 기본 문구("유효한 미리보기 실행이 아닙니다." — `MESSAGES.kbRuns.approveGenericInvalidPreviewServerMessage`)가 아니면 **서버 문구를 그대로** 표시한다(강등 뒤 미리보기 없음 — 원인·해결 방법 포함) · 기본·빈 문구일 때만 ①의 "설정이 바뀌어…" · 다른 코드의 ①→②→③→④ 순서는 불변 |
| **[웹 후속 구현]** 거버넌스 규칙 위반(클라이언트 계산 `clientGovernanceViolation(meta, source)` — 서버 `governanceViolation()`과 같은 규칙: 모드 ON ∧ `piiMask === false` → `GOVERNANCE_MASK_REQUIRED`, 아니면 `allowRawFileIngest === true` ∧ 서버 허용 false → `GOVERNANCE_RAW_FILE_NOT_ALLOWED`) | "지금 미리보기 실행"·"적재 시작" `disabled` + 보이는 사유(`KbGovernanceBlockedHint` — ⚠ `aria-hidden` + `failureCodeLabel.GOVERNANCE_*`) · 기존 비활성 사유와 함께면 두 id를 `aria-describedby`에 · 메타가 없으면(모름) 활성 유지 + 서버 409 배너 폴백 · 쓰기 권한 없으면 사유 텍스트 없음 · 이미 승인되어 실행 버튼이 없는 상태에서는 사유도 없음(새 상태를 만들지 않음) · 소스 목록 케밥 "지금 실행"(`KebabMenuItem.describedBy?`)·문서 목록 "전체 다시 적재"도 같은 규칙 |
| 크롤 실패(`FAILED`) | `ErrorState` 계열 배너 + 실패 사유 텍스트(§4 오류 코드 표) |
| 소스가 삭제된 경우(직접 URL 접근) | `ErrorState`(404) — 구현(설계서 §25 I-32): `KbSourceShell`이 `GET /kb-sources/meta`를 먼저 부르고 성공한 뒤에만 `GET /kb-sources/:id`를 부른다. 둘 다 `NOT_FOUND`라 호출 순서로 구분한다 — meta 404 = 기능 꺼짐(KB12), 그 뒤의 404 = 소스 없음(`KbSourceShell.tsx:35-67·81-83`) |

### 레이아웃

```
인사규정 게시판                          사용 중 · 정리 필요 1
[개요] [실행 이력] [문서 목록]
─────────────────────────────────────────────────────────────
적재 위치: 예시공사 / 인사 / 크롤_인사규정
전송 전제: KbTransportAckBadge("내부망(운영자 확인)")
개인정보: 마스킹 켜짐 · 원본 파일 전달 꺼짐
─────────────────────────────────────────────────────────────
ⓘ 미리보기 필요 — 아래 결과를 확인한 뒤 적재를 시작하세요.

  적재 예정: 새로 41 · 바뀜 12    변경 없음: 259
  제외: robots 12 · 형식 아님 8 · 원본 파일 전달 꺼짐 5 · 개인정보 발견 2
  개인정보 마스킹: 9건
  ⚠ 최대 페이지(500) 도달 — 범위를 좁히는 것을 권장합니다.

                                          [적재 시작]
```

### 3.3.1 "적재 시작" 비활성 사유 (AC-KB7-2)

| 조건 | 버튼 상태 | 사유 텍스트 |
|---|---|---|
| 전송 전제 미확인 | 비활성 | "서버 운영자가 외부 RAG 전송 전제(내부망/인증/TLS)를 아직 확인하지 않았습니다."(`TRANSPORT_NOT_ACKNOWLEDGED`) |
| 외부 RAG 미설정 | 비활성 | "외부 RAG 서버가 설정되어 있지 않습니다."(`RAG_NOT_CONFIGURED`) |
| 미리보기 실행이 아직 없음 | 비활성 | "먼저 미리보기를 실행하세요."(`PREVIEW_REQUIRED`) — "지금 미리보기 실행" 버튼 함께 표시 |
| 설정이 미리보기 이후 바뀜 | 비활성 | "설정이 바뀌어 이전 미리보기가 유효하지 않습니다. 다시 미리보기를 실행하세요."(`PREVIEW_STALE`) |
| 자동 강등(새로 비율/인증 벽) | 활성(재확인 후 진행 가능) | 배너로 사유만 안내, 관리자가 결과를 확인하고도 진행할 수 있다 **[pass 11 서버 변경 — 설계서 §25 I-102 · 콘솔 미반영 = 설계서 §25.7 RG-27]** 서버는 최근 성공 미리보기가 강등을 만든 실행보다 **먼저** 끝났으면 `409 PREVIEW_STALE`로 거절한다(SYNC·FULL_RESEND 강등 뒤에는 새 미리보기 필요 · PREVIEW 자신의 NEW_RATIO 강등이면 그 미리보기로 승인 가능). ~~현재 콘솔은 이 경우에도 버튼이 활성이고 거절 배너가 "설정이 바뀌어…"(원인 불일치)로 뜬다 — 권장: 이 조건이면 비활성 + 사유 "적재가 보류된 뒤 새 미리보기가 필요합니다…"~~ **[웹 RG-27 구현 — 설계서 §25 I-108]** 예외: 강등 뒤에 끝난 미리보기가 **없다고 확실할 때는 비활성**(다음 행) · 그 밖(모름 포함)은 활성 유지 + 누르면 서버 409 `PREVIEW_STALE`의 서버 문구를 그대로 오류 배너에 표시(§3.3 상태표 "적재 승인 409" 행) |
| **[웹 RG-27 구현]** 강등 뒤에 끝난 미리보기가 없음(확실할 때만 — `isPreviewOlderThanDemotion`: `reviewRequiredReason` 있음 ∧ 실행 이력 첫 페이지(20건)에서 찾은 가장 늦은 강등 종료 시각(SYNC·FULL_RESEND의 모든 강등 + PREVIEW의 `NEW_RATIO` · PREVIEW `AUTH_WALL` 제외)보다 최근 성공 미리보기가 **먼저** 끝남 · 같으면 통과 · 창 안에 강등 실행이 없거나 종료 시각이 없으면 모름 = 활성) | 비활성(`disabled`) | ⚠(`aria-hidden`) + "내용이 크게 바뀌어 적재가 보류되었습니다. 그 뒤에 확인한 미리보기가 없으니 미리보기를 다시 실행해 결과를 확인한 뒤 적재를 시작하세요."(`MESSAGES.kbRuns.approveDisabledAfterDemotion` · 웹 로컬 사유 키 `PREVIEW_AFTER_DEMOTION_REQUIRED` — 계약 enum 아님) · 보이는 텍스트 + `aria-describedby` · 우선순위: 전송 전제 → RAG 미설정 → 미리보기 없음 → 설정 변경(`PREVIEW_STALE`) → 이 사유(사유는 하나만 표시 · 거버넌스 사유는 별도 문구로 함께) · 인증 벽 강등에는 "내용이 크게 바뀌어"가 맞지 않는다(설계서 §20 K-29 — 서버 문구와 같은 한계) |
| **[웹 후속 구현]** 거버넌스 규칙 위반(§3.3 상태표) | 비활성(`disabled`) | ⚠ + `failureCodeLabel.GOVERNANCE_*`(보이는 텍스트 — 비활성 버튼은 Tab 포커스를 받지 않으므로 사유를 항상 보이게 · 기존 사유와 함께면 `aria-describedby`에 두 id) |
| 위 사유 없음 | 활성 | — |

### 3.3.2 적재 시작 확인 다이얼로그 (KB8)

```
┌─ 적재를 시작할까요? ──────────────────────────────┐
│ 새로 41개 · 바뀜 12개 = 총 53개 문서를 외부 RAG에    │
│ 전송합니다. 문서당 평균 약 1분 → 예상 소요 약 53분.  │
│ (문서가 많으면 몇 시간이 걸릴 수 있습니다.)           │
│                                                     │
│                              [취소]  [적재 시작]    │
└─────────────────────────────────────────────────────┘
```
- 포커스 가두기·Esc 닫기(UIUX §3). 확인 버튼은 44×44px 이상(UIUX §4).
- 확정 시 `POST /kb-sources/:id/approve-ingest`. 성공 시 KB4(실행 이력) 탭으로 이동해 새 `SYNC` 실행을 보여준다.

---

## 3.4 KB4 — 소스 상세: 실행 이력 (`/settings/kb-crawling/:sourceId/runs`)

### 목적
S-1·S-6·S-7 흐름 — 과거·진행 중 실행을 시간 역순으로 보고, 진행 중 실행은 5초 간격으로 갱신하며, 필요하면 중지한다.

### 상태별 UI

| 상태 | UI |
|---|---|
| 로딩 | `SkeletonRow` × 3 |
| 빈 상태(실행 이력 없음) | `EmptyState`: "아직 실행 이력이 없습니다." |
| 진행 중 실행 있음 | 맨 위 행 고정 표시 + 5초 폴링(§0-2 규칙) |
| 오류 | `ErrorState` |

### 레이아웃

```
[개요] [실행 이력] [문서 목록]
─────────────────────────────────────────────────────
종류      트리거   상태                      시작         소요/진행
동기화     예약     ↻ 적재 중 · 312개 중 120개 완료 · 약 3시간 남음   03:00   진행 중  [중지]
동기화     예약     ✔ 성공(변경 없음 312)     어제 03:00   4분
동기화     예약     ◐ 일부 실패(3건)          그제 03:00   1시간 12분  [펼치기 ▾]
미리보기   수동     ✔ 성공(적재 예정 53)      3일 전 14:02  8분
```

### 3.4.1 펼침 상세 (진행/완료 공통)

```
  ▾ 크롤: 방문 312 · 새로 12 · 바뀜 3 · 변경 없음 297 · 정리 필요 1 ·
          제외 8(robots 5 · 형식 3) · 최대 페이지 도달 아님
    적재: 총 15 · 완료 12 · 실패 1 · 결과 불명 0 · 시간 초과 0 · 건너뜀 2
    대기 사유: 없음 / "외부 RAG 준비 안 됨" / "야간 적재 시간 대기(19:00~08:00만 대량 적재)"
    강등 사유: 없음 / "새 페이지 비율이 높아 확인이 필요합니다"
    (웹 후속 구현) PREVIEW + AUTH_WALL: "미리보기 경고 — 로그인 필요로 보임(승인은 유지됩니다)" · SYNC·FULL_RESEND의 AUTH_WALL·모든 종류의 NEW_RATIO: 기존 강등 문구
    실패 사유(있으면): KbRunFailureCode 텍스트(§4)
```

### 컴포넌트 분해

```
KbRunHistoryPage
├── KbRunTable(진행/완료 공통 행 + 펼침 — 구현 I-30: 펼치기 트리거는 <button aria-expanded aria-controls>, 상세 행·패널은 접혀도 DOM에 두고 hidden으로 숨김)
│   └── KbRunProgress(진행 중 행에만)
├── "중지" 버튼(진행 중 · security:write) → 확인 없이 즉시 중지
│   (되돌릴 수 없는 삭제가 아니므로 별도 확인 다이얼로그 없음 — 다음 예약이 다시 시도)
└── 5초 폴링(진행 중 실행이 있을 때만, WorkflowRunsPage 패턴) +
    sr-only aria-live 알림(상태가 바뀔 때만 — "적재 중 → 성공"처럼 텍스트가 갱신될 때만 낭독)
```

---

## 3.5 KB5 — 소스 상세: 문서 목록·정리 필요 (`/settings/kb-crawling/:sourceId/documents`)

### 목적
S-3·S-5 흐름 — 이 소스가 추적하는 URL 단위 상태를 보고, "정리 필요" 문서를 확인해 외부 RAG에서 정리한 뒤 전체 다시 적재를 실행한다.

### 상태별 UI

| 상태 | UI |
|---|---|
| 로딩 | `SkeletonRow` × 5 |
| 빈 상태(문서 0건 — 아직 실행 안 됨) | `EmptyState`: "아직 수집된 문서가 없습니다. 먼저 실행하세요." |
| 필터 결과 0건(구현 — 설계서 §25 I-31) | 별도 `EmptyState`(`emptyFilterTitle`) + [필터 초기화] 버튼(상태·정리 필요만·제외 사유 해제 · 1쪽으로) — `KbDocumentListPage.tsx:114-123·197-207` |
| 정리 필요 1건 이상 | 상단 `KbCleanupBanner` 상시 노출 |
| 오류 | `ErrorState` |

### 레이아웃

```
[개요] [실행 이력] [문서 목록]
─────────────────────────────────────────────────────
⚠ 정리 필요 1건 — 외부 RAG에 이 문서의 옛 내용이 남아 있어 답변에 쓰일 수 있습니다.
  외부 RAG에서 "예시공사 / 인사 / 크롤_인사규정"을 정리한 뒤 아래 버튼을 누르세요.
  [서브카테고리 이름 복사]                          [전체 다시 적재]
─────────────────────────────────────────────────────
[상태: 전체▾] [정리 필요만 ☐] [제외 사유▾] [실행▾]

URL(경로)              상태    정리 필요     마지막 변경   마지막 적재   외부 파일 이름
/hr/rules/2019-05.html 없어짐  없어짐        2일 전       —          kb_a1b2c3d4_… [복사]
/hr/rules/2020-01.html 있음    —             1시간 전     방금        kb_a1b2c3d4_… [복사]
/hr/rules/old-2015.pdf 있음    짧아짐        1시간 전     방금        kb_a1b2c3d4_… [복사]
```

### 3.5.1 전체 다시 적재 확인 다이얼로그 (KB9)

```
┌─ 전체 다시 적재 ─────────────────────────────────────┐
│ 이 소스의 활성 문서 {N}건을 다시 적재합니다(변경 여부와  │
│ 무관하게 전부 전송). 예상 소요 약 {H}시간.               │
│                                                        │
│ ☐ 외부 RAG에서 이 서브카테고리를 정리했습니다 *          │
│   (체크해야 진행할 수 있습니다 — 감사 기록에 남습니다)    │
│                                                        │
│                              [취소]  [전체 다시 적재]   │
└────────────────────────────────────────────────────────┘
```
- 포커스 가두기·Esc(UIUX §3). 체크 없이 "전체 다시 적재" 클릭 시 인라인 오류: "확인란에 체크해야 진행할 수 있습니다."
- 확정 시 `POST /kb-sources/:id/runs { kind: 'FULL_RESEND', acknowledgeCleanup: true }` → KB4 탭으로 이동.

### 정리 필요 사유별 안내 문구(`KbCleanupReasonBadge` 툴팁 겸용)

| 사유 | 배지 라벨 | 안내 |
|---|---|---|
| `GONE` | 없어짐 | "사내 사이트에서 이 페이지가 사라졌습니다." |
| `SHRUNK` | 짧아짐 | "내용이 크게 줄었습니다 — 옛 내용 일부가 외부에 남아 있을 수 있습니다." |
| `ROBOTS_DISALLOWED` | robots에서 막힘 | "사이트의 수집 허용 규칙이 바뀌어 더 이상 이 페이지를 수집할 수 없습니다." |
| `SCOPE_CHANGED` | 적재 위치 변경됨 | "이 소스의 적재 위치(회사/카테고리/서브카테고리)가 바뀌었습니다 — 예전 위치에 옛 내용이 남아 있을 수 있습니다." |
| `FORMAT_CHANGED` | 형식 변경됨 | "문서 변환 형식이 바뀌었습니다 — 예전 형식의 파일이 외부에 남아 있을 수 있습니다." |

### 제외 사유별 안내 문구(`KbExcludeReasonBadge`)

| 사유 | 라벨 |
|---|---|
| `ROBOTS` | robots에서 제외 |
| `TYPE` | 지원하지 않는 형식(PDF로 변환해 게시를 권장합니다) |
| `SIZE` | 크기 초과 |
| `REDIRECT_OUT_OF_SCOPE` | 리다이렉트 범위 밖 |
| `NO_BODY` | 본문 없음(화면을 스크립트로 그리는 사이트로 보임) |
| `NOINDEX` | 검색 제외 표시(noindex) |
| `RAW_FILE_OFF` | 원본 파일 전달 꺼짐 |
| `ENCODING` | 인코딩 문제 |
| `PII_IN_RAW_FILE` | 마스킹 없이 개인정보 형식 발견 |
| `FILE_UNSAFE` | 파일을 안전하게 처리할 수 없음 |
| `FILE_ENCRYPTED` | 암호로 잠긴 파일 |
| `AUTH_WALL` | 로그인이 필요한 것으로 보임 |

---

## 3.6 KB7 — 소스 삭제 확인 다이얼로그

```
┌─ 소스를 삭제할까요? ───────────────────────────────┐
│ "인사규정 게시판" 소스와 이 소스가 추적한 문서 342건의  │
│ 기록이 삭제됩니다.                                    │
│ ⚠ 외부 RAG에 이미 넣은 문서는 지워지지 않습니다        │
│   (AC-KB7-4 — 외부 삭제 호출을 하지 않습니다).         │
│                                                       │
│                              [취소]  [삭제]           │
└───────────────────────────────────────────────────────┘
```
- 실행 중이면 삭제 자체를 시도하지 못하도록 케밥 메뉴에서 "삭제" 항목을 비활성 + 툴팁("실행 중에는 삭제할 수 없습니다 — 먼저 중지하세요"). 그래도 경합으로 서버가 `409 KB_SOURCE_BUSY`를 반환하면 토스트로 안내.

---

## 3.7 KB10 — 챗봇 답변 설정: 지식베이스 동기화 상태 카드

### 목적
S-8·EX-KB-17·EX-KB-20 — RAG 스코프를 설정하는 EDITOR가 "이 챗봇이 읽는 지식베이스가 얼마나 최신인지" 별도 화면 이동 없이 확인한다.

### 위치
`AnswerSettingsPage.tsx`의 RAG 스코프 입력 영역(`ragCompany`/`ragCategory`/`ragSubcategory` 필드) 바로 아래.

### 레이아웃

```
── RAG 지식베이스 연동 ──
회사 [예시공사]  카테고리 [인사]  서브카테고리 [        ]

┌─ 지식베이스 동기화 상태 ────────────────────────────┐
│ 이 스코프로 자동 수집하는 소스 2개                     │
│  · 인사규정 게시판 — 마지막 동기화: 2시간 전 · 정리 필요 0│
│  · 사내 공지 크롤러 — 마지막 동기화: 1일 전 · 정리 필요 1 │
│ ⓘ 지식베이스 동기화는 환경(스테이징/운영)과 무관하게    │
│   즉시 반영됩니다.                                     │
└───────────────────────────────────────────────────────┘
```

### 상태별 UI

| 상태 | UI |
|---|---|
| 이 스코프를 읽는 소스 있음 | 위 카드 |
| 이 스코프를 읽는 소스 0개 | "이 스코프로 자동 수집하는 소스가 없습니다."(EX-KB-17 — 오타 의심 안내) |
| 기능 꺼짐(`KB_SYNC_ENABLED=false`) | 카드 자체를 렌더하지 않음(`meta` 404) |
| 로딩 | 카드 자리에 `SkeletonRow` 1개 |
| 오류 | 카드를 조용히 생략(다른 답변 설정 저장을 막지 않는다 — 부가 정보이므로 토스트도 띄우지 않음) |
| 환경 모드 챗봇이 아님 | "환경과 무관하게 즉시 반영됩니다" 문구 생략(해당 없음) |

- 데이터 원천: `GET /chatbots/:chatbotId/kb-status`(`chatbot:read`) — URL·호스트 미노출(R-26), 이름·마지막 동기화·정리 필요 건수만.

---

## 3.8 KB11 — 데이터 지도: 지식베이스 동기화 절

### 목적
보안 담당자가 데이터 지도 한 화면에서 "어떤 사설/사내 호스트로 나가고 있고, 어떤 문서가 외부로 나가는지"를 확인한다.

### 위치
`DataGovernanceMapPage.tsx`의 §"출구" 표 아래 — `egress.workflowTargets` 절과 같은 위치·형식으로 추가(`egress.kbSources` 선택 키, 0개면 절 자체가 렌더되지 않는다). **구현(설계서 §25 I-26)**: 실제 키는 응답 **최상위** `kbSources`(`GovernanceMapResponse.kbSources` — `egress` 아래가 아니다)다. 이 문서의 `egress.kbSources` 표기는 모두 같은 뜻이다(`DataGovernanceMapPage.tsx:238-241`).

### 레이아웃

```
── 출구(외부로 나가는 연결) ──
출구                    호스트                데이터 종류        마스킹      판정
지식베이스 수집(크롤러)   (소스별 — 아래 참고)   요청 정보          해당 없음   허용

── 지식베이스 동기화 ──
소스              호스트                     판정   마스킹   원본 파일 전달   회사       전송 전제
인사규정 게시판    intra.example.local        허용   켜짐     꺼짐            예시공사    내부망(운영자 확인)
공지사항          intra.example.local        허용   켜짐     꺼짐            예시공사    내부망(운영자 확인)
```

- `KB_CRAWL` 출구 행 자체는 소스가 있든 없든 항상 1행 표시(레지스트리 상시 등록) — 호스트 칸은 "(소스별 — 아래 참고)"로, 소스별 실제 호스트·판정은 `kbSources` 절이 담당한다(설계서 R-2 — 데이터 종류는 소스 단위로 더 정확히 표시).
- 소스 0개 설치는 `kbSources` 절 전체가 렌더되지 않는다(응답 바이트 변화 없음 확인용 — FR-0-203).

---

## 3.9 KB12 — 기능 꺼짐 상태

- `SystemSettingsMenu`는 `GET /kb-sources/meta`가 `404`면 "지식베이스 동기화" 항목을 렌더하지 않는다(다른 3개 메뉴 항목과 같은 판단 로직 — `can('security:read')`는 참이어도 항목 자체가 없다).
- 메뉴에 없는 상태에서 `/settings/kb-crawling`으로 직접 이동하면(북마크·뒤로가기 등) `KbSourcesPage`가 `meta` 호출에서 `404`를 받아 `ErrorState`(제목: "지식베이스 동기화 기능을 사용할 수 없습니다", 설명: "서버 설정에서 이 기능이 꺼져 있습니다. 관리자에게 문의하세요.") + "설정 메인으로" 링크만 보여준다(다시 시도 버튼 없음 — 서버 설정이라 재시도로 해결되지 않는다).
- KB10(챗봇 카드)·KB11(데이터 지도 절)도 같은 신호로 조용히 숨는다(오류 배너 없음 — 애초에 없는 기능처럼 보인다).

---

## 4. 사용자 인터랙션 흐름 종합

### 4.1 사내 규정 게시판 등록 → 미리보기 → 적재 시작 (S-1)
`KB2 "+ 소스 추가"` → `KB6` 폼 작성·권리 확인 체크 → 저장(`201`) → 자동으로 `KB3` 개요 탭 이동, 첫 예약 실행이 `PREVIEW`로 자동 생성(또는 "지금 실행"으로 즉시 트리거) → 크롤 진행(`KbRunProgress`) → 완료 시 `KbPreviewSummaryPanel` 표시(적재 예정 312 · 제외 27 · 마스킹 9) → "적재 시작" 클릭 → `KB8` 확인 다이얼로그 → 승인 → `KB4` 실행 이력에 새 `SYNC` 실행이 나타나고 진행률이 5초마다 갱신된다.

### 4.2 변경 없는 날 (S-2)
예약 실행이 자동으로 시작 → 크롤 완료 후 적재 작업 0건 → `KB4`에 "성공(변경 없음 312)"만 남는다. 사용자 조작 없음(배경 실행).

### 4.3 페이지 삭제 → 정리 필요 (S-3)
2회차 예약 실행에서 404 감지 → `KB5` 문서 목록에 "없어짐" 상태 + `KbCleanupBanner` 노출 → 관리자가 서브카테고리 이름을 복사해 외부 RAG 콘솔에서 정리 → 돌아와 `KB9` "전체 다시 적재" 확인 다이얼로그에서 확인 체크 후 진행.

### 4.4 범위 실수 방지 (S-4)
등록 시 시작 주소를 사내 포털 첫 화면으로 잘못 입력 → 미리보기에서 "최대 페이지(500) 도달 — 범위를 좁히세요" 경고(`KB3`) → 관리자가 `KB6` 수정 모달에서 경로 접두를 `/hr/`로 좁힘 → 저장(설정이 바뀌어 다시 `PREVIEW`) → 재확인 후 적재 시작.

### 4.5 개인정보 포함 페이지 (S-5)
미리보기 결과에 "마스킹 9건" 표시(`KbPreviewSummaryPanel`) · 원본 파일 전달이 꺼진 소스의 PDF는 제외 목록에 `RAW_FILE_OFF`로 표시되고 실제로 적재되지 않는다.

### 4.6 외부 RAG 재시작 / vLLM 장애 (S-6·S-7, 운영 — 사용자 조작 없음)
`KB4` 진행 중 실행이 "대기 사유: 외부 RAG 준비 안 됨"을 보여주며 자동으로 재시도한다. 관리자는 지켜보기만 하면 된다(수동 개입 불필요).

### 4.7 거버넌스 모드 고객 (S-8, 서버 운영자)
`KB6` 저장 시 시작 주소 호스트가 출구 허용 목록 밖 → 인라인 오류(`EGRESS_HOST_NOT_ALLOWED`, §3.2 표) → 운영자가 서버 환경변수에 호스트를 추가 → 재시도 후 저장 성공.

**[pass 8 — 설계서 §10 · §25 I-86 · PM 결정 2026-09-28]** 거버넌스 모드를 켜기 **전에** 마스킹 끔(또는 서버 허용 없이 원본 파일 전달)으로 저장해 둔 소스는 모드를 켠 뒤 `KB2`/`KB3`에서 "미리보기 실행"·"적재 시작"·"전체 다시 적재"가 `409`로 거부되고(문구 "거버넌스 모드에서는 개인정보 마스킹을 끌 수 없습니다. 소스를 수정해 마스킹을 켜 주세요."), 예약 실행은 건너뛰며, 진행 중이던 적재는 제출 직전에 중지돼 `KB4` 실행 이력에 사유(실패 코드 라벨)가 남는다. 관리자는 `KB6`에서 마스킹을 켜거나 원본 파일 전달을 끈 뒤 다시 미리보기부터 진행한다.

### 4.8 SSRF 시도 차단 (S-9, 운영 — 사용자 조작 없음)
크롤 중 링크가 절대 차단 주소로 리다이렉트되면 그 링크만 조용히 건너뛰고 실행 요약에 포함되지 않는다(관리자에게 노출되는 오류가 아니다 — 정상 동작).

---

## 5. 권한별 화면 요소

| 요소 | ADMIN(`security:write`) | 보기 전용(`security:read`) | EDITOR(`chatbot:read`) | VIEWER·AGENT | 권한 없음 |
|---|---|---|---|---|---|
| `SystemSettingsMenu` "지식베이스 동기화" 항목 | 보임 | 보임 | 안 보임 | 안 보임 | 안 보임 |
| KB2 소스 목록 | 보임 + 등록·수정·삭제·실행 버튼 | 보임(버튼 비활성 또는 없음) | 접근 시 403 | 접근 시 403 | 접근 시 403 |
| KB3~KB5 소스 상세 | 모든 조작 가능 | 조회만(중지·적재 시작·전체 다시 적재 버튼 없음) | 403 | 403 | 403 |
| KB10 챗봇 카드 | 보임 | 보임 | **보임**(읽기 전용) | **보임**(읽기 전용) | 안 보임(`chatbot:read` 없음) |
| KB11 데이터 지도 절 | 보임 | 보임 | 접근 시 403(데이터 지도 페이지 자체가 `security:read`) | 403 | 403 |

- No.26·No.41과 같은 원칙: `security:write`가 있으면 `security:read`는 함께 부여되므로, 화면 내부에서 "쓰기만 되고 읽기는 안 되는" 상태를 분기하지 않는다.

---

## 6. 상태별 화면(로딩/빈/오류) 총정리

| 화면 | 로딩 | 빈 상태 | 오류 | 기능 꺼짐 |
|---|---|---|---|---|
| KB2 소스 목록 | `SkeletonRow`×3 | "등록된 소스가 없습니다" + 추가 버튼 | `ErrorState`+재시도 | `ErrorState`(재시도 없음)→§3.9 |
| KB3 개요 | `SkeletonRow`×2 | (해당 없음 — 소스는 항상 존재) | `ErrorState` | 상위에서 이미 차단 |
| KB4 실행 이력 | `SkeletonRow`×3 | "아직 실행 이력이 없습니다" | `ErrorState` | 〃 |
| KB5 문서 목록 | `SkeletonRow`×5 | "아직 수집된 문서가 없습니다" | `ErrorState` | 〃 |
| KB10 챗봇 카드 | `SkeletonRow`×1 | "이 스코프로 자동 수집하는 소스가 없습니다" | 조용히 생략 | 카드 자체 생략 |
| KB11 데이터 지도 절 | (상위 페이지 로딩에 포함) | 절 자체 생략(소스 0개) | (상위 페이지 오류에 포함) | 절 자체 생략 |

---

## 7. `messages.ts` 키 설계 (`apps/web/src/constants/messages.ts`)

### 7.1 `MESSAGES.systemSettings`(확장)

```
kbCrawling: '지식베이스 동기화',
```

### 7.2 신규 네임스페이스 `MESSAGES.kbSources`

```
pageTitle, addButton, emptyTitle, emptyDesc, loadFailed, saveSuccess, deleteSuccess,
columnName, columnScope, columnSchedule, columnLastRun, columnNextRun, columnStatus, columnActions,
badgeEnabled, badgeDisabled, badgeNeedsPreview, badgeNeedsCleanup(count), badgeRepeatedFailure, badgeReviewRequired,
reviewReasonLabel: { NEW_RATIO, AUTH_WALL },
scheduleLabel: { MANUAL, DAILY, WEEKLY },
authLabel: { NONE, STATIC_HEADER },
transportAckLabel: { INTERNAL_NETWORK, AUTHENTICATED, TLS, UNCONFIGURED },
transportAckMissingBanner,
governanceModeBanner,
formNameLabel, formSeedUrlsLabel, formSitemapLabel, formSitemapHelp,
formPathPrefixLabel, formExcludeLabel, formMaxDepthLabel, formMaxPagesLabel, formFileTypesLabel, formMaxFileBytesLabel,
formRobotsAlwaysOnLabel,
formScopeLabel, formScopeHelp,
formScheduleLabel, formAuthLabel, formAuthSecretRefHelp,
formPiiMaskLabel, formRawFileLabel,
formRightsConfirmLabel, formRightsConfirmError,
formRangeChangedNotice,
warningDuplicateScope, warningNoChatbotReadsScope,
errorNameRequired, errorNameTooLong, errorNameDuplicate,
errorSeedUrlRequired, errorSeedUrlInvalidScheme,
errorHostPrivateNotAllowlisted, errorHostAbsoluteBlocked, errorHostDnsFailed, errorHostEgressBlocked,
errorScopeCompanyRequired, errorLimitExceeded, errorHeaderNameForbidden,
errorMaskOffGovernance, errorRawFileOffServer,
sourceBusyError, deleteConfirmTitle, deleteConfirmBody, deleteConfirmExternalNotice,
sourceLimitReachedTooltip,
```

### 7.3 신규 네임스페이스 `MESSAGES.kbRuns`

```
tabOverview, tabRuns, tabDocuments,
overviewScopeLabel, overviewTransportAckLabel, overviewPiiLabel,
previewRequiredBanner, previewStaleBanner, ragNotConfiguredBanner,
approveButton, approveDialogTitle, approveDialogBody(count, minutes), approveButtonDisabledReason: { TRANSPORT_NOT_ACKNOWLEDGED, RAG_NOT_CONFIGURED, PREVIEW_REQUIRED, PREVIEW_STALE },
runNow Button, runKindLabel: { PREVIEW, SYNC, FULL_RESEND },
triggerLabel: { SCHEDULED, MANUAL, APPROVAL },
statusLabel: { QUEUED, CRAWLING, INGESTING, SUCCEEDED, PARTIAL, FAILED, CANCELLED, INTERRUPTED },
failureCodeLabel: { ALL_SEEDS_UNREACHABLE, ROBOTS_UNREACHABLE, EGRESS_BLOCKED, HOST_NOT_ALLOWED, SECRET_MISSING, RAG_NOT_CONFIGURED, INGEST_NOT_ACKNOWLEDGED, CANCELLED_BY_USER, SOURCE_DISABLED, CONFIG_CHANGED },   // [구현 — 설계서 §25 I-46·I-49] 서버가 현재 내는 값 = SECRET_MISSING · INGEST_NOT_ACKNOWLEDGED · RAG_NOT_CONFIGURED · (pass 5) ALL_SEEDS_UNREACHABLE · ROBOTS_UNREACHABLE · CANCELLED_BY_USER · SOURCE_DISABLED(CANCELLED 실행에도 붙음). EGRESS_BLOCKED · HOST_NOT_ALLOWED · CONFIG_CHANGED는 라벨만(망라 컴파일)
waitingReasonLabel: { RAG_NOT_READY, BULK_WINDOW, RATE_LIMIT },
progressText(done, total), etaText(hours), cancelButton, cancelSuccess,
crawlSummaryText(discovered, added, changed, unchanged, needsCleanup, excluded),
ingestSummaryText(total, succeeded, failed, unknown, timeout, skipped),
emptyTitle, loadFailed,
liveStatusChanged(prevLabel, nextLabel),   // sr-only aria-live 알림 전용
```

### 7.4 신규 네임스페이스 `MESSAGES.kbDocuments`

```
columnUrl, columnState, columnCleanup, columnLastChanged, columnLastIngested, columnFileName, copyFileName,
stateLabel: { ACTIVE, GONE, EXCLUDED },
cleanupReasonLabel: { GONE, SHRUNK, ROBOTS_DISALLOWED, SCOPE_CHANGED, FORMAT_CHANGED },
excludeReasonLabel: { ROBOTS, TYPE, SIZE, REDIRECT_OUT_OF_SCOPE, NO_BODY, NOINDEX, RAW_FILE_OFF, ENCODING, PII_IN_RAW_FILE, FILE_UNSAFE, FILE_ENCRYPTED, AUTH_WALL },
cleanupBannerTitle(count), cleanupBannerBody(scopeText), copyScopeButton,
fullResendButton, fullResendDialogTitle, fullResendDialogBody(count, hours),
fullResendAckLabel, fullResendAckError,
emptyTitle, loadFailed,
filterState, filterCleanupOnly, filterExcludeReason, filterRun,
```

### 7.5 `MESSAGES.dataGovernance.map`(확장)

```
exitLabel.KB_CRAWL: '지식베이스 수집(크롤러)',
dataKindLabel.CRAWL_REQUEST: '요청 정보',
dataKindLabel.DOCUMENT_BODY: '문서 본문 → 외부 RAG',
maskedLabel.NOT_APPLICABLE: '해당 없음',
kbSourcesSectionTitle: '지식베이스 동기화',
kbSourcesColumnScope, kbSourcesColumnTransportAck,
kbSourcesHostPlaceholder: '(소스별 — 아래 참고)',
```

### 7.6 챗봇 답변 설정(RAG 영역, 기존 네임스페이스 확장 — 실제 위치는 `MESSAGES.answerSettings.rag` 또는 동등 그룹)

```
kbStatusCardTitle, kbStatusSourceCount(count), kbStatusLastSyncedLabel, kbStatusNeedsCleanupLabel,
kbStatusEmptyText, kbStatusEnvironmentNotice, kbStatusLoadFailedSilent,
```

---

## 8. `UIUX_준수기준.md` 체크리스트 매핑

### 8.1 공통(이 그룹 신규/확장 화면 전체)

| 항목 | 준수 방법 |
|---|---|
| §1 색상 단독 금지 | 모든 배지(`Kb*Badge`)가 아이콘/텍스트를 색상과 함께 표기 |
| §2 타이포그래피 | 기존 `settings-page`·`dialogue-table` 클래스 재사용(대비·자간 기검증) |
| §3 키보드 접근성 | 확인 다이얼로그(KB8·KB9·삭제) 포커스 가두기 + Esc 닫기 + 트리거로 포커스 복귀. 케밥 메뉴·탭(`role=tab`)은 기존 컴포넌트 그대로 |
| §4 버튼 44×44px | "적재 시작"·"전체 다시 적재"·"중지"·케밥 버튼 전부 기존 `.btn` 클래스(이미 충족) |
| §5 텍스트 입력 | 시작 주소·경로 패턴 등 입력 필드에 `<label>` 연결 + 도움말(`aria-describedby`) |
| §6 폼 컨트롤 | `KbScheduleField`·`KbAuthField`의 라디오 선택에 따른 조건부 필드 표시 — 조건부 필드도 동일한 라벨·오류 규약 |
### 8.2 화면별 세부

| 화면 | 체크리스트 |
|---|---|
| KB6 등록 폼 | §5(모든 입력 라벨·도움말) · §6(라디오·체크박스 그룹 `fieldset`/`legend`) · §7(오류는 필드 바로 아래 인라인, 색상+텍스트+아이콘) |
| KB8·KB9 확인 다이얼로그 | §3(포커스 가두기·Esc) · §4(버튼 크기) · §7(체크박스 미체크 시 인라인 오류) |
| KB4 실행 이력(폴링) | §8 로딩/실시간 갱신 — 진행 중 건이 있을 때만 5초 폴링, 스크롤·펼침 상태 유지, 상태 변화 시에만 1회 `aria-live` 알림(전체 재낭독 금지, §0-2 판단) |
| KB2·KB5 목록·필터 | §9 내비게이션(탭·필터 위치 일관 · 브레드크럼 없이도 뒤로가기로 KB2 복귀) |
| 메뉴(KB1)·탭(`KbSourceShell`) | §3(키보드로 탭 전환) · §9(현재 위치 `aria-selected`) |

---

## 9. 반응형 고려사항

- **데스크톱(≥1024px)**: 표 레이아웃 그대로(§3의 ASCII 레이아웃 기준).
- **태블릿·모바일(<1024px)**: 기존 `dialogue-table desktop-only` / `settings-card-list mobile-only` 이중 렌더 패턴을 그대로 따른다(예: `DataGovernanceMapPage`의 `exits` 표 ↔ 카드 목록 전환 참고).
  - KB2 소스 목록 → 모바일에서는 카드형(`settings-card`)으로 전환: 이름 + 배지 묶음 상단, 하단에 적재 위치·주기·마지막/다음 실행을 `<dl>`로.
  - KB5 문서 목록 → 열이 6개로 많아 모바일에서는 카드형 + "정리 필요"·"제외 사유"만 상단 배지로 강조하고 나머지는 `<dl>` 접기.
  - KB6 등록 모달 → 모바일에서 전체 화면 시트로 전환(기존 `ApiConnectionEditModal` 모바일 처리와 동일 규약), 섹션(수집 대상/범위/적재 위치/주기·인증/개인정보)마다 `<h3>` 구분으로 스크롤 위치를 가늠하게 한다.
  - `KbRunProgress` 진행 텍스트는 좁은 화면에서도 한 줄 요약("312개 중 120개 완료")을 우선 표시하고, 상세 수치(크롤/적재 분리)는 펼침으로 감춘다.
- **위젯(`apps/widget`) 변경 0건** — 이 그룹은 챗봇 대화창·입력창·카드 응답에 어떤 영향도 주지 않는다(공개 대화 경로 불변).

---

## 10. Out of scope / 재검토 트리거

- 문서 1건 삭제·소스 재구축(스코프 통째 삭제 후 재적재) 화면 — 2차(요구사항 J-4 (b), 봉인 재개 필요).
- 동기화 실패 콘솔 알림(이메일·업무 자동화 웹훅 연동) — No.41 2차 "운영 이벤트" 묶음과 함께(J-17).
- 매번 승인 필요 옵션(소스별 "항상 미리보기"모드) — 규제 업종 고객용 2차 옵션(P-4 (b)).
- 로그인 필요 사이트·SPA(헤드리스 브라우저)·공유 드라이브 커넥터 — 수집 대상 2차 확장(P-2 (b)~(d)).
- HTML 변환 형식 선택 UI(`KB_HTML_INGEST_FORMAT`)는 **서버 환경변수 전용**이며 콘솔에 노출하지 않는다(Q-1 확인 전 기본값 DOCX — 운영 문서로만 안내).

---

## 11. 다음 단계 인계 (`frontend-implementer`)

- 우선순위: ① KB2·KB6·KB7(소스 CRUD, No.26 코드 복제로 가장 빠름) ② KB3·KB8(미리보기·적재 시작 — 신규 상태기계 UI) ③ KB4(실행 이력·폴링) ④ KB5·KB9(문서 목록·정리 필요) ⑤ KB10·KB11(기존 화면 확장, 가장 마지막 — 다른 화면과 충돌 최소화).
- `KbScopeField`는 **새로 만들지 말고** 답변 설정의 RAG 스코프 3단 입력 컴포넌트를 그대로 재사용(컴포넌트 이름·위치는 프런트 구현자가 실제 코드에서 확인).
- 실행 이력 폴링은 `WorkflowRunsPage`의 `useLatestRequest` + `pollRef` 패턴을 그대로 복사해도 무방하다(요청 경합 방지 로직 포함).

---

## 12. 설계서와 다르게 판단했거나 설계서에 없어 가정한 사항 (ui-designer 판단 기록)

1. **`AsyncJobProgress`를 진행률 폴링에 그대로 쓰지 않는다.** 이 컴포넌트의 루트가 `aria-live="polite"`로 고정돼 있어(§3.4 코드 확인), 5초마다 값이 바뀌면 진행률 전체가 매번 낭독될 위험이 있다. 설계서 §12 화면 5 "상태가 바뀔 때만 알림"을 지키기 위해 시각적 표시(스피너·진행바)만 이 컴포넌트에서 가져오고, 화면낭독 알림은 `WorkflowRunsPage`식 별도 sr-only `aria-live` 텍스트(상태 문자열이 실제로 바뀔 때만 갱신)로 분리했다. **frontend-implementer 확인 필요**: `AsyncJobProgress`에 `announceOnChangeOnly` 같은 옵션을 추가해 공용 컴포넌트를 확장할지, 이 그룹만 별도 래퍼(`KbRunProgress`)를 둘지는 구현 시점에 더 저렴한 쪽으로 정해도 된다(둘 다 이 문서의 요구사항을 만족한다). **→ 구현(설계서 §25 I-29)**: 공용 컴포넌트에 선택 prop `live?: boolean`(기본 `true` = 현행)을 더했다. `false`면 루트의 `role="status"`/`aria-live`와 sr-only 문구를 빼고 시각 표시만 한다. `KbRunProgress`는 `live={false}` + 별도 sr-only `aria-live` 텍스트를 쓴다(`AsyncJobProgress.tsx:8-14·22-32` · `KbRunProgress.tsx:33-34`).
2. **소스 상세를 단일 페이지가 아니라 3탭 셸(`KbSourceShell`)로 설계했다.** 설계서 §12는 화면을 9개 항목으로만 나열하고 라우트 구조를 지정하지 않았다. 개요·실행 이력·문서 목록이 각각 독립적으로 갱신 주기·필터·액션이 달라 워크플로우(No.41)의 탭 셸 패턴을 그대로 가져오는 것이 가장 일관적이라고 판단했다.
3. **"지금 실행"(수동 실행) 진입점을 KB2 목록의 케밥 메뉴에도 두었다.** 요구사항·설계서는 수동 실행 API(`POST …/runs`)만 정의하고 UI 진입점을 명시하지 않아, No.26·No.28의 "케밥 메뉴에서 즉시 동작 트리거" 관례를 따랐다.
4. **챗봇 답변 설정 카드(KB10)의 오류 상태를 "조용히 생략"으로 정했다.** 이 카드는 부가 정보이며, 답변 설정 저장이라는 주된 작업을 막아서는 안 된다고 판단했다(설계서에 명시되지 않음 — 다른 부가 카드가 이미 이런 절제 원칙을 쓰고 있는지는 frontend-implementer가 기존 코드 관례를 재확인해도 좋다).
5. **`KB_CRAWL` 출구 행의 호스트 칸 표시를 "(소스별 — 아래 참고)"로 정했다.** 설계서(§3.4 거버넌스 편입)는 `KB_CRAWL` 출구 자체는 지도의 `exits[]`에서 **제외**하고 `kbSources` 절만 소스 단위로 보여주도록 정했는데, §6.1은 동시에 `KB_CRAWL`을 "레지스트리에 등록"한다고 했다. 두 요구가 충돌하지 않도록, 이 문서는 **`exits[]`에는 `KB_CRAWL` 행이 나타나지 않는다**(제외 목록에 있으므로)로 확정하고, 위 표의 "출구" 절 예시는 설명용으로만 남긴다 — **frontend-implementer는 실제 `GovernanceMapResponse` 스키마를 재확인**해 `exits[]`에 `KB_CRAWL`이 없으면 그 행을 그리지 않아야 한다(설계서 KB-21 단언과 일치).

---

## 13. 사용자 확인이 필요한 UX 선택

1. **소스 상세 탭 순서·이름**(§1) — "개요/실행 이력/문서 목록" 3탭 순서가 자연스러운지, 아니면 "실행 이력"을 더 앞에 둘지(운영 중에는 실행 이력을 더 자주 볼 수 있음). 이 문서는 등록→확인 흐름이 더 잦은 신규 소스를 기준으로 "개요"를 첫 탭으로 뒀다.
2. **"정리 필요" 배너의 상시 노출 위치** — 이 문서는 문서 목록 탭 상단에만 뒀다. 소스 목록(KB2)에서도 배지 클릭 시 바로 문서 목록 탭 + "정리 필요만" 필터로 이동시킬지(딥링크) 여부는 정하지 않았다 — 필요하면 알려달라.
3. **수동 실행 종류 선택 UI** — 케밥 메뉴에서 "지금 실행"을 눌렀을 때 종류(미리보기/동기화)를 선택하게 할지, 아니면 서버가 `ingestApproved` 여부로 자동 결정(요구사항 설계 그대로)하고 UI는 선택지를 아예 안 보여줄지 — 이 문서는 후자(자동 결정, 선택 UI 없음)로 가정했다.
4. **모바일에서 전체 다시 적재 확인 문구 길이** — 좁은 화면에서 "예상 소요 약 {H}시간" 같은 문구가 배너를 너무 길게 만들 수 있다. 축약 표시(예: "~4h")를 허용할지 전체 문구를 유지할지는 톤앤매너 담당자 확인이 필요하다.

### 13.1 사용자 결정(2026-09-27, 전부 추천안)
1. 탭 순서는 **개요 → 실행 이력 → 문서 목록** 그대로 유지한다.
2. KB2 소스 목록의 "정리 필요" 배지는 **딥링크**로 만든다 — 누르면 해당 소스의 문서 목록 탭이 "정리 필요만" 필터가 걸린 상태로 열린다(배지는 링크 요소, 접근 가능한 이름에 소스 이름 포함).
3. "지금 실행"은 **선택 UI 없이 자동 결정**으로 확정한다. **[구현 사실 — 2026-09-27 · 설계서 §25 I-24]** 결정 주체는 서버가 아니라 **클라이언트**다 — KB2 케밥 "지금 실행"은 목록 응답의 `ingestApproved`를 보고 `POST /kb-sources/:id/runs { kind: ingestApproved ? 'SYNC' : 'PREVIEW' }`를 보낸다(`KbSourcesPage.tsx:157`). 개요 탭의 "지금 미리보기 실행"은 항상 `PREVIEW`다(`KbSourceOverviewPage.tsx:69`). 서버 계약(`kind` 필수)은 설계서 §4·§11 그대로다.
4. 모바일에서도 확인 문구를 **축약하지 않고** 전체 문장을 줄바꿈해 보여준다.

---

## 14. 구현 편차 반영 (코드 리뷰 R2 통과 후 · 2026-09-27 / 백엔드 pass 4 반영 · 2026-09-28)

화면 관련 구현 사실이다(오케스트레이터 승인 · 새 결정 아님). 상세 근거는 `docs/02-spec/kb-crawling-설계.md` §25·§25.1과 같다.

| 설계서 §25 | 내용 | 코드 |
|---|---|---|
| I-24 | 수동 실행 `kind`는 클라이언트가 `ingestApproved`로 정한다(선택 UI 없음) — §13.1-3 정정 | `KbSourcesPage.tsx:157` · `KbSourceOverviewPage.tsx:69` |
| I-25 | 스코프 3단 모두 필수(각각 인라인 오류) — §3.2 표 | `KbSourceEditModal.tsx:149-152` |
| I-26 | 데이터 지도 소스 절의 키는 응답 최상위 `kbSources` — §3.8 | `DataGovernanceMapPage.tsx:238-241` |
| I-27 | 잡음 줄 패턴은 "범위" 섹션 안 "(선택, 고급)" 목록 입력 — §3.2 | `KbSourceEditModal.tsx:302-310` |
| I-28 | 목록 입력은 `ReorderableList` 재사용(`KbStringListField`) — §3.2 | `KbStringListField.tsx:2·52` |
| I-29 | `AsyncJobProgress`에 `live` prop 추가 — §12-① | `AsyncJobProgress.tsx:8-14·22-32` |
| I-30 | 실행 이력 펼치기 = `<button>` · 상세는 `hidden` — §3.4 | `KbRunTable.tsx:75-94·133-148` |
| I-31 | KB5 필터 결과 0건 → [필터 초기화] — §3.5 | `KbDocumentListPage.tsx:197-207` |
| I-32 | `KbSourceShell`이 meta를 먼저 불러 404 원인을 구분 — §3.3 | `KbSourceShell.tsx:35-67` |
| I-38(pass 4) | 서버는 범위 필드의 값이 **실제로** 바뀔 때만 `configVersion`을 올린다(목록 = 집합 비교 · 숫자 = 서버 상한 적용 후 저장값 비교). 콘솔 안내 `rangeFieldsChanged`(`sameItems` = 정렬 비교)와 대체로 같지만 ① (해소) 콘솔은 `allowQueryUrls`를 비교 필드에 포함하고, 컨트롤 없이 소스의 실제 값을 폼 초기값으로 채워 그대로 다시 보낸다(API로 `true`를 저장한 소스를 콘솔에서 저장해도 값이 유지되고 `configVersion`이 오르지 않는다 — 회귀 시험 `KbSourceEditModal.spec.tsx`) ② 서버 상한을 넘는 입력은 콘솔 안내가 뜨지만 서버는 올리지 않는다 — §2 `KbSourceEditModal` | `KbSourceEditModal.tsx`(`rangeFieldsChanged`·`sameItems`) · 서버 `kb-sync/lib/config-change.ts` |
| I-43(pass 4) | 대기 사유는 서버가 `RAG_NOT_READY`·`BULK_WINDOW`만 낸다 — "속도 제한"(`RATE_LIMIT`) 라벨은 계약 망라용으로만 남는다(설계서 §25.1 RG-14) — §2 `KbRunProgress` · §7.3 | 서버 `kb-sync/lib/build-run-view.ts`(`decideWaitingReason`) |
| I-45(pass 4) | 일시중지(`enabled=false`)는 진행 중 실행을 중지하고 감사 `[일시중지]`·`[재개]`를 남긴다 — KB2 일시중지 동작에 "진행 중인 실행이 중지됩니다" 안내가 필요한지는 frontend 확인 사항 | 서버 `kb-sync/kb-sources.service.ts`(`update`) |
| I-46(pass 4) | 실행 실패 코드는 `SECRET_MISSING`·`INGEST_NOT_ACKNOWLEDGED`·`RAG_NOT_CONFIGURED`만 실제로 나온다(나머지 라벨은 망라용 — 설계서 §25.1 RG-1·RG-2) · 일시중지·중지 실행은 `failureCode` 없이 `CANCELLED` — §7.3 **[pass 5에서 바뀜 — 아래 행]** | 서버 `kb-sync/engine/kb-crawl.runner.ts` |
| I-49·I-54·I-55·I-58(pass 5) | ① 실행 실패 코드 `ALL_SEEDS_UNREACHABLE`·`ROBOTS_UNREACHABLE`가 실제로 나온다(PREVIEW 포함 — 이때 삭제 감지·적재 없음) ② **`CANCELLED` 실행에도 `failureCode`가 붙는다**(`CANCELLED_BY_USER` 관리자 중지 · `SOURCE_DISABLED` 일시중지) — `KbRunTable`은 코드가 있으면 상태와 무관하게 `field-hint--warning` 문구로 보여 주므로 중지 실행에도 경고색 안내가 붙는다(의도 — 사유 표시 · 문구는 기존 라벨) ③ 제외 사유 `RAW_FILE_OFF`·`NO_BODY`·`FILE_UNSAFE`·`FILE_ENCRYPTED`·`PII_IN_RAW_FILE`와 `X-Robots-Tag` 기반 `NOINDEX`가 실제로 나온다 — 미리보기 요약·문서 목록 필터의 기존 라벨로 표시(화면 변경 0) ④ 여전히 나오지 않는 값: 실패 `EGRESS_BLOCKED`·`HOST_NOT_ALLOWED`·`CONFIG_CHANGED` · 제외 `REDIRECT_OUT_OF_SCOPE`·`ENCODING`(설계서 §25.2 RG-2·RG-11·RG-16) — §7.3 | 서버 `kb-sync/engine/kb-crawl.runner.ts` · `kb-sync/kb-sources.service.ts`(`cancelRunAndRelease`) · 콘솔 `KbRunTable.tsx`(`failureCodeLabel`) |
| I-66·I-68·I-70·I-72(pass 6) | ① 제외 사유 `REDIRECT_OUT_OF_SCOPE`가 이제 실제로 나온다(위 행 ④의 "여전히 나오지 않는 값"에서 빠짐 — 기존 라벨로 표시 · 화면 변경 0) ② 소스 일시중지로 멈춘 실행의 적재 작업 결과 코드가 `CONFIG_CHANGED`(기존 라벨 · 관리자 중지는 `CANCELLED_BY_USER`) ③ 크롤 시작 게이트로 호스트가 겹치는 소스의 실행(수동 실행·적재 승인 포함)이 `QUEUED`("대기 중")에 머물 수 있다 — 사유 표시는 없다(2차 `waitingReason = HOST_BUSY` 검토 — 계약 enum 변경) ④ **경로 접두 의미 변경**(문자열 접두 → 경로 세그먼트 단위) — 입력 안내문 추가 필요(§3 구현 메모의 pass 6 항목) | 서버 `kb-sync/crawl/kb-redirect-follow.ts` · `kb-sync/core/kb-run.store.ts`(`cancelRun`·`claimCrawlLease`) · `kb-sync/lib/path-canon.ts` · 콘솔 `KbSourceEditModal.tsx` · `constants/messages.ts` |
| I-77·I-85·I-86(pass 7·8) | ① 실행 실패 코드 `GOVERNANCE_MASK_REQUIRED`·`GOVERNANCE_RAW_FILE_NOT_ALLOWED`가 나온다(CANCELLED 실행 — 기존 경고색 안내 규칙) — `failureCodeLabel` 2개는 반영됨 · 원본 파일 라벨("…원본 파일 전달을 꺼 주세요")이 서버 409 문구("…끄거나 서버 운영자에게 허용을 요청해 주세요")와 달라 한쪽으로 맞추기를 권장 ② 수동 실행(PREVIEW 포함)·적재 승인·전체 다시 적재가 `409 KB_INGEST_NOT_ALLOWED`(`details[0].field` = `piiMask`｜`allowRawFileIngest` · `message` = `GOVERNANCE_*`)로 거부될 수 있다 — 콘솔은 서버 `message`(원인 + 해결)를 그대로 보여 주고, **사전 비활성 권장**: 메타 `governanceMode`·`rawFileIngestAllowedByServer`와 소스 `piiMask`·`allowRawFileIngest`로 같은 규칙을 계산해 해당 버튼을 비활성 + 보이는 사유 텍스트(§3.3.1과 같은 방식 · 색·툴팁만으로 전달 금지 — UIUX) — frontend 후속 ③ PREVIEW 실행에 `demotedReason = AUTH_WALL`이 붙을 수 있다(소스 강등 아님 · 승인 유지) — 실행 이력 펼침의 "강등 사유" 줄은 PREVIEW일 때 "인증 필요로 보임 — 미리보기 경고(승인은 유지됩니다)"처럼 구분 표시 권장(`messages.ts` 1키) ④ `maxPages` 의미 교정으로 미리보기 방문 수가 늘 수 있다(표시 변경 0) ⑤ 문서 목록의 제목은 현재 비마스킹(설계서 §25.5 RG-25 — 서버 수정 대상 · 화면 변경 0) | 서버 `kb-sync/lib/governance-flags.ts` · `kb-sync/kb-sources.service.ts`(`claimAndCreateRun`) · `kb-sync/engine/kb-crawl.runner.ts` · 콘솔 `KbRunTable.tsx` · `KbSourceOverviewPage.tsx` · `constants/messages.ts` |
| I-89·I-93·I-94·I-95·I-97(pass 9·10) | ① `failureCodeLabel.GOVERNANCE_RAW_FILE_NOT_ALLOWED`에 "꼭 필요하다면 서버 운영자에게 허용을 요청해 주세요." 추가 — 위 행 ①의 문구 불일치 해소(환경변수 이름 비노출) ② 승인 409 오류 해석 `resolveApproveErrorText` · 미리보기 카드의 PREVIEW 강등 경고(§3.3 상태표) — 위 행 ②③ 중 오류 해석·미리보기 경고 부분 반영 · ~~여전히 frontend 후속: 거버넌스 규칙 위반 시 버튼 사전 비활성 + 보이는 사유(현재는 목록 화면 거버넌스 안내 배너만) · 실행 이력 펼침의 PREVIEW 강등 구분 문구~~ **[웹 후속에서 둘 다 해소 — 아래 I-99~I-105 행]** ③ `KbStringListField` 입력 id 중복 수정·도움말 연결(§3.2) ④ 문서 목록 제목은 이제 마스킹·200자 절단된 값(위 행 ⑤ 해소 · 화면 변경 0) ⑤ 적재 차단 실행에 감사 `[적재 차단]`이 남는다(감사 로그 화면 표시 · 화면 변경 0) ⑥ 인증 벽 판정이 좁아져 PREVIEW `AUTH_WALL` 경고가 덜 뜨고, 승인으로 시작된 SYNC는 새로 비율로 강등되지 않는다(강등 → 승인 반복 루프 소멸 · 표시 변경 0) | 서버 `kb-sync/lib/run-extract-job.ts` · `kb-sync/kb-sources.service.ts`(`terminateRunForGovernance`) · `kb-sync/lib/observed-hash.ts` · `kb-sync/lib/run-guards.ts` · 콘솔 `KbSourceOverviewPage.tsx` · `KbStringListField.tsx` · `constants/messages.ts` |
| I-99~I-105(pass 11·12·웹 후속) | ① **거버넌스 버튼 사전 비활성**(`governanceBlock.tsx` `clientGovernanceViolation`·`KbGovernanceBlockedHint`) — 소스 목록 행 케밥 "지금 실행"(`KebabMenuItem.describedBy?` 선택 필드 신설 — 공용 컴포넌트, 기존 사용처 무영향) · 개요 "지금 미리보기 실행"·"적재 시작" · 문서 목록 "전체 다시 적재"(`useOutletContext`에서 `meta`도 받음) — `disabled`(기존 "적재 시작" 비활성 방식과 일관) + 보이는 사유 · 모르면 활성 + 409 배너 폴백(§3.3 상태표·§3.3.1) ② **실행 이력 PREVIEW 강등 구분**(`KbRunTable` `demotedText`) — `kind = PREVIEW ∧ demotedReason = AUTH_WALL`이면 `MESSAGES.kbRuns.previewWarningReasonLabel.AUTH_WALL`(§3.4.1) ③ 서버 pass 11: 강등 뒤 승인은 강등 이후 미리보기 필요(§3.3.1 강등 행 · ~~콘솔 미반영 = 설계서 §25.7 RG-27~~ 웹 해소 = 아래 I-107~I-108 행) · 인증 벽 판정 보정(`RD:`·로그인 신호 — 표시 변경 0) ④ 서버 pass 12: 시작 주소·사이트맵에 없는 포트의 링크는 범위 밖 → 미리보기 요약의 범위 밖 링크 수가 늘 수 있고, 그런 포트로의 리다이렉트는 제외 사유 `REDIRECT_OUT_OF_SCOPE`(기존 라벨 · 화면 변경 0) — 소스 등록 폼의 시작 주소·사이트맵 도움말에 "다른 포트의 문서는 그 포트 주소를 시작 주소나 사이트맵에 넣어야 수집됩니다" 한 줄 추가 권장(문구만 · 선택) | 콘솔 `governanceBlock.tsx` · `KbSourcesPage.tsx` · `KbSourceOverviewPage.tsx` · `KbDocumentListPage.tsx` · `KbRunTable.tsx` · `components/KebabMenu.tsx` · `constants/messages.ts` · 서버 `kb-sync/kb-runs.service.ts` · `kb-sync/lib/allowed-origins.ts` |
| I-107~I-108(pass 13·웹 RG-27 — pass 11~13 웹 후속) | ① **강등 뒤 승인 사전 비활성**(`previewAfterDemotion.ts` `isPreviewOlderThanDemotion` — 서버 규칙과 같은 기준을 실행 이력 첫 페이지 20건으로 계산 · 확실할 때만 비활성 · 모르면 활성 + 409 폴백) — 개요 `disabledReason`에 웹 로컬 키 `PREVIEW_AFTER_DEMOTION_REQUIRED`(§3.3.1) ② **409 `PREVIEW_STALE` 문구**: 서버 문구가 비지 않고 원인 없는 기본 문구가 아니면 서버 문구 우선(§3.3 상태표) — 설정 변경 409는 종전 문구 그대로 ③ 문구 2개 추가(`approveDisabledAfterDemotion` · 서버 기본 문구 비교용 `approveGenericInvalidPreviewServerMessage`) ④ 서버 pass 13(RG-28): 화면 변경 0 — `https://`로만 등록한 인증 소스의 같은 호스트 `http://` 문서는 헤더 없이 요청되어 실패·인증 벽이 될 수 있다(설계서 §20 K-28 ②) · 소스 등록 폼 인증 도움말에 "평문(http://) 주소에는 시작 주소·사이트맵에 http://로 적은 경우에만 인증 헤더를 보냅니다" 한 줄 추가 권장(문구만 · 선택) ⑤ 시험 `KbSourceOverviewPage.spec.tsx` 24 → 34건 · 계약 변경 0 · 알려진 한계 K-29(강등 문구가 새로 비율 기준 · 이력 창 20건) | 콘솔 `KbSourceOverviewPage.tsx`(+spec) · `previewAfterDemotion.ts` · `constants/messages.ts` · 서버 `kb-sync/lib/allowed-origins.ts` |
