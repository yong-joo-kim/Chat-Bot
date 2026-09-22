# 임계값 스윕 보고서 — BAAI/bge-m3@main|noprefix|l2

- 골든셋: 100문항 (MATCH 60 / CLARIFY 20 / NOMATCH 20), `eval/goldenset/{corpus,cases}.json`
- 차원: 1024
- device: cpu

> 지표 정의: `match_recall` = MATCH 중 **즉시 확정**(CONFIRM)된 비율. `match_handled_rate` = 즉시 확정 + **되묻기로 회수 가능**(정답이 후보 안에 포함, S-2 시나리오)까지 합친 실질 처리율. `match_lost_rate` = MATCH인데 2단계로 새버린 비율(가장 아까운 손실). `false_accept_rate` = CLARIFY/NOMATCH 대상인데 잘못 확정해버린 비율(J-4 기준 가장 비싼 오류).

## CPU 단문 인코딩 지연 (질의 1건, n=30)

| 지표 | 값(ms) |
|---|---|
| mean | 134.18 |
| p50 | 119.53 |
| **p95** | **235.79** |
| max | 240.56 |

> 예산: `EMBEDDING_TIMEOUT_MS=300`(FR-N1-31). p95가 이 값을 넘으면 §8.1 완화 4단계를 순서대로 적용한다.

## 재색인 처리량 (64건 배치 기준 추정)

- 배치 소요: 2.684s / 64건 (건당 41.94ms)
- 5,000건 재색인 추정 소요: **209.7초**

## 임계값 스윕 — 상위 5개 구성 (목적함수 = match_handled_rate − 3×wrong_confirm_rate − 2×false_accept_rate − 0.5×match_lost_rate + 0.3×평균(clarify_recall, nomatch_recall))

| accept | low | margin | match_recall | match_handled_rate | match_lost_rate | wrong_confirm_rate | match_precision | clarify_recall | nomatch_recall | false_accept_rate | objective |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.9 | 0.45 | 0.1 | 0.2 | 0.9833 | 0.0 | 0.0167 | 0.9231 | 1.0 | 0.1 | 0.0 | 1.0983 |
| 0.9 | 0.4 | 0.1 | 0.2 | 0.9833 | 0.0 | 0.0167 | 0.9231 | 1.0 | 0.0 | 0.0 | 1.0833 |
| 0.9 | 0.5 | 0.1 | 0.2 | 0.9833 | 0.0 | 0.0167 | 0.8571 | 1.0 | 0.1 | 0.025 | 1.0483 |
| 0.9 | 0.45 | 0.05 | 0.2167 | 0.9667 | 0.0 | 0.0333 | 0.8667 | 1.0 | 0.1 | 0.0 | 1.0317 |
| 0.9 | 0.45 | 0.08 | 0.2167 | 0.9667 | 0.0 | 0.0333 | 0.8667 | 1.0 | 0.1 | 0.0 | 1.0317 |

### 권고 기본값

- `acceptThreshold = 0.9`
- `lowThreshold = 0.45`
- `marginThreshold = 0.1`
- 근거: match_recall(즉시확정)=0.2, match_handled_rate(확정+되묻기 회수)=0.9833, match_lost_rate(2단계로 새버림)=0.0, false_accept_rate=0.0(오확정 1건), clarify_recall=1.0, nomatch_recall=0.1

> 이 값은 `shared-types/answering.ts`의 `modelId → 기본 임계값` 매핑에 반영하고, `ChatbotAnswerSetting` 기본값 근거로 backend-implementer에게 인계한다(FR-N1-26/27, AC-N1-12).

전체 그리드는 같은 디렉터리의 `.json` 파일에 남아 있다(감사 가능성).