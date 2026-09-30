# 파이썬 기준선 — nlpai-lab/KURE-v1@main|noprefix|l2

- 입력: 312건 · 의도 26개 · dim 1024 · scikit-learn 사용(제품 경로 아님 · 게이트 아님)
- KMeans(n_clusters=26, n_init=3, random_state=20260930) — 정규화 입력이라 구면 k-평균 근사
- HDBSCAN(min_cluster_size=5) — 입력 = PCA 50차원

| 방법 | 묶음 수 | 미분류(노이즈) | 순도 | ARI | NMI | 쌍 정밀도 | 쌍 재현율 | 소요(초) |
|---|---|---|---|---|---|---|---|---|
| KMeans k=26 | 26 | - | 0.804 | 0.700 | 0.874 | 0.661 | 0.770 | 0.21 |
| HDBSCAN(PCA 50) | 15 | 32.7% | 0.446 | 0.202 | 0.648 | 0.153 | 0.660 | 0.01 |
