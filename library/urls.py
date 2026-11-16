from django.urls import path, re_path

from . import views


urlpatterns = [
    path("", views.dashboard, name="dashboard"),
    path("books/", views.books, name="books"),
    path("books/add/", views.add_book, name="add_book"),
    path("books/<str:book_id>/copies/", views.book_copies, name="book_copies"),
    path("books/<str:book_id>/delete/", views.delete_book, name="delete_book"),
    path("student/", views.student_portal, name="student_portal"),
    path("student/search/", views.student_book_search, name="student_book_search"),
    path("student/issue/", views.student_issue, name="student_issue"),
    path("student/slip/<str:issue_code>/", views.student_slip, name="student_slip"),
    path("members/", views.members, name="members"),
    path("members/<str:member_id>/portal-password/", views.reset_member_portal_password, name="reset_member_portal_password"),
    path("members/<str:member_id>/delete/", views.delete_member, name="delete_member"),
    path("api/books/search/", views.search_issue_books, name="search_issue_books"),
    path("api/book-copies/lookup/", views.lookup_issue_copy, name="lookup_issue_copy"),
    path("api/students/search/", views.search_issue_students, name="search_issue_students"),
    path("borrowings/", views.borrowings, name="borrowings"),
    path("borrowings/return-by-id/", views.return_by_issue_id, name="return_by_issue_id"),
    path("borrowings/<str:issue_code>/return/", views.return_book, name="return_book"),
    path("issues/", views.issue_register, name="issue_register"),
    re_path(r"^issues/(?P<issue_code>CS-[0-9A-Fa-f]{24})/$", views.issue_slip, name="issue_slip"),
    path("reviews/", views.reviews, name="reviews"),
    path("insights/", views.insights, name="insights"),
    path("health/", views.health, name="health"),
    path("login/", views.login, name="login"),
    path("setup/", views.setup_librarian, name="setup_librarian"),
    path("logout/", views.logout, name="logout"),
    path("librarians/", views.librarians, name="librarians"),
    path("librarians/<str:librarian_id>/deactivate/", views.deactivate_librarian, name="deactivate_librarian"),
]
