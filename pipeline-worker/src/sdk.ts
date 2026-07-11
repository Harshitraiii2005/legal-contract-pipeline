import { Orchestrator } from './pipeline/orchestrator';
import { ContractReviewState } from './pipeline/state';
import { config } from './config';

export interface SDKOptions {
  groqApiKey?: string;
  groqModel?: string;
}

export class LexAIPipelineSDK {
  private orchestrator: Orchestrator;

  constructor(options?: SDKOptions) {
    // Override configurations if provided via SDK constructor
    if (options?.groqApiKey) {
      config.groqApiKey = options.groqApiKey;
    }
    if (options?.groqModel) {
      config.groqModel = options.groqModel;
    }
    this.orchestrator = new Orchestrator();
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
  async analyzeContract(
    contractId: string,
    contractName: string,
    contractText: string,
    representedParty?: string
  ): Promise<ContractReviewState> {
    if (!contractText || !contractText.trim()) {
      throw new Error('Contract text must not be empty');
    }

    const initialState: ContractReviewState = {
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
