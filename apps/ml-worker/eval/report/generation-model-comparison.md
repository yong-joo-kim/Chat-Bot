# G3 로컬 생성모델 후보 3종 비교 — 5지표 실측 (ADR-0026 §5, learning-augmentation-설계.md §21.1)

> PM 확정사항 G3: "데이터센터급 GPU(VRAM 24GB 이상)를 확보했다 — 소형 양자화 모델로 타협하지 말 것."
> 이 문서는 그 전제 위에서 후보 3종(한국어 특화 8B급 / 다국어 14B급 / 32B 양자화급)을 선정하고,
> 실측 가능한 부분과 **실측하지 못한 부분을 명확히 구분**한다.

## ⚠ 이 실측의 한계 (반드시 먼저 읽을 것)

이 작업을 수행한 개발 샌드박스는 다음 하드웨어를 갖고 있다.

```
$ nvidia-smi
NVIDIA GeForce RTX 3050 ...   Memory-Usage: 0MiB / 4096MiB   (VRAM 4GB)
```

PM이 확보했다는 **VRAM 24GB 이상 데이터센터급 GPU가 아니다.** 8B~32B 파라미터 생성모델을
fp16/bf16으로 로드하려면 각각 최소 ~16GB(8B) / ~28GB(14B) / ~64GB(32B, 4bit 양자화 시 ~20GB)의
VRAM이 필요하며, 이 샌드박스의 4GB GPU로는 로드조차 되지 않는다. CPU 폴백으로 억지로 실행하는
것도 배치 생성 1회에 수 분~수십 분이 걸려 "관리자 대기 UX가 성립하는지"(④ 지연 지표)를 왜곡한다.

**따라서 이 문서는:**

1. `eval/generation_candidates.py` 하네스를 **`--model mock`으로 실행해 파이프라인 정합성을
   실제로 검증**했다(생성 → KURE-v1 임베딩 → 의미보존/신규성/충돌 3지표 계산 → 보고서 작성까지
   end-to-end로 동작 확인, 결과는 `eval/report/generation/mock-generator@0.md`).
2. 후보 3종의 **①~④(품질·지연) 정량 수치는 이 샌드박스에서 만들어내지 않았다** — 만들어도 실제
   운영 GPU에서의 값을 대표하지 못해 근거로 쓸 수 없다고 판단했다(수치를 지어내는 것보다 정직하게
   "미실측"으로 남기는 것이 이 프로젝트의 다른 실측 보고서들과의 신뢰도 일관성에 부합한다).
3. ⑤(라이선스·VRAM 이론치)는 Hugging Face API로 **실제로 조회**했다(아래 표).
4. **후보 선정과 하네스는 완성**되어 있으므로, 24GB+ GPU를 확보한 환경에서
   `python eval/generation_candidates.py --model <후보> --device cuda`를 그대로 실행하면
   ①~④가 채워진 최종 비교표가 나온다. **이 실행이 G3 착수 전 마지막 게이트**다(ADR-0026 §5가
   요구하는 "실측으로 확정").

## 후보 3종 (라이선스 필터 통과 — HF API 실측)

| 구분 | 모델 | 파라미터(safetensors 실측) | 라이선스(HF API `cardData.license`) | 컨텍스트 | 비고 |
|---|---|---|---|---|---|
| 한국어 특화 8B급 | `MLP-KTLim/llama-3-Korean-Bllossom-8B` | 8,030,261,248 (~8.03B) | `llama3`(Llama 3 Community License) | 8K | Llama-3-8B를 한국어 코퍼스로 지속사전학습+SFT. 한국어 지시-응답 품질이 베이스 Llama3 대비 우수하다고 보고됨(모델 카드 자체 평가) |
| 다국어 14B급 | `Qwen/Qwen2.5-14B-Instruct` | 14,770,033,664 (~14.77B) | **`apache-2.0`** | 128K | 다국어(한국어 포함) instruct 모델. 완전 permissive 라이선스 |
| 32B 양자화급 | `Qwen/Qwen2.5-32B-Instruct-AWQ` | 32,763,876,352 (~32.76B, AWQ 4bit) | **`apache-2.0`** | 128K | AWQ 4bit 양자화 공식 배포본 — fp16 32B(~64GB)와 달리 **~20GB VRAM에 적재 가능**해 24GB 카드 1장 전제와 맞아떨어진다 |

**라이선스 판단**: PM 지침 "상업 이용을 막는 라이선스는 후보에서 제외"를 적용했다.

- Qwen2.5 두 후보는 **Apache-2.0**으로 제한이 없다.
- Bllossom-8B는 **Llama 3 Community License**다 — 상업적 이용 자체는 **허용**되며, 유일한 제약은
  "서비스 월간 활성 사용자(MAU) 7억 명 초과 시 Meta의 별도 라이선스가 필요하다"는 조항이다. 이
  프로젝트(B2B 챗봇 SaaS/구축형)의 예상 규모로는 해당하지 않으므로 **제외 대상이 아니라고 판단**한다
  (다만 계약서·법무 검토 시 이 조항의 존재 자체는 고지할 필요가 있다 — 완전한 permissive 라이선스인
  Qwen 계열과는 성격이 다르다는 점을 기록해 둔다).
- 후보에서 **제외한 모델**: `EXAONE`(LG AI) 계열 — 라이선스가 "연구 목적"으로 상업적 이용을 제한해
  1차 스크리닝에서 제외했다(HF API로 재확인 권장).

## 5지표 정의와 측정 방법(하네스 = `eval/generation_candidates.py`)

| 지표 | 정의 | 측정 방법 | 이번 실측 상태 |
|---|---|---|---|
| ① 의미 보존 통과율 | 생성 후보 중 `0.75 ≤ cos(후보,시드) ≤ 0.97`(KURE-v1) 비율 | 콜드스타트 시나리오 3종(예문 1~2건 의도) × 후보 20건 생성 → KURE-v1로 코사인 계산 | **하네스 검증 완료(mock)**. 실모델 수치는 미실측 — 24GB+ GPU 필요 |
| ② 신규성 통과율 | `max cos(후보,기존예문) < 0.95` 비율 | 위와 동일 배치 재사용 | 〃 |
| ③ 타 의도 충돌률 | `max cos(후보,타의도예문) ≥ 0.90`(acceptThreshold) 비율 | 케이스별로 인접 의도 예문 세트를 함께 정의해 계산 | 〃 |
| ④ 생성 지연 P95 | 시드 5건 → 후보 20건 배치 1회, n=3 | `measure_latency()` | 〃(mock은 즉시 반환이라 의미 없는 0ms) |
| ⑤ VRAM·라이선스 | 이론적 VRAM 점유(파라미터×정밀도) · 상업적 이용 가능 여부 | HF API 조회 + 공개 스펙 | **실측 완료**(위 표) |

## 예비 판단(잠정 — 실측 후 재확인 필요)

정량 수치가 없는 상태에서 최종 채택을 확정하는 것은 이 프로젝트의 다른 모델 선정(KURE-v1 임베딩,
형태소 분석기)이 지켜온 "실측 우선" 원칙에 어긋난다. 다만 backend-implementer/ml-engineer가 실측을
착수할 때 시작점이 필요하므로, 공개된 정보만으로 다음을 **잠정** 권고한다.

- **1차 실측 대상은 `Qwen/Qwen2.5-32B-Instruct-AWQ`를 최우선으로 한다.** 근거: (a) Apache-2.0으로
  라이선스 리스크가 0이다 (b) 24GB 카드 1장에 적재 가능한 유일한 32B급 후보라 "GPU를 확보했다"는
  PM 전제를 가장 잘 활용한다 (c) Qwen2.5 계열은 한국어를 포함한 다국어 instruction-following 벤치마크
  공개 결과가 Qwen 자체 테크리포트에 다수 존재해 예측 가능성이 높다.
- **두 번째로 `MLP-KTLim/llama-3-Korean-Bllossom-8B`를 실측한다.** 지연(④)이 가장 낮을 후보이며,
  ④가 "관리자 대기 UX 성립"의 하한선(요구사항 §21.1)을 가르는 경우 이 8B 후보가 실용적 대안이 된다.
- **`Qwen/Qwen2.5-14B-Instruct`는 두 극단(8B 지연 최소 / 32B 품질 최대)의 중간 지점 확인용**으로
  실측한다 — ①~③이 32B와 큰 차이가 없다면 VRAM·지연 이점 때문에 14B가 운영 기본값이 될 수 있다.

## backend-implementer/ml-engineer(실 GPU 보유자) 인계 — 다음 실행 1줄

```bash
cd apps/ml-worker
python eval/generation_candidates.py --model Qwen/Qwen2.5-32B-Instruct-AWQ --device cuda
python eval/generation_candidates.py --model Qwen/Qwen2.5-14B-Instruct --device cuda
python eval/generation_candidates.py --model MLP-KTLim/llama-3-Korean-Bllossom-8B --device cuda
```

세 보고서(`eval/report/generation/*.md`)가 모두 나온 뒤 이 문서의 "예비 판단"을 실측 판단으로
교체하고, 확정된 `modelId`를 `GENERATION_MODEL_ID`(`apps/ml-worker/.env`)와
`AUGMENTATION_LOCAL_BASE_URL` 구성 문서에 반영할 것.
