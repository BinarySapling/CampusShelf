from django.contrib import admin

from .models import Book, BookCopy, BookReservation, Borrowing, FineEntry, LoanRenewalRequest, Member, Review, StudentSignupRequest


@admin.register(Book)
class BookAdmin(admin.ModelAdmin):
    list_display = ("title", "author", "category", "copies", "total_copies", "shelf")
    search_fields = ("title", "author", "isbn")
    list_filter = ("category",)


@admin.register(BookCopy)
class BookCopyAdmin(admin.ModelAdmin):
    list_display = ("copy_id", "book", "status", "shelf")
    search_fields = ("copy_id", "book__title")
    list_filter = ("status",)


@admin.register(Member)
class MemberAdmin(admin.ModelAdmin):
    list_display = ("student_id", "name", "email", "course", "year", "approval_status", "user")
    search_fields = ("student_id", "name", "email", "course")
    list_filter = ("course", "year", "approval_status")


@admin.register(StudentSignupRequest)
class StudentSignupRequestAdmin(admin.ModelAdmin):
    list_display = ("name", "email", "registration_number", "course", "status", "submitted_at")
    search_fields = ("name", "email", "registration_number", "course")
    list_filter = ("status", "course", "year")


@admin.register(Borrowing)
class BorrowingAdmin(admin.ModelAdmin):
    list_display = ("issue_code", "book_title", "member_name", "status", "borrowed_at", "due_at")
    search_fields = ("issue_code", "book_title", "member_name", "member_student_id")
    list_filter = ("status",)


@admin.register(BookReservation)
class BookReservationAdmin(admin.ModelAdmin):
    list_display = ("book_title", "member", "status", "created_at", "updated_at")
    search_fields = ("book_title", "member__name", "member__student_id")
    list_filter = ("status",)


@admin.register(LoanRenewalRequest)
class LoanRenewalRequestAdmin(admin.ModelAdmin):
    list_display = ("borrowing", "member", "status", "created_at", "reviewed_at", "reviewed_by")
    search_fields = ("borrowing__issue_code", "borrowing__book_title", "member__name", "member__student_id")
    list_filter = ("status",)


@admin.register(Review)
class ReviewAdmin(admin.ModelAdmin):
    list_display = ("book_title", "member_name", "rating", "created_at")
    search_fields = ("book_title", "member_name", "comment")
    list_filter = ("rating",)


@admin.register(FineEntry)
class FineEntryAdmin(admin.ModelAdmin):
    list_display = ("member_name", "student_id", "amount", "fine_type", "status", "created_at")
    search_fields = ("member_name", "student_id", "reason")
    list_filter = ("fine_type", "status")
