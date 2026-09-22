# 학습 고도화 — 예문 증강(No.16) · 미응답 요소분해 + 경량 분류기(No.23) 화면설계서

> **대상 기능**: No.16(예문 증강, DLE) · No.23(미응답 요소분해 + 경량 분류기)
> **입력 문서**: `docs/requirements/learning-augmentation.md`(FR-0-49~58, FR-L1-*, FR-L2-*, FR-L3-*, NFR-L*, AC-L1~L4, S-1~S-14), `docs/02-spec/learning-augmentation-설계.md`(§4~§6 포트/역할, §7 데이터모델, §8 shared-types, §10~§13 API·검증·봉인 설계, §15 API 10종, §21.4 ui-designer 인계), `decisions/ADR-0025~0028`, `decisions/ADR-0018-보론`
> **준수 기준**: `docs/03-design/UIUX_준수기준.md`(전 항목 + 이 문서가 신설하는 "제안-자산 분리" 패턴, §2)
> **선행 산출물 참고(뒤집지 않고 확장만 한다)**: `dialogue-design-ui-spec.md` §4.3.1(`IntentEditModal`, D2a) · `stats-learning-ui-spec.md` §4(L1 학습현황, `ResolveModal`, `NodeUnlinkedWarningBanner`)
> **작성**: ui-designer · 2026-09-22 · **다음 단계**: `ml-engineer`/`backend-implementer` → `frontend-implementer` → `code-reviewer` → `test-automation`
> **범위 경계**: 실제 React 컴포넌트 코드는 작성하지 않는다. `apps/widget`은 수정하지 않는다(FR-0-49, 이 그룹 전부가 관리자 콘솔 기능). **최상위 탭·서브내비 항목을 신설하지 않는다** — 아래 두 기존 화면의 확장으로 전부 흡수한다.

---

## 0. 전제와 연계 확인

1. **이 문서는 기존 화면 2개를 확장한다. 새 라우트를 만들지 않는다.**
   - `dialogue-design-ui-spec.md` §4.3.1의 `IntentEditModal`(D2a, `/chatbots/:chatbotId/dialogue/intents?resource=intent` 위 모달) → **예문 증강 패널**을 추가한다(No.16).
   - `stats-learning-ui-spec.md` §4의 L1 학습현황(`/chatbots/:chatbotId/stats/learning`) → **분류기 상태 패널**(화면 상단)과 **`ResolveModal`의 요소분해 섹션**을 추가한다(No.23).
   - `StatsShell`의 서브내비는 여전히 `기본 통계 | 학습현황` 2개뿐이다. **"분류기" 서브내비 항목을 만들지 않는다** — 설계서 §21.4가 판단을 ui-designer에게 위임했고(FR-L3-2), 이 문서는 **접이식 패널로 흡수**하는 쪽을 택한다(근거는 §5.1).
2. **아키텍처 제약을 그대로 받아들인다**: FR-0-49(엔진 무변경) · FR-0-50/AC-L4-3(승인 없는 자산 변경 경로 0건 — "제안-자산 분리" 패턴의 존재 이유) · FR-L2-13/AC-L2-8(기존 `POST .../resolve`는 무회귀로 유지) · FR-L3-6/K-4(반영 완료 문구는 `appliedImmediately` 응답값 분기, `MESSAGES` 상수만 사용) · FR-L3-9(VIEWER는 쓰기 액션 렌더 자체를 하지 않음).
3. **현재 코드 상태 확인 결과**(이 문서의 전제):
   - `IntentEditModal`은 이름/설명/`ExampleChipEditor`(예문 최대 500개, 이미 내부 스크롤 컨테이너 보유)/`ExampleConflictBanner`/`LinkedNodesReadonlyList` 순으로 구성된 `modal--lg` 크기 모달이다(`dialogue-design-ui-spec.md` §4.3.1). 이 문서는 그 안에 **접이식 패널 1개**를 `ExampleChipEditor` 바로 아래, `LinkedNodesReadonlyList` 위에 끼워 넣는다.
   - L1의 `UnansweredDetailPanel`(펼침 영역)은 `표기 변형 → 추천 의도 후보 → 발생 추이 → [반영]/[무시]` 순이다(`stats-learning-ui-spec.md` §4.3). 이 문서는 `표기 변형`과 `추천 의도 후보` 사이에 **요소 분해** 섹션을 추가하고, `추천 의도 후보`에는 출처 배지를 얹는다.
   - `ResolveModal`은 `IntentTargetField` + `ExampleTextArea` + 고정 안내 문구로 구성된 단순 모달이다(§4.5). 이 문서는 그 아래에 **접이식 "요소 분해(선택)" 섹션**을 추가한다 — 손대지 않으면 기존 `POST .../resolve` 그대로 동작한다(무회귀).
   - `Modal`/`ConfirmDialog`/`Toast`/`Pagination`/`EmptyState`/`ErrorState`/`StatusBadge`/`InlineFieldError`/`MultiSelectDropdown`/`Skeleton*`/`ChartFrame`(`stats-learning-ui-spec.md` §2.5)는 **이미 존재**하며 재사용한다.
4. **이 문서가 다루지 않는 것**: `apps/widget`(F-0-49) · No.15의 기존 단순 반영 플로우 자체(무회귀로 유지, 손대지 않음) · `기본 통계`(S1) 화면(변경 없음) · 챗봇 전체 일괄 증강(범위 밖, §9).
5. **판단 요약(선반영)**:
   - No.16의 진입점은 **의도 상세 모달 안의 접이식 패널** 1곳뿐이다(모달 위에 모달을 쌓지 않는다 — 포커스 트랩 중첩을 피하기 위함, §4.1 근거).
   - No.23의 두 층(요소분해/분류기)은 **하나도 새 내비게이션을 만들지 않고** 기존 L1 화면 안에 흡수한다.
   - 이 그룹이 "제안(승인 대기)"과 "자산(확정)"을 구조적으로 분리해야 한다는 요구(J-11, FR-0-50)를 화면에서도 강제하기 위해, **"제안-자산 분리" 레이아웃 패턴**을 이 문서 §2에서 먼저 정의하고 이후 모든 화면에 일관 적용한다. 이 패턴은 `UIUX_준수기준.md` §1에도 추가한다(§10 참고).

---

## 1. 화면 목록 및 진입 경로 (신규 라우트 0건)

| ID | 화면/조각 | 소속 라우트 | 배치 위치 | 신설 여부 | 필요 권한 |
|---|---|---|---|---|---|
| A1 | 예문 증강 패널 | `/chatbots/:chatbotId/dialogue/intents?resource=intent` (D2) | `IntentEditModal`(D2a) 내부, `ExampleChipEditor` 바로 아래 | **아니오**(기존 모달 확장) | 조회 `dialogue:read` / 생성·승인·거절 `dialogue:write` |
| B1 | 분류기 상태 패널 | `/chatbots/:chatbotId/stats/learning` (L1) | L1 페이지 상단, `PendingLimitBanner`와 필터바 사이 | **아니오**(기존 페이지 확장) | 조회 `dialogue:read` / 재학습 `dialogue:write` |
| B2 | 요소 분해 섹션 | `ResolveModal`(L1에서 오픈) | 기존 `ExampleTextArea` 아래, 고정 안내 문구 위 | **아니오**(기존 모달 확장) | 조회 `dialogue:read` / 반영 `dialogue:write` |
| B3 | 추천 의도 출처 배지 | `UnansweredDetailPanel`의 `SuggestionList`(L1 펼침 영역) | 기존 후보 행 옆 | **아니오**(기존 컴포넌트 확장) | `dialogue:read` |

**신설 라우트 0건, 신설 최상위 탭 0건, 신설 서브내비 0건.** 이 표가 이 문서의 전체 화면 목록이다.

---

## 2. "제안-자산 분리" 레이아웃 패턴 (신규 UIUX 패턴 정의)

ADR-0025 §5(J-11)와 FR-0-50/AC-L4-3이 요구하는 "제안은 관리자 승인 전까지 자산과 절대 섞이지 않는다"는 구조적 원칙을, 화면에서도 같은 강도로 드러내기 위한 **레이아웃 패턴**이다. 이 그룹의 모든 신규 화면 조각(A1의 증강 제안 표, B2의 엔티티 등록 대기열)이 이 패턴을 따른다. `UIUX_준수기준.md`에도 이 패턴을 추가한다(§10.1).

### 2.1 규칙 6개

| # | 규칙 |
|---|---|
| P-1 | 제안(승인 대기) 항목과 자산(확정) 항목은 **같은 목록에 상태 컬럼만 다르게 표시하지 않는다.** 서로 다른 컨테이너(카드/패널)에 물리적으로 분리해 렌더한다. |
| P-2 | 제안 컨테이너는 **옅은 주의색 배경(베이지/옅은 노랑 계열) + 점선 테두리**를 쓴다. 자산 컨테이너는 일반 카드 배경(흰색) + 실선 테두리를 유지한다. 주의색은 "위험(빨강)"과 혼동되지 않게 §1 색상 의미 체계를 그대로 따른다(색상 단독 아님 — 컨테이너 헤더에 "제안(승인 전)" 텍스트 라벨을 항상 병기). |
| P-3 | 제안 컨테이너 헤더에는 **"승인 전까지 대화에 영향을 주지 않습니다"** 류의 안내를 상시 노출한다(스크롤해도 컨테이너를 벗어나지 않는 한 계속 보임 — sticky는 아님, 컨테이너 최상단 고정). |
| P-4 | 자산으로의 승격은 **제안 컨테이너 안에 있는 단일 진입점 버튼**을 통해서만 일어난다("선택 항목 예문으로 추가" 등). 자산 쪽 컨테이너에는 "제안 가져오기" 같은 대응 버튼을 두지 않는다 — 흐름이 한 방향(제안 → 자산)임을 화면 구조로도 강제한다. |
| P-5 | 제안이 승격되면 그 항목은 제안 컨테이너에서 **사라지고**, 자산 컨테이너(예: 예문 칩 목록)에 **일반 항목과 동일하게** 나타난다. 승격된 항목을 자산 쪽에서 별도로 표시하지 않는다(출처 구분은 이력관리에서만 확인 — S-12). "제안 vs 자산"의 시각적 구분은 **승인 전에만** 의미가 있다. |
| P-6 | 제안 컨테이너 안에서도 위험도가 다른 정보(예: 타 의도 충돌 경고)는 **별도의 배지**로 얹는다 — 컨테이너의 "제안" 색과 항목의 "충돌 경고" 색을 같은 레이어에서 겹치지 않게 한다(배지 1개가 두 의미를 동시에 담지 않는다). |

### 2.2 적용처

| 적용 화면 | 자산 컨테이너 | 제안 컨테이너 |
|---|---|---|
| A1 예문 증강 패널 | `ExampleChipEditor`(기존 예문 칩 목록, 흰 배경) | `AugmentationSuggestionTable`(증강 제안 표, 옅은 배경 + 점선) |
| B2 요소 분해 섹션 | 기존 `Keyword.synonyms`/`Keyword.name`(반영 즉시 자산 — 이 화면에는 별도 표시 없음, 반영 후 대화설계에서 확인) | `EntityActionQueue`(엔티티 등록 "대기열" — 아직 제출 전인 액션 목록, 옅은 배경 + 점선) |

> B2의 `EntityActionQueue`는 서버에 저장되는 제안 테이블이 아니라 **모달 세션 내의 로컬 대기열**(제출 전 클라이언트 상태)이지만, "아직 자산이 아니다"라는 의미는 동일하므로 같은 시각 언어를 재사용한다 — 사용자가 "제안"이라는 단어의 의미를 화면마다 다시 배우지 않게 한다.

---

## 3. 공통 신규 UI 요소

| 컴포넌트 | props | 규칙 |
|---|---|---|
| `SimilarityBadge` | `{ score: number }` | 수치(`0.86`) + 텍스트 라벨을 항상 병기(NFR-LA3, 색상 단독 금지). 밴드: `≥0.95` "매우 유사"(중복 근접 — 후술 §4.4에서 사실상 노출되지 않음, 노출 시엔 참고용) · `0.85~0.94` "유사" · `0.75~0.84` "다소 다름". |
| `ConflictBadge` | `{ intentName: string; score: number }` | 주황 계열 경고 아이콘 + "⚠ 다른 의도 '{intentName}'와 유사(0.83)" 텍스트. 클릭 시 해당 의도로 이동하는 링크는 제공하지 않는다(모달 컨텍스트 이탈 방지 — 정보 제공 목적). |
| `ProviderBadge` | `{ providerId: 'rule'\|'gemini'\|'local'\|'mock' }` | `rule`→"규칙 기반" · `gemini`→"AI 생성(Gemini)" · `local`→"로컬 생성모델" · `mock`→ 화면에 노출되지 않음(테스트 전용, 프로덕션 빌드에서 `AUGMENTATION_PROVIDER=mock` 자체가 불가). 중립 회색 배지. |
| `SuggestionSourceBadge` | `{ source: 'CLASSIFIER'\|'LEXICAL' }` | `CLASSIFIER`→ 보라 계열 "분류기 추천"(스파클 아이콘) · `LEXICAL`→ 회색 "문자 유사도"(텍스트 아이콘). 색상+아이콘+텍스트 3중 구분. |
| `ClassifierStatusBadge` | `{ state: 'NONE'\|'TRAINING'\|'READY'\|'FAILED'; stale: boolean; staleReasons: string[] }` | §5.1.2에서 5색상 매핑 정의. |
| `AsyncJobProgress` | `{ label: string; progress?: number; ariaLiveText: string }` | `aria-live="polite"` 텍스트 안내 + 진행률(있으면 바, 없으면 인디터미네이트 스피너) 동시 제공(NFR-LA1, UIUX §8 "애니메이션만으로 상태를 전달하지 않음"). 최대 대기시간 초과 시 "작업이 오래 걸립니다 — 잠시 후 새로고침해 주세요"로 폴링을 정리(무한 로딩 금지, UIUX §8). |
| `ProposalContainer` | `{ title, safetyNotice, children }` | §2의 "제안" 컨테이너 셸(옅은 배경 + 점선 + 상단 고정 안내). `AugmentationSuggestionTable`과 `EntityActionQueue`가 공통으로 감싼다. |

---

## 4. 화면 A — 의도 상세: 예문 증강 패널 (No.16)

### 4.1 목적 · 진입 경로 · 왜 "모달 위 모달"이 아닌가

`IntentEditModal`에서 예문이 빈약한 의도의 표현 다양성을 관리자 승인 하에 넓힌다(S-1~S-4, S-11~S-13). 진입: `IntentEditModal` 안 "예문 (n/500)" 헤더 옆의 **`[예문 늘리기]`** 버튼.

**결정: 패널은 별도 모달이 아니라 같은 모달 안의 접이식(collapsible) 섹션이다.** 근거:
1. 증강 제안 표(최대 20행)와 예문 칩 목록을 **같은 화면에서 나란히** 봐야 승인 여부를 판단하기 쉽다(제안 문장이 기존 예문과 겹치는지 눈으로도 대조).
2. 모달 위에 모달을 쌓으면 포커스 트랩이 중첩되어 Esc/포커스 복귀 규칙(UIUX §3)이 두 겹으로 얽힌다 — 기존 `Modal` 컴포넌트는 단일 활성 모달 전제로 만들어졌다(선행 그룹들의 관용구, 중첩 모달 선례 없음).
3. 승인 즉시 같은 모달 안의 `ExampleChipEditor`가 갱신되는 것을 보여줄 수 있어 "제안 → 자산" 전이(§2 P-5)를 사용자가 바로 확인한다.

### 4.2 레이아웃 (데스크톱, ASCII — `IntentEditModal` 내부, 기존 §4.3.1 레이아웃에 이어짐)

```
┌ 의도 편집 — 배송문의 ──────────────────────────────────────────── ✕ ┐
│ 이름        [배송문의______________________]                        │
│ 설명        [______________________________] 0/300자                │
├────────────────────────────────────────────────────────────────────┤
│ 예문 (1/500)                                        [✨ 예문 늘리기] │
│ [새 예문 입력__________________________] [추가]                       │
│ [환불 규정 안내 ×]                                                   │
├────────────────────────────────────────────────────────────────────┤
│ ▾ 예문 증강 (제안 9건 · 검토 대기)                                   │  ← 접이식, 기본 펼침(제안 有 시)
│ ┌ 제안(승인 전) ─────────────────────────────────────────────────┐  │
│ │ ℹ 승인 전까지 대화에 영향을 주지 않습니다                        │  │
│ │ 생성 12건 중 9건 통과(의미 이탈 2 · 중복 1)                       │  │
│ │ ☐ 전체 선택(9)                        [규칙 기반]                │  │
│ │ ☐ "환불 어떻게 해요?"            유사 0.86            [승인][거절]│  │
│ │ ☐ "돈 돌려받을 수 있나요"        유사 0.81            [승인][거절]│  │
│ │ ☐ "반품하면 환불되나요"          유사 0.79 ⚠반품문의와 유사(0.83) │  │
│ │                                                       [승인][거절]│  │
│ │ ... (스크롤, 최대 9행 표시 후 내부 스크롤)                        │  │
│ ├──────────────────────────────────────────────────────────────┤  │
│ │ 2건 선택됨              [선택 예문으로 추가]  [선택 거절]  [해제] │  │  ← 1건 이상 선택 시만
│ └──────────────────────────────────────────────────────────────┘  │
├────────────────────────────────────────────────────────────────────┤
│ 이 의도를 사용하는 노드: (없음)                                      │
├────────────────────────────────────────────────────────────────────┤
│                                              [취소]  [저장]          │
└────────────────────────────────────────────────────────────────────┘
```

접기 상태(제안 0건, 첫 진입):

```
│ ▸ 예문 증강 (제안 없음)                                              │
```

펼치면:

```
│ ▾ 예문 증강 (제안 없음)                                              │
│ ┌ 제안(승인 전) ─────────────────────────────────────────────────┐  │
│ │ ℹ 승인 전까지 대화에 영향을 주지 않습니다                        │  │
│ │ 아직 생성된 제안이 없습니다. 아래 버튼으로 이 의도의 예문 표현을  │  │
│ │ 넓혀보세요.                                                       │  │
│ │                                          [✨ 새로 생성하기]       │  │
│ └──────────────────────────────────────────────────────────────┘  │
```

### 4.3 상태별 UI

| 상태 | UI |
|---|---|
| **빈 상태 ①** — 제안 0건, 생성 전 | "아직 생성된 제안이 없습니다..." + `[새로 생성하기]`(FR-L3-10-①). 예문이 이미 `AUGMENTATION_SUFFICIENT_EXAMPLES`(기본 10) 이상이면 버튼 위에 "ⓘ 이 의도는 예문이 {n}건으로 충분합니다 — 증강 이득이 작을 수 있습니다"를 병기(요청은 막지 않음, FR-L1-2). |
| 생성 요청 중 (202 수신 직후 ~ 완료) | `[새로 생성하기]` 자리에 `AsyncJobProgress`: "생성 중입니다(검증 포함, 최대 약 30초 소요될 수 있습니다)" + 스피너, `aria-live="polite"`. 폴링 300ms 최초 지연 · 700ms 간격 · 최대 60초(§15.2). 60초 초과 시 "작업이 오래 걸립니다 — 잠시 후 다시 열어 확인해 주세요"로 폴링 종료(백그라운드는 계속 진행, 무한 로딩 금지). |
| **빈 상태 ②** — 생성했으나 전부 검증 탈락 | 검증 요약만 표시: "생성 12건 중 12건 모두 제외(의미 이탈 8 · 중복 4)" + "이번 생성에서는 통과한 제안이 없습니다. 예문을 더 다양하게 등록한 뒤 다시 시도해 보세요."(FR-L3-10-②) + `[다시 생성하기]`(오류 아님, 정보 톤). |
| 제안 있음(성공) | §4.2 레이아웃대로. 검증 요약 상시 표시(FR-L3-4). |
| Provider 저하 | `AugmentationCapabilityBanner`: "ⓘ Gemini API 키가 설정되지 않아 규칙 기반으로 생성됩니다."(`API_KEY_MISSING`) / "ⓘ 고급 생성 엔진 상태를 확인할 수 없어 규칙 기반으로 생성됩니다."(`UNHEALTHY`) / "ⓘ 고급 생성 엔진 호출이 반복 실패해 일시적으로 규칙 기반으로 전환되었습니다."(`CIRCUIT_OPEN`, AC-L1-15). 버튼은 막지 않는다(자동 폴백, FR-L1-7). |
| 검증 불가(임베딩 미가용, 503) | `[새로 생성하기]` 자체를 숨기지 않되 클릭 시 블로킹 배너: "예문 검증에 필요한 AI 엔진을 사용할 수 없어 지금은 예문을 늘릴 수 없습니다. 관리자에게 문의해 주세요."(`AUGMENTATION_UNAVAILABLE`, FR-L1-12 — 검증 없는 증강은 하지 않는다는 사실을 그대로 전달, 저하 모드 아님). |
| 진행 중 재요청(같은 의도) | `409 AUGMENTATION_IN_PROGRESS` → "이미 생성 작업이 진행 중입니다"로 전환하고 §4.5의 세션 복원 로직으로 폴링 재개를 시도. |
| 제안 상한 초과(챗봇당 500) | 생성 버튼 클릭 시 인라인 배너: "대기 중인 제안이 너무 많습니다({count}/500). 기존 제안을 검토해 정리한 뒤 다시 시도해 주세요." |
| 예문 상한 근접(400, 생성 전 사전 거부) | "이 의도는 예문이 이미 {count}건입니다. 예문 상한(500) 여유가 부족해 지금은 생성할 수 없습니다." |
| 만료된 제안(stale) | 행 우측에 "만료됨" 배지, 체크박스 `disabled`, `[승인]` 버튼도 비활성 + 툴팁 "생성 후 시간이 지났거나 예문이 바뀌어 다시 확인이 필요합니다. 다시 생성해 주세요."(409 SUGGESTION_EXPIRED 사전 차단). |
| 승인 중 | `[선택 예문으로 추가]` `disabled` + 스피너, 중복 클릭 방지(UIUX §4). |
| 승인 성공(전부) | 선택 항목이 표에서 사라지고 `ExampleChipEditor`에 새 칩으로 즉시 나타남(§2 P-5) + Toast **`MESSAGES.learning.resolveSuccessImmediate`**(새 문자열을 만들지 않는다, FR-L3-6/K-4) + 검증 요약 갱신. |
| 승인 부분 성공 | `AugmentationResultPanel`: "성공 {n}건 / 실패 {m}건" + 실패 사유 표(`{제안 요약 \| 사유}`, 예: "예문 상한 초과") — 토스트로 끝내지 않는다(`stats-learning`의 `BulkResultPanel`과 동일 원칙). |
| 거절(개별) | 확인 없이 즉시 실행(경미한 작업, 되돌릴 순 없지만 재제안도 되지 않는 것이 의도된 동작 — S-10 "무시" 패턴과 동일 톤). 행이 목록에서 사라짐. |
| 거절(다건 선택) | `AugmentationBulkRejectConfirmDialog`(`ConfirmDialog` 재사용): "선택한 {n}건을 거절하시겠습니까? 거절한 제안은 다시 추천되지 않습니다." |
| VIEWER | 체크박스·`[새로 생성하기]`·`[승인]`·`[거절]` 전부 **렌더되지 않음**. 제안 문장·유사도·검증 요약은 조회만 가능(FR-L3-9). |

### 4.4 컴포넌트 분해 및 데이터 바인딩

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `AugmentationPanel` | `intentId`, `chatbotId`, `currentExampleCount`(부모 `IntentEditModal`의 예문 배열 길이) — 접힘 상태 로컬(기본: 제안 有 시 펼침) |
| `AugmentationTriggerBar` | `capability: AugmentationCapabilitySchema`, `sufficientExamples: boolean`(currentExampleCount ≥ 임계), `onGenerate` |
| `AugmentationCapabilityBanner` | `capability.degraded`, `capability.degradeReason` |
| `AsyncJobProgress`(§3 재사용) | `jobId`, 폴링 훅이 `GET /training-jobs/:id` → `TrainingJobSchema`(`status`,`progress`,`resultSummary`) |
| `AugmentationRunSummary` | `runResult: AugmentationRunResultSchema`(`generated,accepted,rejected{reason:count},providerId,degraded`) |
| `ProposalContainer`(§2/§3) | `title="제안(승인 전)"`, `safetyNotice="승인 전까지 대화에 영향을 주지 않습니다"` |
| `AugmentationSuggestionTable` | `items: AugmentationSuggestionSchema[]`, `selected: Set<id>`, `onToggle`, `onToggleAll` — 헤더 체크박스는 **`stale`이 아니고 `conflictIntent`가 없는 행만** 선택(§4.6 규칙) |
| `AugmentationSuggestionRow` | `{ id, text, similarityToSeed, conflictIntent?, providerId, stale }` → `SimilarityBadge`, `ConflictBadge`(조건부), `ProviderBadge`, 개별 `[승인]`/`[거절]` |
| `AugmentationBulkActionBar` | `selectedCount`, `onAccept`, `onReject`, `onClear` |
| `AugmentationAcceptConfirmDialog` | `count` — 본문: "선택한 {count}건이 예문으로 추가되며, 저장 즉시 대화에 반영됩니다."(FR-L3-5) |
| `AugmentationBulkRejectConfirmDialog` | `count` |
| `AugmentationResultPanel` | `succeeded: number`, `failed: {id,code,message}[]` |

### 4.5 세션 내 작업 복원 (FR-L3-11)

`TrainingJob`은 서버에 상태가 있지만, 클라이언트가 `jobId`를 잃어버리면(모달을 닫았다가 재오픈) 폴링 대상을 재획득할 방법이 API 설계상 명시돼 있지 않다(GET은 `jobId` 단건 조회만 제공, §15.1-10). 이 문서는 다음 방식으로 해결한다:

1. `POST .../augmentations`가 `202 { jobId }`를 반환하면 즉시 `sessionStorage`에 `augmentationJob:{intentId} = jobId`를 기록한다.
2. `IntentEditModal`을 다시 열어 패널을 펼칠 때, 이 키가 있으면 **저장된 `jobId`로 폴링을 재개**한다(생성 버튼을 다시 누르지 않아도 진행 상태가 보임).
3. Job이 종료 상태(`SUCCEEDED`/`PARTIAL`/`FAILED`)에 도달하면 해당 키를 제거한다.
4. 다른 브라우저/기기에서 재접속한 경우 등 `sessionStorage`에 값이 없는데 실제로는 작업이 진행 중이면, `[새로 생성하기]` 클릭 시 서버가 `409 AUGMENTATION_IN_PROGRESS`를 반환한다 — 이때 "이미 생성 작업이 진행 중입니다. 잠시 후 목록을 다시 열어 확인해 주세요"로 안내하고, 이 경우에는 진행률 폴링 없이 5초 후 `GET .../augmentations` 재조회로 완료 여부를 확인하는 저비용 폴백을 쓴다.
5. **⚠ backend-implementer 확인 필요**: `409 AUGMENTATION_IN_PROGRESS` 오류 응답의 `details`에 `jobId`가 포함되면 4번의 폴백 없이 즉시 정밀 폴링으로 전환할 수 있다 — 포함 여부를 확정해 달라(포함되지 않아도 위 폴백으로 기능은 성립한다).

### 4.6 전체 선택 규칙 (충돌·만료 행 제외 — J-11)

- 헤더 `전체 선택` 체크박스는 클릭 시 **`stale === false` && `conflictIntent` 없음**인 행만 선택한다.
- 충돌 배지가 있는 행은 **개별로는 체크 가능**하다(FR-L1-15 — 충돌은 차단이 아니라 경고, 관리자 판단 존중). 다만 전체 선택에는 자동 포함되지 않는다.
- 만료(stale) 행은 체크박스 자체가 `disabled`다(승인 자체가 서버에서 거부되므로).
- 일부만 선택된 상태에서 헤더 체크박스는 `indeterminate` 시각 상태를 쓴다.

### 4.7 사용자 인터랙션 흐름

```
IntentEditModal 오픈 → "예문 (1/500)" 옆 [예문 늘리기] 클릭
  → 패널 펼침 → GET .../augmentations?status=PENDING (제안 목록 + 최근 runResult + capability)
  → 제안 0건이면 빈 상태①, 있으면 §4.2 레이아웃 렌더

[새로 생성하기] 클릭
  → POST .../augmentations → 202 { jobId } → sessionStorage 기록 → AsyncJobProgress 폴링 시작
  → 완료(SUCCEEDED/PARTIAL) → GET .../augmentations 재조회 → 표 갱신 + 검증 요약 표시
  → 완료(FAILED) → "생성에 실패했습니다. 잠시 후 다시 시도해 주세요." + [다시 시도]

체크박스 2건 선택 → BulkActionBar "2건 선택됨" 노출
  → [선택 예문으로 추가] → AugmentationAcceptConfirmDialog("2건이 예문으로 추가되며 저장 즉시 반영됩니다")
  → 확인 → POST .../augmentations/accept → 성공
  → 표에서 2건 제거 + ExampleChipEditor에 새 칩 2개 추가(부모 상태 갱신)
  → Toast(MESSAGES.learning.resolveSuccessImmediate)

충돌 배지 있는 제안 → 기본 미선택 상태로 표시 → 관리자가 검토 후 직접 체크 가능 → 승인 시 정상 처리(차단 아님)

임베딩 서비스 중지 상태에서 [새로 생성하기] 클릭
  → 503 AUGMENTATION_UNAVAILABLE → 블로킹 배너, 제안 0건 유지(검증 없는 증강 금지)
```

---

## 5. 화면 B — 학습현황(L1) 확장 (No.23)

### 5.1 정보구조 결정 — 왜 서브내비를 추가하지 않는가

`FR-L3-2`는 "서브내비에 항목을 추가할지(`학습현황`/`분류기`) 기존 화면 안에 접이식 섹션으로 둘지"를 ui-designer 판단으로 남겼다. **결정: 접이식 섹션으로 흡수한다.**

| 근거 |
|---|
| 분류기는 **미응답 추천 의도 품질을 보조하는 도구**이지 독립적인 관리 대상이 아니다(J-6 — "대화 매칭에 쓰지 않는다"). 별도 화면으로 분리하면 "이것도 매번 확인해야 하는 화면"이라는 인상을 주어 오히려 없어도 되는 인지 부하를 만든다. |
| 챗봇 상세는 이미 7탭이며(`stats-learning-ui-spec.md` §1.5), `StatsShell` 서브내비도 이미 2개다. 항목을 늘리면 "얇은 가로 스트립" 레이아웃(§1.3 선례)의 항목 밀도 근거가 무너진다. |
| 분류기 상태를 확인하는 시점은 거의 항상 **미응답 목록을 보는 도중**이다(S-7~S-10) — 같은 화면 안에서 접었다 펼 수 있으면 맥락 전환 비용이 0에 가깝다. |
| 요소분해는 태생적으로 `ResolveModal`(단건 처리 컨텍스트) 안에서만 의미가 있다 — 별도 화면으로 뺄 대상 자체가 아니다. |

### 5.2 레이아웃 (데스크톱, ASCII — `stats-learning-ui-spec.md` §4.3에 이어짐)

```
┌───────────────────────────────────────────────────────────────────────────┐
│ [StatsSubNav]  기본 통계 | 학습현황 (●3)                                    │
├───────────────────────────────────────────────────────────────────────────┤
│ ⚠ 노드 미연결 항목이 있습니다                                       [모두 닫기]│
├───────────────────────────────────────────────────────────────────────────┤
│ ▸ 추천 의도 분류기 · 사용 중(정확도 91%, 3일 전 학습)          [지금 재학습] │  ← 신규, 접이식(기본 접힘)
├───────────────────────────────────────────────────────────────────────────┤
│ 검색 [질문 내용_____]  상태 ☑대기 ☐반영완료 ☐무시됨  ☐반영 후 재발생만      │
│ ...(기존 §4.3 그대로)                                                        │
└───────────────────────────────────────────────────────────────────────────┘
```

펼침:

```
│ ▾ 추천 의도 분류기 · 사용 중(정확도 91%, 3일 전 학습)          [지금 재학습] │
│ ┌────────────────────────────────────────────────────────────────────┐   │
│ │ 상태: ● 사용 중   학습 시점: 2026-09-19 14:02 (3일 전)                │   │
│ │ 학습 데이터: 의도 18개 · 예문 612건    정확도: 91%(검증 표본 120건)   │   │
│ │ 추천은 이 모델의 확률로 제공되며, 대화 응답에는 사용되지 않습니다.     │   │
│ └────────────────────────────────────────────────────────────────────┘   │
```

낡음 상태:

```
│ ▾ 추천 의도 분류기 · 낡음 — 재학습 권장                        [지금 재학습] │
│ ┌────────────────────────────────────────────────────────────────────┐   │
│ │ 상태: ▲ 낡음 — 재학습 권장                                            │   │
│ │ 원인: 학습 이후 예문이 180건 추가되었습니다.                          │   │
│ │ 해결: 재학습을 실행하면 최신 데이터로 갱신됩니다. 지금도 추천은        │   │
│ │       계속 제공됩니다(정확도가 낮아졌을 수 있음).                     │   │
│ └────────────────────────────────────────────────────────────────────┘   │
```

사용 불가(모델 변경):

```
│ ▾ 추천 의도 분류기 · 사용 불가                                 [지금 재학습] │
│ ┌────────────────────────────────────────────────────────────────────┐   │
│ │ 상태: ✕ 사용 불가                                                     │   │
│ │ 원인: 임베딩 모델이 변경되어 이전 모델을 사용할 수 없습니다.           │   │
│ │ 해결: 재색인 후 재학습해 주세요. 추천은 지금 문자 유사도 방식으로      │   │
│ │       대체 제공되고 있습니다.                                         │   │
│ └────────────────────────────────────────────────────────────────────┘   │
```

학습 중:

```
│ ▾ 추천 의도 분류기 · 학습 중...                                            │
│ ┌────────────────────────────────────────────────────────────────────┐   │
│ │ ⏳ 학습 중입니다. 완료되면 추천 품질이 갱신됩니다.  [aria-live 안내]   │   │
│ └────────────────────────────────────────────────────────────────────┘   │
```

`ResolveModal`의 요소 분해 섹션:

```
┌ 미응답 질문 반영 — "해외로 반품 보낼 수 있나요" ────────────────── ✕ ┐
│ 반영할 의도  [배송문의_____________________▾]                       │
│ ✔ 기존 의도 '배송문의'에 추가됩니다                                  │
│ 예문        [해외로 반품 보낼 수 있나요___________] 15/200자         │
├────────────────────────────────────────────────────────────────────┤
│ ▾ 요소 분해(선택)                              분석: 기본 분해        │
│  [해외]      [반품]      [보낼 수 있나요]      [로]                  │
│  후보·국가   후보        의도신호              무시                  │
│  (동의어)    [키워드로 등록]                                          │
│                                              [경계 편집 시작]         │
│ ┌ 등록 대기열(승인 전) ──────────────────────────────────────────┐   │
│ │ ℹ 아래 항목은 "반영" 버튼을 눌러야 실제로 등록됩니다               │   │
│ │ "반품" → 새 키워드로 등록 예정                              [×]  │   │
│ └──────────────────────────────────────────────────────────────┘   │
├────────────────────────────────────────────────────────────────────┤
│ 저장 즉시 반영됩니다.                                                │
│                                              [취소]   [반영]         │
└────────────────────────────────────────────────────────────────────┘
```

### 5.3 분류기 상태 패널 — 상태별 UI (5상태, FR-L3-8)

| 배지 | 파생 조건(`IntentClassifierStatusSchema`) | 색 | 원인 문구 | 해결 문구 |
|---|---|---|---|---|
| 학습 안 됨 | `state==='NONE'` | 중립 회색 | "아직 재학습을 실행하지 않았습니다." | "지금 재학습 버튼을 눌러 시작하세요." (최소 데이터 미달 시 `[지금 재학습]` 클릭하면 422 인라인으로 조건 안내 — 아래) |
| 학습 중 | `state==='TRAINING'` | 안내 파랑 | — | `aria-live="polite"` "학습 중입니다..." |
| 사용 중 | `state==='READY' && !stale` | 성공 초록 | — | 정확도·표본 수·학습 시점 표시. `accuracy===null`이면 "측정 안 됨(표본 50건 미만)" |
| 낡음 — 재학습 권장 | `state==='READY' && stale && !staleReasons.includes('MODEL_CHANGED')` | 주의 노랑 | `staleReasons`별: `INTENTS_DRIFTED`→"의도 구성이 학습 시점 대비 10% 이상 바뀌었습니다." / `EXAMPLES_DRIFTED`→"학습 이후 예문이 {n}건 추가되었습니다." | "재학습을 실행하면 최신 데이터로 갱신됩니다. 지금도 추천은 계속 제공됩니다." |
| 사용 불가 | `staleReasons.includes('MODEL_CHANGED')` **또는** `state==='FAILED'` | 위험 빨강 | `MODEL_CHANGED`→"임베딩 모델이 변경되어 이전 모델을 사용할 수 없습니다." / `FAILED`→"직전 학습이 실패했습니다." | `MODEL_CHANGED`→"재색인 후 재학습해 주세요." / `FAILED`→"다시 시도해 주세요. 계속 실패하면 관리자에게 문의하세요." — 두 경우 모두 "추천은 지금 문자 유사도 방식으로 대체 제공되고 있습니다"를 병기(기능 정지 아님을 알림) |

**재학습 클릭 시 422(`CLASSIFIER_INSUFFICIENT_DATA`)**: 패널 안에 인라인 배너 "학습에 필요한 최소 데이터가 부족합니다(의도 2개 이상 · 의도당 예문 3건 이상 · 총 20건 이상). 추천은 문자 유사도 방식으로 계속 제공됩니다." — 오류 토스트가 아니라 패널 내 지속 정보(닫을 때까지 유지, 데이터가 갖춰지면 다음 방문 시 자연히 사라짐).

**재학습 진행 표시**: `AsyncJobProgress` 재사용, 폴링 500ms 최초 지연 · 1.5초 간격 · 최대 5분(§15.2). `sessionStorage` 키 `classifierJob:{chatbotId}`로 §4.5와 동일한 세션 복원을 적용한다.

**감사 없음 고지**: 이 패널의 어떤 동작도 이력관리(No.13)에 남지 않는다(FR-L2-25) — 필요하면 툴팁 "이 작업은 이력에 기록되지 않습니다"를 `[지금 재학습]` 근처에 보조로 둔다(선택, 필수 아님).

### 5.4 요소 분해 섹션 — 상태별 UI

| 상태 | UI |
|---|---|
| 섹션 접힘(기본) | "▸ 요소 분해(선택)" — 펼치지 않아도 `[반영]`은 기존 No.15 방식(단순 예문 반영)으로 동작(무회귀, FR-L2-13). |
| 섹션 펼침 · 로딩 | `GET .../decomposition` 호출 중 `SkeletonRow`. |
| 섹션 펼침 · 성공 | 칩 렌더. `analyzerId`에 따라 "분석: 기본 분해(사전 기반)" 또는 "분석: 정밀 분석 사용 중" 표시(§6.1 DD, 조용한 품질 차이 금지). |
| **빈 상태** — 전부 `IGNORED` | "반영할 요소가 없습니다 — 무시 처리를 권합니다." + `[무시로 이동]`(모달 하단 `[무시]` 버튼으로 포커스 이동, EX-L2-2). |
| 칩 역할 순환 | 포커스된 칩에서 Enter/Space → `ENTITY_CANDIDATE → INTENT_SIGNAL → IGNORED → ENTITY_CANDIDATE` 순환, `aria-live`로 "{텍스트} 역할이 {새 역할}로 변경되었습니다" 안내. |
| 경계 편집 모드 | `[경계 편집 시작]` 토글(`aria-pressed`) → 칩 사이·내부에 분할 지점 마커가 나타남(방향키로 이동, Enter로 분할) + 인접 칩 사이에 `[병합]` 버튼(Enter로 병합) → `[경계 편집 종료]`(또는 Esc)로 빠져나옴. |
| 엔티티 등록 대기열 담기 | `ENTITY_CANDIDATE` 칩의 `[키워드로 등록]` 클릭 → 인라인 선택지: "기존 키워드에 동의어로 추가"(콤보박스, `matchedKeyword` 있으면 사전 선택) / "새 키워드로 만들기"(이름 입력, 기본값 = 칩 텍스트) → 확정 시 `EntityActionQueue`(§2 제안 컨테이너)에 항목 추가. |
| 대기열 10건 초과 시도 | "최대 10건까지 한 번에 등록할 수 있습니다." 인라인 경고, 11번째 담기 버튼은 비활성화. |
| 스팬 재검증 실패(제출 시) | `400` → 모달 유지, "스팬 경계가 올바르지 않습니다. 다시 시도해 주세요."(경계 편집을 초기화하지 않고 인라인 오류만 표시 — AC-L2-4, 아무것도 변경되지 않음) |
| 제출 성공 | `linkedNodeCount` + `keywordLinkedNodeCount` 응답 → §5.5로. |

### 5.5 노드/키워드 미연결 경고 — 배너 일반화

기존 `NodeUnlinkedWarningBanner`(`stats-learning-ui-spec.md` §4.7)를 `LearningLinkWarningBanner`로 일반화해 **의도 미연결**과 **키워드 미연결** 두 종류를 함께 담는다(같은 배너, 항목 타입만 다름 — FR-L2-12가 "키워드 미파악" 분기를 닫는 지점).

| 필드 | 문구 |
|---|---|
| `INTENT_UNLINKED`(기존과 동일) | "'{questionText}' → 의도 '{intentName}'에 반영했지만, 이 의도를 사용하는 대화 노드가 없어 여전히 답변되지 않습니다. [노드 만들기 →]" |
| `KEYWORD_UNLINKED`(신규) | "'{questionText}' → 키워드 '{keywordName}'을(를) 등록했지만, 이 키워드를 조건으로 쓰는 대화 노드가 없어 여전히 매칭에 영향이 없습니다. [노드 조건 편집 →]" |

두 항목이 같은 반영 건에서 동시에 발생하면 배너에 **2줄로 각각** 추가한다(하나로 뭉치지 않음 — 원인이 다르므로 해결 링크도 다르다). 토스트가 아니라 지속 표시, 세션 스코프(새로고침 시 사라짐)라는 기존 한계(§9 API 갭)도 동일하게 적용된다.

### 5.6 추천 의도 후보 — 출처 배지 (No.23-B 유일한 소비자)

기존 `SuggestionList`(펼침 영역, `stats-learning-ui-spec.md` §4.4)의 각 후보 항목에 `SuggestionSourceBadge`를 추가한다.

```
추천 의도 후보
배송문의 87% [분류기 추천]  (예문: "배송 얼마나 걸리나요")     [이 의도로 반영]
주문조회  6% [분류기 추천]  (예문: "주문 상태 확인하고 싶어요") [이 의도로 반영]
```

분류기가 `READY`가 아니거나 `stale`(`MODEL_CHANGED`)이면 자동으로 기존 bigram 결과로 대체되고 배지는 `[문자 유사도]`로 바뀐다 — **화면은 아무 조작 없이도 항상 최선의 가용 추천을 보여주며, 왜 그 값이 나왔는지를 배지로 설명한다**(둘을 섞지 않는다 — FR-L2-27).

### 5.7 컴포넌트 분해 및 데이터 바인딩

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `ClassifierStatusPanel` | `chatbotId`, `status: IntentClassifierStatusSchema` — 접힘 로컬 상태(기본 접힘) |
| `ClassifierStatusBadge`(§3) | `state`, `stale`, `staleReasons` |
| `ClassifierStaleReasonList` | `staleReasons: string[]` → §5.3 문구 매핑 |
| `ClassifierTrainButton` | `disabled`(TRAINING 중 또는 `dialogue:write` 없음), `onTrain` |
| `DecompositionSection` | `unansweredQuestionId`, `questionText` — 접힘 로컬 상태(기본 접힘) |
| `DecompositionChipRow` | `spans: DecompositionSpanSchema[]`, `onRoleCycle`, `onBoundaryEdit` |
| `DecompositionChip` | `{ start, end, text, role, matchedKeyword? }` |
| `BoundaryEditToggle` | `active: boolean`, `onToggle` |
| `SplitMergeControls` | 경계 편집 모드에서만 렌더, 키보드 전용(드래그앤드롭 없음 — `dialogue-design-ui-spec.md`의 기존 원칙과 동일, §8) |
| `EntityActionPicker` | `span: DecompositionSpanSchema`, `keywordOptions`(사전 로드), `onQueue` |
| `ProposalContainer`(§2) 재사용 | `title="등록 대기열(승인 전)"` |
| `EntityActionQueue` | `actions: { action:'ADD_SYNONYM'|'CREATE'; keywordId?; name?; synonym }[]`, `onRemove` — 최대 10건 |
| `SuggestionSourceBadge`(§3) | 기존 `SuggestionList` 항목에 추가 |
| `LearningLinkWarningBanner`(기존 `NodeUnlinkedWarningBanner` 일반화) | `entries: { type:'INTENT_UNLINKED'|'KEYWORD_UNLINKED'; questionText; targetName; targetId }[]` |

### 5.8 사용자 인터랙션 흐름

```
L1 진입 → ClassifierStatusPanel 접힘 상태(요약 1줄: "사용 중(정확도 91%, 3일 전 학습)")
  → [▸] 클릭 → 펼침 → GET .../intent-classifier/status
  → [지금 재학습] → POST .../intent-classifier/train → 202 { jobId }
  → sessionStorage 기록 → AsyncJobProgress 폴링(1.5초 간격)
  → 완료 → GET .../intent-classifier/status 재조회 → 배지 갱신(예: 낡음→사용 중)

미응답 행 펼침 → [반영] 클릭 → ResolveModal 오픈(의도 필드 비어 있음)
  → "▸ 요소 분해(선택)" 펼침 → GET .../decomposition
  → 칩 4개 표시: [해외](후보·매칭 국가) [반품](후보) [보낼 수 있나요](의도신호) [로](무시)
  → [반품] 칩의 [키워드로 등록] → "새 키워드로 만들기" 선택 → EntityActionQueue에 추가
  → 의도 필드에 "배송문의" 입력 → "기존 의도 '배송문의'에 추가됩니다" 확인
  → [반영] 클릭 → (엔티티 대기열이 비어있지 않으므로) POST .../resolve-decomposed 호출
  → 성공 { linkedNodeCount: 2, keywordLinkedNodeCount: 0 }
  → 모달 닫힘 → Toast(MESSAGES.learning.resolveSuccessImmediate)
  → LearningLinkWarningBanner에 KEYWORD_UNLINKED 항목 추가
     ("키워드 '반품'을 등록했지만 이 키워드를 조건으로 쓰는 노드가 없습니다. [노드 조건 편집 →]")

요소 분해를 펼치지 않고 의도만 채워 [반영] 클릭
  → 엔티티 대기열이 비어 있으므로 기존 POST .../resolve 그대로 호출(무회귀, FR-L2-13)

분류기가 MODEL_CHANGED로 사용 불가인 상태에서 미응답 행 펼침
  → 추천 의도 후보에 [문자 유사도] 배지만 표시(자동 폴백, 오류 없음)
```

---

## 6. 권한별 UI 변화 규칙

원칙은 `stats-learning-ui-spec.md` §5.1과 동일: **쓰기 액션은 권한이 없으면 렌더 자체를 하지 않는다**(숨김, 비활성 아님). 서버가 최종 판정자다.

| 화면 | 요소 | VIEWER | EDITOR | ADMIN |
|---|---|---|---|---|
| A1 예문 증강 패널 | 제안 목록·검증 요약 조회 | 표시(`dialogue:read`) | 표시 | 표시 |
| A1 | `[새로 생성하기]`, 체크박스, `[승인]`/`[거절]`, 일괄 액션 | **숨김** | 표시 | 표시 |
| B1 분류기 상태 패널 | 상태·정확도·사유 조회 | 표시(`dialogue:read`) | 표시 | 표시 |
| B1 | `[지금 재학습]` | **숨김** | 표시 | 표시 |
| B2 요소 분해 섹션 | 칩·역할·매칭 키워드 조회 | 표시(`dialogue:read`) | 표시 | 표시 |
| B2 | 역할 순환, 경계 편집, `[키워드로 등록]`, 대기열 담기 | **숨김**(칩은 읽기 전용으로만 렌더 — 클릭해도 순환하지 않음) | 표시 | 표시 |
| B3 추천 출처 배지 | 조회 | 표시 | 표시 | 표시 |

---

## 7. "반영 완료" 문구 정합성 (K-4 재확인)

이 그룹의 어떤 신규 화면도 **"학습 대기열에 추가되었습니다" 류의 표현을 쓰지 않는다.** 아래 세 가지 서로 다른 비동기 상태를 문구로 명확히 구분한다(과제 지시사항의 핵심 요구):

| 상황 | 문구 | 상수 |
|---|---|---|
| 증강 **생성**(202, 아직 제안 단계) | "생성 중입니다(검증 포함, 최대 약 30초 소요될 수 있습니다)" | `MESSAGES.augmentation.generating` |
| 증강 **생성 완료** | "생성이 완료되었습니다. 제안 {n}건을 확인해 주세요." (`aria-live`) | `MESSAGES.augmentation.generateDone` |
| 증강 제안 **승인**(자산 반영, 항상 동기·즉시) | 기존 `MESSAGES.learning.resolveSuccessImmediate`를 **그대로 재사용**(신규 문자열 없음) | `MESSAGES.learning.resolveSuccessImmediate` |
| 분류기 **재학습**(202, 추천 품질 도구 — 대화 반영과 무관) | "학습 중입니다..." / "학습이 완료되었습니다." — **"반영"·"적용"이라는 단어를 쓰지 않는다**(K-6 취지: 대화 반영 트리거로 오인시키지 않는다) | `MESSAGES.classifier.training` / `MESSAGES.classifier.trained` |
| 요소분해 통합 반영(`resolve-decomposed`) | 기존 `MESSAGES.learning.resolveSuccessImmediate` 재사용(No.15와 동일 톤 — 예문+엔티티 모두 즉시 반영이므로) | `MESSAGES.learning.resolveSuccessImmediate` |

**코드리뷰 포인트로 재기재**: 어떤 컴포넌트도 `"반영 완료"`, `"학습 대기열"`을 리터럴 문자열로 쓰지 않는다. `AugmentationAcceptConfirmDialog`/`AugmentationResultPanel`도 `appliedImmediately` 응답값을 분기해 문구를 정하며, 하드코딩된 `true` 전제가 아니다(K-4, ADR-0018 §2와 동일 규약을 증강 승인 경로에도 그대로 적용).

---

## 8. `UIUX_준수기준.md` 체크리스트 매핑

### 8.1 공통(전 신규 조각)

| 기준 | 항목 | 적용 |
|---|---|---|
| §1 색상대비 | 4.5:1/3:1, 색상 단독 금지 | `ClassifierStatusBadge`/`SuggestionSourceBadge`/`ConflictBadge`/`ProviderBadge` 전부 색+아이콘+텍스트 3중 구분. §2의 "제안-자산 분리" 컨테이너 배경색도 헤더 텍스트 라벨("제안(승인 전)")과 함께 병기(색상 단독 아님) |
| §3 키보드접근성 | Tab/Shift+Tab, Enter/Space, Esc+포커스복귀 | `DecompositionChip` 역할 순환(Enter/Space) · `BoundaryEditToggle`+`SplitMergeControls`(방향키+Enter, 드래그앤드롭 없음) · `AugmentationSuggestionTable` 행 체크박스 Tab 순회 · 모든 신규 확인 다이얼로그는 `ConfirmDialog` 재사용(포커스 트랩 내장) |
| §4 버튼 | 동사형 레이블, 중복 실행 방지, 터치 44×44px | "예문 늘리기"/"새로 생성하기"/"승인"/"거절"/"지금 재학습"/"키워드로 등록"/"경계 편집 시작", 제출 중 `disabled`(중복 클릭 방지) |
| §5 텍스트 입력 | 레이블 필수, placeholder 대체 금지 | `EntityActionPicker`의 신규 키워드 이름 입력 `<label>` 필수, 글자 수 실시간(예문 재사용 규약과 동일) |
| §6 폼 컨트롤 | 단일선택=라디오/셀렉트, 다중선택=체크박스 | 제안 표 체크박스(다중), 엔티티 액션 선택(콤보박스 단일), 값 변경만으로 자동 제출 없음(승인은 별도 버튼 클릭 필요) |
| §7 오류 메시지 | 원인+해결방법, 제출 시점 | `AUGMENTATION_UNAVAILABLE`/`CLASSIFIER_INSUFFICIENT_DATA`/분류기 5상태 전부 "원인+해결" 패턴(§4.3, §5.3) |
| §8 로딩/상태 | 스켈레톤/스피너 + `aria-live`, 완료 시 건수, 상한 대기시간 | `AsyncJobProgress`(진행 표시+`aria-live` 동시, 최대 대기시간 후 정리 문구 — UIUX §8 비동기 대기 패턴과 동일 규약) |
| §9 내비게이션 | href 기반, 페이지네이션 이중표시 | 신규 내비게이션 없음(기존 화면 확장) |

### 8.2 화면별 특기 사항

| 화면 | UIUX 항목 | 적용 |
|---|---|---|
| A1 제안 표 | §1(색상 단독 금지) + NFR-LA3 | `SimilarityBadge`(수치+라벨), `ConflictBadge`(경고 아이콘+텍스트) |
| A1 진행 표시 | §8(비동기 대기 패턴) | `AsyncJobProgress` — 시각적 진행 + `aria-live` + 상한(60초) 초과 시 정리 문구, 다른 입력(모달 닫기 등)은 차단하지 않음 |
| B1 분류기 배지 | §7(원인+해결) | 5상태 전부 원인·해결 문구 병기(§5.3 표) |
| B2 요소분해 칩 | §3(키보드 완전 조작) — **이 그룹에서 가장 엄격한 접근성 요구**(NFR-LA2) | 역할 순환·경계 편집 전부 키보드로 완주 가능, 포커스 순서=시각 순서 |
| B2 등록 대기열 | §2 신규 패턴(제안-자산 분리) | `EntityActionQueue`가 `ProposalContainer` 셸 사용 |
| B3 출처 배지 | §1 | `SuggestionSourceBadge` |

### 8.3 자동화 연계

`test-automation` 검증 대상(§21.5 인계와 연결): 제안 표 키보드 전체 조작(체크→승인 완주) · 요소분해 칩 키보드 역할순환+경계편집 완주 · axe 대비 위반 0건 · `aria-live` 발화 확인(진행 시작/완료) · 충돌 배지 행이 "전체 선택"에서 실제로 제외되는지의 UI 단위 테스트.

---

## 9. 반응형 레이아웃 원칙

기준은 `stats-learning-ui-spec.md` §10과 동일한 브레이크포인트(데스크톱 ≥1024px / 태블릿 640–1023px / 모바일 <640px)를 따른다. `apps/widget`은 영향받지 않는다.

| 브레이크포인트 | A1 예문 증강 패널 | B1 분류기 상태 패널 | B2 요소 분해 섹션 |
|---|---|---|---|
| 데스크톱 | 표 형태 그대로(체크박스/문장/유사도/충돌/생성기/액션 6열) | 1줄 요약 + 펼침 시 2열 정보(상태/원인·해결) | 칩 가로 나열(줄바꿈 허용), 경계 편집 마커 인라인 |
| 태블릿 | 유사도·생성기 열을 행 안 보조 텍스트로 접어 4열로 축소(체크박스/문장+보조정보/충돌/액션) | 동일(펼침 시 세로 스택) | 동일(칩 줄바꿈 밀도만 증가) |
| 모바일 | 표 대신 카드 리스트(`AugmentationSuggestionCard`) — 문장/유사도/충돌/생성기를 라벨+값 스택, 체크박스와 액션 버튼은 카드 하단 44×44px 확보. 일괄 액션 바는 화면 하단 고정(엄지 도달 영역, `stats-learning` `BulkActionBar` 모바일 규칙과 동일) | 접힘 요약 1줄 유지, 펼침 내용은 전체 폭 세로 스택 | 칩은 여전히 가로 나열이되 줄바꿈 활발(칩 자체는 축소하지 않음 — 최소 44×44 터치 영역 유지), 경계 편집 모드에서 분할 마커 간격을 넉넉히 확보(오터치 방지) |

공통: `IntentEditModal`/`ResolveModal`은 모바일에서 전체화면 모달로 전환(기존 규칙 유지, `stats-learning-ui-spec.md` §10). `ProposalContainer`(제안 컨테이너)의 옅은 배경·점선 테두리는 모바일에서도 유지한다(공간이 좁아도 "제안 vs 자산" 구분은 타협하지 않는다 — §2 패턴의 핵심 목적이 좁은 화면일수록 더 중요하다).

---

## 10. 기존 화면/문서 변경 요청 (인계)

| 대상 | 변경 | 근거 |
|---|---|---|
| `apps/web/src/pages/dialogue/IntentEditModal.tsx`(가칭) | `ExampleChipEditor`와 `LinkedNodesReadonlyList` 사이에 `AugmentationPanel` 삽입 | §4 |
| `apps/web/src/pages/chatbot-detail/stats/LearningQueuePage.tsx`(가칭) | `PendingLimitBanner`와 필터바 사이에 `ClassifierStatusPanel` 삽입 | §5.2 |
| `ResolveModal` | `ExampleTextArea`와 고정 안내 문구 사이에 `DecompositionSection` 삽입, 제출 로직에 "대기열 비어있음 → 기존 `resolve` / 비어있지 않음 → `resolve-decomposed`" 분기 추가 | §5.4, FR-L2-13 |
| `NodeUnlinkedWarningBanner` | `LearningLinkWarningBanner`로 일반화(타입 `INTENT_UNLINKED`\|`KEYWORD_UNLINKED`) — 기존 props는 `type: 'INTENT_UNLINKED'`로 마이그레이션(하위호환) | §5.5, FR-L2-12 |
| `SuggestionList` | 항목에 `SuggestionSourceBadge` 추가 | §5.6, FR-L2-28 |
| `apps/web/src/constants/messages.ts` | `MESSAGES.augmentation.*`, `MESSAGES.classifier.*` 신설. `MESSAGES.learning.resolveSuccessImmediate`는 **재사용**(신규 키 추가 없음) | §7, FR-C-13 상속 |
| **`docs/03-design/UIUX_준수기준.md`** | §1(색상/명도 대비)에 **"제안-자산의 시각적 분리"** 패턴 1건 추가(이 문서 §2를 원문 근거로 명시) + 하단 "참고" 목록에 출처 각주 추가 | ADR-0025 §5, 설계서 §21.7 요청사항 — **이 문서와 별도로 실제 파일을 갱신함**(§10.1) |

### 10.1 `UIUX_준수기준.md` 갱신 내용 (실제 반영 완료)

system-architect의 인계사항(설계서 §21.7: `docs/03-design/UIUX_준수기준.md` | **"제안과 자산의 시각적 분리" 패턴 추가**)에 따라, 이 문서 작성과 함께 `UIUX_준수기준.md` §1에 아래 항목을 추가했다(실제 파일 diff는 이 설계 산출물과 별도로 적용됨):

> - **제안-자산의 시각적 분리**: 관리자 승인을 거쳐야 확정되는 항목(제안·초안·대기 상태)과 이미 확정된 자산(운영 데이터)은 같은 목록에 상태 컬럼만 다르게 표시하지 않고 **서로 다른 컨테이너**(배경색·테두리 스타일 차등)로 분리해 렌더한다. 제안 컨테이너에는 "승인 전까지 반영되지 않습니다" 류의 안내를 상시 노출하고, 자산으로의 승격은 제안 컨테이너 안의 **단일 진입점 버튼**을 통해서만 이뤄지게 한다(자산 쪽에서 제안을 끌어오는 대응 버튼을 두지 않음 — 흐름의 방향성을 구조로 강제). → (b) 예문 증강 제안 목록·미응답 요소분해 엔티티 등록 대기열(`learning-augmentation-ui-spec.md` §2).

> 참고 각주 추가: `- 제안-자산 시각적 분리 패턴(2026-09-22 추가): docs/requirements/learning-augmentation.md J-11, docs/02-spec/decisions/ADR-0025-augmentation-output-and-suggestion-asset-separation.md §5`

---

## 11. `frontend-implementer` 인계 메모

1. **구현 순서 권고**: ① `MESSAGES.augmentation.*`/`MESSAGES.classifier.*` 상수 + `ProposalContainer`(§2/§3 공통 셸) — 이후 모든 조각이 이 위에서 만들어짐 → ② A1 예문 증강 패널(제안 조회·표만, 생성 트리거 제외) → ③ 생성 트리거 + `AsyncJobProgress` + 세션 복원(§4.5) → ④ 승인/거절(단건→일괄) → ⑤ B1 분류기 상태 패널(조회만) → ⑥ 재학습 트리거 → ⑦ B2 요소분해 섹션(조회+역할순환) → ⑧ 경계 편집 → ⑨ 엔티티 등록 대기열 + `resolve-decomposed` 분기 → ⑩ `LearningLinkWarningBanner` 일반화 → ⑪ B3 출처 배지.
2. **의존 스키마**(`packages/shared-types/src/learning.ts` append분, 설계서 §8): `AugmentationSuggestionSchema`/`AugmentationRunResultSchema`/`AugmentationRejectReasonSchema`/`AugmentationCapabilitySchema`/`AugmentationAcceptRequest·ResponseSchema`/`DecompositionSpanSchema`/`DecompositionResponseSchema`/`DecomposedResolveRequestSchema`/`IntentClassifierStatusSchema`/`TrainingJobSchema`/`IntentSuggestionSchema.source`.
3. **미결정/후속 확인 필요**:
   - §4.5-5: `409 AUGMENTATION_IN_PROGRESS` 응답에 `jobId`가 포함되는지 `backend-implementer`에게 확인. 포함되지 않아도 폴백(5초 후 목록 재조회)으로 기능은 성립한다.
   - `CLASSIFIER_ENABLED=false`(전역 비활성) 상태에서 `GET .../intent-classifier/status`가 어떤 `state`를 반환하는지(=`NONE`과 구분되는지) 확인 필요 — 구분되지 않으면 "학습 안 됨" 배지로 통합 표시하고 별도 "기능 비활성" 문구는 생략한다(설계서에 명시 없음, 안전한 기본값으로 처리).
   - `AugmentationAcceptRequest`가 `suggestionIds` 배열만 받으므로, 프런트는 §4.6 규칙(충돌/만료 제외)을 **클라이언트에서 미리 걸러 보낸다** — 서버도 동일 검증을 하지만(stale 재검증, DD-112) 이중 방어다.
   - `EntityActionQueue`의 대기열은 모달을 닫으면 초기화된다(서버 저장이 아니므로) — 관리자가 실수로 모달을 닫으면 등록 예정 항목이 사라진다는 점을 닫기 확인(`beforeunload`/`UnsavedGuardContext`류) 적용 여부는 `frontend-implementer` 재량이나, 대기열이 1건 이상 있을 때 모달 닫기 시 가벼운 확인("등록 대기 중인 항목이 사라집니다. 닫으시겠습니까?")을 권고한다.
4. **코드리뷰 포인트 재기재**(설계서 §21.6과 연결): `"반영 완료"`/`"학습 대기열"` 리터럴 0건, 충돌·만료 행이 전체 선택에서 실제로 제외되는지, VIEWER에게 쓰기 액션이 렌더 자체가 안 되는지, `resolve`/`resolve-decomposed` 분기가 대기열 유무로 정확히 갈리는지.
