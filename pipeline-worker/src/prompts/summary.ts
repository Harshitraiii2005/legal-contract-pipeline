export const SUMMARY_PROMPT = `\
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
`.trim();
