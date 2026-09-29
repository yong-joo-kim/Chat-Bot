# Ollama 백엔드 파이프라인 검증 (dev-pipeline-validation) — 2026-09-29

> **이 문서가 아닌 것**: 이 문서는 **G3 후보 3종(한국어 특화 `MLP-KTLim/llama-3-Korean-Bllossom-8B` ·
> 다국어 `Qwen/Qwen2.5-14B-Instruct` · 32B 양자화 `Qwen/Qwen2.5-32B-Instruct-AWQ`)의 L40S 실측을
> 대체하지 않는다.** 그 실측은 여전히 미실행이며 `eval/report/generation-model-comparison.md`가
> 정의한 대로 **L40S급 운영 GPU에서만** 수행할 수 있다(그 문서의 결론은 이 문서로 바뀌지 않는다).
>
> 이 문서는 **완전히 다른 체급의 모델**(Ollama `qwen3:4b-instruct-2507-q4_K_M`, 4비트 양자화,
> 2.5GB — 이하 "검증용 소형 모델")로 **"요청 → 생성 → 검증 → 제안" 파이프라인이 실제로 끝까지
> 도는지"만" 확인**한 기록이다(`docs/requirements/nlg-bot-to-bot.md` FR-NG2, P-3 (a)). 이 모델의
> 출력 품질이 좋게 나와도 8B~32B급 후보의 채택 여부를 판단하는 근거로 쓰지 않는다(FR-0-260).

## 0. 왜 필요했나

`GENERATION_BACKEND` 환경변수로 G3 슬롯에 **두 번째 백엔드**(Ollama HTTP API)를 추가했다(기존
`transformers`/`HFCausalLMGenerator` 경로는 한 줄도 바꾸지 않았다 — §4). 이 문서는 그 배선이
실제로 동작하는지, 그리고 No.17 요구사항 문서(§1.4)가 미리 짚어 둔 위험(60건 배치·30초 시간
제한·mock 조용한 대체·JSON 안정성)이 실제로 발생하는지를 **지어내지 않고 실측**했다.

## 1. 실행 환경 (실측 정직성 — FR-0-260)

| 항목 | 값 |
|---|---|
| 일자 | 2026-09-29 |
| 호스트 | Windows-11-10.0.26200-SP0 |
| GPU | NVIDIA GeForce RTX 3050 Laptop GPU, VRAM 4096MiB, driver 576.88 |
| Ollama | 0.34.4 (`http://localhost:11434`, 사전 구동 상태) |
| 검증용 소형 모델 | `qwen3:4b-instruct-2507-q4_K_M` (`ollama show`: architecture=qwen3, parameters=4.0B, quantization=Q4_K_M, 로컬 사이즈 2.5GB, 라이선스 Apache-2.0) |
| `ollama ps` 관찰 | 로드 중 `33%/67% CPU/GPU` 분산 — **4GB VRAM에 이 4B 모델도 전부는 못 올라가 일부는 CPU로 오프로드**된다(VRAM 사용량 관찰 2.3GB/4.0GB) |
| 임베딩(검증용) | `nlpai-lab/KURE-v1`, `device=cpu` (기존 검증 파이프라인 그대로 재현 — `eval/generation_candidates.py`) |
| 실행 명령 | `python eval/generation_candidates.py --model qwen3:4b-instruct-2507-q4_K_M --backend ollama --device cpu --embedding-device cpu --target-count <20|60> --max-new-tokens <768|900|512>` |
| 산출물 | `eval/report/generation/ollama_dev-pipeline-validation_target20_tokens768.{json,md}` · `..._target60_tokens900.{json,md}` · `..._target60_tokens512.{json,md}` (조건별 보존 사본) + 같은 디렉터리의 `ollama_dev-pipeline-validation_qwen3-4b-instruct-2507-q4_K_M@main.{json,md}`(마지막 실행 = target20/tokens768 재실행분) |

## 2. 결과 요약 — 세 조건 실측

기존 3지표(①의미보존 ②신규성 ③충돌률)는 실제 KURE-v1 임베딩으로, ④지연은 실제 벽시계 시간으로
쟀다(mock 임베더·mock 생성기 아님). 케이스는 하네스의 기존 콜드스타트 3건(`refund-policy` ·
`delivery-eta` · `agent-connect`)을 그대로 썼다(§ eval/generation_candidates.py `CASES`).

| 조건 | targetCount | GENERATION_MAX_NEW_TOKENS(=num_predict) | ①의미보존 | ②신규성 | ③충돌률 | ④지연 p95 | 잘림(`done_reason=length`) 발생 |
|---|---|---|---|---|---|---|---|
| **A. 표준(하네스 기본)** | 20 | 768 | 0.9483 | 0.9655 | 0.0 | **12,994.8 ms**(≈13.0초) | 0/3 케이스 |
| **B. 운영 조건(C-2) + 토큰 여유** | **60**(`MAX_RAW_TARGET`) | 900(튜닝값) | 0.9722 | 1.0 | 0.0 | **52,966.5 ms**(≈53.0초) | 2/3 케이스 |
| **C. 운영 조건(C-2) + 기본 토큰(config.py 기본값 그대로)** | **60** | **512**(코드 기본값) | **0.3333**(붕괴) | 1.0 | 0.0 | **28,366.0 ms**(≈28.4초) | **3/3 케이스** |

(원본 수치·전체 실행 로그는 위 `.json`/`.md` 사본에 있다 — 재현 가능성 확보.)

### 조건 A — 재현성 확인(2회 실행)

같은 조건(target=20, tokens=768)을 두 번 실행했다(온도 0.9 샘플링이라 완전히 같은 수치는
아니지만 같은 차수임을 확인):

| 실행 | ①의미보존 | ②신규성 | ④p95 |
|---|---|---|---|
| 1회차 | 0.8966 | 0.9138 | 12,434.3 ms |
| 2회차(보존본) | 0.9483 | 0.9655 | 12,994.8 ms |

두 실행 모두 "60건 미만 배치·기본 토큰 근접값"에서는 파이프라인이 실제로 정상 동작하고,
KURE-v1 검증을 대부분 통과하는 후보가 나온다는 점은 일관됐다.

## 3. No.17 §1.4 위험별 실측 답 (지어내지 않음)

| 위험 | No.17 문서 근거 | 실측 답 |
|---|---|---|
| **C-2 — 운영 호출은 60건, 하네스 기본은 20건** | "실측이 운영 조건보다 가볍다 → 60건으로도 재야 한다" | **재현됨.** 20건(조건A)은 문제없이 완주하지만, 60건(조건 B·C)에서 지연이 급격히 늘고(조건B p95 53초) 토큰 부족 시 품질이 붕괴한다(조건C ①=0.33). "가볍게 통과했다고 운영에서도 통과한다"는 가정은 이 소형 모델에서 **거짓**이었다 |
| **C-3 — 최대 토큰 512 기본값이 60건 JSON 배열에 충분한가** | "잘리면 JSON 해석이 실패해 줄 단위 폴백으로 넘어간다" | **불충분함을 실측으로 확인.** 512(코드 기본값)로는 3/3 케이스 모두 `done_reason=length`로 잘렸다. 900으로 올려도 2/3 케이스가 여전히 잘렸다(이 모델·이 프롬프트 조합에서 60건 한국어 문장 JSON 배열은 900토큰도 종종 부족했다) |
| **C-4 — API 쪽 `AUGMENTATION_TIMEOUT_MS` 기본 30초, 넘으면 G1 폴백** | "이 시간 제한과 맞물려야 한다" | **실측상 경계선.** 조건B(토큰 넉넉, 900)는 p95 53초로 **30초를 확실히 초과** → 실제 API 연동 시 G1로 폴백됐을 것이다. 조건C(토큰 부족, 512)는 p95 28.4초로 **30초 안에는 들어오지만 결과가 거의 쓸모없다**(①=0.33, 그마저 1개만 생성돼 실질 수율 참혹). 즉 이 소형 모델은 "시간 안에 오되 텅 빈 결과" 아니면 "쓸 만하되 시간 초과" 중 하나였고, **둘 다 만족하는 조합을 이 실측에서는 찾지 못했다** |
| **결과가 JSON 배열로 안정적으로 나오는가 · 줄 단위 폴백이 실제로 동작하는가** | `parse_candidate_array` 폴백 | **JSON은 잘리지 않으면 안정적으로 나온다**(조건 A: 3/3 케이스 정상 JSON). **잘리면 "줄 단위 폴백"은 사실상 작동하지 않는다** — 모델 출력이 개행 없는 한 줄짜리 JSON 배열이라, 파싱 실패 시 폴백 로직(`\n` 분리)이 적용할 개행이 없어 **잘린 전체 문자열 통째로가 "후보 1개"가 된다**(정상적인 부분 문장 목록 복구가 아니다). 실측 재현: `generated=1`인 케이스들이 전부 이 경로였다(§ 4 코드 확인 참고) |
| **기존 검증 파이프라인(의미보존 0.75~0.97·신규성 <0.95·교차 의도 충돌·금지어) 통과 실측** | 몇 개가 살아남는가 | 조건 A(정상 동작 시)는 **의미보존 ~0.90~0.95, 신규성 ~0.91~0.97, 충돌 0%**로 실제로 상당수가 살아남았다. 조건 C의 "생성=1건" 케이스 중 1곳(`delivery-eta`)은 **잘린 가비지 문자열이 우연히 의미보존 임계값(0.75~0.97) 안에 들어 통과 판정**을 받았다 — 이는 검증 파이프라인이 "잘려서 의미 없는 출력"을 100% 걸러내지는 못할 수 있다는 부작용 사례로 기록해 둔다(표본 1건이라 일반화는 안 됨) |
| **mock 조용한 대체 방지(C-8/R-5)** | "GENERATION_MODEL_ID 미설정이면 mock이 조용히 뜬다" | `GENERATION_BACKEND=ollama`로 켜면 `GENERATION_MODEL_ID`(레거시 mock 스위치) 값과 무관하게 Ollama 백엔드가 선택되고, 부팅 시 `/api/tags`로 서버 연결과 모델 존재를 확인한다. **서버가 없거나 모델이 없으면 `RuntimeError`로 기동 자체가 실패**한다(닫힌 포트로 실제 재현 — `tests/test_ollama_backend_app.py`). mock으로 조용히 넘어가는 경로는 없다 |

## 4. 줄 단위 폴백이 실제로 어떻게 동작하는지 (코드 추적 + 재현)

`ml_worker.generator.parse_candidate_array`는 JSON 파싱 실패 시 `text.split("\n")`로 줄을
나눠 각 줄의 선행 기호(`-*\d.)\s`)만 벗겨 낸다. Ollama의 `/api/generate` 응답(`stream: false`)은
**개행 없는 한 줄짜리 문자열**이므로, JSON이 중간에 잘리면 "줄"이 1개(전체)뿐이라 폴백이 사실상
무의미해진다. 실제 잘린 응답으로 재현한 결과:

```
n = 1
first(190자) = '["환불 규정 좀 알려주세요", "환불을 원하면 어떤 절차를... (잘린 JSON 전체가 후보 1개)'
```

이 동작 자체는 **버그가 아니라 알려진 한계**로 기록한다 — `parse_candidate_array`는 애초에
"모델이 줄바꿈으로 목록을 줄 수도 있다"는 경우(예: `- 문장1\n- 문장2`)를 위한 폴백이지, "JSON이
한 줄로 잘렸을 때 부분 문장을 복구"하기 위한 것이 아니다. 이 소형 모델·이 프롬프트에서는 두 실패
모드(JSON 완전 실패 + 줄 폴백 무의미)가 같이 나타났다는 점을 있는 그대로 남긴다.

## 5. `/augment`·`/augment/health` 계약 — 바이트 단위 불변 확인

- `AugmentRequest`/`AugmentResponse`/`AugmentHealthResponse`(Pydantic 모델, `app.py`)는 **수정하지
  않았다.** Ollama 백엔드는 `_load_generator()`의 새 분기 하나로 배선되고, 반환 타입은 여전히
  `Generator`(`model_id: str`, `generate()`, `healthy()`)다.
- `modelId` 문자열만 백엔드에 따라 달라진다(`ollama:qwen3:4b-instruct-2507-q4_K_M` 형태) — 이는
  기존에도 모델 교체 시 항상 달라지던 필드이므로 계약 위반이 아니다.
- `apps/api`(`local-augmentation.provider.ts`)는 이 문서의 변경을 전혀 알 필요가 없다 — HTTP
  계약이 그대로이므로 **손대지 않았다**.

## 6. 실행한 회귀·신규 시험

```
cd apps/ml-worker && ./.venv/Scripts/python -m pytest -q
# 27 passed (기존 16 + 신규 11), 0 failed, 2 warnings(기존에도 있던 deprecation 경고, 무관)
```

신규 11건(`tests/test_ollama_generator.py` 9건 + `tests/test_ollama_backend_app.py` 2건)은 전부
`httpx.MockTransport` 또는 "즉시 닫는 로컬 포트"로 **실제 네트워크·실제 Ollama 서버 없이** 도는
CI 안전 시험이다(FR-0-258). 검증 항목:

- 백엔드 선택 분기(`GENERATION_BACKEND` 기본값 `transformers` → 기존 mock 경로 바이트 단위 무변화)
- Ollama 어댑터 정상 경로(연결·모델 확인·생성·JSON 파싱)
- 모델 미존재·서버 다운 시 **`RuntimeError`로 명확히 실패**(mock 조용한 대체 없음) — 태그 없는
  모델명 매칭(`:latest` 처리)까지 포함
- `generate()` 자체는 Generator 계약대로 실패 시 예외를 던지지 않고 빈 배열로 수렴(HTTP 오류·
  타임아웃 각각 재현)
- 토큰 잘림(`done_reason=length`) 시 예외 없이 폴백 처리(§4의 "가비지 1건" 결과도 예외 없이 반환)
- 앱 레벨: `GENERATION_BACKEND=ollama` + 서버 불통 시 **FastAPI 기동(lifespan startup) 자체가
  실패**함을 닫힌 로컬 포트로 결정론적으로 재현

## 7. 이 결과가 바꾸는 것 / 바꾸지 않는 것

**바꾸지 않는 것(의도적으로)**:
- G3 후보 3종(8B~32B급)의 **L40S 실측 필요성** — 전혀 바뀌지 않는다. 이 검증은 체급이 다른
  모델(4B, 4bit)로 "배선이 도는지"만 봤다. 8B~32B 모델은 지연·품질 특성이 근본적으로 다르며,
  이 문서의 수치를 그 모델들의 대리값으로 쓸 수 없다.
- `eval/report/generation-model-comparison.md`의 "예비 판단"(잠정, L40S 실측 후 교체 예정) —
  이 문서는 그 문서를 갱신하지 않았고 갱신 대상도 아니다.
- `/augment` 계약, `AugmentationProvider` 포트(`apps/api`), 대화 경로 — 전부 무변경.

**확인해 준 것(신규 사실)**:
- G3 슬롯에 HTTP 기반 백엔드를 추가하는 **배선 방식 자체는 동작한다**(포트 재사용, 계약 불변,
  회귀 없음).
- No.17 문서가 "확인 필요"로 남겨 둔 위험(C-2·C-3·C-4·JSON 안정성)은 **추상적 우려가 아니라
  실제로 재현되는 실패 모드**임을 이 소형 모델로 확인했다. 8B~32B 모델은 파라미터가 더 크지만
  auto-regressive 생성이라는 근본 메커니즘은 같으므로, "60건 배치·JSON 배열 출력·토큰 예산"이라는
  **구조적 위험 자체는 L40S 실측에서도 반드시 같은 방식으로 확인해야 한다**(단, 그 모델들의 실제
  수치는 이 문서가 아니라 L40S 실측이 답해야 한다).

## 8. 다음에 L40S 접근자가 재사용할 수 있는 것

1. **하네스 확장분 그대로 재사용 가능** — `eval/generation_candidates.py`의 `--backend`/
   `--ollama-base-url` 인자와 조건별(20건/60건, 토큰 예산 가변) 실행 패턴은 실제 G3 후보
   3종(`--backend transformers`, 기존 그대로)에도 **그대로 적용된다**. 특히 "표준 조건(20건) +
   운영 조건(60건, 토큰 예산 조정)을 나란히 실행해 비교"하는 이 문서의 형식은 그대로 재사용해
   달라고 요청한다(FR-NG1-2가 요구하는 "두 조건" 구조와 일치).
2. **토큰 예산 튜닝이 필요하다는 사실 자체**를 미리 알고 시작할 수 있다 — L40S 실측 시 처음부터
   `--max-new-tokens`를 넉넉히(예: 1500~2000) 잡고 시작해 조건 C 같은 "조용한 품질 붕괴"를 피할
   것을 권고한다.
3. **`OllamaGenerator`/`GENERATION_BACKEND` 자체는 L40S 실측과 무관** — 실제 후보 3종은 여전히
   `transformers`/`HFCausalLMGenerator` 경로(GPU 24GB+ 전제)로 실측한다. 이번 작업은 그 경로를
   전혀 건드리지 않았다.
4. VRAM 동거 실측(FR-NG1-4, 임베딩+생성 동시 적재)은 **이 문서에서 다루지 않았다** — 개발 환경의
   임베딩이 `cpu` 디바이스로 고정돼 있어 GPU 동거 상황 자체가 재현되지 않는다. L40S에서는 반드시
   별도로 측정해야 한다.

## 9. 알려진 한계

- 케이스가 기존 3건(콜드스타트 시나리오)뿐이다 — No.17 §1.4 C-7이 이미 지적한 한계이며 이
  문서에서도 그대로다.
- 임베딩 검증은 `device=cpu`로 실행했다(GPU 임베딩과 미세한 수치 차이 가능성 — 결정론적
  정규화라 방향은 같을 것으로 예상하나 별도 확인은 안 함).
- 온도(temperature)=0.9 샘플링이라 조건 A를 반복 실행한 두 결과가 완전히 같지는 않다(§2 참고,
  같은 차수임은 확인).
- 검증용 소형 모델이 실제로는 GPU/CPU에 분산 적재됐다(`33%/67%`, VRAM 4GB 한계) — 완전한
  GPU 상주 상태의 지연과는 다를 수 있다. 이 역시 "다른 체급"이라는 결론을 강화할 뿐, L40S 실측을
  대체할 근거가 되지 않는다.
