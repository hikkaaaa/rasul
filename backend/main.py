import logging
from contextlib import asynccontextmanager
from math import inf

from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware

from sqlalchemy.orm import Session

import database
import face_logic
import models
import schemas
from config import settings

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
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


# Margin between best and second-best match below which we treat the result
# as ambiguous and reject. Prevents leaking access when two registered users
# look similar enough that the classifier can't confidently pick one.
LOGIN_AMBIGUITY_MARGIN = 0.05


@app.get("/")
def read_root():
    return {"message": "Face Recognition API is online"}


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
    if db.query(models.User).filter(models.User.iin == payload.iin).first():
        logger.info("signup.conflict field=iin")
        raise HTTPException(status.HTTP_409_CONFLICT, detail="IIN already registered")

    if db.query(models.User).filter(models.User.email == str(payload.email)).first():
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
    # another account.
    new_vector = neutral.embedding
    for existing in db.query(models.User).all():
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

    user = models.User(
        full_name=payload.name,
        email=str(payload.email),
        iin=payload.iin,
        face_vector=new_vector,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    logger.info("signup.success user_id=%d", user.id)
    return schemas.SignupResponse(
        status="success", message=f"User {payload.name} registered"
    )


@app.post("/api/login", response_model=schemas.LoginResponse)
def login(
    request: Request,
    payload: schemas.LoginRequest,
    db: Session = Depends(database.get_db),
):
    client = request.client.host if request.client else "unknown"

    try:
        candidate = face_logic.get_embedding(payload.image)
    except face_logic.ImageValidationError as exc:
        logger.info("login.invalid_image client=%s reason=%s", client, exc)
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))

    if candidate is None:
        logger.info("login.no_face client=%s", client)
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No single clear face detected in the image",
        )

    # Nearest-neighbour search. Fine up to ~1k users; beyond that swap to a
    # vector DB (pgvector / Milvus) and do ANN search. See README.
    best_user: models.User | None = None
    best_distance = inf
    second_best_distance = inf
    for user in db.query(models.User).all():
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
            client,
            best_distance if best_user else -1,
        )
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Face not recognized")

    if second_best_distance - best_distance < LOGIN_AMBIGUITY_MARGIN:
        logger.warning(
            "login.ambiguous client=%s best=%.3f second=%.3f",
            client,
            best_distance,
            second_best_distance,
        )
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            detail="Could not confidently identify you — please try again",
        )

    logger.info(
        "login.success user_id=%d client=%s distance=%.3f",
        best_user.id,
        client,
        best_distance,
    )
    return schemas.LoginResponse(
        status="authorized",
        user=schemas.UserPublic(
            name=best_user.full_name, email=best_user.email, iin=best_user.iin
        ),
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
            # We mock a FrameAnalysis just for distance check because ensure_same_person wants it
            # But let's just do the distance directly here
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
