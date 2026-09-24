// Single source of truth for risk-severity bands, shared by the scorer
// (which assigns severity) and the redliner (which decides what to rewrite).
// Previously these disagreed: HIGH started at 40 in one place and 60 in the
// other, so clauses rated HIGH were silently skipped by the redliner.

export const SEVERITY_THRESHOLDS = {
  low: 0,
  medium: 20,
  high: 40,
  critical: 70,
} as const;

// Redline every clause rated HIGH or CRITICAL.
export const REDLINE_SCORE_THRESHOLD = SEVERITY_THRESHOLDS.high;
