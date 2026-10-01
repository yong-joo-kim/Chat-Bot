# ADR-0051 — 원클릭 시연 하네스(DT-1): 카탈로그 밖 워크스페이스 도구 · Playwright(설치된 Edge) 한정 도입 · 제품 코드 변경 0

- **상태**: 채택(Accepted) — PM 2026-10-01 설계 §24 Q-1~Q-9 기본안 채택 · 2026-10-01 1단계 실기동 확인 6건 완료(설계 §21.2) · 실기동 정정 13건 반영(아래 "실기동 정정" 절 — 결정의 방향은 불변, 구현 수단만 정정)
- **일자**: 2026-10-01(작성) · 2026-10-01(1단계 실기동 정정 반영)
- **결정자**: system-architect(방식) · PM(2026-10-01 확정 — 구축형 · 10분 · 1순위 7개 · 권고안 P-1~P-8)
- **대체하지 않음(정합)**: ADR-0024(ml-worker 범위 — 기동 방식만 재사용) · ADR-0032(예약 실행 엔진 — 시계 주입 없이 실제 시간 사용) · ADR-0039(환경 분리) · ADR-0040(데이터 거버넌스 — 모드 ON으로 기동) · ADR-0048·0049(2인 승인 — 끄기 잠금 그대로) · `docs/05-ops/자동배포.md` §1(CI·실 배포는 사용자 지시 전 착수 금지)
- **관련**: 요구사항 `docs/requirements/demo-harness.md`(FR-0-310~321 · 접두 DH) · `docs/04-test/자동시험_전략.md` §1(E2E "Playwright 또는 동급") · §4.7 항목 8 · 실기동 결과 `tools/demo-harness/docs/실기동확인.md`
- **세부 설계**: `docs/02-spec/demo-harness-설계.md` · 상위 문서 패치: `docs/02-spec/demo-harness-patches.md`(적용됨) · `docs/02-spec/demo-harness-patches-2.md`(1단계 정정)
- **번호**: `docs/02-spec/decisions/` 최대 번호 0050 확인 · `docs/` 전체와 보류·미커밋 요구사항 초안에서 `ADR-0051` 이상 사용 0건(2026-10-01 작성 시 grep)

## 맥락

PM이 구축형 고객 대상 10분 자동 시연(7개 장면)을 확정했다. 요구사항은 "제품 코드 변경 0 · 외부 의존 0 · 격리 DB · 실패 단계 보고 · 정리 보장"을 요구하고 브라우저 자동화 도구의 첫 도입을 하네스에 한정하도록 권고했다(P-2). 설계 중 코드로 다음을 확인했다.

1. 관리 콘솔 개발 서버는 `/api` 프록시 대상을 `localhost:3000`에 고정한다(`apps/web/vite.config.ts` 10행). `vite preview`의 프록시 상속은 이 PC에서 확인되지 않았다.
2. 루트 `dev` 스크립트는 `--filter=./apps/*`이고, `build`·`test`는 `pnpm -r`이다 — 워크스페이스 멤버가 같은 이름의 스크립트를 가지면 끌려 들어간다.
3. API는 `@prisma/client` require 시점에 `apps/api/.env`를 읽어 들이고, 이 PC의 `.env`에는 Gemini 설정이 있다. ml-worker는 작업 폴더의 `.env`를 읽는다.
4. 실제 `main.ts` 프로세스에는 `CLOCK` 주입 경로가 없다(통합 시험의 `FakeClock`은 같은 프로세스 `Test.createTestingModule` 한정).
5. 2인 승인이 켜진 챗봇의 예약 전환은 예약 작성자의 사전 승인 요청 + 다른 ADMIN 승인이 없으면 실행 시 실패한다(`prod-switch.service.ts` 394~415행).
6. 콘솔·위젯의 모든 조작 대상에 접근성 이름이 있고, `apps/**`에 `data-testid`는 0건이다.
7. 저장소에 브라우저 자동화 의존성이 0건이고, Edge가 설치돼 있으며 Playwright 브라우저 캐시는 없다.
8. **(2026-10-01 실기동에서 추가 확인)** `apps/api`는 `multer`를 값 import하지만 `package.json`에 선언하지 않았다(`@types/multer`만) — pnpm 엄격 `node_modules`에서 `node dist/main.js`를 직접 띄우면 `Cannot find module 'multer'`로 죽고, `pnpm run`·`.bin` 셸은 `NODE_PATH`를 넣어 줘 가려진다(설계 C-20 · 결함 후보 DHX-4).

## 결정

### 1. 위치 — `tools/demo-harness`(pnpm 워크스페이스 멤버 · 카탈로그 밖 `DT-1`)

- `pnpm-workspace.yaml`에 `tools/*`를 추가하고 패키지 `@chat-bot/demo-harness`(private)를 둔다. **스크립트 이름은 `demo`·`harness:build`·`harness:test`·`harness:typecheck`** — `build`·`test`·`dev`·`lint`를 쓰지 않아 루트 재귀 명령에 걸리지 않는다.
- 루트 `package.json`에 `demo`·`demo:check` 2개만 추가한다. **형태는 `pnpm -C tools/demo-harness run demo --`**(실기동 정정 #1 — `pnpm --filter … run`은 하위 종료 코드를 1로 납작하게 만들어 0/1/2/130 구분이 사라진다). 실행 폴더는 `/.demo-runs/`(무시 목록).
- 잠금 파일은 **하네스 임포터·새 패키지 항목만 수동 병합**한다(실기동 정정 #5 — 일반 `pnpm install`이 `jsdom` `canvas` 피어 해석을 바꿔 제품 스냅샷을 지운다). `pnpm install --frozen-lockfile` 통과와 삭제 줄 0으로 확인한다.
- 기능 카탈로그 번호를 주지 않는다(진행률 분모 불변 · `기능요구사항.md` §4-2 "카탈로그 밖 도구" 절).

### 2. 제품 코드 변경 0 — 서빙도 제품 빌드 산출물로

- `apps/*`·`packages/*`의 소스·설정·의존성·마이그레이션·시험 기대값 변경 0. **선택자용 `data-testid` 추가도 0**(접근성 이름과 위젯의 안정 클래스로 충분).
- 자식 프로세스는 API(`node apps/api/dist/main.js`)와 ml-worker(venv)뿐이다. 관리 콘솔·위젯·고객사 모형·무대 페이지는 **하네스 프로세스 안의 정적 서버**가 제품 `dist`를 그대로 서빙하고, 콘솔 서버가 `/api`를 API로 역프록시한다(운영 배포 형태와 같음 · 포트 이동 가능). `vite dev`·`vite preview`는 쓰지 않는다.
- 하네스가 제품 결함을 만나면 우회하지 않고 결함 후보로 남긴다(예: 관리 콘솔 Google Fonts 외부 요청 — 설계 DHX-1).
- **API 자식에는 `NODE_PATH=<저장소>/node_modules/.pnpm/node_modules`를 넘긴다**(실기동 정정 #3). 이는 pnpm 실행 래퍼가 하는 것과 같은 모듈 해석 경로를 재현하는 것이고 제품 동작을 바꾸지 않는다 — `multer` 미선언 자체는 결함 후보 **DHX-4**로 등록해 제품 쪽에서 고친다(`dependencies`에 `multer` 선언). 수정 후에도 `NODE_PATH`는 무해하다.

### 3. 브라우저 자동화 — `playwright-core` + 설치된 Edge, 영속 컨텍스트 1개

- 의존성은 하네스에만 `playwright-core`(정확 버전 고정 — `1.63.0` · 설치 스크립트 없음 → `allowBuilds` 불변)와 GIF용 순수 JS 2종(`pngjs`·`gifenc`).
- `channel:'msedge'`로 이 PC의 Edge를 쓴다(브라우저 내려받기·반입 0 — 2026-10-01 Edge `154.0.4258.37`에서 확인). 실패 시 폴백 사다리: Chrome → 지정 실행 파일 → Playwright Chromium(반입) → (무인 점검만) 브라우저 없이 API 검증.
- 컨텍스트는 **실행 폴더 안 새 프로필의 영속 컨텍스트 1개**. 계정 전환은 실제 로그인으로 받은 세션 쿠키를 교체하고, 모든 장면은 하네스 **무대 페이지**의 `iframe`(고객사 모형 위젯 · 관리 콘솔)에서 진행한다 → 영상 1개·자막 파일 1개. `localhost`의 다른 포트는 같은 사이트라 `SameSite=Lax` 쿠키가 `iframe`에 실린다(2026-10-01 확인).
- 영상은 Playwright 녹화(Playwright 전용 ffmpeg 필요 — 없으면 영상만 생략), 자막 파일(WebVTT)은 하네스가 직접 쓴다. **ffmpeg가 없을 때 `recordVideo`를 넘기면 컨텍스트 기동 자체가 예외이므로, 사전 점검이 없음을 확인하면 `recordVideo`를 넘기지 않는다**(실기동 정정 #6). 반입 대상은 `ffmpeg-1011` + `winldd-1007`(약 3.7MB · `playwright-core` 버전과 짝).
- 브라우저 컨텍스트의 비루프백 요청은 차단하고 기록한다(폐쇄망과 같은 화면 · 외부 요청 증거).

### 4. 격리 — 백지 환경 + `.env` 4중 차단 + 격리 DB 가드

- 자식 환경은 시스템 필수 키 허용 목록 + 하네스 명시 값만(부모 `process.env` 상속 0). API는 `CHATBOT_API_IGNORE_ENV_FILE=1` + 선적재 스크립트(`jest.isolate-env.js` 기법 · `src/runtime/isolate-api-env.cjs` 원본 경로 직접 참조) + 기본값 없는 출구 키 빈 문자열 명시. 하네스 전용 키는 `CBDEMO_API_PACKAGE_JSON`·`NODE_PATH`·`NO_COLOR` 3개(제품 설정 스키마 밖). ml-worker는 작업 폴더를 실행 폴더로 둔다.
- DB는 실행 폴더 안 SQLite 1개(`prisma migrate deploy`)뿐이며, 그 밖 경로·`dev.db`·원격 DB는 기동 전에 거부한다. 공백·마침표가 든 경로에서도 동작함을 확인했다(2026-10-01).
- 거버넌스 모드는 ON(저장 위치 = 실행 폴더 · 출구 허용 = `127.0.0.1:8100`)으로 기동한다 — 환경변수만으로 충족됨을 코드와 실기동으로 확인했다.
- 정리는 표식(명령줄) 확인 후에만 프로세스를 종료하고, **소유 하네스가 살아 있는 실행은 다음 실행이 건드리지 않는다**(`pids.json`의 `harnessPid` — 실기동 정정 #7). 유지 중인 실행은 `--stop`이 `stop.request` 파일로 하네스에게 스스로 정리하게 한다(정적 서버 3개가 하네스 프로세스 안에 있으므로).

### 5. 데모 데이터 — 제품 API 우선, DB 직접 2종

- `seed.ts`는 쓰지 않는다(검증 픽스처 혼입). 계정 4명·챗봇 3개(A 고객센터 · B 라이브 전환 · C 예약 전용)·규칙·검증 세트·사전 분석은 **제품 API**로 만든다(비밀번호 변경 강제는 `POST /auth/password` 제품 경로로 해소).
- DB 직접은 **첫 ADMIN 1명**(생성 API 없음)과 **과거 14일 대화 로그**(과거 시각 API 없음) 2가지뿐이며, 감사·세션 테이블은 쓰지 않는다(정적 검사).

### 6. 예약 배포 — 실제 시간 · 시계 주입 0

- 이력용 예약은 준비 초반에 걸어 준비 중 실제 실행시키고(대체 장면 보장), 라이브 예약은 **진행자가 공연을 시작한 순간** `ceilMinute(T0 + 6분)`으로 건다(최소 5분 규칙 준수 · ⑤ 구간 안 실행). 2인 승인 챗봇이므로 두 예약 모두 작성자 승인 요청 + 다른 ADMIN 승인을 API로 처리하고 자막·보고서에 공개한다.
- 제품과 다른 기동 경로가 생기는 시계 주입은 고객 시연·무인 점검 모두에서 쓰지 않는다.

### 7. CI·회귀 편입 0

결과는 `result.json`(스키마 v1)과 종료 코드로 남겨 나중에 CI에 붙일 수 있게만 한다(종료 코드 보존을 위해 루트 스크립트는 `pnpm -C` 형태). CI 설정·원격 실행·기존 jest/vitest 편입은 하지 않는다.

## 고려한 대안

| # | 대안 | 기각 이유 |
|---|---|---|
| 1 | 워크스페이스 밖(`tools/` 독립 잠금 파일 · `--ignore-workspace`) | 잠금 파일·`node_modules`가 2벌이 되어 폐쇄망 반입·버전 관리가 늘고, TypeScript 등 이미 있는 도구를 다시 받아야 한다. 스크립트 이름 규약만으로 제품 명령 비영향을 보장할 수 있다. (2026-10-01 재검토: 일반 `pnpm install`의 잠금 파일 재해석 문제는 독립 잠금 파일의 근거가 될 수 있으나, 하네스분 수동 병합 + `--frozen-lockfile` 확인으로 통제 가능해 결정 유지) |
| 2 | 저장소 밖 별도 저장소 | 데이터셋·선택자가 제품 화면 문구와 함께 바뀌어야 하는데 커밋이 분리된다 |
| 3 | `apps/demo` | 루트 `pnpm dev`(`--filter=./apps/*`)에 끌려 들어가고 "납품 앱" 자리라 카탈로그·진행률과 혼동된다 |
| 4 | `vite dev`/`vite preview`로 콘솔 서빙 | 프록시 대상 `localhost:3000` 고정 · `preview.proxy` 상속 미확인 · 개발 서버는 첫 화면 변환 지연 · 운영 배포 형태와 다름 |
| 5 | Puppeteer · Selenium | 저장소 문서가 Playwright를 기준 도구로 적어 두었고(자동시험_전략 §1), `iframe`·Shadow DOM·파일 입력·영상·채널 지정이 기본 제공이다 |
| 6 | Playwright 전용 Chromium 내려받기 | 폐쇄망 반입 수백 MB · 설치된 Edge로 충분 — 폴백 4단계로만 남긴다 |
| 7 | 계정별 브라우저 컨텍스트·창 2개 | 영상이 갈라지고 창 배치가 실행 인자 단위라 불안정하다 |
| 8 | `FakeClock`을 쓰는 시연 전용 API 기동 스크립트 | 제품 `main.ts`와 다른 기동 경로가 생기고 화면 시각이 실제와 어긋난다(정직성) |
| 9 | `seed.ts` 재사용 | 고객에게 어색한 검증 픽스처·변경 강제 계정·ADMIN 1명 |
| 10 | 선택자용 `data-testid` 추가 | 접근성 이름으로 충분하고 FR-0-310 위반 |
| 11 | 도구 없이 API + 사람 캡처 | "자동 시연"이 성립하지 않는다(P-2 c) |
| 12 | 외부 인코더(ffmpeg 직접 호출)로 GIF·영상 합성 | 이 PC에 없고 반입 대상이 늘어난다 — GIF는 순수 JS, 영상은 Playwright 녹화로 충분 |
| 13 | (2026-10-01) API를 `pnpm --filter @chat-bot/api run start`로 기동해 `NODE_PATH` 문제를 피함 | `.cmd` 셸 래퍼가 끼어 표식(`--title`)·인자 배열·트리 종료 규약이 깨지고 pnpm 프로세스가 한 단계 더 생긴다. 무엇보다 DHX-4를 계속 가린다 — `node dist/main.js` 직접 기동 + 명시적 `NODE_PATH`가 원인을 드러내면서 동작한다 |
| 14 | (2026-10-01) 하네스가 `apps/api/package.json`에 `multer`를 추가 | 제품 의존성 변경 0 원칙(FR-0-310) 위반 — 결함 수정은 제품 쪽 별도 커밋(DHX-4) |

## 실기동 정정(2026-10-01 · 1단계)

설계 §0.1 표 13건의 요약. 모두 **구현에 이미 반영**됐고 이 ADR의 결정 방향(위치·제품 변경 0·Edge·격리·API 우선·실제 시간·CI 0)을 바꾸지 않는다.

| # | 정정 | 결정 절 |
|---|---|---|
| 1 | 루트 스크립트 `pnpm -C tools/demo-harness run demo --`(종료 코드 보존) | §1 · §7 |
| 2 | 산출물 `dist/src/cli.js` · 선적재 `src/runtime/` 직접 참조 · `harness:test` = `scripts/run-tests.mjs` | §1 · §4 |
| 3 | API 자식 `NODE_PATH`·`NO_COLOR`(+`CBDEMO_API_PACKAGE_JSON`) · DHX-4 | §2 · §4 |
| 4 | 단건 지연 최대 3라운드 · 마지막 라운드 결정 · 전 라운드 공개 · 가용 RAM 경고 | (설계 §14) |
| 5 | 잠금 파일 하네스분 수동 병합(+53줄 · 삭제 0) | §1 |
| 6 | ffmpeg 없으면 `recordVideo` 미전달 · `ffmpeg-1011`+`winldd-1007` · `page@<해시>.webm` | §3 |
| 7 | `harnessPid`로 살아 있는 실행 보호 · `stop.request` | §4 |
| 8~13 | RAM 16e9 바이트 · 빌드 지문 크기·시각 · 단독 `--` 무시 · CP949 → 종료 코드·CSV 판정 · lint 기준 `npx eslint tools` · EPIPE 삼킴 | (설계 §5·§6·§3.4) |

## 결과

- **좋아지는 것**: 명령 1번으로 준비·10분 공연·보고서·정리 · 같은 정의로 무인 점검(3개 프로세스 종단 왕복의 첫 실 브라우저 실행 — 자동시험_전략 313행 공백의 일부를 로컬에서 메움) · 개발 PC 오염 0 · 연출과 사실의 구분이 보고서에 남는다 · (실기동 부수 효과) 구축형 직접 기동 결함 DHX-4를 납품 전에 발견.
- **치르는 것**: 새 개발 의존성 3종(하네스 전용) · 저장소 루트 설정 4파일 변경 · 잠금 파일 수동 병합 규칙(일반 `pnpm install` 금지) · 화면 문구가 바뀌면 선택자 갱신(하네스 단위 시험이 문구 대조로 알려 줌) · 준비 시간 약 6분 하한(이력 예약) · 하네스는 `NODE_PATH`로 기동하므로 같은 종류의 직접 기동 결함을 앞으로는 잡지 못한다(DHX-4 수정 쪽 시험으로 보완). 실기동 확인(Edge·Playwright·ffmpeg·HF 오프라인·공백 경로 SQLite·표식·쿠키)은 2026-10-01 완료 — 남은 수동 확인은 콘솔 Ctrl+C 신호 1회·폐쇄망 반입 1회.
- **하지 않는 것**: CI·실 배포 · 30분/구독형 프리셋(정의 파일 추가로 가능하게만) · 제품 결함 우회 · 시계 주입 · 음성 나레이션.

## PM 답변

- **PM 답변 2026-10-01: Q-1~Q-9 모두 기본안 채택**(설계 §24, "권고안대로 진행").

## 재검토 트리거

- Edge 채널로 Playwright가 동작하지 않거나 Edge 업데이트로 깨짐이 반복될 때 → Playwright Chromium 반입을 기본으로(대안 6).
- 사용자가 CI 플랫폼을 명시할 때 → `demo:check`를 CI 단계로(결과 형식은 이미 준비).
- 제품이 프레임 금지 헤더를 앱 코드에 넣을 때 → 무대 `iframe` 방식 재검토.
- 브라우저 E2E를 제품 회귀 시험으로 들일 때 → `playwright-core`를 제품 시험 의존성으로 승격할지 별도 ADR.
- 2인 승인 예약의 사전 승인 방식이 바뀔 때(ADR-0048 갱신) → ⑤ 예약 장면 재설계.
- `playwright-core`를 올릴 때 → ffmpeg 리비전(`browsers.json`)이 바뀌므로 반입 폴더·PC-6 확인 재실행.
- 잠금 파일 수동 병합이 반복적으로 실패하거나 제품 쪽 재해석(예: DHX-4 수정)과 충돌할 때 → 대안 1(독립 잠금 파일) 재검토.
