from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("library", "0006_libraryspace_spacebooking"),
    ]

    operations = [
        migrations.AddIndex("book", models.Index(fields=["category", "title"], name="book_category_title_idx")),
        migrations.AddIndex("book", models.Index(fields=["author", "title"], name="book_author_title_idx")),
        migrations.AddIndex("book", models.Index(fields=["-created_at"], name="book_created_desc_idx")),
        migrations.AddIndex("studentsignuprequest", models.Index(fields=["status", "-submitted_at"], name="signup_status_time_idx")),
        migrations.AddIndex("bookcopy", models.Index(fields=["book", "status"], name="book_copy_stock_lookup")),
        migrations.AddIndex("bookcopy", models.Index(fields=["book", "copy_id"], name="copy_book_code_idx")),
        migrations.AddIndex("borrowing", models.Index(fields=["status", "due_at"], name="loans_due_status")),
        migrations.AddIndex("borrowing", models.Index(fields=["member", "status", "borrowed_at"], name="loan_member_status_date_idx")),
        migrations.AddIndex("borrowing", models.Index(fields=["member_student_id", "status", "borrowed_at"], name="loan_student_status_date_idx")),
        migrations.AddIndex("borrowing", models.Index(fields=["book", "status"], name="loan_book_status_idx")),
        migrations.AddIndex("borrowing", models.Index(fields=["copy_id", "status"], name="loan_copy_status_idx")),
        migrations.AddIndex("borrowing", models.Index(fields=["-borrowed_at"], name="borrowed_at_-1")),
        migrations.AddIndex("bookreservation", models.Index(fields=["book", "status", "created_at"], name="res_book_status_time_idx")),
        migrations.AddIndex("bookreservation", models.Index(fields=["member", "status", "created_at"], name="res_member_status_time_idx")),
        migrations.AddIndex("loanrenewalrequest", models.Index(fields=["borrowing", "-created_at"], name="renew_borrow_date_idx")),
        migrations.AddIndex("loanrenewalrequest", models.Index(fields=["member", "status", "-reviewed_at"], name="renew_member_review_idx")),
        migrations.AddIndex("loanrenewalrequest", models.Index(fields=["status", "created_at"], name="renew_status_date_idx")),
        migrations.AddIndex("fineentry", models.Index(fields=["member", "status"], name="fine_member_status_idx")),
        migrations.AddIndex("fineentry", models.Index(fields=["student_id", "status"], name="fine_student_status_idx")),
        migrations.AddIndex("fineentry", models.Index(fields=["status", "-created_at"], name="fine_status_created_idx")),
        migrations.AddIndex("review", models.Index(fields=["book", "-created_at"], name="review_book_time_idx")),
        migrations.AddIndex("spacebooking", models.Index(fields=["status", "-created_at"], name="space_status_date_idx")),
        migrations.AddIndex("spacebooking", models.Index(fields=["member", "booking_date", "start_time"], name="space_member_slot_idx")),
        migrations.AddIndex("spacebooking", models.Index(fields=["space", "booking_date", "status", "start_time"], name="space_slot_status_idx")),
    ]
