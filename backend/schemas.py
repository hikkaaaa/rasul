from typing import Literal

from pydantic import BaseModel, EmailStr, Field

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


class SignupResponse(BaseModel):
    status: str
    message: str


class LoginResponse(BaseModel):
    status: str
    user: UserPublic


class ValidateChallengeRequest(BaseModel):
    challenge: ChallengeType
    image: str = Field(min_length=100, max_length=10_000_000)
    neutral_embedding: list[float] | None = None


class ValidateChallengeResponse(BaseModel):
    status: str
    message: str
    embedding: list[float] | None = None
