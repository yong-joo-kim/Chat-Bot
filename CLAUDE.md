# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Language

이 프로젝트(Chat Bot) 작업 시에는 항상 한글로 답변할 것.

## Status

RoCHA.AI(페르소나AI) 벤치마킹 기반 챗봇 시스템. git 저장소(`origin` = github.com/yong-joo-kim/Chat-Bot, `main`)이며 기능그룹 단위로 구현·커밋이 진행 중이다.

**구현 완료 기능**(2026-09-24 기준, 그룹별 요약은 `docs/changelog/CHANGELOG.md`): No.1~16, 18(임베딩 ml-worker), 19, 20, 22(토픽 시스템), 23, 24(하이브리드 CS), 25, 26(레거시 API 연동), 27(설문관리), 28, 29, 30(외부 RAG 연동 — 문서 적재는 범위 밖), 44(피드백 기반 개선 루프). 그 외 번호는 미착수. 기능 상태는 `docs/01-requirements/기능요구사항.md`의 비고 열이 기준이다.

### 코드 구조
pnpm 모노레포: `apps/api`(NestJS + Prisma/SQLite), `apps/web`(관리자 콘솔, React+Vite), `apps/widget`(임베드 위젯), `apps/ml-worker`(Python FastAPI — 임베딩/증강), `packages/shared-types`(zod 스키마·API 계약), `packages/dialogue-engine`, `packages/pii-mask`.
- 시험: `apps/api`는 `npx jest`, `apps/web`는 `npx vitest run`. shared-types 변경 후에는 `pnpm --filter @chat-bot/shared-types build`를 먼저 실행.
- api 시험은 `apps/api/jest.isolate-env.js`(setupFiles)가 `.env`에서 기동 필수 키(DATABASE_URL·WIDGET_BASE_URL·PUBLIC_API_BASE_URL)만 읽고, 백그라운드 루프(`DEPLOY_SCHEDULE_ENABLED`·`HANDOFF_SWEEPER_ENABLED`)는 기본 `false`로 끈다. `ConfigModule.forRoot({validate})` 스냅샷은 `AppModule`을 처음 import하는 시점에 고정되므로 **정적 import spec의 `beforeAll`에서 `process.env`를 바꿔도 반영되지 않는다** — 선택 기능을 켜야 하는 spec은 값을 먼저 설정한 뒤 `await import('../app.module')`(동적 import)로 로드하고, 루프 동작은 `tick()` 직접 호출로 검증한다. 통합 시험의 DB는 `prisma migrate deploy`로 만든다(`db push`는 마이그레이션 전용 부분 유니크 인덱스를 만들지 않는다).
- boolean 환경변수·쿼리에는 `z.coerce.boolean()`을 쓰지 않는다("false"→true). 환경변수는 `envBoolean()`, 쿼리는 `queryBoolean()`.

### 문서 구조 (`docs/`)
1. `docs/00-source/` — 원본 참고 문서(ROCHA 매뉴얼/제품소개서, 정부 UIUX 가이드라인, 기능분류 초안)
2. `docs/01-requirements/기능요구사항.md` — **기능 47종**(기본 15 / 확장 14 / 옵션·트렌드 10 / 타사 벤치마킹 보완 8), GPU 필요도, 구축형/구독형 적합도. 보완 8종(No.40~47)은 Dialogflow CX/Copilot Studio/watsonx Assistant/카카오 i 오픈빌더 등 타 챗봇 플랫폼 웹조사 기반 제안으로, **2026-09-25 전부 도입 확정**(No.44 완료)
3. `docs/02-spec/개발명세서.md` — 아키텍처(모노레포 구조), 데이터모델, API 설계, 비기능요구사항. **§6에 사용자 확인이 필요한 미결정 사항**(스택 확정 여부, 구축형/구독형 우선순위, 1차 개발범위)이 정리되어 있으니 구현 착수 전 반드시 확인할 것.
4. `docs/03-design/UIUX_준수기준.md` — 정부 UIUX 가이드라인에서 추출한 챗봇 위젯/관리자 콘솔 준수 규칙
5. `docs/04-test/` — 시험계획.md / 시험항목.md / 시험데이터.md / 자동시험_전략.md / 오류검출_프로세스.md
6. `docs/05-ops/` — 버전관리.md / 자동배포.md

기능그룹별 산출물: 요구사항 `docs/requirements/<group>.md`, 설계 `docs/02-spec/<group>-설계.md`(+ `decisions/ADR-*.md`), 화면 명세 `docs/03-design/<group>-ui-spec.md`. 형제 프로젝트 `Auto QA`(pnpm+NestJS+React) 컨벤션을 재사용해 팀 내 일관성을 유지.

### 멀티에이전트 개발 하네스 (`.claude/agents/`)
`/new-feature <기능설명>` (`.claude/commands/new-feature.md`)로 기능 단위 개발을 다음 순서로 진행:

`requirements-analyst` → `system-architect` → `ui-designer`(화면 있을 때) → `backend-implementer`/`ml-engineer`(GPU 필요도에 따라) → `frontend-implementer` → `code-reviewer`(통과까지 반복) → `test-automation`(통과까지 반복) → 사용자 승인 시 `git-manager` 커밋 → 필요 시 `deployment-engineer`

운영 단계 보조 에이전트: `bug-triage`(오류검출·문서 보완, `docs/04-test/오류검출_프로세스.md` 기준)

**원칙**: 코드는 항상 `docs/01-requirements`/`docs/02-spec`/`docs/03-design` 문서에 근거해 구현하며, 설계 변경은 반드시 `system-architect`를 통해 문서에 먼저 반영한다. 커밋은 사용자가 명시적으로 요청했을 때만 `git-manager`가 수행하고, CI 연동(3단계)·실 배포(4단계)는 사용자가 플랫폼/자격증명을 명시하기 전에는 착수하지 않는다(`docs/05-ops/자동배포.md` §1).

**다음 단계**(2026-09-25 사용자 지시): Stage B(No.26·27·24·22·44) 완료. 타사 벤치마킹 보완 7종을 **No.40 → No.45 → No.41 → No.42 → No.46 → No.43 → No.47** 순으로 `/new-feature` 진행한다(그룹별 PM 결정은 요구사항 단계에서 확인). GPU 고사양 기능(No.17·21·31~38)은 인프라 결정 후 착수한다.

It sits alongside sibling projects in `D:\2. Team Source\`:
- `Auto QA` — pnpm monorepo (apps/api, apps/web, packages/*) — 이 프로젝트가 컨벤션을 재사용하는 대상
- `New Web` — Vite + React + TypeScript frontend
- `One Call` — Node/Express backend + React frontend, Docker Compose setup

### ⚠️ 동시 세션 주의
동일 폴더를 여러 Claude Code 세션에서 동시에 열면 `docs/`·`.claude/agents/` 파일이 서로 덮어써질 수 있다(실제 발생 이력 있음). 가능하면 한 번에 한 세션에서만 이 프로젝트를 작업할 것.
