# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Language

이 프로젝트(Chat Bot) 작업 시에는 항상 한글로 답변할 것.

## Status

**아직 실제 코드는 없다** (git 저장소도 아님). 현재는 문서/설계/멀티에이전트 하네스 단계이며, RoCHA.AI(페르소나AI) 벤치마킹 기반 챗봇 시스템을 목표로 한다.

### 문서 구조 (`docs/`)
1. `docs/00-source/` — 원본 참고 문서(ROCHA 매뉴얼/제품소개서, 정부 UIUX 가이드라인, 기능분류 초안)
2. `docs/01-requirements/기능요구사항.md` — **기능 47종**(기본 15 / 확장 14 / 옵션·트렌드 10 / 타사 벤치마킹 보완 8), GPU 필요도, 구축형/구독형 적합도. 보완 8종(No.40~47)은 Dialogflow CX/Copilot Studio/watsonx Assistant/카카오 i 오픈빌더 등 타 챗봇 플랫폼 웹조사 기반 제안으로, §4-1에서 사용자 확인 대기 중
3. `docs/02-spec/개발명세서.md` — 아키텍처(모노레포 구조), 데이터모델, API 설계, 비기능요구사항. **§6에 사용자 확인이 필요한 미결정 사항**(스택 확정 여부, 구축형/구독형 우선순위, 1차 개발범위)이 정리되어 있으니 구현 착수 전 반드시 확인할 것.
4. `docs/03-design/UIUX_준수기준.md` — 정부 UIUX 가이드라인에서 추출한 챗봇 위젯/관리자 콘솔 준수 규칙
5. `docs/04-test/` — 시험계획.md / 시험항목.md / 시험데이터.md / 자동시험_전략.md / 오류검출_프로세스.md
6. `docs/05-ops/` — 버전관리.md / 자동배포.md

### 제안 아키텍처 (`개발명세서.md` 기준, 미확정 — §6 참고)
pnpm 모노레포: `apps/web`(관리자 콘솔, React+Vite), `apps/widget`(임베드 위젯), `apps/api`(NestJS), `apps/ml-worker`(GPU 필요 딥러닝/임베딩/RAG/음성), `packages/shared-types|dialogue-engine|llm-provider`. 형제 프로젝트 `Auto QA`(pnpm+NestJS+React) 컨벤션을 재사용해 팀 내 일관성을 유지.

### 멀티에이전트 개발 하네스 (`.claude/agents/`)
`/new-feature <기능설명>` (`.claude/commands/new-feature.md`)로 기능 단위 개발을 다음 순서로 진행:

`requirements-analyst` → `system-architect` → `ui-designer`(화면 있을 때) → `backend-implementer`/`ml-engineer`(GPU 필요도에 따라) → `frontend-implementer` → `code-reviewer`(통과까지 반복) → `test-automation`(통과까지 반복) → 사용자 승인 시 `git-manager` 커밋 → 필요 시 `deployment-engineer`

운영 단계 보조 에이전트: `bug-triage`(오류검출·문서 보완, `docs/04-test/오류검출_프로세스.md` 기준)

**원칙**: 코드는 항상 `docs/01-requirements`/`docs/02-spec`/`docs/03-design` 문서에 근거해 구현하며, 설계 변경은 반드시 `system-architect`를 통해 문서에 먼저 반영한다. 커밋은 사용자가 명시적으로 요청했을 때만 `git-manager`가 수행하고, CI 연동(3단계)·실 배포(4단계)는 사용자가 플랫폼/자격증명을 명시하기 전에는 착수하지 않는다(`docs/05-ops/자동배포.md` §1).

**다음 단계**: `개발명세서.md` §6의 미결정 사항을 사용자와 확정한 뒤 `/new-feature`로 1차 개발 범위부터 착수한다.

It sits alongside sibling projects in `D:\2. Team Source\`:
- `Auto QA` — pnpm monorepo (apps/api, apps/web, packages/*) — 이 프로젝트가 컨벤션을 재사용하는 대상
- `New Web` — Vite + React + TypeScript frontend
- `One Call` — Node/Express backend + React frontend, Docker Compose setup

### ⚠️ 동시 세션 주의
동일 폴더를 여러 Claude Code 세션에서 동시에 열면 `docs/`·`.claude/agents/` 파일이 서로 덮어써질 수 있다(실제 발생 이력 있음). 가능하면 한 번에 한 세션에서만 이 프로젝트를 작업할 것.
