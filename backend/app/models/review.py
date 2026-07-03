"""Review ORM model — stores pipeline output per contract."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func, JSON
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Review(Base):
    __tablename__ = "reviews"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    contract_id: Mapped[str] = mapped_column(ForeignKey("contracts.id"), nullable=False, unique=True)
    reviewer_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    # Pipeline outputs (stored as JSONB for flexibility)
    clauses: Mapped[list] = mapped_column(JSONB().with_variant(JSON, "sqlite"), default=list)
    risk_scores: Mapped[list] = mapped_column(JSONB().with_variant(JSON, "sqlite"), default=list)
    compliance_results: Mapped[list] = mapped_column(JSONB().with_variant(JSON, "sqlite"), default=list)
    redline_edits: Mapped[list] = mapped_column(JSONB().with_variant(JSON, "sqlite"), default=list)
    executive_summary: Mapped[str] = mapped_column(Text, default="")
    overall_score: Mapped[int] = mapped_column(Integer, default=0)

    # HITL
    approved: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    reviewer_notes: Mapped[str] = mapped_column(Text, default="")
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Assets
    redlined_docx_key: Mapped[str] = mapped_column(String(1000), default="")
    risk_pdf_key: Mapped[str] = mapped_column(String(1000), default="")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    contract: Mapped["Contract"] = relationship("Contract", back_populates="review")  # noqa: F821
    reviewer: Mapped["User | None"] = relationship("User", back_populates="reviews")  # noqa: F821
