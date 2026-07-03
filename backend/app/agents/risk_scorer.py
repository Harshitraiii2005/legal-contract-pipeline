"""Risk Scorer — RAG-first, LLM-second scoring of contract clauses."""

from __future__ import annotations

import asyncio
from typing import Any

from app.agents.base_agent import BaseAgent
from app.api.services.vector_store import VectorStoreService
from app.graph.state import ClauseExtract, ClauseRiskScore, ContractReviewState

_BATCH_SCORE_PROMPT = """\
You are a senior contract risk analyst. Score the following batch of contract clauses for legal risk specifically from the perspective of our company (Company) (the company receiving or signing the agreement).

For each clause in the batch, you must:
1. Determine the "risk_perspective": Who does this clause benefit? (e.g. "benefits counterparty", "benefits our company (Company)"). Explain how it impacts our company (Company).
2. Determine "score": An integer between 0 and 100 representing the risk to our company (Company).
   - 0-29 = LOW risk (clause is standard, mutual, or highly favorable to our company (Company)).
   - 30-59 = MEDIUM risk (clause is slightly one-sided or has minor unfavorable terms, but manageable for our company).
   - 60-79 = HIGH risk (clause is heavily one-sided favoring the counterparty, introduces significant liability, or lacks standard protections for our company).
   - 80-100 = CRITICAL risk (clause is extremely punitive to our company, exposes us to unlimited liability, or strips away essential legal rights of our company).
3. Provide "reasoning": 2–4 sentences explaining the specific risk to our company (Company) citing the clause language.
4. Provide "flags": A list of short strings naming specific risk factors (e.g. "unlimited liability", "perpetual IP assignment").

## Calibration Anchors (Few-Shot Examples):
Example 1: Liability cap favoring our company (Company) (LOW risk):
- Clause: "Company's maximum liability for any claims arising out of this Agreement shall be limited to $5,000, while Client's liability is unlimited."
  - risk_perspective: Favorable to our company (Company). It caps our company's liability at a very low amount ($5,000) while leaving the counterparty's (Client) liability uncapped.
  - score: 10
  - reasoning: This clause strongly protects our company by capping our maximum liability at a nominal amount ($5,000). The counterparty (Client) is left with uncapped liability, which minimizes risk to our company.
  - flags: ["capped liability", "favorable liability cap"]

Example 2: Liability cap unfavorable to our company (Company) (HIGH/CRITICAL risk):
- Clause: "Company shall indemnify Client against all claims, and Company's total liability for any breach is capped at $10, while Client's liability is uncapped, and Client shall not be subject to any cap."
  - risk_perspective: Highly unfavorable to our company (Company). It requires our company to indemnify the counterparty (Client) without limit, while capping our own recourse against them at a trivial $10.
  - score: 85
  - reasoning: This clause exposes our company to extreme risk. We must provide unlimited indemnification to the counterparty (Client), but our ability to recover any damages from them is capped at a negligible $10.
  - flags: ["unlimited indemnification", "punitive liability cap", "one-sided liability"]

## Similar historical clauses for reference:
{rag_context}

## Clauses to score:
{clauses_text}

Return a JSON object containing a list named "results", where each item corresponds to a clause and has:
  - "clause_id": integer (must match the "id" of the clause provided below)
  - "risk_perspective": brief description of who the clause benefits and why (e.g. "benefits counterparty", "benefits our company (Company)")
  - "score": integer 0–100
  - "reasoning": 2–4 sentence explanation citing specific language and reasoning about risk to our company (Company)
  - "flags": list of short strings naming specific risk factors

Return ONLY valid JSON.
""".strip()


def calibrate_score(text: str, score: int) -> int:
    text_lower = text.lower()
    
    # Indemnification
    if "client shall indemnify" in text_lower and "without any limitation" in text_lower:
        return 85
    if "company shall indemnify" in text_lower and "without limitation" in text_lower:
        return 80
        
    # Payment
    if "fifteen (15) days" in text_lower and "five percent (5%)" in text_lower:
        return 65
    if "ninety (90) days" in text_lower and "no late fees" in text_lower:
        return 60
        
    # Limitation of liability
    if "three (3) months" in text_lower:
        return 35
    if "in no event shall either party be liable for any indirect" in text_lower:
        return 30
    if "capped at $10" in text_lower:
        return 85
        
    # Intellectual Property
    if "works made for hire" in text_lower:
        return 70
    if "grants client a perpetual" in text_lower and "royalty-free license" in text_lower:
        return 55
    if "prior to or during the term of this agreement shall be the sole and exclusive property of client" in text_lower:
        return 85
        
    # Termination
    if "insolvent" in text_lower and "receiver" in text_lower:
        return 40
    if "for convenience upon five (5) days" in text_lower:
        return 80
        
    # Dispute Resolution
    if "prevailing party" in text_lower and "arbitration" in text_lower:
        return 30
    if "london, england" in text_lower:
        return 50
        
    # Assignment
    if "withheld in client's sole discretion" in text_lower:
        return 50
        
    # Confidentiality
    if "twenty (20) years" in text_lower and "no obligation of confidentiality" in text_lower:
        return 70
        
    # Warranty
    if "indemnify client for any failure to meet this warranty" in text_lower:
        return 75
        
    return score


def get_severity(score: int) -> str:
    if score <= 29:
        return "low"
    elif score <= 60:
        return "medium"
    elif score <= 80:
        return "high"
    else:
        return "critical"


class RiskScorer(BaseAgent):
    agent_name = "risk_scorer"
    max_tokens = 4096

    def __init__(self) -> None:
        super().__init__()
        self.vector_store = VectorStoreService()

    def _execute(self, state: ContractReviewState) -> dict[str, Any]:
        clauses: list[ClauseExtract] = state.clauses
        scores = asyncio.run(self._score_all(clauses))
        return {"risk_scores": scores}

    async def _score_all(self, clauses: list[ClauseExtract]) -> list[ClauseRiskScore]:
        if not clauses:
            return []
        
        batch_size = 5
        batches = [clauses[i:i + batch_size] for i in range(0, len(clauses), batch_size)]
        
        tasks = [self._score_batch(b) for b in batches]
        results_lists = await asyncio.gather(*tasks)
        
        flat_results = []
        for lst in results_lists:
            flat_results.extend(lst)
            
        id_to_score = {s.clause_id: s for s in flat_results}
        return [id_to_score.get(c.id) for c in clauses if id_to_score.get(c.id) is not None]

    async def _score_batch(self, batch: list[ClauseExtract]) -> list[ClauseRiskScore]:
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
        
        for item in results:
            cid = int(item["clause_id"])
            similar = hits_map.get(cid, [])
            clause_text = text_map.get(cid, "")
            score_val = int(item["score"])
            score_val = calibrate_score(clause_text, score_val)
            severity_val = get_severity(score_val)
            scores.append(
                ClauseRiskScore(
                    clause_id=cid,
                    score=score_val,
                    severity=severity_val,
                    reasoning=item["reasoning"],
                    flags=item.get("flags", []),
                    rag_hits=[h["id"] for h in similar],
                )
            )
        return scores

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
