# 업무 자동화 워크플로우 커넥터 (No.41) — 화면 설계서

> **요구사항**: `docs/requirements/workflow-automation.md`(J-1~J-22, FR-0-172~182, FR-WF1-\*~FR-WF10-\*, NFR-WFP/WFR/WFS/WFA/WFM, AC-WF1~WF7, EX-WF-1~26, P-1~P-12 전부 추천안 확정 2026-09-26)
> **설계**: `docs/02-spec/workflow-automation-설계.md`(§3 데이터모델·§4 계약·§7 발송·§8 전송계약·§9 출구·§12 관리 API·§13 운영·§14 권한·§15 감사·§16 버전/환경·§20 관리자 콘솔 인계) · **ADR-0041**
> **UIUX 기준**: `docs/03-design/UIUX_준수기준.md`(특히 §1 색상 단독 금지·제안-자산 분리, §3 키보드, §4 버튼 44×44px, §6 폼, §7 오류, §8 로딩/비동기 대기/실시간 폴링, §9 내비게이션)
> **형식 참조**: `docs/03-design/legacy-api-integration-ui-spec.md`(No.26 — 발송 대상 관리 화면·노드 편집기 아웃풋·`ResourcePickerField`·`BindingValueEditor`의 직접 선례) · `docs/03-design/data-governance-ui-spec.md`(No.45 — 설정 서브라우트 셸·확인 재입력 패턴·형식)
> **실제 코드 확인**: `apps/web/src/components/security/SystemSettingsMenu.tsx`(메뉴 추가 지점) · `apps/web/src/pages/settings/api-connections/**`(`ApiConnectionEditModal`·`ApiConnectionTestPanel`·`RawPersonalDataConfirmField`·`DeleteApiConnectionConfirmDialog`·`badges.tsx` — 발송 대상 관리의 1:1 선례) · `apps/web/src/pages/dialogue/components/DialogOutputEditor.tsx`(아웃풋 타입 스위치 — `OUTPUT_TYPES`·`defaultPayloadFor`) · `apps/web/src/pages/dialogue/components/api-condition/{ApiConnectionPickerField,BindingValueEditor,ApiListEditors}.tsx`(구조적 바인딩·필드 표 선례 — **필드값 에디터는 그대로 재사용**) · `apps/web/src/components/ResourcePickerField.tsx`(`resourceType` 유니온 — 9번째 타입 추가 지점) · `apps/web/src/pages/chatbot-detail/TabNav.tsx`(최상위 탭·배지 추가 지점) · `apps/web/src/pages/ChatbotDetailLayout.tsx`(탭 배지용 공유 조회 지점 — `learningSummary`/`environmentStatus`와 같은 패턴) · `apps/web/src/pages/stats/ApiCallLogPage.tsx`+`NavPendingBadge.tsx`+`NegativeFeedbackNavBadge.tsx`(이력 표·배지 선례) · `apps/web/src/pages/chatbot-detail/simulator/ApiStepPanel.tsx`(접이식 결과 패널 선례) · `apps/web/src/App.tsx`(라우트 등록 위치) · `apps/web/src/constants/messages.ts`(네임스페이스 관례)
> **작성**: ui-designer · 2026-09-26 · **§13 확정 반영**: 2026-09-26(PM·오케스트레이터) · **다음 단계**: `backend-implementer`(이미 착수 가능) → `frontend-implementer` → `code-reviewer` → `test-automation`
> **범위 경계**: 실제 React 컴포넌트 코드는 작성하지 않는다. `apps/widget` 변경은 0건(FR-WF10-3 — 엔진이 `WORKFLOW` 아웃풋을 사용자 출력에 싣지 않으므로 위젯 렌더러는 관여하지 않는다).

---

## 0. 전제와 연계 확인

1. **PM 결정 P-1~P-12는 전부 추천안대로 확정**되었다(2026-09-26). 이 문서는 그 결정을 화면으로 구체화할 뿐 재론하지 않는다. 화면 설계에 직접 영향을 주는 것만 다시 적는다.
   - 발송 대상(`WorkflowTarget`)은 **전역**(챗봇 스코프 아님) 레지스트리이며 `security:*`만 쓴다 — **No.26 `ApiConnection` 관리 화면(AC1)과 1:1 대응**되는 화면이다(같은 데이터 성격: 전역·시크릿 참조·테스트 발송·삭제 시 참조 검사).
   - 노드 아웃풋 "업무 요청 보내기"(`WORKFLOW`)의 필드 바인딩은 **No.26 `ApiBindingSchema`(`kind: CONST｜SLOT`) 그대로**다(R-1) — 즉 `BindingValueEditor` 컴포넌트를 **그대로** 재사용한다(신규 컴포넌트가 아니다).
   - 비밀(서명·헤더 토큰·비밀 주소)은 DB에 없다. 콘솔은 `NOT_REQUIRED｜CONFIGURED｜MISSING`(+ 서명은 `약함` 여부) 상태만 본다 — **No.26 `SecretStatusBadge`를 그대로 재사용**한다.
   - 대화 응답은 발송 결과를 기다리지 않는다(P-4 (a)) — 사용자는 "전달 중" 화면을 보지 않는다. 결과는 콘솔 실행 이력에만 남는다.
   - 이벤트 구독 5종은 **챗봇별 설정**(환경 밖 — 저장 즉시 운영 반영, P-10)이며 `chatbot:write`가 관리한다.
   - **신규 권한 0종**. 대상=`security:*`, 구독·재발송·취소=`chatbot:write`, 노드 편집=`dialogue:write`, 선택 목록=`dialogue:read`, 챗봇 스코프 조회=`chatbot:read` **AND** `dialogue:read`(AGENT는 `chatbot:read`만 있어 배제, R-9).
   - 실행 이력은 **메타데이터만**(필드 값·본문·`sessionId` 원값 없음, 필드 **이름**만) — No.26 `ApiCallLog` 화면과 같은 절제 원칙.
   - 챗봇 목록·대시보드에는 "확인 필요" 배지를 **추가하지 않는다**(K-8·R-14 — 챗봇 목록 API 바이트 불변). 대신 ① 전역 `설정 > 업무 자동화` 메뉴 배지 ② 챗봇 상세의 "업무 자동화" 탭 배지로만 알린다.
2. **선행 화면과의 관계**
   - 발송 대상 관리(§3.1)는 `legacy-api-integration-ui-spec.md` §3.1(AC1)의 목록+모달+테스트패널+삭제확인 구조를 **그대로** 따른다. 다른 점은 인증 4종에 "서명"·"비밀 주소"가 추가되고, 시크릿 참조가 최대 3개(`secretRef`·`signingSecretRef`·`urlSecretRef`)라는 점뿐이다.
   - 노드 편집기 확장(§3.4)은 `DialogOutputEditor.tsx`의 `OUTPUT_TYPES`(현재 12종)에 13번째 타입 `WORKFLOW`를 추가하는 것이며, 그 하위 폼은 `ApiConditionEditorV2`(§4.2, No.26)의 "쿼리/본문 필드 표 + `BindingValueEditor`" 패턴을 그대로 옮긴 것이다 — **`API_CONDITION`처럼 v1/v2 두 형태가 없다**(`WORKFLOW`는 이번에 처음 생기는 타입이라 레거시 호환 분기가 필요 없다, EN 전 구간 신규).
   - `ResourcePickerField`의 `resourceType` 유니온에 9번째 값 `'workflowTarget'`을 추가한다(§2.2) — `apiConnection`(7번째, 전역·챗봇 스코프 불요)과 같은 모양이다.
   - `security-audit-ui-spec.md`의 `SystemSettingsMenu` 패턴(권한 없는 항목 렌더 자체 생략)을 그대로 따른다.
   - `data-governance-ui-spec.md`의 서브라우트 셸(`DataGovernanceShell` — index/탭1/탭2/탭3) 패턴을 전역 업무 자동화 화면(§1 WF1)에, 챗봇 스코프 셸(`StatsShell`/`ValidationShell` — 탭 내부에 서브탭) 패턴을 챗봇 "업무 자동화" 탭(§1 WF3)에 각각 적용한다.
   - `quality-channel-ui-spec.md`/`legacy-api-integration-ui-spec.md`의 `ApiStepPanel`(접이식 결과 패널)을 그대로 본떠 `WorkflowStepPanel`을 추가한다.
   - `version-history-ui-spec.md`의 `RestoreWarningList`(현재 14종, No.26에서 3종 추가됨)에 2종을 더 추가한다(§3.10).
3. **문구 상수**: 신규 네임스페이스 `MESSAGES.workflowTargets`·`MESSAGES.workflowNodeOutput`·`MESSAGES.workflowSubscriptions`·`MESSAGES.workflowRuns`를 추가하고, 기존 `MESSAGES.systemSettings`·`MESSAGES.detail`(탭)·`MESSAGES.dialogue.outputTypes`/`outputFields`·`MESSAGES.simulator`·`MESSAGES.versions`(복원 경고)·`MESSAGES.dataGovernance.map`에 항목을 더한다(§7).
4. **조사 한계 승계**: 요구사항 문서가 명시한 대로 "Power Automate HTTP 트리거"의 실제 화면·용어는 웹 재조사 없이 범용 웹훅 개념으로만 설계했다(요구사항 §0 조사 한계). 이 문서의 문구도 특정 제품명을 노출하지 않고 "업무 자동화 도구"로 통칭한다.
5. **`UIUX_준수기준.md` 보강 여부**: 이번 화면군에 필요한 규칙은 기존 §1(색상 단독 금지)·§3(키보드)·§4(버튼)·§5(텍스트입력)·§6(폼)·§7(오류)·§8(로딩·비동기 대기·실시간 폴링·보조 버튼 상태 변화)·§9(내비게이션)로 전부 커버된다 — **신규 보강 없음**. 특히 §8의 "실시간 목록 폴링(스크롤·포커스 유지 + `aria-live` 1회)" 패턴을 실행 이력 화면(진행 중 건이 있을 때의 짧은 폴링, §3.2)에 그대로 적용한다.

---

## 1. 화면 목록 및 라우트

| ID | 화면명 | 라우트 | 성격 | 진입 경로 | 필요 권한 |
|---|---|---|---|---|---|
| WF1 | **발송 대상 관리**(전역) | `/settings/workflow-automation`(index→`targets`) `/settings/workflow-automation/targets` | 페이지(목록+모달, `WorkflowAutomationShell` 1번째 탭) | `SystemSettingsMenu` "업무 자동화" | `security:read`(조회) / `security:write`(쓰기·테스트·정지) |
| WF1-b | **실행 이력**(전역) | `/settings/workflow-automation/runs` | 페이지(`WorkflowAutomationShell` 2번째 탭) | 셸 내 탭 전환 | `security:read` |
| WF1-c | **요약 통계**(전역) | `/settings/workflow-automation/summary` | 페이지(`WorkflowAutomationShell` 3번째 탭) | 셸 내 탭 전환 | `security:read` |
| WF2 | 노드 편집 — "업무 요청 보내기" 아웃풋(신규 13번째 타입) | `/chatbots/:chatbotId/dialogue/nodes/:nodeId`(기존 라우트, 아웃풋 카드 내부) | 폼 내 컴포넌트 | D1b 아웃풋 유형 셀렉트에서 "업무 요청 보내기" 선택 | `dialogue:read`(대상 선택 목록) · `dialogue:write`(저장) |
| WF3 | **챗봇 > 업무 자동화**(신규 최상위 탭) — 이벤트 구독 | `/chatbots/:chatbotId/workflow-automation`(index→`subscriptions`) `/chatbots/:chatbotId/workflow-automation/subscriptions` | 페이지(`ChatbotWorkflowShell` 1번째 서브탭) | `TabNav` "업무 자동화" | `chatbot:read`+`dialogue:read`(조회) · `chatbot:write`(쓰기·정지) |
| WF3-b | 챗봇 > 업무 자동화 — 실행 이력·재발송/취소 | `/chatbots/:chatbotId/workflow-automation/runs` | 페이지(`ChatbotWorkflowShell` 2번째 서브탭) | 셸 내 서브탭 전환 | `chatbot:read`+`dialogue:read`(조회) · `chatbot:write`(재발송·취소) |
| WF4 | 대화그래프 — 설계 점검 패널 확장 | `/chatbots/:chatbotId/dialogue/nodes`(기존 라우트) | 페이지 내 패널 확장 | 기존과 동일 | `dialogue:read` |
| WF5 | 대화그래프 — 흐름 미리보기 확장 | 〃 | 페이지 내 패널 확장 | 기존과 동일 | `dialogue:read` |
| WF6 | 응답 테스트 — "업무 요청(모의)" 단계 패널 | `/chatbots/:chatbotId/simulator`(기존 라우트) | 페이지 내 패널 확장 | 기존과 동일 | `simulation:read`(항상 모의만 — 실발송 없음, J-13) |
| WF7 | 버전 복원 미리보기 — 경고 2종 확장 | 기존 `RestoreDialog`(모달, 비라우트) | 모달 내 목록 확장 | 기존과 동일 | `dialogue:write` + `chatbot:write` |
| WF8 | 데이터 지도(No.45) — 출구 6번째 클래스 행 | `/settings/data-governance/map`(기존 라우트) | 페이지 내 표 확장 | 기존과 동일 | `security:read` |
| WF9 | 챗봇 영구삭제 확인 — 대기 건 안내 확장 | 기존 `PermanentDeleteModal`(모달, 비라우트) | 모달 내 안내 확장 | 기존과 동일 | `chatbot:delete`(기존) |
| WF10 | `SystemSettingsMenu` 항목 추가 | — | 메뉴 항목 | — | `security:read` |
| WF11 | `TabNav` "업무 자동화" 탭 + 배지 | — | 탭 링크 | — | 항상 표시(탭 진입 후 내부에서 권한 분기) |

**신규 최상위 라우트는 WF1(셸 포함 3서브)·WF3(셸 포함 2서브) 2그룹뿐**이다. 나머지는 전부 기존 화면의 확장이며 라우트를 새로 만들지 않는다.

**WF1 라우트 배치 근거**: 발송 대상은 "어디로 내보낼 수 있는가"를 정하는 **보안 설정 도메인**(No.26과 같은 논리)이므로 `/settings/api-connections`·`/settings/data-governance`와 같은 `/settings/*` 패턴을 따르되, **실행 이력·요약까지 한 도메인**이라 `data-governance-ui-spec.md`의 `DataGovernanceShell`(index/탭1/탭2/탭3) 형태를 그대로 가져온다(단일 페이지가 아니라 서브라우트 3개).

**WF3 라우트 배치 근거(TabNav 확장) — 확정(2026-09-26 PM·오케스트레이터)**: `TabNav.tsx`의 라우트는 이미 12개(4개 시각 그룹)이며, No.28(예약 배포)·No.40(환경)이 최근에 "배포" 그룹에 새 최상위 탭을 추가한 선례가 있다(주석의 "라우트는 6개 그대로 두되"는 이 두 그룹 추가 이전의 오래된 기록으로 보이며, 현재 코드는 이미 그 수를 넘겼다 — §12-①에 판단 근거 기록). 이벤트 구독·실행 이력은 "이 챗봇이 외부 세계와 어떻게 연결되는가"라는 점에서 스킨·채널·예약배포·환경과 성격이 같으므로 **"배포" 그룹의 5번째 탭**으로 추가한다(환경 탭 바로 뒤). PM·오케스트레이터가 이 안을 **최종 확정**했다(§13-1) — No.26처럼 기존 탭의 서브탭으로 흡수하는 대안은 채택하지 않는다. `chatbot:read`+`dialogue:read`가 없는 AGENT에게도 탭 링크 자체는 보이되(다른 탭과 같은 원칙 — 진입 시 권한 분기, `ForbiddenState`) 배지만 억제한다(§5).

---

## 2. 공통 UI 요소(신규)

### 2.1 배지류 (색상+텍스트 병기, UIUX §1)

| 컴포넌트 | 용도 | 규칙 |
|---|---|---|
| `SecretStatusBadge`(No.26, **무변경 재사용**) | 대상 목록·상세·노드 편집기 대상 선택 결과 — 시크릿 참조마다(인증·서명·비밀주소) 각각 | `NOT_REQUIRED`(회색, "필요 없음") / `CONFIGURED`(초록, "설정됨") / `MISSING`(빨강, "미설정") |
| `SigningWeakBadge`(신규) | 대상 목록·상세 | 서명 비밀이 32자 미만일 때만: "서명 비밀 약함"(주황 `WARNING`) — 기동 실패가 아니라는 뜻을 툴팁으로 부연 |
| `TargetEnabledBadge`(신규, `ConnectionEnabledBadge`와 동형) | 대상 목록 | `사용 중`(초록 점) / `사용 중지`(회색) |
| `TargetPausedBadge`(신규) | 대상 목록·구독 목록 | `일시 정지`(주황) — `pausedAt`이 있을 때만 |
| `RawPersonalDataBadge`(No.26, **무변경 재사용**) | 대상 목록·편집기·노드 편집기 | "원문 송신"(주황) — `allowRawPersonalData=true`일 때 |
| `ConsecutiveFailureBadge`(신규) | 대상 목록 | "연속 실패 N회"(주황) — `consecutiveFailures ≥ 10`일 때만(FR-WF5-9). 자동 정지가 아니라는 점을 툴팁으로 부연 |
| `WorkflowRunStatusBadge`(신규) | 실행 이력(전역·챗봇) | 8값: 대기 중(회색,"◐")·보류(주황,"⏸")·전송 중(파랑,"↻")·성공(초록,"✔")·실패(빨강,"✖")·건너뜀(회색,"—")·취소됨(회색,"⊘")·만료됨(회색,"⧖") |
| `WorkflowOutcomeBadge`(신규, `ApiCallOutcomeBadge`와 동형) | 실행 이력 상세 | 11값 → 한국어 라벨(§7.4 표) — **관리자 화면 전용**, 최종 사용자에게는 절대 노출되지 않는다(FR-0-176과 같은 절제) |
| `WorkflowEventTypeBadge`(신규) | 실행 이력·구독 표 | 7값: 업무 요청(노드)·상담 시작·상담 종료·설문 완료·부정 평가·연속 미응답·테스트 발송 — 아이콘+텍스트 |
| `WorkflowOnlyOutputBadge`(신규, `UnsupportedOutputBadge`와 다른 톤) | 노드 편집기 | "이 노드는 사용자에게 보이는 응답이 없습니다"(`WORKFLOW_ONLY_OUTPUT` 설계 점검과 같은 조건, WARNING 톤) |

### 2.2 대상 선택·바인딩 전용 컴포넌트

| 컴포넌트 | props | 규칙 |
|---|---|---|
| `WorkflowTargetPickerField` | `id`, `label`, `value: string \| null`, `onChange`, `required?` | `ResourcePickerField`의 **9번째 `resourceType`**으로 `'workflowTarget'`을 추가해 구현한다(`chatbotId` 불요 — 전역 자원, `GET /workflow-targets/picker` 호출, `dialogue:read`). 후보 항목은 이름 옆에 `SecretStatusBadge`(인증만, 작게) + `TargetEnabledBadge` + `TargetPausedBadge`(있으면) + `RawPersonalDataBadge`(있으면)를 함께 보여준다. **사용 중지·정지된 대상도 후보에 나타나되** 흐린 회색 텍스트 + "(사용 중지)"/"(일시 정지)" 접미사로 표시해 선택은 가능하지만(이미 저장된 값을 다시 열람할 때 필요) 저장 자체는 막지 않는다(설계 점검이 WARNING으로 안내, FR-WF2-8 ②). 목록 0건이면 "'{입력값}'에 해당하는 발송 대상이 없습니다." + "[업무 자동화 발송 대상으로 이동 →]"(`security:write` 없으면 "관리자에게 발송 대상 등록을 요청하세요"만) — **`ApiConnectionPickerField`와 완전히 같은 패턴**(§2.2 legacy-api ui-spec 복제) |
| `BindingValueEditor`(No.26, **완전히 무변경 재사용**) | `value: ApiBinding`, `onChange`, `slotOptions` | 필드 값(상수/폼 슬롯) 에디터 — R-1 결정에 따라 **새 컴포넌트를 만들지 않는다**. `slotOptions`는 이 노드의 인풋 조건에 걸린 컨텍스트의 슬롯 목록(No.26과 동일 계산) |
| `WorkflowFieldListEditor` | `items: {name,value:ApiBinding}[]`, `onChange`, `maxItems=20` | `ReorderableList` 재사용. 행: `name`(필드 이름, `^[A-Za-z0-9_]{1,40}$`, 유일) + `BindingValueEditor`. 상단 고정 안내: **"필드 값은 기본적으로 가려져(마스킹) 전송됩니다. 대상에서 '원문 개인정보 전송 허용'을 켠 경우에만 그대로 전송됩니다."** |
| `RawPersonalDataConfirmField`(No.26, **일반화 재사용** — `data-governance-ui-spec.md`가 이미 `RetentionConfirmField`로 일반화한 것과 같은 방향) | `expected: string`, `value`, `onChange` | 대상 편집 모달에서 `allowRawPersonalData`를 켤 때만: "원문 전송을 켜려면 대상 이름을 다시 입력하세요" — `expected=target.name` |
| `WorkflowTargetTestPanel` | `targetId`, `disabled?` | §3.1.3 상세(`ApiConnectionTestPanel`과 동형) |
| `WorkflowStepPanel` | `step: WorkflowStepView` | §3.6 상세(`ApiStepPanel`과 동형, 접이식) |

### 2.3 신규 페이지 셸

| 컴포넌트 | 위치 | 역할 |
|---|---|---|
| `WorkflowAutomationShell` | `pages/settings/workflow-automation/WorkflowAutomationShell.tsx` | 전역 3탭(발송 대상/실행 이력/요약) — `DataGovernanceShell`과 동형의 `role=tablist` 헤더 + `<Outlet/>` |
| `ChatbotWorkflowShell` | `pages/chatbot-detail/workflow-automation/ChatbotWorkflowShell.tsx` | 챗봇 스코프 2서브탭(이벤트 구독/실행 이력) — `StatsShell`과 동형 |

---

## 3. 화면별 설계

## 3.1 WF1 — 발송 대상 관리 (`/settings/workflow-automation/targets`)

### 목적
ADMIN이 업무 자동화 도구(웹훅 수신 주소)에 대한 대상(호스트·인증·서명·시크릿 참조·타임아웃·최대 시도·원문 개인정보 취급)을 전역으로 등록·수정·테스트·정지·삭제한다.

### 상태별 UI

| 상태 | UI |
|---|---|
| 로딩 | `SkeletonRow` × 5 |
| 성공(데이터 있음) | 표 + "총 {total}건"(UIUX §8) |
| **빈 상태**(대상 0건) | `EmptyState`: "등록된 발송 대상이 없습니다." + "대화 노드의 '업무 요청 보내기' 아웃풋이나 이벤트 구독에서 쓸 업무 자동화 도구 주소를 여기서 먼저 등록하세요." + `[+ 발송 대상 추가]` |
| 오류 | `ErrorState` + 다시 시도 |
| 기능 꺼짐(`WORKFLOW_ENABLED=false`, 서버 설정) | 목록 위 상시 배너: "서버 설정으로 업무 자동화 기능이 꺼져 있습니다 — 등록·수정은 가능하지만 발송되지 않습니다"(EX-WF-3) |

### 레이아웃 (데스크톱)

```
┌───────────────────────────────────────────────────────────────────────────┐
│ [발송 대상] [실행 이력] [요약]                          (탭, role=tablist)   │
├───────────────────────────────────────────────────────────────────────────┤
│ 검색 [__________]  사용 여부 ☑사용중 ☑사용중지  정지 ☑정지중 포함           │
│                                                          [+ 발송 대상 추가] │
├───────────────────────────────────────────────────────────────────────────┤
│ 이름          호스트              인증    서명  비밀상태     상태        참조│
│ 그룹웨어결재   (비밀 주소)          BEARER  ●켜짐 ●설정됨    ●사용중       3 │
│               (원문송신)                                    대기2·보류0    │
│ 품질티켓봇    ticket.corp.internal NONE    ●켜짐 ⚠약함      ●사용중지      1 │
│                                                          ◀ 1 ▶ 총 2건      │
└───────────────────────────────────────────────────────────────────────────┘
```

- 배지 행(`RawPersonalDataBadge`/`ConsecutiveFailureBadge`/`TargetPausedBadge`)은 해당 값이 있는 대상에만 이름 아래 작은 줄로 병기한다.
- "참조" 열은 이 대상을 사용하는 **현재 저장된 초안 노드 + 구독 수**(스냅샷 참조는 세지 않음 — FR-WF1-8 · No.26 선례), 그 아래 작은 줄에 "대기N·보류N"(발송함 현황 — FR-WF1-9).
- "호스트" 열은 `urlSecretRef`가 있으면 "(비밀 주소)"로 표시하고 실제 값은 보이지 않는다(FR-WF1-4 — DB 값은 호스트 판정·허용목록용일 뿐).

### 컴포넌트 분해

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `WorkflowTargetFilterBar` | `q`, `enabled: boolean[]`(기본 전체 체크), `includePaused: boolean`(기본 true — 정지 중인 대상도 즉시 보여 관리 누락 방지) |
| `WorkflowTargetTable` | `items: WorkflowTargetListItem[]`, `loading` | 컬럼: 이름, 호스트(또는 "(비밀 주소)"), 인증방식, `SigningWeakBadge`(약할 때만) + "서명 켜짐/꺼짐", `SecretStatusBadge`(인증), `TargetEnabledBadge`(+`TargetPausedBadge`), 참조 수 + 대기/보류, 배지 부속 줄 |
| `WorkflowTargetRowActions`(`KebabMenu`) | `target` | "수정" / "테스트 발송" / "일시 정지"·"재개" / "삭제" — 전부 `security:write`가 있을 때만 노출(없으면 조회만, `security:read`) |
| `WorkflowTargetEditModal` | `target: WorkflowTarget \| null` | §3.1.1 상세 |
| `DeleteWorkflowTargetConfirmDialog` | `target` | `409 WORKFLOW_TARGET_IN_USE` 시 모달 내 배너: "이 대상을 사용하는 노드·구독이 {n}건 있습니다." + 상위 5건("{챗봇명} › {노드명}" 또는 "{챗봇명} › 이벤트 구독: {이벤트명}") 링크 — `DeleteApiConnectionConfirmDialog`와 동일 패턴. 참조가 없어 삭제가 진행되면 안내: "운영 중인 버전이 이 대상을 쓰고 있었다면, 그 버전에서는 전송이 건너뛰어집니다."(§12.3, 차단 아님 — 정보 제공) |
| `PauseResumeButton` | `target` | 클릭 즉시 `POST …/pause` 또는 `/resume`(확인 모달 없음 — 가역적 동작, No.26 "사용 중지"와 같은 즉시성) → 응답의 카운트로 토스트: "일시 정지했습니다(보류 3건)." / "재개했습니다(발송 3건 · 만료 0건)." |

### 3.1.1 대상 생성/수정 모달(`WorkflowTargetEditModal`)

```
┌ 발송 대상 추가 ──────────────────────────────────────────────────────── ✕ ┐
│ 이름 *        [그룹웨어 결재 흐름____________]                            │
│ 설명          [____________________________] 0/300자                     │
│ 기준 URL *    [https://flow.corp.internal___] ⚠ 사설 주소는 서버 허용     │
│                                                  목록에 등록되어야 발송됩니다│
│ ☐ 비밀 주소 사용(주소 자체가 비밀인 도구 — 예: 자동화 도구의 HTTP 트리거)   │
│    비밀 주소 참조* [GW_LEAVE________] ⚠ 서버에 WORKFLOW_SECRET__GW_LEAVE가│
│                                          설정되지 않았습니다 — 운영자에게 요청│
│ 인증 방식     (●없음 ○API 키(헤더) ○Bearer 토큰 ○기본 인증)              │
│  헤더 이름    [____________]  (API 키 선택 시)                           │
│  시크릿 참조  [____________]  (인증 방식이 없음이 아닐 때 필수)           │
│ ☑ 서명 사용(받는 쪽이 진짜 우리 요청인지 확인하는 값)                    │
│  서명 비밀 참조* [GW_SIGN________] ●설정됨                                │
│ 타임아웃(초)  [5] (1~15)                                                 │
│ 최대 재시도   [5] (1~10)                                                 │
│ ☐ 원문 개인정보 전송 허용(기본: 가려서 전송)                             │
│ 사용 여부  ☑ 사용함                                                      │
├───────────────────────────────────────────────────────────────────────┤
│                                       [테스트 발송]  [취소]  [저장]      │
└─────────────────────────────────────────────────────────────────────────┘
```

| 필드 | 컴포넌트 | 검증 |
|---|---|---|
| 이름 | `TextInputField` | 1~60자, 전역 유일(`DUPLICATE_NAME` 409) |
| 설명 | `TextAreaField` | 0~300자 |
| 기준 URL | `TextInputField` | `https://호스트[:포트][/경로]`만(서버 `WORKFLOW_ALLOW_HTTP=true`일 때만 `http` 허용 — 이 경우도 필드 하단 상시 안내), 사용자정보·쿼리·프래그먼트 금지 |
| 비밀 주소 사용 | `CheckboxField` | 체크 시 "비밀 주소 참조" 필드 노출·필수. 체크 해제 시 기준 URL이 실제 발송 주소가 된다는 안내 문구로 전환 |
| 비밀 주소 참조 / 시크릿 참조 / 서명 비밀 참조 | `TextInputField` + `SecretStatusBadge` | `^[A-Z0-9_]{1,40}$`. **값 입력 칸이 아니다** — 이름만 적으면 서버가 `WORKFLOW_SECRET__{참조}` 존재 여부를 조회해 상태를 보여준다. `MISSING`이면 필드 하단 상시 경고(제출은 막지 않음). 서명 비밀이 `CONFIGURED`인데 32자 미만이면 `SigningWeakBadge`를 함께 표시 |
| 인증 방식 | `RadioGroup`(4종, UIUX §6) | `NONE` 외 선택 시 헤더 이름(`API_KEY_HEADER`만)·시크릿 참조 필수 |
| 서명 사용 | `CheckboxField`(기본 켜짐) | 켜면 서명 비밀 참조 필수 |
| 타임아웃 | `NumberInputField` | 정수 1~15초, 기본 5 |
| 최대 재시도 | `NumberInputField` | 1~10, 기본 5 |
| 원문 개인정보 전송 허용 | `CheckboxField` + `RawPersonalDataConfirmField`(켤 때만) | 기본 false. 체크 시 "폼에 입력된 전화번호·이메일 등이 가리지 않고 전송됩니다"(FR-WF1-5) + 확인 필드 노출, 미일치면 저장 `aria-disabled` |
| 사용 여부 | `CheckboxField` | 기본 true. **대기·보류 중인 발송 건이 있는 상태에서 끄려 하면** 저장 전 확인 대화상자: "대기 중인 요청 {n}건은 대상이 꺼져 있는 동안 보내지지 않습니다. 잠시 멈추려면 '사용 중지' 대신 '일시 정지'를 쓰세요."(§7.6 문구 재사용, 취소 가능) |

- **저장 흐름**: `POST /workflow-targets` 또는 `PATCH /workflow-targets/:id` → `201`/`200` → `Toast`("발송 대상이 저장되었습니다") + 목록 갱신 → 시크릿이 `MISSING`이면 저장 직후 배너를 유지한 채 모달을 닫는다(목록에도 상태가 남는다).
- **오류 매핑**: `DUPLICATE_NAME`(409, 이름 필드) · `CONFIRM_NAME_MISMATCH`(400, 원문 송신 확인 필드) · `EGRESS_HOST_NOT_ALLOWED`(400, 기준 URL 필드 — "외부 전송 허용 목록에 없는 호스트입니다(서버 설정 필요)", No.45 재사용) · `VALIDATION_FAILED`(400, `details[].field`별 인라인).

### 3.1.2 삭제 흐름

§3.1의 `DeleteWorkflowTargetConfirmDialog` — No.26 §3.1.2와 동일한 3단계 패턴(트리거 → 확인 모달 → `409` 시 참조 목록 배너).

### 3.1.3 테스트 발송(`WorkflowTargetTestPanel`)

```
테스트 발송   동작 키(선택) [____________________]  [테스트 발송]
→ (성공) ✔ 202 · 412ms · 실제로 전송했습니다(test:true)
→ (실패) ✖ 사설 주소(10.20.1.5)는 서버 허용 목록에 없어 전송할 수 없습니다.
           운영자에게 허용 목록(WORKFLOW_PRIVATE_ALLOWLIST) 추가를 요청하세요.
→ (대상이 꺼짐/정지 중이어도 진행) ⓘ 대상이 꺼져 있어 실제 대화에서는 보내지 않습니다.
```

- 목록 행의 "테스트 발송" 또는 편집 모달 하단 버튼으로 진입(둘 다 같은 패널을 연다). `security:write`.
- "테스트 발송" 클릭 → `POST /workflow-targets/:id/test { actionKey? }` → 결과 영역은 `aria-live="polite"`(NFR-WFA3)로 갱신.
- **결과는 서버가 이미 완성한 `guidance` 문자열을 그대로 표시한다(확정 유지, §13-5)**(원인+해결 포함, No.26 §3.1.3의 "클라이언트가 코드별 안내를 재구현하지 않는다" 원칙을 그대로 따른다 — 결과 코드별 문구 하드코딩 없음).
- 받는 쪽 **응답 본문은 절대 표시하지 않는다**(상태 코드·지연만).
- 사용 중지·정지된 대상도 테스트할 수 있다(설정 확인 목적, EX-WF-25).
- 분당 5회 초과 시 `429 RATE_LIMITED` → "잠시 후 다시 시도하세요(분당 테스트 발송 한도 초과)."

---

## 3.2 WF1-b — 실행 이력(전역) (`/settings/workflow-automation/runs`)

### 목적
`security:read` 사용자가 전 챗봇의 발송 건을 대상·챗봇·트리거·이벤트·상태·기간으로 조회하고, 필요 시 취소한다(재발송은 챗봇 스코프 전용 — §3.2b, FR-WF7-3이 챗봇 소속 검사를 요구하므로 전역 화면에는 "재발송" 버튼이 없다).

### 상태별 UI

| 상태 | UI |
|---|---|
| 로딩 | 요약 없음(요약은 WF1-c) + 표 `SkeletonRow` × 5 |
| 성공(건 있음) | 표 |
| **빈 상태**(기간 내 0건) | `EmptyState`: "선택한 조건에 해당하는 실행 이력이 없습니다." |
| 오류 | `ErrorState` + 다시 시도 |
| 대기 건이 있고 발송 루프가 지연 중(`오래된 대기` 경고) | 표 위 배너: "가장 오래된 대기 건이 {N}분째 발송되지 못했습니다 — 서버의 발송 루프 상태를 확인하세요."(EX-WF-23, 예약 배포 "기한 넘긴 PENDING" 선례) |

### 레이아웃 (데스크톱)

```
┌───────────────────────────────────────────────────────────────────────────┐
│ [발송 대상] [실행 이력] [요약]                                              │
├───────────────────────────────────────────────────────────────────────────┤
│ 대상[전체▾] 챗봇[전체▾] 트리거☑노드☑이벤트☑테스트 이벤트[전체▾]          │
│ 상태 ☑전체… 기간[2026-09-19]~[2026-09-26](최대90일) ☐재발송 가능만        │
├───────────────────────────────────────────────────────────────────────────┤
│ 발생(KST)       챗봇       트리거              대상       상태   시도 결과 지연│
│ 09-26 10:02:13  인사도우미  업무요청(휴가신청)  그룹웨어결재 성공  1   —  412ms│
│ 09-26 10:01:58  인사도우미  업무요청(휴가신청)  그룹웨어결재 실패  5  400 —   │
│ 09-26 09:50:02  고객지원봇  상담 종료           품질티켓봇   대기중 0  —  —   │
│                                                          ◀ 1 2 3 ▶ 총 128건│
└───────────────────────────────────────────────────────────────────────────┘
```

- 행 클릭 시 상세 패널(펼침, §3.2.1)이 열린다.
- **실행 이력에는 필드 값·본문·`sessionId`가 표시되지 않는다** — "트리거" 열은 노드 이름+동작 키 또는 이벤트 한국어 라벨만(AC-WF6-4).
- 상태가 `SENDING`·`PENDING`인 건이 목록에 있으면 이 화면은 **10초 간격 짧은 폴링**을 켠다(UIUX §8 "실시간 목록·대화 갱신" 원칙 — 갱신마다 스크롤·펼침 상태 유지, 새 항목은 `aria-live="polite"`로 1회만 안내, 연속 실패 시 "새로고침이 원활하지 않습니다" 배너). 모든 건이 종단 상태면 폴링을 멈춘다.

### 3.2.1 상세 패널(펼침)

```
발생: 2026-09-26 10:01:58(KST) · 챗봇: 인사 도우미 · 대화 참조: a1b2c3d4e5f60718
트리거: 업무 요청 보내기(노드: 휴가신청완료 · 동작 키: leave.request)
대상: 그룹웨어 결재 흐름
필드: start, end, reason(값은 표시되지 않습니다 — 이름만)
개인정보: 기본 가림 적용됨
상태: 실패 · 시도 5/5 · 마지막 결과: HTTP 오류(400) · 지연 210ms
다음 시도: 없음(최대 시도 도달)
본문(재시도용): 🗑 보존기간 경과로 파기됨 — 재발송할 수 없습니다      ← payloadPurged=true일 때만
전달 식별자(deliveryId): 7f1c2e3a…[복사]
[재발송]  [취소]                                        ← 챗봇 스코프 화면(WF3-b)에서만 버튼 노출
```

- "본문(재시도용)" 줄은 3가지로 분기한다: ① `retryable=true`(FAILED·본문 있음) → 표시하지 않음(재발송 가능이 곧 "본문 있음"의 뜻이므로 별도 언급 불요) ② `payloadPurged=true` → `PurgedFieldNotice`(No.45 `components/DataGovernanceBadges.tsx`, **그대로 재사용** — 문구 "보존기간 경과로 파기됨"이 정확히 일치) + "재발송할 수 없습니다" 병기 ③ `statusReason='DECRYPT_FAILED'`(**확정(2026-09-26) — `WorkflowStatusReason`에 신설되는 전용 사유 코드**, 설계서 §10.1 봉투 복호화 실패로 송신 자체를 하지 못하고 종결된 경우) → `MESSAGES.workflowRuns.detailDecryptFailed`(§7.6): "저장된 요청 내용을 복호화하지 못해 실패로 종료되었습니다. 운영자에게 문의하세요." — 최초 초안의 `status=FAILED ∧ lastOutcome=null` **추론 방식은 폐기**한다(backend-implementer가 `WorkflowStatusReason` 스키마·발행 지점·오류 코드 매핑에 이 값을 추가해야 한다, §13-2).
- `deliveryId`는 **앞 8자만 노출 + 복사 버튼**(연동 담당자가 받는 쪽 로그와 대조할 때 사용 — 전체 값은 복사로만 얻는다, No.45 `CopyButton` 재사용).

### 컴포넌트 분해

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `WorkflowRunFilterBar` | `targetId?`, `chatbotId?`, `triggerKind: WorkflowTriggerKind[]`, `eventType: WorkflowEventType[]`, `status: WorkflowRunStatus[]`, `DateRangeField`(기본 최근 7일, 최대 90일 — 초과 시 `400 STATS_RANGE_TOO_WIDE` 인라인 "조회 기간은 최대 90일까지 가능합니다"), `retryableOnly: boolean` |
| `WorkflowRunTable` | `items: WorkflowRunItem[]`, `loading` | 컬럼: 발생(KST), 챗봇, 트리거(노드명+동작 키 또는 이벤트 라벨), 대상 이름(스냅샷), `WorkflowRunStatusBadge`, 시도 수, `WorkflowOutcomeBadge`(있으면), 지연(ms) |
| `WorkflowRunDetailPanel`(펼침) | `run: WorkflowRunDetail` | §3.2.1 |
| `Pagination` | 기본 50/페이지, 최대 100 |

---

## 3.2b WF3-b — 챗봇 실행 이력·재발송/취소 (`/chatbots/:chatbotId/workflow-automation/runs`)

### 목적
이 챗봇의 발송 건을 조회하고, 실패 건을 **일괄 재발송**하거나 대기 건을 **취소**한다(FR-WF7-3·7-4).

### 상태별 UI(§3.2 전역 화면과 공통분은 생략, 추가분만)

| 상태 | UI |
|---|---|
| 행 선택 후 "재발송" | 선택 건이 전부 `FAILED ∧ 본문 있음`이 아니면 버튼이 `disabled` + 툴팁 "재발송은 실패 + 본문이 남은 건만 가능합니다" |
| 재발송 확인 | `ConfirmDialog`: "{n}건을 다시 보내시겠습니까? 같은 전달 식별자로 다시 시도합니다." → 확인 버튼 라벨 "{n}건 재발송"(NFR-WFA2 — 명시적 버튼 이름) |
| 재발송 성공 | `aria-live="polite"` 1회: "{n}건을 다시 보냈어요."(NFR-WFA3) + 목록 갱신(상태 `PENDING`으로) |
| 재발송 일부 불가(`409 WORKFLOW_RUN_NOT_RETRYABLE`) | 확인 모달 안에 배너: "{n}건은 본문이 이미 사라졌거나 실패 상태가 아니어서 재발송할 수 없습니다." + 해당 건 목록(최대 5) — **전체 거부**(부분 처리 없음, 설계서 §7.7) 이므로 선택을 조정해 다시 시도해야 한다는 안내 병기 |
| 취소 확인 | `ConfirmDialog`: "{n}건을 취소하시겠습니까? 대기 중인 요청은 더 이상 전달되지 않습니다." → "{n}건 취소" |
| 취소 일부 불가(`400 INVALID_STATUS_TRANSITION`) | 배너: "{n}건은 이미 처리 중이거나 끝나서 취소할 수 없습니다." |

### 컴포넌트 분해(§3.2 재사용분 제외)

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `WorkflowRunFilterBar`(§3.2 재사용 — **대상 필터 포함, 확정 2026-09-26**) | §3.2와 동일 props(`targetId?` 포함) — 백엔드가 `GET /chatbots/:chatbotId/workflow-runs`에 `targetId` 쿼리를 지원하기로 확정했다. 대상 선택 목록은 전역 발송 대상 전체를 보여준다(이 챗봇이 참조/구독한 대상으로 좁히지 않는다 — 단순화. 이 챗봇과 무관한 대상을 고르면 자연히 0건이 나온다) |
| `WorkflowRunTable`(선택 체크박스 열 추가) | `selectable`, `selectedIds`, `onSelectionChange` — `status='PENDING'|'HELD'`(취소 후보) 또는 `status='FAILED'`(재발송 후보)만 체크박스 활성 |
| `WorkflowRunBulkActionBar` | `selectedCount`, `onRetry`, `onCancel` — 상단 고정, 선택 0건이면 렌더하지 않음 |
| `RetryWorkflowRunsConfirmDialog` / `CancelWorkflowRunsConfirmDialog` | `runIds` | 위 표의 확인 모달 |

**확정(2026-09-26)** — 최초 초안은 "이 화면에는 대상 필터가 없다(챗봇 스코프이므로 트리거·이벤트 필터로만 좁힌다)"였으나, 백엔드가 챗봇 스코프 이력 조회에도 `targetId` 쿼리를 지원하기로 확정하면서 §3.2와 동일한 `WorkflowRunFilterBar`(대상 필터 포함)를 그대로 재사용하는 것으로 바뀌었다(한 챗봇이 여러 대상을 구독/참조하는 경우 — 휴가 신청은 A 대상, 상담 종료는 B 대상 — 대상별로 좁혀 볼 수 있다, §13-4).

---

## 3.3 WF1-c — 요약 통계(전역) (`/settings/workflow-automation/summary`)

### 목적
전역 발생·성공·실패·건너뜀 추이와 "확인 필요" 항목을 한눈에 본다(FR-WF7-7).

### 레이아웃

```
┌───────────────────────────────────────────────────────────────────────────┐
│ [발송 대상] [실행 이력] [요약]                     기간 (●7일 ○30일)        │
├───────────────────────────────────────────────────────────────────────────┤
│ 발생 1,204   성공 1,180(98.0%)   실패 12   건너뜀 8   재시도율 3.1%  P95 640ms│
├───────────────────────────────────────────────────────────────────────────┤
│ ⚠ 확인 필요                                                                │
│  · 연속 실패 대상 1개(품질티켓봇 대상)                                       │
│  · 실패 보관 5건(7일 뒤 재발송 불가)                                        │
│  · 비밀 미설정 대상을 참조하는 노드/구독 2건                                 │
│  · 가장 오래된 대기 건 42분째                                               │
│  · 최근 24시간 적재 실패 0건                                                │
├───────────────────────────────────────────────────────────────────────────┤
│ 대상별: 그룹웨어결재 발생812 성공800 실패12 · 품질티켓봇 발생392 성공380 …    │
│ 이벤트별: 업무요청 발생620 · 상담종료 발생210 · 설문완료 발생180 …            │
├───────────────────────────────────────────────────────────────────────────┤
│ 일별 추이(막대 없이 숫자 목록 — 차트 라이브러리 미도입 원칙 승계)             │
│ 09-20 성공142 실패1 건너뜀0 · 09-21 성공150 실패2 건너뜀1 · …                │
└───────────────────────────────────────────────────────────────────────────┘
```

- P95 지연이 표본 초과로 근사치면(`approximated:true`) 값 옆에 "(근사)" 표기 + 툴팁 "최근 10,000건 표본 기준입니다."
- "확인 필요" 섹션의 각 줄은 클릭 시 해당 조건으로 필터링된 §3.1(대상)·§3.2(이력) 화면으로 이동한다(예: "연속 실패 대상 1개" 클릭 → 발송 대상 탭 + 검색 적용).

### 컴포넌트 분해

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `WorkflowSummaryPeriodToggle` | `days: 7|30` |
| `WorkflowSummaryTotals` | `totals`, `retryRate`, `p95DeliveryMs`, `approximated` |
| `WorkflowAttentionList` | `attention: WorkflowSummaryResponse['attention']` — 항목별 0건이면 그 줄을 렌더하지 않는다(전부 0이면 "확인이 필요한 항목이 없습니다" 안내만) |
| `WorkflowByTargetList` / `WorkflowByEventList` | `byTarget[]` / `byEvent[]` |
| `WorkflowDailyTrendList` | `daily[]` |

---

## 3.4 WF2 — 노드 편집기 "업무 요청 보내기" 아웃풋(신규 13번째 타입)

### 목적
EDITOR가 폼으로 모은 값(또는 고정값)을 업무 자동화 대상으로 보내는 아웃풋을 노드에 추가한다.

### 진입 경로
`DialogOutputEditor.tsx`의 `OUTPUT_TYPES`(현재 `TEXT`~`API_CONDITION` 12종) 셀렉트에 13번째 값 `WORKFLOW`("업무 요청 보내기")를 추가한다. `defaultPayloadFor('WORKFLOW')`는 `{ version: 1, targetId: '', actionKey: '', fields: [] }`를 반환한다.

### 레이아웃

```
┌─────────────────────────────────────────────────────────────────┐ ▲ ▼ ⌫
│ N  유형 [업무 요청 보내기 ▾]                                       │
│    ⓘ 이 아웃풋은 사용자에게 보이지 않습니다. 앞뒤에 안내 문구를 넣으세요│
│    대상 * [검색: 대상 이름으로 찾기_______▾]  [그룹웨어 결재 흐름 ×] │
│           서명 켜짐 · 인증 설정됨 · 사용 중                          │
│    동작 키 * [leave.request______________]                        │
│      ⓘ 받는 쪽 자동화 흐름이 어떤 처리를 할지 고르는 값입니다        │
│    필드 (3/20)                                          [+ 필드 추가]│
│      이름[start]  (●상수 ○폼 슬롯)[2026-10-10______]           ⌫  │
│      이름[end]    (○상수 ●폼 슬롯)[휴가신청폼 › 종료일 ▾]       ⌫  │
│      이름[reason] (○상수 ●폼 슬롯)[휴가신청폼 › 사유 ▾]         ⌫  │
│    ⓘ 필드 값은 기본적으로 가려져(마스킹) 전송됩니다. 대상에서 '원문   │
│       개인정보 전송 허용'을 켠 경우에만 그대로 전송됩니다.           │
│    (원문 허용 대상이면) ⚠ 이 대상은 원문 개인정보 전송이 켜져 있습니다│
└─────────────────────────────────────────────────────────────────┘
```

### 컴포넌트 분해

| 컴포넌트 | props / 검증 |
|---|---|
| `WorkflowTargetPickerField` | §2.2 |
| `TextInputField`(동작 키) | `^[a-z0-9._-]{1,60}$`, 위반 시 즉시 인라인("영문 소문자·숫자·.·_·- 60자 이내로 입력하세요.") |
| `WorkflowFieldListEditor` | §2.2 — 최대 20개, 필드 이름 유일(중복 시 `VALIDATION_FAILED` 인라인) |
| `WorkflowInvisibleOutputHint` | 고정 안내(항상 노출, NFR-WFA4 — 스크린리더로 읽힌다): "이 아웃풋은 사용자에게 보이지 않습니다. 앞뒤에 안내 문구를 넣으세요." |
| `RawPersonalDataBadge`(재사용) | 대상이 원문 허용이면 표시 |

### 필드-오류 매핑

| field 패턴 | 표시 위치 | 대표 메시지 |
|---|---|---|
| `outputs[i].workflow.targetId` | `WorkflowTargetPickerField` 하단 | "선택한 발송 대상을 찾을 수 없습니다. 목록을 새로고침해 주세요."(`INVALID_REFERENCE`, 404) |
| `outputs[i].workflow.actionKey` | 동작 키 필드 하단 | "영문 소문자·숫자·.·_·- 60자 이내로 입력하세요."(`400`) |
| `outputs[i].workflow.fields[j].name` | 해당 필드 행 | "필드 이름이 중복되었습니다."(`VALIDATION_FAILED`, 400) |
| 노드당 `WORKFLOW` 4개 이상 | 폼 상단 배너 | "한 노드에는 '업무 요청 보내기'를 3개까지 넣을 수 있습니다."(`OUTPUT_PAYLOAD_INVALID`, 400) |

### 노드 복사·토픽 분리(FR-WF2-9)
대상이 전역이므로 `WORKFLOW` 아웃풋은 **그대로 복사**된다(별도 안내 문구 불요 — No.26의 "이전 형식 API 조건은 복사되지 않는다" 같은 예외가 없다. 다만 폼 슬롯 참조는 기존 컨텍스트 재매핑 규칙을 따르므로, 원본과 다른 폼을 가진 노드로 복사되면 설계 점검이 `WORKFLOW_SLOT_BINDING_UNREACHABLE`로 알린다).

---

## 3.5 WF3 — 챗봇 > 업무 자동화 — 이벤트 구독 (`/chatbots/:chatbotId/workflow-automation/subscriptions`)

### 목적
EDITOR가 이 챗봇의 상담 시작·종료·설문 완료·부정 평가·연속 미응답 이벤트를 업무 자동화 대상으로 보내도록 구독을 설정한다(FR-WF3-1).

### 상태별 UI

| 상태 | UI |
|---|---|
| 로딩 | `SkeletonRow` × 5(이벤트 5종 자리) |
| 조회 성공 | §3.5.1 표 |
| 저장 성공 | `Toast` + `aria-live="polite"` 1회 |
| `409 DUPLICATE_NAME`(같은 이벤트+대상 중복) | 인라인: "이미 같은 이벤트·대상 조합의 구독이 있습니다." |
| `409 LIMIT_EXCEEDED`(챗봇당 20 초과) | 배너: "이 챗봇에는 구독을 20개까지 등록할 수 있습니다." |
| ARCHIVED 챗봇 | 표는 조회 가능, 쓰기 액션 시 `409 CHATBOT_ARCHIVED` → "보관 상태인 챗봇은 구독을 변경할 수 없습니다."(재발송·취소·조회는 예외적으로 허용 — §3.2b 안내와 동일 원칙) |

### 3.5.1 레이아웃

```
[이벤트 구독] [실행 이력]                                (서브탭, role=tablist)

ⓘ 이 설정은 환경 분리 대상이 아닙니다 — 저장 즉시 운영에 적용됩니다
   (다른 서버 인스턴스에는 최대 30초 안에 반영됩니다).

이벤트              대상                    조건            사용   정지   비고
상담 시작           [팀 메신저 봇 ▾]         —              ☑     ☐
상담 종료           [팀 메신저 봇 ▾]         —              ☑     ☐
설문 완료           [설문 결과 채널 ▾]       ☐선택/척도 답 포함 ☑   ☐
부정 평가           [품질티켓봇 ▾]           —              ☑     ☐
연속 미응답 N회     [상담원 호출 봇 ▾]       임계값[3](2~10)  ☑     ☐

                                                   [+ 다른 대상으로 추가]
```

- 이벤트 5종은 **고정 행**(닫힌 목록, FR-WF3-2)이며 각 행은 대상을 고르지 않으면(빈 값) "미구독" 상태로 표시되고 사용/정지 열이 비활성화된다.
- 같은 이벤트를 **여러 대상**으로 보내려면 "+ 다른 대상으로 추가"로 같은 이벤트의 추가 행을 만든다(구독은 (챗봇, 이벤트, 대상) 유일이지 이벤트 유일이 아니다 — FR-WF3-1).
- "정지" 체크는 `TargetPausedBadge`와 별개로 **구독 단위** 정지다(§7.6 — `HELD(SUBSCRIPTION)`).
- `WorkflowTargetPickerField` 재사용(§2.2), 임계값(연속 미응답)만 `NumberInputField`(2~10, 방향키 조작 가능).

### 컴포넌트 분해

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `ChatbotWorkflowShell` | 서브탭 헤더 + `<Outlet/>` |
| `EnvironmentScopeNotice`(No.40, **무변경 재사용**) | 고정 안내(§3.5.1 상단) — `role="status"` 기존 패턴 그대로 |
| `WorkflowSubscriptionTable` | `items: WorkflowSubscription[]`, `eventTypes: WorkflowSubscriptionEventType[]`(고정 5) |
| `WorkflowSubscriptionRow` | `subscription \| null`(빈 행 포함), `eventType`, `onSave`, `onDelete`, `onPause/onResume` |
| `WorkflowSubscriptionConditionField` | `eventType`별 조건 폼(연속 미응답=임계값 숫자, 설문 완료=체크박스, 그 외=없음) |

---

## 3.6 WF6 — 시뮬레이터 "업무 요청(모의)" 단계 패널

### 목적
관리자가 응답 테스트에서 이 턴에 "업무 요청 보내기"가 실행됐음을 확인하되, **실제로는 전송되지 않는다**는 것을 분명히 한다(FR-WF2-7 · J-13).

### 레이아웃(`WorkflowStepPanel`, `ApiStepPanel`과 동형 접이식)

```
▾ 업무 요청(모의)
  대상: 그룹웨어 결재 흐름(사용 중) · 동작 키: leave.request
  필드: start=2026-10-10, end=2026-10-12, reason=●●●(마스킹)
  ⓘ 실제로 보내지 않았습니다 — 실제 발송 확인은 발송 대상 화면의 '테스트 발송'을 이용하세요.
```

- `bindingMissing:true`이면 "필드 값을 채울 폼이 완료되지 않아 보내지 않습니다."로 대체.
- 원문 허용 대상이면 필드 값이 마스킹 대신 원문으로 보이고 "원문 전송됨" 배지가 붙는다(관리자 본인이 방금 입력한 값 — ADR-0013 §5 예외 범위, No.26과 같은 취급).
- 대상이 꺼짐/정지/비밀 미설정이면 `targetState` 값에 따라 "이 대상은 사용 중지 상태입니다(실제로는 보내지지 않습니다)." 등으로 안내.
- 시뮬레이터의 `ApiModeToggle`(LIVE/MOCK)과는 **무관**하다 — LIVE 모드여도 웹훅은 항상 모의만 표시한다(J-13, EX-WF-24).

---

## 3.7 WF4 — 설계 점검 패널 확장 (`DesignValidationPanel`)

기존 패널에 아래 5종 항목이 더해진다(§5.7, 전부 저장을 막지 않는다 — WARNING/INFO):

| 코드 | 심각도 | 문구 |
|---|---|---|
| `WORKFLOW_TARGET_UNAVAILABLE` | WARNING | "'{노드명}'의 업무 요청 보내기가 사용 중지되었거나 정지된 대상을 참조합니다." |
| `WORKFLOW_SLOT_BINDING_UNREACHABLE` | WARNING | "'{노드명}'의 필드 '{필드명}'이 이 노드에서 완료되지 않는 폼 슬롯을 참조합니다 — 항상 빈 값으로 처리됩니다." |
| `WORKFLOW_ONLY_OUTPUT` | WARNING | "'{노드명}'은 사용자에게 보이는 응답이 없습니다 — 기본 안내 문구만 나갑니다." |
| `WORKFLOW_NO_FIELDS` | INFO | "'{노드명}'의 업무 요청 보내기에 필드가 없습니다." |
| `WORKFLOW_RAW_PERSONAL_DATA` | INFO | "'{노드명}'이 원문 개인정보 전송이 켜진 대상을 참조합니다." |

`BROKEN_REFERENCE`(기존 코드)는 삭제된 대상을 가리킬 때 재사용된다(신규 코드 아님).

---

## 3.8 WF5 — 흐름 미리보기 확장 (`FlowPreviewPanel`)

`WORKFLOW` 아웃풋은 분기를 만들지 않으므로(비종결·화살표 없음) 자식 노드 라벨(`ApiBranchLabel` 같은 것)은 필요 없다. 대신 그 아웃풋을 가진 노드 카드에 작은 아이콘 배지 "🔗 업무 요청"(aria-label "이 노드는 업무 요청을 보냅니다")을 붙여, 그래프만 보고도 "이 노드가 뒤에서 무언가를 보낸다"는 사실을 알 수 있게 한다(설계서 §1.5 P-2 선택 이유 "편집기에서 보이는 흐름"과 대응).

---

## 3.9 WF7 — 버전 복원 미리보기 경고 확장

`version-history-ui-spec.md` §4.4.3 `RestoreWarningList`(No.26에서 14종이 됨)에 2종이 추가되어 **16종**이 된다.

| `code` | 문구 |
|---|---|
| `WORKFLOW_TARGET_MISSING` | "대상 버전의 노드 {n}개가 존재하지 않는 발송 대상을 참조합니다(복원 후 실행 시 발송이 건너뛰어집니다)." |
| `WORKFLOW_TARGET_DISABLED` | "대상 버전의 노드 {n}개가 사용 중지된 발송 대상을 참조합니다(복원 후 실행 시 발송이 건너뛰어집니다)." |

- 둘 다 `blocker`가 아니다(복원을 막지 않음). 예약 배포(No.28) 준비도 경고·운영 전환 미리보기도 같은 목록을 재사용하므로 **추가 화면 변경 없이** 이 2종을 포함한다(FR-WF9-2).

---

## 3.10 WF8 — 데이터 지도(No.45) 확장

`data-governance-ui-spec.md` §3.1.1의 "외부 전송(출구 5종 + 레거시 연결)" 표가 **6종 + 레거시 연결 + 업무 자동화 대상**으로 확장된다. 기존 표는 이미 "레거시 연결(3) — 아래 상세"처럼 클래스별 하위 목록을 펼치는 구조이므로, `EgressTable` 컴포넌트에 `WORKFLOW_WEBHOOK` 케이스를 추가해 같은 방식으로 렌더한다(신규 컴포넌트 없이 기존 `EgressTable`의 렌더 분기만 1건 추가 — **이 문서가 판단한 확장**, §12 참고).

```
├─ 외부 전송(출구 6종 + 레거시 연결 + 업무 자동화 대상) ─────────────────────┤
│ 출구           대상 호스트         송신 데이터          마스킹    판정   차단(24h)│
│ …(기존 5종)…                                                              │
│ 업무 자동화 웹훅  대상 2개 — 아래 상세                                       │
│  · 그룹웨어결재   (비밀 주소)        폼 값·이벤트 메타데이터  대상별  ● 허용  0 │
│  · 품질티켓봇    ticket.corp.internal 폼 값·이벤트 메타데이터  대상별  ● 허용  3│
└────────────────────────────────────────────────────────────────────────┘
잔존 위험: 원문 조회 허용 연결(allowRawPersonalData): 1개 · 원문 개인정보 전송 허용 업무 자동화 대상: 1개  ← 신규 줄
```

- 대상 0개 설치에서는 "업무 자동화 웹훅" 행 자체가 나타나지 않는다(FR-0-172·§9.6 — 선택 키 생략 시 렌더 생략).
- `EgressJudgementBadge`(No.45, 재사용)를 그대로 쓴다 — 신규 배지 없음.

---

## 3.11 WF9 — 챗봇 영구삭제 확인 확장

`PermanentDeleteModal`(§ modals.tsx)에 안내 1줄을 추가한다. 모달이 열릴 때 `GET /chatbots/:chatbotId/workflow-runs/summary`를 1회 조회해(설계서 §10.4가 "프런트가 챗봇 이력 요약으로 조회"라고 명시) `totals.pending + totals.held` 합이 0보다 크면:

```
⚠ 대기 중인 업무 자동화 요청 {n}건이 함께 취소됩니다.
```

기존 `archiveStatsNotice`(보관 시 안내)와 같은 `field-hint` 스타일로 삽입하며, 조회가 실패해도 삭제 자체를 막지 않는다(조용히 생략).

---

## 3.12 WF10 — `SystemSettingsMenu` 항목 추가

```
{ label: MESSAGES.systemSettings.workflowAutomation, href: '/settings/workflow-automation', permission: 'security:read' }
```

위치는 "API 연결" 다음, "데이터 거버넌스" 앞 — 같은 `security:read` 보안 설정 그룹으로 묶는다(순서: 회원 관리 → 금지어 관리 → API 연결 → **업무 자동화**(신규) → 데이터 거버넌스 → 이력 관리 → 예약 배포 현황). 배지는 §5(WF11)에서 정의하는 것과 같은 소스(요약의 `attention`)를 쓰되, 메뉴 트리거 버튼에는 `AttentionCountBadge`류의 합산 배지를 붙이지 않는다 — **이유**: `AttentionCountBadge` 컴포넌트는 `MESSAGES.deploySchedules` 문구에 결합돼 있어 그대로 재사용할 수 없고(§2.1 코드 확인), 메뉴 트리거는 이미 예약 배포 배지 1개를 쓰고 있어 두 번째 숫자 배지를 병기하면 의미가 섞인다. 대신 메뉴 항목 텍스트 옆에 작은 점(`● `) + `aria-label="확인이 필요한 항목이 있습니다"`만 붙이는 **경량 배지**를 신설한다(§7 메시지 키 `workflowAttentionDot*`). **이 경량 배지 안은 최종안으로 확정됐다(§13-3) — 배지 범용화 리팩터링은 범위 밖이다.**

---

## 3.13 WF11 — `TabNav` "업무 자동화" 탭 + 배지

`TabNav.tsx`의 "배포" 그룹(스킨/채널/예약배포/환경) 끝에 5번째 탭을 추가한다(**§13-1 확정 — 13번째 최상위 탭**):

```tsx
<NavLink to={`/chatbots/${chatbotId}/workflow-automation`} className={tabClassName} onClick={handleClick}>
  {MESSAGES.detail.tabWorkflowAutomation} <WorkflowAttentionNavBadge count={workflowAttention?.count ?? 0} />
</NavLink>
```

- `learningSummary`/`environmentStatus`와 같은 패턴으로, `ChatbotDetailLayout`이 챗봇 상세 마운트당 **1회** `GET /chatbots/:chatbotId/workflow-runs/summary`를 조회해 `workflowAttention`(예: `{ count: number }` — 연속 실패 대상·비밀 미설정·실패 보관 존재 여부를 합산한 파생값)을 `TabNav`에 내려준다(중복 요청 방지 — 코드 주석 관례와 동일한 이유).
- `WorkflowAttentionNavBadge`(신규, `NegativeFeedbackNavBadge`와 동형): 0건이면 렌더하지 않고, 있으면 주황 톤 + 아이콘 + 텍스트("확인 필요 {n}") + `aria-label`.
- `chatbot:read`+`dialogue:read`가 없는 AGENT도 탭 링크 자체는 보인다(다른 탭과 동일한 원칙 — 클릭 시 페이지 안에서 `ForbiddenState`로 막는다). 배지 집계용 조회는 그 권한이 없으면 호출 자체를 생략한다(불필요한 403 방지).

---

## 4. 사용자 인터랙션 흐름 종합

### 4.1 발송 대상 등록 → 시크릿 설정 → 테스트 성공 (S-2)
```
WF1 "+ 발송 대상 추가" → WorkflowTargetEditModal
  → 이름/URL/비밀주소 사용/인증/서명/시크릿참조 입력 → 저장(POST) → 201
  → 목록에 새 행, SecretStatusBadge=MISSING(경고 유지)
  → [테스트 발송] → SECRET_MISSING → 안내 문구(서버 guidance)
  → (운영자가 서버에 WORKFLOW_SECRET__GW_LEAVE 설정 후 재기동, 콘솔 밖)
  → 목록 새로고침 → SecretStatusBadge=CONFIGURED
  → [테스트 발송] 재시도 → 202 · 412ms · 성공 → aria-live로 결과 낭독
```

### 4.2 노드에 업무 요청 보내기 추가 → 저장 → 폼 완료 (S-1)
```
D1b 노드 편집 → 아웃풋 추가 → 유형 "업무 요청 보내기" 선택 → WorkflowOutputEditor 렌더
  → 대상 선택 → 동작 키 → 필드 3개(2개는 폼 슬롯, 1개는 상수) → [저장] → 200 → Toast
  → D1로 돌아와 [설계 점검] → 경고 없음 확인
  → 위젯에서 사용자가 휴가신청 폼 완료 → 봇 응답: "결재 요청을 올렸어요. 결과는 메일로 안내됩니다."
    (사용자 화면에는 지연·추가 표시 없음 — 대화 응답은 발송을 기다리지 않는다, P-4(a))
  → WF3-b(챗봇 실행 이력)에서 1건 PENDING → 5초 이내 SUCCEEDED 확인
```

### 4.3 상담 종료 알림 구독 (S-3)
```
WF3(챗봇 > 업무 자동화 > 이벤트 구독) → "상담 종료" 행 대상 선택 → 사용 체크 → 자동 저장
  → EnvironmentScopeNotice: "저장 즉시 운영에 적용됩니다" 확인
  → 상담원이 상담 종료 → WF3-b 이력에 1건(사유·메시지 수 메타데이터만) 확인
```

### 4.4 받는 쪽 장애 → 재시도 → 콘솔 경고 (S-5)
```
대상이 503 반복 → WF1-b/WF3-b 이력에서 같은 deliveryId로 시도 수 증가 확인
  → WF1 목록에 ConsecutiveFailureBadge("연속 실패 12회") 노출
  → WF1-c 요약의 "확인 필요"에 해당 대상 노출 → 클릭 시 WF1로 필터 이동
  → 점검 종료 후 성공 1회 → 배지 해제
```

### 4.5 실패 재발송 (S-7)
```
WF3-b 실행 이력 → 상태 필터 "실패"(대상 필터로 좁힐 수도 있음) → 5건 체크 → [재발송]
  → 확인 모달 "5건을 다시 보내시겠습니까?" → [5건 재발송]
  → 성공 → aria-live "5건을 다시 보냈어요." → 상태가 PENDING으로 갱신
  → (7일 지난 건 포함 시도) → 확인 모달에 "본문이 사라져 재발송할 수 없는 건 2건" 배너 → 선택 조정 후 재시도
```

### 4.6 일시 정지 (S-6)
```
WF1 목록 행 케밥 → "일시 정지" 클릭(확인 없음, 즉시 반영)
  → 토스트 "일시 정지했습니다(보류 3건)."
  → WF1-b/WF3-b 이력에서 새 요청이 HELD 상태로 쌓이는 것 확인
  → "재개" 클릭 → 토스트 "재개했습니다(발송 3건 · 만료 0건)."
```

### 4.7 시뮬레이터 확인 (S-8)
```
SIM 응답 테스트 → 휴가신청 폼 완료 재현 → WorkflowStepPanel(접힘) 클릭해 펼침
  → "대상: 그룹웨어 결재 흐름 · 필드: start=…, reason=●●●(마스킹)"
  → "실제로 보내지 않았습니다" 확인 → 실제 확인은 WF1 테스트 발송으로 이동
```

### 4.8 버전 복원 — 대상 삭제 후 (S-9)
```
WF1에서 대상 "그룹웨어결재" 삭제(참조 해제 후 가능) → 204
  → 버전 이력 화면 > 과거 버전 "복원" → RestoreDialog
  → RestoreWarningList에 "대상 버전의 노드 1개가 존재하지 않는 발송 대상을 참조합니다…" 노출(blocker 아님)
  → [복원] 진행 → 복원 완료 → 해당 노드 실행 시 발송이 SKIPPED(TARGET_UNAVAILABLE)로 건너뛰어짐(콘솔 이력에서 확인 가능)
```

---

## 5. 권한별 화면 요소

신규 권한 문자열은 0종이다(P-8). 기존 권한의 적용 지점만 다음과 같이 넓어진다.

| 화면/요소 | VIEWER | EDITOR | AGENT | ADMIN |
|---|---|---|---|---|
| WF1 목록 조회 | 비노출(메뉴 자체가 숨김) | 비노출 | 비노출 | 표시(`security:read`) |
| WF1 생성·수정·삭제·테스트·정지 | — | — | — | 가능(`security:write`) |
| WF2 `WorkflowTargetPickerField`(선택 목록) | 조회만(`dialogue:read`) — 주소·시크릿은 응답에 없음 | 선택·저장 가능(`dialogue:write`) | — | 좌동 |
| WF2 폼 전체 | 읽기 전용(`disabled`, 기존 규칙 상속) | 편집 가능 | — | 편집 가능 |
| WF3 이벤트 구독 조회·저장 | 조회만(`chatbot:read`+`dialogue:read`) | 저장 가능(`chatbot:write`) | **403**(`dialogue:read` 없음, R-9) | 좌동 |
| WF1-b/WF3-b 실행 이력 조회 | WF1-b: 비노출 · WF3-b: 조회 가능 | 조회 가능(`chatbot:write` 없어도 조회는 `chatbot:read`+`dialogue:read`) | **403** | 전부 가능 |
| WF3-b 재발송·취소 | 불가(버튼 비활성 + 툴팁 "쓰기 권한이 없습니다") | 가능(`chatbot:write`) | **403** | 가능 |
| WF6 `WorkflowStepPanel` | 조회 가능(순수 표시, 쓰기 아님) | 가능 | — | 가능 |
| WF7 복원 경고 2종 | 복원 자체가 `dialogue:write`+`chatbot:write` 필요 — VIEWER는 진입 불가(기존 규칙 상속) | 조건 충족 시 가능 | — | 가능 |
| WF11 탭 배지 집계 | 조회 가능(`chatbot:read`+`dialogue:read`) | 가능 | 조회 생략(불필요한 403 방지) | 가능 |

`SystemSettingsMenu`의 `ITEMS` 배열 순서는 §3.12 참고.

---

## 6. 상태별 화면(로딩/빈/오류) 총정리

| 화면 | 로딩 | 빈 상태 | 오류 |
|---|---|---|---|
| WF1 발송 대상 | `SkeletonRow`×5 | "등록된 발송 대상이 없습니다." + 추가 CTA | `ErrorState` |
| WF1-b/WF3-b 실행 이력 | `SkeletonRow`×5 | "선택한 조건에 해당하는 실행 이력이 없습니다." | `ErrorState` |
| WF1-c 요약 | 카드 자리 `SkeletonRow`×4 | 0건도 정상 완료 표시(오류 아님, UIUX §8) | `ErrorState` |
| WF3 이벤트 구독 | `SkeletonRow`×5(이벤트 5종 고정 행이라 "빈 상태" 개념 없음 — 전부 미구독으로 표시) | — | `ErrorState` |
| WF2 노드 아웃풋 | 대상 선택 목록 로딩 중엔 셀렉트 `disabled`+"불러오는 중…" | 대상 0건 → 피커의 "발송 대상으로 이동" 안내 | 저장 실패 시 인라인(§3.4 표) |

---

## 7. `messages.ts` 키 설계 (`apps/web/src/constants/messages.ts`)

### 7.1 `MESSAGES.systemSettings`(확장)
```ts
workflowAutomation: '업무 자동화',
```

### 7.2 `MESSAGES.detail`(확장, TabNav)
```ts
tabWorkflowAutomation: '업무 자동화',
```

### 7.3 `MESSAGES.dialogue.outputTypes` / `outputFields`(확장)
```ts
outputTypes: { /* 기존 12종 */ WORKFLOW: '업무 요청 보내기' },
outputFields: {
  /* 기존 */
  workflowInvisibleHint: '이 아웃풋은 사용자에게 보이지 않습니다. 앞뒤에 안내 문구를 넣으세요.',
  workflowTargetLabel: '대상',
  workflowActionKeyLabel: '동작 키',
  workflowActionKeyHint: '받는 쪽 자동화 흐름이 어떤 처리를 할지 고르는 값입니다.',
  workflowFieldsTitle: (cur: number, max: number) => `필드 (${cur}/${max})`,
  workflowFieldsMaskHint: "필드 값은 기본적으로 가려져(마스킹) 전송됩니다. 대상에서 '원문 개인정보 전송 허용'을 켠 경우에만 그대로 전송됩니다.",
  workflowFieldNameLabel: '이름',
  workflowFieldDuplicateName: '필드 이름이 중복되었습니다.',
  workflowOutputLimitExceeded: "한 노드에는 '업무 요청 보내기'를 3개까지 넣을 수 있습니다.",
},
```

### 7.4 신규 네임스페이스 `MESSAGES.workflowTargets`
```ts
workflowTargets: {
  pageTitle: '발송 대상',
  tabTargets: '발송 대상', tabRuns: '실행 이력', tabSummary: '요약',
  searchLabel: '검색',
  filterEnabledLabel: '사용 여부', filterEnabledOn: '사용중', filterEnabledOff: '사용중지',
  filterIncludePaused: '정지 중 포함',
  addButton: '+ 발송 대상 추가',
  columnName: '이름', columnHost: '호스트', columnAuth: '인증', columnSigning: '서명',
  columnSecret: '비밀 상태', columnStatus: '상태', columnReferencing: '참조',
  hostSecretPlaceholder: '(비밀 주소)',
  badgeEnabled: '사용 중', badgeDisabled: '사용 중지', badgePaused: '일시 정지',
  badgeSigningWeak: '서명 비밀 약함', badgeSigningWeakTitle: '기동 실패가 아닙니다 — 32자 이상 비밀로 교체를 권장합니다.',
  badgeRawPersonalData: '원문 송신',
  badgeConsecutiveFailures: (n: number) => `연속 실패 ${n}회`,
  badgeConsecutiveFailuresTitle: '자동으로 정지되지 않습니다 — 성공 1회로 해제됩니다.',
  pendingHoldSuffix: (pending: number, held: number) => `대기${pending}·보류${held}`,
  emptyTitle: '등록된 발송 대상이 없습니다.',
  emptyDesc: "대화 노드의 '업무 요청 보내기' 아웃풋이나 이벤트 구독에서 쓸 업무 자동화 도구 주소를 여기서 먼저 등록하세요.",
  featureDisabledBanner: '서버 설정으로 업무 자동화 기능이 꺼져 있습니다 — 등록·수정은 가능하지만 발송되지 않습니다.',
  modalCreateTitle: '발송 대상 추가',
  modalEditTitle: (name: string) => `발송 대상 편집 — ${name}`,
  fieldName: '이름', fieldDescription: '설명', fieldBaseUrl: '기준 URL',
  fieldBaseUrlPrivateHint: '사설 주소는 서버 허용 목록에 등록되어야 발송됩니다.',
  fieldBaseUrlInsecureHint: 'http는 암호화되지 않습니다 — 가능하면 https를 사용하세요.',
  fieldUseSecretUrl: '비밀 주소 사용(주소 자체가 비밀인 도구)',
  fieldUrlSecretRef: '비밀 주소 참조',
  fieldAuthType: '인증 방식',
  authTypeNone: '없음', authTypeApiKey: 'API 키(헤더)', authTypeBearer: 'Bearer 토큰', authTypeBasic: '기본 인증',
  fieldAuthHeaderName: '헤더 이름', fieldSecretRef: '시크릿 참조',
  secretRefMissingHint: (ref: string) => `서버에 WORKFLOW_SECRET__${ref}가 설정되지 않았습니다 — 운영자에게 요청하세요.`,
  fieldSigningEnabled: '서명 사용(받는 쪽이 진짜 우리 요청인지 확인하는 값)',
  fieldSigningSecretRef: '서명 비밀 참조',
  fieldTimeoutSec: '타임아웃(초)', fieldMaxAttempts: '최대 재시도',
  fieldAllowRawPersonalData: '원문 개인정보 전송 허용(기본: 가려서 전송)',
  confirmRawPersonalDataLabel: '원문 전송을 켜려면 대상 이름을 다시 입력하세요',
  confirmRawPersonalDataMismatch: '입력한 이름이 대상 이름과 일치하지 않습니다.',
  fieldEnabled: '사용함',
  disableWithPendingConfirm: (n: number) =>
    `대기 중인 요청 ${n}건은 대상이 꺼져 있는 동안 보내지지 않습니다. 잠시 멈추려면 '사용 중지' 대신 '일시 정지'를 쓰세요.`,
  saveSuccess: '발송 대상이 저장되었습니다',
  duplicateName: '이미 같은 이름의 발송 대상이 있습니다. 다른 이름을 입력해 주세요.',
  testPanelTitle: '테스트 발송', testActionKeyLabel: '동작 키(선택)', testButton: '테스트 발송',
  testSuccess: (status: number, latency: number) => `✔ ${status} · ${latency}ms · 실제로 전송했습니다`,
  testDisabledNotice: '대상이 꺼져 있어 실제 대화에서는 보내지 않습니다.',
  testPausedNotice: '대상이 일시 정지 중이어서 실제 대화에서는 보내지 않습니다.',
  testRateLimited: '잠시 후 다시 시도하세요(분당 테스트 발송 한도 초과).',
  pauseButton: '일시 정지', resumeButton: '재개',
  pauseSuccess: (held: number) => `일시 정지했습니다(보류 ${held}건).`,
  resumeSuccess: (pending: number, expired: number) => `재개했습니다(발송 ${pending}건 · 만료 ${expired}건).`,
  deleteConfirmTitle: '발송 대상 삭제',
  deleteConfirmDesc: (name: string) => `'${name}' 대상을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`,
  deleteInUseBanner: (count: number) => `이 대상을 사용하는 노드·구독이 ${count}건 있습니다.`,
  deleteInUseItem: (chatbotName: string, refName: string) => `${chatbotName} › ${refName}`,
  deleteRunningVersionNotice: '운영 중인 버전이 이 대상을 쓰고 있었다면, 그 버전에서는 전송이 건너뛰어집니다.',
  deleteSuccess: '발송 대상이 삭제되었습니다.',
  pickerNoResult: (query: string) => `'${query}'에 해당하는 발송 대상이 없습니다.`,
  pickerCreateLink: '업무 자동화 발송 대상으로 이동 →',
  pickerCreateHint: '관리자에게 발송 대상 등록을 요청하세요.',
  pickerDisabledSuffix: '(사용 중지)', pickerPausedSuffix: '(일시 정지)',
},
```

### 7.5 신규 네임스페이스 `MESSAGES.workflowSubscriptions`
```ts
workflowSubscriptions: {
  tabSubscriptions: '이벤트 구독', tabRuns: '실행 이력',
  scopeNotice: '이 설정은 환경 분리 대상이 아닙니다 — 저장 즉시 운영에 적용됩니다(다른 서버 인스턴스에는 최대 30초 안에 반영됩니다).',
  eventLabel: {
    HANDOFF_STARTED: '상담 시작', HANDOFF_ENDED: '상담 종료', SURVEY_COMPLETED: '설문 완료',
    FEEDBACK_NEGATIVE: '부정 평가', UNANSWERED_STREAK: '연속 미응답 N회',
  },
  columnEvent: '이벤트', columnTarget: '대상', columnCondition: '조건', columnEnabled: '사용', columnPaused: '정지',
  addAnotherTarget: '+ 다른 대상으로 추가',
  conditionThresholdLabel: '임계값', conditionIncludeAnswers: '선택/척도 답 포함',
  duplicateSubscription: '이미 같은 이벤트·대상 조합의 구독이 있습니다.',
  limitExceeded: '이 챗봇에는 구독을 20개까지 등록할 수 있습니다.',
  archivedWriteBlocked: '보관 상태인 챗봇은 구독을 변경할 수 없습니다.',
  saveSuccess: '구독이 저장되었습니다.',
},
```

### 7.6 신규 네임스페이스 `MESSAGES.workflowRuns`
```ts
workflowRuns: {
  pageTitle: '실행 이력',
  filterTargetLabel: '대상', filterChatbotLabel: '챗봇', filterTriggerLabel: '트리거', filterEventLabel: '이벤트',
  filterStatusLabel: '상태', filterRetryableOnly: '재발송 가능만',
  rangeTooWide: '조회 기간은 최대 90일까지 가능합니다.',
  columnOccurredAt: '발생', columnChatbot: '챗봇', columnTrigger: '트리거', columnTarget: '대상',
  columnStatus: '상태', columnAttempts: '시도', columnOutcome: '결과', columnLatency: '지연',
  triggerNode: (action: string) => `업무요청(${action})`,
  statusLabel: {
    PENDING: '대기 중', HELD: '보류', SENDING: '전송 중', SUCCEEDED: '성공',
    FAILED: '실패', SKIPPED: '건너뜀', CANCELLED: '취소됨', EXPIRED: '만료됨',
  },
  outcomeLabel: {
    SUCCESS: '성공', HTTP_ERROR: 'HTTP 오류', TIMEOUT: '시간초과', NETWORK_ERROR: '연결 실패',
    REDIRECT_NOT_ALLOWED: '리다이렉트 차단', BLOCKED_ADDRESS: '주소 차단', EGRESS_BLOCKED: '외부 전송 차단',
    SECRET_MISSING: '비밀 미설정', TARGET_HOST_MISMATCH: '대상 호스트 불일치',
    INVALID_TARGET_URL: '잘못된 대상 주소', LEASE_EXPIRED: '임대 만료(재시도됨)',
  },
  emptyTitle: '선택한 조건에 해당하는 실행 이력이 없습니다.',
  oldestPendingWarning: (min: number) => `가장 오래된 대기 건이 ${min}분째 발송되지 못했습니다 — 서버의 발송 루프 상태를 확인하세요.`,
  detailFieldsLabel: '필드',
  detailFieldsValueHidden: '값은 표시되지 않습니다 — 이름만',
  detailPersonalDataMasked: '개인정보: 기본 가림 적용됨',
  detailPersonalDataRaw: '개인정보: 원문 전송(대상 설정)',
  detailPayloadPurged: '보존기간 경과로 파기됨',
  detailPayloadPurgedNotRetryable: '재발송할 수 없습니다.',
  // [확정 2026-09-26] `WorkflowStatusReason.DECRYPT_FAILED`(신설) 전용 문구 — `lastOutcome=null` 추론 방식(구 `detailUnknownFailure`) 폐기.
  detailDecryptFailed: '저장된 요청 내용을 복호화하지 못해 실패로 종료되었습니다. 운영자에게 문의하세요.',
  deliveryIdLabel: '전달 식별자',
  retryButton: '재발송', cancelButton: '취소',
  retryConfirmTitle: (n: number) => `${n}건을 다시 보내시겠습니까?`,
  retryConfirmDesc: '같은 전달 식별자로 다시 시도합니다.',
  retryConfirmSubmit: (n: number) => `${n}건 재발송`,
  retryDisabledTooltip: '재발송은 실패 + 본문이 남은 건만 가능합니다.',
  retryPartialBlocked: (n: number) => `${n}건은 본문이 이미 사라졌거나 실패 상태가 아니어서 재발송할 수 없습니다.`,
  retrySuccess: (n: number) => `${n}건을 다시 보냈어요.`,
  cancelConfirmTitle: (n: number) => `${n}건을 취소하시겠습니까?`,
  cancelConfirmDesc: '대기 중인 요청은 더 이상 전달되지 않습니다.',
  cancelConfirmSubmit: (n: number) => `${n}건 취소`,
  cancelPartialBlocked: (n: number) => `${n}건은 이미 처리 중이거나 끝나서 취소할 수 없습니다.`,
  writePermissionMissingTooltip: '쓰기 권한이 없습니다.',
},
```

### 7.7 신규 네임스페이스 `MESSAGES.workflowSummary`
```ts
workflowSummary: {
  periodLabel7: '7일', periodLabel30: '30일',
  totalsOccurred: '발생', totalsSucceeded: '성공', totalsFailed: '실패', totalsSkipped: '건너뜀',
  retryRateLabel: '재시도율', p95Label: 'P95', approximatedSuffix: '(근사)',
  approximatedTooltip: '최근 10,000건 표본 기준입니다.',
  attentionTitle: '확인 필요',
  attentionNone: '확인이 필요한 항목이 없습니다.',
  attentionFailingTargets: (n: number) => `연속 실패 대상 ${n}개`,
  attentionFailedRetained: (n: number) => `실패 보관 ${n}건(7일 뒤 재발송 불가)`,
  attentionSecretMissing: (n: number) => `비밀 미설정 대상을 참조하는 노드/구독 ${n}건`,
  attentionOldestPending: (min: number) => `가장 오래된 대기 건 ${min}분째`,
  attentionEnqueueFailures: (n: number) => `최근 24시간 적재 실패 ${n}건`,
  byTargetTitle: '대상별', byEventTitle: '이벤트별', dailyTrendTitle: '일별 추이',
},
```

### 7.8 `MESSAGES.simulator`(확장)
```ts
workflowStepTitle: '업무 요청(모의)',
workflowStepTarget: '대상', workflowStepAction: '동작 키', workflowStepFields: '필드',
workflowStepNotSent: "실제로 보내지 않았습니다 — 실제 발송 확인은 발송 대상 화면의 '테스트 발송'을 이용하세요.",
workflowStepBindingMissing: '필드 값을 채울 폼이 완료되지 않아 보내지 않습니다.',
workflowStepRawPersonalData: '원문 전송됨',
workflowStepTargetDisabled: '이 대상은 사용 중지 상태입니다(실제로는 보내지지 않습니다).',
workflowStepTargetPaused: '이 대상은 일시 정지 상태입니다(실제로는 보내지지 않습니다).',
workflowStepSecretMissing: '이 대상은 비밀이 설정되지 않았습니다(실제로는 보내지지 않습니다).',
```

### 7.9 `MESSAGES.versions`(복원 경고, 확장)
```ts
restoreWarningWorkflowTargetMissing: (n: number) =>
  `대상 버전의 노드 ${n}개가 존재하지 않는 발송 대상을 참조합니다(복원 후 실행 시 발송이 건너뛰어집니다).`,
restoreWarningWorkflowTargetDisabled: (n: number) =>
  `대상 버전의 노드 ${n}개가 사용 중지된 발송 대상을 참조합니다(복원 후 실행 시 발송이 건너뛰어집니다).`,
```

### 7.10 `MESSAGES.chatbot`(영구삭제 확장)
```ts
permanentDeleteWorkflowPendingNotice: (n: number) => `대기 중인 업무 자동화 요청 ${n}건이 함께 취소됩니다.`,
```

### 7.11 `MESSAGES.dataGovernance.map`(확장 — 업무 자동화 웹훅 행)
```ts
egressWorkflowLabel: '업무 자동화 웹훅',
egressWorkflowTargetsHeader: (n: number) => `대상 ${n}개 — 아래 상세`,
riskRawPersonalDataWorkflowTargets: (n: number) => `원문 개인정보 전송 허용 업무 자동화 대상: ${n}개`,
```

---

## 8. `UIUX_준수기준.md` 체크리스트 매핑

### 8.1 공통(이 그룹 신규/확장 화면 전체)

| 기준 | 항목 | 적용 |
|---|---|---|
| §1 색상대비 | 색상 단독 금지 | §2.1의 모든 배지(`TargetEnabledBadge`·`TargetPausedBadge`·`SigningWeakBadge`·`ConsecutiveFailureBadge`·`WorkflowRunStatusBadge`·`WorkflowOutcomeBadge`)가 아이콘/텍스트 병기. `WorkflowOnlyOutputBadge`는 기존 `UnsupportedOutputBadge`(INFO)와 톤을 다르게(WARNING) 구분 |
| §3 키보드접근성 | Tab/Enter/Space, Esc+포커스복귀 | `WorkflowTargetPickerField`(콤보박스, `ResourcePickerField` 패턴 상속), `WorkflowFieldListEditor`(`ReorderableList` — 드래그 없음, 위/아래 버튼만), 확인 모달 전부 기본 포커스 "취소" |
| §4 버튼 | 동사형, 44×44px, 중복 실행 방지 | "발송 대상 추가"/"테스트 발송"/"필드 추가"/"재발송"/"취소", 저장·테스트·재발송·취소 버튼은 요청 중 `disabled`(연타 방지) |
| §5 텍스트입력필드 | 레이블 필수, 글자수 카운터, 복사·붙여넣기 제한 금지 | 이름(60자)·설명(300자)·동작 키(60자)·필드 이름(40자)·필드 상수값(500자) 등 전 필드 `<label htmlFor>` |
| §6 폼컨트롤 | 단일선택=라디오, 다중선택=체크박스, 슬라이더 수치 병행 | 인증 방식 4종 라디오, 사용 여부/서명 사용/원문 허용 체크박스, 연속 미응답 임계값은 `NumberInputField`(방향키 조작) — 슬라이더 미사용 |
| §7 오류메시지 | 원인+해결, 제출 시점 표시 | `EGRESS_HOST_NOT_ALLOWED`·`SECRET_MISSING`·`CONFIRM_NAME_MISMATCH` 등 전부 인라인 + 원인+해결(테스트 발송은 서버 `guidance` 그대로 표시, §13-5 확정 유지) |
| §8 로딩/상태 | 스켈레톤, 완료 배지, 비동기 대기, 실시간 폴링 | §6 상태 총정리 · WF1-b/WF3-b의 10초 폴링(스크롤·포커스 유지, `aria-live` 1회, 연속 실패 시 배너) · 재발송/취소는 `aria-live="polite"` |
| §9 내비게이션 | href 기반, 현재 탭 밑줄+형태 | `WorkflowAutomationShell`/`ChatbotWorkflowShell`의 탭은 기존 `tab-nav-link`/`active` 클래스 재사용 |

### 8.2 화면별 세부

| 화면 | 항목 | 적용 |
|---|---|---|
| WF1 대상 편집 모달 | §6 필수/선택 구분, 기본값 임의 선택 금지 | "사용 여부" 기본값은 서버가 내려주는 현재 값(신규는 true) — 임의 선택 아님. 인증 방식 기본은 `NONE`(중립값) |
| WF1 원문 허용 토글 | §1 민감정보 임시 열람 토글 원칙(승계) | 기본 꺼짐 + 켤 때 확인 재입력(No.26과 동일 — 이 그룹은 "열람 토글"이 아니라 "전송 허용 토글"이라 열람 만료 문구는 적용 대상이 아니다) |
| WF2 노드 아웃풋 | §4 대화형 설문과 유사한 "보이지 않는 아웃풋" 안내 | `WorkflowInvisibleOutputHint`가 스크린리더로 상시 읽힘(NFR-WFA4) |
| WF1-b/WF3-b 이력 | §3 정렬 가능한 표 헤더 `aria-sort` | 발생 시각 열은 기본 내림차순 고정(설계서 §12.2 — 정렬 변경 API 없음)이므로 `aria-sort` 규칙은 **적용 대상 아님**(정렬 불가 열이라 헤더가 버튼이 아니다) |
| WF1-c 요약 | §8 부분 정정 상태(근사치) | P95 지연 `approximated:true`일 때 "(근사)" 텍스트 + 툴팁(색상 단독 아님) |

---

## 9. 반응형 고려사항

- **데스크톱 우선, 모바일 폭 ≤768px는 표 → 카드 전환**(No.26/No.45 선례): WF1 발송 대상 목록·WF1-b/WF3-b 실행 이력·WF3 이벤트 구독 표는 각 행이 카드로 바뀌며 라벨-값 쌍을 세로로 나열한다(`AuditLogCard` 패턴 재사용).
- **버튼 터치 영역 44×44px**(UIUX §4): 케밥 메뉴·정지/재개·재발송/취소 버튼 전부 모바일에서 44×44px 이상을 보장한다.
- **노드 편집기(WF2)**: 관리자 콘솔은 데스크톱 사용을 기본 전제하나(기존 대화그래프 편집기 전체가 그렇다), 필드 표(`WorkflowFieldListEditor`)는 좁은 화면에서 "이름"과 "값 에디터"를 세로로 쌓는다(기존 `ApiQueryListEditor` 반응형 규칙 상속).
- **위젯(`apps/widget`) 변경 0건** — 이 그룹은 사용자 화면에 어떤 반응형 요구도 추가하지 않는다(FR-WF10-3).
- **시뮬레이터 `WorkflowStepPanel`**: 기존 `ApiStepPanel`과 같은 접이식 폭 규칙(모바일에서는 결과 패널 전체가 세로 스택).

---

## 10. Out of scope / 재검토 트리거

설계서 §26·ADR-0041 "재검토 트리거"를 그대로 따른다 — 이 화면 설계에서 **의도적으로 만들지 않은 것**:

| 항목 | 이유 |
|---|---|
| 결과를 대화에 표시하는 UI | 서버 대화 세션·No.35 선제 메시징 필요(2차) — 위젯 변경 0 유지 |
| 인바운드 콜백 결과를 실행 이력에 반영하는 화면 요소 | `@Public()` 콜백 자체가 2차 |
| 도구별 프리셋(Teams 카드·Jira 필드 형식) 선택 UI | 받는 쪽 변환으로 1차 충분 |
| 실행 이력 CSV 내보내기 버튼 | 1차 콘솔 조회로 충분(FR-WF7-8) |
| 시도별 이력 테이블(펼침 안의 "시도 1/2/3…" 행) | `WorkflowAttempt` 미도입 — 마지막 시도 정보만 표시 |
| 대상의 챗봇별 가시성 필터(멀티테넌시) | 대상이 전역이라 모든 ADMIN이 전체 목록을 본다 — 그룹 분리는 2차 |
| 챗봇 목록·대시보드의 "확인 필요" 배지 | K-8·R-14 — 업무 자동화 메뉴·챗봇 탭 배지로 대체 |
| `AttentionCountBadge` 범용화 리팩터링 | §13-3 확정 — 범위 밖(경량 배지 안 유지) |

---

## 11. 다음 단계 인계 (`frontend-implementer`)

1. **재사용 우선**: `SecretStatusBadge`·`RawPersonalDataBadge`·`BindingValueEditor`·`ReorderableList`·`ResourcePickerField`·`ConfirmDialog`·`DateRangeField`·`Pagination`·`EmptyState`/`ErrorState`/`SkeletonRow`·`InlineFieldError`·`CopyButton`·`PurgedFieldNotice`·`EnvironmentScopeNotice`는 **새로 만들지 않는다** — import해서 그대로 쓴다.
2. **신규 컴포넌트 목록**(§2): `WorkflowTargetPickerField`·`WorkflowFieldListEditor`·`WorkflowTargetTestPanel`·`WorkflowStepPanel`·`WorkflowAutomationShell`·`ChatbotWorkflowShell`·배지 6종(§2.1)·`WorkflowAttentionNavBadge`.
3. **라우트 등록**: `App.tsx`에 `/settings/workflow-automation`(+3 서브) · `/chatbots/:chatbotId/workflow-automation`(+2 서브) 추가(§13-1 확정 — 최상위 탭). `dialogue` 서브라우트·`OUTPUT_TYPES`는 손대지 않고 `DialogOutputEditor.tsx` 1파일만 확장. `TabNav.tsx`의 "라우트 6개" 옛 주석은 이 참에 갱신하거나 삭제할 것을 권고한다.
4. **컴파일 강제 지점**: `DialogOutputType`(12→13) 유니온 확장 시 `Record<DialogOutputType, …>` 형태의 기존 맵(`MESSAGES.dialogue.outputTypes` 등)에 `WORKFLOW` 키를 빠뜨리면 TS가 잡는다 — 이 성질을 이용해 라벨 누락을 방지한다(No.26·No.41 공통 관례).
5. **성능**: WF1-b/WF3-b의 10초 폴링은 상태가 `PENDING`·`SENDING`·`HELD`인 행이 1건이라도 있을 때만 켠다(전부 종단 상태면 폴링 중지) — 불필요한 서버 부하 방지.
6. **`workflow-automation-patches.md` 확인**: backend-implementer가 만든 기존 파일 수정 목록(설계서 §2.5)과 이 문서의 화면 목록을 대조해 신규 API 클라이언트(`api/workflowTargets.ts`·`api/workflowSubscriptions.ts`·`api/workflowRuns.ts`)를 만들 것. **`WorkflowStatusReason.DECRYPT_FAILED`(§13-2 확정)가 설계서·shared-types에 반영됐는지 먼저 확인**한다 — 반영 전에는 §3.2.1 `detailDecryptFailed` 분기를 구현하지 않는다(반영 전까지는 이전 초안대로 `lastOutcome=null` 추론으로 임시 대응 가능).
7. **챗봇 스코프 이력 대상 필터(§13-4 확정)**: `GET /chatbots/:chatbotId/workflow-runs`가 `targetId` 쿼리를 지원하는지 API 계약을 backend-implementer와 대조한 뒤 §3.2b `WorkflowRunFilterBar`를 구현할 것.

---

## 12. 설계서와 다르게 판단했거나 설계서에 없어 가정한 사항 (ui-designer 판단 기록)

① **TabNav "라우트 6개" 주석과의 불일치 — 확정(2026-09-26 PM·오케스트레이터)**: `TabNav.tsx` 12행 주석("라우트는 6개 그대로 두되")은 No.28(예약 배포)·No.40(환경) 탭이 추가되기 이전에 쓰인 것으로 보이며, 현재 코드는 이미 12개 최상위 라우트를 갖고 있다. `legacy-api-integration-ui-spec.md`는 이 주석을 근거로 새 최상위 탭을 만들지 않았으나(외부 연동 로그를 `StatsShell` 서브탭으로), 이후 그룹(No.40)은 실제로 최상위 탭을 늘렸다. 이 문서는 **이미 늘어난 선례(환경 탭)를 따라 "업무 자동화"를 13번째 최상위 탭으로 추가**하기로 판단했고, **PM·오케스트레이터가 이 판단을 최종 확정**했다(§13-1). `frontend-implementer`가 이 주석을 갱신하거나 삭제할 것을 권고한다.

② **데이터 지도(WF8) `EgressTable` 확장 방식**: `data-governance-설계.md`는 `WORKFLOW_WEBHOOK` 출구 등록만 규정하고, 콘솔 표의 렌더 방식(레거시 연결처럼 대상별 하위 목록을 펼치는 형태)을 명시하지 않았다. 기존 표가 이미 "레거시 연결(N) — 아래 상세" 패턴을 갖고 있으므로 같은 방식을 그대로 확장하는 것으로 판단했다(§3.10).

③ **실행 이력의 "복호화 실패" 표시 — 확정(2026-09-26 PM·오케스트레이터)**: 설계서 §10.1은 봉투 복호화 실패 시 "송신하지 않고 `FAILED(PERMANENT_ERROR)` + `lastOutcome=null` + 경고 로그(행 id·키 id만)"로 종결한다고만 규정해, 최초 초안은 API 응답에 전용 코드가 없다는 이유로 `status=FAILED ∧ lastOutcome=null`을 근거로 문구를 추론했다. **오케스트레이터·PM이 `WorkflowStatusReason`에 전용 값 `DECRYPT_FAILED`를 신설하기로 확정**했으므로, 이 문서는 추론 방식을 폐기하고 그 코드를 직접 참조하도록 §3.2.1·§7.6을 갱신했다. backend-implementer가 착수 시 설계서(`workflow-automation-설계.md` §4.2 enum·§10.1 발행 지점·§12.4 오류 코드/응답 매핑)에도 이 값을 반영해야 한다.

④ **`SystemSettingsMenu` 배지 방식 — 확정(2026-09-26 PM·오케스트레이터)**: 기존 `AttentionCountBadge`는 `MESSAGES.deploySchedules` 문구에 결합돼 있어 그대로 재사용할 수 없다고 판단해, 메뉴 항목에는 숫자 배지 대신 점(●) 표시만 붙이는 경량 배지를 신설했다(§3.12). **오케스트레이터가 배지 범용화 리팩터링은 이 그룹 범위 밖이라고 확정**했으므로, 이 경량 배지 안을 최종안으로 유지한다(§13-3).

⑤ **정렬 불가 열의 `aria-sort` 미적용**: `UIUX_준수기준.md` §3의 "정렬 가능한 표 헤더는 `<button>` + `aria-sort`" 규칙은 서버가 정렬 파라미터를 지원하는 표에만 적용된다고 판단했다. 실행 이력·대상 목록은 설계서상 정렬 API가 없어(고정 `createdAt desc` 또는 `updatedAt desc`) 이 규칙의 적용 대상이 아니라고 보았다.

⑥ **챗봇 영구삭제 확인(WF9) 조회 실패 시 처리**: 설계서는 실패 시 동작을 규정하지 않는다. 이 문서는 "조회가 실패해도 삭제 자체를 막지 않는다"(안내 줄만 생략)로 판단했다 — 삭제는 챗봇 데이터 정합성 문제이지 업무 자동화 조회 가용성 문제가 아니기 때문이다.

⑦ **챗봇 범위 실행 이력의 "대상" 필터 — 확정(2026-09-26 PM·오케스트레이터)**: 최초 초안은 챗봇 스코프라 대상 필터를 빼고 트리거·이벤트 필터로만 좁히게 했으나(§3.2b), 백엔드가 `GET /chatbots/:chatbotId/workflow-runs`에 `targetId` 쿼리를 지원하기로 확정하면서 §3.2 전역 화면과 동일한 `WorkflowRunFilterBar`(대상 필터 포함)를 그대로 재사용하도록 갱신했다(§13-4).

---

## 13. 사용자 확인이 필요한 UX 선택 — **확정(2026-09-26)**

PM·오케스트레이터가 아래 5건을 전부 확정했다(2026-09-26). 이 절은 §12에서 기록한 ui-designer의 판단·제안을 최종 결정으로 닫는다. 코드는 이 확정에 따라 후속 단계(backend-implementer·frontend-implementer)에서 반영한다.

1. **TabNav 13번째 최상위 탭 추가 — 확정**(§12-①). "업무 자동화"는 No.26 선례(외부 연동 로그를 `StatsShell` 서브탭으로 흡수)를 따르지 않고, §1(WF3)·§3.13(WF11)대로 **최상위 탭 13번째**로 추가한다. `TabNav.tsx`의 "라우트 6개" 옛 주석은 갱신 대상이다(§11-3 인계).
2. **`WorkflowStatusReason.DECRYPT_FAILED` 신설 — 확정**(§12-③). 백엔드가 이 값을 `WorkflowStatusReason`(FAILED 계열 사유)에 추가한다 — 설계서 §4.2(enum 정의)·§10.1(발행 지점: 봉투 복호화 실패로 송신 자체를 하지 못한 경우)·§12.4(응답 매핑)에 반영이 필요하다(backend-implementer/system-architect 후속 작업). 이 문서는 §3.2.1·§7.6(`detailDecryptFailed` 키)을 이 코드 기준으로 갱신했고, 구 `lastOutcome=null` 추론 방식(구 `detailUnknownFailure`)은 폐기했다.
3. **배지 경량화 유지 — 확정**(§12-④). `AttentionCountBadge`를 범용 컴포넌트로 리팩터링해 예약 배포·업무 자동화가 함께 쓰게 하는 안은 **범위 밖**이다. §3.12의 점(●) + `aria-label` 경량 배지 안을 최종안으로 유지한다.
4. **챗봇 범위 실행 이력에 "대상" 필터 추가 — 확정**(§12-⑦). 백엔드가 `GET /chatbots/:chatbotId/workflow-runs`에 `targetId` 쿼리를 지원하기로 확정했으므로, §3.2b는 §3.2의 `WorkflowRunFilterBar`(대상 필터 포함)를 그대로 재사용한다 — 한 챗봇이 여러 대상을 구독/참조하는 경우 대상별로 좁혀 볼 수 있다.
5. **테스트 발송 결과 안내 원칙 — 확정**. 서버 `guidance` 문자열을 그대로 표시하는 원칙(No.26과 동일, §3.1.3)을 유지한다. 클라이언트는 결과 코드별 문구를 별도로 하드코딩하지 않는다.
