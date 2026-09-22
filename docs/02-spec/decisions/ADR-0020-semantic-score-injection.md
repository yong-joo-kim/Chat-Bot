# ADR-0020 — 의미 유사도의 엔진 주입 방식(`ResolveOptions.semantic`)과 부분일치 제거

- **상태**: 채택 (Accepted)
- **일자**: 2026-09-22
- **결정자**: system-architect
- **관련**: `docs/requirements/nlu-rag-answering.md` **J-2**, **J-3**, FR-0-39/40, FR-N1-8~15, NFR-M2/M4, AC-N1-1~8, AC-N4-4/N4-5 / **ADR-0008**(엔진 순수성·해석 우선순위) / ADR-0010(진입점 3층화)
- **영향 범위**: `packages/dialogue-engine/src/{resolver.ts, matcher.ts, faq.ts, semantic.ts(신설), turn.ts}`, `packages/shared-types/src/dialogue-engine.ts`, `apps/api/src/embedding/semantic-match.service.ts`(신규), `apps/api/src/conversation/public-conversation.service.ts`, `apps/api/src/simulation/simulation.service.ts`
- **세부 설계**: `docs/02-spec/nlu-rag-answering-설계.md` §8.6~§8.8

## 맥락

현행 매칭은 `matcher.ts` 38~44행·`faq.ts` 22~27행의 두 규칙뿐이다.

```ts
if (normalizedInput === norm)                                   score = norm.length + 1000;   // 정확일치
else if (normalizedInput.includes(norm) || norm.includes(normalizedInput))
                                                                score = Math.min(두 길이);     // 부분 문자열 포함
```

여기서 두 가지 문제가 동시에 발생한다.

1. **표현이 다르면 못 찾는다.** `"배송 언제 오나요"` 예문이 있어도 `"물건 며칠 걸려요"` 는 매칭되지 않는다.
2. **부분 문자열 포함이 오탐을 만든다.** 예문 `"취소"` 가 `"취소하면 위약금 있나요"` 를 잡아 엉뚱한 의도로 확정한다. 점수가 `Math.min(길이)` 라 **짧은 쪽이 이길 수도 있다.**

해결책은 문장 임베딩 기반 의미 유사도다. 그런데 **임베딩 조회는 비동기 I/O**이고, ADR-0008은 엔진을 "DB·NestJS 무의존 순수 동기 함수"로 못 박았다. 이 충돌을 어떻게 푸는가가 이 ADR의 주제다.

## 검토한 대안

| 안 | 내용 | 기각 사유 |
|---|---|---|
| **A. 엔진 안에서 await** | `resolveResponse`가 `EmbeddingProvider`를 받아 내부에서 호출 | **진입점 3종이 전부 async가 된다.** 호출부 3종(시뮬레이션·비교·공개대화)과 엔진 단위 테스트 전체가 깨진다. 무엇보다 엔진에 네트워크가 들어가 ADR-0008 규약이 무너지고, "손상된 데이터에 예외를 던지지 않는다"는 가용성 규약을 **타임아웃·재시도까지 포함하도록** 확장해야 한다 — 엔진이 인프라 관심사를 떠안는다 |
| **B. 엔진에 콜백 주입**(`getScore: (text) => number`) | 동기 콜백으로 감춘다 | 동기 시그니처를 유지하려면 호출 전에 결국 모든 후보 점수를 미리 계산해 둬야 한다. 즉 **C와 같은 일을 하면서 인터페이스만 불투명해진다.** 결정론 검증(같은 입력 → 같은 결과)도 콜백 뒤로 숨는다 |
| **C. 사전 계산한 점수 맵 주입**(채택) | `apps/api`가 질의 임베딩 1회 + 코사인 계산 후 `ResolveOptions.semantic`으로 주입 | — |
| **D. 엔진을 버리고 매칭을 `apps/api`로 이관** | 엔진 패키지를 데이터 구조 전용으로 축소 | 세션 전이·노드 우선순위·되묻기·폴백이 전부 엔진에 있다. 매칭만 떼면 **우선순위 파이프라인이 두 곳으로 쪼개져** ADR-0008의 존재 이유가 사라진다. 회귀 표면도 최대 |

## 결정

### 1. 엔진 확장은 `ResolveOptions.semantic` **선택 필드 1개**다

```ts
export interface SemanticMatchInput {
  modelId: string;
  faqScores: ReadonlyMap<string, number>;     // FAQ id → 질문·대체질문 중 최댓값
  intentScores: ReadonlyMap<string, number>;  // 의도 id → 의도명·예문 중 최댓값
  ranked: readonly { kind: 'FAQ'|'INTENT'; id: string; score: number; matchedText: string }[];
  thresholds: { accept: number; low: number; margin: number };
}
```

- `resolveResponse`/`resolveByNodeId`/`resolveTurn`의 **인자 순서와 반환 타입은 바뀌지 않는다**(AC-N4-5).
- 엔진은 이 맵을 **읽기만** 한다. 네트워크·시간·난수를 쓰지 않으므로 **결정론이 그대로 유지된다**(AC-N1-8).
- `semantic` 미지정 = **현행 동작과 완전히 동일**. 저하 모드가 곧 현행 동작이다(AC-N1-3).
- `SemanticMatchInput`은 **zod 스키마가 아니라 순수 TS 타입**이다 — 엔진에 zod를 반입하지 않는다는 기존 규약(ADR-0012의 서브패스 분리와 같은 취지)을 유지한다.

### 2. 정확일치는 유지하고 **부분 문자열 포함만 제거**한다

점수 합성 규칙(고정):

```
① 정규화 정확일치        → 확정 (norm.length + 1000, 기존 로직 그대로)
② semantic 주입 있음     → 의미 유사도 점수
③ semantic 주입 없음     → 부분 문자열 포함 (저하 모드에서만 살아난다)
```

- 정확일치는 비용 0이고 결정론적이며 의미 유사도와 상충하지 않는다. **기존 AC 중 정확일치 기반 항목은 무수정 통과**한다.
- ②가 동작하는 동안 ③은 평가되지 않는다 → 짧은 예문 오탐이 사라진다(AC-N1-2).
- `boostIntentIds`(동음이의어 해소 확정)의 `BOOST_SCORE` 가산은 **바꾸지 않는다**(ADR-0010의 "부스트가 아니라 확정" 결정 유지).
- 동점 타이브레이크는 **`FAQ` → `INTENT`, 같은 종류 내 `id` 오름차순**으로 고정한다(ADR-0008 §2 보강 2와 같은 원칙).

### 3. 적용 범위는 **S3 노드 트리거·S4 FAQ·S5 의도** 3곳이다

의도 매칭 정확도 향상이 **노드 트리거에도 자동 전파**된다. 이는 **의도된 동작 변경**이며 AC-N1-6으로 명시 고정한다 — 조용한 변경을 만들지 않는다. 배포 순서에서 `semanticEnabled`를 마지막에 켜는 이유이기도 하다(설계서 §6.6).

### 4. 구간 판정 함수는 **엔진 패키지에 1개**만 둔다

`packages/dialogue-engine/src/semantic.ts`의 `judgeBand()`를 **엔진·설정 미리보기·시뮬레이터가 공유**한다(NFR-M2, AC-N3-9). `apps/api`가 같은 판정을 복제하면 "미리보기에서는 확정인데 실제로는 되묻기"가 발생한다.

### 5. 되묻기는 **기존 수단**으로 표현한다

후보 질문 원문을 `MESSAGE` 버튼으로 제시하고, 클릭 시 그 텍스트가 재입력되어 **정확일치로 확정**된다. **`ConversationState` 스키마를 바꾸지 않는다**(ADR-0009 봉투 버전 유지) — 새 pending 상태를 만들면 위젯·시뮬레이터·재검증 로직이 전부 영향을 받는다.

## 결과

**좋아지는 것**
- 엔진은 여전히 DB·HTTP·환경변수를 모른다(AC-N4-4). 단위 테스트가 그대로 회귀 감시 장치로 작동한다.
- 임베딩 실패가 **엔진 호출 실패가 아니라 옵션 미주입**으로 표현된다 — 저하 모드가 별도 분기 없이 성립한다(FR-0-44).
- 점수 계산(인프라)과 우선순위 판정(도메인)이 분리되어, 모델을 바꿔도 엔진은 수정되지 않는다.

**나빠지는 것 / 감수하는 것**
- `apps/api`가 **엔진의 후보 구조를 알아야** 점수 맵을 만들 수 있다(어떤 FAQ의 어떤 텍스트를 임베딩했는지). 색인 대상 4종(FR-N1-16)을 두 곳이 합의해야 한다 — `EmbeddingOwnerType` enum을 `shared-types`에 두어 그 합의를 타입으로 고정한다.
- 저하 모드에서 **부분일치 오탐이 되살아난다**(FR-N1-34). "없는 것보다 낫다"는 가용성 판단이며 설계서 §14에 R-3으로 등재했다.
- 부분일치에 의존하던 기존 테스트 일부는 재작성이 필요하다. **그 목록을 PR에 명시**한다(NFR-M4, 조용한 변경 금지).

## 재검토 트리거

- 리랭킹(cross-encoder)을 도입해 **2단계 정렬**이 필요해질 때 — `ranked` 구조만으로 표현되지 않으면 이 ADR을 대체한다.
- 하이브리드 검색(BM25 + 벡터)을 도입할 때 — 점수 합성 규칙 ①②③이 4항으로 늘어난다.
- 엔진 호출부가 4종 이상으로 늘고 `semantic` 조립이 중복될 때 — 조립 책임을 `packages/`로 승격할지 재검토한다.
