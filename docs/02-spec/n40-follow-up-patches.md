# No.40 후속 결함 N40-1·N40-3 — 기존 문서 패치 목록

> 작성: system-architect · 2026-10-01 · 근거: `docs/02-spec/n40-follow-up-설계.md`, `docs/04-test/결함분류-2026-10-01.md` N40-1·N40-3, PM 결정(2026-09-30 — No.36과 분리해 별도 수정 · N40-3 안 A)
> **적용 상태**: ✅ **적용됨(2026-10-01)**. architect 세션에는 부분 수정 도구가 없고 대상 파일이 CRLF다. 전체 재작성으로 줄바꿈이 통째로 바뀌는 위험을 피하려고 패치 목록으로 남긴다(선행 그룹 `*-patches.md`와 같은 방식).
> **적용 방법**: 각 항목의 "찾을 원문"을 대상 파일에서 **정확히 1회** 찾아 "바꿀 내용"으로 교체한다. 모든 원문은 2026-10-01 시점 작업 트리(HEAD `4163a62` — 대상 문서는 미수정 상태)에서 복사했다. 문자열 검색으로 대상 파일 안에서 **1회 매칭(1줄)**을 확인했다. "바꿀 내용"이 원문을 그대로 포함하는 항목은 append다.
> **줄바꿈 주의**: 대상 파일은 `docs/04-test/시험항목.md`(LF — 항목 M)를 빼고 전부 CRLF다. 모든 "찾을 원문"은 **한 줄 안의 부분 문자열**(줄바꿈 미포함)이다. "바꿀 내용"의 줄바꿈은 대상 파일의 줄바꿈(CRLF)으로 정규화한다.
> **순서 독립**: 어떤 "바꿀 내용"도 다른 항목의 "찾을 원문"을 새로 만들지 않는다. 같은 줄에 앵커가 둘인 항목은 없다(ADR-0039 앵커 줄 58·72·162 / 설계서 515·655·659·660·895·951·1202·1376·1395·1416 / 요구사항 340·375·566·567·610 / UI 명세 420·427 / 개발명세서 410 / 시험항목 1109·1138 — 파일마다 모두 다르다).
> 코드 변경은 이 파일의 범위가 아니다(설계서 §9 체크리스트). **`CLAUDE.md`는 이 패치의 대상이 아니다.**
> 항목 수: ADR-0039 3(H-1~H-3) · 환경 분리 설계서 10(J-1~J-10) · 환경 분리 요구사항 5(K-1~K-5) · 환경 분리 UI 명세 2(L-1·L-2) · 개발명세서 1(A-1) · (test-automation 소관·선택) 시험항목 2(M-1·M-2) = **23건**

---

## H. `docs/02-spec/decisions/ADR-0039-environment-pointers-version-serving-and-content-addressed-vector-retention.md`

### H-1. 결정 5 — 롤백 완화 범위 각주(N40-1) (58행 끝)

**찾을 원문**
````text
자동 롤백 없음(ADR-0032 판단 유지).
````
**바꿀 내용**
````text
자동 롤백 없음(ADR-0032 판단 유지). ※ **[N40-1 수정 2026-10-01]** 차단 게이트를 경고로 낮추는 완화는 **직전 운영 버전(`pickRollbackTarget()` 결과)으로의 롤백에만** 적용한다. 롤백 API가 받는 그 밖의 운영 이력 버전 복귀는 허용하되 일반 전환(`SWITCH`)과 같은 게이트를 받는다(`ProdSwitchService.resolveGateKind()` — 순수 함수 `evaluateProdSwitchGate()`는 불변 · 2인 승인 롤백 예외와 같은 "직전" 정의 · `n40-follow-up-설계.md` §2).
````

### H-2. 결정 7 — 끄기 `PROMOTE_DRAFT`의 차단 게이트(N40-3) (72행 끝)

**찾을 원문**
````text
— `restore()`의 세 번째 호출부를 만들지 않는다.
````
**바꿀 내용**
````text
— `restore()`의 세 번째 호출부를 만들지 않는다. ※ **[N40-3 2026-10-01]** 끄기 "초안을 운영으로"(`PROMOTE_DRAFT`)는 게이트가 **차단 모드**이고 초안 `contentHash` ≠ 운영 버전 `contentHash`이면 `409 ENV_GATE_NOT_PASSED`(`details.reason=PROMOTE_DRAFT_BLOCKED`)로 거부한다. 초안은 버전 id가 없어 게이트로 평가할 수 없으므로 평가 없이 막고, 정식 경로(스테이징 승격 → 운영 전환)를 안내한다(아래 갱신 2026-10-01 · `n40-follow-up-설계.md` §3).
````

### H-3. 문서 끝 — 갱신 절 추가 (162행 뒤 · append)

**찾을 원문**
````text
정책은 기존 `ChatbotEnvironment`.
````
**바꿀 내용**
````text
정책은 기존 `ChatbotEnvironment`.


---

## 갱신 (2026-10-01 — No.40 후속 결함 N40-1·N40-3: 롤백 게이트 완화 = 직전 버전만 · 끄기 `PROMOTE_DRAFT`는 차단 게이트에서 초안≠운영이면 거부)

근거: `docs/04-test/결함분류-2026-10-01.md` N40-1·N40-3 · PM 결정(2026-09-30 — No.36과 분리해 별도 수정, N40-3은 안 A) · 세부 설계 `docs/02-spec/n40-follow-up-설계.md`. 결정 1~8과 No.36 갱신은 **불변**이다. 게이트가 경고 모드(기본값 포함)인 챗봇의 동작은 한 바이트도 바뀌지 않는다.

1. **(N40-1 — 결정 5 보정 · 코드 반영 완료)** "롤백 = 직전 운영 버전으로의 전환"이라는 결정 문구와 달리 구현은 운영 이력 전체를 롤백 대상으로 받고 모두 BLOCK→WARN으로 낮췄다. 대상 허용 범위(`isSwitchTargetAllowed`)는 그대로 두고, **게이트 완화만 직전 운영 버전 롤백으로 좁힌다**. 서비스가 순수 함수에 넘기는 `kind`를 `resolveGateKind()`로 정한다. 직전이면 `ROLLBACK`, 아니면 `SWITCH`다. 2인 승인 롤백 예외(No.36 갱신 3.)와 같은 집합이다. API 계약·순수 함수·기존 시험 기대값 변경 0.
2. **(N40-3 — 결정 7 보정)** 끄기는 "전환 이외의 경로"로 보고 게이트를 정의하지 않았다. 그 결과 차단 게이트 챗봇에서도 `PROMOTE_DRAFT`가 시험하지 않은 초안을 곧바로 라이브로 만들었다. 게이트가 **차단 모드**이고 **초안 `contentHash` ≠ 운영 버전 `contentHash`**(`KEEP_PROD`의 `ENV_DRAFT_NOT_RESTORED`와 같은 기준 — `tiebreakHash` 제외)이면 확정을 `409 ENV_GATE_NOT_PASSED`로 거부한다. `details`는 `[{ field: 'reason', message: 'PROMOTE_DRAFT_BLOCKED' }]`다. 기존 코드를 재사용하며 운영 전환 경로의 응답은 불변이다. 차단 모드여도 초안 = 운영이면 허용하고(라이브 내용 불변), `KEEP_PROD`도 허용한다.
3. **판정 위치**: 끄기 확정 트랜잭션 안이다. 2인 승인 정책 검사 → 기대 포인터·초안 해시 검사 → `decideDisable` 다음 순서로 둔다. 게이트 모드는 정책 검사와 같은 환경 행 조회에서 읽는다(조회 추가 0). 판정은 신규 순수 함수 `decidePromoteDraftGate()`(`environment/lib/promote-draft-gate.ts`)가 한다. **`decideDisable`은 불변**이다. 미리보기는 같은 함수로 선택 키 `promoteDraftBlocked: true`를 계산하며, 해당할 때만 키가 실린다(응답 바이트 불변 규약).
4. **게이트를 평가하지 않는 이유**: 게이트는 "대상 버전을 대상으로 한 최근 성공 TC 실행"을 본다. 초안은 버전이 아니다. 해시가 같은 버전을 대리로 평가하는 방식은 동점 보조 필드 차이로 TC 결과가 달라질 수 있고(결정 3), 끄기 안에서 TC를 실행하는 방식은 비동기 상태 기계가 새로 필요하다. 게이트를 거친 정식 경로(승격 → 전환)가 이미 있으므로 "막고 안내"가 가장 작고 결정적인 해법이다.
5. **감수하는 비용**: 게이트를 `BLOCK → WARN`으로 낮춘 뒤 `PROMOTE_DRAFT`로 끄는 명시적 경로는 남는다. 게이트 설정 변경은 `chatbot:deploy` 1인 동작이며 감사가 남는다. 운영 전환도 같은 방법으로 우회할 수 있으므로 기존 신뢰 모델과 같은 수준이다. 더 강한 통제는 2인 승인이다(N36-1 결정과 같은 축).
6. 마이그레이션 0 · 신규 오류 코드 0 · 신규 권한 0 · `packages/dialogue-engine`·`apps/widget`·`apps/ml-worker` 변경 0 · 기존 시험 기대값 변경 0(닫힌 목록 — `n40-follow-up-설계.md` §8).
````

---

## J. `docs/02-spec/environment-separation-설계.md`

### J-1. §4.1 끄기 미리보기 스키마 — 선택 필드 추가 (515행 뒤)

**찾을 원문**
````text
  potentialTieShift: z.boolean(),        // 동점 노드가 있어 "운영 유지" 후 라이브 동점 승자가 달라질 수 있음(§27 L-6)
````
**바꿀 내용**
````text
  potentialTieShift: z.boolean(),        // 동점 노드가 있어 "운영 유지" 후 라이브 동점 승자가 달라질 수 있음(§27 L-6)
  promoteDraftBlocked: z.literal(true).optional(),   // [N40-3] 차단 게이트 ∧ 초안≠운영(contentHash) — 해당할 때만 키(n40-follow-up-설계.md §3.7)
````

### J-2. §5.4 미리보기 설명 — 필드 추가 (655행 끝)

**찾을 원문**
````text
동점 이동 가능성(`potentialTieShift`).
````
**바꿀 내용**
````text
동점 이동 가능성(`potentialTieShift`). **[N40-3]** 게이트가 차단 모드이고 초안 해시 ≠ 운영 해시면 `promoteDraftBlocked: true`(해당할 때만 키 — 게이트 모드는 기존 `getPointerStatus()` 결과를 재사용해 조회 추가 0).
````

### J-3. §5.4 콘솔 흐름 3 — 차단 게이트 안내 (659행 끝)

**찾을 원문**
````text
— 끄는 순간 초안이 라이브가 된다.
````
**바꿀 내용**
````text
— 끄는 순간 초안이 라이브가 된다. **단 미리보기에 `promoteDraftBlocked`가 있으면(차단 게이트 ∧ 초안≠운영) 콘솔은 이 선택지를 비활성화하고 "스테이징 승격 → 운영 전환"을 안내한다**(N40-3 · `n40-follow-up-설계.md` §4).
````

### J-4. §5.4 확정 순서 — 게이트 판정 단계 삽입 (660행)

**찾을 원문**
````text
**`409 ENV_DRAFT_NOT_RESTORED`**(콘솔이 2단계를 다시 수행)
````
**바꿀 내용**
````text
**`409 ENV_DRAFT_NOT_RESTORED`**(콘솔이 2단계를 다시 수행) → **[N40-3]** `decidePromoteDraftGate()`: `PROMOTE_DRAFT` ∧ 게이트 `BLOCK`(트랜잭션 안 환경 행 `gateMode` — 2인 승인 검사와 같은 조회에서 읽는다) ∧ 초안 해시 ≠ 운영 `contentHash` → **`409 ENV_GATE_NOT_PASSED`**(`details.reason=PROMOTE_DRAFT_BLOCKED` — `n40-follow-up-설계.md` §3.4)
````

### J-5. §9.3 확정 ③ — 게이트 종류(N40-1) (895행)

**찾을 원문**
````text
③ gate BLOCK ∧ kind = SWITCH → 409 ENV_GATE_NOT_PASSED (롤백은 경고만 — FR-EN4-4)
````
**바꿀 내용**
````text
③ gate BLOCK ∧ gateKind = SWITCH → 409 ENV_GATE_NOT_PASSED (gateKind = ROLLBACK은 kind = ROLLBACK ∧ 대상 = 직전 운영 버전일 때만 — 그 롤백만 경고로 낮춘다 · 그 밖의 이력 버전 롤백은 SWITCH와 같은 게이트 — N40-1 수정 2026-10-01 · FR-EN4-4)
````

### J-6. §10 게이트 — 롤백 완화 적용 범위(N40-1)·끄기 비적용(N40-3) (951행 끝)

**찾을 원문**
````text
(긴급 복귀 우선 — FR-EN4-4 · AC-EN6-6).
````
**바꿀 내용**
````text
(긴급 복귀 우선 — FR-EN4-4 · AC-EN6-6). **[N40-1 수정 2026-10-01]** 서비스는 `kind = ROLLBACK`을 **직전 운영 버전 롤백**(`pickRollbackTarget()` 결과)일 때만 넘기고(`ProdSwitchService.resolveGateKind()`), 그 밖의 이력 버전 롤백은 `SWITCH`로 평가한다. 이 함수 자체는 불변이다(AC-EN6-7). 끄기 `PROMOTE_DRAFT`는 이 함수를 부르지 않는다. 초안은 평가 대상이 아니므로 차단 모드에서 초안≠운영이면 평가 없이 거부한다(N40-3 · `n40-follow-up-설계.md` §3).
````

### J-7. §19.3 오류 코드 표 — `ENV_GATE_NOT_PASSED` 조건 (1202행)

**찾을 원문**
````text
| `ENV_GATE_NOT_PASSED` | 409 | 차단 게이트 미달·설정 오류(운영 전환만) |
````
**바꿀 내용**
````text
| `ENV_GATE_NOT_PASSED` | 409 | 차단 게이트 미달·설정 오류(운영 전환 · 직전이 아닌 이력 버전 롤백 — N40-1) · 모드 끄기 `PROMOTE_DRAFT`에서 차단 게이트 ∧ 초안≠운영(`details: [{ field: 'reason', message: 'PROMOTE_DRAFT_BLOCKED' }]` — N40-3 · 신규 코드 0) |
````

### J-8. §27 알려진 제한 — L-11 추가 (1376행 뒤)

**찾을 원문**
````text
2차 서버 간 이관(P-1 (d)) |
````
**바꿀 내용**
````text
2차 서버 간 이관(P-1 (d)) |
| L-11 | (N40-3) 차단 게이트를 `BLOCK → WARN`으로 낮춘 뒤 "초안을 운영으로" 끄기는 가능하다 · 경고 모드에서 "초안을 운영으로"는 게이트 경고 없이 진행된다 | 게이트 설정 변경은 `chatbot:deploy` + 감사(운영 전환과 같은 신뢰 모델) · 강한 통제는 2인 승인 · 경고 모드 안내 추가는 PM 확인 Q-1(`n40-follow-up-설계.md` §10) |
````

### J-9. §27.2 뒤 — 27.3 결함 후속 절 추가 (1395행 뒤)

**찾을 원문**
````text
`embedMissing()`의 P2002 처리는 설계 허용 범위 — 변경 없음 | — | — |
````
**바꿀 내용**
````text
`embedMissing()`의 P2002 처리는 설계 허용 범위 — 변경 없음 | — | — |

### 27.3 결함 후속 N40-1·N40-3 (2026-10-01 — `docs/04-test/결함분류-2026-10-01.md`)

| # | 결함 | 수정 | 상태 |
|---|---|---|---|
| N40-1 | 롤백이 임의 이력 버전에도 차단 게이트를 경고로 낮춤(ADR-0039 §5 문구와 괴리) | 게이트 완화 = 직전 운영 버전 롤백만(`resolveGateKind()`) · 순수 함수·API 계약 불변 | 코드 반영 완료(2026-10-01) · 문서 = 이 패치 |
| N40-3 | 끄기 `PROMOTE_DRAFT`가 게이트 없이 초안을 라이브로 | 차단 게이트 ∧ 초안≠운영 → `409 ENV_GATE_NOT_PASSED` · 미리보기 `promoteDraftBlocked` · 대화상자 안내 | 설계 완료 → `n40-follow-up-설계.md` |
````

### J-10. §28 요구사항 대비 해석 — R-15·R-16 추가 (1416행 뒤)

**찾을 원문**
````text
`AuditAction` 14 불변(T-10) |
````
**바꿀 내용**
````text
`AuditAction` 14 불변(T-10) |
| R-15 | FR-EN4-4 "롤백(직전 또는 이력 중 선택) · 게이트는 경고만" | 경고 완화는 **직전 운영 버전 롤백만** · 이력 중 선택한 그 밖의 버전은 일반 전환 게이트(N40-1) | ADR-0039 §5 "롤백 = 직전 운영 버전" · 차단 게이트 우회 방지 · 2인 승인 예외와 같은 집합 |
| R-16 | FR-EN1-3 ② "초안을 운영으로(차이 미리보기 확인 후 끔)" · AC-EN1-5 | 게이트 **차단 모드 ∧ 초안≠운영**이면 거부(`ENV_GATE_NOT_PASSED`) · 경고 모드는 현행 | 차단 게이트의 약속을 끄기 입구에도 적용(N40-3) · PM 결정 2026-09-30 안 A |
````

---

## K. `docs/requirements/environment-separation.md`

### K-1. AC-EN1-5 — 게이트 경고 모드로 한정 (566행)

**찾을 원문**
````text
- **AC-EN1-5** Given 같은 조건, When "초안을 운영으로"로 끄기, Then 공개 응답이 초안 기준이 되고 이력에 `DISABLE`이 남는다.
````
**바꿀 내용**
````text
- **AC-EN1-5** Given 같은 조건 · 게이트 경고 모드(기본값 포함), When "초안을 운영으로"로 끄기, Then 공개 응답이 초안 기준이 되고 이력에 `DISABLE`이 남는다. (차단 게이트는 AC-EN1-7·AC-EN1-8 — N40-3 수정 2026-10-01)
````

### K-2. AC-EN1-7·AC-EN1-8 추가 (567행 뒤)

**찾을 원문**
````text
- **AC-EN1-6** Given `ARCHIVED` 챗봇, When 켜기, Then `409`.
````
**바꿀 내용**
````text
- **AC-EN1-6** Given `ARCHIVED` 챗봇, When 켜기, Then `409`.
- **AC-EN1-7** ★ (N40-3) Given 초안이 운영과 다른 챗봇 · 게이트 차단 모드 · 2인 승인 꺼짐, When "초안을 운영으로"로 끄기, Then `409 ENV_GATE_NOT_PASSED`(`details.reason = PROMOTE_DRAFT_BLOCKED`) · 모드 켜짐 유지(포인터·스테이징·이력·예약 불변) · 감사 0건 · 공개 응답은 운영 버전 기준이고, 미리보기에 `promoteDraftBlocked: true`가 있으며 콘솔은 그 선택지를 비활성화하고 "스테이징 승격 → 운영 전환"을 안내한다.
- **AC-EN1-8** (N40-3) Given 게이트 차단 모드, When (a) 초안 = 운영(내용 해시 같음)에서 "초안을 운영으로" 또는 (b) 초안≠운영에서 "운영 유지"로 끄기, Then 둘 다 성공한다.
````

### K-3. FR-EN1-3 ② — 차단 게이트 예외 (340행)

**찾을 원문**
````text
② 초안을 운영으로(차이 미리보기 확인 후 끔).
````
**바꿀 내용**
````text
② 초안을 운영으로(차이 미리보기 확인 후 끔 — 단 게이트가 차단 모드이고 초안이 운영과 다르면 거부하고 "스테이징 승격 → 운영 전환"을 안내한다, N40-3 2026-10-01).
````

### K-4. FR-EN4-4 — 롤백 완화 = 직전 버전만 (375행)

**찾을 원문**
````text
(차단 게이트를 롤백에 적용하지 않는다 — 긴급 복귀 우선).
````
**바꿀 내용**
````text
(차단 게이트를 **직전 운영 버전** 롤백에 적용하지 않는다 — 긴급 복귀 우선). 이력 중 직전이 아닌 버전을 고른 롤백은 일반 전환과 같은 게이트를 받는다(N40-1 수정 2026-10-01 — ADR-0039 §5 각주).
````

### K-5. AC-EN6-6 한정 + AC-EN6-7 추가 (610행)

**찾을 원문**
````text
- **AC-EN6-6** Given 차단 게이트, When 롤백, Then 게이트 경고만 표시되고 성공한다.
````
**바꿀 내용**
````text
- **AC-EN6-6** Given 차단 게이트, When **직전 운영 버전으로** 롤백, Then 게이트 경고만 표시되고 성공한다.
- **AC-EN6-7** (N40-1) Given 차단 게이트 · 운영 이력에 직전이 아닌 과거 버전(그 버전 대상 TC 미달 또는 실행 없음), When 그 버전으로 롤백, Then 미리보기 `GATE_BLOCKED` · 확정 `409 ENV_GATE_NOT_PASSED` · 운영 불변.
````

---

## L. `docs/03-design/environment-separation-ui-spec.md` (§4.4 EN1-b 끄기 대화상자)

### L-1. (B) 초안 ≠ 운영 설명 — 차단 게이트 상태 추가 (420행 앞 · prepend)

**찾을 원문**
````text
`potentialTieShift`(§27 L-6, `KEEP_PROD`에만 해당) 경고는
````
**바꿀 내용**
````text
**(N40-3 · 2026-10-01) 차단 게이트 상태**: 미리보기에 `promoteDraftBlocked: true`가 있으면 라디오 2개를 유지하되 "초안을 운영으로" 라디오에 `disabled`를 주고, 바로 아래에 안내 문구 `promoteDraftBlockedHint`("차단 게이트가 켜져 있어 선택할 수 없습니다. 초안을 운영에 반영하려면 스테이징으로 승격한 뒤 운영 전환(필수 시험 통과)을 거쳐 주세요.")를 `field-hint`(`id` 부여)로 두고 라디오의 `aria-describedby`로 연결한다. 기본 선택은 "운영 유지" 그대로다. 확정 응답이 `409 ENV_GATE_NOT_PASSED`면(미리보기 이후 게이트가 차단으로 바뀐 경합) `role="alert"` 배너에 `promoteDraftBlockedError`("그사이 차단 게이트가 켜져 초안을 바로 운영으로 올릴 수 없습니다. '운영 유지'로 끄거나, 스테이징 승격 후 운영 전환을 거쳐 주세요.")를 띄우고, 선택을 "운영 유지"로 되돌린 뒤 미리보기를 다시 불러온다(복원은 자동 실행하지 않는다). `approvalPolicyActive`가 함께 있으면 정책 잠금 안내가 우선이다(`n40-follow-up-설계.md` §4).

`potentialTieShift`(§27 L-6, `KEEP_PROD`에만 해당) 경고는
````

### L-2. 컴포넌트 분해 — 라디오 그룹 행 (427행)

**찾을 원문**
````text
| 라디오 그룹 | `mode: 'KEEP_PROD'｜'PROMOTE_DRAFT'`, 방향키 탐색(UIUX §6) |
````
**바꿀 내용**
````text
| 라디오 그룹 | `mode: 'KEEP_PROD'｜'PROMOTE_DRAFT'`, 방향키 탐색(UIUX §6) · (N40-3) `preview.promoteDraftBlocked`면 `PROMOTE_DRAFT` 라디오 `disabled` + `aria-describedby` → 안내 문구 |
````

---

## A. `docs/02-spec/개발명세서.md`

### A-1. §4 API 정정 이력(환경 분리) — 후속 수정 기록 (410행 끝)

**찾을 원문**
````text
공개 경로 8곳 불변(`environment-separation-설계.md` §19).
````
**바꿀 내용**
````text
공개 경로 8곳 불변(`environment-separation-설계.md` §19). ⑤ **(2026-10-01 No.40 후속 N40-1·N40-3)** 경로 추가 0 · 오류 코드 추가 0 — 직전이 아닌 이력 버전 롤백은 일반 전환과 같은 게이트를 받고, 끄기 `PROMOTE_DRAFT`는 차단 게이트 ∧ 초안≠운영이면 `409 ENV_GATE_NOT_PASSED`이며, 끄기 미리보기에 선택 필드 `promoteDraftBlocked`가 추가됐다(`n40-follow-up-설계.md`).
````

---

## M. (test-automation 소관 · 선택) `docs/04-test/시험항목.md` — **LF 파일**

### M-1. AC-EN1-5 행 한정 + AC-EN1-7·8 행 추가 (1109행)

**찾을 원문**
````text
| AC-EN1-5 | "초안을 운영으로"(PROMOTE_DRAFT) 끄기 — 공개 응답이 초안 기준, 이력 `DISABLE` | 〃(S-1, 신규) | 통합 |
````
**바꿀 내용**
````text
| AC-EN1-5 | "초안을 운영으로"(PROMOTE_DRAFT) 끄기(게이트 경고 모드) — 공개 응답이 초안 기준, 이력 `DISABLE` | 〃(S-1, 신규) | 통합 |
| AC-EN1-7 | (N40-3) 차단 게이트 + 초안≠운영 + PROMOTE_DRAFT → 409 `ENV_GATE_NOT_PASSED`(`PROMOTE_DRAFT_BLOCKED`) · 포인터·이력·예약·감사 불변 · 미리보기 `promoteDraftBlocked` | 〃(N40-3 블록, 신규) | 통합 |
| AC-EN1-8 | (N40-3) 차단 게이트에서 초안=운영 PROMOTE_DRAFT · 초안≠운영 KEEP_PROD → 성공 | 〃(N40-3 블록, 신규) | 통합 |
````

### M-2. AC-EN6-6 행 한정 + AC-EN6-7 행 추가 (1138행)

**찾을 원문**
````text
| AC-EN6-6 | 차단 게이트 + 롤백 → 경고만 표시, 성공 | 〃(S-7, 신규) | 통합 |
````
**바꿀 내용**
````text
| AC-EN6-6 | 차단 게이트 + 직전 운영 버전 롤백 → 경고만 표시, 성공 | 〃(S-7, 신규) | 통합 |
| AC-EN6-7 | (N40-1) 차단 게이트 + 직전이 아닌 이력 버전 롤백 → 미리보기 `GATE_BLOCKED` · 409 `ENV_GATE_NOT_PASSED` · 운영 불변 | 〃("N40-1.", 반영됨) | 통합 |
````
