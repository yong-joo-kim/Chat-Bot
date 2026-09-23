# 챗봇 복원/버전 이력관리 (No.25) — 화면 설계서

> **대상 기능**: No.25 챗봇 복원/버전 이력관리 — 전부 관리자 콘솔(`apps/web`) 기능이며 `apps/widget`은 건드리지 않는다.
> **입력 문서**: `docs/requirements/version-history.md`(J-1~J-14, FR-0-68~77, FR-H1~H4-\*, NFR-HP/HS/HA/HM, AC-H1~H4, S-1~S-12, EX-H-\*), `docs/02-spec/version-history-설계.md`(§1~§20, API 12개, Prisma 3테이블, 신규 `ApiErrorCode` 9종, `autoSnapshot` 선택 필드, `acknowledgeActive`/`expectedCurrentHash`), `docs/02-spec/decisions/ADR-0031`(ID 보존 차이 적용 복원)
> **준수 기준**: `docs/03-design/UIUX_준수기준.md`(전 항목, 특히 §1 파괴적 동작 확인·색상단독금지, §3 키보드, §4 버튼, §7 오류메시지, §8 로딩/비동기, §9 내비게이션)
> **재사용 대상**: `validation-regression-ui-spec.md`(§3.3 판정류 고정 시각 언어 패턴, §1 정보구조 판단 방식, `JudgmentBadge`류 컴포넌트 관행), `learning-augmentation-ui-spec.md`(§2 `ProposalContainer`/제안-자산 분리 톤 — 이 그룹은 재사용하지 않지만 안내 문구 톤을 계승), `dialogue-design-ui-spec.md`(§4.4 `BulkImportModal` 3단계 패턴 — `autoSnapshot` 안내 삽입 지점), `stats-learning-ui-spec.md`(`BulkResolveModal` 하단 상시 안내 패턴)
> **실제 코드 확인**: `apps/web/src/pages/chatbot-detail/TabNav.tsx`(9라우트·4그룹 — 운영3/설계1/검증3/배포2), `apps/web/src/constants/messages.ts`(`MESSAGES.detail.*`/`MESSAGES.auditLogs.*` 확인), `apps/web/src/components/`(`Modal`/`ConfirmDialog`/`SeverityBadge`/`JudgmentBadge`/`Pagination`/`KebabMenu`/`ProposalContainer`/`CopyButton` 등)
> **작성**: ui-designer · 2026-09-23 · **다음 단계**: `backend-implementer`(설계서 §2~§16 구현 후) → `frontend-implementer`
> **범위 경계**: React 컴포넌트 실제 코드는 작성하지 않는다. `apps/widget`은 이 그룹과 무관하다(전부 관리자 콘솔).

---

## 0. 전제와 연계 확인

1. **API·데이터 스키마는 설계서 기준으로 아직 구현되지 않은 확정 계약이다.** `packages/shared-types/src/version.ts`(설계서 §3) — `ChatbotVersionListItemSchema`/`ChatbotVersionDetailSchema`/`RestorePreviewResponseSchema`/`RestoreResponseSchema`/`AutoSnapshotOutcomeSchema` 등 — 는 **아직 코드에 없다**. `backend-implementer`가 설계서대로 구현한 뒤 본 문서 기준으로 화면을 만든다(선행 그룹들과 동일한 전제).
2. **기존 9개 라우트는 하나도 바꾸지 않는다.** 현재 `TabNav.tsx`(실제 코드 확인)는 `{dashboard, stats, settings, dialogue, answer-settings, simulator, validation, skin, channels}` 9개 라우트를 4개 그룹(운영3·설계1·검증3·배포2)으로 렌더한다. 이 문서는 **신규 라우트만** 추가한다.
3. **`packages/dialogue-engine` 변경 0건**(FR-0-68) — 이 그룹은 엔진을 호출하지 않으며 화면도 엔진 산출물을 직접 그리지 않는다(대화 자산의 **정적 스냅샷**만 다룬다).
4. **부분 복원 화면은 만들지 않는다**(P-3, J-4) — 복원은 항상 "스냅샷 범위 전체 교체"다. 화면에서 "이 항목만 되돌리기" 버튼을 제공하지 않으며, 대신 §4.4(내용 보기)·§4.3(차이 보기)에서 과거 값을 **복사**해 현재 편집 화면에 붙여 넣는 경로를 제공한다(J-4의 1차 우회 경로).
5. **감사로그(No.13) 링크는 `audit:read` 보유자에게만** 렌더한다. 미보유자에게는 링크도 건수도 존재를 노출하지 않는다(FR-H2-3, NFR-HS4와 같은 톤).
6. **`autoSnapshot`은 선택 필드다.** 임포트 커밋·증강 승인·학습현황 일괄 반영 응답에 이 필드가 없으면(구버전 서버 등) 해당 화면은 자동 저장 안내를 **아무것도 표시하지 않는다**(에러로 취급하지 않는다).
7. **일괄 삭제 3종(의도/키워드/FAQ)은 `204 No Content`를 유지한다**(§20 D-7, §19 L-3) — 커밋과 달리 자동 스냅샷 성공/실패를 화면에 알릴 방법이 없다. 이 문서는 그 한계를 감추지 않고 **사전 고지 문구**로 대신한다(§4.6.4).
8. **신규 화면의 모든 한국어 문구는 `apps/web/src/constants/messages.ts`에 `MESSAGES.versions.*` 네임스페이스로 상수화**한다. 탭 라벨은 신규 키 `MESSAGES.detail.tabVersions`를 추가한다. 기존 화면(임포트 완료·증강 승인·학습현황 일괄반영) 확장분은 **해당 화면의 기존 네임스페이스**(`MESSAGES.dialogue.bulkImport.*`/`MESSAGES.augmentation.*`/`MESSAGES.learning.*`)에 `autoSnapshot*` 키를 추가한다(SIM2x 선례와 동일 패턴).
9. **데이터 바인딩 기준 스키마**는 설계서 §3(`version.ts`)·§10(API 계약 12개)·§7(차이 계산 필드 규칙)·§8(복원 미리보기/확정 응답)다.
10. **신규 권한 0종**(P-5) — 조회 `dialogue:read`, 저장/라벨/고정/삭제 `dialogue:write`, **복원 `dialogue:write` AND `chatbot:write`**, 감사 건수 `audit:read`. 화면은 `can()` 조합만으로 버튼을 렌더하며, 두 권한 AND는 프런트에서 `can('dialogue:write') && can('chatbot:write')`로 판정한다(서버가 최종 통제).

---

## 1. 정보구조 판단 — 신규 최상위 탭 1개("버전 이력"), "운영" 그룹에 배치

### 1.1 현재 상태 확인 (코드 근거)

`apps/web/src/pages/chatbot-detail/TabNav.tsx`(실제 코드)는 이미 **9개 라우트, 4개 시각적 그룹**이다(`validation-regression-ui-spec.md`가 검증 그룹에 "대화검증"을 3번째로 추가한 결과가 반영돼 있다):

| 그룹 | 포함 탭(현재) |
|---|---|
| 운영 | 대시보드 · 통계(`StatsShell` — 서브내비: 기본 통계\|학습현황) · 기본설정 |
| 설계 | 대화설계(`DialogueShell` — 좌측 레일: 노드\|의도\|동음이의어\|컨텍스트\|FAQ) |
| 검증 | AI 답변 설정 · 응답 테스트 · 대화검증(`ValidationShell`) |
| 배포 | 스킨/임베드 · 채널 |

이 그룹이 10번째 탭을 요구하는 첫 그룹이다.

### 1.2 검토한 대안

| 안 | 내용 | 판정 |
|---|---|---|
| A. `DialogueShell`의 좌측 레일에 6번째 항목("버전 이력")으로 추가 | 라우트 신설 0건(서브라우트만 추가) | **기각** — `DialogueShell`의 레일은 **편집 가능한 자산 종류 목록**(노드·의도·동음이의어·컨텍스트·FAQ)이라는 일관된 의미를 가진다. 버전 이력은 자산 종류가 아니라 **그 자산들 + 답변설정 + 표시설정을 아우르는 시점 스냅샷**(J-1)이다. 레일에 섞으면 "이것도 편집 가능한 자산 종류인가"라는 오인을 유발하고, 답변설정(`AnswerSettingsTab`, 검증 그룹)·표시설정(`SettingsTab`, 운영 그룹)의 변경 이력까지 다루는 이 화면의 **범위가 탭 위치와 불일치**한다. |
| B. `StatsShell`의 서브내비에 3번째 항목("버전 이력")으로 추가 | 라우트 신설 0건(서브라우트만 추가) | **기각** — `StatsShell`의 두 서브내비(기본 통계·학습현황)는 **"이 챗봇이 어떻게 쓰이고 있는가"를 관측하는 지표 화면**이라는 공통 멘탈모델을 갖는다(`stats-learning-ui-spec.md` §1.3/§1.5 판단 기준 — "두 화면이 실제로 서로를 호출하고, 사용자의 멘탈모델상 하나의 작업 영역"). 버전 이력은 지표 관측이 아니라 **백업·복원**이며, "학습현황을 보다가 자연스럽게 버전 이력으로 이어지는" 호출 관계가 없다. |
| C. `SettingsTab`(기본설정)을 셸로 전환하고 그 안에 서브내비로 추가 | 8탭 유지(그룹 재구성) | **기각** — `quality-channel-ui-spec.md` §2.1·`validation-regression-ui-spec.md` §1.2(안 B)가 이미 두 차례 같은 근거로 기각한 패턴이다: "기존 라우트 안정성이 탭 개수 최소화보다 우선한다." `/settings`는 이미 **구현·배포된 살아있는 단일 폼 라우트**이며 지금 셸로 바꾸면 이번 그룹과 무관한 화면의 회귀 위험만 늘어난다. |
| D. 신규 최상위 탭 1개("버전 이력") 추가, **셸 없이 단일 목적지**(목록 화면 + 드릴다운 라우트 2개 + 모달 1개) | 9 → **10탭**, "운영" 그룹 3 → 4항목 | **채택** |

### 1.3 D를 채택하는 근거

1. **독립적으로 재방문하는 1급 목적지다.** "지난주 배포가 잘못됐으니 되돌리자"는 요구는 특정 자산 편집 작업의 연장이 아니라, **그 자체로 진입하는 목적**이다(`nlu-rag-answering-ui-spec.md` §2.1-A·`validation-regression-ui-spec.md` §1.3-1과 동일한 채택 기준).
2. **셸(서브내비)이 필요 없을 만큼 단순한 정보 위계다.** No.19/20(검증 그룹)이 5개 뷰 + 2개 작업 흐름이라 셸이 필요했던 것과 달리, 이 그룹은 **목록 1개가 곧 진입점**이고(§2), 차이 보기·내용 보기는 목록에서 갈라지는 **드릴다운**이지 나란히 재방문하는 두 축이 아니다. `요구사항 §5.4`(architect 판단 항목)도 "정보 구조(최상위 탭 vs 서브내비)는 ui-designer 판단"이라 명시했고, 이 문서가 그 판단을 내린다.
3. **"운영" 그룹에 두는 이유**: 자동 스냅샷 트리거 8지점(임포트 커밋 3·일괄 삭제 3·증강 승인 1·학습현황 일괄 반영 1)이 "설계" 그룹(`DialogueShell`의 의도/키워드/FAQ)과 "운영" 그룹(`StatsShell`의 학습현황)에 걸쳐 있고, 스냅샷 범위 자체도 대화 자산 + 답변설정(검증 그룹) + 표시설정(운영 그룹의 기본설정)을 가로지른다(J-1). 즉 이 기능은 **어느 한 작업 그룹에도 속하지 않는 횡단 관심사**다. "대시보드·통계·기본설정"이 이미 "이 챗봇을 운영하며 참고·관리하는 화면"이라는 공통 성격을 가지므로, "백업하고 되돌리는" 운영 안전망도 같은 그룹이 가장 자연스럽다 — **제작(설계)도 검증도 배포도 아닌, 운영자가 사고 직후 찾는 화면**이라는 점에서 대시보드와 같은 사용자 맥락에 있다.
4. **그룹 폭이 기존 최대치를 넘지 않는다.** "운영" 그룹이 3 → 4항목이 되어도 이미 "검증" 그룹이 3항목이며, 태블릿 줄바꿈 시에도 그룹 경계가 유지되는 기존 규칙(`quality-channel-ui-spec.md` §2.4)이 그대로 적용된다 — 반응형에 새 예외가 필요 없다.
5. **탭 레이블이 카탈로그 원문과 정합한다.** "버전 이력"은 No.25 원문("업데이트 히스토리 조회, 이전 버전 즉시 롤백")과 직접 대응하며, "대화검증"(No.19/20, 회귀 테스트)과 성격이 명확히 달라 사용자가 혼동하지 않는다.

### 1.4 결과 — `TabNav` 확장 (기존 파일 1곳만 수정)

```html
<div class="tab-nav-group" role="group" aria-label="운영">
  <a href="/chatbots/:id/dashboard">대시보드</a>
  <a href="/chatbots/:id/stats">통계</a>
  <a href="/chatbots/:id/settings">기본설정</a>
  <a href="/chatbots/:id/versions" class="tab-nav-link">버전 이력</a>   <!-- [신규] -->
</div>
```

`MESSAGES.detail.tabVersions = '버전 이력'` 1개 키만 추가한다. 서브내비 셸을 만들지 않으므로 `MESSAGES.detail.tabGroupOps` 등 기존 그룹 키는 무변경이다.

### 1.5 라우트 표

```
/chatbots/:chatbotId/versions                                    → L1 버전 목록(+ 행 확장으로 메타 상세, FR-H2-1~5)
/chatbots/:chatbotId/versions/:versionId                         → L1과 동일 페이지, 해당 행을 펼친 채로 진입(딥링크용 — 목록 재조회 없이 확장 상태만 다름)
/chatbots/:chatbotId/versions/:versionId/diff?against=current|<versionId2>  → L2 차이 보기(3단계, FR-H2-6~12)
/chatbots/:chatbotId/versions/:versionId/content?kind=&q=&page=  → L3 내용 보기(읽기 전용, FR-H2-12)
```

복원 미리보기/확정(L4)은 **라우트가 아니라 모달 다이얼로그**다(`RunTriggerDialog` 선례와 동일 — 대상 버전이 이미 화면 문맥에 있어 라우트 전환이 필요 없고, `expectedCurrentHash` 같은 상태를 URL에 노출할 이유가 없다). L1 행 액션·L2/L3 상단 액션 어디서나 열 수 있다.

이 3개 라우트(+ 목록 자체)가 요구사항 FR-H4-1의 4개 화면(① 목록 ② 차이 보기 ③ 내용 보기 ④ 복원 대화상자)에 정확히 대응한다.

---

## 2. 화면 목록 및 라우트 요약

| ID | 화면명 | 라우트 | 진입 경로 | 권한(조회/쓰기) |
|---|---|---|---|---|
| L1 | 버전 목록(+ 행 확장 메타 상세) | `/chatbots/:chatbotId/versions` | `TabNav` "버전 이력" | `dialogue:read` / `dialogue:write` |
| L2 | 차이 보기(요약→목록→상세) | `/chatbots/:chatbotId/versions/:versionId/diff?against=` | L1 행의 "현재와 비교"/"버전과 비교" | `dialogue:read` |
| L3 | 내용 보기(읽기 전용) | `/chatbots/:chatbotId/versions/:versionId/content` | L1 행의 "내용 보기" | `dialogue:read` |
| L4 | 복원 미리보기/확정 대화상자 | (모달, 비라우트) | L1/L2/L3 어디서나 "이 버전으로 복원" | `dialogue:write` **+** `chatbot:write` |
| E1 | 임포트 완료 화면(D2c/D5b) 확장 | `dialogue-design-ui-spec.md` D2c/D5b(기존 라우트, 변경 없음) | `BulkImportModal` 3단계 | 기존과 동일 |
| E2 | 일괄 삭제 확인 다이얼로그 확장 | `dialogue-design-ui-spec.md`(기존, 변경 없음) | `BulkDeleteConfirmDialog` | 기존과 동일 |
| E3 | 증강 제안 목록 확장 | `learning-augmentation-ui-spec.md` A1(기존, 변경 없음) | `AugmentationPanel`/`AugmentationBulkActionBar` | 기존과 동일 |
| E4 | 학습현황 일괄 반영 확장 | `stats-learning-ui-spec.md` L1(기존, 변경 없음) | `BulkResolveModal` | 기존과 동일 |

---

## 3. 공통 UI 요소

### 3.1 재사용(변경 없음)

`Modal`/`ConfirmDialog`(기본 포커스 `[data-autofocus="cancel"]` — NFR-HA2와 정확히 일치), `Toast`, `InlineFieldError`, `Skeleton`(`SkeletonRow`), `EmptyState`, `ErrorState`, `SeverityBadge`(ERROR/WARNING/INFO — 3중 구분), `Pagination`, `KebabMenu`, `CopyButton`(내용 보기·차이 상세의 "과거 값 복사" 경로), `ArchivedBanner`(`pages/chatbot-detail/ArchivedBanner.tsx`), `IndexStatusBadge`(`answer-settings/`, 복원 후 재색인 진행 표시 재사용).

### 3.2 신규 컴포넌트

| 컴포넌트 | 용도 | 배치 |
|---|---|---|
| `CurrentStateRow` | L1 최상단 "현재" 행(저장되지 않은 변경 유무) | `pages/chatbot-detail/versions/VersionListPage.tsx` |
| `VersionListPage` | L1 본체 | 동일 |
| `VersionRow` | 버전 1행(접힌 상태) | 동일 |
| `VersionRowDetail` | 행 확장 시 메타 상세(건수·무결성경고·트리거 문맥·라벨/메모 편집·고정) | 동일 |
| `RestoreEventDivider` | "09:51 편집자A가 v27로 복원했습니다" 구분선(FR-H2-4) | 동일 |
| `VersionTriggerBadge` | 트리거 6종 고정 배지(§3.3) | `components/` 공용 |
| `CreateVersionButton` / `CreateVersionModal` | 수동 저장(라벨·메모) | `versions/` |
| `VersionTriggerFilterBar` | 수동\|자동\|복원백업 필터 칩 | 동일 |
| `AuditCountDisclosure` | 행 확장 시 "감사 레코드 N건" 지연 조회(`audit:read`만) | 동일 |
| `VersionDiffPage` | L2 본체 | `versions/diff/VersionDiffPage.tsx` |
| `DiffTargetSelector` | "비교 대상: 현재 \| 다른 버전 선택" | 동일 |
| `DiffSummaryBar` | 9종 요약(추가/삭제/변경 건수) | 동일 |
| `ChangeKindBadge` | `ADDED`/`REMOVED`/`MODIFIED` 고정 배지(§3.3) | `components/` 공용 |
| `DiffItemTable` | 항목 목록(종류·변경유형 필터, 페이지네이션) | `versions/diff/` |
| `DiffItemDrawer` | 항목 클릭 시 우측 드로어 — 필드 단위 전/후(`VALUE_SET`/`REF_SET`/`STRUCT`/`SCALAR`) | 동일 |
| `RecreatedHintBadge` | "같은 이름으로 재생성됨" 힌트 + 상대 항목 이동 링크 | 동일 |
| `VersionContentPage` | L3 본체 | `versions/content/VersionContentPage.tsx` |
| `ContentKindTabs` | 8종 자산 탭(의도·키워드·동음이의어·컨텍스트·노드·FAQ·답변설정·표시설정) | 동일 |
| `ContentItemTable` / `ContentItemRow` | 종류별 읽기 전용 표, 텍스트 필드에 `CopyButton` 병기 | 동일 |
| `RestoreDialog` | L4 본체(미리보기 자동 로드 → blockers/warnings → 확정) | `versions/restore/RestoreDialog.tsx` |
| `RestoreBlockerList` | 원인 + 해결 방법(UIUX §7) | 동일 |
| `RestoreWarningList` | 경고 11종(§4.5.3) | 동일 |
| `AcceptedSuggestionsWarningBanner` | P-8 강조 배너(`ACCEPTED_SUGGESTIONS_NOT_RESUGGESTED`) | 동일 |
| `ActiveChatbotAcknowledgeCheckbox` | P-7 — `ACTIVE`일 때만 렌더, `acknowledgeActive` 바인딩 | 동일 |
| `RestoreConfirmButton` | 라벨 "v27로 복원"(대상 명시, FR-H4-4) | 동일 |
| `RestoreResultPanel` | 복원 완료 패널(백업 번호·재색인 진행·TC 검증 링크·복원의 복원 안내) | 동일 |
| `AutoSnapshotNotice` | 기존 화면(E1/E3/E4) 확장용 공용 안내 조각(`status`별 4분기) | `components/` 공용 |
| `AutoSnapshotPreNotice` | 기존 화면(E1/E2/E3) 상단 "자동 저장됩니다" 사전 고지 조각 | `components/` 공용 |

### 3.3 고정 시각 언어 — 이 그룹 전체에서 재사용

#### (1) `VersionTriggerBadge` — 트리거 6종

| `trigger` | 그룹 | 배지 텍스트 | 아이콘 | 비고 |
|---|---|---|---|---|
| `MANUAL` | 수동 | "수동 저장" | 👤(텍스트로도 "수동") | — |
| `BEFORE_IMPORT` | 자동 | "자동 · 엑셀 임포트 직전" | ⚙ | `triggerContext.resourceType` 병기("의도"/"키워드"/"FAQ") |
| `BEFORE_BULK_DELETE` | 자동 | "자동 · 일괄 삭제 직전" | ⚙ | 〃 |
| `BEFORE_AUGMENT_ACCEPT` | 자동 | "자동 · 증강 승인 직전" | ⚙ | `triggerContext.targetId`(의도명 해석) 병기 |
| `BEFORE_LEARNING_BULK_APPLY` | 자동 | "자동 · 학습현황 일괄 반영 직전" | ⚙ | — |
| `BEFORE_RESTORE` | 복원 백업 | "복원 백업 · v{restoredFromVersionNo}로 복원하기 전 상태" | ↺ | FR-H2-4 |

색상은 그룹별로만 옅게 구분(수동=파랑 계열, 자동=회색 계열, 복원백업=주황 계열)하되 **텍스트 라벨이 항상 함께 있어 색상 단독 표현이 아니다**(UIUX §1).

#### (2) `ChangeKindBadge` — 차이 변경유형 3종 (FR-H4-7, NFR-HA1)

| `change` | 기호 | 텍스트 라벨 | 색상(4.5:1 이상) |
|---|---|---|---|
| `ADDED` | `+` | "추가" | 초록 계열 |
| `REMOVED` | `−` | "삭제" | 빨강 계열 |
| `MODIFIED` | `~` | "변경" | 노랑/주황 계열 |

`JudgmentBadge`(validation-regression, `TestCaseResultKind`)와 동일한 패턴(아이콘+텍스트+색상 3중)을 차용하되 **타입이 다르므로 별도 컴포넌트**로 만든다(`VersionDiffChangeKind` 전용, 재사용 아님 — 도메인 유니온이 다르면 별도 컴포넌트를 둔다는 이 코드베이스의 기존 관행).

---

## 4. 화면별 설계

## 4.1 L1 — 버전 목록 `/chatbots/:chatbotId/versions`

### 목적
챗봇의 버전(수동+자동 스냅샷)을 최신순으로 조회하고, 수동 저장·라벨/메모 편집·고정·삭제·차이 보기·내용 보기·복원 진입점을 제공한다.

### 상태별 UI

| 상태 | UI |
|---|---|
| 로딩 | `SkeletonRow` × 6 |
| 빈 상태(버전 0건) | `EmptyState`: "아직 저장된 버전이 없습니다." + "대량 작업(엑셀 임포트·일괄 삭제·증강 승인·학습현황 일괄 반영) 전에는 자동으로 저장됩니다." + `[지금 버전 저장]`(FR-H4-9) |
| 정상 | §4.1.2 레이아웃 |
| `ARCHIVED` 챗봇 | `ArchivedBanner`(재사용) 상단 노출. 목록·차이·내용 조회는 허용, `[버전 저장]`/라벨편집/고정/삭제/복원 버튼은 `aria-disabled`(§10.3 판단 — `CHATBOT_ARCHIVED`는 조회를 막지 않는다) |
| 딥링크(`/:versionId`)로 진입 시 대상 버전이 정리로 사라짐 | "요청한 버전을 찾을 수 없습니다 — 보존 기간이 지나 정리되었을 수 있습니다." + 목록으로 돌아가기(자동 정리가 대상일 수 있음을 안내) |

### 레이아웃 (데스크톱)

```
┌ 버전 이력 ──────────────────────────────────────────────── [+ 버전 저장] ┐
│ 자동 30 · 수동 30 · 고정 10건까지 보존됩니다                              │
│ 필터: [ 전체 ▾ ] (수동 | 자동 | 복원 백업)                                │
├────────────────────────────────────────────────────────────────────────┤
│ 현재 · 최신 버전(v14)과 동일 — 저장할 필요가 없습니다                     │
├────────────────────────────────────────────────────────────────────────┤
│ 09:51 편집자A가 v27로 복원했습니다                                        │
│ ↺ v28  복원 백업 · v27로 복원하기 전 상태   09:51 · 편집자A               │
│         의도42·키워드118·동음5·컨텍스트3·노드30·FAQ95·답변설정○ · 1.8MB   │
│         [라벨 없음]                                    📌  [⋮]           │
│         [현재와 비교] [다른 버전과 비교] [내용 보기] [이 버전으로 복원]      │
├────────────────────────────────────────────────────────────────────────┤
│ ⚙ v27  자동 · 증강 승인 직전(환불규정문의)   09:42 · 편집자A               │
│         의도42·키워드118·… · 1.8MB   ⚠ 참조 경고 2건                      │
│         "4월 캠페인 전" 메모 있음                     📌  [⋮]             │
│         [현재와 비교] [다른 버전과 비교] [내용 보기] [이 버전으로 복원]      │
│         ▸ (audit:read 보유 시) 다음 버전까지 감사 레코드 6건 → [이력관리]  │
├────────────────────────────────────────────────────────────────────────┤
│                                                        ◀ 1 .. 3 ▶       │
└────────────────────────────────────────────────────────────────────────┘
```

### 컴포넌트 분해 및 데이터 바인딩

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `VersionListPage` | `chatbotId` |
| `CurrentStateRow` | `GET .../versions/current` → `{ contentHash, counts, latestVersion, hasUnsavedChanges }`. `hasUnsavedChanges===false`면 "최신 버전(v{n})과 동일 — 저장할 필요가 없습니다", `true`면 "저장되지 않은 변경이 있습니다" + `[+ 버전 저장]` 강조 |
| `VersionTriggerFilterBar` | `triggerGroup: 'MANUAL'\|'AUTO'\|'RESTORE_BACKUP'` — 단일 셀렉트(UIUX §6), 값 변경 즉시 재조회(자동 제출은 셀렉트라 허용 — 목록 필터는 "폼 제출"이 아니라 즉시 반영 뷰 전환이므로 §6 "값 변경만으로 폼 자동 제출 금지"의 예외로 다룬다. 단 필터 변경을 `aria-live="polite"`로 결과 건수 안내) |
| `VersionRow` | `{ id, versionNo, trigger, triggerLabel, triggerContext, counts, sizeBytes, integrityWarningCount, label, memo, pinned, restoredFromVersionNo, createdByEmail, createdAt }` |
| `RestoreEventDivider` | `trigger==='BEFORE_RESTORE'`인 행 **바로 위**에만 렌더. `{restoredByEmail: createdByEmail, restoredFromVersionNo, createdAt}` |
| `VersionRowDetail`(행 확장) | `GET .../versions/:versionId` → counts 세부, `integrityWarnings[]`(있으면 "⚠ 참조 경고 N건 — 캡처 당시부터 있던 문제입니다" + 펼침으로 항목 목록), 라벨/메모 인라인 편집(`dialogue:write`), 고정 토글 |
| `AuditCountDisclosure` | `audit:read` 있을 때만 렌더. 행 확장 시 **지연 조회**(`GET .../:versionId/audit-count`) → `{ count, link:{chatbotId,from,to,clamped} }` → "다음 버전까지 감사 레코드 {count}건" + `clamped`면 "(최근 90일로 제한됨)" + `[이력관리에서 보기 ↗]`(`/settings/audit-logs?chatbotId=&from=&to=`, 새 탭 아님) |
| `KebabMenu` | "라벨/메모 편집" · "삭제"(고정 시 `disabled` + 툴팁 "고정 해제 후 삭제할 수 있습니다") |
| `CreateVersionButton`/`CreateVersionModal` | 라벨(≤50자)·메모(≤500자, 둘 다 선택) — §4.1.3 |
| `Pagination` | 재사용 |

### 4.1.1 수동 저장 흐름

```
[+ 버전 저장] → CreateVersionModal(라벨/메모 선택 입력) → 저장
  → 201 { unchanged:false, version }: 목록 최상단(현재 행 아래)에 즉시 추가 + Toast "버전이 저장되었습니다(v15)."
  → 200 { unchanged:true, latestVersionNo, latestVersionId }:
       모달 닫지 않고 안내로 전환 — "직전 버전(v14)과 내용이 같아 새로 저장하지 않았습니다."
       + [v14에 라벨/메모 달기](방금 입력한 라벨/메모를 그대로 v14에 PATCH하는 단축 버튼, AC-H1-2 대응)
  → 422 VERSION_SNAPSHOT_TOO_LARGE: 모달 내 인라인 오류 "저장할 수 없습니다 — 자산 크기가 상한(20MB)을 초과합니다."
```

### 4.1.2 라벨/메모/고정/삭제 흐름

```
행 확장 → 라벨/메모 필드 인라인 편집 → 포커스 아웃 또는 저장 버튼 → PATCH { label?, memo? } → Toast "저장되었습니다."
📌 클릭 → PATCH { pinned: true } → 성공: 배지 전환 / 409 VERSION_PINNED_LIMIT_EXCEEDED: 인라인 오류 "고정은 챗봇당 최대 10건까지 가능합니다."
[⋮] "삭제" → ConfirmDialog(danger=true, 기본 포커스 취소) "이 버전(v{n})을 삭제하시겠습니까? 되돌릴 수 없습니다." → DELETE
  → 409 VERSION_PINNED: (버튼이 이미 disabled라 정상 경로로는 발생하지 않음, 방어) "고정된 버전은 삭제할 수 없습니다. 먼저 고정을 해제해 주세요."
```

---

## 4.2 L2 — 차이 보기 `/chatbots/:chatbotId/versions/:versionId/diff?against=`

### 목적
선택한 버전과 현재(또는 다른 버전)의 차이를 요약 → 항목 목록 → 필드 상세 3단계로 보여준다(FR-H2-6~12).

### 상태별 UI

| 상태 | UI |
|---|---|
| 로딩(요약) | `SkeletonRow` × 3(요약 바) |
| 로딩(목록) | `SkeletonRow` × 6 |
| 정상, 차이 없음(`identical:true`) | 요약 바 전체가 "동일" 상태(모든 건수 0) + 안내 "이 두 시점은 완전히 동일합니다." |
| 대상 버전 `schemaVersion` 미지원 | 전체화면 안내(요약/목록/상세 렌더 안 함) "이 버전은 형식이 오래되어 비교할 수 없습니다(형식 v0). 내용 조회는 가능합니다." + `[내용 보기로 이동]` |
| 교차 챗봇 `versionId`(방어) | `404` → "요청한 버전을 찾을 수 없습니다." + 목록으로 |

### 레이아웃 (데스크톱)

```
┌ v27 차이 보기 ──────────────────────────────────────────── [CSV 내보내기] ┐
│ 비교 대상: [ 현재 ▾ ]  (또는 다른 버전 선택…)                              │
├──────────────────────────────────────────────────────────────────────┤
│ + 의도 1  − 키워드 0  ~ 의도 12   + FAQ 0  − FAQ 3  ~ 노드 1              │
│ 동음이의어 변화없음 · 컨텍스트 변화없음 · 답변설정 변화없음 · 표시설정 변화없음│
│ ⚠ 무결성 경고: 이 버전 2건 · 현재 0건                                    │
├──────────────────────────────────────────────────────────────────────┤
│ 필터: [ 전체 종류 ▾ ]  [ 전체 유형(+/−/~) ▾ ]     검색 [___________]     │
├──────────────────────────────────────────────────────────────────────┤
│ 종류   이름                변경                                          │
│ 의도   환불규정문의         ~ 변경        (예문 +18)                      │
│ FAQ    "배송비 안내"        − 삭제        같은 이름으로 재생성됨 → 이동     │
│ FAQ    "배송비 안내"        + 추가        (재생성, id 다름)               │
├──────────────────────────────────────────────────────────────────────┤
│                                                        ◀ 1 .. 2 ▶       │
└──────────────────────────────────────────────────────────────────────┘
    행 클릭 → 우측 DiffItemDrawer:
    ┌ 환불규정문의 · 의도 · 변경 ───────────────────────────────── ✕ ┐
    │ 예문(집합 차이)                                                │
    │   + "반품하면 환불되나요" (18건 중 1건 표시…더보기)   [복사]     │
    │   − (삭제된 예문 없음)                                         │
    │ 설명(스칼라)                                                   │
    │   변경 전: "환불 절차 안내"  →  변경 후: "환불/반품 절차 안내"    │
    └────────────────────────────────────────────────────────────┘
```

### 컴포넌트 분해

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `VersionDiffPage` | `chatbotId`, `versionId`(base), `against`(쿼리, 기본 `'current'`) |
| `DiffTargetSelector` | `against` 변경 시 재조회(다른 버전 선택 시 같은 챗봇의 버전 목록에서 고르는 콤보박스 — 이미 L1에서 캐시된 목록 재사용 가능) |
| `DiffSummaryBar` | `summary: VersionDiffSummary`(9행) — `ChangeKindBadge` 3종을 종류별로 나열, 값 0인 종류는 "변화없음"으로 흐리게 |
| `DiffItemTable` | `items: VersionDiffListItem[]`(서버 페이지네이션 50행), 컬럼: 종류·이름·`ChangeKindBadge`·`RecreatedHintBadge`(있을 때) |
| `RecreatedHintBadge` | `counterpartId` — 클릭 시 목록에서 상대 항목으로 스크롤/포커스 이동(FR-H2-10, AC-H2-3) |
| `DiffItemDrawer` | 행 클릭 시 `GET .../diff/items/:kind/:itemId?against=` 지연 조회 → `VersionFieldDiffSchema` 판별 유니온 렌더:<br>· `VALUE_SET`: `added[]`(+, 초록 칩)/`removed[]`(−, 빨강 칩)/`reorderedOnly`(1줄 "순서만 변경됨")<br>· `REF_SET`: `added:[{id,name|null}]`/`removed[…]` — `name===null`이면 "(현재 없음)" 회색 텍스트<br>· `STRUCT`: `before`/`after` 정돈된 JSON 블록, 각각 `CopyButton` 병기<br>· `SCALAR`: "변경 전: {before} → 변경 후: {after}" |
| `[이 버전으로 복원]` | 페이지 상단 고정 액션 — `RestoreDialog` 오픈(target=버전, base=현재일 때만 노출. base가 다른 버전이면 숨김 — 복원은 항상 "현재 ← 대상 버전"이다) |

---

## 4.3 L3 — 내용 보기 `/chatbots/:chatbotId/versions/:versionId/content`

### 목적
선택한 버전 시점의 자산을 종류별로 읽기 전용 조회한다 — 부분 복원이 없는 1차의 **"과거 값을 복사해 현재 화면에 붙여 넣는"** 경로(J-4, FR-H2-12).

### 상태별 UI

| 상태 | UI |
|---|---|
| 로딩 | `SkeletonRow` × 8 |
| 정상 | §레이아웃대로 |
| `schemaSupported:false`(구형식) | 상단 배너 "이 버전은 원형 데이터로 표시됩니다(현재 형식으로 변환할 수 없음)." + 항목은 원형 JSON 그대로 |
| 해당 종류 항목 0건 | `EmptyState`: "이 버전에는 {종류}이(가) 없습니다." |

### 레이아웃 (데스크톱)

```
┌ v27 내용 보기 ──────────────────────────────────────────────────────── ┐
│ [ 의도 ] 키워드  동음이의어  컨텍스트  노드  FAQ  답변설정  표시설정     │
├──────────────────────────────────────────────────────────────────────┤
│ 검색 [___________]                                                    │
├──────────────────────────────────────────────────────────────────────┤
│ 이름            설명           예문(52)                                │
│ 환불규정문의     환불 절차 안내   "환불 어떻게 하나요" 외 51건  [복사]     │
│                                                        ◀ 1 .. 2 ▶     │
└──────────────────────────────────────────────────────────────────────┘
```

### 컴포넌트 분해

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `VersionContentPage` | `chatbotId`, `versionId`, `kind`(쿼리, 기본 `'INTENT'`) |
| `ContentKindTabs` | 8종. 각 탭에 건수 배지(§L1의 `counts`를 목록에서 넘겨받아 초기 렌더에 활용, 없으면 탭 자체에서 조회) |
| `ContentItemTable`/`ContentItemRow` | `GET .../content?kind=&q=&page=` — **기존 `IntentSchema` 등 재사용**(설계서 §10.1). 값 배열(예문 등)은 처음 5개만 보여주고 "외 N건 · 전체 보기"로 펼침, 텍스트 필드마다 `CopyButton` 병기(복사 경로) |
| 답변설정 탭 | 행 없음(`null`)이면 "이 버전에는 답변설정이 없습니다(복원 시 기본값이 됩니다)." |
| 표시설정 탭 | `name`/`avatarUrl`/`description`/`skin` 미리보기(`SkinPreviewPanel` 재사용 가능성 — `frontend-implementer` 판단) |

---

## 4.4 L4 — 복원 미리보기/확정 대화상자 (`RestoreDialog`, P-7 세부 확정)

### 진입

L1 행 액션 "이 버전으로 복원", L2/L3 상단 액션 "이 버전으로 복원" → `RestoreDialog(chatbotId, targetVersionId)` 오픈. **오픈 즉시** `POST .../restore/preview`를 자동 호출한다(사용자가 "미리보기 시작" 버튼을 따로 누르지 않는다 — 복원 결정을 위해 미리보기는 항상 선행되어야 하므로 진입 자체가 곧 미리보기 요청이다).

### 상태별 UI

| 상태 | UI |
|---|---|
| 미리보기 로딩 | 다이얼로그 내부 `Skeleton` — "복원 영향을 확인하는 중…"(`aria-live="polite"`) |
| 미리보기 완료, `restorable:true` | §4.4.1 레이아웃 |
| 미리보기 완료, `blockers` 존재(`restorable:false`) | `RestoreBlockerList`만 표시, 확정 버튼 자체가 렌더되지 않고 "확인" 버튼만(닫기) |
| 확정 진행 중 | 확정 버튼이 스피너 + `disabled`(연타 방지), 다이얼로그 `Esc`/배경클릭 비활성(진행 중 이탈 방지) |
| 확정 성공 | 다이얼로그가 닫히고 `RestoreResultPanel`(토스트 아님 — 정보량이 많아 패널로, §4.4.4) + 목록 자동 새로고침 |
| 확정 실패 `409 RESTORE_PREVIEW_STALE` | 다이얼로그 **닫지 않고** 배너 "미리보기 이후 자산이 변경되었습니다. 최신 내용으로 다시 확인합니다." → 자동으로 미리보기 재호출(`aria-live="polite"`로 안내) → 새 diff/blockers/warnings로 갱신, 사용자가 **다시** 확정을 눌러야 진행(자동 재시도 없음, S-5) |
| 확정 실패 `409 RESTORE_BLOCKED_BY_ACTIVE_JOB`(경합) | 위와 동일 갱신 흐름 + blockers 갱신으로 확정 버튼 다시 숨김 |
| 확정 실패 `409 RESTORE_IN_PROGRESS` | 다이얼로그 닫고 Toast "다른 관리자가 이미 이 챗봇을 복원하고 있습니다. 완료 후 다시 시도해 주세요." + 목록 새로고침 |
| 확정 실패 `422 VERSION_SNAPSHOT_TOO_LARGE`(백업 실패) | 다이얼로그 내 오류 배너 "복원 직전 백업 생성에 실패해 복원이 취소되었습니다(자산 크기 초과). 자산 규모를 확인해 주세요." — 자산은 변경되지 않았음을 함께 명시 |
| 확정 실패 `422 VERSION_INTEGRITY_FAILED` | (정상 경로로는 미리보기 blockers가 이미 막음 — 경합 방어) 동일 재확인 흐름 |

### 4.4.1 레이아웃 — 정상(`restorable:true`, `ACTIVE` 챗봇 예시)

```
┌ v27로 복원 ─────────────────────────────────────────────────────── ✕ ┐
│ 대상 버전 이후 변경 34건이 함께 취소됩니다(현재 v14 기준).               │
│                                                                        │
│ + 의도 1  − 키워드 0  ~ 의도 12  + FAQ 0  − FAQ 3  ~ 노드 1             │
│                                                                        │
│ ⚠ 경고                                                                 │
│  · 운영 중인 챗봇입니다 — 복원하면 다음 대화부터 즉시 반영됩니다.        │
│  · ★ 복원으로 제거되는 승인된 예문 18건은 다시 제안되지 않습니다.        │
│  · 활성 TC 20건이 복원 후 '판정 불가'가 됩니다.                         │
│  · 경량 분류기가 삭제됩니다 — 복원 후 재학습이 필요합니다.               │
│  · 표시 설정이 바뀝니다: 스킨.                                          │
│                                                                        │
│ ☐ 이 챗봇은 현재 운영 중입니다. 복원하면 다음 대화부터 즉시 반영됩니다.  │
│    계속하려면 확인해 주세요.                                            │
│                                                                        │
│                                          [취소]      [v27로 복원]      │
└─────────────────────────────────────────────────────────────────────┘
```

- **기본 포커스는 "취소"**(`Modal`의 `initialFocusSelector='[data-autofocus="cancel"]'` 그대로 재사용, FR-H4-4/NFR-HA2).
- **확정 버튼 라벨은 항상 대상 버전 번호를 명시**한다(`"v{targetVersionNo}로 복원"`, 모호한 "확인" 금지, FR-H4-4).
- **체크박스는 `warnings`에 `ACTIVE_CHATBOT`이 있을 때만 렌더**되며(= 챗봇이 `ACTIVE`), 체크 전에는 확정 버튼이 `aria-disabled`다(P-7). `ACTIVE`가 아니면 체크박스 없이 확정 버튼이 곧바로 활성(단 blockers는 여전히 0건이어야 함).
- 결과: `POST .../restore { expectedCurrentHash: preview.currentContentHash, acknowledgeActive: checkbox값 }`.

### 4.4.2 `RestoreBlockerList` — 원인 + 해결 방법 (UIUX §7, FR-H4-3)

| `code` | 문구(원인 + 해결 방법) |
|---|---|
| `CHATBOT_ARCHIVED` | "이 챗봇은 보관 상태입니다. 기본설정 탭에서 먼저 초안으로 복구한 뒤 다시 시도해 주세요." |
| `ACTIVE_JOB` | "진행 중인 작업이 있습니다: {작업 종류}({progress}%). 완료 후 다시 시도해 주세요." — `TRAINING_JOB`→"분류기 학습", `TEST_RUN`→"TC 실행" |
| `SCHEMA_UNSUPPORTED` | "이 버전은 형식(v{schemaVersion})이 오래되어 복원할 수 없습니다. 내용은 조회할 수 있습니다." + `[내용 보기로 이동]` |
| `INTEGRITY_FAILED` | "이 버전의 자산에서 문제가 발견되어 복원할 수 없습니다({total}건)." + `[자세히 보기]`(펼침 — `violations[]` 최대 100건 목록) |
| `RESTORE_IN_PROGRESS` | "다른 관리자가 이미 이 챗봇을 복원하고 있습니다. 완료 후 다시 시도해 주세요." |
| `NO_CHANGES` | "현재 상태와 완전히 동일한 버전입니다. 복원할 필요가 없습니다." |

### 4.4.3 `RestoreWarningList` — 11종 (§4.5.2 레이아웃에 순서대로 표시)

| `code` | 문구 |
|---|---|
| `ACTIVE_CHATBOT` | "운영 중인 챗봇입니다 — 복원하면 다음 대화부터 즉시 반영됩니다." (체크박스 동시 렌더) |
| `TARGET_INTEGRITY_WARNINGS` | "대상 버전에 참조 경고 {n}건이 있습니다(캡처 당시부터 있던 문제로, 복원을 막지 않습니다)." |
| `BANNED_WORD_MATCHES` | "복원되는 응답 문구 중 현재 금지어 사전과 일치하는 항목이 {n}건 있습니다." |
| `PENDING_SUGGESTIONS_ORPHANED` | "대기 중인 증강 제안 {n}건이 복원 후 존재하지 않는 의도를 가리키게 됩니다." |
| `ACCEPTED_SUGGESTIONS_NOT_RESUGGESTED` | ★`AcceptedSuggestionsWarningBanner`로 **별도 강조**(P-8) — "복원으로 제거되는 승인된 예문 {n}건은 다시 제안되지 않습니다. 필요한 예문은 복원 후 의도 편집 화면에서 직접 추가해 주세요." |
| `TEST_CASES_UNRESOLVED` | "활성 TC {n}건이 복원 후 '판정 불가'가 됩니다(기대 대상이 이 버전에 없음)." |
| `CLASSIFIER_WILL_BE_DELETED` | "경량 분류기가 삭제됩니다 — 복원 후 재학습이 필요합니다." |
| `PROFILE_WILL_CHANGE` | "표시 설정이 바뀝니다: {바뀌는 필드명 목록}." |
| `RAG_NOT_CONFIGURED` | "이 버전은 2단계(외부 AI 검색) 설정이 켜져 있지만, 서버에 연결 정보가 없어 호출되지 않습니다." |
| `REINDEX_IN_PROGRESS` | "진행 중인 색인이 끝난 뒤 복원 내용이 이어서 색인됩니다." |
| `SCHEMA_UPCASTED` | "이 버전은 이전 형식으로 저장되어 있어 현재 형식으로 변환해 보여주고 있습니다." |

`AcceptedSuggestionsWarningBanner`는 목록 상단에 `SeverityBadge(WARNING)` + 굵은 텍스트로 별도 렌더하고, 나머지 10종은 `RestoreWarningList`에 아이콘(ⓘ 또는 ⚠, 코드별)과 텍스트로 나열한다. **색상만으로 구분하지 않는다**(아이콘 + 텍스트, UIUX §1).

### 4.4.4 `RestoreResultPanel` — 복원 완료 (FR-H4-5, S-1/S-8/S-9)

```
✔ v27로 복원되었습니다.
백업: v28(복원 직전 백업) — 되돌리려면 v28로 다시 복원하세요.
재색인: [IndexStatusBadge — 재계산 중 (0/18)] (완료되면 자동 갱신)
[TC 세트로 검증하기 →]  (대화검증 탭 · /chatbots/:id/validation/sets)
```

- 색인 진행 중이던 상태였다면(`reindexWasRunning:true`) "진행 중이던 색인이 끝난 뒤 복원 내용이 이어서 색인됩니다." 문구를 추가.
- `classifierDeleted:true`면 "분류기가 삭제되었습니다 — 다시 사용하려면 재학습해 주세요." 병기.
- 패널은 화면에 **상시 패널**로 남아(자동으로 사라지는 Toast가 아니다) 사용자가 검증 흐름으로 바로 이어갈 수 있게 한다(S-1의 "복원 직후 TC 세트 실행" 시나리오).
- `[TC 세트로 검증하기]`는 `/chatbots/:chatbotId/validation/sets`(기존 대화검증 탭)로 이동 — ID 보존으로 TC가 즉시 유효하다는 사실(AC-H3-4)을 이 링크로 실감하게 한다.

---

## 4.5 기존 화면 연계 — `autoSnapshot` 결과 표시

### 4.5.1 임포트 완료 화면(D2c/D5b `BulkImportModal` 3단계, E1)

3단계(완료) 레이아웃의 `ImportCommitResultSummary` **바로 아래**에 `AutoSnapshotNotice` 1줄을 추가한다:

| `autoSnapshot.status` | 표시 |
|---|---|
| 필드 없음(구버전 서버) | 아무것도 표시하지 않음 |
| `CREATED` | "✔ 이 작업 직전 상태가 v{versionNo}로 자동 저장되었습니다. [버전 이력에서 보기 →]" |
| `UNCHANGED` | (표시 안 함 — 직전 버전과 동일해 새로 저장할 것이 없었다는 것은 사용자에게 중요 정보가 아니다) |
| `FAILED` | `SeverityBadge(WARNING)` "직전 상태가 자동 저장되지 않았습니다(작업은 정상 완료됨). 필요하면 버전 이력에서 지금 수동으로 저장해 주세요." |
| `DISABLED` | (표시 안 함 — 관리자가 의도적으로 끈 설정) |

1단계(파일 선택) 화면에는 `AutoSnapshotPreNotice`로 사전 고지 1줄 추가: "커밋 직전 상태가 자동으로 저장됩니다(버전 이력에서 되돌릴 수 있음)."

### 4.5.2 일괄 삭제 확인 다이얼로그(`BulkDeleteConfirmDialog`, E2)

`204` 계약이 유지되어(§0-7) 성공/실패를 사후에 알릴 수 없으므로, **사전 고지만** 추가한다 — 다이얼로그 본문에 1줄: "삭제 직전 상태가 자동으로 저장됩니다(용량 초과 등으로 실패할 수 있으며, 이 경우 화면에 안내되지 않습니다). 확실하지 않다면 삭제 전 버전 이력에서 직접 저장해 주세요." + `[버전 이력으로 이동]`(새 탭 아님, 다이얼로그는 취소됨).

### 4.5.3 증강 제안 목록(`AugmentationPanel`, E3, FR-H4-6)

`ProposalContainer`의 `safetyNotice` 아래(또는 `AugmentationBulkActionBar` 인접)에 상시 안내 1줄 추가: "승인 시 직전 상태가 자동 저장됩니다(버전 이력에서 되돌릴 수 있음)." 승인 액션(`[선택 예문으로 추가]`) 완료 후 응답에 `autoSnapshot`이 있으면 §4.5.1과 동일한 `AutoSnapshotNotice`를 Toast로 표시.

### 4.5.4 학습현황 일괄 반영(`BulkResolveModal`, E4)

기존 "저장 즉시 반영됩니다" 상시 안내(FR-C-7 ④) 바로 아래에 한 줄 추가: "반영 직전 상태가 자동 저장됩니다(버전 이력에서 되돌릴 수 있음)." 반영 완료 후 응답에 `autoSnapshot`이 있으면 §4.5.1과 동일한 `AutoSnapshotNotice`를 결과 Toast에 포함.

---

## 5. 사용자 인터랙션 흐름 종합

### 5.1 증강 승인을 되돌린다 (S-1, ★ 핵심 경로)

```
AugmentationPanel에서 18건 승인 → autoSnapshot.CREATED(v27) Toast
(오후, 문제 발견) TabNav "버전 이력" → L1에서 v27 확인("자동 · 증강 승인 직전(환불규정문의)")
  → [현재와 비교] → L2: "~ 의도 1(환불규정문의, 예문 +18)"만 표시
  → [이 버전으로 복원] → RestoreDialog: blockers 없음, warnings: ACTIVE_CHATBOT만
  → (ACTIVE 챗봇이면 체크박스 확인) → [v27로 복원] → 확정
  → RestoreResultPanel: "백업 v28" + 재색인 진행 + [TC 세트로 검증하기]
  → 대화검증 탭에서 전체 회귀 실행 → 통과 468 → 471 확인(ID 보존으로 TC 전부 유효)
```

### 5.2 엑셀 임포트를 잘못 올렸다 (S-2)

```
BulkImportModal 3단계 완료 → autoSnapshot.CREATED(v31) 안내
(문제 발견) L1 → v31("자동 · 엑셀 임포트 직전(FAQ)") → [현재와 비교]
  → 요약에 "그 사이 다른 편집(의도 1건)도 함께 되돌아간다"는 사실이 diff에 그대로 보임
  → [이 버전으로 복원] → 미리보기 상단 "대상 버전 이후 변경 N건이 함께 취소됩니다" 확인 후 확정 또는 취소
```

### 5.3 캠페인 전에 수동으로 저장해 둔다 (S-3)

```
L1 [+ 버전 저장] → 라벨 "5월 개편 전" 입력 → 저장(v20) → 행의 📌 클릭 → 고정
```

### 5.4 무엇이 바뀌었나만 본다 (S-4, VIEWER)

```
L1(조회만) → v20 행에서 [다른 버전과 비교] → v25 선택 → L2
  → "노드 1건 변경(배송조회 응답)" → DiffItemDrawer에서 STRUCT 전/후 원문 확인
  → [이 버전으로 복원] 버튼 자체가 렌더되지 않음(VIEWER)
  → AuditCountDisclosure도 렌더되지 않음(audit:read 없음)
```

### 5.5 미리보기 후 다른 사람이 편집했다 (S-5) — §4.4 상태표 참조

### 5.6 학습이 돌고 있다 (S-6)

```
RestoreDialog 오픈 → 미리보기 blockers: ACTIVE_JOB("분류기 학습(진행률 60%)")
→ 확정 버튼 렌더 안 됨, "확인"만 → 닫고 대기 → 작업 완료 후 재오픈 시 blockers 없음
```

### 5.7 운영 중 복원과 진행 중 대화 (S-7)

화면상 별도 조치 없음(서버 매 턴 재검증) — `RestoreResultPanel`에 "다음 대화부터 즉시 반영됩니다" 안내만 유지.

### 5.8 복원을 되돌린다 (S-8)

```
RestoreResultPanel "백업: v28 — 되돌리려면 v28로 다시 복원하세요." 링크 클릭
→ v28 행에서 [이 버전으로 복원] → 확정 → 복원 전 상태로 복귀(v29가 새 백업으로 생성)
→ 특정 예문만 살리려면: v27↔v28 L2 차이에서 DiffItemDrawer의 [복사] → 의도 편집 화면에 붙여넣기
```

### 5.9 복원 후 의미 매칭 (S-9)

`RestoreResultPanel`의 `IndexStatusBadge`가 "재계산 중 (12/18)" → 완료 시 자동 갱신(기존 `embeddings/status` 폴링 재사용).

### 5.10 오래된 버전이 복원되지 않는다 (S-10)

```
L1에서 옛 버전(schemaVersion 낮음) → [이 버전으로 복원] → RestoreDialog blockers: SCHEMA_UNSUPPORTED
→ [내용 보기로 이동]만 가능(복원 불가, 조회는 가능)
```

### 5.11 금지어가 들어 있는 버전 (S-11)

```
RestoreDialog warnings: BANNED_WORD_MATCHES("현재 금지어 사전과 일치하는 문구 N건")
→ 복원은 막지 않음, 참고 정보로만 표시
```

### 5.12 오류 처리 요약표

| 오류 | 발생 화면 | 표시 |
|---|---|---|
| `409 RESTORE_PREVIEW_STALE` | L4 확정 | 다이얼로그 유지 + 자동 재확인(§4.4 상태표) |
| `409 RESTORE_BLOCKED_BY_ACTIVE_JOB` | L4 미리보기/확정 | blockers 목록(§4.4.2) |
| `409 RESTORE_IN_PROGRESS` | L4 확정 | 다이얼로그 닫힘 + Toast |
| `409 RESTORE_NO_CHANGES` | L4 미리보기 | blockers 목록("복원할 필요가 없습니다") |
| `422 VERSION_SCHEMA_UNSUPPORTED` | L1/L2/L4 | 복원 버튼 비활성 또는 blocker, 내용 보기는 허용 |
| `422 VERSION_INTEGRITY_FAILED` | L4 미리보기 | blocker "자세히 보기"(violations) |
| `422 VERSION_SNAPSHOT_TOO_LARGE` | L1 수동 저장 / L4 확정(백업) | 각각 인라인 오류 / 다이얼로그 오류 배너 |
| `409 VERSION_PINNED_LIMIT_EXCEEDED` | L1 고정 토글 | 인라인 오류 |
| `409 VERSION_PINNED` | L1 삭제(방어) | 삭제 버튼 사전 `disabled`, 발생 시 인라인 오류 |
| `409 CHATBOT_ARCHIVED` | L1 전 쓰기 액션 | 버튼 `aria-disabled` + `ArchivedBanner` |
| `404`(교차 챗봇/정리된 버전) | L1/L2/L3 딥링크 | "찾을 수 없습니다" + 목록 복귀 |

---

## 6. 권한별 화면 요소 (VIEWER = `dialogue:read`만, EDITOR/ADMIN = `dialogue:write`(+`chatbot:write`))

| 요소 | VIEWER | `dialogue:write`만 | `dialogue:write`+`chatbot:write` |
|---|---|---|---|
| L1~L3 조회 | 표시 | 표시 | 표시 |
| `[+ 버전 저장]`/라벨편집/📌/삭제 | **렌더 안 함** | 표시 | 표시 |
| `[이 버전으로 복원]`(다이얼로그 진입 버튼 자체) | **렌더 안 함** | **렌더 안 함**(J-11 — 복원은 두 권한 AND) | 표시 |
| `AuditCountDisclosure` | `audit:read` 있을 때만(역할 무관) | 〃 | 〃 |

API를 직접 호출해도 서버가 `403`(AC-H4-3/4) — 화면은 방어의 첫 겹일 뿐이다.

---

## 7. `UIUX_준수기준.md` 체크리스트 매핑

| 화면 | §1 색상대비/단독금지 | §3 키보드 | §4 버튼 | §5 텍스트입력 | §6 폼컨트롤 | §7 오류메시지 | §8 로딩/비동기 | §9 내비게이션 |
|---|---|---|---|---|---|---|---|---|
| L1 목록 | `VersionTriggerBadge`/`SeverityBadge` 아이콘+색+텍스트 3중 | 행 확장·케밥 Tab 순회, 필터 셀렉트 방향키 | "버전 저장"/"복원" 동사형, 44×44px, 저장 중 `disabled`(연타방지) | 라벨(≤50)·메모(≤500) 레이블 필수, 붙여넣기 제한 없음 | 트리거 필터 단일 셀렉트(§6, 값변경 즉시 반영은 목록 필터 관례로 허용, 결과 `aria-live`) | 이름중복·크기초과 인라인 오류(원인+해결) | `SkeletonRow`, 빈상태 `EmptyState` | 페이지네이션 밑줄+형태(§9), 행→L2/L3 `<a>` 유사 라우팅 |
| L2 차이보기 | `ChangeKindBadge` 기호+텍스트+색 3중(FR-H4-7), `RecreatedHintBadge` 텍스트 병기 | 표 행 이동·드로어 포커스트랩·Esc | "CSV 내보내기"/"복사" 동사형 44×44px | — | 종류·유형 필터 셀렉트(단일, 방향키) | 미지원 형식 안내 + 대안 CTA | 요약/목록 스켈레톤 | 비교대상 셀렉트, 드로어 닫기 포커스 복귀 |
| L3 내용보기 | — | 탭 Tab 순회, Esc 없음(탭은 콘텐츠 전환) | `CopyButton` 44×44px | 검색 입력 레이블 필수 | 종류 탭(단일 선택 의미 — 탭 패턴) | 원형 데이터 안내 | 스켈레톤 | 탭 `aria-selected`, 페이지네이션 |
| L4 복원다이얼로그 | `RestoreBlockerList`/`RestoreWarningList` 아이콘+텍스트, 색상단독 아님 | 포커스 트랩·Esc·**기본 포커스=취소**(NFR-HA2) | "v27로 복원"(대상 명시, FR-H4-4), 44×44px, 확정 중 `disabled` | 체크박스 레이블 명시적 문장(플레이스홀더 아님) | `ActiveChatbotAcknowledgeCheckbox` 단일 체크박스, 미체크 시 확정 `aria-disabled` | blockers "원인+해결방법"(FR-H4-3), 결과 `aria-live="polite"` | 미리보기·확정 진행 스피너+`aria-live`, 상한 없이 서버 응답 대기(동기 처리·수초, NFR-HP3) | — |
| E1~E4 기존화면 확장 | `AutoSnapshotNotice` 아이콘+텍스트(경고는 `SeverityBadge(WARNING)`) | 기존 컴포넌트 키보드 흐름 상속 | — | — | — | `FAILED` 상태 경고 문구(§4.5.1) | 기존 로딩 패턴 상속 | 버전 이력으로 이동 링크 |

공통: 신규/변경 화면 **axe 스캔 대비 위반 0건**, 모든 신규 버튼 **44×44px 이상 터치 영역**(§4), 모든 폼 **레이블 필수**(플레이스홀더 대체 금지, §5), 복원 확인 대화상자는 **`Modal`의 포커스 트랩·`Esc`·기본 포커스 취소를 그대로 상속**한다(NFR-HA2, §14.3).

---

## 8. 반응형 고려사항

1. **L1 목록**: 행 확장(`VersionRowDetail`) 방식이므로 별도 브레이크포인트 없이 모바일에서도 동일 구조가 유지된다. 좁은 화면(<640px)에서는 행 액션 버튼(`현재와 비교`/`다른 버전과 비교`/`내용 보기`/`복원`) 4개가 2×2 그리드로 줄바꿈되되 각 44×44px 이상을 유지한다.
2. **L2 차이 보기의 `DiffItemDrawer`**: 데스크톱(≥1024px)은 우측 고정폭 드로어, 그 미만은 `Modal`과 동일하게 **전체폭 오버레이**로 전환한다(신규 반응형 규칙을 만들지 않고 기존 `Modal`의 좁은 화면 규칙을 상속).
3. **L3 내용 보기의 `ContentKindTabs`**: 8개 탭은 좁은 화면에서 가로 스크롤 탭 스트립(`dialogue-design-ui-spec.md` §9의 `DialogueSubNav` 모바일 패턴과 동일 처리)으로 전환하며, 드롭다운으로 대체하지 않는다(탭 전환 빈도가 높아 드롭다운은 왕복 클릭이 늘어난다).
4. **L4 `RestoreDialog`**: 기존 `Modal`의 반응형 규칙(좁은 화면 전체폭, 포커스 트랩)을 그대로 상속 — 신규 모달 반응형 규칙을 만들지 않는다. warnings 목록이 길어지는 경우 다이얼로그 내부만 세로 스크롤(액션 바는 하단 고정).
5. **`TabNav` 자체의 반응형**: §1.4의 "운영" 그룹 4항목 확장만으로 기존 규칙(`quality-channel-ui-spec.md` §2.4 — 태블릿 그룹 단위 줄바꿈, 모바일 바텀시트 드롭다운)이 그대로 적용된다.
6. **`apps/widget`**: 이 그룹은 위젯에 변경이 없다(§0-3) — 최종 사용자 화면 반응형 고려사항 없음.

---

## 9. Out of scope / 재검토 트리거

| 항목 | 사유 | 재검토 트리거 |
|---|---|---|
| 항목별(의도 1건 등) 버전 변화 바로가기(대화 자산 편집 화면 → 이 버전 이력) | 요구사항 FR-H4-10이 1차 범위 밖으로 명시 | 스냅샷 기반 인덱스 도입이 별도로 확정될 때 |
| 부분 복원 UI(항목 단위 되돌리기) | P-3/J-4 — 참조 정합 문제로 1차 범위 밖 | "특정 의도만 되돌리기" 요청이 반복될 때(§19 L-2) |
| 스냅샷 내보내기(파일 다운로드)/가져오기 화면 | NFR-HS5 — 검증되지 않은 자산 주입 경로 차단 | 오프사이트 백업 요구(No.45)가 별도로 확정될 때 |
| `envFingerprint.assetContentHash` 연동(No.19 실행 목록에 "이 실행은 v27과 동일" 표시) | FR-H2-9 선택 사항, 1차 제외(§20 D-6) | "이 실행이 어느 버전과 같은가" 요구가 실제 접수될 때 |
| 일괄 삭제 3종의 `autoSnapshot` 성공/실패 화면 안내 | `204` 계약 유지(§19 L-3) — 사전 고지로 대신함 | 계약이 `200 { deleted, autoSnapshot }`로 바뀔 때(§19 L-3 트리거) |
| "운영" 그룹이 5항목 이상으로 늘어날 경우의 셸 재구성 | 이번 결정(§1.3)으로 "운영" 그룹은 4항목까지 늘었다 | "운영" 그룹에 5번째 최상위 탭 요구가 들어올 때 — `StatsShell` 선례처럼 유사 화면군을 셸로 묶을지 재검토 |

---

## 10. 다음 단계 인계

| 에이전트 | 인계 내용 |
|---|---|
| **`backend-implementer`** | 본 문서가 전제하는 API 계약(설계서 §10, 12개 핸들러) 그대로 구현. 특히 L4의 `RestoreDialog`가 오픈 즉시 미리보기를 호출하는 UX이므로 `restore/preview`가 DB에 쓰지 않음(AC-H3-1)을 유지해야 하고, `autoSnapshot` 선택 필드가 §0-6/§4.5의 4개 기존 응답 스키마(`ImportCommitResult`/`AugmentationAcceptResponse`/`BulkResult`)에 정확히 반영돼야 한다. |
| **`frontend-implementer`** | 구현 순서 권고: ① `MESSAGES.versions.*`/`MESSAGES.detail.tabVersions` 상수 + `TabNav.tsx` 링크 1개 추가(라우트만, 리다이렉트 불필요) → ② L1 목록(현재 행·트리거 배지·필터·페이지네이션) → ③ 수동 저장/라벨/고정/삭제(CRUD) → ④ `AuditCountDisclosure`(`audit:read` 조건부) → ⑤ L2 차이 보기(`ChangeKindBadge`, 요약→목록→`DiffItemDrawer`) → ⑥ L3 내용 보기(`ContentKindTabs`, `CopyButton` 연계) → ⑦ `RestoreDialog`(미리보기 자동 호출 → blockers/warnings → `ActiveChatbotAcknowledgeCheckbox` → 확정 → `RestoreResultPanel`) → ⑧ E1~E4 기존 화면 확장(`AutoSnapshotNotice`/`AutoSnapshotPreNotice`, 가장 마지막 — 대상 버전 이력 화면이 먼저 있어야 링크가 유효하다). 권한 판정은 `can()`만 사용(복원 = 두 권한 AND, 서버가 최종 통제). |
| **`test-automation`** | UI 단위 검증 대상: `RestoreDialog` 기본 포커스=취소(NFR-HA2) · `ActiveChatbotAcknowledgeCheckbox` 미체크 시 확정 버튼 비활성 · `409 RESTORE_PREVIEW_STALE` 발생 시 다이얼로그 유지+자동 재확인 흐름 · `ChangeKindBadge`/`VersionTriggerBadge` 색상단독 아님(axe 대비 포함) · VIEWER 계정으로 L1~L3 렌더해 쓰기·복원 버튼 렌더 0건 확인(§6) · `autoSnapshot` 필드 부재 시 E1/E3/E4에서 아무 것도 렌더되지 않음 확인. |
