from datetime import datetime, time, timedelta

from django.contrib import admin
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


class LoanDueFilter(admin.SimpleListFilter):
    title = "due status"
    parameter_name = "due_status"

    def lookups(self, request, model_admin):
        return (
            ("overdue", "Overdue"),
            ("due_soon", "Due within 3 days"),
            ("on_track", "Due later"),
            ("returned", "Returned"),
        )

    def queryset(self, request, queryset):
        today = timezone.localdate()
        start_today = timezone.make_aware(datetime.combine(today, time.min))
        after_due_soon = timezone.make_aware(datetime.combine(today + timedelta(days=4), time.min))
        if self.value() == "overdue":
            return queryset.filter(status=Borrowing.BORROWED, due_at__lt=start_today)
        if self.value() == "due_soon":
            return queryset.filter(
                status=Borrowing.BORROWED,
                due_at__gte=start_today,
                due_at__lt=after_due_soon,
            )
        if self.value() == "on_track":
            return queryset.filter(status=Borrowing.BORROWED, due_at__gte=after_due_soon)
        if self.value() == "returned":
            return queryset.filter(status=Borrowing.RETURNED)
        return queryset


@admin.register(Borrowing)
class BorrowingAdmin(admin.ModelAdmin):
    list_display = ("issue_code", "book_title", "member_name", "copy_id", "status", "borrowed_at", "due_at", "due_state")
    search_fields = ("issue_code", "book_title", "member_name", "member_student_id", "member_email", "copy_id")
    list_filter = ("status", "borrowed_at", LoanDueFilter)
    date_hierarchy = "borrowed_at"
    ordering = ("-borrowed_at",)

    @admin.display(description="Due state", ordering="due_at")
    def due_state(self, obj):
        if obj.status != Borrowing.BORROWED:
            return "Returned"
        due_day = timezone.localtime(obj.due_at).date()
        days = (due_day - timezone.localdate()).days
        if days < 0:
            return f"Overdue · {-days}d"
        if days <= 3:
            return "Due today" if days == 0 else f"Due in {days}d"
        return "On time"


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


@admin.register(LibrarySpace)
class LibrarySpaceAdmin(admin.ModelAdmin):
    list_display = ("name", "space_type", "capacity", "location", "is_active")
    search_fields = ("name", "location", "description")
    list_filter = ("space_type", "is_active")


@admin.register(SpaceBooking)
class SpaceBookingAdmin(admin.ModelAdmin):
    list_display = ("space_name", "booking_date", "start_time", "end_time", "student_name", "attendees_count", "status")
    search_fields = ("space_name", "student_name", "student_id", "purpose")
    list_filter = ("status", "space_type", "booking_date")

