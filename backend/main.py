"""FastAPI application entry point."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from app.api.routes import auth, contracts, reviews
from app.core.config import settings
from app.core.logging import configure_logging, get_logger

logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging()
    logger.info("startup", env=settings.ENV, debug=settings.DEBUG)
    yield
    logger.info("shutdown")


app = FastAPI(
    title="Legal Contract Pipeline API",
    description="AI-powered contract review with RAG, compliance checking, and human-in-the-loop approval.",
    version="1.0.0",
    docs_url="/docs" if settings.DEBUG else None,
    redoc_url="/redoc" if settings.DEBUG else None,
    lifespan=lifespan,
)

# ── Middleware ────────────────────────────────────────────────────────────────

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1000)

# ── Routers ───────────────────────────────────────────────────────────────────

app.include_router(auth.router, prefix="/api/v1")
app.include_router(contracts.router, prefix="/api/v1")
app.include_router(reviews.router, prefix="/api/v1")


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health", tags=["ops"])
def health():
    return {"status": "ok", "env": settings.ENV}

# Trigger reload for backend/.env updates


