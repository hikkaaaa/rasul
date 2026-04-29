import enum
from datetime import datetime, timezone

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


class Role(str, enum.Enum):
    """RBAC roles. The string value is what gets persisted in the DB and
    sent over the wire — keep it stable."""

    ADMIN = "Admin"            # Level 1: full CRUD on clients
    ACCOUNTANT = "Accountant"  # Level 2: read-only, sees credit card
    MARKETING = "Marketing"    # Level 3: read-only, credit card masked


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    full_name = Column(String(100), nullable=False)
    email = Column(String(255), unique=True, index=True, nullable=False)
    iin = Column(String(12), unique=True, index=True, nullable=False)
    # 128-d float vector produced by face_recognition (dlib).
    # Nullable so we can pre-seed role assignments before a face is enrolled —
    # the seeded user "claims" the slot during the first signup.
    face_vector = Column(JSON, nullable=True)
    role = Column(SAEnum(Role, native_enum=False, length=20), nullable=False, default=Role.MARKETING)
    created_at = Column(DateTime(timezone=True), default=_utcnow, nullable=False)


class Client(Base):
    """Customer record managed via the RBAC dashboard."""

    __tablename__ = "clients"

    id = Column(Integer, primary_key=True, index=True)
    full_name = Column(String(120), nullable=False)
    address = Column(String(255), nullable=False, default="")
    phone = Column(String(40), nullable=False, default="")
    # Sensitive — only Admin (CRUD) and Accountant (read) may see this.
    # Marketing role gets a masked value in the response layer.
    credit_card = Column(String(32), nullable=False, default="")
    created_at = Column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False)


class AuthSession(Base):
    """Opaque bearer tokens issued at login. The token is sent in the
    Authorization header on every protected request and resolved to the
    owning user (and their role) by the auth dependency."""

    __tablename__ = "auth_sessions"

    id = Column(Integer, primary_key=True, index=True)
    token = Column(String(64), unique=True, index=True, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), default=_utcnow, nullable=False)
    revoked = Column(Boolean, nullable=False, default=False)

    user = relationship("User")
