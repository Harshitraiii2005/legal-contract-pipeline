import { Document, Paragraph, TextRun, Packer, HeadingLevel } from 'docx';
import { ClauseExtract, RedlineEdit } from '../pipeline/state';

export async function buildRedlinedDocx(
  contractName: string,
  clauses: ClauseExtract[],
  edits: RedlineEdit[],
  overallScore: number
): Promise<Buffer> {
  const children: any[] = [];

  // Title
  children.push(
    new Paragraph({
      text: `Redlined Contract: ${contractName}`,
      heading: HeadingLevel.HEADING_1,
    })
  );

  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `Generated: ${new Date().toISOString().replace('T', ' ').substring(0, 19)} UTC  |  `,
          color: '606060',
        }),
        new TextRun({
          text: `Overall Risk Score: ${overallScore}/100`,
          color: '606060',
        }),
      ],
    })
  );

  // Spacers
  children.push(new Paragraph({ text: '' }));

  const editMap = new Map<number, RedlineEdit>();
  for (const e of edits) {
    editMap.set(e.clause_id, e);
  }

  for (const clause of clauses) {
    const edit = editMap.get(clause.id);
    const headingText = `${clause.id}. ${clause.heading || clause.type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}`;

    children.push(
      new Paragraph({
        text: headingText,
        heading: HeadingLevel.HEADING_2,
      })
    );

    if (edit) {
      // Original (strikethrough, red)
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: 'ORIGINAL: ',
              bold: true,
              color: 'C00000',
            }),
            new TextRun({
              text: clause.text,
              strike: true,
              color: 'C00000',
            }),
          ],
        })
      );

      // Revised (green)
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: 'REVISED: ',
              bold: true,
              color: '007000',
            }),
            new TextRun({
              text: edit.revised_text,
              color: '007000',
            }),
          ],
        })
      );

      // Risk Mitigation score comparison
      if (edit.original_score !== undefined && edit.mitigated_score !== undefined) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: 'Risk Mitigation: ',
                bold: true,
                color: '606060',
              }),
              new TextRun({
                text: `${edit.original_score}/100 → ${edit.mitigated_score}/100`,
                bold: true,
                color: edit.mitigation_score_mismatch ? 'C00000' : '007000',
              }),
              edit.mitigation_score_mismatch
                ? new TextRun({
                    text: ' (Mismatch flagged for review)',
                    color: 'C00000',
                    italics: true,
                  })
                : new TextRun({ text: '' }),
            ],
          })
        );
      }

      // Attorney note
      if (edit.attorney_note) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `⚖ Attorney note: ${edit.attorney_note}`,
                italics: true,
                size: 18, // 9pt in half-points
                color: '606060',
              }),
            ],
          })
        );
      }
    } else {
      children.push(
        new Paragraph({
          text: clause.text,
        })
      );
    }

    // Spacer
    children.push(new Paragraph({ text: '' }));
  }

  const doc = new Document({
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });

  return await Packer.toBuffer(doc);
}
