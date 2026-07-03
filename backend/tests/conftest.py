"""Pytest configuration and shared fixtures."""

from __future__ import annotations

import os
import pytest

# Set test env vars before any app imports
os.environ.setdefault("SECRET_KEY", "test-secret-key-at-least-32-characters-long")
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("GROQ_API_KEY", "gsk_test_key")
os.environ.setdefault("PINECONE_API_KEY", "test-pinecone-key")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")


@pytest.fixture(scope="session")
def sample_contract_text():
    fixture_path = __file__.replace("conftest.py", "fixtures/sample_contract.txt")
    with open(fixture_path) as f:
        return f.read()
