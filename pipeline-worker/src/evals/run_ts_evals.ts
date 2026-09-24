// Eval harness for the TS pipeline-worker (the pipeline the improvement
// brief targets). evals/run_evals.py evaluates a different, legacy Python
// implementation (backend/app/agents/*) that the README says was already
// replaced by this worker — see IMPROVEMENTS.md for why this harness
// exists instead of extending that one.
//
// Needs a working GROQ_API_KEY in .env. Run with: npm run eval
// (from pipeline-worker/). Writes JSON results to evals/results/.

import fs from 'fs';
import path from 'path';
import { RiskScorer } from '../agents/risk-scorer';
import { ComplianceChecker } from '../agents/compliance-checker';
import { ClauseExtractor } from '../agents/clause-extractor';
import { ClauseExtract, ContractReviewState } from '../pipeline/state';

const DATASETS_DIR = path.join(__dirname, '../../../evals/datasets');
const RESULTS_DIR = path.join(__dirname, '../../../evals/results');

function loadJsonl(file: string): any[] {
  return fs
    .readFileSync(path.join(DATASETS_DIR, file), 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

function writeResults(name: string, data: any) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const file = path.join(RESULTS_DIR, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  console.log(`  -> wrote ${path.relative(process.cwd(), file)}`);
}

const SCORE_TOLERANCE = 20;

async function runScoringEval() {
  console.log('\n=== Scoring eval (evals/datasets/labelled_clauses.jsonl) ===');
  const rows = loadJsonl('labelled_clauses.jsonl');
  const scorer = new RiskScorer();

  let correctScore = 0;
  let correctSeverity = 0;
  const absErrors: number[] = [];
  const perExample: any[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const predicted = await scorer.scoreSingleClauseText(
      i + 1,
      row.clause_text,
      row.clause_type,
      row.represented_party || 'Client'
    );
    const absError = Math.abs(predicted.score - row.expected_score);
    const scoreOk = absError <= SCORE_TOLERANCE;
    const severityOk = predicted.severity === row.expected_severity;

    correctScore += scoreOk ? 1 : 0;
    correctSeverity += severityOk ? 1 : 0;
    absErrors.push(absError);

    perExample.push({
      index: i,
      clause_type: row.clause_type,
      represented_party: row.represented_party || 'Client',
      expected_score: row.expected_score,
      predicted_score: predicted.score,
      abs_error: absError,
      expected_severity: row.expected_severity,
      predicted_severity: predicted.severity,
      score_correct: scoreOk,
      severity_correct: severityOk,
    });
  }

  const n = rows.length;
  const summary = {
    dataset_size: n,
    score_accuracy: correctScore / n,
    severity_accuracy: correctSeverity / n,
    mean_absolute_error: absErrors.reduce((a, b) => a + b, 0) / n,
  };
  console.log(summary);
  writeResults(`scoring-${Date.now()}`, { summary, per_example: perExample });
  return summary;
}

async function runComplianceEval() {
  console.log('\n=== Compliance eval (evals/datasets/labelled_compliance.jsonl) ===');
  const rows = loadJsonl('labelled_compliance.jsonl');
  const checker = new ComplianceChecker();

  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  const perExample: any[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const clause: ClauseExtract = { id: 1, type: row.clause_type, heading: '', text: row.clause_text };
    const state = { clauses: [clause] } as Partial<ContractReviewState> as ContractReviewState;
    const result = await checker.execute(state);
    const flagged = new Set((result.compliance_results?.[0]?.violations || []).map((v: any) => v.framework));
    const expected = new Set<string>(row.expected_violated_frameworks || []);

    for (const f of flagged) if (expected.has(f)) truePositives++;
    for (const f of flagged) if (!expected.has(f)) falsePositives++;
    for (const f of expected) if (!flagged.has(f)) falseNegatives++;

    perExample.push({
      index: i,
      clause_type: row.clause_type,
      expected: [...expected],
      flagged: [...flagged],
    });
  }

  const precision = truePositives + falsePositives > 0 ? truePositives / (truePositives + falsePositives) : 1;
  const recall = truePositives + falseNegatives > 0 ? truePositives / (truePositives + falseNegatives) : 1;
  const summary = { dataset_size: rows.length, precision, recall, truePositives, falsePositives, falseNegatives };
  console.log(summary);
  writeResults(`compliance-${Date.now()}`, { summary, per_example: perExample });
  return summary;
}

async function runExtractionEval() {
  console.log('\n=== Extraction eval (evals/datasets/long_contract.txt) ===');
  const contractText = fs.readFileSync(path.join(DATASETS_DIR, 'long_contract.txt'), 'utf8');
  const expectedHeadingCount = (contractText.match(/^\d+\.\s/gm) || []).length;

  const extractor = new ClauseExtractor();
  const state = { contract_text: contractText } as Partial<ContractReviewState> as ContractReviewState;
  const result = await extractor.execute(state);
  const clauses = result.clauses || [];

  const recall = expectedHeadingCount > 0 ? clauses.length / expectedHeadingCount : 0;
  const coverageChars = clauses.reduce((sum, c) => sum + c.text.length, 0);
  const summary = {
    expected_heading_count: expectedHeadingCount,
    extracted_count: clauses.length,
    recall,
    integrity_warning: result.extraction_integrity_warning || null,
    total_source_chars: contractText.length,
    covered_chars: coverageChars,
  };
  console.log(summary);
  writeResults(`extraction-${Date.now()}`, { summary, clauses });
  return summary;
}

async function main() {
  const which = process.argv[2] || 'all';
  if (which === 'all' || which === 'scoring') await runScoringEval();
  if (which === 'all' || which === 'compliance') await runComplianceEval();
  if (which === 'all' || which === 'extraction') await runExtractionEval();
}

main().catch((err) => {
  console.error('Eval run failed:', err);
  process.exit(1);
});
