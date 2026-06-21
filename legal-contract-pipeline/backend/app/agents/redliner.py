"""Redliner — generates tracked-change suggestions for high-risk clauses."""

from __future__ import annotations

import asyncio
from typing import Any

from app.agents.base_agent import BaseAgent
from app.graph.state import ClauseExtract, ClauseRiskScore, RedlineEdit

_REDLINE_PROMPT = """\
You are an expert contract attorney. The following clause has been flagged as
high-risk. Propose a revised version that reduces risk while preserving the
commercial intent of the clause.

Risk Score: {score}/100
Risk Flags: {flags}
Compliance Issues: {compliance_issues}

ORIGINAL CLAUSE:
{original_text}

Return a JSON object with:
  - "revised_text": the full revised clause text
  - "changes": list of objects, each with:
      - "original": the exact phrase being removed/changed
      - "replacement": the replacement phrase (empty string if deleting)
      - "rationale": one-sentence explanation
  - "attorney_note": brief note to the reviewing lawyer

Return ONLY valid JSON.
""".strip()

HIGH_RISK_THRESHOLD = 60


class Redliner(BaseAgent):
    agent_name = "redliner"
    max_tokens = 2048

    def _execute(self, state: dict[str, Any]) -> dict[str, Any]:
        clauses: list[ClauseExtract] = state["clauses"]
        scores: list[ClauseRiskScore] = state["risk_scores"]
        compliance: list = state.get("compliance_results", [])

        # Index for fast lookup
        score_map = {s.clause_id: s for s in scores}
        compliance_map = {c.clause_id: c for c in compliance}

        # Only redline clauses above threshold
        high_risk = [
            c for c in clauses
            if score_map.get(c.id) and score_map[c.id].score >= HIGH_RISK_THRESHOLD
        ]

        edits = asyncio.run(self._redline_all(high_risk, score_map, compliance_map))
        self.log.info("redlines_generated", count=len(edits))
        return {"redline_edits": edits}

    async def _redline_all(
        self,
        clauses: list[ClauseExtract],
        score_map: dict,
        compliance_map: dict,
    ) -> list[RedlineEdit]:
        tasks = [self._redline_clause(c, score_map[c.id], compliance_map.get(c.id))
                 for c in clauses]
        return await asyncio.gather(*tasks)

    async def _redline_clause(
        self,
        clause: ClauseExtract,
        score: ClauseRiskScore,
        compliance,
    ) -> RedlineEdit:
        compliance_issues = ""
        if compliance and not compliance.compliant:
            issues = [v["description"] for v in compliance.violations]
            compliance_issues = "; ".join(issues)

        prompt = _REDLINE_PROMPT.format(
            score=score.score,
            flags=", ".join(score.flags),
            compliance_issues=compliance_issues or "None",
            original_text=clause.text,
        )
        result: dict = self._call_llm_json(prompt)

        return RedlineEdit(
            clause_id=clause.id,
            original_text=clause.text,
            revised_text=result["revised_text"],
            changes=result.get("changes", []),
            attorney_note=result.get("attorney_note", ""),
        )
