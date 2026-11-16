# CampusShelf — MongoDB + PyMongo library desk

A small, librarian-focused library management app built with Flask and PyMongo. It demonstrates a practical multi-collection MongoDB design, indexed catalogue search, stock tracking, issue slips, returns, and aggregation-based insights.

## Librarian features

- Overview cards for catalogue titles, copies on the shelf, active issues, overdue returns and registered students
- Six-month issue and return chart, plus a live inventory breakdown by category
- Book catalogue with total, available and on-loan copy counts, shelf locations, ISBN and descriptions
- MongoDB text-index search across title, author, category, ISBN and description
- Student directory with generated `STU-` IDs, email, course and study year
- Issue slips with unique IDs in the form `CS-<ObjectId>`; returns can be marked by entering that ID
- Librarian checkout resolves an exact available `CSB-<ObjectId>` Copy ID to its book title and shelf, then reserves that same physical copy
- Due-date tracking with overdue indicators and quick check-in actions
- Reader notes and useful aggregation reports
- Librarian ID/password sign-in with generated `LIB-` IDs, first-run account setup, and a staff access roster for adding or disabling accounts
- Public student portal for indexed title/author search, shelf and live copy availability, and self-checkout using a Student ID, registered campus email, portal password, and unique copy ID
- Printable student issue slips and per-copy ID labels; book returns remain at the librarian desk

## Run locally

1. Install Python 3.10+.
2. Open a terminal in this folder.
3. Create a virtual environment (recommended): `py -m venv .venv` on Windows, or `python3 -m venv .venv` on macOS/Linux.
4. Activate it and install dependencies: `pip install -r requirements.txt`.
5. Copy `.env.example` to `.env`, set `MONGO_URI` to your Atlas connection URI, and keep `DB_NAME=campusshelf`.
6. In Atlas, allow your current IP under Network Access and configure a database user. URL-encode special characters in the password.
7. Start the app with `python app.py` and open `http://127.0.0.1:5000`.
8. On the first visit, create the first librarian account and password; CampusShelf generates its ID and shows it on the overview. Later visits require that ID and password. Signed-in librarians can add staff accounts and share their generated IDs from the Librarians page.
9. Open `/health` to confirm the connection, collections and indexes.

## Database design

CampusShelf uses six collections:

- `books`: title, author, category, ISBN, total copies, available copies, availability, shelf, description
- `book_copies`: one record per physical copy, unique printable copy ID, shelf, available/borrowed state and active issue reference
- `members`: generated student ID, student name, email, password hash, course and study year
- `borrowings`: book/student ObjectId references, issue ID, contact and title snapshots, status and timestamps
- `reviews`: book/student references and snapshots, rating and comment
- `librarians`: generated normalized login ID, name, password hash, active status and creation time

`books.copies` means copies currently on the shelf. `books.total_copies` is the whole collection count for that title. Each physical copy also has one stable `CSB-<ObjectId>` label in `book_copies`; new labels are generated when inventory is added, and legacy inventory is backfilled on startup. Student and librarian IDs are automatically generated and uniquely indexed. Librarian checkout looks up a copy by its unique ID, detects its title and shelf, and reserves that exact physical copy. Issues decrement shelf counts; librarian returns release the same copy and restore the shelf count. Students can search the public catalogue and check out an available copy using their `STU-` ID, registered campus email, password and copy label ID. Returns are only available through the librarian workspace.

Issue slips keep student and book snapshots so old records remain useful if a directory entry or title is later removed. Existing records also receive a stable issue ID at startup. Seed data is inserted only when a collection is empty.

## Indexes and validation

Indexes are created automatically:

- `books.title` for catalogue sorting
- `books_search_text` over title, author, category, ISBN and description
- `books.category + books.available` for inventory filtering
- unique `book_copies.copy_id` and `book_copies.book_id + book_copies.status` for label lookup and stock reservation
- librarian copy-ID lookup uses the unique `book_copies.copy_id` index and conditionally reserves the requested physical copy
- unique partial `books.isbn`
- unique `members.email`
- unique partial `members.student_id`
- portal checkout validates the registered email and Werkzeug password hash before touching copy or loan records; librarians can set or reset a student's portal password from the directory
- `borrowings.member_id + borrowings.status`
- `borrowings.member_student_id + borrowings.borrowed_at` for student-ID issue lookups
- descending `borrowings.borrowed_at`
- `borrowings.status + borrowings.due_at` for overdue checks
- `borrowings.returned_at` for return trends
- unique `borrowings.issue_code`
- `reviews.book_id + reviews.rating`
- unique `librarians.login_id` for case-insensitive librarian sign-in

MongoDB JSON Schema validators complement form checks for required fields, data types, non-negative copy counts, study year, borrowing status and review ratings.

## MongoDB operations demonstrated

- CRUD: add/remove books and students, self-checkout or librarian issue, librarian return and reader notes
- Reads: exact filters, sorting, category filtering and `$text` search backed by the text index
- Updates: atomic copy reservation, conditional stock decrement, copy release and return status updates
- Aggregation: `$group`, `$sum`, `$avg`, `$sort`, `$limit`, monthly issue/return trends and category inventory
- Data modeling: ObjectId references plus snapshots for readable historical issue slips

## End-to-end smoke test

After setting up `.env` and dependencies, run:

```bash
python -m unittest discover -s tests -v
```

The test uses a uniquely named temporary database on the configured Atlas cluster. It checks page rendering, catalogue search, CRUD flows, duplicate validation, issue/return stock counts, issue IDs, insights, indexes and schema validation, then drops only its temporary test database. It does not delete the normal `campusshelf` database.

## Scope

This academic demo provides a shared librarian workspace with individual staff sign-ins. It does not include fine-grained staff roles, multi-document transactions or automated due-date notifications.
