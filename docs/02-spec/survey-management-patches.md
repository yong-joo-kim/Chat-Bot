# No.27 설문관리 — 기존 문서 패치 목록

> 작성: system-architect · 2026-09-24 · 근거: `docs/02-spec/survey-management-설계.md`, `docs/02-spec/decisions/ADR-0035-survey-dialogue-session-and-server-response-ledger.md`
> **적용 상태**: ✅ **적용 완료(2026-09-24)** — 오케스트레이터 세션이 55건 전부 "찾을 원문 정확히 1회" 확인 후 기계적으로 적용했다.
> **적용 방법**: 각 항목의 "찾을 원문"을 대상 파일에서 **정확히 1회** 찾아 "바꿀 내용"으로 교체한다. 모든 원문은 2026-09-24 시점 파일(No.26 패치 적용 후)에서 복사했고 문자열 검색(Grep)으로 대상 파일 안 유일성을 확인했다. "append" 항목은 원문을 그대로 포함한 채 뒤에 덧붙인다.
> **줄바꿈 주의**: 대상 파일은 CRLF일 수 있다. 모든 "찾을 원문"은 **한 줄 안의 부분 문자열**(줄바꿈 미포함)로 잡았다. "바꿀 내용"의 줄바꿈은 대상 파일의 줄바꿈으로 정규화한다.
> **순서 독립**: 어떤 "바꿀 내용"도 다른 항목의 "찾을 원문"을 새로 만들지 않는다.
> 코드 변경은 이 파일의 범위가 아니다 — 설계서 §2.5 체크리스트를 따른다.
> 항목 수: 개발명세서 31 · ADR 11 · 기능요구사항 1 · 선행 요구사항 6 · 대화 설계 설계서 2 · UI 스펙 2 · 설문관리 요구사항(PM 결정 기록) 2 = **55건**

---

## A. `docs/02-spec/개발명세서.md`

### A-1. §2 워크스페이스 상태 표 — `surveys`·`survey-responses` 행 추가

**찾을 원문**
````text
시크릿 DB 미저장**(ADR-0034) |
````
**바꿀 내용**
````text
시크릿 DB 미저장**(ADR-0034) |
| **`apps/api/src/surveys`** · **`apps/api/src/survey-responses`** · `apps/api/src/stats/surveys` | **설문관리 Phase에 신설**(No.27) — 챗봇별 설문 정의 CRUD(구조 잠금·복제·마감)·★응답 쓰기 유일 모듈(`SurveyResponseService` — export 1개, import처 = 공개 대화 1곳)·읽기 전용 참여 통계/응답 목록/CSV(`StatsModule` 확장). **`packages/dialogue-engine`을 닫힌 목록으로 수정**(순수 설문 세션 · S0 단계 · `resumeAfterApiCall` 설문 필드 이월 · `surveyTargets` · `mergeOverlay` 설문 이월 — 정지점 미사용, 엔진 I/O 0건 정적 검사) · **ml-worker·widget 변경 0건 · `@Public()` 추가 0건 · 신규 권한 0종 · 신규 환경변수 0개 · 봉투 버전 1 유지**(ADR-0035) |
````

### A-2. §2.2 기능그룹별 모듈 배치 표 — No.27 행 추가

**찾을 원문**
````text
**설계 완료 → `legacy-api-integration-설계.md`** |
````
**바꿀 내용**
````text
**설계 완료 → `legacy-api-integration-설계.md`** |
| **설문관리 (No.27)** | **`surveys`(신규 — 설문 정의 CRUD·구조 잠금 409·상태 전이·복제·삭제 409 2종·감사·번들 무효화) + `survey-responses`(신규 — ★`SurveyResponse`/`SurveyAnswer` 쓰기 유일 파일 `SurveyResponseService`: 쓰기 키·순서 증가 가드·값 재검증·자유 텍스트 금지어→PII 마스킹·중복 표시, export 1개) + `stats/surveys`(신규 — 요약·문항별·응답 목록·자유 텍스트·CSV 2종, 읽기 전용)** + `packages/dialogue-engine`(닫힌 목록 수정 — 설문 세션·S0·재진입 이월·참조 편입·설계 점검·오버레이) · `conversation`(④.6 응답 적재·의미 점수 생략·RAG/미응답 제외·`surveyTurn`) · `simulation`(미리보기 토글·설문 단계·비교 미리보기) · `validation`(TC 미리보기 판정·`surveyPreviewA/B`) · `dialog-nodes`(v1 쓰기 거부·v2 참조 검증·복사 제외) · `dialogue-common`(번들에 설문·삭제 409 규칙) · `stats`(질문 순위 `surveyTurn` 제외 1벌) · `versions`(복원 경고 3종·무결성 경고) · `chatbots`(영구삭제 사전검사 11종) | **설계 완료 → `survey-management-설계.md`** |
````

### A-3. §2.2 주석 블록 — 엔진 확장·모듈 의존 방향(No.27) 추가

**찾을 원문**
````text
버전 복원 경고는 Prisma 읽기로 연결 존재만 확인한다(FR-0-102, ADR-0030 형식).
````
**바꿀 내용**
````text
버전 복원 경고는 Prisma 읽기로 연결 존재만 확인한다(FR-0-102, ADR-0030 형식).
>
> **엔진 확장(설문관리 No.27)**: FR-0-78·88 "엔진 불가침"의 **두 번째 의도된 예외**이며 **닫힌 목록**으로 한정한다 — ① `executeOutputs`의 v2 `SURVEY` 분기(참여 가능 → 시작·종결 / 불가 → 건너뜀·계속) ② 순수 설문 세션 `survey-session.ts`(컨텍스트 세션의 형제) ③ 파이프라인 **S0 설문 세션 단계**(S1과 상호 배타)·버튼 전환 `SWITCHED`·완료 후 이동 ④ `sanitizeConversationState`의 설문 필드 **분리 파싱** ⑤ **`resumeAfterApiCall`의 다음 상태 조립에 설문 필드 이월** ⑥ `getOutgoingNodeRefs().surveyTargets` ⑦ 결과 선택 필드 `surveyEvents`·`surveyTurn` ⑧ 설계 점검 미지원 판정을 공용 함수 기반으로 교체 + 설문 점검 6종 ⑨ **`mergeOverlay`의 설문 이월**. **정지점(ADR-0034)은 쓰지 않는다** — 설문의 다음 출력은 입력과 정의만으로 결정되고 DB는 기록만 한다. 응답 판정·문항 출력 순수 함수는 웹 미리보기와 공유하기 위해 `shared-types/survey-logic.ts`에 둔다. 엔진은 여전히 **I/O·타이머·`Date.now()`·난수·Nest·Prisma 심볼 0건**이다. 설문이 없는 번들·봉투의 모든 소비자 결과는 바이트 단위로 불변이다(ADR-0035 §3).
>
> **모듈 의존 방향(No.27)**: `surveys → chatbots / dialogue-common / audit-logs` · `survey-responses → banned-words / prisma` · `conversation → survey-responses` · `stats(surveys/) → chatbots / prisma` 단방향이다. **`SurveyResponsesModule`은 `SurveyResponseService` 1개만 export하고 import처는 `ConversationModule` 1곳뿐**이다 — `simulation`·`validation`·`versions`·`deploy-schedules`·`stats`는 응답을 **저장할 수단이 DI 그래프에 없다**(FR-0-112, ADR-0030 형식). 설문 결과 조회는 `StatsModule` 안에 있어 통계 모듈 Prisma 쓰기 0건 봉인(R-8)이 그대로 적용된다.
````

### A-4. §3 엔터티 표 — `Survey`/`SurveyResponse` 예고 행 실체화

**찾을 원문**
````text
| `Survey` / `SurveyResponse` | 설문관리 | 27 |
````
**바꿀 내용**
````text
| **`Survey`** | **챗봇별 설문 정의(No.27, ADR-0035 §1).** 이름(`nameNormalized` 챗봇 내 유일)·설명·상태(`DRAFT`/`OPEN`/`CLOSED` — `DRAFT→OPEN`·`OPEN↔CLOSED`)·선택 기간(`activeFrom`/`activeTo` — 대화 시점 판정)·소개/완료 문구·취소어·타임아웃·문항 JSON(단일/다중 선택·척도 `STAR_5`/`NPS_11`·자유 텍스트, 1~20개, **문항·선택지 key는 생성 후 불변**)·`structureVersion`. 챗봇당 50개. 쓰기 주체 = `SurveysService` 1파일. **답 행이 생긴 뒤 구조 변경은 `409 SURVEY_STRUCTURE_LOCKED`**(문구 수정 허용 · 구조는 복제). 대화 번들에 포함(선택 필드). **스냅샷 대상이 아니다**(응답에 묶인 자산 — 노드의 참조만 스냅샷) | 27 |
| **`SurveyResponse`** | **설문 응답 시도 1건(노출~완료/이탈, No.27).** 쓰기 키 `(chatbotId, sessionId, surveyId, startedAt)` 유일 · 상태(`EXPOSED`/`IN_PROGRESS`/`COMPLETED`/`ABANDONED`)·이탈 사유·`started`·`lastQuestionIndex`(순서 증가 가드·도달 퍼널)·`lastInteractedAt`·`missingRequiredCount`·**`isDuplicate`**(같은 세션의 앞선 완료 — 통계 기본 제외)·**노출 당시 `groupId` 스냅샷**·`dayBucket`(KST 노출일, 불변). **무응답 이탈은 행을 바꾸지 않고 조회 시점에 판정**한다. IP·User-Agent·쿠키 컬럼이 없다. 쓰기 주체 = `SurveyResponseService` 1파일 · **삭제 코드 0건**(ADR-0033 봉인 확장) | 27 |
| **`SurveyAnswer`** | **문항 응답(No.27).** 선택 유형은 **선택지 1개당 1행**(문항당 대표 행 `isHead` 1개 — DB `groupBy`로 분포) · 척도 정수 · 자유 텍스트 **금지어→PII 마스킹본만**(원문 컬럼 없음) · 건너뜀. **라벨이 아니라 key만 저장**(라벨 수정이 과거 응답을 흔들지 않는다). `dayBucket`·`channelType`·`isDuplicate` 비정규화(조인 없는 집계). `(responseId, questionKey, choiceKey)` 유일(멱등). 쓰기 주체·삭제 봉인은 `SurveyResponse`와 같다 | 27 |
````

### A-5. §3 엔터티 표 — `ConversationLog` 행에 `surveyTurn`

**찾을 원문**
````text
정적 검사가 단언한다(ADR-0033)** | 14, 15, 29, 30 |
````
**바꿀 내용**
````text
정적 검사가 단언한다(ADR-0033)** **[No.27] `surveyTurn`은 이번 턴 입력을 설문 세션이 소비했는지(응답·건너뛰기·재질문·취소·완료)를 표시한다 — 노출 턴·타임아웃 후 일반 처리 턴은 false. 질문 순위(모든 스코프)·미응답 수집에서 제외하는 근거이며 파생 불가 컬럼이다(ADR-0004 통과). 기존 행 = false가 사실이라 백필 없음, 인덱스 없음(ADR-0035 §7)** | 14, 15, 27, 29, 30 |
````

### A-6. §3 엔터티 표 — `DialogNode` 행에 `SURVEY` v1/v2 규약

**찾을 원문**
````text
조회 응답에서 헤더 값·본문 템플릿을 가린다(ADR-0034 §7)** | 5, 26 |
````
**바꿀 내용**
````text
조회 응답에서 헤더 값·본문 템플릿을 가린다(ADR-0034 §7)** **[No.27] `SURVEY` payload도 읽기 = v2(`version: 2` — 같은 챗봇 `surveyId` + 선택 `onCompleteNodeId`) ∪ v1(No.5 자유 문자열 키 — 실행 안 함), 쓰기 = v2만(`400 SURVEY_OUTPUT_LEGACY_FORMAT`). v1 키로 설문을 자동 연결·변환하지 않는다(ADR-0035 §9)** | 5, 26, 27 |
````

### A-7. §3 미도입 결정 머리 — 11건 → 12건

**찾을 원문**
````text
> **미도입 결정 11건**
````
**바꿀 내용**
````text
> **미도입 결정 12건**
````

### A-8. §3 미도입 결정 ⑫ 신설 — 설문 관련 미도입

**찾을 원문**
````text
운영에 보이지 않는 준비 편집(draft/published)은 No.40의 본체**다(**ADR-0032**).
````
**바꿀 내용**
````text
운영에 보이지 않는 준비 편집(draft/published)은 No.40의 본체**다(**ADR-0032**).
> ⑫ **설문 진행 세션 테이블·설문 리비전(버전별 통계) 테이블·응답자 식별(IP·쿠키·핑거프린트) 테이블·설문 롤업(사전 집계) 테이블·응답 원문 테이블·설문↔노드 조인 테이블·응답 알림 테이블** — 진행 상태는 봉투의 **포인터**로 충분하고 응답 값은 매 턴 서버에 적재되므로 세션 테이블의 이득(포인터 위변조 방지)은 서버 쓰기 가드가 대부분 얻는다(ADR-0009 결정 1 유지). 리비전은 통계·CSV·집계 전부에 버전 축을 만든다 — **구조 잠금 + 복제**로 대체. 식별자 추가 수집은 개인정보 범위를 넓힌다(No.45). 이탈은 조회 시점 판정이라 배치·롤업이 필요 없다. 노드 → 설문 참조는 `outputs` JSON 안(`ApiConnection` 선례 — 삭제 409는 앱 레벨)(**ADR-0035**).
````

### A-9. §3 미도입 결정 ③ — `ConversationLog` 파생 컬럼 제한의 No.27 보론

**찾을 원문**
````text
대화 로그에 관측 필드를 섞지 않는다).
````
**바꿀 내용**
````text
대화 로그에 관측 필드를 섞지 않는다). **[No.27] 설문관리 그룹도 `surveyTurn` 1개만 추가했다** — 파생 불가(어떤 턴을 설문이 소비했는지는 로그 행만으로 알 수 없다)이며 질문 순위·미응답 수집이 실제로 소비한다. 설문 문항 번호·응답 값은 로그에 섞지 않는다(응답은 `SurveyAnswer`).
````

### A-10. §3.1 참조 무결성 — FK 미설정 예외에 설문 응답 필드 추가

**찾을 원문**
````text
**`ConversationLog.groupId`**(No.29 — 대화 당시 그룹 스냅샷.
````
**바꿀 내용**
````text
**`SurveyResponse`의 `groupId`/`exposedNodeId`/`conversationLogId`**·**`SurveyAnswer.surveyId`**(No.27 — 노출 당시 그룹 스냅샷·노출 노드·노출 턴 로그는 사실 기록이고, 답 행의 `surveyId`는 조인 없는 집계용 비정규화 사본이다 — 응답 행이 `Survey`에 `Restrict` FK를 가진다), **`ConversationLog.groupId`**(No.29 — 대화 당시 그룹 스냅샷.
````

### A-11. §3.1 파생 데이터 동반 삭제 — 설문 3종은 동반 삭제 대상이 아님

**찾을 원문**
````text
**`ApiConnection`은 전역 설정이라 챗봇 영구삭제와 무관하다.**
````
**바꿀 내용**
````text
**`ApiConnection`은 전역 설정이라 챗봇 영구삭제와 무관하다.** **[No.27] `Survey`·`SurveyResponse`·`SurveyAnswer`는 이 분류가 아니다** — 설문 정의는 대화 자산, 응답은 참여 통계의 유일한 원천이므로 **영구삭제 사전검사(409) 대상**(`설문`·`설문 응답` — 9 → 11종)이며 동반 삭제 목록(15테이블)에 넣지 않는다. 응답이 있는 설문은 설문 단위로도 삭제할 수 없다(`409 SURVEY_HAS_RESPONSES` → 마감). 응답 삭제 코드 0건을 `survey-sealing.spec.ts`가 단언한다(ADR-0033 봉인 확장, ADR-0035 §8).
````

### A-12. §3.1 인덱스 — No.27 인덱스 추가

**찾을 원문**
````text
`api_call_logs(connectionId, createdAt)`(연결 목록 24시간 통계).**
````
**바꿀 내용**
````text
`api_call_logs(connectionId, createdAt)`(연결 목록 24시간 통계).** **[No.27] `surveys(chatbotId, nameNormalized) UNIQUE`, `surveys(chatbotId, updatedAt)`, `survey_responses(chatbotId, sessionId, surveyId, startedAt) UNIQUE`(쓰기 키 — 선두 3열 접두가 같은 세션 중복 판정·챗봇 사전검사 count를 겸한다), `survey_responses(surveyId, dayBucket)`(노출일 코호트 집계·목록), `survey_answers(responseId, questionKey, choiceKey) UNIQUE`(멱등), `survey_answers(surveyId, questionKey, dayBucket)`(문항별 분포·자유 텍스트 목록·잠금 판정). `conversation_logs.surveyTurn`에는 인덱스를 두지 않는다(불리언 — `answeredByRag`와 같은 판단).**
````

### A-13. §4 API 표 — 설문 행 구체화(`/surveys` → 챗봇 스코프 중첩)

**찾을 원문**
````text
| 연동(설문) | `/surveys` | 27 |
````
**바꿀 내용**
````text
| **설문관리** | **`/chatbots/:chatbotId/surveys`(GET 목록 — 노드 편집기 선택기 겸용·최근 30일 노출/완료 포함 / POST 생성 — DRAFT), `GET｜PATCH｜DELETE .../surveys/:surveyId`(수정 = 상태 전이 포함·답 행 존재 후 구조 변경 `409 SURVEY_STRUCTURE_LOCKED` / 삭제 = 참조 노드 `409 SURVEY_IN_USE`·응답 있음 `409 SURVEY_HAS_RESPONSES`), `POST .../:surveyId/copy` — 이상 조회 `dialogue:read` / 쓰기 `dialogue:write`. `GET .../:surveyId/stats/summary｜stats/questions`(노출일 코호트·조회 시점 이탈 판정), `GET .../:surveyId/responses`(페이지네이션 필수·`sessionId` 미반환), `GET .../:surveyId/responses/export?kind=RESPONSES｜SUMMARY`(CSV — 기간 필수·최신 10,000행·`X-Export-Truncated`), `GET .../:surveyId/text-answers`(자유 텍스트 마스킹본 목록) — 이상 `chatbot:read`(`ARCHIVED` 조회 허용)**. 총 11개 핸들러 · 신규 권한 0종 · **`@Public()` 추가 0건 — 응답은 기존 공개 대화 경로로만 들어온다** | 27 |
````

### A-14. §4 API 표 — 품질/시뮬레이션 행에 `surveyPreview` 확장

**찾을 원문**
````text
`compare`는 A/B 같은 목** | 10, 26 |
````
**바꿀 내용**
````text
`compare`는 A/B 같은 목** **[No.27] `simulate` 요청에 `surveyPreview`(기본 false — 작성 중·마감·기간 밖 설문도 진행), 응답에 `surveyStep`(설문명·n/N·결과·사유·`saved: false` — 판정 값 미포함). 응답을 저장하지 않는다. `compare`·TC는 항상 설문 미리보기 판정(상태·기간 무시 — 결정론)** | 10, 26, 27 |
````

### A-15. §4 정정 이력 — 2026-09-24c 항목 추가

**찾을 원문**
````text
④ 신규 `ApiErrorCode` 2종 · 공개 경로 6곳 불변(`legacy-api-integration-설계.md` §12).
````
**바꿀 내용**
````text
④ 신규 `ApiErrorCode` 2종 · 공개 경로 6곳 불변(`legacy-api-integration-설계.md` §12).
> **정정 이력(2026-09-24c — 설문관리)**: ① 예고 행 `연동(설문) /surveys`(전역)를 **`/chatbots/:chatbotId/surveys/*` 11개 핸들러**로 정정했다 — 설문은 챗봇별 자산이며 전역 경로는 교차 챗봇 404 규약과 충돌한다(학습 고도화 `/training-jobs`·검증 `/test-cases` 정정과 같은 판단). ② 요구사항 초안 10개 → **11개**: 자유 텍스트 목록(`/text-answers`)을 문항별 통계 응답에서 분리했다(페이지네이션 — 응답 크기 무한 증가 방지). ③ 설문 응답 제출용 **공개 경로를 만들지 않는다** — 응답은 기존 `POST /public/chatbots/:slug/messages`의 대화 턴으로만 들어온다. ④ 신규 `ApiErrorCode` 4종 · 공개 경로 6곳 불변(`survey-management-설계.md` §13).
````

### A-16. §4.1 오류 봉투 — No.27 오류 코드 4종

**찾을 원문**
````text
실패 분기 노드 또는 고정 안내 문구로 수렴한다 |
````
**바꿀 내용**
````text
실패 분기 노드 또는 고정 안내 문구로 수렴한다. **설문관리 그룹이 4종 추가** — `SURVEY_OUTPUT_LEGACY_FORMAT`(400, v1 자유 키 형식 `SURVEY` 저장 시도), `SURVEY_IN_USE`(409, 노드가 참조 중인 설문 삭제), `SURVEY_HAS_RESPONSES`(409, 응답(노출 포함)이 있는 설문 삭제 — 마감으로 대체), `SURVEY_STRUCTURE_LOCKED`(409, 답 행 존재 후 구조 변경 — 복제 안내). 없는 설문·완료 후 이동 노드·타 챗봇 설문은 `INVALID_REFERENCE`(404), 이름 중복 `DUPLICATE_NAME`, 챗봇당 50 초과 `LIMIT_EXCEEDED`, 불허 상태 전이 `INVALID_STATUS_TRANSITION`, 오픈 검증 실패 `VALIDATION_FAILED`를 재사용한다. **설문 불가도 공개 API 오류가 아니다** — 건너뜀·고정 안내 문구로 수렴한다 |
````

### A-17. §5 성능 — No.27 항목 추가

**찾을 원문**
````text
**예산 미달을 이유로 타임아웃 상한을 조용히 올리지 않는다**(ADR-0034 §5).
````
**바꿀 내용**
````text
**예산 미달을 이유로 타임아웃 상한을 조용히 올리지 않는다**(ADR-0034 §5).
  - **[신규 2026-09-24 — 설문관리] 설문이 개입하지 않은 턴의 공개 대화 예산(P95 500ms)은 불변**이다(추가 조회 0 — 설문 정의는 번들 캐시, 봉투 키 유무·이벤트 유무 분기 2개). **설문 턴(노출·응답·완료)은 기존 예산 + 30ms**(읽기 1~3·쓰기 1~2 — 응답 적재만 await, 로그는 기존대로 fire-and-forget). **설문이 입력을 소비할 턴은 의미 점수(임베딩) 계산을 생략**해 오히려 임베딩 1회를 절약하고 질의 LRU 캐시를 설문 답으로 오염시키지 않는다. 응답 판정 문항당 1ms. 통계 기준 데이터 **설문 1개 = 노출 10만·답 50만 행**에서 요약(일 30일) P95 1초 · 월 24개월 2초 · 문항별 1초 · 응답 목록 300ms · CSV 10,000행 5초(초과 `503 AGGREGATION_TIMEOUT`) — 모든 집계가 `groupBy` + 순수 조립이며 반환 행 수가 응답 수와 무관하다. 설문 목록은 설문 수와 무관한 쿼리 수(N+1 금지). TC 처리량 500 TC/분 불변(ADR-0035).
````

### A-18. §5 보안 — 설문 응답의 개인정보·봉인 항목 추가

**찾을 원문**
````text
`legacy-api-sealing.spec.ts` **L-1~L-14**로 강제한다.
````
**바꿀 내용**
````text
`legacy-api-sealing.spec.ts` **L-1~L-14**로 강제한다.
  - **[신규 2026-09-24] 설문 응답의 개인정보·봉인(ADR-0035)**: ① **PII "저장" 지점의 두 번째 테이블** — 자유 텍스트 응답은 `ConversationLogService.record()`와 **같은 함수·같은 순서**(금지어 → PII)로 마스킹한 값만 `SurveyAnswer.textValue`에 저장한다(원문 컬럼 0 · 함수 1벌). 이름·주소 미탐 한계는 편집기·결과 화면에 고지한다. ② **대화 상태 봉투에는 설문 진행 포인터만** 둔다(설문 id·구조 버전·시작 노드 위치·문항 순번·재시도 수·시각) — 응답 값·완료 판정·서버 발급 id 없음, `CONVERSATION_STATE_VERSION` 1 유지. 응답 데이터의 신뢰 근거는 서버 **쓰기 가드**(쓰기 키 `(chatbotId, sessionId, surveyId, startedAt)` · 상태 · 구조 버전 · 문항 키 · 순서 증가 · 값 재검증)다. ③ **응답 삭제 경로 0건** — `SurveyResponse`·`SurveyAnswer`의 `delete*`·원시 `DELETE` 0, 쓰기 1파일, FK `Restrict`(ADR-0033 봉인 확장). ④ 응답자 식별은 `sessionId`뿐 — **IP·User-Agent·쿠키를 수집하지 않으며** 여러 세션을 이용한 표 부풀리기는 **근본 차단 불가로 수용**한다(공개 레이트리밋이 상한). ⑤ 응답 목록·CSV에 `sessionId`를 싣지 않고, CSV는 수식 인젝션 방어(`escapeCsvCell`)를 거친다. ⑥ 서버 로그·trace·감사·오류 응답·시뮬레이터 응답에 응답 값 0. ⑦ 위 전부를 `survey-sealing.spec.ts` **S-1~S-14**로 강제한다. **[알려진 리스크]** 설문 응답(자유 텍스트 마스킹본)의 보존기간도 대화로그와 같이 **무기한**이다 — 악화도 개선도 아니며 No.45에서 결정한다.
````

### A-19. §5 가용성 — 설문 적재 실패 수렴

**찾을 원문**
````text
레거시 서비스의 예외는 응답 경로 밖으로 새지 않는다(ADR-0034 §5).
````
**바꿀 내용**
````text
레거시 서비스의 예외는 응답 경로 밖으로 새지 않는다(ADR-0034 §5). **[신규 2026-09-24] 설문 응답 적재 실패는 대화 실패가 아니다** — `SurveyResponseService.apply()`는 예외를 삼키고 값 없는 경고 로그만 남기며, 이후 문항은 순서 증가 가드로 계속 적재된다(공백 허용 — 완료 시 `missingRequiredCount`로 드러난다). 설문이 마감·변경·타임아웃되면 종료 안내 1줄 뒤 이번 입력을 일반 대화로 처리한다(ADR-0035 §3).
````

### A-20. §6 결정 13 — `SURVEY`도 형태로 판정(갱신 각주)

**찾을 원문**
````text
— ADR-0008 갱신 각주, ADR-0034 §1·§7.
````
**바꿀 내용**
````text
— ADR-0008 갱신 각주, ADR-0034 §1·§7.
    - **갱신(2026-09-24 — No.27)**: **`SURVEY`도 형태로 판정**한다 — v2(`version: 2`, 같은 챗봇 설문 참조)는 대화 내 멀티턴으로 실행하고 v1(자유 문자열 키)은 기존과 바이트 단위로 같은 미지원 처리를 유지한다. `UNSUPPORTED_OUTPUT_TYPES`는 **`['SCENARIO']`** 로 줄고 `isUnsupportedOutput()`에 v1 `SURVEY` 분기가 추가된다. 설계 점검은 미지원 판정을 상수가 아니라 공용 함수로 하도록 교체한다(상수에서 빼면 v1 `SURVEY`의 INFO가 조용히 사라지는 결함 — 단 v1 `API_CONDITION`은 전용 코드로 보고하므로 INFO에서 계속 제외). 엔진 수정은 닫힌 목록 9항목이며 **정지점을 쓰지 않는다**(ADR-0008 갱신 각주, ADR-0035 §3·§9).
````

### A-21. §6 결정 14 — 봉투 선택 필드 2종(갱신 각주)

**찾을 원문**
````text
새 pending 상태가 필요 없다(ADR-0020 §5).
````
**바꿀 내용**
````text
새 pending 상태가 필요 없다(ADR-0020 §5).
    - **갱신(2026-09-24 — No.27)**: 설문 진행을 위해 봉투에 **선택 필드 2개**(`surveySession` — 설문 id·구조 버전·시작 노드 위치·문항 순번·재시도 수·시각 / `completedSurveyIds` ≤20)를 더한다. **`version`은 1 그대로**이고(`pendingClarify` 선례 — 필드가 없으면 키를 생략해 기존 봉투와 바이트 동일), **응답 값·완료 판정·서버 발급 id는 담지 않는다** — §3 불변식("사용자가 직접 입력해도 같은 결과")이 유지되며 응답은 매 턴 서버가 재검증해 적재한다. sanitize는 설문 필드를 **분리 파싱**해 설문 필드가 불량해도 컨텍스트 세션을 버리지 않는다. 세션 테이블은 여전히 만들지 않는다(ADR-0009 갱신 각주, ADR-0035 §2).
````

### A-22. §6 결정 18 — PII "저장" 지점의 두 번째 테이블(갱신 각주)

**찾을 원문**
````text
**함수는 여전히 1벌**(ADR-0013 갱신 각주, ADR-0034 §9).
````
**바꿀 내용**
````text
**함수는 여전히 1벌**(ADR-0013 갱신 각주, ADR-0034 §9).
    - **갱신(2026-09-24 — No.27)**: 설문 자유 텍스트 응답이 **"저장" 지점의 두 번째 테이블**(`SurveyAnswer.textValue`)이 된다 — 적용 지점 수(저장 · RAG 송신 · 증강 송신 · 레거시 송신)는 그대로 4곳이며, 저장은 `record()`와 **같은 함수·같은 순서**(금지어 → PII)로 `SurveyResponseService` 1파일에서 수행한다. 원문 컬럼 0. 이름·주소 미탐(§6)은 편집기·결과 화면에 고지한다(ADR-0013 갱신 각주, ADR-0035 §4).
````

### A-23. §6 결정 20(권한) — No.27 갱신 각주

**찾을 원문**
````text
레거시 프록시 경로 0(ADR-0015 갱신 각주, ADR-0034 §10).
````
**바꿀 내용**
````text
레거시 프록시 경로 0(ADR-0015 갱신 각주, ADR-0034 §10).
    - **갱신(2026-09-24 — No.27)**: 설문관리는 **신규 권한 0종**이다(PM 확정 P-12). 설문 정의 조회 = `dialogue:read`, 생성·수정·상태·복제·삭제 = `dialogue:write`(대화 자산), 참여 통계·응답 목록·자유 텍스트·CSV = `chatbot:read`(VIEWER 포함 — 마스킹본만, VIEWER가 이미 마스킹 질문 원문을 질문 순위로 보는 것과 같은 등급), 시뮬레이터(미리보기 포함) = 기존 `simulation:read`(저장 0). `@Public()` 6곳 불변(ADR-0015 갱신 각주, ADR-0035 §12).
````

### A-24. §6 결정 21(감사) — No.27 갱신 각주

**찾을 원문**
````text
`ApiCallLog`(메타데이터 전용)가 맡는다(ADR-0016 갱신 각주, ADR-0034 §6).
````
**바꿀 내용**
````text
`ApiCallLog`(메타데이터 전용)가 맡는다(ADR-0016 갱신 각주, ADR-0034 §6).
    - **갱신(2026-09-24 — No.27)**: `AuditTargetType`에 **`Survey`**(16 → 17종 — 생성 `CREATE` · 수정 `UPDATE`(summary: 문구만/구성 변경) · 상태만 변경 `STATUS_CHANGE` · 복제 `COPY` · 삭제 `DELETE`)를 추가하고 **`AuditAction`은 추가하지 않는다**. 화이트리스트는 이름·상태·기간·**문항 수**·구조 버전·타임아웃뿐 — 문항 문구·선택지·안내 문구 본문은 담지 않는다. **응답 1건 1건·CSV 내보내기·통계 조회는 감사 대상이 아니다**(ADR-0016 갱신 각주, ADR-0035 §12).
````

### A-25. §6 결정 36 신설

**찾을 원문**
````text
→ **ADR-0034**(+ ADR-0008·0013·0015·0016·0022·0030·0031 갱신 각주)
````
**바꿀 내용**
````text
→ **ADR-0034**(+ ADR-0008·0013·0015·0016·0022·0030·0031 갱신 각주)

36. **설문관리(No.27)의 진행 방식·상태 위치·엔진 통합·응답 적재·잠금·통계·보존 확정(2026-09-24)**: `SURVEY`는 No.5부터 가리킬 실체가 없는 자유 문자열 키로 저장만 됐다. **① 챗봇별 설문 정의**(`Survey` — 챗봇당 50 · `/chatbots/:chatbotId/surveys` · 번들 포함 · 전역 `/surveys` 예고 정정, P-3). **② 대화 내 멀티턴 + 진행 포인터만 봉투**(선택 필드 `surveySession`·`completedSurveyIds` — 버전 1 유지 · 응답 값 없음 · 위젯 변경 0 · `@Public()` 추가 0, P-2·P-4). **③ 엔진 = 순수 설문 세션(S0) + 결과 선택 필드 `surveyEvents` → API 계층 사후 적재 — 정지점(ADR-0034) 미사용**(설문의 다음 출력은 입력과 정의만으로 결정된다 · 닫힌 목록 9항목 · `resumeAfterApiCall` 설문 필드 이월 · `mergeOverlay` 설문 이월 · 설계 점검 미지원 판정 교체). **④ 문항 단위 서버 적재 + 매 턴 재검증**(쓰기 키 `(chatbotId, sessionId, surveyId, startedAt)` · 상태·구조 버전·문항 키·순서 증가·값 재검증 · 선택지 1개당 1행 · key만 저장 · 자유 텍스트 금지어→PII 마스킹 · `isDuplicate` 표시만 · IP·쿠키 미수집, P-7·P-8). **⑤ 첫 답 행 후 구조 잠금 · 문구 수정 허용 · 복제**(P-5). **⑥ 스냅샷 밖**(참조만 · 끊기면 경고, P-6) · **설문 상태·기간은 대화 시점 판정 · No.28 변경 0**(P-16). **⑦ 응답 삭제 경로 0**(ADR-0033 확장 · 응답 있는 설문은 마감만 · 영구삭제 사전검사 11종 · 보존기간 No.45, P-9). **⑧ 참여 통계 = 노출일(KST) 코호트 · 조회 시점 이탈 판정(배치 없음) · 챗봇 스코프만 · `groupId` 스냅샷 적재**(P-10). **⑨ `ConversationLog.surveyTurn` → 질문 순위(모든 스코프 — 대시보드 포함)·미응답 수집·RAG에서 제외**(P-11). **⑩ 권한 신규 0 · 감사 `Survey`**(P-12) · **CSV 2종·10,000행·`sessionId` 제외·비감사**(P-13). **⑪ 시뮬레이터·TC 저장 0 · 시뮬레이터 미리보기 토글 · TC·비교는 상태·기간 무시(결정론)**(P-14). **⑫ v1 = 읽기 호환·실행 안 함·쓰기 400·자동 연결/변환 없음**(P-15 — AC-5-7 기대값 201 → 400 의도된 변경). 신규 `ApiErrorCode` 4종 · 신규 환경변수 0 · 외부 출구 추가 0. GPU **1 유지**(P-17). → **ADR-0035**(+ ADR-0002·0008·0009·0013·0015·0016·0019·0030·0031·0033·0034 갱신 각주)
````

### A-26. §7 인덱스 — 설계서 행 추가

**찾을 원문**
````text
| 요구사항: `docs/requirements/legacy-api-integration.md` |
````
**바꿀 내용**
````text
| 요구사항: `docs/requirements/legacy-api-integration.md` |
| **`survey-management-설계.md`** | **설문관리(No.27) — Prisma 변경안(`Survey`·`SurveyResponse`·`SurveyAnswer` 신설 + `ConversationLog.surveyTurn` + `TestRunResult.surveyPreviewA/B`, **비파괴·백필 0·v1 데이터 무변경**), v1 잔존 계측 스크립트, `SURVEY` v1/v2 스키마(판별 `version: 2`·쓰기 가드·복사 제외·자동 연결 없음), `survey.ts`·`survey-logic.ts`(응답 판정·값 재검증·문항 출력 — 엔진·웹 미리보기·쓰기 가드 공용), **엔진 닫힌 목록 9항목**(설문 세션·S0·완료 후 이동·버튼 전환·sanitize 분리 파싱·`resumeAfterApiCall` 이월·`surveyTargets`·설계 점검 교체+6종·`mergeOverlay` 이월 — 정지점 미사용), **봉투 상태 스키마·불변식·위변조 대응표**, 소비자 4곳(공개 적재·의미 점수 생략·시뮬레이터 미리보기·비교/TC 결정론), **`SurveyResponseService` 쓰기 키·가드 ①~⑦·답 행 형태·마스킹·실패 흡수**, 통계 지표 식·쿼리 계획(원시 SQL 0)·질문 순위 제외 1벌, CSV 2종, 권한(신규 0), 감사(`Survey`), 11개 엔드포인트·오류 4종, **봉인 정적 검사 S-1~S-14**, 성능 예산, 버전·예약·통합 통계, 콘솔 인계, 시험 포인트·의도된 기대값 변경 5건, 알려진 제한 13건, 요구사항 대비 해석 25건** | 요구사항: `docs/requirements/survey-management.md` |
````

### A-27. §7 인덱스 — ADR-0035 행 추가

**찾을 원문**
````text
FR-L1-\*~FR-L9-\*, AC-L1~L8 |
````
**바꿀 내용**
````text
FR-L1-\*~FR-L9-\*, AC-L1~L8 |
| **`decisions/ADR-0035-survey-dialogue-session-and-server-response-ledger.md`** | **설문관리 = 챗봇별 정의 · 대화 내 멀티턴 세션(정지점 미사용 — 봉투 누적·서버 세션 테이블·위젯 폼 기각) · 진행 포인터만 봉투(버전 1) · 문항 단위 서버 적재(쓰기 키·순서 증가·값 재검증) · 구조 잠금 + 복제 · 스냅샷 밖 · 응답 삭제 봉인(ADR-0033 확장) · 노출일 코호트·조회 시점 이탈 판정 · `surveyTurn`으로 질문 순위·미응답·RAG 제외 · v1 읽기 호환·쓰기 거부·자동 연결 없음 · 시뮬레이터/TC 저장 0·TC 미리보기 판정 · 신규 권한 0** | 요구사항 J-1~J-21, FR-0-106~117, FR-SV1-\*~FR-SV12-\*, AC-SV1~SV7 |
````

### A-28. §4.1 챗봇 스코프 규약 — 설문의 `ARCHIVED`·교차 챗봇 규칙

**찾을 원문**
````text
교차 챗봇 `scheduleId`는 `404`다 |
````
**바꿀 내용**
````text
교차 챗봇 `scheduleId`는 `404`다. **[No.27] 설문관리는 설문 정의 조회와 결과 조회(요약·문항별·응답 목록·자유 텍스트·CSV)를 `ARCHIVED`에서도 허용**하고(보관된 챗봇의 참여 실적을 볼 수 있어야 한다) 생성·수정·상태 변경·복제·삭제는 `409`다. 교차 챗봇 `surveyId`는 `404`다(노드 저장의 설문 참조는 `404 INVALID_REFERENCE`) |
````

### A-29. §5 DB 이식성 — 원시 SQL 0건 유지 · 조건부 갱신

**찾을 원문**
````text
이름 교환은 임시 키로 해결해 **신규 원시 SQL 0건**을 유지한다(ADR-0031).
````
**바꿀 내용**
````text
이름 교환은 임시 키로 해결해 **신규 원시 SQL 0건**을 유지한다(ADR-0031). **[No.27] 설문 통계는 원시 SQL을 추가하지 않는다** — 조회 시점 이탈 판정(`lastInteractedAt ≥ cutoff`)까지 Prisma `groupBy`의 `where`로 표현하고 나머지는 순수 조립이다(원시 SQL 보유 파일 3개 불변 — R-7). 설문 응답의 쓰기 가드는 **조건부 `updateMany` + 영향 행 수**로 순서 증가를 원자적으로 재확인한다(No.28 CAS와 같은 방식). 같은 세션 두 탭의 동시 완료 판정은 SQLite 쓰기 직렬화에 기대므로 Postgres 전환 시 완료 트랜잭션을 `Serializable` 지정 대상에 추가한다(ADR-0035 재검토 트리거).
````

### A-30. §5 접근성/UI 품질 — 대화형 설문 표시 원칙

**찾을 원문**
````text
출처 표기는 링크가 아닌 텍스트다(외부 경로를 열 수 없으므로 링크처럼 보이면 안 된다).**
````
**바꿀 내용**
````text
출처 표기는 링크가 아닌 텍스트다(외부 경로를 열 수 없으므로 링크처럼 보이면 안 된다).** **[No.27] 대화형 설문 문항은 진행 표시(`n/N`) + 문항 문구를 버튼보다 먼저 제공하고, 척도 버튼은 텍스트 라벨(`1점 매우 불만족`)로 표시하며 별 기호 단독으로 의미를 전달하지 않는다. 모든 문항에 `그만하기`를 상시 제공하고 텍스트 입력 응답을 항상 허용한다(버튼 5개 단위 분할 — 위젯 변경 0). 설문 편집기의 문항·선택지 순서 변경은 위/아래 버튼이며 잠긴 필드는 비활성 + 사유 텍스트, 결과 차트는 같은 값의 표를 함께 제공한다.**
````

### A-31. §5 확장성 — 설문이 추가한 단일 인스턴스 상태 0

**찾을 원문**
````text
연결 정보는 캐시하지 않는다(API 턴마다 PK 1회 조회 — 사용 중지 즉시 반영).
````
**바꿀 내용**
````text
연결 정보는 캐시하지 않는다(API 턴마다 PK 1회 조회 — 사용 중지 즉시 반영). **[No.27] 설문관리는 새 프로세스 로컬 상태를 추가하지 않는다** — 설문 정의는 기존 번들 캐시(무효화 = 설문 쓰기 직후)에 동거하고, 응답 중복·순서 판정은 DB 유일 제약·조건부 갱신이 최종 근거라 다중 인스턴스에서도 조정이 필요 없다.
````

---

## B. 기존 ADR (결정 본문은 수정하지 않는다 — 파일 끝 append)

### B-1. `docs/02-spec/decisions/ADR-0008-dialogue-resolution-pipeline.md` — `SURVEY`도 형태 판정 (append)

**찾을 원문**
````text
이미 저장된 v1은 자동 변환·삭제하지 않는다(ADR-0034 §7).
````
**바꿀 내용**
````text
이미 저장된 v1은 자동 변환·삭제하지 않는다(ADR-0034 §7).


---

## 갱신 (2026-09-24 — No.27: `SURVEY`도 형태로 판정 · 설계 점검의 상수 직접 사용 결함 · 정지점 없는 두 번째 엔진 확장)

설문관리(No.27, **ADR-0035**)가 `SURVEY`의 실행을 연다. §1~§3·§5~§8의 결정은 불변이다.

1. **`UNSUPPORTED_OUTPUT_TYPES = ['SCENARIO']`**. `SURVEY`는 v2(`version: 2`, 같은 챗봇 설문 참조)만 실행하고 v1(자유 문자열 키)은 이 ADR의 미지원 처리를 **바이트 단위 그대로** 받는다 — `isUnsupportedOutput()`에 v1 `SURVEY` 분기를 더한다.
2. **결함 기록 — 설계 점검이 공용 판정 함수가 아니라 상수를 직접 봤다**(`design-validator.ts` ⑧). No.26 갱신 1이 "판정 함수를 엔진·설계 점검·웹 배지가 공유"라고 했으나 설계 점검은 상수를 계속 썼고, 상수에서 `SURVEY`를 빼는 순간 v1 `SURVEY`의 INFO가 **조용히 사라진다**. 공용 함수 기반으로 교체하되 v1 `API_CONDITION`은 전용 코드(`API_LEGACY_FORMAT`)로 보고하므로 INFO에서 계속 제외한다(단순 교체 시 No.26 회귀).
3. **엔진 확장은 정지점 없이** 한다 — 설문의 다음 출력은 입력과 설문 정의만으로 결정되므로 §1의 순수·동기 계약 안에서 끝난다. 파이프라인 맨 앞에 **S0 설문 세션**(S1 컨텍스트 세션과 상호 배타)이 추가되고, 설문이 시작되면 `CONTEXT_FORM`과 같은 **종결자**(뒤 아웃풋 미실행)이며 참여할 수 없으면 건너뛰고 다음 아웃풋을 계속한다. 노드 출력이 결국 0건이면 §6의 기본 폴백 대신 **설문 고정 문구**(미지원 아웃풋 안내가 있으면 그것이 우선)로 "항상 최소 1건 응답"을 지킨다.
4. **§6 안전장치 보강**: 설문 재시도 상한 2회 · 완료 후 이동은 hop 1로 이어 센다(`HOP_LIMIT` 10 공유) · 완료 후 이동 대상이 끊겼으면 `BROKEN_REFERENCE` + 완료 문구로 종료.
5. 엔진 수정은 ADR-0035 §3의 **닫힌 목록 9항목**이며 엔진 I/O 0건 정적 검사가 계속 단언한다.
````

### B-2. `docs/02-spec/decisions/ADR-0009-client-held-conversation-state.md` — 봉투 선택 필드 2종 (append)

**찾을 원문**
````text
**재검토 트리거** 3건(§4)을 `quality-channel-설계.md` §14에 함께 기록했다.
````
**바꿀 내용**
````text
**재검토 트리거** 3건(§4)을 `quality-channel-설계.md` §14에 함께 기록했다.


---

## 갱신 (2026-09-24 — No.27: 설문 진행 포인터를 봉투 선택 필드로 · §3 불변식 유지 근거)

설문관리(No.27, **ADR-0035 §2**)가 봉투에 **선택 필드 2개**를 더한다. 결정 1(세션 테이블/Redis 미도입)·2(매 턴 재검증 구조 강제)·3(담지 않는 것)·4(재검토 트리거)는 **불변**이며 트리거는 발동하지 않았다.

- `surveySession?`: 설문 id · 구조 버전 · 시작 노드 id·아웃풋 위치 · 문항 순번 · 재시도 수 · 시작/마지막 시각. `completedSurveyIds?`: 이 탭에서 완료한 설문 id(≤20).
- **`CONVERSATION_STATE_VERSION`은 1 그대로**다(`pendingClarify` 선례 — 결정 1의 "확장은 봉투에 필드를 더하는 것으로 흡수"). 필드가 없으면 **키를 생략**해 기존 봉투와 바이트 동일하다.
- **§3 불변식 유지 근거**: 응답 값·완료 판정·서버 발급 id는 봉투에 **없다**. 봉투의 값은 전부 "사용자가 차례로 답하면 도달하는 값"이다 — 문항 순번 조작 = 앞 문항 건너뛰기(서버가 `missingRequiredCount`로 드러냄), 완료 목록 삭제 = 새 탭에서 재시작(서버가 `isDuplicate`로 드러냄), 재시도 수 초기화 = 재시도를 더 얻는 것뿐이다. 응답 데이터의 신뢰 근거는 봉투가 아니라 서버 쓰기 가드(쓰기 키·상태·구조 버전·순서 증가·값 재검증)다. 서명 기각 사유(유효성은 서명이 아니라 재검증이 보장)도 그대로 성립한다.
- **검증 추가**(결정 2): 설문 필드는 **분리 파싱**한다 — 설문 필드가 불량해도 컨텍스트 세션을 버리지 않는다. 번들 존재(교차 챗봇 방어 — 근거 59행이 설문에도 성립) · 문항 순번 범위 · 24시간·미래 시각 · 컨텍스트 세션과 동시 진행 금지. 폐기 사유 `SURVEY_STATE_INVALID`·`UNKNOWN_SURVEY`·`SURVEY_SESSION_EXPIRED`를 추가한다. 구조 버전 불일치·마감은 폐기가 아니라 엔진이 종료 안내를 낸다(사용자에게 이유를 알린다).
- 감수 비용 ②(여러 탭 독립)의 귀결: 같은 `sessionId`의 두 탭은 각자 설문 시도를 만들고 두 번째 완료는 중복으로 표시된다. 감수 비용 ③(탭 닫으면 사라짐): 설문 **진행**은 이어 답할 수 없지만 **이미 답한 문항은 서버에 남는다**(문항 단위 적재).
````

### B-3. `docs/02-spec/decisions/ADR-0013-pii-masking-policy-and-placement.md` — "저장" 지점의 두 번째 테이블 (append)

**찾을 원문**
````text
금지어 → PII 마스킹을 거친다(§4 `botResponse` 규칙 그대로).
````
**바꿀 내용**
````text
금지어 → PII 마스킹을 거친다(§4 `botResponse` 규칙 그대로).


---

## 갱신 (2026-09-24 — No.27: "저장" 지점의 두 번째 테이블 = 설문 자유 텍스트 응답)

설문관리(No.27, **ADR-0035 §4**)의 자유 텍스트 응답이 **"저장" 지점의 두 번째 테이블**(`SurveyAnswer.textValue`)이 된다. 적용 지점의 종류(저장 · RAG 송신 · 증강 송신 · 레거시 송신)는 늘지 않으며 **함수는 여전히 1벌**이다.

- **같은 함수·같은 순서**: `maskPii(await bannedWordFilter.maskPlainText(원문))` — `ConversationLogService.record()`와 동일(복제 금지). 쓰기 주체 `SurveyResponseService` 1파일. **원문 컬럼이 없다**(정적 검사).
- 같은 턴의 입력은 `ConversationLog.userMessage`에도 마스킹본으로 저장된다 — 두 저장소가 같은 함수를 거치므로 정책 변경 시 누락이 생기지 않는다. 대화로그 쪽을 가리지 않는다("로그는 사용자가 실제로 보낸 것").
- **§6(이름·주소 미탐)의 영향이 커진다** — 자유 텍스트는 이름·주소를 쓰기 쉬운 입력이다. 편집기(자유 텍스트 문항 추가 시)와 결과 화면에 한계를 고지하고 문항 안내 문구 "(개인정보는 입력하지 마세요)"를 기본 예시로 권장한다. 작은 표본 비공개(k-익명성)·보존기간은 No.45.
- 선택·척도 응답은 선택지 key·정수만 저장하므로 마스킹 대상이 아니다. 응답 값은 서버 로그·trace·감사·오류 응답·시뮬레이터 응답에 **원문이든 마스킹본이든** 남지 않는다(결과 화면·CSV의 마스킹본 열람은 `chatbot:read`).
````

### B-4. `docs/02-spec/decisions/ADR-0015-role-permission-model.md` — 신규 권한 0종 (append)

**찾을 원문**
````text
권한을 올리면 VIEWER의 노드 조회 자체가 막힌다).
````
**바꿀 내용**
````text
권한을 올리면 VIEWER의 노드 조회 자체가 막힌다).


---

## 갱신 (2026-09-24 — No.27 설문관리: 신규 권한 0종)

설문관리(No.27, ADR-0035 §12)는 **신규 권한을 만들지 않는다**(PM 확정 P-12). `Permission` 15종 · `ROLE_PERMISSIONS` · 공개 경로 6곳 · 판정 순서는 전부 불변이다.

- **설문 정의 조회 = `dialogue:read`, 생성·수정(상태 포함)·복제·삭제 = `dialogue:write`** — 설문 문항은 최종 사용자에게 보이는 대화 문구이며 노드가 참조하는 대화 자산이다("동작이 바꾸는 자원을 기준으로").
- **참여 통계·응답 목록·자유 텍스트 목록·CSV = `chatbot:read`**(세 역할) — 통계와 같은 도메인. VIEWER는 마스킹본만 본다(VIEWER가 이미 `chatbot:read`로 마스킹된 질문 원문을 질문 순위에서 보는 것과 같은 등급).
- 시뮬레이터 설문 미리보기 = 기존 `simulation:read` — 응답을 저장하지 않으므로 VIEWER 허용이 안전하다.
- 설문 목록(`dialogue:read`)에 최근 30일 노출/완료 수를 싣는다 — 세 역할 모두 `chatbot:read`를 가져 노출 차이가 0이다(그룹별 접근 제한 도입 시 재검토 — No.45).
````

### B-5. `docs/02-spec/decisions/ADR-0016-audit-log-backfill-scope.md` — `Survey` 대상 (append)

**찾을 원문**
````text
v1 헤더 토큰이 감사로그에 들어간 적이 없다. 유지한다.
````
**바꿀 내용**
````text
v1 헤더 토큰이 감사로그에 들어간 적이 없다. 유지한다.


---

## 갱신 (2026-09-24 — No.27: `Survey` 대상 추가 · 응답·내보내기는 감사 대상 아님)

설문관리(No.27, **ADR-0035 §12**).

1. **`AuditTargetType`에 `Survey`**(라벨 `'설문'`, 16 → 17종). 생성 `CREATE` · 수정 `UPDATE`(summary "문구만 수정"｜"구성 변경(구조 버전 N→N+1)") · 상태만 바뀐 수정 `STATUS_CHANGE` · 복제 `COPY` · 삭제 `DELETE`. **`AuditAction` 추가 0**.
2. **화이트리스트** `AUDIT_FIELDS.Survey = ['name','status','activeFrom','activeTo','questionCount','structureVersion','sessionTimeoutMinutes']` — 문항 문구·선택지·소개·완료 문구·취소어 본문은 **담지 않는다**(`DialogNode`의 `outputs` 제외와 같은 판단 — 개수·버전만).
3. **응답 1건 1건은 감사로그가 아니다** — 최종 사용자 행위이며 응답 테이블 자체가 기록이다. **CSV 내보내기도 기록하지 않는다**(`EXPORT` 액션 선례 없음 — PM 확정 P-13. 재검토 = No.45 감사 강화). 통계 조회는 읽기다.
````

### B-6. `docs/02-spec/decisions/ADR-0019-unanswered-queue-collection-model.md` — 제외 사유 `SURVEY_TURN` (append)

**찾을 원문**
````text
⑥ 추천 계산의 N+1 부재(의도 집합 요청당 1회 로드).
````
**바꿀 내용**
````text
⑥ 추천 계산의 N+1 부재(의도 집합 요청당 1회 로드).


---

## 갱신 (2026-09-24 — No.27: 수집 제외 사유 `SURVEY_TURN`)

설문관리(No.27, ADR-0035 §7)에서 설문 세션이 입력을 소비한 턴(응답·건너뛰기·재질문·취소·완료)은 `ConversationLog.surveyTurn=true`로 적재되고 **미응답 큐에 들어가지 않는다**.

- `shouldCollect()` 입력에 `surveyTurn?`(기본 false — 기존 호출 무변경)을 더하고 `apiNotice` 다음 순서로 판정해 사유 **`SURVEY_TURN`** 을 반환한다. 설문 턴은 폴백 trace가 없어 원래 `ANSWERED`로 제외되지만, **명시적 사유**를 두어 판정 근거를 1곳에 남긴다(설문 답 "5"가 미래의 판정 변경으로 큐에 흘러드는 것을 막는다).
- 판정식은 여전히 `judgeAnswered()` 단일 소스를 신뢰하며, `surveyTurn`은 파이프라인이 엔진 결과(`surveyTurn`)를 그대로 전달한다 — API가 추정하지 않는다. 컬럼으로 두는 이유는 수집 외에 **질문 순위 제외**가 사후 로그를 소비하기 때문이다(결정 §3의 "`inputKind`는 파라미터" 판단과 다른 점 — 소비자가 로그 조회 쪽에 있다).
````

### B-7. `docs/02-spec/decisions/ADR-0030-test-run-resource-isolation.md` — TC·비교는 설문 미리보기 판정·저장 0 (append)

**찾을 원문**
````text
`deploy-schedules`의 출구 import 0건을 함께 단언한다.
````
**바꿀 내용**
````text
`deploy-schedules`의 출구 import 0건을 함께 단언한다.


---

## 갱신 (2026-09-24 — No.27: TC·비교는 설문을 미리보기 판정으로 · 응답 저장 0)

설문관리(No.27, ADR-0035 §10)의 v2 `SURVEY`가 TC 대량 실행·비교 실행·시뮬레이터에 들어온다. 이 ADR의 격리 원칙을 그대로 적용한다.

1. **저장 0**: 응답 쓰기 모듈(`survey-responses`)은 `SurveyResponseService` 1개만 export하고 import처는 공개 대화 1곳이다 — 실행·비교·시뮬레이터 경로에는 **응답을 저장할 수단이 DI 그래프에 없다**. `validation-sealing.spec.ts` 금지 import에 `survey-responses/`를 추가하고 `survey-sealing.spec.ts` S-6이 함께 단언한다.
2. **결정론**: TC·비교는 **항상 설문 미리보기 판정**(설문 상태·기간 무시)을 쓴다 — 실행 날짜·설문 마감 여부에 따라 응답 해시가 달라지지 않는다(ADR-0029). 실행당 고정 `now`라 타임아웃도 끼지 않는다. 미리보기 여부는 엔진 재진입 상태에 실려 API 목 완결에서도 유지된다(호출부 수정 0).
3. **표시**: 결과 행 `surveyPreviewA/B`로 설문이 개입한 TC에 `설문 미리보기 판정` 배지를 붙인다. v2 `SURVEY`는 `일부 아웃풋 미실행` 배지 대상에서 빠진다(v1은 유지).
4. **해시 불연속(ADR-0029 버전 축)**: v2 `SURVEY`를 포함한 TC는 No.27 이전(미지원 안내)과 이후(문항 출력)의 응답 해시가 다르다 — 실행 비교 화면은 한쪽만 설문 판정이 관여했을 때 안내를 1회 표시한다(No.26 목 안내와 통합 문단).
5. **질의 임베딩 캐시**(§2): 설문이 입력을 소비할 턴은 공개 대화·시뮬레이터 모두 의미 점수 계산을 생략하므로 설문 답이 운영 질의 LRU 캐시를 오염시키지 않는다.
````

### B-8. `docs/02-spec/decisions/ADR-0031-chatbot-version-snapshot-and-id-preserving-restore.md` — 설문은 스냅샷 밖 (append)

**찾을 원문**
````text
목록은 본문을 읽지 않는다 — 본문 참조 봉인 유지).
````
**바꿀 내용**
````text
목록은 본문을 읽지 않는다 — 본문 참조 봉인 유지).


---

## 갱신 (2026-09-24 — No.27: `Survey`는 스냅샷 밖 · 설문 참조 끊김은 경고 · 번들 설문 필드는 선택)

설문관리(No.27, **ADR-0035 §11**)에 따라 다음을 확정한다. 스냅샷 범위·ID 보존 복원·단일 트랜잭션·해시 규칙은 **불변**이다.

1. **`Survey`는 스냅샷 대상이 아니다** — 응답 데이터에 묶인 자산이라 복원이 **잠긴 구조를 되돌리면** 응답과 정의가 어긋난다(구조 잠금이 복원으로 우회된다). 노드 `outputs` 안의 `surveyId` 참조는 스냅샷에 그대로 포함된다. 스냅샷 봉투는 자산 6종을 **명시 나열**하므로 번들에 설문이 있어도 봉투에 들어가지 않는다(구조로 보장 — `survey-sealing.spec.ts` S-13). `SNAPSHOT_SCHEMA_VERSION`·`VersionAssetKind`·업캐스터 불변(`SURVEY` 읽기 스키마가 v1 ∪ v2 합집합).
2. **번들의 설문 필드는 선택이다** — hydrate한 번들(6종)이 설문 없이도 번들 스키마를 통과한다. 복원 후 번들 재구축 시 현재 DB 설문이 들어간다.
3. **복원 미리보기 경고 3종**(전부 blocker 아님): `SURVEY_MISSING`(참조 설문 없음 — 복원 후 해당 노드는 설문을 건너뛴다) · `SURVEY_NOT_OPEN` · `SURVEY_LEGACY_FORMAT`(v1 포함 — 복원 후 실행되지 않음). 앱 레벨 참조 무결성 경고에 `BROKEN_REFERENCE_NODE_SURVEY`(완료 후 이동 노드 없음). 예약 복원(No.28)의 준비도 경고에 자동 포함된다.
4. **설문 삭제는 스냅샷 참조를 검사하지 않는다**(현재 노드 참조만 `409 SURVEY_IN_USE`). 단 응답이 있는 설문은 어차피 삭제할 수 없다(`409 SURVEY_HAS_RESPONSES`).
````

### B-9. `docs/02-spec/decisions/ADR-0033-cumulative-stats-source-log-sealing-and-group-snapshot.md` — 봉인 대상 확장 (append)

**찾을 원문**
````text
⑦ `EXPLAIN QUERY PLAN`으로 신규 인덱스 적중.
````
**바꿀 내용**
````text
⑦ `EXPLAIN QUERY PLAN`으로 신규 인덱스 적중.


---

## 갱신 (2026-09-24 — No.27: 봉인 대상에 설문 응답 2모델 추가 · 설문 롤업 규약 · `groupId` 스냅샷 재사용)

설문관리(No.27, **ADR-0035 §8**)의 응답은 참여 통계의 **유일한 원천**이므로 이 ADR의 3층 보존 구조를 그대로 확장한다. 결정 1~8은 불변이다.

1. **L1 DB**: `SurveyResponse → Chatbot·Survey`, `SurveyAnswer → SurveyResponse` FK `onDelete: Restrict`(Cascade/SetNull 없음).
2. **L2 서비스**: 챗봇 영구삭제 사전검사에 `surveys`('설문')·`surveyResponses`('설문 응답')를 추가한다(9 → 11종, 동반 삭제 목록에 넣지 않는다). 응답(노출 포함)이 있는 설문은 삭제 불가(`409 SURVEY_HAS_RESPONSES`) → 마감으로 대체.
3. **L3 정적 검사**(`survey-sealing.spec.ts`): 두 모델의 `delete`/`deleteMany`/원시 `DELETE` **0건** · `create`/`update*`는 `SurveyResponseService` **1파일** — 로그와 달리 응답 행은 진행에 따라 **상태가 바뀌어야** 하므로 `update`를 금지하지 않고 쓰기 주체를 1파일로 한정한다(조건부 갱신의 원자성·쓰기 가드가 그 파일 안에 있다). 통계 모듈(`stats/surveys/`)은 R-8(Prisma 쓰기 0)이 그대로 적용된다.
4. **결정 3 확장 — 설문 롤업 규약**: 향후 응답 삭제(No.45 보존기간·정보주체 파기)도 **단일 서비스 + 같은 트랜잭션의 수치 롤업 선적재**로만 추가한다. 설문 롤업 = `(surveyId, dayBucket, channelType)` 키의 상태·시작 여부별 건수 + 문항·선택지/값별 건수 + `groupId` 스냅샷 — **텍스트·세션 ID를 담지 않는다**.
5. **결정 4 재사용**: `SurveyResponse.groupId` = **노출 당시** 챗봇 소속 그룹 스냅샷(FK 없음 · 적재 후 불변 · 호출부가 이미 읽은 챗봇 행에서 — 추가 조회 0). 그룹·전역 설문 통계는 1차 범위 밖이지만 후속 통합이 과거를 소급 변경하지 않도록 지금 적재한다.
6. **질문 순위의 원천 규칙 보강**: 설문이 소비한 턴(`ConversationLog.surveyTurn=true`)은 챗봇·그룹·전역 **모든 스코프의 질문 순위**에서 같은 조건 상수 1벌로 제외한다. 턴 수·세션·응답률·출처 집계는 불변이며 기존 행은 전부 false라 과거 수치가 바뀌지 않는다.
````

### B-10. `docs/02-spec/decisions/ADR-0034-legacy-api-connection-registry-and-engine-suspension.md` — 정지점 미사용 · 재진입 상태 이월 (append)

**찾을 원문**
````text
`SCENARIO` 실행을 이 출구 위에 올린다.
````
**바꿀 내용**
````text
`SCENARIO` 실행을 이 출구 위에 올린다.


---

## 갱신 (2026-09-24 — No.27: 설문은 정지점을 쓰지 않는다 · `resumeAfterApiCall`의 다음 상태에 설문 필드 이월)

설문관리(No.27, **ADR-0035 §3**)와의 경계를 기록한다. 결정 1~11은 불변이다.

1. **정지점은 설문에 쓰지 않는다** — 정지는 "다음 출력이 외부 I/O 결과에 따라 달라질 때"의 장치이고(근거 1), 설문의 다음 출력(다음 문항·재질문·완료)은 입력과 설문 정의만으로 결정된다. DB는 기록만 하며 기록 결과가 출력을 바꾸지 않는다. 그 결과 **턴당 정지 1회 규약과 충돌하지 않아** API 분기 대상 노드의 `SURVEY`도 정상 시작된다.
2. **결함 기록 — 재진입이 다음 상태를 새로 조립했다**(`resumeAfterApiCall`의 `{ version, contextSession, pendingClarify: null }`). 봉투에 필드가 늘면 API 분기 턴에서 그 필드가 **조용히 사라진다**(설문의 경우 완료 목록 소실 → 같은 탭 재노출). `ApiResumeState`에 설문 이월분(완료 목록·미리보기 여부·정지 전 이벤트·입력 소비 여부)을 싣고, 분기 노드 실행에 설문 컨텍스트를 전달하며, 다음 상태를 **키 생략 규칙**(없으면 키 부재)으로 조립한다 — 설문 필드가 없는 API 턴의 다음 상태는 기존 3키 그대로다.
3. 미리보기 여부를 옵션이 아니라 **재진입 상태**에 싣는 이유: 실제 호출부(`LegacyApiService.completeTurn`·TC 목 완결 헬퍼)가 옵션 없이 재진입하므로, 옵션으로만 전달하면 TC의 설문 미리보기 판정이 API 분기 뒤에서 사라진다(호출부 수정 0으로 이월).
4. 결과 L-12(봉투 키 집합 불변)의 기대값은 5키(`version·contextSession·pendingClarify·surveySession·completedSurveyIds`)로 갱신한다 — 목적("응답값의 상태 이월 금지")은 `SurveySessionStateSchema` 키 집합 고정 검사(`survey-sealing.spec.ts` S-9)로 더 정밀하게 유지된다.
````

### B-11. `docs/02-spec/decisions/ADR-0002-permanent-delete-referential-integrity.md` — 사전검사 9 → 11종 (append)

**찾을 원문**
````text
보관 그룹은 목록·수정·복사·삭제·챗봇 생성/이동/복사 대상에서 `404`이며 통합 통계에만 남는다.
````
**바꿀 내용**
````text
보관 그룹은 목록·수정·복사·삭제·챗봇 생성/이동/복사 대상에서 `404`이며 통합 통계에만 남는다.


---

## 갱신 (2026-09-24 — No.27: 사전검사 대상 9 → 11종 · 설문 삭제 409 2종)

설문관리(No.27, **ADR-0035 §8**)에 따라 결정 3의 사전검사 목록에 **`surveys`('설문')·`surveyResponses`('설문 응답')** 를 추가한다(9 → 11종). 결정 1~6은 불변이다.

- 설문 정의는 대화 자산, 설문 응답은 참여 통계의 유일한 원천이다 — 둘 다 **"하위 데이터 제거"(동반 삭제) 분류가 아니다**. 응답이 있는 챗봇은 영구삭제할 수 없다(대화로그와 같은 판단 — 사실상 설문이 노출된 챗봇은 대화로그도 있다).
- **설문 단위 삭제**도 같은 원칙이다: 노드가 참조 중이면 `409 SURVEY_IN_USE`(현재 노드만 — 스냅샷 참조는 막지 않음), 응답 행(노출 포함)이 1건이라도 있으면 `409 SURVEY_HAS_RESPONSES` — **마감**(`CLOSED`)이 정리 수단이다. FK `Restrict`가 최종 방어선이다.
- 향후 "함께 삭제" 플로우가 도입되면 ADR-0033 §3과 그 갱신의 **설문 롤업 선적재** 규약을 따른다.
````

---

## C. `docs/01-requirements/기능요구사항.md`

### C-1. §3 No.27 행 — 설계 완료 반영

**찾을 원문**
````text
| 27 | 부가 기능 | 설문관리 | 대화 중 설문조사 생성·호출, 응답결과·참여통계 제공 | 1 | 폼 데이터 저장/집계 | ○ | ○ | - |
````
**바꿀 내용**
````text
| 27 | 부가 기능 | 설문관리 | **챗봇별 설문**(단일/다중 선택·척도(별점5·NPS11)·자유 텍스트)을 대화 노드에서 호출해 **대화 안에서 멀티턴으로** 응답 수집(응답은 문항 단위 서버 적재 · 자유 텍스트 마스킹 저장) → 노출·시작·완료·이탈·문항별 분포·NPS·응답 목록·CSV(챗봇 스코프) | 1 | 폼 데이터 저장/집계(문자열 판정·DB 집계 — 새 모델·추론 0) | ○ | ○(자유 텍스트 보존·위치는 No.45) | **설계 완료(2026-09-24, `docs/02-spec/survey-management-설계.md` · ADR-0035).** 원문 "대화 중 설문조사 생성·호출, 응답결과·참여통계 제공". 위젯 전용 폼 UI는 No.46, 보존·파기는 No.45, 그룹·전역 설문 통계는 No.29 후속, 대화 종료 자동 설문은 No.24. `SCENARIO`는 No.39 |
````

---

## D. `docs/requirements/dialogue-design.md` — `SURVEY` 관련 각주

### D-1. AC-5-7 — 기대값 변경 각주(의도된 변경)

**찾을 원문**
````text
- **AC-5-7** Given `SURVEY` 아웃풋을 포함한 노드, When 저장하면, Then `201`로 저장되고 편집 화면에 "이번 버전에서는 실행되지 않습니다" 배지가 표시된다.
````
**바꿀 내용**
````text
- **AC-5-7** Given `SURVEY` 아웃풋을 포함한 노드, When 저장하면, Then `201`로 저장되고 편집 화면에 "이번 버전에서는 실행되지 않습니다" 배지가 표시된다. **[No.27 기대값 변경 2026-09-24 — 의도된 변경]** v1(자유 문자열 `surveyId`) `SURVEY`는 이제 새로 저장할 수 없다 → **`400 SURVEY_OUTPUT_LEGACY_FORMAT`**. v2(`version: 2` + 같은 챗봇 설문)는 `201`이며 실행되므로 배지가 없다. 이미 저장된 v1은 읽기·표시되고 "이전 형식 — 실행되지 않음" 배지를 받는다(`survey-management-설계.md` §4.2·§18, ADR-0035 §9)
````

### D-2. FR-E-7 — 미지원 대상 축소 각주

**찾을 원문**
````text
| FR-E-7 | 실행 미지원 타입(`SCENARIO`/`SURVEY`/`API_CONDITION`)은 출력에서 제외하고 `unsupportedOutputs`에 담는다(FR-5-15). 예외를 던지지 않는다. |
````
**바꿀 내용**
````text
| FR-E-7 | 실행 미지원 타입(`SCENARIO`/`SURVEY`/`API_CONDITION`)은 출력에서 제외하고 `unsupportedOutputs`에 담는다(FR-5-15). 예외를 던지지 않는다. **[갱신 No.26·No.27]** 미지원 대상은 이제 `SCENARIO` · v1(이전 형식) `API_CONDITION` · v1(이전 형식) `SURVEY`뿐이다 — 판정은 타입이 아니라 형태(`isUnsupportedOutput()`) |
````

### D-3. 범위 표 649행 — No.27 이행 표식

**찾을 원문**
````text
| `SURVEY` 아웃풋의 **실제 설문 생성·응답 수집·통계** | No.27(설문관리). 이번엔 `surveyId` 참조 저장까지 |
````
**바꿀 내용**
````text
| `SURVEY` 아웃풋의 **실제 설문 생성·응답 수집·통계** | No.27(설문관리). 이번엔 `surveyId` 참조 저장까지 **[이행 2026-09-24 — `survey-management-설계.md` · ADR-0035. 기존 자유 문자열 `surveyId`(v1)는 실체가 없는 예약 자리였으므로 자동 연결하지 않고, 설문 선택(v2)으로 전환해야 실행된다]** |
````

---

## E. `docs/requirements/quality-channel.md` · `docs/requirements/validation-regression.md` — 배지 대상 축소

### E-1. `quality-channel.md` FR-10-10 — v2 `SURVEY` 제외

**찾을 원문**
````text
(SCENARIO/SURVEY/API_CONDITION)이 포함되어 있습니다"를 **안내(INFO)** 로 표시한다(FR-5-15 연계). |
````
**바꿀 내용**
````text
(SCENARIO/SURVEY/API_CONDITION)이 포함되어 있습니다"를 **안내(INFO)** 로 표시한다(FR-5-15 연계). **[갱신 No.26·No.27]** 대상은 `SCENARIO`·v1(이전 형식) `API_CONDITION`·v1(이전 형식) `SURVEY`뿐이다 — v2 `SURVEY`는 실행되며 시뮬레이터 결과 패널의 `설문 단계`로 표시된다(`survey-management-설계.md` §7.2) |
````

### E-2. `quality-channel.md` AC-10-12 — v1 기준으로 한정

**찾을 원문**
````text
- **AC-10-12** Given `SURVEY` 아웃풋만 가진 노드가 매칭되는 입력, When 전송하면, Then `unsupportedOutputs`에 `SURVEY`가 담기고 화면에 미실행 안내가 표시되며 최소 1건의 대체 응답이 표시된다.
````
**바꿀 내용**
````text
- **AC-10-12** Given `SURVEY` 아웃풋만 가진 노드가 매칭되는 입력, When 전송하면, Then `unsupportedOutputs`에 `SURVEY`가 담기고 화면에 미실행 안내가 표시되며 최소 1건의 대체 응답이 표시된다. **[No.27 한정]** 이 기준은 **v1(이전 형식) `SURVEY`** 에 대해 그대로 유지된다(바이트 동일 — AC-SV1-1). v2 `SURVEY`는 설문을 시작하거나, 참여할 수 없으면 설문 고정 문구("지금은 참여할 수 있는 설문이 없어요." 등)로 응답한다(`unsupportedOutputs` 비어 있음 — AC-SV2-8/9)
````

### E-3. `validation-regression.md` FR-V1-31 — 배지 대상 갱신

**찾을 원문**
````text
| FR-V1-31 | ⚠ **미지원 아웃풋 3종**
````
**바꿀 내용**
````text
| FR-V1-31 | ⚠ **[갱신 No.26·No.27: 배지 대상은 `SCENARIO`·v1(이전 형식) `API_CONDITION`·v1(이전 형식) `SURVEY`뿐 — v2 `SURVEY`가 개입한 TC는 대신 `설문 미리보기 판정` 배지(상태·기간 무시 판정, `survey-management-설계.md` §7.4)]** **미지원 아웃풋 3종**
````

---

## F. `docs/02-spec/dialogue-design-설계.md` — 아웃풋 표·미지원 상수 표식

### F-1. 아웃풋 표 ⑪ `SURVEY` 행 — v1/v2 표식

**찾을 원문**
````text
| ⑪ | `SURVEY` | `{ surveyId: 1~100 }` | **정의·저장·검증만** |
````
**바꿀 내용**
````text
| ⑪ | `SURVEY` | `{ surveyId: 1~100 }` **[No.27 이후 = v1(이전 형식·읽기 전용) — 새 저장은 v2 `{ version: 2, surveyId: uuid, onCompleteNodeId? }`]** | **정의·저장·검증만** **[No.27: v2는 대화 내 멀티턴 실행 — `survey-management-설계.md` §4.1·§5]** |
````

### F-2. 미지원 상수 예고 — 정정 표식

**찾을 원문**
````text
No.26/27 구현 시 이 상수에서 빼는 것만으로 실행이 열린다.
````
**바꿀 내용**
````text
No.26/27 구현 시 이 상수에서 빼는 것만으로 실행이 열린다. **[정정 No.26·No.27 — 성립하지 않았다: 실행 가능 판정은 타입이 아니라 형태(`isUnsupportedOutput()`)로 하며, 상수는 `['SCENARIO']`로 줄었다. 설계 점검도 공용 함수 기반으로 교체됐다(ADR-0008 갱신 각주 2건)]**
````

---

## G. `docs/03-design/dialogue-design-ui-spec.md` — 대체 예정 표식 (세부 갱신은 ui-designer 단계)

### G-1. 199행 `UnsupportedOutputBadge` 대상 — v2 `SURVEY` 제외

**찾을 원문**
````text
아웃풋 편집 폼(`SCENARIO`/`SURVEY`/**v1(이전 형식)** `API_CONDITION` — [No.26] v2는 배지 없음, 판정은 공용 `isUnsupportedOutput()`)
````
**바꿀 내용**
````text
아웃풋 편집 폼(`SCENARIO`/**v1(이전 형식)** `SURVEY`/**v1(이전 형식)** `API_CONDITION` — [No.26·No.27] v2는 배지 없음, 판정은 공용 `isUnsupportedOutput()`)
````

### G-2. 416행 ⑪ 설문 연동 — 설문 선택기로 대체 예정

**찾을 원문**
````text
| ⑪ | 설문 연동 ▥ | `surveyId`(1~100) | `surveyId` | `UnsupportedOutputBadge` 표시 |
````
**바꿀 내용**
````text
| ⑪ | 설문 연동 ▥ | `surveyId`(1~100) | `surveyId` | `UnsupportedOutputBadge` 표시 **[대체 예정 2026-09-24 No.27]** 이 행은 v1(이전 형식) 표시에만 남는다 — 새 편집 폼은 라벨 "설문" · **설문 선택기**(이 챗봇 설문 목록: 이름·상태 배지·문항 수 — 자유 입력 폐기) · `완료 후 이동 노드`(선택) · `설문 편집으로 이동` 링크이며 배지가 없다. v1은 "이전 형식 — 실행되지 않음" 배지 + `설문 선택해 전환` 버튼(빈 v2 초안 — v1 키를 옮기지 않는다). 세부는 ui-designer가 `survey-management-설계.md` §17로 갱신한다 |
````

---

## H. `docs/requirements/survey-management.md` — PM 결정 기록

### H-1. §1.6 핵심 판단 표 머리 — PM 결정 표기

**찾을 원문**
````text
### 1.6 이 문서의 핵심 판단 21건 (⚠ = PM 확인 필요)
````
**바꿀 내용**
````text
### 1.6 이 문서의 핵심 판단 21건 (⚠ = PM 확인 필요)

> **PM 결정: 권고안 채택(2026-09-24)** — ⚠ 표시 항목(J-1·J-2·J-3·J-5·J-6·J-7·J-8·J-9·J-10·J-11·J-12·J-13·J-14·J-15·J-16·J-17·J-18·J-19)을 포함해 아래 "결정(제안)" 열이 전부 확정되었다(§11 P-1~P-17). J-4(엔진 통합 — 정지점 미사용·세션형 + 사후 적재)·J-20(참조 무결성 편입)은 architect 확정 사항이다. 세부 설계: `docs/02-spec/survey-management-설계.md` · ADR-0035.
````

### H-2. §11 PM 확인 항목 — 결정 기록

**찾을 원문**
````text
## 11. PM 확인이 필요한 항목
````
**바꿀 내용**
````text
## 11. PM 확인이 필요한 항목

> **PM 결정: 권고안 채택(2026-09-24)** — P-1~P-17 전부 아래 표의 "권고안" 열로 확정했다.
>
> | # | PM 결정(2026-09-24) |
> |---|---|
> | P-1 | **`SURVEY`만 실행.** `SCENARIO`는 No.39 |
> | P-2 | **대화 안에서 여러 턴으로 진행.** 클라이언트 상태에는 진행 위치만(설문 id·구조 버전·문항 순번·재시도 수·시각). 응답 값은 매 턴 서버가 재검증한 뒤 적재. 상태 버전 1 유지. 위젯 전용 폼·새 `@Public` 경로 없음 |
> | P-3 | **챗봇별 설문**(`/chatbots/:chatbotId/surveys`, 챗봇당 최대 50개). 기존 전역 `/surveys` 예고 정정 |
> | P-4 | **문항 4유형**(단일·다중·척도 별점5/NPS11·자유 텍스트 500자 이하). 기존 텍스트·버튼 아웃풋만 사용 — 위젯 변경 0. 버튼 5개씩 분할, 다중 선택은 번호 입력("1,3") |
> | P-5 | **첫 응답 후 문항 구조 잠금**(변경 시 409). 문구 수정 허용, 구조 변경은 복제 |
> | P-6 | **설문 정의는 버전 스냅샷에 넣지 않는다.** 노드의 참조만 스냅샷, 참조가 끊기면 경고 |
> | P-7 | **`sessionId`당 1회 완료.** 서버는 `isDuplicate`를 표시만. IP·쿠키 미수집 |
> | P-8 | **자유 텍스트 = 금지어 마스킹 → PII 마스킹 후 저장.** 이름·주소 미탐 한계를 화면에 고지 |
> | P-9 | **응답 삭제 경로 0**(No.29 봉인 확장). 응답 있는 설문은 마감만. 챗봇 영구삭제 사전검사에 설문 2종 추가. 보존기간은 No.45 |
> | P-10 | **통계 지표 = 노출·시작·완료·중도 이탈·미시작 이탈·진행 중·문항별 분포·평균·NPS.** 노출일(KST) 기준 집계, 이탈은 조회 시점 판정(배치 없음), 챗봇 스코프만 · `groupId` 스냅샷은 지금부터 적재 |
> | P-11 | **`ConversationLog.surveyTurn` 불리언 추가.** 설문 턴은 질문 순위(모든 스코프)·미응답 수집·RAG 판정에서 제외. 기존 행 false |
> | P-12 | **신규 권한 0.** 설문 정의 `dialogue:*`, 결과·CSV `chatbot:read`(마스킹본). 감사 대상에 `Survey` |
> | P-13 | **CSV 2종**(응답 원자료·문항별 집계). 기간 필수·최대 10,000행·`sessionId` 제외·수식 인젝션 방어. 내보내기 비감사 |
> | P-14 | **시뮬레이터·TC 응답 저장 0.** 시뮬레이터 미리보기 토글. TC·비교는 설문 상태·기간을 무시해 결정적 |
> | P-15 | **v1 `SURVEY`는 읽기만·실행 안 함.** 새 v1 저장 400. 자동 연결·변환 없음 — AC-5-7 기대값 201 → 400(의도된 변경) |
> | P-16 | **설문 자체 상태(DRAFT/OPEN/CLOSED)와 선택 기간을 대화 시점에 판정.** No.28 변경 없음 |
> | P-17 | **GPU 1** · 구축형 ○ · 구독형 ○ |
> | (architect) | 엔진 통합(J-4 — 정지점 미사용, 순수 설문 세션 + 결과 선택 필드 `surveyEvents` → API 계층 사후 적재, 닫힌 목록 9항목) · 참조 무결성 편입(J-20 — `surveyTargets` 4곳) · 숨은 결함 처리(설계 점검 상수 교체 · 재진입 상태 이월 · 컨텍스트 폼 `slice(0,5)`는 별도 과제 · 질문 순위 제외 1벌 · **오버레이 병합의 설문 유실 · 봉투 키 집합 정적 검사 갱신** — `survey-management-설계.md` §22) |
````

---

## Z. 적용 후 확인 체크리스트

- [ ] A-1~A-31 · B-1~B-11 · C-1 · D-1~D-3 · E-1~E-3 · F-1~F-2 · G-1~G-2 · H-1~H-2 각 "찾을 원문"이 적용 전 대상 파일에서 정확히 1회 검색되는지(0회 = 파일이 그 사이 바뀜 → 이 문서를 갱신 후 적용).
- [ ] 개발명세서 §7 인덱스에 설계서·ADR-0035 행이 각 1개인지. §6에 결정 36이 35 바로 뒤에 있는지. §3 "미도입 결정 12건" 머리와 ⑫ 항목이 함께 있는지.
- [ ] `docs/requirements/dialogue-design.md`·`quality-channel.md`·`validation-regression.md`·`docs/02-spec/dialogue-design-설계.md`·`docs/03-design/dialogue-design-ui-spec.md`·개발명세서 §4.1 표 행이 적용 후에도 열 개수를 유지하는지(각주는 기존 셀 안에 들어간다).
- [ ] `docs/01-requirements/기능요구사항.md` §2 No.5 행(아웃풋 12종)에는 비고 열이 없어 이번 패치에 포함하지 않았다 — "미실행 아웃풋 = `SCENARIO` 1종(+ 이전 형식 v1)" 문구 반영이 필요하면 PM이 열 구조와 함께 결정한다.
- [ ] `docs/requirements/stats-learning.md`·`integrated-stats.md`의 질문 순위 정의에 "설문 응답 턴(`surveyTurn`) 제외" 각주를 넣는 일은 **test-automation/문서 정리 단계**에서 한다(설계서 §9.6이 단일 근거).
- [ ] `docs/04-test/시험항목.md`(133행 AC-5-7 · 953행 AC-L1-9 문구)·`시험데이터.md`·`자동시험_전략.md`에 AC-SV1~SV7 · 봉투 위조 입력 표 · 통계 고정 픽스처(AC-SV5-1) · 가짜 자유 텍스트 누출 grep · TC 날짜 결정론을 추가하는 일은 **test-automation 단계**에서 한다.
- [ ] `docs/03-design/dialogue-design-ui-spec.md`의 설문 선택기·설문관리 3화면·시뮬레이터 설문 단계 세부 스펙과 `docs/03-design/UIUX_준수기준.md`의 "대화형 설문 문항 표시 원칙" 보강 여부는 **ui-designer 판단**이다(개발명세서 §5 접근성 문단에 원칙을 먼저 기록했다 — A-30).
- [ ] 코드 쪽 기대값 변경(설계서 §18 "의도된 기대값 변경" 5건 — AC-5-7 통합 시험 · `DialogOutputEditor.spec.tsx:86` · 시험항목 AC-L1-9 · `legacy-api-sealing.spec.ts` L-12 · 시드 v1 SURVEY 챗봇 설계 점검 WARNING 수)은 **구현 단계에서** 반영한다. 그 밖의 기존 시험이 깨지면 회귀로 취급한다.
- [ ] 코드 쪽 JSDoc(`packages/shared-types/src/dialogue.ts:432-437` 상수 주석 "[No.26에서 축소]" · `:737` `isUnsupportedOutput` 주석 · `design-validator.ts:4-8` "4곳 공용" 주석)은 **구현 단계에서** No.27 내용으로 갱신한다.
