"""SQLAlchemy engine, session factory, and base model."""

from __future__ import annotations

from typing import Generator

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings


def get_db_url() -> str:
    return str(settings.DATABASE_URL)


db_url = get_db_url()
engine_kwargs = {
    "pool_pre_ping": True,
    "echo": settings.DEBUG,
}
if db_url.startswith("postgresql") or db_url.startswith("postgres"):
    engine_kwargs["pool_size"] = settings.DB_POOL_SIZE
    engine_kwargs["max_overflow"] = settings.DB_MAX_OVERFLOW

engine = create_engine(db_url, **engine_kwargs)

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
