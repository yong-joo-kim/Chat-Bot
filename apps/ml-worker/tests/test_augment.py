"""No.16 증강 생성 프로파일(`ML_WORKER_ROLE=augment|both`) 계약 테스트. mock 생성기로만 돈다 —
실제 모델 다운로드·GPU 없이 라우팅(404/503)과 스키마를 검증한다. 후보 품질 실측은
eval/generation_candidates.py의 책임이다.

`settings`/`app`는 모듈 임포트 시점에 1회 생성되는 싱글턴이라, role별 분기를 테스트하려면
환경변수를 바꾼 뒤 두 모듈을 강제로 reload한다. 다른 테스트 파일(test_app.py)이 이미 임포트해
둔 `app` 참조는 이 reload로 뒤바뀌지 않는다(각자 자기 모듈 네임스페이스에 바인딩된 객체를 들고
있다) — 그래도 안전하게 매 테스트 후 기본값(embed)으로 되돌린다.
"""
from __future__ import annotations

import importlib
import os

import ml_worker.app as app_module
import ml_worker.config as config_module
from fastapi.testclient import TestClient


def _reload_with(role: str, generation_model_id: str = "mock"):
    os.environ["ML_WORKER_ROLE"] = role
    os.environ["GENERATION_MODEL_ID"] = generation_model_id
    os.environ["EMBEDDING_MODEL_ID"] = "mock"
    importlib.reload(config_module)
    importlib.reload(app_module)
    return app_module.app


def teardown_function() -> None:
    _reload_with("embed")


def test_augment_route_absent_when_role_is_embed():
    app = _reload_with("embed")
    with TestClient(app) as client:
        res = client.post("/augment", json={"seeds": ["환불 어떻게 하나요"], "targetCount": 3, "locale": "ko"})
        assert res.status_code == 404
        res_health = client.get("/augment/health")
        assert res_health.status_code == 404


def test_augment_generates_candidates_when_role_is_both():
    app = _reload_with("both")
    with TestClient(app) as client:
        res = client.post("/augment", json={"seeds": ["환불 어떻게 하나요"], "targetCount": 3, "locale": "ko"})
        assert res.status_code == 200
        body = res.json()
        assert body["modelId"] == "mock-generator@0"
        assert len(body["candidates"]) == 3


def test_augment_health_reports_ok_when_role_is_augment():
    app = _reload_with("augment")
    with TestClient(app) as client:
        res = client.get("/augment/health")
        assert res.status_code == 200
        body = res.json()
        assert body["status"] == "ok"
        assert body["modelId"] == "mock-generator@0"
        assert body["warmedUp"] is True


def test_augment_rejects_seeds_over_limit():
    app = _reload_with("augment")
    with TestClient(app) as client:
        seeds = [f"시드 {i}" for i in range(21)]
        res = client.post("/augment", json={"seeds": seeds, "targetCount": 3, "locale": "ko"})
        assert res.status_code == 400


def test_augment_rejects_target_count_over_limit():
    app = _reload_with("augment")
    with TestClient(app) as client:
        res = client.post("/augment", json={"seeds": ["환불 어떻게 하나요"], "targetCount": 61, "locale": "ko"})
        assert res.status_code == 400


def test_augment_rejects_empty_seed_string():
    app = _reload_with("augment")
    with TestClient(app) as client:
        res = client.post("/augment", json={"seeds": [""], "targetCount": 3, "locale": "ko"})
        assert res.status_code == 400


def test_embed_still_works_when_role_is_both():
    """생성 프로파일이 켜져 있어도 /embed 계약은 바이트 단위로 동일하다(FR-L2-37)."""
    app = _reload_with("both")
    with TestClient(app) as client:
        res = client.post("/embed", json={"texts": ["배송 언제 오나요"], "kind": "QUERY"})
        assert res.status_code == 200
        body = res.json()
        assert body["modelId"] == "mock@0|noprefix|l2"
        assert body["dimension"] == 64
