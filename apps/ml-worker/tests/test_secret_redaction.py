"""No.37 비밀값(`VLLM_API_KEY`) 노출 0건 시험(ED-8, AC-ED2-2/ED4-3) — 기동·생성·401 오류·시간 초과·
`/augment/health`를 모두 수행하며 caplog 전체, 응답 본문, 기동 실패 예외 메시지, `repr(settings)`에서
키 문자열이 나오지 않아야 한다."""
from __future__ import annotations

import logging

import pytest
from fastapi.testclient import TestClient

import ml_worker.app as app_module
import ml_worker.config as config_module
from appenv import configure, reset_env

KEY = "sk-test-SECRET-9f3a"
BODY = {"seeds": ["환불 어떻게 하나요"], "targetCount": 3, "locale": "ko"}


def teardown_function() -> None:
    reset_env()


def _env(server, **extra):
    env = {
        "GENERATION_BACKEND": "vllm",
        "VLLM_BASE_URL": server.base_url,
        "VLLM_MODEL": "fake-model",
        "VLLM_API_KEY": KEY,
    }
    env.update(extra)
    return env


def test_key_never_appears_in_logs_responses_or_settings_repr(fake_backend, caplog):
    fake_backend.required_key = KEY
    configure("augment", **_env(fake_backend, VLLM_REQUEST_TIMEOUT_S="1"))
    texts: list[str] = []
    with caplog.at_level(logging.DEBUG):
        with TestClient(app_module.app) as client:
            texts.append(client.post("/augment", json=BODY).text)
            texts.append(client.get("/augment/health").text)
            fake_backend.status = 500
            texts.append(client.post("/augment", json=BODY).text)
            fake_backend.status = 200
            fake_backend.delay_s = 3
            texts.append(client.post("/augment", json=BODY).text)
            # 키 자체가 서버 상태에서 바뀌어 401이 나는 경우
            fake_backend.delay_s = 0
            fake_backend.required_key = "other"
            texts.append(client.post("/augment", json=BODY).text)

    for text in texts:
        assert KEY not in text
    assert KEY not in caplog.text
    assert KEY not in repr(config_module.settings)
    assert KEY not in str(config_module.settings.model_dump())
    assert "**********" in repr(config_module.settings)


def test_key_not_in_boot_failure_messages(fake_backend):
    fake_backend.required_key = "other"  # 서버가 키를 거부 -> /v1/models 401로 기동 실패
    configure("augment", **_env(fake_backend))
    with pytest.raises(RuntimeError) as exc:
        with TestClient(app_module.app):
            pass
    assert KEY not in str(exc.value) and "401" in str(exc.value)

    fake_backend.required_key = None
    fake_backend.models = []
    configure("augment", **_env(fake_backend))
    with pytest.raises(RuntimeError) as exc2:
        with TestClient(app_module.app):
            pass
    assert KEY not in str(exc2.value)


def test_empty_key_sends_no_authorization_header(fake_backend):
    configure("augment", **_env(fake_backend, VLLM_API_KEY=""))
    with TestClient(app_module.app):
        pass
    assert fake_backend.requests
    assert all("Authorization" not in r["headers"] for r in fake_backend.requests)
