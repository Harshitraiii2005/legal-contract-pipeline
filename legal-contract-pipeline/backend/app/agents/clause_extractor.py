"""Clause Extractor — NLP parsing + clause segmentation."""

from __future__ import annotations

import re
from typing import Any

from app.agents.base_agent import BaseAgent
from app.graph.state import ClauseExtract, ContractReviewState

# ── Clause type taxonomy ────────────────────────────────────────────────────
CLAUSE_TYPES = [
    "indemnification",
    "limitation_of_liability",
    "termination",
    "intellectual_property",
    "confidentiality",
    "payment",
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
For each clause return a JSON array where every element has:
  - "id": sequential integer starting at 1
  - "type": one of {types}
  - "heading": the clause heading exactly as it appears (or best guess)
  - "text": the verbatim clause text
  - "page_hint": approximate position as a fraction 0.0–1.0 of total document

Return ONLY valid JSON — no markdown, no explanation.

CONTRACT TEXT:
---
{contract_text}
---
""".strip()


class ClauseExtractor(BaseAgent):
    agent_name = "clause_extractor"
    max_tokens = 8192  # contracts can be large

    def _execute(self, state: dict[str, Any]) -> dict[str, Any]:
        contract_text: str = state["contract_text"]

        if not contract_text.strip():
            raise ValueError("contract_text is empty — cannot extract clauses.")

        # Pre-segment by obvious headings to keep prompt size manageable
        chunks = self._pre_segment(contract_text)
        all_clauses: list[ClauseExtract] = []
        offset = 0

        for chunk in chunks:
            prompt = _EXTRACTION_PROMPT.format(
                types=", ".join(CLAUSE_TYPES),
                contract_text=chunk,
            )
            raw: list[dict] = self._call_llm_json(prompt)

            for item in raw:
                clause = ClauseExtract(
                    id=offset + item["id"],
                    type=item.get("type", "other"),
                    heading=item.get("heading", ""),
                    text=item["text"],
                    page_hint=item.get("page_hint", 0.0),
                )
                all_clauses.append(clause)
            offset += len(raw)

        self.log.info("clauses_extracted", count=len(all_clauses))
        return {"clauses": all_clauses, "clause_count": len(all_clauses)}

    # ------------------------------------------------------------------ #
    # Helpers                                                              #
    # ------------------------------------------------------------------ #

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
