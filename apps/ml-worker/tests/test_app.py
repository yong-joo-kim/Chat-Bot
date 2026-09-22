from fastapi.testclient import TestClient

from ml_worker.app import app


def test_health_before_and_after_startup():
    with TestClient(app) as client:  # startup 이벤트가 실행된다
        res = client.get("/health")
        assert res.status_code == 200
        body = res.json()
        assert body["status"] == "ok"
        assert body["modelId"] == "mock@0|noprefix|l2"
        assert body["dimension"] == 64
        assert body["warmedUp"] is True


def test_embed_returns_l2_normalized_vectors():
    with TestClient(app) as client:
        res = client.post("/embed", json={"texts": ["배송 언제 오나요", "환불 어떻게 하나요"], "kind": "QUERY"})
        assert res.status_code == 200
        body = res.json()
        assert body["modelId"] == "mock@0|noprefix|l2"
        assert body["dimension"] == 64
        assert len(body["vectors"]) == 2
        for vec in body["vectors"]:
            assert len(vec) == 64
            norm = sum(v * v for v in vec) ** 0.5
            assert abs(norm - 1.0) < 1e-4


def test_embed_is_deterministic():
    with TestClient(app) as client:
        r1 = client.post("/embed", json={"texts": ["같은 문장"], "kind": "QUERY"})
        r2 = client.post("/embed", json={"texts": ["같은 문장"], "kind": "PASSAGE"})
        assert r1.json()["vectors"] == r2.json()["vectors"]  # kind는 mock에서 무시(대칭 모델 가정)


def test_embed_rejects_batch_over_limit():
    with TestClient(app) as client:
        texts = [f"문장 {i}" for i in range(65)]
        res = client.post("/embed", json={"texts": texts, "kind": "QUERY"})
        assert res.status_code == 400


def test_embed_rejects_empty_string():
    with TestClient(app) as client:
        res = client.post("/embed", json={"texts": [""], "kind": "QUERY"})
        assert res.status_code == 400


def test_embed_rejects_empty_texts_list():
    with TestClient(app) as client:
        res = client.post("/embed", json={"texts": [], "kind": "QUERY"})
        assert res.status_code == 422  # pydantic min_length 검증
