# CampusShelf — React + Django + MongoDB

CampusShelf is a campus library app. React and Vite provide the browser interface; Django provides simple function-based views, forms, JSON responses, models, sessions, authentication, and Admin. MongoDB remains the application database through the official Django MongoDB Backend.

## Live app

[Open CampusShelf on Vercel](https://campusshelf-six.vercel.app)

## Features

- Librarian dashboard, catalogue, issue register, reviews, and Django Admin
- Unique Copy IDs with printable QR labels for every physical copy, individually or all at once
- Student signup requests that stay pending until a librarian approves them
- Student self-checkout by scanning an available copy QR after signing in
- Five active book limit, with new checkouts blocked while the student has an overdue loan
- Due-today, due-soon, and overdue alerts in the student loan list and librarian circulation overview
- Librarian QR returns, with an issue slip and 14-day loan period
- Automatic overdue fine of ₹20 for each calendar day after the due date
- Custom student fines with unpaid and paid status
- Searchable, role-scoped activity history for checkouts, returns, renewals, and fine creation or payment
- Django Admin circulation filters for status, due state, issue dates, and copy/student/issue search
- Django session login and CSRF protection for React requests
- Student and librarian password changes after verifying the current password; librarians can also reset student portal passwords

## Run locally

1. Use Python 3.12 or newer and Node.js 22.12 or newer.
2. Create and activate a Python virtual environment, then install Django requirements:

   ```powershell
   py -m venv .venv
   .\.venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   ```

3. Copy `.env.example` to `.env` and set `MONGO_URI` to your MongoDB connection string. Keep `DB_NAME=campusshelf` to use the existing CampusShelf collections.
4. Apply Django migrations and, if wanted, add sample catalogue data:

   ```powershell
   python manage.py migrate
   python manage.py seed_data
   ```

   The seed command adds books and members only when those collections are empty. It does not create sample passwords.

Run the read-only consistency audit before a release or after applying migrations:

```powershell
python manage.py audit_library
```

It checks MongoDB validator compatibility, catalogue stock totals, and active loan to copy status links. It reports findings without changing collection data.

5. Install the frontend packages:

   ```powershell
   npm --prefix frontend install
   ```

6. Start Django in one terminal and React in another:

   ```powershell
   python manage.py runserver
   ```

   ```powershell
   npm --prefix frontend run dev
   ```

7. Open `http://localhost:5173/`. The React dev server proxies `/api` and `/admin` to Django on port 8000. On first use, create a librarian account in the sign-in screen.

The QR camera needs a secure browser context: HTTPS on Vercel or `localhost` during development. Students can use the scanner’s image option when a camera is unavailable.

## Deploy on Vercel

The root [`vercel.json`](vercel.json) defines a React frontend service and a Django backend service under one domain. In Vercel, connect the repository from its root and select the **Services** framework preset. Vercel currently documents Services as a beta feature, so the account must have Services enabled.

Set these Vercel environment variables for Preview and Production:

- `MONGO_URI` — MongoDB connection string
- `DB_NAME` — `campusshelf`
- `SECRET_KEY` — a private random Django secret
- `DEBUG` — `false`
- `LIBRARIAN_SETUP_CODE` — a private code for creating the first librarian account; share it only with the librarian who will perform setup

Apply migrations once against the intended MongoDB database before sending users to the deployment. MongoDB Atlas must allow the deployment’s configured Vercel egress. Keep the access list restricted to the egress addresses configured for the project.

## Existing MongoDB data

Books, physical copies, members, borrowing history, and reviews continue to use the existing `books`, `book_copies`, `members`, `borrowings`, and `reviews` collections. Django migrations add the signup request collection and fine entries, and add an approval status to members. Existing member records default to approved, and a signup using an existing unlinked student email can be connected to that record during approval.

The previous Flask `librarians` collection is not used for Django sign-in. Create new librarian accounts through the first-run setup. Previous Werkzeug password hashes cannot be used by Django; reset old student portal passwords from the librarian tools.

## Project layout

- `frontend/` — React screens, QR scanner, Vite configuration, and browser styles
- `campusshelf/` — Django project settings, URLs, and MongoDB-compatible built-in app migrations
- `library/models.py` — books, copies, members, signup requests, loans, reviews, and fines
- `library/forms.py` — validation for student signup, books, reviews, checkout, and fines
- `library/api.py` and `library/api_urls.py` — small Django JSON endpoints for the React app
- `library/views.py` and `library/urls.py` — Django page views retained for syllabus practice
- `library/templates/library/` — Django Template Language examples
- `vercel.json` — Vercel frontend/backend service routing

## INT253 topics covered

- **Unit I:** Django project and app structure, settings, `manage.py`, and local setup
- **Unit II:** function-based views, URL parameters, GET/POST, JSON responses, and error status codes
- **Unit III:** Django templates, inheritance, loops, conditions, debugging, and Django tests; React uses simple components and state for the requested frontend
- **Unit IV:** Django forms, validation, CSRF cookies and headers, POST actions, and redirects
- **Unit V:** models, MongoDB collections, foreign keys, migrations, ORM, Admin, users, groups, and permissions
- **Unit VI:** login/logout, authenticated views, MongoDB-backed sessions, and the existing catalogue preference cookie

The code avoids a REST framework and keeps the backend in ordinary Django views and forms. React uses basic components, `useState`, and `useEffect`.

## Useful checks

```powershell
python manage.py check
python manage.py makemigrations library
python manage.py migrate
python manage.py test library.tests
npm --prefix frontend run build
```

Run Django tests with a MongoDB test database available. The test runner creates and removes a separate database with the `test_` prefix. It does not write test records to the configured `campusshelf` database.

For MongoDB connection and feature details, see the [official Django MongoDB Backend documentation](https://www.mongodb.com/docs/languages/python/django-mongodb/current/).


## Catalogue expansion and optional covers

Run `python manage.py migrate` and then `python manage.py seed_catalogue --copies 6` against the intended database to add 40 varied seed titles and bring each to at least six active physical copies. The command preserves existing titles, users, loans, and cover choices and is safe to rerun. Each new copy receives its own QR identifier.

The add/edit book form accepts an optional HTTPS cover image URL. Leave it blank for the default cover; failed images automatically fall back to that cover. Images are loaded by the browser without sending a referrer. The database stores only the URL.

Book and student fields in circulation, custom fines, and review entry are searchable. Search books by title, author, ISBN, or shelf and students by name, ID, or email. Recorded unpaid fines can be marked paid or removed by librarians. Paid receipts are retained; live overdue estimates are finalised when the book is returned.
