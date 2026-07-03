"""Unit tests for ComplianceChecker agent."""

from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, patch

from app.agents.compliance_checker import ComplianceChecker
from app.graph.state import ClauseExtract


@pytest.fixture
def checker():
    return ComplianceChecker()


def test_determine_frameworks_default(checker):
    # No governing law clause -> return defaults
    clauses = [
        ClauseExtract(id=1, type="payment", heading="Payment", text="Client shall pay within 30 days.")
    ]
    frameworks = checker._determine_frameworks(clauses)
    assert sorted(frameworks) == sorted(checker.frameworks)


def test_determine_frameworks_california(checker):
    clauses = [
        ClauseExtract(id=1, type="governing_law", heading="Governing Law", text="This contract is governed by California law."),
        ClauseExtract(id=2, type="payment", heading="Payment", text="Client pays.")
    ]
    frameworks = checker._determine_frameworks(clauses)
    assert "CCPA" in frameworks
    assert "PCI-DSS" in frameworks  # because of payment clause
    assert "GDPR" not in frameworks


def test_determine_frameworks_uk_and_payment(checker):
    clauses = [
        ClauseExtract(id=1, type="governing_law", heading="Governing Law", text="This contract is governed by the laws of England and Wales."),
        ClauseExtract(id=2, type="payment", heading="Payment", text="Pay by credit card.")
    ]
    frameworks = checker._determine_frameworks(clauses)
    assert "UK GDPR" in frameworks
    assert "PCI-DSS" in frameworks
    assert "GDPR" not in frameworks


def test_determine_frameworks_us_federal(checker):
    clauses = [
        ClauseExtract(id=1, type="governing_law", heading="Governing Law", text="Governed by the laws of Delaware and the United States.")
    ]
    frameworks = checker._determine_frameworks(clauses)
    assert "SOX" in frameworks
    assert "HIPAA" in frameworks
    assert "FCPA" in frameworks
    assert "CCPA" not in frameworks
