# 피드백 기반 개선 루프 세부 설계서 (No.44)

> **요구사항**: `docs/requirements/feedback-loop.md`(T-1~10, J-1~J-19, FR-0-138~148, FR-FB1-\*~FR-FB10-\*, NFR-FBP/FBS/FBA/FBM, AC-FB1~FB8, EX-FB-1~26, 제약 C-1~C-3, P-1~P-16)
> **상위 문서**: `docs/02-spec/개발명세서.md` §2·§2.2·§3·§3.1·§4·§4.1·§5·§5.1·§6(**결정 39 신설**)·§7
> **신규 ADR**: **ADR-0038**(답변 평가 = 메시지 능력 결합 검증(토큰 없음·단일 404) · 텍스트 없는 평가 원장(메시지당 1행·삭제 0) · 큐 소스 분리(유일 키 교체 — 재정의 0) · 적재 시점 로그 표식(`feedbackOffered`·`inputKind`) · WEB 채널 설정 스위치(조회 0) · 평가 전용 레이트리밋 버킷 · 선점 상태 기계로 메시지당 1회 편입)
> **갱신 ADR(각주만)**: ADR-0019(유일 키 · 두 번째 진입점 · `inputKind` 컬럼화 · 소스별 상한 · 직접 수정 완료 · 쓰기 파일 3 정정) · ADR-0011(공개 경로 8) · ADR-0015(`@Public()` 8 · 신규 권한 0) · ADR-0033(봉인 대상 확장) · ADR-0002(사전검사 14 → 15종) · ADR-0012(위젯 평가 버튼 — Preact 트리거 미발동) · ADR-0023(보류 턴 표식 · C-1 재시도)
> **작성일**: 2026-09-25 · **GPU**: **카탈로그 2 유지**(이 그룹이 만드는 연산은 전부 1 — 조회·순수 판정·`groupBy`. 큐 추천은 기존 No.23 분류기/문자 유사도 그대로 · 새 모델·학습·추론 0 · ml-worker 변경 0) — §26
> **기존 파일 수정 목록**: 문서는 `docs/02-spec/feedback-loop-patches.md`, 코드는 이 문서 §2.5.

---

## 0. 이 문서가 푸는 문제 (한 문단 요약)

카탈로그 No.44는 "봇 답변마다 👍/👎를 받고, 👎를 학습현황 큐에 오답 후보로 자동 편입"하라고 한다. 이 설계는 **대화 엔진을 한 줄도 바꾸지 않고** 네 곳에 작은 장치를 둔다. ① **공개 파이프라인**: 응답 조립 직전 순수 함수 `isFeedbackOffered()`가 "위젯이 `feedback-v1`을 선언 ∧ WEB 채널 설정 `feedbackEnabled` ∧ BLOCK·설문·상담 턴 아님"을 판정해 참이면 응답에 `feedback: { rateable: true }`를 싣고 로그에 **`feedbackOffered = true`** 를 적재한다. 로그에는 **`inputKind`** 도 컬럼으로 남긴다(ADR-0019 57행 트리거 발동 — 평가는 턴 뒤에 오므로 버튼 턴을 로그로만 걸러야 한다). 스위치는 `access.resolve()`가 이미 읽는 WEB 채널 행에 있어 **추가 DB 조회가 0**이고, 꺼진 챗봇·구버전 위젯의 응답은 **키 생략으로 바이트 동일**하다. ② **공개 평가 API** `PUT /public/chatbots/:slug/messages/:messageId/feedback`(`@Public()` 8번째): 토큰 없이 (슬러그의 챗봇, 요청 `sessionId`, `messageId`) = 로그 행의 (`chatbotId`, `sessionId`, `id`) ∧ `feedbackOffered`일 때만 저장하고, 어긋나면 전부 같은 `404`다. 평가 전용 버킷(`fb-ip` 120/분 · `fb-key:msg` 10/분)만 소비해 대화 전송을 `429`로 만들지 않는다. ③ **평가 원장 `MessageFeedback`**: 메시지당 1행 · 변경 24시간·5회 · 취소 없음 · 턴 사실과 답변 대상(`targetKind`/`targetId`) 비정규화 · **텍스트·`sessionId` 컬럼 0** · 쓰기 1파일 · 삭제 0. 첫 👎 확정 시 원장의 **선점 상태 기계**(`queueOutcome`)를 CAS로 잡은 요청만 ④ **학습현황 큐**에 편입한다 — 유일 키를 `(chatbotId, source, questionNormalized)`로 바꿔(인덱스 교체만 — SQLite 테이블 재정의 0) `NEGATIVE_FEEDBACK` 소스를 분리하고, 제외 규칙(API 고정 문구·이미 미응답·`NODE` 버튼·빈 입력·장문·상한)은 `collect-decision.ts`와 **같은 함수 1벌**을 공유한다. 콘솔은 소스 필터·당시 답변(마스킹본)·답변 대상·"현재 매칭" 배지·**직접 수정 완료** 전이를, No.14 통계 화면은 **답변 만족도** 섹션(참여율 분모 = `feedbackOffered` 턴)을 얻는다. 이 설계가 추가로 찾은 제약 5건: **① No.14 질문 순위의 큐 딥링크 조회가 소스를 모른다**(`stats.service.ts` 312행 — 같은 정규화 질문의 부정 평가 행 id가 걸릴 수 있어 `source='UNANSWERED'` 조건 1개 추가 — §10.6) · **② `unansweredQuestion` 쓰기 파일은 요구사항·ADR-0019가 말하는 2곳이 아니라 3곳이다**(No.23 `decomposed-resolve.service.ts` — 불변으로 봉인 — §10.1) · **③ `@Public()` 7을 숫자로 단언하는 파일은 5개이고 `topic-sealing.spec.ts`는 제목 문자열만 7이다**(§21.2) · **④ `queuedAt` 1개로는 "메시지당 1회"와 "실패 흡수·재시도 없음"을 동시에 표현할 수 없다**(선점 상태 기계 — §9.4) · **⑤ `feedbackEnabled`를 `.default(false)`로 두면 모든 관리자 채널 응답의 바이트가 바뀐다**(선택 키로 — §5.1).

---

## 1. PM 확정 사항 (2026-09-25 — 전부 권고안, No.44 도입 확정)

| # | 확정 내용 | 이 문서에서의 반영 |
|---|---|---|
| P-1 | 1차 = 위젯 👍/👎 + 공개 평가 API + 평가 원장 + 👎 큐 자동 편입 + 챗봇 스코프 만족도 통계. 사유 코드·그룹/전역 통계는 2차, 자유 텍스트는 후속 | §5~§13 · §23 |
| P-2 | `PUT /public/chatbots/:slug/messages/:messageId/feedback` 1개(`@Public()` 7 → 8). 단언 파일 의도적 갱신 | §7 · §21.2(단언 파일 전수 확인 결과 **숫자 단언 5 + 제목만 1**) |
| P-3 | 토큰 없음 · messageId·sessionId·slug 전부 일치 시만 저장 · 불일치는 같은 404 · 메시지당 1행 · 변경 24시간 5회 · 취소 없음 · 큐 반영 메시지당 1회 | §7.2 · §9.2~§9.4 |
| P-4 | 평가 전용 버킷(IP 120/분 + 메시지 10/분) · 대화 session 버킷 비소비 · `PublicRateBucket` 재사용 | §8 |
| P-5 | 👎 1회 즉시 편입 · 제외 = 폴백·API 고정 문구·NODE 버튼·빈 입력·장문 · 부정 평가 대기 상한 2,000 | §10.2~§10.4 |
| P-6 | 유일 키 `(chatbotId, source, questionNormalized)` · 기존 행 `UNANSWERED` · 큐 쓰기 주체 유지 | §3.2 · §10.1 |
| P-7 | 당시 봇 답변(마스킹본)·매칭 대상 표시 · 추천 "현재 매칭" 배지 · "직접 수정 완료"(의도 없이 `RESOLVED`) | §11 |
| P-8 | 👍는 큐 비반영(통계만) | §10.2 |
| P-9 | 자유 텍스트 사유 없음 | §9.1(원장 텍스트 컬럼 0) |
| P-10 | No.14 통계 "답변 만족도" 섹션 — 평가 수·긍정률·참여율(분모 `feedbackOffered`)·추이·👎 집중 답변 · 대시보드 불변 · No.29 2차 | §12 |
| P-11 | WEB 채널 설정 `feedbackEnabled`(기본 끔) · `access.resolve()`가 읽는 행 · 최종 위치 architect | §5 — **WEB 채널 config 선택 키로 확정**(ADR-0038 §5) |
| P-12 | 위젯 변경 수용 · `feedback-v1` · 서버 표시 말풍선에만 · vanilla · 100KB | §13 |
| P-13 | 상담 턴·상담원 메시지 평가 제외 · 설문과 별개 | §6.1 · §19 |
| P-14 | 시뮬레이터·TC 평가 적재 0(로그 행 필수로 구조 보장) | §6.5 · §17 F-8 |
| P-15 | 신규 권한·역할·감사 0 | §14 · §15 |
| P-16 | GPU 2 | §26 |
| (architect) | `ConversationLog.inputKind`·`feedbackOffered` 컬럼 | §3.1 · §6.3 |
| (architect) | 보류 RAG READY → 로그 적재 경쟁(C-1) = 위젯 1초 뒤 1회 재시도 | §6.4 · §13.5 |
| (architect) | 위젯 봇 말풍선에 `messageId` 연결 | §13.3 |
| (architect) | 평가 불가·기능 꺼짐 = 응답 키 생략(바이트 동일) | §6.2 |
| (architect) | 스위치 위치 = WEB 채널 config(설정 테이블 기각) | §5 · ADR-0038 §5 |
| (architect) | 유일 키 마이그레이션 = 인덱스 교체(재정의 0) · 부분 유니크 4개 보존 확인 · 통합 시험 `migrate deploy` | §3.2 |
| (architect) | 원장과 "대화로그 삭제 경로 0" 봉인·영구삭제 사전검사 | §9.5 · §17 |

---

## 2. 아키텍처 배치

### 2.1 모듈 구조

기존 4계층 규약(개발명세서 §2.1)을 따른다. **NestJS 모듈 1개를 신설**(`feedback` — 원장 쓰기)하고, 공개 진입점은 공개 대화 모듈 안에, 통계는 `stats` 모듈 안에 둔다(`stats/**` 쓰기 0 봉인 R-8 유지).

```
apps/api/src/
├── feedback/                                      # [신규] FeedbackModule
│   ├── feedback.module.ts                         # imports: prisma, learning(UnansweredCollectorService) · exports: [MessageFeedbackService] 1개
│   ├── message-feedback.service.ts                # ★ MessageFeedback 쓰기 유일 파일 — 결합 검증(로그 PK 1회)·저장/변경(CAS)·선점·편입 위임
│   └── lib/                                       # DB·Nest 무의존 순수 함수(NFR-FBM1)
│       ├── feedback-offer.ts                      # isFeedbackOffered(input) · readFeedbackEnabled(webChannelConfigJson)
│       ├── feedback-write-decision.ts             # decideFeedbackWrite({ existing, requested, turnCreatedAt, now, limits }) → CREATE｜NOOP｜CHANGE｜CLOSED
│       ├── feedback-verify.ts                     # verifyFeedbackTarget(logRow, { chatbotId, sessionId }) → boolean (단일 404 판정 1벌)
│       └── feedback-sealing.spec.ts               # §17 F-1~F-16
├── conversation/
│   ├── public-conversation.controller.ts          # [수정] 5번째 핸들러 submitFeedback(@Public · @PublicRateBucket kind FEEDBACK) — 생성자 +1(PublicFeedbackService)
│   ├── public-feedback.service.ts                 # [신규] 공개 진입 — access.resolve · 스위치 · UUID 형식 → MessageFeedbackService.submit()
│   ├── public-conversation.service.ts             # [수정] access.resolve의 channel 사용 · isFeedbackOffered · 응답 선택 필드 · record(feedbackOffered) · 보류 턴 전달 — 생성자 인자 추가 0
│   ├── conversation-log.service.ts                # [수정] create.data에 feedbackOffered·inputKind
│   └── conversation.module.ts                     # [수정] imports += FeedbackModule · providers += PublicFeedbackService
├── common/rate-limit/public-rate-bucket.decorator.ts   # [수정] kind: 'POLL' | 'FEEDBACK'
├── conversation/guards/public-rate-limit.guard.ts      # [수정] 전용 버킷 소비를 kind별 접두·한도 표로 일반화(POLL 동작 불변)
├── learning/
│   ├── lib/collect-decision.ts                    # [수정] shouldQueueNegativeFeedback() + 정규화·빈 입력·장문 공용 내부 함수
│   ├── unanswered-collector.service.ts            # [수정] collectNegativeFeedback() 진입점 · 기존 수집 source 명시 · 키·상한 소스별
│   ├── unanswered-questions.service.ts            # [수정] 목록·요약·상세 소스 확장 · markAddressed() 전이
│   ├── unanswered-questions.controller.ts         # [수정] POST :id/mark-addressed
│   └── unanswered-question.mapper.ts              # [수정] source·resolvedDirectly·lastFeedbackTarget 매핑
├── stats/
│   ├── feedback/feedback-stats.service.ts         # [신규] 만족도 통계(읽기 전용 · 원시 SQL 0)
│   ├── lib/feedback-stats.ts                      # [신규] foldFeedbackStats() 순수 조립
│   ├── stats.controller.ts                        # [수정] @Get('feedback')
│   ├── stats.module.ts                            # [수정] providers += FeedbackStatsService
│   └── stats.service.ts                           # [수정] getQuestions()의 큐 딥링크 조회에 source 조건 1개(§10.6) — getDashboard() 무변경
├── channels/channels.service.ts                   # [수정] feedbackEnabled 변화 시 감사 summary 1줄
└── chatbots/chatbots.service.ts                   # [수정] 사전검사 15종(messageFeedbacks)
```

### 2.2 모듈 의존 방향

```
conversation → feedback(MessageFeedbackService — 공개 진입 1곳) / learning(기존) / …(기존)
feedback     → learning(UnansweredCollectorService.collectNegativeFeedback) / prisma
learning     → (feedback 모듈 import 0 — 원장은 Prisma 읽기만: 상세 추이)
stats        → (feedback 모듈 import 0 — 원장·로그 Prisma 읽기만)
simulation｜validation｜versions｜deploy-schedules｜topics｜asset-transfer ✕ feedback/**   (§17 F-8)
feedback     ✕ dialogue-engine · rag · handoff · embedding · survey-responses · dialogue-common   (§17 F-7)
```
- `FeedbackModule`의 export는 **`MessageFeedbackService` 1개**이며 import처는 `ConversationModule` 1곳이다. 원장 쓰기는 모듈 밖에서 주입할 수 없는 경로(공개 평가 1개)로만 일어난다.
- 순수 함수 `classifyFeedbackTarget()`(답변 대상 판정)은 `packages/shared-types/src/feedback.ts`에 둔다 — 원장 적재(feedback)·큐 표시(learning)·통계(stats)·콘솔(web)이 같은 판정 1벌을 쓴다(`normalizeText`·`toKstDayBucket` 선례).
- `learning`이 `feedback/lib`를 import하지 않는다(순환 방지). `isFeedbackOffered()`는 `conversation → feedback/lib` 파일 import이며 DI 의존이 아니다.

### 2.3 엔진 수정 범위 — **0건** (FR-0-138)

- `packages/dialogue-engine`은 한 파일도 바꾸지 않는다. 평가 가능 판정은 API 계층이 이미 가진 턴 사실(`blockedByFilter`·`surveyTurn`·`handoffTurn` — 반환 경로 자체로 구분됨)과 요청 `features`·채널 설정만 쓴다. 번들·봉투(`ConversationState`) 스키마 불변.
- 엔진 패키지에 `feedback` 심볼 0건을 정적 검사가 단언한다(§17 F-12).

### 2.4 `apps/api` 외 워크스페이스 영향

| 워크스페이스 | 변경 |
|---|---|
| `packages/shared-types` | **`feedback.ts` 신설**(§4.1) · `conversation.ts`(`WIDGET_FEATURE_FEEDBACK_V1` · 공개 평가 요청/응답 · 응답 선택 필드 `feedback`) · `channel.ts`(`feedbackEnabled?`) · `learning.ts`(`UnansweredSource` 2종 · 목록/요약/상세 선택 필드 · 목록 쿼리 `source`) · `common.ts`(`ApiErrorCode` 2종) · `index.ts` export |
| `apps/widget` | 평가 버튼(§13) — `constants/feedback.ts`·`core/feedback.ts`(순수)·`ui/feedback-bar.ts`(DOM) 신설 · `api/public-client.ts`·`ui/message-list.ts`·`ui/app.ts`·`constants/messages.ts`·`styles.ts` 수정. **vanilla · 런타임 의존성 0 · gzip 100KB 게이트** |
| `apps/web` | WEB 채널 설정 스위치 · 학습현황(소스 필터·배지·부정 평가 상세·직접 수정 완료·편집 링크) · No.14 통계 "답변 만족도" 섹션 — §20 |
| `packages/dialogue-engine` · `packages/pii-mask` · `apps/ml-worker` | **변경 0건** |

### 2.5 기존 코드 변경 목록 (구현자 체크리스트)

| 파일 | 변경 | 근거 |
|---|---|---|
| `prisma/schema.prisma` + 마이그레이션 1개 | `MessageFeedback` 신설 · `ConversationLog.feedbackOffered`·`inputKind`(모델 **끝**에 선언) · `UnansweredQuestion.lastFeedbackLogId`(모델 끝) + `@@unique([chatbotId, source, questionNormalized])` · `Chatbot.messageFeedbacks` 역참조 · `source` 주석 갱신 | §3 |
| `prisma/seed.ts` | 데모 챗봇 WEB 채널 `feedbackEnabled: true` · 평가 원장 3건 + 부정 평가 큐 1건(대응 로그 행 동반 — "큐·원장 있으면 로그도 있다" 불변식) | §3.3 |
| `packages/shared-types/src/{feedback,conversation,channel,learning,common,index}.ts` | §4 | — |
| `config/env.validation.ts` | 선택 5종(§3.4) | FR-0-148 |
| `common/rate-limit/public-rate-bucket.decorator.ts` · `conversation/guards/public-rate-limit.guard.ts` | `kind: 'POLL' \| 'FEEDBACK'` · kind별 IP 버킷 접두·한도 표(`POLL` = `poll-ip`/`poll-key` 600 그대로 · `FEEDBACK` = `fb-ip`/`fb-key` 120/10) | §8 |
| `conversation/public-conversation.controller.ts` | `@Put('messages/:messageId/feedback')` `submitFeedback` — **`pollHandoff` 뒤(파일 끝)에 선언**(H-10의 "pollHandoff 앞 400자" 검사 불변) · 생성자 +1 | §7 |
| `conversation/public-feedback.service.ts`(신규) · `conversation/conversation.module.ts` | §7.2 ②~④ · 위임 | §7 |
| `conversation/public-conversation.service.ts` | `const { chatbot, channel } = await this.access.resolve(slug)` · 일반 턴/보류 턴에서 `isFeedbackOffered` → 응답 `...(offered ? { feedback: FEEDBACK_OFFER } : {})`(마지막 키) · `record({ …, feedbackOffered })` · `startPendingRagAnswer` 입력·`enqueue` 입력에 `feedbackOffered` · **BLOCK·상담 HANDLED 반환 경로 무변경**(기본 false) · 생성자 인자 추가 0 | §6 |
| `conversation/conversation-log.service.ts` | `RecordConversationLogParams.feedbackOffered?` · `create.data`에 `feedbackOffered: params.feedbackOffered ?? false`, `inputKind: params.inputKind` · 수집기 호출 무변경 | §6.3 |
| `rag/conversation-log.port.ts` · `rag/rag-answer.service.ts` | 포트 파라미터 `feedbackOffered?: boolean` · `RagAnswerRunInput.feedbackOffered?` · READY·폴백 두 `record()`에 전달 · **`complete()`→`record()` 순서 무변경**(C-1은 위젯이 흡수) | §6.4 |
| `feedback/**`(신규) | §2.1 | §7·§9 |
| `learning/lib/collect-decision.ts` | `NegativeFeedbackSkipCode` · `shouldQueueNegativeFeedback()` · 공용 `normalizeQueueCandidate()`(내부) — `shouldCollect()` 동작 불변 | §10.2 |
| `learning/unanswered-collector.service.ts` | 기존 `collect()`: `findUnique` 키 `chatbotId_source_questionNormalized`(`source:'UNANSWERED'`) · `create.data.source = 'UNANSWERED'` 명시 · 상한 계수 `where.source = 'UNANSWERED'` · P2002 재시도 키 동일 교체 — **동작 불변** · 신규 `collectNegativeFeedback()` | §10.3 |
| `learning/unanswered-questions.service.ts` · `…controller.ts` · `…mapper.ts` | 목록 `source` 필터·NEGATIVE_FEEDBACK 행 답변 대상(요청당 일괄 3쿼리) · 요약 `groupBy(source)` 1쿼리(`pendingCount` 전체 · `limitReached` = UNANSWERED 기준 · `bySource`) · 상세 `lastFeedback`·`counterpart`·원장 기반 추이 · `markAddressed()` · 반영 감사 summary의 소스 라벨 | §11 |
| `stats/feedback/feedback-stats.service.ts`(신규) · `stats/lib/feedback-stats.ts`(신규) · `stats/stats.controller.ts` · `stats/stats.module.ts` | `GET /stats/feedback` | §12 |
| `stats/stats.service.ts` | **`getQuestions()`만** — 312행 큐 딥링크 `findMany.where`에 `source: 'UNANSWERED'` 추가(§10.6). `getDashboard()`·원시 SQL 무변경 | §10.6 |
| `channels/channels.service.ts` | `upsert()` 감사 summary — `feedbackEnabled` 값이 바뀌면 `답변 평가 받기 변경: {전} → {후}`를 기존 `사용 여부 변경` summary와 ` · `로 합성(둘 다 없으면 summary 없음 — 기존 동작) | §15 |
| `chatbots/chatbots.service.ts` | `CHILD_COUNT_LABELS.messageFeedbacks = '답변 평가'` · `messageFeedback.count` · `counts`에 키 추가(14 → 15). 영구삭제 트랜잭션 무변경 | §9.5 |
| `common/all-exceptions.filter.ts` | 변경 없음(신규 코드는 `ApiException`으로만 발생) | — |
| `apps/widget/**` · `apps/web/**` | §13 · §20 | — |
| 시험 파일 | §21.2 닫힌 목록 | FR-0-146 |

> **이 목록에 없는 파일은 바꾸지 않는다.** 특히 `packages/dialogue-engine/**`, `dialogue-common/**`(번들·캐시), `rag/pending-answer.store.ts`·`rag/rag-gate.service.ts`, `handoff/**`(게이트·경고 판정 `evaluateSessionAlert` 포함), `survey-responses/**`, `simulation/**`, `validation/**`, `versions/**`, `deploy-schedules/**`, `topics/**`, `embedding/**`, `classifier/**`, `stats/stats.service.ts#getDashboard`·`getSummary`·`getDistribution`, `stats/integrated/**`, `stats/intents/**`는 무변경이다.

### 2.6 커밋 분리 단위

| 커밋 | 범위 | 독립성 |
|---|---|---|
| **① 큐 소스 분리 준비(동작 불변)** | 마이그레이션 중 `unanswered_questions` 부분(유니크 인덱스 교체 + `lastFeedbackLogId`) · 수집기 키·`source` 명시·상한 계수 · `stats.service.ts#getQuestions` 딥링크 `source` 조건 · `UnansweredSource` 스키마 주석 | No.44 본체에 의존하지 않는다. 적용 전후 **모든 기존 시험이 수정 없이 통과**해야 한다(기존 행 전부 `UNANSWERED` — 결과 불변). 여기서 깨지면 멈추고 보고한다 |
| ② No.44 본체 | 나머지 전부 | ①을 전제로 FR-0-139 "바이트 동일" 기준선을 **① 적용 후**로 잡는다 |

> 마이그레이션 파일을 둘로 나누면 ①만 먼저 배포할 수 있다(`…_queue_source_split` · `…_feedback_loop`). 하나로 두는 경우에도 코드 커밋은 위 순서를 지킨다.

---

## 3. 데이터 모델 · 마이그레이션

### 3.1 Prisma 변경안

```prisma
model Chatbot {
  // … 기존 필드 불변 …
  /// [신규 No.44] 역참조만 — DB 컬럼 변화 0.
  messageFeedbacks        MessageFeedback[]
}

model ConversationLog {
  // … 기존 필드 불변 · topicId 다음(모델 끝)에 선언 — 수기 ADD COLUMN과 열 순서를 맞춘다 …
  /// [신규 No.44] 이 턴에 평가 버튼을 제공했는가(isFeedbackOffered 순수 판정 — 위젯 feedback-v1 선언 ∧
  /// WEB 설정 feedbackEnabled ∧ BLOCK·설문·상담 턴 아님). 참여율 분모이자 평가 API 허용 근거(ADR-0038 §1).
  /// 쓰기 주체 = record() 1곳 · 적재 후 불변 · 인덱스 없음 · 백필 없음(기존 행 = false가 사실).
  feedbackOffered Boolean  @default(false)
  /// [신규 No.44 — ADR-0019 §3 재검토 트리거 발동] 입력 유형 TEXT | BUTTON_MESSAGE | BUTTON_NODE
  /// (record() 파라미터를 그대로 적재). 평가 뒤 큐 편입 판정이 버튼 턴을 로그만으로 거른다.
  /// 기존 행 = null(기록 없음). 쓰기 주체 = record() 1곳 · 적재 후 불변 · 인덱스 없음.
  inputKind       String?
}

model UnansweredQuestion {
  // … 기존 필드 불변 …
  /// 수집 소스: 'UNANSWERED'(record() 수집) | 'NEGATIVE_FEEDBACK'(No.44 — 평가 요청의 👎 편입).
  /// 병합 유일 키의 일부다(ADR-0038 §4).
  source             String    @default("UNANSWERED")
  // … updatedAt 다음(모델 끝)에 선언 …
  /// [신규 No.44] NEGATIVE_FEEDBACK 항목의 최근 👎 턴(ConversationLog.id). FK 없음(로그 규약).
  /// 상세 화면이 당시 봇 답변(마스킹본)·매칭 대상을 이 로그 행에서 읽는다 — 텍스트 중복 저장 0.
  lastFeedbackLogId  String?

  @@unique([chatbotId, source, questionNormalized])   // [변경 No.44] (chatbotId, questionNormalized) → 소스 분리
  @@index([chatbotId, status, occurredCount])
  @@index([chatbotId, lastOccurredAt])
}

/// [신규 No.44] 답변 평가 원장 — 메시지(= ConversationLog 1행)당 1행(ADR-0038 §3).
/// ★ 질문·답변 텍스트·sessionId·IP·User-Agent 컬럼이 없다(최소 수집 — 컬럼 허용 목록 정적 검사 F-3).
/// 쓰기 주체 = feedback/message-feedback.service.ts 1파일 · 삭제 코드 0건 · 스냅샷·복사·분리 대상 아님.
model MessageFeedback {
  id                String    @id @default(uuid())
  chatbotId         String
  chatbot           Chatbot   @relation(fields: [chatbotId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  /// = ConversationLog.id = 공개 응답 messageId. FK 없음(로그 규약 — 로그·원장 모두 삭제 0).
  conversationLogId String    @unique
  /// FeedbackRating: UP | DOWN — 현재 값(마지막 변경이 이긴다)
  rating            String
  /// 값 변경 횟수(최초 저장 = 0). CAS 대상 — 상한 FEEDBACK_MAX_CHANGES(5)
  changeCount       Int       @default(0)
  // ── 턴 사실: 최초 저장 시 로그 행에서 복사, 이후 불변 ──
  /// 대화 당시 그룹(로그 groupId 복사 — 평가 시점 소속이 아니다, AC-FB6-5)
  groupId           String
  /// 턴의 KST 일 버킷(로그 dayBucket 복사) — 통계 기간 기준
  turnDayBucket     String
  turnCreatedAt     DateTime
  channelType       String
  isAnswered        Boolean
  answeredByRag     Boolean
  apiNotice         Boolean
  inputKind         String?
  matchedIntentId   String?
  matchedFaqId      String?
  matchedNodeId     String?
  topicId           String?
  /// FeedbackTargetKind: NODE | FAQ | INTENT | RAG | FALLBACK | API_NOTICE | OTHER (shared-types classifyFeedbackTarget)
  targetKind        String
  /// NODE/FAQ/INTENT일 때 그 자산 id. FK 없음(자산 삭제 후에도 사실 기록 — 화면 "삭제됨").
  targetId          String?
  // ── 큐 기여: 메시지당 최대 1회(선점 상태 기계 — §9.4) ──
  /// null(미판정) | CLAIMED | QUEUED | SKIPPED | FAILED
  queueOutcome      String?
  /// SKIPPED일 때 NegativeFeedbackSkipCode(ALREADY_UNANSWERED|API_NOTICE|BUTTON_NODE|EMPTY|TOO_LONG|LIMIT_REACHED) — 자유 텍스트 아님
  queueSkipCode     String?
  queuedAt          DateTime?
  /// QUEUED일 때 UnansweredQuestion.id. FK 없음.
  queueItemId       String?
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  @@index([chatbotId, turnDayBucket])   // 통계 기간 필터(groupBy 2종 공용)
  @@index([queueItemId])                // 부정 평가 항목 상세의 👎 추이(§11.4)
  @@map("message_feedbacks")
}
```

**컬럼 이름 허용 목록(F-3 — 이 목록 밖 컬럼 추가는 정적 검사 실패)**: `id, chatbotId, chatbot, conversationLogId, rating, changeCount, groupId, turnDayBucket, turnCreatedAt, channelType, isAnswered, answeredByRag, apiNotice, inputKind, matchedIntentId, matchedFaqId, matchedNodeId, topicId, targetKind, targetId, queueOutcome, queueSkipCode, queuedAt, queueItemId, createdAt, updatedAt`. 요구사항 초안의 `queuedQuestionId`는 **`queueItemId`로 개명**했다(허용 목록 밖 금지 부분 문자열 `question`·`message`·`text`·`session`·`response`·`reason`·`comment`를 이름 수준에서도 원천 차단 — 예외는 FK 관계 `conversationLogId` 1개로 명시).

### 3.2 마이그레이션 (1개 또는 2개 — `YYYYMMDDHHMMSS_feedback_loop`)

**수기 작성**한다 — `prisma migrate dev`는 모델 중간 선언 컬럼을 이유로 `RedefineTables`를 제안할 수 있다(`integrated_stats`·`hybrid_cs` 선례). 새 컬럼은 모델 **끝**에 선언해 diff를 최소화한다.

```sql
-- 피드백 기반 개선 루프(No.44, ADR-0038) — 비파괴 변경만. 기존 행 값 변경 0 · 백필 0 · 테이블 재정의 0.
-- ADD COLUMN x3(상수 기본값/NULL — SQLite는 테이블 재작성 없음) + 유니크 인덱스 교체 1 + CREATE TABLE 1.
-- ⚠ 원시 부분 유니크 인덱스 4개(test_runs_chatbotId_active_key · deploy_schedules 2 · handoff_sessions_active_key)가
--   있는 테이블을 건드리지 않는다 — RedefineTables가 없으므로 삭제될 경로가 없다(적용 후 sqlite_master로 재확인).
-- 롤백 = message_feedbacks DROP + 유니크 인덱스 원복 + 3컬럼 제거(SQLite 3.35+ DROP COLUMN).

-- ① 사전 확인(배포 절차 — 결과를 배포 기록에 남긴다)
--   SELECT "source", COUNT(*) FROM "unanswered_questions" GROUP BY "source";   -- 기대: UNANSWERED 1행뿐
--   (새 키 (chatbotId, source, questionNormalized)는 기존 키 (chatbotId, questionNormalized)의 상위 집합이라 중복이 원리상 불가능하다)

-- AlterTable
ALTER TABLE "conversation_logs" ADD COLUMN "feedbackOffered" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "conversation_logs" ADD COLUMN "inputKind" TEXT;

-- AlterTable
ALTER TABLE "unanswered_questions" ADD COLUMN "lastFeedbackLogId" TEXT;

-- 유일 키 교체(소스 분리)
DROP INDEX "unanswered_questions_chatbotId_questionNormalized_key";
CREATE UNIQUE INDEX "unanswered_questions_chatbotId_source_questionNormalized_key"
  ON "unanswered_questions"("chatbotId", "source", "questionNormalized");

-- CreateTable
CREATE TABLE "message_feedbacks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatbotId" TEXT NOT NULL,
    "conversationLogId" TEXT NOT NULL,
    "rating" TEXT NOT NULL,
    "changeCount" INTEGER NOT NULL DEFAULT 0,
    "groupId" TEXT NOT NULL,
    "turnDayBucket" TEXT NOT NULL,
    "turnCreatedAt" DATETIME NOT NULL,
    "channelType" TEXT NOT NULL,
    "isAnswered" BOOLEAN NOT NULL,
    "answeredByRag" BOOLEAN NOT NULL,
    "apiNotice" BOOLEAN NOT NULL,
    "inputKind" TEXT,
    "matchedIntentId" TEXT,
    "matchedFaqId" TEXT,
    "matchedNodeId" TEXT,
    "topicId" TEXT,
    "targetKind" TEXT NOT NULL,
    "targetId" TEXT,
    "queueOutcome" TEXT,
    "queueSkipCode" TEXT,
    "queuedAt" DATETIME,
    "queueItemId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "message_feedbacks_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "message_feedbacks_conversationLogId_key" ON "message_feedbacks"("conversationLogId");
CREATE INDEX "message_feedbacks_chatbotId_turnDayBucket_idx" ON "message_feedbacks"("chatbotId", "turnDayBucket");
CREATE INDEX "message_feedbacks_queueItemId_idx" ON "message_feedbacks"("queueItemId");
```

- **인덱스 이름**은 Prisma 명명 규칙(`<table>_<cols>_key`/`_idx`)과 같게 둔다 — 이후 `migrate dev`가 인덱스를 드리프트로 보지 않는다.
- **적용 후 확인(배포 체크리스트)**: ① `SELECT name FROM sqlite_master WHERE type='index' AND name IN ('test_runs_chatbotId_active_key','deploy_schedules_chatbotId_scheduledAt_active_key','deploy_schedules_chatbotId_running_key','handoff_sessions_active_key')` = **4행** ② `unanswered_questions_chatbotId_questionNormalized_key` 부재 · 새 키 존재 ③ `PRAGMA foreign_key_check` 0행.
- **소요·잠금(NFR-FBP7)**: `conversation_logs`의 `ADD COLUMN`(상수 기본값·NULL)은 SQLite에서 **스키마 텍스트만 바꾸는 O(1)** 연산이다(테이블 재작성 없음 — `hybrid_cs`의 `handoffTurn` 선례). 유니크 인덱스 재생성은 `unanswered_questions` 행 수(챗봇당 상한 7,000)에 비례해 작다. **100만 로그 행 DB에서 전체 소요를 실측해 `docs/05-ops/자동배포.md`에 기록**하며, API 중지 상태에서 적용한다(§5 단일 작성자 규약).
- **통합 시험은 `prisma migrate deploy`** 로 스키마를 만든다(원시 부분 유니크를 포함한 실제 스키마 — `db push`를 쓰는 기존 하드닝 시험 2개는 영향 없음: 새 유일 키는 `schema.prisma`에 선언되므로 `db push`도 만든다).

### 3.3 seed

- 데모 챗봇 WEB 채널 config에 `feedbackEnabled: true`.
- 데모 로그 3행(`feedbackOffered: true`, `inputKind: 'TEXT'`)과 대응 원장 3행(👍 2 · 👎 1), 👎 행에 대응하는 `NEGATIVE_FEEDBACK` 큐 1행(`lastFeedbackLogId` = 그 로그 id · 원장 `queueOutcome: 'QUEUED'`·`queueItemId`). **원장·큐가 있으면 로그도 있다**(영구삭제 차단 집합 불변 — ADR-0019 92행 불변식)는 seed가 지킨다.
- seed의 기존 `unansweredQuestion.deleteMany`(데모 재생성)는 seed 전용이며 봉인 대상 밖이다(ADR-0033 선례). 원장도 seed에서만 재생성 시 `messageFeedback.deleteMany`를 쓸 수 있다 — **`apps/api/src` 밖**이라 F-1에 걸리지 않는다.

### 3.4 환경변수 — **5개(전부 선택 · 기본값 · 기동 조건 아님, FR-0-148)**

| 변수 | 기본 | 용도 |
|---|---|---|
| `PUBLIC_FEEDBACK_RATE_LIMIT_IP_PER_MIN` | `120` | 평가 전용 IP 버킷(`fb-ip`) |
| `PUBLIC_FEEDBACK_RATE_LIMIT_MESSAGE_PER_MIN` | `10` | 평가 전용 메시지 키 버킷(`fb-key:msg:{messageId}`) |
| `FEEDBACK_CHANGE_WINDOW_HOURS` | `24` | 저장·변경 허용 기한(로그 `createdAt` 기준, 1~168) |
| `FEEDBACK_MAX_CHANGES` | `5` | 메시지당 값 변경 횟수 상한(0~20) |
| `FEEDBACK_QUEUE_MAX_PENDING` | `2000` | 챗봇당 `NEGATIVE_FEEDBACK` `PENDING` 상한 |

기능 스위치는 환경변수가 아니라 **챗봇별 WEB 채널 설정**이다(기본 꺼짐).

### 3.5 배포 순서 · 롤백

1. (커밋 ①) 마이그레이션 → API 배포 — 동작 불변(기존 시험 전부 통과가 게이트).
2. (커밋 ②) API 배포 → 위젯 `widget.js` 배포(순서 무관 — 구버전 위젯은 `feedback-v1`을 선언하지 않아 표식이 없고, 신버전 위젯이 구버전 API를 만나면 서버가 `features` 값을 무시해 표식이 없다) → 콘솔 배포.
3. **롤백**: 콘솔·위젯 → API 순. 원장·큐 행은 남는다(삭제 0). 스키마 롤백은 원장 DROP · 유일 키 원복 전 **`NEGATIVE_FEEDBACK` 행 존재 시 원복 불가**(같은 정규화 질문 2행이 옛 키를 위반) → 롤백 절차는 "API 롤백까지만, 스키마는 유지"를 기본으로 한다(스키마 유지 상태에서 구버전 API는 큐 키 이름이 달라 수집 `findUnique`가 실패 → 경고 로그만 남기고 수집 0 — 대화 응답 무영향). 이 한계를 배포 문서에 명시한다.

---

## 4. shared-types 스키마

### 4.1 `packages/shared-types/src/feedback.ts` (신설 — 위젯 비유입)

```ts
export const FeedbackRating = z.enum(['UP', 'DOWN']);
export const FeedbackTargetKind = z.enum(['NODE', 'FAQ', 'INTENT', 'RAG', 'FALLBACK', 'API_NOTICE', 'OTHER']);
export const FEEDBACK_TARGET_KIND_LABELS: Record<FeedbackTargetKind, string>
  = { NODE: '노드', FAQ: 'FAQ', INTENT: '의도', RAG: '문서 답변', FALLBACK: '답변 못함(폴백)', API_NOTICE: '연동 안내', OTHER: '기타' };
export const NegativeFeedbackSkipCode = z.enum(['ALREADY_UNANSWERED', 'API_NOTICE', 'BUTTON_NODE', 'EMPTY', 'TOO_LONG', 'LIMIT_REACHED']);
export const FeedbackQueueOutcome = z.enum(['CLAIMED', 'QUEUED', 'SKIPPED', 'FAILED']);
export const FEEDBACK_LIMITS = { changeWindowHours: 24, maxChanges: 5, maxPendingNegativeFeedback: 2000, lowSampleThreshold: 30, topTargetsMax: 20, topTargetsDefault: 10 };

/** 답변 대상 판정 1벌(원장 적재·큐 표시·통계·콘솔 공용). classifyResponseSource()와 같은 우선순위에
 *  API_NOTICE(최우선)·INTENT(노드·FAQ 없이 의도만)를 더한 확장이다 — 폴백 노드는 isAnswered=false라 FALLBACK. */
export function classifyFeedbackTarget(row: {
  isAnswered: boolean; apiNotice: boolean; answeredByRag: boolean;
  matchedNodeId: string | null; matchedFaqId: string | null; matchedIntentId: string | null;
}): { kind: FeedbackTargetKind; id: string | null } {
  if (row.apiNotice) return { kind: 'API_NOTICE', id: null };
  if (!row.isAnswered) return { kind: 'FALLBACK', id: null };
  if (row.matchedNodeId) return { kind: 'NODE', id: row.matchedNodeId };
  if (row.matchedFaqId) return { kind: 'FAQ', id: row.matchedFaqId };
  if (row.answeredByRag) return { kind: 'RAG', id: null };
  if (row.matchedIntentId) return { kind: 'INTENT', id: row.matchedIntentId };
  return { kind: 'OTHER', id: null };
}

// ── 통계 ──
export const FeedbackStatsQuerySchema = z.object({
  chatbotId: z.string().uuid(), from: z.coerce.date().optional(), to: z.coerce.date().optional(),
  topN: z.coerce.number().int().min(1).max(FEEDBACK_LIMITS.topTargetsMax).default(FEEDBACK_LIMITS.topTargetsDefault),
});
const Rate = z.number().min(0).max(1).nullable();          // 분모 0 → null("—")
export const FeedbackStatsSchema = z.object({
  periodStart: z.coerce.date(), periodEnd: z.coerce.date(), granularity: z.literal('DAY'), timezone: z.string(),
  chatbotId: z.string().uuid(), generatedAt: z.coerce.date(),
  totals: z.object({ upCount, downCount, ratedCount, offeredCount /* int ≥0 */, positiveRate: Rate, participationRate: Rate, lowSample: z.boolean() }),
  buckets: z.array(z.object({ dayBucket: z.string(), upCount, downCount, offeredCount, positiveRate: Rate })),
  topNegativeTargets: z.array(z.object({ kind: FeedbackTargetKind, targetId: z.string().uuid().optional(), name: z.string().optional(), deleted: z.boolean(), downCount, upCount })),
  lowSampleThreshold: z.number().int(),
});
```

### 4.2 기존 스키마 확장 (전부 선택 필드 — 하위 호환)

| 파일 | 추가 | 비고 |
|---|---|---|
| `conversation.ts` | `WIDGET_FEATURE_FEEDBACK_V1 = 'feedback-v1'` · `PublicFeedbackOfferSchema = z.object({ rateable: z.literal(true) })` · `PublicMessageResponseSchema.feedback: PublicFeedbackOfferSchema.optional()`(**마지막 키**) · `PublicFeedbackRequestSchema = z.object({ sessionId: z.string().uuid(), rating: FeedbackRating })` · `PublicFeedbackResponseSchema = z.object({ rating: FeedbackRating })` | 요청 `features`는 불변(값만 추가 — 최대 5개 안) |
| `channel.ts` | `WebChannelConfigSchema.feedbackEnabled: z.boolean().optional()` | **`.default(false)` 금지**(§5.1) |
| `learning.ts` | `UnansweredSource = z.enum(['UNANSWERED','NEGATIVE_FEEDBACK'])` · `UNANSWERED_SOURCE_LABELS = { UNANSWERED: '답변 못함', NEGATIVE_FEEDBACK: '부정 평가' }` · `LEARNING_LIMITS.maxPendingNegativeFeedback: 2000` · 목록 항목 `source?: UnansweredSource`(서버는 항상 싣는다 — 없으면 UNANSWERED) · `resolvedDirectly?: true` · `lastFeedbackTarget?: FeedbackTargetRefSchema` · `lastFeedbackMatchedIntentId?: uuid` · 목록 쿼리 `source: csvEnumArray(UnansweredSource).optional()`(없음 = 전체) · 요약 `bySource?: Record<UnansweredSource, { pendingCount, limitReached }>` · 상세 `lastFeedback?: { botResponse: string(≤2000), turnAt: date, target: FeedbackTargetRefSchema, matchedIntentId?: uuid }` · `counterpart?: { id, source, status }` · `trendSource?: 'VARIANTS' \| 'FEEDBACK_LEDGER'` | `FeedbackTargetRefSchema = { kind: FeedbackTargetKind, id?: uuid, name?: string, deleted: boolean }` |
| `common.ts` | `ApiErrorCode` += `FEEDBACK_TARGET_NOT_FOUND`, `FEEDBACK_CLOSED` | — |
| `index.ts` | `feedback.ts` export | — |

> 공개 스키마 3종(`PublicFeedbackRequest/Response`, `PublicFeedbackOffer`)의 키 집합은 정적 검사가 **정확히** 단언한다(F-11 — 내부 id·텍스트·집계가 타입상 들어갈 수 없다). 요청 스키마는 기존 공개 요청과 같은 strip 모드다.

---

## 5. 기능 스위치 · 범위 (FR-FB1-\*)

### 5.1 저장 위치 확정 — WEB 채널 config 선택 키 `feedbackEnabled`

- `access.resolve()`가 요청마다 이미 읽는 `Channel(WEB).config`에서 꺼내므로 **대화 턴·평가 요청 모두 추가 조회 0**(FR-0-139 · NFR-FBP1/2).
- **선택 키**(`z.boolean().optional()`): 키 없음 = 꺼짐. `.default(false)`를 쓰면 `parseChannelConfig()`·`defaultChannelConfig()` 결과와 `GET /chatbots/:id/channels` 응답의 `config`에 `feedbackEnabled: false`가 새로 생겨 **기존 관리자 응답 바이트가 바뀐다** — 선택 키는 저장값에 키가 없는 한 파싱 결과도 바뀌지 않는다.
- 판독 함수 1벌 `readFeedbackEnabled(configJson) = (parseChannelConfig('WEB', configJson) as WebChannelConfig).feedbackEnabled === true`(파싱 실패 → 기본값 폴백 → false). 공개 대화·공개 평가가 같은 함수를 쓴다.
- 편집은 기존 `PATCH /chatbots/:chatbotId/channels/WEB`(`channel:write`) — **config는 전체 교체**이므로 콘솔 WEB 설정 폼은 `feedbackEnabled`를 항상 함께 보낸다(빠뜨리면 꺼진다 — §20 주의). WEB 채널 삭제(설정 초기화)는 스위치도 꺼진다.
- 채널은 **스냅샷 밖**(ADR-0031)이라 복원·예약 복원이 스위치를 되돌리지 않는다. 예약 배포의 `SET_WEB_CHANNEL`은 `enabled`만 바꾸므로 스위치 불변.
- 공개 `GET …/config` 응답에는 싣지 않는다(바이트 동일 — 위젯은 턴별 표식만 본다).

### 5.2 범위

- 1차 채널은 **WEB만**(FR-FB1-2). 비WEB 채널은 로그 `channelType`이 다르고 표식 판정을 호출하지 않는다.
- 끄면: 새 응답에 표식 없음 · 이미 떠 있던 버튼의 요청은 `404 FEEDBACK_TARGET_NOT_FOUND` · 저장된 원장·큐·통계는 그대로(FR-FB1-3).
- "평가는 받되 편입은 끄기" 설정은 두지 않는다(FR-FB1-4 — 2차).

---

## 6. 평가 가능 판정 · 로그 표식 (FR-FB2-\*)

### 6.1 판정 함수 — `feedback/lib/feedback-offer.ts`

```ts
export function isFeedbackOffered(input: {
  features: readonly string[] | undefined;
  webChannelConfigJson: string;
  blockedByFilter: boolean;   // 호출 지점상 항상 false(BLOCK 경로는 이 함수를 부르지 않는다) — 방어
  surveyTurn: boolean;
  handoffTurn: boolean;       // 동일(HANDLED 경로는 부르지 않는다) — 방어
}): boolean {
  if (!(input.features ?? []).includes(WIDGET_FEATURE_FEEDBACK_V1)) return false;   // ① 파싱 전 단락 — 구버전 위젯 CPU 경로 불변
  if (input.blockedByFilter || input.surveyTurn || input.handoffTurn) return false;
  return readFeedbackEnabled(input.webChannelConfigJson);
}
```

| 턴 | 반환 경로 | 표식 · `feedbackOffered` |
|---|---|---|
| 금지어 BLOCK | ②.5 조기 반환 | 없음 · false(기본 — **코드 무변경**) |
| 상담 구간(HANDLED) | ②.7 조기 반환 | 없음 · false(기본 — **코드 무변경**) |
| 설문이 입력을 소비(`surveyTurn`) | 일반 | 없음 · false |
| 설문 노출 턴·일반 답변·폴백·API 고정 문구·`NODE`/`MESSAGE` 버튼 턴 | 일반 | **있음 · true**(FR-FB2-5 — 만족도에 반영, 큐는 §10 규칙) |
| 보류 RAG 턴 | `startPendingRagAnswer` | POST 응답에 있음 · 완료 시 로그 true(READY·FAILED 모두) |

### 6.2 응답 조립 — 키 생략으로 바이트 동일

```ts
// 일반 턴 — 기존 response 객체 뒤에 조건부 전개(마지막 키)
const response: PublicMessageResponse = {
  messageId, outputs, state: result.nextState, stateReset,
  handoff: await this.buildWatchHint(chatbot.id, dto.features, isAnswered),
  ...(feedbackOffered ? { feedback: FEEDBACK_OFFER } : {}),       // FEEDBACK_OFFER = { rateable: true } as const
};
```
- 꺼진 챗봇·미선언 위젯: `feedback` 키 자체가 없다 → `JSON.stringify` 결과가 도입 전과 **바이트 동일**(AC-FB1-1). `handoff`가 `undefined`일 때 직렬화에서 빠지는 기존 동작도 그대로다.
- 판정 입력의 `channel`은 `access.resolve()`가 이미 반환하는 행이다(`const { chatbot, channel } = …` — 조회 수 동일, AC-FB1-3).

### 6.3 로그 표식 — `record()` 1곳

`RecordConversationLogParams`에 `feedbackOffered?: boolean`(기본 false)을 더하고 `create.data`에 `feedbackOffered: params.feedbackOffered ?? false`, `inputKind: params.inputKind`를 넣는다. `inputKind`는 **이미 필수 파라미터**라 모든 호출부가 값을 넘긴다 — 신규 적재 행은 전부 `TEXT`/`BUTTON_MESSAGE`/`BUTTON_NODE`다(AC-FB2-3). 로그 `update*` 0(R-10) 유지 · 수집기 호출 인자 불변.

### 6.4 보류 RAG 턴과 C-1 경쟁

- `startPendingRagAnswer({ …, feedbackOffered })` → 응답 표식 + `ragAnswer.enqueue({ …, feedbackOffered })` → `RagAnswerService`의 READY·폴백 두 `logPort.record({ …, feedbackOffered: input.feedbackOffered })`. `ConversationLogPort.record` 파라미터에 `feedbackOffered?: boolean` 추가(선택 — 기존 시험의 `objectContaining` 단언 불변).
- **C-1**(`pendingStore.complete(READY)`가 `logPort.record()`보다 먼저 — `rag-answer.service.ts` 153 → 155행): 서버 순서를 바꾸지 않는다(ADR-0023 경로 불가침 · `record()`는 마스킹 2회 + INSERT로 수 ms). 위젯이 **첫 `404`에 1초 뒤 1회 재시도**해 흡수한다(§13.5). 재시도까지 실패하면 "지금은 의견을 받을 수 없어요"(EX-FB-4 · EX-FB-3).

### 6.5 시뮬레이터 · TC · 비교 — 구조적 0건 (P-14)

시뮬레이터·비교·TC 실행은 `ConversationLogService`를 주입하지 않으므로(ADR-0030) `feedbackOffered = true`인 로그 행이 생길 수 없고, 평가 API는 로그 행을 전제로 한다 → **원장 쓰기 0**. 시뮬레이터 응답 스키마에 `feedback` 필드를 더하지 않는다(콘솔 시뮬레이터 화면 버튼 없음). F-8이 이 모듈들의 `feedback/**` import·`messageFeedback` 참조 0건을 단언한다.

---

## 7. 공개 평가 API (FR-FB3-\* · FR-FB4-1~3)

### 7.1 계약

| 항목 | 값 |
|---|---|
| 경로 | **`PUT /api/v1/public/chatbots/:slug/messages/:messageId/feedback`** — `@Public()` **8번째** · 핸들러 `PublicConversationController#submitFeedback` |
| 가드 | 컨트롤러 상속 — `PublicRateLimitGuard`(`@PublicRateBucket({ kind: 'FEEDBACK', key: { from: 'param', name: 'messageId', ns: 'msg' }, perKeyLimit: { env: 'PUBLIC_FEEDBACK_RATE_LIMIT_MESSAGE_PER_MIN', fallback: 10 } })`) → `PublicOriginGuard` |
| 요청 | `PublicFeedbackRequestSchema` `{ sessionId: uuid, rating: 'UP' \| 'DOWN' }` — 본문 오류 `400 VALIDATION_FAILED`(존재 여부와 무관한 형식 오류) |
| 응답 | `200 PublicFeedbackResponseSchema` `{ rating }` · `@Header('Cache-Control','no-store')` · `@HttpCode(200)` |
| 오류 | `404 NOT_FOUND`(없는 slug — 기존) · `403 CHATBOT_NOT_PUBLISHED｜CHANNEL_DISABLED｜ORIGIN_NOT_ALLOWED`(기존) · **`404 FEEDBACK_TARGET_NOT_FOUND`**("지금은 의견을 받을 수 없어요.") · **`409 FEEDBACK_CLOSED`**("더 이상 바꿀 수 없어요.") · `429 RATE_LIMITED`(기존) |
| 호출하지 않는 것 | 엔진·번들·의미 점수·RAG·상담 게이트·금지어 필터·설문 적재 — 봉투(`state`)를 받지도 돌려주지도 않는다(FR-FB3-5 · F-7) |

### 7.2 ★ 위조 방어 판정 순서

```
0. 가드: fb-ip:{ip}(120/분) → fb-key:msg:{messageId}(10/분) → Origin(허용 목록·헤더 없으면 통과 — ADR-0011)
1. zod 본문                                                    ─ 실패 400 VALIDATION_FAILED
2. PublicFeedbackService: access.resolve(slug)                 ─ 기존 404 NOT_FOUND / 403 3종
3.   readFeedbackEnabled(channel.config) === false             ─┐
4.   isUuid(messageId) === false                               ─┤
5. MessageFeedbackService.submit():                             │
   conversationLog.findUnique({ where: { id: messageId },       │  ★ 전부 같은
     select: { id, chatbotId, sessionId, feedbackOffered,       │    404 FEEDBACK_TARGET_NOT_FOUND
       createdAt, dayBucket, groupId, channelType, isAnswered,  │    같은 message
       answeredByRag, apiNotice, inputKind, matchedIntentId,    │    같은 로그 수준(debug · 결과 코드만)
       matchedFaqId, matchedNodeId, topicId, userMessage } })   │
6.   verifyFeedbackTarget(row, { chatbotId, sessionId }) —      │
     row 없음 ∨ chatbotId≠ ∨ sessionId≠ ∨ !feedbackOffered     ─┘
7. 원장 쓰기(§9.2) · 필요 시 편입(§9.4) → 200 { rating }
```
- ③~⑥은 **응답 코드·문구·헤더가 완전히 같다** — 존재 여부·챗봇 불일치·세션 불일치·기능 꺼짐을 구분할 수 없다(NFR-FBS1 · AC-FB3-1). ④를 ⑤보다 앞에 두는 것은 비UUID 값을 DB로 보내지 않기 위해서이며, 비UUID도 같은 404라 형식으로 존재를 흘리지 않는다.
- ⑤는 어느 분기에서든 **정확히 1회**(PK 조회)다 — 분기별 조회 수 차이로 인한 시간 오라클이 없다(③·④는 조회 전 반환이지만 그 정보는 이미 공개다: 스위치는 위젯 표식 유무로 드러나고, UUID 형식은 비밀이 아니다).
- `userMessage`(마스킹본)는 👎 편입 판정 입력으로만 쓰고, 서버 로그·오류·응답에 넣지 않는다(F-13). `botResponse`는 조회하지 않는다.
- 서버 로그: `debug` 수준으로 `chatbotId`·결과 코드만(`messageId`는 앞 8자리). `sessionId` 전체값 0(NFR-FBS4).

### 7.3 멱등 · 변경 · 기한 — `feedback-write-decision.ts`

```ts
export function decideFeedbackWrite(i: {
  existing: { rating: FeedbackRating; changeCount: number } | null;
  requested: FeedbackRating; turnCreatedAt: Date; now: Date;
  windowHours: number; maxChanges: number;
}): 'CREATE' | 'NOOP' | 'CHANGE' | 'CLOSED' {
  if (i.existing && i.existing.rating === i.requested) return 'NOOP';          // 같은 값 = 멱등(기한 지나도 200 — D-17)
  const withinWindow = i.now.getTime() <= i.turnCreatedAt.getTime() + i.windowHours * 3_600_000;
  if (!withinWindow) return 'CLOSED';
  if (!i.existing) return 'CREATE';
  return i.existing.changeCount >= i.maxChanges ? 'CLOSED' : 'CHANGE';
}
```
| 결과 | 쓰기 | 응답 |
|---|---|---|
| `CREATE` | `messageFeedback.create`(턴 사실 복사 · `targetKind/Id` = `classifyFeedbackTarget(row)`) — `P2002`(동시 최초 저장) → 원장 재조회 후 결정 1회 재실행 | 200 |
| `NOOP` | 없음 | 200 |
| `CHANGE` | `updateMany({ where: { id, changeCount: existing.changeCount, rating: existing.rating }, data: { rating, changeCount: { increment: 1 } } })` — `count = 0`(경합)이면 재조회 후 결정 1회 재실행, 그래도 0이면 `409 FEEDBACK_CLOSED`(드묾) | 200 |
| `CLOSED` | 없음 | 409 FEEDBACK_CLOSED |

- 기한 기준은 **로그 `createdAt`**(보류 RAG 턴은 완료 시각 — 사용자가 답을 본 시각에 가깝다). 취소(평가 해제) 경로 없음(FR-FB4-3).
- CAS로 `changeCount`가 **정확**하다 — 요구사항의 ±1 허용(FR-FB4-6)보다 강하다(AC-FB3-3 `changeCount=3` 결정적).

### 7.4 오류 봉투

기존 형식 `{ statusCode, code, message }` 불변. 공개 문구에 내부 용어("원장"·"큐"·"학습") 없음(FR-0-147).

---

## 8. 레이트리밋 (FR-FB4-4 · P-4)

| kind | 1축(IP) 키·한도 | 2축 키·한도 | 대화 `ip`/`session` |
|---|---|---|---|
| (없음 — 일반) | `ip:{ip}` 120 | `session:{본문 sessionId}` 30 | 소비 |
| `POLL`(기존) | `poll-ip:{ip}` `PUBLIC_POLL_RATE_LIMIT_IP_PER_MIN`(600) | `poll-key:{ns}:{key}` 스펙값 | 비소비 — **불변** |
| **`FEEDBACK`(신규)** | **`fb-ip:{ip}` `PUBLIC_FEEDBACK_RATE_LIMIT_IP_PER_MIN`(120)** | **`fb-key:msg:{messageId}` `PUBLIC_FEEDBACK_RATE_LIMIT_MESSAGE_PER_MIN`(10)** | **비소비** |

- 구현: 데코레이터 `kind` 유니온 확장 + 가드의 `consumePollBuckets()`를 `consumeDedicatedBuckets(spec)`로 일반화하고 **kind → { ipPrefix, keyPrefix, ipLimitEnv, ipLimitFallback }** 상수 표 1개로 분기한다. `POLL` 행의 값은 현재 코드와 동일 — 기존 가드 시험(`public-rate-limit.guard.spec.ts`)이 수정 없이 통과해야 한다.
- `FEEDBACK`이 `poll-ip`를 공유하지 않는 이유: 평가 폭주가 보류 답변·상담 폴링을 `429`로 만들면 안 되고, 사람 클릭 빈도(120)와 폴링 빈도(600)가 다르다(ADR-0038 §6).
- 효과: 같은 IP·세션에서 평가 버튼 40회/분 후 곧바로 질문 전송 → 전송은 `ip`·`session` 버킷이 비어 있으므로 `429`가 아니다(AC-FB3-5). 메시지 1개에 11번째 요청/분은 `429`.
- 형식이 틀린 `messageId`도 2축 버킷을 만든다(가드는 검증하지 않는다 — 기존 폴링과 같다). 메모리 저장소는 창(60초) 만료로 정리된다.

---

## 9. 평가 원장 (FR-FB5-\*)

### 9.1 쓰기 주체·최소 수집

- 쓰기 = `feedback/message-feedback.service.ts` 1파일(`create`·`updateMany` — F-2). 원장에 텍스트·`sessionId`·IP·UA 컬럼 없음(F-3). `targetKind`/`targetId`는 적재 시점의 사실이며 이후 자산이 삭제·복원돼도 바뀌지 않는다(화면이 "삭제됨"·이름 재해석 — EX-FB-14).

### 9.2 턴 사실 복사표

| 원장 컬럼 | 로그 원천 | 용도 |
|---|---|---|
| `groupId` | `groupId` | 2차 그룹·전역 만족도(AC-FB6-5 — 대화 당시) |
| `turnDayBucket` · `turnCreatedAt` | `dayBucket` · `createdAt` | 통계 기간 · 기한 판정 |
| `channelType` · `isAnswered` · `answeredByRag` · `apiNotice` · `inputKind` | 동명 | 대상 판정 · 2차 분해 |
| `matchedIntentId`·`matchedFaqId`·`matchedNodeId` · `topicId` | 동명 | 2차 의도별 👎 열 · 토픽별 |
| `targetKind` · `targetId` | `classifyFeedbackTarget(row)` | 👎 상위 대상 `groupBy` |

### 9.3 동시성 · 다중 인스턴스

- 최초 저장 경합: `conversationLogId` 유일 → 한 요청만 `create` 성공, 나머지 `P2002` → 재조회 → `NOOP` 또는 `CHANGE`(1회 재실행). 결과 원장 1행(AC-FB3-7).
- 변경 경합: `changeCount`+`rating` CAS — 마지막 커밋이 이긴다(FR-FB4-6).
- 프로세스 로컬 상태 0 — 다중 인스턴스 추가 조정 없음(EX-FB-25).

### 9.4 ★ 큐 기여 1회 — 선점 상태 기계

```
                    (rating 최종값 = DOWN ∧ queueOutcome IS NULL 인 요청만)
 null ──updateMany where queueOutcome IS NULL → 'CLAIMED' (count=1인 요청만 진행)──▶ CLAIMED
 CLAIMED ──collectNegativeFeedback() 결과──▶ QUEUED(queuedAt=now, queueItemId)
                                         ├─▶ SKIPPED(queueSkipCode)
                                         └─▶ FAILED(예외 흡수 — 재시도 없음)
```
- 트리거 조건은 **"이번 요청 뒤 원장 값이 DOWN이고 `queueOutcome`이 null"** 이다 — 최초 👎·👍→👎 변경·(드묾) 이전 요청이 저장 직후 죽은 경우의 같은 값 재요청을 모두 덮는다. 👎→👍→👎 토글은 두 번째 👎에서 `queueOutcome ≠ null`이라 큐를 다시 늘리지 않는다(AC-FB3-3 · FR-FB4-5). 👍만 받은 메시지는 영원히 null(AC-FB4-7).
- 동시 👎 두 요청은 선점 `updateMany`에서 한쪽만 `count = 1`(AC-FB3-7 · EX-FB-24).
- 수집기 실패는 `FAILED`로 남고 평가 응답은 `200`(AC-FB4-6 — `queuedAt = null`). 경고 로그 = `chatbotId` + 오류 코드(본문 0).
- 편입은 평가 요청 **안에서 await**한다(FR-FB6-6) — 응답 전에 큐가 보이므로 시험이 결정적이다.

### 9.5 봉인과의 관계 · 영구삭제 사전검사

- **"대화로그 삭제 경로 0"(ADR-0033)과의 관계**: 원장은 로그의 **파생이 아니라 별도 원천**(사용자 판단 기록)이다. 로그처럼 삭제 경로 0 · FK `Restrict` · 영구삭제 사전검사 대상으로 **같은 3층 봉인**을 받는다(L1 FK · L2 사전검사 `답변 평가` · L3 `feedback-sealing.spec.ts`). 원장은 로그 행 없이는 생길 수 없으므로 원장이 있는 챗봇은 반드시 로그가 있고, 로그가 이미 영구삭제를 막는다 → **차단 집합은 실질적으로 변하지 않는다**(사전검사 추가는 방어·표시 목적 — ADR-0019 92행과 같은 논리).
- 향후 로그 삭제 경로(No.45)가 생기면 원장도 **같은 단일 서비스 + 롤업 선적재** 규약을 따른다(평가 롤업 = `(chatbotId, turnDayBucket, targetKind, targetId)` 키의 👍/👎 건수 + `groupId` — 텍스트 0).
- 사전검사: `CHILD_COUNT_LABELS.messageFeedbacks = '답변 평가'`(14 → 15종) · 영구삭제 트랜잭션에 `messageFeedback.delete*` 추가 금지(F-5).
- 버전 스냅샷·챗봇 복사·토픽 분리 대상 아님(FR-FB5-5 — F-8이 해당 모듈의 참조 0건 단언).

---

## 10. 학습현황 큐 편입 (FR-FB6-\*)

### 10.1 쓰기 주체 — 파일 집합 불변(3파일)

`prisma.unansweredQuestion` 쓰기 파일은 현재 **3개**다 — `learning/unanswered-collector.service.ts`(수집) · `learning/unanswered-questions.service.ts`(상태 전이) · `learning/decomposed-resolve.service.ts`(No.23 요소분해 반영의 CAS 전이, 119행). ADR-0019 45행·요구사항 FR-FB10-1 ⑨의 "2곳"은 No.23 이후 사실과 다르다. 이 그룹은 이 **3파일 집합을 바꾸지 않으며**(편입은 수집기의 두 번째 진입 메서드, 직접 수정 완료는 상태 전이 서비스) F-9가 정확한 집합을 단언한다.

### 10.2 편입 판정 — `learning/lib/collect-decision.ts` (규칙 1벌 공유)

```ts
export type NegativeFeedbackSkipCode = 'ALREADY_UNANSWERED' | 'API_NOTICE' | 'BUTTON_NODE' | 'EMPTY' | 'TOO_LONG' | 'LIMIT_REACHED';

/** 정규화·빈 입력·장문 판정 1벌 — shouldCollect()와 shouldQueueNegativeFeedback()이 공유한다(복제 금지, NFR-FBM2). */
function normalizeQueueCandidate(text: string, maxLength: number):
  { ok: true; normalized: string } | { ok: false; reason: 'EMPTY' | 'TOO_LONG' }

export function shouldQueueNegativeFeedback(i: {
  isAnswered: boolean; apiNotice: boolean; inputKind: string | null; questionText: string; maxLength: number;
}): { queue: true; normalized: string } | { queue: false; reason: Exclude<NegativeFeedbackSkipCode, 'LIMIT_REACHED'> } {
  if (i.apiNotice) return { queue: false, reason: 'API_NOTICE' };               // 외부 장애 — 학습 공백 아님(ADR-0034 §5)
  if (!i.isAnswered) return { queue: false, reason: 'ALREADY_UNANSWERED' };      // 폴백은 이미 UNANSWERED로 수집됨
  if (i.inputKind !== 'TEXT' && i.inputKind !== 'BUTTON_MESSAGE') return { queue: false, reason: 'BUTTON_NODE' }; // null 포함 — 보수적
  const n = normalizeQueueCandidate(i.questionText, i.maxLength);
  return n.ok ? { queue: true, normalized: n.normalized } : { queue: false, reason: n.reason };
}
```
- `shouldCollect()`의 공개 동작·사유 순서는 **불변**이다(내부에서 같은 `normalizeQueueCandidate`를 호출하도록만 바꾼다 — `collect-decision.spec.ts` 무수정 통과).
- BLOCK·설문·상담 턴은 `feedbackOffered = false`라 평가 자체가 불가능해 이 함수에 도달하지 않는다(§7.2 ⑥). `inputKind = null`은 `feedbackOffered = true`와 같은 마이그레이션에서 생긴 컬럼이라 **구조적으로 도달하지 않는다**(방어 규칙).
- `BUTTON_MESSAGE`(메시지 버튼·퀵리플라이 텍스트)는 편입한다 — 미응답 수집과 같은 규칙(사용자 문장으로 간주).
- 👍는 판정 대상이 아니다(§9.4 트리거가 DOWN일 때만).

### 10.3 수집기 두 번째 진입점 — `UnansweredCollectorService.collectNegativeFeedback()`

```ts
async collectNegativeFeedback(input: {
  chatbotId: string; channelType: string;
  questionText: string;            // ★ ConversationLog.userMessage(마스킹본) — 원문 재접촉 0(ADR-0019 §2 근거 유지)
  isAnswered: boolean; apiNotice: boolean; inputKind: string | null;
  conversationLogId: string;       // → lastFeedbackLogId
}): Promise<{ kind: 'QUEUED'; id: string } | { kind: 'SKIPPED'; code: NegativeFeedbackSkipCode } | { kind: 'FAILED' }>   // 예외를 던지지 않는다
```
1. `shouldQueueNegativeFeedback()` → 제외면 `SKIPPED`.
2. `findUnique({ chatbotId_source_questionNormalized: { chatbotId, source: 'NEGATIVE_FEEDBACK', questionNormalized } })`.
3. 있으면 **병합**(기존 `mergeIntoExisting` 규칙 그대로 + `lastFeedbackLogId` 갱신): `occurredCount +1`(= 👎 기여 수) · `variants` · `lastOccurredAt` · `RESOLVED`/`IGNORED`면 상태 유지 + `recurredCount +1`·`recurredAfterAt`(자동 재오픈 없음 — AC-FB4-3).
4. 없으면 **소스별 상한** 검사 `count({ chatbotId, source: 'NEGATIVE_FEEDBACK', status: 'PENDING' }) ≥ FEEDBACK_QUEUE_MAX_PENDING` → `SKIPPED LIMIT_REACHED`(경고 로그 — 기존 행 증가는 계속, AC-FB4-4 · EX-FB-16).
5. `create({ source: 'NEGATIVE_FEEDBACK', questionText, questionNormalized, variants, occurredCount: 1, lastOccurredAt, channelType, lastFeedbackLogId })` · `P2002` → 같은 키로 1회 병합(기존 규칙).
6. 전체 try/catch → `FAILED`(경고 로그 본문 0).

**기존 `collect()`의 변경(동작 불변 — 커밋 ①)**: 조회·P2002 재시도 키를 `chatbotId_source_questionNormalized`(`source: 'UNANSWERED'`)로, `create.data.source = 'UNANSWERED'`를 명시, 상한 계수에 `source: 'UNANSWERED'` 조건. 도입 전 행은 전부 `UNANSWERED`라 결과가 같다(`unanswered-collector.service.spec.ts` 무수정 통과 — 호출 횟수·`occurredCount` 증가만 단언한다).

### 10.4 소스별 상한 (FR-FB6-7)

| 소스 | 상한 | 도달 시 |
|---|---|---|
| `UNANSWERED` | `UNANSWERED_MAX_PENDING`(5,000 — 계수 조건만 소스별로) | 미응답 신규 중단 · 부정 평가 편입 계속 |
| `NEGATIVE_FEEDBACK` | `FEEDBACK_QUEUE_MAX_PENDING`(2,000) | 부정 평가 신규 중단(원장 `SKIPPED LIMIT_REACHED`) · 미응답 수집 계속 |

### 10.5 저장값 = 마스킹본 (AC-FB4-5)

큐 `questionText`는 로그 `userMessage` 문자열을 그대로 쓴다(재마스킹 없음 — 이미 금지어 → PII 순으로 마스킹됨, EX-FB-7). 픽스처 "010-1234-5678" → 로그 "010-****-5678" → 큐 동일.

### 10.6 ★ 발견 제약 ① — No.14 질문 순위 딥링크의 소스 충돌

`stats.service.ts#getQuestions()` 312행은 미응답 순위의 정규화 질문으로 큐 id를 붙이는데 `where`에 소스가 없다. 소스 분리 후 같은 정규화 질문이 `NEGATIVE_FEEDBACK` 행으로도 존재하면(처음엔 미응답 → 반영 → 이번엔 오답 👎 — §1.6.2 요구사항 시나리오 그대로) `new Map(matches…)`의 **마지막 행이 이겨** 미응답 순위가 부정 평가 항목으로 링크될 수 있다. **`where`에 `source: 'UNANSWERED'` 1개를 추가**한다(커밋 ① — 도입 전 행은 전부 UNANSWERED라 응답 바이트 불변, AC-FB6-4 유지). `getDashboard()`는 큐를 읽지 않으므로 무변경이다.

---

## 11. 학습현황 콘솔 API · 표시 (FR-FB7-\*)

### 11.1 목록 `GET /chatbots/:chatbotId/unanswered-questions`

- 쿼리 `source?: csv(UNANSWERED｜NEGATIVE_FEEDBACK)` — **없으면 전체**(기존 호출은 두 소스를 함께 받는다 — AC-FB5-1의 "기존 항목 결과가 도입 전과 같다"는 기존 행 집합·순서의 불변을 뜻한다). 정렬·페이지네이션 규약 불변(발생 수 desc → `lastOccurredAt` desc).
- 항목: `source`(항상) · NEGATIVE_FEEDBACK 행만 `lastFeedbackTarget`(유형·id·이름·삭제됨) · `lastFeedbackMatchedIntentId`(추천 "현재 매칭" 배지 기준) · `resolvedDirectly: true`(직접 수정 완료 행). **답변 본문은 목록에 없다**(FR-FB7-2).
- **N+1 금지(NFR-FBP5 · AC-FB5-6)**: 페이지에 NEGATIVE_FEEDBACK 행이 있을 때만 요청당 **고정 3쿼리** — ① `conversationLog.findMany({ id in lastFeedbackLogIds }, select 매칭 id·판정 컬럼)` ② `faqEntry.findMany({ id in … }, select id·대표 질문)` ③ `dialogNode.findMany({ id in … }, select id·name)`. 의도 이름은 이미 로드한 추천 후보 집합(`loadSuggestionCandidates`)에서 해석한다(추가 0). 대상 판정은 `classifyFeedbackTarget()`. 없는 id = `deleted: true`(EX-FB-14 — ID 보존 복원으로 돌아오면 다시 이름).
- 추천(`suggestions`)은 기존 우선순위 그대로(분류기 → 문자 유사도, ADR-0027 — 신규 연산 0). "현재 매칭" 배지는 **콘솔이** `suggestion.intentId === lastFeedbackMatchedIntentId`로 표시한다(서버 필드 추가 0).

### 11.2 요약 `GET …/unanswered-questions/summary`

- `groupBy({ by: ['source'], where: { chatbotId, status: 'PENDING' }, _count })` **1쿼리**(기존 `count` 1쿼리 대체 — 쿼리 수 불변).
- `pendingCount` = 두 소스 합계(탭 배지) · `limitReached` = **`UNANSWERED` 상한 도달**(기존 의미 유지 — 도입 전과 같은 값) · `bySource` = `{ UNANSWERED: { pendingCount, limitReached }, NEGATIVE_FEEDBACK: { pendingCount, limitReached } }`(선택 필드 — 서버는 항상 싣는다, AC-FB5-5).

### 11.3 직접 수정 완료 `POST …/unanswered-questions/:id/mark-addressed` (FR-FB7-6)

| 항목 | 값 |
|---|---|
| 권한 | `dialogue:write`(VIEWER·AGENT `403`) |
| 본문 | 없음(`{}` 허용) |
| 전제 | `assertWritable`(보관 챗봇 `409 CHATBOT_ARCHIVED`) · 항목 없음/교차 챗봇 `404` · **`source ≠ NEGATIVE_FEEDBACK` → `400 INVALID_STATUS_TRANSITION`**("답변 못함 항목은 반영(예문 추가)으로 처리해 주세요.") |
| 전이 | `updateMany({ where: { id, chatbotId, status: 'PENDING', source: 'NEGATIVE_FEEDBACK' }, data: { status: 'RESOLVED', resolvedIntentId: null, resolvedAt: now, resolvedById: actorId } })` — `count = 0` → `409 ALREADY_RESOLVED` |
| 응답 | `200 UnansweredQuestionListItem`(`resolvedDirectly: true`) |
| 부수효과 | 의도·예문·번들·`applyLearning()` **0** · 감사 **0**(ADR-0019 §6) |
| 재오픈 | 기존 `reopen` 그대로(`resolvedIntentId` 이력 보존 규칙 동일) |
| 일괄 | **1차 단건만**(FR-FB7-6 권고 채택) |

### 11.4 상세 `GET …/unanswered-questions/:id` — NEGATIVE_FEEDBACK 확장

- `lastFeedback` = 로그 `lastFeedbackLogId` 행의 `botResponse`(마스킹본 · **2,000자 절단**) · `createdAt` · 대상(유형·id·이름·삭제됨) · `matchedIntentId`. 로그 PK 1 + 이름 1(대상 유형에 맞는 테이블 1개) 쿼리.
- `counterpart` = 같은 `(chatbotId, questionNormalized)`의 다른 소스 행 `{ id, source, status }`(유일 키 조회 1회 — FR-FB7-5 · EX-FB-22). UNANSWERED 상세에서도 부정 평가 항목이 있으면 싣는다.
- **추이(`trend`)**: NEGATIVE_FEEDBACK 항목은 `variants` 기반 근사 대신 **원장 `groupBy({ by: ['turnDayBucket'], where: { queueItemId: id, turnDayBucket ≥ 시작 } })`** — 이 항목에 기여한 👎를 정확히 센다(`trendApproximated: false`, `trendSource: 'FEEDBACK_LEDGER'`). UNANSWERED 항목은 기존 방식 불변(`trendSource: 'VARIANTS'`).
- `learning`은 원장을 **Prisma 읽기**로만 쓴다(`feedback` 모듈 import 0).

### 11.5 기존 처리의 동작 (FR-FB7-8)

반영(예문 추가)·무시·재오픈·일괄 반영·요소분해 반영은 부정 평가 항목에도 **그대로** 동작한다. 반영 감사 summary만 소스 라벨을 반영한다 — UNANSWERED는 **기존 문자열 불변**("학습현황 반영 (미응답 N건)"), NEGATIVE_FEEDBACK 단건은 "학습현황 반영 (부정 평가 1건)"(일괄은 섞일 수 있어 기존 문자열 유지). "현재 매칭 의도로 반영" 경고는 콘솔 전용(차단 아님 — AC-FB5-3).

---

## 12. 만족도 통계 (FR-FB8-\* · P-10)

### 12.1 엔드포인트

`GET /stats/feedback?chatbotId&from&to&topN` — `StatsController#getFeedbackStats`(기존 컨트롤러 — 컨트롤러 수 불변) · `chatbot:read`(VIEWER·EDITOR·ADMIN·AGENT) · `ARCHIVED` 허용 · 기간 = `resolveStatsPeriodOrThrow(from, to, 'DAY', limits)`(No.14 규약 — KST `dayBucket`·범위 상한 92일·`400 STATS_RANGE_TOO_WIDE`) · `runWithAggregationTimeout`(5초 초과 `503`) · 원시 SQL 0.

### 12.2 쿼리 계획 (기간·대상 수와 무관한 고정 수)

| # | 쿼리 | 인덱스 |
|---|---|---|
| 0 | `chatbotsService.existsById`(기존) | PK |
| 1 | `messageFeedback.groupBy({ by: ['turnDayBucket','rating'], where: { chatbotId, turnDayBucket: {gte,lte} }, _count })` | `(chatbotId, turnDayBucket)` |
| 2 | `conversationLog.groupBy({ by: ['dayBucket'], where: { chatbotId, dayBucket: {gte,lte}, feedbackOffered: true }, _count })` | `(chatbotId, dayBucket)` |
| 3 | `messageFeedback.groupBy({ by: ['targetKind','targetId','rating'], where: 1과 동일, _count })` | 동일 |
| 4~6 | 👎 상위 N개 대상의 이름 — `intent`·`faqEntry`·`dialogNode` `findMany({ id in … })`(해당 유형이 있을 때만) | PK |

→ **최대 7쿼리 고정**(1~3은 `Promise.all`). 요구사항 NFR-FBP4의 "≤4"는 이름 해석·존재 확인을 세지 않은 수치다 — 반환 행 수가 원장 행 수와 무관(버킷 × 2 · 대상 × 2)하다는 성질은 유지한다(§25 D-12).

### 12.3 지표 정의 — `stats/lib/feedback-stats.ts#foldFeedbackStats()`(순수)

| 지표 | 식 | 분모 0 |
|---|---|---|
| `upCount`·`downCount`·`ratedCount` | 원장 `rating`별 합(현재 값만 — 변경 이력 아님) | — |
| `offeredCount` | 로그 `feedbackOffered = true` 턴 수 | — |
| `positiveRate` | `up / (up + down)` | `null` |
| `participationRate` | `ratedCount / offeredCount`(≤ 1 보장 — 원장은 `feedbackOffered` 턴에만 생기고 `turnDayBucket` = 로그 `dayBucket`) | `null` |
| `lowSample` | `ratedCount < 30` | — |
| `buckets[]` | 기간 전 일자(빈 날 0 채움 — `buildBuckets` 재사용) · 일별 `positiveRate` | `null` |
| `topNegativeTargets[]` | `(targetKind, targetId)`별 👎·👍 → 👎 desc, 👍 asc, `targetKind`, `targetId` 순 정렬 상위 N · `FALLBACK`/`RAG`/`API_NOTICE`/`OTHER`는 id 없는 단일 행 · 이름 없음 = `deleted: true` | — |

- **질문 문장은 어디에도 없다**(원장에 텍스트 컬럼이 없다 — 구조적, AC-FB6-3). 큐로 이동하는 링크는 콘솔이 `source=NEGATIVE_FEEDBACK` 필터로 만든다.
- 대시보드(No.2)·`/stats/summary｜distribution｜questions｜intents`·No.29 응답·순수 함수 **무변경**(AC-FB6-4 — `questions`는 §10.6의 조건 1개만, 결과 불변).
- AC-FB6-1 고정 픽스처(평가 제공 턴 200 · 👍 30 · 👎 10) → `positiveRate 0.75` · `participationRate 0.2` · `ratedCount 40`.

---

## 13. 위젯 변경 (FR-FB9-\* · P-12)

### 13.1 파일

| 파일 | 변경 |
|---|---|
| `constants/feedback.ts`(신규) | `WIDGET_FEATURE_FEEDBACK_V1 = 'feedback-v1'`(shared-types 값과 동치 — `constants/handoff.spec.ts`와 같은 동치 시험 **신규**) |
| `constants/messages.ts` | `feedback: { groupLabel: '답변 평가', up: '도움이 됐어요', down: '도움이 안 됐어요', thanks: '의견을 보내 주셔서 고마워요', saveFailed: '저장하지 못했어요', unavailable: '지금은 의견을 받을 수 없어요', locked: '더 이상 바꿀 수 없어요' }` |
| `api/public-client.ts` | `sendMessage` 본문 `features: [WIDGET_FEATURE_HANDOFF_V1, WIDGET_FEATURE_FEEDBACK_V1]` · 신규 `submitFeedback(messageId, { sessionId, rating })` = `PUT /messages/:id/feedback` |
| `core/feedback.ts`(신규 · 순수) | `planFeedbackAttempt(result, attempt)` · `nextFeedbackView(state, event)` — DOM·fetch 무의존(§13.5) |
| `ui/feedback-bar.ts`(신규 · DOM) | 버튼 2개 막대 생성·상태 반영 |
| `ui/message-list.ts` | `addBotOutputs(views, onButtonAction, onTyping?, buttonGroupOptions?, feedback?)` · `addBotAnswer(messageId, views, sources, onButtonAction, feedback?)` — **선택 인자 추가만**(기존 호출 동작 불변). `feedback = { messageId, onRate }`가 있을 때만 렌더 완료 후 말풍선 **밖**(`.cb-msg` 안 · `.cb-bubble` 다음)에 막대를 붙인다 |
| `ui/app.ts` | 일반 턴: `res.feedback?.rateable`이면 `addBotOutputs(…, { messageId: res.messageId, onRate })` · 보류 턴: `pendingFeedback = res.feedback?.rateable === true`를 `pollPendingAnswer`에 전달 → **READY·FAILED 최종 말풍선에만** · 인사말·퀵리플라이·대기 문구·로컬 정리 문구(`EXPIRED`/`TIMEOUT`)·시스템·오류·상담원 말풍선에는 **없음** |
| `styles.ts` | 막대 스타일(대비 4.5:1 · 아이콘 3:1 · 포커스 표시 · 선택 상태 시각 2중 표시) |

### 13.2 표시 규칙

- 버튼은 **서버가 `feedback.rateable`을 준 봇 말풍선에만**(FR-FB9-3 · AC-FB7-1). 위젯이 스스로 평가 가능성을 추정하지 않는다.
- 상담 구간(`outputs: []`)은 말풍선이 없고 서버 표식도 없다.
- 평가 상태는 **DOM에만** — `sessionStorage`·`localStorage` 0(FR-FB9-7 · F-16). 새로고침하면 말풍선이 사라지므로 복원 대상이 없다.

### 13.3 `messageId` 연결

`addBotOutputs`는 지금 `messageId`를 받지 않고 `addBotAnswer`는 받지만 쓰지 않는다(`_messageId`). 평가 막대의 `data` 속성·클로저로 `messageId`를 보관하고, `WidgetMessage` 스토어 타입은 바꾸지 않는다(스토어는 말풍선 목록을 관리하지 않는다 — DOM이 원천).

### 13.4 접근성 (NFR-FBA · `UIUX_준수기준.md`)

- `<div role="group" aria-label="답변 평가">` 안 네이티브 `<button type="button">` 2개 — 아이콘(`aria-hidden="true"`) + **보이는 텍스트 또는 시각적 숨김 텍스트**의 접근 이름("도움이 됐어요"/"도움이 안 됐어요") · **`aria-pressed`** + 시각 표시 2중(색 단독 금지) · 터치 영역 **44×44px 이상**(UIUX 26행) · 포커스 표시.
- 선택·실패 안내는 **`#cb-status`(polite) 1회**(`panel.setStatusText`) — 2초 뒤 **자기 문구일 때만** 비운다(다른 상태 문구를 지우지 않는다). 메시지 목록(`role="log"`, `aria-relevant="additions"`)에 **새 노드를 추가하지 않는다** — 상태 변화는 속성(`aria-pressed`·`disabled`)만 바꾸고, 버튼 옆 작은 문구("저장하지 못했어요" 등)는 **처음부터 존재하는 `aria-hidden="true"` 요소의 텍스트**만 바꾼다(스크린리더는 `#cb-status`로 듣는다 — AC-FB7-2).
- 평가 후 **포커스 이동 없음**(입력창 포커스 유지). 요청 중에는 막대에 `aria-busy="true"`, 추가 클릭은 무시한다.
- 막대 자체가 말풍선 추가 낭독에 함께 읽히는지(스크린리더별 차이)는 ui-designer가 NVDA·VoiceOver로 확인해 **말풍선당 최대 1회**로 제한하는 표현(보이는 텍스트 vs 시각적 숨김 텍스트)을 고른다. 긴 대화의 탭 이동 부담(말풍선당 2정지)도 ui-designer 판단(로빙 탭 등 — NFR-FBA3).

### 13.5 동작 · 재시도 — `core/feedback.ts`

```ts
type FeedbackAttemptResult = 'OK' | 'NOT_FOUND' | 'CLOSED' | 'RATE_LIMITED' | 'NETWORK' | 'SERVER' | 'DISABLED';
export function planFeedbackAttempt(r: FeedbackAttemptResult, attempt: 1 | 2):
  | { action: 'DONE_OK' }
  | { action: 'RETRY'; delayMs: 1000 }
  | { action: 'DONE_FAIL'; notice: 'SAVE_FAILED' | 'UNAVAILABLE' | 'LOCKED' | 'SILENT'; disable: boolean }
```
| 결과 | 1회차 | 2회차 | 표시 |
|---|---|---|---|
| `200` | 완료 | — | 선택 확정 · `#cb-status` "의견을 보내 주셔서 고마워요" |
| `404`(FEEDBACK_TARGET_NOT_FOUND·NOT_FOUND) | **1초 뒤 재시도**(C-1 흡수) | 실패 | "지금은 의견을 받을 수 없어요" · 버튼 비활성 · 선택 해제 |
| 네트워크·5xx | 1초 뒤 재시도 | 실패 | 직전 확정 값으로 되돌림 · "저장하지 못했어요" |
| `409` FEEDBACK_CLOSED | 재시도 없음 | — | 직전 확정 값 유지 · "더 이상 바꿀 수 없어요" · 버튼 비활성 |
| `429` | 재시도 없음 | — | 조용히 직전 확정 값으로(SILENT) |
| `403`(비공개·채널 닫힘) | 재시도 없음 | — | "지금은 의견을 받을 수 없어요" · 비활성(대화 쪽 `DISABLED` 처리는 기존 경로) |

- 클릭 → 즉시 선택 표시(낙관적) → 결과 반영. **선택된 버튼 재클릭 = 무동작**(취소 없음). 다른 버튼 = 변경 요청(FR-FB9-5·6).
- 모달·오류 말풍선·입력 잠금 없음(AC-FB7-3 — 대화 전송은 평가와 독립).
- 평가 요청은 사용자 클릭에만 발생(폴링 0 — NFR-FBP6). 보류·상담 폴링 코드와 독립(NFR-FBM3).

### 13.6 번들 예산

vanilla · 런타임 의존성 0 · **gzip 100KB 게이트**(`scripts/check-bundle-size.mjs`). 예상 증가 +1~2KB — 빌드 로그로 증가분을 보고한다(AC-FB7-5). ADR-0012 Preact 재검토 트리거 미발동.

---

## 14. 권한 (P-15 — 신규 권한 0 · 신규 역할 0)

| 동작 | 권한 | 역할 결과 |
|---|---|---|
| 공개 평가 | 없음(`@Public()` · 결합 검증 · 전용 버킷 · Origin) | — |
| 스위치 편집 | 기존 `channel:write` | ADMIN·EDITOR |
| 학습현황 조회(소스 필터·상세 포함) | 기존 `dialogue:read` | ADMIN·EDITOR·VIEWER(AGENT 403) |
| 직접 수정 완료 | 기존 `dialogue:write` | ADMIN·EDITOR(VIEWER·AGENT 403 — AC-FB5-4) |
| 만족도 통계 | 기존 `chatbot:read` | ADMIN·EDITOR·VIEWER·AGENT(AC-FB8-1) |

`Permission` 17종 · 역할 4종 · `ROLE_PERMISSIONS` 불변.

## 15. 감사 (P-15 — `AuditTargetType`·`AuditAction` 추가 0)

- 평가 저장·변경·큐 편입·직접 수정 완료: **기록하지 않는다**(사용자 응답 비감사 — ADR-0035 · 큐 상태 비감사 — ADR-0019 §6. 기록하면 `targetName`에 사용자 발화가 들어간다).
- 스위치 변경: 기존 `Channel UPDATE` 1건(화이트리스트 `type`·`enabled` 불변). `feedbackEnabled` 값이 바뀌면 summary `답변 평가 받기 변경: false → true`(기존 `사용 여부 변경: …`와 함께 바뀌면 ` · `로 합성). 설정 본문·원문 0(AC-FB8-2).

---

## 16. API 계약 요약

### 16.1 신규 엔드포인트 (공개 1 · 관리자 2)

| # | 메서드·경로 | 권한 | 요청 → 응답 |
|---|---|---|---|
| 1 | `PUT /public/chatbots/:slug/messages/:messageId/feedback` | `@Public()`(8번째) | `PublicFeedbackRequest` → `200 { rating }` |
| 2 | `POST /chatbots/:chatbotId/unanswered-questions/:id/mark-addressed` | `dialogue:write` | — → `200 UnansweredQuestionListItem` |
| 3 | `GET /stats/feedback?chatbotId&from&to&topN` | `chatbot:read` | `FeedbackStatsQuery` → `200 FeedbackStats` |

### 16.2 기존 경로 확장

| 경로 | 확장 |
|---|---|
| `POST /public/chatbots/:slug/messages` | 요청 `features`에 `'feedback-v1'` 값 · 응답 선택 필드 `feedback?: { rateable: true }`(없으면 바이트 동일) |
| `PATCH /chatbots/:chatbotId/channels/WEB` | `config.feedbackEnabled?` |
| `GET …/unanswered-questions` | 쿼리 `source?` · 항목 `source`·`lastFeedbackTarget?`·`lastFeedbackMatchedIntentId?`·`resolvedDirectly?` |
| `GET …/unanswered-questions/summary` | `bySource?` |
| `GET …/unanswered-questions/:id` | `lastFeedback?`·`counterpart?`·`trendSource?` |
| `POST /chatbots/:id/permanent-delete` | 사전검사 15종(`답변 평가`) |

### 16.3 오류 코드 (`ApiErrorCode` 신규 2종)

| 코드 | 상태 | 발생 | 공개 문구 |
|---|---|---|---|
| `FEEDBACK_TARGET_NOT_FOUND` | 404 | 기능 꺼짐 · 비UUID · 로그 없음 · 챗봇/세션 불일치 · 평가 불가 턴 — **구분하지 않는다** | "지금은 의견을 받을 수 없어요." |
| `FEEDBACK_CLOSED` | 409 | 기한(24시간) 경과 후 저장·변경 · 변경 5회 초과 | "더 이상 바꿀 수 없어요." |

직접 수정 완료의 소스 불일치는 기존 `INVALID_STATUS_TRANSITION`(400), 이미 처리됨은 기존 `ALREADY_RESOLVED`(409)를 재사용한다. 대화 경로(`POST …/messages`)는 두 코드를 쓰지 않는다.

---

## 17. 봉인 · 정적 검사 — `apps/api/src/feedback/lib/feedback-sealing.spec.ts`

형식은 `topic-sealing.spec.ts`와 같다(스캔 루트 지정 · 자기 자신 제외 · 스캔 대상 0건 아님 먼저 단언 · 주석 줄 제외 · 역검증 픽스처).

| # | 단언 | 근거 |
|---|---|---|
| F-1 | `apps/api/src`에 `messageFeedback.delete｜deleteMany` 0건 · 원시 `DELETE FROM "message_feedbacks"` 0건 | FR-FB5-4 · ADR-0033 |
| F-2 | `messageFeedback.(create｜createMany｜update｜updateMany｜upsert)` 호출 파일 = `feedback/message-feedback.service.ts` **1개** | FR-0-141 |
| F-3 | `schema.prisma` `model MessageFeedback` 블록의 필드 이름 집합 = §3.1 허용 목록과 **정확히 같다** · `sessionId`·`ip`·`userAgent` 부재 | FR-FB5-2 · NFR-FBS3 |
| F-4 | `MessageFeedback.chatbot` 관계 `onDelete: Restrict` · 블록에 `Cascade｜SetNull` 0 | FR-FB10-1 ④ |
| F-5 | `chatbots.service.ts` 사전검사 `counts` 블록에 `messageFeedbacks` · `CHILD_COUNT_LABELS`에 `'답변 평가'` · 영구삭제 트랜잭션에 `messageFeedback` 삭제 0 | FR-FB5-4 |
| F-6 | `*.controller.ts` 전체 `@Public()` **8** · `submitFeedback(` 앞에 `@Public()`·`@PublicRateBucket(`·`kind: 'FEEDBACK'` | FR-0-140 |
| F-7 | `feedback/**` · `conversation/public-feedback.service.ts`에 `@chat-bot/dialogue-engine`·`/rag/`·`/handoff/`·`/embedding/`·`/survey-responses/`·`/dialogue-common/` import 0 · `DialogueBundleService`·`resolveTurn` 심볼 0 | FR-FB3-5 · AC-FB3-8 |
| F-8 | `simulation｜validation｜versions｜deploy-schedules｜topics｜asset-transfer/**`에 `feedback/` import 0 · `messageFeedback` 토큰 0 | FR-0-143 · P-14 |
| F-9 | `prisma.unansweredQuestion` 쓰기 호출 파일 집합 = {`learning/unanswered-collector.service.ts`, `learning/unanswered-questions.service.ts`, `learning/decomposed-resolve.service.ts`} **정확히 3** | FR-0-141(정정 — §10.1) |
| F-10 | `conversationLog.(update｜updateMany｜upsert)` 0(R-10 재확인) · `conversation-log.service.ts` `create.data`에 `feedbackOffered:`·`inputKind:` 키 존재 | FR-FB2-3 |
| F-11 | 런타임: `PublicFeedbackResponseSchema` 키 = {`rating`} · `PublicFeedbackRequestSchema` 키 = {`sessionId`,`rating`} · `PublicFeedbackOfferSchema` 키 = {`rateable`} · `PublicMessageResponseSchema.feedback` 선택 | FR-FB3-3 · NFR-FBS2 |
| F-12 | `packages/dialogue-engine/src`에 `feedback` 심볼(대소문자 무관) 0 | FR-0-138 |
| F-13 | `feedback/**`·`conversation/public-feedback.service.ts`의 `logger.`·`Logger` 호출 줄에 `userMessage`·`botResponse`·`questionText`·`sessionId` 0 | FR-0-142 · NFR-FBS4 |
| F-14 | `stats/feedback/**` Prisma 쓰기 0 · `$queryRaw` 0(R-7 보유 파일 4 불변) | R-7 · R-8 |
| F-15 | `collectNegativeFeedback(` 호출 파일 = `feedback/message-feedback.service.ts` 1개 | FR-FB6-2 |
| F-16 | `apps/widget/src/{core/feedback.ts, ui/feedback-bar.ts}`에 `sessionStorage`·`localStorage` 0 | FR-FB9-7 |
| 역검증 | F-1·F-2·F-3·F-9 패턴이 픽스처 문자열의 위반을 실제로 검출한다 | NFR-FBS6 |

---

## 18. 성능 예산 (NFR-FBP)

| 항목 | 예산 | 근거 |
|---|---|---|
| 기능 꺼짐·미선언 위젯 공개 대화 | **불변**(P95 500ms · 추가 조회 0 · 응답 바이트 동일) | `features` 단락 판정 — 설정 파싱조차 없음 |
| 기능 켜짐 대화 턴 | 추가 조회 0 · 설정 파싱 0.1ms 이내 · 응답 +24바이트 | `access.resolve()` 행 재사용 |
| 공개 평가 API | **P95 100ms**(일반 = 가드 메모리 + Origin·접근 판정(기존 쿼리) + 로그 PK 1 + 원장 조회 1 + 쓰기 1 / 첫 👎 = + 선점 1 + 큐 2~3 + 확정 1) | NFR-FBP3 |
| 대화 전송 P95에 평가 부하 영향 | 0(버킷·경로 분리) | AC-FB3-5 |
| 만족도 통계 | **P95 1초**(92일 · 원장 10만 · 로그 100만 행) · 쿼리 ≤7 고정 · 반환 행 = 버킷×2 + 대상×2 | §12.2 |
| 학습현황 목록 | 기존 500ms 유지 — NEGATIVE_FEEDBACK 행 존재 시 +3쿼리 고정(N+1 없음) | AC-FB5-6 |
| 학습현황 상세 | 기존 + 4쿼리(로그 PK · 이름 1 · 대응 소스 1 · 원장 추이 1) | §11.4 |
| 요약 | 쿼리 수 불변(`count` → `groupBy` 1) | §11.2 |
| 위젯 | gzip +2KB 이하 · 100KB 게이트 | §13.6 |
| 마이그레이션 | `conversation_logs` ADD COLUMN O(1) · 인덱스 교체 O(큐 행) — 100만 로그 행 DB 소요 실측 기록 | NFR-FBP7 · §3.2 |

---

## 19. 다른 기능과의 경계

| 기능 | 관계 |
|---|---|
| No.15 학습현황 | 입력 소스 1종 추가 + 직접 수정 완료 전이 1개. 미응답 수집·반영 흐름 **불변**(커밋 ① 무회귀) |
| No.23 분류기 · No.16 증강 | 수정 0 — 부정 평가 항목에도 기존 추천 우선순위 |
| No.27 설문 | 다른 기능 — 설문은 노드 배치형 대화 단위 조사(응답은 대화 턴), 평가는 모든 답변의 이진 신호 → 큐. 설문 소비 턴은 평가 불가 · 설문 결과는 큐에 넣지 않는다 · 설문 노출 턴은 평가 가능 |
| No.24 하이브리드 CS | 상담 구간 턴·상담원 메시지 평가 없음 · 상담 전후 봇 답변 평가 가능 · `evaluateSessionAlert` 수정 0 · 👎의 경고 산입은 후속 |
| No.10 시뮬레이터 · No.19/20 TC | 평가 0건(구조) · 시뮬레이터 화면 버튼 없음 |
| No.2 대시보드 · No.14 · No.29 | 대시보드·기존 응답 불변 · 만족도는 No.14 화면 새 섹션 · 질문 순위 딥링크는 조건 1개(결과 불변) · 통합·의도별은 2차(원장 `groupId`·`matchedIntentId` 준비됨) |
| No.22 토픽 | 원장 `topicId`(로그 복사) — 토픽별 만족도는 후속 · 토픽 분리는 원장을 복사하지 않는다 |
| No.25 버전 · No.28 예약 배포 | 원장·스위치 스냅샷 밖 · 복원이 자산을 지우면 대상이 "삭제됨"(ID 보존 복원으로 되돌아오면 이름 재해석) |
| No.30 외부 RAG | RAG 최종 답변 평가 가능 · 대상 "문서 답변" · 외부 RAG로 피드백 송신은 범위 밖(allowlist 불변 — ADR-0022) |
| No.45 거버넌스 | 원장 보존기간·파기·자유 텍스트 사유 |

---

## 20. 관리자 콘솔 (ui-designer / frontend-implementer 인계)

| 화면 | 요구 | 주의 |
|---|---|---|
| 챗봇 상세 > 채널 > WEB | 체크박스(스위치) "답변 평가 받기" + 설명("켜면 챗봇 답변마다 '도움이 됐어요/도움이 안 됐어요' 버튼이 보입니다. 새 답변부터 적용돼요.") · `channel:write` 없으면 비활성 + 사유 | ★ **config 전체 교체** — 저장 시 `feedbackEnabled`를 항상 포함(누락 = 꺼짐) |
| 학습현황 목록 | 소스 필터 [전체 · 답변 못함 · 부정 평가](네이티브 `<select>` + `<label>` 또는 라디오 그룹) · 행 **텍스트 배지**(색 단독 금지) · 부정 평가 행 발생 수 라벨 "부정 평가 n회" · 대상 유형·이름(삭제됨 텍스트) · `반영 완료(직접 수정)` 표시 · 탭 배지 = `pendingCount`(전체) + 소스별 수 · 상한 배너 소스별 | 대시보드의 "미응답 대기" 표시가 요약 `pendingCount`를 쓰면 부정 평가가 섞인다 → **`bySource.UNANSWERED.pendingCount`로 라벨을 맞추거나 라벨을 "검토 대기"로** |
| 학습현황 상세(부정 평가) | 질문 · 당시 봇 답변(마스킹본 · 절단 표시) · 대상 유형·이름 · 추천 목록 "현재 매칭" 배지(`suggestion.intentId === lastFeedback.matchedIntentId`) · 같은 의도로 반영 시 비차단 경고 · **직접 수정 완료** 버튼(부정 평가 `PENDING`에만 활성 — 그 외 비활성 + 사유 텍스트) · 대상 편집 링크(FAQ·노드·의도 — 삭제됨·RAG·폴백이면 없음) · 대응 소스 항목 링크 · 👎 추이 | 직접 수정 완료는 되돌릴 수 있어(재오픈) 확인 대화상자 불필요 — 결과는 `aria-live="polite"` 1회 |
| No.14 통계 "답변 만족도" 섹션 | 카드(평가 수 · 긍정률(표본 표기 · 30 미만 "표본이 적어요") · 참여율(도움말: "버튼을 보여 준 답변 중 평가가 남은 비율 — 하한값")) · 일별 추이(👍·👎 막대 + 긍정률 선 — **표 대체 동반**) · 👎 상위 대상 표(유형 텍스트 · 이름/삭제됨 · 👎 · 👍 · 부정 평가 큐 링크) · 분모 0 = "—" | 대시보드 무변경 · 질문 문장 없음 |
| 시뮬레이터 | 변경 없음(버튼 없음) | P-14 |
| 고정 문구(FR-0-147) | 최종 사용자 문구에 "원장·큐·학습" 금지 · 콘솔은 "부정 평가"·"긍정 평가"·"답변 평가"로 통일 | — |

`docs/03-design/UIUX_준수기준.md` 보강 후보(ui-designer 판단): "로그 영역 안의 보조 버튼 상태 변화는 속성 변경 + 상태 영역 1회 안내로만(새 노드 추가 금지)" · "토글 버튼은 `aria-pressed` + 텍스트 이름".

---

## 21. 시험 설계 포인트 (test-automation 인계)

### 21.1 층별 핵심

| 층 | 대상 |
|---|---|
| 단위(순수) | `isFeedbackOffered` 표(§6.1 턴 × features × 스위치) · `readFeedbackEnabled`(키 없음·false·true·깨진 JSON) · `decideFeedbackWrite`(NOOP 우선·기한·5회·최초) · `verifyFeedbackTarget` · `classifyFeedbackTarget`(7유형 · 폴백 노드 = FALLBACK) · `shouldQueueNegativeFeedback`(사유 6종 · `BUTTON_MESSAGE` 편입 · null) + `shouldCollect` 기존 시험 무수정 · `foldFeedbackStats`(AC-FB6-1 픽스처 · 분모 0 null · lowSample · 정렬 동점) · 위젯 `planFeedbackAttempt` 표(§13.5) |
| 서비스(목) | 수집기 `collectNegativeFeedback`(병합·재발생·상한·P2002·FAILED) · 원장 서비스 CAS 재실행 · 선점 경합 · 가드 `FEEDBACK` 버킷(키 접두·한도·대화 버킷 비소비) + `POLL` 기존 시험 무수정 |
| 통합(`migrate deploy`) | ★ AC-FB1-1(꺼짐·미선언 응답에 `feedback` 키 0 · 기존 스위트 무수정 통과) · AC-FB1-3(켜짐 턴 조회 수 = 꺼짐 — Prisma 쿼리 계측) · ★ AC-FB2-1/2(턴 유형별 표식·`feedbackOffered`·`inputKind`) · ★ AC-FB3-1(위조 5종 같은 코드·문구·헤더) · ★ AC-FB3-2/3(연타·토글) · AC-FB3-4(기한·횟수 — 로그 `createdAt` 과거 픽스처) · ★ AC-FB3-5(평가 40회 후 전송 200 — 레이트리밋 한도 낮춘 **별도 파일**, `hybrid-cs-hardening-ratelimit` 선례) · AC-FB3-7(동시 👎 `Promise.all`) · ★ AC-FB4-1/2(편입·제외 4종) · AC-FB4-3(재발생) · AC-FB4-4(상한 — 단위 시험으로, 통합은 설정 고정 한계 — `unanswered-collector.service.spec.ts` 머리 주석 선례) · AC-FB4-5(PII) · AC-FB4-6(실패 주입 — 서비스 시험) · ★ AC-FB5-4(직접 수정 완료 · 400 · 403 · 감사 0) · AC-FB5-6(쿼리 수 고정) · ★ AC-FB6-1 · AC-FB6-4(기존 통계 응답 스냅샷 비교) · AC-FB6-5(그룹 이동 후 원장 `groupId`) · AC-FB8-5(사전검사 `답변 평가`) · **마이그레이션 시험**: 적용 후 부분 유니크 4개 존재·옛 키 부재 |
| 위젯(jsdom) | ★ AC-FB7-1(표식 있는 말풍선만 · 보류 READY/FAILED만 · 인사말·대기·정리·시스템·오류·상담원 0) · AC-FB7-2(`aria-pressed` · `#cb-status` 1회 · `#cb-messages` 자식 수 불변 · 포커스 유지) · AC-FB7-3/4 · 번들 게이트(AC-FB7-5) |
| 정적 | ★ F-1~F-16 + 역검증(AC-FB8-3) |
| 접근성 | axe(위젯 막대·콘솔 신규 화면) · 키보드만으로 평가·변경(AC-FB7-6) |

**시험데이터 고정표(`시험데이터.md` 추가 — test-automation 단계)**: 턴 유형 × 평가 가능 × 편입 여부 표 · 위조 케이스 표(세션 B · 다른 슬러그 · 없는 UUID · 비UUID · 꺼진 챗봇 · `feedbackOffered=false` 턴) · 제외 사유 표.

### 21.2 ★ 의도된 기존 시험 기대값 변경 (닫힌 목록 — FR-0-146 확정)

전수 확인(`toBe(7)` · `@Public` · `features` · 사전검사 목·수집기 키 단언) 결과:

| # | 파일 | 변경 | 비고 |
|---|---|---|---|
| X-1 | `apps/api/src/common/auth/public-decorator-count.spec.ts` | 머리 주석·`it` 제목 7 → 8 · `isPublic(…, 'submitFeedback')` 단언 1줄 · 기대 목록에 `'PublicConversationController#submitFeedback'` · **컨트롤러 수 34 불변**(새 컨트롤러 0) | 숫자 단언 |
| X-2 | `apps/api/src/versions/lib/version-sealing.spec.ts` V-8 | `toBe(7)` → `toBe(8)` · 제목 | 숫자 단언 |
| X-3 | `apps/api/src/validation/lib/validation-sealing.spec.ts` 7) | `toBe(7)` → `toBe(8)` · 제목 | 숫자 단언 |
| X-4 | `apps/api/src/deploy-schedules/lib/deploy-schedule-sealing.spec.ts` D-5 | `toBe(7)` → `toBe(8)` · 제목 | 숫자 단언 |
| X-5 | `apps/api/src/handoff/lib/handoff-sealing.spec.ts` H-10 | `toBe(7)` → `toBe(8)` · 제목("7번째는 pollHandoff" 유지 + "8번째는 submitFeedback") · `pollHandoff(` 앞 400자 검사 **불변**(새 핸들러는 파일 끝) | 숫자 단언 |
| X-6 | `apps/api/src/topics/lib/topic-sealing.spec.ts` T-9 | **`describe` 제목 문자열만** "총 7" → "총 8"(이 파일은 총수를 단언하지 않는다 — 단언 변경 0) | 제목만 |
| X-7 | `apps/api/src/chatbots/chatbots.service.spec.ts` | Prisma 목에 `messageFeedback: { count: jest.fn().mockResolvedValue(0) }` 1줄 + 머리 주석(14 → 15종) — **단언 변경 0**(없으면 `Promise.all`이 `undefined.count`로 실패) | No.22 X-2 선례 |
| X-8 | `apps/widget/src/api/public-client.spec.ts` | `features` 기대값 `['handoff-v1']` → `['handoff-v1', 'feedback-v1']` · `it` 제목 | 위젯 |

**변경하지 않아도 통과해야 하는 것(회귀 감시)**: `unanswered-collector.service.spec.ts`(호출 횟수·증가만 단언) · `collect-decision.spec.ts` · `public-rate-limit.guard.spec.ts` · `public-conversation.service.spec.ts`(생성자 15인자 불변 · `feedbackOffered`는 선택 입력) · `rag-answer.service.spec.ts`(`objectContaining`) · `stats-retention-sealing.spec.ts` R-1~R-10 · `public-conversation-classifier-isolation.spec.ts`(새 `conversation/public-feedback.service.ts`에 classifier·augmentation·trainingjob 심볼 0) · `survey-sealing.spec.ts` · `topic-sealing.spec.ts` T-13(공개 스키마 키에 `topic` 0 — 새 키 `feedback`·`rateable`·`rating`) · 웹 `LearningQueuePage*.spec.tsx`(요약·목록 신규 필드가 선택이라 픽스처 타입 불변) · 통합 스위트 전체. **이 목록 밖의 기존 시험이 깨지면 회귀로 취급한다**(커밋 ①에서 깨지면 멈추고 보고).

---

## 22. 요구사항 추적표

| 요구사항 | 설계 위치 |
|---|---|
| FR-0-138 엔진 수정 0 | §2.3 · F-12 |
| FR-0-139 바이트 동일·조회 0 | §5.1 · §6.2 · §18 · AC-FB1-1/3 |
| FR-0-140 `@Public()` 8 | §7.1 · F-6 · §21.2 X-1~X-6 |
| FR-0-141 원장 쓰기 1파일·삭제 0 · 큐 쓰기 파일 불변 | §9.1 · §10.1 · F-1/F-2/F-9 |
| FR-0-142 원문 미접근·최소 수집·로그 본문 0 | §7.2 · §10.5 · F-3/F-13 |
| FR-0-143 시뮬레이터 등 DI 부재·스냅샷 밖 | §6.5 · §9.5 · F-8 |
| FR-0-144 권한·역할·감사 0 | §14 · §15 |
| FR-0-145 오류 코드 2종 | §16.3 |
| FR-0-146 기대값 변경 닫힌 목록 | §21.2 |
| FR-0-147 내부 용어 금지 | §7.4 · §13.1 · §20 |
| FR-0-148 선택 환경변수 | §3.4 |
| FR-FB1-1~4 스위치·범위 | §5 |
| FR-FB2-1~5 판정·표식·컬럼 | §6 |
| FR-FB3-1~5 공개 API | §7 |
| FR-FB4-1~6 위조·변경·버킷·1회 기여·동시성 | §7.2 · §7.3 · §8 · §9.3 · §9.4 |
| FR-FB5-1~5 원장 | §3.1 · §9 |
| FR-FB6-1~8 편입 | §3.2 · §10 |
| FR-FB7-1~8 학습현황 | §11 · §20 |
| FR-FB8-1~6 통계 | §12 · §20 |
| FR-FB9-1~8 위젯 | §13 |
| FR-FB10-1 봉인 | §17 |
| NFR-FBP1~7 | §18 · §3.2 |
| NFR-FBS1~6 | §7.2 · §9.1 · §17 |
| NFR-FBA1~4 | §13.4 · §20 |
| NFR-FBM1~3 | §2.1 lib · §10.2 · §13.5 |
| AC-FB1 · AC-FB2 | §6 · §21.1 |
| AC-FB3 | §7 · §8 · §9.3 · §9.4 |
| AC-FB4 | §10 |
| AC-FB5 | §11 |
| AC-FB6 | §12 |
| AC-FB7 | §13 |
| AC-FB8 | §14 · §15 · §17 · §6.5 · §9.5 |
| EX-FB-1~2 | §7.2(세션 불일치 404) · §13.2(DOM만) |
| EX-FB-3~5 | §6.4 · §13.5 · §13.1 |
| EX-FB-6~7 | §10.2 · §10.5 |
| EX-FB-8~13 | §6.1 · §10.2 · §7.2 |
| EX-FB-14~15 | §9.1 · §11.1 |
| EX-FB-16~18 | §10.4 · §7.2 · §8 |
| EX-FB-19~21 | §7.1 · §5.1 · §9.4 |
| EX-FB-22~26 | §11.4 · §7.3 · §9.3 · §9.4 · §6.1 |
| C-1 · C-2 · C-3 | §6.4 · §13.5 · §11 |
| T-1~T-10 | §10 · §6 · §13 · §12 · §19 |

---

## 23. 범위 밖 (재검토 트리거는 요구사항 §9 · ADR-0038 재검토 트리거)

고정 사유 코드 · 자유 텍스트 사유와 요약·감성 분석 · 그룹·전역·의도별·토픽별 만족도 · 편입 임계 설정 · "평가만 받고 편입 안 함" · 👍 큐 반영 · 평가 취소 · 👎 → 상담 경고 산입 · 상담 콘솔 👎 배지 · 👎 직후 다른 답변/상담 연결 제안 · 비WEB 채널 평가 · 평가 CSV · 직접 수정 완료 일괄 · 서버 발급 평가 토큰 · 시뮬레이터 내 관리자 평가 · 큐 편입 실패 재시도.

## 24. 알려진 제한

1. **참여율 분모 과대 가능**(하한 해석) — 보류 답변이 새 질문으로 폐기되거나 위젯 `TIMEOUT`으로 마감된 턴, 렌더 직후 탭을 닫은 턴도 `feedbackOffered = true`.
2. **큐 편입 실패·`CLAIMED` 고착은 복구하지 않는다**(원장 `queueOutcome` 조회로 건수 파악 가능).
3. **원장 무기한 보존**(텍스트 0 — No.45).
4. **Origin 헤더 없는 서버 간 평가 요청 통과**(결합 검증 동일 적용 — ADR-0011).
5. **한 세션이 모든 답변에 👎 가능**(세션 단위 제한 없음 — 통계 표본으로 드러남, EX-FB-23).
6. **스키마 롤백 제약** — `NEGATIVE_FEEDBACK` 행이 생긴 뒤에는 옛 유일 키로 되돌릴 수 없다(§3.5).
7. **`feedbackEnabled`는 WEB 채널 삭제(설정 초기화) 시 함께 꺼진다.**
8. **로그 적재가 영구 실패한 턴(C-2)은 평가할 수 없다**(위젯 2회 404 후 "지금은 의견을 받을 수 없어요").
9. **스크린리더별 막대 추가 낭독 차이** — ui-designer 실측 후 표현 확정(§13.4).
10. **대상 이름은 조회 시점 해석**이다 — 자산 이름을 바꾸면 과거 👎 대상에도 새 이름이 보인다(id는 그대로).

## 25. 요구사항 대비 해석 (architect 판단)

| # | 요구사항 | 이 설계 | 사유 |
|---|---|---|---|
| D-1 | FR-FB1-1 `feedbackEnabled`(기본 false) | **선택 키**(`.optional()` — 없음 = 꺼짐) | `.default(false)`는 관리자 채널 응답·파싱 결과 바이트를 바꾼다 |
| D-2 | FR-FB3-1 메서드·경로 | 권고 그대로 `PUT …/messages/:messageId/feedback` · 핸들러 `submitFeedback` · `200 { rating }` | 멱등 설정 의미 |
| D-3 | FR-FB4-4 버킷 구현 | `@PublicRateBucket` `kind: 'FEEDBACK'` · `fb-ip`/`fb-key` **별도 접두**(`poll-ip` 비공유) | 폴링·평가 상호 간섭 방지 |
| D-4 | FR-FB4-5 `queuedAt` 표식 | **`queueOutcome` 선점 상태 기계 + `queueSkipCode`** · `queuedAt`·`queueItemId` 유지 | 1회 기여와 실패 흡수·재시도 없음을 동시에 표현 |
| D-5 | §5.2 `queuedQuestionId` | **`queueItemId`**로 개명 · `targetKind`/`targetId` 비정규화 추가 | 컬럼 허용 목록 봉인 · `groupBy` |
| D-6 | FR-FB10-1 ⑨ "쓰기 파일 2개 유지" | **3개 유지**(No.23 `decomposed-resolve.service.ts`) | 사실 정정 |
| D-7 | FR-0-146 "단언 6파일" | **숫자 단언 5 + 제목만 1**(topic-sealing) + 사전검사 목 1 + 위젯 1 = 8건 | 전수 확인 |
| D-8 | (요구사항에 없음) | No.14 `getQuestions` 딥링크 `source='UNANSWERED'` | 소스 분리가 여는 잠재 충돌(§10.6) |
| D-9 | FR-FB6-7 요약 | `pendingCount` = 전체 · `limitReached` = UNANSWERED 기준(기존 의미) · `bySource` 선택 | 기존 필드 의미·값 보존 |
| D-10 | FR-FB7-1 목록 `source` | DTO **선택 필드**(서버 항상) · 필터 없음 = 전체 | 웹 픽스처 타입 불변 · 하위 호환 |
| D-11 | (요구사항에 없음) | 부정 평가 항목 추이 = 원장 기반(정확) | 변형 5건 근사보다 정확·저비용 |
| D-12 | NFR-FBP4 쿼리 ≤4 | **≤7 고정**(집계 3 + 이름 3 + 존재 1) | 대상 이름 해석·존재 확인 포함 — 반환 행 성질 유지 |
| D-13 | FR-FB7-6 미응답 항목 `400` | 기존 **`INVALID_STATUS_TRANSITION`** 재사용 · 신규 코드 2종 유지 | 코드 증식 방지 |
| D-14 | FR-FB9-3 보류 턴 | READY·FAILED 최종 말풍선 · 로그 두 경로 모두 `feedbackOffered` 전달 | 요구사항 그대로 · 구현 위치 확정 |
| D-15 | C-1 · FR-FB9-5 | **첫 404도 1초 뒤 1회 재시도**, 두 번째 404에서 "받을 수 없어요" | READY 직후 경쟁 흡수(EX-FB-4) |
| D-16 | FR-FB6-3 `inputKind` null | 제외(`BUTTON_NODE`) — 구조적으로 도달 불가임을 명시 | 두 컬럼이 같은 마이그레이션 |
| D-17 | FR-FB4-2 기한 | **같은 값 재요청은 기한 후에도 200 NOOP** | 멱등이 기한보다 우선(재전송 안전) |
| D-18 | P-15 감사 | `Channel UPDATE` summary에 스위치 변화 문구 1개 | 화이트리스트 무변경으로 추적성 확보 |
| D-19 | FR-FB2-2 응답 필드 | `feedback: { rateable: true }`(마지막 키 · 조건부 전개) | 2차 사유 코드 확장 여지 · 바이트 동일 |
| D-20 | FR-FB4-2 기한 기준 | 로그 `createdAt`(보류 턴 = 완료 시각) | 사용자가 답을 본 시각에 가깝다 |
| D-21 | FR-FB7-4 "현재 매칭" | 서버는 `matchedIntentId`만 제공, 배지는 콘솔 비교 | 추천 스키마 불변 |
| D-22 | FR-FB5-3 `changeCount` | CAS로 **정확** 계수(±1 허용보다 강함) | 결정적 시험 |

## 26. GPU · 배포 형태

- **GPU 2 유지**(카탈로그) — 이 그룹의 신규 연산(판정·조회·`groupBy`)은 전부 1. 큐 추천은 기존 No.23 분류기(임베딩 — ml-worker)/문자 bigram 그대로라 No.15와 같은 등급이며 신규 부하 0. ml-engineer 신규 작업 없음.
- **구축형 ○** — 외부 의존·아웃바운드·새 인프라 0. GPU 없는 환경에서도 추천이 문자 유사도로 동작.
- **구독형 ○** — DB 원천 · 프로세스 로컬 상태 0(레이트리밋 메모리 저장소는 기존과 같은 한계) · 저장되는 것은 평가값과 id·불리언뿐(텍스트 0).
