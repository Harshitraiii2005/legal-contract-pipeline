"""Report Writer — aggregates pipeline results into a structured summary."""

from __future__ import annotations

import re
from collections import Counter
from typing import Any

from app.agents.base_agent import BaseAgent
from app.graph.state import FinalReport

_SUMMARY_PROMPT = """\
You are a senior legal analyst. Write an executive summary for a contract review.
We are writing this review from the perspective of the {represented_party}.

Contract: {contract_name}
Total clauses: {clause_count}
High-risk clauses (Severity HIGH or CRITICAL): {high_risk_count}
List of High-risk clauses (strictly derived programmatically):
{high_risk_clauses_list}

Compliance violation clauses: {compliance_violation_clauses}
Compliance violation issues (total): {compliance_violation_issues}
Overall risk score (0–100): {overall_score}

Top risk flags across all clauses:
{top_flags}

Top compliance issues:
{top_compliance}

Write a professional executive summary (3–5 paragraphs) suitable for a general
counsel to read in under 2 minutes. Follow these guidelines strictly:
1. Overall risk posture: Summarize the high-level legal risk of the contract from the {represented_party}'s perspective.
2. Most critical issues (by name): Focus ONLY on high/medium risk items. Do NOT mention low-risk or favorable terms (such as "favorable warranty" or "standard representations") as key risks.
3. Compliance violations & Systemic Gaps: Consolidate repeated compliance gaps (e.g. lack of data protection/DPA provisions flagged across multiple clauses) into one systemic issue, rather than listing them as separate, independent violations.
4. Actionable Next Steps & Numeric Grounding: Provide concrete, specific recommendations. If you recommend specific cure periods, liability caps, or other numeric remediation terms, you MUST either:
   - Ground them directly in the existing values present in the contract (from the Grounding Reference Points below).
   - If no reference value exists in the contract, you MUST explicitly mark them as illustrative placeholders in your output (e.g. '30 days (illustrative placeholder)' or '$100k (illustrative placeholder)'). Never present an invented number as a calculated recommendation without this placeholder designation.

Grounding Reference Points:
{grounding_anchors}

Plain text only — no JSON, no markdown headers. Do NOT include any conversational preamble or introduction.
""".strip()


def clean_summary_text(summary: str) -> str:
    # 1. Remove markdown code blocks (e.g. ```json ... ``` or ``` ... ```)
    summary = re.sub(r"```[\s\S]*?```", "", summary)

    # 2. Filter out raw JSON lines and conversational introductions
    lines = summary.splitlines()
    cleaned_lines = []
    in_json = False
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("{") or stripped.startswith("["):
            in_json = True
            continue
        if in_json:
            if stripped.endswith("}") or stripped.endswith("]"):
                in_json = False
            continue

        # Remove standard intro preambles.
        # FIX: this list previously required an exact substring match for
        # each phrasing variant (e.g. it had "here is a rewritten" but not
        # the contraction "here's a rewritten", which is exactly the phrase
        # that leaked through in production: "Here's a rewritten executive
        # summary that corrects the fabricated quote and removes it:").
        # The regex step below is the real backstop for this, but this list
        # is kept in sync with it as a fast first pass.
        lower_line = stripped.lower()
        if any(prefix in lower_line for prefix in [
            "here is a rewritten",
            "here's a rewritten",
            "here is the summary",
            "here is the executive summary",
            "here's the summary",
            "here's the executive summary",
            "here is a summary",
            "here is the json representation",
            "here's a summary",
            "here's the json representation",
            "rewritten executive summary",
        ]):
            continue

        cleaned_lines.append(line)

    summary = "\n".join(cleaned_lines).strip()

    # Remove any leading conversational phrases ending with a colon.
    # FIX: broadened alternation to explicitly include "here's a rewritten"
    # and "here's the ..." variants so this doesn't depend solely on the
    # line-level substring list above catching every contraction.
    summary = re.sub(
        r"^(here is|here's|this is|please find|summary of|executive summary of|"
        r"rewritten executive summary|here's a rewritten|here is a rewritten)"
        r"[\s\S]*?:\s*",
        "",
        summary,
        flags=re.IGNORECASE,
    )

    return summary.strip()


# FIX: previously only two specific JSON key names ("executive_summary",
# "overall_score") were checked, which happened to not match any of the
# actual keys observed in real leaked payloads ("risk_score",
# "key_clause_risks", "high_risk_clauses", "recommended_changes",
# "liability_cap", etc.). A generic structural check catches any
# `"key": value` pattern regardless of what the key is named, rather than
# maintaining an ever-growing hardcoded list that will always be one step
# behind whatever key names the model happens to produce next.
_JSON_KEY_VALUE_PATTERN = re.compile(r'"\w+"\s*:\s*(?:"|\[|\{|-?\d)')


def _has_ungrounded_dollar_or_day_figures(summary: str, anchors_text: str) -> bool:
    dollar_pattern = re.compile(r"\$\s?[\d,]+(?:\.\d+)?")
    day_pattern = re.compile(r"\b\d+\s?-?days?\b|\b\w+\s?\(\d+\)\s?-?days?\b", re.IGNORECASE)

    dollars = dollar_pattern.findall(summary)
    days = day_pattern.findall(summary)

    anchors_lower = anchors_text.lower()
    summary_lower = summary.lower()

    for dollar in dollars:
        dollar_norm = dollar.lower().strip()
        if dollar_norm not in anchors_lower:
            pos = summary_lower.find(dollar_norm)
            while pos != -1:
                context = summary_lower[pos:pos+60]
                if "illustrative placeholder" not in context:
                    return True
                pos = summary_lower.find(dollar_norm, pos + 1)

    for day in days:
        day_norm = day.lower().strip()
        digits = re.findall(r"\d+", day_norm)
        if digits:
            digit = digits[0]
            if digit not in anchors_lower:
                pos = summary_lower.find(day_norm)
                while pos != -1:
                    context = summary_lower[pos:pos+60]
                    if "illustrative placeholder" not in context:
                        return True
                    pos = summary_lower.find(day_norm, pos + 1)

    return False


def validate_summary(summary: str, anchors_text: str = "") -> bool:
    if not summary:
        return False
    if len(summary) < 200:
        return False
    if summary.startswith("{") or summary.startswith("["):
        return False
    if "```" in summary:
        return False
    # Generic JSON-shape detector instead of a hardcoded key list.
    if len(_JSON_KEY_VALUE_PATTERN.findall(summary)) >= 2:
        return False
    # Catch any residual meta-commentary about the generation process itself
    # that the line/regex cleanup above might have missed.
    lower = summary.lower()
    if any(
        phrase in lower
        for phrase in [
            "here is the json representation",
            "here's the json representation",
            "rewritten executive summary",
            "as an ai",
            "as a language model",
        ]
    ):
        return False

    if anchors_text and _has_ungrounded_dollar_or_day_figures(summary, anchors_text):
        return False

    return True


class ReportWriter(BaseAgent):
    agent_name = "report_writer"
    max_tokens = 2048

    def _execute(self, state: dict[str, Any]) -> dict[str, Any]:
        scores = state.get("risk_scores", [])
        compliance = state.get("compliance_results", [])
        edits = state.get("redline_edits", [])
        clauses = state.get("clauses", [])
        represented_party = state.get("represented_party", "Client")

        # Top 3 highest-risk average calculation
        if scores:
            sorted_scores = sorted([s.score for s in scores], reverse=True)
            top_3_scores = sorted_scores[:3]
            overall_score = round(sum(top_3_scores) / len(top_3_scores))
        else:
            overall_score = 0

        # Programmatic high-risk metrics (severity "high" or "critical")
        high_severity_clauses = [s for s in scores if s.severity in ("high", "critical")]
        high_risk_count = len(high_severity_clauses)

        clause_map = {c.id: c for c in clauses}
        high_risk_clauses_info = []
        for s in high_severity_clauses:
            c = clause_map.get(s.clause_id)
            heading = c.heading if c else "Unknown Heading"
            high_risk_clauses_info.append(f"- Clause {s.clause_id} ({heading}): Severity={s.severity.upper()}, Score={s.score}")
        high_risk_clauses_text = "\n".join(high_risk_clauses_info) if high_risk_clauses_info else "None"

        # Explicitly distinguish compliance violation counts (clauses vs. issues)
        compliance_violation_clauses = state.get("compliance_violation_clauses", sum(1 for r in compliance if len(r.violations) > 0))
        compliance_violation_issues = state.get("compliance_violation_issues", sum(len(r.violations) for r in compliance))

        # Extract potential grounding anchors from clauses text to prevent hallucinated numbers
        anchors = []
        for c in clauses:
            text_lower = c.text.lower()
            if "limit" in text_lower or "cap" in text_lower:
                money_finds = re.findall(r"\$\s?[\d,]+(?:\.\d+)?", c.text)
                if money_finds:
                    anchors.append(f"Clause {c.id} ('{c.heading}') mentions liability limit/cap: {', '.join(money_finds)}")
            if "cure" in text_lower or "remedy" in text_lower or "terminate" in text_lower:
                days_finds = re.findall(r"\b\d+\s?days?\b|\b\w+\s?\(\d+\)\s?days?\b", c.text, re.IGNORECASE)
                if days_finds:
                    anchors.append(f"Clause {c.id} ('{c.heading}') mentions notice/cure period: {', '.join(days_finds)}")
        anchors_text = "\n".join(f"- {a}" for a in anchors) if anchors else "None found in source text."

        # Aggregate flags (exclude low risk/favorable flags to avoid executive summary mismatch)
        all_flags: list[str] = []
        for s in scores:
            if s.score >= 30:
                all_flags.extend(s.flags)
        
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

        summary_prompt = _SUMMARY_PROMPT.format(
            represented_party=represented_party,
            contract_name=state.get("contract_name", "Unknown"),
            clause_count=len(clauses),
            high_risk_count=high_risk_count,
            high_risk_clauses_list=high_risk_clauses_text,
            compliance_violation_clauses=compliance_violation_clauses,
            compliance_violation_issues=compliance_violation_issues,
            overall_score=overall_score,
            top_flags="\n".join(f"- {f}" for f in top_flags) or "None",
            top_compliance="\n".join(f"- {c}" for c in top_compliance) or "None",
            grounding_anchors=anchors_text,
        )

        executive_summary = ""
        for attempt in range(1, 4):
            raw_summary = self._call_llm(summary_prompt)
            cleaned = clean_summary_text(raw_summary)
            if validate_summary(cleaned, anchors_text):
                executive_summary = cleaned
                break
            else:
                self.log.warning("summary_validation_failed", attempt=attempt, raw_length=len(raw_summary))
                # Append critical instruction for retry
                summary_prompt = (
                    _SUMMARY_PROMPT.format(
                        represented_party=represented_party,
                        contract_name=state.get("contract_name", "Unknown"),
                        clause_count=len(clauses),
                        high_risk_count=high_risk_count,
                        high_risk_clauses_list=high_risk_clauses_text,
                        compliance_violation_clauses=compliance_violation_clauses,
                        compliance_violation_issues=compliance_violation_issues,
                        overall_score=overall_score,
                        top_flags="\n".join(f"- {f}" for f in top_flags) or "None",
                        top_compliance="\n".join(f"- {c}" for c in top_compliance) or "None",
                        grounding_anchors=anchors_text,
                    )
                    + "\n\nCRITICAL: Your previous response contained conversational comments, raw JSON, markdown code blocks, or was too short. DO NOT output JSON or any conversational preambles like 'Here is the summary'. Write ONLY the clean, user-facing executive summary paragraphs directly. Plain text only."
                )

        if not executive_summary:
            executive_summary = cleaned if cleaned else "Failed to generate executive summary."

        # Prepend perspective statement:
        prefix = f"This analysis is prepared from the {represented_party}'s perspective.\n\n"
        if not executive_summary.startswith("This analysis is prepared"):
            executive_summary = prefix + executive_summary

        # FIX (document-integrity, silent clause deletion): if clause_extractor
        # detected that fewer clauses were extracted than the source document's
        # headings suggest, that warning must not be dropped silently on the
        # floor — it gets surfaced as a first-class, visible field so the UI
        # can render a blocking banner (mirroring the pattern already used for
        # the redline/mitigation-score-mismatch signal).
        extraction_warning = state.get("extraction_integrity_warning")
        if extraction_warning:
            self.log.error("report_includes_extraction_integrity_warning", warning=extraction_warning)

        report = FinalReport(
            contract_id=state["contract_id"],
            contract_name=state.get("contract_name", "Unknown"),
            overall_score=overall_score,
            clause_count=len(clauses),
            high_risk_count=high_risk_count,
            violation_count=compliance_violation_issues,
            compliance_violation_clauses=compliance_violation_clauses,
            compliance_violation_issues=compliance_violation_issues,
            executive_summary=executive_summary,
            risk_scores=scores,
            compliance_results=compliance,
            redline_edits=edits,
            represented_party=represented_party,
            extraction_integrity_warning=extraction_warning,
        )

        self.log.info(
            "report_written",
            contract_id=state["contract_id"],
            overall_score=overall_score,
            represented_party=represented_party,
        )
        return {"report": report, "pipeline_complete": True}