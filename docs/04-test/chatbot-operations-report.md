# 챗봇 운영관리(No.1~4) 시험 결과 보고서

> **대상**: `docs/requirements/chatbot-operations.md`(No.1 챗봇 리스트/그룹 관리, No.2 대시보드, No.3 챗봇 기본설정, No.4 스킨/임베드 설정)
> **시험 수행일**: 2026-09-19 · **수행**: test-automation
> **선행 상태**: backend-implementer/frontend-implementer 구현 완료, code-reviewer 리뷰 완료(Critical/High 0건, Medium 2건 기수정)
> **범위**: 코드가 실제로 존재하는 구현 단계 시험 — `apps/api`(기존 커버리지 확장), `apps/web`(신규 컴포넌트/접근성 시험 추가)

---

## 1. 요약

| 구분 | 이전 | 이후 | 비고 |
|---|---|---|---|
| `apps/api` 테스트 | 7 suites / 52 tests, 전부 Pass | 7 suites / **68 tests**, 전부 Pass | 통합 스펙에 AC/EX 갭 16건 추가(기존 파일 유지, 신규 파일 없음) |
| `apps/web` 테스트 | 없음(vitest 미구성) | **8 files / 39 tests**, 전부 Pass | vitest+Testing Library+jest-axe 신규 도입 |
| 실패 발견 | — | **0건** | 시험 중 신규 결함 없음(Critical/High/Medium/Low 전부 0) |
| typecheck/build | — | `apps/web typecheck`·`build` 정상 | 회귀 없음 |

**결론**: code-reviewer가 지목한 5개 항목(a~e, §3 참고) 모두 실제 렌더링/클릭/키보드 시험으로 검증했고, 전부 정상 동작을 확인했다. 재작업 필요 항목 없음.

---

## 2. 실행 커맨드 및 원본 로그 요약

```
pnpm --filter @chat-bot/api test        # 7 suites, 68 tests, 전부 Pass (8.3s)
pnpm --filter @chat-bot/web test        # 8 files, 39 tests, 전부 Pass (4.6s)
pnpm --filter @chat-bot/web typecheck   # 오류 없음
pnpm --filter @chat-bot/web build       # 정상 빌드(309KB, gzip 90KB)
```

### 2.1 `apps/api` — 신규 추가 16건(기존 52건 + 16건 = 68건)

기존 `apps/api/src/integration/chatbot-operations.integration.spec.ts`(16케이스)에 **같은 파일 내 `it(...)` 블록으로 추가**했다(신규 스펙 파일 생성 금지 지침 준수, NestJS 앱 부팅을 `beforeAll` 1회로 유지해 실행 시간 절약).

| 신규 케이스 | AC/EX | 확인 내용 |
|---|---|---|
| 그룹 복사 시 챗봇 N개 함께 복제 | AC-1-9 | 새 그룹 `chatbotCount:3`, 복제본 전부 `DRAFT` |
| 챗봇 보관(DELETE)→필터 반영 | AC-1-10 | 기본 필터(`status=DRAFT,ACTIVE`) 제외, "보관됨 포함" 조회 시 재노출 |
| ARCHIVED+로그보유 영구삭제 거부 | AC-1-11 | `PrismaService`로 `ConversationLog` 직접 삽입 후 409 `CHATBOT_HAS_CHILDREN` 확인 |
| 페이지네이션 | AC-1-14 | 챗봇 30건, `pageSize=20` → 1페이지 20건/2페이지 10건, `total:30` |
| 검색(q) | AC-1-15 | `q=주문` → 일치 2건만 반환 |
| 그룹 이동 404 | AC-1-16 | 존재하지 않는 대상 그룹 → 404 `NOT_FOUND` |
| 부분수정 필드 보존 | AC-3-1 | `name`만 PATCH해도 `slug`/`status`/`skin` 불변 |
| 필수값 검증 | AC-3-2 | `name:''` → 400 + `field:"name"` |
| 길이 제한 | AC-3-3 | `description` 501자 → 400 |
| XSS 스킴 차단 | AC-3-4/NFR-S3 | `avatarUrl:'javascript:alert(1)'` → 400 |
| 예약어 차단(설정 PATCH 경로) | AC-3-5 | `slug:'admin'` → 400 + "예약어" 메시지 |
| 색상 형식 검증 | AC-4-2 | `primaryColor:'#GGGGGG'` → 400 |
| 헤더문구 길이 제한 | AC-4-4 | `headerTitle` 51자 → 400 |
| 스킨 객체 왕복 | AC-4-5 | 저장 후 재조회 시 `skin`이 저장값과 일치하는 객체 |
| **slug 변경→임베드 코드 갱신** | AC-4-9/FR-4-13 | slug 변경 후 `GET .../embed-code` 재조회 시 신규 slug 반영, 구 slug 미포함(조회 시점 생성 확인) |
| ARCHIVED 대시보드 조회 허용 | AC-2-10 | 로그 보유 챗봇 보관 후에도 `totalLogCount>=1`로 정상 조회 |

전부 Pass. 특히 **AC-4-9(slug 변경 시 임베드 코드 자동 갱신)** 는 코드리뷰에서 명시적으로 언급되진 않았지만 요구사항서(FR-4-13 "조회 시점 생성")의 핵심 계약이라 우선순위 있게 추가했고, 실제로도 정상 동작을 확인했다.

### 2.2 `apps/web` — 신규 8개 파일 39개 테스트(전부 신규, 기존 0건)

`apps/web`에는 vitest 자체가 구성돼 있지 않았다. 아래를 새로 설치/설정했다:

- devDependency 추가: `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `jsdom`, `jest-axe`, `@types/jest-axe`
- `apps/web/vite.config.ts`에 `test` 필드 추가(`environment:'jsdom'`, `setupFiles`)
- `apps/web/src/test/setup.ts`(jest-dom matcher 등록, `cleanup()` 자동화, jsdom `offsetParent` 폴리필)
- `apps/web/src/test/fixtures.ts`(그룹/챗봇/대시보드 픽스처 — seed 3트랙과 수치 정렬)

| 파일 | 테스트 수 | code-reviewer 지목 항목 대응 |
|---|---|---|
| `src/components/Modal.spec.tsx` | 8 | **(a) 모달 포커스 트랩·Esc·포커스복귀** |
| `src/components/TopBar.spec.tsx` | 5 | **(e) AC-3-8 TopBar 내비게이션 가드** |
| `src/pages/chatbot-detail/SettingsTab.spec.tsx` | 4 | **(b) slug 변경 경고 모달** |
| `src/pages/chatbot-detail/DashboardTab.spec.tsx` | 4 | **(c) 대시보드 빈 상태/로딩/새로고침 연타** |
| `src/pages/ChatbotListPage.spec.tsx` | 7 | 그룹/챗봇 CRUD 플로우, EX-1-3, EX-1-5, **AC-5-3(키보드 전용 플로우)** |
| `src/pages/ChatbotListPage.a11y.spec.tsx` | 2 | AC-5-4(axe 스캔) |
| `src/lib/contrast.spec.ts` | 7 | **(d) 스킨 대비 경고 배지 노출 조건**(WCAG 계산 단위시험) |
| `src/pages/chatbot-detail/ContrastWarningBadge.spec.tsx` | 2 | **(d)** 배지 렌더 조건 |

모두 Pass. 상세 AC 매핑은 `docs/04-test/시험항목.md`의 "챗봇 운영관리 상세 시험항목" 표를 참고.

---

## 3. code-reviewer 지목 5개 항목 — 개별 확인 결과

| # | 항목 | 검증 방법 | 결과 |
|---|---|---|---|
| (a) | 모달 포커스 트랩·Esc·포커스복귀(`components/Modal.tsx`) | `Modal.spec.tsx` — 실제 렌더 후 `userEvent`로 Tab/Shift+Tab/Escape 발생, `document.activeElement` 검증 | **정상**. Tab이 모달 밖으로 나가지 않고 순환, Esc 시 트리거 버튼으로 포커스 복귀(AC-5-5) 확인 |
| (b) | slug 변경 경고 모달 | `SettingsTab.spec.tsx` — slug 미변경/변경 시 분기, Esc 취소 시 PATCH 미전송, 확인 시에만 PATCH 전송 | **정상**. FR-3-8/AC-3-7 요구사항대로 동작 |
| (c) | 대시보드 빈 상태(`empty-dashboard-bot`)/오류 상태 분기 | `DashboardTab.spec.tsx` — mock으로 로그 0건/100건/로딩중/오류 상태 각각 렌더 | **정상**. 빈 상태는 `role=alert` 없이 중립 EmptyState로, 지표는 `0`/`0.0%`로 표시(AC-2-6) |
| (d) | 스킨 대비 경고 배지 노출 조건 | `contrast.spec.ts`(WCAG 상대휘도 공식 단위시험) + `ContrastWarningBadge.spec.tsx`(렌더 조건) | **정상**. `#4F46E5`(기본 브랜드색)는 통과, `#FFF176`(예시 밝은색)는 경고 노출·검정 텍스트 권장까지 일치 |
| (e) | AC-3-8 TopBar 내비게이션 가드 | `TopBar.spec.tsx` — 가드 미등록/`false`반환/`true`반환/`window.confirm` 연동 4가지 케이스 | **정상**. 가드가 이동을 막을 때 실제로 라우트가 바뀌지 않음을 확인(단순 함수 호출 여부가 아니라 실제 네비게이션 결과로 검증) |

---

## 4. 접근성(axe-core) 시범 적용 결과

- 적용 화면: `ChatbotListPage`(그룹/챗봇 목록) — 데이터 있음/빈 상태(그룹 0개) 2가지 상태
- 결과: **레이블/ARIA/랜드마크/중복 id 등 구조적 위반 0건**
- **알려진 한계**: jsdom에는 실제 레이아웃 엔진이 없어 axe-core의 `color-contrast` 규칙이 신뢰할 수 없는 결과만 반환한다. 이번 시험에서는 이 규칙만 비활성화하고, 색상 대비 자체는 `contrast.spec.ts`(WCAG 공식 단위 계산)로 별도 검증했다. **실 브라우저 기반 대비 자동 스캔(AC-5-4 완전 자동화)은 Playwright + axe-core 등 E2E 인프라 도입 시 보완 필요** — `자동시험_전략.md` §4.2에 다음 자동화 과제로 기록했다.

## 5. 수동 키보드 내비게이션 확인

- `AC-5-3`(그룹트리→리스트→설정폼→저장 전 과정 키보드 완료)에 대해:
  - **자동화**: `ChatbotListPage.spec.tsx`에 그룹 생성 플로우를 `click()` 없이 Tab/Enter만으로 완료하는 테스트를 추가해 Pass 확인.
  - **코드 리뷰 기반 정적 확인**: `TabNav`(`NavLink` href 기반), `KebabMenu`(button/role=menu, Esc 닫힘+포커스 복귀), `ChatbotFilterBar`(체크박스/셀렉트, 값 변경만으로 자동 제출 없음)는 모두 시맨틱 HTML 요소로 구현되어 있어 키보드 접근 구조 자체는 보장된다.
  - **한계**: 화면 전환(그룹트리→상세→설정탭)을 가로지르는 종단간(end-to-end) 키보드 전용 주행은 이번 세션에서 수행하지 못했다(Playwright 등 E2E 인프라 부재). 이 부분은 실제 브라우저에서의 수동 확인을 권장하며, 후속 E2E 과제 1순위로 문서화했다(`자동시험_전략.md` §4.2).

## 6. 발견된 결함

**없음.** 이번 시험 라운드에서 Critical/High/Medium/Low 등급의 신규 결함을 발견하지 못했다. code-reviewer가 이미 수정 완료로 표시한 Medium 2건에 대해서도, 관련 동작(AC-3-8 가드, 오류 처리 흐름 등)이 실제 렌더링 시험으로 재차 확인되어 회귀가 없음을 확인했다.

## 7. 남은 갭(향후 과제로 문서화, 이번 세션 범위 밖)

`시험항목.md`/`자동시험_전략.md`에 "미자동화"로 명시해 둔 항목:

| 항목 | 사유 | 권고 |
|---|---|---|
| AC-4-1(실시간 미리보기), AC-4-11(headerTitle XSS 이스케이프) | `SkinPreviewPanel` 전용 컴포넌트 시험 미작성 | 후속 세션에서 컴포넌트 시험 추가 |
| AC-4-8/EX-4-2(클립보드 복사 성공/폴백) | `navigator.clipboard` mock 필요, 이번 범위에서 시간상 보류 | `CopyButton.spec.tsx` 추가 권고 |
| AC-4-10(DRAFT 임베드 주의문구) | 코드 리뷰로 조건 확인, 렌더 시험 미작성 | `SkinEmbedTab` 시험 추가 권고 |
| AC-5-3 종단간 키보드 플로우, AC-5-4 실브라우저 대비 스캔 | E2E 인프라(Playwright) 부재 | `자동시험_전략.md` §4.2 "다음 자동화 대상" 1순위로 등록 |
| EX-2-5(집계 타임아웃 503) | 백엔드 타임아웃 강제 재현이 어려움 | 코드 리뷰로 로직만 확인, 수동 시나리오 권고 |

이 갭들은 결함이 아니라 **시험 커버리지의 알려진 한계**이며, 코드 동작 자체에 대한 의심 근거는 없다(코드 리뷰 및 인접 테스트로 간접 확인됨).

---

## 8. 변경된 파일 목록

### 문서
- `D:\2. Team Source\Chat Bot\docs\04-test\시험항목.md` — TC-01~04 구체화, AC/EX 매핑 상세 표 추가
- `D:\2. Team Source\Chat Bot\docs\04-test\시험데이터.md` — §8 챗봇 운영관리 시드 데이터(3트랙) 문서화
- `D:\2. Team Source\Chat Bot\docs\04-test\자동시험_전략.md` — §3 실제 구현 현황, §4.2 다음 자동화 대상 추가
- `D:\2. Team Source\Chat Bot\docs\04-test\chatbot-operations-report.md` — 본 문서(신규)

### `apps/api`(기존 파일 확장, 신규 파일 없음)
- `D:\2. Team Source\Chat Bot\apps\api\src\integration\chatbot-operations.integration.spec.ts` — 16개 케이스 추가(52→68)

### `apps/web`(신규 테스트 인프라 + 스펙 8개)
- `D:\2. Team Source\Chat Bot\apps\web\package.json` — devDependency 6종 추가
- `D:\2. Team Source\Chat Bot\apps\web\vite.config.ts` — `test` 설정 추가
- `D:\2. Team Source\Chat Bot\apps\web\src\test\setup.ts`(신규)
- `D:\2. Team Source\Chat Bot\apps\web\src\test\fixtures.ts`(신규)
- `D:\2. Team Source\Chat Bot\apps\web\src\components\Modal.spec.tsx`(신규)
- `D:\2. Team Source\Chat Bot\apps\web\src\components\TopBar.spec.tsx`(신규)
- `D:\2. Team Source\Chat Bot\apps\web\src\pages\chatbot-detail\SettingsTab.spec.tsx`(신규)
- `D:\2. Team Source\Chat Bot\apps\web\src\pages\chatbot-detail\DashboardTab.spec.tsx`(신규)
- `D:\2. Team Source\Chat Bot\apps\web\src\pages\chatbot-detail\ContrastWarningBadge.spec.tsx`(신규)
- `D:\2. Team Source\Chat Bot\apps\web\src\pages\ChatbotListPage.spec.tsx`(신규)
- `D:\2. Team Source\Chat Bot\apps\web\src\pages\ChatbotListPage.a11y.spec.tsx`(신규)
- `D:\2. Team Source\Chat Bot\apps\web\src\lib\contrast.spec.ts`(신규)

git 커밋은 수행하지 않았다(사용자 지시).
