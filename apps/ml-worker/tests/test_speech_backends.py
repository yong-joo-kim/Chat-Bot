"""No.32 전사기·VAD 단위 시험 — 실제 모델 없이(가짜 WhisperModel) 호출 인자와 기한 검사를 확인한다.

실제 faster-whisper 모델 적재·3050 "동작 확인"은 수동 게이트다(자동 시험에서 모델을 내려받지 않는다).
"""
from __future__ import annotations

import logging
import types

import numpy as np
import pytest

from ml_worker.speech.limits import Deadline, SpeechError
from ml_worker.speech.transcriber import (
    FasterWhisperTranscriber,
    MockTranscriber,
    _load_transcriber,
    validate_speech_settings,
)
from ml_worker.speech.vad import EnergyVad, NoVad, load_vad

SR = 16000


def _cfg(**over):
    base = dict(
        stt_backend="faster-whisper", stt_model_id="fake-small", stt_model_dir="", stt_device="cpu",
        stt_compute_type="int8", stt_beam_size=5, stt_cpu_threads=0, stt_max_concurrency=2,
        stt_max_audio_bytes=1_048_576, stt_max_audio_seconds=32.0, stt_deadline_s=8.0, stt_vad="auto",
    )
    base.update(over)
    return types.SimpleNamespace(**base)


class _Seg:
    def __init__(self, text):
        self.text = text


class _FakeWhisper:
    inits: list = []
    calls: list = []
    segments = ["안녕하세요 ", "반갑습니다"]

    def __init__(self, model, **kw):
        type(self).inits.append((model, kw))

    def transcribe(self, audio, **kw):
        type(self).calls.append((audio, kw))
        return iter([_Seg(t) for t in type(self).segments]), object()


@pytest.fixture
def fake_whisper(monkeypatch):
    faster_whisper = pytest.importorskip("faster_whisper")
    _FakeWhisper.inits, _FakeWhisper.calls = [], []
    _FakeWhisper.segments = ["안녕하세요 ", "반갑습니다"]
    monkeypatch.setattr(faster_whisper, "WhisperModel", _FakeWhisper)
    return _FakeWhisper


def test_faster_whisper_is_built_offline_only_with_designed_arguments(fake_whisper):
    t = _load_transcriber(_cfg(stt_model_dir="D:/models", stt_cpu_threads=4, stt_max_concurrency=3))
    model, kw = fake_whisper.inits[0]
    assert model == "fake-small"
    assert kw["local_files_only"] is True  # 고정 — 기동 중 내려받기 0
    assert kw["download_root"] == "D:/models"
    assert kw["num_workers"] == 3 and kw["cpu_threads"] == 4
    assert kw["device"] == "cpu" and kw["compute_type"] == "int8"
    assert t.warmed_up is True and len(fake_whisper.calls) == 1  # 워밍업 1회
    warm_audio = fake_whisper.calls[0][0]
    assert warm_audio.shape == (SR,) and not warm_audio.any()  # 무음 1초


def test_empty_model_dir_means_none(fake_whisper):
    _load_transcriber(_cfg(stt_model_dir="  "))
    assert fake_whisper.inits[0][1]["download_root"] is None


def test_transcribe_options_follow_design(fake_whisper):
    t = _load_transcriber(_cfg(stt_beam_size=3))
    text = t.transcribe(np.ones(SR, dtype=np.float32) * 0.1, "ko", Deadline(8))
    assert text == "안녕하세요 반갑습니다"
    kw = fake_whisper.calls[-1][1]
    assert kw["language"] == "ko" and kw["task"] == "transcribe"
    assert kw["condition_on_previous_text"] is False
    assert kw["without_timestamps"] is True
    assert kw["beam_size"] == 3
    assert kw["vad_filter"] is False  # VAD는 vad.py가 이미 적용


def test_deadline_is_checked_between_segments(fake_whisper):
    t = _load_transcriber(_cfg())
    with pytest.raises(SpeechError) as ei:
        t.transcribe(np.ones(SR, dtype=np.float32), "ko", Deadline(-1.0))
    assert ei.value.code == "DEADLINE"


def test_model_load_failure_is_startup_failure_without_cpu_fallback(monkeypatch):
    faster_whisper = pytest.importorskip("faster_whisper")

    class Bad:
        def __init__(self, *a, **k):
            raise ValueError("CUDA failed")

    monkeypatch.setattr(faster_whisper, "WhisperModel", Bad)
    with pytest.raises(RuntimeError, match="STT 모델 적재 실패"):
        _load_transcriber(_cfg(stt_device="cuda"))


def test_missing_local_model_fails_fast_without_network():
    """local_files_only=True 이므로 없는 모델은 내려받지 않고 즉시 기동 실패(AC: 기동 중 다운로드 0)."""
    pytest.importorskip("faster_whisper")
    with pytest.raises(RuntimeError, match="STT 모델 적재 실패"):
        _load_transcriber(_cfg(stt_model_id="definitely-not-a-cached-model-xyz"))


def test_mock_backend_needs_no_model_id_and_warns(caplog):
    with caplog.at_level(logging.WARNING, logger="ml_worker"):
        t = _load_transcriber(_cfg(stt_backend="mock", stt_model_id=""))
    assert isinstance(t, MockTranscriber)
    assert any("mock 전사기" in r.getMessage() for r in caplog.records)


def test_validation_rejects_empty_model_id_for_faster_whisper():
    with pytest.raises(RuntimeError, match="STT_MODEL_ID"):
        validate_speech_settings(_cfg(stt_model_id=" "))


# ── VAD ──────────────────────────────────────────────────────────────────────────────────
def _tone(sec, amp=0.3):
    t = np.arange(int(sec * SR)) / SR
    return (amp * np.sin(2 * np.pi * 300 * t)).astype(np.float32)


def test_energy_vad_keeps_only_speech_segments():
    pcm = np.concatenate([np.zeros(SR), _tone(0.5), np.zeros(SR)])
    out = EnergyVad().speech_only(pcm)
    assert 0.45 * SR <= out.shape[0] <= 1.0 * SR  # 말소리 + 앞뒤 여유만
    assert np.abs(out).max() > 0.2


def test_energy_vad_returns_empty_for_silence_and_low_noise():
    assert EnergyVad().speech_only(np.zeros(2 * SR, dtype=np.float32)).shape[0] == 0
    noise = (np.random.default_rng(1).standard_normal(2 * SR) * 0.002).astype(np.float32)
    assert EnergyVad().speech_only(noise).shape[0] == 0


def test_energy_vad_ignores_blips_shorter_than_minimum():
    pcm = np.zeros(SR, dtype=np.float32)
    pcm[8000:8100] = 0.5  # 6ms 잡음
    assert EnergyVad().speech_only(pcm).shape[0] == 0


def test_energy_vad_handles_tiny_input():
    assert EnergyVad().speech_only(np.zeros(10, dtype=np.float32)).shape[0] == 0


def test_load_vad_auto_resolution_and_validation():
    assert load_vad("auto", "mock").name == "energy"
    assert load_vad("off", "mock").name == "off"
    assert isinstance(load_vad("off", "mock"), NoVad)
    with pytest.raises(RuntimeError, match="STT_VAD"):
        load_vad("magic", "mock")


def test_silero_vad_runs_offline_from_bundled_model_and_drops_silence():
    """faster-whisper 동봉 Silero(onnxruntime·CPU) — 별도 모델 반입·내려받기 없이 무음을 걸러낸다."""
    pytest.importorskip("faster_whisper")
    vad = load_vad("auto", "faster-whisper")
    assert vad.name == "silero"
    assert vad.speech_only(np.zeros(2 * SR, dtype=np.float32)).shape[0] == 0
