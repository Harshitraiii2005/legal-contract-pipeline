// Runnable self-check for the deterministic (non-LLM) logic touched by the
// defect fixes. No test framework: plain assert, run with `npm test`. Not a
// substitute for the LLM evals in evals/ — those need a working
// OPENAI_API_KEY (see IMPROVEMENTS.md) — but this catches regressions in the
// parts that don't need one: severity bands, the one remaining calibration
// rule, redline verification/diffing, heading location, and compliance
// gating.

import assert from 'assert';
import { calibrateScore, getSeverity } from './agents/risk-scorer';
import { REDLINE_SCORE_THRESHOLD, SEVERITY_THRESHOLDS } from './constants';
import { diffToChanges } from './utils/text-diff';
import { findHeadingPosition } from './agents/clause-extractor';
import { clauseNeedsComplianceCheck } from './prompts/compliance';

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
}

console.log('getSeverity / threshold agreement');
check('boundaries match SEVERITY_THRESHOLDS exactly', () => {
  assert.strictEqual(getSeverity(0), 'low');
  assert.strictEqual(getSeverity(19), 'low');
  assert.strictEqual(getSeverity(20), 'medium');
  assert.strictEqual(getSeverity(39), 'medium');
  assert.strictEqual(getSeverity(40), 'high');
  assert.strictEqual(getSeverity(69), 'high');
  assert.strictEqual(getSeverity(70), 'critical');
  assert.strictEqual(getSeverity(100), 'critical');
});
check('redliner redlines every HIGH/CRITICAL clause (the original bug: HIGH started at 40 but redline threshold was 60)', () => {
  assert.strictEqual(REDLINE_SCORE_THRESHOLD, SEVERITY_THRESHOLDS.high);
  assert.strictEqual(getSeverity(REDLINE_SCORE_THRESHOLD), 'high');
  assert.strictEqual(getSeverity(REDLINE_SCORE_THRESHOLD - 1), 'medium');
});

console.log('calibrateScore (only the one remaining principled rule)');
check('uncapped non-mutual indemnification gets a HIGH floor', () => {
  const scored = calibrateScore('Our company shall indemnify the counterparty for any and all claims.', 10, 'indemnification');
  assert.ok(scored >= SEVERITY_THRESHOLDS.high, `expected >= ${SEVERITY_THRESHOLDS.high}, got ${scored}`);
});
check('mutual indemnification is left alone (no floor applied)', () => {
  const scored = calibrateScore('Each party shall indemnify the other for its own breach.', 10, 'indemnification');
  assert.strictEqual(scored, 10);
});
check('capped indemnification is left alone (no floor applied)', () => {
  const scored = calibrateScore('Our company shall indemnify the counterparty, capped at the fees paid.', 10, 'indemnification');
  assert.strictEqual(scored, 10);
});
check('no eval-fixture phrase table left (this exact phrase used to force score=85)', () => {
  const scored = calibrateScore('The cap on liability is set at $10 for this section.', 5, 'other');
  assert.strictEqual(scored, 5, 'a bare dollar-figure phrase must not force a specific score anymore');
});
check('score is clamped to [0, 100]', () => {
  assert.strictEqual(calibrateScore('irrelevant text', 150, 'other'), 100);
  assert.strictEqual(calibrateScore('irrelevant text', -10, 'other'), 0);
});

console.log('diffToChanges (redline fallback when the model\'s "original" is not verbatim)');
check('produces a replace change for a substituted phrase', () => {
  const changes = diffToChanges('Company shall indemnify Client without limit.', 'Company shall indemnify Client up to $50,000.');
  assert.ok(changes.length > 0, 'expected at least one change');
  const joinedOriginal = changes.map((c) => c.original).join(' ');
  assert.ok(joinedOriginal.includes('without limit'), `expected removed text to include "without limit", got: ${joinedOriginal}`);
});
check('identical text produces no changes', () => {
  const changes = diffToChanges('Same clause text.', 'Same clause text.');
  assert.strictEqual(changes.length, 0);
});

console.log('findHeadingPosition (extraction now slices from source instead of the model re-typing it)');
const sampleDoc = '1. Confidentiality: text here.\n2. Governing Law: more text.\n1. Confidentiality: a decoy repeat.';
check('finds an exact heading', () => {
  const idx = findHeadingPosition(sampleDoc, '2. Governing Law:', 0);
  assert.strictEqual(idx, sampleDoc.indexOf('2. Governing Law:'));
});
check('search is monotonic — does not match an earlier duplicate once past it', () => {
  const firstIdx = findHeadingPosition(sampleDoc, '1. Confidentiality:', 0);
  const secondIdx = findHeadingPosition(sampleDoc, '1. Confidentiality:', firstIdx + 1);
  assert.ok(secondIdx > firstIdx, `expected second match after first (${firstIdx}), got ${secondIdx}`);
});
check('returns -1 for a heading not present in the source (hallucinated heading)', () => {
  const idx = findHeadingPosition(sampleDoc, '99. Nonexistent Clause:', 0);
  assert.strictEqual(idx, -1);
});
check('tolerates whitespace drift (fuzzy fallback)', () => {
  const idx = findHeadingPosition(sampleDoc, '2.  Governing   Law:', 0);
  assert.strictEqual(idx, sampleDoc.indexOf('2. Governing Law:'));
});

console.log('clauseNeedsComplianceCheck (content-based gating, not just clause type)');
check('a data_protection-typed clause is always checked', () => {
  assert.strictEqual(clauseNeedsComplianceCheck('data_protection', 'irrelevant boilerplate'), true);
});
check('a "service_level_agreement"-typed clause with PHI content is still checked (the original bug)', () => {
  assert.strictEqual(
    clauseNeedsComplianceCheck('service_level_agreement', 'The Provider will maintain uptime for storing Protected Health Information.'),
    true
  );
});
check('a genuinely irrelevant clause is skipped', () => {
  assert.strictEqual(clauseNeedsComplianceCheck('other', 'Notices shall be sent by certified mail to the addresses above.'), false);
});

console.log(`\n${passed} checks passed.`);
