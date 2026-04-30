import enum
from datetime import datetime, timedelta, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Integer,
    String,
)
from sqlalchemy.orm import relationship

from database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _invite_default_expiry() -> datetime:
    return _utcnow() + timedelta(days=7)


class Role(str, enum.Enum):
    """RBAC permission tier. Stable string value persisted to the DB."""

    ADMIN = "Admin"            # Level 1: full CRUD on clients
    ACCOUNTANT = "Accountant"  # Level 2: read-only, sees credit card
    MARKETING = "Marketing"    # Level 3: read-only, credit card masked


class Organization(Base):
    """A company / tenant. Every User and Client belongs to exactly one,
    and every authorization decision is scoped through it — a user with
    role=Admin in org A still cannot read org B's data."""

    __tablename__ = "organizations"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(150), unique=True, index=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=_utcnow, nullable=False)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    full_name = Column(String(100), nullable=False)
    email = Column(String(255), unique=True, index=True, nullable=False)
    iin = Column(String(12), unique=True, index=True, nullable=False)

    # Optional — collected during multi-step registration. Login is still
    # face-only; password is stored as a future fallback / API-token gate.
    password_hash = Column(String(255), nullable=True)
    phone = Column(String(40), nullable=True)
    # Free-form job title chosen on Step 2 of registration (Owner / Manager /
    # Staff). Distinct from `role`, which is the system-level permission tier.
    position = Column(String(40), nullable=True)

    # 128-d face vector. Nullable so seeded users (and invitees) can claim
    # the slot once they enrol their face.
    face_vector = Column(JSON, nullable=True)

    role = Column(SAEnum(Role, native_enum=False, length=20), nullable=False, default=Role.MARKETING)

    # Multi-tenancy. Required — every User belongs to an Organization.
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    # First user to register a Company is flagged True. Only AccountOwners
    # can invite teammates; ordinary Admins still get CRUD on clients but
    # cannot manage the organization roster.
    is_account_owner = Column(Boolean, nullable=False, default=False)

    created_at = Column(DateTime(timezone=True), default=_utcnow, nullable=False)

    organization = relationship("Organization")


class Client(Base):
    """Customer record managed via the RBAC dashboard. Scoped to an
    organization — listing/reading/writing always filters on
    `Client.organization_id == current_user.organization_id`."""

    __tablename__ = "clients"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    full_name = Column(String(120), nullable=False)
    address = Column(String(255), nullable=False, default="")
    phone = Column(String(40), nullable=False, default="")
    credit_card = Column(String(32), nullable=False, default="")
    created_at = Column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False)


class AuthSession(Base):
    """Opaque bearer token. Resolved to (user, role, organization) by
    `auth.get_current_user` on every protected request."""

    __tablename__ = "auth_sessions"

    id = Column(Integer, primary_key=True, index=True)
    token = Column(String(64), unique=True, index=True, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), default=_utcnow, nullable=False)
    revoked = Column(Boolean, nullable=False, default=False)

    user = relationship("User")


class Invite(Base):
    """Single-use token issued by an AccountOwner to onboard a teammate.

    The flow:
      1. Owner POSTs /api/invites with { email, role }.
      2. Backend mints a 32-byte hex token and emails the link
         (manual copy/paste in dev — no SMTP wired).
      3. Recipient lands on /invite/:token, fills in the same 3-step
         register form (email pre-filled, company step skipped), and on
         success the new User is created with `organization_id` and
         `role` taken from the Invite (not from form input).
    """

    __tablename__ = "invites"

    id = Column(Integer, primary_key=True, index=True)
    token = Column(String(64), unique=True, index=True, nullable=False)
    email = Column(String(255), nullable=False, index=True)
    role = Column(SAEnum(Role, native_enum=False, length=20), nullable=False)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    expires_at = Column(DateTime(timezone=True), default=_invite_default_expiry, nullable=False)
    used_at = Column(DateTime(timezone=True), nullable=True)
    revoked = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), default=_utcnow, nullable=False)

    organization = relationship("Organization")
    created_by = relationship("User", foreign_keys=[created_by_user_id])
