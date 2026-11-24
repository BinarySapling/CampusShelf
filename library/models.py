from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.utils import timezone


class Book(models.Model):
    title = models.CharField(max_length=120)
    author = models.CharField(max_length=100)
    category = models.CharField(max_length=40)
    isbn = models.CharField(max_length=20, blank=True, null=True)
    copies = models.PositiveIntegerField(default=0)
    total_copies = models.PositiveIntegerField(default=0)
    available = models.BooleanField(default=False)
    shelf = models.CharField(max_length=30, blank=True)
    description = models.CharField(max_length=300, blank=True)
    cover_url = models.URLField(max_length=1000, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "books"
        ordering = ["title"]
        indexes = [
            models.Index(fields=["category", "title"], name="book_category_title_idx"),
            models.Index(fields=["author", "title"], name="book_author_title_idx"),
            models.Index(fields=["-created_at"], name="book_created_desc_idx"),
        ]

    def __str__(self):
        return self.title


class Member(models.Model):
    APPROVED = "approved"
    PENDING = "pending"
    APPROVAL_CHOICES = [
        (APPROVED, "Approved"),
        (PENDING, "Pending"),
    ]

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="member_profile",
        null=True,
        blank=True,
    )
    student_id = models.CharField(max_length=32, unique=True)
    name = models.CharField(max_length=100)
    email = models.EmailField(max_length=160, unique=True)
    course = models.CharField(max_length=60)
    year = models.PositiveSmallIntegerField(default=1)
    approval_status = models.CharField(max_length=12, choices=APPROVAL_CHOICES, default=APPROVED)
    joined_at = models.DateTimeField(default=timezone.now)
    # The legacy MongoDB validator requires a non-empty value; passwords now live on Django User.
    password_hash = models.CharField(max_length=256, blank=True, default="!")

    class Meta:
        db_table = "members"
        ordering = ["name"]

    def __str__(self):
        return f"{self.student_id} · {self.name}"


class StudentSignupRequest(models.Model):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    STATUS_CHOICES = [
        (PENDING, "Pending"),
        (APPROVED, "Approved"),
        (REJECTED, "Rejected"),
    ]

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="signup_request")
    name = models.CharField(max_length=100)
    email = models.EmailField(max_length=160)
    registration_number = models.CharField(max_length=50)
    course = models.CharField(max_length=60)
    year = models.PositiveSmallIntegerField(default=1)
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default=PENDING)
    submitted_at = models.DateTimeField(default=timezone.now)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="reviewed_student_requests",
        null=True,
        blank=True,
    )

    class Meta:
        db_table = "student_requests"
        ordering = ["-submitted_at"]
        indexes = [models.Index(fields=["status", "-submitted_at"], name="signup_status_time_idx")]

    def __str__(self):
        return f"{self.name} · {self.status}"


class BookCopy(models.Model):
    AVAILABLE = "available"
    BORROWED = "borrowed"
    RETIRED = "retired"
    STATUS_CHOICES = [
        (AVAILABLE, "Available"),
        (BORROWED, "Borrowed"),
        (RETIRED, "Retired"),
    ]

    book = models.ForeignKey(Book, on_delete=models.PROTECT, related_name="physical_copies")
    copy_id = models.CharField(max_length=28, unique=True)
    book_title = models.CharField(max_length=120, blank=True)
    shelf = models.CharField(max_length=30, blank=True)
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default=AVAILABLE)
    current_issue_code = models.CharField(max_length=40, blank=True)
    current_member = models.ForeignKey(
        Member,
        on_delete=models.SET_NULL,
        related_name="copies_on_loan",
        null=True,
        blank=True,
    )
    created_at = models.DateTimeField(default=timezone.now)
    issued_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "book_copies"
        ordering = ["created_at"]
        indexes = [
            models.Index(fields=["book", "status"], name="book_copy_stock_lookup"),
            models.Index(fields=["book", "copy_id"], name="copy_book_code_idx"),
        ]

    def __str__(self):
        return self.copy_id


class Borrowing(models.Model):
    BORROWED = "borrowed"
    RETURNED = "returned"
    STATUS_CHOICES = [
        (BORROWED, "Borrowed"),
        (RETURNED, "Returned"),
    ]

    book = models.ForeignKey(
        Book,
        on_delete=models.SET_NULL,
        related_name="borrowings",
        null=True,
        blank=True,
    )
    member = models.ForeignKey(
        Member,
        on_delete=models.SET_NULL,
        related_name="borrowings",
        null=True,
        blank=True,
    )
    book_copy = models.ForeignKey(
        BookCopy,
        on_delete=models.SET_NULL,
        related_name="borrowings",
        null=True,
        blank=True,
    )
    issue_code = models.CharField(max_length=40, unique=True)
    copy_id = models.CharField(max_length=28, blank=True)
    book_title = models.CharField(max_length=120, blank=True)
    book_author = models.CharField(max_length=100, blank=True)
    book_shelf = models.CharField(max_length=30, blank=True)
    book_category = models.CharField(max_length=40, blank=True)
    member_name = models.CharField(max_length=100, blank=True)
    member_email = models.EmailField(max_length=160, blank=True)
    member_course = models.CharField(max_length=60, blank=True)
    member_year = models.PositiveSmallIntegerField(null=True, blank=True)
    member_student_id = models.CharField(max_length=32, blank=True)
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default=BORROWED)
    borrowed_at = models.DateTimeField(default=timezone.now)
    due_at = models.DateTimeField()
    returned_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "borrowings"
        ordering = ["-borrowed_at"]
        indexes = [
            models.Index(fields=["status", "due_at"], name="loans_due_status"),
            models.Index(fields=["member", "status", "borrowed_at"], name="loan_member_status_date_idx"),
            models.Index(fields=["member_student_id", "status", "borrowed_at"], name="loan_student_status_date_idx"),
            models.Index(fields=["book", "status"], name="loan_book_status_idx"),
            models.Index(fields=["copy_id", "status"], name="loan_copy_status_idx"),
            models.Index(fields=["-borrowed_at"], name="borrowed_at_-1"),
        ]

    def __str__(self):
        return self.issue_code


class BookReservation(models.Model):
    WAITING = "waiting"
    READY = "ready"
    FULFILLED = "fulfilled"
    CANCELLED = "cancelled"
    STATUS_CHOICES = [
        (WAITING, "Waiting"),
        (READY, "Ready for pickup"),
        (FULFILLED, "Fulfilled"),
        (CANCELLED, "Cancelled"),
    ]

    book = models.ForeignKey(Book, on_delete=models.PROTECT, related_name="reservations")
    member = models.ForeignKey(Member, on_delete=models.CASCADE, related_name="reservations")
    book_title = models.CharField(max_length=120)
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default=WAITING)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "book_reservations"
        ordering = ["created_at"]
        indexes = [
            models.Index(fields=["book", "status", "created_at"], name="res_book_status_time_idx"),
            models.Index(fields=["member", "status", "created_at"], name="res_member_status_time_idx"),
        ]

    def __str__(self):
        return f"{self.member} · {self.book_title} · {self.status}"


class LoanRenewalRequest(models.Model):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    STATUS_CHOICES = [
        (PENDING, "Pending"),
        (APPROVED, "Approved"),
        (REJECTED, "Rejected"),
    ]

    borrowing = models.ForeignKey(Borrowing, on_delete=models.CASCADE, related_name="renewal_requests")
    member = models.ForeignKey(Member, on_delete=models.CASCADE, related_name="renewal_requests")
    days_requested = models.PositiveSmallIntegerField(
        default=14,
        validators=[MinValueValidator(1), MaxValueValidator(14)],
    )
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default=PENDING)
    created_at = models.DateTimeField(default=timezone.now)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="reviewed_loan_renewals",
        null=True,
        blank=True,
    )

    class Meta:
        db_table = "loan_renewal_requests"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["borrowing", "-created_at"], name="renew_borrow_date_idx"),
            models.Index(fields=["member", "status", "-reviewed_at"], name="renew_member_review_idx"),
            models.Index(fields=["status", "created_at"], name="renew_status_date_idx"),
        ]

    def __str__(self):
        return f"{self.borrowing.issue_code} · {self.status}"


class FineEntry(models.Model):
    OVERDUE = "overdue"
    CUSTOM = "custom"
    TYPE_CHOICES = [
        (OVERDUE, "Overdue"),
        (CUSTOM, "Custom"),
    ]
    UNPAID = "unpaid"
    PAID = "paid"
    STATUS_CHOICES = [
        (UNPAID, "Unpaid"),
        (PAID, "Paid"),
    ]

    member = models.ForeignKey(
        Member,
        on_delete=models.SET_NULL,
        related_name="fines",
        null=True,
        blank=True,
    )
    borrowing = models.ForeignKey(
        Borrowing,
        on_delete=models.SET_NULL,
        related_name="fine_entries",
        null=True,
        blank=True,
    )
    member_name = models.CharField(max_length=100)
    student_id = models.CharField(max_length=32, blank=True)
    amount = models.DecimalField(max_digits=8, decimal_places=2)
    fine_type = models.CharField(max_length=12, choices=TYPE_CHOICES)
    reason = models.CharField(max_length=200)
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default=UNPAID)
    created_at = models.DateTimeField(default=timezone.now)
    paid_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="created_fine_entries",
        null=True,
        blank=True,
    )

    class Meta:
        db_table = "fine_entries"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["member", "status"], name="fine_member_status_idx"),
            models.Index(fields=["student_id", "status"], name="fine_student_status_idx"),
            models.Index(fields=["status", "-created_at"], name="fine_status_created_idx"),
        ]

    def __str__(self):
        return f"₹{self.amount} · {self.member_name} · {self.status}"


class Review(models.Model):
    book = models.ForeignKey(
        Book,
        on_delete=models.SET_NULL,
        related_name="reviews",
        null=True,
        blank=True,
    )
    member = models.ForeignKey(
        Member,
        on_delete=models.SET_NULL,
        related_name="reviews",
        null=True,
        blank=True,
    )
    book_title = models.CharField(max_length=120, blank=True)
    member_name = models.CharField(max_length=100, blank=True)
    rating = models.PositiveSmallIntegerField()
    comment = models.CharField(max_length=500, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "reviews"
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["book", "-created_at"], name="review_book_time_idx")]

    def __str__(self):
        return f"{self.rating}/5 · {self.book_title or self.book}"


class LibrarySpace(models.Model):
    POD = "pod"
    ROOM = "room"
    SLOT = "slot"
    TYPE_CHOICES = [
        (POD, "Study Pod"),
        (ROOM, "Conference Room"),
        (SLOT, "Study Slot"),
    ]

    name = models.CharField(max_length=100, unique=True)
    space_type = models.CharField(max_length=20, choices=TYPE_CHOICES)
    capacity = models.PositiveIntegerField(default=1)
    location = models.CharField(max_length=100, blank=True)
    description = models.CharField(max_length=250, blank=True)
    amenities = models.CharField(max_length=250, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "library_spaces"
        ordering = ["space_type", "name"]

    def __str__(self):
        return f"{self.name} ({self.get_space_type_display()})"


class SpaceBooking(models.Model):
    PENDING = "pending"
    CONFIRMED = "confirmed"
    REJECTED = "rejected"
    CANCELLED = "cancelled"
    STATUS_CHOICES = [
        (PENDING, "Pending Approval"),
        (CONFIRMED, "Confirmed"),
        (REJECTED, "Rejected"),
        (CANCELLED, "Cancelled"),
    ]

    space = models.ForeignKey(
        LibrarySpace,
        on_delete=models.CASCADE,
        related_name="bookings",
    )
    space_name = models.CharField(max_length=100, blank=True)
    space_type = models.CharField(max_length=20, blank=True)
    member = models.ForeignKey(
        Member,
        on_delete=models.CASCADE,
        related_name="space_bookings",
    )
    student_name = models.CharField(max_length=100, blank=True)
    student_id = models.CharField(max_length=32, blank=True)
    student_email = models.EmailField(max_length=160, blank=True)
    booking_date = models.CharField(max_length=10)
    start_time = models.CharField(max_length=5)
    end_time = models.CharField(max_length=5)
    attendees_count = models.PositiveIntegerField(default=1)
    purpose = models.CharField(max_length=250, blank=True)
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default=PENDING)
    rejection_reason = models.CharField(max_length=250, blank=True)
    created_at = models.DateTimeField(default=timezone.now)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="reviewed_space_bookings",
        null=True,
        blank=True,
    )

    class Meta:
        db_table = "space_bookings"
        ordering = ["-booking_date", "-start_time"]
        indexes = [
            models.Index(fields=["status", "-created_at"], name="space_status_date_idx"),
            models.Index(fields=["member", "booking_date", "start_time"], name="space_member_slot_idx"),
            models.Index(fields=["space", "booking_date", "status", "start_time"], name="space_slot_status_idx"),
        ]

    def __str__(self):
        return f"{self.space_name} · {self.booking_date} {self.start_time}-{self.end_time} · {self.student_name} ({self.status})"


