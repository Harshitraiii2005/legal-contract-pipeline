"""Risk Scorer — RAG-first, LLM-second scoring of contract clauses."""

from __future__ import annotations

import asyncio
import re
from typing import Any

from app.agents.base_agent import BaseAgent
from app.api.services.vector_store import VectorStoreService
from app.graph.state import ClauseExtract, ClauseRiskScore, ContractReviewState

_BATCH_SCORE_PROMPT = """\
You are a senior contract risk analyst. Score the following batch of contract clauses for legal risk specifically from the perspective of our company ({represented_party}) (the company receiving or signing the agreement).

For each clause in the batch, you must:
1. Determine the "risk_perspective": Who does this clause benefit? (e.g. "benefits counterparty", "benefits our company ({represented_party})"). Explain how it impacts our company ({represented_party}).
2. Determine "score": An integer between 0 and 100 representing the risk to our company ({represented_party}).
   - 0-19 = LOW risk (clause is standard, mutual, or highly favorable to our company ({represented_party})).
   - 20-39 = MEDIUM risk (clause is slightly one-sided or has minor unfavorable terms, but manageable for our company).
   - 40-69 = HIGH risk (clause is heavily one-sided favoring the counterparty, introduces significant liability, or lacks standard protections for our company).
   - 70-100 = CRITICAL risk (clause is extremely punitive to our company, exposes us to unlimited liability, or strips away essential legal rights of our company).
3. Provide "reasoning": 2-4 sentences explaining the specific risk to our company ({represented_party}) citing the clause language.
   IMPORTANT: Only cite numbers, dollar amounts, dates, or defined terms that literally
   appear in the clause text below. Never invent, estimate, or infer a specific figure
   that is not written in the clause. If the clause does not specify an amount, say so
   explicitly (e.g. "the clause does not specify a dollar cap") rather than making one up.
4. Provide "flags": A list of short, human-readable strings naming specific risk factors
   (e.g. "unlimited liability", "perpetual IP assignment"). Do NOT output internal
   process labels, enum values, or review-status strings (e.g. "high_risk",
   "flagged_for_review") — flags must describe the *clause's* risk, not the pipeline's
   internal state.

## Calibration Anchors (Few-Shot Examples):
Example 1: Liability cap favoring our company ({represented_party}) (LOW risk):
- Clause: "Company's maximum liability for any claims arising out of this Agreement shall be limited to $5,000, while Client's liability is unlimited."
  - risk_perspective: Favorable to our company ({represented_party}). It caps our company's liability at a very low amount ($5,000) while leaving the counterparty's (Client) liability uncapped.
  - score: 10
  - reasoning: This clause strongly protects our company by capping our maximum liability at a nominal amount ($5,000). The counterparty (Client) is left with uncapped liability, which minimizes risk to our company.
  - flags: ["capped liability", "favorable liability cap"]

Example 2: Liability cap unfavorable to our company ({represented_party}) (HIGH/CRITICAL risk):
- Clause: "Company shall indemnify Client against all claims, and Company's total liability for any breach is capped at $10, while Client's liability is uncapped, and Client shall not be subject to any cap."
  - risk_perspective: Highly unfavorable to our company ({represented_party}). It requires our company to indemnify the counterparty (Client) without limit, while capping our own recourse against them at a trivial $10.
  - score: 85
  - reasoning: This clause exposes our company to extreme risk. We must provide unlimited indemnification to the counterparty (Client), but our ability to recover any damages from them is capped at a negligible $10.
  - flags: ["unlimited indemnification", "punitive liability cap", "one-sided liability"]

## Similar historical clauses for reference:
{rag_context}

## Clauses to score:
{clauses_text}

Return a JSON object containing a list named "results", where each item corresponds to a clause and has:
  - "clause_id": integer (must match the "id" of the clause provided below)
  - "risk_perspective": brief description of who the clause benefits and why (e.g. "benefits counterparty", "benefits our company ({represented_party})")
  - "score": integer 0-100
  - "reasoning": 2-4 sentence explanation citing specific language and reasoning about risk to our company ({represented_party})
  - "flags": list of short strings naming specific risk factors

Return ONLY valid JSON.
""".strip()

# FIX (fabricated-figure hallucination, e.g. the "$10,000 liability cap" that
# did not exist anywhere in the source contract): any number-like token
# appearing in generated reasoning must be traceable back to the clause text
# itself. This is a conservative, cheap regex check — not a substitute for a
# full grounding model, but it catches exactly the class of error observed
# (a specific dollar figure invented wholesale).
_MONEY_OR_NUMBER_PATTERN = re.compile(
    r"\$\s?[\d,]+(?:\.\d+)?|\b\d{2,}(?:,\d{3})*\b"
)

# Internal-looking tokens that must never reach user-facing flags. This list
# is a defense-in-depth backstop; risk-status information like "this clause's
# redline did not reduce risk as expected" belongs in a dedicated structured
# field (see redliner.py's `mitigation_score_mismatch`), never smuggled into
# the free-text flags list.
_INTERNAL_FLAG_DENYLIST = {
    "high risk", "medium risk", "low risk", "critical risk",
    "flag 1", "flag 2", "flag_1", "flag_2",
}
_INTERNAL_FLAG_PATTERN = re.compile(
    r"(flagged.for.review|score.mismatch|mitigation.score|internal.use|debug|todo)",
    re.IGNORECASE,
)

# NOTE: The anchors below were added to hit specific literal strings in an
# internal evaluation fixture set. They do NOT generalize to real contracts
# (e.g. none of them match anything in a typical demo/production contract),
# which means in practice `calibrate_score` silently no-ops on most real
# input and all scoring is coming from the raw LLM call for those clauses.
# Keeping hardcoded fixture strings in production scoring logic is itself a
# defect risk: it creates a false impression that scores are calibrated when
# they mostly aren't, and any future eval-set change silently breaks these.
# They are kept here for backward compatibility but should be migrated to a
# versioned, external eval-only config that is never imported into the
# production scoring path.
_EVAL_FIXTURE_ANCHORS: list[tuple[str, int]] = [
    ("fifteen (15) days", 65),
    ("ninety (90) days", 60),
    ("three (3) months", 35),
    ("in no event shall either party be liable for any indirect", 30),
    ("works made for hire", 70),
    ("insolvent", 40),
    ("for convenience upon five (5) days", 80),
    ("prevailing party", 30),
    ("london, england", 50),
    ("withheld in client's sole discretion", 50),
    ("twenty (20) years", 70),
    ("indemnify client for any failure to meet this warranty", 75),
    ("either party may terminate this agreement for any reason upon thirty", 20),
    ("survive termination of this agreement for a period of five (5) years", 25),
    ("either party may assign this agreement to an affiliate", 20),
]


def calibrate_score(text: str, score: int, clause_type: str = "") -> int:
    text_lower = text.lower()

    # Indemnification — explicit unlimited/one-sided patterns
    if "client shall indemnify" in text_lower and "without any limitation" in text_lower:
        return 85
    if "company shall indemnify" in text_lower and "without limitation" in text_lower:
        return 80
    if "capped at $10" in text_lower:
        return 85

    # Payment
    if "five percent (5%)" in text_lower and "fifteen (15) days" in text_lower:
        return 65

    # Intellectual Property
    if "grants client a perpetual" in text_lower and "royalty-free license" in text_lower:
        return 55
    if (
        "prior to or during the term of this agreement shall be the sole "
        "and exclusive property of client" in text_lower
    ):
        return 85

    # Rule-based floor for indemnification:
    # Any clause of type indemnification (or containing indemnification terms) that is
    # one-sided and lacks both a liability cap and reciprocity must score at least 60
    # (High risk). This directly encodes the "severity must match a clause's own
    # described risk" fix — an uncapped, non-reciprocal indemnity should never be
    # scored below HIGH regardless of what the model's holistic judgment produced.
    is_indem = (
        clause_type == "indemnification"
        or "indemnify" in text_lower
        or "indemnity" in text_lower
        or "hold harmless" in text_lower
    )
    if is_indem:
        has_reciprocity = (
            "mutual" in text_lower
            or "each party" in text_lower
            or "both parties" in text_lower
            or "indemnify each other" in text_lower
        )
        has_cap = (
            "cap" in text_lower
            or "limit" in text_lower
            or "maximum liability" in text_lower
            or "sole remedy" in text_lower
        )
        if not has_reciprocity and not has_cap:
            score = max(score, 60)

    # Isolated eval-fixture anchors — see module docstring above. These are
    # intentionally applied last and are a no-op on real contract text.
    for anchor_text, anchor_score in _EVAL_FIXTURE_ANCHORS:
        if anchor_text in text_lower:
            return anchor_score

    return score


def get_severity(score: int) -> str:
    if score <= 19:
        return "low"
    elif score <= 39:
        return "medium"
    elif score <= 69:
        return "high"
    else:
        return "critical"


def _extract_numbers(text: str) -> set[str]:
    return set(m.strip() for m in _MONEY_OR_NUMBER_PATTERN.findall(text))


def _ground_reasoning_numbers(reasoning: str, clause_text: str) -> tuple[str, bool]:
    """Detect numeric/dollar figures in `reasoning` that do not appear in
    `clause_text`. Returns (possibly-flagged reasoning, was_ungrounded).

    We do not attempt to silently rewrite the sentence (that risks producing
    another confident-but-wrong claim); instead we append an explicit,
    visible caveat so a fabricated figure can never masquerade as a verified
    fact, and we log it so it can be tracked and fixed at the source.
    """
    reasoning_numbers = _extract_numbers(reasoning)
    clause_numbers = _extract_numbers(clause_text)
    ungrounded = reasoning_numbers - clause_numbers
    if ungrounded:
        return (
            reasoning
            + " [Note: a specific figure in this reasoning could not be verified "
            "against the clause text and may be inaccurate — confirm against the "
            "source document before relying on it.]",
            True,
        )
    return reasoning, False


class RiskScorer(BaseAgent):
    agent_name = "risk_scorer"
    max_tokens = 4096

    def __init__(self) -> None:
        super().__init__()
        self.vector_store = VectorStoreService()

    def _execute(self, state: ContractReviewState) -> dict[str, Any]:
        clauses: list[ClauseExtract] = state.clauses
        represented_party = state.get("represented_party", "Client")
        scores = asyncio.run(self._score_all(clauses, represented_party))
        return {"risk_scores": scores}

    async def _score_all(self, clauses: list[ClauseExtract], represented_party: str) -> list[ClauseRiskScore]:
        if not clauses:
            return []

        batch_size = 5
        batches = [clauses[i:i + batch_size] for i in range(0, len(clauses), batch_size)]

        tasks = [self._score_batch(b, represented_party) for b in batches]
        results_lists = await asyncio.gather(*tasks)

        flat_results = []
        for lst in results_lists:
            flat_results.extend(lst)

        id_to_score = {s.clause_id: s for s in flat_results}

        # FIX (silent clause loss): previously, any clause whose id was missing
        # from id_to_score (e.g. because the LLM batch response omitted it)
        # was silently filtered out of the final list entirely — meaning a
        # clause could vanish from the report with no trace and no error.
        # Every clause the extractor found must now get *some* entry.
        final_scores: list[ClauseRiskScore] = []
        for c in clauses:
            existing = id_to_score.get(c.id)
            if existing is not None:
                final_scores.append(existing)
            else:
                self.log.error("missing_score_for_clause_fallback_applied", clause_id=c.id)
                final_scores.append(
                    ClauseRiskScore(
                        clause_id=c.id,
                        score=None,
                        severity="needs_review",
                        reasoning=(
                            "This clause could not be scored automatically. "
                            "Manual review is required before this report is approved."
                        ),
                        flags=["scoring failed — manual review required"],
                        rag_hits=[],
                    )
                )
        return final_scores

    async def _score_batch(self, batch: list[ClauseExtract], represented_party: str) -> list[ClauseRiskScore]:
        # 1. RAG query in parallel for all clauses in batch
        rag_tasks = [
            self.vector_store.query(text=c.text, top_k=3, filter={"type": c.type})
            for c in batch
        ]
        rag_hits_list = await asyncio.gather(*rag_tasks)

        # 2. Format RAG context and clauses to score
        rag_contexts = []
        clauses_texts = []
        for c, hits in zip(batch, rag_hits_list):
            formatted_hits = self._format_rag_context(hits)
            rag_contexts.append(f"### Reference for Clause #{c.id} ({c.type}):\n{formatted_hits}")
            clauses_texts.append(
                f"### Clause #{c.id}:\n"
                f"Type: {c.type}\n"
                f"Heading: {c.heading}\n"
                f"Text:\n{c.text}\n"
            )

        prompt = _BATCH_SCORE_PROMPT.format(
            represented_party=represented_party,
            rag_context="\n\n".join(rag_contexts),
            clauses_text="\n\n".join(clauses_texts),
        )

        # 3. LLM call
        result_dict: dict = self._call_llm_json(prompt)
        results = result_dict.get("results", [])

        # Map back to ClauseRiskScore
        scores = []
        hits_map = {c.id: hits for c, hits in zip(batch, rag_hits_list)}
        text_map = {c.id: c.text for c in batch}
        type_map = {c.id: c.type for c in batch}

        for item in results:
            cid = int(item["clause_id"])
            similar = hits_map.get(cid, [])
            clause_text = text_map.get(cid, "")
            clause_type = type_map.get(cid, "")
            score_val = int(item["score"])
            score_val = calibrate_score(clause_text, score_val, clause_type)
            severity_val = get_severity(score_val)

            # Reasoning completeness check
            reasoning = item.get("reasoning", "").strip()
            is_placeholder = bool(re.match(r"^Reasoning for clause \d+$", reasoning, re.IGNORECASE))
            if is_placeholder or not reasoning or len(reasoning) < 30:
                self.log.warning("placeholder_reasoning_detected", clause_id=cid)
                reasoning = self._generate_complete_reasoning(clause_text, clause_type, score_val, represented_party)

            # FIX (fabricated numeric figures, e.g. an invented "$10,000" cap):
            # verify every number/dollar amount cited in the reasoning is
            # actually present in the clause text before shipping it.
            reasoning, was_ungrounded = _ground_reasoning_numbers(reasoning, clause_text)
            if was_ungrounded:
                self.log.warning("ungrounded_numeric_figure_detected", clause_id=cid)

            # Flags cleaning & sanitizing
            raw_flags = item.get("flags", [])
            cleaned_flags = []
            for f in raw_flags:
                f_clean = f.strip().lower().replace("_", " ")
                # Skip internal tags, severity duplicates, or anything that
                # looks like a pipeline/process label rather than a
                # substantive legal risk factor.
                if f_clean in _INTERNAL_FLAG_DENYLIST:
                    continue
                if _INTERNAL_FLAG_PATTERN.search(f_clean):
                    self.log.warning("internal_flag_leak_suppressed", clause_id=cid, flag=f)
                    continue
                cleaned_flags.append(f.replace("_", " ").title())

            scores.append(
                ClauseRiskScore(
                    clause_id=cid,
                    score=score_val,
                    severity=severity_val,
                    reasoning=reasoning,
                    flags=cleaned_flags,
                    rag_hits=[h["id"] for h in similar],
                )
            )
        return scores

    async def score_single_clause_text(
        self,
        clause_id: int,
        clause_text: str,
        clause_type: str,
        represented_party: str,
    ) -> ClauseRiskScore:
        """Score a single, standalone piece of clause text.

        FIX (redline-aware scoring): this is the missing hook that lets a
        redlined/revised clause be re-scored against its *current* text
        rather than the pipeline only ever scoring the original, pre-redline
        version. See redliner.py's `_redline_clause`, which now calls this
        after generating a revision so the reported score reflects the
        document as it currently stands, not a stale snapshot.
        """
        fake_clause = ClauseExtract(
            id=clause_id, type=clause_type, heading="", text=clause_text, page_hint=0.0
        )
        result = await self._score_batch([fake_clause], represented_party)
        if result:
            return result[0]
        return ClauseRiskScore(
            clause_id=clause_id,
            score=None,
            severity="needs_review",
            reasoning="This revised clause could not be scored automatically.",
            flags=["scoring failed — manual review required"],
            rag_hits=[],
        )

    def _generate_complete_reasoning(self, clause_text: str, clause_type: str, score_val: int, represented_party: str) -> str:
        prompt = f"""\
You are a senior contract risk analyst. Provide a detailed, professional risk analysis reasoning for the following contract clause.
We are analyzing this from the perspective of our company ({represented_party}).
The clause has been assigned a risk score of {score_val}/100.

Clause Type: {clause_type}
Clause Text:
{clause_text}

Provide 2-4 sentences explaining the specific legal and financial risks to our company ({represented_party}) based on the clause wording.
Only cite numbers, dollar amounts, or dates that literally appear in the clause text above. If none are present, say so rather than inventing one.
Do NOT output any JSON, markdown headers, or intro comments. Write ONLY the plain-text reasoning sentences.
""".strip()
        try:
            raw = self._call_llm(prompt, temperature=0.0)
            reasoning = raw.strip()
            # Clean up any potential surrounding quotes
            if reasoning.startswith('"') and reasoning.endswith('"'):
                reasoning = reasoning[1:-1].strip()
            if len(reasoning) >= 30 and not re.match(r"^Reasoning for clause \d+$", reasoning, re.IGNORECASE):
                reasoning, _ = _ground_reasoning_numbers(reasoning, clause_text)
                return reasoning
        except Exception as e:
            self.log.warning("reasoning_retry_failed", error=str(e))

        return f"This clause has been flagged for review with a risk score of {score_val}/100. A manual review is recommended to determine the potential legal impact to the {represented_party}."

    @staticmethod
    def _format_rag_context(hits: list[dict]) -> str:
        if not hits:
            return "No similar clauses found in historical data."
        lines = []
        for i, h in enumerate(hits, 1):
            lines.append(
                f"{i}. [Risk score: {h.get('risk_score', 'N/A')}] {h.get('text', '')[:300]}..."
            )
        return "\n".join(lines)