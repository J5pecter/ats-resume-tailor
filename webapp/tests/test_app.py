"""Auth, ownership and the guards that keep one user out of another's data.

No model calls: everything here is offline, so it runs in CI without a key.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest

# Set before importing the app: the engine is built at import time from this.
_TMP = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{Path(_TMP) / 'test.db'}"
os.environ["SECRET_KEY"] = "test-only-key"

from fastapi.testclient import TestClient  # noqa: E402

from app import security  # noqa: E402
from app.db import SessionLocal, TailoredResume, User, create_all, dumps  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(scope="module", autouse=True)
def _schema():
    create_all()


@pytest.fixture
def client():
    return TestClient(app)


def signup(client: TestClient, email: str, password: str = "correct-horse-battery") -> str:
    with SessionLocal() as session:
        code = security.issue_code(session, email, "signup")
    response = client.post(
        "/auth/signup",
        data={"full_name": "Test Person", "email": email, "password": password, "code": code},
    )
    assert response.status_code == 204, response.text
    return response.cookies.get(security.SESSION_COOKIE) or client.cookies.get(security.SESSION_COOKIE)


class TestPasswords:
    def test_a_password_never_survives_as_plaintext(self):
        stored = security.hash_password("correct-horse-battery")
        assert stored != "correct-horse-battery"
        assert stored.startswith("$2")
        assert security.verify_password("correct-horse-battery", stored)
        assert not security.verify_password("wrong", stored)

    def test_a_malformed_hash_does_not_crash_a_login(self):
        # A bad row in the database is not a reason to 500 the sign-in page.
        assert not security.verify_password("anything", "not-a-bcrypt-hash")

    def test_an_empty_hash_never_matches(self):
        # Google accounts carry an empty hash; that must not become a way in.
        assert not security.verify_password("", "")


class TestCodes:
    def test_only_a_hash_is_stored(self):
        with SessionLocal() as session:
            code = security.issue_code(session, "hash@example.com", "signup")
            from sqlalchemy import select

            from app.db import EmailCode

            row = session.scalars(
                select(EmailCode).where(EmailCode.email == "hash@example.com")
            ).first()
            assert row is not None
            assert code not in row.code_hash
            assert len(row.code_hash) == 64

    def test_a_code_works_once(self):
        with SessionLocal() as session:
            code = security.issue_code(session, "once@example.com", "signup")
            assert security.check_code(session, "once@example.com", "signup", code) == "ok"
            assert security.check_code(session, "once@example.com", "signup", code) == "no_code"

    def test_a_wrong_code_counts_against_the_attempt_limit(self):
        with SessionLocal() as session:
            security.issue_code(session, "limit@example.com", "signup")
            for _ in range(security.MAX_CODE_ATTEMPTS):
                assert security.check_code(session, "limit@example.com", "signup", "000000") == "incorrect"
            # Otherwise the limit is bypassed by simply guessing again.
            assert (
                security.check_code(session, "limit@example.com", "signup", "000000")
                == "too_many_attempts"
            )

    def test_issuing_again_kills_the_previous_code(self):
        # Two live codes for one address means two chances to guess, and a user
        # who asked three times should not find only the first one works.
        from datetime import timedelta

        from sqlalchemy import select, update

        from app.db import EmailCode

        with SessionLocal() as session:
            first = security.issue_code(session, "super@example.com", "signup")
            # Age the row past the cooldown so a reissue is allowed at all.
            session.execute(
                update(EmailCode)
                .where(EmailCode.email == "super@example.com")
                .values(created_at=security.utcnow() - timedelta(minutes=5))
            )
            session.commit()

            second = security.issue_code(session, "super@example.com", "signup")
            assert first != second
            assert security.check_code(session, "super@example.com", "signup", first) == "incorrect"
            assert security.check_code(session, "super@example.com", "signup", second) == "ok"

    def test_a_second_request_inside_the_cooldown_is_refused(self):
        with SessionLocal() as session:
            security.issue_code(session, "cool@example.com", "login")
            with pytest.raises(security.CodeCooldown):
                security.issue_code(session, "cool@example.com", "login")


class TestSessions:
    def test_a_tampered_cookie_is_rejected(self):
        token = security.make_session_token(1)
        assert security.read_session_token(token) == 1
        assert security.read_session_token(token[:-4] + "aaaa") is None
        assert security.read_session_token("nonsense") is None
        assert security.read_session_token(None) is None


class TestAuthFlow:
    def test_signup_requires_a_correct_code(self, client):
        response = client.post(
            "/auth/signup",
            data={
                "full_name": "X",
                "email": "wrongcode@example.com",
                "password": "correct-horse-battery",
                "code": "000000",
            },
        )
        assert response.status_code == 200
        # No code was ever issued for this address, so the reason is "none was
        # requested" rather than "incorrect". Either way it is refused.
        assert "alert error" in response.text
        with SessionLocal() as session:
            # Nothing is written until the code checks out, so a wrong attempt
            # cannot squat an address.
            assert security.find_user(session, "wrongcode@example.com") is None

    def test_a_wrong_code_with_one_outstanding_says_so(self, client):
        with SessionLocal() as session:
            security.issue_code(session, "badguess@example.com", "signup")
        response = client.post(
            "/auth/signup",
            data={
                "full_name": "X",
                "email": "badguess@example.com",
                "password": "correct-horse-battery",
                "code": "000000",
            },
        )
        assert "That code is not correct." in response.text

    def test_signup_then_password_login(self, client):
        signup(client, "flow@example.com")
        client.cookies.clear()
        response = client.post(
            "/auth/login", data={"email": "flow@example.com", "password": "correct-horse-battery"}
        )
        assert response.status_code == 204
        assert response.headers.get("HX-Redirect") == "/dashboard"

    def test_a_wrong_password_says_nothing_useful(self, client):
        signup(client, "quiet@example.com")
        client.cookies.clear()
        response = client.post("/auth/login", data={"email": "quiet@example.com", "password": "nope"})
        # One message for three cases, so a stranger cannot learn which
        # addresses are registered here.
        assert "do not match a confirmed account" in response.text
        unknown = client.post("/auth/login", data={"email": "ghost@example.com", "password": "nope"})
        assert "do not match a confirmed account" in unknown.text

    def test_an_unverified_account_cannot_sign_in(self, client):
        with SessionLocal() as session:
            session.add(
                User(
                    email="unverified@example.com",
                    password_hash=security.hash_password("correct-horse-battery"),
                )
            )
            session.commit()
        response = client.post(
            "/auth/login",
            data={"email": "unverified@example.com", "password": "correct-horse-battery"},
        )
        # Otherwise verification is decorative: register someone else's address
        # and walk in with the password you chose.
        assert response.status_code == 200
        assert "do not match" in response.text

    def test_login_code_for_an_unknown_address_looks_identical(self, client):
        signup(client, "known@example.com")
        client.cookies.clear()
        known = client.post("/auth/code", data={"email": "known@example.com", "purpose": "login"})
        unknown = client.post("/auth/code", data={"email": "nobody@example.com", "purpose": "login"})
        # An account-existence oracle is exactly the list a credential-stuffer
        # wants, so both replies say the same thing.
        assert known.status_code == unknown.status_code == 200
        assert ("a code is on its way" in known.text) == ("a code is on its way" in unknown.text)

    def test_signing_up_twice_is_refused(self, client):
        signup(client, "twice@example.com")
        response = client.post(
            "/auth/code", data={"email": "twice@example.com", "purpose": "signup"}
        )
        assert "already has an account" in response.text


class TestAccessControl:
    def test_the_dashboard_needs_a_session(self, client):
        client.cookies.clear()
        response = client.get("/dashboard", follow_redirects=False)
        assert response.status_code == 303

    def test_one_user_cannot_open_another_users_document(self, client):
        signup(client, "owner@example.com")
        with SessionLocal() as session:
            owner = security.find_user(session, "owner@example.com")
            assert owner is not None
            from app.db import JobPosting, SourceResume

            posting = JobPosting(user_id=owner.id, title="Theirs", raw_text="x", profile_json="{}")
            resume = SourceResume(user_id=owner.id, label="Theirs", raw_text="y", parsed_json="{}")
            session.add_all([posting, resume])
            session.flush()
            document = TailoredResume(
                user_id=owner.id,
                posting_id=posting.id,
                resume_id=resume.id,
                content_json=dumps({"contact": {"fullName": "Owner"}}),
            )
            session.add(document)
            session.commit()
            document_id = document.id

        client.cookies.clear()
        signup(client, "stranger@example.com")
        # Every read checks the row's owner, not just that somebody is signed in.
        assert client.get(f"/document/{document_id}").status_code == 404
        assert client.get(f"/document/{document_id}/export.pdf").status_code == 404

    def test_deleting_an_account_takes_its_documents(self, client):
        signup(client, "gone@example.com")
        with SessionLocal() as session:
            user = security.find_user(session, "gone@example.com")
            assert user is not None
            user_id = user.id

        assert client.post("/account/delete", follow_redirects=False).status_code == 303
        with SessionLocal() as session:
            assert session.get(User, user_id) is None
            remaining = session.query(TailoredResume).filter_by(user_id=user_id).count()
            assert remaining == 0


class TestHealth:
    def test_health_reports_what_is_configured(self, client):
        body = client.get("/health").json()
        assert body["ok"] is True
        assert body["mail"] in ("smtp", "console")
        assert "llm" in body
