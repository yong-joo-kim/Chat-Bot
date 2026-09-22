"""문장 임베딩 추론 본체.

- `SentenceTransformerEmbedder`: 실제 한국어 문장 임베딩 모델(HF/sentence-transformers).
- `MockEmbedder`: 모델·GPU 없이도 계약을 검증하기 위한 결정론적 해시 벡터
  (apps/api 쪽 EmbeddingProvider 통합 테스트, ml-worker 미기동 CI 등에서 사용).

두 구현 모두 L2 정규화된 벡터를 반환한다(FR-N1-5) — 유사도는 내적 = 코사인으로 계산된다.
"""
from __future__ import annotations

import hashlib
import struct
from abc import ABC, abstractmethod
from typing import Literal

import numpy as np

Kind = Literal["QUERY", "PASSAGE"]

# kind별 프리픽스 규약. 모델이 비대칭 인코딩(질의/문서 프리픽스)을 요구하는지 여부는
# ml-worker 내부에서만 알고 apps/api는 모른다(설계서 §4.2 "프리픽스 규칙을 apps/api가
# 알지 않게 한다").
PREFIX_RULES: dict[str, dict[Kind, str]] = {
    "noprefix": {"QUERY": "", "PASSAGE": ""},
    "e5": {"QUERY": "query: ", "PASSAGE": "passage: "},
}


class Embedder(ABC):
    model_id: str
    dimension: int

    @abstractmethod
    def embed(self, texts: list[str], kind: Kind) -> np.ndarray:
        """L2 정규화된 (N, dimension) float32 배열을 반환한다."""

    @abstractmethod
    def healthy(self) -> bool: ...


class SentenceTransformerEmbedder(Embedder):
    def __init__(
        self,
        *,
        model_name: str,
        revision: str,
        device: str,
        prefix_rule: str,
        norm_rule: str,
        max_seq_length: int,
        model_id: str,
    ) -> None:
        # 지연 임포트: mock 모드에서는 torch/sentence-transformers 설치가 필요 없게 한다.
        from sentence_transformers import SentenceTransformer

        if norm_rule != "l2":
            raise ValueError(f"unsupported norm_rule: {norm_rule}")
        prefixes = PREFIX_RULES.get(prefix_rule)
        if prefixes is None:
            raise ValueError(f"unknown prefix_rule: {prefix_rule}")
        self._prefixes = prefixes

        self._model = SentenceTransformer(model_name, revision=revision, device=device)
        self._model.max_seq_length = max_seq_length  # CPU 지연 완화 1단계

        self.model_id = model_id
        self.dimension = int(self._model.get_sentence_embedding_dimension())
        self._warmed_up = False

    def warmup(self) -> None:
        self.embed(["워밍업 문장입니다."], "QUERY")
        self._warmed_up = True

    @property
    def warmed_up(self) -> bool:
        return self._warmed_up

    def embed(self, texts: list[str], kind: Kind) -> np.ndarray:
        prefix = self._prefixes[kind]
        prefixed = [f"{prefix}{t}" for t in texts]
        vectors = self._model.encode(
            prefixed,
            batch_size=max(1, min(len(prefixed), 64)),
            normalize_embeddings=True,  # FR-N1-5
            convert_to_numpy=True,
            show_progress_bar=False,
        )
        return np.asarray(vectors, dtype=np.float32)

    def healthy(self) -> bool:
        return self._model is not None


class MockEmbedder(Embedder):
    """텍스트의 sha256 해시를 시드로 하는 결정론적 단위벡터.
    같은 문자열은 항상 같은 벡터를 반환하므로 캐시·임계값 로직 테스트에 쓸 수 있다.
    의미 유사도를 반영하지 않으므로 매칭 품질 검증에는 쓰지 않는다."""

    def __init__(self, dimension: int = 64, model_id: str = "mock@0|noprefix|l2") -> None:
        self.dimension = dimension
        self.model_id = model_id

    def embed(self, texts: list[str], kind: Kind) -> np.ndarray:  # noqa: ARG002 (kind 무시)
        return np.stack([self._hash_vector(t) for t in texts]).astype(np.float32)

    def healthy(self) -> bool:
        return True

    def _hash_vector(self, text: str) -> np.ndarray:
        seed = hashlib.sha256(text.strip().lower().encode("utf-8")).digest()
        need = self.dimension * 4
        reps = (need + len(seed) - 1) // len(seed)
        raw = (seed * reps)[:need]
        ints = struct.unpack(f"<{self.dimension}I", raw)
        vec = np.array(ints, dtype=np.float64)
        vec = (vec / np.iinfo(np.uint32).max) * 2 - 1  # [-1, 1]
        norm = float(np.linalg.norm(vec))
        if norm == 0:
            vec[0] = 1.0
            norm = 1.0
        return (vec / norm).astype(np.float32)
