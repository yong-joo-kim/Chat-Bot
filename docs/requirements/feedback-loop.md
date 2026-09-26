# 피드백 기반 개선 루프 (요구사항 정의서)

> **대상 기능**: `docs/01-requirements/기능요구사항.md` §4-1(추가 보완 기능 — 타사 벤치마킹)
> | No | 기능 그룹 | 기능명 | 카탈로그 GPU | 이번 범위에서의 역할(권고) | **재확인 GPU** |
> |---|---|---|---|---|---|
> | 44 | 분석/피드백 | 피드백 기반 개선 루프 | 2 | **단계 도입(권고 — ★ 도입 자체가 P-1 확인 대상).** 1차 = **위젯 봇 답변 말풍선의 👍/👎 평가**(챗봇별 WEB 채널 설정, 기본 꺼짐) + **공개 평가 API 1개** + **평가 원장**(메시지당 1행 · 텍스트 0) + **👎 → 학습현황(No.15) 큐 자동 편입**(소스 `NEGATIVE_FEEDBACK` 분리 · 당시 매칭 대상 표시) + **챗봇 스코프 만족도 통계**(No.14 화면 섹션). 사유 선택·그룹/전역 통계는 2차, **자유 텍스트 사유는 후속(No.45 연동)**. 대화 엔진은 **수정하지 않는다** | **2 유지**(이 그룹의 신규 연산은 1 — §4.13) |
>
> **이 그룹 종합 GPU 필요도: 2** (신규 연산은 DB 조회·순수 판정·집계뿐 = 1. 큐 검토 단계의 의도 추천은 **기존** No.23 분류기/문자 유사도를 그대로 쓰므로 No.15와 같은 등급 2로 표기한다. 새 모델·학습·추론 0)
> **구축형 ○ / 구독형 ○** — 신규 외부 의존 0, 신규 아웃바운드 0, 신규 런타임 인프라 0, 새 프로세스 로컬 상태 0. 신규 공개 경로 1개(`@Public()` 7 → 8)
>
> **선행 문서**: `docs/01-requirements/기능요구사항.md`(§4-1 No.44 원문 93행 · §4-1 "제안일 뿐" 주의 104행 · No.15 47행 · No.24 61행 · No.27 64행 · No.29 66행), `docs/02-spec/개발명세서.md`(§4 공개 대화 264행 · §6 공개 경로 갱신 각주 494행 · ADR-0015 갱신 각주 504~511행 · ADR 작성 규칙 607행), `docs/03-design/UIUX_준수기준.md`
> **선행 그룹(공통 규약 상속)**: `chatbot-operations.md`(FR-0-1~8) · `dialogue-design.md`(FR-0-9~16) · **`quality-channel.md`(FR-0-17~23 — 공개 대화·위젯, 239행 "No.44는 실제 대화 데이터 소비자" · 622행 "위젯에 평가 버튼을 넣지 않는다")** · `security-audit.md`(FR-0-24~30) · **`stats-learning.md`(FR-0-31~38 — 117행 "큐 스키마는 소스 구분 가능하게" · 732행 "만족도 지표 = No.44")** · **`nlu-rag-answering.md`(FR-0-39~48 — 771행 "RAG 답변 피드백 = No.44")** · `learning-augmentation.md`(FR-0-49~58 — 742행) · `validation-regression.md`(FR-0-59~67) · `version-history.md`(FR-0-68~77) · `scheduled-deploy.md`(FR-0-78~87) · **`integrated-stats.md`(FR-0-88~95 — 141·365·586행)** · `legacy-api-integration.md`(FR-0-96~105) · **`survey-management.md`(FR-0-106~117 — 556·818행)** · **`hybrid-cs.md`(FR-0-118~128 — 524행 "👍/👎는 No.44")** · `topic-system.md`(FR-0-129~137)
> **핵심 선행 ADR**: **ADR-0019**(미응답 큐 수집 모델 — **91행 `source` 필드 예고** · 45행 쓰기 주체 2곳 · 57행 `inputKind` 컬럼 재검토 트리거 · 73~82행 큐 비감사) · **ADR-0011**(공개 표면·Origin 가드) · **ADR-0023/ADR-0036**(`@Public()` 의도적 갱신 선례 · 폴링 전용 버킷 = K-1 해소) · ADR-0013(PII 마스킹 1벌) · ADR-0015(역할·권한) · ADR-0016(감사 원문 금지) · ADR-0033(원천 로그 봉인·`groupId` 스냅샷) · ADR-0002(영구삭제 사전검사) · ADR-0027(추천 소스 우선순위 — 분류기 → 문자 유사도) · ADR-0031(스냅샷 범위) · ADR-0035(설문 — 사용자 응답 비감사 선례) · ADR-0037(`topicId` 로그 선례)
> **작성일**: 2026-09-25 · **다음 단계**: ★ **PM이 P-1(도입 여부·1차 범위)을 먼저 결정** → `system-architect`(**ADR-0038** 신규 · ADR-0019/0011/0015/0033/0002 갱신) → `ui-designer`(위젯 평가 버튼·학습현황 소스 구분·만족도 섹션) → `backend-implementer` → `frontend-implementer` → `code-reviewer` → `test-automation`
>
> ⚠ **조사 한계**: No.44는 **ROCHA 원본 문서에 없는 기능**이다. 근거는 카탈로그 원문 1줄(93행)과 §4-1 조사 출처 목록(98~102행 — Zendesk·Kayako 등 2026 CX 트렌드)뿐이며, **이 세션에서 해당 웹 출처를 재확인하지 않았다**. 따라서 버튼 표시 위치·사유 선택지·만족도 지표 정의는 원본 인용이 아니라 **업계 일반 관행 + 우리 코드 구조에서 도출한 제안**이다. 또한 §4-1 104행이 명시하듯 **No.40~47은 사용자 확인 전 "제안"** 이므로, 이 문서의 모든 판단은 **P-1 승인을 전제**로 한다.

---

## 1. 배경 / 목적

### 1.1 배경 — 선행 그룹이 "No.44"로 넘긴 인계 목록

| # | 기록 위치 | 넘긴 것 | 이 문서의 판정 |
|---|---|---|---|
| T-1 | ADR-0019 91행 · `schema.prisma` 614~615행 · `packages/shared-types/src/learning.ts` 22~24행 · `stats-learning-설계.md` 151·299행 · `stats-learning.md` 117행 | "No.44가 같은 큐에 **`NEGATIVE_FEEDBACK` 소스**를 더한다 — 테이블을 쪼개지 않으려고 `source` 컬럼을 미리 둔다" | ★ **범위 안.** 단 **병합 유일 키 `(chatbotId, questionNormalized)`(626행)가 소스를 모른다** — 같은 질문이 "못 답함"과 "답했는데 틀림"으로 동시에 존재할 수 없다. 키에 `source`를 넣는 **분리 모델**을 권고한다(J-8 · P-6) |
| T-2 | `conversation-log.service.ts` 11행 · `quality-channel-설계.md` 690행 | "`messageId` = `ConversationLog.id` — **향후 No.44가 이 값을 앵커로 쓸 수 있다**. 로그 적재가 실패하면 앵커가 가리키는 행이 없을 뿐" | **채택.** 평가 대상 = `messageId` 1개 = 로그 1행. 적재 실패·적재 전 도착은 예외로 다룬다(EX-FB-3·4) |
| T-3 | `quality-channel.md` 622행 | "No.44 피드백(👍/👎 수집): **위젯에 평가 버튼을 넣지 않는다**" | **이 그룹이 넣는다 — 위젯 변경 필수**(J-14). 현재 봇 말풍선은 `messageId`를 모른다(§1.3.4) |
| T-4 | `nlu-rag-answering.md` 771행 | "RAG 답변에 대한 사용자 피드백(👍/👎) — 수집 수단 자체가 없다 → No.44" | **범위 안.** RAG 최종 답변 말풍선도 평가 대상이며 큐에서는 매칭 대상 "문서 답변"으로 표시한다(J-9) |
| T-5 | `stats-learning.md` 732행 · `integrated-stats.md` 141·365행 · `stats-learning-설계.md` 900행 | "만족도·평가 지표 = No.44" · 통합 통계 화면에 "데이터 없는 카드는 두지 않는 것을 권고" | **챗봇 스코프(No.14 화면)만 1차.** 그룹·전역(No.29)은 2차 — 단 `groupId` 스냅샷은 **지금 적재**(J-12) |
| T-6 | `integrated-stats.md` 586행 | "채널 전환율 — 원천 이벤트 없음 → No.35/No.44 이벤트 수집 시" | **트리거 미발동.** 평가는 전환 이벤트가 아니다 |
| T-7 | `survey-management.md` 556·818행 | "응답별 👍/👎는 No.44. **설문 척도 결과를 학습 큐에 넣지 않는다**" · "자유 텍스트 요약·키워드·감성 분석 = No.44·옵션 AI" | 경계 유지(J-15). **감성 분석은 이 그룹도 하지 않는다**(자유 텍스트 자체를 1차에 받지 않음 — J-11) |
| T-8 | `hybrid-cs.md` 524행 | "👍/👎는 No.44" | **상담원 메시지는 평가 대상이 아니다**(상담 턴은 로그 행이 있어도 봇 답변이 아님 — J-15) |
| T-9 | `learning-augmentation.md` 742행 | "No.44 = 큐 입력원 확장이며 증강 층과 무관" | 확인 — 증강(No.16)·분류기(No.23)는 **수정 0**, 큐 추천만 그대로 재사용 |
| T-10 | ADR-0019 57행 | "`inputKind`는 로그 컬럼이 아니라 `record()` 파라미터 — **사후 로그 분석으로 버튼 턴을 구분할 수 없다.** 재검토 트리거 = 입력 유형별 지표 요구" | ★ **트리거 발동.** 평가는 **턴이 끝난 뒤** 도착하므로 큐 편입 판정이 로그 행만 보고 "봇이 준 버튼(`NODE`)을 누른 턴"을 걸러야 한다 → `ConversationLog.inputKind` 컬럼 추가를 권고(J-19 · architect) |

### 1.2 원본 근거 — "무엇을 요구하는가"

**근거 1 — 카탈로그 원문**(`기능요구사항.md` 93행):
> "피드백 기반 개선 루프 | **응답에 대한 사용자 👍/👎 평가를 수집해 오답 후보를 학습현황(15번) 큐에 자동 편입** | GPU 2 | ○ | ○ | 업계 트렌드. 15번의 입력 소스를 '미응답 질문' 외 **'명시적 부정 피드백'** 으로 확장"

→ 요구는 셋이다: ① **응답 단위** 👍/👎 수집 ② 👎 = **오답 후보** ③ No.15 큐에 **자동 편입**(= 사람이 검토하는 반자동 루프의 입력 확장이지 자동 학습이 아니다 — No.15 원문 47행 "관리자 개입 필수인 반자동 워크플로우"와 같은 성격). **만족도 통계는 원문에 없다** — 수집한 데이터의 자연스러운 부산물이자 인계 T-5가 요구하는 것이므로 1차에 **최소 형태로** 포함을 권고한다(P-10).

**근거 2 — §4-1 주의**(104행): "이 8개는 아직 타사 사례 기반 '제안'일 뿐 … 사용자 확인 후 §4 옵션 목록에 정식 편입할지 결정한다" → **P-1이 선결 조건**이다.

### 1.3 이미 있는 것과 없는 것 (코드 확인)

#### 1.3.1 평가 대상 식별 — `messageId`와 `ConversationLog`

| 사실 (파일:행) | 결과 |
|---|---|
| 일반 턴의 `messageId`는 **`resolveTurn` 직후 `randomUUID()`로 생성**된다(`public-conversation.service.ts` 183~185행 — No.26에서 앞당김). 응답 `messageId`(248~256행)와 로그 `id`(259~276행)가 **같은 값** | ★ **서버가 발급한 UUID v4(122비트 난수)이며 요청한 클라이언트에게만 응답으로 전달된다** → 추측 불가능한 "메시지별 능력(capability)"으로 쓸 수 있다(§1.5) |
| 금지어 BLOCK 턴도 `messageId`를 발급하고 로그를 남긴다(`isAnswered=false`·`blockedByFilter=true`, 101~126행) | BLOCK 안내 문구에 평가를 받지 않는다(J-2) |
| 상담 구간 턴(No.24)은 게이트 응답의 `messageId`로 로그를 남긴다(`isAnswered=true`·`handoffTurn=true`, 141~155행) · 응답 `outputs=[]`(봇 말풍선 없음 — `app.ts` 464~468행) · 상담원 메시지는 `HandoffMessage`에만 있다(`schema.prisma` 1325~1346행) | 상담 턴·상담원 메시지는 **평가 대상이 아니다**(J-15) |
| 외부 RAG 보류 턴은 대기 문구 응답과 최종 답변이 **같은 `messageId`**(`pendingAnswer.id`, 376행)이고, 로그는 **백그라운드 완료 시점에 1건** 적재된다(`rag/rag-answer.service.ts` 155·175행) | 평가 대상 = **최종 답변 말풍선**(대기 문구 아님). ⚠ `pendingStore.complete(READY)`(153행)가 `logPort.record()`(155행)보다 **먼저** 실행된다 → 위젯이 READY를 받은 직후 극히 짧은 순간은 로그 행이 아직 없을 수 있다(EX-FB-4) |
| 로그 적재는 **fire-and-forget이며 실패를 삼킨다**(`conversation-log.service.ts` 61~118행, 특히 113~117행) | `messageId`가 가리키는 행이 **영영 없을 수 있다** → 평가는 `404`로 끝난다(EX-FB-3 — 드묾, 수용) |
| 로그 행의 `sessionId`(`schema.prisma` 450행)·`chatbotId`(445행) · 판정 사실 `isAnswered`(460)·`blockedByFilter`(462)·`answeredByRag`(474)·`surveyTurn`(485)·`handoffTurn`(489)·`apiNotice`(493)·`topicId`(497)·`matchedIntentId/NodeId/FaqId`(455~459) · `userMessage`/`botResponse`는 **마스킹본**(451~454) | ★ 평가 요청이 오면 **로그 행 1개만 읽으면** 세션 결합 검증·평가 가능 판정·큐 편입 판정·매칭 대상 스냅샷이 전부 가능하다. **원문에 접근할 필요가 없다**(ADR-0013 불변) |
| 로그에 `inputKind` 컬럼이 **없다** — `record()` 파라미터로만 전달(`conversation-log.service.ts` 28~29행 · ADR-0019 57행) | `NODE` 버튼 턴의 `userMessage`는 **버튼 라벨**이다(`public-conversation.service.ts` 406~410행). 사후에 이것을 사용자 질문과 구분할 수 없다 → T-10 |
| `ConversationLog`는 **`update`/`upsert` 0건 봉인**(`stats-retention-sealing.spec.ts` R-10 179행) · `create`는 `record()` 1파일(R-9 172행) | 평가 결과를 **로그 행에 나중에 적을 수 없다** → 별도 평가 원장 테이블 필요(J-6). 적재 **시점**에 확정되는 값(예: "평가 버튼을 제공했는가")은 로그 컬럼으로 둘 수 있다(`surveyTurn`·`handoffTurn` 선례) |

#### 1.3.2 공개 표면 · 레이트리밋 · Origin

| 사실 (파일:행) | 결과 |
|---|---|
| `@Public()` **정확히 7개**(`public-decorator-count.spec.ts` 61~76·94·148~158행) — health 1 · 공개 대화 4(config·messages·보류 폴링·상담 폴링) · 로그인·로그아웃 2. 7을 재단언하는 봉인 정적 검사 **6파일**(**[architect 전수 확인 2026-09-25] 숫자 단언은 5파일이고 `topic-sealing.spec.ts`는 `describe` 제목 문자열에만 7이 있다 — 설계서 §21.2**)(`public-decorator-count.spec.ts` · `version-sealing.spec.ts` · `validation-sealing.spec.ts` · `deploy-schedule-sealing.spec.ts` · `handoff-sealing.spec.ts` · `topic-sealing.spec.ts`) | 평가 경로를 추가하면 **8개**로 의도적 갱신(ADR-0023 5→6 · ADR-0036 6→7 선례). 단언 파일 6곳 동시 갱신 |
| 공개 컨트롤러 가드 순서 = 레이트리밋 → Origin(`public-conversation.controller.ts` 30행) | 신규 핸들러도 같은 컨트롤러에 두면 두 가드를 **자동 상속** |
| 일반 버킷 = `ip` 120/분 + 요청 **본문** `sessionId` 기준 `session` 30/분(`public-rate-limit.guard.ts` 45~64행) | ★ 평가 요청이 본문에 `sessionId`를 실으면 **대화 전송과 같은 `session` 버킷을 소비**한다 → 평가 버튼을 여러 번 누른 사용자가 **다음 질문 전송에서 429**를 받을 수 있다(No.24 K-1과 같은 유형의 결함) |
| **K-1 해소 결과**: `@PublicRateBucket()`이 붙은 핸들러는 일반 버킷을 **소비하지 않고** 전용 버킷만 쓴다(40~43·70~91행 · 컨트롤러 69·81~85행) | ★ 평가 경로도 **전용 버킷**으로 분리한다(J-5). 현재 데코레이터는 `kind: 'POLL'`(`poll-ip` 공용 600/분)만 있으므로 평가 전용 종류 추가 또는 공용 여부는 architect 확정 |
| Origin 가드는 **`Origin` 헤더가 없으면 통과**(`public-origin.guard.ts` 12·23~25·37행 — 서버 간 호출은 CORS 보호 대상이 아니라는 ADR-0011 설계) | `curl`로 평가를 대량 전송하는 것은 막지 못한다 → 방어의 중심은 **"자기가 받은 `messageId`만 평가할 수 있다"** 는 구조(§1.5 표 4행) |
| `access.resolve(slug)`가 **요청마다 챗봇 + WEB 채널 행을 이미 조회**한다(`public-access.service.ts` 20~33행) · 채널 설정 스키마는 `.strict()`(`packages/shared-types/src/channel.ts` 63~71행) | ★ 기능 스위치를 **WEB 채널 설정**에 두면 대화 턴·평가 요청 모두 **추가 조회 0**이다(J-13) |
| 공개 요청 선택 필드 `features`(≤5, `conversation.ts` 246~247행) · 응답 선택 필드 선례 `pendingAnswer`·`handoff`("없으면 바이트 동일", 288~303행) | 위젯이 `features: ['feedback-v1']`을 선언한 요청에만 응답에 평가 가능 표시를 싣는다 → 구버전 위젯·기능 꺼진 챗봇은 **바이트 동일**(J-14) |

#### 1.3.3 학습현황 큐(No.15) — 수집 · 병합 · 상태 · 추천

| 사실 (파일:행) | 결과 |
|---|---|
| 수집 판정 순수 함수 `shouldCollect()`(`learning/lib/collect-decision.ts` 21~43행) — 제외 사유 8종(6행): `API_NOTICE` → `SURVEY_TURN` → `HANDOFF_TURN` → `ANSWERED` → `BLOCKED` → `BUTTON_NODE` → `EMPTY` → `TOO_LONG`(200자) | 👎 편입 판정은 **`ANSWERED` 조건만 뒤집히고 나머지 제외 규칙은 같다**(설문·상담·BLOCK·버튼·빈 입력·장문). 판정 1벌 원칙(ADR-0019) → 같은 파일에 소스 인자 추가 또는 공용 부분 추출(architect) |
| 수집기는 `record()` INSERT 성공 직후에만 호출된다(`conversation-log.service.ts` 100~112행) · **큐 쓰기 주체 2곳**(수집기 · 상태 전이 서비스 — `unanswered-collector.service.ts` 24~30행 · ADR-0019 45행 — **[architect 정정 2026-09-25] 실제로는 No.23 `learning/decomposed-resolve.service.ts`(요소분해 반영 CAS 전이)까지 3파일이며, 이 그룹은 3파일 집합을 바꾸지 않는다**) | 👎 편입은 **턴이 끝난 뒤** 평가 요청에서 일어나므로 `record()` 안에 둘 수 없다. **수집기에 두 번째 진입 메서드**를 추가해 쓰기 주체 2곳을 유지한다. 입력은 **로그 행의 마스킹본**이므로 ADR-0019 §2의 "마스킹 지점 = 적재 지점" 근거(88행)를 깨지 않는다(원문 재접촉 0) — ADR-0019 갱신 각주 필요 |
| 병합 = `(chatbotId, questionNormalized)` 유일(626행) · 재유입 시 `occurredCount`·`variants`·`lastOccurredAt` 증가, `RESOLVED`/`IGNORED`면 **상태 유지 + `recurredCount` 증가**(`unanswered-collector.service.ts` 73~89행 · ADR-0019 66~69행) | 분리 모델(J-8)이면 👎 항목에도 같은 규칙이 그대로 성립한다 — **"반영 후에도 👎 재발생"이 가장 강한 신호**(ADR-0019 69행 논리 상속) |
| `PENDING` 상한 5,000 도달 시 **신규만 중단**(91~98행) — 소스 구분 없음 | 👎 항목이 상한을 먼저 채우면 **미응답 신규 수집이 멈춘다** → 소스별 상한 권고(FR-FB6-7) |
| `source`는 수집기가 **쓰지 않는다**(create 시 기본값 `'UNANSWERED'`, 101~111행) · `UnansweredSource = z.enum(['UNANSWERED'])`(`learning.ts` 23행) · **목록 DTO에 `source` 필드 없음**(`learning.ts` 52~71행) · 목록 필터에 소스 없음(74~83행) | 스키마·DTO·필터·화면 전부 확장 필요 |
| **반영(`resolve`) = 의도에 예문 추가 + `RESOLVED`(`resolvedIntentId` 필수)**(`unanswered-questions.service.ts` 229~274행) · 무시·재오픈은 CAS 전이(291~314행) · `resolvedIntentId`는 nullable(`schema.prisma` 620행) | 👎의 원인이 "**잘못 매칭**"이면 올바른 의도에 예문을 더하는 기존 반영이 맞다. 원인이 "**매칭은 맞는데 답변 내용이 틀림**"이면 예문 추가가 무의미하다 → FAQ/노드 편집 후 **"직접 수정 완료"** 전이가 필요(J-9) |
| 추천 = 분류기 `READY`면 확률(`CLASSIFIER`), 아니면 문자 bigram(`LEXICAL`), 섞지 않음 · `PENDING` 행만 조회 시점 계산(89~129행 · ADR-0027) | 👎 항목에도 **그대로 적용**(신규 연산 0 — GPU 불변). 추천 목록에 **현재 매칭 의도(= 오답 후보)** 가 나오면 "현재 매칭" 배지로 구분한다(FR-FB7-4) |
| 큐 상태 변경은 **감사 대상이 아니다**(ADR-0019 73~82행 — `targetName`에 사용자 발화가 들어가 NFR-S8 위반) | 👎 편입·"직접 수정 완료"도 비감사(J-17) |

#### 1.3.4 위젯(`apps/widget`)

| 사실 (파일:행) | 결과 |
|---|---|
| 한 턴의 봇 아웃풋은 **말풍선 1개**로 렌더된다(`ui/message-list.ts` 129~137행 `addBotOutputs`) — **`messageId` 인자가 없다**(43~48행). 보류 최종 답변 `addBotAnswer`는 `messageId`를 받지만 **쓰지 않는다**(54~59·138행 `_messageId`) · `WidgetMessage`에도 `messageId` 없음(`core/store.ts` 17~22행) | "턴 1 = `messageId` 1 = 말풍선 1" 대응이 성립한다. `messageId`를 말풍선까지 전달하는 변경이 필요(FR-FB9-2) |
| `handleSend`에서 응답 `res.messageId`를 받지만 쓰지 않는다(`ui/app.ts` 422~425·453~468행) · 인사말·퀵리플라이는 서버 턴이 아니다(273~281행) · 시스템 문구(`stateResetNotice` 428행)·오류 말풍선(486행) | 평가 버튼은 **서버가 평가 가능하다고 표시한 봇 말풍선에만** 붙는다 — 인사말·대기 문구·시스템·오류·상담원 말풍선에는 없다(FR-FB9-3) |
| 보류 답변: 대기 문구 말풍선(457행) → 최종 답변 `addBotAnswer`(385~401행) — `READY`·`FAILED`는 서버 아웃풋, `EXPIRED`/`TIMEOUT`은 위젯이 만든 정리 문구(395~400행) | 평가 버튼 = `READY`·`FAILED` 최종 말풍선에만. 로컬 정리 문구에는 없다(서버 로그와 내용이 다르다) |
| 메시지 목록 `role="log"`·`aria-live="polite"`·`aria-relevant="additions"`(66~74행) · 텍스트는 `textContent`만 | 버튼 상태 변경이 **로그 영역 재낭독을 일으키지 않게** 해야 한다(말풍선 밖 보조 영역 · 상태 알림은 `#cb-status` 1회 — NFR-FBA2) |
| vanilla TS · 런타임 의존성 0 · **gzip 100KB 게이트**(`scripts/check-bundle-size.mjs` 10행) · 현재 **11.16KB**(`docs/changelog/CHANGELOG.md` 181행 · `docs/04-test/자동시험_전략.md` 969행) | 증가분 수 KB 이내 예상 — 게이트 여유 충분. **Preact 재검토 트리거(ADR-0012) 미발동** |
| 위젯 기능 선언 `WIDGET_FEATURE_HANDOFF_V1 = 'handoff-v1'`(`conversation.ts` 331~332행) | 같은 방식으로 `'feedback-v1'`을 추가 선언한다 |

#### 1.3.5 통계 (No.2 · No.14 · No.29)

| 사실 (파일:행) | 결과 |
|---|---|
| 대시보드 `getDashboard()` — "**이 메서드와 원시 SQL은 한 글자도 바꾸지 않는다**"(`stats/stats.service.ts` 47~48행, FR-0-90) | 대시보드 **불변**. 만족도는 별도 엔드포인트(J-12) |
| No.14 챗봇 스코프 요약·분포·질문 순위 = `ConversationLog` groupBy(123~193행 등) · 권한 `chatbot:read`(`stats.controller.ts` 35~60행) | 만족도 섹션도 같은 권한·같은 기간 규약(KST `dayBucket`)을 따른다 |
| No.29 챗봇 스코프 의도별 매칭 = `matchedIntentId × isAnswered` groupBy(`stats/intents/intent-stats.service.ts` 12·30행) | "의도별 👎 수" 열은 **2차 후보**(평가 원장에 `matchedIntentId`를 비정규화해 두면 조인 없이 groupBy 가능 — Prisma groupBy는 조인을 못 한다) |
| 선례: 로그 불리언 컬럼 `surveyTurn`(485행)·`handoffTurn`(489행)은 **적재 시점 확정**, 질문 순위 필터 1벌(`stats/lib/question-ranking-filter.ts` 9행) | "평가 버튼 제공 여부"를 **적재 시점에** 로그에 남기면(`feedbackOffered`) 참여율의 **정확한 분모**가 된다(J-12 · architect) |
| No.29 봉인 R-1~R-10(`stats-retention-sealing.spec.ts` 72~185행) — 로그·큐 삭제 0 · 로그 update 0 · `$queryRaw` 보유 파일 **4개**(R-7 150행) | 평가 원장도 **삭제 0**(원천 기록). 원시 SQL은 쓰지 않는다(R-7 불변 권고) |

#### 1.3.6 권한 · 감사 · 봉인 · 개인정보

| 사실 (파일:행) | 결과 |
|---|---|
| 권한 17종 · 역할 4종(`packages/shared-types/src/security.ts` 11·29~47·52~89행) | **신규 권한 0**: 채널 설정 `channel:write`(`channels.controller.ts` 19·30행) · 통계 `chatbot:read` · 큐 조회 `dialogue:read`·처리 `dialogue:write`(`unanswered-questions.controller.ts` 45~124행) |
| `AuditTargetType` 21종(`audit.ts` 53~82행) · 사용자 응답(설문)은 비감사(ADR-0035 선례) · 큐 비감사(ADR-0019 73~82행) | 평가·편입·"직접 수정 완료" **비감사**. 기능 스위치 변경은 기존 `Channel UPDATE` 감사 경로 |
| 영구삭제 사전검사 **14종**(`chatbots/chatbots.service.ts` 32~51행) | 평가 원장 +1 → **15종**(`CHILD_COUNT_LABELS`) |
| 설문 자유 텍스트 = 금지어 → PII 마스킹 후 저장(`schema.prisma` 1220~1221행) · 이름·주소 미탐(ADR-0013 §6) | 자유 텍스트 사유를 받으면 **"저장" 지점의 새 테이블**이 된다 + 보존기간 없음(ADR-0033) → 1차 제외 권고(J-11 · P-9) |
| `SurveyResponse`에 IP·UA·쿠키 컬럼 없음(1153~1154행) · `sessionId`는 API 응답·CSV 미노출(1164행) | 평가 원장은 **`sessionId`조차 저장하지 않는다**(세션 결합 검증은 로그 행으로 충분 — 최소 수집, FR-FB5-2) |

#### 1.3.7 경계 — 시뮬레이터 · TC · 설문 · 상담

| 사실 (파일:행) | 결과 |
|---|---|
| 시뮬레이터는 `ConversationLogService`를 주입하지 않는다(`simulation/simulation.service.ts` 46~51·268행) · TC 실행 동일(ADR-0030) | 평가는 **로그 행이 있어야** 성립하므로 시뮬레이터·TC 평가 적재는 **구조적으로 0건**(J-16) |
| 설문(No.27) = 노드 아웃풋이 시작하는 **멀티턴 세션**, 척도·자유 텍스트, 응답 원장(`SurveyResponse`/`SurveyAnswer`) · 설문 턴 `surveyTurn=true` | 설문 문항 말풍선은 평가 대상이 아니다(`surveyTurn` 제외 — J-2). 기능 차이는 §4.10 |
| 상담(No.24) 종료 후 버튼으로 설문 노드 연결(`ChatbotHandoffSetting.endButton*` 1253~1255행) | 상담원 평가는 **No.24의 종료 후 설문 경로**가 담당 — 👍/👎를 상담원 메시지에 붙이지 않는다(J-15) |

#### 1.3.8 관찰된 잠재 결함

이 그룹 범위 밖의 결함은 **발견하지 못했다**. 대신 이 그룹이 반드시 처리해야 하는 **제약 3건**을 기록한다.

| # | 내용 (파일:행) | 처리 |
|---|---|---|
| C-1 | 보류 답변 `READY` 표시가 로그 적재보다 먼저다(`rag-answer.service.ts` 153 → 155행) | 평가 API가 `404`면 위젯이 **1회 지연 재시도**(EX-FB-4). 서버 순서 변경은 ADR-0023 경로라 하지 않는다 |
| C-2 | 로그 적재 실패는 조용하다(`conversation-log.service.ts` 113~117행) | 평가 `404` — 사용자에게는 "저장하지 못했어요" 1줄(EX-FB-3) |
| C-3 | 큐 목록 DTO·필터가 소스를 모른다(`learning.ts` 52~83행) | FR-FB7-1~3에서 확장 |

**없다**: 평가 버튼 · 평가 API · 평가 원장 · 세션 결합 검증 · `NEGATIVE_FEEDBACK` 쓰기 경로 · 소스별 병합 키 · 소스 필터/표시 · "직접 수정 완료" 전이 · 만족도 집계 · 로그의 `inputKind`/평가 제공 여부 컬럼.

### 1.4 ★ 선결 쟁점 1 — 도입할 것인가, 1차를 어디까지 할 것인가 (P-1)

| 선택지 | 내용 | 원문 충족 | 비용 | 판정 |
|---|---|---|---|---|
| (a) 도입하지 않음 | No.44를 §4-1에 제안으로만 둔다 | ✕ | 0 | 가능한 선택. 이 경우 T-1~T-10은 "미도입"으로 닫고 `UnansweredSource`의 예고 주석만 정리 |
| (b) **수집 + 통계만** | 👍/👎 → 원장 → 만족도 통계. 큐 편입 없음 | △ — "큐에 자동 편입" 미충족 | 공개 경로 1 · 위젯 · 원장 · 통계 | 원문의 핵심(개선 **루프**)이 빠진다. "먼저 데이터를 모아 보고 판단" 목적이면 유효 |
| **(c) 단계 도입 1차** ★ | (b) + **👎 → 큐 자동 편입**(소스 분리·매칭 대상 표시·직접 수정 완료) | ○ | (b) + 큐 스키마(유일 키 변경)·DTO·화면 확장 | **권고.** 원문 세 요소를 모두 충족하는 최소 단위 |
| (d) 전부 | (c) + 사유 선택 + 자유 텍스트 + 통합 통계 + 상담 경고 연동 + 의도별 통계 | ○ | PII 저장소 신설(자유 텍스트)·통합 통계·No.24 판정 변경 | 1차 과다 — 2차·후속으로 분할(§9) |

### 1.5 ★ 선결 쟁점 2 — 평가 위변조 방어

`sessionId`는 위젯이 만든 난수이고 **인증 수단이 아니다**(ADR-0001/0009 · `apps/widget/src/core/session.ts` 39행). 그러나 이 그룹의 공개 경로는 No.24 상담 폴링과 성격이 다르다 — **쓰기 전용**이고 **대화 데이터를 돌려주지 않는다**(응답 = 평가값 에코뿐). 엿보기 위협이 없으므로 위협은 "남의 메시지를 평가·조작"과 "통계·큐 오염" 두 가지다.

| 위협 | 공격 방법 | 방어(권고안) | 남는 위험(수용) |
|---|---|---|---|
| **다른 세션의 메시지 평가** | 남의 `messageId`로 👎 | ① `messageId`는 **서버 발급 UUID v4**이고 **그 요청의 응답으로만** 전달된다(§1.3.1) ② 요청의 `sessionId` = 로그 행 `sessionId` **일치 필수** ③ 슬러그의 챗봇 = 로그 행 `chatbotId` 일치 필수 → 셋 중 하나라도 어긋나면 **존재하지 않는 것과 같은 `404`**(오라클 방지) | `messageId`와 `sessionId`를 **둘 다** 알아야 한다. `messageId`는 보류 폴링 URL(`GET …/messages/:messageId`)로 프록시 로그에 남을 수 있으나 `sessionId`는 URL에 없다 |
| **같은 메시지 중복 평가** | 버튼 연타·재전송·탭 복제 | 원장 **`conversationLogId` 유일**(메시지당 1행 upsert) · 같은 값 재요청은 멱등 `200` · 큐 기여는 **메시지당 최대 1회**(`queuedAt` 표식) | 없음 |
| **평가 변경·취소 반복** | 👍↔👎 토글로 통계 흔들기 | 변경 허용(**현재 값만 집계**) · 메시지당 **변경 5회**·**메시지 후 24시간** 이내(초과 `409`) · **취소(평가 해제)는 1차 미지원**(선택된 버튼 재클릭 = 무동작) · 큐 기여는 첫 👎 1회로 고정(토글로 큐를 부풀릴 수 없음) | 한 메시지의 현재 값은 마지막 변경이 이긴다(정상 UX) |
| **대량 자기 평가**(봇과 대화 → 전부 👎) | 스크립트로 세션·메시지 대량 생성 | 평가 1건 = **자기가 만든 대화 1턴** → 평가 속도는 **대화 레이트리밋**(`session` 30/분·`ip` 120/분)에 묶인다 · 큐 **소스별 `PENDING` 상한** · 통계에 표본 수 표기 | ★ **증폭이 없다** — 이미 존재하는 "미응답 문장을 대량 전송해 큐를 채우는" 위협과 **같은 등급**이다(ADR-0019가 수용한 위험). 평가가 새로 여는 공격면은 "답은 됐던 문장"을 큐에 넣는 것뿐이며 검토자가 무시하면 끝난다 |
| **폭주·레이트리밋 간섭** | 평가 요청 폭주 / 정상 사용자의 평가가 대화 전송을 429로 만듦 | **평가 전용 버킷**(IP축 + `messageId`축) · 대화 `ip`/`session` 버킷 **비소비**(K-1 교훈) · Origin 가드 상속 | Origin 헤더 없는 서버 간 호출은 통과(ADR-0011 설계) — 위 "대량 자기 평가"와 같은 한계 안 |
| **교차 챗봇** | 다른 슬러그로 평가 | 슬러그↔로그 `chatbotId` 불일치 = `404` | 없음 |
| **기능 꺼진 챗봇에 평가** | 설정을 끈 뒤 오래된 말풍선 클릭 | `404`(같은 코드) · 위젯은 "지금은 의견을 받을 수 없어요" | 없음 |

**서버 발급 토큰(No.24 상담 토큰)이 필요한가 → 불필요(권고).** 상담 토큰은 "`sessionId`만으로 **서버 데이터를 꺼내 주는**" 경로를 보호하려고 만들었다(`hybrid-cs.md` §1.4.2). 평가 경로는 ① 꺼내 주는 데이터가 없고 ② **`messageId` 자체가 이미 서버 발급·수신자 한정 난수**이며 ③ `sessionId` 결합으로 이중 확인된다. 토큰을 더하면 봉투 밖 저장 키·발급 규칙·해시 컬럼이 생길 뿐 막는 위협이 늘지 않는다. **재검토 트리거**: 평가 응답이 대화 데이터를 돌려주게 될 때(예: 👎 뒤 "다른 답변 보기").

### 1.6 ★ 선결 쟁점 3 — 큐 편입 기준과 큐 모델

#### 1.6.1 편입 기준

| 기준 | 장점 | 단점 | 판정 |
|---|---|---|---|
| **👎 1회 즉시**(메시지당 최대 1회 기여) ★ | 원문 "자동 편입"에 가장 가깝다 · 트래픽이 적은 챗봇에서도 신호가 보인다 · 미응답 수집과 같은 규칙(1회 발생 = 1행) | 한 사용자의 불만이 검토 대상이 된다 | **권고.** 노이즈는 **정렬·필터**로 흡수한다 — 목록 기본 정렬이 이미 `occurredCount`(= 👎 수) 내림차순이라 1회짜리는 아래로 간다(`unanswered-questions.service.ts` 146~147행) |
| 같은 질문에 👎 N회(또는 서로 다른 세션 N개) 누적 | 노이즈 감소 | 누적 전까지 저장할 곳이 필요(원장에서 정규화 질문별 집계 — 인덱스·조회 추가) · 저트래픽 챗봇에서 영영 안 올라옴 · 설정값 1개 추가 | 2차 선택지(챗봇별 임계값 1~10, 기본 1) |
| 👎 비율(예: 그 답변 평가 중 30% 이상) | 답변 품질 지표에 가깝다 | 분모(평가 수)가 작으면 불안정 · "질문" 단위 큐와 "답변" 단위 비율의 단위가 다르다 | 기각 — 만족도 **통계**(👎 상위 대상)가 이 역할을 한다 |

**편입 제외 규칙(권고)** — 평가 자체는 받되(통계 반영) **큐에는 넣지 않는** 턴:

| 턴 (로그 사실) | 이유 | 사유 코드(제안) |
|---|---|---|
| `isAnswered=false`(폴백·빈 입력 — API 고정 문구 제외) | 이미 `UNANSWERED`로 수집되어 있다. 중복 행을 만들지 않는다 | `ALREADY_UNANSWERED` |
| `apiNotice=true` | 외부 장애이지 학습 공백이 아니다(ADR-0034 §5 · `collect-decision.ts` 31행) | `API_NOTICE` |
| `inputKind=BUTTON_NODE` | 사용자가 쓴 질문이 아니라 봇이 준 선택지 라벨 — 의도 예문으로 부적합 | `BUTTON_NODE` |
| 정규화 결과 빈 문자열 · 200자 초과 | 기존 규칙 | `EMPTY` · `TOO_LONG` |
| `blockedByFilter`·`surveyTurn`·`handoffTurn` | **평가 불가 턴**이라 애초에 도달하지 않는다(J-2) | — |

→ 버튼 턴(`NODE`) 👎는 **통계에는 들어가고**(그 노드의 답변이 나쁘다는 신호) 큐에는 들어가지 않는다. 노드 답변 품질은 만족도 통계의 "👎 상위 대상"에서 드러난다.

#### 1.6.2 큐 모델 — 같은 질문이 두 소스에 있을 때

| 모델 | 구조 | 판정 |
|---|---|---|
| X. 같은 행 + 카운터 | 유일 키 그대로, 행에 `negativeFeedbackCount` 추가. `source`는 최초 수집 소스 | 기각 — `occurredCount`의 의미가 섞인다(미응답 발생 수 + ?). "못 답함"과 "답했는데 틀림"은 **처방이 다르다**(예문 추가 vs 답변 수정)인데 한 행에서 한 번에 처리된다 |
| **Y. 소스 분리** ★ | 유일 키를 **`(chatbotId, source, questionNormalized)`** 로. 같은 질문이 두 소스에 **각각 1행** | **권고.** ADR-0019 91행의 의도("소스 구분") 그대로. 기존 행은 전부 `UNANSWERED`라 **키 변경에 데이터 충돌 0**. 수집기의 `findUnique` 키·P2002 재시도 키만 바뀐다 |
| Z. 별도 테이블 | `NegativeFeedbackQuestion` | 기각 — ADR-0019 91행 "테이블을 쪼개지 않으려고 `source`를 둔다"에 정면 배치. 반영 흐름·추천·일괄 처리 복제 |

> 두 행은 **시간상 자연스럽게 분리**된다: 처음엔 못 답해서 `UNANSWERED`로 들어오고, 관리자가 의도를 연결한 뒤 이번엔 **틀리게** 답하면 👎로 `NEGATIVE_FEEDBACK`에 들어온다. 목록에서 두 행이 나란히 보이면 "반영은 했지만 오답"이라는 사실 자체가 정보다(화면에 "같은 질문의 다른 소스 항목" 링크 — FR-FB7-5).

### 1.7 ★ 선결 쟁점 4 — 자유 텍스트 사유

| 선택지 | 얻는 것 | 치르는 것 | 판정 |
|---|---|---|---|
| **(a) 사유 없음** ★(1차) | 개인정보 저장소 신설 0 · 위젯 증가 최소 · 금지어·마스킹·보존 논의 0 | 원인 분류를 관리자가 질문·답변 쌍을 보고 판단 | **1차 권고.** 큐 상세에 **질문(마스킹본)·당시 봇 답변(마스킹본)·매칭 대상**이 함께 보이므로 판단 재료는 충분하다(FR-FB7-2) |
| (b) 고정 사유 코드(선택형 3~4개: "질문과 다른 답변" · "정보가 틀리거나 오래됨" · "이해하기 어려움" · "기타") | 원인 분류 자동화(잘못 매칭 ↔ 내용 오류) · 개인정보 0 | 위젯 상태 1단계 추가(👎 후 선택지 표시·건너뛰기·접근성) · 통계 차원 추가 | **2차 권고** — nullable 컬럼 1개라 나중에 추가해도 마이그레이션 부담이 없다 |
| (c) 자유 텍스트 | 풍부한 맥락 | ★ **"저장" 지점의 새 테이블**(설문 자유 텍스트에 이은 사용자 작성 텍스트) · 금지어 → PII 마스킹 필수(ADR-0013 — 이름·주소 미탐) · **보존기간 정책 없음**(무기한 — ADR-0033) · 감사·로그·CSV 누출 봉인 · 스팸 텍스트 저장 · 요약·감성 분석 요구로 이어짐(GPU/외부 LLM — T-7) | **후속** — No.45(보존·파기) 선행 또는 동시. 받게 되면 설문 자유 텍스트와 **같은 함수·같은 순서·같은 봉인**을 따른다 |

### 1.8 목적

1. 최종 사용자가 **봇 답변마다** 한 번의 클릭으로 "도움이 됐어요 / 도움이 안 됐어요"를 남길 수 있다.
2. 👎를 받은 질문이 **학습현황 큐에 자동으로** 올라오고, 관리자는 **당시 봇이 무엇으로 답했는지**(의도·FAQ·노드·문서 답변)를 보고 **예문 추가(잘못 매칭)** 또는 **답변 수정(내용 오류)** 으로 처리한다 — No.15 반자동 루프의 입력 확장.
3. 운영자는 챗봇별 **답변 만족도**(평가 수·긍정률·참여율·추이·👎가 몰린 답변)를 본다.
4. **대화 엔진·시뮬레이터·TC·버전·예약 배포·대시보드의 동작이 바이트 단위로 동일**하고, 기능이 꺼진 챗봇(기본)의 공개 대화도 바이트 동일하다.
5. 평가는 **자기가 받은 답변에만** 남길 수 있으며, 평가 경로가 **원문·새 개인정보 저장소를 만들지 않는다**.

### 1.9 이 문서의 핵심 판단 19건 (⚠ = PM 확인 필요)

> **PM 결정(2026-09-25)** — **No.44 도입 확정**, ⚠ 표시 항목을 포함해 아래 "결정(제안)" 열이 **전부 권고안대로 확정**되었다(§11 P-1~P-16). J-13·J-19 등 architect 확정 사항과 요구사항 대비 조정은 설계서 §25에 있다: 스위치 = WEB config **선택 키**(D-1) · 큐 기여 1회 = 원장 **선점 상태 기계**(D-4) · `queuedQuestionId` → `queueItemId`(D-5) · 큐 쓰기 파일 **3개 불변**(D-6 — 정정) · `@Public` 단언 = 숫자 5 + 제목 1(D-7) · No.14 딥링크 `source` 조건(D-8) · 통계 쿼리 ≤7(D-12). 세부 설계: `docs/02-spec/feedback-loop-설계.md` · ADR-0038.

| # | 쟁점 | 결정(제안) | 근거 요약 |
|---|---|---|---|
| **J-1** | ⚠ ★ **도입·범위** | **단계 도입 (c)**: 1차 = 위젯 👍/👎 + 공개 평가 API + 평가 원장 + 👎 큐 자동 편입(소스 분리·매칭 대상·직접 수정 완료) + 챗봇 스코프 만족도 섹션. 2차 = 사유 코드·그룹/전역 통계·의도별 👎 열·편입 임계 설정·상담 콘솔 👎 배지. 후속 = 자유 텍스트·상담 경고 연동·비WEB 채널 | §1.4. 원문 세 요소를 충족하는 최소 단위 |
| **J-2** | **평가 단위·평가 가능 턴** | 평가 단위 = **봇 응답 턴 1개**(`messageId` = `ConversationLog.id`). 평가 가능 = 기능 켜짐 ∧ 위젯 `feedback-v1` 선언 ∧ **BLOCK·설문 턴·상담 턴이 아님**. 폴백(미응답)·API 고정 문구·RAG 답변·버튼 턴은 **평가 가능**(만족도에는 반영, 큐 편입은 §1.6.1 제외 규칙) | 사용자 입장에서 "답을 받은 말풍선"에는 전부 의견을 낼 수 있어야 만족도가 왜곡되지 않는다 |
| **J-3** | ⚠ **공개 표면** | **신규 `@Public()` 1개**(7 → 8): `PUT /public/chatbots/:slug/messages/:messageId/feedback`(메서드·경로는 architect). 대화 전송 경로에 평가를 편승시키는 안 기각 | 평가는 턴이 아니다 — 편승하면 엔진 파이프라인·로그·레이트리밋 버킷을 오염시킨다 |
| **J-4** | ⚠ ★ **위변조 방어** | **`messageId`(서버 발급·수신자 한정) + `sessionId` 결합 + 슬러그 일치** 검증, 불일치는 전부 같은 `404`. **신규 토큰 없음.** 메시지당 원장 1행(upsert) · 변경 허용(24시간·5회) · **취소 미지원** · 큐 기여 메시지당 1회 | §1.5 |
| **J-5** | ⚠ **레이트리밋** | **평가 전용 버킷**(IP축 기본 120/분 + `messageId`축 기본 10/분) · 대화 `ip`/`session` 버킷 **비소비** · Origin 가드 상속 | K-1(No.24) 교훈 — 평가가 다음 질문 전송을 429로 만들면 안 된다 |
| **J-6** | **평가 원장** | 신규 `MessageFeedback`: 메시지당 1행 · 평가값·변경 횟수·**턴 사실 비정규화 복사**(매칭 대상·응답 여부·RAG·토픽·그룹·`dayBucket`) · 큐 편입 표식. **텍스트 0 · `sessionId` 0 · IP/UA 0** · 쓰기 1파일 · 삭제 0(봉인) · 스냅샷 밖 | 로그 `update` 0(R-10) · Prisma groupBy 조인 불가 → 비정규화 · 최소 수집 |
| **J-7** | ⚠ ★ **큐 편입 기준** | **👎 1회 즉시 편입(메시지당 최대 1회 기여)** + 제외 규칙 5종(§1.6.1). 👎 → 👍 변경해도 큐 기여는 유지(검토 후보 목록일 뿐) | §1.6.1. 노이즈는 정렬·필터로 흡수 |
| **J-8** | ⚠ **큐 모델** | **소스 분리** — 유일 키 `(chatbotId, source, questionNormalized)` · `UnansweredSource` +`NEGATIVE_FEEDBACK` · 쓰기 주체 2곳 유지(수집기에 진입 메서드 추가) · **소스별 `PENDING` 상한** · 재발생 규칙 동일 | §1.6.2 · ADR-0019 91행 |
| **J-9** | ⚠ **잘못 매칭 대상 표시·처리** | 👎 항목에 **최근 👎 턴의 매칭 대상**(의도·FAQ·노드·문서 답변·폴백 — 이름, 삭제 시 "삭제됨")과 **당시 봇 답변(마스킹본)** 표시. 처리 = ① 기존 **반영**(올바른 의도에 예문 추가 — 현재 매칭 의도와 같으면 경고) ② **"직접 수정 완료"** 신규 전이(`RESOLVED` + `resolvedIntentId=null`) ③ 무시 ④ 대상 편집 화면 링크 | 원인이 매칭이면 예문, 내용이면 답변 수정 — 처방이 둘이다 |
| **J-10** | ⚠ **👍 반영** | 1차 **큐 비반영**(통계만). "같은 질문 👍 n건" 표시는 2차 | 👍는 개선 대상이 아니라는 신호 — 큐는 "검토할 것" 목록이다. 👍마다 큐를 조회·갱신하면 대화 경로 외 쓰기가 늘어난다 |
| **J-11** | ⚠ ★ **자유 텍스트 사유** | **1차 없음.** 2차 = 고정 사유 코드(선택형). 자유 텍스트는 후속(No.45 연동 — 마스킹·금지어·보존·봉인) | §1.7 |
| **J-12** | ⚠ **통계 위치** | **No.14 챗봇 스코프 통계 화면의 "답변 만족도" 섹션**(신규 엔드포인트 1개, `chatbot:read`): 👍·👎 수 · 긍정률 · 참여율(분모 = 평가 버튼을 제공한 턴) · 일별 추이 · 👎 상위 대상. **대시보드(No.2) 불변** · 통합 통계(No.29)·의도별 👎 열은 2차(원장에 `groupId` 스냅샷은 지금 적재) | FR-0-90 · T-5 · `topicId` "지금 적재" 선례(`topic-system.md` P-12) |
| **J-13** | **기능 스위치**(architect) | **WEB 채널 설정 `feedbackEnabled`**(기본 꺼짐, `channel:write`) — `access.resolve()`가 이미 읽는 행이라 **추가 조회 0** · 버전 스냅샷 밖(채널 제외 — ADR-0031) | `ChatbotAnswerSetting` 동거는 버전 복원이 지운다(`schema.prisma` 1234~1237행 교훈). 평가 버튼은 위젯 표시 설정 성격 |
| **J-14** | ⚠ **위젯 변경** | **필수.** 기능 선언 `feedback-v1` · 응답 선택 필드(평가 가능 표시)가 있는 봇 말풍선 아래에만 버튼 2개(텍스트 접근 이름·`aria-pressed`) · 변경 가능 · 실패 조용히 1회 재시도 · vanilla·100KB 게이트 | §1.3.4 |
| **J-15** | ⚠ **No.27·No.24 경계** | 설문 = 설계자가 배치한 **대화 단위 명시 조사**(척도·자유 텍스트·참여 통계), 평가 = **답변 단위 암묵 품질 신호 → 학습 큐**. 중복 아님. **상담원 메시지·상담 턴 평가 없음**(상담원 평가는 No.24 종료 후 설문 노드). 설문 문항 말풍선 평가 없음 | §4.10 |
| **J-16** | ⚠ **시뮬레이터·TC** | **평가 적재 0건**(구조 — 로그 행 없음 · 공개 경로 전용) · 시뮬레이터 화면에 평가 버튼 없음 | ADR-0030 격리 · 품질 표시는 TC(No.19)의 몫 |
| **J-17** | ⚠ **권한·감사** | **신규 권한·역할·`AuditTargetType`·`AuditAction` 0.** 평가·편입·직접 수정 완료 **비감사**(사용자 응답·큐 상태 선례). 스위치 변경은 기존 `Channel UPDATE` | ADR-0015 · ADR-0019 §6 · ADR-0035 |
| **J-18** | **GPU · 배포 형태** | **카탈로그 2 유지**(신규 연산 1 — 추천은 기존 No.23/문자 유사도) · 구축형 ○ · 구독형 ○ | §4.12 · §4.13 |
| **J-19** | **버튼 턴 판별**(architect) | `ConversationLog.inputKind` 컬럼 추가(ADR-0019 57행 트리거 발동) — 적재 시점 확정·`record()` 1곳·`update` 0 유지. 기존 행은 null(= 편입 보수적 제외) | T-10. 평가는 턴 이후에 도착 |

### 1.10 전체 흐름 (이 문서가 만드는 것)

```
■ 준비 (EDITOR/ADMIN, 챗봇 상세 > 채널 > WEB)
  [답변 평가 받기] 켜기 → WebChannelConfig.feedbackEnabled = true (감사: Channel UPDATE)

■ 대화 (공개 위젯 → apps/api, 턴마다 — 추가 DB 조회 0)
  위젯 요청 features: ['feedback-v1'(, 'handoff-v1')]
  … 기존 파이프라인 그대로(BLOCK·상담 게이트·엔진·RAG) …
  응답 조립 시 순수 판정 isFeedbackOffered(채널 설정, features, 턴 사실)
     true  → 응답에 feedback: { rateable: true }  · record({ …, feedbackOffered: true, inputKind })
     false → 응답 바이트 동일                       · record({ …, feedbackOffered: false, inputKind })
  (보류 RAG 턴: POST 응답의 표시가 최종 답변 말풍선에 적용 — 보류 폴링 스키마 무변경)

■ 위젯
  평가 가능 봇 말풍선 아래 [도움이 됐어요] [도움이 안 됐어요]  (aria-pressed · 상태 영역 1회 안내)

■ 평가 (공개 — @Public 8번째, 평가 전용 버킷 · Origin 가드)
  PUT /public/chatbots/:slug/messages/:messageId/feedback  { sessionId, rating: UP|DOWN }
   ① access.resolve(slug) — 기능 꺼짐 → 404
   ② ConversationLog findUnique(id=messageId) — 없음·챗봇 불일치·sessionId 불일치·feedbackOffered=false → 404
   ③ MessageFeedback upsert(conversationLogId 유일) — 24시간·5회 초과 → 409 · 같은 값 → 멱등
   ④ rating=DOWN ∧ queuedAt 없음 → UnansweredCollectorService.collectNegativeFeedback(로그 마스킹본)
        제외 규칙(ALREADY_UNANSWERED·API_NOTICE·BUTTON_NODE·EMPTY·TOO_LONG) → 편입 0
        통과 → (chatbotId, NEGATIVE_FEEDBACK, normalized) upsert · 재발생 규칙 · 소스별 상한
        성공 → MessageFeedback.queuedAt 기록  (실패는 흡수 — 평가 응답은 성공)
   ⑤ 200 { rating }

■ 학습현황 (dialogue:read / dialogue:write)
  소스 필터 [전체 | 답변 못함 | 부정 평가] · 부정 평가 항목 = 질문 · 당시 답변 · 매칭 대상 · 👎 n회 · 추천(현재 매칭 배지)
  처리: 반영(예문) · 직접 수정 완료 · 무시 · [대상 편집으로 이동]

■ 통계 (chatbot:read) — No.14 화면 "답변 만족도" 섹션
  👍 n · 👎 n · 긍정률 · 참여율(평가/평가 버튼 제공 턴) · 일별 추이 · 👎 상위 대상(FAQ/의도/노드/문서 답변/폴백)

■ 봉인 (CI 정적 검사)
  messageFeedback 삭제 0 · 쓰기 1파일 · @Public 8 · 로그 update 0 유지 · 원장에 텍스트/sessionId 컬럼 0 · 엔진 수정 0
```

---

## 2. 사용자 역할 및 시나리오

### 2.1 역할

| 역할 | 이 그룹에서의 활동 | 권한(기존) |
|---|---|---|
| **ADMIN / EDITOR** | 기능 켜기(WEB 채널 설정) · 학습현황에서 부정 평가 항목 처리 · 만족도 통계 조회 | `channel:write` · `dialogue:read`/`dialogue:write` · `chatbot:read` |
| **VIEWER** | 만족도 통계·학습현황 조회(처리 불가) | `chatbot:read` · `dialogue:read` |
| **AGENT** | 변경 없음(학습현황·대화 설계 접근 불가 — `dialogue:*` 없음) | — |
| 최종 사용자 | 봇 답변 평가 · 평가 변경 | — |

### 2.2 사용자 시나리오

**S-1. 평가 남기기 (최종 사용자 · ★ 핵심)**
사용자가 "해외 배송 되나요?"를 보내자 봇이 FAQ "해외 배송 안내" 답변을 보여 준다. 말풍선 아래 작은 버튼 `도움이 됐어요` `도움이 안 됐어요`가 있다. 답이 국내 배송 이야기라 `도움이 안 됐어요`를 누르면 버튼이 선택 상태가 되고 상태 영역이 "의견을 보내 주셔서 고마워요"를 한 번 읽는다. 대화는 막히지 않는다.

**S-2. 평가 바꾸기 (최종 사용자)**
실수로 👎를 눌렀던 사용자가 `도움이 됐어요`를 누른다. 선택이 바뀌고 같은 안내가 다시 1회 나온다. 선택된 버튼을 다시 누르면 아무 일도 일어나지 않는다(취소 없음).

**S-3. 큐에 올라온 부정 평가 (EDITOR · ★)**
학습현황 탭에 "부정 평가 3" 배지가 보인다. 소스 필터 `부정 평가`를 고르면 "해외 배송 되나요?"가 👎 2회로 맨 위에 있고, 행에 "당시 답변: FAQ 해외 배송 안내"가 보인다. 상세를 열면 당시 봇 답변 전문(마스킹본)과 추천 의도 3개가 있고, 1위 추천 `배송_문의`에 "현재 매칭" 배지가, 2위 `해외배송_문의`에는 없다.

**S-4. 잘못 매칭 → 예문 추가 (EDITOR)**
관리자가 `해외배송_문의`를 골라 반영한다. 기존 반영 흐름 그대로 예문이 추가되고 항목이 `반영 완료`가 된다. 이후 같은 질문에 또 👎가 오면 행에 "반영 후 재발생 1회" 배지가 붙는다.

**S-5. 내용 오류 → 직접 수정 완료 (EDITOR)**
다른 항목 "환불 기간이 얼마예요?"는 매칭 대상이 FAQ "환불 안내"로 맞지만 답변의 기간이 옛 정책이다. 관리자가 `FAQ 편집으로 이동`을 눌러 답변을 고친 뒤 돌아와 `직접 수정 완료`를 누른다. 항목은 `반영 완료(직접 수정)`로 표시된다.

**S-6. 미응답과 부정 평가가 함께 있는 질문 (EDITOR)**
"포인트 합산되나요?"는 지난주엔 `답변 못함`으로 반영 완료됐고 이번 주엔 `부정 평가`로 다시 올라왔다. 부정 평가 상세에 "같은 질문의 답변 못함 항목(반영 완료)" 링크가 있다.

**S-7. 만족도 보기 (VIEWER)**
통계 화면의 `답변 만족도` 섹션에서 지난 30일 평가 412건 · 긍정률 71%(표본 412) · 참여율 6.3% · 일별 추이와 "👎가 가장 많은 답변" 표(FAQ "환불 안내" 👎 38 / 👍 12, 노드 "배송 조회" 👎 21 …)를 본다. 질문 문장은 이 표에 없다.

**S-8. 폴백 답변 평가 (최종 사용자)**
"주차 되나요?"에 봇이 "잘 모르겠어요"라고 답하자 사용자가 👎를 누른다. 평가는 저장되어 만족도에 반영되지만, 이 질문은 이미 `답변 못함`으로 큐에 있으므로 부정 평가 행은 새로 생기지 않는다.

**S-9. 기능 켜기 (EDITOR)**
챗봇 상세 > 채널 > WEB에서 `답변 평가 받기`를 켠다. 켜기 전에 나간 말풍선에는 버튼이 없고, 이후 새 답변부터 버튼이 붙는다. 끄면 새 답변에는 버튼이 없고, 이미 떠 있던 버튼을 누르면 "지금은 의견을 받을 수 없어요"가 나온다.

**S-10. 접근성 (최종 사용자)**
스크린리더 사용자는 말풍선 뒤에서 "도움이 됐어요, 전환 버튼, 선택 안 됨"을 듣는다. 버튼은 아이콘과 함께 텍스트 이름을 가지며, 누른 뒤 메시지 목록 전체가 다시 읽히지 않는다.

---

## 3. 공통 기능 요구사항 (FR-0)

선행 15개 그룹의 FR-0-1~137을 **상속**한다.

| ID | 요구사항 | 비고 |
|---|---|---|
| FR-0-138 | **대화 엔진(`packages/dialogue-engine`)·번들·봉투 스키마를 수정하지 않는다.** 평가 가능 판정은 API 계층의 순수 함수이며 이미 가진 턴 사실만 쓴다 | J-2 |
| FR-0-139 | **기능이 꺼진 챗봇(기본값) 또는 `feedback-v1`을 선언하지 않은 위젯**에서 공개 대화·시뮬레이션·비교·TC·통계·버전·예약 배포·상담의 결과가 **바이트 단위로 동일**하고 공개 대화 경로의 **추가 DB 조회가 0건**이다(스위치는 `access.resolve()`가 이미 읽는 WEB 채널 행). 로그의 신규 컬럼은 기본값으로 적재된다. 기존 테스트는 FR-0-146 목록 외에 **수정 없이** 통과한다 | 회귀 방지 |
| FR-0-140 | **`@Public()` 핸들러는 정확히 8개**다(평가 1개 추가 — 의도적 갱신). 평가는 대화 전송 경로(`POST …/messages`)로 받지 않는다 | J-3 |
| FR-0-141 | **평가 원장(`MessageFeedback`)의 쓰기 주체는 1파일**이며 `delete`/`deleteMany`/원시 `DELETE`는 운영 코드 **0건**(ADR-0033 봉인 확장). `ConversationLog`의 `update*`/`upsert` 0건(R-10)은 유지된다. `UnansweredQuestion` 쓰기 주체는 **여전히 2곳**(수집기·상태 전이 서비스)이다 | J-6 · J-8 |
| FR-0-142 | 평가 경로는 **원문에 접근하지 않는다** — 큐 편입 문장은 `ConversationLog.userMessage`(마스킹본)에서만 온다. 평가 원장에 **텍스트 컬럼·`sessionId`·IP·User-Agent가 없다**. 서버 로그·오류 응답에 질문·답변 본문·`sessionId` 전체값을 남기지 않는다(`chatbotId`·결과 코드만) | ADR-0013 · J-11 |
| FR-0-143 | 시뮬레이터·비교·TC 실행·스냅샷 캡처/복원·예약 배포 실행기는 **평가 서비스를 주입하지 않는다**(DI 그래프 부재). 평가 원장·기능 스위치는 **스냅샷 밖**이다 | J-16 · ADR-0030/0031 |
| FR-0-144 | **신규 권한 0 · 신규 역할 0 · 신규 `AuditTargetType`·`AuditAction` 0** | J-17 |
| FR-0-145 | **[확정 2026-09-25 — 제안 2종 그대로. 직접 수정 완료의 미응답 항목은 기존 `INVALID_STATUS_TRANSITION`(400)·이미 처리됨은 `ALREADY_RESOLVED`(409) 재사용 — 설계서 §16.3]** 신규 `ApiErrorCode`(제안): `FEEDBACK_TARGET_NOT_FOUND`(404 — 메시지 없음·챗봇/세션 불일치·평가 불가 턴·기능 꺼짐을 **구분하지 않는다**) · `FEEDBACK_CLOSED`(409 — 변경 기한·횟수 초과). 오류 봉투 형식 불변. 공개 오류 문구에 내부 용어 없음 | ADR-0003 · 오라클 방지 |
| FR-0-146 | **[확정 2026-09-25 — 설계서 §21.2 닫힌 목록 X-1~X-8: `@Public` 숫자 단언 5파일(`public-decorator-count`·`version-sealing`·`validation-sealing`·`deploy-schedule-sealing`·`handoff-sealing` 7 → 8) · `topic-sealing.spec.ts`는 **제목 문자열만**(총수 단언 없음) · `chatbots.service.spec.ts` Prisma 목에 `messageFeedback.count`(단언 변경 0) · 위젯 `public-client.spec.ts` `features` 기대값. 컨트롤러 수 34 불변 · `UnansweredSource`·`CHILD_COUNT_LABELS`·수집기 키를 단언하는 기존 시험 없음 · R-2/R-6 대상 확장 없음(원장은 F-1~F-5로 별도 봉인)] 초안:** **의도된 기대값 변경(목록 — architect가 전수 확인해 닫힌 목록으로 확정)**: `@Public` **7 → 8** 단언 6파일(`public-decorator-count.spec.ts` · `version-sealing.spec.ts` · `validation-sealing.spec.ts` · `deploy-schedule-sealing.spec.ts` · `handoff-sealing.spec.ts` · `topic-sealing.spec.ts`) · 컨트롤러 수 단언(신규 컨트롤러가 생기면) · `CHILD_COUNT_LABELS` 14 → 15 · `UnansweredSource` 1 → 2종 · 수집기 유일 키 이름 변경에 따른 수집기 단위 테스트 · R-2/R-6 대상 확장 여부 | 회귀 방지 |
| FR-0-147 | 최종 사용자 문구에 "피드백 원장"·"큐"·"학습" 같은 **내부 용어를 쓰지 않는다**. 콘솔 문구는 "부정 평가"(👎)·"긍정 평가"(👍)·"답변 평가"로 통일 | UIUX |
| FR-0-148 | **신규 환경변수는 선택·기본값**만 둔다(레이트리밋 상한·변경 기한·변경 횟수·부정 평가 `PENDING` 상한). 기동 조건 아님 | 운영 단순화 |

---

## 4. 기능별 요구사항

### 4.1 기능 스위치 · 범위 — J-1 · J-13

| ID | 요구사항 |
|---|---|
| FR-FB1-1 | `WebChannelConfig`에 **`feedbackEnabled: boolean`(기본 false)** 를 추가한다(`.strict()` 스키마 확장 — 기존 저장값은 키가 없으므로 false). 편집 권한 `channel:write`, 감사는 기존 `Channel UPDATE` 경로. **저장 위치는 architect 확정 — [확정 2026-09-25] WEB 채널 config의 선택 키 `feedbackEnabled?`(없음 = 꺼짐. `.default(false)`는 기존 채널 응답·파싱 결과 바이트를 바꿔 기각 · 1:1 설정 테이블은 대화 턴 추가 조회를 만들어 기각 — 설계서 §5.1 · ADR-0038 §5)**(권고 근거: `access.resolve()`가 요청마다 이미 읽음 → 추가 조회 0 · 채널은 버전 스냅샷 밖 · `ChatbotAnswerSetting`은 복원 대상이라 부적합). |
| FR-FB1-2 | 1차 대상 채널은 **WEB만**이다(비WEB 채널은 위젯 UI가 없다 — No.11/46). |
| FR-FB1-3 | 끄면 **새 응답에 평가 표시가 붙지 않고**, 이미 표시된 말풍선의 평가 요청은 `404 FEEDBACK_TARGET_NOT_FOUND`다. 저장된 평가·큐 항목·통계는 그대로 남는다. |
| FR-FB1-4 | 기능 스위치와 별도로 "평가는 받되 큐 편입은 끄기" 설정은 **1차에 두지 않는다**(2차 후보 — 편입 임계 설정과 함께). |

### 4.2 평가 가능 판정 — J-2 · J-19

| ID | 요구사항 |
|---|---|
| FR-FB2-1 | 순수 함수 1개 **`isFeedbackOffered(input)`** 가 판정한다(DB·Nest 무의존): 입력 = 기능 스위치 · 요청 `features` · 턴 사실(`blockedByFilter`·`surveyTurn`·`handoffTurn`). 참 조건 = 스위치 켜짐 ∧ `features`에 `'feedback-v1'` ∧ BLOCK 아님 ∧ 설문 턴 아님 ∧ 상담 턴 아님. |
| FR-FB2-2 | 참이면 공개 응답에 **선택 필드 `feedback: { rateable: true }`**(형태는 architect — 없으면 바이트 동일 — **[확정] `feedback: { rateable: true }`를 응답 객체의 마지막 키로 조건부 전개 · 판정은 `features`를 먼저 봐 미선언 위젯은 설정 파싱조차 없음 — 설계서 §6.2**)를 싣고, `record()`에 **`feedbackOffered: true`** 를 넘긴다. 보류 RAG 턴은 POST 응답(대기 문구)에 표시를 싣고 로그는 백그라운드 완료 시 같은 값으로 적재한다(`RagAnswerRunInput`에 전달 — 보류 폴링 스키마 무변경, ADR-0023). |
| FR-FB2-3 | `ConversationLog`에 **`feedbackOffered Boolean @default(false)`** 와 **`inputKind String?`**(J-19)를 추가한다 — 쓰기 주체 `record()` 1곳(파라미터), 적재 시점 확정, `update` 0 유지, 인덱스 없음, 백필 없음(기존 행 = false/null이 사실). |
| FR-FB2-4 | 평가 API는 로그 행의 `feedbackOffered=true`만 받는다 — 버튼을 제공하지 않은 턴(기능 켜기 전·구버전 위젯·BLOCK·설문·상담)은 `404`. |
| FR-FB2-5 | 폴백·API 고정 문구·RAG 답변·버튼 턴은 **평가 가능**하다(만족도에 반영). 큐 편입 여부는 §4.6 규칙이 따로 정한다. |

### 4.3 공개 평가 API — J-3 · J-4

| ID | 요구사항 |
|---|---|
| FR-FB3-1 | 신규 `@Public()` 1개: **`PUT /public/chatbots/:slug/messages/:messageId/feedback`**(권고 — 멱등 설정 의미. 메서드·경로는 architect 확정 — **[확정] 권고 그대로 `PUT` · 핸들러 `PublicConversationController#submitFeedback`(파일 끝 — `pollHandoff` 뒤) · 판정 순서는 설계서 §7.2**), 본문 `{ sessionId: uuid, rating: 'UP' \| 'DOWN' }`, 응답 `200 { rating }`. 기존 공개 컨트롤러에 두어 레이트리밋 → Origin 가드 순서를 상속한다. `Cache-Control: no-store`. |
| FR-FB3-2 | 처리 순서: ① `access.resolve(slug)`(비공개·채널 닫힘 = 기존 403 규약) ② 기능 꺼짐 → `404` ③ `messageId` UUID 형식 검사(아니면 `404` — 형식 오류로 존재 여부를 흘리지 않음) ④ `ConversationLog` PK 조회 1회 ⑤ 행 없음 · `chatbotId` 불일치 · `sessionId` 불일치 · `feedbackOffered=false` → **모두 같은 `404 FEEDBACK_TARGET_NOT_FOUND`** ⑥ 원장 upsert ⑦ 조건부 큐 편입(§4.6) ⑧ `200`. |
| FR-FB3-3 | 응답은 **평가값만** 돌려준다 — 대화 텍스트·매칭 정보·큐 상태·내부 id·집계를 싣지 않는다. |
| FR-FB3-4 | 같은 값 재요청은 **멱등**(`200`, 변경 횟수 불변). 다른 값이면 변경으로 처리(FR-FB4-2). |
| FR-FB3-5 | 평가 API는 **대화 파이프라인을 호출하지 않는다**(엔진·번들·의미 점수·RAG·상담 게이트·금지어 필터 0). 봉투(`state`)를 받지도 돌려주지도 않는다. |

### 4.4 위변조 · 어뷰징 방어 — J-4 · J-5

| ID | 요구사항 |
|---|---|
| FR-FB4-1 | **결합 검증**: 평가는 (슬러그의 챗봇, 요청 `sessionId`, `messageId`)가 로그 행의 (`chatbotId`, `sessionId`, `id`)와 **모두 일치**할 때만 저장된다. 서버 발급 토큰은 두지 않는다(§1.5 판단 — 재검토 트리거: 평가 응답이 대화 데이터를 돌려주게 될 때). |
| FR-FB4-2 | **변경 제한**: 메시지당 원장 1행. 값 변경은 **로그 행 `createdAt` + 24시간 이내 · 누적 5회 이내**(선택 환경변수)만 허용, 초과는 `409 FEEDBACK_CLOSED`. 최초 저장은 24시간 제한만 적용. |
| FR-FB4-3 | **취소(평가 해제)는 1차에 지원하지 않는다** — 원장에 "평가 없음" 상태가 없다. |
| FR-FB4-4 | **평가 전용 레이트리밋 버킷**: IP축(기본 120/분 — `PUBLIC_FEEDBACK_RATE_LIMIT_IP_PER_MIN`) + `messageId`축(기본 10/분 — `PUBLIC_FEEDBACK_RATE_LIMIT_MESSAGE_PER_MIN`). **대화 `ip`/`session` 버킷과 폴링 `poll-ip` 버킷을 소비하지 않는다.** 구현은 `@PublicRateBucket()` 확장 또는 동등 — architect. **[확정] `kind: 'POLL' | 'FEEDBACK'` 확장 · `FEEDBACK` = `fb-ip:{ip}` + `fb-key:msg:{messageId}`(폴링 `poll-ip`와도 공유하지 않음) · `POLL` 동작 바이트 불변 — 설계서 §8** |
| FR-FB4-5 | 큐 기여는 **메시지당 최대 1회**(원장 `queuedAt` 표식 — 조건부 갱신으로 동시 요청에도 1회 — **[architect 조정] `queuedAt` 1개로는 "선점 후 실패"를 표현할 수 없어 원장에 선점 상태 `queueOutcome`(`CLAIMED`→`QUEUED`｜`SKIPPED`｜`FAILED`)·`queueSkipCode`를 두고 `updateMany where queueOutcome IS NULL` 선점에 성공한 요청만 편입한다. `queuedAt`은 `QUEUED`일 때만 기록(AC-FB4-6 그대로) — 설계서 §9.4**). 👎 → 👍 → 👎 토글은 큐를 다시 늘리지 않는다. |
| FR-FB4-6 | 동시 요청(같은 메시지에 두 값이 겹침)은 원장 유일 키로 1행에 수렴하며 최종 값은 마지막 커밋이다. 변경 횟수는 ±1 오차를 허용한다(ADR-0019 감수 비용 2 선례). |

### 4.5 평가 원장 — J-6

| ID | 요구사항 |
|---|---|
| FR-FB5-1 | 신규 `MessageFeedback`(§5.2). **`conversationLogId` 유일**(FK 없음 — 로그 규약), `chatbotId` FK `Restrict`. |
| FR-FB5-2 | **최소 수집**: 텍스트·`sessionId`·IP·UA·쿠키·로그인 식별자 컬럼이 **존재하지 않는다**. |
| FR-FB5-3 | 최초 저장 시 로그 행의 **턴 사실을 복사**한다(적재 후 불변): `groupId`(대화 당시 스냅샷) · 턴 `dayBucket` · 턴 `createdAt` · `channelType` · `isAnswered` · `answeredByRag` · `apiNotice` · `matchedIntentId`·`matchedFaqId`·`matchedNodeId` · `topicId` · `inputKind`. 값 변경 시에는 `rating`·`changeCount`·`updatedAt`만 바뀐다. |
| FR-FB5-4 | 원장은 **삭제 경로 0**(봉인) · 챗봇 영구삭제 사전검사 대상(`CHILD_COUNT_LABELS` +`messageFeedbacks: '답변 평가'` → 15종) · 무기한 보존(알려진 리스크 — No.45). |
| FR-FB5-5 | 원장은 **버전 스냅샷·챗봇 복사·토픽 분리 대상이 아니다**(대화 기록 성격). |

### 4.6 학습현황 큐 편입 — J-7 · J-8

| ID | 요구사항 |
|---|---|
| FR-FB6-1 | `UnansweredSource`를 **`['UNANSWERED', 'NEGATIVE_FEEDBACK']`** 로 확장하고, 큐 유일 키를 **`(chatbotId, source, questionNormalized)`** 로 바꾼다(기존 행 전부 `UNANSWERED` — 충돌 0. 마이그레이션 전 중복 0 확인 절차는 architect — **[확정] 새 키는 옛 키의 상위 집합이라 중복이 원리상 불가능 — 사전 확인은 `source`별 건수(UNANSWERED 1행뿐) 기록. 마이그레이션 = `DROP INDEX` + `CREATE UNIQUE INDEX`(SQLite 테이블 재정의 0 · 원시 부분 유니크 4개 무영향 — 적용 후 `sqlite_master` 확인) · 통합 시험 `prisma migrate deploy` — 설계서 §3.2**). 기존 수집 경로는 `source='UNANSWERED'`를 **명시적으로** 쓴다. |
| FR-FB6-2 | 편입은 `UnansweredCollectorService`의 **두 번째 진입 메서드**(예: `collectNegativeFeedback`)로만 한다 — 큐 쓰기 주체 2곳 유지(ADR-0019 45행). 입력 = 로그 행의 마스킹된 `userMessage`·`channelType`·턴 사실. |
| FR-FB6-3 | 편입 판정은 **순수 함수**이며 `collect-decision.ts`의 정규화·빈 입력·장문 규칙을 **공유**한다(복제 금지). **[확정] 같은 파일에 `shouldQueueNegativeFeedback()`을 두고 정규화·빈 입력·장문은 내부 함수 `normalizeQueueCandidate()` 1벌을 `shouldCollect()`와 공유(`shouldCollect()` 동작·사유 순서 불변) — 설계서 §10.2** 제외 사유: `ALREADY_UNANSWERED`(`isAnswered=false` ∧ `apiNotice=false`) · `API_NOTICE` · `BUTTON_NODE`(`inputKind='BUTTON_NODE'` 또는 **null** — 기존 행 보수적 제외) · `EMPTY` · `TOO_LONG`. BLOCK·설문·상담 턴은 FR-FB2-4로 평가 자체가 불가해 도달하지 않는다. |
| FR-FB6-4 | 편입 기준 = **👎 1회**(메시지당 1회 기여 — FR-FB4-5). 병합·재발생 규칙은 미응답과 **동일**: 기존 행이면 `occurredCount`(= 👎 기여 수)·`variants`·`lastOccurredAt` 증가, `RESOLVED`/`IGNORED`면 상태 유지 + `recurredCount` 증가(자동 재오픈 없음). |
| FR-FB6-5 | 👎 항목에 **최근 👎 턴의 로그 id**(`lastFeedbackLogId`, FK 없음)를 갱신한다 — 상세 화면이 당시 봇 답변·매칭 대상을 이 행에서 읽는다(텍스트 중복 저장 0). |
| FR-FB6-6 | 편입은 평가 요청 **안에서** 수행하되 **실패를 흡수**한다(평가 응답은 성공 · `queuedAt` 미기록 · 경고 로그에 본문 0). 다음 값 변경 시 재시도하지 않는다(단순성 — 손실은 통계에 영향 없음). |
| FR-FB6-7 | **소스별 `PENDING` 상한**: `UNANSWERED`는 기존 `UNANSWERED_MAX_PENDING`(5,000) 그대로, `NEGATIVE_FEEDBACK`은 별도 `FEEDBACK_QUEUE_MAX_PENDING`(기본 2,000). 한 소스가 상한에 닿아도 다른 소스 신규 수집은 계속된다. 요약 API(`summary`)는 소스별 대기 수·상한 도달 여부를 추가로 돌려준다. |
| FR-FB6-8 | 👍는 큐에 **반영하지 않는다**(J-10). |

### 4.7 학습현황 화면 · 처리 — J-9

| ID | 요구사항 |
|---|---|
| FR-FB7-1 | 목록 DTO에 `source` 추가 · 목록 쿼리에 **`source` 필터**(CSV, 기본 = 전체 — 기존 호출 결과 불변). 행에 소스 배지("답변 못함"/"부정 평가" — 텍스트 라벨, 색상 단독 금지). 부정 평가 행의 발생 수 라벨은 "부정 평가 n회". |
| FR-FB7-2 | 부정 평가 항목 상세에 **당시 봇 답변(로그 `botResponse` 마스킹본, 2,000자 절단본)** 과 **매칭 대상**(유형: 의도·FAQ·노드·문서 답변(RAG)·폴백 / 이름 — 삭제된 자산은 "삭제됨")을 표시한다. 목록에는 매칭 대상 유형·이름만(답변 본문 제외). 이름 해석은 **요청당 일괄 조회**(N+1 금지). |
| FR-FB7-3 | 탭 배지·요약: 전체 대기 수와 함께 **소스별 대기 수**. |
| FR-FB7-4 | 추천 의도는 기존 우선순위(분류기 → 문자 유사도, ADR-0027) 그대로이며, 추천 중 **현재 매칭 의도**와 같은 항목에 **"현재 매칭" 배지**를 붙인다. 반영 시 선택 의도가 현재 매칭 의도와 같으면 "지금도 이 의도로 답하고 있어요 — 답변 내용 수정이 필요할 수 있어요" **경고**(차단 아님). |
| FR-FB7-5 | 같은 정규화 질문의 **다른 소스 항목**이 있으면 상세에 링크("같은 질문의 답변 못함 항목 — 반영 완료")를 표시한다. |
| FR-FB7-6 | 신규 전이 **"직접 수정 완료"**: `PENDING` → `RESOLVED`(`resolvedIntentId=null`, `resolvedAt`·`resolvedById` 기록), CAS 전이, 권한 `dialogue:write`, **부정 평가 항목에만** 허용(미응답 항목은 `400` — 기존 반영 경로 유지). 화면 라벨 "반영 완료(직접 수정)". 재오픈은 기존 규칙. **감사하지 않는다**(ADR-0019 §6). 일괄 처리 지원 여부는 architect(권고: 1차 단건만). **[확정] 1차 단건만 · 경로 `POST …/unanswered-questions/:id/mark-addressed` · 미응답 항목 `400 INVALID_STATUS_TRANSITION` — 설계서 §11.3** |
| FR-FB7-7 | 매칭 대상 **편집 화면 링크**(FAQ 편집·노드 편집·의도 편집)를 둔다 — 상태 변화 없음. 대상이 삭제됐거나 RAG·폴백이면 링크 없음. |
| FR-FB7-8 | 기존 반영(예문 추가)·무시·재오픈·일괄 반영·요소분해 반영(No.23)은 부정 평가 항목에도 **그대로** 동작한다. |

### 4.8 만족도 통계 — J-12

| ID | 요구사항 |
|---|---|
| FR-FB8-1 | 신규 `GET /stats/feedback?chatbotId&from&to`(`chatbot:read` — No.14 규약: KST `dayBucket` 기간·범위 상한·집계 타임아웃·보관 챗봇 허용). 원시 SQL 0(R-7 불변). |
| FR-FB8-2 | 지표(기간 = **턴 `dayBucket`** 기준): 👍 수 · 👎 수 · **긍정률** = 👍/(👍+👎) · **참여율** = (👍+👎) / `feedbackOffered=true` 턴 수 · 표본 수. 표본 30 미만이면 긍정률에 "표본이 적어요" 표기. 분모 0이면 비율 `null`("—"). |
| FR-FB8-3 | 일별 추이(👍·👎 막대 + 긍정률 선 — 표현은 ui-designer). |
| FR-FB8-4 | **👎 상위 대상 Top N**(기본 10): 매칭 대상별(FAQ·의도·노드·문서 답변·폴백) 👎 수·👍 수 — 원장의 비정규화 컬럼 groupBy. **질문 문장은 싣지 않는다**(큐로 이동하는 링크만). 삭제된 자산은 "삭제됨". |
| FR-FB8-5 | **대시보드(No.2)·기존 No.14/No.29 응답·순수 함수는 수정하지 않는다.** 만족도 카드는 No.14 통계 화면의 **새 섹션(또는 탭)** 에만 둔다(위치는 ui-designer). |
| FR-FB8-6 | 그룹·전역 스코프(No.29) 만족도와 의도별 통계의 👎 열은 **2차**다 — 원장 `groupId` 스냅샷·`matchedIntentId`로 추가 적재 없이 확장 가능해야 한다. |

### 4.9 위젯 (`apps/widget`) — J-14

| ID | 요구사항 |
|---|---|
| FR-FB9-1 | 요청 `features`에 **`'feedback-v1'`** 을 싣는다(기존 `'handoff-v1'`과 공존, 최대 5 — `conversation.ts` 247행). |
| FR-FB9-2 | 응답 `messageId`와 평가 가능 표시를 **말풍선까지 전달**한다 — `addBotOutputs`·`addBotAnswer`에 선택 인자 추가(기존 호출 동작 불변). |
| FR-FB9-3 | 평가 버튼은 **평가 가능 표시가 있는 봇 말풍선에만** 붙인다. 인사말·퀵리플라이·보류 대기 문구·로컬 정리 문구(`EXPIRED`/`TIMEOUT`)·시스템 안내·오류 말풍선·상담원 말풍선에는 **없다**. 보류 턴은 `READY`/`FAILED` 최종 말풍선에만 붙인다. |
| FR-FB9-4 | 버튼 2개 = **"도움이 됐어요" / "도움이 안 됐어요"** — 아이콘 + 접근 가능한 텍스트 이름, `aria-pressed`, 말풍선 **밖**(아래) 보조 영역. 선택 시 `#cb-status`에 "의견을 보내 주셔서 고마워요" **1회**. 메시지 목록 `aria-live` 재낭독 금지(버튼 영역은 추가 노드가 아님). |
| FR-FB9-5 | 동작: 클릭 → 즉시 선택 표시(낙관적) → 실패 시 **1초 후 1회 재시도** → 그래도 실패하면 선택 해제 + 버튼 옆 작은 문구 "저장하지 못했어요"(모달·오류 말풍선 없음, 대화 입력 잠금 없음). `404`(기능 꺼짐 포함)는 "지금은 의견을 받을 수 없어요"로 표시하고 버튼 비활성. `409`는 "더 이상 바꿀 수 없어요". `429`는 조용히 선택 해제. |
| FR-FB9-6 | 선택된 버튼 재클릭 = 무동작(취소 없음 — FR-FB4-3). 다른 버튼 클릭 = 변경 요청. |
| FR-FB9-7 | 평가 상태는 **DOM에만** 둔다 — `sessionStorage` 저장 0(새로고침하면 말풍선이 사라지므로 복원 대상이 없다). |
| FR-FB9-8 | vanilla TS · 런타임 의존성 0 · **gzip 100KB 게이트 통과** · 증가분을 빌드 로그로 보고(현재 11.16KB). 요청 로직은 `api/public-client.ts`, 상태 판단(재시도·응답 코드 → 표시)은 `core/` 순수 함수, DOM은 `ui/`. |

### 4.10 다른 기능과의 경계 (혼동 방지)

| 기능 | 이 그룹과의 관계 |
|---|---|
| **No.15 학습현황** | 입력 소스 확장(`NEGATIVE_FEEDBACK`) + "직접 수정 완료" 전이 1개. 기존 미응답 수집·반영 흐름 **불변** |
| **No.23 분류기 · No.16 증강** | 수정 0. 부정 평가 항목에도 기존 추천 우선순위가 그대로 적용 |
| **No.27 설문** | **다른 기능이다.** 설문 = 설계자가 **노드에 배치**한 **대화 단위** 조사(척도·NPS·자유 텍스트·참여 통계·CSV), 응답은 대화 턴으로 들어온다(공개 경로 0). 평가 = **모든 답변에 붙는** **답변 단위** 이진 신호, **학습 큐로 연결**. 설문 결과는 큐에 넣지 않는다(`survey-management.md` 556행 유지). 설문 문항 말풍선(`surveyTurn`)은 평가 대상이 아니다 |
| **No.24 하이브리드 CS** | 상담 턴·상담원 메시지 평가 없음. 상담원 평가 = 종료 후 버튼으로 설문 노드(No.24 기존). 상담 전·후 봇 답변은 평가 가능. **👎를 상담 경고에 산입하는 것은 후속**(§9) — 경고 판정(`evaluateSessionAlert`) 수정 0 |
| **No.10 시뮬레이터 · No.19/20 TC** | 평가 0건(구조). 시뮬레이터 화면에 버튼 없음 |
| **No.2 대시보드 · No.14 · No.29 통계** | 대시보드·기존 응답 불변. 만족도는 No.14 화면 새 섹션. 통합·의도별은 2차 |
| **No.22 토픽** | 원장에 `topicId` 스냅샷(로그에서 복사) — 토픽별 만족도는 후속 |
| **No.25 버전 · No.28 예약 배포** | 원장·스위치 스냅샷 밖. 복원이 자산을 지우면 매칭 대상이 "삭제됨"으로 표시 |
| **No.30 외부 RAG** | RAG 최종 답변 평가 가능 · 매칭 대상 "문서 답변" · 문서 품질 피드백을 외부 RAG로 보내는 것은 범위 밖(allowlist 불변 — ADR-0022) |
| **No.45 거버넌스** | 자유 텍스트 사유 · 평가 원장 보존기간 · 파기는 No.45 |

### 4.11 구축형 / 구독형 적합도

| 형태 | 판정 | 근거 |
|---|---|---|
| 구축형 | ○ | 외부 의존 0 · 새 인프라 0 · GPU 없는 환경에서도 추천이 문자 유사도로 동작 |
| 구독형 | ○ | DB 원천·프로세스 로컬 상태 0 → 다중 인스턴스 추가 조정 0. 저장되는 것은 평가값과 로그에서 복사한 ID·불리언뿐(텍스트 0) — 고객 데이터 보관 부담이 늘지 않는다 |

### 4.12 GPU 필요도 재확인 — J-18

| 구성요소 | 연산 | GPU |
|---|---|---|
| 평가 가능 판정 · 평가 저장 · 결합 검증 | 순수 함수 · PK 조회 · upsert | 1 |
| 큐 편입 | 정규화 + upsert(기존 수집기) | 1 |
| 만족도 통계 | groupBy 집계 | 1 |
| 큐 추천(부정 평가 항목) | **기존** No.23 분류기(임베딩 — ml-worker No.18) / 문자 bigram | No.15와 같은 등급(2) — 신규 부하 0 |
| (범위 밖) 자유 텍스트 요약·감성 분석 | LLM/분류 모델 | 5~8 — 제외 |

→ **카탈로그 2 유지**(이 그룹이 새로 만드는 연산은 전부 1).

### 4.13 이 그룹이 **하지 않는** 것 (범위 요약)

1차에는 사유 선택·자유 텍스트·통합 통계·의도별 👎 열·편입 임계 설정·👍 큐 반영·상담 경고 연동·평가 취소·비WEB 채널·평가 CSV를 만들지 않는다(§9).

---

## 5. 데이터 요구사항

### 5.1 기존 자산 재사용 (변경 없음 또는 최소 변경)

| 자산 | 변경 |
|---|---|
| `ConversationLog` | 컬럼 2개(`feedbackOffered Boolean @default(false)` · `inputKind String?`) — `record()` 1곳 쓰기 · `update` 0 유지 · 인덱스 없음 |
| `RecordConversationLogParams` · `RagAnswerRunInput` · `ConversationLogPort` | 파라미터 2개 전달(세 타입 동시 — `groupId` 선례 14~17행) |
| `UnansweredQuestion` | 유일 키 `(chatbotId, source, questionNormalized)` · 컬럼 1개(`lastFeedbackLogId String?` — FK 없음) · `source` 값 1종 추가 |
| `UnansweredCollectorService` · `collect-decision.ts` | 진입 메서드 1개 · 판정 함수(공유 규칙) · 소스별 상한 |
| `UnansweredQuestionsService` | 목록/요약 소스 필터·집계 · "직접 수정 완료" 전이 1개 · 상세에 당시 답변·매칭 대상 |
| `WebChannelConfigSchema` | `feedbackEnabled` 1개(architect 확정) |
| `PublicMessageRequestSchema` / `PublicMessageResponseSchema` | 요청 불변(`features` 값만 추가) · 응답 선택 필드 1개 |
| 위젯 `message-list` · `app` · `public-client` · `store` | 말풍선 `messageId` 전달 · 버튼 · 요청 |
| `CHILD_COUNT_LABELS` | +1(`messageFeedbacks`) |

### 5.2 신규 데이터 모델 제안 (`system-architect` 확정 사항)

| 모델 | 주요 필드(개요) | 제약 |
|---|---|---|
| **`MessageFeedback`** | id · chatbotId(FK Restrict) · **conversationLogId(유일, FK 없음)** · groupId(스냅샷) · rating(`UP`/`DOWN`) · changeCount · turnDayBucket · turnCreatedAt · channelType · isAnswered · answeredByRag · apiNotice · matchedIntentId? · matchedFaqId? · matchedNodeId? · topicId? · inputKind? · queuedAt? · queuedQuestionId?(FK 없음) · createdAt · updatedAt | 유일 `conversationLogId` · 인덱스 `(chatbotId, turnDayBucket)` · 쓰기 1파일 · **삭제 0** · **텍스트·`sessionId`·IP·UA 컬럼 0** |

**미도입 결정(개발명세서 §3에 기록 제안)**: 평가 토큰 · 평가 사유 텍스트 테이블 · 평가 롤업 · 👍 큐 카운터 · 세션 단위 평가 제한 테이블.

### 5.3 `shared-types` 스키마 (개요)

- `conversation.ts`: `WIDGET_FEATURE_FEEDBACK_V1 = 'feedback-v1'` · `PublicMessageResponseSchema.feedback?: { rateable: true }` · `PublicFeedbackRequestSchema { sessionId, rating }` · `PublicFeedbackResponseSchema { rating }`.
- `channel.ts`: `WebChannelConfigSchema.feedbackEnabled`(기본 false).
- `learning.ts`: `UnansweredSource` 2종 · 목록 항목 `source` · 목록 쿼리 `source` 필터 · 요약 `bySource` · 부정 평가 상세 `lastFeedback?: { botResponse, target: { kind, id?, name?, deleted } }` · `MarkAddressed` 응답.
- `stats.ts`: `FeedbackStatsQuery` · `FeedbackStats { totals, buckets, topNegativeTargets, sampleSize }`.
- `common.ts`: `ApiErrorCode` +2.

### 5.4 API 엔드포인트 개요

| 계열 | 경로 | 권한 |
|---|---|---|
| **공개** | `PUT /public/chatbots/:slug/messages/:messageId/feedback` (**`@Public()` 8번째**) · 기존 `POST …/messages`(응답 선택 필드) | 없음(결합 검증·전용 버킷·Origin) |
| 학습현황 | 기존 목록·요약·상세 확장(`source`) · **`POST /chatbots/:chatbotId/unanswered-questions/:id/mark-addressed`**(직접 수정 완료) | `dialogue:read` / `dialogue:write` |
| 통계 | **`GET /stats/feedback`** | `chatbot:read` |
| 설정 | 기존 `PATCH /chatbots/:chatbotId/channels/WEB`(설정 필드 1개) | `channel:write` |

### 5.5 환경변수 (전부 선택 · 기본값 · 기동 조건 아님)

`PUBLIC_FEEDBACK_RATE_LIMIT_IP_PER_MIN`(120) · `PUBLIC_FEEDBACK_RATE_LIMIT_MESSAGE_PER_MIN`(10) · `FEEDBACK_CHANGE_WINDOW_HOURS`(24) · `FEEDBACK_MAX_CHANGES`(5) · `FEEDBACK_QUEUE_MAX_PENDING`(2000).

---

## 6. 비기능 요구사항

### 6.1 성능 (NFR-FBP)

| ID | 요구사항 |
|---|---|
| NFR-FBP1 | **기능 꺼진 챗봇·미선언 위젯의 공개 대화 예산 불변**(P95 500ms · 추가 조회 0). |
| NFR-FBP2 | 기능 켜진 챗봇의 대화 턴 = **추가 조회 0**(판정은 이미 가진 값의 순수 함수) · 응답 크기 +수십 바이트. |
| NFR-FBP3 | 평가 API **P95 100ms**(가드·접근 판정 4쿼리 + 로그 PK 1 + 원장 upsert 1 + 편입 시 큐 1~2). 대화 전송 P95에 영향 0(버킷·경로 분리). |
| NFR-FBP4 | 만족도 통계 **P95 1초**(92일 · 원장 10만 행 기준) · 쿼리 수 고정(기간·대상 수와 무관 ~~≤4~~ **≤7** — architect 조정: 집계 3 + 👎 상위 대상 이름 해석 3 + 챗봇 존재 확인 1. 반환 행 수가 원장 행 수와 무관하다는 성질은 유지 — 설계서 §12.2). |
| NFR-FBP5 | 학습현황 목록 성능 기존 예산 유지 — 소스 필터·매칭 대상 이름 해석 추가 후에도 N+1 없음(요청당 일괄 조회). |
| NFR-FBP6 | 위젯 gzip **100KB 이내**, 증가분 보고(예상 +1~2KB). 평가 요청은 사용자 클릭에만 발생(폴링 0). |
| NFR-FBP7 | `ConversationLog` 컬럼 2개·`UnansweredQuestion` 유일 키 변경 마이그레이션의 소요·잠금 시간을 100만 행 기준으로 측정해 배포 절차에 명시(SQLite 단일 작성자 — 개발명세서 §5). |

### 6.2 보안 / 개인정보 (NFR-FBS)

| ID | 요구사항 |
|---|---|
| NFR-FBS1 | **결합 검증 3요소**(챗봇·세션·메시지) 전부 일치할 때만 저장. 불일치 사유를 응답·로그로 구분하지 않는다(단일 `404`). |
| NFR-FBS2 | 평가 응답에 대화 텍스트·내부 id·집계 없음 · `Cache-Control: no-store` · Origin 가드 · 전용 버킷. |
| NFR-FBS3 | 평가 원장에 텍스트·`sessionId`·IP·UA 없음(스키마 수준 — 정적 검사). 큐에 들어가는 문장은 로그의 **마스킹본**뿐이며 **원문 재접촉 경로 0**(ADR-0013). |
| NFR-FBS4 | 서버 로그·경고·오류 응답에 질문·답변 본문과 `sessionId` 전체값 0(`chatbotId`·`messageId`·결과 코드만 — `messageId`는 추측 불가 난수이며 단독으로 평가 불가). |
| NFR-FBS5 | 평가 원장 **삭제 경로 0** · 무기한 보존(알려진 리스크 — No.45) · 챗봇 영구삭제 사전검사 대상. |
| NFR-FBS6 | 정적 검사 `feedback-sealing.spec.ts`(FR-FB10-1). |

### 6.3 접근성 (NFR-FBA — `UIUX_준수기준.md`)

| ID | 요구사항 |
|---|---|
| NFR-FBA1 | 평가 버튼은 **아이콘 + 텍스트 접근 이름**("도움이 됐어요"/"도움이 안 됐어요"), 선택 상태는 `aria-pressed`와 **시각 표시 2중**(색 단독 금지), 대비 4.5:1(아이콘 3:1), 터치 영역은 `UIUX_준수기준.md` 기준 준수, 포커스 표시. |
| NFR-FBA2 | 선택·실패 안내는 `#cb-status`(polite) **1회** · 메시지 목록(`role="log"`) 재낭독 금지 · 평가 후 포커스 이동 없음(입력창 포커스 유지). |
| NFR-FBA3 | 키보드만으로 평가·변경 가능(Tab·Space/Enter). 긴 대화에서 탭 이동 부담이 과하면 ui-designer가 대안(로빙 탭 등)을 결정. |
| NFR-FBA4 | 콘솔: 소스 배지·"현재 매칭"·"삭제됨"은 **텍스트 라벨**, 만족도 차트는 표 대체(수치)를 함께 제공, 비활성 버튼(직접 수정 완료 — 미응답 항목)은 사유 텍스트. |

### 6.4 유지보수성 (NFR-FBM)

| ID | 요구사항 |
|---|---|
| NFR-FBM1 | 평가 가능 판정·편입 판정·변경 제한·만족도 집계 조립은 **DB·Nest·DOM 무의존 순수 함수**(단위 시험). |
| NFR-FBM2 | 편입 판정은 기존 `collect-decision.ts`와 **규칙 1벌 공유**(정규화·빈 입력·장문·API 고정 문구). |
| NFR-FBM3 | 위젯 평가 로직은 `core/`(응답 코드 → 표시 상태 · 재시도 결정) + `ui/`(DOM) 분리 — 보류·상담 폴링과 독립. |

---

## 7. 수용기준 (AC)

### AC-FB1. 범위 · 회귀 · 스위치

- **AC-FB1-1** ★ Given 기능이 꺼진 챗봇(또는 `feedback-v1` 미선언 위젯), When 기존 엔진·대화·통계·검증·버전·예약·상담 스위트를 돌리면, Then FR-0-146 목록 외에는 **수정 없이 전부 통과**하고 공개 응답에 `feedback` 키가 없으며 대화 턴의 DB 조회 수가 도입 전과 같다.
- **AC-FB1-2** Given `packages/dialogue-engine`, When 이 그룹 전후를 비교하면, Then 변경 파일 0이다.
- **AC-FB1-3** Given 기능이 켜진 챗봇, When 대화 1턴을 보내면, Then DB 조회 수가 기능 꺼짐과 같다(추가 0).
- **AC-FB1-4** Given 기능을 켠 뒤 끈 챗봇, When 끄기 전 말풍선으로 평가하면, Then `404 FEEDBACK_TARGET_NOT_FOUND`이고 기존 평가·큐·통계는 그대로다.

### AC-FB2. 평가 가능 판정

- **AC-FB2-1** ★ Given 기능 켜짐 + `feedback-v1` 선언, When 일반 답변·폴백·API 고정 문구·RAG 보류 턴·`NODE` 버튼 턴을 보내면, Then 응답에 평가 가능 표시가 있고 로그 `feedbackOffered=true`다.
- **AC-FB2-2** ★ Given 같은 조건, When 금지어 BLOCK 턴·설문 소비 턴·상담 구간 턴을 보내면, Then 표시가 없고 `feedbackOffered=false`이며 그 `messageId` 평가는 `404`다.
- **AC-FB2-3** Given 로그 행, Then `inputKind`가 `TEXT`/`BUTTON_MESSAGE`/`BUTTON_NODE` 중 실제 입력 유형으로 적재되어 있다.

### AC-FB3. 공개 API · 위변조 방어

- **AC-FB3-1** ★ Given 세션 A가 받은 `messageId`, When 세션 B의 `sessionId`로 평가하면, Then `404`이고 원장 0행이다. 존재하지 않는 `messageId`·다른 슬러그·UUID 아닌 값도 **같은 코드·같은 문구**다.
- **AC-FB3-2** ★ Given 같은 메시지, When 👎를 5번 연속 보내면, Then 원장 1행 · `changeCount=0` · 큐 기여 1회다.
- **AC-FB3-3** Given 👎 저장 후 👍 → 👎 → 👍, Then 원장 현재값 `UP` · `changeCount=3` · 큐 `occurredCount` 증가 1회(최초 👎만)다.
- **AC-FB3-4** Given 변경 5회를 소진한 메시지 / 로그 `createdAt` + 24시간이 지난 메시지, When 값을 바꾸면, Then `409 FEEDBACK_CLOSED`이고 원장 불변이다.
- **AC-FB3-5** ★ Given 같은 IP·같은 세션, When 평가 버튼을 1분에 40회 누르고 곧바로 질문을 보내면, Then 질문 전송은 `429`가 **아니다**(대화 버킷 비소비). 평가는 전용 버킷 상한에서만 `429`다.
- **AC-FB3-6** Given 평가 응답, When 검사하면, Then 본문은 `{ rating }`뿐이고 대화 텍스트·매칭 정보·내부 id가 없다.
- **AC-FB3-7** Given 두 요청이 같은 메시지에 👎를 동시에 보냄(다중 인스턴스 시뮬레이션 포함), Then 원장 1행 · 큐 기여 1회다.
- **AC-FB3-8** Given 평가 API 호출, Then 엔진·번들·의미 점수·RAG·상담 게이트 호출 0이다.

### AC-FB4. 큐 편입

- **AC-FB4-1** ★ Given 답변된 턴 "해외 배송 되나요?"(FAQ 매칭), When 👎, Then `(chatbotId, NEGATIVE_FEEDBACK, "해외 배송 되나요?")` 행이 `PENDING` · `occurredCount=1` · `lastFeedbackLogId`=그 메시지로 생긴다. 같은 질문의 `UNANSWERED` 행이 있어도 **별도 행**이다.
- **AC-FB4-2** ★ Given 폴백 턴(이미 `UNANSWERED` 수집) · API 고정 문구 턴 · `NODE` 버튼 턴 · 201자 질문, When 👎, Then 평가는 저장되고 **부정 평가 행은 생기지 않는다**(사유 각각 `ALREADY_UNANSWERED`·`API_NOTICE`·`BUTTON_NODE`·`TOO_LONG`).
- **AC-FB4-3** Given 부정 평가 행이 `RESOLVED`, When 같은 질문에 새 👎, Then 상태 `RESOLVED` 유지 · `recurredCount=1`이다.
- **AC-FB4-4** Given 부정 평가 `PENDING` 2,000건(상한), When 새 질문 👎 · 새 미응답 발생, Then 부정 평가 신규 0 · **미응답 신규는 정상 수집**된다.
- **AC-FB4-5** Given 큐 저장값·원장, When 검사하면, Then 큐 문장은 로그 `userMessage`(마스킹본)와 같고 원장에는 텍스트 컬럼이 없다(PII 픽스처 "010-1234-5678" → 큐 "010-****-5678").
- **AC-FB4-6** Given 큐 편입 쓰기 실패 주입, When 👎, Then 평가 응답 `200` · 원장 저장 · `queuedAt=null` · 경고 로그에 본문 없음이다.
- **AC-FB4-7** Given 👍만 받은 질문, Then 큐 행 0이다.

### AC-FB5. 학습현황 화면 · 처리

- **AC-FB5-1** Given 두 소스 항목, When 목록 `source` 미지정, Then 두 소스 모두 나오고 기존 호출(소스 무지정)의 기존 항목 결과가 도입 전과 같다. `source=NEGATIVE_FEEDBACK`이면 부정 평가만이다.
- **AC-FB5-2** ★ Given 부정 평가 항목 상세, Then 당시 봇 답변(마스킹본)·매칭 대상 유형·이름이 있고, 매칭 FAQ를 삭제한 뒤에는 "삭제됨"이다.
- **AC-FB5-3** Given 추천 1위가 현재 매칭 의도, Then "현재 매칭" 배지가 있고, 그 의도로 반영하면 경고가 표시되지만 반영은 성공한다.
- **AC-FB5-4** ★ Given 부정 평가 `PENDING` 항목, When `직접 수정 완료`, Then `RESOLVED` · `resolvedIntentId=null` · 의도·예문·번들 불변 · 감사 0건이다. 미응답 항목에 호출하면 `400`, VIEWER는 `403`이다.
- **AC-FB5-5** Given 요약 API, Then 전체·소스별 대기 수와 소스별 상한 도달 여부가 있다.
- **AC-FB5-6** Given 부정 평가 50건 목록, When 조회, Then 매칭 대상 이름 해석 쿼리가 항목 수와 무관하게 고정이다.

### AC-FB6. 통계

- **AC-FB6-1** ★ Given 고정 픽스처(평가 제공 턴 200 · 👍 30 · 👎 10), When `GET /stats/feedback`, Then 👍 30 · 👎 10 · 긍정률 0.75 · 참여율 0.2 · 표본 40이다.
- **AC-FB6-2** Given 표본 20, Then 긍정률에 "표본이 적어요" 표기가 있다. 분모 0이면 비율이 `null`이다.
- **AC-FB6-3** Given 👎 상위 대상, Then FAQ·의도·노드·문서 답변·폴백 구분과 👎/👍 수가 있고 **질문 문장이 없다**.
- **AC-FB6-4** Given 대시보드·No.14 요약/분포/질문 순위·No.29 응답, When 도입 전후 비교, Then 바이트 동일이다.
- **AC-FB6-5** Given 챗봇의 그룹을 이동한 뒤, When 원장 `groupId`를 보면, Then 평가 당시가 아니라 **대화 당시** 그룹이다(로그 스냅샷 복사).

### AC-FB7. 위젯 · 접근성

- **AC-FB7-1** ★ Given 기능 켜짐, When 답변 말풍선, Then 아래에 두 버튼이 있고 인사말·대기 문구·시스템·오류·상담원 말풍선에는 없다. 보류 턴은 `READY`/`FAILED` 최종 말풍선에만 있다.
- **AC-FB7-2** Given 👎 클릭, Then `aria-pressed="true"` · 상태 영역 1회 안내 · 메시지 목록 추가 노드 0 · 입력창 포커스 유지다.
- **AC-FB7-3** Given 네트워크 실패 2회, Then 1회 재시도 후 선택 해제 + "저장하지 못했어요"이며 대화 전송은 계속 가능하다.
- **AC-FB7-4** Given `404` 응답, Then "지금은 의견을 받을 수 없어요" + 버튼 비활성이다.
- **AC-FB7-5** Given 위젯 빌드, Then gzip 100KB 이내이고 증가분이 보고된다.
- **AC-FB7-6** Given axe(위젯·콘솔 신규 화면), Then 대비 위반 0이고 소스·선택 상태가 텍스트로도 구분된다. 키보드만으로 평가·변경이 된다.

### AC-FB8. 권한 · 감사 · 봉인 · 격리

- **AC-FB8-1** Given 역할별 호출, Then 만족도 통계 = VIEWER·EDITOR·ADMIN `200`/AGENT `200`(`chatbot:read` 보유) · 직접 수정 완료 = EDITOR·ADMIN `200`/VIEWER·AGENT `403` · 채널 스위치 = `channel:write` 규약 그대로다.
- **AC-FB8-2** Given 평가·편입·직접 수정 완료, When 감사로그, Then 새 레코드 0건이다. 스위치 변경은 `Channel UPDATE` 1건(본문 없음)이다.
- **AC-FB8-3** ★ Given 저장소 전체, When `feedback-sealing.spec.ts`, Then 단언(FR-FB10-1)이 전부 통과한다(역검증 픽스처 포함). `@Public()` 총 8.
- **AC-FB8-4** Given 시뮬레이터·TC 실행, Then 원장 쓰기 0 · 시뮬레이터 화면에 평가 버튼 없음이다.
- **AC-FB8-5** Given 평가가 있는 챗봇 영구삭제, Then `409 CHATBOT_HAS_CHILDREN`에 `답변 평가`가 포함된다.

---

## 8. 예외 케이스 (EX)

| ID | 상황 | 기대 동작 |
|---|---|---|
| EX-FB-1 | **세션 만료·`sessionStorage` 삭제** 후 남은 말풍선 평가 | 새 `sessionId`로 요청 → 불일치 `404` → "지금은 의견을 받을 수 없어요" |
| EX-FB-2 | **탭 복제**(같은 `sessionId`) | 복제 탭에는 말풍선 DOM이 없다(복원 없음) — 영향 없음. 두 탭이 서로 다른 메시지를 평가하는 것은 정상 |
| EX-FB-3 | 로그 적재 **실패**(C-2) | 평가 `404` — "저장하지 못했어요"(재시도 1회 후). 응답 자체는 정상이었다 |
| EX-FB-4 | 보류 RAG **READY 직후 로그 적재 전** 클릭(C-1) | `404` → 1초 후 재시도에서 성공 |
| EX-FB-5 | 보류 턴 `EXPIRED`/`TIMEOUT`(로컬 정리 문구) | 버튼 없음 |
| EX-FB-6 | **다국어·이모지 질문** 👎 | 정규화 규칙 그대로(`normalizeText`) — 큐에 그대로 편입, 추천 점수는 낮을 수 있음 |
| EX-FB-7 | **금지어 WARN** 정책 단어가 포함된 질문 👎 | 로그 저장값이 이미 금지어 마스킹본 — 그대로 편입(EX-15-15 선례) |
| EX-FB-8 | 금지어 **BLOCK** 턴 | 평가 불가(버튼 없음·`404`) |
| EX-FB-9 | 상담 중 턴 · 상담원 메시지 | 평가 불가. 상담 종료 후 봇 답변은 평가 가능 |
| EX-FB-10 | 설문 문항 말풍선 | 평가 불가(`surveyTurn`). 설문을 **시작시킨 노출 턴**은 설문 턴이 아니므로 평가 가능 |
| EX-FB-11 | **폴백**(미응답) 답변 👎 | 평가 저장·만족도 반영 · 큐는 `UNANSWERED`에 이미 있어 부정 평가 행 0 |
| EX-FB-12 | **`NODE` 버튼 턴** 👎 | 평가 저장·만족도(해당 노드 👎) 반영 · 큐 편입 0 |
| EX-FB-13 | 기능 켜기 **이전** 로그(`inputKind=null`·`feedbackOffered=false`) | 평가 불가(`404`) — 버튼도 없었다 |
| EX-FB-14 | 매칭 자산이 **삭제·복원**됨 | 원장의 id는 그대로 · 화면은 "삭제됨"(복원으로 같은 id가 돌아오면 다시 이름 표시 — ID 보존 복원) |
| EX-FB-15 | **토픽 비활성화** 후 과거 평가 | 원장 `topicId` 그대로(당시 사실) |
| EX-FB-16 | 부정 평가 `PENDING` **상한 도달** | 신규 편입 중단 · 기존 행 증가는 계속 · 화면 배너(소스별) |
| EX-FB-17 | 스크립트로 **자기 대화 대량 👎** | 대화 레이트리밋에 묶임 · 소스별 상한 · 검토자가 무시(§1.5 수용 위험) |
| EX-FB-18 | **Origin 헤더 없는** 서버 간 평가 요청 | Origin 가드 통과(ADR-0011) — 결합 검증은 동일 적용 |
| EX-FB-19 | 챗봇 **보관**·WEB 채널 닫힘·비공개 | 기존 403 규약(`access.resolve`) — 위젯은 기존 `DISABLED` 처리 |
| EX-FB-20 | 평가 중 **버전 복원·예약 배포** | 영향 없음(원장·스위치 스냅샷 밖) |
| EX-FB-21 | 👎 → 👍 변경 후 큐 | 큐 기여 유지(검토 후보 목록) — 통계는 현재값 👍 |
| EX-FB-22 | **같은 질문이 두 소스**에 모두 있음 | 각각 처리 · 상세에 상호 링크 |
| EX-FB-23 | 한 세션이 **모든 답변에 👎** | 각 메시지 1회씩 정상 저장 — 세션 단위 제한 없음(1차). 통계 표본으로 드러남 |
| EX-FB-24 | 다중 인스턴스에서 **동시 편입** | 큐 유일 키 + P2002 1회 재시도(기존 수집기 규칙) · 원장 `queuedAt` 조건부 갱신으로 1회 |
| EX-FB-25 | 서버 재시작 | 상태가 DB에만 있어 영향 없음 |
| EX-FB-26 | 구버전 위젯(평가 UI 없음) | `feedback-v1` 미선언 → 표시 없음·`feedbackOffered=false` → 참여율 분모에서도 제외 |

---

## 9. Out of scope (이번에 하지 않는 것과 재검토 트리거)

| 항목 | 기각/연기 사유 | 재검토 트리거 |
|---|---|---|
| **고정 사유 코드**(선택형) | J-11 — 1차 최소화(위젯 상태 1단계·통계 차원) | 2차 착수 · 부정 평가 항목 처리 시 "원인 판단이 어렵다"는 운영 피드백 |
| **자유 텍스트 사유** | J-11 — 새 PII 저장소·보존기간 부재·누출 봉인 | **No.45** 보존·파기 정책 확정 **[2026-09-26 충족 — No.45 설계 완료: 금지어 → PII → 필드 암호화 → 보존 소거 규약 확정(ADR-0040). 착수는 No.44 2차 결정 사항]** |
| **자유 텍스트 요약·감성 분석** | GPU 5~8 또는 외부 LLM(PII 송신) — T-7 | 옵션 AI 기능 착수 |
| **그룹·전역(No.29) 만족도 · 의도별 👎 열 · 토픽별 만족도** | J-12 — 1차는 챗봇 스코프만(원장에 스냅샷은 적재) | 2차 · 통합 통계 사용자의 요청 |
| **편입 임계 설정(N회·세션 수) · "평가만 받고 편입 안 함"** | J-7 — 1차는 1회 즉시 | 부정 평가 항목 노이즈 비율이 운영상 문제로 확인될 때 |
| **👍의 큐 반영("같은 질문 👍 n")** | J-10 | 2차 |
| **평가 취소(해제)** | FR-FB4-3 — 상태 1개 추가 대비 이득 작음 | 사용자 요청 |
| **👎 → 상담 경고 산입(No.24)** | 경고 판정 함수 변경 · 관찰 창 발급 규칙 변경 | 상담 운영 중 "👎 사용자에게 먼저 개입" 요구 |
| **상담 콘솔 대화 보기의 👎 배지** | No.24 transcript DTO 확장 | 2차 |
| **👎 직후 "다른 답변 보기"·"상담원 연결" 제안** | 평가 응답이 대화 데이터를 돌려주게 됨(토큰 재검토 — §1.5) | UX 요구 확정 |
| **비WEB 채널(카카오 등) 평가** | 채널별 UI 없음 | No.46 · No.11 채널 구현 |
| **평가 CSV 내보내기** | 개인정보·보존 판단 선행 | No.45 |
| **"직접 수정 완료" 일괄 처리** | 1차 단건 | 운영 요청 |
| **서버 발급 평가 토큰** | §1.5 — 막는 위협이 늘지 않음 | 평가 응답이 대화 데이터를 반환하게 될 때 |
| **시뮬레이터 내 품질 표시(관리자 평가)** | J-16 — TC(No.19)의 몫 | — |

---

## 10. 상위 문서 갱신 제안 (이 문서에서는 수정하지 않음)

> 설계 변경은 `system-architect` 경유 원칙(CLAUDE.md)에 따라 **제안만** 기록한다. **P-1 승인 전에는 어떤 상위 문서도 갱신하지 않는다.**

| 문서 | 위치 | 제안 내용 |
|---|---|---|
| `docs/01-requirements/기능요구사항.md` | §4-1 No.44 행(93행) | (P-1 승인 시) GPU **2 유지**. 설명 보강: "봇 답변별 👍/👎(챗봇별 WEB 채널 설정) → 평가 원장(메시지당 1행·텍스트 0) → **👎를 학습현황 큐에 `부정 평가` 소스로 자동 편입**(당시 매칭 대상 표시·예문 반영 또는 직접 수정 완료) + 챗봇 스코프 만족도". 비고: "`messageId`+`sessionId` 결합 검증(토큰 없음) · 사유 코드·통합 통계 2차 · 자유 텍스트는 No.45" · **§4 옵션 목록 정식 편입 여부 기록** |
| 〃 | §4-1 주의(104행) | No.44의 사용자 확인 결과(도입/미도입·일자) 각주 |
| `docs/02-spec/개발명세서.md` | §2.2 모듈 배치 | 평가 모듈(공개 평가·원장·만족도 통계) 행 신설 — "`@Public()` 7 → 8 · 신규 권한 0 · 엔진·ml-worker 변경 0 · widget 변경" |
| 〃 | §3 데이터모델 | `MessageFeedback` · `ConversationLog.feedbackOffered/inputKind` · `UnansweredQuestion` 유일 키·`lastFeedbackLogId` · 미도입 목록(§5.2) |
| 〃 | §4 공개 대화(264행) · 정정 이력 | 공개 경로에 평가 1개 · 응답 선택 필드 `feedback` · 학습현황·통계 행 확장 |
| 〃 | §5 보안 · §6 공개 경로 갱신 각주(494행 뒤) | `@Public()` **8곳** · 결합 검증 · 전용 버킷 · 원장 최소 수집 |
| 〃 | §5.1 환경변수 | §5.5의 5개 |
| `docs/02-spec/decisions/` | **ADR-0038(신규)** | "피드백 루프 = 응답 단위 평가(결합 검증·토큰 없음) + 평가 원장(텍스트 0·삭제 봉인) + 큐 소스 분리(유일 키 변경) + 적재 시점 로그 표식(`feedbackOffered`·`inputKind`) + 채널 설정 스위치(조회 0)" |
| `ADR-0019` | 결정 §1·§2·§3 · 91행 | 갱신 각주: ① 유일 키 `(chatbotId, source, questionNormalized)` ② **두 번째 적재 진입점**(평가 요청 — 로그 마스킹본만 읽음, 쓰기 주체 2곳 유지) ③ `inputKind` 컬럼화(57행 트리거 발동) ④ 소스별 상한 ⑤ "직접 수정 완료" 전이 |
| `ADR-0011` · `ADR-0015` | 공개 표면 · `@Public` 개수 | 7 → 8, 보상 통제(결합 검증·전용 버킷·단일 404) · 신규 권한 0 |
| `ADR-0033` | 봉인 대상 | `MessageFeedback` 삭제 0 · 쓰기 1파일 · `groupId` 스냅샷(로그 복사) |
| `ADR-0002` | 사전검사 목록 | 14 → **15**(`답변 평가`) |
| `ADR-0012` | 위젯 | "No.44 평가 버튼 — vanilla 유지, Preact 트리거 미발동" |
| `docs/requirements/quality-channel.md` | 622행 | "위젯 평가 버튼 → No.44에서 도입" 각주 |
| `docs/requirements/stats-learning.md` | 117·732행 | "`NEGATIVE_FEEDBACK` 소스 도입(No.44) · 만족도 = No.14 화면 섹션" 각주 |
| `docs/requirements/nlu-rag-answering.md` | 771행 | "RAG 답변 평가 → No.44 도입, 외부 RAG로 피드백 송신은 범위 밖" |
| `docs/requirements/integrated-stats.md` | 141·365행 | "만족도 = No.14 섹션 1차, 통합은 2차(원장 `groupId` 스냅샷)" |
| `docs/requirements/survey-management.md` · `hybrid-cs.md` | 556행 · 524행 | 경계 확정 각주(§4.10) |
| `docs/03-design/UIUX_준수기준.md` | 위젯 | "보조 버튼 상태 변경이 로그 영역 재낭독을 일으키지 않는다 · 토글 버튼 `aria-pressed` + 텍스트 이름" |
| `docs/04-test/시험항목.md` | 신규 TC-44 | AC-FB1~FB8 편입 |
| `docs/04-test/시험데이터.md`·`자동시험_전략.md` | — | 평가 가능 판정 표(턴 유형 × 결과) · 결합 검증 위조 케이스 표 · 편입 제외 사유 표 · 같은 IP 버튼 연타 후 전송 시험 · 원장 텍스트 컬럼 부재 정적 검사 |

---

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

> **★ P-1이 선결이다** — No.44는 §4-1의 "타사 벤치마킹 제안"이며 사용자 확인 대기 중이다(`기능요구사항.md` 104행). P-1이 "도입하지 않음"이면 P-2 이하는 답하지 않아도 된다.

| # | 항목 | 왜 PM이 정해야 하는가 · 근거 (파일:행) | 권고안 |
|---|---|---|---|
| **P-1** | ★ **도입 여부와 1차 범위**(J-1) — (a) 미도입 (b) 수집+통계만 (c) 단계 도입 1차 (d) 전부 | §4-1은 "제안일 뿐 … 사용자 확인 후 정식 편입"(`기능요구사항.md` 104행). 원문은 "수집 → 오답 후보 → 큐 자동 편입"(93행). 큐 확장 자리는 이미 예고돼 있다(`schema.prisma` 614~615행 · ADR-0019 91행 · `learning.ts` 22~23행). 위젯은 현재 평가 버튼을 넣지 않기로 했었다(`quality-channel.md` 622행) | **(c) 단계 도입.** 1차 = 위젯 👍/👎(WEB·챗봇별·기본 꺼짐) + 공개 평가 API + 평가 원장 + **👎 큐 자동 편입**(소스 분리·매칭 대상·직접 수정 완료) + 챗봇 스코프 만족도 섹션. 2차 = 사유 코드·통합 통계·의도별 👎·편입 임계. 후속 = 자유 텍스트(No.45). **더 작게 가려면 (b)** — 단 원문 "자동 편입" 미충족 |
| **P-2** | **공개 표면**(J-3) — 신규 `@Public()` 1개 vs 대화 전송 경로 편승 | `@Public()` 7개 고정·단언 6파일(`public-decorator-count.spec.ts` 61~76·148~158행 외 5파일). 대화 경로에 편승하면 엔진 파이프라인·로그·`session` 버킷(`public-rate-limit.guard.ts` 56~64행)이 평가로 오염된다 | **신규 1개**(`PUT /public/chatbots/:slug/messages/:messageId/feedback`) · `@Public()` **7 → 8 의도적 갱신**(ADR-0023·0036 선례) |
| **P-3** | ★ **평가 위변조 방어**(J-4) — 토큰 발급 vs 결합 검증 · 변경·취소 정책 | `messageId`는 서버가 `randomUUID()`로 만들어 **요청자에게만** 돌려준다(`public-conversation.service.ts` 183~185·248~256행). 로그 행에 `sessionId`·`chatbotId`가 있다(`schema.prisma` 445·450행). 평가 경로는 대화 데이터를 **돌려주지 않는다** — No.24 상담 토큰이 막으려던 엿보기 위협이 없다(`hybrid-cs.md` §1.4.2) | **토큰 없음 · `messageId`+`sessionId`+슬러그 결합 검증 · 불일치 전부 단일 `404`** · 메시지당 1행(유일 키) · **변경 허용(24시간·5회)** · **취소 미지원** · 큐 기여 메시지당 1회 |
| **P-4** | **레이트리밋**(J-5) | 대화 `session` 버킷 30/분은 본문 `sessionId`로 소비된다(`public-rate-limit.guard.ts` 56~64행) — 평가 연타가 다음 질문을 429로 만들 수 있다. 폴링 전용 버킷 분리 선례(40~43·70~91행 · K-1) | **평가 전용 버킷**(IP 120/분 + 메시지 10/분) · 대화·폴링 버킷 비소비 |
| **P-5** | ★ **큐 편입 기준**(J-7) — 👎 1회 / N회 누적 / 비율 · 제외 규칙 | 미응답은 1회 발생 = 1행(`unanswered-collector.service.ts` 40~71행). 목록 기본 정렬이 발생 수 내림차순(`unanswered-questions.service.ts` 146~147행)이라 1회짜리는 아래로 간다. 폴백 턴은 이미 `UNANSWERED`로 수집되고, API 고정 문구·버튼 턴은 기존에도 제외(`collect-decision.ts` 31·36행) | **👎 1회 즉시 편입(메시지당 1회 기여)** · 제외 = 폴백(이미 수집)·API 고정 문구·`NODE` 버튼·빈 입력·장문 · 👎→👍 변경해도 기여 유지 · 소스별 `PENDING` 상한(2,000). N회 임계 설정은 2차 |
| **P-6** | **큐 모델**(J-8) — 같은 행 카운터 / **소스 분리** / 별도 테이블 | 유일 키가 소스를 모른다(`schema.prisma` 626행). 수집기는 `source`를 쓰지 않는다(`unanswered-collector.service.ts` 101~111행). 목록 DTO·필터에 소스가 없다(`learning.ts` 52~83행). ADR-0019 91행은 "테이블을 쪼개지 않으려고 소스를 둔다" | **소스 분리** — 유일 키 `(chatbotId, source, questionNormalized)`(기존 행 충돌 0) · 쓰기 주체 2곳 유지 · 목록 `source` 필터(기본 전체)·배지 · 같은 질문 타 소스 항목 링크 |
| **P-7** | **잘못 매칭 대상 표시와 처리 동작**(J-9) | 반영은 **의도 예문 추가 + `resolvedIntentId` 필수**(`unanswered-questions.service.ts` 229~274행) — "매칭은 맞는데 답변 내용이 틀림"에는 맞지 않는다. `resolvedIntentId`는 nullable(`schema.prisma` 620행). 로그에 당시 매칭 id·마스킹 답변이 있다(455~459·454행) | 부정 평가 항목에 **당시 답변(마스킹본)·매칭 대상(의도/FAQ/노드/문서 답변/폴백, 삭제됨)** 표시 · 추천에 **"현재 매칭" 배지**·같은 의도 반영 시 경고 · 신규 **"직접 수정 완료"**(`RESOLVED`+의도 없음, 부정 평가 전용, 비감사) · 대상 편집 링크 |
| **P-8** | **👍 반영**(J-10) | 큐는 "검토할 것" 목록이다(ADR-0019 §1). 👍마다 큐를 조회·갱신하면 쓰기 경로가 늘어난다 | **1차 큐 비반영 — 통계에만.** "같은 질문 👍 n건" 표시는 2차 |
| **P-9** | ★ **자유 텍스트 사유**(J-11) — 없음 / 고정 코드 / 자유 텍스트 | 자유 텍스트는 "저장" 지점의 새 테이블이 된다(설문 선례 `schema.prisma` 1220~1221행 · 개발명세서 §5 보안 ①). 규칙 마스킹은 이름·주소 미탐(ADR-0013 §6). 보존기간·파기 정책 없음(ADR-0033 · No.45). 요약·감성 분석 요구로 이어진다(`survey-management.md` 818행) | **1차 없음**(큐 상세에 질문·당시 답변·매칭 대상이 있어 판단 재료 충분) · **2차 = 고정 사유 코드**(선택형 3~4개, 개인정보 0) · **자유 텍스트는 No.45와 함께**(금지어→PII 마스킹·보존·봉인을 설문과 같은 규칙으로) |
| **P-10** | **만족도 통계 위치와 지표**(J-12) — No.14 챗봇 스코프 / No.29 통합 / 대시보드 | 대시보드는 "한 글자도 바꾸지 않는다"(`stats.service.ts` 47~48행). No.14 권한 `chatbot:read`(`stats.controller.ts` 35~60행). 통합 통계는 "데이터 없는 카드는 두지 않는다" 권고(`integrated-stats.md` 365행). Prisma groupBy는 조인 불가 → 원장 비정규화 필요 | **No.14 통계 화면 "답변 만족도" 섹션**(신규 엔드포인트 1개): 👍·👎 · 긍정률 · **참여율(분모 = 평가 버튼을 실제 제공한 턴 — 로그 `feedbackOffered`)** · 일별 추이 · 👎 상위 대상(질문 문장 없음) · 표본 표기. 대시보드 불변 · 통합·의도별은 2차(`groupId` 스냅샷은 지금 적재) |
| **P-11** | **기능 스위치 위치·기본값**(J-13) | `access.resolve()`가 요청마다 WEB 채널 행을 이미 읽는다(`public-access.service.ts` 20~33행) → 추가 조회 0. `ChatbotAnswerSetting`은 버전 복원이 지운다(`schema.prisma` 1234~1237행 교훈). 채널은 스냅샷 밖(ADR-0031) | **WEB 채널 설정 `답변 평가 받기`(기본 꺼짐, `channel:write`)** — 최종 저장 위치는 architect 확정 |
| **P-12** | **위젯 변경 수용과 표시 규칙**(J-14) | 봇 말풍선이 `messageId`를 모른다(`message-list.ts` 43~48·138행 · `store.ts` 17~22행). 번들 게이트 100KB(`check-bundle-size.mjs` 10행) · 현재 11.16KB(`CHANGELOG.md` 181행) | **위젯 변경 수용**(vanilla 유지) · `feedback-v1` 선언 · **서버가 평가 가능하다고 표시한 봇 말풍선에만** 버튼 2개(텍스트 이름·`aria-pressed`) · 인사말·대기 문구·시스템·오류·상담원 말풍선 제외 · 실패 시 조용히 1회 재시도 |
| **P-13** | **No.27 설문 · No.24 상담과의 경계**(J-15) | 설문은 노드 배치형 대화 단위 조사이고 결과를 큐에 넣지 않는다(`survey-management.md` 556행). 상담원 메시지는 로그가 아니라 `HandoffMessage`(`schema.prisma` 1325~1346행), 상담 턴은 `outputs=[]`(`app.ts` 464~468행). 상담원 평가는 No.24 종료 후 설문 노드(`schema.prisma` 1253~1255행) | **중복 아님 — 병존.** 설문 문항·상담 턴·상담원 메시지는 평가 대상 아님 · 상담 전후 봇 답변은 평가 가능 · 👎의 상담 경고 산입은 후속 |
| **P-14** | **시뮬레이터·TC 평가 적재**(J-16) | 시뮬레이터·TC는 로그를 남기지 않는다(`simulation.service.ts` 46~51행 · ADR-0030) — 평가는 로그 행을 전제로 한다 | **0건(구조로 보장)** · 시뮬레이터 화면에 버튼 없음 · DI 미주입 정적 검사 |
| **P-15** | **권한·감사**(J-17) | 역할 4·권한 17(`security.ts` 11·29~47행). 큐 상태 비감사(ADR-0019 73~82행 — 사용자 발화가 `targetName`에 들어감). 사용자 응답(설문) 비감사(ADR-0035) | **신규 권한·역할·감사 대상 0** · 평가·편입·직접 수정 완료 비감사 · 스위치는 기존 `Channel UPDATE` |
| **P-16** | **GPU · 배포 형태**(J-18) | 카탈로그 GPU 2(`기능요구사항.md` 93행). 신규 연산은 전부 CRUD·집계. 큐 추천은 기존 분류기/문자 유사도(`unanswered-questions.service.ts` 89~129행) | **GPU 2 유지**(신규 연산 1, 추천은 No.15와 같은 등급) · 구축형 ○ · 구독형 ○ |

> **★ 핵심 쟁점**: 도입 여부 = **P-1** · 평가 위변조 방어 = **P-3** · 큐 편입 기준 = **P-5** · 자유 텍스트 사유 = **P-9**.
> **쟁점 → P 매핑**: 범위 = P-1 · 공개 표면 = P-2·P-4 · 위변조 = P-3 · 큐 = P-5·P-6·P-7·P-8 · 개인정보 = P-9 · 통계 = P-10 · 스위치 = P-11 · 위젯 = P-12 · 경계 = P-13·P-14 · 권한/감사 = P-15 · 카탈로그 = P-16. **평가 경로·메서드·응답 필드 형태(FR-FB3-1·FR-FB2-2) · 스위치 최종 저장 위치(FR-FB1-1) · `inputKind`/`feedbackOffered` 로그 컬럼(J-19·FR-FB2-3) · 전용 버킷 구현 방식(FR-FB4-4) · 큐 유일 키 마이그레이션 절차(FR-FB6-1) · 편입 판정 함수 공유 방식(FR-FB6-3)은 architect 확정 사항**(권고안 제시).

---

## 12. 다음 단계 인계

| 에이전트 | 이 문서에서 넘기는 것 |
|---|---|
| **PM** | ★ **P-1 먼저** — 미도입이면 T-1~T-10을 "미도입"으로 닫고 `learning.ts` 22행·`schema.prisma` 614행 예고 주석 정리만 architect에 요청 |
| **`system-architect`** | **[완료 2026-09-25 — `docs/02-spec/feedback-loop-설계.md` · ADR-0038 · `feedback-loop-patches.md`. 다음 인계: ui-designer(위젯 막대 낭독 실측 포함) → backend-implementer는 ① 큐 소스 분리 준비 커밋(동작 불변 — 기존 시험 무수정 통과가 게이트) → ② 본체 순서]** ① **ADR-0038** 작성(J-3/J-4/J-6/J-7/J-8/J-13/J-19) ② ADR-0019 갱신(유일 키 · 두 번째 진입점 — 마스킹본만 읽음 · `inputKind` 컬럼화 · 소스별 상한 · 직접 수정 완료) · ADR-0011/0015(`@Public` 8)·0033·0002·0012 각주 ③ **평가 경로·메서드·응답 선택 필드 형태** ④ **평가 가능 판정 위치**(응답 조립 직전 — BLOCK·상담 HANDLED 반환 경로는 표시 없음, 보류 RAG 턴의 `RagAnswerRunInput` 전달) ⑤ **전용 레이트리밋 버킷**(`@PublicRateBucket` 확장 여부·키) ⑥ `ConversationLog` 컬럼 2개 · `UnansweredQuestion` 유일 키 변경 마이그레이션(중복 0 확인·잠금 시간 — NFR-FBP7) ⑦ `MessageFeedback` DDL·비정규화 필드 확정 ⑧ 편입 판정 순수 함수와 `shouldCollect()`의 규칙 공유 방식 ⑨ 원장 `queuedAt` 조건부 갱신(동시 1회) ⑩ `feedback-sealing.spec.ts` 단언 목록(FR-FB10-1 권고: 원장 삭제 0 · 쓰기 1파일 · 텍스트/`sessionId` 컬럼 0 · `@Public` 8 · 평가 서비스가 엔진·RAG·상담 모듈 import 0 · 시뮬레이션/검증/버전/예약 모듈의 평가 모듈 import 0 · 큐 쓰기 2파일 유지 · 역검증 픽스처) ⑪ FR-0-146 기대값 변경 닫힌 목록 ⑫ 스위치 저장 위치 최종 확정 |
| **`ui-designer`** | ① **위젯 평가 버튼**(위치·아이콘·텍스트 이름·선택 상태·실패/불가 문구·긴 대화 탭 이동) ② **학습현황**: 소스 필터·배지·부정 평가 상세(당시 답변·매칭 대상·"현재 매칭" 배지·타 소스 링크)·"직접 수정 완료"·대상 편집 링크 ③ **No.14 통계 화면 "답변 만족도" 섹션**(카드·추이·👎 상위 대상 표·표본 표기·표 대체) ④ WEB 채널 설정 스위치 문구 ⑤ 고정 문구 검토(FR-0-147) |
| **`backend-implementer`** | FR-FB1~FB8 · FR-FB10. ★ **최우선 주의 6가지**: ① **꺼진 챗봇·미선언 위젯 바이트 동일·추가 조회 0**(AC-FB1-1·FB1-3) ② **결합 검증 단일 404**(AC-FB3-1) ③ **메시지당 1행·큐 기여 1회**(AC-FB3-2·FB3-7) ④ **대화 버킷 비소비**(AC-FB3-5) ⑤ **큐 문장 = 로그 마스킹본, 원장 텍스트 0**(AC-FB4-5) ⑥ **소스별 상한**(AC-FB4-4) |
| **`frontend-implementer`** | 위젯 평가 버튼(`core/` 순수 판단 + `ui/`) · 학습현황 확장 · 만족도 섹션 · 채널 설정 스위치. 위젯 번들 증가분 보고 · 메시지 목록 재낭독 금지 |
| **`test-automation`** | AC-FB1~FB8. ★ **필수 9종**: **AC-FB1-1**(무변경 회귀) · **AC-FB2-2**(평가 불가 턴) · **AC-FB3-1**(위조 단일 404) · **AC-FB3-2/3**(중복·토글) · **AC-FB3-5**(버킷 분리) · **AC-FB4-1/2**(편입·제외 규칙) · **AC-FB5-4**(직접 수정 완료) · **AC-FB6-1**(만족도 지표 픽스처) · **AC-FB8-3**(봉인). 턴 유형 × 평가 가능 × 편입 여부 표를 시험데이터로 고정 |
| **`ml-engineer`** | 해당 없음(신규 모델 0 · ml-worker 변경 0 — 기존 분류기 추천 재사용) |

### FR-FB10 (봉인 — §6.2 NFR-FBS6 상세)

| ID | 요구사항 |
|---|---|
| FR-FB10-1 | 정적 검사 `feedback-sealing.spec.ts`: ① `messageFeedback.delete*`·원시 `DELETE` 0 ② `messageFeedback` 쓰기 파일 1개 ③ `MessageFeedback` 모델에 텍스트성 컬럼·`sessionId`·IP/UA 컬럼 0 ④ `chatbotId` FK `Restrict`(Cascade·SetNull 0) ⑤ 영구삭제 사전검사에 `messageFeedbacks` 존재 ⑥ `@Public()` 총 8 ⑦ 평가 모듈이 `dialogue-engine`·RAG·상담·임베딩 모듈을 import하지 않음 ⑧ 시뮬레이션·검증·버전·예약 모듈이 평가 모듈을 import하지 않음 ⑨ `unansweredQuestion` 쓰기 파일 ~~2개~~ **3개**(수집기·상태 전이·No.23 `decomposed-resolve.service.ts` — architect 정정 2026-09-25) 유지 ⑩ `conversationLog.update*`/`upsert` 0 유지(R-10 재확인) — 역검증 픽스처 포함 |
