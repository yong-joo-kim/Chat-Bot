"""No.17 파이프라인 검증(dev-pipeline-validation) — `GENERATION_BACKEND` 환경변수 분기가
`app.py` 기동 경로에서 실제로 갈리는지 검증한다.

- 기본값(`transformers`)에서 기존 mock 경로가 **바이트 단위로 그대로**인지(회귀 없음).
- `GENERATION_BACKEND=ollama`인데 서버가 없으면 mock으로 조용히 대체되지 않고 기동 자체가
  명확한 오류로 실패하는지(C-8/R-5 — "가짜 생성기로 운영될 위험" 통제).

실제 Ollama 서버·모델은 쓰지 않는다(FR-0-258) — 미사용 TCP 포트로 "연결 거부"를
결정론적으로 재현한다.
"""
from __future__ import annotations

import importlib
import os
import socket

import pytest
from fastapi.testclient import TestClient

import ml_worker.app as app_module
import ml_worker.config as config_module

_OLLAMA_KEYS = ("GENERATION_BACKEND", "OLLAMA_BASE_URL", "OLLAMA_MODEL", "OLLAMA_REQUEST_TIMEOUT_S", "OLLAMA_CONNECT_TIMEOUT_S")


def _closed_local_port() -> int:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def _reload() -> None:
    importlib.reload(config_module)
    importlib.reload(app_module)


def teardown_function() -> None:
    for key in ("ML_WORKER_ROLE", "GENERATION_MODEL_ID", "EMBEDDING_MODEL_ID", *_OLLAMA_KEYS):
        os.environ.pop(key, None)
    os.environ["ML_WORKER_ROLE"] = "embed"
    os.environ["EMBEDDING_MODEL_ID"] = "mock"
    _reload()


def test_default_backend_is_transformers_and_unchanged():
    """새 설정을 아무것도 건드리지 않으면 기존 mock 생성기 경로가 그대로다(FR-0-251 계열)."""
    os.environ["ML_WORKER_ROLE"] = "both"
    os.environ["GENERATION_MODEL_ID"] = "mock"
    os.environ["EMBEDDING_MODEL_ID"] = "mock"
    for key in _OLLAMA_KEYS:
        os.environ.pop(key, None)
    _reload()

    assert config_module.settings.generation_backend == "transformers"
    assert config_module.settings.is_ollama_backend is False

    with TestClient(app_module.app) as client:
        res = client.post("/augment", json={"seeds": ["환불 어떻게 하나요"], "targetCount": 3, "locale": "ko"})
        assert res.status_code == 200
        body = res.json()
        assert body["modelId"] == "mock-generator@0"


def test_ollama_backend_boot_fails_clearly_when_server_unreachable():
    """C-8/R-5: mock으로 조용히 대체되지 않고, 기동(lifespan startup)이 명확한 오류로
    실패해야 한다. `GENERATION_MODEL_ID=mock`을 남겨 둬도(레거시 기본값) ollama 백엔드가
    이를 무시하고 실제 연결을 시도한다는 것도 함께 확인한다."""
    port = _closed_local_port()
    os.environ["ML_WORKER_ROLE"] = "augment"
    os.environ["GENERATION_MODEL_ID"] = "mock"  # ollama 백엔드에서는 무시돼야 함(조용한 대체 금지)
    os.environ["EMBEDDING_MODEL_ID"] = "mock"
    os.environ["GENERATION_BACKEND"] = "ollama"
    os.environ["OLLAMA_BASE_URL"] = f"http://127.0.0.1:{port}"
    os.environ["OLLAMA_MODEL"] = "qwen3:4b-instruct-2507-q4_K_M"
    os.environ["OLLAMA_CONNECT_TIMEOUT_S"] = "2"
    _reload()

    assert config_module.settings.is_ollama_backend is True

    with pytest.raises(Exception):
        with TestClient(app_module.app):
            pass
