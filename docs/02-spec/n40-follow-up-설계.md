# No.40 후속 결함 수정 설계 — N40-1(기록) · N40-3(환경 모드 끄기 `PROMOTE_DRAFT`의 차단 게이트 우회)

> **작성**: system-architect · 2026-10-01
> **입력**: `docs/04-test/결함분류-2026-10-01.md` N40-1·N40-3 · `docs/02-spec/decisions/ADR-0039-*.md` §5·§7 · `docs/02-spec/environment-separation-설계.md` §5.4·§9.3·§10·§19.3 · `docs/requirements/environment-separation.md` FR-EN1-3·FR-EN4-4·AC-EN1-5·AC-EN6-6
> **PM 결정(2026-09-30)**: N40-1·N40-3은 No.36과 분리해 따로 고친다. N40-3은 bug-triage 권고안 A를 따른다. 차단 게이트(BLOCK) 모드에서 초안이 운영과 다르면 `PROMOTE_DRAFT`를 거부한다. `decideDisable` 순수 함수는 그대로 두고 서비스에서 판정한다. 기존 시험 기대값 변경 0, 마이그레이션 0.
> **기존 문서 반영**: 대상 문서가 전부 CRLF여서 직접 고치지 않고 패치 목록으로 남긴다 → `docs/02-spec/n40-follow-up-patches.md`(23건)
> **GPU**: 불필요(`apps/api` 동기 처리 · 순수 함수 1 · DB 조회 추가 0). `packages/dialogue-engine`·`apps/widget`·`apps/ml-worker`·채널 어댑터 변경 0.

---

## 0. 한 문단 요약

환경 분리 모드를 끌 때 "초안을 운영으로"(`PROMOTE_DRAFT`)를 고르면, 시험(TC) 게이트를 한 번도 거치지 않은 초안이 곧바로 공개 응답이 된다. 운영 전환에만 게이트를 두고 끄기에는 두지 않았기 때문이다(설계 누락). 이번 수정에서는 **게이트가 차단 모드이고 초안 내용이 운영 버전과 다르면 `PROMOTE_DRAFT` 확정을 `409 ENV_GATE_NOT_PASSED`로 거부**한다. 초안은 버전 id가 없어 기존 게이트 함수로 평가할 수 없으므로 **평가하지 않고 막는다**. 대신 게이트를 거치는 정식 경로(스테이징 승격 → 운영 전환)와 "운영 유지"로 끄는 경로를 안내한다. 경고 모드(기본값 포함)의 동작은 한 바이트도 바뀌지 않는다. 미리보기 응답에는 **차단일 때만** 선택 키 `promoteDraftBlocked: true`를 싣는다. 웹 대화상자는 이 키가 있으면 "초안을 운영으로" 선택지를 비활성화하고 안내 문구를 보여 준다.

---

## 1. 범위

| 항목 | 상태 | 이 문서에서 하는 일 |
|---|---|---|
| **N40-1** 롤백이 임의 이력 버전에도 게이트를 BLOCK→WARN으로 낮춤 | **코드 수정 완료(2026-10-01)** — `prod-switch.service.ts` `resolveGateKind()` · 통합 시험 `environment-separation.integration.spec.ts` "N40-1." | 구현 사실을 기록한다(§2). ADR-0039 §5 각주와 요구사항 FR-EN4-4·AC-EN6-6 문구를 패치로 갱신한다 |
| **N40-3** 끄기 `PROMOTE_DRAFT`가 게이트 없이 초안을 라이브로 만듦 | **이 문서로 설계**(코드 미착수) | 판정 규칙·오류·미리보기·UI 문구·시험·체크리스트(§3~§9) |

범위 밖: N36-1(2인 승인 끄기 1인 동작) · L-2(직전 롤백 A↔B 토글). 둘 다 PM 결정 대기이며 이번 수정은 두 항목의 동작을 바꾸지 않는다.

---

## 2. N40-1 구현 사실(기록 — 이미 반영된 코드)

- `ProdSwitchService.resolveGateKind(chatbotId, kind, currentProd, targetVersionId)`는 `kind = ROLLBACK`이고 대상이 `pickRollbackTarget()` 결과(= **직전 운영 버전**)일 때만 `'ROLLBACK'`을 돌려준다. 나머지 경우는 모두 `'SWITCH'`다. `preview()`와 `switch()`가 둘 다 이 값을 `evaluateGate()`에 넘긴다.
- 순수 함수 `evaluateProdSwitchGate()`(`core/lib/gate.ts`)와 그 시험 `gate.spec.ts`는 **바꾸지 않았다**. "ROLLBACK이면 BLOCK을 WARN으로" 규칙은 그대로이고, **무엇을 ROLLBACK으로 넘기는가**만 좁혔다.
- 롤백 API가 직전이 아닌 이력 버전을 받는 것(`isSwitchTargetAllowed` — 운영 이력 전체)은 **그대로 허용**한다. 이제 그런 롤백은 차단 게이트를 일반 전환과 똑같이 받는다. 게이트를 통과한 이력 버전으로 돌아가는 것은 계속 가능하다. API 계약 변경 0, 마이그레이션 0.
- 2인 승인 예외 판정(`isDirectRollbackTarget`, R-8)과 같은 "직전" 정의를 쓴다. 그래서 승인 면제 범위와 게이트 완화 범위가 **같은 집합**이 되었다.
- 기존 시험 기대값 변경 0: S-7(`:1712-1790`)은 직전 버전 롤백을 단언하므로 그대로 성립한다. 신규 시험 "N40-1."(`:1793~`)은 비직전 롤백의 미리보기 `GATE_BLOCKED` + 확정 `409 ENV_GATE_NOT_PASSED` + 운영 불변을 단언한다.
- 문서 반영(패치 H-1·H-3·J-5·J-6·J-7·J-10·K-4·K-5·M-2): ADR-0039 §5 각주 "롤백 완화 = 직전 운영 버전에만(N40-1 수정 2026-10-01)", 설계서 §9.3 ③·§10·§19.3·§28, 요구사항 FR-EN4-4·AC-EN6-6, 신규 AC-EN6-7.

---

## 3. N40-3 판정 규칙

### 3.1 게이트 상태별 동작(결정표)

게이트 모드 값은 `WARN | BLOCK` 두 가지뿐이다(`EnvironmentGateMode`). 따로 "OFF"라는 값은 없다. 기본값(`WARN`·필수 세트 없음)을 사실상 "게이트 꺼짐"으로 보고 표에 따로 적는다.

| # | 게이트 설정(`ChatbotEnvironment`) | 초안 vs 운영(§3.2) | `KEEP_PROD` | `PROMOTE_DRAFT` | 미리보기 `promoteDraftBlocked` |
|---|---|---|---|---|---|
| G-0 | 기본값 = `WARN` · `testSetId` null("OFF 상당") | 같음 | 허용(현행) | 허용(현행) | 키 없음 |
| G-0′ | 〃 | 다름 | 복원 후 허용(현행 — 복원 없이는 `ENV_DRAFT_NOT_RESTORED`) | **허용(현행 그대로)** | 키 없음 |
| G-1 | `WARN` · 필수 세트 지정 | 같음 | 허용(현행) | 허용(현행) | 키 없음 |
| G-1′ | 〃 | 다름 | 복원 후 허용(현행) | **허용(현행 그대로)** — 게이트 경고를 새로 붙이지 않는다(§10 Q-1) | 키 없음 |
| G-2 | `BLOCK`(필수 세트 필수 — PUT `superRefine`) | 같음 | 허용(현행) | **허용** — 라이브 내용이 바뀌지 않는다 | 키 없음 |
| G-2′ | 〃 | 다름 | 복원 후 허용(현행) — 라이브 내용이 운영 버전 그대로다 | **거부 `409 ENV_GATE_NOT_PASSED`**(§3.6) | **`true`** |

- 앞선 거부 사유가 먼저 적용된다(§3.4 순서). 2인 승인 정책이 켜진 챗봇은 게이트 모드와 관계없이 끄기 자체가 `409 ENV_APPROVAL_REQUIRED`(`POLICY_ACTIVE`)이며, 이 동작은 바꾸지 않는다.
- `BLOCK`인데 `testSetId`가 null인 행은 설정 단계에서 만들 수 없다. 방어적으로 **모드만 본다**. `BLOCK`이면 세트 유무·세트 삭제(`SET_MISSING`)와 관계없이 G-2′ 규칙을 적용한다.
- 판정은 게이트 **평가 결과**(PASS/WARN/BLOCK)가 아니라 게이트 **설정 모드**와 **내용 동일성**만 본다(§3.3).

### 3.2 "초안이 운영과 다르다"의 정의

> **초안이 운영과 다르다 ⇔ 확정 트랜잭션 안에서 다시 계산한 초안 `contentHash` ≠ 현재 운영 버전 행의 `contentHash`**

- 초안 해시 = `versionCapture.readConsistent(chatbotId, tx)` → `computeFromCaptured(captured, now).contentHash`. 이미 같은 트랜잭션에서 `expectedDraftHash` 검사에 쓰는 값을 그대로 쓴다(추가 계산 0).
- 운영 해시 = `tx.chatbotVersion.findUnique({ where: { id: chatbot.prodVersionId }, select: { contentHash } })`. 이미 `decideDisable` 입력으로 읽는 값이다(추가 조회 0).
- **`KEEP_PROD`의 `ENV_DRAFT_NOT_RESTORED` 판정(`decideDisable`)과 기준이 같다.** 한 화면(끄기 대화상자) 안의 두 선택지가 서로 다른 "같음" 기준을 쓰지 않게 한다.
- `tiebreakHash`(노드 `updatedAt` 보조 필드)는 비교하지 않는다. 편집했다가 되돌려서 **내용은 같고 `updatedAt`만 다른** 초안은 "같음"으로 본다. 근거는 두 가지다. ① 모드를 끈 뒤의 라이브는 어느 선택지로 끄든 자산 테이블의 현재 `updatedAt`으로 동점을 가른다. 이는 `KEEP_PROD` 복원 후에도 같다(설계서 §27 L-6 — 이미 수용한 비용). ② 차단 게이트가 막으려는 것은 "시험하지 않은 **내용**의 공개"다.
- 미리보기의 표시용 `draftDiffersFromProd`(`diffSnapshots(...).summary.identical`의 부정)는 **바꾸지 않는다**. `promoteDraftBlocked` 계산에는 해시 비교(`draft.contentHash !== prodRow.contentHash`)를 쓴다. 확정 판정과 같은 식이다. 미리보기는 이미 두 해시를 모두 들고 있으므로 추가 조회가 없다.

### 3.3 게이트 평가 대상 — "평가하지 않는다"

초안에는 버전 id가 없다. 게이트 함수가 보는 "대상 버전을 대상으로 한 최근 성공 TC 실행"(`TestRun.targetVersionId`, `prod-switch.service.ts` `evaluateGate()`)을 초안에는 정의할 수 없다. 그래서 이번 수정은 게이트를 **평가하지 않고**, 차단 모드에서 초안 내용이 라이브가 되는 경우만 **막고 안내한다**.

| 검토한 평가 대상 | 채택 | 이유 |
|---|---|---|
| (a) 평가하지 않음 — 차단 모드 ∧ 초안≠운영이면 거부 | **채택** | PM 결정(안 A). 순수 함수·게이트 판정 코드·TC 실행 경로 변경 0이다. 게이트를 거치는 정식 경로(승격 → 전환)가 이미 있어 기능 손실이 없다. 거부 조건이 결정적이고 설명하기 쉽다 |
| (b) 초안과 `contentHash`가 같은 기존 버전(예: 현재 스테이징)을 대리로 평가 | 기각 | ① 해시가 같아도 `tiebreakHash`가 다르면 TC 결과(동점 승자)가 다를 수 있다. 대리 평가가 "그 초안"의 합격을 보증하지 않는다(ADR-0039 §3 · 설계서 R-2가 재사용 조건에 `tiebreakHash`를 더한 것과 같은 이유). ② `evaluateGate`는 `environment/core`의 `ProdSwitchService` private이다. 끄기 서비스(최상위 `environment`)가 쓰려면 core export를 늘리거나 함수를 복제해야 한다(NFR-ENM2 "미리보기·전환·예약이 같은 함수"를 넓히는 설계 변경). ③ 그 버전이 이미 게이트를 통과했다면 사용자는 **그 버전으로 운영 전환**한 뒤 끄면 된다. 전환 후에는 초안 = 운영이 되어 G-2 규칙에 따라 어느 선택지로도 끌 수 있다. 한 단계가 늘지만 게이트가 평가한 기록(이력·감사)이 남는다 |
| (c) 끄기 확정 시 초안을 임시 버전으로 캡처해 TC를 실행한 뒤 평가(안 B) | 기각 | TC 실행은 비동기 Job이다. 끄기 확정(동기 1트랜잭션)과 합칠 수 없어 "캡처 → 실행 대기 → 재확정" 상태 기계가 새로 필요하다. 사실상 "승격 → TC → 전환"을 끄기 안에 복제하는 셈이다 |
| (d) 현재 운영 버전의 게이트 결과로 평가 | 기각 | 라이브가 되는 것은 운영 버전이 아니라 초안이다. 대상이 틀렸다 |

### 3.4 확정 판정 순서(`EnvironmentModeService.disable()` 트랜잭션 안)

기존 순서를 그대로 두고 **⑥ 한 단계만 끼운다**. 괄호 안은 기존 코드 위치(2026-10-01 작업 트리)다.

```
(트랜잭션 밖) assertWritable · RUNNING 예약 → 409 ENV_SWITCH_BUSY                         (현행 :312-314)
tx:
 ① chatbot 재조회 — prodVersionId null → 409 ENV_MODE_DISABLED                            (현행 :320-321)
 ② 환경 행 1회 조회 select { approvalRequired, gateMode }  ← ★ select에 gateMode 1필드 추가(조회 수 불변)
    approvalRequired → 409 ENV_APPROVAL_REQUIRED(details reason=POLICY_ACTIVE)            (현행 :324-329)
 ③ prodVersionId ≠ expectedProdVersionId → 409 ENV_POINTER_STALE                           (현행 :330)
 ④ 초안 해시 재계산 ≠ expectedDraftHash → 409 ENV_POINTER_STALE                             (현행 :332-335)
 ⑤ decideDisable(mode, draftHash, prodHash) = NEED_RESTORE → 409 ENV_DRAFT_NOT_RESTORED     (현행 :337-341 · 불변)
 ⑥ ★ decidePromoteDraftGate({ mode, gateMode, draftContentHash, prodContentHash }) = GATE_BLOCKED
       → 409 ENV_GATE_NOT_PASSED(details reason=PROMOTE_DRAFT_BLOCKED)                     (신규)
 ⑦ writer.disable(tx) — count 0 → 409 ENV_POINTER_STALE                                   (현행 :343-345)
 ⑧ hooks.cancelSwitchForEnvDisable(tx)                                                    (현행 :347)
```

- **환경 행이 없는 경우**(`policyRow` null — 켜진 챗봇에서는 불변식상 생길 수 없다): `gateMode`를 `'WARN'`으로 본다. 기존 `policyRow?.approvalRequired`와 같은 방어 방식이다.
- **순서 근거**: 정책(②)이 가장 강한 거부라 먼저 온다. 기존 시험 `prod-switch-approval.integration.spec.ts:73-82`가 그대로다. 오래된 미리보기(③④)는 사용자가 어차피 다시 봐야 하므로 게이트 판정보다 먼저 온다(판정 입력 자체가 달라졌다). ⑤와 ⑥은 서로 다른 모드에만 적용되어 순서가 결과에 영향을 주지 않는다. 기존 코드 흐름을 흐트러뜨리지 않도록 ⑤ 뒤에 둔다.
- **게이트 모드를 트랜잭션 안에서 읽는 이유**: 미리보기 이후 다른 관리자가 게이트를 `WARN → BLOCK`으로 바꾼 경합을 확정 시점에 잡기 위해서다. 게이트 설정 쓰기(`writer.updateGate`)는 같은 SQLite 쓰기 직렬화를 받는다. 미리보기의 `promoteDraftBlocked`는 **안내용**이고 확정 판정이 권위다.
- 거부 시 쓰기 0: 포인터·환경 행·전환 이력·예약·보존 벡터·캐시·감사 전부 불변이다. 트랜잭션이 throw로 롤백되며, 커밋 후 단계(캐시 제거·`purgeChatbot`·감사)에 도달하지 않는다. 기존 거부 경로(`ENV_DRAFT_NOT_RESTORED` 등)도 감사를 남기지 않으므로 같은 규약을 따른다.

### 3.5 순수 함수 계약(신규 1개 — `decideDisable` 불변)

`apps/api/src/environment/lib/promote-draft-gate.ts`(신규, Prisma·Nest import 0):

```ts
/**
 * [N40-3] 환경 모드 끄기 "초안을 운영으로"의 차단 게이트 판정(n40-follow-up-설계.md §3).
 * 게이트를 평가하지 않는다 — 초안은 버전 id가 없어 TC 게이트 대상이 될 수 없으므로,
 * 차단 모드에서 시험하지 않은 내용이 라이브가 되는 경우만 막는다.
 */
export function decidePromoteDraftGate(input: {
  mode: 'KEEP_PROD' | 'PROMOTE_DRAFT';
  gateMode: 'WARN' | 'BLOCK';
  draftContentHash: string;
  prodContentHash: string;
}): 'OK' | 'GATE_BLOCKED';
// 규칙: mode = PROMOTE_DRAFT ∧ gateMode = BLOCK ∧ draftContentHash ≠ prodContentHash → 'GATE_BLOCKED', 그 외 'OK'
```

- `decideDisable`(`disable-plan.ts`)과 그 시험 3건은 **한 글자도 바꾸지 않는다**. 다만 주석 "`PROMOTE_DRAFT`는 항상 허용"은 이제 서비스 전체 동작으로는 사실이 아니다. 이 문장은 **이 함수의 판정 범위**(복원 필요 여부)에 대한 설명으로 남긴다. 구현자는 주석 끝에 "차단 게이트 판정은 `promote-draft-gate.ts`(N40-3)"라는 참조 1줄을 **추가만** 한다(선택 — 시험 영향 0).
- 미리보기(§3.7)와 확정(§3.4 ⑥)이 **같은 함수**를 호출한다. 미리보기는 `mode: 'PROMOTE_DRAFT'`를 고정으로 넣어 "이 선택지를 고르면 막히는가"를 계산한다.
- 파일 위치를 `environment/lib/`로 둔 이유: `decideDisable`·`decideEnvInitVersion`과 같은 층(최상위 `environment` 모듈의 켜기/끄기 판정)이다. `environment/core/lib/gate.ts`는 운영 전환 게이트(버전 평가) 전용이라 섞지 않는다.
- DB 컬럼 `gateMode`는 `String`이다. 서비스는 `row?.gateMode === 'BLOCK' ? 'BLOCK' : 'WARN'`으로 좁혀서 넘긴다(알 수 없는 값은 WARN — 기존 `getPointerStatus` 해석과 같은 방향인지 구현 시 확인).

### 3.6 오류 코드와 details 규약

| 항목 | 값 |
|---|---|
| 코드 | **`ENV_GATE_NOT_PASSED`(기존 재사용 — 신규 코드 0)** · HTTP 409 |
| 메시지(서버) | `차단 게이트가 켜져 있어 초안을 바로 운영으로 올릴 수 없습니다. 스테이징으로 승격한 뒤 운영 전환(필수 시험 통과)을 거치거나 '운영 유지'로 꺼 주세요.` |
| details | `[{ field: 'reason', message: 'PROMOTE_DRAFT_BLOCKED' }]` |

- **재사용 근거**: 의미가 같다("차단 게이트 때문에 이 버전/내용을 운영에 올릴 수 없다"). 설계서 §19.3·R-7이 금지한 것은 "같은 코드, 다른 의미"이며, 이번 경우는 같은 의미를 다른 입구(끄기)에 적용한 것이다. 코드를 새로 만들면 `ApiErrorCode` enum과 웹 오류 사전·승인 화면 분류표(`approvalText.ts`)를 모두 늘려야 한다.
- **details 규약**: `ENV_APPROVAL_REQUIRED`의 `{ field: 'reason', message: 'POLICY_ACTIVE' | 'APPROVAL_REQUIRED' }` 선례를 따른다. 기존 운영 전환 경로의 `ENV_GATE_NOT_PASSED`는 details가 없으며 **그대로 둔다**(응답 바이트 불변). 클라이언트는 호출한 엔드포인트(끄기)로도 구분할 수 있지만, 공통 오류 처리기가 사유를 구분할 수 있도록 details를 싣는다.
- 예약 실행 분류(`outcome-classifier.ts` `ENV_GATE_NOT_PASSED → GATE_NOT_PASSED`)에는 영향이 없다. 끄기는 예약 동작이 아니기 때문이다. 승인 화면의 `applyFailure` 목록(`switch-approval.service.ts:443`)도 승인 실행(전환) 경로 전용이라 영향이 없다.
- §19.3 오류 표의 `ENV_GATE_NOT_PASSED` 조건 문구를 갱신한다(패치 J-7).

### 3.7 미리보기 응답(`POST …/environment/disable/preview`)

`packages/shared-types/src/environment.ts` `DisableEnvironmentPreviewResponseSchema`에 선택 필드 1개를 추가한다.

```ts
/** [N40-3] 차단 게이트 ∧ 초안≠운영(contentHash)이면 "초안을 운영으로" 확정이 409가 된다 — 해당할 때만 키 존재(기존 응답 바이트 동일). */
promoteDraftBlocked: z.literal(true).optional(),
```

- 계산: `decidePromoteDraftGate({ mode: 'PROMOTE_DRAFT', gateMode: pointer.gate.mode, draftContentHash: draft.contentHash, prodContentHash: prodRow.contentHash }) === 'GATE_BLOCKED'`이면 `{ promoteDraftBlocked: true }`를 펼쳐 넣는다. `pointer`는 현행 코드가 이미 `approvalPolicyActive` 계산용으로 부르는 `this.environmentRead.getPointerStatus(chatbotId)` 결과를 **재사용**한다. 호출 1회로 합치고 조회 추가는 0이다(현행 `:297`은 `.approval`만 꺼내 쓰므로 변수로 받도록 바꾼다).
- **키 생략 규약**: 해당하지 않으면 키를 싣지 않는다. 기본 게이트(WARN) 챗봇·초안=운영 챗봇의 응답은 현행과 바이트가 같다(설계서 §4.2 "값이 있을 때만 키" · No.36 `approvalPolicyActive` 선례).
- `approvalPolicyActive`와 둘 다 실릴 수 있다. 우선순위는 UI가 정한다(§4 — 정책 잠금 안내가 우선).
- 게이트 모드·세트 등 다른 필드는 싣지 않는다. 대화상자는 막힘 여부만 알면 된다. 게이트 상세는 환경 탭의 게이트 카드가 이미 보여 준다.
- shared-types 변경 후 `pnpm --filter @chat-bot/shared-types build`를 먼저 실행한다(CLAUDE.md).

---

## 4. 웹 대화상자 `EnvironmentDisableDialog` 요구(frontend-implementer — 안내 문구·상태만)

서버 계약은 §3.6·§3.7이다. 새 화면·새 컴포넌트는 없고 기존 대화상자(`apps/web/src/pages/chatbot-detail/environment/EnvironmentDisableDialog.tsx`, ui-spec §4.4 EN1-b)의 분기만 더한다. ui-spec 반영은 패치 L-1·L-2다.

### 4.1 표시 규칙

| 상태 | 표시 |
|---|---|
| `approvalPolicyActive` 있음 | **현행 그대로**(정책 잠금 안내만 — 라디오 없음). `promoteDraftBlocked`는 무시한다 |
| `draftDiffersFromProd = false` | 현행 그대로(선택지 없음 → `KEEP_PROD`) |
| `draftDiffersFromProd = true` ∧ `promoteDraftBlocked` 없음 | 현행 그대로(라디오 2개 · 기본 "운영 유지") |
| `draftDiffersFromProd = true` ∧ **`promoteDraftBlocked = true`** | 라디오 2개를 유지하되 **"초안을 운영으로" 라디오에 `disabled`**를 준다. 그 바로 아래 안내 문구 `promoteDraftBlockedHint`(`field-hint`, `id` 부여)를 두고 라디오에 `aria-describedby`로 연결한다. 기본 선택은 "운영 유지" 그대로라 막다른 상태가 생기지 않는다 |
| 확정 응답 `409 ENV_GATE_NOT_PASSED`(미리보기 이후 게이트가 BLOCK으로 바뀐 경합) | 오류 배너(`role="alert"`)에 `promoteDraftBlockedError`를 띄우고 **선택을 "운영 유지"로 되돌린 뒤 미리보기를 다시 불러온다**. 다시 불러온 미리보기에 `promoteDraftBlocked`가 실려 라디오가 비활성화된다. 사용자가 누르지 않은 동작(복원)을 자동으로 실행하지 않는다 |

- **라디오를 숨기지 않고 비활성으로 두는 이유**: 선택지가 사라지면 사용자는 "초안을 운영으로" 경로가 왜 없는지 알 수 없다. 비활성 라디오와 이유 문구를 함께 보여 주면 정식 경로(승격 → 전환)를 안내할 수 있다. 비활성 라디오는 방향키 탐색에서 건너뛰어지지만(브라우저 기본), 레이블과 안내 문구는 읽는 순서대로 낭독된다(UIUX §6 레이블 있는 폼 · 키보드 접근). 안내 문구는 동적으로 삽입되는 내용이 아니므로 `aria-live`를 두지 않는다.
- 판정 기준 확인: 대화상자는 `promoteDraftBlocked` **키 존재**만 보고, 게이트 모드를 스스로 추론하지 않는다(서버와 같은 함수 결과를 그대로 쓴다).

### 4.2 문구(`MESSAGES.environment.disableDialog`에 추가 — 기존 키 변경 0)

| 키 | 문구 |
|---|---|
| `promoteDraftBlockedHint` | `차단 게이트가 켜져 있어 선택할 수 없습니다. 초안을 운영에 반영하려면 스테이징으로 승격한 뒤 운영 전환(필수 시험 통과)을 거쳐 주세요.` |
| `promoteDraftBlockedError` | `그사이 차단 게이트가 켜져 초안을 바로 운영으로 올릴 수 없습니다. '운영 유지'로 끄거나, 스테이징 승격 후 운영 전환을 거쳐 주세요.` |

- 전역 오류 사전 `MESSAGES.environment.errors.ENV_GATE_NOT_PASSED`('필수 시험 기준을 충족하지 못해 전환할 수 없습니다.')는 **바꾸지 않는다**. 운영 전환 대화상자가 쓰는 문구이며, 끄기 대화상자는 위 전용 문구를 쓴다.
- 문구 톤은 기존 대화상자 문구(존댓말·해결 방법 제시 — UIUX 오류 메시지 규칙)에 맞췄다. ui-designer 검토 없이 적용할 수 있는 수준의 변경이지만, 문구를 조정하려면 ui-spec 패치 L-1에서 고친다.

---

## 5. 대안과 트레이드오프(ADR 스타일 요약)

별도 ADR을 만들지 않고 **ADR-0039에 갱신 절을 추가**한다(패치 H-3). ADR-0039 결정 7(끄기)의 적용 범위를 좁히는 결정이라 같은 ADR에 두는 편이 추적하기 쉽다(No.36이 ADR-0039에 갱신 절을 단 선례와 같다).

| 대안 | 판단 | 이유 |
|---|---|---|
| **A. 차단 모드 ∧ 초안≠운영이면 `PROMOTE_DRAFT` 거부(채택)** | 채택 | PM 결정. 기존 시험 기대값 0 · 마이그레이션 0 · 조회 추가 0. 차단 게이트의 약속("시험 기준 미달 내용은 운영에 올라가지 않는다")을 끄기 입구에서도 지킨다 |
| B. 초안 임시 캡처 + TC 실행 후 평가 | 기각 | §3.3 (c) |
| C. 동일 해시 버전 대리 평가 | 기각 | §3.3 (b) |
| D. 차단 모드면 끄기 자체(`KEEP_PROD` 포함)를 거부 | 기각 | `KEEP_PROD`는 라이브 내용을 바꾸지 않는다. 모드를 끈 뒤의 편집이 곧 라이브가 되는 것은 "환경 분리를 끈다"는 행위의 의미 자체이며, 2인 승인(R-7)처럼 **통제 관문 전체**를 없애는 것과는 다르다. 게이트는 버전 전환의 관문이지 편집의 관문이 아니다. 끄기를 막으면 게이트를 켠 챗봇은 게이트를 먼저 WARN으로 낮춰야만 끌 수 있다. 결과는 같고 절차만 늘어난다 |
| E. 경고 모드에서도 `PROMOTE_DRAFT`에 게이트 경고 확인(`acknowledgeWarnings`) 요구 | 이번엔 안 함(§10 Q-1) | 요청 계약(`DisableEnvironmentSchema`)이 바뀌고 기존 PROMOTE_DRAFT 성공 시험 3건(`:789`·`:1319`·`:1571`)의 요청 본문이 바뀐다 → "기대값 변경 0" 위반. 대화상자에서 라디오를 직접 고르고 "지금 초안 내용이 즉시 공개됩니다" 문구를 확인하는 것이 이미 명시적 확인 역할을 한다 |
| F. 새 오류 코드 `ENV_PROMOTE_DRAFT_GATED` | 기각 | §3.6 — 같은 의미, 표면 증가만 있다 |

**감수하는 비용**
1. 게이트를 `BLOCK → WARN`으로 낮춘 뒤 `PROMOTE_DRAFT`로 끄는 **명시적** 경로는 남는다. 게이트 설정 변경은 `chatbot:deploy` 1인 동작이며 감사(`UPDATE` gateMode before/after)가 남는다. 운영 전환도 같은 방법(게이트 낮춤 → 전환)으로 우회할 수 있으므로 기존 신뢰 모델과 같은 수준이다. 이번 수정은 **조용한** 우회(게이트 설정 흔적 없이 초안이 라이브가 되는 것)를 닫는다. 규제 수준의 통제가 필요하면 2인 승인(N36-1 결정과 연동)을 쓴다.
2. 차단 게이트 챗봇에서 "초안을 그대로 공개하며 끄기"는 한 단계(승격 → 전환)가 늘어난다. 정식 경로를 따르면 전환 이력과 게이트 평가 기록이 남는다.
3. 내용은 같고 `updatedAt`만 다른 초안(편집 후 되돌림)은 차단 모드에서도 `PROMOTE_DRAFT`가 허용된다(§3.2). 동점 승자가 달라질 수 있는 창은 `KEEP_PROD`와 같다(§27 L-6).

---

## 6. 수용 기준(AC)

요구사항 문서에 넣을 AC(패치 K-1·K-2·K-5)와 이 문서 고유의 세부 AC(AC-N40-*)를 함께 적는다.

| ID | Given | When | Then |
|---|---|---|---|
| **AC-EN1-5**(문구 한정) | 초안이 운영과 다른 챗봇 · 게이트 **경고 모드**(기본값 포함) | "초안을 운영으로"로 끄기 | 공개 응답이 초안 기준이 되고 이력에 `DISABLE`이 남는다(현행 시험 S-1 그대로) |
| **AC-EN1-7**(신규) | 초안이 운영과 다른 챗봇 · 게이트 **차단 모드** · 2인 승인 꺼짐 | "초안을 운영으로"로 끄기 | `409 ENV_GATE_NOT_PASSED`(`details.reason = PROMOTE_DRAFT_BLOCKED`) · 모드 켜짐 유지(운영 포인터·스테이징·환경 행 불변) · 전환 이력 0행 추가 · 활성 전환 예약 상태 불변 · 감사 0건 · 공개 응답은 여전히 운영 버전 기준 · 미리보기에 `promoteDraftBlocked: true` |
| **AC-EN1-8**(신규) | 게이트 **차단 모드** | (a) 초안 = 운영(`contentHash` 같음)에서 "초안을 운영으로"로 끄기 · (b) 초안≠운영에서 "운영 유지"로 끄기(콘솔 복원 후) | 둘 다 성공한다 · (a)의 미리보기에 `promoteDraftBlocked` 키가 없다 |
| **AC-EN6-6**(문구 한정 — N40-1) | 차단 게이트 | **직전 운영 버전으로** 롤백 | 게이트 경고만 표시되고 성공한다(현행 시험 S-7 그대로) |
| **AC-EN6-7**(신규 — N40-1) | 차단 게이트 · 운영 이력에 직전이 아닌 과거 버전(해당 버전 대상 TC 기준 미달 또는 실행 없음) | 그 버전으로 롤백 | 미리보기 `blockers`에 `GATE_BLOCKED` · 확정 `409 ENV_GATE_NOT_PASSED` · 운영 불변(현행 시험 "N40-1." 그대로) |
| AC-N40-1 | 차단 게이트 · 초안≠운영 · **2인 승인 켜짐** | "초안을 운영으로"로 끄기 | `409 ENV_APPROVAL_REQUIRED`(`POLICY_ACTIVE`) — 정책 거부가 게이트 거부보다 먼저다 |
| AC-N40-2 | 차단 게이트 · 미리보기 이후 초안이 편집됨 | 이전 미리보기 해시로 "초안을 운영으로" 확정 | `409 ENV_POINTER_STALE` — 오래된 미리보기 거부가 게이트 거부보다 먼저다 |
| AC-N40-3 | 경고 게이트 · **필수 세트 지정** · 초안≠운영 | 미리보기 · "초안을 운영으로" 확정 | 미리보기에 `promoteDraftBlocked` 키 없음 · 확정 성공(G-1′ 현행 동작) |
| AC-N40-4 | 경고 게이트에서 미리보기(`promoteDraftBlocked` 없음) → 다른 관리자가 게이트를 차단 모드로 변경 | 이전 미리보기 해시로 "초안을 운영으로" 확정 | `409 ENV_GATE_NOT_PASSED`(`PROMOTE_DRAFT_BLOCKED`) — 확정이 트랜잭션 안의 게이트 모드로 판정한다 |
| AC-N40-5 | 차단 게이트 · 필수 세트가 삭제됨(`SET_MISSING`) · 초안≠운영 | "초안을 운영으로"로 끄기 | `409 ENV_GATE_NOT_PASSED`(모드만 본다 — §3.1) |
| AC-N40-6(웹) | 미리보기 `draftDiffersFromProd: true` · `promoteDraftBlocked: true` | 대화상자 열기 | 라디오 2개 · "초안을 운영으로" 라디오 `disabled` · 안내 문구 표시 및 `aria-describedby` 연결 · "운영 유지" 선택 상태 · axe 위반 0 |
| AC-N40-7(웹) | 미리보기에 `promoteDraftBlocked` 없음 · "초안을 운영으로" 선택 | 확정 → `409 ENV_GATE_NOT_PASSED` | `role="alert"` 배너에 `promoteDraftBlockedError` · 선택이 "운영 유지"로 돌아감 · `disablePreview` 재호출 · `onDisabled` 미호출 · 복원 API 미호출 |
| AC-N40-8(웹) | `approvalPolicyActive: true`와 `promoteDraftBlocked: true`가 함께 있음 | 대화상자 열기 | 정책 잠금 안내만 표시(현행) — 라디오 없음 |

---

## 7. 시험 전략

| 층 | 파일 | 추가 내용 | 비고 |
|---|---|---|---|
| 단위(순수) | `apps/api/src/environment/lib/promote-draft-gate.spec.ts`(신규) | 결정표 전수 8건: {KEEP_PROD, PROMOTE_DRAFT} × {WARN, BLOCK} × {같음, 다름} → PROMOTE_DRAFT ∧ BLOCK ∧ 다름만 `GATE_BLOCKED` | 순수 함수 · DB 0 |
| 통합 | `apps/api/src/integration/environment-separation.integration.spec.ts`(기존 파일에 `describe` 블록 추가 — N40-1 선례) | AC-EN1-7(거부 + 불변 단언: `chatbot.prodVersionId`·`chatbotEnvironment.stagingVersionId/enabledAt`·`environmentSwitchLog` 행 수·`deploySchedule` 상태·감사 행 수·공개 응답 문구) · AC-EN1-8 (a)(b) · AC-N40-1(정책 우선) · AC-N40-2(STALE 우선) · AC-N40-3(WARN+세트 → 키 없음·성공) · AC-N40-4(미리보기 후 게이트 변경) · AC-N40-5(세트 삭제) | 각 `it`은 **자기 챗봇을 새로 만든다**(기존 S-1·P-3 챗봇 공유 금지 — 기존 시험의 게이트 기본값 전제를 깨지 않도록) · 차단 게이트는 `PUT …/environment/gate { mode:'BLOCK', testSetId, minPassRate:95, validHours:24 }`로 켠다(S-7과 같은 방식) · AC-N40-1은 `prod-switch-approval.integration.spec.ts`의 `setupApprovalBot` 하네스를 쓰는 편이 간단하다(그 파일에 1건 추가도 가능) |
| 웹 | `apps/web/src/pages/chatbot-detail/environment/EnvironmentDisableDialog.spec.tsx`(기존 파일에 `it` 추가) | AC-N40-6(+axe) · AC-N40-7 · AC-N40-8 | `basePreview()` 헬퍼는 그대로 두고 `overrides`로 새 키를 넣는다 |
| 정적 | 기존 `environment-sealing.spec.ts` E-1~E-17 | 추가 없음 — 새 lib 파일이 Prisma·포인터 쓰기·버전 본문 토큰을 쓰지 않는지 기존 검사로 통과 확인 | |

- 실행 순서: `pnpm --filter @chat-bot/shared-types build` → `apps/api`에서 `npx jest src/environment src/integration/environment-separation.integration.spec.ts src/integration/prod-switch-approval.integration.spec.ts src/integration/environment-query-count.integration.spec.ts` → 전체 `npx jest` → `apps/web`에서 `npx vitest run src/pages/chatbot-detail/environment` → 전체 `npx vitest run`.
- 재현 → 수정 증거: 통합 AC-EN1-7 시험을 **수정 전에 먼저 추가**해 현재 코드에서 성공 응답(기대 409)으로 실패하는 것을 확인한 뒤 수정한다(결함분류 "확인 필요" 해소).

---

## 8. 영향 받는 기존 시험(기대값 변경 0 — 닫힌 목록)

아래 시험은 **수정 없이 통과해야 한다**. 이 목록 밖의 기존 시험이 깨지면 회귀로 보고 멈춘다.

| 파일(위치 — 2026-10-01 작업 트리) | 왜 그대로인가 |
|---|---|
| `apps/api/src/environment/lib/disable-plan.spec.ts`(3건 — "PROMOTE_DRAFT는 해시가 달라도 항상 OK다" 포함) | `decideDisable` 불변 |
| `apps/api/src/environment/core/lib/gate.spec.ts` | `evaluateProdSwitchGate` 불변(N40-1도 불변) |
| `environment-separation.integration.spec.ts:789`(PROMOTE_DRAFT 끄기) | 기본 게이트(WARN) 챗봇 — G-0′ 현행 동작 |
| 〃 `:1311-1343`(P-3 전환 ∥ 끄기 동시) | 기본 게이트 · 이 시험은 초안 = v3 상태에서 전환(v2→v3)과 경합한다. BLOCK이 아니므로 ⑥은 무관하다 |
| 〃 `:1555-1571`(S-1 · AC-EN1-5) | 기본 게이트 |
| 〃 `:1663~`(S-6) · `:1712-1790`(S-7) · `:1793~`(N40-1) | 끄기를 호출하지 않는다 · 차단 게이트는 각 시험의 자기 챗봇에만 걸린다(구현 시 챗봇 공유 여부 재확인) |
| `prod-switch-approval.integration.spec.ts:73-82`(정책 켜짐 → 끄기 409 `POLICY_ACTIVE`) | 정책 검사(②)가 게이트 검사(⑥)보다 먼저 · 요청 모드는 `KEEP_PROD` |
| `environment-query-count.integration.spec.ts:244-258`(끄기 `KEEP_PROD`) | 확정 트랜잭션의 환경 행 조회 **select 필드만** 1개 늘어난다(쿼리 수 불변) · 미리보기는 기존 `getPointerStatus` 호출 재사용(쿼리 수 불변) · 게다가 이 구간은 쿼리 수 단언 대상이 아닌 준비 단계다 |
| `outcome-classifier*.spec.ts` · `approvalText.spec.ts` · `EnvironmentApprovals.spec.tsx` | `ENV_GATE_NOT_PASSED` 매핑·문구 불변 |
| 웹 `EnvironmentDisableDialog.spec.tsx`(7건) | 새 키가 없는 미리보기로 분기가 현행과 같다 · 라디오 수 2 불변 |
| 웹 `EnvironmentTab.spec.tsx` · `EnvironmentTab.approval.spec.tsx` · `EnvironmentHistoryDisable.approval.spec.tsx` | 미리보기 목에 새 키 없음 → 현행 분기 |
| `environment-sealing.spec.ts` E-1~E-17 | 새 파일은 순수 함수(허용 목록·토큰 검사 대상 밖) |

**마이그레이션 0**: Prisma 스키마 변경 없음(`gateMode` 기존 컬럼 읽기만). **응답 바이트**: 게이트 경고 모드 챗봇과 초안 = 운영인 챗봇의 끄기 미리보기·확정 응답은 현행과 같다.

---

## 9. 구현 체크리스트

### 9.1 backend-implementer
1. [ ] (재현) `environment-separation.integration.spec.ts`에 AC-EN1-7 시험을 먼저 추가하고, 현재 코드에서 실패(성공 응답)하는 것을 확인한다.
2. [ ] `apps/api/src/environment/lib/promote-draft-gate.ts` 신규(§3.5) + `promote-draft-gate.spec.ts`(8건).
3. [ ] `packages/shared-types/src/environment.ts` `DisableEnvironmentPreviewResponseSchema`에 `promoteDraftBlocked: z.literal(true).optional()` 추가 → `pnpm --filter @chat-bot/shared-types build`.
4. [ ] `environment-mode.service.ts` `disablePreview()`: `getPointerStatus` 결과를 변수로 받아 `approval`·`gate.mode`를 함께 쓰고(호출 1회 유지), `...(blocked ? { promoteDraftBlocked: true as const } : {})`를 추가한다. 기존 키의 순서·값은 바꾸지 않는다.
5. [ ] `environment-mode.service.ts` `disable()` 트랜잭션: `policyRow` select에 `gateMode: true` 추가 → `decideDisable` 뒤에 `decidePromoteDraftGate` 호출 → `GATE_BLOCKED`이면 `throw new ApiException('ENV_GATE_NOT_PASSED', 409, <§3.6 메시지>, [{ field: 'reason', message: 'PROMOTE_DRAFT_BLOCKED' }])`. `policyRow`가 null이면 `'WARN'`으로 본다.
6. [ ] (선택) `disable-plan.ts` 주석에 참조 1줄 **추가만**(§3.5). 함수 본문·기존 주석 문장 변경 금지.
7. [ ] 통합 시험 AC-EN1-8·AC-N40-1~5 추가 · §8 목록 전부 무수정 통과 확인 · 전체 `npx jest`.
8. [ ] N40-1은 이미 반영됐다 — `resolveGateKind`·"N40-1." 시험이 그대로 통과하는지만 확인한다(추가 작업 없음).

### 9.2 frontend-implementer(안내 문구·상태만)
1. [ ] `MESSAGES.environment.disableDialog`에 `promoteDraftBlockedHint`·`promoteDraftBlockedError` 추가(§4.2 문구 그대로).
2. [ ] `EnvironmentDisableDialog.tsx`: `preview.promoteDraftBlocked === true`이면 "초안을 운영으로" `<input type="radio">`에 `disabled` + `aria-describedby="environment-disable-promote-blocked-hint"`를 주고, 라디오 레이블 아래에 `<p id="environment-disable-promote-blocked-hint" className="field-hint">`로 안내 문구를 둔다. 정책 잠금 분기가 우선이다(현행 구조 유지).
3. [ ] `handleConfirm` catch에 `e.code === 'ENV_GATE_NOT_PASSED'` 분기 추가: `setOtherError(msg.promoteDraftBlockedError)` → `setMode('KEEP_PROD')` → `await fetchPreview()`. 기존 분기의 순서·동작은 바꾸지 않는다.
4. [ ] 웹 시험 AC-N40-6·7·8 추가(axe 포함) · 기존 7건 무수정 통과 · 전체 `npx vitest run`.

### 9.3 문서(적용 담당: 오케스트레이터/git-manager — 부분 편집이 가능한 세션)
1. [ ] `docs/02-spec/n40-follow-up-patches.md` 전 항목 적용(앵커 1회 매칭 확인 · CRLF 유지). 코드보다 먼저 적용한다(오류검출 프로세스 §4 — 문서 갱신 없이 코드만 수정 금지).
2. [ ] (test-automation 소관) 시험항목 패치 M-1·M-2.
3. [ ] 적용 후 `docs/04-test/결함분류-2026-10-01.md`의 N40-1·N40-3 상태는 bug-triage가 구현 완료 시점에 갱신한다(이 설계 범위 밖).

---

## 10. PM 확인 사항(수정 착수를 막지 않음 — 결정 전까지는 이 문서의 기본값으로 진행)

| # | 질문 | 이 문서의 기본값 | 다른 선택의 비용 |
|---|---|---|---|
| Q-1 | 경고 게이트(필수 세트 지정, G-1′)에서 "초안을 운영으로" 끄기에도 **게이트 경고 안내**를 붙일까? | 붙이지 않는다(현행 유지) | 안내 문구만(미리보기에 선택 키 1개 추가 + 대화상자 힌트) 붙이면 기대값 변경 0으로 가능하다. `acknowledgeWarnings` 같은 **확인 강제**까지 하면 요청 계약과 기존 시험 3건이 바뀐다 |
| Q-2 | 차단 게이트 챗봇에서 게이트를 `BLOCK → WARN`으로 낮춘 뒤 끄는 **명시적** 경로(§5 감수 비용 1)를 더 막을까? | 막지 않는다(운영 전환과 같은 신뢰 모델 · 감사로 추적) | 막으려면 게이트 낮춤 자체를 2인 승인 대상으로 만들어야 한다 — N36-1(2인 승인 끄기 1인 동작)과 같은 축의 결정이다 |

---

## 11. 관련 문서 패치

`docs/02-spec/n40-follow-up-patches.md`(23건) — ADR-0039(H-1~H-3) · 환경 분리 설계서(J-1~J-10) · 환경 분리 요구사항(K-1~K-5) · 환경 분리 UI 명세(L-1·L-2) · 개발명세서(A-1) · (test-automation 소관·선택) 시험항목(M-1·M-2).
