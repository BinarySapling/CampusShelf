from bson import ObjectId
from django.core.management.base import BaseCommand, CommandError
from library.models import Book, BookCopy
from library.views import copy_code_for, update_book_stock

CATALOGUE = [
    ('Atomic Habits', 'James Clear', 'Self Growth'),
    ('Clean Code', 'Robert C. Martin', 'Technology'),
    ('The Alchemist', 'Paulo Coelho', 'Fiction'),
    ('Deep Work', 'Cal Newport', 'Productivity'),
    ('The Design of Everyday Things', 'Don Norman', 'Design'),
    ('The Pragmatic Programmer', 'Andrew Hunt and David Thomas', 'Software Engineering'),
    ('Introduction to Algorithms', 'Thomas H. Cormen', 'Computer Science'),
    ('Design Patterns', 'Erich Gamma', 'Software Engineering'),
    ('Refactoring', 'Martin Fowler', 'Software Engineering'),
    ('Computer Networks', 'Andrew S. Tanenbaum', 'Computer Science'),
    ('Operating System Concepts', 'Abraham Silberschatz', 'Computer Science'),
    ('Database System Concepts', 'Abraham Silberschatz', 'Databases'),
    ('Designing Data-Intensive Applications', 'Martin Kleppmann', 'Databases'),
    ('Python Crash Course', 'Eric Matthes', 'Programming'),
    ('Automate the Boring Stuff with Python', 'Al Sweigart', 'Programming'),
    ('Eloquent JavaScript', 'Marijn Haverbeke', 'Web Development'),
    ('You Don\'t Know JS Yet: Get Started', 'Kyle Simpson', 'Web Development'),
    ('Learning React', 'Alex Banks and Eve Porcello', 'Web Development'),
    ('Django for Beginners', 'William S. Vincent', 'Web Development'),
    ('Learning Web Design', 'Jennifer Robbins', 'Web Design'),
    ('Artificial Intelligence: A Modern Approach', 'Stuart Russell and Peter Norvig', 'Artificial Intelligence'),
    ('Hands-On Machine Learning', 'Aurelien Geron', 'Artificial Intelligence'),
    ('The Hundred-Page Machine Learning Book', 'Andriy Burkov', 'Artificial Intelligence'),
    ('Thinking, Fast and Slow', 'Daniel Kahneman', 'Psychology'),
    ('Man\'s Search for Meaning', 'Viktor E. Frankl', 'Psychology'),
    ('Mindset', 'Carol S. Dweck', 'Self Growth'),
    ('The Psychology of Money', 'Morgan Housel', 'Finance'),
    ('The Intelligent Investor', 'Benjamin Graham', 'Finance'),
    ('The Lean Startup', 'Eric Ries', 'Business'),
    ('Zero to One', 'Peter Thiel', 'Business'),
    ('Start with Why', 'Simon Sinek', 'Business'),
    ('Sapiens', 'Yuval Noah Harari', 'History'),
    ('A Brief History of Time', 'Stephen Hawking', 'Science'),
    ('Cosmos', 'Carl Sagan', 'Science'),
    ('The Selfish Gene', 'Richard Dawkins', 'Science'),
    ('The Hitchhiker\'s Guide to the Galaxy', 'Douglas Adams', 'Fiction'),
    ('1984', 'George Orwell', 'Fiction'),
    ('Pride and Prejudice', 'Jane Austen', 'Fiction'),
    ('To Kill a Mockingbird', 'Harper Lee', 'Fiction'),
    ('The Little Prince', 'Antoine de Saint-Exupery', 'Fiction'),
]

class Command(BaseCommand):
    help = 'Expand the catalogue to 40 varied titles with unique physical-copy QR IDs. Safe to rerun.'

    def add_arguments(self, parser):
        parser.add_argument('--copies', type=int, default=6, help='Minimum active copies per seed title (1–200).')

    def handle(self, *args, **options):
        target = options['copies']
        if not 1 <= target <= 200:
            raise CommandError('--copies must be between 1 and 200.')
        new_titles = new_copies = 0
        for index, (title, author, category) in enumerate(CATALOGUE):
            book = Book.objects.filter(title__iexact=title).first()
            if not book:
                book = Book.objects.create(title=title, author=author, category=category,
                    shelf=f'{chr(65 + index // 10)}-{index % 10 + 1:02}',
                    description=f'Explore {category.lower()} with this title from the CampusShelf collection.')
                new_titles += 1
            active = BookCopy.objects.filter(book=book).exclude(status=BookCopy.RETIRED).count()
            for _ in range(max(0, target - active)):
                identifier = ObjectId()
                BookCopy.objects.create(id=identifier, book=book, copy_id=copy_code_for(identifier),
                    book_title=book.title, shelf=book.shelf, status=BookCopy.AVAILABLE)
                new_copies += 1
            update_book_stock(book)
        self.stdout.write(self.style.SUCCESS(f'Added {new_titles} titles and {new_copies} copies. Existing books, loans, users, and cover choices preserved.'))
