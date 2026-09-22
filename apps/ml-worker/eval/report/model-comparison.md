# 임베딩 모델 후보 3종 비교 — 5지표 실측 (ADR-0024 §4, 설계서 §8.1)

> PM 확정사항 P-1: "1단계 임베딩은 자체 구축하며 **최고 성능**을 목표로 한다." 이 문서는 그 판단의 근거다.
> 실측 환경: Windows, Python 3.10, PyTorch 2.14 CPU-only, `sentence-transformers`. GPU 미사용(순수 CPU 실측).
> 골든셋: `eval/goldenset/{corpus,cases}.json` 100문항(MATCH 60 / CLARIFY 20 / NOMATCH 20).
> 원본 데이터: `eval/report/{모델슬러그}.json`(전체 임계값 그리드), `.md`(모델별 상세 보고서).

## 후보

| 순위 | 모델 | 차원 | 파라미터 규모 | 라이선스(HF API 확인) | 파일 크기(로컬 실측) |
|---|---|---|---|---|---|
| 1순위 | `nlpai-lab/KURE-v1` (BGE-M3를 한국어 검색용으로 파인튜닝) | 1024 | ~568M | **MIT** | 2,271,064,456 bytes (~2.27GB, safetensors) |
| 2순위 | `BAAI/bge-m3` (범용 다국어, 1순위의 파인튜닝 베이스) | 1024 | ~568M | **MIT** | 2,271,145,830 bytes (~2.27GB, pytorch_model.bin) |
| 3순위 | `intfloat/multilingual-e5-small` (경량 다국어, `query:`/`passage:` 프리픽스 필요) | 384 | ~118M | **MIT** | 470,641,600 bytes (~0.47GB, safetensors) |

## 5지표 실측 결과

| 지표 | KURE-v1 | bge-m3 | e5-small |
|---|---|---|---|
| ① 골든셋 기반 실질 처리율(`match_handled_rate` — 확정+되묻기 회수) | **0.983** | 0.983 | 0.883 |
| ① 즉시 확정율(`match_recall`, 참고) | 0.233 | 0.200 | 0.033 |
| ② 오탐률 — `nomatch_recall`(미매칭 정상 이관, 높을수록 좋음) | **0.90** | 0.10 | 0.00 |
| ② 오탐률 — `wrong_confirm_rate`(확신에 찬 오답, 낮을수록 좋음) | 0.017 | 0.017 | **0.00** |
| ② 오탐률 — `false_accept_rate`(되묻기·미매칭 대상의 오확정, 낮을수록 좋음) | 0.025 | 0.00 | **0.00** |
| ③ CPU 1문장 인코딩 P95(ms, 예산 300ms) | 126~159† | 236 | **61** |
| ④ 5,000건 재색인 추정(초) | 183~192† | 210 | **35** |
| ⑤ 라이선스 | MIT | MIT | MIT |
| ⑤ 파일 크기 | 2.27GB | 2.27GB | 0.47GB |

† KURE-v1 P95는 bge-m3와 동시 실행된 실측 회차에서 CPU 경합으로 159ms까지 올랐고, 단독 실행 시 126ms였다.
어느 쪽이든 300ms 예산 안이다.

## 판단

**1순위(KURE-v1)를 채택한다.**

- **② 오탐 억제력이 결정적 차이다.** `nomatch_recall`(도메인 밖 질문을 올바르게 2단계로 넘기는 비율)이
  KURE-v1 0.90인 반면 bge-m3는 0.10, e5-small은 0.00이다. 즉 한국어 특화 파인튜닝이 없으면
  "사장님 생일이 언제예요?" 같은 무관한 질문에도 코사인 유사도가 높게 나와 **엉뚱한 FAQ가 확정되거나
  불필요한 되묻기가 남발**된다. 이는 골든셋 설계 의도(§ AC-N1-12) 그대로 드러난 결과다.
- **① 실질 처리율은 KURE-v1과 bge-m3가 동률(0.983)**이지만, 위 오탐 지표 차이 때문에 동률로 볼 수 없다 —
  bge-m3는 그 처리율을 "일단 되묻는다"로 채워서 얻은 반면 KURE-v1은 미매칭 구분 능력이 같이 좋다.
- **e5-small은 CPU 지연(61ms)·재색인 처리량(35초/5,000건)이 압도적으로 유리하지만, 매칭 품질
  자체가 세 지표(처리율·오탐률 둘 다) 모두 가장 낮다.** "최고 성능"이 P-1 목표이므로 이 트레이드오프는
  이번 1차 채택에서는 받아들이지 않는다. 다만 §8.1의 CPU 지연 완화 4단계 중 마지막 수단
  ("경량 모델로 교체")의 실측 대안으로 남겨 둔다 — KURE-v1의 운영 중 CPU 지연이 실제로 예산을
  초과하는 사태가 오면 이 모델로 전환할 수 있다는 근거가 이번 실측이다.
- **CPU만으로 예산을 지킨다.** KURE-v1의 P95(126~159ms)는 `EMBEDDING_TIMEOUT_MS=300`의 절반 이하다.
  §8.1의 완화 단계 중 "1. 워밍업 + max_seq_length 절단"만으로 충분했고, ONNX 양자화·GPU 할당은
  **1차 배포에서는 불필요하다**(§5의 재검토 트리거만 유지: 운영 중 P95가 예산에 근접하면 적용).

## 확정 사항 (backend-implementer 인계)

```
modelId (DD-69 규약)  = nlpai-lab/KURE-v1@main|noprefix|l2
dimension             = 1024
prefix_rule           = noprefix (KURE-v1은 비대칭 프리픽스가 필요 없다)
norm_rule             = l2
EMBEDDING_DEVICE 기본값 = cpu (실측상 GPU 불필요. §5 재검토 트리거만 유지)
```

`shared-types/answering.ts`의 `modelId → 기본 임계값` 매핑(FR-N1-26)에 아래를 등록할 것:

```
"nlpai-lab/KURE-v1@main|noprefix|l2": { accept: 0.90, low: 0.60, margin: 0.05 }
```

근거는 `threshold-recommendation.md` 참고(그리드 원본: `nlpai-lab_KURE-v1@main__noprefix__l2.json`).
