"""Clause Extractor — NLP parsing + clause segmentation."""

from __future__ import annotations

import re
from typing import Any

from app.agents.base_agent import BaseAgent
from app.graph.state import ClauseExtract, ContractReviewState

# ── Clause type taxonomy ────────────────────────────────────────────────────
# FIX (document-integrity / mistagging): added "data_protection" and
# "service_level_agreement" — previously missing, which caused Data
# Protection clauses to fall through to "other" (silently skipped by the
# compliance checker's `relevant_types` filter) and SLA clauses to be
# mistagged as "warranty".
CLAUSE_TYPES = [
    "indemnification",
    "limitation_of_liability",
    "termination",
    "intellectual_property",
    "confidentiality",
    "payment",
    "data_protection",
    "service_level_agreement",
    "dispute_resolution",
    "governing_law",
    "force_majeure",
    "warranty",
    "assignment",
    "other",
]

_EXTRACTION_PROMPT = """\
You are a legal clause segmentation engine.

Given the following contract text, extract every distinct legal clause.

CRITICAL RULES — a violation of any of these is a serious defect:
1. Every numbered/lettered clause heading present in the text MUST appear exactly
   once in your output. Do not omit any clause, even if it seems purely
   definitional, administrative, or low-risk (e.g. Definitions, Notices,
   Entire Agreement, platform/service descriptions).
2. Do not merge two distinct headings into one clause, and do not split a
   single heading into two clauses unless the source text itself contains
   two independently numbered provisions under one heading.
3. Do not invent, duplicate, or renumber clauses. Preserve the original
   heading text verbatim.
4. If you are unsure whether something is a "real" clause, include it rather
   than omit it — omission is the worse error.

For each clause return a JSON array where every element has:
  - "id": sequential integer starting at 1, in document order
  - "type": one of {types}
  - "heading": the clause heading exactly as it appears (or best guess)
  - "text": the verbatim clause text
  - "page_hint": approximate position as a fraction 0.0-1.0 of total document

Return ONLY valid JSON — no markdown, no explanation.

CONTRACT TEXT:
---
{contract_text}
---
""".strip()


_PERSPECTIVE_PROMPT = """\
Analyze the following contract preamble and identify which party represents the "Client" (the customer, buyer, licensee, or service recipient) and which party represents the "Provider" (the vendor, supplier, licensor, or service provider).

We want to determine which party's interests our company represents. By default, for vendor agreements, we represent the Client's perspective.
Return a JSON object with:
  - "represented_party": "Client" or "Provider"
  - "explanation": a brief 1-sentence explanation.

Return ONLY valid JSON.

CONTRACT PREAMBLE:
---
{preamble}
---
""".strip()

# Matches "Section 1", "ARTICLE 1", "CLAUSE 1", or "1. HEADING" style headings.
# Used both to pre-segment the document AND to independently count how many
# headings *should* exist, so extraction output can be validated against it.
_HEADING_PATTERN = re.compile(
    r"(?:(?:Section|ARTICLE|CLAUSE)\s+(\d+))|(?:^|\n)\s*(\d+)\.\s+[A-Z]",
    re.IGNORECASE,
)


class ClauseExtractor(BaseAgent):
    agent_name = "clause_extractor"
    max_tokens = 8192  # contracts can be large

    def _execute(self, state: dict[str, Any]) -> dict[str, Any]:
        contract_text: str = state["contract_text"]

        if not contract_text.strip():
            raise ValueError("contract_text is empty — cannot extract clauses.")

        # Determine represented party perspective from first 4000 characters
        preamble = contract_text[:4000]
        represented_party = "Client"
        try:
            prompt = _PERSPECTIVE_PROMPT.format(preamble=preamble)
            result = self._call_llm_json(prompt)
            detected = result.get("represented_party", "Client").strip()
            if detected in ["Client", "Provider"]:
                represented_party = detected
        except Exception as e:
            self.log.warning("perspective_detection_failed", error=str(e))
            represented_party = "Client"

        self.log.info("perspective_detected", represented_party=represented_party)

        # Independent, code-based estimate of how many clauses *should* exist,
        # used purely as a sanity check against what the LLM actually returns.
        expected_heading_count = self._count_expected_headings(contract_text)

        # Pre-segment by obvious headings to keep prompt size manageable
        chunks = self._pre_segment(contract_text)
        all_clauses: list[ClauseExtract] = []
        seen_headings: dict[str, int] = {}
        next_id = 1

        for chunk in chunks:
            prompt = _EXTRACTION_PROMPT.format(
                types=", ".join(CLAUSE_TYPES),
                contract_text=chunk,
            )
            raw: list[dict] = self._call_llm_json(prompt)

            for item in raw:
                heading_norm = (item.get("heading") or "").strip().lower()

                # FIX (duplicate clauses, e.g. "Termination" appearing twice):
                # never trust the LLM's own "id" field for global numbering —
                # it is only reliable *within* a single chunk. Assign a fresh,
                # strictly sequential global id here instead, and detect
                # duplicate headings rather than silently accepting them.
                if heading_norm and heading_norm in seen_headings:
                    self.log.warning(
                        "duplicate_clause_heading_detected",
                        heading=item.get("heading"),
                        first_seen_id=seen_headings[heading_norm],
                    )

                clause = ClauseExtract(
                    id=next_id,
                    type=item.get("type", "other"),
                    heading=item.get("heading", ""),
                    text=item["text"],
                    page_hint=item.get("page_hint", 0.0),
                )
                all_clauses.append(clause)
                if heading_norm:
                    seen_headings.setdefault(heading_norm, next_id)
                next_id += 1

        # FIX (document-integrity): if the LLM-extracted clause count is
        # meaningfully lower than the independently-estimated heading count,
        # something was very likely dropped or merged during extraction.
        # We don't (and can't reliably) auto-repair this, but we surface it
        # loudly instead of silently shipping a report with missing clauses.
        extraction_gap = expected_heading_count - len(all_clauses)
        integrity_flag = None
        if expected_heading_count > 0 and extraction_gap > 0:
            integrity_flag = (
                f"Detected {expected_heading_count} numbered headings in the source "
                f"document but only extracted {len(all_clauses)} clauses. "
                f"{extraction_gap} clause(s) may have been dropped or merged during "
                f"extraction. This report should not be approved without manual "
                f"verification against the source document."
            )
            self.log.error(
                "clause_extraction_integrity_check_failed",
                expected=expected_heading_count,
                extracted=len(all_clauses),
                gap=extraction_gap,
            )

        self.log.info("clauses_extracted", count=len(all_clauses))
        return {
            "clauses": all_clauses,
            "clause_count": len(all_clauses),
            "represented_party": represented_party,
            "extraction_integrity_warning": integrity_flag,
        }

    # ------------------------------------------------------------------ #
    # Helpers                                                              #
    # ------------------------------------------------------------------ #

    @staticmethod
    def _count_expected_headings(text: str) -> int:
        """Independent, regex-based count of distinct numbered clause headings.

        This is intentionally simple and will not perfectly match the true
        clause count on every contract, but it gives a cheap, deterministic
        cross-check against LLM-based extraction so silent clause loss
        (Definitions/Services/etc. vanishing entirely) can be detected
        automatically instead of only being caught by manual diffing.
        """
        seen_numbers: set[str] = set()
        for match in _HEADING_PATTERN.finditer(text):
            num = match.group(1) or match.group(2)
            if num:
                seen_numbers.add(num)
        return len(seen_numbers)

    @staticmethod
    def _pre_segment(text: str, max_chars: int = 12_000) -> list[str]:
        """Split on numbered headings so each LLM call stays within limits."""
        # Match patterns like "1.", "1.1", "ARTICLE 1", "Section 1"
        pattern = re.compile(
            r"(?=(?:Section|ARTICLE|CLAUSE)\s+\d+|\b\d+\.\s+[A-Z])",
            re.IGNORECASE,
        )
        parts = pattern.split(text)

        chunks: list[str] = []
        current = ""
        for part in parts:
            if len(current) + len(part) > max_chars and current:
                chunks.append(current)
                current = part
            else:
                current += part
        if current:
            chunks.append(current)

        return chunks or [text]