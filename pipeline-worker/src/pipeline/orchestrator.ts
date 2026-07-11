import { ClauseExtractor } from '../agents/clause-extractor';
import { RiskScorer, getSeverity } from '../agents/risk-scorer';
import { ComplianceChecker } from '../agents/compliance-checker';
import { Redliner } from '../agents/redliner';
import { ReportWriter } from '../agents/report-writer';
import { ContractReviewState } from './state';

export class Orchestrator {
  private extractor = new ClauseExtractor();
  private scorer = new RiskScorer();
  private compliance = new ComplianceChecker();
  private redliner = new Redliner();
  private reporter = new ReportWriter();

  async runPipeline(initialState: ContractReviewState): Promise<ContractReviewState> {
    console.log(`[orchestrator] Starting pipeline for contract: ${initialState.contract_id}`);

    // 1. Clause Extraction
    const extractResult = await this.extractor.execute(initialState);
    let state: ContractReviewState = {
      ...initialState,
      ...extractResult,
    };

    // 2. Parallel Analysis (Scoring & Compliance)
    const [scoredResult, complianceResult] = await Promise.all([
      this.scorer.execute(state),
      this.compliance.execute(state),
    ]);

    // Reconciliation step:
    // If a clause has compliance violations, force a floor of 40 on its risk score.
    const riskScores = scoredResult.risk_scores || [];
    const complianceResults = complianceResult.compliance_results || [];
    const compMap = new Map<number, any>();
    for (const r of complianceResults) {
      compMap.set(r.clause_id, r);
    }

    const reconciledScores = riskScores.map((s) => {
      const comp = compMap.get(s.clause_id);
      if (comp && comp.violations && comp.violations.length > 0) {
        if (s.score === undefined || s.score < 40) {
          const newFlags = [...(s.flags || [])];
          if (!newFlags.includes('compliance violation floor applied')) {
            newFlags.push('compliance violation floor applied');
          }
          return {
            ...s,
            score: 40,
            severity: getSeverity(40),
            flags: newFlags,
          };
        }
      }
      return s;
    });

    state = {
      ...state,
      risk_scores: reconciledScores,
      ...complianceResult,
    };

    // 3. Redlining
    const redlineResult = await this.redliner.execute(state);
    state = {
      ...state,
      ...redlineResult,
    };

    // 4. Report Writing
    const reportResult = await this.reporter.execute(state);
    state = {
      ...state,
      ...reportResult,
    };

    console.log(`[orchestrator] Pipeline completed for contract: ${initialState.contract_id}`);
    return state;
  }
}

export const orchestrator = new Orchestrator();
