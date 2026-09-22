# 생성모델 실측 보고서 — mock-generator@0

- device: cuda
- 케이스: refund-policy, delivery-eta, agent-connect (시드 빈약 의도 콜드스타트 시나리오)

## 집계 3지표(①②③)

| 지표 | 값 |
|---|---|
| ① 의미 보존 통과율(`0.75≤cos≤0.97`) | 0.5667 |
| ② 신규성 통과율(`cos<0.95`) | 1.0 |
| ③ 타 의도 충돌률(`cos≥0.9`) | 0.0 |

## ④ 생성 지연(시드 5건 → 후보 10건 배치, n=3)

| 지표 | 값(ms) |
|---|---|
| mean | 0.0 |
| **p95** | **0.0** |
| max | 0.0 |

## 케이스별 상세

| case | generated | semantic_pass_rate | novelty_pass_rate | conflict_rate |
|---|---|---|---|---|
| refund-policy | 10 | 0.8 | 1.0 | 0.0 |
| delivery-eta | 10 | 0.9 | 1.0 | 0.0 |
| agent-connect | 10 | 0.0 | 1.0 | 0.0 |

⑤ VRAM·라이선스는 이 스크립트가 측정하지 않는다 — `eval/report/generation-model-comparison.md`의
데스크 조사(HF API 라이선스 태그·safetensors 파라미터 수) 결과를 참고할 것.

전체 원본은 같은 디렉터리의 `.json` 파일에 있다(감사 가능성).