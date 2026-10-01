"""M-5 디코더 외부 참조 형식 거절, L-7 Silero 세션 동시 호출 시험."""
from __future__ import annotations

import threading

import numpy as np
import pytest

pytest.importorskip("av")

from ml_worker.speech.limits import Deadline, SpeechError  # noqa: E402
from ml_worker.speech.decoder import decode_to_pcm16k  # noqa: E402

HLS = b"#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:1,\nfile:///etc/passwd\n#EXT-X-ENDLIST\n"
HLS_HTTP = b"#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:1,\nhttp://127.0.0.1:9/x.ts\n#EXT-X-ENDLIST\n"
CONCAT = b"ffconcat version 1.0\nfile '/etc/passwd'\n"
DATA_URI = b"data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA="


@pytest.mark.parametrize("payload", [HLS, HLS_HTTP, CONCAT, DATA_URI], ids=["hls-file", "hls-http", "concat", "data-uri"])
def test_external_reference_formats_are_rejected_as_invalid(payload):
    with pytest.raises(SpeechError) as ei:
        decode_to_pcm16k(payload, 30.0, Deadline(5.0))
    assert ei.value.code == "INVALID"


def test_disallowed_demuxer_name_is_rejected(monkeypatch):
    """허용 목록에 없는 형식 이름은 열렸더라도 INVALID — 목록을 비우면 정상 WAV도 거절된다."""
    import ml_worker.speech.decoder as dec
    from tests import speechenv as se  # type: ignore

    wav = se.make_container(se.tone(0.5), "wav", "pcm_s16le", rate=16000)
    assert decode_to_pcm16k(wav, 30.0, Deadline(5.0)).shape[0] > 0
    monkeypatch.setattr(dec, "_ALLOWED_DEMUXERS", frozenset({"ogg"}))
    with pytest.raises(SpeechError):
        decode_to_pcm16k(wav, 30.0, Deadline(5.0))


def test_silero_vad_is_safe_for_concurrent_calls():
    """L-7 — 상태(h·c)가 호출별 지역 변수라 세션 공유가 안전하다. 동시 호출 결과가 단독 결과와 같다."""
    pytest.importorskip("faster_whisper")
    from ml_worker.speech.vad import load_vad

    vad = load_vad("silero", "faster-whisper")
    rng = np.random.default_rng(0)
    a = (rng.standard_normal(16000 * 3) * 0.1).astype(np.float32)
    b = np.zeros(16000 * 3, dtype=np.float32)
    expected = [vad.speech_only(a.copy()).shape[0], vad.speech_only(b.copy()).shape[0]]
    results: list = [None] * 8
    errors: list = []

    def run(i: int) -> None:
        try:
            src = a if i % 2 == 0 else b
            for _ in range(5):
                n = vad.speech_only(src.copy()).shape[0]
                assert n == expected[i % 2]
            results[i] = True
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)

    threads = [threading.Thread(target=run, args=(i,)) for i in range(8)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert not errors and all(results)
