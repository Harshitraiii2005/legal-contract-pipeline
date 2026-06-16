"""Risk Scorer — RAG-first, LLM-second scoring of contract clauses."""

from __future__ import annotations

import asyncio
from typing import Any

from app.agents.base_agent import BaseAgent
from app.api.services.vector_store import VectorStoreService
from app.graph.state import ClauseExtract, ClauseRiskScore, ContractReviewState

_SCORE_PROMPT = """\
You are a contract risk analyst. Score the following clause for legal risk.

## Similar clauses from historical contracts (with their risk scores):
{rag_context}

## Clause to score:
Type: {clause_type}
Heading: {heading}
Text:
{clause_text}

Return a JSON object with:
  - "score": integer 0–100 (0 = no risk, 100 = extreme risk)
  - "severity": "low" | "medium" | "high" | "critical"
  - "reasoning": 2–4 sentence explanation citing specific language
  - "flags": list of short strings naming specific risk factors (e.g. "unlimited liability", "perpetual IP assignment")

Return ONLY valid JSON.
""".strip()


class RiskScorer(BaseAgent):
    agent_name = "risk_scorer"
    max_tokens = 1024

    def __init__(self) -> None:
        super().__init__()
        self.vector_store = VectorStoreService()

    def _execute(self, state: dict[str, Any]) -> dict[str, Any]:
        clauses: list[ClauseExtract] = state["clauses"]
        scores = asyncio.run(self._score_all(clauses))
        return {"risk_scores": scores}

    async def _score_all(self, clauses: list[ClauseExtract]) -> list[ClauseRiskScore]:
        tasks = [self._score_clause(c) for c in clauses]
        return await asyncio.gather(*tasks)

    async def _score_clause(self, clause: ClauseExtract) -> ClauseRiskScore:
        # 1. RAG: retrieve similar clauses
        similar = await self.vector_store.query(
            text=clause.text,
            top_k=3,
            filter={"type": clause.type},
        )
        rag_context = self._format_rag_context(similar)

        # 2. LLM: score with context
        prompt = _SCORE_PROMPT.format(
            rag_context=rag_context,
            clause_type=clause.type,
            heading=clause.heading,
            clause_text=clause.text,
        )
        result: dict = self._call_llm_json(prompt)

        return ClauseRiskScore(
            clause_id=clause.id,
            score=int(result["score"]),
            severity=result["severity"],
            reasoning=result["reasoning"],
            flags=result.get("flags", []),
            rag_hits=[h["id"] for h in similar],
        )

    @staticmethod
    def _format_rag_context(hits: list[dict]) -> str:
        if not hits:
            return "No similar clauses found in historical data."
        lines = []
        for i, h in enumerate(hits, 1):
            lines.append(
                f"{i}. [Risk score: {h.get('score', 'N/A')}] {h.get('text', '')[:300]}..."
            )
        return "\n".join(lines)