"""apps/ml-worker — 추론 전용 임베딩 서비스 (ADR-0024).

계약(설계서 §4.2):
  POST /embed  { texts: string[], kind: 'QUERY' | 'PASSAGE' } -> { modelId, dimension, vectors }
  GET  /health -> { status, modelId, dimension, device, warmedUp }

학습 파이프라인·Job Queue는 두지 않는다(추론 전용). 이 프로세스가 죽어도
apps/api는 저하 모드(규칙 매칭)로 전환할 뿐 대화가 멈추지 않는다(FR-0-44).
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from ml_worker.config import settings
from ml_worker.embedder import Embedder, MockEmbedder, SentenceTransformerEmbedder

logger = logging.getLogger("ml_worker")

_embedder: Embedder | None = None


def get_embedder() -> Embedder:
    if _embedder is None:
        raise RuntimeError("embedder가 아직 초기화되지 않았습니다")
    return _embedder


def _load_model() -> Embedder:
    if settings.is_mock:
        logger.warning("EMBEDDING_MODEL_ID=mock — 결정론적 해시 벡터로 동작합니다(실제 매칭 품질 없음)")
        return MockEmbedder(dimension=settings.mock_dimension)

    logger.info("모델 로드 시작: %s (device=%s)", settings.embedding_model_id, settings.embedding_device)
    embedder = SentenceTransformerEmbedder(
        model_name=settings.embedding_model_id,
        revision=settings.embedding_model_revision,
        device=settings.embedding_device,
        prefix_rule=settings.embedding_prefix_rule,
        norm_rule=settings.embedding_norm_rule,
        max_seq_length=settings.embedding_max_seq_length,
        model_id=settings.resolved_model_id,
    )
    embedder.warmup()  # CPU 지연 완화 1단계 — 기동 시 1회 더미 인코딩
    logger.info("모델 로드 완료: %s (dim=%s)", embedder.model_id, embedder.dimension)
    return embedder


@asynccontextmanager
async def lifespan(_: FastAPI):
    global _embedder
    _embedder = _load_model()
    yield
    _embedder = None


app = FastAPI(title="Chat Bot ml-worker", version="0.1.0", lifespan=lifespan)


class EmbedRequest(BaseModel):
    texts: list[str] = Field(min_length=1)
    kind: Literal["QUERY", "PASSAGE"]


class EmbedResponse(BaseModel):
    modelId: str
    dimension: int
    vectors: list[list[float]]


class HealthResponse(BaseModel):
    status: Literal["ok", "loading"]
    modelId: str | None = None
    dimension: int | None = None
    device: str
    warmedUp: bool


@app.post("/embed", response_model=EmbedResponse)
def embed(req: EmbedRequest) -> EmbedResponse:
    if len(req.texts) > settings.embedding_batch_max:
        raise HTTPException(
            status_code=400,
            detail=f"배치 상한 초과: {len(req.texts)} > {settings.embedding_batch_max}",
        )
    if any(not t.strip() for t in req.texts):
        raise HTTPException(status_code=400, detail="빈 문자열은 임베딩할 수 없습니다")

    try:
        embedder = get_embedder()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    vectors = embedder.embed(req.texts, req.kind)
    return EmbedResponse(
        modelId=embedder.model_id,
        dimension=embedder.dimension,
        vectors=vectors.tolist(),
    )


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    if _embedder is None:
        return HealthResponse(status="loading", device=settings.embedding_device, warmedUp=False)
    warmed_up = getattr(_embedder, "warmed_up", True)
    return HealthResponse(
        status="ok",
        modelId=_embedder.model_id,
        dimension=_embedder.dimension,
        device=settings.embedding_device,
        warmedUp=warmed_up,
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("ml_worker.app:app", host=settings.ml_worker_host, port=settings.ml_worker_port)
