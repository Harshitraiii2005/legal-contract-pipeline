-- Schema for backend-go. Run this once against a fresh database before the
-- first deploy (e.g. `psql "$DATABASE_URL" -f schema.sql`, or paste into
-- Render's Postgres "Connect" > psql shell). Safe to re-run against a
-- database this was already applied to — every statement is idempotent.
--
-- backend-go has no migration runner of its own — it was built assuming a
-- database already migrated by the legacy Python backend's Alembic
-- migrations (backend/alembic/versions/). This file is those two
-- migrations (0001_initial + add_represented_party) merged into one
-- script, with corrections:
--   - The Go code consistently reads and writes contracts.storage_key
--     (models/models.go, handlers/contracts.go), but the Alembic migration
--     named that column s3_key. Uses storage_key so the schema matches
--     what the Go code actually queries.
--   - The app has no login (auth was removed entirely — contracts and
--     reviews are shared, not scoped to a caller), so contracts.owner_id
--     is never populated. It's kept as a nullable column rather than
--     dropped outright, in case per-user ownership is reintroduced later.
--     The `users` table likewise stays only as the (currently empty)
--     target of reviews.reviewer_id / audit_logs.user_id, both nullable
--     and never populated either.

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
    owner_id            TEXT REFERENCES users (id),
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

-- Relaxes owner_id to nullable for anyone who already applied an earlier
-- version of this script with the NOT NULL constraint. A no-op if the
-- column is already nullable.
ALTER TABLE contracts ALTER COLUMN owner_id DROP NOT NULL;

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
