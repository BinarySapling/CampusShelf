import secrets

from bson import ObjectId
from django.core.management.base import BaseCommand

from library.models import Book, BookCopy, Member


class Command(BaseCommand):
    help = "Add a small sample catalogue and student list when those collections are empty."

    def handle(self, *args, **options):
        if not Book.objects.exists():
            self.add_sample_books()
            self.stdout.write(self.style.SUCCESS("Added sample books and copy labels."))
        else:
            self.stdout.write("Books already exist; leaving the catalogue unchanged.")

        if not Member.objects.exists():
            self.add_sample_students()
            self.stdout.write(self.style.SUCCESS("Added sample student records."))
        else:
            self.stdout.write("Students already exist; leaving the directory unchanged.")

    def add_sample_books(self):
        sample_books = [
            ("Atomic Habits", "James Clear", "Self Growth", "9780735211292", 4, "A-01"),
            ("Clean Code", "Robert C. Martin", "Technology", "9780132350884", 2, "T-04"),
            ("The Alchemist", "Paulo Coelho", "Fiction", "9780061122415", 3, "F-02"),
            ("Deep Work", "Cal Newport", "Productivity", "9781455586691", 2, "P-03"),
            ("The Design of Everyday Things", "Don Norman", "Design", "9780465050659", 1, "D-01"),
        ]
        descriptions = [
            "Tiny systems, remarkable change.",
            "A practical guide to readable software.",
            "A journey toward purpose and possibility.",
            "Build focus in a distracted world.",
            "Understand the design behind everyday objects.",
        ]
        for row, description in zip(sample_books, descriptions):
            title, author, category, isbn, copy_count, shelf = row
            book = Book.objects.create(
                title=title,
                author=author,
                category=category,
                isbn=isbn,
                copies=copy_count,
                total_copies=copy_count,
                available=copy_count > 0,
                shelf=shelf,
                description=description,
            )
            for _ in range(copy_count):
                copy_id = ObjectId()
                BookCopy.objects.create(
                    id=copy_id,
                    book=book,
                    copy_id=f"CSB-{str(copy_id).upper()}",
                    book_title=book.title,
                    shelf=book.shelf,
                    status=BookCopy.AVAILABLE,
                )

    def add_sample_students(self):
        sample_students = [
            ("Aarav Sharma", "aarav@campus.edu", "CSE", 3),
            ("Meera Kapoor", "meera@campus.edu", "Design", 2),
            ("Kabir Singh", "kabir@campus.edu", "ECE", 3),
        ]
        for name, email, course, year in sample_students:
            student_id = f"STU-{secrets.token_hex(5).upper()}"
            Member.objects.create(
                student_id=student_id,
                name=name,
                email=email,
                course=course,
                year=year,
            )
