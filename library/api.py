from functools import wraps

from bson import ObjectId
from django.contrib.auth import authenticate, get_user_model
from django.contrib.auth import login as auth_login
from django.contrib.auth import logout as auth_logout
from django.db.models import Q
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_POST

from .forms import (
    BookForm,
    CustomFineForm,
    FirstLibrarianForm,
    LibrarianForm,
    LoginForm,
    ManualIssueForm,
    ReviewForm,
    StudentIssueForm,
    StudentSignupForm,
)
from .models import Book, BookCopy, Borrowing, FineEntry, Member, Review, StudentSignupRequest
from .views import (
    LIBRARIAN_GROUP,
    STUDENT_GROUP,
    add_to_group,
    complete_return,
    copy_code_for,
    create_borrowing,
    make_staff_id,
    overdue_fine,
    to_object_id,
)


User = get_user_model()


def form_errors(form):
    return {field: [str(error) for error in errors] for field, errors in form.errors.items()}


def is_librarian(user):
    return user.is_authenticated and (
        user.is_superuser or user.groups.filter(name=LIBRARIAN_GROUP).exists()
    )


def librarian_api(view_func):
    @wraps(view_func)
    def wrapped(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return JsonResponse({"error": "Please sign in first."}, status=401)
        if not is_librarian(request.user):
            return JsonResponse({"error": "Librarian access is required."}, status=403)
        return view_func(request, *args, **kwargs)

    return wrapped


def student_api(view_func):
    @wraps(view_func)
    def wrapped(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return JsonResponse({"error": "Please sign in first."}, status=401)
        member = Member.objects.filter(user=request.user, approval_status=Member.APPROVED).first()
        if not member:
            return JsonResponse({"error": "An approved student account is required."}, status=403)
        request.student_member = member
        return view_func(request, *args, **kwargs)

    return wrapped


def account_data(user):
    if is_librarian(user):
        return {
            "id": str(user.pk),
            "name": user.first_name or user.username,
            "role": "librarian",
            "login_id": user.username,
        }

    member = Member.objects.filter(user=user, approval_status=Member.APPROVED).first()
    if member:
        return {
            "id": str(member.pk),
            "name": member.name,
            "role": "student",
            "student_id": member.student_id,
        }
    return None


def book_data(book):
    copies = list(BookCopy.objects.filter(book=book))
    return {
        "id": str(book.pk),
        "title": book.title,
        "author": book.author,
        "category": book.category,
        "isbn": book.isbn or "",
        "shelf": book.shelf,
        "description": book.description,
        "available": sum(copy.status == BookCopy.AVAILABLE for copy in copies),
        "total": len(copies),
    }


def borrowing_data(record):
    days, amount = overdue_fine(record) if record.status == Borrowing.BORROWED else (0, 0)
    return {
        "id": str(record.pk),
        "issue_code": record.issue_code,
        "copy_id": record.copy_id,
        "book_title": record.book_title,
        "member_name": record.member_name,
        "student_id": record.member_student_id,
        "status": record.status,
        "borrowed_at": record.borrowed_at.isoformat(),
        "due_at": record.due_at.isoformat(),
        "returned_at": record.returned_at.isoformat() if record.returned_at else "",
        "overdue_days": days,
        "current_fine": str(amount),
    }


def fine_data(entry):
    return {
        "id": str(entry.pk),
        "member_name": entry.member_name,
        "student_id": entry.student_id,
        "amount": str(entry.amount),
        "fine_type": entry.fine_type,
        "reason": entry.reason,
        "status": entry.status,
        "created_at": entry.created_at.isoformat(),
        "paid_at": entry.paid_at.isoformat() if entry.paid_at else "",
    }


@ensure_csrf_cookie
@require_GET
def csrf_token(request):
    return JsonResponse({"ok": True})


@require_GET
def auth_session(request):
    account = account_data(request.user) if request.user.is_authenticated else None
    if not account and request.user.is_authenticated:
        auth_logout(request)
    setup_available = not User.objects.filter(groups__name=LIBRARIAN_GROUP, is_active=True).exists()
    return JsonResponse({"user": account, "setup_available": setup_available})


@require_POST
def login_user(request):
    form = LoginForm(request.POST)
    if not form.is_valid():
        return JsonResponse({"errors": form_errors(form)}, status=400)

    login_id = form.cleaned_data["login_id"].strip()
    account_user = User.objects.filter(username__iexact=login_id).first()
    user = authenticate(
        request,
        username=account_user.username if account_user else login_id,
        password=form.cleaned_data["password"],
    )
    if user is None:
        return JsonResponse({"error": "The ID and password did not match an active account."}, status=400)

    account = account_data(user)
    if not account:
        return JsonResponse({"error": "This account is waiting for librarian approval."}, status=403)
    auth_login(request, user)
    return JsonResponse({"user": account})


@require_POST
def setup_librarian(request):
    if User.objects.filter(groups__name=LIBRARIAN_GROUP, is_active=True).exists():
        return JsonResponse({"error": "A librarian account has already been set up."}, status=409)

    form = FirstLibrarianForm(request.POST)
    if not form.is_valid():
        return JsonResponse({"errors": form_errors(form)}, status=400)

    user = User.objects.create_user(
        username=make_staff_id("LIB"),
        first_name=form.cleaned_data["name"].strip(),
        password=form.cleaned_data["password"],
    )
    add_to_group(user, LIBRARIAN_GROUP)
    auth_login(request, user)
    return JsonResponse({"user": account_data(user)})


@require_POST
def logout_user(request):
    auth_logout(request)
    return JsonResponse({"ok": True})


@require_POST
def submit_signup(request):
    form = StudentSignupForm(request.POST)
    if not form.is_valid():
        return JsonResponse({"errors": form_errors(form)}, status=400)

    values = form.cleaned_data
    email = values["email"]
    if StudentSignupRequest.objects.filter(email__iexact=email, status=StudentSignupRequest.PENDING).exists():
        return JsonResponse({"error": "A signup request for this email is already waiting for review."}, status=409)
    existing_user = User.objects.filter(email__iexact=email).first()
    if existing_user:
        old_request = StudentSignupRequest.objects.filter(user=existing_user).first()
        if old_request and old_request.status == StudentSignupRequest.REJECTED:
            existing_user.first_name = values["name"].strip()
            existing_user.set_password(values["password"])
            existing_user.save(update_fields=["first_name", "password"])
            old_request.name = values["name"].strip()
            old_request.registration_number = values["registration_number"].strip()
            old_request.course = values["course"].strip()
            old_request.year = values["year"]
            old_request.status = StudentSignupRequest.PENDING
            old_request.reviewed_by = None
            old_request.reviewed_at = None
            old_request.submitted_at = timezone.now()
            old_request.save(update_fields=[
                "name", "registration_number", "course", "year", "status",
                "reviewed_by", "reviewed_at", "submitted_at",
            ])
            return JsonResponse({"message": "Your signup request was sent to a librarian for approval."}, status=201)
        elif old_request:
            return JsonResponse({"error": "This email already has an account request."}, status=409)
        elif existing_user.is_active:
            return JsonResponse({"error": "An account with this email already exists."}, status=409)
        else:
            return JsonResponse({"error": "Please ask a librarian to review your existing account."}, status=409)

    user = User.objects.create_user(
        username=email,
        email=email,
        first_name=values["name"].strip(),
        password=values["password"],
        is_active=False,
    )
    StudentSignupRequest.objects.create(
        user=user,
        name=values["name"].strip(),
        email=email,
        registration_number=values["registration_number"].strip(),
        course=values["course"].strip(),
        year=values["year"],
    )
    return JsonResponse({"message": "Your signup request was sent to a librarian for approval."}, status=201)


@librarian_api
@require_GET
def requests_list(request):
    requests = StudentSignupRequest.objects.all()
    return JsonResponse({"results": [{
        "id": str(item.pk),
        "name": item.name,
        "email": item.email,
        "registration_number": item.registration_number,
        "course": item.course,
        "year": item.year,
        "status": item.status,
        "submitted_at": item.submitted_at.isoformat(),
    } for item in requests]})


@librarian_api
@require_POST
def review_signup(request, request_id, action):
    signup_id = to_object_id(request_id)
    signup = StudentSignupRequest.objects.filter(pk=signup_id).first() if signup_id else None
    if not signup or signup.status != StudentSignupRequest.PENDING:
        return JsonResponse({"error": "That request is missing or already reviewed."}, status=404)
    if action not in ("approve", "reject"):
        return JsonResponse({"error": "Choose approve or reject."}, status=400)

    if action == "reject":
        signup.status = StudentSignupRequest.REJECTED
        signup.reviewed_by = request.user
        signup.reviewed_at = timezone.now()
        signup.save(update_fields=["status", "reviewed_by", "reviewed_at"])
        signup.user.is_active = False
        signup.user.save(update_fields=["is_active"])
        return JsonResponse({"message": "Signup request rejected."})

    member = Member.objects.filter(email__iexact=signup.email).first()
    if member and member.user_id and member.user_id != signup.user_id:
        return JsonResponse({"error": "A different portal account is already linked to this student."}, status=409)

    if member:
        member.user = signup.user
        member.approval_status = Member.APPROVED
        member.save(update_fields=["user", "approval_status"])
        student_id = member.student_id
    else:
        student_id = make_staff_id("STU").upper()
        member = Member.objects.create(
            user=signup.user,
            student_id=student_id,
            name=signup.name,
            email=signup.email,
            course=signup.course,
            year=signup.year,
            approval_status=Member.APPROVED,
        )

    signup.user.username = student_id
    signup.user.email = signup.email
    signup.user.first_name = signup.name
    signup.user.is_active = True
    signup.user.save(update_fields=["username", "email", "first_name", "is_active"])
    add_to_group(signup.user, STUDENT_GROUP)
    signup.status = StudentSignupRequest.APPROVED
    signup.reviewed_by = request.user
    signup.reviewed_at = timezone.now()
    signup.save(update_fields=["status", "reviewed_by", "reviewed_at"])
    return JsonResponse({"message": "Student approved.", "student_id": student_id})


@librarian_api
@require_GET
def members_list(request):
    members = Member.objects.filter(approval_status=Member.APPROVED)
    results = []
    for member in members:
        fixed_total = sum(
            (fine.amount for fine in FineEntry.objects.filter(member=member, status=FineEntry.UNPAID)),
            start=0,
        )
        current_total = sum(
            (overdue_fine(loan)[1] for loan in Borrowing.objects.filter(member=member, status=Borrowing.BORROWED)),
            start=0,
        )
        results.append({
            "id": str(member.pk),
            "student_id": member.student_id,
            "name": member.name,
            "email": member.email,
            "course": member.course,
            "year": member.year,
            "approval_status": member.approval_status,
            "portal_ready": bool(member.user and member.user.is_active),
            "fine_balance": str(fixed_total + current_total),
        })
    return JsonResponse({"results": results})


@require_GET
def catalogue(request):
    query = request.GET.get("q", "").strip()
    books = Book.objects.all()
    if query:
        books = books.filter(Q(title__icontains=query) | Q(author__icontains=query))
    return JsonResponse({"results": [book_data(book) for book in books[:100]]})


@librarian_api
def books_api(request):
    if request.method == "GET":
        query = request.GET.get("q", "").strip()
        books = Book.objects.all()
        if query:
            books = books.filter(Q(title__icontains=query) | Q(author__icontains=query))
        return JsonResponse({"results": [book_data(book) for book in books[:200]]})
    if request.method != "POST":
        return JsonResponse({"error": "Use GET or POST."}, status=405)

    form = BookForm(request.POST)
    if not form.is_valid():
        return JsonResponse({"errors": form_errors(form)}, status=400)
    book = form.save(commit=False)
    book.shelf = book.shelf or "Unassigned"
    book.total_copies = book.copies
    book.available = book.copies > 0
    book.save()
    for _ in range(book.total_copies):
        copy_id = ObjectId()
        BookCopy.objects.create(
            id=copy_id,
            book=book,
            copy_id=copy_code_for(copy_id),
            book_title=book.title,
            shelf=book.shelf,
        )
    return JsonResponse({"book": book_data(book)}, status=201)


@librarian_api
@require_GET
def copies_list(request, book_id):
    object_id = to_object_id(book_id)
    book = get_object_or_404(Book, pk=object_id) if object_id else None
    copies = BookCopy.objects.filter(book=book).order_by("copy_id")
    return JsonResponse({"results": [{
        "id": str(copy.pk),
        "copy_id": copy.copy_id,
        "status": copy.status,
        "shelf": copy.shelf,
        "book_title": book.title,
    } for copy in copies]})


@librarian_api
@require_GET
def copy_lookup(request, copy_id):
    copy = BookCopy.objects.filter(copy_id=copy_id.strip().upper()).select_related("book").first()
    if not copy:
        return JsonResponse({"error": "Copy ID not found."}, status=404)
    active_loan = Borrowing.objects.filter(book_copy=copy, status=Borrowing.BORROWED).first()
    return JsonResponse({
        "copy_id": copy.copy_id,
        "status": copy.status,
        "book_title": copy.book.title,
        "member_name": active_loan.member_name if active_loan else "",
        "issue_code": active_loan.issue_code if active_loan else "",
    })


@require_GET
def scan_copy(request, copy_id):
    account = account_data(request.user) if request.user.is_authenticated else None
    if not account:
        return JsonResponse({"error": "Please sign in first."}, status=401)
    copy = BookCopy.objects.filter(copy_id=copy_id.strip().upper()).select_related("book").first()
    if not copy:
        return JsonResponse({"error": "Copy ID not found."}, status=404)
    return JsonResponse({
        "copy_id": copy.copy_id,
        "status": copy.status,
        "book_title": copy.book.title,
        "shelf": copy.shelf,
    })


@librarian_api
def loans_api(request):
    if request.method == "GET":
        loans = Borrowing.objects.all()[:200]
        return JsonResponse({"results": [borrowing_data(record) for record in loans]})
    if request.method != "POST":
        return JsonResponse({"error": "Use GET or POST."}, status=405)

    form = ManualIssueForm(request.POST)
    if not form.is_valid():
        return JsonResponse({"errors": form_errors(form)}, status=400)
    member_id = to_object_id(form.cleaned_data["member_id"])
    member = Member.objects.filter(pk=member_id, approval_status=Member.APPROVED).first() if member_id else None
    copy = BookCopy.objects.filter(copy_id=form.cleaned_data["copy_id"].strip().upper()).first()
    if not member or not copy:
        return JsonResponse({"error": "Choose a student and a valid Copy ID."}, status=404)
    active_count = Borrowing.objects.filter(member=member, status=Borrowing.BORROWED).count()
    if active_count >= 5:
        return JsonResponse({"error": "This student has reached the five active book limit."}, status=409)
    record = create_borrowing(member, copy)
    if not record:
        return JsonResponse({"error": "That copy is already on loan. Scan another copy."}, status=409)
    return JsonResponse({"loan": borrowing_data(record)}, status=201)


@student_api
@require_POST
def student_issue(request):
    form = StudentIssueForm(request.POST)
    if not form.is_valid():
        return JsonResponse({"errors": form_errors(form)}, status=400)
    member = request.student_member
    active_count = Borrowing.objects.filter(member=member, status=Borrowing.BORROWED).count()
    if active_count >= 5:
        return JsonResponse({"error": "You have reached the five active book limit."}, status=409)
    copy = BookCopy.objects.filter(
        copy_id=form.cleaned_data["copy_id"].strip().upper(),
        status=BookCopy.AVAILABLE,
    ).first()
    if not copy:
        return JsonResponse({"error": "This copy is not available. Please choose another."}, status=409)
    record = create_borrowing(member, copy)
    if not record:
        return JsonResponse({"error": "This copy was just checked out. Please try another."}, status=409)
    slip_codes = request.session.get("student_issue_codes", [])
    slip_codes.append(record.issue_code)
    request.session["student_issue_codes"] = slip_codes[-5:]
    return JsonResponse({"loan": borrowing_data(record)}, status=201)


@student_api
@require_GET
def student_loans(request):
    loans = Borrowing.objects.filter(member=request.student_member)[:100]
    return JsonResponse({"results": [borrowing_data(record) for record in loans]})


@librarian_api
@require_POST
def return_copy(request):
    copy_id = request.POST.get("copy_id", "").strip().upper()
    copy = BookCopy.objects.filter(copy_id=copy_id, status=BookCopy.BORROWED).first()
    record = Borrowing.objects.filter(book_copy=copy, status=Borrowing.BORROWED).first() if copy else None
    if not record:
        return JsonResponse({"error": "No active loan was found for that Copy ID."}, status=404)
    if not complete_return(record, returned_by=request.user):
        return JsonResponse({"error": "This copy has already been returned."}, status=409)
    record.refresh_from_db()
    fine = FineEntry.objects.filter(borrowing=record, fine_type=FineEntry.OVERDUE).first()
    return JsonResponse({
        "message": "Book returned.",
        "loan": borrowing_data(record),
        "fine": fine_data(fine) if fine else None,
    })


@require_GET
def fines_list(request):
    if not request.user.is_authenticated:
        return JsonResponse({"error": "Please sign in first."}, status=401)
    if is_librarian(request.user):
        entries = FineEntry.objects.all()[:300]
        active_loans = Borrowing.objects.filter(status=Borrowing.BORROWED)
    else:
        member = Member.objects.filter(user=request.user, approval_status=Member.APPROVED).first()
        if not member:
            return JsonResponse({"error": "An approved student account is required."}, status=403)
        entries = FineEntry.objects.filter(member=member)[:100]
        active_loans = Borrowing.objects.filter(member=member, status=Borrowing.BORROWED)

    fixed_entries = [fine_data(entry) for entry in entries]
    current_entries = []
    for loan in active_loans:
        days, amount = overdue_fine(loan)
        if days:
            current_entries.append({
                "id": f"current-{loan.pk}",
                "member_name": loan.member_name,
                "student_id": loan.member_student_id,
                "amount": str(amount),
                "fine_type": FineEntry.OVERDUE,
                "reason": f"{days} overdue calendar day(s) at ₹20 per day",
                "status": FineEntry.UNPAID,
                "created_at": timezone.now().isoformat(),
                "paid_at": "",
                "current": True,
            })
    return JsonResponse({"results": current_entries + fixed_entries})


@librarian_api
@require_POST
def create_custom_fine(request):
    form = CustomFineForm(request.POST)
    if not form.is_valid():
        return JsonResponse({"errors": form_errors(form)}, status=400)
    member_id = to_object_id(form.cleaned_data["member_id"])
    member = Member.objects.filter(pk=member_id).first() if member_id else None
    if not member:
        return JsonResponse({"error": "Choose a valid student."}, status=404)
    fine = FineEntry.objects.create(
        member=member,
        member_name=member.name,
        student_id=member.student_id,
        amount=form.cleaned_data["amount"],
        fine_type=FineEntry.CUSTOM,
        reason=form.cleaned_data["reason"].strip(),
        created_by=request.user,
    )
    return JsonResponse({"fine": fine_data(fine)}, status=201)


@librarian_api
@require_POST
def mark_fine_paid(request, fine_id):
    object_id = to_object_id(fine_id)
    fine = FineEntry.objects.filter(pk=object_id).first() if object_id else None
    if not fine:
        return JsonResponse({"error": "Fine entry not found."}, status=404)
    if fine.status == FineEntry.UNPAID:
        fine.status = FineEntry.PAID
        fine.paid_at = timezone.now()
        fine.save(update_fields=["status", "paid_at"])
    return JsonResponse({"fine": fine_data(fine)})


@librarian_api
@require_GET
def dashboard_data(request):
    books = list(Book.objects.all())
    loans = list(Borrowing.objects.filter(status=Borrowing.BORROWED))
    overdue = sum(1 for loan in loans if overdue_fine(loan)[0] > 0)
    return JsonResponse({
        "books": len(books),
        "copies": sum(book.total_copies for book in books),
        "members": Member.objects.count(),
        "active_loans": len(loans),
        "overdue_loans": overdue,
        "pending_requests": StudentSignupRequest.objects.filter(status=StudentSignupRequest.PENDING).count(),
        "unpaid_fines": FineEntry.objects.filter(status=FineEntry.UNPAID).count(),
    })


@librarian_api
@require_GET
def reviews_list(request):
    return JsonResponse({"results": [{
        "id": str(review.pk),
        "book_title": review.book_title,
        "member_name": review.member_name,
        "rating": review.rating,
        "comment": review.comment,
        "created_at": review.created_at.isoformat(),
    } for review in Review.objects.all()[:100]]})


@librarian_api
@require_POST
def add_review(request):
    form = ReviewForm(request.POST)
    if not form.is_valid():
        return JsonResponse({"errors": form_errors(form)}, status=400)
    book_id = to_object_id(form.cleaned_data["book_id"])
    member_id = to_object_id(form.cleaned_data["member_id"])
    book = Book.objects.filter(pk=book_id).first() if book_id else None
    member = Member.objects.filter(pk=member_id).first() if member_id else None
    if not book or not member:
        return JsonResponse({"error": "Choose an existing book and student."}, status=404)
    review = Review.objects.create(
        book=book,
        member=member,
        book_title=book.title,
        member_name=member.name,
        rating=form.cleaned_data["rating"],
        comment=form.cleaned_data["comment"].strip(),
    )
    return JsonResponse({"id": str(review.pk), "message": "Review saved."}, status=201)


@librarian_api
@require_GET
def members_catalogue(request):
    return JsonResponse({"results": [{
        "id": str(member.pk),
        "student_id": member.student_id,
        "name": member.name,
        "email": member.email,
    } for member in Member.objects.filter(approval_status=Member.APPROVED)[:200]]})
