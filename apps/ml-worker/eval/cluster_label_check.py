"""No.21 묶음 이름 제안(`POST /cluster-label`) 동작 확인 스크립트(AC-DC6-4 — 3050 + Ollama 등 개발 장비).

`apps/api`의 품질 측정 도구가 `--dump-clusters <json>`로 저장한 묶음별 키워드·대표 발화(합성 문장)를
생성 프로파일 ml-worker에 **묶음 번호 순서 · 직렬 1건씩** 보내고(설계서 §16.3과 같은 규약, 미분류 제외),
응답 지연과 이름 검사 통과 여부를 기록한다. **동작 확인 전용 — 이름 품질·지연 판정 근거가 아니다**
(§16.6: 판정은 운영 vLLM, No.17 소관 모델 채택 후).

이름 검사는 API `lib/name-sanitize.ts`(§16.5)의 근사다(길이 2~30 · 한글 50% 이상 · `*`·대괄호·URL·`@` 없음).
금지어·PII 검사는 API 쪽 책임이라 여기서는 하지 않는다.

사용법(venv 안에서):
    # 1) 생성 프로파일 ml-worker 기동(예: Ollama)
    #    ML_WORKER_ROLE=augment GENERATION_BACKEND=ollama ML_WORKER_PORT=8101 python -m ml_worker.app
    # 2) 묶음 덤프는 apps/api 측정 도구에서(--dump-clusters clusters.json)
    python eval/cluster_label_check.py --clusters clusters.json --url http://127.0.0.1:8101 [--report out.md]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

import httpx


def check_name(name: str | None) -> str:
    """API name-sanitize 근사 — 통과하면 'OK', 아니면 사유."""
    if not name:
        return "NULL"
    n = name.strip()
    if not 2 <= len(n) <= 30:
        return "LENGTH"
    hangul = sum(1 for ch in n if "가" <= ch <= "힣")
    letters = sum(1 for ch in n if ch.isalpha())
    if letters == 0 or hangul / max(1, len(n.replace(" ", ""))) < 0.5:
        return "NOT_KOREAN"
    if re.search(r"[*\[\]@]|https?://", n):
        return "FORBIDDEN_CHAR"
    return "OK"


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):  # Windows 콘솔(cp949)에서 한글·기호 출력 보호
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--clusters", required=True)
    parser.add_argument("--url", default="http://127.0.0.1:8101")
    parser.add_argument("--timeout", type=float, default=30.0, help="호출 1회 시간 제한(초, API 기본 30)")
    parser.add_argument("--limit", type=int, default=0, help="앞에서 N개 묶음만(0=전부)")
    parser.add_argument("--report", default=None)
    args = parser.parse_args()

    data = json.loads(Path(args.clusters).read_text(encoding="utf-8"))
    clusters = [c for c in data["clusters"] if not c["unassigned"]]
    if args.limit:
        clusters = clusters[: args.limit]

    rows: list[str] = []
    latencies: list[float] = []
    ok = null = bad = 0
    model_id = "?"
    t_all = time.time()
    with httpx.Client(timeout=args.timeout) as client:
        for c in clusters:
            body = {"keywords": c["keywords"][:20] or ["문의"], "samples": c["samples"][:5], "locale": "ko"}
            t0 = time.time()
            try:
                res = client.post(f"{args.url}/cluster-label", json=body)
                res.raise_for_status()
                out = res.json()
                model_id = out.get("modelId", model_id)
                label = out.get("label")
            except Exception as exc:  # noqa: BLE001
                label = None
                print(f"묶음 {c['ordinal']} 호출 실패: {type(exc).__name__}")
            sec = time.time() - t0
            latencies.append(sec)
            verdict = check_name(label)
            ok += verdict == "OK"
            null += verdict == "NULL"
            bad += verdict not in ("OK", "NULL")
            rows.append(f"| {c['ordinal']} | {c['size']} | {' · '.join(c['keywords'][:3]) or '-'} | {label or '-'} | {verdict} | {sec:.1f} |")

    total = time.time() - t_all
    latencies_sorted = sorted(latencies)
    p50 = latencies_sorted[len(latencies_sorted) // 2] if latencies_sorted else 0.0
    lines = [
        f"# 묶음 이름 제안 동작 확인 — modelId `{model_id}`",
        "",
        f"- 묶음 {len(clusters)}개(미분류 제외) · 직렬 호출 · 호출 시간 제한 {args.timeout:.0f}초",
        f"- 결과: 이름 검사 통과 **{ok}** · 이름 없음(null) {null} · 검사 탈락 {bad}",
        f"- 지연(초): 합계 **{total:.1f}** · 호출당 p50 {p50:.1f} · 최대 {max(latencies, default=0):.1f}",
        "- **동작 확인 전용 — 이름 품질·지연 판정 근거 아님**(§16.6).",
        "",
        "| 묶음 | 발화 수 | 상위 키워드 | 제안 이름(합성 데이터) | 검사 | 지연(초) |",
        "|---|---|---|---|---|---|",
        *rows,
    ]
    text = "\n".join(lines) + "\n"
    if args.report:
        Path(args.report).write_text(text, encoding="utf-8")
        print(f"보고서: {args.report}")
    else:
        print(text)


if __name__ == "__main__":
    main()
