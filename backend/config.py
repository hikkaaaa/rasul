from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    database_url: str = "sqlite:///./face_system.db"

    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173"])

    face_tolerance: float = 0.5
    # Any existing user whose embedding is closer than this to the new signup
    # embedding is treated as a duplicate registration (same person, different
    # IIN/email). Tighter than face_tolerance so near-misses aren't blocked.
    duplicate_face_distance: float = 0.45


    max_image_bytes: int = 5 * 1024 * 1024
    min_face_blur_variance: float = 40.0

    log_level: str = "INFO"


settings = Settings()
