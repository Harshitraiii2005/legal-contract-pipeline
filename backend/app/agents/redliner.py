"""Redliner — generates tracked-change suggestions for high-risk clauses."""

from __future__ import annotations

import asyncio
from typing import Any

from app.agents.base_agent import BaseAgent
from app.agents.risk_scorer import RiskScorer
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

# FIX (redline-aware scoring): a redline whose attorney note claims a risk
# reduction of at least this many points, but whose re-scored result doesn't
# actually drop by that much, gets flagged for human review rather than
# silently shipping a score that contradicts the tool's own annotation.
MISMATCH_TOLERANCE_POINTS = 5


class Redliner(BaseAgent):
    agent_name = "redliner"
    max_tokens = 2048

    def __init__(self) -> None:
        super().__init__()
        # Reuse the same scoring logic/prompt used for the initial pass so a
        # redlined clause is judged by the exact same rubric as every other
        # clause, rather than a separate, potentially inconsistent path.
        self._scorer = RiskScorer()

    def _execute(self, state: dict[str, Any]) -> dict[str, Any]:
        clauses: list[ClauseExtract] = state["clauses"]
        scores: list[ClauseRiskScore] = state["risk_scores"]
        compliance: list = state.get("compliance_results", [])
        represented_party = state.get("represented_party", "Client")

        # Index for fast lookup
        score_map = {s.clause_id: s for s in scores}
        compliance_map = {c.clause_id: c for c in compliance}

        # Only redline clauses above threshold
        high_risk = [
            c for c in clauses
            if score_map.get(c.id) and score_map[c.id].score is not None
            and score_map[c.id].score >= HIGH_RISK_THRESHOLD
        ]

        edits = asyncio.run(
            self._redline_all(high_risk, score_map, compliance_map, represented_party)
        )
        mismatch_count = sum(1 for e in edits if e.mitigation_score_mismatch)
        self.log.info(
            "redlines_generated",
            count=len(edits),
            mismatches_flagged=mismatch_count,
        )
        return {"redline_edits": edits}

    async def _redline_all(
        self,
        clauses: list[ClauseExtract],
        score_map: dict,
        compliance_map: dict,
        represented_party: str,
    ) -> list[RedlineEdit]:
        tasks = [
            self._redline_clause(c, score_map[c.id], compliance_map.get(c.id), represented_party)
            for c in clauses
        ]
        return await asyncio.gather(*tasks)

    async def _redline_clause(
        self,
        clause: ClauseExtract,
        score: ClauseRiskScore,
        compliance,
        represented_party: str,
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
        revised_text = result["revised_text"]
        attorney_note = result.get("attorney_note", "")

        # FIX (redline-aware scoring): re-score the *revised* text using the
        # exact same scorer/rubric as the original pass. Previously nothing
        # in the pipeline ever re-scored a clause after redlining it, so the
        # displayed score always reflected stale, pre-redline text — even
        # when the attorney note explicitly claimed the redline reduced risk.
        mitigated_result = await self._scorer.score_single_clause_text(
            clause_id=clause.id,
            clause_text=revised_text,
            clause_type=clause.type,
            represented_party=represented_party,
        )
        mitigated_score = mitigated_result.score

        # FIX (structured mismatch signal instead of a raw leaked flag string):
        # earlier versions of this pipeline attempted to signal a
        # score/redline mismatch by stuffing a literal internal tag like
        # "mitigation_score_mismatch_flagged_for_review" into the clause's
        # flags list, which then leaked verbatim into the UI. That signal now
        # lives in its own explicit, typed field that the report layer can
        # render as a proper banner/status column instead.
        mismatch = False
        if (
            mitigated_score is not None
            and score.score is not None
            and _note_implies_risk_reduction(attorney_note)
            and mitigated_score > score.score - MISMATCH_TOLERANCE_POINTS
        ):
            mismatch = True
            self.log.warning(
                "redline_mitigation_score_mismatch",
                clause_id=clause.id,
                original_score=score.score,
                mitigated_score=mitigated_score,
            )

        return RedlineEdit(
            clause_id=clause.id,
            original_text=clause.text,
            revised_text=revised_text,
            changes=result.get("changes", []),
            attorney_note=attorney_note,
            original_score=score.score,
            mitigated_score=mitigated_score,
            mitigation_score_mismatch=mismatch,
        )


def _note_implies_risk_reduction(note: str) -> bool:
    note_lower = note.lower()
    return any(
        phrase in note_lower
        for phrase in ["reduc", "lower", "mitigat", "limit", "cap", "less risk", "decrease"]
    )