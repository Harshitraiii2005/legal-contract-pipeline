"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LexAIPipelineSDK = void 0;
const orchestrator_1 = require("./pipeline/orchestrator");
const config_1 = require("./config");
class LexAIPipelineSDK {
    orchestrator;
    constructor(options) {
        // Override configurations if provided via SDK constructor
        if (options?.groqApiKey) {
            config_1.config.groqApiKey = options.groqApiKey;
        }
        if (options?.groqModel) {
            config_1.config.groqModel = options.groqModel;
        }
        this.orchestrator = new orchestrator_1.Orchestrator();
    }
    /**
     * Analyzes a contract text end-to-end through the multi-agent AI pipeline.
     *
     * @param contractId Unique identifier for this analysis session.
     * @param contractName Name of the contract document.
     * @param contractText Raw text content of the contract.
     * @param representedParty The party whose interest the analysis represents (e.g. "Client" or "Provider"). If omitted, it is auto-detected.
     * @returns The fully populated ContractReviewState with extracted clauses, risk scores, compliance checking, redline edits, and reports.
     */
    async analyzeContract(contractId, contractName, contractText, representedParty) {
        if (!contractText || !contractText.trim()) {
            throw new Error('Contract text must not be empty');
        }
        const initialState = {
            contract_id: contractId,
            contract_name: contractName,
            contract_text: contractText,
            represented_party: representedParty || 'Client',
            user_id: 'sdk-user',
            clauses: [],
            risk_scores: [],
            compliance_results: [],
            redline_edits: [],
        };
        return this.orchestrator.runPipeline(initialState);
    }
}
exports.LexAIPipelineSDK = LexAIPipelineSDK;
