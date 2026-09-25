# ADR-0019 — 미응답 질문 큐의 수집 모델(실시간 upsert · 적재 지점 · 상태 전이 정책)

- **상태**: 채택 (Accepted)
- **일자**: 2026-09-22
- **결정자**: system-architect
- **관련**: `docs/requirements/stats-learning.md` **J-2**, **J-5**, **J-6**, FR-0-37, FR-15-1~14, FR-15-29, FR-15-35/36, NFR-P3, NFR-S1/S2/S7/S8, NFR-M3, AC-15A-1~11, AC-15B-14/16/18/19, EX-15-1~4/11/14/15 / `ADR-0004`(쓰기 주체 없는 스키마 금지) / `ADR-0006`(정규화 결과 컬럼 + 유니크) / `ADR-0013`(PII 마스킹은 `ConversationLogService.record()` 내부 1곳) / `ADR-0016`(감사로그에 대화 원문 금지)
- **영향 범위**: `apps/api/prisma/schema.prisma`(`UnansweredQuestion` 전면 보강), `apps/api/src/conversation/{conversation-log.service.ts, public-conversation.service.ts}`, `apps/api/src/learning/unanswered-collector.service.ts`(신규), `packages/shared-types/src/{stats.ts, learning.ts}`
- **세부 설계**: `docs/02-spec/stats-learning-설계.md` §3.1·§8·§9

## 맥락

`UnansweredQuestion` 테이블은 Phase 0부터 존재하지만 **쓰기 코드가 0줄**이다(`apps/api/src` 전체에서 읽기는 `chatbots.service.ts`의 영구삭제 영향 미리보기 1곳뿐이고, `packages/shared-types/src/stats.ts`의 `UnansweredQuestionSchema`·`ResolveUnansweredQuestionSchema`도 소비자가 없다). 즉 **미응답 질문이 어디에도 축적되지 않는다** — 관리자가 "무엇을 못 답했는지" 알려면 대화 로그를 직접 뒤져야 한다.

No.2 대시보드는 미응답률이 높다는 **사실**을 알려주지만(FR-2-3), 그다음에 할 일이 시스템 안에 없다. 진단은 있고 처방이 없다.

결정해야 할 것이 네 가지다.

1. **데이터 소스** — 전용 테이블에 실시간 수집할 것인가, `ConversationLog`에서 조회 시점에 파생 집계할 것인가.
2. **적재 지점** — 파이프라인의 어디에서 쓸 것인가(마스킹·실패 정책·시뮬레이션 제외가 모두 여기에 걸린다).
3. **상태 전이 정책** — 반영/무시한 질문이 다시 들어오면 어떻게 할 것인가.
4. **감사 기록 대상인가** — 큐 상태 변경을 `AuditLog`에 남길 것인가.

## 결정

### 1. `UnansweredQuestion` 테이블에 **실시간 upsert**로 수집한다. 파생 집계는 기각

`ConversationLog`에서 조회 시점에 미응답 질문을 집계하는 대안을 기각한다.

- **검토 상태는 로그에서 파생할 수 없다.** `PENDING`/`RESOLVED`/`IGNORED`는 **관리자의 판단 결과**이며 대화 로그에 존재하지 않는 정보다. 파생 집계로 가면 "이미 처리한 질문"을 기억할 곳이 없어 같은 항목이 매일 다시 올라온다.
- **테이블과 zod 스키마는 이미 있고 쓰기 주체만 없었다.** 이번 Phase가 ADR-0004의 기준("쓰기 주체가 생길 때 채운다")을 **충족하는 시점**이다 — 같은 기준으로 `TrainingJob`은 여전히 만들지 않는다(ADR-0018).
- 병합 키는 **`(chatbotId, questionNormalized)` 유니크**이며 `questionNormalized = normalizeText(questionText)`다(ADR-0006의 패턴을 그대로 적용 — NFKC·trim·소문자·연속공백 축약). 같은 질문의 표기 변형이 1행으로 합쳐지고 `occurredCount`만 증가한다(AC-15A-2, EX-15-1).
- 스키마 보강: `questionNormalized`·`variants`(최근 5건 JSON)·`lastOccurredAt`·`status`(3종)·`recurredCount`/`recurredAfterAt`·`source`·`channelType`·`resolvedIntentId`/`resolvedAt`/`resolvedById`·`updatedAt` + 인덱스 3종. **`suggestedIntentName`은 제거**한다(§4).

### 2. 적재 지점은 **`ConversationLogService.record()` 내부**이며, 수집 로직은 별도 서비스로 분리한다

```
record() ─ ① 금지어 마스킹 → ② PII 마스킹 → ③ 버킷 계산 → ④ 로그 INSERT
                                                            └─▶ ⑤ UnansweredCollectorService.collect(...)
```

- **마스킹된 값에 접근할 수 있는 유일한 지점이다.** `record()` 안에서 금지어 → PII 마스킹이 끝난 문자열이 만들어진다(ADR-0013). 이 바깥에서 수집하면 **원문을 다시 만지게 되어 마스킹 정책이 무너진다.** 큐에 저장되는 문장은 항상 마스킹 후 값이며(AC-15A-9, NFR-S1) **마스킹 해제 경로를 제공하지 않는다.**
- **실패 정책을 그대로 상속한다.** `record()`는 이미 전체가 try/catch이고 호출부가 `void`(fire-and-forget)로 부른다(FR-11-24). 수집을 여기에 두면 같은 안전망 안에 들어간다 — **수집 실패가 대화 응답을 실패시키지 않는다**(FR-0-37, AC-15A-8). 수집기 내부에도 자체 try/catch를 둔다.
- **시뮬레이션 오염이 구조적으로 방지된다.** 관리자 시뮬레이션(No.10)은 `ConversationLog`를 적재하지 않으므로(FR-10-5) 수집 경로에 **도달할 수 없다**(AC-15A-6). 별도 플래그를 만들지 않는다.
- **책임 분리**: `record()`는 "무엇을 수집할지"를 알지 않는다. 마스킹된 값과 판정 결과를 넘기기만 하고, 조건 판정·병합·상한은 `UnansweredCollectorService` + `lib/collect-decision.ts`에 있다. `record()`가 이미 마스킹·버킷·적재를 책임지고 있어 여기에 수집 규칙까지 넣으면 한 함수가 네 가지 이유로 바뀌게 된다.
- **`prisma.unansweredQuestion` 쓰기는 2곳뿐이다** — `UnansweredCollectorService`(수집, 자동)와 `UnansweredQuestionsService`(상태 전이, 사람). 그 밖에서 호출하지 않는다(NFR-M3, `ConversationLogService` 규약과 동일).

### 3. 수집 조건 5종은 순수 함수가 판정하고, 버튼 턴은 **파라미터로 전달**한다

```
① isAnswered === false                    ← judgeAnswered() 결과를 그대로 신뢰(별도 판정 금지)
② blockedByFilter === false               ← 금지어 차단 턴은 개선 대상이 아니다(DD-37의 취지)
③ inputKind !== 'BUTTON_NODE'             ← 봇이 제시한 선택지는 사용자가 작성한 질문이 아니다
④ normalizeText(questionText) !== ''
⑤ normalized.length <= 200(기본)          ← 장문은 의도 예문으로 부적합
```

- **`inputKind`(`TEXT`|`BUTTON_NODE`|`BUTTON_MESSAGE`)는 `ConversationLog` 컬럼이 아니라 `record()`의 파라미터**다. 수집은 파이프라인 안에서 일어나므로 컬럼 없이 판별할 수 있고, 소비자가 1곳뿐인 컬럼을 늘리지 않는다(ADR-0004). **트레이드오프**: 사후 로그 분석으로는 버튼 턴을 구분할 수 없다 — 허용 가능한 손실로 판단하며, 재검토 트리거는 No.24/No.29가 입력 유형별 지표를 요구할 때다.
- 판정 기준은 기존 `resolveFilterableInboundText()`(금지어 입구 필터)와 **동일**하다. 분기식을 복제하지 않고 `inputKind`를 먼저 구해 두 곳이 그것을 참조하게 정리한다.
- `judgeAnswered()`(`conversation/lib/conversation-log.ts`)가 이미 폴백 판정의 단일 소스다(DD-31). 수집기는 **별도 판정을 만들지 않는다.**

### 4. 추천 의도는 **저장하지 않는다**. `suggestedIntentName` 컬럼을 제거한다 (J-5)

- 의도·예문은 계속 바뀌므로 저장된 추천값은 **다음 날 틀린 값**이 된다. 조회 시점 계산이 정확하며, 그 결과 이 컬럼은 **끝내 쓰기 주체가 생기지 않는다**(ADR-0004).
- 추천 계산은 `apps/api/src/learning/lib/intent-suggest.ts`의 **신규 순수 함수(문자 bigram 자카드)** 이며 엔진(`matchIntent`)을 호출하지 않는다 — 미응답 질문은 정의상 그 판정을 통과하지 못한 문장이므로 재사용하면 항상 `null`이다. `packages/dialogue-engine`은 **수정 0줄**.

### 5. 상태를 자동으로 되돌리지 않는다. 대신 **재발생을 드러낸다**

- `RESOLVED`/`IGNORED` 항목이 재유입되면 `occurredCount`와 **`recurredCount`/`recurredAfterAt`** 만 증가시키고 **상태는 유지**한다(FR-15-5, AC-15A-10, EX-15-11).
- 목록은 `반영 후 재발생 N회` 배지를 표시한다. 근거: 자동 재오픈은 같은 항목을 무한히 재검토하게 만들지만, 재발생 사실 자체는 **"반영이 효과가 없었다"는 가장 중요한 신호**라 숨기면 안 된다(EX-15-10 — 화면이 노드 연결·예문 추가를 안내한다).
- **큐 상한**: 챗봇당 `PENDING`이 상한(기본 5,000)에 도달하면 **신규 추가만 중단**하고(기존 항목 카운트 증가는 계속) 경고 로그 + 화면 배너로 알린다(FR-15-8, AC-15A-11, EX-15-2). 무한 증가 테이블을 운영 중에 발견하는 것보다 **상한에서 멈추고 알리는 편**이 안전하다.
- **물리 삭제 API를 제공하지 않는다**(FR-15-29, AC-15B-16). 삭제하면 같은 질문이 다시 유입될 때 "이미 판단한 항목"임을 알 수 없어 검토가 반복된다(FR-12-30의 회원 비활성화와 같은 논리). `IGNORED`로 대체하고 `reopen`으로 복원한다.

### 6. 큐 상태 변경은 **감사 대상이 아니다**. `AuditTargetType`을 확장하지 않는다 (J-6)

| 동작 | 감사 |
|---|---|
| `resolve`(단건·일괄) | **`Intent` UPDATE**(신규 생성 시 `CREATE`) 1건, `summary = "학습현황 반영 (미응답 N건)"` |
| `ignore` / `reopen` | **기록하지 않는다** |

- 실제로 바뀌는 자원은 **의도 예문**이고 그 경로는 이미 감사 대상이다. 큐 상태는 되돌릴 수 있는 내부 작업 상태다.
- 무엇보다 기록하면 `targetName`·스냅샷에 **사용자 발화가 들어가 NFR-S8("감사로그에 대화 원문·PII 금지")을 정면으로 위반**한다(ADR-0016). **어떤 감사 레코드에도 미응답 질문 문자열이 담기지 않는다**(AC-15B-19) — `summary`는 건수만, `before`/`after`는 기존 `Intent` 화이트리스트(`name`/`description`/`exampleCount`)뿐이다.
- 같은 이유로 **경고 로그에도 질문 본문을 넣지 않는다**(`chatbotId` + 오류코드만, NFR-S7).

## 근거

- **폐루프를 완성하는 것이 이 그룹의 목적이다.** 원본 매뉴얼(p.3~4)의 운영 루프는 `미응답 리스트 확인 → 의도 추가 및 예문 증강 → 반영 → 재검증`의 반복이며, 그 첫 단계인 "미응답 리스트"가 지금 존재하지 않는다. 축적 없이는 나머지 단계가 성립하지 않는다.
- **정규화 병합이 없으면 목록이 사용 불가능해진다.** `"해외배송 되나요"`와 `" 해외배송  되나요 "`가 별개 행이 되면 발생 횟수 순 정렬(검토 우선순위의 근거)이 무의미해진다. ADR-0006이 이미 같은 문제를 같은 방식으로 풀었다.
- **마스킹 지점이 적재 지점을 결정한다.** ADR-0013이 "마스킹은 `record()` 내부 1곳"을 확정했으므로, 마스킹된 값을 2차 저장하려면 그 안에서 분기하는 것이 **유일하게 정책을 깨지 않는 위치**다. 밖에서 수집하면 원문 접근이 필요해지고 ADR-0013이 막은 구멍이 다시 열린다.
- **큐는 마스킹 완료 데이터의 2차 저장소다**(NFR-S8) → 마스킹 정책(ADR-0013)이 바뀌면 **과거 큐 항목은 과거 정책 상태로 남는다.** 재처리 필요성은 정책 변경 시점에 판단해야 한다는 점을 운영 리스크로 기록한다(EX-15-14).
- **금지어 차단 턴을 제외하는 이유**: 차단은 **정책이 의도적으로 막은 결과**이며 개선 대상이 아니다. 포함하면 큐가 욕설로 채워져 검토 가치가 사라진다. `blockedByFilter` 컬럼(DD-37)이 예고한 "No.15가 재학습 후보로 잘못 집어 올리는 것을 막는다"가 바로 이 소비다. 단 `WARN` 정책 금지어는 정상 해석되므로 미응답이면 수집되고, 저장값은 이미 금지어 마스킹 후다(EX-15-15).
- **`source` 필드를 지금 두는 이유**: No.44(피드백 기반 개선 루프)가 같은 큐에 "👎 부정 피드백" 소스를 더한다. 그때 테이블을 쪼개지 않으려면 소스 구분이 처음부터 필요하다. 값 1종(`'UNANSWERED'`)이지만 **`source`는 수집기가 실제로 쓰는 컬럼**이므로 ADR-0004의 "쓰기 주체 없는 컬럼" 사례가 아니다.
- **영구삭제 경로에 새 장애물이 생기지 않는다.** 수집은 `record()` 안에서만 일어나므로 큐가 있는 챗봇은 반드시 대화 로그도 있고, 대화 로그는 **이미** 영구삭제를 막는 항목이다(ADR-0002). 즉 차단 집합이 실질적으로 변하지 않는다(AC-1-11 불변). seed는 이 포함관계를 유지한다.

## 대안과 트레이드오프

| 대안 | 기각 사유 |
|---|---|
| **`ConversationLog`에서 조회 시점 파생 집계(테이블 미사용)** | 검토 상태(`PENDING`/`RESOLVED`/`IGNORED`)를 저장할 곳이 없다. 처리한 질문이 매일 다시 올라와 운영 루프가 성립하지 않는다. `recurredCount`(반영 후 재발생)도 표현할 수 없다 |
| **`PublicConversationService`에서 별도 호출** | 마스킹 전 값에 접근하게 되어 ADR-0013이 막은 구멍이 다시 열린다. 실패 정책·시뮬레이션 제외를 각각 다시 구현해야 하고, 향후 채널이 늘면 호출 지점이 채널마다 복제된다 |
| **수집 로직을 `ConversationLogService` 안에 직접 작성** | 한 서비스가 마스킹·버킷·적재·수집 조건·병합·상한 여섯 가지 이유로 변경된다. 조건 판정을 순수 함수로 단위 테스트하기도 어려워진다 |
| **별도 배치/스케줄러가 주기적으로 로그를 스캔해 큐를 채운다** | 스케줄러 인프라가 없다(`security-audit.md` §9.3 선례). 실시간성이 사라져 "지금 막힌 사용자"를 놓친다. 정규화 병합 상태를 배치 간에 관리해야 한다 |
| **`ConversationLog.normalizedMessage` 컬럼을 추가해 양쪽에서 재사용** | 이번 Phase에 파생 컬럼을 3개(`dayBucket`·`hourBucket`·`normalizedMessage`) 넣으면 백필 위험이 커진다. 인기질문 정규화는 현행 앱 집계로 충분하다(ADR-0004). 재검토는 후속 Phase |
| **`inputKind`를 `ConversationLog` 컬럼으로 저장** | 소비자가 수집기 1곳뿐인 컬럼이다(ADR-0004). 사후 분석 요구가 확인되면 그때 추가한다 |
| **재발생 시 상태를 `PENDING`으로 자동 재오픈** | 관리자가 `IGNORED`로 판단한 항목(`ㅋㅋㅋ`, `.`, `테스트`)이 대량 재유입되면 큐가 다시 오염되고 무한 재검토가 된다. 재발생은 **배지로 드러내고 재오픈은 사람의 판단**으로 남긴다 |
| **큐 상한 없이 무한 증가 허용** | 운영 중에 "테이블이 수백만 행"으로 발견하는 시나리오가 된다. 상한에서 멈추고 알리면 대화는 정상 동작하고 관리자가 정리할 시간을 얻는다 |
| **물리 삭제 API 제공** | 삭제하면 "이미 판단한 항목"임을 잃어 같은 질문을 영원히 재검토한다. `IGNORED`가 같은 UX(기본 목록에서 사라짐)를 제공하면서 판단을 보존한다 |
| **`UnansweredQuestion`을 `AuditTargetType`에 추가해 상태 변경을 기록** | `targetName`에 사용자 발화가 들어가 NFR-S8 위반. 통제가 필요한 변경(예문 추가)은 이미 기록된다 |
| **추천값을 컬럼에 저장(`suggestedIntentName` 유지)** | 의도·예문이 바뀌면 즉시 낡는다. 갱신 주체를 만들면 의도 편집마다 전 큐를 재계산해야 한다. 조회 시점 계산이 정확하고 싸다 |
| **수집 upsert를 트랜잭션으로 감싸 카운터를 엄격히 보장** | 대화 응답 경로의 비용이 늘어난다(NFR-P3). 같은 턴에 ±1 오차가 생겨도 운영 판단(발생 횟수 순 검토)이 바뀌지 않는다. 경합 시 유니크 위반 1회 재시도로 충분하다 |

**감수하는 비용**

1. **대화 턴당 쿼리가 1~2회 늘어난다**(미응답 턴에 한해). 응답 반환 이후 fire-and-forget이라 사용자 대기 시간에 영향이 없다(NFR-P3, AC-X-5로 측정).
2. **카운터가 경합 시 ±1 어긋날 수 있다** — 트랜잭션을 쓰지 않는 대가이며, 지표의 용도(우선순위 정렬)에 영향을 주지 않는다.
3. **버튼 턴을 사후 로그로 구분할 수 없다**(DD-52) — 컬럼을 늘리지 않은 대가.
4. **변형 표기를 5건만 보관한다** — 전량 보관은 행 크기를 예측 불가하게 만든다. 발생 추이 파생이 변형 5종을 넘으면 근사가 되고, 그 사실을 응답 플래그(`trendApproximated`)로 알린다.
5. **마스킹 정책 변경 시 과거 큐 항목이 과거 정책 상태로 남는다**(EX-15-14) — 재처리 필요성을 정책 변경 시점에 판단하도록 리스크로 기록했다.
6. **`IGNORED` 항목이 영구히 쌓인다**(물리 삭제 없음) — 보존기간 정책·자동 정리는 No.45로 이관하고, 상한 + 수동 정리로 운영 가능하게 했다.

## 결과

- Prisma `UnansweredQuestion`: 필드 9종 추가(`questionNormalized`·`variants`·`lastOccurredAt`·`recurredCount`·`recurredAfterAt`·`source`·`channelType`·`resolvedIntentId`/`resolvedAt`/`resolvedById`·`updatedAt`), **`suggestedIntentName` 제거**, `@@unique([chatbotId, questionNormalized])` + 인덱스 2종. **`resolvedIntentId`/`resolvedById`에 FK를 걸지 않는다**(`AuditLog.actorId`와 동일한 의도적 예외).
  - ⚠ 마이그레이션 전 `SELECT COUNT(*) FROM unanswered_questions` = **0** 확인(쓰기 주체가 없었으므로 항상 0이어야 한다).
- `apps/api/src/learning/unanswered-collector.service.ts` 신설 — 수집 단일 진입점, `LearningModule`이 export하고 `ConversationModule`이 주입한다.
- `apps/api/src/learning/lib/{collect-decision.ts, variants.ts, intent-suggest.ts, occurrence-trend.ts}` 신설(전부 순수 함수, 단위 테스트 1차 대상).
- `conversation-log.service.ts`: `inputKind` 파라미터 추가 + 수집기 호출 1줄. `public-conversation.service.ts`: `inputKind` 산출 1줄.
- `packages/shared-types`: `UnansweredQuestion*` 스키마를 `stats.ts` → **`learning.ts`로 이동·재정비**(소비자 0이라 안전하며 `index.ts` re-export로 import 경로는 불변), `UnansweredQuestionStatus`를 **3종**으로 확장.
- 환경변수: `UNANSWERED_MAX_PENDING`(5000)·`UNANSWERED_MAX_QUESTION_LENGTH`(200) — 선택.
- **개발명세서 §3에 `UnansweredQuestion` 행 신설** — "미응답 질문 검토 큐. No.11 대화 파이프라인이 유일한 쓰기 주체이며 저장값은 마스킹 후 문자열이다. 물리 삭제 API가 없고 `IGNORED`로 대체한다".
- seed: 큐를 만드는 챗봇에 **대응 대화 로그도 함께 생성**해 "큐 있으면 로그도 있다"는 불변식(영구삭제 차단 집합 불변)을 유지한다.
- `test-automation` 인계: ① AC-15A-2(표기 변형 3종 → 1행 `occurredCount:3`) ② **AC-15A-3/4/6(수집 제외 3종 — 금지어 차단·NODE 버튼·시뮬레이션)** ③ AC-15A-5(빈 입력 제외) ④ AC-15A-8(수집 실패해도 대화 정상 + 로그에 본문 없음) ⑤ **AC-15A-9(큐 저장값이 마스킹된 값)** ⑥ AC-15A-10(재발생 시 상태 유지 + `recurredCount` 증가) ⑦ AC-15A-11(상한 도달 시 신규 중단·기존 증가 계속) ⑧ AC-15B-14(`ignore` 후 기본 목록 제외, `status=IGNORED`로 조회) ⑨ AC-15B-16(삭제 경로 부재) ⑩ **AC-15B-19(감사 레코드에 질문 문자열 0건)**.
- `code-reviewer` 인계: ① `prisma.unansweredQuestion` **쓰기**가 수집기·상태전이 서비스 2곳 밖에 없는지 ② 수집 경고 로그·오류 메시지에 질문 본문이 없는지 ③ `AuditTargetType`·`AUDIT_FIELDS` 무수정 ④ `conversation → learning` 단방향(역방향 의존 0건) ⑤ `suggestedIntentName` 잔존 참조 0건 ⑥ 추천 계산의 N+1 부재(의도 집합 요청당 1회 로드).


---

## 갱신 (2026-09-24 — No.27: 수집 제외 사유 `SURVEY_TURN`)

설문관리(No.27, ADR-0035 §7)에서 설문 세션이 입력을 소비한 턴(응답·건너뛰기·재질문·취소·완료)은 `ConversationLog.surveyTurn=true`로 적재되고 **미응답 큐에 들어가지 않는다**.

- `shouldCollect()` 입력에 `surveyTurn?`(기본 false — 기존 호출 무변경)을 더하고 `apiNotice` 다음 순서로 판정해 사유 **`SURVEY_TURN`** 을 반환한다. 설문 턴은 폴백 trace가 없어 원래 `ANSWERED`로 제외되지만, **명시적 사유**를 두어 판정 근거를 1곳에 남긴다(설문 답 "5"가 미래의 판정 변경으로 큐에 흘러드는 것을 막는다).
- 판정식은 여전히 `judgeAnswered()` 단일 소스를 신뢰하며, `surveyTurn`은 파이프라인이 엔진 결과(`surveyTurn`)를 그대로 전달한다 — API가 추정하지 않는다. 컬럼으로 두는 이유는 수집 외에 **질문 순위 제외**가 사후 로그를 소비하기 때문이다(결정 §3의 "`inputKind`는 파라미터" 판단과 다른 점 — 소비자가 로그 조회 쪽에 있다).


---

## 갱신 (2026-09-25 — No.24: 수집 제외 사유 `HANDOFF_TURN` · 경고 판정은 수집 판정과 목적이 다르다)

하이브리드 CS(No.24, ADR-0036 §1).

- `shouldCollect()` 입력에 `handoffTurn?`(기본 false — 기존 호출 무변경)을 더하고 `surveyTurn` 다음 순서로 판정해 사유 **`HANDOFF_TURN`**을 반환한다. 상담 구간 턴은 엔진을 타지 않아 원래 `ANSWERED`로 제외되지만 명시적 사유를 둔다(설문 선례). **개입 전 봇 구간 미응답은 그대로 수집된다** — 실제 학습 공백이다.
- **진행 중 경고(연속 미응답)는 이 판정을 재사용하지 않는다** — 큐는 "학습할 것", 경고는 "사람이 도울 사용자"다. 경고는 `judgeAnswered()`가 적재한 `isAnswered`만 읽고(재판정 금지 원칙 유지), 금지어·설문·상담 턴은 중립, **API 고정 문구 턴은 미응답으로 센다**(큐에서는 `API_NOTICE`로 제외 — 목적 차이). 사유 표시를 위해 `apiNotice`를 로그 컬럼으로도 남긴다(`record()` 1곳).


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
