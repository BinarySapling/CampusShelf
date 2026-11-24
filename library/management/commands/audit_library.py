from collections import Counter, defaultdict
from django.core.management.base import BaseCommand, CommandError
from django.db import connection
from library.models import Book, BookCopy, Borrowing


class Command(BaseCommand):
    help = 'Read-only checks for legacy MongoDB validators, stock totals, and active copy/loan consistency.'

    def handle(self, *args, **options):
        issues = []
        database = connection.database
        checks = [('book_copies', 'status', 'enum', BookCopy.RETIRED), ('books', 'isbn', 'bsonType', 'null')]
        for collection, field, rule, expected in checks:
            schema = database[collection].options().get('validator', {}).get('$jsonSchema', {}).get('properties', {})
            constraint = schema.get(field, {}).get(rule)
            if constraint is not None:
                allowed = [constraint] if isinstance(constraint, str) else constraint
                if expected not in allowed:
                    issues.append(f'{collection}.{field} validator rejects {expected!r}; apply migrations.')
        review_schema = database['reviews'].options().get('validator', {}).get('$jsonSchema', {}).get('properties', {})
        if review_schema.get('comment', {}).get('minLength', 0) > 0:
            issues.append('reviews.comment rejects rating-only reviews; apply migrations.')
        copies = list(BookCopy.objects.all())
        totals = Counter(copy.book_id for copy in copies if copy.status != BookCopy.RETIRED)
        available = Counter(copy.book_id for copy in copies if copy.status == BookCopy.AVAILABLE)
        loans = defaultdict(list)
        for loan in Borrowing.objects.filter(status=Borrowing.BORROWED):
            key = str(loan.book_copy_id) if loan.book_copy_id else loan.copy_id
            loans[key].append(loan)
        for book in Book.objects.all():
            if (book.total_copies, book.copies, book.available) != (totals[book.pk], available[book.pk], available[book.pk] > 0):
                issues.append(f'Stock totals differ for book {book.pk}.')
        for copy in copies:
            linked = loans.get(str(copy.pk), []) + loans.get(copy.copy_id, [])
            if len(linked) > 1:
                issues.append(f'Multiple active loans for copy {copy.copy_id}.')
            elif linked and (copy.status != BookCopy.BORROWED or copy.current_issue_code != linked[0].issue_code):
                issues.append(f'Copy {copy.copy_id} disagrees with its active loan.')
            elif not linked and copy.status == BookCopy.BORROWED:
                issues.append(f'Borrowed copy {copy.copy_id} has no active loan.')
        if issues:
            for issue in issues:
                self.stderr.write(issue)
            raise CommandError(f'{len(issues)} database consistency issue(s) found. No data was changed.')
        self.stdout.write(self.style.SUCCESS('Validator compatibility, stock totals, and active copy/loan checks passed. No data was changed.'))
