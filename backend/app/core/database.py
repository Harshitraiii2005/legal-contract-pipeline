"""SQLAlchemy engine, session factory, and base model."""

from __future__ import annotations

from typing import Generator

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings


def get_db_url() -> str:
    return str(settings.DATABASE_URL)


engine = create_engine(
    get_db_url(),
    pool_size=settings.DB_POOL_SIZE,
    max_overflow=settings.DB_MAX_OVERFLOW,
    pool_pre_ping=True,
    echo=settings.DEBUG,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


# ── Audit schema protection ──────────────────────────────────────────────────
# Prevent any UPDATE or DELETE on audit_log by default (enforced in Postgres
# via row-level security — this is a belt-and-suspenders client-side guard).

@event.listens_for(engine, "before_cursor_execute")
def _guard_audit(conn, cursor, statement, params, context, executemany):
    lowered = statement.strip().lower()
    if lowered.startswith(("update audit", "delete from audit")):
        raise PermissionError("Mutations on the audit schema are forbidden.")


# ── Dependency ───────────────────────────────────────────────────────────────

def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
