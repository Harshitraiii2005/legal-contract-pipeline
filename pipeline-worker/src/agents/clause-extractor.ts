import { BaseAgent } from './base-agent';
import { ClauseExtract, ContractReviewState } from '../pipeline/state';

export const CLAUSE_TYPES = [
  'indemnification',
  'limitation_of_liability',
  'termination',
  'intellectual_property',
  'confidentiality',
  'payment',
  'data_protection',
  'service_level_agreement',
  'dispute_resolution',
  'governing_law',
  'force_majeure',
  'warranty',
  'assignment',
  'other',
];

const EXTRACTION_PROMPT = `\
You are a legal clause segmentation engine.

Given the following contract text, extract every distinct legal clause.

CRITICAL RULES — a violation of any of these is a serious defect:
1. Every numbered/lettered clause heading present in the text MUST appear exactly
   once in your output. Do not omit any clause, even if it seems purely
   definitional, administrative, or low-risk (e.g. Definitions, Notices,
   Entire Agreement, platform/service descriptions).
2. Do not merge two distinct headings into one clause, and do not split a
   single heading into two clauses unless the source text itself contains
   two independently numbered provisions under one heading.
3. Do not invent, duplicate, or renumber clauses. Preserve the original
   heading text verbatim.
4. If you are unsure whether something is a "real" clause, include it rather
   than omit it — omission is the worse error.

For each clause return a JSON array where every element has:
  - "id": sequential integer starting at 1, in document order
  - "type": one of {types}
  - "heading": the clause heading exactly as it appears (or best guess)
  - "text": the verbatim clause text
  - "page_hint": approximate position as a fraction 0.0-1.0 of total document

Return ONLY valid JSON — no markdown, no explanation.

CONTRACT TEXT:
---
{contract_text}
---
`;

const PERSPECTIVE_PROMPT = `\
Analyze the following contract preamble and identify which party represents the "Client" (the customer, buyer, licensee, or service recipient) and which party represents the "Provider" (the vendor, supplier, licensor, or service provider).

We want to determine which party's interests our company represents. By default, for vendor agreements, we represent the Client's perspective.
Return a JSON object with:
  - "represented_party": "Client" or "Provider"
  - "explanation": a brief 1-sentence explanation.

Return ONLY valid JSON.

CONTRACT PREAMBLE:
---
{preamble}
---
`;

const HEADING_PATTERN = /(?:(?:Section|ARTICLE|CLAUSE)\s+(\d+))|(?:^|\n)\s*(\d+)\.\s+[A-Z]/i;
const HEADING_PATTERN_GLOBAL = /(?:(?:Section|ARTICLE|CLAUSE)\s+(\d+))|(?:^|\n)\s*(\d+)\.\s+[A-Z]/gi;

export class ClauseExtractor extends BaseAgent {
  readonly agentName = 'clause_extractor';
  protected maxTokens = 8192;

  async execute(state: ContractReviewState): Promise<Partial<ContractReviewState>> {
    const contractText = state.contract_text;

    if (!contractText || !contractText.trim()) {
      throw new Error('contract_text is empty — cannot extract clauses.');
    }

    // Determine represented party
    const preamble = contractText.substring(0, 4000);
    let representedParty = 'Client';
    try {
      const prompt = PERSPECTIVE_PROMPT.replace('{preamble}', preamble);
      const result = await this.callLlmJson(prompt);
      const detected = (result?.represented_party || 'Client').trim();
      if (detected === 'Client' || detected === 'Provider') {
        representedParty = detected;
      }
    } catch (e: any) {
      console.warn(`[perspective_detection_failed] Error: ${e.message}`);
    }

    console.log(`[perspective_detected] Represented party: ${representedParty}`);

    const expectedHeadingCount = this.countExpectedHeadings(contractText);
    const chunks = this.preSegment(contractText);
    const allClauses: ClauseExtract[] = [];
    const seenHeadings: Record<string, number> = {};
    let nextId = 1;

    for (const chunk of chunks) {
      const prompt = EXTRACTION_PROMPT.replace('{types}', CLAUSE_TYPES.join(', ')).replace('{contract_text}', chunk);
      const raw: any[] = await this.callLlmJson(prompt);

      for (const item of raw) {
        const headingNorm = (item.heading || '').trim().toLowerCase();

        if (headingNorm && seenHeadings[headingNorm] !== undefined) {
          console.warn(
            `[duplicate_clause_heading_detected] Heading: ${item.heading}, First seen ID: ${seenHeadings[headingNorm]}`
          );
        }

        const clause: ClauseExtract = {
          id: nextId,
          type: item.type || 'other',
          heading: item.heading || '',
          text: item.text,
          page_hint: item.page_hint || 0.0,
        };

        allClauses.push(clause);
        if (headingNorm) {
          seenHeadings[headingNorm] = nextId;
        }
        nextId++;
      }
    }

    const extractionGap = expectedHeadingCount - allClauses.length;
    let integrityFlag: string | null = null;
    if (expectedHeadingCount > 0 && extractionGap > 0) {
      integrityFlag =
        `Detected ${expectedHeadingCount} numbered headings in the source ` +
        `document but only extracted ${allClauses.length} clauses. ` +
        `${extractionGap} clause(s) may have been dropped or merged during ` +
        `extraction. This report should not be approved without manual ` +
        `verification against the source document.`;

      console.error(
        `[clause_extraction_integrity_check_failed] Expected: ${expectedHeadingCount}, Extracted: ${allClauses.length}, Gap: ${extractionGap}`
      );
    }

    console.log(`[clauses_extracted] Count: ${allClauses.length}`);
    return {
      clauses: allClauses,
      clause_count: allClauses.length,
      represented_party: representedParty,
      extraction_integrity_warning: integrityFlag,
    };
  }

  private countExpectedHeadings(text: string): number {
    const seenNumbers = new Set<string>();
    const matches = text.matchAll(HEADING_PATTERN_GLOBAL);
    for (const match of matches) {
      const num = match[1] || match[2];
      if (num) {
        seenNumbers.add(num);
      }
    }
    return seenNumbers.size;
  }

  private preSegment(text: string, maxChars: number = 12000): string[] {
    // Split on headings
    // Using a regex split, which behaves similarly to Python's re.split
    // Since JavaScript doesn't natively support splitting with lookahead directly,
    // we can find the indices and slice, or use a splitter.
    // Let's do index-based split.
    const indices: number[] = [];
    let match;
    const regex = new RegExp(HEADING_PATTERN_GLOBAL);
    while ((match = regex.exec(text)) !== null) {
      indices.push(match.index);
    }

    if (indices.length === 0) return [text];

    const parts: string[] = [];
    let lastIdx = 0;
    for (const idx of indices) {
      if (idx > lastIdx) {
        parts.push(text.substring(lastIdx, idx));
        lastIdx = idx;
      }
    }
    parts.push(text.substring(lastIdx));

    const chunks: string[] = [];
    let current = '';
    for (const part of parts) {
      if (current.length + part.length > maxChars && current) {
        chunks.push(current);
        current = part;
      } else {
        current += part;
      }
    }
    if (current) {
      chunks.push(current);
    }

    return chunks.length > 0 ? chunks : [text];
  }
}
