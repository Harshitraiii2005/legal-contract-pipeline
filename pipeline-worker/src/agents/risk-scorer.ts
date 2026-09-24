import { BaseAgent } from './base-agent';
import { ClauseExtract, ClauseRiskScore, ContractReviewState } from '../pipeline/state';
import { vectorStoreService } from '../services/vector-store';
import { BATCH_SCORE_PROMPT, REASONING_FALLBACK_PROMPT, BatchScoreSchema } from '../prompts/scoring';
import { SEVERITY_THRESHOLDS } from '../constants';

const MONEY_OR_NUMBER_PATTERN = /\$\s?[\d,]+(?:\.\d+)?|\b\d{2,}(?:,\d{3})*\b/g;

const INTERNAL_FLAG_DENYLIST = new Set([
  'high risk',
  'medium risk',
  'low risk',
  'critical risk',
  'flag 1',
  'flag 2',
  'flag_1',
  'flag_2',
]);

const INTERNAL_FLAG_PATTERN = /(flagged.for.review|score.mismatch|mitigation.score|internal.use|debug|todo)/i;

// Principled, general calibration rules only. Each one documents the legal
// reasoning it encodes; none of them key off eval-fixture phrases. Add a
// rule here only if it generalizes to clauses these exact words never
// appear in — that's what distinguishes it from the phrase-matching this
// replaced (see IMPROVEMENTS.md for the removed phrase table and why).
export function calibrateScore(text: string, score: number, clauseType: string = ''): number {
  const textLower = text.toLowerCase();

  // Rule: an uncapped, non-mutual indemnification obligation is a floor-level
  // HIGH risk regardless of what score the model assigned — an open-ended
  // promise to cover "any and all claims" is a standard-form red flag that
  // should never be scored as merely MEDIUM even if the model undersells it.
  const isIndem =
    clauseType === 'indemnification' ||
    textLower.includes('indemnify') ||
    textLower.includes('indemnity') ||
    textLower.includes('hold harmless');

  if (isIndem) {
    const hasReciprocity =
      textLower.includes('mutual') ||
      textLower.includes('each party') ||
      textLower.includes('both parties') ||
      textLower.includes('indemnify each other');

    const hasCap =
      textLower.includes('cap') ||
      textLower.includes('limit') ||
      textLower.includes('maximum liability') ||
      textLower.includes('sole remedy');

    if (!hasReciprocity && !hasCap) {
      score = Math.max(score, SEVERITY_THRESHOLDS.high);
    }
  }

  return Math.max(0, Math.min(100, score));
}

export function getSeverity(score: number): 'low' | 'medium' | 'high' | 'critical' {
  if (score >= SEVERITY_THRESHOLDS.critical) return 'critical';
  if (score >= SEVERITY_THRESHOLDS.high) return 'high';
  if (score >= SEVERITY_THRESHOLDS.medium) return 'medium';
  return 'low';
}

function extractNumbers(text: string): Set<string> {
  const seen = new Set<string>();
  const matches = text.matchAll(MONEY_OR_NUMBER_PATTERN);
  for (const match of matches) {
    seen.add(match[0].trim());
  }
  return seen;
}

function groundReasoningNumbers(reasoning: string, clauseText: string): [string, boolean] {
  const reasoningNums = extractNumbers(reasoning);
  const clauseNums = extractNumbers(clauseText);

  // Check difference
  const ungrounded: string[] = [];
  for (const num of reasoningNums) {
    if (!clauseNums.has(num)) {
      ungrounded.push(num);
    }
  }

  if (ungrounded.length > 0) {
    return [
      reasoning +
        ' [Note: a specific figure in this reasoning could not be verified ' +
        'against the clause text and may be inaccurate — confirm against the ' +
        'source document before relying on it.]',
      true,
    ];
  }
  return [reasoning, false];
}

export class RiskScorer extends BaseAgent {
  readonly agentName = 'risk_scorer';
  protected maxTokens = 4096;

  async execute(state: ContractReviewState): Promise<Partial<ContractReviewState>> {
    const clauses = state.clauses;
    const representedParty = state.represented_party || 'Client';
    const scores = await this.scoreAll(clauses, representedParty);
    return { risk_scores: scores };
  }

  private async scoreAll(clauses: ClauseExtract[], representedParty: string): Promise<ClauseRiskScore[]> {
    if (!clauses || clauses.length === 0) {
      return [];
    }

    const batchSize = 5;
    const batches: ClauseExtract[][] = [];
    for (let i = 0; i < clauses.length; i += batchSize) {
      batches.push(clauses.slice(i, i + batchSize));
    }

    const resultsLists = await Promise.all(batches.map((b) => this.scoreBatch(b, representedParty)));
    const idToScore = new Map<number, ClauseRiskScore>();
    for (const lst of resultsLists) {
      for (const s of lst) {
        idToScore.set(s.clause_id, s);
      }
    }

    // Every clause id sent to the scorer must come back exactly once. Retry
    // only the clauses the model dropped, rather than silently defaulting
    // them — a re-request usually succeeds, and it keeps the "manual review
    // required" fallback for genuine repeat failures only.
    let missing = clauses.filter((c) => !idToScore.has(c.id));
    if (missing.length > 0) {
      console.warn(`[missing_scores_retrying] Clause IDs: ${missing.map((c) => c.id).join(', ')}`);
      try {
        const retryResults = await this.scoreBatch(missing, representedParty);
        for (const s of retryResults) {
          idToScore.set(s.clause_id, s);
        }
      } catch (e: any) {
        console.warn(`[missing_scores_retry_failed] Error: ${e.message}`);
      }
      missing = clauses.filter((c) => !idToScore.has(c.id));
    }

    for (const c of missing) {
      console.error(`[missing_score_for_clause_fallback_applied] Clause ID: ${c.id}`);
      idToScore.set(c.id, {
        clause_id: c.id,
        score: 50, // default mid score if LLM missed it after retry
        severity: 'high',
        reasoning:
          'This clause could not be scored automatically. Manual review is required before this report is approved.',
        flags: ['scoring failed — manual review required'],
        rag_hits: [],
      });
    }

    return clauses.map((c) => idToScore.get(c.id)!);
  }

  private async scoreBatch(batch: ClauseExtract[], representedParty: string): Promise<ClauseRiskScore[]> {
    // 1. RAG query in parallel
    const ragHitsList = await Promise.all(
      batch.map((c) => vectorStoreService.query(c.text, 3, { type: c.type }))
    );

    // 2. Format context
    const ragContexts: string[] = [];
    const clausesTexts: string[] = [];

    for (let i = 0; i < batch.length; i++) {
      const c = batch[i];
      const hits = ragHitsList[i];
      const formattedHits = this.formatRagContext(hits);
      ragContexts.push(`### Reference for Clause #${c.id} (${c.type}):\n${formattedHits}`);
      clausesTexts.push(`### Clause #${c.id}:\nType: ${c.type}\nHeading: ${c.heading}\nText:\n${c.text}\n`);
    }

    const prompt = BATCH_SCORE_PROMPT.replace(/{represented_party}/g, representedParty)
      .replace('{rag_context}', ragContexts.join('\n\n'))
      .replace('{clauses_text}', clausesTexts.join('\n\n'));

    // 3. LLM call
    const resultDict = await this.callLlmObject(prompt, BatchScoreSchema);
    const results = resultDict.results;

    const scores: ClauseRiskScore[] = [];
    const hitsMap = new Map<number, any[]>();
    const textMap = new Map<number, string>();
    const typeMap = new Map<number, string>();

    for (let i = 0; i < batch.length; i++) {
      hitsMap.set(batch[i].id, ragHitsList[i]);
      textMap.set(batch[i].id, batch[i].text);
      typeMap.set(batch[i].id, batch[i].type);
    }

    for (const item of results) {
      const cid = item.clause_id;
      const similar = hitsMap.get(cid) || [];
      const clauseText = textMap.get(cid) || '';
      const clauseType = typeMap.get(cid) || '';
      let scoreVal = calibrateScore(clauseText, item.score, clauseType);
      const severityVal = getSeverity(scoreVal);

      let reasoning = (item.reasoning || '').trim();
      const isPlaceholder = /^Reasoning for clause \d+$/i.test(reasoning);
      if (isPlaceholder || !reasoning || reasoning.length < 30) {
        console.warn(`[placeholder_reasoning_detected] Clause ID: ${cid}`);
        reasoning = await this.generateCompleteReasoning(clauseText, clauseType, scoreVal, representedParty);
      }

      const [groundedReasoning, wasUngrounded] = groundReasoningNumbers(reasoning, clauseText);
      reasoning = groundedReasoning;
      if (wasUngrounded) {
        console.warn(`[ungrounded_numeric_figure_detected] Clause ID: ${cid}`);
      }

      const rawFlags = item.flags || [];
      const cleanedFlags: string[] = [];
      for (const f of rawFlags) {
        const fClean = f.trim().toLowerCase().replace(/_/g, ' ');
        if (INTERNAL_FLAG_DENYLIST.has(fClean)) {
          continue;
        }
        if (INTERNAL_FLAG_PATTERN.test(fClean)) {
          console.warn(`[internal_flag_leak_suppressed] Clause ID: ${cid}, Flag: ${f}`);
          continue;
        }
        cleanedFlags.push(f.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()));
      }

      scores.push({
        clause_id: cid,
        score: scoreVal,
        severity: severityVal,
        reasoning,
        flags: cleanedFlags,
        rag_hits: similar.map((h) => h.id),
      });
    }

    return scores;
  }

  async scoreSingleClauseText(
    clauseId: number,
    clauseText: string,
    clauseType: string,
    representedParty: string
  ): Promise<ClauseRiskScore> {
    const fakeClause: ClauseExtract = {
      id: clauseId,
      type: clauseType,
      heading: '',
      text: clauseText,
      page_hint: 0.0,
    };
    const result = await this.scoreBatch([fakeClause], representedParty);
    if (result && result.length > 0) {
      return result[0];
    }
    return {
      clause_id: clauseId,
      score: 50,
      severity: 'high',
      reasoning: 'This revised clause could not be scored automatically.',
      flags: ['scoring failed — manual review required'],
      rag_hits: [],
    };
  }

  private async generateCompleteReasoning(
    clauseText: string,
    clauseType: string,
    scoreVal: number,
    representedParty: string
  ): Promise<string> {
    const prompt = REASONING_FALLBACK_PROMPT.replace(/{represented_party}/g, representedParty)
      .replace('{score_val}', scoreVal.toString())
      .replace('{clause_type}', clauseType)
      .replace('{clause_text}', clauseText);

    try {
      const raw = await this.callLlm(prompt, undefined, 0.0);
      let reasoning = raw.trim();
      if (reasoning.startsWith('"') && reasoning.endsWith('"')) {
        reasoning = reasoning.substring(1, reasoning.length - 1).trim();
      }
      if (reasoning.length >= 30 && !/^Reasoning for clause \d+$/i.test(reasoning)) {
        const [grounded] = groundReasoningNumbers(reasoning, clauseText);
        return grounded;
      }
    } catch (e: any) {
      console.warn(`[reasoning_retry_failed] Error: ${e.message}`);
    }

    return (
      `This clause has been flagged for review with a risk score of ${scoreVal}/100. ` +
      `A manual review is recommended to determine the potential legal impact to the ${representedParty}.`
    );
  }

  private formatRagContext(hits: any[]): string {
    if (!hits || hits.length === 0) {
      return 'No similar clauses found in historical data.';
    }
    return hits
      .map(
        (h, idx) =>
          `${idx + 1}. [Risk score: ${h.risk_score !== undefined ? h.risk_score : 'N/A'}] ${h.text.substring(0, 300)}...`
      )
      .join('\n');
  }
}
export const riskScorer = new RiskScorer();
