# ADR-0010 — 엔진 진입점 3층화(`resolveTurn`/`resolveByNodeId`)와 `pendingClarify` 기반 되묻기 종결

- **상태**: 채택 (Accepted)
- **일자**: 2026-09-20
- **결정자**: system-architect
- **관련**: `docs/requirements/quality-channel.md` §4.4 FR-E2-1 ~ FR-E2-6, FR-0-19, FR-11-25, FR-W-6, S-9, AC-E2-1 ~ AC-E2-6, AC-P-13, AC-P-15
- **영향 범위**: `packages/dialogue-engine/src/{resolver.ts, homonym.ts, turn.ts, conversation-state.ts, dialogue-index.ts, index.ts}`, `packages/shared-types/src/dialogue-engine.ts`, `apps/api/src/{simulation, conversation}`
- **관계**: `ADR-0008`(해석 파이프라인)을 **확장**한다. 우선순위 6단계와 `simulate` 하위호환 전략은 그대로 유지된다. 상태 봉투는 `ADR-0009`.

## 맥락

`resolveResponse()`는 **텍스트 입력 1건**을 전제로 설계됐다. 이번 Phase에 실제 대화 클라이언트(위젯)가 붙으면서 두 개의 실행 공백이 드러났다. 둘 다 "데이터는 저장되는데 실행 경로가 없는" 형태로, ADR-0008이 해결한 것(노드가 죽은 데이터였던 문제)과 같은 종류의 공백이다.

### 공백 ① — `action:'NODE'` 버튼을 누를 수 있는 진입점이 없다

`ButtonItemSchema`는 `action:'NODE'` + `value: nodeId(uuid)`를 허용하고(`shared-types/src/dialogue.ts:434`), 관리자 화면(`ButtonItemEditor.tsx`)은 이를 편집할 수 있으며, 설계 점검(`NODE_IN_USE`)·흐름 요약(`via:'BUTTON_NODE'`)도 이를 인식한다. 그런데 **엔진 진입점은 `resolveResponse(input, …)` 하나뿐**이라, 노드 ID로 대화를 이어갈 방법이 없다. 버튼은 만들 수 있고 검증도 되는데 **누를 수가 없다.**

### 공백 ② — 동음이의어 되묻기가 종결되지 않는다 (S-9 미성립)

`buildClarifyOutput()`은 의미 label을 `action:'MESSAGE', value:label` 버튼으로 만든다(`homonym.ts:101-105`). 예: `배` → `[과일] [선박]`.

사용자가 `선박`을 누르면 다음 턴 입력은 `"선박"`이다. 그런데 `resolveHomonym()`은 **입력에 원래 단어(`배`)가 포함될 때만** 사전을 검사한다(`homonym.ts:27`, `containsWord(normalizedInput, wordNorm)`). `"선박"`에는 `배`라는 토큰이 단어 단위로 존재하지 않으므로 사전 전체를 건너뛰고, 의미 확정(`intentId`)이 사라진 채 일반 매칭으로 내려가 **대개 폴백으로 끝난다.**

즉 **되묻기 기능은 질문만 하고 대답을 받지 못한다.** FR-7-8이 정의한 기능이 종단에서 동작하지 않으며, 이는 위젯이 붙는 이번 Phase에 최종 사용자가 직접 겪는 버그다.

추가로, 단순히 "`pendingClarify`를 넣고 `boostIntentIds`에 태운다"로는 **고쳐지지 않는다**. `matchIntent`의 부스트는 **예문이 일단 매칭된 뒤에만** 점수를 더하는데(`matcher.ts:38-46`), `"선박"`이라는 짧은 입력은 `선박_문의` 의도의 예문(`"배 언제 와요"` 등)에 부분일치조차 하지 않아 `matchIntent`가 `null`을 반환한다. 부스트는 아무 효과가 없다.

## 결정

### 1. 진입점을 3층으로 나눈다 (DD-26)

```ts
// ① 텍스트 해석 — 시그니처 불변(ADR-0008)
resolveResponse(input: string, session, bundle, now, options?): DialogueResolution

// ② 노드 직접 실행 — 신규
resolveByNodeId(nodeId: string, session, bundle, now, options?): DialogueResolution

// ③ 턴 오케스트레이터 — 신규. API 3개 소비자는 이것만 호출한다
resolveTurn(turn: { message?, buttonAction? }, state: unknown, bundle, now, options?): DialogueTurnResult
```

- `resolveTurn`이 **버튼 라우팅 + 봉투 sanitize + `nextState` 조립**을 전담한다.
- **API 계층에 버튼 분기(`if (kind === 'NODE')`)를 두지 않는다.** 두면 시뮬레이션·비교·공개 대화 3곳에 같은 분기가 복제되고, FR-0-19("엔진 2벌 금지")가 매칭 로직에만 적용되고 라우팅 로직에는 적용되지 않는 반쪽 규약이 된다.
- `DialogueIndex`에 `nodesById: Map<string, DialogNode>`를 추가해 `resolveByNodeId`가 O(1)로 조회한다.

### 2. `resolveByNodeId`의 실패는 예외가 아니라 폴백이다

| 상황 | 동작 |
|---|---|
| 노드 존재 + `enabled` | `trace(NODE_BY_ID)` → `executeOutputs(node.outputs, …)` |
| 없음 / `enabled=false` / uuid 아님 | `trace(NODE_BY_ID_NOT_FOUND)` → **공통 폴백 경로**(FALLBACK 노드 → `ERROR_RESPONSE` FAQ → 기본 문구) |
| 진행 중 세션이 있을 때 | **버튼이 이긴다.** 세션을 `CANCELLED`로 종료하고 `existingSession`을 `executeOutputs`에 넘겨 `CONTEXT_FORM` 전환 고지(EX-S-7)를 재사용 |

`resolver.ts`의 S6 폴백 블록을 `resolveFallback()` 내부 함수로 **추출**해 두 진입점이 공유한다(동작 변경 없는 추출 — 기존 폴백 테스트가 회귀 감시자다).

> "버튼이 세션을 이긴다"의 근거: 슬롯 질문에 딸린 선택지 버튼은 `promptOutputsForSlot()`이 만드는 **`action:'MESSAGE'`** 버튼이다(`context-session.ts:116`). 세션 진행 중에 `action:'NODE'` 버튼이 눌렸다는 것은 사용자가 **봇이 제시한 다른 경로로 명시적으로 이탈하겠다**는 뜻이며, 텍스트 입력과 달리 해석의 모호성이 없다.

### 3. 되묻기는 상태 봉투의 `pendingClarify`와 파이프라인 S1.5로 종결한다 (DD-27)

```ts
PendingClarify = { homonymId: uuid, word: string, askedAt: Date }
```

**부여**: S2에서 `AMBIGUOUS` + policy `ASK`로 되묻기 아웃풋을 반환할 때 함께 내려보낸다.

**소비(신규 S1.5 단계, S1 세션 뒤 · S2 동음이의어 앞)**:

1. TTL(10분) 초과 → `trace(CLARIFY_DISCARDED)`, 폐기 후 S2 정상 진행
2. `homonymId`가 번들에 없음(사전 삭제) → 동일
3. 의미 매칭을 **3단 사다리**로 시도한다
   - ① 의미 label 정규화 **정확 일치** ← 버튼 클릭 경로
   - ② 의미 label **단어 단위 포함** ← `"선박이요"`
   - ③ 의미 `contextHints` 단어 단위 포함 ← `"타는 배요"`
4. 일치 → `trace(CLARIFY_RESOLVED)` + 의미 확정 후 **S2를 건너뛰고 S3으로**(재되묻기 무한루프 차단)
5. 불일치 → `trace(CLARIFY_DISCARDED)` + 폐기 후 **일반 해석**(AC-E2-5)

**S1 보강 1건**: `session.status === 'IN_PROGRESS'`이면서 `pendingClarify`가 함께 있으면 **세션이 우선**하고 되묻기는 폐기한다(슬롯 질문이 더 최근의 질문이다).

### 4. 되묻기 해소 시 의도는 "부스트"가 아니라 "확정"이다

```ts
const intentMatch = matchIntent(raw, bundle.intents, { boostIntentIds, index });
ctx.matchedIntentId = intentMatch?.intentId ?? clarified?.intentId;   // ← 확정 의도 폴백
```

- 부스트는 유지한다(입력이 `"선박 요금 얼마예요"`처럼 풍부하면 예문 매칭이 성공하고, 그때 확정 의도가 최우선 후보가 된다).
- **S5(의도 단독) 진입 조건 완화**: 현재 `if (ctx.matchedIntentId && intentMatch)`인데, `ctx.matchedIntentId`는 지금까지 오직 `intentMatch?.intentId`에서만 왔으므로 두 조건은 **기존 입력에 대해 논리적으로 동치**다. `if (ctx.matchedIntentId)`로 바꾸고 예문은 `intentMatch?.matchedExample ?? 의도의 첫 예문 ?? ''`를 쓴다. 기존 동작은 바뀌지 않으며, 확정 의도에 매칭 노드가 없어도 폴백 대신 의도 단독 응답이 나간다.

### 5. 하위호환은 "기존 테스트 수정 0건"으로 판정한다 (FR-E2-3, AC-E2-6)

- `resolveResponse` 시그니처 불변. 새 입력은 전부 `ResolveOptions`의 **선택 필드**.
- `DialogueResolution`에 선택 필드 `pendingClarify` 1개만 추가. 기존 필드 불변.
- `ContextSessionState` 불변(봉투가 감쌀 뿐 대체하지 않는다).
- `TraceCodeEnum`에 값 5개 추가(제거·변경 없음).
- **`simulate()`는 이번에도 제거하지 않는다.** ADR-0008 §결과는 "No.10에서 제거"를 예고했으나, 제거는 테스트 수정을 동반한다. **기능 변경과 리팩터링을 같은 변경 집합에 섞지 않는다**는 원칙(ADR-0008 §근거)을 우선해 No.12 이후 독립 작업으로 이관한다.

## 근거

- **공백 두 건 모두 "저장은 되는데 실행되지 않는" 데이터다.** ADR-0008이 `DialogNode`에 대해 내린 것과 같은 판단이며, 같은 해법(엔진에 진입점을 만든다)을 적용하는 것이 규약 일관성이다.
- **`resolveTurn`을 두는 것이 FR-0-19의 실질이다.** "엔진 2벌 금지"가 매칭에만 적용되면, 버튼 라우팅·상태 조립·봉투 검증이 API 3곳에 복제된다. 복제된 코드는 반드시 갈라진다(AC-P-15의 "시뮬레이션과 공개 API의 응답이 동일하다"가 깨지는 첫 번째 지점이 바로 여기다).
- **`state: unknown` 시그니처**가 봉투 검증 누락을 타입으로 막는다(ADR-0009 §2).
- **3단 사다리를 쓰는 이유**: ①만 있으면 버튼 클릭은 고쳐지지만 `"선박이요"`라고 타이핑한 사용자는 여전히 폴백을 받는다. 되묻기는 **대화**이지 폼 입력이 아니다. ③(문맥 힌트)까지 쓰면 관리자가 이미 등록한 사전 자산을 추가 입력 없이 재활용할 수 있다.
- **S1.5를 S2 앞에 두는 이유**: S2(`resolveHomonym`)는 "입력에 사전 단어가 있는가"를 묻는다. 되묻기 응답에는 사전 단어가 **없는 것이 정상**이므로, S2에 맡기면 영원히 처리되지 않는다. 별도 단계가 필요하다.
- **확정 매칭 후 S2를 건너뛰는 이유**: 건너뛰지 않으면 되묻기 응답이 다시 `AMBIGUOUS`로 판정돼 **같은 질문을 무한 반복**할 수 있다.

## 대안과 트레이드오프

| 대안 | 기각 사유 |
|---|---|
| `resolveResponse`의 2번째 인자를 `ContextSessionState \| ConversationState` 유니온으로 변경 | 런타임 판별 분기가 생기고 기존 호출부의 타입이 흔들린다. FR-E2-3이 시그니처 유지를 요구 |
| 버튼 분기를 API 서비스에 둔다 | 3개 소비자에 복제된다. AC-P-15가 깨지는 첫 지점 |
| `buildClarifyOutput`의 버튼을 `action:'MESSAGE', value:"배(선박)"`처럼 **원래 단어를 포함**하도록 바꾼다 | 가장 적은 코드로 S-9를 통과시킬 수 있지만, ① 버튼 레이블이 부자연스러워지고 ② **사용자가 타이핑한 `"선박"`은 여전히 실패**하며 ③ 동음이의어가 다의어일 때(`"배(과일)"` vs `"배(선박)"`) 레이블 규칙을 관리자에게 강요한다. 표면 증상만 가리는 수정이다 |
| 되묻기 상태를 서버 메모리 Map에 보관 | 다중 인스턴스에서 즉시 깨진다. ADR-0009와 정면 충돌 |
| `pendingClarify`에 TTL을 두지 않는다 | 사용자가 하루 뒤 아무 말이나 하면 그 단어가 되묻기 응답으로 오해석된다. 10분은 "직전 질문에 대한 답"의 현실적 상한이다 |
| 되묻기 미해소 시 다시 되묻는다 | 사용자가 다른 주제로 넘어갔는데 계속 같은 질문을 받는다. FR-E2-2가 "불일치하면 일반 해석"을 명시 |
| `resolveByNodeId`가 없는 노드에 예외를 던진다 | FR-E-9("엔진은 예외를 던지지 않는다")와 정면 충돌. 노드가 삭제된 뒤에도 사용자 화면에는 옛 버튼이 남아 있을 수 있으므로 **정상적으로 발생하는 상황**이다 |
| 세션 진행 중 NODE 버튼을 무시하고 슬롯 값으로 처리 | 사용자가 명시적으로 누른 버튼을 무시하는 것은 "내가 누른 게 왜 안 되지?"를 만든다. CHOICE 선택지는 이미 `MESSAGE` 버튼이므로 충돌하지 않는다 |

**감수하는 비용**
① 엔진 공개 API가 3개로 늘어 학습 비용이 커진다 — 문서(`quality-channel-설계.md` §7.1 다이어그램)와 "API 소비자는 `resolveTurn`만 쓴다"는 단일 규칙으로 완화한다.
② S1.5 신설로 파이프라인 단계가 6→7이 된다 — ADR-0008의 6단계 골격은 그대로이고, S1.5는 "S2 입력 전처리" 성격이라 개념적 복잡도 증가는 제한적이다.
③ S5 진입 조건 완화가 "논리적으로 동치"라는 주장은 코드 독해에 근거한다 — **AC-E2-6(기존 230개 테스트 전수 통과)** 이 이 주장의 검증 수단이며, 통과하지 못하면 결정을 재검토한다.

## 결과

- `packages/dialogue-engine/src/`: `turn.ts`, `conversation-state.ts`, `overlay.ts` 신설 / `resolver.ts`(S1.5 + `resolveFallback` 추출 + `resolveByNodeId`), `homonym.ts`(의미 매칭 사다리 헬퍼), `dialogue-index.ts`(`nodesById`) 수정.
- `shared-types/src/dialogue-engine.ts`: `PendingClarifySchema`, `ConversationStateSchema`, `ButtonActionSchema`, `StateDiscardReason` 추가 + `TraceCodeEnum` 5종 추가 + `DialogueResolutionSchema`에 선택 필드 1개 추가.
- `apps/api`: 시뮬레이션·비교·공개 대화 3개 서비스가 **`resolveTurn`만** 호출한다. `resolveResponse`/`resolveByNodeId`를 직접 부르지 않는다(code-reviewer 점검 항목).
- `apps/widget`: `action:'NODE'` 버튼을 `buttonAction:{kind:'NODE',nodeId,label}`로 전송하고, `MESSAGE`는 텍스트로, `LINK`는 서버 호출 없이 새 탭으로 연다(FR-W-6).
- `test-automation` 인계 — 최우선 5건: **AC-E2-4**(되묻기 종결, 현행 구현에서 깨져 있던 경로) · AC-E2-6(기존 230개 통과) · AC-E2-1/2(NODE 진입점) · AC-P-13 · AC-P-15(엔진 단일 경로 동일성).
- seed에 `배` 동음이의어(의미 2종 + 연결 의도 + 대응 노드)와 `NODE` 버튼 노드를 추가해 두 경로가 **수동으로도 즉시 재현**되게 한다.
</content>
