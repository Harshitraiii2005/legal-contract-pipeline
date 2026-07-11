import { orchestrator } from './pipeline/orchestrator';
import { buildRedlinedDocx } from './services/docx-builder';
import { buildRiskPdf } from './services/pdf-exporter';
import fs from 'fs/promises';

const sampleContract = `
MUTUAL NON-DISCLOSURE AGREEMENT
This Agreement is entered into on June 15, 2026 by and between LexAI Inc ("Company") and Acme Corp ("Client").

1. Confidentiality: Each party shall hold the other's Confidential Information in strict confidence. The receiving party's obligation to protect Confidential Information shall survive termination of this Agreement for a period of fifteen (15) years.
2. Governing Law: This Agreement shall be governed by and construed in accordance with the laws of the State of California.
3. Liability Cap: In no event shall Company's total cumulative liability for any and all claims arising under this Agreement exceed $10, while Client's liability under this Agreement shall be completely unlimited.
`;

async function test() {
  console.log('Starting test pipeline...');
  const state = await orchestrator.runPipeline({
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
    const docx = await buildRedlinedDocx(
      'Acme NDA',
      state.clauses || [],
      state.redline_edits || [],
      state.report.overall_score
    );
    const pdf = await buildRiskPdf(state.report, state.clauses || []);
    await fs.writeFile('test_redlined.docx', docx);
    await fs.writeFile('test_risk_report.pdf', pdf);
    console.log('Artifacts written successfully to test_redlined.docx and test_risk_report.pdf');
  }
}

test().catch(console.error);
