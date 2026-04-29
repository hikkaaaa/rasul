import logging
from contextlib import asynccontextmanager
from math import inf

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
    # PATCH/DELETE are needed for Admin client edits; OPTIONS for CORS preflight.
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    # Authorization is required so the bearer token can be sent cross-origin.
    allow_headers=["Content-Type", "Authorization"],
)


# Margin between best and second-best match below which we treat the result
# as ambiguous and reject. Prevents leaking access when two registered users
# look similar enough that the classifier can't confidently pick one.
LOGIN_AMBIGUITY_MARGIN = 0.05


@app.get("/")
def read_root():
    return {"message": "Face Recognition API is online"}


# ─── Auth: signup, login, logout, me ────────────────────────────────────────


@app.post(
    "/api/signup",
    response_model=schemas.SignupResponse,
    status_code=status.HTTP_201_CREATED,
)
def signup(
    request: Request,
    payload: schemas.SignupRequest,
    db: Session = Depends(database.get_db),
):
    # Check for an existing user we might be claiming. A pre-seeded test user
    # has a matching email + IIN but no face_vector yet — first signup binds
    # the face to that pre-assigned role. This is the mechanism that makes
    # role-specific test accounts (Ainur=Admin, Ahmed=Marketing, etc.) work
    # without forcing testers to also have those exact faces.
    existing_email = db.query(models.User).filter(models.User.email == str(payload.email)).first()
    existing_iin = db.query(models.User).filter(models.User.iin == payload.iin).first()

    claim_target: models.User | None = None
    if existing_email and existing_iin and existing_email.id == existing_iin.id and existing_email.face_vector is None:
        claim_target = existing_email
    else:
        if existing_iin:
            logger.info("signup.conflict field=iin")
            raise HTTPException(status.HTTP_409_CONFLICT, detail="IIN already registered")
        if existing_email:
            logger.info("signup.conflict field=email")
            raise HTTPException(status.HTTP_409_CONFLICT, detail="Email already registered")

    # Challenge frames must contain exactly one neutral + three distinct challenges.
    by_type: dict[str, schemas.FrameCapture] = {}
    for frame in payload.frames:
        if frame.challenge in by_type:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Duplicate challenge frame: {frame.challenge}",
            )
        by_type[frame.challenge] = frame

    if "neutral" not in by_type:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Missing neutral-pose frame",
        )

    horizontal = {"turn_left", "turn_right"} & set(by_type)
    vertical = {"look_up", "look_down"} & set(by_type)
    if not horizontal:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Missing horizontal head-turn challenge",
        )
    if not vertical:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Missing vertical head-turn challenge",
        )
    if "smile" not in by_type:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Missing smile challenge",
        )

    # Analyze each frame (decode, detect face, landmarks, quality checks).
    analyses: dict[str, face_logic.FrameAnalysis] = {}
    for challenge, frame in by_type.items():
        try:
            analysis = face_logic.analyze_frame(frame.image)
        except face_logic.ImageValidationError as exc:
            logger.info("signup.invalid_image challenge=%s reason=%s", challenge, exc)
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
        except face_logic.LivenessError as exc:
            logger.info("signup.liveness_fail challenge=%s reason=%s", challenge, exc)
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
        analyses[challenge] = analysis

    # Per-challenge pose/expression verification.
    for challenge, analysis in analyses.items():
        try:
            face_logic.verify_challenge(analysis, challenge)  # type: ignore[arg-type]
        except face_logic.LivenessError as exc:
            logger.info("signup.challenge_fail challenge=%s reason=%s", challenge, exc)
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))

    # All frames must be the same person as the neutral pose.
    neutral = analyses["neutral"]
    for challenge, analysis in analyses.items():
        if challenge == "neutral":
            continue
        try:
            face_logic.ensure_same_person(neutral, analysis)
        except face_logic.LivenessError as exc:
            logger.info("signup.identity_drift challenge=%s reason=%s", challenge, exc)
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))

    # Duplicate-face guard: reject if this face is already registered under
    # another account. (Skipped for the user we're claiming, since they have
    # no embedding yet — they're the slot the face is going into.)
    new_vector = neutral.embedding
    for existing in db.query(models.User).all():
        if existing.face_vector is None:
            continue
        if claim_target is not None and existing.id == claim_target.id:
            continue
        distance = face_logic.face_distance(existing.face_vector, new_vector)
        if distance < settings.duplicate_face_distance:
            logger.info(
                "signup.duplicate_face existing_user_id=%d distance=%.3f",
                existing.id,
                distance,
            )
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                detail="This face is already linked to another account. Please return to the homepage and sign in instead.",
            )

    if claim_target is not None:
        # Claim flow: keep the pre-assigned role, attach the new face vector.
        claim_target.full_name = payload.name
        claim_target.face_vector = new_vector
        db.commit()
        db.refresh(claim_target)
        logger.info("signup.claim user_id=%d role=%s", claim_target.id, claim_target.role.value)
        return schemas.SignupResponse(
            status="success",
            message=f"Face enrolled for {payload.name} ({claim_target.role.value})",
            role=claim_target.role,
        )

    # Brand-new self-registration → default to lowest-privilege role. Admins
    # provision elevated roles deliberately via seeding.
    user = models.User(
        full_name=payload.name,
        email=str(payload.email),
        iin=payload.iin,
        face_vector=new_vector,
        role=Role.MARKETING,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    logger.info("signup.success user_id=%d role=%s", user.id, user.role.value)
    return schemas.SignupResponse(
        status="success",
        message=f"User {payload.name} registered",
        role=user.role,
    )


@app.post("/api/login", response_model=schemas.LoginResponse)
def login(
    request: Request,
    payload: schemas.LoginRequest,
    db: Session = Depends(database.get_db),
):
    client_addr = request.client.host if request.client else "unknown"

    try:
        candidate = face_logic.get_embedding(payload.image)
    except face_logic.ImageValidationError as exc:
        logger.info("login.invalid_image client=%s reason=%s", client_addr, exc)
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))

    if candidate is None:
        logger.info("login.no_face client=%s", client_addr)
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No single clear face detected in the image",
        )

    # Nearest-neighbour search. Fine up to ~1k users; beyond that swap to a
    # vector DB (pgvector / Milvus) and do ANN search. See README.
    # Skip pre-seeded users that haven't enrolled their face yet — they have
    # no embedding to compare against.
    best_user: models.User | None = None
    best_distance = inf
    second_best_distance = inf
    for user in db.query(models.User).all():
        if user.face_vector is None:
            continue
        distance = face_logic.face_distance(user.face_vector, candidate)
        if distance < best_distance:
            second_best_distance = best_distance
            best_distance = distance
            best_user = user
        elif distance < second_best_distance:
            second_best_distance = distance

    if best_user is None or best_distance > settings.face_tolerance:
        logger.warning(
            "login.denied client=%s best_distance=%.3f",
            client_addr,
            best_distance if best_user else -1,
        )
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Face not recognized")

    if second_best_distance - best_distance < LOGIN_AMBIGUITY_MARGIN:
        logger.warning(
            "login.ambiguous client=%s best=%.3f second=%.3f",
            client_addr,
            best_distance,
            second_best_distance,
        )
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            detail="Could not confidently identify you — please try again",
        )

    # Mint a bearer token. The frontend stores it and sends it as
    # `Authorization: Bearer <token>` on every protected request.
    token = auth.issue_token(db, best_user)

    logger.info(
        "login.success user_id=%d role=%s client=%s distance=%.3f",
        best_user.id,
        best_user.role.value,
        client_addr,
        best_distance,
    )
    return schemas.LoginResponse(
        status="authorized",
        user=schemas.UserPublic(
            name=best_user.full_name,
            email=best_user.email,
            iin=best_user.iin,
            role=best_user.role,
        ),
        token=token,
    )


@app.post("/api/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    db: Session = Depends(database.get_db),
    user: models.User = Depends(auth.get_current_user),
):
    # Revokes every active session for this user. Simpler than threading the
    # specific token through the dependency, and aligns with "sign out
    # everywhere" semantics — fine for a face-auth system where the user
    # only has one active client at a time anyway.
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
    """Returns the caller's identity + permissions map. The frontend uses
    the permissions map to decide which buttons to render; the backend still
    enforces the same rules independently on every protected route."""
    return schemas.MeResponse(
        user=schemas.UserPublic(
            name=user.full_name,
            email=user.email,
            iin=user.iin,
            role=user.role,
        ),
        permissions=auth.permissions_for(user.role),
    )


@app.post("/api/validate-challenge", response_model=schemas.ValidateChallengeResponse)
def validate_challenge(
    request: Request,
    payload: schemas.ValidateChallengeRequest,
):
    try:
        analysis = face_logic.analyze_frame(payload.image)
        face_logic.verify_challenge(analysis, payload.challenge)

        # If it's not neutral and we got a neutral embedding, ensure same person
        if payload.challenge != "neutral" and payload.neutral_embedding:
            dist = face_logic.face_distance(payload.neutral_embedding, analysis.embedding)
            if dist > settings.face_tolerance:
                 raise face_logic.LivenessError(f"Identity drift detected (dist={dist:.3f}) - please stay in frame")

        return schemas.ValidateChallengeResponse(
            status="success",
            message="Valid",
            embedding=analysis.embedding
        )
    except face_logic.ImageValidationError as exc:
        return schemas.ValidateChallengeResponse(
            status="error",
            message=str(exc)
        )
    except face_logic.LivenessError as exc:
        return schemas.ValidateChallengeResponse(
            status="error",
            message=str(exc)
        )


# ─── Clients (RBAC-controlled resource) ─────────────────────────────────────
#
# Permission matrix:
#   GET    /api/clients          → Admin, Accountant, Marketing  (read)
#   GET    /api/clients/{id}     → Admin, Accountant, Marketing  (read)
#   POST   /api/clients          → Admin only                    (create)
#   PATCH  /api/clients/{id}     → Admin only                    (update)
#   DELETE /api/clients/{id}     → Admin only                    (delete)
#
# Marketing role gets `credit_card` masked via auth.serialize_client; the
# write endpoints rely on require_role() to short-circuit at 403 before any
# business logic runs.


_ALL_READ_ROLES = (Role.ADMIN, Role.ACCOUNTANT, Role.MARKETING)


@app.get("/api/clients")
def list_clients(
    user: models.User = Depends(auth.require_role(*_ALL_READ_ROLES)),
    db: Session = Depends(database.get_db),
):
    rows = db.query(models.Client).order_by(models.Client.id.asc()).all()
    return [auth.serialize_client(c, user.role) for c in rows]


@app.get("/api/clients/{client_id}")
def get_client(
    client_id: int,
    user: models.User = Depends(auth.require_role(*_ALL_READ_ROLES)),
    db: Session = Depends(database.get_db),
):
    client = db.query(models.Client).filter(models.Client.id == client_id).first()
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
        full_name=payload.full_name,
        address=payload.address,
        phone=payload.phone,
        credit_card=payload.credit_card,
    )
    db.add(client)
    db.commit()
    db.refresh(client)
    logger.info("client.create id=%d by_user=%d", client.id, user.id)
    return auth.serialize_client(client, user.role)


@app.patch("/api/clients/{client_id}")
def update_client(
    client_id: int,
    payload: schemas.ClientUpdate,
    user: models.User = Depends(auth.require_role(Role.ADMIN)),
    db: Session = Depends(database.get_db),
):
    client = db.query(models.Client).filter(models.Client.id == client_id).first()
    if client is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Client not found")
    # Patch semantics: only update the fields the caller actually sent.
    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(client, field, value)
    db.commit()
    db.refresh(client)
    logger.info("client.update id=%d by_user=%d fields=%s", client.id, user.id, list(data.keys()))
    return auth.serialize_client(client, user.role)


@app.delete("/api/clients/{client_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_client(
    client_id: int,
    user: models.User = Depends(auth.require_role(Role.ADMIN)),
    db: Session = Depends(database.get_db),
):
    client = db.query(models.Client).filter(models.Client.id == client_id).first()
    if client is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Client not found")
    db.delete(client)
    db.commit()
    logger.info("client.delete id=%d by_user=%d", client_id, user.id)
    return None
