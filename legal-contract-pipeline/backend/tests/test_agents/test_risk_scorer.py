"""Unit tests for RiskScorer agent."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.agents.risk_scorer import RiskScorer
from app.graph.state import ClauseExtract


@pytest.fixture
def scorer():
    with patch("app.agents.risk_scorer.VectorStoreService") as MockVS:
        MockVS.return_value.query = AsyncMock(return_value=[
            {"id": "abc123", "score": 0.92, "text": "similar clause...", "risk_score": 75}
        ])
        yield RiskScorer()


CLAUSES = [
    ClauseExtract(id=1, type="indemnification", heading="INDEMNIFICATION",
                  text="Client shall indemnify Company for ALL losses without limit.", page_hint=0.5),
    ClauseExtract(id=2, type="limitation_of_liability", heading="LIMITATION OF LIABILITY",
                  text="Liability is capped at fees paid in the prior month.", page_hint=0.7),
]


@patch.object(RiskScorer, "_call_llm_json")
def test_scores_all_clauses(mock_llm, scorer):
    mock_llm.return_value = {
        "score": 82,
        "severity": "high",
        "reasoning": "Unlimited indemnification is extremely broad.",
        "flags": ["unlimited indemnification", "no carve-outs"],
    }

    result = scorer.run({"clauses": CLAUSES})

    assert "risk_scores" in result
    assert len(result["risk_scores"]) == 2
    for score in result["risk_scores"]:
        assert 0 <= score.score <= 100
        assert score.severity in ("low", "medium", "high", "critical")


@patch.object(RiskScorer, "_call_llm_json")
def test_rag_context_included(mock_llm, scorer):
    """Verify that similar clause hits are passed to the LLM prompt."""
    mock_llm.return_value = {"score": 50, "severity": "medium", "reasoning": "ok", "flags": []}

    scorer.run({"clauses": [CLAUSES[0]]})

    call_args = mock_llm.call_args[0][0]
    assert "similar clauses" in call_args.lower() or "risk score" in call_args.lower()


@patch.object(RiskScorer, "_call_llm_json")
def test_rag_hits_stored_in_result(mock_llm, scorer):
    mock_llm.return_value = {"score": 40, "severity": "medium", "reasoning": "test", "flags": []}

    result = scorer.run({"clauses": [CLAUSES[0]]})
    assert "abc123" in result["risk_scores"][0].rag_hits
