from datetime import datetime, time, timedelta

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import Client, TestCase, override_settings
from django.utils import timezone

from .models import Book, BookCopy, Borrowing, FineEntry, Member, Review, StudentSignupRequest
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
        signup = StudentSignupRequest.objects.get(email="new.reader@campus.edu")
        self.assertFalse(signup.user.is_active)
        self.assertFalse(Member.objects.filter(email=signup.email).exists())

        approval = self.staff_client.post(f"/api/requests/{signup.id}/approve/")
        self.assertEqual(approval.status_code, 200)
        signup.refresh_from_db()
        signup.user.refresh_from_db()
        member = Member.objects.get(email=signup.email)
        self.assertEqual(signup.status, StudentSignupRequest.APPROVED)
        self.assertEqual(signup.user.username, member.student_id)
        self.assertTrue(signup.user.is_active)

        student_client = Client()
        login = student_client.post("/api/auth/login/", {
            "login_id": member.student_id,
            "password": "NewStudentPass123!",
        })
        self.assertEqual(login.status_code, 200)
        self.assertEqual(login.json()["user"]["role"], "student")

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

    def test_librarian_can_add_and_mark_a_custom_fine_paid(self):
        member = Member.objects.create(
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

        paid = self.staff_client.post(f"/api/fines/{fine.id}/paid/")
        self.assertEqual(paid.status_code, 200)
        fine.refresh_from_db()
        self.assertEqual(fine.status, FineEntry.PAID)
        self.assertIsNotNone(fine.paid_at)

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

