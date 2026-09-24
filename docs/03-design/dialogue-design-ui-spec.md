# 대화 설계(빌더) — "대화설계" 그룹(No.5~9) 화면 설계서

> **대상 기능**: No.5 대화그래프(시나리오) 빌더 / No.6 의도(Intent)·키워드(Entity) 관리 / No.7 동음이의어·다의어 사전 / No.8 컨텍스트(멀티턴·슬롯필링) 관리 / No.9 FAQ 관리
> **입력 문서**: `docs/requirements/dialogue-design.md`(FR/AC/EX, §4.5.1·§9.2 캔버스 제외 결정), `docs/02-spec/dialogue-design-설계.md`(§4 스키마, §5 API 50개, §7 엔진, §9 프런트 제약), `docs/02-spec/decisions/ADR-0005~0008`
> **선행 화면 설계**: `docs/03-design/chatbot-operations-ui-spec.md`(재사용 컴포넌트·문구 규약의 출처), 현재 코드 `apps/web/src/App.tsx`, `apps/web/src/pages/ChatbotDetailLayout.tsx`(dashboard/settings/skin 3탭 기존 구현)
> **준수 기준**: `docs/03-design/UIUX_준수기준.md`(전 항목, 특히 §3 드래그앤드롭 금지·키보드 동등조작)
> **작성**: ui-designer · 2026-09-19 · **다음 단계**: `backend-implementer` → `frontend-implementer`
> **범위 경계**: 실제 React 컴포넌트 코드는 작성하지 않는다. 여기서 정의한 화면/라우트/컴포넌트/props/문구는 `frontend-implementer`가 구현 기준으로 그대로 사용한다. 드래그앤드롭 비주얼 캔버스는 요구사항 §4.5.1·§9.2에 따라 이 문서에서도 다루지 않는다(리스트/폼 기반).
>
> **[2026-09-24 갱신 — No.26 레거시 API 연동]** §4.2.1 ⑫행·주석과 §8 미결정 항목 1건을 갱신했다. `API_CONDITION` v2(연결 레지스트리 기반) 편집 폼은 이 문서가 아니라 `docs/03-design/legacy-api-integration-ui-spec.md` §4.2에서 정의한다 — 이 문서는 **v1(이전 형식) 노드의 읽기 전용 표시**만 계속 다룬다.

---

## 0. 전제와 설계 결정

### 0.1 탭 구조 결정 — "대화설계" 상위 탭 1개 + 좌측 서브내비 5종 (채택)

system-architect의 권고(요구사항 §11, 설계서 §9)를 그대로 채택한다. 근거를 추가한다.

- 기존 3탭(`dashboard`/`settings`/`skin`)에 5개 화면을 평면 탭으로 추가하면 8탭이 되어 `TabNav`가 한 줄에 들어가지 않고, 화면마다 성격이 다른(운영관리 vs 콘텐츠 설계) 항목이 뒤섞여 탐색 부담이 커진다.
- "대화설계"는 서로 강하게 참조하는 5개 리소스(의도·키워드·동음이의어·컨텍스트·노드)의 묶음이므로, 상위 탭 아래 **전용 서브 셸**(좌측 내비 + 본문)을 두면 관계를 시각적으로도 드러낼 수 있다.
- 기존 스킨/임베드 탭이 이미 "URL 세그먼트는 1개, 그 안의 전환은 클라이언트 상태"(`chatbot-operations-ui-spec.md` §3.5) 선례를 남겼으나, 이 그룹은 **5개 화면 각각이 독립된 CRUD 도메인**이라 스킨/임베드처럼 가볍게 묶을 수 없다. 따라서 서브내비 5종은 **URL 세그먼트**로 만든다(요구사항 §11 ①, 설계서 §9 라우팅 항목과 동일 결론).

**최상위 탭은 4개**가 된다: `대시보드`(dashboard) · `기본설정`(settings) · `스킨/임베드`(skin) · **`대화설계`(dialogue, 신규)**. `TabNav`(`apps/web/src/pages/chatbot-detail/TabNav.tsx`)에 4번째 `NavLink`를 추가하고, `isActive` 판정은 `/chatbots/:id/dialogue`로 시작하는 모든 경로에 대해 참이 되어야 한다(react-router `NavLink`의 `end` 옵션을 주지 않으면 접두 매칭이 기본 동작이므로 그대로 사용 가능).

### 0.2 라우팅 확정

```
/chatbots/:chatbotId/dialogue                         → /chatbots/:chatbotId/dialogue/nodes 로 리다이렉트
/chatbots/:chatbotId/dialogue/nodes                    대화그래프 — 노드 목록 + 흐름 미리보기 + 설계 점검
/chatbots/:chatbotId/dialogue/nodes/new                노드 생성 폼
/chatbots/:chatbotId/dialogue/nodes/:nodeId             노드 편집 폼
/chatbots/:chatbotId/dialogue/intents                  의도·키워드 — ?resource=intent|keyword (기본 intent)
/chatbots/:chatbotId/dialogue/homonyms                 동음이의어/다의어 사전 목록(+ 편집은 모달)
/chatbots/:chatbotId/dialogue/contexts                 컨텍스트 목록
/chatbots/:chatbotId/dialogue/contexts/new              컨텍스트 생성 폼
/chatbots/:chatbotId/dialogue/contexts/:contextId       컨텍스트 편집 폼
/chatbots/:chatbotId/dialogue/faqs                      FAQ 목록(+ 편집은 모달)
```

- 서브내비 5종(대화그래프/의도·키워드/동음이의어/컨텍스트/FAQ)은 위 5개 최상위 세그먼트(`nodes|intents|homonyms|contexts|faqs`)와 1:1이며, 요구사항 §11이 명시한 순서(대화그래프→의도·키워드→동음이의어→컨텍스트→FAQ)와도 일치한다. **서브내비 기본 진입(랜딩)은 `nodes`** 로 한다 — 대화그래프 화면이 흐름 미리보기·설계 점검을 포함한 "허브" 성격이라 대화설계 그룹에 처음 들어온 관리자가 전체 그림을 먼저 보게 하기 위함이다.
- 노드/컨텍스트는 필드·서브 구조가 많아(아웃풋 12종 / 슬롯 최대 20개) **모달이 아니라 전용 라우트 페이지**로 만든다(뒤로가기·새로고침으로 작성 중 상태를 잃지 않게 하려는 목적도 있음 — 단 `UnsavedGuardContext`로 이탈은 계속 가드한다).
- 의도·키워드(`intents`)는 두 리소스가 서로의 참조 대상이라 화면을 붙여두는 것이 관리자 워크플로에 맞고(S-1~S-3), 필드 수가 적어(이름/설명/예문·동의어) 리스트+모달로 충분하다. 스킨/임베드와 같은 **클라이언트 상태 서브탭 패턴**(`?resource=` 쿼리)을 재사용한다.
- 동음이의어·FAQ는 필드는 많지만(동음이의어는 의미 반복 블록, FAQ는 대체질문) 화면 하나에 모두 담아도 스크롤 가능한 모달 크기(`modal--lg`)로 무리가 없어 모달을 유지한다. 각 리스트 행에는 `?edit=:id` 형태의 선택적 쿼리로 딥링크할 수 있게 해 "설계 점검 → 문제 리소스로 바로가기"가 동작하게 한다(§4.1 참고).

### 0.3 의존 스키마·인프라 — 아직 코드에 없음 (경고)

- 이 문서가 참조하는 모든 스키마(`IntentListItemSchema`, `DialogNodeSchema`, `DialogueBundleSchema`, `ImportValidateResultSchema` 등)는 설계서 §4 기준 **아직 `packages/shared-types`에 반영되지 않았다.** `backend-implementer`의 산출물이 선행되어야 한다.
- **`apiClient`(`apps/web/src/api/client.ts`)는 현재 JSON 요청만 지원한다**(`Content-Type: application/json` 고정, `body: JSON.stringify(...)`). 대량 업로드(FR-6-19~30, FR-9-9)는 `multipart/form-data`로 파일을 보내야 하므로, `frontend-implementer`는 `apiClient`에 `postForm(path, formData)` 같은 별도 진입점을 추가해야 한다(기존 `post`를 억지로 재사용하지 말 것 — `Content-Type` 헤더를 `FormData` 사용 시 브라우저가 자동으로 boundary를 붙이도록 직접 지정하지 않아야 함).
- `ApiError`의 `code`/`details` 파싱은 이미 구현되어 있다(`chatbot-operations-ui-spec.md` §6.1이 요구했던 확장이 완료된 상태) — 이 그룹은 그 위에서 바로 `code` 16종(§6 표)을 분기하면 된다.
- UI 문구는 전부 `apps/web/src/constants/messages.ts`에 `MESSAGES.dialogue.*` 네임스페이스로 신설해 담는다(FR-0-8). 본 문서의 모든 따옴표 문구는 그 상수의 값 초안이다.

---

## 1. 화면 목록 및 라우트

| ID | 화면명 | 라우트 | 형태 | 진입 경로 |
|---|---|---|---|---|
| D0 | 대화설계 공통 셸(서브내비) | `/chatbots/:chatbotId/dialogue/*` | 페이지(좌측 내비+본문) | `TabNav` "대화설계" |
| D1 | 대화그래프 — 노드 목록/흐름미리보기/설계점검 | `/chatbots/:chatbotId/dialogue/nodes` | 페이지 | D0 서브내비 기본 진입 |
| D1a | 노드 생성 | `/chatbots/:chatbotId/dialogue/nodes/new` | 페이지 | D1 "+ 노드 추가" |
| D1b | 노드 편집 | `/chatbots/:chatbotId/dialogue/nodes/:nodeId` | 페이지 | D1 행 클릭/편집, 설계 점검 항목 바로가기 |
| D2 | 의도·키워드 관리 | `/chatbots/:chatbotId/dialogue/intents?resource=intent\|keyword` | 페이지(클라이언트 서브탭) | D0 서브내비 |
| D2a | 의도 생성/편집(예문 포함) | 모달(D2 위) | 모달 | D2 "+ 의도 추가"/행 편집 |
| D2b | 키워드 생성/편집(동의어 포함) | 모달(D2 위) | 모달 | D2 "+ 키워드 추가"/행 편집 |
| D2c | 의도/키워드 대량 업로드 | 모달(D2 위, `BulkImportModal`) | 모달(3단계) | D2 "엑셀/CSV 업로드" |
| D3 | 동음이의어/다의어 사전 목록 | `/chatbots/:chatbotId/dialogue/homonyms` | 페이지 | D0 서브내비 |
| D3a | 동음이의어 항목 생성/편집(+ 테스트 패널) | 모달(D3 위, `?edit=:id` 지원) | 모달 | D3 "+ 항목 추가"/행 편집 |
| D4 | 컨텍스트(슬롯필링) 목록 | `/chatbots/:chatbotId/dialogue/contexts` | 페이지 | D0 서브내비 |
| D4a | 컨텍스트 생성 | `/chatbots/:chatbotId/dialogue/contexts/new` | 페이지 | D4 "+ 컨텍스트 추가" |
| D4b | 컨텍스트 편집(+ 대화 미리보기) | `/chatbots/:chatbotId/dialogue/contexts/:contextId` | 페이지 | D4 행 편집 |
| D5 | FAQ 목록 | `/chatbots/:chatbotId/dialogue/faqs` | 페이지 | D0 서브내비 |
| D5a | FAQ 생성/편집(+ 유사질문 추천) | 모달(D5 위, `?edit=:id` 지원) | 모달 | D5 "+ FAQ 추가"/행 편집 |
| D5b | FAQ 대량 업로드 | 모달(D5 위, `BulkImportModal`) | 모달(3단계) | D5 "엑셀/CSV 업로드" |

---

## 2. 공통 컴포넌트

### 2.1 기존 재사용 컴포넌트 (변경 없이 그대로 사용)

| 컴포넌트 | 재사용 방식 |
|---|---|
| `Modal` / `ConfirmDialog`(`components/Modal.tsx`) | D2a/D2b/D2c/D3a/D5a/D5b 전부. 파괴적 액션(삭제/일괄삭제/커밋 확정)은 `ConfirmDialog(danger=true)`, 기본 포커스 "취소" |
| `Toast` | 저장/삭제 성공, 오류 코드 미분류 시 공통 안내 |
| `InlineFieldError` | 모든 폼 필드 인라인 오류(§5.4 필드 매핑표 참고) |
| `Skeleton`(`SkeletonRow`/`SkeletonCard`) | 목록/트리/리포트 표 로딩 |
| `EmptyState` | 리소스 0건 5종(§4 각 화면 "빈 상태" 절) |
| `ErrorState` | 목록/흐름/설계점검 조회 실패(5xx·네트워크) |
| `Pagination` | 의도/키워드/FAQ/노드 목록 |
| `KebabMenu` | 행 액션(편집/복사/삭제) 메뉴 |
| `CopyButton` | 예문·오류 CSV 등 텍스트 복사가 필요한 지점(선택적) |
| `useUnsavedGuard`(`UnsavedGuardContext`) | 노드/컨텍스트 편집 페이지(NFR-A9) — 탭 이동·뒤로가기·서브내비 전환 전부 가드 |
| `StatusBadge` 패턴(색상+아이콘+텍스트 병기 구조) | 아래 §2.3 신규 배지들이 동일 구조를 따른다 |

### 2.2 신규 공통 컴포넌트 5종

#### (1) `FileUploadField` — 파일 업로드 + 진행/오류 표시

```
props: {
  id: string; label: string;
  accept: string;                       // ".csv,.xlsx"
  maxSizeBytes: number;                 // 5 * 1024 * 1024
  file: File | null;
  onFileSelected: (file: File | null) => void;
  uploading?: boolean;                  // 검증/커밋 요청 진행 중
  progressLabel?: string;               // "검증 중…" / "반영 중…"
  errorMessage?: string;                // 클라이언트 사전검증 실패(확장자/크기) 또는 서버 오류
  helpText?: string;                    // "템플릿과 동일한 형식(.xlsx, .csv)만 업로드할 수 있습니다."
}
```

- **드래그앤드롭은 보조 수단으로만 허용**하고, 반드시 `<label htmlFor={id}>파일 선택</label>` + 숨김 `<input type="file">` 조합으로 키보드/스크린리더 접근이 가능해야 한다(UIUX §3, §5 — 플레이스홀더로 레이블 대체 금지와 동일 원칙의 연장).
- 선택된 파일은 파일명 + 용량(KB/MB 단위) 텍스트로 표시하고, "파일 제거" 버튼(44×44px 터치영역, UIUX §4)을 제공한다.
- `uploading=true`인 동안: 진행 표시(스피너 + `progressLabel`, UIUX §8), 업로드/검증/반영 버튼은 전부 `disabled` — 연타해도 요청 1회만 발생(FR-6-28, AC-6B-10).
- 클라이언트 사전검증: 확장자(`.csv`/`.xlsx`)와 `maxSizeBytes` 초과를 즉시 인라인 오류로 표시하고 네트워크 요청을 보내지 않는다(서버 재검증은 그대로 유지, NFR-S1과 모순 없음 — 이중 방어).

#### (2) `ImportValidationReportTable` — 검증/커밋 결과 표

```
props: {
  summary: { totalRows, newItems, updatedItems, newValues, duplicatedRows };
  errors: { row: number; column: string; value: string; code: ImportRowErrorCode; message: string }[];
  conflicts?: { value: string; ownerId: string; ownerName: string }[];
  onJumpToOwner?: (ownerId: string) => void;   // 충돌 대상 리소스로 바로가기
}
```

- 상단에 요약 배지 5개(총 행수/신규/갱신/중복 무시/오류 건수)를 UIUX §8 "완료 상태 배지"로 표시한다. 오류 건수 배지는 0건이 아니면 `SeverityBadge(severity='ERROR')` 색상을 함께 쓴다.
- 오류 표는 `<table>`(네이티브 시맨틱 요소)로 구현해 스크린리더가 행/열을 읽을 수 있게 하고, 각 셀은 정적 텍스트라 별도 포커스 트랩이 필요 없다(NFR-A4). 컬럼: `행 번호`(1-base), `열`, `값`(원문, 최대 200자 표시 후 말줄임), `오류 코드`(`ImportRowErrorBadge` — 코드별 한국어 라벨, §2.3), `메시지`.
- 50행을 초과하면 클라이언트 페이지네이션(`Pagination` 재사용, `pageSize=50`)을 적용한다 — 서버는 이미 전체 `errors[]`를 한 번에 내려주므로(FR-6-22) 추가 API 호출 없이 클라이언트에서만 자른다.
- `conflicts`가 있으면 별도 섹션 "이미 존재하는 항목과 충돌"으로 `{value} → {ownerName}에 이미 존재`를 나열하고, `onJumpToOwner`가 있으면 링크로 제공한다.

#### (3) `ReorderableList` — 순서 변경 리스트 (드래그 금지, 위/아래 버튼)

```
props<T>: {
  items: T[];
  getKey: (item: T) => string;
  onChange: (items: T[]) => void;
  renderItem: (item: T, index: number) => ReactNode;
  itemLabel: (item: T) => string;      // 버튼 aria-label에 쓸 항목명(예: "1번째 아웃풋(텍스트)")
  minItems?: number; maxItems?: number;
  onAdd?: () => void; addLabel?: string;
  onRemove?: (key: string) => void;
}
```

- **드래그앤드롭 핸들을 두지 않는다.** 각 항목 행 우측에 "▲ 위로"/"▼ 아래로" 버튼(각각 44×44px 이상, UIUX §4)만 제공한다. 첫 항목은 "위로", 마지막 항목은 "아래로"가 `disabled` + `aria-disabled="true"`.
- **포커스 유지(AC-5-8)**: 버튼 클릭(또는 Enter/Space)으로 순서가 바뀐 뒤에도 포커스가 **이동한 항목의 같은 버튼**에 남아 있어야 한다. 구현 지침: 각 항목 버튼에 `key`(리소스 id) 기반 `ref` 맵을 두고, `onChange` 이후 `useEffect`에서 이동한 항목의 버튼에 `.focus()`를 명시적으로 호출한다(리액트가 DOM을 재배치하면서 포커스가 유실되는 것을 막기 위함).
- 노드 아웃풋(최대 10), 아웃풋 내 버튼(최대 5)·API 조건(최대 10), 동음이의어 의미(최대 10), 컨텍스트 슬롯(최대 20)에서 전부 이 컴포넌트를 재사용한다. `maxItems` 도달 시 `onAdd` 트리거 버튼은 `disabled` + 안내 문구("최대 10개까지 추가할 수 있습니다").

#### (4) `ResourcePickerField` — 검색형 리소스 선택기 (ID 직접 입력 금지, FR-5-20)

```
props: {
  id: string; label: string;
  resourceType: 'intent' | 'keyword' | 'context' | 'node';
  chatbotId: string;
  multiple: boolean;
  value: string[] | string | null;      // multiple이면 string[]
  onChange: (value: string[] | string | null) => void;
  excludeIds?: string[];                 // 노드 자기참조 방지 등
  createHref?: string;                   // 검색 결과 0건일 때 "새로 만들기" 바로가기
  required?: boolean;
}
```

- 텍스트 입력에 타이핑하면 300ms 디바운스 후 해당 리소스의 목록 API를 `q=`로 호출해 후보를 `role="listbox"`(`aria-expanded`, `aria-activedescendant`)로 펼친다. **방향키(↑/↓)로 후보 이동, Enter로 선택, Esc로 닫힘 + 포커스는 입력창에 유지**(UIUX §3·§6 셀렉트 방향키 탐색 요구를 커스텀 콤보박스에도 동일 적용).
- 선택된 값은 입력창 아래 칩(`multiple`) 또는 입력창 자체 치환 표시(단일)로 나타낸다. 칩에는 "제거" 버튼(44×44px, `aria-label="{이름} 제거"`)을 둔다.
- 검색 결과가 0건이면 목록 영역에 "'{입력값}'에 해당하는 항목이 없습니다."와 함께, `createHref`가 있으면 "[{리소스명} 새로 만들기 →]" 링크를 보여준다(FR-5-20 "목록에 없으면 해당 화면으로 이동하는 바로가기"). 링크는 `href` 기반(`<a>`)이라 새 탭이 아니라 현재 탭 이동이며, 클릭 시 편집 중이던 폼은 `UnsavedGuardContext`가 이탈을 확인한다.
- `resourceType='node'`이고 `excludeIds`에 현재 편집 중인 노드 id가 없으면 편집 화면이 자기 자신을 `DIALOG_MOVE` 대상으로 선택할 수 있어야 하는가는 요구사항에 금지 규정이 없으므로 **허용**하되(엔진의 hop limit이 무한루프를 방어), 후보 목록에서 시각적으로 구분하지 않는다.
- ID를 직접 타이핑해 넣는 텍스트 입력을 **절대 노출하지 않는다** — 이 컴포넌트가 모든 "인풋 조건 선택"의 유일한 경로다.

#### (5) `SeverityBadge` — 심각도 배지 (색상 + 텍스트 병기)

```
props: { severity: 'ERROR' | 'WARNING' | 'INFO'; label?: string }  // label 없으면 기본 한국어 라벨 사용
```

| severity | 기본 레이블 | 배경/텍스트(예시 토큰) | 아이콘 |
|---|---|---|---|
| `ERROR` | "오류" | 배경 `#FEE2E2` / 텍스트 `#991B1B`(대비 약 7.3:1) | ✖ |
| `WARNING` | "주의" | 배경 `#FEF3C7` / 텍스트 `#92400E`(대비 약 5.9:1, 기존 `ARCHIVED` 배지와 동일 팔레트) | ⚠ |
| `INFO` | "안내" | 배경 `#DBEAFE` / 텍스트 `#1D4ED8`(대비 약 7.7:1) | ⓘ |

설계 점검 리포트(D1), 대량 업로드 오류 행(§2.2-2), 슬롯/아웃풋 검증 경고에서 공통으로 사용한다.

### 2.3 도메인 전용 소형 배지·표시 컴포넌트

| 컴포넌트 | 용도 | 규칙 |
|---|---|---|
| `NodeTypeBadge` | 노드 목록/편집(`NORMAL`/`START`/`FALLBACK`) | 텍스트+아이콘: `NORMAL`(일반, 원형 점) / `START`(시작, ▶) / `FALLBACK`(폴백, ⤺) |
| `MatchModeBadge` | 노드 목록(`ANY`/`ALL`) | "조건 중 하나"(ANY) / "조건 모두"(ALL) — 툴팁으로 판정 규칙 설명 |
| `HomonymPolicyBadge` | 동음이의어 목록(`ASK`/`DEFAULT_MEANING`/`IGNORE`) | "되묻기"(ASK) / "기본의미 사용"(DEFAULT_MEANING) / "보정 안 함"(IGNORE) |
| `FaqCategoryBadge` | FAQ 목록/필터(`FAQ`/`SMALL_TALK`/`SELF_SERVICE`/`ERROR_RESPONSE`) | "자주묻는질문" / "스몰톡" / "셀프서비스" / "오류응답" — 색상 4종 고정 배열 |
| `ImportRowErrorBadge` | 검증 리포트 오류 코드 | `EMPTY_NAME`→"이름 없음", `EMPTY_VALUE`→"값 없음", `TOO_LONG`→"길이 초과", `INVALID_CHAR`→"허용되지 않는 문자", `DUPLICATE_IN_FILE`→"파일 내 중복", `SYNONYM_CONFLICT`→"동의어 충돌", `INVALID_CATEGORY`→"분류 오류" |
| `UnsupportedOutputBadge` | 아웃풋 편집 폼(`SCENARIO`/`SURVEY`/**v1(이전 형식)** `API_CONDITION` — [No.26] v2는 배지 없음, 판정은 공용 `isUnsupportedOutput()`) | 고정 문구 "이번 버전에서는 실행되지 않습니다(저장·정의만 가능)" + INFO 계열 배지 스타일(FR-5-15) |
| `ConditionSummaryChips` | 노드 목록 행의 조건 요약 | `intents: ResourceRef[]`, `keywords: ResourceRef[]`, `context?: ResourceRef`를 각각 성격이 다른 칩(테두리색 구분+레이블 "의도:"/"키워드:"/"컨텍스트:")으로 표시. 조건 0개(START/FALLBACK)는 "조건 없음" 텍스트 |
| `OutputTypeIconList` | 노드 목록 행의 아웃풋 요약 | `outputTypes: DialogOutputType[]`를 아이콘+개수 순서로 나열(예: "¶×2 ▦×1") — §5.2 아이콘표 참고 |
| `LinkedNodeCountBadge` | 의도/키워드/컨텍스트 목록 | "노드 {n}건에서 사용 중" — 0이면 배지 자체를 흐린 회색으로(삭제 가능함을 암시하되 색상만으로 전달하지 않도록 텍스트 "미사용"도 병기) |

---

## 3. 대화설계 공통 셸 (D0)

### 레이아웃 (데스크톱)

```
┌───────────────────────────────────────────────────────────────────────────┐
│ ← 목록으로   [AB] 주문 상담봇   ●운영중   고객지원 그룹   order-bot          │   ← 기존 ChatbotDetailHeader
│              [활성화] [보관] [초안으로 복구]                                │   ← 기존 StatusTransitionControls
├───────────────────────────────────────────────────────────────────────────┤
│  대시보드   기본설정   스킨/임베드   대화설계                                │   ← TabNav (4번째 탭 신규)
├───────────────┬───────────────────────────────────────────────────────────┤
│ 대화그래프     │  (ARCHIVED일 때만) ⚠ 보관된 챗봇입니다. 읽기 전용입니다.     │
│ 의도·키워드    ├───────────────────────────────────────────────────────────┤
│ 동음이의어     │                                                             │
│ 컨텍스트       │              (선택된 서브내비 화면 본문)                    │
│ FAQ           │                                                             │
└───────────────┴───────────────────────────────────────────────────────────┘
```

### 컴포넌트

| 컴포넌트 | props | 비고 |
|---|---|---|
| `DialogueSubNav` | `chatbotId`, `active: 'nodes'\|'intents'\|'homonyms'\|'contexts'\|'faqs'`, `onBeforeNavigate?` | `<nav aria-label="대화설계 메뉴">` + `<NavLink>` 5개(href 기반, UIUX §9). 각 항목에 리소스 건수 배지(선택적, 서버 목록 응답의 `total`을 각 화면 최초 로드 시 캐시해 표시하거나 생략 가능 — 필수 아님) |
| `DialogueArchivedBanner` | `visible: status==='ARCHIVED'` | 기존 `ArchivedBanner` 패턴 재사용: "보관된 챗봇입니다. 읽기 전용이며, 수정하려면 먼저 '초안으로 복구'하세요."(FR-0-11) — 모든 쓰기 버튼(추가/편집/삭제/업로드/설계 점검의 "저장" 계열)을 비활성화 |

라우팅: `/chatbots/:chatbotId/dialogue`(세그먼트 없음) 접근 시 `/chatbots/:chatbotId/dialogue/nodes`로 리다이렉트. 5개 서브 라우트는 `DialogueSubNav` + `Outlet`을 감싸는 `DialogueShell` 하위에 중첩한다.

---

## 4. 화면별 설계

## 4.1 D1 — 대화그래프: 노드 목록 / 흐름 미리보기 / 설계 점검

### 목적
노드를 조회·생성·복사·삭제하고, 전체 흐름을 읽기전용으로 파악하며, 저장 전 설계 오류를 점검한다.

### 레이아웃

```
┌───────────────────────────────────────────────────────────────────────────┐
│ 검색 [__________]  유형 ☑일반 ☑시작 ☑폴백  ☑사용중 ☐사용안함   정렬[우선순위▾]│
│                                    [설계 점검]  [흐름 미리보기 ▾]  [+ 노드 추가]│
├───────────────────────────────────────────────────────────────────────────┤
│ 이름          유형   상태   우선순위  조건                  아웃풋      들어옴 수정일 │
│ 배송조회_응답  일반   사용   100      의도:주문_배송조회      ¶×1 ▦×1   2   09-18 ⋮│
│ 상담원_연결    일반   사용   90       키워드:상담원            ¶×1 ☎×1   1   09-17 ⋮│
│ 시작           시작   사용   —        조건 없음               ¶×1        0   09-15 ⋮│
│ 폴백_안내      폴백   사용   —        조건 없음               ¶×1        0   09-15 ⋮│
│                                                              ◀ 1 2 ▶      │
└───────────────────────────────────────────────────────────────────────────┘
```

빈 상태(노드 0건, AC-5-13):
```
EmptyState: "아직 대화 노드가 없습니다."
  "노드는 의도·키워드·컨텍스트 조건과 아웃풋을 연결해 대화 흐름을 만듭니다."
  [의도 먼저 만들기 →]  [+ 노드 추가]
```
(의도가 이미 1건 이상 있으면 "의도 먼저 만들기" 버튼은 숨기고 "+ 노드 추가"만 강조)

### 컴포넌트 분해

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `DialogNodeFilterBar` | `q`, `nodeType: ('NORMAL'\|'START'\|'FALLBACK')[]`(기본 전체 체크), `enabled: boolean\|'all'`(기본 "사용중"만 아니라 **전체 표시**가 기본 — 목록에서 비활성 노드도 즉시 보여 설계 누락을 막는다), `sort: 'priority'\|'name'\|'updatedAt'`, `order` |
| `DialogNodeTable` | `items: DialogNodeListItemSchema[]`, `loading` | 컬럼: 이름, `NodeTypeBadge`, 사용여부(체크 아이콘+텍스트 "사용"/"미사용"), `priority`(START/FALLBACK은 "—"), `ConditionSummaryChips`, `OutputTypeIconList`, `incomingCount`("들어오는 참조 {n}건"), `updatedAt` |
| `DialogNodeRowActions`(`KebabMenu`) | `node` | "편집" / "복사" / "삭제" |
| `CopyDialogNodeAction` | `POST /dialog-nodes/:id/copy` | 확인 없이 즉시 실행(원본 비파괴, `enabled=false`로 생성 — AC-5-12) → 성공 시 `Toast`("'{원본명} (사본)'이 생성되었습니다. 새 노드는 비활성 상태입니다.") + 목록 갱신, 생성된 행 하이라이트 |
| `DeleteDialogNodeConfirmDialog` | `node` | `409 NODE_IN_USE` 시 모달 내 배너: "이 노드로 이동하도록 설정된 노드가 {n}건 있습니다." + 상위 5건 `{name}` 링크(클릭 시 모달 닫고 해당 노드 편집으로 이동) |
| `FlowPreviewPanel`(흐름 미리보기, FR-5-19) | `tree: FlowTreeSchema \| null`, `loading`, `onLoad` | §4.1.1 상세 |
| `DesignValidationPanel`(설계 점검, FR-5-16) | `report: DesignValidationReportSchema \| null`, `loading`, `onRun` | §4.1.2 상세 |

### 4.1.1 흐름 미리보기 (`FlowPreviewPanel`)

"흐름 미리보기 ▾" 버튼을 누르면 목록 아래(또는 우측 슬라이드 패널)에 읽기전용 트리를 펼친다. 최초 클릭 시 `GET /dialog-nodes/flow`를 호출하고, 이후에는 캐시된 결과를 보여주되 상단에 "새로고침" 아이콘 버튼을 둔다.

```
▾ 흐름 미리보기                                                   [새로고침]
  ▸ (시작) 시작                                                              ← 루트, via=ROOT
    ▾ 의도:주문_배송조회 → 배송조회_응답                                     ← via=DIALOG_MOVE 또는 조건 매칭 결과 표시가 아니라
      ▾ 노드이동 → 상담원_연결                                                  "이 노드가 이동/버튼으로 잇는 대상"을 자식으로 표시
        ▸ 버튼[상담원 연결] → 상담원_연결  ↩ 반복                             ← 이미 방문한 노드, 더 펼치지 않고 "↩ 반복"
  들어오는 참조가 없는 노드(orphanNodes): 폴백_안내(폴백 노드 — 별도 진입 경로 없음, 정상)
```

- 트리 항목은 `<button aria-expanded="true|false">`로 펼침/접기를 토글하며, Tab으로 순차 진입·Enter/Space로 토글(UIUX §3, AC-5-14 "키보드만으로 펼침/접기 가능").
- 반복 노드(`repeated: true`)는 "↩ 반복" 텍스트를 붙이고 자식을 렌더링하지 않는다(무한 렌더 방지, FR-5-19).
- `orphanNodes`(어떤 루트에서도 도달하지 않는 노드)는 트리 하단에 별도 목록으로 나열한다. `FALLBACK` 노드는 원래 진입 경로가 없는 것이 정상이므로 경고색을 쓰지 않는다(그 외 `NORMAL` 고아 노드는 §4.1.2 설계 점검의 `ORPHAN_NODE`가 이미 다룬다 — 이 패널은 순수 열람용, 배지 표시는 하지 않는다).
- 빈 트리(노드 0건 또는 루트 없음)는 패널 내부에 `EmptyState`: "표시할 흐름이 없습니다."
- **[No.26]** `API_CONDITION`(v1·v2) 조건 분기 대상은 자식 항목 `via: 'API_BRANCH'`(레이블 "API 분기")로 트리에 표시된다. 세부는 `legacy-api-integration-ui-spec.md` §4.6을 참고.

### 4.1.2 설계 점검 (`DesignValidationPanel`)

"설계 점검" 버튼 클릭 → `POST /dialog-nodes/validate` → 결과를 목록 위(또는 우측 슬라이드 패널)에 표시.

```
┌ 설계 점검 결과 (2026-09-19 14:02 기준)                              [닫기] ┐
│ 오류 1건  주의 3건  안내 2건                                                │
├──────────────────────────────────────────────────────────────────────────┤
│ ✖ 오류   존재하지 않는 의도를 참조하는 노드            [배송조회_응답 편집]│
│ ⚠ 주의   순환 이동 경로: A → B → A                     [A 편집] [B 편집]  │
│ ⚠ 주의   아웃풋이 비어 있는 노드 2건                    [노드1 편집] [노드2 편집]│
│ ⚠ 주의   같은 조건을 가진 중복 노드 2건                 [노드3 편집] [노드4 편집]│
│ ⓘ 안내   예문이 0개인 의도를 조건으로 쓰는 노드 1건      [노드5 편집]      │
│ ⓘ 안내   폴백(FALLBACK) 노드가 없습니다                 [+ 노드 추가]      │
└──────────────────────────────────────────────────────────────────────────┘
```

| 항목 | props / 데이터 |
|---|---|
| `DesignValidationSummary` | `summary: { error, warning, info }` — 배지 3개, `SeverityBadge`와 동일 색상 체계 |
| `DesignIssueRow` | `issue: DesignIssueSchema` — `SeverityBadge` + `message` + 대상 리소스별 편집 바로가기 버튼(복수인 경우 여러 개, 각각 `href` 기반 링크라 키보드 접근 가능, NFR-A4) |

- `ERROR`가 있어도 저장 자체는 막지 않는다(FR-5-17) — 이 패널은 순수 진단 도구다. 문구 하단에 "오류가 있어도 저장은 계속할 수 있습니다. 챗봇을 '운영중'으로 전환할 때 다시 안내됩니다."를 고정 안내로 둔다.
- 바로가기 링크는 대상이 노드면 `/dialogue/nodes/:id`, 의도면 `/dialogue/intents?resource=intent&edit=:id`처럼 각 리소스의 편집 경로로 연결한다(§0.2의 딥링크 쿼리 활용).
- 로딩 중에는 패널 내부에 `SkeletonRow` 3~4개, 실패(5xx)는 `ErrorState` + "다시 시도".
- 챗봇 상태 전이 컨트롤(`StatusTransitionControls`의 "활성화" 버튼)은 이 화면 것이 아니라 §S3 상세 헤더 소관이지만, `ERROR`/`WARNING`이 있는 상태로 "활성화"를 누르면(FR-5-17) 확인 모달에 "설계 점검에서 발견된 문제가 있습니다({error}건 오류, {warning}건 주의). 그래도 운영중으로 전환하시겠습니까?"를 추가한다 — 이 문구 삽입은 `frontend-implementer`가 기존 `StatusTransitionControls` 컴포넌트를 이 그룹의 검증 결과와 연결하는 통합 작업이 필요함을 표시만 해 둔다(선택적 개선, No.5 필수 범위는 D1 패널 표시까지).
- **[No.26]** `API_CONDITION` 관련 신규 진단 코드 11종(`API_OUTPUT_NOT_LAST`·`API_MULTIPLE_OUTPUTS`·`API_NESTED_CALL`·`API_LEGACY_FORMAT`·`API_SLOT_BINDING_UNREACHABLE`·`API_FAILURE_BRANCH_MISSING`·`API_TOKEN_IN_URL_FIELD`·`BROKEN_REFERENCE`(연결 없음)·`API_CONNECTION_UNAVAILABLE`·`API_CONNECTION_INSECURE`·`API_PERSONAL_DATA_LOOKUP`/`API_RAW_PERSONAL_DATA`)이 이 패널에 같은 `DesignIssueRow` 형식으로 추가된다. 문구·심각도는 `legacy-api-integration-ui-spec.md` §4.6을 참고.

### 상태별 UI

| 상태 | UI |
|---|---|
| 목록 로딩 | `SkeletonRow` × 5 |
| 목록 성공(빈 결과 아님) | 표 + "총 {total}건" 배지 |
| 목록 빈 상태 | 위 "빈 상태" ASCII 참고 |
| 목록 오류 | `ErrorState` + 다시 시도 |
| 흐름 미리보기 로딩/오류 | 패널 내부 `SkeletonRow`/`ErrorState`(독립적으로 처리, 목록과 별개 요청) |
| 설계 점검 로딩/오류 | 패널 내부 `SkeletonRow`/`ErrorState` |

---

## 4.2 D1a/D1b — 노드 생성/편집 폼

### 목적
인풋 조건(의도·키워드·컨텍스트)과 아웃풋(최대 10개, 12종 타입별 폼)을 조합해 노드 하나를 정의한다.

### 레이아웃

```
┌───────────────────────────────────────────────────────────────────────────┐
│ ← 대화그래프로   노드 편집 — 배송조회_응답                                  │
├───────────────────────────────────────────────────────────────────────────┤
│ 이름 *        [배송조회_응답______________]                                 │
│ 설명          [______________________________]                             │
│ 유형          (●일반 ○시작 ○폴백)                                          │
│ 사용 여부     ☑ 사용함                                                      │
│ 우선순위      [100] (클수록 먼저 평가됩니다)                                 │
├───────────────────────────────────────────────────────────────────────────┤
│ 인풋 조건                                    조건 판정: (●하나라도 ○모두)    │
│  의도    [검색: 의도 이름으로 찾기_______▾]  [주문_배송조회 ×]              │
│  키워드  [검색: 키워드 이름으로 찾기______▾]  (없음)                        │
│  컨텍스트 [검색: 컨텍스트 이름으로 찾기____▾]  (없음)                        │
│           ⓘ 컨텍스트 조건은 "직전 턴에 해당 폼이 완료됐을 때" 충족됩니다.     │
├───────────────────────────────────────────────────────────────────────────┤
│ 아웃풋 (2/10)                                              [+ 아웃풋 추가]  │
│ ┌─────────────────────────────────────────────────────────────────┐ ▲ ▼ ⌫ │
│ │ 1  유형 [텍스트 ▾]                                                │       │
│ │    텍스트 *  [운송장 번호를 확인해 드릴게요______________] 18/1000자│       │
│ └─────────────────────────────────────────────────────────────────┘       │
│ ┌─────────────────────────────────────────────────────────────────┐ ▲ ▼ ⌫ │
│ │ 2  유형 [버튼 ▾]                                                  │       │
│ │    안내 문구(선택) [__________________________]                   │       │
│ │    버튼 목록 (2/5)                                    [+ 버튼 추가]│       │
│ │    ┌───────────────────────────────────────────────┐ ▲ ▼ ⌫       │       │
│ │    │ 레이블 [배송 조회] 동작 [노드이동▾] 대상 [배송조회_응답 ×]│       │       │
│ │    └───────────────────────────────────────────────┘             │       │
│ └─────────────────────────────────────────────────────────────────┘       │
├───────────────────────────────────────────────────────────────────────────┤
│                                               [취소]  [저장]                │
└───────────────────────────────────────────────────────────────────────────┘
```

### 컴포넌트 분해

| 컴포넌트 | props / 검증 |
|---|---|
| `DialogNodeForm` | 초기값 `DialogNodeSchema \| null`(신규는 null), `onSubmit` |
| `TextInputField`(이름) | `id="name"`, 필수, `DialogueNameSchema`(1~100자, 개행/탭 금지) |
| `TextAreaField`(설명) | 선택, 300자 카운터 |
| `RadioGroup`(유형) | `id="nodeType"`, 라디오 3개(일반/시작/폴백, UIUX §6 단일선택=라디오). `START`/`FALLBACK` 선택 시 인풋 조건 섹션 전체를 "조건이 필요 없습니다"로 비활성 표시(FR-5-3) — 단, 서버가 이미 다른 `START`/`FALLBACK`을 보유 중이면 저장 시 `409`로 걸러진다(클라이언트에서 사전 차단은 하지 않음 — 목록에 이미 있는지 매번 동기화하기보다 서버 오류를 신뢰) |
| `CheckboxField`(사용 여부) | `id="enabled"`, 기본 체크. 해제하면 "아웃풋 없이 임시 저장할 수 있습니다(설계 점검에서 주의로 표시됩니다)." 도움말 노출(FR-5-6) |
| `NumberInputField`(우선순위) | `id="priority"`, 정수 -1000~1000, 기본 100, 도움말 "값이 클수록 먼저 평가됩니다. 같으면 조건이 더 구체적인 노드가 우선합니다." |
| `MatchModeRadioGroup` | `id="matchMode"`, "조건 중 하나라도 충족"(ANY, 기본) / "조건을 모두 충족"(ALL). 도움말: "같은 종류(의도/키워드) 안에서는 항상 '또는'으로 판정됩니다." |
| `ResourcePickerField`(의도) | `resourceType='intent'`, `multiple=true`, `createHref="/chatbots/{id}/dialogue/intents?resource=intent"` |
| `ResourcePickerField`(키워드) | `resourceType='keyword'`, `multiple=true`, `createHref="/chatbots/{id}/dialogue/intents?resource=keyword"` |
| `ResourcePickerField`(컨텍스트) | `resourceType='context'`, `multiple=false`, `createHref="/chatbots/{id}/dialogue/contexts/new"`. 하단 고정 도움말: "컨텍스트 조건은 직전 턴에 해당 폼이 완료됐을 때 충족됩니다."(DD-13 사용자 안내) |
| `ReorderableList`(아웃풋) | `items: DialogOutput[]`, `maxItems=10`, `renderItem` → `DialogOutputEditor` |
| `DialogOutputEditor` | `value: DialogOutput`, `index`, `onChange`, `onRemove` | §4.2.1 상세 |
| `FormActions` | `dirty`, `saving`, `onSave`, `onCancel` | 기존 패턴과 동일(변경 없으면 저장 비활성, 저장 중 스피너+disabled) |

### 4.2.1 아웃풋 12종 타입별 폼 (`DialogOutputEditor`)

각 아웃풋 카드 상단에 `유형` 셀렉트(12종, UIUX §6 단일선택=셀렉트, 값 변경만으로 폼 자동 제출 금지)가 있고, 그 아래 타입별 서브폼이 조건부로 렌더링된다.

**타입 변경 시 포커스 이동 규칙(설계서 §9 요구, 접근성 필수)**: 유형 셀렉트에서 값을 바꾸면, 새로 나타난 서브폼의 **첫 입력 필드로 포커스를 이동**시킨다. 대상 필드는 아래 표의 "포커스 대상"이다.

| # | 유형(레이블/아이콘) | 필드 | 포커스 대상 | 검증/비고 |
|---|---|---|---|---|
| ① | 텍스트 ¶ | `text`(textarea, 1~1000자, 카운터) | `text` | 필수 |
| ② | 카드 ▭ | `title`(1~100), `description?`(500자), `imageUrl?`(URL), **`altText`**(imageUrl 입력 시에만 표시되고 즉시 필수로 전환, 1~200자), `buttons?`(`ReorderableList`, 최대5) | `title` | `imageUrl` 입력 시 `altText` 미입력이면 저장 시 `400 OUTPUT_PAYLOAD_INVALID` — 필드 라벨을 "대체 텍스트 *(이미지 등록 시 필수)"로 동적 표기(NFR-A7) |
| ③ | 이미지 ▨ | `imageUrl`(URL, 필수), **`altText`**(1~200, 필수, 상시 노출) | `imageUrl` | `altText`는 이 타입에서 **항상** 필수(NFR-A7) — 레이블 "대체 텍스트 *" 고정 |
| ④ | 버튼 ▦ | `text?`(안내문구, 500자), `buttons`(`ReorderableList`, 1~5, 필수 1개 이상) | `text` (버튼 0개면 "+ 버튼 추가" 버튼에 포커스 아님 — text 필드가 없으면 첫 버튼의 레이블 필드) | 버튼 아이템: `label`(1~40), `action`(셀렉트: 메시지 전송/링크 열기/노드 이동), `value` — `action`에 따라 `value` 입력 UI가 바뀜(아래) |
| ⑤ | 링크 ↗ | `label`(1~40), `url`(URL, `javascript:` 등 비허용), `openInNewTab`(체크박스, 기본 참) | `label` | `SafeUrlSchema`(http/https만) |
| ⑥ | 지연 ‖ | `durationMs`(숫자, 100~5000, 단위 ms 도움말 "0.1~5초") | `durationMs` | |
| ⑦ | 전화연결 ☎ | `label`(1~40), `phoneNumber`(전화번호 형식) | `label` | 저장 시 `tel:` 링크로 렌더링됨을 도움말로 안내 |
| ⑧ | 폼 시작 ☰ | `contextVariableId` → `ResourcePickerField(resourceType='context', multiple=false)` | 리소스 선택기 입력창 | 선택한 컨텍스트의 슬롯 수를 옆에 "(슬롯 3개)"로 표시 |
| ⑨ | 노드 이동 ↪ | `targetNodeId` → `ResourcePickerField(resourceType='node', multiple=false, excludeIds=[현재노드id])` | 리소스 선택기 입력창 | 도움말: "이동 후 남은 아웃풋은 실행되지 않고, 대상 노드의 아웃풋으로 이어집니다." 순환 가능성은 저장을 막지 않고 설계 점검(D1)에서 경고 |
| ⑩ | 시나리오 연동 ◈ | `scenarioKey`(1~100), `params?`(key-value 목록, 최대 20) | `scenarioKey` | `UnsupportedOutputBadge` 표시(FR-5-15) — **[No.26 확인]** `SCENARIO`는 이 그룹에서도 미지원으로 유지된다(요구사항 J-1) |
| ⑪ | 설문 연동 ▥ | `surveyId`(1~100) | `surveyId` | `UnsupportedOutputBadge` 표시 |
| ⑫ | API 조건분기 ⇄ | **[No.26 갱신, 2026-09-24]** 이 행은 이제 **v1(이전 형식) 노드의 읽기 전용 표시**만 설명한다. 필드: 메서드·경로 요약(수정 불가, 텍스트), 헤더 **키와 개수만**(예: "헤더 2개(값은 표시되지 않습니다)" — 서버가 응답에서 값을 `[비공개]`로 가리므로 v1 편집기에 있던 "표시/가리기" 토글은 더 이상 없다), 본문 템플릿은 `[비공개]` 고정 텍스트, 조건 목록(읽기 전용, `path`/`operator`/`value`/다음 노드 링크는 그대로 보임 — 시크릿이 아니므로). 쓰기 입력은 없다. | — (읽기 전용 카드라 포커스 이동 대상 없음) | "이전 형식 — 실행되지 않습니다. 연결을 선택해 전환하세요" 배지(§4.2.1 하단 참고) + `연결로 전환` 버튼. **v2(연결 레지스트리 기반) `API 조건분기` 편집 폼은 이 표의 대상이 아니다** — 신규 폼(연결 선택·경로/쿼리/본문 바인딩·응답 매핑·조건·기본/실패 분기·샘플 미리보기)은 `docs/03-design/legacy-api-integration-ui-spec.md` §4.2(`ApiConditionEditorV2`)에서 정의한다. 그 폼에는 URL·헤더 직접 입력 필드가 없다 |

**버튼 아이템(`ButtonItemSchema`) `action`별 `value` 입력 UI**(④ 버튼, ② 카드의 `buttons`, ⑫가 아닌 공용 서브컴포넌트 `ButtonItemEditor`):

| action | value 입력 |
|---|---|
| `MESSAGE`(메시지 전송) | 텍스트 입력(1~200자) — "사용자가 이 버튼을 누르면 이 문구를 보낸 것처럼 처리됩니다." |
| `LINK`(링크 열기) | URL 입력(`SafeUrlSchema`) |
| `NODE`(노드로 이동) | `ResourcePickerField(resourceType='node', multiple=false)` |

- ⑩⑪ 카드는 상단에 `UnsupportedOutputBadge`("이번 버전에서는 실행되지 않습니다(저장·정의만 가능)")를 항상 노출한다(AC-5-7). 배지는 INFO 계열 색상(파랑)으로 경고가 아님을 표시하되 텍스트로 명확히 안내한다.
- **[No.26]** ⑫는 **v1(이전 형식)일 때만** 위 §4.2.1 표의 읽기 전용 형태와 "이전 형식 — 실행되지 않습니다. 연결을 선택해 전환하세요" 배지(INFO가 아니라 WARNING 톤 — 일반 미지원과 달리 "전환하면 실행할 수 있다"는 차이를 배지 색으로도 구분)를 보여준다. **v2 `API_CONDITION`에는 배지가 없다**(정상적으로 실행되는 아웃풋이므로) — v2 폼과 "연결로 전환" 흐름의 전체 정의는 `legacy-api-integration-ui-spec.md` §4.2·§4.5를 따른다.
- 아웃풋 카드 우측의 "⌫ 삭제" 버튼도 44×44px 이상이며, 삭제 시 확인 없이 즉시 제거(되돌리기는 저장 전까지 `Ctrl+Z` 같은 별도 기능 없음 — 단순 폼 상태이므로 "저장" 전에는 "취소"로 전체 되돌리기 가능).

### 필드-오류 매핑

| field 패턴 | 표시 위치 | 대표 메시지 |
|---|---|---|
| `name` | 이름 필드 하단 | "이미 같은 이름의 노드가 있습니다. 다른 이름을 입력해 주세요."(`DUPLICATE_NAME`) |
| `intentIds`/`keywordIds`/`contextVariableId` | 해당 `ResourcePickerField` 하단 | "선택한 의도를 찾을 수 없습니다. 목록을 새로고침해 주세요."(`INVALID_REFERENCE`, 404) — `details`의 문제 ID를 해당 칩에 빨강 테두리로 표시 |
| (조건 0개 + `NORMAL`) | 인풋 조건 섹션 상단 배너 | "조건을 1개 이상 지정하거나 시작/폴백 노드로 지정해 주세요."(`400`, AC-5-2) |
| `outputs[i].altText` | 해당 아웃풋 카드의 대체 텍스트 필드 하단 | "이미지에는 대체 텍스트가 필요합니다."(`OUTPUT_PAYLOAD_INVALID`, AC-5-5) |
| `outputs[i].url` 등 | 해당 필드 하단 | "http 또는 https로 시작하는 주소만 사용할 수 있습니다."(AC-5-6) |
| (START/FALLBACK 중복) | 폼 상단 배너 | "시작 노드는 챗봇당 1개만 지정할 수 있습니다(현재: {이름})."(`START_NODE_EXISTS`/`FALLBACK_NODE_EXISTS`, 409) |

### 저장 흐름

1. 편집 → `dirty=true`(`UnsavedGuardContext` 등록).
2. 저장 클릭 → 클라이언트 사전검증(필수 필드, 길이, 대체텍스트) → 실패 시 인라인 오류만 표시, 요청 미전송.
3. `POST /dialog-nodes` 또는 `PATCH /dialog-nodes/:id` 전송, 버튼 로딩.
4. `201`/`200` → `Toast`("저장되었습니다") → D1 목록으로 이동(신규 생성 시) 또는 폼 유지+`dirty=false`(수정 시).
5. `400`/`404`/`409` → 위 매핑표대로 인라인 표시, 첫 오류 필드로 포커스 이동.

---

## 4.3 D2 — 의도·키워드 관리

### 목적
의도(예문)와 키워드(동의어)를 관리하고, 노드가 참조 중인 항목의 삭제를 사전에 막는다.

### 레이아웃

```
┌───────────────────────────────────────────────────────────────────────────┐
│ [ 의도 ] [ 키워드 ]                                                         │
├───────────────────────────────────────────────────────────────────────────┤
│ 검색 [__________]                          정렬[수정일▾]                    │
│                          [내보내기] [엑셀/CSV 업로드] [+ 의도 추가]         │
├───────────────────────────────────────────────────────────────────────────┤
│ ☐ 이름            설명        예문     사용중인 노드   수정일        액션    │
│ ☐ 주문_배송조회    배송 조회    5개      2건            09-18         ⋮      │
│ ☐ 환불_문의        —           0개(⚠)   0건(미사용)     09-17         ⋮      │
│                                                          ◀ 1 2 ▶            │
│ ☐ 선택 3건  [선택 삭제]                                                     │
└───────────────────────────────────────────────────────────────────────────┘
```

- 예문 0개인 의도는 예문 수 옆에 `INFO` 계열 작은 아이콘(⚠는 색상 강한 경고로 오인될 수 있어 지양, `ⓘ` 사용) + 툴팁 "예문이 없으면 이 의도를 조건으로 쓰는 노드가 영원히 매칭되지 않습니다."(EX-D-5 사전 안내, 설계 점검과 별개로 목록에서도 바로 보이게).
- 키워드 탭은 컬럼만 `예문`→`동의어`로, 그 외 동일(`synonymCount`, `linkedNodeCount`).

빈 상태(0건):
```
EmptyState: "아직 등록된 의도가 없습니다." / "아직 등록된 키워드가 없습니다."
  "의도는 사용자가 어떤 요청을 했는지 이해하는 기준입니다."
  [+ 의도 추가]   [엑셀/CSV로 한 번에 등록]
```

### 컴포넌트 분해

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `ResourceKindTabs` | `active: 'intent'\|'keyword'`(쿼리 `?resource=` 동기화) — 클라이언트 상태 서브탭(스킨/임베드와 동일 패턴) |
| `IntentTable` / `KeywordTable` | `items`, `loading`, `selectedIds`(일괄삭제용 체크박스), `onSelectChange` | 체크박스 열은 UIUX §6 다중선택 용도이므로 체크박스 유지 |
| `IntentEditModal`(D2a) | `intent: Intent \| null`(신규는 null) | §4.3.1 상세 |
| `KeywordEditModal`(D2b) | `keyword: Keyword \| null` | 이름/설명 + `synonyms` 칩 에디터(`ChipListEditor`, 최대 200개). 저장 시 `SYNONYM_CONFLICT` 409 → 모달 상단 배너: "동의어 '{값}'은(는) 키워드 '{충돌키워드명}'에서 이미 사용 중입니다." |
| `DeleteIntentConfirmDialog` / `DeleteKeywordConfirmDialog` | `resource` | 참조 0건이면 문구 "예문 {n}개가 함께 삭제됩니다."(의도) / "동의어 {n}개가 함께 삭제됩니다."(키워드). 참조 중이면 `409` 모달 배너 — §4.3.2 |
| `BulkDeleteConfirmDialog` | `selectedIds`, `resourceType` | 일부만 참조 중이어도 **전체 롤백**(FR-6-13, AC-6-8) → 성공/실패 이분법만 존재. 실패 시 모달 배너에 차단된 항목 목록 전체(최대 5건 + "외 {n}건") |
| `BulkImportModal`(D2c) | `resourceType: 'intent'\|'keyword'`, `chatbotId` | §4.4 공용 컴포넌트 |
| `ExportButton` | `GET /{intents|keywords}/export?format=csv` | 클릭 시 즉시 다운로드(별도 확인 없음) |

### 4.3.1 의도 편집 모달(`IntentEditModal`, D2a)

```
┌ 의도 편집 — 주문_배송조회 ─────────────────────────────────────── ✕ ┐
│ 이름 *      [주문_배송조회______________]                            │
│ 설명        [______________________________] 0/300자                │
├────────────────────────────────────────────────────────────────────┤
│ 예문 (5/500)                                                          │
│ [새 예문 입력__________________________] [추가]                       │
│ [배송 어디까지 왔어요 ×] [택배 조회 ×] [배송 조회해줘 ×] ...           │
│ ⚠ 이 예문은 다른 의도 '환불_문의'에도 등록되어 있습니다: "환불 언제요"  │
├────────────────────────────────────────────────────────────────────┤
│ 이 의도를 사용하는 노드: 배송조회_응답, 상담원_연결                    │
├────────────────────────────────────────────────────────────────────┤
│                                                   [취소]  [저장]      │
└────────────────────────────────────────────────────────────────────┘
```

| 컴포넌트 | 비고 |
|---|---|
| `ExampleChipEditor` | 입력창(Enter 또는 "추가" 버튼으로 칩 추가, 중복은 클라이언트에서 즉시 정규화 비교해 "이미 추가된 예문입니다" 인라인 경고 — 서버 dedupe와 별개의 실시간 UX), 칩마다 "제거" 버튼. 500개 도달 시 입력창 `disabled` + "최대 500개까지 등록할 수 있습니다." |
| `ExampleConflictBanner` | `conflicts: ExampleConflictSchema[]`(FR-6-7) — 저장 응답에 포함되면 모달을 닫지 않고 경고 배너로 표시(차단 아님, 저장은 이미 완료됨). "확인" 클릭 시에만 모달 닫힘 |
| `LinkedNodesReadonlyList` | `linkedNodes: ResourceRef[]`(FR-6-9) — 각 항목은 D1b 노드 편집으로 가는 링크. 0건이면 "이 의도를 사용하는 노드가 없습니다."(회색 텍스트) |

신규 생성 시에는 `LinkedNodesReadonlyList`와 "이 의도를 사용하는 노드" 섹션 자체를 숨긴다(아직 참조가 있을 수 없음).

### 4.3.2 삭제 차단 흐름 (EX-R-1, AC-6-6, 공통 패턴)

모든 리소스(의도/키워드/컨텍스트/노드)의 삭제 확인 모달은 동일한 실패 처리 패턴을 공유한다.

1. `KebabMenu` → "삭제" → 확인 모달 오픈.
2. "삭제" 클릭 → `DELETE /.../:id`.
3. `409 *_IN_USE` 수신 → 모달을 닫지 않고 모달 내부 상단에 인라인 배너: "이 {리소스}를 사용하는 {참조리소스명} {n}건이 있습니다." + 상위 5건 `{name}` 각각 링크 버튼(클릭 시 모달 닫고 해당 편집 화면으로 이동, 5건 초과 시 "외 {n-5}건").
4. `Esc`/"취소"로 닫으면 아무 것도 변경되지 않고 포커스가 트리거(케밥 메뉴 버튼)로 복귀(AC-C-6).
5. `204` 성공 → 모달 닫힘 + `Toast` + 목록에서 제거.

---

## 4.4 D2c/D5b — 대량 업로드 공용 컴포넌트 (`BulkImportModal`)

### 목적
의도·키워드·FAQ 3개 도메인이 동일한 2단계(검증→커밋) 파이프라인(ADR-0007)을 공유하므로 **하나의 모달 컴포넌트**로 구현한다.

```
props: {
  resourceType: 'INTENT' | 'KEYWORD' | 'FAQ';
  chatbotId: string;
  isOpen: boolean;
  onClose: () => void;
  onCommitted: () => void;   // 목록 갱신 트리거
}
```

### 3단계 흐름 (레이아웃)

**1단계 — 파일 선택**
```
┌ 엑셀/CSV로 의도·예문 업로드 (1/3 파일 선택) ──────────────────────── ✕ ┐
│ 1) 먼저 템플릿을 내려받아 형식에 맞게 채워주세요.                       │
│    [템플릿 다운로드(.csv)]  [템플릿 다운로드(.xlsx)]                    │
│ 2) 작성한 파일을 올려주세요.                                            │
│    ┌───────────────────────────────────────────┐                       │
│    │  [파일 선택]  선택된 파일 없음                │                       │
│    │  .xlsx, .csv · 최대 5MB, 5,000행              │                       │
│    └───────────────────────────────────────────┘                       │
│                                            [취소]   [검증하기]          │
└──────────────────────────────────────────────────────────────────────┘
```

**2단계 — 검증 결과**
```
┌ 엑셀/CSV로 의도·예문 업로드 (2/3 검증 결과) ───────────────────────── ✕ ┐
│ 총 969행 · 신규 의도 18건 · 예문 962건 추가 · 중복 무시 31건 · 오류 7건 │
│ [ImportValidationReportTable: 오류 7건 표]                              │
├──────────────────────────────────────────────────────────────────────┤
│ 기존 항목과 이름이 겹칠 때       (●병합  ○전체교체  ○건너뛰기)          │
│ 오류가 있는 행                  (●유효한 행만 반영  ○오류가 있으면 전체 취소)│
├──────────────────────────────────────────────────────────────────────┤
│                              [이전]  [취소]  [오류 행 CSV 다운로드]  [반영하기]│
└──────────────────────────────────────────────────────────────────────┘
```

**3단계 — 완료**
```
┌ 엑셀/CSV로 의도·예문 업로드 (3/3 완료) ─────────────────────────────── ✕ ┐
│ ✔ 반영되었습니다. 신규 18건 · 갱신 3건 · 새 값 962건 · 건너뜀 7건        │
│ [오류 행 CSV 다운로드(있는 경우)]                                        │
│                                                          [닫기]         │
└──────────────────────────────────────────────────────────────────────┘
```

### 컴포넌트 분해

| 컴포넌트 | props / 동작 |
|---|---|
| `ImportWizardSteps` | `current: 1\|2\|3` — 시각적 단계 표시(숫자+레이블), 텍스트로도 "1/3 파일 선택" 병기(색상만으로 단계 구분 금지) |
| `TemplateDownloadLinks` | `GET /{resource}/import/template?format=csv\|xlsx` — 클릭 시 즉시 다운로드 |
| `FileUploadField` | §2.2-1 재사용 |
| `mergePolicy` 선택 | `RadioGroup`: 병합(기본)/전체교체/건너뛰기(FR-6-24). 각 옵션 옆에 1줄 설명("기존 예문에 새 예문을 추가합니다." 등) |
| `errorPolicy` 선택 | `RadioGroup`: 유효한 행만 반영(기본)/오류가 있으면 전체 취소(FR-6-25) |
| `ImportValidationReportTable` | §2.2-2 재사용, `resourceType`에 따라 컬럼 레이블만 다름("의도명"/"키워드명"/"질문") |
| `ImportCommitResultSummary` | `result: ImportCommitResultSchema` — 배지 4개(신규/갱신/새 값/건너뜀) |
| `ErrorRowCsvDownloadButton` | 클라이언트 생성(DD-16) — `errors[]`를 `escapeCsvCell()`(shared-types 공유 헬퍼, NFR-S7)로 이스케이프해 Blob 다운로드. 서버 엔드포인트 없음 |

### 인터랙션 규칙

1. 파일 선택 후 "검증하기" 클릭 → `apiClient.postForm('/{resource}/import/validate', formData)`(§0.3 필요 확장) → 진행 중 `FileUploadField`의 `uploading=true`, "검증하기" 버튼 `disabled`(연타 방지, AC-6B-10).
2. 응답 성공 → 2단계로 전환, `importToken`을 모달 로컬 상태에 보관(화면에는 노출하지 않음).
3. "반영하기" 클릭 → `POST /{resource}/import/commit`(정책 2개 포함) → 3단계.
4. `IMPORT_TOKEN_EXPIRED`(10분 경과, 서버 재시작 등, AC-6B-6): 2단계 화면 상단 배너 "검증 결과가 만료되었습니다. 파일을 다시 검증해 주세요." + "다시 검증하기" 버튼(1단계로 복귀, 파일은 유지되어 있어 재검증만 다시 트리거).
5. `IMPORT_TOO_LARGE`/`IMPORT_FILE_INVALID`(EX-I-1/2/4): 1단계에서 인라인 오류로 표시, 2단계로 전환하지 않음.
6. `IMPORT_ABORTED`(`ABORT_ON_ERROR` 선택 + 오류 존재, AC-6B-4): 2단계 화면 상단 배너 "오류 {n}건이 있어 전체를 취소했습니다. 한 건도 반영되지 않았습니다." — 정책을 바꾸거나 파일을 수정해 다시 시도하도록 안내.
7. 모달을 `Esc`/배경클릭으로 닫아도(3단계 도달 전) 서버에는 아무 것도 반영되지 않는다(검증은 dry-run, AC-6B-2) — 별도 "저장하지 않은 변경" 경고는 불필요(폼 데이터 손실이 아니라 "파일 재선택" 정도의 비용).
8. 3단계에서 "닫기" → `onCommitted()` 호출 → 목록 화면이 재조회된다.

---

## 4.5 D3 — 동음이의어/다의어 사전

### 목적
모호한 단어에 의미별 문맥 힌트·연결 의도를 등록하고, 모호성 해소 정책을 설정하며, 테스트 입력으로 즉시 검증한다.

### 레이아웃

```
┌───────────────────────────────────────────────────────────────────────────┐
│ 검색 [__________]                                        [+ 항목 추가]     │
├───────────────────────────────────────────────────────────────────────────┤
│ 단어    의미 수   정책         수정일        액션                          │
│ 배      3개       되묻기       09-19         ⋮                             │
│ 배터리   2개       기본의미 사용 09-15         ⋮                             │
│                                              ◀ 1 ▶                        │
└───────────────────────────────────────────────────────────────────────────┘
```

빈 상태: `EmptyState` "아직 등록된 동음이의어 항목이 없습니다." + "같은 단어가 여러 의미로 쓰여 오매칭이 생길 때 등록하세요." + [+ 항목 추가]

### 편집 모달(D3a) 레이아웃

```
┌ 동음이의어 편집 — 배 ──────────────────────────────────────────── ✕ ┐
│ 단어 *  [배___________]  설명  [______________________]              │
├────────────────────────────────────────────────────────────────────┤
│ 의미 (3/10)                                                [+ 의미 추가]│
│ ┌──────────────────────────────────────────────────────┐ ▲ ▼ ⌫     │
│ │ 1  의미명 * [과일______________]                        │         │
│ │    문맥 힌트(0/30) [새 힌트____] [추가]  [사과 ×][포도 ×] │         │
│ │    연결 의도(선택) [검색: 의도 이름으로 찾기______▾]       │         │
│ │    설명(선택) [__________________]                       │         │
│ └──────────────────────────────────────────────────────┘           │
│ ┌──────────────────────────────────────────────────────┐ ▲ ▼ ⌫     │
│ │ 2  의미명 * [신체______________]  ...                    │         │
│ └──────────────────────────────────────────────────────┘           │
├────────────────────────────────────────────────────────────────────┤
│ 모호성 해소 정책  (●되묻기  ○기본의미 사용  ○보정 안 함)               │
│  되묻기 문구       [어떤 '배'를 말씀하시는 건가요?________] (정책=되묻기일 때만)│
│  기본 의미         [과일 ▾] (정책=기본의미 사용일 때만, 의미 목록에서 선택) │
├────────────────────────────────────────────────────────────────────┤
│ 테스트 입력  [배 얼마예요?_______________________] [테스트]            │
│   → 결과: 모호함 — 되묻기 버튼 [과일] [신체] [선박]이 출력됩니다.        │
├────────────────────────────────────────────────────────────────────┤
│                                                   [취소]  [저장]      │
└────────────────────────────────────────────────────────────────────┘
```

### 컴포넌트 분해

| 컴포넌트 | props / 검증 |
|---|---|
| `HomonymEditModal` | `homonym: HomonymDictionary \| null` |
| `ReorderableList`(의미) | `items: HomonymMeaning[]`, `minItems=2`, `maxItems=10` — 최소 2개 미만이면 "저장" 클릭 시 인라인 오류(폼 상단 배너 "의미를 2개 이상 등록해야 합니다.", AC-7-1) |
| `HomonymMeaningEditor` | `label`(1~100, 필수), `ChipListEditor`(contextHints, 최대 30) — 힌트가 다른 의미 블록에도 있으면 **양쪽 블록 모두**에 즉시 인라인 경고("이 힌트는 위 '신체' 의미에도 있습니다. 하나만 남겨주세요." — 클라이언트에서 실시간 교차 검사 후 서버가 저장 시점에 `400`으로 최종 확인, FR-7-4/AC-7-2) |
| `ResourcePickerField`(연결 의도) | `resourceType='intent'`, `multiple=false`, 선택 해제 가능(옵션) |
| `HomonymPolicyRadioGroup` | ASK(기본)/DEFAULT_MEANING/IGNORE — 값에 따라 `clarifyPrompt`(ASK) 또는 `defaultMeaningIndex`(DEFAULT_MEANING, 의미 목록 셀렉트) 필드가 조건부 노출 |
| `HomonymTestPanel` | `POST /homonyms/test { text }` → `resolution`, `outputs`, `trace` | 결과 3분기 렌더: RESOLVED("'{label}'로 확정되었습니다. 연결 의도: {intentName}"), AMBIGUOUS(되묻기 버튼 미리보기 — 실제 `BUTTON` 아웃풋을 그대로 렌더링), IGNORED("정책이 '보정 안 함'이라 별도 처리 없이 일반 매칭 결과를 사용합니다.") — 하단 "판정 근거 보기"(접이식, `trace` 나열, 기본 접힘) |

### 저장/삭제

- 저장 실패 매핑: `intentId` 404 → 연결 의도 선택기 하단 "선택한 의도를 찾을 수 없습니다."(AC-7-3). 문맥 힌트 중복 → 위 실시간 경고가 이미 해결하지 못한 경우 서버가 `400`으로 최종 차단, 폼 상단 배너로도 표시.
- 삭제는 항상 허용(`204`, FR-7-9) — 확인 모달은 두되 참조 경고 없이 단순 확인: "'{단어}' 항목을 삭제하시겠습니까?"

---

## 4.6 D4/D4a/D4b — 컨텍스트(멀티턴·슬롯필링) 관리

### 목적
여러 턴에 걸쳐 값을 채우는 폼(슬롯 시퀀스)을 정의하고, 저장 전 대화형 미리보기로 질문 순서를 확인한다.

### D4 목록 레이아웃

```
┌───────────────────────────────────────────────────────────────────────────┐
│ 검색 [__________]                                       [+ 컨텍스트 추가]  │
├───────────────────────────────────────────────────────────────────────────┤
│ 이름        설명        슬롯 수   시간제한   수정일        액션            │
│ 커피주문     주문 접수    3개      30분        09-19         ⋮             │
└───────────────────────────────────────────────────────────────────────────┘
```

빈 상태: `EmptyState` "아직 등록된 컨텍스트가 없습니다." + "여러 턴에 걸쳐 정보를 입력받는 폼형 대화를 만들 때 사용하세요(예: 주문 접수)." + [+ 컨텍스트 추가]

### D4a/D4b 편집 레이아웃 (2단 — 폼 + 대화 미리보기)

```
┌───────────────────────────────────────────────────────────────────────────┐
│ ← 컨텍스트 목록으로   컨텍스트 편집 — 커피주문                              │
├───────────────────────────────────────┬───────────────────────────────────┤
│ 이름 *      [커피주문_______________]  │  대화 미리보기 (클라이언트 렌더링)  │
│ 설명        [___________________]     │  ┌─────────────────────────────┐ │
│ 취소 키워드  [취소 ×][그만 ×][처음으로 ×]│  │ 🤖 메뉴를 선택해 주세요       │ │
│              [새 키워드___] [추가]      │  │    [아메리카노] [라떼]        │ │
│ 세션 제한(분) [30]  (1~180)             │  │ 🤖 사이즈를 선택해 주세요      │ │
├─────────────────────────────────────── │  │    [Tall] [Grande]            │ │
│ 슬롯 (3/20)                [+ 슬롯 추가]│  │ 🤖 수량을 알려주세요(1~10)    │ │
│ ┌───────────────────────────────┐▲▼⌫  │  │ 🤖 아메리카노 Tall 1잔 주문   │ │
│ │ 1 이름*[menu] 레이블*[메뉴]      │      │  │    완료해 드릴게요!            │ │
│ │   질문*[메뉴를 선택해 주세요__]  │      │  └─────────────────────────────┘ │
│ │   유형[선택형▾] 필수 ☑          │      │                                   │
│ │   선택지(2/20)[아메리카노×][라떼×]│      │                                   │
│ │   [새 선택지___][추가]           │      │                                   │
│ │   오류 문구[다시 선택해 주세요]   │      │                                   │
│ │   재시도 횟수[2](0~5)            │      │                                   │
│ └───────────────────────────────┘      │                                   │
│ (슬롯 2, 3 동일 구조 생략)               │                                   │
├─────────────────────────────────────── │                                   │
│ 완료 문구  [{메뉴} {사이즈} {수량}잔 주문 완료해 드릴게요!___] 0/500자        │
│            사용 가능한 치환자: {menu} {size} {quantity}                     │
├───────────────────────────────────────┴───────────────────────────────────┤
│                                                       [취소]  [저장]        │
└───────────────────────────────────────────────────────────────────────────┘
```

### 컴포넌트 분해

| 컴포넌트 | props / 검증 |
|---|---|
| `ContextVariableForm` | 초기값 `ContextVariable \| null` |
| `TextInputField`(이름) | `id="name"`, 필수, 유일성(409 `DUPLICATE_NAME`) |
| `ChipListEditor`(취소 키워드) | 기본값 `['취소','그만','처음으로']` 미리 채움, 최대 10개 |
| `NumberInputField`(세션 제한) | 1~180, 기본 30, 도움말 "이 시간 동안 응답이 없으면 세션이 만료됩니다." |
| `ReorderableList`(슬롯) | `items: ContextSlot[]`, `maxItems=20` |
| `ContextSlotEditor` | §4.6.1 상세 |
| `TextAreaField`(완료 문구) | 500자 카운터, 치환자 도움말(슬롯 `name` 목록을 `{}`로 감싸 나열, 슬롯 이름이 바뀌면 실시간 갱신) |
| `ContextPreviewPanel`(FR-8-7) | `slots: ContextSlot[]` — **서버 왕복 없이 클라이언트에서만 렌더링**. 슬롯을 순서대로 챗봇 말풍선으로 그리고, `CHOICE` 타입은 버튼 미리보기까지 표시. 슬롯 필드가 바뀔 때마다 즉시 갱신(디바운스 불필요, 순수 클라이언트 연산) |

### 4.6.1 슬롯 편집기(`ContextSlotEditor`)

| 필드 | 조건부 노출 | 검증 |
|---|---|---|
| `name` | 항상 | `/^[A-Za-z0-9_]{1,50}$/`, 폼 내 유일 — 위반 시 즉시 인라인("영문/숫자/밑줄만, 폼 안에서 중복될 수 없습니다.") |
| `label` | 항상 | 1~50자 |
| `prompt` | 항상 | 1~200자, 필수 |
| `type`(셀렉트) | 항상 | `TEXT`/`NUMBER`/`DATE`/`PHONE`/`EMAIL`/`CHOICE`/`KEYWORD` — 한국어 레이블: 텍스트/숫자/날짜/전화번호/이메일/선택형/키워드 |
| `required`(체크박스) | 항상 | 기본 true. 해제 시 도움말 "사용자가 '건너뛰기'라고 입력하면 이 슬롯 없이 다음으로 넘어갑니다."(FR-8-14) |
| `choices`(`ChipListEditor`) | `type==='CHOICE'` | 2~20개, 비면 인라인 오류 |
| `keywordId`(`ResourcePickerField`) | `type==='KEYWORD'` | 필수, `resourceType='keyword'` |
| `validation.min`/`.max` | `type==='NUMBER'` | 숫자 입력 2개 |
| `validation.maxLength`/`.pattern` | `type==='TEXT'` | `pattern`은 정규식 문자열(최대 200자), 도움말 "정규식이 올바르지 않으면 검증이 생략됩니다."(엔진 안전장치 안내) |
| `validation.dateFormat`(셀렉트) | `type==='DATE'` | `YYYY-MM-DD`/`YYYY.MM.DD`/`YYYYMMDD` |
| `errorPrompt` | 항상 | 선택, 200자, 비우면 "기본 재질문 문구 + 예시값이 사용됩니다." 도움말 |
| `maxRetry` | 항상 | 0~5, 기본 2 |
| `exampleValue` | 항상 | 선택, 100자, 도움말 "재질문 시 예시로 함께 보여집니다." |

`type` 변경 시에도 노드 아웃풋과 동일한 원칙으로 **새로 나타난 조건부 필드의 첫 입력으로 포커스 이동**한다(`CHOICE`→선택지 입력창, `KEYWORD`→리소스 선택기, `NUMBER`→최소값 입력 등).

### 삭제

D4 목록의 삭제 확인은 공통 패턴(§4.3.2)을 그대로 따른다 — `409 CONTEXT_IN_USE` 시 참조 노드 목록 링크.

---

## 4.7 D5/D5a — FAQ 관리

### 목적
FAQ/스몰톡/셀프서비스/오류응답을 분류 관리하고, 중복·유사 등록을 사전에 경고한다.

### 레이아웃

```
┌───────────────────────────────────────────────────────────────────────────┐
│ 분류 ☑전체 ☑FAQ ☑스몰톡 ☑셀프서비스 ☑오류응답   검색 [______]  ☑사용중만  │
│              FAQ(12) 스몰톡(4) 셀프서비스(3) 오류응답(1)                    │
│                                    [내보내기] [엑셀/CSV 업로드] [+ FAQ 추가]│
├───────────────────────────────────────────────────────────────────────────┤
│ ☐ 분류    질문                      답변(요약)          대체질문 상태  수정일 │
│ ☐ FAQ    영업시간이 어떻게 되나요?   평일 09~18시...     2개    사용중 09-19 ⋮│
│ ☐ 오류응답 (미응답 시 기본 안내)      죄송해요, 이해...   0개    사용중 09-15 ⋮│
│                                                          ◀ 1 2 ▶          │
└───────────────────────────────────────────────────────────────────────────┘
```

`ERROR_RESPONSE` 0건 배너(FR-9-8, AC-9-6):
```
⚠ '오류응답' 카테고리에 등록된 항목이 없습니다. 미응답 시 시스템 기본 문구로 대체됩니다.
  [오류응답 FAQ 추가하기]
```
(이 배너는 목록 최상단, EmptyState가 아니라 INFO 배너 — 목록 자체는 다른 카테고리 항목이 있어 비어있지 않을 수 있으므로)

빈 상태(전체 0건): `EmptyState` "아직 등록된 FAQ가 없습니다." + [+ FAQ 추가] + [엑셀/CSV로 한 번에 등록]

### 컴포넌트 분해

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `FaqCategoryFilter` | 체크박스 4개(다중선택, UIUX §6) + 카테고리별 `counts` 배지(FR-9-2) |
| `FaqTable` | `items`, `loading`, `selectedIds` | 컬럼: `FaqCategoryBadge`, 질문, 답변(첫 60자 + "…"), 대체질문 개수, 사용여부("사용중"/"비활성" 배지), 수정일 |
| `FaqEnabledFilterToggle` | "사용중만" 체크(기본 해제 — 비활성 항목도 목록에서 바로 보여야 관리자가 다시 켤 수 있음, FR-9-7) |
| `FaqEditModal`(D5a) | `faq: FaqEntry \| null` | §4.7.1 상세 |
| `DeleteFaqConfirmDialog` / `BulkDeleteFaqConfirmDialog` | 참조 제약 없음(FR-9-10) — 단순 확인만, 항상 `204` |
| `BulkImportModal`(D5b) | `resourceType='FAQ'` | §4.4 재사용, 템플릿 4열(`분류,질문,답변,대체질문`) |

### 4.7.1 FAQ 편집 모달(`FaqEditModal`)

```
┌ FAQ 편집 ──────────────────────────────────────────────────────── ✕ ┐
│ 분류 *  [FAQ ▾]                                                       │
│ 질문 *  [영업시간이 어떻게 되나요?______________] 17/300자             │
│         ⓘ 이미 비슷한 FAQ가 있습니다: "영업시간 알려주세요"(FAQ)        │
│            [기존 항목에 대체 질문으로 추가]  [그래도 새로 만들기]        │
│ 답변 *  [평일 09:00~18:00 운영합니다.____________________] 1200/2000자│
│         (평문만 지원 — 줄바꿈은 유지되며 HTML/마크다운은 렌더링되지 않습니다)│
│ 대체 질문(0/30)  [새 대체 질문____________] [추가]                     │
│ 사용 여부  ☑ 사용함                                                    │
├──────────────────────────────────────────────────────────────────────┤
│                                                   [취소]  [저장]      │
└──────────────────────────────────────────────────────────────────────┘
```

| 컴포넌트 | props / 검증 |
|---|---|
| `FaqCategorySelect` | 셀렉트(4종), 필수 |
| `TextAreaField`(질문) | 1~300자, 카운터 |
| `FaqSuggestPanel` | `GET /faqs/suggest?q=&mode=admin`(400ms 디바운스, NFR-P4) → 최대 5건, 각 항목 "기존 항목에 대체 질문으로 추가" 버튼(클릭 시 이 모달을 닫고 대상 FAQ의 편집 모달을 열되 `altQuestions`에 현재 입력한 질문을 미리 채워 넣은 상태로 진입) | **저장을 차단하지 않는다**(FR-9-4, AC-9-3) — 어디까지나 권고 |
| `TextAreaField`(답변) | 1~2000자, 카운터, 내용 초과 시 세로 스크롤(UIUX §5) — HTML 미지원 고정 안내 문구 상시 노출 |
| `ChipListEditor`(대체 질문) | 최대 30개, 각 항목도 입력 중 동일한 `FaqSuggestPanel` 경고 로직 적용(선택적 개선 — 필수 범위는 `question` 필드) |
| `CheckboxField`(사용 여부) | 기본 true |

- 정확히 동일한 문장(정규화 기준) 저장 시 `409 DUPLICATE_FAQ` → 질문 필드 하단 인라인 "이미 같은 질문이 등록되어 있습니다."(AC-9-2) — 이 경우는 `FaqSuggestPanel`의 권고성 안내와 달리 **저장 자체가 차단**된다.
- `answer`에 `<script>` 등이 입력되어도 저장은 그대로 허용하고, 목록/상세/미리보기 어디서도 텍스트 그대로 이스케이프 렌더링한다(NFR-S2, AC-9-7 — `dangerouslySetInnerHTML` 사용 금지, 순수 텍스트 노드로만 렌더링).

---

## 5. 사용자 인터랙션 흐름 (제출 → 로딩 → 결과, 오류 처리)

이 절은 §4 각 화면에 흩어진 흐름 중 **여러 화면이 공유하는 패턴**을 한곳에 모은다.

### 5.1 공통 저장 흐름 (모든 생성/수정 폼)

```
편집 시작 → dirty=true(UnsavedGuardContext 등록)
  → 제출 클릭
    → 클라이언트 사전검증 실패 → 인라인 오류만 표시, 요청 안 보냄, 첫 오류 필드로 포커스
    → 클라이언트 사전검증 통과 → 버튼 로딩(disabled, 스피너) → API 요청
      → 2xx 성공 → Toast + dirty=false + (목록으로 복귀 또는 폼에 최신값 재바인딩)
      → 400/404/409 → §5.3 오류코드 매핑대로 인라인/배너 표시, 요청 재전송 가능(버튼 다시 활성)
      → 5xx/네트워크 → 폼 상단 배너 "처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." + 폼 내용은 보존(재입력 불필요)
```

### 5.2 삭제/일괄삭제 흐름

§4.3.2에 기술한 패턴을 의도/키워드/컨텍스트/노드/FAQ 5개 리소스가 공유한다. FAQ와 동음이의어는 참조 제약이 없어 3단계(409 배너)가 발생하지 않고 항상 `204`로 종료된다.

### 5.3 대량 업로드 흐름 (§4.4 상세와 동일, 요약)

```
파일 선택 → [검증하기] → validate(dry-run, DB 미변경)
  → 리포트 표시(신규/갱신/중복/오류/충돌) → 정책 선택(병합정책/오류정책)
  → [반영하기] → commit(단일 트랜잭션)
    → 성공 → 결과 요약 + (오류행 있으면) CSV 다운로드 제공 → 닫기 → 목록 재조회
    → IMPORT_TOKEN_EXPIRED → "다시 검증하기"로 1단계 재시도(파일 유지)
    → IMPORT_ABORTED(ABORT_ON_ERROR) → 반영 0건, 정책/파일 수정 후 재시도 안내
```

### 5.4 오류 코드 → 화면 반응 매핑

| code | 발생 화면 | UI 반응 |
|---|---|---|
| `DUPLICATE_NAME` | 의도/키워드/컨텍스트/노드/동음이의어 생성·수정 | 이름 필드 인라인 |
| `DUPLICATE_FAQ` | FAQ 생성·수정 | 질문 필드 인라인(§4.7.1) |
| `SYNONYM_CONFLICT` | 키워드 생성·수정·업로드 | 모달 상단 배너 + 충돌 키워드명 |
| `INTENT_IN_USE` / `KEYWORD_IN_USE` / `CONTEXT_IN_USE` / `NODE_IN_USE` | 각 리소스 삭제 | 삭제 모달 내부 배너 + 참조 목록 링크(§4.3.2) |
| `START_NODE_EXISTS` / `FALLBACK_NODE_EXISTS` | 노드 생성·수정 | 폼 상단 배너(§4.2 필드매핑) |
| `INVALID_REFERENCE` | 노드/동음이의어/슬롯 참조 | 해당 `ResourcePickerField` 하단 인라인 |
| `OUTPUT_PAYLOAD_INVALID` | 노드 아웃풋 저장 | 해당 아웃풋 카드 내 필드 인라인(`details[].field` = `outputs[i].xxx`) |
| `LIMIT_EXCEEDED` | 예문/슬롯/아웃풋/동의어 개수 초과 | 해당 추가 입력창 비활성 + 상단 안내(사전에 이미 `disabled`이므로 실제로는 경합 상황에서만 발생) |
| `IMPORT_TOO_LARGE` / `IMPORT_FILE_INVALID` | 업로드 1단계 | `FileUploadField` 인라인(§4.4) |
| `IMPORT_TOKEN_EXPIRED` / `IMPORT_ABORTED` | 업로드 2단계 | 2단계 상단 배너(§4.4) |
| `CHATBOT_ARCHIVED` | 이 그룹 전체 쓰기 | 폼/버튼 재비활성화 + 토스트("보관된 챗봇입니다") — `DialogueArchivedBanner`가 이미 대부분 선제 차단하므로 경합 상황 전용 |
| `NOT_FOUND` | 임의 리소스 상세/편집 진입 | 목록: 토스트+재조회 / 편집 페이지: 전체 `ErrorState` + 목록으로 |
| `INTERNAL_ERROR` / 미분류 | 전 화면 | 공통 토스트: "처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." |

**[No.26]** 신규 오류 코드(`API_OUTPUT_LEGACY_FORMAT`·`API_CONNECTION_IN_USE`)와 v2 편집 폼의 오류 반응은 `legacy-api-integration-ui-spec.md` §5에서 별도로 다룬다.

### 5.5 설계 점검 → 편집 이동 흐름 (D1 전용)

```
[설계 점검] 클릭 → validate 요청 → DesignValidationPanel 표시
  → 항목의 "{노드명} 편집" 클릭 → 해당 리소스 편집 화면으로 라우팅(href 기반)
    → 편집 화면에서 문제를 수정하고 저장
    → (수동) D1로 돌아와 "설계 점검" 재실행 — 자동 재검증은 하지 않는다(요청당 1회성 점검, 설계서 §7.8)
```

### 5.6 동음이의어 테스트 흐름 (D3a 전용)

```
테스트 입력란에 문장 입력 → [테스트] 클릭 → POST /homonyms/test
  → RESOLVED: "'{label}'로 확정" + 연결 의도명 표시
  → AMBIGUOUS: 되묻기 버튼 미리보기(BUTTON 아웃풋 그대로 렌더링)
  → IGNORED: 안내 문구만
  → 저장하지 않은 편집 중인 의미도 반영해 테스트할 수 있도록, 요청 본문은 "서버에 저장된 값"이 아니라
    현재 폼 상태를 그대로 보낼지는 백엔드 엔드포인트가 `text`만 받는 구조(§설계서 5.2)라 **저장 후에만 정확한 테스트가 가능**하다.
    편집 중(미저장) 상태에서 테스트를 누르면 폼 상단에 안내: "저장하지 않은 변경 사항은 테스트에 반영되지 않습니다. 먼저 저장해 주세요."
```

---

## 6. `UIUX_준수기준.md` 체크리스트 매핑

### 6.1 공통(전 화면)

| 기준 | 항목 | 적용 |
|---|---|---|
| §1 색상대비 | 텍스트 4.5:1 / 비텍스트 3:1, 색상 단독 금지 | `SeverityBadge`/`NodeTypeBadge`/`HomonymPolicyBadge`/`FaqCategoryBadge`/`ImportRowErrorBadge`(전부 아이콘+텍스트 병기), 오류 인라인 텍스트 |
| §3 키보드접근성 | Tab 순차/Shift+Tab 역순, Enter/Space 실행, Esc+포커스복귀 | `ResourcePickerField`(콤보박스 키보드 조작), `ReorderableList`(버튼만으로 순서변경, **드래그앤드롭 전면 배제**), `FlowPreviewPanel`(트리 펼침/접기), 모든 모달(기존 `Modal` 재사용) |
| §4 버튼 | 동사형 레이블, 중복 실행 방지, 터치 44×44px | "저장"/"추가"/"검증하기"/"반영하기", 업로드 버튼 연타 방지(§2.2-1), `ReorderableList` 위/아래 버튼 44×44px |
| §5 텍스트입력필드 | 레이블 필수, 글자수 실시간, 복사/붙여넣기 제한 금지 | 예문/답변/설명/슬롯 프롬프트 등 전 필드 `<label htmlFor>`, 300~2000자 카운터(의도 설명/FAQ 답변/컨텍스트 완료문구 등) |
| §6 폼 컨트롤 | 단일선택=라디오/셀렉트, 다중선택=체크박스, 20개 초과 시 다른 UI | 노드 유형(라디오), 아웃풋/슬롯 유형(셀렉트), FAQ 카테고리 필터(체크박스), 의도/키워드 일괄삭제(체크박스). `ResourcePickerField`는 검색형이라 20개 초과 옵션 문제 자체가 발생하지 않음(요구사항 FR-5-20 의도와 일치) |
| §7 오류 메시지 | 원인+해결방법, 제출 시점 표시 | §5.4 오류코드 매핑, `InlineFieldError` 재사용 |
| §8 로딩/상태 | 스켈레톤/스피너, 완료 시 결과 배지 | 목록 `SkeletonRow`, 업로드 진행 표시, 검증/점검 결과 요약 배지 |
| §9 내비게이션 | href 기반 링크, 페이지네이션 이중 표시 | `DialogueSubNav`, 설계 점검/삭제차단 배너의 리소스 바로가기 링크, `Pagination` 재사용 |

### 6.2 화면별

| 화면 | UIUX 항목 | 적용 지점 |
|---|---|---|
| D1 대화그래프 | §3(키보드 트리 탐색) | `FlowPreviewPanel` 펼침/접기 버튼(AC-5-14) |
| | §1(심각도 색상+텍스트) | `DesignValidationPanel`의 `SeverityBadge` |
| D1a/b 노드 편집 | §6(타입별 폼, 필수/선택 표시) | 아웃풋 유형 셀렉트 + 조건부 필드, `IMAGE`/`CARD` 대체텍스트 필수 표시(NFR-A7) |
| | §4(순서변경 버튼 44×44 + 포커스 유지) | `ReorderableList`(아웃풋/버튼/API조건), AC-5-8 |
| D2 의도·키워드 | §5(예문/동의어 칩 편집, 글자수) | `ExampleChipEditor` |
| | §7(교차 충돌은 경고이지 오류 아님을 구분) | `ExampleConflictBanner`(차단 아님) vs `SYNONYM_CONFLICT`(차단) — 시각적으로도 INFO/WARNING 톤 vs 오류 톤으로 구분 |
| D2c/D5b 대량업로드 | §8(단계별 진행 상태) | `ImportWizardSteps`, 업로드 스피너 |
| | §9(오류 리포트 표 키보드 탐색) | `ImportValidationReportTable`(네이티브 `<table>`) |
| D3 동음이의어 | §6(정책 라디오, 조건부 필드) | `HomonymPolicyRadioGroup` |
| D4 컨텍스트 | §5(질문 프롬프트 200자, 완료문구 500자 카운터) | `ContextSlotEditor`, 완료문구 필드 |
| | 비표준 항목(클라이언트 전용 미리보기) | `ContextPreviewPanel` — 실제 대화형 요소가 아니라 읽기전용 시뮬레이션이므로 별도 포커스 관리 불필요(정적 콘텐츠) |
| D5 FAQ | §5(답변 2000자, 세로 스크롤) | 답변 `TextAreaField` |
| | §7(권고 vs 차단 구분) | `FaqSuggestPanel`(권고) vs `DUPLICATE_FAQ`(차단) |

### 6.3 자동화 연계

`AC-C-4`(의도 추가→노드 생성→FAQ 등록→설계 점검까지 키보드만으로 완료), `AC-C-5`(axe 스캔 대비 4.5:1 미만 0건), `AC-5-8`(순서변경 후 포커스 유지)은 `test-automation` 단계 검증 대상이며, 본 설계의 `ResourcePickerField` 키보드 콤보박스 규칙과 `ReorderableList` 포커스 유지 구현 지침이 그 전제 조건이다.

---

## 7. 반응형 레이아웃 원칙

관리자 콘솔(`apps/web`) 기준. 브레이크포인트는 `chatbot-operations-ui-spec.md` §8과 동일하게 유지한다(데스크톱 ≥1024px / 태블릿 640~1023px / 모바일 <640px).

| 브레이크포인트 | 레이아웃 변화 |
|---|---|
| 데스크톱(≥1024px) | D0: 좌측 `DialogueSubNav`(고정 200px) + 우측 본문. D1a/b: 인풋조건(좌)+아웃풋 목록(우) 또는 상하 스택(폭에 따라 선택, 아웃풋 카드 폭 확보를 우선). D4b: 폼(좌)+`ContextPreviewPanel`(우) 2단 |
| 태블릿(640~1023px) | D0: `DialogueSubNav`가 상단 "대화설계 메뉴 ▾" 드롭다운으로 접힘(토글 버튼, 키보드 접근 가능 — `chatbot-operations-ui-spec.md` §8의 그룹트리 드로어 패턴과 동일). D1a/b: 인풋조건/아웃풋 세로 스택. D4b: 폼과 미리보기 세로 스택(미리보기가 아래) |
| 모바일(<640px) | D1/D2/D3/D4/D5 목록: 테이블 대신 카드 리스트(`DialogNodeCardList` 등, 각 카드에 이름+배지+요약을 라벨-값 스택으로). `DialogueSubNav`는 전체화면 바텀시트 또는 가로 스크롤 탭 스트립(둘 중 `frontend-implementer`가 기존 `ChatbotFilterBar`/그룹트리 모바일 패턴과 일관되게 선택). `BulkImportModal`/`ReorderableList`가 포함된 모달은 전체화면으로 전환. 모든 클릭 가능 요소 44×44px 이상 유지(§4) |

공통 원칙(선행 문서 §8과 동일, 이 그룹에 특히 중요한 항목만 재확인):

- **`ReorderableList`의 위/아래 버튼은 모바일에서도 드래그 대체 수단으로 축소되지 않는다** — 화면 폭에 관계없이 항상 명시적 버튼 2개를 유지한다(드래그앤드롭을 "터치 친화적"이라는 이유로 모바일에만 추가하는 것도 금지 — UIUX §3 요구가 화면 크기와 무관하게 적용됨).
- 텍스트 영역(예문 목록, 답변, 완료 문구)은 모든 폭에서 컨테이너 전체 너비를 사용한다(UIUX §5).
- `ImportValidationReportTable`처럼 열이 많은 표는 모바일에서 가로 스크롤 컨테이너로 감싸되(무리하게 카드로 재구성하면 행 번호·열·오류코드의 대응 관계를 잃기 쉬움), 헤더는 `position: sticky`로 고정해 스크롤 중에도 열 의미를 유지한다.

---

## 8. `frontend-implementer` 인계 메모

1. **선행 작업**: `apiClient`에 `postForm`(multipart) 추가(§0.3). 대량 업로드 3개 화면(D2c/D5b) 전부 이 위에서 동작한다.
2. **의존 스키마**: 이 문서가 참조하는 모든 스키마(§0.3)는 `backend-implementer`가 `packages/shared-types`에 반영한 뒤에야 정확히 맞는다. 특히 `DialogNodeSchema.intentIds`/`keywordIds`는 API 계약상 배열로 유지되지만(ADR-0005 §5) **저장은 조인 테이블**이라는 점은 프런트 구현에 영향이 없다(mapper가 흡수).
3. **라우트 추가**: `App.tsx`에 `/chatbots/:chatbotId/dialogue/*` 중첩 라우트 추가, `ChatbotDetailLayout.tsx`의 `Outlet`은 그대로 두고 `TabNav.tsx`에 4번째 링크만 추가한다(`ChatbotDetailContext`의 `chatbot`/`reload`/`setUnsavedGuard`는 대화설계 서브 라우트도 동일하게 `useOutletContext`로 그대로 소비할 수 있다 — 새 컨텍스트를 만들 필요 없음).
4. **상수 파일**: 이 문서의 모든 한국어 문구는 `apps/web/src/constants/messages.ts`의 `MESSAGES.dialogue.*`(및 `MESSAGES.dialogueNode`/`MESSAGES.dialogueImport` 등 하위 네임스페이스는 자유 배치)로 옮긴다(FR-0-8).
5. **컴포넌트 구현 우선순위 권고**(설계서 §1 구현 순서와 정합): `SeverityBadge`/`ResourcePickerField`/`ReorderableList`(공통 기반) → D2(의도·키워드, 다른 화면의 `ResourcePickerField`가 즉시 의존) → `BulkImportModal`(D2c) → D3 → D5 → D4 → D1(가장 많은 컴포넌트를 조합하므로 마지막).
6. **미결정/후속 확인 필요**
   - D1의 "활성화 시 설계 점검 경고 확인 모달" 통합(§4.1.2 말미)은 이번 문서에서 설계만 제시했고 실제 `StatusTransitionControls` 통합 시점은 `frontend-implementer` 판단에 맡긴다(No.5 필수 범위 아님, 있으면 더 좋은 개선).
   - `DialogueSubNav`의 리소스 건수 배지(각 서브내비 항목 옆 "12"처럼)는 선택 사항으로 남겼다 — 구현 시 각 목록 최초 로드의 `total`을 전역 상태(예: 챗봇 단위 캐시)로 공유할지, 별도 카운트 엔드포인트 없이 생략할지는 성능/일정에 따라 결정한다.
   - **[No.26 갱신 — 해결됨]** 과거 "노드 아웃풋의 `API_CONDITION.headers` 마스킹(표시/가리기 토글)의 구체적 시각 스펙 미정" 항목은 이번 갱신으로 해소되었다 — v1 헤더는 서버 응답 단계에서 값이 아예 `[비공개]`로 가려지므로(§4.2.1 ⑫) 클라이언트에 "표시/가리기" 토글 UI 자체가 필요 없다. v2는 헤더 필드가 없다(연결 레지스트리 기반).
   - 모바일에서 `DialogueSubNav`를 바텀시트로 할지 탭 스트립으로 할지(§7)는 기존 그룹트리 모바일 구현체가 나온 뒤 그 패턴을 재사용하는 쪽으로 결정할 것을 권고한다(일관성 우선, 이 문서에서 강제하지 않음).
