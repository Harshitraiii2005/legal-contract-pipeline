import { BaseAgent } from './base-agent';
import { ClauseExtract, ContractReviewState } from '../pipeline/state';
import { EXTRACTION_PROMPT, PERSPECTIVE_PROMPT, HeadingListSchema, PerspectiveSchema, CLAUSE_TYPES } from '../prompts/extraction';

export { CLAUSE_TYPES };

const HEADING_PATTERN_GLOBAL = /(?:(?:Section|ARTICLE|CLAUSE)\s+(\d+))|(?:^|\n)\s*(\d+)\.\s+[A-Z]/gi;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Locates a model-reported heading inside the actual source text, so clause
// text can be sliced from the source instead of re-typed by the model.
// Tries an exact match first (headings are asked for verbatim), then falls
// back to a whitespace-tolerant match for minor formatting drift (extra
// spaces, a stray newline). searchFrom keeps matches monotonic so a
// duplicated heading string earlier in the document isn't matched twice.
export function findHeadingPosition(contractText: string, heading: string, searchFrom: number): number {
  const trimmed = (heading || '').trim();
  if (!trimmed) return -1;

  const exactIdx = contractText.indexOf(trimmed, searchFrom);
  if (exactIdx !== -1) return exactIdx;

  const fuzzyPattern = escapeRegExp(trimmed).replace(/\s+/g, '\\s+');
  const remainder = contractText.slice(searchFrom);
  const match = remainder.match(new RegExp(fuzzyPattern));
  if (match && match.index !== undefined) return searchFrom + match.index;

  return -1;
}

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
      const result = await this.callLlmObject(prompt, PerspectiveSchema);
      representedParty = result.represented_party;
    } catch (e: any) {
      console.warn(`[perspective_detection_failed] Error: ${e.message}`);
    }

    console.log(`[perspective_detected] Represented party: ${representedParty}`);

    const expectedHeadingCount = this.countExpectedHeadings(contractText);
    const chunks = this.preSegment(contractText);

    // The model returns headings + types only; clause text is sliced from
    // contractText below so it is always exactly what the source says (the
    // model can no longer drop or reword text while "re-typing" a clause).
    type HeadingItem = { heading: string; type: string };
    const rawItems: HeadingItem[] = [];
    for (const chunk of chunks) {
      const prompt = EXTRACTION_PROMPT.replace('{types}', CLAUSE_TYPES.join(', ')).replace('{contract_text}', chunk);
      const raw = await this.callLlmObject(prompt, HeadingListSchema);
      for (const item of raw) {
        if (item.heading) {
          rawItems.push({ heading: item.heading, type: item.type });
        }
      }
    }

    // Resolve each heading to a position in the source text, in order, so
    // slices stay monotonic even if a heading string repeats elsewhere.
    const seenHeadings: Record<string, number> = {};
    const located: Array<HeadingItem & { index: number }> = [];
    const unlocatable: string[] = [];
    let cursor = 0;

    for (const item of rawItems) {
      const headingNorm = item.heading.trim().toLowerCase();
      if (headingNorm && seenHeadings[headingNorm] !== undefined) {
        console.warn(`[duplicate_clause_heading_detected] Heading: ${item.heading}`);
      }

      const index = findHeadingPosition(contractText, item.heading, cursor);
      if (index === -1) {
        console.error(`[clause_heading_not_found_in_source] Heading: ${item.heading}`);
        unlocatable.push(item.heading);
        continue;
      }

      located.push({ ...item, index });
      if (headingNorm) seenHeadings[headingNorm] = index;
      cursor = index + item.heading.length;
    }

    // Defensive: keep strictly increasing positions in case a fuzzy match
    // landed before an earlier one (shouldn't happen given monotonic
    // cursor, but slicing assumes sorted order).
    located.sort((a, b) => a.index - b.index);

    const allClauses: ClauseExtract[] = located.map((item, i) => {
      const end = i + 1 < located.length ? located[i + 1].index : contractText.length;
      return {
        id: i + 1,
        type: item.type,
        heading: item.heading,
        text: contractText.slice(item.index, end).trim(),
        page_hint: contractText.length > 0 ? item.index / contractText.length : 0,
      };
    });

    const extractionGap = expectedHeadingCount - allClauses.length;
    let integrityFlag: string | null = null;
    if (extractionGap > 0 || unlocatable.length > 0) {
      const parts: string[] = [];
      if (expectedHeadingCount > 0 && extractionGap > 0) {
        parts.push(
          `Detected ${expectedHeadingCount} numbered headings in the source document but only extracted ` +
            `${allClauses.length} clauses (${extractionGap} may have been dropped or merged).`
        );
      }
      if (unlocatable.length > 0) {
        parts.push(
          `${unlocatable.length} heading(s) reported by the model could not be located verbatim in the ` +
            `source and were dropped: ${unlocatable.join('; ')}.`
        );
      }
      integrityFlag = parts.join(' ') + ' This report should not be approved without manual verification against the source document.';

      console.error(
        `[clause_extraction_integrity_check_failed] Expected: ${expectedHeadingCount}, Extracted: ${allClauses.length}, Gap: ${extractionGap}, Unlocatable: ${unlocatable.length}`
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
