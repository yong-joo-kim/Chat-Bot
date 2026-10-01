# PM 결정(2026-10-01) 반영 — 결함 K-1b · N36-1 · L-2 · L-5 수정 설계

> **작성**: system-architect · 2026-10-01 (같은 날 갱신 ① PM 답변 U-1 "생년월일 문맥 예외" 확정 · U-4 수용 ② 코드 리뷰 + PM 결정 "구분 문자와 키워드 목록을 넓힘" — 문맥 예외 2차 확장)
> **입력**: `docs/04-test/결함분류-2026-10-01.md`(K-1b · N36-1 · L-2 · L-5 항목·권고·영향 범위) + 2026-10-01 PM 결정 4건 + PM 답변(U-1·U-4) + 구현 코드 리뷰(보통 1·2, 낮음 4·5·6)
> **근거로 읽은 문서·코드(전체)**: ADR-0026 · ADR-0048 · ADR-0013(No.36 갱신) · `ai-guardrails-설계.md` · `data-governance-설계.md` §12 · `docs/requirements/data-governance.md` FR-0-161·FR-DG9-3·AC-DG8-3 · `docs/requirements/ai-guardrails.md` FR-0-309·FR-AG9-2 · `packages/pii-mask/src/index.ts`(L-5 구현 반영본) · 골든 말뭉치(`__golden__/storage-corpus.json` 306문장 · `birth-context-corpus.json` 66문장 · 관련 spec 전부) · `apps/api/src/augmentation/**` · `apps/api/src/environment/approval/switch-approval.service.ts` · `config/env.validation.ts` · `maskPii(` 호출자 전수(grep)
> **결정 기록**: `docs/02-spec/decisions/ADR-0049-pm-2026-10-01-augmentation-g1-fallback-governance-approval-off-lock-and-storage-mask-date-exclusion.md`(신규 — ADR-0048 §4·§5 일부와 ADR-0013 No.36 갱신 2항 일부를 **부분 대체**)
> **상위 문서 패치**: `…-patches.md`(적용 완료) · `…-patches-2.md`(적용 완료) · `…-patches-3.md`(문맥 예외 2차 확장 반영 · 결함 후보 등록 — 적용 대기). CRLF 문서는 직접 수정하지 않고 패치로만 — 앵커 1회 일치 확인 완료
> **범위 원칙**: 코드는 이 문서가 아니라 backend-implementer(주)·frontend-implementer(소)가 작성한다. `CLAUDE.md`는 대상이 아니다. **마이그레이션 0 · 새 테이블/컬럼 0 · 새 권한 0 · 새 외부 출구 0 · 엔진·위젯·채널 어댑터·ml-worker 변경 0.**

---

## 0. 한눈에 보기

| # | PM 결정 | 이 설계의 핵심 | 코드 변경 | 마이그레이션 | 기존 시험 기대값 변경(닫힌 목록) | 담당 |
|---|---|---|---|---|---|---|
| **K-1b** | G1 폴백을 **실제로 구현** | 러너가 G2/G3의 "사용 가능한 후보 0건"을 감지하면 팩토리가 주는 G1으로 **같은 Job 안에서 1회** 다시 생성. 결과 요약에 `degraded:true`(기존 필드) + 선택 필드 `fallbackFrom`·`fallbackCause`. 제안 행은 기존 `providerId='rule'` | api 6파일(포트·local·gemini·팩토리·러너·서비스) · shared-types 1 · web 2(안내 1줄) | 0 | **0건** | backend → frontend |
| **N36-1** | 거버넌스 모드 ON이면 2인 승인 끄기 **기본 잠금** | `ENV_APPROVAL_OFF_LOCKED`를 3상태(미설정/true/false)로. **명시값 우선**, 미설정이면 `DATA_GOVERNANCE_MODE=ON`일 때 잠금. 판정은 순수 함수 1개. 현황 응답 `offLocked` 재사용 + 선택 필드 `offLockedBy` | api 4파일 · shared-types 1 · web 2(문구 분기) | 0 | **1건**(`env.validation.guardrails.spec.ts` 기본값 단언) | backend → frontend |
| **L-2** | 현행 수용 | 코드 변경 없음. ADR-0048 알려진 한계 4에 "2026-10-01 PM 수용" 기록 | 0 | 0 | 0 | 문서만 |
| **L-5** | 저장 마스킹도 **날짜 제외** + **(U-1) 생년월일 문맥이면 예전처럼 가림**(2차: 구분 문자·키워드 확장) · (U-4) 원본 파일 게이트 완화 수용 | `maskPii()` 기본 경로의 계좌 치환 1곳에서 `YYYY-MM-DD` 독립 날짜를 건너뜀. **단 바로 앞 낱말이 닫힌 키워드 7개로 시작하고 사이가 구분 문자 ≤6(+ `(양력)`류 주석 1)이면 v1과 바이트 동일한 `[계좌번호]`**(출구에도 같은 예외). `preserveDates`는 **기본값을 true로 뒤집어 통합**. 골든은 **v1 동결 + 날짜 케이스만 갱신 + 차분 증명** + **손 작성 문맥 골든**. 과거 기록 재마스킹 없음 | pii-mask 1파일 · api 1파일(기동 로그) | 0 | **4건** — 2차 확장으로 증감 없음(이번 작업 중 새로 쓴 문맥 골든은 별도로 2건 변경 — §5.11) | backend(+ test-automation 골든 절차) |

남은 PM 확인은 §7(U-1·U-4 확정, U-12·U-13·**U-14** 확인 대기).

---

## 1. 공통 원칙

1. **문서 선행**: 이 문서 + ADR-0049 + 패치 적용이 코드보다 먼저다(`오류검출_프로세스.md` §4). 패치 중 CRLF 파일은 git-manager 또는 부분 편집 가능한 세션이 적용한다.
2. **닫힌 목록**: 각 결정의 "기존 시험 기대값 변경"은 아래 목록이 전부다. 구현 후 전체 회귀에서 목록 밖 실패가 나오면 **고치지 말고 멈춰서 보고**한다(선행 그룹 규약).
3. **바이트 동일 원칙의 범위**: K-1b·N36-1은 "기능이 발동하지 않는 경로"의 응답·저장·로그가 지금과 바이트 동일해야 한다(새 키는 발동할 때만 싣는다). L-5는 **의도적으로** 저장 결과를 바꾸는 결정이며, 그 차이가 "생년월일 문맥이 아닌 독립 날짜 구간"(+ §5.5-4의 날짜에 붙은 이메일)에만 한정됨을 시험으로 증명한다.
4. **빌드 순서**: `packages/pii-mask`와 `packages/shared-types`는 `apps/api`가 `dist`로 소비한다(`@chat-bot/pii-mask` → `dist/index.js`, jest `moduleNameMapper` 없음). 변경 후 `pnpm --filter @chat-bot/pii-mask build` · `pnpm --filter @chat-bot/shared-types build`를 **api 시험보다 먼저** 실행한다.

---

## 2. K-1b — 증강 생성 호출 실패 시 G1 폴백 실구현

### 2.1 현상(코드 확인)

- `local-augmentation.provider.ts:56-58`·`gemini-augmentation.provider.ts:69-73`: 실패하면 "G1로 폴백합니다" 로그만 남기고 `[]`를 돌려준다.
- `augmentation-job.runner.ts:142-147`(K-1 수정 후 줄 번호): 후보 0건이면 `PARTIAL { generated:0, accepted:0, rejected:{}, providerId }`로 끝난다. G1을 다시 부르는 코드가 없다.
- 실제 G1 저하는 팩토리의 **설정 누락(키·주소 없음)** 뿐이다(`augmentation-provider.factory.ts:61-63, 76-78`). 헬스 불량(`UNHEALTHY`)은 `getCapability()`의 **보고**일 뿐 `getProvider()`는 여전히 G2/G3를 돌려준다.
- 결과 요약 스키마에는 이미 `degraded`·`degradeReason`이 있고(`shared-types/learning.ts` `AugmentationRunResultSchema`), 목록 서비스가 JSON에서 읽는다(`augmentation.service.ts:152-159`). 그러나 러너는 이 키를 **한 번도 쓰지 않는다**(항상 `degraded:false`로 읽힘).
- 웹 증강 패널은 `runResult.degraded`를 보지 않는다. 제안 행에는 `ProviderBadge`(`rule`→"규칙 기반")가 이미 붙는다.

### 2.2 결정 요약

| 항목 | 결정 |
|---|---|
| 폴백 위치 | **러너 1곳**. Provider는 계속 "실패 = 빈 결과"로 수렴(C-1 불변)하고, **원인 코드만 추가로 보고**한다 |
| 폴백 대상 | 팩토리가 주는 G1(`getFallbackProvider()` — 교체 지점 1곳 유지). 러너가 `RuleBasedAugmentationProvider`를 직접 `new`하지 않는다 |
| 발동 조건 | 설정된 Provider가 `gemini`·`local`이고 **사용 가능한 후보(공백 아닌 문자열)가 0건**일 때. 원인 무관(네트워크·타임아웃·4xx·5xx·형식 오류·빈 결과·회로 open·출구 차단·시드 금지어 모두) |
| 발동하지 않음 | `rule`·`mock` 구성(G1·시험용 자체) · G2/G3가 1건이라도 쓸 수 있는 후보를 낸 경우(부분 성공 — §2.4) |
| 폴백 횟수 | Job당 **최대 1회**. G1도 0건이면 그대로 `PARTIAL`(기존 모양 + 폴백 표식) |
| 재시도 | G2/G3 **재시도 0**(§2.10) |
| 표시 | 결과 요약: `providerId:'rule'` + `degraded:true`(기존 필드) + 선택 `fallbackFrom`·`fallbackCause`. 제안 행: 기존 `providerId='rule'`. 화면: FR-L1-7 문구 1줄 |
| 자산 영향 | 없음 — 폴백 결과도 검증 5종 → `AugmentationSuggestion(PENDING)` → 관리자 승인 경로 그대로 |

### 2.3 발동 조건과 원인 코드(구분 표)

Provider가 보고하는 원인(`fallbackCause`)은 **표시·로그용**이며 폴백 여부를 바꾸지 않는다(모든 실패는 G1로 수렴 — ADR-0026 §2 원문).

| 원인 코드 | 판정 위치 | 판정 기준 | 폴백 |
|---|---|---|---|
| `TIMEOUT` | local·gemini | 자체 `AbortController` 타이머 만료로 `fetch`가 중단(`AUGMENTATION_TIMEOUT_MS`, 기본 30초) | ○ |
| `NETWORK` | local·gemini | 그 밖의 `fetch` 거부(연결 거부·DNS 실패·소켓 종료) | ○ |
| `HTTP_4XX` | local·gemini | 응답 400~499(ml-worker 시드/건수 계약 위반 등 — K-1 이후에도 남은 계약 오류 가능성을 드러낸다) | ○ |
| `HTTP_5XX` | local·gemini | 응답 500 이상, 또는 모드 OFF에서 예기치 않은 3xx 등 **그 밖의 비정상 상태** | ○ |
| `INVALID_RESPONSE` | local·gemini | 본문 JSON 파싱 실패 · zod 스키마 불일치 | ○ |
| `EGRESS_BLOCKED` | local·gemini | `EgressBlockedError`(거버넌스 출구 허용 목록 밖 · 모드 ON 리다이렉트) | ○ |
| `CIRCUIT_OPEN` | gemini · local(⚠ 2026-10-01 후속 — ADR-0050 §2: 공유 회로) | 회로 open 중 호출 생략 | ○ |
| `SEED_BLOCKED` | gemini | 마스킹된 시드에 금지어 → 외부 송신 생략(FR-L1-6 ②) | ○(G1은 외부 송신이 없고 검증 ④가 금지어 후보를 탈락시킨다) |
| `NOT_CONFIGURED` | gemini | 방어적 이중 확인에서 키 없음(팩토리가 보통 막음) | ○ |
| `EMPTY_RESULT` | **러너** | Provider가 실패를 보고하지 않았는데 후보가 0건이거나 전부 공백 문자열(`trim()` 후 빈 값) | ○ |

- **형식 오류의 두 층**: 응답 봉투가 스키마와 다르면 `INVALID_RESPONSE`(폴백). 봉투는 맞는데 **개별 후보**가 이상하면(길이·제어문자·한국어 아님) 폴백하지 않고 기존 검증 ⑤(`INVALID_FORMAT`)가 탈락시킨다 — 단 **전부 공백**이면 사용할 후보가 없으므로 `EMPTY_RESULT`로 폴백한다.
- Gemini의 `parseCandidateArray()`가 줄 단위 폴백으로 잡문을 후보로 만들면 "사용 가능한 후보 ≥1"이 되어 폴백하지 않는다 — 의미 검증이 걸러낸다(ADR-0026 §4 "응답 신뢰" 그대로).

### 2.4 부분 성공 — 보충하지 않는다

G2/G3가 **1건이라도** 사용 가능한 후보를 내면 G1으로 **보충하지 않는다**(요청 `rawTarget`보다 적어도).

- 근거 ① ADR-0026 §2의 폴백은 "실패의 수렴"이지 "부족분 보충"이 아니다. ② 경량 G3(ml-worker 1회 상한 20 — ADR-0046 §3)는 `rawTarget`(최대 60)보다 **항상 적게** 돌려주므로, 보충 규칙이면 경량 구성의 모든 Job이 G1 혼합이 되어 "G3 품질 실측"(No.17) 결과가 오염된다. ③ 한 Job 안에서 생성기가 섞이면 결과 요약 `providerId`가 1개라는 계약과 어긋난다.
- 화면은 이미 "생성 N건 중 M건 통과"를 보여 주므로 적은 건수가 조용히 숨겨지지 않는다.

### 2.5 포트 확장(선택 메서드 1개 — 기존 계약 불변)

`augmentation-provider.port.ts`(Nest·Prisma 무의존 유지 — C-5):

| 추가 요소 | 내용 |
|---|---|
| `type AugmentationFailureCause` | §2.3 표의 10개 문자열 유니온(`EMPTY_RESULT`는 러너만 씀) |
| `interface AugmentationGenerateOutcome` | `{ readonly candidates: readonly string[]; readonly failure?: AugmentationFailureCause }` |
| `AugmentationProvider.generateWithOutcome?(input)` | **선택 메서드**. 예외를 던지지 않는다(C-1과 동일). 실패면 `candidates: []` + `failure` |

- `generate()` 계약·서명 **불변**. `local`·`gemini`는 `generate()`를 `generateWithOutcome()`의 `candidates`만 돌려주는 얇은 위임으로 바꾼다 → 기존 `generate()` 호출 시험(리다이렉트 시험 2파일)이 그대로 통과한다.
- `rule`·`mock`은 구현하지 않는다(러너는 `generate()`로 대체 호출).
- **상태를 인스턴스에 저장해 원인을 전달하지 않는다**(예: `lastFailure` 필드 기각) — 팩토리 주석이 권장하는 싱글턴 재사용으로 바뀌면 동시 Job 사이에 원인이 섞인다. 반환값으로만 전달한다.
- 계약 규약 추가 **C-6**: "`generateWithOutcome()`의 `failure`는 폴백 여부를 결정하지 않는다(표시·로그 전용). 폴백 여부는 소비자가 후보 수로만 판정한다."

`augmentation-provider.factory.ts`:

| 추가 | 내용 |
|---|---|
| `getFallbackProvider(deps?)` | 항상 G1(`buildRule(deps)`)을 돌려준다. **설정과 무관**하며 예외를 던지지 않는다. `rule` 구성에서 G2/G3 인스턴스화 0(AC-L1-14)은 영향 없음(이 메서드는 G1만 만든다) |

### 2.6 러너 흐름(`augmentation-job.runner.ts` — 쓰기 대상 테이블 1개 불변)

1. `primary = factory.getProvider(deps)`(현행).
2. `outcome = primary.generateWithOutcome ? await primary.generateWithOutcome(input) : { candidates: await primary.generate(input) }`.
3. `usable = outcome.candidates.some(c => c.trim().length > 0)`.
4. `primary.providerId`가 `gemini`·`local`이고 `!usable`이면:
   - `cause = outcome.failure ?? 'EMPTY_RESULT'`
   - `fallback = factory.getFallbackProvider(deps)` → `candidates = await fallback.generate(input)`(같은 `seeds`·`targetCount`·`locale` — G1은 외부 송신이 없으므로 **마스킹하지 않은 시드**를 쓴다. `rule` 구성과 동일)
   - `used = fallback`, `fallbackInfo = { from: primary.providerId, cause }`
   - 경고 로그 1줄: `증강 G1 폴백: chatbotId=… intentId=… jobId=… from=local cause=TIMEOUT`(문장·URL·키 0 — NFR-LS4)
5. 그 밖에는 `used = primary`, `candidates = outcome.candidates`(현행 — 공백 후보도 그대로 검증 ⑤로 보낸다: 기존 `generated` 집계 의미 불변).
6. 이후 임베딩 → 검증 → 저장은 **현행 그대로**, 단 제안 행 `providerId`와 결과 요약 `providerId`는 `used.providerId`.
7. 결과 요약(`resultSummary` JSON — 문장 0):
   - 폴백 없음: **지금과 같은 키만**(`generated`·`accepted`·`rejected`·`providerId`). `degraded:false`를 새로 쓰지 않는다(바이트 동일).
   - 폴백 있음: 위 4키(`providerId:'rule'`) + `degraded:true` + `fallbackFrom` + `fallbackCause`. 0건 조기 반환(`PARTIAL`) 분기도 같은 키를 싣는다.
8. `status` 규칙 불변(`insertedCount > 0` → `SUCCEEDED`, 아니면 `PARTIAL`). 임베딩 실패는 여전히 `FAILED EMBEDDING_UNAVAILABLE`(폴백은 생성 단계에만 적용 — 검증 불가 시 거부 원칙 ADR-0025 불변).
9. (리뷰 낮음 6 — 결함 후보 **K-1d**, `patches-3` R-6) 폴백 G1 호출(`fallback.generate`)은 현재 try/catch 밖이다. `RuleBasedAugmentationProvider`는 내부에서 예외를 흡수하므로 지금 발생 경로는 없지만, 팩토리·향후 G1 변경으로 예외가 나면 Job 전체가 `FAILED`가 된다. **권고**: 폴백 호출을 try/catch로 감싸 예외 시 `candidates = []`(→ `PARTIAL` + 폴백 키 · `fallbackCause`는 1차 원인 유지)로 수렴. 기존 시험 기대값 변경 0.

### 2.7 결과 표시(기존 필드·코드 재사용 우선)

| 표면 | 변경 |
|---|---|
| `AugmentationSuggestion.providerId` | 폴백 행은 `'rule'`(기존 컬럼·기존 값). **새 컬럼 0** — 어느 Job에서 폴백했는지는 행의 `jobId` → 그 Job의 결과 요약으로 추적된다 |
| `TrainingJob.resultSummary` | §2.6-7(JSON 문자열 — 스키마 변경 0) |
| `shared-types` `AugmentationRunResultSchema` | 선택 필드 2개: `fallbackFrom?: 'gemini' \| 'local'` · `fallbackCause?: AugmentationFallbackCauseSchema`(§2.3의 10개 값 enum 신설). `degraded`·`degradeReason` **의미 불변**(`degradeReason`은 capability 전용 enum이라 폴백에 재사용하지 않는다) |
| `augmentation.service.ts` `list()` | JSON → `runResult` 조립에 두 키를 **enum 검증 후** 전달(알 수 없는 값은 버림). 폴백 없는 Job은 키 없음 |
| 웹 `AugmentationPanel` | `runResult.degraded && runResult.fallbackFrom`이면 결과 요약 문단 아래 `field-hint` 1줄: **"ⓘ 고급 증강을 사용할 수 없어 기본 방식으로 생성했습니다."**(FR-L1-7 원문 문구). 색상 단독 표시 금지 준수(아이콘 + 텍스트) · 새 live 영역 없음 · 원인 코드는 화면에 노출하지 않는다 |
| 감사 | **추가 없음** — 증강 생성은 원래 감사 대상이 아니며(승인만 감사 — `augmentation-accept.service.ts:125`) 폴백은 자산을 바꾸지 않는다 |
| 알림 | **추가 없음** — 알림 채널이 없다(No.41 2차). capability 배너(`UNHEALTHY`)가 지속 장애를, 이번 안내 1줄이 이번 Job의 저하를 알린다 |

### 2.8 불변 사항

- **중복·검증·승인 흐름 불변**: 폴백 후보도 `validateCandidates()` 5종 + 자기중복 + `@@unique([intentId, textNormalized])` 흡수 → `PENDING`. 자산 승격은 여전히 `POST …/accept` 1곳(`asset-write-sealing.spec.ts` S-1~S-6 불변).
- **AC-L1-14**: `rule` 구성에서 G2/G3 인스턴스화 0 — 불변(폴백은 G1만 만든다).
- **강제 5단계**(ADR-0026 §3): G2/G3 송신 경로 불변. G1은 `requiresNetwork=false`라 대상이 아니다.
- **ml-worker `/augment` 계약·`/augment/health` 불변**.

### 2.9 출구 게이트 · No.45 영향

- 출구 차단(`EgressBlockedError`)은 지금도 Provider의 `catch`가 흡수했고(ADR-0026 갱신 2026-09-26), 이번에는 `EGRESS_BLOCKED` 원인으로 **G1 결과를 실제로 채운다** — 새 출구·새 송신 0.
- 데이터 지도 표기 불변. 폴백은 출구가 아니므로 지도에 나타나지 않는다.
- 기동 검사(`AUGMENTATION_PROVIDER=local|gemini`면 해당 호스트가 허용 목록에 있어야 기동) 불변.

### 2.10 재시도 정책 · 회로차단(새 관찰 K-1c)

- **G2/G3 재시도 0**: 30초(ml-worker 원격 25초) 뒤 재시도하면 최악 60초 + 검증인데, 콘솔 폴링 상한이 60초라 "시간 초과" 안내로 끝난다. 폴백 1회(G1 ≤ 1초 — NFR-LP2)는 예산 안이다.
- **새 관찰 K-1c(이번 범위 밖 — 결함 후보로 등록 · `patches-3` R-6)**: 러너가 Job마다 `getProvider()`를 불러 **새 인스턴스**를 만들므로 Gemini의 회로차단 상태가 Job 사이에 유지되지 않는다 — "연속 5회 실패 → 60초 open"(ADR-0026 §2)이 **사실상 발동하지 않는다**. `local`은 회로차단 자체가 없다.

### 2.11 기존 시험 영향 — 닫힌 목록 **0건**

| 시험 | 영향 없음의 근거 |
|---|---|
| `augmentation-job.runner.seeds.spec.ts` | 목 Provider `providerId:'mock'` + `generate()`만 → 폴백 조건 불충족 |
| `local-augmentation.provider.redirect.spec.ts` · `gemini-augmentation.provider.redirect.spec.ts` | `generate()`가 계속 `[]`를 돌려준다(위임) |
| `augmentation-provider.factory.spec.ts` | 기존 메서드 동작 불변(메서드 추가만) |
| `validate-candidates*.spec.ts` · `augmentation-accept.service.spec.ts` · `asset-write-sealing.spec.ts` | 검증·승인·봉인 경로 무변경 |
| 통합(`learning-augmentation` 등) | 시험 환경은 `.env`를 읽지 않고 `AUGMENTATION_PROVIDER` 기본 `rule` → 폴백 경로 미발동 |
| 웹 `AugmentationPanel.viewer.spec.tsx` | `runResult.degraded:false` 고정 → 안내 미렌더 |

### 2.12 신규 시험

| 파일(제안) | 내용 |
|---|---|
| `augmentation/augmentation-job.runner.fallback.spec.ts` | ① `local` + `TIMEOUT` → G1 1회 · 요약 폴백 키 ② `gemini` + `HTTP_4XX` ③ `[]` → `EMPTY_RESULT` ④ 공백 후보 → `EMPTY_RESULT` ⑤ 부분 성공 → 폴백 0 · 키 4개 ⑥ `rule`/`mock` 0건 → 현행 deep-equal ⑦ G1도 0건 → `PARTIAL` + 폴백 키 ⑧ 임베딩 실패 → `FAILED` ⑨ 로그에 시드 문장 0 ⑩ (K-1d 반영 시) 폴백 G1이 예외 → `PARTIAL` + 폴백 키 |
| `providers/local-augmentation.provider.outcome.spec.ts` | 400·503·스키마 불일치·타임아웃·닫힌 포트·출구 차단·정상 |
| `providers/gemini-augmentation.provider.outcome.spec.ts` | 위 + `CIRCUIT_OPEN` · `SEED_BLOCKED` · `NOT_CONFIGURED` |
| `providers/augmentation-provider.factory.spec.ts`(추가 `it`만) | `getFallbackProvider()`는 항상 G1 |
| `integration/learning-augmentation-fallback.integration.spec.ts`(동적 import) | `local` + 스텁 503 → 제안 `rule` · `runResult` 폴백 키 · 승인 전 자산 불변 |
| 웹 `AugmentationPanel.fallback.spec.tsx` | 폴백 요약이면 FR-L1-7 문구 · 아니면 미표시 |

### 2.13 수용 기준

- **AC-K1b-1** Given `AUGMENTATION_PROVIDER=local`, ml-worker 503, When 증강 Job, Then 규칙 기반 제안이 `PENDING`으로 저장되고 결과 요약이 `degraded:true · fallbackFrom:'local'`이며 화면에 FR-L1-7 문구가 보인다.
- **AC-K1b-2** Given G3가 후보 3건을 냄, When Job, Then G1 호출 0 · 결과 요약에 폴백 키가 없다.
- **AC-K1b-3** Given `rule` 구성, When Job(0건 포함), Then 결과 요약·제안·로그가 변경 전과 바이트 동일.
- **AC-K1b-4** Given 폴백 제안, When 승인하지 않음, Then `Intent.examples`·색인·스냅샷 변화 0.
- **AC-K1b-5** Given 거버넌스 모드 ON + G3 호스트가 허용 목록 밖, When Job, Then `fallbackCause:'EGRESS_BLOCKED'`로 G1 결과가 채워지고 외부 호출 0.

### 2.14 구현 체크리스트(backend-implementer 중심)

- [ ] 포트: `AugmentationFailureCause`·`AugmentationGenerateOutcome`·선택 `generateWithOutcome?` · JSDoc에 C-6.
- [ ] `local`/`gemini`: `generateWithOutcome()` 구현(원인 분류 §2.3) · `generate()`는 위임 · Gemini `recordFailure()` 규칙 불변.
- [ ] 팩토리: `getFallbackProvider(deps)`.
- [ ] 러너: §2.6 — 폴백 없는 경로의 결과 요약 키 불변. **(K-1d 권고) 폴백 호출 try/catch**.
- [ ] shared-types: `AugmentationFallbackCauseSchema` · `AugmentationRunResultSchema` 선택 2필드 → build.
- [ ] `augmentation.service.ts list()`: 두 키 enum 검증 후 전달.
- [ ] (frontend) `augmentation.runFallbackNotice` + `AugmentationPanel` 조건부 1줄.
- [ ] 문서: ADR-0026 갱신 각주 · `learning-augmentation-설계.md` §4.3 · ui-spec.

---

## 3. N36-1 — 거버넌스 모드 ON이면 2인 승인 끄기 기본 잠금

### 3.1 결정과 번복 기록

- **번복 대상**: `ai-guardrails-설계.md` **U-7**(2026-09-30 PM 확정 "`ENV_APPROVAL_OFF_LOCKED`는 거버넌스 모드와 무관") · **R-9** · ADR-0048 §5 "끄기는 1인 동작 · `ENV_APPROVAL_OFF_LOCKED=true`면 거부".
- **새 결정(2026-10-01 PM)**: 거버넌스 모드 ON이면 **기본 잠금**, OFF이면 현행. → U-7은 "부분 번복": 명시 설정은 여전히 모드와 무관하게 적용되고(**명시값 우선**), **미설정일 때의 기본값만** 모드에 연동된다. 원 요구사항 FR-AG9-2에 더 가까워진다.
- **근거**: 결함 N36-1(끄기 → 직접 전환 → 켜기의 1인 우회). 거버넌스 모드는 "완화는 환경변수만"(ADR-0040)인 설치이므로 2인 통제 해제도 같은 등급(서버 설정 + 재기동)으로 올리는 것이 일관된다.

### 3.2 판정 규칙(단일 원천 = 순수 함수 1개)

| `ENV_APPROVAL_OFF_LOCKED` | `DATA_GOVERNANCE_MODE` | 잠금 | `offLockedBy` | 비고 |
|---|---|:---:|---|---|
| 미설정(또는 빈 값) | `OFF` | ✗ | — | **현행과 동일** |
| 미설정(또는 빈 값) | `ON` | ● | `GOVERNANCE_MODE` | 새 기본 |
| `true`/`1` | 무관 | ● | `SERVER_SETTING` | 현행과 동일 |
| `false`/`0` | `OFF` | ✗ | — | 현행과 동일 |
| `false`/`0` | `ON` | ✗ | — | **명시 해제** — 기동 경고 1줄(§3.3) |

- **명시값 우선의 근거**: 운영자가 교착(§3.7)을 풀 수단이 "환경변수 + 재기동"이어야 하고, 이는 No.45 "완화는 환경변수만" 규약 그 자체다. 명시 해제는 기동 로그로 드러낸다.
- 잠금은 **끄기(on → off)만** 막는다. 켜기·만료 시간 변경은 허용.

### 3.3 환경변수 · 기동

- `config/env.validation.ts`: `ENV_APPROVAL_OFF_LOCKED: envBoolean(false)` → **미설정 허용 boolean**(`envBooleanOptional()` — `z.preprocess(parseBooleanString, z.boolean().optional())` · `z.coerce.boolean()` 금지 규약 유지).
- 교차 경고(기동 실패 아님): `DATA_GOVERNANCE_MODE=ON` + **명시 false**면 `console.warn` 1줄.
- `jest.isolate-env.js` 변경 0.

### 3.4 서버 구현

| 파일 | 변경 |
|---|---|
| `environment/approval/lib/approval-off-lock.ts`(신설 · 순수) | `resolveApprovalOffLock(explicit, governanceMode): { locked; by? }` — §3.2 표 그대로 |
| `switch-approval.service.ts` | `:95`(`getStatus`)·`:146`(`updatePolicy`) 두 곳이 같은 함수를 쓴다. 409 코드·`details.reason='OFF_LOCKED'`·메시지 **불변** |
| `config/env.validation.ts` · `config/lib/env-boolean.ts` | §3.3 |

- **봉인 확인**: `environment-sealing.spec.ts`가 `environment/approval/**` 파일 목록·수를 고정하는지 구현 전 확인(고정하면 신설 파일 1개가 닫힌 목록 변경).

### 3.5 응답 · 화면(`offLocked` 재사용)

- `ApprovalPolicyStatusSchema`: `offLocked`(실효 잠금) 유지 + 선택 `offLockedBy?`(잠금일 때만).
- 웹 `ApprovalPolicyPanel.tsx:66`: `offLockedBy === 'GOVERNANCE_MODE'`면 "데이터 거버넌스 모드에서는 2인 승인 끄기가 기본으로 잠겨 있습니다. 끄려면 서버 관리자에게 문의해 주세요.", 아니면 기존 문구.
- 데이터 지도는 변경하지 않는다.

### 3.6 거버넌스 모드 전환 시 처리

| 상황 | 처리 |
|---|---|
| OFF → ON 재기동, 정책 켜진 챗봇 | 이후 끄기 거부. 대기 요청·예약·이력 변화 없음 |
| OFF → ON 재기동, 정책 꺼진 챗봇 | 그대로 꺼짐(자동으로 켜지 않음). 켜기 확인에 "서버 설정에 따라 켠 뒤 끄지 못할 수 있습니다" 일반 문구 |
| ON → OFF 재기동 | 명시 true가 아니면 잠금 해제 |
| 재기동 중 대기 요청 | 영향 없음 |
| 다중 인스턴스 혼재 | 전 인스턴스 동시 교체 권고 |

### 3.7 운영 절차 변경(`자동배포.md` §5.10·§5.11)

- 거버넌스 설치에서 정책을 꺼야 할 때: ① 모든 인스턴스 `.env`에 `ENV_APPROVAL_OFF_LOCKED=false` ② 재기동 ③ 콘솔에서 정책 끔 ④ 필요하면 줄을 지우고 재기동. 예방: `chatbot:deploy` 활성 계정 3개 이상 권고.

### 3.8 기존 시험 영향 — 닫힌 목록 **1건**

| 파일 | 변경 |
|---|---|
| `apps/api/src/config/env.validation.guardrails.spec.ts:7-16` | 기본값 시험의 `ENV_APPROVAL_OFF_LOCKED: false` 단언 → **undefined** 단언 |

### 3.9 신규 시험

| 파일(제안) | 내용 |
|---|---|
| `environment/approval/lib/approval-off-lock.spec.ts` | §3.2 표 5행 |
| `config/env.validation.guardrails.spec.ts`(추가 `it`만) | 빈 값·명시 false·잘못된 값·경고 |
| `integration/prod-switch-approval-governance.integration.spec.ts`(동적 import) | 미설정 → 끄기 409 · `offLockedBy` · 우회 3요청 실패 / 명시 false → 끄기 200 |
| 웹 `ApprovalPanels.spec.tsx`(추가 `it`만) | 거버넌스 문구 · 🔒 · `aria-disabled` |

### 3.10 수용 기준

- **AC-N361-1** 거버넌스 ON · 미설정 · 정책 켜짐 → 끄기 409 `OFF_LOCKED`.
- **AC-N361-2** 거버넌스 OFF · 미설정 → 변경 전과 바이트 동일.
- **AC-N361-3** 거버넌스 ON · 명시 false → 끄기 허용 · 기동 경고.
- **AC-N361-4** 거버넌스 ON · 정책 꺼짐 → 재기동 후에도 꺼짐 · 켜기 허용.

### 3.11 구현 체크리스트

- [ ] `envBooleanOptional()` · 스키마 · 교차 경고.
- [ ] `approval-off-lock.ts` + 서비스 2곳 치환.
- [ ] shared-types `offLockedBy?` → build.
- [ ] (frontend) 문구 1 + 패널 분기 1 + 켜기 확인 일반 문구.

---

## 4. L-2 — 현행 수용(코드 변경 없음)

- 직전 버전 단독 롤백(`SOLO_ROLLBACK`)의 A↔B 반복 토글을 **2026-10-01 PM 수용**. 근거: 두 버전 모두 운영된 버전이고 매 토글이 감사·이력·현황 알림에 남으며, N40-1 수정으로 비직전 롤백은 SWITCH와 같은 게이트를 받는다.
- 기록 위치: ADR-0048 알려진 한계 4 · `ai-guardrails-설계.md` I-20 · 결함분류 §1-1. 재검토 트리거: 롤백으로 나쁜 버전 재배포 사고.

---

## 5. L-5 — 저장 마스킹에서도 날짜 제외(생년월일 문맥 예외)

### 5.1 결정과 번복 대상

- **결정(2026-10-01 PM)**: 계좌번호 정규식(`\d{2,6}-\d{2,6}-\d{2,6}(?:-\d{1,6})?`)이 `2026-09-30` 같은 날짜를 `[계좌번호]`로 바꾸는 오인을 **저장·송신 경로(기본 호출)에서도** 제거한다.
- **PM 답변(2026-10-01)**: **U-1** — "생년월일·생일 같은 말이 앞에 있으면 예전처럼 가린다"(§5.2-B). **U-4** — 거버넌스 ON에서 날짜만 든 원본 파일이 더는 `PII_IN_RAW_FILE`로 막히지 않는 것을 **수용**(§5.9).
- **PM 결정(2026-10-01 2차 — 코드 리뷰 보통 1)**: 문맥 예외의 **구분 문자와 키워드 목록을 넓힌다**(§5.2-B 2차 확장). 리뷰가 찾은 누락 입력: `생년월일 - 1990-05-12` · `생년월일 / …` · `생년월일 ~ …` · `생년월일 “1990-05-12”`·`「…」` · `생년월일 (양력) 1990-05-12` · `Birth date: …`·`Birth Date …` · ZWSP가 낀 `생일 ​1990-05-12` · 구분 문자 4개 `생년월일 :  1990-05-12`.
- **의도적으로 바꾸는 약속**: No.45 FR-DG9-3/AC-DG8-3 "PARTIAL은 도입 전과 바이트 동일" · ADR-0048 §4 · 설계서 AG-7 · ADR-0013 No.36 갱신 2항 · `docs/requirements/ai-guardrails.md` FR-0-309·범위 밖 표. **새 기준선**: 규칙 v2(날짜 제외 + 생년월일 문맥 예외 — 2차 확장 포함) 적용 후 출력.
- **변하지 않는 것**: 대상 5종·종류별 차등·함수 1벌·순서(금지어 → PII → 암호화)·`PII_MASK_MODE`·출구 `kinds` 선택·원문 예외 규약. **과거에 저장된 텍스트는 재마스킹·되돌림을 하지 않는다**(§5.8).

### 5.2 날짜 판정 규칙

#### 5.2-A 날짜 제외(1벌 — 출구 규칙과 동일)

- 형식: `YYYY-MM-DD` — 연도 `19xx`·`20xx`, 월 `01~12`, 일 `01~31`(월별 일수·윤년은 보지 않는다).
- 경계: **앞 글자와 뒤 글자가 숫자도 ASCII 하이픈(`-`)도 아니어야**(문자열 시작·끝 포함) 날짜다("독립 날짜"). 하이픈 변형(‐ – —)은 경계 문자가 아니다(그 앞뒤의 날짜는 독립 날짜).
- 판정 대상: **계좌 단계만**. 주민번호·카드·전화 단계는 날짜와 겹치지 않는다.

#### 5.2-B 생년월일 문맥 예외(U-1 확정 · 2차 확장 2026-10-01)

독립 날짜 중 아래 조건을 **모두** 만족하는 것은 날짜 제외를 하지 않는다 — 계좌 단계가 예전처럼 가린다.

**① 키워드(닫힌 목록 7개)** — 낱말이 이 문자열로 **시작**해야 하고, 뒤에 붙는 글자는 표의 수 이하여야 한다.

| 키워드 | 비교 | 뒤에 붙을 수 있는 글자 수 | 잡히는 예 | 안 잡히는 예 |
|---|---|:---:|---|---|
| `생년` | 그대로 | 0~4 | 생년월일 · 생년월일은 · 생년월일자는 | 생년월일자는요(5) |
| `생일` | 그대로 | 0~2 | 생일 · 생일은 · 생일날은 | 발생일(낱말이 `발`로 시작) · 생일축하합니다 |
| `출생` | 그대로 | 0~4 | 출생일 · 출생년도 · 출생년월일은 | 출생년월일은요(5) |
| `탄생일` | 그대로 | 0~2 | 탄생일 · 탄생일이다 | 탄생일입니다(3) |
| `birth` | 영문 대소문자 무시 | 0~4 | Birth · birthday · birthdate · date of birth | birthplace(5) |
| **`birth date`**(2차 신설 — 두 낱말) | 영문 대소문자 무시 · 두 낱말 모두 **정확히** `birth`·`date`(접미 0) · 사이 **공백 1~2개**(전각 공백은 NFKC로 공백) | 0 | Birth date · Birth Date · birth  date | birth   date(공백 3) · birth-date · birth dates |
| `dob` | 영문 대소문자 무시 | 0 | DOB · dob | dobs · dobby · D.O.B |

- 목록 변경 = 규칙 변경이며 §5.6의 골든 갱신 절차를 밟는다.

**② "앞에 있다"의 정의** — 날짜 시작 위치에서 **왼쪽으로** 다음 순서로 읽는다.

1. **창**: 날짜 바로 앞 **최대 32글자**(UTF-16 단위 — 2차에서 24 → 32: `birth date` + 주석 + 구분 문자 6개를 담기 위해). 창 안에 줄바꿈(`\n`·`\r`·U+2028·U+2029)이 있으면 그 뒤만 남긴다 — **같은 줄**만 본다.
2. **보이지 않는 문자 제거(2차 신설)**: 창에서 `\p{Cf}`(U+200B~200F · U+202A~202E · U+2060~2064 · U+FEFF · U+00AD 포함) · U+034F · U+FE00~FE0F · U+115F · U+1160 · U+3164를 **제거**한다 — N36-2(금지어 정규화)와 **같은 집합**. `pii-mask`는 `apps/api`를 import할 수 없으므로 집합 정의를 패키지 안에 따로 두고, 두 집합이 같음을 api 쪽 정적 시험 1건으로 고정한다(§5.12).
3. **정규화**: 창에만 NFKC + 영문 소문자화를 적용한다(전각 `ＤＯＢ`·`：`·`（）`·`／`·`～`·전각 공백 → 반각). 원문·결과 문자열은 바꾸지 않는다(판정 전용 — 위치 계산에 쓰지 않으므로 길이 변화 문제 없음).
4. **구분 문자 건너뛰기**: 창 끝에서 구분 문자를 **0~6개** 건너뛴다(2차: 3 → 6). 구분 문자 집합(정규화 후):
   - 공백류(줄바꿈 제외)
   - ASCII `:` `=` `,` `(` `[` `"` `'` · **(2차) `-` `/` `~`**
   - **(2차) 하이픈 변형 U+2010~U+2015(‐ ‑ ‒ – — ―) · 빼기 U+2212(−) · 물결 U+301C(〜)**
   - **(2차) 곡선 따옴표 U+201C U+201D U+2018 U+2019(“ ” ‘ ’) · 낫표 U+300C~U+300F(「 」 『 』)**
   - 닫는 괄호 `)` `]`는 구분 문자가 **아니다**(⑤의 주석 안에서만 허용).
5. **주석(2차 신설 — 닫힌 목록 4개)**: 구분 문자를 건너뛰는 도중 창 끝 쪽이 `(양력)` · `(음력)` · `[양력]` · `[음력]`(정규화 후 문자열 그대로 일치)이면 그 4글자를 **1개 단위로 건너뛴다**(구분 문자 상한 6에 1로 셈) — **최대 1회**. 그 밖의 괄호 문구(`(선물)`·`(본인)`·`(solar)`)는 건너뛰지 않는다 → 낱말을 찾지 못해 예외 아님.
6. **낱말**: 그 앞의 **글자(유니코드 문자 L) 연속**을 낱말 T로 본다. T가 비어 있으면 예외 아님.
7. **낱말 시작**: T 바로 앞 글자가 숫자면 예외 아님(`2생일` 방지). T가 글자 연속의 최대 범위이므로 "낱말 가운데의 키워드"(`발생일`·`고객생년월일`)는 잡히지 않는다.
8. **판정**: T가 ① 표의 한 낱말 키워드로 시작하고 남은 글자 수가 허용치 이하면 **예외 적용**. 또는 T가 정확히 `date`이고, T 앞이 공백 1~2개이고, 그 앞 글자 연속이 정확히 `birth`이며 그 앞이 숫자가 아니면(`birth date`) **예외 적용**.

**③ ASCII 하이픈과 날짜 경계(혼동 방지)**

- 날짜 바로 앞의 ASCII `-`는 5.2-A 경계에서 날짜를 "독립 날짜 아님"으로 만든다 → **문맥 판정 이전에** v1처럼 `[계좌번호]`(`생일-2026-09-30`·`생일 -2026-09-30`·`배송-2026-09-30` 모두 가림 — v1과 같아서 변화 없음).
- 따라서 ASCII `-`가 **구분 문자로 쓰이는 것은 날짜와 다른 구분 문자(공백 등)로 떨어져 있을 때뿐**이다(`생년월일 - 1990-05-12`). 날짜 자체의 하이픈은 창 밖(날짜 시작 위치 오른쪽)이라 섞이지 않는다.
- 하이픈 변형(‐ – —)은 경계 문자가 아니어서 날짜에 바로 붙어도 독립 날짜이고, 구분 문자로 건너뛴다(`생일–1990-05-12` → 예외).

**④ 예외가 적용될 때의 결과** — 규칙 v1과 **바이트 동일**: 그 날짜 구간은 `[계좌번호]`, `counts.account` +1. 새 표기·새 종류는 만들지 않는다.

**⑤ 예시**

| 입력 | 결과 | 근거 |
|---|---|---|
| `생년월일 1990-05-12` · `생년월일: 1990-05-12` · `생년월일(1990-05-12)` · `제 생일은 2000-01-01` · `DOB 1990-05-12` · `ＤＯＢ：1990-05-12` | `[계좌번호]` | 예외(1차부터) |
| (2차) `생년월일 - 1990-05-12` · `생년월일 / 1990-05-12` · `생년월일 ~ 1990-05-12` · `생일 – 1990-05-12` · `생일—1990-05-12` | `[계좌번호]` | 구분 문자 확장 |
| (2차) `생년월일 “1990-05-12”` · `생년월일 「1990-05-12」` · `생년월일 『1990-05-12』` | `[계좌번호]` | 따옴표·낫표 |
| (2차) `생년월일 (양력) 1990-05-12` · `생년월일(음력): 1990-05-12` · `생년월일 （양력） 1990-05-12` | `[계좌번호]` | 주석 |
| (2차) `Birth date: 1990-05-12` · `Birth Date 1990-05-12` · `birth  date 1990-05-12` | `[계좌번호]` | `birth date` |
| (2차) `생일 ​1990-05-12`(ZWSP) · `생​일 1990-05-12` | `[계좌번호]` | 보이지 않는 문자 제거 |
| (2차) `생년월일 :  1990-05-12`(4개) · `생일::: 1990-05-12` · `생일 = "1990-05-12"` · `생일 :::: 1990-05-12`(6개) | `[계좌번호]` | 상한 6 |
| `생일 ::::: 1990-05-12`(7개) | 날짜 그대로 | 상한 초과 |
| `생일-2026-09-30` | `[계좌번호]` | 5.2-A 경계(문맥과 무관 — v1과 같음) |
| `2026-09-30 배송` · `입금일 2026-09-30` · `발생일 2026-09-30` · `배송 ~ 2026-09-30` · `기간 2026-09-01 ~ 2026-09-30` | 날짜 그대로 | 키워드 아님 |
| `생일 선물 2026-09-30` · `생년월일 입력: 1990-05-12` · `생일 (선물) 2026-09-30` · `생년월일 (양력) (음력) 1990-05-12` | 날짜 그대로 | 다른 낱말 · 목록 밖 주석 · 주석 2회 |
| `birth   date 1990-05-12` · `birth-date 1990-05-12` | 날짜 그대로 | 공백 3 · 하이픈 연결(목록 밖) |
| `생년월일\n1990-05-12` · `1990-05-12 생일` · `1990-05-12 (생년월일)` | 날짜 그대로 | 다른 줄 · **날짜 뒤 문맥(U-14 — 설계 수용, PM 확인 대기)** |
| `생일 - 2026-10-01 이벤트` | `[계좌번호]` | 과탐(생년월일 아님) — 수용(ADR-0049 감수 비용 7) |
| `생일 1990-01-01 2020-01-01` · `birth: 1990-05-12 / 2000-01-01` | 첫 날짜만 `[계좌번호]` | 두 번째 날짜 앞은 숫자 → 낱말 없음 |

**⑥ 오탐 방지 · 성능(ReDoS)**

- 오탐 방지는 "닫힌 키워드 + 낱말 시작 + 바로 다음 낱말 + 같은 줄 + 구분 문자 ≤6 + 닫힌 주석 1회"가 맡는다. 2차 확장은 **사이 기호만** 넓혔으므로 늘어나는 가림은 "키워드 낱말 + 기호 + 날짜" 모양으로 한정된다. 남는 과탐 예: `생일 - 2026-10-01 이벤트`(키워드 낱말 뒤 행사 날짜) — 가리는 방향이라 수용.
- 판정은 **날짜 1개당 고정 창(32글자)** 에 대한 ① 줄바꿈 자르기 ② 보이지 않는 문자 제거 ③ NFKC ④ 역방향 선형 스캔(구분 문자 ≤6 · 고정 4글자 주석 비교 1회 · 글자 연속 · 키워드 7개 접두 비교)이다. 모두 창 길이에 선형이고 창은 상수이므로 **날짜당 상수 시간** — 정규식 역추적 없음(단일 문자 클래스 검사만). 날짜가 없는 입력은 추가 비용 0.

#### 5.2-C 전체 비교표

| 입력 | v1(현행 저장) | v2(변경 후) | 이유 |
|---|---|---|---|
| `2026-09-30` · `[2000-01-01]` · `2026-09-30에` · `2026-09-30T10:00` · `2026-09-30~2026-10-01` | `[계좌번호]` | **날짜 그대로** | 독립 날짜 |
| §5.2-B 예외 | `[계좌번호]` | `[계좌번호]`(v1과 동일) | 생년월일 문맥 |
| `2026-13-01` · `2026-00-10` · `2026-09-32` · `1899-01-01` · `2100-01-01` | `[계좌번호]` | `[계좌번호]` | 날짜 범위 밖 |
| `12026-09-30` · `x-2026-09-30` · `2026-09-30-12` · `2026-09-30-` | `[계좌번호]` | `[계좌번호]` | 경계 위반 |
| `26-09-30`(YY-MM-DD) | `[계좌번호]` | `[계좌번호]` | 이번에 제외하지 않음(U-2) |
| `2026.09.30` · `2026/09/30` · `2026년 9월 30일` · `20260930` · `2026-9-30` | 원문 | 원문 | 원래 계좌 정규식 밖(생년월일 문맥이어도 가리지 않는다) |
| `1990-05-12x@y.co`(날짜에 붙은 이메일) | `[계좌번호]x***@y.co` | `1***@y.co` | §5.5-4 — 더 가리는 방향 |

### 5.3 위험 평가 · 권고

1. **실제 계좌번호가 날짜 모양일 위험 — 낮음(외부 자료로 전수 확인 못 함)** — 정확히 4-2-2(8자리)·연월일 범위·경계 조건을 모두 만족해야 한다. 국내 요구불 계좌의 일반 표기(10~14자리)에 4-2-2는 없다고 판단 → 수용, 보안 담당 확인 권고(U-3).
2. **날짜형 개인정보(생년월일) — U-1·2차 확장으로 대부분 완화, 잔여 있음**: ① 봇 질문 뒤 날짜만 답함 ② 설문 답·양식 슬롯 값 ③ `고객생년월일`처럼 붙여 쓴 낱말·키워드와 날짜 사이 다른 낱말 ④ **날짜 뒤 문맥 `1990-05-12 (생년월일)`(U-14)**. ①②는 호출부 계약 변경이 필요해 범위 밖(U-12).
3. **YY-MM-DD 미포함**: 2자리 연도는 제품 코드·번호까지 풀린다(U-2).
4. **회귀 위험(골든 갱신)**: v1 동결 + 차분 증명 + 손 작성 문맥 골든 + 퍼징 동등성으로 고정한다(§5.6).

### 5.4 `preserveDates` 선택 인자와의 관계 — **기본값을 뒤집어 통합**(제거하지 않음)

| 항목 | 변경 전 | 변경 후 |
|---|---|---|
| `preserveDates` 생략 | 날짜 비보호(구 동작) | **날짜 보호(v2)** — 생년월일 문맥 예외 포함 |
| `preserveDates: true` | 날짜 보호(선택 경로) | 날짜 보호(기본 경로와 같은 판정) — 예외 포함 |
| `preserveDates: false` | 날짜 비보호 | 날짜 비보호(**v1과 바이트 동일** — 예외 판정 자체를 하지 않음) |
| 선택 경로 진입 조건 | `kinds !== undefined \|\| preserveDates` | **`kinds !== undefined`만** |
| 사설 영역 문자 입력의 폴백(K-11) | 기존 본문 = 날짜 비보호 | 기존 본문 + 호출자의 `preserveDates` 값 그대로 존중 |

- 문맥 예외를 끄는 옵션은 두지 않는다. 봉인 GR-5(`kinds:`/`preserveDates:`를 넘기는 운영 호출 파일 = `exit-pii.ts` 1개) **불변**.
- **출구 경로(같은 판정 함수)**:

| 챗봇 출구 설정 | 생년월일 문맥 날짜 | 일반 날짜 |
|---|---|---|
| 계좌번호 **켬** + 날짜 보호 켬 | **`[계좌번호]`**(변경) | 그대로 |
| 계좌번호 켬 + 날짜 보호 끔 | `[계좌번호]`(변화 없음) | `[계좌번호]`(변화 없음) |
| 계좌번호 **끔**(기본: 주민번호·카드) | 그대로(변화 없음) | 그대로 |

- 웹 체크박스 레이블 "날짜(연-월-일 형식)는 가리지 않기"는 **바꾸지 않는다**(`GuardrailPiiSettingsPage.spec.tsx:55`가 접근성 이름으로 찾는다).

### 5.5 구현 규칙(`packages/pii-mask/src/index.ts`)

1. 기본 경로의 변경은 **두 곳**으로 한정(code-reviewer diff 확인): `const preserveDates = options?.preserveDates !== false;` · 계좌 `replace` 치환 콜백(`isStandaloneDate && !isBirthDateContext`면 원문, 그 밖은 `[계좌번호]` + 카운트). 다른 4종 `replace`·`mode`·`counts` 초기화 **변경 0**.
2. 날짜 판정 상수는 `DATE_CORE` **1곳**에서 파생(전체 일치 정규식 · 경계 문자 `[\d-]`).
3. **문맥 판정 = 내부 순수 함수 1개(`isBirthDateContext`) + 닫힌 상수**(2차 확장 반영):
   - `BIRTH_KEYWORDS`(한 낱말 6개 · 허용 접미 수) + `BIRTH_TWO_WORD`(`birth`+`date`, 사이 공백 1~2)
   - `BIRTH_WINDOW = 32` · `BIRTH_MAX_DELIMITERS = 6`
   - `BIRTH_DELIMITER` 문자 집합(§5.2-B ②-4 — **단일 문자 클래스**로 정의, 수량자 없음)
   - `BIRTH_ANNOTATIONS = ['(양력)', '(음력)', '[양력]', '[음력]']`(고정 문자열 비교 · 최대 1회)
   - `INVISIBLE` 제거 집합(§5.2-B ②-2 — N36-2와 같은 집합)
   - export하지 않는다(시험은 `maskPii`로). JSDoc·`PiiMaskOptions.preserveDates` 주석의 키워드·구분 문자 서술을 2차 규칙으로 갱신.
4. **선택 경로(`maskPiiSelective`) — 날짜 자리표시 제거(구현 확정 · 리뷰 낮음 5 기록)**: 계좌 단계 직전에 날짜를 사설 영역 자리표시로 미리 바꾸던 방식을 버리고, 기본 경로와 **같은 계좌 단계 콜백**(독립 날짜 + 문맥 아님 → 원문, 아니면 선택 여부에 따라 `[계좌번호]` 또는 보호)으로 판정한다. 이유: 자리표시가 남아 있으면 뒤 단계(이메일) 정규식이 날짜 주변을 기본 경로와 다르게 보아 두 경로 결과가 어긋났다(퍼징으로 확인). 부수 효과는 **더 많이 가리는 방향**이다 — 날짜에 붙은 이메일 `1990-05-12x@y.co`가 예전(출구 · 날짜 보호 켬) `1990-05-12x***@y.co`에서 새 출력 `1***@y.co`가 된다(이메일 국소부가 날짜 숫자까지 포함). 기본 경로는 원래 자리표시가 없었으므로 기본 경로 결과와 일치하게 된 것이다.
5. **규칙 버전 — `PII_MASK_RULES_VERSION = 2` 유지**(2 = 날짜 제외 + 생년월일 문맥 예외, 2차 확장 포함이 최종 정의). 근거: 버전 값은 "배포된 동작"을 식별하는데, v2 구현은 2차 확장 시점에 **아직 커밋·배포되지 않았다**(이 세션 시작 시 저장소에 `pii-mask` 변경 없음 — 구현은 미커밋 작업 트리). 배포된 적 없는 중간 상태에 번호를 쓰면 폐쇄망 확인 로그가 오히려 혼란스럽다. **조건**: 2차 확장 전 v2가 어느 환경(시연 서버 포함)에든 배포됐다면 3으로 올리고, 기동 로그 문구의 버전·`governance-bootstrap.service.spec.ts` 기대 문자열(신규 시험)을 함께 바꾼다. 기동 로그 문구 `pii-mask 규칙 v2(저장 마스킹 날짜 제외 · 생년월일 문맥 예외) · 모드 …`·패키지 버전 `0.2.0` 유지.

### 5.6 골든 말뭉치 처리

**원칙**: 전체 재생성 금지 · PM 결정으로 규칙이 바뀔 때만 부분 갱신 · 신규 골든·신규 케이스 추가는 재생성이 아니다.

**① `storage-corpus.json`(306건) — 23건 그대로(2차 재확인)**: 말뭉치에 문맥 키워드(`생년`·`생일`·`출생`·`탄생일`·`birth`·`dob` — `birth date`는 `birth` 검색에 포함) **0건**. 2차 확장은 키워드 낱말이 있을 때만 작동하므로 말뭉치 결과가 바뀌지 않는다. 보이지 않는 문자 제거도 판정 창 안에서만 일어나 결과 문자열을 바꾸지 않는다. **날짜에 붙은 이메일**(§5.5-4)은 기본 경로에서 원래 그렇게 동작했으므로 기본 경로 골든에 영향 없음. → `storage-corpus.json`·`storage-corpus.v1.json`·`index.golden-diff.spec.ts`의 닫힌 목록 상수 **변경 0**.

| 단계 | 작업 |
|---|---|
| G-0 | `storage-corpus.v1.json` = 구현 전 HEAD 바이트 동결본(완료) |
| G-1 | 날짜 케이스 23건만 HEAD 선택 경로(날짜 보호)로 도출(완료 — 오라클 전제: 키워드 0건) |
| G-2 | 키워드 0건 · 달라진 케이스 = 독립 날짜 포함 케이스 · 나머지 deep-equal(차분 시험이 고정) |
| G-3 | 구현 후 `index.golden.spec.ts`·`index.golden-selective.spec.ts` 무수정 통과 |

**② `birth-context-corpus.json`(손 작성, 현재 66건) — 2차 갱신 규칙**

- **기대값이 바뀌는 기존 케이스(닫힌 목록 2건)** — 두 모드(PARTIAL·FULL) 모두 `maskedText`의 날짜 → `[계좌번호]`, `counts.account` 0 → 1:
  1. `생일::: 1990-05-12`(구분 문자 4개 — 상한 3 → 6)
  2. `생일 = "1990-05-12"`(구분 문자 4개)
- **그대로인 기존 케이스 64건**(재확인): 새 구분 문자·주석·`birth date`·보이지 않는 문자 규칙이 닿지 않는다 — 다른 낱말이 끼는 케이스(`생일 선물 …`·`생년월일 입력: …`), 줄바꿈(`\n`·`\r\n`·U+2028), 접미 초과, 낱말 가운데 키워드, 날짜 뒤 문맥, 두 번째 날짜(앞이 숫자), 날짜 아님(`2026-13-01`·`12026-09-30`·`26-09-30`·`1990-05-12-12`) 모두 결과 동일.
- **새 케이스(손 작성 · 약 25건 · 구현 전 커밋)**: §5.2-B ⑤ 표의 (2차) 행 전부 + 경계 케이스 — 구분 문자 6개(가림)·7개(그대로) · 주석 4종(반각·전각) · 목록 밖 주석 `(선물)` · 주석 2회 · `birth date` 공백 1·2·3개 · `birth-date` · ZWSP 위치 3곳(키워드 안·키워드 뒤·날짜 직전) · `생일-2026-09-30`(경계) · 하이픈 변형 3종 · 곡선 따옴표·낫표 · `배송 ~ 2026-09-30`·`기간 … ~ …`(키워드 없음) · `1990-05-12 (생년월일)`(U-14 현행 고정) · `생일 - 2026-10-01 이벤트`(과탐 현행 고정) · 날짜에 붙은 이메일 `생일 1990-05-12x@y.co`·`1990-05-12x@y.co`.
- 기대값은 **규칙 표를 보고 사람이 작성**하고 code-reviewer가 표와 대조한다(구현 출력을 기대값으로 쓰지 않는다). `note` 필드에 "2026-10-01 2차 확장 — 기존 2건 변경 · N건 추가" 기록.

**③ 증명 시험** — 기존 5파일 유지 + 갱신:

| 파일 | 2차 변경 |
|---|---|
| `index.golden-v1-legacy.spec.ts` · `index.golden-diff.spec.ts` · `index.golden.spec.ts` · `index.golden-selective.spec.ts` | 변경 0(① 근거) |
| `index.birth-context.spec.ts` | 코드 변경 0(골든 파일만 갱신) — "날짜가 모두 문맥 날짜인 케이스 = v1" 단언에 새 케이스가 자동 포함 |
| `index.date-equivalence.spec.ts` | 퍼징 알파벳에 새 구분 문자(`- / ~ ‐ – — − 〜 “ ” ‘ ’ 「 」 『 』`) · ZWSP · 주석 조각 `(양력)` · `birth date` 조각 추가(시험 강화 — 기대값 변경 아님) |
| `index.birth-context.perf.spec.ts` | 주석의 "창 24글자" → 32 · 최악 입력에 주석·구분 문자 반복 추가(상한 느슨하게 유지) |

### 5.7 마스킹 호출자 전수 영향(grep `maskPii(` — 운영 코드 기준)

| # | 호출 위치 | 경로 | 변경 후 영향 |
|---|---|---|---|
| 1 | `conversation/conversation-log.service.ts:78,81` | 저장 | 일반 날짜 원문 · 같은 메시지 안 생년월일 문맥 날짜는 `[계좌번호]` · 봇 질문 뒤 날짜만 답한 생년월일은 원문(U-12) |
| 2 | `survey-responses/survey-response.service.ts:223` | 저장 | 동일(날짜만 답하면 원문 — U-12) |
| 3 | `handoff/handoff-thread.service.ts:205,252` · `handoff-actions.service.ts:148` | 저장 · 상담원 발신 | 동일 · 일반 날짜만 다른 메시지는 `rawText` 미보관(보관 감소) |
| 4 | `inbox/core/lib/masked-text.ts:15` | 저장 | 동일 |
| 5 | `environment/approval/switch-approval.service.ts:329` | 저장 | 동일 |
| 6 | `rag/rag-answer.service.ts:84` · `validation/run/test-run-rag.service.ts:49` · `simulation/simulation.service.ts:418` | 송신(외부 RAG 질의) | 일반 날짜 송신 · 문맥 날짜 가림 |
| 7 | `augmentation/providers/gemini-augmentation.provider.ts:59` | 송신 | 동일 |
| 8 | `legacy-api/legacy-api.service.ts:96` | 송신(슬롯 값) | 날짜 슬롯 원문 전송(연동 정상화) · 생년월일 슬롯도 원문(U-12) |
| 9 | `workflow/triggers/lib/field-values.ts:30` | 송신(웹훅 폼 슬롯) | #8과 같음 |
| 10 | `kb-sync/lib/run-extract-job.ts:17` | 송신 · 원본 파일 PII 건수 | 일반 날짜 원문 · 날짜만 든 원본 파일 전송(U-4 수용) · 문맥 날짜 든 파일은 계속 제외 |
| 11 | `utterance-analysis/**` | 분석 입력·이름 | 일반 날짜가 남을 수 있음 · 문맥 날짜는 `[계좌번호]`(표식 제거 로직 그대로) |
| 12 | `augmentation/lib/validate-candidates.ts:91` | 증강 후보 PII 탐지 | 일반 날짜 든 후보 통과 · 문맥 날짜 든 후보 탈락 |
| 13 | `guardrails/runtime/guardrail-runtime.service.ts:131` | 시뮬레이터 표시 | 일반 날짜 원문 |
| 14 | `simulation/simulation.service.ts:387` | 시뮬레이터 표시 | 일반 날짜 원문 |
| 15 | `guardrails/lib/exit-pii.ts:52` | 출구 | 계좌 켬 + 날짜 보호 켬에서만 문맥 날짜 가림 · 날짜에 붙은 이메일은 더 가림(§5.5-4) |
| 16 | `utterance-analysis/eval/measure-clustering-quality.ts:149` | 평가 스크립트 | 측정값만 |

### 5.8 이미 저장된 데이터 영향 — **과거 기록은 재마스킹하지 않는다**

| 대상 | 영향 | 처리 |
|---|---|---|
| 대화 기록·설문·상담·인박스·승인 사유 | v1 행(`[계좌번호]`)과 v2 행(일반 날짜 원문) 공존 · 문맥 날짜는 전후 모두 `[계좌번호]` | 백필·재마스킹 없음 · 적용 시각 기록 |
| 미응답 큐 병합 키 · 통계 질문 순위 | 일반 날짜만 다른 질문이 이후 날짜별로 갈라짐 | 수용(U-5) |
| 임베딩 `textHash` · 스냅샷 해시 · 감사 체인 · 암호화 봉투 | 무관 | 변화 0 |
| KB 문서 지문 | 마스킹 전 본문 기준 → 재전송 없음 | 변환 규칙 버전 올리지 않음(U-6) |
| KB `piiMaskedCount` | 이후 수집분부터 | 과거 행 불변 |
| 외부로 이미 나간 데이터 | 회수 대상 아님 | — |

### 5.9 거버넌스(No.45) 보존·감사 영향

- 보존·파기 영향 0 · 새 감사 동작 0 · 데이터 지도 표기 불변(설명 1줄 권고).
- **원본 파일 전송 게이트 — U-4 PM 수용(2026-10-01)**: 판정에서 일반 날짜가 빠진다. 생년월일 문맥 날짜(2차 확장 표기 포함)는 계속 1건으로 세므로 그런 파일은 여전히 막힌다.
- 설치별 구 규칙 유지 설정은 만들지 않는다.

### 5.10 폐쇄망 배포 · 버전 호환

| 항목 | 처리 |
|---|---|
| 배포 단위 | `pii-mask`는 `apps/api`에 `dist`로 번들 — API만 교체 |
| 빌드 누락 위험 | `pnpm --filter @chat-bot/pii-mask build` 필수 + 기동 로그 "pii-mask 규칙 v2" 확인(§5.5-5 — 버전 유지 조건 포함) |
| 다중 인스턴스 | 전 인스턴스 동시 교체 |
| 롤백 | 즉시 가능 · 그 사이 저장된 날짜 원문은 남음 |
| DB | 마이그레이션 0 |

### 5.11 기존 시험 영향 — 닫힌 목록 재산정(2차 확장 반영)

**(가) 이번 결정 이전부터 있던 시험 — 4건(증감 없음)**

| # | 파일 | 변경 |
|---|---|---|
| L5-T1 | `packages/pii-mask/src/__golden__/storage-corpus.json` | 날짜 케이스 23건의 기대값(완료 — 2차 영향 0) |
| L5-T2 | `packages/pii-mask/src/index.selective.spec.ts` 63-66행 | `preserveDates: false` 명시(기대값 불변) |
| L5-T3 | `apps/api/src/integration/helpers/ai-guardrails-parity.golden.ts` 55행 + 주석 | `날짜는 2026-09-30 입니다.`(키워드 없음 — 2차 영향 0) |
| L5-T4 | `packages/pii-mask/src/index.golden.spec.ts` 머리 주석 | 주석만 |

- 2차 확장 재확인: `apps/**`·`packages/pii-mask/src/**` 시험·골든에서 새 구분 문자·주석이 키워드 낱말 뒤에 오는 입력은 손 작성 문맥 골든 외에 **0건**(키워드 grep 결과: 문맥 골든·L-5 신규 시험만). 출구 시험(`judge-outbound.spec.ts:44-53`, `ai-guardrails.integration.spec.ts`)은 키워드 뒤 기호가 공백 1개뿐이라 영향 없음. **날짜에 붙은 이메일** 입력은 기존 시험 0건(§5.5-4는 구현에 이미 반영된 상태에서 기존 시험이 통과함 — 리뷰 확인).

**(나) 이번 L-5 작업 중 새로 쓴 시험(미커밋) — 기대값 변경 1건 + 강화 2건**

| 파일 | 변경 |
|---|---|
| `__golden__/birth-context-corpus.json` | **기존 2건 기대값 변경**(§5.6 ②) + 새 케이스 약 25건 추가 |
| `index.date-equivalence.spec.ts` | 퍼징 알파벳 확장(기대값 변경 아님) |
| `index.birth-context.perf.spec.ts` | 주석 24 → 32 · 최악 입력 확장(기대값 변경 아님) |
| `apps/api/src/governance/bootstrap/governance-bootstrap.service.spec.ts`(신규 `it`) | **변경 없음**(버전 2 유지 시). 3으로 올리면 기대 문자열 1곳 변경 |

- **전체 닫힌 목록(3결정 합계, 이전부터 있던 시험)**: K-1b 0 + N36-1 1 + L-5 4 = **5건 — 변경 없음.**

### 5.12 신규 시험

- `pii-mask`: §5.6 ③의 파일 + `index.dates.spec.ts`(§5.2-C 표 전 행 · `counts.account` 증감 · `preserveDates:false`면 v1 · 사설 영역 문자 입력).
- `apps/api`:
  - `integration/storage-mask-dates.integration.spec.ts` — (기존) `생년월일 1990-05-12 로 조회` → `생년월일 [계좌번호] 로 조회` · (2차 추가 `it`) `생년월일 (양력) 1990-05-12` · `Birth date: 1990-05-12` · `생년월일 - 1990-05-12` → 저장 `[계좌번호]`.
  - `guardrails/lib/judge-outbound.spec.ts`(추가 `it`) — 출구 `생년월일 「1990-05-12」` · 계좌 켬 → `[계좌번호]`.
  - (신설) `banned-words/lib/invisible-set.parity.spec.ts`(이름은 구현자 판단) — `pii-mask`의 보이지 않는 문자 집합과 N36-2 `stripInvisible` 집합이 같은 코드 포인트 목록인지 정적 비교(한쪽만 바뀌는 것을 막는다).
  - `governance-bootstrap.service.spec.ts` — 기동 로그 `pii-mask 규칙 v2` 1줄.

### 5.13 수용 기준

- **AC-L5-1** `2026-09-30 배송 문의 계좌 110-234-567890` → `2026-09-30 배송 문의 계좌 [계좌번호]`.
- **AC-L5-2** 날짜 없는 입력은 v1과 바이트 동일(골든 283건 + 차분).
- **AC-L5-3** 출구 `ACCOUNT` + 날짜 보호 끔 → 변경 전과 동일.
- **AC-L5-4** 변경 전 저장 행은 재마스킹 0.
- **AC-L5-5** `2026-13-01`·`12026-09-30`·`26-09-30` → `[계좌번호]`.
- **AC-L5-6** `생년월일: 1990-05-12`·`제 생일은 2000-01-01`·`DOB 1990-05-12` → v1과 바이트 동일.
- **AC-L5-7** `발생일 2026-09-30`·`생일 선물 2026-09-30 도착`·`생년월일\n1990-05-12` → 날짜 원문.
- **AC-L5-8** 출구 `ACCOUNT` + 날짜 보호 켬, `생년월일 1990-05-12, 배송 2026-09-30` → `생년월일 [계좌번호], 배송 2026-09-30`.
- **AC-L5-9** 거버넌스 ON · 원본 전달 소스: 날짜만 든 PDF는 전송(U-4) · `생년월일 1990-05-12`가 있으면 `PII_IN_RAW_FILE`.
- **AC-L5-10(2차)** `생년월일 - 1990-05-12`·`생년월일 / 1990-05-12`·`생년월일 ~ 1990-05-12`·`생년월일 “1990-05-12”`·`생년월일 「1990-05-12」`·`생년월일 (양력) 1990-05-12`·`Birth date: 1990-05-12`·`Birth Date 1990-05-12`·`생일 ​1990-05-12`(ZWSP)·`생년월일 :  1990-05-12` → 모두 v1과 바이트 동일한 `[계좌번호]`.
- **AC-L5-11(2차)** `생일 ::::: 1990-05-12`(7개)·`생일 (선물) 2026-09-30`·`birth   date 1990-05-12`·`배송 ~ 2026-09-30`·`1990-05-12 (생년월일)` → 날짜 원문.
- **AC-L5-12(2차)** 생년월일 문맥 판정은 날짜 1만 개 · 20만 글자 최악 입력에서 날짜 수에 선형(성능 시험 상한 안).

### 5.14 구현 체크리스트(backend-implementer)

- [ ] **(2차) 손 작성 골든 먼저**: `birth-context-corpus.json` 기존 2건 기대값 변경 + 새 케이스 추가(기대값은 §5.2-B 표 기준 사람 작성) — 구현 변경과 한 PR, 골든 커밋 선행.
- [ ] **(2차) `isBirthDateContext` 확장**: 창 32 · 보이지 않는 문자 제거 → NFKC → 소문자 · 구분 문자 집합(단일 문자 클래스) · 상한 6 · 주석 4개 1회 · `birth date` 두 낱말 판정 · 낱말 앞 숫자 차단 유지. 정규식 수량자·되돌아보기 사용 금지(단일 문자 검사만).
- [ ] JSDoc · `PiiMaskOptions.preserveDates` 주석 · `PII_MASK_RULES_VERSION` 주석을 2차 규칙으로 갱신(버전 값 2 유지 — §5.5-5 조건 확인 후).
- [ ] 선택 경로 날짜 자리표시 제거(구현 완료분) 유지 · 주석에 §5.5-4 근거와 "날짜에 붙은 이메일은 더 가린다" 기록.
- [ ] `index.date-equivalence.spec.ts` 알파벳 확장 · `index.birth-context.perf.spec.ts` 갱신.
- [ ] `apps/api` 추가 `it` 2건 + 보이지 않는 문자 집합 동등성 시험 1건.
- [ ] `pnpm --filter @chat-bot/pii-mask build` → `packages/pii-mask` jest → api jest. 닫힌 목록(이전부터 있던 시험 5건) 밖 실패 시 중단·보고.
- [ ] 코드 리뷰: 기본 경로 diff 2곳 · 문맥 판정에 역추적 없음 · 상수가 §5.2-B와 문자 단위로 같음 · GR-5 1파일 유지.
- [ ] (권고 · 별도 결함) K-1d 폴백 try/catch · L-6 이메일 정규식 선형화(`patches-3` R-6 — L-5와 별개 커밋 권장).
- [ ] 문서: `patches-3` 적용 · CHANGELOG 릴리스 노트 "동작 변경(저장 마스킹 날짜 제외 · 생년월일 문맥은 계속 가림 — 하이픈·슬래시·물결·따옴표·(양력) 등 표기 포함 · 날짜에 붙은 이메일은 더 가림 · 과거 기록 불변)".

---

## 6. 작업 순서(권고)

1. 문서: 이 설계 + ADR-0049 + `patches-3` 적용.
2. **N36-1** → **K-1b** → **L-5**(2차 확장: 손 작성 골든 선행 → 판정 함수 확장).
3. 각 결정 후 `code-reviewer` → `test-automation` 전체 회귀 — 닫힌 목록(이전부터 있던 시험 5건) 대조.
4. 커밋은 사용자 요청 시 git-manager. 결함 후보(K-1c·K-1d·L-6)는 결함분류 등록 후 별도 수정 묶음.

---

## 7. 추가 확인이 필요한 판단(PM/사용자)

| # | 판단 | 이 설계의 기본 | 다른 선택 | 상태 |
|---|---|---|---|---|
| **U-1** | 하이픈 날짜형 생년월일 | — | — | **확정(2026-10-01)** + **2차 확장 확정(구분 문자·키워드)** → §5.2-B |
| U-2 | `YY-MM-DD` 제외 여부 | 제외하지 않음 | 포함 | 미결 · 낮음 |
| U-3 | 계좌번호가 4-2-2 날짜 모양일 위험 | 낮음 · 수용 | 보안 담당 확인 | 미결 · 중 |
| **U-4** | 날짜만 든 원본 파일 게이트 완화 | — | — | **수용(2026-10-01)** |
| U-5 | 미응답 큐·질문 순위가 날짜별로 갈라짐 | 수용 | — | 미결 · 낮음 |
| U-6 | 이미 적재된 KB 문서 재전송 | 하지 않음 | 전체 재전송 | 미결 · 낮음 |
| U-7 | 거버넌스 ON에서 명시 `false` 우선 | 명시값 우선 + 경고 | 무시 | 미결 · 중 |
| U-8 | 승인자 1명 교착 | 운영 절차 | 자동 해제 | 미결 · 중 |
| U-9 | K-1c 회로차단 미작동(⚠ 2026-10-01 후속 설계 — `followup-defects-2026-10-01-설계.md` §5 · ADR-0050 §2: 상태 공유·local 포함) | 결함 등록(`patches-3` R-6) | 이번에 싱글턴화 | 등록 권고 · 낮음 |
| U-10 | K-1b 웹 안내 1줄 | 추가 | 배지만 | 미결 · 낮음 |
| U-11 | `excludeDates` 표기 정정 | 정정 | — | 정보 |
| U-12 | 봇 질문 뒤 날짜만 답함·설문 답·슬롯 값의 생년월일 원문 | 범위 밖 수용 · 재검토 트리거 | 슬롯·문항 유형으로 호출부가 "날짜 전부 가림" 요청 | **확인 필요 · 중** |
| U-13 | 출구 기본 설정에서 생년월일 미가림 | 수용(회귀 아님) | 출구 생년월일 전용 종류 | 확인 필요 · 낮음 |
| **U-14** | **문맥이 날짜 뒤에 오는 표기(`1990-05-12 (생년월일)`)는 보호하지 않는다**(코드 리뷰 보통 2) | **설계 수용 사항으로 기록, 별도 PM 확인 대기** — 판정이 "날짜 앞" 한 방향만 보는 설계의 결과. 현행 동작을 손 작성 골든에 고정해 두고 PM 결정 시 갱신 | 날짜 뒤 같은 줄 짧은 창(예: 16글자)에서 `(생년월일)`·`(생일)`류 닫힌 주석만 추가 인정 — 판정 함수 1곳 확장 · 골든 갱신 | **PM 확인 대기 · 중** |
| U-15 | 규칙 버전 v2 유지(§5.5-5) — 2차 확장 전 v2가 배포된 환경이 있었는가 | v2 유지(미배포 전제) | 배포 이력이 있으면 v3 | **확인됨(2026-10-01): v2 유지** — `git log`상 `packages/pii-mask/src/index.ts`에 `PII_MASK_RULES_VERSION` 도입 커밋이 없고(HEAD에 상수 없음, 작업 트리에만 `= 2` 존재·미커밋), 시연·운영 어디에도 배포된 적 없음 · 낮음 |

---

## 8. 상위 문서 갱신(패치 파일 목록)

- `…-patches.md`(적용 완료) · `…-patches-2.md`(적용 완료).
- `docs/02-spec/pm-decisions-2026-10-01-patches-3.md`(**적용 대기**): 적용분 중 "구분 문자 3개 이하"·"닫힌 키워드 6"·키워드 나열 문구를 2차 규칙으로 고침(ADR-0013 · 개발명세서 · ai-guardrails-설계 · 자동배포 · ai-guardrails-ui-spec) + 결함분류에 후보 K-1c·K-1d·L-6 등록.

## 9. 변경 이력

- **2026-10-01 작성** — system-architect. PM 결정 4건 반영. 새 관찰 K-1c. ADR-0049 신설.
- **2026-10-01 갱신 ①** — U-1 확정(§5.2-B) · U-4 수용 · 골든 재산정(23건 그대로 · 손 작성 문맥 골든) · U-12·U-13 · `patches-2`.
- **2026-10-01 갱신 ②** — 코드 리뷰 + PM 2차 결정: §5.2-B 확장(키워드 7 — `birth date` · 구분 문자 `-` `/` `~`·하이픈 변형·빼기·물결·곡선 따옴표·낫표 · 상한 3 → 6 · 닫힌 주석 `(양력)`/`(음력)`/`[양력]`/`[음력]` 1회 · 보이지 않는 문자 제거 · 창 24 → 32 · ASCII 하이픈 경계 규칙) · 선택 경로 날짜 자리표시 제거 기록(날짜에 붙은 이메일 더 가림) · 규칙 버전 v2 유지(조건부) · 문맥 골든 기존 66건 중 2건 변경 + 새 케이스 · storage-corpus 23건 불변 재확인 · 이전부터 있던 시험 닫힌 목록 5건 불변 · U-14(날짜 뒤 문맥 — 설계 수용, PM 확인 대기)·U-15 · 결함 후보 K-1d(폴백 G1 예외)·L-6(이메일 정규식 2차 시간) · `patches-3`.
