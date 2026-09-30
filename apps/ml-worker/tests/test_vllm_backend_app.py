"""No.37 vLLM 백엔드 앱 수준 시험 — 127.0.0.1 임시 포트의 가짜 vLLM 서버(conftest `fake_backend`).
기동 실패 조건, `/augment`·`/augment/health` 표기, 시간 초과 후 다음 요청 처리를 검증한다
(AC-ED2-1~4, AC-ED3-3/4, AC-ED4-1/2, NFR-EDR2)."""
from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

import ml_worker.app as app_module
import ml_worker.config as config_module
from appenv import configure, reset_env

SEED_BODY = {"seeds": ["환불 어떻게 하나요"], "targetCount": 3, "locale": "ko"}


def teardown_function() -> None:
    reset_env()


def _vllm_env(server, **extra):
    env = {"GENERATION_BACKEND": "vllm", "VLLM_BASE_URL": server.base_url, "VLLM_MODEL": "fake-model"}
    env.update(extra)
    return env


def test_vllm_boot_augment_and_health(fake_backend):
    configure("augment", **_vllm_env(fake_backend))
    with TestClient(app_module.app) as client:
        res = client.post("/augment", json=SEED_BODY)
        assert res.status_code == 200
        body = res.json()
        assert body["modelId"] == "vllm:fake-model"
        assert body["candidates"] == ["문장 하나", "문장 둘"]

        health = client.get("/augment/health").json()
        assert health["status"] == "ok"
        assert health["backend"] == "vllm"
        assert health["profile"] == "standard"
        assert health["device"] == "external"
        assert health["targetCap"] == 60
        assert health["warmedUp"] is True
        assert health["modelId"] == "vllm:fake-model"


def test_missing_base_url_or_model_fails_boot(fake_backend):
    configure("augment", GENERATION_BACKEND="vllm", VLLM_MODEL="m")
    with pytest.raises(RuntimeError, match="VLLM_BASE_URL"):
        with TestClient(app_module.app):
            pass
    configure("augment", GENERATION_BACKEND="vllm", VLLM_BASE_URL=fake_backend.base_url)
    with pytest.raises(RuntimeError, match="VLLM_MODEL"):
        with TestClient(app_module.app):
            pass


def test_base_url_ending_with_v1_fails_boot(fake_backend):
    configure("augment", **_vllm_env(fake_backend, VLLM_BASE_URL=fake_backend.base_url + "/v1"))
    with pytest.raises(RuntimeError, match="/v1"):
        with TestClient(app_module.app):
            pass


def test_model_missing_fails_boot(fake_backend):
    fake_backend.models = []
    configure("augment", **_vllm_env(fake_backend))
    with pytest.raises(RuntimeError, match="제공하지 않습니다"):
        with TestClient(app_module.app):
            pass


def test_unreachable_server_fails_boot():
    import socket

    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    configure(
        "augment",
        GENERATION_BACKEND="vllm",
        VLLM_BASE_URL=f"http://127.0.0.1:{port}",
        VLLM_MODEL="m",
        VLLM_CONNECT_TIMEOUT_S="1",
    )
    with pytest.raises(RuntimeError, match="연결할 수 없습니다"):
        with TestClient(app_module.app):
            pass


def test_redirecting_server_fails_boot(fake_backend):
    fake_backend.redirect_to = "http://8.8.8.8/v1/models"
    configure("augment", **_vllm_env(fake_backend))
    with pytest.raises(RuntimeError, match="리다이렉트"):
        with TestClient(app_module.app):
            pass
    assert all(r["path"] != "/v1/chat/completions" for r in fake_backend.requests)


def test_unknown_backend_fails_generation_process_only():
    configure("augment", GENERATION_BACKEND="vlm")
    with pytest.raises(RuntimeError, match="알 수 없는 GENERATION_BACKEND"):
        with TestClient(app_module.app):
            pass
    # NFR-EDR2: 같은 값이어도 임베딩 전용 프로세스는 정상 기동한다.
    configure("embed", GENERATION_BACKEND="vlm")
    with TestClient(app_module.app) as client:
        assert client.get("/health").status_code == 200


def test_backend_value_is_case_and_space_insensitive(fake_backend):
    configure("augment", **_vllm_env(fake_backend, GENERATION_BACKEND=" VLLM "))
    with TestClient(app_module.app) as client:
        assert client.get("/augment/health").json()["backend"] == "vllm"


def test_public_address_fails_before_any_connection():
    configure("augment", GENERATION_BACKEND="vllm", VLLM_BASE_URL="http://8.8.8.8:9", VLLM_MODEL="m")
    with pytest.raises(RuntimeError, match="GENERATION_BACKEND_ALLOWED_HOSTS"):
        with TestClient(app_module.app):
            pass


def test_require_allowlist_blocks_loopback_unless_listed(fake_backend):
    configure("augment", **_vllm_env(fake_backend, GENERATION_BACKEND_REQUIRE_ALLOWLIST="true"))
    with pytest.raises(RuntimeError, match="REQUIRE_ALLOWLIST"):
        with TestClient(app_module.app):
            pass
    host_port = fake_backend.base_url.removeprefix("http://")
    configure(
        "augment",
        **_vllm_env(fake_backend, GENERATION_BACKEND_REQUIRE_ALLOWLIST="true", GENERATION_BACKEND_ALLOWED_HOSTS=host_port),
    )
    with TestClient(app_module.app) as client:
        assert client.get("/augment/health").json()["status"] == "ok"
    # Pydantic bool: "false"는 거짓(FR-0-280)
    configure("augment", **_vllm_env(fake_backend, GENERATION_BACKEND_REQUIRE_ALLOWLIST="false"))
    assert config_module.settings.generation_backend_require_allowlist is False


@pytest.mark.parametrize(
    "extra, match",
    [
        ({"VLLM_TARGET_CAP": "0"}, "VLLM_TARGET_CAP"),
        ({"VLLM_TARGET_CAP": "61"}, "VLLM_TARGET_CAP"),
        ({"VLLM_REQUEST_TIMEOUT_S": "0"}, "시간 제한"),
        ({"VLLM_MAX_NEW_TOKENS": "0"}, "최대 토큰"),
    ],
)
def test_invalid_settings_fail_boot(fake_backend, extra, match):
    configure("augment", **_vllm_env(fake_backend, **extra))
    with pytest.raises(RuntimeError, match=match):
        with TestClient(app_module.app):
            pass


def test_backend_error_returns_200_with_empty_candidates(fake_backend):
    configure("augment", **_vllm_env(fake_backend))
    with TestClient(app_module.app) as client:
        fake_backend.status = 500
        res = client.post("/augment", json=SEED_BODY)
        assert res.status_code == 200
        assert res.json()["candidates"] == []


def test_timeout_gives_up_then_next_request_is_served_immediately(fake_backend):
    configure("augment", **_vllm_env(fake_backend, VLLM_REQUEST_TIMEOUT_S="1"))
    assert config_module.settings.vllm_request_timeout_s == 1
    with TestClient(app_module.app) as client:
        fake_backend.delay_s = 5
        started = time.monotonic()
        first = client.post("/augment", json=SEED_BODY)
        elapsed = time.monotonic() - started
        assert first.status_code == 200 and first.json()["candidates"] == []
        assert elapsed < 3.5

        fake_backend.delay_s = 0
        started = time.monotonic()
        second = client.post("/augment", json=SEED_BODY)
        assert second.status_code == 200 and second.json()["candidates"] == ["문장 하나", "문장 둘"]
        assert time.monotonic() - started < 2


def test_timeout_defaults_are_25_seconds_below_api_30():
    configure("augment")
    assert config_module.settings.vllm_request_timeout_s == 25
    assert config_module.settings.ollama_request_timeout_s == 25
    assert config_module.settings.vllm_max_new_tokens == 2048
    assert config_module.settings.resolved_vllm_target_cap == 60
    assert config_module.settings.resolved_ollama_target_cap == 20


def test_long_timeout_logs_warning(fake_backend, caplog):
    import logging

    configure("augment", **_vllm_env(fake_backend, VLLM_REQUEST_TIMEOUT_S="90"))
    with caplog.at_level(logging.WARNING, logger="ml_worker"):
        with TestClient(app_module.app):
            pass
    assert "30초보다 깁니다" in caplog.text


def test_api_key_sent_as_bearer_and_wrong_key_boot_fails(fake_backend):
    fake_backend.required_key = "sk-test"
    configure("augment", **_vllm_env(fake_backend, VLLM_API_KEY="sk-test"))
    with TestClient(app_module.app) as client:
        assert client.post("/augment", json=SEED_BODY).json()["candidates"]
    assert all(r["headers"].get("Authorization") == "Bearer sk-test" for r in fake_backend.requests)

    configure("augment", **_vllm_env(fake_backend, VLLM_API_KEY="wrong"))
    with pytest.raises(RuntimeError, match="HTTP 401"):
        with TestClient(app_module.app):
            pass


def test_vllm_default_cap_follows_lowered_contract_max(fake_backend):
    configure("augment", **_vllm_env(fake_backend, GENERATION_TARGET_COUNT_MAX="30"))
    with TestClient(app_module.app) as client:
        assert client.get("/augment/health").json()["targetCap"] == 30


def test_vllm_explicit_cap_above_contract_max_fails_boot(fake_backend):
    configure("augment", **_vllm_env(fake_backend, GENERATION_TARGET_COUNT_MAX="30", VLLM_TARGET_CAP="40"))
    with pytest.raises(RuntimeError, match="VLLM_TARGET_CAP"):
        with TestClient(app_module.app):
            pass


def test_api_key_over_plain_http_non_loopback_warns_without_key_value(caplog):
    """비루프백 http 대상에 키가 설정되면 기동 WARN(키 값 노출 금지). 주소는 사설 대역이라 검사를 통과하고,
    이어지는 연결 실패는 무시한다(경고는 연결 전에 나간다)."""
    import logging

    configure(
        "augment",
        GENERATION_BACKEND="vllm",
        VLLM_BASE_URL="http://10.255.255.1:8000",
        VLLM_MODEL="m",
        VLLM_API_KEY="sk-warn-SECRET-1",
        VLLM_CONNECT_TIMEOUT_S="0.2",
    )
    with caplog.at_level(logging.WARNING, logger="ml_worker"):
        with pytest.raises(RuntimeError):
            with TestClient(app_module.app):
                pass
    assert "평문" in caplog.text and "10.255.255.1:8000" in caplog.text
    assert "sk-warn-SECRET-1" not in caplog.text


def test_api_key_over_loopback_http_does_not_warn(fake_backend, caplog):
    import logging

    configure("augment", **_vllm_env(fake_backend, VLLM_API_KEY="k"))
    with caplog.at_level(logging.WARNING, logger="ml_worker"):
        with TestClient(app_module.app):
            pass
    assert "평문" not in caplog.text
