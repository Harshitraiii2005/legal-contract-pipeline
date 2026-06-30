"""Application configuration via Pydantic Settings."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, PostgresDsn, RedisDsn, field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # ── App ───────────────────────────────────────────────────────────────
    APP_NAME: str = "Legal Contract Pipeline"
    ENV: Literal["development", "staging", "production"] = "development"
    SECRET_KEY: str = Field(..., min_length=32)
    DEBUG: bool = False

    # ── Database ──────────────────────────────────────────────────────────
    DATABASE_URL: PostgresDsn = Field(...)
    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 20

    # ── Redis / Celery ────────────────────────────────────────────────────
    REDIS_URL: RedisDsn = Field(default="redis://localhost:6379/0")

    # ── Anthropic ─────────────────────────────────────────────────────────
    # Optional at startup — required only by code paths that actually call
    # Claude (the review-pipeline agents). Leaving this unset lets the rest
    # of the app (auth, upload, storage) run; agent calls will fail with an
    # auth error if invoked without a real key.
    GROQ_API_KEY: str = ""
    GROQ_MODEL: str = "llama-3.3-70b-versatile"

    # ── Pinecone ──────────────────────────────────────────────────────────
    # Optional for the same reason — required only by the Risk Scorer's RAG
    # lookup, not by app startup.
    PINECONE_API_KEY: str = ""
    PINECONE_ENV: str = "us-east-1-aws"
    PINECONE_INDEX: str = "contract-clauses"

    # ── MLflow ────────────────────────────────────────────────────────────
    MLFLOW_TRACKING_URI: str = "http://localhost:5000"

    # ── Auth ──────────────────────────────────────────────────────────────
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 8  # 8 hours
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    # ── Storage (local disk) ──────────────────────────────────────────────
    STORAGE_ROOT: str = "/data/legal-pipeline"

    # ── Email ─────────────────────────────────────────────────────────────
    SMTP_HOST: str = "smtp.sendgrid.net"
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    FROM_EMAIL: str = "noreply@legalai.example.com"

    # ── Misc ──────────────────────────────────────────────────────────────
    CORS_ORIGINS: list[str] = ["http://localhost:5173", "http://localhost:3000"]
    MAX_UPLOAD_MB: int = 50

    @field_validator("DATABASE_URL", mode="before")
    @classmethod
    def assemble_db_url(cls, v: str) -> str:
        return str(v)

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = True
        extra = "ignore"  # tolerate leftover/experimental env vars (e.g. GROQ_*, S3_*) without crashing


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
