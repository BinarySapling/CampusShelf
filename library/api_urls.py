from django.urls import path

from . import api
from . import views


urlpatterns = [
    path("csrf/", api.csrf_token, name="api_csrf"),
    path("auth/session/", api.auth_session, name="api_auth_session"),
    path("auth/login/", api.login_user, name="api_login"),
    path("auth/setup/", api.setup_librarian, name="api_setup_librarian"),
    path("auth/logout/", api.logout_user, name="api_logout"),
    path("auth/password/", api.change_password, name="api_change_password"),
    path("signup/", api.submit_signup, name="api_signup"),
    path("catalogue/", api.catalogue, name="api_catalogue"),
    path("dashboard/", api.dashboard_data, name="api_dashboard"),
    path("books/", api.books_api, name="api_books"),
    path("books/copies/", api.all_copies_list, name="api_all_book_copies"),
    path("books/<str:book_id>/copies/", api.copies_list, name="api_book_copies"),
    path("copies/<str:copy_id>/", api.scan_copy, name="api_scan_copy"),
    path("copies/<str:copy_id>/lookup/", api.copy_lookup, name="api_copy_lookup"),
    path("requests/", api.requests_list, name="api_requests"),
    path("requests/<str:request_id>/<str:action>/", api.review_signup, name="api_review_signup"),
    path("members/", api.members_list, name="api_members"),
    path("members/catalogue/", api.members_catalogue, name="api_member_catalogue"),
    path("loans/", api.loans_api, name="api_loans"),
    path("student/loans/", api.student_loans, name="api_student_loans"),
    path("student/issue/", api.student_issue, name="api_student_issue"),
    path("returns/copy/", api.return_copy, name="api_return_copy"),
    path("fines/", api.fines_list, name="api_fines"),
    path("fines/custom/", api.create_custom_fine, name="api_create_fine"),
    path("fines/<str:fine_id>/paid/", api.mark_fine_paid, name="api_mark_fine_paid"),
    path("reviews/", api.reviews_list, name="api_reviews"),
    path("reviews/add/", api.add_review, name="api_add_review"),
    path("health/", views.health, name="api_health"),
]

