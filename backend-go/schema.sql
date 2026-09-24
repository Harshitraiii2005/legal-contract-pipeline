-- Schema for backend-go. Run this once against a fresh database before the
-- first deploy (e.g. `psql "$DATABASE_URL" -f schema.sql`, or paste into
-- Render's Postgres "Connect" > psql shell).
--
-- backend-go has no migration runner of its own — it was built assuming a
-- database already migrated by the legacy Python backend's Alembic
-- migrations (backend/alembic/versions/). This file is those two
-- migrations (0001_initial + add_represented_party) merged into one
-- idempotent script, with one correction: the Go code consistently reads
-- and writes contracts.storage_key (models/models.go, handlers/contracts.go),
-- but the Alembic migration named that column s3_key — that mismatch would
-- 500 on the very next upload after auth starts working. This schema uses
-- storage_key so the database matches what the Go code actually expects.

CREATE SCHEMA IF NOT EXISTS audit;

CREATE TABLE IF NOT EXISTS users (
    id              TEXT PRIMARY KEY,
    email           VARCHAR(255) NOT NULL UNIQUE,
    hashed_password TEXT NOT NULL,
    full_name       VARCHAR(255) NOT NULL DEFAULT '',
    role            VARCHAR(50) NOT NULL DEFAULT 'reviewer',
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_users_email ON users (email);

CREATE TABLE IF NOT EXISTS contracts (
    id                  TEXT PRIMARY KEY,
    owner_id            TEXT NOT NULL REFERENCES users (id),
    name                VARCHAR(500) NOT NULL,
    original_filename   VARCHAR(500) NOT NULL DEFAULT '',
    file_type           VARCHAR(20) NOT NULL DEFAULT 'pdf',
    storage_key         VARCHAR(1000) NOT NULL DEFAULT '',
    raw_text            TEXT NOT NULL DEFAULT '',
    clause_count        INTEGER NOT NULL DEFAULT 0,
    overall_risk_score  INTEGER NOT NULL DEFAULT 0,
    status              VARCHAR(50) NOT NULL DEFAULT 'pending',
    thread_id           VARCHAR(255) NOT NULL DEFAULT '',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_contracts_owner_id ON contracts (owner_id);

CREATE TABLE IF NOT EXISTS reviews (
    id                  TEXT PRIMARY KEY,
    contract_id         TEXT NOT NULL UNIQUE REFERENCES contracts (id),
    reviewer_id         TEXT REFERENCES users (id),
    clauses             JSONB NOT NULL DEFAULT '[]',
    risk_scores         JSONB NOT NULL DEFAULT '[]',
    compliance_results  JSONB NOT NULL DEFAULT '[]',
    redline_edits       JSONB NOT NULL DEFAULT '[]',
    executive_summary   TEXT NOT NULL DEFAULT '',
    overall_score       INTEGER NOT NULL DEFAULT 0,
    represented_party   VARCHAR(50) NOT NULL DEFAULT 'Client',
    approved            BOOLEAN,
    reviewer_notes      TEXT NOT NULL DEFAULT '',
    decided_at          TIMESTAMPTZ,
    redlined_docx_key   VARCHAR(1000) NOT NULL DEFAULT '',
    risk_pdf_key        VARCHAR(1000) NOT NULL DEFAULT '',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit.audit_logs (
    id             TEXT PRIMARY KEY,
    contract_id    TEXT NOT NULL,
    review_id      TEXT,
    user_id        TEXT,
    event_type     VARCHAR(100) NOT NULL,
    agent_name     VARCHAR(100),
    model_version  VARCHAR(100),
    payload        JSONB NOT NULL DEFAULT '{}',
    occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_audit_logs_contract_id ON audit.audit_logs (contract_id);

-- Matches the Alembic migration's privilege lockdown: if the app connects
-- as a role other than the table owner, that role can insert/select audit
-- rows but not tamper with or delete them after the fact.
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_role') THEN
    REVOKE UPDATE, DELETE ON audit.audit_logs FROM app_role;
  END IF;
END $$;
