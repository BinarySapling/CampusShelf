from datetime import datetime, time, timedelta

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import Client, TestCase, override_settings
from django.utils import timezone

from .models import (
    Book,
    BookCopy,
    BookReservation,
    Borrowing,
    FineEntry,
    LibrarySpace,
    LoanRenewalRequest,
    Member,
    Review,
    SpaceBooking,
    StudentSignupRequest,
)
from .views import copy_code_for, mark_overdue, overdue_fine


User = get_user_model()


class CampusShelfPagesTests(TestCase):
    def setUp(self):
        librarian_group, _ = Group.objects.get_or_create(name="Librarians")
        self.staff = User.objects.create_user(
            username="lib-test-user",
            password="StrongPass123!",
            first_name="Test Librarian",
        )
        self.staff.groups.add(librarian_group)
        self.client.force_login(self.staff)

        self.book = Book.objects.create(
            title="Django for Students",
            author="A. Writer",
            category="Technology",
            copies=1,
            total_copies=1,
            available=True,
            shelf="T-01",
        )
        copy_id = copy_code_for(self.book.id)
        self.copy = BookCopy.objects.create(
            book=self.book,
            copy_id=copy_id,
            book_title=self.book.title,
            shelf=self.book.shelf,
            status=BookCopy.AVAILABLE,
        )
        self.member_user = User.objects.create_user(
            username="STU-0123456789",
            password="StudentPass123!",
            email="reader@campus.edu",
            first_name="Aarav Reader",
        )
        student_group, _ = Group.objects.get_or_create(name="Students")
        self.member_user.groups.add(student_group)
        self.member = Member.objects.create(
            user=self.member_user,
            student_id=self.member_user.username,
            name="Aarav Reader",
            email="reader@campus.edu",
            course="CSE",
            year=2,
        )

    def test_librarian_pages_render(self):
        paths = [
            "/",
            "/books/",
            "/books/add/",
            f"/books/{self.book.id}/copies/",
            "/members/",
            "/borrowings/",
            "/issues/",
            "/reviews/",
            "/insights/",
            "/librarians/",
            "/student/",
            "/health/",
        ]
        for path in paths:
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)

    def test_checkout_and_return_update_copy_stock_once(self):
        response = self.client.post("/borrowings/", {
            "member_id": str(self.member.id),
            "book_id": str(self.book.id),
            "copy_id": self.copy.copy_id,
        })
        self.assertEqual(response.status_code, 302)

        borrowing = Borrowing.objects.get(member=self.member, status=Borrowing.BORROWED)
        slip = self.client.get(f"/issues/{borrowing.issue_code}/")
        self.assertEqual(slip.status_code, 200)
        self.assertContains(slip, borrowing.issue_code)
        self.book.refresh_from_db()
        self.copy.refresh_from_db()
        self.assertEqual(borrowing.issue_code, f"CS-{str(borrowing.id).upper()}")
        self.assertEqual(self.book.copies, 0)
        self.assertEqual(self.copy.status, BookCopy.BORROWED)

        response = self.client.post("/borrowings/return-by-id/", {"issue_code": borrowing.issue_code.lower()})
        self.assertEqual(response.status_code, 302)
        borrowing.refresh_from_db()
        self.book.refresh_from_db()
        self.copy.refresh_from_db()
        self.assertEqual(borrowing.status, Borrowing.RETURNED)
        self.assertEqual(self.book.copies, 1)
        self.assertEqual(self.copy.status, BookCopy.AVAILABLE)

        self.client.post("/borrowings/return-by-id/", {"issue_code": borrowing.issue_code})
        self.book.refresh_from_db()
        self.assertEqual(self.book.copies, 1)

    def test_pending_member_cannot_use_legacy_checkout_pages(self):
        self.member.approval_status = Member.PENDING
        self.member.save(update_fields=["approval_status"])

        staff_checkout = self.client.post("/borrowings/", {
            "member_id": str(self.member.id),
            "book_id": str(self.book.id),
            "copy_id": self.copy.copy_id,
        })
        student_checkout = self.client.post("/student/issue/", {
            "student_id": self.member.student_id,
            "email": self.member.email,
            "password": "StudentPass123!",
            "book_id": str(self.book.id),
            "copy_id": self.copy.copy_id,
        })

        self.assertEqual(staff_checkout.status_code, 302)
        self.assertEqual(student_checkout.status_code, 302)
        self.assertFalse(Borrowing.objects.filter(member=self.member, status=Borrowing.BORROWED).exists())
        self.copy.refresh_from_db()
        self.assertEqual(self.copy.status, BookCopy.AVAILABLE)

    def test_student_search_and_checkout_use_session_slip(self):
        search = self.client.get("/student/search/", {"q": "Django"})
        self.assertEqual(search.status_code, 200)
        self.assertEqual(search.json()["results"][0]["title"], self.book.title)

        response = self.client.post("/student/issue/", {
            "student_id": self.member.student_id,
            "email": self.member.email,
            "password": "StudentPass123!",
            "book_id": str(self.book.id),
            "copy_id": self.copy.copy_id,
        })
        self.assertEqual(response.status_code, 302)
        borrowing = Borrowing.objects.get(member=self.member, status=Borrowing.BORROWED)
        self.assertIn(borrowing.issue_code, self.client.session["student_issue_codes"])
        slip = self.client.get(f"/student/slip/{borrowing.issue_code}/")
        self.assertEqual(slip.status_code, 200)
        self.assertContains(slip, borrowing.issue_code)

    def test_forms_create_book_and_review(self):
        response = self.client.post("/books/add/", {
            "title": "A Second Book",
            "author": "Another Writer",
            "category": "Fiction",
            "isbn": "TEST-ISBN-2",
            "copies": "2",
            "shelf": "F-02",
            "description": "A short description.",
        })
        self.assertEqual(response.status_code, 302)
        added_book = Book.objects.get(title="A Second Book")
        self.assertEqual(BookCopy.objects.filter(book=added_book).count(), 2)

        response = self.client.post("/reviews/", {
            "book_id": str(self.book.id),
            "member_id": str(self.member.id),
            "rating": "5",
            "comment": "A useful class read.",
        })
        self.assertEqual(response.status_code, 302)
        self.assertTrue(Review.objects.filter(book=self.book, member=self.member, rating=5).exists())

    def test_librarian_can_reset_student_portal_password(self):
        response = self.client.post(f"/members/{self.member.id}/portal-password/", {
            "password": "NewStudentPass123!",
            "confirm_password": "NewStudentPass123!",
        })
        self.assertEqual(response.status_code, 302)
        self.member_user.refresh_from_db()
        self.assertTrue(self.member_user.check_password("NewStudentPass123!"))

    def test_historical_issue_survives_book_and_member_removal(self):
        borrowing = Borrowing.objects.create(
            book=self.book,
            member=self.member,
            book_copy=self.copy,
            issue_code="CS-0123456789ABCDEF01234567",
            copy_id=self.copy.copy_id,
            book_title=self.book.title,
            member_name=self.member.name,
            member_student_id=self.member.student_id,
            status=Borrowing.RETURNED,
            borrowed_at=timezone.now() - timedelta(days=20),
            due_at=timezone.now() - timedelta(days=6),
            returned_at=timezone.now() - timedelta(days=3),
        )
        self.client.post(f"/books/{self.book.id}/delete/")
        self.client.post(f"/members/{self.member.id}/delete/")

        borrowing.refresh_from_db()
        self.assertIsNone(borrowing.book)
        self.assertIsNone(borrowing.member)
        self.assertEqual(borrowing.book_title, "Django for Students")
        self.assertEqual(borrowing.member_name, "Aarav Reader")


@override_settings(LIBRARIAN_SETUP_CODE="test-setup-code")
class CampusShelfAccessTests(TestCase):
    def test_api_librarian_setup_shows_id_and_accepts_any_case(self):
        setup_client = Client()
        setup = setup_client.post("/api/auth/setup/", {
            "name": "First API Librarian",
            "setup_code": "test-setup-code",
            "password": "StrongPass123!",
        })
        self.assertEqual(setup.status_code, 200)
        login_id = setup.json()["user"]["login_id"]
        self.assertIn("lib-", login_id)

        login = Client().post("/api/auth/login/", {
            "login_id": login_id.upper(),
            "password": "StrongPass123!",
        })
        self.assertEqual(login.status_code, 200)
        self.assertEqual(login.json()["user"]["login_id"], login_id)

    def test_api_librarian_setup_rejects_a_missing_code_in_production(self):
        with override_settings(DEBUG=False):
            response = Client().post("/api/auth/setup/", {
                "name": "Unverified Librarian",
                "password": "StrongPass123!",
            })
        self.assertEqual(response.status_code, 400)

    def test_first_librarian_setup_creates_group_account(self):
        response = self.client.get("/login/")
        self.assertEqual(response.status_code, 302)
        self.assertIn("/setup/", response.url)

        response = self.client.post("/setup/", {
            "name": "First Librarian",
            "setup_code": "test-setup-code",
            "password": "StrongPass123!",
        })
        self.assertEqual(response.status_code, 302)
        account = User.objects.get(first_name="First Librarian")
        self.assertTrue(account.groups.filter(name="Librarians").exists())
        self.assertIn("LIB-", account.username.upper())

        self.client.post("/logout/")
        response = self.client.post("/login/", {
            "login_id": account.username,
            "password": "StrongPass123!",
        })
        self.assertEqual(response.status_code, 302)
        self.assertIn("/", response.url)

    def test_private_student_slip_requires_session_approval(self):
        response = self.client.get("/student/slip/CS-0123456789ABCDEF01234567/")
        self.assertEqual(response.status_code, 404)

    def test_authenticated_student_cannot_open_librarian_pages(self):
        student = User.objects.create_user(username="student-only", password="StrongPass123!")
        self.client.force_login(student)
        response = self.client.get("/books/")
        self.assertEqual(response.status_code, 403)


class CampusShelfFeatureApiTests(TestCase):
    def setUp(self):
        librarian_group, _ = Group.objects.get_or_create(name="Librarians")
        self.staff = User.objects.create_user(username="api-librarian", password="StrongPass123!")
        self.staff.groups.add(librarian_group)
        self.staff_client = Client()
        self.staff_client.force_login(self.staff)

        self.book = Book.objects.create(
            title="QR Reader",
            author="A. Writer",
            category="Technology",
            copies=1,
            total_copies=1,
            available=True,
            shelf="Q-01",
        )
        self.copy = BookCopy.objects.create(
            book=self.book,
            copy_id=copy_code_for(self.book.id),
            book_title=self.book.title,
            shelf=self.book.shelf,
        )

    def make_student(self, suffix):
        student_group, _ = Group.objects.get_or_create(name="Students")
        user = User.objects.create_user(
            username=f"STU-FEATURE-{suffix}",
            password="StudentPass123!",
            email=f"feature-{suffix.lower()}@campus.edu",
        )
        user.groups.add(student_group)
        member = Member.objects.create(
            user=user,
            student_id=user.username,
            name=f"Feature Reader {suffix}",
            email=user.email,
            course="CSE",
            year=2,
        )
        client = Client()
        client.force_login(user)
        return member, client

    def test_student_signup_waits_for_approval_then_creates_portal_account(self):
        response = self.client.post("/api/signup/", {
            "name": "New Reader",
            "email": "new.reader@campus.edu",
            "registration_number": "REG-4001",
            "course": "CSE",
            "year": "2",
            "password": "NewStudentPass123!",
            "confirm_password": "NewStudentPass123!",
        })
        self.assertEqual(response.status_code, 201)
        member = Member.objects.get(email="new.reader@campus.edu")
        self.assertEqual(member.approval_status, Member.APPROVED)
        self.assertTrue(member.user.is_active)
        self.assertEqual(member.user.username, member.student_id)

        student_client = Client()
        # Login with Student ID
        login_by_id = student_client.post("/api/auth/login/", {
            "login_id": member.student_id,
            "password": "NewStudentPass123!",
        })
        self.assertEqual(login_by_id.status_code, 200)
        self.assertEqual(login_by_id.json()["user"]["role"], "student")

        # Login with Email
        login_by_email = student_client.post("/api/auth/login/", {
            "login_id": "new.reader@campus.edu",
            "password": "NewStudentPass123!",
        })
        self.assertEqual(login_by_email.status_code, 200)
        self.assertEqual(login_by_email.json()["user"]["role"], "student")


    def test_librarian_can_get_qr_details_for_every_copy(self):
        other_book = Book.objects.create(
            title="Second QR Book",
            author="B. Writer",
            category="History",
            copies=1,
            total_copies=1,
            available=True,
            shelf="H-02",
        )
        other_copy = BookCopy.objects.create(
            book=other_book,
            copy_id=copy_code_for(other_book.id),
            book_title=other_book.title,
            shelf=other_book.shelf,
        )

        response = self.staff_client.get("/api/books/copies/")

        self.assertEqual(response.status_code, 200)
        self.assertCountEqual(
            [item["copy_id"] for item in response.json()["results"]],
            [self.copy.copy_id, other_copy.copy_id],
        )
        other_row = next(item for item in response.json()["results"] if item["copy_id"] == other_copy.copy_id)
        self.assertEqual(other_row["book_title"], "Second QR Book")

    def test_students_cannot_get_librarian_qr_label_list(self):
        student = User.objects.create_user(username="student-qr-list", password="StrongPass123!")
        student_client = Client()
        student_client.force_login(student)

        response = student_client.get("/api/books/copies/")

        self.assertEqual(response.status_code, 403)

    def test_book_copy_labels_show_who_has_the_copy_and_student_slip_details(self):
        student_user = User.objects.create_user(username="student-slip-test", password="StrongPass123!")
        member = Member.objects.create(
            user=student_user,
            student_id="STU-SLIP-01",
            name="Slip Reader",
            email="slip.reader@campus.edu",
            course="CSE",
            year=2,
            approval_status=Member.APPROVED,
        )
        due_at = timezone.now() + timedelta(days=14)
        loan = Borrowing.objects.create(
            book=self.book,
            member=member,
            book_copy=self.copy,
            issue_code="CS-ISSUE-SLIP-API-TEST",
            copy_id=self.copy.copy_id,
            book_title=self.book.title,
            book_author=self.book.author,
            book_category=self.book.category,
            book_shelf=self.book.shelf,
            member_name=member.name,
            member_email=member.email,
            member_student_id=member.student_id,
            status=Borrowing.BORROWED,
            borrowed_at=timezone.now(),
            due_at=due_at,
        )
        self.copy.status = BookCopy.BORROWED
        self.copy.current_member = member
        self.copy.current_issue_code = loan.issue_code
        self.copy.save(update_fields=["status", "current_member", "current_issue_code"])

        copies = self.staff_client.get(f"/api/books/{self.book.id}/copies/")
        self.assertEqual(copies.status_code, 200)
        self.assertEqual(copies.json()["results"][0]["borrowed_to"], member.name)
        self.assertEqual(copies.json()["results"][0]["issue_code"], loan.issue_code)

        student_client = Client()
        student_client.force_login(student_user)
        slip = student_client.get("/api/student/loans/")
        self.assertEqual(slip.status_code, 200)
        self.assertEqual(slip.json()["results"][0]["book_author"], self.book.author)
        self.assertEqual(slip.json()["results"][0]["book_shelf"], self.book.shelf)
        self.assertEqual(slip.json()["results"][0]["issue_code"], loan.issue_code)

    def test_librarian_cannot_issue_a_sixth_active_book(self):
        member = Member.objects.create(
            student_id="STU-LIMIT-01",
            name="Limit Reader",
            email="limit.reader@campus.edu",
            course="CSE",
            year=1,
        )
        due_at = timezone.now() + timedelta(days=14)
        for number in range(5):
            Borrowing.objects.create(
                member=member,
                issue_code=f"CS-LIMIT-{number}",
                status=Borrowing.BORROWED,
                due_at=due_at,
            )

        response = self.staff_client.post("/api/loans/", {
            "member_id": str(member.id),
            "copy_id": self.copy.copy_id,
        })
        self.assertEqual(response.status_code, 409)
        self.assertEqual(Borrowing.objects.filter(member=member, status=Borrowing.BORROWED).count(), 5)

    def test_overdue_status_and_fine_start_the_day_after_due_date(self):
        member = Member.objects.create(
            student_id="STU-DATE-01",
            name="Date Reader",
            email="date.reader@campus.edu",
            course="CSE",
            year=1,
        )
        today = timezone.localdate()
        due_at = timezone.make_aware(datetime.combine(today, time(9, 0)))
        record = Borrowing.objects.create(
            member=member,
            issue_code="CS-DATE-TEST",
            status=Borrowing.BORROWED,
            due_at=due_at,
        )

        marked = mark_overdue(record, now=timezone.make_aware(datetime.combine(today, time(23, 59))))
        self.assertFalse(marked.is_overdue)
        self.assertEqual(overdue_fine(record, today=today), (0, 0))
        self.assertEqual(overdue_fine(record, today=today + timedelta(days=1)), (1, 20))

    def test_rejected_signup_cannot_sign_in(self):
        self.client.post("/api/signup/", {
            "name": "Rejected Reader",
            "email": "rejected@campus.edu",
            "registration_number": "REG-4002",
            "course": "ECE",
            "year": "1",
            "password": "NewStudentPass123!",
            "confirm_password": "NewStudentPass123!",
        })
        signup = StudentSignupRequest.objects.get(email="rejected@campus.edu")
        response = self.staff_client.post(f"/api/requests/{signup.id}/reject/")
        self.assertEqual(response.status_code, 200)
        signup.user.refresh_from_db()
        signup.refresh_from_db()
        self.assertFalse(signup.user.is_active)
        self.assertEqual(signup.status, StudentSignupRequest.REJECTED)

        retry = self.client.post("/api/signup/", {
            "name": "Rejected Reader Updated",
            "email": "rejected@campus.edu",
            "registration_number": "REG-4002",
            "course": "ECE",
            "year": "1",
            "password": "NewStudentPass456!",
            "confirm_password": "NewStudentPass456!",
        })
        self.assertEqual(retry.status_code, 201)
        signup.refresh_from_db()
        self.assertEqual(signup.status, StudentSignupRequest.PENDING)

    def test_student_scans_copy_and_librarian_return_saves_overdue_fine(self):
        student_group, _ = Group.objects.get_or_create(name="Students")
        student_user = User.objects.create_user(
            username="STU-QR-001",
            password="StudentPass123!",
            email="qr.reader@campus.edu",
        )
        student_user.groups.add(student_group)
        member = Member.objects.create(
            user=student_user,
            student_id=student_user.username,
            name="QR Reader",
            email="qr.reader@campus.edu",
            course="CSE",
            year=2,
        )
        student_client = Client()
        student_client.force_login(student_user)

        scan = student_client.get(f"/api/copies/{self.copy.copy_id}/")
        self.assertEqual(scan.status_code, 200)
        self.assertEqual(scan.json()["status"], BookCopy.AVAILABLE)
        checkout = student_client.post("/api/student/issue/", {"copy_id": self.copy.copy_id})
        self.assertEqual(checkout.status_code, 201)
        loan = Borrowing.objects.get(member=member, status=Borrowing.BORROWED)
        self.assertEqual(checkout.json()["loan"]["issue_code"], loan.issue_code)
        student_return = student_client.post("/api/returns/copy/", {"copy_id": self.copy.copy_id})
        self.assertEqual(student_return.status_code, 403)

        two_days_ago = timezone.localdate() - timedelta(days=2)
        loan.due_at = timezone.make_aware(datetime.combine(two_days_ago, time(12)))
        loan.save(update_fields=["due_at"])
        returned = self.staff_client.post("/api/returns/copy/", {"copy_id": self.copy.copy_id})
        self.assertEqual(returned.status_code, 200)
        fine = FineEntry.objects.get(borrowing=loan)
        self.assertEqual(fine.amount, 40)
        self.assertEqual(fine.status, FineEntry.UNPAID)
        duplicate_return = self.staff_client.post("/api/returns/copy/", {"copy_id": self.copy.copy_id})
        self.assertEqual(duplicate_return.status_code, 404)
        self.assertEqual(FineEntry.objects.filter(borrowing=loan).count(), 1)

        student_client.force_login(student_user)
        fines = student_client.get("/api/fines/")
        self.assertEqual(fines.status_code, 200)
        self.assertEqual(fines.json()["results"][0]["amount"], "40")

    def test_qr_return_reconciles_a_stale_copy_issue_code(self):
        member = Member.objects.create(
            student_id="STU-RETURN-REPAIR",
            name="Return Reader",
            email="return.reader@campus.edu",
            course="CSE",
            year=2,
        )
        loan = Borrowing.objects.create(
            book=self.book,
            member=member,
            book_copy=self.copy,
            issue_code="CS-RETURN-REPAIR",
            copy_id=self.copy.copy_id,
            book_title=self.book.title,
            member_name=member.name,
            member_student_id=member.student_id,
            status=Borrowing.BORROWED,
            borrowed_at=timezone.now(),
            due_at=timezone.now() + timedelta(days=14),
        )
        self.copy.status = BookCopy.BORROWED
        self.copy.current_member = member
        self.copy.current_issue_code = "CS-STALE-COPY-ISSUE"
        self.copy.save(update_fields=["status", "current_member", "current_issue_code"])

        scan = self.staff_client.get(f"/api/copies/{self.copy.copy_id}/lookup/")
        self.assertEqual(scan.status_code, 200)
        self.assertEqual(scan.json()["status"], BookCopy.BORROWED)
        self.assertTrue(scan.json()["active_loan"])

        returned = self.staff_client.post("/api/returns/copy/", {"copy_id": self.copy.copy_id})

        self.assertEqual(returned.status_code, 200)
        self.assertEqual(returned.json()["loan"]["status"], Borrowing.RETURNED)
        loan.refresh_from_db()
        self.copy.refresh_from_db()
        self.assertEqual(loan.status, Borrowing.RETURNED)
        self.assertEqual(self.copy.status, BookCopy.AVAILABLE)
        self.assertEqual(self.copy.current_issue_code, "")
        scan_after_return = self.staff_client.get(f"/api/copies/{self.copy.copy_id}/lookup/")
        self.assertEqual(scan_after_return.json()["status"], BookCopy.AVAILABLE)
        self.assertFalse(scan_after_return.json()["active_loan"])

    def test_issue_repairs_available_copy_with_an_active_loan_instead_of_duplicating_it(self):
        member = Member.objects.create(
            student_id="STU-ISSUE-REPAIR",
            name="Active Reader",
            email="active.reader@campus.edu",
            course="CSE",
            year=2,
        )
        loan = Borrowing.objects.create(
            book=self.book,
            member=member,
            book_copy=self.copy,
            issue_code="CS-ISSUE-REPAIR",
            copy_id=self.copy.copy_id,
            book_title=self.book.title,
            member_name=member.name,
            member_student_id=member.student_id,
            status=Borrowing.BORROWED,
            borrowed_at=timezone.now(),
            due_at=timezone.now() + timedelta(days=14),
        )
        self.copy.status = BookCopy.AVAILABLE
        self.copy.current_issue_code = ""
        self.copy.current_member = None
        self.copy.save(update_fields=["status", "current_issue_code", "current_member"])

        response = self.staff_client.post("/api/loans/", {
            "member_id": str(member.id),
            "copy_id": self.copy.copy_id,
        })

        self.assertEqual(response.status_code, 409)
        self.assertEqual(Borrowing.objects.filter(copy_id=self.copy.copy_id, status=Borrowing.BORROWED).count(), 1)
        self.copy.refresh_from_db()
        self.assertEqual(self.copy.status, BookCopy.BORROWED)
        self.assertEqual(self.copy.current_issue_code, loan.issue_code)

    def test_optional_cover_is_validated_and_visible_in_catalogue(self):
        values = {"title": "Cover Test", "author": "Reader", "category": "Fiction", "copies": 1,
                  "shelf": "C-01", "cover_url": "https://example.com/cover.jpg"}
        result = self.staff_client.post("/api/books/", values)
        self.assertEqual(result.status_code, 201)
        book = result.json()["book"]
        self.assertEqual(book["cover_url"], values["cover_url"])
        public = self.client.get("/api/catalogue/?q=Cover+Test").json()["results"][0]
        self.assertEqual(public["cover_url"], values["cover_url"])
        values["cover_url"] = "http://example.com/cover.jpg"
        self.assertEqual(self.staff_client.post(f"/api/books/{book['id']}/", values).status_code, 400)
        values["cover_url"] = ""
        cleared = self.staff_client.post(f"/api/books/{book['id']}/", values)
        self.assertEqual(cleared.status_code, 200)
        self.assertEqual(cleared.json()["book"]["cover_url"], "")

    def test_catalogue_seed_is_repeatable_and_preserves_existing_stock(self):
        from django.core.management import call_command
        from io import StringIO
        call_command("seed_catalogue", copies=3, stdout=StringIO())
        before = (Book.objects.count(), BookCopy.objects.count())
        call_command("seed_catalogue", copies=3, stdout=StringIO())
        self.assertEqual(before, (Book.objects.count(), BookCopy.objects.count()))
        self.assertEqual(BookCopy.objects.values("copy_id").distinct().count(), BookCopy.objects.count())
        self.assertTrue(Book.objects.filter(pk=self.book.pk).exists())
        seeded = Book.objects.get(title="Deep Work")
        self.assertEqual(seeded.total_copies, 3)
        self.assertEqual(seeded.copies, 3)

    def test_fine_removal_requires_staff_and_updates_student_balance(self):
        member, student = self.make_student("REMOVE")
        fine = FineEntry.objects.create(member=member, member_name=member.name,
            student_id=member.student_id, amount=25, fine_type=FineEntry.CUSTOM, reason="Incorrect charge")
        url = f"/api/fines/{fine.pk}/remove/"
        self.assertEqual(Client().post(url).status_code, 401)
        self.assertEqual(student.post(url).status_code, 403)
        self.assertEqual(self.staff_client.get(url).status_code, 405)
        self.assertEqual(self.staff_client.post(url).status_code, 200)
        self.assertFalse(FineEntry.objects.filter(pk=fine.pk).exists())
        self.assertEqual(student.get("/api/fines/").json()["results"], [])
        self.assertEqual(self.staff_client.post(url).status_code, 404)

    def test_paid_fine_receipt_cannot_be_removed(self):
        member, _ = self.make_student("RECEIPT")
        fine = FineEntry.objects.create(member=member, member_name=member.name,
            student_id=member.student_id, amount=25, fine_type=FineEntry.CUSTOM,
            reason="Paid receipt", status=FineEntry.PAID, paid_at=timezone.now())
        response = self.staff_client.post(f"/api/fines/{fine.pk}/remove/")
        self.assertEqual(response.status_code, 409)
        self.assertTrue(FineEntry.objects.filter(pk=fine.pk).exists())

    def test_librarian_can_add_and_mark_a_custom_fine_paid(self):
        student_group, _ = Group.objects.get_or_create(name="Students")
        student_user = User.objects.create_user(
            username="STU-FINE-01",
            password="StudentPass123!",
            email="fine.reader@campus.edu",
        )
        student_user.groups.add(student_group)
        member = Member.objects.create(
            user=student_user,
            student_id="STU-FINE-01",
            name="Fine Reader",
            email="fine.reader@campus.edu",
            course="CSE",
            year=3,
        )
        created = self.staff_client.post("/api/fines/custom/", {
            "member_id": str(member.id),
            "amount": "35.50",
            "reason": "Damaged book cover",
        })
        self.assertEqual(created.status_code, 201)
        fine = FineEntry.objects.get(member=member)
        self.assertEqual(str(fine.amount), "35.50")

        student_client = Client()
        student_client.force_login(student_user)
        student_fines = student_client.get("/api/fines/").json()["results"]
        self.assertEqual(len(student_fines), 1)
        self.assertEqual(student_fines[0]["amount"], "35.50")
        self.assertEqual(student_fines[0]["reason"], "Damaged book cover")

        paid = self.staff_client.post(f"/api/fines/{fine.id}/paid/")
        self.assertEqual(paid.status_code, 200)
        fine.refresh_from_db()
        self.assertEqual(fine.status, FineEntry.PAID)
        self.assertIsNotNone(fine.paid_at)

    def test_student_can_publish_and_update_a_public_book_rating(self):
        student_group, _ = Group.objects.get_or_create(name="Students")
        student_user = User.objects.create_user(
            username="STU-RATE-01",
            password="StudentPass123!",
            email="rate.reader@campus.edu",
        )
        student_user.groups.add(student_group)
        member = Member.objects.create(
            user=student_user,
            student_id="STU-RATE-01",
            name="Rating Reader",
            email="rate.reader@campus.edu",
            course="CSE",
            year=2,
        )
        student_client = Client()
        student_client.force_login(student_user)

        created = student_client.post("/api/student/reviews/", {
            "book_id": str(self.book.id),
            "rating": "5",
            "comment": "A thoughtful and useful read.",
        })

        self.assertEqual(created.status_code, 201)
        self.assertFalse(created.json()["updated"])
        public_client = Client()
        public_reviews = public_client.get(f"/api/books/{self.book.id}/reviews/")
        self.assertEqual(public_reviews.status_code, 200)
        self.assertEqual(public_reviews.json()["average_rating"], 5)
        self.assertEqual(public_reviews.json()["rating_count"], 1)
        self.assertEqual(public_reviews.json()["results"][0]["member_name"], member.name)
        self.assertIsNone(public_reviews.json()["my_review"])
        public_catalogue = public_client.get("/api/catalogue/")
        rated_book = next(book for book in public_catalogue.json()["results"] if book["id"] == str(self.book.id))
        self.assertEqual(rated_book["average_rating"], 5)
        self.assertEqual(rated_book["rating_count"], 1)

        update = student_client.post("/api/student/reviews/", {
            "book_id": str(self.book.id),
            "rating": "3",
            "comment": "Still helpful on a second read.",
        })
        self.assertEqual(update.status_code, 200)
        self.assertTrue(update.json()["updated"])
        self.assertEqual(Review.objects.filter(book=self.book, member=member).count(), 1)
        updated_reviews = student_client.get(f"/api/books/{self.book.id}/reviews/").json()
        self.assertEqual(updated_reviews["average_rating"], 3)
        self.assertEqual(updated_reviews["rating_count"], 1)
        self.assertEqual(updated_reviews["my_review"]["rating"], 3)

    def test_student_fines_include_legacy_entries_by_student_id_only(self):
        student_group, _ = Group.objects.get_or_create(name="Students")
        student_user = User.objects.create_user(
            username="STU-LEGACY-FINE",
            password="StudentPass123!",
            email="legacy.fine@campus.edu",
        )
        student_user.groups.add(student_group)
        member = Member.objects.create(
            user=student_user,
            student_id="STU-LEGACY-FINE",
            name="Legacy Fine Reader",
            email="legacy.fine@campus.edu",
            course="CSE",
            year=2,
        )
        own_fine = FineEntry.objects.create(
            member=None,
            member_name=member.name,
            student_id=member.student_id,
            amount="20.00",
            fine_type=FineEntry.CUSTOM,
            reason="Legacy record without a member link",
        )
        FineEntry.objects.create(
            member_name="Another Reader",
            student_id="STU-OTHER-FINE",
            amount="90.00",
            fine_type=FineEntry.CUSTOM,
            reason="Another student's fine",
        )

        student_client = Client()
        student_client.force_login(student_user)
        response = student_client.get("/api/fines/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual([entry["id"] for entry in response.json()["results"]], [str(own_fine.id)])

    def test_post_forms_require_csrf_token(self):
        librarian_group, _ = Group.objects.get_or_create(name="Librarians")
        staff = User.objects.create_user(username="csrf-librarian", password="StrongPass123!")
        staff.groups.add(librarian_group)
        csrf_client = Client(enforce_csrf_checks=True)
        csrf_client.force_login(staff)
        response = csrf_client.post("/books/add/", {
            "title": "Blocked without token",
            "author": "Test Author",
            "category": "Technology",
            "copies": "1",
        })
        self.assertEqual(response.status_code, 403)

    def test_react_signup_requires_and_accepts_csrf_cookie(self):
        csrf_client = Client(enforce_csrf_checks=True)
        csrf_client.get("/api/csrf/")
        token = csrf_client.cookies["csrftoken"].value
        values = {
            "name": "CSRF Reader",
            "email": "csrf.reader@campus.edu",
            "registration_number": "REG-7001",
            "course": "CSE",
            "year": "1",
            "password": "StudentPass123!",
            "confirm_password": "StudentPass123!",
        }
        blocked = csrf_client.post("/api/signup/", values)
        self.assertEqual(blocked.status_code, 403)

        allowed = csrf_client.post("/api/signup/", values, HTTP_X_CSRFTOKEN=token)
        self.assertEqual(allowed.status_code, 201)

    def test_catalogue_checkbox_filters_sort_and_pagination_combine(self):
        fiction = Book.objects.create(title="A Fiction Book", author="Zed Author", category="Fiction",
            shelf="FILTER-SHELF", isbn="9781234567897", cover_url="https://example.com/cover.jpg")
        BookCopy.objects.create(book=fiction, copy_id=copy_code_for(fiction.pk), shelf=fiction.shelf)
        Review.objects.create(book=fiction, book_title=fiction.title, member_name="Reader", rating=5, comment="Excellent")
        response = self.client.get("/api/catalogue/", {"category": ["Fiction", "Technology"],
            "availability": ["available", "unavailable"], "page_size": 1, "sort": "title_desc"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["pagination"]["total"], 2)
        self.assertEqual(response.json()["results"][0]["id"], str(self.book.pk))
        second = self.client.get("/api/catalogue/", {"category": ["Fiction", "Technology"], "sort": "title_desc", "page": 2, "page_size": 1})
        self.assertEqual(second.json()["results"][0]["id"], str(fiction.pk))
        for term in ["9781234567897", "FILTER-SHELF"]:
            found = self.client.get("/api/catalogue/", {"q": term}).json()["results"]
            self.assertEqual([item["id"] for item in found], [str(fiction.pk)])
        rated = self.client.get("/api/catalogue/", {"min_rating": 4, "with_cover": "1", "sort": "rating"}).json()
        self.assertEqual(rated["pagination"]["total"], 1)
        self.assertEqual(rated["results"][0]["id"], str(fiction.pk))
        self.assertEqual(self.client.get("/api/catalogue/", {"category": "Missing"}).json()["pagination"]["total"], 0)

    def test_transaction_type_checkboxes_filter_before_pagination_and_keep_student_scope(self):
        member, student = self.make_student("FILTER")
        other, _ = self.make_student("OTHERFILTER")
        for person in [member, other]:
            FineEntry.objects.create(member=person, member_name=person.name, student_id=person.student_id,
                amount=25, fine_type=FineEntry.CUSTOM, reason="Filter test", status=FineEntry.PAID, paid_at=timezone.now())
        response = student.get("/api/student/transactions/", {"type": ["fine_added", "fine_paid"], "page_size": 1})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["pagination"]["total"], 2)
        self.assertEqual(response.json()["results"][0]["student_id"], member.student_id)
        invalid = self.staff_client.get("/api/transactions/", {"type": ["fine_added", "invalid"]})
        self.assertEqual(invalid.status_code, 400)

    def test_catalogue_supports_category_availability_and_page_filters(self):
        other_book = Book.objects.create(
            title="Available Fiction",
            author="B. Reader",
            category="Fiction",
            copies=1,
            total_copies=1,
            available=True,
            shelf="F-01",
        )
        other_copy = BookCopy.objects.create(
            book=other_book,
            copy_id=copy_code_for(other_book.id),
            book_title=other_book.title,
            shelf=other_book.shelf,
        )
        self.copy.status = BookCopy.BORROWED
        self.copy.save(update_fields=["status"])

        page = self.client.get("/api/catalogue/?page=1&page_size=1")
        self.assertEqual(page.status_code, 200)
        self.assertEqual(page.json()["pagination"], {"page": 1, "page_size": 1, "total": 2, "pages": 2})
        self.assertEqual(len(page.json()["results"]), 1)
        self.assertIn("Fiction", page.json()["categories"])

        available = self.client.get("/api/catalogue/?availability=available&category=Fiction")
        self.assertEqual([row["id"] for row in available.json()["results"]], [str(other_book.id)])
        unavailable = self.client.get("/api/catalogue/?availability=unavailable")
        self.assertEqual([row["id"] for row in unavailable.json()["results"]], [str(self.book.id)])
        self.assertEqual(other_copy.status, BookCopy.AVAILABLE)

    def test_librarian_can_edit_inventory_without_erasing_copy_history(self):
        values = {
            "title": "QR Reader Revised",
            "author": "A. Writer",
            "category": "Technology",
            "isbn": "9780000000001",
            "copies": "2",
            "shelf": "Q-02",
            "description": "Updated details",
        }
        invalid_count = {**values, "copies": "201"}
        rejected_count = self.staff_client.post(f"/api/books/{self.book.id}/", invalid_count)
        self.assertEqual(rejected_count.status_code, 400)
        self.assertEqual(BookCopy.objects.filter(book=self.book).exclude(status=BookCopy.RETIRED).count(), 1)

        increased = self.staff_client.post(f"/api/books/{self.book.id}/", values)
        self.assertEqual(increased.status_code, 200)
        self.book.refresh_from_db()
        self.assertEqual(self.book.total_copies, 2)
        self.assertEqual(self.book.title, "QR Reader Revised")
        self.assertEqual(BookCopy.objects.filter(book=self.book, shelf="Q-02", status=BookCopy.AVAILABLE).count(), 2)

        values["copies"] = "1"
        reduced = self.staff_client.post(f"/api/books/{self.book.id}/", values)
        self.assertEqual(reduced.status_code, 200)
        self.assertEqual(BookCopy.objects.filter(book=self.book).exclude(status=BookCopy.RETIRED).count(), 1)
        self.assertEqual(BookCopy.objects.filter(book=self.book, status=BookCopy.RETIRED).count(), 1)
        self.assertEqual(len(self.staff_client.get(f"/api/books/{self.book.id}/copies/").json()["results"]), 1)

        member, student_client = self.make_student("INVENTORY")
        active_copy = BookCopy.objects.filter(book=self.book, status=BookCopy.AVAILABLE).first()
        checkout = student_client.post("/api/student/issue/", {"copy_id": active_copy.copy_id})
        self.assertEqual(checkout.status_code, 201)
        values["copies"] = "0"
        blocked = self.staff_client.post(f"/api/books/{self.book.id}/", values)
        self.assertEqual(blocked.status_code, 409)
        self.book.refresh_from_db()
        self.assertEqual(self.book.total_copies, 1)
        self.assertTrue(Borrowing.objects.filter(member=member, status=Borrowing.BORROWED).exists())

    def test_reservation_queue_promotes_on_return_and_fulfills_on_checkout(self):
        first_member, first_client = self.make_student("FIRST")
        next_member, next_client = self.make_student("NEXT")
        checkout = first_client.post("/api/student/issue/", {"copy_id": self.copy.copy_id})
        self.assertEqual(checkout.status_code, 201)

        reserved = next_client.post("/api/student/reservations/", {"book_id": str(self.book.id)})
        self.assertEqual(reserved.status_code, 201)
        self.assertEqual(reserved.json()["reservation"]["status"], BookReservation.WAITING)
        self.assertEqual(self.staff_client.get("/api/reservations/").json()["results"][0]["student_id"], next_member.student_id)

        returned = self.staff_client.post("/api/returns/copy/", {"copy_id": self.copy.copy_id})
        self.assertEqual(returned.status_code, 200)
        reservation = BookReservation.objects.get(member=next_member, book=self.book)
        self.assertEqual(reservation.status, BookReservation.READY)
        queue_block = first_client.post("/api/student/issue/", {"copy_id": self.copy.copy_id})
        self.assertEqual(queue_block.status_code, 409)

        pickup = next_client.post("/api/student/issue/", {"copy_id": self.copy.copy_id})
        self.assertEqual(pickup.status_code, 201)
        reservation.refresh_from_db()
        self.assertEqual(reservation.status, BookReservation.FULFILLED)
        self.assertEqual(Borrowing.objects.filter(status=Borrowing.BORROWED, copy_id=self.copy.copy_id).count(), 1)

    def test_renewals_need_librarian_decision_and_reports_include_transactions(self):
        member, student_client = self.make_student("RENEW")
        first_checkout = student_client.post("/api/student/issue/", {"copy_id": self.copy.copy_id})
        self.assertEqual(first_checkout.status_code, 201)
        loan = Borrowing.objects.get(member=member, status=Borrowing.BORROWED)
        original_due = loan.due_at
        requested = student_client.post("/api/student/renewals/", {"loan_id": str(loan.id)})
        self.assertEqual(requested.status_code, 201)
        self.assertEqual(self.staff_client.get("/api/renewals/").json()["results"][0]["status"], LoanRenewalRequest.PENDING)

        approved = self.staff_client.post(f"/api/renewals/{requested.json()['renewal']['id']}/approve/")
        self.assertEqual(approved.status_code, 200)
        loan.refresh_from_db()
        self.assertEqual(loan.due_at, original_due + timedelta(days=14))
        renewal_again = student_client.post("/api/student/renewals/", {"loan_id": str(loan.id)})
        self.assertEqual(renewal_again.status_code, 409)

        second_book = Book.objects.create(title="Another title", author="C. Writer", category="Fiction", copies=1, total_copies=1, shelf="F-02")
        second_copy = BookCopy.objects.create(book=second_book, copy_id=copy_code_for(second_book.id), book_title=second_book.title, shelf=second_book.shelf)
        second_checkout = student_client.post("/api/student/issue/", {"copy_id": second_copy.copy_id})
        self.assertEqual(second_checkout.status_code, 201)
        second_loan = Borrowing.objects.get(copy_id=second_copy.copy_id, status=Borrowing.BORROWED)
        second_request = student_client.post("/api/student/renewals/", {"loan_id": str(second_loan.id)})
        self.assertEqual(second_request.status_code, 201)
        rejected = self.staff_client.post(f"/api/renewals/{second_request.json()['renewal']['id']}/reject/")
        self.assertEqual(rejected.status_code, 200)
        self.assertEqual(LoanRenewalRequest.objects.get(pk=second_request.json()["renewal"]["id"]).status, LoanRenewalRequest.REJECTED)

        report = self.staff_client.get("/api/reports/")
        self.assertEqual(report.status_code, 200)
        self.assertEqual(report.json()["totals"]["borrowings"], 2)
        self.assertIn("QR Reader", [item["title"] for item in report.json()["popular_books"]])
        self.assertEqual(len(report.json()["circulation"]), 6)

    def test_checkout_policy_blocks_overdue_loans_and_exposes_due_soon_alerts(self):
        member, student_client = self.make_student("POLICY")
        now = timezone.now()
        yesterday = timezone.localdate() - timedelta(days=1)
        overdue_loan = Borrowing.objects.create(
            book=self.book,
            issue_code="CS-POLICY-OVERDUE",
            copy_id="CSB-LEGACY-OVERDUE",
            book_title="Late library book",
            member_name=member.name,
            member_student_id=member.student_id,
            status=Borrowing.BORROWED,
            borrowed_at=now - timedelta(days=20),
            due_at=timezone.make_aware(datetime.combine(yesterday, time(12))),
        )

        loans = student_client.get("/api/student/loans/")
        self.assertEqual(loans.status_code, 200)
        overdue_data = next(item for item in loans.json()["results"] if item["id"] == str(overdue_loan.pk))
        self.assertEqual(overdue_data["due_status"], "overdue")
        self.assertIn("1 day overdue", overdue_data["due_message"])
        self.assertEqual(overdue_data["current_fine"], "20")

        student_checkout = student_client.post("/api/student/issue/", {"copy_id": self.copy.copy_id})
        self.assertEqual(student_checkout.status_code, 409)
        self.assertIn("Late library book", student_checkout.json()["error"])
        staff_checkout = self.staff_client.post("/api/loans/", {
            "member_id": str(member.pk),
            "copy_id": self.copy.copy_id,
        })
        self.assertEqual(staff_checkout.status_code, 409)
        self.assertIn("overdue", staff_checkout.json()["error"])
        legacy_staff_checkout = self.staff_client.post("/borrowings/", {
            "member_id": str(member.pk),
            "book_id": str(self.book.pk),
            "copy_id": self.copy.copy_id,
        })
        self.assertEqual(legacy_staff_checkout.status_code, 302)
        legacy_student_checkout = student_client.post("/student/issue/", {
            "student_id": member.student_id,
            "email": member.email,
            "password": "StudentPass123!",
            "book_id": str(self.book.pk),
            "copy_id": self.copy.copy_id,
        })
        self.assertEqual(legacy_student_checkout.status_code, 302)
        self.assertEqual(Borrowing.objects.filter(member__isnull=True, member_student_id=member.student_id, status=Borrowing.BORROWED).count(), 1)

        due_soon_member, due_soon_client = self.make_student("DUE-SOON")
        due_soon_day = timezone.localdate() + timedelta(days=3)
        due_soon_loan = Borrowing.objects.create(
            book=self.book,
            member=due_soon_member,
            issue_code="CS-POLICY-DUE-SOON",
            copy_id="CSB-DUE-SOON",
            book_title=self.book.title,
            member_name=due_soon_member.name,
            member_student_id=due_soon_member.student_id,
            status=Borrowing.BORROWED,
            due_at=timezone.make_aware(datetime.combine(due_soon_day, time(12))),
        )
        due_soon_data = due_soon_client.get("/api/student/loans/").json()["results"][0]
        self.assertEqual(due_soon_data["id"], str(due_soon_loan.pk))
        self.assertEqual(due_soon_data["due_status"], "due_soon")
        self.assertEqual(due_soon_data["due_message"], "Due in 3 days")
        dashboard = self.staff_client.get("/api/dashboard/")
        self.assertEqual(dashboard.status_code, 200)
        self.assertEqual(dashboard.json()["overdue_loans"], 1)
        self.assertEqual(dashboard.json()["due_soon_loans"], 1)

        overdue_loan.status = Borrowing.RETURNED
        overdue_loan.returned_at = timezone.now()
        overdue_loan.save(update_fields=["status", "returned_at"])
        allowed_checkout = student_client.post("/api/student/issue/", {"copy_id": self.copy.copy_id})
        self.assertEqual(allowed_checkout.status_code, 201)

    def test_transaction_history_is_searchable_scoped_and_includes_fine_payment(self):
        member, student_client = self.make_student("HISTORY")
        other_member, _ = self.make_student("OTHER-HISTORY")
        now = timezone.now()
        loan = Borrowing.objects.create(
            book=self.book,
            member=member,
            book_copy=self.copy,
            issue_code="CS-HISTORY-001",
            copy_id=self.copy.copy_id,
            book_title=self.book.title,
            member_name=member.name,
            member_student_id=member.student_id,
            status=Borrowing.RETURNED,
            borrowed_at=now - timedelta(days=5),
            due_at=now - timedelta(days=3),
            returned_at=now - timedelta(days=2),
        )
        LoanRenewalRequest.objects.create(
            borrowing=loan,
            member=member,
            status=LoanRenewalRequest.APPROVED,
            created_at=now - timedelta(days=4),
            reviewed_at=now - timedelta(days=3),
            reviewed_by=self.staff,
        )
        FineEntry.objects.create(
            member=member,
            borrowing=loan,
            member_name=member.name,
            student_id=member.student_id,
            amount="40.00",
            fine_type=FineEntry.CUSTOM,
            reason="Late return charge",
            status=FineEntry.PAID,
            created_at=now - timedelta(days=2),
            paid_at=now - timedelta(days=1),
        )
        Borrowing.objects.create(
            member=other_member,
            issue_code="CS-HISTORY-OTHER",
            copy_id="CSB-OTHER",
            book_title="Private reader book",
            member_name=other_member.name,
            member_student_id=other_member.student_id,
            status=Borrowing.RETURNED,
            borrowed_at=now - timedelta(days=4),
            due_at=now - timedelta(days=2),
            returned_at=now - timedelta(days=1),
        )

        history = student_client.get("/api/student/transactions/?q=CS-HISTORY-001")
        self.assertEqual(history.status_code, 200)
        events = history.json()["results"]
        self.assertEqual({item["type"] for item in events}, {"checkout", "return", "renewal", "fine_added", "fine_paid"})
        self.assertTrue(all(item["student_id"] == member.student_id for item in events))
        self.assertFalse(any(item["student_id"] == other_member.student_id for item in events))
        self.assertEqual(next(item for item in events if item["type"] == "fine_paid")["amount"], "40.00")

        filtered = student_client.get("/api/student/transactions/?type=return&page_size=1")
        self.assertEqual(filtered.status_code, 200)
        self.assertEqual(len(filtered.json()["results"]), 1)
        self.assertEqual(filtered.json()["results"][0]["type"], "return")
        self.assertEqual(student_client.get("/api/transactions/").status_code, 403)
        self.assertEqual(self.staff_client.get("/api/transactions/?q=CS-HISTORY-001").json()["pagination"]["total"], 5)
        self.assertEqual(student_client.get("/api/student/transactions/?type=unknown").status_code, 400)

    def test_librarian_admin_can_filter_overdue_and_search_by_copy_or_issue(self):
        member, _ = self.make_student("ADMIN-FILTER")
        yesterday = timezone.localdate() - timedelta(days=1)
        Borrowing.objects.create(
            book=self.book,
            member=member,
            issue_code="CS-ADMIN-FILTER-OVERDUE",
            copy_id="CSB-ADMIN-FILTER",
            book_title=self.book.title,
            member_name=member.name,
            member_student_id=member.student_id,
            status=Borrowing.BORROWED,
            due_at=timezone.make_aware(datetime.combine(yesterday, time(12))),
        )
        admin_user = User.objects.create_superuser(
            username="admin-filter-test",
            email="admin-filter@campus.edu",
            password="StrongPass123!",
        )
        admin_client = Client()
        admin_client.force_login(admin_user)

        response = admin_client.get("/admin/library/borrowing/?due_status=overdue&q=CS-ADMIN-FILTER-OVERDUE")
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "CS-ADMIN-FILTER-OVERDUE")

    def test_qr_return_reconciles_copy_when_loan_snapshot_copy_id_is_stale(self):
        member, _ = self.make_student("STALE-COPY")
        loan = Borrowing.objects.create(
            book=None,
            member=member,
            book_copy=self.copy,
            issue_code="CS-STALE-COPY-SNAPSHOT",
            copy_id="CSB-UNKNOWN-COPY",
            book_title=self.book.title,
            member_name=member.name,
            member_student_id=member.student_id,
            status=Borrowing.BORROWED,
            borrowed_at=timezone.now(),
            due_at=timezone.now() + timedelta(days=14),
        )
        self.copy.status = BookCopy.BORROWED
        self.copy.current_member = member
        self.copy.current_issue_code = loan.issue_code
        self.copy.save(update_fields=["status", "current_member", "current_issue_code"])
        Book.objects.filter(pk=self.book.pk).update(copies=0, available=False)

        returned = self.staff_client.post("/api/returns/copy/", {"copy_id": self.copy.copy_id})

        self.assertEqual(returned.status_code, 200)
        self.assertEqual(returned.json()["loan"]["status"], Borrowing.RETURNED)
        self.copy.refresh_from_db()
        self.assertEqual(self.copy.status, BookCopy.AVAILABLE)
        self.book.refresh_from_db()
        self.assertEqual(self.book.copies, 1)

    def test_student_and_librarian_can_login_using_email(self):
        client = Client()
        member, _ = self.make_student("EMAIL")

        # 1. Student login using email
        student_login = client.post("/api/auth/login/", {
            "login_id": member.email,
            "password": "StudentPass123!",
        })
        self.assertEqual(student_login.status_code, 200)
        self.assertEqual(student_login.json()["user"]["role"], "student")
        self.assertEqual(student_login.json()["user"]["student_id"], member.student_id)

        # 2. Librarian login using email
        self.staff.email = "librarian.desk@campus.edu"
        self.staff.save(update_fields=["email"])

        librarian_login = client.post("/api/auth/login/", {
            "login_id": "librarian.desk@campus.edu",
            "password": "StrongPass123!",
        })
        self.assertEqual(librarian_login.status_code, 200)
        self.assertEqual(librarian_login.json()["user"]["role"], "librarian")

    def test_pod_booking_enforces_two_hour_limit_and_keeps_room_duration(self):
        member, student = self.make_student("PODLIMIT")
        pod = LibrarySpace.objects.create(name="Limited Pod", space_type=LibrarySpace.POD, capacity=2)
        room = LibrarySpace.objects.create(name="Long Meeting Room", space_type=LibrarySpace.ROOM, capacity=4)
        values = {"space_id": str(pod.pk), "booking_date": (timezone.localdate() + timedelta(days=1)).isoformat(),
                  "start_time": "10:00", "end_time": "12:01", "attendees_count": 1}
        for end in ["12:01", "13:00", "99:00", "09:00"]:
            rejected = student.post("/api/spaces/book/", {**values, "end_time": end})
            self.assertEqual(rejected.status_code, 400)
        self.assertEqual(SpaceBooking.objects.filter(space=pod).count(), 0)
        accepted = student.post("/api/spaces/book/", {**values, "end_time": "12:00"})
        self.assertEqual(accepted.status_code, 201)
        approved = self.staff_client.post(f"/api/librarian/space-bookings/{accepted.json()['booking']['id']}/approve/")
        self.assertEqual(approved.status_code, 200)
        late = student.post("/api/spaces/book/", {**values, "start_time": "19:00", "end_time": "20:00"})
        self.assertEqual(late.status_code, 201)
        room_booking = student.post("/api/spaces/book/", {**values, "space_id": str(room.pk), "end_time": "13:00"})
        self.assertEqual(room_booking.status_code, 201)

    def test_librarian_cannot_approve_legacy_overlong_pod_booking(self):
        member, _ = self.make_student("LEGACYPOD")
        pod = LibrarySpace.objects.create(name="Legacy Pod", space_type=LibrarySpace.POD, capacity=2)
        booking = SpaceBooking.objects.create(space=pod, member=member, space_name=pod.name,
            space_type=LibrarySpace.ROOM, student_name=member.name, student_id=member.student_id,
            booking_date=(timezone.localdate() + timedelta(days=1)).isoformat(), start_time="09:00", end_time="12:00")
        response = self.staff_client.post(f"/api/librarian/space-bookings/{booking.pk}/approve/")
        self.assertEqual(response.status_code, 400)
        self.assertIn("2 hours", response.json()["error"])
        booking.refresh_from_db()
        self.assertEqual(booking.status, SpaceBooking.PENDING)

    def test_space_booking_and_librarian_approval_flow(self):
        tomorrow = (timezone.localdate() + timedelta(days=1)).isoformat()
        member, student_client = self.make_student("SPACE")

        # Ensure spaces exist
        from library.api import ensure_default_spaces
        ensure_default_spaces()

        # 1. Spaces list shows spaces and initial empty slots
        spaces_res = student_client.get(f"/api/spaces/?date={tomorrow}")
        self.assertEqual(spaces_res.status_code, 200)
        spaces_data = spaces_res.json()["results"]
        self.assertTrue(len(spaces_data) >= 1)

        target_space = next(s for s in spaces_data if s["space_type"] == "room")
        space_id = target_space["id"]

        # 2. Student booking with attendees exceeding capacity is rejected
        excessive_booking = student_client.post("/api/spaces/book/", {
            "space_id": space_id,
            "booking_date": tomorrow,
            "start_time": "10:00",
            "end_time": "12:00",
            "attendees_count": target_space["capacity"] + 5,
            "purpose": "Big crowd",
        })
        self.assertEqual(excessive_booking.status_code, 400)
        self.assertIn("capacity", excessive_booking.json()["error"])

        # 3. Valid booking creates pending request
        valid_booking = student_client.post("/api/spaces/book/", {
            "space_id": space_id,
            "booking_date": tomorrow,
            "start_time": "10:00",
            "end_time": "12:00",
            "attendees_count": 4,
            "purpose": "Team project review",
        })
        self.assertEqual(valid_booking.status_code, 201)
        booking_id = valid_booking.json()["booking"]["id"]
        self.assertEqual(valid_booking.json()["booking"]["status"], SpaceBooking.PENDING)

        # 4. Check schedule: slots 10:00-11:00 and 11:00-12:00 are marked pending
        schedule_res = student_client.get(f"/api/spaces/?date={tomorrow}")
        updated_space = next(s for s in schedule_res.json()["results"] if s["id"] == space_id)
        slot_10 = next(sl for sl in updated_space["schedule"] if sl["start"] == "10:00")
        self.assertEqual(slot_10["status"], "pending")

        # 5. Overlapping booking request is blocked
        overlap_booking = student_client.post("/api/spaces/book/", {
            "space_id": space_id,
            "booking_date": tomorrow,
            "start_time": "11:00",
            "end_time": "13:00",
            "attendees_count": 2,
            "purpose": "Overlap attempt",
        })
        self.assertEqual(overlap_booking.status_code, 400)

        # 6. Booking is listed in librarian portal
        lib_bookings = self.staff_client.get("/api/librarian/space-bookings/?status=pending")
        self.assertEqual(lib_bookings.status_code, 200)
        self.assertTrue(any(b["id"] == booking_id for b in lib_bookings.json()["results"]))

        # 7. Librarian approves booking -> status becomes confirmed!
        approval_res = self.staff_client.post(f"/api/librarian/space-bookings/{booking_id}/approve/")
        self.assertEqual(approval_res.status_code, 200)
        self.assertEqual(approval_res.json()["booking"]["status"], SpaceBooking.CONFIRMED)

        # 8. Check schedule: slot 10:00-11:00 is now confirmed as occupied!
        occupied_schedule = student_client.get(f"/api/spaces/?date={tomorrow}")
        occupied_space = next(s for s in occupied_schedule.json()["results"] if s["id"] == space_id)
        slot_10_after = next(sl for sl in occupied_space["schedule"] if sl["start"] == "10:00")
        self.assertEqual(slot_10_after["status"], "occupied")



