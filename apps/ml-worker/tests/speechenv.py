"""No.32 음성 인식 시험 공용 도우미 — speech 역할 앱을 mock 백엔드로 띄우고, 합성 오디오를 메모리에서 만든다.

실제 모델·GPU·네트워크 없이 계약만 검증한다. 오디오는 전부 BytesIO(디스크 0)로 만든다.
"""
from __future__ import annotations

import contextlib
import io
import os
import wave

import numpy as np
from fastapi.testclient import TestClient

import appenv

STT_ENV_KEYS = (
    "STT_BACKEND",
    "STT_MODEL_ID",
    "STT_MODEL_DIR",
    "STT_DEVICE",
    "STT_COMPUTE_TYPE",
    "STT_BEAM_SIZE",
    "STT_CPU_THREADS",
    "STT_MAX_CONCURRENCY",
    "STT_MAX_AUDIO_BYTES",
    "STT_MAX_AUDIO_SECONDS",
    "STT_DEADLINE_S",
    "STT_VAD",
)


def configure_speech(role: str = "speech", **env: str) -> None:
    """STT_* 키를 모두 지운 뒤 role과 추가 환경변수를 설정하고 config·app을 reload한다."""
    for key in STT_ENV_KEYS:
        os.environ.pop(key, None)
    appenv.configure(role, **env)


@contextlib.contextmanager
def speech_client(role: str = "speech", **env: str):
    """lifespan(기동 검사·적재)까지 실행하는 TestClient. 끝나면 기본(embed) 구성으로 되돌린다."""
    configure_speech(role, **env)
    try:
        with TestClient(appenv.app_module.app) as client:
            yield client
    finally:
        for key in STT_ENV_KEYS:
            os.environ.pop(key, None)
        appenv.reset_env()


def tone(seconds: float, amp: float = 0.3, freq: float = 440.0, rate: int = 16000) -> np.ndarray:
    t = np.arange(int(seconds * rate)) / rate
    return (amp * np.sin(2 * np.pi * freq * t)).astype(np.float32)


def silence(seconds: float, rate: int = 16000) -> np.ndarray:
    return np.zeros(int(seconds * rate), dtype=np.float32)


def make_wav(samples: np.ndarray, rate: int = 16000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes((np.clip(samples, -1, 1) * 32767).astype(np.int16).tobytes())
    return buf.getvalue()


def make_container(samples: np.ndarray, fmt: str, codec: str, rate: int = 48000) -> bytes:
    """PyAV로 메모리에서 webm/ogg/mp4 컨테이너를 만든다(브라우저 MediaRecorder 산출물 흉내)."""
    import av

    pcm = (np.clip(samples, -1, 1) * 32767).astype(np.int16)
    # 16kHz 원본을 코덱 표본률로 리샘플
    src = av.AudioFrame.from_ndarray(pcm.reshape(1, -1), format="s16", layout="mono")
    src.sample_rate = 16000
    resampler = av.AudioResampler(format="fltp" if codec in ("aac",) else "s16", layout="mono", rate=rate)
    buf = io.BytesIO()
    options = {"movflags": "frag_keyframe+empty_moov+default_base_moof"} if fmt == "mp4" else {}
    out = av.open(buf, mode="w", format=fmt, options=options)
    try:
        stream = out.add_stream(codec, rate=rate)
        stream.layout = "mono"
        frames = list(resampler.resample(src)) + list(resampler.resample(None))
        # 인코더 프레임 크기에 맞춰 재분할
        fifo = av.AudioFifo()
        for fr in frames:
            fifo.write(fr)
        size = stream.codec_context.frame_size or 960
        pts = 0
        while fifo.samples >= size:
            fr = fifo.read(size)
            fr.pts = pts
            pts += size
            for pkt in stream.encode(fr):
                out.mux(pkt)
        rest = fifo.read(fifo.samples) if fifo.samples else None
        if rest is not None:
            rest.pts = pts
            for pkt in stream.encode(rest):
                out.mux(pkt)
        for pkt in stream.encode(None):
            out.mux(pkt)
    finally:
        out.close()
    return buf.getvalue()


def speech_like(seconds: float = 1.0) -> np.ndarray:
    """무음 0.3초 + 톤 + 무음 0.3초 — VAD가 가운데만 남기는 합성 발화."""
    return np.concatenate([silence(0.3), tone(seconds), silence(0.3)])
