"""No.32 STT 후보 실측 스크립트(CI 밖 · 수동 게이트 — 설계서 §8.8).

사용법(venv 안에서):
    python eval/stt_candidates.py --backend mock                                    # 하네스 점검(합성 오디오)
    python eval/stt_candidates.py --model small --device cuda --compute-type int8 --audio-dir <폴더>
    python eval/stt_candidates.py --model large-v3-turbo --device cuda --compute-type float16 --audio-dir <폴더>

--audio-dir에는 오디오 파일(wav/webm/ogg/mp4)과, 선택으로 같은 이름의 `.txt`(정답 전사)를 둔다.
`.txt`가 있으면 글자 오류율(CER)을 함께 계산한다. 모델은 미리 반입돼 있어야 한다(내려받지 않는다).

산출물: eval/report/stt/<slug>.json(+ .md 요약) — 지연 P50/P95, (선택) CER, GPU 메모리 사용(nvidia-smi 있으면).

해석 규칙(설계서 §8.8):
  - RTX 3050 4GB 결과는 **"동작 확인"으로만** 기록한다. CER·지연 수치를 합격 판정에 쓰지 않는다.
  - 합격 판정용 실측은 운영 L40S에서 No.17 생성 실측과 함께 수행한다(CER·10초 발화 P50/P95·동시 N 처리량·
    VRAM 합계·임베딩 P95 영향).
"""
from __future__ import annotations

import argparse
import json
import re
import statistics
import subprocess
import sys
import time
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from ml_worker.speech.decoder import decode_to_pcm16k  # noqa: E402
from ml_worker.speech.limits import Deadline  # noqa: E402
from ml_worker.speech.transcriber import _load_transcriber  # noqa: E402
from ml_worker.speech.vad import load_vad  # noqa: E402


def _edit_distance(a: str, b: str) -> int:
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def _norm(s: str) -> str:
    return re.sub(r"[\s\.,!?]", "", s)


def _gpu_mem_mb() -> int | None:
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=10, check=True,
        ).stdout.strip().splitlines()[0]
        return int(out)
    except Exception:  # noqa: BLE001 — nvidia-smi 없음
        return None


def _synthetic(tmp_files: list[tuple[str, bytes, str | None]]) -> None:
    sys.path.insert(0, str(ROOT / "tests"))
    import speechenv as se

    tmp_files.append(("synthetic-tone-1s.wav", se.make_wav(se.speech_like(1.0)), None))
    tmp_files.append(("synthetic-silence-2s.wav", se.make_wav(se.silence(2.0)), None))


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")  # Windows cp949 콘솔 대비
    ap = argparse.ArgumentParser()
    ap.add_argument("--backend", default="faster-whisper", choices=["mock", "faster-whisper"])
    ap.add_argument("--model", default="")
    ap.add_argument("--device", default="cpu")
    ap.add_argument("--compute-type", default="int8")
    ap.add_argument("--model-dir", default="")
    ap.add_argument("--beam-size", type=int, default=5)
    ap.add_argument("--audio-dir", default="")
    ap.add_argument("--repeat", type=int, default=3)
    args = ap.parse_args()

    cfg = types.SimpleNamespace(
        stt_backend=args.backend, stt_model_id=args.model, stt_model_dir=args.model_dir, stt_device=args.device,
        stt_compute_type=args.compute_type, stt_beam_size=args.beam_size, stt_cpu_threads=0,
        stt_max_concurrency=1, stt_max_audio_bytes=1_048_576, stt_max_audio_seconds=32.0, stt_deadline_s=60.0,
        stt_vad="auto",
    )
    t_load = time.monotonic()
    transcriber = _load_transcriber(cfg)
    vad = load_vad("auto", args.backend)
    load_s = time.monotonic() - t_load
    mem_after_load = _gpu_mem_mb()

    files: list[tuple[str, bytes, str | None]] = []
    if args.audio_dir:
        for p in sorted(Path(args.audio_dir).iterdir()):
            if p.suffix.lower() in (".wav", ".webm", ".ogg", ".mp4", ".m4a"):
                ref = p.with_suffix(".txt")
                files.append((p.name, p.read_bytes(), ref.read_text(encoding="utf-8") if ref.exists() else None))
    else:
        _synthetic(files)

    rows = []
    lat_ms: list[float] = []
    err = ref_chars = 0
    for name, payload, ref in files:
        for _ in range(args.repeat):
            t0 = time.monotonic()
            dl = Deadline(60.0)
            pcm = decode_to_pcm16k(payload, 32.0, dl)
            speech = vad.speech_only(pcm)
            text = transcriber.transcribe(speech, "ko", dl) if speech.shape[0] else ""
            lat_ms.append((time.monotonic() - t0) * 1000)
        row = {"file": name, "durationSec": round(pcm.shape[0] / 16000, 2), "empty": text == ""}
        if ref is not None:
            row["cer"] = round(_edit_distance(_norm(text), _norm(ref)) / max(1, len(_norm(ref))), 4)
            err += _edit_distance(_norm(text), _norm(ref))
            ref_chars += len(_norm(ref))
        rows.append(row)  # 전사 글자는 보고서에 남기지 않는다(개인정보 가능성)

    lat_ms.sort()
    p = lambda q: round(lat_ms[min(len(lat_ms) - 1, int(q * len(lat_ms)))], 1) if lat_ms else None  # noqa: E731
    report = {
        "backend": args.backend, "model": transcriber.model_id, "device": args.device,
        "computeType": args.compute_type, "vad": vad.name, "loadSeconds": round(load_s, 1),
        "gpuMemMbAfterLoad": mem_after_load, "gpuMemMbAfterRun": _gpu_mem_mb(),
        "latencyMsP50": round(statistics.median(lat_ms), 1) if lat_ms else None, "latencyMsP95": p(0.95),
        "cer": round(err / ref_chars, 4) if ref_chars else None, "files": rows,
        "note": "RTX 3050 결과는 '동작 확인'으로만 표기 — 합격 판정은 L40S 운영 실측(No.17과 함께).",
    }
    out_dir = ROOT / "eval" / "report" / "stt"
    out_dir.mkdir(parents=True, exist_ok=True)
    slug = re.sub(r"[^A-Za-z0-9._-]+", "_", f"{args.backend}-{args.model or 'mock'}-{args.device}-{args.compute_type}")
    (out_dir / f"{slug}.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
