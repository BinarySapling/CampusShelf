import json
from types import SimpleNamespace
from unittest.mock import patch

from bson import ObjectId
from django.test import RequestFactory, SimpleTestCase

from library.api import scan_copy
from library.models import BookCopy


class ScanDetailsTests(SimpleTestCase):
    def test_scan_includes_book_details_and_the_exact_copy(self):
        book = SimpleNamespace(
            pk=ObjectId(), title="1984", author="George Orwell",
            category="Fiction", isbn="9780451524935", shelf="F-04",
            description="A dystopian novel.", cover_url="",
        )
        copy = SimpleNamespace(
            copy_id="CSB-TEST-1984", book=book,
            status=BookCopy.AVAILABLE, shelf="F-05",
        )
        request = RequestFactory().get("/api/copies/CSB-TEST-1984/")
        request.user = SimpleNamespace(is_authenticated=True)

        # Keep this response test independent of the live MongoDB database.
        with patch("library.api.account_data", return_value={"role": "student"}), \
             patch("library.api.BookCopy.objects.filter") as copies, \
             patch("library.api.Borrowing.objects.filter") as loans, \
             patch("library.api.BookReservation.objects.filter") as reservations:
            copies.return_value.select_related.return_value.first.return_value = copy
            copies.return_value.exclude.return_value = [copy]
            loans.return_value.order_by.return_value.first.return_value = None
            reservations.return_value.count.return_value = 0

            response = scan_copy(request, copy.copy_id)

        details = json.loads(response.content)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(details["copy_id"], copy.copy_id)
        self.assertEqual(details["status"], BookCopy.AVAILABLE)
        self.assertEqual(details["shelf"], "F-05")
        self.assertEqual(details["book"]["title"], "1984")
        self.assertEqual(details["book"]["author"], "George Orwell")
        self.assertEqual(details["book"]["category"], "Fiction")
        self.assertEqual(details["book"]["isbn"], "9780451524935")
        self.assertEqual(details["book"]["description"], "A dystopian novel.")
        self.assertEqual(details["book"]["shelf"], "F-04")
        self.assertEqual(details["book"]["available_to_borrow"], 1)
        self.assertEqual(details["book"]["total"], 1)

    def test_scan_still_requires_sign_in(self):
        request = RequestFactory().get("/api/copies/CSB-TEST-1984/")
        request.user = SimpleNamespace(is_authenticated=False)
        self.assertEqual(scan_copy(request, "CSB-TEST-1984").status_code, 401)
