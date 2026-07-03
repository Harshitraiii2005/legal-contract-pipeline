"""Risk summary PDF export using ReportLab."""

from __future__ import annotations

import io
from datetime import datetime

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (
    HRFlowable,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.graph.state import ClauseRiskScore, ComplianceResult, FinalReport

# ── Palette ───────────────────────────────────────────────────────────────────
DARK_NAVY = colors.HexColor("#1A1A2E")
ACCENT = colors.HexColor("#E94560")
LOW = colors.HexColor("#27AE60")
MEDIUM = colors.HexColor("#F39C12")
HIGH = colors.HexColor("#E67E22")
CRITICAL = colors.HexColor("#C0392B")
LIGHT_GREY = colors.HexColor("#F5F5F5")


def _severity_color(severity: str) -> colors.Color:
    return {"low": LOW, "medium": MEDIUM, "high": HIGH, "critical": CRITICAL}.get(
        severity.lower(), MEDIUM
    )


def build_risk_pdf(report: FinalReport) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=2 * cm,
        rightMargin=2 * cm,
        topMargin=2 * cm,
        bottomMargin=2 * cm,
    )

    styles = getSampleStyleSheet()
    story = []

    # ── Cover ─────────────────────────────────────────────────────────────
    story.append(
        Paragraph(
            "CONTRACT RISK REPORT",
            ParagraphStyle("cover_title", fontSize=26, textColor=DARK_NAVY, alignment=TA_CENTER, spaceAfter=6),
        )
    )
    story.append(
        Paragraph(
            report.contract_name,
            ParagraphStyle("subtitle", fontSize=14, textColor=ACCENT, alignment=TA_CENTER, spaceAfter=4),
        )
    )
    story.append(
        Paragraph(
            f"Generated {report.generated_at.strftime('%d %B %Y, %H:%M UTC')}",
            ParagraphStyle("meta", fontSize=9, textColor=colors.grey, alignment=TA_CENTER),
        )
    )
    story.append(Spacer(1, 0.5 * cm))
    story.append(HRFlowable(width="100%", thickness=2, color=ACCENT))
    story.append(Spacer(1, 0.5 * cm))

    # ── KPI row ───────────────────────────────────────────────────────────
    kpi_data = [
        ["Overall Risk Score", "Total Clauses", "High-Risk Clauses", "Compliance Violations"],
        [
            f"{report.overall_score}/100",
            str(report.clause_count),
            str(report.high_risk_count),
            str(report.violation_count),
        ],
    ]
    kpi_table = Table(kpi_data, colWidths=[4.25 * cm] * 4)
    kpi_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), DARK_NAVY),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTSIZE", (0, 0), (-1, 0), 8),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 1), (-1, 1), 20),
                ("FONTNAME", (0, 1), (-1, 1), "Helvetica-Bold"),
                ("TEXTCOLOR", (0, 1), (0, 1), ACCENT),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("ROWBACKGROUNDS", (0, 1), (-1, 1), [LIGHT_GREY]),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.white),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    story.append(kpi_table)
    story.append(Spacer(1, 0.6 * cm))

    # ── Executive Summary ─────────────────────────────────────────────────
    story.append(
        Paragraph("Executive Summary", ParagraphStyle("h1", fontSize=13, textColor=DARK_NAVY, fontName="Helvetica-Bold", spaceAfter=4))
    )
    story.append(
        Paragraph(
            report.executive_summary.replace("\n", "<br/>"),
            ParagraphStyle("body", fontSize=9, leading=14),
        )
    )
    story.append(Spacer(1, 0.5 * cm))
    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.lightgrey))
    story.append(Spacer(1, 0.4 * cm))

    # ── Clause Risk Table ─────────────────────────────────────────────────
    story.append(
        Paragraph("Clause Risk Scores", ParagraphStyle("h1", fontSize=13, textColor=DARK_NAVY, fontName="Helvetica-Bold", spaceAfter=6))
    )

    risk_rows = [["#", "Type", "Heading", "Score", "Severity", "Key Flags"]]
    for score in sorted(report.risk_scores, key=lambda s: s.score, reverse=True):
        risk_rows.append(
            [
                str(score.clause_id),
                score.clause_id and _lookup_type(report, score.clause_id) or "",
                _lookup_heading(report, score.clause_id),
                str(score.score),
                score.severity.upper(),
                ", ".join(score.flags[:3]),
            ]
        )

    risk_table = Table(risk_rows, colWidths=[1 * cm, 3 * cm, 4.5 * cm, 1.5 * cm, 2 * cm, 5 * cm])
    ts = TableStyle(
        [
            ("BACKGROUND", (0, 0), (-1, 0), DARK_NAVY),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("ALIGN", (3, 0), (4, -1), "CENTER"),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT_GREY]),
            ("GRID", (0, 0), (-1, -1), 0.25, colors.lightgrey),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]
    )
    # Colour severity cells
    for row_idx, score in enumerate(
        sorted(report.risk_scores, key=lambda s: s.score, reverse=True), start=1
    ):
        col = _severity_color(score.severity)
        ts.add("TEXTCOLOR", (4, row_idx), (4, row_idx), col)
        ts.add("FONTNAME", (4, row_idx), (4, row_idx), "Helvetica-Bold")

    risk_table.setStyle(ts)
    story.append(risk_table)
    story.append(Spacer(1, 0.6 * cm))

    # ── Compliance Issues ─────────────────────────────────────────────────
    violations = [c for c in report.compliance_results if not c.compliant]
    if violations:
        story.append(
            Paragraph("Compliance Issues", ParagraphStyle("h1", fontSize=13, textColor=DARK_NAVY, fontName="Helvetica-Bold", spaceAfter=6))
        )
        comp_rows = [["Clause #", "Framework", "Article", "Issue"]]
        for cr in violations:
            for v in cr.violations:
                comp_rows.append(
                    [str(cr.clause_id), v.framework, v.article or "", v.description]
                )
        comp_table = Table(comp_rows, colWidths=[1.5 * cm, 2.5 * cm, 2 * cm, 11 * cm])
        comp_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), DARK_NAVY),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                    ("FONTSIZE", (0, 0), (-1, -1), 8),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT_GREY]),
                    ("GRID", (0, 0), (-1, -1), 0.25, colors.lightgrey),
                    ("TOPPADDING", (0, 0), (-1, -1), 5),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                    ("TEXTCOLOR", (1, 1), (1, -1), ACCENT),
                ]
            )
        )
        story.append(comp_table)

    doc.build(story)
    return buf.getvalue()


def _lookup_type(report: FinalReport, clause_id: int) -> str:
    # Scores don't carry clause type; this is a best-effort lookup
    return ""


def _lookup_heading(report: FinalReport, clause_id: int) -> str:
    return ""
