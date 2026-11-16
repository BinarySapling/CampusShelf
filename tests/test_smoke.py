"""
End-to-end smoke test for CampusShelf.

Run after configuring .env and installing requirements:
    python -m unittest discover -s tests -v

The test creates a uniquely named temporary database using the configured Atlas
cluster and drops only that temporary database when finished. It never drops the
configured application database.
"""
import os
import unittest
import uuid
from datetime import datetime, timezone, timedelta

from dotenv import load_dotenv
load_dotenv()

if not os.getenv("MONGO_URI", "").strip():
    raise RuntimeError("Set MONGO_URI in .env before running the live smoke test.")

# Import app only after choosing a disposable DB name.
TEST_DB = "campusshelf_smoke_" + uuid.uuid4().hex[:10]
os.environ["DB_NAME"] = TEST_DB

import app as campus_app

class CampusShelfSmokeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        campus_app.MONGO_URI = os.getenv("MONGO_URI", "").strip()
        campus_app.DB_NAME = TEST_DB
        campus_app.app.config.update(TESTING=True, SECRET_KEY="smoke-test-secret")
        campus_app.connect_db()
        if campus_app.db is None:
            raise RuntimeError("MongoDB connection failed: " + str(campus_app.connection_error))
        cls.client = campus_app.app.test_client()
        cls.db = campus_app.db
        cls.book_id = None
        cls.member_id = None
        cls.borrowing_id = None

    @classmethod
    def tearDownClass(cls):
        if campus_app.client is not None:
            campus_app.client.drop_database(TEST_DB)
            campus_app.client.close()
        campus_app.db = None
        campus_app.client = None

    def test_full_application_flow(self):
        # 1. Pages and health endpoint render without route/template errors.
        for path in ["/", "/books", "/members", "/borrowings", "/reviews", "/insights"]:
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200, f"{path} failed: {response.status_code}")
        overview = self.client.get("/")
        self.assertIn(b"Issues & returns", overview.data)
        self.assertIn(b"Inventory by category", overview.data)
        self.assertIn(b"Overdue returns", overview.data)
        issue_desk = self.client.get("/borrowings")
        self.assertIn(b"Issue ID", issue_desk.data)
        self.assertIn(b"Student", issue_desk.data)
        health = self.client.get("/health")
        self.assertEqual(health.status_code, 200)
        health_json = health.get_json()
        for collection in ["books", "members", "borrowings", "reviews"]:
            self.assertIn(collection, health_json["collections"])
            self.assertTrue(health_json["indexes"][collection])
        self.assertIn("books_search_text", health_json["indexes"]["books"])
        self.assertIn("issue_code_unique", health_json["indexes"]["borrowings"])

        # 2. Book create, indexed full-text search, duplicate ISBN validation.
        isbn = "SMOKE-" + uuid.uuid4().hex[:10]
        response = self.client.post("/books", data={
            "title": "Smoke Test Book", "author": "Test Author", "category": "Technology",
            "isbn": isbn, "copies": "1", "shelf": "QA-01", "description": "Test record"
        }, follow_redirects=True)
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"Smoke Test Book", response.data)
        book = self.db.books.find_one({"isbn": isbn})
        self.assertIsNotNone(book)
        self.assertEqual(book["total_copies"], 1)
        type(self).book_id = book["_id"]

        response = self.client.get("/books?q=Smoke+Test+Book")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"Smoke Test Book", response.data)
        response = self.client.get("/books?q=%5B")
        self.assertEqual(response.status_code, 200)
        response = self.client.post("/books", data={
            "title": "Duplicate ISBN", "author": "Test Author", "category": "Technology",
            "isbn": isbn, "copies": "1"
        }, follow_redirects=True)
        self.assertIn(b"already exists", response.data)

        # 3. Member create and duplicate email handling.
        email = "smoke-" + uuid.uuid4().hex[:10] + "@example.edu"
        response = self.client.post("/members", data={
            "name": "Smoke Reader", "email": email, "course": "CSE", "year": "3"
        }, follow_redirects=True)
        self.assertEqual(response.status_code, 200)
        member = self.db.members.find_one({"email": email})
        self.assertIsNotNone(member)
        type(self).member_id = member["_id"]

        response = self.client.post("/members", data={
            "name": "Duplicate Reader", "email": email, "course": "CSE", "year": "3"
        }, follow_redirects=True)
        self.assertIn(b"already registered", response.data)

        # 4. Checkout decrements stock and creates an active borrowing.
        response = self.client.post("/borrowings", data={
            "book_id": str(book["_id"]), "member_id": str(member["_id"])
        }, follow_redirects=True)
        self.assertEqual(response.status_code, 200)
        loan = self.db.borrowings.find_one({
            "book_id": book["_id"], "member_id": member["_id"], "status": "borrowed"
        })
        self.assertIsNotNone(loan)
        type(self).borrowing_id = loan["_id"]
        self.assertRegex(loan["issue_code"], r"^CS-[0-9A-F]{24}$")
        self.assertEqual(loan["member_email"], email)
        self.assertEqual(loan["member_course"], "CSE")
        self.assertEqual(loan["member_year"], 3)
        after_checkout = self.db.books.find_one({"_id": book["_id"]})
        self.assertEqual(after_checkout["copies"], 0)
        self.assertEqual(after_checkout["total_copies"], 1)
        self.assertFalse(after_checkout["available"])
        self.assertEqual((loan["due_at"] - loan["borrowed_at"]).days, 14)
        issue_page = self.client.get("/borrowings")
        self.assertIn(loan["issue_code"].encode(), issue_page.data)
        self.assertIn(email.encode(), issue_page.data)

        # Overdue check-in is reflected in the librarian overview.
        self.db.borrowings.update_one(
            {"_id": loan["_id"]},
            {"$set": {"due_at": datetime.now(timezone.utc) - timedelta(days=2)}}
        )
        overdue_page = self.client.get("/")
        self.assertIn(loan["issue_code"].encode(), overdue_page.data)
        self.assertIn(b"Overdue returns", overdue_page.data)

        # A second checkout must fail when the last copy is already out.
        before_failed_checkout = self.db.borrowings.count_documents({"book_id": book["_id"]})
        self.client.post("/borrowings", data={
            "book_id": str(book["_id"]), "member_id": str(member["_id"])
        }, follow_redirects=True)
        self.assertEqual(self.db.books.find_one({"_id": book["_id"]})["copies"], 0)
        self.assertEqual(self.db.borrowings.count_documents({"book_id": book["_id"]}), before_failed_checkout)

        # 5. Cannot delete book/member while a loan is active.
        response = self.client.post(f"/books/{book['_id']}/delete", follow_redirects=True)
        self.assertIn(b"cannot be deleted", response.data)
        response = self.client.post(f"/members/{member['_id']}/delete", follow_redirects=True)
        self.assertIn(b"cannot be removed", response.data)

        # 6. Return increments stock exactly once; duplicate return must not increment again.
        response = self.client.post("/borrowings/return-by-id", data={
            "issue_code": loan["issue_code"].lower()
        }, follow_redirects=True)
        self.assertEqual(response.status_code, 200)
        returned_book = self.db.books.find_one({"_id": book["_id"]})
        self.assertEqual(returned_book["copies"], 1)
        self.assertTrue(returned_book["available"])
        self.client.post("/borrowings/return-by-id", data={
            "issue_code": loan["issue_code"]
        }, follow_redirects=True)
        returned_book_again = self.db.books.find_one({"_id": book["_id"]})
        self.assertEqual(returned_book_again["copies"], 1)

        # 7. Review create and aggregation page.
        response = self.client.post("/reviews", data={
            "book_id": str(book["_id"]), "member_id": str(member["_id"]),
            "rating": "5", "comment": "Smoke test review"
        }, follow_redirects=True)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.db.reviews.count_documents({"book_id": book["_id"], "comment": "Smoke test review"}), 1)
        response = self.client.get("/insights")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"Smoke Test Book", response.data)

        # 8. Database-side schema validation rejects invalid ratings.
        with self.assertRaises(Exception):
            self.db.reviews.insert_one({
                "book_id": book["_id"], "book_title": book["title"],
                "member_id": member["_id"], "member_name": member["name"],
                "rating": 9, "comment": "invalid", "created_at": datetime.now(timezone.utc)
            })

        # 9. Delete works after the active loan has been returned.
        response = self.client.post(f"/books/{book['_id']}/delete", follow_redirects=True)
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(self.db.books.find_one({"_id": book["_id"]}))
        response = self.client.post(f"/members/{member['_id']}/delete", follow_redirects=True)
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(self.db.members.find_one({"_id": member["_id"]}))

if __name__ == "__main__":
    unittest.main(verbosity=2)
