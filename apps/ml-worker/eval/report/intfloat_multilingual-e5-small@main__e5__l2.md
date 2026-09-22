# 임계값 스윕 보고서 — intfloat/multilingual-e5-small@main|e5|l2

- 골든셋: 100문항 (MATCH 60 / CLARIFY 20 / NOMATCH 20), `eval/goldenset/{corpus,cases}.json`
- 차원: 384
- device: cpu

> 지표 정의: `match_recall` = MATCH 중 **즉시 확정**(CONFIRM)된 비율. `match_handled_rate` = 즉시 확정 + **되묻기로 회수 가능**(정답이 후보 안에 포함, S-2 시나리오)까지 합친 실질 처리율. `match_lost_rate` = MATCH인데 2단계로 새버린 비율(가장 아까운 손실). `false_accept_rate` = CLARIFY/NOMATCH 대상인데 잘못 확정해버린 비율(J-4 기준 가장 비싼 오류).

## CPU 단문 인코딩 지연 (질의 1건, n=30)

| 지표 | 값(ms) |
|---|---|
| mean | 39.02 |
| p50 | 38.12 |
| **p95** | **61.2** |
| max | 63.87 |

> 예산: `EMBEDDING_TIMEOUT_MS=300`(FR-N1-31). p95가 이 값을 넘으면 §8.1 완화 4단계를 순서대로 적용한다.

## 재색인 처리량 (64건 배치 기준 추정)

- 배치 소요: 0.445s / 64건 (건당 6.96ms)
- 5,000건 재색인 추정 소요: **34.8초**

## 임계값 스윕 — 상위 5개 구성 (목적함수 = match_handled_rate − 3×wrong_confirm_rate − 2×false_accept_rate − 0.5×match_lost_rate + 0.3×평균(clarify_recall, nomatch_recall))

| accept | low | margin | match_recall | match_handled_rate | match_lost_rate | wrong_confirm_rate | match_precision | clarify_recall | nomatch_recall | false_accept_rate | objective |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.65 | 0.4 | 0.05 | 0.0333 | 0.8833 | 0.0 | 0.0 | 1.0 | 0.95 | 0.0 | 0.0 | 1.0258 |
| 0.65 | 0.4 | 0.08 | 0.0 | 0.8833 | 0.0 | 0.0 | 1.0 | 0.95 | 0.0 | 0.0 | 1.0258 |
| 0.65 | 0.4 | 0.1 | 0.0 | 0.8833 | 0.0 | 0.0 | 1.0 | 0.95 | 0.0 | 0.0 | 1.0258 |
| 0.65 | 0.45 | 0.05 | 0.0333 | 0.8833 | 0.0 | 0.0 | 1.0 | 0.95 | 0.0 | 0.0 | 1.0258 |
| 0.65 | 0.45 | 0.08 | 0.0 | 0.8833 | 0.0 | 0.0 | 1.0 | 0.95 | 0.0 | 0.0 | 1.0258 |

### 권고 기본값

- `acceptThreshold = 0.65`
- `lowThreshold = 0.4`
- `marginThreshold = 0.05`
- 근거: match_recall(즉시확정)=0.0333, match_handled_rate(확정+되묻기 회수)=0.8833, match_lost_rate(2단계로 새버림)=0.0, false_accept_rate=0.0(오확정 0건), clarify_recall=0.95, nomatch_recall=0.0

> 이 값은 `shared-types/answering.ts`의 `modelId → 기본 임계값` 매핑에 반영하고, `ChatbotAnswerSetting` 기본값 근거로 backend-implementer에게 인계한다(FR-N1-26/27, AC-N1-12).

전체 그리드는 같은 디렉터리의 `.json` 파일에 남아 있다(감사 가능성).