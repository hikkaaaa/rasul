from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field

from models import Role

ChallengeType = Literal[
    "neutral", "turn_left", "turn_right", "look_up", "look_down", "smile"
]

PositionType = Literal["Owner", "Manager", "Staff"]


class FrameCapture(BaseModel):
    challenge: ChallengeType
    image: str = Field(min_length=100, max_length=10_000_000)


# ─── Multi-step registration ───────────────────────────────────────────────


class RegisterCheckRequest(BaseModel):
    """Step 1 of the onboarding wizard — submitted before the user proceeds
    to Step 2. The frontend uses the response to decide whether to stay on
    Step 1 (showing an error) or advance."""

    name: str = Field(min_length=1, max_length=100)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    company_name: str = Field(min_length=1, max_length=150)


class RegisterCheckResponse(BaseModel):
    # "ok"            → email + company are both new, normal signup
    # "claim"         → email matches a pre-seeded user with no face yet;
    #                   company input will be ignored, the user inherits
    #                   the seeded organization + role
    # "conflict_email"   → email is already taken by an active user
    # "conflict_company" → company exists but the user isn't a claimable
    #                   member of it
    status: Literal["ok", "claim", "conflict_email", "conflict_company"]
    message: str
    # When status == "claim", the frontend can prefill these on Step 2:
    organization_name: str | None = None
    role: Role | None = None


class RegisterRequest(BaseModel):
    """Final submission combining all 3 steps."""

    # Step 1
    name: str = Field(min_length=1, max_length=100)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    company_name: str = Field(min_length=1, max_length=150)
    # Step 2
    phone: str = Field(default="", max_length=40)
    iin: str = Field(pattern=r"^\d{12}$")
    position: PositionType
    # Step 3
    frames: list[FrameCapture] = Field(min_length=4, max_length=4)
    # Set when the registration is happening via an invite link — the
    # backend ignores `company_name` and uses the invite's organization.
    invite_token: str | None = None


class RegisterResponse(BaseModel):
    status: str
    message: str
    role: Role
    is_account_owner: bool
    token: str
    user: "UserPublic"


# ─── Login / session ───────────────────────────────────────────────────────


class LoginRequest(BaseModel):
    # 1:1 face verification: caller first identifies themselves by email or
    # IIN (12 digits). The backend looks up that single user and compares
    # the live embedding only against their stored vector — no global
    # nearest-neighbor search, so identical-twin / lookalike collisions
    # cannot redirect a login to the wrong account.
    identifier: str = Field(min_length=1, max_length=255)
    image: str = Field(min_length=100, max_length=10_000_000)


class UserPublic(BaseModel):
    name: str
    email: EmailStr
    iin: str
    role: Role
    organization_id: int
    organization_name: str
    is_account_owner: bool
    position: str | None = None


class LoginResponse(BaseModel):
    status: str
    user: UserPublic
    token: str


class ValidateChallengeRequest(BaseModel):
    challenge: ChallengeType
    image: str = Field(min_length=100, max_length=10_000_000)
    neutral_embedding: list[float] | None = None


class ValidateChallengeResponse(BaseModel):
    status: str
    message: str
    embedding: list[float] | None = None


# ─── Clients ────────────────────────────────────────────────────────────────


class ClientCreate(BaseModel):
    full_name: str = Field(min_length=1, max_length=120)
    address: str = Field(default="", max_length=255)
    phone: str = Field(default="", max_length=40)
    credit_card: str = Field(default="", max_length=32)


class ClientUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=120)
    address: str | None = Field(default=None, max_length=255)
    phone: str | None = Field(default=None, max_length=40)
    credit_card: str | None = Field(default=None, max_length=32)


class ClientRead(BaseModel):
    id: int
    full_name: str
    address: str
    phone: str
    credit_card: str | None = None
    credit_card_masked: bool = False
    created_at: datetime
    updated_at: datetime


# ─── Me / permissions ─────────────────────────────────────────────────────


class MeResponse(BaseModel):
    user: UserPublic
    permissions: dict[str, bool]


# ─── Team / invites ────────────────────────────────────────────────────────


class TeamMember(BaseModel):
    id: int
    name: str
    email: EmailStr
    role: Role
    position: str | None
    is_account_owner: bool
    has_face: bool
    created_at: datetime


class InviteCreate(BaseModel):
    email: EmailStr
    role: Role


class InviteRead(BaseModel):
    id: int
    email: EmailStr
    role: Role
    expires_at: datetime
    used_at: datetime | None
    revoked: bool
    redemption_url: str
    created_at: datetime


class InvitePreview(BaseModel):
    """Public — shown to an invitee before they fill out the form."""

    email: EmailStr
    role: Role
    organization_name: str
    expires_at: datetime
    valid: bool
    reason: str | None = None
