import { BaseAgent } from './base-agent';
import { RiskScorer } from './risk-scorer';
import { ClauseExtract, ClauseRiskScore, RedlineEdit, ContractReviewState } from '../pipeline/state';
import { REDLINE_PROMPT, RedlineResultSchema } from '../prompts/redline';
import { REDLINE_SCORE_THRESHOLD } from '../constants';
import { diffToChanges } from '../utils/text-diff';

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
      return s && s.score !== undefined && s.score >= REDLINE_SCORE_THRESHOLD;
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

    const prompt = REDLINE_PROMPT.replace(/{represented_party}/g, representedParty)
      .replace('{clause_type}', clause.type)
      .replace('{score}', String(score.score))
      .replace('{flags}', score.flags.join(', '))
      .replace('{compliance_issues}', complianceIssues || 'None')
      .replace('{original_text}', clause.text);

    let result = await this.callLlmObject(prompt, RedlineResultSchema);
    let revisedText = result.revised_text;
    let attorneyNote = result.attorney_note;
    let changes: RedlineEdit['changes'] = result.changes;

    // The model's `changes[].original` must be an exact substring of the
    // source clause — attorneys review redlines by locating "original" in
    // the source text, and a paraphrased or invented "original" makes the
    // redline unusable. Retry once with the bad values called out, then
    // fall back to a code-computed diff rather than ship an unverifiable
    // change list.
    let unverified = this.findUnverifiedChanges(changes, clause.text);
    if (unverified.length > 0) {
      console.warn(`[redline_change_not_verbatim] Clause ID: ${clause.id}, Unverified: ${unverified.length}`);
      const retryPrompt =
        prompt +
        `\n\nCRITICAL: In your previous response, these "original" values were not found ` +
        `verbatim (exact substring, same spelling/punctuation/case) in the ORIGINAL CLAUSE: ` +
        `${JSON.stringify(unverified)}. Fix "changes" so every "original" is copied exactly ` +
        `from the ORIGINAL CLAUSE text above.`;
      try {
        result = await this.callLlmObject(retryPrompt, RedlineResultSchema);
        revisedText = result.revised_text || revisedText;
        attorneyNote = result.attorney_note || attorneyNote;
        changes = result.changes;
        unverified = this.findUnverifiedChanges(changes, clause.text);
      } catch (e: any) {
        console.warn(`[redline_verification_retry_failed] Clause ID: ${clause.id}, Error: ${e.message}`);
      }
    }

    if (unverified.length > 0) {
      console.warn(`[redline_change_fallback_to_diff] Clause ID: ${clause.id}`);
      changes = diffToChanges(clause.text, revisedText);
    }

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
      changes,
      attorney_note: attorneyNote,
      original_score: score.score,
      mitigated_score: mitigatedScore,
      mitigation_score_mismatch: mismatch,
    };
  }

  private findUnverifiedChanges(changes: RedlineEdit['changes'], sourceText: string): string[] {
    const unverified: string[] = [];
    for (const c of changes || []) {
      const original = (c.original || '').trim();
      if (original && !sourceText.includes(original)) {
        unverified.push(original);
      }
    }
    return unverified;
  }
}
