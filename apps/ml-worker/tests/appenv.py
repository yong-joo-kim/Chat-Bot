"""No.37 앱 수준 시험 공용 도우미 — 환경변수를 설정한 뒤 config·app을 reload한다(기존 시험과 같은 패턴).

`settings`/`app`은 임포트 시점 싱글턴이라 시험마다 reload가 필요하고, 끝나면 기본(embed)으로 되돌린다.
"""
from __future__ import annotations

import importlib
import os

import ml_worker.app as app_module
import ml_worker.config as config_module

GENERATION_ENV_KEYS = (
    "ML_WORKER_ROLE",
    "GENERATION_MODEL_ID",
    "GENERATION_MAX_NEW_TOKENS",
    "GENERATION_BACKEND",
    "GENERATION_TARGET_COUNT_MAX",
    "GENERATION_WARMUP_TIMEOUT_S",
    "GENERATION_BACKEND_ALLOWED_HOSTS",
    "GENERATION_BACKEND_REQUIRE_ALLOWLIST",
    "OLLAMA_BASE_URL",
    "OLLAMA_MODEL",
    "OLLAMA_REQUEST_TIMEOUT_S",
    "OLLAMA_CONNECT_TIMEOUT_S",
    "OLLAMA_MAX_NEW_TOKENS",
    "OLLAMA_TARGET_CAP",
    "VLLM_BASE_URL",
    "VLLM_MODEL",
    "VLLM_API_KEY",
    "VLLM_REQUEST_TIMEOUT_S",
    "VLLM_CONNECT_TIMEOUT_S",
    "VLLM_MAX_NEW_TOKENS",
    "VLLM_TARGET_CAP",
)


def reset_env() -> None:
    for key in GENERATION_ENV_KEYS:
        os.environ.pop(key, None)
    os.environ["ML_WORKER_ROLE"] = "embed"
    os.environ["EMBEDDING_MODEL_ID"] = "mock"
    reload_modules()


def reload_modules() -> None:
    importlib.reload(config_module)
    importlib.reload(app_module)


def configure(role: str = "augment", **env: str) -> None:
    """기본 키를 모두 지운 뒤 role과 추가 환경변수를 설정하고 reload한다."""
    for key in GENERATION_ENV_KEYS:
        os.environ.pop(key, None)
    os.environ["ML_WORKER_ROLE"] = role
    os.environ["EMBEDDING_MODEL_ID"] = "mock"
    for key, value in env.items():
        os.environ[key] = value
    reload_modules()
