"""Sending the one-time codes.

SMTP when configured, the server log when not. The fallback is a real feature,
not a stub: it lets a fresh checkout work with no external account at all. It
is also obviously wrong for production, so it says so loudly every time.
"""

from __future__ import annotations

import os
import smtplib
from email.message import EmailMessage

from .security import CODE_TTL_MINUTES


def transport_name() -> str:
    configured = os.environ.get("SMTP_HOST", "").strip() and os.environ.get("SMTP_USER", "").strip()
    return "smtp" if configured else "console"


def send_code(to: str, code: str, purpose: str) -> None:
    subject = (
        "Confirm your email for Resume Tailor"
        if purpose == "signup"
        else "Your sign-in code for Resume Tailor"
    )
    lead = (
        "Use this code to confirm your email address:"
        if purpose == "signup"
        else "Use this code to sign in:"
    )
    text = (
        f"{lead}\n\n{code}\n\n"
        f"It expires in {CODE_TTL_MINUTES} minutes and can be used once.\n"
        "If you did not ask for this, ignore it - nothing has been created or changed.\n"
    )

    if transport_name() == "console":
        print(
            "\n"
            "  +---------------------------------------------------------------+\n"
            "  |  NO SMTP CONFIGURED - the code below was NOT emailed.         |\n"
            "  |  Set SMTP_HOST / SMTP_USER / SMTP_PASS to send it for real.   |\n"
            "  +---------------------------------------------------------------+\n"
            f"  to      : {to}\n"
            f"  purpose : {purpose}\n"
            f"  code    : {code}\n",
            flush=True,
        )
        return

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = os.environ.get("SMTP_FROM", "").strip() or os.environ["SMTP_USER"]
    message["To"] = to
    message.set_content(text)

    port = int(os.environ.get("SMTP_PORT", "587"))
    host = os.environ["SMTP_HOST"]
    # 465 is implicit TLS; 587 upgrades with STARTTLS. Getting this backwards
    # produces a hang rather than an error, which is miserable to debug.
    if port == 465:
        with smtplib.SMTP_SSL(host, port, timeout=20) as server:
            server.login(os.environ["SMTP_USER"], os.environ.get("SMTP_PASS", ""))
            server.send_message(message)
    else:
        with smtplib.SMTP(host, port, timeout=20) as server:
            server.starttls()
            server.login(os.environ["SMTP_USER"], os.environ.get("SMTP_PASS", ""))
            server.send_message(message)
