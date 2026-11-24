# Portal redesign verification — 24 November 2026

## Design

Shared design tokens and responsive components are in `frontend/src/design.css`.
Fraunces is used for editorial headings, DM Sans for interface text, and DM Mono for identifiers. Lucide supplies interface SVGs; `LibraryArt.jsx` contains the original library illustration. Motion provides route transitions; operating-system reduced-motion preferences disable movement.

## Verification

- Production Vite build: passed.
- Backend regression suite: 37 tests passed against an isolated local MongoDB database.
- Production dependency audit: zero reported vulnerabilities.
- Browser smoke checks: all 14 librarian navigation screens and all 7 student navigation screens rendered on desktop and at 390px width.
- No horizontal document overflow in those route checks. Discovery additionally checked at 320px, 768px, and 1440px.
- Sign in, sign out, signup form layout, book details, edit form, four generated copy QR labels, public rating submission/average refresh, booking dialog open/close, and assistant open/close checked using disposable local accounts.
- Booking dialog stacking verified above the assistant. Mobile navigation opens, closes, and navigates successfully.
- Final clean browser session: no console errors.

These checks cover the React portals and their existing APIs. Camera hardware scanning, physical QR print output, and third-party Gemini responses were not exercised during this visual redesign.

## Follow-up verification: searchable selectors, fines, and covers

- 41 backend regression tests passed; optional-cover and repeatable-seeding checks also passed after the final ISBN compatibility adjustment.
- Browser: book search by author and ISBN, student search by ID and email, empty results, keyboard selection/Escape, circulation controlled selection, successful review/fine form submission, and form reset verified.
- Cover image save/display, failed-image fallback, and restoring the default cover verified.
- Mobile search picker checked at 390px without document overflow.
- Production build passed; production dependency audit reported zero vulnerabilities.
- Fine removal is librarian-only and applies to recorded unpaid fines. Paid receipts remain intact. Live overdue amounts must be finalised by returning the book first.

## Search and filtering update

- Added shared catalogue search with multiple category and availability checkboxes, rating/cover filters, sorting, page size, active filter chips, and reset/empty/error states.
- Catalogue queries search title, author, ISBN, and shelf. Combined filters apply before pagination; stale catalogue requests are cancelled.
- Added checkbox filters to activity history, student directory, fine ledger, student space discovery, and librarian booking requests.
- Students now have an Add fine action that opens the existing fine-entry form with their account selected.
- 43 backend tests passed, including combined catalogue filters/sort/pagination and multi-type transaction filtering with student isolation.
- Browser checks passed for category union, both availability choices, pagination reset, clear/remove filters, shelf search, no matches, student/librarian filters, and preselected fine submission using disposable local data.
- Desktop and 390px mobile layouts checked without horizontal overflow. Final browser console showed no errors.
