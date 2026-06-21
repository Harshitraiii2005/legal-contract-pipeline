"""Integration tests for contracts and auth API routes."""

from __future__ import annotations

import io
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.core.security import hash_password
from app.models.user import User
from main import app

# ── In-memory test DB ─────────────────────────────────────────────────────────
SQLALCHEMY_DATABASE_URL = "sqlite://"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db


@pytest.fixture(autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def test_user():
    db = TestingSessionLocal()
    user = User(
        id="user-001",
        email="lawyer@example.com",
        hashed_password=hash_password("password123"),
        full_name="Jane Lawyer",
        role="lawyer",
    )
    db.add(user)
    db.commit()
    db.close()
    return user


def get_token(client, email="lawyer@example.com", password="password123"):
    resp = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    return resp.json()["access_token"]


# ── Auth tests ────────────────────────────────────────────────────────────────

class TestAuth:
    def test_register(self, client):
        resp = client.post("/api/v1/auth/register", json={
            "email": "new@example.com",
            "password": "secure123",
            "full_name": "New User",
        })
        assert resp.status_code == 201
        assert resp.json()["email"] == "new@example.com"

    def test_register_duplicate_email(self, client, test_user):
        resp = client.post("/api/v1/auth/register", json={
            "email": "lawyer@example.com",
            "password": "password123",
        })
        assert resp.status_code == 400

    def test_login_success(self, client, test_user):
        resp = client.post("/api/v1/auth/login", json={
            "email": "lawyer@example.com",
            "password": "password123",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "access_token" in data
        assert "refresh_token" in data

    def test_login_wrong_password(self, client, test_user):
        resp = client.post("/api/v1/auth/login", json={
            "email": "lawyer@example.com",
            "password": "wrongpass",
        })
        assert resp.status_code == 401

    def test_me(self, client, test_user):
        token = get_token(client)
        resp = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        assert resp.json()["email"] == "lawyer@example.com"


# ── Contract upload tests ─────────────────────────────────────────────────────

class TestContracts:
    @patch("app.api.routes.contracts.parse_document", return_value="contract text here")
    @patch("app.api.routes.contracts._upload_to_s3")
    @patch("app.api.routes.contracts.run_review_pipeline")
    def test_upload_pdf(self, mock_task, mock_s3, mock_parse, client, test_user):
        mock_task.delay = MagicMock()
        token = get_token(client)
        file_content = b"%PDF-1.4 fake content"

        resp = client.post(
            "/api/v1/contracts/upload",
            files={"file": ("contract.pdf", io.BytesIO(file_content), "application/pdf")},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["status"] == "pending"
        assert "id" in data

    def test_list_contracts_empty(self, client, test_user):
        token = get_token(client)
        resp = client.get("/api/v1/contracts/", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        assert resp.json() == []

    def test_get_nonexistent_contract(self, client, test_user):
        token = get_token(client)
        resp = client.get(
            "/api/v1/contracts/does-not-exist",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 404

    def test_requires_auth(self, client):
        resp = client.get("/api/v1/contracts/")
        assert resp.status_code == 403
