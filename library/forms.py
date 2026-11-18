import secrets

from django import forms
from django.conf import settings

from .models import Book


class BookForm(forms.ModelForm):
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
        ]

    def clean_isbn(self):
        isbn = self.cleaned_data.get("isbn", "").strip()
        if isbn and Book.objects.filter(isbn=isbn).exists():
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


class ManualIssueForm(forms.Form):
    member_id = forms.CharField(max_length=32)
    copy_id = forms.CharField(max_length=28)


class CustomFineForm(forms.Form):
    member_id = forms.CharField(max_length=32)
    amount = forms.DecimalField(min_value=0.01, max_digits=8, decimal_places=2)
    reason = forms.CharField(max_length=200)
