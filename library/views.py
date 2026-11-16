import calendar
import re
import secrets
from collections import defaultdict
from datetime import datetime, timedelta
from decimal import Decimal
from functools import wraps

from bson import ObjectId
from django.conf import settings
from django.contrib import messages
from django.contrib.auth import authenticate, get_user_model
from django.contrib.auth import login as auth_login
from django.contrib.auth import logout as auth_logout
from django.contrib.auth.decorators import login_required
from django.contrib.auth.models import Group, Permission
from django.core.exceptions import PermissionDenied
from django.db.models import Q
from django.http import Http404, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils import timezone
from django.views.decorators.http import require_POST

from .forms import (
    BookForm,
    CheckoutForm,
    FirstLibrarianForm,
    IssueIdForm,
    LibrarianForm,
    LoginForm,
    PortalPasswordForm,
    ReviewForm,
    StudentCheckoutForm,
    StudentRegistrationForm,
)
from .models import Book, BookCopy, Borrowing, FineEntry, Member, Review


User = get_user_model()
LIBRARIAN_GROUP = "Librarians"
STUDENT_GROUP = "Students"
PIE_COLORS = ["#7464dd", "#76c6a3", "#efa681", "#7da9df", "#d5b954", "#bd81ad", "#7b8db3", "#54b7b4"]
CATEGORIES = ["Technology", "Fiction", "Self Growth", "Productivity", "Design", "Science", "Business", "Other"]


def page(request, template_name, context=None, status=200):
    page_context = {"error": None, "mongo_configured": bool(settings.MONGO_URI)}
    if context:
        page_context.update(context)
    if request.user.is_authenticated:
        page_context.setdefault("current_librarian_id", request.user.pk)
    return render(request, template_name, page_context, status=status)


def librarian_required(view_func):
    @wraps(view_func)
    @login_required(login_url="login")
    def wrapped(request, *args, **kwargs):
        if request.user.is_superuser or request.user.groups.filter(name=LIBRARIAN_GROUP).exists():
            return view_func(request, *args, **kwargs)
        raise PermissionDenied

    return wrapped


def to_object_id(value):
    try:
        return ObjectId(str(value))
    except Exception:
        return None


def object_or_404(model, value):
    object_id = to_object_id(value)
    if object_id is None:
        raise Http404("That record was not found.")
    return get_object_or_404(model, pk=object_id)


def make_staff_id(prefix):
    for _ in range(12):
        candidate = f"{prefix}-{secrets.token_hex(5)}".lower()
        if not User.objects.filter(username__iexact=candidate).exists():
            return candidate
    raise RuntimeError("Could not generate a unique account ID. Please try again.")


def add_to_group(user, group_name):
    group, _ = Group.objects.get_or_create(name=group_name)
    if group_name == LIBRARIAN_GROUP:
        permissions = Permission.objects.filter(content_type__app_label="library")
        group.permissions.add(*permissions)
    user.groups.add(group)


def issue_code_for(record_id):
    return f"CS-{str(record_id).upper()}"


def copy_code_for(copy_id):
    return f"CSB-{str(copy_id).upper()}"


def active_librarians():
    return User.objects.filter(groups__name=LIBRARIAN_GROUP, is_active=True).distinct()


def update_book_stock(book):
    copies = BookCopy.objects.filter(book=book)
    available_count = copies.filter(status=BookCopy.AVAILABLE).count()
    total_count = copies.count()
    book.copies = available_count
    book.total_copies = total_count
    book.available = available_count > 0
    book.save(update_fields=["copies", "total_copies", "available"])


def mark_overdue(record, now=None):
    now = now or timezone.now()
    today = timezone.localdate(now)
    due_day = timezone.localtime(record.due_at).date()
    record.is_overdue = record.status == Borrowing.BORROWED and today > due_day
    record.overdue_days = max(0, (today - due_day).days) if record.is_overdue else 0
    return record


def overdue_fine(record, today=None):
    due_day = timezone.localtime(record.due_at).date()
    overdue_days = max(0, ((today or timezone.localdate()) - due_day).days)
    return overdue_days, Decimal(overdue_days * 20)


def create_borrowing(member, copy_record):
    book = copy_record.book
    now = timezone.now()
    record_id = ObjectId()
    issue_code = issue_code_for(record_id)

    changed = BookCopy.objects.filter(
        pk=copy_record.pk,
        status=BookCopy.AVAILABLE,
    ).update(
        status=BookCopy.BORROWED,
        current_issue_code=issue_code,
        current_member_id=member.pk,
        issued_at=now,
    )
    if changed != 1:
        return None

    update_book_stock(book)
    try:
        borrowing = Borrowing(
            id=record_id,
            book=book,
            member=member,
            book_copy=copy_record,
            issue_code=issue_code,
            copy_id=copy_record.copy_id,
            book_title=book.title,
            book_author=book.author,
            book_shelf=copy_record.shelf or book.shelf or "Unassigned",
            book_category=book.category,
            member_name=member.name,
            member_email=member.email,
            member_course=member.course,
            member_year=member.year,
            member_student_id=member.student_id,
            status=Borrowing.BORROWED,
            borrowed_at=now,
            due_at=now + timedelta(days=14),
        )
        borrowing.save()
        return borrowing
    except Exception:
        BookCopy.objects.filter(pk=copy_record.pk, current_issue_code=issue_code).update(
            status=BookCopy.AVAILABLE,
            current_issue_code="",
            current_member=None,
            issued_at=None,
        )
        update_book_stock(book)
        return None


def dashboard(request):
    now = timezone.now()
    books = list(Book.objects.all())
    members = list(Member.objects.all())
    active_records = list(Borrowing.objects.filter(status=Borrowing.BORROWED))
    overdue_count = sum(1 for record in active_records if record.due_at < now)
    category_counts = defaultdict(lambda: {"titles": 0, "total_copies": 0, "available_copies": 0})
    course_counts = defaultdict(int)

    for book in books:
        counts = category_counts[book.category]
        counts["titles"] += 1
        counts["total_copies"] += book.total_copies
        counts["available_copies"] += book.copies
    for member in members:
        course_counts[member.course] += 1

    category_data = []
    for index, (category, values) in enumerate(sorted(category_counts.items(), key=lambda item: item[1]["total_copies"], reverse=True)):
        category_data.append({"name": category, "color": PIE_COLORS[index % len(PIE_COLORS)], **values})

    course_data = [
        {"name": course, "members": count, "color": PIE_COLORS[index % len(PIE_COLORS)]}
        for index, (course, count) in enumerate(sorted(course_counts.items(), key=lambda item: item[1], reverse=True))
    ]

    total_copies = sum(book.total_copies for book in books)
    available_copies = sum(book.copies for book in books)
    on_loan = max(0, total_copies - available_copies)
    stats = {
        "books": len(books),
        "members": len(members),
        "active": len(active_records),
        "overdue": overdue_count,
        "on_time": max(0, len(active_records) - overdue_count),
        "reviews": Review.objects.count(),
        "total_copies": total_copies,
        "available_copies": available_copies,
        "on_loan": on_loan,
        "categories": len(category_data),
        "courses": len(course_data),
    }
    stats["available_pct"] = round(100 * available_copies / max(total_copies, 1))
    stats["on_loan_pct"] = round(100 * on_loan / max(total_copies, 1))
    stats["books_pie"] = donut_stops([row["titles"] for row in category_data])
    stats["shelf_pie"] = donut_stops([available_copies, on_loan], ["#76c6a3", "#7464dd"])
    stats["loan_pie"] = donut_stops([on_loan, available_copies], ["#7464dd", "#76c6a3"])
    stats["overdue_pie"] = donut_stops([overdue_count, stats["on_time"]], ["#efa681", "#76c6a3"])
    stats["students_pie"] = donut_stops([row["members"] for row in course_data])

    popular_counts = defaultdict(int)
    for record in Borrowing.objects.all():
        popular_counts[record.book_title] += 1
    popular = [
        {"title": title, "borrow_count": count}
        for title, count in sorted(popular_counts.items(), key=lambda item: item[1], reverse=True)[:5]
    ]
    recent = list(Borrowing.objects.all()[:5])
    overdue_records = [mark_overdue(record, now) for record in active_records if record.due_at < now]
    overdue_records.sort(key=lambda record: record.due_at)

    month_index = now.year * 12 + now.month - 1
    month_keys = []
    for offset in reversed(range(6)):
        year, month_zero = divmod(month_index - offset, 12)
        month = month_zero + 1
        month_keys.append((f"{year:04d}-{month:02d}", calendar.month_abbr[month]))

    start_year, start_month_zero = divmod(month_index - 5, 12)
    start = datetime(start_year, start_month_zero + 1, 1, tzinfo=timezone.get_current_timezone())
    circulation_records = Borrowing.objects.filter(borrowed_at__gte=start, borrowed_at__lte=now)
    issue_counts = defaultdict(int)
    return_counts = defaultdict(int)
    for record in circulation_records:
        issue_counts[record.borrowed_at.strftime("%Y-%m")] += 1
        if record.returned_at and start <= record.returned_at <= now:
            return_counts[record.returned_at.strftime("%Y-%m")] += 1

    max_count = max([issue_counts[key] for key, _ in month_keys] + [return_counts[key] for key, _ in month_keys] + [1])
    circulation = [
        {
            "label": label,
            "issues": issue_counts[key],
            "returns": return_counts[key],
            "issues_bar_height": round(100 * issue_counts[key] / max_count),
            "returns_bar_height": round(100 * return_counts[key] / max_count),
        }
        for key, label in month_keys
    ]

    return page(request, "library/dashboard.html", {
        "active": "dashboard",
        "stats": stats,
        "category_data": category_data,
        "course_data": course_data,
        "popular": popular,
        "recent": recent,
        "overdue_records": overdue_records[:5],
        "circulation": circulation,
    })


@librarian_required
def books(request):
    query = request.GET.get("q", "").strip()
    category = request.GET.get("category", "").strip()
    if request.GET.get("clear") == "1":
        category = ""

    if request.GET.get("clear") == "1":
        selected_category = ""
    else:
        selected_category = category or request.COOKIES.get("campusshelf_category", "")
    items = Book.objects.all()
    if query:
        items = items.filter(
            Q(title__icontains=query)
            | Q(author__icontains=query)
            | Q(category__icontains=query)
            | Q(isbn__icontains=query)
            | Q(description__icontains=query)
        )
    if selected_category:
        items = items.filter(category=selected_category)

    book_list = list(items[:200])
    for book in book_list:
        book.on_loan = max(0, book.total_copies - book.copies)
    category_names = sorted(set(Book.objects.values_list("category", flat=True)) | set(CATEGORIES))
    response = page(request, "library/books.html", {
        "active": "books",
        "books": book_list,
        "q": query,
        "selected_category": selected_category,
        "categories": category_names,
    })
    if request.GET.get("clear") == "1":
        response.delete_cookie("campusshelf_category")
    elif category:
        response.set_cookie("campusshelf_category", category, max_age=60 * 60 * 24 * 60, httponly=True, samesite="Lax")
    return response


@librarian_required
def add_book(request):
    if request.method == "POST":
        form = BookForm(request.POST)
        if form.is_valid():
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
                    status=BookCopy.AVAILABLE,
                )
            messages.success(request, f"Book added with {book.total_copies} unique copy ID(s).")
            return redirect("book_copies", book_id=book.id)
        messages.error(request, "Please correct the book details and try again.")
    else:
        form = BookForm(initial={"copies": 1})
    return page(request, "library/add_book.html", {
        "active": "add_book",
        "form": form,
        "categories": CATEGORIES,
    })


@librarian_required
def book_copies(request, book_id):
    book = object_or_404(Book, book_id)
    copies = list(BookCopy.objects.filter(book=book).order_by("copy_id"))
    for copy_record in copies:
        issue = Borrowing.objects.filter(issue_code=copy_record.current_issue_code).first() if copy_record.current_issue_code else None
        copy_record.borrower_name = issue.member_name if issue else ""
    return page(request, "library/book_copies.html", {"active": "books", "book": book, "copies": copies})


@librarian_required
@require_POST
def delete_book(request, book_id):
    book = object_or_404(Book, book_id)
    if Borrowing.objects.filter(book=book, status=Borrowing.BORROWED).exists():
        messages.error(request, "This book has an active borrowing and cannot be deleted until it is returned.")
        return redirect("books")
    BookCopy.objects.filter(book=book).delete()
    book.delete()
    messages.success(request, "Book deleted. Historical borrowing records are retained.")
    return redirect("books")


@librarian_required
def members(request):
    if request.method == "POST":
        form = StudentRegistrationForm(request.POST)
        if form.is_valid():
            values = form.cleaned_data
            if Member.objects.filter(email__iexact=values["email"]).exists():
                form.add_error("email", "This student email is already registered.")
                messages.error(request, "This student email is already registered.")
            else:
                student_id = make_staff_id("STU").upper()
                user = User(username=student_id, email=values["email"], first_name=values["name"])
                user.set_password(values["password"])
                try:
                    user.save()
                    add_to_group(user, STUDENT_GROUP)
                    Member.objects.create(
                        user=user,
                        student_id=student_id,
                        name=values["name"],
                        email=values["email"],
                        course=values["course"],
                        year=values["year"],
                    )
                    messages.success(request, f"Student registered · Student ID {student_id}")
                    return redirect("members")
                except Exception:
                    if user.pk:
                        user.delete()
                    messages.error(request, "The student could not be saved. Please try again.")
        else:
            messages.error(request, "Please check the student details and password confirmation.")
    else:
        form = StudentRegistrationForm()

    items = list(Member.objects.all()[:200])
    for item in items:
        item.portal_password_set = bool(item.user and item.user.has_usable_password())
    return page(request, "library/members.html", {
        "active": "members",
        "members": items,
        "years": range(1, 7),
        "form": form,
    })


@librarian_required
@require_POST
def reset_member_portal_password(request, member_id):
    member = object_or_404(Member, member_id)
    form = PortalPasswordForm(request.POST)
    if not form.is_valid():
        messages.error(request, "Choose a password with at least 10 characters and enter it twice.")
        return redirect("members")

    if member.user:
        user = member.user
    else:
        user = User.objects.filter(username=member.student_id).first()
        if user is None:
            user = User(username=member.student_id, email=member.email, first_name=member.name)
        member.user = user
    user.email = member.email
    user.first_name = member.name
    user.set_password(form.cleaned_data["password"])
    user.save()
    add_to_group(user, STUDENT_GROUP)
    member.password_hash = ""
    member.save(update_fields=["user", "password_hash"])
    messages.success(request, f"Portal password updated for {member.student_id}.")
    return redirect("members")


@librarian_required
@require_POST
def delete_member(request, member_id):
    member = object_or_404(Member, member_id)
    if Borrowing.objects.filter(member=member, status=Borrowing.BORROWED).exists():
        messages.error(request, "This student has an active issue and cannot be removed until the book is returned.")
        return redirect("members")
    name = member.name
    if member.user:
        member.user.is_active = False
        member.user.save(update_fields=["is_active"])
    member.delete()
    messages.success(request, f"{name} removed. Historical issue slips are retained.")
    return redirect("members")


@librarian_required
def search_issue_books(request):
    raw = request.GET.get("q", "").strip()
    if len(raw) < 2:
        return JsonResponse({"results": []})
    matches = Book.objects.filter(copies__gt=0).filter(
        Q(title__icontains=raw) | Q(author__icontains=raw) | Q(isbn__icontains=raw)
    )[:8]
    return JsonResponse({"results": [{
        "id": str(book.id),
        "title": book.title,
        "author": book.author,
        "category": book.category,
        "shelf": book.shelf,
        "isbn": book.isbn,
        "copies": book.copies,
    } for book in matches]})


@librarian_required
def lookup_issue_copy(request):
    copy_id = request.GET.get("q", "").strip().upper()
    copy_record = BookCopy.objects.filter(copy_id=copy_id, status=BookCopy.AVAILABLE).first()
    if not copy_record:
        return JsonResponse({"results": []})
    book = copy_record.book
    return JsonResponse({"results": [{
        "book_id": str(book.id),
        "copy_id": copy_record.copy_id,
        "title": book.title,
        "author": book.author,
        "category": book.category,
        "shelf": copy_record.shelf or book.shelf,
        "copies": book.copies,
    }]})


@librarian_required
def search_issue_students(request):
    raw = request.GET.get("q", "").strip()
    if len(raw) < 2:
        return JsonResponse({"results": []})
    members_query = Member.objects.filter(approval_status=Member.APPROVED)
    if raw.upper().startswith("STU-"):
        exact = members_query.filter(student_id__iexact=raw).first()
        matches = [exact] if exact else []
    else:
        matches = list(members_query.filter(
            Q(name__icontains=raw)
            | Q(email__icontains=raw)
            | Q(student_id__icontains=raw)
            | Q(course__icontains=raw)
        ).order_by("name")[:8])
    return JsonResponse({"results": [{
        "id": str(member.id),
        "student_id": member.student_id,
        "name": member.name,
        "email": member.email,
        "course": member.course,
        "year": member.year,
    } for member in matches]})


@librarian_required
def borrowings(request):
    if request.method == "POST":
        form = CheckoutForm(request.POST)
        member_id = to_object_id(form.cleaned_data["member_id"]) if form.is_valid() else None
        member = Member.objects.filter(
            pk=member_id,
            approval_status=Member.APPROVED,
        ).first() if member_id else None
        copy_id = form.cleaned_data.get("copy_id", "").strip().upper() if form.is_valid() else ""
        copy_record = BookCopy.objects.filter(copy_id=copy_id, status=BookCopy.AVAILABLE).first() if copy_id else None
        if not form.is_valid():
            messages.error(request, "Choose a student and enter a valid available Copy ID.")
        elif not member:
            messages.error(request, "Choose a valid registered student.")
        elif not copy_record or str(copy_record.book_id) != str(to_object_id(form.cleaned_data["book_id"])):
            messages.error(request, "That Copy ID is unavailable or does not match the selected title.")
        elif Borrowing.objects.filter(member=member, status=Borrowing.BORROWED).count() >= 5:
            messages.error(request, "This student has reached the five active book limit.")
        else:
            record = create_borrowing(member, copy_record)
            if record:
                messages.success(request, f"Issue recorded · {record.issue_code}")
                return redirect("issue_slip", issue_code=record.issue_code)
            messages.error(request, "That copy was just issued or the checkout could not be saved. Please try again.")
        return redirect("borrowings")
    return page(request, "library/borrowings.html", {"active": "borrowings"})


def get_issue_records(query=""):
    records = Borrowing.objects.all()
    if query:
        clean_query = query.strip()
        if clean_query.upper().startswith("CS-"):
            records = records.filter(issue_code__iexact=clean_query)
        elif clean_query.upper().startswith("STU-"):
            records = records.filter(member_student_id__iexact=clean_query)
        else:
            records = records.filter(
                Q(book_title__icontains=clean_query)
                | Q(book_author__icontains=clean_query)
                | Q(member_name__icontains=clean_query)
                | Q(member_email__icontains=clean_query)
                | Q(member_student_id__icontains=clean_query)
                | Q(issue_code__icontains=clean_query)
            )
    now = timezone.now()
    return [mark_overdue(record, now) for record in records[:200]]


@librarian_required
def issue_register(request):
    query = request.GET.get("q", "").strip()
    return page(request, "library/issue_register.html", {
        "active": "issue_register",
        "records": get_issue_records(query),
        "q": query,
    })


@librarian_required
def issue_slip(request, issue_code):
    record = get_object_or_404(Borrowing, issue_code=issue_code.strip().upper())
    mark_overdue(record)
    return page(request, "library/issue_slip.html", {"active": "issue_register", "record": record})


def student_portal(request):
    books = list(Book.objects.order_by("title")[:6])
    featured_books = []
    for book in books:
        total = BookCopy.objects.filter(book=book).count()
        available = BookCopy.objects.filter(book=book, status=BookCopy.AVAILABLE).count()
        featured_books.append({
            "id": str(book.id),
            "title": book.title,
            "author": book.author,
            "category": book.category,
            "description": book.description,
            "shelf": book.shelf or "Unassigned",
            "available": available,
            "total": total,
        })
    return page(request, "library/student_portal.html", {"books": featured_books})


def student_book_search(request):
    query = request.GET.get("q", "").strip()
    if len(query) < 2:
        return JsonResponse({"results": []})
    matches = Book.objects.filter(
        Q(title__icontains=query)
        | Q(author__icontains=query)
        | Q(category__icontains=query)
        | Q(isbn__icontains=query)
        | Q(description__icontains=query)
    ).order_by("title")[:10]
    results = []
    for book in matches:
        results.append({
            "id": str(book.id),
            "title": book.title,
            "author": book.author,
            "category": book.category,
            "description": book.description,
            "isbn": book.isbn,
            "shelf": book.shelf or "Unassigned",
            "available": BookCopy.objects.filter(book=book, status=BookCopy.AVAILABLE).count(),
            "total": BookCopy.objects.filter(book=book).count(),
        })
    return JsonResponse({"results": results})


@require_POST
def student_issue(request):
    form = StudentCheckoutForm(request.POST)
    if not form.is_valid():
        messages.error(request, "Enter your Student ID, registered email, password, title and Copy ID.")
        return redirect("student_portal")
    values = form.cleaned_data
    member = Member.objects.filter(
        student_id__iexact=values["student_id"].strip(),
        approval_status=Member.APPROVED,
    ).first()
    if not member or not member.user or member.email.casefold() != values["email"].strip().casefold():
        messages.error(request, "Student ID, registered campus email, or password did not match.")
        return redirect("student_portal")
    user = authenticate(request, username=member.user.username, password=values["password"])
    if user is None or user.pk != member.user_id:
        messages.error(request, "Student ID, registered campus email, or password did not match.")
        return redirect("student_portal")
    auth_login(request, user)

    book_id = to_object_id(values["book_id"])
    book = Book.objects.filter(pk=book_id).first() if book_id else None
    copy_record = BookCopy.objects.filter(copy_id=values["copy_id"].strip().upper(), status=BookCopy.AVAILABLE).first()
    if not book or not copy_record or copy_record.book_id != book.id:
        messages.error(request, "Choose the matching title and enter an available Copy ID printed in that book.")
        return redirect("student_portal")
    if Borrowing.objects.filter(member=member, status=Borrowing.BORROWED).count() >= 5:
        messages.error(request, "This student has reached the five active book limit. Please visit the librarian desk.")
        return redirect("student_portal")

    record = create_borrowing(member, copy_record)
    if not record:
        messages.error(request, "That copy was just checked out. Search again for another available copy.")
        return redirect("student_portal")
    allowed_slips = request.session.get("student_issue_codes", [])
    allowed_slips.append(record.issue_code)
    request.session["student_issue_codes"] = allowed_slips[-5:]
    return redirect("student_slip", issue_code=record.issue_code)


def student_slip(request, issue_code):
    normalized_code = issue_code.strip().upper()
    if normalized_code not in request.session.get("student_issue_codes", []):
        raise Http404("That student issue slip was not found.")
    record = get_object_or_404(Borrowing, issue_code=normalized_code)
    mark_overdue(record)
    return page(request, "library/student_slip.html", {"record": record})


def login(request):
    if active_librarians().exists():
        if request.user.is_authenticated and (
            request.user.is_superuser or request.user.groups.filter(name=LIBRARIAN_GROUP).exists()
        ):
            return redirect("dashboard")
        setup = False
    else:
        return redirect("setup_librarian")

    form = LoginForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        login_id = form.cleaned_data["login_id"].strip().casefold()
        user = authenticate(request, username=login_id, password=form.cleaned_data["password"])
        if user and (user.is_superuser or user.groups.filter(name=LIBRARIAN_GROUP).exists()):
            auth_login(request, user)
            return redirect("dashboard")
        messages.error(request, "That librarian ID and password did not match an active account.")
    return page(request, "library/login.html", {"setup": setup, "form": form})


def setup_librarian(request):
    if active_librarians().exists():
        return redirect("login")
    form = FirstLibrarianForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        name = form.cleaned_data["name"].strip()
        login_id = make_staff_id("LIB")
        user = User(username=login_id, first_name=name)
        user.set_password(form.cleaned_data["password"])
        user.save()
        add_to_group(user, LIBRARIAN_GROUP)
        auth_login(request, user)
        messages.success(request, f"Your librarian ID is {login_id.upper()}. Keep it for future sign-ins.")
        return redirect("dashboard")
    return page(request, "library/login.html", {
        "setup": True,
        "setup_code_required": not settings.DEBUG,
        "form": form,
    })


@require_POST
def logout(request):
    auth_logout(request)
    messages.success(request, "You have signed out.")
    return redirect("login")


@librarian_required
def librarians(request):
    if request.method == "POST":
        form = LibrarianForm(request.POST)
        if form.is_valid():
            login_id = make_staff_id("LIB")
            user = User(username=login_id, first_name=form.cleaned_data["name"].strip())
            user.set_password(form.cleaned_data["password"])
            user.save()
            add_to_group(user, LIBRARIAN_GROUP)
            messages.success(request, f"Librarian ID {login_id.upper()} created. Share it with the new librarian.")
            return redirect("librarians")
        messages.error(request, "Enter a name and a password with at least 10 characters.")

    staff = User.objects.filter(groups__name=LIBRARIAN_GROUP).order_by("-is_active", "first_name")
    librarians_list = [{
        "id": user.id,
        "name": user.first_name or user.username,
        "login_id": user.username,
        "created_at": user.date_joined,
        "active": user.is_active,
    } for user in staff]
    return page(request, "library/librarians.html", {
        "active": "librarians",
        "librarians": librarians_list,
        "active_librarian_count": sum(1 for user in librarians_list if user["active"]),
    })


@librarian_required
@require_POST
def deactivate_librarian(request, librarian_id):
    user = object_or_404(User, librarian_id)
    if user.pk == request.user.pk:
        messages.error(request, "You cannot disable the ID you are currently signed in with.")
    elif not user.groups.filter(name=LIBRARIAN_GROUP).exists():
        raise Http404("That librarian was not found.")
    elif active_librarians().count() <= 1:
        messages.error(request, "Keep at least one active librarian ID.")
    else:
        user.is_active = False
        user.save(update_fields=["is_active"])
        messages.success(request, "Librarian ID disabled.")
    return redirect("librarians")


def complete_return(record, returned_by=None):
    now = timezone.now()
    changed = Borrowing.objects.filter(pk=record.pk, status=Borrowing.BORROWED).update(
        status=Borrowing.RETURNED,
        returned_at=now,
    )
    if changed != 1:
        return False

    overdue_days, amount = overdue_fine(record)
    if amount > 0:
        FineEntry.objects.create(
            member=record.member,
            borrowing=record,
            member_name=record.member_name,
            student_id=record.member_student_id,
            amount=amount,
            fine_type=FineEntry.OVERDUE,
            reason=f"{overdue_days} overdue calendar day(s) at ₹20 per day",
            created_by=returned_by,
            created_at=now,
        )

    copy_record = BookCopy.objects.filter(
        copy_id=record.copy_id,
        current_issue_code=record.issue_code,
        status=BookCopy.BORROWED,
    ).first()
    if copy_record:
        copy_record.status = BookCopy.AVAILABLE
        copy_record.current_issue_code = ""
        copy_record.current_member = None
        copy_record.issued_at = None
        copy_record.save(update_fields=["status", "current_issue_code", "current_member", "issued_at"])
    if record.book_id:
        book = Book.objects.filter(pk=record.book_id).first()
        if book:
            update_book_stock(book)
    return True


@librarian_required
@require_POST
def return_by_issue_id(request):
    form = IssueIdForm(request.POST)
    issue_code = form.cleaned_data["issue_code"].strip().upper() if form.is_valid() else ""
    record = Borrowing.objects.filter(issue_code=issue_code, status=Borrowing.BORROWED).first() if issue_code else None
    if record and complete_return(record):
        messages.success(request, f"Book returned · {record.issue_code}")
    else:
        messages.error(request, "No active borrowing found for that Issue ID.")
    return redirect("borrowings")


@librarian_required
@require_POST
def return_book(request, issue_code):
    record = Borrowing.objects.filter(issue_code=issue_code.strip().upper(), status=Borrowing.BORROWED).first()
    if record and complete_return(record):
        messages.success(request, f"Book returned · {record.issue_code}")
    else:
        messages.error(request, "Issue ID not found or book already returned.")
    return redirect("issue_register")


@librarian_required
def reviews(request):
    if request.method == "POST":
        form = ReviewForm(request.POST)
        if form.is_valid():
            book_id = to_object_id(form.cleaned_data["book_id"])
            member_id = to_object_id(form.cleaned_data["member_id"])
            book = Book.objects.filter(pk=book_id).first() if book_id else None
            member = Member.objects.filter(pk=member_id).first() if member_id else None
            if book and member:
                Review.objects.create(
                    book=book,
                    member=member,
                    book_title=book.title,
                    member_name=member.name,
                    rating=form.cleaned_data["rating"],
                    comment=form.cleaned_data["comment"].strip(),
                )
                messages.success(request, "Review published.")
                return redirect("reviews")
        messages.error(request, "Choose a book and student, a rating from 1 to 5, and enter a note.")
    else:
        form = ReviewForm()
    return page(request, "library/reviews.html", {
        "active": "reviews",
        "reviews": list(Review.objects.all()[:200]),
        "books": Book.objects.all(),
        "members": Member.objects.all(),
        "rating_choices": range(5, 0, -1),
        "star_values": range(1, 6),
        "form": form,
    })


def donut_stops(values, colors=None):
    colors = colors or PIE_COLORS
    total = sum(values)
    if not total:
        return "#e9e6f1 0% 100%"
    stops = []
    edge = 0.0
    for index, value in enumerate(values):
        if not value:
            continue
        next_edge = edge + (100 * value / total)
        stops.append(f"{colors[index % len(colors)]} {edge:.2f}% {next_edge:.2f}%")
        edge = next_edge
    return ", ".join(stops)


@librarian_required
def insights(request):
    books = list(Book.objects.all())
    members = list(Member.objects.all())
    categories_by_name = defaultdict(lambda: {"total_books": 0, "total_copies": 0, "available_copies": 0})
    courses = defaultdict(int)
    for book in books:
        row = categories_by_name[book.category]
        row["total_books"] += 1
        row["total_copies"] += book.total_copies
        row["available_copies"] += book.copies
    for member in members:
        courses[member.course] += 1

    categories = []
    for index, (name, values) in enumerate(sorted(categories_by_name.items(), key=lambda item: item[1]["total_copies"], reverse=True)):
        categories.append({"name": name, "color": PIE_COLORS[index % len(PIE_COLORS)], **values})
    members_by_course = [
        {"course": course, "members": count, "color": PIE_COLORS[index % len(PIE_COLORS)]}
        for index, (course, count) in enumerate(sorted(courses.items(), key=lambda item: item[1], reverse=True))
    ]

    popular_counts = defaultdict(int)
    for record in Borrowing.objects.all():
        popular_counts[record.book_title] += 1
    popular = [{"title": title, "checkouts": count} for title, count in sorted(popular_counts.items(), key=lambda item: item[1], reverse=True)[:8]]

    ratings_by_title = defaultdict(lambda: {"total": 0, "count": 0})
    for review in Review.objects.all():
        row = ratings_by_title[review.book_title]
        row["total"] += review.rating
        row["count"] += 1
    ratings = [
        {"title": title, "average_rating": values["total"] / values["count"], "review_count": values["count"]}
        for title, values in sorted(ratings_by_title.items(), key=lambda item: item[1]["total"] / item[1]["count"], reverse=True)
    ]

    total_titles = len(books)
    total_copies = sum(book.total_copies for book in books)
    available_copies = sum(book.copies for book in books)
    on_loan_copies = max(0, total_copies - available_copies)
    total_students = len(members)
    now = timezone.now()
    active_loans = Borrowing.objects.filter(status=Borrowing.BORROWED).count()
    overdue_loans = sum(1 for record in Borrowing.objects.filter(status=Borrowing.BORROWED) if record.due_at < now)
    on_time_loans = max(0, active_loans - overdue_loans)
    return page(request, "library/insights.html", {
        "active": "insights",
        "categories": categories,
        "popular": popular,
        "ratings": ratings,
        "members_by_course": members_by_course,
        "total_titles": total_titles,
        "total_copies": total_copies,
        "available_copies": available_copies,
        "on_loan_copies": on_loan_copies,
        "total_students": total_students,
        "active_loans": active_loans,
        "overdue_loans": overdue_loans,
        "on_time_loans": on_time_loans,
        "category_pie": donut_stops([item["total_books"] for item in categories]),
        "copy_pie": donut_stops([available_copies, on_loan_copies], ["#76c6a3", "#7464dd"]),
        "loan_pie": donut_stops([on_time_loans, overdue_loans], ["#76c6a3", "#efa681"]),
        "course_pie": donut_stops([item["members"] for item in members_by_course]),
    })


def health(request):
    from django.db import connection

    try:
        connection.ensure_connection()
        Book.objects.count()
        return JsonResponse({"ok": True, "database": settings.DATABASES["default"]["NAME"]})
    except Exception:
        return JsonResponse({"ok": False, "message": "Could not connect to MongoDB. Check MONGO_URI and Atlas Network Access."}, status=503)
