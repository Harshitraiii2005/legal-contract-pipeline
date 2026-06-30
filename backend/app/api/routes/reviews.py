"""Reviews routes — fetch review details, approve or reject."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.api.deps import CurrentUser, DbSession, require
from app.models.user import User
from app.api.services.email_service import EmailService
from app.core.logging import get_logger
from app.graph.orchestrator import get_orchestrator
from app.models.audit_log import write_audit_event
from app.models.contract import Contract
from app.models.review import Review

logger = get_logger(__name__)
router = APIRouter(prefix="/reviews", tags=["reviews"])
email_svc = EmailService()


# ── Schemas ───────────────────────────────────────────────────────────────────

class ClauseRiskOut(BaseModel):
    clause_id: int
    score: int
    severity: str
    reasoning: str
    flags: list[str]


class ReviewOut(BaseModel):
    id: str
    contract_id: str
    overall_score: int
    executive_summary: str
    risk_scores: list[dict]
    compliance_results: list[dict]
    redline_edits: list[dict]
    approved: bool | None
    reviewer_notes: str
    decided_at: datetime | None

    class Config:
        from_attributes = True


class ApprovalRequest(BaseModel):
    approved: bool
    notes: str = ""


# ── Get review ────────────────────────────────────────────────────────────────

@router.get("/{contract_id}", response_model=ReviewOut)
def get_review(contract_id: str, user: CurrentUser, db: DbSession):
    review = (
        db.query(Review)
        .join(Contract)
        .filter(Review.contract_id == contract_id, Contract.owner_id == user.id)
        .first()
    )
    if not review:
        raise HTTPException(404, detail="Review not found")
    return review


# ── Approve / Reject ──────────────────────────────────────────────────────────

@router.post("/{contract_id}/approve", response_model=dict)
def submit_approval(
    contract_id: str,
    body: ApprovalRequest,
    user: CurrentUser,
    db: DbSession,
    _: User = require("approve"),
):
    contract = db.query(Contract).filter(
        Contract.id == contract_id, Contract.owner_id == user.id
    ).first()
    if not contract:
        raise HTTPException(404, detail="Contract not found")
    if contract.status not in ("awaiting_approval",):
        raise HTTPException(400, detail=f"Contract is '{contract.status}', not awaiting approval")

    # Resume LangGraph pipeline
    orchestrator = get_orchestrator()
    orchestrator.submit_approval(
        thread_id=contract.thread_id,
        approved=body.approved,
        reviewer_id=user.id,
        notes=body.notes,
    )

    # Update DB
    review = contract.review
    if review:
        review.approved = body.approved
        review.reviewer_id = user.id
        review.reviewer_notes = body.notes
        review.decided_at = datetime.utcnow()

    contract.status = "approved" if body.approved else "rejected"

    write_audit_event(
        db,
        contract_id=contract_id,
        review_id=review.id if review else None,
        event_type="approval_submitted",
        user_id=user.id,
        payload={"approved": body.approved, "notes": body.notes},
    )
    db.commit()

    # Email notification
    try:
        email_svc.send_approval_confirmation(
            to=contract.owner.email,
            contract_name=contract.name,
            approved=body.approved,
            reviewer_name=user.full_name or user.email,
        )
    except Exception as exc:
        logger.warning("approval_email_failed", error=str(exc))

    action = "approved" if body.approved else "rejected"
    logger.info("approval_recorded", contract_id=contract_id, action=action, reviewer=user.id)
    return {"contract_id": contract_id, "status": contract.status}


# ── Audit timeline ────────────────────────────────────────────────────────────

@router.get("/{contract_id}/audit")
def get_audit_trail(contract_id: str, user: CurrentUser, db: DbSession):
    from app.models.audit_log import AuditLog

    # Verify ownership
    contract = db.query(Contract).filter(
        Contract.id == contract_id, Contract.owner_id == user.id
    ).first()
    if not contract:
        raise HTTPException(404, detail="Contract not found")

    logs = (
        db.query(AuditLog)
        .filter(AuditLog.contract_id == contract_id)
        .order_by(AuditLog.occurred_at.asc())
        .all()
    )

    return [
        {
            "id": log.id,
            "event_type": log.event_type,
            "agent_name": log.agent_name,
            "user_id": log.user_id,
            "occurred_at": log.occurred_at.isoformat(),
            "payload_summary": {k: v for k, v in (log.payload or {}).items() if k != "text"},
        }
        for log in logs
    ]
