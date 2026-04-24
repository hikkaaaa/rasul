# Face Recognition Access Control

Web-based biometric auth: FastAPI backend + React/TypeScript frontend.
Users register with name / email / IIN + a face scan. Login is face-only.

## Layout

```
face-id-system/
├── backend/                # FastAPI + face_recognition (dlib)
│   ├── main.py             # API routes (/signup, /login)
│   ├── face_logic.py       # Image decode, embedding, comparison, liveness
│   ├── schemas.py          # Pydantic request/response models
│   ├── models.py           # SQLAlchemy User table
│   ├── database.py         # Engine + session factory
│   ├── config.py           # Settings loaded from .env
│   └── .env.example        # Copy to .env
├── frontend/               # React + TypeScript + Tailwind
│   └── src/
│       ├── components/FaceScanner.tsx
│       └── pages/{Register,Login,Profile}.tsx
└── requirements.txt
```

## Backend setup (macOS, Apple Silicon)

`face_recognition` depends on `dlib`, which compiles native code. On
Apple Silicon you need the Homebrew toolchain first:

```bash
# System deps — one-time
brew install cmake dlib

# Project
cd backend
cp .env.example .env           # edit if you change defaults
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip wheel

uvicorn main:app --reload
```

If `pip install face-recognition` fails while building dlib, verify:

- Xcode command-line tools: `xcode-select --install`
- Homebrew cmake is on PATH: `which cmake`
- You are in a fresh venv (mixing system Python and Homebrew Python causes ABI mismatches).

The API runs on `http://localhost:8000`. Swagger UI at `/docs`.

## Frontend setup

```bash
cd frontend
npm install
npm run dev
```

Vite serves on `http://localhost:5173` — this matches the default
`CORS_ORIGINS` in `.env.example`.

## Configuration

All runtime knobs live in `backend/.env` (see `.env.example`):

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | SQLAlchemy URL. SQLite for dev, Postgres for prod. |
| `CORS_ORIGINS` | JSON list of allowed frontend origins. |
| `FACE_TOLERANCE` | Match distance threshold (0.5 strict — 0.6 default). |
| `LOGIN_RATE_LIMIT` | slowapi limit string, e.g. `5/minute`. |
| `SIGNUP_RATE_LIMIT` | slowapi limit string for `/signup`. |
| `MAX_IMAGE_BYTES` | Upload size cap. |
| `MIN_FACE_BLUR_VARIANCE` | Rejects blurry / screen-replay captures. |
| `LOG_LEVEL` | Standard Python log level. |

## API

- `POST /signup` → body `{name, email, iin, image}` (image = base64 / data URL).
  Returns 201 on success, 409 on duplicate IIN/email, 422 on bad image.
- `POST /login` → body `{image}`. Returns 200 with user profile on match,
  401 on no match, 422 on bad image, 429 when rate-limited.

Face embeddings are stored — original images are **not** persisted.

## Scaling notes

The `/login` path currently does a linear scan over all stored embeddings.
Fine for MVP. Once you exceed ~1,000 users, move embeddings into a vector
store (pgvector, Milvus, Qdrant) and switch the comparison to an ANN query.
The code in `face_logic.compare_vectors` isolates the distance metric so
swapping backends is localized.

## Operational notes

- **No raw images on disk.** Only 128-d embeddings are persisted.
- **Audit log.** Signup/login events go through the `face-api` logger;
pip install -r ../requirements.txt  wire it into your log aggregator in production.
- **Liveness.** `face_logic` rejects blurry face crops as a weak signal
  against photo-of-photo replays. For stronger guarantees add a blink /
  head-tilt prompt on the client or a dedicated anti-spoof model.
