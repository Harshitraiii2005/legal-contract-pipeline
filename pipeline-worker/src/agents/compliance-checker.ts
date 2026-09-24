import { BaseAgent } from './base-agent';
import { ClauseExtract, ComplianceResult, ContractReviewState } from '../pipeline/state';
import { COMPLIANCE_PROMPT, DEFAULT_FRAMEWORKS, clauseNeedsComplianceCheck } from '../prompts/compliance';

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

    const result = await this.callLlmJson(prompt);

    // Defensive parsing of recommendations
    const rawRecs = result.recommendations || [];
    const cleanRecs: string[] = [];
    if (Array.isArray(rawRecs)) {
      for (const r of rawRecs) {
        if (r && typeof r === 'object') {
          const val = r.recommendation || r.text || r.description || JSON.stringify(r);
          cleanRecs.push(val);
        } else if (r !== null && r !== undefined) {
          cleanRecs.push(String(r));
        }
      }
    } else if (rawRecs && typeof rawRecs === 'object') {
      const val = rawRecs.recommendation || rawRecs.text || rawRecs.description || JSON.stringify(rawRecs);
      cleanRecs.push(val);
    } else if (rawRecs) {
      cleanRecs.push(String(rawRecs));
    }

    // Defensive parsing of violations
    const rawViolations = result.violations || [];
    const cleanViolations: any[] = [];
    if (Array.isArray(rawViolations)) {
      for (const v of rawViolations) {
        if (v && typeof v === 'object') {
          const cleanV = { ...v };
          if (cleanV.article === undefined || cleanV.article === null) {
            cleanV.article = '';
          } else {
            cleanV.article = String(cleanV.article);
          }
          if (!cleanV.framework) {
            cleanV.framework = 'Unknown';
          }
          if (!cleanV.description) {
            cleanV.description = 'Compliance violation detected.';
          }
          cleanViolations.push(cleanV);
        }
      }
    }

    return {
      clause_id: clause.id,
      compliant: result.compliant ?? true,
      violations: cleanViolations,
      recommendations: cleanRecs,
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
