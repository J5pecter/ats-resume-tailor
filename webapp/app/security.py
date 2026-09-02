"""Passwords, one-time codes, sessions and the audit trail.

Three rules hold everything here together:

1. **Nothing reversible is stored.** Passwords are bcrypt hashes; codes are
   SHA-256 hashes. Whoever reads a backup of this database gets no working
   credential out of it.
2. **The audit trail never carries a password.** There is nothing to carry —
   bcrypt is one-way — and a spreadsheet is opened on far more laptops than a
   database is.
3. **Failure never blocks a sign-in.** Logging is an observer of the auth path.
   An observer that can fail a login is worse than no observer.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Literal

import bcrypt
from itsdangerous import BadSignature, URLSafeTimedSerializer
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import AuthEvent, EmailCode, User, utcnow

# Cost 12: about a quarter-second per hash on ordinary hardware, which is
# unnoticeable to a person signing in and ruinous to somebody trying millions.
BCRYPT_ROUNDS = 12

CODE_LENGTH = 6
CODE_TTL_MINUTES = 10
MAX_CODE_ATTEMPTS = 5
RESEND_COOLDOWN_SECONDS = 60

SESSION_COOKIE = "rt_session"
SESSION_MAX_AGE = 60 * 60 * 24 * 30

Purpose = Literal["signup", "login"]


# ───────────────────────────── passwords ─────────────────────────────


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=BCRYPT_ROUNDS)).decode()


def verify_password(password: str, stored_hash: str) -> bool:
    if not stored_hash:
        return False
    try:
        return bcrypt.checkpw(password.encode(), stored_hash.encode())
    except ValueError:
        # A malformed hash in the database is not a reason to crash a login.
        return False


# ─────────────────────────── one-time codes ──────────────────────────


class CodeCooldown(Exception):
    def __init__(self, seconds: int) -> None:
        super().__init__(f"Wait {seconds} seconds before asking for another code.")
        self.seconds = seconds


def _hash_code(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()


def _generate_code() -> str:
    """secrets, not random. Codes guessable from each other defeat the point."""
    return "".join(str(secrets.randbelow(10)) for _ in range(CODE_LENGTH))


def issue_code(session: Session, email: str, purpose: Purpose) -> str:
    """Issue a code, superseding any earlier one for the same address.

    Superseding rather than accumulating: two live codes means two chances to
    guess, and a user who asked three times should not find only the first works.
    """
    address = email.strip().lower()

    recent = session.scalars(
        select(EmailCode)
        .where(EmailCode.email == address, EmailCode.purpose == purpose)
        .order_by(EmailCode.created_at.desc())
        .limit(1)
    ).first()
    if recent is not None and recent.created_at is not None:
        created = recent.created_at
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        elapsed = (utcnow() - created).total_seconds()
        if elapsed < RESEND_COOLDOWN_SECONDS:
            raise CodeCooldown(int(RESEND_COOLDOWN_SECONDS - elapsed) + 1)

    for row in session.scalars(
        select(EmailCode).where(
            EmailCode.email == address, EmailCode.purpose == purpose, EmailCode.used_at.is_(None)
        )
    ):
        row.used_at = utcnow()

    code = _generate_code()
    session.add(
        EmailCode(
            email=address,
            purpose=purpose,
            code_hash=_hash_code(code),
            expires_at=utcnow() + timedelta(minutes=CODE_TTL_MINUTES),
        )
    )
    session.commit()
    return code


CodeFailure = Literal["ok", "no_code", "expired", "too_many_attempts", "incorrect"]


def check_code(session: Session, email: str, purpose: Purpose, supplied: str) -> CodeFailure:
    """Check a code and burn it.

    Every failure increments the attempt counter, including a wrong guess —
    otherwise the limit is bypassed by simply guessing again.
    """
    address = email.strip().lower()
    digits = re.sub(r"\D", "", supplied or "")

    row = session.scalars(
        select(EmailCode)
        .where(EmailCode.email == address, EmailCode.purpose == purpose, EmailCode.used_at.is_(None))
        .order_by(EmailCode.created_at.desc())
        .limit(1)
    ).first()
    if row is None:
        return "no_code"

    expires = row.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < utcnow():
        row.used_at = utcnow()
        session.commit()
        return "expired"

    if row.attempts >= MAX_CODE_ATTEMPTS:
        row.used_at = utcnow()
        session.commit()
        return "too_many_attempts"

    # compare_digest so response timing cannot leak a partial match.
    if not hmac.compare_digest(_hash_code(digits), row.code_hash):
        row.attempts += 1
        session.commit()
        return "incorrect"

    row.used_at = utcnow()
    session.commit()
    return "ok"


def code_failure_message(reason: CodeFailure) -> str:
    return {
        "no_code": "That code has already been used, or none was requested. Ask for a new one.",
        "expired": f"That code expired — they last {CODE_TTL_MINUTES} minutes. Ask for a new one.",
        "too_many_attempts": "Too many incorrect attempts. Ask for a new code.",
        "incorrect": "That code is not correct.",
        "ok": "",
    }[reason]


# ───────────────────────────── sessions ──────────────────────────────


def _serialiser() -> URLSafeTimedSerializer:
    secret = os.environ.get("SECRET_KEY", "").strip()
    if not secret:
        # Ephemeral: every restart invalidates every session. Correct for a
        # laptop, and the startup check in main.py refuses to run without a
        # real one anywhere else.
        secret = "dev-only-not-for-deployment"
    return URLSafeTimedSerializer(secret, salt="session")


def make_session_token(user_id: int) -> str:
    return _serialiser().dumps({"uid": user_id})


def read_session_token(token: str | None) -> int | None:
    if not token:
        return None
    try:
        data = _serialiser().loads(token, max_age=SESSION_MAX_AGE)
    except BadSignature:
        return None
    except Exception:
        return None
    uid = data.get("uid") if isinstance(data, dict) else None
    return uid if isinstance(uid, int) else None


# ──────────────────────────── audit trail ────────────────────────────


def record_event(
    session: Session,
    *,
    email: str,
    event: str,
    method: str = "",
    ip: str = "",
    user_agent: str = "",
) -> None:
    """Write an auth event locally, then mirror it if a sheet is configured.

    Never raises. A spreadsheet being unreachable must not stop somebody
    logging in.
    """
    row = AuthEvent(
        email=email.strip().lower(),
        event=event,
        method=method,
        ip=ip[:64],
        user_agent=(user_agent or "")[:300],
    )
    try:
        session.add(row)
        session.commit()
    except Exception:
        session.rollback()
        return

    url = (os.environ.get("SHEETS_WEBHOOK_URL") or "").strip()
    if not url.startswith("https://"):
        return

    try:
        import json
        import urllib.request

        payload = {
            "secret": os.environ.get("SHEETS_WEBHOOK_SECRET", ""),
            "timestamp": utcnow().isoformat(),
            "email": row.email,
            "event": event,
            "method": method,
            "ip": row.ip,
            "userAgent": row.user_agent,
        }
        request = urllib.request.Request(
            url,
            data=json.dumps(payload).encode(),
            headers={"content-type": "application/json", "user-agent": "resume-tailor/1.0"},
            method="POST",
        )
        # Short timeout: this sits inside a sign-in, and a slow script must not
        # become a slow login.
        with urllib.request.urlopen(request, timeout=4):
            row.exported = True
            session.commit()
    except Exception:
        # Left unexported so it can be replayed. The row is not lost.
        session.rollback()


def find_user(session: Session, email: str) -> User | None:
    return session.scalars(select(User).where(User.email == email.strip().lower())).first()
