# demo_contract_stress_test.docx — what to check

18 clauses, Solara Health Analytics ("Client") vs. Vantage CloudWorks ("Provider"),
Delaware-incorporated Client with Delaware governing law. Every clause is written
to test a specific thing the pipeline needs to get right — most of them target the
exact defects fixed in this session. Upload it, then check the review against this.

## 1. Perspective detection
The preamble frames Client as the buyer/recipient and Provider as the vendor —
`represented_party` should resolve to **Client**. Every score below assumes that.

## 2. Scoring: perspective must actually apply, not just "one-sided = risky"
| # | Clause | Expect | Why |
|---|---|---|---|
| 4 | Termination for Cause | **HIGH/CRITICAL** | One-sided against Client: Provider can walk in 5 days with no refund; Client needs 60 days + cure to get out. This is the clause meant to trigger a redline (score ≥ 40). |
| 8 | Intellectual Property Ownership | **LOW** | One-sided but *favorable* to Client (Client ends up owning the work product). If this scores HIGH, the perspective fix regressed — "one-sided" alone isn't risk, direction matters. |
| 10 | Provider Indemnification | **LOW** | Provider owes Client indemnification, capped by reference to the liability section. Favorable to Client. |
| 11 | Client Indemnification | **CRITICAL** | The textbook bad clause: Client owes Provider *uncapped, unconditional* indemnification with no reciprocity. Should hit the calibration floor in `calibrateScore()` regardless of what the model says on its own. |
| 3, 6, 9, 16, 17, 18 | Term/Confidentiality/Liability cap/Dispute/Force Majeure/Assignment | **LOW** | Genuinely mutual, market-standard terms. If these score MEDIUM+, the scorer is over-flagging boilerplate. |

## 3. Compliance: content-based gating, not type- or jurisdiction-based
| # | Clause type | Expect | Why |
|---|---|---|---|
| 7 | `data_protection` | **GDPR / UK GDPR flagged** | The obvious case — type matches, content matches. |
| 13 | `other` | **PCI-DSS flagged** | Cardholder data is mentioned in a clause about a benefits marketplace, typed `other`, not `payment`. Old type-allowlist gating would have skipped this entirely. |
| 14 | `service_level_agreement` | **HIPAA flagged** | PHI mentioned inside an uptime/SLA clause. Old type-allowlist gating would have skipped this too. |
| 15 | `governing_law` (Delaware) | **No SOX/FCPA/HIPAA flags anywhere else in the document** | This is the direct regression test for the old bug: Delaware governing law used to force SOX+FCPA+HIPAA checks onto *every* clause regardless of content. There's no financial-reporting or bribery content anywhere in this contract — if SOX or FCPA shows up flagged on any clause other than by genuine content match (there is none), the jurisdiction-based bug is back. |

## 4. Redline
Clause 4 and clause 11 are the only two that should clear the HIGH/CRITICAL
threshold and get redlined. For each, check:
- `changes[].original` is an exact substring of the original clause text (verified/diffed, not paraphrased).
- The revised text actually reduces risk *to Client* (e.g. clause 4's redline should add a cure period or refund provision for Client, not soften something that already favored Client).
- The re-score after redlining should drop meaningfully from the original.

## 5. Extraction
18 numbered headings, no nested sub-numbering to trip up the extractor (unlike
`demo_contract.docx` at the repo root, which has 2.1/3.2-style sub-clauses merged
into their parent — a different, complementary test). `extraction_integrity_warning`
should be null/absent; all 18 headings should come back with text that's an exact
substring of the source (the extractor now slices from source rather than having
the model retype it — nothing here should be paraphrased).

## 6. Executive summary
Should mention clause 4 and clause 11 by name as the key risks, should NOT
present clause 8 or clause 10 as risks (they're favorable to Client), and any
dollar figures or day counts it cites should trace back to numbers actually in
the contract (there's no dollar amount anywhere in this document — if the
summary invents one, that's a grounding failure).
