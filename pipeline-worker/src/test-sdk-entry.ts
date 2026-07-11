import { LexAIPipelineSDK } from './sdk';

const sampleContract = `
MUTUAL NON-DISCLOSURE AGREEMENT
This Agreement is entered into on June 15, 2026 by and between LexAI Inc ("Company") and Acme Corp ("Client").

1. Confidentiality: Each party shall hold the other's Confidential Information in strict confidence. The receiving party's obligation to protect Confidential Information shall survive termination of this Agreement for a period of fifteen (15) years.
2. Governing Law: This Agreement shall be governed by and construed in accordance with the laws of the State of California.
`;

async function testSDK() {
  console.log('Initializing LexAIPipelineSDK...');
  const sdk = new LexAIPipelineSDK();

  console.log('Running analyzeContract via SDK...');
  const state = await sdk.analyzeContract(
    'sdk-test-123',
    'Acme NDA SDK',
    sampleContract,
    'Client'
  );

  console.log('\nSDK Run Completed! Generated Report:');
  console.log('Overall Score:', state.report?.overall_score);
  console.log('Clause Count:', state.report?.clause_count);
  console.log('Represented Party:', state.represented_party);
}

testSDK().catch(console.error);
