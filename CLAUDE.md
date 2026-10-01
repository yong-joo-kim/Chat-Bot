# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Language

이 프로젝트(Chat Bot) 작업 시에는 항상 한글로 답변할 것.

## Status

RoCHA.AI(페르소나AI) 벤치마킹 기반 챗봇 시스템. git 저장소(`origin` = github.com/yong-joo-kim/Chat-Bot, `main`)이며 기능그룹 단위로 구현·커밋이 진행 중이다.

**구현 완료 기능**(2026-09-29 기준, 그룹별 요약은 `docs/changelog/CHANGELOG.md`): No.1~16, 18(임베딩 ml-worker), 19, 20, 22(토픽 시스템), 23, 24(하이브리드 CS), 25, 26(레거시 API 연동), 27(설문관리), 28, 29, 30(외부 RAG 연동 — 문서 적재는 범위 밖), 44(피드백 기반 개선 루프), 40(환경분리), 45(데이터 거버넌스), 41(업무 자동화), 42(옴니채널 통합 인박스), 46(채널별 리치 메시지), 43(지식베이스 자동 크롤링/동기화 — 등록 사이트를 수집해 바뀐 문서만 외부 RAG 적재 API로 전송, `KB_SYNC_ENABLED` 기본 꺼짐, 첫 실제 적재 전 외부 RAG 담당자 확인 Q-1~Q-10 필요), 35(선제적 Proactive 메시징 — 위젯 로컬 체류 시간 트리거 1종으로 런처 옆 말풍선 노출, 문구+버튼 0~3개, 규칙별 일별 집계만 서버 저장·세션스토리지로 중복 억제, `packages/dialogue-engine`·ml-worker·채널 어댑터 변경 0, ADR-0045). 37(온디바이스/엣지 추론 — 고객사 사내 소형 서버 해석, ml-worker에 vLLM 생성 백엔드 추가·Ollama를 '경량 설치 구성(동작 보장·품질 미보증)'으로 인정·경량 구성 1회 생성 상한 20건·백엔드 주소 통제, 시연 모델은 RTX 3050 + Ollama `qwen3:4b-instruct-2507-q4_K_M`(qwen3.5:4b는 실측 부적합), `apps/ml-worker`·문서만 변경, 실 vLLM 서버 검증은 No.17 실측 때, ADR-0046). 21(딥러닝 군집분석 '발화 묶음 분석' — 엑셀/CSV 발화 파일 업로드→마스킹→임베딩(ml-worker /embed)→구면 k-평균(apps/api, 새 의존성 0)→대표 키워드→챗봇 대조→조회·엑셀 다운로드, 관리자가 고른 발화(최대 50건)만 미리보기·확정 후 기존 반영 경로로 의도 예문 반영(자동 반영 없음·자동 스냅샷), 마스킹본만 90일 보관, LLM 묶음 이름 제안은 보조·기본 꺼짐, 화면은 통계›발화 묶음 분석, ADR-0047; 합격 수치는 제안 상태로 PM 확정·운영 실데이터 재측정 필요, API 경유 실분석·5,000행 실측·브라우저 확인은 수동 게이트로 남음). 36(AI 거버넌스·가드레일 '안전 가드레일' — 규모 A: 위험 응답 규칙(사용자 질문=입구·외부 RAG 답=출구, 동작 3종 기록만/안전 문구로 대체/AI로 보내지 않음, 새 규칙 기본 '기록만'), RAG 답 개인정보 가림(`packages/pii-mask` 선택 인자, 기본 주민번호·카드만, 저장 마스킹 바이트 불변·골든 306문장), 운영 전환(예약 포함) 챗봇별 2인 승인(기본 꺼짐·자기 승인 금지·만료·직전 버전 롤백 예외, 강제 지점 `ProdSwitchService.switch()` 1곳), 모델·LLM 판정 0, 동기 대화 턴 모델·임베딩 호출 추가 0, 위젯·엔진 변경 0, ADR-0048; 편향·환각 점검(B)·런타임 근거 점검(C)은 하지 않음, AI 답변 고지(P-11)는 법무 확인 전 미구현, 실 외부 RAG·2계정 승인·브라우저 확인은 수동 게이트로 남음). 그 외 번호는 미착수. 기능 상태는 `docs/01-requirements/기능요구사항.md`의 비고 열이 기준이다.
**진행률**(2026-09-30, 기능 개수 기준 — 공수 가중치는 산정하지 않음): 완료 39/47(약 83%). 미착수 8종 중 GPU 필요도가 낮은 것은 No.39(1)·47(3)이고, 나머지 6종(No.17·31~34·38)은 GPU 고사양이라 남은 공수는 개수 비율보다 크다.

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

**다음 단계**(2026-09-25 사용자 지시): Stage B(No.26·27·24·22·44) 완료. 타사 벤치마킹 보완 7종을 **No.40 → No.45 → No.41 → No.42 → No.46 → No.43 → No.47** 순으로 `/new-feature` 진행한다(그룹별 PM 결정은 요구사항 단계에서 확인). No.43까지 완료(2026-09-29). **No.47은 사용자 결정으로 보류**(2026-09-29 — 2026-09-25에 도입을 확정했으나 필요성 재검토; 요구사항 초안 `docs/requirements/plugin-marketplace.md`는 PM 결정 6건 미확정 상태로 커밋하지 않고 보관). **No.39도 사용자 결정으로 보류**(2026-09-29 — 요구사항 초안 `docs/requirements/connector-hub.md`는 미커밋 초안으로 보관; 지금 제품의 인증 4종(NONE·API_KEY_HEADER·BEARER·BASIC)만으로 충분하면 불필요하고, 실제 공백은 OAuth2 토큰 방식 시스템을 연결할 수 없다는 것 하나뿐). **No.35(선제적 메시징)는 완료**(2026-09-29 — 위젯 로컬 체류 트리거 기반 말풍선 안내, ADR-0045). **2026-09-29 사용자 지시로 No.17 → No.31 → No.38 순서를 정했으나, No.31은 No.39(보류 중)와 얽혀 위험하다고 판단해 뒤로 미루고 No.17 → No.38 순으로 먼저 진행 중.** No.17(자연어생성 NLG Bot-to-Bot)은 요구사항 단계에서 **이미 구현된 No.16 G3(로컬 생성모델) 경로의 마지막 미완 단계(24GB+/L40S 운영 GPU에서 후보 3종 실측)와 사실상 같은 작업**으로 판정됐다(원본 제품소개서 화면 판독 근거 — 두 봇이 대화하는 self-play가 아니라 "생성기 1개가 여러 봇에 문장을 던져 성공/실패를 세는" 시험 화면). **지금은 L40S에 접근할 담당자가 없어 대기 중**(No.47·39의 "불필요해서 보류"와는 다름 — 필요하지만 실행할 사람이 없는 것). 요구사항 초안 `docs/requirements/nlg-bot-to-bot.md`는 미커밋 보관, 담당자가 생기면 바로 실측만 하면 된다. **No.38(노코드 프롬프트 기반 시나리오 설계)은 사용자 결정으로 보류**(2026-09-30 — 간단한 문답은 FAQ 엑셀 등록·챗봇 복사로 충분하고 로컬 생성모델은 No.17 실측 전이라 켤 생성기가 없음; 요구사항 초안 `docs/requirements/nocode-scenario-design.md`는 미커밋 보관, 대안으로 "의도마다 기본 노드 일괄 만들기"(No.5 고도화)는 별도 요청 가능). **2026-09-30 사용자 지시: 실제 vLLM(Gemma/Qwen) 외부 서버 연동 환경 구축이 불가해 GPU 고사양 기능은 RTX 3050 + Ollama `qwen3:4b-instruct-2507-q4_K_M`로 진행하고(모델 ID·백엔드는 설정 분리, 3050 결과는 '동작 확인'으로만 표기, 정확도·지연 합격은 운영 모델 실측 전제), No.37을 먼저 완료했다. No.21·36 완료(2026-09-30). 다음 후보: No.32·34(No.34는 봉투·엔진·고객별 저장소 변경 ADR 필요), No.33·31은 운영 모델 연동 이후. 결함 처리(2026-10-01, `docs/04-test/결함분류-2026-10-01.md`): K-1(시드 상한 19+의도명 1)·D-1(ml-worker 선언 갱신+`requirements-lock.txt`)·D-5(xlsx 재정렬을 `XlsxSheetReader.read()`로 공통화)·N40-1(롤백 게이트 완화는 직전 운영 버전에만, 롤백 preview 선택 필드 `directRollback`)·N40-3(BLOCK 게이트에서 초안≠운영이면 끄기 PROMOTE_DRAFT 거부, disable preview 선택 필드 `promoteDraftBlocked`)·N36-2(금지어·위험 응답 규칙의 제로폭 등 보이지 않는 문자 회피 차단)·L-3·T-1 해결. PM 결정 반영(2026-10-01): K-1b(로컬·Gemini가 후보 0건이면 러너가 규칙 기반 G1로 같은 Job 안에서 폴백 — `providerId='rule'`·결과 요약 `degraded:true`·선택 필드 `fallbackFrom`·`fallbackCause`, 증강 화면 안내 1줄)·N36-1(거버넌스 모드 ON이면 2인 승인 정책 끄기 기본 잠금 — `ENV_APPROVAL_OFF_LOCKED` 3상태, 명시값 우선, 응답 `offLockedBy`)·L-5(저장 마스킹이 독립된 `YYYY-MM-DD` 날짜를 계좌번호로 가리지 않음 — 생년월일 문맥(`생년`·`생일`·`출생`·`탄생일`·`birth`·`dob`·`birth date` 뒤 최대 구분 문자 6개·괄호 주석 `(양력)` 등)이면 옛 규칙대로 `[계좌번호]`, 규칙 버전 `PII_MASK_RULES_VERSION=2`, 골든 v1 동결·23건 갱신, 과거 저장분 재마스킹 없음, ADR-0049) 해결, L-2(직전 버전 롤백 반복 토글) PM 현행 수용. **미해결·후속**: U-14(날짜가 뒤에 오는 문맥 `1990-05-12 (생년월일)` 비보호 — PM 확인 대기)·U-12(봇이 묻고 날짜만 답한 생년월일 — PM 수용, 한계)·K-1c(Gemini 회로차단 사실상 미작동)·K-1d(폴백 G1 호출 try/catch 밖)·L-6(`EMAIL_REGEX` 긴 영숫자 2차 시간)·T-5(공백·하이픈 없는 16자리 카드번호가 주민번호 규칙에 걸려 끝 3자리 노출 — 기존 한계, 설계 확인 필요)·플래키 후보 T-3(legacy 회로차단 시험 시간 경합)·T-4(web proactive 모달 시험 타임아웃)·T-2(jest worker 종료 경고). 범위 밖: N36-3(위젯 FAILED 고정 문구). 미수행 검증: V-3(xlsx 재정렬 도입 후 5,000행 메모리·시간 실측).** 다음 단계는 사용자 지시가 필요하다. GPU 고사양 기능(No.17·21·31~34·36~38)은 **인프라 확정(2026-09-26): 운영은 L40S급 GPU 서버, 개발·시연은 RTX 3050(4GB) — 3050에서도 동작하는 경량/양자화 모델 경로 필수, 외부 LLM API는 가능하나 우선순위 낮음(로컬 모델 우선, `llm-provider` 추상화 유지)**. Stage C 이후 착수한다.

It sits alongside sibling projects in `D:\2. Team Source\`:
- `Auto QA` — pnpm monorepo (apps/api, apps/web, packages/*) — 이 프로젝트가 컨벤션을 재사용하는 대상
- `New Web` — Vite + React + TypeScript frontend
- `One Call` — Node/Express backend + React frontend, Docker Compose setup

### ⚠️ 동시 세션 주의
동일 폴더를 여러 Claude Code 세션에서 동시에 열면 `docs/`·`.claude/agents/` 파일이 서로 덮어써질 수 있다(실제 발생 이력 있음). 가능하면 한 번에 한 세션에서만 이 프로젝트를 작업할 것.
