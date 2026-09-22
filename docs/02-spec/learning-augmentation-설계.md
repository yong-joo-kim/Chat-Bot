# 학습 고도화 — 예문 증강(No.16) · 미응답 요소분해 + 경량 분류기(No.23) 세부 설계서

> **요구사항**: `docs/requirements/learning-augmentation.md`(FR-0-49~58, FR-L1-*, FR-L2-*, FR-L3-*, NFR-L*, AC-L1~L4, EX-L1/L2)
> **상위 문서**: `docs/02-spec/개발명세서.md` §1·§2·§3·§4·§5·§6(결정 30)
> **신규 ADR**: **ADR-0025**(증강 산출물·제안/자산 봉인) · **ADR-0026**(3-포트 증강 Provider) · **ADR-0027**(경량 분류기·`TrainingJob`) · **ADR-0028**(형태소 분석기)
> **갱신 ADR**: **ADR-0018 보론**(인계 지점 무교체·교체 조건 정정) · **ADR-0024 갱신**("추론 전용" 정밀화·`TrainingJob` 도입·GPU 트리거 철회) · **ADR-0013 각주**(PII 마스킹 지점 2 → 3)
> **선행 설계서**: `stats-learning-설계.md`(No.14~15) · `nlu-rag-answering-설계.md`(No.18·30) — 이 그룹은 두 문서의 자산을 **소비**하며 재설계하지 않는다.
> **작성일**: 2026-09-22 · **다음 단계**: `ui-designer` → `ml-engineer` / `backend-implementer` → `frontend-implementer` → `code-reviewer` → `test-automation`

---

## 1. 범위와 전제

### 1.1 이 그룹이 바꾸는 것

| 축 | 변경 |
|---|---|
| **신규 모듈** | `apps/api/src/augmentation`(증강) · `apps/api/src/classifier`(분류기) · `apps/api/src/training-jobs`(비동기 작업 상태) |
| **확장 모듈** | `apps/api/src/learning`(요소분해 · 통합 반영 · 추천 출처 분기) |
| **신규 테이블** | `AugmentationSuggestion` · `IntentClassifierModel` · **`TrainingJob`**(2회 보류 끝에 첫 쓰기 주체 확보) |
| **기존 테이블** | **변경 0건.** `Intent`·`Keyword`·`EmbeddingVector`·`UnansweredQuestion`·`ChatbotAnswerSetting` 스키마를 건드리지 않는다 |
| **`apps/ml-worker`** | 역할 정의 확대(임베딩 추론 → ML 추론) + **선택적** `POST /augment`. **`/embed`·`/health` 계약 무변경** |
| **`packages/dialogue-engine`** | **변경 0줄.** `ResolveOptions`에 필드를 추가하지도 않는다(FR-0-49, NFR-LM3) |
| **`apps/widget`** | **변경 0줄.** 전부 관리자 콘솔 기능이다 |
| **공개 API** | **변경 0건.** `@Public()` 핸들러 수는 **여전히 정확히 6개**(FR-0-58, AC-L4-4) |
| **신규 의존성** | ① 형태소 분석기(**선택적** · 미설치 시 폴백 — ADR-0028) ② 외부 HTTP 출구 1곳 추가(Gemini — ADR-0026). **필수 의존성 추가 0건** |

### 1.2 PM 확정 사항 (이 설계의 입력)

| # | 확정 내용 | 반영 위치 |
|---|---|---|
| P-1 | **No.16 = 데이터 증강 파이프라인**(파인튜닝 아님). 산출물은 `Intent.examples`에 편입될 문장 | ADR-0025 §1 · §10 |
| P-2 | 기존 임베딩으로 **자기 검증**(의미보존 0.75~0.97 · 신규성 <0.95 · 타의도 충돌 경고 · 금지어). **검증 불가 시 증강 거부**(저하 모드 없음) | ADR-0025 §3·§4 · §10.3 |
| P-3 | **형태소 분석기를 도입**한다(요구사항 J-10 번복). 프로젝트 최초의 네이티브 의존성 — **구축형 설치 영향을 명시** | ADR-0028 · §6·§11 |
| P-4 | **경량 분류기는 미응답 큐의 추천 의도 전용.** 대화 매칭에 절대 연결하지 않는다 | ADR-0027 §2 · §12 |
| P-5 | 증강 생성기는 **3종 포트**. G1 규칙(기본) · **G2 = Google Gemini**(키는 추후 주입, 지금은 껍데기까지 · 키 없이 기동) · **G3 로컬 생성모델**(24GB+ GPU 보유, 후보 3종 5지표 실측 인계) | ADR-0026 · §4·§5 |
| P-6 | **ml-worker는 추론 전용 유지.** 분류기 학습은 `apps/api` CPU. ADR-0024는 **갱신**(폐기 아님) | ADR-0024 갱신 · ADR-0027 §3 · §5 |
| P-7 | **"관리자 확인 후"를 구조로 강제** — 제안과 자산을 분리하고 승격 경로를 정적 검사로 봉인 | ADR-0025 §5 · §13 |
| P-8 | ADR-0018/개발명세서의 **"Job 큐 적재로 교체" 예고를 정정** — `appliedImmediately`는 계속 `true` | ADR-0018 보론 · §14 |

### 1.3 전제(이 그룹이 건드리지 않는 것)

- **엔진 순수성**(ADR-0008/0020) · **3구간 임계값**(ADR-0021) · **RAG 봉인**(ADR-0022) · **비동기 보류 답변**(ADR-0023) · **권한 14종·역할 3종**(ADR-0015) · **감사 단일 진입점**(ADR-0016) · **PII 마스킹 1벌**(ADR-0013) · **정규화 단일 소스**(ADR-0006) · **영구삭제 참조 무결성**(ADR-0002).
- **예문 상한 500 · 동의어 상한 200 · dedupe · 충돌 검사 · 감사 스냅샷**의 소유자는 `IntentsService`/`KeywordsService`다. 이 그룹은 **호출만 하고 복제하지 않는다**(FR-0-51, NFR-LM2).

---

## 2. 설계 결정 일람 (DD-91 ~ DD-114)

| # | 결정 | 근거 / 참조 |
|---|---|---|
| **DD-91** | No.16의 산출물은 **데이터**(예문)이며 모델이 아니다. 파인튜닝 제외 | ADR-0025 §1 |
| **DD-92** | 생성 문장은 **기존 임베딩 5종 검사**로 자기 검증한다. 신규 추론 인프라 0 | ADR-0025 §3 |
| **DD-93** | 검증 불가(임베딩 없음·`modelId` stale) 시 **증강을 거부**한다. 저하 모드를 만들지 않는다 | ADR-0025 §4 |
| **DD-94** | 검증 임계값은 **`modelId` 종속 코드 상수 1곳**. 챗봇별 설정으로 노출하지 않는다 | ADR-0021 §5 규약 재사용 |
| **DD-95** | 제안(`AugmentationSuggestion`)과 자산(`Intent.examples`)을 **다른 저장소**에 두고 승격 경로를 **관리자 요청 핸들러 1곳**으로 봉인한다 | ADR-0025 §5 |
| **DD-96** | 봉인은 **모듈 그래프(DI)에서 끊고 정적 검사로 단언**한다 — Job 실행 모듈은 `IntentsModule`/`KeywordsModule`을 import하지 않는다 | §13, AC-L4-3 |
| **DD-97** | `AugmentationProvider` **포트 1 + 구현 3**(`rule`/`gemini`/`local`) + Mock. 교체 지점은 팩토리 1곳 | ADR-0026 §1 |
| **DD-98** | Provider 선택은 **인스턴스 설정**(환경변수)이며 챗봇별 설정이 아니다 | ADR-0026 §1 |
| **DD-99** | 네트워크 Provider는 **PII 마스킹 → 금지어 → 타임아웃 → 회로차단 → zod 파싱** 5단계를 강제 통과한다. PII 함수는 **여전히 1벌**(적용 지점 2 → 3) | ADR-0026 §3, ADR-0013 갱신 |
| **DD-100** | **Gemini는 공식 SDK를 쓰지 않고 `fetch` + zod로 직접 호출**한다(통제 일관성) | ADR-0026 §4 |
| **DD-101** | ml-worker에 **실행 프로파일**(`ML_WORKER_ROLE=embed｜augment｜both`, 기본 `embed`) 도입. 운영 기본은 **프로세스 분리** | ADR-0026 §5, ADR-0024 갱신 §1 |
| **DD-102** | `packages/llm-provider`는 **계속 미생성**. 포트는 `apps/api/src/augmentation/providers/`에 둔다(소비자 1곳). 승격 트리거 = 소비자 2곳 | ADR-0026 §6, ADR-0024 §7 |
| **DD-103** | 형태소 분석기는 **선택적 의존성**이며 `MorphAnalyzerPort` + **휴리스틱 폴백(M0)** 을 항상 갖는다 | ADR-0028 §1·§2 |
| **DD-104** | 요소분해는 **순수 함수**이며 형태소 토큰·gazetteer·불용어를 **인자로 주입**받는다(ADR-0020의 점수 주입과 같은 패턴) | ADR-0028 §3 |
| **DD-105** | 분해 결과는 **저장하지 않고 조회 시 계산**한다. 관리자 수정본은 반영 요청 본문으로 온다 | FR-L2-4 |
| **DD-106** | 분류기 = **저장된 임베딩 위의 다항 로지스틱 회귀**. 재임베딩 0 · 외부 ML 라이브러리 0 · **결정론적** | ADR-0027 §1 |
| **DD-107** | 분류기의 소비자는 **미응답 추천 의도 1곳**. 대화 경로는 조회하지 않으며 엔진에 심볼 0건 | ADR-0027 §2 |
| **DD-108** | 분류기 학습은 **`apps/api` 안 CPU**. ml-worker로 보내지 않는다(데이터 이동 0) | ADR-0027 §3 |
| **DD-109** | **`TrainingJob` 도입.** Redis/BullMQ는 미도입, in-process 큐 + **기동 시 고아 Job 정리** | ADR-0027 §4 |
| **DD-110** | Job 적재는 **Provider 특성으로 분기하지 않고 항상 적재**한다. 응답은 항상 `202 { jobId }` | ADR-0027 §4-1 |
| **DD-111** | 분류기 모델은 **챗봇당 1행**, 가중치는 **벡터와 같은 base64 Float32 코덱 1벌** 재사용, **원자적 1회 쓰기** | ADR-0027 §6 |
| **DD-112** | 제안 stale 판정에서 **"예문 변경"을 빼고 승인 시점 재검증**으로 대체한다(FR-L1-23 정밀화) | ADR-0025 §6 |
| **DD-113** | `applyLearning()`을 **교체하지 않는다.** `reason` 유니온 2종 확장만. `appliedImmediately`는 계속 `true` | ADR-0018 보론 |
| **DD-114** | 추천 산출은 **분류기 우선 · 실패 시 bigram**이며 **섞지 않는다.** 응답에 `source`를 실어 화면이 출처를 말한다 | ADR-0027 §2 |

---

## 3. 전체 파이프라인

```
■ No.16 — 예문 증강 (의도 단위 · 관리자 트리거 · 비동기)

 [대화설계 > 의도 상세]  "예문 늘리기"
        │  POST /chatbots/:c/intents/:i/augmentations           → 202 { jobId }
        ▼
  TrainingJobQueue (in-process · 챗봇+의도당 1건)   kind=AUGMENT
        │
        ├─▶ AugmentationProviderFactory.get()    ── rule | gemini | local | mock
        │      requiresNetwork=true → PII 마스킹 → 금지어 → 30s 타임아웃 → 회로차단 → zod
        │      실패·빈 응답 → G1 폴백(기능 정지 없음)
        ▼
   원시 후보 N건 (targetCount×3 상한)
        │
        ├─▶ ★ 자기 검증 (기존 EmbeddingProvider 재사용 · 배치 1회)
        │      ① 0.75 ≤ cos(후보, 시드) ≤ 0.97      ② max cos(후보, 기존예문) < 0.95
        │      ③ max cos(후보, 타의도예문) ≥ τ_accept → 경고(차단 아님)
        │      ④ 금지어  ⑤ 길이·제어문자·한국어  ⑥ 자기중복 1건만
        │      임베딩 불가 → **작업 FAILED + 503 AUGMENTATION_UNAVAILABLE**(저하 없음)
        ▼
   AugmentationSuggestion (PENDING)  ◀── ★ 대화에 아무 영향 없음 · 자산 아님
        │
        ▼   GET .../augmentations  (제안 + 검증 요약 { generated, accepted, rejected{reason:count} })
 [관리자 확인 화면] 체크박스 선택(전체선택 기본 OFF · 충돌 배지 행은 전체선택에서 제외)
        │
        ▼   POST .../augmentations/accept { suggestionIds[] }   ★ 자산 승격 유일 경로(동기)
   승인 시 재검증(정규화 중복 · 신규성 코사인) → 건별 IntentsService.applyLearningExample()
        │                                          (dedupe · 상한 500 · 충돌 · 감사 · 색인 예약)
        ▼
   LearningApplyService.applyLearning({ reason:'AUGMENTATION_ACCEPT' })  ── 요청당 1회
        │   반환값 { mode:'IMMEDIATE', appliedImmediately:true, jobId:null }  ← 교체하지 않는다
        ▼
   다음 턴부터 1단계 의미 매칭의 비교 대상이 넓어진다


■ No.23 — 미응답 요소분해 + 경량 분류기

 (A) 요소분해  GET .../unanswered-questions/:id/decomposition   (조회 시 계산 · 저장 없음)
        MorphAnalyzerPort.analyze()  ┐
        gazetteer(Keyword+synonyms+Homonym) ├─▶ decompose() [순수 함수] ─▶ 스팬 칩 + 역할 3종
        불용어 사전                   ┘                                    + analyzerId
        │
        ▼  POST .../unanswered-questions/:id/resolve-decomposed
        ① 예문 반영(기존 resolve 코어 재사용) → ② 엔티티 반영(KeywordsService, ≤10건)
        → ③ 상태 전이(CAS) → ④ applyLearning() 1회
        응답: { linkedNodeCount, keywordLinkedNodeCount, ... }   ← "키워드 미파악" 분기를 닫는다

 (B) 추천 품질  POST .../intent-classifier/train → 202 { jobId }   kind=CLASSIFIER_TRAIN
        저장된 EmbeddingVector(INTENT_EXAMPLE/NAME) + 라벨(intentId)
            → 다항 로지스틱 회귀(CPU · 결정론) → IntentClassifierModel 1행(원자적 upsert)
        미응답 목록/상세 조회 시:
            분류기 READY & !stale → probs (source:'CLASSIFIER')
            아니면                → bigram 자카드 (source:'LEXICAL')
        ★ resolveTurn()은 이 모델을 조회하지 않는다
```

---

## 4. `AugmentationProvider` 포트와 구현 3종 (ADR-0026)

### 4.1 포트 계약

```ts
// apps/api/src/augmentation/providers/augmentation-provider.port.ts
export type AugmentationProviderId = 'rule' | 'gemini' | 'local' | 'mock';

export interface AugmentationProvider {
  readonly providerId: AugmentationProviderId;
  readonly requiresNetwork: boolean;
  generate(input: { seeds: readonly string[]; targetCount: number; locale: 'ko' }): Promise<readonly string[]>;
  healthy(): Promise<boolean>;
}
```

**계약 규약 5건**

| # | 규약 |
|---|---|
| C-1 | `generate()`는 **예외를 전파하지 않는다.** 실패·타임아웃·스키마 불일치·회로 open은 **빈 배열**로 수렴한다(FR-0-54) |
| C-2 | 반환값은 **검증 전 원시 후보**다. 이 값이 그대로 제안이 되는 경로는 없다(FR-L1-8) |
| C-3 | 결정론을 요구하지 않는다(G2/G3는 본질적으로 비결정론적). **대신 검증 규칙이 결정론적**이어야 하며 단위 테스트 대상이다(FR-L1-9) |
| C-4 | `healthy()`는 예외를 던지지 않는다. `false`면 팩토리가 G1으로 저하한다 |
| C-5 | 포트 파일은 **Nest 데코레이터·Prisma 타입에 의존하지 않는다** — `packages/llm-provider` 승격 시 파일 이동만으로 끝나게 한다(DD-102) |

### 4.2 구현체

| 파일 | 내용 |
|---|---|
| `rule-augmentation.provider.ts` (**기본값**) | 어미·종결형 변형 · 조사 교체 · **`Keyword.synonyms`·`HomonymDictionary` 동의어 치환** · 띄어쓰기/어순 변형 · 경어↔구어. 변형 규칙표는 `lib/rule-variants.ts`(순수 함수, **사전은 인자 주입**) |
| `gemini-augmentation.provider.ts` | **외부 HTTP 출구 3번째.** `fetch` + zod. 프롬프트는 `lib/gemini-prompt.ts` 상수 1곳이며 시드는 **구조화 JSON 필드로만** 전달(지시문 위치에 사용자 입력이 들어가지 않는다) |
| `local-augmentation.provider.ts` | ml-worker `POST /augment` 호출. `apps/api`는 모델·서빙 엔진·프롬프트를 알지 못한다 |
| `mock-augmentation.provider.ts` | 결정론적 후보 N건. **외부 자원·GPU 없이 전 테스트 통과**(NFR-LM7, AC-L4-12) |
| `augmentation-provider.factory.ts` | ★ **교체 지점 1곳.** `AUGMENTATION_PROVIDER` + 가용성 판정으로 인스턴스 1종만 생성한다 — `rule` 구성에서 G2/G3는 **인스턴스화조차 되지 않는다**(AC-L1-14) |

### 4.3 가용성 판정과 저하 보고

```ts
type AugmentationCapability = {
  providerId: AugmentationProviderId;          // 실제로 사용될 Provider
  configuredProviderId: AugmentationProviderId; // 설정값
  degraded: boolean;                            // configured ≠ provider
  degradeReason?: 'API_KEY_MISSING' | 'UNHEALTHY' | 'CIRCUIT_OPEN';
  embeddingReady: boolean;                      // false면 증강 요청이 503으로 거부된다
  requiresNetwork: boolean;
};
```

`GET /chatbots/:chatbotId/augmentations/capability`(`dialogue:read`)로 노출한다. **조용한 저하를 만들지 않는 것**이 목적이다 — 화면이 "왜 품질이 낮은가 / 왜 버튼이 막혔는가"를 먼저 말한다(UIUX §7).

---

## 5. `apps/ml-worker` 역할 확대 (ADR-0024 갱신)

### 5.1 실행 프로파일

| `ML_WORKER_ROLE` | 로드 | 노출 엔드포인트 | 용도 |
|---|---|---|---|
| `embed` (**기본값**) | 임베딩 모델만 | `/embed`, `/health` | **현행과 100% 동일** |
| `augment` | 생성 모델만 | `/augment`, `/augment/health` | **운영 권장 구성**(별도 프로세스·별도 포트) |
| `both` | 둘 다 | 4개 전부 | 개발 편의용. **대화 성능 예산을 보장하지 않는다** |

- **`/embed`·`/health`의 요청·응답 스키마는 바이트 단위로 변경하지 않는다**(FR-L2-37). 생성 프로파일이 꺼져 있으면 `/augment`는 **존재하지 않는다**(404) — `/health` 응답에 필드를 추가해 계약을 흔들지 않는다.
- ml-worker 부재 시 `apps/api` 정상 기동 규약은 유지된다. 생성 프로파일 부재 → 증강은 G1으로 동작.
- **ml-worker는 DB에 접근하지 않는다**(불변).

### 5.2 `POST /augment` 계약

```
POST /augment
  { seeds: string[](1~20), targetCount: int(1~60), locale: 'ko' }
→ { modelId: string, candidates: string[] }        // 검증 전 원시 후보
GET /augment/health
→ { status: 'ok'|'loading', modelId, device, warmedUp }
```

- 배치 상한·타임아웃·빈 문자열 거부는 `/embed`와 **같은 방어 규약**을 따른다.
- 생성 실패·상한 초과는 4xx/5xx이며, `apps/api`의 `local` Provider가 이를 **빈 배열로 수렴**시킨다(C-1).

### 5.3 GPU 자원 배분 (ml-engineer 인계)

- 임베딩 모델과 생성 모델이 **같은 GPU를 공유하면 대화 경로 `EMBEDDING_TIMEOUT_MS=300` 예산이 관리자 작업에 밀린다.** 24GB+ VRAM이라도 **프로세스 분리 + VRAM 상한 지정**을 기본 구성으로 한다.
- 후보 20건을 **1회 배치**로 생성한다(문장별 호출 금지). 서빙 엔진(vLLM 등) 선택과 배치 파라미터는 ml-engineer가 §21의 5지표로 확정한다.

---

## 6. 형태소 분석기 (ADR-0028)

### 6.1 배치

```
apps/api/src/learning/morph/
├── morph-analyzer.port.ts        # analyzerId · ready · analyze(text): MorphToken[]  (동기)
├── morph-analyzer.factory.ts     # ★ 교체 지점 1곳. MORPH_ANALYZER + 로드 성공 여부로 선택
├── heuristic-analyzer.ts         # M0 — 공백 + 조사/어미 절단. 의존성 0. **기본 폴백**
└── <선정 분석기>-analyzer.ts      # M1(WASM 우선) 또는 M2(네이티브). 기동 시 1회 비동기 로드
```

- **로드 실패·미설치 = `ready:false` → 팩토리가 M0로 내려간다.** API 기동은 절대 실패하지 않는다.
- 분해 응답에 **`analyzerId`를 실어** 화면이 "정밀 분석 사용 중 / 기본 분해"를 구분해 표시한다 — **조용한 품질 차이를 만들지 않는다.**
- 전 테스트는 **M0 기본값으로 통과**해야 한다(CI에 네이티브 툴체인을 요구하지 않는다).

### 6.2 구축형 설치 영향 (배포 문서 반영 필수)

| 항목 | 영향 | 완화 |
|---|---|---|
| 설치 절차 | +1단계(분석기 모듈·사전 파일) | **선택 단계**. 설치하지 않아도 기동·동작 |
| 오프라인(폐쇄망) | 레지스트리 접근 불가 | 설치 패키지에 **사전·바이너리 동봉** + `MORPH_DICT_PATH` 주입 |
| 배포 크기 | 사전 수십 MB | 선택 구성요소로 분리 — 기본 패키지 크기 불변 |
| 플랫폼 종속 | Windows/Linux, Node ABI(M2 채택 시) | **M1(WASM) 우선 채택으로 회피** |
| 기동 시간 | 사전 로드 수백 ms~수 초 | 비동기 로드. 완료 전 요청은 M0로 응답 |

---

## 7. 데이터 모델 변경 (개발명세서 §3 확장)

### 7.1 `AugmentationSuggestion` — 신설

```prisma
/// [신규] 증강 제안 격리 저장소(ADR-0025 §5). **이 테이블의 어떤 행도 대화 동작에 영향을 주지 않는다.**
/// 자산(`Intent.examples`)으로의 승격 경로는 관리자 요청 핸들러 1곳뿐이다.
model AugmentationSuggestion {
  id               String   @id @default(uuid())
  chatbotId        String
  chatbot          Chatbot  @relation(fields: [chatbotId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  /// Intent.id. **FK를 걸지 않는다** — 걸면 제안이 있는 의도를 영원히 삭제할 수 없다
  /// (`EmbeddingVector.ownerId`와 동일한 의도적 예외, 개발명세서 §3.1).
  intentId         String
  text             String
  /// normalizeText(text). 재제안 흡수 + 승인 시 중복 판정 키(ADR-0006 규약 재사용).
  textNormalized   String
  /// 시드와의 코사인(검증 ①). 화면이 수치 + 텍스트 라벨로 병기한다(NFR-LA3).
  similarityToSeed Float
  /// 검증 ③ 경고. FK 없음. 값이 있으면 화면에 충돌 배지 + 기본 선택 해제(FR-L1-15).
  conflictIntentId String?
  conflictScore    Float?
  /// 'rule' | 'gemini' | 'local' | 'mock' — 어떤 생성기가 만든 문장인지 화면·감사 추적용.
  providerId       String
  /// 검증에 사용한 임베딩 modelId. 현재 modelId와 다르면 stale이며 승인할 수 없다.
  modelId          String
  /// PENDING | ACCEPTED | REJECTED (zod AugmentationSuggestionStatus가 값 제약 단일 소스)
  status           String   @default("PENDING")
  /// 이 제안을 만든 작업. 검증 요약 재조회·문제 추적용. FK 없음.
  jobId            String?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  /// 같은 의도에 같은 문장이 다시 제안되는 것을 흡수한다(EX-L1-11).
  /// REJECTED 이력이 있으면 재제안되지 않는다 — 의도된 동작이다.
  @@unique([intentId, textNormalized])
  @@index([chatbotId, intentId, status, createdAt])
  @@index([chatbotId, status])
  @@map("augmentation_suggestions")
}
```

- **챗봇당 `PENDING` 상한 기본 500**(`AUGMENTATION_MAX_PENDING`). 초과 시 신규 생성을 거부하고 정리를 안내한다(EX-L1-9 — 미응답 큐 상한 규약과 동일).
- **물리 삭제 API 없음**(`REJECTED`로 대체). 챗봇 영구삭제 시 **동반 삭제**(파생 데이터 — ADR-0002).

### 7.2 `IntentClassifierModel` — 신설 (챗봇당 1행)

```prisma
/// [신규] 챗봇별 경량 의도 분류기(ADR-0027). **대화 경로는 이 테이블을 조회하지 않는다.**
/// 소비자는 미응답 큐의 추천 의도 1곳뿐이다. 버전 이력·A/B·롤백은 범위 밖(FR-L2-20).
model IntentClassifierModel {
  chatbotId    String   @id
  chatbot      Chatbot  @relation(fields: [chatbotId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  /// 학습에 쓴 임베딩 modelId. 현재 값과 다르면 **즉시 사용 중지**(입력 공간이 다르다).
  modelId      String
  dimension    Int
  /// JSON string[] — 클래스 순서 = 가중치 행 순서. 삭제된 의도는 조회 시 제외한다(EX-L2-12).
  classIds     String
  /// base64(Float32Array little-endian) [classCount × dimension] row-major.
  /// EmbeddingVector.vector와 **같은 코덱 1벌**(embedding/lib/vector-codec.ts)을 재사용한다.
  weights      String
  /// base64(Float32Array) [classCount]
  bias         String
  classCount   Int
  sampleCount  Int
  /// 홀드아웃 정확도(샘플 50건 이상일 때만). 없으면 null — 화면이 "측정 안 됨"으로 표시한다.
  accuracy     Float?
  trainedAt    DateTime @default(now())
  /// stale 판정 ②③의 기준선. 학습 시점의 의도 수와 예문 총량.
  intentCountAtTrain  Int
  exampleCountAtTrain Int

  @@map("intent_classifier_models")
}
```

- **원자적 1회 쓰기**(`upsert`) — 학습 중 서버가 죽어도 반쯤 쓰인 모델이 남지 않는다(EX-L2-7).
- 산출물 크기 상한 기본 8MB 초과 시 학습 중단 + `422`(FR-L2-19). 의도 300 × 1024차원 ≈ 1.2MB로 여유가 크다.
- 챗봇 영구삭제 시 **동반 삭제**.

### 7.3 `TrainingJob` — 신설 (2회 보류 끝에 첫 쓰기 주체 확보)

```prisma
/// [신규] 비동기 작업 상태(ADR-0027 §4). **첫 쓰기 주체가 생겼다** — ADR-0004 기준 통과.
/// ⚠ 이 테이블은 `LearningApplyService.applyLearning()`과 **무관**하다. 대화 자산 반영은
/// 여전히 승인 요청 핸들러 안에서 즉시 일어난다(ADR-0018 보론).
model TrainingJob {
  id             String   @id @default(uuid())
  chatbotId      String
  chatbot        Chatbot  @relation(fields: [chatbotId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  /// AUGMENT | CLASSIFIER_TRAIN (zod TrainingJobKind가 값 제약 단일 소스)
  kind           String
  /// AUGMENT면 Intent.id. FK 없음(로그성 스냅샷).
  targetId       String?
  /// QUEUED | RUNNING | SUCCEEDED | PARTIAL | FAILED
  status         String   @default("QUEUED")
  /// 0~100. 생성·검증·학습 단계에서 실제로 변한다.
  progress       Int      @default(0)
  /// JSON. **문장 원문을 담지 않는다**(NFR-LS4) — 건수·사유 분포·소요시간만.
  /// AUGMENT:  { generated, accepted, rejected: { SEMANTIC_DRIFT: n, ... }, providerId, degraded }
  /// CLASSIFIER_TRAIN: { classCount, sampleCount, accuracy, elapsedMs }
  resultSummary  String?
  /// 오류 코드성 문자열(외부 오류 원문·스택을 담지 않는다).
  failureReason  String?
  startedAt      DateTime?
  finishedAt     DateTime?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@index([chatbotId, kind, status])
  @@index([chatbotId, createdAt])
  @@map("training_jobs")
}
```

- **기동 시 고아 Job 정리**: `status ∈ {QUEUED, RUNNING}` 행을 `FAILED(failureReason:'SERVER_RESTART')`로 전이한다. 단일 인스턴스 전제이므로 안전하며, **이것이 `FAILED`가 실제로 발생하는 경로 중 하나**다(EX-L2-7).
- **보존기간 정책·정리 배치는 범위 밖**(스케줄러 인프라 부재 — No.45).
- 챗봇 영구삭제 시 **동반 삭제**.

### 7.4 마이그레이션 영향 분석

| 항목 | 판정 |
|---|---|
| **기존 테이블 변경** | **0건.** 컬럼 추가·타입 변경·제약 변경이 없다 |
| **백필** | **불필요.** 3개 테이블 모두 신규이며 초기 상태 = 0행 = "기능 미사용" |
| **기존 데이터 호환성** | **완전 호환.** 제안 0행 → 증강 화면 빈 상태, 분류기 0행 → 추천이 기존 bigram으로 동작(현행과 동일), Job 0행 → 이력 없음 |
| **롤백** | 3개 테이블 `DROP`만으로 완전 복귀. **대화 자산에 흔적이 남지 않는다**(승인된 예문은 일반 예문과 구분되지 않으며, 그 자체가 정상 자산이다) |
| **다운그레이드 중 쓰기 충돌** | 없다. 신규 테이블에만 쓴다 |
| **배포 순서** | ① 마이그레이션(테이블 3개) → ② API 배포(환경변수 미설정 = 기능 비활성에 가까운 기본 구성) → ③ 웹 배포 → ④ 분석기·생성모델은 **선택 구성요소로 나중에** |
| **감사 영향** | `AuditTargetType` **확장 0건**(기존 `Intent`/`Keyword`만 사용) |

> **`Chatbot` 모델에 relation 3개가 추가**된다(Prisma 양방향 관계 표기). 이는 스키마 표기 변경이며 **DB 컬럼 변경이 아니다**.

---

## 8. `packages/shared-types` 배치

`packages/shared-types/src/learning.ts`에 **append**한다(ADR-0003 §9 — 학습 도메인 파일이 이미 있다). **새 도메인 파일을 만들지 않는다.**

| 스키마 | 내용 |
|---|---|
| `AugmentationSuggestionSchema` | `{ id, text, similarityToSeed, conflictIntent?: { id, name, score }, status, providerId, stale, createdAt }` |
| `AugmentationRejectReasonSchema` | `'SEMANTIC_DRIFT' \| 'NEAR_DUPLICATE' \| 'DUPLICATE_OF_EXISTING' \| 'BANNED_WORD' \| 'INVALID_FORMAT'` (5종) |
| `AugmentationRunResultSchema` | `{ generated, accepted, rejected: Record<reason, number>, providerId, degraded, degradeReason? }` |
| `AugmentationCapabilitySchema` | §4.3 |
| `AugmentationAcceptRequest/ResponseSchema` | `{ suggestionIds: string[](1~50) }` / `{ succeeded, failed: [{ id, code, message }], appliedImmediately, linkedNodeCount }` |
| `DecompositionSpanSchema` | `{ start, end, text, role, matchedKeyword?: { id, name, viaSynonym } }`, `role ∈ ENTITY_CANDIDATE｜INTENT_SIGNAL｜IGNORED` |
| `DecompositionResponseSchema` | `{ spans, analyzerId, version }` |
| `DecomposedResolveRequestSchema` | `{ intentId?, intentName?, exampleText?, spans?, entities: [{ action:'ADD_SYNONYM'｜'CREATE', keywordId?, name?, synonym }](≤10) }` |
| `IntentClassifierStatusSchema` | `{ state: 'NONE'｜'TRAINING'｜'READY'｜'FAILED', modelId?, trainedAt?, classCount, sampleCount, accuracy?, stale, staleReasons: ('MODEL_CHANGED'｜'INTENTS_DRIFTED'｜'EXAMPLES_DRIFTED')[] }` |
| `TrainingJobSchema` | `{ id, kind, targetId?, status, progress, resultSummary?, failureReason?, startedAt?, finishedAt? }` |
| **기존 스키마 확장** | `IntentSuggestionSchema`에 **`source: 'CLASSIFIER' \| 'LEXICAL'` 선택 필드 추가**(하위호환) · `LearningApplyReason`에 **값 2종 추가** |
| `ApiErrorCode` | **6종 추가** — `AUGMENTATION_UNAVAILABLE`, `AUGMENTATION_IN_PROGRESS`, `SUGGESTION_EXPIRED`, `CLASSIFIER_INSUFFICIENT_DATA`, `CLASSIFIER_NOT_TRAINED`, `CLASSIFIER_STALE_MODEL` |

---

## 9. NestJS 모듈 구조 (개발명세서 §2.1·§2.2 확장)

### 9.1 파일 배치

```
apps/api/src/
├── augmentation/                          # [신설] No.16
│   ├── augmentation.controller.ts         # 5 핸들러(생성·목록·capability·accept·reject)
│   ├── augmentation.service.ts            # 생성 요청 접수 · 제안 목록 · stale 판정
│   ├── augmentation-accept.service.ts     # ★ 자산 승격 **유일 지점**(IntentsService 주입은 여기뿐)
│   ├── augmentation-job.runner.ts         # 생성 + 검증 실행(제안 테이블에만 쓴다)
│   ├── augmentation-suggestion.mapper.ts
│   ├── providers/                         # §4.2 (포트·팩토리·구현 4)
│   └── lib/
│       ├── validate-candidates.ts         # ★ 검증 5종 — 순수 함수(NFR-LM1)
│       ├── augmentation-thresholds.ts     # modelId → 임계값 매핑 상수 1곳(DD-94)
│       ├── rule-variants.ts               # G1 변형 규칙(사전 주입형 순수 함수)
│       ├── gemini-prompt.ts
│       └── asset-write-sealing.spec.ts    # ★ AC-L4-3 정적 검사
├── classifier/                            # [신설] No.23 (B)
│   ├── classifier.controller.ts           # 2 핸들러(train·status)
│   ├── classifier-training.service.ts     # 데이터 수집 → 학습 → 원자적 저장
│   ├── classifier-predict.service.ts      # 추천용 확률 산출(learning이 주입받는다)
│   ├── classifier-model.repository.ts
│   └── lib/{logistic-regression,softmax,stale-judge,model-codec}.ts   # 순수 함수
├── training-jobs/                         # [신설] 비동기 작업 상태
│   ├── training-jobs.controller.ts        # GET 1개
│   ├── training-job.service.ts            # 생성·전이·조회 · 기동 시 고아 정리
│   ├── training-job.queue.ts              # ★ in-process 큐(교체 지점 1곳)
│   └── training-job.mapper.ts
└── learning/                              # [확장] No.23 (A)
    ├── decomposition.service.ts           # 조회 시 계산(저장 없음)
    ├── decomposed-resolve.service.ts      # 통합 반영(기존 resolve 코어 공유)
    ├── morph/                             # §6.1
    └── lib/{decompose,josa-endings,stopwords}.ts   # 순수 함수
```

### 9.2 모듈 의존 방향 (단방향 · 순환 없음)

```
augmentation ──▶ embedding(포트·코덱·벡터캐시) ──▶ (ml-worker)
     │
     ├──▶ training-jobs           (작업 상태 적재)
     ├──▶ banned-words            (금지어 필터)
     ├──▶ chatbots                (ChatbotScopeService)
     └──▶ intents ★               ← **augmentation-accept.service.ts 에서만** 주입된다

classifier ──▶ embedding(코덱·포트) ──▶ (ml-worker)
     └──▶ training-jobs
     ※ classifier는 intents/keywords **서비스를 주입하지 않는다**(Prisma 읽기만)

learning ──▶ intents / keywords / dialogue-common / chatbots   (기존)
     ├──▶ classifier            (추천 확률 — **읽기 전용 · 단방향**)
     └──▶ embedding             (질의 임베딩 배치 1회)

training-jobs ──▶ (없음)        ★ **intents·keywords·learning을 import하지 않는다**(DD-96)
```

**핵심 불변식 2건**

1. **`training-jobs`와 Job 실행기(`augmentation-job.runner.ts`)는 `IntentsModule`·`KeywordsModule`을 알지 못한다.** DI 그래프에 없으므로 "Job 완료 시 자동 승인" 코드는 **작성해도 컴파일되지 않는다**.
2. **역방향 참조 0건** — `classifier → learning`, `intents → augmentation`, `dialogue-engine → *` 모두 없다.

### 9.3 계층 규약 준수 (개발명세서 §2.1)

| 계층 | 이 그룹의 배치 |
|---|---|
| controller | 경로·상태코드·zod 파이프·`@RequirePermission`. **비즈니스 분기 없음** |
| service | 비즈니스 단일 진입점 + **`AuditLogService.record()` 명시 호출**(예문·키워드 변경에 한함) |
| mapper | Prisma row ↔ zod DTO(JSON 문자열 ↔ 객체, base64 ↔ Float32Array는 `lib` 코덱 경유) |
| `lib/*` | **DB·Nest 무의존 순수 함수** — 검증 5종 · 변형 규칙 · 요소분해 · 로지스틱 회귀 · stale 판정 · 모델 코덱. **단위 테스트 1차 대상**(NFR-LM1) |

**신규 원시 SQL 0건**(NFR-LM5, AC-L4-11) — 학습 데이터 수집도 Prisma `findMany` + 앱 내 조립이다.

---

## 10. No.16 증강 설계

### 10.1 생성 요청 (비동기)

| 단계 | 처리 |
|---|---|
| 1 | 권한(`dialogue:write`) → 챗봇 스코프(`assertWritable` — `ARCHIVED`는 `409 CHATBOT_ARCHIVED`) |
| 2 | **사전 거부 검사**: ① 임베딩 미가용·`modelId` stale → `503 AUGMENTATION_UNAVAILABLE`(DD-93) ② 같은 의도에 진행 중 작업 → `409 AUGMENTATION_IN_PROGRESS` ③ `PENDING` 상한 초과 → `409` ④ 예문 상한 500을 넘길 수 있는 요청 → `400`(생성 전에 거부 — FR-L1-4) |
| 3 | `TrainingJob(kind=AUGMENT, targetId=intentId, status=QUEUED)` 생성 → **`202 { jobId, status }`** 반환(DD-110) |
| 4 | 큐가 실행: 시드 조립(기존 예문 + 의도명) → `provider.generate({ targetCount: min(요청, MAX), ... })`(생성 시도는 상한의 최대 3배) |
| 5 | 검증(§10.3) → 통과분을 `AugmentationSuggestion(PENDING)`으로 **일괄 insert**(`@@unique` 충돌은 skip = 재제안 흡수) |
| 6 | Job → `SUCCEEDED`(1건 이상) / `PARTIAL`(생성은 됐으나 전부 탈락) / `FAILED`(Provider·임베딩 실패). `resultSummary`에 **검증 요약**(원문 없음) |

**예문 충분 안내**: 대상 의도의 현재 예문이 `AUGMENTATION_SUFFICIENT_EXAMPLES`(기본 10) 이상이면 화면이 "증강 이득이 작습니다"를 안내한다. **요청은 막지 않는다**(관리자 판단 존중 — FR-L1-2).

### 10.2 시드 구성

| 상황 | 시드 |
|---|---|
| 예문 N건(1 ≤ N ≤ 20) | 예문 전체 + 의도명 |
| 예문 20건 초과 | **최근 갱신 순 20건** + 의도명(프롬프트·규칙 입력 폭주 방지) |
| 예문 0건 | **의도명만.** 화면이 "품질이 낮을 수 있음"을 안내(EX-L1-1) |

### 10.3 자기 검증 (순수 함수 · 결정론)

```ts
// lib/validate-candidates.ts  — DB·Nest 무의존
validateCandidates(input: {
  candidates: readonly string[];
  candidateVectors: readonly Float32Array[];     // 배치 1회로 얻은 값(주입)
  seedVectors: readonly Float32Array[];          // 저장된 EmbeddingVector에서 로드(주입)
  existingExampleVectors: readonly Float32Array[];
  otherIntentVectors: readonly { intentId: string; intentName: string; vector: Float32Array }[];
  bannedWords: readonly string[];
  thresholds: { keepMin: number; keepMax: number; noveltyMax: number; acceptThreshold: number };
}): { accepted: AcceptedCandidate[]; rejected: Record<AugmentationRejectReason, number> }
```

| 검사 | 규칙 | 실패 |
|---|---|---|
| ① 의미 보존 | `keepMin ≤ max cos(후보, 시드ᵢ) ≤ keepMax` | `SEMANTIC_DRIFT` / `NEAR_DUPLICATE` |
| ② 신규성 | `max cos(후보, 기존 예문) < noveltyMax` | `DUPLICATE_OF_EXISTING` |
| ③ 타 의도 충돌 | `max cos(후보, 타 의도 예문) ≥ acceptThreshold` | **경고**(`conflictIntentId`/`conflictScore` 기록, 제외 아님) |
| ④ 금지어 | `BannedWord` 리터럴 매칭 | `BANNED_WORD` |
| ⑤ 형식 | 길이 1~200 · 정규화 후 비어있지 않음 · 제어문자 없음 · **한국어 판별**(EX-L1-10) · **PII 패턴 불포함**(EX-L1-5) | `INVALID_FORMAT` |
| ⑥ 자기 중복 | 요청 내 정규화 동일 또는 `cos ≥ keepMax` | 1건만 유지(카운트하지 않음) |

- **벡터 조달**: 후보는 배치 1회 임베딩(NFR-LP3), 기존·타 의도 예문 벡터는 **`VectorCacheService`에서 읽는다**(재임베딩 0 · N+1 금지).
- **임계값 기본값**(`AUGMENTATION_KEEP_MIN/_KEEP_MAX/_NOVELTY_MAX` = 0.75/0.97/0.95)은 **잠정값**이며 ml-engineer가 골든셋으로 실측 보정한다(§21).

### 10.4 제안 조회

`GET .../augmentations?status=PENDING&page=1&pageSize=20` → 공통 목록 봉투 + `runResult`(최근 작업의 검증 요약) + `capability`.

- `stale` 판정(조회 시 계산): ① `modelId` 불일치 ② TTL 경과 ③ 대상 의도 부재. **`stale` 제안은 승인할 수 없다**(`409 SUGGESTION_EXPIRED`).
- 기본 필터에서 `REJECTED` 제외.

### 10.5 승인 (★ 자산 승격 유일 경로 · 동기)

```
POST /chatbots/:c/intents/:i/augmentations/accept   { suggestionIds: string[](1~50) }
```

| 순서 | 처리 | 실패 정책 |
|---|---|---|
| 1 | 권한 · 스코프 · 제안 소유권(chatbotId·intentId 일치) 검증 | 불일치 `404` |
| 2 | `stale` 검사 | `409 SUGGESTION_EXPIRED` |
| 3 | **승인 시 재검증(DD-112)**: 정규화 중복 + 신규성 코사인 재계산 | 해당 건만 `DUPLICATE_OF_EXISTING` 실패(부분 성공) |
| 4 | **건별** `IntentsService.applyLearningExample(..., { auditSummary: '증강 예문 반영 (N건)', deferBundleInvalidate: true })` | 상한 초과 등은 **건별 실패**, 나머지는 계속(AC-L1-9) |
| 5 | 성공한 제안 `status = ACCEPTED`(CAS) | 이미 `ACCEPTED`면 멱등 흡수(EX-L1-8) |
| 6 | **`LearningApplyService.applyLearning({ reason:'AUGMENTATION_ACCEPT' })` — 요청당 정확히 1회**(K-2) | 실패는 삼키지 않고 `503`(K-5) |

응답: `{ succeeded, failed: [{ id, code, message }], appliedImmediately, linkedNodeCount }`.

- **감사**: 대상 `Intent`의 `UPDATE` 1건, `summary = "증강 예문 반영 (N건)"`. 예문 본문은 스냅샷에 포함되지 않는다(기존 화이트리스트 유지). 제안 상태 변경은 **감사 대상 아님**(FR-L1-25).
- **거절**: `POST .../reject { suggestionIds }` → `status = REJECTED`. 물리 삭제 없음.

---

## 11. No.23 (A) 요소분해 설계

### 11.1 순수 함수 계약

```ts
// learning/lib/decompose.ts — DB·Nest·분석기 무의존
decompose(text: string, deps: {
  morphTokens: readonly MorphToken[];     // MorphAnalyzerPort 결과(빈 배열 허용)
  gazetteer: readonly { id: string; name: string; surface: string; viaSynonym: boolean }[];
  stopwords: ReadonlySet<string>;
  josaEndings: readonly string[];
}): DecompositionSpan[]
```

**스팬 산출 우선순위** — ① **gazetteer 최장일치**(결정론적, EX-L2-3) → ② 형태소 경계 → ③ 공백 → ④ 조사·어미 접미 절단.
gazetteer가 항상 최우선이므로 **등록된 키워드는 분석기 품질과 무관하게 정확히 잡힌다**(AC-L2-1).

**역할 자동 부여 3종**(초기값일 뿐 — 관리자가 바꾼다): `ENTITY_CANDIDATE`(gazetteer 일치 또는 명사성 추정) · `INTENT_SIGNAL`(서술·종결 표현 포함 잔여 구간) · `IGNORED`(불용어·1자 조사·숫자 단독).

- 입력은 `UnansweredQuestion.questionText`(**이미 마스킹된 값**). 원문에 다시 접근하지 않는다(FR-L2-1).
- **저장하지 않는다.** 사전이 바뀌면 다음 조회에서 즉시 달라진다(DD-105).
- 전부 `IGNORED`면 "반영할 요소가 없습니다 — 무시 처리를 권합니다"(EX-L2-2).

### 11.2 통합 반영 `resolve-decomposed`

```
POST /chatbots/:c/unanswered-questions/:id/resolve-decomposed
{ intentId?|intentName?, exampleText?, spans?, entities: [{ action, keywordId?, name?, synonym }](≤10) }
```

| 순서 | 처리 | 결손 방향 |
|---|---|---|
| ① | 스팬 재검증(원문 범위 이탈·겹침 → `400`, 아무것도 변경되지 않는다 — AC-L2-4) | — |
| ② | **예문 반영** — 기존 `resolve` 코어(`IntentsService.applyLearningExample`) **공유**(복제 0건) | — |
| ③ | **엔티티 반영** — `KeywordsService`의 공용 경로(동의어 추가 / 신규 생성). 상한 200·정규화 유일성 그대로 | 상한 초과는 **부분 성공**(EX-L2-4) |
| ④ | **상태 전이(CAS)** `updateMany({ where: { status:'PENDING' } })` | 패자 `409 ALREADY_RESOLVED`(AC-L2-6) |
| ⑤ | **`applyLearning({ reason:'UNANSWERED_DECOMPOSED_RESOLVE' })` — 1회** | 실패 시 `503` |

- **트랜잭션으로 묶지 않는다.** 각 단계가 멱등이며 결손 방향은 **"대화 자산을 잃지 않는 쪽"**(ADR-0018 §4와 동일 원칙).
- **감사**: 의도 `Intent` 1건 + 키워드 `Keyword` **건별** `CREATE`/`UPDATE`(`summary: "미응답 요소 반영"`). `AuditTargetType` 확장 0건.
- 응답에 **`linkedNodeCount`(의도) + `keywordLinkedNodeCount`(키워드)** 를 포함한다 — 0이면 화면이 지속 경고 + 노드 편집 링크를 제시한다. **원본 매뉴얼의 "키워드 미파악" 분기를 이 필드가 드디어 닫는다**(FR-L2-12).
- **기존 `POST .../resolve`(No.15)는 무회귀로 유지**된다(AC-L2-8). 요소분해는 선택 경로다.

---

## 12. No.23 (B) 경량 분류기 설계

### 12.1 학습 데이터 수집

`EmbeddingVector` 중 `ownerType ∈ {INTENT_EXAMPLE, INTENT_NAME}` · `status='READY'` · `modelId = 현재값` · `chatbotId` 스코프. `ownerId`가 라벨(`Intent.id`)이다.

**최소 조건**(미달 시 `422 CLASSIFIER_INSUFFICIENT_DATA`, **추천은 bigram으로 계속 동작** — AC-L2-9):
의도 **2개 이상** · 의도당 벡터 **3건 이상**(미달 의도는 학습에서 제외) · 총 샘플 **20건 이상**.
일부 벡터가 `PENDING`/`FAILED`면 `READY`인 것만으로 학습하고 **사용 샘플 수를 상태에 보고**한다(EX-L2-8).

### 12.2 학습 (순수 함수 · 결정론 · CPU)

```ts
// classifier/lib/logistic-regression.ts
trainMultinomialLogistic(input: {
  samples: readonly { vector: Float32Array; classIndex: number }[];  // 정렬 순서 고정
  classCount: number; dimension: number;
  l2: number; learningRate: number; maxEpochs: number; batchSize: number; tolerance: number;
  classWeights: readonly number[];   // 불균형 보정(EX-L2-9)
}): { weights: Float32Array; bias: Float32Array; epochs: number; finalLoss: number }
```

**결정론 규약**(테스트 가능성의 전제 — 같은 입력 → 같은 모델): 샘플 정렬 순서 고정 · 가중치 초기값 0 · 고정 `maxEpochs` 상한 · `tolerance` 기반 수렴 판정 · 난수 미사용(셔플하지 않는다).

- 입력이 **L2 정규화 벡터**라 선형 모델로 충분하다(ADR-0024 §1의 정규화 책임 덕분).
- **배치 간 양보**(`setImmediate`) — 학습 중 다른 API P95 지연 증가 20% 미만(AC-L2-17, 재색인 큐와 같은 규약).
- **홀드아웃 정확도**: 샘플 50건 이상일 때 계층적 80/20 분할로 측정하고, 미만이면 `accuracy: null`(화면은 "측정 안 됨").

### 12.3 저장과 stale 판정

- 저장: `upsert` **원자적 1회**. 가중치·절편은 `embedding/lib/vector-codec.ts`의 **같은 base64 Float32 코덱**.
- stale 3조건:

| 조건 | 사유 코드 | 동작 |
|---|---|---|
| 학습 `modelId` ≠ 현재 `modelId` | `MODEL_CHANGED` | **즉시 사용 중지** → 추천이 `LEXICAL`로 자동 복귀(AC-L2-11). 정확도 문제가 아니라 **입력 공간이 다르다** |
| 의도 집합이 학습 시점 대비 10% 이상 변경 | `INTENTS_DRIFTED` | **경고만**(계속 사용) |
| 학습 이후 예문 50건 초과 추가 | `EXAMPLES_DRIFTED` | **경고만**(계속 사용) |

- 화면 배지 5상태: `학습 안 됨` / `학습 중` / `사용 중` / `낡음 — 재학습 권장` / `사용 불가`. **`사용 불가`는 원인과 해결 방법을 함께 적는다**(FR-L3-8).
- **자동 재학습 스케줄 없음**(FR-L2-24). 감사 대상 아님(FR-L2-25). 챗봇 영구삭제 시 동반 삭제.

### 12.4 추천 통합 (유일한 소비자)

```
learning의 미응답 목록/상세 조회
  ├─ 분류기 READY && !stale && CLASSIFIER_ENABLED
  │     → 질의 임베딩 **배치 1회**(20행 = 1회 호출, AC-L2-14)
  │     → predict: softmax(W·q + b) → 상위 3건, 확률 ≥ 0.15
  │     → classIds 대조로 **삭제된 의도 제외**(EX-L2-12)
  │     → source: 'CLASSIFIER'
  └─ 그 외(미학습·stale·임베딩 실패·비활성)
        → 기존 bigram 자카드(FR-15-16)  → source: 'LEXICAL'
```

- **둘을 섞지 않는다**(가중 결합은 또 하나의 보정 과제를 만든다 — EX-L2-11).
- 임베딩 실패는 **오류가 아니라 폴백**이다(AC-L2-15).
- **미응답 목록 P95 500ms 예산을 유지**한다(NFR-LP7) — 분류기 도입이 예산을 늘리는 근거가 되지 않는다.

---

## 13. "제안 ≠ 자산" 구조적 봉인과 정적 검사 (AC-L4-3)

`apps/api/src/augmentation/lib/asset-write-sealing.spec.ts` — `rag-allowlist.spec.ts`와 **같은 형식**(스캔 루트 지정 · 자기 자신 제외 · **스캔 대상이 0건이 아님을 먼저 단언**).

| # | 단언 | 무엇을 막는가 |
|---|---|---|
| S-1 | `prisma.intent.(create｜update｜updateMany)` · `prisma.keyword.(create｜update｜updateMany)` 문자열이 **`intents.service.ts`·`keywords.service.ts` 밖에서 0건** | 자산을 우회해서 쓰는 코드 |
| S-2 | `applyLearningExample(` 호출 파일이 **allowlist 3곳뿐**(`unanswered-questions.service.ts`, `augmentation-accept.service.ts`, `decomposed-resolve.service.ts`) | 승인 밖 승격 경로 |
| S-3 | `training-jobs/**` · `*job.runner.ts` 파일에 `IntentsService`·`KeywordsService` 심볼 **0건** | **Job 완료 콜백의 자동 승인** |
| S-4 | `training-jobs.module.ts`·`augmentation.module.ts`의 `imports`에 `IntentsModule`이 있는 위치가 **`augmentation` 1곳**이며, `TrainingJobsModule`에는 **없다** | DI 그래프 차원의 봉인 |
| S-5 | `setInterval`·`setTimeout`·`cron` 심볼이 `augmentation/**`·`classifier/**`에서 **0건**(큐의 `setImmediate` 양보는 예외 목록으로 명시) | 스케줄러발 자동 승격 |
| S-6 | `packages/dialogue-engine/**`에 `classifier`·`augmentation`·`suggestion` 심볼 **0건**(AC-L4-2) | 대화 경로 오염 |

> **"자동으로 하지 않기로 한다"는 약속은 회귀에 약하다 — 할 수 없게 만든다.** ADR-0022가 파괴적 RAG 경로에 적용한 패턴의 두 번째 적용이며, 이 그룹에서 **가장 중요한 테스트**다.

---

## 14. ADR-0018 인계 지점 — **교체하지 않는다** (§상위 문서 정정)

### 14.1 검증 결과

| 계약 | 상태 | 이 그룹의 처리 |
|---|---|---|
| K-1 무효화 호출 1곳 | 준수(전용 정적 검사 스펙 존재) | **유지** — 증강 승인·요소분해 반영도 이 1곳을 거친다 |
| K-2 요청당 1회 | 준수 | **유지** |
| K-3 트랜잭션 밖·커밋 후 | 준수 | **유지** |
| K-4 반환값 전달 | 준수(프런트 분기 구현 완료) | **유지. 분기는 이번에도 켜지지 않는다** |
| K-5 실패 전파 | 준수 | **유지** |
| K-6 수동 트리거 금지 | 준수 | **부분 변경** — `intent-classifier/train`은 대화 반영 트리거가 아니라 추천 품질 도구다. `POST /retrain`은 여전히 만들지 않는다 |

### 14.2 정정 대상 (구현자 인계 — **코드 본문은 건드리지 않는다**)

| 대상 | 정정 |
|---|---|
| `learning-apply.service.ts` JSDoc 18~20행 | "No.16·No.23 착수 시 이 메서드 본문 1곳이 `TrainingJob` 적재로 교체되고" → **"교체 조건은 대화 반영이 즉시가 아니게 되는 시점(파인튜닝의 대화 경로 편입)이며 No.16/23은 해당하지 않는다(ADR-0018 보론)"**. **본문·시그니처·반환값 무수정** |
| 개발명세서 §3 `TrainingJob` 행 | 쓰기 주체 확보로 전면 갱신(§7.3) |
| 개발명세서 §6 결정 23 | 갱신 각주 |
| 개발명세서 §6 결정 29 | ADR-0024 갱신 각주 |
| `docs/03-design/stats-learning-ui-spec.md` §4.8 | 주석 정정(코드 그대로) |
| `docs/04-test/시험항목.md` TC-15 | "재학습 Job 생성"을 **증강 Job / 분류기 학습 Job** 항목으로 재정의 |

**회귀 고정**: **AC-L4-7** — `applyLearning()`의 반환값이 여전히 `{ mode:'IMMEDIATE', appliedImmediately:true, jobId:null }`임을 테스트가 단언한다.

---

## 15. API 설계 (개발명세서 §4 확장)

### 15.1 신규 엔드포인트 10개 — **`@Public()` 0건 추가**

| # | 메서드 | 경로 | 권한 | 비고 |
|---|---|---|---|---|
| 1 | `POST` | `/chatbots/:chatbotId/intents/:intentId/augmentations` | `dialogue:write` | **`202 { jobId, status }`**. 동시 1건(`409`) · 임베딩 불가 `503` |
| 2 | `GET` | `/chatbots/:chatbotId/intents/:intentId/augmentations` | `dialogue:read` | 목록 + `runResult` + `capability`. `stale` 계산 포함 |
| 3 | `GET` | `/chatbots/:chatbotId/augmentations/capability` | `dialogue:read` | Provider 가용성·저하 사유(§4.3) |
| 4 | `POST` | `/chatbots/:chatbotId/intents/:intentId/augmentations/accept` | `dialogue:write` | ★ **자산 승격 유일 경로**. ≤50건 · 부분 성공 |
| 5 | `POST` | `/chatbots/:chatbotId/intents/:intentId/augmentations/reject` | `dialogue:write` | 상태만 변경 |
| 6 | `GET` | `/chatbots/:chatbotId/unanswered-questions/:id/decomposition` | `dialogue:read` | 조회 시 계산 · `analyzerId` 포함 |
| 7 | `POST` | `/chatbots/:chatbotId/unanswered-questions/:id/resolve-decomposed` | `dialogue:write` | 의도 + 엔티티 동시 반영 |
| 8 | `POST` | `/chatbots/:chatbotId/intent-classifier/train` | `dialogue:write` | **`202 { jobId }`**. 진행 중 `409` · 데이터 부족 `422` |
| 9 | `GET` | `/chatbots/:chatbotId/intent-classifier/status` | `dialogue:read` | 5상태 · `staleReasons[]` |
| 10 | `GET` | `/chatbots/:chatbotId/training-jobs/:id` | `dialogue:read` | 폴링 대상. 교차 챗봇 조회는 `404` |

**기존 확장(하위호환)**: `GET .../unanswered-questions`(+`/:id`) 응답의 `suggestedIntents[]`에 **`source` 선택 필드 추가**.

### 15.2 폴링 규격 (관리자 콘솔 전용)

| 작업 | 최초 지연 | 간격 | 최대 |
|---|---|---|---|
| `AUGMENT` | 300ms | 700ms | 60초 |
| `CLASSIFIER_TRAIN` | 500ms | 1.5초 | 5분 |

- 화면 이탈 후 재진입해도 **상태를 서버에서 다시 조회**할 수 있다(AC-L3-10).
- 진행 표시는 `aria-live="polite"`로 안내하고 **애니메이션만으로 상태를 전달하지 않는다**(NFR-LA1).
- 최대 시간 초과 시 폴링을 멈추고 "작업이 오래 걸립니다 — 잠시 후 목록을 새로고침해 주세요"로 마감한다(작업은 서버에서 계속 진행된다).

### 15.3 오류 코드 6종 (ADR-0003 봉투 불변)

| 코드 | 상태 | 상황 |
|---|---|---|
| `AUGMENTATION_UNAVAILABLE` | 503 | 임베딩 미가용·`modelId` stale → **검증 없는 증강을 하지 않는다** |
| `AUGMENTATION_IN_PROGRESS` | 409 | 같은 의도에 생성 작업 진행 중 |
| `SUGGESTION_EXPIRED` | 409 | stale 제안 승인 시도 |
| `CLASSIFIER_INSUFFICIENT_DATA` | 422 | 최소 학습 조건 미달 |
| `CLASSIFIER_NOT_TRAINED` | 422 | 모델이 없는데 모델 전용 동작을 요청 |
| `CLASSIFIER_STALE_MODEL` | 422 | `MODEL_CHANGED` 상태에서 모델 사용을 강제 요청 |

**대화 경로는 이 코드들을 쓰지 않는다**(공개 API 표면 변화 0).

---

## 16. 보안 · 권한 · 감사

| 항목 | 규약 |
|---|---|
| **권한** | **신규 권한 0종.** `dialogue:read｜write` 재사용(동작이 바꾸는 자원 기준 — ADR-0015). VIEWER는 생성·승인·거절·재학습 버튼이 **렌더되지 않고** API 직접 호출 시 `403`이며 DB가 변경되지 않는다 |
| **`@Public()`** | **여전히 정확히 6개**(AC-L4-4). 이 그룹은 공개 엔드포인트를 하나도 추가하지 않는다 |
| **PII** | 외부 송신 전 마스킹 필수. **적용 지점 2 → 3곳**(저장 · RAG 송신 · **증강 송신**)이지만 **함수는 여전히 1벌**(`packages/pii-mask`) — 복제 0건(AC-L4-10) |
| **금지어** | ① 외부 송신 전(시드) ② 생성 결과(후보) 2지점. 외부 모델이 만든 문장이 **봇의 매칭 사전에 금지어를 심는 일**을 막는다 |
| **외부 응답 불신** | zod 파싱 → 길이·제어문자 → 금지어 → 의미 검증. 어느 하나라도 실패하면 **조용히 제외**하고 예외를 전파하지 않는다 |
| **로그·`resultSummary`** | **문장 원문 0건**(건수·사유 분포·소요시간만 — NFR-LS4). 외부 오류 원문·스택을 담지 않는다 |
| **자격증명** | 환경변수로만 주입. 코드·DB·로그·응답·감사 어디에도 나타나지 않는다 |
| **구축형 외부 전송 0** | `AUGMENTATION_PROVIDER=rule｜local` 구성에서 아웃바운드 HTTP **0건**이 검증 가능하다(AC-L1-14) |
| **모델 프라이버시** | 분류기 가중치는 임베딩의 선형 결합이며 원문을 복원할 수 없다. `chatbotId` 스코프를 넘어 공유하지 않는다 |
| **감사** | 예문 `Intent` UPDATE(`"증강 예문 반영 (N건)"`) · 키워드 `Keyword` CREATE/UPDATE(`"미응답 요소 반영"`). **제안 상태·분류기 학습·Job 상태는 감사 대상 아님.** `AuditTargetType` 확장 0건 |

---

## 17. 성능 목표 (개발명세서 §5 갱신 대상)

| ID | 목표 |
|---|---|
| NFR-LP1 | **공개 대화 API 성능 예산에 영향 0.** 대화 경로에 신규 조회·계산이 0건이며 회귀 측정으로 증명한다(AC-L4-5) |
| NFR-LP2 | G1 증강 제안 생성 **1초(P95)**. 외부 Provider는 30초 타임아웃 후 G1 폴백 |
| NFR-LP3 | 증강 검증 임베딩 호출 **요청당 배치 1회**. 기존 예문 벡터는 캐시/DB 조회 1회(N+1 금지) |
| NFR-LP4 | 요소분해 **50ms(P95)**. 사전은 요청당 1회 로드해 전 스팬이 공유 |
| NFR-LP5 | 분류기 학습 **5,000샘플 30초(CPU)**. 학습 중 다른 API P95 지연 증가 **20% 미만** |
| NFR-LP6 | 분류기 추론 **목록 20행 100ms** |
| NFR-LP7 | 미응답 목록 전체 P95 **기존 500ms 예산 유지** |
| — | **ml-worker 생성 프로파일이 임베딩 300ms 예산을 잠식하지 않도록 프로세스 분리**(§5.3) |

---

## 18. 환경변수 (개발명세서 §5.1 확장) — **14종 전부 선택**

| 변수 | 기본값 | 용도 |
|---|---|---|
| `AUGMENTATION_PROVIDER` | `rule` | `rule` \| `gemini` \| `local` |
| `AUGMENTATION_GEMINI_API_KEY` | (없음) | **미설정 = G1 저하**(기동 실패 아님) |
| `AUGMENTATION_GEMINI_MODEL` | 코드 상수 | 모델 식별자 |
| `AUGMENTATION_GEMINI_BASE_URL` | 공식 엔드포인트 | 사내 프록시·게이트웨이 주입용(하드코딩 금지) |
| `AUGMENTATION_LOCAL_BASE_URL` | (없음) | ml-worker 생성 프로파일 주소. 미설정 = `local` 선택 시 G1 저하 |
| `AUGMENTATION_TIMEOUT_MS` | `30000` | 외부 생성기 타임아웃 |
| `AUGMENTATION_MAX_SUGGESTIONS` | `20` | 요청당 제안 상한(생성 시도는 최대 3배) |
| `AUGMENTATION_MAX_PENDING` | `500` | 챗봇당 `PENDING` 상한 |
| `AUGMENTATION_SUFFICIENT_EXAMPLES` | `10` | "증강 이득이 작습니다" 안내 기준 |
| `AUGMENTATION_KEEP_MIN` / `_KEEP_MAX` / `_NOVELTY_MAX` | `0.75` / `0.97` / `0.95` | 의미 검증 밴드(**모델 종속 잠정값**) |
| `AUGMENTATION_SUGGESTION_TTL_DAYS` | `7` | stale 판정 |
| `CLASSIFIER_ENABLED` | `false` | **기본 비활성** — 켜야 학습·추천 경로가 열린다 |
| `CLASSIFIER_MIN_SAMPLES` / `_MIN_PER_CLASS` / `_MIN_CLASSES` | `20` / `3` / `2` | 학습 최소 조건 |
| `CLASSIFIER_MAX_MODEL_BYTES` | `8388608` | 산출물 상한 |
| `CLASSIFIER_MIN_PROBABILITY` | `0.15` | 추천 하한 |
| `MORPH_ANALYZER` | `auto` | `auto` \| `heuristic` \| 분석기 id |
| `MORPH_DICT_PATH` | (없음) | 오프라인 설치용 사전 경로 |
| `ML_WORKER_ROLE` | `embed` | `embed` \| `augment` \| `both` (ml-worker) |
| `GENERATION_MODEL_ID` / `GENERATION_DEVICE` | (없음) / `cuda` | 생성 프로파일 모델·디바이스(ml-worker) |

> **하나도 설정하지 않으면**: G1 증강 사용 가능 · 분류기 **비활성**(추천은 bigram) · 형태소 분석기 **M0 폴백** · ml-worker는 현행 임베딩 전용. **정상 기동한다**(AC-L4-1).

### 18.1 seed 전략

신규 seed **없음**. 제안·모델·Job은 전부 **0행에서 시작하는 것이 정상 상태**다. 개발 편의용 더미 제안을 만들지 않는다 — "제안이 있는 것처럼 보이는데 승인하면 예문이 오염되는" 상태를 만들지 않기 위함이다.

---

## 19. GPU 필요도 재산정 확정 (개발명세서 §6 · 기능요구사항 각주)

| No | 카탈로그 | **확정** | 근거 |
|---|:---:|:---:|---|
| **16** | 6 | **6 유지 + 구성별 각주: G1 `2` / G2 `3` / G3 `6`** | PM이 G3를 승인하고 24GB+ GPU를 확보 → **하향 근거가 사라졌다.** 요구사항의 "2~3" 제안은 *GPU 미보유 전제*였고 그 전제가 바뀌었다. 다만 **기본 구성(G1)은 GPU 0**이므로 "GPU 없이도 기능이 성립한다"도 함께 사실이다 |
| **23** | 4 | **3 확정** | 재임베딩 0 + 선형 학습 CPU 수 초. 기준표 3~4 구간("경량 ML(CPU 가능)")의 하단 |
| 그룹 종합 | — | **기본 `2` / G2 `3` / G3 `6`** | 구성 의존. **"GPU 5 복귀" 트리거는 철회**(ADR-0024 갱신 §3) |

---

## 20. 이 Phase에서 하지 않는 것 (아키텍처 관점 재확인)

| 항목 | 근거 | 재검토 |
|---|---|---|
| 임베딩·분류기 **파인튜닝** | `modelId` 전역 규약·임계값 매핑을 챗봇별로 갈라놓고, 산출물 버전·롤백·배포 설계가 통째로 필요 | GPU 상시화 + 증강 데이터 축적 후 별도 ADR |
| 분류기의 **대화 경로 편입** | ADR-0020/0021 재설계 + 1단계 kNN과 기능 중복 | 골든셋 **+5%p** 우위 시 |
| 학습형 **NER/CRF** | 스팬 라벨 0건 | 엔티티 승인 이력 수천 건 축적 후 |
| **Redis/BullMQ** | 단일 인스턴스 in-process로 충분 | 다중 인스턴스 전환 시(교체 지점 1곳) |
| **분류기 버전 이력·A/B·롤백** | 대화 무관 + 재학습 수 초 | 대화 경로 편입 시 자동으로 필요해진다 |
| **FAQ 질문·대체질문 증강** | 승인 화면·감사·상한 규칙이 두 벌 | 증강 승인율 안정 후 |
| **챗봇 전체 일괄 증강** | 승인 절차의 형식화 = J-11 붕괴 | 제안 품질 골든셋 검증 후 |
| **자동 재학습 스케줄 · Job 정리 배치** | 스케줄러 인프라 부재 | No.45 / 스케줄러 도입 시 |
| **역번역 증강 · 다국어** | 외부 번역 의존 추가 / 한국어 고정(FR-0-8) | 요구 확정 시 |
| **No.19/No.20(대화검증·학습영향도)** | 독립 카탈로그 항목 | ⚠ **이 그룹 직후 착수 강력 권고** — 증강은 예문을 대량으로 늘려 **회귀 리스크를 키운다** |
| **`packages/llm-provider` 생성 · `infra/`** | 소비자 1곳 / 배포 Phase | 소비자 2곳 / 배포 착수 시 |

---

## 21. 다음 단계 인계

### 21.1 `ml-engineer` (이 그룹에서 **가장 먼저** 나와야 하는 산출물 3종)

1. **G1 규칙 증강기 설계** — 어미·종결형·조사 변형 규칙표, 동의어 치환 전략, 변형 다양성 지표. **가장 먼저**.
2. **의미 검증 밴드 실측** — 기존 골든셋 100문항 재사용. `0.75/0.97/0.95` 기본값을 패러프레이즈/비패러프레이즈 쌍으로 검증하고 `modelId → 임계값` 매핑 상수를 확정.
3. **G3 생성모델 후보 3종 × 5지표 비교표**(ADR-0026 §5) — **24GB+ VRAM 전제. 소형 양자화로 타협하지 말 것.** 한국어 특화 8B급 / 다국어 14B급 / 32B 양자화급을 실제로 비교하고, **라이선스가 상업적 이용을 막는 모델은 제외**. 서빙 엔진·배치 파라미터·VRAM 배분안 포함.
4. **형태소 분석기 후보 3종 × 5지표**(ADR-0028 §2) — **④ 설치 난이도·⑤ 라이선스·배포 크기에 가중치를 크게** 둘 것. WASM 배포본 우선.
5. 분류기 수치 구현 검토 — 수렴 조건·클래스 가중치·정규화 계수·CPU 학습 시간 실측.
6. **분류기 vs 1단계 kNN 비교 실험** — FR-L2-32(+5%p) 재검토 트리거의 근거 데이터.
7. 조사·어미 목록 및 불용어 사전 초안 검증.

### 21.2 `backend-implementer`

① `augmentation` 모듈(포트·G1·검증 순수함수·제안 저장소·승인 경로) ② `classifier` 모듈 ③ `training-jobs` 모듈(+ **기동 시 고아 Job 정리**) ④ `learning` 확장(요소분해·통합 반영·추천 출처 분기) ⑤ **`IntentsService`/`KeywordsService` 재사용 — 복제 0건** ⑥ **`LearningApplyService`는 `reason` 유니온 확장 + JSDoc 정정 외 무수정**(§14.2) ⑦ 순수 로직은 전부 `lib/*` ⑧ **PII 마스킹 함수 복제 금지** ⑨ **`training-jobs`가 `IntentsModule`을 import하지 않는 구조**(§13) ⑩ `asset-write-sealing.spec.ts` 작성 ⑪ 신규 원시 SQL 0건.

### 21.3 `frontend-implementer`

① 의도 상세의 증강 패널(진행 표시 + 재진입 시 상태 복원) ② 제안 표(체크박스·유사도 **수치+라벨**·충돌 배지·생성기) + **전체선택에서 충돌 행 제외** ③ 검증 요약 표시 ④ 요소분해 칩(역할 3종 = **색상 + 텍스트 + 아이콘**, 키보드 완전 지원, 경계 편집) ⑤ 분류기 5상태 배지(+ **원인·해결 문구**) ⑥ 추천 출처 배지 ⑦ **`"반영 완료"` 리터럴 사용 금지 — `MESSAGES` 상수**(K-4) ⑧ 권한 기반 액션 숨김 ⑨ **"승인 전까지 대화에 영향을 주지 않습니다" 상시 노출**(FR-L3-12) ⑩ `capability` 저하 사유 안내 ⑪ **`apps/widget` 수정 0건**.

### 21.4 `ui-designer`

증강 제안 패널 배치(모달 vs 인라인) · 제안 표 디자인 · 검증 요약 · 요소분해 칩 인터랙션 · `ResolveModal` 확장 여부 · 분류기 배지 5상태 · 진행 표시 · 빈 상태 3종 · **"제안과 자산의 시각적 분리" 패턴**(UIUX 준수기준에 추가 제안) · `StatsShell` 서브내비 확장 여부.

### 21.5 `test-automation`

**우선순위 상위 6건**: ① **AC-L4-3**(승인 외 경로 자산 쓰기 0건 — 이 그룹의 안전 규약을 지키는 핵심) ② **AC-L4-7**(인계 지점 무교체 — 반환값 고정) ③ **AC-L1-2/3**(의미 이탈·중복 제외 = 안전장치 증명) ④ **AC-L1-8**(증강 후 매칭 점수 상승 = 존재 이유 증명) ⑤ **AC-L1-14**(구축형 외부 호출 0건) ⑥ **AC-L4-2/L4-5**(엔진 파일 변경 0 · 대화 성능 무영향). 추가: AC-L2-8(No.15 무회귀) · 모킹 5종 활용 · **전 테스트가 Mock Provider + M0 분석기로 통과** · **외부 LLM을 실제 호출하는 테스트를 CI에 넣지 않는다**.

### 21.6 `code-reviewer`

① 승인 없이 자산을 바꾸는 경로 0건 ② 엔진 패키지 변경 0건 ③ `applyLearning()` 본문·반환값 그대로 ④ 예문·키워드 로직 복제 0건 ⑤ PII 마스킹 복제 0건 ⑥ 로그·`resultSummary`에 원문 0건 ⑦ `"반영 완료"` 리터럴 0건 ⑧ `@Public()` 6개 유지 ⑨ 신규 원시 SQL 0건 ⑩ 검증 실패가 조용히 제외로 수렴(예외 전파 금지) ⑪ 분류기 심볼이 대화 경로에 없음 ⑫ `rule` 구성에서 G2/G3 인스턴스화 0건.

### 21.7 상위 문서 갱신 (이 설계서가 요청하는 것)

| 대상 | 요청 |
|---|---|
| `기능요구사항.md` §3 No.16 | 각주: **1차 범위 = 의미 보존 예문 증강 파이프라인(관리자 승인 필수), 산출물은 `Intent.examples` 데이터. GPU는 구성 의존(G1 2 / G2 3 / G3 6)** |
| `기능요구사항.md` §3 No.23 | 각주: **저장된 임베딩 위 선형 분류기, 재임베딩 없이 CPU 학습 → GPU 3. 소비자는 미응답 추천 1곳이며 대화 경로에 관여하지 않는다** |
| `기능요구사항.md` §2 No.15 | "19번 군집분석" **번호 오기 19 → 21** 정정 + "No.23이 요소분해·엔티티 등록·분류기 추천 층을 덧붙인다" 각주 |
| `docs/03-design/UIUX_준수기준.md` | **"제안과 자산의 시각적 분리" 패턴** 추가(승인 전 항목은 자산 목록과 다른 영역·다른 배경, 승인 액션은 단일 진입점) |
| `docs/04-test/시험항목.md` | 증강·요소분해·분류기 TC 신설 + **TC-15의 "재학습 Job" 최종 정리** |
| `docs/04-test/시험데이터.md` | 증강 검증 시드 세트(의미 보존/이탈/중복 각 10건) + **생성기 모킹 5종** + 분류기 학습용 소형 데이터셋 |
| `docs/05-ops/` 설치·배포 | **"형태소 분석기 = 선택 구성요소"** 절 + 오프라인 설치 안내(배포 Phase 착수 시) |

---

## 22. 요구사항 ↔ 설계 추적표 (발췌)

| 요구사항 | 설계 위치 |
|---|---|
| J-1 / FR-L1-1~4 | ADR-0025 §1·§2, §10 |
| J-2 / AC-L1-8 | ADR-0025 §2, §21.5-④ |
| J-3 / FR-L1-5~9 | ADR-0026, §4 |
| J-4 / FR-L1-10~15 | ADR-0025 §3·§4, §10.3 |
| J-5 / FR-L2-14~26 | ADR-0027 §1·§6, §12 |
| J-6 / FR-L2-27~32 | ADR-0027 §2, §12.4, §13 S-6 |
| J-7 / FR-L2-35~38 | ADR-0024 갱신, §5 |
| J-8 / P-5 | ADR-0027 §4, §7.3 |
| J-9 / FR-L2-33/34 | ADR-0018 보론, §14 |
| J-10 / P-4 / FR-L2-1~13 | ADR-0028, §6·§11 |
| J-11 / FR-0-50 / AC-L4-3 | ADR-0025 §5, §13 |
| J-12 / §4.6 | ADR-0027 §5, §19 |
| FR-0-49 / NFR-LM3 | §1.1, §13 S-6 |
| FR-0-51 / NFR-LM2 | §10.5, §11.2, §13 S-1/S-2 |
| FR-0-53 / NFR-LS1 | ADR-0026 §3, §16 |
| FR-0-55 / AC-L4-1 | §18 |
| FR-0-57 | §15.3 |
| FR-0-58 / AC-L4-4 | §16 |
| FR-L3-1~12 | §15.2, §21.3, §21.4 |
| NFR-LP1~LP7 | §17 |
| NFR-LS1~LS7 | §16 |
| NFR-LA1~LA4 | §15.2, §21.3 |
| NFR-LM1~LM7 | §9.3, §13, §21.5 |
