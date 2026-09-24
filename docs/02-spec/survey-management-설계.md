# 설문관리 세부 설계서 (No.27)

> **요구사항**: `docs/requirements/survey-management.md`(T-1~9, J-1~J-21, FR-0-106~117, FR-SV1-\*~FR-SV12-\*, NFR-SVP/SVS/SVA/SVM, AC-SV1~SV7, EX-SV-1~28, P-1~P-17)
> **상위 문서**: `docs/02-spec/개발명세서.md` §2·§2.2·§3·§3.1·§4·§4.1·§5·§6(**결정 36 신설**)·§7
> **신규 ADR**: **ADR-0035**(설문 = 챗봇별 정의 + 대화 내 멀티턴 세션(정지점 미사용) + 진행 포인터만 봉투 + 문항 단위 서버 적재(쓰기 가드·매 턴 재검증) + 구조 잠금 + 스냅샷 밖 + 응답 삭제 봉인)
> **갱신 ADR(각주만)**: ADR-0002(사전검사 9 → 11종) · ADR-0008(`SURVEY`도 형태로 실행 판정 · 설계 점검 상수 직접 사용 결함) · ADR-0009(봉투 선택 필드 2종 · §3 불변식 유지 근거) · ADR-0013(저장 지점의 두 번째 테이블) · ADR-0015(신규 권한 0종) · ADR-0016(`Survey` 대상) · ADR-0019(제외 사유 `SURVEY_TURN`) · ADR-0030(TC·비교는 설문 미리보기 판정 · 저장 0) · ADR-0031(설문은 스냅샷 밖) · ADR-0033(봉인 대상 확장) · ADR-0034(정지점 미사용 · 재진입 상태 이월)
> **작성일**: 2026-09-24 · **GPU**: **1 유지**(문자열 정규화 · 선택지/숫자 판정 · DB `groupBy` · CSV 직렬화 — 새 모델·추론·임베딩 0 · ml-worker 호출 0). ml-engineer 신규 작업 없음 — §23.
> **기존 파일 수정 목록**: 문서는 `docs/02-spec/survey-management-patches.md`, 코드는 이 문서 §2.5.

---

## 0. 이 문서가 푸는 문제 (한 문단 요약)

`SURVEY`는 No.5부터 **저장만 되고 실행되지 않는** 아웃풋이며 payload는 가리킬 실체가 없는 자유 문자열 키다(`packages/shared-types/src/dialogue.ts:512-514`, `packages/dialogue-engine/src/outputs.ts:180-184`). 이 설계는 **챗봇별 설문 정의**(`Survey`)를 만들고, 노드의 v2 `SURVEY`가 **대화 안에서 여러 턴에 걸쳐** 문항을 묻게 한다. 엔진은 **정지점(ADR-0034)을 쓰지 않고** 컨텍스트 폼과 같은 모양의 **순수 설문 세션**으로 다음 출력을 결정하며, 봉투에는 **진행 포인터만**(설문 id·구조 버전·문항 순번·재시도 수·시각·시작 노드 위치) 둔다. 응답 값은 엔진 결과의 선택 필드 `surveyEvents`로만 나가고, 공개 대화 파이프라인이 **엔진 뒤·로그 앞**에서 `SurveyResponseService` 1곳을 통해 **매 턴 재검증(행·상태·구조 버전·순서·값) 후 적재**한다. 자유 텍스트는 대화로그와 같은 함수·순서(금지어 → PII)로 마스킹된 값만 남고, 응답은 어떤 운영 경로로도 지워지지 않는다(ADR-0033 봉인 확장). 설문이 소비한 턴은 `ConversationLog.surveyTurn`으로 표시돼 질문 순위·미응답 수집·RAG에서 빠진다. 요구사항이 찾은 숨은 결함 4건(설계 점검 상수 직접 사용 · API 재진입의 상태 유실 · 컨텍스트 폼 버튼 절단 · 질문 순위 오염)과 이 설계가 추가로 찾은 2건(**시뮬레이터/TC 오버레이 병합이 번들의 설문을 버림** · **봉투 키 집합 고정 정적 검사**)의 처리를 §2.3·§22에 고정한다. 설문이 없는 챗봇의 모든 소비자 결과는 바이트 단위로 불변이다.

---

## 1. PM 확정 사항 (2026-09-24 — §11 P-1~P-17 전부 권고안)

| # | 확정 내용 | 이 문서에서의 반영 |
|---|---|---|
| P-1 | `SURVEY`만 실행. `SCENARIO`는 No.39 | §4.1 `UNSUPPORTED_OUTPUT_TYPES = ['SCENARIO']` · §20 |
| P-2 | 대화 내 멀티턴. 봉투에는 진행 위치만(설문 id·구조 버전·문항 순번·재시도 수·시각). 응답 값은 매 턴 서버 재검증 후 적재. 상태 버전 1 유지. 위젯 전용 폼·새 `@Public` 경로 없음 | §5 · §6 · §8 · §14 S-9 |
| P-3 | 챗봇별 설문(`/chatbots/:chatbotId/surveys`, 챗봇당 최대 50개). 전역 `/surveys` 예고 정정 | §3.1 · §13 |
| P-4 | 4유형(단일·다중·척도 별점5/NPS11·자유 텍스트 ≤500). 기존 `TEXT`·`BUTTON`만 — 위젯 변경 0. 버튼 5개 분할, 다중 선택은 번호 입력("1,3") | §4.4 · §5.11 · §5.12 |
| P-5 | 첫 응답 후 구조 잠금(`409`). 문구 수정 허용. 구조 변경은 복제 | §4.3 · §13.3 |
| P-6 | 설문 정의는 스냅샷에 넣지 않는다. 노드 참조만 스냅샷, 끊기면 경고 | §16 |
| P-7 | `sessionId`당 1회 완료. 서버는 `isDuplicate` 표시만. IP·쿠키 미수집 | §8.2 · §9 |
| P-8 | 자유 텍스트 = 금지어 마스킹 → PII 마스킹 후 저장. 이름·주소 미탐 고지 | §8.4 · §17 |
| P-9 | 응답 삭제 경로 0(No.29 봉인 확장). 응답 있는 설문은 마감만. 챗봇 영구삭제 사전검사에 설문 2종 추가. 보존기간 No.45 | §3.1 · §14 |
| P-10 | 노출·시작·완료·중도 이탈·미시작 이탈·진행 중·문항별 분포·평균·NPS. 노출일(KST) 코호트, 이탈은 조회 시점 판정(배치 없음). 챗봇 스코프만, `groupId` 스냅샷은 지금 적재 | §9 |
| P-11 | `ConversationLog.surveyTurn`. 설문 턴은 질문 순위(모든 스코프)·미응답 수집·RAG에서 제외. 기존 행 false | §3.1 · §7.1 · §9.6 |
| P-12 | 신규 권한 0. 정의 `dialogue:*`, 결과·CSV `chatbot:read`(마스킹본). 감사 대상 `Survey` | §11 · §12 |
| P-13 | CSV 2종(원자료·문항별 집계). 기간 필수, 최대 10,000행, `sessionId` 제외, 수식 인젝션 방어. 내보내기 비감사 | §10 |
| P-14 | 시뮬레이터·TC 저장 0. 시뮬레이터 미리보기 토글. TC·비교는 상태·기간 무시(결정적) | §7.2~§7.4 |
| P-15 | v1 읽기만·실행 안 함·새 v1 저장 400·자동 연결/변환 없음. AC-5-7 기대값 201 → 400(의도된 변경) | §4.1~§4.2 · §18 |
| P-16 | 설문 자체 상태(DRAFT/OPEN/CLOSED) + 선택 기간을 대화 시점 판정. No.28 변경 0 | §5.1 · §16 |
| P-17 | GPU 1 | §23 |
| (architect) | **J-4 엔진 통합** — 정지점 재사용 안 함. 순수 설문 세션(`survey-session.ts`) + 결과 선택 필드 `surveyEvents` → API 계층 사후 적재. 엔진 수정 = §2.3 닫힌 목록 + 엔진 I/O 0건 정적 검사 | §2.3 · §5 |
| (architect) | **J-20 참조 무결성** — `onCompleteNodeId`를 `getOutgoingNodeRefs().surveyTargets`로 4곳 편입, 노드 → 설문 참조는 저장 검증·설문 삭제 409·복원 경고 | §5.8 |
| (architect) | **숨은 결함 처리** — ① 설계 점검 상수 직접 사용(`design-validator.ts:402-404`) ② `resumeAfterApiCall` 상태 재조립(`api-call.ts:237-238`) ③ `context-session.ts:116` `slice(0,5)` ④ 질문 순위 오염 ⑤ **[신규] `mergeOverlay` 설문 유실(`overlay.ts:44-53`)** ⑥ **[신규] 봉투 키 집합 정적 검사(`legacy-api-sealing.spec.ts:159-163`)** | §22 D-11~D-16 |

---

## 2. 아키텍처 배치

### 2.1 모듈 구조

기존 4계층 규약(개발명세서 §2.1)을 따른다. **NestJS 모듈 2개를 신설**하고 결과 조회는 기존 `StatsModule`을 확장한다. 역할을 "정의 CRUD / 응답 쓰기 / 결과 읽기"로 나눠, **응답 쓰기 서비스가 공개 대화 1곳의 DI 그래프에만** 존재하게 한다(FR-0-110·112).

```
apps/api/src/
├── surveys/                                  # [신규] SurveysModule — 설문 정의 CRUD(챗봇 스코프)
│   ├── surveys.controller.ts                 # @Controller('chatbots/:chatbotId/surveys') — 6핸들러(§13.1 ①~⑥)
│   ├── surveys.service.ts                    # ★ Survey 쓰기 유일 파일 · 구조 잠금 · 상태 전이 · 복제 · 삭제 409 · 감사 · 번들 무효화
│   ├── survey.mapper.ts                      # row ↔ DTO(questions/cancelKeywords JSON 파싱 폴백, 감사용 questionCount)
│   └── lib/                                  # DB·Nest 무의존 순수 함수(NFR-SVM1)
│       ├── survey-structure.ts               # structureFingerprint() · diffStructure() → 'SAME'|'TEXT_ONLY'|'STRUCTURAL'
│       ├── survey-open-check.ts              # 오픈 검증(문항≥1·선택지≥2·기간 미종료) → details[]
│       ├── survey-keys.ts                    # 신규 문항/선택지 키 발급(uuid 주입) · 복제 시 키 재발급 매핑
│       └── survey-copy-name.ts               # "… (사본)" 충돌 시 번호
├── survey-responses/                         # [신규] SurveyResponsesModule — ★ 응답 쓰기 유일 모듈(export = SurveyResponseService 1개)
│   ├── survey-responses.module.ts            # imports: prisma, banned-words · exports: [SurveyResponseService] · import처 = ConversationModule뿐
│   ├── survey-response.service.ts            # ★ surveyResponse/surveyAnswer create·update 유일 파일 · apply(events, ctx) · 예외 삼킴
│   └── lib/
│       ├── write-guard.ts                    # 가드 ①~⑦ 판정(순수 — 행 스냅샷·이벤트·설문 정의 → ACCEPT|IGNORE(code))
│       └── answer-rows.ts                    # 정규화 값 → 답 행 목록(선택지 1행씩 · head 1행)(순수)
├── stats/surveys/                            # [신규 — StatsModule 확장] ★ 읽기 전용(R-8이 자동 적용 — Prisma 쓰기 0)
│   ├── survey-results.controller.ts          # @Controller('chatbots/:chatbotId/surveys/:surveyId') — 5핸들러(§13.1 ⑦~⑪)
│   ├── survey-stats.service.ts               # 요약·문항별 — groupBy 병렬 + runWithAggregationTimeout
│   ├── survey-results.service.ts             # 응답 목록·자유 텍스트 목록·CSV 2종
│   └── lib/
│       ├── survey-summary-assembler.ts       # 지표 조립(노출일 코호트·조회 시점 이탈 판정·비율 null 처리)
│       ├── survey-question-assembler.ts      # 도달 퍼널·분포·평균·NPS·표본 적음
│       ├── survey-display.ts                 # 표시 상태(IDLE 판정)·답 표시 문자열·응답 번호
│       └── survey-csv.ts                     # 헤더·행 조립(escapeCsvCell 위임) · 파일명 정제
├── conversation/public-conversation.service.ts   # [수정] ③.5 의미 점수 생략 · ④.6 응답 적재 · RAG/로그 surveyTurn(§7.1)
├── simulation/simulation.service.ts              # [수정] surveyPreview · surveyStep · compare 미리보기(§7.2~§7.3)
└── validation/run/test-run.executor.ts           # [수정] surveyPreview:true · surveyPreviewA/B 기록(§7.4)
```

### 2.2 모듈 의존 방향

```
surveys           → chatbots(ChatbotScopeService) / dialogue-common(bundle invalidate · ReferenceCheckService) / audit-logs / prisma
survey-responses  → banned-words(BannedWordFilterService.maskPlainText) / prisma          (conversation을 import하지 않는다)
conversation      → survey-responses(SurveyResponseService) + 기존
stats(surveys/)   → chatbots(existsById) / prisma / config                                  ★ survey-responses·surveys import 금지(읽기는 Prisma 직접)
dialog-nodes      → 변경 없음(v2 SURVEY 참조 검증은 Prisma 읽기)
simulation · validation · versions · deploy-schedules → ★ survey-responses import 금지(§14 S-6)
```
- **`SurveyResponsesModule`의 export는 `SurveyResponseService` 1개**이며 import처는 `ConversationModule` 1곳이다. 시뮬레이터·TC·비교·버전·예약 모듈에는 **주입 경로 자체가 없다**(ADR-0030·ADR-0025 봉인 L1과 같은 방식 — FR-0-112).
- `ChatbotsModule`(영구삭제 사전검사)은 `prisma.survey.count`·`prisma.surveyResponse.count`를 직접 호출한다(모듈 import 추가 0).
- `stats/surveys/`는 `StatsModule` 안이라 `stats-retention-sealing.spec.ts` **R-8(stats/** Prisma 쓰기 0)** 이 그대로 적용된다 — 통계가 응답을 고치는 경로가 구조적으로 없다.

### 2.3 엔진 수정 범위 — FR-0-106 닫힌 목록 (FR-0-78·88 "엔진 불가침"의 두 번째 의도된 예외)

| # | 파일 | 변경 | 비고 |
|---|---|---|---|
| ① | `packages/dialogue-engine/src/outputs.ts` | `executeOutputs` 옵션 `survey?`(완료 목록·미리보기) + 반환 `surveyStarted?`·`surveySkips?`. **v2 `SURVEY` 분기**(참여 가능 → 시작·종결 / 불가 → 건너뜀·계속). 0건 폴백 문구 선택에 설문 고정 문구 추가. v1은 기존 분기 그대로 | §5.2 |
| ② | `packages/dialogue-engine/src/survey-session.ts` **신규** | 참여 가능 판정 · 시작 · 전이(`advanceSurveySession`) · `willSurveyConsumeInput()` — `context-session.ts`의 **형제 파일**(상태 + 출력 반환, 예외 없음) | §5.1 |
| ③ | `resolver.ts` | **S0 설문 세션 단계**(S1과 상호 배타) · 완료 후 이동 노드 실행 · `resolveByNodeId`의 설문 `SWITCHED` · 세 실행 지점(S3·S6·버튼)의 `surveyStarted` 전파 · `EngineResolution.survey?` · `ResolveOptions.surveyPreview?`/`surveyState?` · 정지 시 설문 이월분을 `ApiResumeState`에 동봉 | §5.3 |
| ④ | `conversation-state.ts` | 설문 필드 **분리 파싱**(설문 필드 불량이 컨텍스트 세션을 버리지 않게) · 번들 존재·범위·24시간·미래 시각·상호 배타 검증 · 결과에 `surveySession`·`completedSurveyIds` | §6.3 |
| ⑤ | `api-call.ts` | **`resumeAfterApiCall`의 다음 상태 조립에 설문 필드 이월**(`api-call.ts:237-238` — 요구사항 FR-0-106 ⑤) · 분기 노드 실행에 설문 컨텍스트 전달 · 반환에 `surveyEvents`/`surveyTurn` · `ApiResumeState.survey` | §5.6 |
| ⑥ | `design-validator.ts` · `flow-tree.ts` | `getOutgoingNodeRefs()` 반환에 **`surveyTargets`** · 들어오는 참조·끊긴 참조·고아·흐름(`via: 'SURVEY_COMPLETE'`) 편입 | §5.8 |
| ⑦ | `turn.ts` · `index.ts` | `DialogueTurnResult.surveyEvents?`·`surveyTurn?` · 다음 상태 조립(키 생략 규칙) · `resolveTurn`이 `surveyState`를 주입 · export 추가 | §5.4 |
| ⑧ | `design-validator.ts` | **미지원 판정(402~404행)을 `isUnsupportedOutput()` 기반으로 교체**(단, `API_CONDITION`은 제외 — §22 D-12) + 설문 점검 6종 | §5.9 |
| ⑨ | `overlay.ts` | **`mergeOverlay`가 `surveys`를 이월**(신규 결함 — 없으면 오버레이 시뮬레이터·TC B측에서 v2 설문이 전부 `NOT_FOUND`) | §5.7 · §22 D-13 |
| — | `constants.ts` | 설문 고정 문구 6종 · `SURVEY_MAX_RETRY = 2` — ②에 딸린 상수 | §5.10 |

- 엔진은 여전히 **I/O·타이머·`fetch`·`process.env`·`Date.now()`·난수·Nest·Prisma 심볼 0건**이며 `legacy-api-sealing.spec.ts` L-5가 계속 단언한다(설문 모듈도 스캔 대상 — 추가 코드 0). 추가로 §14 S-5가 엔진 패키지의 `surveyResponse`/`SurveyResponseService` 심볼 0건을 단언한다.
- 이 목록에 없는 엔진 파일(`matcher.ts`·`node-matcher.ts`·**`context-session.ts`**·`homonym.ts`·`faq.ts`·`semantic.ts`·`dialogue-index.ts`·`normalize.ts`)은 **수정하지 않는다**. `context-session.ts:116`의 `slice(0,5)` 결함은 설문 쪽에 전파하지 않고(설문은 자체 분할 — §5.11) 이 그룹에서는 고치지 않는다(§22 D-11). `CONVERSATION_STATE_VERSION`은 **1 그대로**다(FR-0-109).

### 2.4 `apps/api` 외 워크스페이스 영향

| 워크스페이스 | 변경 |
|---|---|
| `packages/shared-types` | `dialogue.ts`(`SURVEY` v1/v2 · `isSurveyV2` · `findLegacyOutputIndexes` · `isUnsupportedOutput` v1 SURVEY 분기 · `UNSUPPORTED_OUTPUT_TYPES` 축소) · **`survey.ts` 신설**(정의·통계·목록·CSV 쿼리 스키마 · `SURVEY_LIMITS`) · **`survey-logic.ts` 신설**(응답 판정·값 재검증·문항 출력·참여 가능 판정 — zod 스키마 미사용 순수 함수) · `dialogue-engine.ts`(`SurveySessionStateSchema` · 봉투 선택 필드 2종 · `StateDiscardReason` 3종 · 번들 `surveys?` · `SurveyEvent` 타입 · trace 단계 1+코드 7 · 설계 점검 코드 6 · 흐름 `via` 1) · `conversation.ts`(시뮬레이터 `surveyPreview`·`surveyStep`) · `validation.ts`(결과 `surveyPreviewA/B`) · `version.ts`(복원 경고 3종 · 무결성 경고 1종) · `audit.ts`(`Survey`) · `common.ts`(`ApiErrorCode` 4종) · `index.ts` export |
| `packages/dialogue-engine` | §2.3 닫힌 목록 |
| `apps/web` | 챗봇 상세 **설문관리**(목록·편집기·결과) · 노드 편집기 `설문` 아웃풋(선택기·완료 후 이동 노드·v1 전환) · 시뮬레이터 `설문 미리보기`·`설문 단계` · 흐름 트리 `SURVEY_COMPLETE` · 복원 미리보기 경고 3종 · TC 결과 `설문 미리보기 판정` 배지 — §17 |
| `apps/widget` · `apps/ml-worker` | **변경 0건**(위젯은 `TEXT`·`BUTTON` 렌더러만 사용 — `apps/widget/src/ui/renderers/index.ts:16-39`, 봉투는 불투명 값으로 통째 덮어씀 — ADR-0009 결과) |

### 2.5 기존 코드 변경 목록 (구현자 체크리스트)

| 파일 | 변경 | 근거 |
|---|---|---|
| `prisma/schema.prisma` + 마이그레이션 1개 | `Survey`·`SurveyResponse`·`SurveyAnswer` 신설 · `ConversationLog.surveyTurn` · `TestRunResult.surveyPreviewA/B` · `Chatbot` 역참조 2개(§3.1) | §3 |
| `prisma/scripts/report-legacy-survey-outputs.ts` | **신규** 읽기 전용 v1 `SURVEY` 잔존 계측(노드·버전) | FR-SV11-6 · §3.3 |
| `prisma/seed.ts` | 데모 설문 1건(OPEN·3문항) + v2 `SURVEY` 데모 노드 1개. **기존 v1 `SURVEY` 시드(:497-498) 불변**(AC-SV1-1 재현용) | §3.4 |
| `packages/shared-types/src/dialogue.ts` | :437 상수 축소 · :512-514 v1 이름 변경 + v2·union·판별 · :732 union 항목 = v1∪v2 · :737-742 `isUnsupportedOutput` v1 SURVEY 분기 · :713-719 옆에 `findLegacyOutputIndexes` | §4.1~§4.2 |
| `packages/shared-types/src/{survey,survey-logic}.ts` | **신규** | §4.3~§4.4 |
| `packages/shared-types/src/dialogue-engine.ts` | :46-50 봉투 선택 필드 · :67-75 폐기 사유 · :82-89 번들 `surveys?` · :96 단계 · :99-150 코드 · :203-224 점검 코드 · :257/:267 `via` · 설문 이벤트 타입 | §4.5 |
| `packages/dialogue-engine/src/*` | §2.3 ①~⑨ | FR-0-106 |
| `dialogue-common/dialogue-bundle.service.ts` | `build()`에 `survey.findMany({ where:{chatbotId} })` 1회(tx 모드면 순차) + 매퍼(JSON 파싱 폴백 — 실패 시 `questions: []`) | FR-SV2-9 |
| `dialogue-common/reference-check.service.ts` | `assertNodeDeletable`(:139-159)에 `surveyTargets` 합류 · **`assertSurveyDeletable(chatbotId, surveyId)`** 신규(`outputs contains surveyId` 사전 필터 + 파싱 재확인, `409 SURVEY_IN_USE`·노드명 최대 5) | FR-SV2-7 · FR-SV3-2 |
| `dialog-nodes/dialog-nodes.service.ts` | 쓰기 가드: 기존 `assertNoLegacyApiOutputs`(:54-64) **뒤에** `assertNoLegacySurveyOutputs`(`400 SURVEY_OUTPUT_LEGACY_FORMAT`) · `validateReferences`(:92-154)에 v2 `surveyId`(같은 챗봇 `survey.findMany` 1회)·`onCompleteNodeId`(nodeTargetRefs 합류) · `copy`(:344-347) v1 `SURVEY`도 제외 + `excludedLegacySurveyOutputCount` | FR-SV1-5 · FR-SV3-1 |
| `dialog-nodes/dialog-nodes.controller.ts` | 복사 응답에 `excludedLegacySurveyOutputCount` | FR-SV1-5 |
| `conversation/public-conversation.service.ts` | ③.5 `willSurveyConsumeInput` → 의미 점수 생략 · ④.6 `surveyResponses.apply()` await · `evaluateRagEligibility`에 `surveyTurn` · `record()`에 `surveyTurn` | §7.1 |
| `conversation/conversation-log.service.ts` | `RecordConversationLogParams.surveyTurn?: boolean`(기본 false) → `create.data.surveyTurn` · 수집기에 전달 | FR-SV5-8 |
| `learning/lib/collect-decision.ts` · `learning/unanswered-collector.service.ts` | `CollectSkipReason`에 `'SURVEY_TURN'` · 입력 `surveyTurn?`(기본 false — 기존 호출 무변경, `apiNotice` 다음 순서로 판정) | FR-SV5-8 · ADR-0019 |
| `rag/lib/should-run-rag.ts` | `ShouldRunRagInput.surveyTurn?: boolean` → true면 false(조건 ⑪) | FR-SV5-9 |
| `stats/stats.service.ts` · `stats/integrated/integrated-stats.service.ts` | 질문 순위 `groupBy(userMessage)` **5곳**(대시보드 :76-83 · 질문 순위 :272-287 · 통합 :247-262 · 통합 귀속 :284-289)의 `where`에 `...QUESTION_RANKING_LOG_FILTER` | FR-SV10-5 · §9.6 |
| `stats/lib/question-ranking-filter.ts` | **신규** `export const QUESTION_RANKING_LOG_FILTER = { surveyTurn: false } as const`(조건 1벌) | §9.6 |
| `stats/stats.module.ts` | `SurveyResultsController` · `SurveyStatsService` · `SurveyResultsService` 등록 | §2.1 |
| `simulation/simulation.service.ts` | `resolveTurn` 옵션 `surveyPreview: dto.surveyPreview` · ③.5와 같은 의미 점수 생략 · 응답 `surveyStep` · `compare()`(:336·:340) `surveyPreview: true` | §7.2~§7.3 |
| `simulation/lib/survey-step.ts` | **신규** 순수 — trace + 이벤트 → `SurveyStepView`(값 미포함) | FR-SV9-3 |
| `validation/run/test-run.executor.ts` | `resolveTurn`(:436) 옵션 `surveyPreview: true` · `SideOutcome.surveyPreview` · `flush`의 `surveyPreviewA/B` | FR-SV9-4 |
| `validation/lib/validation-sealing.spec.ts` | 금지 import에 `survey-responses/` 추가 | FR-0-112 |
| `versions/lib/snapshot-integrity.ts` | `surveyTargets` → `BROKEN_REFERENCE_NODE_SURVEY` 경고(:83-101 블록) | FR-SV3-2 ④ |
| `versions/restore/restore-warnings.service.ts` | 경고 3종(§16) — `prisma.survey.findMany` 읽기 1회 | FR-SV10-1 |
| `chatbots/chatbots.service.ts` | `CHILD_COUNT_LABELS`(:33-43)에 `surveys: '설문'`·`surveyResponses: '설문 응답'` · 사전검사 `counts`(:325-335)에 두 키. **동반 삭제 트랜잭션(:354~)에 추가하지 않는다** | FR-SV8-4 · ADR-0002 |
| `audit-logs/lib/audit-snapshot.ts` | `AUDIT_FIELDS.Survey`(:56 옆) | FR-SV2-8 |
| `legacy-api/lib/legacy-api-sealing.spec.ts` | **L-12 기대 키 집합을 5키로 갱신**(`version·contextSession·pendingClarify·surveySession·completedSurveyIds`) — 의도된 기대값 변경(§22 D-16) | FR-0-109 |
| `stats/lib/survey-sealing.spec.ts` | **신규** S-1~S-14(§14) | NFR-SVS3 |
| `apps/web/**` | §17 | FR-SV11-\* |

> **이 목록에 없는 파일은 바꾸지 않는다.** 특히 `context-session.ts`, 위젯 전부, `stats/lib/summary-assembler.ts`(FR-0-113), `versions/lib/snapshot-envelope.ts`(스냅샷은 6종만 나열 — 설문 미포함이 **구조로** 보장됨), `deploy-schedules/**`(No.28 변경 0 — FR-SV10-4)는 무변경이다.

---

## 3. 데이터 모델 · 마이그레이션

### 3.1 Prisma 변경안

```prisma
/// [신규 No.27] 챗봇별 설문 정의(ADR-0035 §2). 쓰기 주체 = SurveysService 1파일.
/// 문항은 설문과 생사를 같이하고 항상 함께 읽히므로 JSON(ContextVariable.slots 선례).
/// 노드 → 설문 참조는 DialogNode.outputs JSON 안(FK 없음 — 삭제 409는 앱 레벨). 스냅샷 대상이 아니다.
model Survey {
  id                    String   @id @default(uuid())
  chatbotId             String
  chatbot               Chatbot  @relation(fields: [chatbotId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  name                  String
  /// normalizeText(name) — 챗봇 내 유일(ADR-0006)
  nameNormalized        String
  description           String?
  /// DRAFT | OPEN | CLOSED (zod SurveyStatus)
  status                String   @default("DRAFT")
  activeFrom            DateTime?
  activeTo              DateTime?
  introMessage          String?
  completionMessage     String   @default("설문에 참여해 주셔서 감사합니다.")
  /// JSON string[] 0~10개(각 ≤20자)
  cancelKeywords        String   @default("[\"그만\",\"취소\",\"설문 종료\"]")
  sessionTimeoutMinutes Int      @default(30)
  /// JSON SurveyQuestion[] 0~20개 — 문항·선택지 key(UUID)는 생성 후 불변
  questions             String   @default("[]")
  /// 구조 변경 시 +1(서버 관리). 응답(답 행) 존재 후 구조 변경은 409 — 값이 사실상 동결된다
  structureVersion      Int      @default(1)
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  responses SurveyResponse[]

  @@unique([chatbotId, nameNormalized])
  @@index([chatbotId, updatedAt])
  @@map("surveys")
}

/// [신규 No.27] 응답 시도 1건(노출 ~ 완료/이탈). ★ 쓰기 주체 = SurveyResponseService 1파일(create·update),
/// 삭제 코드 0건(정적 검사 S-1). IP·User-Agent·쿠키·로그인 식별자 컬럼이 존재하지 않는다(S-3).
/// 이탈(무응답)은 행을 바꾸지 않고 조회 시점에 판정한다(ADR-0035 §6).
model SurveyResponse {
  id                   String   @id @default(uuid())
  chatbotId            String
  chatbot              Chatbot  @relation(fields: [chatbotId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  surveyId             String
  survey               Survey   @relation(fields: [surveyId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  /// 노출 당시 챗봇 소속 그룹 스냅샷 — FK 없음 · 적재 후 불변(ConversationLog.groupId 선례, ADR-0033 §4)
  groupId              String
  /// 위젯 난수 — 응답자 키의 전부(인증 수단 아님). API 응답·CSV에 싣지 않는다
  sessionId            String
  channelType          String
  structureVersion     Int
  /// 쓰기 키 일부 — 엔진이 정한 노출 시각(봉투 surveySession.startedAt과 같은 값)
  startedAt            DateTime
  /// EXPOSED | IN_PROGRESS | COMPLETED | ABANDONED
  status               String   @default("EXPOSED")
  /// CANCELLED | RETRY_EXCEEDED | SWITCHED | TIMEOUT | DEFINITION_CHANGED | CLOSED
  endReason            String?
  /// 답 행(응답·건너뜀)이 1건 이상인가 — "시작" 지표의 groupBy 키
  started              Boolean  @default(false)
  /// 마지막으로 적재된 문항 순번(-1 = 없음) — 순서 증가 가드 · 도달 퍼널
  lastQuestionIndex    Int      @default(-1)
  lastInteractedAt     DateTime
  completedAt          DateTime?
  endedAt              DateTime?
  missingRequiredCount Int      @default(0)
  /// 같은 (chatbotId, sessionId, surveyId)에 먼저 완료된 시도가 있다(노출·완료 시점 판정) — 통계 기본 제외
  isDuplicate          Boolean  @default(false)
  /// FK 없음(사실 기록)
  exposedNodeId        String?
  /// 노출 턴의 messageId(= ConversationLog.id) — FK 없음
  conversationLogId    String?
  /// KST 노출일 — 적재 시점 확정·불변(ADR-0017)
  dayBucket            String
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  answers SurveyAnswer[]

  /// 쓰기 키 = 멱등(리플레이 흡수) · 선두 3열 접두가 (chatbotId, sessionId, surveyId) 중복 조회·챗봇 삭제 사전검사 count를 겸한다
  @@unique([chatbotId, sessionId, surveyId, startedAt])
  @@index([surveyId, dayBucket])
  @@map("survey_responses")
}

/// [신규 No.27] 문항 응답. 선택 유형은 선택지 1개당 1행(DB groupBy로 분포 — FR-SV5-7), 문항당 대표 행(isHead) 1개.
/// 라벨 문자열을 저장하지 않는다(키만 — 라벨 수정 허용의 근거). textValue = 마스킹본만(원문 컬럼 없음).
/// ★ 쓰기 주체 = SurveyResponseService 1파일 · 삭제 코드 0건.
model SurveyAnswer {
  id            String         @id @default(uuid())
  responseId    String
  response      SurveyResponse @relation(fields: [responseId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  /// 비정규화(조인 없는 groupBy) — FK 없음(응답 행 FK가 보호)
  surveyId      String
  questionKey   String
  questionIndex Int
  /// ANSWERED | SKIPPED
  kind          String
  /// 문항당 정확히 1행 true — 응답자 수·척도 분포·건너뜀의 기준 행
  isHead        Boolean
  /// 선택 유형의 선택지 key, 그 외는 "" (SQLite NULL 유일성 회피 센티넬)
  choiceKey     String         @default("")
  /// 척도 값(정수)
  numericValue  Int?
  /// ★ 금지어 → PII 마스킹 후 값만
  textValue     String?
  /// 비정규화 3종 — 응답 행에서 복사(적재 시점). isDuplicate만 완료 시점 재판정으로 갱신될 수 있다(쓰기 주체 동일)
  dayBucket     String
  channelType   String
  isDuplicate   Boolean        @default(false)
  answeredAt    DateTime

  /// 멱등 — 같은 시도·문항·선택지 두 번 적재 불가
  @@unique([responseId, questionKey, choiceKey])
  @@index([surveyId, questionKey, dayBucket])
  @@map("survey_answers")
}

model ConversationLog {
  // … 기존 필드 불변 …
  /// [신규 No.27] 이번 턴 입력을 설문 세션이 소비했는가(응답·건너뛰기·재질문·취소·재시도 초과·완료).
  /// 노출 턴·타임아웃 후 일반 처리 턴은 false. 질문 순위·미응답 수집에서 제외하는 근거(파생 불가 — ADR-0004 통과).
  /// 쓰기 주체 = record() 1곳. 인덱스 없음(answeredByRag 선례). 백필 불필요(기존 행 = false가 사실).
  surveyTurn      Boolean  @default(false)
}

model TestRunResult {
  // … 기존 필드 불변 …
  /// [신규 No.27] 이 TC 실행에 설문 미리보기 판정(상태·기간 무시)이 관여했는가 — `설문 미리보기 판정` 배지 근거
  surveyPreviewA Boolean @default(false)
  surveyPreviewB Boolean @default(false)
}

model Chatbot {
  // … 기존 필드 불변 …
  /// [신규 No.27] 역참조만 — DB 컬럼 변화 0
  surveys         Survey[]
  surveyResponses SurveyResponse[]
}
```

**만들지 않는 것**(요구사항 §5.2 그대로): 설문 진행 세션 테이블 · 설문 리비전 테이블 · 응답자 식별 테이블(IP·쿠키) · 사전 집계(롤업) 테이블 · 응답 원문 테이블 · 설문↔노드 조인 테이블 · 응답 알림 테이블.

### 3.2 마이그레이션 (1개, `YYYYMMDDHHMMSS_survey_management`)

1. `CREATE TABLE surveys` + `UNIQUE(chatbotId, nameNormalized)` + `INDEX(chatbotId, updatedAt)`.
2. `CREATE TABLE survey_responses` + `UNIQUE(chatbotId, sessionId, surveyId, startedAt)` + `INDEX(surveyId, dayBucket)`.
3. `CREATE TABLE survey_answers` + `UNIQUE(responseId, questionKey, choiceKey)` + `INDEX(surveyId, questionKey, dayBucket)`.
4. `ALTER TABLE conversation_logs ADD COLUMN surveyTurn BOOLEAN NOT NULL DEFAULT false`.
5. `ALTER TABLE test_run_results ADD COLUMN surveyPreviewA BOOLEAN NOT NULL DEFAULT false` · `surveyPreviewB` 동일.
- **비파괴 변경만** — 기존 행·컬럼 변경 0, **백필 0**(기존 로그 `surveyTurn=false`·기존 TC 결과 `false`가 사실과 일치). 롤백 = 세 테이블 DROP + 세 컬럼 제거.
- ⚠ `prisma migrate dev`가 생성한 diff에 `deploy_schedules`·`test_runs`의 **부분 유니크 인덱스 삭제 구문**이 끼어들지 않는지 확인하고, 있으면 그 줄을 제거한다(`schema.prisma:944-951` 주석 규약 — No.26 §3.2와 같은 주의).
- **v1 `SURVEY` 데이터는 마이그레이션하지 않는다**(P-15 — 자동 연결·변환 없음).

### 3.3 v1 잔존 계측 — `prisma/scripts/report-legacy-survey-outputs.ts` (FR-SV11-6)

- **읽기 전용**. 출력: 챗봇별 `v1 SURVEY 보유 노드 수` · 버전(스냅샷) 중 v1 `SURVEY` 포함 `versionId`·`versionNo` 목록. 자유 문자열 키 값은 출력하지 않는다(건수·ID만 — 운영 기록에 남는 값을 최소화).
- `report-legacy-api-conditions.ts`(No.26)와 같은 구조 — `apps/api/src` 밖이라 본문 참조 봉인(V-7)의 대상이 아니다.
- 배포 직후 1회 실행. 0이 아니면 설계 점검 `SURVEY_LEGACY_FORMAT` 요약이 대상 노드로 안내한다(§17 ⑦).

### 3.4 seed

- 기존 데모 챗봇의 v1 `SURVEY` 노드(`seed.ts:497-498`)는 **그대로 둔다** — AC-SV1-1(v1 바이트 동일·자동 연결 없음)과 AC-5-7 갱신 시험의 재현 데이터다. ⚠ 그 챗봇의 설계 점검에는 `SURVEY_LEGACY_FORMAT` WARNING 1건이 **새로 생긴다** — 설계 점검 WARNING 개수를 단언하는 통합 시험이 있으면 §18 의도된 기대값 변경 목록에 추가한다.
- 신규: 데모 챗봇에 설문 `배송 만족도`(OPEN · 기간 없음 · 문항 3: 척도 `STAR_5` 필수 / 다중 선택 4지 1~3개 / 자유 텍스트 선택 "(개인정보는 입력하지 마세요)") + v2 `SURVEY` 노드 1개(`onCompleteNodeId` 없음). 기존 시드 행 불변. `SurveyResponse`·`SurveyAnswer` 시드는 만들지 않는다(응답은 대화로만 생긴다 — 통계 픽스처는 시험 코드가 직접 적재).

### 3.5 신규 환경변수

**0종**(FR-0-117). 설문 기능 스위치는 설문 상태(`DRAFT`)가 대신한다. 한도는 FE/BE 공용 코드 상수 `SURVEY_LIMITS`(§4.3).

### 3.6 배포 순서

마이그레이션 → API 배포(v1 노드는 계속 미실행) → `report-legacy-survey-outputs.ts` 1회 → 콘솔 배포.
- **역순 롤백 안전성**: 구버전 엔진은 v2 payload(`{ version, surveyId(uuid), onCompleteNodeId? }`)를 구 `SurveyOutputPayloadSchema`(자유 문자열 1~100 · strip)로 **통과시켜 기존 미지원 처리**를 한다(`PAYLOAD_INVALID`가 아니다 — No.26과 다른 점). 구버전 봉투 스키마는 설문 필드를 strip한다. 즉 롤백 시 설문은 "미지원 안내"로 수렴하고 오류는 없다(§21 K-10).

---

## 4. shared-types 스키마

### 4.1 `SURVEY` v1 / v2 (`packages/shared-types/src/dialogue.ts`)

```ts
/** 실행 미지원 아웃풋 "타입"(FR-SV1-1). SURVEY·API_CONDITION은 타입이 아니라 형태로 판정한다 — isUnsupportedOutput(). */
export const UNSUPPORTED_OUTPUT_TYPES = ['SCENARIO'] as const;

/** [No.5 원형 — 읽기 호환 전용] 자유 문자열 키. 새로 저장할 수 없다(서비스가 400 SURVEY_OUTPUT_LEGACY_FORMAT). 실행하지 않는다. @deprecated */
export const SurveyOutputPayloadV1Schema = z.object({ surveyId: z.string().trim().min(1).max(100) });

/** [No.27] 같은 챗봇 Survey 참조형. */
export const SurveyOutputPayloadV2Schema = z.object({
  version: z.literal(2),                         // ★ 판별 필드
  surveyId: z.string().uuid(),
  onCompleteNodeId: z.string().uuid().optional(), // 완료 직후 이어서 실행할 노드 — 이탈·건너뜀에는 쓰지 않는다
});

/** 읽기 스키마 = v2 ∪ v1(v2 먼저). 이름은 기존 export를 유지하되 의미가 "합집합"으로 넓어진다. */
export const SurveyOutputPayloadSchema = z.union([SurveyOutputPayloadV2Schema, SurveyOutputPayloadV1Schema]);
export function isSurveyV2(p: SurveyOutputPayload): p is SurveyOutputPayloadV2;   // p.version === 2
```
- `DialogOutputSchema`(:721-734)의 `SURVEY` 항목은 **합집합**을 쓴다 — 엔진 파싱(`outputs.ts:121`)·번들·스냅샷 복원 검증(`snapshot-integrity.ts:53`)·응답 DTO가 v1을 계속 읽어야 한다(AC-SV1-1 · AC-SV6-5).
- **판별**: `version === 2`. v1은 `version`이 없어 v2 파싱이 실패한다. v2 객체는 v1 스키마도 통과하지만(strip) union이 v2를 먼저 시도하므로 v2로 읽힌다. **v1의 `surveyId`가 우연히 UUID 형식이어도 v1이다**(`version` 없음) — 자동 연결 금지(P-15)가 스키마 수준에서 성립한다.
- 요청 파이프가 strip 모드라 v2에 섞여 온 임의 키는 조용히 제거된다(안전 방향).

### 4.2 판정 · 쓰기 제한 · 업캐스트 정책

```ts
/** 실행 미지원 = SCENARIO · v1 SURVEY · v1 API_CONDITION. 엔진·설계 점검·웹 배지 공용(FR-SV1-3). */
export function isUnsupportedOutput(o: DialogOutput): boolean;
//   기존 두 줄 + `if (o.type === 'SURVEY' && !isSurveyV2(o.payload)) return true;`

/** v1(이전 형식) 아웃풋의 위치 — 쓰기 거부·복사 제외 공용(규칙 1벌, FR-SV1-5 일반화 권고). */
export function findLegacyOutputIndexes(outputs: readonly DialogOutput[]): Array<{ index: number; type: 'API_CONDITION' | 'SURVEY' }>;
/** 기존 export 유지 — 내부는 findLegacyOutputIndexes 위임(호출부 무변경). */
export function findLegacyApiOutputIndexes(outputs: readonly DialogOutput[]): number[];
export function findLegacySurveyOutputIndexes(outputs: readonly DialogOutput[]): number[];
```
- **쓰기 = v2만**을 zod DTO 분리가 아니라 **서비스 가드**로 강제한다(No.26 D-8과 같은 이유 — 파이프는 전용 오류 코드를 만들 수 없고, 시뮬레이터 오버레이의 v1은 실행·저장되지 않아 무해하다). `DialogNodesService.create()`와 `update()`(dto.outputs가 있을 때)는 **기존 API 가드 → 설문 가드 순서**로 검사한다 — v1 `SURVEY`가 있으면 **`400 SURVEY_OUTPUT_LEGACY_FORMAT`**(`details[].field = outputs[i]`, 메시지 "설문 연결을 새 방식으로 바꿔야 저장할 수 있습니다. 설문을 선택해 주세요."). 두 종류가 함께 있으면 기존 `API_OUTPUT_LEGACY_FORMAT`이 먼저다(기존 응답 불변).
- `update()`에서 `dto.outputs`가 **없으면** 기존 v1을 그대로 둔다(사용 여부 토글 등 — No.26 D-16과 같음).
- **복사**: v1 `SURVEY`는 사본에서 **제외**하고 응답에 `excludedLegacySurveyOutputCount`를 싣는다(FR-SV1-5 — 사본이 곧바로 "저장 불가 노드"가 되는 것을 막는다). v2는 그대로 복사(FR-SV3-4).
- **업캐스트 없음**: 서버 자동 v1→v2 변환 함수를 만들지 않는다(자유 키 → 설문 자동 연결 금지, P-15). `SNAPSHOT_SCHEMA_VERSION`·업캐스터 불변(읽기 합집합). 웹 편집기의 "설문 선택해 전환"은 **빈 v2 초안**(`{ version: 2, surveyId: '' }` — 선택 전 저장 불가)을 만들 뿐 v1 키를 옮기지 않는다.

### 4.3 `packages/shared-types/src/survey.ts` 신설 (위젯 비유입)

의존 방향: `survey.ts → common.ts · dialogue.ts(DialogueNameSchema·ResourceRefSchema) · deploy-schedule.ts(OffsetDateTimeSchema)`. `dialogue-engine.ts → survey.ts`(번들). 순환 없음.

| 이름 | 내용 |
|---|---|
| `SURVEY_LIMITS` | 챗봇당 50 · 이름 50 · 설명 300 · 소개 500 · 완료 문구 500 · 취소어 10개×20자 · 타임아웃 1~1440(기본 30) · 문항 20 · 문항 문구 300 · 선택지 2~10 · 선택지 라벨 40 · 척도 양끝 라벨 20 · 자유 텍스트 `maxLength` 1~500(기본 300) · 재시도 2 · `completedSurveyIds` 20 · 버튼 블록당 5·최대 3블록 · CSV 10,000행 · 목록 기본 50/최대 100 · 표본 적음 30 · 목록/CSV 기간 최대 366일 |
| `SurveyStatus` · `SurveyQuestionType` · `SurveyScaleKind` | `DRAFT｜OPEN｜CLOSED` · `SINGLE_CHOICE｜MULTI_CHOICE｜SCALE｜TEXT` · `STAR_5｜NPS_11` |
| `SurveyResponseStatus` · `SurveyEndReason` · `SurveySkipReason` | `EXPOSED｜IN_PROGRESS｜COMPLETED｜ABANDONED` · `CANCELLED｜RETRY_EXCEEDED｜SWITCHED｜TIMEOUT｜DEFINITION_CHANGED｜CLOSED` · `NOT_FOUND｜NOT_OPEN｜OUT_OF_PERIOD｜ALREADY_RESPONDED｜EMPTY` |
| `SurveyChoiceSchema` | `{ key: uuid, label: trim 1~40 }` |
| `SurveyQuestionSchema` | `type` 판별 유니온. 공통 `{ key: uuid, prompt: 1~300, required: boolean(기본 true) }` + `SINGLE_CHOICE{ choices 2~10 }` · `MULTI_CHOICE{ choices 2~10, minSelect, maxSelect }`(`1 ≤ min ≤ max ≤ 선택지 수`) · `SCALE{ scale, lowLabel? ≤20, highLabel? ≤20 }` · `TEXT{ maxLength 1~500 = 300 }`. superRefine: 선택지 정규화 라벨 문항 내 유일 · 선택지 key 문항 내 유일 |
| `SurveyQuestionInputSchema` | 위와 같되 문항·선택지 `key` **선택**(없으면 서버 발급 — 기존 key는 반드시 보내야 유지된다) |
| `SurveySchema`(엔티티·번들) | `id·chatbotId·name·description?·status·activeFrom?·activeTo?·introMessage?·completionMessage·cancelKeywords[]·sessionTimeoutMinutes·questions[]·structureVersion·createdAt·updatedAt`. 문항 키 설문 내 유일 |
| `CreateSurveySchema` | `name·description?·activeFrom?·activeTo?`(`OffsetDateTimeSchema` — 오프셋 필수, 분 단위 정규화)`·introMessage?·completionMessage?·cancelKeywords?·sessionTimeoutMinutes?·questions`(0~20, Input). **`status`는 받지 않는다(항상 DRAFT)**. superRefine `activeFrom < activeTo` |
| `UpdateSurveySchema` | 전 필드 선택 · `description|activeFrom|activeTo|introMessage`는 `.nullable()`(삭제) · `status?` · `questions?`(**전체 교체** — 부분 수정은 순서·키 의미가 모호) · `expectedUpdatedAt?`(선택 — 동시 편집 경고용, 불일치 `409 CONFLICT`는 두지 않고 응답 메타 `stale:true`로만 알린다 — 1차 단순화) |
| `SurveyDetailSchema` | `SurveySchema` + `locked`(답 행 존재) · `responseCount`(노출 행 수) · `referencingNodeCount` · `referencingNodes: ResourceRef[] ≤5` |
| `SurveyListItemSchema` | `id·name·status·activeFrom?·activeTo?·questionCount·structureVersion·locked·referencingNodeCount·last30d{ exposed, completed }·updatedAt` — 노드 편집기 **선택기도 이 목록**을 쓴다(별도 picker 경로 없음) |
| `SurveyStatsQuerySchema` | `from`·`to`(KST `YYYY-MM-DD`) · `granularity`(`day｜week｜month`, 기본 day) · `channel?` · `includeDuplicates`(기본 false) |
| `SurveyStatsSummarySchema` · `SurveyQuestionStatsSchema` | §9.2 · §9.3 |
| `SurveyResponseListQuerySchema` · `SurveyResponseListItemSchema` | §9.5 |
| `SurveyTextAnswerListQuerySchema` · `SurveyTextAnswerItemSchema` | `questionKey`·기간·채널·`page`/`pageSize` · `{ responseNo, answeredAt, text(마스킹본) }` |
| `SurveyExportQuerySchema` | `kind: RESPONSES｜SUMMARY` + 기간(필수)·`channel?`·`includeDuplicates` |

### 4.4 `packages/shared-types/src/survey-logic.ts` 신설 — 응답 판정·출력 (zod 스키마 미사용 순수 함수)

엔진(`survey-session.ts`)·웹 편집기 미리보기·API 쓰기 가드가 **같은 1벌**을 쓴다(`api-mapping.ts` 배치 선례 — 웹은 `shared-types`만 의존). 값 import는 `normalizeText`(`./common` — ADR-0006 정규화 1곳)뿐이고 나머지는 `import type`이다. 위젯은 이 파일을 import하지 않는다.

| 함수 | 규칙 |
|---|---|
| `judgeSurveyAnswer(question, raw): SurveyJudgeResult` | `{ ok: true, value: SurveyAnswerValue } ｜ { ok: false, code: SurveyRetryCode }` — 규칙은 §5.12. **건너뛰기·취소는 판정하지 않는다**(엔진 전이 단계의 책임 — 토큰이 엔진 상수) |
| `validateSurveyAnswerValue(question, value): boolean` | **서버 재검증**(§8.3) — 선택지 key가 문항에 존재 · 중복 없음 · 개수 `min~max`(단일 = 1) · 척도 범위 정수 · 텍스트 1~`maxLength` 코드 포인트·제어문자 없음 |
| `retryGuidance(question, code): string` | 유형별 재질문 안내(요구사항 §4.4.3 예시 문구 — ui-designer 확정 전 기본값) |
| `buildSurveyQuestionOutputs(survey, index, opts?): DialogOutput[]` | 문항 출력(§5.11). `opts.withIntro`면 앞에 `introMessage` |
| `evaluateSurveyAvailability(survey \| undefined, now, completedIds, preview): { ok: true } ｜ { ok: false; reason: SurveySkipReason }` | FR-SV4-1 ①~⑤(§5.1) |
| `isSurveyLive(survey, session, now, preview): { live: true } ｜ { live: false; reason: 'CLOSED'｜'DEFINITION_CHANGED' }` | 진행 중 세션의 계속 가능 판정(구조 버전·상태·기간 — §5.3 S0 ②) |
| `npsOf(dist)` · `averageOf(dist)` | 통계 조립·편집기 미리보기 공용(§9.3) |
| `SURVEY_SKIP_BUTTON_VALUE = '건너뛰기'` · `SURVEY_STOP_BUTTON_VALUE = '그만하기'` | 제어 버튼 값. **엔진 단위 시험이 `SKIP_TOKENS.includes(SURVEY_SKIP_BUTTON_VALUE)`를 단언**한다(두 상수의 불일치 방지) |

`SurveyAnswerValue` = `{ type: 'CHOICE'; choiceKeys: string[] } ｜ { type: 'SCALE'; value: number } ｜ { type: 'TEXT'; text: string }`(TS 타입). `SurveyRetryCode` = `NOT_A_CHOICE｜TOO_FEW｜TOO_MANY｜OUT_OF_RANGE｜NOT_A_NUMBER｜EMPTY｜TOO_LONG`.

성능: 문항 1개 판정 1ms 이내(다중 10지·텍스트 500자 — NFR-SVP4) 단위 벤치.

### 4.5 엔진 계약 타입 (`packages/shared-types/src/dialogue-engine.ts`)

```ts
/** [No.27] 설문 진행 포인터 — ★ 응답 값·완료 판정·서버 발급 id 필드가 존재하지 않는다(ADR-0009 §3, S-9). */
export const SurveySessionStateSchema = z.object({
  surveyId: z.string().uuid(),
  structureVersion: z.number().int().min(1),
  /** 시작 아웃풋 위치 — 완료 후 이동 노드를 "현재 노드 정의"에서 다시 찾기 위한 포인터(§22 D-2) */
  nodeId: z.string().uuid().nullable(),
  outputIndex: z.number().int().min(0).max(9),
  questionIndex: z.number().int().min(0).max(19),
  retryCount: z.number().int().min(0).max(2),
  startedAt: z.coerce.date(),
  lastInteractedAt: z.coerce.date(),
});

export const CONVERSATION_STATE_VERSION = 1 as const;           // ★ 불변
export const ConversationStateSchema = z.object({
  version: z.literal(CONVERSATION_STATE_VERSION),
  contextSession: ContextSessionStateSchema.nullable(),
  pendingClarify: PendingClarifySchema.nullable().optional(),
  /** [No.27] 진행 중 설문(없으면 키 생략 — 기존 봉투와 바이트 동일) */
  surveySession: SurveySessionStateSchema.nullable().optional(),
  /** [No.27] 이 탭에서 완료한 설문 id(최대 20, 오래된 것부터 제거) — UX용 재노출 방지. 서버 중복 판정의 근거가 아니다 */
  completedSurveyIds: z.array(z.string().uuid()).max(20).optional(),
});
/** sanitize가 "설문 필드가 불량해도 컨텍스트 세션은 살리는" 분리 파싱에 쓰는 기반 스키마 */
export const ConversationStateBaseSchema = ConversationStateSchema.omit({ surveySession: true, completedSurveyIds: true });

export const StateDiscardReason = z.enum([ /* 기존 7종 */, 'SURVEY_STATE_INVALID', 'UNKNOWN_SURVEY', 'SURVEY_SESSION_EXPIRED' ]);

export const DialogueBundleSchema = z.object({
  /* 기존 6종 */,
  /** [No.27] 선택 — `.default([])`가 아니라 `.optional()`(§22 D-17). 엔진은 `bundle.surveys ?? []`로 읽는다 */
  surveys: z.array(SurveySchema).optional(),
});

export type SurveyAttemptRef = { surveyId: string; structureVersion: number; startedAt: Date };
export type SurveyEvent =
  | { kind: 'EXPOSED'; attempt: SurveyAttemptRef; nodeId: string | null }
  | { kind: 'ANSWERED'; attempt: SurveyAttemptRef; questionKey: string; questionIndex: number; value: SurveyAnswerValue } // ★ TEXT는 원문
  | { kind: 'SKIPPED'; attempt: SurveyAttemptRef; questionKey: string; questionIndex: number }
  | { kind: 'COMPLETED'; attempt: SurveyAttemptRef }
  | { kind: 'ABANDONED'; attempt: SurveyAttemptRef; reason: SurveyEndReason };
```
- `SurveyEvent`는 **zod가 아니라 TS 타입**이다 — API 응답으로 직렬화되지 않는 엔진 내부 계약이며(`SemanticMatchInput` 선례), 소비자는 공개 대화 1곳이다.
- ★ `ANSWERED.value`의 TEXT는 **원문**이다(`ApiStepResult.variables` 경고 주석 선례 `api-call.ts:89`). trace·로그·공개 응답·시뮬레이터 응답에 싣지 않으며, 저장 전 마스킹은 `SurveyResponseService`의 책임이다(§8.4).
- `TraceStageEnum`에 `'SURVEY'`. `TraceCodeEnum`에 7종: `SURVEY_STARTED`(targetId = surveyId, targetName = 설문명) · `SURVEY_ANSWERED`(targetId = questionKey, message = 순번) · `SURVEY_RETRY`(message = `SurveyRetryCode`｜`REQUIRED`) · `SURVEY_SKIPPED_QUESTION` · `SURVEY_COMPLETED` · `SURVEY_ABANDONED`(message = 사유) · `SURVEY_SKIPPED`(targetId = surveyId, message = `SurveySkipReason`). **trace에 응답 값을 넣지 않는다**(FR-0-111).
- `DesignIssueCode`에 6종(§5.9). `FlowNode.via`·`FlowNodeSchema`에 `'SURVEY_COMPLETE'`.
- **`SURVEY_SKIPPED`는 `judgeAnswered`의 폴백 코드(`conversation-log.ts:5`)에 넣지 않는다**(FR-SV4-4).

### 4.6 기타 shared-types 확장

| 파일 | 추가 |
|---|---|
| `conversation.ts` | `SimulateRequestSchema`에 `surveyPreview: z.boolean().default(false)` · `SimulateResponseSchema`에 `surveyStep: SurveyStepViewSchema.optional()`. `SurveyStepViewSchema = { surveyId, surveyName, questionIndex?, questionCount, outcomes: ('STARTED'｜'ANSWERED'｜'RETRY'｜'SKIPPED_QUESTION'｜'COMPLETED'｜'ABANDONED'｜'NOT_STARTED')[], reason?, preview: boolean, saved: false }` — **판정 값 필드가 없다**(FR-SV9-3) |
| `validation.ts` | TC 결과 스키마에 `surveyPreviewA`·`surveyPreviewB`(boolean) |
| `version.ts` | `RestoreWarningSchema`에 `{ code:'SURVEY_MISSING', count }`·`{ code:'SURVEY_NOT_OPEN', count }`·`{ code:'SURVEY_LEGACY_FORMAT', count }` · 무결성 경고 코드 `BROKEN_REFERENCE_NODE_SURVEY` |
| `audit.ts` | `AuditTargetType`에 `'Survey'`(라벨 `'설문'`, 16 → 17종). `AuditAction` 추가 0 |
| `common.ts` | `ApiErrorCode` 4종(§13.3) |
| `index.ts` | `export * from './survey'` · `export * from './survey-logic'` |

---

## 5. 엔진 변경 명세 (`packages/dialogue-engine`)

### 5.1 계약 — `src/survey-session.ts`(신규)

```ts
export interface SurveyTurnContext {            // resolveTurn이 sanitize 결과로 채워 ResolveOptions.surveyState로 넘긴다(@internal)
  session: SurveySessionState | null;
  completedSurveyIds: readonly string[];
  preview: boolean;
}
export interface SurveyTurnOutcome {            // EngineResolution.survey (@internal) — resolveTurn이 DialogueTurnResult로 풀어 쓴다
  nextSession: SurveySessionState | null;
  completedSurveyIds: string[];
  events: SurveyEvent[];
  consumedInput: boolean;                       // → surveyTurn
}
export function startSurveySession(survey: Survey, nodeId: string | null, outputIndex: number, now: Date):
  { session: SurveySessionState; outputs: DialogOutput[]; event: SurveyEvent };        // intro + Q1, EXPOSED
export type SurveyAdvance =
  | { kind: 'CONSUMED'; outputs: DialogOutput[]; nextSession: SurveySessionState | null; events: SurveyEvent[]; completed: boolean; trace: TraceStep[] }
  | { kind: 'RELEASED'; carry: DialogOutput[]; events: SurveyEvent[]; trace: TraceStep[] };   // 종료 안내 + 이번 입력은 일반 대화로
export function advanceSurveySession(session, input: { raw: string; norm: string }, survey: Survey, now: Date, preview: boolean): SurveyAdvance;
/** API 계층의 의미 점수 생략 판단용(§7.1 ③.5) — sanitize 후 "이번 입력을 설문이 소비할 것인가". 취소어는 고려하지 않는다(소비로 본다). */
export function willSurveyConsumeInput(rawState: unknown, bundle: DialogueBundle, now: Date, preview?: boolean): boolean;
```

**참여 가능 판정**(`evaluateSurveyAvailability` — FR-SV4-1): ① `bundle.surveys`에 id 존재(없으면 `NOT_FOUND`) ② 문항 ≥ 1(`EMPTY`) ③ `status === 'OPEN'`(`NOT_OPEN`) — `preview`면 무시 ④ `activeFrom ≤ now < activeTo`(지정된 쪽만 · `OUT_OF_PERIOD`) — `preview`면 무시 ⑤ `completedSurveyIds`에 없음(`ALREADY_RESPONDED`) — **`preview`여도 적용**(같은 탭 재노출 방지는 UX 규약이며 TC에서도 봉투를 이어 가므로 결정적이다). 판정 순서 = ①②⑤③④(`NOT_FOUND`·`EMPTY`는 설계 결함, `ALREADY_RESPONDED`는 사용자에게 가장 구체적인 안내).

### 5.2 `executeOutputs` 변경 (`outputs.ts`)

| 옵션/반환 | 의미 | 기본값(= 기존 동작) |
|---|---|---|
| `survey?: { completedSurveyIds: readonly string[]; preview: boolean }` | 참여 가능 판정 입력 | `{ [], false }` |
| 반환 `surveyStarted?` | `{ session, event: EXPOSED }` | — |
| 반환 `surveySkips?` | 이번 실행에서 건너뛴 사유 목록(0건 폴백 문구 선택용) | — |

`SURVEY` 분기(`outputs.ts:180-184`의 `SURVEY` 케이스 분리):
1. `!isSurveyV2(payload)` → **기존과 동일**(`unsupported.push` + `UNSUPPORTED_OUTPUT` trace) — v1 바이트 동일(AC-SV1-1).
2. v2 & 참여 불가 → `trace(SURVEY, SURVEY_SKIPPED, targetId=surveyId, message=reason)` → `surveySkips.push(reason)` → **다음 아웃풋 계속**(FR-SV4-3).
3. v2 & 참여 가능 → 진행 중 컨텍스트 세션(`existingSession?.status === 'IN_PROGRESS'`)이면 `SESSION_SWITCH_MESSAGE` + `SESSION_CANCELLED` trace(`CONTEXT_FORM`과 같은 코드 — FR-SV4-2) → `startSurveySession(survey, item.nodeId || null, item.index, now)` → `out.push(...outputs)` → `trace(SURVEY_STARTED)` → `surveyStarted = …` → **`break outer`**(뒤 아웃풋 미실행 — 종결자 규약).

0건 폴백(`outputs.ts:221-224`): `unsupported.length > 0` → 기존 `UNSUPPORTED_OUTPUT_NOTICE`(**우선순위 불변**) · 그 외 `surveySkips`가 있으면 → `ALREADY_RESPONDED`가 하나라도 있으면 `SURVEY_ALREADY_RESPONDED_NOTICE`, 아니면 `SURVEY_UNAVAILABLE_NOTICE` · 그 외 기존 `DEFAULT_FALLBACK_RESPONSE`. `EMPTY_OUTPUT` trace는 그대로 남긴다(폴백 코드 아님 → `isAnswered=true` — AC-SV2-9).

### 5.3 `resolver.ts` 변경

**`ResolveOptions` 추가**: `surveyPreview?: boolean`(공개 — 시뮬레이터 토글·TC·비교) · `surveyState?: SurveyTurnContext`(@internal — `resolveTurn`이 채운다. 미지정 = 세션 없음·완료 목록 빈 배열). **`EngineResolution` = `DialogueResolution & { apiCall?; survey?: SurveyTurnOutcome }`**.

**S0 — 설문 세션**(S1 앞. 두 세션은 동시에 진행되지 않으므로 순서는 의미가 없고, sanitize가 상호 배타를 강제한다 — §6.3 ⑤):
```
전제: norm ≠ ''(빈 입력은 기존 EMPTY_INPUT 조기 반환 — 설문 상태는 resolveTurn이 그대로 이월)
s = options.surveyState?.session;  survey = bundle.surveys?.find(id)   (sanitize가 존재를 보장)
pending이 있으면 CLARIFY_DISCARDED('설문 우선') 후 버린다(S1과 같은 규칙)
① 취소: norm이 설문 cancelKeywords(정규화) 또는 SURVEY_STOP_BUTTON_VALUE와 **전체 일치**(§22 D-3)
      → ABANDONED(CANCELLED) + SURVEY_CANCEL_MESSAGE · CONSUMED · 반환
② 계속 불가: isSurveyLive → CLOSED(상태≠OPEN 또는 activeTo ≤ now, preview면 무시) | DEFINITION_CHANGED(구조 버전 불일치)
      → ABANDONED(사유) · carry = [SURVEY_CHANGED_NOTICE] · RELEASED → S1.5 이후 일반 경로로 계속(FR-SV4-12)
③ 타임아웃: now − lastInteractedAt > sessionTimeoutMinutes
      → ABANDONED(TIMEOUT) · carry = [SURVEY_TIMEOUT_NOTICE] · RELEASED → 일반 경로로 계속
④ 건너뛰기: norm ∈ SKIP_TOKENS(엔진 상수 — 건너뛰기 버튼 값 포함)
      - 선택 문항 → SKIPPED 이벤트 → 다음 문항 | 완료
      - 필수 문항 → 재질문(SURVEY_REQUIRED_PROMPT + 문항 재출력), retry+1(초과 시 ⑤-b)
⑤ 판정: judgeSurveyAnswer(question, raw)
      a. ok → ANSWERED(value) → 다음 문항 | 완료
      b. 실패 → retry+1 > SURVEY_MAX_RETRY(2) → ABANDONED(RETRY_EXCEEDED) + SURVEY_RETRY_LIMIT_MESSAGE
               아니면 retryGuidance + 같은 문항 재출력(문항 TEXT·버튼 포함 — 버튼이 다시 보여야 한다)
⑥ 다음 문항: questionIndex+1 · retry 0 · lastInteractedAt = now → buildSurveyQuestionOutputs(next)
⑦ 완료(마지막 문항 처리 후): outputs += [completionMessage] · COMPLETED · completedSurveyIds = push(dedupe, 20 초과 시 앞에서 제거)
      · 세션 null · 완료 후 이동(§5.3.1)
CONSUMED 결과는 즉시 반환한다(matchedNodeId = 완료 후 이동 노드가 실행됐으면 그 노드, 아니면 undefined — 응답출처 OTHER).
```

#### 5.3.1 완료 후 이동 (`onCompleteNodeId`)
- **포인터로 현재 정의를 다시 찾는다**: `node = bundle.dialogNodes.find(id === s.nodeId)`, `o = node?.outputs[s.outputIndex]`. `o`가 v2 `SURVEY`이고 `o.payload.surveyId === s.surveyId`이며 `onCompleteNodeId`가 있으면 그 노드를 실행한다. 조건 불충족(노드 편집으로 위치가 바뀜 등) → 이동 없이 완료 문구로 끝낸다(조용한 오작동보다 안전).
- 대상 없음·비활성 → `trace(OUTPUT, BROKEN_REFERENCE, targetId)` + 완료 문구로 종료(FR-SV4-9 · EX-SV-16).
- 대상 있음 → `executeOutputs(target.outputs, bundle, now, { sourceNodeId: target.id, initialHops: 1, hopLimit, survey: { completedSurveyIds: 갱신본, preview }, existingSession: 원본 컨텍스트 세션(= null — 상호 배타) })`. 대상이 **또 설문을 시작**할 수 있다(EX-SV-19 — 새 `EXPOSED`), **컨텍스트 폼을 시작**할 수 있다(다음 컨텍스트 세션), **v2 `API_CONDITION`에서 정지**할 수 있다 → `buildSuspendedResolution`에 설문 이월분(§5.6)을 동봉한다.

#### 5.3.2 기존 실행 지점 3곳 (S3 노드 · S6 폴백 노드 · `resolveByNodeId`)
- `executeOutputs` 호출에 `survey: { completedSurveyIds: 현재 목록, preview }`를 전달하고, 결과의 `surveyStarted`를 `EngineResolution.survey`로 싣는다(`{ nextSession: started.session, completedSurveyIds, events: [...앞 이벤트, started.event], consumedInput: false }`).
- S0이 **RELEASED**로 끝난 턴은 앞 이벤트(`ABANDONED(TIMEOUT｜CLOSED｜DEFINITION_CHANGED)`)를 들고 일반 경로를 탄다 — 매칭 노드가 새 설문을 시작하면 이벤트가 `[ABANDONED, EXPOSED]`가 된다.
- **`resolveByNodeId`**(버튼 `NODE`): 설문 세션이 있으면 **먼저** `ABANDONED(SWITCHED)` 이벤트 + `SURVEY_ABANDONED` trace(FR-SV4-11 — 기존 컨텍스트 `CANCELLED` 처리 `resolver.ts:597-603`과 같은 위치), 세션 null로 두고 노드를 실행한다. 이 턴은 `consumedInput = false`(사용자가 설문에 답한 것이 아니라 다른 흐름을 골랐다 — 질문 순위에는 버튼 라벨이 들어가지만 `BUTTON_NODE`는 이미 미응답 수집 제외 대상이다).
- 정지(`execResult.suspended`) 시 `buildSuspendedResolution`에 `survey` 이월분을 추가 인자로 넘긴다(§5.6).

### 5.4 `turn.ts` — 다음 상태 조립 (키 생략 규칙)

```
sanitized = sanitizeConversationState(state, bundle, now, …)            // §6.3 — surveySession·completedSurveyIds 포함
options' = { ...options, surveyState: { session: sanitized.surveySession, completedSurveyIds: sanitized.completedSurveyIds, preview: options.surveyPreview ?? false } }
resolution = (NODE 버튼 ? resolveByNodeId : resolveResponse)(…, options')
[정지 시] 기존 폴백 동봉 경로 — resumeAfterApiCall이 설문 필드까지 조립(§5.6)
s = resolution.survey
nextSurveySession  = s ? s.nextSession        : sanitized.surveySession        // 설문이 관여하지 않은 턴(빈 입력 등)은 그대로 이월
nextCompletedIds   = s ? s.completedSurveyIds : sanitized.completedSurveyIds
nextState = {
  version: 1, contextSession, pendingClarify,
  ...(nextSurveySession ? { surveySession: nextSurveySession } : {}),         // ★ 없으면 키 자체를 넣지 않는다
  ...(nextCompletedIds.length > 0 ? { completedSurveyIds: nextCompletedIds } : {}),
}
반환: { ...resolution(survey 제외), trace, nextState, stateDiscarded,
        ...(s && (s.events.length > 0 || s.consumedInput) ? { surveyEvents: s.events, surveyTurn: s.consumedInput } : {}) }
```
- **바이트 동일 보장(FR-0-107)**: 설문 필드가 없는 봉투 + 설문 아웃풋이 없는 번들이면 `s`가 없고 두 키가 생략되어 `nextState`가 기존과 같은 3키다. `surveyEvents`·`surveyTurn` 키도 생략된다(`undefined` 대입이 아니라 **키 부재** — `toStrictEqual`·JSON 직렬화 모두 동일).
- `resolution.survey`는 `DialogueTurnResult`에 **싣지 않는다**(@internal — 스프레드 전에 구조 분해로 제거).

### 5.5 설문 이벤트의 결정성

엔진은 `now`만으로 시각을 정한다(`startedAt = lastInteractedAt = now`). 같은 입력·봉투·번들·`now`면 이벤트·출력·다음 상태가 같다(TC 결정론의 전제 — AC-SV6-3). 난수·`Date.now()` 0건(L-5).

### 5.6 `resumeAfterApiCall` 이월 (`api-call.ts` — FR-SV4-15, 숨은 결함 ②)

현재 `api-call.ts:237-238`은 다음 상태를 `{ version, contextSession: nextSession, pendingClarify: null }`로 **새로 조립**해, 봉투에 설문 필드가 생기면 API 분기 턴에서 **`completedSurveyIds`가 사라지고**(재노출 방지 소실) 분기 노드가 시작한 설문 세션도 버려진다.

- `ApiResumeState`에 `survey: { ctx: SurveyTurnContext(갱신된 완료 목록·preview), eventsSoFar: SurveyEvent[], consumedInput: boolean, sessionFallback: SurveySessionState | null }` 추가 — `buildSuspendedResolution`의 세 호출부와 S0 완료 후 이동 경로가 채운다.
- 분기 노드 실행(`api-call.ts:219-226`)에 `survey: { completedSurveyIds: ctx.completedSurveyIds, preview: ctx.preview }`를 전달한다. **`preview`가 `options`가 아니라 `resumeState`에 있는 이유**: 실제 호출부(`legacy-api.service.ts:153·194`, `common/lib/api-turn.ts:31·36`)가 `options` 없이 `resumeAfterApiCall`을 부르므로, 옵션으로만 전달하면 TC의 목 완결에서 미리보기 판정이 사라진다(호출부 수정 0으로 이월).
- 다음 상태: `§5.4와 같은 키 생략 규칙`으로 `surveySession = exec.surveyStarted?.session ?? survey.sessionFallback`, `completedSurveyIds = ctx.completedSurveyIds`. 반환에 `surveyEvents = [...eventsSoFar, ...(exec.surveyStarted ? [exec.surveyStarted.event] : [])]`·`surveyTurn = consumedInput`(이벤트·소비가 없으면 두 키 생략).
- 설문 필드가 없는 API 턴의 `nextState`는 기존 3키 그대로다(AC-L3-13 무회귀).

### 5.7 `mergeOverlay` 설문 이월 (`overlay.ts:44-53` — 숨은 결함 ⑤, 신규 발견)

`mergeOverlay`는 6종 키만 가진 **새 객체**를 반환해 `bundle.surveys`를 버린다. 오버레이를 쓰는 시뮬레이터(`simulation.service.ts:77-81`)와 TC B측(`test-run.executor.ts:160·163`)에서 v2 설문이 전부 `NOT_FOUND`로 건너뛰어진다. **`...(bundle.surveys ? { surveys: bundle.surveys } : {})`를 이월**한다(설문 정의 오버레이는 1차 미지원 — EX-SV-27 · 키 생략 규칙으로 설문 없는 번들의 결과 객체 불변).

### 5.8 참조 무결성 편입 (J-20)

```ts
export function getOutgoingNodeRefs(node: DialogNode): { moveTargets; buttonTargets; apiTargets; surveyTargets: string[] };
// surveyTargets = v2 SURVEY의 onCompleteNodeId (v1은 노드를 참조하지 않는다)
```
| 지점 | 변경 | 결과 |
|---|---|---|
| ① 저장 검증 `dialog-nodes.service.ts:113-144` | `onCompleteNodeId`를 `nodeTargetRefs`에 합류(필드 `outputs.{i}.payload.onCompleteNodeId`) · v2 `surveyId`는 같은 챗봇 `survey.findMany` 1회로 검사(필드 `outputs.{i}.payload.surveyId`) | 끊긴 참조·타 챗봇 설문 `404 INVALID_REFERENCE`(AC-SV1-5) |
| ② 노드 삭제 409 `reference-check.service.ts:146-147` | `surveyTargets` 합류 | `409 NODE_IN_USE`(AC-SV1-6) |
| ③ `computeIncomingCounts`(:33-42)·끊긴 참조(:362-374)·고아(:388-399)·흐름 트리 | 네 배열 합산 · 흐름 `via: 'SURVEY_COMPLETE'` | 완료 후 이동으로만 참조되는 노드는 고아가 아니다 |
| ④ 스냅샷 무결성 `snapshot-integrity.ts:83-101` | `BROKEN_REFERENCE_NODE_SURVEY` 경고 | — |
| (노드 → 설문) | 설문 삭제 `409 SURVEY_IN_USE`(현재 노드만 — 스냅샷 참조는 막지 않음) · 복원 미리보기 `SURVEY_MISSING` 경고 | FR-SV2-7 · FR-SV10-3 |

- 설문 아웃풋이 없는 번들에서 네 배열 합은 기존과 같다 → 들어오는 참조 수·고아·흐름·경고 **불변**.
- 순환 검사(`findMoveCycles`)는 `DIALOG_MOVE` 전용 그대로 — 완료 후 이동은 hop 1로 세고 `HOP_LIMIT` 10을 공유한다.

### 5.9 설계 점검 (`design-validator.ts` — FR-SV1-4 · FR-SV3-3, 숨은 결함 ①)

**미지원 판정 교체(402~404행)**: 현재 코드는 `UNSUPPORTED_OUTPUT_TYPES`를 **직접** 본다. 상수에서 `SURVEY`를 빼는 순간 v1 `SURVEY`의 INFO가 조용히 사라진다. 교체식:
```ts
const unsupportedTypes = node.outputs.filter((o) => isUnsupportedOutput(o) && o.type !== 'API_CONDITION').map((o) => o.type);
```
`API_CONDITION`을 빼는 이유: 단순히 `isUnsupportedOutput()`으로 바꾸면 **v1 `API_CONDITION`이 이 INFO에 다시 나타나** No.26 설계(§5.9 ④ "기존 INFO에서 v1은 빠진다 — `API_LEGACY_FORMAT`이 대신 보고")를 회귀시킨다(§22 D-12). 결과: `SCENARIO`·v1 `SURVEY`는 기존 문구 그대로 INFO(바이트 동일), v2 `SURVEY`는 INFO 대상이 아니다.

**신규 항목 6종**(번들의 `surveys`로 판정 — 추가 조회 0, 엔진 순수성 유지):

| # | 코드 | 심각도 | 조건 |
|---|---|---|---|
| ① | `SURVEY_OUTPUT_NOT_LAST` | WARNING | v2 `SURVEY` 뒤에 아웃풋 있음 — "설문이 시작되면 뒤 아웃풋은 실행되지 않습니다(설문을 진행할 수 없을 때만 실행됩니다)" |
| ② | `SURVEY_TERMINATOR_CONFLICT` | ERROR | 한 노드에 v2 `SURVEY` 2개 이상, 또는 v2 `SURVEY` + `CONTEXT_FORM` — "첫 종결자만 의미가 있습니다"(EX-SV-17) |
| ③ | `SURVEY_NOT_AVAILABLE` | WARNING | 참조 설문이 `DRAFT`/`CLOSED`이거나 `activeTo` 경과(점검 시각 기준) |
| ④ | `SURVEY_ONLY_OUTPUT` | INFO | 노드 출력이 v2 `SURVEY`뿐 — "설문을 진행할 수 없을 때 고정 안내 문구가 나갑니다" |
| ⑤ | `SURVEY_LEGACY_FORMAT` | WARNING | v1 형식 — "이전 형식 설문 연결입니다 — 설문을 선택해 전환하세요"(기존 INFO와 **함께** — AC-SV1-3) |
| ⑥ | `SURVEY_EMPTY` | ERROR | 참조 설문의 문항 0개 |
| ⑦ | `BROKEN_REFERENCE`(기존 코드) | ERROR | `surveyId`가 번들에 없음("존재하지 않는 설문") |

### 5.10 고정 문구 (`constants.ts` — 내부 용어 금지, FR-0-116)

- `SURVEY_ALREADY_RESPONDED_NOTICE = '이미 설문에 참여해 주셨어요. 감사합니다.'`
- `SURVEY_UNAVAILABLE_NOTICE = '지금은 참여할 수 있는 설문이 없어요.'`
- `SURVEY_CANCEL_MESSAGE = '설문을 마칠게요. 참여해 주셔서 감사합니다.'`
- `SURVEY_RETRY_LIMIT_MESSAGE = '입력 횟수를 초과해 설문을 마칠게요. 궁금한 점을 입력해 주세요.'`
- `SURVEY_TIMEOUT_NOTICE = '설문 참여 시간이 지나 설문을 마쳤어요.'`
- `SURVEY_CHANGED_NOTICE = '설문이 변경(종료)되어 진행을 마쳤어요.'`
- `SURVEY_REQUIRED_PROMPT = '이 질문은 꼭 답해 주세요.'` · `SURVEY_MAX_RETRY = 2`
- 문구는 ui-designer가 바꿀 수 있으나 **상수 1곳**에서만 바꾼다. 설문 문구·완료 문구에 **치환을 하지 않는다**(`{...}` 문자 그대로 — EX-SV-28, 응답 값 재노출 경로 0 — NFR-SVS7).

### 5.11 문항 출력 규격 (`buildSurveyQuestionOutputs` — FR-SV4-8, 위젯 변경 0)

- **TEXT 1개**: `"{n}/{N} {prompt}"` + 줄바꿈 + 유형별 입력 안내(다중 선택 = "여러 개면 번호를 쉼표로 입력해 주세요 (예: 1,3)", 척도 = 양끝 라벨 병기). 선택 유형은 **번호가 붙은 선택지 목록을 TEXT에 포함할지 여부**를 ui-designer가 정한다(FR-SV12-5 — 텍스트 전용 채널 격하 대비). 길이 상한: 문구 300 + 안내 ≤150 + 목록 ≤10×45 < `TextOutputPayloadSchema` 1,000자.
- **BUTTON 블록**: 버튼 목록 = 선택지(또는 척도 값) → 선택 문항이면 `건너뛰기` → 항상 `그만하기`. **5개 단위로 잘라 최대 3블록**(선택지 10 + 2 = 12 → 5·5·2, NPS 11 + 2 = 13 → 5·5·3). `slice(0,5)` 절단 없음(AC-SV2-13). 각 블록 `text`는 생략(문항 TEXT가 앞에 있다 — 그룹 레이블 연결은 ui-designer 확인, NFR-SVA4).
- 버튼 `MESSAGE` 값: 단일 = 선택지 라벨 · 다중 = 선택지 라벨(버튼 1회 = 1개 선택) · 척도 = `"{v}점"`(STAR_5) / `"{v}"`(NPS_11) · 제어 = `건너뛰기`/`그만하기`. 버튼 라벨: 다중 선택은 `"{번호}. {라벨}"`을 **40 코드 포인트로 자르고 `…`**(라벨 상한 40 — `dialogue.ts:441`, 값은 자르지 않은 라벨), 척도 양끝은 `"1점 매우 불만족"`처럼 라벨 병기(별 기호 단독 금지 — NFR-SVA4).
- 자유 텍스트 문항은 선택지 버튼이 없다(제어 버튼만).

### 5.12 응답 판정 규칙 (`judgeSurveyAnswer` — 모두 `normalizeText()` 후 비교, FR-SV4-6)

| 유형 | 규칙 | 실패 코드 |
|---|---|---|
| `SINGLE_CHOICE` | ① 정규화 라벨 **전체 일치** → 그 선택지(라벨이 숫자여도 라벨 우선) ② `^(\d{1,2})\s*(번)?\.?$` → 1부터 번호 | `NOT_A_CHOICE` |
| `MULTI_CHOICE` | ① 전체 입력이 라벨 1개와 일치 → [그것] ② 구분자 `[,，、·]`로 분할(분할 결과가 1개이고 `^\d+(\s+\d+)+$`이면 공백 분할) → 각 토큰 = 번호(`번`·`.` 허용) 또는 라벨 전체 일치 ③ 해석 불가 토큰 1개라도 있으면 실패 ④ 중복 제거 후 `minSelect ≤ n ≤ maxSelect`. **공백은 라벨 안에 있을 수 있으므로 기본 구분자가 아니다** | `NOT_A_CHOICE`·`TOO_FEW`·`TOO_MANY` |
| `SCALE` | `^★?\s*(-?\d{1,2})\s*(점)?` 로 **선두 정수**만 취함("4점 만족"·버튼 라벨 허용) → 범위(STAR_5 1~5 / NPS_11 0~10) | `NOT_A_NUMBER`·`OUT_OF_RANGE` |
| `TEXT` | 원문 `raw`를 trim·제어문자 제거 → 1자 이상 · `maxLength` 이하(**코드 포인트**, 초과는 재질문 — 자르지 않는다) | `EMPTY`·`TOO_LONG` |

- 판정 결과는 **정규화된 값**(선택지 key 배열 — 선택지 순서로 정렬 · 정수 · 정제 텍스트)이다.
- 이전 문항의 버튼을 다시 눌러도 **현재 문항 기준으로만** 판정한다(EX-SV-9 — 위젯 변경 없이 완화, 수용).

---

## 6. 상태 스키마 (대화 상태 봉투)

### 6.1 봉투 필드 (버전 1 유지 — `pendingClarify` 선택 필드 선례, ADR-0009 결정 1)

| 필드 | 담는 것 | 담지 않는 것 |
|---|---|---|
| `surveySession?` | 설문 id · 구조 버전 · 시작 노드 id·아웃풋 위치 · 문항 순번 · 재시도 수 · 시작/마지막 시각 | **응답 값(선택지·점수·텍스트)** · 완료 여부 · 응답 행 id 등 **서버 발급 id** · 설문 문구 |
| `completedSurveyIds?` | 이 탭에서 완료한 설문 id(≤20) | 완료 시각·응답 번호 |

### 6.2 불변식 (ADR-0009 §3 "사용자가 직접 입력해도 같은 결과가 되는 값")

- 봉투의 모든 값은 **사용자가 차례로 답하면 도달하는 값**이다. 문항 순번을 올리는 조작 = "앞 문항을 건너뛴 것"과 같은 결과이고 서버가 `missingRequiredCount`로 드러낸다. `completedSurveyIds` 삭제 = "새 탭에서 다시 시작"과 같은 결과이고 서버가 `isDuplicate`로 드러낸다. 재시도 수 초기화 = 재시도를 더 얻는 것뿐이다.
- **응답 데이터의 신뢰 근거는 봉투가 아니라 서버**다 — 값은 그 턴 입력의 엔진 판정 결과이고, 서버가 행·상태·구조 버전·순서·값을 재검증한다(§8.2~§8.3).
- 두 세션은 동시에 진행되지 않는다 — `contextSession.status === 'IN_PROGRESS'`와 `surveySession`이 함께 있으면 sanitize가 설문 쪽을 폐기한다(§6.3 ⑤).

### 6.3 `sanitizeConversationState` 규칙 (FR-SV4-14 — 폐기 사유 enum은 추가만)

| # | 검사 | 실패 처리 |
|---|---|---|
| ① | **분리 파싱** — `raw`에서 `surveySession`·`completedSurveyIds`를 떼어 기반 스키마(`ConversationStateBaseSchema`)로 기존 검사를 그대로 수행하고, 두 필드는 각자 스키마로 따로 파싱 | 기반 실패 = 기존 `INVALID_SCHEMA`(전체 폐기 — 기존 동작) · 설문 필드만 실패 = **그 필드만** 폐기 + `SURVEY_STATE_INVALID`(컨텍스트 세션은 살린다) |
| ② | `completedSurveyIds` 20개 초과·UUID 아님 | 필드 폐기 + `SURVEY_STATE_INVALID`(①에 포함) |
| ③ | `surveySession.surveyId`가 **이 챗봇 번들**에 없음(교차 챗봇 방어 — ADR-0009 근거 59행) | 폐기 + `UNKNOWN_SURVEY` |
| ④ | `questionIndex ≥ 번들 설문 문항 수` · `outputIndex` 범위 밖 | 폐기 + `SURVEY_STATE_INVALID` |
| ⑤ | 컨텍스트 세션 `IN_PROGRESS`와 동시 존재(정상 경로에서 생기지 않음 — AC-SV2-11) | 설문 세션 폐기 + `SURVEY_STATE_INVALID` |
| ⑥ | `startedAt`이 미래(+5분 허용오차 초과) 또는 24시간 초과 | 폐기 + `SURVEY_SESSION_EXPIRED` |
| ⑦ | `lastInteractedAt` 미래 | 폐기가 아니라 `now`로 보정(기존 규칙 6과 같음) |
| — | **구조 버전 불일치·마감·기간 종료** | **폐기하지 않는다** — 엔진 S0 ②가 종료 안내를 낸다(사용자에게 이유를 알린다) |

- 크기: 두 필드는 스키마 상한으로 수백 바이트 이내이며 기존 16KB 상한 판정(컨텍스트 세션 대상)은 불변이다.
- 폐기 사유가 하나라도 있으면 공개 응답 `stateReset: true`(기존 규약) — 24시간 만료 후 위젯이 "새 대화" 안내를 보이는 것은 기존 컨텍스트 세션과 같다.

### 6.4 위변조 대응표 (요구사항 §1.3.3 → 설계 위치)

| 위협 | 1차(엔진·sanitize) | 2차(서버 쓰기 가드 — §8.2) | 남는 위험 |
|---|---|---|---|
| 응답 값 조작 | 봉투에 값 필드 없음(S-9 런타임 단언) | 값 재검증 ⑦ | 없음 |
| 문항 건너뛰기 | 순번 범위 검사 ④ | 순서 증가 ⑤ · 완료 시 필수 누락 수 | "누락 있는 완료"로 남음(구분 표시) |
| 노출 안 된 설문에 응답 | 번들 존재 ③ | 행 존재 ① | 없음 |
| 타 챗봇 설문 | 번들 경계 ③ | 쓰기 키에 `chatbotId` | 없음 |
| 타 세션 행에 쓰기 | — | 쓰기 키 = `(chatbotId, sessionId, surveyId, startedAt)` — 서버 발급 id를 봉투에 두지 않음 | `sessionId` 탈취(XSS) — 위젯 저장소 격리 기존 규약 |
| 리플레이 | — | 순서 증가 ⑤ + 답 행 유일 ⑥ | 없음 |
| 재응답(완료 목록 삭제) | — | 노출·완료 시점 `isDuplicate` | 행은 남는다(삭제 경로 0) |
| 거대 배열·미래 시각 | ②·⑥ | — | 없음 |
| 표 부풀리기(새 `sessionId`) | — | 공개 레이트리밋(세션 30/분·IP 120/분) | **근본 차단 불가 — 수용**(P-7) |

---

## 7. 소비자 통합

### 7.1 공개 대화 (`public-conversation.service.ts`)

```
②.5 입구 금지어(불변) — BLOCK이면 엔진 미호출·봉투 그대로 반환(:109-116). 봉투 스키마가 설문 필드를 알므로 설문 진행도 보존된다(AC-SV2-14)
③  bundle/settings/now(불변)
③.5 [신규] surveyExpected = willSurveyConsumeInput(inbound.state, bundle, now)
      → true면 semantic 점수 계산을 생략한다(설문 답 "4점"에 임베딩 1회·질의 LRU 캐시 오염을 쓰지 않는다 — §22 D-14)
④  resolveTurn(turnInput, inbound.state, bundle, now, { index, semantic })          (옵션 surveyPreview 없음 = 실제 상태·기간)
    → messageId = randomUUID()(불변 위치)
④.5 legacyApi.completeTurn(불변 — 설문 필드는 resumeAfterApiCall이 이월, §5.6)
④.6 [신규] if (result.surveyEvents?.length) await surveyResponses.apply(result.surveyEvents, {
          chatbotId, groupId: chatbot.groupId(추가 조회 0), sessionId: dto.sessionId, channelType: 'WEB',
          conversationLogId: messageId, now, bundle })
      ─ apply()는 예외를 던지지 않는다(§8.5). 설문 턴만 await(순서 보장 — 다음 턴 가드가 이 턴의 적재를 전제)
⑤  renderOutbound → ⑤.5 maskOutbound(불변 — 설문 문구·완료 문구도 예외 없이 통과, FR-SV5-10)
⑦  RAG 판정: apiTurn || result.surveyTurn === true → false (shouldRunRag 입력 surveyTurn — §22 D-15)
⑩  record({ …, surveyTurn: result.surveyTurn === true })   (fire-and-forget, 불변)
```
- **설문이 없는 턴**: `willSurveyConsumeInput`은 봉투에 `surveySession` 키가 없으면 즉시 false, `surveyEvents` 유무 분기 1개 — 추가 조회 0(NFR-SVP1).
- `ConversationLog`: 설문 턴의 `userMessage`는 기존대로 마스킹본(대화로그를 `[설문 응답]`으로 가리지 않는다 — 요구사항 §1.4). `surveyTurn=true`인 턴은 `isAnswered=true`·`matchedNodeId` 없음 → 응답출처 `OTHER`(분류 무변경). 설문 고정 문구 턴(§5.2)은 노드 매칭 턴이라 `isAnswered=true`이고 RAG 조건(`!judgeAnswered`)에 걸리지 않는다.
- ⚠ **순서**: ④.6은 RAG 분기(⑦)보다 **앞**이다 — 타임아웃 후 일반 처리된 턴이 RAG로 넘어가도 그 턴의 `ABANDONED(TIMEOUT)` 이벤트는 이미 적재된다.

### 7.2 시뮬레이터 (`simulation.service.ts`)

- `resolveTurn(…, { index, semantic, surveyPreview: dto.surveyPreview })`. `③.5`와 같은 의미 점수 생략(공개 경로와 같은 판단 재적용).
- **`SurveyResponseService`를 주입하지 않는다** — 적재 호출 코드가 없고 모듈 import도 없다(S-6). VIEWER(`simulation:read`)가 완주해도 응답·답 행 0건(AC-SV6-1).
- 응답 `surveyStep`(`simulation/lib/survey-step.ts` 순수 함수): 이번 턴 trace의 `SURVEY` 단계 + `surveyEvents`에서 설문 id·순번·결과 목록·사유·`preview`·`saved: false`를 만든다. **판정 값을 싣지 않는다**(FR-SV9-3 — 원문 재노출 경로를 만들지 않는다). 설문명은 번들에서 해석.
- 오버레이로 넣은 새 `SURVEY` 노드는 **저장된 설문만** 참조할 수 있다(EX-SV-27 — `mergeOverlay`가 번들 설문을 이월, §5.7).

### 7.3 비교 실행 (`compare()` :336·:340)

A·B 두 `resolveTurn` 호출에 `surveyPreview: true`를 넣는다 — 날짜·상태와 무관하게 결정적(FR-SV9-4). 적재 없음.

### 7.4 TC 대량 실행 (`test-run.executor.ts`)

- `runSide`의 `resolveTurn`(:436)에 `surveyPreview: true`. 봉투를 턴마다 이어 가므로 TC `messages` 1~5턴으로 노출 → 응답 → 완료를 검증할 수 있다. 실행당 고정 `now`라 타임아웃이 끼지 않는다.
- API 목 완결(`completeApiTurnSync`)은 `resumeAfterApiCall`이 `resumeState`의 `preview`를 쓰므로 **호출부 수정 0**(§5.6).
- `SideOutcome.surveyPreview` = 어느 턴이든 trace에 `SURVEY` 단계가 있었는가 → `flush`가 `surveyPreviewA/B`로 기록 → 결과 화면 `설문 미리보기 판정` 배지.
- `unsupportedCountA`(:320)는 `unsupportedOutputs` 기반이라 **v2 `SURVEY`는 자동으로 빠진다**(FR-SV9-5 — 추가 코드 0).
- ⚠ **응답 해시 불연속**(FR-SV9-6): v2 `SURVEY`를 포함한 TC는 No.27 전(미지원 안내)·후(문항 출력)의 해시가 다르다. 실행 비교 화면은 **두 실행 중 한쪽만 `surveyPreview`가 있으면** "설문 실행 방식이 달라 비교 결과가 달라질 수 있습니다" 안내를 1회 표시한다(No.26 `apiMock` 안내와 **한 문단으로 통합** — ui-designer).
- `ConversationLog`·응답 행 0건(ADR-0030 ①).

---

## 8. 응답 적재 · 재검증 — `SurveyResponseService.apply()` (FR-SV5-1~7)

### 8.1 입력과 쓰기 키

`apply(events: SurveyEvent[], ctx: { chatbotId, groupId, sessionId, channelType, conversationLogId, now, bundle })` — 이벤트를 **순서대로** 처리한다. 한 턴에 여러 이벤트가 올 수 있다(`[ANSWERED, COMPLETED]` · `[ABANDONED(SWITCHED), EXPOSED(B)]` · `[ANSWERED, COMPLETED, EXPOSED(onComplete)]` · `[ABANDONED(TIMEOUT), EXPOSED]`). 각 이벤트의 **쓰기 키** = `(ctx.chatbotId, ctx.sessionId, event.attempt.surveyId, event.attempt.startedAt)`. 같은 `apply` 호출 안에서 같은 키의 행은 1회만 읽고 캐시한다.

### 8.2 이벤트별 처리와 쓰기 가드 (`lib/write-guard.ts` 순수 판정 + 서비스 트랜잭션)

| 이벤트 | 가드(하나라도 불충족 = **조용히 무시** + 결과 코드 카운터·경고 로그 — 값 없음) | 쓰기 |
|---|---|---|
| `EXPOSED` | 번들에 설문 존재 · 설문 `structureVersion` = 이벤트 값 | `survey_responses` create(`status=EXPOSED`·`lastInteractedAt=startedAt`·`dayBucket=toKstDayBucket(startedAt)`·`groupId`·`exposedNodeId`·`conversationLogId`·`isDuplicate` = 같은 `(chatbotId, sessionId, surveyId)`에 `COMPLETED` 행 존재(읽기 1)). **유일 제약 위반 = 리플레이 → 무시** |
| `ANSWERED` · `SKIPPED` | ① 쓰기 키 행 존재 ② 상태 `EXPOSED｜IN_PROGRESS` ③ 구조 버전 = 행 = 번들 설문 ④ `questionIndex < 문항 수` 이고 **번들 설문 `questions[questionIndex].key === questionKey`** ⑤ `questionIndex > lastQuestionIndex`(순서 증가) ⑥ 답 행 유일(DB 제약) ⑦ **값 재검증** `validateSurveyAnswerValue`(ANSWERED만) | 트랜잭션: 답 행 `createMany`(§8.3) + 응답 행 **조건부 `updateMany({ where:{ id, lastQuestionIndex:{ lt: idx }, status:{ in:[EXPOSED,IN_PROGRESS] } } })`**(`status=IN_PROGRESS`·`started=true`·`lastQuestionIndex=idx`·`lastInteractedAt=now`) — **영향 행 0이면 롤백**(⑤의 원자적 재확인 — 병렬 요청 경합 흡수) |
| `COMPLETED` | ①②③ | 트랜잭션: 필수 문항 key 집합 − `isHead·ANSWERED` 답 행 key 집합(읽기 1) = `missingRequiredCount` · 먼저 완료된 같은 세션 행 존재(읽기 1) 또는 행이 이미 `isDuplicate` → `isDuplicate=true`(+ 그 시도의 답 행 `updateMany isDuplicate=true`) · `status=COMPLETED`·`completedAt=now`·`lastInteractedAt=now` |
| `ABANDONED` | ①② | `status=ABANDONED`·`endReason`·`endedAt=now`·`lastInteractedAt=now` |

- **무응답 이탈(탭 닫기·방치)은 행을 바꾸지 않는다** — 조회 시점 판정(§9.1, FR-SV5-5).
- 읽기 예산: 응답 턴 = 행 1(캐시) · 노출 턴 = 중복 확인 1 · 완료 턴 = 행 1 + 필수 확인 1 + 중복 확인 1(§22 D-9).

### 8.3 답 행 형태 (`lib/answer-rows.ts` — FR-SV5-7 "DB 그룹화로 분포")

| 유형 | 행 |
|---|---|
| 단일 선택 | 1행 `{ choiceKey, isHead:true }` |
| 다중 선택 | 선택지당 1행, **선택지 순서상 첫 행만 `isHead:true`** |
| 척도 | 1행 `{ choiceKey:'', numericValue, isHead:true }` |
| 자유 텍스트 | 1행 `{ choiceKey:'', textValue: 마스킹본, isHead:true }` |
| 건너뜀 | 1행 `{ kind:'SKIPPED', choiceKey:'', isHead:true }` |

공통: `surveyId·questionKey·questionIndex·dayBucket·channelType·isDuplicate`(응답 행에서 복사)·`answeredAt=now`. **라벨 문자열은 저장하지 않는다**(키만 — 라벨 수정이 과거 응답을 흔들지 않는 근거, AC-SV4-2).

### 8.4 자유 텍스트 마스킹 (FR-SV5-6 · FR-0-111 · ADR-0013 "저장" 지점 확장)

`textValue = maskPii(await bannedWordFilter.maskPlainText(value.text)).maskedText` — `ConversationLogService.record()`(:57)와 **같은 함수 2개를 같은 순서로** 호출한다(마스킹 함수 복제 금지 — `packages/pii-mask` 1벌). 원문은 변수 스코프 밖으로 나가지 않는다. 입구 금지어 BLOCK 입력은 애초에 엔진에 도달하지 않으므로(FR-SV5-10) 여기서의 금지어 처리는 WARN 정책 단어의 마스킹이다(EX-SV-7).

### 8.5 실패 처리

- `apply()`는 **모든 예외를 삼킨다**(`record()` 규약 — 대화 응답을 실패시키지 않는다, AC-SV3-6). 이벤트 1건 실패가 뒤 이벤트를 막지 않는다(각 이벤트 독립 트랜잭션).
- 서버 로그 허용 필드: `chatbotId`·`surveyId`·이벤트 종류·`questionIndex`·가드 결과 코드(`NO_ROW｜BAD_STATUS｜VERSION_MISMATCH｜KEY_MISMATCH｜OUT_OF_ORDER｜DUPLICATE_ANSWER｜INVALID_VALUE`)·Prisma 오류 코드. **응답 값·`sessionId`·예외 `message`를 넣지 않는다**(FR-0-111 — 예외 메시지에 유일 제약 위반 값이 섞일 수 있다).
- 적재 실패 후 이어지는 문항은 순서 증가 가드라 계속 적재된다(공백 허용 — EX-SV-15). 완료 시 누락 수로 드러난다.

### 8.6 쓰기 주체 봉인

`surveyResponse.(create｜createMany｜update｜updateMany｜upsert)`·`surveyAnswer.(…)` 호출 파일 = `survey-responses/survey-response.service.ts` **1개**. `delete*`·원시 `DELETE` **0건**(§14 S-1·S-2). 향후 삭제(No.45)는 ADR-0033 §3 규약 — **단일 서비스 + 같은 트랜잭션의 수치 롤업 선적재**(설문 롤업 = `(surveyId, dayBucket, channelType)` 키의 상태·시작 여부별 건수 + 문항·선택지/값별 건수, **텍스트·세션 ID 없음**).

---

## 9. 통계 쿼리 (FR-SV6 — 챗봇 스코프만, DB 그룹화 + 순수 조립, 신규 원시 SQL 0)

### 9.1 지표 정의 (노출일 코호트 · `generatedAt` 기준 조회 시점 판정)

`R` = `surveyId` · `dayBucket ∈ [from, to]` · (`channel`) · (`includeDuplicates=false`면 `isDuplicate=false`)인 응답 행. `cutoff = generatedAt − 설문의 현재 sessionTimeoutMinutes`. `open = status ∈ {EXPOSED, IN_PROGRESS}`, `active = open ∧ lastInteractedAt ≥ cutoff`.

| 지표 | 식 |
|---|---|
| 노출 | `|R|` |
| 시작 | `|R ∧ started|` |
| 완료 | `|R ∧ COMPLETED|` |
| 진행 중 | `|R ∧ active|` (시작한 진행 중 = `|R ∧ active ∧ started|`) |
| 중도 이탈 | `|R ∧ started ∧ (ABANDONED ∨ (open ∧ ¬active))|` |
| 미시작 이탈 | `|R ∧ ¬started ∧ (ABANDONED ∨ (open ∧ ¬active))|` |
| 참여율 | 시작 ÷ 노출 |
| 완료율 | 완료 ÷ (노출 − 진행 중) |
| 중도 이탈률 | 중도 이탈 ÷ (시작 − 시작한 진행 중) |
| 중복 완료 | 필터와 무관하게 `|R_all ∧ isDuplicate|`(표시만) |

분모 0이면 비율 `null`(UI `—` — EX-SV-21). AC-SV5-1 픽스처(노출 10·시작 7·완료 4·명시 이탈 1·타임아웃 이탈 1·진행 중 1·미시작 방치 3) → 70% · 4/9 · 2/6 · 1.

### 9.2 요약 `GET …/stats/summary` (`survey-stats.service.ts`)

기간 해석은 **`resolveStatsPeriod()`**(`stats-period.ts:58` — 일 92/주 53/월 24 · 초과 `400 STATS_RANGE_TOO_WIDE`), 버킷은 `buildBuckets`/`dayBucketToBucketKey`/`foldDayRows`(`bucket.ts:49·101·129`) 재사용. 병렬 쿼리 2개(`runWithAggregationTimeout` — 5초 초과 `503 AGGREGATION_TIMEOUT`, 캐시 대체 금지):
- **Q1** `surveyResponse.groupBy({ by:['dayBucket','status','started','isDuplicate'], where:{ surveyId, dayBucket:{gte,lte}, channelType? }, _count:{_all:true} })`
- **Q2** `surveyResponse.groupBy({ by:['dayBucket','started','isDuplicate'], where:{ …, status:{ in:['EXPOSED','IN_PROGRESS'] }, lastInteractedAt:{ gte: cutoff } }, _count })` → active
- 반환 행 수 ≤ 일수 × 16 — 응답 수와 무관. 조립 = `survey-summary-assembler.ts`(순수 — **기존 `summary-assembler.ts` 수정 0**, FR-0-113).
- 응답 `{ surveyId, period{from,to,granularity}, generatedAt, timezone, filters, totals{ exposed, started, completed, inProgress, inProgressStarted, droppedAfterStart, droppedBeforeStart, duplicates, participationRate, completionRate, dropoutRate }, buckets[{ key, exposed, started, completed }], lowSample }`(`lowSample` = 노출 < 30).

### 9.3 문항별 `GET …/stats/questions`

병렬 4쿼리(모두 `surveyAnswer`는 비정규화 컬럼으로 **조인 없음** — §22 D-8):
- **Q3** `surveyResponse.groupBy({ by:['lastQuestionIndex'], where: Q1과 같은 R })` → 도달 퍼널: `reached(0) = 노출`, `reached(i≥1) = Σ count(lastQuestionIndex ≥ i−1)`
- **Q4** `surveyAnswer.groupBy({ by:['questionKey','kind'], where:{ surveyId, dayBucket, channelType?, isDuplicate:false?, isHead:true } })` → 응답자·건너뜀
- **Q5** `surveyAnswer.groupBy({ by:['questionKey','choiceKey'], where:{ …, kind:'ANSWERED', choiceKey:{ not:'' } } })` → 선택지 분포
- **Q6** `surveyAnswer.groupBy({ by:['questionKey','numericValue'], where:{ …, kind:'ANSWERED', isHead:true, numericValue:{ not:null } } })` → 척도 분포
- 조립(`survey-question-assembler.ts`): **현재 정의 순서·현재 라벨**로 표시(키 기준 집계 — FR-SV6-2). 선택지 비율 = 선택 수 ÷ 그 문항 응답자 수(다중은 합 100% 초과 — `multiSelectCaption: true`). 척도 평균 소수 1자리 · **NPS = round((9~10 비율 − 0~6 비율) × 100)**(`npsOf` 공용) · 응답 30 미만 `lowSample`. 자유 텍스트는 응답·건너뜀 수만(목록은 §9.5).
- 진행 중·이탈한 시도의 답도 분포에 포함한다(문항 단위 적재의 목적 — 완료자만 보려면 후속 필터, §20).

### 9.4 성능 근거

기준 데이터 **설문 1개 = 노출 10만 · 답 50만 행**. 모든 쿼리가 `(surveyId, dayBucket)`·`(surveyId, questionKey, dayBucket)` 인덱스 범위 스캔 + `groupBy`이며 반환 행 수가 응답 수와 무관하다. `$queryRaw` 보유 파일 3개 불변(R-7).

### 9.5 목록 · 자유 텍스트 (`survey-results.service.ts`)

- **응답 목록** `GET …/responses`: `from`·`to` 필수(≤366일) · `status?`(`COMPLETED｜IN_PROGRESS｜ABANDONED｜DUPLICATE` — `IN_PROGRESS`/`ABANDONED`는 §9.1 조회 시점 판정을 `where`로 표현) · `channel?` · `page`/`pageSize`(기본 50·최대 100) · 정렬 `startedAt desc` 고정. 페이지의 응답 id로 답 행 1회 조회(N+1 금지). 항목 `{ responseNo(id 앞 8자 대문자), exposedAt, displayStatus, endReason?(무응답 이탈 = 'IDLE'), started, duplicate, channelType, completedAt?, missingRequiredCount, answers[{ questionKey, kind, display }] }` — `display` = 라벨 `; ` 결합 · 점수 · 마스킹 텍스트 · `건너뜀`. **`sessionId`·`groupId`·`conversationLogId`를 반환하지 않는다**(FR-SV7-1).
- **자유 텍스트 목록** `GET …/text-answers?questionKey=`(§22 D-10): `surveyAnswer.findMany({ where:{ surveyId, questionKey, kind:'ANSWERED', textValue:{ not:null }, dayBucket, isDuplicate:false }, orderBy:{ answeredAt:'desc' }, skip, take })` + 총계.

### 9.6 질문 순위의 설문 턴 제외 (FR-SV10-5 · J-14, 숨은 결함 ④)

`stats/lib/question-ranking-filter.ts`의 `QUESTION_RANKING_LOG_FILTER = { surveyTurn: false }`를 `userMessage` 그룹화 **5곳**의 `where`에 펼친다 — 대시보드 `topQuestions`(`stats.service.ts:76-83`) · 질문 순위 인기/미응답(:272-287) · 통합 통계 인기/미응답(`integrated-stats.service.ts:247-262`) · 통합 귀속(:284-289). **조건 1벌**(상수 1개). 턴 수·세션 수·응답률·출처·시간대 집계는 설문 턴을 **포함**한다(AC-SV3-8). 기존 행은 전부 `false`라 기존 수치 불변(FR-0-113). 인덱스 추가 없음(불리언 선택도 낮음 — 기간 인덱스로 범위를 좁힌 뒤 필터).

---

## 10. CSV (FR-SV7-2~5 · P-13)

`GET /chatbots/:chatbotId/surveys/:surveyId/responses/export?kind=RESPONSES|SUMMARY&from&to[&channel][&includeDuplicates]`

| 항목 | 규칙 |
|---|---|
| 공통 | `buildCsv()`(`dialogue-common/import/lib/csv-writer.ts:6-9` — UTF-8 BOM·CRLF) + 모든 셀 `escapeCsvCell()`(`bulk-import.ts:94` — `=`·`+`·`-`·`@`·탭·CR 선두 수식 인젝션 방어, NFR-SVS5). 기간 필수(미지정 `400 VALIDATION_FAILED`, ≤366일) |
| `RESPONSES` | 열 = `응답 번호 · 노출 일시(KST) · 상태 · 이탈 사유 · 채널 · 완료 일시(KST) · 필수 누락 수 · Q1. {문구 앞 30자} … QN`. 다중 선택 = 라벨 `; ` 결합 · 건너뜀 = `(건너뜀)` · 미도달 = 빈칸 · 자유 텍스트 = 마스킹본. **`sessionId`·`groupId` 열 없음**. 최신순 **최대 10,000행** — 응답 행 `take: 10_001`로 초과 여부 판정, 답 행은 응답 id **1,000개 단위 배치** 조회(SQLite 바인딩 상한 회피) |
| `SUMMARY` | 열 = `문항 번호 · 문항 · 유형 · 선택지/값 · 수 · 비율 · 평균 · NPS` — §9.3 조립 결과를 평탄화(쿼리 재사용) |
| 초과 표시 | 응답 헤더 `X-Export-Truncated: true` · `X-Export-Total: <전체 건수>`(파일 본문에 안내 줄을 넣지 않는다 — CSV 파싱을 깨지 않게). 화면은 헤더를 읽어 "최신 10,000건만 포함 — 기간을 좁혀 다시 내려받으세요" 안내(EX-SV-23) |
| 파일명 | `Content-Disposition: attachment; filename="survey-<id8>-<kind>-<from>-<to>.csv"; filename*=UTF-8''<percent-encoded "survey-{정제한 설문명}-…">` — 설문명은 `\/:*?"<>|`·제어문자 제거·50자 절단 |
| 감사 | **기록하지 않는다**(`AuditAction`에 `EXPORT` 없음 — P-13) |
| 성능 | 10,000행 5초 이내(NFR-SVP5) — 초과 `503 AGGREGATION_TIMEOUT` |

---

## 11. 권한 (P-12 — 신규 0종, `Permission` 15종 불변)

| 동작 | 권한 | 비고 |
|---|---|---|
| 설문 목록·상세(+ 노드 편집기 선택기) | `dialogue:read` | 목록의 최근 30일 노출/완료 수 포함 — 세 역할 모두 `chatbot:read`도 보유해 노출 차이 0(§22 D-21) |
| 설문 생성·수정(상태 포함)·복제·삭제 | `dialogue:write` | 설문 정의 = 대화 자산 |
| 요약·문항별·응답 목록·자유 텍스트·CSV | `chatbot:read` | VIEWER 포함 — 마스킹본만(VIEWER가 이미 마스킹 질문 원문을 질문 순위로 본다) |
| 시뮬레이터(미리보기 포함) | 기존 `simulation:read` | 저장 0이라 새 위험 없음 |
| 노드 저장(v2 설정) | 기존 `dialogue:write` | — |

챗봇 스코프: 교차 챗봇 `surveyId` = `404`. `ARCHIVED` 챗봇 = 설문 정의 조회·결과 조회 허용, 쓰기 `409 CHATBOT_ARCHIVED`(FR-SV2-1 · FR-SV6-8). `@Public()` 추가 0건.

---

## 12. 감사 (FR-SV2-8)

- `AuditTargetType`에 **`Survey`**(라벨 `'설문'`, 16 → 17종). `AuditAction` 추가 0.
- `AUDIT_FIELDS.Survey = ['name','status','activeFrom','activeTo','questionCount','structureVersion','sessionTimeoutMinutes']` — **문항 문구·선택지·소개·완료 문구·취소어 본문을 담지 않는다**(`DialogNode`의 `outputs` 제외 선례 `audit-snapshot.ts:39`).
- 기록: 생성 `CREATE` · 수정 `UPDATE`(summary: "문구만 수정"｜"구성 변경(구조 버전 N→N+1)") · 상태만 바뀐 수정 `STATUS_CHANGE`(summary: "작성 중 → 진행 중" 등) · 복제 `COPY` · 삭제 `DELETE`. **응답 1건·CSV 내보내기·통계 조회는 감사 대상이 아니다**.

---

## 13. API 계약

### 13.1 엔드포인트 (신규 11개 · `@Public()` 0)

| # | 메서드 | 경로 | 권한 | 요청 → 응답 | 오류 |
|---|---|---|---|---|---|
| ① | GET | `/chatbots/:chatbotId/surveys` | `dialogue:read` | `?status&q` → `{ items: SurveyListItem[] }`(챗봇당 ≤50 — 페이지네이션 없음) | `404` |
| ② | POST | `/chatbots/:chatbotId/surveys` | `dialogue:write` | `CreateSurvey` → `201 SurveyDetail`(DRAFT) | `400 VALIDATION_FAILED` · `409 DUPLICATE_NAME` · `409 LIMIT_EXCEEDED`(50) · `409 CHATBOT_ARCHIVED` |
| ③ | GET | `…/surveys/:surveyId` | `dialogue:read` | → `SurveyDetail` | `404` |
| ④ | PATCH | `…/surveys/:surveyId` | `dialogue:write` | `UpdateSurvey` → `SurveyDetail` | 위 + **`409 SURVEY_STRUCTURE_LOCKED`** · `400 INVALID_STATUS_TRANSITION` · `400 VALIDATION_FAILED`(오픈 검증 `details[]`) |
| ⑤ | DELETE | `…/surveys/:surveyId` | `dialogue:write` | → `204` | **`409 SURVEY_IN_USE`**(`details[]` 노드명 ≤5) · **`409 SURVEY_HAS_RESPONSES`** |
| ⑥ | POST | `…/surveys/:surveyId/copy` | `dialogue:write` | `{ name? }` → `201 SurveyDetail` | `409 DUPLICATE_NAME` · `409 LIMIT_EXCEEDED` |
| ⑦ | GET | `…/surveys/:surveyId/stats/summary` | `chatbot:read` | `SurveyStatsQuery` → `SurveyStatsSummary` | `400 STATS_RANGE_TOO_WIDE` · `503 AGGREGATION_TIMEOUT` · `404` |
| ⑧ | GET | `…/surveys/:surveyId/stats/questions` | `chatbot:read` | 같은 쿼리 → `SurveyQuestionStats` | 〃 |
| ⑨ | GET | `…/surveys/:surveyId/responses` | `chatbot:read` | `SurveyResponseListQuery` → `Paginated<SurveyResponseListItem>` | `400` · `404` |
| ⑩ | GET | `…/surveys/:surveyId/responses/export` | `chatbot:read` | `SurveyExportQuery` → `text/csv` | `400` · `503` · `404` |
| ⑪ | GET | `…/surveys/:surveyId/text-answers` | `chatbot:read` | `SurveyTextAnswerListQuery` → `Paginated<SurveyTextAnswerItem>` | `400` · `404` |

- 경로 선언: ①~⑥ `SurveysController`, ⑦~⑪ `SurveyResultsController`(`stats/surveys/`). 두 컨트롤러가 같은 접두를 쓰지만 정적 세그먼트 충돌이 없다(`:surveyId` 뒤 하위 경로만).
- **PATCH 처리 순서**: 스코프·쓰기 가능 → 행 조회 → `questions`가 있으면 `diffStructure(old, new)` → `STRUCTURAL`이고 답 행 존재(`surveyAnswer.findFirst({ where:{ surveyId } })` — 인덱스 선두 1행) → `409 SURVEY_STRUCTURE_LOCKED`("응답이 있는 설문은 문항 구성을 바꿀 수 없습니다. 문구만 수정할 수 있어요. 구성을 바꾸려면 복제해서 새 설문을 만드세요.") · `STRUCTURAL`이고 답 행 없음 → `structureVersion+1` · `TEXT_ONLY` → 버전 유지 → `status` 전이 검사(`DRAFT→OPEN`·`OPEN↔CLOSED`만, 그 외 `400 INVALID_STATUS_TRANSITION`) → `OPEN`으로 가는 전이·`OPEN` 상태의 구조 변경이면 오픈 검증(§2.1 `survey-open-check.ts`) → 저장 → 번들 무효화 → 감사.
- **구조 판정**(`structureFingerprint`): 문항 key 순서 · 유형 · `required` · 선택지 key 순서 · 척도 종류 · `minSelect`/`maxSelect` · `maxLength`. **문구 필드**(`prompt`·선택지 `label`·척도 양끝 라벨·이름·설명·소개·완료 문구·취소어·타임아웃·기간·상태)는 구조가 아니다(FR-SV2-4). 요청의 기존 key를 빠뜨리면 = 문항/선택지 삭제 + 신규 추가 = 구조 변경으로 판정된다(키 보존은 클라이언트 책임 — 편집기 인계).
- **삭제 순서**: 참조 노드 검사(`409 SURVEY_IN_USE`) → 응답 행 존재(`surveyResponse.findFirst({ where:{ surveyId } })` → `409 SURVEY_HAS_RESPONSES` "응답이 있는 설문은 삭제할 수 없어요. 마감하면 더 이상 응답을 받지 않습니다.") → 물리 삭제. FK `Restrict`가 최종 방어선.
- **복제**: 정의만 · 이름 `"… (사본)"`(충돌 시 `"… (사본 2)"`) · `DRAFT` · 문항·선택지 **key 재발급** · 기간 복사 · 응답·노드 참조 복사 없음(FR-SV2-6 · AC-SV4-4).

개발명세서 §4의 예고 `/surveys`(전역)는 **`/chatbots/:chatbotId/surveys/*` 11개로 정정**한다 — 전역 경로는 교차 챗봇 404 규약과 충돌한다(학습 고도화·검증 그룹의 같은 정정 선례).

### 13.2 확장(기존 경로)

`POST …/simulate`(요청 `surveyPreview`, 응답 `surveyStep`) · `POST …/simulate/compare`(미리보기 판정 — 계약 불변) · 노드 CRUD(v2 검증 · v1 쓰기 400 · 복사 `excludedLegacySurveyOutputCount`) · `POST …/dialog-nodes/validate`(신규 코드 6) · `GET …/dialog-nodes/flow`(`via: SURVEY_COMPLETE`) · 복원 미리보기(경고 3종) · TC 결과(`surveyPreviewA/B`) · 공개 대화 `state`(선택 필드 2종 — 스키마 이름 불변).

### 13.3 오류 코드 (`ApiErrorCode` 신규 4종 — FR-0-115)

| 코드 | 상태 | 쓰임 |
|---|---|---|
| `SURVEY_OUTPUT_LEGACY_FORMAT` | 400 | v1 `SURVEY`를 담은 노드 생성·수정 |
| `SURVEY_IN_USE` | 409 | 현재 노드가 참조하는 설문 삭제(스냅샷 참조는 막지 않음) |
| `SURVEY_HAS_RESPONSES` | 409 | 응답 행(노출 포함) 1건 이상인 설문 삭제 |
| `SURVEY_STRUCTURE_LOCKED` | 409 | 답 행 존재 후 구조 변경 |

재사용: 없는 설문·완료 후 이동 노드·타 챗봇 설문 참조 = `INVALID_REFERENCE`(404, `details[]`) · 이름 중복 = `DUPLICATE_NAME`(409) · 챗봇당 50 초과 = `LIMIT_EXCEEDED`(409) · 불허 상태 전이 = `INVALID_STATUS_TRANSITION`(400) · 오픈 검증 실패 = `VALIDATION_FAILED`(400 + `details[]`). **대화 경로는 이 코드들을 쓰지 않는다**(설문 불가는 건너뜀·고정 문구로 수렴).

---

## 14. 봉인 · 정적 검사 — `apps/api/src/stats/lib/survey-sealing.spec.ts`

검사 대상: `apps/api/src/**/*.ts`(`*.spec.ts`·`src/integration/**` 제외, 주석 제거) + `packages/dialogue-engine/src/**/*.ts`(spec 제외) + `schema.prisma`. 탐지어는 조각 조립(검사기 자신이 문자열을 포함하지 않게 — `rag-allowlist.spec.ts` 방식). 역검증 픽스처 포함(AC-SV6-7).

| # | 단언 | 막는 것 |
|---|---|---|
| S-1 | `surveyResponse`·`surveyAnswer`의 `delete｜deleteMany` 호출 0건 · 원시 `DELETE FROM "survey_responses｜survey_answers"` 0건 | 응답 삭제 경로(FR-0-110 · ADR-0033 확장) |
| S-2 | `surveyResponse｜surveyAnswer`의 `create｜createMany｜update｜updateMany｜upsert` 호출 파일 = `survey-responses/survey-response.service.ts` **1개** | 쓰기 주체 확산 |
| S-3 | `schema.prisma`의 `SurveyResponse`·`SurveyAnswer` 블록: `onDelete: (Cascade｜SetNull)` 없음 · `Restrict` 있음 · **필드명이 §3.1 허용 목록과 정확히 일치**(`ip`·`userAgent`·`cookie`·`raw`·`original` 류 0) | 식별자 수집·원문 컬럼(FR-SV8-1) |
| S-4 | `chatbots.service.ts` 사전검사 `counts` 블록에 `surveys`·`surveyResponses` 존재 · 동반 삭제 트랜잭션 블록에 `survey*` 삭제 호출 0 | 영구삭제로 응답 소실(FR-SV8-4) |
| S-5 | `packages/dialogue-engine/src`에 `surveyResponse`·`SurveyResponseService`·`@prisma` 심볼 0건(엔진 I/O 0건은 L-5가 계속 단언) | 엔진의 적재 |
| S-6 | `SurveyResponseService` 참조 파일 = `conversation/public-conversation.service.ts` + `survey-responses/**` + 모듈 배선(`conversation.module.ts`) 뿐 · `simulation/**`·`validation/**`·`versions/**`·`deploy-schedules/**`·`stats/**`에 `survey-responses/` import 0건 | 시뮬레이터·TC·버전·예약·통계의 저장(FR-0-112) |
| S-7 | `@Public()` 핸들러 6개(기존 `public-decorator-count.spec.ts` 유지) | 설문 공개 경로(FR-0-108) |
| S-8 | `$queryRaw` 보유 파일 3개(기존 R-7 유지) | 설문 통계의 원시 SQL |
| S-9 | (런타임) `CONVERSATION_STATE_VERSION === 1` · `SurveySessionStateSchema` 키 집합 = `{surveyId, structureVersion, nodeId, outputIndex, questionIndex, retryCount, startedAt, lastInteractedAt}` 정확히 일치 | 봉투에 응답 값 유입(FR-0-109) |
| S-10 | `stats/surveys/**` Prisma 쓰기 0건(기존 R-8이 포함 — 목록에 명시) | 통계가 응답을 고침 |
| S-11 | `survey-response.service.ts`에 `maskPlainText(`와 `maskPii(`가 모두 있고 `maskPlainText(`가 먼저 나온다(휴리스틱) · 다른 파일에서 `textValue:` 쓰기 0 | 마스킹 누락·순서 역전(FR-0-111) |
| S-12 | `survey-responses/**`·`surveys/**`·`stats/surveys/**`의 `logger.(log｜warn｜error｜debug)(` 인자에 `text`·`value`·`textValue`·`sessionId`·`.message` 식별자 0건(휴리스틱) | 응답 값 로그 — 최종 보증은 NFR-SVS2 가짜 텍스트 grep 시험 |
| S-13 | `versions/lib/snapshot-envelope.ts`에 `surveys` 0건 · `SNAPSHOT_SCHEMA_VERSION === 1` · `VersionAssetKind` 8종 불변(런타임) | 스냅샷 편입(P-6) |
| S-14 | `survey.(create｜update｜updateMany｜upsert｜delete｜deleteMany)` 호출 파일 = `surveys/surveys.service.ts` 1개 | 정의 쓰기 확산 · 감사 누락 |

기존 검사 갱신: `legacy-api-sealing.spec.ts` **L-12의 기대 키 집합을 5키로**(의도된 변경 — §22 D-16) · `validation-sealing.spec.ts` 금지 import에 `survey-responses/`.

---

## 15. 성능 예산 (NFR-SVP)

| 대상 | 목표 |
|---|---|
| 설문이 개입하지 않은 공개 대화 턴 | **P95 500ms(캐시 적중) 불변** — 추가 조회 0(설문 정의는 번들 캐시) · 분기 2개(`surveySession` 키 유무 · `surveyEvents` 유무)(NFR-SVP1) |
| 설문 턴(노출·응답·완료) | P95 ≤ 기존 예산 + **30ms**(읽기 1~3 + 쓰기 1~2, await). **의미 점수 생략으로 설문이 소비하는 턴은 오히려 임베딩 1회(≤300ms 예산)를 절약**한다(NFR-SVP2) |
| 번들 캐시 미스 | 설문 조회 1회 추가(챗봇당 ≤50) — 콜드 1.5초 불변(NFR-SVP3) |
| 응답 판정 | 문항 1개 1ms(NFR-SVP4 단위 벤치) |
| 통계 | 설문 1개 = 노출 10만·답 50만 행: 요약(일 30일) P95 1초 · 월 24개월 P95 2초 · 문항별 P95 1초 · 응답 목록 P95 300ms · CSV 10,000행 5초. 5초 초과 `503`(NFR-SVP5) |
| TC | 500 TC/분 불변(판정 순수 함수 · 저장 0 — NFR-SVP6) |
| 설문 목록 | 설문 수와 무관한 쿼리 수 — 30일 노출/완료 = `surveyResponse.groupBy({ by:['surveyId','status','isDuplicate'], where:{ chatbotId, dayBucket ≥ 30일 전 } })` 1회 · 잠금 = `surveyAnswer.groupBy({ by:['surveyId'], where:{ surveyId:{ in } } })` 1회 · 참조 노드 수 = 챗봇 노드 1회 조회 후 파싱(NFR-SVP7) |

---

## 16. 버전(No.25) · 예약 배포(No.28) · 통합 통계(No.29)

- **스냅샷**: 노드 `outputs`를 그대로 담는다(v1·v2). `Survey`는 스냅샷 대상이 아니다 — `snapshot-envelope.ts`가 자산 6종을 **명시 나열**하므로 번들에 `surveys`가 있어도 봉투에 들어가지 않는다(구조로 보장, S-13). `SNAPSHOT_SCHEMA_VERSION`·`VersionAssetKind`·업캐스터 불변.
- **hydrate 호환**(FR-SV10-2): `hydrateSnapshot()`의 번들 리터럴(6키)은 `surveys`가 없어도 `DialogueBundleSchema`를 통과한다(선택 필드). 복원 후 번들 재구축 시 현재 DB 설문이 들어간다.
- **복원 미리보기 경고 3종**(전부 blocker 아님): `SURVEY_MISSING`(대상 버전이 참조하는 v2 설문 없음 — 복원 후 해당 노드는 설문을 건너뜀, AC-SV6-4) · `SURVEY_NOT_OPEN`(`DRAFT`/`CLOSED`) · `SURVEY_LEGACY_FORMAT`(v1 포함 — 복원 후 실행되지 않음). `restore-warnings.service.ts`가 대상 스냅샷의 v2 `surveyId` 집합으로 `prisma.survey.findMany({ where:{ chatbotId, id:{ in } }, select:{ id, status } })` 1회. 무결성 경고 `BROKEN_REFERENCE_NODE_SURVEY`(완료 후 이동 노드 없음).
- **설문 삭제 409는 현재 노드 참조만** 검사한다(FR-SV10-3 — 스냅샷 때문에 영원히 못 지우는 것 방지). 단 응답이 있는 설문은 어차피 삭제 불가다.
- **예약 배포 변경 0**(FR-SV10-4). 복원 예약 실행기는 `versionRestore.preview()`를 호출하므로 위 경고가 준비도 경고에 **자동 포함**된다(추가 코드 0). 설문 오픈/마감 예약은 설문 기간으로 대체한다.
- **통합 통계 변경 0**(FR-SV10-5). 단 질문 순위의 `surveyTurn` 제외는 챗봇·그룹·전역 **모든 스코프**에 같은 상수로 적용된다(§9.6). 설문 응답의 `groupId` 스냅샷은 적재만 한다(그룹·전역 설문 통계는 No.29 후속).

---

## 17. 관리자 콘솔 (ui-designer / frontend-implementer 인계)

- **① 설문관리 목록**(챗봇 상세 하위 탭 — 최상위 메뉴 여부는 ui-designer, T-9): 이름 · 상태 배지(`작성 중`/`진행 중`/`마감`/`기간 외`/`응답 잠금` — 색 + 텍스트) · 기간 · 문항 수 · 참조 노드 수 · 최근 30일 노출/완료 · 오픈/마감 · 복제 · 삭제(409 사유 안내 — 원인 + 해결).
- **② 편집기**: 기본 정보(이름·설명·기간·소개·완료 문구·취소어·타임아웃) · 문항 목록(추가·삭제·**위/아래 버튼 이동** — 드래그 단독 금지) · 유형별 서브폼(선택지 목록도 위/아래 이동) · **미리보기**(`buildSurveyQuestionOutputs`·`judgeSurveyAnswer` 공용 함수로 위젯 모양 그대로 — 텍스트 + 버튼 블록, 샘플 입력 판정) · 잠금 표시("응답 N건 — 문구만 수정할 수 있어요", 잠긴 필드는 **비활성 + 사유 텍스트**) · 문구 수정 경고 배너 · 자유 텍스트 문항 개인정보 고지("전화번호·이메일 등만 자동으로 가려지며 이름·주소는 가려지지 않을 수 있습니다") · **기존 문항·선택지 key를 반드시 보존해 PATCH**(누락 = 구조 변경 판정).
- **③ 결과 화면**(`chatbot:read`): 기간(KST)·단위·채널·중복 포함 필터 · 요약 카드(비율에 분자/분모 병기) · 시계열 · 문항별 카드(분포 막대 + **같은 값의 표** · 다중 선택 합계 100% 초과 캡션 · NPS · 표본 적음) · 자유 텍스트 목록(페이지네이션) · 응답 목록 · CSV 2종(`X-Export-Truncated` 안내) · 개인정보 고지 · 빈 상태(EX-SV-21·22).
- **④ 노드 편집기 `설문` 아웃풋**: 자유 입력(`DialogOutputEditor.tsx:409-422`)을 **설문 선택기**(목록 ① API — 이름·상태 배지·문항 수)로 교체 + `완료 후 이동 노드` 선택 + `설문 편집으로 이동` 링크. 기본값 = 빈 v2 초안. 라벨 "설문 연동"(`messages.ts:722`) → "설문". v1은 "이전 형식 — 실행되지 않음" 배지(공용 `isUnsupportedOutput`) + `설문 선택해 전환` 버튼. 저장 400 `SURVEY_OUTPUT_LEGACY_FORMAT` 시 전환 안내.
- **⑤ 시뮬레이터**: `설문 미리보기` 토글(작성 중·마감·기간 외 설문도 진행 — "저장되지 않습니다" 안내) · 결과 패널 `설문 단계`(설문명 · n/N · 결과 · 사유 · `저장되지 않음`).
- **⑥ TC 결과**: `설문 미리보기 판정` 배지 · 실행 비교 안내(No.26 안내와 통합 문단).
- **⑦ v1 잔존 알림**: 설계 점검 요약에 `SURVEY_LEGACY_FORMAT` 건수.
- **⑧ 흐름 트리**: `via: SURVEY_COMPLETE` → 텍스트 라벨 "설문 완료 후".
- **⑨ 복원 미리보기**: 경고 3종 문구.
- **위젯 문항 표시 규격**(ui-designer 확정): 진행 표시 n/N · 버튼 그룹 레이블이 문항과 연결되는지(NFR-SVA4 — 부족하면 **위젯 변경 필요 항목으로 별도 보고**, FR-SV12-4) · 척도 텍스트 라벨 · 고정 문구 7종 검토 · 텍스트 채널 격하 시 번호 목록 포함 여부.
- **접근성**: 모든 입력 레이블·오류 `aria-describedby` · 배지 = 색 + 텍스트 · 신규 화면 3종 axe 대비 위반 0 · 차트마다 표(NFR-SVA1~5 · AC-SV7-1/2).

---

## 18. 시험 설계 포인트 (test-automation 인계)

| 층 | 대상 | 핵심 |
|---|---|---|
| 순수(shared-types) | `survey-logic.ts` | 판정 표 전 조합(§5.12 — 라벨이 숫자인 선택지·"1, 2, 3, 4"·"5"·"포장,속도"·공백 라벨·전각 숫자·이모지·코드 포인트 길이) · 값 재검증 · 문항 출력(8지 = 5·3 블록 AC-SV2-13, NPS 5·5·3, 라벨 40 절단) · NPS/평균 · 참여 가능 판정 순서 · 1ms 벤치 · `SKIP_TOKENS ⊇ 건너뛰기 버튼 값` |
| 순수(shared-types) | 판별 | v1/v2 · v1의 UUID 문자열 키도 v1 · `isUnsupportedOutput` · `findLegacyOutputIndexes` |
| 엔진 | `executeOutputs`·`resolveTurn`·S0 | ★ **설문 없는 번들·봉투 기존 스위트 무수정 통과**(AC-SV1-4) · ★ v1 바이트 동일(AC-SV1-1) · ★ 시작 턴 봉투에 값 필드 0(AC-SV2-1) · 완주 + 완료 후 이동(AC-SV2-2) · 재시도 3회(AC-SV2-3) · 다중(AC-SV2-4) · 건너뛰기(AC-SV2-5) · 취소/`NODE` 전환(AC-SV2-6) · ★ 타임아웃 31분/29분(AC-SV2-7) · 재노출(AC-SV2-8) · 상태·기간(AC-SV2-9) · 마감/구조 변경 중 진행(AC-SV2-10) · 컨텍스트 전환·상호 배타(AC-SV2-11) · 빈 입력 시 설문 상태 이월 · 자유 텍스트에 "그만"이 포함돼도 취소 아님(§22 D-3) |
| 엔진 | `resumeAfterApiCall` | ★ API 분기 노드의 설문 시작 → `surveySession` 존재(AC-SV2-12) · API 턴에서 `completedSurveyIds` 보존 · 완료 후 이동 노드의 v2 API 정지 → 이벤트 이월 · 설문 필드 없는 API 턴 `nextState` 3키(AC-L3-13 무회귀) |
| 엔진 | sanitize | 위조 입력 표(§6.4 — 시험데이터로 고정) · 설문 필드만 불량이면 컨텍스트 세션 유지 · 폐기 사유 3종 |
| 엔진 | 참조·점검·오버레이 | `surveyTargets` 고아/삭제/흐름 · 점검 6종 · ★ v1 SURVEY INFO + WARNING 동시(AC-SV1-3) · **v1 API_CONDITION이 INFO에 다시 나타나지 않음**(No.26 회귀 방지) · `mergeOverlay` 설문 이월 |
| API 순수 | `write-guard.ts`·`answer-rows.ts`·assembler | 가드 ①~⑦ 표 · 행 형태 · ★ 지표 픽스처(AC-SV5-1) · 노출일 코호트(AC-SV5-2) · NPS(AC-SV5-3) · 다중 분포(AC-SV5-4) · 분모 0 |
| 통합 | 공개 대화 | ★ 완주 DB 상태(AC-SV3-1) · ★ 순번 위조(AC-SV3-2) · 노출 없는 설문(AC-SV3-3) · 리플레이(AC-SV3-4) · ★ 재응답 `isDuplicate`(AC-SV3-5) · 적재 실패 주입(AC-SV3-6) · `surveyTurn`·미응답 큐(AC-SV3-7) · ★ 질문 순위 오염 0 — 챗봇·그룹 스코프(AC-SV3-8) · RAG 0건(AC-SV3-9) · 금지어 BLOCK 중 진행 보존(AC-SV2-14) · **의미 점수 생략 — 설문 턴의 임베딩 호출 0** |
| 통합 | 누출 | ★ `SVY-LEAK-9f3a` + `010-1234-5678` 응답 → 서버 로그·trace·감사·오류 응답·시뮬레이터 응답·`ApiCallLog` 전수 grep 0 · 저장값 마스킹본(NFR-SVS2) |
| 통합 | 정의·잠금·권한 | 오픈 검증(AC-SV4-1) · ★ 잠금 409 / 문구 200 + 새 라벨 통계(AC-SV4-2) · 버전 증가(AC-SV4-3) · 복제(AC-SV4-4) · 감사(AC-SV4-5) · 삭제 409 2종(AC-SV1-7) · 교차 챗봇 404(AC-SV1-5) · VIEWER 200/403(AC-SV5-8) |
| 통합 | 통계·CSV | 범위 초과(AC-SV5-5) · `sessionId` 부재·마스킹·`=cmd`(AC-SV5-6) · 12,000건 → 10,000행 + 헤더(AC-SV5-7) · 기간 미지정 400 |
| 통합 | 시뮬레이터·TC·버전·봉인 | ★ VIEWER 완주 저장 0(AC-SV6-1) · 미리보기(AC-SV6-2) · ★ TC 날짜 결정론 — 서로 다른 날 2회, CLOSED 설문, 해시 동일, 행 0(AC-SV6-3) · 복원 경고(AC-SV6-4) · 스냅샷 설문 부재·hydrate 통과(AC-SV6-5) · 영구삭제 409(AC-SV6-6) · `survey-sealing.spec.ts`(AC-SV6-7) |
| E2E/접근성 | 콘솔 3화면·위젯 | 키보드만으로 생성→순서 변경→오픈→노드 연결(AC-SV7-1) · axe 0·차트 표(AC-SV7-2) · 스크린리더 읽기 순서(AC-SV7-3 — ui-designer 기준 확정 후) |

**의도된 기대값 변경(목록 고정 — FR-0-107 예외)**: ① `dialogue-design.integration.spec.ts:612-620` AC-5-7 — `201` → **`400 SURVEY_OUTPUT_LEGACY_FORMAT`** ② `DialogOutputEditor.spec.tsx:86` — `SURVEY` 전환 시 기본값이 v2 초안이라 **배지 없음**(SCENARIO·v1 API_CONDITION은 유지) ③ 시험항목 AC-L1-9 문구에서 `SURVEY` 제외 ④ **[architect 추가] `legacy-api-sealing.spec.ts:159-163` L-12 기대 키 집합 3 → 5키**(§22 D-16) ⑤ **[architect 추가, 해당 시험이 있을 때만] 시드 v1 SURVEY 챗봇의 설계 점검 WARNING 개수 +1**(§3.4). 그 밖의 엔진·대화·통계·검증·버전 스위트는 수정 없이 통과해야 한다.

---

## 19. 요구사항 추적표

| 요구사항 | 설계 위치 |
|---|---|
| T-1 · J-1 · FR-SV1-1 · P-1 | §4.1 · §20 |
| T-2 · FR-SV1-2~3 · FR-SV1-6 · J-18 · AC-SV1-1 | §4.1~§4.2 · §5.2 ① |
| T-3 · J-4 · FR-0-106 · FR-SV4-15 · AC-SV2-12 · EX-SV-18 | §2.3 · §5 · §5.6 · ADR-0035 §3 |
| T-4 · J-5 · FR-SV2-1 · P-3 | §3.1 · §13.1 |
| T-5 · T-6 · J-13 · FR-SV6-\* · AC-SV5-1~5 | §9 · §16 |
| T-7 · J-17 · FR-SV9-\* · FR-0-112 · AC-SV6-1~3 | §7.2~§7.4 · §14 S-6 |
| T-8 · FR-0-107 · FR-SV1-5 · AC-5-7 · AC-SV1-2/4 | §4.2 · §18 |
| T-9 · FR-SV11-\* · FR-SV12-\* · NFR-SVA\* · AC-SV7-\* | §17 |
| J-2 · J-3 · FR-0-108~109 · FR-SV4-14 · NFR-SVS1 · AC-SV2-1 | §6 · §14 S-7/S-9 |
| J-6 · J-7 · FR-SV4-5~13 · AC-SV2-2~11/13 · EX-SV-5/9/10/25/26/28 | §4.3~§4.4 · §5.3 · §5.10~§5.12 |
| J-8 · FR-SV2-3~6 · AC-SV4-1~4 · EX-SV-13/14 | §13.1 PATCH·복제 |
| J-9 · FR-SV10-1~3 · AC-SV6-4/5 | §16 |
| J-10 · FR-SV5-2~5 · AC-SV3-2~5 · EX-SV-2/11/12 | §8.2 · §6.4 |
| J-11 · FR-SV5-6 · FR-0-111 · FR-SV8-3/6 · NFR-SVS2 · EX-SV-7/8 | §8.4~§8.5 · §14 S-11/S-12 |
| J-12 · FR-0-110 · FR-SV8-2/4/5 · AC-SV6-6/7 | §3.1 · §8.6 · §14 S-1~S-4 |
| J-14 · FR-SV5-8/9 · FR-SV10-5 · FR-0-113 · AC-SV3-7~9 | §7.1 · §9.6 |
| J-15 · FR-SV2-2/8 · FR-0-114 · AC-SV4-5 · AC-SV5-8 | §11 · §12 |
| J-16 · FR-SV7-\* · NFR-SVS5 · AC-SV5-6/7 · EX-SV-23 | §9.5 · §10 |
| J-19 · FR-SV4-1 · FR-SV10-4 · P-16 | §5.1 · §16 |
| J-20 · FR-SV3-\* · AC-SV1-5~7 · EX-SV-16/17/19 | §5.8~§5.9 · §13.1 |
| J-21 · P-17 | §23 |
| FR-SV4-2~4 · AC-SV2-8/9 · EX-SV-1 | §5.2 |
| FR-SV5-1 · FR-SV5-10 · AC-SV2-14 · AC-SV3-6 · EX-SV-15 | §7.1 · §8.5 |
| FR-0-115 · FR-0-116 · FR-0-117 | §13.3 · §5.10 · §3.5 |
| NFR-SVP1~7 | §15 |
| NFR-SVM1~4 | §2.1 · §4.4 · §5.1 · §9.4 |
| EX-SV-3/4 | §9.1 · §6.3 ⑥ |
| EX-SV-6/24/27 | §21 K-11 · §21 K-12 · §7.2 |
| EX-SV-20 | §11 |

---

## 20. 범위 밖 (재검토 트리거는 요구사항 §9 · ADR-0035 재검토 트리거)

`SCENARIO` 실행(No.39) · 위젯 전용 설문 UI(체크박스·별 아이콘·슬라이더·한 화면 폼)와 이전 버튼 비활성화(No.46) · 조건부 문항(스킵 로직)·응답 기반 분기 · 응답 수정·이전 문항으로 돌아가기 · 날짜·행렬·파일·이미지 문항 · 설문 리비전(버전별 통계) · 전역 공유 설문·템플릿 · 그룹·전역 설문 통계·통합 통계 카드(No.29 후속 — `groupId`는 적재됨) · 자유 텍스트 요약·키워드·감성 분석 · 응답 삭제·제외 처리·보존기간·정보주체 파기(No.45 — 롤업 선적재 규약) · 작은 표본 비공개(k-익명성) · 응답자 식별 강화 · 세션당 여러 번 응답 · 설문 오픈/마감 예약 액션(No.28) · 대화 종료 자동 설문·상담원 평가(No.24) · 응답 알림·정기 리포트 · 다국어 설문 · 외부 설문 도구 연동 · CSV 내보내기 감사 · 설문 정의 시뮬레이터 오버레이 · 완료자 한정 분포 필터 · **컨텍스트 폼 버튼 6개 이상 표시 결함 수정**(§22 D-11 — 별도 과제).

---

## 21. 알려진 제한

| # | 제한 | 수용 근거 · 완화 |
|---|---|---|
| K-1 | 이전 문항 버튼 재클릭이 현재 문항 답으로 적재될 수 있다(연속 척도에서 오답) | 위젯 변경 0(P-4). 현재 문항 기준 판정 · No.46 |
| K-2 | 여러 `sessionId`를 쓰는 표 부풀리기를 근본 차단할 수 없다 | P-7 — 레이트리밋이 상한 · 식별자 추가 수집은 No.45 |
| K-3 | 조회 시점 이탈 판정은 **현재** `sessionTimeoutMinutes`를 쓴다 — 타임아웃을 바꾸면 과거 시도의 진행 중/이탈 분류가 소급해 바뀐다 | 배치 없는 설계의 귀결. 문구 필드라 잠금 대상이 아니다 — 편집기에 "진행 중·이탈 집계 기준도 함께 바뀝니다" 안내 |
| K-4 | 같은 세션의 두 탭이 **동시에** 완료하면 둘 다 비중복일 수 있다 | SQLite 쓰기 직렬화로 사실상 발생하지 않음. Postgres 전환 시 완료 트랜잭션을 `Serializable` 대상에 추가 |
| K-5 | 자유 텍스트의 이름·주소는 가려지지 않는다 | ADR-0013 §6 — 편집기·결과 화면 고지 |
| K-6 | 컨텍스트 폼 `CHOICE` 슬롯의 6번째 선택지부터 버튼이 없다(기존 결함) | 이 그룹 범위 밖(바이트 동일 우선) — §22 D-11 |
| K-7 | v1 `SURVEY`는 계속 실행되지 않는다 | P-15 — 편집기 전환 · 계측 스크립트 |
| K-8 | 완료 후 이동 노드가 없는 설문 턴은 응답출처 `OTHER` | 분류 무변경(FR-0-113) |
| K-9 | 버전 복원 후 참조 설문의 상태가 캡처 당시와 다를 수 있다 | 설문은 스냅샷 밖(P-6) — 복원 경고 |
| K-10 | API 롤백 시 v2 `SURVEY`는 구버전에서 "미지원 안내"로 수렴한다 | 오류 없음(§3.6) — 롤백 전 공지 |
| K-11 | 자유 텍스트 문항에 실제 질문을 입력하면 응답으로 저장된다 | 컨텍스트 폼과 같은 구조적 한계(EX-SV-6) — 안내 문구·`그만하기` |
| K-12 | 운영 위젯으로 한 관리자 테스트 응답은 일반 응답과 구분되지 않는다 | 시뮬레이터 미리보기 권고 · 섞였으면 복제 후 재오픈(EX-SV-24) |
| K-13 | 마지막 문항 응답 적재가 실패하면 완료 행의 `missingRequiredCount`가 1 이상이 된다 | 적재 실패는 드묾(경고 로그) — "누락 있는 완료"로 표시 |

---

## 22. 요구사항 대비 해석 (architect 판단)

| # | 요구사항 | 해석·변경 | 근거 |
|---|---|---|---|
| D-1 | J-4 엔진 통합 | **정지점 재사용 안 함 — 세션형 + 결과 동봉 + 사후 적재** 확정 | 설문의 다음 출력은 입력과 정의만으로 결정된다(ADR-0034 근거 99행의 정지 조건 불충족). 턴당 정지 1회 규약과 충돌하지 않아 API 분기 노드에서도 시작된다 |
| D-2 | FR-0-109 봉투 필드 | 요구사항 목록(설문 id·구조 버전·순번·재시도·시각)에 **`nodeId`·`outputIndex`** 추가 | 완료 후 이동 노드는 설문이 아니라 **노드 아웃풋**의 속성이다. 값을 봉투에 두지 않고 포인터로 현재 정의를 다시 찾는다(편집 반영·조작 이득 0 — 임의 `nodeId` 이동은 `NODE` 버튼으로 이미 가능) |
| D-3 | FR-SV4-10 취소어 | **정규화 전체 일치**(컨텍스트 폼의 `containsWord`와 다름) | 자유 텍스트 답 "이제 그만 좀 늦었으면…"이 취소로 오판되면 응답이 사라진다. 버튼 `그만하기`는 전체 일치로 충분 |
| D-4 | FR-SV4-12 사유 `NOT_FOUND` | 진행 중 설문 삭제는 **sanitize 폐기(`UNKNOWN_SURVEY`)로 수렴**, 종료 안내 없음 | 노출 행이 있는 설문은 삭제 불가(`SURVEY_HAS_RESPONSES`)라 공개 경로에서 발생하지 않는다. 시뮬레이터·TC에서만 가능 |
| D-5 | FR-SV4-12 마감 | 진행 중 세션은 **기간 종료(`activeTo` 경과)도 `CLOSED` 사유로 종료** | 기간은 "대화 시점 판정"(P-16)이고 기간 밖 응답을 받으면 기간의 의미가 없다 |
| D-6 | FR-SV2-4 잠금 기준 "ANSWERED 1건" | **답 행(ANSWERED·SKIPPED) 1건 이상** | 건너뜀 수·도달 퍼널도 문항 키에 묶인 통계다. 건너뜀만 있는 설문의 구조 변경을 허용하면 과거 건너뜀이 사라진 문항을 가리킨다 |
| D-7 | FR-SV5-4 `isDuplicate` | **노출 시점에도 판정**(이미 완료한 세션의 재노출 = 중복) | 완료 시점만 보면 봉투를 조작한 재노출이 이탈하면 이탈률을 오염시킨다. 노출 턴 읽기 1회 |
| D-8 | 요구사항 §5.2 `SurveyAnswer` | `isHead`·`channelType`·`isDuplicate` 비정규화 추가(`dayBucket`은 요구사항 그대로) | 조인 없는 `groupBy`(답 50만 행 P95 1초). `isDuplicate`는 완료 시점 재판정 시 같은 쓰기 주체가 갱신 |
| D-9 | NFR-SVP2 "추가 읽기 1건 이하" | 응답 턴 1 · **노출 턴 1 · 완료 턴 3** | 필수 누락·중복 판정은 서버가 가져야 하는 판단이다(P-2). +30ms 예산 안 |
| D-10 | §5.4 엔드포인트 10개 | **11개 — `GET …/text-answers` 추가** | 자유 텍스트 목록의 페이지네이션(FR-SV11-5)을 문항별 통계 응답에 넣으면 응답 크기가 무한히 커진다 |
| D-11 | 숨은 결함 ③ `context-session.ts:116` `slice(0,5)` | **이 그룹에서 고치지 않는다.** 설문은 자체 5개 분할(§5.11) | 컨텍스트 폼 출력의 바이트가 바뀌는 의도된 동작 변경이며 FR-0-107(기존 결과 불변)·닫힌 목록 밖이다. 선택지 라벨 상한도 50자(`dialogue.ts:315`)로 버튼 라벨 40자와 어긋나는 두 번째 결함이 함께 있다 — **별도 과제로 PM 확인**(§보고) |
| D-12 | 숨은 결함 ① `design-validator.ts:402-404` | `isUnsupportedOutput(o) && o.type !== 'API_CONDITION'` | 단순 교체는 v1 `API_CONDITION`을 INFO에 되살려 No.26(§5.9 ④)을 회귀시킨다 |
| D-13 | (신규 결함) `overlay.ts:44-53` | `mergeOverlay`가 `surveys` 이월 — **닫힌 목록 ⑨ 추가** | 없으면 오버레이 시뮬레이터·TC B측에서 설문이 전부 `NOT_FOUND` — A/B 비교가 거짓 차이를 낸다 |
| D-14 | (성능·격리) | 설문이 입력을 소비할 턴은 **의미 점수 계산 생략**(`willSurveyConsumeInput`) | "4점"·"1,3"에 임베딩 1회(≤300ms)·ml-worker 부하·질의 LRU 캐시 오염을 쓰지 않는다. 타임아웃·마감 턴은 false라 일반 처리에 의미 매칭이 유지된다 |
| D-15 | FR-SV5-9 "`sessionInProgress`가 `surveySession`도 보게" | **`shouldRunRag` 입력 `surveyTurn` 추가**(엔진 결과 기준) | 봉투만 보면 타임아웃 후 일반 처리된 실제 질문("환불 방법 알려줘")까지 RAG에서 빠진다. `apiTurn`(No.26) 선례 |
| D-16 | (신규 발견) `legacy-api-sealing.spec.ts:159-163` L-12 | **기대 키 집합 3 → 5키로 갱신**(의도된 변경) + S-9가 설문 세션 키 집합을 따로 고정 | L-12의 목적("응답값의 상태 이월 금지")은 S-9로 더 정밀하게 유지된다 |
| D-17 | FR-SV10-2 번들 설문 필드 "선택·기본 `[]`" | **`.optional()`**(`.default([])` 아님), 엔진은 `?? []` | `.default([])`는 zod 출력 타입에서 필드를 **필수**로 만들어 6키 번들 리터럴(`hydrateSnapshot`·`matcher.ts:104`·스펙 다수)이 컴파일 실패한다(FR-0-107 위반) |
| D-18 | FR-SV1-5 쓰기 가드 | 기존 API 가드 → 설문 가드 순서 · 복사 시 v1 SURVEY 제외 수를 **별도 필드**로 | 기존 응답·필드(`excludedLegacyApiOutputCount`) 불변 |
| D-19 | FR-SV10-5 "모든 스코프 질문 순위" | **대시보드 `topQuestions`(No.2) 포함 5곳** | 대시보드 인기 질문도 질문 순위다. 기존 행은 전부 false라 No.2 수치 불변(FR-0-113) |
| D-20 | FR-SV9-4 배지 | `TestRunResult.surveyPreviewA/B` 컬럼 | 결과 행 단위 기록처가 달리 없다(No.26 `apiMockA/B` 선례) |
| D-21 | FR-SV2-10 목록 통계 | 목록(`dialogue:read`)에 최근 30일 노출/완료 포함 | 세 역할 모두 `chatbot:read` 보유 — 노출 차이 0. 선택기와 목록을 1개 경로로 |
| D-22 | FR-0-115 "기존 코드 재사용" | 상태 전이 `INVALID_STATUS_TRANSITION` · 50개 초과 `LIMIT_EXCEEDED` · 오픈 검증 `VALIDATION_FAILED` | 신규 4종 외 코드를 만들지 않는다 |
| D-23 | FR-SV5-8 `surveyTurn` 판정 | 엔진 결과 `surveyTurn`(= 설문이 입력을 소비)만 사용 — API가 추정하지 않는다 | 판정 1곳 |
| D-24 | FR-SV4-3 고정 문구 우선순위 | 미지원 아웃풋 안내가 설문 안내보다 **우선** | 기존 0건 폴백 동작 보존(v1 SURVEY + v2 SURVEY 혼재 노드) |
| D-25 | FR-SV4-1 ⑤ 미리보기 | 미리보기도 `completedSurveyIds` 재노출 방지는 **적용** | TC가 봉투를 이어 가므로 결정적이고, 같은 탭 재노출 방지는 설문 정의와 무관한 UX 규약이다 |

---

## 23. GPU · 배포 형태

- **GPU 1 유지**(P-17): 문자열 정규화 · 선택지/숫자 판정 · DB `groupBy` · CSV 직렬화 — §1 기준표 "1~2 CPU 전용". 새 모델·추론·임베딩 0, ml-worker 호출 0(**오히려 설문 턴의 임베딩 호출이 줄어든다** — D-14). 자유 텍스트 요약·감성 분석(GPU)은 범위 밖.
- **구축형 ○**: 외부 의존·아웃바운드 0건. 응답은 고객 DB에만 저장된다. 폐쇄망 그대로 동작.
- **구독형 ○(전제 명시)**: 상태 없는 조회 + DB 적재 1곳이라 다중 인스턴스 조정이 없다(쓰기 가드·유일 제약이 DB에 있어 인스턴스 간 중복도 흡수). ⚠ 자유 텍스트가 **고객의 최종 사용자 데이터**를 우리 인프라에 저장하게 된다 — 보존·파기·위치 요구는 No.45(고객 약관 반영은 운영 문서 과제).
