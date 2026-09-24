import { BaseAgent } from './base-agent';
import { FinalReport, ContractReviewState } from '../pipeline/state';
import { SUMMARY_PROMPT } from '../prompts/summary';

const JSON_KEY_VALUE_PATTERN = /"\w+"\s*:\s*(?:"|\[|\{|-?\d)/g;

export function cleanSummaryText(summary: string): string {
  // 1. Remove markdown code blocks (e.g. \`\`\`json ... \`\`\` or \`\`\` ... \`\`\`)
  summary = summary.replace(/```[\s\S]*?```/g, '');

  // 2. Filter out raw JSON lines and conversational introductions
  const lines = summary.split(/\r?\n/);
  const cleanedLines: string[] = [];
  let inJson = false;

  for (const line of lines) {
    const stripped = line.trim();
    if (stripped.startsWith('{') || stripped.startsWith('[')) {
      inJson = true;
      continue;
    }
    if (inJson) {
      if (stripped.endsWith('}') || stripped.endsWith(']')) {
        inJson = false;
      }
      continue;
    }

    const lowerLine = stripped.toLowerCase();
    if (
      [
        'here is a rewritten',
        "here's a rewritten",
        'here is the summary',
        'here is the executive summary',
        "here's the summary",
        "here's the executive summary",
        'here is a summary',
        'here is the json representation',
        "here's a summary",
        "here's the json representation",
        'rewritten executive summary',
      ].some((prefix) => lowerLine.includes(prefix))
    ) {
      continue;
    }

    cleanedLines.push(line);
  }

  summary = cleanedLines.join('\n').trim();

  // Remove any leading conversational phrases ending with a colon.
  summary = summary.replace(
    /^(here is|here's|this is|please find|summary of|executive summary of|rewritten executive summary|here's a rewritten|here is a rewritten)[\s\S]*?:\s*/i,
    ''
  );

  return summary.trim();
}

function hasUngroundedDollarOrDayFigures(summary: string, anchorsText: string): boolean {
  const dollarPattern = /\$\s?[\d,]+(?:\.\d+)?/g;
  const dayPattern = /\b\d+\s?-?days?\b|\b\w+\s?\(\d+\)\s?-?days?\b/gi;

  const dollars = summary.match(dollarPattern) || [];
  const days = summary.match(dayPattern) || [];

  const anchorsLower = anchorsText.toLowerCase();
  const summaryLower = summary.toLowerCase();

  for (const dollar of dollars) {
    const dollarNorm = dollar.toLowerCase().trim();
    if (!anchorsLower.includes(dollarNorm)) {
      let pos = summaryLower.indexOf(dollarNorm);
      while (pos !== -1) {
        const context = summaryLower.substring(pos, pos + 60);
        if (!context.includes('illustrative placeholder')) {
          return true;
        }
        pos = summaryLower.indexOf(dollarNorm, pos + 1);
      }
    }
  }

  for (const day of days) {
    const dayNorm = day.toLowerCase().trim();
    const digits = dayNorm.match(/\d+/);
    if (digits) {
      const digit = digits[0];
      if (!anchorsLower.includes(digit)) {
        let pos = summaryLower.indexOf(dayNorm);
        while (pos !== -1) {
          const context = summaryLower.substring(pos, pos + 60);
          if (!context.includes('illustrative placeholder')) {
            return true;
          }
          pos = summaryLower.indexOf(dayNorm, pos + 1);
        }
      }
    }
  }

  return false;
}

export function validateSummary(summary: string, anchorsText: string = ''): boolean {
  if (!summary) return false;
  if (summary.length < 200) return false;
  if (summary.startsWith('{') || summary.startsWith('[')) return false;
  if (summary.includes('```')) return false;

  const jsonMatches = summary.match(JSON_KEY_VALUE_PATTERN) || [];
  if (jsonMatches.length >= 2) return false;

  const lower = summary.toLowerCase();
  if (
    [
      'here is the json representation',
      "here's the json representation",
      'rewritten executive summary',
      'as an ai',
      'as a language model',
    ].some((phrase) => lower.includes(phrase))
  ) {
    return false;
  }

  if (anchorsText && hasUngroundedDollarOrDayFigures(summary, anchorsText)) {
    return false;
  }

  return true;
}

export class ReportWriter extends BaseAgent {
  readonly agentName = 'report_writer';
  protected maxTokens = 2048;

  async execute(state: ContractReviewState): Promise<Partial<ContractReviewState>> {
    const scores = state.risk_scores || [];
    const compliance = state.compliance_results || [];
    const edits = state.redline_edits || [];
    const clauses = state.clauses || [];
    const representedParty = state.represented_party || 'Client';

    // Top 3 highest-risk average calculation
    let overallScore = 0;
    if (scores.length > 0) {
      const sortedScores = scores.map((s) => s.score).sort((a, b) => b - a);
      const top3 = sortedScores.slice(0, 3);
      const sum = top3.reduce((acc, val) => acc + val, 0);
      overallScore = Math.round(sum / top3.length);
    }

    // Programmatic high-risk metrics (severity "high" or "critical")
    const highSeverityClauses = scores.filter((s) => s.severity === 'high' || s.severity === 'critical');
    const highRiskCount = highSeverityClauses.length;

    const clauseMap = new Map<number, any>();
    for (const c of clauses) {
      clauseMap.set(c.id, c);
    }

    const highRiskClausesInfo: string[] = [];
    for (const s of highSeverityClauses) {
      const c = clauseMap.get(s.clause_id);
      const heading = c ? c.heading : 'Unknown Heading';
      highRiskClausesInfo.push(
        `- Clause ${s.clause_id} (${heading}): Severity=${s.severity.toUpperCase()}, Score=${s.score}`
      );
    }
    const highRiskClausesText = highRiskClausesInfo.join('\n') || 'None';

    // Explicitly distinguish compliance violation counts (clauses vs. issues)
    const complianceViolationClauses =
      state.compliance_violation_clauses !== undefined
        ? state.compliance_violation_clauses
        : compliance.filter((r) => !r.compliant).length;

    const complianceViolationIssues =
      state.compliance_violation_issues !== undefined
        ? state.compliance_violation_issues
        : compliance.reduce((acc, r) => acc + (r.violations?.length || 0), 0);

    // Extract potential grounding anchors from clauses text to prevent hallucinated numbers
    const anchors: string[] = [];
    for (const c of clauses) {
      const textLower = (c.text || '').toLowerCase();
      if (textLower.includes('limit') || textLower.includes('cap')) {
        const moneyMatches = c.text.match(/\$\s?[\d,]+(?:\.\d+)?/g);
        if (moneyMatches) {
          anchors.push(`Clause ${c.id} ('${c.heading}') mentions liability limit/cap: ${moneyMatches.join(', ')}`);
        }
      }
      if (textLower.includes('cure') || textLower.includes('remedy') || textLower.includes('terminate')) {
        const dayMatches = c.text.match(/\b\d+\s?days?\b|\b\w+\s?\(\d+\)\s?days?\b/gi);
        if (dayMatches) {
          anchors.push(`Clause ${c.id} ('${c.heading}') mentions notice/cure period: ${dayMatches.join(', ')}`);
        }
      }
    }
    const anchorsText = anchors.length > 0 ? anchors.map((a) => `- ${a}`).join('\n') : 'None found in source text.';

    // Aggregate flags (exclude low risk/favorable flags to avoid executive summary mismatch)
    const flagCounts: Record<string, number> = {};
    for (const s of scores) {
      if (s.score >= 30 && s.flags) {
        for (const f of s.flags) {
          flagCounts[f] = (flagCounts[f] || 0) + 1;
        }
      }
    }
    const topFlags = Object.entries(flagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([f]) => f);

    const topCompliance: string[] = [];
    const seenCompliance = new Set<string>();
    for (const c of compliance) {
      if (!c.compliant && c.violations) {
        for (const v of c.violations) {
          const item = `${v.framework}: ${v.description}`;
          if (!seenCompliance.has(item)) {
            seenCompliance.add(item);
            topCompliance.push(item);
          }
        }
      }
    }
    const topComplianceList = topCompliance.slice(0, 5);

    let summaryPrompt = SUMMARY_PROMPT.replace(/{represented_party}/g, representedParty)
      .replace('{contract_name}', state.contract_name || 'Unknown')
      .replace('{clause_count}', String(clauses.length))
      .replace('{high_risk_count}', String(highRiskCount))
      .replace('{high_risk_clauses_list}', highRiskClausesText)
      .replace('{compliance_violation_clauses}', String(complianceViolationClauses))
      .replace('{compliance_violation_issues}', String(complianceViolationIssues))
      .replace('{overall_score}', String(overallScore))
      .replace('{top_flags}', topFlags.map((f) => `- ${f}`).join('\n') || 'None')
      .replace('{top_compliance}', topComplianceList.map((c) => `- ${c}`).join('\n') || 'None')
      .replace('{grounding_anchors}', anchorsText);

    let executiveSummary = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
      const rawSummary = await this.callLlm(summaryPrompt);
      const cleaned = cleanSummaryText(rawSummary);
      if (validateSummary(cleaned, anchorsText)) {
        executiveSummary = cleaned;
        break;
      } else {
        console.warn(`[summary_validation_failed] Attempt: ${attempt}, Length: ${rawSummary.length}`);
        summaryPrompt = SUMMARY_PROMPT.replace(/{represented_party}/g, representedParty)
          .replace('{contract_name}', state.contract_name || 'Unknown')
          .replace('{clause_count}', String(clauses.length))
          .replace('{high_risk_count}', String(highRiskCount))
          .replace('{high_risk_clauses_list}', highRiskClausesText)
          .replace('{compliance_violation_clauses}', String(complianceViolationClauses))
          .replace('{compliance_violation_issues}', String(complianceViolationIssues))
          .replace('{overall_score}', String(overallScore))
          .replace('{top_flags}', topFlags.map((f) => `- ${f}`).join('\n') || 'None')
          .replace('{top_compliance}', topComplianceList.map((c) => `- ${c}`).join('\n') || 'None')
          .replace('{grounding_anchors}', anchorsText) +
          '\n\nCRITICAL: Your previous response contained conversational comments, raw JSON, markdown code blocks, or was too short. DO NOT output JSON or any conversational preambles like \'Here is the summary\'. Write ONLY the clean, user-facing executive summary paragraphs directly. Plain text only.';
      }
    }

    if (!executiveSummary) {
      const rawSummary = await this.callLlm(summaryPrompt);
      executiveSummary = cleanSummaryText(rawSummary) || 'Failed to generate executive summary.';
    }

    // Prepend perspective statement
    const prefix = `This analysis is prepared from the ${representedParty}'s perspective.\n\n`;
    if (!executiveSummary.startsWith('This analysis is prepared')) {
      executiveSummary = prefix + executiveSummary;
    }

    const extractionWarning = state.extraction_integrity_warning;
    if (extractionWarning) {
      console.error(`[report_includes_extraction_integrity_warning] Warning: ${extractionWarning}`);
    }

    const report: FinalReport = {
      contract_id: state.contract_id,
      contract_name: state.contract_name || 'Unknown',
      overall_score: overallScore,
      clause_count: clauses.length,
      high_risk_count: highRiskCount,
      violation_count: complianceViolationIssues,
      compliance_violation_clauses: complianceViolationClauses,
      compliance_violation_issues: complianceViolationIssues,
      executive_summary: executiveSummary,
      risk_scores: scores,
      compliance_results: compliance,
      redline_edits: edits,
      represented_party: representedParty,
      extraction_integrity_warning: extractionWarning || null,
      generated_at: new Date(),
    };

    return {
      report,
      pipeline_complete: true,
    };
  }
}
