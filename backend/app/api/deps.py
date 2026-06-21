"""FastAPI shared dependencies — DB session, current user, RBAC."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import decode_token, require_permission
from app.models.user import User

bearer = HTTPBearer()

DbSession = Annotated[Session, Depends(get_db)]


# ── Auth ──────────────────────────────────────────────────────────────────────

def get_current_user(
    db: DbSession,
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
) -> User:
    try:
        payload = decode_token(credentials.credentials)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    user = db.get(User, payload["sub"])
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


# ── RBAC factories ────────────────────────────────────────────────────────────

def require(permission: str):
    """Dependency factory: raises 403 if user lacks the permission."""
    def _check(user: CurrentUser) -> User:
        try:
            require_permission(user.role, permission)
        except PermissionError:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission '{permission}' required",
            )
        return user
    return Depends(_check)
