"""Authentication & authorization plumbing.

The flow is intentionally simple — opaque bearer tokens stored in the DB.
We don't need JWTs here because the backend is also the only token verifier;
single-table lookup is fine and gives us instant revocation for free.

Role enforcement is implemented as a pair of FastAPI dependency factories:

    @router.get("/clients", dependencies=[Depends(require_role(Role.ADMIN, Role.ACCOUNTANT, Role.MARKETING))])

is read by every reader, while

    @router.delete("/clients/{id}", dependencies=[Depends(require_role(Role.ADMIN))])

restricts deletion to admins only. The dependency raises 403 *before* the
handler runs, so a misbehaving client cannot bypass UI hiding.
"""

from __future__ import annotations

import secrets
from typing import Iterable

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

import database
import models
from models import Role


# ─── Token issuance ─────────────────────────────────────────────────────────

def issue_token(db: Session, user: models.User) -> str:
    """Mint a fresh opaque bearer token for `user`. 32 bytes of urandom →
    64 hex chars; collision-free for practical purposes."""
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
    """Resolve the bearer token to its owning user. Raises 401 if missing or
    invalid. This is the *authentication* gate — it doesn't yet enforce roles."""
    token = _extract_bearer(authorization)
    if not token:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            detail="Missing or malformed Authorization header",
        )
    session = (
        db.query(models.AuthSession)
        .filter(models.AuthSession.token == token, models.AuthSession.revoked.is_(False))
        .first()
    )
    if session is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid or revoked token")
    user = db.query(models.User).filter(models.User.id == session.user_id).first()
    if user is None:
        # Token outlived its owner — treat as revoked.
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="User no longer exists")
    return user


# ─── Role-based authorization guard ─────────────────────────────────────────

def require_role(*allowed: Role):
    """Dependency factory. Use as:

        @router.get(..., dependencies=[Depends(require_role(Role.ADMIN))])

    The handler still gets the user via Depends(get_current_user) if it needs
    it; this guard is purely for the 403 short-circuit.
    """
    allowed_set = set(allowed)

    def _guard(user: models.User = Depends(get_current_user)) -> models.User:
        if user.role not in allowed_set:
            # IMPORTANT: This is the source-of-truth authorization check.
            # Even if the frontend hides the button, an attacker can call the
            # endpoint directly — this guard rejects them.
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                detail=f"Role '{user.role.value}' is not permitted to perform this action",
            )
        return user

    return _guard


# ─── Permission helpers (used for the /api/me response and serialization) ───

def can_modify_clients(role: Role) -> bool:
    """Admin-only: create, update, delete client records."""
    return role == Role.ADMIN


def can_view_credit_card(role: Role) -> bool:
    """Admin and Accountant see card numbers in cleartext. Marketing must not."""
    return role in (Role.ADMIN, Role.ACCOUNTANT)


def permissions_for(role: Role) -> dict[str, bool]:
    """Capabilities map exposed to the frontend via /api/me. The backend is
    still the source of truth — these flags only drive UI hiding."""
    return {
        "clients.read": True,  # all three roles can read
        "clients.create": can_modify_clients(role),
        "clients.update": can_modify_clients(role),
        "clients.delete": can_modify_clients(role),
        "clients.view_credit_card": can_view_credit_card(role),
    }


# ─── Response masking ───────────────────────────────────────────────────────

def _mask_credit_card(card: str) -> str:
    """Show only the last 4 digits — `**** **** **** 1234`."""
    digits = "".join(ch for ch in card if ch.isdigit())
    if len(digits) < 4:
        return "**** **** **** ****"
    return f"**** **** **** {digits[-4:]}"


def serialize_client(client: models.Client, role: Role) -> dict:
    """Render a Client row for the wire, masking credit card data when the
    caller's role lacks permission. Centralized here so every code path that
    returns clients goes through the same filter — defense in depth."""
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
        # Marketing role: send a masked preview so the UI can still indicate
        # that a card exists, without leaking the full number.
        payload["credit_card"] = _mask_credit_card(client.credit_card) if client.credit_card else None
        payload["credit_card_masked"] = True
    return payload


def public_user(user: models.User) -> dict:
    return {
        "name": user.full_name,
        "email": user.email,
        "iin": user.iin,
        "role": user.role,
    }


__all__ = [
    "issue_token",
    "revoke_token",
    "get_current_user",
    "require_role",
    "can_modify_clients",
    "can_view_credit_card",
    "permissions_for",
    "serialize_client",
    "public_user",
]
