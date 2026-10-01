"""No.32 speech 역할 계약 시험(mock 백엔드 — 모델·GPU·네트워크 없음). 설계서 §8·§15.2 ml-worker 행.

PyAV가 필요한 시험은 선택 의존성([speech])이 없으면 건너뛴다(기본 설치의 기존 시험은 영향 없음).
"""
from __future__ import annotations

import logging
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest

pytest.importorskip("av")

import appenv  # noqa: E402
import speechenv as se  # noqa: E402
from ml_worker.speech.limits import Deadline, SpeechError  # noqa: E402
from ml_worker.speech.transcriber import MOCK_TEXT  # noqa: E402

AUDIO = {"content-type": "application/octet-stream"}


@pytest.fixture(autouse=True)
def _restore_env():
    yield
    import os

    for key in se.STT_ENV_KEYS:
        os.environ.pop(key, None)
    appenv.reset_env()


# ── 계약 ──────────────────────────────────────────────────────────────────────────────
def test_transcribe_wav_returns_contract_shape():
    with se.speech_client(STT_BACKEND="mock") as c:
        r = c.post("/speech/transcribe", content=se.make_wav(se.speech_like(1.0)), headers=AUDIO)
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"modelId", "text", "durationMs", "empty"}
    assert body["modelId"] == "mock-stt"
    assert body["text"] == MOCK_TEXT
    assert body["empty"] is False
    assert abs(body["durationMs"] - 1600) <= 40  # 디코딩된 녹음 전체 길이(H-9)


@pytest.mark.parametrize(
    "fmt,codec",
    [("webm", "libopus"), ("ogg", "libopus"), ("mp4", "aac")],
    ids=["webm-opus", "ogg-opus", "mp4-aac-fragmented"],
)
def test_browser_container_formats_decode_in_memory(fmt, codec):
    """AC-VO5-4 ① — MediaRecorder 산출물(Chrome/Firefox WebM·Ogg, Safari 조각형 MP4)을 BytesIO로 디코딩."""
    try:
        payload = se.make_container(se.speech_like(1.0), fmt, codec)
    except Exception as exc:  # noqa: BLE001 — 이 PyAV 빌드에 인코더가 없으면 표본을 못 만든다
        pytest.skip(f"합성 표본 생성 불가({fmt}/{codec}): {type(exc).__name__}")
    with se.speech_client() as c:
        r = c.post("/speech/transcribe", content=payload, headers=AUDIO)
    assert r.status_code == 200, r.text
    assert r.json()["empty"] is False
    assert abs(r.json()["durationMs"] - 1600) <= 80


def test_silence_returns_empty_without_calling_transcriber():
    with se.speech_client() as c:
        calls: list[int] = []
        real = appenv.app_module._transcriber

        class Spy:
            backend, model_id, device, compute_type, warmed_up = real.backend, real.model_id, "cpu", "none", True

            def transcribe(self, pcm, language, deadline):
                calls.append(1)
                return "x"

        appenv.app_module._transcriber = Spy()
        r = c.post("/speech/transcribe", content=se.make_wav(se.silence(2.0)), headers=AUDIO)
    assert r.status_code == 200
    assert r.json() == {"modelId": "mock-stt", "text": "", "durationMs": 2000, "empty": True}
    assert calls == []  # STT 호출 0 (VAD가 말소리 0 구간으로 판정)


def test_transcriber_blank_result_is_empty():
    with se.speech_client() as c:
        real = appenv.app_module._transcriber

        class Blank:
            backend, model_id, device, compute_type, warmed_up = real.backend, real.model_id, "cpu", "none", True

            def transcribe(self, pcm, language, deadline):
                return "  \n "

        appenv.app_module._transcriber = Blank()
        r = c.post("/speech/transcribe", content=se.make_wav(se.speech_like()), headers=AUDIO)
    assert r.status_code == 200
    assert r.json()["text"] == "" and r.json()["empty"] is True


def test_transcriber_whitespace_is_normalized_but_nothing_else():
    """공백 정리만 한다 — 한글 숫자 정규화·반복/상투 문장 정리는 API 후처리(DD-131)."""
    with se.speech_client() as c:
        real = appenv.app_module._transcriber

        class Talk:
            backend, model_id, device, compute_type, warmed_up = real.backend, real.model_id, "cpu", "none", True

            def transcribe(self, pcm, language, deadline):
                return " 구공공일일이   다시 \n일이삼사오육칠 "

        appenv.app_module._transcriber = Talk()
        r = c.post("/speech/transcribe", content=se.make_wav(se.speech_like()), headers=AUDIO)
    assert r.json()["text"] == "구공공일일이 다시 일이삼사오육칠"


@pytest.mark.parametrize(
    "payload",
    [b"", b"not audio at all", b"\x00" * 2048, b"RIFF" + b"\x00" * 40],
    ids=["empty", "text", "zeros", "broken-riff"],
)
def test_invalid_audio_is_400_with_code_only(payload):
    with se.speech_client() as c:
        r = c.post("/speech/transcribe", content=payload, headers=AUDIO)
    assert r.status_code == 400
    assert r.json() == {"detail": "INVALID"}  # 코드 문자열만 — 입력·예외 메시지 에코 0


def test_truncated_audio_does_not_leak_message():
    wav = se.make_wav(se.speech_like())
    with se.speech_client() as c:
        r = c.post("/speech/transcribe", content=wav[:30], headers=AUDIO)
    assert r.status_code == 400
    assert r.json() == {"detail": "INVALID"}


def test_health_reports_actual_loaded_values():
    with se.speech_client(STT_MAX_CONCURRENCY="3", STT_MAX_AUDIO_SECONDS="20") as c:
        r = c.get("/speech/health")
    assert r.status_code == 200
    assert r.json() == {
        "status": "ok",
        "backend": "mock",  # 운영 API가 이 값을 읽어 mock을 사용 불가로 판정한다(DD-135 ③)
        "modelId": "mock-stt",
        "device": "cpu",
        "computeType": "none",
        "vad": "energy",
        "maxConcurrency": 3,
        "maxAudioSeconds": 20.0,
        "warmedUp": True,
    }


# ── 한도: 크기 · 길이 · 기한 ─────────────────────────────────────────────────────────────
def test_content_length_over_cap_is_413_before_reading_body():
    with se.speech_client(STT_MAX_AUDIO_BYTES="1000") as c:
        r = c.post("/speech/transcribe", content=b"\x00" * 1001, headers=AUDIO)
    assert r.status_code == 413
    assert r.json() == {"detail": "TOO_LARGE"}


def test_chunked_stream_without_content_length_is_capped():
    def chunks():
        for _ in range(20):
            yield b"\x01" * 100  # 합계 2000 > 1000, Content-Length 없음(chunked)

    with se.speech_client(STT_MAX_AUDIO_BYTES="1000") as c:
        r = c.post("/speech/transcribe", content=chunks(), headers=AUDIO)
    assert r.status_code == 413
    assert r.json() == {"detail": "TOO_LARGE"}


def test_body_exactly_at_cap_is_accepted_up_to_decoder():
    wav = se.make_wav(se.speech_like(0.5))
    with se.speech_client(STT_MAX_AUDIO_BYTES=str(len(wav))) as c:
        assert c.post("/speech/transcribe", content=wav, headers=AUDIO).status_code == 200
        assert c.post("/speech/transcribe", content=wav + b"\x00", headers=AUDIO).status_code == 413


def test_audio_longer_than_max_seconds_is_too_long():
    with se.speech_client(STT_MAX_AUDIO_SECONDS="2") as c:
        r = c.post("/speech/transcribe", content=se.make_wav(se.tone(3.0)), headers=AUDIO)
        ok = c.post("/speech/transcribe", content=se.make_wav(se.tone(1.5)), headers=AUDIO)
    assert r.status_code == 413
    assert r.json() == {"detail": "TOO_LONG"}
    assert ok.status_code == 200


def test_deadline_exceeded_while_decoding_is_504():
    with se.speech_client() as c:
        appenv.app_module.settings.stt_deadline_s = -1.0  # 이미 만료된 기한(기동 검사 이후 주입)
        r = c.post("/speech/transcribe", content=se.make_wav(se.speech_like()), headers=AUDIO)
    assert r.status_code == 504
    assert r.json() == {"detail": "DEADLINE"}


def test_deadline_raised_by_transcriber_between_segments_is_504():
    with se.speech_client() as c:
        real = appenv.app_module._transcriber

        class Slow:
            backend, model_id, device, compute_type, warmed_up = real.backend, real.model_id, "cpu", "none", True

            def transcribe(self, pcm, language, deadline):
                Deadline(-1.0).check()  # 세그먼트 사이 검사가 만료를 발견한 상황
                return "x"

        appenv.app_module._transcriber = Slow()
        r = c.post("/speech/transcribe", content=se.make_wav(se.speech_like()), headers=AUDIO)
    assert r.status_code == 504 and r.json() == {"detail": "DEADLINE"}


def test_unexpected_transcriber_failure_is_500_without_message(caplog):
    with se.speech_client() as c:
        real = appenv.app_module._transcriber

        class Boom:
            backend, model_id, device, compute_type, warmed_up = real.backend, real.model_id, "cpu", "none", True

            def transcribe(self, pcm, language, deadline):
                raise ValueError("민감한 전사 문장이 예외 메시지에 들어 있음")

        appenv.app_module._transcriber = Boom()
        with caplog.at_level(logging.INFO, logger="ml_worker"):
            r = c.post("/speech/transcribe", content=se.make_wav(se.speech_like()), headers=AUDIO)
    assert r.status_code == 500
    assert r.json() == {"detail": "FAILED"}
    assert "민감한" not in caplog.text and "민감한" not in r.text


def test_logs_have_no_content_only_bytes_code_and_ms(caplog):
    with se.speech_client() as c:
        with caplog.at_level(logging.INFO, logger="ml_worker"):
            c.post("/speech/transcribe", content=se.make_wav(se.speech_like()), headers=AUDIO)
    lines = [rec.getMessage() for rec in caplog.records if "speech/transcribe" in rec.getMessage()]
    assert len(lines) == 1
    assert "bytes=" in lines[0] and "결과=OK" in lines[0] and "처리ms=" in lines[0]
    assert MOCK_TEXT not in caplog.text


# ── 동시 처리: 대기 없는 세마포어 ──────────────────────────────────────────────────────────
class _Blocking:
    backend, model_id, device, compute_type, warmed_up = "mock", "block", "cpu", "none", True

    def __init__(self) -> None:
        self.release = threading.Event()
        self.entered = threading.Semaphore(0)

    def transcribe(self, pcm, language, deadline):
        self.entered.release()
        assert self.release.wait(10)
        return "ok"


def test_over_capacity_is_immediate_503_and_slots_are_freed():
    wav = se.make_wav(se.speech_like(0.5))
    with se.speech_client(STT_MAX_CONCURRENCY="2") as c:
        blocker = _Blocking()
        appenv.app_module._transcriber = blocker
        with ThreadPoolExecutor(max_workers=4) as pool:
            first = [pool.submit(c.post, "/speech/transcribe", content=wav, headers=AUDIO) for _ in range(2)]
            for _ in range(2):
                assert blocker.entered.acquire(timeout=10)  # 두 슬롯 모두 점유
            import time

            t0 = time.monotonic()
            third = c.post("/speech/transcribe", content=wav, headers=AUDIO)
            elapsed = time.monotonic() - t0
            assert third.status_code == 503 and third.json() == {"detail": "BUSY"}
            assert elapsed < 1.0  # 대기 없이 즉시 거절
            # 점유 중에도 /speech/health는 응답한다(이벤트 루프를 막지 않는다)
            assert c.get("/speech/health").status_code == 200
            blocker.release.set()
            assert [f.result(timeout=10).status_code for f in first] == [200, 200]
        # 해제 뒤에는 다시 받는다
        assert c.post("/speech/transcribe", content=wav, headers=AUDIO).status_code == 200


def test_slot_is_released_after_decode_error():
    with se.speech_client(STT_MAX_CONCURRENCY="1") as c:
        for _ in range(3):  # 슬롯이 새면 두 번째부터 503
            assert c.post("/speech/transcribe", content=b"garbage", headers=AUDIO).status_code == 400
        assert c.post("/speech/transcribe", content=se.make_wav(se.speech_like()), headers=AUDIO).status_code == 200


# ── 역할 격리(VO-16) · 기동 검사 ────────────────────────────────────────────────────────────
@pytest.mark.parametrize("role", ["embed", "augment", "both"])
def test_speech_routes_do_not_exist_outside_speech_role(role):
    appenv.configure(role, GENERATION_MODEL_ID="mock")
    from fastapi.testclient import TestClient

    with TestClient(appenv.app_module.app) as c:
        assert c.post("/speech/transcribe", content=b"x").status_code == 404
        assert c.get("/speech/health").status_code == 404


def test_speech_role_exposes_only_embed_health_contract_and_no_generation_routes():
    with se.speech_client() as c:
        assert c.post("/augment", json={"seeds": ["a"], "targetCount": 1, "locale": "ko"}).status_code == 404
        assert c.post("/cluster-label", json={"keywords": ["a"], "samples": [], "locale": "ko"}).status_code == 404
        assert c.get("/augment/health").status_code == 404
        # 임베딩은 적재하지 않는다 — 역할 무관 계약 경로는 loading/503(K-12)
        h = c.get("/health")
        assert h.status_code == 200 and h.json()["status"] == "loading"
        assert c.post("/embed", json={"texts": ["안녕"], "kind": "QUERY"}).status_code == 503
        assert appenv.app_module._embedder is None and appenv.app_module._generator is None


def test_embed_role_does_not_import_speech_dependencies():
    """기본 설치(embed)는 av·faster-whisper 없이도 동작해야 한다 — 지연 import 확인(별도 프로세스)."""
    import os
    import subprocess
    import sys

    code = (
        "import sys, ml_worker.app;"
        "bad=[m for m in ('av','faster_whisper','ctranslate2','ml_worker.speech.routes') if m in sys.modules];"
        "sys.exit(1 if bad else 0)"
    )
    env = {**os.environ, "ML_WORKER_ROLE": "embed", "EMBEDDING_MODEL_ID": "mock"}
    assert subprocess.run([sys.executable, "-c", code], env=env, check=False).returncode == 0


def test_speech_with_mock_backend_warns_once_at_startup(caplog):
    with caplog.at_level(logging.WARNING, logger="ml_worker"):
        with se.speech_client():
            pass
    warns = [r for r in caplog.records if "mock 전사기" in r.getMessage()]
    assert len(warns) == 1
    assert "운영 API는 이 프로세스를 사용 불가" in warns[0].getMessage()


def test_unknown_role_fails_startup():
    from fastapi.testclient import TestClient

    appenv.configure("speeches", EMBEDDING_MODEL_ID="mock")
    with pytest.raises(RuntimeError, match="ML_WORKER_ROLE"):
        with TestClient(appenv.app_module.app):
            pass


@pytest.mark.parametrize(
    "env,match",
    [
        ({"STT_BACKEND": "whisper"}, "STT_BACKEND"),
        ({"STT_BACKEND": "faster-whisper"}, "STT_MODEL_ID"),  # 기본 모델 없음
        ({"STT_DEVICE": "gpu"}, "STT_DEVICE"),
        ({"STT_COMPUTE_TYPE": "int4"}, "STT_COMPUTE_TYPE"),
        ({"STT_BEAM_SIZE": "0"}, "STT_BEAM_SIZE"),
        ({"STT_MAX_CONCURRENCY": "0"}, "STT_MAX_CONCURRENCY"),
        ({"STT_DEADLINE_S": "0"}, "STT_DEADLINE_S"),
        ({"STT_VAD": "magic"}, "STT_VAD"),
    ],
)
def test_bad_speech_settings_fail_startup_only_for_speech_role(env, match):
    from fastapi.testclient import TestClient

    appenv.reset_env()
    with pytest.raises(RuntimeError, match=match):
        with se.speech_client(**env):
            pass
    # 같은 값이 있어도 다른 역할(embed)은 영향이 없다(NFR-EDR2)
    appenv.configure("embed", **env)
    with TestClient(appenv.app_module.app) as c:
        assert c.get("/health").status_code == 200


def test_deadline_above_nine_seconds_warns(caplog):
    with caplog.at_level(logging.WARNING, logger="ml_worker"):
        with se.speech_client(STT_DEADLINE_S="9.5"):
            pass
    assert any("STT_DEADLINE_S" in r.getMessage() for r in caplog.records)


def test_speech_error_is_code_only():
    err = SpeechError("BUSY", 503)
    assert err.code == "BUSY" and str(err) == "BUSY"
