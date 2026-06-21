"""Contracts routes — upload, list, status, download assets."""

from __future__ import annotations

import uuid
from typing import Annotated

import boto3
from fastapi import APIRouter, File, HTTPException, Query, UploadFile, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.api.deps import CurrentUser, DbSession, require
from app.api.services.document_parser import parse_document
from app.core.config import settings
from app.core.logging import get_logger
from app.models.audit_log import write_audit_event
from app.models.contract import Contract
from app.workers.tasks import run_review_pipeline

logger = get_logger(__name__)
router = APIRouter(prefix="/contracts", tags=["contracts"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class ContractOut(BaseModel):
    id: str
    name: str
    status: str
    overall_risk_score: int
    clause_count: int
    thread_id: str

    class Config:
        from_attributes = True


# ── Upload ────────────────────────────────────────────────────────────────────

@router.post("/upload", response_model=ContractOut, status_code=status.HTTP_201_CREATED)
async def upload_contract(
    file: Annotated[UploadFile, File(description="PDF or DOCX contract")],
    user: CurrentUser,
    db: DbSession,
):
    if file.size and file.size > settings.MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(413, detail=f"File exceeds {settings.MAX_UPLOAD_MB} MB limit")

    content = await file.read()
    contract_id = str(uuid.uuid4())

    # Parse text
    try:
        raw_text = parse_document(content, file.filename or "contract.pdf")
    except Exception as exc:
        raise HTTPException(422, detail=f"Could not parse document: {exc}")

    # Upload to S3
    s3_key = f"contracts/{user.id}/{contract_id}/{file.filename}"
    _upload_to_s3(content, s3_key, file.content_type or "application/octet-stream")

    # Persist contract record
    contract = Contract(
        id=contract_id,
        owner_id=user.id,
        name=file.filename or "Unnamed Contract",
        original_filename=file.filename or "",
        file_type=(file.filename or "").rsplit(".", 1)[-1].lower(),
        s3_key=s3_key,
        raw_text=raw_text,
        status="pending",
    )
    db.add(contract)

    write_audit_event(
        db,
        contract_id=contract_id,
        event_type="contract_uploaded",
        user_id=user.id,
        payload={"filename": file.filename, "size_bytes": len(content)},
    )
    db.commit()
    db.refresh(contract)

    # Kick off Celery task
    run_review_pipeline.delay(contract_id, raw_text, file.filename or "", user.id)
    logger.info("contract_queued", contract_id=contract_id)

    return contract


# ── List ──────────────────────────────────────────────────────────────────────

@router.get("/", response_model=list[ContractOut])
def list_contracts(
    user: CurrentUser,
    db: DbSession,
    skip: int = Query(0, ge=0),
    limit: int = Query(20, le=100),
):
    return (
        db.query(Contract)
        .filter(Contract.owner_id == user.id)
        .order_by(Contract.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )


# ── Single contract ───────────────────────────────────────────────────────────

@router.get("/{contract_id}", response_model=ContractOut)
def get_contract(contract_id: str, user: CurrentUser, db: DbSession):
    contract = _get_or_404(db, contract_id, user.id)
    return contract


# ── Download redlined DOCX ────────────────────────────────────────────────────

@router.get("/{contract_id}/download/redline")
def download_redline(contract_id: str, user: CurrentUser, db: DbSession):
    contract = _get_or_404(db, contract_id, user.id)
    if not contract.review or not contract.review.redlined_docx_key:
        raise HTTPException(404, detail="Redlined DOCX not yet generated")

    stream = _download_from_s3(contract.review.redlined_docx_key)
    return StreamingResponse(
        stream,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="redlined_{contract.name}.docx"'},
    )


@router.get("/{contract_id}/download/report")
def download_report(contract_id: str, user: CurrentUser, db: DbSession):
    contract = _get_or_404(db, contract_id, user.id)
    if not contract.review or not contract.review.risk_pdf_key:
        raise HTTPException(404, detail="Risk report PDF not yet generated")

    stream = _download_from_s3(contract.review.risk_pdf_key)
    return StreamingResponse(
        stream,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="risk_report_{contract.name}.pdf"'},
    )


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_or_404(db, contract_id: str, user_id: str) -> Contract:
    contract = db.query(Contract).filter(
        Contract.id == contract_id, Contract.owner_id == user_id
    ).first()
    if not contract:
        raise HTTPException(404, detail="Contract not found")
    return contract


def _upload_to_s3(content: bytes, key: str, content_type: str) -> None:
    try:
        s3 = boto3.client(
            "s3",
            region_name=settings.S3_REGION,
            aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
            aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
        )
        s3.put_object(Bucket=settings.S3_BUCKET, Key=key, Body=content, ContentType=content_type)
    except Exception as exc:
        logger.error("s3_upload_failed", key=key, error=str(exc))
        raise


def _download_from_s3(key: str):
    import io
    s3 = boto3.client(
        "s3",
        region_name=settings.S3_REGION,
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
    )
    obj = s3.get_object(Bucket=settings.S3_BUCKET, Key=key)
    return io.BytesIO(obj["Body"].read())
