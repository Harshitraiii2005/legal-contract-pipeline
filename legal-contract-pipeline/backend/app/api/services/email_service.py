"""Email service — approval notifications via SMTP/SendGrid."""

from __future__ import annotations

import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class EmailService:
    def __init__(self) -> None:
        self.host = settings.SMTP_HOST
        self.port = settings.SMTP_PORT
        self.user = settings.SMTP_USER
        self.password = settings.SMTP_PASSWORD
        self.from_email = settings.FROM_EMAIL

    # ── Public send methods ───────────────────────────────────────────────

    def send_review_ready(
        self,
        to: str,
        reviewer_name: str,
        contract_name: str,
        overall_score: int,
        review_url: str,
    ) -> None:
        subject = f"[Legal AI] Review ready: {contract_name}"
        html = _REVIEW_READY_TEMPLATE.format(
            reviewer_name=reviewer_name,
            contract_name=contract_name,
            overall_score=overall_score,
            risk_label=_score_label(overall_score),
            risk_color=_score_color(overall_score),
            review_url=review_url,
        )
        self._send(to, subject, html)

    def send_approval_confirmation(
        self,
        to: str,
        contract_name: str,
        approved: bool,
        reviewer_name: str,
    ) -> None:
        action = "approved" if approved else "rejected"
        subject = f"[Legal AI] Contract {action}: {contract_name}"
        html = _DECISION_TEMPLATE.format(
            contract_name=contract_name,
            action=action.upper(),
            action_color="#27AE60" if approved else "#C0392B",
            reviewer_name=reviewer_name,
        )
        self._send(to, subject, html)

    # ── Internal ──────────────────────────────────────────────────────────

    def _send(self, to: str, subject: str, html: str) -> None:
        if not self.user or not self.password:
            logger.warning("email_skipped_no_credentials", to=to, subject=subject)
            return

        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = self.from_email
        msg["To"] = to
        msg.attach(MIMEText(html, "html"))

        try:
            with smtplib.SMTP(self.host, self.port) as server:
                server.starttls()
                server.login(self.user, self.password)
                server.sendmail(self.from_email, to, msg.as_string())
            logger.info("email_sent", to=to, subject=subject)
        except Exception as exc:
            logger.error("email_failed", to=to, error=str(exc))


# ── Score helpers ─────────────────────────────────────────────────────────────

def _score_label(score: int) -> str:
    if score < 30:
        return "LOW RISK"
    elif score < 60:
        return "MEDIUM RISK"
    elif score < 80:
        return "HIGH RISK"
    return "CRITICAL RISK"


def _score_color(score: int) -> str:
    if score < 30:
        return "#27AE60"
    elif score < 60:
        return "#F39C12"
    elif score < 80:
        return "#E67E22"
    return "#C0392B"


# ── Email templates ───────────────────────────────────────────────────────────

_REVIEW_READY_TEMPLATE = """\
<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f4f4f4;padding:24px">
<div style="max-width:600px;margin:auto;background:white;border-radius:8px;overflow:hidden">
  <div style="background:#1A1A2E;padding:24px;color:white">
    <h1 style="margin:0;font-size:20px">Contract Review Ready</h1>
  </div>
  <div style="padding:24px">
    <p>Hi {reviewer_name},</p>
    <p>The AI pipeline has completed its review of <strong>{contract_name}</strong>.</p>
    <div style="background:#f9f9f9;border-left:4px solid {risk_color};padding:16px;margin:16px 0">
      <p style="margin:0;font-size:24px;font-weight:bold;color:{risk_color}">{overall_score}/100</p>
      <p style="margin:4px 0 0;color:#666">{risk_label}</p>
    </div>
    <p>Please review and approve or reject the changes.</p>
    <a href="{review_url}" style="display:inline-block;background:#E94560;color:white;padding:12px 24px;border-radius:4px;text-decoration:none;font-weight:bold">
      Open Review
    </a>
  </div>
</div>
</body></html>
"""

_DECISION_TEMPLATE = """\
<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f4f4f4;padding:24px">
<div style="max-width:600px;margin:auto;background:white;border-radius:8px;overflow:hidden">
  <div style="background:#1A1A2E;padding:24px;color:white">
    <h1 style="margin:0;font-size:20px">Review Decision Recorded</h1>
  </div>
  <div style="padding:24px">
    <p><strong>{contract_name}</strong> has been
      <span style="color:{action_color};font-weight:bold">{action}</span>
      by {reviewer_name}.
    </p>
    <p style="color:#666;font-size:13px">This decision has been recorded in the immutable audit log.</p>
  </div>
</div>
</body></html>
"""
