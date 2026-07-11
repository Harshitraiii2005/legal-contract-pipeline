"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildRedlinedDocx = buildRedlinedDocx;
const docx_1 = require("docx");
async function buildRedlinedDocx(contractName, clauses, edits, overallScore) {
    const children = [];
    // Title
    children.push(new docx_1.Paragraph({
        text: `Redlined Contract: ${contractName}`,
        heading: docx_1.HeadingLevel.HEADING_1,
    }));
    children.push(new docx_1.Paragraph({
        children: [
            new docx_1.TextRun({
                text: `Generated: ${new Date().toISOString().replace('T', ' ').substring(0, 19)} UTC  |  `,
                color: '606060',
            }),
            new docx_1.TextRun({
                text: `Overall Risk Score: ${overallScore}/100`,
                color: '606060',
            }),
        ],
    }));
    // Spacers
    children.push(new docx_1.Paragraph({ text: '' }));
    const editMap = new Map();
    for (const e of edits) {
        editMap.set(e.clause_id, e);
    }
    for (const clause of clauses) {
        const edit = editMap.get(clause.id);
        const headingText = `${clause.id}. ${clause.heading || clause.type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}`;
        children.push(new docx_1.Paragraph({
            text: headingText,
            heading: docx_1.HeadingLevel.HEADING_2,
        }));
        if (edit) {
            // Original (strikethrough, red)
            children.push(new docx_1.Paragraph({
                children: [
                    new docx_1.TextRun({
                        text: 'ORIGINAL: ',
                        bold: true,
                        color: 'C00000',
                    }),
                    new docx_1.TextRun({
                        text: clause.text,
                        strike: true,
                        color: 'C00000',
                    }),
                ],
            }));
            // Revised (green)
            children.push(new docx_1.Paragraph({
                children: [
                    new docx_1.TextRun({
                        text: 'REVISED: ',
                        bold: true,
                        color: '007000',
                    }),
                    new docx_1.TextRun({
                        text: edit.revised_text,
                        color: '007000',
                    }),
                ],
            }));
            // Risk Mitigation score comparison
            if (edit.original_score !== undefined && edit.mitigated_score !== undefined) {
                children.push(new docx_1.Paragraph({
                    children: [
                        new docx_1.TextRun({
                            text: 'Risk Mitigation: ',
                            bold: true,
                            color: '606060',
                        }),
                        new docx_1.TextRun({
                            text: `${edit.original_score}/100 → ${edit.mitigated_score}/100`,
                            bold: true,
                            color: edit.mitigation_score_mismatch ? 'C00000' : '007000',
                        }),
                        edit.mitigation_score_mismatch
                            ? new docx_1.TextRun({
                                text: ' (Mismatch flagged for review)',
                                color: 'C00000',
                                italics: true,
                            })
                            : new docx_1.TextRun({ text: '' }),
                    ],
                }));
            }
            // Attorney note
            if (edit.attorney_note) {
                children.push(new docx_1.Paragraph({
                    children: [
                        new docx_1.TextRun({
                            text: `⚖ Attorney note: ${edit.attorney_note}`,
                            italics: true,
                            size: 18, // 9pt in half-points
                            color: '606060',
                        }),
                    ],
                }));
            }
        }
        else {
            children.push(new docx_1.Paragraph({
                text: clause.text,
            }));
        }
        // Spacer
        children.push(new docx_1.Paragraph({ text: '' }));
    }
    const doc = new docx_1.Document({
        sections: [
            {
                properties: {},
                children,
            },
        ],
    });
    return await docx_1.Packer.toBuffer(doc);
}
