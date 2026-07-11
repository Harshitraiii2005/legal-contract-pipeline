"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildRiskPdf = buildRiskPdf;
const pdfkit_1 = __importDefault(require("pdfkit"));
const DARK_NAVY = '#1A1A2E';
const ACCENT = '#E94560';
const LOW = '#27AE60';
const MEDIUM = '#F39C12';
const HIGH = '#E67E22';
const CRITICAL = '#C0392B';
const LIGHT_GREY = '#F5F5F5';
function getSeverityColor(severity) {
    switch (severity.toLowerCase()) {
        case 'low':
            return LOW;
        case 'medium':
            return MEDIUM;
        case 'high':
            return HIGH;
        case 'critical':
            return CRITICAL;
        default:
            return MEDIUM;
    }
}
function buildRiskPdf(report, clauses) {
    return new Promise((resolve, reject) => {
        const doc = new pdfkit_1.default({
            size: 'A4',
            margins: { top: 50, bottom: 50, left: 50, right: 50 },
        });
        const chunks = [];
        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', (err) => reject(err));
        const pageWidth = 595.28;
        const margin = 50;
        const contentWidth = pageWidth - 2 * margin; // 495.28
        // --- Cover / Header ---
        doc.fillColor(DARK_NAVY).fontSize(24).text('CONTRACT RISK REPORT', { align: 'center' });
        doc.moveDown(0.2);
        doc.fillColor(ACCENT).fontSize(14).text(report.contract_name, { align: 'center' });
        doc.moveDown(0.2);
        const dateStr = report.generated_at
            ? new Date(report.generated_at).toUTCString()
            : new Date().toUTCString();
        doc.fillColor('#666666').fontSize(9).text(`Generated ${dateStr}`, { align: 'center' });
        doc.moveDown(0.8);
        // Accent line
        doc
            .strokeColor(ACCENT)
            .lineWidth(2)
            .moveTo(margin, doc.y)
            .lineTo(pageWidth - margin, doc.y)
            .stroke();
        doc.moveDown(1);
        // --- KPI Row ---
        const kpiY = doc.y;
        const kpiHeight = 60;
        doc.rect(margin, kpiY, contentWidth, kpiHeight).fill(LIGHT_GREY);
        const colWidth = contentWidth / 4;
        const kpis = [
            { label: 'Overall Risk Score', val: `${report.overall_score}/100`, color: ACCENT },
            { label: 'Total Clauses', val: String(report.clause_count), color: DARK_NAVY },
            { label: 'High-Risk Clauses', val: String(report.high_risk_count), color: DARK_NAVY },
            { label: 'Compliance Violations', val: String(report.violation_count), color: DARK_NAVY },
        ];
        kpis.forEach((kpi, idx) => {
            const colX = margin + idx * colWidth;
            doc
                .fillColor(DARK_NAVY)
                .fontSize(8)
                .text(kpi.label, colX, kpiY + 12, { width: colWidth, align: 'center' });
            doc
                .fillColor(kpi.color)
                .fontSize(18)
                .text(kpi.val, colX, kpiY + 28, { width: colWidth, align: 'center' });
        });
        doc.y = kpiY + kpiHeight + 20;
        // --- Executive Summary ---
        doc.fillColor(DARK_NAVY).fontSize(13).text('Executive Summary', { underline: false });
        doc.moveDown(0.4);
        doc
            .fillColor(DARK_NAVY)
            .fontSize(9)
            .text(report.executive_summary || 'No summary available.', {
            lineGap: 4,
            width: contentWidth,
            align: 'left',
        });
        doc.moveDown(1.5);
        // Divider line
        doc
            .strokeColor('#E0E0E0')
            .lineWidth(0.5)
            .moveTo(margin, doc.y)
            .lineTo(pageWidth - margin, doc.y)
            .stroke();
        doc.moveDown(1);
        // --- Clause Risk Table ---
        doc.fillColor(DARK_NAVY).fontSize(13).text('Clause Risk Scores');
        doc.moveDown(0.6);
        const tableHeaders = ['#', 'Type', 'Heading', 'Score', 'Severity', 'Key Flags'];
        const colWidths = [25, 80, 120, 40, 60, 170]; // sum = 495
        let currentY = doc.y;
        // Header background
        doc.rect(margin, currentY, contentWidth, 20).fill(DARK_NAVY);
        doc.fillColor('#FFFFFF').fontSize(8);
        let currentX = margin;
        tableHeaders.forEach((header, idx) => {
            doc.text(header, currentX + 4, currentY + 6, {
                width: colWidths[idx] - 8,
                align: idx === 0 || idx === 3 ? 'center' : 'left',
            });
            currentX += colWidths[idx];
        });
        currentY += 20;
        const sortedScores = [...report.risk_scores].sort((a, b) => b.score - a.score);
        sortedScores.forEach((score, rowIndex) => {
            // Row height
            const rowHeight = 22;
            // check page break
            if (currentY + rowHeight > doc.page.height - 50) {
                doc.addPage();
                currentY = 50;
                // Draw header again on new page
                doc.rect(margin, currentY, contentWidth, 20).fill(DARK_NAVY);
                doc.fillColor('#FFFFFF').fontSize(8);
                let tempX = margin;
                tableHeaders.forEach((header, idx) => {
                    doc.text(header, tempX + 4, currentY + 6, {
                        width: colWidths[idx] - 8,
                        align: idx === 0 || idx === 3 ? 'center' : 'left',
                    });
                    tempX += colWidths[idx];
                });
                currentY += 20;
            }
            // Alternating background
            if (rowIndex % 2 === 1) {
                doc.rect(margin, currentY, contentWidth, rowHeight).fill(LIGHT_GREY);
            }
            const c = clauses.find((x) => x.id === score.clause_id);
            const cType = c
                ? c.type.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase())
                : '';
            const cHeading = c ? c.heading : '';
            doc.fillColor(DARK_NAVY).fontSize(8);
            let tempX = margin;
            // #
            doc.text(String(score.clause_id), tempX + 4, currentY + 7, {
                width: colWidths[0] - 8,
                align: 'center',
            });
            tempX += colWidths[0];
            // Type
            doc.text(cType, tempX + 4, currentY + 7, {
                width: colWidths[1] - 8,
                height: 12,
                ellipsis: true,
            });
            tempX += colWidths[1];
            // Heading
            doc.text(cHeading || '-', tempX + 4, currentY + 7, {
                width: colWidths[2] - 8,
                height: 12,
                ellipsis: true,
            });
            tempX += colWidths[2];
            // Score
            doc.text(String(score.score), tempX + 4, currentY + 7, {
                width: colWidths[3] - 8,
                align: 'center',
            });
            tempX += colWidths[3];
            // Severity
            doc.fillColor(getSeverityColor(score.severity)).text(score.severity.toUpperCase(), tempX + 4, currentY + 7, {
                width: colWidths[4] - 8,
            });
            doc.fillColor(DARK_NAVY);
            tempX += colWidths[4];
            // Key Flags
            const flagsText = (score.flags || []).slice(0, 3).join(', ');
            doc.text(flagsText || '-', tempX + 4, currentY + 7, {
                width: colWidths[5] - 8,
                height: 12,
                ellipsis: true,
            });
            // Bottom grid line
            doc
                .strokeColor('#E0E0E0')
                .lineWidth(0.25)
                .moveTo(margin, currentY + rowHeight)
                .lineTo(pageWidth - margin, currentY + rowHeight)
                .stroke();
            currentY += rowHeight;
        });
        doc.y = currentY + 20;
        // --- Compliance Issues ---
        const violations = report.compliance_results.filter((cr) => !cr.compliant);
        if (violations.length > 0) {
            if (doc.y + 60 > doc.page.height - 50) {
                doc.addPage();
            }
            doc.fillColor(DARK_NAVY).fontSize(13).text('Compliance Issues');
            doc.moveDown(0.6);
            const compHeaders = ['Clause #', 'Framework', 'Article', 'Issue'];
            const compWidths = [45, 75, 75, 300]; // sum = 495
            let compY = doc.y;
            // Header background
            doc.rect(margin, compY, contentWidth, 20).fill(DARK_NAVY);
            doc.fillColor('#FFFFFF').fontSize(8);
            let tempX = margin;
            compHeaders.forEach((header, idx) => {
                doc.text(header, tempX + 4, compY + 6, {
                    width: compWidths[idx] - 8,
                    align: idx === 0 ? 'center' : 'left',
                });
                tempX += compWidths[idx];
            });
            compY += 20;
            violations.forEach((cr, rIdx) => {
                cr.violations.forEach((v, vIdx) => {
                    const rowHeight = 24;
                    if (compY + rowHeight > doc.page.height - 50) {
                        doc.addPage();
                        compY = 50;
                        // Draw headers again
                        doc.rect(margin, compY, contentWidth, 20).fill(DARK_NAVY);
                        doc.fillColor('#FFFFFF').fontSize(8);
                        let tX = margin;
                        compHeaders.forEach((header, idx) => {
                            doc.text(header, tX + 4, compY + 6, {
                                width: compWidths[idx] - 8,
                                align: idx === 0 ? 'center' : 'left',
                            });
                            tX += compWidths[idx];
                        });
                        compY += 20;
                    }
                    if ((rIdx + vIdx) % 2 === 1) {
                        doc.rect(margin, compY, contentWidth, rowHeight).fill(LIGHT_GREY);
                    }
                    doc.fillColor(DARK_NAVY).fontSize(8);
                    let tX = margin;
                    // Clause #
                    doc.text(String(cr.clause_id), tX + 4, compY + 7, {
                        width: compWidths[0] - 8,
                        align: 'center',
                    });
                    tX += compWidths[0];
                    // Framework
                    doc.fillColor(ACCENT).text(v.framework, tX + 4, compY + 7, {
                        width: compWidths[1] - 8,
                    });
                    doc.fillColor(DARK_NAVY);
                    tX += compWidths[1];
                    // Article
                    doc.text(v.article || '-', tX + 4, compY + 7, {
                        width: compWidths[2] - 8,
                    });
                    tX += compWidths[2];
                    // Issue
                    doc.text(v.description || '-', tX + 4, compY + 7, {
                        width: compWidths[3] - 8,
                        height: 16,
                        ellipsis: true,
                    });
                    // Bottom line
                    doc
                        .strokeColor('#E0E0E0')
                        .lineWidth(0.25)
                        .moveTo(margin, compY + rowHeight)
                        .lineTo(pageWidth - margin, compY + rowHeight)
                        .stroke();
                    compY += rowHeight;
                });
            });
        }
        doc.end();
    });
}
