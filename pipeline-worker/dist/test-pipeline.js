"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const orchestrator_1 = require("./pipeline/orchestrator");
const docx_builder_1 = require("./services/docx-builder");
const pdf_exporter_1 = require("./services/pdf-exporter");
const promises_1 = __importDefault(require("fs/promises"));
const sampleContract = `
MUTUAL NON-DISCLOSURE AGREEMENT
This Agreement is entered into on June 15, 2026 by and between LexAI Inc ("Company") and Acme Corp ("Client").

1. Confidentiality: Each party shall hold the other's Confidential Information in strict confidence. The receiving party's obligation to protect Confidential Information shall survive termination of this Agreement for a period of fifteen (15) years.
2. Governing Law: This Agreement shall be governed by and construed in accordance with the laws of the State of California.
3. Liability Cap: In no event shall Company's total cumulative liability for any and all claims arising under this Agreement exceed $10, while Client's liability under this Agreement shall be completely unlimited.
`;
async function test() {
    console.log('Starting test pipeline...');
    const state = await orchestrator_1.orchestrator.runPipeline({
        contract_id: 'test-contract-123',
        contract_name: 'Acme NDA',
        contract_text: sampleContract,
        represented_party: 'Client',
        user_id: 'test-user-456',
        clauses: [],
        risk_scores: [],
        compliance_results: [],
        redline_edits: [],
    });
    console.log('\n--- Pipeline Finished! Report ---');
    console.log(JSON.stringify(state.report, null, 2));
    if (state.report) {
        console.log('\nGenerating artifacts...');
        const docx = await (0, docx_builder_1.buildRedlinedDocx)('Acme NDA', state.clauses || [], state.redline_edits || [], state.report.overall_score);
        const pdf = await (0, pdf_exporter_1.buildRiskPdf)(state.report, state.clauses || []);
        await promises_1.default.writeFile('test_redlined.docx', docx);
        await promises_1.default.writeFile('test_risk_report.pdf', pdf);
        console.log('Artifacts written successfully to test_redlined.docx and test_risk_report.pdf');
    }
}
test().catch(console.error);
