# ADR-0018 — No.15 "재학습"의 범위 경계와 ml-worker 인계 지점(단일 메서드)

- **상태**: 채택 (Accepted)
- **일자**: 2026-09-22
- **결정자**: system-architect
- **관련**: `docs/requirements/stats-learning.md` **J-1**, FR-15-20~34, NFR-P5, NFR-M4, AC-15B-4/5/9/10/11/12/17, EX-15-5/7/10/13 / `ADR-0008`(규칙 매칭 파이프라인 — "학습" 연산의 부재) / `ADR-0004`(쓰기 주체 없는 스키마 금지) / `ADR-0007`(교체 지점을 인터페이스 1곳으로) / `ADR-0016`(감사 기록은 커밋 후 별도 쓰기)
- **영향 범위**: `apps/api/src/learning/**`(신규), `apps/api/src/intents/intents.service.ts`, `apps/api/prisma/schema.prisma`(**`TrainingJob` 미생성**), `packages/shared-types/src/learning.ts`(신규), 개발명세서 §4(`/stats/training-status` 삭제)
- **세부 설계**: `docs/02-spec/stats-learning-설계.md` §10

## 맥락

기준 목록 No.15의 기능명은 "**학습현황(관리자 보조 재학습)**"이고, 원본 매뉴얼(`로차_간단학습매뉴얼.pdf` p.21)은 "의도 등록 완료 후 **'의도 학습'을 하여야 반영됨**"이라고 명시한다. 개발명세서 §3에는 `TrainingJob` 테이블이, §4에는 `GET /stats/training-status` 엔드포인트가 **예고**되어 있고, `docs/04-test/시험항목.md` TC-15에는 "**재학습 Job 생성**"이 검증 항목으로 적혀 있다.

그런데 현행 아키텍처에는 **"학습"이라는 연산이 존재하지 않는다.** 매칭은 `packages/dialogue-engine`의 정규화 기반 규칙 매칭(정확일치/부분일치)이며(ADR-0008, `matcher.ts`), 학습된 가중치·모델 파일·인덱스 빌드 단계가 없다. `Intent.examples`에 문자열을 추가하고 `DialogueBundleService.invalidate(chatbotId)`를 호출하면 **다음 턴부터 매칭에 반영된다.**

따라서 결정해야 할 것은 두 가지다.

1. **이번 Phase의 "재학습"은 어디까지인가** — `TrainingJob`·`apps/ml-worker`·경량 분류기 재학습·수동 트리거 API를 만들 것인가.
2. **만들지 않는다면, 나중에 만들 때 무엇을 고치게 되는가** — No.16/No.23 착수 시의 교체 표면을 지금 어떻게 좁혀 둘 것인가.

## 결정

### 1. 이번 Phase의 "재학습"은 **① 의도 예문 추가 → ② 상태 전이 → ③ 번들 캐시 무효화**까지다

**만들지 않는 것**: `TrainingJob` 테이블 · `apps/ml-worker` 연동 · Job 큐(Redis/BullMQ) · 경량 분류기 재학습 · 딥러닝 증강학습 · 군집분석 · **수동 재학습 트리거 API(`POST /retrain`)** · "학습 중/완료" 상태 표시.

**만드는 것**: `learning` 모듈(미응답 큐 검토 → 의도 예문 반영 → 즉시 적용 확인) + **인계 지점 1곳**(아래 §2).

- 화면은 "학습 중"이 아니라 **"반영 완료 — 다음 대화부터 적용됩니다"** 로 표기한다. 이것이 사실이다.
- 개발명세서 §4의 **`GET /stats/training-status`를 삭제**한다 — 조회할 "학습 상태"라는 것이 시스템에 존재하지 않는다. 학습현황은 상태 조회가 아니라 **챗봇 스코프의 검토 큐 처리**이므로 `/chatbots/:chatbotId/unanswered-questions/*`로 대체한다.
- `docs/04-test/시험항목.md` TC-15의 "재학습 Job 생성"은 **이번 범위에 존재하지 않는 검증 항목**이므로 정정 대상이다.
- **역할 분담 결론**: 이 그룹은 `backend-implementer` 단독 구현이다. **`ml-engineer`는 투입하지 않는다.**

### 2. 인계 지점 = `LearningApplyService.applyLearning()` **단일 메서드** (DD-55)

```ts
// apps/api/src/learning/learning-apply.service.ts
export interface LearningApplyResult {
  mode: 'IMMEDIATE' | 'QUEUED';
  appliedImmediately: boolean;   // 화면 문구의 근거. 하드코딩 금지
  jobId: string | null;          // 현재 항상 null. 향후 TrainingJob.id
}

async applyLearning(input: {
  chatbotId: string;
  intentIds: string[];           // 단건도 배열. 향후 Job payload
  reason: 'UNANSWERED_RESOLVE' | 'UNANSWERED_BULK_RESOLVE';
  resolvedCount: number;
}): Promise<LearningApplyResult> {
  this.bundleService.invalidate(input.chatbotId);            // ← 현재 구현의 전부
  return { mode: 'IMMEDIATE', appliedImmediately: true, jobId: null };
}
```

**인계 계약 6건** — No.16/No.23 담당자와 `code-reviewer`가 함께 지킨다.

| # | 계약 |
|---|---|
| K-1 | **`learning` 모듈에서 `DialogueBundleService.invalidate()`를 호출하는 곳은 이 메서드 1곳뿐이다.** `UnansweredQuestionsService`는 `bundleService`를 주입하지 않는다 |
| K-2 | **요청당 정확히 1회 호출.** 단건도 1회, 일괄 50건도 1회(FR-15-33, AC-15B-12 — 50회 무효화 금지) |
| K-3 | 호출 위치는 **상태 전이 성공 이후, DB 트랜잭션 밖**(ADR-0016 §4의 "커밋 후" 원칙과 동일). 캐시 무효화는 롤백할 수 없다 |
| K-4 | 응답의 `appliedImmediately`는 **이 메서드의 반환값을 그대로 전달**한다. 서비스·컨트롤러·프런트가 `true`를 하드코딩하지 않는다 — No.16 전환 시 화면 문구가 자동으로 바뀌는 근거다 |
| K-5 | **실패를 삼키지 않는다.** 향후 큐 적재 실패는 호출부로 전파해 `503`으로 응답한다. 반영되지 않았는데 "반영 완료"라고 말하면 안 된다(대화 로그 적재의 삼킴 정책과 성격이 다르다) |
| K-6 | **수동 트리거 API를 만들지 않는다.** 내부가 no-op인 엔드포인트는 관리자에게 "학습 중이니 기다려야 한다"는 잘못된 모델을 심는다 |

No.16/No.23 착수 시 바뀌는 것은 **이 메서드의 본문과 반환값뿐**이다(`TrainingJob` 적재 후 `{ mode:'QUEUED', appliedImmediately:false, jobId }` 반환). 호출부의 분기 코드는 수정되지 않는다.

### 3. 예문 추가는 `IntentsService`의 공용 메서드를 **재사용**한다. 복제하지 않는다 (DD-62, NFR-M4)

`IntentsService.applyLearningExample(chatbotId, { intentId?, intentName? }, exampleText, { auditSummary, deferBundleInvalidate })`를 추출해 `learning`이 호출한다.

- 예문 병합·중복 제거·**상한 500**·**충돌 검사**·**감사 기록**·정규화 이름 유일성은 **`Intent`의 불변식**이며 그 소유자는 `IntentsService`다. `learning`에 복제하면 두 경로의 규칙이 조용히 어긋난다.
- `deferBundleInvalidate: true`(기본 `false`)로 **번들 무효화만 호출부로 미룬다** → K-1/K-2가 성립한다. 기본값이 `false`이므로 **기존 호출부의 동작은 변하지 않는다**(무회귀).
- `intentName`만 주어지면 `(chatbotId, normalizeText(name))`으로 조회해 **있으면 병합, 없으면 생성**한다(AC-15B-6/7). 어느 쪽인지는 **저장 전에 화면이 먼저 알린다** — 의도가 뜻하지 않게 새로 생기는 일을 막는다.

### 4. 반영 순서는 **예문 → 상태 전이(CAS) → applyLearning**이며 트랜잭션으로 묶지 않는다 (DD-63)

| 시나리오 | 결과 | AC |
|---|---|---|
| 예문 상한 초과 | `400 LIMIT_EXCEEDED`, 상태 **`PENDING` 유지**, 부분 반영 없음 | AC-15B-9 |
| 동시 `resolve` 2건 | 예문 추가가 dedupe로 **멱등** → 중복 0. 상태 전이는 `updateMany({ where:{ status:'PENDING' } })`로 **한쪽만 성공**, 다른 쪽 `409 ALREADY_RESOLVED` | AC-15B-11 |
| 예문 성공 후 상태 전이 실패 | 예문은 남고 항목은 `PENDING` → 재반영이 무해한 no-op. **대화 자산을 잃지 않는 방향**의 결손 | — |

- **트랜잭션을 쓰지 않는 이유**: `IntentsService`에 트랜잭션 클라이언트를 흘리면 모든 메서드 시그니처가 오염되고, 감사 기록이 트랜잭션 안으로 들어가 ADR-0016 §4(Postgres aborted transaction)에 정면으로 걸린다. **예문 추가의 멱등성**이 트랜잭션 없이도 두 AC를 동시에 만족시킨다.
- 상태 전이는 반드시 **조건부 `updateMany`(compare-and-set)** 다. `findFirst` 후 `update`는 경합 창을 남긴다.

### 5. 반영해도 답하지 못하는 경우를 **화면이 먼저 알린다** (FR-15-25)

반영 응답에 `linkedNodeCount`(그 의도를 참조하는 노드 수, `DialogNodeIntent` 역참조 — ADR-0005)를 포함하고, `0`이면 지속 표시 경고 + 노드 생성 링크를 제시한다. 원본 매뉴얼 p.4가 오답 유형을 "의도 미파악 / 키워드 미파악 / 둘 다"로 3분기한 바로 그 함정이며, 이 경고가 없으면 관리자는 "반영했는데 왜 안 되지"에서 막힌다.

## 근거

- **현행 아키텍처에 "학습"이 없다.** ADR-0008이 확정한 파이프라인은 규칙 매칭이다. 예문을 넣고 캐시를 무효화하면 다음 턴부터 반영된다 — 이 시스템에서 "재학습"의 전부다. 있지도 않은 단계를 화면에 만들면 사용자를 속인다.
- **ROCHA의 '의도 학습' 버튼은 DLE 전제다.** 그 대응물은 우리 목록의 **No.16 딥러닝 학습엔진(GPU 6, 확장기능)** 이며 No.15가 선점할 항목이 아니다.
- **GPU 등급이 범위를 못 박는다.** 기준표에서 1~2 = CPU 전용(CRUD/설정/통계조회/규칙매칭)이고 No.15는 **2**다. 경량 분류기 재학습은 **No.23(GPU 4)** 의 정의 그 자체이며, 딥러닝 증강학습은 **No.16(GPU 6)**, 군집분석은 **No.21(GPU 7)** 이다. No.15가 이를 구현하면 세 항목이 빈 껍데기가 된다.
- **쓰기 주체 없는 스키마를 만들지 않는다(ADR-0004).** 지금 `TrainingJob`을 만들면 상태가 항상 `SUCCEEDED`인 가짜 Job 행만 쌓인다. 같은 기준이 이번 Phase에 `UnansweredQuestion`을 채우는 것을 **허용**한 것과 정확히 대칭이다(그쪽은 쓰기 주체가 생겼다).
- **교체 지점을 1곳으로 좁히는 것이 이 프로젝트의 확립된 패턴이다.** ADR-0007(업로드 스테이징)·ADR-0011(채널 어댑터 팩토리)·ADR-0016(감사 기록 단일 진입점)이 모두 "인터페이스 1곳 + 구현 교체"로 미래를 열어 뒀다. DD-55는 그 패턴의 네 번째 적용이다.
- **반환값으로 모드를 전달하는 것이 핵심이다.** `appliedImmediately`를 상수로 두면 No.16 도입 시 프런트·서비스·문구를 함께 고쳐야 한다. 반환값에 실으면 **메서드 1곳만 바뀌어도 화면이 정확해진다** — 이것이 "인터페이스만 남긴다"의 실질적 의미다.
- **예문 로직 복제 금지는 협상 대상이 아니다.** 상한·충돌·감사가 두 벌이 되면 "의도 편집에서는 막히는데 학습현황으로는 통과하는" 구멍이 생긴다. 권한을 `dialogue:write`로 정한 것(J-7)과 같은 원칙 — **동작이 바꾸는 자원을 기준으로** 규칙과 통제를 정한다.

## 대안과 트레이드오프

| 대안 | 기각 사유 |
|---|---|
| **`TrainingJob` 테이블 + no-op Job을 지금 만든다** | 쓰기 주체 없는 스키마(ADR-0004). 항상 `SUCCEEDED`인 행만 쌓이고, 나중에 실제 Job이 생기면 스키마를 다시 바꿔야 한다(그때 상태·진행률·오류 필드가 결정된다) |
| **`POST /chatbots/:id/retrain` 수동 트리거 API를 노출(내부는 캐시 무효화)** | 관리자가 "학습 중이니 기다려야 한다"고 오해한다. 실제로는 저장 즉시 반영되므로 화면이 "반영 완료"를 즉시 말해야 정확하다. 게다가 이 API는 No.16 도입 시 의미가 달라져 하위호환 부담이 된다 |
| **경량 분류기(TF-IDF 등)를 이번에 도입** | **No.23의 정의 그 자체**(GPU 4, 경량 배치). 선점하면 그 항목이 빈 껍데기가 되고, 모델 산출물 보관·버전·롤백이라는 별도 설계가 이번 범위로 끌려 들어온다 |
| **`learning`이 예문 추가를 직접 구현(Prisma 직접 조작)** | 상한·중복·충돌·감사·번들 무효화가 두 벌이 된다(NFR-M4 위반). 의도 편집 경로의 통제를 우회하는 구멍 |
| **`IntentsService.updateExamples()`를 그대로 호출** | `summary`가 `"예문 추가 1건 · 삭제 0건"`으로 고정돼 FR-15-34("학습현황 반영")를 만족하지 못하고, 번들 무효화가 항목마다 일어나 FR-15-33(일괄 1회)을 위반한다. 그래서 `auditSummary`·`deferBundleInvalidate`를 받는 공용 메서드를 추출했다 |
| **반영 전체를 `$transaction`으로 묶는다** | `IntentsService`에 tx 전파 → 전 메서드 시그니처 오염 + 감사 기록이 트랜잭션 안으로 들어가 Postgres에서 본 동작까지 실패(ADR-0016 §4). 멱등성으로 같은 안전성을 얻는다 |
| **상태 전이를 `findFirst` → `update`로** | 검사와 갱신 사이에 경합 창이 열려 AC-15B-11(한쪽만 성공)이 확률적으로 깨진다 |
| **`reopen` 시 추가된 예문을 자동 삭제** | 되돌리기가 조용히 대화 자산을 바꾼다. 다른 관리자가 그 예문을 근거로 노드를 만들었을 수 있다. 예문 삭제는 의도 편집 화면에서 **명시적으로** 수행한다(FR-15-28, EX-15-13) |
| **미응답 질문 자동 반영(사람 확인 없이)** | 기준 목록이 "**관리자 개입 필수인 반자동**"으로 못 박았고 원본도 "전문 담당자에 의한 일괄 학습"을 권고한다. 오학습 시 대화 품질이 **즉시** 나빠진다(반영이 즉시니까). 도입하지 않는다 — 설계 의도다 |
| **`bulk-resolve`를 `BULK_UPDATE` 감사 1건으로 요약** | 대상 의도가 서로 달라 "어느 의도가 바뀌었나"를 잃는다. 상한이 50이라 건당 기록의 볼륨 부담도 없다(ADR-0016의 대량 요약 규칙은 "같은 대상의 동일 동작"을 전제한다) |

**감수하는 비용**

1. **기준 목록·개발명세서·시험항목이 예고한 "재학습 Job"이 이번에 구현되지 않는다** → 상위 문서 3곳을 함께 정정하고(개발명세서 §3 각주·§4 엔드포인트, `시험항목.md` TC-15), 인계 지점을 문서에 명시했다. 기능 항목의 추가·삭제는 없다.
2. **`IntentsService`가 학습현황용 메서드를 하나 갖게 된다** — 모듈 경계로 보면 `learning`이 `intents`에 의존하는 단방향이고, 반대(intents가 learning을 앎)는 만들지 않았다. `Intent` 불변식의 소유자에 메서드를 두는 것이 반대 방향보다 옳다.
3. **트랜잭션 없는 2단 쓰기라 이론상 결손 창이 있다**(예문 성공 + 상태 전이 실패) → 멱등성 덕분에 재시도가 무해하며, 결손 방향이 "대화 자산을 잃지 않는 쪽"이다.
4. **동시 반영 시 패자도 감사 레코드를 1건 남긴다**(순 변경 0) → 감사는 "시도된 사실"의 append-only 기록이므로 허용 가능하다. 예문은 중복되지 않는다.

## 결과

- `apps/api/src/learning/` 신설 — `unanswered-questions.controller.ts`(8 핸들러, **삭제 경로 없음**) / `unanswered-questions.service.ts` / `unanswered-question.mapper.ts` / **`learning-apply.service.ts`(★ 인계 지점)** / `unanswered-collector.service.ts` / `lib/{collect-decision,variants,intent-suggest,occurrence-trend}.ts`.
- `apps/api/src/intents/intents.service.ts`: `applyLearningExample()` 추가(공통 코어 추출) · `IntentsModule`에 `exports: [IntentsService]` 추가.
- **`TrainingJob` 테이블 미생성**, `apps/ml-worker`·Job 큐 미도입, `POST /retrain` 미생성.
- 개발명세서 §4에서 **`GET /stats/training-status` 삭제**, §3 `TrainingJob` 행에 "No.15는 이 테이블을 쓰지 않는다" 각주 추가.
- `packages/shared-types/src/learning.ts` 신설(`ResolveResultSchema.appliedImmediately`는 **`z.boolean()`이며 `z.literal(true)`가 아니다**).
- `ApiErrorCode` 추가: `ALREADY_RESOLVED`·`BULK_SIZE_EXCEEDED`. **`INTENT_LIMIT_EXCEEDED`는 만들지 않는다**(기존 `LIMIT_EXCEEDED` 재사용 — AC-15B-9).
- 환경변수: `LEARNING_BULK_MAX_ITEMS`(50)·`INTENT_SUGGEST_MIN_SCORE`(0.25) — 선택.
- `test-automation` 인계: ① **AC-15B-5(반영 직후 캐시 TTL을 기다리지 않고 매칭 — 이 ADR의 핵심 주장을 증명하는 테스트)** ② AC-15B-11(동시 반영 → 한쪽 409 + 예문 중복 0) ③ AC-15B-9(상한 초과 시 상태 `PENDING` 유지) ④ AC-15B-12(일괄 부분 성공 + **번들 무효화 1회**) ⑤ AC-15B-6/7(신규 생성 / 정규화 병합) ⑥ AC-15B-8(`linkedNodeCount: 0` 경고) ⑦ AC-15B-15(`reopen` 후 예문 잔존) ⑧ AC-15B-17/18(감사: `Intent`만 기록, 큐 상태 변경은 미기록) ⑨ **EX-15-6의 기대값은 `409 CHATBOT_ARCHIVED`** 로 수정(설계서 §2.2 C-1).
- `code-reviewer` 인계: ① `learning`에 예문 상한·dedupe·충돌 검사 복제 0건 ② `bundleService.invalidate()` 호출이 `LearningApplyService` 1곳 ③ 상태 전이가 조건부 `updateMany`인지 ④ `appliedImmediately` 하드코딩 0건 ⑤ `TrainingJob`·`retrain` 문자열이 코드에 없는지 ⑥ `deferBundleInvalidate` 기본값이 `false`라 기존 호출부가 무영향인지.
