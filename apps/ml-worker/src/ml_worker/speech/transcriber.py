"""전사기 포트와 구현 2종(`mock` · `faster-whisper`) — 교체 지점 `_load_transcriber()` 1곳(§8.5, DD-118).

- 한글 숫자 정규화·반복/상투 문장 정리는 하지 않는다(API 후처리 — DD-131). 여기서는 공백 정리만 한다.
- 기동 중 외부 내려받기 0: `local_files_only=True` 고정(설정으로 끌 수 없다). 반입은 scripts/fetch_stt_model.py.
- 조용한 CPU 대체 금지: `STT_DEVICE=cuda` 적재 실패는 기동 실패다.
"""
from __future__ import annotations

import logging
from typing import Any, Protocol

import numpy as np

from ml_worker.speech.limits import Deadline

logger = logging.getLogger("ml_worker")

SAMPLE_RATE = 16000
SUPPORTED_BACKENDS = ("mock", "faster-whisper")
SUPPORTED_DEVICES = ("cpu", "cuda")
SUPPORTED_COMPUTE_TYPES = ("int8", "int8_float16", "float16", "float32")
API_TIMEOUT_S = 10.0  # apps/api SPEECH_STT_TIMEOUT_MS 기본값
MOCK_TEXT = "모의 인식 결과입니다"


class Transcriber(Protocol):
    backend: str
    model_id: str
    device: str
    compute_type: str
    warmed_up: bool

    def transcribe(self, pcm: np.ndarray, language: str, deadline: Deadline) -> str:
        """말소리만 이어 붙인 16kHz 모노 float32 → 글자. 세그먼트 사이마다 `deadline.check()`."""


class MockTranscriber:
    """모델 0 · 결정 글자. 실제 인식이 아니다(운영 API는 이 백엔드를 사용 불가로 본다 — DD-135)."""

    backend = "mock"
    model_id = "mock-stt"
    device = "cpu"
    compute_type = "none"
    warmed_up = True

    def transcribe(self, pcm: np.ndarray, language: str, deadline: Deadline) -> str:
        deadline.check()
        return MOCK_TEXT


class FasterWhisperTranscriber:
    """faster-whisper(CTranslate2) 전사기. 무거운 import는 생성 시점까지 미룬다."""

    backend = "faster-whisper"

    def __init__(
        self,
        model: str,
        device: str,
        compute_type: str,
        cpu_threads: int,
        num_workers: int,
        download_root: str | None,
        beam_size: int,
    ) -> None:
        from faster_whisper import WhisperModel

        self.model_id = model
        self.device = device
        self.compute_type = compute_type
        self.warmed_up = False
        self._beam_size = beam_size
        self._model: Any = WhisperModel(
            model,
            device=device,
            compute_type=compute_type,
            cpu_threads=cpu_threads,
            num_workers=num_workers,
            download_root=download_root,
            local_files_only=True,  # 고정 — 기동 중 내려받기 0
        )

    def _segments(self, pcm: np.ndarray, language: str):
        segments, _info = self._model.transcribe(
            pcm,
            language=language,  # 자동 감지 0
            task="transcribe",
            beam_size=self._beam_size,
            condition_on_previous_text=False,  # 반복 고리 억제
            without_timestamps=True,
            vad_filter=False,  # VAD는 이 프로세스의 vad.py가 이미 적용했다
        )
        return segments

    def warmup(self) -> None:
        for _ in self._segments(np.zeros(SAMPLE_RATE, dtype=np.float32), "ko"):
            pass
        self.warmed_up = True

    def transcribe(self, pcm: np.ndarray, language: str, deadline: Deadline) -> str:
        pieces: list[str] = []
        for segment in self._segments(pcm, language):  # 지연 생성기 — 세그먼트마다 기한 검사
            pieces.append(segment.text)
            deadline.check()
        return " ".join("".join(pieces).split())


def validate_speech_settings(cfg: Any) -> None:
    """설정 오류는 음성 인식 프로세스만 기동 실패(§12.3). 조용한 대체 0."""
    backend = cfg.stt_backend.strip().lower()
    if backend not in SUPPORTED_BACKENDS:
        raise RuntimeError(
            f"알 수 없는 STT_BACKEND 값: '{cfg.stt_backend}' — mock | faster-whisper 중 하나여야 합니다."
        )
    if cfg.stt_device.strip().lower() not in SUPPORTED_DEVICES:
        raise RuntimeError("STT_DEVICE는 cpu | cuda 중 하나여야 합니다.")
    if cfg.stt_compute_type.strip().lower() not in SUPPORTED_COMPUTE_TYPES:
        raise RuntimeError("STT_COMPUTE_TYPE은 int8 | int8_float16 | float16 | float32 중 하나여야 합니다.")
    if not 1 <= cfg.stt_beam_size <= 10:
        raise RuntimeError("STT_BEAM_SIZE는 1~10 범위여야 합니다.")
    if cfg.stt_cpu_threads < 0:
        raise RuntimeError("STT_CPU_THREADS는 0 이상이어야 합니다.")
    if cfg.stt_max_concurrency < 1:
        raise RuntimeError("STT_MAX_CONCURRENCY는 1 이상이어야 합니다.")
    if cfg.stt_max_audio_bytes <= 0 or cfg.stt_max_audio_seconds <= 0 or cfg.stt_deadline_s <= 0:
        raise RuntimeError("STT_MAX_AUDIO_BYTES·STT_MAX_AUDIO_SECONDS·STT_DEADLINE_S는 0보다 커야 합니다.")
    if backend == "faster-whisper" and not cfg.stt_model_id.strip():
        # 기본 모델을 두지 않는다 — 우발적 대형 모델 적재·내려받기 방지
        raise RuntimeError("STT_BACKEND=faster-whisper이면 STT_MODEL_ID가 필요합니다(기본 모델 없음).")
    if cfg.stt_deadline_s > API_TIMEOUT_S - 1:
        logger.warning(
            "STT_DEADLINE_S=%s가 9초보다 깁니다 — API SPEECH_STT_TIMEOUT_MS(기본 10초)보다 길면 "
            "API가 포기한 뒤에도 처리가 계속됩니다. API보다 짧게 맞추세요.",
            cfg.stt_deadline_s,
        )


def _load_transcriber(cfg: Any) -> Transcriber:
    """STT 백엔드 교체 지점 1곳. 설정 검사 → 백엔드 생성 → 워밍업."""
    validate_speech_settings(cfg)
    backend = cfg.stt_backend.strip().lower()
    if backend == "mock":
        logger.warning(
            "STT_BACKEND=mock — mock 전사기: 실제 인식 아님 · 운영 API는 이 프로세스를 사용 불가로 봅니다"
        )
        return MockTranscriber()

    logger.info(
        "STT 모델 적재 시작: %s (device=%s compute=%s) — 로컬 캐시만 사용",
        cfg.stt_model_id,
        cfg.stt_device,
        cfg.stt_compute_type,
    )
    try:
        transcriber = FasterWhisperTranscriber(
            model=cfg.stt_model_id.strip(),
            device=cfg.stt_device.strip().lower(),
            compute_type=cfg.stt_compute_type.strip().lower(),
            cpu_threads=cfg.stt_cpu_threads,
            num_workers=cfg.stt_max_concurrency,
            download_root=cfg.stt_model_dir.strip() or None,
            beam_size=cfg.stt_beam_size,
        )
    except ImportError as exc:
        raise RuntimeError("faster-whisper가 설치되지 않았습니다 — pip install -e \".[speech]\"") from exc
    except Exception as exc:  # noqa: BLE001
        # 모델 없음·CUDA 적재 실패 등 — 조용한 CPU 대체 없이 기동 실패(원인은 예외 연결로 로그에 남는다)
        raise RuntimeError(
            f"STT 모델 적재 실패(model={cfg.stt_model_id}, device={cfg.stt_device}): {type(exc).__name__}"
        ) from exc
    transcriber.warmup()
    logger.info("STT 모델 적재 완료: %s", transcriber.model_id)
    return transcriber
