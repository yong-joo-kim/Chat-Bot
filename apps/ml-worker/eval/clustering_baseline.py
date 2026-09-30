"""No.21 발화 묶음 분석 — 군집 품질 **파이썬 기준선**(설계서 §20.5-7, 선택 · 게이트 아님 · 제품 경로 아님).

`apps/api`의 품질 측정 도구가 `--dump <dir>`로 저장한 벡터·정답 라벨을 읽어, 같은 데이터에서
scikit-learn의 KMeans(구면 근사 = 정규화 입력)와 HDBSCAN(원공간 · PCA 50차원)의 지표를 같은 형식으로 낸다.
제품의 구면 k-평균(TS)과 밀도 기반 방법을 비교해 ADR-0047 재검토 트리거("밀도 기반이 뚜렷이 낫다")를
판정하는 참고 자료다.

사전 준비(선택 의존성 묶음 — 런타임 설치 목록은 바뀌지 않는다):
    pip install -e ".[eval]"        # scikit-learn>=1.3,<2 (HDBSCAN은 1.3 이상)

사용법(venv 안에서):
    cd apps/api
    EMBEDDING_BASE_URL=http://localhost:8100 npx ts-node -r tsconfig-paths/register --transpile-only \\
        src/utterance-analysis/eval/measure-clustering-quality.ts --dump <dir>
    cd ../ml-worker
    python eval/clustering_baseline.py --dump <dir> [--k 26] [--min 5] [--report <md>]

산출물: 표준 출력(마크다운) 또는 `--report` 경로. 문장은 읽지도 싣지도 않는다(라벨·벡터만).
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

try:
    from sklearn.cluster import HDBSCAN, KMeans
    from sklearn.decomposition import PCA
    from sklearn.metrics import adjusted_rand_score, normalized_mutual_info_score
except ImportError:  # pragma: no cover - 선택 의존성 미설치 안내
    sys.exit('scikit-learn이 필요합니다: pip install -e ".[eval]"  (scikit-learn>=1.3,<2)')


def purity(labels: np.ndarray, clusters: np.ndarray) -> float:
    total = 0
    for c in np.unique(clusters):
        _, counts = np.unique(labels[clusters == c], return_counts=True)
        total += counts.max()
    return total / len(labels)


def pair_stats(labels: np.ndarray, clusters: np.ndarray) -> tuple[float, float]:
    """같은 묶음에 든 쌍 기준 정밀도·재현율(TS 측정 도구와 같은 정의)."""

    def comb2(x: int) -> int:
        return x * (x - 1) // 2

    _, li = np.unique(labels, return_inverse=True)
    _, ci = np.unique(clusters, return_inverse=True)
    table = np.zeros((li.max() + 1, ci.max() + 1), dtype=np.int64)
    for a, b in zip(li, ci):
        table[a, b] += 1
    both = sum(comb2(int(x)) for x in table.ravel())
    same_cluster = sum(comb2(int(x)) for x in table.sum(axis=0))
    same_label = sum(comb2(int(x)) for x in table.sum(axis=1))
    return (both / same_cluster if same_cluster else 0.0, both / same_label if same_label else 0.0)


def row(name: str, labels: np.ndarray, clusters: np.ndarray, seconds: float, unassigned: float | None = None) -> str:
    p, r = pair_stats(labels, clusters)
    un = "-" if unassigned is None else f"{unassigned * 100:.1f}%"
    return (
        f"| {name} | {len(np.unique(clusters))} | {un} | {purity(labels, clusters):.3f} | "
        f"{adjusted_rand_score(labels, clusters):.3f} | {normalized_mutual_info_score(labels, clusters):.3f} | "
        f"{p:.3f} | {r:.3f} | {seconds:.2f} |"
    )


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):  # Windows 콘솔(cp949)에서 한글·기호 출력 보호
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dump", required=True, help="측정 도구 --dump 디렉터리(vectors.f32 · labels.json)")
    parser.add_argument("--k", type=int, default=None, help="KMeans 묶음 수(기본 = 의도 수)")
    parser.add_argument("--min", type=int, default=5, help="HDBSCAN min_cluster_size(기본 5)")
    parser.add_argument("--pca", type=int, default=50, help="HDBSCAN 전 PCA 차원(기본 50, 0이면 원공간)")
    parser.add_argument("--seed", type=int, default=20260930)
    parser.add_argument("--report", default=None)
    args = parser.parse_args()

    dump = Path(args.dump)
    meta = json.loads((dump / "labels.json").read_text(encoding="utf-8"))
    n, dim = int(meta["n"]), int(meta["dimension"])
    vectors = np.fromfile(dump / "vectors.f32", dtype=np.float32).reshape(n, dim)
    labels = np.array(meta["labels"])
    intents = len(np.unique(labels))
    k = args.k or intents
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    unit = vectors / np.where(norms == 0, 1, norms)

    lines = [
        f"# 파이썬 기준선 — {meta.get('modelId', '?')}",
        "",
        f"- 입력: {n}건 · 의도 {intents}개 · dim {dim} · scikit-learn 사용(제품 경로 아님 · 게이트 아님)",
        f"- KMeans(n_clusters={k}, n_init=3, random_state={args.seed}) — 정규화 입력이라 구면 k-평균 근사",
        f"- HDBSCAN(min_cluster_size={args.min}) — 입력 = " + (f"PCA {args.pca}차원" if args.pca else "원공간"),
        "",
        "| 방법 | 묶음 수 | 미분류(노이즈) | 순도 | ARI | NMI | 쌍 정밀도 | 쌍 재현율 | 소요(초) |",
        "|---|---|---|---|---|---|---|---|---|",
    ]

    t0 = time.time()
    km = KMeans(n_clusters=k, n_init=3, random_state=args.seed).fit_predict(unit)
    lines.append(row(f"KMeans k={k}", labels, km, time.time() - t0))

    x = PCA(n_components=min(args.pca, n - 1, dim), random_state=args.seed).fit_transform(unit) if args.pca else unit
    t0 = time.time()
    hd = HDBSCAN(min_cluster_size=args.min).fit_predict(x)
    noise = float((hd == -1).mean())
    # 노이즈(-1)는 미분류 1묶음으로 두고 전 발화 기준으로 계산 — TS 도구의 "전 발화" 기준과 같다.
    lines.append(row(f"HDBSCAN(PCA {args.pca})", labels, hd, time.time() - t0, unassigned=noise))

    text = "\n".join(lines) + "\n"
    if args.report:
        Path(args.report).write_text(text, encoding="utf-8")
        print(f"보고서: {args.report}")
    else:
        print(text)


if __name__ == "__main__":
    main()
