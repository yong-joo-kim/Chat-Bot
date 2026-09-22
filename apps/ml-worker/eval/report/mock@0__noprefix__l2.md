# 임계값 스윕 보고서 — mock@0|noprefix|l2

- 골든셋: 100문항 (MATCH 60 / CLARIFY 20 / NOMATCH 20), `eval/goldenset/{corpus,cases}.json`
- 차원: 64
- device: cpu

## CPU 단문 인코딩 지연 (질의 1건, n=30)

| 지표 | 값(ms) |
|---|---|
| mean | 0.03 |
| p50 | 0.03 |
| **p95** | **0.04** |
| max | 0.11 |

> 예산: `EMBEDDING_TIMEOUT_MS=300`(FR-N1-31). p95가 이 값을 넘으면 §8.1 완화 4단계를 순서대로 적용한다.

## 재색인 처리량 (64건 배치 기준 추정)

- 배치 소요: 0.001s / 64건 (건당 0.02ms)
- 5,000건 재색인 추정 소요: **0.1초**

## 임계값 스윕 — 상위 5개 구성 (목적함수 = match_recall − 2×false_accept_rate + 0.5×평균(clarify_recall, nomatch_recall))

| accept | low | margin | match_recall | match_precision | clarify_recall | nomatch_recall | false_accept_rate | objective |
|---|---|---|---|---|---|---|---|---|
| 0.9 | 0.4 | 0.08 | 0.0 | 0.0 | 0.2 | 0.0 | 0.025 | 0.0 |
| 0.9 | 0.4 | 0.1 | 0.0 | 0.0 | 0.2 | 0.0 | 0.025 | 0.0 |
| 0.9 | 0.45 | 0.08 | 0.0 | 0.0 | 0.2 | 0.0 | 0.025 | 0.0 |
| 0.9 | 0.45 | 0.1 | 0.0 | 0.0 | 0.2 | 0.0 | 0.025 | 0.0 |
| 0.9 | 0.5 | 0.08 | 0.0 | 0.0 | 0.2 | 0.0 | 0.025 | 0.0 |

### 권고 기본값

- `acceptThreshold = 0.9`
- `lowThreshold = 0.4`
- `marginThreshold = 0.08`
- 근거: match_recall=0.0, false_accept_rate=0.025(오확정 4건), clarify_recall=0.2, nomatch_recall=0.0

> 이 값은 `shared-types/answering.ts`의 `modelId → 기본 임계값` 매핑에 반영하고, `ChatbotAnswerSetting` 기본값 근거로 backend-implementer에게 인계한다(FR-N1-26/27, AC-N1-12).

전체 그리드는 같은 디렉터리의 `.json` 파일에 남아 있다(감사 가능성).