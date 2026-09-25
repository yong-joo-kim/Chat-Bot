# No.44 피드백 기반 개선 루프 — 기존 문서 패치 목록

> 작성: system-architect · 2026-09-25 · 근거: `docs/02-spec/feedback-loop-설계.md`, `docs/02-spec/decisions/ADR-0038-answer-feedback-message-capability-ledger-and-queue-source-split.md`
> **적용 상태**: ✅ **적용 완료(2026-09-25)** — 오케스트레이터 세션이 81건 전부 "찾을 원문 정확히 1회" 확인 후 기계적으로 적용했다.
> **적용 방법**: 각 항목의 "찾을 원문"을 대상 파일에서 **정확히 1회** 찾아 "바꿀 내용"으로 교체한다. 모든 원문은 2026-09-25 시점 파일(No.22 토픽 시스템 패치 적용 후)에서 복사했고, 문자열 검색(Grep `-o`)으로 대상 파일 안 유일성을 확인했다. "바꿀 내용"이 원문을 그대로 포함하는 항목은 append다(취소선 표기 항목은 원문을 `~~…~~`로 감싸 보존한다).
> **줄바꿈 주의**: 대상 파일은 CRLF일 수 있다. 모든 "찾을 원문"은 **한 줄 안의 부분 문자열**(줄바꿈 미포함)로 잡았다. "바꿀 내용"의 줄바꿈은 대상 파일의 줄바꿈으로 정규화한다.
> **순서 독립**: 어떤 "바꿀 내용"도 다른 항목의 "찾을 원문"을 새로 만들지 않는다. 같은 줄에 앵커가 여럿인 항목(개발명세서 §3 미도입 ③ 줄의 A-10·A-11 · §3.1 인덱스 줄의 A-16·A-17 · §4.1 권한 줄의 A-26·A-27 · §5 보안 줄의 A-29·A-30)은 서로 겹치지 않는 부분 문자열이다.
> 코드 변경은 이 파일의 범위가 아니다 — 설계서 §2.5 체크리스트와 §21.2(의도된 시험 기대값 변경 닫힌 목록)를 따른다.
> 항목 수: 개발명세서 46 · ADR 7 · 기능요구사항 3 · 피드백 루프 요구사항(PM 결정 기록 + 설계 반영) 17 · 선행 요구사항 인계 정정 8 = **81건**

---

## A. `docs/02-spec/개발명세서.md`

### A-1. [개발명세서 `docs/02-spec/개발명세서.md`] §2 워크스페이스 상태 표 — `feedback` 행 추가

**찾을 원문**
````text
스냅샷 스키마 버전 1 유지(선택 필드)**(ADR-0037) |
````
**바꿀 내용**
````text
스냅샷 스키마 버전 1 유지(선택 필드)**(ADR-0037) |
| **`apps/api/src/feedback`** · `apps/api/src/stats/feedback` | **피드백 기반 개선 루프 Phase에 신설**(No.44) — 답변 평가 원장 `MessageFeedback`(★쓰기 유일 파일 `message-feedback.service.ts` · 3요소 결합 검증 · 변경 CAS · 큐 편입 선점, export 1개 — import처 = 공개 대화 1곳) + 읽기 전용 만족도 통계. **`packages/dialogue-engine`·`packages/pii-mask`·ml-worker 변경 0건 · `@Public()` 7 → 8 · 신규 권한·역할·감사 대상 0 · 선택 환경변수 5개 · 봉투 스키마 불변 · widget 변경(평가 버튼 — vanilla 유지)**(ADR-0038) |
````

### A-2. [개발명세서 `docs/02-spec/개발명세서.md`] §2.2 기능그룹별 모듈 배치 표 — No.44 행 추가

**찾을 원문**
````text
**설계 완료 → `topic-system-설계.md`** |
````
**바꿀 내용**
````text
**설계 완료 → `topic-system-설계.md`** |
| **피드백 기반 개선 루프 (No.44)** | **`feedback`(신규 — ★`MessageFeedback` 쓰기 유일 파일 `MessageFeedbackService`: 로그 PK 1회 결합 검증(챗봇·세션·`feedbackOffered`) · 저장/변경(24시간·5회 · `changeCount` CAS) · 큐 편입 선점 상태 기계 · 순수 함수 `isFeedbackOffered`·`decideFeedbackWrite`·`verifyFeedbackTarget`, export 1개) + `stats/feedback`(신규 — 만족도 통계, 읽기 전용)** + `conversation`(평가 가능 판정·응답 선택 필드 `feedback`·`record()`의 `feedbackOffered`/`inputKind` · 공개 평가 핸들러(`@Public()` 8번째)·`PublicFeedbackService`) · `common/rate-limit`(`PublicRateBucket` kind `FEEDBACK`) · `rag`(보류 턴 `feedbackOffered` 전달) · `learning`(`collectNegativeFeedback` 두 번째 진입점 · 판정 1벌 공유 · 소스 필터·요약·상세 · 직접 수정 완료 전이) · `stats`(질문 순위 큐 딥링크 `source` 조건 1개) · `channels`(스위치 감사 summary) · `chatbots`(영구삭제 사전검사 15종) · `apps/widget`(평가 버튼) | **설계 완료 → `feedback-loop-설계.md`** |
````

### A-3. [개발명세서 `docs/02-spec/개발명세서.md`] §2.2 주석 블록 — 엔진 불가침·모듈 의존 방향(No.44) 추가

**찾을 원문**
````text
공개 대화 서비스는 번들의 `topicId`만 읽는다(생성자 인자 추가 0).
````
**바꿀 내용**
````text
공개 대화 서비스는 번들의 `topicId`만 읽는다(생성자 인자 추가 0).
>
> **엔진 불가침(피드백 루프 No.44)**: 이 그룹은 `packages/dialogue-engine`을 **한 줄도 바꾸지 않는다**(FR-0-138). 평가 가능 판정은 API 계층 순수 함수 `isFeedbackOffered()`가 요청 `features`·WEB 채널 설정·이미 구분된 반환 경로(BLOCK·상담 HANDLED·설문 소비 턴)만 보고 내린다. 번들·봉투 스키마 불변 · 엔진 패키지에 `feedback` 심볼 0건을 정적 검사가 단언한다(ADR-0038 §1).
>
> **모듈 의존 방향(No.44)**: `conversation → feedback(MessageFeedbackService — 공개 평가 1곳)` · `feedback → learning(UnansweredCollectorService.collectNegativeFeedback) / prisma` 단방향이다. **`learning`·`stats`는 `feedback` 모듈을 import하지 않고** 원장을 Prisma로 읽기만 한다. `simulation`·`validation`·`versions`·`deploy-schedules`·`topics`·`asset-transfer`는 `feedback/**`를 import하지 않으며(평가 적재 경로가 DI 그래프에 없다), `feedback/**`는 엔진·RAG·상담·임베딩·설문 응답·번들 모듈을 import하지 않는다. 답변 대상 판정 `classifyFeedbackTarget()`은 `shared-types`의 순수 함수 1벌이다.
````

### A-4. [개발명세서 `docs/02-spec/개발명세서.md`] §3 엔터티 표 — `MessageFeedback` 행 추가

**찾을 원문**
````text
비어 있지 않은 토픽 삭제 `409 TOPIC_NOT_EMPTY`(공통으로 옮기고 삭제 제공) | 22 |
````
**바꿀 내용**
````text
비어 있지 않은 토픽 삭제 `409 TOPIC_NOT_EMPTY`(공통으로 옮기고 삭제 제공) | 22 |
| **`MessageFeedback`** | **답변 평가 원장(No.44, ADR-0038 §3).** 메시지(= `ConversationLog` 1행)당 1행 — `conversationLogId` 유일(**FK 없음** — 로그 규약) · `chatbotId` FK `Restrict` · `rating`(`UP`/`DOWN` — 현재 값) · `changeCount`(CAS · 상한 5) · **최초 저장 시 로그에서 복사한 턴 사실**(`groupId`(대화 당시)·`turnDayBucket`·`turnCreatedAt`·`channelType`·`isAnswered`·`answeredByRag`·`apiNotice`·`inputKind`·매칭 id 3종·`topicId`) + 답변 대상 `targetKind`/`targetId`(순수 함수 판정 — 통계 `groupBy`용 비정규화) · 큐 기여 선점 상태 `queueOutcome`(`CLAIMED`/`QUEUED`/`SKIPPED`/`FAILED`)·`queueSkipCode`·`queuedAt`·`queueItemId`(FK 없음). **★ 질문·답변 텍스트·`sessionId`·IP·User-Agent 컬럼이 없다**(컬럼 이름 허용 목록 정적 검사). 쓰기 주체 = `MessageFeedbackService` 1파일 · **삭제 코드 0건**(ADR-0033 봉인 확장) · 영구삭제 사전검사 대상(`답변 평가`) · 스냅샷·복사·토픽 분리 대상 아님 · 무기한 보존(No.45) | 44 |
````

### A-5. [개발명세서 `docs/02-spec/개발명세서.md`] §3 엔터티 표 — `ConversationLog` 행에 `feedbackOffered`·`inputKind`

**찾을 원문**
````text
1차는 적재만 한다(화면 0 — ADR-0037 §7)** | 14, 15, 22, 24, 27, 29, 30 |
````
**바꿀 내용**
````text
1차는 적재만 한다(화면 0 — ADR-0037 §7)** **[No.44] `feedbackOffered`는 이 턴에 평가 버튼을 제공했는지(위젯 `feedback-v1` 선언 ∧ WEB 설정 `feedbackEnabled` ∧ BLOCK·설문 소비·상담 턴 아님)를 적재 시점에 확정한다 — 평가 API 허용 근거이자 참여율의 정확한 분모다(파생 불가 — ADR-0004 통과). `inputKind`(`TEXT`/`BUTTON_MESSAGE`/`BUTTON_NODE`)는 지금까지 `record()` 파라미터로만 있던 값을 컬럼으로도 남긴다 — 평가는 턴 뒤에 도착하므로 큐 편입 판정이 로그만 보고 버튼 턴을 걸러야 한다(ADR-0019 §3 재검토 트리거 발동). 둘 다 `record()` 1곳 · 적재 후 불변 · 인덱스 없음 · 백필 없음(기존 행 = false / null "기록 없음") — ADR-0038 §1** | 14, 15, 22, 24, 27, 29, 30, 44 |
````

### A-6. [개발명세서 `docs/02-spec/개발명세서.md`] §3 엔터티 표 — `UnansweredQuestion` 행에 소스 분리

**찾을 원문**
````text
향후 큐 정리 배치(No.45)도 "단일 서비스 + 롤업 선적재" 규약을 따른다** | 15 |
````
**바꿀 내용**
````text
향후 큐 정리 배치(No.45)도 "단일 서비스 + 롤업 선적재" 규약을 따른다** **[No.44] `source`가 2종(`UNANSWERED`·`NEGATIVE_FEEDBACK`)이 되고 병합 유일 키가 `(chatbotId, source, questionNormalized)`로 바뀐다 — 같은 질문이 "못 답함"과 "답했는데 틀림(👎)"으로 각각 1행(처방이 다르다). `NEGATIVE_FEEDBACK` 행은 평가 요청의 👎가 수집기의 두 번째 진입점으로 편입하며(입력 = 로그 마스킹본 — 원문 재접촉 0) `lastFeedbackLogId`(최근 👎 턴, FK 없음)로 당시 답변·매칭 대상을 로그에서 읽는다. 소스별 `PENDING` 상한(5,000 / 2,000) · 쓰기 파일 집합 불변(수집기·상태 전이·No.23 요소분해 반영 3파일) · 신규 전이 "직접 수정 완료"(`RESOLVED` + 의도 없음 — 부정 평가 전용, 비감사) — ADR-0038 §4** | 15, 44 |
````

### A-7. [개발명세서 `docs/02-spec/개발명세서.md`] §3 엔터티 표 — `Channel` 행에 WEB `feedbackEnabled`

**찾을 원문**
````text
`enabled` 기본값은 `false`다(ADR-0011) | 11 |
````
**바꿀 내용**
````text
`enabled` 기본값은 `false`다(ADR-0011). **[No.44] WEB config에 선택 키 `feedbackEnabled`(없음 = 꺼짐 — `.default(false)`를 쓰지 않아 기존 채널 응답·파싱 결과 바이트 불변)** — 답변 평가 기능 스위치이며 `access.resolve()`가 요청마다 이미 읽는 행이라 대화·평가 경로 추가 조회 0. 채널은 스냅샷 밖이라 복원이 스위치를 되돌리지 않는다(ADR-0038 §5) | 11, 44 |
````

### A-8. [개발명세서 `docs/02-spec/개발명세서.md`] §3 미도입 결정 머리 — 14건 → 15건

**찾을 원문**
````text
> **미도입 결정 14건**
````
**바꿀 내용**
````text
> **미도입 결정 15건**
````

### A-9. [개발명세서 `docs/02-spec/개발명세서.md`] §3 미도입 결정 ⑮ 신설 — 피드백 관련 미도입

**찾을 원문**
````text
분리는 동기 상한 이하에서 수 초이며 결과는 새 챗봇과 감사 `COPY`로 남는다(**ADR-0037**).
````
**바꿀 내용**
````text
분리는 동기 상한 이하에서 수 초이며 결과는 새 챗봇과 감사 `COPY`로 남는다(**ADR-0037**).
> ⑮ **평가 토큰(서버 발급 메시지별 비밀) 테이블·평가 사유 텍스트 테이블·평가 변경 이력 테이블·평가 롤업·👍 큐 카운터·세션 단위 평가 제한 테이블·챗봇별 평가 설정 1:1 테이블** — 평가 대상의 소유 증명은 서버 발급 `messageId`(수신자 한정 난수) + URL 밖 `sessionId` + 슬러그의 결합으로 충분하고(평가 응답은 대화 데이터를 돌려주지 않는다), 자유 텍스트는 새 PII 저장소가 되어 No.45 전에는 받지 않는다. 원장은 현재 값만 보존하며(변경은 `changeCount`) 통계는 원장 직접 `groupBy`다. 👍는 큐에 반영하지 않는다. 스위치는 WEB 채널 설정의 선택 키로 대화 턴 추가 조회 0을 지킨다(**ADR-0038**).
````

### A-10. [개발명세서 `docs/02-spec/개발명세서.md`] §3 미도입 결정 ③ — `inputKind` 미도입 해제 표기

**찾을 원문**
````text
**`ConversationLog`의 `turnIndex`·`responseTimeMs`·`normalizedMessage`·`inputKind`**
````
**바꿀 내용**
````text
**`ConversationLog`의 `turnIndex`·`responseTimeMs`·`normalizedMessage`·~~`inputKind`~~**(`inputKind`는 2026-09-25 No.44에서 도입 — 아래 보론)
````

### A-11. [개발명세서 `docs/02-spec/개발명세서.md`] §3 미도입 결정 ③ — No.44 파생 컬럼 보론

**찾을 원문**
````text
재검토 트리거는 토픽 통계 요구 확정).
````
**바꿀 내용**
````text
재검토 트리거는 토픽 통계 요구 확정). **[No.44] 피드백 루프는 `feedbackOffered`·`inputKind` 2개를 추가했다** — `feedbackOffered`는 "이 턴에 평가 버튼을 보여 줬는가"로 로그 행만으로 알 수 없고(설정·위젯 버전·턴 유형의 곱) 평가 API 허용·참여율 분모가 소비한다. `inputKind`는 ADR-0019 §3이 남긴 재검토 트리거("입력 유형별 지표 요구")가 발동한 것이다 — 평가는 턴이 끝난 뒤 도착하므로 큐 편입 판정이 사후 로그로 `NODE` 버튼 턴을 걸러야 한다. 평가값 자체는 로그에 쓰지 않는다(로그 `update` 0 봉인 — 별도 원장 `MessageFeedback`).
````

### A-12. [개발명세서 `docs/02-spec/개발명세서.md`] §3.1 참조 무결성 — FK 미설정 예외에 원장·큐 컬럼 추가

**찾을 원문**
````text
**`ConversationLog.topicId`**(No.22 — 대화 당시 답한 자산의 토픽 스냅샷.
````
**바꿀 내용**
````text
**`MessageFeedback`의 `conversationLogId`/`groupId`/`matchedIntentId`/`matchedFaqId`/`matchedNodeId`/`topicId`/`targetId`/`queueItemId`**·**`UnansweredQuestion.lastFeedbackLogId`**(No.44 — 평가된 턴·당시 매칭 대상·편입된 큐 항목은 사실 기록이다. 원장은 `Chatbot`에만 `Restrict` FK를 가진다), **`ConversationLog.topicId`**(No.22 — 대화 당시 답한 자산의 토픽 스냅샷.
````

### A-13. [개발명세서 `docs/02-spec/개발명세서.md`] §3.1 파생 데이터 동반 삭제 — `MessageFeedback` 분류

**찾을 원문**
````text
→ 공통으로 옮기고 삭제). 예약이 영구삭제를 막지 않는다(AC-D5-3).
````
**바꿀 내용**
````text
→ 공통으로 옮기고 삭제). **[No.44] `MessageFeedback`(답변 평가 원장)은 파생 데이터가 아니라 사용자 판단의 원천 기록이라 동반 삭제가 아니라 영구삭제 사전검사(409) 대상**이다(`답변 평가` — 14 → 15종). 원장 행은 로그 행 없이 생길 수 없으므로 차단 집합은 실질적으로 변하지 않는다(로그가 이미 막는다). 삭제 코드 0건을 `feedback-sealing.spec.ts`가 단언한다(ADR-0033 봉인 확장). 예약이 영구삭제를 막지 않는다(AC-D5-3).
````

### A-14. [개발명세서 `docs/02-spec/개발명세서.md`] §3.1 정규화 유일성 — 큐 병합 키에 `source`

**찾을 원문**
````text
이 경우 유일성은 "이름 중복 방지"가 아니라 "표기 변형 병합 키"로 쓰인다**(ADR-0019).
````
**바꿀 내용**
````text
이 경우 유일성은 "이름 중복 방지"가 아니라 "표기 변형 병합 키"로 쓰인다**(ADR-0019). **[No.44] 병합 키는 `(chatbotId, source, questionNormalized)`다 — 같은 정규화 질문이 소스(`UNANSWERED`·`NEGATIVE_FEEDBACK`)별로 1행씩 존재할 수 있다(ADR-0038 §4).**
````

### A-15. [개발명세서 `docs/02-spec/개발명세서.md`] §3.1 부분 수정 시맨틱 — `feedbackEnabled` 전체 교체 주의

**찾을 원문**
````text
**단 `Channel.config`는 전체 교체**다(배열 필드에서 "삭제"를 표현할 수 없게 되는 것을 막는다).
````
**바꿀 내용**
````text
**단 `Channel.config`는 전체 교체**다(배열 필드에서 "삭제"를 표현할 수 없게 되는 것을 막는다). **[No.44] WEB config의 `feedbackEnabled`도 전체 교체의 일부다 — 콘솔 WEB 설정 폼은 저장 시 이 키를 항상 함께 보낸다(빠뜨리면 꺼진다).**
````

### A-16. [개발명세서 `docs/02-spec/개발명세서.md`] §3.1 인덱스 — 큐 유일 키 교체

**찾을 원문**
````text
`unanswered_questions(chatbotId, questionNormalized) UNIQUE`
````
**바꿀 내용**
````text
~~`unanswered_questions(chatbotId, questionNormalized) UNIQUE`~~ → **`unanswered_questions(chatbotId, source, questionNormalized) UNIQUE`(No.44 — 인덱스 교체만, 테이블 재정의 0)**
````

### A-17. [개발명세서 `docs/02-spec/개발명세서.md`] §3.1 인덱스 — No.44 인덱스 추가

**찾을 원문**
````text
자산 6테이블의 FK 컬럼 추가는 SQLite 테이블 재정의 마이그레이션이다(API 중지 상태 · 소요 실측 기록).**
````
**바꿀 내용**
````text
자산 6테이블의 FK 컬럼 추가는 SQLite 테이블 재정의 마이그레이션이다(API 중지 상태 · 소요 실측 기록).** **[No.44] `message_feedbacks(conversationLogId) UNIQUE`(메시지당 1행), `message_feedbacks(chatbotId, turnDayBucket)`(만족도 통계 `groupBy` 2종 공용), `message_feedbacks(queueItemId)`(부정 평가 항목의 👎 추이). `conversation_logs.feedbackOffered`·`inputKind`·`unanswered_questions.lastFeedbackLogId`에는 인덱스를 두지 않는다(불리언·적재 전용·PK 조회 — 참여율 분모는 `(chatbotId, dayBucket)` 인덱스로 범위를 좁힌다). 이 그룹의 마이그레이션은 `ADD COLUMN` 3 + 유니크 인덱스 교체 + `CREATE TABLE` 1로 **테이블 재정의가 없어** 원시 부분 유니크 인덱스 4개(`test_runs` 1 · `deploy_schedules` 2 · `handoff_sessions` 1)에 영향이 없다(적용 후 `sqlite_master` 4행 확인).**
````

### A-18. [개발명세서 `docs/02-spec/개발명세서.md`] §4 API 표 — 채널 행에 스위치 키

**찾을 원문**
````text
**`POST /webhooks/:channel`은 미구현(외부 채널 Phase)** | 11 |
````
**바꿀 내용**
````text
**`POST /webhooks/:channel`은 미구현(외부 채널 Phase)** **[No.44] WEB `config.feedbackEnabled?`(답변 평가 받기 — 선택 키)** | 11, 44 |
````

### A-19. [개발명세서 `docs/02-spec/개발명세서.md`] §4 API 표 — 공개 대화 행에 평가 경로

**찾을 원문**
````text
응답 `handoff?`(상담 켜진 챗봇의 미응답·보류·상담 턴에만) | 11, 24, 30 |
````
**바꿀 내용**
````text
응답 `handoff?`(상담 켜진 챗봇의 미응답·보류·상담 턴에만) · **[No.44] `PUT /public/chatbots/:slug/messages/:messageId/feedback`(답변 평가 — `@Public()` 8번째, 본문 `{ sessionId, rating: UP｜DOWN }` → `200 { rating }`, 평가 전용 레이트리밋 버킷)** · `POST …/messages` 요청 `features`에 `'feedback-v1'` 값, 응답 `feedback?: { rateable: true }`(평가 가능 턴에만 — 없으면 바이트 동일) | 11, 24, 30, 44 |
````

### A-20. [개발명세서 `docs/02-spec/개발명세서.md`] §4 API 표 — 통계 행에 만족도

**찾을 원문**
````text
기존 4개의 요청·응답·오류 문구 불변 · 전부 `chatbot:read` · `@Public()` 추가 0건** | 2, 14, 29 |
````
**바꿀 내용**
````text
기존 4개의 요청·응답·오류 문구 불변 · 전부 `chatbot:read` · `@Public()` 추가 0건** **[No.44] 챗봇 스코프 `GET /stats/feedback`(답변 만족도 — 👍·👎·긍정률·참여율(분모 = 평가 버튼 제공 턴)·일별 추이·👎 상위 대상, 질문 문장 없음 · `chatbot:read` · 대시보드 무변경). `/stats/questions`는 큐 딥링크 조회에 `source='UNANSWERED'` 조건만 추가(응답 불변)** | 2, 14, 29, 44 |
````

### A-21. [개발명세서 `docs/02-spec/개발명세서.md`] §4 API 표 — 학습현황 행에 소스·직접 수정 완료

**찾을 원문**
````text
선택 필드가 추가**된다(하위호환)** | 15, 23 |
````
**바꿀 내용**
````text
선택 필드가 추가**된다(하위호환)** **[No.44] 목록 쿼리 `source`(CSV — 없음 = 전체) · 항목 `source`·부정 평가 답변 대상·`resolvedDirectly` · 요약 `bySource`(`pendingCount` = 전체 · `limitReached` = 미응답 기준 유지) · 상세 `lastFeedback`(당시 답변 마스킹본·대상)·`counterpart`(같은 질문 다른 소스) · 신규 `POST .../:id/mark-addressed`(직접 수정 완료 — 부정 평가 `PENDING` → `RESOLVED`, 의도 없음, `dialogue:write`, 비감사, 미응답 항목 `400 INVALID_STATUS_TRANSITION`)** | 15, 23, 44 |
````

### A-22. [개발명세서 `docs/02-spec/개발명세서.md`] §4 정정 이력 — 2026-09-25c 항목 추가

**찾을 원문**
````text
④ 신규 `ApiErrorCode` 4종 · 공개 경로 7곳 불변(`topic-system-설계.md` §16).
````
**바꿀 내용**
````text
④ 신규 `ApiErrorCode` 4종 · 공개 경로 7곳 불변(`topic-system-설계.md` §16).
> **정정 이력(2026-09-25c — 피드백 기반 개선 루프)**: ① 공개 대화 행에 **답변 평가 경로 1개**(`PUT …/messages/:messageId/feedback`)를 추가했다 — 평가는 턴이 아니므로 대화 전송 경로에 편승시키지 않는다(엔진·로그·`session` 버킷 오염). **공개 경로 7 → 8**(ADR-0038 §2). ② 메서드는 **`PUT`**(메시지당 내 평가를 이 값으로 둔다 — 멱등 설정). ③ 통계 행에 `GET /stats/feedback`, 학습현황 행에 `mark-addressed`를 추가했다. ④ 신규 `ApiErrorCode` 2종(`feedback-loop-설계.md` §16).
````

### A-23. [개발명세서 `docs/02-spec/개발명세서.md`] §4.1 오류 봉투 — No.44 오류 코드 2종

**찾을 원문**
````text
**이 4종도 대화 경로에서는 쓰이지 않는다** — 비활성 토픽은 최종 사용자에게 존재하지 않는다(기존 폴백으로 응답) |
````
**바꿀 내용**
````text
**이 4종도 대화 경로에서는 쓰이지 않는다** — 비활성 토픽은 최종 사용자에게 존재하지 않는다(기존 폴백으로 응답). **피드백 루프 그룹이 2종 추가** — `FEEDBACK_TARGET_NOT_FOUND`(404, 공개 평가의 기능 꺼짐·비UUID·로그 없음·챗봇/세션 불일치·평가 불가 턴을 **구분하지 않는 단일 코드** — 존재 오라클 방지, 문구 "지금은 의견을 받을 수 없어요."), `FEEDBACK_CLOSED`(409, 턴 후 24시간 경과·변경 5회 초과). 직접 수정 완료의 미응답 항목은 `INVALID_STATUS_TRANSITION`(400), 이미 처리됨은 `ALREADY_RESOLVED`(409)를 재사용한다. **대화 전송 경로는 이 2종을 쓰지 않는다** |
````

### A-24. [개발명세서 `docs/02-spec/개발명세서.md`] §4.1 챗봇 스코프 — 평가·직접 수정 완료의 `ARCHIVED` 규칙

**찾을 원문**
````text
자산의 `topicId`로 지정하면 `404 INVALID_REFERENCE`다 |
````
**바꿀 내용**
````text
자산의 `topicId`로 지정하면 `404 INVALID_REFERENCE`다. **[No.44] 만족도 통계·부정 평가 항목 조회는 `ARCHIVED`에서도 허용**하고 직접 수정 완료는 `409 CHATBOT_ARCHIVED`다. 보관 챗봇에 대한 공개 평가는 기존 공개 규약(`403 CHATBOT_NOT_PUBLISHED`)이다 |
````

### A-25. [개발명세서 `docs/02-spec/개발명세서.md`] §4.1 공개 API 계열 — 평가 경로 보상 통제

**찾을 원문**
````text
(공개 경로 판정·`*`·무자격증명은 불변 — ADR-0036 §2·§3) |
````
**바꿀 내용**
````text
(공개 경로 판정·`*`·무자격증명은 불변 — ADR-0036 §2·§3). **[No.44] 답변 평가도 이 규약을 전부 상속한다** — 추가로 (슬러그의 챗봇, 요청 `sessionId`, `messageId`) = 로그 행의 (`chatbotId`, `sessionId`, `id`) ∧ `feedbackOffered`일 때만 저장하는 **3요소 결합 검증**(서버 발급 토큰 없음 — `messageId`가 이미 서버 발급·수신자 한정 난수) · 불일치 전부 **단일 `404`** · 응답은 평가값 에코뿐(대화 텍스트·내부 id·집계 없음) · **평가 전용 레이트리밋 버킷**(`fb-ip` 120/분 + `fb-key:msg` 10/분 — 대화 `ip`·`session`·폴링 버킷 비소비)의 보상 통제를 갖는다(ADR-0038 §2·§6) |
````

### A-26. [개발명세서 `docs/02-spec/개발명세서.md`] §4.1 권한 — `@Public()` 7곳 → 8곳

**찾을 원문**
````text
(**정확히 7곳**: `/api/health`, 공개 대화 2, **보류 답변 폴링 1**, **상담 폴링 1(No.24 — 6 → 7 의도적 갱신, ADR-0036 §2)**,
````
**바꿀 내용**
````text
(**정확히 8곳**: `/api/health`, 공개 대화 2, **보류 답변 폴링 1**, **상담 폴링 1(No.24 — 6 → 7 의도적 갱신, ADR-0036 §2)**, **답변 평가 1(No.44 — 7 → 8 의도적 갱신, ADR-0038 §2)**,
````

### A-27. [개발명세서 `docs/02-spec/개발명세서.md`] §4.1 권한 — No.44 권한 보론

**찾을 원문**
````text
토픽 단위 담당자 권한은 만들지 않는다(No.45 — ADR-0037 §7) |
````
**바꿀 내용**
````text
토픽 단위 담당자 권한은 만들지 않는다(No.45 — ADR-0037 §7). **[2026-09-25 No.44] 피드백 루프는 신규 권한 0종이다** — 스위치 `channel:write` · 부정 평가 항목 조회 `dialogue:read`·직접 수정 완료 `dialogue:write` · 만족도 통계 `chatbot:read`(AGENT 포함). 공개 평가는 인증 대상이 아니라 결합 검증 보상 통제다 |
````

### A-28. [개발명세서 `docs/02-spec/개발명세서.md`] §5 성능 — No.44 항목 추가

**찾을 원문**
````text
**K-1(번들 결정적 정렬)은 `ORDER BY` 7개 추가로 캐시 미스 비용만 소폭 늘린다**(챗봇당 수천 행 정렬).
````
**바꿀 내용**
````text
**K-1(번들 결정적 정렬)은 `ORDER BY` 7개 추가로 캐시 미스 비용만 소폭 늘린다**(챗봇당 수천 행 정렬).
  - **[신규 2026-09-25 — 피드백 루프] 기능이 꺼진 챗봇·`feedback-v1` 미선언 위젯의 공개 대화 예산(P95 500ms)·응답 바이트는 불변**이다(추가 조회 0 · `features` 단락 판정으로 설정 파싱조차 없음). **기능 켜진 챗봇의 대화 턴도 추가 조회 0**(`access.resolve()`가 읽은 WEB 채널 행 재사용 · 응답 +24바이트). **공개 평가 P95 100ms**(로그 PK 1 · 원장 조회 1 · 쓰기 1 — 첫 👎는 + 선점 1 · 큐 2~3 · 확정 1) · 대화 전송 P95 영향 0(버킷·경로 분리). **만족도 통계 P95 1초**(92일 · 원장 10만 · 로그 100만 행 · 쿼리 ≤7 고정 · 반환 행 = 버킷×2 + 대상×2). 학습현황 목록은 기존 500ms 유지(부정 평가 행 존재 시 +3쿼리 고정 — N+1 없음). 위젯 gzip +2KB 이하. `conversation_logs` 컬럼 추가는 SQLite `ADD COLUMN`(재작성 없음) — 100만 행 DB 전체 마이그레이션 소요를 실측·기록한다(ADR-0038).
````

### A-29. [개발명세서 `docs/02-spec/개발명세서.md`] §5 보안 — 공개 경로 7곳 → 8곳

**찾을 원문**
````text
공개 경로 7곳만 `@Public()`으로 opt-out 한다.
````
**바꿀 내용**
````text
공개 경로 8곳만 `@Public()`으로 opt-out 한다(2026-09-25 No.44 답변 평가 — 7 → 8).
````

### A-30. [개발명세서 `docs/02-spec/개발명세서.md`] §5 보안 — 평가 전용 레이트리밋 버킷

**찾을 원문**
````text
같은 NAT 뒤 폴링이 일반 전송을 429로 만들던 K-1 결함 해소)
````
**바꿀 내용**
````text
같은 NAT 뒤 폴링이 일반 전송을 429로 만들던 K-1 결함 해소 · **[No.44] 답변 평가는 평가 전용 `fb-ip` 120/분 + `fb-key:msg:{messageId}` 10/분만 소비한다** — 평가 연타가 다음 질문 전송을 429로 만들지 않고 폴링과도 간섭하지 않는다)
````

### A-31. [개발명세서 `docs/02-spec/개발명세서.md`] §5 보안 — 피드백 루프 봉인 항목 추가

**찾을 원문**
````text
⑥ 위 전부를 `topic-sealing.spec.ts` **T-1~T-16**으로 강제한다.
````
**바꿀 내용**
````text
⑥ 위 전부를 `topic-sealing.spec.ts` **T-1~T-16**으로 강제한다.
  - **[신규 2026-09-25] 피드백 루프의 개인정보·봉인(ADR-0038)**: ① **평가는 자기가 받은 답변에만** — 3요소 결합 검증(챗봇·세션·메시지 + `feedbackOffered`) · 불일치 단일 `404` · 서버 발급 토큰 없음(재검토 트리거 = 평가 응답이 대화 데이터를 돌려주게 될 때). ② **평가 원장에 질문·답변 텍스트·`sessionId`·IP·User-Agent 컬럼이 없다**(컬럼 이름 허용 목록 정적 검사) · 자유 텍스트 사유 미수집(No.45 전까지). ③ 큐에 들어가는 문장은 **로그의 마스킹본뿐** — 원문 재접촉 경로 0(ADR-0013 적용 지점 불변). ④ 원장 **삭제 코드 0건** · 쓰기 1파일 · FK `Restrict` · 영구삭제 사전검사(ADR-0033 봉인 확장) · 로그 `update` 0 유지. ⑤ 서버 로그·오류 응답에 질문·답변 본문·`sessionId` 전체값 0(`chatbotId`·결과 코드만). ⑥ 평가·편입·직접 수정 완료는 감사 비대상(사용자 발화 유입 방지 — ADR-0019 §6·ADR-0035 선례). ⑦ 위 전부를 `feedback-sealing.spec.ts` **F-1~F-16**으로 강제한다. **[알려진 리스크]** 원장(텍스트 없음)의 보존기간도 무기한이다 — No.45.
````

### A-32. [개발명세서 `docs/02-spec/개발명세서.md`] §5 접근성/UI 품질 — 평가 버튼 원칙

**찾을 원문**
````text
시작·폴백 노드의 토픽 선택은 비활성 + 사유 텍스트다.**
````
**바꿀 내용**
````text
시작·폴백 노드의 토픽 선택은 비활성 + 사유 텍스트다.** **[No.44] 위젯 평가 버튼은 서버가 평가 가능으로 표시한 봇 말풍선 **밖**(아래)의 `role="group"` 안 네이티브 버튼 2개이며 아이콘 + 텍스트 접근 이름("도움이 됐어요"/"도움이 안 됐어요") · `aria-pressed` + 시각 표시 2중 · 터치 44×44px · 포커스 이동 없음이다. 선택·실패 안내는 상태 영역(`#cb-status`)에 1회이고, 메시지 목록(`role="log"`)에는 새 노드를 추가하지 않는다(속성 변경·기존 `aria-hidden` 요소의 텍스트 교체만). 콘솔의 소스·"현재 매칭"·"삭제됨"은 텍스트 배지, 만족도 차트는 표 대체를 동반하고, 직접 수정 완료가 불가한 항목은 비활성 + 사유 텍스트다.**
````

### A-33. [개발명세서 `docs/02-spec/개발명세서.md`] §5 확장성 — 피드백 루프가 추가한 상태

**찾을 원문**
````text
분리는 DB 트랜잭션 하나로 끝나 인스턴스 간 조정이 없다.
````
**바꿀 내용**
````text
분리는 DB 트랜잭션 하나로 끝나 인스턴스 간 조정이 없다. **[No.44] 피드백 루프는 새 프로세스 로컬 상태를 추가하지 않는다** — 메시지당 1행(유일 키)·변경 계수(CAS)·큐 기여 1회(원장 선점 `updateMany`)가 전부 DB 조건부 갱신이라 다중 인스턴스에서도 조정이 필요 없다. 평가 전용 레이트리밋 버킷은 기존 `RateLimitStore`(인스턴스별 한도 — 기존과 같은 수용)를 쓴다.
````

### A-34. [개발명세서 `docs/02-spec/개발명세서.md`] §5 가용성 — 편입 실패 흡수

**찾을 원문**
````text
사후 해시 검증과 양립시킨다**(ADR-0037 §4).
````
**바꿀 내용**
````text
사후 해시 검증과 양립시킨다**(ADR-0037 §4). **[신규 2026-09-25] 답변 평가의 큐 편입 실패는 평가 실패가 아니다** — 수집기는 예외를 던지지 않고 원장에 `FAILED`를 남기며 평가 응답은 `200`이다(재시도 없음 — 통계 무영향). 로그 적재가 늦거나(보류 답변 `READY` 직후) 실패한 턴의 평가는 `404`이며 위젯이 1초 뒤 1회 재시도로 흡수한다. 평가 저장 실패는 대화 전송과 독립이다(ADR-0038).
````

### A-35. [개발명세서 `docs/02-spec/개발명세서.md`] §5 DB 이식성 — 인덱스 교체·원시 SQL 0

**찾을 원문**
````text
직렬화 실패를 `409 TOPIC_SPLIT_BUSY`로 매핑한다.
````
**바꿀 내용**
````text
직렬화 실패를 `409 TOPIC_SPLIT_BUSY`로 매핑한다. **[No.44] 피드백 루프는 원시 SQL을 추가하지 않는다**(원시 SQL 보유 파일 4개 불변 — R-7). 큐 유일 키 변경은 **유니크 인덱스 교체**(`DROP INDEX` + `CREATE UNIQUE INDEX` — SQLite·Postgres 공통)로 테이블 재정의가 없고, 원장 변경·편입 선점은 `updateMany` + 영향 행 수(CAS)다. 마이그레이션은 수기 작성하며 새 컬럼은 모델 끝에 선언해 `migrate dev` diff를 최소화한다.
````

### A-36. [개발명세서 `docs/02-spec/개발명세서.md`] §5.1 환경변수 표 — No.44 5종 추가

**찾을 원문**
````text
| **`HANDOFF_WATCH_INTERVAL_MS`** | `apps/api/.env` | — | `5000` | 관찰 창 폴링 간격 |
````
**바꿀 내용**
````text
| **`HANDOFF_WATCH_INTERVAL_MS`** | `apps/api/.env` | — | `5000` | 관찰 창 폴링 간격 |
| **`PUBLIC_FEEDBACK_RATE_LIMIT_IP_PER_MIN`** | `apps/api/.env` | — | `120` | 답변 평가 전용 IP 버킷(`fb-ip`) — 대화·폴링 버킷과 분리(No.44) |
| **`PUBLIC_FEEDBACK_RATE_LIMIT_MESSAGE_PER_MIN`** | `apps/api/.env` | — | `10` | 답변 평가 메시지 키 버킷(`fb-key:msg:{messageId}`) |
| **`FEEDBACK_CHANGE_WINDOW_HOURS`** | `apps/api/.env` | — | `24` | 평가 저장·변경 허용 기한(로그 `createdAt` 기준, 1~168) |
| **`FEEDBACK_MAX_CHANGES`** | `apps/api/.env` | — | `5` | 메시지당 평가 값 변경 횟수 상한(0~20) |
| **`FEEDBACK_QUEUE_MAX_PENDING`** | `apps/api/.env` | — | `2000` | 챗봇당 학습현황 `부정 평가` 소스 `PENDING` 상한(미응답 상한과 별개) |
````

### A-37. [개발명세서 `docs/02-spec/개발명세서.md`] §5.1 그룹별 주석 — No.44

**찾을 원문**
````text
데모 `AGENT` 계정 1개를 만들며 상담 스레드 시드는 없다.
````
**바꿀 내용**
````text
데모 `AGENT` 계정 1개를 만들며 상담 스레드 시드는 없다.
> **피드백 루프 그룹(No.44)이 추가한 5개도 전부 선택이며 API 전용이다(ml-worker 변수 추가 0건).** 하나도 설정하지 않으면 평가 IP 120/분 · 메시지 10/분 · 기한 24시간 · 변경 5회 · 부정 평가 대기 상한 2,000으로 동작한다. **기능 스위치는 환경변수가 아니라 챗봇별 WEB 채널 설정 `feedbackEnabled`(기본 꺼짐)**다. seed는 데모 챗봇 스위치를 켜고 평가 원장 3건 + 부정 평가 큐 1건을 **대응 로그 행과 함께** 만든다(원장·큐가 있으면 로그도 있다).
````

### A-38. [개발명세서 `docs/02-spec/개발명세서.md`] §6 결정 16(ADR-0011) — No.44 갱신 각주

**찾을 원문**
````text
폴링은 기존 `ip`·`session` 버킷이 아니라 폴링 전용 버킷을 소비한다(ADR-0011 갱신 각주, ADR-0036 §2).
````
**바꿀 내용**
````text
폴링은 기존 `ip`·`session` 버킷이 아니라 폴링 전용 버킷을 소비한다(ADR-0011 갱신 각주, ADR-0036 §2).
    - **갱신(2026-09-25 — No.44)**: 공개 경로에 **답변 평가 `PUT /public/chatbots/:slug/messages/:messageId/feedback`**가 추가되어 `@Public()`이 8곳이 된다. 공개 규약(404/403·Origin 가드·내부 필드 미노출)을 전부 상속하고, 평가 전용 버킷(`fb-ip`·`fb-key`)만 소비하며, 3요소 결합 검증·단일 404·평가값 에코 응답을 보상 통제로 갖는다(ADR-0011 갱신 각주, ADR-0038 §2·§6).
````

### A-39. [개발명세서 `docs/02-spec/개발명세서.md`] §6 결정 17(ADR-0012) — No.44 갱신 각주

**찾을 원문**
````text
vanilla TS·런타임 의존성 0·gzip 100KB 게이트 유지(ADR-0012 갱신 각주, ADR-0036 §2).
````
**바꿀 내용**
````text
vanilla TS·런타임 의존성 0·gzip 100KB 게이트 유지(ADR-0012 갱신 각주, ADR-0036 §2).
    - **갱신(2026-09-25 — No.44)**: 위젯에 답변 평가 버튼(`feedback-v1` 선언 · 서버 표식이 있는 봇 말풍선에만 · 1회 재시도)이 들어가지만 `core/feedback.ts`(순수 재시도·표시 결정) + `ui/feedback-bar.ts`(DOM)로 흡수되어 **Preact 재검토 트리거는 발동하지 않는다** — 평가 상태는 DOM에만(저장소 0), 증가분 gzip 2KB 이하(ADR-0012 갱신 각주, ADR-0038).
````

### A-40. [개발명세서 `docs/02-spec/개발명세서.md`] §6 결정 20(ADR-0015) — No.44 갱신 각주

**찾을 원문**
````text
역할은 여전히 전역이며 챗봇별 상담원 배정은 후속(ADR-0015 갱신 각주, ADR-0036 §7).
````
**바꿀 내용**
````text
역할은 여전히 전역이며 챗봇별 상담원 배정은 후속(ADR-0015 갱신 각주, ADR-0036 §7).
    - **갱신(2026-09-25 — No.44)**: 피드백 루프는 **신규 권한·역할 0종**이다(PM 확정 P-15). 스위치 = `channel:write`, 부정 평가 항목 조회·처리 = `dialogue:read`/`dialogue:write`, 만족도 통계 = `chatbot:read`. **공개 경로 7 → 8**(답변 평가 — 인증 대상이 아니라 3요소 결합 검증 보상 통제). `Permission` 17종·역할 4종 불변(ADR-0015 갱신 각주, ADR-0038 §2).
````

### A-41. [개발명세서 `docs/02-spec/개발명세서.md`] §6 결정 24(ADR-0019) — No.44 갱신 각주

**찾을 원문**
````text
(기록하면 사용자 발화가 감사로그에 유입되어 NFR-S8 위반). → **ADR-0019**
````
**바꿀 내용**
````text
(기록하면 사용자 발화가 감사로그에 유입되어 NFR-S8 위반). → **ADR-0019**
    - **갱신(2026-09-25 — No.44)**: 병합 키가 **`(chatbotId, source, questionNormalized)`**로 바뀌어 `NEGATIVE_FEEDBACK`(👎) 소스가 분리된다(인덱스 교체 — 기존 행 충돌 0). **두 번째 적재 진입점** `collectNegativeFeedback()`은 평가 요청 안에서 호출되지만 입력은 **로그 행의 마스킹본**이라 "마스킹 지점 = 적재 지점" 근거가 유지된다. 판정은 `collect-decision.ts` 1벌 공유(제외 = API 고정 문구·이미 미응답·`NODE` 버튼·빈 입력·장문·상한). **`inputKind`를 로그 컬럼으로 승격**(§3 재검토 트리거 발동 — 평가는 턴 뒤에 도착). **소스별 `PENDING` 상한**(5,000 / 2,000) · 신규 전이 "직접 수정 완료"(부정 평가 전용, 비감사). **정정**: `unansweredQuestion` 쓰기 파일은 No.23 이후 **3개**(수집기·상태 전이·요소분해 반영)이며 이 그룹은 집합을 바꾸지 않는다(ADR-0019 갱신 각주, ADR-0038 §4).
````

### A-42. [개발명세서 `docs/02-spec/개발명세서.md`] §6 결정 28(ADR-0023) — No.44 갱신 각주

**찾을 원문**
````text
보류 턴이 실패하면 위젯이 상담 관찰 창을 여는 신호(`IF_PENDING_FAILS`)는 PENDING 응답에 실리며 폴링 경로·스키마는 무변경이다(ADR-0023 갱신 각주, ADR-0036 §2).
````
**바꿀 내용**
````text
보류 턴이 실패하면 위젯이 상담 관찰 창을 여는 신호(`IF_PENDING_FAILS`)는 PENDING 응답에 실리며 폴링 경로·스키마는 무변경이다(ADR-0023 갱신 각주, ADR-0036 §2).
    - **갱신(2026-09-25 — No.44)**: 보류 턴의 평가 가능 표시(`feedback`)도 **PENDING 응답**에 실리고, 로그는 백그라운드 완료 시 같은 `feedbackOffered` 값으로 1건 적재된다(`RagAnswerRunInput`·`ConversationLogPort`에 선택 필드). 폴링 경로·스키마·`complete()` → `record()` 순서는 무변경이며, `READY` 직후 로그 적재 전의 평가(`404`)는 위젯이 1초 뒤 1회 재시도로 흡수한다(ADR-0023 갱신 각주, ADR-0038 §1).
````

### A-43. [개발명세서 `docs/02-spec/개발명세서.md`] §6 결정 39 신설

**찾을 원문**
````text
GPU **1 유지**(P-15). → **ADR-0037**(+ ADR-0002·0005·0008·0016·0025·0031 갱신 각주)
````
**바꿀 내용**
````text
GPU **1 유지**(P-15). → **ADR-0037**(+ ADR-0002·0005·0008·0016·0025·0031 갱신 각주)

39. **피드백 기반 개선 루프(No.44)의 평가 단위·공개 표면·원장·큐 모델·스위치·통계 확정(2026-09-25 — PM 도입 확정)**: **① 평가 단위 = 봇 응답 턴 1개**(`messageId` = `ConversationLog.id`) — API 계층 순수 함수 `isFeedbackOffered()`(위젯 `feedback-v1` ∧ WEB `feedbackEnabled` ∧ BLOCK·설문 소비·상담 턴 아님)가 참이면 응답 선택 필드 `feedback: { rateable: true }` + 로그 **`feedbackOffered`**(적재 시점 확정), 거짓이면 키 생략(**바이트 동일**) · 로그 **`inputKind` 컬럼화**(ADR-0019 §3 트리거 발동) · 엔진 수정 0(P-12·P-13). **② 공개 평가 `PUT /public/chatbots/:slug/messages/:messageId/feedback` 1개(`@Public()` 7 → 8)** — **토큰 없음 · 3요소 결합 검증(챗봇·세션·메시지 + `feedbackOffered`) · 불일치 단일 `404`** · 응답 = 평가값 에코뿐(P-2·P-3). **③ 평가 원장 `MessageFeedback`** — 메시지당 1행 · 변경 24시간·5회(CAS) · 취소 없음 · 턴 사실·답변 대상 비정규화 · **텍스트·`sessionId` 컬럼 0** · 쓰기 1파일 · 삭제 0 · 영구삭제 사전검사 15종 · 스냅샷 밖(P-3·P-9). **④ 평가 전용 레이트리밋 버킷**(`fb-ip` 120/분 + `fb-key:msg` 10/분 · 대화·폴링 버킷 비소비 — `PublicRateBucket` kind 확장)(P-4). **⑤ 큐 소스 분리** — 유일 키 `(chatbotId, source, questionNormalized)`(인덱스 교체 — 재정의 0 · 부분 유니크 4개 무영향) · 👎 1회 즉시 편입 · 제외 5종 + 상한(판정 1벌 공유) · 소스별 상한 5,000/2,000 · **원장 선점 상태 기계로 메시지당 1회 기여**(실패 흡수·재시도 없음) · 👍 비반영 · 쓰기 파일 집합 불변(3파일 — 정정)(P-5·P-6·P-8). **⑥ 학습현황** — 소스 필터·배지 · 당시 답변(마스킹본)·답변 대상 · "현재 매칭" 배지 · **직접 수정 완료**(`RESOLVED` + 의도 없음 · 비감사) · 대상 편집 링크(P-7). **⑦ 스위치 = WEB 채널 config 선택 키 `feedbackEnabled`**(설정 테이블 기각 — 대화 턴 추가 조회 0 · `.default` 기각 — 바이트 불변)(P-11). **⑧ 만족도 = No.14 화면 새 섹션 · `GET /stats/feedback`**(긍정률·참여율(분모 `feedbackOffered`)·추이·👎 상위 대상 · 질문 문장 없음 · 대시보드 무변경 · No.29 2차)(P-10). **⑨ No.14 질문 순위 큐 딥링크에 `source='UNANSWERED'` 조건**(소스 분리가 여는 잠재 충돌 — 결과 불변). **⑩ 신규 권한·역할·감사 0**(P-15) · 신규 `ApiErrorCode` 2종 · 선택 환경변수 5종 · 원시 SQL 0 · 위젯 vanilla 유지. GPU **2 유지**(P-16). → **ADR-0038**(+ ADR-0002·0011·0012·0015·0019·0023·0033 갱신 각주)
````

### A-44. [개발명세서 `docs/02-spec/개발명세서.md`] §7 인덱스 — 설계서 행 추가

**찾을 원문**
````text
알려진 제한 12건 · 요구사항 대비 해석 18건** | 요구사항: `docs/requirements/topic-system.md` |
````
**바꿀 내용**
````text
알려진 제한 12건 · 요구사항 대비 해석 18건** | 요구사항: `docs/requirements/topic-system.md` |
| **`feedback-loop-설계.md`** | **피드백 기반 개선 루프(No.44) — 모듈 배치(`feedback` export 1 · 원장 쓰기 유일 파일 · 공개 진입 `PublicFeedbackService` · 읽기 전용 `stats/feedback`) · 엔진 수정 0 · 커밋 분리(① 큐 소스 분리 준비 — 동작 불변) · Prisma 변경안(`MessageFeedback` 신설 + `ConversationLog.feedbackOffered`·`inputKind` + `UnansweredQuestion.lastFeedbackLogId`·유일 키 교체, **비파괴·백필 0·재정의 0 · 부분 유니크 4개 보존 확인**) · shared-types(`feedback.ts` · 선택 필드 확장 · `classifyFeedbackTarget`) · **스위치 위치(WEB config 선택 키)** · **평가 가능 판정표·응답 키 생략·로그 표식·보류 턴·C-1** · **공개 평가 계약·★위조 방어 판정 순서(단일 404)·멱등/변경/기한 결정 함수** · 평가 전용 버킷 · 원장(컬럼 허용 목록·턴 사실 복사·동시성·★선점 상태 기계·봉인 관계) · **큐 편입(판정 1벌·두 번째 진입점·소스별 상한·No.14 딥링크 충돌 정정)** · 학습현황 API(소스 필터·요약·직접 수정 완료·상세·원장 추이) · 만족도 통계(쿼리 계획·지표 식) · 위젯(표시 규칙·`messageId` 연결·접근성·재시도 표) · 권한 · 감사 · 3개 엔드포인트·오류 2종 · **봉인 F-1~F-16** · 성능 예산 · 경계 · 콘솔 인계 · 시험 포인트·**의도된 기대값 변경 8건(닫힌 목록)** · 알려진 제한 10건 · 요구사항 대비 해석 22건** | 요구사항: `docs/requirements/feedback-loop.md` |
````

### A-45. [개발명세서 `docs/02-spec/개발명세서.md`] §7 인덱스 — ADR-0038 행 추가

**찾을 원문**
````text
FR-TP1-\*~FR-TP8-\*, AC-TP1~TP7 |
````
**바꿀 내용**
````text
FR-TP1-\*~FR-TP8-\*, AC-TP1~TP7 |
| **`decisions/ADR-0038-answer-feedback-message-capability-ledger-and-queue-source-split.md`** | **답변 평가 = 봇 응답 턴 단위 · 적재 시점 로그 표식(`feedbackOffered`·`inputKind` 컬럼화) · 공개 평가 1개(`@Public()` 8) + 3요소 결합 검증·단일 404(서버 발급 토큰 기각) · 텍스트·`sessionId` 없는 평가 원장(메시지당 1행·CAS 변경·삭제 0·사전검사) · 큐 소스 분리(유일 키 인덱스 교체 — 같은 행 카운터·별도 테이블 기각) · ★선점 상태 기계로 메시지당 1회 편입 · WEB 채널 config 선택 키 스위치(설정 테이블·`.default` 기각) · 평가 전용 버킷(`poll-ip` 공유 기각) · No.14 섹션 만족도(대시보드 기각) · 신규 권한 0** | 요구사항 J-1~J-19, FR-0-138~148, FR-FB1-\*~FR-FB10-\*, AC-FB1~FB8 |
````

### A-46. [개발명세서 `docs/02-spec/개발명세서.md`] §7 인덱스 — ADR-0015 행의 `@Public()` 개수 갱신

**찾을 원문**
````text
`@Public()` **6곳**(2026-09-22 갱신)
````
**바꿀 내용**
````text
`@Public()` ~~**6곳**(2026-09-22 갱신)~~ **8곳**(2026-09-25 No.44 갱신 — 6 → 7 No.24 상담 폴링 · 7 → 8 답변 평가)
````

---

## B. 기존 ADR (결정 본문은 수정하지 않는다 — 파일 끝 append)

### B-1. [ADR-0019] `docs/02-spec/decisions/ADR-0019-unanswered-queue-collection-model.md` — 소스 분리 · 두 번째 진입점 · `inputKind` 컬럼화 · 쓰기 파일 정정 (append)

**찾을 원문**
````text
사유 표시를 위해 `apiNotice`를 로그 컬럼으로도 남긴다(`record()` 1곳).
````
**바꿀 내용**
````text
사유 표시를 위해 `apiNotice`를 로그 컬럼으로도 남긴다(`record()` 1곳).


---

## 갱신 (2026-09-25 — No.44: 소스 분리 유일 키 · 두 번째 적재 진입점 · `inputKind` 컬럼화 · 소스별 상한 · 직접 수정 완료 · 쓰기 파일 3 정정)

피드백 기반 개선 루프(No.44, **ADR-0038 §1·§4**). 결정 §1(실시간 upsert)·§4(추천 비저장)·§5(재발생 정책·물리 삭제 없음)·§6(비감사)은 **불변**이다.

1. **§1 병합 키 변경**: `(chatbotId, questionNormalized)` → **`(chatbotId, source, questionNormalized)`**. 91행이 예고한 `NEGATIVE_FEEDBACK` 소스가 같은 테이블에 들어오되, 같은 질문의 "못 답함"과 "답했는데 틀림"이 **각각 1행**이다(처방이 다르다 — 예문 추가 vs 답변 수정). 기존 행은 전부 `UNANSWERED`라 데이터 충돌 0이며, SQLite에서도 **유니크 인덱스 교체**만으로 끝난다(테이블 재정의 0). 기존 수집 경로는 `source = 'UNANSWERED'`를 명시적으로 쓴다(동작 불변).
2. **§2 두 번째 적재 진입점**: `UnansweredCollectorService.collectNegativeFeedback()` — 평가 요청의 👎 확정 시 호출된다. `record()` 밖이지만 입력은 **`ConversationLog.userMessage`(이미 마스킹된 값)** 이므로 "마스킹 지점 = 적재 지점" 근거(88행)가 깨지지 않는다 — 원문을 다시 만지지 않는다. 실패는 흡수하고(평가 응답 `200`) 재시도하지 않는다. 메시지당 1회 기여는 평가 원장의 선점 상태 기계가 보장한다.
3. **§2 쓰기 주체 정정**: 45행의 "쓰기는 2곳뿐"은 No.23(학습 고도화)이 `learning/decomposed-resolve.service.ts`에 요소분해 반영의 CAS 전이를 더한 뒤 **3곳**이었다. 이 그룹은 이 **3파일 집합을 바꾸지 않으며**(편입 = 수집기의 두 번째 메서드 · 직접 수정 완료 = 상태 전이 서비스) `feedback-sealing.spec.ts` F-9가 정확한 집합을 단언한다.
4. **§3 재검토 트리거 발동 — `inputKind` 컬럼화**: 57행의 트리거("입력 유형별 지표 요구")가 발동했다. 평가는 턴이 끝난 뒤 도착하므로 큐 편입 판정이 로그 행만 보고 `BUTTON_NODE` 턴을 걸러야 한다. `record()` 파라미터를 그대로 `ConversationLog.inputKind`에 적재한다(1곳 · 적재 후 불변 · 인덱스 없음 · 기존 행 null). 감수 비용 3("버튼 턴을 사후 로그로 구분할 수 없다")은 도입 이후 행부터 해소된다.
5. **§3 판정 1벌 공유**: `collect-decision.ts`에 `shouldQueueNegativeFeedback()`을 더하고 정규화·빈 입력·장문 판정을 `shouldCollect()`와 같은 내부 함수로 공유한다. 부정 평가 제외 사유 = `API_NOTICE` → `ALREADY_UNANSWERED`(폴백은 이미 미응답으로 수집됨) → `BUTTON_NODE`(`TEXT`·`BUTTON_MESSAGE`가 아니면 — null 포함) → `EMPTY` → `TOO_LONG`(+ 상한 `LIMIT_REACHED`). `shouldCollect()`의 동작·사유 순서는 불변.
6. **§5 상한의 소스별 분리**: `UNANSWERED` = `UNANSWERED_MAX_PENDING`(5,000 — 계수에 소스 조건만 추가, 도입 전과 같은 값) · `NEGATIVE_FEEDBACK` = `FEEDBACK_QUEUE_MAX_PENDING`(2,000). 한 소스의 상한이 다른 소스 수집을 막지 않는다. 요약 API의 `limitReached`는 기존 의미(미응답 기준)를 유지하고 `bySource`를 더한다.
7. **새 전이 "직접 수정 완료"**: `NEGATIVE_FEEDBACK` 항목의 원인이 "매칭은 맞는데 답변 내용이 틀림"이면 예문 추가가 무의미하므로, `PENDING → RESOLVED`(`resolvedIntentId = null`, CAS)를 둔다(`dialogue:write`). `UNANSWERED` 항목에는 허용하지 않는다(`400 INVALID_STATUS_TRANSITION`). **§6 그대로 감사하지 않는다.**
````

### B-2. [ADR-0011] `docs/02-spec/decisions/ADR-0011-channel-implementation-tier-and-public-surface.md` — 공개 경로 8번째 = 답변 평가 (append)

**찾을 원문**
````text
경로 키 버킷**만 소비한다 — 같은 NAT 뒤 폴링이 일반 대화 전송을 `429`로 만드는 것을 막는다.
````
**바꿀 내용**
````text
경로 키 버킷**만 소비한다 — 같은 NAT 뒤 폴링이 일반 대화 전송을 `429`로 만드는 것을 막는다.


---

## 갱신 (2026-09-25 — No.44: 공개 경로 8번째 = 답변 평가 · 평가 전용 버킷 · WEB 설정 스위치)

피드백 기반 개선 루프(No.44, **ADR-0038 §2·§5·§6**). §4(404/403)·§5(Origin 인가 = 서버 가드)·§6(공개 응답 별도 스키마)은 **불변**이다.

1. **`PUT /public/chatbots/:slug/messages/:messageId/feedback`** — 공개 대화 컨트롤러의 5번째 핸들러이며 `@Public()` 전체는 **8곳**이다. 레이트리밋 → Origin 가드 순서·`404`/`403` 규약·`Cache-Control: no-store`를 상속한다. 쓰기 경로이지만 **대화 데이터를 돌려주지 않는다**(응답 = 평가값 에코).
2. **§4 보론 — 단일 404**: 슬러그 미존재·비공개·채널 닫힘은 기존 규약(404/403)이다. 그 뒤의 기능 꺼짐·비UUID·로그 없음·챗봇/세션 불일치·평가 불가 턴은 **전부 같은 `404 FEEDBACK_TARGET_NOT_FOUND`** 다 — 공개 표면이지만 "남의 메시지 존재"는 슬러그와 달리 공개 값이 아니므로 ADR-0003의 은닉 규약을 그대로 적용한다.
3. **§6 확장**: `PublicFeedbackRequest`(`sessionId`·`rating`) · `PublicFeedbackResponse`(`rating`) · 응답 선택 필드 `feedback`(`rateable`)의 키 집합은 정적 검사가 **정확히** 단언한다(내부 id·텍스트·집계가 타입상 들어갈 수 없다).
4. **§2 보론 — WEB config 선택 키 `feedbackEnabled`**: 자격증명 성격이 아닌 표시 설정이며 `.strict()` 스키마에 선택 키로 추가한다(없음 = 꺼짐). `.default(false)`를 쓰지 않아 기존 채널 응답·파싱 결과 바이트가 바뀌지 않는다.
5. **레이트리밋**: 평가는 기존 `ip`·`session`·`poll-ip` 버킷을 소비하지 않고 **`fb-ip`(120/분) + `fb-key:msg:{messageId}`(10/분)**만 소비한다.
````

### B-3. [ADR-0015] `docs/02-spec/decisions/ADR-0015-role-permission-model.md` — `@Public()` 7 → 8 · 신규 권한 0 (append)

**찾을 원문**
````text
`@Public()` 6 → 7(상담 폴링 — 인증 대상이 아니라 토큰 보상 통제).
````
**바꿀 내용**
````text
`@Public()` 6 → 7(상담 폴링 — 인증 대상이 아니라 토큰 보상 통제).


---

## 갱신 (2026-09-25 — No.44 피드백 루프: `@Public()` 7 → 8 · 신규 권한 0종)

피드백 기반 개선 루프(No.44, **ADR-0038 §2**)는 **신규 권한·역할을 만들지 않는다**(PM 확정 P-15). `Permission` 17종 · 역할 4종 · `ROLE_PERMISSIONS` · fail-closed 판정 순서는 전부 불변이다.

- **`@Public()` 7 → 8** — 답변 평가(`PUT …/messages/:messageId/feedback`). 인증 대상이 아니라 **3요소 결합 검증**(챗봇·세션·서버 발급 `messageId` + `feedbackOffered`)·단일 404·평가 전용 버킷의 보상 통제다. 개수 고정 테스트는 무력화하지 않고 8로 갱신한다(숫자 단언 5파일 + 제목 1파일 — `feedback-loop-설계.md` §21.2).
- 스위치 = `channel:write` · 부정 평가 항목 조회 `dialogue:read` / 직접 수정 완료 `dialogue:write`(바꾸는 자원 = 학습 큐) · 만족도 통계 `chatbot:read`(AGENT 포함 — 통계와 같은 도메인).
````

### B-4. [ADR-0033] `docs/02-spec/decisions/ADR-0033-cumulative-stats-source-log-sealing-and-group-snapshot.md` — 봉인 대상에 평가 원장 (append)

**찾을 원문**
````text
상담 롤업 = `(chatbotId, dayBucket)` 키의 건수·종료 사유·첫 응답/상담 시간 합계 + `groupId` 스냅샷(텍스트·세션 ID 없음).
````
**바꿀 내용**
````text
상담 롤업 = `(chatbotId, dayBucket)` 키의 건수·종료 사유·첫 응답/상담 시간 합계 + `groupId` 스냅샷(텍스트·세션 ID 없음).


---

## 갱신 (2026-09-25 — No.44: 봉인 대상에 평가 원장 · 로그 표식 2컬럼 · `groupId` 스냅샷 복사)

피드백 기반 개선 루프(No.44, **ADR-0038 §3**). 결정 1~8은 불변이다.

1. **L1 DB**: `MessageFeedback → Chatbot` FK `onDelete: Restrict`(Cascade/SetNull 없음). `conversationLogId`는 FK 없음(로그 규약).
2. **L2 서비스**: 챗봇 영구삭제 사전검사에 `messageFeedbacks`('답변 평가')를 추가한다(14 → 15종, 동반 삭제 목록에 넣지 않는다). 원장 행은 로그 행 없이 생길 수 없어 차단 집합은 실질적으로 불변이다.
3. **L3 정적 검사**(`feedback-sealing.spec.ts`): 원장의 `delete`/`deleteMany`/원시 `DELETE` **0건** · 쓰기 1파일 · 컬럼 이름 허용 목록(텍스트·`sessionId` 없음). **로그 `update*` 0건(R-10)은 유지된다** — 평가값은 로그에 쓰지 않고 별도 원장에 둔다. 로그에 새로 생기는 `feedbackOffered`·`inputKind`는 `groupId`와 같이 **적재 시점에 확정되는 사실**이며 `record()` 1곳에서만 쓴다.
4. **결정 4 재사용**: `MessageFeedback.groupId` = 로그의 `groupId` 복사(**대화 당시** 그룹 — 평가 시점 소속이 아니다). 그룹·전역 만족도는 1차 범위 밖이지만 후속 통합이 과거를 소급 변경하지 않도록 지금 적재한다.
5. **롤업 규약**: 향후 원장 삭제(No.45 보존기간·파기)도 단일 서비스 + 같은 트랜잭션의 수치 롤업 선적재로만 추가한다 — 평가 롤업 = `(chatbotId, turnDayBucket, targetKind, targetId)` 키의 👍/👎 건수 + `groupId` 스냅샷(텍스트·세션 ID 없음).
````

### B-5. [ADR-0002] `docs/02-spec/decisions/ADR-0002-permanent-delete-referential-integrity.md` — 사전검사 14 → 15종 (append)

**찾을 원문**
````text
한 트랜잭션에서 소속을 비운 뒤 지운다 — 암묵적 cascade·`SetNull`을 쓰지 않는다.
````
**바꿀 내용**
````text
한 트랜잭션에서 소속을 비운 뒤 지운다 — 암묵적 cascade·`SetNull`을 쓰지 않는다.


---

## 갱신 (2026-09-25 — No.44: 사전검사 대상 14 → 15종)

피드백 기반 개선 루프(No.44, **ADR-0038 §3**)에 따라 결정 3의 사전검사 목록에 **`messageFeedbacks`('답변 평가')**를 추가한다(14 → 15종). 결정 1~6은 불변이다.

- 평가 원장은 사용자 판단의 원천 기록이라 **"하위 데이터 제거"(동반 삭제) 분류가 아니다**. 삭제 코드 0건(ADR-0033 봉인 확장).
- 원장 행은 반드시 대응 로그 행이 있으므로 원장이 있는 챗봇은 이미 `대화로그`로 막힌다 — 사전검사 추가는 방어·표시(차단 사유에 `답변 평가 n건` 병기) 목적이다.
````

### B-6. [ADR-0012] `docs/02-spec/decisions/ADR-0012-widget-stack-and-shared-view-logic.md` — 평가 버튼 · Preact 트리거 미발동 (append)

**찾을 원문**
````text
`/c/*` SPA fallback 필요. `docs/05-ops/자동배포.md`에 기록.
````
**바꿀 내용**
````text
`/c/*` SPA fallback 필요. `docs/05-ops/자동배포.md`에 기록.


---

## 갱신 (2026-09-25 — No.44: 답변 평가 버튼 · vanilla 유지 · 감수 비용 ③ 트리거 미발동)

피드백 기반 개선 루프(No.44, **ADR-0038 §1**). 스택·격리·서브패스 공유 결정은 **불변**이다.

1. 위젯이 요청 `features`에 `'feedback-v1'`을 더 싣고, 서버가 `feedback.rateable`로 표시한 봇 말풍선(보류 턴은 `READY`/`FAILED` 최종 말풍선)에만 버튼 2개를 붙인다. 인사말·대기 문구·로컬 정리 문구·시스템·오류·상담원 말풍선에는 없다.
2. 로직은 `core/feedback.ts`(응답 결과 → 재시도·표시 결정 순수 함수 — 첫 `404`도 1초 뒤 1회 재시도)와 `ui/feedback-bar.ts`(DOM)로 나눈다. 평가 상태는 DOM에만 두며 `sessionStorage`·`localStorage`를 쓰지 않는다.
3. 메시지 목록(`role="log"`, `aria-relevant="additions"`)에 새 노드를 추가하지 않고 속성(`aria-pressed`) 변경과 상태 영역(`#cb-status`) 1회 안내로 알린다.
4. **감수 비용 ③(Preact 재검토) 트리거는 발동하지 않는다** — 런타임 의존성 0 · gzip 100KB 게이트 유지 · 증가분(예상 2KB 이하)은 빌드 로그로 보고한다.
````

### B-7. [ADR-0023] `docs/02-spec/decisions/ADR-0023-async-pending-answer-delivery.md` — 보류 턴 평가 표식 · C-1 (append)

**찾을 원문**
````text
폴링 엔드포인트·`PendingAnswerPollResponse` 스키마는 무변경이다.
````
**바꿀 내용**
````text
폴링 엔드포인트·`PendingAnswerPollResponse` 스키마는 무변경이다.


---

## 갱신 (2026-09-25 — No.44: 보류 턴의 평가 표식 · `READY` 직후 로그 적재 경쟁의 위젯 흡수)

피드백 기반 개선 루프(No.44, **ADR-0038 §1**). §1~§6의 결정(PENDING 즉시 반환·폴링 규격·메모리 TTL 저장소·**로그 1건**)은 **불변**이다.

1. 보류 턴의 평가 가능 표시(`feedback: { rateable: true }`)는 **PENDING 응답**에 실리고 최종 답변 말풍선(`READY`·`FAILED`)에 적용된다. 폴링 응답 스키마에는 싣지 않는다.
2. `RagAnswerRunInput`·`ConversationLogPort.record()`에 선택 필드 `feedbackOffered`를 더해 백그라운드 완료 시 로그 1건에 같은 값을 적재한다(`groupId` 선례 — 추가 조회 0).
3. **`pendingStore.complete(READY)`가 `logPort.record()`보다 먼저 실행된다**(`rag-answer.service.ts`) — 위젯이 `READY`를 받은 직후 극히 짧은 순간은 로그 행이 없어 평가가 `404`일 수 있다. 서버 순서는 바꾸지 않고(이 ADR의 경로 불가침) **위젯이 1초 뒤 1회 재시도**로 흡수한다.
````

---

## C. `docs/01-requirements/기능요구사항.md`

### C-1. [기능요구사항 `docs/01-requirements/기능요구사항.md`] §4-1 No.44 행 — PM 도입 확정 · 설계 완료 반영

**찾을 원문**
````text
| 44 | 분석/피드백 | 피드백 기반 개선 루프 | 응답에 대한 사용자 👍/👎 평가를 수집해 오답 후보를 학습현황(15번) 큐에 자동 편입 | 2 | ○ | ○ | 업계 트렌드. 15번의 입력 소스를 "미응답 질문" 외 "명시적 부정 피드백"으로 확장 |
````
**바꿀 내용**
````text
| 44 | 분석/피드백 | 피드백 기반 개선 루프 | 봇 답변별 사용자 👍/👎 평가(챗봇별 WEB 채널 설정 — 기본 꺼짐) → **평가 원장**(메시지당 1행·텍스트 0) → **👎를 학습현황(15번) 큐에 `부정 평가` 소스로 자동 편입**(당시 답변·매칭 대상 표시 · 예문 반영 또는 직접 수정 완료) + 챗봇 스코프 **답변 만족도** 통계 | 2 | ○ | ○ | **✅ PM 도입 확정(2026-09-25) · 설계 완료(`docs/02-spec/feedback-loop-설계.md` · ADR-0038).** 업계 트렌드. 15번의 입력 소스를 "미응답 질문" 외 "명시적 부정 피드백"으로 확장. 1차 = 위젯 👍/👎 · 공개 평가 API(`@Public()` 8번째 — `messageId`+`sessionId`+슬러그 결합 검증, 토큰 없음) · 원장 · 👎 즉시 편입(폴백·API 고정 문구·NODE 버튼·빈 입력·장문 제외) · No.14 만족도 섹션. 사유 코드·그룹/전역 통계는 2차 · 자유 텍스트 사유는 No.45와 함께 · 엔진·ml-worker 변경 0 |
````

### C-2. [기능요구사항 `docs/01-requirements/기능요구사항.md`] §4-1 주의 — No.44 사용자 확인 결과 각주

**찾을 원문**
````text
사용자 확인 후 §4 옵션 목록에 정식 편입할지 결정한다.
````
**바꿀 내용**
````text
사용자 확인 후 §4 옵션 목록에 정식 편입할지 결정한다.

> **사용자(PM) 확인 결과**: **No.44 피드백 기반 개선 루프 — 도입 확정(2026-09-25)**, 1차 범위 = 위젯 👍/👎 · 공개 평가 API · 평가 원장 · 👎 학습현황 큐 자동 편입 · 챗봇 스코프 만족도(요구사항 `docs/requirements/feedback-loop.md` §11 P-1~P-16 전부 권고안). 나머지 7개(No.40~43·45~47)는 여전히 확인 대기다.
````

### C-3. [기능요구사항 `docs/01-requirements/기능요구사항.md`] §3 No.15 행 — 검토 큐 입력 소스 확장 각주

**찾을 원문**
````text
과는 별개 기능**이므로 혼동 주의 |
````
**바꿀 내용**
````text
과는 별개 기능**이므로 혼동 주의. **[2026-09-25 No.44] 검토 큐 입력 소스에 `부정 평가`(사용자 👎 — 답은 했지만 틀린 답변 후보)가 더해지고, 내용 오류 항목은 "직접 수정 완료"로 처리한다** |
````

---

## D. `docs/requirements/feedback-loop.md` — PM 결정 기록 · 설계 반영

### D-1. [피드백 루프 요구사항 `docs/requirements/feedback-loop.md`] §1.9 핵심 판단 표 머리 — PM 결정 표기

**찾을 원문**
````text
### 1.9 이 문서의 핵심 판단 19건 (⚠ = PM 확인 필요)
````
**바꿀 내용**
````text
### 1.9 이 문서의 핵심 판단 19건 (⚠ = PM 확인 필요)

> **PM 결정(2026-09-25)** — **No.44 도입 확정**, ⚠ 표시 항목을 포함해 아래 "결정(제안)" 열이 **전부 권고안대로 확정**되었다(§11 P-1~P-16). J-13·J-19 등 architect 확정 사항과 요구사항 대비 조정은 설계서 §25에 있다: 스위치 = WEB config **선택 키**(D-1) · 큐 기여 1회 = 원장 **선점 상태 기계**(D-4) · `queuedQuestionId` → `queueItemId`(D-5) · 큐 쓰기 파일 **3개 불변**(D-6 — 정정) · `@Public` 단언 = 숫자 5 + 제목 1(D-7) · No.14 딥링크 `source` 조건(D-8) · 통계 쿼리 ≤7(D-12). 세부 설계: `docs/02-spec/feedback-loop-설계.md` · ADR-0038.
````

### D-2. [피드백 루프 요구사항 `docs/requirements/feedback-loop.md`] §11 PM 확인 항목 — 결정 기록

**찾을 원문**
````text
## 11. PM 확인이 필요한 항목
````
**바꿀 내용**
````text
## 11. PM 확인이 필요한 항목

> **PM 결정(2026-09-25)** — **No.44 도입 확정 · 전부 권고안을 채택했다.**
>
> | # | PM 결정(2026-09-25) |
> |---|---|
> | P-1 | **(c) 단계 도입.** 1차 = 위젯 👍/👎 + 공개 평가 API + 평가 원장 + 👎 큐 자동 편입 + 챗봇 단위 만족도 통계. 사유 코드·그룹/전역 통계는 2차, 자유 텍스트는 후속 |
> | P-2 | `PUT /public/chatbots/:slug/messages/:messageId/feedback` 1개(`@Public()` 7 → 8) · 개수 단언 파일 의도적 갱신 |
> | P-3 | 토큰 없음 · messageId·sessionId·slug가 로그 행과 모두 일치할 때만 저장 · 불일치는 모두 같은 404 · 메시지당 1행 · 변경 24시간 5회 · 취소 없음 · 큐 반영 메시지당 1회 |
> | P-4 | 평가 전용 버킷(IP 120/분 + 메시지 10/분) · 대화 session 버킷 비소비(`PublicRateBucket` 재사용) |
> | P-5 | 👎 1회 즉시 편입 · 제외 = 폴백·API 고정 문구·NODE 버튼 턴·빈 입력·장문 · 부정 평가 대기 상한 2,000 |
> | P-6 | 큐 유일 키 `(chatbotId, source, questionNormalized)` · 기존 행 `UNANSWERED` · 큐 쓰기 주체 유지 |
> | P-7 | 당시 봇 답변(마스킹본)·매칭 대상(의도·FAQ·노드·RAG·폴백) 표시 · 추천 "현재 매칭" 배지 · 신규 전이 "직접 수정 완료"(의도 없이 `RESOLVED`) |
> | P-8 | 👍는 큐 비반영 — 통계에만 |
> | P-9 | 1차 자유 텍스트 사유 없음 |
> | P-10 | No.14 통계 "답변 만족도" 섹션(평가 수·긍정률·참여율(분모 `feedbackOffered`)·추이·👎 집중 답변) · 대시보드 불변 · No.29는 2차 |
> | P-11 | WEB 채널 설정 `feedbackEnabled`(기본 끔) · `access.resolve()`가 읽는 행 · 최종 위치 architect |
> | P-12 | 위젯 변경 수용 · `feedback-v1` · 서버 표시 말풍선에만 · vanilla · 100KB |
> | P-13 | 상담 턴·상담원 메시지 평가 제외 · 설문과 별개 |
> | P-14 | 시뮬레이터·TC 평가 적재 0(로그 행 필수로 구조 보장) |
> | P-15 | 신규 권한·역할·감사 없음 |
> | P-16 | GPU 2 |
>
> **architect 확정·조정**(설계서 §25): 스위치 = WEB config 선택 키 `feedbackEnabled`(설정 테이블·`.default` 기각 — D-1) · 응답 필드 `feedback: { rateable: true }`(D-19) · 전용 버킷 `fb-ip`/`fb-key`(`poll-ip` 비공유 — D-3) · 원장 `queueOutcome` 선점 상태 기계(D-4) · `inputKind`/`feedbackOffered` 로그 컬럼(§3.1) · 큐 유일 키 = 인덱스 교체(재정의 0 · 부분 유니크 4개 보존 확인 — §3.2) · 편입 판정 = `collect-decision.ts` 내부 함수 공유(D-16) · 직접 수정 완료 1차 단건 · 신규 오류 2종 + 기존 코드 재사용(D-13) · 쓰기 파일 3개 정정(D-6) · 기대값 변경 8건 닫힌 목록(D-7).
````

### D-3. [피드백 루프 요구사항 `docs/requirements/feedback-loop.md`] FR-0-145 — 오류 코드 확정

**찾을 원문**
````text
| FR-0-145 | 신규 `ApiErrorCode`(제안):
````
**바꿀 내용**
````text
| FR-0-145 | **[확정 2026-09-25 — 제안 2종 그대로. 직접 수정 완료의 미응답 항목은 기존 `INVALID_STATUS_TRANSITION`(400)·이미 처리됨은 `ALREADY_RESOLVED`(409) 재사용 — 설계서 §16.3]** 신규 `ApiErrorCode`(제안):
````

### D-4. [피드백 루프 요구사항 `docs/requirements/feedback-loop.md`] FR-0-146 — 의도된 기대값 변경 목록 확정

**찾을 원문**
````text
| FR-0-146 | **의도된 기대값 변경(목록 — architect가 전수 확인해 닫힌 목록으로 확정)**:
````
**바꿀 내용**
````text
| FR-0-146 | **[확정 2026-09-25 — 설계서 §21.2 닫힌 목록 X-1~X-8: `@Public` 숫자 단언 5파일(`public-decorator-count`·`version-sealing`·`validation-sealing`·`deploy-schedule-sealing`·`handoff-sealing` 7 → 8) · `topic-sealing.spec.ts`는 **제목 문자열만**(총수 단언 없음) · `chatbots.service.spec.ts` Prisma 목에 `messageFeedback.count`(단언 변경 0) · 위젯 `public-client.spec.ts` `features` 기대값. 컨트롤러 수 34 불변 · `UnansweredSource`·`CHILD_COUNT_LABELS`·수집기 키를 단언하는 기존 시험 없음 · R-2/R-6 대상 확장 없음(원장은 F-1~F-5로 별도 봉인)] 초안:** **의도된 기대값 변경(목록 — architect가 전수 확인해 닫힌 목록으로 확정)**:
````

### D-5. [피드백 루프 요구사항 `docs/requirements/feedback-loop.md`] FR-FB10-1 ⑨ — 큐 쓰기 파일 수 정정

**찾을 원문**
````text
⑨ `unansweredQuestion` 쓰기 파일 2개 유지
````
**바꿀 내용**
````text
⑨ `unansweredQuestion` 쓰기 파일 ~~2개~~ **3개**(수집기·상태 전이·No.23 `decomposed-resolve.service.ts` — architect 정정 2026-09-25) 유지
````

### D-6. [피드백 루프 요구사항 `docs/requirements/feedback-loop.md`] FR-FB1-1 — 저장 위치 확정

**찾을 원문**
````text
**저장 위치는 architect 확정**(권고 근거:
````
**바꿀 내용**
````text
**저장 위치는 architect 확정 — [확정 2026-09-25] WEB 채널 config의 선택 키 `feedbackEnabled?`(없음 = 꺼짐. `.default(false)`는 기존 채널 응답·파싱 결과 바이트를 바꿔 기각 · 1:1 설정 테이블은 대화 턴 추가 조회를 만들어 기각 — 설계서 §5.1 · ADR-0038 §5)**(권고 근거:
````

### D-7. [피드백 루프 요구사항 `docs/requirements/feedback-loop.md`] FR-FB2-2 — 응답 필드 형태 확정

**찾을 원문**
````text
(형태는 architect — 없으면 바이트 동일)
````
**바꿀 내용**
````text
(형태는 architect — 없으면 바이트 동일 — **[확정] `feedback: { rateable: true }`를 응답 객체의 마지막 키로 조건부 전개 · 판정은 `features`를 먼저 봐 미선언 위젯은 설정 파싱조차 없음 — 설계서 §6.2**)
````

### D-8. [피드백 루프 요구사항 `docs/requirements/feedback-loop.md`] FR-FB3-1 — 메서드·경로 확정

**찾을 원문**
````text
(권고 — 멱등 설정 의미. 메서드·경로는 architect 확정)
````
**바꿀 내용**
````text
(권고 — 멱등 설정 의미. 메서드·경로는 architect 확정 — **[확정] 권고 그대로 `PUT` · 핸들러 `PublicConversationController#submitFeedback`(파일 끝 — `pollHandoff` 뒤) · 판정 순서는 설계서 §7.2**)
````

### D-9. [피드백 루프 요구사항 `docs/requirements/feedback-loop.md`] FR-FB4-4 — 버킷 구현 확정

**찾을 원문**
````text
구현은 `@PublicRateBucket()` 확장 또는 동등 — architect.
````
**바꿀 내용**
````text
구현은 `@PublicRateBucket()` 확장 또는 동등 — architect. **[확정] `kind: 'POLL' | 'FEEDBACK'` 확장 · `FEEDBACK` = `fb-ip:{ip}` + `fb-key:msg:{messageId}`(폴링 `poll-ip`와도 공유하지 않음) · `POLL` 동작 바이트 불변 — 설계서 §8**
````

### D-10. [피드백 루프 요구사항 `docs/requirements/feedback-loop.md`] FR-FB4-5 — 큐 기여 표식 확정

**찾을 원문**
````text
원장 `queuedAt` 표식 — 조건부 갱신으로 동시 요청에도 1회)
````
**바꿀 내용**
````text
원장 `queuedAt` 표식 — 조건부 갱신으로 동시 요청에도 1회 — **[architect 조정] `queuedAt` 1개로는 "선점 후 실패"를 표현할 수 없어 원장에 선점 상태 `queueOutcome`(`CLAIMED`→`QUEUED`｜`SKIPPED`｜`FAILED`)·`queueSkipCode`를 두고 `updateMany where queueOutcome IS NULL` 선점에 성공한 요청만 편입한다. `queuedAt`은 `QUEUED`일 때만 기록(AC-FB4-6 그대로) — 설계서 §9.4**)
````

### D-11. [피드백 루프 요구사항 `docs/requirements/feedback-loop.md`] FR-FB6-1 — 마이그레이션 절차 확정

**찾을 원문**
````text
마이그레이션 전 중복 0 확인 절차는 architect)
````
**바꿀 내용**
````text
마이그레이션 전 중복 0 확인 절차는 architect — **[확정] 새 키는 옛 키의 상위 집합이라 중복이 원리상 불가능 — 사전 확인은 `source`별 건수(UNANSWERED 1행뿐) 기록. 마이그레이션 = `DROP INDEX` + `CREATE UNIQUE INDEX`(SQLite 테이블 재정의 0 · 원시 부분 유니크 4개 무영향 — 적용 후 `sqlite_master` 확인) · 통합 시험 `prisma migrate deploy` — 설계서 §3.2**)
````

### D-12. [피드백 루프 요구사항 `docs/requirements/feedback-loop.md`] FR-FB6-3 — 판정 공유 방식 확정

**찾을 원문**
````text
편입 판정은 **순수 함수**이며 `collect-decision.ts`의 정규화·빈 입력·장문 규칙을 **공유**한다(복제 금지).
````
**바꿀 내용**
````text
편입 판정은 **순수 함수**이며 `collect-decision.ts`의 정규화·빈 입력·장문 규칙을 **공유**한다(복제 금지). **[확정] 같은 파일에 `shouldQueueNegativeFeedback()`을 두고 정규화·빈 입력·장문은 내부 함수 `normalizeQueueCandidate()` 1벌을 `shouldCollect()`와 공유(`shouldCollect()` 동작·사유 순서 불변) — 설계서 §10.2**
````

### D-13. [피드백 루프 요구사항 `docs/requirements/feedback-loop.md`] FR-FB7-6 — 일괄 처리 확정

**찾을 원문**
````text
일괄 처리 지원 여부는 architect(권고: 1차 단건만).
````
**바꿀 내용**
````text
일괄 처리 지원 여부는 architect(권고: 1차 단건만). **[확정] 1차 단건만 · 경로 `POST …/unanswered-questions/:id/mark-addressed` · 미응답 항목 `400 INVALID_STATUS_TRANSITION` — 설계서 §11.3**
````

### D-14. [피드백 루프 요구사항 `docs/requirements/feedback-loop.md`] NFR-FBP4 — 통계 쿼리 수 조정

**찾을 원문**
````text
쿼리 수 고정(기간·대상 수와 무관 ≤4)
````
**바꿀 내용**
````text
쿼리 수 고정(기간·대상 수와 무관 ~~≤4~~ **≤7** — architect 조정: 집계 3 + 👎 상위 대상 이름 해석 3 + 챗봇 존재 확인 1. 반환 행 수가 원장 행 수와 무관하다는 성질은 유지 — 설계서 §12.2)
````

### D-15. [피드백 루프 요구사항 `docs/requirements/feedback-loop.md`] §1.3.2 — `@Public` 단언 파일 수 정정

**찾을 원문**
````text
7을 재단언하는 봉인 정적 검사 **6파일**
````
**바꿀 내용**
````text
7을 재단언하는 봉인 정적 검사 **6파일**(**[architect 전수 확인 2026-09-25] 숫자 단언은 5파일이고 `topic-sealing.spec.ts`는 `describe` 제목 문자열에만 7이 있다 — 설계서 §21.2**)
````

### D-16. [피드백 루프 요구사항 `docs/requirements/feedback-loop.md`] §1.3.3 — 큐 쓰기 주체 수 정정

**찾을 원문**
````text
**큐 쓰기 주체 2곳**(수집기 · 상태 전이 서비스 — `unanswered-collector.service.ts` 24~30행 · ADR-0019 45행)
````
**바꿀 내용**
````text
**큐 쓰기 주체 2곳**(수집기 · 상태 전이 서비스 — `unanswered-collector.service.ts` 24~30행 · ADR-0019 45행 — **[architect 정정 2026-09-25] 실제로는 No.23 `learning/decomposed-resolve.service.ts`(요소분해 반영 CAS 전이)까지 3파일이며, 이 그룹은 3파일 집합을 바꾸지 않는다**)
````

### D-17. [피드백 루프 요구사항 `docs/requirements/feedback-loop.md`] §12 인계 — system-architect 행 완료 표식

**찾을 원문**
````text
| **`system-architect`** | ① **ADR-0038** 작성
````
**바꿀 내용**
````text
| **`system-architect`** | **[완료 2026-09-25 — `docs/02-spec/feedback-loop-설계.md` · ADR-0038 · `feedback-loop-patches.md`. 다음 인계: ui-designer(위젯 막대 낭독 실측 포함) → backend-implementer는 ① 큐 소스 분리 준비 커밋(동작 불변 — 기존 시험 무수정 통과가 게이트) → ② 본체 순서]** ① **ADR-0038** 작성
````

---

## E. 선행 요구사항 문서 — No.44 인계 정정

### E-1. [품질/채널 요구사항 `docs/requirements/quality-channel.md`] 범위 밖 — 위젯 평가 버튼

**찾을 원문**
````text
- **No.44 피드백 기반 개선 루프**(👍/👎 수집): 위젯에 평가 버튼을 넣지 않는다.
````
**바꿀 내용**
````text
- **No.44 피드백 기반 개선 루프**(👍/👎 수집): 위젯에 평가 버튼을 넣지 않는다. **[2026-09-25 — No.44에서 도입: `feedback-v1` 선언 위젯 + 서버가 평가 가능으로 표시한 봇 말풍선에만 버튼 2개(vanilla 유지). `messageId` = `ConversationLog.id` 앵커를 그대로 쓴다 — `feedback-loop-설계.md` §13]**
````

### E-2. [통계/학습 요구사항 `docs/requirements/stats-learning.md`] 세 기능의 관계 — 소스 구분 이행

**찾을 원문**
````text
큐 스키마는 **소스 구분이 가능한 형태**로 설계한다(DD-49 `source` 필드).
````
**바꿀 내용**
````text
큐 스키마는 **소스 구분이 가능한 형태**로 설계한다(DD-49 `source` 필드). **[2026-09-25 이행 — No.44가 `NEGATIVE_FEEDBACK` 소스를 도입했고 병합 키를 `(chatbotId, source, questionNormalized)`로 바꿨다(ADR-0038 §4)]**
````

### E-3. [통계/학습 요구사항 `docs/requirements/stats-learning.md`] 범위 밖 — 만족도 지표

**찾을 원문**
````text
수집 수단 자체가 없다. **No.44**가 그 소스를 만든다 | **No.44** |
````
**바꿀 내용**
````text
수집 수단 자체가 없다. **No.44**가 그 소스를 만든다 **[2026-09-25 — No.44 설계 완료: No.14 통계 화면 "답변 만족도" 섹션(`GET /stats/feedback`) · 대시보드 무변경]** | **No.44** |
````

### E-4. [NLU/RAG 요구사항 `docs/requirements/nlu-rag-answering.md`] 범위 밖 — RAG 답변 피드백

**찾을 원문**
````text
| **RAG 답변에 대한 사용자 피드백(👍/👎)** | 수집 수단 자체가 없다 | **No.44** |
````
**바꿀 내용**
````text
| **RAG 답변에 대한 사용자 피드백(👍/👎)** | 수집 수단 자체가 없다 **[2026-09-25 — No.44에서 도입: 보류 턴의 `READY`·`FAILED` 최종 말풍선도 평가 가능 · 대상 "문서 답변" · 외부 RAG로의 피드백 송신은 범위 밖(allowlist 불변)]** | **No.44** |
````

### E-5. [통합 통계 요구사항 `docs/requirements/integrated-stats.md`] 경계 표 — No.44 만족도 자리

**찾을 원문**
````text
| **No.27 설문 / No.44 피드백**(미구현) |
````
**바꿀 내용**
````text
| **No.27 설문 / No.44 피드백**(미구현 → **No.44 설계 완료 2026-09-25: 만족도는 No.14 챗봇 스코프 섹션 1차, 통합 스코프는 2차 — 원장에 대화 당시 `groupId` 스냅샷을 지금 적재**) |
````

### E-6. [설문관리 요구사항 `docs/requirements/survey-management.md`] 경계 표 — No.44

**찾을 원문**
````text
응답별 👍/👎는 No.44. 설문 척도 결과를 학습 큐에 넣지 않는다 |
````
**바꿀 내용**
````text
응답별 👍/👎는 No.44. 설문 척도 결과를 학습 큐에 넣지 않는다 **[2026-09-25 경계 확정 — 설문이 입력을 소비한 턴(`surveyTurn`)은 평가 불가 · 설문 노출 턴은 평가 가능 · 설문 결과는 큐 비반영 유지(`feedback-loop-설계.md` §19)]** |
````

### E-7. [하이브리드 CS 요구사항 `docs/requirements/hybrid-cs.md`] 범위 밖 — No.44

**찾을 원문**
````text
| **No.44 피드백 루프** | 범위 밖 — 👍/👎는 No.44 |
````
**바꿀 내용**
````text
| **No.44 피드백 루프** | 범위 밖 — 👍/👎는 No.44 **[2026-09-25 경계 확정 — 상담 구간 턴·상담원 메시지는 평가 불가 · 상담 전후 봇 답변은 평가 가능 · 👎의 상담 경고 산입은 후속(`evaluateSessionAlert` 수정 0)]** |
````

### E-8. [학습 고도화 요구사항 `docs/requirements/learning-augmentation.md`] 경계 표 — No.44

**찾을 원문**
````text
큐 입력원 확장이며 이 그룹의 층과 무관 | **No.44** |
````
**바꿀 내용**
````text
큐 입력원 확장이며 이 그룹의 층과 무관 **[2026-09-25 — 증강·분류기 수정 0 확인. 부정 평가 항목에도 기존 추천 우선순위(분류기 → 문자 유사도)가 그대로 적용되고, 요소분해 반영도 동작한다]** | **No.44** |
````

---

## Z. 적용 후 확인 체크리스트

- [ ] A-1~A-46 · B-1~B-7 · C-1~C-3 · D-1~D-17 · E-1~E-8 각 "찾을 원문"이 적용 전 대상 파일에서 정확히 1회 검색되는지(0회 = 파일이 그 사이 바뀜 → 이 문서를 갱신 후 적용).
- [ ] 같은 줄에 앵커가 여럿인 항목(개발명세서 §3 미도입 ③ 줄의 A-10·A-11, §3.1 인덱스 줄의 A-16·A-17, §4.1 권한 줄의 A-26·A-27, §5 보안 줄의 A-29·A-30)을 모두 적용한 뒤 각 줄의 구조(`> ③ …`, `- **…**:`, 표 셀 `|`)가 유지되는지. 개발명세서 §2 표(A-1)·§2.2 표(A-2)·§3 표(A-4~A-7)·§4 표(A-18~A-21)·§4.1 표(A-23~A-27)·§5.1 표(A-36 — 5열)·§7 표(A-44~A-46)의 행이 열 개수를 유지하는지.
- [ ] 개발명세서 §7 인덱스에 설계서·ADR-0038 행이 각 1개인지. §6에 결정 39가 38 바로 뒤에 있는지. §3 "미도입 결정 15건" 머리와 ⑮ 항목이 함께 있는지. §3 엔터티 표에 `MessageFeedback` 행이 `Topic` 행 바로 뒤에 있는지. §6 결정 16·17·20·24·28 아래 "갱신(2026-09-25 — No.44)" 각주가 각 1개인지.
- [ ] `docs/01-requirements/기능요구사항.md` No.44 행(8열)·No.15 행의 열 개수가 표 머리와 같은지 · §4-1 주의 문단 뒤에 PM 확인 결과 인용 블록이 1개인지.
- [ ] `docs/requirements/feedback-loop.md` §1.9 머리·§11 머리에 PM 결정이 있는지 · FR 표(FR-0-145·146, FR-FB1-1·FB2-2·FB3-1·FB4-4·FB4-5·FB6-1·FB6-3·FB7-6) 셀 구조가 깨지지 않는지 · NFR-FBP4 행의 취소선이 셀 구조를 깨지 않는지.
- [ ] ADR-0019·0011·0015·0033·0002·0012·0023 끝에 "갱신 (2026-09-25 — No.44 …)" 절이 각 1개인지.
- [ ] `CLAUDE.md`의 "보완 8종(No.40~47)은 … §4-1에서 사용자 확인 대기 중" 문구는 **이 패치의 범위가 아니다** — No.44 확정 반영 여부는 사용자가 직접 결정한다(에이전트는 `CLAUDE.md`를 수정하지 않는다).
- [ ] `docs/03-design/UIUX_준수기준.md`의 "로그 영역 안 보조 버튼의 상태 변화는 속성 변경 + 상태 영역 1회 안내(새 노드 추가 금지)" · "토글 버튼 = `aria-pressed` + 텍스트 이름" 보강과 위젯 평가 막대의 스크린리더 낭독 실측(NVDA·VoiceOver)은 **ui-designer 단계**에서 한다(개발명세서 §5 접근성 문단에 원칙을 먼저 기록했다 — A-32).
- [ ] `docs/04-test/시험항목.md`에 TC-44(AC-FB1~FB8)를 추가하고, 턴 유형 × 평가 가능 × 편입 여부 표 · 위조 케이스 표 · 제외 사유 표 · 평가 연타 후 전송 시험(별도 파일 — 레이트리밋 한도 재정의) · 원장 텍스트 컬럼 부재 정적 검사를 `시험데이터.md`·`자동시험_전략.md`에 추가하는 일은 **test-automation 단계**에서 한다.
- [ ] `docs/05-ops/자동배포.md`에 ① 커밋 ①(큐 소스 분리 준비) 선행 배포와 기존 시험 무수정 통과 게이트 ② 마이그레이션 사전 확인(`source`별 건수)·적용 후 확인(부분 유니크 4개·새 유일 키·`PRAGMA foreign_key_check`) · 100만 로그 행 DB 소요 실측 ③ **`NEGATIVE_FEEDBACK` 행 생성 후 스키마 롤백 불가 → 롤백은 API까지만** ④ 위젯 `widget.js` 배포 순서 무관 확인을 추가하는 일은 **deployment-engineer 단계**에서 한다.
- [ ] 코드 쪽 기대값 변경(설계서 §21.2 X-1~X-8)은 **구현 단계에서** 반영한다. 그 밖의 기존 시험이 깨지면 회귀로 취급한다(커밋 ①에서 깨지면 멈추고 보고).
- [ ] 코드 쪽 주석(`schema.prisma` `UnansweredQuestion.source` 주석 "이번 Phase는 'UNANSWERED' 1종", `packages/shared-types/src/learning.ts` 22행 `UnansweredSource` 주석, `conversation-log.service.ts` 11·28행 주석("향후 No.44" · "`ConversationLog` 컬럼을 늘리지 않고"), `public-conversation.service.ts` 423~427행 `resolveInputKind` 주석, `unanswered-collector.service.ts` 24~29행 "쓰기는 이 파일과 … 2곳뿐", `chatbots.service.ts` `CHILD_COUNT_LABELS` 머리, `public-conversation.controller.ts` 머리 "`@Public()`은 … 4곳", `public-rate-bucket.decorator.ts` 머리 "폴링 전용")은 **구현 단계에서** No.44 내용으로 갱신한다.
