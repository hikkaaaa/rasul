"""Seed the database with the six RBAC test identities + sample clients.

Run from the backend directory after installing requirements:

    python seed.py             # additive: only inserts missing rows
    python seed.py --reset     # DROP all tables then re-create + seed

Each test identity is created with `face_vector = NULL`. The first time
someone signs up using one of these (name + email + IIN), the signup flow
"claims" the slot — binding the new face to the pre-assigned role. That's
how testers exercise different role levels without all sharing the same
face.
"""

from __future__ import annotations

import argparse
import sys

from sqlalchemy.orm import Session

import database
import models
from models import Role


# IINs are placeholders that satisfy the 12-digit format. Replace with real
# Kazakhstan IINs if you intend to deploy this in production.
# NOTE on the email domain: `email-validator` (used by Pydantic's EmailStr)
# rejects reserved/special-use TLDs like `.test`, `.example`, `.local`,
# `.localhost`, and `.invalid` per RFC 2606. We use `@faceid.app` (a real,
# unrestricted TLD) so signup validation passes for the seeded accounts.
TEST_USERS: list[dict] = [
    # Level 1 — Admins (CRUD on clients)
    {"full_name": "Ainur",  "email": "ainur@faceid.app",  "iin": "010101000001", "role": Role.ADMIN},
    {"full_name": "Sultan", "email": "sultan@faceid.app", "iin": "010101000002", "role": Role.ADMIN},
    # Level 2 — Accounting (read-all incl. credit card)
    {"full_name": "Ivan",   "email": "ivan@faceid.app",   "iin": "010101000003", "role": Role.ACCOUNTANT},
    {"full_name": "Erasyl", "email": "erasyl@faceid.app", "iin": "010101000004", "role": Role.ACCOUNTANT},
    # Level 3 — Marketing (restricted, no credit card visibility)
    {"full_name": "Ahmed",  "email": "ahmed@faceid.app",  "iin": "010101000005", "role": Role.MARKETING},
    {"full_name": "Peter",  "email": "peter@faceid.app",  "iin": "010101000006", "role": Role.MARKETING},
]


SAMPLE_CLIENTS: list[dict] = [
    {
        "full_name": "Aliya Bekova",
        "address": "12 Abai Ave, Almaty",
        "phone": "+7 701 555 0101",
        "credit_card": "4539 1488 0343 6467",
    },
    {
        "full_name": "Daniyar Kim",
        "address": "44 Dostyk St, Astana",
        "phone": "+7 702 555 0102",
        "credit_card": "5500 0000 0000 0004",
    },
    {
        "full_name": "Madina Tulegenova",
        "address": "7 Tole Bi, Shymkent",
        "phone": "+7 705 555 0103",
        "credit_card": "3782 822463 10005",
    },
    {
        "full_name": "Yerzhan Aitkulov",
        "address": "21 Republic Sq, Karaganda",
        "phone": "+7 707 555 0104",
        "credit_card": "6011 1111 1111 1117",
    },
]


def reset_schema() -> None:
    print("Dropping all tables…")
    models.Base.metadata.drop_all(bind=database.engine)
    print("Re-creating schema…")
    models.Base.metadata.create_all(bind=database.engine)


def ensure_schema() -> None:
    models.Base.metadata.create_all(bind=database.engine)


def seed_users(db: Session) -> int:
    """Insert any missing test users. Existing rows (matched by email) are
    left untouched so you don't wipe out a face that's already enrolled."""
    inserted = 0
    for spec in TEST_USERS:
        existing = db.query(models.User).filter(models.User.email == spec["email"]).first()
        if existing:
            # If role drifted (e.g. someone manually changed it), realign.
            if existing.role != spec["role"]:
                existing.role = spec["role"]
                print(f"  · {spec['email']}: realigned role → {spec['role'].value}")
            continue
        user = models.User(
            full_name=spec["full_name"],
            email=spec["email"],
            iin=spec["iin"],
            face_vector=None,  # claimed on first signup
            role=spec["role"],
        )
        db.add(user)
        inserted += 1
        print(f"  + {spec['email']:<24} ({spec['role'].value})")
    db.commit()
    return inserted


def seed_clients(db: Session) -> int:
    """Insert sample client records if the clients table is empty."""
    if db.query(models.Client).count() > 0:
        return 0
    inserted = 0
    for spec in SAMPLE_CLIENTS:
        client = models.Client(**spec)
        db.add(client)
        inserted += 1
    db.commit()
    return inserted


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reset", action="store_true", help="drop and recreate all tables before seeding")
    args = parser.parse_args()

    if args.reset:
        reset_schema()
    else:
        ensure_schema()

    db = database.SessionLocal()
    try:
        print("Seeding test users…")
        n_users = seed_users(db)
        print(f"  → {n_users} new user(s) inserted")

        print("Seeding sample clients…")
        n_clients = seed_clients(db)
        print(f"  → {n_clients} new client(s) inserted")
    finally:
        db.close()

    print("\nDone. Test identities are ready to be claimed via /signup.")
    print("See README → 'System Operations & Testing Guide' for usage.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
