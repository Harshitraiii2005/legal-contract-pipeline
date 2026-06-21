"""Compliance Checker — policy matching against regulatory frameworks."""

from __future__ import annotations

import asyncio
from typing import Any

from app.agents.base_agent import BaseAgent
from app.graph.state import ClauseExtract, ComplianceResult

_COMPLIANCE_PROMPT = """\
You are a legal compliance specialist. Check if the following contract clause
violates or creates risk under any of the listed regulatory frameworks.

Frameworks to check: {frameworks}

Clause:
Type: {clause_type}
Text:
{clause_text}

Return a JSON object with:
  - "compliant": boolean — true if no violations found
  - "violations": list of objects, each with:
      - "framework": name of the regulation
      - "article": specific article/section (if known)
      - "description": 1–2 sentence explanation of the issue
  - "recommendations": list of short fix suggestions

Return ONLY valid JSON.
""".strip()

DEFAULT_FRAMEWORKS = [
    "GDPR",
    "CCPA",
    "HIPAA",
    "SOX",
    "FCPA",
    "UK GDPR",
    "PCI-DSS",
]


class ComplianceChecker(BaseAgent):
    agent_name = "compliance_checker"
    max_tokens = 1024

    def __init__(self, frameworks: list[str] | None = None) -> None:
        super().__init__()
        self.frameworks = frameworks or DEFAULT_FRAMEWORKS

    def _execute(self, state: dict[str, Any]) -> dict[str, Any]:
        clauses: list[ClauseExtract] = state["clauses"]
        results = asyncio.run(self._check_all(clauses))
        violation_count = sum(1 for r in results if not r.compliant)
        self.log.info(
            "compliance_check_done",
            total=len(results),
            violations=violation_count,
        )
        return {"compliance_results": results, "compliance_violation_count": violation_count}

    async def _check_all(self, clauses: list[ClauseExtract]) -> list[ComplianceResult]:
        # Only check high-risk clause types to avoid token waste
        relevant_types = {
            "confidentiality", "data_processing", "intellectual_property",
            "payment", "indemnification",
        }
        tasks = [
            self._check_clause(c) if c.type in relevant_types
            else self._skip_clause(c)
            for c in clauses
        ]
        return await asyncio.gather(*tasks)

    async def _check_clause(self, clause: ClauseExtract) -> ComplianceResult:
        prompt = _COMPLIANCE_PROMPT.format(
            frameworks=", ".join(self.frameworks),
            clause_type=clause.type,
            clause_text=clause.text,
        )
        result: dict = self._call_llm_json(prompt)
        return ComplianceResult(
            clause_id=clause.id,
            compliant=result["compliant"],
            violations=result.get("violations", []),
            recommendations=result.get("recommendations", []),
        )

    @staticmethod
    async def _skip_clause(clause: ClauseExtract) -> ComplianceResult:
        return ComplianceResult(
            clause_id=clause.id,
            compliant=True,
            violations=[],
            recommendations=[],
        )
