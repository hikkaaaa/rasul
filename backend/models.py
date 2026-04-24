from datetime import datetime, timezone

from sqlalchemy import JSON, Column, DateTime, Integer, String

from database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    full_name = Column(String(100), nullable=False)
    email = Column(String(255), unique=True, index=True, nullable=False)
    iin = Column(String(12), unique=True, index=True, nullable=False)
    # 128-d float vector produced by face_recognition (dlib).
    face_vector = Column(JSON, nullable=False)
    created_at = Column(DateTime(timezone=True), default=_utcnow, nullable=False)
