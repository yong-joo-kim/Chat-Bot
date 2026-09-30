# 온디바이스/엣지 추론 세부 설계서 (No.37)

> **요구사항**: `docs/requirements/edge-inference.md`(J-1~J-10, R-1~R-7, FR-0-274~285, FR-ED1-\*~FR-ED6-\*, NFR-EDP/EDS/EDR/EDA/EDM, AC-ED1~ED5, EX-ED-1~14, P-1~P-11). FR-ED7·AC-ED6(규모 B)은 PM이 규모 A를 골라 **이번 범위 밖**이다.
> **상위 문서**: `docs/02-spec/개발명세서.md` §2(ml-worker 행)·§5.1(환경변수)·§6(**결정 47 신설** · 결정 29·30 갱신 각주)·§7(인덱스) · `기능요구사항.md` 79행 · ADR-0026·0024 · `docs/05-ops/자동배포.md` §5.3·§5.8 — 반영 문구는 **`docs/02-spec/edge-inference-patches.md`**(찾기/바꾸기 16건 · ⏳ 미적용 — 오케스트레이터가 적용. 대상 파일이 모두 CRLF라 전체 재작성 대신 패치로 남긴다 · §20).
> **신규 ADR**: **ADR-0046**(엣지 = 고객사 사내 소형 서버 · 생성 백엔드 3종은 ml-worker 안에서만 고른다 · 경량 구성 상한 절삭 · 생성 백엔드 주소 통제 · 시간 제한 정렬). `decisions/`의 현재 최대 번호는 0045다. 미커밋 초안 중 `docs/requirements/nlg-bot-to-bot.md` 467행이 "다음 빈 번호는 ADR-0046"이라고 **언급만** 했을 뿐 선점한 초안은 없다(`plugin-marketplace.md`·`connector-hub.md`·`nocode-scenario-design.md`는 0046을 적지 않았다). 가번호는 번호를 예약하지 않는다는 규약(ADR-0045 §12)에 따라 **이 결정이 0046을 쓴다**.
> **갱신 ADR(각주 · 재검토 트리거 문구)**: ADR-0026(재검토 트리거 "사내 vLLM 게이트웨이 → API 유니온 확장"을 "ml-worker 생성 백엔드로 흡수 · API 포트 불변"으로 갱신 · §5 "소형 양자화 모델로 타협하지 않는다"의 적용 범위 정밀화) · ADR-0024(§갱신 1 — ml-worker 생성 프로파일은 외부 서빙 엔진에 **위탁**할 수 있다 · 위탁 구간 주소 통제)
> **작성일**: 2026-09-30 · **GPU**: **4 유지 + 각주**(P-10) · 구축형 ○ · 구독형 ✕(vLLM 백엔드 자체는 배포형태 중립 — 각주)
> **구현 담당**: **`ml-engineer` 1명 · `apps/ml-worker` 한정.** `backend-implementer`·`frontend-implementer`·`ui-designer`는 **이번 그룹에서 할 일이 없다**(API·위젯·엔진·화면 변경 0 — P-2). 운영 문서 `자동배포.md` §5.8(등급표·반입 절차·설치 점검)은 패치 E-2가 제공하고, 3050 동작 확인 결과로 등급표 칸을 갱신하는 것만 ml-engineer가 한다.
> **표기**: 봉인 **ED-1~ED-12** · 의도된 기존 시험 기대값 변경 **닫힌 목록(FR-0-285) = 0건** · 코드에서 찾은 제약 **C-1~C-10** · 알려진 제한 **K-1~K-10** · 요구사항 대비 해석·조정 **R-1~R-12** · 구현 편차는 구현 후 §22에 **I-n**으로 기록

---

## 0. 이 문서가 푸는 문제 (한 문단 요약)

"엣지 추론"은 이 제품에서 **"고객사 서버 한 대(GPU가 없거나 작아도)에서 AI가 전부 돈다"**(E1)로 확정됐다(P-1). 대화 경로의 유일한 모델(임베딩)은 이미 CPU 기본값으로 예산 안에서 돌고, 우리 쪽 생성모델은 관리자 배치 작업(예문 늘리기 G3) 1곳에서만 쓰이며, 4GB GPU용 Ollama 경로는 `adf536e`로 이미 있다. 이 설계는 **`apps/ml-worker` 안에서만** 다음을 한다. ① 생성 백엔드를 **3종(`transformers`·`ollama`·`vllm`) 중 하나로 설정만으로** 고르게 하고 알 수 없는 값은 기동 실패로 만든다 ② 운영용 **vLLM 백엔드**(OpenAI 호환 대화형 API)를 추가한다 ③ Ollama 경로의 지위를 **"경량 설치 구성 — 동작 보장·품질 미보증"** 으로 정리하고, **1회 생성 상한 20건을 `/augment` 안에서 절삭**(400 아님)으로 적용한다 ④ `/augment/health`가 **실제 백엔드와 구성 등급을 선택 필드로 보고**하고 원격 백엔드면 `device`에 `cuda`를 사실처럼 쓰지 않는다 ⑤ ml-worker의 원격 요청 시간 제한 기본값을 **25초**로 내려 API 30초보다 먼저 포기하게 한다(헛일 제한) ⑥ 생성 백엔드 주소를 **루프백·사설 대역 또는 명시 허용 목록**으로만 허용한다(마스킹 없는 시드가 나가는 구간) ⑦ 폐쇄망 모델 반입 절차와 장비 등급표를 운영 문서에 둔다. **`/augment` 요청·응답 계약, API의 `AugmentationProvider` 포트·팩토리, 대화 경로, 위젯, 엔진, 콘솔 화면, DB는 한 줄도 바뀌지 않는다.**

> 이 설계가 코드에서 **추가로 찾은 제약 10건**(요구사항 §0.2 외):
> **C-1 `_load_generator()`는 `ollama`가 아니면 전부 `transformers`로 떨어진다**(`app.py` 71행 `if settings.is_ollama_backend:` — 오타 `GENERATION_BACKEND=vlm`이면 조용히 mock/HF 경로). → FR-ED1-5를 위해 **백엔드 값 검사를 `_load_generator()` 첫 줄에** 둔다(설정 클래스에 두면 임베딩 전용 프로세스까지 기동 실패 — NFR-EDR2 위반).
> **C-2 API는 생성기의 `modelId`를 저장하지 않는다** — `LocalAugmentationProvider.generate()`가 `candidates`만 돌려주고(`local-augmentation.provider.ts` 55행), 제안 행의 `modelId`는 **임베딩** 모델 ID다(`augmentation-job.runner.ts` 185행). → 요구사항 FR-ED1-4의 "제안·감사에 남는 생성기 표식"과 EX-ED-12의 "`modelId` 접두로 구분"은 **API 변경 없이는 성립하지 않는다**(R-2).
> **C-3 capability 응답에는 생성기 정보가 없다**(`augmentation-provider.factory.ts` 11~17행 — `providerId`·`degraded`·`requiresNetwork`뿐). → 콘솔의 "사내 경량 모델 — 품질 미보증" 문구(FR-ED6-2)는 API·화면 변경을 요구한다 → PM P-2("API·화면 변경 0")와 충돌 → **이번에 하지 않는다**(R-1).
> **C-4 API의 `/augment/health` zod 스키마는 `z.object()` 기본(strip)** 이라 모르는 키를 버린다(`local-augmentation.provider.ts` 11~16행). → ml-worker가 `/augment/health`에 **선택 필드를 더해도 API 동작은 바이트 단위로 같다**(FR-0-276 충족).
> **C-5 `/augment`는 `targetCount > GENERATION_TARGET_COUNT_MAX`(60)이면 400**이고(`app.py` 213~217행) 이를 단언하는 시험이 있다(`test_augment.py` 71~75행 — 61 → 400). → 경량 상한은 **이 400 검사 뒤에서 절삭**한다(계약 상한 60과 백엔드 상한을 분리 — 기존 시험 불변).
> **C-6 원격 백엔드의 워밍업 실패가 숨는다** — `OllamaGenerator.warmup()`은 `generate()`가 빈 배열을 돌려줘도 `_warmed_up = True`로 둔다(`generator.py` 222~224행 · `generate()`는 예외를 삼킨다). → 원격 백엔드는 **워밍업 결과가 1건 이상일 때만 `warmedUp=true`** 로 보고한다(§9).
> **C-7 `.env.example`이 `OLLAMA_REQUEST_TIMEOUT_S=90`을 명시값으로 적어 두었다**(41행). 이 파일을 복사한 설치는 코드 기본값을 바꿔도 90이 남는다. → 기본값 변경 + `.env.example` 갱신 + **30초 초과 시 기동 경고**(§10).
> **C-8 잘린 JSON은 한 줄이라 줄 단위 폴백이 무의미하다**(보고서 §4 — 잘린 전체 문자열이 후보 1개). → 원격 백엔드에서 **잘림 신호가 있을 때만** "닫힌 문자열 원소만 복구"하는 보조 파서를 쓴다. 공용 `parse_candidate_array()`는 바꾸지 않는다(transformers 경로 불변 — §8).
> **C-9 API는 시드를 최대 21개 보낸다** — `[...examples.slice(-20), intent.name]`(`augmentation-job.runner.ts` 121행)인데 ml-worker 상한은 20이고 초과는 400이다(`app.py` 208~212행 · `GENERATION_SEEDS_MAX=20`). **예문이 20개 이상인 의도는 G3(어느 백엔드든)가 항상 400 → G1 폴백**이다. 이 그룹의 원인이 아니고 고치려면 API 또는 ml-worker 계약 시험을 바꿔야 해 P-2 범위 밖이다 → **K-1로 기록하고 `bug-triage` 인계를 권고**한다.
> **C-10 `httpx.Client` 기본값은 리다이렉트를 따라가지 않는다**(`follow_redirects=False`). → 원격 백엔드는 이 기본값을 **명시적으로 유지**하고 3xx를 실패로 처리한다(허용 주소 검사를 리다이렉트로 우회하지 못하게 — ED-7).

---

## 1. PM 확정 사항 (2026-09-30)

| # | 확정 내용 | 요구사항 권고와의 관계 | 이 문서 반영 |
|---|---|---|---|
| **P-1** | **엣지 = 고객사 사내 소형 서버(E1).** 브라우저·휴대폰 안 추론(E3)·다지점 원격관리(E2) 제외 | 권고안 | 전체 · §2.2 |
| **P-2** | **규모 (A)**: ml-worker에 vLLM 생성 백엔드 추가 + 경량 구성 정리 + 상한·표시·주소 통제 보완 + 장비 등급표/설치 문서. **API·위젯·엔진·화면 변경 0** | 권고안(단 요구사항의 "capability 표시 문구 예외 가능"을 PM이 닫음) | §2 · R-1 |
| **P-3** | Ollama 경로 = **"경량 설치 구성 — 동작 보장·품질 미보증"**. 경량 구성 **1회 생성 상한 20건**, 초과 요청은 **400이 아니라 상한까지만 생성** | 권고안 + 상한 20 확정 | §7 · §9 |
| **P-4** | vLLM 서버 = **예문 늘리기 전용 사내 vLLM 서버**(외부 RAG의 vLLM 공유 안 함) | 권고안 | §11.4 |
| **P-5** | 3050·경량 구성 = **"동작 확인"만** · 품질/지연 합격 = **운영 모델 실측(No.17 기준 공유)** | 권고안 | §14 · §15.4 |
| **P-6** | 소형 모델 60건 한계 = **상한까지만 생성**(P-3과 동일 결정) | 권고안 | §7 |
| **P-7** | vLLM 백엔드 위치 = **ml-worker 안 세 번째 백엔드** | 권고안 | §3 · ADR-0046 §2 |
| **P-8** | 생성 백엔드 주소 = **사설·루프백만 + 명시 허용** | 권고안 | §11 |
| **P-9** | API 포기 뒤 헛일 = **시간 제한 정렬 권고값 먼저**(취소 전달 구현 안 함) | 권고안 | §10 |
| **P-10** | GPU 표기 = **4 유지 + 각주** | 권고안 | §20 · 기능요구사항 79행(패치 B-1) |
| **P-11** | 원본 확인 = 권고안 채택(사람이 원본 PDF·초안 xlsx 확인) — **이 설계는 그 결과를 기다리지 않는다**(E1 해석이 원문 표현과 충돌하는 근거가 없고, 규모 A는 되돌리기 쉬운 설정·문서 중심) | 권고안 | K-10 |

---

## 2. 범위

### 2.1 바뀌는 것 (전부 `apps/ml-worker` + 문서)

| 파일 | 변경 | 근거 |
|---|---|---|
| `apps/ml-worker/src/ml_worker/config.py` | 설정 키 추가·기본값 1건 변경(`OLLAMA_REQUEST_TIMEOUT_S` 90 → 25) · 비밀값 `SecretStr` · 파생 속성 | §5 |
| `apps/ml-worker/src/ml_worker/generator.py` | `Generator` 선택 속성 3개 · `OllamaGenerator` 보강(상한·워밍업·잘림 복구·주석) · **`VllmGenerator` 신설** · 보조 함수 2개 | §4 · §8 |
| `apps/ml-worker/src/ml_worker/backend_guard.py` | **신설** — 생성 백엔드 주소 판정 순수 함수 | §11 |
| `apps/ml-worker/src/ml_worker/app.py` | `_load_generator()` 3분기 + 알 수 없는 값 기동 실패 + 주소 검사 호출 · `/augment` 상한 절삭 · `/augment/health` 선택 필드·`device` 규칙 | §4.4 · §7 · §9 |
| `apps/ml-worker/.env.example` | 표기("경량 설치 구성") · 새 키 · 25초 | §5 |
| `apps/ml-worker/eval/generation_candidates.py` | `--backend vllm` · `--vllm-base-url`(키는 환경변수로만) — No.17 실측 재사용용 | §16 |
| `apps/ml-worker/tests/**` | 신규 시험 5파일 + `conftest.py` 가짜 vLLM·Ollama 서버 fixture | §15 |
| `apps/ml-worker/eval/report/edge-lightweight-operation-check.md` | **신설(수동)** — 3050 경량 구성 동작 확인 기록 | AC-ED3-5 |
| 문서 | 이 설계서 · ADR-0046 · 패치 목록(개발명세서 · 기능요구사항 79행 · ADR-0026/0024 · `자동배포.md` §5.3·§5.8) | §20 |

`pyproject.toml`: **의존성 추가 0**(vLLM 호출은 기존 `httpx`로 한다 — OpenAI SDK를 넣지 않는다. 근거는 ADR-0026 §4의 "SDK를 쓰지 않는 이유"와 같다: 전송·재시도 정책이 통제 밖으로 나간다).

### 2.2 바뀌지 않는 것 (봉인 — code-reviewer 확인 대상)

| # | 봉인 | 확인 방법 |
|---|---|---|
| **ED-1** | `apps/api`·`apps/web`·`apps/widget`·`packages/**` 변경 0(파일 단위) | `git diff --stat` 범위가 `apps/ml-worker/**`·`docs/**`뿐 |
| **ED-2** | `/augment` 요청·응답 Pydantic 모델(`AugmentRequest`·`AugmentResponse`) 필드 변경 0 | 코드 리뷰 + 기존 `test_augment.py` 수정 없이 통과 |
| **ED-3** | `/embed`·`/health` 계약 바이트 동일 | 기존 `test_app.py` 수정 없이 통과 |
| **ED-4** | `parse_candidate_array()`·`build_prompt()`·`SYSTEM_INSTRUCTION` 불변(모든 백엔드가 같은 프롬프트 문자열) | 코드 리뷰 · `test_vllm_generator`가 보낸 프롬프트 == `build_prompt()` 단언 |
| **ED-5** | `HFCausalLMGenerator`·`MockGenerator` 본문 불변 | 코드 리뷰 |
| **ED-6** | 기본 구성(`ML_WORKER_ROLE=embed`)에서 `/augment`·`/augment/health` 부재(404) 불변 | 기존 `test_augment.py` 33~39행 |
| **ED-7** | 원격 백엔드 HTTP 클라이언트는 리다이렉트를 따라가지 않는다 | `test_vllm_generator`의 3xx 시나리오 |
| **ED-8** | 비밀값(`VLLM_API_KEY`)은 로그·상태·오류 메시지·`repr(settings)`에 0건 | `test_secret_redaction.py` |
| **ED-9** | 파인튜닝·학습 엔드포인트 0 · ml-worker DB 접근 0 | 코드 리뷰(ADR-0024 §갱신 1-③ 유지) |
| **ED-10** | 생성 백엔드 호출은 `_load_generator()`가 만든 생성기 1개를 통해서만(`/augment` 처리와 기동 워밍업 외 호출 0 — 대화 경로 호출 0) | 코드 리뷰 |
| **ED-11** | 원격 백엔드 주소 검사는 생성기 **생성 전에** 실행된다(검사 실패 시 네트워크 연결 0) | 앱 수준 시험의 공인 주소 시나리오(연결 시도 전 실패) |
| **ED-12** | 새 의존성 0 | `pyproject.toml` diff |

---

## 3. 구성도

```
 [apps/api]  (변경 0)
   AugmentationProvider 포트 ── local ──▶ AUGMENTATION_LOCAL_BASE_URL (출구 클래스 AUGMENT_LOCAL · No.45 게이트)
                                             │  POST /augment { seeds, targetCount(1~60), locale }
                                             ▼
 [apps/ml-worker — 생성 프로세스(ML_WORKER_ROLE=augment, 별도 포트)]
   /augment ─ ① 시드 상한(20)·계약 상한(60) 400 검사(현행) ─ ② 백엔드 상한 절삭(신규) ─ ③ generate() ─ ④ 결과 상한 절삭(신규)
   _load_generator()  (★ 교체 지점 1곳)
     ├─ transformers ─▶ MockGenerator / HFCausalLMGenerator      (프로세스 안 적재 · 현행 불변)
     ├─ ollama ───────▶ OllamaGenerator ──HTTP──▶ Ollama 서버     (경량 설치 구성 · 상한 20 · 품질 미보증)
     └─ vllm ─────────▶ VllmGenerator   ──HTTP──▶ 생성 전용 vLLM  (운영 구성 · 상한 60 · 채택은 No.17)
                         ▲ 원격 2종은 생성 전에 backend_guard 주소 검사(루프백·사설·허용 목록) — 신규 통제 구간

 [apps/ml-worker — 임베딩 프로세스(ML_WORKER_ROLE=embed, 기본)]  (변경 0 · 경량 구성에서도 EMBEDDING_DEVICE=cpu 권장)
```

**왜 ml-worker 안인가**(ADR-0046 §2 요약): API는 "모델·서빙 엔진·프롬프트 규칙을 모른다"는 ADR-0026 §5 경계가 이미 있고, Ollama가 같은 자리에 들어가 API 변경 0으로 동작함이 실증됐다(`adf536e`). API에 `vllm` Provider를 새로 두면 ① 포트 유니온·팩토리·capability·출구 클래스(`EgressExitId` 7 → 8)·데이터 지도·설정 검증이 전부 바뀌고 ② 프롬프트·파싱 규약이 Python과 TS에 두 벌이 되며 ③ PM P-2(API 변경 0)와 충돌한다.

---

## 4. 생성 백엔드 인터페이스

### 4.1 `Generator` 계약 — 현행 유지 + 선택 속성 3개

현행 계약(`generator.py` 57~65행): `model_id: str` · `generate(seeds, target_count) -> list[str]`(실패 시 빈 배열, 예외 전파 금지) · `healthy() -> bool`. 이것은 **바꾸지 않는다.** 다음 **클래스 속성 3개를 기본값과 함께** 추가한다(기존 구현체는 수정 없이 기본값을 상속).

| 속성 | 타입 | 기본값(`Generator` 기준) | 뜻 |
|---|---|---|---|
| `backend` | `"transformers" \| "ollama" \| "vllm"` | `"transformers"` | 실제 생성 경로. `MockGenerator`·`HFCausalLMGenerator`는 기본값 상속 |
| `profile` | `"standard" \| "lightweight"` | `"standard"` | 구성 등급. **`OllamaGenerator`만 `"lightweight"`** (P-3 — "경량 설치 구성 = 동작 보장·품질 미보증"의 기계 판독 표식) |
| `target_cap` | `int \| None` | `None`(= 계약 상한 `GENERATION_TARGET_COUNT_MAX`) | 1회 생성 상한. `OllamaGenerator`=`OLLAMA_TARGET_CAP`, `VllmGenerator`=`VLLM_TARGET_CAP` |

- `"standard"`는 **품질 보증이 아니다.** vLLM 운영 구성의 모델을 켜도 되는지는 No.17 실측·합격 판정이 정한다(P-5). `profile`은 "이 구성이 경량 설치 구성인가"만 말한다.
- `warmup()`·`warmed_up`은 현행처럼 **선택 메서드**(`getattr` 판독)로 둔다.

### 4.2 `OllamaGenerator` 보강 (현행 클래스 수정)

| 항목 | 현행 | 변경 |
|---|---|---|
| 클래스 설명·로그 문구 | "dev-pipeline-validation 전용 — G3 후보 대체 아님" | **"경량 설치 구성 — 동작 보장·품질 미보증(No.37 P-3). 운영 G3 채택 판정은 No.17"**. "후보 3종 대체 아님" 문장은 유지 |
| 생성자 인자 | `base_url, model_name, max_new_tokens, request_timeout_s, connect_timeout_s, model_id, client` | 뒤에 키워드 인자 추가: `target_cap: int = 20`, `warmup_timeout_s: float = 120.0` (기본값이 있어 기존 시험의 생성자 호출은 그대로 통과) |
| 클래스 속성 | — | `backend="ollama"`, `profile="lightweight"` |
| 워밍업 | 결과와 무관하게 `warmed_up=True` | **워밍업 요청에만 `warmup_timeout_s` 적용**(첫 호출은 모델을 VRAM에 올리느라 오래 걸림 — httpx 요청 단위 `timeout` 인자) · 결과가 1건 이상일 때만 `warmed_up=True`, 0건이면 `False` + WARN 로그 1회. **기동을 막지는 않는다**(서버·모델 존재는 이미 `/api/tags`로 확인됨 — 워밍업 실패는 일시 상태일 수 있다) |
| 잘림 처리 | `done_reason == "length"`면 WARN 후 `parse_candidate_array()` | WARN(현행 문구의 권고 키를 `OLLAMA_MAX_NEW_TOKENS`로) 후 **`salvage_truncated_array()`**(§8) · 잘림이 아니면 현행대로 `parse_candidate_array()` |
| 사고 블록 | — | 파싱 전 `strip_think_blocks()`(§8) |

### 4.3 `VllmGenerator` 신설

| 항목 | 규칙 |
|---|---|
| 속성 | `backend="vllm"`, `profile="standard"`, `target_cap=VLLM_TARGET_CAP`, `model_id=f"vllm:{VLLM_MODEL}"` |
| 생성자 인자 | `base_url, model_name, api_key: str \| None, max_new_tokens, request_timeout_s, connect_timeout_s, warmup_timeout_s, target_cap, model_id, client: object \| None = None`(시험 주입용 — Ollama 선례) |
| HTTP 클라이언트 | `httpx.Client(timeout=Timeout(request, connect=connect), follow_redirects=False)` · 키가 있으면 기본 헤더 `Authorization: Bearer <key>`(없으면 헤더 없음 — FR-ED3-3) |
| 기준 주소 규칙 | `VLLM_BASE_URL`은 **서버 루트**(역프록시 경로 접두 허용, 예: `http://10.0.5.20:8000` · `https://gw.corp.local/vllm`). 코드가 `/v1/models`·`/v1/chat/completions`를 붙인다. **끝이 `/v1`이면 기동 실패**("`/v1`을 빼고 적으세요" — `/v1/v1` 사고 방지). 끝 `/`는 제거 |
| 기동 확인 | 생성자에서 `GET {base}/v1/models` → 200 · JSON `data[].id`에 `VLLM_MODEL`이 **정확히** 있어야 한다. 불통·비200·해석 불가·모델 없음 → `RuntimeError`(기동 실패, 조용한 mock 대체 없음 — FR-ED3-2). 메시지에는 **호스트(`scheme://host:port`)와 모델 이름만**(경로·키 0 — FR-ED5-5). 모델 없음 메시지: "vLLM 서버({host})가 모델 '{name}'을 제공하지 않습니다(제공 목록: …). vLLM의 `--served-model-name`과 `VLLM_MODEL`이 같은지 확인하세요." 3xx는 "리다이렉트는 따라가지 않습니다" 실패 |
| 생성 요청 | `POST {base}/v1/chat/completions` · 본문 `{ "model": VLLM_MODEL, "messages": [{"role": "user", "content": build_prompt(seeds, target_count)}], "max_tokens": VLLM_MAX_NEW_TOKENS, "temperature": 0.9, "top_p": 0.95, "stream": false }` |
| 응답 해석 | `choices[0].message.content`(문자열) · `choices[0].finish_reason == "length"`면 잘림(WARN + `salvage_truncated_array`) · 그 외 `parse_candidate_array`. 파싱 전 `strip_think_blocks` |
| 실패 | 연결·시간 초과·4xx/5xx·3xx·JSON 불일치·`choices` 없음 → WARN 로그(호스트·상태 코드·예외 **클래스 이름**만) + **빈 배열**(NFR-EDR1) |
| `healthy()` | `self._client is not None`(Ollama와 동일 — 요청마다 원격 헬스를 치지 않는다. 운영 중 원격 장애는 G1 폴백 + API 회로차단이 흡수 — EX-ED-2) |

**왜 대화형(`/v1/chat/completions`)인가** — 완성형(`/v1/completions`)은 원시 문자열을 그대로 모델에 넣어 **지시 튜닝 모델의 대화 템플릿이 적용되지 않는다.** 운영 후보(지시 튜닝 Gemma·Qwen 계열)는 템플릿 없이 품질이 급락한다. Ollama `/api/generate`(비`raw`)도 서버가 모델 템플릿을 적용하므로 **두 원격 백엔드가 "같은 프롬프트 문자열 + 서버 측 템플릿"으로 정렬**된다(FR-ED1-3 — 전송 형식만 다름). 지시문을 `system` 역할로 나누지 않는 이유: 일부 모델(Gemma 계열 등)의 템플릿이 `system` 역할을 지원하지 않거나 다르게 합친다 — **단일 `user` 메시지가 모든 후보에서 같은 입력**이 된다. 구조화 출력(vLLM의 JSON 스키마 강제 디코딩)은 버전별 인자 차이가 있어 **이번에 쓰지 않는다**(K-6 · 재검토 트리거).

> **확인 필요(ml-engineer — 구현 전)**: vLLM OpenAI 호환 서버의 `/v1/models` 응답 형식(`data[].id`)과 `finish_reason` 값, `--api-key` 설정 시 `/v1/models`에도 인증이 필요한지는 **사용할 vLLM 버전 문서로 확인**하고 §22 I-n에 기록한다. 가짜 서버(§15.2)는 이 설계의 가정 형식을 따르며, 실제와 다르면 가짜 서버와 이 절을 함께 고친다.

### 4.4 `_load_generator()` — 교체 지점 1곳

순서(의사 흐름 — 코드 아님):

1. `backend = settings.generation_backend.strip().lower()`
2. `backend ∉ {transformers, ollama, vllm}` → `RuntimeError("알 수 없는 GENERATION_BACKEND 값: '<값>' — transformers | ollama | vllm 중 하나")` → **생성 프로세스 기동 실패**(FR-ED1-5 · AC-ED2-4). 이 검사는 `loads_generation`일 때만 도는 이 함수 안에 있으므로 **임베딩 전용 프로세스는 영향 없음**(NFR-EDR2).
3. `ollama`·`vllm`이면: 필수값 검사(`vllm`: `VLLM_BASE_URL`·`VLLM_MODEL` 비어 있으면 기동 실패 — AC-ED2-3) → 상한·시간 제한 범위 검사(§5.3) → **`backend_guard.assert_backend_url_allowed()`(§11) — 생성기 생성 전(ED-11)** → 생성기 생성(생성자 안에서 서버·모델 확인) → `warmup()` → 기동 로그 1줄: `생성 백엔드={backend} 구성={profile} 모델={model_id} 호스트={host} 1회 상한={cap}` (+ 경량이면 `— 경량 설치 구성: 동작 보장·품질 미보증` WARN 1줄).
4. `transformers`면 **현행 코드 그대로**(mock 분기 → HF 분기 — ED-5).

`settings.is_ollama_backend` 속성은 기존 시험이 쓰므로 **유지**한다(내부는 정규화된 값 비교).

---

## 5. 설정 키

### 5.1 이름 규칙

- **백엔드 전용 키는 `<백엔드>_` 접두**(`OLLAMA_*`·`VLLM_*`) — 이미 쓰는 `OLLAMA_*`와 같은 규칙이므로 옛 이름 병행 읽기가 필요 없다(FR-ED1-2 · AC-ED2-5).
- **백엔드 공통·계약 키는 `GENERATION_*`** — `GENERATION_BACKEND`, 계약 상한(`GENERATION_TARGET_COUNT_MAX`·`GENERATION_SEEDS_MAX`), 워밍업·주소 통제.
- `GENERATION_MODEL_ID`·`GENERATION_MODEL_REVISION`·`GENERATION_DEVICE`는 **`transformers` 전용**으로 뜻을 좁혀 문서화한다(동작은 현행 — 원격 백엔드는 이미 무시한다).
- 시간 단위 접미사 `_S`(초, float) — 현행 `OLLAMA_*_TIMEOUT_S`와 같다.

### 5.2 전체 목록 (`apps/ml-worker/.env` — 전부 선택)

| 키 | 기본값 | 적용 | 설명 |
|---|---|---|---|
| `GENERATION_BACKEND` | `transformers` | 공통 | `transformers` \| `ollama` \| `vllm`(대소문자·앞뒤 공백 무시). **그 외 값 = 생성 프로세스 기동 실패** |
| `GENERATION_MODEL_ID` / `_REVISION` / `GENERATION_DEVICE` | `mock` / `main` / `cuda` | transformers | 현행. `mock`이면 결정론적 에코(계약 검증용) |
| `GENERATION_MAX_NEW_TOKENS` | `512` | transformers (+ Ollama 폴백 — 아래) | 현행 |
| `GENERATION_TARGET_COUNT_MAX` | `60` | 공통(계약) | `targetCount` 계약 상한 — 초과 400(현행) |
| `GENERATION_SEEDS_MAX` | `20` | 공통(계약) | 시드 상한 — 초과 400(현행 · K-1 참고) |
| **`GENERATION_WARMUP_TIMEOUT_S`** | `120` | ollama·vllm | 기동 워밍업 1회 요청에만 적용(모델 적재 시간 흡수) |
| **`GENERATION_BACKEND_ALLOWED_HOSTS`** | 빈 값 | ollama·vllm | 루프백·사설 대역 밖 주소를 쓰려면 여기에 명시. 콤마 구분 · `host` 또는 `host:port` · `*.suffix` 와일드카드 · 대소문자 무시(API `DATA_EGRESS_ALLOWED_HOSTS`와 같은 형식) |
| **`GENERATION_BACKEND_REQUIRE_ALLOWLIST`** | `false` | ollama·vllm | `true`면 루프백·사설 대역도 목록에 있어야 한다(거버넌스 모드 설치 권장 — API 쪽 "루프백도 자동 허용 안 됨" 규약과 정렬). Pydantic `bool`은 `"false"`를 거짓으로 읽는다(FR-0-280 충족) |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | ollama | 현행 |
| `OLLAMA_MODEL` | `qwen3:4b-instruct-2507-q4_K_M` | ollama | 현행(기존 설치 호환을 위해 기본값 유지 — 기동 시 존재 확인이 있어 "조용히 특정 모델로 동작"이 아니다. FR-0-283 R-8) |
| `OLLAMA_REQUEST_TIMEOUT_S` | **`25`**(현행 90에서 변경) | ollama | §10 |
| `OLLAMA_CONNECT_TIMEOUT_S` | `5` | ollama | 현행 |
| **`OLLAMA_MAX_NEW_TOKENS`** | 미설정 → `GENERATION_MAX_NEW_TOKENS`를 **명시 설정했으면 그 값**, 아니면 **`768`** | ollama | 3050 조건 A(20건·768토큰 = 잘림 0/3)에서 출발(FR-ED2-4). 폴백 체인은 기존에 `GENERATION_MAX_NEW_TOKENS`로 Ollama를 조정한 설치 보호용 |
| **`OLLAMA_TARGET_CAP`** | **`20`** | ollama | P-3 확정값. 범위 1~`GENERATION_TARGET_COUNT_MAX` |
| **`VLLM_BASE_URL`** | 없음(**`vllm`이면 필수**) | vllm | 서버 루트(끝 `/v1` 금지) |
| **`VLLM_MODEL`** | 없음(**`vllm`이면 필수**) | vllm | vLLM `--served-model-name` 값. 운영 채택 모델은 No.17 판정 |
| **`VLLM_API_KEY`** | 없음 | vllm | 비밀값(`SecretStr`). 없으면 인증 헤더 없음 |
| **`VLLM_REQUEST_TIMEOUT_S`** | **`25`** | vllm | §10 |
| **`VLLM_CONNECT_TIMEOUT_S`** | `5` | vllm | |
| **`VLLM_MAX_NEW_TOKENS`** | **`2048`** | vllm | 60건 JSON 배열 출발값 — 3050 보고서에서 60건은 900토큰도 2/3 잘림(C-3), 보고서 §8-2가 운영 실측 출발값으로 1500~2000을 권고. **No.17 실측 후 확정**(FR-ED3-6) |
| **`VLLM_TARGET_CAP`** | **`60`** | vllm | 현행 계약 상한과 같음 — No.17 실측 전까지 절삭 효과 없음(FR-ED3-6) |

### 5.3 기동 시 설정 검사 (생성 프로세스만)

| 검사 | 실패 시 |
|---|---|
| `GENERATION_BACKEND` 값 | 기동 실패 |
| `vllm`인데 `VLLM_BASE_URL`·`VLLM_MODEL` 비어 있음 | 기동 실패(키 이름을 메시지에) |
| `VLLM_BASE_URL` 끝이 `/v1` | 기동 실패 |
| 상한(`OLLAMA_TARGET_CAP`·`VLLM_TARGET_CAP`)이 1~`GENERATION_TARGET_COUNT_MAX` 밖 | 기동 실패 |
| 시간 제한·최대 토큰 ≤ 0 | 기동 실패 |
| 원격 요청 시간 제한 > 30초 | **경고만**(§10 — "API `AUGMENTATION_TIMEOUT_MS`(기본 30초)보다 길면 API가 포기한 뒤에도 생성이 계속됩니다") |
| 주소 판정(§11) | 기동 실패 |

---

## 6. 요구사항 §11 "architect 확정 사항" 결정 요약

| 확정 대상 | 결정 | 절 |
|---|---|---|
| ADR-0026·0024 갱신 범위 · 신규 ADR 번호 | 신규 **ADR-0046** + ADR-0026(재검토 트리거·§5 범위·갱신 절) · ADR-0024(재검토 트리거 표시·갱신 절) | 머리 · 패치 C·D |
| 백엔드별 환경변수 이름 규칙 · `OLLAMA_*` 호환 | `<백엔드>_` 접두 / 공통 `GENERATION_*` — 옛 이름 변경 없음 | §5.1 |
| vLLM 전송 형식 | OpenAI 호환 **대화형 `/v1/chat/completions` · 단일 `user` 메시지 · 같은 프롬프트 문자열** · 기동 확인 `/v1/models` | §4.3 |
| `modelId` 접두 규칙 | `<backend>:<모델>` — `ollama:`(현행) · `vllm:`(신규) · `transformers`는 현행 `<모델>@<rev>` 그대로(기존 문자열을 바꾸면 기존 로그·평가 보고서 식별자가 흔들린다) | §4.3 |
| `/augment/health` 필드 변경 방식 | 선택 필드 3개(`backend`·`profile`·`targetCap`) + 원격 `device="external"` | §9 |
| capability 경량 판별 근거 | **이번에 하지 않음**(P-2 — API·화면 변경 0) | R-1 |
| 경량 상한 적용 위치 | ml-worker `/augment` 안 절삭 + 결과 절삭 | §7 |
| 백엔드 주소 통제 방식 | ml-worker 자체 순수 함수 검사 + 선택 스위치 | §11 |
| 헛일 제한 방식 | 원격 요청 시간 제한 기본 25초 + 30초 초과 경고 | §10 |
| 데이터 지도 표기 | 변경 없음 — 운영 문서에 구간 명시 | §11.3 |
| FR-0-285 닫힌 목록 | **0건** | §15.5 |
| vLLM 공유 여부와 ADR-0022 | 생성 전용만 지원 · 외부 RAG vLLM 직접 호출 미지원 | §11.4 |
| EX-ED-4 추가 방어 | 잘림 신호 시 닫힌 원소만 복구(원격 한정) | §8 |

---

## 7. 경량 상한 적용 지점 — `/augment` 안에서 절삭 (P-3·P-6)

### 7.1 위치 결정: ml-worker 절삭 (API 요청 수 조정 기각)

| 안 | 판단 |
|---|---|
| **ml-worker `/augment`에서 `min(targetCount, cap)`으로 절삭** (채택) | API 변경 0(P-2) · 상한이 **백엔드를 아는 쪽**에 있다(API는 어떤 백엔드인지 모른다 — ADR-0026 §5) · 응답 계약상 후보 수 보장이 원래 없다(요구사항 §5.1) |
| API가 capability로 상한을 받아 요청 수를 줄임 | API·capability 스키마 변경 — P-2 위반. 이득(요청 바이트 절약)이 미미 |
| 400으로 거부 | API가 매번 G1로 폴백 → 경량 구성을 켜도 사실상 G1만 씀(요구사항 FR-ED2-3) |
| 여러 번 나눠 60건 채움 | 3050에서 20건 ≈13초 → 60건 ≈39초 > 30초(P-6 기각) |

### 7.2 처리 순서 (`/augment` 핸들러)

1. 시드 상한 초과 → 400 (**현행**)
2. `targetCount > GENERATION_TARGET_COUNT_MAX` → 400 (**현행** — 계약 상한. 절삭보다 먼저라 61은 여전히 400 — C-5)
3. 빈 시드 → 400 (**현행**)
4. 생성기 없음 → 503 (**현행**)
5. **`effective = min(targetCount, generator.target_cap or GENERATION_TARGET_COUNT_MAX)`** — 절삭되면 INFO 로그 1줄(요청 수·적용 수만, 시드 원문 0)
6. `candidates = generator.generate(seeds, effective)` — 백엔드에 보내는 프롬프트의 `targetCount`도 `effective`(가짜 서버가 이 값을 기록 → AC-ED3-1)
7. **`candidates = candidates[:effective]`** — 모델이 더 많이 내도 상한을 넘지 않는다(API 후보 임베딩이 `EMBEDDING_BATCH_MAX=64`를 넘어 Job 전체가 `EMBEDDING_UNAVAILABLE`로 끝나는 경로 차단). `MockGenerator`는 정확히 `target_count`건을 내므로 **기본 구성·mock 경로의 응답은 바이트 동일**
8. 응답 `{ modelId, candidates }` (**현행 스키마**)

**효과 예시**(경량, API 요청 60): Ollama에는 20건 요청 → 검증 5종 통과분만 제안. 편집자 화면의 "생성 N건 중 M건 통과"(FR-L1-14)는 N=실제 생성 수로 정직하게 표시된다.

---

## 8. 출력 방어 — 잘림 복구 · 사고 블록 제거 (원격 백엔드 전용)

`generator.py`에 순수 함수 2개를 둔다. **공용 `parse_candidate_array()`는 바꾸지 않는다**(ED-4 — transformers 경로·기존 시험 불변).

| 함수 | 규칙 | 적용 |
|---|---|---|
| `strip_think_blocks(text) -> str` | `<think>…</think>` 블록 제거(여러 개 · 줄바꿈 포함) · 닫히지 않은 `<think>`가 있으면 그 뒤 전부 제거 | Ollama·vLLM 응답 파싱 전(사고형 모델 혼입 방어 — 확인 필요 항목을 코드로 흡수) |
| `salvage_truncated_array(text) -> list[str]` | 코드블록 표시 제거 → 먼저 `json.loads` 시도(성공하면 그대로 — 잘림 표시가 있어도 완결된 경우) → 실패하고 첫 비공백 문자가 `[`이면 **닫힌 JSON 문자열 리터럴만** 순서대로 복원(`json.JSONDecoder().raw_decode`로 `"`에서 시작하는 원소를 하나씩 해석, 해석 실패 지점에서 중단) → `[`로 시작하지 않으면 `parse_candidate_array()`로 위임 | 잘림 신호(`done_reason=="length"` · `finish_reason=="length"`)가 있을 때만 |

- 효과: 보고서 §4의 "잘린 190자 문자열 통째 = 후보 1개"가 **"닫힌 문장 N개"** 로 바뀐다. 마지막 미완 원소는 버려진다(EX-ED-4의 "잘린 가비지 1건이 검증 통과" 경로 차단 — R-7).
- 기존 시험 `test_generate_truncated_json_does_not_raise`(입력 `'["환불 규정 좀 알려줘", "환불 조건이'`)는 "리스트를 반환한다"만 단언하므로 **수정 없이 통과**하고 결과는 `["환불 규정 좀 알려줘"]`가 된다(신규 시험이 이 값을 단언).

---

## 9. `/augment/health` 표기

### 9.1 응답 — 선택 필드 3개 추가 (FR-ED6-1)

```
{ status, modelId, device, warmedUp,        ← 현행 4필드(의미 규칙만 아래처럼)
  backend?: "transformers" | "ollama" | "vllm",
  profile?: "standard" | "lightweight",
  targetCap?: number }
```

| 필드 | 규칙 |
|---|---|
| `device` | `transformers` → `GENERATION_DEVICE`(**현행 그대로** — mock일 때도 현행처럼 설정값. 바이트 동일 보존 · K-4) · **`ollama`·`vllm` → `"external"`**(연산은 외부 서빙 엔진에서 일어나고 ml-worker는 CPU/GPU 분산을 모른다 — `cuda`를 사실처럼 보고하지 않음 · AC-ED3-3). `status=loading`일 때도 같은 규칙 |
| `backend` | 정규화된 `GENERATION_BACKEND`(생성기가 있으면 `generator.backend`) |
| `profile` | `generator.profile` — Ollama = `"lightweight"` |
| `targetCap` | `generator.target_cap or GENERATION_TARGET_COUNT_MAX` |
| `warmedUp` | transformers = 현행 · 원격 = §4.2 규칙(워밍업 결과 ≥1건) |

- **API 영향 0**: API zod 스키마는 모르는 키를 버리고(C-4), `healthy()`는 `status === 'ok'`만 본다. capability·콘솔 표시는 바뀌지 않는다.
- **"품질 미보증"의 표시 위치**(P-2 범위 안): ① `/augment/health`의 `profile: "lightweight"` ② 기동 WARN 로그 ③ 운영 문서 등급표·설치 점검 ④ 3050 동작 확인 보고서. **콘솔 문구는 이번에 없다**(R-1 · 재검토 트리거).
- 잘림 횟수 노출(FR-ED2-4의 architect 선택지)은 **하지 않는다** — 상태 응답에 누적 카운터를 두면 다중 워커·재기동 의미가 모호해진다. 잘림은 WARN 로그로 충분하다(운영자는 로그로 확인 · K-7).

---

## 10. 시간 제한 정렬 — API 30초 vs ml-worker (P-9)

| 구간 | 값 | 근거 |
|---|---|---|
| API → ml-worker (`AUGMENTATION_TIMEOUT_MS`) | 30초(현행 불변) | API 변경 0 |
| ml-worker → Ollama/vLLM 요청 (`OLLAMA_REQUEST_TIMEOUT_S`·`VLLM_REQUEST_TIMEOUT_S`) | **25초** | API보다 **먼저** 포기해야 한다. 여유 5초 = ml-worker 파싱·응답 직렬화 + API 쪽 네트워크. 3050 조건 A(20건) p95 ≈13초라 상한 20건과 함께 쓰면 여유가 있다 |
| 워밍업 (`GENERATION_WARMUP_TIMEOUT_S`) | 120초 | 기동 중 1회 — 대화·API 요청과 무관 |

**왜 이것으로 헛일이 줄어드나**: FastAPI 동기 핸들러는 API가 연결을 끊어도 **계속 실행된다**(취소가 전달되지 않는다). 그래서 API 쪽 30초 포기만으로는 ml-worker가 90초까지 백엔드를 붙잡았다. ml-worker 자신이 25초에 HTTP 연결을 닫으면 ① ml-worker 스레드가 풀리고 ② 백엔드 서버는 클라이언트 연결 종료를 감지해 생성을 중단할 수 있다(**Ollama·vLLM의 연결 종료 시 중단 동작은 버전 확인 필요** — ml-engineer가 3050 동작 확인 때 `ollama ps`·GPU 사용률로 관찰해 보고서에 기록 · K-5).

**기각한 안**: 취소 전달(요청 ID + 취소 엔드포인트 또는 비동기 핸들러에서 연결 끊김 감지) — `/augment` 계약·API 변경 필요(P-9 "정렬 권고값 먼저"). 재검토 트리거로 남긴다.

**운영자 조정 규칙**(운영 문서에 적음): API의 `AUGMENTATION_TIMEOUT_MS`를 올리는 설치는 원격 요청 시간 제한을 **그 값 − 5초 이하**로 함께 올린다. ml-worker는 API 값을 모르므로 **30초 초과 시 경고만** 한다.

---

## 11. 생성 백엔드 주소 통제 · No.45 출구 게이트와의 관계 (P-8)

### 11.1 왜 필요한가

API의 출구 게이트(ADR-0040)는 **API → ml-worker**(`AUGMENT_LOCAL`)까지만 본다. G3 시드는 "사내 전송 전제"로 **마스킹하지 않는다**(ADR-0026 171행 · FR-ED5-3). ml-worker → Ollama/vLLM 구간은 지금 어떤 통제도 없어, 주소를 다른 망으로 잘못 두면 마스킹 안 된 시드가 통제 밖으로 나간다(R-4). ml-worker는 DB·API 설정을 읽지 않으므로(ADR-0024 §갱신 1-③) **ml-worker 자체 검사**로 막는다.

### 11.2 판정 규칙 — `backend_guard.assert_backend_url_allowed(url, allowed_hosts, require_allowlist, resolver)`

순수 함수(이름 해석기 주입 가능 — 시험에서 가짜 해석기). 실패 시 `RuntimeError`(메시지에 호스트만).

1. 형식: 스킴 `http`·`https`만 · 호스트 필수 · **URL 안 사용자 정보(`user:pass@`) 금지**(로그로 새는 자격증명 방지 — 인증은 `VLLM_API_KEY`로만).
2. **항상 금지**(허용 목록에 있어도): 링크로컬 `169.254.0.0/16`·`fe80::/10`(클라우드 메타데이터 대역) · 미지정 `0.0.0.0`·`::` · 멀티캐스트.
3. 허용 목록(`GENERATION_BACKEND_ALLOWED_HOSTS`)에 호스트(또는 `host:port`, `*.suffix`)가 있으면 **허용**(2번은 여전히 적용 — 해석한 주소가 금지 대역이면 거부).
4. `require_allowlist=true`이면 여기서 **거부**.
5. 호스트가 IP 리터럴이면: **루프백**(`127.0.0.0/8`·`::1`) 또는 **사설**(`10.0.0.0/8`·`172.16.0.0/12`·`192.168.0.0/16`·`fc00::/7`)이면 허용, 아니면 거부. (`100.64.0.0/10`은 사설로 치지 않는다 — 통신사 공유 대역)
6. 호스트가 이름이면: `localhost`는 허용. 그 외는 **기동 시점에 이름 해석**해 나온 **모든** 주소가 5번 기준을 만족해야 허용(하나라도 공인 주소면 거부 — "명시 허용 목록에 넣으세요").
7. 거부 메시지 예: `생성 백엔드 주소({host})가 루프백·사설 대역이 아닙니다. 사내 서버가 맞다면 GENERATION_BACKEND_ALLOWED_HOSTS에 명시하세요(마스킹하지 않은 예문 시드가 이 주소로 전송됩니다).`

- 적용 대상: `ollama`·`vllm`만. `transformers`는 네트워크로 생성을 보내지 않는다(모델 내려받기는 `HF_HUB_OFFLINE` 절차 소관).
- **리다이렉트 금지**(ED-7)로 "허용 주소가 공인 주소로 넘겨주는" 우회를 막는다.
- 남는 위험: 이름 해석은 **기동 시 1회**다. 기동 뒤 DNS가 바뀌면(재바인딩) 검사를 우회할 수 있다 → 운영 문서에 **IP 리터럴 또는 hosts 파일 고정 권장**(K-3).

### 11.3 데이터 지도·API 거버넌스와의 관계

- API 출구 클래스 **7종 불변**(`EgressExitId` — FR-0-278). ml-worker → 백엔드 구간은 API 출구가 아니다.
- **데이터 지도 표기 변경 없음**(API·화면 변경 0). 대신 운영 문서 §5.8에 **"ml-worker → 생성 백엔드" 구간과 목적지·마스킹 없음**을 명시하고, 거버넌스 모드 설치의 설치 점검에 `GENERATION_BACKEND_REQUIRE_ALLOWLIST=true`를 넣는다(FR-ED5-2 최소안 · K-2).
- API 쪽 `DATA_EGRESS_ALLOWED_HOSTS`는 여전히 **ml-worker 주소**(예: `127.0.0.1:8101`)를 담는다(현행 규약 — EX-ED-10).

### 11.4 외부 RAG의 vLLM과의 관계 (P-4 · ADR-0022)

- P-4에 따라 **생성 전용 vLLM**을 둔다. ml-worker가 외부 RAG가 쓰는 vLLM을 직접 부르는 구성은 **지원하지 않는다**(운영 문서에 금지로 적음). 근거: ① ADR-0022는 "외부 RAG 서버 접촉면은 API의 허용 경로뿐"을 봉인했다 — 그 서버의 vLLM을 다른 프로세스가 직접 부르면 봉인이 우회된다 ② RAG 답변 지연·장애가 예문 늘리기와 섞인다(EX-ED-14).
- ml-worker는 `RAG_BASE_URL`을 모르므로 **코드로 강제하지 않는다**(K-8) — 설치 점검 항목으로 둔다.

---

## 12. 비밀값

| 항목 | 규칙 |
|---|---|
| 보관 | `VLLM_API_KEY`는 `pydantic.SecretStr` — `repr(settings)`·`settings.model_dump()` 기본 출력에 `**********`. 값 꺼내기는 `VllmGenerator` 생성 시 1곳 |
| 전송 | `Authorization: Bearer` 헤더만. URL·쿼리 0 |
| 로그·오류 | 기동 확인·생성 실패 로그는 호스트·상태 코드·예외 **클래스 이름**만(httpx 예외 메시지에는 URL이 들어가므로 경로까지 새지 않게 호스트로 치환). 응답 본문 인용은 Ollama 현행처럼 200자 이내이되 **vLLM은 인용하지 않는다**(인증 오류 본문이 입력 일부를 되돌려 주는 서버 구현 대비) |
| 상태 보고 | `/augment/health`에 키 존재 여부조차 싣지 않는다 |
| 평가 도구 | `eval/generation_candidates.py`는 키를 **CLI 인자로 받지 않고** 환경변수 `VLLM_API_KEY`에서만 읽는다(셸 기록 방지) |

---

## 13. 폐쇄망 모델 사전 배치 절차 (FR-ED4-2)

운영 문서 `docs/05-ops/자동배포.md` **§5.8 6번**(패치 E-2)에 실었다. 이 절은 설계 근거와 요점만 둔다.

| 대상 | 요점 | 기동 시 외부 내려받기 0 보장 |
|---|---|---|
| HF(임베딩·`transformers` 생성) | 인터넷 PC에서 **리비전 고정**으로 내려받아 캐시 디렉터리째 반입 → `HF_HOME` 지정 + `HF_HUB_OFFLINE=1` | 오프라인 플래그로 내려받기 시도 자체가 오류가 된다(조용한 대기 없음 — EX-ED-8) |
| Ollama | 인터넷 PC(같은 Ollama 버전)에서 `ollama pull <태그>` → 모델 저장소(`OLLAMA_MODELS` 또는 설치 기본 경로)의 `manifests/`·`blobs/`를 통째로 반입 → `ollama list`로 태그 확인 · 매니페스트 digest 기록 · Ollama는 `OLLAMA_HOST=127.0.0.1:11434`(루프백 바인딩) | ml-worker는 `/api/tags`로 **존재만 확인**하고 `pull`을 부르지 않는다 → 없으면 기동 실패(EX-ED-3) |
| vLLM | 인터넷 PC에서 HF 저장소를 **리비전 고정**으로 내려받아 반입 → vLLM을 **로컬 경로 + `--served-model-name`** 으로 기동(`HF_HUB_OFFLINE=1`) → `VLLM_MODEL`은 served-model-name | ml-worker는 `/v1/models`로 존재만 확인 |

> **확인 필요**: Ollama 기본 모델 저장 경로(OS·설치 방식별)와 vLLM 기동 인자 이름은 버전마다 다를 수 있다 — deployment-engineer/ml-engineer가 실제 버전으로 확인해 운영 문서를 고친다.

---

## 14. 장비 등급표 (FR-ED4-1)

운영 문서 §5.8 1번(패치 E-2)에 실었다. **새로 잰 값은 없다** — 기존 기록(`model-comparison.md`·`ollama-dev-pipeline-validation.md`)에서 옮겼고, 3050 경량 구성의 **상한 20 적용 후 전 경로 동작 확인**(AC-ED3-5)은 ml-engineer가 구현 후 수행해 칸을 갱신한다.

| 등급 | 장비 예 | 권장 설정 | 상태 | 품질 |
|---|---|---|---|---|
| 0 | GPU 없음 | 임베딩 CPU · `AUGMENTATION_PROVIDER=rule` · 생성 프로세스 없음 | 동작 확인됨(현행 기본값 · KURE-v1 CPU P95 126~159ms — 개발 PC) | 해당 없음(생성 없음) |
| 1 | 4GB급 GPU(개발 기준 RTX 3050 Laptop) | 임베딩 CPU · 생성 프로세스 `ollama` · 4B Q4 · 상한 20 | 동작 확인됨(2026-09-29 — 20건 ≈13초 · 60건 불가 · 33% CPU 분산) · **상한 절삭 경로는 구현 후 재확인** | **미판정** |
| 2 | 8~24GB GPU | 임베딩 CPU 또는 GPU · `ollama` 또는 `transformers` | 미확인 | 미판정 |
| 3 | L40S급(운영) | 생성 전용 vLLM · `vllm` | 미확인 — No.17 실측 대기 | 미판정(No.17) |

**시연용 모델 확정(2026-09-30)**: 2026-09-30 RTX 3050 실측(20건·768토큰): `qwen3:4b-instruct-2507-q4_K_M` = 생성 19/20/19건·의미보존 0.948·p95 약 13초 → **시연 기본 모델로 확정**. `qwen3.5:4b-q4_K_M` = 3케이스 모두 0건·p95 약 99.6초(토큰 한도 절단 경고 반복; 사고 토큰 소진 추정, 미검증) → 현재 설정에서 부적합. 보고서: `apps/ml-worker/eval/report/generation/ollama_dev-pipeline-validation_qwen3.5-4b-q4_K_M@main.md`. (동작 확인 기록이며 품질 합격 판정은 아님 — 운영 모델은 No.17.)

---

## 15. 시험 전략

### 15.1 원칙

- **GPU·Ollama·vLLM 없이 전 시험 통과**(FR-0-281). 두 가지 가짜만 쓴다: ① 단위 시험 = `httpx.MockTransport` 주입(Ollama 선례) ② 앱 수준 시험 = **`127.0.0.1` 임시 포트의 가짜 vLLM·Ollama HTTP 서버**(표준 라이브러리 `http.server.ThreadingHTTPServer` · 스레드 기동 · 시험 종료 시 정지). 실제 서버 호출 시험은 CI에 넣지 않는다.
- 공인 주소 거부 시험은 **연결 전에 실패**하므로 네트워크가 없다(예: `http://8.8.8.8:9` — 주소 검사에서 거부, ED-11). 이름 해석이 필요한 시험은 **가짜 해석기 주입**으로 DNS를 쓰지 않는다.
- 설정 싱글턴은 기존 방식대로 환경변수 설정 → `importlib.reload(config)`·`reload(app)` → `teardown`에서 원복(기존 `test_ollama_backend_app.py` 패턴).

### 15.2 가짜 서버 fixture (`tests/conftest.py`에 추가)

| 기능 | 내용 |
|---|---|
| vLLM 경로 | `GET /v1/models` → `{"object":"list","data":[{"id": <모델>}]}` · `POST /v1/chat/completions` → `{"choices":[{"message":{"role":"assistant","content": <본문>},"finish_reason": <이유>}]}` |
| Ollama 경로 | `GET /api/tags` → `{"models":[{"model": <태그>}]}` · `POST /api/generate` → `{"response": <본문>, "done_reason": <이유>}` |
| 시나리오 스위치(시험이 설정) | 모델 목록(빈 목록 = 모델 없음) · 응답 본문 · 종료 이유(`stop`/`length`) · 상태 코드(예: 500) · 지연(`delay_s` — 시간 초과 재현) · 리다이렉트(3xx 재현) · 요구 키(설정 시 `Authorization` 불일치면 401) |
| 기록 | 받은 요청의 경로·헤더·본문(JSON) 목록 — 보낸 `targetCount`·`max_tokens`·프롬프트·`Authorization` 단언용 |
| 동시성 | `ThreadingHTTPServer` — 느린 요청이 걸려 있어도 다음 요청을 받는다(AC-ED3-4) |

### 15.3 신규 시험 파일

| 파일 | 대상 |
|---|---|
| `tests/test_vllm_generator.py` | `VllmGenerator` 단위(MockTransport): 기동 확인 성공·모델 없음·불통·비200·3xx·끝 `/v1` · 생성 정상·빈 응답·500·시간 초과·`finish_reason=length` 복구·사고 블록 제거 · 보낸 프롬프트 == `build_prompt()` · 키 있으면 헤더·없으면 헤더 없음 |
| `tests/test_vllm_backend_app.py` | 앱 수준(가짜 vLLM 서버): `vllm` 기동 → `/augment` 후보·`modelId` 접두 · `/augment/health`(`backend`·`profile`·`device=external`·`targetCap`) · 주소 누락·모델 없음·불통·알 수 없는 백엔드 기동 실패 · 요청 시간 초과 후 다음 요청 즉시 처리 · 공인 주소 기동 실패 |
| `tests/test_backend_guard.py` | 주소 판정 순수 함수: 루프백·사설 허용 · 공인 거부 · 허용 목록(정확·`host:port`·`*.suffix`) · `require_allowlist` · 링크로컬·`0.0.0.0` 항상 거부 · 사용자 정보 거부 · 이름 해석 결과 혼합(사설+공인) 거부 · `localhost` 허용 |
| `tests/test_generation_cap.py` | 상한 절삭: 가짜 Ollama 서버 · `targetCount=60` → 백엔드가 받은 `targetCount`=20 · 응답 후보 ≤20 · `targetCount=61` → 400 유지 · transformers mock 경로 응답 바이트 동일(`targetCount=3` → 3건 · 기존 문자열) · 설정 상한 0·61 기동 실패 · `OLLAMA_MAX_NEW_TOKENS` 폴백 체인 3경우 |
| `tests/test_secret_redaction.py` | `VLLM_API_KEY="sk-test-SECRET-9f3a"`로 기동·생성·401 오류·시간 초과·`/augment/health` 수행하며 `caplog` 전체 + 응답 본문 + 기동 실패 예외 메시지 + `repr(settings)`에서 키 문자열 0건 |

기존 `test_ollama_backend_app.py`에 **추가**(수정 아님): Ollama 공인 주소 → 기동 실패 · 기존 `OLLAMA_*`만 설정한 설치 기동 성공(가짜 Ollama 서버 — AC-ED2-5) · `/augment/health`의 `device=external`·`profile=lightweight` · 기동 WARN 로그에 "품질 미보증" 문구.

### 15.4 수동 게이트 (CI 밖)

| 항목 | 방법 | 기록 |
|---|---|---|
| AC-ED3-5 3050 경량 구성 전 경로 | 생성 프로세스(`ollama`, 상한 20) + 임베딩 프로세스(CPU) + API(`local`) → 콘솔 의도 화면에서 예문 늘리기 → 제안 표시까지 | `eval/report/edge-lightweight-operation-check.md` — 장비(GPU·VRAM·드라이버)·일자·명령·Ollama 버전·모델 태그·digest·`ollama ps` CPU/GPU 분산·요청/생성/통과 건수·소요 시간·API 쪽 폴백 여부·**"동작 확인용 — 품질 판단 근거 아님"** 문구·25초 시간 초과 시 Ollama 생성 중단 여부 관찰(K-5) |
| vLLM 실연결 | L40S 담당자 확보 후 No.17 실측과 함께 | No.17 보고서 |

### 15.5 FR-0-285 닫힌 목록 — 의도된 기존 시험 기대값 변경

**0건.** 근거: 계약 상한 400(C-5)·`is_ollama_backend` 속성·`OllamaGenerator` 생성자 기존 인자·`parse_candidate_array`·`/augment/health`의 기존 필드 단언(`status`·`modelId`·`warmedUp` — `device`는 기존 시험이 단언하지 않음)이 모두 보존된다. `test_generate_truncated_json_does_not_raise`는 결과 값이 바뀌지만(§8) 단언은 "리스트"뿐이라 수정 불필요. **구현 중 기존 시험 수정이 필요해지면 이 목록을 architect가 갱신한 뒤에만 고친다.** api jest·web vitest는 대상 파일 변경 0이라 영향 없음(AC-ED1-1은 전체 재실행으로 확인).

### 15.6 AC ↔ 시험 매핑

| AC | 시험 | 종류 |
|---|---|---|
| AC-ED1-1 | ml-worker `pytest` 전체(기존 27 + 신규) · api `npx jest` · web `npx vitest run` 수정 없이 통과 | 자동 |
| AC-ED1-2 | ED-1 — `git diff --stat`(code-reviewer) | 리뷰 |
| AC-ED1-3 | `packages/shared-types/src/governance.ts` diff 0(ED-1에 포함) | 리뷰 |
| AC-ED1-4 | `apps/widget` diff 0 → 번들 불변(ED-1에 포함) | 리뷰 |
| AC-ED2-1 | `test_vllm_backend_app` — 정상 기동·`/augment` 후보·`modelId` `vllm:` 접두 | 자동 |
| AC-ED2-2 | `test_vllm_backend_app` 모델 없음·불통 기동 실패 + 메시지에 호스트·모델만 · `test_secret_redaction` | 자동 |
| AC-ED2-3 | `test_vllm_backend_app` — `VLLM_BASE_URL`/`VLLM_MODEL` 누락 기동 실패 | 자동 |
| AC-ED2-4 | `test_vllm_backend_app` — `GENERATION_BACKEND=vlm` 기동 실패 · 같은 값 + `ML_WORKER_ROLE=embed`는 정상 기동(NFR-EDR2) | 자동 |
| AC-ED2-5 | `test_ollama_backend_app` 추가분 — 기존 `OLLAMA_*`만 → 가짜 Ollama로 정상 | 자동 |
| AC-ED2-6 | `test_vllm_generator` 500·시간 초과 → 빈 배열 · `test_vllm_backend_app` → `/augment` 200 + `candidates=[]`. API의 G1 폴백·저하 안내는 **기존** API 시험(`local` Provider 빈 배열 → G1)이 이미 보장 | 자동 |
| AC-ED3-1 | `test_generation_cap` — `targetCount=60` → 가짜 서버 기록의 프롬프트 `targetCount`=20 · 후보 ≤20 · 400 아님 | 자동 |
| AC-ED3-2 | **조정(R-1)**: 콘솔 문구 없음 → `/augment/health.profile == "lightweight"` + 기동 WARN 로그 문구 단언(`test_ollama_backend_app` 추가분) | 자동(대체) |
| AC-ED3-3 | `test_ollama_backend_app`·`test_vllm_backend_app` — `device == "external"` · `backend` 값 | 자동 |
| AC-ED3-4 | `test_vllm_backend_app` — `VLLM_REQUEST_TIMEOUT_S=1` · 가짜 서버 `delay_s=5` → 첫 `/augment`가 약 2초 안에 빈 후보로 끝나고, 곧바로 보낸 두 번째 요청(지연 0)이 정상 후보 · 설정 기본값 25 < 30 단언 | 자동 |
| AC-ED3-5 | §15.4 수동 게이트 | 수동 |
| AC-ED4-1 | `test_backend_guard` + 앱 수준 공인 주소 기동 실패(vLLM·Ollama) | 자동 |
| AC-ED4-2 | `test_backend_guard` 루프백·사설 허용 · 앱 수준 정상 기동(가짜 서버는 `127.0.0.1`) | 자동 |
| AC-ED4-3 | `test_secret_redaction` | 자동 |
| AC-ED5-1 | 운영 문서 §5.8 1번 등급표 칸 형식(code-reviewer) | 리뷰 |
| AC-ED5-2 | 운영 문서 §5.8 6번 HF·Ollama·vLLM 반입 절 존재 | 리뷰 |
| AC-ED5-3 | 개발명세서 §5.1 행·`GENERATION_MODEL_ID` 서술 정정(패치 A-2 적용 여부) | 리뷰 |
| AC-ED5-4 | 운영 문서 §5.8 7번 모델 라이선스 표 | 리뷰 |

NFR 매핑: NFR-EDR1(모든 실패 → 빈 배열) = `test_vllm_generator` 실패 시나리오 전부 · NFR-EDR2 = AC-ED2-4 두 번째 단언 · NFR-EDR3 = §5.3 검사 각각의 기동 실패 시험 · NFR-EDS2 = 보낸 프롬프트 == `build_prompt()`(시드는 JSON 필드) · NFR-EDM1 = §4.4 구조(리뷰) · NFR-EDA1 = R-1 조정(콘솔 표식 없음).

---

## 16. 구현 체크리스트 (`ml-engineer` — `apps/ml-worker` 한정)

> 착수 전: §4.3 "확인 필요"(vLLM 응답 형식)를 사용할 버전 문서로 확인. 다른 앱 파일을 건드려야 할 상황이 생기면 **멈추고 architect에 되묻는다**(ED-1).

1. [ ] `config.py` — §5.2 새 키·기본값(`OLLAMA_REQUEST_TIMEOUT_S` 25) · `VLLM_API_KEY: SecretStr | None` · 파생 속성 `normalized_generation_backend`·`resolved_ollama_max_new_tokens`(폴백 체인 — `GENERATION_MAX_NEW_TOKENS`의 명시 설정 여부는 `model_fields_set`로 판별, 동작을 시험으로 확인) · `is_ollama_backend` 유지 · 파일 안 "No.17 파이프라인 검증 전용" 표기를 "경량 설치 구성(No.37) — 동작 보장·품질 미보증"으로
2. [ ] `backend_guard.py` 신설 — §11.2 순수 함수(해석기 주입)
3. [ ] `generator.py` — `Generator` 선택 속성 3개 · `strip_think_blocks`·`salvage_truncated_array` · `OllamaGenerator` 보강(§4.2 — 인자 추가는 기본값 있는 키워드로) · `VllmGenerator` 신설(§4.3 · `follow_redirects=False` 명시) · `parse_candidate_array`·`build_prompt`·`HFCausalLMGenerator`·`MockGenerator` 불변(ED-4·ED-5)
4. [ ] `app.py` — `_load_generator()` §4.4 순서(값 검사 → 필수값·범위 → 주소 검사 → 생성 → 워밍업 → 로그) · `/augment` §7.2 절삭 5·7단계 · `AugmentHealthResponse`에 선택 필드 3개(기존 4필드 직렬화는 그대로) · `device` 규칙 §9.1 · 모듈 머리 주석 갱신
5. [ ] `.env.example` — "개발·시연 전용" → "경량 설치 구성 — 동작 보장·품질 미보증(운영 채택은 No.17)" · `OLLAMA_REQUEST_TIMEOUT_S=25` · `OLLAMA_MAX_NEW_TOKENS`(주석 처리 예시 768)·`OLLAMA_TARGET_CAP=20` · `VLLM_*` 블록(키는 빈 값) · `GENERATION_WARMUP_TIMEOUT_S`·`GENERATION_BACKEND_ALLOWED_HOSTS`·`GENERATION_BACKEND_REQUIRE_ALLOWLIST` · 프로세스 분리 예시(임베딩 8100 · 생성 8101)
6. [ ] `eval/generation_candidates.py` — `--backend vllm`·`--vllm-base-url`(키는 환경변수) · 보고서 파일 이름에 백엔드 접두
7. [ ] 시험 — §15.2 fixture(가짜 vLLM + 가짜 Ollama) · §15.3 신규 5파일 + 기존 파일 **추가** 시험 · 기존 시험 수정 0(§15.5)
8. [ ] `pytest -q` 전체 통과 · api `npx jest`·web `npx vitest run` 재실행(변경 0 확인)
9. [ ] 3050 수동 게이트(§15.4) → `eval/report/edge-lightweight-operation-check.md` 작성 → `docs/05-ops/자동배포.md` §5.8 1번 등급 1행 "상한 절삭 적용 후 전 과정" 칸 갱신(일자·장비) — 패치 E-2 적용 후
10. [ ] 구현 편차가 있으면 이 문서 §22에 I-n으로 기록

---

## 17. 마이그레이션 · 호환성

- **DB 변경 0** · 데이터 이관 0 · 롤백 = 이전 ml-worker 코드로 되돌리기만(새 설정 키는 모르는 키로 무시됨 — `extra="ignore"`).
- **동작이 바뀌는 기존 설치**(릴리스 노트·운영 문서 §5.8 10번에 적음):

| 대상 | 변화 | 대응 |
|---|---|---|
| `GENERATION_BACKEND=ollama` + 시간 제한 미설정 | 90초 → 25초 | 의도된 변경(P-9). 느린 장비에서 20건이 25초를 넘으면 `OLLAMA_TARGET_CAP`을 낮춘다 |
| `.env`에 `OLLAMA_REQUEST_TIMEOUT_S=90`이 남은 설치(C-7) | 값 유지 + 기동 경고 | 25로 고친다 |
| `GENERATION_BACKEND=ollama` + 공인 주소 Ollama | **기동 실패** | 사내 주소로 옮기거나 `GENERATION_BACKEND_ALLOWED_HOSTS`에 명시 |
| `GENERATION_BACKEND`에 오타·알 수 없는 값 | 조용히 transformers → **생성 프로세스 기동 실패** | 값을 고친다 |
| Ollama + API 요청 60건 | 60건 요청(대부분 시간 초과 → G1) → **20건 생성** | 의도된 변경(P-3) |
| Ollama + `GENERATION_MAX_NEW_TOKENS` 미설정 | 512 → 768 | 의도된 변경(잘림 감소) |
| 기본 구성(`embed`) · `transformers` 생성 | **변화 없음**(FR-0-274) | — |

---

## 18. 알려진 제한 (K)

| # | 제한 | 이유 · 후속 |
|---|---|---|
| **K-1** | **예문 20개 이상 의도는 G3가 항상 400 → G1**(C-9 — API가 시드 21개를 보냄) | 이 그룹 이전부터의 결함. 고치려면 API(`MAX_SEED_EXAMPLES`를 19로) 또는 ml-worker 계약(`GENERATION_SEEDS_MAX` 21 + 기존 시험 기대값 변경) 중 하나 — P-2 범위 밖. **`bug-triage` 인계 권고**(영향: 예문이 충분한 의도는 증강 이득이 작아 실사용 영향은 제한적이나, G3 실측(No.17)과 3050 동작 확인에서 착시를 만든다 — 동작 확인은 예문 19개 이하 의도로 할 것) |
| K-2 | 데이터 지도에 "ml-worker → 생성 백엔드" 구간이 표시되지 않는다 | API·화면 변경 0(P-2). 운영 문서로 대체. 재검토 트리거: API 거버넌스 화면을 다시 여는 그룹 |
| K-3 | 이름 해석은 기동 시 1회(DNS 재바인딩 잔여 위험) | IP 리터럴·hosts 고정 권장 |
| K-4 | `transformers` + mock 생성기의 `/augment/health.device`는 여전히 설정값(`cuda`) | 바이트 동일 보존. mock은 계약 검증용 |
| K-5 | API가 포기한 뒤 백엔드가 즉시 멈추는지는 엔진 버전 의존 | 25초 정렬로 상한을 둠 · 3050 확인 때 관찰 기록 |
| K-6 | 출력 형식은 여전히 "지시문으로 JSON 배열 요청"뿐(구조화 출력 강제 없음) | 버전별 인자 차이. No.17 실측에서 형식 오류율이 높으면 재검토 |
| K-7 | 잘림 횟수는 로그로만 본다 | §9.1 |
| K-8 | "외부 RAG의 vLLM을 직접 부르지 말 것"은 코드로 강제하지 않는다 | ml-worker는 RAG 주소를 모른다 · 설치 점검 항목 |
| K-9 | 콘솔에 "사내 경량 모델 — 품질 미보증" 문구가 없다 | R-1 |
| K-10 | 원본 PDF 확인(P-11) 전 해석 | 원문에 다른 뜻이 있으면 요구사항부터 재검토(설정·문서 중심이라 되돌리기 쉬움) |

---

## 19. 요구사항 대비 해석 · 조정 (R)

| # | 요구사항 | 이 설계 | 이유 |
|---|---|---|---|
| **R-1** | FR-ED6-2·AC-ED3-2·NFR-EDA1: capability·콘솔에 "사내 경량 모델 — 품질 미보증" 글자 표시 | **이번에 하지 않음.** `/augment/health.profile` + 기동 로그 + 운영 문서로 대체 | C-3 — API capability 스키마·콘솔 변경이 필요하고 PM P-2가 "API·화면 변경 0"으로 닫았다. 재검토 트리거: No.17 운영 채택 시(생성기 표식을 capability에 올리는 API 변경을 그때 함께) |
| **R-2** | FR-ED1-4·EX-ED-12: 제안·감사에 생성기 표식(`modelId` 접두)이 남음 | `modelId` 접두 규칙은 확정하되 **남는 곳은 ml-worker 응답·로그뿐** | C-2 — API가 생성기 `modelId`를 버린다. 제안 행에는 `providerId='local'`만 남는다 |
| R-3 | FR-ED1-2: 변수 이름 규칙 정리 · 옛 이름 병행 읽기 | 옛 이름을 **바꾸지 않으므로** 병행 읽기 불필요 | `<백엔드>_` 접두 규칙이 현행 `OLLAMA_*`와 이미 같다 |
| R-4 | FR-ED2-3 방식(ml-worker vs API) | ml-worker `/augment` 절삭 + 결과 절삭 | §7.1 |
| R-5 | FR-ED2-5 방식 | 원격 요청 시간 제한 기본 25초 + 30초 초과 경고 | §10 · P-9 |
| R-6 | FR-ED6-1 방식(선택 필드 vs `device` 규칙) | **둘 다** — 선택 필드 3개 + 원격이면 `device="external"` | C-4로 API 영향 0 확인 |
| **R-7** | EX-ED-4 추가 방어 여부 | **추가함** — 잘림 신호 시 닫힌 원소만 복구(원격 백엔드 한정) | 보고서 69행의 "잘린 가비지 통과" 경로를 싸게 차단. 공용 파서는 불변 |
| R-8 | FR-0-283 모델 이름 하드코딩 금지 | `OLLAMA_MODEL` 코드 기본값은 **유지**(기존 설치 호환) · vLLM은 기본값 없음 | 기동 시 존재 확인이 있어 조용한 동작이 아님 |
| R-9 | FR-ED5-1 방식 | ml-worker 자체 검사 + 선택 스위치 `GENERATION_BACKEND_REQUIRE_ALLOWLIST` | ml-worker DB·API 설정 무접근 원칙 |
| R-10 | FR-ED5-2 데이터 지도 | 운영 문서만(최소안) | P-2 · K-2 |
| R-11 | FR-ED4-1 등급표 위치 | `자동배포.md` §5.8(별도 운영 문서 안 만듦) | 기존 운영 요구 절(§5.x) 규약 · §5.3 4번에서 참조 |
| R-12 | FR-ED3-5 외부 RAG vLLM 공유 판단 | 지원하지 않음(P-4) · 코드 강제 없음 | §11.4 · K-8 |

---

## 20. 상위 문서 반영 (`docs/02-spec/edge-inference-patches.md` — ✅ 적용됨 2026-09-30)

architect 세션에는 부분 수정 도구가 없고 대상 파일이 모두 CRLF라, 전체 재작성은 줄바꿈을 통째로 바꿀 위험이 있다. 선행 그룹과 같이 **찾기/바꾸기 패치 16건**으로 남기며 오케스트레이터가 적용한다(앵커 유일성은 작성 시점에 검사 완료).

| 문서 | 반영 | 패치 |
|---|---|---|
| `docs/02-spec/개발명세서.md` §2 ml-worker 행 | 생성 백엔드 3종·위탁 문장 | A-1 |
| 같은 문서 §5.1 | 530행 정정(`GENERATION_MODEL_ID` 기본 `mock` · `/augment` 존재는 `ML_WORKER_ROLE`이 결정) + `GENERATION_*` 6종·`OLLAMA_*`·`VLLM_*` 행 | A-2 |
| 같은 문서 §6 | 결정 29(ADR-0024)·30(ADR-0026) 갱신 각주 · **결정 47 신설** | A-3 · A-4 · A-5 |
| 같은 문서 §7 | 이 설계서 · ADR-0046 행 | A-6 · A-7 |
| `docs/01-requirements/기능요구사항.md` 79행 | 비고 갱신(E1 해석 · 규모 A · GPU 4 유지 각주 · 구독형 ✕ 각주) | B-1 |
| `ADR-0026` | 160행 재검토 트리거 인라인 갱신 · §5(100행) 적용 범위 표시 · `## 갱신 (2026-09-30 — No.37)` | C-1 · C-2 · C-3 |
| `ADR-0024` | 117행 재검토 트리거 인라인 표시 · `## 갱신 (2026-09-30 — No.37)` | D-1 · D-2 |
| `docs/05-ops/자동배포.md` | §5.3 4번(생성 백엔드 반입·주소 통제 연결) · **§5.8 신설**(등급표·프로세스 구성·경량/운영 구성·주소 통제·폐쇄망 반입·라이선스·시간 제한 조정·설치 점검·업그레이드 변화) | E-1 · E-2 |
| `docs/requirements/edge-inference.md` | (선택) PM 확정 표기 | F-1 |
| `CLAUDE.md` | **수정하지 않음**(사용자/오케스트레이터 처리) | — |

---

## 21. 재검토 트리거

- **No.17 운영 채택 판정** → ① `VLLM_TARGET_CAP`·`VLLM_MAX_NEW_TOKENS` 기본값 확정 ② capability에 생성기 구성 표식(`profile`·`backend`)을 올리는 API·콘솔 변경(R-1·R-2 해소)을 함께 설계.
- **생성 형식 오류·잘림률이 운영 실측에서 높음** → 구조화 출력 강제 디코딩 도입(K-6).
- **느린 장비에서 25초 정렬로도 헛일이 대화·다음 요청에 영향** → 취소 전달(`/augment` 계약 확장) 재검토.
- **두 번째 LLM 소비자 착수(No.38 재개 등)** → `packages/llm-provider` 승격 판단(ADR-0026 §6 — 이번에도 소비자 1곳, 백엔드 수는 소비자 수가 아니다).
- **등급 1~2 장비에서 임베딩 CPU P95가 예산 근접** → ADR-0024 §5 완화 2단계(ONNX int8).
- **다지점·단말 추론 요구 확인** → E2·E3 별도 그룹.

---

## 22. 구현 편차 기록 (구현 후 ml-engineer 작성)

| # | 내용 |
|---|---|
| 1 | **vLLM 인증 헤더 부착 위치** — 클라이언트 기본 헤더가 아니라 요청마다(`/v1/models`, `/v1/chat/completions`) 붙인다. `httpx.MockTransport` 시험에서 헤더를 검증할 수 있게 하기 위함. |
| 2 | **`.env.example`의 `GENERATION_MAX_NEW_TOKENS=512` 주석 처리** — 명시하면 `OLLAMA_MAX_NEW_TOKENS` 미설정 시 그 값이 쓰여 768 기본이 무력화된다. 기존 `.env`에 명시한 값은 그대로 유효하다. |
| 3 | **`VLLM_BASE_URL` 끝 `/v1` 검사 순서** — `app.py`에서 생성기 생성보다 먼저 수행한다(생성기 안에도 동일 검사 유지). |
| 4 | **`strip_think_blocks`** — 닫는 `</think>`만 남은 응답은 마지막 닫는 태그 뒤만 남긴다. |
| 5 | **`AugmentHealthResponse`의 `backend`·`profile`** — `Literal` 또는 `None`. loading 상태에서는 `backend`만 채우고 `profile`·`targetCap`은 `null`. |
| 6 | **리뷰 후 수정(cap 기본값)** — `OLLAMA_TARGET_CAP`·`VLLM_TARGET_CAP` 기본값을 `None`으로 두고, 미설정 시 각각 `min(20, GENERATION_TARGET_COUNT_MAX)` / `GENERATION_TARGET_COUNT_MAX`를 따른다. 명시 cap이 0 이하이거나 상한을 넘을 때만 기동 실패한다. |
| 7 | **리뷰 후 수정(결과 절단)** — 결과 절단(`[:effective]`)은 `generator.target_cap`이 있는 원격 백엔드에만 적용한다(`transformers`·mock 무변경). |
| 8 | **리뷰 후 수정(키 경고)** — 비루프백 `http` 대상에 `VLLM_API_KEY`가 설정되면 기동 시 WARN을 남긴다(호스트만 기록, 키 값 미노출). |
| 9 | **`transformers` 경로의 `/augment/health`** — 선택 필드 `backend`·`profile`·`targetCap`이 함께 붙는다(API 영향 없음). |

**미확인 (실제 vLLM 서버 필요 — No.17 실측 때 확인)**

- `/v1/models` `data[].id` 형식, `finish_reason` 값, `--api-key` 설정 시 `/v1/models` 인증 여부.
- K-5: 클라이언트 연결이 끊길 때 Ollama/vLLM 생성이 중단되는지.
- 콘솔 → API → ml-worker 전 경로는 실행하지 않았다.

**실측 (2026-09-30, RTX 3050 Laptop 4GB, Ollama 0.34.4, `qwen3:4b-instruct-2507-q4_K_M`)** — 동작 확인(품질 합격 아님). 기동(워밍업 포함) 8.6초, `/augment` 60건 요청 → 20건 절삭, 응답 200 · 14.9초 · 후보 20건. health: `backend=ollama` `profile=lightweight` `targetCap=20` `device=external` `warmedUp=true`. 장비 등급표(`자동배포.md` §5.8)에 반영.
