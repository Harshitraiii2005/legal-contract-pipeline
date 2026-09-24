import { BaseAgent } from './base-agent';
import { ClauseExtract, ComplianceResult, ContractReviewState } from '../pipeline/state';
import { COMPLIANCE_PROMPT, DEFAULT_FRAMEWORKS, clauseNeedsComplianceCheck, ComplianceResultSchema } from '../prompts/compliance';

export { DEFAULT_FRAMEWORKS };

export class ComplianceChecker extends BaseAgent {
  readonly agentName = 'compliance_checker';
  protected maxTokens = 1024;
  private frameworks: string[];

  constructor(frameworks: string[] | null = null) {
    super();
    this.frameworks = frameworks || DEFAULT_FRAMEWORKS;
  }

  async execute(state: ContractReviewState): Promise<Partial<ContractReviewState>> {
    const clauses = state.clauses || [];
    // Every framework is always checked; applicability is decided by the
    // model from each clause's own content per COMPLIANCE_PROMPT's
    // applicability rules, not pre-selected from the contract's governing
    // law. Jurisdiction is a weak proxy — a US-governed contract might
    // process EU residents' data (GDPR still applies) or a UK-governed one
    // might process none (GDPR/UK GDPR don't), and pre-selecting by
    // jurisdiction keywords made those cases unreachable.
    const activeFrameworks = this.frameworks;

    const results = await this.checkAll(clauses, activeFrameworks);
    let violationCount = 0;
    let complianceViolationClauses = 0;

    for (const r of results) {
      if (r.violations && r.violations.length > 0) {
        violationCount += r.violations.length;
        complianceViolationClauses++;
      }
    }

    console.log(`[compliance_check_done] Total: ${results.length}, Violations: ${violationCount}`);

    return {
      compliance_results: results,
      compliance_violation_count: violationCount,
      compliance_violation_clauses: complianceViolationClauses,
      compliance_violation_issues: violationCount,
    };
  }

  private async checkAll(clauses: ClauseExtract[], frameworks: string[]): Promise<ComplianceResult[]> {
    // Gate on clause content, not just clause type — a data-processing
    // obligation can live inside a clause the extractor typed
    // "service_level_agreement" or "other", and type-only gating skipped
    // those (see clauseNeedsComplianceCheck in src/prompts/compliance.ts).
    const tasks = clauses.map((c) => {
      if (clauseNeedsComplianceCheck(c.type, c.text)) {
        return this.checkClause(c, frameworks);
      } else {
        return this.skipClause(c);
      }
    });

    return Promise.all(tasks);
  }

  private async checkClause(clause: ClauseExtract, frameworks: string[]): Promise<ComplianceResult> {
    const prompt = COMPLIANCE_PROMPT.replace('{frameworks}', frameworks.join(', '))
      .replace('{clause_type}', clause.type)
      .replace('{clause_text}', clause.text);

    // ComplianceResultSchema enforces shape and applies the same defaults
    // (missing framework -> "Unknown", missing article -> "", etc.) that
    // used to be hand-rolled here field by field.
    const result = await this.callLlmObject(prompt, ComplianceResultSchema);

    return {
      clause_id: clause.id,
      compliant: result.compliant,
      violations: result.violations,
      recommendations: result.recommendations,
    };
  }

  private async skipClause(clause: ClauseExtract): Promise<ComplianceResult> {
    return {
      clause_id: clause.id,
      compliant: true,
      violations: [],
      recommendations: [],
    };
  }
}
