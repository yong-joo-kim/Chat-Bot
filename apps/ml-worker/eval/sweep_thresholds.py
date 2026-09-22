"""AC-N1-12 골든셋 100문항 기반 임계값(τ_accept/τ_low/τ_margin) 스윕 실험.

사용법(venv 안에서):
    python eval/sweep_thresholds.py --model nlpai-lab/KURE-v1 --prefix-rule noprefix
    python eval/sweep_thresholds.py --model mock                      # 로직만 빠르게 점검

산출물: eval/report/<model-slug>.md (사람이 읽는 보고서) +
        eval/report/<model-slug>.json (스윕 전체 그리드 원본 — 감사 가능하도록)

판정 로직(judge_band)은 ADR-0021 §1의 3구간 + 격차 조건과 FR-N1-13(후보 1건이면 확정)을
그대로 재현한다. 이 스크립트는 오프라인 모델 선정·기본값 도출용이며, 런타임 판정 함수의
소스 오브 트루스는 `packages/dialogue-engine/src/semantic.ts`(backend-implementer 구현)다 —
두 구현이 갈라지면 이 보고서의 결론이 무효가 되므로 로직을 바꿀 때는 반드시 함께 갱신할 것.
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from ml_worker.embedder import Embedder, MockEmbedder, SentenceTransformerEmbedder  # noqa: E402

ROOT = Path(__file__).resolve().parent
GOLDENSET_DIR = ROOT / "goldenset"
REPORT_DIR = ROOT / "report"


# ---------------------------------------------------------------------------
# 데이터 로딩
# ---------------------------------------------------------------------------


@dataclass
class CorpusRow:
    parent_id: str
    kind: str
    text: str


def load_corpus() -> list[CorpusRow]:
    data = json.loads((GOLDENSET_DIR / "corpus.json").read_text(encoding="utf-8"))
    rows: list[CorpusRow] = []
    for item in data["items"]:
        rows.append(CorpusRow(item["id"], item["kind"], item["text"]))
    for parent_id, alts in data.get("alt", {}).items():
        for alt_text in alts:
            rows.append(CorpusRow(parent_id, "ALT", alt_text))
    return rows


def load_cases() -> list[dict]:
    data = json.loads((GOLDENSET_DIR / "cases.json").read_text(encoding="utf-8"))
    return data["cases"]


# ---------------------------------------------------------------------------
# 판정 로직 (ADR-0021 재현 — 오프라인 평가 전용)
# ---------------------------------------------------------------------------


@dataclass
class Thresholds:
    accept: float
    low: float
    margin: float


@dataclass
class BandResult:
    band: str  # CONFIRM | CLARIFY | FAIL
    predicted_id: str | None
    candidate_ids: list[str] = field(default_factory=list)


def judge_band(ranked: list[tuple[str, float]], th: Thresholds) -> BandResult:
    """ranked: [(id, score), ...] 점수 내림차순. corpus.py에서 이미 정렬해 전달한다."""
    if not ranked or ranked[0][1] < th.low:
        return BandResult(band="FAIL", predicted_id=None)

    top1_id, top1_score = ranked[0]
    top2_score = ranked[1][1] if len(ranked) > 1 else 0.0
    gap = top1_score - top2_score

    is_confirm_zone = top1_score >= th.accept and gap >= th.margin
    if is_confirm_zone:
        return BandResult(band="CONFIRM", predicted_id=top1_id)

    # 모호 구간 후보: low 이상인 상위 최대 3건 (FR-N1-13)
    candidates = [cid for cid, score in ranked[:3] if score >= th.low]
    if len(candidates) <= 1:
        # 후보가 1건뿐이면 되묻지 않고 확정한다
        fallback_id = candidates[0] if candidates else top1_id
        return BandResult(band="CONFIRM", predicted_id=fallback_id)
    return BandResult(band="CLARIFY", predicted_id=None, candidate_ids=candidates)


# ---------------------------------------------------------------------------
# 임베더 로딩
# ---------------------------------------------------------------------------


def build_embedder(model: str, revision: str, device: str, prefix_rule: str, max_seq_length: int) -> Embedder:
    if model.strip().lower() == "mock":
        return MockEmbedder(dimension=64)
    model_id = f"{model}@{revision}|{prefix_rule}|l2"
    embedder = SentenceTransformerEmbedder(
        model_name=model,
        revision=revision,
        device=device,
        prefix_rule=prefix_rule,
        norm_rule="l2",
        max_seq_length=max_seq_length,
        model_id=model_id,
    )
    embedder.warmup()
    return embedder


# ---------------------------------------------------------------------------
# 점수 행렬 계산
# ---------------------------------------------------------------------------


def compute_scores(embedder: Embedder, corpus: list[CorpusRow], cases: list[dict]) -> dict[str, list[tuple[str, float]]]:
    corpus_texts = [row.text for row in corpus]
    corpus_vecs = embedder.embed(corpus_texts, "PASSAGE")  # (M, D)

    queries = [c["query"] for c in cases]
    query_vecs = embedder.embed(queries, "QUERY")  # (N, D)

    sims = query_vecs @ corpus_vecs.T  # 코사인 = 내적 (둘 다 L2 정규화됨)

    result: dict[str, list[tuple[str, float]]] = {}
    for i, case in enumerate(cases):
        per_id_max: dict[str, float] = {}
        for j, row in enumerate(corpus):
            score = float(sims[i, j])
            if row.parent_id not in per_id_max or score > per_id_max[row.parent_id]:
                per_id_max[row.parent_id] = score
        ranked = sorted(per_id_max.items(), key=lambda kv: kv[1], reverse=True)
        result[case["id"]] = ranked
    return result


# ---------------------------------------------------------------------------
# 스윕 + 지표 집계
# ---------------------------------------------------------------------------


def evaluate_config(cases: list[dict], scores: dict[str, list[tuple[str, float]]], th: Thresholds) -> dict:
    n_match = n_clarify = n_nomatch = 0
    match_correct = clarify_correct = nomatch_correct = 0
    match_clarified_ok = 0  # MATCH인데 CLARIFY로 빠졌지만 후보 안에 정답이 있음(S-2 되묻기로 회수 가능)
    match_lost = 0  # MATCH인데 FAIL(2단계 이관)로 새 버림 — 가장 아까운 손실
    false_accept = 0  # CLARIFY/NOMATCH인데 CONFIRM 되어버린 경우 (가장 비싼 오류 — J-4)
    wrong_confirm = 0  # MATCH인데 CONFIRM은 됐지만 다른 id로 확정된 경우

    for case in cases:
        ranked = scores[case["id"]]
        band = judge_band(ranked, th)
        label = case["label"]

        if label == "MATCH":
            n_match += 1
            if band.band == "CONFIRM" and band.predicted_id == case["expectedId"]:
                match_correct += 1
            elif band.band == "CONFIRM":
                wrong_confirm += 1
            elif band.band == "CLARIFY" and case["expectedId"] in band.candidate_ids:
                match_clarified_ok += 1
            elif band.band == "FAIL":
                match_lost += 1
        elif label == "CLARIFY":
            n_clarify += 1
            if band.band == "CLARIFY" and set(band.candidate_ids) & set(case["candidateIds"]):
                clarify_correct += 1
            elif band.band == "CONFIRM":
                false_accept += 1
        else:  # NOMATCH
            n_nomatch += 1
            if band.band == "FAIL":
                nomatch_correct += 1
            elif band.band == "CONFIRM":
                false_accept += 1

    match_recall = match_correct / n_match if n_match else 0.0
    # 즉시 확정 + 되묻기로 회수 가능한 것까지 합친 "실질 처리율" — S-2 시나리오(되묻기 후 정확일치)를 반영
    match_handled_rate = (match_correct + match_clarified_ok) / n_match if n_match else 0.0
    match_lost_rate = match_lost / n_match if n_match else 0.0
    clarify_recall = clarify_correct / n_clarify if n_clarify else 0.0
    nomatch_recall = nomatch_correct / n_nomatch if n_nomatch else 0.0
    total_confirm_attempts = match_correct + wrong_confirm + false_accept  # CONFIRM으로 판정된 전체 건수 근사
    # 정밀도 = 확정한 것 중 실제로 맞은 것의 비율 (MATCH 정답만 "맞음"으로 센다)
    precision = match_correct / total_confirm_attempts if total_confirm_attempts else 1.0
    false_accept_rate = false_accept / (n_clarify + n_nomatch) if (n_clarify + n_nomatch) else 0.0

    wrong_confirm_rate = wrong_confirm / n_match if n_match else 0.0

    # 목적함수: "확신에 찬 오답"(wrong_confirm)이 가장 비싸고, 그다음 오확정(false_accept, J-4),
    # 그 다음 "실질 처리율"(즉시확정+되묻기 회수) 극대화, 2단계로 새 버리는 것에도 벌점을 준다.
    objective = (
        match_handled_rate
        - 3.0 * wrong_confirm_rate
        - 2.0 * false_accept_rate
        - 0.5 * match_lost_rate
        + 0.3 * (clarify_recall + nomatch_recall) / 2
    )

    return {
        "accept": th.accept,
        "low": th.low,
        "margin": th.margin,
        "match_recall": round(match_recall, 4),
        "match_handled_rate": round(match_handled_rate, 4),
        "match_lost_rate": round(match_lost_rate, 4),
        "match_precision": round(precision, 4),
        "clarify_recall": round(clarify_recall, 4),
        "nomatch_recall": round(nomatch_recall, 4),
        "false_accept_rate": round(false_accept_rate, 4),
        "wrong_confirm_count": wrong_confirm,
        "wrong_confirm_rate": round(wrong_confirm_rate, 4),
        "objective": round(objective, 4),
    }


def sweep(cases: list[dict], scores: dict[str, list[tuple[str, float]]]) -> list[dict]:
    accepts = [0.65, 0.70, 0.75, 0.80, 0.85, 0.90]
    lows = [0.40, 0.45, 0.50, 0.55, 0.60, 0.65]
    margins = [0.03, 0.05, 0.08, 0.10]

    rows: list[dict] = []
    for accept in accepts:
        for low in lows:
            if low >= accept:
                continue
            for margin in margins:
                th = Thresholds(accept=accept, low=low, margin=margin)
                rows.append(evaluate_config(cases, scores, th))
    rows.sort(key=lambda r: r["objective"], reverse=True)
    return rows


# ---------------------------------------------------------------------------
# CPU 지연 측정
# ---------------------------------------------------------------------------


def measure_cpu_latency(embedder: Embedder, n: int = 30) -> dict:
    samples_ms: list[float] = []
    for i in range(n):
        text = f"측정용 문장 {i} 배송이나 환불 관련 질문 예시입니다"
        start = time.perf_counter()
        embedder.embed([text], "QUERY")
        samples_ms.append((time.perf_counter() - start) * 1000)
    samples_ms.sort()
    p50 = samples_ms[len(samples_ms) // 2]
    p95_idx = min(len(samples_ms) - 1, int(len(samples_ms) * 0.95))
    p95 = samples_ms[p95_idx]
    return {
        "n": n,
        "mean_ms": round(statistics.mean(samples_ms), 2),
        "p50_ms": round(p50, 2),
        "p95_ms": round(p95, 2),
        "max_ms": round(max(samples_ms), 2),
    }


def measure_reindex_throughput(embedder: Embedder, corpus: list[CorpusRow], target_n: int = 5000) -> dict:
    texts = [row.text for row in corpus]
    batch = texts * (64 // max(1, len(texts)) + 1)
    batch = batch[:64]
    start = time.perf_counter()
    embedder.embed(batch, "PASSAGE")
    elapsed_s = time.perf_counter() - start
    per_item_s = elapsed_s / len(batch)
    estimated_total_s = per_item_s * target_n
    return {
        "batch_size": len(batch),
        "batch_elapsed_s": round(elapsed_s, 3),
        "per_item_ms": round(per_item_s * 1000, 2),
        "estimated_seconds_for_5000": round(estimated_total_s, 1),
    }


# ---------------------------------------------------------------------------
# 보고서 작성
# ---------------------------------------------------------------------------


def write_report(model_slug: str, meta: dict, latency: dict, throughput: dict, grid: list[dict]) -> None:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    (REPORT_DIR / f"{model_slug}.json").write_text(
        json.dumps({"meta": meta, "latency": latency, "throughput": throughput, "grid": grid}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    top5 = grid[:5]
    best = grid[0]

    lines = [
        f"# 임계값 스윕 보고서 — {meta['model_id']}",
        "",
        f"- 골든셋: 100문항 (MATCH 60 / CLARIFY 20 / NOMATCH 20), `eval/goldenset/{{corpus,cases}}.json`",
        f"- 차원: {meta['dimension']}",
        f"- device: {meta['device']}",
        "",
        "> 지표 정의: `match_recall` = MATCH 중 **즉시 확정**(CONFIRM)된 비율. "
        "`match_handled_rate` = 즉시 확정 + **되묻기로 회수 가능**(정답이 후보 안에 포함, S-2 시나리오)까지 합친 실질 처리율. "
        "`match_lost_rate` = MATCH인데 2단계로 새버린 비율(가장 아까운 손실). "
        "`false_accept_rate` = CLARIFY/NOMATCH 대상인데 잘못 확정해버린 비율(J-4 기준 가장 비싼 오류).",
        "",
        "## CPU 단문 인코딩 지연 (질의 1건, n={})".format(latency["n"]),
        "",
        f"| 지표 | 값(ms) |",
        f"|---|---|",
        f"| mean | {latency['mean_ms']} |",
        f"| p50 | {latency['p50_ms']} |",
        f"| **p95** | **{latency['p95_ms']}** |",
        f"| max | {latency['max_ms']} |",
        "",
        f"> 예산: `EMBEDDING_TIMEOUT_MS=300`(FR-N1-31). p95가 이 값을 넘으면 §8.1 완화 4단계를 순서대로 적용한다.",
        "",
        "## 재색인 처리량 (64건 배치 기준 추정)",
        "",
        f"- 배치 소요: {throughput['batch_elapsed_s']}s / {throughput['batch_size']}건 (건당 {throughput['per_item_ms']}ms)",
        f"- 5,000건 재색인 추정 소요: **{throughput['estimated_seconds_for_5000']}초**",
        "",
        "## 임계값 스윕 — 상위 5개 구성 "
        "(목적함수 = match_handled_rate − 3×wrong_confirm_rate − 2×false_accept_rate "
        "− 0.5×match_lost_rate + 0.3×평균(clarify_recall, nomatch_recall))",
        "",
        "| accept | low | margin | match_recall | match_handled_rate | match_lost_rate | wrong_confirm_rate | "
        "match_precision | clarify_recall | nomatch_recall | false_accept_rate | objective |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for row in top5:
        lines.append(
            f"| {row['accept']} | {row['low']} | {row['margin']} | {row['match_recall']} | "
            f"{row['match_handled_rate']} | {row['match_lost_rate']} | {row['wrong_confirm_rate']} | "
            f"{row['match_precision']} | {row['clarify_recall']} | {row['nomatch_recall']} | "
            f"{row['false_accept_rate']} | {row['objective']} |"
        )
    lines += [
        "",
        f"### 권고 기본값",
        "",
        f"- `acceptThreshold = {best['accept']}`",
        f"- `lowThreshold = {best['low']}`",
        f"- `marginThreshold = {best['margin']}`",
        f"- 근거: match_recall(즉시확정)={best['match_recall']}, match_handled_rate(확정+되묻기 회수)={best['match_handled_rate']}, "
        f"match_lost_rate(2단계로 새버림)={best['match_lost_rate']}, false_accept_rate={best['false_accept_rate']}"
        f"(오확정 {best['wrong_confirm_count']}건), clarify_recall={best['clarify_recall']}, "
        f"nomatch_recall={best['nomatch_recall']}",
        "",
        "> 이 값은 `shared-types/answering.ts`의 `modelId → 기본 임계값` 매핑에 반영하고, "
        "`ChatbotAnswerSetting` 기본값 근거로 backend-implementer에게 인계한다(FR-N1-26/27, AC-N1-12).",
        "",
        "전체 그리드는 같은 디렉터리의 `.json` 파일에 남아 있다(감사 가능성).",
    ]
    (REPORT_DIR / f"{model_slug}.md").write_text("\n".join(lines), encoding="utf-8")
    print(f"[sweep] 보고서 작성 완료: eval/report/{model_slug}.md")


def slugify(model_id: str) -> str:
    return model_id.replace("/", "_").replace("|", "__").replace(":", "-")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True, help="HF 모델 repo id 또는 'mock'")
    parser.add_argument("--revision", default="main")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--prefix-rule", default="noprefix", choices=["noprefix", "e5"])
    parser.add_argument("--max-seq-length", type=int, default=128)
    args = parser.parse_args()

    corpus = load_corpus()
    cases = load_cases()

    print(f"[sweep] 모델 로딩: {args.model}")
    embedder = build_embedder(args.model, args.revision, args.device, args.prefix_rule, args.max_seq_length)
    print(f"[sweep] modelId={embedder.model_id} dim={embedder.dimension}")

    print("[sweep] 점수 행렬 계산 중...")
    scores = compute_scores(embedder, corpus, cases)

    print("[sweep] CPU 지연 측정 중...")
    latency = measure_cpu_latency(embedder)
    print(f"[sweep] p95={latency['p95_ms']}ms")

    print("[sweep] 재색인 처리량 측정 중...")
    throughput = measure_reindex_throughput(embedder, corpus)

    print("[sweep] 임계값 그리드 스윕 중...")
    grid = sweep(cases, scores)

    meta = {
        "model_id": embedder.model_id,
        "dimension": embedder.dimension,
        "device": args.device,
        "corpus_rows": len(corpus),
        "case_count": len(cases),
    }
    write_report(slugify(embedder.model_id), meta, latency, throughput, grid)


if __name__ == "__main__":
    main()
