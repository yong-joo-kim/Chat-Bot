# ADR-0012 — `apps/widget`은 런타임 의존성 0의 순수 TS로 만들고, 표시 로직만 서브패스로 공유한다

- **상태**: 채택 (Accepted)
- **일자**: 2026-09-20
- **결정자**: system-architect (스코프 판단 J-3는 PM 승인 완료)
- **관련**: `docs/requirements/quality-channel.md` §1.3 J-3, §4.3, DD-24, DD-25, FR-W-1 ~ FR-W-24, NFR-P5, NFR-M1, NFR-M4, NFR-A1, NFR-A8, AC-W-*, EX-W-*
- **영향 범위**: `apps/widget/**`(신규), `packages/shared-types/{package.json, src/output-view.ts, src/contrast.ts}`, `apps/web/src/lib/contrast.ts`, `pnpm-workspace.yaml`(자동 포함), 루트 스크립트
- **관계**: 개발명세서 §2가 예고한 `apps/widget`(경량 번들 <100KB)을 실제 스캐폴딩한다. `chatbot-operations-설계.md` §7.9의 임베드 스니펫 계약을 **변경 없이 구현**한다.

## 맥락

`EmbedCodeService`는 `{WIDGET_BASE_URL}/widget.js` 스니펫을 생성하고 관리자 화면은 복사 버튼까지 제공하지만, **그 URL에는 아무것도 없다.** AC-4-7~4-10은 "문자열 생성"만 검증해 통과한 상태이며, 현재 시스템은 **관리자에게 동작하지 않는 코드를 배포하게 만들고 있다.** 위젯이 없으면 No.11은 "설정 화면만 있는 기능"이 되고, `ConversationLog`는 영구히 0건이라 No.2/14/15/24/44가 모두 같은 빈 상태 문제를 이어받는다.

따라서 `apps/widget`을 최소 버전으로 만들되, **기술 선택 2건**을 먼저 확정해야 한다.

1. **스택(DD-25)**: 팀 컨벤션(React+Vite, `apps/web`과 동일)을 따를 것인가, 번들 예산(gzip 100KB)을 우선할 것인가.
2. **렌더러 공유(DD-24)**: 관리자 콘솔 시뮬레이터와 위젯이 **동일 렌더 규칙**을 써야 하는데(FR-10-6, NFR-M1), 콘솔은 React이고 위젯은 스타일 격리·번들 제약이 있어 컴포넌트를 그대로 공유할 수 없다.

두 문제는 얽혀 있다. `packages/shared-types`는 **zod에 의존**하고(gzip ≈13KB), 공유 로직을 거기에 두면 위젯이 zod를 번들에 끌고 온다.

## 결정

### 1. 스택 — 런타임 의존성 0의 순수 TypeScript + Vite 라이브러리 모드(IIFE)

**React를 쓰지 않는다.** 빌드 도구(Vite)·언어(TS)·테스트(Vitest)·린트는 `apps/web`과 **동일하게 유지**해 팀 컨벤션 이탈을 최소화한다.

| 근거 | 내용 |
|---|---|
| 번들 예산 | React + ReactDOM만으로 gzip ≈45KB다. 100KB(NFR-P5, AC-W-17) 중 절반을 프레임워크가 쓰면 예산이 **상시 리스크**가 되고, 이후 어떤 기능 추가도 "예산 협상"이 된다. 의존성 0이면 실측 15~25KB로 **여유가 구조적으로 생긴다** |
| Shadow DOM | 스타일 격리(FR-W-12)에 Shadow DOM을 쓰는데, React의 이벤트 위임은 shadow 경계에서 별도 검증 부담을 만든다. 순수 DOM은 이 문제가 없다 |
| 화면 복잡도 | 위젯의 화면은 **1개**(런처 + 패널)이고, 라우팅은 `data-fullscreen` 플래그 1개뿐이다. 프레임워크가 해결해 줄 문제(라우팅·대규모 상태·리스트 diff)가 사실상 없다 |
| 테스트 | FR-W-16은 "DOM 무의존 단위 테스트 가능한 형태"를 요구한다. 이는 **"순수 로직 / DOM 적용" 분리**로 달성되며 프레임워크와 무관하다. 오히려 `core/`(순수) + `ui/`(DOM) 분리가 강제되어 테스트 가능성이 올라간다 |
| 호스트 침투 | 고객사 페이지에 얹히는 코드다. 프레임워크 런타임·전역 폴리필이 적을수록 충돌 표면이 작다 |

상태 관리는 `store + reducer + render(state)` 단방향 패턴으로 구현해 **React 멘탈 모델을 유지**한다(팀원이 읽을 때의 인지 비용 완화).

### 2. 빌드 타깃 2종과 **번들 예산 게이트**

| 타깃 | 산출물 | 비고 |
|---|---|---|
| 임베드 로더 | **`dist/widget.js`**(파일명 고정, 해시 없음) | IIFE, CSS를 TS 문자열로 인라인(별도 CSS 요청 0건). 기존 스니펫 계약(FR-W-2)을 지키려면 파일명이 고정이어야 한다 |
| 전체화면 | `dist/index.html` + 해시 번들 | `/c/:slug`(FR-W-3). 정적 호스팅에 `/c/*` → `index.html` SPA fallback 필요 |

`build` 스크립트 마지막에 **`scripts/check-bundle-size.mjs`(node `zlib`만 사용, 의존성 0)** 를 실행해 `widget.js`의 gzip 크기가 100KB를 넘으면 **빌드를 실패시킨다.** AC-W-17을 리뷰가 아니라 CI가 강제한다.

**`EmbedCodeService`는 수정하지 않는다.** 위젯이 기존 계약(`data-chatbot`/`data-api-base`/`data-mode`/`data-fullscreen`)을 구현하는 쪽이며, AC-4-7~4-10 기존 테스트는 그대로 통과한다.

### 3. 스타일 격리 — Shadow DOM `mode:'open'`

- **네임스페이스 접두사로는 부족하다**: 호스트의 `* { box-sizing }`, `img { max-width:100% }`, `button { all: unset }` 같은 **요소 선택자 규칙**은 클래스 접두사로 막을 수 없다.
- **`open`을 쓰는 이유**: `closed`는 스크린리더·axe·디버깅 도구 호환성 문제를 만든다. NFR-A8(axe 대비 위반 0건)을 만족시키려면 검사 가능해야 한다. 호스트가 shadowRoot에 접근할 수 있다는 위험은, 위젯이 **호스트의 DOM·쿠키·localStorage를 읽지 않는다**는 반대 방향 보장(FR-W-13, NFR-S8)과 짝을 이룬다.
- **제약(구현 필수 사항)**: `aria-labelledby`/`for`/`aria-controls`는 shadow 경계를 넘지 못한다. **모든 id 참조를 shadow 내부에서 완결**시킨다.
- **폴백**: `attachShadow` 미지원 시 네임스페이스 클래스 + 루트 `all: initial`로 degrade.
- **전역 심볼 1개**(`window.__ChatBotWidget`). 이미 있으면 `console.warn` 후 초기화 중단(EX-W-3, EX-W-4).

### 4. 공유는 **zod 무의존 모듈 + 서브패스 export**로 한다 (DD-24 ③안)

```
packages/shared-types/src/output-view.ts   # (신규) 아웃풋 → 표시 모델 / 버튼 액션 판정 / PAUSE 일정 / URL 안전성
packages/shared-types/src/contrast.ts      # (신규) apps/web/src/lib/contrast.ts 이동(FR-4-6 재사용 → FR-W-22)
```

```jsonc
"exports": {
  ".":             { "types": "./dist/index.d.ts",       "default": "./dist/index.js" },
  "./output-view": { "types": "./dist/output-view.d.ts", "default": "./dist/output-view.js" },
  "./contrast":    { "types": "./dist/contrast.d.ts",    "default": "./dist/contrast.js" }
}
```

- 두 모듈은 `import type`만 사용하므로 **컴파일 산출물에 zod가 존재하지 않는다.**
- `apps/web/src/lib/contrast.ts`는 **re-export 셔임**으로 남긴다 → 기존 import 경로와 `contrast.spec.ts`가 **수정 없이** 통과한다.
- `apps/widget`에 ESLint `@typescript-eslint/no-restricted-imports`(`allowTypeImports: true`)로 **`@chat-bot/shared-types` 루트의 값 import를 금지**한다. 번들 예산 회귀를 사람이 아니라 린트가 막는다.
- **마크업은 공유하지 않는다.** 콘솔은 React 컴포넌트, 위젯은 DOM 직접 조작. 공유되는 것은 "무엇을 어떤 순서로 보여줄지"를 정하는 **순수 변환 규칙**뿐이다.

### 5. 위젯은 `packages/dialogue-engine`을 의존하지 않는다

위젯은 해석하지 않고 서버 결과만 렌더한다. 엔진을 번들에 넣으면 ① 예산이 무너지고 ② **대화 자산 매칭 규칙이 클라이언트에 노출**된다. 공개 API 2개 외에는 어떤 API도 호출하지 않는다(FR-W-13).

## 근거

- **번들 예산은 "노력 목표"가 아니라 계약이다.** 고객사 페이지에 얹히는 스크립트의 크기는 고객사의 성능 지표에 직접 반영된다. 예산을 프레임워크가 먼저 절반 소비하면, 이후 기능 요청마다 "위젯에는 못 넣는다"는 답을 반복하게 된다. **의존성 0은 예산을 협상 대상에서 제외**시킨다.
- **컨벤션 일관성의 실질은 "스택 이름"이 아니라 "개발 경험"이다.** 명령어(`dev`/`build`/`test`/`lint`), 언어, 빌드 도구, 테스트 러너, 린트 규칙, 디렉터리 관례가 같다면 팀원의 이동 비용은 대부분 해소된다. 남는 차이는 "JSX 대신 DOM API"뿐이며, 화면 1개짜리 앱에서 이는 감당 가능한 수준이다.
- **패키지를 새로 만들지 않고 서브패스를 쓰는 이유**: 신규 패키지는 `package.json`·`tsconfig`·`vitest.config`·린트·CI 등록 5벌이 늘어난다. 공유 대상은 모듈 2개이며, `shared-types`에는 이미 런타임 헬퍼(`normalizeText`, `paginated`, `csvEnumArray`)가 들어 있어 파일 성격에도 어긋나지 않는다. `exports` 맵 3줄이 같은 문제를 더 싸게 푼다.
- **`contrast.ts`를 옮기는 것이 FR-W-22의 실질이다.** "No.4의 대비 계산 로직을 재사용"하려면 재사용 가능한 위치에 있어야 한다. 셔임을 남기므로 기존 코드 변경은 0줄이다.
- **`mode:'open'`이 접근성 요구와 정합한다.** 이 위젯은 `UIUX_준수기준.md` **(a) 대상 그 자체**이며(NFR-A1), axe 자동 스캔(NFR-A8)이 수용기준이다. 검사할 수 없는 DOM은 이 기준을 만족시킬 수 없다.

## 대안과 트레이드오프

| 대안 | 기각 사유 |
|---|---|
| React + Vite (`apps/web`과 동일) | gzip ≈45KB를 프레임워크가 소비. 100KB 예산이 상시 리스크가 되고 Shadow DOM 검증 부담이 추가된다 |
| Preact (gzip ≈4KB) | 예산 문제는 해결되지만 **"React도 아니고 순수 TS도 아닌 제3의 스택"** 이 되어 컨벤션 일관성 논거가 오히려 약해진다. 화면 1개에 가상 DOM의 이익도 작다 |
| Lit / Web Components 라이브러리 | 추가 런타임 의존성 + 데코레이터 빌드 설정. Shadow DOM은 라이브러리 없이도 쓸 수 있다 |
| iframe 완전 격리 | 격리는 가장 강하지만 ① 초기 로딩·런처 애니메이션 비용 ② 호스트 페이지와의 크기 협상(postMessage) ③ 모바일 전체화면 처리 복잡도가 **최소 버전의 범위를 넘는다**. 요구사항 §9.3이 명시적으로 제외 |
| `packages/widget-core` 신규 패키지 | 설정 5벌 추가. 공유 대상이 모듈 2개뿐이라 과설계 |
| 렌더러를 각 앱에 복제(DD-24 ②) | NFR-M1 위반. 두 벌은 반드시 갈라지고, "시뮬레이터에서 본 것과 실제 위젯이 다르다"는 No.10의 존재 이유를 무너뜨린다 |
| `shared-types`를 zod 무의존으로 전면 개편 | 영향 범위가 전 프로젝트다. 이번 문제의 해결에 필요한 최소 변경이 아니다 |
| 위젯에서 zod를 써서 서버 응답을 검증 | 응답 검증은 서버 계약 테스트(AC-C-1)의 책임이다. 클라이언트 재검증은 13KB를 쓰고 얻는 것이 "방어적 렌더"뿐인데, 그건 타입 가드 몇 줄로 충분하다 |

**감수하는 비용**
① 팀 표준 스택(React)에서 앱 1개가 이탈한다 — 명령어·언어·도구·디렉터리 관례를 동일하게 유지하고, 이 ADR을 근거로 남긴다.
② JSX 없이 DOM을 조작하므로 UI 코드가 다소 장황해진다 — 렌더러를 아웃풋 타입별 파일로 쪼개(`ui/renderers/*.ts`) 각 파일을 작게 유지한다.
③ 향후 위젯 기능이 크게 늘면(상담원 전환 No.24, 파일 첨부 No.33) 프레임워크가 필요해질 수 있다 — 그 시점에 Preact 도입을 재검토한다. `core/`(순수)와 `ui/`(DOM)가 분리돼 있으면 교체 범위는 `ui/`로 한정된다. **[2026-09-25 No.24 — 트리거 미발동]** 상담원 전환(상담 전용 폴링·관찰 창·상담원 말풍선·연결/종료 안내·새로고침 복구)은 `core/handoff-poll.ts`(순수 폴링 로직)·`core/handoff-storage.ts`(봉투와 분리된 저장 키) 신설과 `ui/` 수정으로 흡수되어 **vanilla TS·런타임 의존성 0을 유지**한다(gzip 100KB 게이트 통과 전제, 증가분은 빌드 로그 보고 — ADR-0036). 이 트리거는 파일 첨부(No.33)·리치 상담 메시지(No.46) 시점으로 남는다.
④ `shared-types`에 `exports` 맵이 생겨 딥 import 경로가 고정된다 — 현재 딥 import 사용처가 0건이라 회귀 위험이 없다.

## 결과

- `apps/widget/` 신규: `src/{loader.ts, fullscreen.ts, api/, core/, ui/, styles.ts, constants/messages.ts}`, `vite.config.ts` + `vite.config.loader.ts`, `scripts/check-bundle-size.mjs`.
- `packages/shared-types`: `src/output-view.ts`·`src/contrast.ts` 신규 + `package.json` `exports` 맵 추가.
- `apps/web/src/lib/contrast.ts`: re-export 셔임으로 축소(기존 테스트 무수정 통과).
- 루트 스크립트: `pnpm -r build|test|lint`가 `apps/widget`을 자동 포함한다(`pnpm-workspace.yaml`의 `apps/*`, NFR-M4).
- 환경변수: `VITE_PUBLIC_API_BASE_URL`(전체화면 빌드 전용). 임베드 모드는 `data-api-base`에서 주입받으므로 이 값을 쓰지 않는다.
- `frontend-implementer` 인계: `core/`는 DOM 없이 단위 테스트(FR-W-16), `ui/`는 최소한의 jsdom 테스트, 접근성은 §9.5 매핑표(설계서)를 체크리스트로 사용.
- `test-automation` 인계: AC-W 18건 중 브라우저 통합이 필요한 항목을 최소화하고, `store`/`pause-schedule`/`button-action`/`session`/`output-view`를 순수 테스트로 커버한다.
- **배포 인계**: `widget.js` 파일명 고정 → `Cache-Control: max-age=300, must-revalidate` 권고, `/c/*` SPA fallback 필요. `docs/05-ops/자동배포.md`에 기록.


---

## 갱신 (2026-09-25 — No.44: 답변 평가 버튼 · vanilla 유지 · 감수 비용 ③ 트리거 미발동)

피드백 기반 개선 루프(No.44, **ADR-0038 §1**). 스택·격리·서브패스 공유 결정은 **불변**이다.

1. 위젯이 요청 `features`에 `'feedback-v1'`을 더 싣고, 서버가 `feedback.rateable`로 표시한 봇 말풍선(보류 턴은 `READY`/`FAILED` 최종 말풍선)에만 버튼 2개를 붙인다. 인사말·대기 문구·로컬 정리 문구·시스템·오류·상담원 말풍선에는 없다.
2. 로직은 `core/feedback.ts`(응답 결과 → 재시도·표시 결정 순수 함수 — 첫 `404`도 1초 뒤 1회 재시도)와 `ui/feedback-bar.ts`(DOM)로 나눈다. 평가 상태는 DOM에만 두며 `sessionStorage`·`localStorage`를 쓰지 않는다.
3. 메시지 목록(`role="log"`, `aria-relevant="additions"`)에 새 노드를 추가하지 않고 속성(`aria-pressed`) 변경과 상태 영역(`#cb-status`) 1회 안내로 알린다.
4. **감수 비용 ③(Preact 재검토) 트리거는 발동하지 않는다** — 런타임 의존성 0 · gzip 100KB 게이트 유지 · 증가분(예상 2KB 이하)은 빌드 로그로 보고한다.
