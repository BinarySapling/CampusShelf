"""
Seed script – inserts test librarians and students into CampusShelf MongoDB.
Run once:  python seed_test_data.py
"""

import os, secrets
from datetime import datetime, timezone
from dotenv import load_dotenv
from pymongo import MongoClient
from pymongo.errors import DuplicateKeyError
from werkzeug.security import generate_password_hash

load_dotenv()

MONGO_URI = os.getenv("MONGO_URI", "").strip()
DB_NAME = os.getenv("DB_NAME", "campusshelf")

if not MONGO_URI:
    raise SystemExit("MONGO_URI is not set in .env")

client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
client.admin.command("ping")
db = client[DB_NAME]

print("✓ Connected to MongoDB\n")
now = datetime.now(timezone.utc)


# ── helpers ────────────────────────────────────────────────────────────

def gen_id(prefix, collection, field, uppercase=True):
    for _ in range(20):
        candidate = f"{prefix}-{secrets.token_hex(5)}"
        candidate = candidate.upper() if uppercase else candidate.lower()
        if not collection.find_one({field: candidate}, {"_id": 1}):
            return candidate
    raise RuntimeError("Could not generate unique ID")


# ── Librarians ─────────────────────────────────────────────────────────

LIBRARIANS = [
    {"name": "Admin Librarian",   "password": "admin1234567"},
    {"name": "Staff Librarian",   "password": "staff1234567"},
]

print("─── Librarians ────────────────────────────────")
for lib in LIBRARIANS:
    login_id = gen_id("LIB", db.librarians, "login_id", uppercase=False)
    try:
        db.librarians.insert_one({
            "login_id":      login_id,
            "name":          lib["name"],
            "password_hash": generate_password_hash(lib["password"]),
            "active":        True,
            "created_at":    now,
        })
        print(f"  ✓ {lib['name']}")
        print(f"    Login ID : {login_id.upper()}")
        print(f"    Password : {lib['password']}")
        print()
    except DuplicateKeyError:
        print(f"  ⚠ Skipped {lib['name']} (duplicate)\n")


# ── Students ───────────────────────────────────────────────────────────

STUDENTS = [
    {"name": "Priya Patel",     "email": "priya@campus.edu",     "course": "CSE",       "year": 2, "password": "priya1234567"},
    {"name": "Rohan Verma",     "email": "rohan@campus.edu",     "course": "ECE",       "year": 3, "password": "rohan1234567"},
    {"name": "Sneha Gupta",     "email": "sneha@campus.edu",     "course": "IT",        "year": 1, "password": "sneha1234567"},
    {"name": "Arjun Reddy",     "email": "arjun@campus.edu",     "course": "Mech",      "year": 4, "password": "arjun1234567"},
    {"name": "Divya Nair",      "email": "divya@campus.edu",     "course": "Design",    "year": 2, "password": "divya1234567"},
]

print("─── Students ──────────────────────────────────")
for stu in STUDENTS:
    student_id = gen_id("STU", db.members, "student_id")
    try:
        db.members.insert_one({
            "student_id":    student_id,
            "name":          stu["name"],
            "email":         stu["email"],
            "password_hash": generate_password_hash(stu["password"]),
            "course":        stu["course"],
            "year":          stu["year"],
            "joined_at":     now,
        })
        print(f"  ✓ {stu['name']}")
        print(f"    Student ID : {student_id}")
        print(f"    Email      : {stu['email']}")
        print(f"    Password   : {stu['password']}")
        print()
    except DuplicateKeyError:
        print(f"  ⚠ Skipped {stu['name']} (duplicate email)\n")


print("─── Summary ───────────────────────────────────")
print(f"  Librarians in DB : {db.librarians.count_documents({})}")
print(f"  Students in DB   : {db.members.count_documents({})}")
print(f"  Books in DB      : {db.books.count_documents({})}")
print("\nDone! Use the credentials above to log in.")
