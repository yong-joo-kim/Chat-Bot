# 원클릭 시연 하네스(DT-1) 설계

> **작성**: system-architect · 2026-10-01 · **갱신**: 2026-10-01 1단계 실기동 확인 결과와 설계 정정 13건 반영(§0.1 · §21.2 · §25)
> **입력**: `docs/requirements/demo-harness.md`(FR-0-310~321 · 접두 DH · §1.5~§1.7 · §2.3 시간 예산 · §10 상위 문서 갱신 제안 · 조사 한계) · PM 확정(2026-10-01: 구축형 · 10분 · 1순위 7개 · 권고안 P-1~P-8 전부 채택)
> **근거로 읽은 코드(전체 또는 해당 부분)**: `apps/api/prisma/seed.ts` · `apps/api/src/integration/helpers/ai-guardrails.harness.ts`·`eventual.helper.ts` · `apps/api/jest.isolate-env.js` · `apps/api/src/main.ts`·`app.module.ts`(61행) · `config/env.validation.ts` 전체 · `governance/bootstrap/governance-bootstrap.service.ts`·`lib/residency-check.ts`·`lib/egress-boot-check.ts` · `common/egress/egress-guard.ts` · `common/crypto/env-key.provider.ts` · `common/auth/lib/cookie.ts` · `auth/auth.controller.ts`·`auth.service.ts` · `users/users.service.ts` · `environment/environment.controller.ts`·`approval/switch-approvals.controller.ts`·`core/prod-switch.service.ts`(370~416행)·`core/lib/approval-policy.ts` · `packages/shared-types/src/deploy-schedule.ts`(99~108·141~151·186~204·488~498행)·`prod-switch-approval.ts`·`guardrails.ts`·`handoff.ts`·`security.ts`(218~236행) · `embedding/index/indexer.service.ts` · `answer-settings/answer-settings.service.ts` · `simulation/simulation.service.ts`(165~215행) · `handoff/handoff-transcript.service.ts` · `conversation/guards/public-origin.guard.ts` · `utterance-analysis/upload/utterance-upload.parser.ts` · 컨트롤러 라우트 전수(grep) · `prisma/schema.prisma` `ConversationLog` · `apps/web/src/App.tsx`·`vite.config.ts`·`index.html`·`package.json`·`constants/messages.ts`(답변 설정·학습현황·상담 콘솔·환경·발화 분석 절)·`switchApproval.messages.ts`·`guardrails.messages.ts`·`components/handoff/InterveneButton.tsx`·`pages/handoff-console/LiveSessionListPage.tsx`(15~16행) · `apps/widget/package.json`·`vite.config.ts`·`vite.config.loader.ts`·`src/loader.ts`·`ui/shadow-root.ts`·`ui/message-list.ts`·`constants/messages.ts` · `apps/ml-worker/package.json`·`scripts/run.mjs`·`scripts/setup.mjs`·`pyproject.toml`·`src/ml_worker/config.py`·`app.py`(58~75·272~281·404~406행) · `pnpm-workspace.yaml` · 루트 `package.json`·`eslint.config.js`·`.gitignore`·`tsconfig.base.json` · HF 캐시 `models--nlpai-lab--KURE-v1/refs/main`(존재) · `%LOCALAPPDATA%\ms-playwright`(없음) · `docs/05-ops/자동배포.md` §5.8 등급표(CPU 1문장 P95 126~159ms 개발 PC 실측)
> **정정 근거(2026-10-01 갱신)**: `tools/demo-harness/docs/실기동확인.md`(1단계 실기동 6건 결과 · 정정 목록 13건) · 1단계 구현 `tools/demo-harness/package.json`·`tsconfig.json`·`scripts/run-tests.mjs`·`src/config.ts`·`src/env/api-env.ts`·`src/measure/latency.ts`·`src/preflight/checks.ts`·`src/preflight/index.ts`·`src/build/fingerprint.ts`·`src/cli/args.ts`·`src/proc/residual.ts`·`src/proc/tree-kill.ts`·`src/proc/system.ts`·`src/run/run-dir.ts`·`src/orchestrator/index.ts`·`src/log/terminal.ts` · 루트 `package.json` · `apps/api/package.json`(`multer` 미선언 · `@types/multer`만) · `apps/api/src/{faqs,intents,keywords}/*.controller.ts`·`validation/test-cases.controller.ts`·`utterance-analysis/utterance-analyses.controller.ts`(`import { memoryStorage } from 'multer'`) · `pnpm-lock.yaml`(`multer@2.0.2`)
> **결정 기록**: `docs/02-spec/decisions/ADR-0051-demo-harness-out-of-catalog-workspace-tool-playwright-edge-and-zero-product-change.md`(신규)
> **상위 문서 패치**: `docs/02-spec/demo-harness-patches.md`(1차 — 적용됨) · `docs/02-spec/demo-harness-patches-2.md`(1단계 정정 반영 — 적용 대기)
> **확장(DT-2)**: `docs/02-spec/demo-harness-expansion-설계.md` · ADR-0053 — 풀 투어 프리셋 · 계획 문맥(조건부 단계·활성 예산) · 구간 `voice`/`proactive`/`edge`(단계 접두 `SV`/`SP`/`SE`) · 10분 프리셋 정의 불변
> **범위 원칙**: 이 문서는 코드를 쓰지 않는다. **제품 코드(`apps/*`·`packages/*`) 변경 0 · `data-testid` 추가 0 · 마이그레이션 0 · 새 환경변수 0 · 새 권한 0 · 제품 의존성 변경 0 · CI·실 배포 0.** 저장소 루트 설정 4개(`pnpm-workspace.yaml`·루트 `package.json`·`pnpm-lock.yaml`·`.gitignore`)만 하네스 편입을 위해 바뀐다(§3.3). 하네스가 자식에게 넘기는 하네스 전용 키(`NODE_PATH`·`NO_COLOR`·`CBDEMO_API_PACKAGE_JSON` — §6.2)는 제품 설정 스키마 밖이라 "새 환경변수"가 아니다.
> **실행 한계(작성 당시)**: 이 설계 세션은 셸을 실행할 수 없었다. Playwright·Edge 154·Playwright ffmpeg·`HF_HUB_OFFLINE`·Prisma SQLite 공백 경로·Python `-X` 표식의 실제 동작은 **도구 지식과 파일 존재 확인까지**만 했다 — 구현 첫 작업이 §21.2의 "실기동 확인 6건"이다. **→ 2026-10-01 1단계 구현에서 6건 모두 확인 완료(이 PC 실측 — §21.2).** 확인 과정에서 드러난 설계와 실제의 차이 13건은 구현에 이미 반영됐고 이 문서에 §0.1 표로 모아 각 절에 `[정정 #n]`으로 표시했다.

---

## 0. 한눈에 보기

| # | 결정 | 내용 | 근거 |
|---|---|---|---|
| **DHD-1** | 위치 | **`tools/demo-harness/`** — pnpm 워크스페이스 멤버(`@chat-bot/demo-harness`, private). 스크립트 이름을 `build`·`test`·`dev`가 아닌 `harness:*`로 지어 루트 `pnpm -r build`·`pnpm -r test`·`pnpm dev`(`--filter=./apps/*`)에 **걸리지 않는다** | §3 · ADR-0051 §1 |
| **DHD-2** | 명령 | 루트 **`pnpm demo`**(보이는 시연) · **`pnpm demo:check`**(무인 점검) · 옵션은 `pnpm demo -- --옵션`. **[정정 #1]** 루트 스크립트는 `pnpm -C tools/demo-harness run demo --` 형태(`--filter`는 종료 코드를 1로 납작하게 만든다 — §3.3) | §4 |
| **DHD-3** | 서빙 | 자식 프로세스는 **API(node `dist/main.js`)·ml-worker(venv python) 2개**. 관리 콘솔·위젯·고객사 모형·무대 페이지는 **하네스 프로세스 안의 정적 서버 3개**(콘솔 서버는 `/api` 역프록시 포함)가 **제품 빌드 산출물(`dist`)을 그대로** 서빙 — `vite dev`·`vite preview`를 쓰지 않는다(프록시 3000 고정·`preview.proxy` 미확인 문제 소거, 운영 배포 형태 "정적 파일 + /api 역프록시"와 같음) | §6.1 · 요구사항 J-15 조정 |
| **DHD-4** | 브라우저 | **Playwright `playwright-core`(하네스 전용 의존성) + 설치된 Edge(`channel: 'msedge'`)** · **영속 컨텍스트 1개를 실행 폴더 안 프로필로**(사용자 Edge 프로필 미사용) · **계정 전환 = 실제 로그인으로 받은 세션 쿠키 교체 + 새로고침** · 모든 장면은 하네스 **무대 페이지**(위젯 모형 / 콘솔 `iframe` 분할) 위에서 진행 → **영상 1개·자막 1개** | §8 · ADR-0051 §3 |
| **DHD-5** | 캡처 | 핵심 장면 PNG(전부) · 영상 WebM(Playwright 녹화 — Playwright 전용 ffmpeg 필요, 없으면 경고 후 영상만 생략) · WebVTT(하네스가 직접 작성) · GIF 4개(순수 JS 인코딩 — 외부 인코더 0). **[정정 #6]** ffmpeg가 없으면 Playwright가 컨텍스트 기동 자체를 예외로 실패시키므로 **`recordVideo`를 넘기지 않는 게이트가 필수** | §15 |
| **DHD-6** | 데이터 | **`seed.ts` 미사용 · 데모 전용 데이터셋을 제품 API로 생성.** DB 직접은 **ADMIN1 1명(첫 사용자 생성 API 없음)과 과거 14일 대화 로그(과거 시각 API 없음)** 2가지뿐 | §7 |
| **DHD-7** | ⑤ 챗봇 분리 | **B = 운영 전환·2인 승인·롤백(라이브)** · **C = 예약 배포 전용**(B의 라이브 전환이 예약 기준 버전을 흔들지 않게) | §7.4 · 요구사항 J-7 확장 |
| **DHD-8** | ⑤ 예약 시각 | **이력용 예약 C-1**은 준비 단계 초반에 걸어 준비 중 실제 실행시킴(대체 장면 보장) · **라이브 예약 C-2**는 **진행자가 공연을 시작한 순간(T0)** API로 걸고(`ceilMinute(T0+6분)`) ⑤ 끝에서 실행 결과를 보임 → "진행자가 늦게 시작하면 예약이 지나간다"(EX-DH-6) 문제 소거. 시계 주입 0 | §7.6 · P-5 정제 |
| **DHD-9** | 2인 승인 + 예약 | **코드 확인으로 발견**: 2인 승인이 켜진 챗봇의 예약 전환은 "예약 작성자의 `SCHEDULED_PROD_SWITCH` 승인 요청 + 다른 ADMIN 승인"이 없으면 실행 시 `ENV_APPROVAL_REQUIRED`로 실패한다(`prod-switch.service.ts` 394~415행). C-1·C-2 모두 **ADMIN1 요청 → ADMIN2 승인을 API로** 처리하고 자막·보고서에 공개 | §7.6 |
| **DHD-10** | `.env` 차단 | **4중 방어**: ① 자식 환경을 **빈 상태에서 구성**(부모 `process.env` 상속 0) ② `CHATBOT_API_IGNORE_ENV_FILE=1` ③ API 선적재 스크립트(`-r`)가 `@prisma/client`를 먼저 require해 `.env` 적재를 소진하고 새로 생긴 키를 지움(`jest.isolate-env.js`와 같은 기법) ④ 값 없는 선택 출구 키(`RAG_BASE_URL`·`AUGMENTATION_GEMINI_*`·`AUGMENTATION_LOCAL_BASE_URL`)를 **빈 문자열로 명시**(어떤 `.env` 로더도 덮어쓰지 않음) + 기동 뒤 데이터 지도 API로 사후 확인 | §13.1 |
| **DHD-11** | 거버넌스 모드 | **ON으로 기동 가능 — 코드로 확인**(2026-10-01 실기동으로도 확인): 저장 위치 = 실행 폴더(절대 경로 `file:`) · 출구 허용 = `127.0.0.1:8100` 1개 · 키 미설정이면 키 검사 생략 · 2인 승인 끄기 자동 잠금. 필드 암호화는 **기본 끔**(실행별 키 보관 문제 — PM 확인 Q-4) | §6.3 · §12 |
| **DHD-12** | 300ms 예산 | ml-worker 예열 뒤 **단건 20건 실측(P50/P95)** → P95 ≤ 200ms면 기본 300 유지 · 초과면 `clamp(올림50(P95×2), 400, 2000)`으로 API 재기동 + **시작 자막·보고서 공개** · P95 > 1000ms면 진행자 확인. **[정정 #4]** 모델 적재 직후 앞 구간이 느려 **P95 ≤ 200ms가 될 때까지 최대 3라운드 반복 · 마지막 라운드로 결정 · 모든 라운드 공개** | §14 |
| **DHD-13** | 외부 요청 감시 | 브라우저 컨텍스트의 **모든 비루프백 요청을 차단·기록**(`context.route`) — 관리 콘솔 Google Fonts 요청이 여기서 증거로 잡힌다(결함 후보 **DHX-1** — 실기동에서 `fonts.googleapis.com` 1호스트 차단 확인) · 시연 PC 네트워크 차단 여부를 사전 점검이 관측 | §13 |
| **DHD-14** | 선택자 | **접근성 이름·레이블·역할 기반**(문구 원천 = `apps/web/src/constants/*.messages.ts`) · 위젯 말풍선만 안정 클래스(`cb-msg-bot`·`cb-msg-agent` — 열린 Shadow DOM)를 쓴다 → **`data-testid` 추가 0**. 준비 단계 끝에 **선택자 점검**(모든 장면 화면을 열어 선택자 해석 확인)으로 화면 변경을 공연 전에 잡는다 | §9.3 · §10 |
| **DHD-15** | 시간 관리 | 단계 예산 = **상한이자 목표**: 빨리 끝나면 남은 시간만큼 자막과 함께 화면 유지, 늦으면 다음 생략 가능 단계를 §2.3 순서로 생략 → 총 600±30초 수렴 | §11 |
| **DHD-16** | 보고 | `report/index.html`(외부 자원 0 · `lang="ko"`) + `summary.md` + `result.json`(스키마 v1) · 고객 전달판 옵션 · 종료 코드 0/1/2/130 | §16 · §17 |

### 0.1 설계 정정 13건(2026-10-01 · 1단계 실기동 확인 결과 — 구현에 이미 반영)

근거: `tools/demo-harness/docs/실기동확인.md` "설계 정정 필요 목록". 각 정정은 해당 절 본문에도 `[정정 #n]`으로 반영했다. **제품 코드 변경 0 원칙은 그대로**다 — 정정은 모두 하네스·루트 설정·문서 범위다.

| # | 대상 절 | 원래 설계 | 정정(현재 구현) | 왜(실측 근거) |
|---|---|---|---|---|
| 1 | §0 DHD-2 · §3.3 | 루트 `"demo": "pnpm --filter @chat-bot/demo-harness run demo --"` | **`"demo": "pnpm -C tools/demo-harness run demo --"`** · `"demo:check": "pnpm -C tools/demo-harness run demo -- --mode headless-check"` | `--filter` 경로는 하위 스크립트 종료 코드를 모두 **1로 납작하게** 만들어 0/2/130 구분이 사라진다(FR-DH7-4 위반). `-C` 경로는 코드를 보존한다(실측: 하네스 2 → filter 1 · `-C` 2) |
| 2 | §3.1 · §3.2 · §6.1 · §13.1 | `node dist/cli.js` · `tsconfig` `rootDir src` · 선적재 `dist/runtime/isolate-api-env.cjs` · `harness:test` = `node --test dist/test` | 컴파일 산출물 **`dist/src/cli.js`**(`rootDir "."` — 시험이 같은 `dist` 아래 `dist/test`에 놓이게) · 선적재는 **`src/runtime/isolate-api-env.cjs`를 직접 참조**(`src/config.ts`의 `isolateScript`) · **`harness:test` = `harness:build` 후 `node scripts/run-tests.mjs`**(시험 파일을 모아 `node --test` — 셸 글롭 비의존) | `tsc`는 `.cjs`를 복사하지 않는다 · 윈도 `cmd`는 글롭을 펼치지 않는다 |
| 3 | §6.2 · §13.1 | 자식 환경 = 시스템 허용 목록 + 표 + `CBDEMO_API_PACKAGE_JSON` | API 자식에 **`NODE_PATH=<저장소>/node_modules/.pnpm/node_modules`** · **`NO_COLOR=1`** 추가(하네스 전용 키 3개) | `apps/api`가 `multer`를 값 import하지만 `package.json`에는 `@types/multer`만 있어 `node dist/main.js` 직접 실행이 **`Cannot find module 'multer'`로 기동 실패**. `pnpm run`·`.bin` 셸은 `NODE_PATH`를 넣어 줘서 가려져 있었다 → **제품 결함 후보 DHX-4**(§21.3) |
| 4 | §14 · §5.1 | 단건 20건 1회 측정 | **P95 ≤ 200ms가 될 때까지 최대 3라운드 반복 · 마지막 라운드로 결정 · 모든 라운드를 보고서에 공개** · 사전 점검 **PC-11b**(가용 RAM < 2GiB 경고) 추가 | 모델 적재 직후(가용 RAM 약 4.3GB) 처음 3회 측정이 P95 1.4~1.7초(안정 시의 3~10배) — 1회만 재면 대기 시간을 잘못 올린다 |
| 5 | §3.3 · §23 H0-4 | 잠금 파일 = 하네스 임포터 + 새 패키지 3종 추가(일반 `pnpm install`) | **하네스 추가분만 수동 병합**(+53줄 · 삭제 0) · `pnpm install --frozen-lockfile`·`--lockfile-only`가 재해석 없이 통과함을 확인. **일반 `pnpm install`로 잠금 파일을 다시 쓰지 않는다** | 일반 `pnpm install`이 `apps/web`·`apps/widget`의 `jsdom@25.0.1` 피어(`canvas`) 해석을 바꾸고 기존 스냅샷 1개를 삭제한다(`canvas` 피어는 `pdfjs-dist` 때문에 그래프에 이미 있음) — 제품 임포터 불변 원칙 위반 |
| 6 | §5.1 PC-6 · §15 · §19 | ffmpeg 없으면 영상만 생략 · 반입 `ffmpeg-<버전>` | ffmpeg 없으면 **`recordVideo`를 아예 넘기지 않는다(게이트 필수)** · 반입 대상 **`ffmpeg-1011`(3.49MB) + `winldd-1007`(0.1MB)** · 녹화 파일 이름은 **`page@<해시>.webm`** → 컨텍스트를 닫은 뒤 `video/show.webm`으로 이름 변경 | ffmpeg 없이 `recordVideo`를 넘기면 `Video rendering requires ffmpeg binary` 예외로 **컨텍스트 기동 자체가 실패**한다 |
| 7 | §6.6 · §4.2 `--stop` | 다음 실행이 `cleanedUp` 없는 `pids.json`의 표식 있는 PID를 정리 · `--stop`은 자식 트리 종료 | ① `pids.json`에 **소유 하네스 PID(`harnessPid`)** 기록 — 소유 하네스가 살아 있으면 다음 실행·`--stop`이 그 자식을 정리하지 않는다 ② `--stop`은 **`<실행 폴더>/stop.request` 파일**로 살아 있는 하네스가 스스로 정리하게 하고, 하네스가 없거나 15초 안에 응답이 없으면 하네스를 강제 종료한 뒤 표식 확인 정리 | ① 서버 유지 모드(`--prepare-only`) 실행을 다음 실행이 부수는 사고를 실측으로 발견 ② 정적 서버 3개는 하네스 프로세스 안에 있어 자식 트리 종료만으로는 서버가 남는다 |
| 8 | §5.1 PC-11 | 총 RAM ≥ 16GB | 기준 **16e9 바이트(십진 16GB)** — PC-11a | 16GB 노트북은 OS가 15.8GiB로 보고한다(이 PC 17.0e9 바이트) |
| 9 | §5.2 | 지문 = HEAD + `git status --porcelain` + `dist` 존재 | **변경 파일의 크기·수정 시각을 지문에 포함** | 이미 수정된 파일을 다시 고쳐도 porcelain 문자열은 같아 지문이 안 바뀐다(단위 시험) |
| 10 | §6.5 · §4.2 | (규정 없음) | 인자 해석기가 **단독 `--` 토큰을 무시** | pnpm이 사용자 인자 앞에 단독 `--`를 중복 전달한다(`demo … "--" "--" "--dry-run"`) |
| 11 | §6.6 | `taskkill` 결과 판정 방법 미정 · 표식 대체안 준비 | `taskkill`·`tasklist` 출력은 **CP949라 해석하지 않고 종료 코드(0 성공 · 128 없음)·CSV 형식(`/FO CSV /NH`)으로만 판정** · venv `python.exe`는 **런처 + 자식 인터프리터** 구조(spawn한 PID ≠ 포트 점유 PID — 표식은 둘 다에 있고 `/T`가 둘 다 정리) | 실측 §5 |
| 12 | §3.4 · §23 H0-6 | `pnpm lint` 오류 0 | **`npx eslint tools` 오류 0**(현재 0) · 루트 eslint 설정이 `.cjs`를 무시하지 않으므로 선적재 스크립트에 파일 단위 disable 주석 | 저장소 전체 `pnpm lint`는 **제품 쪽 기존 오류 68건**(하네스 무관)으로 0이 될 수 없다 |
| 13 | §6.5 · §4 | (규정 없음) | 터미널 출력 파이프가 닫혀도(`pnpm demo … \| head` 등 — `EPIPE`) **오류를 삼켜 정리 단계가 끝까지 돈다** | 정리 보장(FR-DH8) — 출력 실패로 하네스가 죽으면 자식이 남는다 |

- 위 13건과 별도로 **PC-10(Ollama) 보강**: 이 PC에서 Ollama가 실제로 실행 중(`ollama.exe` · 11434 수신)이라 경고가 뜬다 → 사용법 문서에 "시연 전 진행자가 Ollama를 끄는 절차"를 넣는다(§5.1 PC-10 · §3.1 사용법 문서).

---

## 1. 공통 원칙과 요구사항에서 조정한 부분

### 1.1 원칙(요구사항 상속)

FR-0-310~321 전부. 특히 **제품 코드 변경 0**(FR-0-310)은 "`data-testid` 추가도 하지 않는다"까지 포함한다(§9.3에서 필요 0을 확인). 하네스가 제품 결함을 발견하면 우회하지 않고 결함 후보로 남긴다(§21.3 DHX-*). **DHX-4(`multer` 미선언)는 하네스가 `NODE_PATH`를 넘겨 기동하지만, 이는 pnpm 실행 래퍼가 하는 것과 같은 해석 경로를 재현하는 것이지 제품 동작을 바꾸는 우회가 아니다** — 결함 자체는 등록하고 수정은 제품 쪽에서 한다(§21.3).

### 1.2 요구사항과 달라진 점(조정 · 이유)

| # | 요구사항 | 이 설계 | 이유 |
|---|---|---|---|
| A-1 | J-15 · FR-DH3-2: 프로세스 5개(API·콘솔 미리보기·위젯 서빙·ml-worker·모형 페이지), 콘솔은 `vite build` + `vite preview` 권고 | **자식 프로세스 2개(API·ml-worker) + 하네스 내부 정적 서버 3개**(콘솔+`/api` 역프록시 · 위젯 · 고객사 모형/무대) | `vite preview`의 프록시 동작이 미확인(EX-DH-11)이고 `vite.config.ts` 10행이 `localhost:3000`을 고정해 포트 대체가 불가능하다. 정적 서버 + 역프록시는 운영 배포 형태와 같고, 포트를 자유롭게 옮길 수 있으며(`--port-offset`), 정리할 자식 프로세스가 줄어든다. 제품이 서빙하는 파일은 제품 빌드 산출물 그대로다 |
| A-2 | FR-DH4-6: 두 컨텍스트를 창 2개 배치 또는 합성 캡처 | **무대 페이지 1장(`localhost:5180/stage`) 안에 고객사 모형(위젯)과 콘솔을 `iframe` 2칸**으로 배치, 브라우저 컨텍스트는 1개 | 창 2개면 영상이 2개로 갈라지고 창 위치 제어가 브라우저 실행 인자 단위라 불안정하다. `localhost:5180`과 `localhost:5173`은 같은 사이트(포트는 사이트 판정에 들어가지 않음)라 `SameSite=Lax` 세션 쿠키가 `iframe`에도 실린다 |
| A-3 | FR-DH3-8: 계정별 브라우저 컨텍스트에 쿠키 주입 | **컨텍스트 1개 + 계정 쿠키 교체**(실제 `POST /auth/login`으로 받은 쿠키) + 콘솔 `iframe` 새로고침 | 같은 이유(영상 1개). 화면 상단 사용자 메뉴가 바뀐 계정 이름을 보여 "다른 사람"임이 드러난다 |
| A-4 | J-7: ⑤용 챗봇 B 1개 | **B(라이브 전환·롤백) + C(예약 전용)** | 2인 승인이 켜진 B에서 예약과 라이브 전환을 섞으면 예약 기준 버전이 라이브 전환으로 바뀌어 예약이 `ENV_POINTER_STALE`로 실패할 수 있다(§7.6) |
| A-5 | FR-DH3-10 · P-5(a): 준비 단계 끝에 "공연 시작 예정 + 6~7분" 예약 | **이력용 C-1(준비 중 실제 실행) + 라이브 C-2(T0에 생성)** | 준비 끝 시점에는 진행자가 언제 엔터를 누를지 모른다. T0에 만들면 예약 시각이 공연 시계에 정확히 맞는다. 최소 5분 규칙(`minLeadMinutes`)은 그대로 지킨다 |
| A-6 | P-5(a) 문구 "예약 → 실행" | 2인 승인이 켜진 챗봇의 예약은 **승인까지 미리 처리해야** 실행된다 | 코드 확인(DHD-9). 자막: "예약과 두 번째 관리자의 사전 승인은 시연 시작 시점에 미리 처리했습니다" |
| A-7 | NFR-DHP2: 준비 ≤ 5분(캐시) | **준비 최소 약 6분**(캐시 있음) · 첫 실행 약 10분(추정) | 이력용 예약 C-1이 "생성 + 최소 5분" 뒤에 실행되기 때문이다(제품 규칙). `--no-history-schedule`이면 약 3분 — 대신 ⑤ 실패 시 대체 장면이 "대기 중 예약" 화면으로 약해진다. (1단계 실측: 사전 점검 3초 + 격리 DB 2초 + 서버 기동·예열·측정 16초 = 약 23초 — `--no-build` · 데이터 단계 전) |
| A-8 | FR-DH1-4 `--from S3-04` 단계 재개 | **구간 단위 재개**(`--resume <runId> --from S3`) — 단계 ID를 주면 그 단계가 속한 구간 처음부터 | 대부분 단계가 앞 단계의 화면 상태에 의존한다. 재개 가능 여부를 단계마다 관리하는 비용 대비 이득이 작다(FR-DH7-3 "상태 의존 단계는 구간 처음부터"의 일반화) |
| A-9 | FR-DH4-11: ④ G1 후보는 "리허설로 고정한 후보만" 승인 | 같은 원칙 + 후보 문구는 **시나리오 정의의 허용 목록**에 두고, 목록에 든 후보가 하나도 안 나오면 그 단계(생략 가능)를 건너뛴다 | G1은 결정론적이지만 의도 예문이 ④·⑦에서 바뀌면 후보가 달라질 수 있다 |
| A-10 | §5.1.3 `ENV_APPROVAL_OFF_LOCKED` "미설정" | 그대로 미설정(거버넌스 ON이면 자동 잠금) | 확인만 — 데모 중 정책을 끌 일이 없다 |
| A-11 | J-17 · §5.1.3 거버넌스 ON | ON + **필드 암호화는 기본 끔**(옵션 `--field-encryption`) | 암호화를 켜면 실행별 키를 재개(`--resume`)를 위해 디스크에 남겨야 한다 — 비밀 보관 원칙(NFR-DHS3)과 충돌. PM 확인 Q-4 |
| A-12 | §1.4 ⑥ 저장본 화면 "architect 확정" | **상담 콘솔 "대화 보기"**(`/handoff-console/:chatbotId/live/:sessionRef`) | 화면에 "개인정보는 자동으로 가려진 상태로 표시됩니다."가 고정 표시되고, 원문은 상담 연결(CONNECTED) 중인 담당자에게만 보인다(`handoff-transcript.service.ts` 46~48·86행) — ⑥의 새 세션은 연결 전이라 저장 마스킹본만 보인다 |
| A-13 | P-6 ⑦(a) "업로드·미리보기는 실시간" | 같음. 단 미리보기 뒤 **분석 시작을 누르지 않고** 미리 완료한 결과로 이동 | 분석은 서버 전체 1건 직렬(`oneAtATime`)이라 공연 중 새 분석을 걸면 무인 점검 등과 겹칠 때 `UTTERANCE_ANALYSIS_BUSY`가 날 수 있다 — 보이는 모드는 새 분석 0 |

---

## 2. 코드 확인 결과 — 요구사항의 "확인 필요" 해소표

| # | 요구사항이 넘긴 질문 | 확인 결과(코드 근거) | 판정 |
|---|---|---|---|
| C-1 | 각 화면의 버튼 문구·선택자(§조사 한계 3) | 전부 `MESSAGES`·`SWITCH_APPROVAL_MESSAGES`·`GUARDRAIL_MESSAGES` 상수에 있다(§10 표에 행 번호 단위로 인용). `apps/**`에 `data-testid` **0건**(grep) — 필요하지도 않다(§9.3) | ✅ 해소 |
| C-2 | ⑥ 저장본을 보여 줄 화면 | 상담 콘솔 "대화 보기" — `transcriptPiiNotice` 문구 · `BOT_TURN.userText = conversationLog.userMessage`(저장 마스킹본) · 원문은 CONNECTED·담당자·만료 전만(`handoff-transcript.service.ts` 46~48·70~77·86행) | ✅ A-12 |
| C-3 | 거버넌스 모드 ON 기동 조건 충족 여부(J-17 · 조사 한계 4) | 기동 검사 3종뿐: ① 저장 위치 — `file:` + **절대 경로** + `DATA_RESIDENCY_ALLOWED_DIRS` 하위(`residency-check.ts` 22~45행) ② 출구 — 설정된 `EMBEDDING_BASE_URL`·`RAG_BASE_URL`·(조건부) Gemini·local 주소가 `DATA_EGRESS_ALLOWED_HOSTS`에 정확 일치(포트 포함, 루프백 자동 허용 없음 — `egress-guard.ts` 107~115행 · `egress-boot-check.ts`) ③ 키 — 키가 없으면 검사 생략(`governance-bootstrap.service.ts` 123·190행). 필드 암호화를 켜지 않으면 키가 필요 없다 | ✅ 환경변수만으로 충족(§6.3) · 2026-10-01 실기동 확인(기동 로그 `데이터 거버넌스 모드=ON · 암호화=꺼짐 · 출구 허용=1개`) |
| C-4 | 위젯 서빙(J-15) | `widget.js`는 로더 빌드 산출물(IIFE, 파일명 고정), 전체화면은 `dist/index.html` + `/c/:slug`(SPA). 스니펫은 `GET /chatbots/:id/embed-code`가 `${WIDGET_BASE_URL}/widget.js` + `data-chatbot` + `data-api-base`로 만든다(`embed-code.service.ts` 29~38행). 위젯은 `attachShadow({mode:'open'})`(Playwright 선택자가 관통) | ✅ 정적 서빙(§6.1) |
| C-5 | ⑤는 별도 환경 모드 챗봇 필요 | 맞다(ADR-0039: 편집이 운영에 안 보임). 추가로 예약은 C로 분리(A-4) | ✅ |
| C-6 | 의미 매칭 켜기와 색인의 순서(FR-DH3-7) | **색인은 `semanticEnabled`와 무관**하다 — 자산 쓰기 시 번들 무효화가 색인을 트리거하고(`indexer.service.ts` 18~21행), `POST …/embeddings/reindex`로 전체 재색인. 켜기는 대화 경로의 사용 여부만 바꾼다(`public-conversation.service.ts` 326행) | ✅ 준비 단계 = 재색인 완료 대기 · 공연 = 토글만 |
| C-7 | `HF_HUB_OFFLINE=1`에서 `revision="main"` 로드(조사 한계 2) | HF 캐시에 `refs/main` 파일이 있다(`models--nlpai-lab--KURE-v1/refs/main`) — 오프라인에서 `main`을 커밋 해시로 풀 수 있는 구조. **실기동 확인은 §21.2 확인 1** | ✅ 2026-10-01 실측 확인(`refs/main` = `8b418a58…` · 해시 폴백 미사용) |
| C-8 | 예약 최소 시간·폴링 | `minLeadMinutes: 5` · `minSpacingMinutes: 1` · 시각은 분 단위로 내림(`OffsetDateTimeSchema` — 초·밀리초 0) · `DEPLOY_SCHEDULE_POLL_INTERVAL_MS` 5000~300000(기본 30000) | ✅ |
| C-9 | 2인 승인 켜기 절차 | `PUT /chatbots/:id/environment/approval` `{required:true, ttlHours}` — 환경 모드 켜짐 + **활성 ADMIN 2명 이상** 필요(`cannotEnableNotEnough`). 거버넌스 ON이면 끄기 잠금(ADR-0049 §2). 즉시 전환 = `POST …/approval/requests {action:'PROD_SWITCH', targetVersionId, expectedProdVersionId}` → 다른 ADMIN `POST …/requests/:id/approve` · 직전 버전 롤백은 승인 면제(`approval-policy.ts` 20~24행) | ✅ |
| C-10 | (신규 발견) 2인 승인 챗봇의 예약 | 예약 실행 시 이 예약에 묶인 `APPROVED`·`outcome=SCHEDULED` 요청이 없으면 `ENV_APPROVAL_REQUIRED`(`prod-switch.service.ts` 394~415행). 예약 승인 요청은 **예약 작성자만** 보낼 수 있고(`switch-approval.service.ts` 360~361행) 만료는 `min(요청+TTL, 예약 시각)` | ✅ DHD-9 |
| C-11 | 위험 응답 규칙 시뮬레이터 | 규칙 폼의 "문장으로 시험하기"(`guardrails.messages.ts` 158~174행) + API `POST …/guardrails/test` — ⑥의 생략 가능 장면으로만 쓴다. 분류 `MEDICAL_ADVICE` · 적용 `INBOUND` · 동작 `REPLACE`(대체 문구 필수) | ✅ |
| C-12 | 발화 묶음 분석 업로드 | 파일 입력 레이블 "발화 파일" · CSV(UTF-8) 1열 머리글 "발화"(별칭 utterance/text/문장) · 2열 발생 횟수 · 3열 메모(`utterance-upload.parser.ts` 25·68~79행) · 서버 전체 1건 직렬 · 챗봇당 보관 최대 20 | ✅ 고정 CSV(§7.8) |
| C-13 | 상담 콘솔 목록 갱신 주기(조사 한계 3) | 진행 중 목록·상세 모두 **5초 폴링**, 문서가 숨김 상태면 30초(`LiveSessionListPage.tsx` 15~16·61~66행) → 보이는 모드에서 **브라우저 창을 최소화하면 30초로 느려진다**(진행자 안내) | ✅ 대기 상한 15초(§10) |
| C-14 | 세션 쿠키 형태 | 이름 `cb_session` · `Path=/api` · `HttpOnly` · `SameSite=Lax` · 운영만 `Secure`(`cookie.ts`) · 세션은 IP·UA에 묶이지 않는다(`session.service.ts` — 기록만) | ✅ 쿠키 교체 가능(2026-10-01 실기동 확인 — 확인 6) |
| C-15 | 비밀번호 변경 강제 우회 | `POST /users`는 항상 `mustChangePassword:true` + 임시 비밀번호 1회 반환(`users.service.ts` 60~80행) → 하네스가 그 계정으로 로그인해 `POST /auth/password`(변경 강제 예외 경로)로 무작위 비밀번호로 바꾸면 `mustChangePassword:false`가 된다(`auth.service.ts` 147~184행) — **제품 경로 그대로** | ✅ §7.2 |
| C-16 | 공개 대화 Origin | WEB 채널 `allowedOrigins`가 비어 있지 않으면 서버가 Origin을 인가한다(`public-origin.guard.ts`) → 데모 챗봇 WEB 채널 허용 목록 = 고객사 모형 출처 1개(보안 설정 시연 겸) | ✅ |
| C-17 | 관리 콘솔 외부 요청 | `apps/web/index.html` 7~11행 Google Fonts 3줄이 **관리 콘솔의 유일한 외부 요청**(`apps/web` 소스 전체 `https://` grep — 나머지는 시험 파일·placeholder) · 위젯은 글꼴을 불러오지 않는다(`styles.ts` 8행은 이름만 참조) | ✅ DHX-1 |
| C-18 | ml-worker `/health`의 `device` | 실제 장치가 아니라 **설정값 `EMBEDDING_DEVICE`를 그대로 돌려준다**(`app.py` 274·280행) → "GPU 미사용" 증거로 단독 사용 불가 | ✅ §12에서 `CUDA_VISIBLE_DEVICES=-1` 병행 |
| C-19 | ml-worker `.env` 읽기 | `pydantic-settings`가 **현재 작업 폴더의 `.env`**를 읽는다(`config.py` 14행). 패키지는 venv에 편집 설치(`pip install -e`)라 다른 폴더에서도 import된다(`setup.mjs` 54행) → 작업 폴더를 실행 폴더로 두면 개발자 `.env`가 읽히지 않는다 | ✅ §6.4 |
| C-20 | (2026-10-01 실기동 중 발견) `apps/api` 직접 기동 시 모듈 해석 | `apps/api/package.json`에 `multer`가 없고(`@types/multer`만) 5개 컨트롤러가 `import { memoryStorage } from 'multer'`(값 import)를 한다 — pnpm 엄격 `node_modules`에서 `node dist/main.js` 직접 실행은 `Cannot find module 'multer'`. `pnpm run start`·`.bin` 셸은 `NODE_PATH`에 `node_modules/.pnpm/node_modules`를 넣어 줘 가려진다 | ✅ 하네스는 `NODE_PATH` 전달(§6.2) · 제품 결함 후보 DHX-4(§21.3) |

---

## 3. 저장소 위치 · 패키지 구조

### 3.1 디렉터리

```
Chat Bot/
├── tools/                                  # [신설] 카탈로그 밖 개발·영업 도구(DT) — 납품물 아님
│   └── demo-harness/                       # DT-1 원클릭 시연 하네스 (@chat-bot/demo-harness, private)
│       ├── package.json                    # scripts: demo · harness:build · harness:test · harness:typecheck
│       ├── tsconfig.json                   # extends ../../tsconfig.base.json · outDir dist · rootDir "." · include src, test [정정 #2]
│       ├── scripts/run-tests.mjs           # [정정 #2] dist/test/**/*.test.js를 모아 node --test (셸 글롭 비의존)
│       ├── docs/실기동확인.md               # 1단계 실기동 확인 6건 결과(2026-10-01)
│       ├── src/
│       │   ├── cli.ts                      # 진입점 → 컴파일 산출물 dist/src/cli.js [정정 #2]
│       │   ├── cli/                        # 인자 해석(단독 `--` 무시 — 정정 #10)
│       │   ├── orchestrator/               # 단계 오케스트레이션 · 종료 코드 · --stop(stop.request — 정정 #7)
│       │   ├── preflight/                  # node·pnpm·의존성·.venv·HF 캐시·브라우저·ffmpeg·디스크·포트·네트워크·Ollama·메모리·dev.db 지문
│       │   ├── run/                        # 실행 폴더(생성·보존 N개·state.json·pids.json — harnessPid 포함)
│       │   ├── build/                      # 빌드 지문 캐시(변경 파일 크기·수정 시각 포함 — 정정 #9) · pnpm 하위 명령 실행
│       │   ├── proc/                       # 자식 프로세스(인자 배열) · 로그 파일 · 헬스 대기 · Windows 트리 종료 · 잔존 정리
│       │   ├── env/                        # API·ml-worker 환경 구성(백지 시작) · 외부 송신 점검표 · 시연 설정 공개표
│       │   ├── measure/                    # 단건 지연 실측·결정(최대 3라운드 — 정정 #4)
│       │   ├── log/                        # 터미널 출력(EPIPE 삼킴 — 정정 #13) · 로그 파일
│       │   ├── runtime/isolate-api-env.cjs # API 선적재(-r) — .env 적재 소진·제거. tsc가 복사하지 않으므로 이 경로를 직접 참조 [정정 #2]
│       │   ├── servers/                    # 정적 서버(콘솔+역프록시 · 위젯 · 모형/무대) — node:http만
│       │   ├── data/                       # 데모 데이터셋 정의(TS 상수) · API 생성기 · DB 직접 2종 · 보정 게이트
│       │   ├── browser/                    # Edge 기동 · 쿠키 교체 · 무대 제어 · 자막 띠 · 외부 요청 감시 · 캡처 · GIF
│       │   ├── scenario/                   # 시나리오 정의 형식(types) · 실행기(시간 관리·생략·일시정지·대체)
│       │   ├── scenarios/                  # opening · s1~s7 · closing (단계 정의)
│       │   ├── selectors/                  # console.ts · widget.ts — 선택자 단일 출처
│       │   ├── presets/                    # customer-onprem-10m.ts (30분 프리셋은 파일 추가만)
│       │   ├── report/                     # result.json 스키마(zod) · HTML · 마크다운 · VTT · 비밀 제거
│       │   └── util/                       # waitFor(eventual.helper.ts 규약) · jsonRequest · 시각(KST) · 비밀 제거 · 비밀번호 생성
│       ├── assets/                         # 고객사 모형 HTML · 무대 HTML · 시스템 구성 카드 · 로드맵 · 보고서 CSS(인라인용)
│       ├── fixtures/
│       │   └── utterances-demo.csv         # ⑦ 고정 발화 200행(UTF-8)
│       └── test/                           # node:test 단위 시험(§20) → dist/test
├── .demo-runs/                             # [무시 목록] 실행 폴더(최근 5개) — 커밋 0
```

- **`apps/demo`를 쓰지 않는 이유**: 루트 `dev` 스크립트가 `--filter=./apps/*`라 `pnpm dev`에 끌려 들어가고, `apps/`는 "납품 앱" 자리라 진행률·카탈로그와 혼동된다(ADR-0051 대안 3).
- **사용법 문서**: `docs/05-ops/시연_하네스.md`(NFR-DHM3) — 구현 단계에서 backend-implementer가 신규 작성(이 설계가 목차를 §4·§5·§21에서 정한다). **필수 포함(2026-10-01 추가)**: ① 시연 전 진행자 확인 — **Ollama 종료**(작업 표시줄 트레이 → 종료 · `ollama.exe` 프로세스·11434 수신이 사라졌는지 확인 — PC-10) · 메모리를 많이 쓰는 프로그램 종료(PC-11b) ② 영상 녹화용 ffmpeg 반입(`ffmpeg-1011`·`winldd-1007` — §19) ③ 유지 중인 실행 정리(`pnpm demo -- --stop latest` — §6.6) ④ 남은 수동 확인 항목(§21.2 끝).

### 3.2 `package.json`(하네스) 규약

| 항목 | 값 | 이유 |
|---|---|---|
| `name` · `private` | `@chat-bot/demo-harness` · `true` | 게시 0 |
| 스크립트 | **[정정 #2]** `demo`(= `pnpm run harness:build && node dist/src/cli.js`) · `harness:build`(`tsc -p tsconfig.json`) · `harness:test`(= `pnpm run harness:build && node scripts/run-tests.mjs` — `dist/test/**/*.test.js`를 모아 `node --test`) · `harness:typecheck`(`tsc -p tsconfig.json --noEmit`) | **`build`·`test`·`dev`·`lint`·`typecheck` 이름 금지** — 루트 재귀 명령에 끌려가지 않게. 시험 실행기를 스크립트로 둔 이유: 윈도 `cmd`는 글롭을 펼치지 않고, Node 20/24의 `--test` 디렉터리 인자 동작이 다르다 |
| 컴파일 배치 | **[정정 #2]** `tsconfig` `rootDir "."` · `include ["src","test"]` → `dist/src/**`·`dist/test/**`. `.cjs`(선적재 스크립트)는 `tsc`가 복사하지 않으므로 **`src/runtime/isolate-api-env.cjs`를 원본 경로로 참조**(`src/config.ts` `isolateScript`) | 시험이 같은 `dist` 아래에서 `src` 산출물을 상대 경로로 import |
| `dependencies` | `playwright-core` **`1.63.0`**(정확 버전 고정, `^` 금지) · `pngjs` `7.0.0` · `gifenc` `1.0.3` · `zod`(이미 잠금 파일에 있는 버전 범위 `^3.23.8`) · `@chat-bot/shared-types: workspace:*` | 브라우저 자동화 · GIF · 결과 스키마 · 제품 상수(`DEPLOY_SCHEDULE_LIMITS`·`validatePasswordPolicy`·`toKstDayBucket`·`normalizeEmail`) 재사용 |
| `devDependencies` | `typescript`(제품과 같은 범위) · `@types/node` · `@types/pngjs` `6.0.5` | 새 내려받기 최소 |
| 설치 스크립트가 있는 의존성 | **0** — `playwright-core`·`pngjs`·`gifenc`·`@types/pngjs`는 `preinstall/install/postinstall`이 없다(2026-10-01 확인) | `pnpm-workspace.yaml` `allowBuilds` **불변** |

### 3.3 저장소 루트 변경(제품 코드 아님 — 목록 고정)

| 파일 | 변경 | 제품 영향 |
|---|---|---|
| `pnpm-workspace.yaml` | `packages:`에 `"tools/*"` 1줄 추가 | 없음 — `allowBuilds` 불변 |
| 루트 `package.json` | **[정정 #1]** `scripts`에 `"demo": "pnpm -C tools/demo-harness run demo --"` · `"demo:check": "pnpm -C tools/demo-harness run demo -- --mode headless-check"` 2줄 | `build`·`test`·`dev`·`lint` 불변 |
| `pnpm-lock.yaml` | `importers['tools/demo-harness']` 추가 + 새 패키지(`playwright-core`·`pngjs`·`gifenc`·`@types/pngjs`)의 `packages`/`snapshots` 항목 — **[정정 #5] 하네스 추가분만 수동 병합(+53줄 · 삭제 0)** | `apps/*`·`packages/*` 임포터 항목·기존 스냅샷 불변(H0-4 — 확인 완료) |
| `.gitignore` | `/.demo-runs/` 1줄(패치 H-7) | 없음 |

- **[정정 #1] 왜 `-C`인가**: `pnpm --filter <pkg> run demo`는 하위 스크립트가 어떤 코드로 끝나든 pnpm 자신의 종료 코드를 **1**로 돌려준다(2026-10-01 실측: 하네스 2 → 루트 1). 그러면 FR-DH7-4(0 통과 · 1 단계 실패 · 2 준비 실패 · 130 중단)를 CI·스크립트가 구분할 수 없다. `pnpm -C <dir> run demo`는 그 폴더에서 스크립트를 직접 돌려 코드를 그대로 전달한다(실측 2 → 2). 단위 시험(`harness:test`)은 0/1만 의미가 있어 `--filter` 형태로 불러도 된다.
- **[정정 #5] 잠금 파일 운영 규칙**: 하네스 임포터를 추가한 뒤 일반 `pnpm install`을 돌리면 pnpm이 그래프를 재해석하면서 **`apps/web`·`apps/widget`의 `jsdom@25.0.1` 피어(`canvas`) 해석을 바꾸고 기존 스냅샷 1개를 삭제**한다(`canvas` 피어는 `pdfjs-dist` 때문에 이미 그래프에 있음). 이는 제품 임포터 불변 원칙(H0-4) 위반이다. 따라서
  1. 하네스 의존성을 바꿀 때는 **하네스 임포터와 새 패키지 항목만 손으로 병합**하고, `pnpm install --frozen-lockfile`이 통과하는지(재해석 0)와 `git diff pnpm-lock.yaml`에 삭제 줄이 0인지 확인한다.
  2. `pnpm install --lockfile-only`가 파일을 바꾸지 않는지도 함께 확인한다(1단계 확인 완료).
  3. 제품 의존성 변경(예: DHX-4 수정)으로 잠금 파일 재해석이 불가피하면, 그 변경은 **제품 쪽 커밋에서 별도로** 다루고 `jsdom` 피어 해석 변화가 `apps/web`·`apps/widget` vitest 결과에 영향 없는지 확인한다(§21.3 DHX-4).

### 3.4 제품 빌드·시험 비영향 보장

| 경로 | 보장 방법 | 확인(체크리스트) |
|---|---|---|
| 루트 `pnpm -r build` · `pnpm -r test` · `pnpm build` · `pnpm test` | 하네스에 `build`·`test` 스크립트가 없다 → pnpm 재귀가 건너뜀 | H0-5: 하네스 추가 전후 `pnpm -r test` 대상 패키지 목록 동일 |
| `pnpm dev` | `--filter=./apps/*` | 자동 |
| lint | 하네스 `src/**/*.ts`는 **린트 대상에 포함**(제외하지 않음 — 품질 유지) · `dist/`·`assets/*.html`·`*.js`는 기존 무시 규칙. **[정정 #12]** 루트 eslint 설정은 `.cjs`를 무시하지 않으므로 `src/runtime/isolate-api-env.cjs`에 파일 단위 disable 주석 | **H0-6(정정): `npx eslint tools` 오류 0**(현재 0). 저장소 전체 `pnpm lint`는 **제품 쪽 기존 오류 68건**(하네스 무관)이 있어 기준으로 쓸 수 없다 — 하네스 추가 전후 제품 오류 수가 같음(68)만 확인 |
| `apps/api` jest · `apps/web` vitest | 하네스 파일을 import하지 않음 · 하네스는 제품 시험 파일을 import하지 않음 | 정적 검사 H-S1(§20) |
| 제품 의존성 트리 | 하네스 의존성은 하네스 `package.json`에만 · 잠금 파일은 하네스 추가분만 수동 병합(§3.3) | H0-4 |
| `apps/api/prisma/dev.db` | 하네스는 이 경로를 계산·열람하지 않음 + DB 경로 가드(§18) | AC-DH1-6 |

---

## 4. 명령 인터페이스

### 4.1 명령

| 명령(저장소 루트 · PowerShell/Git Bash 공통) | 하는 일 |
|---|---|
| `pnpm demo` | 프리셋 `customer-onprem-10m` · **보이는 시연**(사전 점검 → 준비 → "시연 준비 완료 · 엔터" → 공연 10분 → 보고서 → 정리) |
| `pnpm demo:check` | 같은 프리셋 · **무인 점검**(창 숨김 · 사람 속도·자막·영상 없음 · 검증 + 스크린샷 · 종료 코드) |
| `pnpm demo -- --옵션…` | 아래 옵션 |

- `pnpm demo`는 매번 하네스 `tsc`(약 3초)를 먼저 돈다(`demo` 스크립트 = `harness:build` 후 실행).

### 4.2 옵션

| 옵션 | 기본 | 설명 |
|---|---|---|
| `--mode visible\|headless-check` | `visible` | FR-DH1-3 |
| `--preset <id>` | `customer-onprem-10m` | 프리셋 파일(`src/presets/<id>.ts`) |
| `--only s1,s5` | 전부 | 구간 선택(시작·끝 포함 여부는 `opening`·`closing` 키로) — 선택 구간에 필요한 데이터는 전부 준비 |
| `--skip S1-06,S4-03` | 없음 | 생략 가능 단계만 지정 가능(핵심 단계 지정 시 시작 전 오류) |
| `--prepare-only` | 끔 | 준비까지 하고 "서버 유지 중" 안내 후 대기(개발자 조사용 · 정리는 Ctrl+C 또는 `--stop`). 대기 중 1초마다 `<실행 폴더>/stop.request`를 확인한다(§6.6) |
| `--no-teardown` | 끔 | 공연 후 서버 유지 · 종료 명령 안내(FR-DH8-4) |
| `--stop <runId\|latest>` | — | 유지 중인 실행 정리. **[정정 #7]** 소유 하네스가 살아 있으면 `stop.request` 파일을 써서 하네스가 스스로 정리하게 하고(최대 15초 대기), 하네스가 없거나 응답이 없으면 하네스를 강제 종료한 뒤 표식 확인 정리(§6.6) |
| `--resume <runId\|latest> --from <S3\|S3-04>` | — | 같은 실행 폴더로 구간 단위 재개(A-8) — 서버가 꺼져 있으면 같은 DB로 재기동(마이그레이션·데이터 생성 생략) · 계정 비밀번호는 격리 DB에서 새로 발급(§7.2) |
| `--runs-dir <경로>` | `<저장소>/.demo-runs` | 실행 폴더 루트(공백 경로 문제는 2026-10-01 확인 4에서 없음 확인 — 옵션은 유지) |
| `--keep-runs <n>` | 5 | 오래된 실행 폴더 정리 개수(FR-0-314) |
| `--port-offset <n>` | 0 | API 3000 · 콘솔 5173 · 위젯 5174 · ml-worker 8100 · 모형/무대 5180을 일괄 이동(DHD-3 덕분에 가능 — FR-DH2-2의 "대체 포트는 architect 판단") |
| `--browser msedge\|chrome\|chromium\|<실행 파일 경로>` | `msedge` | §8.1 폴백 사다리 |
| `--viewport 1920x1080` | `1920x1080` | NFR-DHA2 · 작은 노트북은 `1600x900` 권고 |
| `--no-video` · `--no-gif` | 켬(visible) | 영상·GIF 끄기(headless는 기본 끔) |
| `--rebuild` · `--no-build` | 지문 판단 | 빌드 강제 · 빌드 생략(산출물 없으면 사전 점검 실패) |
| `--require-offline` | 끔 | 외부망이 열려 있으면 **중단**(기본은 경고 + 진행자 확인 — P-8(b) 리허설 고려) |
| `--no-history-schedule` | 끔 | 이력용 예약 C-1 생략(준비 시간 단축 · A-7) |
| `--wait-live-schedule` | 끔(headless) | 무인 점검에서도 C-2를 만들고 실행까지 기다림(+최대 7분) |
| `--fail-fast` | 끔 | headless — 첫 실패에서 중단(FR-DH4-8) |
| `--field-encryption` | 끔 | 거버넌스 필드 암호화 켬(실행별 키 · A-11) |
| `--embedding-timeout-ms <n>` | 실측 결정 | 실측 대신 지정(보고서에 "수동 지정" 공개) |
| `--appendix-llm` | 끔 | headless 전용 부록 — Ollama 예문 늘리기 "동작 확인"(FR-DH10-3 · visible이면 오류) |
| `--customer-copy` | 끔 | 고객 전달판 보고서 추가 생성(FR-DH6-3) |
| `--dry-run` | 끔 | 프로세스·브라우저 없이 **계획만** 출력: 단계표·예산·생략 순서·선택자 목록·환경변수 공개표(값은 비밀 제외) · 종료 코드 0 |
| `--verbose` | 끔 | 하네스 로그 상세 |

- **[정정 #10] 단독 `--` 토큰**: pnpm은 `pnpm demo -- --dry-run`을 하위 스크립트에 넘길 때 사용자 인자 앞에 단독 `--`를 중복해서 붙인다(`… "--" "--" "--dry-run"`). 인자 해석기는 **단독 `--` 토큰을 모두 무시**한다(옵션 값으로도 받지 않음). 하네스 옵션 중 값으로 `--`가 필요한 것은 없다.

### 4.3 종료 코드(FR-DH7-4)

`0` 전부 통과(대체·생략은 통과로 보되 보고서에 표시) · `1` 단계 실패 1건 이상 · `2` 사전 점검/빌드/기동/데이터 준비 실패 · `130` 중단(Ctrl+C·진행자 종료 키·창 닫힘). **[정정 #1]** 루트 `pnpm demo`·`pnpm demo:check`가 이 코드를 그대로 돌려주려면 루트 스크립트가 `pnpm -C` 형태여야 한다(§3.3).

### 4.4 진행자 제어(FR-DH1-5)

| 키(터미널이 TTY일 때 — PowerShell·Windows Terminal) | 줄 명령(TTY가 아닐 때 — Git Bash mintty 등, 입력 후 엔터) | 동작 |
|---|---|---|
| `Enter` | (빈 줄) | 준비 완료 뒤 공연 시작 |
| `Space` | `p` | 일시정지/재개(일시정지 시간은 예산 계산에서 제외 · 자막 "잠시 멈춤") |
| `n` | `n` | 현재 단계 건너뛰기 — **생략 가능 단계만**(핵심이면 무시 + 터미널 안내) |
| `s` | `s` | 다음 구간으로(현재 구간의 남은 핵심 단계는 "진행자 생략"으로 기록) |
| `q` | `q` | 종료 확인(`y`) → 정리 · 종료 코드 130 |

- TTY 판정은 `process.stdin.isTTY`. mintty에서는 원시 키 입력이 안 되므로 줄 명령으로 자동 전환하고 시작 시 안내한다(NFR-DHC1).
- 한국어 출력: TTY면 Node가 콘솔 API로 UTF-16을 쓰므로 코드 페이지와 무관하게 표시된다. 파이프 출력·로그 파일은 UTF-8(NFR-DHC3).
- **[정정 #13] 출력 파이프가 닫힐 때**: `pnpm demo -- --dry-run | head`처럼 읽는 쪽이 먼저 닫히면 표준 출력 쓰기가 `EPIPE`로 실패한다. 터미널 출력기는 출력 스트림의 `error`를 삼켜 하네스가 죽지 않게 하고, 정리 단계(§6.6)가 끝까지 돈다. 로그 파일 기록은 계속된다.

---

## 5. 실행 단계

```
P0 사전 점검 ─▶ P1 실행 폴더·격리 DB ─▶ P2 빌드(지문 캐시) ─▶ P3 기동(ml-worker ∥ API ∥ 정적 서버 3)
   ─▶ P4 데모 데이터(API 생성 + DB 직접 2종) ─▶ P5 보정 게이트·예열·선택자 점검 ─▶ [이력 예약 C-1 실행 대기]
   ─▶ 준비 완료(엔터 대기 · visible) ─▶ T0 처리 ─▶ 공연(시작·①~⑦·끝) ─▶ 보고서 ─▶ 정리
```

| 단계 | 내용 | 실패 시 | 시간(추정 · 리허설로 보정) |
|---|---|---|---|
| **P0** 사전 점검 | §5.1 표 | 차단 항목 → 종료 2(무엇·왜·어떻게 고치나 출력) / 경고 항목 → 요약 표시 후 계속(visible은 진행자 확인) | 5~20초(1단계 실측 약 3초) |
| **P1** 실행 폴더 | `.demo-runs/<YYYYMMDD-HHmmss>-<4자>/` 생성 · `pids.json`에 `harnessPid` 기록 · 이전 실행 잔존 프로세스 정리(§6.6) · 오래된 폴더 정리 · `node <prisma CLI JS> migrate deploy`(작업 폴더 `apps/api`, 환경 = 백지 + `DATABASE_URL` + `CHECKPOINT_DISABLE=1` + `PRISMA_HIDE_UPDATE_MESSAGE=1`) — `db push` 금지(CLAUDE.md) | 종료 2 | 5~15초(1단계 실측: 마이그레이션 54개 3.2초 · 단계 약 2초) |
| **P2** 빌드 | 지문(§5.2)이 같으면 생략. 다르면 순서대로: `shared-types` → `pii-mask` → `dialogue-engine` → `apps/api`(`prisma generate && tsc`) → `apps/web`(`tsc --noEmit && vite build`) → `apps/widget`(전체화면·로더·번들 크기 검사) → 하네스 | 종료 2(빌드 로그 꼬리 첨부) | 첫 실행 3~5분 · 캐시 0초 |
| **P3** 기동 | ml-worker 기동(예열 대기 상한 180초) ∥ API 기동(잠정 `EMBEDDING_TIMEOUT_MS=300`) ∥ 정적 서버 3개 → API `/api/health` 200 · 정적 서버 응답 확인 → ml-worker `warmedUp=true` 뒤 **단건 지연 실측**(§14 — 최대 3라운드) → 300 유지가 아니면 **API 1회 재기동**(새 값) | 종료 2 · 실측 실패는 EX-DH-4/5 처리 | 30~120초(1단계 실측: 기동~예열~측정 약 16초 — KURE-v1 캐시 있음) |
| **P4** 데모 데이터 | §7 순서 — 계정 → **C + 이력 예약 C-1(가장 먼저)** → A → B → 과거 로그(DB 직접) → 재색인 대기 → 검증 세트 기준 실행 → ⑦ 사전 분석 | 종료 2(어느 생성 호출이 실패했는지 · API 응답 첨부) | 40~90초 |
| **P5** 보정·예열 | 보정 게이트 G-1~G-4(§7.9) · 공연 화면 전부 1회 방문(무대 포함) = **선택자 점검** · 위젯 로더 1회 로드 · 공개 대화 1회 | 보정 게이트 실패·선택자 실패 → 종료 2("데모 데이터 보정 필요"/"선택자 갱신 필요" 분류) | 30~60초 |
| 대기 | 이력 예약 C-1 실행 완료 대기(상한 = 예약 시각 + 폴링 주기 + 60초) → C에 스테이징 v3 승격(라이브 예약 대상) | C-1 실패 → 경고(⑤ 대체 장면이 "실패 이력"이 됨 — 보고서 표기) · 계속 | C-1 생성 후 최대 약 6분(다른 준비와 겹침) |
| 준비 완료 | 요약 1화면(FR-DH1-6 — 프리셋·모드·실행 폴더·포트·브라우저·ml-worker 장치·시연 설정 공개표·외부망 상태·**계정별 비밀번호(터미널만)**) · visible = 엔터 대기 / headless = 즉시 | — | — |
| **T0** | 공연 시작 순간(엔터): 통계 기준값 기록(③) · 라이브 예약 C-2 생성 + ADMIN1 승인 요청 + ADMIN2 승인(API · §7.6) · 영상 녹화는 무대 페이지 첫 로드부터 | C-2 실패 → ⑤ 예약 단계 대체(이력 C-1) | 1~2초 |
| 공연 | §10 · §11 | 단계 실패 → 대체(visible) / 구간 중단(headless) | 600±30초(visible) · 약 4~6분(headless) |
| 보고서 | §17 | 보고서 실패는 종료 코드에 반영하지 않고 터미널에 원인 출력 | 5~20초(GIF 인코딩 포함) |
| 정리 | §6.6 | 재시도 후 남은 것은 다음 실행이 정리 | 5초 이내(1단계 실측: 수 초 이내 · 7회 모두 고아 0) |

### 5.1 사전 점검 항목(FR-DH2)

| # | 항목 | 방법 | 차단/경고 |
|---|---|---|---|
| PC-1 | Node ≥ 20 · pnpm | `process.version` · `npm_execpath`(pnpm 실행 경로 — 없으면 경고 후 셸 폴백 §6.5) | 차단 |
| PC-2 | 의존성 설치 | 하네스·`apps/*` `node_modules` 존재, `playwright-core` 해석 가능 | 차단("`pnpm install`") |
| PC-3 | ml-worker venv | `apps/ml-worker/.venv/Scripts/python.exe` 존재(EX-DH-2) | 차단("`pnpm --filter ml-worker run setup`") |
| PC-4 | KURE-v1 캐시 | `%USERPROFILE%\.cache\huggingface\hub\models--nlpai-lab--KURE-v1\snapshots\*` 1개 이상 + `refs\main` (EX-DH-1) | 차단(자동 내려받기 금지 — `자동배포.md` §5.8-6 반입 안내) |
| PC-5 | 브라우저 | 지정 채널로 headless 기동 → `data:` 페이지 → 스크린샷 1장 → 종료(20초 상한) | 차단(§8.1 폴백 안내) |
| PC-6 | 영상 인코더 | **[정정 #6]** `playwright-core/browsers.json`의 ffmpeg 리비전으로 정확한 폴더를 구해(`playwright-core 1.63.0` = **`%LOCALAPPDATA%\ms-playwright\ffmpeg-1011`**) 그 안 `ffmpeg-win64.exe` 존재 확인. 영상을 쓰지 않는 실행(headless·`--no-video`)이면 정보 | 경고 → 영상만 끔. **없으면 브라우저 기동 시 `recordVideo`를 넘기지 않는다(게이트 필수 — 넘기면 컨텍스트 기동 자체가 예외)** |
| PC-7 | 디스크 | 실행 폴더 드라이브 여유 ≥ 2GB(영상 포함) · 1GB 미만이면 차단 | 경고/차단 |
| PC-8 | 포트 | 5개 포트를 `127.0.0.1`·`::1` 양쪽에서 열어 보기 → 사용 중이면 `netstat -ano -p tcp` 파싱 + `tasklist /FI "PID eq …" /FO CSV /NH`로 점유 프로세스 이름·PID 출력 · `--port-offset` 안내 | 차단(AC-DH1-3) |
| PC-9 | 외부망 | 외부 이름 해석(`dns.lookup`) 3초 + 외부 TCP 연결 1건 3초 — 둘 다 실패 = "차단됨" | 경고(`--require-offline`이면 차단) |
| PC-10 | Ollama | `ollama.exe` 프로세스(`tasklist … /FO CSV /NH`) · 11434 포트 수신 여부(공연 모드) | 경고(J-13 — 진행자가 끄도록 안내 · 하네스는 남의 프로세스를 끄지 않음). **2026-10-01 보강**: 이 PC에서 Ollama가 실제로 실행 중이라 경고가 뜬다 → **사용법 문서(`docs/05-ops/시연_하네스.md`)의 "시연 전 확인"에 Ollama 종료 절차를 넣는다**(트레이 아이콘 → 종료 · 다시 `pnpm demo`로 PC-10 통과 확인). 경고 문구의 "조치"도 같은 절차를 가리킨다 |
| PC-11a | 메모리(총량) | **[정정 #8]** 총 RAM ≥ **16e9 바이트(십진 16GB)**(NFR-DHP4) — 16GB 노트북은 OS가 15.8GiB로 보고하므로 GiB 기준을 쓰지 않는다 | 경고 |
| PC-11b | 메모리(가용) | **[정정 #4 신설]** 가용 RAM < **2GiB**면 경고("모델 적재 직후 단건 지연이 평소의 3~10배로 늘 수 있음 — 메모리를 많이 쓰는 프로그램을 닫고 다시 실행") · 아니면 정보(가용량 기록) | 경고 |
| PC-12 | GPU 정보 | `nvidia-smi -L`(있으면) — 보고서 장비 정보용 | 정보 |
| PC-13 | 작업 트리 | `git rev-parse HEAD` · `git status --porcelain` 변경 유무(EX-DH-20) | 정보 |
| PC-14 | `dev.db` 지문 | `apps/api/prisma/dev.db`의 크기·수정 시각을 **읽기만**(존재하면) — 정리 단계에서 다시 읽어 변화 0을 보고서에 기록(AC-DH1-6) | 정보 |
| PC-15 | 개발자 `.env` 키 이름 | `apps/api/.env`·`apps/ml-worker/.env`의 **키 이름만** 읽어 "차단 대상 키 목록"으로 보고서에 기록(값은 읽지 않음 — 줄을 `=` 앞까지만 해석) | 정보 |

### 5.2 빌드 지문(캐시)

- 지문 = `git rev-parse HEAD` + 대상 경로(`packages/{shared-types,pii-mask,dialogue-engine}`, `apps/{api,web,widget}`)에 대한 `git status --porcelain` 출력 + **[정정 #9] porcelain에 나온 변경 파일마다 `경로|크기|수정 시각(ms 내림)`**(파일이 없으면 `경로|missing`) + 각 `dist` 산출물(`packages/*/dist` · `apps/api/dist/main.js` · `apps/web/dist/index.html` · `apps/widget/dist/index.html`·`widget.js`) 존재 여부의 SHA-256.
- 크기·수정 시각을 넣는 이유: 이미 ` M`인 파일을 다시 고치면 porcelain 문자열은 그대로라 지문이 바뀌지 않아 빌드를 건너뛴다(단위 시험으로 재현). 내용 해시 대신 크기·시각을 쓰는 이유는 매 실행 비용(변경 파일 전체 읽기)을 피하기 위해서다 — 시각만 바뀌는 경우(저장만 다시 함)는 불필요한 재빌드 1회로 감수한다.
- `.demo-runs/.build-stamp.json`에 저장. 같으면 생략, 다르면 전체 순서 재빌드(부분 빌드 최적화는 하지 않는다 — 단순성).
- 빌드는 제품 패키지의 **자기 `build` 스크립트를 그대로** 부른다(하네스가 빌드 방법을 복제하지 않음).

---

## 6. 프로세스 · 서빙 · 환경

### 6.1 구성과 포트

| 구성 | 실행 | 바인드 | 포트(기본) | 헬스 |
|---|---|---|---|---|
| API | `node --title=cbdemo-api-<runId> -r <하네스>/src/runtime/isolate-api-env.cjs <저장소>/apps/api/dist/main.js` · 작업 폴더 `apps/api` · **[정정 #2]** 선적재는 `src/runtime/` 원본 경로 | 모든 인터페이스(제품 `main.ts` 63행 — 바꿀 수 없음, NFR-DHS3 주의 표기 · 실측 `0.0.0.0:3000`) | 3000 | `GET /api/health` 200 |
| ml-worker | `<저장소>/apps/ml-worker/.venv/Scripts/python.exe -X cbdemo_run=<runId> -m ml_worker.app` · **작업 폴더 = `<실행 폴더>/ml-worker/`**(개발자 `.env` 미적재 — C-19) · **[정정 #11]** venv `python.exe`는 런처이고 실제 인터프리터(포트 점유)는 그 자식 — 표식은 둘 다에 있다 | `127.0.0.1` | 8100 | `GET /health` `warmedUp=true` |
| 콘솔 서버(하네스 내부) | `apps/web/dist` 정적 + SPA 대체(`index.html`) + **`/api/*` → `http://127.0.0.1:<API>` 역프록시**(헤더·`Set-Cookie` 그대로 · 스트리밍 · 업로드 본문 그대로) | `127.0.0.1`(URL은 `http://localhost:5173`) | 5173 | `GET /` 200 |
| 위젯 서버(하네스 내부) | `apps/widget/dist` 정적(`/widget.js` · `/c/:slug` → `index.html`) | `127.0.0.1` | 5174 | `GET /widget.js` 200 |
| 모형·무대 서버(하네스 내부) | `assets/` 템플릿을 실행 폴더 값으로 채워 서빙: `/site?bot=<slug>`(고객사 모형 + 스니펫) · `/stage`(무대) · `/system`(구성 카드) · `/roadmap`(로드맵) | `127.0.0.1` | 5180 | `GET /stage` 200 |
| 브라우저 | Edge(Playwright 영속 컨텍스트, 프로필 = `<실행 폴더>/browser-profile`) | — | — | PC-5 |

- 모든 URL의 호스트는 **`localhost`**로 통일한다(쿠키 도메인 `localhost` · 같은 사이트 판정). 하네스 서버는 `127.0.0.1`에만 바인드하므로 브라우저의 `localhost` 해석이 `::1`을 먼저 시도해도 `127.0.0.1`로 넘어간다(Chromium 이중 시도). **2026-10-01 확인 6에서 문제 없음 확인**.
- 역프록시는 `X-Forwarded-*`를 붙이지 않는다(`TRUST_PROXY=false` 유지 — 운영과 같은 IP 판정).
- 콘솔에서 오는 관리자 요청은 브라우저 입장에서 같은 출처라 CORS가 개입하지 않는다(`main.ts` 31~45행 — 허용 목록 밖 출처는 헤더를 안 붙일 뿐 거부하지 않음). `ADMIN_WEB_ORIGIN`은 설정하지 않는다.

### 6.2 API 환경변수(하네스가 전부 명시 — 백지 시작)

자식 환경 = **시스템 필수 키 허용 목록**(`SystemRoot`·`windir`·`ComSpec`·`PATH`·`PATHEXT`·`TEMP`·`TMP`·`USERPROFILE`·`HOMEDRIVE`·`HOMEPATH`·`APPDATA`·`LOCALAPPDATA`·`PROGRAMDATA`·`NUMBER_OF_PROCESSORS`·`PROCESSOR_ARCHITECTURE`·`OS` — 윈도 환경변수 이름은 대소문자 구분 없이 찾고 부모의 표기를 보존) + 아래 표. 부모 `process.env`의 나머지는 **상속하지 않는다**(하네스 프로세스가 Prisma 클라이언트를 require하며 `.env`를 읽어 들였더라도 자식에 새지 않음). 구성기는 `src/env/api-env.ts` 한 곳이며, 새 제품 환경변수가 필요하면 이 파일만 고친다(단위 시험이 부모 상속 0을 검증).

| 키 | 시연 값 | 기본값 | 공개표 | 이유 |
|---|---|---|---|---|
| `DATABASE_URL` | `file:<실행 폴더 절대 경로>/demo.db`(슬래시 · 따옴표·URL 인코딩 없음 — 공백·마침표 경로 실측 확인) | — | 경로 | FR-0-311 · 거버넌스 저장 위치 검사(절대 경로 필수) |
| `API_PORT` · `WIDGET_BASE_URL` · `PUBLIC_API_BASE_URL` | 3000 · `http://localhost:5174` · `http://localhost:3000/api/v1` | 3000 · — · — | | 기동 필수 |
| `CHATBOT_API_IGNORE_ENV_FILE` | `1` | 미설정 | ★ | DHD-10 ② |
| `EMBEDDING_BASE_URL` | `http://127.0.0.1:8100` | 미설정 | ★ | 의미 매칭·분석 |
| `EMBEDDING_TIMEOUT_MS` | 300 또는 실측 결정값(§14) | 300 | ★(바뀌면) | J-11 |
| `EMBEDDING_BATCH_TIMEOUT_MS` | 30000 | 30000 | | |
| `AUGMENTATION_PROVIDER` | `rule` | `rule` | ★(명시) | J-10 |
| `AUGMENTATION_GEMINI_API_KEY` · `AUGMENTATION_GEMINI_BASE_URL` · `AUGMENTATION_GEMINI_MODEL` · `AUGMENTATION_LOCAL_BASE_URL` · `RAG_BASE_URL` | **빈 문자열** | 미설정 | ★ | DHD-10 ④ — `z.string().optional()`이라 빈 값 통과, 출구 기동 검사는 빈 값을 건너뜀(`egress-boot-check.ts` 34행) |
| `KB_SYNC_ENABLED` · `WORKFLOW_DISPATCH_ENABLED` · `DATA_RETENTION_JOB_ENABLED` · `DATA_REENCRYPT_JOB_ENABLED` · `CLASSIFIER_ENABLED` · `UTTERANCE_ANALYSIS_NAME_SUGGEST_ENABLED` | `false` | false·true·true·true·false·false | ★ | 공연 무관 루프 차단 |
| `DEPLOY_SCHEDULE_ENABLED` · `DEPLOY_SCHEDULE_POLL_INTERVAL_MS` | `true` · `5000` | true · 30000 | ★ | ⑤ 예약(허용 최소값) |
| `HANDOFF_SWEEPER_ENABLED` | `true` | true | | ② |
| `DATA_GOVERNANCE_MODE` | `ON` | OFF | ★ | J-17 |
| `DATA_RESIDENCY_ALLOWED_DIRS` | `<실행 폴더 절대 경로>` | 빈 값 | ★ | §6.3 |
| `DATA_EGRESS_ALLOWED_HOSTS` | `127.0.0.1:8100` | 빈 값 | ★ | §6.3 |
| `DATA_AT_REST_ENCRYPTION_DECLARED` | **설정 안 함**(false) | false | | 시연 노트북 디스크 암호화를 하네스가 보증할 수 없다 — 데이터 지도의 "미선언" 표시를 그대로 보이고 자막으로 설명(정직성) |
| `DATA_ENCRYPTION_ENABLED` · `DATA_ENCRYPTION_KEYS` | 설정 안 함(`--field-encryption`이면 `true` · `demo1:<실행별 무작위 32바이트 base64>`) | false | ★(켜면) | A-11 |
| `GUARDRAILS_ENABLED` · `UTTERANCE_ANALYSIS_ENABLED` · `PROACTIVE_ENABLED` | 기본(true) | true | | ⑥⑦ · 선제 규칙은 데이터 0개 |
| `PUBLIC_RATE_LIMIT_*` · `LOGIN_*` | 기본 | | | headless 속도로도 한도 안(§11.4) |
| `STATS_TIMEZONE` | 기본(`Asia/Seoul`) | | | EX-DH-17 |

**하네스 전용 키(제품 설정 스키마 밖 — 제품 동작 영향 0 · 공개표 비대상)** [정정 #3]

| 키 | 값 | 이유 |
|---|---|---|
| `CBDEMO_API_PACKAGE_JSON` | `<저장소>/apps/api/package.json` 절대 경로 | 선적재 스크립트가 `@prisma/client`를 이 기준으로 해석(§13.1) |
| **`NODE_PATH`** | **`<저장소>/node_modules/.pnpm/node_modules`** | `apps/api`가 직접 의존성으로 선언하지 않은 `multer`를 값 import한다(C-20). pnpm 실행 래퍼(`.bin` 셸·`pnpm run`)는 이 경로를 `NODE_PATH`에 넣어 주는데, 하네스는 `node dist/main.js`를 직접 띄우므로 같은 해석 경로를 명시해야 기동된다(없으면 `Cannot find module 'multer'` — 2026-10-01 api.log `MODULE_NOT_FOUND` 실측). 제품 의존성 선언은 바꾸지 않는다 → 결함 후보 **DHX-4**(§21.3). DHX-4가 고쳐져도 이 값은 무해하다(호이스트 경로를 추가로 볼 뿐) |
| **`NO_COLOR`** | `1` | Nest 로그의 ANSI 색 코드를 `logs/api.log`에 남기지 않는다(로그 가독성 · 기동 로그 줄 검색 안정성) |
| `CHECKPOINT_DISABLE` · `PRISMA_HIDE_UPDATE_MESSAGE` | `1` · `1` | 폐쇄망에서 Prisma 버전 확인 요청 0 |

### 6.3 거버넌스 모드 ON 충족 방법(C-3)

1. `DATABASE_URL=file:D:/…/.demo-runs/<runId>/demo.db`(절대) · `DATA_RESIDENCY_ALLOWED_DIRS=D:/…/.demo-runs/<runId>` → 실 경로 해석 후 하위 판정 통과(Windows는 소문자 비교 — `residency-check.ts` 17~19행).
2. `DATA_EGRESS_ALLOWED_HOSTS=127.0.0.1:8100` — `EMBEDDING_BASE_URL`의 호스트·포트와 **정확 일치**(포트 포함). RAG·Gemini·local은 빈 값이라 검사 대상 아님.
3. 키 미설정 → 키 사용 행 검사 생략. 감사 체인 서명 키(`AUDIT_CHAIN_KEY`)도 설정하지 않는다(체인은 서명 없이 동작).
4. 결과: 기동 로그 `데이터 거버넌스 모드=ON · 암호화=꺼짐 · 출구 허용=1개` 1줄을 하네스가 로그에서 찾아 **외부 송신 점검표**에 근거로 싣는다(2026-10-01 실기동에서 이 줄 확인 — `D:\2. Team Source\Chat Bot\.demo-runs\…` 공백·마침표 경로).
5. 기동 실패(EX-DH-12) → `DATA_GOVERNANCE_MODE=OFF`로 1회 재기동 + 보고서·시작 자막 표기("이번 시연은 거버넌스 모드를 끈 상태").

### 6.4 ml-worker 환경변수

자식 환경 = 시스템 허용 목록 + 아래. 작업 폴더 = `<실행 폴더>/ml-worker/`(빈 폴더).

| 키 | 값 | 이유 |
|---|---|---|
| `ML_WORKER_HOST` · `ML_WORKER_PORT` · `ML_WORKER_ROLE` | `127.0.0.1` · `8100` · `embed` | NFR-DHS3 · 생성 모델 미적재 |
| `EMBEDDING_MODEL_ID` · `EMBEDDING_MODEL_REVISION` · `EMBEDDING_DEVICE` | `nlpai-lab/KURE-v1` · `main` · `cpu` | 개발 PC 실측값과 같은 구성 |
| `CUDA_VISIBLE_DEVICES` | `-1` | GPU를 프로세스에 **노출하지 않음** — `/health.device`가 설정값 메아리라서(C-18) 증거를 보강 |
| `HF_HUB_OFFLINE` · `TRANSFORMERS_OFFLINE` · `HF_HUB_DISABLE_TELEMETRY` | `1` · `1` · `1` | 폐쇄망(§21.2 확인 1 — 확인 완료) |
| `PYTHONUTF8` · `PYTHONIOENCODING` | `1` · `utf-8` | 로그 한글 |

- HF 캐시는 기본 위치를 그대로 쓴다(`HF_HOME` 미지정). **모델 파일을 바꾸지 않는다**. 오프라인 로드 중 캐시 폴더에 잠금 파일이 생길 수 있다는 점은 보고서 "알려진 한계"에 적는다(NFR-DHS1 "읽기만"의 정확한 범위).
- 오프라인 로드가 실패할 때의 폴백(`EMBEDDING_MODEL_REVISION=<refs/main 커밋 해시>`)은 구현돼 있으나 2026-10-01 실측에서는 쓰지 않았다(`main` 그대로 로드 성공).

### 6.5 자식 프로세스 실행 규약(Windows · 공백 경로)

- 모든 자식은 **실행 파일 + 인자 배열**로 `spawn`(셸 0 — NFR-DHC2). 경로에 공백·마침표가 있어도 인자 배열이라 따옴표 처리가 필요 없다.
- pnpm 하위 명령(빌드)은 `.cmd` 셸 래퍼를 피하려고 **`node <npm_execpath>`**(pnpm이 하네스를 실행할 때 넘겨 주는 pnpm 진입 JS)로 실행한다. 값이 없으면(사용자가 `node dist/src/cli.js`로 직접 실행) `shell:true` + 인자 개별 따옴표로 폴백하고 경고한다.
- Prisma CLI는 `require.resolve('prisma/build/index.js', { paths: [apps/api] })`를 `node`로 실행(`.cmd` 회피) · `CHECKPOINT_DISABLE=1`·`PRISMA_HIDE_UPDATE_MESSAGE=1`(폐쇄망에서 버전 확인 요청 0).
- 표준 출력·오류는 `logs/<name>.log`(UTF-8)로 스트리밍하고, 하네스 메모리에 마지막 200줄 고리 버퍼를 둔다(FR-DH7-2).
- **[정정 #10]** 하네스 자신의 인자는 단독 `--` 토큰을 무시하고 해석한다(§4.2).
- **[정정 #13]** 하네스 터미널 출력 스트림의 `error`(`EPIPE` 등)는 삼킨다 — 출력 실패가 정리 실패로 번지지 않게(§4.4).

### 6.6 정리 · 잔존 프로세스(FR-DH8 · NFR-DHC4)

| 상황 | 동작 |
|---|---|
| 정상·실패 종료 | 브라우저 컨텍스트 닫기(영상 파일 확정) → 자식마다(역순) `taskkill /PID <pid> /T /F`(`spawnSync`, 실행 파일 직접) → 하네스 서버 `close()` → 5개 포트 해제 확인(최대 5초 폴링) → 표식 기반 고아 검사(전체 프로세스 CIM 1회) → `pids.json`에 `cleanedUp:true` |
| Ctrl+C(`SIGINT`) · 창 닫힘(`SIGHUP`) · 진행자 `q` | 같은 정리를 5초 상한으로 수행 → 보고서 "중단됨" 저장 → 130(AC-DH1-4) |
| 하네스가 비정상 종료(강제 종료 등) | `process.on('exit')`에서 동기 `taskkill`만 시도(비동기 불가). **정적 서버 3개는 하네스 프로세스 안에 있으므로 하네스와 함께 사라진다** |
| 다음 실행 시작(P1) | 이전 실행 폴더들의 `pids.json` 중 `cleanedUp`이 없는 항목 → 자식 PID들과 **[정정 #7] 소유 하네스 PID(`harnessPid`)**의 명령줄을 PowerShell `Get-CimInstance Win32_Process`로 한 번에 읽는다. ① **소유 하네스가 살아 있으면**(그 PID의 명령줄이 하네스 `dist/src/cli.js`) 진행 중인 실행(`--prepare-only`·`--no-teardown` 서버 유지 포함)이므로 **자식을 건드리지 않고** "다른 실행이 진행 중" 기록만 남긴다 ② 하네스가 없으면 자식 PID마다 표식(`--title=cbdemo-…-<runId>` · `-X cbdemo_run=<runId>` · `--user-data-dir=<그 실행 폴더>`)이 있을 때만 트리 종료(AC-DH1-5 · FR-DH8-3 — 다른 프로세스 오종료 금지). 표식 없음 = PID 재사용 → 건드리지 않고 기록 |
| `--stop <runId\|latest>` | **[정정 #7]** ① `pids.json`이 없으면 안내 후 0 ② 소유 하네스가 **없으면**: 이미 `cleanedUp`이면 안내 후 0, 아니면 위 ②와 같은 표식 확인 정리 ③ 소유 하네스가 **살아 있으면**: `<실행 폴더>/stop.request`(내용 = 요청 시각)를 쓰고 1초 간격으로 최대 15초 하네스 종료를 기다린다 — 서버 유지 중인 하네스는 1초마다 이 파일을 확인해 **스스로 전체 정리(브라우저 → 자식 트리 → 정적 서버 → 포트 → `cleanedUp`)** 후 끝난다 ④ 15초 안에 끝나지 않으면 하네스 트리를 강제 종료하고 소유자 생존 무시 옵션으로 표식 확인 정리 |
| SQLite 파일 핸들 | 폴더 삭제·이동은 `rmSync(…, {maxRetries:5, retryDelay:200})`(`ai-guardrails.harness.ts` 264~271행 선례) · 실패하면 건너뛰고 다음 실행이 재시도(EX-DH-18) · **DB는 기본 보존**(조사용 — FR-DH8-2) |
| `--no-teardown`·`--prepare-only` | 정리 대신 "서버 유지 중 · `pnpm demo -- --stop <runId>`" 안내 |

- **왜 `stop.request` 파일인가(정정 #7 ②)**: `--stop`을 실행한 별도 프로세스가 자식 트리만 죽이면 하네스 프로세스 안의 정적 서버 3개(5173·5174·5180)가 남는다. 하네스를 바로 죽이면 정리 루틴(포트 확인·`cleanedUp` 기록·보고서)이 돌지 않는다. 윈도에는 다른 프로세스에 `SIGINT`를 보낼 수단이 마땅치 않아(콘솔 그룹 제약) 파일 신호를 쓴다.
- **[정정 #11] 표식·종료 판정 규칙**: Node `--title`과 Python `-X cbdemo_run=…` 모두 `Win32_Process.CommandLine`에 보이고 Python은 임의 `-X` 값을 거부하지 않는다(2026-10-01 확인 5) — 표식 대체안(포트 점유 기반)은 **불필요**해 쓰지 않는다. venv `python.exe`는 런처 + 자식 인터프리터 2단 구조라 spawn한 PID와 포트 8100 점유 PID가 다르지만, 표식은 양쪽에 있고 `taskkill /T`가 둘 다 정리한다. **`taskkill`·`tasklist` 출력은 현지 코드 페이지(CP949)라 문구를 해석하지 않는다** — `taskkill`은 종료 코드(0 성공 · 128 이미 없음)만, `tasklist`는 `/FO CSV /NH` 형식으로만 판정한다(일치 항목이 없을 때의 현지화 안내 문장은 CSV가 아니므로 무시).
- 실측(2026-10-01): 정상 종료 · `SIGINT` 주입(모델 적재 중) → 130·고아 0 · `--prepare-only` 후 `--stop` → 3.4초 정리 · 다음 실행의 잔존 정리가 이전 실행 자식 2개 종료 · 표식 없는 PID 미접촉 · 하네스가 살아 있는 실행 보호 — 7회 실행 모두 고아 0·포트 해제·`dev.db` 변경 0.

---

## 7. 데모 데이터셋

### 7.1 원칙

- `seed.ts`는 실행하지 않는다(검증 픽스처 혼입 — 요구사항 §0.2). 재사용은 **헬퍼·상수**뿐: `@chat-bot/shared-types`의 `normalizeEmail`·`normalizeText`·`toKstDayBucket`·`toKstHourOfDay`·`validatePasswordPolicy`·`DEPLOY_SCHEDULE_LIMITS`, 그리고 빌드된 `apps/api/dist/common/auth/lib/password-hash.js`의 `hashPassword`(ADMIN1 1명만).
- 생성 순서는 **제품 API 우선**(제품 규칙 검증 효과 — 예: 예문 중복·노드 참조·2인 승인 조건이 실제 규칙으로 걸러진다). DB 직접은 §7.2 ADMIN1·§7.7 과거 로그 2가지.
- 데이터 정의는 `src/data/dataset.ts`의 **TS 상수**(문구·예문·노드 응답·검증 케이스) — 시나리오 정의와 같은 저장소 커밋 대상.
- 고객에게 보일 문구에 `테스트`·`검증`·`D3-2` 같은 내부 표식을 쓰지 않는다(FR-DH3-6). 금지어 사전은 비운다.
- 가상 회사: **"가온마켓"(가상 온라인 쇼핑몰)** — 고객사 모형·챗봇 이름·답변 문구에 공통 사용(ui-designer 확정 대상).

### 7.2 계정(5)

| 계정 | 이메일 | 역할 | 생성 경로 | 쓰임 |
|---|---|---|---|---|
| ADMIN1 "관리자 김가온" | `admin1@demo.local` | ADMIN | **DB 직접**(P1 직후, API 기동 전) — `mustChangePassword:false` · `status:'ACTIVE'` · 무작위 비밀번호 해시 | 대부분 화면 · 2인 승인 요청자 · 예약 작성자 |
| ADMIN2 "관리자 이승인" | `admin2@demo.local` | ADMIN | ADMIN1이 `POST /users` → 임시 비밀번호로 로그인 → `POST /auth/password`로 무작위 비밀번호 | 승인자 |
| AGENT "상담원 박상담" | `agent@demo.local` | AGENT | 같음 | ② |
| EDITOR · VIEWER | `editor@…` · `viewer@…` | EDITOR · VIEWER | 같음 | 사용자 목록 화면에 역할 4종이 보이게(공연 장면 아님) |

- 비밀번호: 실행마다 `crypto.randomBytes` 기반 20자(영문·숫자·특수 3종) → `validatePasswordPolicy`로 확인 · **터미널 요약에만 출력**(보고서·로그·캡처 0 — NFR-DHS3).
- 로그인 쿠키는 하네스 메모리에만 둔다(`state.json`에 저장하지 않음).
- `--resume` 재개: 격리 DB의 이 5개 계정 비밀번호를 DB 직접으로 새 무작위 값으로 바꾸고 다시 로그인(디스크에 비밀 0). 이 동작은 감사 로그에 남지 않는 DB 직접 쓰기임을 보고서 "재개 기록"에 적는다.
- 사용자 생성·비밀번호 변경은 감사 로그에 "사용자 생성"·"비밀번호 변경" 행을 남긴다 — 준비 단계의 제품 동작이라 그대로 둔다(⑤⑥ 감사 화면은 대상 필터로 운영 전환 행을 보인다).

### 7.3 챗봇 A "가온마켓 고객센터"(①②③④⑥⑦)

| 자산 | 내용(문구는 ui-designer·PM 다듬기 가능 · 보정 게이트 G-1 기준을 지켜야 함) |
|---|---|
| 그룹 | "가온마켓" |
| 의도(6) | **배송조회**(예문 4: "배송 조회하고 싶어요" · "택배 어디쯤 왔는지 알려 주세요" · "주문한 상품 배송 상태 확인" · "운송장 번호로 조회할래요") · **환불문의**(4) · **영업시간**(3) · **주문변경**(3) · **회원정보**(3) · **포인트문의**(2 — ⑦에서 늘림) |
| 키워드(3) | 택배사 · 운송장 · 포인트(동의어 "적립금") |
| 노드 | 시작 · 폴백("죄송해요, 아직 배우지 못한 질문이에요. 다른 말로 물어봐 주시거나 '상담원 연결'이라고 입력해 주세요.") · 의도별 응답 노드 6 |
| FAQ(3) | 배송비 · 교환 기간 · 영수증 발급 |
| WEB 채널 | 켬 · `allowedOrigins: ['http://localhost:5180']`(C-16) · 평가 버튼 끔(장면 단순화) |
| 상담 연계 | `enabled:true` · `cautionThreshold:1` · `warningThreshold:2` · `activeWindowMinutes:10` · 안내 문구 3종 |
| 자주 쓰는 문장(3) | "안녕하세요, 상담원 박상담입니다. 무엇을 도와드릴까요?" 외 2 |
| 위험 응답 규칙(1) | 이름 "약 복용 문의" · 분류 `MEDICAL_ADVICE` · 표현 `두 배로 먹어도` · `복용량` · `약을 더 먹어도` · 포함(CONTAINS) · `INBOUND` · `REPLACE` · 대체 문구 "약 복용에 관한 내용은 안내해 드릴 수 없어요. 의사나 약사와 상담해 주세요." |
| 답변 설정 | 기본(의미 매칭 **꺼짐** · RAG 꺼짐) |
| 검증 세트 "기본 응대 15문항" | 의도·FAQ별 정답 14건 + **"물건이 아직 안 왔어요 → 배송조회"** 1건 · 준비 단계에서 **기준 실행 1회**(의미 매칭 꺼짐 → 이 1건 실패가 기준) |
| 선제 안내 규칙 | **0개**(EX-DH-16) |
| ⑦ 사전 분석 | `fixtures/utterances-demo.csv`로 분석 1건 완료(의미 매칭 꺼진 상태 · 대조 = 운영 중인 답변 · 목표 묶음 6 · 최소 발화 5) |

### 7.4 챗봇 B "가온마켓 운영 통제 데모"(⑤ 라이브)

| 자산 | 내용 |
|---|---|
| 의도·노드 | **영업시간**(예문 3) → 응답 v1 "평일 오전 9시~오후 6시에 상담합니다." · 폴백 |
| WEB 채널 | 켬 · 허용 출처 = 모형 |
| 환경 | `POST …/environment/enable` → 운영 **v1** · 2인 승인 `PUT …/environment/approval {required:true, ttlHours:24}`(활성 ADMIN 2명 이후) · 게이트 **미설정**(경고 확인 체크 단계를 늘리지 않음 — PM 확인 Q-6) |
| 스테이징 | 준비 단계에서 초안 응답을 "평일 오전 9시~오후 8시(연장 운영)"로 수정 → `POST …/staging/promote` → **v2** |

### 7.5 챗봇 C "가온마켓 야간 배포 데모"(⑤ 예약 전용)

| 자산 | 내용 |
|---|---|
| 의도·노드 | **공지**(예문 2) → v1 "10월 행사 안내입니다." |
| 환경 | 환경 모드 켬(운영 v1) · 2인 승인 켬(B와 같은 정책) |
| 스테이징 | v2("11월 행사 안내입니다.") → 이력 예약 C-1 대상 · C-1 실행 뒤 v3("12월 행사 안내입니다.") → 라이브 예약 C-2 대상 |

### 7.6 예약 시각 계산과 2인 승인(DHD-8 · DHD-9)

```
ceilMinute(t) = t의 초·밀리초가 0이면 t, 아니면 다음 분 0초
이력 C-1: P4 첫 작업 시각 Pc에
  scheduledAt₁ = ceilMinute(Pc + 5분 + 30초)            # 최소 5분(LEAD) + 시계 차·전송 여유 30초
  POST /chatbots/C/deploy-schedules  {action:'SWITCH_PROD_VERSION', targetVersionId:v2, previewedProdVersionId:v1, scheduledAt₁, memo:'이력용 예약(시연 준비)'}   # ADMIN1
  POST /chatbots/C/environment/approval/requests {action:'SCHEDULED_PROD_SWITCH', deployScheduleId}   # ADMIN1(작성자 본인)
  POST …/requests/:id/approve {}                                                                        # ADMIN2
  → 준비 대기 단계에서 GET …/deploy-schedules/:id 상태가 실행 완료가 될 때까지 대기(상한 scheduledAt₁ + 폴링 5초 + 60초)
라이브 C-2: 공연 시작 T0에
  scheduledAt₂ = ceilMinute(T0 + 6분)                    # 실행 = T0+6:00~7:00 + 폴링 ≤5초 → ⑤(5:50~7:25) 안에 실행 완료
  (같은 3호출 · 대상 v3 · 기준 v2 · memo:'시연 중 실행 예약')
```

- 예약 시각은 하네스가 계산하고 **서버가 다시 검증**한다(`checkScheduleTimeRules` — `LEAD`·`SPACING` 위반이면 400). 하네스는 생성 전에 같은 함수(`@chat-bot/shared-types`)로 미리 판정하고, 400이면 다음 분으로 1회 재시도한다.
- 일시정지가 길어 ⑤ 전에 C-2가 실행되면 ⑤ 예약 단계는 "이미 실행된 예약"을 보인다 — 예약이 정해진 시각에 실제로 돈 사실은 같으므로 대체가 아니다.
- C-2 생성·승인 실패, 또는 ⑤ 예약 단계 도달 시 실행되지 않았고 남은 대기 > 25초 → **이력 C-1 화면으로 대체** + 정직성 자막(FR-DH9-2) + 끝 장면에서 C-2 상태 1회 재확인(§10.9).
- 시계 주입(`FakeClock`)은 쓰지 않는다 — 실제 `main.ts` 프로세스에 주입 경로가 없고 만들면 제품과 다른 기동 경로가 생긴다(P-5 · ADR-0051 §6).

### 7.7 과거 14일 대화 로그(DB 직접 · FR-DH9-4)

- 대상: 챗봇 A · 기간: T-14일 00:00 ~ 전날 23:59(KST) · 일 20~40건(요일별 변동 고정 표 — 무작위 0, 멱등) · 시간대 09~21시 위주.
- 행 구성: `channelType:'WEB'` · `sessionId:'demo-hist-<일>-<순번>'`(식별 표식) · `userMessage`·`botResponse`는 데이터셋의 자연스러운 문장(개인정보 0) · 응답 비율 약 85% · 출처 혼합(노드 70 · FAQ 15 · 폴백 15 — `matchedNodeId`·`matchedFaqId`·`matchedIntentId`는 API로 만든 실제 ID) · `dayBucket = toKstDayBucket(createdAt)` · `hourBucket = toKstHourOfDay(createdAt)` · `groupId` = A의 그룹 ID(누적 통계 스냅샷 규약 — 빈 값 금지) · `answeredByRag:false`.
- **미응답 큐(`UnansweredQuestion`)는 만들지 않는다** — 학습현황에는 공연 중 생긴 질문만 보이게(④의 대상이 분명해진다).
- 쓰기 시점: P4에서 A 생성 직후, API가 유휴일 때 `createMany` 1회(SQLite 잠금 경합 최소 — 실패 시 200ms 후 3회 재시도).
- 보고서·③ 자막: "그래프의 지난 14일 분량 n건은 시연용으로 미리 넣은 과거 데이터입니다."
- 1단계 확인: 확인용 스크립트가 `apps/api/node_modules/@prisma/client`를 `datasources.db.url` 지정으로 쓰는 방식이 동작함을 확인했다(H3에서 `src/data/db-direct.ts` 한 파일만 허용하도록 정적 검사 H-S1·H-S3 갱신).

### 7.8 고정 발화 CSV(⑦)

- `tools/demo-harness/fixtures/utterances-demo.csv` · UTF-8 · 머리글 `발화,발생 횟수,출처 메모` · **200행**: 배송 지연(기존 의도와 겹침 35) · 환불·반품(35) · 회원정보(25) · **포인트 적립·소멸(40 — 학습 후보 묶음)** · 선물 포장(30 — 새 주제) · 기타 잡담(35). 개인정보 0(가림 표시가 섞인 행 2개만 의도적으로 — "개인정보를 가린 줄" 미리보기 항목 시연).
- 하네스 단위 시험이 머리글이 제품 양식(`GET …/utterance-analyses/template?format=csv`의 1열 "발화")과 같은지, 행 수·중복 0을 확인한다.
- XLSX 판은 만들지 않는다(J-9 — CSV 허용 확인).

### 7.9 보정 게이트(P5 — 공연 전 "될 장면인지" 확인)

| # | 확인 | 방법 | 실패 시 |
|---|---|---|---|
| G-1 | ① "물건이 아직 안 왔어요"가 의미 매칭 **꺼짐**에서 폴백, **켜짐**에서 배송조회 **확정** | 꺼짐: `POST /chatbots/A/simulate`(관리자 시뮬레이터 — 공개 대화 로그·미응답 큐를 남기지 않음) → 폴백 확인. 켜짐: 답변 설정을 잠시 켜고(`PUT …/answer-settings`) 같은 시뮬레이션 → `matchTrace.band = CONFIRMED` · 1위 = 배송조회 → 다시 끔 | 종료 2 "데모 데이터 보정 필요(①)" — 예문·질문 문구 조정 |
| G-2 | ② 질문 2개("상담원이랑 직접 얘기하고 싶어요" · "사람이랑 통화할 수 있나요?")가 **의미 매칭 켜짐에서도 폴백** | 위 켜짐 상태에서 시뮬레이션 | 같음 |
| G-3 | ⑤ B 위젯 질문 "영업시간 알려 주세요"가 v1 문구 | 공개 대화 API(별도 세션) | 같음 |
| G-4 | ⑥ 위험 질문이 대체 문구 · 개인정보 질문이 환불문의로 응답 | `POST …/guardrails/test` + 시뮬레이션 | 같음 |

- G-1의 켜고 끄기는 감사 로그에 "AI 답변 설정 변경" 2행을 남긴다(준비 단계 · 보고서 "준비 단계 보정" 표기). 같은 질문의 임베딩이 API 캐시(`EMBEDDING_CACHE_TTL_MS` 10분)에 남아 ①의 첫 응답이 빨라질 수 있다는 점도 보고서에 적는다.

---

## 8. 브라우저 구성

### 8.1 Playwright · Edge(P-2)

- `playwright-core`의 `chromium.launchPersistentContext(<실행 폴더>/browser-profile, { channel:'msedge', headless: mode==='headless-check', viewport, deviceScaleFactor:1, locale:'ko-KR', timezoneId:'Asia/Seoul', recordVideo?, acceptDownloads:false })`.
- **[정정 #6] `recordVideo`는 PC-6 통과 + 영상 사용 실행일 때만 넘긴다.** ffmpeg 없이 넘기면 `Video rendering requires ffmpeg binary` 예외로 컨텍스트 기동 자체가 실패한다(2026-10-01 실측) — "영상만 생략"은 넘기지 않는 것으로만 성립한다.
- 영속 컨텍스트를 쓰는 이유: 실행 폴더 안 새 프로필이라 **사용자 Edge 프로필·쿠키·확장 미사용**(NFR-DHS2)이면서, 명령줄의 `--user-data-dir`가 잔존 프로세스 식별 표식이 된다(§6.6). 정리 때 프로필 폴더를 지운다.
- **Edge 채널 동작 — 2026-10-01 이 PC에서 확인 완료**: Edge `154.0.4258.37` + `playwright-core@1.63.0`(번들 Chromium 153.0.8010.12 — 한 버전 낮아도 동작) · 기동 약 0.65~0.71초 · headless·headed 모두 · 영속 컨텍스트·`iframe`(srcdoc 및 실제 3칸 중첩)·열린 Shadow DOM 선택자·`getByLabel`·`setInputFiles`(대화상자 없이)·스크린샷·`locale`·`timezoneId` 확인 · 사용자 Edge가 이미 실행 중이어도 별도 프로필로 동시 기동 가능. 아래 폴백 사다리는 **지금은 불필요**하지만 Edge 업데이트로 깨질 때를 위해 유지한다. 하네스는 PC-5(`probeBrowser()` — 기동 → `data:` 페이지 → 스크린샷 → 종료)로 매 실행 확인한다.

| 순서 | 방법 | 비용 |
|---|---|---|
| 1 | `--browser msedge`(기본) | 0 |
| 2 | `--browser chrome`(설치된 Chrome) | 0 |
| 3 | `--browser <실행 파일 경로>`(사내 표준 Chromium 계열) | 0 |
| 4 | `--browser chromium` — Playwright 전용 Chromium(`playwright-core install chromium` · 인터넷 또는 `ms-playwright` 폴더 반입 · 수백 MB) | 반입 |
| 5 | (무인 점검 전용) `--browser none` — UI 단계 전부 `SKIPPED(브라우저 없음)`, API 검증만 · 종료 코드는 API 검증 결과 · 보고서 "UI 미검증" | 시연 불가 |

### 8.2 무대 페이지(`/stage`)와 레이아웃

| 레이아웃 | 구성 | 쓰는 구간 |
|---|---|---|
| `card` | 전체 화면 하네스 카드(`/system`·`/roadmap`) | 시작 · 끝 |
| `split` | 왼쪽 40% 고객사 모형(`/site?bot=<slug>` — 위젯) · 오른쪽 60% 콘솔 `iframe` | ①②⑤⑥ |
| `console` | 콘솔 `iframe` 전체 | ③④⑦ · 감사·데이터 지도 |

- 무대는 최상위 문서 1장이고 레이아웃 전환은 무대 내부 함수 호출(`window.__stage.setLayout(…)`) + `iframe` 주소 변경이다. **자막 띠는 무대 최상위에 한 번만** 주입되므로 콘솔 화면 이동마다 다시 넣을 필요가 없다.
- 상호작용은 `page.frameLocator('#console')`·`page.frameLocator('#site')` 범위에서 한다. 위젯은 모형 `iframe` 안의 열린 Shadow DOM — Playwright 선택자가 관통한다.
- 콘솔 `iframe`은 같은 사이트(`localhost`)라 `cb_session`(`SameSite=Lax`, `Path=/api`)이 실린다(A-2). 제품 콘솔은 `X-Frame-Options`·`frame-ancestors`를 내지 않는다(하네스 정적 서버가 헤더를 정함 — 제품 배포 헤더와 다를 수 있다는 점은 보고서 한계에 기록).
- 진행자가 창을 직접 클릭해도(EX-DH-19) 다음 단계 시작 전 무대 레이아웃·`iframe` 주소를 단계 정의대로 다시 맞춘다.
- 1단계 구현은 `window.__stage.setFrameSrc/setLayout`의 최소 골격이다. ui-spec §3~§7 전체(상단 바·자막 띠·카드)는 `assets/*.html`을 교체하는 작업이며 `servers/stage-server.ts`의 `{{NAME}}` 치환·`/site?bot=<slug>` 슬러그 검증을 그대로 쓴다.

### 8.3 계정 전환(쿠키 교체)

```
login(account) → POST /api/v1/auth/login → Set-Cookie의 cb_session 값(메모리)
switchAccount(name): context.clearCookies({ name:'cb_session' }) → context.addCookies([{ name:'cb_session', value, domain:'localhost', path:'/api', httpOnly:true, sameSite:'Lax' }]) → 콘솔 iframe 새로고침 → 사용자 메뉴에 계정 이름 표시 대기
```

- 쿠키 값은 로그·보고서·`state.json`에 쓰지 않는다(§17.3 비밀 제거 대상 — `Redactor`에 등록).
- 위젯은 공개 경로(쿠키 불필요)라 계정 전환의 영향을 받지 않는다.
- 2026-10-01 확인 6: 콘솔 서버가 `Set-Cookie: cb_session=…; Path=/api; HttpOnly; SameSite=Lax; Max-Age=43200`를 그대로 전달 · 무대(5180) 안 콘솔 `iframe`(5173)에서 admin 쿠키 → `/auth/me` 관리자, 쿠키 교체 + 새로고침 → 상담원 · 상단 사용자 메뉴 "상담원 박상담 (상담원)" 표시.

### 8.4 자막 띠(FR-DH5-2 · NFR-DHA)

- 무대 최상위에 하네스 소유 요소 1개(`<div data-demo-harness="caption" aria-hidden="true">` — 제품 DOM 밖 · 제품 접근성 시험 대상 아님 NFR-DHA4) · `pointer-events:none` · 위치 `bottom|top`(단계별) · 글자 ≥ 24px · 대비 ≥ 4.5:1 · 2줄 이하 · 최소 표시 2초. 세부 시각 규칙은 `docs/03-design/demo-harness-ui-spec.md`(ui-designer).
- 정직성 자막(모형·사전 준비·대체·시연용 설정)은 별도 줄 스타일(예: 앞에 "ⓘ")로 구분한다.
- headless는 자막을 주입하지 않는다(나레이션 로그만 남김).

### 8.5 외부 요청 감시(DHD-13)

- `context.route('**/*')` — 요청 호스트가 `localhost`·`127.0.0.1`·`[::1]`이 아니면 **차단(`abort`)하고** `{시각, 단계 ID, 출처 프레임, 호스트}`를 기록. `data:`·`blob:`은 통과.
- 공연 중 차단 기록은 보고서 외부 송신 점검표 "브라우저" 칸에 그대로 싣는다. 관리 콘솔 Google Fonts 요청이 기록된다(DHX-1) — 차단 결과 콘솔은 시스템 글꼴(맑은 고딕)로 표시된다(폐쇄망과 같은 모습). **2026-10-01 실측: `fonts.googleapis.com` 1호스트만 차단·기록**(CSS 요청이 막혀 `fonts.gstatic.com` 글꼴 파일 요청은 아예 발생하지 않음 — 설계 당시 예상 "2호스트" 정정). DHX-1 수정 빌드에서는 0이 된다.
- 한계(보고서 고정 문구): 브라우저 자체의 백그라운드 통신(업데이트·보안 검사 등)은 페이지 요청이 아니라 감시 범위 밖이다 — 네트워크 차단(P-8 b)이 유일한 완전한 증거다.

### 8.6 대화상자·다운로드

- `page.on('dialog')`: `beforeunload`는 수락(단계 이동 우선), 그 밖의 네이티브 `confirm`·`alert`가 뜨면 **단계 실패**(예상 밖 — 제품 콘솔은 자체 `ConfirmDialog`를 쓴다).
- 다운로드는 받지 않는다(`acceptDownloads:false`) — 엑셀 내보내기 장면 없음. — **풀 투어(DT-2)는 `acceptDownloads:true` · 저장 위치 `downloads/`**(확장 설계 §8.1)

---

## 9. 시나리오 정의 형식

### 9.1 형식(TS 타입 — `src/scenario/types.ts`)

```ts
type Driver = 'API' | 'UI' | 'MIXED';
type Layout = 'card' | 'split' | 'console';
type Capture = 'none' | 'screenshot' | 'gif-clip';        // split은 무대 전체 스크린샷이라 별도 값 불필요
type FailureKind = 'PREFLIGHT' | 'BOOT' | 'DATA' | 'ACTION' | 'TIMEOUT' | 'VERIFY' | 'SELECTOR' | 'TEARDOWN';

interface StepDef {
  id: `S${0|1|2|3|4|5|6|7|9}-${string}`;   // S0 = 시작, S9 = 끝
  title: string;                          // 보고서·터미널
  narration: string[];                    // 자막 1~2줄(≤ 60자/줄)
  disclosure?: string;                    // 정직성 자막(FR-DH9)
  budgetSec: number;
  driver: Driver;
  account?: 'admin1' | 'admin2' | 'agent'; // 콘솔 iframe 계정(전환 필요 시 실행기가 처리)
  layout: Layout;
  console?: (s: RunState) => string;      // 콘솔 iframe 경로
  site?: 'A' | 'B';                       // 모형 위젯 대상
  core: boolean;                          // 핵심 장면 — 생략 불가
  skippable: boolean;                     // core와 동시 true 금지(정의 검사)
  capture: Capture;
  captionPosition?: 'bottom' | 'top';
  waitMaxMs?: number;                     // 조건 대기 상한(없으면 기본 10초)
  run(ctx: StepContext): Promise<void>;   // 동작 — 선택자는 selectors/*에서만
  verify?(ctx: StepContext): Promise<VerifyResult>;   // 기대 결과(API 또는 화면)
  fallback?: { stepId?: string; render?(ctx: StepContext): Promise<void>; caption: string };
  headless?: 'same' | 'skip' | ((ctx: StepContext) => Promise<void>);  // 무인 점검에서 다른 동작
}
interface SegmentDef { key: 'opening'|'s1'|…|'s7'|'closing'; title: string; budgetSec: number; skipOrder: string[]; steps: StepDef[] }
interface PresetDef { id: string; audience: 'ONPREM'; totalBudgetSec: number; segments: SegmentDef[]; modesAllowed: ('visible'|'headless-check')[] }
```

- 정의 검사(하네스 단위 시험): 구간 예산 합 = 프리셋 총 예산 · 단계 예산 합 = 구간 예산 · `core && skippable` 금지 · `skipOrder`는 그 구간의 생략 가능 단계만 · 단계 ID 유일 · 나레이션 줄 ≤ 60자.
- **재개 단위 = 구간**(A-8). `RunState`(챗봇·의도·버전·예약·분석 ID 등 비밀 아닌 값)는 구간 끝마다 `state.json`에 저장.
- **[DT-2]** 조건부 프리셋은 `when(plan)`·`inactive`·`expectedTotals`로 확장한다 — 정의 검사는 대표 계획 16개를 해석해 검사하고, `when`이 없는 프리셋(10분판)은 이 절의 규칙 그대로(확장 설계 §3).

### 9.2 대기 규약(FR-DH4-5 · NFR-DHR2)

- `waitFor(check, { timeoutMs, intervalMs, label })` — `eventual.helper.ts`와 같은 의미(조건이 참이 될 때까지 폴링 · 시간 초과 시 라벨 포함 오류 → 단계 `TIMEOUT` 실패).
- **고정 지연 금지**: `setTimeout`으로 결과를 기다리는 코드를 금지하고 정적 검사(§20 H-S2)로 막는다. 예외는 ① 보이는 모드의 "표시 유지(dwell)"(§11.2 — 결과 대기가 아니라 연출 시간) ② 타이핑 지연(`pressSequentially({ delay: 70 })`) 2가지뿐이며 둘 다 `pacing.ts` 1파일에만 둔다.

### 9.3 선택자(DHD-14) — `data-testid` 필요 0의 근거

- 콘솔: 버튼·링크·필드는 모두 **보이는 문구 또는 `aria-label`** 이 있다(§10 표의 출처 행). 같은 이름 버튼이 2개인 곳(예: "개입하기" 버튼과 확인 대화상자의 "개입하기")은 **대화상자 범위로 한정**(`getByRole('dialog').getByRole('button', …)`)한다.
- 표의 행은 `getByRole('row').filter({ hasText: <데이터셋의 고유 문장> })` — 데이터셋 문장을 하네스가 정하므로 고유성이 보장된다.
- 위젯: 런처 `aria-label "상담 시작하기"` · 입력 레이블 "메시지 입력" · 버튼 "전송" · 봇 말풍선 `.cb-msg-bot .cb-msg-text` · 상담원 말풍선 `.cb-msg-agent`(`apps/widget/src/ui/message-list.ts` 98~101·201~213행 — 클래스는 위젯 스타일의 일부라 안정적). 말풍선에는 접근성 이름이 없어 클래스가 유일한 수단이지만 **제품 변경 없이 충분**하다. (2026-10-01 확인 6: 모형 `iframe` 안 런처 `getByLabel('상담 시작하기')` 해석 1건.)
- 선택자 문자열은 `src/selectors/console.ts`·`widget.ts`에만 둔다(NFR-DHM1). 문구는 제품 상수 파일을 import하지 않고 **복사**한다(하네스가 제품 웹 소스에 컴파일 의존하지 않게) — 대신 단위 시험 H-T9가 두 값이 같은지 문자열 비교한다(제품 문구가 바뀌면 시험이 알려 줌).
- 표에서 `△`로 표시한 선택자는 정확한 역할(체크박스/스위치 등)을 코드로 끝까지 확인하지 않았다 — P5 **선택자 점검**이 공연 전에 해석 성공을 확인하고, 실패하면 "선택자 갱신 필요"로 준비를 멈춘다.

---

## 10. 시나리오 상세 — 프리셋 `customer-onprem-10m`

표기: 선택자 출처 ✓ = 문구를 상수 파일에서 확인 · △ = 역할·연결을 선택자 점검으로 확정. 콘솔 경로 앞의 `/chatbots/<A>`는 `A/`로 줄인다. 캡처 파일명 = 단계 ID.

### 10.0 T0 처리(공연 직전 · 시간 예산 밖 · 화면 변화 없음)

1. 통계 기준값: `GET /api/v1/stats/summary?chatbotId=A&…(오늘)` 응답 저장(③ 비교용).
2. 라이브 예약 C-2 + 승인 요청(ADMIN1) + 승인(ADMIN2)(§7.6).
3. 무대 `card` 레이아웃으로 `/system` 표시 · 영상 녹화 중이면 VTT 시각 기준점 = 이 순간.

### 10.1 시작 — 구축형 구성(30초)

| 단계 | 예산 | 구분 | 동작 · 선택자 | 검증 | 캡처 | 자막(요지) | 핵심/생략 |
|---|---|---|---|---|---|---|---|
| S0-01 구성 카드 | 15 | UI | 무대 `/system` — 하네스가 확인한 사실 표: 프로세스(API·ml-worker + 정적 서버 3 · 바인드 주소) · ml-worker `device=cpu` + `CUDA_VISIBLE_DEVICES=-1` · 외부 주소 환경변수 0 · 증강 = 규칙 기반 · 거버넌스 모드 ON · 네트워크 상태(PC-9) · **시연용 설정**(바뀐 값이 있으면 1줄) | 카드의 값 = 하네스 상태 | ✓ | "이 노트북 한 대를 사내 서버로 가정했습니다 · AI 문장 분석은 GPU 없이 CPU로 돕니다" | 핵심 |
| S0-02 데이터 지도 | 15 | UI | `console` · `/settings/data-governance/map`(admin1) | API `GET /governance/map` 출구 항목이 "미설정/허용 1" | ✓ | "데이터가 나가는 출구는 문장 분석 서버(같은 PC) 1곳뿐" | 생략 가능(→ S6-05로 이월) |

### 10.2 ① 챗봇 구축 → 위젯 대화(90초)

| 단계 | 예산 | 구분 | 동작 · 선택자 | 검증 | 캡처 | 자막(요지) | 핵심/생략 |
|---|---|---|---|---|---|---|---|
| S1-01 의도 화면 | 10 | UI | `split`(위젯 A) · 콘솔 `A/dialogue/intents` | 의도 6개 표시 | — | "관리자가 질문 유형(의도)과 예문을 등록해 둔 상태입니다" | 생략 가능 |
| S1-02 노드 화면 | 10 | UI | 콘솔 `A/dialogue/nodes` | — | — | "질문 유형마다 답변 흐름을 연결합니다" | 생략 가능 |
| S1-03 꺼짐 상태 질문 | 15 | UI | 위젯 런처 "상담 시작하기"✓ → "메시지 입력"△에 "물건이 아직 안 왔어요" 타이핑 → "전송"✓ | 마지막 `.cb-msg-bot` = 폴백 문구(데이터셋) · 상한 10초 | ✓ | "등록된 예문과 표현이 달라 규칙만으로는 못 알아듣습니다" | **핵심** |
| S1-04 의미 매칭 켜기 | 15 | UI(headless: API `PUT A/answer-settings`) | 콘솔 `A/answer-settings` · "의미 매칭 사용"△(체크/스위치) 켬 → "저장"△ | 화면 알림 "저장되었습니다. 다음 턴부터 적용됩니다."✓ · API `semanticEnabled:true` | — | "사내 CPU 문장 분석을 켭니다 — 외부 AI 호출 없음" | **핵심** |
| S1-05 켠 뒤 같은 질문 | 15 | UI | 위젯에 같은 문장 전송 | 마지막 봇 말풍선 = 배송조회 응답(데이터셋) · 상한 10초 | ✓ + GIF ① | "같은 질문을 뜻으로 알아듣고 배송 조회 안내로 답합니다" | **핵심** |
| S1-06 예문 1개 추가 | 15 | UI | 콘솔 `A/dialogue/intents` · 배송조회 의도 예문 입력란△에 "택배가 언제 오나요" 입력 → 저장△ | API 의도 예문 수 +1 | — | "예문은 화면에서 바로 추가할 수 있습니다" | 생략 가능 |
| S1-07 시뮬레이터 | 10 | UI | 콘솔 `A/simulator` · 같은 문장 시험 | 매칭 근거 패널에 배송조회 | — | "배포 전 시뮬레이터로 근거를 확인합니다" | 생략 가능 |

- 실패 대체: S1-05 실패(저하 모드 등 — R-2) → 시뮬레이터(S1-07)로 매칭 근거만 보이고 자막 "실시간 응답 지연으로 시뮬레이터 결과로 대신 보여 드립니다" + 보고서 `FALLBACK`. S1-03이 폴백이 아니면(데이터 오염) `VERIFY` 실패.
- 구간 생략 순서: S1-06 → S1-07 → S1-02 → S1-01.

### 10.3 ② 상담원 인계(80초)

| 단계 | 예산 | 구분 | 동작 · 선택자 | 검증 | 캡처 | 자막(요지) | 핵심/생략 |
|---|---|---|---|---|---|---|---|
| S2-01 첫 미응답 | 10 | UI | 위젯 A **새 세션**(모형 출처 저장소 비우고 새로고침) · "상담원이랑 직접 얘기하고 싶어요" | 폴백 | — | "고객이 사람과 이야기하고 싶어 합니다" | **핵심** |
| S2-02 두 번째 미응답 | 10 | UI | "사람이랑 통화할 수 있나요?" | 폴백 | — | "같은 대화에서 두 번 연속 답하지 못했습니다" | **핵심** |
| S2-03 경고 표시 | 12 | UI | 계정 전환 **agent** · 콘솔 `/handoff-console/<A>/live` · 행 `hasText: "사람이랑 통화할 수 있나요?"`(열 "마지막 발화"✓) 대기 | 그 행에 "경고"✓ · 상한 15초(목록 5초 폴링 — C-13) | ✓ | "상담원 화면에 경고 표시된 대화가 나타납니다" | **핵심** |
| S2-04 개입 | 12 | UI | 행 클릭(상세 링크△) → "개입하기"✓ → 대화상자 범위 "개입하기"✓ | 상세에 "상담 중 · 나"✓ | — | "상담원이 대화를 맡자 챗봇 응답이 멈춥니다" | **핵심** |
| S2-05 자주 쓰는 문장 | 12 | UI | 응답힌트 "자주 쓰는 문장"✓ → "입력창에 넣기"✓ | 입력창 값 = 문장 | — | "자주 쓰는 문장을 바로 넣을 수 있습니다" | 생략 가능(→ S2-06이 직접 타이핑) |
| S2-06 상담원 메시지 도착 | 14 | UI | "메시지"✓ 입력창(비어 있으면 인사 문장 타이핑) → "전송"✓ | 위젯 `.cb-msg-agent`에 그 문장 · 상한 15초 | ✓ + GIF ② | "상담원이 보낸 말이 고객 화면에 바로 도착합니다" | **핵심** |
| S2-07 종료·이력 | 10 | UI | "상담 종료"✓ → 확인 → `…/history` | 이력에 1건 | — | "상담 기록은 사내 DB에만 남습니다" | 생략 가능 |

- 원문 노출 주의: S2-03~S2-06 상세 화면은 CONNECTED 담당자라 "원문 보기" 토글이 가능하지만 하네스는 누르지 않는다(열람 감사 행이 생기고 ⑥ 메시지와 충돌).
- 실패 대체: S2-06 상한 초과 → 콘솔 쪽 "보낸 메시지" 화면 캡처 + 자막 "연결이 지연되어 콘솔 화면으로 대신합니다". 생략 순서: S2-05 → S2-07.

### 10.4 ③ 통계·대시보드(55초)

| 단계 | 예산 | 구분 | 동작 | 검증 | 캡처 | 자막(요지) | 핵심/생략 |
|---|---|---|---|---|---|---|---|
| S3-01 반영 확인 | 5 | API | `waitFor` — `GET /stats/summary` 오늘 대화 수 ≥ 기준 + (①②의 턴 수) · 미응답 ≥ 기준 + 3(①1 + ②2) · 상한 10초(로그 적재 발사 후 망각) | 증가분 일치 | — | (자막 없음 — 이전 자막 유지) | **핵심**(검증) |
| S3-02 대시보드 | 20 | UI | 계정 **admin1** · `console` · `A/dashboard` | 화면의 오늘 수치 = API(△ 표시 형식) | ✓ | "방금 나눈 대화가 바로 집계됩니다 · 지난 14일은 시연용 과거 데이터" (disclosure) | **핵심** |
| S3-03 응답 출처 분포 | 15 | UI | `A/stats/overview` | 분포 영역 표시 | ✓ | "규칙·FAQ·의미 매칭·폴백 비율을 봅니다" | **핵심** |
| S3-04 통합 통계 | 15 | UI | `/` | — | — | "여러 챗봇을 한 화면에서 비교합니다" | 생략 가능 |

### 10.5 ④ 학습 개선 루프(95초)

| 단계 | 예산 | 구분 | 동작 · 선택자 | 검증 | 캡처 | 자막(요지) | 핵심/생략 |
|---|---|---|---|---|---|---|---|
| S4-01 미응답 큐 | 15 | UI | `A/stats/learning` · 행 "물건이 아직 안 왔어요" | 행 존재 · 추천 의도에 배송조회(있으면 강조) | ✓ | "챗봇이 못 알아들었던 질문이 쌓여 있습니다" | **핵심** |
| S4-02 사람이 반영 | 20 | UI(headless: API `POST …/unanswered-questions/:id/resolve`) | 그 행 "반영"✓ → 대화상자 "반영할 의도"✓에 "배송조회" → 대화상자 범위 "반영"✓ | 알림 "반영 완료 — 다음 대화부터 적용됩니다."✓ · API 의도 예문에 그 문장 | — | "관리자가 확인하고 예문으로 확정합니다 — 자동 반영 없음" | **핵심** |
| S4-03 예문 늘리기(규칙) | 20 | UI | `A/dialogue/intents` · 배송조회 · 예문 늘리기 패널△ → 생성 대기 → 허용 목록(A-9)에 든 후보 2개만 승인 | 승인 수 = 2 | — | "규칙으로 만든 후보 중 사람이 고른 것만 넣습니다 — AI 생성 아님" | 생략 가능 |
| S4-04 검증 실행 | 15 | API + UI | `POST A/test-sets/<세트>/runs` → `waitFor` 실행 완료 · 상한 60초 → 콘솔 `A/validation/runs/<id>` | 실패 0 · 완료 | — | "회귀 시험 15문항을 다시 돌립니다" | **핵심** |
| S4-05 통과 화면 | 15 | UI | 실행 상세 요약 | 화면 통과 수 = API | ✓ | "15문항 모두 통과 — 기준 실행보다 1문항 개선" | **핵심** |
| S4-06 실행 비교 | 10 | UI | `A/validation/compare?…`(기준 vs 이번) | 개선 1 | — | "변경 전후를 문항 단위로 비교합니다" | 생략 가능 |

- 실패 대체: S4-04 상한 초과 → 기준 실행 상세 + 자막 "시험이 아직 진행 중이어서 이전 결과를 보여 드립니다"(FALLBACK). 생략 순서: S4-03 → S4-06.

### 10.6 ⑤ 버전·배포 통제(95초)

| 단계 | 예산 | 구분 | 동작 · 선택자 | 검증 | 캡처 | 자막(요지) | 핵심/생략 |
|---|---|---|---|---|---|---|---|
| S5-01 환경 현황 | 10 | UI | `split`(위젯 **B**) · admin1 · `B/environment` | 머리 배지 "운영 v1 · 스테이징 v2 …"✓ · 2인 승인 "켜짐"✓ | — | "운영·스테이징·초안이 분리되어 있고 운영 전환엔 두 사람이 필요합니다" | **핵심** |
| S5-02 전환 요청 | 15 | UI | "운영 전환 승인 요청..."✓ → "v2 승인 요청 보내기"✓ | 알림 "승인 요청을 보냈습니다. …"✓ · API 요청 `PENDING` | — | "관리자 1이 요청합니다 — 승인 전엔 운영이 바뀌지 않습니다" | **핵심** |
| S5-03 두 번째 관리자 승인 | 20 | UI | 계정 전환 **admin2** · `/environment-approvals` · "가온마켓 운영 통제 데모 승인 요청 자세히 보기"✓ → "승인하고 운영에 적용"✓ → 대화상자 "승인"✓ | 알림 "v2을 운영에 적용했습니다."✓ · API 운영 포인터 = v2 | ✓ | "다른 관리자(관리자 2)가 승인합니다 — 본인 요청은 본인이 승인할 수 없습니다" | **핵심** |
| S5-04 위젯 답 변경 | 12 | UI | 위젯 B "영업시간 알려 주세요" | 봇 말풍선 = v2 문구 · 상한 10초(필요 시 하네스가 먼저 공개 API로 v2 응답을 확인한 뒤 화면 질문 — 번들 캐시 대비) | ✓ + GIF ③ | "고객 화면의 답이 새 버전으로 바뀌었습니다" | **핵심** |
| S5-05 즉시 되돌리기 | 15 | UI | 계정 **admin1** · `B/environment` · "직전 버전으로 되돌리기..."✓ → "승인 없이 바로 실행됨을 이해했습니다"✓ 체크 → "v1로 즉시 되돌리기(승인 없이)"✓ | API 운영 = v1 · (시간 남으면) 위젯 재질문 = v1 문구 | — | "문제가 있으면 직전 버전으로 즉시 되돌립니다 — 기록이 남습니다" | **핵심** |
| S5-06 감사 기록 | 10 | UI | `console` · `/settings/audit-logs`(대상 필터 "운영 전환 승인 요청"△) | 요청자 admin1 · 승인자 admin2 행 | ✓ | "누가 요청하고 누가 승인했는지 감사 기록에 남습니다" | **핵심** |
| S5-07 예약 배포 | 13 | UI | `C/deploy-schedules/<C-2>` | C-2 실행 완료(남은 대기 ≤ 25초면 `waitFor`) · 아니면 대체 | — | "예약과 두 번째 관리자의 사전 승인은 시연 시작 시점에 처리했고, 정해진 시각에 자동 실행되었습니다"(disclosure) | 생략 가능 |

- 대체: S5-07 → 이력 C-1 상세 + 자막 "준비 단계에서 같은 방식으로 실행된 예약 기록입니다"(FR-DH9-2). S5-03 실패 → 승인 요청 상세의 "자기 승인 불가" 안내(관리자 1 화면) 캡처로 대체하지 않는다 — 핵심 장면 실패로 기록(정직성).
- 생략 순서: S5-07 → (그 외 없음 — 핵심 6개만으로 82초).

### 10.7 ⑥ 개인정보·안전(70초)

| 단계 | 예산 | 구분 | 동작 · 선택자 | 검증 | 캡처 | 자막(요지) | 핵심/생략 |
|---|---|---|---|---|---|---|---|
| S6-01 개인정보 질문 | 12 | UI | `split`(위젯 A **새 세션**) · "카드 4111-1111-1111-1111로 결제했는데 주민번호 900101-1234567도 알려 드려야 하나요?" | 응답(환불문의 또는 폴백) | — | "고객이 개인정보를 그대로 입력했습니다(입력 화면엔 그대로 보입니다)" | **핵심** |
| S6-02 저장본 가림 | 15 | UI | admin1 · `/handoff-console/<A>/live` · 행 `hasText: "[카드번호]"` → 상세 "대화 보기"✓ | 화면 고지 "개인정보는 자동으로 가려진 상태로 표시됩니다."✓ · 화면·API(`GET A/live-sessions/<ref>/transcript`)에 `[카드번호]`·`[주민등록번호]` 있고 원문 숫자 0 | ✓ | "저장되는 기록과 관리자 화면에는 가려진 채로만 남습니다" | **핵심** |
| S6-03 위험 질문 | 12 | UI | 위젯 "이 약을 두 배로 먹어도 되나요?" | 봇 말풍선 = 대체 문구(데이터셋) | ✓ | "의료 조언 질문엔 정해 둔 안전 문구로 답합니다" | **핵심** |
| S6-04 걸린 기록 | 10 | UI | `console` · `A/guardrails/events` | 1건 · API `GET A/guardrails/events` 1건 | — | "어떤 규칙에 걸렸는지 기록됩니다(가려진 문장으로)" | 생략 가능 |
| S6-05 데이터 지도 | 11 | UI | `/settings/data-governance/map` | (S0-02와 같음) | — | "외부 출구는 같은 PC의 문장 분석 서버 1곳뿐" | 생략 가능(S0-02를 생략했으면 **핵심으로 승격**) |
| S6-06 보존 기간 | 10 | UI | `/settings/data-governance/retention` | — | — | "보존 기간이 지나면 대화 원문은 자동으로 지워집니다" | 생략 가능 |

- 가짜 개인정보 값은 시험데이터 문서에 고정(패치 H-4) — 형식만 맞는 값(시험용 카드 번호 · 존재하지 않는 생년월일 조합).
- 나레이션은 "입력창에서 가려진다"고 말하지 않는다(FR-DH4-10). 생략 순서: S6-06 → S6-04 → S6-05(이월 아닌 경우).

### 10.8 ⑦ 발화 묶음 분석(70초)

| 단계 | 예산 | 구분 | 동작 · 선택자 | 검증 | 캡처 | 자막(요지) | 핵심/생략 |
|---|---|---|---|---|---|---|---|
| S7-01 파일 올리기 · 미리보기 | 15 | UI | `console` · `A/stats/utterance-analyses/new` · 파일 입력 "발화 파일"✓에 `setInputFiles(<픽스처 절대 경로>)`(대화상자 열지 않음) | "파일 검사를 마쳤습니다. 분석할 발화는 N개입니다"✓ · N = 픽스처 유효 행 | — | "상담 녹취를 글로 옮긴 발화 파일을 올립니다" | 생략 가능 |
| S7-02 결과(미리 분석) | 15 | UI | `A/stats/utterance-analyses/<사전 분석 id>` | 묶음 ≥ 3 | ✓ + GIF ④ | "같은 파일을 미리 분석해 둔 결과입니다 — 사내 CPU로 약 n초 걸렸습니다"(disclosure, n = 사전 분석 실측) | **핵심** |
| S7-03 발화 고르기 | 15 | UI | 포인트 묶음 "n번 묶음의 발화 보기"✓ → 필터 "아직 안 넣은 것만"✓ → 행 체크박스 3개(`…선택`△) | "3개 선택됨 — 최대 50개"✓ | — | "사람이 확인해 넣을 문장만 고릅니다" | **핵심** |
| S7-04 예문으로 넣기 | 15 | UI | "선택한 발화를 의도 예문으로 넣기"✓ → "이미 있는 의도에 넣기"✓ → "의도 검색"✓ "포인트문의" → "미리보기"✓ → 확정△ | API 포인트문의 예문 수 = 이전 + 3(중복 제외 규칙 반영 후 미리보기 수와 일치) | ✓ | "고른 문장만 '포인트문의' 예문이 됩니다" | **핵심** |
| S7-05 반영 확인 | 10 | UI | `A/dialogue/intents` · 포인트문의 | 예문 표시 | — | "바로 다음 대화부터 적용됩니다" | 생략 가능 |

- 보이는 모드는 새 분석을 시작하지 않는다(A-13) — S7-01 뒤 이동 시 미저장 확인(`beforeunload`)은 §8.6 규칙으로 수락.
- headless: S7-01 뒤 "분석 시작"✓ → 상세에서 `waitFor` 완료 · 상한 120초 → **그 분석**으로 S7-03~04(실제 대기 — P-6).
- 실패 대체: ml-worker 중단(S-4·AC-DH5-1) → visible은 S7-02가 사전 분석이라 영향 없음 · headless는 `TIMEOUT`/`ACTION` 실패 + ml-worker 로그 꼬리.

### 10.9 끝 — 로드맵(15초)

| 단계 | 예산 | 구분 | 동작 | 검증 | 캡처 | 자막 | 핵심/생략 |
|---|---|---|---|---|---|---|---|
| S9-01 로드맵 | 12 | UI | `card` · `/roadmap` — No.17·31·32·33·34·38 각 1줄(무엇 · 왜 지금 시연하지 않나) · 목업 0 | 6행 | ✓ | "대형 생성 모델 기능은 운영 GPU 서버에서 실측 후 보여 드립니다 — 일정 약속 없음" | **핵심** |
| S9-02 예약 재확인 | 3 | API | S5-07이 대체였다면 C-2 상태를 1회 조회해 보고서에 "공연 중 실행 확인됨/미실행" 기록(화면 변화 없음) | — | — | — | 생략 가능 |

- 로드맵 문구 원천: `src/data/roadmap.ts`(각 행에 근거 문서·비고 열 인용 필드). No.38 상태 문구는 PM 확인 Q-7(요구사항 FR-DH10-1은 "보류", 현재 작업 지시는 "다음 진행" — 두 근거가 다르다).
- **[DT-2]** 풀 투어의 끝 장면은 오늘 시연한 기능(No.32)을 로드맵에서 빼고 "이 PC 구성에서 생략한 장면" 줄을 덧붙인다(확장 설계 §9.10). 10분판 로드맵은 그대로.

### 10.10 핵심 장면 · 캡처 개수(AC-DH4-1)

핵심 캡처 = S0-01 · S1-03 · S1-05 · S2-03 · S2-06 · S3-02 · S3-03 · S4-01 · S4-05 · S5-03 · S5-04 · S5-06 · S6-02 · S6-03 · S7-02 · S7-04 · S9-01 = 17장 · 그중 **구간별 대표 9장**(시작 S0-01 · ① S1-05 · ② S2-06 · ③ S3-02 · ④ S4-05 · ⑤ S5-04 · ⑥ S6-02 · ⑦ S7-04 · 끝 S9-01)을 보고서 갤러리 첫 줄에 둔다.

---

## 11. 시간 관리(FR-DH4-7 · NFR-DHP1)

### 11.1 예산표(요구사항 §2.3과 같은 구간 예산)

| 구간 | 예산 | 단계 예산 합 | 핵심만의 합 | 생략 순서 |
|---|---|---|---|---|
| 시작 | 30 | 15+15 | 15 | S0-02 |
| ① | 90 | 10+10+15+15+15+15+10 | 45 | S1-06 → S1-07 → S1-02 → S1-01 |
| ② | 80 | 10+10+12+12+12+14+10 | 58 | S2-05 → S2-07 |
| ③ | 55 | 5+20+15+15 | 40 | S3-04 |
| ④ | 95 | 15+20+20+15+15+10 | 65 | S4-03 → S4-06 |
| ⑤ | 95 | 10+15+20+12+15+10+13 | 82 | S5-07 |
| ⑥ | 70 | 12+15+12+10+11+10 | 39 | S6-06 → S6-04 → S6-05 |
| ⑦ | 70 | 15+15+15+15+10 | 45 | S7-01 → S7-05 |
| 끝 | 15 | 12+3 | 12 | S9-02 |
| **합** | **600** | 600 | **401(약 6분 41초)** | 여유 약 3분 19초 |

### 11.2 알고리즘(보이는 모드)

```
elapsed = 공연 경과 - 일시정지 누계
단계 시작 전: lag = elapsed - (이 단계 앞까지의 예산 누계)
  lag > 0 이면 → 이 구간의 skipOrder에서 아직 안 한 생략 가능 단계를, 예산 합이 lag 이상이 될 때까지 "생략" 표시
  (현재 구간으로 부족하면 다음 구간 단계 생략은 다음 구간 시작 때 다시 판단)
단계 실행: run → verify(조건 대기)
단계 종료: 실제 소요 < 예산이면 남은 시간만큼 화면 유지(dwell — 자막 표시 · 최소 표시 2초 보장)
          실제 소요 ≥ 예산이면 즉시 다음 단계
```

- 핵심 단계는 절대 생략하지 않는다(AC-DH4-2) — 핵심만으로도 늦으면 끝까지 진행하고 초과 시간을 보고서에 기록.
- 단계 사이 최소 표시 1.5초 · 타이핑 1글자 70ms(FR-DH4-5 권고 범위 안).
- 일시정지 중에도 실시간 예약(C-2)은 흐른다(서버 시계) — §7.6 마지막 문단.

### 11.3 무인 점검

- 예산·dwell·생략 없음(전 단계 실행) · 타이핑 지연 0(`fill`) · 자막·영상·GIF 없음 · 스크린샷은 핵심 + 실패 순간만 · 단계 결과에 `actualSec`만 기록(예산 대비 표시는 하지 않음).
- 라이브 예약 C-2는 기본 생략(`--wait-live-schedule`로 켬) · 이력 C-1 실행 확인은 준비 단계에서 이미 검증된다.
- 목표 시간(NFR-DHP3): 약 4~6분(준비 제외 · 추정).

### 11.4 레이트 리밋

공개 대화: 세션당 분당 30 · IP 분당 120. 무인 점검의 공개 대화 수는 약 15턴(위젯) + 하네스 API 확인 약 10턴 → 한도 안. 429가 나면(EX-DH-10) 1초 뒤 1회 재시도 후 실패 — 한도 상향은 하지 않는다(시연 설정 공개표를 늘리지 않음).

---

## 12. 구축형 강조점 구현(§1.7)

| 강조점 | 장면 | 하네스가 보이는 증거 | 정직성 장치 |
|---|---|---|---|
| 이 PC 한 대에서 전부 | S0-01 | 구성 카드: 프로세스 2 + 정적 서버 3(이름·포트·바인드) · 콘솔이 제품 빌드 산출물임 | "노트북 = 사내 서버 가정" 자막 · API는 모든 인터페이스 바인드(제품 동작)라 "같은 망 접근 가능" 주의를 보고서에 |
| GPU 없이 CPU | S0-01 · S1-05 · S7-02 | `EMBEDDING_DEVICE=cpu` + `CUDA_VISIBLE_DEVICES=-1`(GPU 비노출) · `/health` · 단건 지연 실측 · 사전 분석 소요 시간 · Ollama 미기동(PC-10) | 주장 범위 = **AI 추론**. 브라우저 화면 그리기는 GPU를 쓸 수 있다는 문장을 보고서에 고정 |
| 데이터가 외부로 안 나감 | S0-01 · S0-02/S6-05 | 외부 송신 점검표(§13.2) · 데이터 지도 출구 · 기동 로그 "출구 허용=1개" · 브라우저 차단 기록 | DHX-1(글꼴) 수정 전에는 "서버는 외부로 보내지 않습니다"까지만 말한다(P-8) — 브라우저 차단 기록에 글꼴 요청이 남는 것을 그대로 보고 |
| 출구 게이트(거버넌스) | S0-01 · S6-05 | 모드 ON · 허용 목록 1개 | 기동 실패 시 OFF 재기동 + 표기(EX-DH-12) |
| 보존·파기 | S6-06 | 보존 기간 화면 | 공연 중 파기 실행 0 · 파기 잡 꺼짐 표기 |
| 감사 | S5-06 · (S6) | 요청자·승인자 2행 | 하네스는 감사 로그를 지우거나 고치지 않음(NFR-DHS6) |
| 폐쇄망 | 시작 · 보고서 | PC-9 차단 관측 · `HF_HUB_OFFLINE=1` 모델 로드 성공 · Prisma 버전 확인 비활성 | "차단됨/열림"을 사실대로 기록 |
| 사람 승인(HITL) | ④ · ⑤ · ⑦ | 반영·승인·선택 장면 | 자동 반영 없음 문구 |

---

## 13. 외부 송신 차단과 점검표

### 13.1 차단(FR-0-312 · FR-0-313)

| 층 | 조치 | 확인 |
|---|---|---|
| API 환경 | §6.2 백지 시작 · 출구 키 빈 값 · 증강 `rule` | 기동 후 `GET /governance/map` 출구 상태 · 기동 로그 줄 확인 |
| API `.env` | `CHATBOT_API_IGNORE_ENV_FILE=1` + 선적재 스크립트(아래) | AC-DH2-1 시험(§20) |
| ml-worker | 작업 폴더 = 실행 폴더(C-19) · 오프라인 3종 | `/health` 응답 `modelId` = KURE-v1 · 로그에 다운로드 시도 0 |
| Prisma CLI | `CHECKPOINT_DISABLE=1` | — |
| 브라우저 | 비루프백 요청 차단·기록(§8.5) | 차단 기록 |
| 네트워크 | 진행자가 노트북 네트워크 차단(P-8 b) | PC-9 관측 |

**API 선적재 스크립트**(`src/runtime/isolate-api-env.cjs` — `node -r` · **[정정 #2] 컴파일 산출물이 아니라 이 원본 경로를 직접 넘긴다**):

```js
// 1) 하네스가 넘긴 키 집합을 기억 2) apps/api 기준으로 @prisma/client를 먼저 require(.env 적재 소진)
// 3) 그 사이 새로 생긴 키 중 하네스가 넘기지 않은 키를 삭제 4) 삭제한 키 이름만(값 X) stderr 1줄 → api.log
const before = new Set(Object.keys(process.env));
require(require('module').createRequire(process.env.CBDEMO_API_PACKAGE_JSON).resolve('@prisma/client'));
for (const k of Object.keys(process.env)) if (!before.has(k)) delete process.env[k];
```

- `jest.isolate-env.js` 1~51행과 같은 기법이다. 하네스 전용 키는 `CBDEMO_API_PACKAGE_JSON`·**`NODE_PATH`·`NO_COLOR`**(정정 #3 — §6.2 하네스 전용 키 표)를 넘긴다 — 모두 제품 설정 스키마 밖이라 제품 동작에 영향 없음. `NODE_PATH`는 `.env` 차단과 무관하게 **API 기동 자체의 전제 조건**이다(C-20 · DHX-4).
- 파일 첫 줄에 eslint 파일 단위 disable 주석을 둔다(루트 eslint 설정이 `.cjs`를 무시하지 않음 — 정정 #12).
- `new PrismaClient()`가 다시 `.env`를 적재해도 ① 설정 스키마의 기본값 있는 키는 `ConfigModule` 검증 스냅샷이 이미 고정돼 있고 ② 기본값 없는 선택 키(출구 4종)는 빈 문자열로 이미 존재해 덮이지 않는다(DHD-10 ④). 남는 경로(스키마 밖에서 `process.env`를 직접 읽는 접두 규약 비밀 — `WORKFLOW_SECRET__*`·`LEGACY_*` 시크릿·`OMNI_*`)는 해당 기능을 데모에서 쓰지 않으므로 관측 영향 0 — 보고서 "알려진 한계"에 기록.
- 2026-10-01 실측: 이 PC의 `apps/api/.env`에 Gemini 설정(`AUGMENTATION_GEMINI_API_KEY` 등)이 있었지만 자식 env에는 빈 문자열이 들어갔고, 선적재가 지운 키는 `AUGMENTATION_TIMEOUT_MS` 1개였다(나머지는 하네스가 명시한 값이 이김) — 4중 차단 모두 동작.

### 13.2 외부 송신 점검표(보고서 · FR-DH2-4 · AC-DH2-3)

| 칸 | 내용 |
|---|---|
| 서버 출구 키 | `EMBEDDING_BASE_URL`(루프백 `127.0.0.1:8100`) · `RAG_BASE_URL`·`AUGMENTATION_GEMINI_BASE_URL`·`AUGMENTATION_LOCAL_BASE_URL`(미설정) · Gemini 키(미설정 — 값 비공개) · 업무 자동화 대상 0 · 지식베이스 동기화 꺼짐 |
| 증강 공급자 | 규칙 기반(`rule`) |
| 거버넌스 | 모드 ON · 출구 허용 1개(`127.0.0.1:8100`) — 기동 로그 근거 |
| ml-worker | 바인드 `127.0.0.1` · 오프라인 모드 · 장치 cpu · GPU 비노출 |
| 개발자 `.env` | 차단한 키 이름 목록(PC-15) · 선적재가 지운 키 이름 목록(api.log) |
| 브라우저 | 공연 중 차단한 외부 요청 호스트·횟수(실측: `fonts.googleapis.com` 1호스트 — DHX-1 수정 전 빌드) |
| 네트워크 | 차단됨/열림(PC-9 관측 · 시각) |
| 바인드 주의 | API는 모든 인터페이스(제품 동작) — 네트워크 차단 권고 |

---

## 14. 단건 질의 임베딩 300ms 예산(J-11 · FR-DH2-3)

- **측정(1라운드)**: ml-worker `warmedUp=true` 뒤 대표 질의 23개(데이터셋 문장)로 `POST /embed {texts:[q], kind:'QUERY'}`를 순차 호출 — 앞 3개는 버리고 20개의 하네스 측 왕복 시간으로 P50·P95(최근접 순위 — 20개 중 19번째 값).
- **[정정 #4] 반복 규칙**: 1라운드 P95가 200ms를 넘으면 **같은 측정을 다시 한다 — 최대 3라운드, P95 ≤ 200ms인 라운드가 나오면 거기서 멈춘다.** 결정(아래 표)은 **마지막 라운드** 값으로 하고, **모든 라운드의 P50·P95를 보고서·`result.json`에 공개**한다(한 라운드만 고른 것처럼 보이지 않게).
  - 이유: 2026-10-01 실측에서 모델 적재 직후(가용 RAM 약 4.3GB) 수동 측정 3회가 P50 631~955ms · P95 1457~1666ms였고, 곧바로 이어진 측정은 P50 119~133ms · P95 138~167ms로 안정됐다(CPU 사용률 6.7% — CPU 부하가 아니라 약 3GB 상주 모델 페이지가 올라오는 구간으로 추정, 미검증). 1회만 재면 대기 시간을 2000ms까지 잘못 올려 "저하 모드"로 오판한다.
  - 반복해도 끝까지 200ms를 넘으면 그것이 이 PC의 실제 상태다 — 표대로 올리고 공개한다(속이지 않음).
  - 가용 RAM이 낮으면 이 현상이 길어지므로 사전 점검 **PC-11b**(가용 < 2GiB 경고)로 미리 알린다.
- **결정**:

| 마지막 라운드 P95 | `EMBEDDING_TIMEOUT_MS` | 조치 |
|---|---|---|
| ≤ 200ms | 300(기본) | 그대로(API 쪽 HTTP·직렬화 여유 100ms) |
| 200 초과 ~ 1000 | `clamp(50 단위 올림(P95 × 2), 400, 2000)` | API 재기동 · **시작 자막 1줄**("이 노트북 CPU에 맞춰 문장 분석 대기 시간을 ○○ms로 늘렸습니다") · 보고서 공개표 |
| > 1000 | 2000 | EX-DH-4 — ①을 "저하 모드" 위험으로 표시, visible은 진행자 확인(진행/중단), headless는 경고 후 진행 |

- 실측(2026-10-01 · 이 노트북 i7-10750H · RAM 17.0GB · CPU 추론): 안정 상태 **P50 108~133ms · P95 111~167ms**(수동 3회 + 하네스 3회, 각 20건) → **300ms 유지**(API 재기동 없음). 설계 당시 참고값(`자동배포.md` §5.8 등급 0 · P95 126~159ms)과 일치.
- 보고서에 장비(CPU 모델·코어·RAM)·일자·커밋과 함께만 수치를 쓴다(FR-0-317). 기본값 자체는 바꾸지 않는다(설계 문서 상향 금지 원칙 — 실행별 환경변수만).
- `--embedding-timeout-ms`로 수동 지정하면 측정은 하되 결정은 지정값 · "수동 지정" 공개.

---

## 15. 캡처

| 산출 | 방법 | 비고 |
|---|---|---|
| 스크린샷 | `page.screenshot()`(무대 최상위 — `iframe` 포함) · PNG · `shots/<단계 ID>.png` · 실패 순간 `shots/<단계 ID>-FAIL.png` | 로그인 화면은 찍지 않음(쿠키 주입이라 로그인 화면 자체가 없다) · 비밀번호가 화면에 나오는 장면 0(FR-DH5-6) |
| 영상 | 영속 컨텍스트 `recordVideo: { dir: video/, size: viewport }` · 페이지 1개만 쓰므로 파일 1개 · **[정정 #6] Playwright가 만드는 파일 이름은 `page@<해시>.webm`** → 컨텍스트를 닫아 파일이 확정된 뒤 `video/show.webm`으로 이름 변경 | **Playwright 전용 ffmpeg 필요**(PC-6). **없으면 `recordVideo`를 넘기지 않는다**(넘기면 컨텍스트 기동 예외 — 정정 #6) — 영상만 끄고 나머지 진행 · 반입: 인터넷 PC에서 `node node_modules/playwright-core/cli.js install ffmpeg`로 받은 **`%LOCALAPPDATA%\ms-playwright\ffmpeg-1011`·`winldd-1007` 두 폴더**를 같은 위치에 복사(약 3.7MB · `playwright-core 1.63.0`과 짝 — §19) |
| 자막 파일 | 하네스가 자막 표시 이벤트(시각·문장)로 **WebVTT 직접 생성**(`video/show.vtt`) · 시각 기준 = T0 · 구간 시작마다 `NOTE` 블록 | 영상 길이 = 공연 시간 ± 10초(AC-DH6-2 — 녹화 시작 지연 보정은 VTT 시각에 반영) |
| GIF 4개 | 지정 단계 동안 500ms 간격 스크린샷(최대 12장 · 6초) → `pngjs` 디코드 → 가로 960px로 축소 → `gifenc` 256색 양자화·인코딩 → `gif/<단계 ID>.gif` | 외부 인코더 0 · 대상: S1-05(①) · S2-06(②) · S5-04(⑤) · S7-02(⑦) · 인코딩은 보고서 단계에서 수행(공연 지연 0) · 2026-10-01 확인: 1280x720 2프레임 → 11.6KB `GIF89a` |
| 나레이션 로그 | 단계별 시각·문장·결과 → `report/summary.md`·`result.json` | TTS 없음(FR-DH5-5) |

- 디스크 부족(EX-DH-14): 녹화 중 여유 < 500MB를 30초마다 확인 → 다음 단계부터 영상 끄기(Playwright는 녹화 중지를 지원하지 않으므로 **컨텍스트 재시작 없이** "영상 불완전" 표기로 처리) · 스크린샷 계속.

---

## 16. 실패 보고 · 재개(FR-DH7)

| 항목 | 내용 |
|---|---|
| 분류 | `PREFLIGHT`·`BUILD`·`BOOT`·`DATA`·`ACTION`·`TIMEOUT`·`VERIFY`·`SELECTOR`·`TEARDOWN` |
| 첨부 | 실패 스크린샷 · 관련 API 요청/응답(쿠키·`Authorization`·비밀번호·`temporaryPassword` 제거 — §17.3) · 각 로그 마지막 200줄(`api`·`ml-worker`·`harness`·`browser-console`) · 기대값/실제값 · 선택자(SELECTOR일 때 — "선택자 갱신 필요") |
| 위치 | 보고서 맨 위 "실패 요약" · 터미널 마지막 블록 |
| 재개 안내 | `pnpm demo -- --resume <runId> --from S3`(재개 가능 = 그 구간 처음 · 준비 실패는 재개 불가 → 새 실행 안내) |
| visible 계속 | 단계 실패 → `fallback`이 있으면 대체 화면 + "준비된 결과로 대신 보여 드립니다" → 구간 계속 · 없으면 구간의 다음 단계로 |
| headless | 단계 실패 → 그 구간 중단 · 다음 구간 계속(`--fail-fast`면 즉시 중단) · 앞 구간 실패에 의존하는 단계는 `SKIPPED(선행 실패)` |

- `BOOT` 실패 시 API 로그 꼬리에 `MODULE_NOT_FOUND`가 있으면 "의존성 해석 실패 — `NODE_PATH` 전달 여부·`pnpm install` 상태 확인(DHX-4 참고)"을 조치 문구로 붙인다.

---

## 17. 결과 JSON · 보고서

### 17.1 `result.json`(스키마 v1 — `src/report/schema.ts` zod)

```jsonc
{
  "schemaVersion": 1,
  "tool": "DT-1",
  "runId": "20261001-143012-a7k2",
  "preset": "customer-onprem-10m",
  "mode": "visible",                         // | "headless-check"
  "status": "PASSED",                        // PASSED | FAILED | ABORTED | PREPARE_FAILED
  "exitCode": 0,
  "commit": { "sha": "…", "dirty": false },
  "startedAt": "…+09:00", "showStartedAt": "…", "endedAt": "…",
  "durations": { "prepareSec": 0, "showSec": 0, "pausedSec": 0 },
  "machine": { "os": "Windows 11 …", "cpu": "…", "cores": 0, "ramGb": 0, "freeRamGb": 0, "gpu": "NVIDIA … | 없음", "gpuUsedByHarness": false },
  "browser": { "kind": "msedge", "version": "154.…", "playwright": "x.y.z", "video": true },
  "embeddingLatency": { "samples": 20, "p50Ms": 0, "p95Ms": 0, "decidedTimeoutMs": 300, "source": "measured",
                        "rounds": [ { "p50Ms": 0, "p95Ms": 0 } ] },   // [정정 #4] 모든 라운드(결정 = 마지막)
  "overrides": [ { "key": "DEPLOY_SCHEDULE_POLL_INTERVAL_MS", "value": "5000", "default": "30000", "reason": "⑤ 예약" } ],
  "egressChecklist": [ { "item": "RAG_BASE_URL", "state": "UNSET" } ],
  "browserBlockedRequests": [ { "host": "fonts.googleapis.com", "count": 0, "firstStepId": "S0-02" } ],
  "network": { "offline": true, "checkedAt": "…" },
  "honesty": [ { "stepId": "S7-02", "kind": "PREPARED_RESULT", "text": "…" } ],   // MOCK | PREPARED_RESULT | DEMO_SETTING | FALLBACK | SKIPPED | HISTORICAL_DATA
  "dataset": { "historicalLogs": 420, "accounts": 5, "chatbots": 3 },
  "segments": [ { "key": "s1", "budgetSec": 90, "actualSec": 0, "status": "PASSED" } ],
  "steps": [
    { "id": "S1-05", "segment": "s1", "title": "…", "core": true, "status": "PASS",   // PASS | FAIL | SKIPPED | FALLBACK
      "budgetSec": 15, "actualSec": 0, "captures": ["shots/S1-05.png", "gif/S1-05.gif"],
      "skipReason": null,                     // TIME | PRESENTER | OPTION | DEPENDENCY | NO_BROWSER
      "failure": null                          // { kind, message, expected, actual, logs: {api: "logs/…"}, resume: "…" }
    }
  ],
  "appendix": { "llm": null },                 // FR-DH10-3 — { status: "동작 확인"|"실패", candidates, seconds }
  "teardown": { "processesLeft": 0, "portsFreed": true, "devDbUnchanged": true }
}
```

- CI용 정리(P-7): 이 파일 + 종료 코드만으로 기계 판정이 가능하게 한다(종료 코드 보존은 루트 스크립트 `-C` 형태가 전제 — §3.3). CI 설정 파일은 만들지 않는다(FR-0-319).

### 17.2 `report/index.html`(FR-DH6 · NFR-DHA3)

1. 머리: 제목 · 실행 정보(일시·커밋·프리셋·모드·장비) · 결과 배지(통과/실패/생략/대체 수 · 총 소요)
2. **실패 요약**(있을 때 맨 위)
3. 핵심 장면 갤러리(구간 대표 9장 → 나머지 핵심) — `<figure>` + `<img alt="<단계 제목>">` + `<figcaption>`
4. 영상(`<video controls src="../video/show.webm">` + `<track kind="captions" srclang="ko" src="../video/show.vtt">`) · GIF 4개
5. 구간·단계 표(예산 vs 실측 · 상태 · 캡처 링크 · 생략 사유)
6. 시연용 설정 공개표 · 외부 송신 점검표 · 단건 지연 실측(**라운드별 P50·P95 전부** — 정정 #4)
7. 정직성 표기(모형 0 · 사전 준비 결과 · 과거 데이터 n건 · 대체 · 준비 단계 보정)
8. 로드맵 · (부록) LLM 동작 확인
9. 실패 상세(로그 꼬리 — 내부판만) · 알려진 한계(§21.5 고정 문구)

- 외부 CSS·JS·글꼴 0(인라인 `<style>` · 스크립트 없음) · `lang="ko"` · 제목 구조 h1→h2→h3 · 표 `<caption>` · 키보드로 모든 링크 접근(NFR-DHA3 · AC-DH6-3). 시각 규칙은 ui-designer 명세.
- **고객 전달판**(`--customer-copy` → `report/customer.html`): 실패 상세·로그·내부 경로·계정 이메일 제거 · 실패 단계는 "이번 시연에서 생략된 장면"으로 표기.
- `summary.md`: 같은 내용의 개발자용 요약(이미지 상대 링크).

### 17.3 비밀 제거(`redact.ts` · AC-DH5-3)

- 대상: `cb_session` 값 · `Set-Cookie`·`Cookie` 헤더 · `password`·`currentPassword`·`newPassword`·`temporaryPassword` 필드 · `DATA_ENCRYPTION_KEYS` 값 · 하네스 메모리의 계정 비밀번호 문자열(실행 중 생성한 값 목록과 대조해 어떤 텍스트에서든 치환).
- 보고서·로그·`state.json` 쓰기 경로 전부가 `redact()`를 지난다(오케스트레이터가 `Redactor`를 `Terminal`·`ManagedProcess`·`writeStateFile`에 주입 — 로그인 쿠키·비밀번호는 생성 즉시 `Redactor`에 등록). 정리 단계 마지막에 실행 폴더 텍스트 파일 전체를 비밀번호·쿠키 목록으로 검색해 0건이 아니면 경고(자기 검사).

---

## 18. 보안 · 데이터 원칙(NFR-DHS)

| # | 원칙 | 구현 |
|---|---|---|
| S-1 | 운영·개발 DB 접근 0 | `assertIsolatedDbUrl(url, runDir)` — `file:` + 실행 폴더 하위 절대 경로만 허용 · `apps/api/prisma/dev.db` 실 경로와 같으면 거부 · 원격 DB 스킴 거부 · 기동 전 1회 + 하네스 Prisma 클라이언트 생성 전 1회. 시험 전용 숨은 인자 `--db-url-for-test`도 같은 가드를 지나며 밖이면 종료 2(AC-DH2-4) |
| S-2 | 비밀 | 계정 비밀번호 = 터미널 요약만 · 쿠키 = 메모리만 · 암호화 키(켠 경우) = `<실행 폴더>/.secrets/keys.json`(보고서·로그 대상 아님 · 정리 시 삭제 · `--no-teardown`이면 남김을 안내) |
| S-3 | 바인드 | ml-worker·하네스 서버 = `127.0.0.1` · API = 제품 동작(모든 인터페이스) — 보고서 주의 + 네트워크 차단 권고 |
| S-4 | 브라우저 | 실행 폴더 안 새 프로필 · 정리 시 삭제 · 사용자 프로필·확장 미사용 |
| S-5 | 캐시 | HF 캐시·Ollama 모델 저장소는 읽기만(잠금 파일 예외 기록) · 하네스는 내려받기를 하지 않는다 |
| S-6 | 감사 로그 | 하네스는 감사 로그를 지우거나 고치지 않는다(DB 직접 쓰기 대상에 감사 테이블 없음 — 정적 검사 H-S3) |
| S-7 | 실행 폴더 | 저장소 무시 목록(`/.demo-runs/`) · 최근 5개 보존 · 커밋 0(FR-0-321) |
| S-8 | 개인정보 | 데이터셋·픽스처에 실제 개인정보 0 · 가짜 값은 시험데이터 문서 고정 |

---

## 19. 의존성 · 폐쇄망 반입

| 의존성 | 범위 | 설치 스크립트 | 폐쇄망 반입 |
|---|---|---|---|
| `playwright-core` | 하네스 전용 · **`1.63.0` 정확 고정**(2026-10-01 Edge 154와 동작 확인 — 번들 Chromium 153이라 한 버전 낮아도 동작) | 없음 | `node_modules`(pnpm 저장소)와 함께 |
| Edge | 이 PC 설치본(`154.0.4258.37`) | — | 반입 0 |
| Playwright 전용 ffmpeg | 영상 녹화 전용 · `playwright-core` 버전과 짝(`browsers.json`의 ffmpeg 리비전 **1011**) | — | **[정정 #6]** `%LOCALAPPDATA%\ms-playwright\ffmpeg-1011`(`ffmpeg-win64.exe` 3.49MB) **+ `winldd-1007`(0.1MB)** 두 폴더를 같은 위치에 복사(합계 약 3.7MB · 인터넷 PC에서 `node node_modules/playwright-core/cli.js install ffmpeg` 약 2초). `winldd` 없이도 되는지는 미확인이라 함께 반입 권고 · 없으면 영상 없이 진행(`recordVideo` 미전달) · `playwright-core`를 올리면 리비전이 바뀌므로 다시 받는다 |
| `pngjs` · `gifenc` · `@types/pngjs` | GIF · `7.0.0` · `1.0.3` · `6.0.5` | 없음(확인) | `node_modules` |
| `zod` · `typescript` · `@types/node` | 이미 저장소 잠금 파일에 있는 범위 | 없음 | 추가 내려받기 0(같은 버전으로 해석됨 — H0-4 확인) |
| KURE-v1 | 기존 | — | `자동배포.md` §5.8-6(기존 절차) |
| Python venv | 기존 | — | 기존 |

- `pnpm-workspace.yaml` `allowBuilds`: **변경 없음**(설치 스크립트 있는 새 의존성 0).
- Playwright가 자동으로 브라우저를 내려받는 경로(`playwright` 패키지의 설치 스크립트·`npx playwright install`)는 쓰지 않는다 — `-core`만 쓴다.
- **[정정 #5] 잠금 파일**: 반입 PC에서 `pnpm install --frozen-lockfile`(또는 오프라인 저장소)로 설치한다. 일반 `pnpm install`로 잠금 파일을 다시 쓰지 않는다(§3.3).
- **폐쇄망 반입 실제 확인은 남은 수동 확인**(§21.2 끝): 이 PC는 인터넷이 열린 상태에서 ffmpeg를 받았다 — 다른 PC로 두 폴더만 복사해 영상이 나오는지 1회 확인한다.

---

## 20. 시험 전략(하네스 자체)

### 20.1 단위 시험(`node:test` · `pnpm --filter @chat-bot/demo-harness run harness:test` 또는 `pnpm -C tools/demo-harness run harness:test` · CI 미편입)

`harness:test` = `harness:build` 후 `node scripts/run-tests.mjs`(`dist/test/**/*.test.js`를 모아 `node --test` — 정정 #2). 시험은 0/1만 의미가 있어 `--filter` 형태도 무방하다(종료 코드 납작화는 0/1 판정에 영향 없음).

| # | 대상 |
|---|---|
| H-T1 | 인자 해석 · 옵션 조합 오류(`--from` 없이 `--resume`, visible + `--appendix-llm`, 핵심 단계 `--skip`) · **단독 `--` 무시(정정 #10)** |
| H-T2 | 프리셋 정의 검사(§9.1 규칙 전부) · 예산 합 600 |
| H-T3 | 생략 알고리즘(지연 0·20·60·200초 · 핵심 불생략 · 일시정지 제외 — AC-DH4-2·4-3의 계산부) |
| H-T4 | 예약 시각 계산(`ceilMinute` · 최소 5분 + 30초 · 같은 분 회피 · KST 표시) |
| H-T5 | 환경 구성기: 부모 env 미상속 · 출구 키 빈 값 · 시스템 허용 목록만 · 공개표 생성 · 거버넌스 값 · **하네스 전용 키(`NODE_PATH`·`NO_COLOR`·`CBDEMO_API_PACKAGE_JSON`) 존재(정정 #3)** |
| H-T6 | `assertIsolatedDbUrl`(실행 폴더 하위만 · `dev.db` 거부 · 상대 경로 거부 · 원격 스킴 거부) |
| H-T7 | `redact()` — 쿠키·비밀번호·키·임시 비밀번호 |
| H-T8 | netstat·tasklist(CSV)·CIM 출력 파서(고정 샘플) · 표식 판정 · **하네스 명령줄 판정·소유 하네스 생존 시 잔존 정리 건너뜀(정정 #7)** |
| H-T9 | 선택자 문구 = 제품 상수 파일 문자열(정규식으로 원문 추출해 비교 — 제품 소스를 import하지 않음) |
| H-T10 | VTT 생성(시각 형식·순서·`NOTE`) · result.json 스키마 왕복 |
| H-T11 | 보고서 HTML에 `http(s)://` 외부 URL 0 · `lang="ko"` · `img`마다 `alt` |
| H-T12 | 픽스처 CSV: 머리글 "발화" · 200행 · 중복 0 · 개인정보 형식 의도 행 2개만 |
| H-T13 | 비밀번호 생성기 × `validatePasswordPolicy` 1,000회 |
| H-T14 | 단건 지연 결정 규칙(경계값 200·201·1000·1001) · **라운드 반복(1라운드 통과 시 1개 · 3라운드 모두 초과 시 3개 · 결정 = 마지막 라운드 — 정정 #4)** |
| H-T15 | (1단계 추가) 빌드 지문: 이미 변경된 파일을 다시 고치면 지문이 바뀐다(정정 #9) · porcelain 경로 해석(이름 변경·따옴표) |
| H-T16 | (1단계 추가) 사전 점검 판정: PC-11a 16e9 경계 · PC-11b 2GiB 경계 · PC-6 ffmpeg 유무 · PC-10 Ollama 프로세스/포트 조합 |
| H-T17 | (1단계 추가) 터미널 출력기: 출력 스트림 `error` 발생 시 예외 0(정정 #13) |

### 20.2 정적 검사(같은 시험 묶음)

| # | 단언 |
|---|---|
| H-S1 | 하네스 소스가 `apps/*/src`·`packages/*/src`를 import하지 않는다(빌드 산출물·`@chat-bot/shared-types` 패키지 진입점·`apps/api/dist` 2파일만 허용). `@prisma/client`는 1단계에서 import 0 — H3에서 `src/data/db-direct.ts` 한 파일만 허용하도록 갱신 |
| H-S2 | `setTimeout`/`sleep` 호출은 `src/scenario/pacing.ts`와 `src/util/wait-for.ts`에만 있다(NFR-DHR2) |
| H-S3 | DB 직접 쓰기 파일(`src/data/db-direct.ts`)이 쓰는 모델 = `user`·`conversationLog` 2개뿐(감사·세션 테이블 0) |
| H-S4 | `spawn`/`execFile` 호출에 `shell:true`는 `proc/pnpm.ts` 폴백 1곳뿐 |
| H-S5 | 선택자 문자열은 `src/selectors/**`에만 |

### 20.3 드라이런 · 통합 실행

- `--dry-run`: 프로세스·브라우저 0으로 계획·공개표 출력 — 프리셋·선택자 정의 변경 리뷰용.
- 통합 = **무인 점검을 실제로 돌리는 것**(test-automation): 연속 5회 통과(NFR-DHR1) · AC 표(§22)의 수동/반자동 시험.
- **CI에서 실행하지 않는다**(P-7 · FR-0-319). 기능 그룹 완료 때 무인 점검 1회 권장(패치 H-2 자동시험_전략 문구).
- lint 기준: `npx eslint tools` 오류 0(정정 #12 — §3.4).

---

## 21. 위험 · 한계

### 21.1 요구사항 "조사 한계" 해소표

| # | 한계 | 이 설계에서 | 남은 것 |
|---|---|---|---|
| 1 | 실행 실측 0 | 시간 예산은 그대로 추정 · 측정 지점을 보고서에 구조화(예산 vs 실측) · 준비 단계 일부 실측(§5 표) | 리허설(S-3)로 공연 시간 보정 |
| 2 | 도구 동작 미확인(Edge 채널·ffmpeg·GIF·`vite preview` 프록시·HF 오프라인) | `vite preview` → **불필요해짐**(DHD-3) · GIF → 순수 JS(외부 인코더 0) · HF·Edge·ffmpeg → **2026-10-01 실기동 확인 완료**(§21.2) | 폐쇄망 반입 실제 확인 1회 |
| 3 | 화면 세부(문구·선택자·갱신 주기·색인 순서·마스킹 화면·2인 승인 위치) | §2 C-1·C-2·C-6·C-9·C-13 전부 코드로 확정 | `△` 선택자 역할 — P5 선택자 점검 |
| 4 | 거버넌스 ON 기동 조건 | §2 C-3 · §6.3 코드로 확정 · 공백 경로 SQLite 실기동 확인 완료 | — |
| 5 | 메모리 기록 재확인 범위(G1 품질) | A-9 허용 목록 방식 | 리허설 |
| 6 | `CLAUDE.md` 상태 불일치(No.21·36·37) | 라우트·컨트롤러·상수로 화면 존재 확인 | `CLAUDE.md` 갱신은 사용자 처리 |
| 7 | 원본 PDF 미열람 | 해당 없음 | — |
| 8 | 웹 조사 없음 | 도구 버전은 구현 시점 결정(정확 버전 고정 — `playwright-core 1.63.0`) | — |

### 21.2 구현 첫 작업 — 실기동 확인 6건 — **확인 완료(2026-10-01, 이 PC 실측)**

장비: Windows 11 Pro 10.0.26200 · i7-10750H(6코어/12스레드) · RAM 17.0GB(OS 표기 15.8GiB) · RTX 3050(시연은 `CUDA_VISIBLE_DEVICES=-1`로 비노출) · Node v24.19.0 · pnpm 12.3.4 · Python venv 3.10.11. 작업 폴더는 공백·마침표가 든 `D:\2. Team Source\Chat Bot`. 상세는 `tools/demo-harness/docs/실기동확인.md`. 수치는 **이 노트북 1대의 실측**이며 영업 수치가 아니다(FR-0-317).

| # | 확인 | 결과 | 핵심 수치 · 근거 | 실패 시(설계 당시 폴백) → 판단 |
|---|---|---|---|---|
| 1 | `HF_HUB_OFFLINE=1`+`TRANSFORMERS_OFFLINE=1`로 KURE-v1 `revision=main` 로드·`/health warmedUp` | **확인 완료 · 성공** | 기동~`warmedUp=true` **약 16초**(가중치 391개 적재 2.4초) · `/health` = `ok · nlpai-lab/KURE-v1@main\|noprefix\|l2 · 1024 · cpu · warmedUp true` · 안정 시 단건 **P50 108~133ms · P95 111~167ms** → 300ms 유지. 단 적재 직후 처음 3회는 P95 1.4~1.7초 → **정정 #4** | `refs/main` 커밋 해시 폴백 → **불필요**(구현은 해 둠) |
| 2 | `playwright-core` + `channel:'msedge'`(Edge 154)로 영속 컨텍스트·`iframe`·Shadow DOM·`setInputFiles`·`recordVideo` | **확인 완료 · 성공** | **Edge `154.0.4258.37` / `playwright-core@1.63.0`** · 기동 0.65~0.71초 · headless·headed · `iframe`(3칸 중첩)·Shadow DOM·`getByLabel`·`setInputFiles`·`locale`·`timezoneId` · 사용자 Edge 실행 중에도 동시 기동. `recordVideo`는 ffmpeg 설치 후 성공(없으면 기동 예외 → **정정 #6**) | §8.1 폴백 → **불필요** |
| 3 | Playwright 전용 ffmpeg 확보 방법·크기 | **확인 완료 · 성공(인터넷 1회 필요)** | `install ffmpeg` → `ffmpeg-1011`(3.49MB) + `winldd-1007`(0.1MB) **합계 약 3.7MB** · 약 2초 · 녹화 파일 `page@<해시>.webm` · `pngjs`·`gifenc`·`@types/pngjs` 설치 스크립트 0 · GIF 인코딩 확인 | 영상 기본 끔 → **불필요**(PC-6 게이트로 없을 때만 끔) |
| 4 | Prisma SQLite `DATABASE_URL`에 공백·마침표 있는 절대 경로 — migrate deploy·클라이언트·거버넌스 저장 위치 검사 | **확인 완료 · 성공** | `file:D:/2. Team Source/Chat Bot/.demo-runs/<id>/demo.db`(따옴표·인코딩 없음) · 마이그레이션 54개 3.2초 · API 기동·`/api/health` 200 · 거버넌스 ON 기동 로그 확인. 단 **`NODE_PATH` 없이는 API가 `Cannot find module 'multer'`로 기동 실패** → **정정 #3 · DHX-4** | 공백 없는 실행 폴더로 이동 → **불필요** |
| 5 | Node `--title`·Python `-X cbdemo_run=…`가 `Win32_Process.CommandLine`에 보이고 Python이 임의 `-X`를 받아들이는지 | **확인 완료 · 성공** | 두 표식 모두 명령줄에 보임 · Python `-X` 임의 값 허용 · venv 런처 + 자식 인터프리터 2단(둘 다 표식) · `taskkill /T /F`로 둘 다 종료·포트 해제(코드 0 · 이미 없으면 128) · **tree-kill OK** · 출력 CP949 → 코드로만 판정(**정정 #11**) · 서버 유지 실행 보호 필요 발견(**정정 #7**) | 표식 대체(포트 점유) → **불필요** |
| 6 | 하네스 서버 `127.0.0.1` 바인드 + 브라우저 `localhost` 접속 · 같은 사이트 `iframe` 쿠키 전송 · 콘솔 SPA가 `iframe`에서 정상 동작 | **확인 완료 · 성공** | 콘솔 서버가 `Set-Cookie`(`Path=/api; HttpOnly; SameSite=Lax; Max-Age=43200`) 그대로 전달 · 무대 `iframe`에서 admin → agent **쿠키 교체 OK**(사용자 메뉴 "상담원 박상담 (상담원)") · 위젯 런처 해석 · `localhost` → `127.0.0.1` 문제 없음 · 외부 요청 감시가 `fonts.googleapis.com` 차단·기록(DHX-1 증거) | `localhost` 이중 스택 바인드·콘솔 단독 → **불필요** |

**남은 수동 확인(자동화로 재현하지 못한 것 — 사용법 문서·리허설 체크리스트에 기록)**

| # | 항목 | 이유 | 방법 | 담당 |
|---|---|---|---|---|
| M-1 | **실제 콘솔 Ctrl+C 신호 전달 1회** | 자동화로는 OS 콘솔 신호를 재현하지 못해 `process.emit('SIGINT')`로 핸들러 경로만 검증(→ 130·고아 0) | PowerShell과 Windows Terminal에서 각각 `pnpm demo -- --prepare-only` 실행 중 Ctrl+C → 종료 코드 130 · 5초 안 자식 0(CIM) · 포트 해제. `pnpm`이 중간에 끼어 있어 신호가 하네스까지 가는지가 요점 | test-automation(AC-DH1-4와 함께) |
| M-2 | **폐쇄망 반입 실제 확인** | 이 PC는 인터넷이 열린 상태에서 ffmpeg를 받았고, `winldd-1007` 없이도 되는지 미확인 | 인터넷 없는 PC(또는 네트워크 끈 다른 계정)에 `node_modules`·venv·HF 캐시·`ffmpeg-1011`·`winldd-1007`만 복사 → `pnpm install --frozen-lockfile --offline` → `pnpm demo:check` + 영상 1회 | 사람(리허설 · AC-DH2-2와 함께) |

### 21.3 결함 후보(별도 등록 — 패치 H-8 · 패치-2 P2-1)

| # | 내용 | 등급 제안 | 수정 방향 | 규모 |
|---|---|---|---|---|
| **DHX-1** | 관리 콘솔이 Google Fonts를 외부에서 불러온다(`apps/web/index.html` 7~11행) — 개방망에서는 콘솔을 여는 순간 브라우저가 Google에 접속(접속 IP·시각·리퍼러 노출)하고, 폐쇄망에서는 요청이 실패·지연한 뒤 시스템 글꼴로 대체된다. "100% On-Premise · 데이터가 외부로 안 나감"(카탈로그 §6) 메시지와 충돌. **2026-10-01 실기동에서 하네스 감시가 `fonts.googleapis.com`을 차단·기록(수정 전 빌드)** | **Medium**(구축형 영업 메시지·보안 심사 체크리스트 항목 — 데이터 유출은 아니지만 외부 접속 발생) | **안 B(권고 · 즉시)**: `index.html`의 `<link>` 3줄 삭제 + `global.css` 20행 글꼴 목록을 `'Noto Sans KR', 'Malgun Gothic', 'Apple SD Gothic Neo', system-ui, sans-serif`로(설치돼 있으면 Noto, 없으면 맑은 고딕) — 외부 요청 0 · 의존성 0. **안 A(브랜드 글꼴이 필요하면 후속)**: Noto Sans KR(OFL 1.1) woff2를 `unicode-range` 조각으로 자체 호스팅(`@fontsource/noto-sans-kr` 같은 패키지 또는 `public/fonts/`) — 빌드 산출물 수 MB 증가 · 라이선스 고지 1줄 | 안 B: 웹 2파일 약 5줄 · 기존 시험 기대값 변경 0 예상(시험이 `index.html` 링크를 단언하지 않음 — 구현 시 grep 확인) · 시각 차이(글꼴 폭)로 인한 레이아웃 회귀 육안 확인 1회. 안 A: 의존성 1 + CSS 1 + 라이선스 문서 |
| DHX-2 | (정보) ml-worker `/health`의 `device`는 실제 장치가 아니라 설정값 메아리(`app.py` 274·280행) — 운영자가 GPU 사용 여부를 오판할 수 있다 | Info | 후속 ml-worker 그룹에서 `torch` 실제 장치(`embedder._model.device`)를 보고하는 선택 필드 검토 | 작음(이번 범위 밖) |
| DHX-3 | (정보) API가 모든 인터페이스에 바인드(`main.ts` 63행)되며 바인드 주소 설정이 없다 | Info | 구축형 설치 문서에 "방화벽/역프록시로 노출 범위 제한" 안내 검토(요구사항 §10 참고 행) — 제품 변경 아님 | 문서 |
| **DHX-4** | **(2026-10-01 실기동 중 발견)** `apps/api/package.json`이 `multer`를 직접 의존성으로 선언하지 않았다(`devDependencies`의 `@types/multer ^2.2.0`만). 그런데 `src/faqs/faqs.controller.ts`·`src/intents/intents.controller.ts`·`src/keywords/keywords.controller.ts`·`src/validation/test-cases.controller.ts`·`src/utterance-analysis/utterance-analyses.controller.ts` 5개 파일이 `import { memoryStorage } from 'multer'`(값 import)를 한다(`main.ts`는 주석 언급뿐). `multer@2.0.2`는 `@nestjs/platform-express`의 전이 의존성으로만 설치돼 pnpm 엄격 `node_modules`에서는 `apps/api`에서 해석되지 않는다 → **Docker·pm2·Windows 서비스 등록처럼 `node dist/main.js`를 직접 기동하는 구축형 설치가 `Cannot find module 'multer'`로 기동 실패**. `pnpm start`·`pnpm run`·`.bin` 셸은 `NODE_PATH`에 `node_modules/.pnpm/node_modules`를 넣어 줘 가려진다(개발·시험에서 드러나지 않은 이유) | **Medium**(구축형 설치 방식에 따라 **High** — 서비스 등록형 납품이면 첫 기동 실패) | `apps/api/package.json` `dependencies`에 `"multer"`를 `@nestjs/platform-express`가 이미 끌어오는 **`2.0.2`와 같은 범위**(예: `"^2.0.2"`)로 선언 — 새 다운로드 0 · 버전 변화 0. **잠금 파일 재해석 위험**: 일반 `pnpm install`은 `jsdom@25.0.1` `canvas` 피어 해석을 바꾸고 스냅샷 1개를 삭제한다(§3.3 정정 #5와 같은 현상) → ① `importers['apps/api'].dependencies`에 `multer: {specifier: ^2.0.2, version: 2.0.2}` 항목만 수동 병합하고 `pnpm install --frozen-lockfile` 통과·`git diff pnpm-lock.yaml` 삭제 0을 확인하거나 ② 재해석을 받아들일 경우 diff를 검토하고 `apps/web`·`apps/widget` vitest 전체 통과를 확인한다(①을 권고). 확인 시험: `apps/api`에서 `NODE_PATH`를 비운 셸로 `node dist/main.js` 기동 → `/api/health` 200. 하네스의 `NODE_PATH` 전달은 수정 후에도 무해(그대로 둔다) | `package.json` 1줄 + 잠금 파일 약 2줄 · 기존 시험 기대값 변경 0 · 마이그레이션 0 · 담당 backend-implementer |

- `bug-triage`가 `결함분류-2026-10-01.md`에 등록(또는 새 날짜 파일)하도록 패치 H-8(DHX-1~3)·`demo-harness-patches-2.md` P2-1(DHX-4)에 문안을 둔다. **하네스는 DHX-1을 우회하지 않는다** — 브라우저 차단 기록으로 증거만 남긴다. **DHX-4에 대한 하네스의 `NODE_PATH` 전달은 우회가 아니라 pnpm 실행 래퍼와 같은 해석 경로의 재현**이며(§1.1), 결함은 그대로 등록한다.

### 21.4 남은 위험(요구사항 R-1~R-6 대응 포함)

| # | 위험 | 통제 |
|---|---|---|
| R-1 | 연출이 사실을 앞지름 | 모형 서버 0 · 정직성 자막·`honesty[]` · 시계 주입 0 · 사전 준비(⑦ 분석·⑤ 예약/승인·과거 로그·보정) 전부 공개 |
| R-2 | CPU 지연으로 ① 조용히 실패 | 실측·결정(§14 — 최대 3라운드 · 모든 라운드 공개) · PC-11b 가용 RAM 경고 · 보정 게이트 G-1 · S1-05 검증(기대 답 아니면 실패/대체) |
| R-3 | 새 개발 의존성 | 하네스 전용 · 설치 스크립트 0 · `allowBuilds` 불변 · Edge 사용 |
| R-4 | 화면 변경에 깨짐 | 접근성 이름 기반 · 선택자 단일 출처 · H-T9 문구 대조 · P5 선택자 점검 |
| R-5 | 개발 PC 오염 | 실행 폴더 격리 · DB 가드 · 새 프로필 · `.env` 4중 차단 · `dev.db` 지문 |
| R-6 | 유지 부담 | 선언형 단계 정의 · 무인 점검을 기능 그룹 완료 때 1회(권장) |
| R-7 | (신규) 무대 `iframe` 방식이 제품 배포 헤더(향후 `X-Frame-Options` 추가 등)와 달라질 수 있음 | 하네스 정적 서버가 헤더를 정하므로 지금은 영향 없음 · 제품이 프레임 금지 헤더를 앱 코드에 넣으면 확인 6 실패로 즉시 드러남 |
| R-8 | (신규) 2인 승인 챗봇 예약에 사전 승인이 필요하다는 사실 자체가 시연 메시지("예약도 통제됨")가 되지만, 고객이 "승인을 미리 받아 두면 아무 때나 바뀌나"를 물을 수 있음 | 나레이션 문안을 ui-designer·PM이 확정 — 승인은 그 예약 1건·그 대상 버전·그 기준 버전에만 묶이고 1회용(`prod-switch.service.ts` 394~410행)이라는 사실을 보고서 FAQ에 |
| R-9 | (신규) 준비 시간 약 6분 하한(A-7) | 고객 도착 전 준비 · `--no-history-schedule` 옵션 |
| R-10 | (2026-10-01 신규) 잠금 파일 재해석 — 누군가 일반 `pnpm install`을 돌리면 제품 임포터(`jsdom` 피어)·스냅샷이 바뀐다 | §3.3 운영 규칙(하네스 추가분 수동 병합 · `--frozen-lockfile` 확인) · 커밋 전 `git diff pnpm-lock.yaml` 삭제 줄 0 확인 · DHX-4 수정 시 같은 규칙 |
| R-11 | (2026-10-01 신규) 하네스가 `NODE_PATH`로 기동하므로 DHX-4 같은 "직접 기동 시 모듈 미해석" 결함을 하네스로는 앞으로 발견하지 못한다 | DHX-4 수정 확인 시험(`NODE_PATH` 없는 셸에서 `node dist/main.js`)을 결함 수정 쪽 시험으로 둔다 · 하네스는 `BOOT` 실패 로그에 `MODULE_NOT_FOUND`가 보이면 조치 문구로 안내(§16) |
| R-12 | (2026-10-01 신규) Ollama가 켜진 PC에서 시연하면 "GPU 없이" 주장이 약해진다(이 PC 실측: 실행 중) | PC-10 경고 + 사용법 문서의 시연 전 종료 절차(§3.1) · visible에서 Ollama 기동 0(AC-DH7-2) |

### 21.5 알려진 한계(보고서 고정 문구)

브라우저 백그라운드 통신은 감시 범위 밖 · 화면 그리기의 GPU 사용 가능 · API 모든 인터페이스 바인드 · 스키마 밖 `process.env` 직접 읽기 비밀(데모 미사용 기능)의 `.env` 잔존 가능성 · HF 캐시 잠금 파일 · 준비 단계 보정이 감사 로그 2행·임베딩 캐시를 남김 · 시간 수치는 이 노트북 기준 추정·실측이며 영업 수치 아님 · 하네스는 API를 `NODE_PATH`(pnpm 해석 경로)와 함께 기동한다(DHX-4 수정 전 제품을 직접 기동하면 실패할 수 있음).

---

## 22. AC ↔ 시험 매핑

| AC | 시험 방법 | 담당 | 자동/수동 |
|---|---|---|---|
| AC-DH1-1 | PowerShell `pnpm demo` 리허설 1회 — 준비 완료·7구간·정리·보고서 | test-automation + 사람 | 수동(관찰) |
| AC-DH1-2 | Git Bash `pnpm demo:check` — 종료 코드 0(루트 스크립트 `-C` 형태로 코드 보존 — 정정 #1) | test-automation | 반자동 |
| AC-DH1-3 | 3000 포트를 임시 `node -e` 서버로 점유 → 실행 → 종료 2 · 점유 PID 출력 · 자식 0 | test-automation | 반자동 |
| AC-DH1-4 | 공연 중 Ctrl+C → 5초 안 프로세스 0(CIM 조회) · `result.json status=ABORTED` · 130 — **실제 콘솔 신호로 1회(§21.2 M-1)** | test-automation | 반자동 |
| AC-DH1-5 | `--no-teardown` 실행 후 하네스만 강제 종료 → 다음 실행이 표식 확인 후 정리 · 표식 없는 가짜 PID 기록은 건드리지 않음 · **하네스가 살아 있는 실행(서버 유지)은 다음 실행이 건드리지 않음(정정 #7)** · `--stop`이 `stop.request`로 유지 중 실행을 정리 | test-automation | 반자동 |
| AC-DH1-6 | `result.json teardown.devDbUnchanged` + 실행 전후 `dev.db` 크기·수정 시각 비교 | test-automation | 자동(하네스 자기 기록) + 확인 |
| AC-DH1-7 | 연속 2회 `demo:check` → 두 `result.json`의 단계 결과·검증 수치(의도 수·예문 증가분 등) 비교 | test-automation | 반자동 |
| AC-DH2-1 | 임시로 `apps/api/.env`에 `AUGMENTATION_PROVIDER=gemini`·`AUGMENTATION_GEMINI_BASE_URL=http://127.0.0.1:<수신 서버>`(원본 백업·복원) + 수신 서버 기동 → `demo:check`(④ 예문 늘리기 포함) → 수신 0 · 점검표 `rule` | test-automation | 반자동(원본 복원 필수 — 자동시험_전략 §9.7 `.env 원복` 규약) |
| AC-DH2-2 | 네트워크 어댑터 끄고 `pnpm demo` 전체(폐쇄망 반입 확인 M-2와 함께) | 사람(리허설) | 수동 |
| AC-DH2-3 | 보고서 점검표 칸 확인 | test-automation | 자동(스키마 단언) |
| AC-DH2-4 | `--db-url-for-test file:C:/tmp/x.db` → 종료 2 · 자식 0 | test-automation | 자동 |
| AC-DH3-1~9 | 각 단계 `verify`(§10) — `demo:check` 결과의 단계 상태 | test-automation | 자동(하네스 자체 검증) |
| AC-DH4-1 | visible 리허설 총 시간 600±30 · 대표 캡처 9장 존재 | 사람 + 보고서 | 반자동 |
| AC-DH4-2 | 숨은 시험 인자 `--inject-delay S2-03:20`(하네스 전용 · 운영 경로 영향 0) → 생략 목록이 §11.1 순서 · 핵심 생략 0 | test-automation | 자동(+ H-T3) |
| AC-DH4-3 | 일시정지 30초 → `pausedSec≈30` · 예산 계산 제외 | test-automation | 반자동(+ H-T3) |
| AC-DH5-1 | ⑦ 직전 ml-worker PID를 `taskkill`(시험 스크립트) → visible 대체 자막·계속 / headless ⑦ 실패·로그 꼬리·1 | test-automation | 반자동 |
| AC-DH5-2 | 실패 보고서의 재개 명령 실행 → 그 구간부터 | test-automation | 반자동 |
| AC-DH5-3 | 실행 폴더 전체에서 비밀번호·쿠키 값 검색 0(하네스 자기 검사 + 외부 grep) | test-automation | 자동 |
| AC-DH6-1 | `--embedding-timeout-ms 800` → 공개표·시작 자막 | test-automation | 자동 |
| AC-DH6-2 | 영상 1개 + VTT · 길이 ±10초(ffprobe 없으면 VTT 마지막 시각과 공연 시간 비교) · ffmpeg 폴더를 잠시 옮긴 상태에서 실행 → PC-6 경고 · 영상 없이 나머지 통과(정정 #6 게이트) | test-automation | 반자동 |
| AC-DH6-3 | 네트워크 끊고 `report/index.html` 열기 · H-T11 | 사람 + 자동 | 혼합 |
| AC-DH6-4 | ui-spec 대비값 · 자막 요소 계산 스타일 측정(하네스 headless에서 `getComputedStyle`) | test-automation | 자동 |
| AC-DH7-1 | `--appendix-llm`(Ollama 있음) → `appendix.llm` 기록 · 실패해도 종료 코드 불변 | test-automation | 반자동 |
| AC-DH7-2 | visible 중 `ollama.exe` 기동 0(하네스가 띄우지 않음 · PC-10 경고만) | test-automation | 자동 |
| NFR-DHR1 | `demo:check` 연속 5회 통과 | test-automation | 반자동 |
| NFR-DHR2 | H-S2 | 자동 | 자동 |

---

## 23. 구현 체크리스트

**담당**: **backend-implementer 단독**(하네스는 Node 단일 패키지 — 오케스트레이션·API 구동·Playwright UI 구동·보고서 HTML 템플릿을 한 사람이 일관되게). **ui-designer**: `docs/03-design/demo-harness-ui-spec.md`(자막 띠·무대 레이아웃·구성 카드·고객사 모형·로드맵·보고서 HTML·정직성 문구 — **제품 화면 변경 0**). **ml-engineer**: 확인 1(오프라인 로드)·단건 지연 측정 방법 검토만. **frontend-implementer 불필요** — 제품 웹·위젯 코드 변경 0이고, 하네스의 HTML은 React 빌드가 없는 정적 템플릿이라 별도 프런트 스택·담당 분리가 비용만 늘린다. **code-reviewer → test-automation**(§22).

| 커밋(권고 순) | 항목 | 규모 |
|---|---|---|
| D | 이 설계 + ADR-0051 + 패치(H-1~H-8) + ui-spec | 문서 |
| H0 | **실기동 확인 6건(§21.2) — 2026-10-01 완료** · H0-4 잠금 파일(제품 임포터 불변 — **하네스 추가분 수동 병합 +53줄·삭제 0 · `--frozen-lockfile` 통과 확인 완료**, 정정 #5) · H0-5 `pnpm -r test` 대상 동일 · **H0-6(정정 #12) `npx eslint tools` 오류 0**(저장소 전체 `pnpm lint`는 제품 기존 오류 68건 — 전후 동일만 확인) | 확인 |
| H1 | 패키지 골격 · 루트 설정 4개(`demo`·`demo:check`는 `pnpm -C` 형태 — 정정 #1) · 인자 해석(단독 `--` 무시) · 실행 폴더(`harnessPid`) · 사전 점검(PC-11a/11b · PC-6 리비전 폴더) · 드라이런 · 단위 시험 H-T1·T2·T6·T8·T13·T16 | 중 |
| H2 | 빌드 지문(크기·수정 시각) · 프로세스 관리(spawn·로그·헬스·트리 종료·잔존 정리·`stop.request`) · 정적 서버 3 + 역프록시 · 환경 구성기(`NODE_PATH`·`NO_COLOR`) · API 선적재(`src/runtime` 직접 참조) · 단건 지연 실측(최대 3라운드) · 터미널 EPIPE · H-T5·T14·T15·T17 · H-S4 | 중 |
| H3 | 데모 데이터셋(정의·API 생성기·DB 직접 2종·예약/승인·보정 게이트) · 픽스처 CSV · H-T4·T12 · H-S3(·H-S1 `db-direct.ts` 허용 갱신) | 중 |
| H4 | 브라우저(기동·폴백·`recordVideo` 게이트·쿠키 교체·무대·자막·외부 요청 감시·대화상자) · 선택자 모듈 · 시나리오 실행기(시간 관리·생략·일시정지·대체·키 입력) · H-T3·T9 · H-S2·S5 | 중~대 |
| H5 | 시나리오 9구간 단계 정의 + 선택자 점검 | 중 |
| H6 | 캡처(스크린샷·영상 `page@<해시>.webm` → `show.webm`·VTT·GIF) · 보고서(JSON·HTML·MD·고객판 — 지연 라운드 전부) · 비밀 제거·자기 검사 · H-T7·T10·T11 | 중 |
| H7 | 부록 LLM(headless) · 사용법 문서 `docs/05-ops/시연_하네스.md`(Ollama 종료 절차·ffmpeg 반입·`--stop`·남은 수동 확인 M-1·M-2 포함 — §3.1) | 소 |
| T | test-automation: §22 · 무인 점검 연속 5회 · M-1(콘솔 Ctrl+C) | — |

- 1단계(H0~H2 일부) 현황: 실기동 확인 6건 완료 · 사전 점검·실행 폴더·빌드 지문·프로세스 관리·정적 서버·환경 구성기·선적재·단건 지연 실측·잔존 정리·`--stop` 구현 · 데이터 생성(H3)·시나리오(H4~H5)·보고서(H6)는 미착수. 준비 단계 합계(캐시 있음, `--no-build`): 사전 점검 3초 + 격리 DB 2초 + 서버 기동·예열·측정 16초 = 약 23초.

**제품 코드 변경 0 원칙의 예외**: **없음.** `data-testid` 추가 필요 0(§9.3). DHX-1 글꼴 수정·**DHX-4 `multer` 선언**은 하네스 작업이 아니라 별도 결함 수정(`bug-triage` → 웹·API 담당)이며, 하네스는 수정 전후 모두 동작한다(DHX-1 수정 후에는 브라우저 차단 기록이 0이 되고, DHX-4 수정 후에도 `NODE_PATH`는 무해하다).

**예상 규모(하네스 · 추정)**: 소스 약 45~60파일 · 약 4,500~6,500줄(TS) + 정적 템플릿 5 + 픽스처 1 + 단위 시험 약 15파일. 요구사항 판정 "중"과 같다. 가장 큰 부분은 H4·H5(UI 구동 9구간 약 50단계).

---

## 24. PM 확인 필요(모두 기본안 있음 — 기본안이면 구현 착수 가능)

> **PM 답변 2026-10-01: Q-1~Q-9 모두 기본안 채택**("권고안대로 진행"). 구현 착수 가능.
> 2026-10-01 정정 13건은 PM 결정 사항을 바꾸지 않는다(명령 이름·동작·공개 원칙 그대로 — 내부 구현·판정 기준 정정). DHX-4 등급(Medium/High)과 수정 시점은 bug-triage·PM이 정한다.

| # | 질문 | 기본안 | 이유 |
|---|---|---|---|
| Q-1 | 하네스 위치·명령 | `tools/demo-harness` · `pnpm demo` / `pnpm demo:check` | §3 |
| Q-2 | 준비 시간 약 6분 하한(이력 예약 실제 실행 대기) 수용 | 수용(고객 도착 전 준비) — 짧게 해야 하면 `--no-history-schedule` | A-7 |
| Q-3 | 예약 장면의 사전 승인(관리자 2가 공연 시작 순간 API로 승인)을 자막으로 공개하는 방식 | 공개(자막 1줄 + 보고서) | DHD-9 · R-8 |
| Q-4 | 거버넌스 필드 암호화를 시연에서 켤지 | 끔(옵션) — 켜면 실행별 키를 실행 폴더에 보관해야 함 | A-11 |
| Q-5 | 데이터 지도의 "디스크 암호화 미선언" 표시를 그대로 보일지 | 그대로 + 자막 "실제 설치에서는 디스크 암호화를 선언합니다" | 정직성 |
| Q-6 | ⑤ 검증 게이트(필수 시험 기준)를 시연에 넣을지 | 넣지 않음(경고 확인 단계 증가) — 30분 프리셋 후보 | §7.4 |
| Q-7 | 로드맵의 No.38 문구 | "요구사항 정리 중(미착수)" — 요구사항 FR-DH10-1의 "보류"와 현재 작업 지시("다음 진행")가 달라 PM이 정함 | §10.9 |
| Q-8 | DHX-1 글꼴 수정안 | 안 B(외부 링크 삭제 + 시스템 글꼴 폴백) 즉시 · 안 A(자체 호스팅)는 브랜드 요구 시 | §21.3 |
| Q-9 | 가상 회사명 "가온마켓"·계정 표시 이름 | 사용(ui-designer가 바꿔도 됨) | §7.1 |

---

## 25. 변경 이력

- **2026-10-01 작성** — system-architect. 요구사항 `demo-harness.md`(PM P-1~P-8 권고안 전부 채택)를 받아 작성. **코드로 확정한 것**: 버튼 문구·선택자 출처(상수 파일 · `data-testid` 0건이며 불필요) · ⑥ 저장본 화면 = 상담 콘솔 "대화 보기" · 거버넌스 ON 기동 조건(절대 `file:` 경로·출구 `127.0.0.1:8100` 정확 일치·키 미설정 시 검사 생략)을 환경변수만으로 충족 · 위젯은 `dist` 정적 서빙 · 색인은 `semanticEnabled`와 무관 · 상담 콘솔 5초 폴링(숨김 30초) · 예약 최소 5분·분 단위 · **2인 승인 챗봇 예약은 사전 승인 요청·승인이 없으면 실행 실패(신규 발견)** · 비밀번호 변경 강제는 제품 경로(`POST /auth/password`)로 해소 · ml-worker는 작업 폴더 `.env`를 읽음 · `/health.device`는 설정값 메아리 · 관리 콘솔 외부 요청은 Google Fonts뿐. **요구사항과 달라진 점** A-1~A-13(정적 서버 서빙·무대 `iframe`·쿠키 교체·챗봇 C 분리·T0 예약·준비 6분 하한·구간 단위 재개 등). 결함 후보 DHX-1(Medium 제안)·DHX-2·DHX-3(Info). 신규 ADR-0051.
- **2026-10-01 1단계 실기동 확인 · 설계 정정 13건 반영** — system-architect. 근거 `tools/demo-harness/docs/실기동확인.md`(backend-implementer 1단계) · 1단계 구현 코드. **실기동 6건 모두 확인 완료(이 PC 실측 — §21.2)**: KURE-v1 오프라인 `main` 로드(기동~예열 약 16초 · 안정 단건 P50 108~133ms · P95 111~167ms → 300ms 유지) · Edge `154.0.4258.37`/`playwright-core@1.63.0` · ffmpeg `ffmpeg-1011`+`winldd-1007` 약 3.7MB · 공백·마침표 경로 SQLite·마이그레이션 54개·거버넌스 ON 기동 OK · 표식·tree-kill OK · `iframe` 쿠키 교체 OK. 설계 당시 폴백(해시 리비전·Chrome 사다리·영상 끔·공백 없는 경로·표식 대체·이중 스택 바인드)은 **전부 불필요**. **정정 13건(§0.1 표 · 각 절 `[정정 #n]`)**: ① 루트 스크립트 `pnpm -C`(종료 코드 보존) ② `dist/src/cli.js`·선적재 `src/runtime/` 직접 참조·`scripts/run-tests.mjs` ③ API 자식 `NODE_PATH`·`NO_COLOR`(+`CBDEMO_API_PACKAGE_JSON`) ④ 단건 지연 최대 3라운드·마지막 라운드 결정·전 라운드 공개·PC-11b ⑤ 잠금 파일 하네스분 수동 병합(+53·삭제 0) ⑥ ffmpeg 게이트·`winldd-1007`·`page@<해시>.webm` ⑦ `harnessPid`·`stop.request` ⑧ PC-11 16e9 바이트 ⑨ 빌드 지문 크기·수정 시각 ⑩ 단독 `--` 무시 ⑪ CP949 → 종료 코드·CSV 판정·venv 런처 구조 ⑫ lint 기준 `npx eslint tools` ⑬ EPIPE 삼킴. **PC-10 보강**(이 PC Ollama 실행 중 → 사용법 문서에 시연 전 종료 절차). **신규 코드 확인 C-20 · 결함 후보 DHX-4**(`apps/api` `multer` 미선언 → 직접 기동 실패 · Medium 제안/구축형 방식에 따라 High). 외부 요청 감시 실측은 `fonts.googleapis.com` 1호스트(예상 2호스트 정정). 신규 위험 R-10~R-12. 남은 수동 확인 M-1(콘솔 Ctrl+C 신호 1회)·M-2(폐쇄망 반입). 상위 문서 패치 `demo-harness-patches-2.md`(결함분류 DHX-4 · 자동배포 §5.13 · 자동시험_전략 §22 · 개발명세서 §2). PM 결정 사항 변경 0.
- **2026-10-02 DT-2 확장 설계 연결** — system-architect. 이 문서 본문(10분판)은 바꾸지 않는다. 확장은 `demo-harness-expansion-설계.md` · ADR-0053. 결과 스키마 `machine.gpuUsedByHarness`만 `boolean`으로 넓힘(10분판 값 `false` 불변).
