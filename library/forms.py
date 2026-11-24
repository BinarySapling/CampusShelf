import secrets

from django import forms
from django.conf import settings

from .models import Book


class BookForm(forms.ModelForm):
    copies = forms.IntegerField(min_value=0, max_value=200)

    class Meta:
        model = Book
        fields = [
            "title",
            "author",
            "category",
            "isbn",
            "copies",
            "shelf",
            "description",
            "cover_url",
        ]

    def clean_cover_url(self):
        value = self.cleaned_data.get("cover_url", "").strip()
        if value and not value.lower().startswith("https://"):
            raise forms.ValidationError("Use a secure HTTPS image URL, or leave this blank for the default cover.")
        return value

    def clean_isbn(self):
        isbn = (self.cleaned_data.get("isbn") or "").strip()
        matching_books = Book.objects.filter(isbn=isbn) if isbn else Book.objects.none()
        if self.instance and self.instance.pk:
            matching_books = matching_books.exclude(pk=self.instance.pk)
        if isbn and matching_books.exists():
            raise forms.ValidationError("That ISBN already exists. Use a unique ISBN.")
        return isbn or None


class StudentRegistrationForm(forms.Form):
    name = forms.CharField(max_length=100)
    email = forms.EmailField(max_length=160)
    course = forms.CharField(max_length=60)
    year = forms.IntegerField(min_value=1, max_value=6)
    password = forms.CharField(min_length=10, max_length=256, widget=forms.PasswordInput)
    confirm_password = forms.CharField(min_length=10, max_length=256, widget=forms.PasswordInput)

    def clean_email(self):
        return self.cleaned_data["email"].strip().casefold()

    def clean(self):
        cleaned_data = super().clean()
        password = cleaned_data.get("password")
        confirm_password = cleaned_data.get("confirm_password")
        if password and confirm_password and password != confirm_password:
            self.add_error("confirm_password", "Portal password and confirmation do not match.")
        return cleaned_data


class StudentSignupForm(forms.Form):
    name = forms.CharField(max_length=100)
    email = forms.EmailField(max_length=160)
    registration_number = forms.CharField(max_length=50)
    course = forms.CharField(max_length=60)
    year = forms.IntegerField(min_value=1, max_value=6)
    password = forms.CharField(min_length=10, max_length=256, widget=forms.PasswordInput)
    confirm_password = forms.CharField(min_length=10, max_length=256, widget=forms.PasswordInput)

    def clean_email(self):
        return self.cleaned_data["email"].strip().casefold()

    def clean(self):
        cleaned_data = super().clean()
        password = cleaned_data.get("password")
        confirm_password = cleaned_data.get("confirm_password")
        if password and confirm_password and password != confirm_password:
            self.add_error("confirm_password", "Passwords do not match.")
        return cleaned_data


class PortalPasswordForm(forms.Form):
    password = forms.CharField(min_length=10, max_length=256, widget=forms.PasswordInput)
    confirm_password = forms.CharField(min_length=10, max_length=256, widget=forms.PasswordInput)

    def clean(self):
        cleaned_data = super().clean()
        password = cleaned_data.get("password")
        confirm_password = cleaned_data.get("confirm_password")
        if password and confirm_password and password != confirm_password:
            self.add_error("confirm_password", "Portal password and confirmation do not match.")
        return cleaned_data


class LibrarianForm(forms.Form):
    name = forms.CharField(max_length=80)
    email = forms.EmailField(max_length=160, required=False)
    password = forms.CharField(min_length=10, max_length=256, widget=forms.PasswordInput)


class FirstLibrarianForm(LibrarianForm):
    setup_code = forms.CharField(max_length=120, required=False, widget=forms.PasswordInput)

    def clean_setup_code(self):
        supplied = self.cleaned_data.get("setup_code", "")
        expected = settings.LIBRARIAN_SETUP_CODE
        if not settings.DEBUG and (not expected or not secrets.compare_digest(supplied, expected)):
            raise forms.ValidationError("Enter the first librarian setup code for this deployment.")
        return supplied


class LoginForm(forms.Form):
    login_id = forms.CharField(max_length=150)
    password = forms.CharField(max_length=256, widget=forms.PasswordInput)


class CheckoutForm(forms.Form):
    member_id = forms.CharField(max_length=32)
    book_id = forms.CharField(max_length=32)
    copy_id = forms.CharField(max_length=28)


class StudentCheckoutForm(forms.Form):
    student_id = forms.CharField(max_length=32)
    email = forms.EmailField(max_length=160)
    password = forms.CharField(max_length=256, widget=forms.PasswordInput)
    book_id = forms.CharField(max_length=32)
    copy_id = forms.CharField(max_length=28)


class ReviewForm(forms.Form):
    book_id = forms.CharField(max_length=32)
    member_id = forms.CharField(max_length=32)
    rating = forms.IntegerField(min_value=1, max_value=5)
    comment = forms.CharField(max_length=500)


class StudentReviewForm(forms.Form):
    book_id = forms.CharField(max_length=32)
    rating = forms.IntegerField(min_value=1, max_value=5)
    comment = forms.CharField(max_length=500, required=False)


class IssueIdForm(forms.Form):
    issue_code = forms.CharField(max_length=40)


class StudentIssueForm(forms.Form):
    copy_id = forms.CharField(max_length=28)


class BookReservationForm(forms.Form):
    book_id = forms.CharField(max_length=32)


class LoanRenewalRequestForm(forms.Form):
    loan_id = forms.CharField(max_length=32)
    days_requested = forms.IntegerField(min_value=1, max_value=14, required=False, initial=14)

    def clean_days_requested(self):
        return self.cleaned_data.get("days_requested") or 14


class ManualIssueForm(forms.Form):
    member_id = forms.CharField(max_length=32)
    copy_id = forms.CharField(max_length=28)


class CustomFineForm(forms.Form):
    member_id = forms.CharField(max_length=32)
    amount = forms.DecimalField(min_value=0.01, max_digits=8, decimal_places=2)
    reason = forms.CharField(max_length=200)


class SpaceBookingForm(forms.Form):
    space_id = forms.CharField(max_length=40)
    booking_date = forms.CharField(max_length=10)
    start_time = forms.CharField(max_length=5)
    end_time = forms.CharField(max_length=5)
    attendees_count = forms.IntegerField(min_value=1, max_value=100)
    purpose = forms.CharField(max_length=250, required=False)

