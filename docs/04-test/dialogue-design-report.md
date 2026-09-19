# 대화 설계(No.5~9) 시험 결과 보고서

> **대상**: `docs/requirements/dialogue-design.md`(No.5 대화그래프빌더, No.6 의도·키워드관리, No.7 동음이의어사전, No.8 컨텍스트관리, No.9 FAQ관리)
> **시험 수행일**: 2026-09-20 · **수행**: test-automation
> **선행 상태**: backend-implementer/frontend-implementer 구현 완료, code-reviewer 리뷰 완료(High 3건 — H1 삭제차단 배너 바로가기, H2 참조종류 라벨 정확성, H3 노드 다중필터 서버위임 / Medium 1건 — M2 대량업로드 검증-커밋 일치 — 전부 재작업 완료)
> **범위**: `apps/api`(신규 통합 스펙 1개 파일 추가, 기존 6개 파일 유지), `packages/dialogue-engine`(성능 시험 1개 파일 추가, 기존 6개 파일 유지), `apps/web`(신규 컴포넌트 시험 6개 파일 추가)

---

## 1. 요약

| 구분 | 이전(baseline) | 이후 | 비고 |
|---|---|---|---|
| `apps/api` 테스트 | 8 suites / 71 tests, 전부 Pass | 9 suites / **118 tests**, 전부 Pass | `dialogue-design.integration.spec.ts` 신규 47개(6개 도메인 모듈 + 대량업로드 + 공통/횡단). 기존 파일 무변경 |
| `packages/dialogue-engine` 테스트 | 6 suites / 35 tests, 전부 Pass | 7 suites / **37 tests**, 전부 Pass | `resolver.performance.spec.ts` 신규 2개(M4 보강, 설계 규모 P95 측정). 기존 파일 무변경 |
| `apps/web` 테스트 | 8 files / 39 tests, 전부 Pass | 14 files / **75 tests**, 전부 Pass | 대화설계 화면 컴포넌트 시험 6개 파일 신규(36 tests) |
| **합계** | 22 suites/files, 145 tests | **30 suites/files, 230 tests** | 전부 Pass, 실패 0건 |
| typecheck | — | `apps/web`·`apps/api` typecheck 정상 | 회귀 없음 |

**결론**: code-reviewer가 지목한 4개 재작업 항목(H1/H2/H3/M2) 모두 실제 HTTP 계약 시험 + 컴포넌트 렌더링/클릭 시험으로 재검증했고, 전부 정상 동작을 확인했다. frontend-implementer가 자체 미검증으로 보고한 "동음이의어 참조"/"컨텍스트 슬롯 참조" 삭제차단 케이스도 seed 데이터 의존 없이 API 통합 테스트가 매 케이스마다 만드는 조합으로 재현해 검증을 완료했다. **재작업이 필요한 신규 결함은 발견되지 않았다.**

---

## 2. 실행 커맨드 및 결과

```
pnpm --filter @chat-bot/api test               # 9 suites, 118 tests, 전부 Pass (~12s)
pnpm --filter @chat-bot/dialogue-engine test    # 7 suites, 37 tests, 전부 Pass (~3.7s)
pnpm --filter @chat-bot/web test                # 14 files, 75 tests, 전부 Pass (~6s)
pnpm --filter @chat-bot/web typecheck           # 오류 없음
pnpm --filter @chat-bot/api typecheck           # 오류 없음
```

---

## 3. H1/H2/H3/M2 재작업 검증 상세

### 3.1 H2 — 삭제차단 배너 참조종류 라벨 정확성(최우선 검증 대상)

`reference-check.service.ts`는 `INTENT_IN_USE`/`KEYWORD_IN_USE` 동일 오류 코드라도 참조 종류에 따라 서로 다른 `message` 문구를 던지고, 프런트 `resolveBlockedRefKind(resourceKind, message)`가 이 문구("동음이의어"/"컨텍스트" 포함 여부)로 참조 종류를 판별해 편집 화면 링크를 분기한다. frontend-implementer는 이 두 케이스를 시드 데이터 부재로 실제 클릭까지 검증하지 못했다고 자체 보고했다.

**이번에 시드를 건드리지 않고 각 스펙이 필요한 조합을 직접 만들어 재현·검증했다**:

- 의도를 생성 → 그 `intentId`를 연결한 동음이의어(의미 2개 이상, 그중 1개가 해당 의도 참조) 생성 → 의도 삭제 시도 → `409` 메시지에 "동음이의어" 포함 확인(`apps/api/src/integration/dialogue-design.integration.spec.ts` "EX-R-2 / H2").
- 키워드를 생성 → `type=KEYWORD` 슬롯(`keywordId`가 그 키워드를 참조)을 가진 컨텍스트 생성 → 키워드 삭제 시도 → `409` 메시지에 "컨텍스트" 포함 확인(같은 파일 "EX-R-3 / H2").
- 프런트 판별 로직 자체는 `apps/web/src/pages/dialogue/components/DeleteBlockedBanner.spec.tsx`에서 `resolveBlockedRefKind` 5개 케이스(intent×동음이의어/노드, keyword×컨텍스트/노드, context·node는 항상 node) + 배너 렌더링·클릭 시 실제 라우트 이동(node/homonym/context 3종 전수)으로 단위 검증.
- 종단 통합은 `apps/web/src/pages/dialogue/IntentsKeywordsPage.spec.tsx`에서 서버 메시지를 `ApiError` mock으로 주입해 배너 문구 → 링크 클릭 → 목표 화면 이동까지 재현.

결과: **모두 정상.** 3가지 참조종류(node/homonym/context)의 라벨·href·이동이 설계(ui-spec §4.3.2)대로 동작한다.

### 3.2 H1 — 삭제차단 배너 바로가기

위 H2 검증과 동일 테스트들이 "참조 목록 항목 클릭 → 모달 닫힘(`onBeforeNavigate`) → 해당 리소스 편집 화면으로 실제 이동"까지 함께 검증한다. 추가로 노드 삭제 차단(EX-R-5, kind는 항상 'node')을 `NodesListPage.spec.tsx`에서 별도 확인했다. 5건 초과 시 "외 N건" 표기도 검증했다.

### 3.3 H3 — 노드 다중유형 필터 서버 위임

`apps/web/src/pages/dialogue/NodesListPage.tsx`가 `typeFilter` 배열을 클라이언트에서 걸러내지 않고 `dialogNodesApi.list(...,{nodeType: typeFilter})`로 서버에 그대로 위임하는지, 그리고 서버(`csvEnumArray`)가 `nodeType=NORMAL,FALLBACK` 같은 CSV 파라미터를 정확히 파싱해 지정한 타입만 반환하는지 **양쪽 모두** 검증했다:

- 서버: `dialogue-design.integration.spec.ts`("H3" 테스트) — START/FALLBACK/NORMAL 노드 각 1건씩 생성 후 `?nodeType=START,FALLBACK` 조회 시 2건만 반환.
- 프런트: `NodesListPage.spec.tsx`("H3" 테스트) — 체크박스 해제 시마다 `dialogNodesApi.list`가 좁혀진 배열로 재호출됨을 확인(로컬 필터링이 아니라 매 상태 변경마다 서버 재조회).

### 3.4 M2 — 대량업로드 검증-커밋 일치(키워드 동의어 충돌 그룹 스킵)

기존 `import-planner.spec.ts`(순수 함수)가 커버하던 "충돌 없는 동의어 행도 같은 묶음이면 함께 스킵되어야 하고, 검증 리포트의 `errors[]`가 이를 정확히 예고해야 한다"는 규칙을 **HTTP 왕복(validate→commit)으로 재현**했다(`dialogue-design.integration.spec.ts` "M2" 테스트):

1. 기존 키워드 `커피` 존재.
2. CSV 업로드: `음료,커피`(충돌) / `음료,주스`(비충돌이지만 같은 묶음).
3. `POST .../import/validate` → `errors` 2건 모두 `SYNONYM_CONFLICT`로 예고됨 확인.
4. `POST .../import/commit`(SKIP_INVALID) → `createdItems:0, skippedRows:2` — 예고와 실제 결과가 정확히 일치.
5. 최종 키워드 목록에 `음료`가 생성되지 않고 기존 `커피`만 남아있음을 재확인.

---

## 4. M4(성능 테스트 공백) 보강 상세

`packages/dialogue-engine/src/resolver.spec.ts`의 기존 "AC-E-12" 케이스는 의도 200건×예문20건(4,000예문)·FAQ 300건·**노드 0건** 규모로 "100회 총합 2초 이내"만 검증해, 설계서(FR-E-10/NFR-P3)·ADR-0008이 명시한 실제 설계 규모(**의도 1,000×예문 20,000 / 노드 500 / FAQ 2,000**)를 반영하지 못하고 있었다.

신규 `resolver.performance.spec.ts`는 이 규모를 그대로 합성 생성하고(노드는 전 의도 구간에 고르게 분산 참조), 노드매칭 히트·FAQ매칭 히트·완전폴백(최악 경로) 3가지를 섞어 개별 호출 100회의 **P95**를 측정한다.

- **측정 결과(2026-09-20, 로컬)**: `buildDialogueIndex` 재사용 시 P95가 200ms 기준 대비 여유 있게 낮은 수준(수 ms대)으로 확인됨 — **성능 이슈 없음.**
- 참고용으로 인덱스 미사용(원본 배열 선형 스캔) 케이스도 함께 측정해 회귀 감시용 느슨한 상한(P95 < 2000ms)을 걸어두었다.
- `evaluateNode`(`node-matcher.ts`)가 노드마다 `bundle.intents`/`bundle.keywords`를 `.some()`/`.find()`로 선형 탐색하는 구조(인덱스 미활용)를 코드 읽기 중 확인했으나, 설계 규모(노드 500×의도 1,000)에서도 실측 P95가 기준을 크게 밑돌아 **현시점에는 결함으로 분류하지 않았다**. 향후 노드 수가 훨씬 커지면(예: 수천 건) 재측정을 권고하며, `자동시험_전략.md` §4.3에 후속 부하시험(k6) 검토 항목으로 기록했다.

---

## 5. 신규 커버리지 상세

### 5.1 `apps/api` — `dialogue-design.integration.spec.ts`(47 tests)

| 영역 | 대표 케이스 |
|---|---|
| 의도(Intent) | AC-6-1~6-9, EX-R-2(H2) |
| 키워드(Keyword) | AC-6-9, FR-6-18, EX-R-3(H2) |
| 동음이의어 | AC-7-1~7-6, FR-7-9 |
| 컨텍스트 | AC-8-9, AC-8-11, FR-8-5 |
| 대화 노드 | AC-5-2~5-7, AC-5-9~5-12, H3, FR-5-19 |
| FAQ | AC-9-1, AC-9-2, AC-9-4, AC-9-7, AC-9-8 |
| 대량 업로드 | AC-6B-2~6B-4, AC-6B-6, M2, EX-I-1, EX-I-4 |
| 공통/횡단 | AC-C-2, AC-C-3, AC-C-7 |

멀티파트(`import/validate`) 호출은 Node 18+ 내장 `fetch`+`FormData`+`Blob`로 처리해 신규 의존성을 추가하지 않았다(`chatbot-operations.integration.spec.ts`의 순수 `http` 기반 JSON 요청 패턴은 그대로 유지).

### 5.2 `packages/dialogue-engine` — `resolver.performance.spec.ts`(2 tests)

§4 참고. 기존 6개 파일(35 tests)은 무변경.

### 5.3 `apps/web` — 신규 6개 파일(36 tests)

| 파일 | 핵심 검증 |
|---|---|
| `DeleteBlockedBanner.spec.tsx`(9) | H1/H2 핵심 — 참조종류 판별 + node/homonym/context 3종 라벨·링크·이동, 5건 초과 "외 N건" |
| `ReorderableList.spec.tsx`(5) | UIUX §3 드래그 금지, AC-5-8 포커스 유지, 클릭/키보드 동일 동작 |
| `DialogOutputEditor.spec.tsx`(6) | 아웃풋 12종 중 6종 전환(TEXT↔CARD↔IMAGE↔BUTTON↔PAUSE↔SURVEY), 미지원 배지(FR-5-15), 글자수 카운터 |
| `BulkImportModal.spec.tsx`(5) | 3단계(선택→검증→확정) 플로우, 정책 라디오, 토큰만료/전체취소 배너, 중복제출 방지 |
| `NodesListPage.spec.tsx`(5) | H3 프런트 측, 설계점검/흐름미리보기 패널 렌더, 노드 삭제차단(kind=node) |
| `IntentsKeywordsPage.spec.tsx`(6) | 의도/키워드 CRUD, 탭 전환, H2 종단 통합(동음이의어/컨텍스트 배너) |

`ResourcePickerField`(검색 API 의존) 연동이 필요한 `NodeFormPage`/`ContextFormPage`/`HomonymEditModal`/`FaqEditModal` 종단 플로우는 이번 범위에서 제외했다(§6 참고).

---

## 6. 실패/미자동화 요약(등급 분류)

**시험 중 발견된 신규 결함(코드 버그)은 0건이다.** 아래는 결함이 아니라 "이번 시험 범위 밖" 또는 "테스트 인프라 제약"으로 자동화하지 못한 항목이며, `docs/04-test/오류검출_프로세스.md` 기준으로는 분류 대상(결함)이 아니므로 별도 등급을 매기지 않았다. 우선순위는 `docs/04-test/자동시험_전략.md` §4.3에 기록했다.

- 대량업로드 세부(템플릿 헤더 포맷, 트랜잭션 롤백 재현, 5MB/5,000행 상한, CSV 수식 인젝션 이스케이프, BOM 인코딩) — 코드 리뷰로 로직 확인, 전용 자동 시험 없음.
- 동음이의어 의미 반복 블록(`HomonymEditModal`), 컨텍스트 슬롯 미리보기(`ContextFormPage`), FAQ 유사후보 추천(`FaqEditModal`) 전용 컴포넌트 시험 없음.
- `NodeFormPage` 종단 플로우(저장 성공/실패) — `ResourcePickerField` 네트워크 mock 필요, 이번엔 `DialogOutputEditor`만 분리 시험.
- AC-C-4(전 과정 키보드 종단), AC-C-5(axe 스캔) — Playwright 등 E2E 인프라 도입 전까지 미자동화(챗봇 운영관리 그룹과 동일한 기존 제약).

---

## 7. 산출물 경로

- `apps/api/src/integration/dialogue-design.integration.spec.ts`
- `packages/dialogue-engine/src/resolver.performance.spec.ts`
- `apps/web/src/pages/dialogue/components/DeleteBlockedBanner.spec.tsx`
- `apps/web/src/components/ReorderableList.spec.tsx`
- `apps/web/src/pages/dialogue/components/DialogOutputEditor.spec.tsx`
- `apps/web/src/pages/dialogue/components/BulkImportModal.spec.tsx`
- `apps/web/src/pages/dialogue/NodesListPage.spec.tsx`
- `apps/web/src/pages/dialogue/IntentsKeywordsPage.spec.tsx`
- `docs/04-test/시험항목.md`(§"대화 설계(No.5~9) 상세 시험항목" 신규 절 + 기본기능 표 TC-05~09 갱신)
- `docs/04-test/시험데이터.md`(§9 신규 절)
- `docs/04-test/자동시험_전략.md`(§3.4, §4.3 신규 절)
