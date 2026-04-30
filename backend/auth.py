"""Authentication & authorization plumbing.

Tokens are opaque bearer strings stored in the DB. Role checks happen via
FastAPI dependency factories; org scoping happens at the query layer (every
client/team/invite lookup filters on `organization_id == current_user.organization_id`).

Password hashing uses PBKDF2-SHA256 from the stdlib to avoid pulling in a
third-party crypto dependency. 200k iterations is the OWASP 2024 baseline.
"""

from __future__ import annotations

import hashlib
import secrets
from typing import Iterable

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

import database
import models
from models import Role


# ─── Password hashing (PBKDF2-SHA256) ──────────────────────────────────────

_PBKDF2_ITERATIONS = 200_000
_PBKDF2_ALGO = "pbkdf2_sha256"


def hash_password(password: str) -> str:
    """Returns a self-describing string `pbkdf2_sha256$<salt_hex>$<hash_hex>`."""
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _PBKDF2_ITERATIONS)
    return f"{_PBKDF2_ALGO}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str | None) -> bool:
    if not stored:
        return False
    parts = stored.split("$")
    if len(parts) != 3 or parts[0] != _PBKDF2_ALGO:
        return False
    try:
        salt = bytes.fromhex(parts[1])
        expected = bytes.fromhex(parts[2])
    except ValueError:
        return False
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _PBKDF2_ITERATIONS)
    return secrets.compare_digest(digest, expected)


# ─── Bearer token issuance ──────────────────────────────────────────────────


def issue_token(db: Session, user: models.User) -> str:
    token = secrets.token_hex(32)
    session = models.AuthSession(token=token, user_id=user.id)
    db.add(session)
    db.commit()
    return token


def revoke_token(db: Session, token: str) -> None:
    session = db.query(models.AuthSession).filter(models.AuthSession.token == token).first()
    if session:
        session.revoked = True
        db.commit()


# ─── Invite tokens ──────────────────────────────────────────────────────────


def mint_invite_token() -> str:
    return secrets.token_hex(32)


def find_active_invite(db: Session, token: str) -> models.Invite | None:
    """Returns the invite if it's redeemable. Caller still has to compare
    expiry / used_at if they want a finer-grained reason — for the public
    preview endpoint we want to render a specific failure message."""
    return db.query(models.Invite).filter(models.Invite.token == token).first()


# ─── Current-user dependency ────────────────────────────────────────────────


def _extract_bearer(header_value: str | None) -> str | None:
    if not header_value:
        return None
    parts = header_value.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    return parts[1].strip() or None


def get_current_user(
    authorization: str | None = Header(default=None),
    db: Session = Depends(database.get_db),
) -> models.User:
    token = _extract_bearer(authorization)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Missing or malformed Authorization header")
    session = (
        db.query(models.AuthSession)
        .filter(models.AuthSession.token == token, models.AuthSession.revoked.is_(False))
        .first()
    )
    if session is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid or revoked token")
    user = db.query(models.User).filter(models.User.id == session.user_id).first()
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="User no longer exists")
    return user


# ─── Role / capability guards ──────────────────────────────────────────────


def require_role(*allowed: Role):
    """403s if the caller's role isn't in the allow-list."""
    allowed_set = set(allowed)

    def _guard(user: models.User = Depends(get_current_user)) -> models.User:
        if user.role not in allowed_set:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                detail=f"Role '{user.role.value}' is not permitted to perform this action",
            )
        return user

    return _guard


def require_account_owner(user: models.User = Depends(get_current_user)) -> models.User:
    """Only the AccountOwner of the user's organization may invite or manage
    the team roster. An ordinary Admin still gets full client CRUD but can't
    add new members."""
    if not user.is_account_owner:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Only the account owner can manage team members",
        )
    return user


# ─── Permission helpers ────────────────────────────────────────────────────


def can_modify_clients(role: Role) -> bool:
    return role == Role.ADMIN


def can_view_credit_card(role: Role) -> bool:
    return role in (Role.ADMIN, Role.ACCOUNTANT)


def permissions_for(user: models.User) -> dict[str, bool]:
    role = user.role
    return {
        "clients.read": True,
        "clients.create": can_modify_clients(role),
        "clients.update": can_modify_clients(role),
        "clients.delete": can_modify_clients(role),
        "clients.view_credit_card": can_view_credit_card(role),
        # Team management is gated by both role and the account-owner flag —
        # frontend uses this to hide the "Team" tile from non-owners.
        "team.manage": user.is_account_owner,
        "team.invite": user.is_account_owner,
    }


# ─── Response masking ──────────────────────────────────────────────────────


def _mask_credit_card(card: str) -> str:
    digits = "".join(ch for ch in card if ch.isdigit())
    if len(digits) < 4:
        return "**** **** **** ****"
    return f"**** **** **** {digits[-4:]}"


def serialize_client(client: models.Client, role: Role) -> dict:
    payload = {
        "id": client.id,
        "full_name": client.full_name,
        "address": client.address,
        "phone": client.phone,
        "created_at": client.created_at,
        "updated_at": client.updated_at,
    }
    if can_view_credit_card(role):
        payload["credit_card"] = client.credit_card
        payload["credit_card_masked"] = False
    else:
        payload["credit_card"] = _mask_credit_card(client.credit_card) if client.credit_card else None
        payload["credit_card_masked"] = True
    return payload


def public_user(user: models.User) -> dict:
    """Renders a User row for the wire including org context."""
    return {
        "name": user.full_name,
        "email": user.email,
        "iin": user.iin,
        "role": user.role,
        "organization_id": user.organization_id,
        "organization_name": user.organization.name if user.organization else "",
        "is_account_owner": user.is_account_owner,
        "position": user.position,
    }


__all__ = [
    "hash_password",
    "verify_password",
    "issue_token",
    "revoke_token",
    "mint_invite_token",
    "find_active_invite",
    "get_current_user",
    "require_role",
    "require_account_owner",
    "can_modify_clients",
    "can_view_credit_card",
    "permissions_for",
    "serialize_client",
    "public_user",
]
