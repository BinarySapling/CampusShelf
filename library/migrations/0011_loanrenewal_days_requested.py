from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("library", "0010_align_copy_status_and_review_comment"),
        ("library", "0007_query_performance_indexes"),
    ]

    operations = [
        migrations.AddField(
            model_name="loanrenewalrequest",
            name="days_requested",
            field=models.PositiveSmallIntegerField(
                default=14,
                validators=[MinValueValidator(1), MaxValueValidator(14)],
            ),
        ),
    ]
