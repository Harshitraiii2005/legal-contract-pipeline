"""Celery tasks — run_review_pipeline and post-processing."""

from __future__ import annotations

import boto3
from celery import Task
from celery.signals import worker_process_init

from app.workers.celery_app import celery_app
from app.core.config import settings
from app.core.database import SessionLocal
from app.core.logging import get_logger
from app.graph.orchestrator import get_orchestrator, reset_orchestrator
from app.models.audit_log import write_audit_event
from app.models.contract import Contract
from app.models.review import Review
from app.api.services.docx_builder import build_redlined_docx
from app.api.services.pdf_exporter import build_risk_pdf
from app.api.services.email_service import EmailService
from app.graph.state import FinalReport

logger = get_logger(__name__)
email_svc = EmailService()
_s3_client = None


# ── Fork safety ───────────────────────────────────────────────────────────────

@worker_process_init.connect
def reset_after_fork(**kwargs):
    """Force fresh DB pool and orchestrator in every Celery worker after fork."""
    reset_orchestrator()


# ── Task ──────────────────────────────────────────────────────────────────────

class PipelineTask(Task):
    abstract = True

    def on_failure(self, exc, task_id, args, kwargs, einfo):
        contract_id = args[0] if args else kwargs.get("contract_id", "unknown")
        with SessionLocal() as db:
            contract = db.get(Contract, contract_id)
            if contract:
                contract.status = "error"
                db.commit()
        logger.error("pipeline_task_failed", contract_id=contract_id, error=str(exc))


@celery_app.task(
    bind=True,
    base=PipelineTask,
    name="app.workers.tasks.run_review_pipeline",
    max_retries=2,
    default_retry_delay=30,
)
def run_review_pipeline(
    self,
    contract_id: str,
    contract_text: str,
    contract_name: str,
    user_id: str,
) -> dict:
    """Full pipeline: extract → score → compliance → redline → report."""
    logger.info("task_start", contract_id=contract_id)

    db = SessionLocal()
    try:
        contract = db.get(Contract, contract_id)
        if not contract:
            raise ValueError(f"Contract {contract_id} not found")
        contract.status = "processing"
        db.commit()

        # Run pipeline
        orchestrator = get_orchestrator()
        result = orchestrator.start_review(
            contract_id=contract_id,
            contract_text=contract_text,
            contract_name=contract_name,
            user_id=user_id,
        )

        state = result["state"]
        thread_id = result["thread_id"]
        report: FinalReport = state.get("report")

        # Persist review
        review = Review(
            contract_id=contract_id,
            clauses=[c.dict() for c in state.get("clauses", [])],
            risk_scores=[s.dict() for s in state.get("risk_scores", [])],
            compliance_results=[c.dict() for c in state.get("compliance_results", [])],
            redline_edits=[e.dict() for e in state.get("redline_edits", [])],
            executive_summary=report.executive_summary if report else "",
            overall_score=report.overall_score if report else 0,
            represented_party=state.get("represented_party", "Client"),
        )
        db.add(review)

        # Build and save artefacts to local storage
        if report:
            docx_bytes = build_redlined_docx(
                contract_name,
                state.get("clauses", []),
                state.get("redline_edits", []),
                report.overall_score,
            )
            pdf_bytes = build_risk_pdf(report)

            docx_key = f"outputs/{contract_id}/redlined.docx"
            pdf_key = f"outputs/{contract_id}/risk_report.pdf"
            from app.api.services import local_storage
            local_storage.put(docx_bytes, docx_key, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
            local_storage.put(pdf_bytes, pdf_key, "application/pdf")

            review.redlined_docx_key = docx_key
            review.risk_pdf_key = pdf_key

        # Update contract
        contract.status = "awaiting_approval"
        contract.thread_id = thread_id
        contract.clause_count = len(state.get("clauses", []))
        contract.overall_risk_score = report.overall_score if report else 0

        write_audit_event(
            db,
            contract_id=contract_id,
            review_id=review.id,
            event_type="pipeline_complete",
            agent_name="orchestrator",
            payload={"overall_score": contract.overall_risk_score, "thread_id": thread_id},
        )

        # Read all fields BEFORE closing session
        owner_email = contract.owner.email
        owner_name = contract.owner.full_name or contract.owner.email
        _contract_name = contract.name
        _contract_id = contract.id
        _overall_score = review.overall_score
        _risk_score = contract.overall_risk_score

        db.commit()

    except Exception as exc:
        db.rollback()
        logger.error("task_error", contract_id=contract_id, error=str(exc))
        raise self.retry(exc=exc)
    finally:
        db.close()

    # Notify outside the session — all needed data already extracted
    _notify_reviewer(_contract_name, _overall_score, _contract_id, owner_email, owner_name)

    logger.info("task_complete", contract_id=contract_id, score=_risk_score)
    return {"contract_id": contract_id, "status": "awaiting_approval"}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_s3():
    global _s3_client
    if _s3_client is None:
        _s3_client = boto3.client(
            "s3",
            region_name=settings.S3_REGION,
            aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
            aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
        )
    return _s3_client


def _s3_put(data: bytes, key: str, content_type: str) -> None:
    _get_s3().put_object(Bucket=settings.S3_BUCKET, Key=key, Body=data, ContentType=content_type)


def _notify_reviewer(
    contract_name: str,
    overall_score: float,
    contract_id: str,
    owner_email: str,
    owner_name: str,
) -> None:
    try:
        review_url = f"https://app.legalai.example.com/review/{contract_id}"
        email_svc.send_review_ready(
            to=owner_email,
            reviewer_name=owner_name,
            contract_name=contract_name,
            overall_score=overall_score,
            review_url=review_url,
        )
    except Exception as exc:
        logger.warning("notify_reviewer_failed", error=str(exc))