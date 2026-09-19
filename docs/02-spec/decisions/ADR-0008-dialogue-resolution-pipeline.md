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

`UNSUPPORTED_OUTPUT_TYPES = ['SCENARIO','SURVEY','API_CONDITION']` 상수를 `shared-types`에 두고 **엔진·API·UI 배지가 공유**한다. 엔진은 이 타입을 만나면 **출력에서 제외하고 `unsupportedOutputs[]`에 기록**하며 예외를 던지지 않는다(FR-E-7). 결과 아웃풋이 0건이 되면 안내 문구로 폴백한다(EX-D-6). No.26/27 구현 시 **이 상수에서 값을 빼는 것만으로** 실행이 열린다.

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
