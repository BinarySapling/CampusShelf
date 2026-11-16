import os
import secrets
from datetime import datetime, timezone, timedelta
import re
from flask import Flask, render_template, request, redirect, url_for, flash, jsonify, abort, session, g
from pymongo import MongoClient, ASCENDING, DESCENDING, ReturnDocument
from pymongo.errors import PyMongoError, DuplicateKeyError
from bson import ObjectId
from dotenv import load_dotenv
from werkzeug.security import check_password_hash, generate_password_hash

load_dotenv()
app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY") or secrets.token_hex(32)
app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax")
MONGO_URI = os.getenv("MONGO_URI", "").strip()
DB_NAME = os.getenv("DB_NAME", "campusshelf")

client = None
db = None
connection_error = None

def connect_db():
    global client, db, connection_error
    if not MONGO_URI:
        connection_error = "MongoDB URI missing. Add your MongoDB Atlas URI to the .env file."
        return
    try:
        client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
        client.admin.command("ping")
        db = client[DB_NAME]
        migrate_legacy_data()
        create_indexes()
        seed_if_empty()
        ensure_student_ids()
        ensure_book_copies()
        connection_error = None
    except Exception:
        # Driver exceptions can include the full URI, so keep connection details
        # out of page HTML and the public health endpoint.
        connection_error = (
            "Could not reach MongoDB. Check the Atlas connection string, "
            "database user, and Network Access allowlist."
        )
        db = None

def create_validators():
    # MongoDB-side schema validation complements the checks in Flask forms.
    validators = {
        "books": {"$jsonSchema": {"bsonType": "object", "required": ["title", "author", "category", "copies", "available"], "properties": {
            "title": {"bsonType": "string", "minLength": 1},
            "author": {"bsonType": "string", "minLength": 1},
            "category": {"bsonType": "string", "minLength": 1},
            "copies": {"bsonType": ["int", "long"], "minimum": 0},
            "available": {"bsonType": "bool"},
            "isbn": {"bsonType": "string"},
            "total_copies": {"bsonType": ["int", "long"], "minimum": 0}
        }}},
        "members": {"$jsonSchema": {"bsonType": "object", "required": ["name", "email", "course", "year"], "properties": {
            "name": {"bsonType": "string", "minLength": 1},
            "email": {"bsonType": "string", "pattern": r"^.+@.+\..+$"},
            "student_id": {"bsonType": "string", "minLength": 8, "maxLength": 32},
            "password_hash": {"bsonType": "string", "minLength": 1},
            "course": {"bsonType": "string", "minLength": 1},
            "year": {"bsonType": ["int", "long"], "minimum": 1, "maximum": 6}
        }}},
        "borrowings": {"$jsonSchema": {"bsonType": "object", "required": ["book_id", "book_title", "member_id", "member_name", "status", "borrowed_at", "due_at", "issue_code"], "properties": {
            "book_id": {"bsonType": "objectId"},
            "member_id": {"bsonType": "objectId"},
            "member_student_id": {"bsonType": "string"},
            "issue_code": {"bsonType": "string", "minLength": 1},
            "status": {"enum": ["borrowed", "returned"]},
            "borrowed_at": {"bsonType": "date"},
            "due_at": {"bsonType": "date"}
        }}},
        "reviews": {"$jsonSchema": {"bsonType": "object", "required": ["book_id", "book_title", "member_id", "member_name", "rating", "comment"], "properties": {
            "book_id": {"bsonType": "objectId"},
            "member_id": {"bsonType": "objectId"},
            "rating": {"bsonType": ["int", "long"], "minimum": 1, "maximum": 5},
            "comment": {"bsonType": "string", "minLength": 1}
        }}},
        "librarians": {"$jsonSchema": {"bsonType": "object", "required": ["login_id", "name", "password_hash", "active", "created_at"], "properties": {
            "login_id": {"bsonType": "string", "minLength": 3, "maxLength": 32},
            "name": {"bsonType": "string", "minLength": 1, "maxLength": 80},
            "password_hash": {"bsonType": "string", "minLength": 1},
            "active": {"bsonType": "bool"},
            "created_at": {"bsonType": "date"}
        }}},
        "book_copies": {"$jsonSchema": {"bsonType": "object", "required": ["copy_id", "book_id", "book_title", "status", "created_at"], "properties": {
            "copy_id": {"bsonType": "string", "minLength": 8},
            "book_id": {"bsonType": "objectId"},
            "book_title": {"bsonType": "string", "minLength": 1},
            "status": {"enum": ["available", "borrowed"]},
            "shelf": {"bsonType": "string"},
            "current_issue_code": {"bsonType": "string"},
            "current_member_id": {"bsonType": "objectId"},
            "created_at": {"bsonType": "date"}
        }}}
    }
    existing = set(db.list_collection_names())
    for name, validator in validators.items():
        if name not in existing:
            db.create_collection(name, validator=validator, validationLevel="moderate")
        else:
            db.command("collMod", name, validator=validator, validationLevel="moderate")

def issue_code_for(record_id):
    return f"CS-{str(record_id).upper()}"

def generated_library_id(prefix, collection, field, uppercase=True):
    """Build a short human-friendly ID and avoid IDs already stored in MongoDB."""
    for _ in range(12):
        candidate = f"{prefix}-{secrets.token_hex(5)}"
        candidate = candidate.upper() if uppercase else candidate.lower()
        if not collection.find_one({field: candidate}, {"_id": 1}):
            return candidate
    raise RuntimeError("Could not generate a unique library ID. Please retry.")

def ensure_student_ids():
    """Backfill generated student IDs and keep a student-ID snapshot on old slips."""
    for member in db.members.find({"$or": [{"student_id": {"$exists": False}}, {"student_id": ""}]}, {"_id": 1}):
        for _ in range(12):
            student_id = generated_library_id("STU", db.members, "student_id")
            try:
                result = db.members.update_one(
                    {"_id": member["_id"], "$or": [{"student_id": {"$exists": False}}, {"student_id": ""}]},
                    {"$set": {"student_id": student_id}},
                )
                if result.modified_count:
                    break
            except DuplicateKeyError:
                continue
    for record in db.borrowings.find({"member_student_id": {"$exists": False}}, {"member_id": 1}):
        member = db.members.find_one({"_id": record.get("member_id")}, {"student_id": 1})
        if member and member.get("student_id"):
            db.borrowings.update_one(
                {"_id": record["_id"], "member_student_id": {"$exists": False}},
                {"$set": {"member_student_id": member["student_id"]}},
            )

def migrate_legacy_data():
    """Add inventory totals and stable issue codes to records made by older versions."""
    collections = set(db.list_collection_names())
    active_by_book = {}
    if "borrowings" in collections:
        active_by_book = {
            item["_id"]: item["count"]
            for item in db.borrowings.aggregate([
                {"$match": {"status": "borrowed"}},
                {"$group": {"_id": "$book_id", "count": {"$sum": 1}}}
            ])
        }
    if "books" in collections:
        for book in db.books.find({"total_copies": {"$exists": False}}, {"copies": 1}):
            total = int(book.get("copies", 0)) + active_by_book.get(book["_id"], 0)
            db.books.update_one({"_id": book["_id"]}, {"$set": {"total_copies": total}})

    if "borrowings" in collections:
        for record in db.borrowings.find():
            snapshot = {}
            if not record.get("issue_code"):
                snapshot["issue_code"] = issue_code_for(record["_id"])
            if record.get("member_id") and not record.get("member_email"):
                member = db.members.find_one({"_id": record["member_id"]}) if "members" in collections else None
                if member:
                    snapshot.update({
                        "member_email":member.get("email", ""),
                        "member_course":member.get("course", ""),
                        "member_year":member.get("year"),
                    })
            if record.get("book_id") and (not record.get("book_shelf") or not record.get("book_category")):
                book = db.books.find_one({"_id": record["book_id"]}) if "books" in collections else None
                if book:
                    snapshot.update({"book_author":book.get("author", ""), "book_shelf":book.get("shelf", "Unassigned"), "book_category":book.get("category", "")})
            if snapshot:
                db.borrowings.update_one({"_id":record["_id"]}, {"$set":snapshot})

def create_indexes():
    create_validators()
    # Useful indexes for common filters, sorting and unique identifiers.
    db.books.create_index([("title", ASCENDING)])
    db.books.create_index([("category", ASCENDING), ("available", DESCENDING)])
    db.books.create_index(
        [("title", "text"), ("author", "text"), ("category", "text"), ("isbn", "text"), ("description", "text")],
        name="books_search_text",
    )
    db.books.create_index([("isbn", ASCENDING)], unique=True, partialFilterExpression={"isbn": {"$type": "string"}})
    db.members.create_index([("email", ASCENDING)], unique=True)
    db.members.create_index([("student_id", ASCENDING)], unique=True, partialFilterExpression={"student_id": {"$type": "string"}}, name="student_id_unique")
    db.members.create_index([("name", "text"), ("email", "text"), ("course", "text")], name="members_search_text")
    db.borrowings.create_index([("member_id", ASCENDING), ("status", ASCENDING)])
    db.borrowings.create_index([("member_student_id", ASCENDING), ("borrowed_at", DESCENDING)], name="borrowings_student_id")
    db.borrowings.create_index([("borrowed_at", DESCENDING)])
    db.borrowings.create_index([("status", ASCENDING), ("due_at", ASCENDING)], name="loans_due_status")
    db.borrowings.create_index([("returned_at", ASCENDING)], name="loans_returned_at")
    db.borrowings.create_index([("issue_code", ASCENDING)], unique=True, name="issue_code_unique")
    db.borrowings.create_index([("book_title", "text"), ("book_author", "text"), ("member_name", "text"), ("member_email", "text")], name="borrowings_register_text")
    db.reviews.create_index([("book_id", ASCENDING), ("rating", DESCENDING)])
    db.librarians.create_index([("login_id", ASCENDING)], unique=True, name="librarian_login_id_unique")
    db.book_copies.create_index([("copy_id", ASCENDING)], unique=True, name="book_copy_id_unique")
    db.book_copies.create_index([("book_id", ASCENDING), ("status", ASCENDING)], name="book_copy_stock_lookup")
    db.book_copies.create_index([("status", ASCENDING)], name="book_copy_status")

def seed_if_empty():
    if db.books.count_documents({}) == 0:
        books = [
            {"title":"Atomic Habits","author":"James Clear","category":"Self Growth","isbn":"9780735211292","available":True,"copies":4,"total_copies":4,"shelf":"A-01","description":"Tiny systems, remarkable change.","created_at":datetime.now(timezone.utc)},
            {"title":"Clean Code","author":"Robert C. Martin","category":"Technology","isbn":"9780132350884","available":True,"copies":2,"total_copies":2,"shelf":"T-04","description":"A practical guide to readable software.","created_at":datetime.now(timezone.utc)},
            {"title":"The Alchemist","author":"Paulo Coelho","category":"Fiction","isbn":"9780061122415","available":True,"copies":3,"total_copies":3,"shelf":"F-02","description":"A journey toward purpose and possibility.","created_at":datetime.now(timezone.utc)},
            {"title":"Deep Work","author":"Cal Newport","category":"Productivity","isbn":"9781455586691","available":True,"copies":2,"total_copies":2,"shelf":"P-03","description":"Build focus in a distracted world.","created_at":datetime.now(timezone.utc)},
            {"title":"Design of Everyday Things","author":"Don Norman","category":"Design","isbn":"9780465050659","available":True,"copies":1,"total_copies":1,"shelf":"D-01","description":"Understand the design behind everyday objects.","created_at":datetime.now(timezone.utc)}
        ]
        db.books.insert_many(books)
    if db.members.count_documents({}) == 0:
        db.members.insert_many([
            {"name":"Aarav Sharma","email":"aarav@campus.edu","course":"CSE","year":3,"joined_at":datetime.now(timezone.utc)},
            {"name":"Meera Kapoor","email":"meera@campus.edu","course":"Design","year":2,"joined_at":datetime.now(timezone.utc)},
            {"name":"Kabir Singh","email":"kabir@campus.edu","course":"ECE","year":3,"joined_at":datetime.now(timezone.utc)}
        ])
    if db.borrowings.count_documents({}) == 0:
        books = list(db.books.find().limit(3))
        members = list(db.members.find().limit(3))
        if books and members:
            now = datetime.now(timezone.utc)
            sample_records = []
            for book, member, status, borrowed_days, due_days, returned_days in [
                (books[0], members[0], "returned", 18, -4, 5),
                (books[1], members[1], "borrowed", 2, 12, None),
                (books[2], members[2], "borrowed", 1, 13, None),
            ]:
                record_id = ObjectId()
                sample_records.append({
                    "_id": record_id, "issue_code": issue_code_for(record_id),
                    "book_id":book["_id"], "book_title":book["title"],
                    "member_id":member["_id"], "member_name":member["name"],
                    "member_email":member["email"], "member_course":member["course"], "member_year":member["year"],
                    "book_author":book.get("author", ""), "book_shelf":book.get("shelf", "Unassigned"), "book_category":book.get("category", ""),
                    "status":status, "borrowed_at":now-timedelta(days=borrowed_days),
                    "due_at":now+timedelta(days=due_days),
                    "returned_at":now-timedelta(days=returned_days) if returned_days is not None else None,
                })
            db.borrowings.insert_many(sample_records)
            # Reflect the two active sample loans in the inventory count.
            for borrowed_book in books[1:3]:
                db.books.update_one(
                    {"_id": borrowed_book["_id"], "copies": {"$gt": 0}},
                    {"$inc": {"copies": -1}}
                )
                refreshed = db.books.find_one({"_id": borrowed_book["_id"]})
                db.books.update_one(
                    {"_id": borrowed_book["_id"]},
                    {"$set": {"available": bool(refreshed and refreshed.get("copies", 0) > 0)}}
                )
    if db.reviews.count_documents({}) == 0:
        book = db.books.find_one({"title":"Atomic Habits"})
        member = db.members.find_one({"name":"Aarav Sharma"})
        if book and member:
            db.reviews.insert_one({"book_id":book["_id"],"book_title":book["title"],"member_id":member["_id"],"member_name":member["name"],"rating":5,"comment":"Clear, practical and easy to revisit.","created_at":datetime.now(timezone.utc)})

def copy_code_for(copy_oid):
    return f"CSB-{str(copy_oid).upper()}"

def ensure_book_copies():
    """Backfill one stable, printable copy ID for each physical book in stock."""
    books = list(db.books.find({}, {"title": 1, "shelf": 1, "copies": 1, "total_copies": 1}))
    for book in books:
        copies = list(db.book_copies.find({"book_id": book["_id"]}).sort("created_at", ASCENDING))
        if not copies:
            total = max(int(book.get("total_copies", 0)), int(book.get("copies", 0)))
            active_loans = list(db.borrowings.find(
                {"book_id": book["_id"], "status": "borrowed"},
                {"issue_code": 1, "member_id": 1, "borrowed_at": 1},
            ).sort("borrowed_at", ASCENDING))
            active_loans = active_loans[:total]
            loan_by_issue = {loan.get("issue_code"): loan for loan in active_loans}
            new_copies = []
            for index in range(total):
                copy_oid = ObjectId()
                loan = active_loans[index] if index < len(active_loans) else None
                row = {
                    "_id": copy_oid, "copy_id": copy_code_for(copy_oid),
                    "book_id": book["_id"], "book_title": book.get("title", "Untitled"),
                    "shelf": book.get("shelf", "Unassigned"),
                    "status": "borrowed" if loan else "available",
                    "created_at": datetime.now(timezone.utc),
                }
                if loan:
                    row.update({"current_issue_code": loan.get("issue_code", ""), "current_member_id": loan.get("member_id")})
                new_copies.append(row)
            if new_copies:
                db.book_copies.insert_many(new_copies)
                copies = new_copies
                for loan, copy_doc in zip(active_loans, copies):
                    if loan.get("issue_code"):
                        db.borrowings.update_one(
                            {"issue_code": loan["issue_code"], "copy_id": {"$exists": False}},
                            {"$set": {"copy_id": copy_doc["copy_id"], "book_copy_id": copy_doc["_id"]}},
                        )
        # Attach older active issues to an unlinked borrowed copy when possible.
        for loan in db.borrowings.find({"book_id": book["_id"], "status": "borrowed", "copy_id": {"$exists": False}}):
            copy_doc = db.book_copies.find_one_and_update(
                {"book_id": book["_id"], "status": "borrowed", "current_issue_code": {"$exists": False}},
                {"$set": {"current_issue_code": loan.get("issue_code", ""), "current_member_id": loan.get("member_id")}},
                return_document=ReturnDocument.AFTER,
            )
            if copy_doc:
                db.borrowings.update_one(
                    {"_id": loan["_id"], "copy_id": {"$exists": False}},
                    {"$set": {"copy_id": copy_doc["copy_id"], "book_copy_id": copy_doc["_id"]}},
                )

def ready():
    # Startup attempts the connection once. Do not repeat a slow network timeout on
    # every request when the URI is missing or invalid; restart after fixing .env.
    return db is not None

def reserve_book_copy(book_id, member_id, issue_code, now, copy_id=None):
    copy_query = {"book_id": book_id, "status": "available"}
    if copy_id:
        copy_query["copy_id"] = copy_id
    return db.book_copies.find_one_and_update(
        copy_query,
        {"$set": {
            "status": "borrowed", "current_issue_code": issue_code,
            "current_member_id": member_id, "issued_at": now,
        }},
        sort=[("created_at", ASCENDING)],
        return_document=ReturnDocument.AFTER,
    )

def release_book_copy(record):
    if record.get("copy_id"):
        db.book_copies.update_one(
            {"copy_id": record["copy_id"], "status": "borrowed", "current_issue_code": record.get("issue_code")},
            {"$set": {"status": "available"}, "$unset": {
                "current_issue_code": "", "current_member_id": "", "issued_at": "",
            }},
        )

@app.route("/student")
def student_portal():
    sample = []
    if ready():
        sample = list(db.books.find().sort("title", ASCENDING).limit(6))
        counts = list(db.book_copies.aggregate([
            {"$match": {"book_id": {"$in": [book["_id"] for book in sample]}}},
            {"$group": {"_id": "$book_id", "available": {"$sum": {"$cond": [{"$eq": ["$status", "available"]}, 1, 0]}}, "total": {"$sum": 1}}},
        ]))
        count_map = {row["_id"]: row for row in counts}
        for book in sample:
            row = count_map.get(book["_id"], {})
            book["available_copies"] = row.get("available", 0)
            book["inventory_total"] = row.get("total", 0)
    featured_books = [{
        "id": str(book["_id"]), "title": book.get("title", "Untitled"),
        "author": book.get("author", ""), "category": book.get("category", ""),
        "description": book.get("description", ""), "shelf": book.get("shelf", "Unassigned"),
        "available": book.get("available_copies", 0), "total": book.get("inventory_total", 0),
    } for book in sample]
    return render_template("student_portal.html", books=featured_books, error=connection_error)

@app.route("/student/search")
def student_book_search():
    if not ready():
        return jsonify(error="Library catalogue is temporarily unavailable."), 503
    query = request.args.get("q", "").strip()
    terms = " ".join(re.findall(r"[A-Za-z0-9]+", query))
    if len(query) < 2 or not terms:
        return jsonify(results=[])
    matches = []
    try:
        matches = list(db.books.find(
            {"$text": {"$search": terms}}, {"score": {"$meta": "textScore"}}
        ).sort([("score", {"$meta": "textScore"}), ("title", ASCENDING)]).limit(10))
    except PyMongoError:
        pass
    if not matches:
        pattern = re.escape(query)
        matches = list(db.books.find({"$or": [
            {"title": {"$regex": pattern, "$options": "i"}},
            {"author": {"$regex": pattern, "$options": "i"}},
            {"category": {"$regex": pattern, "$options": "i"}},
            {"isbn": {"$regex": pattern, "$options": "i"}},
            {"description": {"$regex": pattern, "$options": "i"}},
        ]}).sort("title", ASCENDING).limit(10))
    book_ids = [book["_id"] for book in matches]
    copy_counts = list(db.book_copies.aggregate([
        {"$match": {"book_id": {"$in": book_ids}}},
        {"$group": {"_id": "$book_id", "available": {"$sum": {"$cond": [{"$eq": ["$status", "available"]}, 1, 0]}}, "total": {"$sum": 1}}},
    ])) if book_ids else []
    count_map = {row["_id"]: row for row in copy_counts}
    return jsonify(results=[{
        "id": str(book["_id"]), "title": book.get("title", "Untitled"),
        "author": book.get("author", ""), "category": book.get("category", ""),
        "description": book.get("description", ""), "isbn": book.get("isbn", ""),
        "shelf": book.get("shelf", "Unassigned"),
        "available": count_map.get(book["_id"], {}).get("available", 0),
        "total": count_map.get(book["_id"], {}).get("total", 0),
    } for book in matches])

@app.route("/student/issue", methods=["POST"])
def student_issue():
    if not ready():
        flash("The library is temporarily unavailable. Please try again shortly.", "error")
        return redirect(url_for("student_portal"))
    student_id = request.form.get("student_id", "").strip().upper()
    email = request.form.get("email", "").strip().casefold()
    password = request.form.get("password", "")
    copy_id = request.form.get("copy_id", "").strip().upper()
    book_oid = oid(request.form.get("book_id", ""))
    member = db.members.find_one({"student_id": student_id}) if student_id else None

    password_matches = False
    if member and member.get("password_hash"):
        try:
            password_matches = check_password_hash(member["password_hash"], password)
        except (TypeError, ValueError):
            password_matches = False
    if (not member or email != member.get("email", "").strip().casefold() or not password_matches):
        flash("Student ID, registered campus email, or password did not match. Ask a librarian to set or reset portal access if needed.", "error")
        return redirect(url_for("student_portal"))

    copy_doc = db.book_copies.find_one({"copy_id": copy_id, "status": "available"}) if copy_id else None
    book = db.books.find_one({"_id": book_oid}) if book_oid else None
    if not copy_doc:
        flash("That copy ID was not found on the shelf. Check the ID printed inside the book.", "error")
        return redirect(url_for("student_portal"))
    if not book or copy_doc.get("book_id") != book["_id"]:
        flash("Choose the matching title from search before entering its copy ID.", "error")
        return redirect(url_for("student_portal"))
    if db.borrowings.count_documents({"member_id": member["_id"], "status": "borrowed"}) >= 5:
        flash("This student has reached the five active book limit. Please visit the librarian desk.", "error")
        return redirect(url_for("student_portal"))

    now = datetime.now(timezone.utc)
    record_id = ObjectId()
    new_issue_code = issue_code_for(record_id)
    reserved_copy = db.book_copies.find_one_and_update(
        {"_id": copy_doc["_id"], "status": "available"},
        {"$set": {"status": "borrowed", "current_issue_code": new_issue_code,
                  "current_member_id": member["_id"], "issued_at": now}},
        return_document=ReturnDocument.AFTER,
    )
    if not reserved_copy:
        flash("That copy was just checked out. Search again for another available copy.", "error")
        return redirect(url_for("student_portal"))
    stock_update = db.books.update_one({"_id": book["_id"], "copies": {"$gt": 0}}, {"$inc": {"copies": -1}})
    if stock_update.modified_count != 1:
        release_book_copy({"copy_id": copy_id, "issue_code": new_issue_code})
        flash("No copies of this title are currently available on the shelf.", "error")
        return redirect(url_for("student_portal"))
    refreshed_book = db.books.find_one({"_id": book["_id"]})
    db.books.update_one({"_id": book["_id"]}, {"$set": {"available": bool(refreshed_book and refreshed_book.get("copies", 0) > 0)}})
    try:
        db.borrowings.insert_one({
            "_id": record_id, "issue_code": new_issue_code,
            "book_id": book["_id"], "book_copy_id": reserved_copy["_id"], "copy_id": copy_id,
            "book_title": book["title"], "book_author": book.get("author", ""),
            "book_shelf": copy_doc.get("shelf", book.get("shelf", "Unassigned")),
            "book_category": book.get("category", ""),
            "member_id": member["_id"], "member_name": member["name"],
            "member_student_id": member["student_id"],
            "member_email": member["email"], "member_course": member.get("course", ""),
            "member_year": member.get("year"), "status": "borrowed",
            "borrowed_at": now, "due_at": now + timedelta(days=14), "returned_at": None,
            "checkout_method": "student_portal",
        })
    except PyMongoError:
        release_book_copy({"copy_id": copy_id, "issue_code": new_issue_code})
        db.books.update_one({"_id": book["_id"]}, {"$inc": {"copies": 1}})
        restored = db.books.find_one({"_id": book["_id"]})
        if restored:
            db.books.update_one({"_id": book["_id"]}, {"$set": {"available": restored.get("copies", 0) > 0}})
        flash("Checkout could not be saved. Inventory was restored; please try again.", "error")
        return redirect(url_for("student_portal"))

    allowed_slips = session.get("student_issue_codes", [])
    allowed_slips.append(new_issue_code)
    session["student_issue_codes"] = allowed_slips[-5:]
    return redirect(url_for("student_slip", issue_code=new_issue_code))

@app.route("/student/slip/<issue_code>")
def student_slip(issue_code):
    normalized_code = issue_code.strip().upper()
    if normalized_code not in session.get("student_issue_codes", []):
        abort(404)
    record = db.borrowings.find_one({"issue_code": normalized_code}) if ready() else None
    if not record:
        abort(404)
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    record["is_overdue"] = record["status"] == "borrowed" and record.get("due_at") and record["due_at"] < now
    record["overdue_days"] = max(1, (now - record["due_at"]).days) if record["is_overdue"] else 0
    return render_template("student_slip.html", record=record, error=None)

@app.context_processor
def inject_mongodb_status():
    return {
        "mongo_configured": bool(MONGO_URI),
        "current_librarian": getattr(g, "current_librarian", None),
    }

PUBLIC_ENDPOINTS = {"static", "login", "setup_librarian", "logout", "health", "student_portal", "student_book_search", "student_issue", "student_slip"}

@app.before_request
def require_librarian_session():
    if request.endpoint in PUBLIC_ENDPOINTS or request.endpoint is None:
        return
    if not ready():
        return redirect(url_for("login"))

    if db.librarians.count_documents({}) == 0:
        return redirect(url_for("setup_librarian"))

    librarian_id = oid(session.get("librarian_id"))
    librarian = db.librarians.find_one(
        {"_id": librarian_id, "active": True},
        {"login_id": 1, "name": 1},
    ) if librarian_id else None
    if librarian is None:
        session.clear()
        return redirect(url_for("login", next=request.path))
    g.current_librarian = librarian

@app.route("/login", methods=["GET", "POST"])
def login():
    if not ready():
        return render_template("login.html", error=connection_error, setup=False)
    if db.librarians.count_documents({}) == 0:
        return redirect(url_for("setup_librarian"))
    if session.get("librarian_id"):
        librarian_id = oid(session.get("librarian_id"))
        if librarian_id and db.librarians.find_one({"_id": librarian_id, "active": True}, {"_id": 1}):
            return redirect(url_for("dashboard"))
        session.clear()

    if request.method == "POST":
        login_id = request.form.get("login_id", "").strip().casefold()
        password = request.form.get("password", "")
        librarian = db.librarians.find_one({"login_id": login_id, "active": True})
        if librarian and check_password_hash(librarian["password_hash"], password):
            session.clear()
            session["librarian_id"] = str(librarian["_id"])
            return redirect(url_for("dashboard"))
        flash("That librarian ID and password did not match an active account.", "error")
    return render_template("login.html", error=None, setup=False)

@app.route("/setup", methods=["GET", "POST"])
def setup_librarian():
    if not ready():
        return render_template("login.html", error=connection_error, setup=True)
    if db.librarians.count_documents({}) > 0:
        return redirect(url_for("login"))

    if request.method == "POST":
        name = request.form.get("name", "").strip()
        password = request.form.get("password", "")
        if not name or len(name) > 80:
            flash("Enter a librarian name between 1 and 80 characters.", "error")
        elif len(password) < 10:
            flash("Choose a password with at least 10 characters.", "error")
        else:
            try:
                login_id = generated_library_id("LIB", db.librarians, "login_id", uppercase=False)
                result = db.librarians.insert_one({
                    "login_id": login_id,
                    "name": name,
                    "password_hash": generate_password_hash(password),
                    "active": True,
                    "created_at": datetime.now(timezone.utc),
                })
                session.clear()
                session["librarian_id"] = str(result.inserted_id)
                flash(f"Your librarian ID is {login_id.upper()}. Keep it for future sign-ins.", "success")
                return redirect(url_for("dashboard"))
            except DuplicateKeyError:
                flash("A generated librarian ID collided. Please submit once more to retry.", "error")
    return render_template("login.html", error=None, setup=True)

@app.route("/logout", methods=["POST"])
def logout():
    session.clear()
    flash("You have signed out.", "success")
    return redirect(url_for("login"))

@app.route("/librarians", methods=["GET", "POST"])
def librarians():
    if request.method == "POST":
        name = request.form.get("name", "").strip()
        password = request.form.get("password", "")
        if not name or len(name) > 80:
            flash("Enter a librarian name between 1 and 80 characters.", "error")
        elif len(password) < 10:
            flash("Choose a password with at least 10 characters.", "error")
        else:
            try:
                login_id = generated_library_id("LIB", db.librarians, "login_id", uppercase=False)
                db.librarians.insert_one({
                    "login_id": login_id,
                    "name": name,
                    "password_hash": generate_password_hash(password),
                    "active": True,
                    "created_at": datetime.now(timezone.utc),
                })
                flash(f"Librarian ID {login_id.upper()} created. Share it with the new librarian.", "success")
                return redirect(url_for("librarians"))
            except DuplicateKeyError:
                flash("A generated librarian ID collided. Please submit once more to retry.", "error")
    staff = list(db.librarians.find({}, {"password_hash": 0}).sort([("active", DESCENDING), ("name", ASCENDING)]))
    return render_template("librarians.html", librarians=staff, active="librarians", error=None)

@app.route("/librarians/<librarian_id>/deactivate", methods=["POST"])
def deactivate_librarian(librarian_id):
    target_id = oid(librarian_id)
    if not target_id:
        abort(404)
    if str(target_id) == session.get("librarian_id"):
        flash("You cannot disable the ID you are currently signed in with.", "error")
    elif db.librarians.count_documents({"active": True}) <= 1:
        flash("Keep at least one active librarian ID.", "error")
    else:
        result = db.librarians.update_one({"_id": target_id, "active": True}, {"$set": {"active": False}})
        flash("Librarian ID disabled." if result.modified_count else "That ID is already disabled.", "success")
    return redirect(url_for("librarians"))

def oid(value):
    try:
        return ObjectId(value)
    except Exception:
        return None

@app.template_filter("datefmt")
def datefmt(value):
    return value.strftime("%d %b %Y") if value else "—"

PIE_COLORS = ["#7464dd", "#76c6a3", "#efa681", "#7da9df", "#d5b954", "#bd81ad", "#7b8db3", "#54b7b4"]

def donut_stops(values, colors=None):
    colors = colors or PIE_COLORS
    normalized = [max(0, int(value or 0)) for value in values]
    total = sum(normalized)
    if not total:
        return "#e9e6f1 0% 100%"
    stops = []
    edge = 0.0
    for index, value in enumerate(normalized):
        if not value:
            continue
        next_edge = edge + (100 * value / total)
        stops.append(f"{colors[index % len(colors)]} {edge:.2f}% {next_edge:.2f}%")
        edge = next_edge
    return ", ".join(stops)

@app.route("/")
def dashboard():
    ready()
    stats = {"books":0,"total_copies":0,"available_copies":0,"members":0,"active":0,"overdue":0,"on_time":0,"reviews":0,"categories":0,"courses":0}
    category_data = []
    course_data = []
    popular = []
    recent = []
    overdue_records = []
    circulation = []
    if db is not None:
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        stats = {
            "books": db.books.count_documents({}),
            "members": db.members.count_documents({}),
            "active": db.borrowings.count_documents({"status":"borrowed"}),
            "overdue": db.borrowings.count_documents({"status":"borrowed", "due_at":{"$lt":now}}),
            "reviews": db.reviews.count_documents({})
        }
        category_data = list(db.books.aggregate([
            {"$group":{
                "_id":"$category", "titles":{"$sum":1},
                "total_copies":{"$sum":{"$ifNull":["$total_copies", "$copies"]}},
                "available_copies":{"$sum":"$copies"}
            }},
            {"$sort":{"total_copies":-1}}
        ]))
        for index, category in enumerate(category_data):
            category["on_loan"] = max(0, category["total_copies"] - category["available_copies"])
            category["available_pct"] = round(100 * category["available_copies"] / max(category["total_copies"], 1))
            category["color"] = PIE_COLORS[index % len(PIE_COLORS)]
        inventory_totals = list(db.books.aggregate([{"$group":{
            "_id":None,
            "total":{"$sum":{"$ifNull":["$total_copies", "$copies"]}},
            "available":{"$sum":"$copies"}
        }}]))
        if inventory_totals:
            stats["total_copies"] = inventory_totals[0]["total"]
            stats["available_copies"] = inventory_totals[0]["available"]
        stats["on_loan"] = max(0, stats["total_copies"] - stats["available_copies"])
        stats["on_time"] = max(0, stats["active"] - stats["overdue"])
        stats["available_pct"] = round(100 * stats["available_copies"] / max(stats["total_copies"], 1))
        stats["on_loan_pct"] = round(100 * stats["on_loan"] / max(stats["total_copies"], 1))
        stats["overdue_pct"] = round(100 * stats["overdue"] / max(stats["active"], 1))
        stats["categories"] = len(category_data)
        course_data = list(db.members.aggregate([
            {"$group":{"_id":"$course", "members":{"$sum":1}}},
            {"$sort":{"members":-1}}
        ]))
        for index, course in enumerate(course_data):
            course["color"] = PIE_COLORS[index % len(PIE_COLORS)]
        stats["courses"] = len(course_data)
        stats["books_pie"] = donut_stops([item["titles"] for item in category_data])
        stats["shelf_pie"] = donut_stops([stats["available_copies"], stats["on_loan"]], ["#76c6a3", "#7464dd"])
        stats["loan_pie"] = donut_stops([stats["on_loan"], stats["available_copies"]], ["#7464dd", "#76c6a3"])
        stats["overdue_pie"] = donut_stops([stats["overdue"], stats["on_time"]], ["#efa681", "#76c6a3"])
        stats["students_pie"] = donut_stops([item["members"] for item in course_data])
        popular = list(db.borrowings.aggregate([
            {"$group":{"_id":"$book_title","borrow_count":{"$sum":1}}},
            {"$sort":{"borrow_count":-1}}, {"$limit":5}
        ]))
        recent = list(db.borrowings.find().sort("borrowed_at",-1).limit(5))
        overdue_records = list(db.borrowings.find(
            {"status":"borrowed", "due_at":{"$lt":now}}
        ).sort("due_at",1).limit(5))
        for record in overdue_records:
            record["overdue_days"] = max(1, (now - record["due_at"]).days)

        month_index = now.year * 12 + now.month - 1
        month_keys = []
        for offset in reversed(range(6)):
            index = month_index - offset
            year, month_zero = divmod(index, 12)
            month = month_zero + 1
            month_keys.append((f"{year:04d}-{month:02d}", f"{datetime(year, month, 1):%b}"))
        start_year, start_month = (month_index - 5) // 12, (month_index - 5) % 12 + 1
        start = datetime(start_year, start_month, 1)
        month_counts = {}
        for field, label in (("borrowed_at", "issues"), ("returned_at", "returns")):
            counts = db.borrowings.aggregate([
                {"$match": {field: {"$gte":start, "$lte":now}}},
                {"$group": {
                    "_id":{"$dateToString":{"format":"%Y-%m", "date":f"${field}", "timezone":"UTC"}},
                    "count":{"$sum":1}
                }}
            ])
            month_counts[label] = {item["_id"]:item["count"] for item in counts}
        max_count = max(
            [month_counts["issues"].get(key, 0) for key, _ in month_keys]
            + [month_counts["returns"].get(key, 0) for key, _ in month_keys]
            + [1]
        )
        circulation = [{
            "label":label,
            "issues":month_counts["issues"].get(key, 0),
            "returns":month_counts["returns"].get(key, 0),
            "issues_height":round(100 * month_counts["issues"].get(key, 0) / max_count),
            "returns_height":round(100 * month_counts["returns"].get(key, 0) / max_count),
        } for key, label in month_keys]
    return render_template("dashboard.html", stats=stats, category_data=category_data, course_data=course_data, popular=popular, recent=recent, overdue_records=overdue_records, circulation=circulation, error=connection_error, active="dashboard")

@app.route("/books")
def books():
    if not ready():
        return render_template("books.html", books=[], error=connection_error, active="books")
    q=request.args.get("q","").strip()
    category=request.args.get("category","").strip()
    filt={}
    search_terms = " ".join(re.findall(r"[A-Za-z0-9]+", q))
    if q and search_terms:
        filt["$text"] = {"$search": search_terms}
    elif q:
        filt["_id"] = {"$exists": False}
    if category: filt["category"]=category
    if q and search_terms:
        items=list(db.books.find(filt, {"score":{"$meta":"textScore"}}).sort([("score", {"$meta":"textScore"}), ("title", ASCENDING)]).limit(200))
    else:
        items=list(db.books.find(filt).sort("title",1).limit(200))
    categories=sorted(db.books.distinct("category"))
    return render_template("books.html", books=items, categories=categories, q=q, selected_category=category, error=None, active="books")

@app.route("/books/add", methods=["GET", "POST"])
def add_book():
    if not ready():
        return render_template("add_book.html", error=connection_error, active="add_book")
    if request.method == "POST":
        title=request.form.get("title","").strip()
        author=request.form.get("author","").strip()
        category=request.form.get("category","").strip()
        isbn=request.form.get("isbn","").strip()
        shelf=request.form.get("shelf","").strip()
        description=request.form.get("description","").strip()
        try:
            copies=int(request.form.get("copies","1"))
            if not title or not author or not category or copies < 0:
                raise ValueError("Title, author, category are required and total copies cannot be negative.")
            book_doc = {"title":title,"author":author,"category":category,"available":copies>0,"copies":copies,"total_copies":copies,"shelf":shelf or "Unassigned","description":description,"created_at":datetime.now(timezone.utc)}
            if isbn:
                book_doc["isbn"] = isbn
            result = db.books.insert_one(book_doc)
            book_oid = result.inserted_id
            physical_copies = []
            for _ in range(copies):
                copy_oid = ObjectId()
                physical_copies.append({
                    "_id": copy_oid, "copy_id": copy_code_for(copy_oid), "book_id": book_oid,
                    "book_title": title, "shelf": shelf or "Unassigned", "status": "available",
                    "created_at": datetime.now(timezone.utc),
                })
            if physical_copies:
                db.book_copies.insert_many(physical_copies)
            flash(f"Book added with {copies} unique copy ID{'s' if copies != 1 else ''}.", "success")
            return redirect(url_for("book_copies", book_id=book_oid))
        except DuplicateKeyError:
            flash("That ISBN already exists. Use a unique ISBN.", "error")
        except ValueError as exc:
            flash(str(exc), "error")
        except PyMongoError as exc:
            if "book_oid" in locals():
                db.book_copies.delete_many({"book_id": book_oid})
                db.books.delete_one({"_id": book_oid})
            flash(f"Database error: {exc}", "error")
        return redirect(url_for("books"))
    return render_template("add_book.html", error=None, active="add_book")

@app.route("/books/<book_id>/copies")
def book_copies(book_id):
    book_oid = oid(book_id)
    book = db.books.find_one({"_id": book_oid}) if book_oid and ready() else None
    if not book:
        abort(404)
    copies = list(db.book_copies.find({"book_id": book_oid}).sort("copy_id", ASCENDING))
    for copy_doc in copies:
        issue = db.borrowings.find_one({"issue_code": copy_doc.get("current_issue_code")}, {"member_name": 1}) if copy_doc.get("current_issue_code") else None
        copy_doc["borrower_name"] = issue.get("member_name") if issue else ""
    return render_template("book_copies.html", book=book, copies=copies, active="books", error=None)

@app.route("/books/<book_id>/delete", methods=["POST"])
def delete_book(book_id):
    if ready():
        book_oid=oid(book_id)
        if book_oid:
            active_loans = db.borrowings.count_documents({"book_id": book_oid, "status": "borrowed"})
            if active_loans:
                flash("This book has an active borrowing and cannot be deleted until it is returned.", "error")
            else:
                result = db.books.delete_one({"_id": book_oid})
                if result.deleted_count:
                    db.book_copies.delete_many({"book_id": book_oid})
                flash("Book deleted. Historical borrowing records are retained." if result.deleted_count else "Book not found.", "success" if result.deleted_count else "error")
    return redirect(url_for("books"))

@app.route("/members", methods=["GET","POST"])
def members():
    if not ready():
        return render_template("members.html", members=[], error=connection_error, active="members")
    if request.method == "POST":
        name=request.form.get("name","").strip()
        email=request.form.get("email","").strip().lower()
        course=request.form.get("course","").strip()
        password=request.form.get("password","")
        confirm_password=request.form.get("confirm_password","")
        try:
            year=int(request.form.get("year","1"))
            if not name or not email or "@" not in email or not course or year not in range(1,7):
                raise ValueError("Enter a valid name, email, course and year (1–6).")
            if len(password) < 10:
                raise ValueError("Portal password must be at least 10 characters long.")
            if password != confirm_password:
                raise ValueError("Portal password and confirmation do not match.")
            student_id=generated_library_id("STU", db.members, "student_id")
            db.members.insert_one({"student_id":student_id,"name":name,"email":email,"password_hash":generate_password_hash(password),"course":course,"year":year,"joined_at":datetime.now(timezone.utc)})
            flash(f"Student registered · Student ID {student_id}", "success")
        except DuplicateKeyError:
            if db.members.find_one({"email": email}, {"_id": 1}):
                flash("This student email is already registered.", "error")
            else:
                flash("A generated Student ID collided. Please submit once more to retry.", "error")
        except ValueError as exc:
            flash(str(exc), "error")
        return redirect(url_for("members"))
    items=list(db.members.find({}, {"password_hash": 0}).sort("joined_at",-1).limit(200))
    password_ready_ids={doc["_id"] for doc in db.members.find({"password_hash": {"$type": "string", "$ne": ""}}, {"_id": 1})}
    for item in items:
        item["portal_password_set"] = item["_id"] in password_ready_ids
    return render_template("members.html", members=items, error=None, active="members")

@app.route("/members/<member_id>/portal-password", methods=["POST"])
def reset_member_portal_password(member_id):
    if not ready():
        return redirect(url_for("members"))
    member_oid=oid(member_id)
    member=db.members.find_one({"_id": member_oid}, {"student_id": 1}) if member_oid else None
    if not member:
        abort(404)
    password=request.form.get("password", "")
    confirm_password=request.form.get("confirm_password", "")
    if len(password) < 10:
        flash("Portal password must be at least 10 characters long.", "error")
    elif password != confirm_password:
        flash("Portal password and confirmation do not match.", "error")
    else:
        db.members.update_one({"_id": member_oid}, {"$set": {"password_hash": generate_password_hash(password)}})
        flash(f"Portal password updated for {member['student_id']}. Ask the student to enter their new password privately.", "success")
    return redirect(url_for("members"))

@app.route("/members/<member_id>/delete", methods=["POST"])
def delete_member(member_id):
    if ready():
        member_oid=oid(member_id)
        if member_oid:
            active_loans = db.borrowings.count_documents({"member_id": member_oid, "status": "borrowed"})
            if active_loans:
                flash("This student has an active issue and cannot be removed until the book is returned.", "error")
            else:
                result = db.members.delete_one({"_id": member_oid})
                flash("Student removed. Historical issue slips are retained." if result.deleted_count else "Student not found.", "success" if result.deleted_count else "error")
    return redirect(url_for("members"))

@app.route("/api/books/search")
def search_issue_books():
    if not ready():
        return jsonify(results=[], error=connection_error), 503
    raw = request.args.get("q", "").strip()
    terms = " ".join(re.findall(r"[A-Za-z0-9]+", raw))
    if len(raw) < 2:
        return jsonify(results=[])
    available = {"copies":{"$gt":0}}
    matches = []
    if terms:
        matches = list(db.books.find(
            {**available, "$text":{"$search":terms}},
            {"score":{"$meta":"textScore"}}
        ).sort([("score", {"$meta":"textScore"}), ("title", ASCENDING)]).limit(8))
    if not matches:
        pattern = re.escape(raw)
        matches = list(db.books.find({**available, "$or":[
            {"title":{"$regex":pattern,"$options":"i"}},
            {"author":{"$regex":pattern,"$options":"i"}},
            {"isbn":{"$regex":pattern,"$options":"i"}}
        ]}).sort("title", ASCENDING).limit(8))
    return jsonify(results=[{
        "id":str(book["_id"]), "title":book.get("title", ""), "author":book.get("author", ""),
        "category":book.get("category", ""), "shelf":book.get("shelf", "Unassigned"),
        "isbn":book.get("isbn", ""), "copies":book.get("copies", 0)
    } for book in matches])

@app.route("/api/book-copies/lookup")
def lookup_issue_copy():
    if not ready():
        return jsonify(results=[], error=connection_error), 503
    copy_id = request.args.get("q", "").strip().upper()
    if not copy_id:
        return jsonify(results=[])
    copy_doc = db.book_copies.find_one({"copy_id": copy_id, "status": "available"})
    if not copy_doc:
        return jsonify(results=[])
    book = db.books.find_one({"_id": copy_doc.get("book_id")})
    if not book:
        return jsonify(results=[])
    return jsonify(results=[{
        "book_id": str(book["_id"]), "copy_id": copy_doc["copy_id"],
        "title": book.get("title", "Untitled"), "author": book.get("author", ""),
        "category": book.get("category", ""), "shelf": copy_doc.get("shelf", book.get("shelf", "Unassigned")),
        "copies": book.get("copies", 0),
    }])

@app.route("/api/students/search")
def search_issue_students():
    if not ready():
        return jsonify(results=[], error=connection_error), 503
    raw = request.args.get("q", "").strip()
    terms = " ".join(re.findall(r"[A-Za-z0-9]+", raw))
    if len(raw) < 2:
        return jsonify(results=[])
    matches = []
    exact_id = db.members.find_one({"student_id": raw.upper()}) if raw.upper().startswith("STU-") else None
    if exact_id:
        matches = [exact_id]
    elif terms:
        matches = list(db.members.find(
            {"$text":{"$search":terms}},
            {"score":{"$meta":"textScore"}}
        ).sort([("score", {"$meta":"textScore"}), ("name", ASCENDING)]).limit(8))
    if not matches:
        pattern = re.escape(raw)
        matches = list(db.members.find({"$or":[
            {"name":{"$regex":pattern,"$options":"i"}},
            {"email":{"$regex":pattern,"$options":"i"}},
            {"student_id":{"$regex":pattern,"$options":"i"}},
            {"course":{"$regex":pattern,"$options":"i"}}
        ]}).sort("name", ASCENDING).limit(8))
    return jsonify(results=[{
        "id":str(member["_id"]), "student_id":member.get("student_id", ""), "name":member.get("name", ""), "email":member.get("email", ""),
        "course":member.get("course", ""), "year":member.get("year", "")
    } for member in matches])

@app.route("/borrowings", methods=["GET","POST"])
def borrowings():
    if not ready():
        return render_template("borrowings.html", error=connection_error, active="borrowings")
    if request.method == "POST":
        member_id=oid(request.form.get("member_id",""))
        member=db.members.find_one({"_id":member_id}) if member_id else None
        copy_id=request.form.get("copy_id", "").strip().upper()
        copy_doc=db.book_copies.find_one({"copy_id": copy_id, "status": "available"}) if copy_id else None
        book=db.books.find_one({"_id": copy_doc.get("book_id")}) if copy_doc else None
        if not member:
            flash("Choose a valid registered student.", "error")
        elif not copy_doc or not book:
            flash("That Copy ID was not found on the shelf or has just been issued. Check the label and try again.", "error")
        else:
            now = datetime.now(timezone.utc)
            record_id = ObjectId()
            new_issue_code = issue_code_for(record_id)
            reserved_copy = reserve_book_copy(book["_id"], member["_id"], new_issue_code, now, copy_id=copy_id)
            if not reserved_copy:
                flash("No copies of this title are currently on the shelf.", "error")
            else:
                stock_update = db.books.update_one({"_id": book["_id"], "copies": {"$gt": 0}}, {"$inc": {"copies": -1}})
                if stock_update.modified_count != 1:
                    release_book_copy({"copy_id": reserved_copy["copy_id"], "issue_code": new_issue_code})
                    flash("No copies of this title are currently on the shelf.", "error")
                else:
                    updated_book = db.books.find_one({"_id": book["_id"]})
                    db.books.update_one({"_id": book["_id"]}, {"$set": {"available": bool(updated_book and updated_book.get("copies", 0) > 0)}})
                    try:
                        db.borrowings.insert_one({
                            "_id": record_id,
                            "issue_code": new_issue_code,
                            "book_copy_id": reserved_copy["_id"], "copy_id": reserved_copy["copy_id"],
                            "book_id": book["_id"], "book_title": book["title"],
                            "member_id": member["_id"], "member_name": member["name"],
                            "member_student_id": member.get("student_id", ""),
                            "member_email": member["email"], "member_course": member["course"],
                            "member_year": member["year"], "book_author": book.get("author", ""),
                            "book_shelf": book.get("shelf", "Unassigned"), "book_category": book.get("category", ""),
                            "status": "borrowed", "borrowed_at": now,
                            "due_at": now + timedelta(days=14), "returned_at": None
                        })
                        flash(f"Issue recorded · {new_issue_code}", "success")
                        return redirect(url_for("issue_slip", issue_code=new_issue_code))
                    except PyMongoError:
                        release_book_copy({"copy_id": reserved_copy["copy_id"], "issue_code": new_issue_code})
                        db.books.update_one({"_id": book["_id"]}, {"$inc": {"copies": 1}})
                        restored = db.books.find_one({"_id": book["_id"]})
                        if restored:
                            db.books.update_one({"_id": book["_id"]}, {"$set": {"available": restored.get("copies", 0) > 0}})
                        flash("Checkout could not be saved. Inventory was restored; please try again.", "error")
        return redirect(url_for("borrowings"))
    return render_template("borrowings.html", error=None, active="borrowings")

def get_issue_records(query=""):
    records = []
    if query:
        issue_code = query.strip().upper()
        terms = " ".join(re.findall(r"[A-Za-z0-9]+", query))
        if issue_code.startswith("CS-"):
            records = list(db.borrowings.find({"issue_code":issue_code}).sort("borrowed_at", -1).limit(200))
        elif issue_code.startswith("STU-"):
            records = list(db.borrowings.find({"member_student_id":issue_code}).sort("borrowed_at", -1).limit(200))
        if not records and terms and not issue_code.startswith("STU-"):
            records = list(db.borrowings.find({"$text":{"$search":terms}}, {"score":{"$meta":"textScore"}}).sort([("score", {"$meta":"textScore"}), ("borrowed_at", DESCENDING)]).limit(200))
        if not records:
            pattern = re.escape(query.strip())
            records = list(db.borrowings.find({"$or":[
                {"book_title":{"$regex":pattern,"$options":"i"}},
                {"book_author":{"$regex":pattern,"$options":"i"}},
                {"member_name":{"$regex":pattern,"$options":"i"}},
                {"member_email":{"$regex":pattern,"$options":"i"}},
                {"member_student_id":{"$regex":pattern,"$options":"i"}}
            ]}).sort("borrowed_at", -1).limit(200))
    else:
        records = list(db.borrowings.find().sort("borrowed_at", -1).limit(200))
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    for record in records:
        record["is_overdue"] = record["status"] == "borrowed" and record.get("due_at") and record["due_at"] < now
        record["overdue_days"] = max(1, (now - record["due_at"]).days) if record["is_overdue"] else 0
    return records

@app.route("/issues")
def issue_register():
    if not ready():
        return render_template("issue_register.html", records=[], q="", error=connection_error, active="issue_register")
    q = request.args.get("q", "").strip()
    records = get_issue_records(q)
    return render_template("issue_register.html", records=records, q=q, error=None, active="issue_register")

@app.route("/issues/<issue_code>")
def issue_slip(issue_code):
    if not ready():
        return render_template("issue_slip.html", record=None, error=connection_error, active="issue_register"), 503
    record = db.borrowings.find_one({"issue_code":issue_code.strip().upper()})
    if not record:
        abort(404)
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    record["is_overdue"] = record["status"] == "borrowed" and record.get("due_at") and record["due_at"] < now
    record["overdue_days"] = max(1, (now - record["due_at"]).days) if record["is_overdue"] else 0
    return render_template("issue_slip.html", record=record, error=None, active="issue_register")

def complete_return(record):
    now = datetime.now(timezone.utc)
    result = db.borrowings.update_one(
        {"_id": record["_id"], "status": "borrowed"},
        {"$set": {"status": "returned", "returned_at": now}}
    )
    if result.modified_count == 1:
        release_book_copy(record)
        db.books.update_one({"_id": record["book_id"]}, {"$inc": {"copies": 1}})
        updated_book = db.books.find_one({"_id": record["book_id"]})
        if updated_book:
            db.books.update_one(
                {"_id": record["book_id"]},
                {"$set": {"available": updated_book.get("copies", 0) > 0}}
            )
        flash(f"Book returned · {record.get('issue_code', 'issue')}", "success")
    else:
        flash("This issue was already returned.", "error")

@app.route("/borrowings/return-by-id", methods=["POST"])
def return_by_issue_id():
    if ready():
        issue_code = request.form.get("issue_code", "").strip().upper()
        record = db.borrowings.find_one({"issue_code":issue_code, "status":"borrowed"}) if issue_code else None
        if record:
            complete_return(record)
        else:
            flash("No active borrowing found for that Issue ID.", "error")
    return redirect(url_for("borrowings"))

@app.route("/borrowings/<issue_code>/return", methods=["POST"])
def return_book(issue_code):
    if ready():
        record = db.borrowings.find_one({"issue_code":issue_code.strip().upper(), "status":"borrowed"})
        if record:
            complete_return(record)
        else:
            flash("Issue ID not found or book already returned.", "error")
    return redirect(url_for("issue_register"))

@app.route("/reviews", methods=["GET","POST"])
def reviews():
    if not ready():
        return render_template("reviews.html", reviews=[], books=[], members=[], error=connection_error, active="reviews")
    if request.method == "POST":
        book=db.books.find_one({"_id":oid(request.form.get("book_id",""))})
        member=db.members.find_one({"_id":oid(request.form.get("member_id",""))})
        try:
            rating=int(request.form.get("rating","5"))
            comment=request.form.get("comment","").strip()
            if not book or not member or rating not in range(1,6) or not comment:
                raise ValueError("Choose a book and member, a rating from 1–5, and enter a comment.")
            db.reviews.insert_one({"book_id":book["_id"],"book_title":book["title"],"member_id":member["_id"],"member_name":member["name"],"rating":rating,"comment":comment,"created_at":datetime.now(timezone.utc)})
            flash("Review published.", "success")
        except ValueError as exc:
            flash(str(exc), "error")
        return redirect(url_for("reviews"))
    items=list(db.reviews.find().sort("created_at",-1).limit(200))
    return render_template("reviews.html", reviews=items, books=list(db.books.find().sort("title",1)), members=list(db.members.find().sort("name",1)), error=None, active="reviews")

@app.route("/insights")
def insights():
    if not ready():
        return render_template("insights.html", categories=[], popular=[], ratings=[], members_by_course=[], total_titles=0, total_copies=0, available_copies=0, on_loan_copies=0, total_students=0, active_loans=0, overdue_loans=0, category_pie=donut_stops([]), copy_pie=donut_stops([]), loan_pie=donut_stops([]), course_pie=donut_stops([]), error=connection_error, active="insights")
    categories=list(db.books.aggregate([
        {"$group":{
            "_id":"$category", "total_books":{"$sum":1},
            "total_copies":{"$sum":{"$ifNull":["$total_copies", "$copies"]}},
            "available_copies":{"$sum":"$copies"}
        }},
        {"$sort":{"total_copies":-1}}
    ]))
    for index, category in enumerate(categories):
        category["on_loan"] = max(0, category["total_copies"] - category["available_copies"])
        category["available_pct"] = round(100 * category["available_copies"] / max(category["total_copies"], 1))
        category["color"] = PIE_COLORS[index % len(PIE_COLORS)]
    popular=list(db.borrowings.aggregate([{"$group":{"_id":"$book_title","checkouts":{"$sum":1}}},{"$sort":{"checkouts":-1}},{"$limit":8}]))
    ratings=list(db.reviews.aggregate([{"$group":{"_id":"$book_title","average_rating":{"$avg":"$rating"},"review_count":{"$sum":1}}},{"$sort":{"average_rating":-1}}]))
    members_by_course=list(db.members.aggregate([{"$group":{"_id":"$course","members":{"$sum":1}}},{"$sort":{"members":-1}}]))
    for index, course in enumerate(members_by_course):
        course["color"] = PIE_COLORS[index % len(PIE_COLORS)]
    total_titles = sum(category["total_books"] for category in categories)
    total_copies = sum(category["total_copies"] for category in categories)
    available_copies = sum(category["available_copies"] for category in categories)
    on_loan_copies = max(0, total_copies - available_copies)
    total_students = sum(course["members"] for course in members_by_course)
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    active_loans = db.borrowings.count_documents({"status":"borrowed"})
    overdue_loans = db.borrowings.count_documents({"status":"borrowed", "due_at":{"$lt":now}})
    return render_template(
        "insights.html", categories=categories, popular=popular, ratings=ratings, members_by_course=members_by_course,
        total_titles=total_titles, total_copies=total_copies, available_copies=available_copies,
        on_loan_copies=on_loan_copies, total_students=total_students, active_loans=active_loans,
        overdue_loans=overdue_loans, category_pie=donut_stops([item["total_books"] for item in categories]),
        copy_pie=donut_stops([available_copies, on_loan_copies], ["#76c6a3", "#7464dd"]),
        loan_pie=donut_stops([max(0, active_loans - overdue_loans), overdue_loans], ["#76c6a3", "#efa681"]),
        course_pie=donut_stops([item["members"] for item in members_by_course]),
        error=None, active="insights"
    )

@app.route("/health")
def health():
    if not ready():
        return {"ok":False,"message":connection_error}, 503
    return {"ok":True,"database":DB_NAME,"collections":db.list_collection_names(),"indexes":{name:[idx["name"] for idx in db[name].list_indexes()] for name in ["books","book_copies","members","borrowings","reviews","librarians"]}}

if __name__ == "__main__":
    connect_db()
    app.run(host="127.0.0.1", port=int(os.getenv("PORT","5000")), debug=False)
