"""The application: routes, templates, startup checks.

Server-rendered Jinja with a little HTMX. No bundler, no node_modules, no build
step — the whole thing is `uvicorn app.main:app`, which is what makes it
deployable anywhere that runs Python.
"""

from __future__ import annotations

import io
import json
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Any

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Form, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy import select
from sqlalchemy.orm import Session

from pytailor import pipeline
from pytailor.exports import write_docx, write_pdf
from pytailor.llm import LlmError, resolve_chain

from . import security
from .db import (
    JobPosting,
    SourceResume,
    TailoredResume,
    User,
    create_all,
    dumps,
    get_session,
    utcnow,
)
from .mail import send_code, transport_name

# Loaded before anything reads the environment. A managed host sets real
# variables and there is no file, so this is a no-op there; on a laptop it is
# the difference between "works" and "export twelve things first".
load_dotenv(Path(__file__).parent.parent / ".env")

BASE_DIR = Path(__file__).parent
MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_MB", "5")) * 1024 * 1024

@asynccontextmanager
async def lifespan(_: FastAPI):
    _startup()
    yield


# Each host advertises itself by name. PORT is deliberately NOT in this list:
# plenty of local runners set it, and treating it as "this is production"
# refuses to start on a laptop for no reason — which it did, once.
_MANAGED_HOST_MARKERS = ("RENDER", "SPACE_ID", "FLY_APP_NAME", "RAILWAY_ENVIRONMENT", "KOYEB_APP_NAME")


def _on_managed_host() -> bool:
    return any(os.environ.get(marker) for marker in _MANAGED_HOST_MARKERS)


def _startup() -> None:
    create_all()
    # A signing key that changes on restart logs everyone out on every deploy,
    # and a shared default would let anyone forge a session. Refusing to start
    # is better than either, but only where it matters: a laptop is fine.
    if not os.environ.get("SECRET_KEY", "").strip():
        if _on_managed_host():
            raise RuntimeError(
                "SECRET_KEY is not set. Generate one with:  python -c \"import secrets; "
                "print(secrets.token_urlsafe(48))\"  and set it on the service."
            )
        print("  SECRET_KEY unset — using a development key. Sessions end at restart.")


app = FastAPI(title="Resume Tailor", docs_url=None, redoc_url=None, lifespan=lifespan)
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))


# ───────────────────────────── plumbing ──────────────────────────────

DbSession = Annotated[Session, Depends(get_session)]


def current_user(request: Request, session: Session) -> User | None:
    uid = security.read_session_token(request.cookies.get(security.SESSION_COOKIE))
    if uid is None:
        return None
    user = session.get(User, uid)
    # A session outlives a deleted account otherwise, and an unverified one
    # must not be usable at all.
    return user if user is not None and user.is_verified else None


def require_user(request: Request, session: DbSession) -> User:
    user = current_user(request, session)
    if user is None:
        raise HTTPException(status_code=303, headers={"Location": "/"})
    return user


CurrentUser = Annotated[User, Depends(require_user)]


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else ""


def render(request: Request, name: str, **context: Any) -> HTMLResponse:
    return templates.TemplateResponse(request, name, context)


def read_upload(upload: UploadFile | None) -> str:
    """Text out of .txt, .pdf or .docx. Returns "" when nothing was uploaded."""
    if upload is None or not upload.filename:
        return ""
    raw = upload.file.read(MAX_UPLOAD_BYTES + 1)
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"That file is larger than {MAX_UPLOAD_BYTES // (1024 * 1024)}MB.")

    name = upload.filename.lower()
    if name.endswith(".pdf"):
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(raw))
        return "\n".join((page.extract_text() or "") for page in reader.pages)
    if name.endswith(".docx"):
        from docx import Document

        return "\n".join(p.text for p in Document(io.BytesIO(raw)).paragraphs)
    return raw.decode("utf-8", errors="replace")


# ─────────────────────────────── auth ────────────────────────────────


@app.get("/", response_class=HTMLResponse)
def home(request: Request, session: DbSession):
    if current_user(request, session) is not None:
        return RedirectResponse("/dashboard", status_code=303)
    return render(request, "auth.html", mail=transport_name())


@app.post("/auth/code")
def request_code(
    request: Request,
    session: DbSession,
    email: Annotated[str, Form()],
    purpose: Annotated[str, Form()],
):
    """Send a one-time code.

    The reply never says whether an address has an account. For login that
    would be an account-existence oracle — type addresses, learn which are
    registered — which is exactly the list a credential-stuffer wants.
    """
    address = email.strip().lower()
    if purpose not in ("signup", "login"):
        raise HTTPException(400, "Unknown purpose.")

    existing = security.find_user(session, address)
    if purpose == "signup" and existing is not None and existing.is_verified:
        return render(
            request,
            "partials/code_form.html",
            error="That email already has an account. Log in instead.",
            email=address,
            purpose=purpose,
            show_form=False,
        )

    if purpose == "signup" or existing is not None:
        try:
            code = security.issue_code(session, address, purpose)  # type: ignore[arg-type]
        except security.CodeCooldown as cooldown:
            return render(
                request,
                "partials/code_form.html",
                error=str(cooldown),
                email=address,
                purpose=purpose,
                show_form=True,
            )
        send_code(address, code, purpose)
        security.record_event(
            session,
            email=address,
            event="code_sent",
            method="otp",
            ip=client_ip(request),
            user_agent=request.headers.get("user-agent", ""),
        )

    return render(
        request,
        "partials/code_form.html",
        email=address,
        purpose=purpose,
        show_form=True,
        sent=True,
    )


@app.post("/auth/signup")
def signup(
    request: Request,
    session: DbSession,
    full_name: Annotated[str, Form()],
    email: Annotated[str, Form()],
    password: Annotated[str, Form()],
    code: Annotated[str, Form()],
):
    address = email.strip().lower()
    if len(password) < 8:
        return render(
            request,
            "partials/code_form.html",
            error="Password must be at least 8 characters.",
            email=address,
            purpose="signup",
            show_form=True,
        )

    result = security.check_code(session, address, "signup", code)
    if result != "ok":
        security.record_event(
            session, email=address, event="code_failed", method="otp", ip=client_ip(request)
        )
        return render(
            request,
            "partials/code_form.html",
            error=security.code_failure_message(result),
            email=address,
            purpose="signup",
            show_form=True,
        )

    # Written only after the code checks out, so a wrong code leaves nothing
    # behind and cannot squat an address.
    user = security.find_user(session, address)
    if user is None:
        user = User(email=address)
        session.add(user)
    user.full_name = full_name.strip()[:160]
    user.password_hash = security.hash_password(password)
    user.email_verified_at = utcnow()
    session.commit()

    security.record_event(
        session,
        email=address,
        event="signup",
        method="password",
        ip=client_ip(request),
        user_agent=request.headers.get("user-agent", ""),
    )
    return _sign_in_response(user)


@app.post("/auth/login")
def login(
    request: Request,
    session: DbSession,
    email: Annotated[str, Form()],
    password: Annotated[str, Form()] = "",
    code: Annotated[str, Form()] = "",
):
    address = email.strip().lower()
    user = security.find_user(session, address)

    if code:
        result = security.check_code(session, address, "login", code)
        # Verified accounts only: a code proves the address now, but an
        # unverified account has no established owner to prove anything about.
        if result == "ok" and user is not None and user.is_verified:
            security.record_event(
                session, email=address, event="login", method="otp", ip=client_ip(request)
            )
            return _sign_in_response(user)
        security.record_event(
            session, email=address, event="code_failed", method="otp", ip=client_ip(request)
        )
        return render(
            request,
            "partials/login_result.html",
            error="That code is not correct, or it has expired.",
        )

    if user is not None and user.is_verified and security.verify_password(password, user.password_hash):
        security.record_event(
            session, email=address, event="login", method="password", ip=client_ip(request)
        )
        return _sign_in_response(user)

    # One message for three cases — wrong password, no such account,
    # unverified. Saying which tells a stranger whether an address is here.
    return render(
        request,
        "partials/login_result.html",
        error="That email and password do not match a confirmed account.",
    )


def _sign_in_response(user: User) -> Response:
    response = Response(status_code=204)
    response.headers["HX-Redirect"] = "/dashboard"
    response.set_cookie(
        security.SESSION_COOKIE,
        security.make_session_token(user.id),
        max_age=security.SESSION_MAX_AGE,
        httponly=True,
        samesite="lax",
        # Secure in production; a plain-HTTP laptop would silently drop it.
        # Secure in production; a plain-HTTP laptop would silently drop it.
        secure=_on_managed_host(),
    )
    return response


@app.post("/auth/logout")
def logout():
    response = RedirectResponse("/", status_code=303)
    response.delete_cookie(security.SESSION_COOKIE)
    return response


# ───────────────────────────── dashboard ─────────────────────────────


@app.get("/dashboard", response_class=HTMLResponse)
def dashboard(request: Request, session: DbSession, user: CurrentUser):
    postings = session.scalars(
        select(JobPosting).where(JobPosting.user_id == user.id).order_by(JobPosting.created_at.desc()).limit(25)
    ).all()
    resumes = session.scalars(
        select(SourceResume).where(SourceResume.user_id == user.id).order_by(SourceResume.created_at.desc()).limit(25)
    ).all()

    # Lineages, not rows: a refinement writes version+1 into the same pair, so
    # listing rows would show one job several times.
    rows = session.scalars(
        select(TailoredResume)
        .where(TailoredResume.user_id == user.id)
        .order_by(TailoredResume.created_at.desc())
        .limit(300)
    ).all()
    lineages: dict[tuple[int, int], dict[str, Any]] = {}
    for row in rows:
        key = (row.posting_id, row.resume_id)
        seen = lineages.get(key)
        if seen is None:
            lineages[key] = {"row": row, "versions": 1}
        else:
            seen["versions"] += 1
            if row.version > seen["row"].version:
                seen["row"] = row

    return render(
        request,
        "dashboard.html",
        user=user,
        postings=postings,
        resumes=resumes,
        library=list(lineages.values()),
        mail=transport_name(),
        endpoints=_endpoint_summary(),
    )


def _endpoint_summary() -> str:
    try:
        return " → ".join(f"{e.name}:{e.model}" for e in resolve_chain())
    except LlmError as err:
        return f"not configured ({err})"


@app.post("/tailor", response_class=HTMLResponse)
def tailor(
    request: Request,
    session: DbSession,
    user: CurrentUser,
    job_text: Annotated[str, Form()] = "",
    job_title: Annotated[str, Form()] = "",
    resume_text: Annotated[str, Form()] = "",
    resume_file: UploadFile | None = None,
    existing_resume_id: Annotated[str, Form()] = "",
    existing_posting_id: Annotated[str, Form()] = "",
):
    """The whole pipeline, then a saved document."""
    posting_row: JobPosting | None = None
    resume_row: SourceResume | None = None

    if existing_posting_id.isdigit():
        posting_row = session.get(JobPosting, int(existing_posting_id))
        if posting_row is None or posting_row.user_id != user.id:
            raise HTTPException(404, "No such job posting.")

    if existing_resume_id.isdigit():
        resume_row = session.get(SourceResume, int(existing_resume_id))
        if resume_row is None or resume_row.user_id != user.id:
            raise HTTPException(404, "No such resume.")

    raw_resume = resume_row.raw_text if resume_row else (read_upload(resume_file) or resume_text)
    raw_job = posting_row.raw_text if posting_row else job_text

    if len(raw_resume.strip()) < 120:
        return render(
            request,
            "partials/error.html",
            error="That resume is too short to work with. If it is a scanned PDF the text layer is missing — paste the text instead.",
        )
    if len(raw_job.strip()) < 80:
        return render(request, "partials/error.html", error="That job posting looks too short to analyse.")

    try:
        outcome = pipeline.run(raw_resume, raw_job)
    except LlmError as err:
        return render(request, "partials/error.html", error=str(err))

    if posting_row is None:
        posting_row = JobPosting(
            user_id=user.id,
            title=(job_title.strip() or outcome.jd_profile.get("roleTitle") or "Untitled role")[:240],
            raw_text=raw_job,
            profile_json=dumps(outcome.jd_profile),
        )
        session.add(posting_row)

    if resume_row is None:
        label = (outcome.resume.get("contact") or {}).get("fullName") or "Resume"
        resume_row = SourceResume(
            user_id=user.id, label=label[:200], raw_text=raw_resume, parsed_json=dumps({})
        )
        session.add(resume_row)

    session.flush()

    latest = session.scalars(
        select(TailoredResume)
        .where(
            TailoredResume.user_id == user.id,
            TailoredResume.posting_id == posting_row.id,
            TailoredResume.resume_id == resume_row.id,
        )
        .order_by(TailoredResume.version.desc())
        .limit(1)
    ).first()

    document = TailoredResume(
        user_id=user.id,
        posting_id=posting_row.id,
        resume_id=resume_row.id,
        version=(latest.version + 1) if latest else 1,
        content_json=dumps(outcome.resume),
        report_json=dumps(_report(outcome)),
        note="Tailored draft",
    )
    session.add(document)
    session.commit()

    return render(request, "partials/result.html", document=document, report=document.report)


def _report(outcome: pipeline.TailorOutcome) -> dict[str, Any]:
    retention = outcome.retention
    return {
        "role": outcome.jd_profile.get("roleTitle", ""),
        "scoreBefore": outcome.analysis.get("atsScore"),
        "projected": outcome.projected_score,
        "honestGaps": [m.get("term", "") for m in outcome.analysis.get("missing") or []],
        "evidenceChecked": outcome.evidence.checked,
        "evidenceRejected": [
            {"reason": f.reason, "where": f.where, "claim": f.text, "cited": f.source_evidence}
            for f in outcome.evidence.failures
        ],
        "gapKeywordsRemoved": [
            {"kind": r.kind, "where": r.where, "text": r.text, "term": r.term}
            for r in outcome.forbidden_removed
        ],
        "gapKeywordsSurviving": outcome.forbidden_hits,
        "retention": None
        if retention is None
        else {
            "headline": retention.headline(),
            "substantialLoss": retention.substantial_loss,
            "dropped": [{"kind": d.kind, "where": d.where, "text": d.text} for d in retention.dropped],
        },
    }


@app.get("/document/{document_id}", response_class=HTMLResponse)
def view_document(request: Request, session: DbSession, user: CurrentUser, document_id: int):
    document = session.get(TailoredResume, document_id)
    if document is None or document.user_id != user.id:
        raise HTTPException(404, "No such document.")

    versions = session.scalars(
        select(TailoredResume)
        .where(
            TailoredResume.user_id == user.id,
            TailoredResume.posting_id == document.posting_id,
            TailoredResume.resume_id == document.resume_id,
        )
        .order_by(TailoredResume.version.desc())
    ).all()

    return render(
        request,
        "document.html",
        user=user,
        document=document,
        report=document.report,
        resume=document.content,
        versions=versions,
    )


@app.get("/document/{document_id}/export.{fmt}")
def export(session: DbSession, user: CurrentUser, document_id: int, fmt: str):
    if fmt not in ("docx", "pdf"):
        raise HTTPException(404, "Unknown format.")
    document = session.get(TailoredResume, document_id)
    if document is None or document.user_id != user.id:
        raise HTTPException(404, "No such document.")

    import tempfile

    name = (document.content.get("contact") or {}).get("fullName", "resume")
    safe = "".join(c for c in name if c.isalnum() or c in " -_").strip().replace(" ", "_") or "resume"

    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / f"{safe}.{fmt}"
        (write_docx if fmt == "docx" else write_pdf)(document.content, path)
        data = path.read_bytes()

    media = {
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "pdf": "application/pdf",
    }[fmt]
    return Response(
        data,
        media_type=media,
        headers={"content-disposition": f'attachment; filename="{safe}.{fmt}"'},
    )


@app.post("/account/delete")
def delete_account(session: DbSession, user: CurrentUser):
    """Everything, on request. Cascades take the resumes and documents."""
    session.delete(user)
    session.commit()
    response = RedirectResponse("/", status_code=303)
    response.delete_cookie(security.SESSION_COOKIE)
    return response


@app.get("/health")
def health():
    """Liveness plus the two things most likely to be misconfigured."""
    try:
        endpoints = [e.name for e in resolve_chain()]
        llm_ready = True
    except LlmError:
        endpoints, llm_ready = [], False
    return {
        "ok": True,
        "llm": {"ready": llm_ready, "endpoints": endpoints},
        "mail": transport_name(),
        "sheetLogging": bool((os.environ.get("SHEETS_WEBHOOK_URL") or "").strip()),
    }
