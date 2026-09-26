# ADR-0008 — 대화 해석 파이프라인 `resolveResponse`와 `simulate` 하위호환 전략

- **상태**: 채택 (Accepted)
- **일자**: 2026-09-19
- **결정자**: system-architect
- **관련**: `docs/requirements/dialogue-design.md` §1.3, §4.6 FR-E-1 ~ FR-E-11, FR-5-8, FR-5-15, FR-5-18, FR-7-7, FR-8-9 ~ FR-8-14, EX-D-1 ~ EX-D-9, EX-S-1 ~ EX-S-7, AC-E-1 ~ AC-E-12
- **영향 범위**: `packages/dialogue-engine/*`, `packages/shared-types/src/dialogue-engine.ts`, `apps/api/src/homonyms/*`, `apps/api/src/dialog-nodes/*`

## 맥락

현재 `packages/dialogue-engine/src/matcher.ts`는 `matchIntent`/`matchFaq`/`simulate` 3함수뿐이고 **`DialogNode`를 전혀 참조하지 않는다.** 즉 No.5 대화그래프 빌더가 만드는 노드는 **어디서도 실행되지 않는 죽은 데이터**다(요구사항 §1.3). 이 그룹은 CRUD 화면만으로는 "동작하는 기능"이 되지 못한다.

동시에 기존 `simulate`에는 단위 테스트가 붙어 있고(`matcher.spec.ts`), 그 테스트는 **"FAQ를 의도보다 먼저 매칭한다"** 를 명시적으로 보장한다. 새 파이프라인은 **노드를 FAQ보다 먼저** 보게 되므로(FR-E-3 ③ > ④), 두 규칙이 충돌하는 것처럼 보인다.

또한 아웃풋 12종 중 `SCENARIO`/`SURVEY`/`API_CONDITION` 3종은 이번 Phase에서 **저장·검증만 하고 실행하지 않는다**(No.26/27 몫). 실행기가 이를 만났을 때의 동작을 정의해야 한다.

## 결정

### 1. 진입점

```ts
export function resolveResponse(
  input: string,
  session: ContextSessionState | null,
  bundle: DialogueBundle,
  now: Date,
  options?: ResolveOptions,   // { index?, hopLimit?, maxInputLength?, defaultFallbackText? }
): DialogueResolution;
```

- FR-E-2가 명시한 4-인자 형태를 유지하고 확장은 선택적 5번째 인자로 흡수한다.
- **`now`를 반드시 주입**한다. 내부에서 `new Date()`를 부르면 세션 만료(AC-8-6)를 결정론적으로 테스트할 수 없다(FR-8-9).
- **DB·NestJS 무의존 순수 함수**다. 예외를 던지지 않는다(FR-E-9).

### 2. 해석 우선순위 6단계 (FR-E-3)

`S0 전처리` → `S1 세션` → `S2 동음이의어` → `S3 노드` → `S4 FAQ` → `S5 의도 단독` → `S6 폴백(FALLBACK 노드 → ERROR_RESPONSE FAQ → 기본 문구)`

요구사항에 **두 가지를 보강**했다.

- **(보강 1) `COMPLETED` 세션만 파이프라인을 계속 탄다.** `IN_PROGRESS`/`CANCELLED`/`EXPIRED`는 요구사항대로 S1에서 종료한다. 그러나 폼이 완료된 턴은 완료 문구를 출력한 뒤 **같은 턴에서** S3로 내려가, "해당 컨텍스트를 조건으로 가진 노드"의 아웃풋을 이어 붙인다. 이렇게 해야 FR-8-13("`completionMessage` 출력 뒤 노드에 지정된 후속 아웃풋으로 넘긴다")이 성립한다. AC-E-7(진행 중 세션 우선)은 그대로 통과한다.
- **(보강 2) 노드 정렬의 최종 타이브레이크로 `id asc`를 추가한다.** FR-5-8의 4개 키(`priority` → 조건 수 → `ALL` → `updatedAt`)가 전부 동률인 노드 쌍은 실제로 생긴다(노드 복사 기능 FR-5-9). 그때 배열 순서에 의존하면 DB 반환 순서에 따라 응답이 바뀌어 EX-D-2("비결정적 동작 금지")를 어긴다.

### 3. 노드의 컨텍스트 인풋 조건 의미 고정

`node.contextVariableId` 조건은 **"직전 턴에 그 컨텍스트 폼이 `COMPLETED`되었을 때"** 충족으로 정의한다. `matchMode='ANY'`는 지정된 조건 종류 중 하나 이상, `'ALL'`은 지정된 종류 전부를 요구하며, **지정되지 않은 종류는 판정에서 제외**한다. 같은 종류 내부는 항상 OR다.

### 4. 실행 미지원 아웃풋

`UNSUPPORTED_OUTPUT_TYPES = ['SCENARIO','SURVEY','API_CONDITION']` 상수를 `shared-types`에 두고 **엔진·API·UI 배지가 공유**한다. 엔진은 이 타입을 만나면 **출력에서 제외하고 `unsupportedOutputs[]`에 기록**하며 예외를 던지지 않는다(FR-E-7). 결과 아웃풋이 0건이 되면 안내 문구로 폴백한다(EX-D-6). No.26/27 구현 시 **이 상수에서 값을 빼는 것만으로** 실행이 열린다. **[정정 2026-09-24 No.26 — 성립하지 않았다: 실행 가능 판정은 타입이 아니라 형태로 한다. 문서 끝 갱신 참고]**

### 5. `simulate` 하위호환

```ts
/** @deprecated No.10 Phase에서 resolveResponse로 대체 예정 */
export function simulate(input, intents, faqs, now: Date = new Date()): SimulateResult {
  const bundle = { intents, faqs, keywords: [], homonyms: [], dialogNodes: [], contexts: [] };
  return toSimulateResult(resolveResponse(input, null, bundle, now));
}
```

- `dialogNodes`가 **빈 배열**이므로 S3가 항상 건너뛰어지고 `S4(FAQ) → S5(의도)` 순서가 그대로 재현된다. **기존 테스트는 수정 없이 통과한다.**
- `SimulateResultSchema`는 변경하지 않는다. `toSimulateResult()`가 첫 `TEXT` 아웃풋을 `response`로 평탄화한다.
- 의도 단독 매칭 문구는 `INTENT_ONLY_RESPONSE(intentId, example)` 상수 함수로 추출해 **기존 문자열을 글자 그대로** 생성한다.
- `matchIntent`는 선택 3번째 인자 `{ boostIntentIds }`를, `matchFaq`는 내부 `enabled ?? true` / `altQuestions ?? []` 기본값을 갖는다. **두 함수의 기존 호출 시그니처는 불변**이다.

### 6. 안전장치

| 상황 | 동작 |
|---|---|
| 입력 1,000자 초과 | 앞 1,000자만 사용 + `trace(INPUT_TRUNCATED)` (EX-D-8) |
| 입력이 공백/제어문자뿐 | 매칭 시도하지 않고 재입력 안내 아웃풋 (EX-D-7) |
| `DIALOG_MOVE` 순환 | 요청당 hop 10회 초과 시 중단 + `trace(HOP_LIMIT_EXCEEDED)` (FR-5-18, AC-E-8) |
| 끊어진 참조 ID / JSON 파싱 실패 | 무시 + `trace(BROKEN_REFERENCE\|PAYLOAD_INVALID)`. **예외 없음** (FR-E-9, AC-E-9) |
| 아웃풋 0건 | 기본 폴백 문구 보장 — **항상 최소 1건 응답** (AC-E-10) |
| `ERROR_RESPONSE` FAQ 다건 | `createdAt asc` 첫 건 고정 선택(무작위/최신순 금지 — 재현성) |

### 7. 설계 점검·흐름 요약도 엔진에 둔다

`validateDialogueDesign(bundle)`(FR-5-16)과 `buildFlowTree(bundle)`(FR-5-19)를 `apps/api/**/lib`이 아니라 **`packages/dialogue-engine`** 에 배치한다.

### 8. 성능

`buildDialogueIndex(bundle)`로 정규화 결과를 사전 캐시한다(예문→의도 Map, FAQ 질문 Map, 키워드 용어, 정렬 완료 노드 배열). `resolveResponse`는 `options.index` 미지정 시 내부에서 1회 생성한다(FR-E-10).

## 근거

- **"노드 우선"은 데이터 모델이 요구하는 순서다.** 노드는 관리자가 **명시적으로 조합한 조건**(의도+키워드+컨텍스트 + 우선순위)이고, FAQ는 단일 문장 매칭이다. 구체적인 설계가 일반적인 설계보다 먼저 평가되지 않으면 관리자가 노드로 흐름을 통제할 방법이 없다(S-6 시나리오가 성립하지 않는다).
- **기존 `simulate` 동작은 "FAQ 우선"이 아니라 "노드가 없을 때의 특수해"였다.** 새 파이프라인은 이를 **일반화**한 것이고, 노드가 0건인 기존 fixture에서는 동일한 결과를 낸다. 즉 **의도적 동작 변경이 아니라 확장**이며, 그래서 시그니처를 유지한 위임 리팩터링이 가능하다. 다만 "노드가 있으면 달라진다"는 사실 자체는 AC-E-2 테스트로 **명시적으로 고정**한다(조용한 동작 변경 금지).
- **`simulate`를 즉시 제거하지 않는 이유**: 삭제는 테스트 수정 + 호출부 수정을 동반하고, No.10이 시뮬레이터 API를 만들면서 어차피 이 표면을 재설계한다. 지금은 `@deprecated`로 의도만 표시해 두고, **교체 시점을 기능 Phase 경계에 맞춘다**(리팩터링을 기능과 섞지 않는다).
- **예외를 던지지 않는 엔진**: 대화 응답은 가용성이 정확성보다 우선이다. 노드 하나가 손상됐다고 사용자가 500을 받으면 안 된다. 데이터 품질은 저장 시점의 서버 검증(FR-0-16)과 설계 점검(FR-5-16)이 책임지고, 런타임은 `trace` 경고로 관측 가능하게만 만든다.
- **설계 점검을 엔진에 두는 이유**: `MOVE_CYCLE` 검출(설계 시점)과 hop limit(런타임)은 **같은 이동 그래프에 대한 두 가지 방어**다. 서로 다른 패키지에 두면 "점검은 통과하는데 런타임은 끊기는" 불일치가 생긴다. 같은 그래프 구축 함수를 공유해야 규칙이 하나로 유지된다.
- **`trace`를 지금부터 만드는 이유**: No.10 시뮬레이터의 핵심 가치는 "왜 이 응답이 나왔는지"다. 나중에 추가하려면 파이프라인 전 구간에 기록 지점을 다시 심어야 하는데, 그건 사실상 재작성이다. 지금 넣으면 **이번 Phase의 단위 테스트가 곧 trace의 검증 수단**이 된다.

## 대안과 트레이드오프

| 대안 | 기각 사유 |
|---|---|
| `simulate`를 새 시그니처로 **교체**(파괴적) | 기존 테스트가 깨진다. FR-E-4가 명시적으로 하위호환을 요구한다 |
| FAQ를 노드보다 먼저 유지 | 관리자가 노드 우선순위로 흐름을 통제할 수 없다. FR-E-3이 정한 순서와 충돌 |
| 미지원 아웃풋에서 예외 throw | 저장은 허용(AC-5-7)해 놓고 실행에서 터지면 사용자는 원인을 알 수 없다. FR-E-7이 금지 |
| 미지원 아웃풋을 저장 단계에서 차단 | FR-5-14/AC-5-7이 "저장은 된다"를 요구. No.26/27 준비 데이터를 미리 만들 수 없게 된다 |
| 실행기를 `apps/api` 서비스에 직접 구현 | DB·Nest 의존이 섞여 단위 테스트가 불가능해진다(NFR-M1). 위젯/채널이 생길 때 재사용도 못 한다 |
| 세션 상태를 엔진 내부에 보관(stateful) | 다중 대화·수평 확장에서 즉시 깨진다. stateless 계약(FR-8-15, DD-10)이 영속화 방식 결정을 No.10으로 미룰 수 있게 해 준다 |
| hop limit 없이 방문 노드 집합으로 순환 차단 | 조건부 분기로 같은 노드를 **합법적으로 두 번** 지나는 경우를 막아 버린다. 횟수 상한이 더 관대하면서도 종료를 보장한다 |

**감수하는 비용**: ① `matcher.ts`의 단순함이 사라지고 엔진 파일이 12개로 늘어난다 — 대신 각 파일이 순수 함수 단위라 테스트가 쉬워진다. ② `trace`는 이번 Phase에 소비자가 없다(No.10에서 쓰인다) — 단, **단위 테스트가 즉시 소비자**가 되므로 ADR-0004가 기각한 "쓰기 주체 없는 컬럼"과는 성격이 다르다. ③ 노드 우선 규칙 도입으로 기존 대화 시나리오의 응답이 달라질 수 있다 — 아직 운영 중인 챗봇이 없어 영향은 0이다.

## 결과

- `packages/dialogue-engine/src/`: `resolver.ts`, `node-matcher.ts`, `homonym.ts`, `context-session.ts`, `faq.ts`, `outputs.ts`, `dialogue-index.ts`, `design-validator.ts`, `flow-tree.ts`, `normalize.ts`, `constants.ts` 신설 + `matcher.ts` 위임 리팩터링.
- `shared-types/src/dialogue-engine.ts`: `DialogueBundle`/`DialogueResolution`/`TraceStep`/`ContextSessionState`/`DesignValidationReport`/`FlowTree` 계약.
- `apps/api`: `POST /homonyms/test`는 `resolveHomonym()`만, `POST /dialog-nodes/validate`는 `validateDialogueDesign()`만, `GET /dialog-nodes/flow`는 `buildFlowTree()`만 호출한다(엔진 진입점을 얇게 유지).
- `test-automation` 인계: FR-E-3의 6단계 각각 + §8 예외 케이스 + AC-E-1~E-12를 엔진 단위 테스트로 커버(FR-E-11). 성능 테스트(AC-E-12)는 인덱스를 재사용하는 형태로 측정한다.
- 후속(No.10): 대화 API·시뮬레이터 UI가 `resolveResponse`를 소비하고 `trace`를 화면에 표시한다. 그 시점에 `simulate`를 제거한다.


---

## 갱신 (2026-09-24 — No.26: "상수에서 빼면 열린다"는 성립하지 않았다 · 실행 가능 판정 = 형태 · 엔진 수정 닫힌 목록)

레거시 API 연동(No.26, **ADR-0034**)이 `API_CONDITION`의 실행을 연다. §4의 예고("이 상수에서 값을 빼는 것만으로 실행이 열린다")는 **성립하지 않았다** — ① 엔진이 동기 순수 함수라 호출할 자리가 없고 ② No.5 저장 형태(인라인 URL·평문 헤더)는 실행하면 안 되는 형태이며 ③ 웹 배지가 이 상수를 쓰지 않고 타입을 하드코딩했다(`DialogOutputEditor.tsx:126`). 다음과 같이 갱신한다. §1~§3·§5~§8의 결정(진입점·우선순위·예외 없음·설계 점검의 엔진 배치)은 불변이다.

1. **실행 가능 판정은 타입이 아니라 형태로 한다.** `UNSUPPORTED_OUTPUT_TYPES = ['SCENARIO','SURVEY']`로 줄이고, `API_CONDITION`은 `version: 2`(연결 참조형)만 실행한다. v1은 이 ADR의 미지원 처리(출력 제외 + `unsupportedOutputs` 기록 + 0건이면 안내 문구)를 **바이트 단위 그대로** 받는다. 판정 함수 `isUnsupportedOutput()`을 `shared-types`에 두고 엔진·설계 점검·웹 배지가 공유한다(§4의 "공유" 의도를 함수로 실현).
2. **§1 "DB·NestJS 무의존 순수 함수"는 유지된다** — 외부 호출은 엔진 밖에서 한다. 엔진은 v2 `API_CONDITION`에서 **정지**(호출 요청서 반환, 뒤 아웃풋 미실행)하고, API 계층이 1회 호출한 뒤 순수 함수 `resumeAfterApiCall()`로 재진입한다. 정지 시 `resolveTurn`은 "호출 실패" 가정의 폴백 결과를 동봉해 §6의 "항상 최소 1건 응답"을 지킨다.
3. **엔진 수정은 닫힌 목록**이다: `executeOutputs` 분기 · 재진입 함수 · 참조 편입(`getOutgoingNodeRefs().apiTargets`) · 결과 타입 선택 필드 `apiCall?` · 폼 완료 값 전달. 엔진에 I/O·타이머·`fetch`·`process.env`·Nest·Prisma 심볼 0건을 정적 검사가 단언한다.
4. **§6 안전장치 보강**: 턴당 외부 호출 1회(두 번째는 실패 처리) · 분기 이동은 hop 1로 이어 센다(`HOP_LIMIT` 10 공유) · 끊긴 분기 참조는 `BROKEN_REFERENCE` + 고정 문구.
5. **§7 설계 점검**: v1은 `UNSUPPORTED_OUTPUT`(INFO) 대신 `API_LEGACY_FORMAT`(WARNING, "전환 필요")으로 보고하고 API 전용 점검 항목이 추가된다. 연결 의존 항목을 위해 `validateDialogueDesign`이 **선택 3번째 인자**(연결 설계 정보)를 받는다 — 엔진이 DB를 읽지 않는 원칙 유지.
6. 대안 표의 "미지원 아웃풋을 저장 단계에서 차단" 기각 사유(No.26 준비 데이터)는 v1에 대해 **반대로 적용**된다 — v1은 새로 저장할 수 없다(`400 API_OUTPUT_LEGACY_FORMAT`). 이미 저장된 v1은 자동 변환·삭제하지 않는다(ADR-0034 §7).


---

## 갱신 (2026-09-24 — No.27: `SURVEY`도 형태로 판정 · 설계 점검의 상수 직접 사용 결함 · 정지점 없는 두 번째 엔진 확장)

설문관리(No.27, **ADR-0035**)가 `SURVEY`의 실행을 연다. §1~§3·§5~§8의 결정은 불변이다.

1. **`UNSUPPORTED_OUTPUT_TYPES = ['SCENARIO']`**. `SURVEY`는 v2(`version: 2`, 같은 챗봇 설문 참조)만 실행하고 v1(자유 문자열 키)은 이 ADR의 미지원 처리를 **바이트 단위 그대로** 받는다 — `isUnsupportedOutput()`에 v1 `SURVEY` 분기를 더한다.
2. **결함 기록 — 설계 점검이 공용 판정 함수가 아니라 상수를 직접 봤다**(`design-validator.ts` ⑧). No.26 갱신 1이 "판정 함수를 엔진·설계 점검·웹 배지가 공유"라고 했으나 설계 점검은 상수를 계속 썼고, 상수에서 `SURVEY`를 빼는 순간 v1 `SURVEY`의 INFO가 **조용히 사라진다**. 공용 함수 기반으로 교체하되 v1 `API_CONDITION`은 전용 코드(`API_LEGACY_FORMAT`)로 보고하므로 INFO에서 계속 제외한다(단순 교체 시 No.26 회귀).
3. **엔진 확장은 정지점 없이** 한다 — 설문의 다음 출력은 입력과 설문 정의만으로 결정되므로 §1의 순수·동기 계약 안에서 끝난다. 파이프라인 맨 앞에 **S0 설문 세션**(S1 컨텍스트 세션과 상호 배타)이 추가되고, 설문이 시작되면 `CONTEXT_FORM`과 같은 **종결자**(뒤 아웃풋 미실행)이며 참여할 수 없으면 건너뛰고 다음 아웃풋을 계속한다. 노드 출력이 결국 0건이면 §6의 기본 폴백 대신 **설문 고정 문구**(미지원 아웃풋 안내가 있으면 그것이 우선)로 "항상 최소 1건 응답"을 지킨다.
4. **§6 안전장치 보강**: 설문 재시도 상한 2회 · 완료 후 이동은 hop 1로 이어 센다(`HOP_LIMIT` 10 공유) · 완료 후 이동 대상이 끊겼으면 `BROKEN_REFERENCE` + 완료 문구로 종료.
5. 엔진 수정은 ADR-0035 §3의 **닫힌 목록 9항목**이며 엔진 I/O 0건 정적 검사가 계속 단언한다.


---

## 갱신 (2026-09-25 — No.22: 번들은 비활성 토픽 진입점이 빠진 채 들어온다 · 번들 순서는 결정적이다(K-1))

토픽 시스템(No.22, **ADR-0037 §2**). §1~§8의 결정은 불변이며 **엔진 수정 0**이다.

1. **파이프라인 입력**: `getCached()` 경로(공개 대화·시뮬레이터·비교·TC·힌트·답변 설정 미리보기)의 번들에서는 **비활성 토픽에 속한 노드·의도·FAQ가 이미 빠져 있다.** 엔진은 이를 모른다 — 빠진 노드로 가는 이동은 §6의 `BROKEN_REFERENCE` trace + 그 아웃풋만 건너뜀, 빠진 의도는 조건 불일치로 처리된다(기존 동작). 키워드·컨텍스트·동음이의어는 빠지지 않는다. 설계 점검·흐름은 필터 없는 번들로 호출된다.
2. **K-1 — 번들 순서의 결정성**: 번들 조립의 7개 조회에 `orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]`를 둔다(별도 선행 커밋). 지금까지 순서는 DB가 고른 인덱스 순서였고, 의도·FAQ 매칭은 **동점이면 먼저 본 항목**이 이기므로 동점 승자가 DB 행 순서(편집·복원으로 바뀔 수 있다)에 달려 있었다. 이제 동점 승자는 **먼저 생성된 자산**이며 복원(`createdAt` 보존)·분리(타임스탬프·ID 순서 보존) 후에도 같다. 노드 순위(`rankNodes` — `id asc` 최종)·의미 순위·스냅샷 해시(`byIdAsc`)는 영향이 없다. 적용 전후 TC 비교로 차이가 동점 케이스뿐임을 확인한다.


---

## 갱신 (2026-09-25 — No.40: 운영 버전 서빙은 입력을 라이브와 같게 만든다 · 엔진 수정 0)

환경 분리/버전관리(No.40, **ADR-0039 §3**). §1~§8의 결정은 불변이며 **엔진 수정 0**이다.

1. 운영·스테이징 버전 번들은 스냅샷 역직렬화로 만든다. **노드 `updatedAt`**은 스냅샷의 해시 밖 보조 필드로 되살리고(없는 과거 스냅샷은 캡처 시각 — 동점은 `id asc`), **6종 배열 순서**는 K-1과 같은 `(createdAt asc, id asc)`로 재정렬한다 — 스냅샷 본문 저장 순서(`id asc`)와 달라 의도·FAQ 동점 승자가 바뀌는 것을 막는다.
2. 따라서 `rankNodes`(§4 동점 규칙)·`matchIntent`·`matchFaqEntry`의 "먼저 본 항목" 규칙은 그대로이고, 같은 버전을 대상으로 한 공개 대화·시뮬레이터·TC의 결과가 같으며 캡처 시점 초안과도 같다.


---

## 갱신 (2026-09-26 — No.41: 세 번째 의도된 엔진 확장 — 비종결 이벤트 방출 `WORKFLOW`)

업무 자동화(No.41, **ADR-0041 §2**). §1~§8의 결정(진입점·우선순위·예외 없음·설계 점검의 엔진 배치)은 불변이다.

1. **아웃풋 13종째 `WORKFLOW`는 실행 지원 타입**이다(`UNSUPPORTED_OUTPUT_TYPES` 불변). 엔진은 이 아웃풋을 **출력에 넣지 않고, 정지하지도 종결하지도 않는다** — 바인딩(No.26 `resolveBinding` 1벌)을 해석한 `WorkflowEmission`을 결과 선택 필드 `workflowEvents?`에 싣고 뒤 아웃풋을 계속 실행한다. 없으면 키 부재(결과 모양 불변).
2. **§6 "항상 최소 1건 응답"은 그대로다** — 노드 아웃풋이 `WORKFLOW`뿐이면 기존 0건 보장(기본 폴백 문구 + `EMPTY_OUTPUT`)이 적용된다. 엔진은 바꾸지 않고 §7 설계 점검 `WORKFLOW_ONLY_OUTPUT`(WARNING)으로 알린다.
3. **§7 설계 점검**: 규칙 5종(`WORKFLOW_SLOT_BINDING_UNREACHABLE`·`WORKFLOW_TARGET_UNAVAILABLE`·`WORKFLOW_ONLY_OUTPUT`·`WORKFLOW_NO_FIELDS`·`WORKFLOW_RAW_PERSONAL_DATA`) + 없는 대상 `BROKEN_REFERENCE`. 대상 정보는 `validateDialogueDesign`의 선택 3번째 인자에 `workflowTargets`로 더한다(엔진이 DB를 읽지 않는 원칙 유지).
4. 엔진 수정은 ADR-0041 §2의 **닫힌 목록 E-1~E-8**이며 엔진 I/O 0건 정적 검사(L-5)가 계속 단언한다. `WORKFLOW`가 없는 번들의 모든 소비자 결과(API 정지 시 `apiCall` 포함)는 바이트 단위로 불변이다.
