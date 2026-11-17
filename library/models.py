from django.conf import settings
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
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "books"
        ordering = ["title"]

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

    def __str__(self):
        return f"{self.name} · {self.status}"


class BookCopy(models.Model):
    AVAILABLE = "available"
    BORROWED = "borrowed"
    STATUS_CHOICES = [
        (AVAILABLE, "Available"),
        (BORROWED, "Borrowed"),
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

    def __str__(self):
        return self.issue_code


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
    comment = models.CharField(max_length=500)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "reviews"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.rating}/5 · {self.book_title or self.book}"

