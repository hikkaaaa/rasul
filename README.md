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

---

## System Operations & Testing Guide

This section covers running the full RBAC stack end-to-end and exercising
each of the three permission tiers against the Clients dashboard.

### 1. Launch instructions

The system is three processes: the SQLite database (a single file), the
FastAPI backend, and the Vite-served React frontend.

**Step 1 — backend (one-time setup, then per-session):**

```bash
cd backend
python3 -m venv .venv               # one-time
source .venv/bin/activate
pip install -r ../requirements.txt  # one-time
python seed.py --reset              # one-time: drop+create schema, insert test users + sample clients
uvicorn main:app --reload           # serves http://localhost:8000
```

`seed.py --reset` is required on first run **and** any time the schema
changes (e.g. after pulling new model fields). It drops the SQLite tables
in `backend/face_system.db`, recreates them, and inserts the six RBAC test
users plus four sample client records. Use `python seed.py` (no flag) for
an additive run that only inserts missing rows — safe to re-run.

**Step 2 — frontend (in a second terminal):**

```bash
cd frontend
npm install                         # one-time
npm run dev                         # serves http://localhost:5173
```

Open `http://localhost:5173` in a browser and grant camera access when
prompted.

**Step 3 — claim a test identity (first-time only per role):**

The seeded test users are created with no enrolled face. The first time
someone signs up with a matching email + IIN, the signup flow binds their
face to that pre-assigned role (see "Test accounts" below).

### 2. Test accounts

Six identities are pre-seeded with role assignments. To test as one of
them, go to **Create an account** and fill in the matching email + IIN —
the system will bind your face to that pre-assigned role.

| Role | Permissions | Name | Email | IIN |
|------|-------------|------|-------|-----|
| **Admin** (Level 1) | Full CRUD on clients, including credit card | Ainur | `ainur@faceid.app` | `010101000001` |
| **Admin** (Level 1) | Full CRUD on clients, including credit card | Sultan | `sultan@faceid.app` | `010101000002` |
| **Accountant** (Level 2) | Read-all (incl. credit card), no writes | Ivan | `ivan@faceid.app` | `010101000003` |
| **Accountant** (Level 2) | Read-all (incl. credit card), no writes | Erasyl | `erasyl@faceid.app` | `010101000004` |
| **Marketing** (Level 3) | Read name/address/phone, credit card masked | Ahmed | `ahmed@faceid.app` | `010101000005` |
| **Marketing** (Level 3) | Read name/address/phone, credit card masked | Peter | `peter@faceid.app` | `010101000006` |

Anyone signing up with an email **not** in the table above is created as
a regular user with the lowest-privilege Marketing role. To promote them,
add a row to `TEST_USERS` in `backend/seed.py` and re-run `python seed.py`,
or update the role directly in the database.

**Resetting a test identity** (so a different person can claim the same
role): `python seed.py --reset` wipes everything and re-seeds. Note this
also clears any clients you've created.

### 3. Endpoint map

All `/api/clients*` endpoints require `Authorization: Bearer <token>`,
where the token is the value returned by `POST /api/login`.

| Method | Path | Roles permitted | Notes |
|--------|------|-----------------|-------|
| `POST` | `/api/signup` | (public) | Multi-angle liveness; new emails default to Marketing role; pre-seeded emails claim their role on first scan. |
| `POST` | `/api/login` | (public) | Returns `{ user, token }`. Token is opaque (32-byte hex). |
| `POST` | `/api/logout` | any authenticated | Revokes all sessions for the calling user. |
| `GET`  | `/api/me` | any authenticated | Returns the user + a permissions map used by the UI to hide buttons. |
| `POST` | `/api/validate-challenge` | (public) | Real-time per-pose validation during signup. |
| `GET`  | `/api/clients` | Admin, Accountant, Marketing | Marketing receives credit card values masked as `**** **** **** 1234`. |
| `GET`  | `/api/clients/{id}` | Admin, Accountant, Marketing | Same masking rules. |
| `POST` | `/api/clients` | **Admin only** | 403 for any other role. |
| `PATCH`| `/api/clients/{id}` | **Admin only** | Partial update (only sent fields are written). |
| `DELETE`| `/api/clients/{id}` | **Admin only** | 204 on success, 404 if not found. |

The backend re-checks roles on every request — hiding the "Delete" button
in the UI is purely cosmetic. An attacker calling `DELETE /api/clients/1`
directly with an Accountant or Marketing token will receive `403
Forbidden` regardless of what the frontend renders.

### 4. Quick verification checklist

After launching, log in as each tier and confirm:

- [ ] **Admin** (Ainur or Sultan) — sees full credit card numbers, sees
      Edit + Delete buttons + "+ New client" button.
- [ ] **Accountant** (Ivan or Erasyl) — sees full credit card numbers,
      does **not** see Edit / Delete / New buttons.
- [ ] **Marketing** (Ahmed or Peter) — credit card column shows
      `**** **** **** 1234` with a "masked — restricted role" label, no
      write buttons.
- [ ] Direct API call: `curl -X DELETE http://localhost:8000/api/clients/1
      -H "Authorization: Bearer <marketing-token>"` returns `403`.

---

## Roles

The system defines three roles. Every authenticated user holds exactly one
role, stored on the `users.role` column as one of `Admin`, `Accountant`, or
`Marketing` (see `backend/models.py → Role`). The role is loaded into the
request context by the `get_current_user` dependency on every protected
call, so every authorization decision is made server-side from the same
source of truth — the UI mirrors these rules but cannot grant capabilities
the backend won't allow.

> **A note on "clients":** *Client* is **not** a fourth role. Clients are
> the **subjects** of the system — customer records being managed —
> *not* accounts that authenticate. See [Subjects vs. operators](#subjects-vs-operators-why-client-is-not-a-role)
> below for the full distinction.

### Capability matrix

| Capability | Admin | Accountant | Marketing |
|------------|:-----:|:----------:|:---------:|
| Sign in via Face ID                       | ✅ | ✅ | ✅ |
| View own profile (`/api/me`)              | ✅ | ✅ | ✅ |
| List clients                              | ✅ | ✅ | ✅ |
| Read full client profile (name/addr/phone)| ✅ | ✅ | ✅ |
| View **credit card** in cleartext         | ✅ | ✅ | ❌ (masked) |
| Create new client                         | ✅ | ❌ | ❌ |
| Edit existing client                      | ✅ | ❌ | ❌ |
| Delete client                             | ✅ | ❌ | ❌ |
| See "+ New / Edit / Delete" buttons in UI | ✅ | ❌ | ❌ |

Backend permission keys exposed by `/api/me` (used by the frontend to
decide which buttons to render):

```
clients.read              → Admin, Accountant, Marketing
clients.create            → Admin
clients.update            → Admin
clients.delete            → Admin
clients.view_credit_card  → Admin, Accountant
```

### Level 1 — Admin

> Database administrators with full authority over client records.

- **Permissions:** Full **CRUD** on every client record. May create, edit
  any field (name, address, phone, credit card), and delete records.
- **Data visibility:** Sees all fields in cleartext, including credit card
  numbers.
- **UI affordances:** "+ New client" header button, "Edit" + "Delete"
  buttons on every row, full editor for credit card field.
- **Typical caller:** System administrator, on-call engineer, customer
  data steward.
- **Seed users:** Ainur, Sultan.

### Level 2 — Accountant

> Accounting department — needs full visibility but no write access.

- **Permissions:** **Read-only** access to the entire record, including
  the sensitive credit card field. Cannot create, edit, or delete any
  records.
- **Data visibility:** Identical to Admin — every field, including the
  full credit card number, is rendered in cleartext.
- **UI affordances:** Client rows render with no Edit / Delete buttons; no
  "+ New client" button. Attempting `POST`/`PATCH`/`DELETE` on
  `/api/clients` returns `403 Forbidden`.
- **Typical caller:** Accountant reconciling charges, finance auditor.
- **Seed users:** Ivan, Erasyl.

### Level 3 — Marketing

> Marketing department — restricted view, financial data is hidden.

- **Permissions:** Read-only access to general client info (name,
  address, phone). **No** access to credit card data. **No** write
  rights of any kind.
- **Data visibility:** Credit card is masked server-side in the response
  payload as `**** **** **** 1234` (last four digits only, useful for
  campaign correlation without leaking full card numbers). The UI
  surfaces a "masked — restricted role" badge so the user knows the data
  exists but isn't available to them.
- **UI affordances:** No write buttons. The credit card field in any
  modal/editor is unavailable.
- **Typical caller:** Marketing analyst, campaign manager, growth team.
- **Seed users:** Ahmed, Peter.

### Default role for self-registered users

Anyone signing up with an email **not** in the seed list is created with
the **Marketing** role by default — the lowest-privilege tier. Elevation
to Accountant or Admin is a deliberate, out-of-band action: either
pre-seed the user in `backend/seed.py` or update the `users.role` column
directly. There is no UI for self-promotion, by design.

### Subjects vs. operators — why "Client" is not a role

A common question: *"Can I register as a Client? What can a Client do?"*
The short answer is **no** — the system has no Client role and no client
login. The longer answer:

The data model deliberately separates the two populations:

| Concept | DB table | Authenticates? | Has a role? | Has a face vector? |
|---------|----------|:--------------:|:-----------:|:------------------:|
| **Operator** (Admin / Accountant / Marketing) | `users` | ✅ via Face ID | ✅ one of three | ✅ |
| **Client** (the customer being managed) | `clients` | ❌ | ❌ | ❌ |

A `Client` row holds `full_name`, `address`, `phone`, `credit_card`,
`created_at`, `updated_at` — it is purely a record. There is no
`client.email`, no password, no biometric, no API surface for a client to
"log in." Clients are *acted upon* by Admin/Accountant/Marketing
operators; they do not act themselves.

**What clients can / cannot do:**

| Action | Client can do this? |
|--------|:-------------------:|
| Sign up, log in, or hold a session token | ❌ — no auth row exists |
| Be looked up, listed, or sorted in the dashboard | ✅ — by any operator |
| Have their address / phone / card edited | ✅ — by an Admin |
| Have their record deleted | ✅ — by an Admin |
| See or modify *their own* record | ❌ — no self-service portal |
| Be promoted to a staff role | ❌ — no path; would need to be created as a `User` separately |

**What happens if you try to sign up?** The public `POST /api/signup`
endpoint creates a row in the `users` table — it does **not** create a
`Client`. The new account is given the **Marketing** role by default
(lowest-privilege staff tier). Self-registration is for staff onboarding,
not customer enrolment.

**If you wanted real customer-facing self-service** (e.g. a "client
portal" where a customer logs in and views their own record), the schema
would need to grow:

- A `client_id` foreign key on `users` linking the operator's account to
  a specific `Client` row, *or* a new role like `Role.CLIENT` plus a
  scoped permission such as `clients.read_own` that returns only rows
  matching the caller.
- A new endpoint (`GET /api/clients/me`) that uses that scoped
  permission.
- UI to render that single record instead of the dashboard list.

None of that is wired up today, and it's intentionally out of scope —
the system is modelled as a back-office RBAC tool, not a customer portal.

### How a role is enforced (request lifecycle)

1. The frontend sends `Authorization: Bearer <token>` on every protected
   request.
2. `auth.get_current_user` resolves the token to its `User` row (and thus
   the role).
3. Routes that mutate state declare `Depends(auth.require_role(Role.ADMIN))`
   — the dependency raises `403` **before** the handler runs if the role
   isn't permitted.
4. Routes that return data go through `auth.serialize_client(client, role)`,
   which masks the credit card field for any role that fails
   `can_view_credit_card`.
5. The frontend's `/api/me` response carries a permissions map; pages use
   it to hide buttons. This is purely cosmetic — bypassing the UI still
   hits the same backend guards above.
