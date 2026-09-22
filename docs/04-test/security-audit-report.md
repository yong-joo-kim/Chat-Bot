# 보안/이력(No.12~13) 시험 결과 보고서

> **대상**: `docs/requirements/security-audit.md`(No.12 회원·권한·보안 관리, No.13 이력관리) + 기존 9개 도메인 모듈 감사 소급 + `apps/web` 인증 도입
> **시험 수행일**: 2026-09-22 · **수행**: test-automation
> **선행 상태**: backend-implementer/frontend-implementer 구현 완료, code-reviewer **1차 + 2차(확인) 리뷰 완료**(Critical/High 0건, `apps/api` 261개/`apps/web` 94개 기존 테스트 회귀 없이 통과 확인됨). 2차 리뷰가 인계한 공백 4건을 이번 시험에서 처리했다.
> **범위**: `apps/api`(통합 스펙에 신규 `it` 1건 + 전수 스캔 단위 테스트 1건 보강), `apps/web`(신규 컴포넌트/컨텍스트 시험 11개 파일, 38개 `it`), `apps/dialogue-engine`/`apps/widget`(회귀 재확인만, 변경 없음)

---

## 1. 요약

| 구분 | 이전(baseline) | 이후 | 비고 |
|---|---|---|---|
| `apps/api` 테스트 | 29 suites / 261 tests, 전부 Pass | 29 suites / **263 tests**, 전부 Pass | `security-audit.integration.spec.ts`에 AC-12D-5 신규 1건, `public-decorator-count.spec.ts`에 전수 스캔 신규 1건 |
| `apps/web` 테스트 | 20 files / 94 tests, 전부 Pass | **31 files / 132 tests**, 전부 Pass | 신규 파일 11개(38 tests) — 인증 컨텍스트·로그인·403안내·401훅·비밀번호변경 분기·필터바 힌트·리소스피커·axe 3종 |
| `packages/dialogue-engine` 테스트 | 10 suites / 72 tests, 전부 Pass | 10 suites / **72 tests**, 전부 Pass | 변경 없음(AC-C-3 회귀 재확인) |
| `apps/widget` 테스트 | 5 suites / 26 tests, 전부 Pass | 5 suites / **26 tests**, 전부 Pass | 변경 없음(AC-U-10 회귀 재확인) |
| 타입체크 | — | `apps/api`/`apps/web` 둘 다 clean | 신규 fixture/spec의 타입 오류 0건 |
| **합계** | 64 suites/files, 453 tests | **73 suites/files, 493 tests** | 전부 Pass, **실패 0건** |

**결론**: 이번 시험에서 **실제 코드 결함(버그)은 발견되지 않았다.** 코드리뷰가 명시적으로 인계한 공백 4건(신규 화면·컨텍스트 테스트 0건 / `ResourcePickerField`·`ChangePasswordForm`·`UserFilterBar` 미검증 / `@Public()` 표본 점검 / 보안 핵심 시나리오 회귀 고정)을 전부 자동시험으로 메웠고, 그 과정에서 기존 구현이 요구사항·설계 문서와 정확히 일치함을 확인했다. 요구사항 문서(`security-audit.md` AC-C-4)와 설계서(DD-45)의 `@Public()` 개수 표기 불일치(4개 vs 5개) 1건을 문서 정합성 관찰사항으로 발견해 §4에 기록했다(코드 결함 아님, Low 등급에도 못 미치는 문서 표기 차이).

---

## 2. 실행 커맨드 및 결과

```
pnpm --filter @chat-bot/api test               # 29 suites, 263 tests, 전부 Pass (~18s)
pnpm --filter @chat-bot/api typecheck           # clean
pnpm --filter @chat-bot/web test                # 31 files, 132 tests, 전부 Pass (~12s)
pnpm --filter @chat-bot/web typecheck           # clean
pnpm --filter @chat-bot/dialogue-engine test    # 10 suites, 72 tests, 전부 Pass (~5s)
pnpm --filter @chat-bot/widget test             # 5 suites, 26 tests, 전부 Pass (~2s)
```

실패 0건 / 스킵 0건. 이 그룹은 4개 워크스페이스(api/web/dialogue-engine/widget) 전체에 걸쳐 있어 4개 스위트를 모두 재실행해 회귀를 확인했다(다른 3개 워크스페이스는 이 그룹에서 코드를 변경하지 않았으므로 재실행은 "영향 없음"을 확인하는 목적이다).

---

## 3. 코드리뷰 인계 공백 처리 (요청받은 4개 항목)

### 3.1 공백 ① — 신규 화면·컨텍스트 전용 자동화 테스트 0건

`apps/web/src/pages/auth/`(로그인/L2/L3/L4), `apps/web/src/pages/settings/`(U1 회원관리/B1 금지어관리/A1 이력관리), `apps/web/src/context/AuthContext.tsx`에 대한 자동시험이 구현 완료 후에도 전혀 없었다. 신규 11개 파일로 다음 수용기준을 커버했다.

| AC | 시나리오 | 신규 파일 |
|---|---|---|
| **AC-U-2** | 로그인 화면을 키보드만으로 완료 | `src/pages/auth/LoginPage.spec.tsx` — autoFocus 이메일에서 시작해 Tab만으로 비밀번호 표시토글→비밀번호 입력→제출버튼까지 이동, Enter로 제출(마우스 클릭 0회) |
| **AC-U-4** | 세션만료 시 작성 중이던 폼 데이터가 화면 전환 없이 보존 | `src/context/AuthContext.session-expiry.spec.tsx` — 실제 `AuthProvider`+`apiClient`를 함께 동작시켜 저장 중 401→입력값 유지+재로그인 모달→재인증 성공 시 **원 요청 자동 재시도까지 성공**, 취소 시에도 입력값 보존 확인 |
| **AC-U-6** | 403 접근거부 시 주소창이 시도한 경로를 유지 | `src/components/security/RequirePermission.spec.tsx` — `useLocation` 프로브로 경로가 실제로 바뀌지 않음을 직접 단언(리다이렉트가 아니라 같은 라우트에서 콘텐츠만 대체 렌더됨을 구조적으로 검증) |
| **AC-U-9** | `postForm` 등 401 자동재시도 훅 | `src/api/client.spec.ts` — GET과 `postForm`(multipart) 양쪽 모두 401→재로그인→원 요청 1회 재시도, 재로그인 취소 시 원 401 유지, 동시 다발 401은 모달 1회만 |
| **AC-U-11** | axe 접근성 스캔 위반 0건 | `UsersPage.a11y.spec.tsx`/`BannedWordsPage.a11y.spec.tsx`/`AuditLogsPage.a11y.spec.tsx`(각 데이터/빈상태 2케이스, 총 6케이스) — 기존 그룹의 axe 인프라(jest-axe, `color-contrast` 비활성화 패턴)를 그대로 재사용 |

부수적으로 `AuthContext.spec.tsx`(부팅 시 `/auth/me` 1회, 로그인/로그아웃 상태 전환, `can()`이 서버 `permissions[]`만 근거로 판정)도 추가해 L0 게이트 자체의 회귀를 방지했다.

### 3.2 공백 ② — 2차 리뷰 Low 관찰사항 3건

| 관찰사항 | 신규 파일 | 검증 내용 |
|---|---|---|
| (a) `ResourcePickerField`의 `resourceType='chatbot'` | `src/components/ResourcePickerField.spec.tsx` | `chatbotId` prop 없이도 전역 `chatbotsApi.list`/`findOne`을 호출함(다른 4종처럼 챗봇 스코프 API를 잘못 호출하지 않음)을 확인 |
| (b) `ChangePasswordForm`의 401 코드 분기 | `src/pages/auth/ChangePasswordForm.spec.tsx` | `INVALID_CREDENTIALS`→필드 오류(로그아웃 안 함) vs `SESSION_EXPIRED`/`ACCOUNT_DISABLED`→즉시 로그아웃(EX-12-8)이 실제로 분기됨을 확인. 코드 없는 401 폴백, 정상 성공 경로, 비밀번호 불일치도 함께 커버 |
| (c) `UserFilterBar`의 상태 체크박스 힌트 | `src/pages/settings/users/UserFilterBar.spec.tsx` | 0개/2개 선택 시 폴백 힌트가 나타나고 정확히 1개일 때만 사라짐을 확인 |

### 3.3 공백 ③ — `public-decorator-count.spec.ts` 전수 스캔 보강

1차 리뷰가 "알려진 핸들러만 점검한다"고 지적한 지점이다. `apps/api/src/common/auth/public-decorator-count.spec.ts`에 세 번째 `it`를 추가해, `find apps/api/src -iname "*.controller.ts"`로 확인한 **17개 컨트롤러 전부**를 import하고 각 프로토타입의 모든 프로퍼티를 순회해 `@nestjs/common/constants`의 `PATH_METADATA`(라우트 핸들러 판별)와 `IS_PUBLIC_KEY`(공개 여부)를 조합, 실제 `@Public()` 총개수를 센다. 결과는 정확히 `[AuthController#login, AuthController#logout, HealthController#check, PublicConversationController#getConfig, PublicConversationController#sendMessage]` 5건으로, 설계서(DD-45)가 확정한 값과 일치했다(AC-C-4).

**유지보수 주의사항**: 이 전수 스캔은 신규 런타임 의존성(예: `ts-morph`, glob 기반 자동 파일 탐색)을 도입하지 않기 위해 컨트롤러 목록을 코드에 명시적으로 import하는 방식을 택했다. 따라서 **신규 컨트롤러 파일이 추가되면 이 스펙의 import 목록도 함께 갱신**해야 스캔이 계속 전수로 유지된다 — `자동시험_전략.md` §4.5 항목 2에 다음 우선순위로 기록했다.

### 3.4 공백 ④ — 보안 핵심 시나리오 회귀 방지

아래 시나리오는 전부 **기존에 이미 자동시험으로 고정돼 있었음을 이번 시험에서 재확인**했다(신규 작성이 필요했던 것은 AC-12D-5 1건뿐이다):

| 시나리오 | 자동화 위치 | 결과 |
|---|---|---|
| 계정 열거 방지(로그인 실패 시 항상 동일 문구) | `security-audit.integration.spec.ts`("AC-12A-2") | Pass — 미존재 이메일과 틀린 비밀번호가 완전히 동일한 401 응답 |
| 5회 실패 시 계정 잠금 | 〃("AC-12A-4") | Pass |
| 마지막 ADMIN 보호(LAST_ADMIN) | 〃("AC-12C-5/AC-12C-6/C-2") | Pass — 유일한 ACTIVE ADMIN 강등은 409, 2명 이상이면 200 |
| 감사로그 append-only(수정/삭제 API 부재) | 〃("이력에는 수정/삭제 API가 존재하지 않는다") | Pass — `PATCH`/`DELETE /audit-logs/:id` 둘 다 404 |
| 관리자 시뮬레이션에는 금지어 필터 미적용(AC-12D-5) | 〃("AC-12D-5") — **이번 시험에서 신규 추가** | Pass |

---

## 4. 발견사항(코드 결함 아님) — 문서 정합성 관찰

`security-audit.md`(요구사항 정의서) AC-C-4는 "`@Public()`이 부착된 핸들러는 정확히 **4개**다"라고 서술하지만, 같은 그룹의 설계서(`security-audit-설계.md` DD-45)는 `POST /auth/logout`을 공개 경로로 추가 확정하며 **5개**로 갱신했다(§8.2 근거 명시). 실제 구현·기존 테스트·이번에 보강한 전수 스캔 테스트 전부 **5개** 기준으로 일관되게 작성돼 있어 **동작상 문제는 없다** — 다만 요구사항 정의서 원문의 숫자가 설계 단계의 갱신을 반영하지 못한 상태로 남아 있다. 코드를 수정할 사안이 아니라 문서 갱신 사안이므로 직접 고치지 않았고, 이 보고서와 `시험항목.md`의 AC-C-4 행에 그 사실을 명시했다. 필요 시 `requirements-analyst`/`system-architect`가 `security-audit.md` §7의 문구를 "정확히 5개"로 정정하는 것을 권고한다.

이 외에 **오류검출_프로세스.md 기준의 등급 분류가 필요한 결함은 발견되지 않았다.**

---

## 5. 남은 시험 커버리지 공백 (다음 순위)

이번 시험은 코드리뷰가 명시적으로 인계한 4개 공백 처리에 집중했다. 그 과정에서 추가로 식별한, 아직 자동화되지 않은 항목은 `시험항목.md`의 "보안/이력(No.12~13) 상세 시험항목" 표 하단 "미자동화 항목 요약"과 `자동시험_전략.md` §4.5에 정리했다. 그중 우선순위가 가장 높은 것은:

1. **AC-13-7(9개 도메인 모듈 전수 소급 증명)** — 현재는 `ChatbotGroup` 1개 모듈만 통합 테스트로 대표 검증되어 있다. 나머지 8개 모듈(chatbots/intents/keywords/homonyms/contexts/dialog-nodes/faqs/channels)의 감사 소급 기록은 code-reviewer의 코드 리뷰로만 확인된 상태다.
2. 회원 관리 3종 화면(`CreateUserModal`/`ChangeRoleModal`/`BannedWordFormModal`)의 실제 CRUD 종단 플로우(제출→API 호출→토스트) 전용 시험.
3. AC-U-5/AC-U-7(VIEWER 로그인 시 쓰기 버튼·시스템설정 메뉴가 실제로 DOM에서 빠지는지)의 전용 렌더 시험.
4. AC-12A-9/AC-12C-9/10(비밀번호 변경·계정 비활성화·초기화가 **다른 세션**을 실제로 끊는지) 멀티세션 통합 시험.

---

## 6. 커밋 전 사용자가 알아야 할 사항

- **결함 0건.** 회귀 0건(api 263 / web 132 / dialogue-engine 72 / widget 26, 총 493 tests 전부 Pass).
- 이번 시험은 **테스트 코드만** 추가/보강했다(`apps/api/src/integration/security-audit.integration.spec.ts`에 `it` 1건, `apps/api/src/common/auth/public-decorator-count.spec.ts`에 `it` 1건, `apps/web`에 신규 파일 11개 + `apps/web/src/test/fixtures.ts`에 픽스처 팩토리 7개 추가). **프로덕션 코드는 한 줄도 수정하지 않았다.**
- §4의 문서 정합성 관찰사항(AC-C-4 "4개" vs 실제/설계 "5개")은 버그가 아니라 요구사항 문서 표기 문제이며, 커밋 대상에 포함할지(문서만 정정) 여부는 `requirements-analyst` 또는 사용자 판단이 필요하다.
- `docs/04-test/시험항목.md`/`시험데이터.md`/`자동시험_전략.md`를 이 그룹 몫으로 확장했다(전면 재작성 없음, 기존 3개 그룹 섹션은 그대로 유지).
- 다음 단계(`git-manager` 커밋)는 사용자 승인 시 진행된다.
