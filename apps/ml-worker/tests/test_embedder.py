import numpy as np

from ml_worker.embedder import MockEmbedder


def test_mock_embedder_is_deterministic_and_unit_norm():
    embedder = MockEmbedder(dimension=32)
    v1 = embedder.embed(["안녕하세요"], "QUERY")
    v2 = embedder.embed(["안녕하세요"], "PASSAGE")
    assert np.allclose(v1, v2)
    assert abs(float(np.linalg.norm(v1[0])) - 1.0) < 1e-5


def test_mock_embedder_different_text_different_vector():
    embedder = MockEmbedder(dimension=32)
    v1 = embedder.embed(["문장 A"], "QUERY")
    v2 = embedder.embed(["문장 B"], "QUERY")
    assert not np.allclose(v1, v2)


def test_mock_embedder_case_and_whitespace_insensitive_key():
    # 텍스트 정규화는 apps/api 책임이지만, 해시 안정성 자체는 대소문자/양끝 공백에 흔들리지 않아야 한다
    embedder = MockEmbedder(dimension=32)
    v1 = embedder.embed(["Hello World"], "QUERY")
    v2 = embedder.embed(["  hello world  "], "QUERY")
    assert np.allclose(v1, v2)
