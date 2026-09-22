# FAQ/의도 매칭 고도화 — 2단계 답변 선택 UI 설계서

> **대상 기능**: 1단계 NLU 의미 유사도 매칭 + 2단계 외부 RAG 폴백 (No.6·9·18·30 부분)
> **입력 문서**: `docs/requirements/nlu-rag-answering.md`(J-1~J-10, FR-N1/N2/N3-*, AC-N1~N4, EX-N1/N2-*), `docs/02-spec/nlu-rag-answering-설계.md`(§6.2·§8.8 임계값, §9 2단계, §10 API, §12 성능), `docs/02-spec/decisions/ADR-0021`(임계값 3구간), `ADR-0023`(비동기 답변 전달), `docs/02-spec/개발명세서.md` §4
> **준수 기준**: `docs/03-design/UIUX_준수기준.md`(§0.4에서 2건 추가 — 슬라이더 수치입력 병행, 비동기 대기 패턴)
> **재사용 대상**: `quality-channel-ui-spec.md`(시뮬레이터 `SimulatorPanel`/`TracePanel`, `apps/widget` 전체 구조·상태기계·아웃풋 렌더링·되묻기 패턴), `stats-learning-ui-spec.md`(`ResponseSourceDistribution`), `chatbot-operations-ui-spec.md`/`security-audit-ui-spec.md`(공용 컴포넌트·`TabNav` 그룹핑 판단 선례)
> **작성**: ui-designer · 2026-09-22 · **다음 단계**: `frontend-implementer`
> **범위 경계**: React 컴포넌트 실제 코드는 작성하지 않는다. `apps/widget`은 React가 아니므로(ADR-0012) 마크업 구조·상태 전이·이벤트 흐름으로 기술한다. **문서 인입/업로드 화면은 설계하지 않는다**(J-8, No.48 보류).

---

## 0. 전제와 연계 확인

1. **엔진·API 계약은 설계서 기준으로 아직 구현되지 않은 확정 스키마다.** `SemanticMatchInput`, `ChatbotAnswerSetting`, `matchTrace`, `pendingAnswer` 등은 `backend-implementer`가 설계서(§6·§8~§10)대로 구현한 뒤 본 문서 기준으로 화면을 만든다(선행 그룹과 동일한 전제).
2. **기존 라우트는 변경하지 않는다.** `/chatbots/:chatbotId/{dashboard,settings,skin,dialogue,simulator,channels,stats}` 7개 라우트에 손대지 않고, 신규 라우트 1개만 추가한다 — `/chatbots/:chatbotId/answer-settings`(§2).
3. **`apps/widget`은 이번 그룹에서 실제로 수정된다.** No.12~15 그룹은 위젯을 건드리지 않았으나(개발명세서 §2 각주), 이번 그룹은 **PENDING 폴링·대기 UI·되묻기 버튼·출처 표기**를 위젯에 추가하는 **최초의 위젯 수정 그룹**이다. `quality-channel-ui-spec.md` §5(전체 구조·상태기계·`core/`+`ui/` 분리·`MESSAGES` 상수 분리 원칙)를 그대로 계승하며, 신규 상태·컴포넌트만 추가한다.
4. **위젯이 아웃풋을 렌더하는 방식(`toOutputViews()`)은 바뀌지 않는다.** PENDING 안내 문구는 서버가 일반 `TEXT` 아웃풋으로 내려보내므로(§9.8) 위젯은 **새로운 아웃풋 타입을 배우지 않는다** — 다만 그 응답에 동봉된 `pendingAnswer` 필드를 보고 폴링을 시작하는 로직만 추가한다.
5. **되묻기(후보 제시)는 새 UI 메커니즘이 아니다.** `quality-channel-ui-spec.md` §4.1.2/§6.6이 이미 정의한 "`MESSAGE` 버튼 되묻기" 패턴(동음이의어 되묻기)을 FAQ/의도 의미 매칭의 애매한 구간에도 그대로 적용한다(FR-N1-12). 후보 문장이 더 길다는 점만 레이아웃 조정이 필요하다(§4.5.2).
6. **데이터 바인딩 기준 스키마**는 설계서 §5·§6·§10의 `ChatbotAnswerSetting`, `RagConnectionCheckResult`, `EmbeddingIndexStatus`, `PublicMessageResponse.pendingAnswer`, `PendingAnswerPollResponse`, `SimulateResponseSchema`(확장분 `matchTrace`)다.
7. 신규 화면의 모든 한국어 문구는 `apps/web/src/constants/messages.ts`의 `MESSAGES.answerSettings.*`/`MESSAGES.simulator.*`(기존 네임스페이스 확장) 및 `apps/widget/src/constants/messages.ts`의 `MESSAGES.pending.*`로 상수화한다(FR-0-23). 두 파일은 공유하지 않는다.
8. **위험 동작이 화면에 없다는 사실 자체를 화면으로 보여준다**(S-12, FR-N3-4) — §4.1.6에서 고정 안내 문구로 명시한다.

---

## 1. 화면 목록 및 라우트

| ID | 화면명 | 라우트 | 진입 경로 | 구현 앱 |
|---|---|---|---|---|
| AS1 | AI 답변 설정 | `/chatbots/:chatbotId/answer-settings` | `TabNav`의 "AI 답변 설정" 탭(신규) | `apps/web` |
| SIM1x | 응답 테스트 결과 패널 확장 | `/chatbots/:chatbotId/simulator`(기존 라우트, 변경 없음) | 기존과 동일 | `apps/web` |
| SIM2x | 비교 모드 확장(RAG 미실행 고지만 추가) | `/chatbots/:chatbotId/simulator?mode=compare`(기존) | 기존과 동일 | `apps/web` |
| STAT-x | 응답 출처 분포 확장(RAG 조각) | `/chatbots/:chatbotId/stats`(기존, `ResponseSourceDistribution` 컴포넌트만 확장) | 기존과 동일 | `apps/web` |
| W1x/W2x | 위젯 — 답변 대기(PENDING) + 되묻기 | 없음(W1)/`/c/:slug`(W2, 기존) | 기존과 동일 | `apps/widget` |

신규 라우트는 **AS1 1개뿐**이다. 나머지는 전부 기존 화면의 컴포넌트·데이터 확장이며 라우트·URL 계약을 바꾸지 않는다.

---

## 2. 탭 배치 판단 — 신규 탭 1개 추가 (7 → 8)

### 2.1 검토한 대안과 결정

| 안 | 내용 | 채택 여부 |
|---|---|---|
| **A. 신규 최상위 탭**(채택) | `TabNav`의 "검증" 그룹에 "AI 답변 설정"을 추가해 그룹 내 2번째 항목으로 만든다. 그룹 순서: **AI 답변 설정 → 응답 테스트**(설정을 먼저 하고 나서 검증한다는 작업 흐름) | ✅ |
| B. "응답 테스트"를 셸(shell)로 승격해 하위 서브내비로 흡수 | `stats-learning-ui-spec.md`의 `StatsShell`(서브내비 2개짜리 얇은 가로 스트립) 패턴을 재사용해 `/chatbots/:chatbotId/simulator`를 셸로 바꾸고 그 안에 "응답 테스트"/"AI 답변 설정" 2개 뷰를 둔다 | ❌ |
| C. "기본설정" 탭 안의 섹션으로 흡수 | `security-audit-ui-spec.md`가 "이력"을 탭이 아니라 헤더 링크로 흡수한 선례를 따른다 | ❌ |

**B를 기각한 이유**: `/chatbots/:chatbotId/simulator`는 `quality-channel-ui-spec.md`가 이미 발급한 **살아있는 라우트**다. 이 라우트를 셸 구조로 바꾸면 (i) 편집 화면들의 "이 설정으로 테스트" 드로어 진입 흐름(SIM1-D)이 어느 서브뷰를 기본으로 열지 다시 정의해야 하고, (ii) `quality-channel-ui-spec.md` §2.1이 "`/skin` 라우트가 이미 노출돼 있어 변경 비용이 그룹핑 이득보다 크다"며 그룹 세그먼트 재구성을 **두 차례**(`quality-channel` §2.1, 암묵적으로 `security-audit`도 라우트를 안 건드리는 쪽을 택함) 기각한 것과 같은 판단 기준에 걸린다. **기존 라우트 안정성이 탭 개수 최소화보다 우선한다.**

**C를 기각한 이유**: "AI 답변 설정"은 이력 조회처럼 드릴다운 성격이 아니라 **관리자가 주기적으로 값을 바꾸고 저장하는 1급 설정 화면**이다(기본설정·스킨과 성격이 같다) — 헤더 링크로 격하하면 저장 폼 특유의 미저장 변경 가드(`UnsavedGuardContext`)·권한 게이팅을 부자연스럽게 얹어야 한다.

**A를 채택한 근거**: `stats-learning-ui-spec.md`(§1.1)가 "통계"를 신규 최상위 탭으로 추가한 선례와 같은 기준 — **독립적으로 재방문하는 1급 목적지**는 탭이 되고, **한 화면에 종속된 드릴다운**은 링크가 된다. AI 답변 설정은 전자에 속한다.

### 2.2 결과 — `TabNav` 8개 라우트, 4개 그룹 (그룹 구조 자체는 불변)

```html
<nav class="tab-nav" aria-label="챗봇 상세 탭">
  <div class="tab-nav-group" role="group" aria-label="운영">
    <a href="/chatbots/:id/dashboard">대시보드</a>
    <a href="/chatbots/:id/stats">통계</a>
    <a href="/chatbots/:id/settings">기본설정</a>
  </div>
  <div class="tab-nav-group" role="group" aria-label="설계">
    <a href="/chatbots/:id/dialogue">대화설계</a>
  </div>
  <div class="tab-nav-group" role="group" aria-label="검증">
    <a href="/chatbots/:id/answer-settings" class="tab-nav-link">AI 답변 설정</a>   <!-- [신규] -->
    <a href="/chatbots/:id/simulator" class="tab-nav-link">응답 테스트</a>
  </div>
  <div class="tab-nav-group" role="group" aria-label="배포">
    <a href="/chatbots/:id/skin">스킨/임베드</a>
    <a href="/chatbots/:id/channels">채널</a>
  </div>
</nav>
```

- **그룹 구조·마크업 패턴은 그대로**다(`quality-channel-ui-spec.md` §2.3의 `role="group"`, `<a href>` 기반, 구분자 `aria-hidden`, 모바일 드롭다운 §2.4 규칙 전부 승계). `TabNav.tsx` 1개 파일에 링크 1개를 추가하는 변경이다.
- **"운영" 그룹이 이미 3개**이므로, "검증" 그룹이 2개가 되어도 **그룹당 최대 항목 수는 늘지 않는다**(밀도 기준으로는 회귀가 아니다). 태블릿 줄바꿈 시에도 그룹 경계가 유지되므로(§2.4 기존 규칙) "AI 답변 설정"과 "응답 테스트"는 항상 붙어 표시된다.
- FR-N3-1이 우려한 "탭 과밀"에 대한 최종 판단: **8개는 이번 Phase의 상한으로 간주**하며, 다음 그룹이 9번째 탭을 요구하면 반드시 셸 구조(안 B) 도입을 재검토한다(재검토 트리거로 명시).

---

## 3. 공통 UI 요소 — 재사용/신규

### 3.1 재사용(변경 없음)

`ConfirmDialog`/`Modal`, `Toast`, `InlineFieldError`, `SkeletonCard`/`SkeletonRow`, `EmptyState`, `ErrorState`, `SeverityBadge`(INFO/WARNING/ERROR), `ArchivedBanner`, `UnsavedGuardContext`, `MESSAGES` 상수 패턴, `ChatMessageList`/`ChatBubble`/`OutputRenderer`/`TracePanel`/`TraceStepRow`(No.10~11에서 이미 구현), `ResponseSourceDistribution`/`ChartFrame`(No.14에서 이미 구현) — 이번 그룹은 이들을 **확장**만 한다(§4.3/§4.4).

### 3.2 신규 컴포넌트 (`apps/web`)

| 컴포넌트 | 용도 | 배치 |
|---|---|---|
| `AnswerSettingsPage` | AS1 화면 본체 | `pages/chatbot-detail/answer-settings/AnswerSettingsPage.tsx` |
| `SemanticMatchSection` | 1단계 영역 컨테이너 | 동일 디렉터리 |
| `ThresholdSliderField` | 슬라이더+수치입력 이중 컨트롤 1개(공용) | `components/ThresholdSliderField.tsx`(재사용 가능하도록 공용 위치) |
| `ThresholdBandVisualizer` | 3구간(확정/모호/실패) 시각화 막대 | `answer-settings/` |
| `IndexStatusBadge` | 색인 상태 배지(4상태+`staleModel`) | `answer-settings/` |
| `ReindexButton` | 전체 재색인 실행 + 진행 폴링 | `answer-settings/` |
| `RagSection` | 2단계 영역 컨테이너 | `answer-settings/` |
| `RagScopeFields` | `company`/`category`/`subcategory` 입력 그룹(상호 검증) | `answer-settings/` |
| `ProviderLockedField` | `provider: pdf` 고정 표시(잠금 아이콘) | `answer-settings/` |
| `FallbackPolicyRadioGroup` | `RAG_FIRST`/`NODE_FIRST` 라디오 | `answer-settings/` |
| `SimilarityThresholdField` | 선택적 수치 필드("기본값 사용" 체크박스 동반) | `answer-settings/` |
| `RagTimeoutField` | 타임아웃(초) 입력, 하한 120초 | `answer-settings/` |
| `ConnectionStatusBadge` | 연결 상태 배지(4상태) | `answer-settings/` |
| `ConnectionCheckButton` | 연결 점검 실행 | `answer-settings/` |
| `NoDestructiveActionsNotice` | "문서 관리 기능 없음" 고정 안내 | `answer-settings/` |
| `AnswerSettingsPreviewPanel` | 임계값 미리보기(FR-N3-5) | `answer-settings/` |
| `MatchScorePanel` | 시뮬레이터 결과에 붙는 매칭 근거 확장 패널 | `pages/chatbot-detail/simulator/` |
| `RagUsageToggle` | 시뮬레이터의 `useRag` 체크박스 | `pages/chatbot-detail/simulator/` |

### 3.3 신규/확장 (`apps/widget`)

| 요소 | 용도 |
|---|---|
| `core/pending-poll.ts` | `pendingAnswer` 폴링 순수 로직(간격 계산·상한 판정·중단 처리) |
| `ui/renderers/pending-indicator.ts` | 대기 인디케이터 DOM 생성/제거 |
| `ui/renderers/sources.ts` | 출처 텍스트 블록 렌더(`SourceList`) |
| `core/store.ts` 확장 | 상태값 `AWAITING_ANSWER` 추가(§4.4.2) |

---

## 4. 화면별 설계

## 4.1 AS1 — AI 답변 설정 `/chatbots/:chatbotId/answer-settings`

### 목적
챗봇별로 1단계(의미 유사도) 임계값과 2단계(외부 문서 기반 답변) 연동을 설정·점검하고, 저장 전 미리보기로 효과를 확인한다.

### 권한 (FR-N3-8, AC-N3-6)

| 동작 | 권한 | VIEWER 화면 |
|---|---|---|
| 조회, 색인 상태, 미리보기 | `chatbot:read` | **전부 보이고 조작 가능**(읽기 전용 동작이므로 미리보기 실행 버튼도 활성) |
| 저장, 연결 점검, 재색인 | `chatbot:write` | **버튼이 렌더되지 않는다**(disabled 아님 — 애초에 DOM에 없음). 입력 필드는 `readOnly`로 전환되고 상단에 `SeverityBadge(INFO)`: "조회 권한만 있어 값을 변경할 수 없습니다." |

### 상태별 UI

| 상태 | 조건 | UI |
|---|---|---|
| 초기 로딩 | 설정·색인상태 조회 중(2개 API 병렬) | `SkeletonCard` × 2(1단계/2단계 섹션) |
| 빈 상태 ① — 설정 없음 | `GET .../answer-settings`가 기본값 반환(행 없음, DD-89) | 상단 `SeverityBadge(INFO)`: "아직 저장된 설정이 없습니다 — 기본값이 적용되어 있으며 의미 매칭·문서 기반 답변이 모두 꺼져 있습니다." 폼은 기본값으로 채워진 채 정상 편집 가능 |
| 빈 상태 ② — 색인 0건 | `totalTargets === 0` | `IndexStatusBadge` 자리에 `EmptyState`: "아직 색인된 FAQ/의도가 없습니다." + "대화설계로 이동" 링크(`href=".../dialogue"`) |
| 빈 상태 ③ — 점검 미실행 | 연결 점검을 아직 한 번도 안 함(로컬 세션 상태) | `ConnectionStatusBadge`: "점검 필요 · 아직 확인하지 않았습니다"(중립 톤, 오류 아님) |
| 저하 모드 경고 | `providerHealthy === false` | `SeverityBadge(WARNING)`: "의미 매칭이 일시 중지되었습니다(임베딩 서비스 연결 안 됨) — 규칙 기반 매칭으로 동작 중입니다."(S-10) |
| ARCHIVED | `chatbot.status === 'ARCHIVED'` | `ArchivedBanner`(기존 패턴): "보관된 챗봇입니다. 설정 조회만 가능합니다." 저장/점검/재색인 버튼 렌더 안 함(EX-N2-17, 일반 쓰기 금지 규약과 동일) |
| 저장 성공 | `PUT` 200 | `Toast`: "저장되었습니다. 다음 턴부터 적용됩니다." |
| 저장 실패(검증) | `400 INVALID_THRESHOLD` | 해당 슬라이더/필드 하단 `InlineFieldError` |
| 재색인 진행 중 | `202` 이후 | `IndexStatusBadge` → "색인 대기 {pending}건 · 진행 중"(5초 간격 자동 갱신, 화면 이탈 시 중단) |
| 재색인 중복 | `409 REINDEX_IN_PROGRESS` | `Toast`(오류 톤): "이미 재색인이 진행 중입니다." |
| 연결 점검 미설정 | `400 RAG_NOT_CONFIGURED` | `RagScopeFields`의 `company` 필드 하단 `InlineFieldError`: "먼저 회사명을 입력하세요." |
| 연결 점검 실패 | `503 RAG_UPSTREAM_UNAVAILABLE` | `ConnectionStatusBadge` → "사용 불가(서버 응답 없음) · 방금 확인" + `Toast` |
| 스코프 0건 | 점검 성공 + `scopeChunkCount === 0` | `ConnectionStatusBadge` → "적재된 문서 0건 · 방금 확인" + `RagScopeFields` 하단 `SeverityBadge(WARNING)`: "적재된 문서가 0건입니다 — 회사/카테고리 이름이 일치하지 않을 수 있습니다."(S-7) |

### 레이아웃 (데스크톱 ≥1024px, ASCII)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ (ARCHIVED) ⚠ 보관된 챗봇입니다. 설정 조회만 가능합니다.                         │
│ (VIEWER)  ⓘ 조회 권한만 있어 값을 변경할 수 없습니다.                          │
├──────────────────────────────────────────────────────────────────────────────┤
│ 1단계 — 의미 유사도 매칭                        [의미 매칭 사용 ●켬]           │
│  모델: kure-v1@2024-05 · 차원 1024 · 마지막 색인 09-20 14:02                  │
│  색인 상태: ✔ 색인 최신(1,204/1,204)                    [전체 재색인]          │
│                                                                                │
│  확정 임계값(τ_accept)   0.80  [────────●───]  [ 0.80 ]                       │
│  되묻기 임계값(τ_low)    0.60  [──────●─────]  [ 0.60 ]                       │
│  격차 임계값(τ_margin)   0.05  [●────────────]  [ 0.05 ]                      │
│  ⓘ 위 값은 모델별 잠정 기본값입니다. 골든셋 보정 결과가 나오면 갱신됩니다.       │
│                                                                                │
│  0.00        0.60        0.80              1.00                              │
│  │▨▨▨▨▨▨▨▨▨▨│▦▦▦▦▦▦▦▦▦▦│■■■■■■■■■■■■■■■■■■│                                 │
│  2단계 이관    되묻기       확정(격차 ≥0.05)                                   │
│  (역할 이미지 aria-label: "0.60 미만은 문서검색으로 이관, 0.60~0.80은 되묻기,   │
│   0.80 이상이며 2위와 0.05 이상 차이나면 확정")                                │
├──────────────────────────────────────────────────────────────────────────────┤
│ 2단계 — 문서에서 답변 찾기(RAG)                 [문서 기반 답변 사용 ●켬]      │
│  회사명 * [국민연금공단________]  카테고리 [연금안내____]  세부 [___________]  │
│  요청 방식: (변경 불가) provider = pdf 🔒                                     │
│  우선순위:  ( ● 문서 우선 )  ( ○ 대화설계 우선 )                              │
│  출처 표시: [●켬]   유사도 임계값: [✔ 기본값 사용]  타임아웃(초): [120]        │
│  연결 상태: ⚠ 사용 불가(vLLM 미준비) · 최근 확인 12:40      [연결 점검]        │
│                                                                                │
│  ⓘ 이 화면에는 문서 업로드·삭제·초기화 기능이 없습니다. 문서 관리는            │
│     별도 기능(예정)입니다.                                                    │
├──────────────────────────────────────────────────────────────────────────────┤
│ 미리보기(저장 전 확인)                                                        │
│  시험 문장 [카드 문제요_______________________________]        [미리보기]     │
│  판정: 되묻기(모호)   후보: 결제카드 등록(0.71) · 포인트카드 조회(0.68) · —    │
│  2단계 예상: 해당 없음(되묻기 구간)                                           │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                          [취소]  [저장]        │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 컴포넌트 분해

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `AnswerSettingsPage` | `chatbotId` — `GET .../answer-settings` + `GET .../embeddings/status` 병렬 조회, `UnsavedGuardContext.setGuard(isDirty)` 등록(전용 라우트라 드로어와 달리 가드 필요) |
| `SemanticMatchSection` | `semanticEnabled`, `modelId`, `dimension`, `indexStatus: EmbeddingIndexStatus` |
| `ThresholdSliderField` | `label`, `value`, `min`, `max`, `step`, `onChange(v)`, `describedById`, `disabled?`(VIEWER/저장중) — **슬라이더(`<input type="range">`)와 숫자 입력(`<input type="number">`)이 값을 공유하며 어느 쪽을 조작해도 즉시 동기화**(NFR-A4) |
| `ThresholdBandVisualizer` | `accept`, `low`, `margin` → `role="img"` + `aria-label`(값 요약 문장, `ChartFrame`의 "표 보기 대응" 원칙과 동일하게 텍스트로도 100% 전달) |
| `IndexStatusBadge` | `status: EmbeddingIndexStatus` → 상태 4종(색인 최신/대기 N건·진행 중/실패 N건/모델 변경 감지) 아이콘+텍스트 |
| `ReindexButton` | `disabled: !can('chatbot:write') \|\| status.reindexing`, `onClick` → `POST .../embeddings/reindex`, 성공 시 `IndexStatusBadge` 5초 폴링 시작 |
| `RagSection` | `ragEnabled`, `scope: {company,category,subcategory}`, `fallbackPolicy`, `showSources`, `ragSimilarityThreshold`, `ragTimeoutMs`, `connection: RagConnectionCheckResult \| null` |
| `RagScopeFields` | `company`(필수, `ragEnabled`일 때만 필수 표시 `*`), `category`, `subcategory`(값이 있으면 `category` 필수 — 위반 시 `InlineFieldError`: "세부 카테고리를 사용하려면 카테고리를 먼저 입력하세요") |
| `ProviderLockedField` | 고정 텍스트 "pdf" + 🔒 아이콘 + `aria-readonly="true"` + 캡션 "이 값은 변경할 수 없습니다" |
| `FallbackPolicyRadioGroup` | `value: 'RAG_FIRST'\|'NODE_FIRST'`, 라디오 그룹(UIUX §6, 단일 선택) |
| `SimilarityThresholdField` | `useDefault: boolean`(체크박스, 기본 `true`), `value?: number`(체크 해제 시에만 활성화되는 숫자 입력, `0 < v < 1`) |
| `RagTimeoutField` | `valueSeconds`(표시 단위는 초, 저장은 ms), `min=120` — 120 미만 입력 시 `InlineFieldError`: "최소 120초 이상 입력하세요"(제출 차단, 서버도 재검증) |
| `ConnectionStatusBadge` | `connection: RagConnectionCheckResult \| null` → 4상태(미확인/정상/사용 불가/문서 0건) |
| `ConnectionCheckButton` | `disabled: !can('chatbot:write')`, `onClick` → `POST .../answer-settings/test` |
| `NoDestructiveActionsNotice` | 고정 문구(§4.1.6) |
| `AnswerSettingsPreviewPanel` | `text`, `onSubmit` → `POST .../answer-settings/preview` **현재 화면의(아직 저장하지 않았을 수 있는) 임계값 3종을 함께 전송**해 저장 전 실험을 지원(FR-N3-5 "현재 값"의 해석 — ⚠ 정확한 요청 스키마는 `backend-implementer` 확인 필요 항목으로 인계, §9) → 응답 `{ band, top3, wouldUseRag }` |

### 4.1.1 임계값 컨트롤 상세 (NFR-A4, AC-N3-10)

- 슬라이더 단독 제공을 금지한다 — **모든 슬라이더는 짝을 이루는 숫자 입력 필드를 항상 함께 노출**한다(UIUX_준수기준.md §6 추가 규칙, §8 갱신안 참고). 숫자 입력은 슬라이더 바로 옆(데스크톱)/아래(모바일)에 배치하고 `aria-describedby`로 서로를 연결한다.
- `τ_accept`/`τ_low`: `min=0.00, max=1.00, step=0.01`. `τ_margin`: `min=0.00, max=0.50, step=0.01`.
- **키보드 조작**: 네이티브 `<input type="range">`이므로 `←/→`(±step), `Home/End`(최소/최대)가 브라우저 기본 동작으로 제공된다(UIUX §3 자동 충족).
- **실시간 상호 검증**(제출 전 사전 검사, UIUX §7): `τ_low ≥ τ_accept`가 되는 순간 `τ_low` 필드 하단에 `InlineFieldError`: "되묻기 임계값은 확정 임계값보다 작아야 합니다." 저장 버튼은 비활성화하지 않고(오탐 방지) 제출 시점에 재검사해 동일 오류를 표시한다(UIUX §7 "제출 시점에 표시").
- `τ_accept ≥ 0.95`일 때 `ThresholdBandVisualizer` 아래에 `SeverityBadge(INFO)`: "확정 구간이 매우 좁습니다 — 대부분의 질문이 되묻기 또는 문서 검색으로 넘어갈 수 있습니다."(EX-N1-10 반영, 차단하지 않고 정보 제공만)
- `ThresholdBandVisualizer`는 색상만으로 3구간을 구분하지 않는다 — 구간마다 **패턴이 다른 해칭**(점/사선/실색) + 하단 텍스트 라벨을 병행한다(UIUX §1).

### 4.1.2 색인 상태·재색인

`IndexStatusBadge` 판정 규칙(클라이언트 순수 함수, `EmbeddingIndexStatus` 입력):

| 조건 | 표시 |
|---|---|
| `staleModel === true` | 🔴 "모델이 변경되었습니다 — 전체 재색인이 필요합니다" |
| `!providerHealthy` | 🟡 "의미 매칭 일시 중지(임베딩 서비스 연결 안 됨)" |
| `failed > 0` | 🟡 "색인 실패 {failed}건 — 다음 재색인 때 재시도됩니다" |
| `pending > 0` | 🔵 "색인 대기 {pending}건 · 진행 중" |
| 그 외 | 🟢 "색인 최신({indexed}/{totalTargets})" |

"전체 재색인" 클릭 → 확인 모달 없음(파괴적 동작이 아니라 재계산이므로, `chatbot-operations` "대화 초기화"와 같은 판단) → `202` 수신 즉시 배지가 "진행 중"으로 전환 + 5초 간격 `GET .../embeddings/status` 자동 재조회(화면 이탈 시 중단, 폴링 로직은 `useEffect` 정리 함수로 해제).

### 4.1.3 2단계(RAG) 영역 상세

- `provider` 필드는 **화면 어디에도 편집 가능한 형태로 존재하지 않는다**(J-6) — `ProviderLockedField`는 서버가 내부적으로 상수를 쓴다는 사실을 관리자에게 투명하게 보여주는 **읽기 전용 정보 표시**일 뿐, 폼 필드가 아니다(제출 payload에 포함되지 않음).
- `RagScopeFields`의 `company`는 `ragEnabled === true`일 때만 필수(`*` 표시, UIUX §6 "필수/선택 구분"). `ragEnabled === false`면 필수 표시를 숨긴다.
- `SimilarityThresholdField`: 기본 체크됨 상태("기본값 사용")에서는 숫자 입력이 `disabled`이고 값은 `null`로 저장되어(FR-N2-8) **요청에 필드 자체가 실리지 않는다**. 체크 해제 시 `0 < v < 1` 검증(초과/이하 입력 시 `InlineFieldError`).
- `ConnectionCheckButton`: 클릭 → 버튼 내부 스피너 + "확인 중..." 텍스트로 전환(연타 방지, UIUX §4) → 응답으로 `ConnectionStatusBadge` 갱신 + 타임스탬프. **이 버튼은 `/api/rag/query`를 호출하지 않는다**(FR-N3-7) — 화면에 "실제 질의 없이 상태만 확인합니다"라는 캡션을 상시 노출해 사용자가 오해하지 않게 한다.

### 4.1.4 미리보기 (FR-N3-5, AC-N3-9)

- `AnswerSettingsPreviewPanel`은 저장 버튼과 독립적으로 동작한다(자체 로딩 상태, 폼 제출과 분리).
- 결과 배지 3종: **확정**(초록 체크) / **되묻기**(파랑 물음표, 후보 최대 3건 텍스트 나열) / **실패 — 문서 검색 예상**(RAG 조건 충족 시) 또는 **실패 — 안내 문구 예상**(RAG 비활성/조건 미충족 시, `wouldUseRag: false`).
- **실제 외부 RAG를 호출하지 않는다**(§10.1 표, "저장하지 않고 외부 RAG를 호출하지 않는다") — `wouldUseRag`는 예측값이며, 화면 문구는 "문서 검색으로 넘어갈 것으로 예상됩니다"처럼 **예상 표현**을 쓴다("사용됨"이라고 단정하지 않는다).
- 판정 로직은 엔진의 `judgeBand()`와 **동일 함수**를 서버가 호출한 결과이므로(NFR-M2), 실제 대화에서의 판정과 항상 일치한다 — 이 사실을 캡션으로 짧게 안내: "이 결과는 실제 대화와 동일한 기준으로 계산됩니다."

### 4.1.5 저장 흐름

1. "저장" 클릭 → 클라이언트 사전 검증(임계값 순서, 스코프 상호 제약, 타임아웃 하한) 통과 시 `PUT .../answer-settings` 전체 교체 요청.
2. 대기 중 저장 버튼 "저장 중..." + `aria-disabled`(연타 방지).
3. `200` → `Toast` 성공 + `UnsavedGuardContext` dirty 해제.
4. `400 INVALID_THRESHOLD` → 해당 필드 `InlineFieldError`, 포커스를 첫 오류 필드로 이동.
5. `409 CHATBOT_ARCHIVED` → 상단 배너로 안내 + 폼은 저장 시도 이전 값으로 유지.

### 4.1.6 위험 동작 부재 고지 (S-12, FR-N3-4)

화면 최하단(2단계 섹션 안, `NoDestructiveActionsNotice`)에 상시 고정 문구:

> "이 화면에는 문서를 삭제·초기화하거나 시스템 프롬프트를 바꾸는 기능이 없습니다. 문서 관리는 별도 기능(제공 예정)입니다."

이 문구는 **버튼이 아니라 정적 텍스트**이며, 어떤 권한에서도 다른 동작으로 이어지지 않는다(AC-N3-2 "화면 전체를 탐색해도 삭제·초기화·프롬프트 관리 UI가 없다"를 사용자에게도 명시적으로 확인시켜 준다).

---

## 4.2 SIM1/SIM2 확장 — 매칭 근거·RAG 시험 (`/chatbots/:chatbotId/simulator`)

`quality-channel-ui-spec.md` §4.1의 `SimulatorPanel`/`TracePanel`/`ChatMessageList`를 그대로 두고 아래만 추가한다.

### 4.2.1 `RagUsageToggle` — `useRag` 체크박스 (FR-N2-3)

- 위치: `MessageComposer` 위, 툴바 영역. 기본 **꺼짐**(UIUX §6 "기본값 임의 사전 선택 금지"와 같은 취지 — 비용이 드는 옵션을 기본으로 켜지 않는다).
- 캡션(상시 노출, 체크 여부와 무관): "이 옵션을 켜면 다음 문장은 실제 외부 문서 검색을 실행하며 응답까지 최대 120초가 걸릴 수 있습니다."
- 체크된 상태에서 전송하면, 그 요청에만 `useRag: true`가 실려 간다(다음 문장부터는 다시 체크 상태 유지 여부는 세션 내 유지 — 매턴 껐다 켜는 UX 비용을 줄인다).
- **비교 모드(SIM2)에서는 이 토글 자체가 렌더되지 않는다**(AC-N2-26) — 대신 모드 전환 영역에 고정 캡션: "비교 모드에서는 문서 검색이 항상 비활성입니다."

### 4.2.2 대기 상태 확장

`useRag`가 켜진 턴은 응답이 수 초~120초 걸릴 수 있으므로, 기존 "응답 생성 중" 타이핑 인디케이터 문구를 그 턴에 한해 "문서에서 찾아보고 있어요"로 전환한다(위젯과 동일 문구 재사용, 관리자에게도 일관된 언어 노출). 전송/입력은 계속 `aria-disabled`(연타·중복 RAG 호출 방지, 기존 규칙 그대로).

### 4.2.3 `MatchScorePanel` — `TracePanel` 하위에 추가

`SimulateResponseSchema.matchTrace`(관리자 API 전용, AC-N3-8)를 바인딩한다.

```
판정 근거 보기 ▾
└ SEMANTIC · 의미 유사도 매칭 애매 — 후보 되묻기
   1위 결제카드 등록(FAQ)   0.71
   2위 포인트카드 조회(FAQ)  0.68
   3위 —
   구간: 되묻기(τ_low 0.60 ≤ 0.71 < τ_accept 0.80)
```

`useRag`가 켜져 실제로 2단계를 탄 턴은 추가 행:

```
└ RAG · 문서 기반 답변 사용됨 — 지연 4.2초 · 근거 3건
```

RAG를 켰지만 조건 미충족(예: `company` 미설정)으로 미실행이면:

```
└ RAG · 미실행(문서 기반 답변이 비활성이거나 회사명이 설정되지 않음)
```

- `TraceStepRow`의 코드 → 한국어 레이블 맵에 4종 추가: `SEMANTIC_MATCHED`("의미 유사도 매칭 성공") / `SEMANTIC_AMBIGUOUS`("의미 유사도 애매 — 후보 되묻기") / `SEMANTIC_BELOW_THRESHOLD`("의미 유사도 낮음 — 문서 검색으로 이관") / `SEMANTIC_SKIPPED`("의미 매칭 생략(저하 모드)").
- `answeredByRag === true`인 턴은 봇 말풍선 상단 요약 캡션(기존 "노드: …"/"FAQ: …"와 같은 자리)에 **"문서 기반 답변 · 근거 {N}건"**을 표시한다.

---

## 4.3 통계 — 응답 출처 분포 확장 (`/chatbots/:chatbotId/stats`, `ResponseSourceDistribution`)

`stats-learning-ui-spec.md` §3.4의 `ResponseSourceDistribution` 컴포넌트에 **`RAG` 조각 1개**만 추가한다. 새 화면·새 라우트 없음.

- `RESPONSE_SOURCE` enum이 `['NODE','FAQ','OTHER','FALLBACK']` → **`['NODE','FAQ','RAG','OTHER','FALLBACK']`**로 확장된다(판정 순서: `matchedNodeId → matchedFaqId → answeredByRag → 기타 → isAnswered=false`, DD-82와 동일 순서를 화면 표시 순서에도 그대로 반영).
- 세그먼트 패턴: 노드(실색) / FAQ(사선) / **RAG(점 패턴, 신규)** / 기타(빈칸) / 폴백(사선+회색, 기존과 동일하게 학습현황 링크 유지) — **5종 모두 색상 외에 패턴으로 구분**(UIUX §1).
- 예시(기존 4종 예시를 5종으로 갱신):

```
응답 출처 분포                          [표로 보기]
노드 ■■■■■■□□□□  53%(1,867건)
FAQ  ■■■□□□□□□□  21%(753건)
RAG  ▓▓□□□□□□□□   9%(272건)
기타 □□□□□□□□□□   0%(0건)
폴백 ▦▦□□□□□□□□  13%(456건) → 학습현황 보기
```

- `RAG` 조각은 클릭 링크가 없다(폴백만 학습현황 딥링크를 갖는다는 기존 규칙 불변).
- RAG를 아예 쓰지 않는 챗봇(`ragEnabled=false`)은 이 조각이 자연히 **0%(0건)**로 표시된다 — 별도 빈 상태를 만들지 않는다(기존 "기타 0%" 표시 관례와 동일).
- `role="img" aria-label` 요약 문장(기존 `ChartFrame` 규칙)에도 다섯 번째 값이 포함되도록 문장 템플릿만 갱신한다.

---

## 4.4 위젯 — 답변 대기(PENDING) UI (W1/W2 확장, ADR-0023)

### 4.4.1 상태기계 확장 (`quality-channel-ui-spec.md` §5.2 확장)

```
                          전송
        OPEN ─────────────────────────▶ SENDING
          ▲                                │
          │                    200 (pendingAnswer 없음)
          │                                │
          └────────────────────────────────┘
                                            │ 200 (pendingAnswer 있음)
                                            ▼
                                    AWAITING_ANSWER  ──[신규]──
                                       │  │  │
                     폴링 READY ───────┘  │  └─── 새 질문 전송(이전 폴링 중단)
                                          │              │
                     폴링 FAILED/404 ─────┤              ▼
                                          │           SENDING(새 턴)
                     90초 하드 상한 ───────┘
                                          │
                                          ▼
                                        OPEN
```

- `AWAITING_ANSWER`는 `SENDING`과 별개 상태다 — `SENDING`은 "요청을 보내고 짧게 기다리는 중"(기존 200ms~수백ms), `AWAITING_ANSWER`는 "이미 응답은 받았고(PENDING) 백그라운드 완료를 기다리는 중"(최대 90초)이라 **입력을 잠그지 않는다**는 점이 결정적으로 다르다(FR-N2-38).
- `AWAITING_ANSWER` 진입 시 `pendingAnswer.id`(=`messageId`)를 로컬에 보관하고, 그 값이 바뀌면(새 질문 전송) 이전 타이머를 취소한다(EX-N2-11).

### 4.4.2 화면 표현 — "인터림 말풍니 + 진행 인디케이터 + 결과 말풍선" 3단 구성

기존 `#cb-messages`는 `aria-relevant="additions"`(신규 노드 추가만 자동 안내)이므로, 기존 노드의 텍스트를 몰래 바꾸는 방식은 스크린리더에 전달되지 않는다. 이 계약을 바꾸지 않기 위해 **"수정"이 아니라 "추가"로만 상태를 표현**한다.

1. **PENDING 수신** — 서버가 내려준 안내 텍스트(`outputs`의 `TEXT`, 예: "문서에서 찾아보고 있어요. 잠시만요")를 **일반 봇 말풍선**으로 `#cb-messages`에 추가한다(기존 아웃풋 렌더링 그대로, 신규 아웃풋 타입 없음 — 전제 4).
2. 그 말풍선 바로 아래에 **진행 인디케이터**(`ui/renderers/pending-indicator.ts`가 만드는 별도 DOM 노드, `data-pending-id="{messageId}"`)를 붙인다: 점 3개 펄스 애니메이션(시각) + 고정 텍스트 없음(애니메이션 자체가 의미를 전달하지 않도록, 텍스트 안내는 `#cb-status`가 담당, FR-N2-39 "애니메이션만으로 상태를 전달하지 않는다"). `#cb-status`(기존 `role="status"` 영역)에 진입 시 **1회만** "문서를 확인하고 있어요"를 기록한다(매 폴링 tick마다 갱신하지 않는다 — 반복 안내는 소음이다).
3. **폴링 진행 중 사용자가 새 질문을 보내면** 진행 인디케이터 노드를 제거하고(그 뒤 도착하는 지연 응답은 버려짐, EX-N2-11) 새 턴으로 넘어간다.
4. **최종 상태 도착**(`READY`/`FAILED`/TTL 만료/90초 초과) — 진행 인디케이터 노드를 제거하고, **새로운 봇 말풍선**을 그 자리 아래에 추가한다(신규 노드이므로 `aria-relevant="additions"`가 자동으로 안내). `#cb-status`를 짧게 갱신("답변이 도착했습니다" 또는 "지금은 답변을 준비하지 못했습니다") 후 곧 비운다.

결과적으로 대화 로그에는 `[사용자 질문] → [봇: "문서에서 찾아보고 있어요…"] → [봇: 최종 답변 또는 정리 문구]`가 순서대로 남아, 별도 UI 개념 없이 **자연스러운 채팅 turn 2개**로 보인다.

### 4.4.3 폴링 규격 (FR-N2-38, `core/pending-poll.ts`)

| 항목 | 값 |
|---|---|
| 최초 대기 | `pollAfterMs`(서버 지정, 기본 1,200ms) |
| 간격 | 1.5초 |
| 하드 상한 | 최초 전송 시점부터 **90초** |
| 네트워크 오류(폴링 요청 자체 실패) | 즉시 포기하지 않고 같은 간격으로 재시도(하드 상한까지) |
| `status: 'READY'` | 폴링 중단 → §4.4.2 4단계(성공) |
| `status: 'FAILED'` | 폴링 중단 → §4.4.2 4단계, 기존 폴백 문구 |
| `404`(TTL 만료/슬러그 불일치) | 폴링 중단 → §4.4.2 4단계, "지금은 답변을 준비하지 못했어요"(S-15, 오류로 표시하지 않음) |
| 90초 경과(아직 `PENDING`) | 폴링 중단(로컬 판단, 서버 호출 없음) → §4.4.2 4단계, 동일 정리 문구 |

### 4.4.4 출처 표기 — `SourceList` (FR-N2-20~23, NFR-A3)

```html
<div class="cb-sources">
  <span class="cb-sources-label">출처</span>
  <ul>
    <li>연금안내서.pdf · 요양급여 신청 · 12쪽</li>
    <li>연금안내서.pdf · 신청서류 안내</li>  <!-- page 없음(N/A) → 쪽수 생략 -->
  </ul>
  <p class="cb-sources-caption">참고용 표시이며 정확한 위치가 아닐 수 있습니다.</p>
</div>
```

- **링크가 아니라 텍스트**다(`<a>` 아님) — 외부 경로를 열 수 없으므로 링크처럼 보이면 안 된다(NFR-A3).
- `showSources === false`(설정)거나 `sources` 배열이 비어 있으면(EX-N2-8) 이 블록 자체를 렌더하지 않는다.
- 최대 3건(FR-N2-20), `file_path`는 파일명만(서버가 이미 정제해 보내므로 위젯은 받은 문자열을 그대로 표시).

### 4.4.5 접근성 매핑 추가분 (`quality-channel-ui-spec.md` §5.8 계승 + 신규)

| 요건 | 반영 지점 |
|---|---|
| NFR-A1 대기 안내 | `#cb-status[role="status"]` 1회 기록(§4.4.2-2), 애니메이션 단독 금지 |
| FR-N2-38 입력 비잠금 | `AWAITING_ANSWER` 상태에서 `#cb-input`/`#cb-send`는 `aria-disabled` 처리하지 **않는다**(기존 `SENDING`과의 유일한 차이) |
| NFR-A3 출처 텍스트 | `SourceList`는 `<a>` 미사용 |
| EX-N2-11 폴링 중단 | 새 전송 시 진행 인디케이터 즉시 제거, 사용자에게 "취소되었습니다" 같은 부가 안내는 하지 않는다(새 턴 자체가 명확한 신호) |

---

## 4.5 되묻기(후보 제시) UI — 위젯 + 시뮬레이터 공통 (FR-N1-12/13)

### 4.5.1 메커니즘 — 신규 UI 없음

`quality-channel-ui-spec.md` §4.1.2(시뮬레이터)·§5.4(위젯)의 `BUTTON` 아웃풋(`action: 'MESSAGE'`) 렌더링을 그대로 쓴다. 서버가 "이 중에 해당하는 게 있을까요?"(S-2) 같은 `TEXT` 아웃풋 뒤에 후보 질문 원문을 `MESSAGE` 버튼으로 붙여 보내면, 클릭 시 그 텍스트가 사용자 입력처럼 재전송되어 **정확일치로 확정**된다(§6.6 동음이의어 되묻기와 100% 동일 흐름 — trace 코드만 `SEMANTIC_AMBIGUOUS`/이후 정상 매칭으로 다르다).

### 4.5.2 레이아웃 조정 — 후보 문장이 길다

동음이의어 되묻기(`[과일] [선박]`, 2~3글자)와 달리 이번 후보는 **FAQ 질문/의도 예문 원문 전체**(수십 자)일 수 있다(FR-N1-12). 기존 `.cb-buttons`/`OutputRenderer` 버튼 그룹 스타일에 다음을 추가한다.

| 항목 | 규칙 |
|---|---|
| 배치 | 가로 나열이 아니라 **세로 스택**(각 버튼 전체 너비, 최소 높이 44px, 간격 8px) — 짧은 동음이의어 후보와 시각적으로 구분되는 별도 modifier 클래스(`.cb-buttons--stacked`)를 쓰되 마크업 구조(`role="group" aria-label`)는 동일 |
| 말줄임 | 시각적으로 최대 2줄(`-webkit-line-clamp:2` 또는 동등 CSS)까지만 보이고 초과분은 말줄임 처리 |
| 접근성 이름 | 버튼의 `textContent`(스크린리더가 읽는 값)는 **항상 후보 문장 전체**를 유지한다 — 시각적 축약과 스크린리더 안내가 어긋나지 않는다(NFR-A2) |
| 최대 건수 | 3건 고정(FR-N1-13). 1건뿐이면 되묻지 않고 그 후보로 바로 확정되므로(엔진 규칙) 이 UI 자체가 나타나지 않는다 |

시뮬레이터(`apps/web`)의 `OutputRenderer`도 동일한 세로 스택 레이아웃 규칙을 CSS 클래스 공유로 적용한다(별도 React 컴포넌트를 새로 만들지 않고 기존 `OutputRenderer`의 버튼 그룹 스타일에 modifier만 추가).

---

## 5. 사용자 인터랙션 흐름 (제출 → 로딩 → 결과, 오류 포함)

### 5.1 AI 답변 설정 저장 (AS1)

```
[값 편집] → 클라이언트 사전검증(순서·상호제약·타임아웃 하한)
    실패 → 인라인 오류, 요청 안 보냄
    통과 → PUT .../answer-settings
             → 200: Toast 성공 + dirty 해제
             → 400 INVALID_THRESHOLD: 해당 필드 인라인 오류 + 포커스 이동
             → 409 CHATBOT_ARCHIVED: 상단 배너, 값 유지
```

### 5.2 연결 점검

```
[연결 점검 클릭] → 버튼 스피너("확인 중...")
    → 200: ConnectionStatusBadge 갱신(정상/스코프 0건 경고 포함) + 타임스탬프
    → 400 RAG_NOT_CONFIGURED: company 필드 인라인 오류
    → 503 RAG_UPSTREAM_UNAVAILABLE: 배지 "사용 불가" + Toast
```

### 5.3 전체 재색인

```
[전체 재색인 클릭] → 202 즉시 → IndexStatusBadge "진행 중" + 5초 폴링 시작
    → 409 REINDEX_IN_PROGRESS: Toast만(배지 변화 없음)
    → 폴링 결과 pending=0 && failed=0: 배지 "색인 최신"으로 전환, 폴링 중단
```

### 5.4 임계값 미리보기

```
[시험 문장 입력] → [미리보기 실행] → 로딩(패널 내부 스켈레톤)
    → 200: 판정 배지(확정/되묻기/실패) + 상위 3후보 + 2단계 예상 여부
    → 503 EMBEDDING_UNAVAILABLE: 패널 내 ErrorState("의미 매칭 서비스에 연결할 수 없습니다")
```

### 5.5 시뮬레이터 — `useRag` 시험

```
[useRag 켬] → [문장 전송] → (1단계 실패 시) 대기 문구 "문서에서 찾아보고 있어요" + 스피너(최대 120초)
    → 200: 봇 말풍선 + MatchScorePanel(RAG 사용 · 지연 · 근거 건수)
    → 실패/타임아웃: 기존 폴백 문구 + MatchScorePanel(RAG 미사용 사유 표시)
```

### 5.6 위젯 — PENDING 대기 (핵심 신규 흐름)

```
[사용자 질문 전송] → SENDING → 200(pendingAnswer 있음) → AWAITING_ANSWER
    인터림 말풍선 "문서에서 찾아보고 있어요" + 진행 인디케이터 + #cb-status 1회 안내
    (입력 잠기지 않음)
    → 최초 1.2초 대기 → 1.5초 간격 폴링
        → READY: 인디케이터 제거 + 새 봇 말풍선(답변+출처)
        → FAILED / 404: 인디케이터 제거 + 새 봇 말풍선(폴백 문구)
        → 90초 초과: 인디케이터 제거 + 새 봇 말풍선("지금은 답변을 준비하지 못했어요")
        → (도중 사용자가 새 질문 전송): 인디케이터 제거, 이전 폴링 폐기, 새 턴(SENDING)으로 즉시 진행
```

### 5.7 위젯/시뮬레이터 — 되묻기(공유)

```
"카드 문제요" 전송 → 봇: "이 중에 해당하는 게 있을까요?" + [결제카드 등록][포인트카드 조회]
"결제카드 등록" 버튼 클릭(MESSAGE) → 사용자 말풍선 "결제카드 등록" → 정확일치 확정 응답
```

---

## 6. `UIUX_준수기준.md` 체크리스트 매핑

### 6.1 AS1(관리자 콘솔)

| 기준 | 항목 | 적용 지점 |
|---|---|---|
| §1 색상대비 | 색상 단독 금지 | `ThresholdBandVisualizer`(패턴+텍스트), `IndexStatusBadge`/`ConnectionStatusBadge`(아이콘+텍스트) |
| §3 키보드접근성 | Tab 순차, 방향키 | 슬라이더 네이티브 키보드 동작, `TracePanel` 토글 계승 |
| §4 버튼 | 동사형, 연타 방지, 44×44px | "저장"/"연결 점검"/"전체 재색인", 저장 중 `aria-disabled` |
| §5 텍스트입력필드 | 레이블 필수 | `RagScopeFields`(`<label for>`), `RagTimeoutField` |
| §6 폼컨트롤(신규 규칙 포함) | 라디오=단일선택, **슬라이더+수치입력 병행**(§8 갱신안) | `FallbackPolicyRadioGroup`, `ThresholdSliderField` |
| §7 오류메시지 | 원인+해결, 제출 시점 | 임계값 상호검증, `RAG_NOT_CONFIGURED` 인라인 |
| §8 로딩/상태(신규 규칙 포함) | 스켈레톤/완료 배지, **비동기 대기 패턴**(§8 갱신안) | 저장 완료 Toast, 재색인 진행 배지 |
| §9 내비게이션 | href 기반 탭 | `TabNav`(§2) |

### 6.2 SIM1x/SIM2x

| 항목 | 적용 지점 |
|---|---|
| §8 로딩→완료 | "문서에서 찾아보고 있어요" → 봇 말풍선 전환(useRag 턴) |
| §6 체크박스 | `RagUsageToggle`(단일 온/오프) |
| §1 색상 단독 금지 | `MatchScorePanel`의 구간 배지(아이콘+텍스트) |

### 6.3 STAT-x

| 항목 | 적용 지점 |
|---|---|
| §1 색상 단독 금지 | `ResponseSourceDistribution` 5세그먼트 패턴 구분 |

### 6.4 위젯(W1/W2)

| 항목 | 적용 지점 |
|---|---|
| (a) 전 항목 + 신규 **비동기 대기 패턴** | §4.4 전체(진행 인디케이터+`#cb-status`+90초 정리 문구) |
| NFR-A3 링크 아님 | `SourceList` |
| NFR-A2 되묻기 키보드 | `.cb-buttons--stacked` 내부 버튼(네이티브 `<button>` 유지) |
| §4 터치 영역 | 세로 스택 버튼도 최소 높이 44px 유지 |

---

## 7. 반응형 고려사항

### 7.1 AS1(`apps/web`)

| 브레이크포인트 | 레이아웃 |
|---|---|
| 데스크톱 ≥1024px | 1단계/2단계 섹션 각각 카드형 2단 배치(라벨 좌 240px 고정 + 컨트롤 우 가변), 슬라이더+숫자입력 가로 배치 |
| 태블릿 640~1023px | 라벨을 컨트롤 위로 이동(세로 스택), 슬라이더 폭은 컨테이너 전체(UIUX §5) |
| 모바일 <640px | 미리보기 패널은 아코디언(기본 접힘), 슬라이더 트랙 높이·숫자입력 폭 확대(터치 44px 유지), 저장 버튼은 하단 고정(sticky) |

### 7.2 위젯(`apps/widget`)

`quality-channel-ui-spec.md` §8.2의 데스크톱 플로팅/모바일 전체화면 원칙을 그대로 따른다. 진행 인디케이터·`SourceList`는 패널 폭에 맞춰 줄바꿈만 조정되고 별도 반응형 분기가 필요 없다(고정폭 요소가 아니므로).

---

## 8. `UIUX_준수기준.md` 갱신안

system-architect 인계(§15.1) 및 요구사항 §10에 따라 아래 2건을 `docs/03-design/UIUX_준수기준.md`에 반영한다(기존 절 번호는 바꾸지 않고 해당 절 안에 규칙을 추가하는 방식 — 이 문서를 참조하는 다른 설계서들의 "§6"/"§8" 인용이 깨지지 않도록 함).

- **§6(폼 컨트롤)에 추가**: "정밀한 수치 조정이 필요한 슬라이더(`type=range`)는 같은 값을 표시·수정할 수 있는 숫자 입력 필드를 항상 함께 제공한다(슬라이더 단독 제공 금지). 슬라이더의 현재 값은 텍스트로 상시 노출한다."
- **§8(로딩/상태 피드백)에 추가**: "서버가 즉시 결과를 반환하지 못하고 백그라운드에서 계속 처리하는 경우(예: 외부 시스템 연동 응답 대기), 대기 상태는 (1) 시각적 진행 표시와 (2) `aria-live`/`role=\"status\"` 텍스트 안내를 함께 제공한다. 다른 입력을 차단하지 않는 것을 기본으로 하며, 상한 대기시간을 두고 초과 시 '지금은 처리하지 못했습니다' 류의 정리 문구로 상태를 명확히 종료한다(무한 로딩 금지)."

실제 파일 반영은 본 UI 설계 승인 이후 별도 커밋으로 처리한다(문서 변경 승인 절차 준수).

---

## 9. `frontend-implementer` 인계 메모

1. **선행 확인**: `packages/shared-types`의 `answering.ts`(§5), `conversation.ts`의 `pendingAnswer`/`PendingAnswerPollResponse` 확장, `SimulateResponseSchema.matchTrace`가 `backend-implementer`에 의해 먼저 구현돼 있어야 한다.
2. **`TabNav` 변경은 링크 1개 추가**다(§2) — 그룹 구조·기존 7개 라우트는 그대로 둔다.
3. **`AnswerSettingsPreviewPanel`의 정확한 요청 스키마(현재 폼 값 vs 저장된 값)는 미결정**이다(§4.1.4) — `backend-implementer`와 확정 후 구현할 것.
4. **위젯은 `core/`(순수 로직, `pending-poll.ts`) → `ui/`(DOM, 인디케이터·출처 렌더러) 순서로 구현**한다(`quality-channel-ui-spec.md` §9-6 원칙 계승). `apps/web`의 컴포넌트·`MESSAGES`를 import하지 않는다.
5. **`ThresholdSliderField`는 공용 컴포넌트로 3곳(τ_accept/τ_low/τ_margin)에서 재사용**한다 — `min`/`max`/`step`만 다르다.
6. **`ResponseSourceDistribution` 확장은 데이터·enum 변경뿐**이다 — 컴포넌트 구조·차트 프레임(`ChartFrame`)은 그대로 둔다.
7. **미결정 사항**: `ThresholdBandVisualizer`의 정확한 픽셀 폭 비율(구간 경계에 따라 동적으로 변하는 막대 폭 계산 로직)은 컴포넌트 구현 시점에 확정. 위젯 진행 인디케이터의 애니메이션 세부(펄스 속도 등)도 디자인 토큰 확정 후 조정.

## 10. 알려진 제한사항 (code-reviewer 2차 검증, 2026-09-22)

**되묻기 버튼 세로 스택 판정의 잔여 오탐 가능성** — `OutputRenderer.tsx`/`apps/widget`의 `allowStackedLayout` 로직(§4.5)은 "그룹 내 모든 버튼이 `action:'MESSAGE'`"를 되묻기 신호로 쓴다. 그러나 `ButtonItemEditor.tsx`로 관리자가 대화노드 퀵메뉴를 구성할 때도 버튼 전부를 `MESSAGE` 액션(라벨 40자까지 허용)으로만 만드는 것이 흔한 패턴이라, 이 경우 되묻기가 아닌 일반 퀵메뉴도 세로 스택으로 레이아웃될 수 있다. 백엔드 계약에 "이 BUTTON 출력이 되묻기인지"를 구분하는 `variant` 필드가 없어 프런트 단독으로는 완전히 해소할 수 없다(레이아웃 미관 이슈 수준, 기능 차단 아님).

**후속 조치 후보**(백로그, 아직 착수하지 않음): `system-architect`와 협의해 되묻기 출력에 `variant: 'clarify'` 같은 구분 필드를 추가하는 설계 변경을 검토할 것. 착수 전까지는 이 잔여 리스크를 감수한다.
