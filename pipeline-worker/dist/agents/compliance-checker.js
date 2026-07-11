"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ComplianceChecker = exports.DEFAULT_FRAMEWORKS = void 0;
const base_agent_1 = require("./base-agent");
const COMPLIANCE_PROMPT = `\
You are a legal compliance specialist. Check if the following contract clause
violates or creates risk under any of the listed regulatory frameworks.

Frameworks to check: {frameworks}

## Strict Applicability Rules:
- **HIPAA**: ONLY applies if the contract explicitly involves Protected Health Information (PHI), medical records, or healthcare-related activities. If the clause does not deal with PHI or healthcare-related activities, mark as compliant for HIPAA. Do NOT raise false positives on generic data storage or API services.
- **SOX (Sarbanes-Oxley)**: ONLY applies to financial accounting, internal audit controls, corporate governance, executive certification of financial reports, or fraudulent financial reporting. Under no circumstances should general SLAs, uptime guarantees, technical support parameters, or API response times be flagged under SOX.
- **PCI-DSS**: ONLY applies if payment card details, cardholder data, or credit card transactions are processed. We use strict evidence-gating: if the contract references standard cardholder data security measures or states general compliance, it must be treated as compliant. Do NOT flag the lack of specific version numbers (e.g., v4.0) or minor administrative details as violations.
- **FCPA**: ONLY applies to anti-bribery, anti-corruption, dealings with government officials, and ethical conduct.
- **GDPR / CCPA / UK GDPR**: ONLY apply if personal data (especially of EU/California/UK residents) is processed under the contract.

Clause:
Type: {clause_type}
Text:
{clause_text}

Return a JSON object with:
  - "compliant": boolean — true if no violations found (set to true if no applicable framework is violated)
  - "violations": list of objects, each with:
      - "framework": name of the regulation
      - "article": specific article/section (if known)
      - "description": 1–2 sentence explanation of the issue (explain why it is a real violation of this specific regulation, avoiding generic statements)
  - "recommendations": list of short, concrete fix suggestions. Each recommendation must include specific language, thresholds, or default values (e.g. "Add a clause specifying a standard 30-day cure period for material breach" instead of just "specify a cure period") to make them actionable.

Return ONLY valid JSON.
`.trim();
exports.DEFAULT_FRAMEWORKS = [
    'GDPR',
    'CCPA',
    'HIPAA',
    'SOX',
    'FCPA',
    'UK GDPR',
    'PCI-DSS',
];
class ComplianceChecker extends base_agent_1.BaseAgent {
    agentName = 'compliance_checker';
    maxTokens = 1024;
    frameworks;
    constructor(frameworks = null) {
        super();
        this.frameworks = frameworks || exports.DEFAULT_FRAMEWORKS;
    }
    determineFrameworks(clauses) {
        const govLawTexts = [];
        for (const c of clauses) {
            if (c.type === 'governing_law') {
                govLawTexts.push((c.text || '').toLowerCase());
            }
        }
        if (govLawTexts.length === 0) {
            return this.frameworks;
        }
        const frameworksSet = new Set();
        // CCPA for California
        if (govLawTexts.some((t) => t.includes('california') || t.includes(' ca ') || t.includes(', ca'))) {
            frameworksSet.add('CCPA');
        }
        // GDPR for Europe/EU countries
        const euKeywords = ['european union', ' eu ', 'germany', 'france', 'ireland', 'netherlands', 'belgium', 'switzerland'];
        if (govLawTexts.some((t) => euKeywords.some((kw) => t.includes(kw)))) {
            frameworksSet.add('GDPR');
        }
        // UK GDPR for United Kingdom/England/Wales/Scotland
        const ukKeywords = ['united kingdom', 'uk ', ' uk', 'england', 'wales', 'london', 'great britain'];
        if (govLawTexts.some((t) => ukKeywords.some((kw) => t.includes(kw)))) {
            frameworksSet.add('UK GDPR');
        }
        // US Federal laws (SOX, HIPAA, FCPA) if US or Delaware or New York governs
        const usKeywords = ['delaware', 'new york', 'united states', ' u.s.', 'us law', 'federal law'];
        if (govLawTexts.some((t) => usKeywords.some((kw) => t.includes(kw)))) {
            frameworksSet.add('SOX');
            frameworksSet.add('FCPA');
            frameworksSet.add('HIPAA');
        }
        // PCI-DSS if payment or credit cards are involved
        let hasPayment = false;
        for (const c of clauses) {
            if (c.type === 'payment' || (c.text || '').toLowerCase().includes('credit card')) {
                hasPayment = true;
                break;
            }
        }
        if (hasPayment) {
            frameworksSet.add('PCI-DSS');
        }
        if (frameworksSet.size === 0) {
            return this.frameworks;
        }
        return Array.from(frameworksSet).sort();
    }
    async execute(state) {
        const clauses = state.clauses || [];
        const activeFrameworks = this.determineFrameworks(clauses);
        console.log(`[compliance_active_frameworks] Frameworks: ${activeFrameworks.join(', ')}`);
        const results = await this.checkAll(clauses, activeFrameworks);
        let violationCount = 0;
        let complianceViolationClauses = 0;
        for (const r of results) {
            if (r.violations && r.violations.length > 0) {
                violationCount += r.violations.length;
                complianceViolationClauses++;
            }
        }
        console.log(`[compliance_check_done] Total: ${results.length}, Violations: ${violationCount}`);
        return {
            compliance_results: results,
            compliance_violation_count: violationCount,
            compliance_violation_clauses: complianceViolationClauses,
            compliance_violation_issues: violationCount,
        };
    }
    async checkAll(clauses, frameworks) {
        const relevantTypes = new Set([
            'confidentiality',
            'data_protection',
            'intellectual_property',
            'payment',
            'indemnification',
        ]);
        const tasks = clauses.map((c) => {
            if (relevantTypes.has(c.type)) {
                return this.checkClause(c, frameworks);
            }
            else {
                return this.skipClause(c);
            }
        });
        return Promise.all(tasks);
    }
    async checkClause(clause, frameworks) {
        const prompt = COMPLIANCE_PROMPT.replace('{frameworks}', frameworks.join(', '))
            .replace('{clause_type}', clause.type)
            .replace('{clause_text}', clause.text);
        const result = await this.callLlmJson(prompt);
        // Defensive parsing of recommendations
        const rawRecs = result.recommendations || [];
        const cleanRecs = [];
        if (Array.isArray(rawRecs)) {
            for (const r of rawRecs) {
                if (r && typeof r === 'object') {
                    const val = r.recommendation || r.text || r.description || JSON.stringify(r);
                    cleanRecs.push(val);
                }
                else if (r !== null && r !== undefined) {
                    cleanRecs.push(String(r));
                }
            }
        }
        else if (rawRecs && typeof rawRecs === 'object') {
            const val = rawRecs.recommendation || rawRecs.text || rawRecs.description || JSON.stringify(rawRecs);
            cleanRecs.push(val);
        }
        else if (rawRecs) {
            cleanRecs.push(String(rawRecs));
        }
        // Defensive parsing of violations
        const rawViolations = result.violations || [];
        const cleanViolations = [];
        if (Array.isArray(rawViolations)) {
            for (const v of rawViolations) {
                if (v && typeof v === 'object') {
                    const cleanV = { ...v };
                    if (cleanV.article === undefined || cleanV.article === null) {
                        cleanV.article = '';
                    }
                    else {
                        cleanV.article = String(cleanV.article);
                    }
                    if (!cleanV.framework) {
                        cleanV.framework = 'Unknown';
                    }
                    if (!cleanV.description) {
                        cleanV.description = 'Compliance violation detected.';
                    }
                    cleanViolations.push(cleanV);
                }
            }
        }
        return {
            clause_id: clause.id,
            compliant: result.compliant ?? true,
            violations: cleanViolations,
            recommendations: cleanRecs,
        };
    }
    async skipClause(clause) {
        return {
            clause_id: clause.id,
            compliant: true,
            violations: [],
            recommendations: [],
        };
    }
}
exports.ComplianceChecker = ComplianceChecker;
