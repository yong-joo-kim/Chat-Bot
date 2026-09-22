"""No.16 증강 G3(로컬 생성모델) 후보 3종 × 5지표 실측 스크립트(ADR-0026 §5).

사용법(venv 안에서, 실제 GPU 24GB+ 환경에서 실행할 것):
    python eval/generation_candidates.py --model mock                                    # 하네스 점검용
    python eval/generation_candidates.py --model MLP-KTLim/llama-3-Korean-Bllossom-8B --device cuda
    python eval/generation_candidates.py --model Qwen/Qwen2.5-14B-Instruct --device cuda
    python eval/generation_candidates.py --model Qwen/Qwen2.5-32B-Instruct-AWQ --device cuda

산출물: eval/report/generation/<model-slug>.md(.json) — 5지표(의미보존 통과율·신규성 통과율·
타의도 충돌률·생성 지연 P95·VRAM/라이선스)를 계산한다.

⚠ 이 저장소의 개발 샌드박스는 **4GB 소비자용 GPU**(RTX 3050)만 갖고 있고, PM이 확보했다는
**24GB+ 데이터센터급 GPU**가 아니다. 8B~32B 모델의 실제 추론은 이 환경에서 시간·메모리 예산을
초과해 실행할 수 없었다 — 이 스크립트는 하네스로서 `--model mock`으로 전체 파이프라인(생성→
임베딩→검증→집계→보고서 작성)이 올바르게 동작함을 검증했고, **후보 3종의 정량 5지표는 실제
24GB+ GPU에서 이 스크립트를 실행해 채워야 한다**(README 및 model-comparison.md 참고).

판정 로직(의미보존/신규성/타의도충돌)은 `apps/api/src/augmentation/lib/validate-candidates.ts`의
로직을 오프라인 평가용으로 재현한다 — 두 구현이 갈라지면 이 보고서의 결론이 무효가 되므로 로직을
바꿀 때는 반드시 함께 갱신할 것(sweep_thresholds.py와 같은 경고).
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from ml_worker.embedder import Embedder, MockEmbedder, SentenceTransformerEmbedder  # noqa: E402
from ml_worker.generator import Generator, HFCausalLMGenerator, MockGenerator  # noqa: E402

ROOT = Path(__file__).resolve().parent
REPORT_DIR = ROOT / "report" / "generation"

# 증강 자기 검증 임계값(apps/api augmentation-thresholds.ts와 반드시 동기화)
KEEP_MIN = 0.75
KEEP_MAX = 0.97
NOVELTY_MAX = 0.95
ACCEPT_THRESHOLD = 0.90  # KURE-v1 threshold-recommendation.md 채택값(1단계 매칭과 같은 기준선)


@dataclass
class GenerationCase:
    """예문이 빈약한 의도(콜드스타트) 시나리오를 흉내낸 시드 세트. 신규성 검사용 기존 예문과
    충돌 검사용 타 의도 예문도 함께 정의한다."""

    case_id: str
    seeds: list[str]
    existing_examples: list[str]  # 신규성(②) 비교 대상 — 시드와 동일해도 무방(콜드스타트는 얕다)
    other_intent_examples: dict[str, list[str]]  # intentId -> examples (③ 충돌 비교 대상)


CASES: list[GenerationCase] = [
    GenerationCase(
        case_id="refund-policy",
        seeds=["환불 규정 안내"],
        existing_examples=["환불 규정 안내"],
        other_intent_examples={"intent-cancel": ["주문을 취소하고 싶어요", "취소하면 위약금이 있나요?"]},
    ),
    GenerationCase(
        case_id="delivery-eta",
        seeds=["배송은 얼마나 걸리나요?", "배송기간이 궁금해요"],
        existing_examples=["배송은 얼마나 걸리나요?", "배송기간이 궁금해요"],
        other_intent_examples={"intent-track": ["배송 조회는 어떻게 하나요?", "송장번호로 배송상태 확인 가능한가요"]},
    ),
    GenerationCase(
        case_id="agent-connect",
        seeds=["상담원연결"],
        existing_examples=["상담원연결"],
        other_intent_examples={"intent-complaint": ["너무 불편해서 항의하고 싶어요"]},
    ),
]


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b))


def build_embedder(model: str, device: str) -> Embedder:
    if model.strip().lower() == "mock":
        return MockEmbedder(dimension=64)
    embedder = SentenceTransformerEmbedder(
        model_name=model,
        revision="main",
        device=device,
        prefix_rule="noprefix",
        norm_rule="l2",
        max_seq_length=128,
        model_id=f"{model}@main|noprefix|l2",
    )
    embedder.warmup()
    return embedder


def build_generator(model: str, device: str, max_new_tokens: int) -> Generator:
    if model.strip().lower() == "mock":
        return MockGenerator()
    generator = HFCausalLMGenerator(
        model_name=model, revision="main", device=device, max_new_tokens=max_new_tokens, model_id=f"{model}@main"
    )
    generator.warmup()  # type: ignore[attr-defined]
    return generator


def evaluate_case(
    case: GenerationCase,
    candidates: list[str],
    embedder: Embedder,
) -> dict:
    if not candidates:
        return {
            "case_id": case.case_id,
            "generated": 0,
            "semantic_kept": 0,
            "novel": 0,
            "conflicts": 0,
            "semantic_pass_rate": 0.0,
            "novelty_pass_rate": 0.0,
            "conflict_rate": 0.0,
        }

    cand_vecs = embedder.embed(candidates, "QUERY")
    seed_vecs = embedder.embed(case.seeds, "PASSAGE")
    existing_vecs = embedder.embed(case.existing_examples, "PASSAGE")
    other_vecs = {
        intent_id: embedder.embed(examples, "PASSAGE") for intent_id, examples in case.other_intent_examples.items()
    }

    semantic_kept = 0
    novel = 0
    conflicts = 0
    for cv in cand_vecs:
        sim_to_seed = max(cosine(cv, sv) for sv in seed_vecs)
        kept = KEEP_MIN <= sim_to_seed <= KEEP_MAX
        if kept:
            semantic_kept += 1
        novelty_score = max((cosine(cv, ev) for ev in existing_vecs), default=0.0)
        if novelty_score < NOVELTY_MAX:
            novel += 1
        max_other = 0.0
        for vecs in other_vecs.values():
            max_other = max(max_other, max((cosine(cv, ov) for ov in vecs), default=0.0))
        if max_other >= ACCEPT_THRESHOLD:
            conflicts += 1

    n = len(candidates)
    return {
        "case_id": case.case_id,
        "generated": n,
        "semantic_kept": semantic_kept,
        "novel": novel,
        "conflicts": conflicts,
        "semantic_pass_rate": round(semantic_kept / n, 4),
        "novelty_pass_rate": round(novel / n, 4),
        "conflict_rate": round(conflicts / n, 4),
    }


def measure_latency(generator: Generator, seeds: list[str], target_count: int, n: int = 3) -> dict:
    samples_ms: list[float] = []
    for _ in range(n):
        start = time.perf_counter()
        generator.generate(seeds, target_count)
        samples_ms.append((time.perf_counter() - start) * 1000)
    samples_ms.sort()
    p95_idx = min(len(samples_ms) - 1, int(len(samples_ms) * 0.95))
    return {
        "n": n,
        "target_count": target_count,
        "mean_ms": round(statistics.mean(samples_ms), 1),
        "p95_ms": round(samples_ms[p95_idx], 1),
        "max_ms": round(max(samples_ms), 1),
    }


def slugify(model_id: str) -> str:
    return model_id.replace("/", "_").replace("|", "__").replace(":", "-")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True, help="HF causal LM repo id 또는 'mock'")
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--embedding-model", default="nlpai-lab/KURE-v1")
    parser.add_argument("--embedding-device", default="cpu")
    parser.add_argument("--target-count", type=int, default=20)
    parser.add_argument("--max-new-tokens", type=int, default=768)
    args = parser.parse_args()

    print(f"[gen-eval] 임베딩 모델 로딩(검증용): {args.embedding_model}")
    embedder = build_embedder(args.embedding_model, args.embedding_device)

    print(f"[gen-eval] 생성모델 로딩: {args.model} (device={args.device})")
    generator = build_generator(args.model, args.device, args.max_new_tokens)
    print(f"[gen-eval] modelId={generator.model_id}")

    case_results = []
    all_candidates_flat: list[str] = []
    for case in CASES:
        print(f"[gen-eval] 케이스 {case.case_id}: 시드 {case.seeds} → 후보 {args.target_count}건 생성 중...")
        candidates = generator.generate(case.seeds, args.target_count)
        all_candidates_flat.extend(candidates)
        result = evaluate_case(case, candidates, embedder)
        case_results.append(result)
        print(f"  → 생성 {result['generated']}건 / 의미보존 {result['semantic_pass_rate']} "
              f"/ 신규성 {result['novelty_pass_rate']} / 충돌률 {result['conflict_rate']}")

    print("[gen-eval] 지연 측정 중(시드 5건 → 후보 20건 배치 1회, n=3)...")
    latency_seeds = [c.seeds[0] for c in CASES] * 2  # 최대 5~6건으로 채운다
    latency = measure_latency(generator, latency_seeds[:5], args.target_count)
    print(f"[gen-eval] p95={latency['p95_ms']}ms")

    n_total = sum(r["generated"] for r in case_results)
    agg = {
        "semantic_pass_rate": round(sum(r["semantic_kept"] for r in case_results) / n_total, 4) if n_total else 0.0,
        "novelty_pass_rate": round(sum(r["novel"] for r in case_results) / n_total, 4) if n_total else 0.0,
        "conflict_rate": round(sum(r["conflicts"] for r in case_results) / n_total, 4) if n_total else 0.0,
    }

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    slug = slugify(generator.model_id)
    report = {
        "model_id": generator.model_id,
        "device": args.device,
        "target_count": args.target_count,
        "cases": case_results,
        "aggregate": agg,
        "latency": latency,
    }
    (REPORT_DIR / f"{slug}.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        f"# 생성모델 실측 보고서 — {generator.model_id}",
        "",
        f"- device: {args.device}",
        f"- 케이스: {', '.join(c.case_id for c in CASES)} (시드 빈약 의도 콜드스타트 시나리오)",
        "",
        "## 집계 3지표(①②③)",
        "",
        "| 지표 | 값 |",
        "|---|---|",
        f"| ① 의미 보존 통과율(`{KEEP_MIN}≤cos≤{KEEP_MAX}`) | {agg['semantic_pass_rate']} |",
        f"| ② 신규성 통과율(`cos<{NOVELTY_MAX}`) | {agg['novelty_pass_rate']} |",
        f"| ③ 타 의도 충돌률(`cos≥{ACCEPT_THRESHOLD}`) | {agg['conflict_rate']} |",
        "",
        "## ④ 생성 지연(시드 5건 → 후보 {}건 배치, n={})".format(latency["target_count"], latency["n"]),
        "",
        f"| 지표 | 값(ms) |",
        f"|---|---|",
        f"| mean | {latency['mean_ms']} |",
        f"| **p95** | **{latency['p95_ms']}** |",
        f"| max | {latency['max_ms']} |",
        "",
        "## 케이스별 상세",
        "",
        "| case | generated | semantic_pass_rate | novelty_pass_rate | conflict_rate |",
        "|---|---|---|---|---|",
    ]
    for r in case_results:
        lines.append(
            f"| {r['case_id']} | {r['generated']} | {r['semantic_pass_rate']} | "
            f"{r['novelty_pass_rate']} | {r['conflict_rate']} |"
        )
    lines += [
        "",
        "⑤ VRAM·라이선스는 이 스크립트가 측정하지 않는다 — `eval/report/generation-model-comparison.md`의",
        "데스크 조사(HF API 라이선스 태그·safetensors 파라미터 수) 결과를 참고할 것.",
        "",
        "전체 원본은 같은 디렉터리의 `.json` 파일에 있다(감사 가능성).",
    ]
    (REPORT_DIR / f"{slug}.md").write_text("\n".join(lines), encoding="utf-8")
    print(f"[gen-eval] 보고서 작성 완료: eval/report/generation/{slug}.md")


if __name__ == "__main__":
    main()
