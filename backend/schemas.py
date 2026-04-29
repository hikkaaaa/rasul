from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field

from models import Role

ChallengeType = Literal[
    "neutral", "turn_left", "turn_right", "look_up", "look_down", "smile"
]


class FrameCapture(BaseModel):
    challenge: ChallengeType
    image: str = Field(min_length=100, max_length=10_000_000)


class SignupRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    email: EmailStr
    iin: str = Field(pattern=r"^\d{12}$", description="12-digit Kazakhstan IIN")
    frames: list[FrameCapture] = Field(min_length=4, max_length=4)


class LoginRequest(BaseModel):
    image: str = Field(min_length=100, max_length=10_000_000)


class UserPublic(BaseModel):
    name: str
    email: EmailStr
    iin: str
    role: Role


class SignupResponse(BaseModel):
    status: str
    message: str
    role: Role | None = None


class LoginResponse(BaseModel):
    status: str
    user: UserPublic
    # Opaque bearer token; client stores it and sends as Authorization header.
    token: str


class ValidateChallengeRequest(BaseModel):
    challenge: ChallengeType
    image: str = Field(min_length=100, max_length=10_000_000)
    neutral_embedding: list[float] | None = None


class ValidateChallengeResponse(BaseModel):
    status: str
    message: str
    embedding: list[float] | None = None


# ─── Client (RBAC-controlled resource) ──────────────────────────────────────

class ClientCreate(BaseModel):
    full_name: str = Field(min_length=1, max_length=120)
    address: str = Field(default="", max_length=255)
    phone: str = Field(default="", max_length=40)
    credit_card: str = Field(default="", max_length=32)


class ClientUpdate(BaseModel):
    """All fields optional — patch semantics."""

    full_name: str | None = Field(default=None, min_length=1, max_length=120)
    address: str | None = Field(default=None, max_length=255)
    phone: str | None = Field(default=None, max_length=40)
    credit_card: str | None = Field(default=None, max_length=32)


class ClientRead(BaseModel):
    """Outbound shape. `credit_card` may be masked or omitted depending on the
    caller's role — see auth.serialize_client."""

    id: int
    full_name: str
    address: str
    phone: str
    # None when the caller's role doesn't permit viewing credit card data.
    credit_card: str | None = None
    credit_card_masked: bool = False
    created_at: datetime
    updated_at: datetime


class MeResponse(BaseModel):
    """Returned by /api/me — frontend uses this to learn the caller's role
    so it can hide buttons the user cannot use."""

    user: UserPublic
    permissions: dict[str, bool]
