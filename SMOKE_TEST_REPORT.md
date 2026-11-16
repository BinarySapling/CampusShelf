# CampusShelf smoke-test report

## Static checks completed in the build environment
- `app.py` and `tests/test_smoke.py` compile and parse as Python.
- All seven Jinja templates parse successfully.
- All template `url_for(...)` endpoint names map to an app route or Flask's built-in `static` endpoint.
- Fixed a MongoDB unique-index migration issue: the ISBN index now applies only to string ISBN values, so legacy `isbn: null` documents do not collide.
- Prevented deleting books or members with active loans.
- Prevented repeated return submissions from incrementing inventory twice.
- Due dates now use a real 14-day timedelta.
- Search text is escaped before being used as a MongoDB regular expression.
- Added a live end-to-end smoke suite covering routes, health/indexes, create/search, duplicate ISBN/email, checkout, zero-stock guard, active-loan delete guard, return idempotency, reviews, aggregations and schema validation.

## Runtime test status (2026-10-17)
- Installed requirements in the ignored local `.venv` and started Flask at `http://127.0.0.1:5000`.
- Atlas connection succeeded. `/health` returned HTTP 200 with the four expected collections and their indexes.
- The dashboard, books, members, borrowings, reviews and insights pages rendered successfully against Atlas.
- `python -m unittest discover -s tests -v` passed the end-to-end flow: route rendering, index checks, create/search, duplicate ISBN/email, checkout and inventory guard, return idempotency, active-loan delete guards, reviews, aggregation output and MongoDB schema validation.
- The smoke test uses and drops only a uniquely named temporary database. It does not change the normal `campusshelf` database. The app seeds sample records in `campusshelf` only when collections are empty.
- Connection exceptions are sanitized before they reach page HTML or `/health`; the UI reports MongoDB connection state. A branded SVG favicon avoids a missing-icon request.

## Run the smoke test again
After installing the requirements and configuring `MONGO_URI` in `.env`, run:

```bash
.venv/Scripts/python.exe -m unittest discover -s tests -v
```

The test creates a unique `campusshelf_smoke_<random>` database and drops only that temporary database. It does not drop the regular `campusshelf` database.
