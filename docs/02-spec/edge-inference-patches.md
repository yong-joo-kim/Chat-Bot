# No.37 온디바이스/엣지 추론 — 기존 문서 패치 목록

> 작성: system-architect · 2026-09-30 · 근거: `docs/02-spec/edge-inference-설계.md`, `docs/02-spec/decisions/ADR-0046-edge-inference-ml-worker-generation-backends-lightweight-cap-and-backend-address-guard.md`
> **적용 상태**: ✅ **적용됨(2026-09-30)** — A-1~A-7·B-1·C-1~C-3·D-1~D-2·E-1~E-2·F-1 16건 모두 앵커 1회 매칭 확인 후 CRLF 보존으로 적용(이하는 적용 전 원문 기록). (architect 세션에 부분 수정 도구가 없고 대상 파일이 모두 CRLF라, 전체 재작성 시 줄바꿈이 통째로 바뀌는 위험을 피하려고 패치 목록으로 남긴다 — 선행 그룹 `*-patches.md`와 같은 방식.)
> **적용 방법**: 각 항목의 "찾을 원문"을 대상 파일에서 **정확히 1회** 찾아 "바꿀 내용"으로 교체한다. 모든 원문은 2026-09-30 시점 작업 트리(커밋 `631180d` 이후)에서 복사했고, 문자열 검색으로 대상 파일 안 유일성을 확인했다. "바꿀 내용"이 원문을 그대로 포함하는 항목은 append다.
> **줄바꿈 주의**: 대상 파일은 CRLF다. 모든 "찾을 원문"은 **한 줄 안의 부분 문자열**(줄바꿈 미포함)이다. "바꿀 내용"의 줄바꿈은 대상 파일의 줄바꿈(CRLF)으로 정규화한다.
> **순서 독립**: 어떤 "바꿀 내용"도 다른 항목의 "찾을 원문"을 새로 만들지 않는다. 같은 줄에 앵커가 둘인 항목은 없다.
> 코드 변경은 이 파일의 범위가 아니다 — 설계서 §16(ml-engineer 체크리스트)을 따른다. **`CLAUDE.md`는 이 패치의 대상이 아니다**(사용자/오케스트레이터 처리).
> 항목 수: 개발명세서 7 · 기능요구사항 1 · ADR-0026 3 · ADR-0024 2 · 자동배포 2 · (선택) 요구사항 PM 결정 기록 1 = **16건**

---

## A. `docs/02-spec/개발명세서.md`

### A-1. §2 워크스페이스 상태 표 — `apps/ml-worker` 행 끝에 생성 백엔드 문장 추가 (78행)

**찾을 원문**
````text
기본값 그대로 두면 **현행과 100% 동일**하게 동작한다 |
````
**바꿀 내용**
````text
기본값 그대로 두면 **현행과 100% 동일**하게 동작한다. **엣지 추론 Phase(No.37)** — 생성 프로파일의 백엔드를 `GENERATION_BACKEND`(`transformers` 기본 · `ollama` = 경량 설치 구성(동작 보장·품질 미보증 · 1회 상한 20) · `vllm` = 예문 늘리기 전용 사내 vLLM)로 고르며 원격 2종은 외부 서빙 엔진에 **위탁**한다(주소는 루프백·사설·명시 허용 목록만 · `/augment` 계약·API 불변 — ADR-0046) |
````

### A-2. §5.1 환경변수 — 530행 정정 + 생성 백엔드 행 추가 (FR-ED4-3 · AC-ED5-3)

**찾을 원문**
````text
| **`GENERATION_MODEL_ID`** / **`GENERATION_DEVICE`** | `apps/ml-worker/.env` | — | 미설정 / `cuda` | 생성 프로파일 모델·디바이스. 미설정이면 `/augment`가 존재하지 않는다 |
````
**바꿀 내용**
````text
| **`GENERATION_MODEL_ID`** / **`GENERATION_DEVICE`** | `apps/ml-worker/.env` | — | `mock` / `cuda` | **`transformers` 백엔드 전용** 생성 모델·디바이스(`GENERATION_MODEL_REVISION` 기본 `main`). `mock`이면 결정론적 에코(계약 검증용). **`/augment`의 존재 여부는 이 값이 아니라 `ML_WORKER_ROLE`이 정한다**(`augment`·`both`일 때만 존재 — 2026-09-30 정정, No.37) |
| **`GENERATION_BACKEND`** | `apps/ml-worker/.env` | — | `transformers` | 생성 백엔드. `transformers`(프로세스 안 적재 · 현행) \| `ollama`(경량 설치 구성 — 동작 보장·품질 미보증) \| `vllm`(생성 전용 사내 vLLM). **그 외 값 = 생성 프로세스 기동 실패**(임베딩 전용 프로세스는 무시) — ADR-0046 |
| **`GENERATION_MAX_NEW_TOKENS`** | `apps/ml-worker/.env` | — | `512` | `transformers` 최대 생성 토큰. Ollama는 `OLLAMA_MAX_NEW_TOKENS`가 없고 이 값을 **명시 설정했을 때만** 폴백으로 쓴다 |
| **`GENERATION_TARGET_COUNT_MAX`** / **`GENERATION_SEEDS_MAX`** | `apps/ml-worker/.env` | — | `60` / `20` | `/augment` **계약** 상한(초과 400) — 백엔드 공통. 백엔드별 1회 생성 상한은 `*_TARGET_CAP`(절삭) |
| **`GENERATION_WARMUP_TIMEOUT_S`** | `apps/ml-worker/.env` | — | `120` | `ollama`·`vllm` 기동 워밍업 1회 요청의 시간 제한(모델 적재 시간 흡수) |
| **`GENERATION_BACKEND_ALLOWED_HOSTS`** | `apps/ml-worker/.env` | — | 미설정 | 생성 백엔드 주소 허용 목록(콤마 · `host`/`host:port`/`*.suffix`). **미설정 = 루프백·사설 대역·`localhost`만.** 링크로컬·미지정 주소는 목록에 있어도 거부 · 리다이렉트 비추적(ADR-0046 §6) |
| **`GENERATION_BACKEND_REQUIRE_ALLOWLIST`** | `apps/ml-worker/.env` | — | `false` | `true`면 루프백·사설 대역도 목록 필수(거버넌스 설치 권장) |
| **`OLLAMA_BASE_URL`** / **`OLLAMA_MODEL`** | `apps/ml-worker/.env` | — | `http://localhost:11434` / `qwen3:4b-instruct-2507-q4_K_M` | 경량 설치 구성의 Ollama 서버·모델 태그. 기동 시 서버·모델 존재 확인(없으면 생성 프로세스 기동 실패 · 내려받기 시도 0) |
| **`OLLAMA_REQUEST_TIMEOUT_S`** / **`OLLAMA_CONNECT_TIMEOUT_S`** | `apps/ml-worker/.env` | — | `25` / `5` | ml-worker → Ollama 시간 제한. **API `AUGMENTATION_TIMEOUT_MS`보다 짧게**(API보다 먼저 포기 — 헛일 제한 · 30초 초과 시 기동 경고 · 2026-09-30 90 → 25) |
| **`OLLAMA_MAX_NEW_TOKENS`** | `apps/ml-worker/.env` | — | 미설정(→ `GENERATION_MAX_NEW_TOKENS` 명시값, 없으면 `768`) | 경량 구성 최대 생성 토큰(상한 20건 JSON 배열 기준 출발값) |
| **`OLLAMA_TARGET_CAP`** | `apps/ml-worker/.env` | — | `20` | 경량 구성 1회 생성 상한 — `targetCount`가 넘으면 **상한까지만 생성**(400 아님 · 1~`GENERATION_TARGET_COUNT_MAX`) |
| **`VLLM_BASE_URL`** / **`VLLM_MODEL`** | `apps/ml-worker/.env` | — | 미설정 | `GENERATION_BACKEND=vllm`이면 **필수**(없으면 기동 실패). 서버 루트(끝 `/v1` 금지) · vLLM `--served-model-name` 값. 운영 모델 채택은 No.17. 외부 RAG의 vLLM 주소 금지(ADR-0022) |
| **`VLLM_API_KEY`** | `apps/ml-worker/.env` | — | 미설정 | 비밀값 — `Authorization: Bearer`로만 전송 · 로그·상태·오류 0건. 없으면 인증 헤더 없음 |
| **`VLLM_REQUEST_TIMEOUT_S`** / **`VLLM_CONNECT_TIMEOUT_S`** | `apps/ml-worker/.env` | — | `25` / `5` | `OLLAMA_*_TIMEOUT_S`와 같은 정렬 규칙 |
| **`VLLM_MAX_NEW_TOKENS`** / **`VLLM_TARGET_CAP`** | `apps/ml-worker/.env` | — | `2048` / `60` | 출발값 — No.17 운영 실측 후 확정 |
````

### A-3. §6 결정 29(ADR-0024) — 갱신 각주 추가 (715행 뒤)

**찾을 원문**
````text
(ADR-0024 갱신 각주, ADR-0039 §4).
````
**바꿀 내용**
````text
(ADR-0024 갱신 각주, ADR-0039 §4).
    - **갱신(2026-09-30 — No.37)**: "추론 전용"·DB 무접근·`/embed`·`/health` 계약은 **불변**이다. 생성 프로파일은 모델을 프로세스 안에 올리는 것(`transformers`) 외에 **외부 서빙 엔진(Ollama·vLLM)에 HTTP로 위탁**할 수 있다(`GENERATION_BACKEND` — 교체 지점 `_load_generator()` 1곳 · 알 수 없는 값은 생성 프로세스만 기동 실패). 위탁 구간(ml-worker → 생성 백엔드)은 API 출구 게이트 밖이고 시드를 마스킹하지 않으므로 **ml-worker 자체 주소 검사**(루프백·사설·명시 허용 목록 · 링크로컬 금지 · 리다이렉트 비추적)를 둔다. 엣지 = 고객사 사내 소형 서버(E1)로 확정 — 대화 경로 임베딩은 CPU 기본값 그대로이며 경량 구성에서도 임베딩 CPU·생성 프로세스 분리를 권장한다. 장비 등급표는 `자동배포.md` §5.8(ADR-0024 갱신 각주, ADR-0046 §1·§2·§6).
````

### A-4. §6 결정 30(ADR-0026) — 갱신 각주 추가 (717행 뒤)

**찾을 원문**
````text
(+ ADR-0018 보론 · ADR-0024 갱신)
````
**바꿀 내용**
````text
(+ ADR-0018 보론 · ADR-0024 갱신)
    - **갱신(2026-09-30 — No.37)**: 포트 1 + 구현 3종·팩토리·G1 수렴·출구 클래스는 **불변**이다. ADR-0026 재검토 트리거 "사내 vLLM 게이트웨이 → `AugmentationProviderId` 유니온 확장"은 **API가 아니라 ml-worker 생성 백엔드(`vllm`)로 흡수**했다 — API의 `local` Provider가 그대로 부른다(`/augment` 계약 불변). Ollama 경로는 "개발 전용"에서 **"경량 설치 구성 — 동작 보장·품질 미보증"**(1회 상한 20 — ml-worker `/augment` 안 절삭, 400 아님)으로 지위가 정리됐고, ADR-0026 §5의 "소형 양자화 모델로 타협하지 않는다"는 **운영 G3 후보 선정 기준**으로 범위가 좁혀진다(운영 채택 판정은 No.17). ml-worker 원격 요청 시간 제한 기본 25초(API 30초보다 먼저 포기). 경량 여부는 `/augment/health` 선택 필드(`backend`·`profile`·`targetCap`)로만 보고하며 콘솔 문구는 No.17 채택 때로 미룬다. LLM 소비자는 여전히 1곳 — `packages/llm-provider` 승격 트리거 미발동(ADR-0026 갱신 각주, ADR-0046 §2~§5).
````

### A-5. §6 — 결정 47 신설 (775행 뒤)

**찾을 원문**
````text
→ **ADR-0045**(+ ADR-0009·0011·0012·0038·0040·0041·0042 갱신 각주)
````
**바꿀 내용**
````text
→ **ADR-0045**(+ ADR-0009·0011·0012·0038·0040·0041·0042 갱신 각주)
47. **온디바이스/엣지 추론(No.37)의 해석·백엔드 위치·경량 상한·표시·시간 제한·주소 통제 확정(2026-09-30 — 사용자 확정: P-1 (a) 고객사 사내 소형 서버 · P-2 (A) · P-3 (a) 경량 설치 구성·상한 20 · 나머지 권고안)**: **① 엣지 = 고객사 사내 소형 서버(E1)** — 브라우저·휴대폰 안 추론(위젯 100KB·의존성 0 원칙 충돌 · 자산을 단말로 내려야 해 유출 증가)·다지점 원격관리·대화 경로 LLM은 하지 않는다. **② 생성 백엔드 3종(`transformers`·`ollama`·`vllm`)은 ml-worker 안에서만 고른다** — 교체 지점 `_load_generator()` 1곳 · 알 수 없는 값은 생성 프로세스만 기동 실패 · API 포트·팩토리·capability·출구 7클래스·`/augment` 계약 불변(API에 vLLM Provider를 두는 안 기각 — 유니온·출구·지도·프롬프트 두 벌). vLLM = OpenAI 호환 **대화형 `/v1/chat/completions` · 단일 `user` 메시지 · 같은 프롬프트 문자열**(완성형·SDK 기각) · 기동 시 `/v1/models` 확인(실패 = 기동 실패) · 새 의존성 0 · `modelId` `<backend>:<모델>`. **③ 경량 구성(Ollama) = 동작 보장·품질 미보증 · 1회 상한 `OLLAMA_TARGET_CAP` 20** — `/augment`에서 계약 상한 400 검사 뒤 `min(targetCount, cap)` 절삭 + 결과 절삭(400·API 요청 수 조정 기각) · vLLM 상한 60·최대 토큰 2048은 No.17 실측 후 확정. **④ 표시** — `/augment/health` 선택 필드 `backend`·`profile`(`standard`｜`lightweight`)·`targetCap` · 원격이면 `device="external"`(API zod strip이라 API 영향 0) · 콘솔 "품질 미보증" 문구는 API·화면 변경 0(P-2)으로 보류(No.17 채택 때). **⑤ 원격 요청 시간 제한 기본 25초**(Ollama 90 → 25 · API 30초보다 먼저 포기 — 동기 핸들러는 API 연결 끊김으로 멈추지 않음) · 워밍업 120초 · 30초 초과 기동 경고 · 취소 전달 기각. **⑥ 생성 백엔드 주소 = 루프백·사설·명시 허용 목록**(`GENERATION_BACKEND_ALLOWED_HOSTS` — API `DATA_EGRESS_ALLOWED_HOSTS`와 같은 형식) · 링크로컬·미지정 항상 금지 · 이름은 기동 시 해석한 모든 주소 판정 · 생성기 생성 전 검사 · 리다이렉트 비추적 · 거버넌스 설치 `GENERATION_BACKEND_REQUIRE_ALLOWLIST=true` · 데이터 지도 변경 없음(운영 문서로 구간 명시) · **생성 전용 vLLM만 — 외부 RAG의 vLLM 직접 호출 미지원**(ADR-0022). **⑦ 잘림 신호 시 닫힌 JSON 문자열 원소만 복구 · `<think>` 제거**(원격 한정 · 공용 파서 불변). **⑧ `VLLM_API_KEY` = `SecretStr` · Bearer 헤더만 · 로그·상태·오류 0건.** 3050·경량 구성 결과는 "동작 확인"만, 품질·지연 합격은 운영 모델 실측(No.17). 장비 등급표(0 GPU 없음 ~ 3 L40S)·폐쇄망 모델 반입(HF·Ollama·vLLM)·설치 점검은 `자동배포.md` §5.8. **구현 = `ml-engineer` 1명(ml-worker 한정) · API·위젯·엔진·화면·DB 변경 0 · 기존 시험 기대값 변경 0건.** GPU **4 유지 + 각주**(P-10). 기존 결함 발견: API가 시드 최대 21개를 보내 ml-worker 상한 20에 걸려 예문 20개 이상 의도의 G3가 항상 G1로 폴백(K-1 — `bug-triage` 인계). → **ADR-0046**(+ ADR-0024·0026 갱신 각주)
````

### A-6. §7 인덱스 — 세부 설계서 행 추가 (803행 뒤)

**찾을 원문**
````text
| 요구사항: `docs/requirements/proactive-messaging.md` |
````
**바꿀 내용**
````text
| 요구사항: `docs/requirements/proactive-messaging.md` |
| **`edge-inference-설계.md`** | **온디바이스/엣지 추론(No.37) — 사용자 확정(E1 · 규모 A · Ollama 경량 설치 구성 상한 20) · 코드에서 찾은 제약 10(알 수 없는 백엔드의 조용한 폴백 · API의 생성기 `modelId` 폐기 · capability 생성기 정보 없음 · API zod strip · 계약 상한 400 시험 · 워밍업 실패 은폐 · `.env.example` 90초 · 한 줄 잘림 · 시드 21>20 기존 결함 · 리다이렉트) · 변경 범위 ml-worker 한정·봉인 ED-1~ED-12 · 생성 백엔드 인터페이스(`backend`·`profile`·`target_cap`) · `VllmGenerator`(대화형 API · 기동 확인) · 설정 키 이름 규칙·전체 목록·기동 검사 · ★상한 절삭 위치·순서 · 잘림 복구·사고 블록 제거 · `/augment/health` 선택 필드·`device` 규칙 · ★시간 제한 정렬(25초) · ★주소 통제 판정 규칙·No.45 관계·외부 RAG vLLM 비지원 · 비밀값 · 폐쇄망 반입 · 장비 등급표 · 시험 전략(가짜 vLLM·Ollama 서버)·**의도된 기대값 변경 0건**·AC↔시험 매핑 · ml-engineer 구현 체크리스트 · 호환성 · 알려진 제한 10 · 요구사항 대비 해석·조정 12** | 요구사항: `docs/requirements/edge-inference.md` |
````

### A-7. §7 인덱스 — ADR-0046 행 추가 (848행 뒤)

**찾을 원문**
````text
AC-PA1~PA9 |
````
**바꿀 내용**
````text
AC-PA1~PA9 |
| **`decisions/ADR-0046-edge-inference-ml-worker-generation-backends-lightweight-cap-and-backend-address-guard.md`** | **엣지 = 고객사 사내 소형 서버(E1 — 단말·다지점 제외) · 생성 백엔드 3종(`transformers`·`ollama`·`vllm`)은 ml-worker 안에서만(API Provider 추가 기각 · 알 수 없는 값 기동 실패) · vLLM = OpenAI 호환 대화형(완성형·SDK 기각) · 경량 상한 20 = `/augment` 안 절삭(400·API 요청 수 조정 기각) · 품질 미보증 = 상태 보고 선택 필드·로그·문서(콘솔 문구 보류) · 원격 시간 제한 25초(취소 전달 기각) · 생성 백엔드 주소 통제(루프백·사설·허용 목록 · 리다이렉트 비추적) · 외부 RAG vLLM 직접 호출 미지원 · 잘림 시 닫힌 원소 복구 · 새 의존성 0** | 요구사항 J-1~J-10, FR-0-274~285, FR-ED1-\*~FR-ED6-\*, AC-ED1~ED5 |
````

---

## B. `docs/01-requirements/기능요구사항.md`

### B-1. §4 No.37(79행) 비고 갱신 (GPU 4 유지 + 각주 · 구독형 ✕ 유지 + 각주)

**찾을 원문**
````text
| 4 | ○ | ✕ | 벤더 클라우드 구독형과 배포구조 상이 |
````
**바꿀 내용**
````text
| 4 | ○ | ✕ | 벤더 클라우드 구독형과 배포구조 상이 **[2026-09-30 No.37 설계 완료 — `docs/02-spec/edge-inference-설계.md` · ADR-0046] 엣지 = 고객사 사내 소형 서버(GPU 없음 또는 4~8GB급 1대)로 해석(사용자 확정) — 대화 경로 임베딩(CPU)·규칙 증강은 이미 사내에서 동작하고, 4GB GPU 양자화 생성은 Ollama "경량 설치 구성"(동작 보장·품질 미보증 · 1회 상한 20건)으로 인정. 신규분 = ml-worker 생성 백엔드 정리(vLLM 추가 — 예문 늘리기 전용 사내 서버)·경량 상한·상태 표시·생성 백엔드 주소 통제·장비 등급표/폐쇄망 모델 반입(`docs/05-ops/자동배포.md` §5.8) · API·위젯·엔진·화면 변경 0. 브라우저/휴대폰 안 추론·다지점 원격관리·대화 경로 LLM은 범위 밖 · 품질·지연 합격은 운영 모델 실측(No.17). GPU 4 유지 — 각주: GPU 없는 설치에서 전 기능 동작(0) · 사내 경량 생성은 4GB급부터(5~6 · 품질 미판정) · 대형 생성모델 운영은 No.17. 구독형 ✕ 유지 — 단 vLLM 백엔드 자체는 배포형태 중립(`docs/requirements/edge-inference.md`)** |
````

---

## C. `docs/02-spec/decisions/ADR-0026-augmentation-provider-three-ports.md`

### C-1. 재검토 트리거(160행) — 인라인 갱신 표시

**찾을 원문**
````text
유니온 확장 1곳 + 구현체 추가로 흡수. 포트는 바뀌지 않는다.
````
**바꿀 내용**
````text
유니온 확장 1곳 + 구현체 추가로 흡수. 포트는 바뀌지 않는다. → ⚠ **2026-09-30 갱신(No.37)**: "사내 vLLM 게이트웨이"는 **API 유니온이 아니라 ml-worker 생성 백엔드(`GENERATION_BACKEND=vllm`)로 흡수**했다 — API 포트·팩토리·`local` Provider·출구 클래스 불변(ADR-0046 §2). 이 트리거는 이제 **ml-worker를 거치지 않는 제공자**(Azure OpenAI 등 클라우드 G2 대체)에만 해당한다. 아래 §갱신(2026-09-30).
````

### C-2. §5 "소형 양자화 모델로 타협하지 않는다"(100행) — 적용 범위 표시

**찾을 원문**
````text
구축형 고객사 납품 전제).
````
**바꿀 내용**
````text
구축형 고객사 납품 전제). ⚠ **2026-09-30(No.37)**: 이 단락은 **운영 G3 후보 선정** 기준이다. 소형 양자화 모델의 Ollama 경로는 별도로 **"경량 설치 구성 — 동작 보장·품질 미보증"** 으로 인정됐다(운영 채택 근거 아님 — 아래 §갱신(2026-09-30) · ADR-0046 §3·§4).
````

### C-3. 끝 — `## 갱신 (2026-09-30 — No.37)` 절 추가

**찾을 원문**
````text
이미 마스킹된 학습 반영 예문)"로 표시한다.
````
**바꿀 내용**
````text
이미 마스킹된 학습 반영 예문)"로 표시한다.

---

## 갱신 (2026-09-30 — No.37: G3 생성 백엔드 3종은 ml-worker 안에서 · 경량 설치 구성 · 위탁 구간 주소 통제)

엣지 추론(No.37, **ADR-0046**). 포트 1 + 구현 3종·팩토리 1곳·모든 실패의 G1 수렴·강제 5단계·출구 게이트는 **불변**이다.

1. **재검토 트리거 "사내 vLLM 게이트웨이 → 유니온 확장"은 API에서 발동하지 않았다.** G3의 서빙 엔진 선택은 ml-worker `GENERATION_BACKEND`(`transformers`·`ollama`·`vllm`)가 하고, API는 여전히 `local` Provider 1개로 `/augment`만 안다(§5 경계의 재확인). `/augment` 요청·응답 계약 불변.
2. **§5 "소형 양자화 모델로 타협하지 않는다"의 범위**: 운영 G3 후보(8B~32B급 · L40S 실측 — No.17)를 고르는 기준으로 좁힌다. Ollama 4B Q4 경로는 **"경량 설치 구성 — 동작 보장·품질 미보증"**(1회 상한 20 — ml-worker `/augment` 안 절삭)으로 인정됐으며 운영 채택 근거가 아니다. §1 표의 G3 "자체 GPU 6~7"은 운영 구성 값이고, 경량 구성은 4GB급이다(카탈로그 No.37 각주).
3. **G3 송신(마스킹 없음)의 전제 "사내"를 ml-worker가 확인한다** — 생성 백엔드 주소는 루프백·사설 대역·명시 허용 목록만(링크로컬 금지 · 리다이렉트 비추적). 데이터 지도 표기(위 갱신 2026-09-26)는 바뀌지 않으며 ml-worker → 생성 백엔드 구간은 운영 문서(`docs/05-ops/자동배포.md` §5.8)에 명시한다.
4. **시간 제한**: API `AUGMENTATION_TIMEOUT_MS`(30초)는 불변. ml-worker 원격 요청 시간 제한 기본 25초로 API보다 먼저 포기한다(§2 표의 "G2/G3 타임아웃(기본 30초)"은 API 쪽 값 그대로).
5. **경량 여부 표시**: ml-worker `/augment/health` 선택 필드(`backend`·`profile`·`targetCap`)로만 보고한다. `GET .../augmentations/capability`와 콘솔은 바뀌지 않는다(PM — API·화면 변경 0). capability에 생성기 구성을 올리는 것은 No.17 운영 채택 때 설계한다.
6. `packages/llm-provider` 승격 트리거(§6) **미발동** — 백엔드가 늘어도 LLM 소비자는 증강 1곳이다.
````

---

## D. `docs/02-spec/decisions/ADR-0024-ml-worker-scope-and-runtime.md`

### D-1. 재검토 트리거(117행) — 인라인 갱신 표시

**찾을 원문**
````text
§갱신 1-② 참조.**
````
**바꿀 내용**
````text
§갱신 1-② 참조.** → **2026-09-30(No.37)**: 생성 프로파일이 외부 서빙 엔진(Ollama·vLLM)에 **위탁**할 수 있게 됐다 — 프로세스 구조(임베딩·생성 분리)와 이 트리거의 판정은 그대로다(음성·비전 미착수). 아래 §갱신(2026-09-30).
````

### D-2. 끝 — `## 갱신 (2026-09-30 — No.37)` 절 추가

**찾을 원문**
````text
ml-worker는 여전히 DB에 접근하지 않는다.
````
**바꿀 내용**
````text
ml-worker는 여전히 DB에 접근하지 않는다.

---

## 갱신 (2026-09-30 — No.37: 생성 프로파일의 외부 서빙 엔진 위탁 · 위탁 구간 주소 통제 · 엣지 해석)

엣지 추론(No.37, **ADR-0046**). §갱신 1의 "모델 파인튜닝 없음"과 §갱신 4 "건드리지 않는 것" 전부(`/embed`·`/health` 계약 · DB 무접근 · Python 없이 API 전 시험 통과 · `packages/llm-provider` 미생성)는 **불변**이다.

1. **§갱신 1 "ML 추론 서비스"의 생성 추론은 프로세스 안 적재만이 아니다** — `GENERATION_BACKEND=transformers`(프로세스 안 · 현행) 외에 `ollama`·`vllm`이면 ml-worker 생성 프로파일이 **외부 서빙 엔진에 HTTP로 위탁**한다. 교체 지점은 `_load_generator()` 1곳이며 알 수 없는 값은 **생성 프로세스만** 기동 실패시킨다(임베딩 프로세스·대화 무영향).
2. **위탁 구간 주소 통제** — ml-worker → 생성 백엔드는 API 출구 게이트 밖이고 시드는 마스킹하지 않으므로, ml-worker가 기동 시 주소를 검사한다(루프백·사설 대역·명시 허용 목록 · 링크로컬 금지 · 리다이렉트 비추적). ml-worker는 여전히 API 설정·DB를 읽지 않는다(같은 형식의 별도 환경변수 `GENERATION_BACKEND_ALLOWED_HOSTS`·`GENERATION_BACKEND_REQUIRE_ALLOWLIST`).
3. **엣지 = 고객사 사내 소형 서버(E1)** — §5 "GPU는 권장이지 필수가 아니다"를 장비 등급표(등급 0 GPU 없음 ~ 등급 3 L40S)로 구체화한다(`docs/05-ops/자동배포.md` §5.8). 경량 구성에서도 **임베딩 CPU + 생성 프로세스 분리**를 권장한다(§갱신 1-② 유지). §5 완화 2단계(ONNX int8)는 여전히 불필요 — 재검토 트리거는 "등급 1~2 장비에서 임베딩 CPU P95가 예산에 근접"이다.
4. **재검토 트리거 "음성·비전 착수 시 내부 구조 재결정"은 이번에도 발동하지 않는다** — 생성 백엔드 추가는 생성 프로파일 안의 구현 선택이다.
````

---

## E. `docs/05-ops/자동배포.md`

### E-1. §5.3 4번 — 생성 백엔드 반입·주소 통제 연결

**찾을 원문**
````text
`HF_HUB_OFFLINE=1`로 기동한다(ml-worker 코드 변경 없음).
````
**바꿀 내용**
````text
`HF_HUB_OFFLINE=1`로 기동한다(ml-worker 코드 변경 없음). **[2026-09-30 No.37]** 생성 백엔드(Ollama·vLLM) 모델 반입 절차·장비 등급표는 **§5.8**. 거버넌스 설치에서 생성 프로파일을 원격 백엔드로 쓰면 ml-worker `.env`에 `GENERATION_BACKEND_REQUIRE_ALLOWLIST=true`와 `GENERATION_BACKEND_ALLOWED_HOSTS`(생성 백엔드 호스트만)를 넣는다 — ml-worker → 생성 백엔드 구간은 API 출구 허용 목록(`DATA_EGRESS_ALLOWED_HOSTS` — 여기에는 ml-worker 주소만)의 대상이 아니고, 이 구간으로 가는 예문 시드는 마스킹되지 않는다.
````

### E-2. §5.8 신설 (§5.7 7번 뒤)

**찾을 원문**
````text
서버 로그에 URL 쿼리·헤더 값이 없는지.
````
**바꿀 내용**
````text
서버 로그에 URL 쿼리·헤더 값이 없는지.

### 5.8 사내 생성 백엔드·장비 등급(No.37 엣지 추론) 운영 요구 (2026-09-30 추가)

`edge-inference-설계.md` · ADR-0046. 구축형 고객 장비에 맞춰 **무엇을 켜고 끄는지**와, 생성 백엔드(Ollama·vLLM)를 쓰는 설치의 **운영 책임**이다. 장비·모델 수치는 **"동작 확인"** 기록이며 **품질·지연 합격 판정이 아니다**(합격은 운영 모델 실측 — No.17).

1. **장비 등급표** — 칸: 동작 확인됨(일자·장비) / 미확인 / 해당 없음 · 품질은 운영 실측 전까지 "미판정".

| 등급 | 장비 예 | 임베딩(대화 경로) | 예문 늘리기 | 생성 백엔드 | 상태 | 품질 |
|---|---|---|---|---|---|---|
| 0 | GPU 없음 | CPU · KURE-v1 · 1문장 P95 126~159ms(개발 PC 실측 — `apps/ml-worker/eval/report/model-comparison.md`) | 규칙 기반(`AUGMENTATION_PROVIDER=rule`) | 없음(생성 프로세스를 띄우지 않음) | 동작 확인됨(현행 기본값) | 해당 없음 |
| 1 | 4GB급 소형 GPU(개발 기준 RTX 3050 Laptop 4GB) | CPU 권장(GPU는 생성에 양보) | 규칙 기반 + 경량 생성(1회 상한 20) | `ollama` · 4B Q4(`qwen3:4b-instruct-2507-q4_K_M`) · 4GB에 다 안 올라가 약 33% CPU 분산 | 동작 확인됨(2026-09-29 · RTX 3050 Laptop 4GB · 20건 ≈13초 · 60건 불가 — `apps/ml-worker/eval/report/ollama-dev-pipeline-validation.md`) · 상한 절삭 적용 후 전 과정: **미확인**(구현 후 `edge-lightweight-operation-check.md`로 갱신) | 미판정 |
| 2 | 8~24GB GPU | CPU 또는 GPU | 규칙 기반 + 생성 | `ollama` 또는 `transformers` | 미확인 | 미판정 |
| 3 | L40S급(운영) | GPU 가능 | 규칙 기반 + 생성 | `vllm`(예문 늘리기 전용 사내 vLLM 서버) | 미확인 — No.17 실측 대기 | 미판정(No.17) |

2. **프로세스 구성**(등급 1 이상 — 생성과 임베딩 분리 권장): 임베딩 = ml-worker `ML_WORKER_ROLE=embed` · `ML_WORKER_PORT=8100` · `EMBEDDING_DEVICE=cpu` / 생성 = 같은 코드의 두 번째 프로세스 `ML_WORKER_ROLE=augment` · `ML_WORKER_PORT=8101` · `GENERATION_BACKEND=ollama|vllm` / API = `EMBEDDING_BASE_URL=http://127.0.0.1:8100` · `AUGMENTATION_PROVIDER=local` · `AUGMENTATION_LOCAL_BASE_URL=http://127.0.0.1:8101`(거버넌스 모드면 두 주소를 `DATA_EGRESS_ALLOWED_HOSTS`에). `ML_WORKER_ROLE=both`나 생성·임베딩을 같은 소형 GPU에 두는 구성은 **대화 응답 예산을 보장하지 않는다.** 생성 프로세스가 백엔드·모델을 찾지 못하면 **생성 프로세스만** 기동 실패한다(임베딩·대화 무영향 · 예문 늘리기는 규칙 기반으로 동작).
3. **경량 설치 구성(Ollama) — 동작 보장·품질 미보증**: Ollama는 **루프백에만 바인딩**(`OLLAMA_HOST=127.0.0.1:11434`)하고 사내망에 열지 않는다. ml-worker `GENERATION_BACKEND=ollama` · `OLLAMA_MODEL=<태그>` · `OLLAMA_TARGET_CAP=20`(API가 60건을 요청해도 20건까지만 생성 — 제안 수는 줄지만 시간 안에 온다) · `OLLAMA_REQUEST_TIMEOUT_S=25`. 고객·영업 자료에 이 구성의 품질 수치를 쓰지 않는다. 상태 확인: 생성 프로세스 `GET /augment/health`의 `profile`이 `lightweight`. 장비가 느려 20건이 25초를 넘으면(로그 "호출 실패 — 빈 후보로 수렴" 반복 · 콘솔 "기본 방식으로 생성") `OLLAMA_TARGET_CAP`을 낮춘다.
4. **운영 구성(vLLM) — 예문 늘리기 전용 사내 vLLM 서버**: **외부 RAG가 쓰는 vLLM을 ml-worker가 직접 부르지 않는다**(외부 RAG 접촉면 봉인 — ADR-0022 · 답변 지연·장애 전파). ml-worker `GENERATION_BACKEND=vllm` · `VLLM_BASE_URL=http://<사내 주소>:<포트>`(끝에 `/v1`을 붙이지 않는다) · `VLLM_MODEL=<vLLM served-model-name>` · (vLLM에 키를 걸었으면) `VLLM_API_KEY`. 어떤 모델을 운영에 켤지는 **No.17 실측·합격 판정**이 정한다 — 그전 기본값(`VLLM_TARGET_CAP=60` · `VLLM_MAX_NEW_TOKENS=2048`)은 출발값이다.
5. **생성 백엔드 주소 통제** — 이 구간(ml-worker → Ollama/vLLM)으로 **마스킹하지 않은 예문 시드**가 간다. 기본은 루프백·사설 대역(`10/8`·`172.16/12`·`192.168/16`·`fc00::/7`)·`localhost`만 허용하고, 이름은 기동 시 해석한 모든 주소가 사설이어야 한다. 다른 주소가 필요하면 `GENERATION_BACKEND_ALLOWED_HOSTS`에 명시한다. 거버넌스 설치는 `GENERATION_BACKEND_REQUIRE_ALLOWLIST=true`(사설·루프백도 목록 필수). 링크로컬(`169.254.0.0/16` 등 — 클라우드 메타데이터)은 목록에 있어도 거부되고 리다이렉트는 따라가지 않는다. 기동 뒤 DNS 변경으로 검사가 우회될 수 있으므로 **IP 주소 또는 hosts 파일 고정**을 권장한다.
6. **폐쇄망 모델 반입**(기동 중 외부 내려받기 0): **HF(임베딩 · `transformers` 생성)** — 인터넷 PC에서 **리비전을 고정**해 내려받고 캐시 디렉터리를 통째로 반입 → `HF_HOME=<반입 경로>` + `HF_HUB_OFFLINE=1`. **Ollama** — 인터넷 PC(대상과 **같은 Ollama 버전**)에서 `ollama pull <태그>` → 모델 저장소(`OLLAMA_MODELS`로 지정한 경로 또는 설치 기본 경로)의 `manifests/`·`blobs/`를 통째로 반입해 같은 구조로 배치 → `ollama list`로 태그 확인 · 매니페스트 digest를 설치 기록에 남긴다. ml-worker는 모델을 **확인만** 하고 내려받지 않는다(없으면 기동 실패 — "`ollama pull`로 받은 뒤 다시 시작"). **vLLM** — 인터넷 PC에서 모델 저장소를 **리비전 고정**으로 내려받아 반입 → vLLM을 로컬 경로 + `--served-model-name <이름>` + `HF_HUB_OFFLINE=1`로 기동 → ml-worker `VLLM_MODEL=<이름>`. ⚠ 기본 저장 경로·기동 인자 이름은 버전마다 다를 수 있다 — 설치하는 버전의 문서로 확인해 설치 기록에 남긴다.
7. **모델 라이선스 기록**(문서에 올린 모델 — 상업 이용을 막는 모델은 올리지 않는다 · **법무 재확인 필요**):

| 모델 | 쓰는 곳 | 라이선스 | 확인 방법·일자 |
|---|---|---|---|
| `nlpai-lab/KURE-v1` | 임베딩(전 등급) | MIT | HF API — `apps/ml-worker/eval/report/model-comparison.md` |
| `qwen3:4b-instruct-2507-q4_K_M` | 등급 1 경량 생성 | Apache-2.0 | `ollama show` 표기 · 2026-09-29(`ollama-dev-pipeline-validation.md`) |
| 운영 vLLM 모델 | 등급 3 | 미정 — No.17 채택 시 기록(Gemma 계열은 자체 이용약관이라 표준 공개 라이선스가 아님에 주의) | — |

8. **시간 제한 조정 규칙**: ml-worker 원격 요청 시간 제한(`OLLAMA_REQUEST_TIMEOUT_S`·`VLLM_REQUEST_TIMEOUT_S`, 기본 25초)은 API `AUGMENTATION_TIMEOUT_MS`(기본 30000)보다 **5초 이상 짧게** 둔다. API 값을 올리면 함께 올린다(30초를 넘기면 ml-worker 기동 경고). 이전 `.env.example`을 복사한 설치는 `OLLAMA_REQUEST_TIMEOUT_S=90`이 남아 있으니 25로 고친다.
9. **설치 점검**(생성 백엔드를 켠 설치): ① 생성 프로세스 `GET /augment/health` — `status=ok` · `backend`가 의도한 값 · `transformers`면 `modelId`가 `mock-generator@0`이 아님 · 원격이면 `device=external` · `targetCap` 확인 ② 생성 백엔드 주소가 같은 서버 또는 사내 대역(거버넌스 설치는 허용 목록 필수 스위치 켬) ③ `VLLM_BASE_URL`이 외부 RAG의 vLLM이 아님 ④ 모델 라이선스 기록 존재(7번) ⑤ 생성·임베딩 프로세스 분리 · 등급 1은 임베딩 CPU ⑥ 폐쇄망: 네트워크 차단 상태에서 Ollama·vLLM·ml-worker가 모두 기동됨(내려받기 시도 0) ⑦ 로그에 `VLLM_API_KEY` 값이 없음.
10. **업그레이드 시 동작 변화**(이 그룹 반영 전 설치): Ollama 요청 시간 제한 90 → 25초 · 공인 주소 Ollama는 기동 실패(허용 목록 필요) · 알 수 없는 `GENERATION_BACKEND` 값은 생성 프로세스 기동 실패 · Ollama 경로 1회 생성 60 → 20건 · Ollama 최대 토큰 512 → 768(`GENERATION_MAX_NEW_TOKENS`를 명시하지 않았을 때). DB 마이그레이션 없음.
````

---

## F. (선택) `docs/requirements/edge-inference.md` — PM 결정 기록

> 요구사항 원본에 PM 확정을 남길지는 오케스트레이터 판단이다(선행 그룹은 요구사항 머리에 "범위·방식 확정" 표기를 남겼다). 이 파일은 미커밋 상태일 수 있으니 줄바꿈을 확인해 적용한다.

### F-1. 머리 — PM 확정 표기

**찾을 원문**
````text
> **작성일**: 2026-09-30 · **다음 단계**:
````
**바꿀 내용**
````text
> **[PM 확정(2026-09-30)]** P-1 (a) 엣지 = 고객사 사내 소형 서버(E1 — 브라우저·휴대폰·다지점 제외) · P-2 (A) ml-worker vLLM 백엔드 + 경량 구성 정리 + 상한·표시·주소 통제 + 장비 등급표/설치 문서(**API·위젯·엔진·화면 변경 0**) · P-3 (a) Ollama = 경량 설치 구성(동작 보장·품질 미보증) · 1회 상한 20건(초과는 상한까지만 생성) · P-4~P-11 권고안. **설계**: `docs/02-spec/edge-inference-설계.md` · ADR-0046. ⚠ PM의 "화면 변경 0"에 따라 FR-ED6-2·AC-ED3-2(콘솔 "품질 미보증" 문구)는 이번에 구현하지 않는다(설계서 R-1 — No.17 운영 채택 때).
> **작성일**: 2026-09-30 · **다음 단계**:
````
