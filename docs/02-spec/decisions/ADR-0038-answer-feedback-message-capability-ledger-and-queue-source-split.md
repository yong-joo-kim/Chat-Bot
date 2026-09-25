# ADR-0038 — 답변 평가(피드백 루프) = 메시지 능력 결합 검증 · 텍스트 없는 평가 원장 · 큐 소스 분리 · 적재 시점 로그 표식

- **상태**: 채택 (Accepted)
- **일자**: 2026-09-25
- **결정자**: system-architect (도입·1차 범위·정책 16건은 PM 확정 — 요구사항 §11 P-1~P-16)
- **관련**: `docs/requirements/feedback-loop.md` J-1~J-19, FR-0-138~148, FR-FB1-\*~FR-FB10-\*, NFR-FBP/FBS/FBA/FBM, AC-FB1~FB8, EX-FB-1~26 / ADR-0011(공개 표면) · ADR-0013(마스킹 1벌) · ADR-0015(`@Public()`·권한) · ADR-0019(미응답 큐 수집 모델) · ADR-0023(보류 답변) · ADR-0027(추천 우선순위) · ADR-0031(스냅샷 범위) · ADR-0033(원천 봉인·`groupId` 스냅샷) · ADR-0035(사용자 응답 비감사) · ADR-0036(폴링 전용 버킷 K-1) · ADR-0037(`topicId` 로그 선례)
- **영향 범위**: `apps/api/prisma/schema.prisma`(+ 마이그레이션 1) · `apps/api/src/{feedback(신규), conversation, learning, stats, channels, chatbots, common/rate-limit}` · `packages/shared-types/src/{feedback(신규), conversation, channel, learning, common, index}.ts` · `apps/widget`(평가 버튼) · `apps/web`(채널 스위치·학습현황·통계 섹션). **`packages/dialogue-engine`·`packages/pii-mask`·`apps/ml-worker` 변경 0**
- **세부 설계**: `docs/02-spec/feedback-loop-설계.md`

## 맥락

카탈로그 No.44 원문은 "응답에 대한 사용자 👍/👎 평가를 수집해 오답 후보를 학습현황(15번) 큐에 자동 편입"이다(PM 도입 확정 2026-09-25, 1차 = 위젯 👍/👎 · 공개 평가 API · 평가 원장 · 👎 큐 자동 편입 · 챗봇 스코프 만족도). 코드에는 이미 자리가 예고돼 있다 — `UnansweredQuestion.source`(ADR-0019 91행), 로그 `id` = 응답 `messageId`(`conversation-log.service.ts` 11행). 그러나 결정해야 할 것이 다섯 가지다.

1. **인증 없는 쓰기 경로**를 여는데, 남의 답변을 평가하거나 통계·큐를 오염시키는 것을 무엇으로 막는가.
2. 평가는 **턴이 끝난 뒤** 도착한다. 로그 행은 `update` 0건으로 봉인돼 있고(ADR-0033 R-10) 버튼 턴(`NODE`)을 사후에 구분할 수 없다(ADR-0019 57행).
3. 큐 병합 키 `(chatbotId, questionNormalized)`는 소스를 모른다 — "못 답함"과 "답했는데 틀림"은 처방이 다르다.
4. 기능 스위치를 어디에 두어야 대화 턴의 **추가 DB 조회 0**과 **바이트 동일**을 동시에 지킬 수 있는가.
5. 평가·편입을 **메시지당 1회**로 묶는 동시성 모델은 무엇인가.

## 결정

### 1. 평가 대상 = 봇 응답 턴 1개(`messageId` = `ConversationLog.id`) — 서버가 적재 시점에 "평가 가능"을 표식한다

- 공개 파이프라인이 응답 조립 시 순수 함수 `isFeedbackOffered({ features, webChannelConfigJson, blockedByFilter, surveyTurn, handoffTurn })`로 판정한다. 참 = 위젯이 `'feedback-v1'`을 선언 ∧ WEB 채널 설정 `feedbackEnabled === true` ∧ BLOCK·설문 소비·상담 구간 턴이 아님. **`features`를 먼저 보고 거짓이면 설정을 파싱하지 않는다**(구버전 위젯의 CPU 경로도 불변).
- 참이면 응답에 선택 필드 **`feedback: { rateable: true }`** 를 싣고, 로그에 **`feedbackOffered = true`** 를 적재한다(`record()` 1곳). 거짓이면 키를 **생략**한다 — 기능이 꺼진 챗봇·미선언 위젯의 응답은 **바이트 단위로 동일**하다(`pendingAnswer`·`handoff` 선례).
- 평가 API는 `feedbackOffered = true`인 로그 행만 받는다. 버튼을 주지 않은 턴(BLOCK·설문·상담·기능 켜기 전·구버전 위젯)은 구조적으로 평가할 수 없다.
- 보류 RAG 턴은 POST 응답(대기 문구)에 표식을 싣고, 로그는 백그라운드 완료 시 같은 값으로 적재한다(`RagAnswerRunInput.feedbackOffered?` → 두 `record()` 호출). 보류 폴링 스키마·서버 코드는 무변경(ADR-0023 불가침).
- **`ConversationLog.inputKind`를 컬럼화한다** — ADR-0019 §3의 재검토 트리거("입력 유형별 지표 요구")가 발동했다. 평가는 턴 이후에 도착하므로 큐 편입 판정이 로그 행만 보고 `BUTTON_NODE` 턴을 걸러야 한다. 값은 기존 `record()` 파라미터를 그대로 적재한다(쓰기 주체 1곳 · 적재 후 불변 · 인덱스 없음 · 백필 없음 — 기존 행 null = "기록 없음").

### 2. 공개 표면 — `PUT /public/chatbots/:slug/messages/:messageId/feedback` 1개(`@Public()` 7 → 8), **토큰 없이 3요소 결합 검증 + 단일 404**

- 본문 `{ sessionId: uuid, rating: 'UP' | 'DOWN' }`, 응답 `200 { rating }`(평가값 에코뿐), `Cache-Control: no-store`. 기존 공개 컨트롤러에 두어 레이트리밋 → Origin 가드 순서를 상속한다. `PUT`인 이유: "이 메시지의 내 평가를 이 값으로 둔다"는 **멱등 설정**이다.
- **판정 순서**(설계서 §7.2): 가드 → 본문 zod(400) → `access.resolve(slug)`(기존 404/403 규약) → 기능 꺼짐 → `messageId` UUID 아님 → 로그 PK 조회 1회 → 행 없음·`chatbotId` 불일치·`sessionId` 불일치·`feedbackOffered = false`. ②~⑤는 **전부 같은 `404 FEEDBACK_TARGET_NOT_FOUND` · 같은 문구**다(존재 오라클 방지). 로그 PK 조회는 어느 분기든 1회라 시간차도 없다.
- **서버 발급 평가 토큰을 두지 않는다.** `messageId`는 서버가 `randomUUID()`로 만들어 **그 요청의 응답으로만** 돌려주는 122비트 난수이며, 여기에 `sessionId`(URL에 나타나지 않음)와 슬러그를 결합하면 "자기가 받은 답변만 평가한다"가 성립한다. 평가 응답은 대화 데이터를 돌려주지 않으므로 No.24 상담 토큰이 막으려던 엿보기 위협이 없다. 토큰을 더해도 저장 키·해시 컬럼·발급 규칙만 늘고 막는 위협은 늘지 않는다. **재검토 트리거**: 평가 응답이 대화 데이터를 돌려주게 될 때(예: 👎 뒤 "다른 답변 보기").
- **남는 위험(수용)**: 봇과 대화해 만든 자기 메시지를 전부 👎하는 스크립트. 평가 1건 = 자기 대화 1턴이라 속도가 대화 레이트리밋에 묶이고, 새로 여는 공격면은 "답은 됐던 문장을 큐에 넣는 것"뿐이다 — ADR-0019가 이미 수용한 "미응답 문장 대량 전송"과 같은 등급이며 소스별 상한(§5)이 저장량을 묶는다.

### 3. 평가 원장 `MessageFeedback` — 메시지당 1행 · **텍스트 0 · `sessionId` 0** · 쓰기 1파일 · 삭제 0 · 스냅샷 밖

- `conversationLogId` 유일(FK 없음 — 로그 규약), `chatbotId` FK `Restrict`. 최초 저장 시 로그의 **턴 사실을 복사**한다(`groupId`(대화 당시)·`turnDayBucket`·`turnCreatedAt`·`channelType`·`isAnswered`·`answeredByRag`·`apiNotice`·`inputKind`·매칭 id 3종·`topicId`) + 순수 함수 `classifyFeedbackTarget()`의 결과 **`targetKind`·`targetId`**. 이후 값 변경은 `rating`·`changeCount`·`updatedAt`만 바꾼다. Prisma `groupBy`는 조인을 못 하므로 통계가 원장만으로 끝나도록 비정규화한다.
- **최소 수집**: 질문·답변 텍스트·`sessionId`·IP·User-Agent 컬럼이 **존재하지 않는다**(컬럼 이름 허용 목록을 정적 검사가 단언). 세션 결합 검증은 요청 시점에 로그 행으로 끝나므로 원장에 세션을 남길 이유가 없다. 자유 텍스트 사유는 1차에 받지 않는다(PM P-9 — 새 PII 저장소·보존기간 부재).
- **변경 규칙**: 같은 값 재요청 = 멱등 `200`(쓰기 0) · 다른 값 = 변경(로그 `createdAt` + 24시간 이내 · 누적 5회 이내 — 초과 `409 FEEDBACK_CLOSED`) · 최초 저장은 24시간 제한만 · **취소(평가 해제) 없음**. 변경은 `changeCount` CAS(`updateMany where changeCount = 읽은 값`)로 **정확히** 센다.
- **ADR-0033 봉인 확장**: 원장은 대화 기록 성격의 원천이다 — `delete`/`deleteMany`/원시 `DELETE` 0건 · 영구삭제 사전검사 대상(`답변 평가` — 14 → 15종, 동반 삭제 아님) · 무기한 보존(No.45 알려진 리스크). 버전 스냅샷·챗봇 복사·토픽 분리의 대상이 아니다.

### 4. 큐 = **소스 분리** — 유일 키 `(chatbotId, source, questionNormalized)` · 쓰기 파일 불변 · 👎 1회 즉시 편입(메시지당 1회 기여)

- `UnansweredSource`에 `NEGATIVE_FEEDBACK`을 더하고 유일 키에 `source`를 넣는다. 같은 질문이 "못 답함"과 "답했는데 틀림"으로 **각각 1행**이 되며, 두 행이 나란히 보이는 것 자체가 "반영했지만 오답"이라는 정보다. 기존 행은 전부 `UNANSWERED`라 **키 변경에 데이터 충돌이 0**이고, SQLite에서는 **테이블 재정의 없이 유니크 인덱스 교체**(DROP + CREATE)로 끝난다 — 원시 부분 유니크 인덱스 4개(`test_runs` 1 · `deploy_schedules` 2 · `handoff_sessions` 1)가 있는 테이블을 건드리지 않는다.
- **편입 진입점**: `UnansweredCollectorService.collectNegativeFeedback()`(두 번째 진입 메서드). 입력은 **로그 행의 마스킹본 `userMessage`** 이므로 ADR-0019 §2의 "마스킹 지점 = 적재 지점" 근거가 깨지지 않는다(원문 재접촉 0). `unansweredQuestion` 쓰기 파일 집합은 **변하지 않는다** — ⚠ 실제 집합은 3파일(수집기 · 상태 전이 서비스 · No.23 `decomposed-resolve.service.ts`)이며 ADR-0019 45행의 "2곳"은 No.23 이후 사실과 달랐다(이 ADR에서 정정, 정적 검사로 고정).
- **판정 1벌**: `collect-decision.ts`에 `shouldQueueNegativeFeedback()`을 더하고 정규화·빈 입력·장문 규칙을 `shouldCollect()`와 **같은 내부 함수**로 공유한다. 제외 = `API_NOTICE` → `ALREADY_UNANSWERED`(폴백 — 이미 `UNANSWERED`로 수집됨) → `BUTTON_NODE`(`inputKind`가 `TEXT`·`BUTTON_MESSAGE`가 아님 — null 포함, 보수적) → `EMPTY` → `TOO_LONG` → `LIMIT_REACHED`. 👍는 큐에 반영하지 않는다(P-8).
- **병합·재발생 규칙은 미응답과 동일**(`occurredCount`·`variants`·`lastOccurredAt` 증가 · `RESOLVED`/`IGNORED`면 상태 유지 + `recurredCount`) + NEGATIVE_FEEDBACK 행은 **`lastFeedbackLogId`**(최근 👎 턴, FK 없음)를 갱신해 상세 화면이 당시 답변(마스킹본)·매칭 대상을 로그에서 읽는다(텍스트 중복 저장 0).
- **소스별 `PENDING` 상한**: `UNANSWERED` = 기존 `UNANSWERED_MAX_PENDING`(5,000 — 계수 조건에 `source` 추가, 도입 전과 같은 값), `NEGATIVE_FEEDBACK` = `FEEDBACK_QUEUE_MAX_PENDING`(2,000). 한 소스가 상한에 닿아도 다른 소스 신규 수집은 계속된다.
- **메시지당 1회 기여 = 원장의 선점 상태 기계**: `queueOutcome`(null → `CLAIMED` → `QUEUED`｜`SKIPPED`｜`FAILED`). 👎가 확정된 요청은 `updateMany where queueOutcome IS NULL`로 **선점에 성공했을 때만** 수집기를 호출한다 — 동시 요청·다중 인스턴스·👎→👍→👎 토글 모두 큐를 한 번만 늘린다. 수집 실패는 흡수(평가 응답은 `200`, `queueOutcome = FAILED`, `queuedAt = null`)하고 **재시도하지 않는다**(통계에는 영향 없음). `SKIPPED`는 사유 코드(`queueSkipCode`)를 남긴다(자유 텍스트 아님).
- **"직접 수정 완료"** 전이 1개: `POST …/unanswered-questions/:id/mark-addressed` — NEGATIVE_FEEDBACK `PENDING` → `RESOLVED`(`resolvedIntentId = null`, CAS), UNANSWERED 항목은 `400 INVALID_STATUS_TRANSITION`(기존 코드 재사용). 감사하지 않는다(ADR-0019 §6 — 큐 상태는 비감사).

### 5. 기능 스위치 = **WEB 채널 설정 `feedbackEnabled`(선택 키 — 없음 = 꺼짐)**

- `WebChannelConfigSchema`에 `feedbackEnabled: z.boolean().optional()`을 더한다(`.default(false)`가 아니다 — 기본값을 주면 `parseChannelConfig()` 결과와 관리자 채널 응답에 키가 생겨 기존 응답 바이트가 바뀐다). `access.resolve()`가 **요청마다 이미 읽는 WEB 채널 행**이라 대화 턴·평가 요청 모두 **추가 조회 0**이다.
- 채널은 버전 스냅샷 밖이라(ADR-0031) 복원·예약 복원이 스위치를 되돌리지 않는다. 편집 권한 `channel:write`, 감사는 기존 `Channel UPDATE`(화이트리스트 `type`·`enabled` 불변 — 값이 바뀌면 summary `답변 평가 받기 변경: false → true`만 추가).
- 기각한 대안 — **1:1 설정 테이블(`ChatbotHandoffSetting` 선례)**: 상담 설정은 필드 11개·전용 캐시·WEB 외 게이트까지 쓰여 테이블이 필요했지만, 평가 스위치는 **WEB 위젯 표시 성격의 불리언 1개**이고 테이블을 두면 대화 턴마다 조회(또는 캐시·무효화 경로)가 1개 늘어 FR-0-139("추가 조회 0")를 지킬 수 없다. **`ChatbotAnswerSetting` 동거**는 복원이 지운다(ADR-0036 교훈).

### 6. 레이트리밋 — 평가 전용 버킷 `fb-ip`(120/분) + `fb-key:msg:{messageId}`(10/분), 대화·폴링 버킷 비소비

- `@PublicRateBucket()`의 `kind`를 `'POLL' | 'FEEDBACK'`으로 넓힌다(새 데코레이터 0 — ADR-0036 K-1 장치 재사용). `FEEDBACK`은 `poll-ip`와도 **공유하지 않는** 별도 IP 축을 쓴다 — 폴링(600/분)과 평가(사람 클릭)의 정상 빈도가 다르고, 평가 폭주가 보류 답변·상담 폴링을 막으면 안 된다. `POLL` 경로의 키·한도·동작은 **바이트 단위로 불변**이다.
- 평가 요청은 대화 `ip`·`session` 버킷을 **소비하지 않는다** — 평가 연타가 다음 질문 전송을 `429`로 만드는 결함(No.24 K-1과 같은 유형)을 구조로 막는다.

### 7. 만족도 통계 = No.14 화면의 새 섹션 · 신규 `GET /stats/feedback`(`chatbot:read`) · 대시보드 불변

- 지표(턴 `dayBucket` 기준): 👍·👎 수 · 긍정률 = 👍/(👍+👎) · **참여율 = 평가 수 / `feedbackOffered = true` 턴 수**(정확한 분모 — 적재 시점 표식이 없으면 "버튼을 본 턴"을 알 수 없다) · 일별 추이 · 👎 상위 대상(원장 `targetKind`·`targetId` groupBy — **질문 문장 없음**) · 표본 30 미만 `lowSample`. 원시 SQL 0(R-7 불변) · `stats/**` 쓰기 0(R-8).
- 그룹·전역(No.29)·의도별 👎 열은 2차 — 원장의 `groupId`·`matchedIntentId`로 추가 적재 없이 확장된다.

## 근거

- **"자기가 받은 답변만"은 이미 존재하는 사실로 증명된다.** 서버 발급 `messageId`(수신자 한정) + URL 밖 `sessionId` + 슬러그의 결합은 새 비밀을 만들지 않고 기존 값만으로 능력(capability)을 구성한다. 토큰을 추가하는 설계는 "지키는 것 없는 복잡도"다.
- **적재 시점 표식은 로그 봉인과 양립하는 유일한 방법이다.** 로그를 나중에 고칠 수 없으므로(R-10) "버튼을 줬는가"·"입력 유형"은 턴 처리 중에 확정해야 한다 — `surveyTurn`·`handoffTurn`·`topicId` 선례와 같은 판단이다.
- **소스 분리는 ADR-0019 91행의 의도 그대로다.** 같은 행 카운터 안은 `occurredCount`의 의미를 섞고 처방이 다른 두 문제를 한 번에 처리하게 만든다. 별도 테이블 안은 "테이블을 쪼개지 않으려고 `source`를 둔다"에 정면 배치된다.
- **선점 상태 기계는 "메시지당 1회"와 "실패 흡수·재시도 없음"을 동시에 만족하는 최소 구조다.** `queuedAt` 1개로는 "선점했지만 실패" 상태를 표현할 수 없어, 실패 시 null로 되돌리면 다음 요청이 재시도하고(요구 위반), 그대로 두면 `queuedAt ≠ null`이 거짓 사실이 된다.

## 대안과 트레이드오프

| 대안 | 기각 사유 |
|---|---|
| 대화 전송 경로(`POST …/messages`)에 평가 편승 | 평가는 턴이 아니다 — 엔진 파이프라인·로그·`session` 버킷이 평가로 오염된다(P-2) |
| 서버 발급 평가 토큰(메시지별 HMAC 등) | 막는 위협이 늘지 않는다(§2). 봉투 밖 저장·검증 규칙·회전 부담만 추가 |
| 평가를 로그 행 컬럼에 기록 | 로그 `update` 0건 봉인(R-10) 위반 · 그룹 이동 소급 방지 논리와 같은 이유로 원천 불변이어야 한다 |
| 원장에 `sessionId` 저장(세션당 제한용) | 최소 수집 위반. 세션 결합은 요청 시점 로그 행으로 충분하고, 세션 단위 제한은 1차 범위 밖(EX-FB-23) |
| `inputKind` 없이 `userMessage`가 버튼 라벨인지 번들로 역추정 | 라벨 편집·노드 삭제·토픽 비활성으로 판정이 흔들리는 추정이다. 사실을 적재한다 |
| `feedbackEnabled`를 `.default(false)`로 | 기존 채널 응답·파싱 결과에 키가 생겨 바이트가 바뀐다(FR-0-139) |
| 1:1 `ChatbotFeedbackSetting` 테이블 | 대화 턴 추가 조회 또는 캐시·무효화 경로 신설(§5) |
| 큐 같은 행 + `negativeFeedbackCount` | 발생 수 의미 혼합 · 처방이 다른 문제를 한 행에서 처리(요구사항 §1.6.2 X) |
| 큐 별도 테이블 `NegativeFeedbackQuestion` | ADR-0019 91행 정면 배치 · 반영·추천·일괄 처리 복제 |
| 👎 N회 누적 후 편입 | 누적 저장소·설정값 추가, 저트래픽 챗봇에서 영영 안 올라온다 — 노이즈는 정렬(발생 수)·필터로 흡수(P-5). 2차 후보 |
| 편입 기여를 `queuedAt` 1개로 표시 | 실패·선점 상태 표현 불가(근거 4) |
| 평가 버킷이 `poll-ip`를 공유 | 평가 폭주가 보류 답변·상담 폴링을 `429`로 만든다 |
| 만족도를 대시보드(No.2)에 카드 추가 | `getDashboard()` 한 글자 불변 원칙(FR-0-90) |

**감수하는 비용**

1. **참여율 분모가 약간 과대**일 수 있다 — 보류 답변이 새 질문으로 폐기되거나 위젯이 로컬 `TIMEOUT`으로 마감한 턴도 `feedbackOffered = true`로 적재된다. 참여율은 "하한"으로 해석한다(화면 도움말).
2. **평가 원장이 무기한 보존**된다(텍스트가 없어 개인정보 부담은 작다) — No.45 보존기간 정책의 대상에 추가한다.
3. **큐 편입 실패는 복구하지 않는다** — `queueOutcome = FAILED`로 남고 통계에는 영향이 없다. 운영자는 원장 조회로 건수를 볼 수 있다.
4. **`CLAIMED`에서 프로세스가 죽으면** 그 메시지의 큐 기여는 영구 누락된다(재시도 없음 규칙과 같은 결과).
5. **Origin 헤더 없는 서버 간 호출은 통과**한다(ADR-0011 설계) — 결합 검증이 동일 적용되므로 자기 대화 평가 이상의 위협은 없다.

## 결과

- Prisma: `MessageFeedback` 신설 · `ConversationLog.feedbackOffered`(Boolean 기본 false)·`inputKind`(String?) · `UnansweredQuestion.lastFeedbackLogId`(String?) · 유일 키 `(chatbotId, source, questionNormalized)` · `Chatbot.messageFeedbacks` 역참조. 마이그레이션 1개 = `ADD COLUMN` 3 + 유니크 인덱스 교체 + `CREATE TABLE` 1 — **테이블 재정의 0 · 백필 0 · 기존 행 값 변경 0**.
- 신규 모듈 `apps/api/src/feedback`(★원장 쓰기 유일 파일 `message-feedback.service.ts`, export 1개) · `conversation/public-feedback.service.ts`(공개 진입 — 접근·스위치·형식 판정 후 위임) · `stats/feedback/`(읽기 전용).
- 신규 `ApiErrorCode` 2종(`FEEDBACK_TARGET_NOT_FOUND` 404 · `FEEDBACK_CLOSED` 409) · 선택 환경변수 5종 · 신규 권한·역할·`AuditTargetType`·`AuditAction` 0 · `@Public()` 7 → 8 · 엔진·pii-mask·ml-worker 변경 0 · 위젯 변경(vanilla 유지 — ADR-0012 Preact 트리거 미발동).
- 정적 검사 `apps/api/src/feedback/lib/feedback-sealing.spec.ts` F-1~F-16(설계서 §17).
- 갱신 각주: ADR-0019(키·두 번째 진입점·`inputKind` 컬럼화·소스별 상한·직접 수정 완료·쓰기 파일 3 정정) · ADR-0011·0015(공개 경로 8) · ADR-0033(봉인 대상 확장) · ADR-0002(사전검사 15종) · ADR-0012(위젯) · ADR-0023(보류 턴 표식·C-1).

## 재검토 트리거

- 평가 응답이 대화 데이터를 돌려주게 될 때(👎 뒤 다른 답변·상담 연결 제안) → 서버 발급 토큰 재검토.
- 부정 평가 항목의 노이즈 비율이 운영상 문제로 확인될 때 → 편입 임계(N회·세션 수) 설정(2차).
- 자유 텍스트 사유 요구 → No.45 보존·파기 정책 확정 후 설문 자유 텍스트와 같은 함수·순서·봉인으로.
- 원장 1,000만 행 도달 또는 통계 P95 미달 → 일 롤업(ADR-0033 §7 트리거와 합류).
- 비WEB 채널(No.46·No.11) 평가 → 스위치를 채널별 설정으로 일반화(`feedbackEnabled`는 WEB 설정에 그대로 둔다).
