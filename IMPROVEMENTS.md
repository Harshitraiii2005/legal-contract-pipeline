# LexAI pipeline-worker: correctness & reliability improvements

This covers the 10 numbered defects in the improvement brief, all fixed in
`pipeline-worker/`, one commit per fix (see `git log`). Read the "Evals
blocked" section before trusting any number in this file — most of what
would normally go in this table couldn't be measured this pass.

## The most important finding: the eval dataset was contaminated by the cheat it was meant to catch

Before touching anything, I read `evals/datasets/labelled_clauses.jsonl` (the
"gold" scores used to check the scorer) against `EVAL_FIXTURE_ANCHORS` and
the phrase-matched rules in `calibrateScore()` (defect #3 — see below). Every
one of the 25 pre-existing rows' `expected_score`/`expected_severity` matches
exactly what that phrase table would have forced. For example:

| Dataset row (expected) | Matching hardcoded rule in the old `calibrateScore()` |
|---|---|
| `"...fifteen (15) days..."` → 65 | `EVAL_FIXTURE_ANCHORS['fifteen (15) days'] = 65` |
| `"...capped at $10..."` → 85 | `EVAL_FIXTURE_ANCHORS['capped at $10'] = 85` |
| `"...for convenience upon five (5) days..."` → 80 | `EVAL_FIXTURE_ANCHORS['for convenience upon five (5) days'] = 80` |
| `"...twenty (20) years..."` → 70 | `EVAL_FIXTURE_ANCHORS['twenty (20) years'] = 70` |
| (all 25 rows) | (all 25 anchors/rules) |

This isn't "the eval score looks inflated" — it means the gold labels
themselves were reverse-engineered from the cheat, not from independent
legal judgment. A before/after comparison against this dataset would have
been circular: the "before" number would hit ~100% by construction (the code
was built to match these exact strings), and the "after" number — a real
model actually reasoning about each clause — would look like a *regression*
even where the real scoring is now more correct, simply because it no longer
parrots the fixture phrases back. Running the eval as originally set up
would have hidden the improvement, not proven it.

**What I did about it:** removed the phrase table (defect #3), kept the one
general rule that survives generalization testing (uncapped non-mutual
indemnification gets a HIGH floor — verified in `src/selfcheck.ts`), and
added `represented_party` plus 6 new rows to the dataset that I authored
directly rather than back-deriving from code (see `evals/run_ts_evals.ts`
commit message). **These new labels are my own reasoned judgment, not
lawyer-reviewed** — flagging that so nobody mistakes them for a validated
gold standard either.

**Recommendation:** before trusting any scoring-eval number from this
dataset going forward, have someone re-label a sample of the 25 legacy rows
independently (without looking at the old code) and check whether the
now-fixed model's scores track the *re-labeled* values, not the original
ones.

## Evals blocked: no working GROQ_API_KEY

The `.env` file's `GROQ_API_KEY` returns `401 invalid_api_key` from Groq
(confirmed by actually running `pipeline-worker/src/test-pipeline.ts`). Per
the brief, the owner is rotating keys separately — this may already be the
rotated-out key. Every LLM-dependent check in this project (`npm run eval`,
`npm run dev`, `test-pipeline.ts`) is blocked until a valid key is in place.

**What's still verified without a key:** `pipeline-worker/src/selfcheck.ts`
(`npm test`, 16 assertions, all passing) covers every piece of *deterministic*
logic the 10 fixes touch — severity/threshold agreement, the one remaining
calibration rule, the redline diff fallback, heading-location for
extraction, and compliance content-gating. It does not and cannot cover
model behavior (prompt quality, JSON validity in practice, actual score
accuracy) — that needs `npm run eval` with a real key.

**To finish the evaluation once a key is available**, from `pipeline-worker/`:
```
npm test        # deterministic self-check, no API key needed
npm run eval     # scoring + compliance + extraction evals, needs GROQ_API_KEY
```
`run_ts_evals.ts` writes timestamped JSON to `evals/results/`. Run it once
before pulling this branch's fixes (checkout the parent commit of the first
fix, "Remove .env from git tracking...") and once after, to get a genuine
before/after — not against the contaminated dataset values, but you'll at
least see whether the fixed pipeline is internally consistent (JSON parse
success rate, severity/redline-threshold agreement in practice, compliance
precision/recall on the new non-contaminated compliance rows).

## Architecture discrepancy: which codebase this brief actually applies to

The brief describes "a Go (Fiber) API ... A Node/TypeScript worker
(`pipeline-worker/`)". The repo also contains `backend/app/agents/*.py` — a
full second implementation of the same 5-agent pipeline, in Python/Celery,
with its own `EVAL_FIXTURE_ANCHORS`/`calibrate_score` copy of the same
gaming defect. `README.md` states the project "transitioned from a
monolithic Python stack" to the Go+Node architecture, and the git log shows
`backend/` hasn't been touched recently while `pipeline-worker/` has (most
recent commits: "Update db.ts", "Update index.ts").

However, `evals/run_evals.py` — the *only* eval harness that existed before
this change — imports `backend.app.agents.risk_scorer`, i.e. it evaluates
the legacy Python code, not the TS worker the brief targets. Per the
brief's own instruction ("If something in the code contradicts this brief,
trust the code, note the difference, and continue"): I fixed
`pipeline-worker/` (the live pipeline per README + recent activity) and
built a new eval harness (`pipeline-worker/src/evals/run_ts_evals.ts`)
against it, rather than extending `run_evals.py` to evaluate dead code.
`backend/app/agents/*.py` has the identical bugs and was left untouched —
if it's actually still in use, the same 10 fixes should be ported there.

## Fixes, in brief order

| # | Fix | Commit | Verified by |
|---|---|---|---|
| 1 | Scoring few-shot examples rewritten in role terms ("our company"/"the counterparty"), not defined-term labels that flip meaning depending on which side we represent | `Fix backwards scoring examples...` | Reading; needs `npm run eval` for a live number |
| 2 | Redliner now receives `represented_party` + clause type | `Give redliner perspective awareness...` | Reading; needs live eval |
| 3 | Removed `EVAL_FIXTURE_ANCHORS` phrase table; kept one documented, generalizing rule | same commit | `npm test` — verifies the phrase `"capped at $10"` alone no longer forces score=85, and the indemnification floor still fires/doesn't fire correctly |
| 4 | Redline threshold and severity threshold now read from one shared constant (`REDLINE_SCORE_THRESHOLD = SEVERITY_THRESHOLDS.high = 40`), so HIGH clauses (40-59) are no longer silently skipped | `Give redliner perspective awareness...` | `npm test` |
| 5 | Compliance applicability decided from clause content (type allowlist + keyword scan), not governing-law jurisdiction keywords; every framework always checked, model marks inapplicable ones compliant | `Decide compliance applicability...` | `npm test` (content-gating cases) + `labelled_compliance.jsonl` rows 2 and 4, which directly target this bug, pending a live run |
| 6 | `changes[].original` verified as an exact substring of the source clause; retried once, then falls back to a code-computed word-diff (`src/utils/text-diff.ts`) | `Give redliner perspective awareness...` | `npm test` |
| 7 | Model returns headings+types only; clause text is sliced from the source contract text in code (`findHeadingPosition`), so it can no longer be dropped or reworded | `Slice clause text from source...` | `npm test` + `evals/datasets/long_contract.txt` (28-heading fixture), pending a live extraction run |
| 8 | `callLlmJson`'s brace-matching replaced with `generateObject` + zod schema per agent (`src/prompts/*.ts`); validation failures retry once with the error in-prompt | `Replace brace-matching JSON parsing...` | Compiles; schema-shape correctness is structural (TS + zod), can't verify actual first-attempt validity rate without live calls |
| 9 | Scorer retries only the specific clause ids the model dropped, instead of defaulting them to score=50 | `Fix backwards scoring examples...` | Reading (code path); needs a live run with an intentionally-truncated batch to exercise |
| 10 | Prompt cache loaded once into memory per process, persisted via atomic temp-file-then-rename instead of read-mutate-write on every call | `Replace brace-matching JSON parsing...` | Reading; the race this fixes only reproduces under concurrent load |

## Known weaknesses remaining, ranked by expected impact

1. **No live eval numbers exist for any of this yet.** This is the single
   biggest gap — everything above is verified by reading, type-checking, and
   the deterministic self-check, not by watching the actual model's
   behavior change. Get a valid `GROQ_API_KEY` and run `npm run eval`
   before/after (see above) before treating any of these fixes as proven in
   production.
2. **`backend/app/agents/*.py` has the same 10 bugs and wasn't touched.** If
   it's still deployed anywhere despite the README, it's a live liability —
   worth a quick confirmation of whether it's truly dead.
3. **The dataset contamination issue extends to what "correct" means for
   this whole project.** Even the new rows I added are my own reasoning, not
   lawyer-reviewed. A short review pass by an actual attorney on ~10 rows
   would tell you whether the scoring bands (`SEVERITY_THRESHOLDS` in
   `src/constants.ts`) are even calibrated to something real, independent of
   any code.
4. **Redline and summary evals aren't built yet.** `run_ts_evals.ts` covers
   scoring, compliance, and extraction; it doesn't yet measure "share of
   redlines with a lower re-score" or "share of summaries with no ungrounded
   numbers" from the brief's required metric list. Both are exercisable
   through `test-pipeline.ts`'s existing sample contract once a key works,
   but there's no automated pass/fail harness for them yet.
5. **`generateObject`'s actual behavior against Groq's `llama-3.3-70b`
   hasn't been observed.** The `ai` SDK + `@ai-sdk/groq` support structured
   output (confirmed by reading `node_modules/@ai-sdk/groq`'s types), but
   whether Groq's JSON mode is reliable enough in practice to avoid
   constant retries is an open question until it's actually run.
6. **`.env` still has other live-looking credentials** (Pinecone, SMTP)
   beyond the Groq key that was confirmed dead. Worth confirming those are
   part of the same rotation.
