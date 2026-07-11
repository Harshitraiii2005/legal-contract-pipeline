import { BaseAgent } from './base-agent';
import { RiskScorer } from './risk-scorer';
import { ClauseExtract, ClauseRiskScore, RedlineEdit, ContractReviewState } from '../pipeline/state';

const REDLINE_PROMPT = `\
You are an expert contract attorney. The following clause has been flagged as
high-risk. Propose a revised version that reduces risk while preserving the
commercial intent of the clause.

Risk Score: {score}/100
Risk Flags: {flags}
Compliance Issues: {compliance_issues}

ORIGINAL CLAUSE:
{original_text}

Return a JSON object with:
  - "revised_text": the full revised clause text
  - "changes": list of objects, each with:
      - "original": the exact phrase being removed/changed
      - "replacement": the replacement phrase (empty string if deleting)
      - "rationale": one-sentence explanation
  - "attorney_note": brief note to the reviewing lawyer

Return ONLY valid JSON.
`.trim();

const HIGH_RISK_THRESHOLD = 60;
const MISMATCH_TOLERANCE_POINTS = 5;

function noteImpliesRiskReduction(note: string): boolean {
  const noteLower = note.toLowerCase();
  const phrases = ['reduc', 'lower', 'mitigat', 'limit', 'cap', 'less risk', 'decrease'];
  return phrases.some((phrase) => noteLower.includes(phrase));
}

export class Redliner extends BaseAgent {
  readonly agentName = 'redliner';
  protected maxTokens = 2048;
  private scorer: RiskScorer;

  constructor() {
    super();
    this.scorer = new RiskScorer();
  }

  async execute(state: ContractReviewState): Promise<Partial<ContractReviewState>> {
    const clauses = state.clauses || [];
    const scores = state.risk_scores || [];
    const compliance = state.compliance_results || [];
    const representedParty = state.represented_party || 'Client';

    const scoreMap = new Map<number, ClauseRiskScore>();
    for (const s of scores) {
      scoreMap.set(s.clause_id, s);
    }

    const complianceMap = new Map<number, any>();
    for (const c of compliance) {
      complianceMap.set(c.clause_id, c);
    }

    const highRisk = clauses.filter((c) => {
      const s = scoreMap.get(c.id);
      return s && s.score !== undefined && s.score >= HIGH_RISK_THRESHOLD;
    });

    const edits = await this.redlineAll(highRisk, scoreMap, complianceMap, representedParty);
    const mismatchCount = edits.filter((e) => e.mitigation_score_mismatch).length;

    console.log(`[redlines_generated] Count: ${edits.length}, Mismatches: ${mismatchCount}`);

    return { redline_edits: edits };
  }

  private async redlineAll(
    clauses: ClauseExtract[],
    scoreMap: Map<number, ClauseRiskScore>,
    complianceMap: Map<number, any>,
    representedParty: string
  ): Promise<RedlineEdit[]> {
    const tasks = clauses.map((c) => {
      const score = scoreMap.get(c.id)!;
      const comp = complianceMap.get(c.id);
      return this.redlineClause(c, score, comp, representedParty);
    });
    return Promise.all(tasks);
  }

  private async redlineClause(
    clause: ClauseExtract,
    score: ClauseRiskScore,
    compliance: any,
    representedParty: string
  ): Promise<RedlineEdit> {
    let complianceIssues = '';
    if (compliance && !compliance.compliant && compliance.violations) {
      const issues = compliance.violations.map((v: any) => v.description);
      complianceIssues = issues.join('; ');
    }

    const prompt = REDLINE_PROMPT.replace('{score}', String(score.score))
      .replace('{flags}', score.flags.join(', '))
      .replace('{compliance_issues}', complianceIssues || 'None')
      .replace('{original_text}', clause.text);

    const result = await this.callLlmJson(prompt);
    const revisedText = result.revised_text;
    const attorneyNote = result.attorney_note || '';

    // Re-score the revised text
    const mitigatedResult = await this.scorer.scoreSingleClauseText(
      clause.id,
      revisedText,
      clause.type,
      representedParty
    );
    const mitigatedScore = mitigatedResult.score;

    let mismatch = false;
    if (
      mitigatedScore !== undefined &&
      score.score !== undefined &&
      noteImpliesRiskReduction(attorneyNote) &&
      mitigatedScore > score.score - MISMATCH_TOLERANCE_POINTS
    ) {
      mismatch = true;
      console.warn(
        `[redline_mitigation_score_mismatch] Clause ID: ${clause.id}, Original: ${score.score}, Mitigated: ${mitigatedScore}`
      );
    }

    return {
      clause_id: clause.id,
      original_text: clause.text,
      revised_text: revisedText,
      changes: result.changes || [],
      attorney_note: attorneyNote,
      original_score: score.score,
      mitigated_score: mitigatedScore,
      mitigation_score_mismatch: mismatch,
    };
  }
}
