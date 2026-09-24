# 레거시 API 연동 (No.26) — 화면 설계서

> **대상 기능**: No.26 레거시 API 연동 — 대화 노드의 `API_CONDITION` 아웃풋이 관리자가 등록한 **연결(`ApiConnection`)** 로 GET/POST를 호출하고, 응답 경로 값으로 **같은 턴의 분기·텍스트 치환**을 수행한다.
> **입력 문서**: `docs/requirements/legacy-api-integration.md`(J-1~J-20, FR-0-96~105, FR-L1-\*~FR-L9-\*, NFR-LP/LS/LA/LM, PM 결정 P-1~P-15 §11), `docs/02-spec/legacy-api-integration-설계.md`(§3 데이터모델, §4 스키마, §7 외부호출, §10 권한, §12 API 계약, §15 버전/예약배포, §16 관리자 콘솔 인계), `docs/02-spec/decisions/ADR-0034-legacy-api-connection-registry-and-engine-suspension.md`
> **준수 기준**: `docs/03-design/UIUX_준수기준.md`(전 항목 — 이번 작업에서 신규 보강 없음, §12 참고)
> **선례 참고**: `docs/03-design/dialogue-design-ui-spec.md`(노드 편집 폼·`ReorderableList`·`ResourcePickerField`·설계 점검 패널·흐름 미리보기 — 이번에 §4.2.1 ⑫행·§8을 갱신했다), `docs/03-design/security-audit-ui-spec.md`(`SystemSettingsMenu`·B1 금지어 관리의 목록+모달+시험패널 CRUD 패턴), `docs/03-design/quality-channel-ui-spec.md`(SIM1 시뮬레이터 결과 패널·`TracePanel` 패턴), `docs/03-design/version-history-ui-spec.md`(L4 복원 미리보기 `RestoreWarningList`), `docs/03-design/integrated-stats-ui-spec.md`(최신 문서 형식·`messages.ts` 키 목록 절 구성)
> **실제 코드 확인**: `apps/web/src/pages/dialogue/components/DialogOutputEditor.tsx`(⑫ `ApiConditionEditor` — v1 폼, 대체 대상) · `apps/web/src/components/security/SystemSettingsMenu.tsx`(신규 메뉴 항목 추가 지점) · `apps/web/src/pages/stats/StatsShell.tsx`(신규 서브탭 추가 지점) · `apps/web/src/pages/chatbot-detail/TabNav.tsx`(최상위 탭 변경 없음) · `apps/web/src/constants/messages.ts`(`MESSAGES.dialogue.outputFields`·`MESSAGES.simulator`·`MESSAGES.systemSettings` 네임스페이스)
> **작성**: ui-designer · 2026-09-24 · **다음 단계**: `backend-implementer`(이미 착수 가능 — 설계·ADR 확정됨) → `frontend-implementer` → `code-reviewer` → `test-automation`
> **범위 경계**: 실제 React 컴포넌트 코드는 작성하지 않는다. 여기서 정의한 화면/컴포넌트/상태/문구는 `frontend-implementer`가 구현 기준으로 삼는다. `apps/widget` 변경은 0건(설계서 §16 — 고정 문구는 기존 `TEXT` 렌더러를 그대로 탄다).

---

## 0. 전제와 연계 확인

1. **PM 결정 P-1~P-15는 전부 권고안대로 확정**되었다(요구사항 §11). 이 문서는 그 결정을 화면으로 구체화할 뿐 재론하지 않는다. 핵심만 다시 적는다:
   - 연결(`ApiConnection`)은 **전역**(챗봇 스코프 아님) 레지스트리이며 ADMIN만 쓴다(`security:write`). 노드는 **연결 id + 상대 경로**만 가지며 URL·헤더를 직접 입력하지 않는다(J-2).
   - 시크릿은 DB에 없다. 연결은 `secretRef`(이름)만 갖고 값은 서버 환경변수 `LEGACY_API_SECRET__<REF>`에서 읽는다. 콘솔은 `NOT_REQUIRED｜CONFIGURED｜MISSING` 상태만 본다(J-3).
   - 외부 호출은 **같은 응답 안에서 동기 완결**된다(정지점 → 엔진 밖 실행 → 순수 재진입, J-4). 사용자는 "조회 중" 화면을 별도로 보지 않는다 — S-1(§4 참고).
   - GET·POST만, 턴당 외부 호출 1회, 재시도 없음(J-5·J-7).
   - `{api.이름}` 치환은 같은 턴·텍스트 필드에만 적용되고 URL 필드는 치환하지 않는다(J-9·J-10).
   - SSRF는 다층 방어이며 **사설 대역은 운영자 환경변수 allowlist로만** 열린다 — 루프백·메타데이터는 누구도 열 수 없다(J-11).
   - 송신 값은 기본 마스킹, 연결 단위 `allowRawPersonalData`(ADMIN + 확인값 재입력)로만 원문 송신(J-12).
   - `ApiCallLog`는 **메타데이터 전용**(원문 0) — 목/TC/비교는 기록하지 않는다(J-13).
   - **신규 권한 0종.** 연결 관리=`security:write`, 선택 목록/샘플=`dialogue:read`, 노드 저장=`dialogue:write`, 호출 로그=`chatbot:read`, 시뮬레이터 실제 호출=`simulation:write`(불충족 시 거부가 아니라 목으로 격하, J-14·J-15).
   - 기존 v1(URL·헤더 인라인) 데이터는 **읽기 호환·실행 안 함·신규 저장 거부·조회 응답에서 헤더 값 가림**. 자동 변환·자동 삭제는 없다(J-16).
2. **선행 화면과의 관계**
   - `dialogue-design-ui-spec.md`의 노드 편집 폼(D1a/D1b)·`ReorderableList`·`ResourcePickerField`·설계 점검 패널(`DesignValidationPanel`)·흐름 미리보기(`FlowPreviewPanel`)를 그대로 확장한다. **이 문서는 그 문서를 대체하지 않는다** — 이번 세션에서 `dialogue-design-ui-spec.md` §4.2.1 ⑫행과 §8 미결정 항목 1건을 이미 갱신해 이 문서를 가리키도록 했다.
   - `ResourcePickerField`의 `resourceType` 유니온에 `'apiConnection'`을 추가한다(§2.2). 검색형 콤보박스 패턴을 그대로 재사용하되, `chatbotId`를 요구하지 않는다(연결은 전역 자원).
   - `security-audit-ui-spec.md`의 `SystemSettingsMenu` 패턴(권한 없는 항목은 렌더 자체를 하지 않음, F-4)과 B1 금지어 관리의 "목록 + 생성/수정 모달 + 진단 패널" 구조를 API 연결 관리 화면(AC1)이 그대로 따른다.
   - `quality-channel-ui-spec.md`의 SIM1 결과 패널(`TracePanel` 접이식, `role="status"` 응답 대기 표시)을 확장해 `ApiStepPanel`을 추가한다.
   - `version-history-ui-spec.md`의 `RestoreWarningList`(11종)에 3종을 추가한다(§3.9).
3. **문구 상수**: 신규 네임스페이스 `MESSAGES.apiConnections`·`MESSAGES.apiCallLogs`를 추가하고, 기존 `MESSAGES.dialogue.outputFields`·`MESSAGES.simulator`·`MESSAGES.systemSettings`·`MESSAGES.versions`(복원 경고)에 항목을 더한다(§8).
4. **조사 한계 승계**: 요구사항 문서가 명시한 대로 ROCHA 원본의 "API 조건" 편집 화면 필드를 직접 인용하지 못했다(`docs/00-source/*.pdf` 렌더링 불가). 이 설계는 요구사항·설계서의 필드 목록 + 선행 화면(D1a/D1b, SIM1, B1)의 관용구만으로 구성했다.
5. **`UIUX_준수기준.md` 보강 여부**: 이번 화면군에 필요한 규칙은 이미 기존 §1(색상 단독 금지)·§3(키보드 접근성)·§4(버튼 44×44px)·§5(텍스트 입력)·§6(폼 컨트롤)·§7(오류 메시지 원인+해결)·§8(로딩/상태, 비동기 대기 패턴)·§9(내비게이션)로 전부 커버된다 — **신규 보강 없음**. 특히 §7의 "원인+해결" 문구 패턴은 연결 테스트 실패 안내(`guidance` 필드, §3.1.3)에 그대로 적용한다.

---

## 1. 화면 목록 및 라우트

| ID | 화면명 | 라우트 | 성격 | 진입 경로 | 필요 권한 |
|---|---|---|---|---|---|
| AC1 | **API 연결 관리** | `/settings/api-connections` | 페이지(목록+모달) | `SystemSettingsMenu` "API 연결" | `security:read`(조회) / `security:write`(쓰기·테스트) |
| D1a-v2 | 노드 편집 — `API 조건분기` v2 폼(신규) | `/chatbots/:chatbotId/dialogue/nodes/:nodeId`(기존 라우트, 아웃풋 카드 내부) | 폼 내 컴포넌트 | D1b 아웃풋 유형 "API 조건분기" 선택(v2 신규 저장) | `dialogue:read`(연결 선택 목록) · `dialogue:write`(저장) |
| D1a-v1 | 노드 편집 — v1(이전 형식) 읽기 전용 표시 + 전환 | 〃(기존 라우트) | 폼 내 컴포넌트 | 기존 v1 데이터를 가진 노드를 열었을 때 | `dialogue:read` · 전환은 `dialogue:write` |
| D1-ext | 대화그래프 — 설계 점검·흐름 미리보기 확장 | `/chatbots/:chatbotId/dialogue/nodes`(기존 라우트) | 페이지 내 패널 확장 | 기존과 동일 | `dialogue:read` |
| SIM1-ext | 응답 테스트 — `외부 API` 단계 패널 확장 | `/chatbots/:chatbotId/simulator`(기존 라우트) | 페이지 내 패널 확장 | 기존과 동일 | `simulation:read`(목) · `simulation:write`(실제 호출) |
| L1 | **외부 연동 로그** | `/chatbots/:chatbotId/stats/api-calls`(신규, `StatsShell` 3번째 서브탭) | 페이지 | `StatsShell` 서브내비 "외부 연동 로그" | `chatbot:read` |
| L4-ext | 버전 복원 미리보기 — 경고 3종 확장 | 기존 `RestoreDialog`(모달, 비라우트) | 모달 내 목록 확장 | 기존과 동일 | `dialogue:write` + `chatbot:write` |

**신규 최상위 라우트는 AC1·L1 2개뿐**이다. 나머지는 전부 기존 화면의 확장이며 라우트를 새로 만들지 않는다.

**AC1 라우트 배치 근거**: 연결은 "어디로 나갈 수 있는가"를 정하는 **보안 설정 도메인**(요구사항 J-14 근거)이므로 `/settings/banned-words`·`/settings/audit-logs`와 같은 `/settings/*` 패턴을 따른다.

**L1 라우트 배치 근거(§16 원안과의 차이)**: 설계서 §16은 "챗봇 상세 `외부 연동 로그` 탭"이라고만 적었다. 실제 코드의 `TabNav.tsx`는 최상위 탭 라우트 수를 `AC-C-3`(No.5 그룹 수용기준)로 고정해 둔 이력이 있어(주석 "라우트는 6개 그대로 두되") **최상위 탭을 늘리지 않는다.** 대신 이미 "탭 1개 + 서브탭 N개" 패턴이 있는 `StatsShell`(현재 `overview`/`learning` 2개 서브탭)에 3번째 서브탭 `api-calls`로 얹는다 — 같은 `chatbot:read` 권한 경계를 이미 공유하고, "챗봇 운영 모니터링"이라는 성격도 통계와 가깝다. 이 배치는 **frontend-implementer 확인 필요**로 §9에 다시 적는다(대안: 최상위 탭 신설을 원하면 `AC-C-3` 수용기준 갱신을 `system-architect`와 먼저 협의).

---

## 2. 공통 UI 요소(신규)

### 2.1 배지류 (색상+텍스트 병기, UIUX §1)

| 컴포넌트 | 용도 | 규칙 |
|---|---|---|
| `SecretStatusBadge` | 연결 목록·상세·노드 편집기 연결 선택 결과 | `NOT_REQUIRED`(회색, "시크릿 불필요") / `CONFIGURED`(초록, "설정됨") / `MISSING`(빨강, "미설정") |
| `ConnectionEnabledBadge` | 연결 목록 | `사용 중`(초록 점) / `사용 중지`(회색) — 텍스트 병기 |
| `CircuitOpenBadge` | 연결 목록(FR-L2-7) | 회로가 열려 있을 때만 노출: "회로 열림"(주황) — 최근 실패가 몰려 일시적으로 호출을 쉬고 있다는 뜻을 툴팁으로 부연 |
| `InsecureHttpBadge` | 연결 목록·편집기·설계 점검 | `http` 연결에만: "암호화되지 않은 연결"(주황 `INFO` 톤) |
| `PersonalDataLookupBadge` | 연결 목록·편집기·설계 점검 | "개인정보 조회형"(파랑 `INFO` 톤) — `personalDataLookup=true`일 때 |
| `RawPersonalDataBadge` | 연결 목록·편집기 | "원문 송신"(주황) — `allowRawPersonalData=true`일 때, 마스킹이 꺼져 있음을 항상 눈에 띄게 |
| `LegacyFormatBadge` | 노드 편집기 v1 카드(§4.2) | "이전 형식 — 실행되지 않습니다. 연결을 선택해 전환하세요"(주황 `WARNING` 톤 — `UnsupportedOutputBadge`의 INFO 톤과 시각적으로 구분, `dialogue-design-ui-spec.md` §4.2.1 갱신분과 동일) |
| `ApiCallOutcomeBadge` | 외부 연동 로그(L1) | 18종 결과 코드 → 한국어 라벨 + 아이콘(§3.6 표) |
| `ApiBranchLabel` | 흐름 미리보기(D1-ext) | 자식 노드 접두 "API 분기 →"(via=`API_BRANCH`) |

### 2.2 인증·연결 전용 컴포넌트

| 컴포넌트 | props | 규칙 |
|---|---|---|
| `ApiConnectionPickerField` | `id`, `label`, `value: string \| null`, `onChange`, `methodFilter?: ('GET'\|'POST')[]`, `required?` | `ResourcePickerField`(`dialogue-design-ui-spec.md` §2.2-4)의 **5번째 `resourceType`**으로 `'apiConnection'`을 추가해 구현한다(`chatbotId` 불요 — 전역 자원이라 `GET /api-connections/picker` 호출 시 챗봇 파라미터를 붙이지 않는다). 후보 항목은 이름 옆에 `SecretStatusBadge`(작게) + "GET·POST 허용"/"GET만 허용" 텍스트 + `ConnectionEnabledBadge`를 함께 보여준다. **사용 중지된 연결도 후보에 나타나되** 흐린 회색 텍스트 + "(사용 중지)" 접미사로 표시해 선택은 가능하지만(이미 저장된 값을 다시 열람할 때 필요) 새로 선택 시 확인 없이 그대로 저장은 허용한다(저장 자체를 막지 않음 — 설계 점검이 WARNING으로 안내, FR-L3-4 ⑨). 목록 0건이면 "'{입력값}'에 해당하는 연결이 없습니다." + "[API 연결 관리로 이동 →]"(`createHref="/settings/api-connections"`, `security:write` 없는 사용자에게는 링크 대신 "관리자에게 연결 등록을 요청하세요" 텍스트만) |
| `BindingValueEditor` | `value: ApiBinding`, `onChange`, `slotOptions: { contextVariableId, slotName, label }[]` | 상수/슬롯 토글(라디오 2개, UIUX §6): "고정값"(텍스트 입력, 500자) / "폼 슬롯"(셀렉트 — 이 노드의 인풋 조건에 걸린 컨텍스트의 슬롯 목록만 후보로 제공. 조건에 컨텍스트가 없으면 셀렉트를 비활성화하고 "이 노드에 폼(컨텍스트) 조건을 먼저 추가하세요" 안내) |
| `RawPersonalDataConfirmField` | `connectionName`, `value: string`, `onChange` | 연결 편집 모달에서 `allowRawPersonalData`를 켤 때만 노출: "원문 송신을 켜려면 연결 이름을 다시 입력하세요" + 텍스트 입력(`PermanentDeleteModal`의 확인문구 재입력 패턴과 동일 — `security-audit-ui-spec.md` 관례 승계). 값이 연결 이름과 다르면 저장 버튼 `aria-disabled` |
| `SampleResponseListEditor` | `items: ApiSampleResponse[]`, `onChange`, `maxItems=5` | `ReorderableList` 재사용(위/아래 버튼). 각 항목: `label`(50자) · `httpStatus`(숫자 100~599) · `body`(JSON textarea, 16KB, 저장 시 `JSON.parse` 실패면 인라인 "올바른 JSON 형식이 아닙니다") · 상단 고정 경고 배너: **"이 값은 EDITOR·VIEWER도 시뮬레이터에서 볼 수 있습니다 — 실제 개인정보를 넣지 마세요."**(WARNING 톤, 항상 노출) |
| `ApiConnectionTestPanel` | `connectionId`, `disabled?` | §3.1.3 상세 |

### 2.3 노드 편집기 v2 전용 컴포넌트

| 컴포넌트 | props | 규칙 |
|---|---|---|
| `ApiConditionEditorV2` | `value: ApiConditionOutputPayloadV2`, `onChange`, `chatbotId`, `nodeConditions`(현재 노드의 인풋 조건 — 슬롯 후보 계산용) | §4.2 상세 |
| `ApiQueryListEditor` / `ApiBodyFieldListEditor` | `items`, `onChange`, `maxItems`(쿼리 20·본문 30) | `ReorderableList` 재사용. 쿼리 행: `name`(50자) + `BindingValueEditor`. 본문 행: `field`(점 표기, 100자, POST에서만 노출) + `BindingValueEditor` |
| `ApiResponseMappingListEditor` | `items`, `onChange`, `maxItems=20` | 행: `name`(변수명, `^[a-zA-Z][a-zA-Z0-9_]{0,29}$`) · `path`(응답 경로, 200자, 도움말 "예: `data.status`, `data.items[0].name`") · `required`(체크박스) · `maxLength`(1~500, 기본 200) |
| `ApiConditionPreviewPanel` | `payload: ApiConditionOutputPayloadV2`, `connectionId` | §4.4 상세 — 샘플 응답으로 매핑·분기 결과를 즉시 미리 본다 |
| `ConvertLegacyApiConditionDialog` | `v1Payload`, `onConfirm` | §4.3 상세 |

---

## 3. 화면별 설계

## 3.1 AC1 — API 연결 관리 (`/settings/api-connections`)

### 목적
ADMIN이 레거시 시스템에 대한 연결(호스트·인증·시크릿 참조·허용 메서드·타임아웃·개인정보 취급)을 전역으로 등록·수정·테스트·삭제한다.

### 상태별 UI

| 상태 | UI |
|---|---|
| 로딩 | `SkeletonRow` × 5 |
| 성공(데이터 있음) | 표 + "총 {total}건"(UIUX §8) |
| **빈 상태**(연결 0건) | `EmptyState`: "등록된 API 연결이 없습니다." + "대화 노드의 'API 조건분기' 아웃풋에서 쓸 외부 시스템 연결을 여기서 먼저 등록하세요." + `[+ 연결 추가]` |
| 오류 | `ErrorState` + 다시 시도 |

### 레이아웃 (데스크톱)

```
┌───────────────────────────────────────────────────────────────────────────┐
│ 시스템 설정 > API 연결                                                      │
├───────────────────────────────────────────────────────────────────────────┤
│ 검색 [__________]  사용 여부 ☑사용중 ☑사용중지                              │
│                                                          [+ 연결 추가]      │
├───────────────────────────────────────────────────────────────────────────┤
│ 이름      호스트           메서드   인증   시크릿   상태            참조 24h│
│ ERP 주문  erp.corp.local   GET,POST BEARER ●설정됨 ●사용중          2   1,284/37 ⋮│
│ 결제조회   pay.example.com  GET      NONE   —       ●사용중지        0   0/0     ⋮│
│                              (원문송신)(개인정보조회형)(암호화안됨)         │
│                                                          ◀ 1 ▶ 총 2건       │
└───────────────────────────────────────────────────────────────────────────┘
```

- 배지 행(`InsecureHttpBadge`/`PersonalDataLookupBadge`/`RawPersonalDataBadge`)은 해당 값이 있는 연결에만 이름 아래 작은 줄로 병기한다(모든 배지가 동시에 뜨면 줄바꿈).
- "참조" 열은 이 연결을 사용하는 **현재 저장된 노드 수**(스냅샷 참조는 세지 않음 — FR-L8-5), "24h" 열은 최근 24시간 호출/실패 수(FR-L2-7).

### 컴포넌트 분해

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `ApiConnectionFilterBar` | `q`, `enabled: boolean[]`(기본 전체 체크 — 사용 중지된 연결도 즉시 보여 관리 누락을 막는다, D1 노드 목록과 동일 철학) |
| `ApiConnectionTable` | `items: ApiConnectionListItem[]`, `loading` | 컬럼: 이름, `baseUrlHost`, `allowedMethods`(콤마 나열), `authType`, `SecretStatusBadge`, `ConnectionEnabledBadge`(+`CircuitOpenBadge` 있으면 병기), 참조 노드 수, 24h 호출/실패, 배지 부속 줄 |
| `ApiConnectionRowActions`(`KebabMenu`) | `connection` | "수정" / "연결 테스트" / "삭제" — 전부 `security:write`가 있을 때만 노출(없으면 케밥 메뉴 자체를 숨기고 목록은 조회만, `security:read`) |
| `ApiConnectionEditModal` | `connection: ApiConnection \| null` | §3.1.1 상세 |
| `DeleteApiConnectionConfirmDialog` | `connection` | `409 API_CONNECTION_IN_USE` 시 모달 내 배너: "이 연결을 사용하는 노드가 {n}건 있습니다." + 상위 5건 `{챗봇명} › {노드명}` 링크(클릭 시 모달 닫고 해당 노드 편집으로 이동) — `dialogue-design-ui-spec.md` §4.3.2 패턴과 동일. 사용 중지는 참조가 있어도 항상 가능(별도 확인 없이 즉시 `PATCH`) |

### 3.1.1 연결 생성/수정 모달(`ApiConnectionEditModal`)

```
┌ API 연결 추가 ───────────────────────────────────────────────────── ✕ ┐
│ 이름 *        [ERP 주문____________________]                          │
│ 설명          [____________________________] 0/300자                  │
│ 기준 URL *    [https://erp.corp.local/api___] ⚠ 사설 주소는 서버 허용   │
│                                                  목록에 등록되어야 호출됩니다│
│ 허용 메서드 * ☑ GET  ☑ POST                                           │
│ 인증 방식     (○없음 ●API 키(헤더) ○Bearer 토큰 ○기본 인증)            │
│  헤더 이름 *  [X-API-Key____]  (API 키 선택 시)                        │
│  시크릿 참조* [ERP__________]  ⚠ 서버에 LEGACY_API_SECRET__ERP가       │
│                                    설정되지 않았습니다 — 운영자에게 요청하세요│
│ 타임아웃(초)  [3] (1~10)                                                │
│ 분당 호출 제한 [120] (1~600, 개인정보 조회형 기본 30)                    │
│ ☐ 원문 개인정보 송신 허용(기본: 마스킹 후 전송)                          │
│ ☐ 개인정보 조회형 연결(전화번호 등으로 타인 정보를 조회할 수 있음)        │
├─────────────────────────────────────────────────────────────────────┤
│ 샘플 응답(시뮬레이터·목 전용, 0/5)                          [+ 샘플 추가]│
│ ⚠ 이 값은 EDITOR·VIEWER도 시뮬레이터에서 볼 수 있습니다 — 실제 개인정보를│
│    넣지 마세요.                                                        │
│ ┌───────────────────────────────────────────────────┐ ▲ ▼ ⌫          │
│ │ 레이블[배송중] 상태코드[200]                            │            │
│ │ 본문(JSON) [{"data":{"status":"SHIPPED",...}}______]   │            │
│ └───────────────────────────────────────────────────┘                │
├─────────────────────────────────────────────────────────────────────┤
│ 사용 여부  ☑ 사용함                                                    │
│                                       [연결 테스트]  [취소]  [저장]    │
└─────────────────────────────────────────────────────────────────────┘
```

| 필드 | 컴포넌트 | 검증 |
|---|---|---|
| 이름 | `TextInputField` | 1~50자, 전역 유일(`DUPLICATE_NAME` 409) |
| 설명 | `TextAreaField` | 0~300자 |
| 기준 URL | `TextInputField` | `http(s)://호스트[:포트][/경로]`만, 사용자정보(`user:pass@`)·쿼리·프래그먼트 금지. `http` 입력 시 필드 하단에 상시 안내: "http는 암호화되지 않습니다 — 가능하면 https를 사용하세요."(INFO, 차단 아님) |
| 허용 메서드 | 체크박스 2개(GET/POST, UIUX §6 다중선택) | 1개 이상 필수 |
| 인증 방식 | `RadioGroup`(4종, UIUX §6 단일선택) | `API_KEY_HEADER` 선택 시 헤더 이름 필드 노출·필수 |
| 헤더 이름 | `TextInputField` | `API_KEY_HEADER`일 때만, `^[A-Za-z0-9-]{1,64}$`, `Host`/`Cookie`/`Content-Length` 등 금지 목록 위반 시 인라인 |
| 시크릿 참조 | `TextInputField` + `SecretStatusBadge` | `authType≠NONE`이면 필수, `^[A-Z0-9_]{1,40}$`. **값 입력 칸이 아니다** — 이름만 적으면 서버가 `LEGACY_API_SECRET__{참조}` 환경변수 존재 여부를 조회해 상태를 보여준다. `MISSING`이면 필드 하단 상시 경고(제출은 막지 않음 — 나중에 운영자가 설정할 수 있으므로) |
| 타임아웃 | `NumberInputField` | 정수 1~10초, 기본 3 |
| 분당 호출 제한 | `NumberInputField` | 1~600, 기본값은 `personalDataLookup` 체크 여부에 따라 120/30으로 자동 채워지되 수동 조정 가능 |
| 원문 개인정보 송신 허용 | `CheckboxField` + `RawPersonalDataConfirmField`(켤 때만) | 기본 false. 체크 시 확인 필드 노출, 미일치면 저장 `aria-disabled` |
| 개인정보 조회형 연결 | `CheckboxField` | 기본 false. 체크 시 도움말: "전화번호 등으로 조회하면 익명 사용자가 타인의 정보를 열람할 수 있습니다. 레거시 쪽에서 2개 이상 값을 대조하도록 설정하는 것을 권장합니다." |
| 샘플 응답 | `SampleResponseListEditor` | §2.2 |
| 사용 여부 | `CheckboxField` | 기본 true |

- **저장 흐름**: `POST /api-connections` 또는 `PATCH /api-connections/:id` → `201`/`200` → `Toast`("연결이 저장되었습니다") + 목록 갱신 → 시크릿이 `MISSING`이면 저장 직후 배너를 유지한 채 모달을 닫는다(정보 손실 없이 다음에도 상태 확인 가능하도록 목록에도 `SecretStatusBadge`가 남는다).
- **오류 매핑**: `DUPLICATE_NAME`(409, 이름 필드) · `CONFIRM_NAME_MISMATCH`(400, 원문 송신 확인 필드) · `VALIDATION_FAILED`(400, `details[].field`별 인라인).

### 3.1.2 삭제 흐름

`dialogue-design-ui-spec.md` §4.3.2와 동일한 3단계 패턴(트리거 → 확인 모달 → `409` 시 참조 목록 배너). 유일한 차이는 참조 대상이 노드가 아니라 "챗봇 › 노드" 조합이라는 점(전역 연결이 여러 챗봇에서 쓰이므로).

### 3.1.3 연결 테스트(`ApiConnectionTestPanel`)

```
연결 테스트   상대 경로 [/____________________]  [테스트]
→ (성공) ✔ 200 · 142ms · JSON 응답 확인
→ (실패) ✖ 사설 주소(10.20.1.5)는 서버 허용 목록에 없어 호출할 수 없습니다.
           운영자에게 허용 목록(LEGACY_API_PRIVATE_ALLOWLIST) 추가를 요청하세요.
```

- 목록 행의 "연결 테스트" 또는 편집 모달 하단 버튼으로 진입(둘 다 같은 패널을 연다). `security:write`.
- "테스트" 클릭 → `POST /api-connections/:id/test { path }` → 결과 영역은 `aria-live="polite"`(NFR-LA3)로 갱신 — 스크린리더가 결과를 자동으로 읽는다.
- 결과는 **본문을 절대 표시하지 않는다**(설계서 FR-L2-5·AC-L2-6) — 상태 코드·지연·바이트 수·JSON 파싱 가능 여부만.
- 실패 문구는 항상 "원인 + 해결 방법" 형태(UIUX §7). 예시 매핑:
  - `BLOCKED_ADDRESS`(사설) → "사설 주소({ip})는 서버 허용 목록에 없어 호출할 수 없습니다. 운영자에게 허용 목록 추가를 요청하세요."
  - `BLOCKED_ADDRESS`(루프백) → "같은 서버 주소(localhost)는 보안상 호출할 수 없습니다. 사내 주소(사설 IP/내부 DNS)로 노출한 뒤 허용 목록에 추가하세요."
  - `SECRET_MISSING` → "서버에 시크릿이 설정되지 않았습니다. 운영자에게 `LEGACY_API_SECRET__{참조}` 설정을 요청하세요."
  - `TIMEOUT` → "{n}초 안에 응답이 없었습니다. 대상 서버 상태를 확인하거나 타임아웃 설정을 늘려보세요."
  - `FEATURE_DISABLED` → "서버 설정으로 레거시 API 연동이 꺼져 있습니다. 운영자에게 문의하세요."
- 사용 중지된 연결도 테스트할 수 있다(설정 확인 목적, 설계서 §7.9).

---

## 3.2 D1a/D1b 확장 — 노드 편집기 `API 조건분기` v2 폼 (`ApiConditionEditorV2`)

### 목적
EDITOR가 등록된 연결을 골라 상대 경로·쿼리·본문을 **구조적으로** 구성하고, 응답 경로를 변수로 매핑해 조건 분기·텍스트 치환에 쓴다.

### 진입 경로
`dialogue-design-ui-spec.md` D1b(`/chatbots/:chatbotId/dialogue/nodes/:nodeId`)의 아웃풋 유형 셀렉트에서 "API 조건분기"를 **새로 선택**하면 이 v2 폼이 나타난다(기존 v1 데이터를 가진 카드는 §3.3의 읽기 전용 표시가 대신 나타난다 — 같은 유형 값이지만 payload 형태로 분기됨, FR-L1-3).

### 레이아웃

```
┌─────────────────────────────────────────────────────────────────┐ ▲ ▼ ⌫
│ N  유형 [API 조건분기 ▾]                                          │
│    연결 * [검색: 연결 이름으로 찾기_______▾]  [ERP 주문 ×]          │
│           GET·POST 허용 · 사용 중 · 개인정보 조회형                 │
│           ⓘ 개인정보 조회형 연결입니다 — 레거시 쪽 2요소 대조를 권장합니다│
│    메서드 * (●GET ○POST)                                          │
│    상대 경로 * [/orders/{0}_______________]                        │
│      경로 값 1 [폼 슬롯 ▾][주문조회폼 › 주문번호 ▾]                  │
│    쿼리 (1/20)                                        [+ 쿼리 추가]│
│      이름[phone] 값 [폼 슬롯 ▾][주문조회폼 › 전화 ▾]           ⌫   │
│    응답 매핑 (2/20)                                    [+ 매핑 추가]│
│      변수명[status] 경로[data.status_______] 필수 ☑ 최대길이[200]⌫ │
│      변수명[eta]    경로[data.delivery.eta_] 필수 ☐ 최대길이[20] ⌫ │
│    조건 (2/10)                                        [+ 조건 추가]│
│      경로[data.status] 연산자[EQ▾] 값[SHIPPED] 다음노드[배송중안내▾]⌫│
│      경로[data.status] 연산자[EQ▾] 값[READY]   다음노드[준비중안내▾]⌫│
│    불일치 시(선택) [상태미상안내 ▾]                                 │
│    호출 실패 시(선택) [조회실패안내 ▾]                              │
│    ⓘ 지정하지 않으면 정해진 안내 문구로 끝납니다.                    │
│    ⓘ 이 아웃풋 뒤에 오는 다른 아웃풋은 실행되지 않습니다             │
│       (API 조건분기는 항상 노드의 마지막 아웃풋으로 동작합니다).      │
│    ┌─ 미리보기 ─────────────────────────────────────────────────┐  │
│    │ 샘플 [배송중 ▾]  [미리보기]                                  │  │
│    │ → 변수: status=SHIPPED, eta=09/26 · 일치한 조건: 1번          │  │
│    └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 컴포넌트 분해

| 컴포넌트 | props / 검증 |
|---|---|
| `ApiConnectionPickerField` | §2.2 — `methodFilter` 없음(전체), 선택 시 `method` 셀렉트의 옵션을 해당 연결의 `allowedMethods`로 좁힌다(연결이 GET만 허용하면 POST 라디오를 `disabled` + 도움말 "이 연결은 GET만 허용합니다") |
| `RadioGroup`(메서드) | GET/POST, 연결의 허용 메서드로 제한(UIUX §6) |
| `TextInputField`(상대 경로) | 1~300자, `/`로 시작, `{0}`~`{4}` 자리표시자만 허용, `..`·`//`·`?`·`#`·제어문자 금지 — 위반 시 즉시 인라인("경로에 `..`, `?`, `#`은 쓸 수 없습니다. 쿼리는 아래 '쿼리' 항목을 이용하세요.") |
| `ApiPathParamListEditor` | 경로의 `{n}` 개수와 **자동 동기화**(경로에 `{0}{1}`이 있으면 경로 값 입력 2개가 자동 생성/삭제) — 각 항목 `BindingValueEditor` |
| `ApiQueryListEditor` | §2.3 |
| `ApiBodyFieldListEditor` | §2.3, `method==='POST'`일 때만 섹션 자체가 노출 |
| `ApiResponseMappingListEditor` | §2.3 |
| `ReorderableList`(조건) | 기존 `DialogOutputEditor`의 조건 편집 UI(경로·연산자 8종·값·다음 노드 `ResourcePickerField`)를 **그대로 재사용**한다 — v1과 달리 `path` 필드에 "응답 경로" 문법 도움말(`data.items[0].name` 형식)이 붙는다는 차이만 있다 |
| `ResourcePickerField`(불일치 시) | `resourceType='node'`, `multiple=false`, 선택 해제 가능. 도움말: "지정하지 않으면 '확인한 결과에 맞는 안내를 찾지 못했어요…' 문구로 끝납니다." |
| `ResourcePickerField`(호출 실패 시) | 〃, 도움말: "지정하지 않으면 '지금은 요청하신 정보를 확인할 수 없어요…' 문구로 끝납니다." |
| `ApiOutputTerminalHint` | 고정 안내(항상 노출, 조건이 아님): "이 아웃풋 뒤에 오는 다른 아웃풋은 실행되지 않습니다." — `ReorderableList`가 이 아웃풋을 노드의 마지막 위치가 아닌 곳에 두면 같은 문구가 `WARNING` 톤으로 강조된다(클라이언트에서 위치만 보고 즉시 판단 가능 — 서버 설계 점검의 `API_OUTPUT_NOT_LAST`와 같은 판정을 화면에서 선제 안내) |
| `ApiConditionPreviewPanel` | §3.4 |

### 3.2.1 개인정보 조회형 연결 선택 시 경고

`ApiConnectionPickerField`에서 `personalDataLookup=true`인 연결을 선택하면, 선택 즉시 카드 상단에 `INFO` 배너: **"개인정보 조회형 연결입니다 — 익명 사용자가 다른 사람의 정보를 조회할 수 없도록 레거시 쪽에서 2개 이상의 값(예: 주문번호+전화번호)을 대조하도록 설정하는 것을 권장합니다."** 이 배너는 저장을 막지 않는다(정보 제공용).

### 필드-오류 매핑(추가분)

| field 패턴 | 표시 위치 | 대표 메시지 |
|---|---|---|
| `outputs[i].apiCondition.connectionId` | `ApiConnectionPickerField` 하단 | "선택한 연결을 찾을 수 없습니다. 목록을 새로고침해 주세요."(`INVALID_REFERENCE`, 404) |
| `outputs[i].apiCondition.method` | 메서드 라디오 하단 | "이 연결은 선택한 메서드를 허용하지 않습니다."(`400`) |
| `outputs[i].apiCondition.path` | 경로 필드 하단 | "경로 자리표시자 수와 경로 값 개수가 일치해야 합니다."(`400`) |
| `outputs[i].apiCondition.conditions[j].nextNodeId` / `defaultNodeId` / `failureNodeId` | 해당 `ResourcePickerField` 하단 | "선택한 노드를 찾을 수 없습니다. 목록을 새로고침해 주세요."(`INVALID_REFERENCE`, 404) |
| 전체 payload가 v1 형태 | 폼 상단 배너 | "API 조건을 연결 방식으로 전환해야 저장할 수 있습니다."(`API_OUTPUT_LEGACY_FORMAT`, 400 — §3.3에서 전환하지 않고 v1 카드째 저장을 시도한 경우에만 발생, 정상 v2 편집에서는 발생하지 않음) |

---

## 3.3 D1a/D1b — v1(이전 형식) 표시 + 전환 (`LegacyApiConditionReadonlyCard` / `ConvertLegacyApiConditionDialog`)

### 목적
No.5 시절 URL·헤더를 직접 입력해 저장한 `API_CONDITION`을 안전하게(시크릿 노출 없이) 열람하고, 원할 때만 v2로 전환한다.

### 레이아웃

```
┌─────────────────────────────────────────────────────────────────┐ ▲ ▼ ⌫
│ N  유형 [API 조건분기 ▾]                                          │
│    ⚠ 이전 형식 — 실행되지 않습니다. 연결을 선택해 전환하세요        │
│    메서드  GET  (읽기 전용)                                        │
│    URL     https://erp.corp.local/…  (읽기 전용, 경로는 가려짐)    │
│    헤더    2개(값은 표시되지 않습니다)                              │
│    본문 템플릿  [비공개]                                            │
│    조건 (2개, 읽기 전용)                                            │
│      data.status EQ SHIPPED → 배송중안내                            │
│      data.status EQ READY   → 준비중안내                            │
│                                                    [연결로 전환]    │
└─────────────────────────────────────────────────────────────────┘
```

- 이 카드는 **모든 필드가 읽기 전용**이다(포커스 이동 규칙 없음 — 편집 불가). URL은 서버가 이미 호스트까지만 반환하고(`redactLegacyApiOutputs()`, FR-L1-6), 헤더 값은 절대 오지 않으므로 "표시/가리기" 토글 자체가 없다(과거 v1 편집기의 토글은 폐기됨).
- `LegacyFormatBadge`(§2.1)가 배지로 상단에 고정 노출된다.

### 전환 흐름(`ConvertLegacyApiConditionDialog`)

1. "연결로 전환" 클릭 → 확인 대화상자: **"이전 형식의 헤더·URL·요청 본문은 전환 후 사라집니다. 메서드와 조건 목록만 새 폼으로 옮겨집니다. 계속하시겠습니까?"**(danger 톤, 기본 포커스 "취소").
2. 확인 → 이 아웃풋 카드가 §3.2의 `ApiConditionEditorV2`로 **교체**되며, 메서드(GET/POST가 아니면 GET으로 초기화 + 안내)와 조건 목록(경로·연산자·값·다음 노드)만 옮겨진 **미완성 초안** 상태로 시작한다. 연결·경로·쿼리·본문·응답 매핑은 전부 비어 있어 관리자가 새로 채워야 한다(설계서 §21 D-5 — URL이 가려져 있어 경로를 자동으로 옮길 수 없다).
3. 폼 상단에 1회성 안내: "연결과 경로를 선택하고 저장해야 이 아웃풋이 실행됩니다."
4. 전환은 **저장 전 클라이언트 상태 변경**일 뿐이다 — "취소" 버튼으로 폼 전체를 되돌리면 v1 카드로 복귀한다(v1 데이터는 저장하기 전까지 서버에서 사라지지 않는다).
5. 전환하지 않고 v1 카드를 그대로 둔 채 다른 필드만 고쳐 저장을 시도하면 서버가 `400 API_OUTPUT_LEGACY_FORMAT`을 반환한다 → 폼 상단 배너: **"API 조건을 연결 방식으로 전환해야 저장할 수 있습니다."** + 해당 아웃풋 카드로 스크롤·포커스 이동 + "연결로 전환" 버튼 강조.

### 노드 복사 시 안내(D1 목록, 기존 `CopyDialogNodeAction` 확장)

원본 노드가 v1 `API_CONDITION`을 가지고 있으면, 복사 성공 토스트 문구에 한 줄이 추가된다: **"'{원본명} (사본)'이 생성되었습니다. 새 노드는 비활성 상태입니다. (이전 형식 API 조건 1개는 복사되지 않았습니다.)"**

---

## 3.4 `ApiConditionPreviewPanel` — 샘플 응답 미리보기 (v2 폼 하단)

### 목적
저장 전에 "이 응답이 오면 어떤 변수가 만들어지고 어떤 조건이 맞는지"를 즉시 확인한다. 서버 왕복 없이 **공유 순수 함수**(`@chat-bot/shared-types`의 `api-mapping.ts` — `extractPath`/`evaluateApiConditions`/`buildApiVariables`)를 브라우저에서 직접 호출한다(엔진·시뮬레이터와 동일한 판정 로직, 설계서 §4.5).

### 레이아웃

```
┌─ 미리보기 ───────────────────────────────────────────────────────┐
│ 응답 원천  (●연결의 샘플 응답 ○직접 입력 JSON)                      │
│   샘플 [배송중 ▾]                                    [미리보기]     │
├─────────────────────────────────────────────────────────────────┤
│ 추출된 변수                                                        │
│   status = SHIPPED                                                │
│   eta = 09/26                                                     │
│ 일치한 조건: 1번(data.status EQ SHIPPED) → 배송중안내                │
├─────────────────────────────────────────────────────────────────┤
│ 치환 미리보기(선택한 분기 노드의 첫 TEXT 아웃풋 기준)                 │
│   "주문하신 상품은 배송 중이며 09/26 도착 예정입니다."               │
└─────────────────────────────────────────────────────────────────┘
```

- "연결의 샘플 응답" 선택 시 §2.2의 `GET /api-connections/:id/samples`(`dialogue:read`)로 목록을 불러온다. 샘플이 0개면 "이 연결에 등록된 샘플 응답이 없습니다. [API 연결 관리로 이동해 추가하기]"(`security:write` 없으면 링크 대신 안내 텍스트).
- "직접 입력 JSON" 선택 시 textarea에 임시 JSON을 넣어 즉시 시험할 수 있다(저장되지 않음, 순수 클라이언트 연산).
- 필수 매핑이 응답에 없으면: "필수 항목 'status'가 응답에 없습니다 — 저장 후 실제 호출에서는 '호출 실패' 분기로 처리됩니다."
- 어떤 조건에도 안 맞으면: "일치하는 조건이 없습니다 — '불일치 시' 분기(또는 고정 안내 문구)로 처리됩니다."
- 이 패널은 **순수 진단**이며 저장을 막지 않는다(`DesignValidationPanel`과 같은 성격).

---

## 3.5 D1-ext — 설계 점검 패널 확장 (`DesignValidationPanel`)

`dialogue-design-ui-spec.md` §4.1.2의 기존 `DesignValidationPanel`에 아래 11개 코드가 같은 `DesignIssueRow` 형식으로 추가된다(설계서 §5.9).

| # | 코드 | 심각도 | 표시 문구 | 바로가기 |
|---|---|---|---|---|
| ① | `API_OUTPUT_NOT_LAST` | ⚠ 주의 | "API 조건분기 뒤에 다른 아웃풋이 있는 노드 N건 — 뒤의 아웃풋은 실행되지 않습니다" | 해당 노드 편집 |
| ② | `API_MULTIPLE_OUTPUTS` | ✖ 오류 | "한 노드에 API 조건분기가 2개 이상인 노드 N건" | 해당 노드 편집 |
| ③ | `API_NESTED_CALL` | ⚠ 주의 | "API 조건분기의 분기 대상이 또 API 조건분기를 가진 노드 N건 — 두 번째 호출은 실행되지 않습니다" | 해당 노드 편집 |
| ④ | `API_LEGACY_FORMAT` | ⚠ 주의 | "이전 형식 API 조건을 가진 노드 N건 — 연결 방식으로 전환이 필요합니다" | 해당 노드 편집 |
| ⑤ | `API_SLOT_BINDING_UNREACHABLE` | ⚠ 주의 | "폼 완료 직후가 아닐 때도 실행될 수 있는 노드 N건 — 값이 비어 실패 분기로 처리됩니다" | 해당 노드 편집 |
| ⑥ | `API_FAILURE_BRANCH_MISSING` | ⓘ 안내 | "호출 실패 시 분기가 지정되지 않은 노드 N건 — 정해진 안내 문구로 처리됩니다" | 해당 노드 편집 |
| ⑦ | `API_TOKEN_IN_URL_FIELD` | ⚠ 주의 | "URL·이미지 필드에 `{api.*}`를 쓴 노드 N건 — 이 값은 치환되지 않습니다" | 해당 노드 편집 |
| ⑧ | `BROKEN_REFERENCE`(연결) | ✖ 오류 | "존재하지 않는 API 연결을 참조하는 노드 N건" | 해당 노드 편집 |
| ⑨ | `API_CONNECTION_UNAVAILABLE` | ⚠ 주의 | "사용 중지되었거나 시크릿이 설정되지 않은 연결을 참조하는 노드 N건" | 해당 노드 편집 + "API 연결 관리로 이동"(권한 있을 때만) |
| ⑩ | `API_CONNECTION_INSECURE` | ⓘ 안내 | "암호화되지 않은(http) 연결을 참조하는 노드 N건" | 해당 노드 편집 |
| ⑪ | `API_PERSONAL_DATA_LOOKUP` / `API_RAW_PERSONAL_DATA` | ⓘ 안내 | "개인정보 조회형 연결을 참조하는 노드 N건" / "원문 송신 연결을 참조하는 노드 N건" | 해당 노드 편집 |

- 이 중 ⑧~⑪은 **연결 데이터가 있어야** 판정 가능하다(설계서 §5.9 — `context.apiConnections`). `DesignValidationPanel`은 이미 `POST /dialog-nodes/validate` 결과를 통째로 받아 렌더링하므로 **화면 컴포넌트 변경은 없다** — 서버가 컨텍스트를 채워 보내는 것으로 충분하다.
- `API_MULTIPLE_OUTPUTS`(②)만 `ERROR`이고 나머지는 `WARNING`/`INFO`다 — "턴당 1회"라는 실행 규약이 명확히 깨지는 경우만 오류로 취급한다.

---

## 3.6 D1-ext — 흐름 미리보기 확장 (`FlowPreviewPanel`)

`dialogue-design-ui-spec.md` §4.1.1의 트리에서, `API_CONDITION`(v1·v2 모두)의 `conditions[].nextNodeId`·`defaultNodeId`·`failureNodeId`가 가리키는 노드는 자식 항목으로 `ApiBranchLabel`("API 분기 →")을 접두해 표시된다.

```
▾ 흐름 미리보기
  ▾ 컨텍스트:주문조회폼 완료 → 주문조회_실행
    ▸ API 분기 → 배송중안내
    ▸ API 분기 → 준비중안내
    ▸ API 분기 → 상태미상안내
    ▸ API 분기 → 조회실패안내
```

이 변경으로 "API 조건분기로만 참조되는 노드는 고아가 아니다"(요구사항 AC-L1-8)가 화면에서도 자연스럽게 드러난다 — 별도 컴포넌트 추가 없이 기존 `FlowPreviewPanel`이 서버가 채운 `apiTargets`를 그대로 렌더링한다.

---

## 3.7 SIM1-ext — 응답 테스트 "외부 API" 단계 패널 (`ApiStepPanel`)

`quality-channel-ui-spec.md` §4.1의 `TracePanel` 아래(또는 그 안의 별도 섹션)에, 시뮬레이션 응답에 `apiStep`이 있을 때만 나타난다.

### 레이아웃

```
사용자  배송 조회해주세요 · 12345 · 010-1234-5678
   봇  조회해 볼게요.
       주문하신 상품은 배송 중이며 09/26 도착 예정입니다.
       판정 근거 보기 ▾
       외부 API 단계 ▾
       └ 연결: ERP 주문 · GET /orders/{0} · 결과: 성공(212ms) · 분기: 조건 1
          변수: status=SHIPPED, eta=09/26
          ⓘ 목 응답을 사용했습니다(샘플: "배송중")
```

- LIVE(실제 호출)일 때는 "ⓘ 실제 호출 결과입니다(지연 212ms)"로 바뀐다.
- 격하(downgrade)된 경우: "ⓘ 실제 호출 조건을 충족하지 않아 목 응답으로 대체했습니다 — {사유}"(예: "POST는 시뮬레이터에서 실제로 호출하지 않습니다(목으로만 확인)", "이 노드는 아직 저장되지 않았습니다", "이 계정은 실제 호출 권한이 없습니다").
- `variables` 표시 값은 **항상 마스킹된 값**이다(`maskPii()` 적용 후, FR-L7-3) — 관리자 화면이라도 개인정보 원문을 그대로 띄우지 않는다.
- 해석된 URL·바인딩 원문은 어디에도 표시하지 않는다.

### 컴포넌트 분해(추가분)

| 컴포넌트 | props |
|---|---|
| `ApiStepPanel` | `apiStep: ApiStepView` — 접이식(`aria-expanded`), 기본 접힘. `TracePanel`과 동일한 토글 패턴 |
| `ApiModeToggle` | `mode: 'MOCK'\|'LIVE'`, `disabled: boolean`, `disabledReason?` | SIM1 메시지 입력 영역 근처에 상시 노출되는 라디오 2개(UIUX §6). `LIVE` 선택이 불가능한 조건(POST 연결·오버레이 노드·`simulation:write` 없음)에서는 `LIVE` 옵션 자체가 `disabled` + 옆에 회색 텍스트로 사유 표시(예: "실제 호출은 이 챗봇에 저장된 노드에서만 가능합니다") |
| `MockResponseSelector` | `connectionId`, `value`, `onChange` | 봇 응답을 재현할 목 원천 선택: 연결 샘플 목록 드롭다운 / "직접 입력 JSON" / "특정 실패로 재현"(`ApiCallOutcome` 중 사용자가 자주 확인할 소수만 노출 — `TIMEOUT`/`HTTP_ERROR`/`INVALID_RESPONSE`) — 시험 대화를 보내기 **전에** 미리 지정하는 옵션(요청 시 `apiMode`/`mockResponse`에 실림) |

### 흐름

1. 기본은 `MOCK`이다(요청에 `apiMode` 생략 시 서버 기본값도 `MOCK`) — 아무 것도 설정하지 않아도 안전하게 대화를 시험할 수 있다.
2. `LIVE`로 바꾸고 메시지를 전송하면 실제 호출이 나간다(조건 불충족 시 서버가 자동으로 `MOCK` 격하 + `downgradeReason`을 함께 반환하므로 클라이언트가 사전 차단을 완벽하게 할 필요는 없다 — `ApiModeToggle`의 `disabled`는 **미리 안내**일 뿐, 최종 판정은 항상 서버).
3. 비교 모드(SIM2)에는 이 패널을 추가하지 않는다 — 비교는 항상 목이며 A/B가 같은 목 원천을 쓴다는 사실만 결과 상단에 1줄 안내로 표시한다: "외부 API 응답은 두 버전 모두 같은 샘플로 재현되었습니다."

---

## 3.8 L1 — 외부 연동 로그 (`/chatbots/:chatbotId/stats/api-calls`)

### 목적
`chatbot:read` 보유자(전 역할)가 이 챗봇의 레거시 API 호출 이력을 **메타데이터만으로** 모니터링한다. 원문(URL 치환값·요청/응답 본문)은 어디에도 없다.

### 상태별 UI

| 상태 | UI |
|---|---|
| 로딩 | 요약 카드 `SkeletonCard` × 4, 표 `SkeletonRow` × 5 |
| 성공(호출 있음) | 요약 + 표 |
| **빈 상태**(기간 내 호출 0건) | 요약 카드는 전부 0으로 정상 표시(오류 아님, UIUX §8 "0건도 완료 상태") + 표 영역 `EmptyState`: "선택한 기간에 외부 API 호출 기록이 없습니다." |
| 오류 | `ErrorState` + 다시 시도 |

### 레이아웃

```
┌───────────────────────────────────────────────────────────────────────────┐
│  기본 통계     학습현황     외부 연동 로그                                  │  ← StatsShell 서브탭(3번째, 신규)
├───────────────────────────────────────────────────────────────────────────┤
│ 기간 [2026-09-01] ~ [2026-09-24]  연결 [전체 ▾]  결과 ☑전체 ☑성공 ☑실패…   │
├───────────────────────────────────────────────────────────────────────────┤
│ 호출 1,284건   성공률 97.1%   시간초과 21   회로 열림 12   P95 640ms        │
├───────────────────────────────────────────────────────────────────────────┤
│ 결과 코드 분포: 성공 1,247 · HTTP 오류 9 · 시간초과 21 · 회로열림 12 · 기타 4│
├───────────────────────────────────────────────────────────────────────────┤
│ 시각(KST)        연결       메서드 경로 템플릿        상태  지연   분기      │
│ 09-24 10:02:13   ERP 주문   GET    /orders/{0}       200   212ms 조건1     │
│ 09-24 10:01:58   ERP 주문   GET    /orders/{0}       —     3012ms 실패(시간초과)│
│                                                          ◀ 1 2 3 ▶ 총 1,284건│
└───────────────────────────────────────────────────────────────────────────┘
```

### 컴포넌트 분해

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `ApiCallLogFilterBar` | `from`/`to`(KST `YYYY-MM-DD`, 기본 최근 7일, 최대 92일 — 초과 시 `VALIDATION_FAILED` 인라인 "조회 기간은 최대 92일까지 가능합니다"), `connectionId?`(셀렉트, "전체" + 연결 목록), `outcome[]`(체크박스, 기본 전체), `source[]`(체크박스, 기본 `PUBLIC`+`SIMULATION_LIVE`) |
| `ApiCallLogSummaryCards` | `summary: ApiCallLogSummary` — 호출 수·성공률·주요 결과코드 카운트(시간초과·회로열림)·P95 지연 4장(`MetricCard` 재사용) |
| `ApiCallOutcomeDistribution` | `byOutcome: {outcome, count}[]` — 텍스트 목록(막대 없이 숫자만, 차트 라이브러리 미도입 원칙 승계) |
| `ApiCallLogTable` | `items: ApiCallLogItem[]`, `loading` | 컬럼: 시각(KST, 메타 타임존 포맷 — 하드코딩 금지, §9 참고), 연결명(`connectionName` 스냅샷 — 연결이 삭제돼도 표시 유지), 메서드, `pathTemplate`(치환 전, 예: `/orders/{0}`), HTTP 상태(실패는 "—"), 지연(ms), `ApiCallOutcomeBadge` + 분기(`conditionIndex`가 있으면 "조건{n}", 아니면 "기본"/"실패"/"안내") |
| `Pagination` | 기본 50/페이지, 최대 100 |

### 3.6.1 결과 코드 → 배지 라벨 매핑(`ApiCallOutcomeBadge`, 18종)

| 코드 | 라벨 | 톤 |
|---|---|---|
| `SUCCESS` | 성공 | 초록 |
| `MAPPING_MISSING` | 응답값 누락 | 주황 |
| `HTTP_ERROR` | HTTP 오류 | 주황 |
| `TIMEOUT` | 시간초과 | 주황 |
| `NETWORK_ERROR` | 연결 실패 | 주황 |
| `INVALID_RESPONSE` | 응답 형식 오류 | 주황 |
| `RESPONSE_TOO_LARGE` | 응답 초과 | 주황 |
| `REDIRECT_NOT_ALLOWED` | 리다이렉트 차단 | 회색 |
| `BLOCKED_ADDRESS` | 주소 차단 | 회색 |
| `BLOCKED_URL` | 요청 차단 | 회색 |
| `CIRCUIT_OPEN` | 회로 열림 | 회색 |
| `RATE_LIMITED` | 호출 제한 초과 | 회색 |
| `CONNECTION_DISABLED` | 연결 사용중지 | 회색 |
| `CONNECTION_MISSING` | 연결 없음 | 회색 |
| `METHOD_NOT_ALLOWED` | 허용되지 않은 메서드 | 회색 |
| `SECRET_MISSING` | 시크릿 미설정 | 회색 |
| `BINDING_MISSING` | 입력값 누락 | 회색 |
| `FEATURE_DISABLED` | 기능 꺼짐 | 회색 |

이 라벨은 **관리자 화면 전용**이다 — 결과 코드는 최종 사용자에게 절대 노출되지 않는다(FR-L9-7, 고정 문구만 노출).

### 타임존

목록·요약의 모든 시각은 **서버가 내려주는 KST 메타**(기존 통계 화면의 타임존 처리 관례, ADR-0017)를 그대로 쓴다 — 프런트가 타임존을 하드코딩하지 않는다.

---

## 3.9 L4-ext — 버전 복원 미리보기 경고 3종 확장

`version-history-ui-spec.md` §4.4.3 `RestoreWarningList`(기존 11종)에 아래 3종이 추가되어 **14종**이 된다(설계서 §15).

| `code` | 문구 |
|---|---|
| `API_CONNECTION_MISSING` | "대상 버전의 노드 {n}개가 존재하지 않는 API 연결을 참조합니다(복원 후 실행 시 실패 분기로 처리됩니다)." |
| `API_CONNECTION_DISABLED` | "대상 버전의 노드 {n}개가 사용 중지된 API 연결을 참조합니다(복원 후 실행 시 실패 분기로 처리됩니다)." |
| `API_LEGACY_FORMAT` | "대상 버전에 이전 형식 API 조건이 {n}건 포함되어 있습니다(복원해도 실행되지 않습니다)." |

- 셋 다 `blocker`가 아니다(복원을 막지 않음) — `RestoreWarningList`에 아이콘+텍스트로 나열되며 기존 `TARGET_INTEGRITY_WARNINGS` 등과 같은 시각 규칙을 그대로 따른다(색상 단독 금지, UIUX §1).
- 예약 배포(No.28)의 준비도 경고(G0')는 `versionRestore.preview()`를 그대로 재사용하므로 **추가 화면 변경 없이 자동으로** 이 3종을 포함한다(설계서 FR-L8-4).
- 버전 목록(L1, `version-history-ui-spec.md`)의 "⚠ 참조 경고 N건" 요약에도 이 3종이 합산된다(별도 UI 아님, 기존 카운트에 흡수).

---

## 4. 사용자 인터랙션 흐름 (제출 → 로딩 → 결과, 오류 처리)

### 4.1 연결 등록 → 시크릿 설정 → 테스트 성공 (S-4)

```
AC1 "+ 연결 추가" → ApiConnectionEditModal
  → 이름/URL/메서드/인증/시크릿참조 입력 → 저장(POST) → 201
  → 목록에 새 행, SecretStatusBadge=MISSING(경고 유지)
  → [연결 테스트] → BLOCKED_ADDRESS(사설) → 안내 문구(§3.1.3)
  → (운영자가 서버에 LEGACY_API_SECRET__ERP·allowlist 설정 후 재기동, 콘솔 밖)
  → 목록 새로고침 → SecretStatusBadge=CONFIGURED
  → [연결 테스트] 재시도 → 200 · 142ms · JSON 확인 → aria-live로 결과 낭독
```

### 4.2 노드에 v2 조건 설정 → 저장 → 설계 점검 (S-5)

```
D1b 노드 편집 → 아웃풋 추가 → 유형 "API 조건분기" 선택 → ApiConditionEditorV2 렌더
  → 연결 선택(개인정보 조회형이면 즉시 경고 배너) → 메서드 → 경로+경로값 → 쿼리 → 응답 매핑 → 조건 2개 → 불일치/실패 분기 선택
  → [미리보기] 샘플 "배송중" 선택 → 변수 status=SHIPPED, eta=09/26 · 조건1 일치 확인
  → [저장] → 200 → Toast
  → D1로 돌아와 [설계 점검] → "개인정보 조회형 연결을 참조하는 노드 1건"(INFO) 확인
```

### 4.3 공개 대화 — 한 턴 성공 (S-1)

```
사용자가 위젯에서 주문번호·전화번호를 포함한 폼을 완료하는 메시지 전송
  → (사용자 화면에는 별도 "조회 중" 표시 없음 — 같은 응답 안에서 완결)
  → 응답: "조회해 볼게요." + "주문하신 상품은 배송 중이며 09/26 도착 예정입니다."
  → 약 0.8초 이내 수신(NFR-LP2)
```

### 4.4 외부 시스템 장애 → 실패 분기 → 회로 열림 (S-2)

```
ERP 응답 없음(3초 타임아웃) → "조회실패안내" 노드의 안내문 + 버튼 노출(3.5초 이내)
  → (5회 연속 인프라 실패) → 60초간 회로 열림 → 이후 요청은 외부 호출 없이 즉시(10ms 이내) 같은 안내
  → AC1 목록에서 해당 연결에 CircuitOpenBadge 노출
  → L1(외부 연동 로그)에서 TIMEOUT·CIRCUIT_OPEN 건수 증가 확인
```

### 4.5 v1 노드 열람 → 전환 (S-7)

```
D1b에서 과거 노드 열람 → API 조건분기 카드가 읽기 전용(§3.3)으로 렌더 + LegacyFormatBadge
  → 헤더 값·본문 템플릿은 전부 [비공개] 또는 개수만
  → [연결로 전환] → 확인 대화상자("헤더·URL·본문은 사라집니다") → 확인
  → ApiConditionEditorV2로 교체(메서드+조건만 이관) → 연결·경로 등 나머지 입력
  → [저장] → 200
```

### 4.6 시뮬레이터 — 목 → 실제 호출 (S-6)

```
SIM1에서 대화 재현(기본 MOCK) → ApiStepPanel: "목 응답을 사용했습니다(샘플: 배송중)"
  → ApiModeToggle을 LIVE로 전환 → 같은 메시지 재전송
  → (조건 충족: GET·저장된 노드·simulation:write) → 실제 호출 → 지연 212ms 결과 표시
  → (POST 연결이었다면) LIVE 옵션 자체가 disabled + "POST는 시뮬레이터에서 실제로 호출하지 않습니다"
```

### 4.7 외부 연동 로그 조회 (S-8)

```
챗봇 상세 > 기본 통계 서브탭 > "외부 연동 로그" 클릭
  → 기본 기간(최근 7일) 조회 → 요약 카드 + 표
  → 기간을 30일로 변경 → 필터 재적용(요청 재조회) → 결과 갱신
  → 특정 행의 outcome=TIMEOUT 확인, 원문은 어디에도 없음을 확인(설계 의도)
```

### 4.8 버전 복원 — 연결 삭제 후 (S-9)

```
AC1에서 연결 "ERP 주문" 삭제(참조 노드 해제 후 가능) → 204
  → 버전 이력 화면(L4) > 과거 버전 v12 "복원" → RestoreDialog
  → RestoreWarningList에 "대상 버전의 노드 2개가 존재하지 않는 API 연결을 참조합니다…" 노출(blocker 아님)
  → [복원] 진행 → 복원 완료 → 해당 노드 실행 시 CONNECTION_MISSING 실패 분기로 동작
```

---

## 5. 권한별 UI 변화 규칙

신규 권한 문자열은 0종이다(J-14). 기존 권한의 적용 지점만 다음과 같이 넓어진다.

| 화면/요소 | VIEWER | EDITOR | ADMIN |
|---|---|---|---|
| AC1 목록 조회 | 비노출(`security:read` 없음 — 메뉴 자체가 숨김, `SystemSettingsMenu` F-4 원칙) | 비노출 | 표시(`security:read`) |
| AC1 생성·수정·삭제·테스트 | — | — | 가능(`security:write`) |
| D1b `ApiConnectionPickerField`(선택 목록) | 조회만 가능(`dialogue:read`) — URL·시크릿·인증방식은 애초에 응답에 없음 | 선택·저장 가능(`dialogue:write`) | 좌동 |
| D1b v2 폼 전체 | 읽기 전용(폼 필드가 `disabled`, 기존 `DialogNodeForm`의 읽기전용 규칙 상속) | 편집 가능 | 편집 가능 |
| `ApiConditionPreviewPanel` | 조회 가능(순수 클라이언트 연산, 쓰기 아님) | 가능 | 가능 |
| SIM1 `ApiModeToggle` | `MOCK`만 가능, `LIVE` 옵션 `disabled` + "이 역할은 실제 호출 권한이 없습니다" | `LIVE` 가능(`simulation:write`, 조건 충족 시) | 좌동 |
| L1 외부 연동 로그 | 조회 가능(`chatbot:read`) | 조회 가능 | 조회 가능 |
| L4 복원 경고 3종 | 복원 자체가 `dialogue:write`+`chatbot:write` 필요이므로 VIEWER는 복원 대화상자 진입 불가(기존 규칙 상속) | 조건 충족 시 가능 | 가능 |

`SystemSettingsMenu`(`security-audit-ui-spec.md` §3.6)의 `ITEMS` 배열에 `{ label: 'API 연결', href: '/settings/api-connections', permission: 'security:read' }`를 추가한다 — 배열 순서는 "회원 관리 → 금지어 관리 → **API 연결**(신규) → 이력 관리 → 예약 배포 현황"으로, 보안 설정 항목(회원·금지어·API 연결)을 앞쪽에 모은다.

---

## 6. `UIUX_준수기준.md` 체크리스트 매핑

### 6.1 공통(이 그룹 신규/확장 화면 전체)

| 기준 | 항목 | 적용 |
|---|---|---|
| §1 색상대비 | 색상 단독 금지 | §2.1의 모든 배지(`SecretStatusBadge`·`ConnectionEnabledBadge`·`CircuitOpenBadge`·`ApiCallOutcomeBadge` 등)가 아이콘/텍스트 병기. `LegacyFormatBadge`는 기존 `UnsupportedOutputBadge`(INFO)와 톤을 다르게(WARNING) 해 "전환 가능"이라는 차이를 색+텍스트 둘 다로 전달 |
| §3 키보드접근성 | Tab/Enter/Space, Esc+포커스복귀 | `ApiConnectionPickerField`(콤보박스, `ResourcePickerField` 패턴 상속), `SampleResponseListEditor`/`ApiQueryListEditor`/`ApiBodyFieldListEditor`/`ApiResponseMappingListEditor`(전부 `ReorderableList` — 드래그 없음, 위/아래 버튼만), `ConvertLegacyApiConditionDialog`(모달, 기본 포커스 "취소") |
| §4 버튼 | 동사형, 44×44px, 중복 실행 방지 | "연결 추가"/"연결 테스트"/"미리보기"/"쿼리 추가"/"매핑 추가", 저장·테스트 버튼은 요청 중 `disabled`(연타 방지) |
| §5 텍스트입력필드 | 레이블 필수, 글자수 카운터, 복사·붙여넣기 제한 금지 | 이름(50자)·설명(300자)·경로(300자)·샘플 본문(16KB) 등 전 필드 `<label htmlFor>` |
| §6 폼 컨트롤 | 단일선택=라디오/셀렉트, 다중선택=체크박스 | 인증 방식(라디오 4)·메서드(라디오 2, 노드 편집기)/체크박스 2(연결 편집기 허용 메서드)·`ApiModeToggle`(라디오 2)·결과 필터(체크박스) |
| §7 오류 메시지 | 원인+해결방법 | 연결 테스트 실패 `guidance` 문구(§3.1.3), 설계 점검 항목(§3.5) 전부 "무엇이 문제고 어디서 고치는지" 텍스트 |
| §8 로딩/상태 | 스켈레톤/스피너, 완료 배지, `aria-live` 비동기 대기 | 연결 테스트 결과 `aria-live="polite"`(§3.1.3), L1 요약 카드는 0건도 "정상 완료"로 표시, SIM1 응답 대기 표시는 기존 `role="status"` 패턴을 그대로 상속(API 턴도 같은 응답 한 번에 오므로 별도 비동기 패턴 불필요 — NFR-LA4는 "기존 표시가 이미 충분함"으로 확인, §9 참고) |
| §9 내비게이션 | href 기반, 페이지네이션 이중 표시 | `SystemSettingsMenu` 신규 항목, `StatsShell` 신규 서브탭(둘 다 `<NavLink>`), L1 `Pagination` 재사용 |

### 6.2 화면별 특기 사항

| 화면 | 항목 | 지점 |
|---|---|---|
| AC1 | §1(제안-자산 분리 원칙의 변형) | 샘플 응답은 "관리자가 작성한 목 데이터"이며 실제 운영 자산(연결 설정)과 시각적으로 구분되는 별도 섹션(경고 배너 포함)에 둔다 — §1의 "제안-자산 분리" 정신과 유사하게 "시험용 데이터 vs 실제 설정"을 분리 |
| D1a-v2 | §6(경로 자리표시자와 경로값 자동 동기화) | 폼 자동 제출은 아니므로 §6 "셀렉트 자동 제출 금지"에 저촉되지 않음(값 개수만 동적으로 늘고 줆) |
| D1a-v1 | §1(색상 단독 금지) | `LegacyFormatBadge` 주황 배경 + "이전 형식" 텍스트 |
| SIM1-ext | §8(비동기 대기 패턴 재확인) | API 턴도 공개 대화와 동일하게 **한 응답으로 완결**되므로(J-5) `nlu-rag-answering-ui-spec.md`의 RAG PENDING류 "진행 중" 패턴은 필요 없다 — 기존 "응답 생성 중"(`role="status"`) 표시로 충분 |
| L1 | §9(페이지네이션) | 기본 50/최대 100, 현재 페이지 밑줄+형태 구분(기존 `Pagination` 규칙 상속) |
| L4-ext | §1(경고 아이콘+텍스트) | 기존 `RestoreWarningList` 규칙 그대로 상속, 신규 3종도 동일 컴포넌트 재사용이라 별도 구현 없음 |

### 6.3 자동화 연계

`AC-L8-1`(키보드만으로 연결 등록 → v2 조건 설정 → 저장 완주), `AC-L8-2`(신규 화면 3종 axe 대비 위반 0건), `AC-L8-3`(연결 테스트 실패 안내가 `aria-live`로 낭독)은 `test-automation` 검증 대상이며, 이 문서의 `ApiConnectionPickerField`/`ReorderableList` 계열 컴포넌트가 그 전제 조건이다.

---

## 7. 반응형 고려사항

브레이크포인트는 선행 문서들과 동일(데스크톱 ≥1024px / 태블릿 640~1023px / 모바일 <640px, `chatbot-operations-ui-spec.md` §8 기준 상속).

| 브레이크포인트 | 레이아웃 변화 |
|---|---|
| 데스크톱(≥1024px) | AC1: 목록 표 전 열 노출. D1b v2 폼: 필드 2열(좌: 연결·메서드·경로, 우: 쿼리·본문·매핑) 또는 상하 스택(폭에 따라 선택 — 아웃풋 카드가 이미 폭 제약을 받는 컨텍스트이므로 상하 스택을 기본으로 권고). L1: 요약 카드 4장 가로 1줄 + 표 전 열 |
| 태블릿(640~1023px) | AC1: 표 컬럼 중 "24h 호출/실패"를 이름 아래 보조 텍스트로 이동(열 수는 유지). D1b v2 폼: 완전 세로 스택. L1: 요약 카드 2×2 |
| 모바일(<640px) | AC1: 표 대신 카드 리스트(`ApiConnectionCard` — 이름+배지+메서드를 라벨-값 스택, 액션은 카드 하단 버튼). D1b v2 폼: 전체화면 폭, `ApiConditionPreviewPanel`은 접이식 기본 접힘(공간 절약). L1: 요약 카드 세로 스택, 표는 가로 스크롤 컨테이너(헤더 `sticky`) — `integrated-stats-ui-spec.md` §8의 표 대응과 동일 처리 |

공통 원칙: `ReorderableList` 계열(쿼리·본문·매핑·조건·샘플 응답)은 모바일에서도 위/아래 버튼을 유지하고 드래그로 대체하지 않는다(선행 문서 §7 원칙 재확인). 텍스트 영역(샘플 본문 JSON, 경로)은 모든 폭에서 컨테이너 전체 너비를 쓴다(UIUX §5).

---

## 8. `messages.ts` 추가 문구 키 목록

`apps/web/src/constants/messages.ts`에 아래를 추가한다. 값은 이 문서의 인용 문구를 초안으로 삼는다.

### 8.1 신규 네임스페이스 `MESSAGES.apiConnections`

```
pageTitle, searchLabel, filterEnabledLabel, addButton,
columnName, columnHost, columnMethods, columnAuth, columnSecret, columnStatus,
columnReferencing, column24h,
badgeEnabled, badgeDisabled, badgeCircuitOpen, badgeInsecureHttp,
badgePersonalDataLookup, badgeRawPersonalData,
secretStatusConfigured, secretStatusMissing, secretStatusNotRequired,
emptyTitle, emptyDesc,
modalCreateTitle, modalEditTitle,
fieldName, fieldDescription, fieldBaseUrl, fieldBaseUrlInsecureHint,
fieldAllowedMethods, fieldAuthType, authTypeNone, authTypeApiKey, authTypeBearer, authTypeBasic,
fieldAuthHeaderName, fieldSecretRef, secretRefMissingHint(ref),
fieldTimeoutMs, fieldRateLimitPerMin,
fieldAllowRawPersonalData, confirmRawPersonalDataLabel, confirmRawPersonalDataMismatch,
fieldPersonalDataLookup, personalDataLookupHint,
sampleResponsesTitle, sampleResponsesWarning, addSample, sampleLabel, sampleHttpStatus, sampleBody, sampleBodyInvalidJson,
fieldEnabled,
saveSuccess, duplicateName,
testPanelTitle, testPathLabel, testButton, testSuccess(status, latency),
testGuidanceBlockedPrivate(ip), testGuidanceBlockedLoopback, testGuidanceSecretMissing(ref),
testGuidanceTimeout(seconds), testGuidanceFeatureDisabled,
deleteConfirmTitle, deleteConfirmDesc, deleteInUseBanner(count), deleteInUseItem(chatbotName, nodeName),
pickerNoResult(query), pickerCreateLink, pickerCreateHint, pickerDisabledSuffix
```

### 8.2 신규 네임스페이스 `MESSAGES.apiCallLogs`

```
tabLabel, pageTitle,
filterFromLabel, filterToLabel, filterConnectionLabel, filterConnectionAll, filterOutcomeLabel, filterSourceLabel,
rangeTooWide,
summaryTotalCalls, summarySuccessRate, summaryP95, summaryTimeouts, summaryCircuitOpen,
outcomeDistributionTitle,
columnTime, columnConnection, columnMethod, columnPath, columnStatus, columnLatency, columnBranch,
branchCondition(n), branchDefault, branchFailure, branchNotice,
outcomeLabel: { SUCCESS, MAPPING_MISSING, HTTP_ERROR, TIMEOUT, NETWORK_ERROR, INVALID_RESPONSE,
  RESPONSE_TOO_LARGE, REDIRECT_NOT_ALLOWED, BLOCKED_ADDRESS, BLOCKED_URL, CIRCUIT_OPEN, RATE_LIMITED,
  CONNECTION_DISABLED, CONNECTION_MISSING, METHOD_NOT_ALLOWED, SECRET_MISSING, BINDING_MISSING, FEATURE_DISABLED },
emptyTitle
```

### 8.3 기존 `MESSAGES.dialogue.outputFields` 네임스페이스 추가(§3.2~§3.4)

```
apiConnectionLabel, apiConnectionHelp,
apiMethodV2Label, apiMethodDisallowedHint,
apiPathLabel, apiPathHelp, apiPathInvalidChars,
apiPathParamLabel(n), apiBindingKindConst, apiBindingKindSlot, apiBindingSlotEmptyHint,
apiQueryLabel, addApiQuery, apiQueryName,
apiBodyLabel, addApiBodyField, apiBodyFieldName,
apiResponseMappingLabel, addApiResponseMapping, mappingName, mappingPath, mappingRequired, mappingMaxLength,
apiDefaultBranchLabel, apiDefaultBranchHint, apiFailureBranchLabel, apiFailureBranchHint,
apiOutputTerminalHint,
personalDataLookupWarning,
apiPreviewTitle, apiPreviewSourceSample, apiPreviewSourceManual, apiPreviewButton,
apiPreviewVariables, apiPreviewMatchedCondition(n), apiPreviewNoMatch, apiPreviewMissingRequired(name),
apiPreviewTextSample,
legacyBadgeLabel, legacyMethodReadonly, legacyUrlReadonly, legacyHeadersCount(n), legacyBodyHidden,
legacyConditionsReadonly,
convertButton, convertConfirmTitle, convertConfirmDesc, convertStartedHint,
saveBlockedLegacyFormat,
copyExcludedLegacyApi(count)
```

### 8.4 기존 `MESSAGES.simulator` 네임스페이스 추가(§3.7)

```
apiModeLabel, apiModeMock, apiModeLive, apiModeLiveDisabledPost, apiModeLiveDisabledUnsaved,
apiModeLiveDisabledNoPermission,
apiStepTitle, apiStepMock(sampleLabel), apiStepLive(latencyMs), apiStepDowngraded(reason),
apiStepConnection, apiStepBranch, apiStepVariables,
mockSourceLabel, mockSourceSample, mockSourceManual, mockSourceFailure,
compareApiMockNotice
```

### 8.5 기존 `MESSAGES.systemSettings` 네임스페이스 추가

```
apiConnections: 'API 연결',
```

### 8.6 기존 `MESSAGES.versions`(복원 경고) 네임스페이스 추가

```
restoreWarningApiConnectionMissing(count), restoreWarningApiConnectionDisabled(count),
restoreWarningApiLegacyFormat(count),
```

---

## 9. `frontend-implementer` 인계 메모

1. **`ResourcePickerField` 확장이 최우선 선행 작업**이다 — `resourceType` 유니온에 `'apiConnection'`을 추가하고 `GET /api-connections/picker`를 연결한다(§2.2). 이 컴포넌트가 D1a-v2·AC1(테스트 대화상자 등)·SIM1-ext 다수 지점에서 재사용된다.
2. **구현 순서 권고**: ① `ApiConnectionEditModal`/AC1 목록(독립적으로 먼저 완성 가능, 다른 화면이 의존) → ② `ResourcePickerField` `apiConnection` 확장 → ③ `ApiConditionEditorV2`(D1b, 가장 복잡) + `ApiConditionPreviewPanel`(공유 `api-mapping.ts` 순수 함수를 브라우저에 그대로 import — Node 전용 심볼이 없는지 `backend-implementer` 산출물에서 재확인) → ④ v1 읽기전용 카드·전환 다이얼로그(§3.3) → ⑤ 설계 점검·흐름 미리보기 확장(서버 응답 필드만 늘어나므로 기존 컴포넌트 소폭 수정) → ⑥ SIM1 `ApiStepPanel` → ⑦ L1 외부 연동 로그(신규 페이지, 독립적) → ⑧ L4 복원 경고 3종(기존 `RestoreWarningList`에 매핑 3줄 추가).
3. **L1 라우트 배치는 확정이 아니라 권고다**(§1 마지막 문단) — `StatsShell` 3번째 서브탭으로 붙이는 안을 우선 검토하되, 기존 `AC-C-3`(No.5 그룹, "라우트 6개 고정") 수용기준과 충돌 여부를 `code-reviewer`/`test-automation` 단계에서 확인한다. 충돌하면 최상위 탭 신설로 전환하고 `system-architect`에게 `AC-C-3` 갱신을 요청한다.
4. **v1 카드는 순수 표시 전용**이다 — 기존 `ApiConditionEditor`(v1, `DialogOutputEditor.tsx` 473~652행)의 `showHeaders` 토글·헤더 key/value 입력·`bodyTemplate` textarea는 전부 제거한다(서버가 값을 안 주므로 토글할 대상 자체가 없다). 완전히 새 컴포넌트(`LegacyApiConditionReadonlyCard`)로 교체할 것을 권장한다(기존 컴포넌트를 read-only 모드로 억지로 재사용하면 미사용 상태 분기가 남는다).
5. **v2 조건 편집 UI는 기존 조건 리스트(`path`/`operator`/`value`/`nextNodeId`)를 최대한 재사용**한다 — `dialogue.ts`의 `ApiConditionItemSchema`는 v1과 v2가 공유하는 필드다(연산자 8종·`ResourcePickerField(node)` 그대로).
6. **`ApiConditionPreviewPanel`의 순수 함수 재사용**은 `packages/shared-types/src/api-mapping.ts`를 `apps/web`에서 직접 import하는 것을 전제로 설계했다 — `zod` 무의존이라 번들 크기 영향이 작다(설계서 §4.5). 만약 `backend-implementer`가 이 패키지를 `apps/api` 전용으로 가정하고 Node 전용 의존을 섞으면 프런트에서 import가 깨지므로, 착수 전에 이 전제를 재확인할 것.
7. **개인정보 마스킹 표시(SIM1 `apiStep.variables`)는 서버가 이미 마스킹한 값을 그대로 렌더링**한다 — 클라이언트가 다시 마스킹하지 않는다(이중 마스킹으로 값이 더 가려지는 버그 주의).
8. **`SystemSettingsMenu.tsx`** `ITEMS` 배열에 항목 1개만 추가하면 된다(§5) — 컴포넌트 로직 변경 없음.
9. **`StatsShell.tsx`**에 3번째 `NavLink`(`stats/api-calls`, `chatbot:read`)를 추가하고 `App.tsx`에 `<Route path="api-calls" element={<ApiCallLogPage />} />`를 `stats` 중첩 라우트 안에 추가한다(§1 배치 확정 시).
10. **`DialogOutputEditor.tsx:126`의 하드코딩 제거**: `(value.type === 'SCENARIO' || value.type === 'SURVEY' || value.type === 'API_CONDITION')` 조건을 공유 판정 함수 `isUnsupportedOutput(output)`(`packages/shared-types`, FR-L1-5)로 교체한다 — v2 `API_CONDITION`에는 배지가 뜨면 안 되므로 이 교체가 **필수**다(교체하지 않으면 정상 실행되는 v2에도 잘못 배지가 뜬다).
