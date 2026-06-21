"""Initial migration — create all tables.

Revision ID: 0001_initial
Revises:
Create Date: 2024-01-01 00:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Audit schema ──────────────────────────────────────────────────────
    op.execute("CREATE SCHEMA IF NOT EXISTS audit")

    # ── users ─────────────────────────────────────────────────────────────
    op.create_table(
        "users",
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("email", sa.String(255), nullable=False, unique=True),
        sa.Column("hashed_password", sa.String, nullable=False),
        sa.Column("full_name", sa.String(255), server_default=""),
        sa.Column("role", sa.String(50), server_default="reviewer"),
        sa.Column("is_active", sa.Boolean, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_users_email", "users", ["email"])

    # ── contracts ─────────────────────────────────────────────────────────
    op.create_table(
        "contracts",
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("owner_id", sa.String, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("name", sa.String(500), nullable=False),
        sa.Column("original_filename", sa.String(500), server_default=""),
        sa.Column("file_type", sa.String(20), server_default="pdf"),
        sa.Column("s3_key", sa.String(1000), server_default=""),
        sa.Column("raw_text", sa.Text, server_default=""),
        sa.Column("clause_count", sa.Integer, server_default="0"),
        sa.Column("overall_risk_score", sa.Integer, server_default="0"),
        sa.Column("status", sa.String(50), server_default="pending"),
        sa.Column("thread_id", sa.String(255), server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_contracts_owner_id", "contracts", ["owner_id"])

    # ── reviews ───────────────────────────────────────────────────────────
    op.create_table(
        "reviews",
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("contract_id", sa.String, sa.ForeignKey("contracts.id"), nullable=False, unique=True),
        sa.Column("reviewer_id", sa.String, sa.ForeignKey("users.id"), nullable=True),
        sa.Column("clauses", JSONB, server_default="[]"),
        sa.Column("risk_scores", JSONB, server_default="[]"),
        sa.Column("compliance_results", JSONB, server_default="[]"),
        sa.Column("redline_edits", JSONB, server_default="[]"),
        sa.Column("executive_summary", sa.Text, server_default=""),
        sa.Column("overall_score", sa.Integer, server_default="0"),
        sa.Column("approved", sa.Boolean, nullable=True),
        sa.Column("reviewer_notes", sa.Text, server_default=""),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("redlined_docx_key", sa.String(1000), server_default=""),
        sa.Column("risk_pdf_key", sa.String(1000), server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    # ── audit_logs (append-only) ──────────────────────────────────────────
    op.create_table(
        "audit_logs",
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("contract_id", sa.String, nullable=False),
        sa.Column("review_id", sa.String, nullable=True),
        sa.Column("user_id", sa.String, nullable=True),
        sa.Column("event_type", sa.String(100), nullable=False),
        sa.Column("agent_name", sa.String(100), nullable=True),
        sa.Column("model_version", sa.String(100), nullable=True),
        sa.Column("payload", JSONB, server_default="{}"),
        sa.Column("occurred_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        schema="audit",
    )
    op.create_index("ix_audit_logs_contract_id", "audit_logs", ["contract_id"], schema="audit")

    # Revoke mutation privileges on audit schema from application role
    op.execute(
        "DO $$ BEGIN "
        "  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_role') THEN "
        "    REVOKE UPDATE, DELETE ON audit.audit_logs FROM app_role; "
        "  END IF; "
        "END $$"
    )


def downgrade() -> None:
    op.drop_table("audit_logs", schema="audit")
    op.execute("DROP SCHEMA IF EXISTS audit CASCADE")
    op.drop_table("reviews")
    op.drop_table("contracts")
    op.drop_table("users")
