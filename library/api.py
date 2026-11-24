from collections import Counter, defaultdict
from datetime import datetime, timedelta
from functools import wraps

from bson import ObjectId
from django.contrib.auth import authenticate, get_user_model
from django.contrib.auth import update_session_auth_hash
from django.contrib.auth.forms import PasswordChangeForm
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
    BookReservationForm,
    CustomFineForm,
    FirstLibrarianForm,
    LibrarianForm,
    LoginForm,
    LoanRenewalRequestForm,
    ManualIssueForm,
    ReviewForm,
    SpaceBookingForm,
    StudentIssueForm,
    StudentReviewForm,
    StudentSignupForm,
)
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
from .views import (
    LIBRARIAN_GROUP,
    STUDENT_GROUP,
    add_to_group,
    complete_return,
    checkout_eligibility_error,
    copy_code_for,
    create_borrowing,
    make_staff_id,
    overdue_fine,
    loan_due_details,
    promote_available_reservations,
    to_object_id,
    update_book_stock,
    checkout_hold_error,
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
            "email": user.email or "",
        }

    member = Member.objects.filter(user=user, approval_status=Member.APPROVED).first()
    if member:
        return {
            "id": str(member.pk),
            "name": member.name,
            "role": "student",
            "student_id": member.student_id,
            "email": member.email,
        }
    return None


def book_ratings_for_books(books):
    books = list(books)
    if not books:
        return {}

    book_ids = {str(book.pk) for book in books}
    titles = {}
    for book in books:
        titles.setdefault(book.title, []).append(str(book.pk))

    reviews = Review.objects.filter(
        Q(book_id__in=[book.pk for book in books])
        | Q(book__isnull=True, book_title__in=list(titles))
    ).values_list("book_id", "book_title", "rating")
    totals = {book_id: [0, 0] for book_id in book_ids}
    for review_book_id, book_title, rating in reviews:
        target_ids = [str(review_book_id)] if review_book_id else titles.get(book_title, [])
        for book_id in target_ids:
            if book_id in totals:
                totals[book_id][0] += rating
                totals[book_id][1] += 1

    return {
        book_id: {
            "average_rating": round(total / count, 1) if count else 0,
            "rating_count": count,
        }
        for book_id, (total, count) in totals.items()
    }


def book_data(book, rating_summary=None):
    copies = list(BookCopy.objects.filter(book=book).exclude(status=BookCopy.RETIRED))
    available = sum(copy.status == BookCopy.AVAILABLE for copy in copies)
    ready_reservations = BookReservation.objects.filter(book=book, status=BookReservation.READY).count()
    rating_summary = rating_summary or {"average_rating": 0, "rating_count": 0}
    return {
        "id": str(book.pk),
        "title": book.title,
        "author": book.author,
        "category": book.category,
        "isbn": book.isbn or "",
        "shelf": book.shelf,
        "description": book.description,
        "cover_url": book.cover_url,
        "available": available,
        "available_to_borrow": max(0, available - ready_reservations),
        "total": len(copies),
        "average_rating": rating_summary["average_rating"],
        "rating_count": rating_summary["rating_count"],
    }


def borrowing_data(record):
    days, amount = overdue_fine(record) if record.status == Borrowing.BORROWED else (0, 0)
    due_details = loan_due_details(record)
    renewal = LoanRenewalRequest.objects.filter(borrowing=record).order_by("-created_at").first()
    renewed = LoanRenewalRequest.objects.filter(borrowing=record, status=LoanRenewalRequest.APPROVED).exists()
    other_holds = record.book_id and BookReservation.objects.filter(
        book_id=record.book_id,
        status__in=[BookReservation.WAITING, BookReservation.READY],
    ).exclude(member_id=record.member_id).exists()
    return {
        "id": str(record.pk),
        "issue_code": record.issue_code,
        "copy_id": record.copy_id,
        "book_title": record.book_title,
        "book_author": record.book_author,
        "book_category": record.book_category,
        "book_shelf": record.book_shelf,
        "member_name": record.member_name,
        "member_email": record.member_email,
        "student_id": record.member_student_id,
        "status": record.status,
        "borrowed_at": record.borrowed_at.isoformat(),
        "due_at": record.due_at.isoformat(),
        "returned_at": record.returned_at.isoformat() if record.returned_at else "",
        "overdue_days": days,
        "current_fine": str(amount),
        **due_details,
        "renewal_status": renewal.status if renewal else "",
        "renewal_allowed": record.status == Borrowing.BORROWED and not renewed and not days and not other_holds and (not renewal or renewal.status != LoanRenewalRequest.PENDING),
    }


def paginated_books(request, queryset):
    query = request.GET.get("q", "").strip()[:150]
    categories = [value.strip() for value in request.GET.getlist("category") if value.strip()][:50]
    availability = set(request.GET.getlist("availability")) & {"available", "unavailable"}
    sort = request.GET.get("sort", "title")
    ordering = {"title": ("title", "pk"), "title_desc": ("-title", "pk"),
                "author": ("author", "title", "pk"), "newest": ("-created_at", "pk")}
    if query:
        queryset = queryset.filter(Q(title__icontains=query) | Q(author__icontains=query)
            | Q(isbn__icontains=query) | Q(shelf__icontains=query))
    if categories:
        queryset = queryset.filter(category__in=categories)
    if request.GET.get("with_cover") == "1":
        queryset = queryset.exclude(cover_url="").exclude(cover_url__isnull=True)
    queryset = queryset.order_by(*ordering.get(sort, ordering["title"]))
    try:
        min_rating = min(5, max(0, float(request.GET.get("min_rating", "0"))))
    except ValueError:
        min_rating = 0
    try:
        page_number = max(1, int(request.GET.get("page", "1")))
    except ValueError:
        page_number = 1
    try:
        page_size = min(100, max(1, int(request.GET.get("page_size", "24"))))
    except ValueError:
        page_size = 24
    needs_full_results = len(availability) == 1 or min_rating > 0 or sort == "rating"
    if not needs_full_results:
        total = queryset.count()
        pages = max(1, (total + page_size - 1) // page_size)
        page_number = min(page_number, pages)
        start = (page_number - 1) * page_size
        books = list(queryset[start:start + page_size])
        ratings = book_ratings_for_books(books)
        results = [book_data(book, ratings[str(book.pk)]) for book in books]
    else:
        books = list(queryset)
        ratings = book_ratings_for_books(books)
        results = [book_data(book, ratings[str(book.pk)]) for book in books]
        if availability == {"available"}:
            results = [book for book in results if book["available_to_borrow"] > 0]
        elif availability == {"unavailable"}:
            results = [book for book in results if book["available_to_borrow"] == 0]
        if min_rating:
            results = [book for book in results if book["rating_count"] > 0 and book["average_rating"] >= min_rating]
        if sort == "rating":
            results.sort(key=lambda book: (-book["average_rating"], -book["rating_count"], book["title"], book["id"]))
        total = len(results)
        pages = max(1, (total + page_size - 1) // page_size)
        page_number = min(page_number, pages)
        start = (page_number - 1) * page_size
        results = results[start:start + page_size]
    category_choices = sorted(set(Book.objects.exclude(category="").values_list("category", flat=True)))
    return JsonResponse({"results": results, "categories": category_choices,
        "pagination": {"page": page_number, "page_size": page_size, "total": total, "pages": pages}})


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


def reservation_data(reservation):
    queue_position = None
    if reservation.status == BookReservation.WAITING:
        queue_position = BookReservation.objects.filter(
            book=reservation.book,
            status=BookReservation.WAITING,
            created_at__lte=reservation.created_at,
        ).count()
    return {
        "id": str(reservation.pk),
        "book_id": str(reservation.book_id),
        "book_title": reservation.book_title,
        "author": reservation.book.author,
        "shelf": reservation.book.shelf or "Unassigned",
        "student_id": reservation.member.student_id,
        "student_name": reservation.member.name,
        "status": reservation.status,
        "queue_position": queue_position,
        "created_at": reservation.created_at.isoformat(),
        "updated_at": reservation.updated_at.isoformat(),
    }


def renewal_data(item):
    return {
        "id": str(item.pk),
        "loan_id": str(item.borrowing_id),
        "issue_code": item.borrowing.issue_code,
        "book_title": item.borrowing.book_title,
        "copy_id": item.borrowing.copy_id,
        "student_id": item.member.student_id,
        "student_name": item.member.name,
        "status": item.status,
        "due_at": item.borrowing.due_at.isoformat(),
        "created_at": item.created_at.isoformat(),
        "reviewed_at": item.reviewed_at.isoformat() if item.reviewed_at else "",
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
    
    # 1. Match student Member by student_id or email
    member = Member.objects.filter(
        Q(student_id__iexact=login_id) | Q(email__iexact=login_id)
    ).first()

    if member and member.user:
        account_user = member.user
    else:
        # 2. Match User by username or email (e.g. librarian, admin, or username)
        account_user = User.objects.filter(
            Q(username__iexact=login_id) | Q(email__iexact=login_id)
        ).first()

    username_to_auth = account_user.username if account_user else login_id
    user = authenticate(
        request,
        username=username_to_auth,
        password=form.cleaned_data["password"],
    )
    if user is None:
        return JsonResponse({"error": "The ID or email and password did not match an active account."}, status=400)

    account = account_data(user)
    if not account:
        return JsonResponse({"error": "This account is inactive or not configured."}, status=403)
    auth_login(request, user)
    return JsonResponse({"user": account})


@require_POST
def setup_librarian(request):
    if User.objects.filter(groups__name=LIBRARIAN_GROUP, is_active=True).exists():
        return JsonResponse({"error": "A librarian account has already been set up."}, status=409)

    form = FirstLibrarianForm(request.POST)
    if not form.is_valid():
        return JsonResponse({"errors": form_errors(form)}, status=400)

    email = form.cleaned_data.get("email", "").strip().lower()
    user = User.objects.create_user(
        username=make_staff_id("LIB"),
        email=email,
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
def change_password(request):
    if not request.user.is_authenticated:
        return JsonResponse({"error": "Please sign in first."}, status=401)
    if not account_data(request.user):
        return JsonResponse({"error": "An active library account is required."}, status=403)

    form = PasswordChangeForm(request.user, request.POST)
    if not form.is_valid():
        return JsonResponse({"errors": form_errors(form)}, status=400)

    user = form.save()
    update_session_auth_hash(request, user)
    return JsonResponse({"ok": True, "message": "Your password has been changed."})


@require_POST
def submit_signup(request):
    form = StudentSignupForm(request.POST)
    if not form.is_valid():
        return JsonResponse({"errors": form_errors(form)}, status=400)

    values = form.cleaned_data
    email = values["email"]

    # Check if active User already exists
    existing_user = User.objects.filter(email__iexact=email).first()
    if existing_user and existing_user.is_active:
        return JsonResponse({"error": "An account with this email already exists."}, status=409)

    # Check if User was previously rejected by a librarian
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

    # Check if Member already exists for this email
    member = Member.objects.filter(email__iexact=email).first()
    if member and member.user and member.user.is_active:
        return JsonResponse({"error": "An account with this email already exists."}, status=409)

    if member:
        student_id = member.student_id
        member.name = values["name"].strip()
        member.course = values["course"].strip()
        member.year = values["year"]
        member.approval_status = Member.APPROVED
    else:
        student_id = make_staff_id("STU").upper()
        member = Member.objects.create(
            student_id=student_id,
            name=values["name"].strip(),
            email=email,
            course=values["course"].strip(),
            year=values["year"],
            approval_status=Member.APPROVED,
        )

    if existing_user:
        user = existing_user
        user.username = student_id
        user.first_name = values["name"].strip()
        user.set_password(values["password"])
        user.is_active = True
        user.save(update_fields=["username", "first_name", "password", "is_active"])
    else:
        user = User.objects.create_user(
            username=student_id,
            email=email,
            first_name=values["name"].strip(),
            password=values["password"],
            is_active=True,
        )

    member.user = user
    member.save(update_fields=["user", "approval_status", "name", "course", "year"])
    add_to_group(user, STUDENT_GROUP)

    # Maintain StudentSignupRequest record for history / admin visibility
    signup_req = StudentSignupRequest.objects.filter(email__iexact=email).first()
    if not signup_req:
        StudentSignupRequest.objects.create(
            user=user,
            name=member.name,
            email=email,
            registration_number=values["registration_number"].strip(),
            course=member.course,
            year=member.year,
            status=StudentSignupRequest.APPROVED,
            reviewed_at=timezone.now(),
        )
    else:
        signup_req.user = user
        signup_req.name = member.name
        signup_req.registration_number = values["registration_number"].strip()
        signup_req.course = member.course
        signup_req.year = member.year
        signup_req.status = StudentSignupRequest.APPROVED
        signup_req.reviewed_at = timezone.now()
        signup_req.save()

    auth_login(request, user)
    return JsonResponse({
        "message": f"Welcome, {member.name}! Your student account is active. Student ID: {student_id}.",
        "user": account_data(user),
        "student_id": student_id,
    }, status=201)



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
    if not signup or signup.status == StudentSignupRequest.REJECTED:
        return JsonResponse({"error": "That request is missing or already rejected."}, status=404)
    if action not in ("approve", "reject"):
        return JsonResponse({"error": "Choose approve or reject."}, status=400)

    if action == "reject":
        signup.status = StudentSignupRequest.REJECTED
        signup.reviewed_by = request.user
        signup.reviewed_at = timezone.now()
        signup.save(update_fields=["status", "reviewed_by", "reviewed_at"])
        signup.user.is_active = False
        signup.user.save(update_fields=["is_active"])
        member = Member.objects.filter(user=signup.user).first()
        if member:
            member.approval_status = Member.PENDING
            member.save(update_fields=["approval_status"])
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
    return paginated_books(request, Book.objects.all())


@librarian_api
def books_api(request):
    if request.method == "GET":
        return paginated_books(request, Book.objects.all())
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
@require_POST
def edit_book(request, book_id):
    object_id = to_object_id(book_id)
    book = Book.objects.filter(pk=object_id).first() if object_id else None
    if not book:
        return JsonResponse({"error": "Book not found."}, status=404)
    form = BookForm(request.POST, instance=book)
    if not form.is_valid():
        return JsonResponse({"errors": form_errors(form)}, status=400)

    desired_total = form.cleaned_data["copies"]
    active_copies = BookCopy.objects.filter(book=book).exclude(status=BookCopy.RETIRED)
    active_total = active_copies.count()
    active_loans = Borrowing.objects.filter(book=book, status=Borrowing.BORROWED)
    borrowed_total = active_loans.count()
    loan_copy_rows = list(active_loans.values_list("book_copy_id", "copy_id"))
    loan_copy_pks = [row[0] for row in loan_copy_rows if row[0]]
    loan_copy_codes = [row[1] for row in loan_copy_rows if row[1]]
    available_copies = active_copies.filter(status=BookCopy.AVAILABLE).exclude(pk__in=loan_copy_pks).exclude(copy_id__in=loan_copy_codes)
    ready_total = BookReservation.objects.filter(book=book, status=BookReservation.READY).count()
    if desired_total < borrowed_total + ready_total:
        return JsonResponse({"error": "Copies in use or held for pickup prevent reducing the physical stock to that number."}, status=409)
    retire_count = max(0, active_total - desired_total)
    retire_candidates = list(available_copies.order_by("-created_at")[:max(0, available_copies.count() - ready_total)])
    if len(retire_candidates) < retire_count:
        return JsonResponse({"error": "Only copies that are available and not held can be removed from active stock."}, status=409)

    values = form.save(commit=False)
    values.copies = 0
    values.total_copies = active_total
    values.available = False
    values.save()
    BookCopy.objects.filter(book=book).exclude(status=BookCopy.RETIRED).update(
        shelf=values.shelf,
        book_title=values.title,
    )

    if desired_total < active_total:
        for copy in retire_candidates[:retire_count]:
            BookCopy.objects.filter(pk=copy.pk, status=BookCopy.AVAILABLE).update(status=BookCopy.RETIRED)
    elif desired_total > active_total:
        for _ in range(desired_total - active_total):
            copy_id = ObjectId()
            BookCopy.objects.create(
                id=copy_id,
                book=book,
                copy_id=copy_code_for(copy_id),
                book_title=values.title,
                shelf=values.shelf,
            )
    update_book_stock(book)
    promote_available_reservations(book)
    return JsonResponse({"book": book_data(book)})


@librarian_api
@require_GET
def copies_list(request, book_id):
    object_id = to_object_id(book_id)
    book = get_object_or_404(Book, pk=object_id) if object_id else None
    copies = BookCopy.objects.filter(book=book).exclude(status=BookCopy.RETIRED).order_by("copy_id")
    active_loans = {}
    for loan in Borrowing.objects.filter(book=book, status=Borrowing.BORROWED).select_related("book_copy"):
        active_copy_id = loan.copy_id or (loan.book_copy.copy_id if loan.book_copy_id else "")
        if active_copy_id:
            active_loans[active_copy_id] = loan
    return JsonResponse({"results": [{
        "id": str(copy.pk),
        "copy_id": copy.copy_id,
        "status": Borrowing.BORROWED if copy.copy_id in active_loans else copy.status,
        "shelf": copy.shelf,
        "book_title": book.title,
        "borrowed_to": active_loans[copy.copy_id].member_name if copy.copy_id in active_loans else "",
        "issue_code": active_loans[copy.copy_id].issue_code if copy.copy_id in active_loans else "",
        "due_at": active_loans[copy.copy_id].due_at.isoformat() if copy.copy_id in active_loans else "",
    } for copy in copies]})


@librarian_api
@require_GET
def all_copies_list(request):
    copies = BookCopy.objects.select_related("book").exclude(status=BookCopy.RETIRED).order_by("book__title", "copy_id")
    active_copy_ids = set()
    for loan in Borrowing.objects.filter(status=Borrowing.BORROWED).select_related("book_copy"):
        active_copy_id = loan.copy_id or (loan.book_copy.copy_id if loan.book_copy_id else "")
        if active_copy_id:
            active_copy_ids.add(active_copy_id)
    return JsonResponse({"results": [{
        "id": str(copy.pk),
        "copy_id": copy.copy_id,
        "status": Borrowing.BORROWED if copy.copy_id in active_copy_ids else copy.status,
        "shelf": copy.shelf,
        "book_title": copy.book.title,
    } for copy in copies]})


@librarian_api
@require_GET
def copy_lookup(request, copy_id):
    copy = BookCopy.objects.filter(copy_id=copy_id.strip().upper()).select_related("book").first()
    if not copy:
        return JsonResponse({"error": "Copy ID not found."}, status=404)
    active_loan = Borrowing.objects.filter(
        Q(book_copy=copy) | Q(copy_id=copy.copy_id),
        status=Borrowing.BORROWED,
    ).order_by("-borrowed_at").first()
    return JsonResponse({
        "copy_id": copy.copy_id,
        "status": Borrowing.BORROWED if active_loan else copy.status,
        "active_loan": active_loan is not None,
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
    active_loan = Borrowing.objects.filter(
        Q(book_copy=copy) | Q(copy_id=copy.copy_id),
        status=Borrowing.BORROWED,
    ).order_by("-borrowed_at").first()
    return JsonResponse({
        "copy_id": copy.copy_id,
        "status": Borrowing.BORROWED if active_loan else copy.status,
        "book_title": copy.book.title,
        "shelf": copy.shelf,
    })


@librarian_api
def loans_api(request):
    if request.method == "GET":
        loans = Borrowing.objects.all()
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
    eligibility_error = checkout_eligibility_error(member)
    if eligibility_error:
        return JsonResponse({"error": eligibility_error}, status=409)
    hold_error = checkout_hold_error(member, copy)
    if hold_error:
        return JsonResponse({"error": hold_error}, status=409)
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
    eligibility_error = checkout_eligibility_error(member)
    if eligibility_error:
        return JsonResponse({"error": eligibility_error}, status=409)
    copy = BookCopy.objects.filter(
        copy_id=form.cleaned_data["copy_id"].strip().upper(),
        status=BookCopy.AVAILABLE,
    ).first()
    if not copy:
        return JsonResponse({"error": "This copy is not available. Please choose another."}, status=409)
    hold_error = checkout_hold_error(member, copy)
    if hold_error:
        return JsonResponse({"error": hold_error}, status=409)
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
    member = request.student_member
    loans = Borrowing.objects.filter(status__in=[Borrowing.BORROWED, Borrowing.RETURNED]).filter(
        Q(member=member) | Q(member__isnull=True, member_student_id=member.student_id)
    )
    return JsonResponse({"results": [borrowing_data(record) for record in loans]})


TRANSACTION_TYPES = {"checkout", "return", "renewal", "fine_added", "fine_paid"}


def transaction_history(request, member=None):
    query = request.GET.get("q", "").strip()[:100]
    event_types = {value.strip() for value in request.GET.getlist("type") if value.strip()}
    event_type = next(iter(event_types)) if len(event_types) == 1 else ""
    if not event_types.issubset(TRANSACTION_TYPES):
        return JsonResponse({"error": "Choose a valid transaction type."}, status=400)

    events = []
    loan_query = Borrowing.objects.all()
    if member:
        loan_query = loan_query.filter(
            Q(member=member) | Q(member__isnull=True, member_student_id=member.student_id)
        )
    if query:
        loan_query = loan_query.filter(
            Q(issue_code__icontains=query)
            | Q(copy_id__icontains=query)
            | Q(book_title__icontains=query)
            | Q(member_name__icontains=query)
            | Q(member_student_id__icontains=query)
        )
    if not event_type or event_type == "checkout":
        events.extend({
            "id": f"checkout-{record.pk}",
            "type": "checkout",
            "occurred_at": record.borrowed_at.isoformat(),
            "title": record.book_title or "Book checkout",
            "details": f"Copy {record.copy_id} checked out · Issue {record.issue_code}",
            "student_name": record.member_name,
            "student_id": record.member_student_id,
            "copy_id": record.copy_id,
            "issue_code": record.issue_code,
            "status": record.status,
            "amount": "",
        } for record in loan_query)
    if not event_type or event_type == "return":
        events.extend({
            "id": f"return-{record.pk}",
            "type": "return",
            "occurred_at": record.returned_at.isoformat(),
            "title": record.book_title or "Book return",
            "details": f"Copy {record.copy_id} returned · Issue {record.issue_code}",
            "student_name": record.member_name,
            "student_id": record.member_student_id,
            "copy_id": record.copy_id,
            "issue_code": record.issue_code,
            "status": Borrowing.RETURNED,
            "amount": "",
        } for record in loan_query if record.returned_at)

    renewal_query = LoanRenewalRequest.objects.select_related("borrowing", "member")
    if member:
        renewal_query = renewal_query.filter(member=member)
    if query:
        renewal_query = renewal_query.filter(
            Q(borrowing__issue_code__icontains=query)
            | Q(borrowing__copy_id__icontains=query)
            | Q(borrowing__book_title__icontains=query)
            | Q(member__name__icontains=query)
            | Q(member__student_id__icontains=query)
        )
    if not event_type or event_type == "renewal":
        events.extend({
            "id": f"renewal-{item.pk}",
            "type": "renewal",
            "occurred_at": (item.reviewed_at or item.created_at).isoformat(),
            "title": item.borrowing.book_title or "Loan renewal",
            "details": f"Renewal request {item.status} · Issue {item.borrowing.issue_code}",
            "student_name": item.member.name,
            "student_id": item.member.student_id,
            "copy_id": item.borrowing.copy_id,
            "issue_code": item.borrowing.issue_code,
            "status": item.status,
            "amount": "",
        } for item in renewal_query)

    fine_query = FineEntry.objects.all()
    if member:
        fine_query = fine_query.filter(
            Q(member=member) | Q(member__isnull=True, student_id=member.student_id)
        )
    if query:
        fine_query = fine_query.filter(
            Q(member_name__icontains=query)
            | Q(student_id__icontains=query)
            | Q(reason__icontains=query)
            | Q(borrowing__issue_code__icontains=query)
            | Q(borrowing__copy_id__icontains=query)
            | Q(borrowing__book_title__icontains=query)
        )
    if not event_type or event_type in {"fine_added", "fine_paid"}:
        for fine in fine_query:
            borrowing = Borrowing.objects.filter(pk=fine.borrowing_id).first() if fine.borrowing_id else None
            if not event_type or event_type == "fine_added":
                events.append({
                    "id": f"fine-added-{fine.pk}",
                    "type": "fine_added",
                    "occurred_at": fine.created_at.isoformat(),
                    "title": fine.reason or "Fine added",
                    "details": f"{fine.fine_type.title()} fine recorded",
                    "student_name": fine.member_name,
                    "student_id": fine.student_id,
                    "copy_id": borrowing.copy_id if borrowing else "",
                    "issue_code": borrowing.issue_code if borrowing else "",
                    "status": fine.status,
                    "amount": str(fine.amount),
                })
            if fine.paid_at and (not event_type or event_type == "fine_paid"):
                events.append({
                    "id": f"fine-paid-{fine.pk}",
                    "type": "fine_paid",
                    "occurred_at": fine.paid_at.isoformat(),
                    "title": fine.reason or "Fine paid",
                    "details": f"{fine.fine_type.title()} fine paid",
                    "student_name": fine.member_name,
                    "student_id": fine.student_id,
                    "copy_id": borrowing.copy_id if borrowing else "",
                    "issue_code": borrowing.issue_code if borrowing else "",
                    "status": FineEntry.PAID,
                    "amount": str(fine.amount),
                })

    if event_types:
        events = [item for item in events if item["type"] in event_types]
    events.sort(key=lambda item: datetime.fromisoformat(item["occurred_at"]).timestamp(), reverse=True)
    try:
        page = max(1, int(request.GET.get("page", "1")))
    except ValueError:
        page = 1
    try:
        page_size = min(50, max(1, int(request.GET.get("page_size", "20"))))
    except ValueError:
        page_size = 20
    total = len(events)
    pages = max(1, (total + page_size - 1) // page_size)
    page = min(page, pages)
    start = (page - 1) * page_size
    return JsonResponse({
        "results": events[start:start + page_size],
        "pagination": {"page": page, "page_size": page_size, "total": total, "pages": pages},
    })


@librarian_api
@require_GET
def transactions_list(request):
    return transaction_history(request)


@student_api
@require_GET
def student_transactions_list(request):
    return transaction_history(request, member=request.student_member)


@student_api
def student_reservations(request):
    if request.method == "GET":
        reservations = BookReservation.objects.filter(member=request.student_member)
        return JsonResponse({"results": [reservation_data(item) for item in reservations]})
    if request.method != "POST":
        return JsonResponse({"error": "Use GET or POST."}, status=405)
    form = BookReservationForm(request.POST)
    if not form.is_valid():
        return JsonResponse({"errors": form_errors(form)}, status=400)
    book_id = to_object_id(form.cleaned_data["book_id"])
    book = Book.objects.filter(pk=book_id).first() if book_id else None
    if not book:
        return JsonResponse({"error": "Book not found."}, status=404)
    existing = BookReservation.objects.filter(
        book=book,
        member=request.student_member,
        status__in=[BookReservation.WAITING, BookReservation.READY],
    ).first()
    if existing:
        return JsonResponse({"reservation": reservation_data(existing)})
    promote_available_reservations(book)
    available = BookCopy.objects.filter(book=book, status=BookCopy.AVAILABLE).count()
    ready = BookReservation.objects.filter(book=book, status=BookReservation.READY).count()
    if available > ready:
        return JsonResponse({"error": "This title has copies available to borrow now."}, status=409)
    item = BookReservation.objects.create(
        book=book,
        member=request.student_member,
        book_title=book.title,
    )
    promote_available_reservations(book)
    item.refresh_from_db()
    return JsonResponse({"reservation": reservation_data(item)}, status=201)


@student_api
@require_POST
def cancel_reservation(request, reservation_id):
    object_id = to_object_id(reservation_id)
    item = BookReservation.objects.filter(pk=object_id, member=request.student_member).first() if object_id else None
    if not item or item.status not in (BookReservation.WAITING, BookReservation.READY):
        return JsonResponse({"error": "That reservation is no longer active."}, status=404)
    item.status = BookReservation.CANCELLED
    item.updated_at = timezone.now()
    item.save(update_fields=["status", "updated_at"])
    promote_available_reservations(item.book)
    return JsonResponse({"reservation": reservation_data(item)})


@librarian_api
@require_GET
def reservations_list(request):
    reservations = BookReservation.objects.select_related("book", "member")
    return JsonResponse({"results": [reservation_data(item) for item in reservations]})


@student_api
@require_POST
def request_loan_renewal(request):
    form = LoanRenewalRequestForm(request.POST)
    if not form.is_valid():
        return JsonResponse({"errors": form_errors(form)}, status=400)
    loan_id = to_object_id(form.cleaned_data["loan_id"])
    loan = Borrowing.objects.filter(pk=loan_id, member=request.student_member).first() if loan_id else None
    if not loan or loan.status != Borrowing.BORROWED:
        return JsonResponse({"error": "Only an active loan can be renewed."}, status=404)
    if overdue_fine(loan)[0] > 0:
        return JsonResponse({"error": "Renewals must be requested before the due date."}, status=409)
    if LoanRenewalRequest.objects.filter(borrowing=loan, status=LoanRenewalRequest.APPROVED).exists():
        return JsonResponse({"error": "This loan has already used its renewal."}, status=409)
    if LoanRenewalRequest.objects.filter(borrowing=loan, status=LoanRenewalRequest.PENDING).exists():
        return JsonResponse({"error": "A renewal request is already waiting for review."}, status=409)
    if loan.book_id and BookReservation.objects.filter(
        book_id=loan.book_id,
        status__in=[BookReservation.WAITING, BookReservation.READY],
    ).exclude(member=request.student_member).exists():
        return JsonResponse({"error": "Another student is waiting for this title, so this loan cannot be renewed."}, status=409)
    item = LoanRenewalRequest.objects.create(borrowing=loan, member=request.student_member)
    return JsonResponse({"renewal": renewal_data(item)}, status=201)


@librarian_api
@require_GET
def renewal_requests_list(request):
    items = LoanRenewalRequest.objects.select_related("borrowing", "member")
    return JsonResponse({"results": [renewal_data(item) for item in items]})


@librarian_api
@require_POST
def review_renewal(request, renewal_id, action):
    object_id = to_object_id(renewal_id)
    item = LoanRenewalRequest.objects.filter(pk=object_id).select_related("borrowing", "member").first() if object_id else None
    if not item or item.status != LoanRenewalRequest.PENDING:
        return JsonResponse({"error": "That renewal request is missing or already reviewed."}, status=404)
    if action not in ("approve", "reject"):
        return JsonResponse({"error": "Choose approve or reject."}, status=400)
    now = timezone.now()
    if action == "approve":
        loan = item.borrowing
        if loan.status != Borrowing.BORROWED or overdue_fine(loan)[0] > 0:
            return JsonResponse({"error": "This loan is returned or overdue and cannot be renewed."}, status=409)
        if LoanRenewalRequest.objects.filter(borrowing=loan, status=LoanRenewalRequest.APPROVED).exclude(pk=item.pk).exists():
            return JsonResponse({"error": "This loan has already used its renewal."}, status=409)
        if loan.book_id and BookReservation.objects.filter(
            book_id=loan.book_id,
            status__in=[BookReservation.WAITING, BookReservation.READY],
        ).exclude(member=item.member).exists():
            return JsonResponse({"error": "Another student is waiting for this title."}, status=409)
        loan.due_at = loan.due_at + timedelta(days=14)
        loan.save(update_fields=["due_at"])
        item.status = LoanRenewalRequest.APPROVED
    else:
        item.status = LoanRenewalRequest.REJECTED
    item.reviewed_at = now
    item.reviewed_by = request.user
    item.save(update_fields=["status", "reviewed_at", "reviewed_by"])
    return JsonResponse({"renewal": renewal_data(item)})


@librarian_api
@require_POST
def return_copy(request):
    copy_id = request.POST.get("copy_id", "").strip().upper()
    copy = BookCopy.objects.filter(copy_id=copy_id).select_related("book").first()
    if not copy:
        return JsonResponse({"error": "Copy ID not found."}, status=404)
    active_loans = Borrowing.objects.filter(
        Q(book_copy=copy) | Q(copy_id=copy.copy_id),
        status=Borrowing.BORROWED,
    ).order_by("-borrowed_at")
    if active_loans.count() > 1:
        return JsonResponse({"error": "More than one active loan is linked to this copy. Ask an administrator to review its history."}, status=409)
    record = active_loans.first()
    if not record:
        return JsonResponse({"error": "No active loan was found for that Copy ID."}, status=404)
    if not complete_return(record, returned_by=request.user, copy_record=copy):
        return JsonResponse({"error": "This loan changed before the return could be recorded. Refresh the issue register and scan again."}, status=409)
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
        entries = FineEntry.objects.all()
        active_loans = Borrowing.objects.filter(status=Borrowing.BORROWED)
    else:
        member = Member.objects.filter(user=request.user, approval_status=Member.APPROVED).first()
        if not member:
            return JsonResponse({"error": "An approved student account is required."}, status=403)
        # Older fine records may have lost their nullable member reference while
        # retaining the student ID snapshot. Keep those visible to that student.
        entries = FineEntry.objects.filter(Q(member=member) | Q(student_id=member.student_id))
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
@require_POST
def remove_fine(request, fine_id):
    object_id = to_object_id(fine_id)
    fine = FineEntry.objects.filter(pk=object_id).first() if object_id else None
    if not fine:
        return JsonResponse({"error": "Fine entry not found."}, status=404)
    if fine.status != FineEntry.UNPAID:
        return JsonResponse({"error": "Paid receipts cannot be removed."}, status=409)
    FineEntry.objects.filter(pk=object_id, status=FineEntry.UNPAID).delete()
    return JsonResponse({"message": "Unpaid fine removed."})


@librarian_api
@require_GET
def dashboard_data(request):
    books = list(Book.objects.all())
    loans = list(Borrowing.objects.filter(status=Borrowing.BORROWED))
    overdue = sum(1 for loan in loans if overdue_fine(loan)[0] > 0)
    due_soon = sum(1 for loan in loans if loan_due_details(loan)["due_status"] == "due_soon")
    return JsonResponse({
        "books": len(books),
        "copies": sum(book.total_copies for book in books),
        "members": Member.objects.filter(approval_status=Member.APPROVED).count(),
        "active_loans": len(loans),
        "overdue_loans": overdue,
        "due_soon_loans": due_soon,
        "pending_requests": StudentSignupRequest.objects.filter(status=StudentSignupRequest.PENDING).count(),
        "unpaid_fines": FineEntry.objects.filter(status=FineEntry.UNPAID).count(),
    })


@librarian_api
@require_GET
def reports_data(request):
    now = timezone.localtime()
    month_index = now.year * 12 + now.month - 1
    month_keys = []
    for offset in reversed(range(6)):
        year, month_zero = divmod(month_index - offset, 12)
        month = month_zero + 1
        month_keys.append((f"{year:04d}-{month:02d}", year, month))
    start_year, start_month_zero = divmod(month_index - 5, 12)
    start = datetime(start_year, start_month_zero + 1, 1, tzinfo=timezone.get_current_timezone())
    records = list(Borrowing.objects.all())
    popular_counts = Counter(record.book_title for record in records if record.book_title)
    issue_counts = defaultdict(int)
    return_counts = defaultdict(int)
    for record in records:
        if record.borrowed_at and record.borrowed_at >= start:
            issue_counts[timezone.localtime(record.borrowed_at).strftime("%Y-%m")] += 1
        if record.returned_at and record.returned_at >= start:
            return_counts[timezone.localtime(record.returned_at).strftime("%Y-%m")] += 1
    circulation = [{
        "month": key,
        "label": datetime(year, month, 1).strftime("%b %Y"),
        "issues": issue_counts[key],
        "returns": return_counts[key],
    } for key, year, month in month_keys]
    recent = Borrowing.objects.all()[:12]
    return JsonResponse({
        "popular_books": [{"title": title, "borrowings": count} for title, count in popular_counts.most_common(10)],
        "circulation": circulation,
        "recent_transactions": [{
            "issue_code": item.issue_code,
            "book_title": item.book_title,
            "student_name": item.member_name,
            "student_id": item.member_student_id,
            "status": item.status,
            "borrowed_at": item.borrowed_at.isoformat(),
            "due_at": item.due_at.isoformat(),
        } for item in recent],
        "totals": {
            "borrowings": len(records),
            "active": sum(item.status == Borrowing.BORROWED for item in records),
            "returned": sum(item.status == Borrowing.RETURNED for item in records),
        },
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


@require_GET
def book_reviews(request, book_id):
    object_id = to_object_id(book_id)
    book = Book.objects.filter(pk=object_id).first() if object_id else None
    if not book:
        return JsonResponse({"error": "Book not found."}, status=404)

    review_query = Review.objects.filter(
        Q(book=book) | Q(book__isnull=True, book_title=book.title)
    ).order_by("-created_at")
    ratings = list(review_query.values_list("rating", flat=True))
    count = len(ratings)
    average = round(sum(ratings) / count, 1) if count else 0
    current_review = None
    if request.user.is_authenticated:
        member = Member.objects.filter(user=request.user, approval_status=Member.APPROVED).first()
        if member:
            current_review = Review.objects.filter(book=book, member=member).order_by("-created_at").first()

    return JsonResponse({
        "average_rating": average,
        "rating_count": count,
        "my_review": {
            "rating": current_review.rating,
            "comment": current_review.comment,
        } if current_review else None,
        "results": [{
            "id": str(review.pk),
            "member_name": review.member_name or "Campus reader",
            "rating": review.rating,
            "comment": review.comment,
            "created_at": review.created_at.isoformat(),
        } for review in review_query[:50]],
    })


@student_api
@require_POST
def student_add_review(request):
    form = StudentReviewForm(request.POST)
    if not form.is_valid():
        return JsonResponse({"errors": form_errors(form)}, status=400)
    object_id = to_object_id(form.cleaned_data["book_id"])
    book = Book.objects.filter(pk=object_id).first() if object_id else None
    if not book:
        return JsonResponse({"error": "Choose an existing book."}, status=404)

    member = request.student_member
    review = Review.objects.filter(book=book, member=member).order_by("-created_at").first()
    updated = review is not None
    if review:
        review.rating = form.cleaned_data["rating"]
        review.comment = form.cleaned_data["comment"].strip()
        review.save(update_fields=["rating", "comment"])
    else:
        review = Review.objects.create(
            book=book,
            member=member,
            book_title=book.title,
            member_name=member.name,
            rating=form.cleaned_data["rating"],
            comment=form.cleaned_data["comment"].strip(),
        )
    return JsonResponse({
        "message": "Your rating was updated." if updated else "Your rating is now public.",
        "updated": updated,
    }, status=200 if updated else 201)


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


DEFAULT_LIBRARY_SPACES = [
    {
        "name": "Silent Focus Pod 1",
        "space_type": LibrarySpace.POD,
        "capacity": 1,
        "location": "1st Floor · Silent Bay",
        "description": "Soundproof acoustic solo pod for deep focus, reading, and exam preparation.",
        "amenities": "Acoustic insulation, Power socket, USB-C PD, Task lamp, Ergonomic chair",
    },
    {
        "name": "Silent Focus Pod 2",
        "space_type": LibrarySpace.POD,
        "capacity": 1,
        "location": "1st Floor · Silent Bay",
        "description": "Ergonomic solo pod with standing desk converter for focused study.",
        "amenities": "Acoustic insulation, Standing desk, Power socket, Task lamp",
    },
    {
        "name": "Collaboration Pod A",
        "space_type": LibrarySpace.POD,
        "capacity": 2,
        "location": "2nd Floor · Innovation Hub",
        "description": "Duo collaboration pod designed for peer study, research, and pair programming.",
        "amenities": "Soundproof glass, Dual 27-inch monitors, Whiteboard, USB-C hub",
    },
    {
        "name": "Team Pod B",
        "space_type": LibrarySpace.POD,
        "capacity": 4,
        "location": "2nd Floor · Innovation Hub",
        "description": "Compact team pod with display screencast for small group project discussions.",
        "amenities": "Smart TV display, Whiteboard, 4 Power sockets, Round meeting table",
    },
    {
        "name": "Conference Room Alpha",
        "space_type": LibrarySpace.ROOM,
        "capacity": 10,
        "location": "3rd Floor · Seminar Wing",
        "description": "Mid-sized conference room with video conferencing and projection equipment.",
        "amenities": "4K Projector & Screen, Conference mic & camera, Glass whiteboard, AC, Wi-Fi 6",
    },
    {
        "name": "Conference Room Beta",
        "space_type": LibrarySpace.ROOM,
        "capacity": 16,
        "location": "3rd Floor · Seminar Wing",
        "description": "Executive conference hall suited for student society presentations and workshops.",
        "amenities": "Dual 4K displays, Ceiling array microphone, Surround sound, Whiteboards, Podium",
    },
    {
        "name": "Group Discussion Room",
        "space_type": LibrarySpace.ROOM,
        "capacity": 6,
        "location": "2nd Floor · South Wing",
        "description": "Acoustically treated discussion room for project teams and club meetings.",
        "amenities": "Smart board, High-speed LAN, Comfortable conference seating, Whiteboard",
    },
    {
        "name": "Quiet Study Slot S-01",
        "space_type": LibrarySpace.SLOT,
        "capacity": 1,
        "location": "1st Floor · Central Reading Hall",
        "description": "Dedicated single study carrel with private partitions for minimal distraction.",
        "amenities": "Partitioned cubicle, Soft LED reading lamp, Dual AC power outlets",
    },
    {
        "name": "Quiet Study Slot S-02",
        "space_type": LibrarySpace.SLOT,
        "capacity": 1,
        "location": "1st Floor · Central Reading Hall",
        "description": "Dedicated single study carrel near natural window lighting.",
        "amenities": "Partitioned cubicle, Window view, LED lamp, Power outlets",
    },
    {
        "name": "Research Desk R-01",
        "space_type": LibrarySpace.SLOT,
        "capacity": 2,
        "location": "2nd Floor · Archives & Reference",
        "description": "Spacious reference research desk equipped for document analysis.",
        "amenities": "Extended desktop, Dedicated bookshelf, LAN connection, Task lights",
    },
]


def ensure_default_spaces():
    if not LibrarySpace.objects.exists():
        for item in DEFAULT_LIBRARY_SPACES:
            LibrarySpace.objects.create(**item)


STANDARD_HOURLY_SLOTS = [
    ("08:00", "09:00"),
    ("09:00", "10:00"),
    ("10:00", "11:00"),
    ("11:00", "12:00"),
    ("12:00", "13:00"),
    ("13:00", "14:00"),
    ("14:00", "15:00"),
    ("15:00", "16:00"),
    ("16:00", "17:00"),
    ("17:00", "18:00"),
    ("18:00", "19:00"),
    ("19:00", "20:00"),
]


def space_booking_data(booking):
    return {
        "id": str(booking.pk),
        "space_id": str(booking.space_id),
        "space_name": booking.space_name,
        "space_type": booking.space_type,
        "student_name": booking.student_name,
        "student_id": booking.student_id,
        "student_email": booking.student_email,
        "booking_date": booking.booking_date,
        "start_time": booking.start_time,
        "end_time": booking.end_time,
        "attendees_count": booking.attendees_count,
        "purpose": booking.purpose,
        "status": booking.status,
        "rejection_reason": booking.rejection_reason,
        "created_at": booking.created_at.isoformat(),
        "reviewed_at": booking.reviewed_at.isoformat() if booking.reviewed_at else None,
    }


def times_overlap(start1, end1, start2, end2):
    return start1 < end2 and end1 > start2


@require_GET
def spaces_list(request):
    if not request.user.is_authenticated:
        return JsonResponse({"error": "Please sign in first."}, status=401)

    ensure_default_spaces()

    date_str = request.GET.get("date", "").strip()
    if not date_str:
        date_str = timezone.localdate().isoformat()

    space_type = request.GET.get("type", "").strip()
    queryset = LibrarySpace.objects.filter(is_active=True)
    if space_type and space_type != "all":
        queryset = queryset.filter(space_type=space_type)

    spaces = list(queryset)
    space_ids = [space.pk for space in spaces]

    # Active bookings on that date
    day_bookings = list(
        SpaceBooking.objects.filter(
            space_id__in=space_ids,
            booking_date=date_str,
            status__in=[SpaceBooking.CONFIRMED, SpaceBooking.PENDING],
        )
    )

    bookings_by_space = defaultdict(list)
    for b in day_bookings:
        bookings_by_space[b.space_id].append(b)

    results = []
    for space in spaces:
        s_bookings = bookings_by_space.get(space.pk, [])

        # Build schedule for standard slots
        schedule = []
        occupied_count = 0
        pending_count = 0

        for slot_start, slot_end in STANDARD_HOURLY_SLOTS:
            confirmed_match = any(
                b.status == SpaceBooking.CONFIRMED and times_overlap(slot_start, slot_end, b.start_time, b.end_time)
                for b in s_bookings
            )
            pending_match = any(
                b.status == SpaceBooking.PENDING and times_overlap(slot_start, slot_end, b.start_time, b.end_time)
                for b in s_bookings
            )

            if confirmed_match:
                slot_status = "occupied"
                occupied_count += 1
            elif pending_match:
                slot_status = "pending"
                pending_count += 1
            else:
                slot_status = "empty"

            schedule.append({
                "start": slot_start,
                "end": slot_end,
                "status": slot_status,
            })

        empty_count = len(STANDARD_HOURLY_SLOTS) - occupied_count - pending_count

        results.append({
            "id": str(space.pk),
            "name": space.name,
            "space_type": space.space_type,
            "space_type_display": space.get_space_type_display(),
            "capacity": space.capacity,
            "location": space.location,
            "description": space.description,
            "amenities": space.amenities,
            "empty_slots_count": empty_count,
            "occupied_slots_count": occupied_count,
            "pending_slots_count": pending_count,
            "is_fully_booked": empty_count == 0,
            "schedule": schedule,
            "bookings": [space_booking_data(b) for b in s_bookings],
        })

    return JsonResponse({
        "date": date_str,
        "results": results,
    })


@student_api
@require_POST
def create_space_booking(request):
    form = SpaceBookingForm(request.POST)
    if not form.is_valid():
        return JsonResponse({"errors": form_errors(form)}, status=400)

    data = form.cleaned_data
    space_id = to_object_id(data["space_id"])
    space = LibrarySpace.objects.filter(pk=space_id, is_active=True).first() if space_id else None
    if not space:
        return JsonResponse({"error": "Selected study space or pod was not found."}, status=404)

    booking_date = data["booking_date"].strip()
    try:
        parsed_date = datetime.strptime(booking_date, "%Y-%m-%d").date()
    except ValueError:
        return JsonResponse({"error": "Invalid date format. Use YYYY-MM-DD."}, status=400)

    if parsed_date < timezone.localdate():
        return JsonResponse({"error": "Cannot book spaces for a past date."}, status=400)

    start_time = data["start_time"].strip()
    end_time = data["end_time"].strip()
    if start_time >= end_time:
        return JsonResponse({"error": "End time must be after start time."}, status=400)

    attendees_count = data["attendees_count"]
    if attendees_count > space.capacity:
        return JsonResponse({
            "error": f"The maximum capacity for {space.name} is {space.capacity} students."
        }, status=400)

    # Check for conflicts
    existing_conflicts = SpaceBooking.objects.filter(
        space=space,
        booking_date=booking_date,
        status__in=[SpaceBooking.CONFIRMED, SpaceBooking.PENDING],
        start_time__lt=end_time,
        end_time__gt=start_time,
    )

    if existing_conflicts.filter(status=SpaceBooking.CONFIRMED).exists():
        return JsonResponse({
            "error": f"{space.name} is already booked and confirmed between {start_time} and {end_time} on {booking_date}."
        }, status=400)

    if existing_conflicts.filter(status=SpaceBooking.PENDING).exists():
        return JsonResponse({
            "error": f"{space.name} already has a pending reservation request between {start_time} and {end_time} on {booking_date}."
        }, status=400)

    booking = SpaceBooking.objects.create(
        space=space,
        space_name=space.name,
        space_type=space.space_type,
        member=request.student_member,
        student_name=request.student_member.name,
        student_id=request.student_member.student_id,
        student_email=request.student_member.email,
        booking_date=booking_date,
        start_time=start_time,
        end_time=end_time,
        attendees_count=attendees_count,
        purpose=data.get("purpose", "").strip(),
        status=SpaceBooking.PENDING,
    )

    return JsonResponse({
        "message": f"Booking request for {space.name} submitted! It will be confirmed once a librarian approves it.",
        "booking": space_booking_data(booking),
    }, status=201)


@student_api
@require_GET
def student_space_bookings(request):
    bookings = SpaceBooking.objects.filter(member=request.student_member).order_by("-booking_date", "-start_time")
    return JsonResponse({
        "results": [space_booking_data(b) for b in bookings]
    })


@student_api
@require_POST
def cancel_space_booking(request, booking_id):
    obj_id = to_object_id(booking_id)
    booking = SpaceBooking.objects.filter(pk=obj_id, member=request.student_member).first() if obj_id else None
    if not booking:
        return JsonResponse({"error": "Booking not found."}, status=404)

    if booking.status not in (SpaceBooking.PENDING, SpaceBooking.CONFIRMED):
        return JsonResponse({"error": "Only pending or confirmed bookings can be cancelled."}, status=400)

    booking.status = SpaceBooking.CANCELLED
    booking.save(update_fields=["status"])
    return JsonResponse({"message": f"Booking for {booking.space_name} cancelled."})


@librarian_api
@require_GET
def librarian_space_bookings(request):
    status_filter = request.GET.get("status", "").strip()
    date_filter = request.GET.get("date", "").strip()
    space_type = request.GET.get("type", "").strip()

    queryset = SpaceBooking.objects.all().order_by("-created_at")
    if status_filter and status_filter != "all":
        queryset = queryset.filter(status=status_filter)
    if date_filter:
        queryset = queryset.filter(booking_date=date_filter)
    if space_type and space_type != "all":
        queryset = queryset.filter(space_type=space_type)

    return JsonResponse({
        "results": [space_booking_data(b) for b in queryset[:300]]
    })


@librarian_api
@require_POST
def review_space_booking(request, booking_id, action):
    obj_id = to_object_id(booking_id)
    booking = SpaceBooking.objects.filter(pk=obj_id).first() if obj_id else None
    if not booking:
        return JsonResponse({"error": "Booking not found."}, status=404)

    if action not in ("approve", "reject"):
        return JsonResponse({"error": "Action must be approve or reject."}, status=400)

    if booking.status != SpaceBooking.PENDING:
        return JsonResponse({"error": f"This booking is already {booking.status}."}, status=400)

    if action == "approve":
        # Check for another confirmed booking that overlaps
        conflicts = SpaceBooking.objects.filter(
            space=booking.space,
            booking_date=booking.booking_date,
            status=SpaceBooking.CONFIRMED,
            start_time__lt=booking.end_time,
            end_time__gt=booking.start_time,
        ).exclude(pk=booking.pk)

        if conflicts.exists():
            return JsonResponse({
                "error": f"Another booking is already confirmed for {booking.space_name} during this time."
            }, status=400)

        booking.status = SpaceBooking.CONFIRMED
        booking.reviewed_at = timezone.now()
        booking.reviewed_by = request.user
        booking.save(update_fields=["status", "reviewed_at", "reviewed_by"])
        return JsonResponse({
            "message": f"Booking for {booking.space_name} confirmed successfully.",
            "booking": space_booking_data(booking),
        })

    elif action == "reject":
        reason = request.POST.get("reason", "").strip()
        booking.status = SpaceBooking.REJECTED
        booking.rejection_reason = reason or "Declined by librarian"
        booking.reviewed_at = timezone.now()
        booking.reviewed_by = request.user
        booking.save(update_fields=["status", "rejection_reason", "reviewed_at", "reviewed_by"])
        return JsonResponse({
            "message": f"Booking request for {booking.space_name} rejected.",
            "booking": space_booking_data(booking),
        })

    return JsonResponse({"error": "Unsupported review action."}, status=400)


@require_POST
def chat_assistant(request):
    """Handles conversational questions from students/visitors via Gemini AI."""
    student_member = None
    if request.user.is_authenticated:
        student_member = Member.objects.filter(
            user=request.user,
            approval_status=Member.APPROVED,
        ).first()

    try:
        if request.content_type == "application/json":
            payload = json.loads(request.body.decode("utf-8"))
        else:
            payload = request.POST
    except Exception:
        payload = request.POST

    messages_raw = payload.get("messages")
    if isinstance(messages_raw, str):
        try:
            messages = json.loads(messages_raw)
        except Exception:
            messages = [{"role": "user", "text": messages_raw}]
    elif isinstance(messages_raw, list):
        messages = messages_raw
    else:
        text = payload.get("message", "").strip() or payload.get("text", "").strip()
        messages = [{"role": "user", "text": text}] if text else []

    if not messages:
        return JsonResponse({"error": "A message or question is required."}, status=400)

    from library.gemini_service import call_gemini

    reply_text = call_gemini(messages, student_member=student_member)

    return JsonResponse({
        "ok": True,
        "reply": reply_text,
    })


