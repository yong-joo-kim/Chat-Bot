# 검증/품질 고도화 (No.19 대화검증시스템·TC테스트 / No.20 학습영향도 TEST) — 화면 설계서

> **대상 기능**: No.19 대화검증시스템 & TC테스트, No.20 학습영향도 TEST — 전부 관리자 콘솔(`apps/web`) 기능이며 `apps/widget`은 건드리지 않는다.
> **입력 문서**: `docs/requirements/validation-regression.md`(J-1~J-12, FR-V1/V2/V3-\*, AC-V1~V4, S-1~S-14, EX-V-\*), `docs/02-spec/validation-regression-설계.md`(§2~§13, API 18개, Prisma 4테이블), `docs/02-spec/decisions/ADR-0029`(TestRun=버전 축, 판정 4값, 큐 상태 싱크 분리), `ADR-0030`(임베딩 캐시 우회·RAG 상한·로그 봉인), `docs/02-spec/개발명세서.md` §4(신규 API)·§6(결정 31)
> **준수 기준**: `docs/03-design/UIUX_준수기준.md`(전 항목, 특히 §1 제안-자산 분리·색상단독금지, §4 버튼, §6 폼컨트롤, §8 비동기 대기·로딩, §9 내비게이션)
> **재사용 대상**: `quality-channel-ui-spec.md`(SIM1/SIM2 — `SimulatorPanel`/`CompareView`/`TracePanel`/`OutputRenderer`, A/B 좁은화면 세로스택 규칙), `dialogue-design-ui-spec.md`(§4.4 `BulkImportModal` 3단계 대량 업로드 패턴, `ImportValidationReportTable`/`ImportRowErrorBadge`), `stats-learning-ui-spec.md`(`StatsShell` — "탭 1개 + 서브내비 N개" 패턴), `learning-augmentation-ui-spec.md`(§2 제안-자산 분리 컨테이너 패턴, §4 `AugmentationPanel`/`AugmentationBulkActionBar`, §3 `AsyncJobProgress`)
> **작성**: ui-designer · 2026-09-23 · **다음 단계**: `backend-implementer`(설계서 §2~§12 구현 후) → `frontend-implementer`
> **범위 경계**: React 컴포넌트 실제 코드는 작성하지 않는다. `apps/widget`은 이 그룹과 무관하다(전부 관리자 콘솔).

---

## 0. 전제와 연계 확인

1. **API·데이터 스키마는 설계서 기준으로 아직 구현되지 않은 확정 계약이다.** `TestCaseSetSchema`/`TestCaseSchema`/`TestRunSchema`/`TestRunResultSchema`/`StartTestRunRequestSchema`/`TestRunComparisonSchema`(`packages/shared-types/src/validation.ts`, 설계서 §3) 및 `Permission`의 `simulation:write`(ADR-0029 §5)는 **아직 코드에 없다**(`packages/shared-types/src/security.ts` 확인 결과 14종). `backend-implementer`가 설계서대로 구현한 뒤 본 문서 기준으로 화면을 만든다(선행 6개 그룹과 동일한 전제).
2. **기존 8개 라우트는 하나도 바꾸지 않는다.** 현재 `apps/web/src/pages/chatbot-detail/TabNav.tsx`(실제 코드 확인)는 `{dashboard, stats, settings, dialogue, answer-settings, simulator, skin, channels}` 8개 라우트를 4개 그룹(운영3·설계1·검증2·배포2)으로 렌더한다. 이 문서는 **신규 라우트 5개**(`validation/*`)만 추가한다.
3. **P-3(미응답 큐 → TC 승격 경로)은 이번 화면에 없다.** `system-architect` 설계서의 API 18개 목록에 이 경로가 없고(§13 인계에도 언급 없음), §1 "PM 확정 사항" 표에도 P-3 확정이 기록돼 있지 않다 — **미착수 항목으로 확정되지 않았으므로 화면 진입점을 만들지 않는다.** TC 등록 경로는 **(A) 엑셀/CSV 업로드**와 **(C) 화면에서 1건씩 추가** 둘뿐이다. 재검토 트리거: P-3이 별도로 확정되는 시점.
4. **`overlaySource: 'INLINE'`용 화면 진입점은 이번 1차 범위에 두지 않는다.** API는 `INLINE`(No.10과 동일 `DialogueOverlay` DTO)을 지원하지만, 이 그룹의 화면 요구사항(FR-V3-1~13)이 명시하는 진입 동선은 ①직접 실행(오버레이 없음, `SINGLE`) ②증강 승인 화면에서의 `AUGMENTATION_SUGGESTIONS` 뿐이다. 관리자가 직접 임의의 텍스트 오버레이를 입력해 대량 TC와 비교하는 시나리오는 아직 사용 데이터가 없어 화면 복잡도만 늘린다 — API는 열려 있으므로 **필요성이 확인되면 후속 화면으로 추가**한다(§9 재검토 트리거로 명시).
5. **판정 4값(`PASS`/`FAIL`/`NOT_JUDGED`/`UNRESOLVED`)의 시각 언어를 이 문서 전체에서 고정한다**(§3.3) — 화면마다 다른 배지를 만들지 않는다.
6. **A/B 비교 레이아웃은 새 규칙을 만들지 않는다.** `quality-channel-ui-spec.md` §4.3(SIM2 `CompareView`)의 "데스크톱 2단 / 좁은 화면 세로 스택, 읽기 순서 A→B" 규칙을 M2(오버레이 비교)와 M1(실행 간 비교)에 **그대로** 적용한다(FR-V3-12, FR-10-28).
7. **대량 업로드는 새 마법사를 만들지 않는다.** `dialogue-design-ui-spec.md` §4.4의 `BulkImportModal`(파일선택 → 검증결과 → 완료, 3단계) 컴포넌트에 `resourceType: 'TEST_CASE'`를 추가하는 **네 번째 소비자**로 재사용한다(ADR-0007 §2, FR-V1-9).
8. **진행 표시는 `learning-augmentation-ui-spec.md` §3의 `AsyncJobProgress` 패턴을 재사용**하되, 이 그룹은 `TrainingJob`이 아니라 `TestRun` 자신을 폴링 대상으로 한다(ADR-0029 §4 — 상태 소유자가 다르다). 폴링 엔드포인트는 `GET .../test-runs/:runId`.
9. **신규 화면의 모든 한국어 문구는 `apps/web/src/constants/messages.ts`에 `MESSAGES.validation.*` 네임스페이스로 상수화**한다(FR-0-23). 탭 라벨은 기존 관례대로 `MESSAGES.detail.tabValidation`/`tabGroupVerify`(기존 키 재사용)에 둔다.
10. **데이터 바인딩 기준 스키마**는 설계서 §3(`TestCaseSetSchema` 등)·§4(Prisma 모델, API 응답이 이를 매핑)·§9(API 계약 18개)다.

---

## 1. 정보구조 판단 (P-7) — 신규 최상위 탭 1개 + 내부 서브내비 2개

### 1.1 현재 상태 확인 (코드 근거)

`apps/web/src/pages/chatbot-detail/TabNav.tsx`(실제 코드)는 이미 **8개 라우트, 4개 시각적 그룹**이다:

| 그룹 | 포함 탭(현재) |
|---|---|
| 운영 | 대시보드 · 통계(`StatsShell`) · 기본설정 |
| 설계 | 대화설계(`DialogueShell`) |
| 검증 | AI 답변 설정 · 응답 테스트 |
| 배포 | 스킨/임베드 · 채널 |

`nlu-rag-answering-ui-spec.md` §2.2가 8번째 탭을 추가하며 남긴 **재검토 트리거**: "8개는 이번 Phase의 상한으로 간주하며, 다음 그룹이 9번째 탭을 요구하면 반드시 셸 구조(안 B) 도입을 재검토한다." 이 그룹이 바로 그 "다음 그룹"이다.

### 1.2 검토한 대안

| 안 | 내용 | 판정 |
|---|---|---|
| A. 신규 최상위 탭을 **평면으로 5개**(세트목록/세트상세/실행목록/실행결과/비교) 추가 | 8 → 13탭 | **기각** — 논의할 가치도 없이 과밀. FR-V3-1이 요구하는 5개 "뷰"는 라우트 개수이지 탭 개수가 아니다. |
| B. 기존 "검증" 그룹의 두 탭(AI 답변 설정·응답 테스트)을 지금 와서 `Shell`로 합치고, 그 안에 이 그룹을 세 번째 서브내비로 끼워 넣는다 | 8탭 유지(그룹 재구성) | **기각** — `quality-channel-ui-spec.md` §2.1과 `nlu-rag-answering-ui-spec.md` §2.1-B가 이미 같은 근거로 두 차례 기각한 안이다: "기존 라우트 안정성이 탭 개수 최소화보다 우선한다." `/answer-settings`·`/simulator`는 이미 **구현·배포된 살아있는 라우트**이며 편집 화면들의 드로어 진입(SIM1-D)이 그 라우트 구조를 전제한다. 지금 합치면 이번 그룹과 무관한 화면들의 회귀 위험만 늘어난다. |
| C. 이번 그룹을 "응답 테스트" 탭 내부의 서브내비 항목으로 흡수(라우트 신설 0건) | `/simulator`가 Shell이 되어 "실시간 테스트\|대화검증" 2개 서브내비 | **기각** — `learning-augmentation-ui-spec.md`가 "신규 탭 0개" 원칙을 지킨 것은 그 그룹이 **기존 편집 모달 2개를 확장**하는 것으로 전부 흡수됐기 때문이다(§1). 이 그룹은 성격이 다르다: **독립적으로 재방문하는 목적지 5개**(세트관리·업로드·실행이력·결과분석·비교분석)이며, 단건 실시간 탐색(SIM1)과 **작업 흐름 자체가 다르다**(FR-V1-\* "4.1.1 범위 확정" 표 — 입력규모·보관·판정·실행방식·비교축 6개 축 전부 다름). 서브내비 항목 하나에 5개 뷰를 또 욱여넣으면 3단 내비게이션(탭→서브내비→내부탭)이 되어 `stats-learning-ui-spec.md` §1.3이 경계한 "항목 밀도 붕괴"가 그대로 재현된다. |
| **D. 신규 최상위 탭 1개("대화검증") 추가, 그 탭 자체가 `ValidationShell`(서브내비 2개: TC 세트 \| 실행 이력)** | 8 → **9탭**, "검증" 그룹 2 → 3항목 | **채택** |

### 1.3 D를 채택하는 근거

1. **`StatsShell` 선례를 "탭 개수를 줄이는 방향"이 아니라 "탭 개수를 정직하게 필요한 만큼만 늘리되 내부를 셸로 흡수하는 방향"으로 적용한다.** `stats-learning-ui-spec.md` §1.5의 판단 기준을 그대로 가져온다 — *"두 화면이 실제로 서로를 호출하고, 사용자의 멘탈모델상 하나의 작업 영역이면 탭 1개 + 서브내비로 묶는다."* 세트관리(TC/업로드)와 실행이력(결과/비교)은 서로 딥링크로 이어지는 **하나의 작업 영역**("이 세트를 실행하고 결과를 본다")이므로 셸 하나로 묶는 것이 맞고, 그 묶음 자체는 **독립적으로 재방문하는 1급 목적지**(nlu-rag-answering §2.1-A의 채택 기준과 동일)이므로 탭 1개를 받을 자격이 있다.
2. **"9번째 탭을 요구하면 셸을 재검토하라"는 트리거를 문자 그대로 충족한다.** 트리거가 경계한 것은 "**평면** 9번째 탭"이지 "탭 자체가 셸인 9번째 탭"이 아니다. 이번 안은 5개 뷰를 5개 탭이 아니라 **탭 1개 + 서브내비 2개 + 그 안의 드릴다운 라우트**로 흡수했으므로, 트리거가 요구한 재검토를 실제로 수행한 결과물이다.
3. **그룹 폭이 악화되지 않는다.** "검증" 그룹이 2 → 3항목이 되어도 이미 "운영" 그룹이 3항목이다 — 태블릿 줄바꿈 시에도 그룹 경계가 유지되는 기존 규칙(`quality-channel-ui-spec.md` §2.4)이 그대로 적용되므로 반응형 레이아웃에 새 예외가 필요 없다.
4. **탭 레이블이 카탈로그 원문과 정합한다.** "대화검증"은 No.19 원문("대화검증시스템")과 직접 대응하며, "응답 테스트"(단건 탐색, No.10)와 명확히 구분돼 사용자가 두 탭을 혼동하지 않는다(FR-V3-2가 요구하는 경계 인지).

### 1.4 결과 — `TabNav` 확장 (기존 파일 1곳만 수정)

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
    <a href="/chatbots/:id/answer-settings">AI 답변 설정</a>
    <a href="/chatbots/:id/simulator">응답 테스트</a>
    <a href="/chatbots/:id/validation" class="tab-nav-link">대화검증</a>   <!-- [신규] -->
  </div>
  <div class="tab-nav-group" role="group" aria-label="배포">
    <a href="/chatbots/:id/skin">스킨/임베드</a>
    <a href="/chatbots/:id/channels">채널</a>
  </div>
</nav>
```

`ValidationShell`(`DialogueShell`/`StatsShell`과 동일한 "탭 1개 + `Outlet` 서브내비" 패턴)의 서브내비:

```
[ValidationShell 서브내비]  TC 세트 | 실행 이력
```

- **서브내비는 얇은 가로 스트립**(`StatsShell` 방식 — 항목 2개뿐이라 `DialogueShell`의 좌측 레일은 과함, `stats-learning-ui-spec.md` §1.3과 동일 판단).
- 진입 시 `/validation`(정확히 일치)이면 `/validation/sets`로 리다이렉트(`StatsShell`의 `/stats` → `/stats/overview` 리다이렉트와 동일 규약).
- 접근 규칙: `ValidationShell` 진입은 `simulation:read` 하나로 충분하다(VIEWER 포함 전원이 조회 가능 — S-13). 서브내비 항목 자체는 숨기지 않는다(둘 다 조회 화면이므로 권한 분기가 필요 없다 — `StatsShell`이 두 서브내비에 서로 다른 권한을 요구한 것과 달리 이 그룹은 18개 API 전부 `simulation:read`/`simulation:write` 2종뿐이라 서브내비 단위 분기가 필요 없다).

### 1.5 라우트 표

```
/chatbots/:chatbotId/validation                              → ValidationShell(리다이렉트 → sets)
  /validation/sets                                            → V1 TC 세트 목록
  /validation/sets/:setId                                     → V2 TC 세트 상세(TC 표 + 업로드)
  /validation/runs                                             → V3 실행 목록(세트 필터)
  /validation/runs/:runId                                      → V4/M2 실행 결과 상세(mode에 따라 SINGLE/오버레이 비교 레이아웃 분기)
  /validation/compare?baseRunId=&targetRunId=                  → V5/M1 실행 간 비교
```

5개 드릴다운 라우트가 정확히 요구사항 FR-V3-1의 5개 뷰(세트목록·세트상세·실행목록·실행결과·비교결과)에 대응한다. `runs/:runId`가 이중 역할(SINGLE=No.19 결과 화면, OVERLAY_COMPARE=No.20 M2 화면)을 하는 이유는 §4.4에서 설명한다.

---

## 2. 화면 목록 및 라우트 요약

| ID | 화면명 | 라우트 | 진입 경로 | 권한(조회/쓰기) |
|---|---|---|---|---|
| V1 | TC 세트 목록 | `/chatbots/:chatbotId/validation/sets` | `TabNav` "대화검증" → 서브내비 "TC 세트"(기본) | `simulation:read` / `simulation:write` |
| V2 | TC 세트 상세(TC 표 + 업로드) | `/chatbots/:chatbotId/validation/sets/:setId` | V1의 세트 행 클릭 | 〃 |
| V3 | 실행 목록 | `/chatbots/:chatbotId/validation/runs` | 서브내비 "실행 이력", V2의 "실행 이력 전체보기" | 〃 |
| V4 | 실행 결과 상세(No.19) / M2 오버레이 비교(No.20) | `/chatbots/:chatbotId/validation/runs/:runId` | V3의 실행 행 클릭, `AugmentationPanel`의 "선택 항목 영향도 검사"(M2 진입) | 〃 |
| V5 | 실행 간 비교(No.20 M1) | `/chatbots/:chatbotId/validation/compare?baseRunId=&targetRunId=` | V3에서 실행 2건 체크 후 "비교" | 〃 |
| A1x | 예문 증강 패널 확장(진입 액션 추가) | `learning-augmentation-ui-spec.md` A1(기존 라우트, 변경 없음) | `IntentEditModal` 내부 `AugmentationBulkActionBar` | `dialogue:write`(기존) |
| SIM2x | 비교 모드 안내 링크 교체 | `quality-channel-ui-spec.md` SIM2(기존 라우트, 변경 없음) | 기존과 동일 | 기존과 동일 |

---

## 3. 공통 UI 요소

### 3.1 재사용(변경 없음)

`ConfirmDialog`/`Modal`, `Toast`, `InlineFieldError`, `SkeletonCard`/`SkeletonRow`, `EmptyState`, `ErrorState`, `SeverityBadge`(INFO/WARNING/ERROR), `Pagination`, `KebabMenu`, `FileUploadField`, `ChipListEditor`, `ResourcePickerField`(TC 편집 폼의 "기대 대상" 선택), `BulkImportModal`(§3.2에서 `resourceType:'TEST_CASE'` 확장), `ImportValidationReportTable`/`ImportRowErrorBadge`(신규 코드 2종 추가), `ErrorRowCsvDownloadButton` 패턴(→ 결과·비교 CSV 내보내기로 일반화), `CompareView`/`CompareTurnRow`/`DiffBadge`(SIM2, M1/M2 표에 재사용), `AsyncJobProgress` 패턴(폴링 대상만 교체), `StatsShell`/`DialogueShell`과 동일한 "탭+서브내비" 셸 골격, `ProposalContainer`(§2 학습고도화 — 이번 그룹은 만들지 않지만 A1x 진입 버튼이 그 컨테이너 안에 놓인다).

### 3.2 신규 컴포넌트

| 컴포넌트 | 용도 | 배치 |
|---|---|---|
| `ValidationShell` | 탭 셸(서브내비 2개) | `pages/chatbot-detail/validation/ValidationShell.tsx` |
| `TestSetListPage` | V1 본체 | `validation/sets/TestSetListPage.tsx` |
| `TestSetCard` | 세트 1건 카드/행 | 동일 |
| `TestSetFormModal` | 세트 생성/수정(이름·설명) | 동일 |
| `TestSetDeleteConfirmDialog` | 세트 삭제 확인(실행 이력 함께 삭제됨을 고지) | 동일 |
| `TestSetDetailPage` | V2 본체 | `validation/sets/TestSetDetailPage.tsx` |
| `TestCaseTable` | TC 목록(페이지네이션) | 동일 |
| `TestCaseRow` | TC 1행 — 멀티턴 배지, 기대유형/대상명(조회시점 해석) | 동일 |
| `TestCaseFormModal` | TC 단건 생성/수정(최대 5턴 입력) | 동일 |
| `TestCaseImportModal` | `BulkImportModal`의 `resourceType:'TEST_CASE'` 인스턴스 | 재사용, 래핑만 |
| `TestCaseBulkDisableButton` | `UNRESOLVED` 일괄 비활성 | `validation/sets/` |
| `RecentRunsPreview` | 세트 상세 하단 "최근 실행 5건" 미니 목록 | 동일 |
| `RunTriggerButton` / `RunTriggerDialog` | 실행 시작(세트 선택, `useRag` 고급 옵션) | `validation/runs/` |
| `TestRunListPage` | V3 본체 | `validation/runs/TestRunListPage.tsx` |
| `TestRunRow` | 실행 1행 — 상태·진행률·pin·취소·비교선택 체크박스 | 동일 |
| `TestRunProgressBar` | 진행률(`aria-live="polite"`) | 동일, `TestRunDetailPage`와 공유 |
| `TestRunCompareSelectBar` | "N건 선택됨 → 비교" | 동일 |
| `TestRunDetailPage` | V4 본체(`mode` 분기) | `validation/runs/TestRunDetailPage.tsx` |
| `TestRunSummaryBar` | 4값 요약 배지 / 델타 요약(M2) | 동일 |
| `EnvFingerprintBadgeGroup` | 저하모드·임베딩모델·임계값 배지 | 동일 |
| `TestRunResultTable` | 결과 표(필터·페이지네이션) | 동일 |
| `TestRunResultRow` | 결과 1행 | 동일 |
| `JudgmentBadge` | `PASS`/`FAIL`/`NOT_JUDGED`/`UNRESOLVED` 공통 배지(§3.3) | `components/` 공용 |
| `UnresolvedGroupPanel` | `UNRESOLVED` 별도 그룹 + 일괄 비활성 | `validation/runs/` |
| `OpenInSimulatorButton` | 결과 행 → 시뮬레이터 재현(§6.4) | 동일 |
| `RunCompareView` | M1/M2 공용 비교 표 셸 | `validation/compare/RunCompareView.tsx` |
| `RunCompareSummaryDelta` | "통과 471 → 468 (▼3)" | 동일 |
| `ClassificationBadge` | `REGRESSED`/`IMPROVED`/`CHANGED`/`UNCHANGED`/`ONLY_IN_ONE`(M1) | 동일 |
| `OnlyInOneSection` | M1 전용 — 한쪽에만 있는 TC 별도 섹션 | 동일 |
| `EnvFingerprintDiffBanner` | 강한 경고(임베딩모델/저하모드 불일치) | `validation/compare/` |
| `AugmentationImpactCheckButton` | A1x — 증강 패널 확장 | `pages/dialogue/components/AugmentationPanel.tsx` 내부 |
| `AugmentationImpactSetPickerDialog` | M2 진입 시 대상 TC 세트 선택 | 동일 |
| `ResultCsvExportButton` | 결과·비교 CSV 내보내기(공용) | `validation/` |

### 3.3 판정 4값의 고정 시각 언어 (`JudgmentBadge`) — UNRESOLVED가 FAIL이 아님을 구조로 보장

이 그룹 전체에서 **단 하나의 컴포넌트**로만 판정을 그린다(화면마다 다른 배지를 만들지 않는다 — NFR-VM2의 "복제 금지" 정신을 화면에도 적용).

| 값 | 아이콘 | 텍스트 라벨 | 색상(배경/텍스트, 4.5:1 이상) | 의미 |
|---|---|---|---|---|
| `PASS` | ✔ | "통과" | 초록 계열 | 매칭 대상 ID 일치 |
| `FAIL` | ✕ | "실패" | 빨강 계열 | 매칭 대상 ID 불일치 |
| `NOT_JUDGED` | ➖ | "판정 안 함" | 회색 계열 | `expectedKind: 'ANY'` — 회귀 비교 전용 |
| `UNRESOLVED` | ⚠ | "판정 불가" | **주황(경고) 계열 — 빨강과 명확히 구분되는 색상**, 점선 테두리 | 기대 대상이 현재 자산에 없음. **집계상 FAIL이 아니다** |

- `UNRESOLVED`는 색상·아이콘·테두리 스타일(점선) **3중으로** `FAIL`(실선 빨강)과 구분한다(NFR-VA1, J-4 결정 "UNRESOLVED는 실패로 집계하지 않는다"를 시각적으로도 오인 불가하게 만든다).
- 요약 배지 나열 순서는 항상 `통과 → 실패 → 판정 안 함 → 판정 불가`이며, `통과+실패+판정안함+판정불가 = 실행 대상 TC 수`라는 산식을 요약 바 하단에 상시 각주로 표기한다(AC-V2-3을 사용자가 직접 검산할 수 있게).
- 툴팁/보조텍스트: `UNRESOLVED` 배지에 항상 "기대 대상이 삭제되었거나 이름이 바뀌었습니다"를 인접 텍스트로 병기(FR-V3-6).

---

## 4. 화면별 설계

## 4.1 V1 — TC 세트 목록 `/chatbots/:chatbotId/validation/sets`

### 목적
챗봇의 회귀 테스트 자산(TC 세트, 최대 20개)을 조회·생성·삭제한다.

### 상태별 UI

| 상태 | UI |
|---|---|
| 로딩 | `SkeletonCard` × 4 |
| 빈 상태(세트 0건) | `EmptyState`: "아직 TC 세트가 없습니다." + "엑셀로 대량 문장을 올리거나 직접 TC를 추가해 회귀 테스트 자산을 만들어 보세요." + `[+ 세트 만들기]`(FR-V3-10 ①) |
| 정상 | 카드/행 목록(§4.1.2) |
| 세트 상한 도달(20개) | `[+ 세트 만들기]` 버튼이 `aria-disabled` + 사유 텍스트 "세트는 챗봇당 최대 20개까지 만들 수 있습니다." |
| `ARCHIVED` 챗봇 | 상단 `SeverityBadge(WARNING)`: "보관된 챗봇입니다. 세트 조회는 가능하지만 생성·업로드·실행은 초안으로 복구한 뒤 가능합니다." 목록 자체는 조회 허용, 쓰기 버튼만 `aria-disabled`(FR-0-22와 동일 패턴) |

### 레이아웃 (데스크톱)

```
┌ TC 세트 ───────────────────────────────────────────────────── [+ 세트 만들기] ┐
│ 세트당 최대 20개 · 현재 3개                                                    │
├────────────────────────────────────────────────────────────────────────────┤
│ 배송 시나리오 회귀           TC 487건       최근 실행: 완료 · 09-23 09:12       │
│ 배송 관련 회귀 문장 세트      통과 471 · 실패 9 · 판정불가 0     [열기] ⋮        │
├────────────────────────────────────────────────────────────────────────────┤
│ 환불규정문의 회귀            TC 62건        최근 실행: 없음                     │
│                                                                    [열기] ⋮  │
└────────────────────────────────────────────────────────────────────────────┘
```

### 컴포넌트 분해

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `TestSetListPage` | `chatbotId` |
| `TestSetCard` | `{ id, name, description?, caseCount, isDefault }` + `latestRun?: { status, summary, finishedAt }`(목록 API가 조인해 내려줌 — 프런트가 세트마다 실행 목록을 추가 조회하지 않는다, N+1 금지) |
| `TestSetFormModal` | `mode:'create'|'edit'`, `initial?`, 이름 정규화 유일성 오류는 서버 응답(`409`)을 인라인 오류로 표시(§UIUX §7) |
| `TestSetDeleteConfirmDialog` | 본문: "이 세트와 소속 TC {n}건, 실행 이력 {m}건이 함께 삭제됩니다. 되돌릴 수 없습니다." |
| `KebabMenu`(재사용) | "이름 변경" · "삭제" |

### 인터랙션 흐름

```
[+ 세트 만들기] → TestSetFormModal(이름 필수, 설명 선택) → 저장
  → 201: 목록에 즉시 추가 → Toast "세트가 생성되었습니다."
  → 409(이름 중복, 정규화 기준): 모달 내 이름 필드 인라인 오류 "이미 사용 중인 이름입니다."
카드 클릭 → V2로 이동
```

---

## 4.2 V2 — TC 세트 상세(TC 표 + 대량 업로드) `/chatbots/:chatbotId/validation/sets/:setId`

### 목적
TC를 조회·추가·수정·삭제하고, 엑셀/CSV로 대량 등록하며, 이 세트로 실행을 시작한다.

### 상태별 UI

| 상태 | UI |
|---|---|
| 로딩 | `SkeletonRow` × 8 |
| 빈 상태(TC 0건) | `EmptyState`: "이 세트에는 아직 TC가 없습니다." + `[+ TC 추가]` `[엑셀/CSV 업로드]`(FR-V3-10 ②) — **실행 버튼은 비활성**("실행할 TC가 없습니다") |
| 정상 | §4.2.2 레이아웃 |
| TC 상한 근접/도달(세트 2,000 · 챗봇 총 5,000) | 액션바 상단에 배지 "487/2,000건(세트) · 512/5,000건(챗봇 전체)". 도달 시 `[+ TC 추가]`/업로드 커밋 버튼이 `aria-disabled` + `TEST_CASE_LIMIT_EXCEEDED` 사유 |
| 실행 진행 중(이 세트) | 상단 배너: 진행률 바 + "실행 중입니다 · 340/2,000 처리됨"(`aria-live="polite"`) + `[취소]`. **실행 버튼은 이 상태에서 `aria-disabled`**(FR-V1-17, `409 TEST_RUN_IN_PROGRESS` 사전 방지) |

### 레이아웃 (데스크톱)

```
┌ 배송 시나리오 회귀 ──────────────────────────────────────── [실행 이력 전체보기] ┐
│ 배송 관련 회귀 문장 세트                                        [이름/설명 편집]  │
├──────────────────────────────────────────────────────────────────────────────┤
│ 487/2,000건(세트) · 512/5,000건(챗봇 전체)                                     │
│ [+ TC 추가]  [엑셀/CSV 업로드]  [세트 내보내기 CSV]  [템플릿 다운로드]  [실행하기] │
├──────────────────────────────────────────────────────────────────────────────┤
│ 필터: [ 전체 ▾ ]  [ 사용함만 ▾ ]     검색 [_____________]                      │
├──────────────────────────────────────────────────────────────────────────────┤
│ # │ 질문                        │ 기대유형 │ 기대 대상       │ 사용 │ 액션      │
│ 1 │ 배송 조회해주세요             │ 의도     │ 주문_배송조회    │ ✔   │ 편집 삭제 │
│ 2 │ (3턴) 아메리카노 → 톨 → 결제  │ 노드     │ 커피주문_완료    │ ✔   │ 편집 삭제 │
│ 3 │ 사장님 나와                  │ 폴백     │ (해당없음)       │ ✔   │ 편집 삭제 │
│                                                              ◀ 1..10 ▶       │
├──────────────────────────────────────────────────────────────────────────────┤
│ 최근 실행                                                                     │
│ 09-23 09:12  완료  통과471·실패9·판정불가0        [결과보기]                    │
│ 09-22 09:05  완료  통과471·실패0·판정불가0        [결과보기]                    │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 컴포넌트 분해 및 데이터 바인딩

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `TestSetDetailPage` | `chatbotId`, `setId` |
| `TestCaseLimitBadge` | `{ setCount, setMax:2000, chatbotCount, chatbotMax:5000 }` |
| `TestCaseTable` | `items: TestCase[]`(서버 페이지네이션, 기본 50행 — NFR-VP7), 컬럼별 정렬 없음(순서=`seq`) |
| `TestCaseRow` | `{ seq, messages: string[], expectedKind, expectedTargetName? }`(**조회 시점에 서버가 이름을 해석해 내려줌** — FR-V1-4, 저장은 ID) . `messages.length > 1`이면 "멀티턴(N턴)" 배지 + 펼침으로 전체 턴 표시. `expectedTargetName`이 `null`인데 `expectedKind`가 대상 필요형이면 "⚠ 대상 삭제됨" 인라인 경고(다음 실행에서 `UNRESOLVED`가 될 것을 사전 예고, EX-V-3 대비) |
| `TestCaseFormModal` | 필드: 질문(턴별 입력 UI — "+ 턴 추가", 최대 5턴, 각 1~1,000자, UIUX §5 글자수 실시간), 기대유형(라디오 5종, 단일선택 — UIUX §6), 기대대상(`ResourcePickerField`, `expectedKind`에 따라 resourceType 전환, `FALLBACK`/`ANY`는 필드 자체 숨김), 참고 메모(500자, **"참고용 — 판정에 사용되지 않습니다" 상시 병기**, FR-V1-5), 사용함 토글 |
| `TestCaseImportModal` | `BulkImportModal` 재사용(§4.3). |
| `RecentRunsPreview` | `runs: TestRun[]`(최근 5건), 각 행 "결과보기" → V4 |
| `RunTriggerButton` | `disabled = caseCount===0 || 진행중 실행 존재`, 클릭 시 `RunTriggerDialog` |
| `ResultCsvExportButton`(세트 내보내기용 변형) | `GET .../cases/export` — BOM+`escapeCsvCell`, 업로드와 동일 컬럼 규격(FR-V1-15) |

### 4.2.1 TC 개별 CRUD 흐름

```
[+ TC 추가] → TestCaseFormModal(빈 값) → 저장
  → 201: 표에 즉시 추가 + Toast
  → 409 TEST_CASE_LIMIT_EXCEEDED: 모달 상단 인라인 오류 "세트당 TC 상한(2,000건)을 초과합니다."
행의 [편집] → 동일 모달(기존 값 채움) → 저장 → PATCH → 표 갱신
행의 [삭제] → ConfirmDialog("이 TC를 삭제하시겠습니까? 과거 실행 결과에는 영향을 주지 않습니다.") → DELETE
```

### 4.2.2 대량 업로드 — `BulkImportModal`의 4번째 소비자

`resourceType: 'TEST_CASE'`로 기존 3단계 마법사를 그대로 재사용한다(§4.4 `dialogue-design-ui-spec.md`와 **완전히 동일한 상호작용 규칙** — 신규 규칙 0건).

**1단계 — 파일 선택**: 템플릿 다운로드(csv/xlsx) → "질문문장(멀티턴은 `|` 구분)·기대유형(의도/FAQ/노드/폴백/미지정)·기대대상명·비고" 4열 안내.

**2단계 — 검증 결과**:
```
┌ 엑셀/CSV로 TC 업로드 (2/3 검증 결과) ──────────────────────────────────── ✕ ┐
│ 총 500행 · 신규 487건 · 중복 8건(건너뜀) · 오류 5건                         │
│ [ImportValidationReportTable: 오류 5건 표]                                  │
│   3행  기대대상명  "배송문의2"  TARGET_NOT_FOUND   기대 대상명을 찾을 수 없습니다 │
│  17행  기대대상명  "환불규정"   AMBIGUOUS_TARGET   같은 이름이 2건 있어 특정할 수 없습니다 │
├─────────────────────────────────────────────────────────────────────────┤
│                              [이전]  [취소]  [오류 행 CSV 다운로드]  [반영하기]│
└─────────────────────────────────────────────────────────────────────────┘
```
- `ImportRowErrorBadge`에 **2종 신규 코드** 추가: `TARGET_NOT_FOUND`→"대상 없음", `AMBIGUOUS_TARGET`→"대상 모호함"(둘 다 노랑/주황 계열 경고, 아이콘+텍스트).
- **정책 선택 없음**(의도/키워드 업로드와의 차이): TC 업로드는 `mergePolicy`(병합/전체교체/건너뛰기) 라디오가 필요 없다 — TC는 세트 내 문장 단위 신규 추가만 있고 "기존 항목과 이름이 겹칠 때"의 개념이 없다(중복은 자동으로 `duplicatedRows`, FR-V1-7). `errorPolicy`(유효한 행만 반영/전체 취소)만 남긴다.
- `AMBIGUOUS_TARGET`이 있는 행은 **반영하기를 눌러도 그 행만 제외**되고 커밋되지 않는다(FR-V1-13 — "커밋하지 않는다"는 그 행 단위 규칙이지 전체 취소가 아니다. 화면 문구: "대상이 모호한 행은 반영되지 않았습니다. 이름을 구체화한 뒤 다시 올려 주세요.").

**3단계 — 완료**: "반영되었습니다. 신규 487건 · 중복 무시 8건 · 오류 5건" + 오류 행 CSV 다운로드.

### 4.2.3 실행 시작

```
[실행하기] 클릭 → RunTriggerDialog
┌ 실행 시작 — 배송 시나리오 회귀 ──────────────────────────── ✕ ┐
│ 대상 TC: 487건(사용함 기준)                                   │
│ ▸ 고급 옵션                                                   │
│   ☐ 2단계(외부 AI 검색) 결과까지 확인합니다                    │
│      (최대 50건만 호출되며, 호출된 TC는 판정에서 제외됩니다)     │
├──────────────────────────────────────────────────────────────┤
│                                          [취소]   [실행 시작]  │
└──────────────────────────────────────────────────────────────┘
```
- `useRag` 체크박스는 **기본 꺼짐**(J-10, FR-V2-20), "고급 옵션" 접이식 안에 둬 실수 클릭을 줄인다.
- `[실행 시작]` → `POST .../runs {useRag}` → `202 { runId }` → 즉시 V4(`/validation/runs/:runId`)로 이동, 진행 중 화면(§4.4)이 뜬다.
- `409 TEST_RUN_IN_PROGRESS`: 다이얼로그 닫지 않고 인라인 오류 "이미 진행 중인 실행이 있습니다. 완료 후 다시 시도해 주세요." + "진행 중인 실행 보기" 링크(해당 `runId`로 이동).

---

## 4.3 V3 — 실행 목록 `/chatbots/:chatbotId/validation/runs`

### 목적
세트별 실행 이력(보존 20건 + 고정 5건)을 조회하고, M1 비교 대상 2건을 선택한다.

### 상태별 UI

| 상태 | UI |
|---|---|
| 로딩 | `SkeletonRow` × 6 |
| 빈 상태(선택 세트에 실행 이력 0건) | `EmptyState`: "이 세트는 아직 실행된 적이 없습니다." + "[세트로 이동해 실행하기]"(FR-V3-10 ③) |
| 빈 상태(비교할 이전 실행 없음, 실행이 1건뿐일 때) | 체크박스 선택이 1건뿐이면 `[비교]` 버튼 `aria-disabled` + 안내 "비교하려면 실행을 2건 선택하세요."(FR-V3-10 ④) |
| 실행 중 행 존재 | 해당 행에 진행률 바(`aria-live="polite"`) 실시간 갱신(폴링), `[취소]` 버튼 |
| 보존 정리로 사라진 실행을 참조하던 딥링크 | "요청한 실행을 찾을 수 없습니다 — 보존 기간이 지나 정리되었을 수 있습니다." + 목록으로 돌아가기(EX-V-14) |

### 레이아웃 (데스크톱)

```
┌ 실행 이력 ─────────────────────────────────────────────────────────────────┐
│ 세트 [ 배송 시나리오 회귀 ▾ ]                                    [새 실행]   │
├──────────────────────────────────────────────────────────────────────────┤
│ ☐ 09-23 09:12  SINGLE      완료      통과471·실패9·판정불가0   4분12초  📌 ⋮│
│ ☐ 09-22 09:05  SINGLE      완료      통과471·실패0·판정불가0   3분58초    ⋮│
│ ☐ 09-21 15:30  오버레이비교 완료(M2) 통과471→468(▼3)          40초       ⋮│
│ ☐ 09-20 09:00  SINGLE      취소됨    340/2000 처리됨(비교 불가) 진행중취소  ⋮│
├──────────────────────────────────────────────────────────────────────────┤
│ 2건 선택됨                                              [선택한 두 실행 비교] │
└──────────────────────────────────────────────────────────────────────────┘
```

### 컴포넌트 분해

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `TestRunListPage` | `chatbotId`, URL 쿼리 `setId?`(없으면 "전체" 또는 최근 방문 세트 기억) |
| `SetFilterSelect` | 단일 선택 셀렉트(UIUX §6) |
| `RunTriggerButton` | V2와 동일 컴포넌트, `setId`가 선택돼 있을 때만 활성 |
| `TestRunRow` | `{ id, mode, overlaySource, status, summary, degradedMode, elapsedMs, pinned, createdAt }`. `status==='CANCELLED'`면 체크박스 자체가 `disabled` + 툴팁 "취소된 실행은 비교 기준으로 쓸 수 없습니다"(FR-V1-22, `TEST_RUN_NOT_COMPARABLE` 사전 차단) |
| `TestRunProgressBar` | `status==='RUNNING'`일 때만, `progress/totalCount` 폴링(§0-8) |
| `PinToggleButton` | `pinned: boolean` → `POST .../pin {pinned}`. 세트당 5건 상한 도달 시 `aria-disabled` + "고정은 세트당 5건까지 가능합니다." |
| `TestRunCompareSelectBar` | `selectedIds: string[]`(최대 2), 2건 선택 시에만 `[비교]` 활성 → `navigate('/validation/compare?baseRunId=&targetRunId=')`(먼저 선택한 쪽이 base, 화면에서 스왑 가능) |
| `CancelRunButton` | `status ∈ {QUEUED,RUNNING}`일 때만 렌더, 클릭 시 `ConfirmDialog` 없이 즉시 `POST .../cancel`(가역적이지 않지만 "중단"은 경미한 작업이며 이미 처리된 부분은 남는다는 것을 버튼 툴팁으로 안내) |

### 인터랙션 흐름

```
[새 실행] → RunTriggerDialog(§4.2.3와 동일 컴포넌트, 세트 미선택 시 세트 선택 셀렉트 먼저)
체크박스 2건 선택 → [선택한 두 실행 비교] → V5로 이동
행 클릭(체크박스 아닌 본문) → V4로 이동
```

---

## 4.4 V4 — 실행 결과 상세 `/chatbots/:chatbotId/validation/runs/:runId` (No.19 결과 / No.20 M2 겸용)

### 목적과 모드 분기

이 라우트는 `TestRun.mode`에 따라 **완전히 다른 두 레이아웃**을 렌더한다 — 별도 라우트로 쪼개지 않는 이유는 M2가 "1회 실행 안에서 A/B가 함께 나온다"는 설계(ADR-0029 §2, "M2는 1회 실행 안에서 완결")를 그대로 화면 구조에 반영하기 위함이다.

| `mode` | 레이아웃 | 대응 |
|---|---|---|
| `SINGLE` | §4.4.1 — A 계열만, 4값 판정 표 | No.19 실행 결과 |
| `OVERLAY_COMPARE` | §4.4.2 — A/B 계열, 델타 요약 + `CompareView` 재사용 | No.20 **M2**(적용 전 비교) |

### 4.4.1 `SINGLE` — 실행 결과(No.19)

#### 상태별 UI

| 상태 | UI |
|---|---|
| 진행 중(`QUEUED`/`RUNNING`) | 결과 표 대신 진행 배너: 진행률 바 + "실행 중입니다 · 340/2,000 처리됨"(`aria-live="polite"`) + `[취소]`. **화면을 떠났다 돌아와도 서버 상태 그대로 조회**(S-5 — 폴링 재개, `sessionStorage` 불필요: `runId`가 URL에 있으므로 재진입 시 그대로 폴링 시작) |
| `FAILED` | "실행이 실패했습니다" + `failureReason`(예: "서버가 재시작되어 정리되었습니다" — `SERVER_RESTART`, AC-V2-14) + `[다시 실행]`(같은 세트로 새 실행 트리거) |
| `CANCELLED` | 상단 배너 "이 실행은 취소되어 일부만 처리되었습니다(340/2,000). 비교 기준으로 선택할 수 없습니다." + 그때까지의 결과는 정상 표시 |
| `SUCCEEDED`, 저하 모드 | 헤더에 상시 배지 `⚠ 의미 매칭 저하 모드로 실행됨 — 규칙 매칭만 적용`(S-7) |
| `SUCCEEDED`, 정상 | §레이아웃대로 |
| `UNRESOLVED` 존재 | 별도 그룹(`UnresolvedGroupPanel`, 아래) |

#### 레이아웃 (데스크톱)

```
┌ 배송 시나리오 회귀 · 실행 09-23 09:12 ───────────────────────── [CSV 내보내기] ┐
│ 완료 · 소요 4분12초 · 자산 지문: 의도42·키워드118·노드30·FAQ95            │
├──────────────────────────────────────────────────────────────────────────┤
│ ✔ 통과 471   ✕ 실패 9   ➖ 판정 안 함 0   ⚠ 판정 불가 32                  │
│ (통과+실패+판정안함+판정불가 = 512 = 실행 대상 TC 수)                       │
├──────────────────────────────────────────────────────────────────────────┤
│ 필터: [ 실패만 ▾ ]   검색 [___________]           ☐ 전체 보기(기본 꺼짐)   │
├──────────────────────────────────────────────────────────────────────────┤
│ 질문              기대              실제              판정   구간   점수  미리보기│
│ 배송지 변경하고싶어 주문_배송조회      배송_주소변경        ✕실패  확정  0.81  "배송 주소는…" [시뮬레이터로 열기]│
│ 환불 얼마나 걸려   환불규정문의       환불규정문의         ✔통과  확정  0.91  "환불은 영업일…" [시뮬레이터로 열기]│
├──────────────────────────────────────────────────────────────────────────┤
│ ⚠ 판정 불가 32건 — TC 정리가 필요합니다                    [일괄 비활성]   │
│  "배송문의2" 노드가 삭제되어 기대 대상을 찾을 수 없습니다 (12건)           │
│  "환불규정문의" 의도가 삭제되어 기대 대상을 찾을 수 없습니다 (20건)        │
└──────────────────────────────────────────────────────────────────────────┘
```

#### 컴포넌트 분해

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `TestRunDetailPage` | `chatbotId`, `runId` — `run.mode`로 분기 |
| `TestRunSummaryBar` | `{ pass, fail, notJudged, unresolved, total }` + 각주 산식 텍스트(§3.3) |
| `EnvFingerprintBadgeGroup` | `envFingerprint`(자산 건수 6종 요약, `degradedMode`) |
| `TestRunResultTable` | `items: TestRunResult[]`(서버 페이지네이션 50행), **기본 필터 = "실패"**(FR-V3-4— UNRESOLVED는 표 필터가 아니라 아래 별도 패널로 뺀다) |
| `TestRunResultRow` | `{ questionText(멀티턴은 마지막 턴 강조 + "이전 턴 보기" 펼침), expectedKind/expectedTargetId→이름, matched*Name, resultA→JudgmentBadge, bandA, top1ScoreA, outputsPreviewA(120자, "…더보기"로 전체는 보여주지 않음—원본 미저장, FR-V1-29), unsupportedCountA>0이면 "일부 아웃풋 미실행" 배지, blockedByFilterA면 "금지어로 차단된 응답" 배지(S-9) }` |
| `OpenInSimulatorButton` | 클릭 시 `sessionStorage`에 `simulatorPrefill:<uuid> = { messages, overlay? }` 저장 후 `/chatbots/:id/simulator?prefillKey=<uuid>`로 이동(§6.4 상세) |
| `UnresolvedGroupPanel` | `items: TestRunResult[](resultA==='UNRESOLVED')`, 삭제된 대상별로 그룹핑해 건수 표시 |
| `TestCaseBulkDisableButton` | `UnresolvedGroupPanel` 안에서 호출, `POST .../cases/bulk-disable {caseIds}`(≤500건) → 성공 시 "32건을 비활성화했습니다. 다음 실행부터 제외됩니다." |
| `ResultCsvExportButton` | `GET .../export` |

#### 인터랙션 흐름 (진행 → 완료)

```
V2/V3에서 실행 시작 → 즉시 V4 진입, status=QUEUED
  → 폴링(GET .../runs/:runId, 1~2초 간격) → RUNNING, progress 갱신(aria-live)
  → SUCCEEDED → 결과 표 로드(GET .../runs/:runId/results, 페이지 1)
  → 사용자가 화면을 떠났다 재진입해도 동일 폴링 로직이 현재 status를 그대로 반영(서버가 진실 원천, S-5)
[취소] → POST .../cancel → 다음 TC 경계에서 CANCELLED로 전환(폴링이 감지) → 배너 전환
```

### 4.4.2 `OVERLAY_COMPARE` — M2 적용 전 비교(No.20)

#### 상태별 UI

| 상태 | UI |
|---|---|
| 진행 중 | §4.4.1과 동일 진행 배너 |
| 완료, 제외된 제안 있음 | 상단 배너 "제외된 제안 {n}건 — 이미 처리되었거나 만료되었습니다."(FR-V2-12) |
| 완료, 저하 모드 | "⚠ 의미 매칭 없이 실행되어 증강 효과가 반영되지 않았습니다"(FR-V2-15 — S-7과 문구를 다르게 해 "왜 효과가 안 보이는지"를 정확히 알린다) |
| 완료, 정상 | §레이아웃대로 |

#### 레이아웃 (데스크톱)

```
┌ 배송 시나리오 회귀 · 승인 전 영향도 검사(오버레이) ─────────────── [CSV 내보내기] ┐
│ ℹ 이 실행은 승인 전 미리보기입니다 — 자산은 1바이트도 바뀌지 않았습니다.      │
│ 오버레이: 증강 제안 6건(환불규정문의 등 2개 의도에 예문 추가)               │
├──────────────────────────────────────────────────────────────────────────┤
│ 통과 471 → 468 (▼3)     회귀 3건    개선 0건                              │
├──────────────────────────────────────────────────────────────────────────┤
│ 필터: [ 회귀만 ▾ ]                                                        │
├───────────────────────────────────┬────────────────────────────────────┤
│ A(저장본)                          │ B(저장본 + 증강 제안 6건)             │
│ "반품하면 환불되나요"                │ "반품하면 환불되나요"                 │
│  → 반품문의  ✔통과                  │  → 환불규정문의  ✕실패  🟨 변경됨      │
├───────────────────────────────────┴────────────────────────────────────┤
│                                              [증강 승인 화면으로 돌아가기] │
└──────────────────────────────────────────────────────────────────────────┘
```

좁은 화면(<1024px)에서는 A/B가 **세로 스택**(A 먼저, B 다음 — FR-10-28/FR-V3-12 동일 규칙).

#### 컴포넌트 분해(§4.4.1과 겹치지 않는 것만)

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `OverlaySourceBanner` | `overlaySource:'AUGMENTATION_SUGGESTIONS'|'INLINE'`, `excludedSuggestions?: number` — "승인 전 미리보기" 안전 문구 상시 표시(§2 제안-자산 분리 톤 계승) |
| `RunCompareSummaryDelta` | `{ before: number, after: number, regressed: number, improved: number }` → "통과 471 → 468 (▼3)" |
| `RunCompareView`(M1과 공유) | `layout:'columns'|'stack'`(반응형), `rows: {questionText, a:{result,matchedName,...}, b:{...}, diffStatus}[]` |
| `ClassificationBadge` | 이 화면에서는 A/B 각각의 판정으로부터 파생한 `REGRESSED`/`IMPROVED`/`CHANGED`/`UNCHANGED`만 쓰고 `ONLY_IN_ONE`은 해당 없음(같은 TC 세트 내 A/B 비교이므로) |
| "증강 승인 화면으로 돌아가기" 링크 | `sessionStorage`에 저장해 둔 `returnTo`(진입 시 `AugmentationImpactCheckButton`이 기록, §6.3) 로 `navigate` |

---

## 4.5 V5 — 실행 간 비교 `/chatbots/:chatbotId/validation/compare?baseRunId=&targetRunId=` (No.20 M1)

### 목적
서로 다른 시점의 두 `SINGLE` 실행을 비교해 사후 회귀를 찾는다.

### 상태별 UI

| 상태 | UI |
|---|---|
| 로딩 | `SkeletonRow` × 6 |
| `baseRunId`/`targetRunId`가 같은 세트가 아님 | 진입 즉시 오류 화면: "두 실행은 같은 TC 세트여야 비교할 수 있습니다."(`400 TEST_RUN_NOT_COMPARABLE`) + 목록으로 돌아가기 |
| 기준 실행이 `CANCELLED`/`FAILED` | 동일 오류 화면, 사유만 다르게: "취소되었거나 실패한 실행은 비교 기준으로 쓸 수 없습니다." |
| 완료, 환경 지문 동일 | §레이아웃대로 |
| 완료, `embeddingModelId` 또는 `degradedMode` 불일치 | 상단 `EnvFingerprintDiffBanner`(강한 경고, 아래) |

### 레이아웃 (데스크톱)

```
┌ 실행 비교 ───────────────────────────────────────────────────── [CSV 내보내기] ┐
│ A: 09-22 09:05(어제)          B: 09-23 09:12(오늘)                          │
│ ⚠ 두 실행 사이에 의도 예문이 +46건 늘었습니다(임베딩 모델은 동일)             │
├──────────────────────────────────────────────────────────────────────────┤
│ 통과 471 → 462 (▼9)   회귀 9   개선 0   변화 3   변화없음 460   추가/삭제 5  │
├──────────────────────────────────────────────────────────────────────────┤
│ 필터: [ 실패 + 회귀 ▾ ](기본)      정렬: 회귀 우선(고정)                    │
├──────────────────────────────────────────────────────────────────────────┤
│ 질문             A(09-22)              B(09-23)              분류         │
│ 배송 언제 와요    ✔통과 · 주문_배송조회   ✕실패 · 배송_주소변경  🔴 회귀      │
│ (총 9건, 전부 주문_배송조회 → 배송_주소변경)                                 │
├──────────────────────────────────────────────────────────────────────────┤
│ ▸ 이 실행 사이에 추가/삭제된 TC 5건 (통과 수 변화에 포함되지 않음)            │
└──────────────────────────────────────────────────────────────────────────┘
```

### 컴포넌트 분해(§4.4.2와 공유하지 않는 것만)

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `RunCompareView`(공유) | `rows: TestRunComparison[]`(서버 페이지네이션, **기본 정렬 REGRESSED 우선** — FR-V2-6) |
| `ClassificationBadge` | 5분류 전부 사용: `REGRESSED`(빨강+✕), `IMPROVED`(초록+✔), `CHANGED`(노랑+±), `UNCHANGED`(회색, 기본 필터에서 숨김), `ONLY_IN_ONE`(별도 섹션으로 분리, 요약 델타에 포함하지 않음 — FR-V2-18) |
| `EnvFingerprintDiffBanner` | `diffFields: string[]`(`embeddingModelId`/`thresholds`/`degradedMode`) — `embeddingModelId` 차이는 **강한 경고**(배경색 진한 주황 + "⚠" + "입력 공간이 달라 이 비교의 차이 중 상당수는 회귀가 아닐 수 있습니다") |
| `OnlyInOneSection` | `items: {questionText, onlySide:'A'|'B'}[]`, 접이식, "이 TC들은 두 실행 사이에 추가되거나 삭제되어 비교 대상이 아닙니다" |
| `TestRunListPage`의 `TestRunCompareSelectBar` | (V3에서) base/target 스왑 컨트롤 — 잘못 순서로 골랐을 때 "A/B 바꾸기" 버튼 하나로 쿼리 파라미터만 교체 |

### 인터랙션 흐름

```
V3에서 실행 2건 체크 → [선택한 두 실행 비교] → V5 진입(먼저 체크한 순서로 base/target 배정)
  → GET .../compare?baseRunId=&targetRunId=&filter=REGRESSED,FAIL(기본)
  → 200: 요약 델타 + 분류별 카운트 + 표(REGRESSED 우선)
  → [필터: 전체 보기] → UNCHANGED 포함 재조회
  → [A/B 바꾸기] → 쿼리 스왑, 재조회(REGRESSED/IMPROVED 방향이 그대로 뒤집힘)
```

---

## 4.6 A1x — 증강 승인 화면 확장: "선택 항목 영향도 검사" (FR-V3-3 ★ 이 그룹의 핵심 접합부)

### 배치 — 기존 `AugmentationBulkActionBar`(코드: `AugmentationPanel.tsx` 306~331행)에 버튼 1개 추가

기존(코드 확인, `learning-augmentation-ui-spec.md` §4.2 그대로):
```
2건 선택됨   [선택 예문으로 추가]   [선택 거절]   [해제]
```

**변경 후**:
```
2건 선택됨   [선택 항목 영향도 검사]   [선택 예문으로 추가]   [선택 거절]   [해제]
```

- **위치를 "선택 예문으로 추가"보다 왼쪽(먼저 보이는 자리)에 둔다** — S-1 시나리오("편집자가 6건을 선택하고 `승인` 대신 `선택 항목 영향도 검사`를 누른다")가 요구하는 자연스러운 시선 흐름·클릭 순서다. 근거는 선택된 항목의 파괴적 확정(승인)보다 **비파괴적 검사가 먼저 눈에 띄어야** S-1의 "승인 전에 본다" 습관이 형성된다.
- 버튼 스타일은 `btn-secondary`(승인=`btn-primary`와 위계 구분 — 이 버튼은 자산을 바꾸지 않는 조회성 액션이다).
- `selected.size === 0`이면 바(bar) 자체가 렌더되지 않는다(기존 규칙 그대로, §4.2 "1건 이상 선택 시만").
- **VIEWER는 이 버튼도 렌더되지 않는다** — `AugmentationBulkActionBar` 전체가 `canWrite`(=`dialogue:write`) 조건부이므로 자동 상속(기존 코드 300행 `canWrite` 가드).
- `stale`(만료)이거나 `conflictIntent`가 있는 제안도 **영향도 검사에는 포함할 수 있다** — 검사는 읽기 전용이라 승인과 달리 위험이 없다. 단 `stale` 항목은 체크박스 자체가 이미 `disabled`이므로(§4.6 학습고도화 문서 기존 규칙) 자연히 선택에서 제외된다.

### 클릭 흐름

```
체크박스로 6건 선택 → [선택 항목 영향도 검사] 클릭
  → AugmentationImpactSetPickerDialog
     ┌ 영향도 검사 — 대상 TC 세트 선택 ────────────────────────── ✕ ┐
     │ 선택한 제안 6건을 반영했다고 가정하고 실행할 세트를 고르세요.  │
     │ ( ● 전체 회귀 480건 )                                        │
     │ ( ○ 배송 시나리오 회귀 487건 )                                │
     │ ▸ 고급 옵션 ☐ 2단계(외부 AI 검색) 결과까지 확인               │
     ├──────────────────────────────────────────────────────────┤
     │                                        [취소]  [검사 시작]  │
     └──────────────────────────────────────────────────────────┘
  → [검사 시작] → sessionStorage.setItem('validationReturnTo', 현재 URL)
              → POST /chatbots/:id/test-sets/:setId/runs
                 { mode:'OVERLAY_COMPARE', overlaySource:'AUGMENTATION_SUGGESTIONS', suggestionIds:[...6개] }
              → 202 { runId } → navigate(`/chatbots/:id/validation/runs/${runId}`)
  → V4(§4.4.2 OVERLAY_COMPARE 레이아웃)에서 결과 확인
  → "증강 승인 화면으로 돌아가기" → sessionStorage에서 `validationReturnTo` 읽어 원래 `IntentEditModal`로 복귀
     (모달은 라우트를 바꾸지 않는 오버레이이므로, 정확히는 원래 페이지로 돌아간 뒤 그 의도를 다시 열도록
      `validationReturnTo`에 `intentId`도 함께 저장해 자동으로 `IntentEditModal`을 재오픈한다)
```

- **세트가 0개인 챗봇**에서 이 버튼을 누르면 `AugmentationImpactSetPickerDialog` 대신 빈 상태 안내: "아직 TC 세트가 없습니다. 먼저 대화검증에서 세트를 만들어 주세요." + `[대화검증으로 이동]`(새 탭이 아니라 현재 탭 이동 — 증강 작업은 사라지지 않고 `IntentEditModal`은 그대로 열려 있으므로 뒤로가기로 복귀 가능).
- S-1의 "충돌 배지가 붙었던 2건을 선택 해제하고 다시 검사한다"는 **같은 다이얼로그를 다시 여는 것**으로 자연히 지원된다(선택 상태가 `AugmentationSuggestionTable`에 남아 있으므로 재검사는 체크박스만 조정하면 된다).

### 데이터 바인딩

| 컴포넌트 | props |
|---|---|
| `AugmentationImpactCheckButton` | `selectedIds: string[]`, `intentId`, `chatbotId` |
| `AugmentationImpactSetPickerDialog` | `sets: TestCaseSet[]`(가장 최근 사용한 세트를 기본 선택), `suggestionIds`, `onStart(setId, useRag)` |

---

## 4.7 SIM2x — 시뮬레이터 비교 화면의 안내 → 실제 링크로 교체 (FR-V3-2)

### 현재 상태(코드 확인)

`apps/web/src/pages/chatbot-detail/simulator/CompareView.tsx` + `messages.ts`(`simulator.compare.*`)에는 현재 **"대량 회귀 검증은 No.19 범위"라는 문구 자체가 없다**(요구사항 문서 `quality-channel.md` FR-10-29의 서술은 구현 시점에는 코드 문구로 옮겨지지 않았다). 따라서 "교체"가 아니라 **신규 안내 1건을 추가**하는 작업이 된다 — 취지(FR-V3-2)는 동일하게 충족한다.

### 변경 지점

**(1) 입력 영역 하단에 상시 힌트(낮은 강조, 정보성 — 오류 아님)**

```
문장 입력(줄바꿈으로 구분, 최대 20건) — 18/20문장
┌────────────────────────────────────────────────────────────────────┐
│ ...                                                                  │
└────────────────────────────────────────────────────────────────────┘
ⓘ 20문장을 넘는 대량 문장을 엑셀로 한 번에 검증하려면 대화검증에서 TC 세트를 만들어 실행하세요. [대화검증으로 이동]
☐ 달라진 것만 보기                                          [비교 실행]
```

**(2) 20건 초과 시 클라이언트 차단 오류에 링크 추가** — 기존 `inputMaxError`("최대 20문장까지 입력할 수 있습니다.")를 아래로 대체:

```
최대 20문장까지 입력할 수 있습니다. 더 많은 문장을 한 번에 검증하려면 대화검증으로 이동하세요.
[대화검증으로 이동]
```

두 지점 모두 `href="/chatbots/:chatbotId/validation/sets"`(V1로 이동, 새 세트를 만들거나 기존 세트에 방금 쓰던 문장을 옮겨 담도록 유도).

### 메시지 키(신규, 기존 네임스페이스 확장)

```
simulator.compare.bulkVerificationHint: 'ⓘ 20문장을 넘는 대량 문장을 엑셀로 한 번에 검증하려면 대화검증에서 TC 세트를 만들어 실행하세요.'
simulator.compare.bulkVerificationLink: '대화검증으로 이동'
simulator.compare.inputMaxError: '최대 20문장까지 입력할 수 있습니다. 더 많은 문장을 한 번에 검증하려면 대화검증으로 이동하세요.'  // 기존 값 교체
```

기존 테스트(`CompareView.spec.tsx`)가 `inputMaxError`의 정확한 문자열에 의존한다면 `frontend-implementer`가 그 스펙을 함께 갱신한다(코드리뷰 포인트로 별도 기재).

---

## 5. 사용자 인터랙션 흐름 종합 (제출 → 로딩 → 결과, 오류 포함)

### 5.1 TC 세트 생성 → 업로드 → 실행 → 결과 확인 (S-2 전체 경로)

```
V1 [+ 세트 만들기] → 저장 → V2 진입(TC 0건, 빈 상태)
  → [엑셀/CSV 업로드] → BulkImportModal 3단계 → 반영 → V2 표에 487건
  → [실행하기] → RunTriggerDialog → [실행 시작] → 202 → V4 진입(QUEUED)
  → 폴링(aria-live) QUEUED→RUNNING(진행률 갱신)→SUCCEEDED
  → V4 결과 표(기본 필터: 실패) + UnresolvedGroupPanel(있으면)
```

### 5.2 M1 사후 회귀 발견 (S-3)

```
V3 실행 목록 → 어제·오늘 실행 2건 체크 → [비교] → V5
  → 통과 471→462(▼9) + REGRESSED 9건 표
  → EnvFingerprintDiffBanner(있으면 강한 경고)
  → 행별 A/B 매칭 대상 대조 → 이력관리(No.13)에서 원인 확정(외부 이동, 이 문서 범위 밖)
```

### 5.3 M2 사전 회귀 예방 (S-1, ★ 핵심 경로)

```
IntentEditModal → AugmentationPanel → 6건 선택
  → [선택 항목 영향도 검사] → 세트 선택 → 검사 시작 → 202
  → V4(OVERLAY_COMPARE) 진행 배너 → 완료 → 통과471→468(▼3)
  → 회귀 3건 확인(전부 타 의도로 넘어감)
  → "증강 승인 화면으로 돌아가기" → IntentEditModal 재오픈
  → 2건 선택 해제 → 다시 [선택 항목 영향도 검사] → 통과471→471(변화없음)
  → [선택 예문으로 추가](정상 승인 흐름, 기존 §4 그대로)
```

### 5.4 오류 처리 요약표

| 오류 | 발생 화면 | 표시 |
|---|---|---|
| `409 TEST_RUN_IN_PROGRESS` | V2/V3 실행 시작 | 다이얼로그 내 인라인 오류 + "진행 중인 실행 보기" 링크 |
| `400 TEST_SET_EMPTY` | V2 실행 시작(사용함 TC 0건) | `[실행하기]` 자체가 `aria-disabled`(사전 차단, 서버 호출 없음) |
| `409 TEST_CASE_LIMIT_EXCEEDED` | V2 TC 추가/업로드 커밋 | 모달 내 인라인 오류 |
| `400 TEST_RUN_NOT_COMPARABLE` | V5 진입 | 전체화면 오류 안내(§4.5) — 목록으로 복귀 |
| `TARGET_NOT_FOUND`/`AMBIGUOUS_TARGET` | V2 업로드 2단계 | `ImportValidationReportTable` 행 단위 오류(§4.2.2) |
| 보존 정리로 실행 소멸 | V4/V5 딥링크 | "찾을 수 없습니다" + 목록 복귀(EX-V-14) |
| ml-worker 중지(저하 모드) | V4(모든 모드) | 실행은 성공, 상시 배지로 고지(S-7/EX-V-1) — **오류로 취급하지 않는다** |

---

## 6. 권한별 화면 요소 (VIEWER = `simulation:read`만, EDITOR/ADMIN = `simulation:write` 포함)

| 요소 | VIEWER | EDITOR/ADMIN |
|---|---|---|
| V1~V5 조회, CSV 내보내기 | 표시 | 표시 |
| `[+ 세트 만들기]`/이름변경/삭제 | **렌더 안 함** | 표시 |
| `[+ TC 추가]`/편집/삭제/일괄비활성 | **렌더 안 함** | 표시 |
| `[엑셀/CSV 업로드]`(커밋 단계) | **렌더 안 함**(dry-run 화면 자체 진입 불가) | 표시 |
| `[실행하기]`/`[취소]`/`[고정]` | **렌더 안 함** | 표시 |
| `AugmentationImpactCheckButton` | **렌더 안 함**(기존 `canWrite` 가드 상속) | 표시 |

API를 직접 호출해도 서버가 `403`(S-13, AC-V4-5) — 화면은 방어의 **첫 겹**일 뿐이며 서버 권한 검사가 근본 통제다(이 문서는 UI 계층만 기술한다).

---

## 7. `UIUX_준수기준.md` 체크리스트 매핑

| 화면 | §1 색상대비/색상단독금지 | §3 키보드 | §4 버튼 | §5 텍스트입력 | §6 폼컨트롤 | §7 오류메시지 | §8 로딩/비동기 | §9 내비게이션 |
|---|---|---|---|---|---|---|---|---|
| V1 세트목록 | `TestSetCard` 배지 아이콘+텍스트 | 카드/케밥 전체 Tab 순회 | "세트 만들기" 동사형, 44×44px | — | — | 이름 중복 인라인 오류(§UIUX §7) | `SkeletonCard` | 목록→상세 `<a>` 유사 라우팅 |
| V2 세트상세 | `JudgmentBadge`(§3.3) 아이콘+색+텍스트 3중 | 표 행 이동·펼침 키보드 가능(NFR-VA3) | 실행/업로드/추가 전부 동사형, 상한 도달 시 `aria-disabled`+사유 | TC 질문 입력 1~1,000자 실시간 잔여글자수(§5), 붙여넣기 제한 없음 | 기대유형 라디오(단일선택, §6), 사용함 체크박스 | 대상 삭제 경고, 업로드 오류 행별 원인+해결(§7) | 실행중 배너 진행률+`aria-live`(§8) | 세트↔실행이력 링크 `<a href>` |
| V3 실행목록 | 상태배지 아이콘+텍스트 | 체크박스 다중선택 키보드 | 취소/고정/새실행 44×44px, 연타방지 | — | 세트 필터 셀렉트(단일, §6, 방향키 탐색) | 취소불가 실행 사전 `disabled`+툴팁 | 진행률 `aria-live="polite"`(§8) | 페이지네이션 밑줄+형태(§9) |
| V4 결과상세 | `JudgmentBadge` 4값 3중 구분(§3.3, 특히 UNRESOLVED≠FAIL) | 결과 표 키보드 탐색·펼침(NFR-VA3) | "일괄 비활성"/"시뮬레이터로 열기" 동사형 | 참고메모 500자 "판정에 사용되지 않음" 병기(오해방지, §7 취지 확장) | 필터 셀렉트(단일) | UNRESOLVED 원인+해결(일괄비활성 CTA)(§7) | 진행배너 `aria-live`+스켈레톤(§8) | CSV내보내기·시뮬레이터 이동 링크 |
| V5 비교(M1) | `ClassificationBadge` 5분류 색+아이콘+텍스트, `EnvFingerprintDiffBanner` 색상단독아님 | A/B 표 키보드 탐색, 좁은화면 세로스택 읽기순서 유지(NFR-VA4) | "A/B 바꾸기" 44×44px | — | 필터 셀렉트 | 비교불가 사유 명시(§7) | 스켈레톤(§8) | — |
| A1x 증강확장 | 버튼 위계(secondary) 색상만으로 구분 안 함(아이콘·레이블 병기) | 기존 `AugmentationBulkActionBar` 키보드 순회 상속 | "선택 항목 영향도 검사" 동사형, 중복클릭 방지(기존 스피너 패턴 상속) | — | — | 세트 0건 시 대안 CTA(§7) | — | 세트선택 다이얼로그→V4 이동 |
| SIM2x 안내 | 힌트 텍스트, 정보성(파랑) — 오류(빨강)와 색상 구분 | 링크 `<a href>` Tab 접근 | — | — | — | 20건 초과 오류에 대안 링크 병기(§7) | — | "대화검증으로 이동" 링크 |

공통: 신규/변경 화면 **axe 스캔 대비 위반 0건**(NFR-VA5), 모든 신규 버튼은 **44×44px 이상 터치 영역**(§4), 모든 폼은 **레이블 필수**(플레이스홀더 대체 금지, §5).

---

## 8. 반응형 고려사항

1. **A/B·좌우 비교 레이아웃**(V4 M2, V5 M1)은 `quality-channel-ui-spec.md` §4.3 규칙을 **그대로** 따른다 — 데스크톱(≥1024px) 2단, 그 미만은 세로 스택(읽기 순서 A→B 고정, FR-V3-12/NFR-VA4). 새 브레이크포인트를 정의하지 않는다.
2. **TC 표/결과 표**(V2/V4/V5)는 열이 많은 표이므로 모바일에서 `dialogue-design-ui-spec.md` §9(§`ImportValidationReportTable` 반응형 규칙)를 재사용 — 가로 스크롤 컨테이너 + 헤더 `position: sticky`. 카드형으로 재구성하지 않는다(행 번호·열 대응관계 유지가 데이터 정합성 확인에 필수이기 때문 — 근거 동일).
3. **`ValidationShell` 서브내비**(TC 세트 | 실행 이력)는 `StatsShell`과 동일하게 항목 2개뿐이므로 태블릿 이하에서도 줄바꿈 없이 한 줄 유지(별도 접힘 로직 불필요).
4. **`TabNav` 자체의 반응형**은 §1.4의 그룹 구조 변경만으로 기존 규칙(`quality-channel-ui-spec.md` §2.4 — 태블릿 그룹 단위 줄바꿈, 모바일 바텀시트 드롭다운)이 그대로 적용된다. "검증" 그룹이 3항목이 되어도 그룹 경계 기준 줄바꿈이라 어색한 절단이 생기지 않는다.
5. **`RunTriggerDialog`/`AugmentationImpactSetPickerDialog`** 등 다이얼로그류는 기존 `Modal` 컴포넌트의 반응형 규칙(좁은 화면 전체폭, 포커스 트랩)을 그대로 상속한다 — 신규 모달 반응형 규칙을 만들지 않는다.
6. **진행률 배너**(V2/V3/V4)는 좁은 화면에서 진행률 바 아래로 취소 버튼이 줄바꿈되되, 버튼 44×44px 최소 터치 영역은 항상 유지한다.

---

## 9. Out of scope / 재검토 트리거 (이 문서 범위에서 보류)

| 항목 | 사유 | 재검토 트리거 |
|---|---|---|
| 미응답 큐 → TC 승격 화면(P-3) | backend 18개 API에 해당 경로 없음, `system-architect` PM 확정 사항에 미기재 | P-3이 별도로 확정되는 시점 |
| `overlaySource: 'INLINE'` 화면 진입점 | 사용 필요성 미확인, API는 이미 열려 있음(§0-4) | 관리자가 임의 오버레이로 대량 비교가 필요하다는 요구가 실제로 접수될 때 |
| 실행 결과의 통계 대시보드 편입 | 요구사항 §9와 동일 판단 상속(No.14 지표 체계와 혼동 위험) | TC 세트가 정착한 뒤 |
| 여러 세트 동시 비교(3-way 이상) | M1/M2 모두 2계열(A/B) 전제 — API도 `baseRunId`/`targetRunId` 2개뿐 | API가 다자간 비교를 지원하게 될 때 |
| "검증" 그룹이 4항목 이상으로 늘어날 경우의 셸 재구성 | 이번 결정(§1.3)으로 "검증" 그룹은 3항목까지 늘었다 — 다음 그룹이 4번째를 요구하면 `ValidationShell`처럼 **해당 신규 그룹 자체를 셸로 만드는 패턴**을 다시 적용할지, 아니면 "검증" 그룹 전체를 셸로 승격할지 재검토가 필요 | "검증" 그룹에 4번째 최상위 탭 요구가 들어올 때 |

---

## 10. 다음 단계 인계

| 에이전트 | 인계 내용 |
|---|---|
| **`backend-implementer`** | 본 문서가 전제하는 API 계약(설계서 §9, 18개 핸들러) 그대로 구현. 특히 V4의 이중 레이아웃 분기가 `TestRun.mode`/`overlaySource` 값에 정확히 의존하므로 응답 스키마가 §3(`validation.ts`)와 정합해야 한다. |
| **`frontend-implementer`** | 구현 순서 권고: ① `MESSAGES.validation.*`/`MESSAGES.detail.tabValidation` 상수 + `TabNav.tsx` 링크 1개 추가 + `ValidationShell` 골격(리다이렉트만) → ② V1 세트 목록(CRUD) → ③ V2 세트 상세(TC CRUD) → ④ `TestCaseImportModal`(`BulkImportModal` 4번째 소비자) → ⑤ `RunTriggerDialog` + V3 실행 목록 + 폴링 → ⑥ V4 `SINGLE` 레이아웃(`JudgmentBadge`/`UnresolvedGroupPanel`) → ⑦ V4 `OVERLAY_COMPARE` 레이아웃(`RunCompareView` 골격) → ⑧ V5(`RunCompareView` 재사용 + `ClassificationBadge`/`OnlyInOneSection`) → ⑨ A1x `AugmentationImpactCheckButton`(§4.6) → ⑩ SIM2x 안내 링크(§4.7, 마지막 — 다른 화면이 먼저 존재해야 링크 대상이 유효하다). `simulation:write` 기준으로 버튼 가시성을 일괄 적용(§6). |
| **`test-automation`** | UI 단위 검증 대상: `JudgmentBadge`의 `UNRESOLVED`≠`FAIL` 시각 구분(axe 대비 포함) · 진행률 `aria-live` 발화 확인 · V4 이중 레이아웃 분기(`mode` 값별 스냅샷) · A1x 버튼이 `stale`/`conflictIntent` 항목 선택 여부와 무관하게 동작하는지 · VIEWER 계정으로 5개 뷰 전체를 렌더해 쓰기 버튼 렌더 0건 확인(S-13 UI 계층). |
