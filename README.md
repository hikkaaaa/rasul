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

---

## Landing Page & Route Structure

The app no longer opens straight to a login card. Visiting the root URL
now lands on a marketing/landing page; auth flows are reachable from the
header buttons.

### Route map

| Route | Component | Purpose | Layout |
|-------|-----------|---------|--------|
| `/` | `pages/Landing.tsx` | Marketing landing page (hero, features, stats, CTA, footer). Header carries **Log In** + **Sign Up** buttons. | Full-bleed (no centered card) |
| `/login` | `pages/Login.tsx` | Existing face-scan login card. | Centered card |
| `/signup` | `pages/Register.tsx` | Existing multi-step face-scan registration. | Centered card |
| `/profile` | `pages/Profile.tsx` | Authenticated user profile + role badge + clients link. | Centered card |
| `/clients` | `pages/Clients.tsx` | RBAC-protected clients dashboard. | Centered card |
| `*` | `pages/Landing.tsx` | Unknown URLs fall back to the landing page. | Full-bleed |

The full-bleed vs. centered choice is controlled in `frontend/src/App.tsx`
via `FULL_BLEED_ROUTES`. To make another future route own its own layout
(e.g., a docs page), add its path to that set.

### Modifying the landing page

All landing copy lives in **one file**: `frontend/src/pages/Landing.tsx`.
Common edits:

| Want to change… | Edit this |
|---|---|
| The brand name / logo glyph in header & footer | `Logo()` and `Footer()` components |
| Top nav link labels (`Features`, `Pricing`, `About`) | `<nav>` block inside `Header()` and the `Footer()` link list — anchors point at section IDs (`#features`, `#stats`, `#about`) |
| Hero heading + subtitle | The `<h1>` and `<p>` inside `Hero()` |
| Hero CTA button labels / destinations | The two `<Link>` elements at the bottom of `Hero()` |
| The "trust" blurb (`4.8 · trusted by 500+ teams`) | The `<Stars />` block inside `Hero()` |
| The 4 feature cards (title, copy, icon) | The `FEATURES` array near the top of the feature-grid section |
| Stats numbers (latency, accuracy, etc.) | The `items` array inside `Stats()` |
| Bullet list under "Built for teams that ship serious software" | The string array inside the `<ul>` in `Stats()` |
| Closing CTA heading + buttons | `ClosingCTA()` |
| Footer tagline / links | `Footer()` |

To **add a new section** between two existing ones, write a function that
returns a `<section>` and slot it into the `<main>` body of the top-level
`Landing()` component — sections are rendered in source order. Each
section uses the `useReveal()` hook + `motion.div` with
`whileInView="show"` to get the same scroll-fade-in animation; copy that
pattern for visual consistency.

### Theme / dark mode

The dark theme is global, defined in `frontend/src/index.css` via Tailwind
`@theme` tokens:

- `--color-cream-50` → page background (`#0f1117`)
- `--color-cream-100` → card / surface background (`#1a1d27`)
- `--color-gold-500` → primary action button (`#2563eb` / blue-600)
- `--color-gold-300` / `--color-gold-400` → accent text & secondary button

The landing page deliberately reuses these same tokens (rather than
hard-coding hex values) so the hero, header, and feature cards transition
seamlessly into the existing FaceID Access auth cards on `/login` and
`/signup`. To re-theme the entire product (landing + cards) at once, edit
the `@theme` block in `index.css` and every page picks it up.

### Responsiveness

The header collapses into a hamburger button below the `md` Tailwind
breakpoint (768px). Tapping the hamburger toggles a vertical drawer with
the same nav links plus stacked Log In / Sign Up buttons. Section
typography and grids step down via Tailwind's `sm:` / `lg:` modifiers; no
manual breakpoint logic needed.

### Scroll-reveal animations

Implemented with [Framer Motion](https://www.framer.com/motion/) — every
section uses the `useReveal()` helper at the top of `Landing.tsx`, which
returns a Variants object that fades + translates content as it enters
the viewport. The hook respects `prefers-reduced-motion` and degrades to
a static fade for users who've opted out of motion effects in their OS
settings.

---

## Multi-Step Onboarding & Team Management

The signup flow has been upgraded from a single-card form to a 3-step
stepper that creates an **Organization** as well as a User on first
registration. Subsequent teammates join via single-use **invite links**
issued by the Account Owner.

### The 3-step register flow

`/signup` (`frontend/src/pages/Register.tsx`) walks the user through:

1. **Basic Details** — full name, email, password (≥ 8 chars), company
   name, plus the "info is true" checkbox. Submitting this step posts to
   `POST /api/register/check`, which returns:
   - `ok` → company is new, email is new → advance.
   - `claim` → email matches a pre-seeded user with no enrolled face yet
     (e.g. one of the seeded test identities). The new password and
     position will bind to that pre-assigned role + organization. The UI
     surfaces a "Claiming an existing account in X" banner on Step 2.
   - `conflict_email` → reject; that address already has an active user.
   - `conflict_company` → reject; an org with that name already exists
     and the user isn't a known member of it. They have to ask the
     account owner for an invite link instead.
2. **Contact Details** — phone number, IIN (12 digits), and a
   Position/Role select (`Owner` / `Manager` / `Staff`). Position is a
   free-form job title — it's distinct from the system permission Role,
   which is auto-assigned.
3. **Verification** — the existing 4-frame liveness sequence (neutral +
   randomized horizontal + randomized vertical + smile). On success, the
   final `POST /api/register` call creates the User row, mints a bearer
   token, and the frontend lands on `/team` (account owners) or
   `/profile` (everyone else).

Smooth horizontal slide-in transitions between steps (signed `direction`
prop on `SlideIn`) — going forward slides left, going back slides right.
The component respects `prefers-reduced-motion` via Framer Motion.

### Account Owner / SuperAdmin

The first user to register a brand-new company is automatically flagged
`is_account_owner = True` in `users.is_account_owner` and assigned
`role = Admin`. This combination grants full client CRUD **plus** the
ability to manage the team roster.

| Capability | Owner (`is_account_owner=True`) | Regular Admin | Accountant | Marketing |
|---|:---:|:---:|:---:|:---:|
| Full client CRUD | ✅ | ✅ | ❌ | ❌ |
| Read clients | ✅ | ✅ | ✅ | ✅ |
| View credit card cleartext | ✅ | ✅ | ✅ | ❌ |
| **Invite teammates** | ✅ | ❌ | ❌ | ❌ |
| **Revoke invites** | ✅ | ❌ | ❌ | ❌ |
| **List team roster** (read) | ✅ | ✅ | ✅ | ✅ |
| Access `/team` page | ✅ | ❌ | ❌ | ❌ |

Note: `is_account_owner` is set automatically on first registration of a
company; there is no UI to grant it post-hoc. To transfer ownership in
production you'd flip the flag in the database directly.

### The invite system (admin-led onboarding)

Once an Account Owner is set up, no new self-registration is allowed
into their organization — anyone trying to register with that company
name will be rejected with `conflict_company`. New teammates are added
through invite links:

1. Owner opens **`/team`** ("Manage team" button on `/profile`, only
   visible to owners) and enters `{ email, role }` in the Invite a
   teammate form.
2. `POST /api/invites` mints a 32-byte hex token, persists an `Invite`
   row, and returns a redemption URL of the shape
   `http://localhost:5173/invite/<token>`. (No SMTP wired in dev — the
   owner copies the link and shares it manually. The Team page surfaces
   the most recent link in a copyable callout.)
3. Invitee opens the link → `Invite.tsx` → `GET /api/invites/<token>/preview`
   shows them their pre-locked email, role, and organization.
4. They fill in name + password + phone + IIN + position, then run the
   same 3-frame liveness sequence.
5. `POST /api/register` is called with `invite_token` set; the backend
   uses the invite's `organization_id` and `role` (ignoring whatever the
   form said for company name), marks the invite `used_at`, and creates
   the User as a non-owner.

**Invite lifecycle:** invites expire after 7 days. The Owner can revoke
a pending invite from `/team`. Revoked, expired, or already-used invites
return `valid: false` from the preview endpoint with a friendly reason
the UI surfaces. Re-inviting the same email automatically revokes any
still-active prior invites for that address in the same org.

### Schema changes

The data model now includes:

- **`organizations`** — `id`, `name` (unique), `created_at`. One row per
  company / tenant.
- **`users`** — extended with `organization_id` (FK, required),
  `password_hash` (PBKDF2-SHA256, nullable), `phone`, `position`,
  `is_account_owner`. `face_vector` is still nullable so seeded /
  invited users can claim their slot.
- **`invites`** — `id`, `token`, `email`, `role`, `organization_id`,
  `created_by_user_id`, `expires_at`, `used_at`, `revoked`, `created_at`.
- **`clients`** — gained `organization_id` (FK). All client CRUD now
  filters by `Client.organization_id == current_user.organization_id` —
  cross-tenant reads are impossible by construction.

A schema reset is required (`python seed.py --reset`); the existing
`face_system.db` from the previous milestone has none of these columns.

### New backend endpoints

| Method | Path | Auth | Notes |
|---|---|---|---|
| `POST` | `/api/register/check` | public | Step 1 dup-check; returns `ok` / `claim` / `conflict_email` / `conflict_company`. |
| `POST` | `/api/register` | public | Final 3-step submission. Optional `invite_token` selects invite-redemption flow. |
| `GET` | `/api/team` | any authenticated | Lists members of caller's org. |
| `POST` | `/api/invites` | **Account Owner only** | Mints a 7-day invite. Auto-revokes prior active invites for the same email. |
| `GET` | `/api/invites` | **Account Owner only** | Lists invites in caller's org. |
| `DELETE` | `/api/invites/{id}` | **Account Owner only** | Revoke. |
| `GET` | `/api/invites/{token}/preview` | public | For the redemption landing page. Returns `valid: false` for revoked/used/expired tokens. |

The legacy `POST /api/signup` is gone — the multi-step flow replaces
it. Login (`POST /api/login`) is unchanged: face-only, returns
`{ user, token }`. The login response and `/api/me` payload now include
`organization_id`, `organization_name`, `is_account_owner`, and
`position`.

### Organization scoping (the security guarantee)

Every protected endpoint that returns or mutates data filters on
`organization_id == current_user.organization_id`:

- `GET /api/clients` only returns clients in the caller's org.
- `GET /api/clients/{id}` 404s for clients in a different org (rather
  than 403, to avoid leaking the existence of cross-tenant rows).
- `POST /api/clients` always sets `organization_id` from the caller —
  the request body cannot influence it.
- `PATCH` / `DELETE` 404 if the row isn't in the caller's org.
- Team and invite lookups filter the same way.

Combined with the role guards (`require_role`, `require_account_owner`),
this means a malicious Marketing user in org A cannot read, write, or
even discover the existence of org B's data, even by hitting the API
directly with a forged Authorization header against another user's
token (since each token resolves to a single User → single org).

### Testing the new flow

After `python seed.py --reset` the test environment looks like:

- Organization "FaceID Test Co." with the 6 seeded users.
- **Ainur** is the Account Owner — register her first and you'll land on
  `/team`, where you can invite anyone.
- The other five (Sultan / Ivan / Erasyl / Ahmed / Peter) are non-owner
  members. They can be claimed via `/signup` like before; they cannot
  invite teammates.
- All four sample clients live inside that one organization.

To test the invite system end-to-end without a second machine:

1. Register as Ainur (Step 1: name=Ainur, email=`ainur@faceid.app`,
   pick any password, company=`FaceID Test Co.` → claim path).
2. From `/team`, invite a brand-new email + Role.
3. Sign out, copy the redemption URL, open it in an incognito window.
4. Fill in name/password/phone/IIN, run the face scan — you'll join
   `FaceID Test Co.` with the role from the invite.

### Modifying the onboarding text

| Want to change… | Edit this |
|---|---|
| Step labels in the breadcrumb (`Basic Details`, etc.) | The `STEPS` array in `Register.tsx` |
| Step 1 fields / validation rules | `BasicsStep` in `Register.tsx` |
| Step 2 fields / validation rules | `ContactStep` in `Register.tsx` |
| Liveness pose sequence (number of poses, prompts) | `buildSequence()` in `components/LivenessScanStep.tsx` |
| Invite expiry window | `_invite_default_expiry` in `backend/models.py` (currently 7 days) |
| Default position select options | The `<Select>` `options` arrays in `Register.tsx` and `Invite.tsx` |

---

## 1:1 Face Verification

The system has switched from face-only **identification** (1:N nearest-
neighbor search across every enrolled user) to **1:1 verification**
(compare the live face only against one specific user's stored vector).
This accommodates edge cases like identical twins or close lookalikes
that previously caused login collisions or were rejected at signup.

### What changed

- **Signup** no longer runs a global "is this face already enrolled?"
  check. The new embedding is saved directly onto the user's record,
  even if it happens to be very close to another user's vector.
- **Login** now requires the caller to identify themselves first by
  email or 12-digit IIN. The backend fetches **only that user's**
  stored vector and compares the live image against it. There is no
  longer a database-wide nearest-neighbor scan, so a user with a
  similar-looking face cannot be accidentally routed into the wrong
  profile.
- The `face_vector` column on `users` has no `unique=True` constraint —
  multiple rows may legitimately hold near-duplicate embeddings.

### New login flow (`/login`)

1. **Step 1 — Identify.** The user types their email or IIN. The
   frontend slides this card off-screen on submit.
2. **Step 2 — Scan.** The webcam opens, captures a frame, and posts
   `{ identifier, image }` to `POST /api/login`. The backend resolves
   the identifier to one row, computes the live embedding, and runs a
   single Euclidean distance check against `users.face_vector`.
3. **Result.** Match within `FACE_TOLERANCE` → token issued and the
   client lands on `/profile`. Otherwise the response is the uniform
   message **"Face does not match this account"** — same wording for
   "no such user", "user has no face enrolled", and "wrong face", so
   timing/text differences don't leak which identifiers exist.

### Backend `LoginRequest` shape

```jsonc
POST /api/login
{
  "identifier": "ainur@faceid.app",   // email OR 12-digit IIN
  "image": "data:image/jpeg;base64,…"
}
```

The identifier resolution rules:
- All-digit, length-12 strings are looked up against `users.iin`.
- Anything else is looked up against `users.email` (case-insensitive,
  with a verbatim fallback for legacy mixed-case rows).

### What this does NOT change

- The 4-frame liveness check during signup is unchanged.
- RBAC, organization scoping, invite system, and the AccountOwner
  capability matrix are unchanged.
- `FACE_TOLERANCE` (currently 0.5) is still the per-user match threshold;
  raise/lower it in `backend/.env` to trade off false-rejects vs. false-
  accepts. There is no longer an "ambiguity margin" — that concept only
  existed for 1:N search.
