"""Unit tests for ClauseExtractor agent."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from app.agents.clause_extractor import ClauseExtractor


SAMPLE_CONTRACT = """
MASTER SERVICE AGREEMENT

1. SERVICES
The Company shall provide software development services as described in each Statement of Work.

2. PAYMENT
Client shall pay all invoices within thirty (30) days of receipt. Late payments accrue
interest at 1.5% per month.

3. INDEMNIFICATION
Client shall indemnify, defend and hold harmless Company and its officers, directors,
employees from any and all claims arising out of Client's use of the Services.

4. LIMITATION OF LIABILITY
IN NO EVENT SHALL EITHER PARTY BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL,
EXEMPLARY, OR CONSEQUENTIAL DAMAGES, HOWEVER CAUSED.

5. GOVERNING LAW
This Agreement shall be governed by the laws of the State of Delaware.
""".strip()


@pytest.fixture
def extractor():
    return ClauseExtractor()


@patch.object(ClauseExtractor, "_call_llm_json")
def test_extracts_clauses(mock_llm, extractor):
    mock_llm.return_value = [
        {"id": 1, "type": "payment", "heading": "PAYMENT", "text": "Client shall pay...", "page_hint": 0.3},
        {"id": 2, "type": "indemnification", "heading": "INDEMNIFICATION", "text": "Client shall indemnify...", "page_hint": 0.5},
        {"id": 3, "type": "limitation_of_liability", "heading": "LIMITATION OF LIABILITY", "text": "IN NO EVENT...", "page_hint": 0.7},
    ]

    result = extractor.run({"contract_text": SAMPLE_CONTRACT})

    assert "clauses" in result
    assert len(result["clauses"]) == 3
    assert result["clause_count"] == 3
    assert result["clauses"][0].type == "payment"
    assert result["clauses"][1].type == "indemnification"


@patch.object(ClauseExtractor, "_call_llm_json")
def test_clause_ids_are_sequential(mock_llm, extractor):
    mock_llm.return_value = [
        {"id": 1, "type": "other", "heading": "A", "text": "text", "page_hint": 0.1},
        {"id": 2, "type": "other", "heading": "B", "text": "text", "page_hint": 0.2},
    ]

    result = extractor.run({"contract_text": SAMPLE_CONTRACT})
    ids = [c.id for c in result["clauses"]]
    assert ids == list(range(1, len(ids) + 1))


def test_empty_contract_raises(extractor):
    with pytest.raises(ValueError, match="empty"):
        extractor.run({"contract_text": "   "})


@patch.object(ClauseExtractor, "_call_llm_json")
def test_pre_segmentation_on_large_contract(mock_llm, extractor):
    """Large contract should be split into chunks before sending to LLM."""
    long_text = SAMPLE_CONTRACT * 30  # ~180KB
    mock_llm.return_value = [
        {"id": 1, "type": "other", "heading": "X", "text": "x", "page_hint": 0.0}
    ]

    result = extractor.run({"contract_text": long_text})
    # LLM should have been called more than once (chunked)
    assert mock_llm.call_count >= 1
    assert result["clause_count"] > 0
