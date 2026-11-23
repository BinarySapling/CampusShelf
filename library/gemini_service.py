import json
import logging
import os
import re
import ssl
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta

from django.db.models import Q
from django.utils import timezone

from library.models import (
    Book,
    BookReservation,
    Borrowing,
    FineEntry,
    LibrarySpace,
    Member,
    SpaceBooking,
)

logger = logging.getLogger(__name__)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
PRIMARY_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.1-flash-lite").strip()
# gemini-3.5-flash-lite is the active, verified v1 model for seamless fallback
FALLBACK_MODELS = ["gemini-3.5-flash-lite"]

TIME_SLOTS = [
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

OFF_TOPIC_REFUSAL = (
    "I am only able to help with **CampusShelf** library services, study pod & conference room bookings, "
    "and book catalogue inquiries. I cannot write code or answer questions unrelated to the library.\n\n"
    "Please let me know if you would like to check free study spaces, book a slot, or explore books in our catalogue!"
)

OFF_TOPIC_REGEXES = [
    re.compile(r"\b(give|write|generate|show|provide|create|print|code)\b.*?\b(code|script|program|function|class|algorithm|regex|solution|snippet)\b", re.I),
    re.compile(r"\b(python|javascript|java|c\+\+|cpp|html|css|sql|rust|php|golang|bash)\s+(code|script|program|function)\b", re.I),
    re.compile(r"\b(python|javascript|java|c\+\+|cpp)\b.*?\b(code|program|script|def |function)\b", re.I),
    re.compile(r"\b(write|compose|generate)\s+a?\s*(essay|poem|song|story|letter|speech|resume|cv|joke)\b", re.I),
    re.compile(r"\b(tell me|give me)\s+a?\s*(joke|riddle|story|poem)\b", re.I),
    re.compile(r"\b(solve|calculate)\b.*?\b(math|equation|derivative|integral|algebra|arithmetic)\b", re.I),
    re.compile(r"\b(who is|who was|who won|capital of|weather in|recipe for|how to cook|how to make a cake)\b", re.I),
]


def is_off_topic_query(query_text):
    """
    Returns True if the query is asking for something unrelated to CampusShelf,
    such as writing code, solving homework, writing essays, recipes, or general trivia.
    Does not block queries asking for programming or CS books in the library catalogue.
    """
    text = (query_text or "").strip()
    if not text:
        return False

    lower = text.lower()
    is_book_query = bool(re.search(r"\b(book|books|author|shelf|read|textbook|copies|catalogue)\b", lower))
    is_code_request = bool(re.search(r"\b(code|script|program|syntax|function|def |import |print\()\b", lower))

    # If it explicitly asks to write or give code, it is always off-topic
    if is_code_request and any(w in lower for w in ["give", "write", "generate", "code for", "how to code", "show code", "coding"]):
        return True

    for pattern in OFF_TOPIC_REGEXES:
        if pattern.search(lower):
            if is_book_query and not is_code_request:
                return False
            return True

    return False


def extract_potential_date(query_text):
    """Detects if user asked about a specific date (e.g. 2026-11-25 or tomorrow)."""
    today = timezone.localdate()
    lower = query_text.lower() if query_text else ""

    if "tomorrow" in lower:
        return (today + timedelta(days=1)).isoformat()
    if "today" in lower:
        return today.isoformat()

    match = re.search(r"\b(20\d\d-\d{2}-\d{2})\b", lower)
    if match:
        return match.group(1)

    return today.isoformat()


def get_spaces_availability_data(target_date):
    """Computes exact hourly availability breakdown for all active spaces."""
    spaces = list(LibrarySpace.objects.filter(is_active=True))
    space_ids = [sp.pk for sp in spaces]

    day_bookings = list(
        SpaceBooking.objects.filter(
            space_id__in=space_ids,
            booking_date=target_date,
            status__in=[SpaceBooking.CONFIRMED, SpaceBooking.PENDING],
        )
    )

    bookings_by_space = defaultdict(list)
    for b in day_bookings:
        bookings_by_space[b.space_id].append(b)

    results = []
    for sp in spaces:
        s_bookings = bookings_by_space.get(sp.pk, [])
        empty_hours = []
        occupied_hours = []
        pending_hours = []

        for start, end in TIME_SLOTS:
            status = "empty"
            for b in s_bookings:
                if b.start_time < end and b.end_time > start:
                    status = "occupied" if b.status == SpaceBooking.CONFIRMED else "pending"
                    break
            if status == "empty":
                empty_hours.append(f"{start}-{end}")
            elif status == "occupied":
                occupied_hours.append(f"{start}-{end}")
            else:
                pending_hours.append(f"{start}-{end}")

        results.append({
            "space": sp,
            "empty": empty_hours,
            "occupied": occupied_hours,
            "pending": pending_hours,
        })
    return results


def smart_local_response(query_text, student_member=None):
    """
    Intelligent domain assistant that provides 100% accurate, instant answers
    directly from CampusShelf database whenever Gemini is slow or unavailable.
    """
    text = (query_text or "").lower().strip()
    if is_off_topic_query(text):
        return OFF_TOPIC_REFUSAL

    target_date = extract_potential_date(text)

    # 1. Asking about free slots, spaces, pods, or rooms
    if any(k in text for k in ["free slot", "which slot", "slot is free", "empty slot", "available slot", "pod", "room", "space availability", "study space"]):
        data = get_spaces_availability_data(target_date)
        lines = [f"Here is the real-time slot availability for **{target_date}**:\n"]
        for item in data[:6]:
            sp = item["space"]
            free_str = ", ".join(item["empty"][:5]) if item["empty"] else "None (Fully Booked)"
            if len(item["empty"]) > 5:
                free_str += f" (+{len(item['empty']) - 5} more)"
            icon = "🎧" if sp.space_type == "pod" else "🏛️" if sp.space_type == "room" else "📖"
            lines.append(f"{icon} **{sp.name}** ({sp.get_space_type_display()}, max {sp.capacity} students)")
            lines.append(f"   • Location: {sp.location or 'Library'}")
            lines.append(f"   • Free slots: {free_str}")
            if item["occupied"]:
                lines.append(f"   • Confirmed booked: {', '.join(item['occupied'])}")
            if item["pending"]:
                lines.append(f"   • Pending approval: {', '.join(item['pending'])}")
            lines.append("")

        lines.append("💡 **To book a slot**: Open the **Room & Pods** tab in the sidebar, select your preferred time, and click **Book Slot (Send for Approval)**.")
        return "\n".join(lines)

    # 2. How to book a slot / booking procedure
    if any(k in text for k in ["how to book", "book slot", "booking procedure", "reserve slot", "reserve room", "reserve pod", "booking process"]):
        return (
            "### 📌 How to Book a Pod or Conference Room:\n\n"
            "1. **Go to Room & Pods**: Click on the **Room & Pods** tab in the sidebar navigation.\n"
            "2. **Check Availability**: View the live daily timeline. Green pills indicate **Empty** slots.\n"
            "3. **Choose Space**: Click **Book Slot** on your desired pod/room (or click directly on any green empty slot pill).\n"
            "4. **Fill Details**:\n"
            "   - Select Date.\n"
            "   - Pick Start Time and End Time (8:00 AM to 8:00 PM).\n"
            "   - Specify the number of students (must not exceed space capacity).\n"
            "   - Add an optional study topic/purpose.\n"
            "5. **Submit Request**: Click **Book Slot (Send for Approval)**.\n\n"
            "⏳ *Your request will be submitted in **Pending Approval** state. Once a librarian reviews and approves it, your reservation is confirmed!*"
        )

    # 3. Book recommendations / catalogue search
    if any(k in text for k in ["recommend", "suggest", "book releted", "book related", "search book", "find book", "books on", "read"]):
        cleaned = re.sub(r"\b(recommend|suggest|me|a|some|book|books|related|to|about|please|find|show)\b", "", text).strip()
        matching_books = []
        if cleaned:
            matching_books = list(
                Book.objects.filter(
                    Q(title__icontains=cleaned) |
                    Q(category__icontains=cleaned) |
                    Q(author__icontains=cleaned) |
                    Q(description__icontains=cleaned)
                )[:6]
            )

        if not matching_books:
            matching_books = list(Book.objects.all().order_by("-copies")[:5])

        lines = ["Here are recommended titles from the CampusShelf collection:\n"]
        for b in matching_books:
            avail = f"{b.copies} copies available" if b.copies > 0 else "All copies currently checked out"
            lines.append(f"📚 **{b.title}**")
            lines.append(f"   • Author: {b.author}")
            lines.append(f"   • Category: {b.category} | Shelf: **{b.shelf}**")
            lines.append(f"   • Availability: {avail}")
            lines.append("")

        lines.append("📖 You can find and reserve these under the **Discover** tab in the sidebar!")
        return "\n".join(lines)

    # 4. Student's personal loans, bookings, or account status
    if student_member and (
        ("my" in text and any(w in text for w in ["booking", "loan", "hold", "fine", "account", "record", "due", "status", "profile"]))
        or any(k in text for k in ["my bookings", "my loans", "my holds", "my fines", "what did i book", "what did i borrow"])
    ):
        my_bookings = SpaceBooking.objects.filter(member=student_member).order_by("-booking_date", "-start_time")[:4]
        my_loans = Borrowing.objects.filter(member=student_member, status=Borrowing.BORROWED)
        lines = [f"👤 **Student Record for {student_member.name}** ({student_member.student_id}):\n"]

        if my_bookings.exists():
            lines.append("**Your Space Bookings:**")
            for b in my_bookings:
                lines.append(f"  • {b.space_name} on {b.booking_date} ({b.start_time}-{b.end_time}) — Status: **{b.get_status_display()}**")
        else:
            lines.append("**Space Bookings:** No active reservations.")

        lines.append("")
        if my_loans.exists():
            lines.append("**Your Current Loans:**")
            for l in my_loans:
                lines.append(f"  • *{l.book_title}* (Due: {l.due_at.strftime('%Y-%m-%d')})")
        else:
            lines.append("**Current Loans:** No books checked out.")

        return "\n".join(lines)

    # 5. General platform help / login / signup
    if any(k in text for k in ["login", "sign in", "sign up", "register", "create account"]):
        return (
            "### 🔑 CampusShelf Account Access:\n\n"
            "- **New Student Registration**: You can create an account directly on the login screen. No librarian pre-approval is required!\n"
            "- **Sign In Options**: You can sign in using either your **Student ID** (e.g., `STU-...`) OR your **Email address**.\n"
            "- **Librarians**: Can also log in with their username or registered email."
        )

    # Default welcoming overview
    return (
        "Hello! I am your **CampusShelf Library Assistant**.\n\n"
        "Here is what I can help you with:\n"
        "• 🎧 **Check Free Slots**: Ask *\"Which slots are free today for Silent Pod?\"* or *\"What spaces are open tomorrow?\"*\n"
        "• 📅 **Booking Help**: Ask *\"How do I book a conference room or pod?\"*\n"
        "• 📚 **Book Recommendations**: Ask *\"Suggest books on Artificial Intelligence\"* or *\"Find data structures books\"*.\n"
        "• 👤 **Your Status**: Ask *\"Check my active bookings and loans\"*.\n\n"
        "How can I assist you right now?"
    )


def build_system_context(student_member=None, query_text=""):
    """Gathers real-time database context for CampusShelf library."""
    today = timezone.localdate()
    target_date = extract_potential_date(query_text)

    # 1. Study Spaces & Live Timeline
    spaces_data = get_spaces_availability_data(target_date)
    space_summaries = []
    for item in spaces_data:
        sp = item["space"]
        space_summaries.append(
            f"• {sp.name} ({sp.get_space_type_display()}, Cap: {sp.capacity} students, Loc: {sp.location or 'Library'})\n"
            f"   - Amenities: {sp.amenities or 'Power, WiFi'}\n"
            f"   - Free/Empty slots on {target_date}: {', '.join(item['empty']) if item['empty'] else 'None (Fully Booked)'}\n"
            f"   - Confirmed/Booked: {', '.join(item['occupied']) if item['occupied'] else 'None'}\n"
            f"   - Pending Approval: {', '.join(item['pending']) if item['pending'] else 'None'}"
        )

    # 2. Book Catalogue Summary
    top_books = list(Book.objects.all().order_by("-created_at")[:30])
    book_summaries = []
    for bk in top_books:
        avail_str = f"{bk.copies} available" if bk.copies > 0 else "All copies in use"
        book_summaries.append(
            f"• \"{bk.title}\" by {bk.author} | Category: {bk.category} | Shelf: {bk.shelf} | {avail_str} (Stock: {bk.total_copies})"
        )

    # 3. Student Personal Context
    student_section = "User is currently browsing as a visitor (not logged in)."
    if student_member:
        my_bookings = SpaceBooking.objects.filter(member=student_member).order_by("-booking_date", "-start_time")[:6]
        booking_lines = [
            f"  - {b.space_name} on {b.booking_date} ({b.start_time}-{b.end_time}) [Status: {b.get_status_display()}]"
            for b in my_bookings
        ]
        my_loans = Borrowing.objects.filter(member=student_member, status=Borrowing.BORROWED)[:5]
        loan_lines = [
            f"  - \"{l.book_title}\" (Due date: {l.due_at.strftime('%Y-%m-%d')})"
            for l in my_loans
        ]

        student_section = (
            f"CURRENT LOGGED-IN STUDENT PROFILE:\n"
            f"- Name: {student_member.name}\n"
            f"- Student ID: {student_member.student_id}\n"
            f"- Email: {student_member.email}\n"
            f"- Program: {student_member.course}, Year: {student_member.year}\n"
            f"- Active Space Bookings:\n{chr(10).join(booking_lines) if booking_lines else '  None'}\n"
            f"- Active Book Loans:\n{chr(10).join(loan_lines) if loan_lines else '  None'}"
        )

    system_prompt = f"""You are the official CampusShelf AI Library Assistant, an intelligent, polite, and helpful library concierge embedded into the CampusShelf web platform.
Today's local date is: {today.isoformat()} (Asia/Kolkata timezone). Target inquiry date checked is: {target_date}.

YOUR CAPABILITIES & KNOWLEDGE:
1. Space & Pod Booking Assistance:
   - Students can book study pods, duo pods, and conference rooms on the "Room & Pods" section of their portal.
   - Booking process: Select space -> Choose date -> Pick Start and End time (between 08:00 and 20:00) -> Enter student count (up to space capacity) -> Click "Book Slot (Send for Approval)".
   - Workflow: When a student requests a slot, it starts in "Pending Approval" state. It goes to the Librarian portal. Once a librarian approves it, it becomes "Confirmed".
   - You can give exact availability for any space and hour based on real-time data below.

2. Library Catalogue & Recommendations:
   - You know all titles, authors, categories, shelf locations, and physical copy availability.
   - You can recommend books for study topics (e.g., Computer Science, Data Structures, AI, Networks, Machine Learning, Literature, Mathematics).
   - If a student wants a book whose copies are in use, explain that they can place a hold under the "Discover" tab on the title's detail page.

3. Library Procedures & Operations:
   - Account Access: Students can sign up directly without librarian approval, and can log in using either their Student ID (e.g. STU-...) OR their email address!
   - Borrowing: Issued at the librarian desk.
   - Returning: Returned to librarian desk or by scanning return slip QR.
   - Renewals: Can request renewal under the "My loans" tab.
   - Fines: Overdue books accrue daily late fines, visible under "My fines".

4. Navigation Help:
   - "Room & Pods": Explore spaces, check hourly timeline pills, book slots, view my reservations.
   - "Discover": Search catalogue, filter by category/shelf, read reviews, reserve copies.
   - "My loans": Current loans, due dates, renewal requests.
   - "My holds": Book reservation queue.
   - "My fines": Overdue and fine receipts.

{student_section}

LIVE STUDY SPACES & PODS AVAILABILITY ({target_date}):
{chr(10).join(space_summaries)}

SAMPLE LIBRARY CATALOGUE TITLES:
{chr(10).join(book_summaries[:20])}

RESPONSE STYLE & STRICT DOMAIN BOUNDARIES:
- Be clear, complete, and friendly. Never trail off or cut off mid-sentence.
- Quote exact available time slots from the live data above.
- If asked how to book, give direct, easy step-by-step instructions.
- STRICT SCOPE LIMIT: You are SOLELY the CampusShelf library assistant. ONLY answer questions directly about CampusShelf library spaces, pod bookings, library books, loans, and library procedures.
- IF THE USER ASKS ANY UNRELATED QUESTION (such as asking for programming code, Python scripts, general coding, essays, math homework, trivia, recipes, or unrelated topics):
  YOU MUST POLITELY DECLINE AND SAY NO.
  Say: "I am only able to help with CampusShelf library services, study pod & conference room bookings, and book catalogue inquiries. I cannot write code or answer questions unrelated to the library. Please let me know how I can help you with library spaces or books!"
- NEVER write Python, JavaScript, or any programming code under any circumstances.
"""
    return system_prompt


def call_gemini(messages, student_member=None):
    """
    Calls the Gemini API (primary model with fast fallback).
    Sets maxOutputTokens to 2048 to prevent truncation, and falls back seamlessly
    so responses never get stuck, interrupted, or throw raw errors.
    """
    api_key = os.getenv("GEMINI_API_KEY", "").strip() or GEMINI_API_KEY
    last_user_query = ""
    for m in reversed(messages):
        if m.get("role") in ("user", None):
            last_user_query = m.get("text", "")
            break

    # Immediate guardrail check for off-topic requests (e.g. coding, essays, general trivia)
    if is_off_topic_query(last_user_query):
        return OFF_TOPIC_REFUSAL

    if not api_key:
        return smart_local_response(last_user_query, student_member)

    system_instruction = build_system_context(student_member, last_user_query)

    contents = []
    contents.append({
        "role": "user",
        "parts": [{"text": f"SYSTEM CONTEXT & INSTRUCTIONS:\n{system_instruction}\n\n[End of Context]"}]
    })
    contents.append({
        "role": "model",
        "parts": [{"text": "Understood. I am the CampusShelf AI Library Assistant ready to help with slots, books, and reservations."}]
    })

    for m in messages[-4:]:
        role = "model" if m.get("role") in ("model", "assistant") else "user"
        text = m.get("text", "").strip()
        if text:
            contents.append({"role": role, "parts": [{"text": text}]})

    payload = {
        "contents": contents,
        "generationConfig": {
            "temperature": 0.4,
            "maxOutputTokens": 2048,
        },
    }
    json_bytes = json.dumps(payload).encode("utf-8")
    ctx = ssl.create_default_context()

    # Prioritize primary, but quickly try fast flash-lite fallback if 503 or timeout
    model_chain = [PRIMARY_MODEL]
    for fb in FALLBACK_MODELS:
        if fb not in model_chain:
            model_chain.append(fb)

    for idx, model_name in enumerate(model_chain):
        # Primary gets a fast 2.5s probe; fallback gets 4.0s
        timeout_val = 2.5 if idx == 0 and len(model_chain) > 1 else 4.0
        url = f"https://generativelanguage.googleapis.com/v1/models/{model_name}:generateContent?key={api_key}"
        req = urllib.request.Request(
            url,
            data=json_bytes,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, context=ctx, timeout=timeout_val) as response:
                data = json.loads(response.read().decode("utf-8"))
                candidates = data.get("candidates", [])
                if candidates:
                    parts = candidates[0].get("content", {}).get("parts", [])
                    # Concatenate all parts so text is never truncated
                    full_text = "".join(p.get("text", "") for p in parts if "text" in p).strip()
                    if full_text:
                        return full_text
        except urllib.error.HTTPError as e:
            logger.warning("Gemini API %s HTTPError %s", model_name, e.code)
            continue
        except Exception as e:
            logger.warning("Gemini API %s failed: %s", model_name, e)
            continue

    # Instant seamless response from local database intelligence
    return smart_local_response(last_user_query, student_member)
