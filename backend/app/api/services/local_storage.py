"""Local disk storage — drop-in replacement for the S3 helpers.

Files are stored under STORAGE_ROOT using the same "key" convention the S3
version used (e.g. "contracts/{user_id}/{contract_id}/{filename}",
"outputs/{contract_id}/redlined.docx"). Keys are just relative paths on disk.
"""

from __future__ import annotations

import io
import shutil
from pathlib import Path

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


def _resolve(key: str) -> Path:
    """Map a storage key to an absolute path, guarding against path traversal."""
    root = Path(settings.STORAGE_ROOT).resolve()
    target = (root / key).resolve()
    if not str(target).startswith(str(root)):
        raise ValueError(f"Invalid storage key (path traversal attempt): {key}")
    return target


def put(content: bytes, key: str, content_type: str = "application/octet-stream") -> None:
    """Write bytes to disk at the given key, creating parent dirs as needed."""
    path = _resolve(key)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    logger.info("local_storage_write", key=key, size_bytes=len(content))


def get(key: str) -> io.BytesIO:
    """Read bytes from disk at the given key. Raises FileNotFoundError if missing."""
    path = _resolve(key)
    if not path.exists():
        raise FileNotFoundError(f"Storage key not found: {key}")
    return io.BytesIO(path.read_bytes())


def delete(key: str) -> None:
    path = _resolve(key)
    if path.exists():
        path.unlink()
        logger.info("local_storage_delete", key=key)


def delete_prefix(prefix: str) -> None:
    """Delete an entire contract's directory."""
    path = _resolve(prefix)
    if path.exists():
        shutil.rmtree(path)
        logger.info("local_storage_delete_prefix", prefix=prefix)
