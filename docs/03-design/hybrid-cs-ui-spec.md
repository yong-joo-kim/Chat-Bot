# 하이브리드 CS (No.24) — 화면 설계서

> **대상 기능**: No.24 하이브리드 CS — 관리자가 **진행 중인 대화를 실시간으로 모니터링**하고, 연속 미응답 세션에 **색상+텍스트+아이콘 경고**를 받고, **상담원이 주도적으로 개입**(봇 일시정지 → 상담원 대화 → 종료·봇 복귀)하며, **응답힌트**(가까운 FAQ/의도 답변 + 자주 쓰는 문장)를 참고해 답하고, **상담 이력**을 조회한다. 사용자 메시지 **원문은 상담 중에만**(P-9) 담당자·ADMIN에게 한정 노출되고 종료 시 파기된다.
> **입력 문서**: `docs/requirements/hybrid-cs.md`(J-1~J-20, FR-0-118~128, FR-CS1~CS11, NFR-CSP/CSS/CSA/CSM, AC-CS1~CS8, EX-CS-1~33, PM 결정 P-1~P-18 §1.7·§11), `docs/02-spec/hybrid-cs-설계.md`(§2 모듈 배치, §3 데이터 모델, §5 게이트 판정표, §6 상담 토큰, §9 원문 보관·파기·열람, §10~§13 모니터링·대화보기·힌트·이력, §14 위젯, §15 권한, §16 감사, §17 API 계약, §21 콘솔 인계), `docs/02-spec/decisions/ADR-0036-hybrid-cs-handoff-thread-short-polling-and-transient-raw-text.md`
> **준수 기준**: `docs/03-design/UIUX_준수기준.md`(전 항목 — 이번 작업에서 §1·§8에 각 1개 항목을 최소 보강했다, §11 참고)
> **선례 참고**: `docs/03-design/survey-management-ui-spec.md`(최신 문서 형식 — 화면목록 표·공통 배지·PATCH 계열 필드-오류 매핑·messages.ts 신규 네임스페이스 나열 방식을 그대로 계승), `docs/03-design/quality-channel-ui-spec.md`(§5 `apps/widget` 설계 형식 — DOM 마크업·상태 전이 다이어그램·이벤트 흐름 표·접근성 매핑을 그대로 계승, §2.3 `TabNav` 그룹핑), `docs/03-design/security-audit-ui-spec.md`(§3.6 `TopBar`/`SystemSettingsMenu` 전역 메뉴 패턴, §3.7 `U1` 역할 선택·배지 패턴, §4 권한별 UI 원칙)
> **실제 코드 확인**: `apps/web/src/App.tsx`(라우트 트리 — `ChatbotDetailLayout` 하위 6개 탭 + `/settings/*` 전역 라우트 구조), `apps/web/src/pages/chatbot-detail/TabNav.tsx`(최상위 탭 4그룹·6라우트 고정, `AC-C-3` — 이 그룹은 라우트를 늘리지 않는다), `apps/web/src/components/TopBar.tsx`(전역 내비 — "챗봇 목록" 링크 옆에 "모니터링" 링크를 추가), `apps/web/src/components/security/SystemSettingsMenu.tsx`(권한 필터링 드롭다운 패턴 — "시스템 설정"과 달리 "모니터링"은 별도 1급 링크로 둔다, §0.3 근거), `apps/web/src/pages/dialogue/DialogueShell.tsx`(서브내비 6번째 "설문" 다음 7번째로 "자주 쓰는 문장" 추가), `apps/web/src/pages/chatbot-detail/AnswerSettingsTab.tsx` + `answer-settings/AnswerSettingsPage.tsx`(`<section className="answer-settings-section">` 2개 — 3번째 섹션으로 "상담 연계" 추가), `apps/web/src/constants/messages.ts`, `apps/widget/src/core/store.ts`(상태 7종·메시지 역할 4종 — `agent` 역할 추가), `apps/widget/src/ui/message-list.ts`(`wrapMessage(role)`·`bubble()` — `agent` 역할 추가는 기존 패턴 그대로 확장), `apps/widget/src/constants/messages.ts`(위젯 전용 문구 1곳)
> **작성**: ui-designer · 2026-09-25 · **다음 단계**: `backend-implementer`(§2.5 체크리스트) → `frontend-implementer` → `code-reviewer` → `test-automation`
> **범위 경계**: 실제 React/TS 컴포넌트 코드는 작성하지 않는다. 여기서 정의한 화면/컴포넌트/상태/문구는 `frontend-implementer`가 구현 기준으로 삼는다.

---

## 0. 전제와 연계 확인

1. **PM 결정 P-1~P-18은 전부 확정**되었다(요구사항 §1.7·§11). P-9(원문)만 권고안과 다르게 "상담 중에만 원문 표시"로 결정되었고 세부는 설계서 §9·ADR-0036 §6이 정한다. 이 문서는 그 결정을 화면으로 구체화할 뿐 재론하지 않는다. 핵심만 다시 적는다.
   - 전달은 **상담 전용 짧은 폴링**(상담 중 3초·관찰 창 5초×3분)이며, 개입이 전달되지 않는 세션(관찰 창 밖)은 **다음 사용자 발화**로만 전달된다(지연 고지가 화면에 필요 — J-2).
   - 콘솔은 **폴링**으로 갱신한다: 진행 중 목록 5초·열린 대화 2초·숨김 탭 30초(J-3).
   - 전체 `sessionId`는 **어디에도 노출하지 않는다** — `sessionRef`(해시 16자)의 앞 6자를 별칭으로 쓴다(J-5, P-5).
   - **역할 `AGENT`(상담원) 신설**, 권한 `cs:read`/`cs:write`(J-7, P-7).
   - 세션당 활성 상담 1건·담당 1명, **강제 인수는 ADMIN만**(J-8, P-8).
   - **★ 원문은 상담 중에만**(담당자·ADMIN·`원문 보기` 토글을 켰을 때만), 영구 저장·이력·힌트·목록은 전부 마스킹본. 토글 기본값은 **꺼짐**이며, 켜면 (상담, 열람자)당 1건 `RAW_VIEW` 감사가 남고 그 사실을 켜기 전에 고지한다(P-9, §3.3).
   - 응답힌트는 **의미 매칭 상위 3 + 자주 쓰는 문장 상위 3**이며 임베딩이 꺼져 있으면 문자 유사도로 저하한다("간이 추천" 배지, J-10, P-10).
   - 자주 쓰는 문장은 **챗봇별 공용**(`dialogue:write` 관리, 챗봇당 200개, J-11, P-11).
   - 종료 사유는 상담원 종료·**양쪽 모두 10분 침묵**(`USER_IDLE`, 라벨 "응답 없음으로 종료")·상담원 무응답 5분·미전달·채널 닫힘이며 **배치·타이머 문구를 화면에 쓰지 않는다**(조회 시점 판정 — J-15, P-14).
   - 이력 요약은 건수·평균 첫 응답 시간·평균 상담 시간까지이며 **상담원별 비교는 없다**(J-18, P-15).
2. **메뉴 배치(AC-C-3 충돌 회피)** — 카탈로그 근거(요구사항 §1.6 근거 3, ROCHA 콘솔 좌측 내비게이션에 `모니터링`이 `대시보드`·`통계/분석`과 별개의 독립 메뉴로 존재)와 이 프로젝트의 제약(`TabNav.tsx` 최상위 라우트 6개 고정, `AC-C-3`)을 함께 만족시켜야 한다. **이 문서는 "전역 메뉴"를 택한다** — `모니터링`은 `ChatbotDetailLayout`(챗봇 상세, `TabNav` 소속) 밖의 **새 최상위 라우트 트리**(`/handoff-console/*`, `/settings/*`와 같은 급)로 두고, `TopBar`에 "챗봇 목록" 옆 1급 링크로 노출한다(§3.9). `TabNav`의 6개 라우트는 **손대지 않는다**. "시스템 설정" 드롭다운(`SystemSettingsMenu`)에 넣지 않은 이유는 그 메뉴의 항목이 전부 `ADMIN` 전용 환경설정 성격인 데 비해 모니터링은 `AGENT`의 **주 업무 화면**이라 드롭다운에 숨기면 안 된다는 점, 그리고 그 메뉴는 "항목이 하나도 없으면 트리거 자체를 숨긴다"는 규칙이 있어 `AGENT`가 그 메뉴만 보고 진입로를 찾기 어렵다는 점이다(§0.3).
3. **콘솔은 챗봇 상세(`ChatbotDetailLayout`) 밖에 있다** — 상담원은 여러 챗봇을 오가며 모니터링하므로(챗봇별 배정 없음, J-1) 콘솔 자체에 **챗봇 선택기**(HC0)를 두고, 그 하위에 `:chatbotId`를 문자열로 포함하는 라우트를 둔다. `/settings/deploy-schedules`(전역, No.28)와 같은 급의 독립 트리다.
4. **자주 쓰는 문장**(`CannedResponse`)은 "대화 자산 성격"(`dialogue:write` 관리)이라 `DialogueShell` 서브내비에 7번째 항목으로 얹는다 — No.27이 6번째 "설문"을 얹은 것과 같은 원칙(신규 최상위 라우트 0개).
5. **상담 연계 설정**(`ChatbotHandoffSetting`)은 `chatbot:read`/`chatbot:write` 권한이며 공개 대화가 매 턴 읽는 캐시와 동거하는 자산이라(설계서 §26 D-1), 화면도 같은 권한 도메인의 `AnswerSettingsTab`(`/chatbots/:chatbotId/answer-settings`)에 **3번째 섹션**으로 둔다 — 새 탭·새 라우트 0개.
6. **`sessionId → sessionRef` 별칭 원칙**: 이 문서의 모든 화면·URL·로그·스크린샷 예시에서 전체 UUID는 절대 등장하지 않는다. `#a3f9c1` 같은 해시 앞 6자만 쓴다(NFR-CSS3).
7. **조사 한계 승계**: `docs/00-source/ROCHA_매뉴얼_23.07.07.pdf` p.66~70(모니터링 화면)을 이 세션에서도 직접 확인하지 못했다(`pdftoppm` 미설치 — 요구사항 문서 16행과 동일한 제약, 재시도 결과 동일 오류). 색상 단계 배색(빨강/노랑 조합의 정확한 톤)·힌트 표시의 정확한 화면 위치·자주 쓰는 문장의 원본 소유 단위는 원본을 인용하지 못했다. 이 설계는 요구사항·설계서의 필드 목록 + 선행 화면 관용구(경고 배지 3중 표시, 마스터-디테일 목록)만으로 구성했다.
8. **위젯 변경은 필수다**(No.26/27과 달리 위젯 변경 0건이 불가능 — J-13). `apps/widget`은 §4에서 별도 체계(DOM 마크업·상태 전이)로 기술한다(`quality-channel-ui-spec.md` §5와 같은 형식).

---

## 1. 화면 목록 및 라우트

| ID | 화면명 | 라우트 | 성격 | 진입 경로 | 필요 권한 |
|---|---|---|---|---|---|
| HC0 | **상담 콘솔 진입 — 챗봇 선택기** | `/handoff-console` | 페이지 | `TopBar` "모니터링" 링크 | `cs:read` |
| HC1 | **진행 중 세션 목록** | `/handoff-console/:chatbotId/live` | 페이지 | HC0 챗봇 카드 클릭(기본 진입) | `cs:read` |
| HC2 | **대화 보기 · 개입**(+응답힌트 패널) | `/handoff-console/:chatbotId/live/:sessionRef` | 페이지(마스터-디테일, HC1 옆에 상세 패널) | HC1 행 클릭 | 보기 `cs:read` / 개입·전송·종료 `cs:write` / 강제 인수 `cs:write`+ADMIN |
| HC3 | **상담 이력 · 요약** | `/handoff-console/:chatbotId/history` | 페이지 | HC1 상단 탭 "상담 이력" | `cs:read` |
| HC4 | **상담 이력 상세** | `/handoff-console/:chatbotId/history/:handoffId` | 페이지 | HC3 행 클릭 | `cs:read` |
| CR1 | **자주 쓰는 문장 관리** | `/chatbots/:chatbotId/dialogue/canned-responses` | 페이지(`DialogueShell` 서브내비 7번째) | `DialogueShell` 서브내비 "자주 쓰는 문장" | 조회 `dialogue:read` / 쓰기 `dialogue:write` |
| HS1 | **상담 연계 설정**(섹션) | `/chatbots/:chatbotId/answer-settings`(기존 라우트, 신규 섹션) | 페이지 내 섹션 | `AnswerSettingsTab` 3번째 섹션 | 조회 `chatbot:read` / 저장 `chatbot:write` |
| U1-ext | **회원 관리 — 역할 `상담원` 추가** | `/settings/users`(기존 라우트) | 기존 화면 확장 | 기존과 동일 | `user:read`/`user:write` |
| N1-ext | **`TopBar` — "모니터링" 진입점** | 전역 | 기존 컴포넌트 확장 | — | `cs:read`(노출 조건) |
| W-HC | **위젯 상담 모드**(연결 안내·상담원 말풍선·종료 안내) | `apps/widget` 임베드 전체(W1/W2 공통) | 기존 위젯의 상태 확장 | 미응답 이후 자동(관찰 창) 또는 다음 발화 | 없음(공개, 토큰) |

**신규 최상위 라우트는 `/handoff-console/*` 1개 트리다.** `TabNav.tsx`의 6개 고정 라우트(`AC-C-3`)와 `DialogueShell`의 서브내비 구조는 늘어나되(6→7, No.27 선례와 동일 패턴) 바뀌지 않는다. `AnswerSettingsTab`·`/settings/users`는 기존 라우트 그대로다.

---

## 2. 공통 UI 요소(신규)

### 2.1 배지류 (색상 + 텍스트 + 아이콘 3중 표시, UIUX §1 · NFR-CSA1)

| 컴포넌트 | 용도 | 규칙 |
|---|---|---|
| `AlertLevelBadge` | 진행 중 목록(HC1) 행, HC2 헤더 | `정상`(회색, 아이콘 없음) / `주의 · 연속 N`(노랑 배경 + ▲ 아이콘 + 텍스트) / `경고 · 연속 N`(빨강 배경 + ⛔ 아이콘 + 텍스트) — `evaluateSessionAlert()` 결과를 그대로 표시, 클라이언트 재계산 0(NFR-CSM1) |
| `HandoffStateBadge` | HC1 행 "상담" 열, HC2 헤더 | `없음`(표시 안 함) / `연결 중…`(파랑, 담당자 이름) / `상담 중 · {담당자명}`(초록) / `상담 중 · 나`(초록, 본인 강조) / `구버전 위젯`(회색 — `clientMode='LEGACY'`, EX-CS-26) |
| `UnverifiedAttemptBadge` | HC2 헤더 | `unverifiedAttemptCount > 0`일 때만: "확인되지 않은 연결 시도 {n}회"(주황 `INFO` 톤) — 선점 의심 신호(§1.4.2) |
| `RawViewBadge` | HC2 대화 항목 | 원문이 함께 표시된 항목에만: "원문"(파랑 텍스트 배지) — 마스킹본 옆에 병기, 색상 단독 아님 |
| `LexicalFallbackBadge` | HC2 힌트 패널 | "간이 추천"(회색 `INFO` 톤) — `mode: 'LEXICAL'`일 때(의미 매칭 불가, AC-CS5-2) |
| `LowSampleBadge` | HC3 이력 요약 카드 | "표본 {n}건"(회색) — 항상 표본 수 병기(No.27 `SurveyLowSampleBadge`와 같은 원칙) |
| `EndReasonBadge` | HC1/HC3/HC4 | `HANDOFF_END_REASON_LABELS`(shared-types) 그대로 표시 — 문자열 재정의 금지(F-3 원칙 상속) |
| `RoleBadge`(확장) | `TopBar`·U1 | 기존 3색(ADMIN 보라/EDITOR 파랑/VIEWER 회색) + **`AGENT` "상담원"(청록, 헤드셋 아이콘)** 4번째 — `ROLE_LABELS.AGENT` 값 그대로(F-3) |

### 2.2 콘솔 전용 컴포넌트

| 컴포넌트 | props | 규칙 |
|---|---|---|
| `LiveSessionTable` | `items: LiveSessionRow[]`, `loading`, `myUserId` | 5초 폴링(§3.2) — 갱신 시 **스크롤·포커스·정렬 상태를 유지**한다(UIUX §8 신규 보강, §11). 새 경고 발생만 `aria-live="polite"` 1회(NFR-CSA2) |
| `SessionSummaryBar` | `{ live, warning, caution, handoffActive }` | 상단 요약 카운터 4개 — 숫자만이 아니라 각 카운터 앞에 `AlertLevelBadge`와 같은 아이콘을 병기 |
| `TranscriptPanel` | `sessionRef`, `handoffId?`, `entries`, `rawVisible`, `blockedDuringHandoff` | 2초 폴링(§3.3) — 봇 구간(`ConversationLog`)과 상담 구간(`HandoffMessage`)을 시각순으로 병합 렌더. 새 사용자 발화만 `aria-live="polite"` 1회 |
| `TranscriptEntry` | `entry: TranscriptEntrySchema` | 봇 구간: 사용자 발화 + 봇 응답(답한 노드/FAQ/RAG 배지 또는 "답변 못함" 배지) · 상담 구간: 발신자별 정렬(사용자 좌측, 상담원/시스템 우측 또는 색 구분 + 텍스트 라벨) |
| `RawTextToggle` | `enabled`, `visible`(담당자·ADMIN·`CONNECTED`일 때만 렌더), `onToggle` | §3.3 상세. 기본 꺼짐, 켜기 직전 고지 팝오버, 세션 종료·만료 시 서버 응답 `rawVisible:false`를 받으면 **즉시 꺼짐 + 캐시된 원문 삭제**(EX-CS-29) |
| `AlertLevelIcon` | `level` | ▲(주의)/⛔(경고) — 순수 SVG/텍스트 아이콘, 색상 없이도 형태로 구분 가능해야 함(UIUX §1) |
| `InterveneButton` | `sessionRef`, `disabledReason?` | 활성 상담이 있으면 `disabled` + 사유("{담당자명}님이 상담 중입니다") 병기(NFR-CSA6) |
| `HandoffActionBar` | `handoff`, `isAssignee`, `isAdmin` | 개입 후 헤더 고정 영역: `[전송]`(입력창 옆) `[상담 종료]` `[강제 인수]`(ADMIN만, 비담당자에게도 노출되되 `cs:write`+ADMIN만 활성) |
| `AgentMessageComposer` | `handoffId`, `disabled`, `disabledReason?` | 입력창 + **전송 전 마스킹 미리보기**(디바운스 300ms, §3.3) + "전송" 버튼 |
| `InterveneConfirmDialog` | — | "이 대화를 맡습니다. 챗봇 응답이 멈춥니다." 확인/취소(포커스 트랩) |
| `EndHandoffConfirmDialog` | — | "상담을 종료할까요? 사용자에게 종료 안내가 전달됩니다." 확인/취소 |
| `TakeoverDialog` | `handoff` | 사유 입력(1~200자, 필수) + "강제로 상담을 인수합니다." 경고 톤 확인 |
| `HintPanel` | `sessionRef`, `handoffId?`, `canFillComposer` | §3.3 상세 — `가까운 답변` 3 + `자주 쓰는 문장` 3, 검색 |
| `HintAnswerCard` / `HintCannedCard` | `item`, `onCopy`, `onFill` | 각 항목 `[복사]` `[입력창에 넣기]` — `onFill`은 `canFillComposer=false`면 `disabled` + 사유("개입 후 사용할 수 있어요") |
| `SessionRefLabel` | `sessionRef` | `#{앞6자}` 형식으로만 렌더 — 이 컴포넌트를 거치지 않고 원본 문자열을 직접 출력하는 코드를 만들지 않는다(정적 검사 대상, §12) |

### 2.3 자주 쓰는 문장 · 설정 전용 컴포넌트

| 컴포넌트 | props | 규칙 |
|---|---|---|
| `CannedResponseList` | `items`, `loading` | `ReorderableList` 재사용(위/아래 버튼, No.27 `SurveyChoiceListEditor`와 동일 패턴) |
| `CannedResponseForm` | `value`, `onSave` | 제목(1~50, 유일)·본문(1~1,000)·분류(≤30)·단축어(≤20, 유일, `[A-Za-z0-9가-힣_-]`) |
| `HandoffSettingsSection` | `chatbotId`, `value`, `isArchived` | §3.7 상세 — `AnswerSettingsPage`의 `answer-settings-section` 패턴 재사용 |
| `EndButtonNodePicker` | `chatbotId`, `value`, `onChange` | `ResourcePickerField`(`resourceType='node'`) 재사용, 라벨 필드와 쌍 |
| `ThresholdNumberField` | `label`, `value`, `min`, `max` | 순수 숫자 입력(슬라이더 아님 — 정밀 정수 입력이라 UIUX §6 슬라이더 규칙 대상이 아니다) |

---

## 3. 화면별 설계

## 3.1 HC0 — 상담 콘솔 진입 · 챗봇 선택기 (`/handoff-console`)

### 목적
상담원이 자신이 볼 수 있는 챗봇 중 상담 연계가 켜진 챗봇을 고른다. "내 상담 n건"으로 자신이 담당 중인 상담 수를 한눈에 본다.

### 상태별 UI

| 상태 | UI |
|---|---|
| 로딩 | `SkeletonRow` × 3(카드 스켈레톤) |
| 성공 | 카드 그리드, 상담 연계가 켜진 챗봇을 앞쪽에 배치(FR-CS2-8) |
| **빈 상태**(`cs:read`로 볼 수 있는 챗봇 0건) | `EmptyState`: "모니터링할 수 있는 챗봇이 없습니다." |
| 오류 | `ErrorState` + 다시 시도 |

### 레이아웃

```
┌───────────────────────────────────────────────────────────────────────────┐
│ 모니터링                                              내 상담 2건          │
├───────────────────────────────────────────────────────────────────────────┤
│ ┌ 쇼핑몰 도우미 ──────┐ ┌ 사내 IT 헬프데스크 ──┐ ┌ 뉴스레터 챗봇(연계 꺼짐)┐│
│ │ 진행 중 14 · 경고 1 │ │ 진행 중 2 · 경고 0   │ │ 이 챗봇은 상담 연계가   ││
│ │ 상담 중 3           │ │ 상담 중 0            │ │ 꺼져 있습니다           ││
│ │        [열기 →]     │ │        [열기 →]      │ │  (카드 흐림, 클릭 불가) ││
│ └─────────────────────┘ └──────────────────────┘ └─────────────────────┘│
└───────────────────────────────────────────────────────────────────────────┘
```

### 컴포넌트 분해

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `HandoffChatbotPicker` | `GET /handoff-console/chatbots` → `{ items: HandoffConsoleChatbotItem[], myActiveCount }` |
| `HandoffChatbotCard` | `{ chatbotId, name, handoffEnabled, activeHandoffCount }` — `handoffEnabled=false`면 카드가 흐림 처리 + 클릭 비활성 + 사유 텍스트(NFR-CSA6) |

---

## 3.2 HC1 — 진행 중 세션 목록 (`/handoff-console/:chatbotId/live`)

### 목적
상담원이 챗봇 하나의 **최근 10분(설정 가능) 활동 세션**을 색상+텍스트+아이콘 경고와 함께 보고, 개입할 세션을 고른다.

### 상태별 UI

| 상태 | UI |
|---|---|
| 로딩(최초) | `SkeletonRow` × 5 |
| 성공(세션 있음) | 표 + 상단 `SessionSummaryBar` |
| **빈 상태**(활성 창 안에 세션 0건) | `EmptyState`: "최근 10분 안에 활동한 대화가 없습니다." |
| 상담 연계 꺼짐(챗봇 진입 직후 상태가 바뀐 경우) | 배너: "이 챗봇은 상담 연계가 꺼져 있습니다. 진행 중이던 상담은 끝날 때까지 표시됩니다." + 목록은 계속 표시(FR-CS1-4) |
| **폴링 실패**(1회) | 조용히 다음 주기 재시도(토스트 없음) |
| **폴링 30초 연속 실패** | 상단 고정 배너: "연결이 원활하지 않습니다."(재시도 버튼 없음 — 다음 주기 자동 재시도, FR-CS2-7) |
| 오류(최초 로딩 실패) | `ErrorState` + 다시 시도 |

### 레이아웃 (데스크톱)

```
┌───────────────────────────────────────────────────────────────────────────┐
│ 모니터링 > 쇼핑몰 도우미                      [진행 중 세션] [상담 이력]    │
├───────────────────────────────────────────────────────────────────────────┤
│ 진행 중 14  ⛔경고 1  ▲주의 2  상담 중 3            🔔 새 경고 세션 1건    │ ← aria-live 1회
├───────────────────────────────────────────────────────────────────────────┤
│ 경고단계 ☑전체 ☐경고 ☐주의   상담상태 ☑전체 ☐상담중   채널 ☑WEB           │
├───────────────────────────────────────────────────────────────────────────┤
│ 상태          별칭      마지막 발화                마지막활동 미응답 담당  │
│ ⛔경고·연속3   #a3f9c1   환불 계좌를 바꾸고 싶어요     20초 전   4/7    —  │
│ ▲주의·연속2   #7d21ee   배송은 언제 오나요            1분 전    2/5    —  │
│ 상담중·김상담 #b910aa    네, 알겠습니다               방금      0/9  김상담│
│ 정상          #f001cc    감사합니다                   3분 전    0/3    —  │
│                                                              ◀ 1 ▶ 총14건 │
└───────────────────────────────────────────────────────────────────────────┘
```

- 표는 `<table>` + 헤더(UIUX §3), 정렬 기본값 = 경고 단계 내림차순 → 마지막 활동 최신순(FR-CS2-5). 행 클릭 → HC2로 이동(마스터-디테일 전환, 목록은 좁아지며 유지).
- "미응답" 열은 "연속/창내누적" 형식(예: "4/7" = 연속 미응답 4·창 안 누적 7턴). 마지막 미응답 사유가 `API_NOTICE`면 그 사유("연동 실패")를 행 보조 텍스트로 병기.
- "구버전 위젯" 세션은 별칭 옆에 `HandoffStateBadge` 회색 배지.

### 컴포넌트 분해

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `LiveSessionFilterBar` | `alert: AlertLevel[]`, `handoff: 'NONE'\|'ACTIVE'\|'ENDED'`, `channel` |
| `LiveSessionTable` | §2.2 — `GET /chatbots/:chatbotId/live-sessions`(5초 폴링, 숨김 탭 30초 — Page Visibility API) |
| `SessionSummaryBar` | §2.2 |
| `PollingStaleBanner` | `failedCount` — 30초 연속 실패 시에만 렌더 |

---

## 3.3 HC2 — 대화 보기 · 개입(+응답힌트 패널) (`/handoff-console/:chatbotId/live/:sessionRef`)

### 목적
상담원이 세션 하나의 대화 전문(마스킹본)을 보고, 힌트를 참고해 개입·전송·종료하며, 담당자·ADMIN에 한해 상담 중 원문을 확인한다.

### 레이아웃 (데스크톱, 3단 마스터-디테일-보조)

```
┌──────────────┬────────────────────────────────────────────┬────────────────┐
│ (목록, 320px │ 대화 보기 #a3f9c1 · ⛔경고 · 연속3            │ 응답힌트        │
│  로 축소)    │ ⚠ 개인정보는 자동으로 가려진 상태로 표시됩니다.  │────────────────│
│ ⛔ #a3f9c1   │   이름·주소는 가려지지 않을 수 있습니다.         │ 가까운 답변     │
│ ▲ #7d21ee    │────────────────────────────────────────────│ ① FAQ 0.82     │
│ 상담중 #b910│ 사용자 환불 계좌를 바꾸고 싶어요      10:21:03 │   환불 계좌…    │
│ 정상  #f001 │ 봇   (답변 못함)                      10:21:04 │   [복사][넣기] │
│              │ 사용자 다시 문의드려요                10:22:10 │ ② 의도 환불_문의│
│              │ 봇   (답변 못함)                      10:22:11 │ ③ FAQ 환불소요…│
│              │────────────────────────────────────────────│────────────────│
│              │              [개입하기]                       │ 자주 쓰는 문장  │
│              │                                                │ [환불계좌 안내]│
│              │                                                │ [본인확인 요청]│
│              │                                                │ [인사]         │
│              │                                                │ [검색_______] │
└──────────────┴────────────────────────────────────────────┴────────────────┘
```

개입 후(`CONNECTED`):

```
│ 상담 중 · 나        [원문 보기 ⭘꺼짐] "확인되지 않은 연결시도 0회"  [상담종료][강제인수 ADMIN전용]│
│──────────────────────────────────────────────────────────────────────────
│ 시스템 상담원이 연결되었어요. 잠시만 기다려 주세요.               10:23:00 │
│ 사용자 계좌를 국민은행으로 바꾸고 싶어요                           10:23:20 │
│ 상담원(나) 네 확인했습니다                                         10:23:40 │
│──────────────────────────────────────────────────────────────────────────
│ 미리보기: "네, 확인했습니다"(가려질 부분 없음)
│ [입력창_________________________________] [전송]
```

`원문 보기`를 켠 뒤(켜기 직전 고지 팝오버 통과):

```
│ [원문 보기 ⭘켜짐] "이 상담의 원문을 보고 있어요 — 열람이 기록됩니다"
│ 사용자 제 번호 010-****-5678이에요  [원문] 010-1234-5678             10:24:00 │
```

세션이 끝나거나 원문이 파기된 뒤:

```
│ [원문 보기 ⭘(비활성, 사유: 상담 중에만 사용할 수 있어요)]
│ ⓘ 원문 보관 시간이 지났습니다.
```

### 상태별 UI

| 상태 | UI |
|---|---|
| 로딩(최초 전문 조회) | 좌측 `SkeletonRow` × 6 |
| 성공(개입 전) | 봇 구간만, 하단 `[개입하기]` |
| 성공(개입 중) | 상담 구간 포함, `AgentMessageComposer` + `HandoffActionBar` |
| **개입 CAS 충돌**(`409 HANDOFF_ALREADY_ASSIGNED`) | 인라인 배너: "다른 상담원이 개입함 — {담당자명}님이 이미 상담 중입니다." + `[개입하기]` 버튼이 즉시 비활성 + 목록·상세 자동 갱신 |
| **활성 창 밖 개입**(`409 HANDOFF_SESSION_NOT_LIVE`) | 배너: "지금은 연결할 수 없는 대화입니다(활동이 오래전에 끊겼거나 채널이 닫혔습니다)." |
| **상담 꺼진 챗봇**(`409 HANDOFF_DISABLED`) | 배너: "이 챗봇은 상담 연계가 꺼져 있습니다." |
| **관찰 창 밖 개입**(성공했지만 미전달 상태) | 성공 배너: "개입되었습니다. 사용자가 다음에 말할 때 연결됩니다."(EX-CS-3) |
| 전송 실패(`403 HANDOFF_NOT_ASSIGNEE`) | 입력창 비활성 + "담당자가 아니어서 보낼 수 없습니다." — 강제 인수로 자신이 담당자가 되지 않는 한 재시도 불가 |
| 전송 실패(`409 HANDOFF_NOT_ACTIVE`) | 배너: "상담이 이미 종료되었습니다." + 화면 전체가 종료 후 상태로 전환 |
| 전송 실패(`503 HANDOFF_UNAVAILABLE`) | 인라인 오류 + `[다시 시도]`(입력값 보존, 메시지가 조용히 사라지지 않는다 — AC-CS3-5) |
| 폴링 실패(2초, 30초 연속) | `PollingStaleBanner`(HC1과 동일 문구) |
| **원문 보관 시간 지남**(`rawVisible:false` 수신) | 원문 토글 자동 꺼짐 + 캐시 원문 삭제 + 안내 "원문 보관 시간이 지났습니다."(AC-CS8-3/5) |

### 컴포넌트 분해

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `TranscriptPanel` | `GET .../live-sessions/:sessionRef/transcript?cursor&includeRaw`(2초 폴링, 원문 토글 켜짐일 때만 `includeRaw=true`) |
| `RawTextToggle` | 담당자 또는 ADMIN, `handoff.status==='CONNECTED'`일 때만 렌더(그 외에는 컴포넌트 자체가 없다 — 비활성 표시조차 하지 않는다, §9.3). 켜기 클릭 → 고지 팝오버("이 상담의 원문을 확인하면 열람 기록이 남습니다. 계속할까요?" `[취소]` `[원문 보기]`) → 확인 시 `includeRaw=true`로 재조회 |
| `HintPanel` | `GET .../live-sessions/:sessionRef/hints` — **마지막 사용자 발화의 `source.key`가 바뀔 때만** 재요청(폴링마다 재요청 금지, AC-CS5-5). `canFillComposer = handoff?.status === 'CONNECTED' && isAssignee` |
| `InterveneButton` + `InterveneConfirmDialog` | `POST .../live-sessions/:sessionRef/handoff` |
| `AgentMessageComposer` | `POST .../handoffs/:handoffId/messages` — 전송 전 `POST .../handoffs/mask-preview`(디바운스 300ms)로 미리보기 갱신, "개인정보는 가려져 전송됩니다" 안내(가려질 부분이 있을 때만) |
| `HandoffActionBar` | 종료 `POST .../handoffs/:handoffId/end`(`EndHandoffConfirmDialog`) · 강제 인수 `POST .../handoffs/:handoffId/takeover`(`TakeoverDialog`, ADMIN만 활성) |
| `NodeButtonPassthroughNotice` | 봇 시절 `NODE` 버튼이 상담 구간에 텍스트로 들어온 항목에는 "[선택] {라벨}"을 일반 사용자 메시지처럼 렌더(EX-CS-9, 실행 가능한 컨트롤 아님) |

### 종료 후 이동 노드

종료 시 **상담원이 화면에서 노드를 선택하지 않는다** — 종료 후 이동 노드는 HS1(§3.7)에서 챗봇 단위로 미리 정해 두고, 종료(`AGENT_ENDED`)가 일어나면 서버가 그 설정을 스레드 `SYSTEM ENDED` 메시지에 스냅샷으로 적재해 위젯에 버튼으로 전달한다(FR-CS5-4). `EndHandoffConfirmDialog`에는 설정된 버튼이 있으면 미리보기로 "종료 후 사용자에게 '{라벨}' 버튼이 함께 표시됩니다"를 보여준다(정보 제공, 선택 UI 아님).

### 필드-오류 매핑

| 상황 | 표시 위치 | 대표 메시지 |
|---|---|---|
| 메시지 전송 1~1,000자 초과 | 입력창 하단 | "1,000자 이내로 입력해 주세요." |
| 강제 인수 사유 미입력 | `TakeoverDialog` 사유 필드 | "사유를 입력해야 합니다." |
| 교차 챗봇 `sessionRef`(`404`) | 페이지 전체 | `ErrorState`: "대화를 찾을 수 없습니다." |

---

## 3.4 HC3 — 상담 이력 · 요약 (`/handoff-console/:chatbotId/history`)

### 목적
지난 상담을 기간·상태·담당자·종료 사유로 찾고, 건수·평균 첫 응답·평균 상담 시간을 확인한다.

### 상태별 UI

| 상태 | UI |
|---|---|
| 로딩 | `SkeletonRow` × 5 + 요약 카드 스켈레톤 |
| 성공 | 요약 카드 4개 + 표 |
| **빈 상태**(기간 내 상담 0건) | `EmptyState`: "이 기간에 상담 기록이 없습니다." |
| 기간 92일 초과(`400 STATS_RANGE_TOO_WIDE`) | 기간 필드 하단 인라인 오류: "기간은 최대 92일까지 조회할 수 있습니다." |
| 요약 집계 지연(`503 AGGREGATION_TIMEOUT`) | 요약 카드 영역만 `ErrorState` + 다시 시도(표는 별개 요청이라 영향 없음) |

### 레이아웃

```
┌───────────────────────────────────────────────────────────────────────────┐
│ 모니터링 > 쇼핑몰 도우미 > 상담 이력            [진행 중 세션] [상담 이력]  │
├───────────────────────────────────────────────────────────────────────────┤
│ 건수 23건  평균 첫 응답 42초(표본 20건)  평균 상담시간 6분12초(표본 18건)   │
├───────────────────────────────────────────────────────────────────────────┤
│ 기간[09/18]~[09/24]  상태▾  담당자▾  종료사유▾                             │
├───────────────────────────────────────────────────────────────────────────┤
│ 별칭     시작        연결       종료       담당자  종료사유       메시지수│첫응답│
│ #a3f9c1  09-24 10:21 10:23     10:31     김상담  상담원 종료    4/9    2분 │
│ #7d21ee  09-24 09:02  —        09:07     —       상담원 무응답  0/0     —  │
│                                                              ◀ 1 ▶ 총23건 │
└───────────────────────────────────────────────────────────────────────────┘
```

- 요약 카드 4개는 각각 `LowSampleBadge`로 표본 수를 병기(집계 대상이 표시 건수와 다를 수 있으므로 — 예: 연결되지 못한 상담은 첫 응답 평균 표본에서 제외).
- 상담원별 비교·순위·CSV 버튼은 **없다**(J-18).

### 컴포넌트 분해

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `HandoffHistoryFilterBar` | `from`, `to`(필수, ≤92일), `status?`, `assignedUserId?`, `endReason?` |
| `HandoffSummaryCards` | `GET .../handoffs/summary` — 건수·평균 첫 응답·평균 상담 시간·종료 사유 분포 |
| `HandoffHistoryTable` | `GET .../handoffs` — 행 클릭 → HC4 |
| `EndReasonBadge` | §2.1 |

---

## 3.5 HC4 — 상담 이력 상세 (`/handoff-console/:chatbotId/history/:handoffId`)

### 목적
종료된(또는 진행 중인) 상담 1건의 요약과 마스킹 전문을 확인한다. **원문 출구가 아니다**(§9.3 — 실시간 대화 보기 1개만 원문을 낸다).

### 레이아웃

```
┌───────────────────────────────────────────────────────────────────────────┐
│ 모니터링 > 쇼핑몰 도우미 > 상담 이력 > #a3f9c1                              │
├───────────────────────────────────────────────────────────────────────────┤
│ 담당 김상담 · 상담원 종료 · 시작 10:21 · 연결 10:23 · 종료 10:31           │
│ 개입 당시 경고 단계: 경고 · 연속 미응답 3                                   │
├───────────────────────────────────────────────────────────────────────────┤
│ (병합 전문 — 마스킹본만, HC2 TranscriptPanel과 동일 렌더 · 강제 인수 이벤트│
│  "관리자가 담당을 인수했습니다(사유: 담당자 부재)" 포함)                    │
└───────────────────────────────────────────────────────────────────────────┘
```

### 컴포넌트 분해

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `HandoffHistoryDetailHeader` | `GET .../handoffs/:handoffId` — 요약 필드 |
| `TranscriptPanel`(읽기 전용 변형) | 같은 컴포넌트를 `readOnly` + `includeRaw` 옵션 자체를 렌더하지 않는 모드로 재사용(§9.3 H-5 — 원문 식별자가 이 화면 코드 경로에 등장하지 않아야 한다) |

---

## 3.6 CR1 — 자주 쓰는 문장 관리 (`/chatbots/:chatbotId/dialogue/canned-responses`)

### 목적
EDITOR/ADMIN이 상담원이 쓸 정형 문장을 관리한다.

### 상태별 UI

| 상태 | UI |
|---|---|
| 로딩 | `SkeletonRow` × 5 |
| 성공 | 표(분류·순서 순) |
| **빈 상태** | `EmptyState`: "등록된 문장이 없습니다." + `[+ 문장 추가]` |
| 상한 도달(200개) | `[+ 문장 추가]` `aria-disabled` + 툴팁 "챗봇당 문장은 최대 200개까지 만들 수 있습니다." |

### 레이아웃

```
┌───────────────────────────────────────────────────────────────────────────┐
│ 대화설계 > 자주 쓰는 문장                                                   │
├───────────────────────────────────────────────────────────────────────────┤
│ 검색[______________]  분류▾                          [+ 문장 추가](12/200)│
├───────────────────────────────────────────────────────────────────────────┤
│ 제목               분류   단축어    사용   순서   액션                     │
│ 환불계좌 변경안내    환불   refund   ●켜짐  ▲▼    편집 삭제                │
│ 인사말              인사   hi       ●켜짐  ▲▼    편집 삭제                │
└───────────────────────────────────────────────────────────────────────────┘
```

### 컴포넌트 분해

| 컴포넌트 | props / 검증 |
|---|---|
| `CannedResponseFilterBar` | `q`, `category` |
| `CannedResponseList` | §2.3 — 위/아래 버튼으로 `sortOrder` 교환(드래그 단독 금지, UIUX §4) |
| `CannedResponseForm`(모달 또는 인라인 확장) | 제목(1~50, 유일 — `409 DUPLICATE_NAME`), 본문(1~1,000), 분류(≤30, 선택), 단축어(≤20, 선택, 유일) |
| `DeleteCannedResponseConfirmDialog` | 물리 삭제 확인(감사 `DELETE`) |

### 필드-오류 매핑

| field/code | 위치 | 메시지 |
|---|---|---|
| `title`(중복) | 제목 필드 하단 | "이미 같은 제목의 문장이 있습니다." |
| `shortcut`(중복) | 단축어 필드 하단 | "이미 사용 중인 단축어입니다." |
| 201번째 생성 | 폼 상단 배너 | "챗봇당 문장은 최대 200개까지 만들 수 있습니다."(`409 LIMIT_EXCEEDED`) |

---

## 3.7 HS1 — 상담 연계 설정(`AnswerSettingsTab` 3번째 섹션)

### 목적
EDITOR/ADMIN이 챗봇별 상담 연계 사용 여부·임계값·안내 문구·종료 후 버튼을 설정한다.

### 레이아웃 (기존 `AnswerSettingsPage`의 `<section>` 패턴 그대로)

```
┌ 상담 연계 ──────────────────────────────────────────────────────────────┐
│ 사용 ⭘꺼짐                                                              │
│ 주의 임계값[2](1~10)  경고 임계값[3](주의 초과~10)  활성 창(분)[10](5~60) │
│ 사용자 무응답 종료(분)[10](3~60)  상담원 무응답(분)[5](1~30)              │
│ 연결 안내[상담원이 연결되었어요. 잠시만 기다려 주세요._________] 0/200   │
│ 종료 안내[상담이 종료되었어요. 이제 챗봇이 도와드릴게요._______] 0/200   │
│ 연결 실패 안내[지금은 상담원 연결이 어려워요. 챗봇이 계속 도와드릴게요.]0/200│
│ 종료 후 버튼(선택) 라벨[상담 만족도 남기기___]                          │
│   이동 노드[검색: 노드 이름으로 찾기___________▾]                       │
│                                                          [취소]  [저장]  │
└──────────────────────────────────────────────────────────────────────────┘
```

### 상태별 UI

| 상태 | UI |
|---|---|
| 로딩 | 섹션 `SkeletonRow` × 3 |
| 저장 성공 | `Toast`("상담 연계 설정이 저장되었습니다.") |
| 검증 실패(`400`, 경고 ≤ 주의) | 경고 임계값 필드 하단: "경고 임계값은 주의 임계값보다 커야 합니다." |
| 종료 후 버튼 노드 참조 실패(`404 INVALID_REFERENCE`) | 이동 노드 필드 하단: "선택한 노드를 찾을 수 없습니다. 목록을 새로고침해 주세요." |
| 끄기(`enabled: true → false`) 시 활성 상담 존재 | 저장 확인 전 인라인 안내: "진행 중인 상담이 있습니다. 끄더라도 그 상담은 끝날 때까지 계속됩니다." (저장을 막지 않음, `draining` 서버 처리 — FR-CS1-4) |
| `ARCHIVED` 챗봇 | 섹션 전체 읽기 전용 + 안내 |

### 컴포넌트 분해

| 컴포넌트 | props / 검증 |
|---|---|
| `HandoffSettingsSection` | `GET/PUT /chatbots/:chatbotId/handoff-settings`(전체 교체 PUT — 기존 답변 설정과 같은 시맨틱) |
| `ThresholdNumberField` × 5 | 주의·경고·활성 창·사용자 무응답·상담원 무응답 |
| 안내 문구 3종(`textarea`, ≤200, 실시간 잔여 글자수 — UIUX §5) | 연결·종료·연결 실패 |
| `EndButtonNodePicker` | 라벨(≤40) + 노드 선택(둘 다 있거나 둘 다 없음 — `superRefine`) |

---

## 3.8 U1-ext — 회원 관리에 역할 `상담원` 반영 (`/settings/users`)

`security-audit-ui-spec.md` §3.7의 `CreateUserModal`·`ChangeRoleModal`은 이미 `GET /roles` 결과로 역할 select를 구성한다(하드코딩 금지, FR-12-21) — **코드 변경 없이 4번째 옵션 `AGENT`("상담원")가 나타난다.** 이 문서가 추가하는 것은 표시·안내뿐이다.

- `RoleBadge`에 4번째 색상(청록) + 아이콘(헤드셋 모양) 추가(§2.1).
- `CreateUserModal`/`ChangeRoleModal`의 역할 select 옆에 역할 설명 텍스트(선택 시 갱신): "상담원 — 대화 모니터링·개입·상담 이력을 볼 수 있습니다. 대화 설계(FAQ·노드 등)는 수정할 수 없습니다." (기존 ADMIN/EDITOR/VIEWER 설명과 같은 위치·형식)
- `UserFilterBar`의 역할 체크박스가 4개로 늘어난다(기본 전체 선택 유지).

---

## 3.9 N1-ext — `TopBar` "모니터링" 진입점

### 레이아웃

```
┌───────────────────────────────────────────────────────────────────────────┐
│  Chat Bot   챗봇 목록   모니터링(내 상담 2)     [시스템 설정 ▾]  김상담 ▾  │
└───────────────────────────────────────────────────────────────────────────┘
```

- `cs:read`가 없으면(VIEWER) 링크 자체가 렌더되지 않는다(F-4 숨김 원칙 — `SystemSettingsMenu`와 같은 원칙).
- "내 상담 n건" 배지는 `AGENT`/`EDITOR`/`ADMIN` 공통으로, `GET /handoff-console/chatbots`의 `myActiveCount`를 60초 간격(탭 비활성 시 중단)으로 갱신한다(`SystemSettingsMenu`의 예약 배포 "확인 필요" 배지와 동일한 패턴 — `AttentionCountBadge` 재사용).
- `AC-C-3` 대상인 `TabNav.tsx`는 이 변경과 **무관**하다(§0.2).

---

## 4. `apps/widget` 상담 모드 설계 (FR-CS9-\*, ADR-0036 §2)

> `quality-channel-ui-spec.md` §5와 같은 형식(React가 아니므로 DOM 마크업·상태 전이·이벤트 흐름으로 기술). `core/`(순수)와 `ui/`(DOM)의 분리를 그대로 따른다.

### 4.1 상태 확장 — 기존 7상태와 직교

```
기존: CLOSED / OPENING / OPEN / SENDING / AWAITING_ANSWER / ERROR / DISABLED  (변경 없음)
신규(직교 필드): state.handoff?: { mode: 'WATCHING' | 'CONNECTED' }
```

`handoff` 필드는 **입력창을 잠그지 않는다** — 상담 중에도 사용자는 계속 입력할 수 있다(FR-CS9-2). `createInitialState()`의 반환값은 불변(`handoff` 키 없음이 기본).

### 4.2 메시지 역할 확장

```
기존 4종: 'user' | 'bot' | 'system' | 'error'
신규 1종: 'agent'  →  message-list.ts의 wrapMessage('agent') + bubble() 조합, 기존 렌더 경로 그대로 확장
```

- `agent` 말풍선은 시각 스타일(테두리/배경색) + **보이는 텍스트 라벨 "상담원"**을 말풍선 안에 함께 렌더한다(색상 단독 구분 금지, NFR-CSA5). 스크린리더는 "상담원: {텍스트}"로 읽힌다.
- 연결·종료·연결 실패 안내는 기존 `system` 역할(`wrapMessage('system')`)을 그대로 쓴다 — 새 역할을 만들지 않는다.
- 상담원 메시지는 `textContent`로만 삽입(URL 자동 링크 없음, FR-CS5-2 — 기존 `renderPlainText()` 재사용).

### 4.3 마크업 확장 (§5.1 기존 구조에 추가되는 부분만)

```html
<div class="cb-msg cb-msg-agent">
  <div class="cb-bubble cb-bubble-agent">
    <span class="cb-agent-label">상담원</span>
    <p class="cb-msg-text">…</p>
  </div>
</div>
```

- 새 `id`/`aria-*` 요소는 없다 — 기존 `#cb-messages[role="log"][aria-live="polite"]`·`#cb-status[role="status"]`를 그대로 상속한다(§5.1 계승).

### 4.4 상담 폴링 상태 전이 (`core/handoff-poll.ts`, 신규)

```
                이번 턴 미응답(handoff.watch 수신)
  (기본)  ───────────────────────────────▶  WATCHING(5초 폴링, 최대 3분, 새 미응답마다 연장)
                                                  │ 폴링 응답 status='CONNECTED'(token 수신)
                                                  ▼
                                              CONNECTED(3초 폴링)
                                                  │ 폴링 응답 status='ENDED' 또는 다음 발화 응답 handoff.status='ENDED'
                                                  ▼
                                              (기본으로 복귀, 저장소 삭제, 폴링 중단)
```

- `WATCHING`은 **화면에 아무것도 표시하지 않는다**(FR-CS9-2) — 순수 백그라운드 폴링.
- `CONNECTED` 진입 시 `#cb-status`에 1회: "상담원이 연결되었어요. 잠시만 기다려 주세요."(설정 문구, `SYSTEM` 메시지로도 말풍선 목록에 적재).
- 구버전 위젯(`features` 미선언)은 이 다이어그램 자체가 없다 — §4.7 참고.

### 4.5 이벤트 흐름 / 사용자에게 보이는 문구 전수

| 트리거 | 동작 | 사용자에게 보이는 문구 |
|---|---|---|
| 이번 턴 미응답 + 상담 연계 켜짐 | 관찰 창(`WATCHING`) 시작(화면 변화 없음) | (없음) |
| 상담원 개입 후 첫 폴링 응답(토큰 수신) | `CONNECTED` 전환, 연결 안내 1회 | "상담원이 연결되었어요. 잠시만 기다려 주세요."(설정 문구, 기본값) |
| 상담원 메시지 도착 | `agent` 말풍선 추가 | "상담원" 라벨 + 상담원이 입력한 텍스트(마스킹본) |
| 상담 중 사용자가 봇 시절 `NODE` 버튼 클릭 | 노드 미실행, 사용자 메시지처럼 전달만 | "[선택] {버튼 라벨}"(사용자 자신의 말풍선으로 표시) |
| 토큰 없음/틀림으로 상담 구간 전송(선점 의심 등) | 전달 0, 중립 안내 | "지금은 메시지를 보낼 수 없어요. 잠시 후 다시 시도해 주세요." |
| 상담원 종료 | 종료 안내 + (설정 시) 버튼, 폴링 중단 | "상담이 종료되었어요. 이제 챗봇이 도와드릴게요." + (선택) `[{종료 후 버튼 라벨}]`(예: "상담 만족도 남기기") |
| 상담원 무응답 5분(첫 응답 전) | 연결 실패 안내, 봇 복귀 | "지금은 상담원 연결이 어려워요. 챗봇이 계속 도와드릴게요." |
| 관찰 창 밖 개입(다음 발화 편승) | 다음 사용자 발화 응답에 연결+메시지가 함께 옴 | 위 연결 안내 문구가 상담원 메시지 앞에 붙어 한 번에 나타남 |
| 폴링 네트워크 오류 | 같은 간격 재시도 | (30초 연속 실패 시) "연결이 원활하지 않아요" |
| 새로고침(상담 중) | 상담 구간 메시지 재조회 후 재표시, 폴링 재개 | "이전 챗봇 대화는 다시 표시되지 않아요"(안내 1줄, 봇 구간은 복원 안 됨) |
| 구버전 위젯 + 상담원 개입 | 다음 사용자 발화 응답에 일반 봇 말풍선(`TEXT`)으로 편승 전달 — 발신자 구분 없음 | 연결 안내·상담원 메시지가 **구분 없이 일반 봇 응답**으로 표시(구버전 한계, 고지 없음 — 콘솔에만 "구버전 위젯" 배지) |

### 4.6 접근성 (§5.8 형식 계승)

| 요건 | 반영 |
|---|---|
| NFR-CSA5 상담원 말풍선 텍스트 라벨 | `.cb-agent-label`("상담원") — 색상 단독 구분 아님 |
| NFR-CSA5 연결/종료 상태 알림 | `#cb-status`(`role="status"`) 1회, `#cb-messages`(`role="log"`)에도 `system` 메시지로 영구 기록 |
| NFR-CSA5 폴링이 포커스를 이동시키지 않음 | `core/handoff-poll.ts` 순수 로직은 DOM 접근 0, `ui/`가 메시지 추가만 하고 `focus()`를 호출하지 않는다 |
| NFR-CSA5 axe 대비 위반 0 | `.cb-bubble-agent` 배경/텍스트 대비 4.5:1 이상(스킨과 무관한 고정 팔레트) |

### 4.7 구버전 위젯(편승 격하) 상세

- 요청에 `features: ['handoff-v1']`가 없으면(구버전 빌드) 서버는 `handoff` 응답 필드·관찰 창·토큰을 **절대 주지 않는다**(계약 자체에서 제외, §5.6).
- 위젯 코드 변경도, 구버전 사용자에게 보이는 새 문구도 **없다** — 상담원 메시지는 다음 사용자 발화 응답의 일반 `TEXT` 아웃풋 배열 안에 그냥 들어 있어 기존 `addBotOutputs()` 경로로 렌더된다. 연결 안내·상담원 메시지·종료 안내가 **하나의 봇 응답으로 뭉쳐서** 순서대로 보일 수 있다(EX-CS-26).
- 사용자 입장에서는 "챗봇이 평소보다 조금 다르게 답한다" 정도로만 체감되며, 상담원이 응대 중이라는 사실을 구분해서 알 방법이 없다 — 이것이 격하 경로의 본질이며 콘솔에서만 `구버전 위젯` 배지로 드러난다(§2.1).

### 4.8 번들 예산

- gzip 100KB 게이트(NFR-CSP6) — 신규 파일(`core/handoff-poll.ts`, `core/handoff-storage.ts`) + 마크업/CSS 증가분은 4~6KB 예상(설계서 §14.4). `frontend-implementer`는 빌드 로그에 증가분을 남긴다.

---

## 5. 권한별 UI 변화 규칙

원칙(F-4 상속): **권한이 없는 화면·버튼은 비활성화가 아니라 렌더 자체를 하지 않는다.** 단 "지금 이 상태라서" 못 하는 동작(예: 담당자가 아니라서 못 보내는 메시지)은 **버튼을 남기고 사유 텍스트와 함께 비활성화**한다(NFR-CSA6).

| 화면/동작 | VIEWER | EDITOR | AGENT | ADMIN |
|---|---|---|---|---|
| `TopBar` "모니터링" 링크 | 숨김 | 노출 | 노출 | 노출 |
| HC0~HC1~HC3~HC4(조회) | 진입 불가(403 안내 페이지, L4 재사용) | 조회 가능 | 조회 가능 | 조회 가능 |
| HC2 개입·전송·종료 | — | 버튼 자체 없음(조회만) | 가능 | 가능 |
| HC2 강제 인수 | — | — | 버튼 노출하되 비활성 + 사유("관리자만 사용할 수 있어요") | 가능 |
| HC2 `원문 보기` 토글 | — | 렌더 자체 없음(마스킹본만) | 담당자일 때만 렌더 | 항상 렌더(담당 아니어도) |
| CR1 조회 | — | 조회 가능 | **접근 불가**(`dialogue:read` 없음) | 조회 가능 |
| CR1 생성·수정·삭제 | — | 가능 | — | 가능 |
| HS1 조회/저장 | 조회만 | 조회/저장 | 조회만(`chatbot:read`) | 조회/저장 |
| HC2 힌트 패널의 자주 쓰는 문장 검색 | — | 가능(`cs:read` 없으면 접근 자체 불가지만 EDITOR는 있음) | 가능 | 가능 |

- **`AGENT`는 `chatbot:read`로 열리는 기존 화면(대시보드·통계·설문 결과·답변 설정 조회 등) 전부에 접근할 수 있다**(P-7이 확정한 집합, 마스킹본 등급) — 단 대화 자산(`dialogue:read` 이상) 화면(노드·FAQ·자주 쓰는 문장 등)은 볼 수 없다. `AGENT`가 `TabNav`가 있는 챗봇 상세로 들어가면 `chatbot:read` 탭(대시보드/통계/설정/버전 등 읽기)만 보이고 대화설계 탭 진입 시 L4(403 안내)로 막힌다 — 이는 기존 `RequirePermission`/탭 숨김 로직의 자연스러운 결과이며 이 그룹이 `TabNav`를 수정하지 않는다.
- 이 표는 대표 지점 발췌다(security-audit-ui-spec.md §4.2와 같은 형식) — 전 화면 매트릭스는 설계서 §15 표가 최종 근거다.

---

## 6. 사용자 인터랙션 흐름 (제출 → 로딩 → 결과, 오류 포함)

### 6.1 경고 발견 → 개입 → 응답 → 종료 (핵심 흐름, S-1~S-6 대응)

1. `AGENT`가 HC1에 진입 → 5초 폴링 시작 → 경고 세션 1건 발견(`aria-live` 1회 안내).
2. 행 클릭 → HC2(마스터-디테일) → 2초 폴링 시작 + `TranscriptPanel`(마스킹본) + `HintPanel`(발화당 1회 계산).
3. `[개입하기]` → `InterveneConfirmDialog` 확인 → `POST .../handoff`(`201`) → `HandoffStateBadge`가 "연결 중…"으로 즉시 갱신(낙관적 갱신 아님 — 응답의 `HandoffDetail`을 그대로 반영).
4. 위젯이 폴링으로 토큰을 받아 `CONNECTED`가 되면(최대 6초, NFR-CSP5) 콘솔의 다음 2초 폴링에서 "상담 중 · 나"로 갱신.
5. 힌트에서 "자주 쓰는 문장"을 `[입력창에 넣기]` → 입력창에 텍스트 삽입(전송 안 됨) → 상담원이 문구를 고침 → 전송 → 미리보기가 가려질 부분을 보여줌 → `[전송]` → `AGENT` 말풍선처럼 스레드에 적재, 콘솔에 즉시 반영.
6. `[상담 종료]` → `EndHandoffConfirmDialog`(설정된 종료 후 버튼 미리보기 포함) → 확인 → 위젯에 종료 안내 + 버튼 → 콘솔은 "정상"(경고 해제) 상태로 복귀.

### 6.2 개입 경합 (AC-CS3-1 대응)

1. 두 `AGENT`가 같은 행을 거의 동시에 클릭 → 둘 다 `POST .../handoff` 전송.
2. 서버가 부분 유니크 CAS로 정확히 1건만 `201`, 나머지 1건은 `409 HANDOFF_ALREADY_ASSIGNED`.
3. 진 쪽 화면: 인라인 배너 "다른 상담원이 개입함 — {담당자명}님이 이미 상담 중입니다." + `[개입하기]` 즉시 비활성 + 다음 폴링에서 `HandoffStateBadge`가 상대방 이름으로 자동 갱신.

### 6.3 강제 인수 (S-9 대응)

1. ADMIN이 담당자가 자리를 비운 상담을 연다 → `[강제 인수]`만 활성.
2. `TakeoverDialog`에 사유 "담당자 부재" 입력 → 확인 → `POST .../takeover`(`200`) → 담당자 배지가 ADMIN 이름으로 갱신, 이전 담당자 화면은 다음 폴링에서 `rawVisible:false`(원문 보고 있었다면 즉시 삭제) + 전송 버튼이 `403`으로 막힘.
3. 사용자 위젯에는 **아무 변화도 없다**(AC-CS3-7).

### 6.4 무응답 자동 종료 (S-7 대응, 배치 없음)

1. 상담 중 사용자가 탭을 닫음 → 콘솔에 "사용자 응답 없음 n분"이 조회 시점마다 갱신(전용 카운트다운 타이머 없이 마지막 활동 시각 기준 계산).
2. 10분 경과 후 **다음 콘솔 조회 또는 60초 정리 루프**에서 `ENDED(USER_IDLE)`로 전이 → `EndReasonBadge` "응답 없음으로 종료" + 전송 버튼 비활성("상담이 종료되었습니다").

### 6.5 오류 처리 총괄

| 오류 | 화면 반응 |
|---|---|
| `429 RATE_LIMITED`(관리자 API, 드묾) | 토스트 "요청이 많습니다. 잠시 후 다시 시도해 주세요." + 해당 폴링 주기 건너뜀 |
| 폴링 실패(네트워크) | 조용히 다음 주기 재시도, 30초 연속 시 배너(§3.2) |
| `403`(권한 부족, 직접 URL 진입 등) | 기존 `L4`(403 접근 거부 안내) 재사용 |
| `404`(교차 챗봇 `sessionRef`/`handoffId`) | `ErrorState` "찾을 수 없습니다." |
| `HANDOFF_UNAVAILABLE`(503) | §3.3 표 — 재시도 가능, 입력값 보존 |

---

## 7. `UIUX_준수기준.md` 체크리스트 매핑

### 7.1 공통(HC0~HC4, CR1, HS1 — 관리자 콘솔)

| 기준 | 항목 | 적용 지점 |
|---|---|---|
| §1 색상대비 | 텍스트 4.5:1, 색상 단독 금지 | `AlertLevelBadge`(색+아이콘+텍스트), `HandoffStateBadge`, `EndReasonBadge` |
| §1(신규 보강) | 민감 정보 임시 열람 토글 — 기본 꺼짐·고지·만료 시 안내로 복귀 | `RawTextToggle`(§3.3) — §11 |
| §3 키보드접근성 | Tab 순차, Enter/Space, Esc+포커스복귀 | `InterveneConfirmDialog`/`EndHandoffConfirmDialog`/`TakeoverDialog` 포커스 트랩, `RawTextToggle` 고지 팝오버 |
| §4 버튼 | 동사형 레이블, 연타 방지, 44×44px | "개입하기"/"상담 종료"/"복사"/"넣기", `[전송]` 연타 방지(전송 중 `aria-disabled`) |
| §5 텍스트입력필드 | 레이블 필수, 글자수 실시간 | `AgentMessageComposer`(1,000자), 안내 문구 3종(200자, HS1) |
| §6 폼컨트롤 | 단일선택=라디오, 필수/선택 구분 | `LiveSessionFilterBar` 체크박스(다중 선택), `HandoffSettingsSection` 숫자 필드 |
| §7 오류메시지 | 원인+해결방법, 제출 시점 | 개입 경합·전송 실패·설정 검증 오류(§3.3·§3.7) |
| §8 로딩/상태 | 스켈레톤, 완료 배지 | `SkeletonRow`, `SessionSummaryBar` |
| §8(신규 보강) | 실시간 목록·대화 폴링 갱신 — 포커스·스크롤 유지, 새 항목 1회 안내, 반복 실패 배너 | `LiveSessionTable`(5초)·`TranscriptPanel`(2초) — §11 |
| §9 내비게이션 | href 기반, 현재 탭 구분 | HC1↔HC3 상단 탭, `TopBar` "모니터링" 링크 |

### 7.2 화면별

| 화면 | UIUX 항목 | 적용 지점 |
|---|---|---|
| HC1 | §3(정렬 가능한 표 헤더 `aria-sort`) | `LiveSessionTable` 컬럼 헤더(정렬 지원 시) |
| HC2 | §1(색상 단독 금지) | `AlertLevelIcon`(▲/⛔ 형태 구분), `RawViewBadge` |
| | §4(대화형 요소 44×44px) | `HintAnswerCard`/`HintCannedCard`의 `[복사]`/`[넣기]` |
| CR1 | §4(드래그 단독 금지) | `CannedResponseList` 위/아래 버튼 |
| HS1 | §6(슬라이더 아님, 숫자 입력) | `ThresholdNumberField`(정수 입력 — 슬라이더 규칙 대상 아님을 명시) |
| 위젯(§4) | (a) 전 항목 | §4.6 매핑표 |

### 7.3 자동화 연계

`AC-CS7-5`(axe 대비 위반 0, 경고 단계 텍스트 구분), `AC-CS7-6`(키보드만으로 경고 세션 열기→힌트 넣기→개입→전송→종료 완료)은 `test-automation` 검증 대상이며, 본 설계의 href 기반 탭·포커스 트랩·`aria-live` 1회 규칙이 그 전제 조건이다.

---

## 8. 반응형 고려사항

### 8.1 관리자 콘솔(`apps/web`)

| 브레이크포인트 | 폭 | 레이아웃 변화 |
|---|---|---|
| 데스크톱 | ≥1024px | HC2: 목록(320px 고정)+대화(가변)+힌트(300px 고정) 3단. HC1: 표 그대로 |
| 태블릿 | 640~1023px | HC2: 힌트 패널이 대화 영역 **아래**로 이동(세로 스택, 접이식 아코디언 아님 — 상담 중 계속 참고하므로 항상 펼침). 목록 패널은 뒤로가기 버튼으로 전환하는 방식(목록↔대화 전체화면 교대)으로 단순화 |
| 모바일 | <640px | HC2: 목록·대화·힌트가 **각각 전체화면**이며 상단 "← 목록"/"응답힌트 보기" 버튼으로 전환(3단 동시 표시 안 함). HC1 표는 카드 리스트로 전환(행마다 `AlertLevelBadge`+별칭+마지막 발화를 카드로). `AgentMessageComposer`는 화면 하단 고정(sticky). 모든 버튼 44×44px 유지 |

### 8.2 위젯(`apps/widget`)

상담 모드는 `quality-channel-ui-spec.md` §8.2의 기존 반응형 원칙(데스크톱 플로팅 360×560px·모바일 전체화면·`/c/:slug` 전체화면)을 **그대로 상속**한다 — 상담원 말풍선·연결/종료 안내는 기존 패널 크기 안에서 렌더될 뿐 위젯 자체의 크기·배치 로직에 변경이 없다.

---

## 9. `messages.ts` 신규 키 목록 (`apps/web/src/constants/messages.ts`)

### 9.1 신규 네임스페이스 `MESSAGES.handoffConsole`

```
navLabel, myActiveCount(n),
pickerTitle, pickerEmptyTitle, pickerDisabledCardHint,
liveTabLabel, historyTabLabel,
summaryLive, summaryWarning, summaryCaution, summaryConnected,
newAlertAnnounce(count),
filterAlertLabel, filterHandoffLabel, filterChannelLabel,
alertNormal, alertCaution, alertWarning,
handoffNone, handoffConnecting(name), handoffConnected(name), handoffConnectedMine, handoffLegacyBadge,
columnStatus, columnAlias, columnLastMessage, columnLastActivity, columnUnanswered, columnAssignee,
unansweredReasonFallback, unansweredReasonApiNotice,
emptyLiveList, disabledBannerTitle,
pollingStaleBanner,
transcriptTitle, transcriptPiiNotice, transcriptPiiNoticeRawAddendum,
rawToggleLabel, rawToggleConfirmTitle, rawToggleConfirmDesc, rawToggleDisabledReason, rawExpiredNotice, rawBadgeLabel,
unverifiedAttemptBadge(count),
blockedDuringHandoffBadge(count),
interveneButton, interveneDisabledReason(name), interveneConfirmTitle, interveneConfirmDesc,
interveneAlreadyAssignedBanner(name), interveneSessionNotLiveBanner, interveneDisabledBanner, interveneWatchWindowMissedBanner,
composerLabel, composerSendButton, composerDisabledNotAssignee, composerDisabledNotActive,
maskPreviewLabel, maskPreviewNoChangeHint, maskPreviewChangedHint,
sendUnavailableError, sendUnavailableRetry,
endButton, endConfirmTitle, endConfirmDesc, endConfirmButtonPreview(label),
takeoverButton, takeoverDisabledReason, takeoverConfirmTitle, takeoverReasonLabel, takeoverReasonRequired,
nodeButtonPassthroughLabel(label),
hintTitle, hintAnswersTitle, hintCannedTitle, hintSearchLabel, hintEmpty,
hintLexicalBadge, hintCopyButton, hintCopySuccess, hintFillButton, hintFillDisabledReason,
historyTitle, historyFilterPeriodLabel, historyFilterStatusLabel, historyFilterAssigneeLabel, historyFilterEndReasonLabel,
historyEmpty, historyRangeTooWide, historyAggregationTimeout,
summaryCount, summaryAvgFirstResponse, summaryAvgDuration, summarySampleCount(n),
historyColumnAlias, historyColumnStarted, historyColumnConnected, historyColumnEnded, historyColumnAssignee,
historyColumnEndReason, historyColumnMessageCount, historyColumnFirstResponse,
historyDetailTitle, historyDetailAlertAtStart, historyDetailTakeoverEvent(fromName, toName, reason),
endReasonAgentEnded, endReasonUserIdle, endReasonAgentNoReply, endReasonNotDelivered, endReasonChannelClosed,
```

### 9.2 신규 네임스페이스 `MESSAGES.cannedResponses`

```
pageTitle, searchLabel, categoryFilterLabel, addButton, addButtonLimitReached,
columnTitle, columnCategory, columnShortcut, columnEnabled, columnOrder,
emptyTitle, emptyDesc,
formTitleLabel, formBodyLabel, formCategoryLabel, formShortcutLabel, formEnabledLabel,
duplicateTitle, duplicateShortcut, limitExceeded,
deleteConfirmTitle, deleteConfirmDesc,
editAction, deleteAction, moveUpAction, moveDownAction,
```

### 9.3 신규 네임스페이스 `MESSAGES.handoffSettings`(`AnswerSettingsTab` 3번째 섹션)

```
sectionTitle, enabledLabel,
cautionThresholdLabel, warningThresholdLabel, activeWindowLabel,
userIdleMinutesLabel, agentNoReplyMinutesLabel,
connectNoticeLabel, endNoticeLabel, failNoticeLabel,
endButtonLabelField, endButtonNodeLabel, endButtonHelp,
thresholdOrderError, drainingHint,
saveSuccess,
```

### 9.4 기존 네임스페이스 갱신

```
MESSAGES.common.monitoringNav: '모니터링',                          // TopBar 신규 링크
MESSAGES.dialogue.subNav.cannedResponses: '자주 쓰는 문장',           // DialogueShell 7번째
MESSAGES.systemSettings 변경 없음(모니터링은 이 메뉴에 넣지 않는다 — §0.2),
MESSAGES.users.roleDescriptions.AGENT: '상담원 — 대화 모니터링·개입·상담 이력을 볼 수 있습니다. 대화 설계(FAQ·노드 등)는 수정할 수 없습니다.',
```

---

## 10. 위젯 문구 목록 (`apps/widget/src/constants/messages.ts` 확장 + `constants/handoff.ts` 신설)

### 10.1 `constants/messages.ts` 추가 키

```
agentLabel: '상담원',
handoffConnectAnnounce: (설정 문구를 그대로 사용, 기본값 "상담원이 연결되었어요. 잠시만 기다려 주세요."),
handoffEndAnnounce: (설정 문구, 기본값 "상담이 종료되었어요. 이제 챗봇이 도와드릴게요."),
handoffFailAnnounce: (설정 문구, 기본값 "지금은 상담원 연결이 어려워요. 챗봇이 계속 도와드릴게요."),
handoffUnverified: '지금은 메시지를 보낼 수 없어요. 잠시 후 다시 시도해 주세요.',
handoffPollUnstable: '연결이 원활하지 않아요',
handoffRestoreNotice: '이전 챗봇 대화는 다시 표시되지 않아요',
handoffNodeSelectionPrefix: (label: string) => `[선택] ${label}`,
```

- **설정 문구(연결·종료·연결 실패 안내)는 위젯 코드에 하드코딩하지 않는다** — `GET /public/chatbots/:slug/config` 또는 폴링 응답에 실려 오는 서버 값을 그대로 쓴다(챗봇마다 다를 수 있음, HS1에서 편집). 위 상수는 **네트워크 실패 등으로 서버 문구를 못 받았을 때의 폴백**이다.
- `handoffAgentLabel`은 위젯 코드 상수다(서버가 상담원 이름을 공개 응답에 절대 싣지 않으므로 — FR-CS6-4).

### 10.2 `constants/handoff.ts`(신설, shared-types 상수와 동일성 시험 대상)

```
HANDOFF_SESSION_HEADER = 'x-cb-session-id'
HANDOFF_TOKEN_HEADER = 'x-cb-handoff-token'
WIDGET_FEATURE_HANDOFF_V1 = 'handoff-v1'
```

---

## 11. `UIUX_준수기준.md` 보강 내역

이번 작업에서 **§1(색상/명도 대비)·§8(로딩/상태 피드백)에 각 1개 항목을 최소 보강**했다(실제 파일 반영 완료 — 아래는 반영한 문구 요지). 근거는 이 문서 §3.3(원문 보기 토글)·§3.2~§3.3(폴링 갱신)이다.

1. **§1 추가**: "민감 정보(원문 등) 임시 열람 토글" — 기본값 꺼짐, 켜기 전 "열람이 기록됩니다" 고지, 열람 대상이 만료·종료되면 조용히 마스킹본으로 되돌아가지 않고 안내 문구로 알리며 토글도 꺼진 상태로 되돌린다.
2. **§8 추가**: "실시간 목록·대화 갱신(짧은 간격 폴링)" — 갱신마다 스크롤·포커스·펼침 상태 유지, 새 항목은 `aria-live="polite"` 1회만, 반복 실패 시 배너로 상태 고지(무한 재시도만 하지 않음).

---

## 12. `frontend-implementer`/위젯 구현자 인계 메모

1. **콘솔은 `ChatbotDetailLayout` 밖의 새 최상위 라우트 트리다** — `/handoff-console/*`를 `App.tsx`의 `/settings/*`와 같은 급으로 추가한다(§1). `TabNav.tsx`는 **손대지 않는다**.
2. **구현 순서 권고**: ① `TopBar`에 "모니터링" 링크(§3.9, 독립적) → ② HC0 챗봇 선택기 → ③ HC1 목록(5초 폴링, `LiveSessionTable`) → ④ HC2(가장 복잡 — 마스터-디테일 + 2초 폴링 + 힌트 패널 + 개입/전송/종료/인수 + 원문 토글) → ⑤ HC3/HC4 이력 → ⑥ `DialogueShell` 7번째 서브내비 + CR1 → ⑦ `AnswerSettingsPage` 3번째 섹션 HS1 → ⑧ U1 역할 배지·설명 텍스트(가장 가벼움) → ⑨ 위젯(§4, 마지막 배포 권장 — 설계서 §3.5 배포 순서와 일치).
3. **`RawTextToggle`은 담당자·ADMIN·`CONNECTED`일 때만 렌더한다** — 그 밖의 모든 경우(EDITOR, 비담당 AGENT, 종료된 상담)는 컴포넌트 자체를 만들지 않는다(비활성 표시조차 하지 않음). 토글을 켜는 순간 `includeRaw=true`로 **커서를 리셋해 전체 재조회**해야 한다(증분 커서 응답에는 과거 항목의 원문이 없다 — 설계서 §9.3).
4. **원문 캐시는 프런트 상태(React state)에만 존재**해야 한다 — `localStorage`/`sessionStorage`에 원문을 절대 쓰지 않는다(§9.7 누출 봉인). `rawVisible:false` 수신 시 해당 세션의 캐시된 원문을 **즉시** 지운다(다음 렌더까지 남아 있으면 안 된다).
5. **힌트 패널은 발화당 1회만 재요청**한다 — `sessionRef`가 아니라 마지막 사용자 발화의 `source.key`가 바뀔 때만 `GET .../hints`를 부른다. 2초 대화 폴링마다 부르면 AC-CS5-5가 깨진다.
6. **`sessionRef`를 직접 문자열로 다루는 코드를 만들지 않는다** — 항상 `SessionRefLabel`(§2.2)을 거치거나 서버 응답 필드를 그대로 렌더한다. 전체 `sessionId`는 API 응답 스키마 자체에 없으므로(NFR-CSS3) 프런트가 실수로 노출할 방법이 구조적으로 없다는 점을 시험으로 확인할 것.
7. **위젯 `agent` 역할은 `message-list.ts`의 기존 `wrapMessage(role)`/`bubble()` 패턴을 그대로 확장**한다 — 새 DOM 트리 체계를 만들지 않는다(§4.3).
8. **위젯 설정 문구(연결·종료·연결 실패 안내)는 서버 값이다** — `apps/widget/src/constants/messages.ts`에 하드코딩하지 말고 폴백으로만 둔다(§10.1).
9. **콘솔 폴링은 전부 `setInterval` + Page Visibility 패턴**(`DeploySchedulesPage.tsx`·`TestRunListPage.tsx` 선례)을 재사용한다 — 새 폴링 유틸을 만들지 않는다.
10. **`AnswerSettingsPage`의 3번째 섹션(HS1)은 기존 2개 섹션과 같은 저장 흐름을 따르지 않는다** — `ChatbotHandoffSetting`은 **별도 API**(`GET/PUT /chatbots/:chatbotId/handoff-settings`)이며 기존 `ChatbotAnswerSetting` 저장 요청과 **합쳐서 보내지 않는다**(설계서 §26 D-1 — 두 자산은 DB 행이 다르다). 저장 버튼을 섹션별로 분리할지 하나로 묶어 병렬 호출할지는 `frontend-implementer` 재량이나, **요청 payload는 반드시 분리**해야 한다.
