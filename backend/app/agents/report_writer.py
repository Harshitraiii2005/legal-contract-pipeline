"""Report Writer — aggregates pipeline results into a structured summary."""

from __future__ import annotations

from typing import Any

from app.agents.base_agent import BaseAgent
from app.graph.state import FinalReport

_SUMMARY_PROMPT = """\
You are a senior legal analyst. Write an executive summary for a contract review.

Contract: {contract_name}
Total clauses: {clause_count}
High-risk clauses: {high_risk_count}
Compliance violations: {violation_count}
Overall risk score (0–100): {overall_score}

Top risk flags across all clauses:
{top_flags}

Top compliance issues:
{top_compliance}

Write a professional executive summary (3–5 paragraphs) suitable for a general
counsel to read in under 2 minutes. Follow these guidelines strictly:
1. Overall risk posture: Summarize the high-level legal risk of the contract.
2. Most critical issues (by name): Focus ONLY on high/medium risk items. Do NOT mention low-risk or favorable terms (such as "favorable warranty" or "standard representations") as key risks.
3. Compliance violations & Systemic Gaps: Consolidate repeated compliance gaps (e.g. lack of data protection/DPA provisions flagged across multiple clauses) into one systemic issue, rather than listing them as separate, independent violations.
4. Actionable Next Steps: Provide concrete, specific recommendations with suggested cure periods, liability caps, or thresholds where appropriate, rather than generic advice.

Plain text only — no JSON, no markdown headers.
""".strip()


class ReportWriter(BaseAgent):
    agent_name = "report_writer"
    max_tokens = 2048

    def _execute(self, state: dict[str, Any]) -> dict[str, Any]:
        scores = state.get("risk_scores", [])
        compliance = state.get("compliance_results", [])
        edits = state.get("redline_edits", [])
        clauses = state.get("clauses", [])

        overall_score = (
            round(sum(s.score for s in scores) / len(scores)) if scores else 0
        )
        high_risk = [s for s in scores if s.score >= 60]
        violation_count = state.get("compliance_violation_count", 0)

        # Aggregate flags (exclude low risk/favorable flags to avoid executive summary mismatch)
        all_flags: list[str] = []
        for s in scores:
            if s.score >= 30:
                all_flags.extend(s.flags)
        from collections import Counter
        top_flags = [f for f, _ in Counter(all_flags).most_common(5)]

        top_compliance: list[str] = []
        for c in compliance:
            if not c.compliant:
                for v in c.violations:
                    top_compliance.append(f"{v.framework}: {v.description}")
        
        # De-duplicate identical compliance entries to avoid cluttering the summary
        unique_compliance = []
        seen = set()
        for tc in top_compliance:
            if tc not in seen:
                seen.add(tc)
                unique_compliance.append(tc)
        top_compliance = unique_compliance[:5]

        executive_summary = self._call_llm(
            _SUMMARY_PROMPT.format(
                contract_name=state.get("contract_name", "Unknown"),
                clause_count=len(clauses),
                high_risk_count=len(high_risk),
                violation_count=violation_count,
                overall_score=overall_score,
                top_flags="\n".join(f"- {f}" for f in top_flags) or "None",
                top_compliance="\n".join(f"- {c}" for c in top_compliance) or "None",
            )
        )

        report = FinalReport(
            contract_id=state["contract_id"],
            contract_name=state.get("contract_name", "Unknown"),
            overall_score=overall_score,
            clause_count=len(clauses),
            high_risk_count=len(high_risk),
            violation_count=violation_count,
            executive_summary=executive_summary,
            risk_scores=scores,
            compliance_results=compliance,
            redline_edits=edits,
        )

        self.log.info(
            "report_written",
            contract_id=state["contract_id"],
            overall_score=overall_score,
        )
        return {"report": report, "pipeline_complete": True}
