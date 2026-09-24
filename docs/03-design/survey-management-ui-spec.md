# 설문관리 (No.27) — 화면 설계서

> **대상 기능**: No.27 설문관리 — 관리자가 **챗봇별 설문**(단일/다중 선택·척도·자유 텍스트)을 만들고, 대화 노드의 `SURVEY` 아웃풋이 **대화 안에서 여러 턴에 걸쳐** 문항을 묻는다. 응답은 매 턴 서버에 적재되고, 노출·시작·완료·이탈·문항별 분포가 챗봇 스코프 참여 통계와 CSV로 제공된다.
> **입력 문서**: `docs/requirements/survey-management.md`(T-1~9, J-1~J-21, FR-0-106~117, FR-SV1-\*~FR-SV12-\*, NFR-SVP/SVS/SVA/SVM, AC-SV1~SV7, EX-SV-1~28, PM 결정 P-1~P-17 §11), `docs/02-spec/survey-management-설계.md`(§2 모듈 배치, §4~§6 스키마·봉투, §9 통계 쿼리, §10 CSV, §11~§13 권한·감사·API 계약, §16~§17 버전/콘솔 인계), `docs/02-spec/decisions/ADR-0035-survey-dialogue-session-and-server-response-ledger.md`
> **준수 기준**: `docs/03-design/UIUX_준수기준.md`(전 항목 — 이번 작업에서 §4(버튼) "대화형 설문 문항 표시 원칙" 1개 항목을 최소 보강했다, §6 참고)
> **선례 참고**: `docs/03-design/legacy-api-integration-ui-spec.md`(최신 문서 형식 — v1/v2 판별 카드 패턴·`ResourcePickerField` 확장·설계 점검 패널 확장·CSV 내보내기 패턴을 그대로 계승), `docs/03-design/dialogue-design-ui-spec.md`(노드 편집 폼·`ReorderableList`·`ResourcePickerField`·설계 점검 패널·흐름 미리보기 — 이번에 §4.2.1 ⑪행을 갱신해 이 문서를 가리키도록 했다), `docs/03-design/stats-learning-ui-spec.md`(`MetricCard`·`ChartFrame`·`GranularityPeriodControl` 재사용), `docs/03-design/quality-channel-ui-spec.md`(SIM1 `TracePanel`·`ApiModeToggle` 패턴), `docs/03-design/validation-regression-ui-spec.md`(V4 `TestRunResultRow` 배지 패턴), `docs/03-design/version-history-ui-spec.md`(`RestoreWarningList`)
> **실제 코드 확인**: `apps/web/src/pages/dialogue/components/DialogOutputEditor.tsx`(67~68·141·409~423행 — SURVEY 현재 자유 입력, API_CONDITION v1/v2 분기 425~468행이 그대로 따를 패턴), `apps/web/src/pages/dialogue/DialogueShell.tsx`(서브내비 5종 — `surveys`를 6번째로 추가), `apps/web/src/pages/stats/StatsShell.tsx`(No.26이 3번째 서브탭을 추가한 패턴 — 이 그룹은 서브탭을 늘리지 않는다), `apps/web/src/pages/chatbot-detail/TabNav.tsx`(최상위 라우트 6개 고정, `AC-C-3` — 이 그룹은 라우트를 늘리지 않는다), `apps/web/src/components/ResourcePickerField.tsx`(22행 `ResourcePickerType` 유니온 — `'survey'` 8번째 타입 추가), `apps/web/src/constants/messages.ts`(574~583행 `dialogue.subNav`, 711~724행 `outputTypes`/`outputFields`, 240행대 `simulator`, 2000행대 `versions.warnings`, 1911행대 `validation.result`), `apps/widget`(변경 0건 — 기존 `TEXT`·`BUTTON` 렌더러만 사용)
> **작성**: ui-designer · 2026-09-24 · **다음 단계**: `backend-implementer`/`ml-engineer`(해당 없음, GPU 1) → `frontend-implementer` → `code-reviewer` → `test-automation`
> **범위 경계**: 실제 React 컴포넌트 코드는 작성하지 않는다. 여기서 정의한 화면/컴포넌트/상태/문구는 `frontend-implementer`가 구현 기준으로 삼는다. `apps/widget` 변경은 **0건**이다 — 설문 문항은 서버가 조립한 기존 `TEXT`·`BUTTON` 아웃풋으로만 전달된다(설계서 §5.11, J-7).

---

## 0. 전제와 연계 확인

1. **PM 결정 P-1~P-17은 전부 권고안대로 확정**되었다(요구사항 §11). 이 문서는 그 결정을 화면으로 구체화할 뿐 재론하지 않는다. 핵심만 다시 적는다.
   - 설문은 **챗봇별 자산**이며 챗봇당 최대 50개다. 경로는 `/chatbots/:chatbotId/surveys/*`(J-5).
   - 진행은 **대화 내 멀티턴**이고, 클라이언트 봉투에는 진행 포인터만 남으며 **응답 값은 절대 봉투에 없다**. 위젯 전용 폼·새 `@Public` 경로는 없다(J-2·J-3).
   - 문항은 4유형(단일 선택 2~10 · 다중 선택 2~10 · 척도 `STAR_5`/`NPS_11` · 자유 텍스트 ≤500)이고, 위젯은 **기존 `TEXT`+`BUTTON`만** 쓴다 — 버튼 5개 단위 분할, 다중 선택은 번호 입력("1,3")(J-6·J-7).
   - **첫 응답 이후 구조 잠금**(`409 SURVEY_STRUCTURE_LOCKED`) — 문구만 수정 가능, 구조를 바꾸려면 복제(J-8).
   - 설문 정의는 **버전 스냅샷에 포함되지 않는다** — 노드의 참조만 스냅샷, 끊기면 경고(J-9).
   - `sessionId`당 1회 완료, 서버가 `isDuplicate`만 표시한다. IP·쿠키는 수집하지 않는다(J-10).
   - 자유 텍스트는 **금지어 → PII 마스킹 후 저장**, 이름·주소 미탐 한계를 화면에 고지한다(J-11).
   - **응답 삭제 경로는 0**이다 — 응답 있는 설문은 마감만 가능하다(J-12).
   - 참여 통계 = 노출·시작·완료·중도 이탈·미시작 이탈·진행 중(+비율), 문항별 도달·분포·평균·NPS. 노출일(KST) 코호트, 이탈은 **조회 시점 판정**, 챗봇 스코프만이다(J-13).
   - 설문이 소비한 턴은 `ConversationLog.surveyTurn=true`로 표시되어 질문 순위·미응답 수집·RAG에서 제외된다(J-14) — 이 화면군에는 직접 영향이 없다(기존 통계 화면 무변경, FR-0-113).
   - **신규 권한 0종**. 정의 = `dialogue:read/write`, 결과·CSV = `chatbot:read`(VIEWER 포함, 마스킹본만)(J-15).
   - CSV 2종(응답 원자료·문항별 집계), 기간 필수·최대 10,000행·`sessionId` 미포함(J-16).
   - **시뮬레이터·TC는 응답을 저장하지 않는다.** 시뮬레이터는 `설문 미리보기` 토글, TC·비교는 항상 상태·기간을 무시해 결정적으로 판정한다(J-17).
   - v1(이전 형식) `SURVEY`는 **읽기만·실행 안 함·신규 저장 거부**. 자동 연결·변환은 없다(J-18).
2. **선행 화면과의 관계**
   - `dialogue-design-ui-spec.md`의 노드 편집 폼(D1a/D1b)·`ReorderableList`·`ResourcePickerField`·설계 점검 패널(`DesignValidationPanel`)·흐름 미리보기(`FlowPreviewPanel`)를 그대로 확장한다. 이 문서는 그 문서를 대체하지 않으며, 이번 세션에서 `dialogue-design-ui-spec.md` §4.2.1 ⑪행을 이미 갱신해 이 문서를 가리키도록 했다.
   - `ResourcePickerField`의 `resourceType` 유니온에 `'survey'`를 추가한다(§2.2) — `apiConnection`과 달리 **챗봇 스코프 자원**이라 `chatbotId`가 필요하다(`node`/`context`와 같은 모양).
   - `legacy-api-integration-ui-spec.md`의 v1 읽기 전용 카드 + 전환 다이얼로그 패턴(§3.3)을 설문에도 그대로 적용한다(§3.4).
   - `stats-learning-ui-spec.md`의 `MetricCard`·`ChartFrame`(표 보기 토글)·`GranularityPeriodControl`을 설문 결과 화면(§3.5)에 재사용한다.
   - `quality-channel-ui-spec.md`의 SIM1 `TracePanel`/`ApiModeToggle` 패턴을 확장해 `SurveyPreviewToggle`·`SurveyStepPanel`을 추가한다(§3.6).
   - `validation-regression-ui-spec.md`의 V4 `TestRunResultRow` 배지 패턴에 `설문 미리보기 판정` 배지를 추가한다(§3.7).
   - `version-history-ui-spec.md`의 `RestoreWarningList`에 3종을 추가한다(§3.8).
3. **메뉴 배치(T-9) — 최상위 메뉴가 아니라 "대화 설계" 하위**: ROCHA 원본은 좌측 내비게이션에 `설문관리`가 별도 최상위 메뉴로 존재한다는 사실만 확인됐다(카탈로그 원문 조사 한계, 요구사항 문서 16행). 그러나 이 프로젝트의 `TabNav.tsx`는 챗봇 상세 **최상위 라우트 수를 6개로 고정**해 둔 이력이 있다(`AC-C-3`, No.5 그룹 수용기준). 설문은 카탈로그 원문상 "**대화 중** 설문조사 생성·호출"(No.5 아웃풋 12종 중 하나)이며 노드 편집기 안에서 참조되는 대화 자산이므로, **`DialogueShell`의 서브내비 6번째 항목**(`nodes`·`intents`·`homonyms`·`contexts`·`faqs`·**`surveys`**)으로 배치한다. 이 배치는 `legacy-api-integration-ui-spec.md`가 외부 연동 로그를 `StatsShell` 서브탭에 얹은 것과 같은 원칙 — 최상위 라우트를 늘리지 않고 이미 있는 "탭 + 서브탭/서브내비" 구조에 얹는다. 결과 화면(§3.5)은 결과·CSV 열람이 `chatbot:read`(통계와 같은 도메인)이지만, 설문 자체가 대화 자산이라 목록·편집과 같은 위치(설문 상세 안의 탭)에 둔다 — 새 라우트 트리를 만들지 않는다.
4. **문구 상수**: 신규 네임스페이스 `MESSAGES.surveys`·`MESSAGES.surveyResults`를 추가하고, 기존 `MESSAGES.dialogue.subNav`·`MESSAGES.dialogue.outputTypes`·`MESSAGES.dialogue.outputFields`·`MESSAGES.simulator`·`MESSAGES.versions.warnings`·`MESSAGES.validation.result`에 항목을 더한다(§8).
5. **위젯 문항 문구는 서버 상수다 — `messages.ts`에 없다.** 설문 문항 출력(`TEXT`+`BUTTON`)은 `packages/dialogue-engine/src/constants.ts`의 고정 문구와 `buildSurveyQuestionOutputs()`가 조립하는 문항 문구로 만들어지며, 관리자가 입력한 문항 문구를 제외하면 관리자가 편집할 수 없는 **서버 텍스트**다(설계서 §5.10~§5.12). 이 문서 §3.9는 그 문구 스펙을 **검토·확정**하되 클라이언트 코드가 아니라 backend-implementer 인계 사항으로 기록한다.
6. **조사 한계 승계**: 요구사항 문서가 명시한 대로 ROCHA 원본의 설문 편집·통계 화면 필드를 직접 인용하지 못했다(`docs/00-source/*.pdf` 렌더링 불가). 이 설계는 요구사항·설계서의 필드 목록 + 선행 화면(D1a/D1b, AC1의 v1/v2 패턴, S1의 `MetricCard`/`ChartFrame`)의 관용구만으로 구성했다.
7. **`UIUX_준수기준.md` 보강**: §4(버튼)에 "대화형 설문 문항 표시 원칙"(진행 표시 n/N · 텍스트 라벨 버튼 · 그만하기 상시 제공)을 **최소 1개 항목**으로 추가했다(§6 참고, 근거는 이 문서 §3.9).

---

## 1. 화면 목록 및 라우트

| ID | 화면명 | 라우트 | 성격 | 진입 경로 | 필요 권한 |
|---|---|---|---|---|---|
| SV1 | **설문 목록** | `/chatbots/:chatbotId/dialogue/surveys` | 페이지 | `DialogueShell` 서브내비 6번째 "설문" | `dialogue:read`(조회) / `dialogue:write`(쓰기) |
| SV2 | **설문 편집기**(생성/수정) | `/chatbots/:chatbotId/dialogue/surveys/new`, `/chatbots/:chatbotId/dialogue/surveys/:surveyId` | 페이지 | SV1 "설문 추가" / 행 클릭 | `dialogue:read`(조회) / `dialogue:write`(쓰기) |
| SV3 | **설문 결과** | `/chatbots/:chatbotId/dialogue/surveys/:surveyId/results` | 페이지(SV2 내부 탭) | SV2 상단 탭 "결과" | `chatbot:read`(VIEWER 포함) |
| D1a-v2(SV) | 노드 편집 — `설문` 아웃풋 v2 폼(신규) | `/chatbots/:chatbotId/dialogue/nodes/:nodeId`(기존 라우트, 아웃풋 카드 내부) | 폼 내 컴포넌트 | 아웃풋 유형 "설문" 선택(v2 신규 저장) | `dialogue:read`(설문 선택 목록) · `dialogue:write`(저장) |
| D1a-v1(SV) | 노드 편집 — v1(이전 형식) 읽기 전용 + 전환 | 〃(기존 라우트) | 폼 내 컴포넌트 | 기존 v1 데이터를 가진 노드를 열었을 때 | `dialogue:read` · 전환은 `dialogue:write` |
| D1-ext(SV) | 대화그래프 — 설계 점검·흐름 미리보기 확장 | `/chatbots/:chatbotId/dialogue/nodes`(기존 라우트) | 페이지 내 패널 확장 | 기존과 동일 | `dialogue:read` |
| SIM1-ext(SV) | 응답 테스트 — `설문 미리보기`·`설문 단계` 패널 확장 | `/chatbots/:chatbotId/simulator`(기존 라우트) | 페이지 내 패널 확장 | 기존과 동일 | `simulation:read`(미리보기 열람) — 저장 없음이라 VIEWER 포함 |
| V4-ext(SV) | TC 실행 결과 — `설문 미리보기 판정` 배지 확장 | `/chatbots/:chatbotId/validation/runs/:runId`(기존 라우트) | 행 요소 확장 | 기존과 동일 | `simulation:read` |
| L4-ext(SV) | 버전 복원 미리보기 — 경고 3종 확장 | 기존 `RestoreDialog`(모달, 비라우트) | 모달 내 목록 확장 | 기존과 동일 | `dialogue:write` + `chatbot:write` |

**신규 최상위 라우트는 0개다.** SV1~SV3은 전부 `/chatbots/:chatbotId/dialogue/*` 하위(`DialogueShell`의 6번째 서브내비 자식 라우트)이고, 나머지는 기존 화면의 확장이다 — `TabNav.tsx`의 6개 고정 라우트(`AC-C-3`)와 `StatsShell`의 서브탭 수 모두 **변경하지 않는다**.

**SV3 라우트 배치 근거**: 설문 결과는 `chatbot:read`(통계와 같은 권한 도메인)이지만, "이 설문의 결과"라는 성격상 설문 상세(SV2)에서 바로 이어지는 탭이 자연스럽다 — 독립된 통계 서브탭으로 옮기면 설문을 고르는 선택기를 다시 만들어야 한다. VIEWER는 SV2 편집 폼에 진입할 수 있되(조회 전용, §5) "결과" 탭만 활성화된 상태로 열람한다(§3.2 권한별 UI).

---

## 2. 공통 UI 요소(신규)

### 2.1 배지류 (색상+텍스트 병기, UIUX §1)

| 컴포넌트 | 용도 | 규칙 |
|---|---|---|
| `SurveyStatusBadge` | 설문 목록·편집기·노드 편집기 선택기 | `작성 중`(회색, `DRAFT`) / `진행 중`(초록, `OPEN` & 기간 내) / `기간 외`(주황, `OPEN` & 기간 밖) / `마감`(회색, `CLOSED`) — 상태와 기간을 조합해 계산한 **표시 상태**(설계서 §13.1 "표시 상태(IDLE 판정)" — `survey-display.ts` 재사용) |
| `SurveyLockedBadge` | 설문 목록·편집기(상태 배지와 별도) | 답 행 1건 이상일 때만: "응답 잠금"(주황) — 상태와 무관하게 병기 가능(예: "작성 중" + "응답 잠금"은 있을 수 없지만 "진행 중" + "응답 잠금"은 흔함) |
| `LegacySurveyBadge` | 노드 편집기 v1 카드(§3.4) | "이전 형식 — 실행되지 않습니다. 설문을 선택해 전환하세요"(주황 `WARNING` 톤 — 기존 `UnsupportedOutputBadge`의 INFO 톤과 시각적으로 구분, No.26 `LegacyFormatBadge`와 동일 원칙) |
| `SurveyLowSampleBadge` | 설문 결과(SV3) 문항 카드 | "표본이 적습니다"(회색 `INFO` 톤) — 노출/응답 30건 미만일 때 |
| `SurveyDuplicateBadge` | 응답 목록 행 | "중복"(회색) — `isDuplicate=true`인 행에만, 옆에 "통계에서 제외됨" 보조텍스트 |
| `SurveyPreviewSavedBadge` | 시뮬레이터 결과 패널(§3.6)·설문 편집기 미리보기 | "저장되지 않음"(파랑 `INFO` 톤) — 항상 노출(응답이 실제로 적재되지 않음을 매번 상기) |
| `SurveyPreviewJudgmentBadge` | TC 실행 결과 행(§3.7) | "설문 미리보기 판정"(파랑 `INFO` 톤) — `surveyPreviewA`/`surveyPreviewB` true인 쪽에 |

### 2.2 설문 선택·편집 전용 컴포넌트

| 컴포넌트 | props | 규칙 |
|---|---|---|
| `SurveyPickerField` | `id`, `label`, `chatbotId`, `value: string \| null`, `onChange`, `required?` | `ResourcePickerField`(`dialogue-design-ui-spec.md` §2.2-4)의 **8번째 `resourceType`**으로 `'survey'`를 추가해 구현한다. `GET /chatbots/:chatbotId/surveys?q=` 호출(페이지네이션 없음 — 설계서 §13.1 ①, 챗봇당 최대 50개라 전체를 받아 클라이언트에서 걸러도 무리 없다). 후보 항목 표시 문자열은 `"{이름} · {상태 라벨} · 문항 {n}개"`(예: "배송 만족도 · 진행 중 · 문항 3개") — 기존 `apiConnection` 타입이 이름 뒤에 "(사용 중지)" 접미사를 붙이는 것과 같은 **텍스트 접미 방식**을 따른다(리치 배지 렌더링은 `ResourcePickerField`의 옵션 렌더가 순수 텍스트라 이번 범위에서 도입하지 않는다 — §9 주의점 1). 목록 0건이면 "'{입력값}'에 해당하는 설문이 없습니다." + "[설문 만들기 →]"(`createHref="/chatbots/:chatbotId/dialogue/surveys/new"`, `dialogue:write` 없는 사용자에게는 "관리자에게 설문 등록을 요청하세요" 텍스트만) |
| `SurveyQuestionListEditor` | `items: SurveyQuestionDraft[]`, `onChange`, `locked: boolean` | `ReorderableList` 재사용(위/아래 버튼, 드래그 없음). 각 항목은 `SurveyQuestionCard`(§3.2)로 렌더. `locked`면 추가·삭제·순서 이동 버튼이 `disabled` + 사유 텍스트("응답이 있어 문항 구성을 바꿀 수 없습니다") |
| `SurveyChoiceListEditor` | `items: SurveyChoiceDraft[]`, `onChange`, `locked: boolean`, `minItems=2`, `maxItems=10` | `ReorderableList` 재사용(선택지 순서 변경 — 키보드 가능, UIUX §3). 각 행: `label`(1~40자, 카운터) + 삭제 버튼. `locked`면 라벨 입력은 **활성**(문구 수정 허용, FR-SV2-4) · 추가·삭제·순서 버튼은 `disabled` |
| `SurveyCancelKeywordEditor` | `items: string[]`, `onChange`, `maxItems=10` | 칩 입력(엔터로 추가, 칩 클릭/backspace로 제거) — 각 항목 ≤20자. 기본값 `그만`·`취소`·`설문 종료` 안내를 placeholder로 제공 |
| `SurveyPreviewPanel` | `survey: SurveyDraft`, `questionIndex: number` | 위젯 모양 그대로(TEXT+BUTTON 말풍선 목업)를 **공유 순수 함수**(`@chat-bot/shared-types/survey-logic`의 `buildSurveyQuestionOutputs`·`judgeSurveyAnswer`)를 브라우저에서 직접 호출해 렌더(서버 왕복 없음 — `ApiConditionPreviewPanel`과 동일 전략, 설계서 §4.4). 문항 이동 화살표(◀ N/M ▶)로 임의 문항을 미리 볼 수 있고, 하단 "샘플 입력으로 판정 테스트" 텍스트 필드에 값을 넣으면 `judgeSurveyAnswer` 결과(성공/재질문 문구)를 즉시 보여준다(§3.2) |
| `SurveyStructureLockBanner` | `responseCount: number` | 편집기 상단 상시 배너: "응답 {n}건 — 문구만 수정할 수 있어요. 구성을 바꾸려면 복제해서 새 설문을 만드세요." + `[복제하기]` 버튼(§3.2) |
| `SurveyTimeoutRetroactiveHint` | `hasResponses: boolean` | 타임아웃 필드 하단 상시 안내(응답이 있을 때만 노출): "⚠ 타임아웃을 바꾸면 과거 응답의 '진행 중/이탈' 분류 기준도 함께 바뀝니다(문항 구성은 그대로 유지됩니다)."(K-3) |
| `SurveyPiiNotice` | — | 자유 텍스트 문항 서브폼과 결과 화면 자유 응답 목록에 상시 노출: "전화번호·이메일 등만 자동으로 가려지며 **이름·주소는 가려지지 않을 수 있습니다.**"(FR-SV8-3, ADR-0013 §6) |
| `ConvertLegacySurveyDialog` | `v1Payload`, `onConfirm` | §3.4 상세 |

---

## 3. 화면별 설계

## 3.1 SV1 — 설문 목록 (`/chatbots/:chatbotId/dialogue/surveys`)

### 목적
EDITOR가 챗봇의 설문을 만들고, 상태를 오픈·마감하며, 복제·삭제한다. VIEWER는 조회만 한다.

### 상태별 UI

| 상태 | UI |
|---|---|
| 로딩 | `SkeletonRow` × 5 |
| 성공(데이터 있음) | 표 + "총 {total}건 / 최대 50건" |
| **빈 상태**(설문 0건) | `EmptyState`: "등록된 설문이 없습니다." + "대화 노드의 '설문' 아웃풋에서 쓸 설문을 여기서 먼저 만드세요." + `[+ 설문 추가]` |
| 상한 도달(50건) | `[+ 설문 추가]` 버튼 `aria-disabled` + 툴팁 "챗봇당 설문은 최대 50개까지 만들 수 있습니다." |
| 오류 | `ErrorState` + 다시 시도 |

### 레이아웃 (데스크톱)

```
┌───────────────────────────────────────────────────────────────────────────┐
│ 대화설계 > 설문                                                             │
├───────────────────────────────────────────────────────────────────────────┤
│ 검색 [__________]  상태 ☑작성중 ☑진행중 ☑마감                              │
│                                                          [+ 설문 추가]      │
├───────────────────────────────────────────────────────────────────────────┤
│ 이름          상태       기간          문항 참조노드 최근30일(노출/완료)     │
│ 배송 만족도    ●진행중    09/25~10/31   3    2       1,240 / 512      ⋮    │
│                (응답 잠금)                                                  │
│ 신규 이벤트   ●작성중    —             5    0       0 / 0            ⋮    │
│                                                          ◀ 1 ▶ 총 2건       │
└───────────────────────────────────────────────────────────────────────────┘
```

- `SurveyLockedBadge`("응답 잠금")는 상태 배지 아래 보조 줄로 병기한다(모든 배지가 색상만이 아니라 텍스트를 갖는다 — UIUX §1).
- "참조" 열은 이 설문을 참조하는 **현재 저장된 노드 수**(스냅샷 참조는 세지 않음 — FR-SV10-3과 같은 원칙), "최근 30일" 열은 노출/완료 수(설계서 §15 목록 통계, N+1 금지).

### 컴포넌트 분해

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `SurveyFilterBar` | `q`, `status: SurveyStatus[]`(기본 전체 체크) |
| `SurveyTable` | `items: SurveyListItem[]`, `loading` | 컬럼: 이름, `SurveyStatusBadge`(+`SurveyLockedBadge` 보조 줄), 기간(`activeFrom`~`activeTo`, 둘 다 없으면 "—"), 문항 수, 참조 노드 수, 최근 30일 노출/완료, 케밥 메뉴 |
| `SurveyRowActions`(`KebabMenu`) | `survey` | "편집" / "오픈"·"마감"(상태에 따라 하나만) / "복제" / "삭제" — 전부 `dialogue:write`가 있을 때만 노출(없으면 케밥 메뉴 자체를 숨기고 "보기"만) |
| `SurveyStatusToggleAction` | `survey` | `PATCH { status }` — `DRAFT→OPEN` 클릭 시 오픈 검증 실패(`400`)면 인라인 토스트 "문항이 1개 이상이어야 합니다" 등 `details[]` 요약. `OPEN↔CLOSED`는 확인 없이 즉시 전환(`CLOSED→DRAFT`는 UI에 버튼 자체가 없다) |
| `DeleteSurveyConfirmDialog` | `survey` | `409 SURVEY_IN_USE` 시 모달 내 배너: "이 설문을 사용하는 노드가 {n}건 있습니다." + 상위 5건 노드명 링크(클릭 시 모달 닫고 해당 노드 편집으로 이동). `409 SURVEY_HAS_RESPONSES` 시 배너: "응답이 있는 설문은 삭제할 수 없습니다. 마감하면 더 이상 응답을 받지 않습니다." + `[마감하기]` 인라인 버튼(삭제 대신 상태만 `CLOSED`로 전환) — `legacy-api-integration-ui-spec.md` §3.1.2와 같은 3단계 패턴(트리거 → 확인 모달 → 409 시 배너) |
| `CopySurveyAction` | `survey` | `POST .../copy` → `201` → SV2(새 설문 편집기, DRAFT)로 이동 + 토스트 "설문이 복제되었습니다. 노드 연결은 새로 설정해야 합니다." |

---

## 3.2 SV2 — 설문 편집기 (`/chatbots/:chatbotId/dialogue/surveys/new`, `/:surveyId`)

### 목적
EDITOR가 설문의 기본 정보·문항을 구성하고 미리보기로 위젯 모양을 확인한 뒤 저장·오픈한다. 응답이 있으면 문구만 고칠 수 있다.

### 상태별 UI

| 상태 | UI |
|---|---|
| 로딩(기존 설문 조회) | 폼 영역 `SkeletonRow` × 4 |
| 신규 생성 | 빈 폼, 상태는 항상 `DRAFT`(셀렉트 없음 — 생성 시 `status`를 받지 않는다, 설계서 §4.3) |
| 저장 중 | 저장 버튼 `disabled` + 스피너, 연타 방지 |
| **구조 잠금**(응답 1건 이상) | 상단 `SurveyStructureLockBanner` 상시 노출 + 잠긴 필드 `disabled` + 사유 텍스트 |
| 문구 수정(잠긴 상태에서) | 저장 성공 시 배너: "문구를 바꾸면 이전 응답과 의미가 달라질 수 있습니다." (경고 톤, 저장은 막지 않음) |
| 저장 오류(`409 SURVEY_STRUCTURE_LOCKED`) | 폼 상단 배너: "응답이 있는 설문은 문항 구성을 바꿀 수 없습니다. 문구만 수정할 수 있어요. 구성을 바꾸려면 복제해서 새 설문을 만드세요." + `[복제하기]` |
| 오픈 검증 실패(`400`) | 폼 상단 배너 + `details[]`를 항목별 인라인 오류로 매핑(예: "문항이 1개 이상이어야 합니다") |

### 레이아웃 (데스크톱)

```
┌───────────────────────────────────────────────────────────────────────────┐
│ 대화설계 > 설문 > 배송 만족도                    [기본 정보] [결과]         │  ← 상단 탭(SV3로 전환)
├───────────────────────────────────────────────────────────────────────────┤
│ ⚠ 응답 43건 — 문구만 수정할 수 있어요. 구성을 바꾸려면 복제해서 새 설문을    │
│    만드세요.                                              [복제하기]       │
├───────────────────────────────────────────────────────────────────────────┤
│ 이름 * [배송 만족도____________]  설명 [___________________] 0/300        │
│ 상태  ●진행 중(OPEN)   기간 [09/25]~[10/31] (선택)                        │
│ 소개 문구 [배송은 만족스러우셨나요? 30초면 끝나요.__] 0/500                │
│ 완료 문구 * [소중한 의견 감사합니다!________________] 24/500              │
│ 취소어 [그만 ×][취소 ×][설문 종료 ×] [+입력 후 Enter]                     │
│ 타임아웃(분) [30] (1~1440)                                                │
│   ⚠ 타임아웃을 바꾸면 과거 응답의 '진행 중/이탈' 분류 기준도 함께 바뀝니다  │
├───────────────────────────────────────────────────────────────────────────┤
│ 문항 (3/20)                                              [+ 문항 추가]🔒  │
│ ┌───────────────────────────────────────────────────────┐ ▲ ▼(🔒) ⌫(🔒)  │
│ │ Q1  유형 [척도 ▾](🔒)  필수 ☑(🔒)                        │              │
│ │ 문구 *[배송 속도는 어떠셨나요?____________] 12/300        │              │
│ │ 척도 종류 (●별점5 ○NPS11)(🔒)  양끝 라벨[매우불만족][매우만족]│              │
│ └───────────────────────────────────────────────────────┘              │
│ ┌───────────────────────────────────────────────────────┐ ▲ ▼(🔒) ⌫(🔒)  │
│ │ Q2  유형 [다중 선택 ▾](🔒)  필수 ☐(🔒)                    │              │
│ │ 문구 *[좋았던 점을 골라 주세요___________]                │              │
│ │ 선택 수 최소[1](🔒) 최대[3](🔒)                            │              │
│ │ 선택지 (4/10)                                [+ 선택지](🔒)│              │
│ │  1.[포장__________] ⌫(🔒)  ▲▼(🔒)                         │              │
│ │  2.[속도__________] ⌫(🔒)  ▲▼(🔒)                         │              │
│ └───────────────────────────────────────────────────────┘              │
│ ┌───────────────────────────────────────────────────────┐ ▲ ▼(🔒) ⌫(🔒)  │
│ │ Q3  유형 [자유 텍스트 ▾](🔒)  필수 ☐(🔒)                  │              │
│ │ 문구 *[더 하고 싶은 말씀이 있나요?(개인정보는 입력하지 마세요)]│              │
│ │ 최대 글자 수[300](🔒) (1~500)                             │              │
│ │ ⓘ 전화번호·이메일 등만 자동으로 가려지며 이름·주소는 가려지지 │              │
│ │    않을 수 있습니다.                                        │              │
│ └───────────────────────────────────────────────────────┘              │
├───────────────────────────────────────────────────────────────────────────┤
│ 미리보기                                        ◀ 1/3 ▶  [샘플 입력 시험]  │
│ ┌ 위젯 미리보기 ─────────────────────────────────────────┐               │
│ │ 배송은 만족스러우셨나요? 30초면 끝나요.                    │               │
│ │ 1/3 배송 속도는 어떠셨나요?                                │               │
│ │ [1점 매우 불만족][2점][3점][4점][5점 매우 만족]             │               │
│ │ [그만하기]                                                │               │
│ └───────────────────────────────────────────────────────┘               │
│                                          [취소]  [저장]                    │
└───────────────────────────────────────────────────────────────────────────┘
```

- `(🔒)` 표시는 응답이 있을 때만 `disabled` + 사유 텍스트(실제로는 아이콘이 아니라 필드 하단 회색 텍스트 "응답이 있어 바꿀 수 없어요"). 문구 필드(이름·설명·소개·완료 문구·취소어·타임아웃·기간·상태·`prompt`·선택지 `label`·척도 라벨)는 잠금 상태에서도 항상 활성이다.

### 컴포넌트 분해

| 컴포넌트 | props / 검증 |
|---|---|
| `SurveyBasicInfoForm` | `name`(1~50, 유일 — `409 DUPLICATE_NAME`), `description`(0~300), `status`(읽기 전용 텍스트 + 액션 버튼, 셀렉트 아님 — 전이는 SV1의 `SurveyStatusToggleAction`과 동일 로직을 편집기에도 노출), `activeFrom`/`activeTo`(`DateRangeField` 재사용, 오프셋 포함 — 서버가 KST로 표시), `introMessage`(0~500), `completionMessage`(1~500, 기본값 미리 채움), `cancelKeywords`(`SurveyCancelKeywordEditor`), `sessionTimeoutMinutes`(1~1440, 기본 30) + `SurveyTimeoutRetroactiveHint` |
| `SurveyQuestionCard` | `question: SurveyQuestionDraft`, `onChange`, `locked` | 유형 셀렉트(4종, UIUX §6) 변경 시 **하위 서브폼 전환 + 포커스 이동**(기존 `DialogOutputEditor`의 타입 전환 규칙과 동일). `locked`면 유형 셀렉트 자체가 `disabled`(유형 변경 = 구조 변경) |
| `SurveyQuestionCard.Common` | `prompt`(1~300, 카운터), `required`(체크박스, `locked`면 disabled) |
| `SurveyQuestionCard.Choice`(단일/다중 공용) | `SurveyChoiceListEditor`(§2.2) + (다중일 때만) `minSelect`/`maxSelect`(숫자, `1 ≤ min ≤ max ≤ 선택지 수`, `locked`면 disabled) |
| `SurveyQuestionCard.Scale` | `scale`(라디오: 별점5/NPS11, `locked`면 disabled), `lowLabel`/`highLabel`(0~20, 항상 활성 — 문구) |
| `SurveyQuestionCard.Text` | `maxLength`(1~500, 기본 300, `locked`면 disabled) + `SurveyPiiNotice` 상시 노출 |
| `SurveyQuestionListEditor` | §2.2 |
| `SurveyPreviewPanel` | §2.2 — 문항 이동 화살표 + 샘플 판정 |
| `SurveyStructureLockBanner` | §2.2 |
| `FormActions` | `dirty`, `saving`, `onSave`, `onCancel` — 기존 `DialogNodeForm` 패턴과 동일(변경 없으면 저장 비활성) |

### 필드-오류 매핑

| field 패턴 | 표시 위치 | 대표 메시지 |
|---|---|---|
| `name` | 이름 필드 하단 | "이미 같은 이름의 설문이 있습니다."(`DUPLICATE_NAME`, 409) |
| `activeFrom`/`activeTo` | 기간 필드 하단 | "시작일은 종료일보다 빨라야 합니다."(`400`) |
| `questions[i].choices` | 해당 선택지 목록 하단 | "선택지는 2~10개여야 합니다."(오픈 검증, `400 VALIDATION_FAILED`) |
| `questions[i].scale` | 척도 종류 라디오 하단 | "척도 종류를 선택해야 합니다."(오픈 검증) |
| 전체 payload가 구조 변경 + 응답 존재 | 폼 상단 배너 | "응답이 있는 설문은 문항 구성을 바꿀 수 없습니다…"(`SURVEY_STRUCTURE_LOCKED`, 409) |

### PATCH 시 기존 문항·선택지 key 보존 UX (설계 요구사항 명시 대응)

서버의 `UpdateSurveySchema.questions`는 **전체 교체**이며, 기존 key를 빠뜨리면 "그 문항/선택지는 삭제되고 새 문항이 추가된 것"으로 해석되어 **구조 변경**으로 판정된다(설계서 §13.1 "구조 판정"). 편집기는 이를 사용자가 의식하지 않게 다음과 같이 설계한다.

1. **로컬 상태는 항상 `key`를 함께 들고 있다.** 서버에서 불러온 문항·선택지는 `key`(UUID)를 폼 상태에 그대로 보존하고, 화면에는 **노출하지 않는다**(사용자에게는 순서·라벨만 보인다).
2. **문항/선택지를 추가**하면 로컬에서 임시 key(예: `new-${seq}`, 화면 표시용)를 부여하고, 저장 요청 시 **키가 없는 항목으로 전송**한다(서버가 신규 UUID를 발급 — `survey-keys.ts`). 임시 key는 서버 응답으로 실제 key를 돌려받을 때까지 로컬 재정렬·삭제 대상 식별에만 쓰인다.
3. **문항/선택지를 삭제**하면 로컬 배열에서 제거될 뿐이며, 저장 시 그 항목의 key가 요청 배열에 없으므로 서버가 "삭제됨"으로 인식한다(구조 변경 — 잠금 상태에서는 삭제 버튼 자체가 `disabled`라 이 경로는 애초에 막힌다).
4. **순서만 바꿔도 key는 유지**되며 배열 순서만 바뀐다(잠금 상태에서는 순서 이동 버튼이 `disabled`).
5. **문구만 수정**(잠긴 상태에서 허용되는 유일한 변경)할 때는 기존 key·순서·유형·선택지 구성이 **전부 그대로** 요청에 담긴다 — `label`/`prompt`/척도 라벨 텍스트만 바뀐 값으로 나가므로 서버의 `structureFingerprint()`가 `TEXT_ONLY`로 판정해 `structureVersion`이 증가하지 않는다(AC-SV4-2).
6. **구현 메모**: 폼 상태 타입은 `{ key?: string; ...필드 }`로 두고, "새로 추가된 항목"과 "기존 항목"을 시각적으로 구분할 필요는 없다(사용자 입장에서는 차이가 없어야 한다) — 단지 저장 payload 조립 시 `key` 존재 여부만으로 자연히 구분된다.

---

## 3.3 D1a/D1b(SV) — 노드 편집기 `설문` 아웃풋 v2 폼 (`SurveyOutputEditorV2`)

### 목적
EDITOR가 이 챗봇의 설문 하나를 선택해 대화 노드에 연결하고, 완료 후 이어질 노드를 지정한다.

### 진입 경로
`dialogue-design-ui-spec.md` D1b(`/chatbots/:chatbotId/dialogue/nodes/:nodeId`)의 아웃풋 유형 셀렉트에서 "설문"을 선택하면 이 v2 폼이 나타난다(기존 v1 데이터를 가진 카드는 §3.4의 읽기 전용 표시가 대신 나타난다 — payload 형태로 분기, FR-SV1-2).

### 레이아웃

```
┌─────────────────────────────────────────────────────────────────┐ ▲ ▼ ⌫
│ N  유형 [설문 ▾]                                                  │
│    설문 * [검색: 설문 이름으로 찾기_______▾]  [배송 만족도 ×]        │
│           진행 중 · 문항 3개                                       │
│    완료 후 이동 노드(선택) [검색: 노드 이름으로 찾기_______▾]         │
│    [설문 편집으로 이동 →]                                          │
│    ⓘ 설문이 시작되면 이 아웃풋 뒤의 다른 아웃풋은 실행되지 않습니다.  │
│       지금 참여할 수 없는 상태라면(작성 중·마감·기간 외 등) 뒤의      │
│       아웃풋이 대신 실행됩니다.                                     │
└─────────────────────────────────────────────────────────────────┘
```

### 컴포넌트 분해

| 컴포넌트 | props / 검증 |
|---|---|
| `SurveyPickerField` | §2.2 — 선택 시 옆에 `SurveyStatusBadge` + "문항 {n}개" 텍스트를 병기(피커 자체 옵션 문자열과 별개로, 선택 확정 후에는 별도 조회 없이 캐시된 이름으로 렌더 — `ResourcePickerField`의 기존 `nameCache` 메커니즘 재사용) |
| `ResourcePickerField`(완료 후 이동 노드) | `resourceType='node'`, `multiple=false`, 선택 해제 가능. 도움말: "지정하지 않으면 완료 문구로 끝납니다." |
| `SurveyEditLink` | 설문이 선택돼 있을 때만 노출 — `<Link to="/chatbots/:chatbotId/dialogue/surveys/:surveyId">` |
| `SurveyNotAvailableHint` | 선택한 설문이 `DRAFT`/`CLOSED`/기간 밖이면 폼 안에 `INFO` 배너: "이 설문은 현재 참여할 수 없는 상태입니다({상태 라벨}). 저장은 가능하지만, 오픈(또는 기간 진입)해야 실제로 진행됩니다."(저장을 막지 않음 — FR-SV3-3③과 같은 조건의 사전 안내) |
| `SurveyOutputTerminalHint` | 고정 안내(항상 노출) — 위 레이아웃의 ⓘ 문구. API 조건분기의 `ApiOutputTerminalHint`와 달리 **조건부 종결**임을 명시한다(설문은 참여 가능할 때만 종결자다, FR-SV3-3①과 FR-SV4-3의 차이) |

### 필드-오류 매핑

| field 패턴 | 표시 위치 | 대표 메시지 |
|---|---|---|
| `outputs[i].payload.surveyId` | `SurveyPickerField` 하단 | "선택한 설문을 찾을 수 없습니다. 목록을 새로고침해 주세요."(`INVALID_REFERENCE`, 404 — 다른 챗봇 설문을 가리키던 경우 포함, AC-SV1-5) |
| `outputs[i].payload.onCompleteNodeId` | `ResourcePickerField`(노드) 하단 | "선택한 노드를 찾을 수 없습니다. 목록을 새로고침해 주세요."(`INVALID_REFERENCE`, 404) |
| 전체 payload가 v1 형태 | 폼 상단 배너 | "설문 연동을 새 방식으로 바꿔야 저장할 수 있습니다. 설문을 선택해 주세요."(`SURVEY_OUTPUT_LEGACY_FORMAT`, 400 — §3.4에서 전환하지 않고 v1 카드째 저장을 시도한 경우에만 발생) |

---

## 3.4 D1a/D1b(SV) — v1(이전 형식) 표시 + 전환 (`LegacySurveyReadonlyCard` / `ConvertLegacySurveyDialog`)

### 목적
No.5 시절 자유 문자열 키로 저장된 `SURVEY`를 안전하게 열람하고, 원할 때만 v2(설문 선택)로 전환한다. 자동 연결·자동 변환은 하지 않는다(P-15).

### 레이아웃

```
┌─────────────────────────────────────────────────────────────────┐ ▲ ▼ ⌫
│ N  유형 [설문 ▾]                                                  │
│    ⚠ 이전 형식 — 실행되지 않습니다. 설문을 선택해 전환하세요        │
│    설문 ID(읽기 전용)  post-shipping-satisfaction                 │
│                                                    [설문 선택해 전환]│
└─────────────────────────────────────────────────────────────────┘
```

- 모든 필드가 읽기 전용이다(자유 문자열 키는 값 자체가 시크릿이 아니므로 가릴 필요는 없다 — No.26의 URL/헤더 가림과 다른 점).
- `LegacySurveyBadge`(§2.1)가 상단에 고정 노출된다.

### 전환 흐름(`ConvertLegacySurveyDialog`)

1. "설문 선택해 전환" 클릭 → 확인 대화상자: **"이전 형식의 설문 연결('{surveyId}')은 전환 후 사라집니다. 새로 설문을 선택해야 합니다. 계속하시겠습니까?"**(danger 톤은 아니고 INFO 톤 — No.26과 달리 잃을 시크릿이 없다, 기본 포커스 "취소").
2. 확인 → 이 아웃풋 카드가 §3.3의 `SurveyOutputEditorV2`로 **교체**되며, **빈 v2 초안**(`{ version: 2, surveyId: '' }`)으로 시작한다 — v1의 자유 문자열 키를 그대로 옮기지 않는다(자동 연결 금지, P-15).
3. 폼 상단에 1회성 안내: "설문을 선택하고 저장해야 이 아웃풋이 실행됩니다."
4. 전환은 **저장 전 클라이언트 상태 변경**일 뿐이다 — "취소" 버튼으로 폼 전체를 되돌리면 v1 카드로 복귀한다.
5. 전환하지 않고 v1 카드를 그대로 둔 채 다른 필드만 고쳐 저장을 시도하면 서버가 `400 SURVEY_OUTPUT_LEGACY_FORMAT`을 반환한다 → 폼 상단 배너("설문 연동을 새 방식으로 바꿔야…") + 해당 아웃풋 카드로 스크롤·포커스 이동 + "설문 선택해 전환" 버튼 강조(No.26 v1 카드 강조 패턴 재사용, §0-3).

### 노드 복사 시 안내

원본 노드가 v1 `SURVEY`를 가지고 있으면, 복사 성공 토스트 문구에 한 줄이 추가된다: **"'{원본명} (사본)'이 생성되었습니다. 새 노드는 비활성 상태입니다. (이전 형식 설문 연결 1개는 복사되지 않았습니다.)"**(FR-SV1-5, No.26 `copyExcludedLegacyApi` 패턴과 동일).

---

## 3.5 SV3 — 설문 결과 (`/chatbots/:chatbotId/dialogue/surveys/:surveyId/results`)

### 목적
`chatbot:read` 보유자(VIEWER 포함)가 참여 통계·문항별 분포·응답 목록을 보고 CSV로 내려받는다.

### 상태별 UI

| 상태 | UI |
|---|---|
| 초기 로딩(3개 API 동시 요청 — 요약/문항별/응답목록) | `SkeletonCard` × 6(요약), `SkeletonRow` × N(문항별·응답목록) — **독립적으로 로딩·완료**(`stats-learning-ui-spec.md` F-3과 같은 패턴) |
| 기간 상한 초과(`400 STATS_RANGE_TOO_WIDE`) | `GranularityPeriodControl` 하단 인라인 오류 + 카드/차트는 직전 값 유지 |
| **빈 상태 ①** — 기간 내 노출 0건(EX-SV-21) | 요약 카드는 전부 "0"(오류 아님), 비율은 "—". 문항별·응답목록 영역 `EmptyState`: "선택한 기간에 응답 기록이 없습니다." |
| **빈 상태 ②** — 기간이 설문 오픈 전(EX-SV-22) | `EmptyState`: "이 기간에는 설문이 노출되지 않았어요." + "설문 기간: {activeFrom}~{activeTo}" 보조 텍스트 |
| 5초 초과(`503 AGGREGATION_TIMEOUT`) | `ErrorState`: "집계에 시간이 오래 걸리고 있습니다. 기간을 좁혀 다시 시도해 주세요." |
| 오류 | `ErrorState` + 다시 시도 |

### 레이아웃 (데스크톱)

```
┌───────────────────────────────────────────────────────────────────────────┐
│ 대화설계 > 설문 > 배송 만족도            [기본 정보]  [결과]                │
├───────────────────────────────────────────────────────────────────────────┤
│ 단위 ●일 ○주 ○월   기간 [09/25]~[10/24]   채널[전체▾]  ☐ 중복 포함        │
├───────────────────────────────────────────────────────────────────────────┤
│┌────┐┌────┐┌────┐┌──────┐┌────────┐┌────┐                                │
││노출 ││시작 ││완료 ││중도이탈││미시작이탈││진행중│                                │
││1,240││610 ││512 ││88     ││3        ││10  │                                │
││    ││참여율││완료율││중도이탈률││          ││     │                                │
││    ││49.2%││41.4%││14.8%   ││          ││     │                                │
││    ││610/ ││512/ ││88/     ││          ││     │                                │
││    ││1,240││1,236││ 594    ││          ││     │                                │
│└────┘└────┘└────┘└──────┘└────────┘└────┘                                │
│ 중복 완료 7건(제외됨, "중복 포함" 체크 시 함께 표시)                        │
├───────────────────────────────────────────────────────────────────────────┤
│ 노출·시작·완료 추이                                         [표로 보기]    │
│ ⓘ 최근 30일간 노출은 32건에서 58건으로 상승했습니다.                       │
│  ▂▃▅▇█▆▅▇█▇▆▅                                                             │
├───────────────────────────────────────────────────────────────────────────┤
│ 문항별                                                                     │
│ Q1(척도·별점5) 도달 610 응답 580(95%) 건너뜀 0   평균 4.1점  [표로 보기]    │
│  ▇▇▇▇▇▇▇▇▁▁ 1점 3% 2점 5% 3점 12% 4점 38% 5점 42%                         │
│ Q2(다중 선택) 도달 571 응답 560 건너뜀 8(선택 합계 100% 초과 가능) [표보기] │
│  포장 62% 속도 40% 기사님 친절 35% 알림 18%                               │
│ Q3(자유 텍스트) 응답 203 건너뜀 309         [자유 응답 보기 →]             │
├───────────────────────────────────────────────────────────────────────────┤
│ 응답 목록                                    [CSV: 응답 원자료 ▾][집계 ▾] │
│ 상태 ☑전체 ☐완료 ☐진행중 ☐이탈  채널[전체▾]                              │
│ 응답번호  노출일시(KST)     상태     채널 완료일시      Q1  Q2      Q3     │
│ A1B2C3D4  09-24 10:02:13   완료 WEB 09-24 10:03:40  4점 포장,속도 마스킹…  │
│ B2C3D4E5  09-24 09:58:01   진행중 WEB —              5점 건너뜀   —       │
│ C3D4E5F6  09-24 09:40:22   완료(중복) WEB 09-24 09:41  3점 속도   —       │
│                                                          ◀ 1 2 3 ▶ 총 512건│
└───────────────────────────────────────────────────────────────────────────┘
```

### 컴포넌트 분해

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `GranularityPeriodControl` | `stats-learning-ui-spec.md` §2.4 그대로 재사용(일/주/월 + 기간, 상한 92/53/24 — 설계서 §9.2) |
| `SurveyMetricCardRow` | `SurveyStatsSummary.totals` → `MetricCard` 6장(노출/시작/완료/중도이탈/미시작이탈/진행 중), 각 캡션에 **분자/분모를 병기**(NFR-SVA3 — 비율은 스크린리더가 분수로도 읽을 수 있게). 분모 0이면 "—" |
| `SurveyDuplicateCaption` | `totals.duplicates` | "중복 완료 {n}건(제외됨)" + `includeDuplicates` 토글과 연동 |
| `ChartFrame`(노출·시작·완료 추이) | `stats-learning-ui-spec.md` §2.5 그대로 — `buckets[]`로 시계열, 표 보기 토글 |
| `SurveyQuestionStatCard` | `question: SurveyQuestionStats` | 유형별: 척도(막대 + 평균 + NPS + `SurveyLowSampleBadge`), 단일/다중(선택지별 막대 + "합계 100% 초과 가능" 캡션이 다중일 때만), 자유 텍스트(응답/건너뜀 수만 + "자유 응답 보기" 링크). `ChartFrame`으로 감싸 표 보기 토글 제공(NFR-SVA3 "같은 값의 표") |
| `SurveyTextAnswerListPanel` | `surveyId`, `questionKey` | `GET .../text-answers?questionKey=`, 페이지네이션(기본 50). 상단 `SurveyPiiNotice` 상시 노출. 항목: 응답 번호(자동 생성, `sessionId` 아님) · 노출 일시(KST) · 마스킹 텍스트 |
| `SurveyResponseFilterBar` | `status[]`, `channel?` |
| `SurveyResponseTable` | `items: SurveyResponseListItem[]` | 컬럼: 응답 번호(id 앞 8자, 대문자) · 노출 일시(KST, `formatDateTime` — `lib/date` 관례) · 상태/이탈 사유 + `SurveyDuplicateBadge`(있으면) · 채널 · 완료 일시 · 문항별 답(라벨·점수·마스킹 텍스트·`건너뜀`) — `sessionId`는 응답에 없으므로 화면에도 없다(FR-SV7-1) |
| `SurveyExportButtons` | `from`, `to`(필수 — 미지정이면 버튼 `aria-disabled` + "기간을 먼저 선택하세요"), `channel?`, `includeDuplicates` | 드롭다운 2개(또는 버튼 2개): "응답 원자료 CSV" / "문항별 집계 CSV". 클릭 → `GET .../responses/export?kind=…` → 응답 헤더 `X-Export-Truncated`가 `true`면 토스트: "최신 10,000건만 포함되었습니다 — 기간을 좁혀 다시 내려받으세요."(EX-SV-23) |

### 지표 표시 규칙(요구사항 §4.6.1 그대로 반영)

- **참여율** = 시작 ÷ 노출, **완료율** = 완료 ÷ (노출 − 진행 중), **중도 이탈률** = 중도 이탈 ÷ (시작 − 시작한 진행 중). 분모가 0이면 카드 값은 "—"이고 캡션에 "데이터 없음"을 병기한다(0으로 나누기 결과를 화면에 노출하지 않음).
- 모든 비율 카드는 **분자/분모를 캡션으로 함께 표시**한다(NFR-SVA3, 예: "610/1,240").
- `isDuplicate` 표시 방식: (1) 요약 카드 아래 `SurveyDuplicateCaption`으로 건수만 총량 표시 (2) 응답 목록 행에 `SurveyDuplicateBadge` (3) "중복 포함" 체크박스를 켜면 요약·문항별 집계 모두 `includeDuplicates=true`로 재조회(기본은 항상 제외) — 세 지점 모두 "중복은 기본적으로 통계에서 빠진다"는 같은 메시지를 색상 없이 텍스트로 반복한다.

---

## 3.6 SIM1-ext(SV) — 응답 테스트 "설문" 패널 (`SurveyPreviewToggle` / `SurveyStepPanel`)

`quality-channel-ui-spec.md` §4.1의 `TracePanel` 인근(메시지 입력 영역 위)에 `SurveyPreviewToggle`을, 시뮬레이션 응답에 `surveyStep`이 있을 때만 `TracePanel` 아래에 `SurveyStepPanel`을 노출한다.

### 레이아웃

```
설문 미리보기  ○끔(실제 상태·기간을 따름) ●켬(작성 중·마감·기간 외 설문도 진행)
   ⓘ 켜져 있어도 응답은 저장되지 않습니다.

사용자  4점
   봇  2/3 좋았던 점을 골라 주세요(여러 개면 번호를 쉼표로 입력해 주세요 — 예: 1,3)
       [1. 포장][2. 속도][3. 기사님 친절][4. 알림]
       [건너뛰기][그만하기]
       판정 근거 보기 ▾
       설문 단계 ▾
       └ 배송 만족도 · 2/3 · 판정: 응답(4점) · 저장되지 않음
```

- 기본은 `설문 미리보기` **꺼짐**(실제 대화와 동일하게 상태·기간을 따른다) — 아무것도 설정하지 않아도 안전하게 시험할 수 있다.
- 결과 패널에 `SurveyStepPanel`이 나타나면 항상 `SurveyPreviewSavedBadge`("저장되지 않음")를 붙인다(FR-SV9-3 — 판정된 값은 화면에 다시 보여주지 않는다, 원문 재노출 경로 없음).
- 비교 모드(SIM2)에는 이 토글이 없다 — 비교는 **항상** 설문 미리보기 판정(상태·기간 무시)이며, 그 사실을 결과 상단에 1줄 안내로 표시한다: "설문은 두 버전 모두 상태·기간과 무관하게 진행되어 비교되었습니다."(No.26의 `compareApiMockNotice`와 같은 위치·형식)

### 컴포넌트 분해(추가분)

| 컴포넌트 | props |
|---|---|
| `SurveyPreviewToggle` | `checked: boolean`, `onChange` — 라디오 2개(UIUX §6), 메시지 전송 전에 미리 지정하는 옵션(요청에 `surveyPreview`로 실림) |
| `SurveyStepPanel` | `step: SurveyStepView` — 접이식(`aria-expanded`), 기본 접힘. `TracePanel`과 동일한 토글 패턴. 표시: 설문명 · `{questionIndex+1}/{questionCount}` · `outcomes[]` 한국어 라벨(§8.4 매핑) · `reason?` · `SurveyPreviewSavedBadge` 상시 |

---

## 3.7 D1-ext(SV) — 설계 점검 패널 확장 (`DesignValidationPanel`)

`dialogue-design-ui-spec.md` §4.1.2의 기존 `DesignValidationPanel`(No.26이 11개를 추가해 갱신한 목록)에 아래 6개 코드가 같은 `DesignIssueRow` 형식으로 추가된다(설계서 §5.9).

| # | 코드 | 심각도 | 표시 문구 | 바로가기 |
|---|---|---|---|---|
| ① | `SURVEY_OUTPUT_NOT_LAST` | ⚠ 주의 | "설문 아웃풋 뒤에 다른 아웃풋이 있는 노드 N건 — 설문이 시작되면 뒤 아웃풋은 실행되지 않습니다(참여할 수 없을 때만 실행됩니다)" | 해당 노드 편집 |
| ② | `SURVEY_TERMINATOR_CONFLICT` | ✖ 오류 | "한 노드에 설문이 2개 이상이거나 설문과 폼 시작이 함께 있는 노드 N건 — 첫 종결자만 의미가 있습니다" | 해당 노드 편집 |
| ③ | `SURVEY_NOT_AVAILABLE` | ⚠ 주의 | "참조 설문이 작성 중·마감·기간 종료 상태인 노드 N건" | 해당 노드 편집 + "설문 편집으로 이동" |
| ④ | `SURVEY_ONLY_OUTPUT` | ⓘ 안내 | "노드 출력이 설문뿐인 노드 N건 — 설문을 진행할 수 없을 때 고정 안내 문구가 나갑니다" | 해당 노드 편집 |
| ⑤ | `SURVEY_LEGACY_FORMAT` | ⚠ 주의 | "이전 형식 설문 연결을 가진 노드 N건 — 설문 선택으로 전환이 필요합니다" | 해당 노드 편집 |
| ⑥ | `SURVEY_EMPTY` | ✖ 오류 | "참조 설문에 문항이 없는 노드 N건" | 해당 노드 편집 + "설문 편집으로 이동" |
| ⑦ | `BROKEN_REFERENCE`(기존 코드, 설문 대상 추가) | ✖ 오류 | "존재하지 않는 설문을 참조하는 노드 N건" | 해당 노드 편집 |

- `DesignValidationPanel`은 이미 `POST /dialog-nodes/validate` 결과를 통째로 받아 렌더링하므로 **화면 컴포넌트 변경은 없다** — 서버가 항목을 채워 보내는 것으로 충분하다(No.26 §3.5와 같은 원칙).
- `SURVEY_TERMINATOR_CONFLICT`(②)와 `SURVEY_EMPTY`(⑥)만 `ERROR`이고 나머지는 `WARNING`/`INFO`다.
- **v1 잔존 알림(FR-SV11-6)**: 설계 점검 요약 상단에 배포 직후 1회성 안내가 있으면(운영자 조회) "이전 형식 설문 연결 N건(노드) · 버전 M건" 텍스트를 그대로 노출한다 — 읽기 전용, 자동 변경 없음(No.26 `FR-L9-4`와 같은 패턴).

### 흐름 미리보기 확장 (`FlowPreviewPanel`)

`dialogue-design-ui-spec.md` §4.1.1의 트리에서, v2 `SURVEY`의 `onCompleteNodeId`가 가리키는 노드는 자식 항목으로 `via: 'SURVEY_COMPLETE'` 라벨("설문 완료 후 →")을 접두해 표시된다.

```
▾ 흐름 미리보기
  ▾ 배송완료_안내
    ▸ 설문 완료 후 → 추가문의_안내
```

이 변경으로 "완료 후 이동 노드로만 참조되는 노드는 고아가 아니다"(AC-SV1-6)가 화면에서도 자연히 드러난다 — 기존 `FlowPreviewPanel`이 서버가 채운 `surveyTargets`를 그대로 렌더링한다.

---

## 3.8 V4-ext(SV) — TC 실행 결과 배지 (`TestRunResultRow`)

`validation-regression-ui-spec.md` §4.4의 `TestRunResultRow`(기존 `unsupportedCountA>0이면 "일부 아웃풋 미실행" 배지 · `blockedByFilterA`면 "금지어로 차단된 응답" 배지)에 세 번째 배지를 추가한다.

- `surveyPreviewA`/`surveyPreviewB`가 true인 쪽에 `SurveyPreviewJudgmentBadge`("설문 미리보기 판정") — A/B 각각 독립 표시.
- **응답 해시 불연속 안내**(FR-SV9-6): 실행 비교(V5) 결과에서 A·B 중 한쪽만 설문이 개입했으면(`surveyPreviewA !== surveyPreviewB`) 상단에 1회성 안내: "설문 실행 방식이 달라 비교 결과가 달라질 수 있습니다."(No.26의 `apiMock` 안내가 있다면 같은 문단으로 통합 — 이번 세션 조사에서는 No.26의 해당 안내가 문서·코드 어디에도 확정 문구로 존재하지 않아, 이 문서가 최초로 문구를 확정한다. `frontend-implementer`가 No.26 쪽 문구를 나중에 추가할 때 이 문단에 합류시킨다.)
- `unsupportedCountA`는 `unsupportedOutputs` 기반이라 v2 `SURVEY`는 자동으로 빠진다(FR-SV9-5 — 이 화면의 코드 변경 없음).

---

## 3.9 L4-ext(SV) — 버전 복원 미리보기 경고 3종 확장

`version-history-ui-spec.md`의 `RestoreWarningList`(No.26이 3종을 더해 14종이 된 목록)에 아래 3종이 추가되어 **17종**이 된다(설계서 §16).

| `code` | 문구 |
|---|---|
| `SURVEY_MISSING` | "대상 버전의 노드가 존재하지 않는 설문을 참조합니다(복원 후 실행 시 설문을 건너뜁니다)." |
| `SURVEY_NOT_OPEN` | "대상 버전의 노드가 작성 중이거나 마감된 설문을 참조합니다(복원 후 오픈해야 실행됩니다)." |
| `SURVEY_LEGACY_FORMAT` | "대상 버전에 이전 형식 설문 연결이 포함되어 있습니다(복원해도 실행되지 않습니다)." |

- 셋 다 `blocker`가 아니다(복원을 막지 않음) — 기존 `RestoreWarningList`와 같은 시각 규칙(아이콘+텍스트, 색상 단독 금지).
- 예약 배포(No.28)의 준비도 경고는 `versionRestore.preview()`를 재사용하므로 **추가 화면 변경 없이 자동으로** 이 3종을 포함한다(FR-SV10-4).
- 버전 목록의 "⚠ 참조 경고 N건" 요약에도 이 3종이 합산된다(별도 UI 아님, 기존 카운트에 흡수).

---

## 3.10 위젯 문항 표시 규격 (서버 문구 — `apps/widget` 코드 변경 0건)

이 절은 **backend-implementer 인계용 문구 명세**다. 위젯은 서버가 조립한 `TEXT`/`BUTTON` 아웃풋을 그대로 렌더링하며, 신규 렌더러·CSS·JS 변경이 **없다**(J-7). 모든 문구는 `packages/dialogue-engine/src/constants.ts`(설계서 §5.10)와 `buildSurveyQuestionOutputs()`(§5.11)가 조립하며, `UIUX_준수기준.md` §4(§6 참고)의 기준을 충족하도록 ui-designer가 검토·확정했다.

### 3.10.1 문항 출력 형태

- **진행 표시**: 문항 TEXT의 첫 줄은 항상 `"{n}/{N} {문항 문구}"` 형태다(예: "1/3 배송 속도는 어떠셨나요?"). 스크린리더가 "1/3"을 문항 문구보다 먼저 읽어 "몇 번째 문항인지"를 먼저 전달한다(NFR-SVA4).
- **버튼 5개 단위 분할**: 선택지(또는 척도 값) + 제어 버튼(건너뛰기·그만하기)을 합쳐 5개씩 잘라 최대 3블록으로 나눈다. 예시:

  | 문항 | 총 버튼 수 | 블록 분할 |
  |---|---|---|
  | 단일 선택 8지 | 8 + `그만하기` = 9 | 5·4 |
  | 다중 선택 4지(선택) | 4 + `건너뛰기` + `그만하기` = 6 | 5·1 |
  | 척도 `STAR_5` | 5 + `그만하기` = 6 | 5·1 |
  | 척도 `NPS_11`(0~10) | 11 + `그만하기` = 12 | 5·5·2 |

  6번째 선택지부터 버튼이 사라지는 기존 컨텍스트 폼 결함(`context-session.ts:116`)은 설문에 **전파하지 않는다** — 설문은 이 자체 분할 로직을 쓴다(K-6, 별도 과제로 기록됨).
- **버튼 라벨**: 단일 선택 = 선택지 라벨 그대로. 다중 선택 = `"{번호}. {라벨}"`(40 코드 포인트 초과 시 `…`로 절단, 값 자체는 자르지 않음). 척도 `STAR_5` = `"{점수}점"`(양끝 값에는 라벨 병기 — 예: `"1점 매우 불만족"`, `"5점 매우 만족"`), `STAR_5` 가운데 값은 숫자만(별 기호 단독 사용 금지, NFR-SVA4). `NPS_11` = `"{점수}"`(0·10 양끝에 라벨 병기).
- **다중 선택 입력 안내**: 문항 TEXT 두 번째 줄에 `"여러 개면 번호를 쉼표로 입력해 주세요 (예: 1,3)"`를 고정 삽입한다.
- **제어 버튼**: 선택(비필수) 문항에는 `건너뛰기`, 모든 문항에는 `그만하기`를 항상 마지막 블록에 둔다. 자유 텍스트 문항은 선택지 버튼이 없고 필수가 아니면 `건너뛰기` + `그만하기`만 있는 1블록.

### 3.10.2 고정 문구(서버 상수, 최종 확정)

| 상황 | 문구 |
|---|---|
| 이미 참여함(재노출 건너뜀 후 다른 출력 0건) | "이미 설문에 참여해 주셨어요. 감사합니다." |
| 참여 불가(작성 중·마감·기간 밖 등, 다른 출력 0건) | "지금은 참여할 수 있는 설문이 없어요." |
| 취소어·`그만하기` | "설문을 마칠게요. 참여해 주셔서 감사합니다." |
| 재시도 상한 초과(3번째 실패) | "입력 횟수를 초과해 설문을 마칠게요. 궁금한 점을 입력해 주세요." |
| 타임아웃 | "설문 참여 시간이 지나 설문을 마쳤어요." |
| 마감·구조 변경 중 진행 | "설문이 변경(종료)되어 진행을 마쳤어요." |
| 필수 문항 건너뛰기 시도 | "이 질문은 꼭 답해 주세요." |
| 완료(기본값, 관리자가 설문별로 수정 가능) | "설문에 참여해 주셔서 감사합니다." |

### 3.10.3 문항 유형별 재질문 안내(판정 실패 시, 값은 실제 문항 설정으로 치환)

| 유형 | 안내 문구 |
|---|---|
| 단일 선택 | "제시된 보기 중에서 골라 주세요. (예: 1 또는 '{첫 선택지 라벨}')" |
| 다중 선택 | "번호를 쉼표로 구분해 {minSelect}~{maxSelect}개 골라 주세요. (예: 1,3)" |
| 척도 `STAR_5` | "1~5 사이의 숫자로 답해 주세요. (예: 4)" |
| 척도 `NPS_11` | "0~10 사이의 숫자로 답해 주세요. (예: 8)" |
| 자유 텍스트(글자 수 초과) | "{maxLength}자 이내로 입력해 주세요." |
| 자유 텍스트(빈 입력) | "답변을 입력해 주세요." |

- 모든 안내는 **"무엇이 잘못됐는지 + 어떻게 고치는지"**를 함께 담는다(UIUX §7과 같은 원칙을 위젯 텍스트에도 적용).
- 취소어는 설문별 `cancelKeywords`(기본 `그만`·`취소`·`설문 종료`)이며 **정규화 전체 일치**로만 판정된다 — 자유 텍스트 응답 중간에 "그만"이 포함돼도 취소로 오판하지 않는다(설계서 §22 D-3).

---

## 4. 사용자 인터랙션 흐름 (제출 → 로딩 → 결과, 오류 처리)

### 4.1 설문 만들기 → 오픈 → 노드 연결 (S-6·S-7)

```
SV1 "+ 설문 추가" → SV2(신규, DRAFT)
  → 이름/문항 3개(척도 필수·다중선택 1~3개·자유텍스트 선택) 입력
  → [미리보기]에서 위젯 모양(텍스트+버튼) 확인, 샘플 "4점" 입력 시험
  → [저장] → 201 → SV1로 복귀, 목록에 "작성 중" 배지로 표시
  → SV1에서 [오픈] 클릭 → 오픈 검증 통과 → "진행 중" 배지
  → D1b 노드 편집 > 아웃풋 추가 > 유형 "설문" 선택
  → SurveyPickerField에서 "배송 만족도" 검색·선택 → 상태 배지 "진행 중 · 문항 3개" 표시
  → 완료 후 이동 노드 "추가문의_안내" 선택 → [저장] → 200
  → D1 [설계 점검] → 이상 없음(참조 설문 OPEN, 문항 ≥1)
```

### 4.2 응답이 달린 설문 수정 (S-8)

```
SV2에서 "배송 만족도" 편집 진입 → 상단 SurveyStructureLockBanner("응답 43건…") 노출
  → Q2에 선택지 "가격" 추가 시도 → [+ 선택지] 버튼이 disabled(사유: "응답이 있어 바꿀 수 없어요")
  → 대신 선택지 "기사님 친절"의 라벨을 "기사님 응대"로 수정(활성) → [저장]
  → 200 → 토스트 + 배너: "문구를 바꾸면 이전 응답과 의미가 달라질 수 있습니다."
  → SV1에서 [복제] → "배송 만족도 (사본)"이 DRAFT로 생성 → SV2(사본)로 이동
  → 구성을 자유롭게 변경(잠금 없음) → 노드 연결은 D1b에서 수동으로 다시 지정
```

### 4.3 공개 대화 — 설문 완주 (S-1)

```
사용자가 위젯에서 "배송 조회해줘" 입력 → 노드 매칭 → "배송이 완료되었어요." + 설문 소개 + 1/3 문항
  → (사용자 화면에는 별도 "적재 중" 표시 없음 — 같은 응답 안에서 문항이 나온다)
  → "4점" 클릭 → 2/3 문항 즉시 표시(엔진이 판정 후 다음 문항까지 한 응답)
  → "1,3" 입력 → 3/3 자유 텍스트 문항
  → "포장이 꼼꼼했어요" 전송 → 완료 문구 + 추가문의_안내 노드 출력
  → SV3(결과)에서 잠시 후 노출/완료 수 +1 반영(별도 새로고침 필요 — 실시간 갱신 아님, 설계서 §9 캐시 없음이라 재조회 시 즉시 반영)
```

### 4.4 잘못된 답 → 재시도 초과 (S-2)

```
척도 문항에서 "괜찮았어요" 입력 → 재질문("1~5 사이의 숫자로 답해 주세요. (예: 4)")
  → 다시 "괜찮았어요" → 재질문(2번째)
  → 세 번째도 실패 → "입력 횟수를 초과해 설문을 마칠게요. 궁금한 점을 입력해 주세요."
  → SV3 응답 목록에 해당 응답 "이탈(재시도 초과)" 상태로 표시
```

### 4.5 방치 후 타임아웃 (S-4)

```
Q2에서 40분간 방치(타임아웃 30분) → "환불 방법 알려줘" 입력
  → "설문 참여 시간이 지나 설문을 마쳤어요." 1줄 + 환불 안내(일반 대화 경로로 처리)
  → SV3에서 조회 시점에 해당 응답이 "미완료 + 타임아웃 경과" → 중도 이탈로 집계(배치 없음, 조회할 때마다 재판정)
```

### 4.6 설문 결과 조회 → CSV 내려받기 (S-9·S-10)

```
SV2 "결과" 탭 클릭 → SV3 기본 기간(최근 30일) 조회 → 요약 카드 + 문항별 카드
  → 기간을 09/01~10/24로 확장 → 재조회 → 노출 1,240 확인
  → 응답 목록에서 채널 "WEB"만 필터 → 재조회
  → [응답 원자료 CSV] 클릭 → 기간 이미 지정돼 있어 즉시 다운로드
  → (기간이 12,000건 규모였다면) X-Export-Truncated 헤더 확인 → 토스트 "최신 10,000건만 포함…"
```

### 4.7 시뮬레이터 — 설문 미리보기 (S-11)

```
시뮬레이터에서 S-1 재현 시도 → 설문이 DRAFT라 진행되지 않고 "지금은 참여할 수 있는 설문이 없어요" 응답
  → SurveyPreviewToggle을 "켬"으로 전환 → 같은 메시지 재전송
  → 설문 진행됨 → SurveyStepPanel: "배송 만족도 · 1/3 · 판정: 시작 · 저장되지 않음"
```

### 4.8 버전 복원 — 설문 삭제 후 (S-9 변형)

```
SV1에서 설문 "이벤트 설문"(노드 참조 제거 후) 삭제 → 204
  → 버전 이력 화면 > 과거 버전 v8 "복원" → RestoreDialog
  → RestoreWarningList에 "대상 버전의 노드가 존재하지 않는 설문을 참조합니다…"(SURVEY_MISSING) 노출(blocker 아님)
  → [복원] 진행 → 복원 완료 → 해당 노드는 설문을 건너뛰고 다음 아웃풋을 실행
```

---

## 5. 권한별 UI 변화 규칙

신규 권한 문자열은 0종이다(J-15). 기존 권한의 적용 지점만 다음과 같이 넓어진다.

| 화면/요소 | VIEWER | EDITOR | ADMIN |
|---|---|---|---|
| SV1 목록 조회 | 조회만(`dialogue:read`) — 케밥 메뉴 자체가 숨김(읽기 전용) | 전체 가능(`dialogue:write`) | 좌동 |
| SV2 편집기 진입 | 읽기 전용(폼 필드 전부 `disabled`, "결과" 탭은 활성) | 편집 가능 | 편집 가능 |
| SV2 "결과" 탭 → SV3 | 조회 가능(`chatbot:read`) | 조회 가능 | 조회 가능 |
| D1b `SurveyPickerField`(선택 목록) | 조회만 가능(`dialogue:read`) | 선택·저장 가능(`dialogue:write`) | 좌동 |
| D1b 설문 v2 폼 전체 | 읽기 전용(기존 `DialogNodeForm`의 읽기 전용 규칙 상속) | 편집 가능 | 편집 가능 |
| `SurveyPreviewPanel`(편집기 미리보기) | 조회 가능(순수 클라이언트 연산, 쓰기 아님) | 가능 | 가능 |
| SIM1 `SurveyPreviewToggle`/`SurveyStepPanel` | 가능(`simulation:read`, 저장 0이라 새 위험 없음) | 가능 | 가능 |
| SV3 CSV 내보내기 | 가능(`chatbot:read`) | 가능 | 가능 |
| L4 복원 경고 3종 | 복원 자체가 `dialogue:write`+`chatbot:write` 필요이므로 VIEWER는 복원 대화상자 진입 불가(기존 규칙 상속) | 조건 충족 시 가능 | 가능 |

`DialogueShell`(§0-3)의 `SUBNAV_ITEMS` 배열에 `'surveys'`를 6번째로 추가한다 — 서브내비 링크는 권한과 무관하게 항상 노출되며(다른 5개 항목과 동일 — `dialogue:read`만 있으면 조회 가능한 화면 구조), 쓰기 액션만 `dialogue:write`로 게이팅된다.

---

## 6. `UIUX_준수기준.md` 체크리스트 매핑

### 6.1 공통(이 그룹 신규/확장 화면 전체)

| 기준 | 항목 | 적용 |
|---|---|---|
| §1 색상대비 | 색상 단독 금지 | §2.1의 모든 배지(`SurveyStatusBadge`·`SurveyLockedBadge`·`LegacySurveyBadge`·`SurveyDuplicateBadge` 등)가 아이콘/텍스트 병기. `SurveyLowSampleBadge`는 항상 "표본이 적습니다" 텍스트를 동반 |
| §2 타이포그래피 | 본문 16~17px 이상 | 설문 편집기·결과 화면 전 텍스트 기존 폰트 크기 상속(신규 규칙 없음) |
| §3 키보드접근성 | Tab/Enter/Space, Esc+포커스복귀 | `SurveyPickerField`(콤보박스, `ResourcePickerField` 패턴 상속), `SurveyQuestionListEditor`/`SurveyChoiceListEditor`(전부 `ReorderableList` — 드래그 없음, 위/아래 버튼만), `ConvertLegacySurveyDialog`(모달, 기본 포커스 "취소") — **AC-SV7-1**(키보드만으로 설문 생성 → 문항 순서 변경 → 오픈 → 노드 연결 완주)의 전제 |
| §4 버튼 | 동사형, 44×44px, 중복 실행 방지 | "설문 추가"/"문항 추가"/"선택지 추가"/"복제하기"/"마감하기", 저장·오픈 버튼은 요청 중 `disabled`(연타 방지). **대화형 설문 문항 표시 원칙**(UIUX §4 신규 보강)이 §3.10의 진행 표시·텍스트 라벨 버튼·그만하기 상시 제공 규칙의 근거다 |
| §5 텍스트입력필드 | 레이블 필수, 글자수 카운터, 복사·붙여넣기 제한 금지 | 이름(50자)·설명(300자)·문항 문구(300자)·선택지 라벨(40자)·자유 텍스트 `maxLength`(500자) 등 전 필드 `<label htmlFor>` + 카운터 |
| §6 폼 컨트롤 | 단일선택=라디오/셀렉트, 다중선택=체크박스 | 문항 유형(셀렉트 4종)·척도 종류(라디오 2종)·`SurveyPreviewToggle`(라디오 2종)·상태 필터(체크박스)·`required`(체크박스) |
| §7 오류 메시지 | 원인+해결방법 | `SURVEY_STRUCTURE_LOCKED`("응답이 있는 설문은…복제해서 새 설문을 만드세요") · `SURVEY_HAS_RESPONSES`("마감하면 더 이상 응답을 받지 않습니다") · 오픈 검증 `details[]` 전부 "무엇이 문제고 어디서 고치는지" 텍스트 |
| §8 로딩/상태 | 스켈레톤/스피너, 완료 배지, 부분 정정 상태 안내 | SV3의 3개 API 독립 로딩(§3.5), 요약 카드는 0건도 "정상 완료"로 표시, CSV `X-Export-Truncated` 안내(빈 데이터처럼 보이게 두지 않음) |
| §9 내비게이션 | href 기반, 페이지네이션 이중 표시 | `DialogueShell` 서브내비(`<NavLink>`), SV1/SV3 `Pagination` 재사용 |

### 6.2 화면별 특기 사항

| 화면 | 항목 | 지점 |
|---|---|---|
| SV2 | §6(문항 유형 전환은 자동 제출이 아님) | 유형 셀렉트 변경은 하위 서브폼만 바꿀 뿐 저장 요청을 보내지 않는다 |
| SV2 | §5(글자 수 카운터) | 자유 텍스트 `maxLength` 필드 — 관리자가 설정하는 상한 자체에도 카운터가 있고, 위젯 응답 입력에도 "n/{maxLength}자" 규칙이 적용됨을 §3.10에서 명시 |
| SV3 | §1(제안-자산 시각적 분리 원칙의 변형) | `SurveyDuplicateBadge`가 붙은 응답 행은 통계에서 제외됨을 텍스트로 병기 — "확정 자산(통계 포함) vs 제외 대상(중복)"을 시각적으로 구분 |
| D1a-v2(SV) | §7(조건부 종결 안내) | `SurveyOutputTerminalHint`가 API 조건분기와 달리 "설문이 시작되면"이라는 조건을 명시(§3.3) |
| D1a-v1(SV) | §1(색상 단독 금지) | `LegacySurveyBadge` 주황 배경 + "이전 형식" 텍스트 |
| SIM1-ext(SV) | §8(비동기 대기 패턴 재확인) | 설문 진행도 공개 대화와 동일하게 **한 응답으로 완결**되므로(정지점 미사용, J-4) `nlu-rag-answering-ui-spec.md`의 PENDING류 패턴은 필요 없다 — 기존 "응답 생성 중" 표시로 충분 |
| L4-ext(SV) | §1(경고 아이콘+텍스트) | 기존 `RestoreWarningList` 규칙 그대로 상속, 신규 3종도 동일 컴포넌트 재사용 |

### 6.3 자동화 연계

`AC-SV7-1`(키보드만으로 설문 생성→순서 변경→오픈→노드 연결 완주), `AC-SV7-2`(신규 화면 3종 axe 대비 위반 0건, 차트마다 표), `AC-SV7-3`(위젯 스크린리더 읽기 순서 — n/N → 문항 문구 → `1점 매우 불만족` 순)은 `test-automation` 검증 대상이며, 이 문서의 `SurveyQuestionListEditor`/`SurveyChoiceListEditor`(모두 `ReorderableList` 계열)·`ChartFrame` 재사용이 그 전제 조건이다.

---

## 7. 반응형 고려사항

브레이크포인트는 선행 문서들과 동일(데스크톱 ≥1024px / 태블릿 640~1023px / 모바일 <640px, `chatbot-operations-ui-spec.md` §8 기준 상속).

| 브레이크포인트 | 레이아웃 변화 |
|---|---|
| 데스크톱(≥1024px) | SV1: 목록 표 전 열 노출. SV2: 기본 정보 2열(좌: 이름·설명·기간, 우: 소개·완료 문구·취소어·타임아웃) + 문항 카드는 전체 폭 스택, 미리보기는 우측 사이드 패널(고정 폭 360px) 또는 하단(공간에 따라 선택, 하단을 기본으로 권고). SV3: 요약 카드 6장 가로 1줄, 문항별 카드 2열 |
| 태블릿(640~1023px) | SV1: "최근 30일" 열을 이름 아래 보조 텍스트로 이동. SV2: 완전 세로 스택, 미리보기는 접이식(기본 펼침). SV3: 요약 카드 3열 줄바꿈, 문항별 카드 1열 |
| 모바일(<640px) | SV1: 표 대신 카드 리스트(`SurveyCard` — 이름+상태배지+기간을 라벨-값 스택, 액션은 카드 하단 버튼). SV2: 전체화면 폭, 미리보기는 접이식 기본 접힘(공간 절약), 문항 카드 내부 필드도 세로 스택. SV3: 요약 카드 세로 스택, `ChartFrame`이 기본값을 **표 보기**로 전환(좁은 화면 막대 차트 가독성 저하 대응), 응답 목록은 표 대신 카드 리스트(응답번호/상태/문항 답을 라벨+값 스택). 모든 클릭 요소 44×44px 이상(§4) |

공통 원칙: `ReorderableList` 계열(문항·선택지·취소어)은 모바일에서도 위/아래 버튼을 유지하고 드래그로 대체하지 않는다(선행 문서 §7 원칙 재확인). 텍스트 영역(문항 문구·소개·완료 문구)은 모든 폭에서 컨테이너 전체 너비를 쓴다(UIUX §5).

---

## 8. `messages.ts` 추가 문구 키 목록

`apps/web/src/constants/messages.ts`에 아래를 추가한다. 값은 이 문서의 인용 문구를 초안으로 삼는다.

### 8.1 신규 네임스페이스 `MESSAGES.surveys`

```
pageTitle, searchLabel, filterStatusLabel, addButton, addButtonLimitReached,
columnName, columnStatus, columnPeriod, columnQuestionCount, columnReferencing, column30d,
statusDraft, statusOpen, statusClosed, statusOutOfPeriod, lockedBadge,
emptyTitle, emptyDesc,
openAction, closeAction, copyAction, deleteAction, editAction, viewAction,
openValidationFailedBanner, statusChangeSuccess,
deleteConfirmTitle, deleteConfirmDesc, deleteInUseBanner(count), deleteInUseItem(nodeName),
deleteHasResponsesBanner, closeInstead,
copySuccess, copyNoticeConnectionsCleared,
pickerNoResult(query), pickerCreateLink, pickerCreateHint, pickerDisabledSuffix,
formNameLabel, formDescriptionLabel, formStatusLabel, formPeriodLabel,
formIntroLabel, formCompletionLabel, formCancelKeywordsLabel, formCancelKeywordsHint,
formTimeoutLabel, formTimeoutRetroactiveHint,
structureLockBanner(count), structureLockedFieldHint, structureLockedSaveError,
textEditedWithResponsesBanner,
questionsTitle, addQuestion, addQuestionMax, questionTypeLabel,
questionTypeSingle, questionTypeMulti, questionTypeScale, questionTypeText,
questionPromptLabel, questionRequiredLabel,
choicesTitle, addChoice, choiceLabelPlaceholder,
minSelectLabel, maxSelectLabel,
scaleKindLabel, scaleStar5, scaleNps11, scaleLowLabelField, scaleHighLabelField,
maxLengthLabel, piiNotice,
previewTitle, previewQuestionNav(current, total), previewTestInputLabel, previewTestButton,
previewResultSuccess(value), previewResultRetry(guidance),
saveSuccess, duplicateName, cancel, save,
resultsTabLabel, basicInfoTabLabel,
onCompleteNodeLabel, onCompleteNodeHelp,
```

### 8.2 신규 네임스페이스 `MESSAGES.surveyResults`

```
title,
filterPeriodLabel, filterChannelLabel, filterChannelAll, includeDuplicatesLabel,
rangeTooWide, aggregationTimeout,
emptyNoExposure, emptyBeforeOpen(activeFrom, activeTo),
metricExposed, metricStarted, metricCompleted, metricAbandonedAfterStart,
metricAbandonedBeforeStart, metricInProgress,
captionParticipationRate, captionCompletionRate, captionDropoutRate,
duplicateCaption(count),
trendTitle,
questionStatTitle(index, prompt), reachedLabel, answeredLabel, skippedLabel,
averageLabel, npsLabel, lowSampleBadge, multiSelectCaption,
textAnswerLinkLabel, textAnswerListTitle,
responseListTitle, columnResponseNo, columnExposedAt, columnStatus, columnChannel,
columnCompletedAt, columnAnswer, skippedCellLabel, notReachedCellLabel,
duplicateBadge, duplicateBadgeHint,
statusCompleted, statusInProgress, statusAbandoned,
exportRawButton, exportSummaryButton, exportPeriodRequiredHint, exportTruncatedNotice,
```

### 8.3 기존 `MESSAGES.dialogue.subNav` 네임스페이스 추가

```
surveys: '설문',
```

### 8.4 기존 `MESSAGES.dialogue.outputTypes` 갱신

```
SURVEY: '설문',   // 기존 '설문 연동'에서 변경(FR-SV11-4)
```

### 8.5 기존 `MESSAGES.dialogue.outputFields` 네임스페이스 추가

```
surveyLabel, surveyHelp,
surveyStatusHintPrefix, surveyNotAvailableHint(statusLabel),
onCompleteNodeLabel, onCompleteNodeHelp,
surveyEditLink,
surveyOutputTerminalHint,
legacyBadgeLabel, legacyIdReadonlyLabel,
convertButton, convertConfirmTitle, convertConfirmDesc, convertStartedHint,
saveBlockedLegacyFormat,
copyExcludedLegacySurvey(count),
```
(기존 `surveyId` 키는 v1 읽기 전용 카드에서도 더 이상 라벨로 쓰지 않고 `legacyIdReadonlyLabel`로 대체한다 — v1 카드는 "설문 ID" 대신 "설문 ID(읽기 전용)"으로 표기)

### 8.6 기존 `MESSAGES.simulator` 네임스페이스 추가

```
surveyPreviewLabel, surveyPreviewOff, surveyPreviewOn, surveyPreviewHint,
surveyStepTitle, surveyStepProgress(current, total),
surveyStepOutcome: { STARTED, ANSWERED, RETRY, SKIPPED_QUESTION, COMPLETED, ABANDONED, SKIPPED_OUTPUT, NOT_STARTED },
surveyStepSavedBadge,
compareSurveyPreviewNotice,
```

### 8.7 기존 `MESSAGES.validation.result` 네임스페이스 추가

```
surveyPreviewBadge,
surveyHashDiscontinuityNotice,
```

### 8.8 기존 `MESSAGES.versions.warnings` 네임스페이스 추가

```
SURVEY_MISSING: (n: number) => `대상 버전의 노드가 존재하지 않는 설문을 참조합니다(복원 후 실행 시 설문을 건너뜁니다).`,
SURVEY_NOT_OPEN: (n: number) => `대상 버전의 노드가 작성 중이거나 마감된 설문을 참조합니다(복원 후 오픈해야 실행됩니다).`,
SURVEY_LEGACY_FORMAT: (n: number) => `대상 버전에 이전 형식 설문 연결이 포함되어 있습니다(복원해도 실행되지 않습니다).`,
```

---

## 9. `frontend-implementer` 인계 메모

1. **`ResourcePickerField`에 `'survey'` 타입 추가가 선행 작업**이다(§2.2) — `chatbotId` 필요(전역 자원인 `apiConnection`과 다름), `GET /chatbots/:chatbotId/surveys?q=` 연동. 옵션 표시는 현재 코드 관용구(순수 텍스트 접미, JSX 배지 아님)를 따른다 — `apiConnection` 타입이 "(사용 중지)" 접미사를 쓰는 것과 같은 방식으로 "· 상태 · 문항 N개"를 이름 뒤에 붙인다.
2. **구현 순서 권고**: ① `DialogueShell` 서브내비에 `surveys` 추가(독립적, 가장 먼저) → ② SV1 목록 → ③ `ResourcePickerField` `survey` 확장 → ④ D1b `SurveyOutputEditorV2` + v1 읽기전용 카드·전환 다이얼로그(§3.3~3.4, `API_CONDITION` v1/v2 분기 425~468행을 그대로 본뜬다) → ⑤ SV2 편집기(가장 복잡 — 문항 4유형 서브폼 + 구조 잠금 + 미리보기) → ⑥ SV3 결과 화면(`MetricCard`/`ChartFrame` 재사용) → ⑦ 설계 점검·흐름 미리보기 확장(서버 응답 필드만 늘어남, 컴포넌트 변경 최소) → ⑧ SIM1 `SurveyPreviewToggle`/`SurveyStepPanel` → ⑨ V4/L4 확장(배지 1개, 목록 3종 추가 — 독립적, 가장 나중이어도 무방).
3. **PATCH의 key 보존이 가장 위험한 지점이다(§3.2 "PATCH 시 key 보존 UX")** — 서버는 `questions` 배열을 전체 교체로 받고 key 유무로 구조 변경을 판정한다. 폼 상태 타입에 `key?: string`을 두고, 사용자에게는 노출하지 않되 저장 payload 조립 시 그대로 실어 보내는 구현을 반드시 단위 테스트로 확인할 것(문구만 고쳤는데 `structureVersion`이 오르면 결함).
4. **v2 설문 편집 UI는 API 조건분기 v2(`ApiConditionEditorV2`)의 구조 패턴을 최대한 재사용**한다 — 특히 `SurveyPickerField`는 `ApiConnectionPickerField`와 거의 동일한 모양이며, v1 카드·전환 다이얼로그는 No.26의 `LegacyApiConditionReadonlyCard`/`ConvertLegacyApiConditionDialog`를 이름만 바꿔 복제하는 수준으로 구현 가능하다.
5. **`SurveyPreviewPanel`(편집기 미리보기)은 `packages/shared-types/src/survey-logic.ts`를 `apps/web`에서 직접 import**하는 것을 전제로 설계했다(zod 무의존, `ApiConditionPreviewPanel`이 `api-mapping.ts`를 import하는 선례와 동일). backend-implementer 산출물에 Node 전용 심볼이 섞이지 않았는지 착수 전 재확인할 것.
6. **SV3의 지표 조립은 전부 서버 값을 그대로 표시**한다 — 참여율·완료율·중도 이탈률·NPS·평균은 프런트에서 재계산하지 않는다(`stats-learning-ui-spec.md`의 `ChartFrame.summary` 조립 규칙과 같은 원칙: 표시 문구 조립은 허용, 새 집계는 금지).
7. **위젯(§3.10)은 백엔드 상수 문구다** — `apps/widget` 코드·CSS·`messages.ts` 어디에도 이 문구를 위한 키를 추가하지 않는다. 위젯은 서버가 만든 `TEXT`/`BUTTON` 아웃풋을 기존 렌더러로 그대로 그릴 뿐이다.
8. **`DialogOutputEditor.tsx:126`(또는 이관된 위치)의 `isUnsupportedOutput()` 판정**은 이미 공용 함수를 쓰고 있으므로(No.26에서 정리됨) 이번 그룹은 그 함수의 서버 쪽 확장(v1 SURVEY 분기)만 기다리면 된다 — 프런트 쪽 배지 로직 변경은 없다.
9. **DialogueShell 서브내비 6번째 추가 시 `AC-C-3`(최상위 라우트 6개 고정)와의 충돌 여부를 `code-reviewer`/`test-automation` 단계에서 재확인**한다 — 서브내비는 최상위 라우트가 아니므로 이론상 문제가 없으나, 관련 시험이 서브내비 항목 수까지 단언하고 있다면 함께 갱신해야 한다.
10. **개인정보 마스킹 표시(SV3 응답 목록·자유 응답 목록)는 서버가 이미 마스킹한 값을 그대로 렌더링**한다 — 클라이언트가 다시 마스킹하지 않는다(이중 마스킹 버그 주의, No.26 §9-7과 동일한 주의).

---

## 10. 다른 설계 문서 갱신 사항 (이번 세션에 함께 반영)

| 문서 | 위치 | 반영 내용 |
|---|---|---|
| `docs/03-design/dialogue-design-ui-spec.md` | §0.1·§0.2·§1·§3·§4.2.1 ⑪행 | 서브내비 6번째 항목 `설문`(`surveys`) 추가 + "설문 연동 ▥" 행을 이 문서를 가리키도록 갱신(§11 참고) — No.26이 ⑫행(API 조건분기)에 적용한 것과 동일한 패턴 |
| `docs/03-design/UIUX_준수기준.md` | §4(버튼, 보강) | "대화형 설문 문항 표시 원칙"(진행 표시 n/N · 텍스트 라벨 버튼 · 그만하기 상시 제공) 1개 항목 최소 추가 — 근거는 이 문서 §3.10 |

## 11. `dialogue-design-ui-spec.md` §4.2.1 ⑪행 갱신 내용

> | ⑪ | 설문 ▥ | **[No.27 갱신, 2026-09-24]** 이 행은 이제 **v1(이전 형식) 노드의 읽기 전용 표시**만 설명한다. 필드: 설문 ID(읽기 전용, 자유 문자열). 쓰기 입력은 없다. | — (읽기 전용 카드라 포커스 이동 대상 없음) | `LegacySurveyBadge`("이전 형식 — 실행되지 않습니다. 설문을 선택해 전환하세요") + `설문 선택해 전환` 버튼(§3.4). **v2(설문 참조 기반) `설문` 편집 폼은 이 표의 대상이 아니다** — 신규 폼(설문 선택기·완료 후 이동 노드·상태/기간 안내)은 `docs/03-design/survey-management-ui-spec.md` §3.3(`SurveyOutputEditorV2`)에서 정의한다. 그 폼에는 자유 문자열 입력 필드가 없다 |

(실제 파일 반영은 `docs/03-design/dialogue-design-ui-spec.md`에 이미 적용했다 — §10 참고.)
