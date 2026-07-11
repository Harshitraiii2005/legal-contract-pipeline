"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.orchestrator = exports.Orchestrator = void 0;
const clause_extractor_1 = require("../agents/clause-extractor");
const risk_scorer_1 = require("../agents/risk-scorer");
const compliance_checker_1 = require("../agents/compliance-checker");
const redliner_1 = require("../agents/redliner");
const report_writer_1 = require("../agents/report-writer");
class Orchestrator {
    extractor = new clause_extractor_1.ClauseExtractor();
    scorer = new risk_scorer_1.RiskScorer();
    compliance = new compliance_checker_1.ComplianceChecker();
    redliner = new redliner_1.Redliner();
    reporter = new report_writer_1.ReportWriter();
    async runPipeline(initialState) {
        console.log(`[orchestrator] Starting pipeline for contract: ${initialState.contract_id}`);
        // 1. Clause Extraction
        const extractResult = await this.extractor.execute(initialState);
        let state = {
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
        const compMap = new Map();
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
                        severity: (0, risk_scorer_1.getSeverity)(40),
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
exports.Orchestrator = Orchestrator;
exports.orchestrator = new Orchestrator();
