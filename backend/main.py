import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware

from sqlalchemy.orm import Session

import auth
import database
import face_logic
import models
import schemas
from config import settings
from models import Role

logging.basicConfig(
    level=settings.log_level,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("face-api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    models.Base.metadata.create_all(bind=database.engine)
    yield


app = FastAPI(title="Face Recognition Access Control", lifespan=lifespan)


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)


# Frontend origin used when minting invite redemption URLs in the response.
INVITE_LINK_BASE = settings.cors_origins[0] if settings.cors_origins else "http://localhost:5173"


@app.get("/")
def read_root():
    return {"message": "Face Recognition API is online"}


# ─── Helpers ────────────────────────────────────────────────────────────────


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _validate_frame_set(frames: list[schemas.FrameCapture]) -> dict[str, face_logic.FrameAnalysis]:
    """Decodes + verifies the 4 challenge frames and returns the analyses
    keyed by challenge name. Shared between the new register flow and the
    invite-redemption flow."""
    by_type: dict[str, schemas.FrameCapture] = {}
    for frame in frames:
        if frame.challenge in by_type:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Duplicate challenge frame: {frame.challenge}")
        by_type[frame.challenge] = frame

    if "neutral" not in by_type:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Missing neutral-pose frame")
    if not ({"turn_left", "turn_right"} & set(by_type)):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Missing horizontal head-turn challenge")
    if not ({"look_up", "look_down"} & set(by_type)):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Missing vertical head-turn challenge")
    if "smile" not in by_type:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Missing smile challenge")

    analyses: dict[str, face_logic.FrameAnalysis] = {}
    for challenge, frame in by_type.items():
        try:
            analysis = face_logic.analyze_frame(frame.image)
        except face_logic.ImageValidationError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
        except face_logic.LivenessError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
        analyses[challenge] = analysis

    for challenge, analysis in analyses.items():
        try:
            face_logic.verify_challenge(analysis, challenge)  # type: ignore[arg-type]
        except face_logic.LivenessError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))

    neutral = analyses["neutral"]
    for challenge, analysis in analyses.items():
        if challenge == "neutral":
            continue
        try:
            face_logic.ensure_same_person(neutral, analysis)
        except face_logic.LivenessError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))

    return analyses


def _find_claimable_user(db: Session, email: str, iin: str) -> models.User | None:
    """A pre-seeded test user can be 'claimed' on first signup: same email
    + IIN, no face yet. Returns the row to bind to, or None."""
    existing_email = db.query(models.User).filter(models.User.email == email).first()
    if not existing_email or existing_email.face_vector is not None:
        return None
    existing_iin = db.query(models.User).filter(models.User.iin == iin).first()
    if existing_iin and existing_iin.id == existing_email.id:
        return existing_email
    return None


def _resolve_invite(db: Session, token: str) -> models.Invite:
    invite = auth.find_active_invite(db, token)
    if invite is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Invite token not found")
    if invite.revoked:
        raise HTTPException(status.HTTP_410_GONE, detail="Invite has been revoked")
    if invite.used_at is not None:
        raise HTTPException(status.HTTP_410_GONE, detail="Invite has already been used")
    expiry = invite.expires_at
    # SQLite returns naive datetimes; normalize for comparison.
    if expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)
    if expiry < _utcnow():
        raise HTTPException(status.HTTP_410_GONE, detail="Invite has expired")
    return invite


# ─── Multi-step registration ───────────────────────────────────────────────


@app.post("/api/register/check", response_model=schemas.RegisterCheckResponse)
def register_check(payload: schemas.RegisterCheckRequest, db: Session = Depends(database.get_db)):
    """Step 1 validation. The frontend gates the transition to Step 2 on a
    `status == "ok"` (or "claim") response."""
    email = str(payload.email)
    company = payload.company_name.strip()

    # Pre-seeded user claim path: email matches a User with no face_vector.
    existing_email = db.query(models.User).filter(models.User.email == email).first()
    if existing_email and existing_email.face_vector is None:
        return schemas.RegisterCheckResponse(
            status="claim",
            message=f"Welcome back — your '{existing_email.full_name}' account is ready to enrol.",
            organization_name=existing_email.organization.name if existing_email.organization else None,
            role=existing_email.role,
        )

    if existing_email:
        return schemas.RegisterCheckResponse(status="conflict_email", message="That email is already registered")

    existing_org = db.query(models.Organization).filter(models.Organization.name == company).first()
    if existing_org:
        # Company exists but caller is not a known member of it. The spec
        # disallows self-joining an existing company — enrolment must go
        # through an invite link.
        return schemas.RegisterCheckResponse(
            status="conflict_company",
            message="That company already exists. Ask its account owner to send you an invite.",
        )

    return schemas.RegisterCheckResponse(status="ok", message="Looks good — continue to the next step.")


@app.post(
    "/api/register",
    response_model=schemas.RegisterResponse,
    status_code=status.HTTP_201_CREATED,
)
def register(payload: schemas.RegisterRequest, db: Session = Depends(database.get_db)):
    email = str(payload.email)
    company = payload.company_name.strip()

    invite: models.Invite | None = None
    if payload.invite_token:
        invite = _resolve_invite(db, payload.invite_token)
        if invite.email.lower() != email.lower():
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Invite is for a different email address")

    # Path A — claim a pre-seeded user (email matches, no face yet).
    claim_target = _find_claimable_user(db, email, payload.iin) if invite is None else None

    # Path B — invite redemption (no claim, no new company).
    if invite is not None:
        # Email collision with an *active* user is still a conflict, even
        # under an invite — the slot is taken.
        existing = db.query(models.User).filter(models.User.email == email).first()
        if existing is not None:
            raise HTTPException(status.HTTP_409_CONFLICT, detail="An account with that email already exists")
        if db.query(models.User).filter(models.User.iin == payload.iin).first():
            raise HTTPException(status.HTTP_409_CONFLICT, detail="IIN already registered")
        organization = invite.organization
        role = invite.role
        is_owner = False

    # Path C — pre-seeded claim.
    elif claim_target is not None:
        organization = claim_target.organization
        role = claim_target.role
        is_owner = claim_target.is_account_owner

    # Path D — brand-new company creation.
    else:
        if db.query(models.User).filter(models.User.email == email).first():
            raise HTTPException(status.HTTP_409_CONFLICT, detail="Email already registered")
        if db.query(models.User).filter(models.User.iin == payload.iin).first():
            raise HTTPException(status.HTTP_409_CONFLICT, detail="IIN already registered")
        if db.query(models.Organization).filter(models.Organization.name == company).first():
            raise HTTPException(status.HTTP_409_CONFLICT, detail="Company name already exists")
        organization = models.Organization(name=company)
        db.add(organization)
        db.flush()  # need org.id below
        role = Role.ADMIN
        is_owner = True  # first user of a new company → AccountOwner

    # Verify the 4-frame liveness sequence.
    analyses = _validate_frame_set(payload.frames)
    new_vector = analyses["neutral"].embedding

    # Note: we deliberately do NOT run a global "is this face already
    # enrolled?" check. The system has switched to 1:1 verification, so
    # collisions (identical twins, lookalikes) are tolerated at signup.
    # Login disambiguates by requiring the caller to also enter their
    # email/IIN, then comparing only against that user's stored vector.

    pwd_hash = auth.hash_password(payload.password)

    if claim_target is not None:
        claim_target.full_name = payload.name
        claim_target.face_vector = new_vector
        claim_target.password_hash = pwd_hash
        claim_target.phone = payload.phone or None
        claim_target.position = payload.position
        user = claim_target
    else:
        user = models.User(
            full_name=payload.name,
            email=email,
            iin=payload.iin,
            password_hash=pwd_hash,
            phone=payload.phone or None,
            position=payload.position,
            face_vector=new_vector,
            role=role,
            organization_id=organization.id,
            is_account_owner=is_owner,
        )
        db.add(user)

    if invite is not None:
        invite.used_at = _utcnow()

    db.commit()
    db.refresh(user)

    token = auth.issue_token(db, user)

    logger.info(
        "register.success user_id=%d org_id=%d role=%s owner=%s path=%s",
        user.id, user.organization_id, user.role.value, user.is_account_owner,
        "invite" if invite else ("claim" if claim_target else "new_company"),
    )

    return schemas.RegisterResponse(
        status="success",
        message=f"Welcome, {user.full_name}",
        role=user.role,
        is_account_owner=user.is_account_owner,
        token=token,
        user=schemas.UserPublic(**auth.public_user(user)),
    )


# ─── Login / session ───────────────────────────────────────────────────────


@app.post("/api/login", response_model=schemas.LoginResponse)
def login(request: Request, payload: schemas.LoginRequest, db: Session = Depends(database.get_db)):
    """1:1 face verification.

    Flow:
      1. Caller submits an `identifier` (email or 12-digit IIN) + a live
         face image.
      2. Server fetches THAT user's stored face vector.
      3. Live embedding is compared to that one vector only — no global
         search, so identical-twin / lookalike collisions cannot send the
         caller into the wrong profile.

    The error responses are deliberately uniform ("Face does not match
    this account") rather than distinguishing "wrong identifier" from
    "wrong face" — that would let an attacker enumerate registered users
    via timing or message differences.
    """
    client_addr = request.client.host if request.client else "unknown"

    identifier = payload.identifier.strip()
    if not identifier:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Enter your email or IIN")

    # Resolve the user. Email is case-insensitive; IIN is the 12-digit form.
    user: models.User | None
    if identifier.isdigit() and len(identifier) == 12:
        user = db.query(models.User).filter(models.User.iin == identifier).first()
    else:
        user = db.query(models.User).filter(models.User.email == identifier.lower()).first()
        if user is None:
            # Fallback: the user might have signed up with a mixed-case
            # email; try the verbatim form before giving up.
            user = db.query(models.User).filter(models.User.email == identifier).first()

    try:
        candidate = face_logic.get_embedding(payload.image)
    except face_logic.ImageValidationError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))

    if candidate is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="No single clear face detected in the image")

    # Run the embedding step before the existence check so the response
    # timing doesn't leak whether the identifier hit a real account.
    if user is None or user.face_vector is None:
        logger.warning("login.no_user client=%s identifier=%s", client_addr, identifier)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Face does not match this account")

    distance = face_logic.face_distance(user.face_vector, candidate)
    if distance > settings.face_tolerance:
        logger.warning("login.denied user_id=%d client=%s distance=%.3f", user.id, client_addr, distance)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Face does not match this account")

    token = auth.issue_token(db, user)
    logger.info("login.success user_id=%d role=%s org_id=%d distance=%.3f",
                user.id, user.role.value, user.organization_id, distance)
    return schemas.LoginResponse(
        status="authorized",
        user=schemas.UserPublic(**auth.public_user(user)),
        token=token,
    )


@app.post("/api/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(db: Session = Depends(database.get_db), user: models.User = Depends(auth.get_current_user)):
    sessions = db.query(models.AuthSession).filter(
        models.AuthSession.user_id == user.id,
        models.AuthSession.revoked.is_(False),
    ).all()
    for s in sessions:
        s.revoked = True
    db.commit()
    return None


@app.get("/api/me", response_model=schemas.MeResponse)
def me(user: models.User = Depends(auth.get_current_user)):
    return schemas.MeResponse(
        user=schemas.UserPublic(**auth.public_user(user)),
        permissions=auth.permissions_for(user),
    )


@app.post("/api/validate-challenge", response_model=schemas.ValidateChallengeResponse)
def validate_challenge(payload: schemas.ValidateChallengeRequest):
    try:
        analysis = face_logic.analyze_frame(payload.image)
        face_logic.verify_challenge(analysis, payload.challenge)
        if payload.challenge != "neutral" and payload.neutral_embedding:
            dist = face_logic.face_distance(payload.neutral_embedding, analysis.embedding)
            if dist > settings.face_tolerance:
                raise face_logic.LivenessError(f"Identity drift detected (dist={dist:.3f}) - please stay in frame")
        return schemas.ValidateChallengeResponse(status="success", message="Valid", embedding=analysis.embedding)
    except face_logic.ImageValidationError as exc:
        return schemas.ValidateChallengeResponse(status="error", message=str(exc))
    except face_logic.LivenessError as exc:
        return schemas.ValidateChallengeResponse(status="error", message=str(exc))


# ─── Team & invites (Account Owner only) ───────────────────────────────────


@app.get("/api/team", response_model=list[schemas.TeamMember])
def list_team(user: models.User = Depends(auth.get_current_user), db: Session = Depends(database.get_db)):
    """List members of the caller's organization. All authenticated users in
    the org can read the roster (so they can see who their teammates are);
    only the AccountOwner can mutate it."""
    members = (
        db.query(models.User)
        .filter(models.User.organization_id == user.organization_id)
        .order_by(models.User.id.asc())
        .all()
    )
    return [
        schemas.TeamMember(
            id=m.id,
            name=m.full_name,
            email=m.email,
            role=m.role,
            position=m.position,
            is_account_owner=m.is_account_owner,
            has_face=m.face_vector is not None,
            created_at=m.created_at,
        )
        for m in members
    ]


@app.get("/api/invites", response_model=list[schemas.InviteRead])
def list_invites(
    user: models.User = Depends(auth.require_account_owner),
    db: Session = Depends(database.get_db),
):
    rows = (
        db.query(models.Invite)
        .filter(models.Invite.organization_id == user.organization_id)
        .order_by(models.Invite.id.desc())
        .all()
    )
    return [
        schemas.InviteRead(
            id=i.id,
            email=i.email,
            role=i.role,
            expires_at=i.expires_at,
            used_at=i.used_at,
            revoked=i.revoked,
            redemption_url=f"{INVITE_LINK_BASE}/invite/{i.token}",
            created_at=i.created_at,
        )
        for i in rows
    ]


@app.post("/api/invites", response_model=schemas.InviteRead, status_code=status.HTTP_201_CREATED)
def create_invite(
    payload: schemas.InviteCreate,
    user: models.User = Depends(auth.require_account_owner),
    db: Session = Depends(database.get_db),
):
    email = str(payload.email).lower()

    # Don't issue an invite for an email that already has an account
    # *anywhere* (in this org or another) — it would be unusable.
    if db.query(models.User).filter(models.User.email == email).first():
        raise HTTPException(status.HTTP_409_CONFLICT, detail="A user with that email already exists")

    # If a still-active invite already exists for this email in this org,
    # revoke it before issuing a new one. Avoids stale links.
    existing = (
        db.query(models.Invite)
        .filter(
            models.Invite.email == email,
            models.Invite.organization_id == user.organization_id,
            models.Invite.used_at.is_(None),
            models.Invite.revoked.is_(False),
        )
        .all()
    )
    for old in existing:
        old.revoked = True

    invite = models.Invite(
        token=auth.mint_invite_token(),
        email=email,
        role=payload.role,
        organization_id=user.organization_id,
        created_by_user_id=user.id,
    )
    db.add(invite)
    db.commit()
    db.refresh(invite)
    logger.info("invite.create id=%d email=%s role=%s by_user=%d", invite.id, email, payload.role.value, user.id)
    return schemas.InviteRead(
        id=invite.id,
        email=invite.email,
        role=invite.role,
        expires_at=invite.expires_at,
        used_at=invite.used_at,
        revoked=invite.revoked,
        redemption_url=f"{INVITE_LINK_BASE}/invite/{invite.token}",
        created_at=invite.created_at,
    )


@app.delete("/api/invites/{invite_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_invite(
    invite_id: int,
    user: models.User = Depends(auth.require_account_owner),
    db: Session = Depends(database.get_db),
):
    invite = (
        db.query(models.Invite)
        .filter(models.Invite.id == invite_id, models.Invite.organization_id == user.organization_id)
        .first()
    )
    if invite is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Invite not found")
    invite.revoked = True
    db.commit()
    return None


@app.get("/api/invites/{token}/preview", response_model=schemas.InvitePreview)
def preview_invite(token: str, db: Session = Depends(database.get_db)):
    """Public — used by the /invite/:token landing page to render the
    invitee's email + assigned role + organization before they fill out
    the form. Returns a `valid: false` payload (rather than 404) so the
    UI can show a friendly explanation."""
    invite = auth.find_active_invite(db, token)
    if invite is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Invite not found")
    expiry = invite.expires_at
    if expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)

    valid = True
    reason: str | None = None
    if invite.revoked:
        valid = False
        reason = "This invite has been revoked."
    elif invite.used_at is not None:
        valid = False
        reason = "This invite has already been used."
    elif expiry < _utcnow():
        valid = False
        reason = "This invite has expired."

    return schemas.InvitePreview(
        email=invite.email,
        role=invite.role,
        organization_name=invite.organization.name,
        expires_at=invite.expires_at,
        valid=valid,
        reason=reason,
    )


# ─── Clients (RBAC + org-scoped) ───────────────────────────────────────────


_ALL_READ_ROLES = (Role.ADMIN, Role.ACCOUNTANT, Role.MARKETING)


@app.get("/api/clients")
def list_clients(
    user: models.User = Depends(auth.require_role(*_ALL_READ_ROLES)),
    db: Session = Depends(database.get_db),
):
    rows = (
        db.query(models.Client)
        .filter(models.Client.organization_id == user.organization_id)
        .order_by(models.Client.id.asc())
        .all()
    )
    return [auth.serialize_client(c, user.role) for c in rows]


@app.get("/api/clients/{client_id}")
def get_client(
    client_id: int,
    user: models.User = Depends(auth.require_role(*_ALL_READ_ROLES)),
    db: Session = Depends(database.get_db),
):
    client = (
        db.query(models.Client)
        .filter(models.Client.id == client_id, models.Client.organization_id == user.organization_id)
        .first()
    )
    if client is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Client not found")
    return auth.serialize_client(client, user.role)


@app.post("/api/clients", status_code=status.HTTP_201_CREATED)
def create_client(
    payload: schemas.ClientCreate,
    user: models.User = Depends(auth.require_role(Role.ADMIN)),
    db: Session = Depends(database.get_db),
):
    client = models.Client(
        organization_id=user.organization_id,  # always scoped to caller's org
        full_name=payload.full_name,
        address=payload.address,
        phone=payload.phone,
        credit_card=payload.credit_card,
    )
    db.add(client)
    db.commit()
    db.refresh(client)
    logger.info("client.create id=%d org_id=%d by_user=%d", client.id, user.organization_id, user.id)
    return auth.serialize_client(client, user.role)


@app.patch("/api/clients/{client_id}")
def update_client(
    client_id: int,
    payload: schemas.ClientUpdate,
    user: models.User = Depends(auth.require_role(Role.ADMIN)),
    db: Session = Depends(database.get_db),
):
    client = (
        db.query(models.Client)
        .filter(models.Client.id == client_id, models.Client.organization_id == user.organization_id)
        .first()
    )
    if client is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Client not found")
    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(client, field, value)
    db.commit()
    db.refresh(client)
    logger.info("client.update id=%d by_user=%d", client.id, user.id)
    return auth.serialize_client(client, user.role)


@app.delete("/api/clients/{client_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_client(
    client_id: int,
    user: models.User = Depends(auth.require_role(Role.ADMIN)),
    db: Session = Depends(database.get_db),
):
    client = (
        db.query(models.Client)
        .filter(models.Client.id == client_id, models.Client.organization_id == user.organization_id)
        .first()
    )
    if client is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Client not found")
    db.delete(client)
    db.commit()
    logger.info("client.delete id=%d by_user=%d", client_id, user.id)
    return None
