"""Database: engine, session and every table.

SQLite by default so a fresh checkout runs with no setup at all, Postgres when
DATABASE_URL says so. The models are written to work on both — no JSON
operators, no array columns, nothing a SQLite file cannot express — because a
library that behaves differently on the two is a bug waiting for a deploy.

Table names are lowercase and unprefixed, which keeps them clear of the
quoted, capitalised tables the earlier TypeScript app created. The two can
share a Postgres database without either noticing the other.
"""

from __future__ import annotations

import json
import os
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    create_engine,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker


def utcnow() -> datetime:
    """Timezone-aware, always. Naive datetimes compare wrongly across a deploy."""
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class JsonText(Text):
    """JSON stored as text.

    Postgres has a real JSON type and SQLite does not, and using it would mean
    the two databases storing different things. Documents here are only ever
    read and written whole, never queried into, so text costs nothing.
    """


def dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def loads(value: str | None) -> Any:
    if not value:
        return None
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return None


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(160), default="")
    password_hash: Mapped[str] = mapped_column(String(200), default="")
    # Null means the address was typed but never proven. Such an account cannot
    # sign in, or verification would be decorative.
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    resumes: Mapped[list[SourceResume]] = relationship(back_populates="user", cascade="all, delete-orphan")
    postings: Mapped[list[JobPosting]] = relationship(back_populates="user", cascade="all, delete-orphan")
    documents: Mapped[list[TailoredResume]] = relationship(back_populates="user", cascade="all, delete-orphan")

    @property
    def is_verified(self) -> bool:
        return self.email_verified_at is not None


class EmailCode(Base):
    """A one-time code. Only its hash is stored — see app.security."""

    __tablename__ = "email_codes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(320), index=True)
    code_hash: Mapped[str] = mapped_column(String(64))
    purpose: Mapped[str] = mapped_column(String(16))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AuthEvent(Base):
    """Who signed up, who signed in, how.

    Holds no password and no resume content. An audit trail is read by more
    people than the database is, and passwords are bcrypt hashes anyway —
    one-way by construction, so there is nothing to record even if it were wise.
    """

    __tablename__ = "auth_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(320), index=True)
    event: Mapped[str] = mapped_column(String(24))
    method: Mapped[str] = mapped_column(String(16), default="")
    ip: Mapped[str] = mapped_column(String(64), default="")
    user_agent: Mapped[str] = mapped_column(String(300), default="")
    exported: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SourceResume(Base):
    __tablename__ = "source_resumes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    label: Mapped[str] = mapped_column(String(200), default="Resume")
    # The candidate's own words. Evidence is traced against THIS, never the
    # parse — the parse is lossy, and measuring against a lossy copy rejects
    # claims the candidate can actually support.
    raw_text: Mapped[str] = mapped_column(Text)
    parsed_json: Mapped[str] = mapped_column(JsonText)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped[User] = relationship(back_populates="resumes")

    @property
    def parsed(self) -> dict[str, Any]:
        return loads(self.parsed_json) or {}


class JobPosting(Base):
    __tablename__ = "job_postings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(240), default="Untitled role")
    raw_text: Mapped[str] = mapped_column(Text)
    profile_json: Mapped[str] = mapped_column(JsonText)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped[User] = relationship(back_populates="postings")

    @property
    def profile(self) -> dict[str, Any]:
        return loads(self.profile_json) or {}


class TailoredResume(Base):
    """One version of a tailored document.

    Rows are immutable. A refinement, a manual edit and a rollback all write
    version+1 into the same (posting, resume) lineage rather than mutating
    anything, so nothing a user produced can be lost by a later action.
    """

    __tablename__ = "tailored_resumes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    posting_id: Mapped[int] = mapped_column(ForeignKey("job_postings.id", ondelete="CASCADE"))
    resume_id: Mapped[int] = mapped_column(ForeignKey("source_resumes.id", ondelete="CASCADE"))
    version: Mapped[int] = mapped_column(Integer, default=1)
    content_json: Mapped[str] = mapped_column(JsonText)
    report_json: Mapped[str] = mapped_column(JsonText, default="{}")
    note: Mapped[str] = mapped_column(String(240), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped[User] = relationship(back_populates="documents")
    posting: Mapped[JobPosting] = relationship()
    resume: Mapped[SourceResume] = relationship()

    @property
    def content(self) -> dict[str, Any]:
        return loads(self.content_json) or {}

    @property
    def report(self) -> dict[str, Any]:
        return loads(self.report_json) or {}


Index("ix_tailored_lineage", TailoredResume.user_id, TailoredResume.posting_id, TailoredResume.resume_id)


def database_url() -> str:
    url = (os.environ.get("DATABASE_URL") or "").strip()
    if not url:
        return "sqlite:///./resume-tailor.db"
    # Managed hosts hand out "postgres://", which SQLAlchemy dropped support for
    # in 1.4. Rewriting it here saves everyone a confusing startup crash.
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql+psycopg://", 1)
    elif url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


def _make_engine():
    url = database_url()
    if url.startswith("sqlite"):
        # check_same_thread off because the request handlers run on a thread
        # pool; each still gets its own session.
        return create_engine(url, connect_args={"check_same_thread": False}, future=True)
    # pool_pre_ping because free Postgres tiers drop idle connections, and the
    # first request after a quiet spell would otherwise fail rather than
    # reconnect.
    return create_engine(url, pool_pre_ping=True, pool_recycle=300, future=True)


engine = _make_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, class_=Session)


def create_all() -> None:
    Base.metadata.create_all(engine)


@contextmanager
def session_scope() -> Iterator[Session]:
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_session() -> Iterator[Session]:
    """FastAPI dependency."""
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
