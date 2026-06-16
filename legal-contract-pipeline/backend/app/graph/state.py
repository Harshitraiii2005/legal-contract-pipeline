"""Typed LangGraph state — every agent reads from and writes to this schema."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


# ── Per-clause extracted data ────────────────────────────────────────────────

class ClauseExtract(BaseModel):
    id: int
    type: str
    heading: str
    text: str
    page_hint: float = 0.0  # 0.0–1.0 position in document


class ClauseRiskScore(BaseModel):
    clause_id: int
    score: int = Field(ge=0, le=100)
    severity: Literal["low", "medium", "high", "critical"]
    reasoning: str
    flags: list[str] = Field(default_factory=list)
    rag_hits: list[str] = Field(default_factory=list)  # Pinecone IDs


class ComplianceViolation(BaseModel):
    framework: str
    article: str = ""
    description: str


class ComplianceResult(BaseModel):
    clause_id: int
    compliant: bool
    violations: list[dict[str, Any]] = Field(default_factory=list)
    recommendations: list[str] = Field(default_factory=list)


class ChangeRecord(BaseModel):
    original: str
    replacement: str
    rationale: str


class RedlineEdit(BaseModel):
    clause_id: int
    original_text: str
    revised_text: str
    changes: list[dict[str, Any]] = Field(default_factory=list)
    attorney_note: str = ""


# ── Final aggregated report ──────────────────────────────────────────────────

class FinalReport(BaseModel):
    contract_id: str
    contract_name: str
    overall_score: int = Field(ge=0, le=100)
    clause_count: int
    high_risk_count: int
    violation_count: int
    executive_summary: str
    risk_scores: list[ClauseRiskScore]
    compliance_results: list[ComplianceResult]
    redline_edits: list[RedlineEdit]
    generated_at: datetime = Field(default_factory=datetime.utcnow)


# ── Human-in-the-loop approval ───────────────────────────────────────────────

class ApprovalDecision(BaseModel):
    approved: bool
    reviewer_id: str
    reviewer_notes: str = ""
    decided_at: datetime = Field(default_factory=datetime.utcnow)


# ── Full pipeline state ──────────────────────────────────────────────────────

class ContractReviewState(BaseModel):
    """Immutable-ish typed state passed between all agents in the graph."""

    # Input
    contract_id: str
    contract_name: str = ""
    contract_text: str

    # Stage outputs (populated incrementally)
    clauses: list[ClauseExtract] = Field(default_factory=list)
    clause_count: int = 0

    risk_scores: list[ClauseRiskScore] = Field(default_factory=list)

    compliance_results: list[ComplianceResult] = Field(default_factory=list)
    compliance_violation_count: int = 0

    redline_edits: list[RedlineEdit] = Field(default_factory=list)

    report: FinalReport | None = None
    pipeline_complete: bool = False

    # Human-in-the-loop
    awaiting_approval: bool = False
    approval: ApprovalDecision | None = None

    # Metadata
    user_id: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)
    error: str | None = None

    class Config:
        # Allow arbitrary types for LangGraph compatibility
        arbitrary_types_allowed = True