"""Pinecone client wrapper for RAG clause retrieval."""

from __future__ import annotations

import hashlib
from typing import Any

from pinecone import Pinecone, ServerlessSpec
from sentence_transformers import SentenceTransformer

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

_EMBEDDING_MODEL = "all-MiniLM-L6-v2"
_VECTOR_DIM = 384


class VectorStoreService:
    """Wrapper around Pinecone for clause embedding + retrieval."""

    def __init__(self) -> None:
        self._pc = Pinecone(api_key=settings.PINECONE_API_KEY)
        self._index = self._get_or_create_index()
        self._encoder = SentenceTransformer(_EMBEDDING_MODEL)

    def _get_or_create_index(self):
        existing = [i.name for i in self._pc.list_indexes()]
        if settings.PINECONE_INDEX not in existing:
            self._pc.create_index(
                name=settings.PINECONE_INDEX,
                dimension=_VECTOR_DIM,
                metric="cosine",
                spec=ServerlessSpec(cloud="aws", region=settings.PINECONE_ENV),
            )
            logger.info("pinecone_index_created", index=settings.PINECONE_INDEX)
        return self._pc.Index(settings.PINECONE_INDEX)

    # ------------------------------------------------------------------ #
    # Query                                                                #
    # ------------------------------------------------------------------ #

    async def query(
        self,
        text: str,
        top_k: int = 3,
        filter: dict | None = None,
    ) -> list[dict[str, Any]]:
        """Return top-k similar clauses with metadata."""
        vec = self._embed(text)
        response = self._index.query(
            vector=vec,
            top_k=top_k,
            filter=filter,
            include_metadata=True,
        )
        return [
            {
                "id": match.id,
                "score": round(match.score, 4),
                "text": match.metadata.get("text", ""),
                "type": match.metadata.get("type", ""),
                "risk_score": match.metadata.get("risk_score"),
            }
            for match in response.matches
        ]

    # ------------------------------------------------------------------ #
    # Upsert                                                               #
    # ------------------------------------------------------------------ #

    def upsert_clause(
        self,
        text: str,
        clause_type: str,
        risk_score: int,
        contract_id: str,
        clause_id: int,
    ) -> str:
        """Embed and upsert a clause with its risk score for future RAG."""
        vec = self._embed(text)
        doc_id = hashlib.sha256(f"{contract_id}:{clause_id}".encode()).hexdigest()[:32]

        self._index.upsert(
            vectors=[
                {
                    "id": doc_id,
                    "values": vec,
                    "metadata": {
                        "text": text[:1000],  # Pinecone metadata limit
                        "type": clause_type,
                        "risk_score": risk_score,
                        "contract_id": contract_id,
                    },
                }
            ]
        )
        return doc_id

    # ------------------------------------------------------------------ #
    # Embedding                                                            #
    # ------------------------------------------------------------------ #

    def _embed(self, text: str) -> list[float]:
        return self._encoder.encode(text, normalize_embeddings=True).tolist()