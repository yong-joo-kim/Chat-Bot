# 품질/채널(No.10~11) 시험 결과 보고서

> **대상**: `docs/requirements/quality-channel.md`(No.10 응답 테스트/시뮬레이션, No.11 다양한 채널 제공) + 엔진 보강(FR-E2, `resolveByNodeId`/`resolveTurn`/`pendingClarify`) + 신규 `apps/widget`
> **시험 수행일**: 2026-09-20 · **수행**: test-automation
> **선행 상태**: backend-implementer/frontend-implementer 구현 완료, code-reviewer 리뷰 완료(High 2건 — 오버레이 body-parser 크기제한 수정·PII마스킹 문서정정 / Medium 다수 — SIM1-D 3진입점 전체 연결·위젯 ESLint가드 — 전부 재작업 완료)
> **범위**: `apps/api`(통합 스펙에 신규 `it` 3건 + 신규 import 추가), `packages/dialogue-engine`(변경 없음, 회귀 확인만), `apps/web`(신규 컴포넌트 시험 6개 파일), `apps/widget`(신규 DOM 시험 1개 파일 + jsdom 도입), `apps/api/prisma/seed.ts`(seed 결함 1건 수정)

---

## 1. 요약

| 구분 | 이전(baseline) | 이후 | 비고 |
|---|---|---|---|
| `apps/api` 테스트 | 16 suites / 174 tests, 전부 Pass | 16 suites / **177 tests**, 전부 Pass | `quality-channel.integration.spec.ts`에 신규 `it` 3건 추가(오버레이 크기 경계값 2건 + 레이트리밋 429 1건) + 기존 5개 성공응답 케이스에 zod 계약검증(`.parse()`) 보강. 기존 테스트 전부 무변경 유지 |
| `packages/dialogue-engine` 테스트 | 10 suites / 72 tests, 전부 Pass | 10 suites / **72 tests**, 전부 Pass | 변경 없음(회귀 확인만) — FR-E2 엔진 보강은 이미 `turn.spec.ts`/`conversation-state.spec.ts`/`overlay.spec.ts`로 구현 단계에서 테스트되어 있었음 |
| `apps/web` 테스트 | 14 files / 75 tests, 전부 Pass | 20 files / **94 tests**, 전부 Pass | 신규 컴포넌트 시험 6개 파일(19 tests) — 시뮬레이터 멀티턴/되묻기/노드점프, A/B비교 diff, 채널카드 aria-disabled, SIM1-D 드로어 3진입점 |
| `apps/widget` 테스트 | 5 suites / 19 tests, 전부 Pass | 5 suites / **26 tests**, 전부 Pass | 신규 `ui/app.spec.ts`(7 tests) — jsdom Shadow DOM 마운트, 런처/패널/메시지렌더/버튼클릭/Esc 전 과정. `jsdom`을 devDependency로 신규 추가 |
| **합계** | 45 suites/files, 340 tests | **51 suites/files, 369 tests** | 전부 Pass, **실패 0건** |

**결론**: 이번 시험에서 **실제 코드 결함(버그)은 발견되지 않았다.** 다만 (a) code-reviewer가 지목했던 오버레이 크기(100KB~2MB) 통합테스트 공백을 메웠고 그 과정에서 테스트 부트스트랩 자체의 body-parser 설정도 프로덕션(`main.ts`)과 정렬시켰다, (b) 공개 API 레이트리밋(429) 가드가 실제로 배선되어 동작함을 최초로 HTTP 레벨에서 확인했다, (c) 이 그룹 통합 테스트에 있던 "성공 응답 zod 계약검증 부재"라는 구조적 공백을 메웠다, (d) 대화설계(No.5~9) 그룹 seed의 기존 결함(컨텍스트 슬롯명 한글)을 발견해 직접 수정했다. 상세는 §3~§5.

---

## 2. 실행 커맨드 및 결과

```
pnpm --filter @chat-bot/api test               # 16 suites, 177 tests, 전부 Pass (~13s)
pnpm --filter @chat-bot/dialogue-engine test    # 10 suites, 72 tests, 전부 Pass (~4.2s)
pnpm --filter @chat-bot/web test                # 20 files, 94 tests, 전부 Pass (~8s)
pnpm --filter @chat-bot/widget test             # 5 suites, 26 tests, 전부 Pass (~1.8s)
```

실패 0건 / 스킵 0건. 신규 통합 테스트(31회 연속 HTTP 요청을 포함하는 AC-P-12)까지 포함해 `apps/api` 전체 실행 시간은 13초 내외로 CI 부담이 크지 않다.

---

## 3. `apps/api` — code-reviewer 지적사항 및 커버리지 공백 보강

### 3.1 오버레이 요청 본문 크기(FR-10-21) — code-reviewer High 지적사항, 최우선 처리

**배경**: `assertOverlaySize()`가 오버레이 1MB 상한을 코드로 강제하고 있었지만, 이를 실제 HTTP 페이로드로 검증하는 통합 테스트가 없어 수동 curl로만 확인된 상태였다. 더 심각하게는, NestJS 기본 body-parser 상한(약 100KB)이 오버레이 1MB 상한보다 작아서 **100KB~1MB 사이의 정상 크기 오버레이 요청이 우리 오류 봉투가 아니라 Express의 생`413`으로 실패하는** 잠재적 결함이 있었다. `main.ts`는 이를 `bodyParser: false` + `useBodyParser('json', {limit:'2mb'})`로 이미 수정해 두었으나(prod), **통합 테스트가 부팅하는 Nest 앱은 이 설정을 반영하지 않고 있었다.**

**조치**:
1. `quality-channel.integration.spec.ts`의 앱 부트스트랩을 `main.ts`와 동일하게 `createNestApplication<NestExpressApplication>({bodyParser:false})` + `useBodyParser(...'2mb')`로 정렬.
2. 신규 테스트 2건 추가:
   - 약 200KB(100KB 초과, 1MB 미만) 오버레이 → `200` 정상 처리(과거 기본 100KB 상한에 막히던 시나리오의 회귀 방지).
   - 약 1.08MB(1MB 초과, 2MB 미만) 오버레이 → `400 LIMIT_EXCEEDED`(생`413`이 아님을 오류 코드로 명시 검증).
3. 크기 제어는 의도 예문 배열(항목당 최대 200자, 최대 500개)을 ASCII로만 채워 문자 수(zod 기준)와 바이트 수(실 HTTP 기준)를 사실상 일치시켰다(상세 계산 근거는 `시험데이터.md` §10.2).

**결과**: 두 테스트 모두 통과 — 프로덕션 설정(`main.ts`)이 올바르며, 이번 수정으로 테스트 환경도 동일하게 프로덕션 동작을 검증할 수 있게 되었다. **실제 결함은 없었다**(만약 `main.ts` 수정이 없었다면 이번 시험에서 발견되었을 시나리오다).

### 3.2 공개 API 레이트리밋(AC-P-12) — 최초 통합 테스트

기존에는 `rate-limiter.spec.ts`의 `consume()` 순수 함수만 테스트되어 있었고, `PublicRateLimitGuard`가 실제 컨트롤러에 정상 배선되어 `429`+`Retry-After`를 반환하는지는 검증된 적이 없었다. 같은 `sessionId`로 31회 연속 실제 HTTP 요청을 보내 31번째가 `429 RATE_LIMITED` + `Retry-After` 헤더를 반환함을 확인하는 테스트를 신규 추가했다. **통과** — 가드 배선에 결함 없음.

### 3.3 응답 스키마 계약 검증(AC-C-1) 공백 보강

`chatbot-operations`/`dialogue-design` 두 그룹의 통합 테스트는 각 케이스에서 `*Schema.parse(res.body)`로 응답이 zod 스키마를 통과하는지 확인하는 관례가 있었으나, `quality-channel.integration.spec.ts`에는 오류 응답의 `ApiErrorSchema.parse`만 있고 **성공 응답에 대한 스키마 검증이 전무**했다. 대표 성공 케이스 5건에 `SimulateResponseSchema`/`ChannelListItemSchema`/`CompareResponseSchema`/`PublicChatbotConfigSchema`/`PublicMessageResponseSchema.parse()`를 추가했다. **전부 통과** — 실제 API 응답이 계약과 정확히 일치함을 확인했다(구조적 결함 없음).

단, 이 스키마들이 `.strict()`가 아니라서 "여분 필드가 추가되면 실패한다"(AC-C-5, NFR-S1 회귀 방지)는 조건까지는 런타임으로 보장하지 못한다는 한계를 확인했다 — 이는 버그가 아니라 **시험설계상의 한계**이며, `.strict()` 전환 여부는 `system-architect` 판단이 필요한 사항으로 `자동시험_전략.md` §4.4에 기록했다.

---

## 4. `apps/web` — 신규 컴포넌트 시험 6개 파일(19 tests)

| 파일 | 검증 내용 |
|---|---|
| `SimulatorPanel.spec.tsx`(5) | 멀티턴 대화(첫 턴 `state`가 두 번째 요청에 그대로 실림), 대화 초기화, **동음이의어 되묻기 버튼("선박") 클릭 → 해소 흐름**(화면에서 실제 클릭 이벤트로 재현), **노드 검색→선택→"이 노드로 시작" 클릭 → `buttonAction NODE` 전송**(노드 직접 점프), 드로어 모드 오버레이 배지 |
| `CompareView.spec.tsx`(3) | 오버레이 없을 때 비교 실행 차단 안내, 비교 실행 후 요약 배지 + **변경된 행에만 "변경됨" 배지**(SAME 행은 배지 없음), "달라진 것만 보기" 필터(재요청 없이 클라이언트 필터) |
| `ChannelCard.spec.tsx`(4) | **WEB(IMPLEMENTED) 채널만 토글 활성화 가능**(잠기지 않음), **CONFIG_ONLY(카카오톡) 채널은 `aria-disabled` + 사유 텍스트**(포커스는 받되 클릭해도 요청 안 감), ARCHIVED 챗봇에서 WEB도 잠김, 서버 409 응답 시 토스트 안내 |
| `NodeFormPage.spec.tsx`(2) | SIM1-D 드로어 진입 1/3 — "이 설정으로 테스트" 클릭 시 현재 폼이 `draft-1` 오버레이로 직렬화, `UnsavedGuardContext` 미등록 확인(AC-10-17) |
| `ContextFormPage.spec.tsx`(3) | SIM1-D 드로어 진입 2/3 — 동일 + 드로어를 열어둔 채 폼을 더 고치면 오버레이가 재직렬화됨 |
| `FaqEditModal.spec.tsx`(2) | SIM1-D 드로어 진입 3/3 — 동일 + 모달을 닫으면 드로어도 함께 닫힘 |

드로어 3종 시험은 `SimulatorDrawer`를 가벼운 스텁으로 목킹해 "배선"(overlay 직렬화가 올바른지, guard가 안 걸리는지)만 검증하고, 드로어/시뮬레이터 내부 동작은 `SimulatorPanel.spec.tsx`가 전담해 중복을 피했다. **6개 파일 모두 최초 실행에서 결함 없이 통과했다**(단, 테스트 작성 과정에서 텍스트 매칭 방식 이슈 2건 — 아이콘+텍스트 조합 요소를 정확 문자열이 아닌 정규식으로 매칭해야 함, JS 기본 파라미터가 `undefined` 명시 호출 시에도 적용되는 함정 — 은 테스트 코드 자체의 시행착오였고 프로덕션 코드 결함이 아니다).

---

## 5. `apps/widget` — 신규 DOM 시험(jsdom, 7 tests)

이번 그룹에서 `apps/widget`이 처음 생겼고, 기존 19개 단위 테스트(`core/`, DOM 무의존)에 더해 **DOM 렌더링 시험이 전무한 상태**였다. `jsdom`이 `attachShadow`를 지원함을 확인한 뒤 `apps/widget/package.json`에 devDependency로 추가하고, `ui/app.spec.ts`(파일 단위 `// @vitest-environment jsdom` 오버라이드, 전역 설정은 `node` 유지)를 신규 작성했다.

| 시험 | 검증 내용 |
|---|---|
| Shadow DOM 격리 | 라이트 DOM에는 `#cb-widget-root` 1개만 노출, 내부 마크업(`#cb-launcher`/`.cb-panel`)과 `<style>`은 **light DOM에서 조회 불가**, shadow root 안에서만 조회 가능 |
| 런처 클릭 → 패널 열림 | 클릭 시 `/config` fetch → 패널 `hidden=false` 전환 → 인사말 1회 표시, 퀵리플라이 버튼 렌더 |
| 메시지 렌더링 | 입력→Enter 전송 → 사용자 말풍선 즉시 추가 → `/messages` 응답 도착 후 봇 말풍선 렌더(순서 보장) |
| 버튼 클릭 이벤트 | 퀵리플라이(`MESSAGE`) 클릭 → 해당 텍스트로 서버 전송 확인, `LINK` 버튼 클릭 → `window.open` 호출 + **서버 호출 없음** 확인 |
| Esc → 포커스 복귀 | 패널 닫힘 + `shadow.activeElement`가 런처로 복귀 |

**7개 전부 최초 실행에서 통과했다** — 위젯 조립(`createWidgetApp`)이 설계(FR-W-1~24)대로 동작함을 확인했으며 결함 없음.

---

## 6. seed 데이터 결함 처리 — `apps/api/prisma/seed.ts`

**발견**: `sample-support-bot`의 `커피주문` 컨텍스트 슬롯명이 한글("메뉴"/"사이즈"/"수량")로 되어 있어 `ContextSlotSchema.name` 정규식(`^[A-Za-z0-9_]{1,50}$`)을 위반한다. 이는 **대화설계(No.5~9) 그룹 seed의 기존 결함**이며 이번 품질/채널 그룹이 만든 결함은 아니다(세션 재개 시 frontend-implementer가 이미 유사 계열 미검증 지점을 보고한 바 있음). PATCH 저장은 물론 이 슬롯 정의를 그대로 오버레이로 실으면 시뮬레이션 요청도 `400`이 난다.

**처리 판단: fixture 우회가 아니라 seed를 직접 수정했다.** 근거:
- 이번 그룹의 컨텍스트 시뮬레이션 테스트(`SimulatorPanel.spec.tsx`의 멀티턴 대화)는 자체 mock 응답을 쓰므로 seed 결함의 영향을 받지 않아 "우회"가 무의미했다.
- seed 결함을 방치하면 **수동 검증**(`pnpm --filter @chat-bot/api prisma:seed` 후 콘솔/위젯에서 실제로 "커피 주문" 시나리오를 눌러보는 경로)이 이번 그룹의 최종 산출물인데도 계속 깨진 상태로 남는다.
- 수정 범위가 명확히 국소적이다(`slots[].name` 3개 필드 + `completionMessage` 치환자).

**수정 내용**: `slots[].name`을 `menu`/`size`/`quantity`(영문)로 변경, `label`(화면 표시, "메뉴"/"사이즈"/"수량")은 유지, `completionMessage`를 `'{menu} {size} {quantity}잔 주문을 확인했습니다!'`로 함께 수정(치환 로직이 `slot.name`을 키로 사용하므로 — `packages/dialogue-engine/src/context-session.ts`의 `renderCompletionMessage`). **다른 seed 데이터는 손대지 않았다.**

**영향 범위 확인**: 이 seed는 자동화된 통합/컴포넌트 테스트가 직접 로드하지 않는다(각 그룹 테스트는 seed와 무관하게 자체 fixture를 생성) — `apps/api`/`apps/web`/`apps/widget` 전체 테스트 스위트를 재실행해 회귀가 없음을 확인했다(§2).

---

## 7. 발견된 결함 목록

**없음.** 이번 시험 범위(§3~§5)에서 실행한 모든 신규/기존 테스트가 통과했고, 코드 자체의 기능적 결함(버그)은 발견되지 않았다. §3.1의 오버레이 크기 이슈는 이미 `main.ts`에서 수정이 완료된 상태였고, 이번 시험은 그 수정이 실제로 유효함을 확인 + 회귀 방지 테스트로 고정하는 역할을 했다.

발견된 것은 전부 **시험 커버리지 공백**(코드 결함 아님)이며, `docs/04-test/오류검출_프로세스.md` 기준의 등급 분류(Critical/High/Medium/Low 버그) 대상이 아니다. 참고로 커버리지 공백 목록과 우선순위는 다음 문서에 정리했다:

- `docs/04-test/시험항목.md` — "품질/채널(No.10~11) 상세 시험항목" 표 하단 "미자동화 항목 요약"(AC-10-11/15/16, AC-10B-4/9/11/12, AC-11-6/7/8/11, AC-P-3/9/10/14/15, AC-W-7/11/12/13/16/18, AC-C-2~5, EX-10-6/9, EX-11-3/6/8, EX-W-3/4)
- `docs/04-test/자동시험_전략.md` §4.4 — 다음 자동화 대상 6개 항목(위젯 axe-core 도입, `HomonymEditModal`/전체 CRUD 플로우 시험, Playwright E2E, 스키마 `.strict()` 전환 검토, 개수 상한 계약 테스트, 대시보드-공개API 연계 시험)

---

## 8. 산출물 경로

- `docs/04-test/시험항목.md` — "품질/채널(No.10~11) 상세 시험항목" 신규 절 + TC-10/TC-11 요약행 갱신
- `docs/04-test/시험데이터.md` — §10 품질/채널 시험 데이터 신규 절
- `docs/04-test/자동시험_전략.md` — §3.5(구현 현황) + §4.4(다음 자동화 대상) 신규 절, 버전 v1.2
- `apps/api/src/integration/quality-channel.integration.spec.ts` — 오버레이 크기 경계값 2건, 레이트리밋 1건, 계약검증 보강 5건, body-parser 부트스트랩 정렬
- `apps/api/prisma/seed.ts` — 컨텍스트 슬롯명 결함 수정
- `apps/web/src/pages/chatbot-detail/simulator/SimulatorPanel.spec.tsx`(신규)
- `apps/web/src/pages/chatbot-detail/simulator/CompareView.spec.tsx`(신규)
- `apps/web/src/pages/chatbot-detail/channels/ChannelCard.spec.tsx`(신규)
- `apps/web/src/pages/dialogue/NodeFormPage.spec.tsx`(신규)
- `apps/web/src/pages/dialogue/ContextFormPage.spec.tsx`(신규)
- `apps/web/src/pages/dialogue/components/FaqEditModal.spec.tsx`(신규)
- `apps/widget/src/ui/app.spec.ts`(신규)
- `apps/widget/package.json` — `jsdom` devDependency 추가
