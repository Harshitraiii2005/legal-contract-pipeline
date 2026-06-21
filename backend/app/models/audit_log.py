"""Append-only audit log — immutable record of every agent decision."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base

# The corresponding Postgres migration adds:
#   REVOKE UPDATE, DELETE ON audit_logs FROM application_role;
# so even if the guard in database.py is bypassed, the DB enforces immutability.


class AuditLog(Base):
    __tablename__ = "audit_logs"
    __table_args__ = {"schema": "audit"}

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    contract_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    review_id: Mapped[str | None] = mapped_column(String, nullable=True)
    user_id: Mapped[str | None] = mapped_column(String, nullable=True)

    # What happened
    event_type: Mapped[str] = mapped_column(String(100), nullable=False)
    # e.g. "clause_extracted", "risk_scored", "compliance_checked",
    #       "redline_generated", "report_written", "approval_submitted"

    agent_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    model_version: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Structured payload (agent inputs/outputs, decision metadata)
    payload: Mapped[dict] = mapped_column(JSONB, default=dict)

    # Immutable timestamp
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    def __repr__(self) -> str:
        return f"<AuditLog {self.event_type} contract={self.contract_id} @ {self.occurred_at}>"


# ── Helper ────────────────────────────────────────────────────────────────────

def write_audit_event(
    db,
    *,
    contract_id: str,
    event_type: str,
    payload: dict,
    review_id: str | None = None,
    user_id: str | None = None,
    agent_name: str | None = None,
    model_version: str | None = None,
) -> AuditLog:
    """Write a single immutable audit event. Call inside an existing transaction."""
    entry = AuditLog(
        contract_id=contract_id,
        review_id=review_id,
        user_id=user_id,
        event_type=event_type,
        agent_name=agent_name,
        model_version=model_version,
        payload=payload,
    )
    db.add(entry)
    # Don't commit here — let the caller manage the transaction
    return entry
