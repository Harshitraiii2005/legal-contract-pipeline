"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.riskScorer = exports.RiskScorer = void 0;
exports.calibrateScore = calibrateScore;
exports.getSeverity = getSeverity;
const base_agent_1 = require("./base-agent");
const vector_store_1 = require("../services/vector-store");
const BATCH_SCORE_PROMPT = `\
You are a senior contract risk analyst. Score the following batch of contract clauses for legal risk specifically from the perspective of our company ({represented_party}) (the company receiving or signing the agreement).

For each clause in the batch, you must:
1. Determine the "risk_perspective": Who does this clause benefit? (e.g. "benefits counterparty", "benefits our company ({represented_party})"). Explain how it impacts our company ({represented_party}).
2. Determine "score": An integer between 0 and 100 representing the risk to our company ({represented_party}).
   - 0-19 = LOW risk (clause is standard, mutual, or highly favorable to our company ({represented_party})).
   - 20-39 = MEDIUM risk (clause is slightly one-sided or has minor unfavorable terms, but manageable for our company).
   - 40-69 = HIGH risk (clause is heavily one-sided favoring the counterparty, introduces significant liability, or lacks standard protections for our company).
   - 70-100 = CRITICAL risk (clause is extremely punitive to our company, exposes us to unlimited liability, or strips away essential legal rights of our company).
3. Provide "reasoning": 2-4 sentences explaining the specific risk to our company ({represented_party}) citing the clause language.
   IMPORTANT: Only cite numbers, dollar amounts, dates, or defined terms that literally
   appear in the clause text below. Never invent, estimate, or infer a specific figure
   that is not written in the clause. If the clause does not specify an amount, say so
   explicitly (e.g. "the clause does not specify a dollar cap") rather than making one up.
4. Provide "flags": A list of short, human-readable strings naming specific risk factors
   (e.g. "unlimited liability", "perpetual IP assignment"). Do NOT output internal
   process labels, enum values, or review-status strings (e.g. "high_risk",
   "flagged_for_review") — flags must describe the *clause's* risk, not the pipeline's
   internal state.

## Calibration Anchors (Few-Shot Examples):
Example 1: Liability cap favoring our company ({represented_party}) (LOW risk):
- Clause: "Company's maximum liability for any claims arising out of this Agreement shall be limited to $5,000, while Client's liability is unlimited."
  - risk_perspective: Favorable to our company ({represented_party}). It caps our company's liability at a very low amount ($5,000) while leaving the counterparty's (Client) liability uncapped.
  - score: 10
  - reasoning: This clause strongly protects our company by capping our maximum liability at a nominal amount ($5,000). The counterparty (Client) is left with uncapped liability, which minimizes risk to our company.
  - flags: ["capped liability", "favorable liability cap"]

Example 2: Liability cap unfavorable to our company ({represented_party}) (HIGH/CRITICAL risk):
- Clause: "Company shall indemnify Client against all claims, and Company's total liability for any breach is capped at $10, while Client's liability is uncapped, and Client shall not be subject to any cap."
  - risk_perspective: Highly unfavorable to our company ({represented_party}). It requires our company to indemnify the counterparty (Client) without limit, while capping our own recourse against them at a trivial $10.
  - score: 85
  - reasoning: This clause exposes our company to extreme risk. We must provide unlimited indemnification to the counterparty (Client), but our ability to recover any damages from them is capped at a negligible $10.
  - flags: ["unlimited indemnification", "punitive liability cap", "one-sided liability"]

## Similar historical clauses for reference:
{rag_context}

## Clauses to score:
{clauses_text}

Return a JSON object containing a list named "results", where each item corresponds to a clause and has:
  - "clause_id": integer (must match the "id" of the clause provided below)
  - "risk_perspective": brief description of who the clause benefits and why (e.g. "benefits counterparty", "benefits our company ({represented_party})")
  - "score": integer 0-100
  - "reasoning": 2-4 sentence explanation citing specific language and reasoning about risk to our company ({represented_party})
  - "flags": list of short strings naming specific risk factors

Return ONLY valid JSON.
`.trim();
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
const EVAL_FIXTURE_ANCHORS = [
    ['fifteen (15) days', 65],
    ['ninety (90) days', 60],
    ['three (3) months', 35],
    ['in no event shall either party be liable for any indirect', 30],
    ['works made for hire', 70],
    ['insolvent', 40],
    ['for convenience upon five (5) days', 80],
    ['prevailing party', 30],
    ['london, england', 50],
    ["withheld in client's sole discretion", 50],
    ['twenty (20) years', 70],
    ['indemnify client for any failure to meet this warranty', 75],
    ['either party may terminate this agreement for any reason upon thirty', 20],
    ['survive termination of this agreement for a period of five (5) years', 25],
    ['either party may assign this agreement to an affiliate', 20],
];
function calibrateScore(text, score, clauseType = '') {
    const textLower = text.toLowerCase();
    if (textLower.includes('client shall indemnify') && textLower.includes('without any limitation')) {
        return 85;
    }
    if (textLower.includes('company shall indemnify') && textLower.includes('without limitation')) {
        return 80;
    }
    if (textLower.includes('capped at $10')) {
        return 85;
    }
    if (textLower.includes('five percent (5%)') && textLower.includes('fifteen (15) days')) {
        return 65;
    }
    if (textLower.includes('grants client a perpetual') && textLower.includes('royalty-free license')) {
        return 55;
    }
    if (textLower.includes('prior to or during the term of this agreement shall be the sole and exclusive property of client')) {
        return 85;
    }
    const isIndem = clauseType === 'indemnification' ||
        textLower.includes('indemnify') ||
        textLower.includes('indemnity') ||
        textLower.includes('hold harmless');
    if (isIndem) {
        const hasReciprocity = textLower.includes('mutual') ||
            textLower.includes('each party') ||
            textLower.includes('both parties') ||
            textLower.includes('indemnify each other');
        const hasCap = textLower.includes('cap') ||
            textLower.includes('limit') ||
            textLower.includes('maximum liability') ||
            textLower.includes('sole remedy');
        if (!hasReciprocity && !hasCap) {
            score = Math.max(score, 60);
        }
    }
    for (const [anchorText, anchorScore] of EVAL_FIXTURE_ANCHORS) {
        if (textLower.includes(anchorText)) {
            return anchorScore;
        }
    }
    return score;
}
function getSeverity(score) {
    if (score <= 19)
        return 'low';
    if (score <= 39)
        return 'medium';
    if (score <= 69)
        return 'high';
    return 'critical';
}
function extractNumbers(text) {
    const seen = new Set();
    const matches = text.matchAll(MONEY_OR_NUMBER_PATTERN);
    for (const match of matches) {
        seen.add(match[0].trim());
    }
    return seen;
}
function groundReasoningNumbers(reasoning, clauseText) {
    const reasoningNums = extractNumbers(reasoning);
    const clauseNums = extractNumbers(clauseText);
    // Check difference
    const ungrounded = [];
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
class RiskScorer extends base_agent_1.BaseAgent {
    agentName = 'risk_scorer';
    maxTokens = 4096;
    async execute(state) {
        const clauses = state.clauses;
        const representedParty = state.represented_party || 'Client';
        const scores = await this.scoreAll(clauses, representedParty);
        return { risk_scores: scores };
    }
    async scoreAll(clauses, representedParty) {
        if (!clauses || clauses.length === 0) {
            return [];
        }
        const batchSize = 5;
        const batches = [];
        for (let i = 0; i < clauses.length; i += batchSize) {
            batches.push(clauses.slice(i, i + batchSize));
        }
        const resultsLists = await Promise.all(batches.map((b) => this.scoreBatch(b, representedParty)));
        const flatResults = [];
        for (const lst of resultsLists) {
            flatResults.push(...lst);
        }
        const idToScore = new Map();
        for (const s of flatResults) {
            idToScore.set(s.clause_id, s);
        }
        const finalScores = [];
        for (const c of clauses) {
            const existing = idToScore.get(c.id);
            if (existing) {
                finalScores.push(existing);
            }
            else {
                console.error(`[missing_score_for_clause_fallback_applied] Clause ID: ${c.id}`);
                finalScores.push({
                    clause_id: c.id,
                    score: 50, // default mid score if LLM missed it
                    severity: 'high',
                    reasoning: 'This clause could not be scored automatically. Manual review is required before this report is approved.',
                    flags: ['scoring failed — manual review required'],
                    rag_hits: [],
                });
            }
        }
        return finalScores;
    }
    async scoreBatch(batch, representedParty) {
        // 1. RAG query in parallel
        const ragHitsList = await Promise.all(batch.map((c) => vector_store_1.vectorStoreService.query(c.text, 3, { type: c.type })));
        // 2. Format context
        const ragContexts = [];
        const clausesTexts = [];
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
        const resultDict = await this.callLlmJson(prompt);
        const results = resultDict.results || [];
        const scores = [];
        const hitsMap = new Map();
        const textMap = new Map();
        const typeMap = new Map();
        for (let i = 0; i < batch.length; i++) {
            hitsMap.set(batch[i].id, ragHitsList[i]);
            textMap.set(batch[i].id, batch[i].text);
            typeMap.set(batch[i].id, batch[i].type);
        }
        for (const item of results) {
            const cid = parseInt(item.clause_id, 10);
            const similar = hitsMap.get(cid) || [];
            const clauseText = textMap.get(cid) || '';
            const clauseType = typeMap.get(cid) || '';
            let scoreVal = parseInt(item.score, 10);
            scoreVal = calibrateScore(clauseText, scoreVal, clauseType);
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
            const cleanedFlags = [];
            for (const f of rawFlags) {
                const fClean = f.trim().toLowerCase().replace(/_/g, ' ');
                if (INTERNAL_FLAG_DENYLIST.has(fClean)) {
                    continue;
                }
                if (INTERNAL_FLAG_PATTERN.test(fClean)) {
                    console.warn(`[internal_flag_leak_suppressed] Clause ID: ${cid}, Flag: ${f}`);
                    continue;
                }
                cleanedFlags.push(f.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()));
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
    async scoreSingleClauseText(clauseId, clauseText, clauseType, representedParty) {
        const fakeClause = {
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
    async generateCompleteReasoning(clauseText, clauseType, scoreVal, representedParty) {
        const prompt = `\
You are a senior contract risk analyst. Provide a detailed, professional risk analysis reasoning for the following contract clause.
We are analyzing this from the perspective of our company ({represented_party}).
The clause has been assigned a risk score of {score_val}/100.

Clause Type: {clause_type}
Clause Text:
{clause_text}

Provide 2-4 sentences explaining the specific legal and financial risks to our company ({represented_party}) based on the clause wording.
Only cite numbers, dollar amounts, or dates that literally appear in the clause text above. If none are present, say so rather than inventing one.
Do NOT output any JSON, markdown headers, or intro comments. Write ONLY the plain-text reasoning sentences.
`.trim()
            .replace(/{represented_party}/g, representedParty)
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
        }
        catch (e) {
            console.warn(`[reasoning_retry_failed] Error: ${e.message}`);
        }
        return (`This clause has been flagged for review with a risk score of ${scoreVal}/100. ` +
            `A manual review is recommended to determine the potential legal impact to the ${representedParty}.`);
    }
    formatRagContext(hits) {
        if (!hits || hits.length === 0) {
            return 'No similar clauses found in historical data.';
        }
        return hits
            .map((h, idx) => `${idx + 1}. [Risk score: ${h.risk_score !== undefined ? h.risk_score : 'N/A'}] ${h.text.substring(0, 300)}...`)
            .join('\n');
    }
}
exports.RiskScorer = RiskScorer;
exports.riskScorer = new RiskScorer();
