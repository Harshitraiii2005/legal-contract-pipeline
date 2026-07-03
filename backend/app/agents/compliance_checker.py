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

## Strict Applicability Rules:
- **HIPAA**: ONLY applies if the contract explicitly involves Protected Health Information (PHI), medical records, or healthcare-related activities. If the clause does not deal with PHI or healthcare-related activities, mark as compliant for HIPAA. Do NOT raise false positives on generic data storage or API services.
- **SOX (Sarbanes-Oxley)**: ONLY applies to financial accounting, internal audit controls, corporate governance, executive certification of financial reports, or fraudulent financial reporting. Under no circumstances should general SLAs, uptime guarantees, technical support parameters, or API response times be flagged under SOX.
- **PCI-DSS**: ONLY applies if payment card details, cardholder data, or credit card transactions are processed.
- **FCPA**: ONLY applies to anti-bribery, anti-corruption, dealings with government officials, and ethical conduct.
- **GDPR / CCPA / UK GDPR**: ONLY apply if personal data (especially of EU/California/UK residents) is processed under the contract.

Clause:
Type: {clause_type}
Text:
{clause_text}

Return a JSON object with:
  - "compliant": boolean — true if no violations found (set to true if no applicable framework is violated)
  - "violations": list of objects, each with:
      - "framework": name of the regulation
      - "article": specific article/section (if known)
      - "description": 1–2 sentence explanation of the issue (explain why it is a real violation of this specific regulation, avoiding generic statements)
  - "recommendations": list of short, concrete fix suggestions. Each recommendation must include specific language, thresholds, or default values (e.g. "Add a clause specifying a standard 30-day cure period for material breach" instead of just "specify a cure period") to make them actionable.

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

    def _determine_frameworks(self, clauses: list[ClauseExtract]) -> list[str]:
        # Find governing law clauses
        gov_law_texts = []
        for c in clauses:
            if getattr(c, "type", "") == "governing_law" or (isinstance(c, dict) and c.get("type") == "governing_law"):
                text = getattr(c, "text", "") if not isinstance(c, dict) else c.get("text", "")
                gov_law_texts.append(text.lower())
            
        if not gov_law_texts:
            # Fall back to default frameworks if none found
            return self.frameworks
            
        frameworks = set()
        
        # CCPA for California
        if any("california" in t or " ca " in t or ", ca" in t for t in gov_law_texts):
            frameworks.add("CCPA")
            
        # GDPR for Europe/EU countries
        eu_keywords = ["european union", " eu ", "germany", "france", "ireland", "netherlands", "belgium", "switzerland"]
        if any(any(kw in t for kw in eu_keywords) for t in gov_law_texts):
            frameworks.add("GDPR")
            
        # UK GDPR for United Kingdom/England/Wales/Scotland
        uk_keywords = ["united kingdom", "uk ", " uk", "england", "wales", "london", "great britain"]
        if any(any(kw in t for kw in uk_keywords) for t in gov_law_texts):
            frameworks.add("UK GDPR")
            
        # US Federal laws (SOX, HIPAA, FCPA) if US or Delaware or New York governs
        us_keywords = ["delaware", "new york", "united states", " u.s.", "us law", "federal law"]
        if any(any(kw in t for kw in us_keywords) for t in gov_law_texts):
            frameworks.update(["SOX", "FCPA", "HIPAA"])
            
        # PCI-DSS if payment or credit cards are involved
        has_payment = False
        for c in clauses:
            ctype = getattr(c, "type", "") if not isinstance(c, dict) else c.get("type", "")
            ctext = getattr(c, "text", "") if not isinstance(c, dict) else c.get("text", "")
            if "payment" in ctype or "credit card" in ctext.lower():
                has_payment = True
                break
        if has_payment:
            frameworks.add("PCI-DSS")
            
        # If no specific frameworks were matched, default to the initialized ones
        if not frameworks:
            return self.frameworks
            
        return sorted(list(frameworks))

    def _execute(self, state: dict[str, Any] | Any) -> dict[str, Any]:
        if isinstance(state, dict):
            clauses = state.get("clauses", [])
        else:
            clauses = getattr(state, "clauses", [])
            
        # Dynamically determine frameworks based on governing law / jurisdiction metadata
        active_frameworks = self._determine_frameworks(clauses)
        self.log.info("compliance_active_frameworks", frameworks=active_frameworks)
        
        results = asyncio.run(self._check_all(clauses, active_frameworks))
        violation_count = sum(1 for r in results if not r.compliant)
        self.log.info(
            "compliance_check_done",
            total=len(results),
            violations=violation_count,
        )
        return {"compliance_results": results, "compliance_violation_count": violation_count}

    async def _check_all(self, clauses: list[ClauseExtract], frameworks: list[str]) -> list[ComplianceResult]:
        # Only check high-risk clause types to avoid token waste
        relevant_types = {
            "confidentiality", "data_processing", "intellectual_property",
            "payment", "indemnification",
        }
        
        tasks = []
        for c in clauses:
            ctype = getattr(c, "type", "") if not isinstance(c, dict) else c.get("type", "")
            if ctype in relevant_types:
                tasks.append(self._check_clause(c, frameworks))
            else:
                tasks.append(self._skip_clause(c))
                
        return await asyncio.gather(*tasks)

    async def _check_clause(self, clause: ClauseExtract, frameworks: list[str]) -> ComplianceResult:
        clause_id = getattr(clause, "id", 1) if not isinstance(clause, dict) else clause.get("id", 1)
        clause_type = getattr(clause, "type", "") if not isinstance(clause, dict) else clause.get("type", "")
        clause_text = getattr(clause, "text", "") if not isinstance(clause, dict) else clause.get("text", "")
        
        prompt = _COMPLIANCE_PROMPT.format(
            frameworks=", ".join(frameworks),
            clause_type=clause_type,
            clause_text=clause_text,
        )
        result: dict = self._call_llm_json(prompt)
        
        # Defensive parsing of recommendations (ensuring it is a list of plain strings)
        raw_recs = result.get("recommendations", [])
        clean_recs = []
        if isinstance(raw_recs, list):
            for r in raw_recs:
                if isinstance(r, dict):
                    val = r.get("recommendation") or r.get("text") or r.get("description") or str(r)
                    clean_recs.append(val)
                elif r is not None:
                    clean_recs.append(str(r))
        elif isinstance(raw_recs, dict):
            val = raw_recs.get("recommendation") or raw_recs.get("text") or raw_recs.get("description") or str(raw_recs)
            clean_recs.append(val)
        elif raw_recs:
            clean_recs.append(str(raw_recs))

        # Defensive parsing of violations to handle null article or other structure deviations
        raw_violations = result.get("violations", [])
        clean_violations = []
        if isinstance(raw_violations, list):
            for v in raw_violations:
                if isinstance(v, dict):
                    if v.get("article") is None:
                        v["article"] = ""
                    else:
                        v["article"] = str(v["article"])
                    if "framework" not in v:
                        v["framework"] = "Unknown"
                    if "description" not in v:
                        v["description"] = "Compliance violation detected."
                    clean_violations.append(v)
        
        return ComplianceResult(
            clause_id=clause_id,
            compliant=result.get("compliant", True),
            violations=clean_violations,
            recommendations=clean_recs,
        )

    @staticmethod
    async def _skip_clause(clause: ClauseExtract) -> ComplianceResult:
        clause_id = getattr(clause, "id", 1) if not isinstance(clause, dict) else clause.get("id", 1)
        return ComplianceResult(
            clause_id=clause_id,
            compliant=True,
            violations=[],
            recommendations=[],
        )
